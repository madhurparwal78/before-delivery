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
import struct
import subprocess
import tempfile
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    unique,
)

TOKEN = os.environ.get("GRADING_TOKEN", "")
HTTP_TIMEOUT = 60
POLL_S = 30
POLL_STEP_S = 0.25
INDEX_WAIT_S = 30
COPY_BOOT_S = 180
HEALTH_PROBE_S = 3
UI_TIMEOUT_MS = 10_000
TAB_PRESSES = 12
expect.set_options(timeout=UI_TIMEOUT_MS)

LIVE_MAX_S = 2
GALLERY_MS = 280
DRAWER_MS = 320
TOTALS_MS = 180
GAUGE_MS = 420
GAUGE_SETTLE_MS = 700
GAUGE_LEAD_CM = 20
SWIPE_MIN_PX = 40
TARGET_MIN_PX = 44
FOCUS_RING_PX = 2
BREAK_TABLET = 640
BREAK_DESKTOP = 1024
PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
JSON_LIMIT = 1_000_000
FREE_SHIP = 5000
ADMIN = "/api/admin"
SPENT_BALANCE = 500
RACE_BALANCE = 2000
PNG_TYPE = "image/png"
PHOTO_NAME = "wheel.png"
IMG_NAME = "a.png"

GOOD_CARD = "4242 4242 4242 4242"
DECLINE_CARD = "4000 0000 0000 0002"
NOFUNDS_CARD = "4000 0000 0000 9995"
OTHER_CARD = "5555 5555 5555 4444"
EXPIRY = "12/39"
PAST_EXPIRY = "01/20"
CVC = "123"
PASSWORD = "pass-word-123"
PHONE_NO = "9800000001"
FUTURE_DEVICE_TIME = datetime(2040, 6, 1, tzinfo=timezone.utc)
IST = timezone(timedelta(hours=5, minutes=30))

COLOUR_CODE = {"Graphite": "GRA", "Sage": "SAG", "Signal Red": "RED", "Navy": "NAV", "Teal": "TEA",
               "Sand": "SND", "Tan": "TAN", "Black": "BLK", "Blue": "BLU"}
SIZE_CODE = {"cabin": "C", "check-in-medium": "M", "check-in-large": "L", "underseat": "U", "one-size": "O"}
SIZE_LABEL = {"cabin": "Cabin", "check-in-medium": "Check-in Medium", "check-in-large": "Check-in Large",
              "underseat": "Underseat", "one-size": "One size"}
FULFIL = {"placed": "unfulfilled", "packed": "packed", "shipped": "shipped",
          "out_for_delivery": "out_for_delivery", "delivered": "delivered"}

MSG = {
    "unauthenticated": "Sign in to continue.",
    "invalid_credentials": "That email and password don't match.",
    "not_found": "We couldn't find that.",
    "forbidden": "You don't have permission to do that.",
    "cross_origin": "Requests must come from the Roam House site.",
    "method_not_allowed": "That action isn't allowed here.",
    "idempotency_mismatch": "This request was already used with different details. Start again.",
    "stale_version": "This record changed since you opened it. Reload to see the latest version.",
    "reservation_expired": "Your hold has ended and the items went back on sale. Press Pay to hold them again.",
    "invalid_transition": "That change isn't possible from the current status.",
    "duplicate_request": "There's already an open request for this item.",
    "email_taken": "An account with this email already exists.",
    "unsupported_media_type": "Send the request as JSON.",
    "validation_failed": "Check the highlighted fields.",
    "not_eligible": "This item isn't eligible for that request.",
    "code_invalid": "We don't recognise that code.",
    "code_exhausted": "This code has been fully used.",
    "code_not_applicable": "This code doesn't apply to anything in your bag.",
    "card_declined": "Your card was declined. No money was taken. Try another card.",
    "insufficient_funds": "Your card doesn't have enough funds. No money was taken. Try another card.",
    "email_unavailable": "We couldn't send your confirmation, so the order wasn't placed. Your bag is still held. Try again.",
}
IMAGE_DOWN = "Image storage is unavailable. Nothing was published. Try again."
EVIDENCE_DOWN = "Evidence storage is unavailable. Nothing was saved. Try again."
SEARCH_NOTICE = "Search is unavailable. You can still browse and filter, but typo matching and filter counts are off."
UNSUPPORTED_EVIDENCE = "Use a JPEG, PNG or WebP photo, or a PDF receipt."
UNSUPPORTED_IMAGE = "Use a JPEG, PNG or WebP image."


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def long_date(dt: datetime) -> str:
    local = dt.astimezone(IST)
    return f"{local.day} {local.strftime('%B')} {local.year}"


def add_years(dt: datetime, years: int) -> datetime:
    return dt.replace(year=dt.year + years)


def off_leap_day(dt: datetime) -> datetime:
    return dt + timedelta(days=1) if (dt.month, dt.day) == (2, 29) else dt


def inr(amount: int) -> str:
    digits = str(abs(int(amount)))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups: list[str] = []
        for _ in range(len(head)):
            if not head:
                break
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ",".join(groups + [tail])
    return ("-" if amount < 0 else "") + "₹" + digits


def expect_closed(page: Page, name: str) -> None:
    expect(page.get_by_role("dialog", name=name)).to_be_hidden()
    kept = page.get_by_role("dialog", name=name, include_hidden=True)
    if kept.count():
        expect(kept.first).to_have_attribute("data-state", "closed")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def view_alt(product: str, colour: str, i: int, n: int) -> str:
    return f"{product} in {colour}, view {i} of {n}"


def selected_text(sku: str, price: int, badge: str) -> str:
    return f"SKU {sku} · {inr(price)} · {badge}"


def wishlist_name(n: int) -> str:
    return f"Wishlist, {n} items"


def pause() -> None:
    threading.Event().wait(POLL_STEP_S)


def eventually(fn: Callable[[], Any], what: str, seconds: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    for _ in range(100_000):
        last = fn()
        if last:
            return last
        if time.monotonic() > deadline:
            break
        pause()
    pytest.fail(f"{what}; last observed {last!r}")


def settle_value(fn: Callable[[], Any], expected: Any, what: str) -> None:
    last = None
    for _ in range(400):
        last = fn()
        if last == expected:
            return
    pytest.fail(f"{what}: expected {expected!r}, saw {last!r}")


def together(fns: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(fns))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait(timeout=HTTP_TIMEOUT)
        return fn()

    with ThreadPoolExecutor(len(fns)) as pool:
        futures = [pool.submit(run, fn) for fn in fns]
        return [f.result() for f in futures]


def err(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code}: {r.text[:500]}"
    body = r.json()
    assert body.get("error") == code, body
    want = MSG.get(code) if message is None else message
    if want is not None:
        assert body.get("message") == want, body
    return body


def fields_of(r: httpx.Response) -> dict:
    body = err(r, 422, "validation_failed")
    assert isinstance(body.get("fields"), dict), body
    return body["fields"]


class Actor:

    def __init__(self, base: str, cookie: str | None = None):
        self.base = base
        self.cookie = cookie

    def request(self, method: str, path: str, body: Any = None, key: str | None = None,
                headers: dict | None = None, **kw: Any) -> httpx.Response:
        h: dict[str, str] = {}
        if self.cookie:
            h["Cookie"] = f"rh_session={self.cookie}"
        if key:
            h["Idempotency-Key"] = key
        h.update(headers or {})
        if body is not None:
            kw["json"] = body
        r = httpx.request(method, self.base + path, headers=h, timeout=HTTP_TIMEOUT, **kw)
        fresh = r.cookies.get("rh_session")
        if fresh:
            self.cookie = fresh
        return r

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.request("POST", path, body if body is not None else {}, **kw)

    def patch(self, path: str, body: Any, **kw: Any) -> httpx.Response:
        return self.request("PATCH", path, body, **kw)

    def put(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("PUT", path, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("DELETE", path, **kw)

    def upload(self, path: str, filename: str, content: bytes, ctype: str, fields: dict,
               key: str | None = None) -> httpx.Response:
        return self.request("POST", path, key=key, files={"file": (filename, content, ctype)}, data=fields)


def setup(base: str, body: dict) -> dict:
    assert TOKEN, "GRADING_TOKEN must be set for the verifier"
    r = httpx.post(f"{base}/api/grading/setup", json=body, headers={"X-Grading-Token": TOKEN}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"POST /api/grading/setup should answer 201: {r.status_code} {r.text[:800]}"
    return r.json()


class Product:
    def __init__(self, ns: "Ns", key: str, category: str, material: str, colours: tuple, sizes: tuple,
                 available: Any, compare_at: Any, status: str):
        self.slug = f"test-{ns.low}-{key}"
        self.name = f"Test {ns.code} {key.upper()}"
        self.prefix = f"T{ns.code}{key.upper()}"
        self.material = material
        self.category = category
        self.variants: list[dict] = []
        for colour in colours:
            for size, h, w, d, kg, price in sizes:
                n = available.get((colour, size), 5) if isinstance(available, dict) else available
                self.variants.append({"sku": f"{self.prefix}-{COLOUR_CODE[colour]}-{SIZE_CODE[size]}",
                                      "colour": colour, "size": size, "height_cm": h, "width_cm": w,
                                      "depth_cm": d, "weight_kg": kg, "price": price,
                                      "compare_at": compare_at, "available": n})
        self.spec = {"key": f"prod-{key}", "slug": self.slug, "name": self.name, "category": category,
                     "material": material, "status": status, "variants": [dict(v) for v in self.variants]}

    def v(self, colour: str | None = None, size: str | None = None) -> dict:
        for variant in self.variants:
            if (colour is None or variant["colour"] == colour) and (size is None or variant["size"] == size):
                return variant
        raise KeyError((colour, size))

    def sku(self, colour: str | None = None, size: str | None = None) -> str:
        return self.v(colour, size)["sku"]

    def label(self, sku: str | None = None) -> str:
        variant = next(x for x in self.variants if x["sku"] == (sku or self.variants[0]["sku"]))
        return f"{self.name} — {variant['colour']}, {SIZE_LABEL[variant['size']]}"


class Ns:

    def __init__(self, prefix: str = "rh"):
        a, b = unique(prefix)
        self.code = hashlib.sha1(f"{a}|{b}".encode()).hexdigest()[:8].upper()
        self.low = self.code.lower()
        self.body: dict[str, list] = {}
        self.ids: dict[str, Any] = {}
        self.sessions: dict[str, str] = {}

    def add(self, section: str, item: dict) -> None:
        self.body.setdefault(section, []).append(item)

    def email(self, key: str) -> str:
        return f"{key}-{self.low}@example.test"

    def user(self, key: str, role: str = "customer") -> str:
        self.add("users", {"key": key, "name": f"Shopper {key.upper()}", "email": self.email(key),
                           "password": PASSWORD, "role": role})
        return key

    def address(self, key: str, user: str, label: str = "Home") -> str:
        self.add("addresses", {"key": key, "user": user, "label": label, "name": "Test Shopper",
                               "line1": "1 Test Lane", "line2": "", "city": "Pune", "state": "Maharashtra",
                               "postcode": "411001", "phone": PHONE_NO})
        return key

    def product(self, key: str, *, category: str = "luggage", colours: tuple = ("Graphite",),
                sizes: tuple | None = None, available: Any = 5, material: str | None = None,
                status: str = "published", compare_at: int | None = None) -> Product:
        if sizes is None:
            sizes = (("cabin", 55, 40, 20, 2.9, 4000),) if category != "accessories" else (("one-size", 11, 6, 1, 0.05, 980),)
        p = Product(self, key, category, material or f"Weave {self.code}", colours, sizes, available, compare_at, status)
        self.add("products", p.spec)
        return p

    def cart(self, user: str, lines: list, discount: str | None = None, gift: str | None = None) -> None:
        self.add("carts", {"user": user, "lines": [{"sku": s, "quantity": q} for s, q in lines],
                           "discount_code": discount, "gift_card": gift})

    def hold(self, key: str, user: str, lines: list, reserved_at: datetime) -> None:
        self.add("holds", {"key": key, "user": user, "lines": [{"sku": s, "quantity": q} for s, q in lines],
                           "reserved_at": iso(reserved_at)})

    def discount(self, suffix: str, *, kind: str = "percent", value: int = 10, collection: str | None = None,
                 minimum: int = 0, starts: str = "2026-01-01T00:00:00Z",
                 ends: str = "2099-01-01T00:00:00Z",
                 usage_limit: int | None = None, used: int = 0) -> str:
        code = f"C{self.code}{suffix}"
        self.add("discount_codes", {"code": code, "kind": kind, "value": value, "collection": collection,
                                    "minimum": minimum, "starts_at": starts, "ends_at": ends,
                                    "usage_limit": usage_limit, "used": used})
        return code

    def gift(self, suffix: str, balance: int) -> str:
        code = f"RHGC-{self.code}-{suffix}"
        self.add("gift_cards", {"code": code, "balance": balance})
        return code

    def order(self, key: str, user: str, address: str, status: str, lines: list, placed_at: datetime,
              delivered_at: datetime | None = None) -> None:
        self.add("orders", {"key": key, "user": user, "address": address, "status": status,
                            "payment_status": "captured", "placed_at": iso(placed_at),
                            "delivered_at": iso(delivered_at) if delivered_at else None,
                            "shipping_method": "standard", "discount_code": None, "gift_card": None,
                            "lines": [{"key": lk, "sku": s, "quantity": q, "fulfillment": FULFIL[status]}
                                      for lk, s, q in lines]})

    def case_return(self, key: str, line: str, status: str = "requested") -> None:
        self.add("returns", {"key": key, "order_line": line, "status": status, "quantity": 1,
                             "reason": "Wrong size", "outcome": "refund", "exchange_sku": None})

    def case_trial(self, key: str, line: str) -> None:
        self.add("trials", {"key": key, "order_line": line, "status": "requested"})

    def registration(self, key: str, line: str) -> None:
        self.add("warranty_registrations", {"key": key, "order_line": line})

    def claim(self, key: str, registration: str) -> None:
        self.add("warranty_claims", {"key": key, "registration": registration, "component": "Wheels",
                                     "status": "submitted",
                                     "description": "The front left wheel snapped off on the first trip."})

    def stock(self, sku: str, location: str, available: int) -> None:
        self.add("stock", {"sku": sku, "location": location, "available": available})

    def run(self, base: str) -> dict:
        res = setup(base, self.body)
        self.ids.update(res.get("ids", {}))
        self.sessions.update(res.get("sessions", {}))
        self.body = {}
        return res

    def who(self, base: str, key: str) -> Actor:
        return Actor(base, self.sessions[key])


_CLOCKS: dict[str, tuple[Actor, str]] = {}


def server_now(base: str) -> datetime:
    if base not in _CLOCKS:
        ns = Ns("clock")
        ns.user("c")
        ns.cart("c", [("TAG-TAN-O", 1)])
        ns.run(base)
        who = ns.who(base, "c")
        r = who.post("/api/checkout")
        assert r.status_code == 201, r.text
        _CLOCKS[base] = (who, r.json()["id"])
    who, cid = _CLOCKS[base]
    return parse_ts(who.get(f"/api/checkout/{cid}").json()["server_time"])


def recent(base: str) -> tuple[datetime, datetime]:
    now = server_now(base)
    return now - timedelta(days=3), now - timedelta(days=2)


def config(base: str) -> dict:
    r = Actor(base).get("/api/config")
    assert r.status_code == 200, r.text
    return r.json()


def stock(base: str, sku: str) -> dict:
    r = Actor(base).get(f"/api/variants/{sku}/stock")
    assert r.status_code == 200, r.text
    return r.json()


def card(number: str = GOOD_CARD, expiry: str = EXPIRY) -> dict:
    return {"number": number, "expiry": expiry, "cvc": CVC}


def ready_checkout(who: Actor, address_id: str, email: str) -> str:
    r = who.post("/api/checkout")
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    for body in ({"step": "contact", "email": email, "phone": PHONE_NO},
                 {"step": "delivery", "address_id": address_id},
                 {"step": "shipping", "method": "standard", "gift": False, "gift_message": ""}):
        step = who.patch(f"/api/checkout/{cid}", body)
        assert step.status_code == 200, f"PATCH /api/checkout {body['step']}: {step.text}"
    return cid


def place(who: Actor, cid: str, number: str | None = GOOD_CARD, key: str | None = None,
          expiry: str = EXPIRY) -> httpx.Response:
    body: dict[str, Any] = {"checkout_id": cid}
    if number is not None:
        body["card"] = card(number, expiry)
    return who.post("/api/orders", body, key=key or idempotency_key())


def admin_product(ops: Actor, slug: str) -> dict:
    r = ops.get(f"/api/admin/products/{slug}")
    assert r.status_code == 200, r.text
    return r.json()


def admin_variant(ops: Actor, slug: str, sku: str) -> dict:
    return next(v for v in admin_product(ops, slug)["variants"] if v["sku"] == sku)


def patch_variant(ops: Actor, slug: str, sku: str, **fields: Any) -> httpx.Response:
    version = admin_variant(ops, slug, sku)["version"]
    return ops.patch(f"/api/admin/variants/{sku}", {"version": version, **fields})


def set_available(ops: Actor, slug: str, sku: str, n: int) -> None:
    r = patch_variant(ops, slug, sku, stock=[{"location": "bhiwandi", "available": n}])
    assert r.status_code == 200, r.text


def admin_order(staff: Actor, number: str) -> dict:
    r = staff.get(f"/api/admin/orders/{number}")
    assert r.status_code == 200, r.text
    return r.json()


def order_status(ops: Actor, number: str, status: str) -> httpx.Response:
    return ops.post(f"/api/admin/orders/{number}/status",
                    {"version": admin_order(ops, number)["version"], "status": status})


def ship(ops: Actor, number: str, line_ids: list, tracking: str, carrier: str = "Coastline Couriers",
         version: int | None = None) -> httpx.Response:
    v = admin_order(ops, number)["version"] if version is None else version
    return ops.post(f"/api/admin/orders/{number}/shipments",
                    {"version": v, "line_ids": line_ids, "carrier": carrier, "tracking_number": tracking})


def deliver(ops: Actor, number: str, line_ids: list, tracking: str) -> None:
    assert order_status(ops, number, "packed").status_code == 200
    assert ship(ops, number, line_ids, tracking).status_code == 201
    assert order_status(ops, number, "out_for_delivery").status_code == 200
    assert order_status(ops, number, "delivered").status_code == 200


def admin_case(sup: Actor, kind: str, number: str) -> httpx.Response:
    return sup.get(f"/api/admin/{kind}/{number}")


def case_move(sup: Actor, kind: str, number: str, to: str, reason: str | None = None) -> httpx.Response:
    current = admin_case(sup, kind, number)
    assert current.status_code == 200, current.text
    body: dict[str, Any] = {"version": current.json()["version"], "to": to}
    if reason is not None:
        body["reason"] = reason
    return sup.post(f"/api/admin/{kind}/{number}/transition", body)


def walk(sup: Actor, kind: str, number: str, steps: list[str]) -> dict:
    last: dict = {}
    for to in steps:
        r = case_move(sup, kind, number, to)
        assert r.status_code == 200, f"{kind} {number} -> {to}: {r.text}"
        last = r.json()
    return last


def movements(ops: Actor, sku: str) -> list[dict]:
    r = ops.get(f"/api/admin/inventory/{sku}/movements")
    assert r.status_code == 200, r.text
    return r.json()


def balanced(groups: list[dict]) -> None:
    for g in groups:
        assert len(g["entries"]) == 2 and sum(e["quantity"] for e in g["entries"]) == 0, g


def inventory_row(ops: Actor, sku: str, low: bool = False) -> dict | None:
    path = "/api/admin/inventory?low_stock=true" if low else "/api/admin/inventory"
    r = ops.get(path)
    assert r.status_code == 200, r.text
    return next((row for row in r.json() if row["sku"] == sku), None)


def wait_indexed(base: str, products: list[Product]) -> None:
    guest = Actor(base)
    for p in products:
        eventually(lambda p=p: any(x["slug"] == p.slug for x in
                                   guest.get("/api/search", params={"q": p.name}).json().get("results", [])),
                   f"GET /api/search lists {p.slug} once its product is indexed", INDEX_WAIT_S)


def inbox(mail: Any, email: str, subject: str | None = None, expected: int = 1, seconds: float = POLL_S) -> list:
    deadline = time.monotonic() + seconds
    found: list = []
    for _ in range(1000):
        found = [m for m in mail.messages()
                 if email.lower() in [a.lower() for a in addresses(m.get("To"))]
                 and (subject is None or m.get("Subject") == subject)]
        if len(found) >= expected or time.monotonic() > deadline:
            break
    return found


def png(seed: int = 0, size: int = 4) -> bytes:
    raw = b"".join(b"\x00" + bytes([seed % 256, (seed // 256) % 256, 7]) * size for _ in range(size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def jpeg() -> bytes:
    return (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xdb\x00\x43\x00" + bytes(range(64)) + b"\xff\xd9")


def pdf(extra: bytes = b"") -> bytes:
    objects = [b"<< /Type /Catalog /Pages 2 0 R " + extra + b">>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
JS_PDF = b"/OpenAction << /S /JavaScript /JS (app.alert(1)) >> "


def upload_evidence(who: Actor, kind: str, filename: str, content: bytes, ctype: str) -> httpx.Response:
    return who.upload("/api/warranty/evidence", filename, content, ctype, {"kind": kind})


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def app_copy(**overrides: str):
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ, **overrides, APP_PUBLIC_PORT=str(port), APP_PUBLIC_URL=base)
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-4000:].decode(errors="replace")

    try:
        deadline = time.monotonic() + COPY_BOOT_S
        for _ in range(100_000):
            if proc.poll() is not None:
                pytest.fail(f"app copy exited before answering /api/health:\n{tail()}")
            with contextlib.suppress(httpx.HTTPError):
                if httpx.get(base + "/api/health", timeout=HEALTH_PROBE_S).status_code == 200:
                    break
            if time.monotonic() > deadline:
                pytest.fail(f"app copy never answered /api/health:\n{tail()}")
            pause()
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=HTTP_TIMEOUT)
        if proc.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)


MAIL_DOWN = {"SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9"}


class Live:

    def __init__(self, base: str, cookie: str | None = None, after: int | None = None):
        self.events: list[dict] = []
        self.content_type = ""
        self._cv = threading.Condition()
        self._ready = threading.Event()
        self._client = httpx.Client(timeout=httpx.Timeout(HTTP_TIMEOUT, read=None))
        headers = {"Accept": "text/event-stream"}
        if cookie:
            headers["Cookie"] = f"rh_session={cookie}"
        if after is not None:
            headers["Last-Event-ID"] = str(after)
        self._thread = threading.Thread(target=self._run, args=(base + "/api/live", headers), daemon=True)
        self._thread.start()
        assert self._ready.wait(HTTP_TIMEOUT), "GET /api/live never answered"

    def _run(self, url: str, headers: dict) -> None:
        try:
            with self._client.stream("GET", url, headers=headers) as r:
                self.content_type = r.headers.get("content-type", "")
                self._ready.set()
                current: dict = {}
                for line in r.iter_lines():
                    if not line:
                        if current:
                            self._push(current)
                        current = {}
                        continue
                    if line.startswith(":"):
                        continue
                    name, _, value = line.partition(":")
                    current[name] = value[1:] if value.startswith(" ") else value
        except Exception:
            pass
        finally:
            self._ready.set()

    def _push(self, ev: dict) -> None:
        try:
            ev["json"] = json.loads(ev.get("data", "null"))
        except ValueError:
            ev["json"] = None
        ev["t"] = time.monotonic()
        with self._cv:
            self.events.append(ev)
            self._cv.notify_all()

    def wait(self, pred: Callable[[dict], bool], what: str, seconds: float = POLL_S) -> dict:
        deadline = time.monotonic() + seconds
        with self._cv:
            for _ in range(100_000):
                hits = [e for e in self.events if pred(e)]
                if hits:
                    return hits[0]
                left = deadline - time.monotonic()
                if left <= 0:
                    break
                self._cv.wait(left)
        pytest.fail(f"GET /api/live never delivered {what}")

    def matching(self, pred: Callable[[dict], bool]) -> list[dict]:
        with self._cv:
            return [e for e in self.events if pred(e)]

    def close(self) -> None:
        self._client.close()


def is_event(kind: str, **match: Any) -> Callable[[dict], bool]:
    return lambda e: (e.get("event") == kind and isinstance(e.get("json"), dict)
                      and all(e["json"].get(k) == v for k, v in match.items()))


@contextlib.contextmanager
def ui(browser: Browser, base: str, path: str, cookie: str | None = None, size: tuple = DESKTOP,
       reduced: bool = False, device_time: datetime | None = None):
    with open_app(browser, base + "/api/health",
                  reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if cookie:
            page.context.add_cookies([{"name": "rh_session", "value": cookie, "url": base}])
        if device_time is not None:
            page.clock.set_system_time(device_time)
        page.goto(base + path)
        yield page


def page_cookie(page: Page) -> str:
    return next(c["value"] for c in page.context.cookies() if c["name"] == "rh_session")


def touch_drag(page: Page, start: tuple[float, float], end: tuple[float, float], steps: int = 8) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    x0, y0 = start
    x1, y1 = end
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
            {"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def middle(locator: Locator) -> tuple[float, float]:
    box = locator.bounding_box()
    assert box, "element has a box"
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def card_order(page: Page, products: list[Product]) -> list[str]:
    boxes = []
    for p in products:
        card_ = page.get_by_role("article", name=p.name, exact=True)
        expect(card_).to_be_visible()
        box = card_.bounding_box()
        boxes.append((round(box["y"]), box["x"], p.name))
    return [name for _, _, name in sorted(boxes)]


def slider_value(slider: Locator) -> float:
    return slider.evaluate("el => Number(el.getAttribute('aria-valuenow') ?? el.value)")


def pay_button(page: Page) -> Locator:
    return page.get_by_role("button", name=re.compile(r"^Pay ₹"))


def fill_card(page: Page, number: str) -> None:
    page.get_by_role("textbox", name="Card number").fill(number)
    page.get_by_role("textbox", name="Expiry (MM/YY)").fill(EXPIRY)
    page.get_by_role("textbox", name="Security code").fill(CVC)


def ui_steps(page: Page, email: str) -> None:
    expect(page.get_by_role("heading", level=2, name="Contact")).to_be_visible()
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_role("textbox", name="Mobile number").fill(PHONE_NO)
    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", level=2, name="Delivery")).to_be_visible()
    page.get_by_role("radiogroup", name="Saved addresses").get_by_role("radio", name="Home", exact=True).check()
    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", level=2, name="Shipping")).to_be_visible()
    page.get_by_role("radio", name="Standard").check()
    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", level=2, name="Payment")).to_be_visible()


def confirmation(page: Page) -> Locator:
    return page.get_by_role("heading", name=re.compile(r"^Thank you — order RH-\d+ is placed\.$"))


def dialog_trapped(page: Page, dialog: Locator, opener: Locator) -> None:
    expect(dialog).to_be_visible()
    inside = lambda: dialog.evaluate("d => d.contains(document.activeElement)")
    assert inside(), "focus moves inside the dialog when it opens"
    for _ in range(TAB_PRESSES):
        page.keyboard.press("Tab")
        assert inside(), "Tab past the last control wraps inside the dialog"
    for _ in range(TAB_PRESSES):
        page.keyboard.press("Shift+Tab")
        assert inside(), "Shift+Tab from the first control wraps inside the dialog"
    page.keyboard.press("Escape")
    advance(page, DRAWER_MS)
    expect(opener).to_be_focused()


def test_wf_discovery_variant_keyboard_filters(browser: Browser, app_url: str) -> None:
    ns = Ns("discover")
    a = ns.product("a", colours=("Graphite", "Sage"), sizes=(("cabin", 55, 40, 20, 2.9, 7999),
                                                            ("check-in-medium", 68, 46, 28, 3.8, 15999)))
    b = ns.product("b", sizes=(("cabin", 54, 38, 22, 2.4, 8999),))
    c = ns.product("c", colours=("Sage",), sizes=(("check-in-large", 77, 52, 31, 4.6, 18999),))
    ns.run(app_url)
    wait_indexed(app_url, [a, b, c])
    with ui(browser, app_url, f"/collections/luggage?material={slugify(a.material)}") as page:
        filters = page.get_by_role("region", name="Filters")
        for label in ("Cabin", "Graphite"):
            box = filters.get_by_role("checkbox", name=label, exact=True)
            box.focus()
            page.keyboard.press("Space")
            expect(box).to_be_checked()
        select(page.get_by_role("combobox", name="Sort by"), "Price: low to high")
        for part in ("size=cabin", "colour=graphite", "sort=price-asc"):
            expect(page).to_have_url(re.compile(re.escape(part)))
        count = page.get_by_role("status", name="Result count")
        expect(count).to_have_text("2 products")
        expect(page.get_by_role("article")).to_have_count(2)
        assert card_order(page, [a, b]) == [a.name, b.name]
        address = page.url
        page.reload()
        expect(page).to_have_url(address)
        expect(count).to_have_text("2 products")
        assert card_order(page, [a, b]) == [a.name, b.name]
        page.get_by_role("article", name=a.name, exact=True).get_by_role("link", name=a.name, exact=True).click()
        expect(page).to_have_url(re.compile(re.escape(f"/products/{a.slug}")))
        colour = page.get_by_role("radiogroup", name="Colour", exact=True)
        colour.get_by_role("radio", name="Graphite").focus()
        page.keyboard.press("ArrowRight")
        expect(colour.get_by_role("radio", name="Sage")).to_be_checked()
        size = page.get_by_role("radiogroup", name="Size", exact=True)
        size.get_by_role("radio", name="Cabin", exact=True).focus()
        page.keyboard.press("ArrowRight")
        sku = a.sku("Sage", "check-in-medium")
        expect(page.get_by_role("status", name="Selected variant")).to_have_text(selected_text(sku, 15999, "In stock"))
        expect(page).to_have_url(re.compile(f"sku={sku}"))
        gauge = page.get_by_role("group", name="Gate Gauge")
        gauge.get_by_role("radiogroup", name="Airline").get_by_role("radio", name="Monsoon Air").check()
        expect(page).to_have_url(re.compile("airline=monsoon-air"))
        fit = Actor(app_url).get("/api/fit", params={"sku": sku, "airline": "monsoon-air"}).json()
        assert fit["fits"] is False and fit["verdict"] == f"Over by {68 - 56} cm for the Monsoon Air cabin frame."
        expect(gauge.get_by_role("status", name="Fit verdict")).to_have_text(fit["verdict"])


def test_wf_discovery_variant_seed_product(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/products/meridian-spinner") as page:
        gallery = page.get_by_role("region", name="Gallery")
        tabs = gallery.get_by_role("tablist", name="Gallery views")
        tabs.get_by_role("tab", name="View 1").focus()
        page.keyboard.press("ArrowRight")
        expect(tabs.get_by_role("tab", name="View 2")).to_have_attribute("aria-selected", "true")
        advance(page, GALLERY_MS)
        expect(gallery.get_by_role("img", name=view_alt("Meridian Spinner", "Graphite", 2, 4)).first).to_be_visible()
        page.get_by_role("radiogroup", name="Colour", exact=True).get_by_role("radio", name="Sage").check()
        page.get_by_role("radiogroup", name="Size", exact=True).get_by_role("radio", name="Check-in Medium").check()
        status = page.get_by_role("status", name="Selected variant")
        expect(status).to_have_text("SKU MER-SAG-M · ₹15,999 · Only 2 left")
        expect(page).to_have_url(re.compile("sku=MER-SAG-M"))
        fit = Actor(app_url).get("/api/fit", params={"sku": "MER-SAG-M", "airline": "skyline-indus"}).json()
        assert fit["verdict"] == f"Over by {68 - 55} cm for the Skyline Indus cabin frame."
        verdict = page.get_by_role("group", name="Gate Gauge").get_by_role("status", name="Fit verdict")
        expect(verdict).to_have_text(fit["verdict"])
        page.reload()
        expect(status).to_have_text("SKU MER-SAG-M · ₹15,999 · Only 2 left")


def test_search_suggestions_facets(browser: Browser, app_url: str) -> None:
    ns = Ns("search")
    p1 = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4999),))
    p2 = ns.product("b", colours=("Sage",), sizes=(("cabin", 54, 38, 22, 2.4, 12000),))
    p3 = ns.product("c", sizes=(("check-in-medium", 68, 46, 28, 3.8, 21000),))
    ns.run(app_url)
    wait_indexed(app_url, [p1, p2, p3])
    m = slugify(p1.material)
    guest = Actor(app_url)
    body = guest.get("/api/search", params={"collection": "luggage", "material": m, "colour": "graphite"}).json()
    assert body["mode"] == "search" and body["total"] == 2
    assert {r["slug"] for r in body["results"]} == {p1.slug, p3.slug}
    facets = body["facets"]
    assert facets["colour"].get("graphite") == 2 and facets["colour"].get("sage") == 1, facets
    assert facets["size"].get("cabin") == 1 and facets["size"].get("check-in-medium") == 1, facets
    assert facets["price"].get("under-5000") == 1 and facets["price"].get("20000-plus") == 1, facets
    assert facets["material"].get(m) == 2, facets
    for q, material, slug in (("cabbin", "polycarbonate", "meridian-spinner"),
                              ("carry on", "polycarbonate", "meridian-spinner"),
                              ("suitcase", "aluminium", "atlas-aluminium")):
        hits = guest.get("/api/search", params={"q": q, "material": material}).json()["results"]
        assert slug in [h["slug"] for h in hits], f"q={q!r} should match {slug}"
    suggest = guest.get("/api/search/suggest", params={"q": f"Test {ns.code}"}).json()
    names = [s["slug"] for s in suggest["suggestions"]]
    assert len(names) <= 6 and {p1.slug, p2.slug, p3.slug} <= set(names), suggest
    with ui(browser, app_url, f"/collections/luggage?material={m}&colour=graphite") as page:
        expect(page.get_by_role("status", name="Result count")).to_have_text("2 products")
        sage = page.get_by_role("region", name="Filters").get_by_role("checkbox", name="Sage", exact=True)
        expect(sage).to_have_accessible_description(re.compile(r"\b1\b"))
        search = page.get_by_role("combobox", name="Search products")
        typed = f"Test {ns.code}"
        search.press_sequentially(typed)
        listbox = page.get_by_role("listbox", name="Suggestions")
        expect(listbox.get_by_role("option", name=p1.name)).to_be_visible()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Escape")
        expect(search).to_have_value(typed)
        search.fill("")
        search.press_sequentially("cabbin")
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/collections/all\?q=cabbin"))
        search = page.get_by_role("combobox", name="Search products")
        search.fill("")
        search.press_sequentially(typed)
        expect(page.get_by_role("listbox", name="Suggestions").get_by_role("option", name=p1.name)).to_be_visible()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile("/products/(" + "|".join(re.escape(p.slug) for p in (p1, p2, p3)) + ")"))


def test_catalogue_state_in_address(browser: Browser, app_url: str) -> None:
    ns = Ns("address")
    p1 = ns.product("a")
    p2 = ns.product("b", colours=("Sage",))
    p3 = ns.product("c", colours=("Sage",), sizes=(("check-in-medium", 68, 46, 28, 3.8, 9000),))
    ns.run(app_url)
    wait_indexed(app_url, [p1, p2, p3])
    m = slugify(p1.material)
    with ui(browser, app_url, f"/collections/luggage?material={m}") as page:
        count = page.get_by_role("status", name="Result count")
        expect(count).to_have_text("3 products")
        assert "sort=" not in page.url and "page=" not in page.url
        filters = page.get_by_role("region", name="Filters")
        depth = page.evaluate("history.length")
        filters.get_by_role("checkbox", name="Sage", exact=True).check()
        expect(page).to_have_url(re.compile("colour=sage"))
        expect(count).to_have_text("2 products")
        assert page.evaluate("history.length") == depth + 1
        filters.get_by_role("checkbox", name="Cabin", exact=True).check()
        expect(count).to_have_text("1 product")
        assert page.evaluate("history.length") == depth + 2
        page.go_back()
        expect(count).to_have_text("2 products")
        expect(filters.get_by_role("checkbox", name="Cabin", exact=True)).not_to_be_checked()
        expect(filters.get_by_role("checkbox", name="Sage", exact=True)).to_be_checked()
        page.go_back()
        expect(count).to_have_text("3 products")
        page.go_forward()
        expect(count).to_have_text("2 products")
        select(page.get_by_role("combobox", name="Sort by"), "Newest")
        expect(page).to_have_url(re.compile("sort=newest"))
        page.get_by_role("button", name=f"Compare {p2.name}").click()
        expect(page).to_have_url(re.compile(f"compare={re.escape(p2.sku())}", re.I))
        page.reload()
        expect(count).to_have_text("2 products")
        expect(page.get_by_role("button", name=f"Compare {p2.name}")).to_have_attribute("aria-pressed", "true")
        page.goto(f"{app_url}/collections/luggage?material={m}&colour=no-such-colour")
        expect(page.get_by_role("status", name="Result count")).to_have_text("3 products")


def test_variant_picker(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/products/meridian-spinner") as page:
        status = page.get_by_role("status", name="Selected variant")
        expect(status).to_have_text("SKU MER-GRA-C · ₹12,499 · In stock")
        expect(page.get_by_text("Save 17%")).to_be_visible()
        depth = page.evaluate("history.length")
        page.get_by_role("radiogroup", name="Colour", exact=True).get_by_role("radio", name="Sage").click()
        expect(status).to_have_text(selected_text("MER-SAG-C", 12499, "In stock"))
        expect(page).to_have_url(re.compile("sku=MER-SAG-C"))
        gallery = page.get_by_role("region", name="Gallery")
        expect(gallery.get_by_role("img", name=view_alt("Meridian Spinner", "Sage", 1, 4)).first).to_be_visible()
        size = page.get_by_role("radiogroup", name="Size", exact=True)
        size.get_by_role("radio", name="Cabin", exact=True).focus()
        page.keyboard.press("ArrowRight")
        expect(size.get_by_role("radio", name="Check-in Medium")).to_be_checked()
        expect(status).to_have_text("SKU MER-SAG-M · ₹15,999 · Only 2 left")
        expect(page).to_have_url(re.compile("sku=MER-SAG-M"))
        assert page.evaluate("history.length") == depth, "variant changes replace the history entry"
        page.goto(f"{app_url}/products/meridian-spinner?sku=MER-RED-L")
        expect(page.get_by_role("status", name="Selected variant")).to_have_text(selected_text("MER-RED-L", 18999, "In stock"))
        expect(page.get_by_role("radiogroup", name="Colour", exact=True).get_by_role("radio", name="Signal Red")).to_be_checked()
        expect(page.get_by_role("radiogroup", name="Size", exact=True).get_by_role("radio", name="Check-in Large")).to_be_checked()


def test_gallery(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/products/meridian-spinner") as page:
        gallery = page.get_by_role("region", name="Gallery")
        expect(gallery).to_have_attribute("data-motion-ms", str(GALLERY_MS))
        tabs = gallery.get_by_role("tablist", name="Gallery views")
        tabs.get_by_role("tab", name="View 2").click()
        expect(gallery).to_have_attribute("data-state", "sliding")
        advance(page, GALLERY_MS / 2)
        expect(gallery).to_have_attribute("data-state", "sliding")
        advance(page, GALLERY_MS / 2)
        expect(gallery).to_have_attribute("data-state", "idle")
        expect(gallery.get_by_role("img", name=view_alt("Meridian Spinner", "Graphite", 2, 4)).first).to_be_visible()
        for key, view in (("End", "View 4"), ("Home", "View 1"), ("ArrowLeft", "View 4"), ("ArrowRight", "View 1")):
            page.keyboard.press(key)
            expect(tabs.get_by_role("tab", name=view)).to_have_attribute("aria-selected", "true")
            advance(page, GALLERY_MS)
        opener = tabs.get_by_role("tab", name="View 1")
        expect(opener).to_be_focused()
        page.keyboard.press("z")
        zoom = page.get_by_role("dialog", name="Zoomed image")
        expect(zoom).to_be_visible()
        page.keyboard.press("Escape")
        expect(zoom).to_be_hidden()
        expect(opener).to_be_focused()
        button = gallery.get_by_role("button", name="Zoom image")
        button.click()
        expect(zoom).to_be_visible()
        zoom.get_by_role("button", name="Close zoom").click()
        expect(button).to_be_focused()
        x, y = middle(gallery.get_by_role("img", name=re.compile("view 1 of 4")).first)
        touch_drag(page, (x + SWIPE_MIN_PX * 2, y), (x - SWIPE_MIN_PX * 2, y))
        advance(page, GALLERY_MS)
        expect(tabs.get_by_role("tab", name="View 2")).to_have_attribute("aria-selected", "true")


def test_fit_verdict(browser: Browser, app_url: str) -> None:
    guest = Actor(app_url)
    fits = guest.get("/api/fit", params={"sku": "MER-GRA-C", "airline": "skyline-indus"}).json()
    assert fits["fits"] is True and fits["max_overhang_cm"] == 0
    assert fits["verdict"] == "Fits the Skyline Indus cabin frame."
    over = guest.get("/api/fit", params={"sku": "ATL-SIL-C", "airline": "skyline-indus"}).json()
    assert over["fits"] is False and over["max_overhang_cm"] == 3
    assert over["overhang_cm"] == {"height": 1, "width": 0, "depth": 3}
    assert over["verdict"] == "Over by 3 cm for the Skyline Indus cabin frame."
    monsoon = guest.get("/api/fit", params={"sku": "ATL-SIL-C", "airline": "monsoon-air"}).json()
    assert monsoon["verdict"] == "Over by 4 cm for the Monsoon Air cabin frame."
    assert fields_of(guest.get("/api/fit", params={"sku": "MER-GRA-C", "airline": "no-such-air"}))["airline"] == "Choose a listed airline."
    assert fields_of(guest.get("/api/fit", params={"sku": "PSW-TAN-O", "airline": "skyline-indus"}))["sku"] == "Choose a luggage, backpack or tote variant."
    with ui(browser, app_url, "/products/atlas-aluminium") as page:
        verdict = page.get_by_role("group", name="Gate Gauge").get_by_role("status", name="Fit verdict")
        expect(verdict).to_have_text(over["verdict"])
        page.goto(f"{app_url}/compare?compare=ATL-SIL-C,MER-GRA-C,PSW-TAN-O")
        table = page.get_by_role("table", name="Compare products")
        expect(table).to_contain_text(over["verdict"])
        expect(table).to_contain_text(fits["verdict"])
        expect(table).to_contain_text("No cabin fit for this item.")


def test_gate_gauge(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/products/meridian-spinner") as page:
        gauge = page.get_by_role("group", name="Gate Gauge")
        expect(gauge).to_have_attribute("data-motion-ms", str(GAUGE_MS))
        slider = gauge.get_by_role("slider", name="Bag position")
        frame = 40
        settle_value(lambda: slider_value(slider), 0, "slider starts at 0")
        expect(slider).to_have_attribute("aria-valuetext", "Outside the frame")
        slider.focus()
        page.keyboard.press("ArrowRight")
        settle_value(lambda: slider_value(slider), 1, "ArrowRight nudges 1 cm")
        page.keyboard.press("ArrowLeft")
        settle_value(lambda: slider_value(slider), 0, "ArrowLeft nudges back")
        page.keyboard.press("End")
        settle_value(lambda: slider_value(slider), GAUGE_LEAD_CM + frame, "End jumps to 20 plus the frame width")
        expect(slider).to_have_attribute(
            "aria-valuetext", re.compile(r"^(Outside the frame|Touching the frame|Inside the frame)$"))
        page.keyboard.press("Enter")
        expect(gauge).to_have_attribute("data-state", "settling")
        advance(page, GAUGE_SETTLE_MS)
        expect(gauge).to_have_attribute("data-state", "settled")
        expect(gauge).to_have_attribute("data-settled", "inside")
        cabin_h = slider.bounding_box()["height"]
        page.get_by_role("radiogroup", name="Size", exact=True).get_by_role("radio", name="Check-in Large").check()
        advance(page, GAUGE_MS)
        large_h = slider.bounding_box()["height"]
        assert abs(cabin_h / large_h - 55 / 77) < 0.03, (cabin_h, large_h)
        page.goto(f"{app_url}/products/meridian-spinner")
        gauge = page.get_by_role("group", name="Gate Gauge")
        slider = gauge.get_by_role("slider", name="Bag position")
        x, y = middle(slider)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 60, y, steps=6)
        expect(gauge).to_have_attribute("data-state", "dragging")
        page.mouse.up()
        advance(page, GAUGE_SETTLE_MS)
        expect(gauge).to_have_attribute("data-state", "settled")
        page.goto(f"{app_url}/products/atlas-aluminium")
        gauge = page.get_by_role("group", name="Gate Gauge")
        slider = gauge.get_by_role("slider", name="Bag position")
        slider.focus()
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        advance(page, GAUGE_SETTLE_MS)
        expect(gauge).to_have_attribute("data-state", "settled")
        expect(gauge).to_have_attribute("data-settled", "edge")


def test_wf_compare_wishlist_guest_to_account(browser: Browser, app_url: str) -> None:
    ns = Ns("cmpwish")
    ps = [ns.product(k) for k in ("a", "b", "c", "d")]
    ns.user("u")
    ns.run(app_url)
    wait_indexed(app_url, ps)
    account = ns.who(app_url, "u")
    assert account.put(f"/api/wishlist/{ps[0].slug}").status_code == 200
    limit = config(app_url)["compare_max"]
    path = f"/collections/all?material={slugify(ps[0].material)}"
    with ui(browser, app_url, path) as page:
        for i, p in enumerate(ps[:3]):
            btn = page.get_by_role("button", name=f"Compare {p.name}")
            if i == 0:
                btn.click()
            else:
                btn.focus()
                page.keyboard.press("Enter" if i == 1 else "Space")
            expect(btn).to_have_attribute("aria-pressed", "true")
            expect(page.get_by_role("status", name="Cart updates")).to_have_text(f"Added {p.name} to comparison.")
        fourth = page.get_by_role("button", name=f"Compare {ps[3].name}")
        fourth.click()
        expect(page.get_by_role("status", name="Cart updates")).to_have_text(f"You can compare up to {limit} products.")
        expect(fourth).to_have_attribute("aria-pressed", "false")
        page.get_by_role("link", name=f"Compare {len(ps[:3])} selected").click()
        expect(page).to_have_url(re.compile("/compare"))
        expect(page.get_by_role("table", name="Compare products")).to_be_visible()
        remove = page.get_by_role("button", name=f"Remove {ps[0].name} from comparison")
        remove.focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("status", name="Compare updates")).to_have_text(f"Removed {ps[0].name} from comparison.")
        expect(page).not_to_have_url(re.compile(re.escape(ps[0].sku()), re.I))
        page.goto(app_url + path)
        for p in ps[:2]:
            save = page.get_by_role("button", name=f"Save {p.name} to wishlist")
            save.focus()
            page.keyboard.press("Space")
            expect(save).to_have_attribute("aria-pressed", "true")
            expect(page.get_by_role("status", name="Cart updates")).to_have_text(f"Saved {p.name} to your wishlist.")
        page.reload()
        expect(page.get_by_role("link", name=wishlist_name(len(ps[:2])))).to_be_visible()
        page.goto(app_url + "/sign-in")
        page.get_by_role("textbox", name="Email").fill(ns.email("u"))
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        merged = eventually(lambda: (w := account.get("/api/wishlist").json())["count"] == 2 and w,
                            "the account wishlist holds the two guest saves without duplicates")
        assert sorted(i["slug"] for i in merged["items"]) == sorted([ps[0].slug, ps[1].slug])
        with ui(browser, app_url, "/", cookie=ns.sessions["u"]) as other:
            expect(other.get_by_role("link", name=wishlist_name(len(ps[:2])))).to_be_visible()
            page.goto(app_url + path)
            page.get_by_role("button", name=f"Save {ps[2].name} to wishlist").click()
            expect(other.get_by_role("link", name=wishlist_name(len(ps[:3])))).to_be_visible()
    assert account.get("/api/wishlist").json()["count"] == 3


def test_wf_compare_wishlist_wishlist_page(browser: Browser, app_url: str) -> None:
    ns = Ns("wishpage")
    p = ns.product("a")
    ns.run(app_url)
    wait_indexed(app_url, [p])
    with ui(browser, app_url, f"/collections/all?material={slugify(p.material)}") as page:
        page.get_by_role("button", name=f"Save {p.name} to wishlist").click()
        expect(page.get_by_role("status", name="Cart updates")).to_have_text(f"Saved {p.name} to your wishlist.")
        page.get_by_role("link", name="Wishlist, 1 item").click()
        expect(page.get_by_role("heading", level=1, name="Wishlist")).to_be_visible()
        card_ = page.get_by_role("article", name=p.name, exact=True)
        expect(card_).to_be_visible()
        card_.get_by_role("button", name=f"Save {p.name} to wishlist").click()
        expect(page.get_by_role("article", name=p.name, exact=True)).to_have_count(0)
        expect(page.get_by_text("Nothing saved yet.")).to_be_visible()
        assert Actor(app_url, page_cookie(page)).get("/api/wishlist").json()["count"] == 0


def test_comparison_set(browser: Browser, app_url: str) -> None:
    ns = Ns("compare")
    fit = ns.product("a", sizes=(("cabin", 54, 38, 20, 2.0, 6100),))
    over = ns.product("b", sizes=(("cabin", 56, 41, 21, 2.2, 6200),))
    wallet = ns.product("w", category="wallets", colours=("Tan",), sizes=(("one-size", 14, 10, 2, 0.1, 2100),))
    ns.run(app_url)
    path = f"/compare?compare={fit.sku()},{over.sku()},{wallet.sku()}"
    over_verdict = Actor(app_url).get("/api/fit", params={"sku": over.sku(), "airline": "skyline-indus"}).json()["verdict"]
    assert over_verdict == "Over by 1 cm for the Skyline Indus cabin frame."
    with ui(browser, app_url, path) as page:
        table = page.get_by_role("table", name="Compare products")
        for text in ("₹6,100", "₹6,200", "₹2,100", fit.material, "Fits the Skyline Indus cabin frame.",
                     over_verdict, "No cabin fit for this item."):
            expect(table).to_contain_text(text)
        bags = page.get_by_role("group", name="Gate Gauge").get_by_role("radiogroup", name="Bag to fit")
        expect(bags.get_by_role("radio")).to_have_count(2)
        expect(bags.get_by_role("radio", name=fit.name)).to_be_checked()
        expect(bags.get_by_role("radio", name=wallet.name)).to_have_count(0)
        page.get_by_role("button", name=f"Remove {fit.name} from comparison").click()
        expect(page.get_by_role("status", name="Compare updates")).to_have_text(f"Removed {fit.name} from comparison.")
        page.get_by_role("button", name=f"Remove {over.name} from comparison").click()
        expect(page).to_have_url(re.compile(re.escape(wallet.sku()), re.I))
        expect(page).not_to_have_url(re.compile(re.escape(over.sku()), re.I))
        expect(page.get_by_role("group", name="Gate Gauge")).to_have_count(0)
        page.reload()
        expect(page.get_by_role("table", name="Compare products")).to_contain_text("No cabin fit for this item.")
        expect(page.get_by_role("button", name=f"Remove {fit.name} from comparison")).to_have_count(0)


def test_wishlist_merge_live(browser: Browser, app_url: str) -> None:
    ns = Ns("merge")
    ps = [ns.product(k) for k in ("a", "b", "c")]
    ns.user("u")
    ns.run(app_url)
    guest = Actor(app_url)
    for p in ps[:2]:
        assert guest.put(f"/api/wishlist/{p.slug}").status_code == 200
    assert guest.put(f"/api/wishlist/{ps[0].slug}").json()["count"] == 2, "saving twice is harmless"
    account = ns.who(app_url, "u")
    account.put(f"/api/wishlist/{ps[0].slug}")
    assert Actor(app_url).get(f"/api/products/{ps[0].slug}").json()["saves"] == 2
    signed = guest.post("/api/session", {"email": ns.email("u"), "password": PASSWORD})
    assert signed.status_code == 200, signed.text
    for who in (guest, account):
        w = who.get("/api/wishlist").json()
        assert w["count"] == 2 and sorted(i["slug"] for i in w["items"]) == sorted(p.slug for p in ps[:2])
    assert Actor(app_url).get(f"/api/products/{ps[0].slug}").json()["saves"] == 1
    err(account.put("/api/wishlist/no-such-product-slug"), 404, "not_found")
    with ui(browser, app_url, "/", cookie=ns.sessions["u"]) as page:
        expect(page.get_by_role("link", name=wishlist_name(len(ps[:2])))).to_be_visible()
        account.put(f"/api/wishlist/{ps[2].slug}")
        expect(page.get_by_role("link", name=wishlist_name(len(ps[:3])))).to_be_visible()
        account.delete(f"/api/wishlist/{ps[0].slug}")
        expect(page.get_by_role("link", name=wishlist_name(len(ps[:2])))).to_be_visible()
        page.goto(app_url + "/wishlist")
        expect(page.get_by_role("article", name=ps[2].name, exact=True)).to_be_visible()
        expect(page.get_by_role("article", name=ps[0].name, exact=True)).to_have_count(0)


def _race_world(app_url: str, available: int) -> tuple[Ns, Product, list[tuple[Actor, str, str]]]:
    ns = Ns("race")
    p = ns.product("r", colours=("Signal Red",), sizes=(("cabin", 55, 40, 20, 2.9, 4999),), available=available)
    for k in ("a", "b"):
        ns.user(k)
        ns.address(f"ad-{k}", k)
        ns.cart(k, [(p.sku(), 1)])
    ns.run(app_url)
    shoppers = []
    for k in ("a", "b"):
        who = ns.who(app_url, k)
        shoppers.append((who, ready_checkout(who, ns.ids[f"ad-{k}"], ns.email(k)), k))
    return ns, p, shoppers


def _outcome(page: Page, variant: str) -> str:
    won = confirmation(page)
    lost = page.get_by_role("alert").filter(has_text=f"Sorry, the last {variant} was just taken.")
    expect(won.or_(lost).first).to_be_visible()
    return "won" if won.count() else "lost"


def test_wf_last_unit_race_two_buyers(browser: Browser, app_url: str, mail: Any) -> None:
    ns, p, shoppers = _race_world(app_url, 1)
    variant = p.label()
    with ui(browser, app_url, f"/products/{p.slug}") as watcher, \
            ui(browser, app_url, f"/checkout/{shoppers[0][1]}", cookie=ns.sessions["a"]) as pa, \
            ui(browser, app_url, f"/checkout/{shoppers[1][1]}", cookie=ns.sessions["b"]) as pb:
        expect(watcher.get_by_role("button", name="Add to bag")).to_be_enabled()
        for page in (pa, pb):
            expect(page.get_by_role("heading", level=2, name="Payment")).to_be_visible()
            fill_card(page, GOOD_CARD)
        pay_button(pa).click(no_wait_after=True)
        pay_button(pb).click(no_wait_after=True)
        results = {k: _outcome(page, variant) for k, page in (("a", pa), ("b", pb))}
        assert sorted(results.values()) == ["lost", "won"], results
        loser = pa if results["a"] == "lost" else pb
        winner_page = pb if loser is pa else pa
        expect(loser.get_by_role("alert").filter(has_text=f"Sorry, the last {variant} was just taken.")).to_be_focused()
        expect(confirmation(winner_page)).to_be_focused()
        expect(loser.get_by_text("Out of stock").first).to_be_visible()
        expect(watcher.get_by_role("status", name="Product updates")).to_have_text("Out of stock")
        add = watcher.get_by_role("button", name="Add to bag")
        expect(add).to_be_disabled()
        expect(add).to_have_text("Out of stock")
    assert stock(app_url, p.sku()) == {"sku": p.sku(), "available": 0, "badge": "Out of stock"}
    placed = {k: who.get("/api/orders").json() for who, _, k in shoppers}
    winner = next(k for k, v in results.items() if v == "won")
    assert len(placed[winner]) == 1 and placed[next(k for k in placed if k != winner)] == []
    number = placed[winner][0]["number"]
    assert len(inbox(mail, ns.email(winner), f"Your Roam House order {number} is placed")) == 1


def test_wf_last_unit_race_two_left(browser: Browser, app_url: str) -> None:
    ns, p, shoppers = _race_world(app_url, 2)
    with ui(browser, app_url, f"/products/{p.slug}") as watcher, \
            ui(browser, app_url, f"/checkout/{shoppers[0][1]}", cookie=ns.sessions["a"]) as pa, \
            ui(browser, app_url, f"/checkout/{shoppers[1][1]}", cookie=ns.sessions["b"]) as pb:
        expect(watcher.get_by_role("status", name="Selected variant")).to_have_text(
            selected_text(p.sku(), 4999, "Only 2 left"))
        for page in (pa, pb):
            fill_card(page, GOOD_CARD)
        pay_button(pa).click(no_wait_after=True)
        pay_button(pb).click(no_wait_after=True)
        expect(confirmation(pa)).to_be_visible()
        expect(confirmation(pb)).to_be_visible()
        expect(watcher.get_by_role("button", name="Add to bag")).to_have_text("Out of stock")
    assert all(len(who.get("/api/orders").json()) == 1 for who, _, _ in shoppers)
    assert stock(app_url, p.sku())["available"] == 0


def test_holds_race_and_lapse(app_url: str) -> None:
    ns = Ns("holds")
    last = ns.product("a", available=1)
    pair = ns.product("b", available=2)
    split = ns.product("c", available=3)
    lapsed = ns.product("d", available=2)
    shoppers = [ns.user(f"s{i}") for i in range(5)]
    for s in shoppers:
        ns.address(f"ad-{s}", s)
        ns.cart(s, [(last.sku(), 1)])
    for k in ("x", "y"):
        ns.user(k)
        ns.address(f"ad-{k}", k)
        ns.cart(k, [(split.sku(), 1), (pair.sku(), 2)] if k == "x" else [(split.sku(), 1), (pair.sku(), 1)])
    ns.user("late")
    ns.user("ops", "operations")
    ttl = config(app_url)["reservation_ttl_seconds"]
    ns.hold("h1", "late", [(lapsed.sku(), 2)], server_now(app_url) - timedelta(seconds=ttl + 60))
    ns.run(app_url)
    checkouts = [(ns.who(app_url, s), ready_checkout(ns.who(app_url, s), ns.ids[f"ad-{s}"], ns.email(s))) for s in shoppers]
    results = together([lambda a=a, c=c: a.post(f"/api/checkout/{c}/reserve") for a, c in checkouts])
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409, 409], [r.text for r in results]
    for r in results:
        if r.status_code == 409:
            body = err(r, 409, "out_of_stock", f"Sorry, the last {last.label()} was just taken.")
            assert body["sku"] == last.sku() and body["available"] == 0
    (who, cid), first = next(((a, c), r) for (a, c), r in zip(checkouts, results) if r.status_code == 200)
    again = who.post(f"/api/checkout/{cid}/reserve")
    assert again.status_code == 200 and again.json()["hold"]["expires_at"] == first.json()["hold"]["expires_at"]
    assert stock(app_url, last.sku())["available"] == 0
    x, y = ns.who(app_url, "x"), ns.who(app_url, "y")
    cx = ready_checkout(x, ns.ids["ad-x"], ns.email("x"))
    cy = ready_checkout(y, ns.ids["ad-y"], ns.email("y"))
    assert y.post(f"/api/checkout/{cy}/reserve").status_code == 200
    err(x.post(f"/api/checkout/{cx}/reserve"), 409, "out_of_stock", "Only 1 left — we updated your bag.")
    assert stock(app_url, split.sku())["available"] == 2, "a refused hold holds no line"
    assert stock(app_url, lapsed.sku())["available"] == 2, "reading stock releases a lapsed hold"
    reasons = [m["reason"] for m in movements(ns.who(app_url, "ops"), lapsed.sku())]
    assert "hold_lapsed" in reasons
    late = ns.who(app_url, "late")
    err(late.post("/api/orders", {"checkout_id": ns.ids["h1"], "card": card()}, key=idempotency_key()),
        409, "reservation_expired")
    assert late.get("/api/orders").json() == []


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0",
                    "OFL-1.1"}
SECRET_ENV = ("GRADING_TOKEN", "S3_SECRET_ACCESS_KEY", "MEILISEARCH_API_KEY", "S3_ACCESS_KEY_ID")


def sent_to(mail: Any, email: str, subject: str | None = None) -> list:
    return [m for m in mail.messages() if email.lower() in [a.lower() for a in addresses(m.get("To"))]
            and (subject is None or m.get("Subject") == subject)]


def latest_number(who: Actor, path: str) -> str:
    items = who.get(path).json()
    assert items, f"GET {path} listed nothing"
    return max(items, key=lambda i: int(i["number"].split("-")[1]))["number"]


def buy(who: Actor, address_id: str, email: str, number: str = GOOD_CARD) -> dict:
    r = place(who, ready_checkout(who, address_id, email), number)
    assert r.status_code == 201, r.text
    return r.json()


def half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def login(base: str, email: str, password: str) -> Actor:
    who = Actor(base)
    r = who.post("/api/session", {"email": email, "password": password})
    assert r.status_code == 200, r.text
    return who


def seed_ops(base: str) -> Actor:
    return login(base, "ops@roamhouse.example", "ops-priya-03")


def chooser_upload(page: Page, button: Locator, name: str, ctype: str, content: bytes) -> None:
    with page.expect_file_chooser() as chooser:
        button.press("Enter")
    chooser.value.set_files(files=[{"name": name, "mimeType": ctype, "buffer": content}])


def motion_of(page: Page) -> str | None:
    return page.evaluate("document.querySelector('[data-motion]')?.getAttribute('data-motion')")


def outline_ok(locator: Locator) -> bool:
    _, focused = state_styles(locator, "outline-width", "outline-style", "box-shadow", state="focus")
    width = float(focused["outline-width"].replace("px", "") or 0)
    return (focused["outline-style"] != "none" and width >= FOCUS_RING_PX) or focused["box-shadow"] != "none"


def test_stock_ledger_and_counts(app_url: str) -> None:
    ns = Ns("ledger")
    p = ns.product("a", available=4)
    ns.user("ops", "operations")
    ns.user("u")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    ops, who, sku = ns.who(app_url, "ops"), ns.who(app_url, "u"), p.sku()
    threshold = config(app_url)["low_stock_threshold"]
    row = inventory_row(ops, sku)
    assert row["available"] == 4 and row["on_hand"] == 4
    up = threshold + 3
    set_available(ops, p.slug, sku, up)
    newest = movements(ops, sku)[0]
    assert newest["reason"] == "stock_received"
    assert sorted((e["account"], e["quantity"]) for e in newest["entries"]) == [("available", up - 4), ("external", 4 - up)]
    assert stock(app_url, sku) == {"sku": sku, "available": up, "badge": "In stock"}
    set_available(ops, p.slug, sku, threshold)
    newest = movements(ops, sku)[0]
    assert newest["reason"] == "stock_adjusted"
    assert sorted((e["account"], e["quantity"]) for e in newest["entries"]) == [("available", -3), ("external", 3)]
    assert stock(app_url, sku)["badge"] == f"Only {threshold} left"
    cid = ready_checkout(who, ns.ids["ad"], ns.email("u"))
    assert who.post(f"/api/checkout/{cid}/reserve").status_code == 200
    row = inventory_row(ops, sku)
    assert (row["available"], row["on_hand"]) == (threshold - 1, threshold)
    assert sum(loc["reserved"] for loc in row["locations"]) == 1
    held_move = next(m for m in movements(ops, sku) if m["reason"] == "hold_placed")
    assert sorted((e["account"], e["quantity"]) for e in held_move["entries"]) == [("available", -1), ("reserved", 1)]
    balanced(movements(ops, sku))
    assert stock(app_url, sku)["available"] == threshold - 1
    assert who.get("/api/cart").json()["count"] == 1
    assert row["available"] == sum(loc["available"] for loc in row["locations"])
    set_available(ops, p.slug, sku, 0)
    assert stock(app_url, sku)["badge"] == "Out of stock"
    assert inventory_row(ops, sku, low=True) is not None


def test_wf_checkout_recovery_full(browser: Browser, app_url: str, mail: Any) -> None:
    ns = Ns("cofull")
    p = ns.product("a")
    ns.user("u")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    who, email = ns.who(app_url, "u"), ns.email("u")
    cid = who.post("/api/checkout").json()["id"]
    with ui(browser, app_url, f"/checkout/{cid}", cookie=ns.sessions["u"], device_time=FUTURE_DEVICE_TIME) as page:
        expect(page.get_by_role("heading", level=2, name="Contact")).to_be_visible()
        page.get_by_role("textbox", name="Email").fill("not-an-email")
        page.get_by_role("textbox", name="Mobile number").fill(PHONE_NO)
        page.get_by_role("button", name="Continue").click()
        expect(page.get_by_role("alert").filter(has_text="There is a problem")).to_be_visible()
        expect(page.get_by_text("Enter an email address like name@example.com.").first).to_be_visible()
        expect(page.get_by_role("textbox", name="Email")).to_be_focused()
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("button", name="Continue").click()
        expect(page.get_by_role("heading", level=2, name="Delivery")).to_be_focused()
        expect(page.get_by_role("status", name="Checkout updates")).to_have_text("Step 2 of 4: Delivery")
        expect(page.get_by_role("region", name="Bag totals")).to_have_attribute("data-motion-ms", "180")
        page.reload()
        expect(page.get_by_role("heading", level=2, name="Delivery")).to_be_visible()
        progress = page.get_by_role("list", name="Checkout progress").get_by_role("listitem")
        expect(progress.filter(has_text="Delivery")).to_have_attribute("aria-current", "step")
        page.get_by_role("radiogroup", name="Saved addresses").get_by_role("radio", name="Home", exact=True).check()
        page.get_by_role("button", name="Continue").click()
        page.get_by_role("radio", name="Standard").check()
        page.get_by_role("button", name="Continue").click()
        expect(page.get_by_role("heading", level=2, name="Payment")).to_be_visible()
        fill_card(page, DECLINE_CARD)
        pay_button(page).click()
        expect(page.get_by_role("alert").filter(has_text=MSG["card_declined"])).to_be_focused()
        expect(page.get_by_role("heading", level=2, name="Payment")).to_be_visible()
        expect(page.get_by_role("timer", name="Hold time left")).to_have_text(re.compile(r"^Held for \d+:\d\d$"))
        assert who.get("/api/orders").json() == []
        fill_card(page, GOOD_CARD)
        pay_button(page).click()
        expect(confirmation(page)).to_be_focused()
        expect(page.get_by_text(f"Confirmation emailed to {email}.")).to_be_visible()
    orders = who.get("/api/orders").json()
    assert len(orders) == 1
    assert len(inbox(mail, email, f"Your Roam House order {orders[0]['number']} is placed")) == 1


def test_wf_checkout_recovery_double_pay(browser: Browser, app_url: str) -> None:
    ns = Ns("codouble")
    p = ns.product("a")
    ns.user("u")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    who = ns.who(app_url, "u")
    cid = who.post("/api/checkout").json()["id"]
    with ui(browser, app_url, f"/checkout/{cid}", cookie=ns.sessions["u"]) as page:
        ui_steps(page, ns.email("u"))
        fill_card(page, GOOD_CARD)
        with held(page, "**/api/orders") as gate:
            pay_button(page).click(no_wait_after=True)
            paying = page.get_by_role("button", name="Paying")
            expect(paying).to_be_disabled()
            paying.click(force=True, no_wait_after=True)
            gate.release()
        expect(confirmation(page)).to_be_visible()
    assert len(who.get("/api/orders").json()) == 1


def test_bag_edit_undo_and_drawer(browser: Browser, app_url: str) -> None:
    ns = Ns("bag")
    a = ns.product("a")
    b = ns.product("b", colours=("Sage",))
    c = ns.product("c", available=2)
    ns.user("u")
    ns.cart("u", [(a.sku(), 1), (b.sku(), 1)])
    ns.run(app_url)
    who = ns.who(app_url, "u")
    undo = config(app_url)["cart_undo_seconds"]
    clamp = who.post("/api/cart/lines", {"sku": c.sku(), "quantity": 5})
    assert clamp.status_code == 200 and "Only 2 left — we updated your bag." in clamp.json()["notices"]
    assert next(x for x in clamp.json()["lines"] if x["sku"] == c.sku())["quantity"] == 2
    line_c = next(x for x in clamp.json()["lines"] if x["sku"] == c.sku())
    assert who.delete(f"/api/cart/lines/{line_c['id']}").status_code == 200
    with ui(browser, app_url, "/bag", cookie=ns.sessions["u"]) as page:
        qty = page.get_by_role("group", name=a.label()).get_by_role("spinbutton", name="Quantity", exact=True)
        qty.focus()
        page.keyboard.press("ArrowUp")
        expect(page.get_by_role("button", name=f"Bag, {3} items")).to_be_visible()
        expect(page.get_by_role("status", name="Cart updates")).to_have_text("Quantity updated to 2.")
        totals = page.get_by_role("region", name="Bag totals")
        expect(totals).to_have_attribute("data-motion-ms", str(TOTALS_MS))
        expect(totals).to_contain_text(inr(who.get("/api/cart").json()["totals"]["total"]))
        page.get_by_role("button", name=f"Remove {b.name}").click()
        expect(page.get_by_role("status", name="Cart updates")).to_have_text(
            f"Removed {b.name}. Undo available for {undo} seconds.")
        expect(page.get_by_role("group", name=b.label())).to_have_count(0)
        page.get_by_role("button", name="Undo").click()
        expect(page.get_by_role("status", name="Cart updates")).to_have_text(f"Restored {b.name}.")
        expect(page.get_by_role("group", name=b.label())).to_be_visible()
        restored = next(x for x in who.get("/api/cart").json()["lines"] if x["sku"] == b.sku())
        assert restored["quantity"] == 1
        page.get_by_role("button", name=f"Remove {b.name}").click()
        expect(page.get_by_role("button", name="Undo")).to_be_visible()
        advance(page, undo * 1000 + 1000)
        expect(page.get_by_role("button", name="Undo")).to_have_count(0)
        assert all(x["sku"] != b.sku() for x in who.get("/api/cart").json()["lines"])
        page.get_by_role("button", name=re.compile(r"^Bag, ")).click()
        drawer = page.get_by_role("dialog", name="Your bag")
        expect(drawer).to_have_attribute("data-motion-ms", str(DRAWER_MS))
        expect(drawer).to_have_attribute("data-state", "opening")
        advance(page, DRAWER_MS)
        expect(drawer).to_have_attribute("data-state", "open")
        page.keyboard.press("Escape")
        expect(drawer).to_have_attribute("data-state", "closing")
        advance(page, DRAWER_MS)
        expect_closed(page, "Your bag")


def test_totals_published_order(app_url: str) -> None:
    ns = Ns("totals")
    cheap = ns.product("c", sizes=(("cabin", 55, 40, 20, 2.9, 4999),))
    exact = ns.product("e", sizes=(("cabin", 55, 40, 20, 2.9, FREE_SHIP),))
    for k in ("u1", "u2", "u3", "u4", "u5"):
        ns.user(k)
    ns.address("ad3", "u3")
    ns.cart("u1", [("MER-GRA-C", 1), ("PCK-SAG-O", 1)], discount="TRAVEL10")
    ns.cart("u2", [("TAG-TAN-O", 1)])
    ns.cart("u3", [(cheap.sku(), 1)])
    ns.cart("u4", [(exact.sku(), 1)])
    ns.cart("u5", [("MER-GRA-C", 1), ("PCK-SAG-O", 1)], discount="SAVE300")
    ns.run(app_url)
    t1 = ns.who(app_url, "u1").get("/api/cart").json()["totals"]
    assert (t1["subtotal"], t1["discount"], t1["shipping"], t1["tax"], t1["gift_card"], t1["total"]) == (13744, 1375, 0, 2227, 0, 14596)
    u1 = ns.who(app_url, "u1")
    applied = u1.post("/api/cart/codes", {"code": "RHGC-2000-ALFA"})
    assert applied.status_code == 200
    t1 = applied.json()["totals"]
    assert (t1["gift_card"], t1["total"]) == (2000, 12596)
    u2 = ns.who(app_url, "u2")
    t2 = u2.get("/api/cart").json()["totals"]
    assert (t2["subtotal"], t2["shipping"], t2["tax"], t2["total"]) == (980, 249, 221, 1450)
    gifted = u2.post("/api/cart/codes", {"code": "RHGC-2000-ALFA"}).json()
    assert gifted["gift_card"]["balance"] - gifted["totals"]["gift_card"] == 550
    assert gifted["totals"]["total"] == 0
    assert ns.who(app_url, "u3").get("/api/cart").json()["totals"]["shipping"] == 249
    assert ns.who(app_url, "u4").get("/api/cart").json()["totals"]["shipping"] == 0
    fixed = ns.who(app_url, "u5").get("/api/cart").json()
    assert [x["line_discount"] for x in fixed["lines"]] == [273, 27] and fixed["totals"]["discount"] == 300
    u3 = ns.who(app_url, "u3")
    cid = u3.post("/api/checkout").json()["id"]
    for body in ({"step": "contact", "email": ns.email("u3"), "phone": PHONE_NO},
                 {"step": "delivery", "address_id": ns.ids["ad3"]},
                 {"step": "shipping", "method": "express", "gift": False, "gift_message": ""}):
        assert u3.patch(f"/api/checkout/{cid}", body).status_code == 200
    cart = u3.get("/api/cart").json()
    assert cart["shipping_method"] == "express"
    assert (cart["totals"]["shipping"], cart["totals"]["tax"], cart["totals"]["total"]) == (499, 990, 6488)


def test_checkout_steps_server_draft(app_url: str) -> None:
    ns = Ns("steps")
    p = ns.product("a")
    ns.user("u")
    ns.user("v")
    ns.address("ad", "u")
    ns.address("av", "v")
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    who, other = ns.who(app_url, "u"), ns.who(app_url, "v")
    assert fields_of(other.post("/api/checkout"))["cart"] == "Your bag is empty."
    created = who.post("/api/checkout")
    assert created.status_code == 201
    cid = created.json()["id"]
    assert created.json()["step"].lower() == "contact"
    bad = fields_of(who.patch(f"/api/checkout/{cid}", {"step": "contact", "email": "nope", "phone": "123"}))
    assert bad["email"] == "Enter an email address like name@example.com."
    assert bad["phone"] == "Enter a 10-digit mobile number."
    ok = who.patch(f"/api/checkout/{cid}", {"step": "contact", "email": ns.email("u"), "phone": PHONE_NO})
    assert ok.status_code == 200 and ok.json()["step"].lower() == "delivery"
    err(who.patch(f"/api/checkout/{cid}", {"step": "delivery", "address_id": ns.ids["av"]}), 404, "not_found")
    f = fields_of(who.patch(f"/api/checkout/{cid}", {"step": "delivery", "address": {
        "name": "", "line1": "", "line2": "x" * 101, "city": "", "state": "", "postcode": "12", "phone": "1"}}))
    assert f["address.name"] == "Enter the recipient's full name."
    assert f["address.line1"] == "Enter the first line of the address."
    assert f["address.line2"] == "Keep address line 2 to 100 characters or fewer."
    assert f["address.city"] == "Enter a town or city."
    assert f["address.state"] == "Choose a state."
    assert f["address.postcode"] == "Enter a 6-digit PIN code."
    assert f["address.phone"] == "Enter a 10-digit mobile number."
    assert who.patch(f"/api/checkout/{cid}", {"step": "delivery", "address_id": ns.ids["ad"]}).status_code == 200
    f = fields_of(who.patch(f"/api/checkout/{cid}", {"step": "shipping", "method": "fast", "gift": True,
                                                    "gift_message": "g" * 201}))
    assert f["method"] == "Choose a shipping method."
    assert f["gift_message"] == "Keep the gift message to 200 characters or fewer."
    done = who.patch(f"/api/checkout/{cid}", {"step": "shipping", "method": "standard", "gift": False, "gift_message": ""})
    assert done.json()["step"].lower() == "payment"
    assert who.get(f"/api/checkout/{cid}").json()["step"].lower() == "payment"
    back = who.patch(f"/api/checkout/{cid}", {"step": "shipping", "go": True})
    assert back.status_code == 200 and back.json()["step"].lower() == "shipping"
    kept = who.get(f"/api/checkout/{cid}").json()
    assert ns.email("u") in json.dumps(kept["contact"]) and "411001" in json.dumps(kept["delivery"])
    err(other.get(f"/api/checkout/{cid}"), 404, "not_found")


def test_payment_outcomes(app_url: str) -> None:
    ns = Ns("pay")
    p = ns.product("a", available=5)
    ns.user("u")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    who = ns.who(app_url, "u")
    cid = ready_checkout(who, ns.ids["ad"], ns.email("u"))
    before = stock(app_url, p.sku())["available"]
    err(place(who, cid, DECLINE_CARD), 402, "card_declined")
    assert who.get("/api/orders").json() == []
    assert who.get(f"/api/checkout/{cid}").json()["hold"]["status"] == "active"
    assert stock(app_url, p.sku())["available"] == before - 1
    err(place(who, cid, NOFUNDS_CARD), 402, "insufficient_funds")
    assert fields_of(place(who, cid, GOOD_CARD, expiry=PAST_EXPIRY))["card.expiry"] == "Enter an expiry date in the future, as MM/YY."
    assert fields_of(place(who, cid, "1234"))["card.number"] == "Enter a 16-digit card number."
    short = who.post("/api/orders", {"checkout_id": cid, "card": {"number": GOOD_CARD, "expiry": EXPIRY, "cvc": "12"}},
                     key=idempotency_key())
    assert fields_of(short)["card.cvc"] == "Enter the 3-digit security code."
    total = who.get(f"/api/checkout/{cid}").json()["totals"]["total"]
    ok = place(who, cid, OTHER_CARD)
    assert ok.status_code == 201, ok.text
    payment = ok.json()["payment"]
    assert payment["card_last4"] == OTHER_CARD[-4:] and payment["card_amount"] == total and payment["amount"] == total
    assert len(who.get("/api/orders").json()) == 1


def test_placement_all_or_nothing_mail_down(app_url: str, mail: Any) -> None:
    ns = Ns("mailfail")
    p = ns.product("a")
    code = ns.gift("A", 500)
    ns.user("u")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 1)], gift=code)
    ns.run(app_url)
    who, ops, email = ns.who(app_url, "u"), ns.who(app_url, "ops"), ns.email("u")
    cid = ready_checkout(who, ns.ids["ad"], email)
    mail.clear()
    with app_copy(**MAIL_DOWN) as down:
        err(Actor(down, ns.sessions["u"]).post("/api/orders", {"checkout_id": cid, "card": card()}, key=idempotency_key()),
            503, "email_unavailable")
    assert who.get("/api/orders").json() == []
    assert who.get(f"/api/gift-cards/{code}").json()["balance"] == 500
    assert who.get(f"/api/checkout/{cid}").json()["hold"]["status"] == "active"
    assert "order_committed" not in [m["reason"] for m in movements(ops, p.sku())]
    assert sent_to(mail, email) == []
    ok = place(who, cid, GOOD_CARD)
    assert ok.status_code == 201, ok.text
    assert who.get(f"/api/gift-cards/{code}").json()["balance"] == 0
    assert "order_committed" in [m["reason"] for m in movements(ops, p.sku())]
    assert len(inbox(mail, email, f"Your Roam House order {ok.json()['number']} is placed")) == 1


def test_place_order_exactly_once(app_url: str, mail: Any) -> None:
    ns = Ns("once")
    p = ns.product("a", available=5)
    ns.user("v")
    ns.address("av", "v")
    ns.cart("v", [(p.sku(), 1)])
    ns.user("u")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    who, email = ns.who(app_url, "u"), ns.email("u")
    cid = ready_checkout(who, ns.ids["ad"], email)
    before = stock(app_url, p.sku())["available"]
    key = idempotency_key()
    first = together([lambda: place(who, cid, GOOD_CARD, key=key) for _ in range(2)])
    assert [r.status_code for r in first] == [201, 201], [r.text for r in first]
    number = first[0].json()["number"]
    assert first[1].json()["number"] == number
    again = place(who, cid, GOOD_CARD, key=key)
    assert again.status_code == 201 and again.json()["number"] == number
    assert again.headers.get("Idempotency-Replayed") == "true"
    err(place(who, cid, OTHER_CARD, key=key), 409, "idempotency_mismatch")
    fresh = ns.who(app_url, "v")
    body = {"checkout_id": ready_checkout(fresh, ns.ids["av"], ns.email("v")), "card": card()}
    assert fields_of(fresh.post("/api/orders", body))["Idempotency-Key"] == "Send an Idempotency-Key of 8 to 128 characters."
    assert "Idempotency-Key" in fields_of(fresh.post("/api/orders", body, key="short"))
    assert len(who.get("/api/orders").json()) == 1
    assert stock(app_url, p.sku())["available"] == before - 1
    assert len(inbox(mail, email, f"Your Roam House order {number} is placed")) == 1


def test_wf_codes_giftcards_refusals_then_pay(browser: Browser, app_url: str) -> None:
    ns = Ns("codes")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 6000),))
    gift = ns.gift("A", 20000)
    ns.user("u")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    who = ns.who(app_url, "u")
    cases = [(f"NOPE{ns.code}", re.compile("^" + re.escape(MSG["code_invalid"]) + "$")),
             ("SPRING15", re.compile(r"^This code expired on .+\.$")),
             ("LAUNCH25", re.compile("^" + re.escape(MSG["code_exhausted"]) + "$")),
             ("DUFFEL20", re.compile("^" + re.escape(MSG["code_not_applicable"]) + "$")),
             ("BIG1500", re.compile("^" + re.escape(f"Add {inr(14000)} more to use this code.") + "$"))]
    with ui(browser, app_url, "/bag", cookie=ns.sessions["u"]) as page:
        box = page.get_by_role("textbox", name="Discount or gift card code")
        for code, message in cases:
            box.fill(code)
            box.press("Enter")
            expect(page.get_by_text(message).first).to_be_visible()
            expect(box).to_be_focused()
            expect(box).to_have_attribute("aria-describedby", re.compile(r".+"))
            assert who.get("/api/cart").json()["discount"] is None
        box.fill("TRAVEL10")
        box.press("Enter")
        expect(page.get_by_role("status", name="Cart updates")).to_have_text("Code TRAVEL10 applied.")
        discount = who.get("/api/cart").json()["totals"]["discount"]
        expect(page.get_by_role("region", name="Bag totals")).to_contain_text(f"-{inr(discount)}")
        box.fill(gift)
        box.press("Enter")
        expect(page.get_by_role("status", name="Cart updates")).to_have_text(
            f"Gift card ending {gift[-4:]} applied. Balance {inr(20000)}.")
        cart = who.get("/api/cart").json()
        remainder = cart["gift_card"]["balance"] - cart["totals"]["gift_card"]
        expect(page.get_by_text(f"Gift card balance after this order: {inr(remainder)}")).to_be_visible()
    cid = ready_checkout(who, ns.ids["ad"], ns.email("u"))
    ok = place(who, cid, None)
    assert ok.status_code == 201, ok.text
    payment = ok.json()["payment"]
    assert payment["card_amount"] == 0 and payment["gift_card_amount"] == cart["totals"]["gift_card"]
    assert who.get(f"/api/gift-cards/{gift}").json()["balance"] == remainder


def test_wf_codes_giftcards_zero_amount(browser: Browser, app_url: str) -> None:
    ns = Ns("zero")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 2500),))
    spent = ns.gift("Z", 0)
    big = ns.gift("B", 20000)
    ns.user("u")
    ns.user("w")
    ns.address("ad", "w")
    ns.cart("u", [(p.sku(), 1)])
    ns.cart("w", [(p.sku(), 1)], gift=big)
    ns.run(app_url)
    err(ns.who(app_url, "u").post("/api/cart/codes", {"code": spent}), 409, "already_redeemed",
        "This gift card has already been used. Its balance is now ₹0.")
    err(Actor(app_url).post("/api/cart/codes", {"code": big}), 401, "unauthenticated")
    err(ns.who(app_url, "u").post("/api/cart/codes", {"code": "RHGC-NOPE-NOPE"}), 422, "code_invalid")
    who = ns.who(app_url, "w")
    cid = ready_checkout(who, ns.ids["ad"], ns.email("w"))
    with ui(browser, app_url, f"/checkout/{cid}", cookie=ns.sessions["w"]) as page:
        expect(page.get_by_role("heading", level=2, name="Payment")).to_be_visible()
        expect(page.get_by_role("textbox", name="Card number")).to_have_count(0)
        page.get_by_role("button", name="Pay ₹0").click()
        expect(confirmation(page)).to_be_visible()
    order = who.get("/api/orders").json()
    assert len(order) == 1
    assert who.get(f"/api/orders/{order[0]['number']}").json()["payment"]["card_amount"] == 0


def test_discount_code_precedence(app_url: str) -> None:
    ns = Ns("prec")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),))
    ns.user("u")
    future = ns.discount("F", starts="2090-01-01T00:00:00Z")
    expired = ns.discount("E", ends="2026-03-10T12:00:00Z", usage_limit=1, used=1)
    exhausted = ns.discount("X", collection="wallets", usage_limit=1, used=1)
    nothing = ns.discount("N", collection="wallets", minimum=99999)
    minimum = ns.discount("M", minimum=20000)
    good = ns.discount("G")
    fixed = ns.discount("H", kind="fixed", value=300)
    drop = ns.discount("D", minimum=7000)
    ns.cart("u", [(p.sku(), 2)])
    ns.run(app_url)
    who = ns.who(app_url, "u")
    apply = lambda c: who.post("/api/cart/codes", {"code": c})
    err(apply(future), 422, "code_invalid")
    err(apply(expired), 422, "code_expired",
        f"This code expired on {long_date(datetime(2026, 3, 10, 12, tzinfo=timezone.utc))}.")
    err(apply(exhausted), 422, "code_exhausted")
    err(apply(nothing), 422, "code_not_applicable")
    err(apply(minimum), 422, "minimum_not_met", f"Add {inr(12000)} more to use this code.")
    assert fields_of(apply(""))["code"] == "Enter a code."
    ok = apply(f"  {good.lower()} ")
    assert ok.status_code == 200 and ok.json()["discount"]["code"] == good
    assert apply(fixed).json()["discount"]["code"] == fixed
    assert apply(drop).status_code == 200
    line = who.get("/api/cart").json()["lines"][0]
    cut = who.patch(f"/api/cart/lines/{line['id']}", {"quantity": 1}).json()
    assert cut["discount"] is None and f"Code {drop} no longer applies and was removed." in cut["notices"]
    assert apply(good).status_code == 200
    assert who.delete("/api/cart/discount").json()["discount"] is None


def test_gift_card_ledger_and_race(app_url: str) -> None:
    ns = Ns("giftrace")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),), available=5)
    code = ns.gift("R", RACE_BALANCE)
    ns.user("ops", "operations")
    for k in ("a", "b"):
        ns.user(k)
        ns.address(f"ad-{k}", k)
        ns.cart(k, [(p.sku(), 1)], gift=code)
    ns.run(app_url)
    ops = ns.who(app_url, "ops")
    shoppers = [(ns.who(app_url, k), ready_checkout(ns.who(app_url, k), ns.ids[f"ad-{k}"], ns.email(k))) for k in ("a", "b")]
    results = together([lambda w=w, c=c: place(w, c, GOOD_CARD) for w, c in shoppers])
    assert sorted(r.status_code for r in results) == [201, 409], [r.text for r in results]
    loser = next(r for r in results if r.status_code == 409)
    err(loser, 409, "already_redeemed", "This gift card has already been used. Its balance is now ₹0.")
    winner_idx = next(i for i, r in enumerate(results) if r.status_code == 201)
    winner, loser_who = shoppers[winner_idx][0], shoppers[1 - winner_idx][0]
    number = results[winner_idx].json()["number"]
    assert loser_who.get("/api/orders").json() == []

    def ledger() -> dict:
        r = ops.get(f"{ADMIN}/gift-cards/{code}")
        assert r.status_code == 200, r.text
        body = r.json()
        groups: dict[str, list] = {}
        for e in body["entries"]:
            groups.setdefault(e["group_id"], []).append(e)
        assert all(len(g) == 2 and sum(x["amount"] for x in g) == 0 for g in groups.values()), body
        card_sum = sum(e["amount"] for e in body["entries"] if e["account"] != "issuance" and not e["account"].startswith("order:"))
        assert body["balance"] == card_sum, body
        return body

    spent = ledger()
    assert spent["balance"] == 0 and [e for e in spent["entries"] if e["account"] == f"order:{number}"]
    assert winner.post(f"/api/orders/{number}/cancel").status_code == 200
    refunded = ledger()
    assert refunded["balance"] == RACE_BALANCE and len({e["group_id"] for e in refunded["entries"]}) == 3


def test_wf_live_admin_stock_price_live_page(browser: Browser, app_url: str) -> None:
    ns = Ns("liveadm")
    p = ns.product("a", available=8)
    ns.user("m1", "operations")
    ns.user("m2", "operations")
    ns.run(app_url)
    m1, m2, sku = ns.who(app_url, "m1"), ns.who(app_url, "m2"), p.sku()
    with ui(browser, app_url, f"/products/{p.slug}") as page:
        assert patch_variant(m1, p.slug, sku, price=4500).status_code == 200
        expect(page.get_by_role("status", name="Product updates")).to_have_text(f"Price updated to {inr(4500)}.")
        expect(page.get_by_role("status", name="Selected variant")).to_have_text(selected_text(sku, 4500, "In stock"))
        set_available(m1, p.slug, sku, 2)
        expect(page.get_by_role("status", name="Product updates")).to_have_text("Only 2 left")
        expect(page.get_by_role("status", name="Selected variant")).to_have_text(selected_text(sku, 4500, "Only 2 left"))
        assert stock(app_url, sku) == {"sku": sku, "available": 2, "badge": "Only 2 left"}
        set_available(m1, p.slug, sku, 0)
        expect(page.get_by_role("status", name="Product updates")).to_have_text("Out of stock")
        add = page.get_by_role("button", name="Add to bag")
        expect(add).to_be_disabled()
        expect(add).to_have_text("Out of stock")
    with ui(browser, app_url, f"/admin/products/{p.slug}", cookie=ns.sessions["m1"]) as staff:
        staff.route("**/api/live**", lambda route: route.abort())
        staff.reload()
        group = staff.get_by_role("group", name=sku)
        expect(group).to_be_visible()
        assert patch_variant(m2, p.slug, sku, price=4600).status_code == 200
        group.get_by_role("textbox", name="Price", exact=True).fill("4700")
        group.get_by_role("button", name=f"Save {sku}").click()
        expect(staff.get_by_role("alert").filter(has_text=MSG["stale_version"])).to_be_visible()
        assert admin_variant(m2, p.slug, sku)["price"] == 4600
        staff.get_by_role("button", name="Reload latest").click()
        staff.get_by_role("group", name=sku).get_by_role("textbox", name="Price", exact=True).fill("4700")
        save = staff.get_by_role("group", name=sku).get_by_role("button", name=f"Save {sku}")
        save.focus()
        staff.keyboard.press("Enter")
        expect(staff.get_by_role("status", name="Staff updates")).to_have_text(f"Saved {sku}.")
    assert admin_variant(m2, p.slug, sku)["price"] == 4700


def test_wf_live_admin_stock_price_unpublish(browser: Browser, app_url: str) -> None:
    ns = Ns("unpub")
    p = ns.product("a")
    ns.user("ops", "operations")
    ns.run(app_url)
    wait_indexed(app_url, [p])
    guest = Actor(app_url)
    with ui(browser, app_url, f"/admin/products/{p.slug}", cookie=ns.sessions["ops"]) as page:
        select(page.get_by_role("combobox", name="Product status"), "Draft")
        page.get_by_role("button", name="Save status").click()
        expect(page.get_by_role("status", name="Staff updates")).to_have_text(f"Saved {p.slug}.")
    err(guest.get(f"/api/products/{p.slug}"), 404, "not_found")
    eventually(lambda: all(x["slug"] != p.slug for x in guest.get("/api/search", params={"q": p.name}).json()["results"]),
               f"GET /api/search stops listing the draft product {p.slug}", INDEX_WAIT_S)


def test_live_stream_sequence_and_resume(app_url: str) -> None:
    ns = Ns("stream")
    p = ns.product("a", available=8)
    for k in ("a", "b"):
        ns.user(k)
    ns.user("ops", "operations")
    ns.run(app_url)
    ops, a, sku = ns.who(app_url, "ops"), ns.who(app_url, "a"), p.sku()
    streams = [Live(app_url, ns.sessions["a"]), Live(app_url, ns.sessions["b"]), Live(app_url)]
    a_live, b_live, guest_live = streams
    try:
        assert a_live.content_type.startswith("text/event-stream")
        set_available(ops, p.slug, sku, 2)
        done = time.monotonic()
        ev = guest_live.wait(is_event("stock", sku=sku, available=2), "the stock event")
        assert ev["t"] - done <= LIVE_MAX_S and ev["json"]["badge"] == "Only 2 left"
        assert a.put(f"/api/wishlist/{p.slug}").status_code == 200
        a_live.wait(lambda e: e.get("event") == "wishlist" and p.slug in (e["json"] or {}).get("slugs", []), "the wishlist event")
        assert a.post("/api/cart/lines", {"sku": sku, "quantity": 1}).status_code == 200
        a_live.wait(is_event("cart", count=1), "the cart event")
        set_available(ops, p.slug, sku, 3)
        b_live.wait(is_event("stock", sku=sku, available=3), "the barrier stock event for the other shopper")
        guest_live.wait(is_event("stock", sku=sku, available=3), "the barrier stock event for the guest")
        assert b_live.matching(lambda e: e.get("event") in ("wishlist", "cart")) == []
        assert guest_live.matching(lambda e: e.get("event") in ("wishlist", "cart")) == []
        ids = [int(e["id"]) for e in a_live.events if "id" in e]
        assert ids == sorted(set(ids)) and len(ids) >= 3
        last = ids[-1]
    finally:
        for s in streams:
            s.close()
    set_available(ops, p.slug, sku, 4)
    resumed = Live(app_url, ns.sessions["a"], after=last)
    try:
        resumed.wait(is_event("stock", sku=sku, available=4), "the event after the resume point")
        seen = [int(e["id"]) for e in resumed.events if "id" in e]
        assert all(i > last for i in seen) and len(seen) == len(set(seen))
    finally:
        resumed.close()


def test_versioned_staff_edits(app_url: str) -> None:
    ns = Ns("version")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),))
    ns.user("u")
    ns.user("ops", "operations")
    ns.user("sup", "support")
    ns.address("ad", "u")
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku(), 1)], placed)
    ns.order("o2", "u", "ad", "delivered", [("l2", p.sku(), 1)], placed, delivered)
    ns.case_return("r1", "l2")
    ns.run(app_url)
    ops, sup, sku = ns.who(app_url, "ops"), ns.who(app_url, "sup"), p.sku()
    v = admin_variant(ops, p.slug, sku)["version"]
    results = together([lambda i=i: ops.patch(f"{ADMIN}/variants/{sku}", {"version": v, "price": 4100 + i}) for i in (1, 2)])
    assert sorted(r.status_code for r in results) == [200, 412], [r.text for r in results]
    err(next(r for r in results if r.status_code == 412), 412, "stale_version")
    now = admin_variant(ops, p.slug, sku)
    assert now["version"] == v + 1 and now["price"] == next(r for r in results if r.status_code == 200).json()["price"]
    err(ops.patch(f"{ADMIN}/variants/{sku}", {"version": v, "price": 0}), 412, "stale_version")
    assert fields_of(ops.patch(f"{ADMIN}/variants/{sku}", {"version": now["version"], "price": 1000000}))["price"] == "Enter a whole-rupee price from 1 to 9,99,999."
    assert "compare_at" in fields_of(ops.patch(f"{ADMIN}/variants/{sku}", {"version": now["version"], "compare_at": 100}))
    bad_stock = fields_of(ops.patch(f"{ADMIN}/variants/{sku}", {"version": now["version"], "stock": [{"location": "mars", "available": 10000}]}))
    assert bad_stock["stock.0.available"] == "Enter a whole number of units from 0 to 9,999."
    assert bad_stock["stock.0.location"] == "Choose bhiwandi or gurugram."
    pv = admin_product(ops, p.slug)["version"]
    assert ops.patch(f"/api/admin/products/{p.slug}", {"version": pv, "status": "published"}).status_code == 200
    err(ops.patch(f"/api/admin/products/{p.slug}", {"version": pv, "status": "draft"}), 412, "stale_version")
    assert admin_product(ops, p.slug)["status"] == "published"
    number = ns.ids["o1"]
    ov = admin_order(ops, number)["version"]
    assert ops.post(f"{ADMIN}/orders/{number}/status", {"version": ov, "status": "packed"}).status_code == 200
    err(ops.post(f"{ADMIN}/orders/{number}/status", {"version": ov, "status": "packed"}), 412, "stale_version")
    case = ns.ids["r1"]
    cv = sup.get(f"{ADMIN}/returns/{case}").json()["version"]
    assert sup.post(f"{ADMIN}/returns/{case}/transition", {"version": cv, "to": "approved"}).status_code == 200
    err(sup.post(f"{ADMIN}/returns/{case}/transition", {"version": cv, "to": "in_transit"}), 412, "stale_version")


def test_search_index_follows_catalogue(app_url: str, meilisearch: Any) -> None:
    ns = Ns("index")
    p = ns.product("a", status="draft", sizes=(("cabin", 55, 40, 20, 2.9, 4000),))
    ns.user("ops", "operations")
    ns.run(app_url)
    ops, guest, sku = ns.who(app_url, "ops"), Actor(app_url), p.sku()
    assert "products" in meilisearch.indexes()

    def hit() -> dict | None:
        found = [x for x in guest.get("/api/search", params={"q": p.name}).json()["results"] if x["slug"] == p.slug]
        return found[0] if found else None

    def indexed() -> bool:
        return any(h.get("name") == p.name for h in meilisearch.search("products", q=p.name)["hits"])

    meilisearch.settled()
    assert hit() is None and not indexed()
    version = admin_product(ops, p.slug)["version"]
    assert ops.patch(f"/api/admin/products/{p.slug}", {"version": version, "status": "published"}).status_code == 200
    eventually(lambda: hit() and indexed(), "the published product reaches the search index", INDEX_WAIT_S)
    assert patch_variant(ops, p.slug, sku, price=4400).status_code == 200
    eventually(lambda: (hit() or {}).get("min_price") == 4400, "the price change reaches the index", INDEX_WAIT_S)
    set_available(ops, p.slug, sku, 0)
    eventually(lambda: (hit() or {}).get("badge") == "Out of stock", "the stock change reaches the index", INDEX_WAIT_S)
    version = admin_product(ops, p.slug)["version"]
    assert ops.patch(f"/api/admin/products/{p.slug}", {"version": version, "status": "archived"}).status_code == 200
    eventually(lambda: hit() is None and not indexed(), "the archived product leaves the index", INDEX_WAIT_S)


def test_staff_roles(browser: Browser, app_url: str) -> None:
    ns = Ns("roles")
    p = ns.product("a")
    ns.user("u")
    ns.user("ops", "operations")
    ns.user("sup", "support")
    ns.run(app_url)
    u, ops, sup, guest = ns.who(app_url, "u"), ns.who(app_url, "ops"), ns.who(app_url, "sup"), Actor(app_url)
    err(guest.get("/api/admin/products"), 401, "unauthenticated")
    for who in (u, sup):
        err(who.get("/api/admin/products"), 403, "forbidden")
        err(who.get("/api/admin/inventory"), 403, "forbidden")
        err(who.post(f"{ADMIN}/discount-codes", {"code": "ABC"}), 403, "forbidden")
    err(u.patch(f"{ADMIN}/variants/{p.sku()}", {"version": 1, "price": 1}), 403, "forbidden")
    assert admin_variant(ops, p.slug, p.sku())["price"] == p.v()["price"]
    err(u.get(f"{ADMIN}/returns"), 403, "forbidden")
    err(ops.get(f"{ADMIN}/returns"), 403, "forbidden")
    err(ops.get(f"{ADMIN}/warranty"), 403, "forbidden")
    for who in (ops, sup):
        assert who.get(f"{ADMIN}/audit").status_code == 200
        assert who.get(f"{ADMIN}/orders").status_code == 200
    err(u.get(f"{ADMIN}/audit"), 403, "forbidden")
    with ui(browser, app_url, "/admin", cookie=ns.sessions["u"]) as page:
        expect(page.get_by_role("heading", name="This area is for Roam House staff.")).to_be_visible()
    for key, shown, hidden in (("ops", "Products", "Returns"), ("sup", "Returns", "Products")):
        with ui(browser, app_url, "/admin", cookie=ns.sessions[key]) as page:
            nav = page.get_by_role("navigation", name="Staff")
            expect(nav.get_by_role("link", name=shown, exact=True)).to_be_visible()
            expect(nav.get_by_role("link", name=hidden, exact=True)).to_have_count(0)


def test_wf_tracking_cancel_live_and_cancel(browser: Browser, app_url: str, mail: Any) -> None:
    ns = Ns("track")
    p = ns.product("a", available=5)
    ns.user("u")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    placed, _ = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku(), 1)], placed)
    ns.run(app_url)
    number, ops, email = ns.ids["o1"], ns.who(app_url, "ops"), ns.email("u")
    before = stock(app_url, p.sku())["available"]
    with ui(browser, app_url, f"/orders/{number}", cookie=ns.sessions["u"]) as page:
        status = page.get_by_role("status", name="Order status")
        expect(status).to_have_text("Placed")
        assert order_status(ops, number, "packed").status_code == 200
        expect(status).to_have_text("Packed")
        expect(page.get_by_role("list", name="Order timeline")).to_contain_text("Packed")
        page.get_by_role("button", name="Cancel order", exact=True).click()
        dialog = page.get_by_role("alertdialog", name="Cancel this order?")
        expect(dialog.get_by_role("button", name="Keep order")).to_be_focused()
        page.keyboard.press("Tab")
        expect(dialog.get_by_role("button", name="Yes, cancel order")).to_be_focused()
        page.keyboard.press("Shift+Tab")
        dialog.get_by_role("button", name="Keep order").click()
        expect(page.get_by_role("button", name="Cancel order", exact=True)).to_be_visible()
        page.get_by_role("button", name="Cancel order", exact=True).click()
        page.get_by_role("alertdialog", name="Cancel this order?").get_by_role("button", name="Yes, cancel order").click()
        expect(status).to_have_text("Cancelled")
        expect(page.get_by_role("status", name="Payment status")).to_have_text("Refunded")
        expect(page.get_by_role("heading", level=1, name=f"Order {number}")).to_be_focused()
    order = ns.who(app_url, "u").get(f"/api/orders/{number}").json()
    assert order["status"] == "cancelled" and order["payment"]["status"] == "refunded"
    assert stock(app_url, p.sku())["available"] == before + 1
    assert len(inbox(mail, email, f"Order {number} is cancelled")) == 1
    assert len(inbox(mail, email, f"Order {number}: Packed")) == 1


def test_wf_tracking_cancel_shipped_refused(browser: Browser, app_url: str) -> None:
    ns = Ns("shipped")
    p = ns.product("a")
    ns.user("u")
    ns.user("v")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    placed, _ = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku(), 1)], placed)
    ns.run(app_url)
    number, ops, u, v = ns.ids["o1"], ns.who(app_url, "ops"), ns.who(app_url, "u"), ns.who(app_url, "v")
    tracking = f"TRK-{ns.code}"
    assert order_status(ops, number, "packed").status_code == 200
    assert ship(ops, number, [ns.ids["l1"]], tracking).status_code == 201
    err(u.post(f"/api/orders/{number}/cancel"), 409, "invalid_transition")
    err(v.get(f"/api/orders/{number}"), 404, "not_found")
    err(v.post(f"/api/orders/{number}/cancel"), 404, "not_found")
    assert u.get(f"/api/orders/{number}").json()["status"] == "shipped"
    with ui(browser, app_url, f"/orders/{number}", cookie=ns.sessions["u"]) as page:
        expect(page.get_by_role("status", name="Order status")).to_have_text("Shipped")
        expect(page.get_by_text(f"Coastline Couriers {tracking}")).to_be_visible()
        expect(page.get_by_role("button", name="Cancel order", exact=True)).to_have_count(0)


def test_order_lifecycle(app_url: str) -> None:
    ns = Ns("life")
    p = ns.product("a", colours=("Graphite", "Sage"))
    ns.user("u")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    placed, _ = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku("Graphite"), 1), ("l2", p.sku("Sage"), 1)], placed)
    ns.run(app_url)
    n, ops, u = ns.ids["o1"], ns.who(app_url, "ops"), ns.who(app_url, "u")
    l1, l2 = ns.ids["l1"], ns.ids["l2"]
    assert fields_of(order_status(ops, n, "shipped"))["status"] == "Choose packed, out for delivery, delivered or cancelled."
    err(order_status(ops, n, "out_for_delivery"), 409, "invalid_transition")
    err(order_status(ops, n, "delivered"), 409, "invalid_transition")
    err(ship(ops, n, [l1], "TRK-LIFE01"), 409, "invalid_transition")
    assert order_status(ops, n, "packed").status_code == 200
    err(order_status(ops, n, "packed"), 409, "invalid_transition")
    assert ship(ops, n, [l1], "TRK-LIFE01").status_code == 201
    assert admin_order(ops, n)["status"] == "partially_shipped"
    err(ship(ops, n, [l1], "TRK-LIFE02"), 409, "invalid_transition")
    assert ship(ops, n, [l2], "TRK-LIFE03").status_code == 201
    assert order_status(ops, n, "out_for_delivery").status_code == 200
    assert order_status(ops, n, "delivered").status_code == 200
    err(order_status(ops, n, "cancelled"), 409, "invalid_transition")
    err(u.post(f"/api/orders/{n}/cancel"), 409, "invalid_transition")
    order = u.get(f"/api/orders/{n}").json()
    assert order["delivered_at"] is not None and order["status"] == "delivered"
    assert [t["label"] for t in order["timeline"]] == ["Order placed", "Packed", "Partially shipped", "Shipped",
                                                      "Out for delivery", "Delivered"]


def test_cancellation_refunds(app_url: str, mail: Any) -> None:
    ns = Ns("cancel")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),), available=5)
    code = ns.discount("U", usage_limit=1)
    gift = ns.gift("C", SPENT_BALANCE)
    for k in ("a", "b"):
        ns.user(k)
        ns.address(f"ad-{k}", k)
    ns.cart("a", [(p.sku(), 1)], discount=code, gift=gift)
    ns.cart("b", [(p.sku(), 1)])
    ns.user("ops", "operations")
    ns.run(app_url)
    a, b, ops = ns.who(app_url, "a"), ns.who(app_url, "b"), ns.who(app_url, "ops")
    before = stock(app_url, p.sku())["available"]
    order = buy(a, ns.ids["ad-a"], ns.email("a"))
    number, payment = order["number"], order["payment"]
    assert payment["gift_card_amount"] == SPENT_BALANCE and payment["card_amount"] > 0
    assert stock(app_url, p.sku())["available"] == before - 1
    err(b.post("/api/cart/codes", {"code": code}), 422, "code_exhausted")
    cancelled = a.post(f"/api/orders/{number}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["payment"]["status"] == "refunded"
    assert cancelled.json()["payment"]["refunded"] == payment["amount"]
    assert stock(app_url, p.sku())["available"] == before
    assert a.get(f"/api/gift-cards/{gift}").json()["balance"] == SPENT_BALANCE
    ledger = ops.get(f"{ADMIN}/gift-cards/{gift}").json()
    groups: dict[str, list] = {}
    for e in ledger["entries"]:
        groups.setdefault(e["group_id"], []).append(e)
    assert len(groups) == 3 and all(sum(x["amount"] for x in g) == 0 for g in groups.values())
    assert b.post("/api/cart/codes", {"code": code}).status_code == 200
    err(a.post(f"/api/orders/{number}/cancel"), 409, "invalid_transition")
    balanced(movements(ops, p.sku()))
    assert len(inbox(mail, ns.email("a"), f"Order {number} is cancelled")) == 1


def test_customer_data_isolation(app_url: str) -> None:
    ns = Ns("iso")
    p = ns.product("a", colours=("Graphite", "Sage"))
    for k in ("a", "b"):
        ns.user(k)
        ns.address(f"ad-{k}", k)
    placed, delivered = recent(app_url)
    ns.order("oa", "a", "ad-a", "delivered", [("la1", p.sku("Graphite"), 1), ("la2", p.sku("Sage"), 1)], placed, delivered)
    ns.order("ob", "b", "ad-b", "delivered", [("lb", p.sku("Graphite"), 1)], placed, delivered)
    ns.case_return("ra", "la1")
    ns.case_trial("ta", "la2")
    ns.registration("wa", "la1")
    ns.claim("ca", "wa")
    ns.registration("wb", "lb")
    ns.cart("a", [(p.sku("Graphite"), 1)])
    ns.hold("ha", "a", [(p.sku("Graphite"), 1)], server_now(app_url))
    ns.run(app_url)
    a, b = ns.who(app_url, "a"), ns.who(app_url, "b")
    evidence = upload_evidence(a, "photo", "mine.png", png(), "image/png")
    assert evidence.status_code == 201, evidence.text
    eid = evidence.json()["id"]
    unknown = b.get(f"/api/orders/RH-{ns.code}")
    reference = err(unknown, 404, "not_found")
    for call in (b.get(f"/api/orders/{ns.ids['oa']}"), b.post(f"/api/orders/{ns.ids['oa']}/cancel"),
                 b.delete(f"/api/addresses/{ns.ids['ad-a']}"), b.get(f"/api/checkout/{ns.ids['ha']}"),
                 b.post(f"/api/checkout/{ns.ids['ha']}/reserve"),
                 b.get(f"/api/returns/{ns.ids['ra']}"), b.get(f"/api/trials/{ns.ids['ta']}"),
                 b.get(f"/api/warranty/claims/{ns.ids['ca']}"), b.get(f"/api/warranty/evidence/{eid}/content"),
                 b.post("/api/returns", {"order_line_id": ns.ids["la2"], "quantity": 1, "reason": "Wrong size", "outcome": "refund"}),
                 b.post("/api/trials", {"order_line_id": ns.ids["la2"], "note": ""}),
                 b.post("/api/warranty/registrations", {"order_line_id": ns.ids["la1"]}),
                 b.post("/api/warranty/claims", {"registration_id": ns.ids["wa"], "component": "Wheels",
                                                 "description": "The front left wheel snapped off on the first trip.",
                                                 "evidence_ids": [eid]}),
                 b.post("/api/warranty/claims", {"registration_id": ns.ids["wb"], "component": "Wheels",
                                                 "description": "The front left wheel snapped off on the first trip.",
                                                 "evidence_ids": [eid]})):
        assert call.status_code == 404 and call.json() == reference, call.text
    cid_b = b.post("/api/checkout")
    assert cid_b.status_code == 422
    assert b.get("/api/orders").json() != [] and all(o["number"] != ns.ids["oa"] for o in b.get("/api/orders").json())
    assert b.get("/api/returns").json() == [] and a.get(f"/api/returns/{ns.ids['ra']}").status_code == 200


@pytest.mark.timeout(300)
def test_customer_emails(app_url: str, mail: Any) -> None:
    ns = Ns("emails")
    p = ns.product("a", colours=("Graphite", "Sage"))
    ns.user("u")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    placed, _ = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku("Graphite"), 1)], placed)
    ns.order("o2", "u", "ad", "placed", [("l2", p.sku("Sage"), 1)], placed)
    ns.run(app_url)
    u, ops, email = ns.who(app_url, "u"), ns.who(app_url, "ops"), ns.email("u")
    n1, n2 = ns.ids["o1"], ns.ids["o2"]
    assert order_status(ops, n1, "packed").status_code == 200
    subject = f"Order {n1}: Packed"
    assert len(inbox(mail, email, subject)) == 1
    note = eventually(lambda: next((x for x in u.get("/api/notifications").json() if x["text"] == subject
                                    and x["email_status"] == "emailed"), None), "the packed notification is emailed")
    assert note["text"] == subject
    with app_copy(**MAIL_DOWN) as down:
        moved = Actor(down, ns.sessions["ops"])
        assert moved.post(f"{ADMIN}/orders/{n2}/status",
                          {"version": admin_order(ops, n2)["version"], "status": "packed"}).status_code == 200
        pending = next(x for x in u.get("/api/notifications").json() if x["text"] == f"Order {n2}: Packed")
        assert pending["email_status"] in ("pending", "emailed")
        if pending["email_status"] == "emailed":
            assert len(inbox(mail, email, f"Order {n2}: Packed")) == 1
    eventually(lambda: next((x for x in u.get("/api/notifications").json() if x["text"] == f"Order {n2}: Packed"
                             and x["email_status"] == "emailed"), None), "the pending notification is retried and emailed", 120)
    assert len(inbox(mail, email, f"Order {n2}: Packed")) == 1


def test_wf_return_exchange_exchange_flow(browser: Browser, app_url: str) -> None:
    ns = Ns("exch")
    p = ns.product("a", colours=("Graphite", "Sage"), available=3)
    ns.user("u")
    ns.user("sup", "support")
    ns.address("ad", "u")
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku("Graphite"), 1)], placed, delivered)
    ns.run(app_url)
    who, sup = ns.who(app_url, "u"), ns.who(app_url, "sup")
    graphite0, sage0 = stock(app_url, p.sku("Graphite"))["available"], stock(app_url, p.sku("Sage"))["available"]
    with ui(browser, app_url, f"/orders/{ns.ids['o1']}", cookie=ns.sessions["u"]) as page:
        opener = page.get_by_role("group", name=p.label(p.sku("Graphite"))).get_by_role("button", name="Request return")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Request a return")
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        reason = dialog.get_by_role("radiogroup", name="Reason")
        reason.get_by_role("radio", name="Changed my mind").focus()
        page.keyboard.press("ArrowDown")
        expect(reason.get_by_role("radio", name="Wrong size")).to_be_checked()
        outcome = dialog.get_by_role("radiogroup", name="Outcome")
        outcome.get_by_role("radio", name="Refund").focus()
        page.keyboard.press("ArrowDown")
        expect(outcome.get_by_role("radio", name="Exchange")).to_be_checked()
        dialog.get_by_role("radiogroup", name="Exchange for").get_by_role("radio", name=f"Sage, {SIZE_LABEL['cabin']}").check()
        dialog.get_by_role("button", name="Submit return request").click()
        expect(page.get_by_role("status", name="Cart updates")).to_have_text(re.compile(r"^Return RT-\d+ requested\.$"))
        number = latest_number(who, "/api/returns")
        page.goto(app_url + "/account")
        page.get_by_role("tab", name="Returns").click()
        assert case_move(sup, "returns", number, "approved").status_code == 200
        expect(page.get_by_text("Approved — ship it back within 14 days.")).to_be_visible()
        walk(sup, "returns", number, ["in_transit", "received", "inspected", "exchanged"])
        expect(page.get_by_text("Exchanged", exact=True).first).to_be_visible()
    case = admin_case(sup, "returns", number).json()
    assert case["status"] == "exchanged" and case["exchange_order_number"]
    exchange = who.get(f"/api/orders/{case['exchange_order_number']}").json()
    assert exchange["payment"]["amount"] == 0 and exchange["lines"][0]["sku"] == p.sku("Sage")
    assert stock(app_url, p.sku("Sage"))["available"] == sage0 - 1
    assert stock(app_url, p.sku("Graphite"))["available"] == graphite0 + 1


def test_wf_return_exchange_rejected(browser: Browser, app_url: str, mail: Any) -> None:
    ns = Ns("rejret")
    p = ns.product("a")
    ns.user("u")
    ns.user("sup", "support")
    ns.address("ad", "u")
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku(), 1)], placed, delivered)
    ns.case_return("r1", "l1")
    ns.run(app_url)
    sup, number, reason = ns.who(app_url, "sup"), ns.ids["r1"], "Item was used heavily"
    assert fields_of(case_move(sup, "returns", number, "rejected"))["reason"] == "Give a reason of 5 to 500 characters."
    with ui(browser, app_url, "/account", cookie=ns.sessions["u"]) as page:
        page.get_by_role("tab", name="Returns").click()
        assert case_move(sup, "returns", number, "rejected", reason).status_code == 200
        expect(page.get_by_text(f"Rejected: {reason}")).to_be_visible()
    err(case_move(sup, "returns", number, "approved"), 409, "invalid_transition")
    assert len(inbox(mail, ns.email("u"), f"Return {number}: Rejected")) == 1


def test_return_lifecycle(app_url: str) -> None:
    ns = Ns("retlife")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),), colours=("Graphite", "Sage", "Signal Red", "Navy"))
    ns.user("u")
    ns.user("sup", "support")
    ns.address("ad", "u")
    days = config(app_url)["return_window_days"]
    rate = config(app_url)["tax_rate_percent"]
    now = server_now(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku("Graphite"), 1)], now - timedelta(days=3), now - timedelta(days=2))
    old = now - timedelta(days=days + 1)
    ns.order("o2", "u", "ad", "delivered", [("l2", p.sku("Sage"), 1)], old - timedelta(days=1), old)
    ns.order("o3", "u", "ad", "placed", [("l3", p.sku("Signal Red"), 1)], now - timedelta(days=1))
    ns.order("o4", "u", "ad", "delivered", [("l4", p.sku("Navy"), 1)], now - timedelta(days=days + 10),
             now - timedelta(days=2))
    ns.run(app_url)
    who, sup = ns.who(app_url, "u"), ns.who(app_url, "sup")
    body = lambda line, **kw: {"order_line_id": ns.ids[line], "quantity": 1, "reason": "Wrong size", "outcome": "refund", **kw}
    err(who.post("/api/returns", body("l2")), 422, "window_closed",
        f"The {days}-day return window ended on {long_date(old + timedelta(days=days))}.")
    err(who.post("/api/returns", body("l3")), 422, "not_eligible")
    late_placed = who.post("/api/returns", body("l4"))
    assert late_placed.status_code == 201, "the window counts from delivery, not from placement: " + late_placed.text
    err(who.post("/api/returns", body("l1", quantity=2)), 422, "not_eligible")
    assert fields_of(who.post("/api/returns", body("l1", quantity=0)))["quantity"] == "Choose a quantity from 1 to 10."
    assert fields_of(who.post("/api/returns", body("l1", reason="")))["reason"] == "Choose a reason."
    created = who.post("/api/returns", body("l1"))
    assert created.status_code == 201, created.text
    number = created.json()["number"]
    err(who.post(f"{ADMIN}/returns/{number}/transition", {"version": 1, "to": "approved"}), 403, "forbidden")
    err(case_move(sup, "returns", number, "received"), 409, "invalid_transition")
    before = stock(app_url, p.sku("Graphite"))["available"]
    walk(sup, "returns", number, ["approved", "in_transit"])
    assert stock(app_url, p.sku("Graphite"))["available"] == before
    walk(sup, "returns", number, ["received"])
    assert stock(app_url, p.sku("Graphite"))["available"] == before + 1
    final = walk(sup, "returns", number, ["inspected", "refunded"])
    assert final["status"] == "refunded" and final["refund_amount"] == 4000 + half_up(4000 * rate, 100)
    assert [h["status"] for h in who.get(f"/api/returns/{number}").json()["history"]][-1] == "refunded"


def test_refunds_and_exchanges(app_url: str) -> None:
    ns = Ns("refund")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 999),), available=10)
    ex = ns.product("e", colours=("Graphite", "Sage", "Signal Red"), available={("Sage", "cabin"): 0, ("Signal Red", "cabin"): 3})
    gift = ns.gift("F", 3000)
    ns.user("u")
    ns.user("ops", "operations")
    ns.user("sup", "support")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 3)], gift=gift)
    placed, delivered = recent(app_url)
    ns.order("o2", "u", "ad", "delivered", [("l2", ex.sku("Graphite"), 1)], placed, delivered)
    ns.run(app_url)
    who, ops, sup = ns.who(app_url, "u"), ns.who(app_url, "ops"), ns.who(app_url, "sup")
    order = buy(who, ns.ids["ad"], ns.email("u"))
    line = order["lines"][0]
    paid = line["line_subtotal"] - line["line_discount"] + line["line_tax"]
    card_part = order["payment"]["card_amount"]
    deliver(ops, order["number"], [line["id"]], f"TRK-{ns.code}")
    first = who.post("/api/returns", {"order_line_id": line["id"], "quantity": 1, "reason": "Wrong size", "outcome": "refund"})
    assert first.status_code == 201, first.text
    done = walk(sup, "returns", first.json()["number"], ["approved", "in_transit", "received", "inspected", "refunded"])
    share = half_up(paid, 3)
    assert done["refund_amount"] == share
    mid = who.get(f"/api/orders/{order['number']}").json()["payment"]
    assert mid["refunded"] == share and mid["status"] == "partially_refunded"
    assert who.get(f"/api/gift-cards/{gift}").json()["balance"] == max(0, share - card_part)
    rest = who.post("/api/returns", {"order_line_id": line["id"], "quantity": 2, "reason": "Wrong size", "outcome": "refund"})
    assert rest.status_code == 201, rest.text
    final = walk(sup, "returns", rest.json()["number"], ["approved", "in_transit", "received", "inspected", "refunded"])
    assert final["refund_amount"] == paid - share
    end = who.get(f"/api/orders/{order['number']}").json()["payment"]
    assert end["refunded"] == paid
    assert who.get(f"/api/gift-cards/{gift}").json()["balance"] == paid - card_part
    ledger = ops.get(f"{ADMIN}/gift-cards/{gift}").json()
    groups: dict[str, list] = {}
    for e in ledger["entries"]:
        groups.setdefault(e["group_id"], []).append(e)
    assert all(len(g) == 2 and sum(x["amount"] for x in g) == 0 for g in groups.values())
    line2 = ns.ids["l2"]
    ask = lambda **kw: who.post("/api/returns", {"order_line_id": line2, "quantity": 1, "reason": "Wrong size", **kw})
    assert "exchange_sku" in fields_of(ask(outcome="exchange", exchange_sku=p.sku()))
    assert fields_of(ask(outcome="exchange"))["exchange_sku"] == "Choose another colour or size of the same bag at the same price."
    out = err(ask(outcome="exchange", exchange_sku=ex.sku("Sage")), 409, "out_of_stock")
    assert out["sku"] == ex.sku("Sage") and out["available"] == 0
    created = ask(outcome="exchange", exchange_sku=ex.sku("Signal Red"))
    assert created.status_code == 201, created.text
    number = created.json()["number"]
    walk(sup, "returns", number, ["approved", "in_transit", "received", "inspected"])
    set_available(ops, ex.slug, ex.sku("Signal Red"), 0)
    err(case_move(sup, "returns", number, "exchanged"), 409, "out_of_stock")
    assert sup.get(f"{ADMIN}/returns/{number}").json()["status"] == "inspected"
    set_available(ops, ex.slug, ex.sku("Signal Red"), 2)
    case = case_move(sup, "returns", number, "exchanged")
    assert case.status_code == 200 and case.json()["exchange_order_number"]
    new = who.get(f"/api/orders/{case.json()['exchange_order_number']}").json()
    assert new["payment"]["amount"] == 0 and new["lines"][0]["sku"] == ex.sku("Signal Red")
    assert stock(app_url, ex.sku("Signal Red"))["available"] == 1


def test_one_case_per_submission(app_url: str) -> None:
    ns = Ns("onecase")
    p = ns.product("a", colours=("Graphite", "Sage", "Signal Red"))
    ns.user("u")
    ns.address("ad", "u")
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku("Graphite"), 1), ("l2", p.sku("Sage"), 1), ("l3", p.sku("Signal Red"), 1)],
             placed, delivered)
    ns.registration("w1", "l3")
    ns.run(app_url)
    who = ns.who(app_url, "u")
    body = {"order_line_id": ns.ids["l1"], "quantity": 1, "reason": "Wrong size", "outcome": "refund"}
    rs = together([lambda: who.post("/api/returns", body) for _ in range(4)])
    assert sorted(r.status_code for r in rs) == [201, 409, 409, 409], [r.text for r in rs]
    for r in rs:
        if r.status_code == 409:
            err(r, 409, "duplicate_request")
    assert len(who.get("/api/returns").json()) == 1
    key, tb = idempotency_key(), {"order_line_id": ns.ids["l2"], "note": ""}
    one, two = who.post("/api/trials", tb, key=key), who.post("/api/trials", tb, key=key)
    assert one.status_code == 201 and two.status_code == 201 and one.json()["number"] == two.json()["number"]
    assert two.headers.get("Idempotency-Replayed") == "true"
    err(who.post("/api/trials", tb), 409, "duplicate_request")
    assert len(who.get("/api/trials").json()) == 1
    evidence = [upload_evidence(who, "photo", f"p{i}.png", png(i), "image/png").json()["id"] for i in range(3)]
    claims = together([lambda e=e: who.post("/api/warranty/claims", {
        "registration_id": ns.ids["w1"], "component": "Wheels",
        "description": "The front left wheel snapped off on the first trip.", "evidence_ids": [e]}) for e in evidence])
    assert sorted(r.status_code for r in claims) == [201, 409, 409], [r.text for r in claims]
    assert len(who.get("/api/warranty/claims").json()) == 1


def test_wf_trial_boundary_approve(browser: Browser, app_url: str, mail: Any) -> None:
    ns = Ns("trial")
    p = ns.product("a")
    ns.user("u")
    ns.user("sup", "support")
    ns.address("ad", "u")
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku(), 1)], placed, delivered)
    ns.run(app_url)
    who, sup = ns.who(app_url, "u"), ns.who(app_url, "sup")
    with ui(browser, app_url, f"/orders/{ns.ids['o1']}", cookie=ns.sessions["u"]) as page:
        opener = page.get_by_role("group", name=p.label()).get_by_role("button", name="Send back from trial")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Send back from trial")
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        dialog.get_by_role("textbox", name="How did it travel?").fill("Rolled smoothly through two airports.")
        dialog.get_by_role("button", name="Submit trial return").dblclick()
        expect(page.get_by_role("status", name="Cart updates")).to_have_text(re.compile(r"^Trial return TR-\d+ requested\.$"))
        trials = who.get("/api/trials").json()
        assert len(trials) == 1
        number = trials[0]["number"]
        page.goto(app_url + "/account")
        page.get_by_role("tab", name="Trials").click()
        assert case_move(sup, "trials", number, "approved").status_code == 200
        expect(page.get_by_text("Trial return approved")).to_be_visible()
    assert len(inbox(mail, ns.email("u"), f"Trial return {number}: Approved")) == 1


def test_wf_trial_boundary_closed_window(browser: Browser, app_url: str) -> None:
    ns = Ns("trialclosed")
    p = ns.product("a", colours=("Graphite", "Sage"))
    acc = ns.product("b", category="accessories", colours=("Tan",))
    ns.user("u")
    ns.address("ad", "u")
    days = config(app_url)["trial_window_days"]
    now = server_now(app_url)
    old = now - timedelta(days=days + 1)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku(), 1)], old - timedelta(days=1), old)
    ns.order("o2", "u", "ad", "delivered", [("l2", acc.sku(), 1)], now - timedelta(days=3), now - timedelta(days=2))
    ns.order("o3", "u", "ad", "delivered", [("l3", p.sku("Sage"), 1)], now - timedelta(days=days + 10),
             now - timedelta(days=2))
    ns.run(app_url)
    who = ns.who(app_url, "u")
    err(who.post("/api/trials", {"order_line_id": ns.ids["l1"], "note": ""}), 422, "window_closed",
        f"The {days}-day trial ended on {long_date(old + timedelta(days=days))}.")
    err(who.post("/api/trials", {"order_line_id": ns.ids["l2"], "note": ""}), 422, "not_eligible")
    counted = who.post("/api/trials", {"order_line_id": ns.ids["l3"], "note": ""})
    assert counted.status_code == 201, "the trial counts from delivery, not from placement: " + counted.text
    line = who.get(f"/api/orders/{ns.ids['o1']}").json()["lines"][0]
    assert line["trial_eligible"] is False
    with ui(browser, app_url, f"/orders/{ns.ids['o1']}", cookie=ns.sessions["u"],
            device_time=datetime(2020, 1, 1, tzinfo=timezone.utc)) as page:
        expect(page.get_by_role("group", name=p.label())).to_be_visible()
        expect(page.get_by_role("button", name="Send back from trial")).to_have_count(0)
    assert all(t["order_line_id"] != ns.ids["l1"] for t in who.get("/api/trials").json())


def test_trial_lifecycle(app_url: str) -> None:
    ns = Ns("triallife")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),), colours=("Graphite", "Sage"))
    ns.user("u")
    ns.user("sup", "support")
    ns.address("ad", "u")
    rate = config(app_url)["tax_rate_percent"]
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku("Graphite"), 1), ("l2", p.sku("Sage"), 1)], placed, delivered)
    ns.case_trial("t1", "l1")
    ns.run(app_url)
    who, sup, number = ns.who(app_url, "u"), ns.who(app_url, "sup"), ns.ids["t1"]
    err(case_move(sup, "trials", number, "returned"), 409, "invalid_transition")
    err(who.post("/api/trials", {"order_line_id": ns.ids["l1"], "note": ""}), 409, "duplicate_request")
    err(who.post("/api/returns", {"order_line_id": ns.ids["l1"], "quantity": 1, "reason": "Wrong size", "outcome": "refund"}),
        409, "duplicate_request")
    assert fields_of(who.post("/api/trials", {"order_line_id": ns.ids["l2"], "note": "n" * 501}))["note"] == "Keep the note to 500 characters or fewer."
    before = stock(app_url, p.sku("Graphite"))["available"]
    walk(sup, "trials", number, ["approved", "returned"])
    assert stock(app_url, p.sku("Graphite"))["available"] == before + 1
    final = walk(sup, "trials", number, ["refunded"])
    assert final["refund_amount"] == 4000 + half_up(4000 * rate, 100)
    err(case_move(sup, "trials", number, "approved"), 409, "invalid_transition")


def test_server_time_windows(browser: Browser, app_url: str) -> None:
    ns = Ns("servertime")
    p = ns.product("a")
    q = ns.product("b")
    ns.user("u")
    ns.address("ad", "u")
    ttl = config(app_url)["reservation_ttl_seconds"]
    now = server_now(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku(), 1)], now - timedelta(days=6),
             now - timedelta(days=5, minutes=30))
    ns.cart("u", [(q.sku(), 1)])
    ns.hold("h1", "u", [(q.sku(), 1)], now - timedelta(seconds=60))
    ns.run(app_url)
    who = ns.who(app_url, "u")
    order = who.get(f"/api/orders/{ns.ids['o1']}").json()
    days = order["trial_window"]["seconds_left"] // 86400
    rdays = order["return_window"]["seconds_left"] // 86400
    with ui(browser, app_url, f"/orders/{ns.ids['o1']}", cookie=ns.sessions["u"], device_time=FUTURE_DEVICE_TIME) as page:
        expect(page.get_by_text(re.compile(rf"Trial window: {days} days \d+ hours left"))).to_be_visible()
        expect(page.get_by_text(re.compile(rf"Return window: {rdays} days \d+ hours left"))).to_be_visible()
        expect(page.get_by_role("button", name="Send back from trial")).to_be_visible()
    hold = who.get(f"/api/checkout/{ns.ids['h1']}").json()["hold"]
    assert hold["status"] == "active" and 0 < hold["seconds_left"] <= ttl
    minutes = hold["seconds_left"] // 60
    with ui(browser, app_url, f"/checkout/{ns.ids['h1']}", cookie=ns.sessions["u"], device_time=FUTURE_DEVICE_TIME) as page:
        timer = page.get_by_role("timer", name="Hold time left")
        expect(timer).to_have_text(re.compile(r"^Held for \d+:\d\d$"))
        shown = int(re.match(r"Held for (\d+):", timer.inner_text()).group(1))
        assert minutes - 1 <= shown <= minutes, (shown, minutes)


def test_wf_warranty_evidence_replacement(browser: Browser, app_url: str) -> None:
    ns = Ns("warr")
    p = ns.product("a", available=5)
    ns.user("u")
    ns.user("sup", "support")
    ns.address("ad", "u")
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku(), 1)], placed, delivered)
    ns.run(app_url)
    who, sup, uid = ns.who(app_url, "u"), ns.who(app_url, "sup"), None
    uid = who.get("/api/me").json()["user"]["id"]
    before = stock(app_url, p.sku())["available"]
    with ui(browser, app_url, f"/orders/{ns.ids['o1']}", cookie=ns.sessions["u"]) as page:
        line = page.get_by_role("group", name=p.label())
        line.get_by_role("button", name="Register warranty").click()
        cover = who.get(f"/api/orders/{ns.ids['o1']}").json()["lines"][0]["warranty"]["covered_until"]
        expect(page.get_by_text(f"Covered until {long_date(parse_ts(cover))}")).to_be_visible()
        line.get_by_role("button", name="Make a warranty claim").click()
        dialog = page.get_by_role("dialog", name="Warranty claim")
        dialog.get_by_role("radiogroup", name="Component").get_by_role("radio", name="Wheels").check()
        dialog.get_by_role("textbox", name="What happened?").fill("The front left wheel snapped off on the first trip.")
        chooser_upload(page, dialog.get_by_role("button", name="Add photo"), PHOTO_NAME, PNG_TYPE, png())
        expect(dialog.get_by_role("status", name="Upload progress")).to_have_text(f"Uploaded {PHOTO_NAME}")
        expect(dialog.get_by_role("list", name="Evidence")).to_contain_text(f"{PHOTO_NAME} — Evidence stored")
        dialog.get_by_role("button", name="Submit claim").dblclick()
        expect(page.get_by_role("status", name="Cart updates")).to_have_text(re.compile(r"^Claim WC-\d+ submitted\.$"))
        claims = who.get("/api/warranty/claims").json()
        assert len(claims) == 1
        number = claims[0]["number"]
        page.goto(app_url + "/account")
        page.get_by_role("tab", name="Warranty").click()
        walk(sup, "warranty", number, ["under_review", "approved"])
        expect(page.get_by_text("Approved", exact=True).first).to_be_visible()
        walk(sup, "warranty", number, ["replacement"])
        expect(page.get_by_text("Replacement", exact=True).first).to_be_visible()
        walk(sup, "warranty", number, ["resolved"])
        expect(page.get_by_text("Resolved", exact=True).first).to_be_visible()
    claim = who.get(f"/api/warranty/claims/{number}").json()
    assert claim["resolution_order_number"] and claim["evidence"][0]["status"] == "stored"
    assert who.get(f"/api/orders/{claim['resolution_order_number']}").json()["payment"]["amount"] == 0
    assert stock(app_url, p.sku())["available"] == before - 1
    eid = claim["evidence"][0]["id"]
    keys = [k for k in S3().keys(f"evidence/{uid}/") if k.endswith(eid)]
    assert len(keys) == 1 and S3().get(keys[0]) == png()


def test_wf_warranty_evidence_rejected_upload(browser: Browser, app_url: str) -> None:
    ns = Ns("warrbad")
    p = ns.product("a")
    ns.user("u")
    ns.address("ad", "u")
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku(), 1)], placed, delivered)
    ns.registration("w1", "l1")
    ns.run(app_url)
    who = ns.who(app_url, "u")
    uid = who.get("/api/me").json()["user"]["id"]
    with ui(browser, app_url, f"/orders/{ns.ids['o1']}", cookie=ns.sessions["u"]) as page:
        page.get_by_role("group", name=p.label()).get_by_role("button", name="Make a warranty claim").click()
        dialog = page.get_by_role("dialog", name="Warranty claim")
        dialog.get_by_role("radiogroup", name="Component").get_by_role("radio", name="Shell").check()
        dialog.get_by_role("textbox", name="What happened?").fill("The shell cracked along the left seam.")
        chooser_upload(page, dialog.get_by_role("button", name="Add photo"), "evil.svg", "image/svg+xml", SVG)
        expect(page.get_by_role("alert").filter(has_text=f"evil.svg: {UNSUPPORTED_EVIDENCE}")).to_be_visible()
        expect(dialog.get_by_role("list", name="Evidence")).not_to_contain_text("evil.svg")
        dialog.get_by_role("button", name="Submit claim").click()
        expect(page.get_by_text("Add 1 to 5 photos and at most one receipt.").first).to_be_visible()
    assert S3().keys(f"evidence/{uid}/") == []
    assert who.get("/api/warranty/claims").json() == []
    fake = upload_evidence(who, "photo", "photo.png", SVG, "image/png")
    err(fake, 422, "unsupported_file", UNSUPPORTED_EVIDENCE)


def test_warranty_cover_and_lifecycle(app_url: str) -> None:
    ns = Ns("cover")
    lug = ns.product("a", colours=("Graphite", "Sage"), available=0)
    tote = ns.product("t", category="totes", sizes=(("one-size", 38, 40, 12, 0.4, 2499),))
    acc = ns.product("c", category="accessories", colours=("Tan",))
    ns.user("u")
    ns.user("sup", "support")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    cfg = config(app_url)
    now = server_now(app_url)
    year = timedelta(days=1)
    d_ok = off_leap_day(add_years(now, -cfg["warranty_years_luggage"]) + year)
    d_old_lug = add_years(now, -cfg["warranty_years_luggage"]) - year
    d_old_tote = add_years(now, -cfg["warranty_years_bags"]) - year
    d_old_acc = add_years(now, -cfg["warranty_years_accessories"]) - year
    for key, line, sku, when in (("o1", "l1", lug.sku("Graphite"), d_ok), ("o2", "l2", lug.sku("Sage"), d_old_lug),
                                 ("o3", "l3", tote.sku(), d_old_tote), ("o4", "l4", acc.sku(), d_old_acc)):
        ns.order(key, "u", "ad", "delivered", [(line, sku, 1)], when - timedelta(days=1), when)
    ns.order("o5", "u", "ad", "placed", [("l5", lug.sku("Graphite"), 1)], now - timedelta(days=1))
    ns.run(app_url)
    who, sup, ops = ns.who(app_url, "u"), ns.who(app_url, "sup"), ns.who(app_url, "ops")
    reg = who.post("/api/warranty/registrations", {"order_line_id": ns.ids["l1"]})
    assert reg.status_code == 201, reg.text
    assert parse_ts(reg.json()["covered_until"]).date() == add_years(d_ok, cfg["warranty_years_luggage"]).date()
    assert who.post("/api/warranty/registrations", {"order_line_id": ns.ids["l1"]}).json()["id"] == reg.json()["id"]
    for line, when, years in (("l2", d_old_lug, cfg["warranty_years_luggage"]), ("l3", d_old_tote, cfg["warranty_years_bags"]),
                              ("l4", d_old_acc, cfg["warranty_years_accessories"])):
        err(who.post("/api/warranty/registrations", {"order_line_id": ns.ids[line]}), 422, "warranty_expired",
            f"This item's warranty ended on {long_date(add_years(when, years))}.")
    err(who.post("/api/warranty/registrations", {"order_line_id": ns.ids["l5"]}), 422, "not_eligible")
    rid = reg.json()["id"]
    desc = "The front left wheel snapped off on the first trip."

    def claim(component: str, description: str = desc, count: int = 1, receipts: int = 0) -> httpx.Response:
        ids = [upload_evidence(who, "photo", f"p{i}.png", png(i + 1), "image/png").json()["id"] for i in range(count)]
        ids += [upload_evidence(who, "receipt", f"r{i}.pdf", pdf(), "application/pdf").json()["id"] for i in range(receipts)]
        return who.post("/api/warranty/claims", {"registration_id": rid, "component": component, "description": description,
                                                 "evidence_ids": ids})

    assert fields_of(claim("Wheels", description="x" * 19))["description"] == "Describe the fault in 20 to 1,000 characters."
    assert "description" in fields_of(claim("Wheels", description="x" * 1001))
    assert fields_of(claim("Wheels", count=6))["evidence_ids"] == "Add 1 to 5 photos and at most one receipt."
    assert "evidence_ids" in fields_of(claim("Wheels", count=1, receipts=2))
    assert fields_of(claim("Foot"))["component"] == "Choose the part that failed."
    assert claim("Wheels", description="x" * 20).status_code == 201
    repair = claim("Handle", description="y" * 1000)
    assert repair.status_code == 201, repair.text
    err(claim("Handle"), 409, "duplicate_request")
    number = repair.json()["number"]
    err(case_move(sup, "warranty", number, "approved"), 409, "invalid_transition")
    walk(sup, "warranty", number, ["under_review"])
    assert fields_of(case_move(sup, "warranty", number, "rejected"))["reason"] == "Give a reason of 5 to 500 characters."
    final = walk(sup, "warranty", number, ["approved", "repair", "resolved"])
    assert final["status"] == "resolved"
    swap = claim("Lock").json()["number"]
    walk(sup, "warranty", swap, ["under_review", "approved"])
    err(case_move(sup, "warranty", swap, "replacement"), 409, "out_of_stock")
    assert sup.get(f"{ADMIN}/warranty/{swap}").json()["status"] == "approved"
    set_available(ops, lug.slug, lug.sku("Graphite"), 2)
    done = case_move(sup, "warranty", swap, "replacement")
    assert done.status_code == 200 and done.json()["resolution_order_number"]
    assert stock(app_url, lug.sku("Graphite"))["available"] == 1


def test_evidence_uploads(app_url: str) -> None:
    ns = Ns("evid")
    ns.user("u")
    ns.user("v")
    ns.run(app_url)
    u, v = ns.who(app_url, "u"), ns.who(app_url, "v")
    uid = u.get("/api/me").json()["user"]["id"]
    limit = config(app_url)["upload_max_bytes"]
    data = png(7)
    ok = upload_evidence(u, "photo", PHOTO_NAME, data, PNG_TYPE)
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert body["kind"] == "photo" and body["filename"] == PHOTO_NAME and body["content_type"] == PNG_TYPE
    assert body["bytes"] == len(data) and body["sha256"] == hashlib.sha256(data).hexdigest() and body["status"] == "stored"
    assert body["stored_at"]
    keys = [k for k in S3().keys(f"evidence/{uid}/") if k.endswith(body["id"])]
    assert len(keys) == 1 and S3().get(keys[0]) == data
    served = u.get(f"/api/warranty/evidence/{body['id']}/content")
    assert served.status_code == 200 and served.content == data
    assert served.headers.get("content-type", "").startswith(PNG_TYPE)
    err(v.get(f"/api/warranty/evidence/{body['id']}/content"), 404, "not_found")
    for kind, name, content, ctype in (("photo", "fake.png", SVG, PNG_TYPE), ("photo", "run.jpg", b"MZ\x90\x00" * 8, "image/jpeg"),
                                       ("receipt", "r.pdf", png(), "application/pdf"), ("photo", "doc.png", pdf(), PNG_TYPE),
                                       ("receipt", "js.pdf", pdf(JS_PDF), "application/pdf")):
        err(upload_evidence(u, kind, name, content, ctype), 422, "unsupported_file", UNSUPPORTED_EVIDENCE)
    named = upload_evidence(u, "photo", "../../etc/passwd.jpg", jpeg(), "image/jpeg")
    assert named.status_code == 201 and named.json()["filename"] == "passwd.jpg"
    assert not [k for k in S3().keys("evidence/") if "passwd" in k]
    receipt = upload_evidence(u, "receipt", "bill.pdf", pdf(), "application/pdf")
    assert receipt.status_code == 201
    got = u.get(f"/api/warranty/evidence/{receipt.json()['id']}/content")
    assert "attachment" in got.headers.get("Content-Disposition", "")
    assert "kind" in fields_of(u.upload("/api/warranty/evidence", IMG_NAME, png(), PNG_TYPE, {"kind": "scan"}))
    assert fields_of(u.request("POST", "/api/warranty/evidence", files={"kind": (None, "photo")}))["file"] == "Choose a file to upload."
    exact = pdf() + b"%" * (limit - len(pdf()))
    assert upload_evidence(u, "receipt", "big.pdf", exact, "application/pdf").status_code == 201
    too_big = upload_evidence(u, "receipt", "bigger.pdf", exact + b"%", "application/pdf")
    assert too_big.status_code == 413 and too_big.json()["error"] == "too_large"
    assert too_big.json()["message"].startswith("This file is larger than ")
    down = os.environ["APP_STORAGE_DOWN_URL"]
    ns2 = Ns("evidown")
    ns2.user("d")
    ns2.run(down)
    d = ns2.who(down, "d")
    duid = d.get("/api/me").json()["user"]["id"]
    refused = upload_evidence(d, "photo", IMG_NAME, png(3), PNG_TYPE)
    err(refused, 503, "storage_unavailable", EVIDENCE_DOWN)
    assert S3().keys(f"evidence/{duid}/") == []


def test_wf_order_fulfillment_concurrency_two_managers(browser: Browser, app_url: str) -> None:
    ns = Ns("twomgr")
    p = ns.product("a", colours=("Graphite", "Sage"))
    ns.user("u")
    ns.user("m1", "operations")
    ns.user("m2", "operations")
    ns.address("ad", "u")
    placed, _ = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku("Graphite"), 1), ("l2", p.sku("Sage"), 1)], placed)
    ns.run(app_url)
    n, m1, m2, u = ns.ids["o1"], ns.who(app_url, "m1"), ns.who(app_url, "m2"), ns.who(app_url, "u")
    assert order_status(m1, n, "packed").status_code == 200
    stale = admin_order(m1, n)["version"]
    t1, t2 = f"TRK-{ns.code}A", f"TRK-{ns.code}B"
    with ui(browser, app_url, f"/orders/{n}", cookie=ns.sessions["u"]) as watcher:
        assert ship(m2, n, [ns.ids["l1"]], t1).status_code == 201
        expect(watcher.get_by_role("status", name="Order status")).to_have_text("Partially shipped")
        expect(watcher.get_by_text(f"Coastline Couriers {t1}")).to_be_visible()
        expect(watcher.get_by_role("list", name="Order timeline").get_by_role("listitem")
               .filter(has_text="Partially shipped")).to_have_count(1)
        err(ship(m1, n, [ns.ids["l1"], ns.ids["l2"]], t2, version=stale), 412, "stale_version")
        with ui(browser, app_url, f"/admin/orders/{n}", cookie=ns.sessions["m1"]) as staff:
            line = staff.get_by_role("checkbox", name=f"Ship {p.sku('Sage')}")
            line.focus()
            staff.keyboard.press("Space")
            expect(line).to_be_checked()
            select(staff.get_by_role("combobox", name="Carrier"), "Peak Express")
            staff.get_by_role("textbox", name="Tracking number").fill(t2)
            create = staff.get_by_role("button", name="Create shipment")
            create.focus()
            staff.keyboard.press("Enter")
            expect(staff.get_by_role("status", name="Staff updates")).to_have_text(f"{n} is now Shipped.")
        expect(watcher.get_by_role("status", name="Order status")).to_have_text("Shipped")
        expect(watcher.get_by_text(f"Peak Express {t2}")).to_be_visible()
    shipments = {x["id"]: x["shipment"] for x in u.get(f"/api/orders/{n}").json()["lines"]}
    assert shipments[ns.ids["l1"]]["tracking_number"] == t1 and shipments[ns.ids["l2"]]["tracking_number"] == t2


def test_wf_order_fulfillment_concurrency_invalid_tracking(browser: Browser, app_url: str) -> None:
    ns = Ns("badtrack")
    p = ns.product("a")
    ns.user("u")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    placed, _ = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku(), 1)], placed)
    ns.run(app_url)
    n, ops = ns.ids["o1"], ns.who(app_url, "ops")
    assert order_status(ops, n, "packed").status_code == 200
    line = ns.ids["l1"]
    assert fields_of(ship(ops, n, [], "TRK-OK0001"))["line_ids"] == "Choose at least one line to ship."
    assert fields_of(ship(ops, n, [line], "TRK-OK0001", carrier="Nobody"))["carrier"] == "Choose a carrier."
    assert fields_of(ship(ops, n, [line], "bad one"))["tracking_number"] == "Use 6 to 30 capital letters, digits and hyphens."
    assert admin_order(ops, n)["status"] == "packed"
    with ui(browser, app_url, f"/admin/orders/{n}", cookie=ns.sessions["ops"]) as page:
        page.get_by_role("button", name="Create shipment").click()
        expect(page.get_by_text("Choose at least one line to ship.").first).to_be_visible()
        page.get_by_role("checkbox", name=f"Ship {p.sku()}").check()
        select(page.get_by_role("combobox", name="Carrier"), "Coastline Couriers")
        page.get_by_role("textbox", name="Tracking number").fill("bad one")
        page.get_by_role("button", name="Create shipment").click()
        expect(page.get_by_text("Use 6 to 30 capital letters, digits and hyphens.").first).to_be_visible()
    assert admin_order(ops, n)["status"] == "packed"


def test_line_shipments(app_url: str) -> None:
    ns = Ns("lines")
    p = ns.product("a", colours=("Graphite", "Sage"))
    ns.user("u")
    ns.user("m1", "operations")
    ns.user("m2", "operations")
    ns.address("ad", "u")
    placed, _ = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku("Graphite"), 1), ("l2", p.sku("Sage"), 1)], placed)
    ns.run(app_url)
    n, m1, m2 = ns.ids["o1"], ns.who(app_url, "m1"), ns.who(app_url, "m2")
    assert order_status(m1, n, "packed").status_code == 200
    v = admin_order(m1, n)["version"]
    results = together([lambda m=m, i=i: ship(m, n, [ns.ids["l1"]], f"TRK-{ns.code}{i}", version=v)
                        for m, i in ((m1, "A"), (m2, "B"))])
    assert sorted(r.status_code for r in results) == [201, 412], [r.text for r in results]
    order = admin_order(m1, n)
    assert order["status"] == "partially_shipped"
    first = next(x for x in order["lines"] if x["id"] == ns.ids["l1"])
    assert first["fulfillment"] == "shipped" and first["shipment"]["carrier"] == "Coastline Couriers"
    assert next(x for x in order["lines"] if x["id"] == ns.ids["l2"])["fulfillment"] == "packed"
    moves = [m for m in movements(m1, p.sku("Graphite")) if m["reason"] == "shipped"]
    assert len(moves) == 1
    assert sorted((e["account"], e["quantity"]) for e in moves[0]["entries"]) == [("committed", -1), ("dispatched", 1)]
    err(ship(m1, n, [ns.ids["l1"]], "TRK-AGAIN1"), 409, "invalid_transition")
    done = ship(m2, n, [ns.ids["l2"]], f"TRK-{ns.code}C", carrier="Peak Express")
    assert done.status_code == 201 and done.json()["status"] == "shipped"
    labels = [t["label"] for t in done.json()["timeline"]]
    assert labels[-2:] == ["Partially shipped", "Shipped"]


def test_audit_dashboard_exports(app_url: str) -> None:
    ns = Ns("audit")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),))
    ns.user("u")
    ns.user("ops", "operations")
    ns.user("sup", "support")
    ns.address("ad", "u")
    h = int(ns.code, 16)
    day = datetime(2010 + h % 40, 1 + (h >> 8) % 12, 1 + (h >> 16) % 28, tzinfo=timezone.utc)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku(), 1)], day.replace(hour=9), day.replace(hour=9))
    ns.order("o2", "u", "ad", "delivered", [("l2", p.sku(), 2)], day.replace(hour=10), day.replace(hour=10))
    ns.run(app_url)
    ops, sup, u = ns.who(app_url, "ops"), ns.who(app_url, "sup"), ns.who(app_url, "u")
    sku = p.sku()

    def entries(entity: str, entity_id: str) -> list:
        r = ops.get(f"{ADMIN}/audit", params={"entity": entity, "entity_id": entity_id})
        assert r.status_code == 200, r.text
        return r.json()

    assert patch_variant(ops, p.slug, sku, price=4200).status_code == 200
    price = entries("variant", sku)[0]
    assert price["action"] == "price_changed" and price["before"] == {"price": 4000} and price["after"] == {"price": 4200}
    assert price["actor"]["role"] == "operations"
    set_available(ops, p.slug, sku, 7)
    stock_entry = next(e for e in entries("variant", sku) if e["action"] == "stock_adjusted")
    assert stock_entry["after"] == {"location": "bhiwandi", "available": 7}
    count = len(entries("variant", sku))
    v = admin_variant(ops, p.slug, sku)["version"]
    ops.patch(f"{ADMIN}/variants/{sku}", {"version": v - 1, "price": 4300})
    assert len(entries("variant", sku)) == count
    version = admin_product(ops, p.slug)["version"]
    assert ops.patch(f"/api/admin/products/{p.slug}", {"version": version, "status": "draft"}).status_code == 200
    assert entries("product", p.slug)[0]["after"] == {"status": "draft"}
    entry_id = price["id"]
    for method in ("PUT", "PATCH", "DELETE"):
        err(ops.request(method, f"{ADMIN}/audit/{entry_id}", {}), 405, "method_not_allowed", "Audit entries can't be changed.")
    assert next(e for e in entries("variant", sku) if e["id"] == entry_id) == price
    assert sup.get(f"{ADMIN}/audit").status_code == 200
    err(u.get(f"{ADMIN}/audit"), 403, "forbidden")
    date = day.strftime("%Y-%m-%d")
    totals = [u.get(f"/api/orders/{ns.ids[k]}").json() for k in ("o1", "o2")]
    gross = sum(o["payment"]["amount"] for o in totals)
    metrics = ops.get(f"{ADMIN}/metrics", params={"from": date, "to": date})
    assert metrics.status_code == 200, metrics.text
    m = metrics.json()
    assert (m["orders"], m["gross_sales"], m["refunds"], m["net_sales"], m["units_sold"]) == (2, gross, 0, gross, 3)
    assert m["average_order_value"] == half_up(gross, 2)
    bad_range = fields_of(ops.get(f"{ADMIN}/metrics", params={"from": "2030-02-01", "to": "2030-01-01"}))
    assert bad_range and set(bad_range) <= {"from", "to"}
    assert set(bad_range.values()) == {"Enter a date as YYYY-MM-DD, with From on or before To."}
    csv_r = ops.get(f"{ADMIN}/reports/orders.csv", params={"from": date, "to": date})
    assert csv_r.status_code == 200 and csv_r.headers["content-type"].startswith("text/csv")
    lines = csv_r.text.splitlines()
    assert lines[0] == "order_number,placed_at,customer_email,status,payment_status,subtotal,discount,shipping,tax,gift_card,total,refunded"
    rows = list(csv.DictReader(io.StringIO(csv_r.text)))
    assert [r["order_number"] for r in rows] == [ns.ids["o1"], ns.ids["o2"]]
    assert rows[0]["customer_email"] == ns.email("u") and rows[0]["subtotal"] == "4000"
    assert rows[1]["total"] == str(totals[1]["payment"]["amount"])
    inv = ops.get(f"{ADMIN}/reports/inventory.csv")
    assert inv.text.splitlines()[0] == "sku,product,colour,size,location,available,reserved,committed,on_hand"
    mine = [r for r in csv.DictReader(io.StringIO(inv.text)) if r["sku"] == sku]
    row = inventory_row(ops, sku)
    assert {r["location"]: int(r["available"]) for r in mine} == {x["location"]: x["available"] for x in row["locations"]}
    all_rows = list(csv.DictReader(io.StringIO(inv.text)))
    keys = [(r["sku"], r["location"]) for r in all_rows]
    assert keys == sorted(keys)


def test_wf_mobile_checkout_phone(browser: Browser, app_url: str) -> None:
    ns = Ns("phone")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),))
    ns.user("u")
    ns.address("ad", "u")
    ns.run(app_url)
    wait_indexed(app_url, [p])
    with ui(browser, app_url, f"/collections/luggage?material={slugify(p.material)}", cookie=ns.sessions["u"], size=PHONE) as page:
        layout(page)
        page.get_by_role("button", name="Menu").click()
        menu = page.get_by_role("dialog", name="Menu")
        for name in ("Collections", "Compare", "Care"):
            expect(menu.get_by_role("link", name=name)).to_be_visible()
        expect(menu.get_by_role("link", name=re.compile(r"^Wishlist"))).to_be_visible()
        expect(menu.get_by_role("link", name="Account", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        advance(page, DRAWER_MS)
        page.get_by_role("button", name="Filters", exact=True).click()
        sheet = page.get_by_role("dialog", name="Filters")
        sheet.get_by_role("checkbox", name="Cabin", exact=True).check()
        sheet.get_by_role("button", name="Show results").click()
        advance(page, DRAWER_MS)
        expect(page).to_have_url(re.compile("size=cabin"))
        layout(page)
        page.goto(f"{app_url}/products/{p.slug}")
        layout(page)
        page.get_by_role("button", name="Add to bag").click()
        expect(page.get_by_role("status", name="Cart updates")).to_contain_text(f"Added {p.label()} to your bag.")
        page.get_by_role("button", name=re.compile(r"^Bag, ")).click()
        advance(page, DRAWER_MS)
        page.get_by_role("link", name="Check out").click()
        expect(page).to_have_url(re.compile("/checkout/"))
        layout(page)
        ui_steps(page, ns.email("u"))
        fill_card(page, GOOD_CARD)
        pay_button(page).click()
        expect(confirmation(page)).to_be_visible()
        layout(page)
    assert len(ns.who(app_url, "u").get("/api/orders").json()) == 1


def test_wf_mobile_checkout_menu_keyboard(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/", size=PHONE) as page:
        opener = page.get_by_role("button", name="Menu")
        opener.focus()
        page.keyboard.press("Enter")
        dialog_trapped(page, page.get_by_role("dialog", name="Menu"), opener)
        layout(page)


def test_touch_gestures_and_targets(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/products/meridian-spinner", size=PHONE) as page:
        gallery = page.get_by_role("region", name="Gallery")
        tabs = gallery.get_by_role("tablist", name="Gallery views")
        x, y = middle(gallery.get_by_role("img", name=re.compile("view 1 of 4")).first)
        touch_drag(page, (x + 10, y), (x - 10, y))
        advance(page, GALLERY_MS)
        expect(tabs.get_by_role("tab", name="View 1")).to_have_attribute("aria-selected", "true")
        touch_drag(page, (x + SWIPE_MIN_PX, y), (x - SWIPE_MIN_PX, y))
        advance(page, GALLERY_MS)
        expect(tabs.get_by_role("tab", name="View 2")).to_have_attribute("aria-selected", "true")
        for role in ("button", "tab", "link", "slider"):
            for item in page.get_by_role(role).all():
                if item.is_visible():
                    box = item.bounding_box()
                    assert box["width"] >= TARGET_MIN_PX and box["height"] >= TARGET_MIN_PX, (role, item.inner_text()[:30], box)
        gauge = page.get_by_role("group", name="Gate Gauge")
        slider = gauge.get_by_role("slider", name="Bag position")
        sx, sy = middle(slider)
        touch_drag(page, (sx, sy), (sx + 120, sy))
        assert slider_value(slider) > 0
        advance(page, GAUGE_SETTLE_MS)
        expect(gauge).to_have_attribute("data-state", "settled")
    with ui(browser, app_url, "/products/meridian-spinner", size=PHONE, reduced=True) as page:
        gauge = page.get_by_role("group", name="Gate Gauge")
        slider = gauge.get_by_role("slider", name="Bag position")
        sx, sy = middle(slider)
        touch_drag(page, (sx, sy), (sx + 120, sy))
        expect(gauge).to_have_attribute("data-state", "settled")
    with ui(browser, app_url, "/collections/luggage", size=PHONE) as page:
        page.get_by_role("button", name="Filters", exact=True).click()
        sheet = page.get_by_role("dialog", name="Filters")
        advance(page, DRAWER_MS)
        box = sheet.bounding_box()
        touch_drag(page, (box["x"] + box["width"] / 2, box["y"] + 20), (box["x"] + box["width"] / 2, box["y"] + box["height"] - 10))
        advance(page, DRAWER_MS)
        expect_closed(page, "Filters")


def test_published_breakpoints(browser: Browser, app_url: str) -> None:
    ns = Ns("bp")
    p = ns.product("a")
    ns.user("u")
    ns.address("ad", "u")
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    cid = ready_checkout(ns.who(app_url, "u"), ns.ids["ad"], ns.email("u"))

    def columns(page: Page) -> int:
        return len({round(a.bounding_box()["x"]) for a in page.get_by_role("article").all() if a.is_visible()})

    for width, filters_button, cols in ((639, True, 1), (640, True, 2), (1023, True, 2), (1024, False, 3)):
        with ui(browser, app_url, "/collections/luggage", size=(width, 800)) as page:
            expect(page.get_by_role("article").first).to_be_visible()
            assert (page.get_by_role("button", name="Filters", exact=True).count() == 1) == filters_button, width
            assert (page.get_by_role("region", name="Filters").count() == 1) == (not filters_button), width
            assert columns(page) == cols, (width, columns(page))
    for width, side_by_side in ((1023, False), (1024, True)):
        with ui(browser, app_url, "/products/meridian-spinner", size=(width, 800)) as page:
            gallery = page.get_by_role("region", name="Gallery").bounding_box()
            colour = page.get_by_role("radiogroup", name="Colour", exact=True).bounding_box()
            if side_by_side:
                assert gallery["x"] < colour["x"] and colour["y"] < gallery["y"] + gallery["height"]
            else:
                assert colour["y"] >= gallery["y"] + gallery["height"] - 1
    for width, vertical in ((1023, False), (1024, True)):
        with ui(browser, app_url, f"/checkout/{cid}", cookie=ns.sessions["u"], size=(width, 800)) as page:
            items = [i.bounding_box() for i in page.get_by_role("list", name="Checkout progress").get_by_role("listitem").all()]
            assert len(items) == 4
            if vertical:
                assert abs(items[0]["x"] - items[1]["x"]) < 2 and items[1]["y"] > items[0]["y"]
            else:
                assert abs(items[0]["y"] - items[1]["y"]) < 2 and items[1]["x"] > items[0]["x"]
    for size in (PHONE, TABLET, DESKTOP):
        for path in ("/", "/collections/luggage", "/products/meridian-spinner"):
            with ui(browser, app_url, path, size=size) as page:
                layout(page)
        with ui(browser, app_url, f"/checkout/{cid}", cookie=ns.sessions["u"], size=size) as page:
            layout(page)


def test_wf_outage_recovery_search_down(browser: Browser) -> None:
    down = os.environ["APP_SEARCH_DOWN_URL"]
    with ui(browser, down, "/collections/luggage") as page:
        expect(page.get_by_role("status", name="Search notice")).to_have_text(SEARCH_NOTICE)
        expect(page.get_by_role("article").first).to_be_visible()
        box = page.get_by_role("region", name="Filters").get_by_role("checkbox", name="Cabin", exact=True)
        box.check()
        expect(page).to_have_url(re.compile("size=cabin"))
        expect(page.get_by_role("article").first).to_be_visible()
        expect(box).not_to_have_accessible_description(re.compile(r"\d"))
    for name, slug in (("Meridian", "meridian-spinner"), ("Atlas", "atlas-aluminium"), ("Harbour", "harbour-softside")):
        body = Actor(down).get("/api/search", params={"collection": "luggage", "size": "cabin", "q": name}).json()
        assert body["mode"] == "fallback" and body["notice"] == SEARCH_NOTICE
        assert slug in [r["slug"] for r in body["results"]]
    only_large = Actor(down).get("/api/search", params={"collection": "luggage", "size": "cabin", "q": "Kestrel"}).json()
    assert "kestrel-trunk" not in [r["slug"] for r in only_large["results"]]


def test_wf_outage_recovery_storage_down(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    ops = seed_ops(down)
    before = Actor(down).get("/api/products/meridian-spinner").json()["variants"][0]["images"]
    with ui(browser, down, "/admin/products/meridian-spinner", cookie=ops.cookie) as page:
        page.get_by_role("textbox", name="Alt text").fill("Meridian Spinner in Graphite")
        select(page.get_by_role("combobox", name="Image colour"), "Graphite")
        chooser_upload(page, page.get_by_role("button", name="Upload image"), "new.png", "image/png", png(9))
        expect(page.get_by_role("alert").filter(has_text=IMAGE_DOWN)).to_be_visible()
        expect(page.get_by_role("button", name="Try again")).to_be_visible()
    assert Actor(down).get("/api/products/meridian-spinner").json()["variants"][0]["images"] == before
    audit = ops.get(f"{ADMIN}/audit", params={"entity": "product", "entity_id": "meridian-spinner"}).json()
    assert all(e["action"] != "image_added" for e in audit)
    ns = Ns("imgok")
    p = ns.product("a")
    ns.user("ops", "operations")
    ns.run(app_url)
    with ui(browser, app_url, f"/admin/products/{p.slug}", cookie=ns.sessions["ops"]) as page:
        page.get_by_role("textbox", name="Alt text").fill(f"{p.name} in Graphite")
        select(page.get_by_role("combobox", name="Image colour"), "Graphite")
        chooser_upload(page, page.get_by_role("button", name="Upload image"), "new.png", "image/png", png(9))
        expect(page.get_by_role("status", name="Staff updates")).to_have_text(f"Image added to {p.name} in Graphite.")
    images = Actor(app_url).get(f"/api/products/{p.slug}").json()["variants"][0]["images"]
    assert any(i["alt"] == f"{p.name} in Graphite" for i in images)


def test_search_outage_fallback(app_url: str) -> None:
    down = os.environ["APP_SEARCH_DOWN_URL"]
    guest = Actor(down)
    assert guest.get("/api/health").json() == {"status": "unavailable"}
    body = guest.get("/api/search", params={"collection": "luggage", "size": "cabin", "sort": "price-asc"})
    assert body.status_code == 200
    data = body.json()
    assert data["mode"] == "fallback" and data["facets"] is None and data["notice"] == SEARCH_NOTICE
    prices = [r["min_price"] for r in data["results"]]
    assert prices == sorted(prices)
    for name, slug in (("Meridian", "meridian-spinner"), ("Atlas", "atlas-aluminium"), ("Harbour", "harbour-softside")):
        found = guest.get("/api/search", params={"collection": "luggage", "size": "cabin", "q": name}).json()
        assert slug in [r["slug"] for r in found["results"]]
    large = guest.get("/api/search", params={"collection": "luggage", "size": "cabin", "q": "Kestrel"}).json()
    assert "kestrel-trunk" not in [r["slug"] for r in large["results"]]
    hit = guest.get("/api/search", params={"q": "MERID"}).json()
    assert [r["slug"] for r in hit["results"]] == ["meridian-spinner"]
    assert guest.get("/api/search", params={"q": "cabbin"}).json()["results"] == []
    suggest = guest.get("/api/search/suggest", params={"q": "mer"}).json()
    assert suggest["suggestions"] == [] and suggest["mode"] == "fallback"
    ns = Ns("fallprice")
    p = ns.product("a")
    ns.user("ops", "operations")
    ns.run(down)
    ops = ns.who(down, "ops")
    new_price = p.v()["price"] + 1
    assert patch_variant(ops, p.slug, p.sku(), price=new_price).status_code == 200
    found = guest.get("/api/search", params={"q": p.name}).json()["results"]
    assert [r["min_price"] for r in found if r["slug"] == p.slug] == [new_price]


def test_image_upload_retry(app_url: str, meilisearch: Any) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    ns = Ns("retry")
    p = ns.product("a")
    ns.run(app_url)
    path = f"{ADMIN}/products/{p.slug}/images"
    f = {"colour": "Graphite", "alt": f"{p.name} in Graphite"}
    count = lambda: len(Actor(app_url).get(f"/api/products/{p.slug}").json()["variants"][0]["images"])
    base = count()
    dops, ops, key = seed_ops(down), seed_ops(app_url), idempotency_key()
    for _ in range(2):
        err(dops.upload(path, IMG_NAME, png(5), PNG_TYPE, f, key=key), 503, "storage_unavailable", IMAGE_DOWN)
    assert count() == base, "a failed upload publishes no image"
    failed_audit = ops.get(f"{ADMIN}/audit", params={"entity": "product", "entity_id": p.slug}).json()
    assert all(e["action"] != "image_added" for e in failed_audit), "a failed upload writes no audit entry"
    assert S3().keys(f"products/{p.slug}/") == []
    first = ops.upload(path, IMG_NAME, png(5), PNG_TYPE, f, key=key)
    assert first.status_code == 201, first.text
    again = ops.upload(path, IMG_NAME, png(5), PNG_TYPE, f, key=key)
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
    assert again.headers.get("Idempotency-Replayed") == "true"
    assert count() == base + 1
    err(ops.upload(path, IMG_NAME, png(5), PNG_TYPE, {**f, "alt": "A different alt text"}, key=key), 409, "idempotency_mismatch")
    stored = [k for k in S3().keys(f"products/{p.slug}/") if k.endswith(first.json()["id"])]
    assert len(stored) == 1 and S3().get(stored[0]) == png(5) and IMG_NAME not in stored[0]
    media = Actor(app_url).get(f"/media/products/{first.json()['id']}")
    assert media.status_code == 200 and media.content == png(5) and media.headers["content-type"].startswith("image/png")
    audit = ops.get(f"{ADMIN}/audit", params={"entity": "product", "entity_id": p.slug}).json()
    assert len([e for e in audit if e["action"] == "image_added"]) == 1
    err(ops.upload(path, "x.svg", SVG, "image/svg+xml", f, key=idempotency_key()), 422, "unsupported_file", UNSUPPORTED_IMAGE)
    assert "alt" in fields_of(ops.upload(path, IMG_NAME, png(6), PNG_TYPE, {**f, "alt": "no"}, key=idempotency_key()))
    assert "Idempotency-Key" in fields_of(ops.upload(path, IMG_NAME, png(6), PNG_TYPE, f))
    assert count() == base + 1


def test_run_manifest_and_health(app_url: str) -> None:
    assert Actor(app_url).get("/api/health").json() == {"status": "ok"}
    with app_copy() as copy:
        r = httpx.get(copy + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
    for var in ("APP_SEARCH_DOWN_URL", "APP_STORAGE_DOWN_URL"):
        r = httpx.get(os.environ[var] + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "unavailable"}


def test_grading_setup_route(app_url: str) -> None:
    body = {"users": [{"key": "x", "name": "N", "email": "nobody@example.test", "password": PASSWORD, "role": "customer"}]}
    unknown = httpx.post(app_url + "/api/no-such-route-here", json=body, timeout=HTTP_TIMEOUT)
    for headers in ({}, {"X-Grading-Token": "wrong-token-probe"}):
        r = httpx.post(app_url + "/api/grading/setup", json=body, headers=headers, timeout=HTTP_TIMEOUT)
        assert r.status_code == unknown.status_code == 404 and r.json() == unknown.json()
    assert "grading" not in httpx.get(app_url + "/", timeout=HTTP_TIMEOUT).text.lower()
    ns = Ns("setup")
    ns.user("u")
    res = ns.run(app_url)
    assert res["ids"] == {} or isinstance(res["ids"], dict)
    me = ns.who(app_url, "u").get("/api/me").json()["user"]
    assert me["email"] == ns.email("u") and me["role"] == "customer"
    bad = httpx.post(app_url + "/api/grading/setup", json={"users": [{"key": "x"}]},
                     headers={"X-Grading-Token": TOKEN}, timeout=HTTP_TIMEOUT)
    assert bad.status_code == 422 and bad.json()["error"] == "validation_failed"
    assert bad.json()["fields"] and set(bad.json()["fields"].values()) == {"Check this field."}


def test_error_shape_and_precedence(app_url: str) -> None:
    ns = Ns("errs")
    p = ns.product("a")
    ns.user("u")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    placed, _ = recent(app_url)
    ns.order("o1", "u", "ad", "placed", [("l1", p.sku(), 1)], placed)
    ns.cart("u", [(p.sku(), 1)])
    ns.run(app_url)
    u, ops, guest = ns.who(app_url, "u"), ns.who(app_url, "ops"), Actor(app_url)
    err(guest.get("/api/orders"), 401, "unauthenticated")
    err(guest.post("/api/returns", {"order_line_id": "x", "quantity": 0}), 401, "unauthenticated")
    err(u.post("/api/returns", {"order_line_id": "no-such-line", "quantity": 0, "reason": "", "outcome": "refund"}), 404, "not_found")
    err(u.patch(f"{ADMIN}/variants/{p.sku()}", {"version": 0, "price": 0}), 403, "forbidden")
    stale_variant = admin_variant(ops, p.slug, p.sku())["version"]
    assert patch_variant(ops, p.slug, p.sku(), compare_at=None).status_code == 200
    err(ops.patch(f"{ADMIN}/variants/{p.sku()}", {"version": stale_variant, "price": 0}), 412, "stale_version")
    stale_order = admin_order(ops, ns.ids["o1"])["version"]
    assert order_status(ops, ns.ids["o1"], "packed").status_code == 200
    err(ops.post(f"{ADMIN}/orders/{ns.ids['o1']}/status", {"version": stale_order, "status": "delivered"}), 412, "stale_version")
    err(ops.post(f"{ADMIN}/orders/{ns.ids['o1']}/status",
                 {"version": admin_order(ops, ns.ids["o1"])["version"], "status": "delivered"}), 409, "invalid_transition")
    cid = ready_checkout(u, ns.ids["ad"], ns.email("u"))
    err(place(u, cid, DECLINE_CARD, expiry=PAST_EXPIRY), 422, "validation_failed")
    err(guest.request("DELETE", "/api/health"), 405, "method_not_allowed")
    err(guest.get(f"/api/products/{ns.low}"), 404, "not_found")
    err(guest.post("/api/session", {"email": "nobody@example.test", "password": "wrong-password-1"}), 401, "invalid_credentials")
    f = fields_of(guest.post("/api/accounts", {"name": "", "email": "bad", "password": "short"}))
    assert f["name"] == "Enter your name in 1 to 80 characters." and f["email"] == "Enter an email address like name@example.com."
    assert f["password"] == "Use a password of at least 10 characters."
    err(guest.post("/api/accounts", {"name": "Dup", "email": ns.email("u"), "password": PASSWORD}), 409, "email_taken")
    shape = guest.get("/api/orders").json()
    assert set(shape) == {"error", "message"}


def test_server_boundary(app_url: str) -> None:
    guest = Actor(app_url)
    err(guest.post("/api/cart/lines", {"sku": "TAG-TAN-O", "quantity": 1}, headers={"Origin": "https://evil.example"}),
        403, "cross_origin")
    err(guest.request("PUT", "/api/orders", {}), 405, "method_not_allowed")
    err(guest.request("DELETE", "/api/config"), 405, "method_not_allowed")
    err(guest.request("POST", "/api/cart/lines", content=b'{"sku":"TAG-TAN-O","quantity":1}', headers={"Content-Type": "text/plain"}),
        415, "unsupported_media_type")
    huge = guest.request("POST", "/api/cart/codes", content=b'{"code":"' + b"a" * JSON_LIMIT + b'"}',
                         headers={"Content-Type": "application/json"})
    err(huge, 413, "too_large", "This request is too large.")
    fits = guest.request("POST", "/api/cart/codes", content=b'{"code":"' + b"a" * (JSON_LIMIT - 11) + b'"}',
                         headers={"Content-Type": "application/json"})
    assert fits.status_code not in (413, 415), fits.text
    for path in ("/.env", "/package.json", "/package-lock.json", "/tsconfig.json", "/src/", "/.git/config"):
        assert guest.get(path).status_code == 404, path
    home = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT)
    urls = re.findall(r'(?:src|href)="(/[^"#?]+\.(?:js|css|mjs))', home.text)
    bodies = [home.text]
    for url in urls:
        asset = httpx.get(app_url + url, timeout=HTTP_TIMEOUT)
        bodies.append(asset.text)
        assert httpx.get(app_url + url + ".map", timeout=HTTP_TIMEOUT).status_code == 404, url
    for name in SECRET_ENV:
        value = os.environ.get(name, "")
        if value:
            assert all(value not in b for b in bodies), f"{name} leaked into a served asset"


def test_keyboard_dialogs(browser: Browser, app_url: str) -> None:
    ns = Ns("dialogs")
    p = ns.product("a")
    q = ns.product("b")
    ns.user("u")
    ns.address("ad", "u")
    placed, delivered = recent(app_url)
    ns.order("o1", "u", "ad", "delivered", [("l1", p.sku(), 1)], placed, delivered)
    ns.order("o2", "u", "ad", "placed", [("l2", q.sku(), 1)], placed)
    ns.registration("w1", "l1")
    ns.run(app_url)
    with ui(browser, app_url, f"/orders/{ns.ids['o1']}", cookie=ns.sessions["u"]) as page:
        line = page.get_by_role("group", name=p.label())
        for button, name in (("Request return", "Request a return"), ("Send back from trial", "Send back from trial"),
                             ("Make a warranty claim", "Warranty claim")):
            opener = line.get_by_role("button", name=button)
            opener.focus()
            page.keyboard.press("Enter")
            dialog_trapped(page, page.get_by_role("dialog", name=name), opener)
    with ui(browser, app_url, f"/orders/{ns.ids['o2']}", cookie=ns.sessions["u"]) as page:
        opener = page.get_by_role("button", name="Cancel order", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        alert = page.get_by_role("alertdialog", name="Cancel this order?")
        expect(alert.get_by_role("button", name="Keep order")).to_be_focused()
        dialog_trapped(page, alert, opener)
    with ui(browser, app_url, "/", cookie=ns.sessions["u"]) as page:
        opener = page.get_by_role("button", name=re.compile(r"^Bag, "))
        opener.focus()
        page.keyboard.press("Enter")
        dialog_trapped(page, page.get_by_role("dialog", name="Your bag"), opener)
    with ui(browser, app_url, "/products/meridian-spinner") as page:
        tab = page.get_by_role("region", name="Gallery").get_by_role("tab", name="View 1")
        tab.focus()
        page.keyboard.press("z")
        dialog_trapped(page, page.get_by_role("dialog", name="Zoomed image"), tab)
        assert outline_ok(page.get_by_role("button", name="Add to bag"))
    with ui(browser, app_url, "/collections/luggage", size=TABLET) as page:
        opener = page.get_by_role("button", name="Filters", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog_trapped(page, page.get_by_role("dialog", name="Filters"), opener)
    with ui(browser, app_url, "/", size=PHONE) as page:
        opener = page.get_by_role("button", name="Menu")
        opener.focus()
        page.keyboard.press("Enter")
        dialog_trapped(page, page.get_by_role("dialog", name="Menu"), opener)


def test_live_regions(browser: Browser, app_url: str) -> None:
    ns = Ns("regions")
    p = ns.product("a", sizes=(("cabin", 55, 40, 20, 2.9, 4000),))
    other = ns.product("b")
    code = ns.discount("L")
    ns.user("u")
    ns.user("ops", "operations")
    ns.address("ad", "u")
    ns.cart("u", [(other.sku(), 1)])
    ns.run(app_url)
    wait_indexed(app_url, [p])
    who, undo = ns.who(app_url, "u"), config(app_url)["cart_undo_seconds"]
    with ui(browser, app_url, f"/collections/all?material={slugify(p.material)}", cookie=ns.sessions["u"]) as page:
        updates = page.get_by_role("status", name="Cart updates")
        page.get_by_role("button", name=f"Quick add {p.name}").click()
        expect(updates).to_contain_text(f"Added {p.label()} to your bag. Bag total ₹")
        total = who.get("/api/cart").json()["totals"]["total"]
        expect(updates).to_have_text(f"Added {p.label()} to your bag. Bag total {inr(total)}.")
        page.goto(app_url + "/bag")
        qty = page.get_by_role("group", name=p.label()).get_by_role("spinbutton", name="Quantity", exact=True)
        qty.focus()
        page.keyboard.press("ArrowUp")
        expect(updates).to_have_text("Quantity updated to 2.")
        page.get_by_role("button", name=f"Remove {p.name}").click()
        expect(updates).to_have_text(f"Removed {p.name}. Undo available for {undo} seconds.")
        box = page.get_by_role("textbox", name="Discount or gift card code")
        box.fill(code)
        box.press("Enter")
        expect(updates).to_have_text(f"Code {code} applied.")
        box.fill(f"NOPE{ns.code}")
        box.press("Enter")
        expect(page.get_by_role("alert").filter(has_text=MSG["code_invalid"]).first).to_be_visible()
        described = box.get_attribute("aria-describedby")
        assert described and MSG["code_invalid"] in page.evaluate(
            "ids => ids.split(' ').map(i => document.getElementById(i)?.textContent ?? '').join(' ')", described)
    cid = who.post("/api/checkout").json()["id"]
    with ui(browser, app_url, f"/checkout/{cid}", cookie=ns.sessions["u"]) as page:
        page.get_by_role("button", name="Continue").click()
        summary = page.get_by_role("alert").filter(has_text="There is a problem")
        expect(summary).to_be_visible()
        assert summary.get_by_role("link").count() >= 1
        email = page.get_by_role("textbox", name="Email")
        described = email.get_attribute("aria-describedby")
        assert described and "Enter an email address like name@example.com." in page.evaluate(
            "ids => ids.split(' ').map(i => document.getElementById(i)?.textContent ?? '').join(' ')", described)
        expect(page.get_by_role("status", name="Checkout updates")).to_have_text("Step 1 of 4: Contact")
    with ui(browser, app_url, f"/admin/products/{p.slug}", cookie=ns.sessions["ops"]) as page:
        group = page.get_by_role("group", name=p.sku())
        group.get_by_role("textbox", name="Price", exact=True).fill("4300")
        group.get_by_role("button", name=f"Save {p.sku()}").click()
        expect(page.get_by_role("status", name="Staff updates")).to_have_text(f"Saved {p.sku()}.")


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/products/meridian-spinner") as page:
        assert motion_of(page) == "full"
    with ui(browser, app_url, "/products/meridian-spinner", reduced=True) as page:
        assert motion_of(page) == "reduced"
        gallery = page.get_by_role("region", name="Gallery")
        expect(gallery).to_have_attribute("data-motion-ms", "0")
        gallery.get_by_role("tablist", name="Gallery views").get_by_role("tab", name="View 2").click()
        expect(gallery).to_have_attribute("data-state", "idle")
        expect(gallery.get_by_role("img", name=view_alt("Meridian Spinner", "Graphite", 2, 4)).first).to_be_visible()
        gauge = page.get_by_role("group", name="Gate Gauge")
        expect(gauge).to_have_attribute("data-motion-ms", "0")
        slider = gauge.get_by_role("slider", name="Bag position")
        slider.focus()
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        expect(gauge).to_have_attribute("data-state", "settled")
        expect(gauge).to_have_attribute("data-settled", "inside")
        page.get_by_role("button", name=re.compile(r"^Bag, ")).click()
        drawer = page.get_by_role("dialog", name="Your bag")
        expect(drawer).to_have_attribute("data-motion-ms", "0")
        expect(drawer).to_have_attribute("data-state", "open")
        page.keyboard.press("Escape")
        expect_closed(page, "Your bag")
        expect(page.get_by_role("status", name="Selected variant")).to_contain_text("SKU MER-GRA-C")


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k] for k in ("install", "build", "serve"))
    assert "npm ci" in manifest["install"]


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"
    assert "Schibsted Grotesk" in notices


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"licences outside the allowlist: {bad[:20]}"


def test_if_no_extra_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "amqplib", "bullmq", "mongodb", "mongoose",
              "lmdb", "level", "leveldown", "nedb", "lowdb"}
    names = {p.name for p in shipped_packages()}
    assert not (names & banned), names & banned
    files = [f for ext in ("*.sqlite", "*.sqlite3", "*.db") for f in Path("/app").rglob(ext) if "node_modules" not in f.parts]
    assert not files, files


def test_if_same_origin_assets(app_url: str) -> None:
    pages = [httpx.get(app_url + path, timeout=HTTP_TIMEOUT).text
             for path in ("/", "/collections/luggage", "/products/meridian-spinner")]
    assets = []
    for html in pages:
        for url in re.findall(r'(?:src|href)="(/[^"#?]+\.(?:js|css|mjs))', html):
            assets.append(httpx.get(app_url + url, timeout=HTTP_TIMEOUT).text)
    for body in pages + assets:
        for url in re.findall(r'(?:src|href)=["\'](https?://[^"\']+)|url\(["\']?(https?://[^)"\']+)', body):
            target = url[0] or url[1]
            assert same_origin(target, app_url), f"cross-origin reference {target}"


def test_if_services_unchanged(app_url: str, meilisearch: Any) -> None:
    assert Postgres().tables()
    assert "products" in meilisearch.indexes()
    assert isinstance(S3().keys("products/"), list)
    assert Actor(app_url).get("/api/health").status_code == 200


def test_if_lockfile_typescript() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    assert lock.get("lockfileVersion")
    sources = [f for f in Path("/app").rglob("*.ts") if "node_modules" not in f.parts and not f.name.endswith(".d.ts")]
    assert sources, "no TypeScript source files under /app"
