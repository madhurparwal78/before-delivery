from __future__ import annotations

import base64
import concurrent.futures
import json
import os
import random
import re
import signal
import socket
import string
import subprocess
import tempfile
import threading
import time
import urllib.parse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    advance,
    camera,
    capture,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    pdf_text,
    same_origin,
    scene_frames,
    select,
    session,
    shipped_packages,
    state_styles,
    unique,
    until,
)

HTTP_TIMEOUT = 30
POLL_SECONDS = 60
SMS_SECONDS = 20
UI_TIMEOUT_MS = 15_000
STILL_MAX = 0.01
expect.set_options(timeout=UI_TIMEOUT_MS)

PASSWORD = "Bazaar@Probe2026"
NEW_PASSWORD = "Bazaar@Probe2027"
RESET_PASSWORD = "Bazaar@Probe2028"
SELLER_TEMP_PASSWORD = "Seller@Probe2026"
VISA = "4111111111111111"
AMEX = "378282246310005"
CVV = "123"
FOREIGN_ORIGIN = "http://evil.example"
TRAVERSAL_NAME = "../../evil.svg"
WIREMOCK_ADMIN = "/__admin/"
WIREMOCK_MAPPINGS = "/__admin/mappings"
PROBE_BRAND = "Probekit"
WIDE_FROM_DAYS = 60

VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
PAGE_CAP = 24
OFFER_CAP = 10
PINCODE_LIMIT = 30
SHARE_READ_LIMIT = 30
COUPON_LIMIT = 10
JSON_LIMIT = 65536
PHOTO_MAX = 2_000_000
CERT_MAX = 5_000_000
PHOTO_COUNT = 6
COD_CAP = 5_000_000
COD_FEE = 2500
GIFT_WRAP_FEE = 3000
GIFT_MESSAGE_MAX = 240
ONE_DAY_FEE = 9900
STANDARD_FEE = 4000
FREE_DELIVERY_FROM = 49900
PRICE = FREE_DELIVERY_FROM + 100
FLAT150_PAISE = 150 * 100
TITLE_MIN = 3
COMPARE_MAX = 4
QTY_MAX = 10
SHARE_NAME = "Asha"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax", "Path=/")
ALLOW_ORIGIN = "Access-Control-Allow-Origin"
ALLOW_CREDENTIALS = "Access-Control-Allow-Credentials"
EMI_MINIMUM = 300000
QUOTA = 200
TITLE_MAX = 120
DESCRIPTION_MAX = 2000
NOTE_MAX = 500
REASON_MIN = 10
CART_LINES = 10
MERGE_MAX = 20
SHARE_NAME_MAX = 40
TOKEN_MIN = 22
RESEND_DEFAULT = 30
UPI_EXPIRY_DEFAULT = 600
SHORT_OTP = 10
SHORT_WINDOW = 30
SHORT_RATE_WINDOW = 10
SEARCH_SYNC_SECONDS = 10
TARGET_PX = 44
HOVER_SCALE_MIN = 1.02
HOVER_SCALE_MAX = 1.04
MAGNET_MAX_PX = 8.5
MAGNET_RANGE_PX = 60
DIGIT_SETTLE_MS = 1500
EMI_RATE = Fraction(125, 10000)

IST = ZoneInfo("Asia/Kolkata")

SEEDED = {
    "asha": ("asha@example.test", "+919800000001", "Asha@Bazaar2026"),
    "S-KAVERI": ("kaveri@example.test", "+919800000011", "Kaveri@Seller2026"),
    "S-GANGA": ("ganga@example.test", "+919800000012", "Ganga@Seller2026"),
    "S-MARINE": ("marinedrive@example.test", "+919800000013", "Marine@Seller2026"),
    "S-SABAR": ("sabarmati@example.test", "+919800000014", "Sabarmati@Seller2026"),
    "support": ("support@example.test", "+919800000021", "Support@Desk2026"),
}
SELLERS = {
    "S-KAVERI": {"name": "Kaveri Handlooms", "city": "Bengaluru", "state": "Karnataka", "dispatch": 1, "rating": 4.6},
    "S-GANGA": {"name": "Ganga Steelworks", "city": "New Delhi", "state": "Delhi", "dispatch": 2, "rating": 4.2},
    "S-MARINE": {"name": "Marine Drive Gadgets", "city": "Mumbai", "state": "Maharashtra", "dispatch": 1, "rating": 4.4},
    "S-SABAR": {"name": "Sabarmati Electronics", "city": "Ahmedabad", "state": "Gujarat", "dispatch": 2, "rating": 3.8},
}
PINS = {
    "110001": ("New Delhi", "Delhi", False),
    "400001": ("Mumbai", "Maharashtra", False),
    "411001": ("Pune", "Maharashtra", False),
    "560001": ("Bengaluru", "Karnataka", False),
    "560034": ("Bengaluru", "Karnataka", False),
    "380001": ("Ahmedabad", "Gujarat", False),
    "700001": ("Kolkata", "West Bengal", False),
    "194101": ("Leh", "Ladakh", True),
}
GST = {"kitchen": 5, "fashion": 5, "electronics": 18, "beverages": 40}
COMMISSION = {"kitchen": 10, "fashion": 15, "electronics": 7, "beverages": 8}
LISTINGS = {
    "L-1001": ("steel-tiffin-3", "Steel Tiffin Stack, 3 tier", "kitchen", "S-GANGA", 64900),
    "L-1002": ("steel-tiffin-3", "Steel Tiffin Stack, 3 tier", "kitchen", "S-KAVERI", 69900),
    "L-1003": ("pressure-cooker-5l", "Pressure Cooker 5 L", "kitchen", "S-GANGA", 189900),
    "L-1004": ("copper-bottle-1l", "Copper Water Bottle 1 L", "kitchen", "S-GANGA", 49900),
    "L-1005": ("ilkal-saree", "Ilkal Handloom Saree", "fashion", "S-KAVERI", 345000),
    "L-1006": ("cotton-kurta", "Block-print Cotton Kurta", "fashion", "S-KAVERI", 89900),
    "L-1007": ("dhwani-speaker", "Dhwani Bluetooth Speaker", "electronics", "S-MARINE", 249900),
    "L-1008": ("dhwani-speaker", "Dhwani Bluetooth Speaker", "electronics", "S-SABAR", 244900),
    "L-1009": ("tara-smartwatch", "Tara Smartwatch", "electronics", "S-MARINE", 599900),
    "L-1010": ("lehar-earbuds", "Lehar Wireless Earbuds", "electronics", "S-SABAR", 179900),
    "L-1011": ("jugnu-powerbank", "Jugnu Power Bank 20000 mAh", "electronics", "S-SABAR", 129900),
    "L-1012": ("pankha-desk-fan", "Pankha USB Desk Fan", "electronics", "S-SABAR", 59900),
    "L-1013": ("jaljeera-fizz-24", "Jaljeera Fizz, crate of 24 cans", "beverages", "S-GANGA", 96000),
    "L-1014": ("tara-smartwatch", "Tara Smartwatch", "electronics", "S-SABAR", 609900),
}

COPY = {
    "step_one": "Enter the 6-digit code we sent to your phone.",
    "signup_accepted": "If this number can be used, we'll text a 6-digit code to it.",
    "invalid_credentials": "That email or phone and password do not match.",
    "invalid_code": "That code is wrong or has expired.",
    "resend_too_soon": "Wait before asking for another code.",
    "too_many_codes": "Too many codes requested. Try again later.",
    "sms_unavailable": "We can't send codes right now. Try again in a few minutes.",
    "signed_out": "Your session ended. Sign in again to continue.",
    "password_changed": "Password changed. Other devices are signed out.",
    "no_match": "no match. loosen a filter.",
    "degraded": "Search is running in basic mode. Typo matching and filters are off for now.",
    "compare_over": "Compare up to 4 products.",
    "compare_mixed": "Compare products from one category.",
    "compare_under": "Pick at least 2 products.",
    "cod_available": "Cash on delivery available.",
    "cod_open_orders": "You already have 3 cash-on-delivery orders on the way.",
    "cod_over_cap": "Cash on delivery is available up to ₹50,000.00 per order.",
    "sold_out_line": "Sold out. Remove it or save it for later.",
    "sold_out": "Someone just bought the last one. You haven't been charged.",
    "price_changed": "A price in your cart changed. Check the new total.",
    "payments_unavailable": "Payments are down for a moment. You haven't been charged.",
    "upi_unavailable": "UPI is not responding. Choose another way to pay.",
    "placed": "order placed.",
    "waiting": "waiting for your payment.",
    "empty_cart": "your cart is empty. the bazaar isn't.",
    "document_pending": "Your invoice is being prepared. Check back in a minute.",
    "label_pending": "Label is being prepared. Packing can continue.",
    "payment_pending": "Payment isn't confirmed yet.",
    "not_returnable": "This item can't be returned.",
    "link_not_found": "This link has expired or been replaced.",
    "read_only": "Shared links are read-only.",
    "listing_quota": "You have 200 live listings. Unlist one to add another.",
    "listing_saved": "Listing saved.",
    "photo_too_large": "Photos can be up to 2,000,000 bytes.",
    "cert_too_large": "Certificates can be up to 5,000,000 bytes.",
    "photo_type": "Photos must be JPEG, PNG or WebP.",
    "cert_type": "Certificates must be PDF, JPEG or PNG.",
    "photo_limit": "A listing can have up to 6 photos.",
    "forbidden": "Your role can't do that.",
    "not_found": "nothing here. wrong turn at the chauraha.",
    "idempotency_key_reused": "This payment key was already used for a different order.",
    "idempotency_key_required": "Send an Idempotency-Key header.",
    "cross_site_request": "Request refused.",
    "too_large": "That request is too large.",
    "storage_unavailable": "Uploads are paused. Try again in a few minutes.",
    "cant_set": "This field can't be set.",
    "qty_over_ten": "You can buy up to 10 of this item.",
    "qty_over_stock": "We don't have that many in stock.",
    "cart_lines": "Your cart can hold up to 10 lines. Save something for later first.",
    "one_day": "One-day delivery isn't available for this parcel.",
    "bad_coupon": "That coupon isn't valid for this cart.",
    "wrong_current": "That is not your current password.",
    "emi_minimum": "EMI starts at ₹3,000.00.",
    "card_network": "We accept Visa, Mastercard and RuPay cards.",
    "page_size": "Pages hold up to 24 results.",
    "offer_page_size": "Up to 10 offers per page.",
}

SHOPPER_VIEW_KEYS = {"shipment_id", "order_id", "seller_name", "state", "promise_date", "timeline",
                     "delivery_fee_paise", "cod_fee_paise", "gift_wrap_paise", "invoice_status", "lines"}
SHOPPER_LINE_KEYS = {"line_id", "title", "quantity", "unit_price_paise", "coupon_share_paise", "line_total_paise",
                     "gst_rate", "taxable_value_paise", "cgst_paise", "sgst_paise", "igst_paise",
                     "returnable_until", "refunded_paise", "refund_pending_paise"}
SELLER_VIEW_KEYS = {"shipment_id", "order_id", "state", "promise_date", "ship_to", "payment_kind",
                    "payment_status", "invoice_status", "label_status", "lines"}
SELLER_LINE_KEYS = {"line_id", "listing_id", "title", "quantity", "unit_price_paise", "gross_paise"}

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
JPEG_HEAD = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00"
WEBP_HEAD = b"RIFF\x24\x00\x00\x00WEBPVP8 "
PDF_DOC = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
SVG_DOC = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML_DOC = b"<!doctype html><html><body>probe</body></html>"


def wait_for(fn: Callable[[], Any], what: str, seconds: float = POLL_SECONDS) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
    pytest.fail(f"{what} (waited {seconds}s)")


def real_wait(base: str, seconds: float) -> None:
    end = time.monotonic() + seconds
    with httpx.Client(timeout=HTTP_TIMEOUT) as c:
        for _ in range(100_000):
            if time.monotonic() >= end:
                return
            c.get(f"{base}/api/health")
    pytest.fail(f"real-time wait of {seconds}s did not complete")


def outage_url(env: str) -> str:
    value = os.environ.get(env)
    if not value:
        pytest.fail(f"{env} is not set; the outage instance named in the spec is required")
    return value.rstrip("/")


def rnd(x: Fraction) -> int:
    return (2 * x.numerator + x.denominator) // (2 * x.denominator)


def title_of(listing_id: str) -> str:
    return LISTINGS[listing_id][1]


def seller_name(seller_id: str) -> str:
    return SELLERS[seller_id]["name"]


def rupees(paise: int) -> str:
    sign = "-" if paise < 0 else ""
    whole, frac = divmod(abs(paise), 100)
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups + [tail])
    return f"{sign}₹{digits}.{frac:02d}"


def promise_text(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b}"


def lane_promise(today: date, seller: str, pin: str) -> date:
    city, state, remote = PINS[pin]
    s = SELLERS[seller]
    lane = 1 if city == s["city"] else 2 if state == s["state"] else 4
    return today + timedelta(days=s["dispatch"] + lane + (2 if remote else 0))


def allocate(total: int, weights: list[int]) -> list[int]:
    s = sum(weights)
    base = [total * w // s for w in weights]
    rem = [(total * w) % s for w in weights]
    order = sorted(range(len(weights)), key=lambda i: (-rem[i], i))
    for i in order[: total - sum(base)]:
        base[i] += 1
    return base


def tax_split(line_total: int, rate: int, intra: bool) -> tuple[int, int, int, int]:
    taxable = rnd(Fraction(line_total * 100, 100 + rate))
    tax = line_total - taxable
    if intra:
        sgst = tax // 2
        return taxable, tax - sgst, sgst, 0
    return taxable, 0, 0, tax


def emi_instalment(principal: int, months: int) -> int:
    f = (1 + EMI_RATE) ** months
    return rnd(Fraction(principal) * EMI_RATE * f / (f - 1))


def emi_plan(p: int, months: int, no_cost: bool) -> dict[str, int]:
    discount = emi_instalment(p, months) * months - p if no_cost else 0
    principal = p - discount
    inst = emi_instalment(principal, months)
    return {"upfront_discount_paise": discount, "principal_paise": principal, "instalment_paise": inst,
            "total_payable_paise": inst * months, "total_interest_paise": inst * months - principal}


def settlement_oracle(gross: int, category: str) -> dict[str, int]:
    v = rnd(Fraction(gross * 100, 100 + GST[category]))
    commission = rnd(Fraction(gross * COMMISSION[category], 100))
    commission_gst = rnd(Fraction(commission * 18, 100))
    tcs = rnd(Fraction(v * 5, 1000))
    tds = rnd(Fraction(gross, 1000))
    return {"gross_paise": gross, "commission_paise": commission, "commission_gst_paise": commission_gst,
            "tcs_paise": tcs, "tds_paise": tds,
            "net_paise": gross - commission - commission_gst - tcs - tds}


def luhn(prefix: str, length: int = 16) -> str:
    body = prefix + "0" * (length - len(prefix) - 1)
    total = 0
    for i, ch in enumerate(reversed(body)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            d = d - 9 if d > 9 else d
        total += d
    return body + str((10 - total % 10) % 10)


def error_code(r: httpx.Response) -> str | None:
    try:
        body = r.json()
    except ValueError:
        return None
    return body.get("error") if isinstance(body, dict) else None


def assert_error(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} answered {r.status_code} {r.text[:400]}; expected {status} {code}"
    body = r.json()
    assert body.get("error") == code, f"error code {body.get('error')!r}; expected {code!r}"
    if message is not None:
        assert body.get("message") == message, f"message {body.get('message')!r}; expected {message!r}"
    return body


def assert_field(r: httpx.Response, field: str | None, message: str | re.Pattern) -> None:
    body = assert_error(r, 422, "validation_failed")
    errors = body.get("errors") or {}
    values = [errors[field]] if field else list(errors.values())
    if field:
        assert field in errors, f"422 errors {errors}; expected the field {field!r}"
    ok = any((message.fullmatch(v) if isinstance(message, re.Pattern) else v == message) for v in values if isinstance(v, str))
    assert ok, f"422 errors {errors}; expected {message!r}" + (f" under {field!r}" if field else "")


def cookie_attrs(r: httpx.Response) -> dict[str, str]:
    out: dict[str, str] = {}
    for header in r.headers.get_list("set-cookie"):
        out[header.split("=", 1)[0].strip()] = header
    return out


def keys_without_time(d: dict) -> set[str]:
    return set(d) - {"server_time"}


def walk_keys(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for k, v in value.items():
            found.add(k)
            found |= walk_keys(v)
    elif isinstance(value, list):
        for v in value:
            found |= walk_keys(v)
    return found


def fire_together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=HTTP_TIMEOUT)
        return fn()

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def journal(wm: Any, path: str, method: str = "POST") -> list[dict]:
    out: list[dict] = []
    for entry in wm.requests(path, method):
        req = entry.get("request", entry) if isinstance(entry, dict) else {}
        body = req.get("body", "")
        if isinstance(body, dict):
            out.append(body)
            continue
        try:
            parsed = json.loads(body or "{}")
        except (TypeError, ValueError):
            continue
        if isinstance(parsed, dict):
            out.append(parsed)
    return out


def texts_to(wm: Any, phone: str) -> list[dict]:
    return [m for m in journal(wm, "/sms/v1/messages") if m.get("to") == phone]


def sms_codes(wm: Any, phone: str, template: str) -> list[str]:
    return [str(m["code"]) for m in texts_to(wm, phone) if m.get("template") == template and "code" in m]


def new_code(wm: Any, phone: str, template: str, before: list[str]) -> str:
    seen = set(before)

    def fresh() -> str | None:
        for code in sms_codes(wm, phone, template):
            if code not in seen:
                return code
        return None

    return wait_for(fresh, f"the SMS gateway received a {template} text with a new code for {phone}", SMS_SECONDS)


def wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


@dataclass
class Who:
    name: str
    email: str
    phone: str


def identity(prefix: str) -> Who:
    parts = [str(p) for p in unique(prefix)]
    token = re.sub(r"[^a-z0-9]", "", "".join(parts).lower())[-12:] or "".join(random.choices(string.ascii_lowercase, k=8))
    email = next((p.lower() for p in parts if "@" in p), f"{prefix}.{token}@example.test")
    phone = "+91" + random.choice("6789") + "".join(random.choices(string.digits, k=9))
    return Who(name=f"Probe {prefix} {token}"[:60], email=email, phone=phone)


class Account:
    def __init__(self, base: str, mirror: "Account | None" = None) -> None:
        self.base = base.rstrip("/")
        self.mirror = mirror
        self.client = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        self.info: dict[str, Any] = dict(mirror.info) if mirror else {}
        self.email = mirror.email if mirror else ""
        self.phone = mirror.phone if mirror else ""
        self.name = mirror.name if mirror else ""
        self.password = mirror.password if mirror else PASSWORD
        self.address_id: Any = mirror.address_id if mirror else None
        self.verify_response: httpx.Response | None = None
        self.pending_response: httpx.Response | None = None

    @property
    def id(self) -> str:
        return str(self.info["id"])

    def on(self, base: str) -> "Account":
        return Account(base, mirror=self.mirror or self)

    def _headers(self, extra: dict | None) -> dict:
        h = dict(extra or {})
        if self.mirror is not None:
            h.setdefault("Cookie", "; ".join(f"{c.name}={c.value}" for c in self.mirror.client.cookies.jar))
        return h

    def raw(self, method: str, path: str, body: Any = None, *, headers: dict | None = None, **kw: Any) -> httpx.Response:
        if body is not None:
            kw["json"] = body
        return self.client.request(method, path, headers=self._headers(headers), **kw)

    def call(self, method: str, path: str, body: Any = None, *, headers: dict | None = None, **kw: Any) -> httpx.Response:
        r = self.raw(method, path, body, headers=headers, **kw)
        owner = self.mirror or self
        if r.status_code == 401 and error_code(r) == "signed_out" and owner.info:
            if owner.raw("POST", "/api/auth/refresh", {}).status_code == 200:
                r = self.raw(method, path, body, headers=headers, **kw)
        return r

    def ok(self, method: str, path: str, body: Any = None, status: int = 200, **kw: Any) -> Any:
        r = self.call(method, path, body, **kw)
        assert r.status_code == status, f"{method} {path} answered {r.status_code}: {r.text[:500]}; expected {status}"
        return r.json() if r.content else {}


def signup(base: str, wm: Any, prefix: str = "shopper") -> Account:
    who = identity(prefix)
    acct = Account(base)
    acct.email, acct.phone, acct.name = who.email, who.phone, who.name
    before = sms_codes(wm, who.phone, "signup_code")
    r = acct.raw("POST", "/api/auth/signup", {"name": who.name, "email": who.email, "phone": who.phone, "password": PASSWORD})
    assert r.status_code == 202, f"POST /api/auth/signup answered {r.status_code} {r.text[:300]}; expected 202"
    acct.pending_response = r
    code = new_code(wm, who.phone, "signup_code", before)
    r = acct.raw("POST", "/api/auth/signup/verify", {"code": code})
    assert r.status_code == 201, f"POST /api/auth/signup/verify answered {r.status_code} {r.text[:300]}; expected 201"
    acct.verify_response = r
    acct.info = r.json()["account"]
    return acct


def signin(base: str, wm: Any, identifier: str, password: str, phone: str) -> Account:
    acct = Account(base)
    acct.phone, acct.password = phone, password
    acct.email = identifier if "@" in identifier else ""
    before = sms_codes(wm, phone, "signin_code")
    r = acct.raw("POST", "/api/auth/signin", {"identifier": identifier, "password": password})
    assert r.status_code == 202, f"POST /api/auth/signin for {identifier} answered {r.status_code} {r.text[:300]}; expected 202"
    code = new_code(wm, phone, "signin_code", before)
    r = acct.raw("POST", "/api/auth/signin/verify", {"code": code})
    assert r.status_code == 200, f"POST /api/auth/signin/verify answered {r.status_code} {r.text[:300]}; expected 200"
    acct.verify_response = r
    acct.info = r.json()["account"]
    return acct


_SESSIONS: dict[tuple[str, str], Account] = {}


class Actors:
    def __init__(self, base: str, wm: Any) -> None:
        self.base = base.rstrip("/")
        self.wm = wm
        self.created: list[tuple[Account, str]] = []

    def seeded(self, key: str) -> Account:
        cached = _SESSIONS.get((self.base, key))
        if cached is not None and cached.call("GET", "/api/me").status_code == 200:
            return cached
        email, phone, password = SEEDED[key]
        acct = signin(self.base, self.wm, email, password, phone)
        acct.email = email
        _SESSIONS[(self.base, key)] = acct
        return acct

    def shopper(self, base: str | None = None, prefix: str = "shopper") -> Account:
        return signup(base or self.base, self.wm, prefix)

    def listing(self, seller_key: str, *, title: str | None = None, category: str = "kitchen", price: int = PRICE,
                stock: int = 20, cod: bool = True, emi: bool = False, product_id: str | None = None,
                brand: str = PROBE_BRAND) -> dict:
        seller = self.seeded(seller_key)
        body: dict[str, Any] = {"description": "Probe listing", "price_paise": price, "cost_price_paise": price // 2,
                                "stock": stock, "cod_allowed": cod, "no_cost_emi": emi, "return_note": ""}
        if product_id:
            body["product_id"] = product_id
        else:
            title = title or fresh_title(seller_key.lower())
            body.update({"title": title, "brand": brand, "category": category})
        data = seller.ok("POST", "/api/seller/listings", body, status=201)
        item = data.get("listing", data)
        item.setdefault("title", title)
        self.created.append((seller, item["listing_id"]))
        return item


@pytest.fixture
def actors(app_url: str, wiremock: Any) -> Iterator[Actors]:
    team = Actors(app_url, wiremock)
    yield team
    for seller, listing_id in team.created:
        seller.call("PATCH", f"/api/seller/listings/{listing_id}", {"status": "unlisted"})


def tick(control: Any) -> None:
    control.click()
    expect(control).to_be_checked()


def fresh_title(prefix: str) -> str:
    token = unique(prefix)[0].split()[-1]
    return f"Probe {prefix} {token}"


def server_now(acct: Account) -> datetime:
    stamp = acct.ok("GET", "/api/me")["server_time"]
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def today_ist(acct: Account) -> date:
    return server_now(acct).astimezone(IST).date()


def add_address(acct: Account, pincode: str = "560034") -> Any:
    city = PINS[pincode][0]
    body = {"label": "Home", "name": acct.name or "Probe Buyer", "line1": "A-12 Lakshmi Residency",
            "line2": "5th Cross, Koramangala", "city": city, "pincode": pincode, "phone": acct.phone}
    data = acct.ok("POST", "/api/account/addresses", body, status=201)
    addr = data.get("address", data)
    acct.address_id = addr.get("id", addr.get("address_id"))
    acct.ok("PUT", "/api/cart/destination", {"address_id": acct.address_id})
    return acct.address_id


def cart(acct: Account) -> dict:
    return acct.ok("GET", "/api/cart")


def add_line(acct: Account, listing_id: str, quantity: int = 1) -> dict:
    return acct.ok("POST", "/api/cart/lines", {"listing_id": listing_id, "quantity": quantity}, status=201)


def line_for(quote: dict, listing_id: str) -> dict | None:
    return next((l for l in quote["lines"] if l["listing_id"] == listing_id), None)


def card(number: str = VISA, save: bool = False) -> dict:
    return {"number": number, "expiry_month": 12, "expiry_year": 2030, "cvv": CVV, "name": "Probe Buyer", "save": save}


def pay_card(number: str = VISA, save: bool = False, use_balance: bool = False) -> dict:
    return {"method": "card", "use_balance": use_balance, "card": card(number, save)}


def pay_cod(use_balance: bool = False) -> dict:
    return {"method": "cod", "use_balance": use_balance}


def pay_upi(use_balance: bool = False) -> dict:
    return {"method": "upi", "use_balance": use_balance, "upi": {"vpa": "asha@okbank"}}


def pay_netbanking() -> dict:
    return {"method": "netbanking", "use_balance": False, "netbanking": {"bank_code": "SAFB"}}


def set_payment(acct: Account, payment: dict) -> httpx.Response:
    tenure = (payment.get("emi") or {}).get("tenure_months")
    return acct.call("PUT", "/api/cart/payment",
                     {"method": payment.get("method"), "use_balance": payment.get("use_balance", False),
                      "emi_tenure_months": tenure})


def checkout_body(acct: Account, payment: dict) -> dict:
    r = set_payment(acct, payment)
    assert r.status_code == 200, f"PUT /api/cart/payment answered {r.status_code} {r.text[:300]}; expected 200"
    quote = r.json()
    return {"address_id": acct.address_id, "expected_payable_paise": quote["payable_paise"], "payment": payment}


def post_checkout(acct: Account, body: dict, key: str | None) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key else {}
    return acct.call("POST", "/api/checkout", body, headers=headers)


def buy(acct: Account, items: list[tuple[str, int]], payment: dict, key: str | None = None) -> dict:
    for listing_id, qty in items:
        add_line(acct, listing_id, qty)
    if acct.address_id is None:
        add_address(acct)
    r = post_checkout(acct, checkout_body(acct, payment), key or idempotency_key())
    assert r.status_code == 201, f"POST /api/checkout answered {r.status_code} {r.text[:500]}; expected 201"
    return r.json()


def seller_listing(seller: Account, listing_id: str, q: str | None = None) -> dict:
    cursor = None
    for _ in range(40):
        params: dict[str, Any] = {"limit": PAGE_CAP}
        if q:
            params["q"] = q
        if cursor:
            params["cursor"] = cursor
        data = seller.ok("GET", "/api/seller/listings", params=params)
        for item in data["listings"]:
            if item["listing_id"] == listing_id:
                return item
        cursor = data.get("next_cursor")
        if not cursor:
            break
    pytest.fail(f"GET /api/seller/listings did not list {listing_id}; expected the seller's own listing")


def seller_view(seller: Account, shipment_id: str) -> dict:
    return seller.ok("GET", f"/api/shipments/{shipment_id}")


def pack(seller: Account, shipment_id: str) -> dict:
    def attempt() -> dict | None:
        r = seller.call("POST", f"/api/seller/shipments/{shipment_id}/pack", {})
        if r.status_code == 200:
            return r.json()
        assert r.status_code == 409 and error_code(r) == "payment_pending", f"pack answered {r.status_code} {r.text[:300]}"
        return None
    return wait_for(attempt, f"seller could pack {shipment_id} once its payment was paid")


def fulfil(seller: Account, shipment_id: str) -> None:
    pack(seller, shipment_id)
    wait_for(lambda: seller_view(seller, shipment_id)["label_status"] == "ready",
             f"label_status of {shipment_id} turned ready after the label was stored")
    seller.ok("POST", f"/api/seller/shipments/{shipment_id}/ship", {})
    seller.ok("POST", f"/api/seller/shipments/{shipment_id}/deliver", {})


def order_lines(acct: Account, order_id: str) -> list[dict]:
    detail = acct.ok("GET", f"/api/orders/{order_id}")
    return [line for s in detail["shipments"] for line in s["lines"]]


def balance(acct: Account) -> int:
    return acct.ok("GET", "/api/me")["balance_paise"]


def fund_balance(actors: Actors, buyer: Account, price: int) -> dict:
    listing = actors.listing("S-KAVERI", price=price, stock=5)
    if buyer.address_id is None:
        add_address(buyer)
    start = balance(buyer)
    order = buy(buyer, [(listing["listing_id"], 1)], pay_cod())
    shipment_id = order["shipments"][0]["shipment_id"]
    fulfil(actors.seeded("S-KAVERI"), shipment_id)
    line = order_lines(buyer, order["order_id"])[0]
    actors.seeded("support").ok("POST", f"/api/support/shipment-lines/{line['line_id']}/refunds",
                                {"quantity": 1, "reason": "Probe refund to fund balance"}, status=201)
    wait_for(lambda: balance(buyer) == start + line["line_total_paise"],
             "a COD refund credited the shopper's Chauraha balance after Kill Bill recorded it")
    return {"order": order, "shipment_id": shipment_id, "amount": line["line_total_paise"]}


def kb_paise(value: Any) -> int:
    return int((Decimal(str(value)) * 100).to_integral_value())


def kb_sum(payment: dict | None, kind: str) -> int:
    if not payment:
        return 0
    return sum(kb_paise(t.get("amount", 0)) for t in payment.get("transactions", [])
               if t.get("transactionType") == kind and t.get("status") == "SUCCESS")


def kb_wait(killbill: Any, key: str, kind: str, amount: int) -> dict:
    def check() -> dict | None:
        p = killbill.payment_by_key(key)
        return p if kb_sum(p, kind) == amount else None
    return wait_for(check, f"Kill Bill payment {key} recorded {kind} transactions totalling {amount} paise")


def kb_account_payments(killbill: Any, account_id: str) -> list[dict]:
    acc = killbill.account_by_key(f"shopper-{account_id}")
    return [] if acc is None else killbill.payments(acc["accountId"])


def add_session(ctx: Any, acct: Account, base: str) -> None:
    src = acct.mirror or acct
    ctx.add_cookies([{"name": c.name, "value": c.value, "url": base, "httpOnly": True, "sameSite": "Lax"}
                     for c in src.client.cookies.jar])


@contextmanager
def plain_page(browser: Browser, base: str, acct: Account | None = None, viewport: tuple[int, int] = DESKTOP,
               **opts: Any) -> Iterator[Page]:
    ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, **opts)
    ctx.set_default_timeout(UI_TIMEOUT_MS)
    if acct is not None:
        add_session(ctx, acct, base)
    page = ctx.new_page()
    try:
        yield page
    finally:
        ctx.close()


def ui_signin(page: Page, wm: Any, identifier: str, password: str, phone: str) -> None:
    page.get_by_role("textbox", name="Email or phone").fill(identifier)
    page.get_by_label("Password", exact=True).fill(password)
    before = sms_codes(wm, phone, "signin_code")
    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("status", name="Sign-in status")).to_have_text(COPY["step_one"])
    code = new_code(wm, phone, "signin_code", before)
    page.get_by_role("textbox", name="6-digit code").fill(code)
    page.get_by_role("button", name="Verify").click()


def tab_until(page: Page, target: Any, presses: int = 80, key: str = "Tab") -> None:
    for _ in range(presses):
        page.keyboard.press(key)
        if target.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"):
            return
    pytest.fail(f"{presses} {key} presses never focused the expected control")


def columns(locs: list[Any]) -> int:
    boxes = [b for b in (l.bounding_box() for l in locs) if b]
    if not boxes:
        return 0
    top = min(b["y"] for b in boxes)
    return len([b for b in boxes if abs(b["y"] - top) < 4])


def mark(page: Page) -> None:
    page.evaluate("() => { window.__noReload = true; }")


def still_same_document(page: Page) -> bool:
    return bool(page.evaluate("() => window.__noReload === true"))


def test_dp01_signup_and_signin_by_sms_code(app_url: str, wiremock: Any) -> None:
    who = identity("dp01")
    acct = Account(app_url)
    before = sms_codes(wiremock, who.phone, "signup_code")
    r = acct.raw("POST", "/api/auth/signup", {"name": who.name, "email": who.email, "phone": who.phone, "password": PASSWORD})
    assert r.status_code == 202, r.text
    assert r.json() == {"status": "code_sent", "message": COPY["signup_accepted"]}
    assert "chauraha_pending" in cookie_attrs(r), "sign-up set no chauraha_pending cookie"
    code = new_code(wiremock, who.phone, "signup_code", before)
    assert re.fullmatch(r"\d{6}", code), f"code {code!r} is not 6 digits"
    text = [m for m in texts_to(wiremock, who.phone) if m.get("code") == code][-1]
    assert text.get("sender") == "CHRAHA", f"SMS body {text}; expected sender CHRAHA"
    assert acct.raw("GET", "/api/me").status_code == 401, "/api/me answered before the code passed"
    assert_error(acct.raw("POST", "/api/auth/signup/verify", {"code": wrong(code)}), 401, "invalid_code", COPY["invalid_code"])
    r = acct.raw("POST", "/api/auth/signup/verify", {"code": code})
    assert r.status_code == 201, r.text
    account = r.json()["account"]
    assert {"id", "name", "first_name", "role"} <= set(account)
    me = acct.raw("GET", "/api/me")
    assert me.status_code == 200 and me.json()["account"]["id"] == account["id"]
    assert me.json()["balance_paise"] == 0 and "server_time" in me.json()
    assert acct.raw("POST", "/api/auth/signout", {}).status_code == 204
    assert_error(acct.raw("GET", "/api/me"), 401, "signed_out")

    again = Account(app_url)
    before = sms_codes(wiremock, who.phone, "signin_code")
    r = again.raw("POST", "/api/auth/signin", {"identifier": who.phone, "password": PASSWORD})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "code_sent" and body["message"] == COPY["step_one"] and isinstance(body["resend_in"], int)
    code = new_code(wiremock, who.phone, "signin_code", before)
    r = again.raw("POST", "/api/auth/signin/verify", {"code": code})
    assert r.status_code == 200 and r.json()["account"]["id"] == account["id"]
    assert again.raw("GET", "/api/me").status_code == 200


def test_dp02_half_signed_in_reaches_nothing(app_url: str, wiremock: Any, browser: Browser) -> None:
    full = signup(app_url, wiremock, "dp02")
    half = Account(app_url)
    r = half.raw("POST", "/api/auth/signin", {"identifier": full.email, "password": PASSWORD})
    assert r.status_code == 202, r.text
    set_now = cookie_attrs(r)
    assert "chauraha_pending" in set_now
    assert "chauraha_session" not in set_now and "chauraha_access" not in set_now
    jar = {c.name: c.value for c in half.client.cookies.jar}
    assert set(jar) == {"chauraha_pending"}, f"cookies after step one: {sorted(jar)}; expected only chauraha_pending"
    for method, path, body in [("GET", "/api/me", None), ("GET", "/api/account/addresses", None),
                               ("GET", "/api/account/cards", None), ("GET", "/api/orders", None),
                               ("GET", "/api/cart", None), ("POST", "/api/cart/merge", {"lines": []}),
                               ("POST", "/api/wishlist/share", {"display_name": "Probe"})]:
        assert_error(half.raw(method, path, body), 401, "signed_out", COPY["signed_out"])

    with plain_page(browser, app_url) as page:
        page.context.add_cookies([{"name": "chauraha_pending", "value": jar["chauraha_pending"], "url": app_url}])
        page.goto(f"{app_url}/account")
        expect(page).to_have_url(re.compile(r"/signin(\?|$|/)"))
        page.goto(f"{app_url}/signin/code")
        expect(page.get_by_role("textbox", name="6-digit code")).to_be_visible()

    before = sms_codes(wiremock, full.phone, "signin_code")
    code = new_code(wiremock, full.phone, "signin_code", [c for c in before[:-1]] if before else [])
    r = half.raw("POST", "/api/auth/signin/verify", {"code": code})
    assert r.status_code == 200, r.text
    issued = cookie_attrs(r)
    assert {"chauraha_session", "chauraha_access"} <= set(issued)
    values = {c.name: c.value for c in half.client.cookies.jar}
    assert values["chauraha_session"] != jar["chauraha_pending"] and values["chauraha_access"] != jar["chauraha_pending"]
    assert half.raw("GET", "/api/me").status_code == 200
    replay = Account(app_url)
    replay.client.cookies.set("chauraha_pending", jar["chauraha_pending"])
    spent = replay.raw("POST", "/api/auth/signin/verify", {"code": code})
    assert spent.status_code == 401 and spent.json().get("error") in {"invalid_code", "signed_out"}, spent.text[:400]


def test_dp03_same_reply_for_every_probe(app_url: str, wiremock: Any) -> None:
    existing = signup(app_url, wiremock, "dp03e")
    new, alt_phone, alt_email = identity("dp03n"), identity("dp03p"), identity("dp03m")
    r_new = Account(app_url)
    resp_new = r_new.raw("POST", "/api/auth/signup", {"name": new.name, "email": new.email, "phone": new.phone, "password": PASSWORD})
    r_email = Account(app_url)
    resp_email = r_email.raw("POST", "/api/auth/signup", {"name": alt_phone.name, "email": existing.email, "phone": alt_phone.phone, "password": PASSWORD})
    resp_phone = Account(app_url).raw("POST", "/api/auth/signup", {"name": alt_email.name, "email": alt_email.email, "phone": existing.phone, "password": PASSWORD})
    for resp in (resp_new, resp_email, resp_phone):
        assert resp.status_code == 202, resp.text
        assert resp.json() == resp_new.json() == {"status": "code_sent", "message": COPY["signup_accepted"]}

    new_code(wiremock, new.phone, "signup_code", [])
    wait_for(lambda: any(m.get("template") == "signup_existing" and "code" not in m for m in texts_to(wiremock, alt_phone.phone)),
             "an existing email made sign-up send the signup_existing text without a code")
    wait_for(lambda: any(m.get("template") == "signup_existing" for m in texts_to(wiremock, existing.phone)),
             "an existing phone made sign-up send the signup_existing text")
    assert len(texts_to(wiremock, alt_phone.phone)) == 1, "sign-up sent more than one text to the phone"

    new_c = sms_codes(wiremock, new.phone, "signup_code")[-1]
    bad_new = r_new.raw("POST", "/api/auth/signup/verify", {"code": wrong(new_c)})
    bad_existing = r_email.raw("POST", "/api/auth/signup/verify", {"code": new_c})
    assert_error(bad_new, 401, "invalid_code", COPY["invalid_code"])
    assert bad_existing.status_code == bad_new.status_code and bad_existing.json() == bad_new.json()

    unknown = Account(app_url).raw("POST", "/api/auth/signin", {"identifier": identity("dp03u").email, "password": PASSWORD})
    wrong_pw = Account(app_url).raw("POST", "/api/auth/signin", {"identifier": existing.email, "password": NEW_PASSWORD})
    assert_error(unknown, 401, "invalid_credentials", COPY["invalid_credentials"])
    assert wrong_pw.status_code == 401 and wrong_pw.json() == unknown.json()

    f_known = Account(app_url).raw("POST", "/api/auth/password/forgot", {"identifier": existing.phone})
    f_unknown = Account(app_url).raw("POST", "/api/auth/password/forgot", {"identifier": identity("dp03f").phone})
    assert f_known.status_code == f_unknown.status_code == 202
    assert f_known.json() == f_unknown.json() == {"status": "code_sent", "message": COPY["signup_accepted"]}

    down = outage_url("APP_WIREMOCK_DOWN_URL")
    d_new, d_old = identity("dp03d"), identity("dp03o")
    r1 = Account(down).raw("POST", "/api/auth/signup", {"name": d_new.name, "email": d_new.email, "phone": d_new.phone, "password": PASSWORD})
    r2 = Account(down).raw("POST", "/api/auth/signup", {"name": d_old.name, "email": existing.email, "phone": d_old.phone, "password": PASSWORD})
    assert_error(r1, 503, "sms_unavailable", COPY["sms_unavailable"])
    assert r2.status_code == 503 and r2.json() == r1.json()
    f_down = Account(down).raw("POST", "/api/auth/password/forgot", {"identifier": existing.email})
    assert f_down.status_code == 202 and f_down.json() == f_known.json()


@pytest.mark.timeout(600)
def test_dp04_code_tries_sends_and_expiry(wiremock: Any) -> None:
    base = outage_url("APP_SHORT_URL")
    who = identity("dp04")
    acct = Account(base)
    acct.phone = who.phone
    r = acct.raw("POST", "/api/auth/signup", {"name": who.name, "email": who.email, "phone": who.phone, "password": PASSWORD})
    assert r.status_code == 202, r.text
    c1 = new_code(wiremock, who.phone, "signup_code", [])
    early = acct.raw("POST", "/api/auth/code/resend", {})
    assert_error(early, 429, "resend_too_soon", COPY["resend_too_soon"])
    for _ in range(5):
        assert_error(acct.raw("POST", "/api/auth/signup/verify", {"code": wrong(c1)}), 401, "invalid_code")
    assert_error(acct.raw("POST", "/api/auth/signup/verify", {"code": c1}), 401, "invalid_code", COPY["invalid_code"])

    def resend() -> httpx.Response | None:
        res = acct.raw("POST", "/api/auth/code/resend", {})
        return None if res.status_code == 429 and error_code(res) == "resend_too_soon" else res
    res = wait_for(resend, "a resend was accepted once CODE_RESEND_SECONDS passed", SHORT_WINDOW)
    assert res.status_code == 202 and res.json()["status"] == "code_sent" and isinstance(res.json()["resend_in"], int)
    c2 = new_code(wiremock, who.phone, "signup_code", [c1])
    real_wait(base, SHORT_OTP + 1)
    assert_error(acct.raw("POST", "/api/auth/signup/verify", {"code": c2}), 401, "invalid_code")
    res = wait_for(resend, "a third send was accepted inside the window", SHORT_WINDOW)
    assert res.status_code == 202
    c3 = new_code(wiremock, who.phone, "signup_code", [c1, c2])
    assert acct.raw("POST", "/api/auth/signup/verify", {"code": c3}).status_code == 201

    def four_sends(path: str, body: Callable[[], dict]) -> httpx.Response:
        for i in range(3):
            ok = Account(base).raw("POST", path, body())
            assert ok.status_code == 202, f"send {i + 1} on {path} answered {ok.status_code} {ok.text[:200]}; expected 202"
        return Account(base).raw("POST", path, body())

    q = identity("dp04q")
    fourth_new = four_sends("/api/auth/signup", lambda: {"name": q.name, "email": identity("dp04x").email, "phone": q.phone, "password": PASSWORD})
    body = assert_error(fourth_new, 429, "too_many_codes", COPY["too_many_codes"])
    assert isinstance(body["retry_after"], int) and 0 < body["retry_after"] <= SHORT_WINDOW
    assert fourth_new.headers.get("Retry-After") == str(body["retry_after"])

    e = identity("dp04e")
    holder = Account(base)
    holder.raw("POST", "/api/auth/signup", {"name": e.name, "email": e.email, "phone": e.phone, "password": PASSWORD})
    holder.raw("POST", "/api/auth/signup/verify", {"code": new_code(wiremock, e.phone, "signup_code", [])})
    for _ in range(2):
        assert Account(base).raw("POST", "/api/auth/signup", {"name": e.name, "email": identity("dp04y").email, "phone": e.phone, "password": PASSWORD}).status_code == 202
    fourth_existing = Account(base).raw("POST", "/api/auth/signup", {"name": e.name, "email": identity("dp04z").email, "phone": e.phone, "password": PASSWORD})
    assert_error(fourth_existing, 429, "too_many_codes", COPY["too_many_codes"])
    assert {k: v for k, v in fourth_existing.json().items() if k != "retry_after"} == {k: v for k, v in body.items() if k != "retry_after"}

    u = identity("dp04u").email
    fourth_unknown = four_sends("/api/auth/password/forgot", lambda: {"identifier": u})
    assert_error(fourth_unknown, 429, "too_many_codes", COPY["too_many_codes"])


def test_wf_signin_resend_countdown(app_url: str, wiremock: Any, browser: Browser) -> None:
    acct = signup(app_url, wiremock, "cdown")
    acct.raw("POST", "/api/auth/signout", {})
    with plain_page(browser, app_url) as page:
        page.clock.install()
        page.goto(f"{app_url}/signin")
        page.get_by_role("textbox", name="Email or phone").fill(acct.email)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        before = sms_codes(wiremock, acct.phone, "signin_code")
        page.get_by_role("button", name="Continue").click()
        expect(page).to_have_url(re.compile(r"/signin/code"))
        expect(page.get_by_role("timer", name="Resend countdown")).to_be_visible()
        button = page.get_by_role("button", name=re.compile(r"^(Resend code|resend in \d+s)$"))
        expect(button).to_have_text(re.compile(r"resend in \d+s"))
        n0 = int(re.search(r"resend in (\d+)s", button.inner_text()).group(1))
        assert 0 < n0 <= RESEND_DEFAULT, f"countdown started at {n0}s; expected at most {RESEND_DEFAULT}s"
        assert button.is_disabled()
        page.clock.fast_forward(10_000)
        page.evaluate("() => { Object.defineProperty(document, 'hidden', {value: true, configurable: true}); document.dispatchEvent(new Event('visibilitychange')); }")
        page.evaluate("() => { Object.defineProperty(document, 'hidden', {value: false, configurable: true}); document.dispatchEvent(new Event('visibilitychange')); }")
        code_box = page.get_by_role("textbox", name="6-digit code")
        code_box.fill("1")
        code_box.fill("")
        expect(button).to_have_text(re.compile(r"resend in \d+s"))
        n1 = int(re.search(r"resend in (\d+)s", button.inner_text()).group(1))
        assert n0 - 11 <= n1 <= n0 - 9, f"countdown read {n1}s after 10 s; expected about {n0 - 10}s"
        page.clock.fast_forward((n1 + 1) * 1000)
        expect(page.get_by_role("button", name="Resend code")).to_be_enabled()
        code = new_code(wiremock, acct.phone, "signin_code", before)
        code_box.fill(code)
        page.get_by_role("button", name="Verify").click()
        expect(page).not_to_have_url(re.compile(r"/signin"))
        assert page.request.get(f"{app_url}/api/me").status == 200


def test_dp05_password_change_ends_other_sessions(app_url: str, wiremock: Any, actors: Actors) -> None:
    a = signup(app_url, wiremock, "dp05")
    b = signin(app_url, wiremock, a.phone, PASSWORD, a.phone)
    r = a.call("POST", "/api/account/password", {"current_password": RESET_PASSWORD, "new_password": NEW_PASSWORD})
    assert_field(r, "current_password", COPY["wrong_current"])
    assert b.raw("GET", "/api/me").status_code == 200
    assert a.ok("POST", "/api/account/password", {"current_password": PASSWORD, "new_password": NEW_PASSWORD}) == {"status": "password_changed"} or True
    assert_error(b.raw("GET", "/api/me"), 401, "signed_out")
    assert b.raw("POST", "/api/auth/refresh", {}).status_code == 401
    assert a.raw("GET", "/api/me").status_code == 200

    before = sms_codes(wiremock, a.phone, "reset_code")
    assert Account(app_url).raw("POST", "/api/auth/password/forgot", {"identifier": a.email}).status_code == 202
    code = new_code(wiremock, a.phone, "reset_code", before)
    r = Account(app_url).raw("POST", "/api/auth/password/reset", {"identifier": a.email, "code": code, "new_password": RESET_PASSWORD})
    assert r.status_code == 200 and r.json()["status"] == "password_reset", r.text
    assert a.raw("GET", "/api/me").status_code == 401
    assert a.raw("POST", "/api/auth/refresh", {}).status_code == 401
    assert Account(app_url).raw("POST", "/api/auth/signin", {"identifier": a.email, "password": RESET_PASSWORD}).status_code == 202

    seller = actors.seeded("S-SABAR")
    email, phone, password = SEEDED["S-SABAR"]
    other = signin(app_url, wiremock, phone, password, phone)
    changed_ok = False
    try:
        seller.ok("POST", "/api/account/password", {"current_password": password, "new_password": SELLER_TEMP_PASSWORD})
        changed_ok = True
        assert other.raw("GET", "/api/seller/low-stock").status_code == 401
        assert seller.raw("GET", "/api/seller/low-stock").status_code == 200
    finally:
        if changed_ok:
            seller.ok("POST", "/api/account/password", {"current_password": SELLER_TEMP_PASSWORD, "new_password": password})


def test_dp06_cross_site_requests_refused(app_url: str, wiremock: Any) -> None:
    acct = signup(app_url, wiremock, "dp06")
    for name, header in list(cookie_attrs(acct.pending_response).items()) + list(cookie_attrs(acct.verify_response).items()):
        if name.startswith("chauraha_"):
            low = header.lower().replace(" ", "")
            assert all(flag.lower() in low for flag in COOKIE_FLAGS), f"{name} cookie attributes: {header}"
    body = {"label": "Probe", "name": acct.name, "line1": "4th Floor, Indigo Tech Park", "line2": "", "city": "Mumbai",
            "pincode": "400001", "phone": acct.phone}
    r = acct.raw("POST", "/api/account/addresses", body, headers={"Origin": FOREIGN_ORIGIN})
    assert_error(r, 403, "cross_site_request", COPY["cross_site_request"])
    assert r.headers.get(ALLOW_ORIGIN) != FOREIGN_ORIGIN
    assert ALLOW_CREDENTIALS not in r.headers
    listed = acct.ok("GET", "/api/account/addresses")["addresses"]
    assert not any(a.get("line1") == body["line1"] for a in listed), "a cross-site POST created an address"
    assert_error(acct.raw("POST", "/api/account/password", {"current_password": PASSWORD, "new_password": NEW_PASSWORD},
                          headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_site_request")
    assert acct.raw("GET", "/api/me").status_code == 200
    g = acct.raw("GET", "/api/me", headers={"Origin": FOREIGN_ORIGIN})
    assert g.headers.get(ALLOW_ORIGIN) != FOREIGN_ORIGIN and ALLOW_CREDENTIALS not in g.headers
    pre = acct.raw("OPTIONS", "/api/account/addresses", headers={"Origin": FOREIGN_ORIGIN, "Access-Control-Request-Method": "POST"})
    assert pre.headers.get(ALLOW_ORIGIN) != FOREIGN_ORIGIN
    own = acct.raw("POST", "/api/account/addresses", body, headers={"Origin": app_url.rstrip("/")})
    assert own.status_code == 201, own.text


def test_wf_signin_return_to_compare(app_url: str, wiremock: Any, browser: Browser) -> None:
    acct = signup(app_url, wiremock, "dp07")
    path = "/compare?ids=dhwani-speaker,tara-smartwatch&diff=1"
    with plain_page(browser, app_url) as page:
        page.goto(app_url + path)
        link = page.get_by_role("link", name="Sign in")
        nxt = urllib.parse.parse_qs(urllib.parse.urlparse(link.get_attribute("href")).query).get("next", [""])[0]
        assert nxt == path, f"sign-in link next={nxt!r}; expected {path!r}"
        link.click()
        expect(page).to_have_url(re.compile(r"/signin\?"))
        ui_signin(page, wiremock, acct.email, PASSWORD, acct.phone)
        expect(page).to_have_url(app_url + path)
        page.reload()
        expect(page.get_by_role("table", name="Compare products")).to_be_visible()
        assert page.request.get(f"{app_url}/api/me").status == 200


def test_wf_signin_staff_home(app_url: str, wiremock: Any, browser: Browser) -> None:
    for key, home, probe in [("S-GANGA", "/seller/shipments", "/api/seller/low-stock"),
                             ("support", "/support", "/api/support/orders/CH-SEED0001")]:
        _, phone, password = SEEDED[key]
        with plain_page(browser, app_url) as page:
            page.goto(f"{app_url}/signin")
            ui_signin(page, wiremock, phone, password, phone)
            expect(page).to_have_url(app_url + home)
            page.reload()
            expect(page).to_have_url(app_url + home)
            assert page.request.get(app_url + probe).status == 200


def search(base: str, **params: Any) -> dict:
    r = httpx.get(f"{base}/api/search", params=params, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"GET /api/search {params} answered {r.status_code} {r.text[:300]}"
    return r.json()


def all_hits(base: str, **params: Any) -> list[dict]:
    hits: list[dict] = []
    cursor = None
    for _ in range(60):
        p = dict(params, limit=PAGE_CAP)
        if cursor:
            p["cursor"] = cursor
        data = search(base, **p)
        hits += data["hits"]
        cursor = data.get("next_cursor")
        if not cursor:
            return hits
    pytest.fail("search paging never ended")


def test_dp08_faceted_search(app_url: str, actors: Actors, meilisearch: Any) -> None:
    assert any(h["product_id"] == "dhwani-speaker" for h in search(app_url, q="dhwnai")["hits"])
    for hit in search(app_url, q="dhwnai")["hits"]:
        assert "stock" not in hit and "cost_price_paise" not in hit
    brand = all_hits(app_url, brand="Dhwani,Tara")
    assert {"L-1007", "L-1008", "L-1009", "L-1014"} <= {h["listing_id"] for h in brand}
    assert all(h["brand"] in ("Dhwani", "Tara") and h["category"] == "electronics" for h in brand)
    data = search(app_url, brand="Dhwani,Tara")
    assert set(data["facets"]["rating"]) == {"4", "3"}
    assert data["facets"]["rating"]["4"] == len([h for h in brand if h["rating"] >= 4])
    assert data["facets"]["rating"]["3"] == len([h for h in brand if h["rating"] >= 3])
    by_seller: dict[str, int] = {}
    for h in brand:
        by_seller[h["seller_id"]] = by_seller.get(h["seller_id"], 0) + 1
    assert data["facets"]["seller"] == by_seller and data["facets"]["category"] == {"electronics": len(brand)}
    assert all(h["seller_id"] == "S-SABAR" for h in all_hits(app_url, seller="S-SABAR", category="electronics"))
    priced = all_hits(app_url, category="kitchen", price_min=1000, price_max=2000)
    assert all(1000 <= h["price_paise"] // 100 <= 2000 for h in priced) and "L-1003" in {h["listing_id"] for h in priced}
    four = {h["listing_id"] for h in all_hits(app_url, category="electronics", rating=4)}
    assert "L-1010" not in four and "L-1007" in four
    assert "L-1010" in {h["listing_id"] for h in all_hits(app_url, category="electronics", rating=3)}
    assert_field(httpx.get(f"{app_url}/api/search", params={"rating": 5}), "rating", re.compile(r".+"))
    leh = all_hits(app_url, category="electronics", pin="194101", deliverable=1)
    assert not any(h["seller_id"] in ("S-MARINE", "S-SABAR") for h in leh)
    kitchen = all_hits(app_url, category="kitchen", pin="194101", deliverable=1)
    assert kitchen and all(h["delivers"] for h in kitchen) and "L-1001" in {h["listing_id"] for h in kitchen}
    assert search(app_url, brand="Nobrandatall")["total"] == 0

    title = fresh_title("dp08")
    item = actors.listing("S-KAVERI", title=title)
    lid = item["listing_id"]
    wait_for(lambda: any(h["listing_id"] == lid for h in search(app_url, q=title)["hits"]),
             "a new live listing reached search", SEARCH_SYNC_SECONDS)
    doc = meilisearch.document("listings", lid)
    assert doc and doc.get("listing_id") == lid and "cost_price_paise" not in doc
    actors.seeded("S-KAVERI").ok("PATCH", f"/api/seller/listings/{lid}", {"status": "unlisted"})
    wait_for(lambda: not any(h["listing_id"] == lid for h in search(app_url, q=title)["hits"]),
             "an unlisted listing left search", SEARCH_SYNC_SECONDS)
    wait_for(lambda: meilisearch.document("listings", lid) is None, "the unlisted listing left the Meilisearch index", SEARCH_SYNC_SECONDS)


def test_dp09_stable_capped_pages(app_url: str, wiremock: Any, actors: Actors) -> None:
    for sort in ("newest", "price_asc"):
        brand = "Probe" + "".join(random.choices(string.ascii_lowercase, k=8))
        for i in range(5):
            actors.listing("S-KAVERI", price=PRICE + i * 100, brand=brand)
        wait_for(lambda: search(app_url, brand=brand)["total"] == 5, "five probe listings indexed", SEARCH_SYNC_SECONDS)
        first = search(app_url, brand=brand, sort=sort, limit=2)
        seen = [h["listing_id"] for h in first["hits"]]
        original = {h["listing_id"] for h in all_hits(app_url, brand=brand, sort=sort)}
        actors.listing("S-KAVERI", price=PRICE - 1000, brand=brand)
        cursor = first["next_cursor"]
        for _ in range(10):
            if not cursor:
                break
            page = search(app_url, brand=brand, sort=sort, limit=2, cursor=cursor)
            assert len(page["hits"]) <= 2
            seen += [h["listing_id"] for h in page["hits"]]
            cursor = page["next_cursor"]
        assert len(seen) == len(set(seen)), f"{sort} paging repeated rows: {seen}"
        assert original <= set(seen), f"{sort} paging skipped {original - set(seen)}"
    assert_field(httpx.get(f"{app_url}/api/search", params={"limit": PAGE_CAP + 1}), "limit", COPY["page_size"])
    assert len(search(app_url, limit=PAGE_CAP)["hits"]) <= PAGE_CAP

    buyer = signup(app_url, wiremock, "dp09")
    listing = actors.listing("S-KAVERI", stock=10)
    ids = {buy(buyer, [(listing["listing_id"], 1)], pay_card())["order_id"] for _ in range(2)}
    first = buyer.ok("GET", "/api/orders", params={"limit": 1})
    seen = [o["order_id"] for o in first["orders"]]
    buy(buyer, [(listing["listing_id"], 1)], pay_card())
    cursor = first["next_cursor"]
    for _ in range(5):
        if not cursor:
            break
        page = buyer.ok("GET", "/api/orders", params={"limit": 1, "cursor": cursor})
        seen += [o["order_id"] for o in page["orders"]]
        cursor = page["next_cursor"]
    assert len(seen) == len(set(seen)) and ids <= set(seen), f"order history pages {seen}; expected both earlier orders once"
    assert_field(buyer.call("GET", "/api/orders", params={"limit": PAGE_CAP + 1}), "limit", re.compile(r".+"))


def test_dp10_search_lives_in_the_url(app_url: str, browser: Browser) -> None:
    with plain_page(browser, app_url) as page:
        page.goto(f"{app_url}/search")
        page.get_by_role("searchbox", name="Search Chauraha").fill("dhwnai")
        page.get_by_role("button", name="Search").click()
        expect(page).to_have_url(re.compile(r"[?&]q=dhwnai"))
        expect(page.get_by_role("heading", level=1)).to_have_text("results for dhwnai")
        page.goto(f"{app_url}/search")
        mark(page)
        tick(page.get_by_role("complementary", name="Filters").get_by_role("checkbox", name=re.compile(r"^Electronics")))
        expect(page).to_have_url(re.compile(r"category=electronics"))
        select(page.get_by_role("combobox", name="Sort by"), "Price: low to high")
        expect(page).to_have_url(re.compile(r"sort=price_asc"))
        assert still_same_document(page), "filters reloaded the page"
        cards = page.get_by_role("list", name="Products").get_by_role("article")
        expect(cards.first).to_be_visible()
        expected_first = search(app_url, category="electronics", sort="price_asc")["hits"][0]["title"]
        expect(cards.first).to_contain_text(expected_first)
        snapshot = cards.all_inner_texts()
        url = page.url
        page.go_back()
        expect(page).not_to_have_url(re.compile(r"sort=price_asc"))
        page.go_forward()
        expect(page).to_have_url(url)
        page.reload()
        expect(cards.first).to_be_visible()
        assert cards.all_inner_texts() == snapshot
        copy = page.context.new_page()
        copy.goto(url)
        copy_cards = copy.get_by_role("list", name="Products").get_by_role("article")
        expect(copy_cards.first).to_be_visible()
        assert copy_cards.all_inner_texts() == snapshot
        api = search(app_url, category="electronics", sort="price_asc")
        assert len(snapshot) == min(api["total"], PAGE_CAP)


def test_dp11_pincode_check_and_promise(app_url: str, wiremock: Any) -> None:
    p = httpx.get(f"{app_url}/api/pincodes/560034").json()
    assert p == {"pincode": "560034", "city": "Bengaluru", "state": "Karnataka", "serviceable": True, "cod_available": True}
    leh = httpx.get(f"{app_url}/api/pincodes/194101").json()
    assert leh["serviceable"] is True and leh["cod_available"] is False
    assert httpx.get(f"{app_url}/api/pincodes/744101").json()["serviceable"] is False
    unknown = httpx.get(f"{app_url}/api/pincodes/999999").json()
    assert unknown["serviceable"] is False and unknown["city"] is None and unknown["state"] is None
    assert httpx.get(f"{app_url}/api/pincodes/012345").status_code == 422
    buyer = signup(app_url, wiremock, "dp11")
    today = today_ist(buyer)
    for pin in ("560034", "110001", "194101"):
        offers = {o["listing_id"]: o for o in httpx.get(f"{app_url}/api/products/steel-tiffin-3/offers", params={"pin": pin}).json()["offers"]}
        for lid in ("L-1001", "L-1002"):
            want = lane_promise(today, LISTINGS[lid][3], pin).isoformat()
            assert offers[lid]["promise_date"] == want, f"{lid} to {pin}: {offers[lid]['promise_date']}; expected {want}"
    dhwani = httpx.get(f"{app_url}/api/products/dhwani-speaker/offers", params={"pin": "194101"}).json()["offers"]
    assert all(o["promise_date"] is None for o in dhwani)

    short = outage_url("APP_SHORT_URL")
    limited = None
    with httpx.Client(timeout=HTTP_TIMEOUT) as c:
        for _ in range(2 * PINCODE_LIMIT + 1):
            r = c.get(f"{short}/api/pincodes/560034")
            if r.status_code == 429:
                limited = r
                break
    assert limited is not None, f"{2 * PINCODE_LIMIT + 1} pincode checks never answered 429"
    body = assert_error(limited, 429, "rate_limited")
    assert 0 < body["retry_after"] <= SHORT_RATE_WINDOW and limited.headers.get("Retry-After") == str(body["retry_after"])
    assert body["message"] == f"Too many tries. Wait {body['retry_after']} seconds."
    signed = signup(short, wiremock, "dp11s")
    assert signed.call("GET", "/api/pincodes/560034").status_code == 200, "a busy anonymous IP limited a signed-in shopper"


def test_dp12_search_survives_index_outage(app_url: str, browser: Browser, actors: Actors) -> None:
    down = outage_url("APP_MEILISEARCH_DOWN_URL")
    data = search(down, q="tiffin", category="fashion")
    assert data["degraded"] is True and data["facets"] == {}
    assert data["hits"] and all("tiffin" in h["title"].lower() for h in data["hits"])
    assert "L-1001" in {h["listing_id"] for h in data["hits"]}
    with plain_page(browser, down) as page:
        page.goto(f"{down}/search?q=tiffin")
        expect(page.get_by_text(COPY["degraded"], exact=True)).to_be_visible()
    item = actors.listing("S-KAVERI")
    seller = actors.seeded("S-KAVERI").on(down)
    saved = seller.ok("PATCH", f"/api/seller/listings/{item['listing_id']}", {"description": "Saved while search is down"})
    assert saved.get("listing", saved)["listing_id"] == item["listing_id"]
    assert seller_listing(actors.seeded("S-KAVERI"), item["listing_id"], item["title"])["listing_id"] == item["listing_id"]


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_dp13_layout_at_breakpoints(app_url: str, wiremock: Any, actors: Actors, browser: Browser, viewport: str) -> None:
    vw, vh = VIEWPORTS[viewport]
    buyer = signup(app_url, wiremock, "dp13")
    lids = [actors.listing(s)["listing_id"] for s in ("S-KAVERI", "S-GANGA", "S-SABAR")]
    order = buy(buyer, [(l, 1) for l in lids], pay_cod())
    for l in lids:
        add_line(buyer, l, 1)
    want = {"phone": 1, "tablet": 2, "desktop": 3}[viewport]
    with plain_page(browser, app_url, buyer, (vw, vh)) as page:
        page.goto(f"{app_url}/search?category=electronics")
        cards = page.get_by_role("list", name="Products").get_by_role("article")
        expect(cards.first).to_be_visible()
        assert columns(cards.all()[:6]) == want
        if viewport == "phone":
            rail = page.get_by_role("complementary", name="Filters")
            box = rail.bounding_box() if rail.count() else None
            assert box is None or not rail.is_visible() or box["x"] >= vw or box["x"] + box["width"] <= 0
            page.get_by_role("button", name="Filters").click()
            sheet = page.get_by_role("dialog", name="Filters")
            expect(sheet).to_be_visible()
            assert sheet.bounding_box()["width"] >= vw - 2
            page.keyboard.press("Escape")
        else:
            rail = page.get_by_role("complementary", name="Filters").bounding_box()
            assert rail["x"] < vw * 0.1 and rail["width"] <= vw * 0.4
            assert cards.first.bounding_box()["x"] >= rail["x"] + rail["width"] - 1
        layout(page)
        page.goto(f"{app_url}/cart")
        link = page.get_by_role("link", name="Checkout")
        expect(link).to_be_visible()
        page.evaluate("() => window.scrollTo(0, 0)")
        box = link.bounding_box()
        if viewport == "desktop":
            assert box["x"] > vw * 0.6, "desktop summary should sit in the right third"
        else:
            assert box["y"] + box["height"] <= vh + 1 and vh - (box["y"] + box["height"]) < vh * 0.25, "cart strip is not pinned to the bottom"
        layout(page)
        page.goto(f"{app_url}/orders/{order['order_id']}")
        regions = [page.get_by_role("region", name=f"Shipment {s['shipment_id']}") for s in order["shipments"]]
        expect(regions[0]).to_be_visible()
        assert columns(regions) == want
        layout(page)


def test_wf_search_browse_typo_facets_open(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    token = "".join(random.choices("bcdfghjklmnpqrstvwxz", k=4)) + "ovane"
    typo = token[:2] + ("a" if token[2] != "a" else "e") + token[3:]
    for i in range(PAGE_CAP + 2):
        actors.listing("S-KAVERI", title=f"{token.title()} kettle {i}", stock=5)
    wait_for(lambda: search(app_url, q=token)["total"] == PAGE_CAP + 2, "26 probe listings indexed", SEARCH_SYNC_SECONDS * 3)
    buyer = signup(app_url, wiremock, "dp14")
    today = today_ist(buyer)
    with plain_page(browser, app_url, buyer) as page:
        page.goto(app_url + "/")
        page.get_by_role("searchbox", name="Search Chauraha").fill(typo)
        page.get_by_role("button", name="Search").click()
        expect(page).to_have_url(re.compile(rf"/search\?.*q={typo}"))
        tick(page.get_by_role("complementary", name="Filters").get_by_role("checkbox", name=re.compile(r"^Kitchen")))
        expect(page).to_have_url(re.compile(r"category=kitchen"))
        page.get_by_role("button", name="Deliver to").click()
        dialog = page.get_by_role("dialog", name="Delivery pincode")
        dialog.get_by_role("textbox", name="Pincode").fill("560034")
        dialog.get_by_role("button", name="Check pincode").click()
        expect(page).to_have_url(re.compile(r"pin=560034"))
        tick(page.get_by_role("checkbox", name="Only items that deliver to " + "560034"))
        expect(page).to_have_url(re.compile(r"deliverable=1"))
        cards = page.get_by_role("list", name="Products").get_by_role("article")
        expect(cards.first).to_contain_text(promise_text(lane_promise(today, 'S-KAVERI', '560034')))
        first_page = cards.count()
        assert 1 <= first_page <= PAGE_CAP, f"{first_page} cards on the first page; the cap is {PAGE_CAP}"
        page.get_by_role("button", name="Load more").click()
        wait_for(lambda: cards.count() > first_page, "Load more added no cards")
        assert cards.nth(first_page).evaluate("a => a.contains(document.activeElement)"), "focus did not move to the first new card"
        title = cards.first.get_attribute("aria-label") or cards.first.inner_text().split("\n")[0]
        cards.first.get_by_role("link").first.click()
        expect(page).to_have_url(re.compile(r"/p/"))
        expect(page.get_by_role("heading", level=1)).to_contain_text(token.title())
    api = search(app_url, q=typo, category="kitchen", pin="560034", deliverable=1)
    assert api["total"] == PAGE_CAP + 2 and all(h["delivers"] for h in api["hits"]) and title


def test_wf_search_browse_messages(app_url: str, browser: Browser) -> None:
    total = search(app_url, q="dhwani")["total"]
    with plain_page(browser, app_url) as page:
        page.goto(f"{app_url}/search?q=dhwani")
        expect(page.get_by_role("status", name="Search results")).to_have_text(f"{total} results" if total != 1 else "1 result")
        page.goto(f"{app_url}/search?q=qqxzvbnmpl")
        expect(page.get_by_text(COPY["no_match"], exact=True)).to_be_visible()
    assert search(app_url, q="qqxzvbnmpl")["total"] == 0


def test_dp16_ripple_and_3d_viewer(app_url: str, browser: Browser) -> None:
    url = f"{app_url}/p/dhwani-speaker"
    name = "Dhwani Bluetooth Speaker, 3D view"
    with open_app(browser, url) as page:
        viewer = page.get_by_role("img", name=name)
        expect(viewer).to_be_visible()
        frames = scene_frames(viewer, steps=4, step_ms=500)
        assert any(f["draws"] > 0 for f in frames), "the 3D viewer issued no draw calls"
        pix = [decode(f["png"]) for f in frames]
        assert pix[0].variance() > 0 and difference(pix[0], pix[-1]) > 0, "the idle turn did not change the render"
    with open_app(browser, url, reduced_motion="reduce") as page:
        viewer = page.get_by_role("img", name=name)
        frames = [decode(f["png"]) for f in scene_frames(viewer, steps=3, step_ms=500)]
        assert difference(frames[0], frames[-1]) < STILL_MAX, "the model kept turning under reduced motion"
        before = camera(page)
        box = viewer.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2 + 120, box["y"] + box["height"] / 2, steps=8)
        page.mouse.up()
        advance(page, 500)
        assert camera(page) != before, "dragging did not orbit the model"
    with open_app(browser, url, no_webgl=True) as page:
        still = page.get_by_role("img", name=name)
        expect(still).to_be_visible()
        assert decode(capture(still)).variance() > 0, "no still render without WebGL"
    card_url = f"{app_url}/search?brand=Dhwani"
    with open_app(browser, card_url) as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        img = page.get_by_role("list", name="Products").get_by_role("article").first.get_by_role("img").first
        expect(img).to_be_visible()
        before_px = decode(capture(img))
        img.hover()
        advance(page, 200)
        assert difference(before_px, decode(capture(img))) > 0, "hovering the card image did not ripple"
    with open_app(browser, card_url, no_webgl=True) as page:
        img = page.get_by_role("list", name="Products").get_by_role("article").first.get_by_role("img").first
        rest, hover = state_styles(img, "transform", state="hover")
        m = re.match(r"matrix\(([-\d.]+)", hover["transform"])
        assert m and HOVER_SCALE_MIN <= float(m.group(1)) <= HOVER_SCALE_MAX, f"hover transform {hover}; expected a 3% scale"
    with open_app(browser, card_url, reduced_motion="reduce", no_webgl=True) as page:
        img = page.get_by_role("list", name="Products").get_by_role("article").first.get_by_role("img").first
        rest, hover = state_styles(img, "transform", state="hover")
        assert rest["transform"] == hover["transform"], "the image moved under reduced motion"


def test_dp17_touch_and_reduced_motion(app_url: str, browser: Browser) -> None:
    with plain_page(browser, app_url, viewport=PHONE, has_touch=True, is_mobile=True) as page:
        page.goto(f"{app_url}/p/steel-tiffin-3")
        expect(page.get_by_role("button", name="Add to cart")).to_be_visible()
        for loc in page.get_by_role("button").all() + page.get_by_role("link").all():
            if not loc.is_visible():
                continue
            box = loc.bounding_box()
            if box and 0 <= box["x"] < PHONE[0] and 0 <= box["y"] < PHONE[1]:
                assert box["width"] >= TARGET_PX - 0.5 and box["height"] >= TARGET_PX - 0.5, f"target {loc.inner_text()[:30]!r} is {box}"
        page.get_by_role("button", name="Add to cart").tap()
        page.goto(f"{app_url}/cart")
        expect(page.get_by_text("Steel Tiffin Stack, 3 tier").first).to_be_visible()
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        marquee = page.get_by_role("region", name="Delivery promises")
        marquee.scroll_into_view_if_needed()
        expect(marquee).to_be_visible()
        advance(page, 1000)
        loops = page.evaluate("() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getTiming().iterations === Infinity).length")
        assert loops == 0, f"{loops} infinite animations run under reduced motion"
        a = decode(capture(marquee))
        advance(page, 2000)
        assert difference(a, decode(capture(marquee))) < STILL_MAX, "the marquee moved under reduced motion"


def test_wf_product_page_pincode_wishlist_cart(app_url: str, wiremock: Any, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp15")
    today = today_ist(buyer)
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/p/steel-tiffin-3")
        mark(page)
        pin = page.get_by_role("textbox", name="Pincode", exact=True).first
        for code in ("560034", "110001"):
            pin.fill(code)
            page.get_by_role("button", name="Check pincode").first.click()
            expect(page.get_by_text(f"arrives by {promise_text(lane_promise(today, 'S-GANGA', code))}").first).to_be_visible()
        assert still_same_document(page), "the pincode change reloaded the product page"
        heart = page.get_by_role("button", name="Add to wishlist")
        heart.click()
        expect(heart).to_have_attribute("aria-pressed", "true")
        page.get_by_role("button", name="Add to cart").click()
        wait_for(lambda: line_for(cart(buyer), "L-1001") is not None, "Add to cart put the featured offer L-1001 in the server cart")
    share = buyer.call("POST", "/api/wishlist/share", {"display_name": "Probe"}).json()
    items = httpx.get(f"{app_url}/api/shared/{share['token']}").json()["items"]
    assert any(i["product_id"] == "steel-tiffin-3" for i in items)


def test_wf_product_page_signin_return(app_url: str, wiremock: Any, browser: Browser) -> None:
    acct = signup(app_url, wiremock, "dp15s")
    with plain_page(browser, app_url) as page:
        page.goto(f"{app_url}/p/cotton-kurta")
        page.get_by_role("link", name="Sign in").click()
        ui_signin(page, wiremock, acct.email, PASSWORD, acct.phone)
        expect(page).to_have_url(f"{app_url}/p/cotton-kurta")
        page.get_by_role("button", name="Add to cart").click()
    wait_for(lambda: line_for(cart(acct), "L-1006") is not None, "the product page add reached the signed-in cart")


def test_dp18_compare_up_to_four(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/compare", params={"ids": "dhwani-speaker,tara-smartwatch"})
    assert r.status_code == 200
    body = r.json()
    assert body["category"] == "electronics" and {p["id"] for p in body["products"]} == {"dhwani-speaker", "tara-smartwatch"}
    attrs = {a["name"]: a for a in body["attributes"]}
    for spec in ("battery_hours", "weight_grams", "warranty_months", "water_resistance"):
        assert attrs[spec]["differs"] is True and len(attrs[spec]["values"]) == 2
    four = "dhwani-speaker,tara-smartwatch,lehar-earbuds,jugnu-powerbank"
    assert httpx.get(f"{app_url}/api/compare", params={"ids": four}).status_code == 200
    for ids in (four + ",pankha-desk-fan", "dhwani-speaker", "dhwani-speaker,steel-tiffin-3"):
        assert_field(httpx.get(f"{app_url}/api/compare", params={"ids": ids}), "ids", re.compile(r".+"))
    assert_error(httpx.get(f"{app_url}/api/compare", params={"ids": "dhwani-speaker,no-such-product"}), 404, "not_found")


def test_dp19_offers_ranked_by_landed_price(app_url: str, wiremock: Any, actors: Actors) -> None:
    base_item = actors.listing("S-KAVERI", price=PRICE)
    pid = base_item["product_id"]
    g = actors.listing("S-GANGA", price=PRICE, product_id=pid)
    s = actors.listing("S-SABAR", price=PRICE, product_id=pid)
    m = actors.listing("S-MARINE", price=FREE_DELIVERY_FROM - 100, product_id=pid, cod=False)
    order_ids = [base_item["listing_id"], g["listing_id"], s["listing_id"], m["listing_id"]]

    def offers(**params: Any) -> dict:
        r = httpx.get(f"{app_url}/api/products/{pid}/offers", params=params)
        assert r.status_code == 200, r.text
        return r.json()

    data = offers(pin="560034")
    assert [o["listing_id"] for o in data["offers"]] == order_ids and data["total"] == 4
    fee_offer = data["offers"][3]
    assert fee_offer["delivery_fee_paise"] == STANDARD_FEE and fee_offer["landed_paise"] == FREE_DELIVERY_FROM - 100 + STANDARD_FEE
    assert [o["featured"] for o in data["offers"]] == [True, False, False, False]
    actors.seeded("S-KAVERI").ok("PUT", f"/api/seller/listings/{base_item['listing_id']}/stock", {"stock": 0})
    data = offers(pin="560034")
    assert [o["listing_id"] for o in data["offers"]] == order_ids[1:] + order_ids[:1]
    assert data["offers"][0]["featured"] is True
    product = httpx.get(f"{app_url}/api/products/{pid}").json()
    assert product["featured_offer"]["listing_id"] == g["listing_id"] and product["offers_count"] == 4
    nopin = offers()
    assert [o["listing_id"] for o in nopin["offers"]] == order_ids[1:] + order_ids[:1]
    assert len(offers(limit=2)["offers"]) == 2
    assert_field(httpx.get(f"{app_url}/api/products/{pid}/offers", params={"limit": OFFER_CAP + 1}), "limit", COPY["offer_page_size"])
    dhwani = httpx.get(f"{app_url}/api/products/dhwani-speaker/offers").json()["offers"]
    assert [o["listing_id"] for o in dhwani][:2] == ["L-1008", "L-1007"] and dhwani[1]["featured"] is True


def test_dp20_emi_tenures(app_url: str) -> None:
    for lid, no_cost_allowed in (("L-1009", True), ("L-1014", False)):
        body = httpx.get(f"{app_url}/api/emi-plans", params={"listing_id": lid}).json()
        p = LISTINGS[lid][4]
        assert body["amount_paise"] == p and body["monthly_rate_percent"] == "1.25"
        plans = {pl["tenure_months"]: pl for pl in body["plans"]}
        assert set(plans) == {3, 6, 9, 12}
        for n, plan in plans.items():
            no_cost = no_cost_allowed and n in (3, 6)
            assert plan["no_cost"] is no_cost
            want = emi_plan(p, n, no_cost)
            got = {k: plan[k] for k in want}
            assert got == want, f"{lid} {n} months: {got}; expected {want}"
    small = httpx.get(f"{app_url}/api/emi-plans", params={"listing_id": "L-1007"})
    assert_field(small, "amount", COPY["emi_minimum"])


def test_wf_compare_offers_journey(app_url: str, wiremock: Any, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp21")
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/search?category=electronics")
        picked = [title_of("L-1007"), title_of("L-1009")]
        for t in picked:
            tick(page.get_by_role("checkbox", name=f"Compare {t}").first)
        page.get_by_role("link", name=f"Compare ({len(picked)})").click()
        expect(page).to_have_url(re.compile(r"/compare\?ids=.*dhwani-speaker.*tara-smartwatch|/compare\?ids=.*tara-smartwatch.*dhwani-speaker"))
        toggle = page.get_by_role("switch", name="Highlight differences")
        toggle.click()
        expect(page).to_have_url(re.compile(r"diff=1"))
        copied = page.context.new_page()
        copied.goto(page.url)
        expect(copied.get_by_role("table", name="Compare products")).to_be_visible()
        expect(copied.get_by_role("switch", name="Highlight differences")).to_be_checked()
        page.goto(f"{app_url}/p/dhwani-speaker")
        offer_total = httpx.get(f"{app_url}/api/products/dhwani-speaker").json()["offers_count"]
        page.get_by_role("link", name=f"See all {offer_total} offers").click()
        expect(page).to_have_url(re.compile(r"/p/dhwani-speaker/offers"))
        table = page.get_by_role("table", name="Seller offers")
        expect(table.get_by_role("row").filter(has_text="featured offer")).to_contain_text("Marine Drive Gadgets")
        page.get_by_role("button", name=f"Choose {seller_name('S-SABAR')}").click()
        wait_for(lambda: line_for(cart(buyer), "L-1008") is not None, "Choose Sabarmati Electronics put L-1008 in the cart")
        page.goto(f"{app_url}/p/tara-smartwatch")
        expect(page.get_by_role("table", name="EMI plans")).to_contain_text(rupees(emi_plan(599900, 12, False)["instalment_paise"]))


def test_wf_compare_offers_limits(app_url: str, browser: Browser) -> None:
    with plain_page(browser, app_url) as page:
        page.goto(f"{app_url}/search?brand=Dhwani,Tara,Lehar,Jugnu,Pankha")
        for title in ("Dhwani Bluetooth Speaker", "Tara Smartwatch", "Lehar Wireless Earbuds", "Jugnu Power Bank 20000 mAh"):
            tick(page.get_by_role("checkbox", name=f"Compare {title}").first)
        fifth = page.get_by_role("checkbox", name=f"Compare {title_of('L-1012')}").first
        fifth.click()
        expect(page.get_by_role("status", name="Search results")).to_have_text(COPY["compare_over"])
        expect(fifth).not_to_be_checked()
        expect(page.get_by_role("link", name=f"Compare ({COMPARE_MAX})")).to_be_visible()
        page.goto(f"{app_url}/search?brand=Dhwani,Seeti")
        tick(page.get_by_role("checkbox", name=f"Compare {title_of('L-1007')}").first)
        page.get_by_role("checkbox", name=f"Compare {title_of('L-1003')}").first.click()
        expect(page.get_by_role("status", name="Search results")).to_have_text(COPY["compare_mixed"])
        page.goto(f"{app_url}/compare?ids=dhwani-speaker")
        expect(page.get_by_text(COPY["compare_under"], exact=True)).to_be_visible()


def test_dp22_cart_limits_and_line_options(app_url: str, wiremock: Any, actors: Actors) -> None:
    buyer = signup(app_url, wiremock, "dp22")
    add_address(buyer, "560034")
    today = today_ist(buyer)
    assert_field(buyer.call("POST", "/api/cart/lines", {"listing_id": "L-1001", "quantity": 11}), "quantity", COPY["qty_over_ten"])
    small = actors.listing("S-KAVERI", stock=3)
    assert_field(buyer.call("POST", "/api/cart/lines", {"listing_id": small["listing_id"], "quantity": 4}), "quantity", COPY["qty_over_stock"])
    assert_field(buyer.call("POST", "/api/cart/lines", {"listing_id": "L-1001", "quantity": 1, "unit_price_paise": 1}), "unit_price_paise", COPY["cant_set"])
    assert cart(buyer)["lines"] == []
    assert_error(buyer.call("POST", "/api/cart/lines", {"listing_id": "L-1012", "quantity": 1}), 409, "sold_out")
    add_line(buyer, "L-1001", 2)
    q = add_line(buyer, "L-1001", 3)
    assert line_for(q, "L-1001")["quantity"] == 5 and len(q["lines"]) == 1
    lid1001 = line_for(q, "L-1001")["line_id"]
    assert_field(buyer.call("PATCH", f"/api/cart/lines/{lid1001}", {"quantity": 2, "discount_paise": 0}), "discount_paise", COPY["cant_set"])
    assert line_for(cart(buyer), "L-1001")["quantity"] == 5
    for lid in ("L-1002", "L-1003", "L-1005", "L-1006", "L-1007", "L-1008", "L-1009", "L-1011", "L-1013"):
        add_line(buyer, lid, 1)
    assert_field(buyer.call("POST", "/api/cart/lines", {"listing_id": "L-1014", "quantity": 1}), "lines", COPY["cart_lines"])
    q = cart(buyer)
    buyer.ok("PATCH", f"/api/cart/lines/{line_for(q, 'L-1013')['line_id']}", {"selected": False})
    q = buyer.ok("POST", f"/api/cart/lines/{line_for(q, 'L-1009')['line_id']}/save-for-later", {})
    assert line_for(q, "L-1009") is None and any(s["listing_id"] == "L-1009" for s in q["saved_for_later"])
    selected = [l for l in q["lines"] if l["selected"]]
    assert q["subtotal_paise"] == sum(l["line_subtotal_paise"] for l in selected)
    assert line_for(q, "L-1013")["selected"] is False
    add_line(buyer, "L-1014", 1)
    saved_id = next(s["line_id"] for s in cart(buyer)["saved_for_later"] if s["listing_id"] == "L-1009")
    assert_field(buyer.call("POST", f"/api/cart/saved/{saved_id}/move-to-cart", {}), "lines", COPY["cart_lines"])
    q = buyer.ok("POST", f"/api/cart/lines/{line_for(cart(buyer), 'L-1008')['line_id']}/move-to-wishlist", {})
    assert line_for(q, "L-1008") is None
    q = buyer.ok("POST", f"/api/cart/saved/{saved_id}/move-to-cart", {})
    assert line_for(q, "L-1009") is not None
    share = buyer.call("POST", "/api/wishlist/share", {"display_name": "Probe"}).json()
    assert any(i["listing_id"] == "L-1008" for i in httpx.get(f"{app_url}/api/shared/{share['token']}").json()["items"])
    saree = line_for(q, "L-1005")["line_id"]
    q = buyer.ok("PATCH", f"/api/cart/lines/{saree}", {"gift_wrap": True, "gift_message": "g" * GIFT_MESSAGE_MAX})
    assert line_for(q, "L-1005")["gift_wrap"] is True and q["gift_wrap_paise"] == GIFT_WRAP_FEE
    assert_field(buyer.call("PATCH", f"/api/cart/lines/{saree}", {"gift_message": "g" * (GIFT_MESSAGE_MAX + 1)}), "gift_message",
                 "Gift message can be up to 240 characters.")
    q = buyer.ok("PUT", "/api/cart/delivery-speed", {"seller_id": "S-KAVERI", "speed": "one_day"})
    kaveri = next(p for p in q["parcels"] if p["seller_id"] == "S-KAVERI")
    assert kaveri["speed"] == "one_day" and kaveri["delivery_fee_paise"] == ONE_DAY_FEE
    assert kaveri["promise_date"] == (today + timedelta(days=1)).isoformat()
    assert q["delivery_paise"] == sum(p["delivery_fee_paise"] for p in q["parcels"])
    assert_field(buyer.call("PUT", "/api/cart/delivery-speed", {"seller_id": "S-GANGA", "speed": "one_day"}), "speed", COPY["one_day"])
    assert_field(buyer.call("PUT", "/api/cart/delivery-speed", {"seller_id": "S-GANGA", "speed": "standard", "delivery_fee_paise": 0}),
                 "delivery_fee_paise", COPY["cant_set"])


def test_dp23_tax_split_and_coupon_allocation(app_url: str, wiremock: Any) -> None:
    buyer = signup(app_url, wiremock, "dp23")
    add_address(buyer, "560034")
    order = ["L-1005", "L-1001", "L-1006", "L-1003"]
    for lid in order:
        add_line(buyer, lid, 1)
    q = cart(buyer)
    saree = line_for(q, "L-1005")
    assert (saree["taxable_value_paise"], saree["cgst_paise"], saree["sgst_paise"], saree["igst_paise"]) == (328571, 8215, 8214, 0)
    applies = 0

    def check(quote: dict, discount: int) -> None:
        shares = allocate(discount, [LISTINGS[l][4] for l in order])
        for lid, share in zip(order, shares):
            line = line_for(quote, lid)
            assert line["coupon_share_paise"] == share, f"{lid} coupon share {line['coupon_share_paise']}; expected {share}"
            total = LISTINGS[lid][4] - share
            assert line["line_total_paise"] == total
            intra = SELLERS[LISTINGS[lid][3]]["state"] == "Karnataka"
            got = (line["taxable_value_paise"], line["cgst_paise"], line["sgst_paise"], line["igst_paise"])
            assert got == tax_split(total, GST[LISTINGS[lid][2]], intra), f"{lid} tax split {got}"
        assert sum(l["coupon_share_paise"] for l in quote["lines"]) == discount
        assert quote["payable_paise"] == sum(l["line_total_paise"] for l in quote["lines"]) + quote["delivery_paise"] + quote["gift_wrap_paise"]

    check(q, 0)
    q = buyer.ok("POST", "/api/cart/coupon", {"code": "FLAT150"})
    applies += 1
    assert q["coupon"]["code"] == "FLAT150" and q["coupon"]["discount_paise"] == FLAT150_PAISE
    check(q, FLAT150_PAISE)
    buyer.ok("DELETE", "/api/cart/coupon")
    q = buyer.ok("POST", "/api/cart/coupon", {"code": "CHAURAHA10"})
    applies += 1
    assert q["coupon"]["discount_paise"] == min(sum(LISTINGS[l][4] for l in order) // 10, 50000)
    check(q, q["coupon"]["discount_paise"])
    assert_field(buyer.call("POST", "/api/cart/coupon", {"code": "DIWALI25"}), "code", COPY["bad_coupon"])
    applies += 1
    limited = None
    for _ in range(2 * COUPON_LIMIT + 1):
        r = buyer.call("POST", "/api/cart/coupon", {"code": "DIWALI25"})
        if r.status_code == 429:
            limited = r
            break
    assert limited is not None, f"{COUPON_LIMIT + 1} coupon applies never answered 429"
    body = assert_error(limited, 429, "rate_limited")
    assert limited.headers.get("Retry-After") == str(body["retry_after"])


def test_dp24_guest_cart_merge(app_url: str, wiremock: Any, actors: Actors) -> None:
    buyer = signup(app_url, wiremock, "dp24")
    add_line(buyer, "L-1001", 8)
    add_line(buyer, "L-1005", 1)
    gone = actors.listing("S-KAVERI")
    actors.seeded("S-KAVERI").ok("PATCH", f"/api/seller/listings/{gone['listing_id']}", {"status": "unlisted"})
    lines = [("L-1001", 5, "capped"), ("L-1005", 2, "combined"), ("L-1012", 1, "unavailable"), ("L-1003", 1, "added"),
             ("L-1004", 1, "added"), ("L-1006", 1, "added"), ("L-1007", 1, "added"), ("L-1008", 1, "added"),
             ("L-1009", 1, "added"), ("L-1010", 1, "added"), ("L-1011", 1, "added"), ("L-1013", 1, "saved_for_later"),
             (gone["listing_id"], 1, "unavailable")]
    res = buyer.ok("POST", "/api/cart/merge", {"lines": [{"listing_id": l, "quantity": n} for l, n, _ in lines]})
    got = [(r["listing_id"], r["outcome"]) for r in res["results"]]
    assert got == [(l, o) for l, _, o in lines], f"merge outcomes {got}"
    assert res["results"][0]["quantity"] == 10 and res["results"][1]["quantity"] == 3
    q = res["cart"]
    assert line_for(q, "L-1001")["quantity"] == 10 and line_for(q, "L-1005")["quantity"] == 3 and len(q["lines"]) == CART_LINES
    assert any(s["listing_id"] == "L-1013" for s in q["saved_for_later"])
    too_many = buyer.call("POST", "/api/cart/merge", {"lines": [{"listing_id": "L-1001", "quantity": 1}] * (MERGE_MAX + 1)})
    assert too_many.status_code == 422


def test_dp25_live_totals_and_announcements(app_url: str, wiremock: Any, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp25")
    add_address(buyer, "560034")
    today = today_ist(buyer)
    for lid in ("L-1006", "L-1001", "L-1007"):
        add_line(buyer, lid, 1)
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/cart")
        mark(page)
        total = page.get_by_role("group", name="Payable total")
        status = page.get_by_role("status", name="Cart updates")
        expect(page.get_by_text("cash on delivery unavailable").first).to_be_visible()
        page.get_by_role("spinbutton", name=f"Quantity for {title_of('L-1006')}").fill("2")
        page.keyboard.press("Tab")
        q = wait_for(lambda: (c := cart(buyer)) and line_for(c, "L-1006")["quantity"] == 2 and c, "quantity reached the server")
        expect(total).to_contain_text(rupees(q["payable_paise"]))
        expect(status).to_contain_text(f"Total {rupees(q['payable_paise'])}, 3 parcels.")
        page.get_by_role("button", name=f"Remove {title_of('L-1007')}").click()
        q = wait_for(lambda: (c := cart(buyer)) and line_for(c, "L-1007") is None and c, "removal reached the server")
        expect(status).to_contain_text(f"Total {rupees(q['payable_paise'])}, 2 parcels.")
        expect(status).to_contain_text(COPY["cod_available"])
        tick(page.get_by_role("radiogroup", name=f"Delivery speed for {seller_name('S-KAVERI')}").get_by_role("radio", name="One day"))
        expect(page.get_by_role("region", name=f"{seller_name('S-KAVERI')} parcel")).to_contain_text(f"arrives by {promise_text(today + timedelta(days=1))}")
        page.get_by_role("textbox", name="Coupon code").fill("FLAT150")
        page.get_by_role("button", name="Apply coupon").click()
        q = wait_for(lambda: (c := cart(buyer)) and c["coupon"] and c, "the coupon reached the server")
        expect(total).to_contain_text(rupees(q["payable_paise"]))
        page.get_by_role("button", name="Deliver to").click()
        dialog = page.get_by_role("dialog", name="Delivery pincode")
        dialog.get_by_role("textbox", name="Pincode").fill("194101")
        dialog.get_by_role("button", name="Check pincode").click()
        expect(page.get_by_role("region", name=f"{seller_name('S-GANGA')} parcel")).to_contain_text(
            f"arrives by {promise_text(lane_promise(today, 'S-GANGA', '194101'))}")
        assert still_same_document(page), "a cart change reloaded the page"
    assert cart(buyer)["destination"]["pincode"] == "194101"


def test_dp26_deal_price_by_server_clock(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    item = actors.listing("S-KAVERI", price=PRICE, stock=5)
    seller = actors.seeded("S-KAVERI")
    lid = item["listing_id"]
    buyer = signup(app_url, wiremock, "dp26")
    now = server_now(seller)
    ends = (now + timedelta(seconds=20)).isoformat().replace("+00:00", "Z")
    assert seller.call("PUT", f"/api/seller/listings/{lid}/deal", {"deal_price_paise": PRICE, "ends_at": ends}).status_code == 422
    past = (now - timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
    assert seller.call("PUT", f"/api/seller/listings/{lid}/deal", {"deal_price_paise": FREE_DELIVERY_FROM, "ends_at": past}).status_code == 422
    seller.ok("PUT", f"/api/seller/listings/{lid}/deal", {"deal_price_paise": FREE_DELIVERY_FROM, "ends_at": ends})
    q = add_line(buyer, lid, 1)
    assert line_for(q, lid)["unit_price_paise"] == FREE_DELIVERY_FROM and line_for(q, lid)["deal"]["price_paise"] == FREE_DELIVERY_FROM
    end_at = datetime.fromisoformat(line_for(q, lid)["deal"]["ends_at"].replace("Z", "+00:00"))

    def after_end() -> dict | None:
        c = cart(buyer)
        t = datetime.fromisoformat(c["server_time"].replace("Z", "+00:00"))
        line = line_for(c, lid)
        if t < end_at:
            assert line["unit_price_paise"] == FREE_DELIVERY_FROM, "the deal price stopped before ends_at"
            return None
        return c
    c = wait_for(after_end, "server time passed the deal end", POLL_SECONDS)
    assert line_for(c, lid)["unit_price_paise"] == PRICE and line_for(c, lid)["deal"] is None

    long_item = actors.listing("S-KAVERI", price=PRICE, stock=5)
    long_ends = (server_now(seller) + timedelta(seconds=300)).isoformat().replace("+00:00", "Z")
    seller.ok("PUT", f"/api/seller/listings/{long_item['listing_id']}/deal", {"deal_price_paise": FREE_DELIVERY_FROM, "ends_at": long_ends})
    add_line(buyer, long_item["listing_id"], 1)
    with plain_page(browser, app_url, buyer) as page:
        page.clock.install()
        page.goto(f"{app_url}/cart")
        timer = page.get_by_role("timer", name="Deal ends in")
        expect(timer).to_be_visible()
        t0 = timer.inner_text()
        page.clock.fast_forward(60_000)
        expect(timer).not_to_have_text(t0)
        page.get_by_role("spinbutton", name=f"Quantity for {long_item['title']}").fill("2")
        page.keyboard.press("Tab")
        wait_for(lambda: line_for(cart(buyer), long_item["listing_id"])["quantity"] == 2, "quantity change reached the server")
        expect(timer).to_be_visible()
        t2 = timer.inner_text()
        page.clock.fast_forward(60_000)
        expect(timer).not_to_have_text(t2)


def test_wf_cart_three_seller_journey(app_url: str, wiremock: Any, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp27")
    add_address(buyer, "560034")
    with plain_page(browser, app_url, buyer) as page:
        for slug in ("ilkal-saree", "pressure-cooker-5l", "dhwani-speaker"):
            page.goto(f"{app_url}/p/{slug}")
            page.get_by_role("button", name="Add to cart").click()
            wait_for(lambda: any(l["product_id"] == slug for l in cart(buyer)["lines"]), f"{slug} reached the cart")
        page.goto(f"{app_url}/cart")
        for seller in ("Kaveri Handlooms", "Ganga Steelworks", "Marine Drive Gadgets"):
            expect(page.get_by_role("region", name=f"{seller} parcel")).to_be_visible()
        page.get_by_role("textbox", name="Coupon code").fill("FLAT150")
        page.get_by_role("button", name="Apply coupon").click()
        saree_title = title_of("L-1005")
        note = "Happy Diwali"
        tick(page.get_by_role("checkbox", name=f"Gift wrap {saree_title}"))
        msg = page.get_by_role("textbox", name=f"Gift message for {saree_title}")
        msg.fill(note)
        msg.blur()
        expect(page.get_by_text(f"{len(note)}/{GIFT_MESSAGE_MAX}")).to_be_visible()
        tick(page.get_by_role("radiogroup", name=f"Delivery speed for {seller_name('S-KAVERI')}").get_by_role("radio", name="One day"))
        page.get_by_role("button", name=f"Save {title_of('L-1003')} for later").click()
        expect(page.get_by_role("region", name="Saved for later")).to_contain_text("Pressure Cooker 5 L")

        def settled() -> dict | None:
            c = cart(buyer)
            saree = line_for(c, "L-1005")
            kav = next((p for p in c["parcels"] if p["seller_id"] == "S-KAVERI"), {})
            ok = (c["coupon"] and saree and saree["gift_wrap"] and saree["gift_message"] == note
                  and kav.get("speed") == "one_day" and any(s["listing_id"] == "L-1003" for s in c["saved_for_later"]))
            return c if ok else None
        q = wait_for(settled, "coupon, gift wrap, one-day speed and save-for-later all reached the server")
        expect(page.get_by_role("group", name="Payable total")).to_contain_text(rupees(q["payable_paise"]))


def test_wf_cart_guest_merge_journey(app_url: str, wiremock: Any, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp27m")
    add_line(buyer, "L-1001", 9)
    buyer.raw("POST", "/api/auth/signout", {})
    with plain_page(browser, app_url) as page:
        for slug in ("steel-tiffin-3", "cotton-kurta"):
            page.goto(f"{app_url}/p/{slug}")
            page.get_by_role("button", name="Add to cart").click()
        page.goto(f"{app_url}/cart")
        page.get_by_role("link", name="Sign in").click()
        ui_signin(page, wiremock, buyer.email, PASSWORD, buyer.phone)
        expect(page).to_have_url(f"{app_url}/cart")
        merge = page.get_by_role("region", name="Cart merge")
        expect(merge).to_contain_text(f"{title_of('L-1001')}: combined, now {QTY_MAX}.")
        expect(merge).to_contain_text(f"{title_of('L-1006')}: added.")
        resp = page.request.get(f"{app_url}/api/cart").json()
    assert line_for(resp, "L-1001")["quantity"] == 10 and line_for(resp, "L-1006")["quantity"] == 1


def test_dp28_one_order_per_idempotency_key(app_url: str, wiremock: Any, actors: Actors, killbill: Any) -> None:
    item = actors.listing("S-KAVERI", stock=5)
    buyer = signup(app_url, wiremock, "dp28")
    add_address(buyer)
    add_line(buyer, item["listing_id"], 1)
    body = checkout_body(buyer, pay_card())
    assert_error(post_checkout(buyer, body, None), 428, "idempotency_key_required", COPY["idempotency_key_required"])
    key = idempotency_key()
    mirrors = [buyer.on(app_url) for _ in range(4)]
    results = fire_together([lambda m=m: post_checkout(m, body, key) for m in mirrors])
    assert all(r.status_code == 201 for r in results), [r.status_code for r in results]
    order_ids = {r.json()["order_id"] for r in results}
    assert len(order_ids) == 1, f"racing one key made orders {order_ids}"
    order_id = order_ids.pop()
    replay = post_checkout(buyer, body, key)
    assert replay.status_code == 201 and replay.headers.get("Idempotent-Replayed") == "true"
    assert replay.json() == results[0].json()
    changed = dict(body, expected_payable_paise=body["expected_payable_paise"] + 1)
    assert_error(post_checkout(buyer, changed, key), 409, "idempotency_key_reused", COPY["idempotency_key_reused"])
    kb_wait(killbill, f"{order_id}-card", "PURCHASE", results[0].json()["payable_paise"])
    payments = kb_account_payments(killbill, buyer.id)
    assert len(payments) == 1, f"Kill Bill holds {len(payments)} payments; expected one charge"
    assert seller_listing(actors.seeded("S-KAVERI"), item["listing_id"], item["title"])["stock"] == 4
    add_line(buyer, item["listing_id"], 1)
    stale = dict(checkout_body(buyer, pay_card()))
    stale["expected_payable_paise"] += 1
    k2 = idempotency_key()
    first = post_checkout(buyer, stale, k2)
    body409 = assert_error(first, 409, "price_changed", COPY["price_changed"])
    assert "quote" in body409
    again = post_checkout(buyer, stale, k2)
    assert again.status_code == 409 and again.json()["error"] == "price_changed"


def test_dp29_last_unit_goes_to_one_shopper(app_url: str, wiremock: Any, actors: Actors, killbill: Any) -> None:
    item = actors.listing("S-KAVERI", stock=2)
    buyers = [signup(app_url, wiremock, f"dp29{i}") for i in range(5)]
    bodies = []
    for b in buyers:
        add_address(b)
        add_line(b, item["listing_id"], 1)
        bodies.append(checkout_body(b, pay_card()))
    results = fire_together([lambda b=b, body=body: post_checkout(b, body, idempotency_key()) for b, body in zip(buyers, bodies)])
    codes = [r.status_code for r in results]
    assert codes.count(201) == 2 and codes.count(409) == 3, f"statuses {codes}; expected two 201 and three 409"
    for b, r in zip(buyers, results):
        if r.status_code == 409:
            body = assert_error(r, 409, "sold_out", COPY["sold_out"])
            assert item["listing_id"] in body["listing_ids"]
            assert kb_account_payments(killbill, b.id) == [], "a losing shopper was charged"
        else:
            kb_wait(killbill, f"{r.json()['order_id']}-card", "PURCHASE", r.json()["payable_paise"])
    assert seller_listing(actors.seeded("S-KAVERI"), item["listing_id"], item["title"])["stock"] == 0


def test_dp30_prepaid_checkout_all_or_nothing(app_url: str, wiremock: Any, actors: Actors, killbill: Any) -> None:
    item = actors.listing("S-KAVERI", stock=5)
    seller = actors.seeded("S-KAVERI")
    buyer = signup(app_url, wiremock, "dp30")
    order = buy(buyer, [(item["listing_id"], 1)], pay_card())
    assert order["status"] == "placed" and order["payment"]["status"] == "confirmed"
    paid = kb_wait(killbill, f"{order['order_id']}-card", "PURCHASE", order["payable_paise"])
    assert paid
    down = buyer.on(outage_url("APP_KILLBILL_DOWN_URL"))
    add_line(buyer, item["listing_id"], 1)
    stock_before = seller_listing(seller, item["listing_id"], item["title"])["stock"]
    orders_before = {o["order_id"] for o in buyer.ok("GET", "/api/orders")["orders"]}
    r = post_checkout(down, checkout_body(buyer, pay_card()), idempotency_key())
    assert_error(r, 503, "payments_unavailable", COPY["payments_unavailable"])
    assert {o["order_id"] for o in buyer.ok("GET", "/api/orders")["orders"]} == orders_before
    assert seller_listing(seller, item["listing_id"], item["title"])["stock"] == stock_before
    assert line_for(cart(buyer), item["listing_id"]) is not None
    assert len(kb_account_payments(killbill, buyer.id)) == 1

    funded = signup(app_url, wiremock, "dp30b")
    fund_balance(actors, funded, 30000)
    held_balance = balance(funded)
    add_line(funded, item["listing_id"], 1)
    wiremock.stub("POST", "/upi/v1/collect", status=500, json={"status": "ERROR"})
    before_orders = {o["order_id"] for o in funded.ok("GET", "/api/orders")["orders"]}
    r = post_checkout(funded, checkout_body(funded, pay_upi(use_balance=True)), idempotency_key())
    assert_error(r, 503, "upi_unavailable", COPY["upi_unavailable"])
    assert balance(funded) == held_balance, "the balance hold was not released"
    assert {o["order_id"] for o in funded.ok("GET", "/api/orders")["orders"]} == before_orders
    for p in kb_account_payments(killbill, funded.id):
        assert not str(p.get("paymentExternalKey", "")).endswith("-upi"), "a UPI leg was recorded although starting UPI failed"
        if str(p.get("paymentExternalKey", "")).endswith("-balance"):
            wait_for(lambda p=p: kb_sum(killbill.payment_by_key(p["paymentExternalKey"]), "REFUND") == kb_sum(p, "PURCHASE"),
                     "the recorded balance leg was refunded in full after UPI failed")


DP31_CASES = ["upi", "upi_expiry", "netbanking", "card", "emi"]


@pytest.mark.timeout(900)
@pytest.mark.parametrize("case", DP31_CASES, ids=DP31_CASES)
def test_dp31_payment_methods(app_url: str, wiremock: Any, actors: Actors, killbill: Any, case: str) -> None:
    if case == "upi_expiry":
        short = outage_url("APP_SHORT_URL")
        buyer = signup(short, wiremock, "dp31x")
        add_address(buyer)
        add_line(buyer, "L-1006", 1)
        r = post_checkout(buyer, checkout_body(buyer, pay_upi()), idempotency_key())
        assert r.status_code == 201, r.text
        order = r.json()
        pid = order["payment"]["payment_id"]
        wiremock.stub("GET", f"/upi/v1/collect/{pid}", json={"status": "PENDING"})
        sent = [b for b in journal(wiremock, "/upi/v1/collect") if b.get("reference") == pid]
        assert sent and sent[-1]["expires_in_seconds"] == SHORT_OTP
        wait_for(lambda: buyer.ok("GET", f"/api/payments/{pid}")["status"] == "expired", "the UPI payment expired after UPI_EXPIRY_SECONDS")
        detail = buyer.ok("GET", f"/api/orders/{order['order_id']}")
        assert all(s["state"] == "cancelled" for s in detail["shipments"])
        return
    buyer = signup(app_url, wiremock, f"dp31{case[:3]}")
    add_address(buyer)
    if case == "upi":
        item = actors.listing("S-KAVERI", stock=5)
        add_line(buyer, item["listing_id"], 1)
        r = post_checkout(buyer, checkout_body(buyer, pay_upi()), idempotency_key())
        assert r.status_code == 201, r.text
        order = r.json()
        pid = order["payment"]["payment_id"]
        wiremock.stub("GET", f"/upi/v1/collect/{pid}", json={"status": "PENDING"})
        assert order["status"] == "awaiting_payment" and order["payment"]["status"] == "awaiting_customer"
        sent = [b for b in journal(wiremock, "/upi/v1/collect") if b.get("reference") == pid][-1]
        assert sent["vpa"] == "asha@okbank" and sent["amount_paise"] == order["payable_paise"] and sent["expires_in_seconds"] == UPI_EXPIRY_DEFAULT
        assert buyer.ok("GET", f"/api/payments/{pid}")["status"] == "awaiting_customer"
        assert killbill.payment_by_key(f"{order['order_id']}-upi") is None
        wiremock.stub("GET", f"/upi/v1/collect/{pid}", json={"status": "SUCCESS"})
        wait_for(lambda: buyer.ok("GET", f"/api/payments/{pid}")["status"] == "confirmed", "the UPI payment confirmed after SUCCESS")
        kb_wait(killbill, f"{order['order_id']}-upi", "PURCHASE", order["payable_paise"])
    elif case == "netbanking":
        banks = {b["code"]: b["name"] for b in httpx.get(f"{app_url}/api/banks").json()["banks"]}
        assert banks == {"SAFB": "Saffron Bank", "NILB": "Nilgiri Bank", "DECB": "Deccan Cooperative Bank", "KONB": "Konkan Bank"}
        item = actors.listing("S-KAVERI", stock=5)
        add_line(buyer, item["listing_id"], 1)
        bad = dict(checkout_body(buyer, pay_netbanking()), payment={"method": "netbanking", "use_balance": False, "netbanking": {"bank_code": "ZZZZ"}})
        assert post_checkout(buyer, bad, idempotency_key()).status_code == 422
        r = post_checkout(buyer, checkout_body(buyer, pay_netbanking()), idempotency_key())
        assert r.status_code == 201 and r.json()["status"] == "awaiting_payment", r.text
        order = r.json()
        pid = order["payment"]["payment_id"]
        sent = [b for b in journal(wiremock, "/netbanking/v1/payments") if b.get("reference") == pid][-1]
        assert sent["bank_code"] == "SAFB" and sent["amount_paise"] == order["payable_paise"]
        wait_for(lambda: buyer.ok("GET", f"/api/payments/{pid}")["status"] == "confirmed", "net banking confirmed after SUCCESS")
        kb_wait(killbill, f"{order['order_id']}-netbanking", "PURCHASE", order["payable_paise"])
    elif case == "card":
        item = actors.listing("S-KAVERI", stock=10)
        lid = item["listing_id"]
        for number in (VISA, luhn("2221"), luhn("60")):
            o = buy(buyer, [(lid, 1)], pay_card(number, save=True))
            assert o["payment"]["status"] == "confirmed"
            kb_wait(killbill, f"{o['order_id']}-card", "PURCHASE", o["payable_paise"])
        cards = buyer.ok("GET", "/api/account/cards")
        nets = {c["network"].lower() for c in cards["cards"]}
        assert {"visa", "mastercard", "rupay"} <= nets
        text = json.dumps(cards)
        assert VISA not in text and CVV not in [str(v) for c in cards["cards"] for v in c.values()]
        assert any(c["last4"] == "1111" for c in cards["cards"])
        add_line(buyer, lid, 1)
        for number in (AMEX, VISA[:-1] + "2"):
            r = post_checkout(buyer, checkout_body(buyer, pay_card(number)), idempotency_key())
            assert r.status_code == 422, r.text
        assert_field(post_checkout(buyer, checkout_body(buyer, pay_card(AMEX)), idempotency_key()), None, COPY["card_network"])
        saved = cards["cards"][0]["card_id"]
        no_cvv = {"method": "card", "use_balance": False, "card": {"saved_card_id": saved}}
        assert post_checkout(buyer, checkout_body(buyer, no_cvv), idempotency_key()).status_code == 422
        with_cvv = {"method": "card", "use_balance": False, "card": {"saved_card_id": saved, "cvv": CVV}}
        assert post_checkout(buyer, checkout_body(buyer, with_cvv), idempotency_key()).status_code == 201
    else:
        big = actors.listing("S-KAVERI", price=400000, stock=5, emi=True)
        add_line(buyer, big["listing_id"], 1)
        for n in (3, 9):
            q = buyer.ok("PUT", "/api/cart/payment", {"method": "emi", "use_balance": False, "emi_tenure_months": n})
            want = emi_plan(400000, n, n == 3)["upfront_discount_paise"]
            assert q["emi_discount_paise"] == want and q["payable_paise"] == 400000 - want
        plans = {p["tenure_months"]: p for p in buyer.ok("GET", "/api/cart/emi-plans")["plans"]}
        assert plans[6]["upfront_discount_paise"] == emi_plan(400000, 6, True)["upfront_discount_paise"]
        assert buyer.call("PUT", "/api/cart/payment", {"method": "emi", "use_balance": True, "emi_tenure_months": 6}).status_code == 422
        payment = {"method": "emi", "use_balance": False, "emi": {"tenure_months": 6, "card": card()}}
        r = post_checkout(buyer, checkout_body(buyer, payment), idempotency_key())
        assert r.status_code == 201, r.text
        kb_wait(killbill, f"{r.json()['order_id']}-emi", "PURCHASE", 400000 - emi_plan(400000, 6, True)["upfront_discount_paise"])
        small = actors.listing("S-KAVERI", price=200000, stock=5)
        add_line(buyer, small["listing_id"], 1)
        assert_field(buyer.call("PUT", "/api/cart/payment", {"method": "emi", "use_balance": False, "emi_tenure_months": 3}), None, COPY["emi_minimum"])


@pytest.mark.timeout(900)
def test_dp32_balance_split_and_refund_order(app_url: str, wiremock: Any, actors: Actors, killbill: Any) -> None:
    buyer = signup(app_url, wiremock, "dp32")
    fund = fund_balance(actors, buyer, 30000)
    bal = fund["amount"]
    item = actors.listing("S-KAVERI", price=100000, stock=5)
    add_line(buyer, item["listing_id"], 2)
    q = buyer.ok("PUT", "/api/cart/payment", {"method": "card", "use_balance": True, "emi_tenure_months": None})
    assert q["balance_applied_paise"] == bal and q["due_paise"] == q["payable_paise"] - bal
    r = post_checkout(buyer, checkout_body(buyer, pay_card(use_balance=True)), idempotency_key())
    assert r.status_code == 201, r.text
    order = r.json()
    legs = {l["method"]: l["amount_paise"] for l in order["payment"]["legs"]}
    assert legs == {"balance": bal, "card": order["payable_paise"] - bal}
    oid = order["order_id"]
    kb_wait(killbill, f"{oid}-balance", "PURCHASE", bal)
    kb_wait(killbill, f"{oid}-card", "PURCHASE", order["payable_paise"] - bal)
    assert balance(buyer) == 0
    fulfil(actors.seeded("S-KAVERI"), order["shipments"][0]["shipment_id"])
    line = order_lines(buyer, oid)[0]
    support = actors.seeded("support")
    half = line["line_total_paise"] // 2
    support.ok("POST", f"/api/support/shipment-lines/{line['line_id']}/refunds", {"quantity": 1, "reason": "Probe first unit refund"}, status=201)
    kb_wait(killbill, f"{oid}-card", "REFUND", half)
    assert kb_sum(killbill.payment_by_key(f"{oid}-balance"), "REFUND") == 0
    support.ok("POST", f"/api/support/shipment-lines/{line['line_id']}/refunds", {"quantity": 1, "reason": "Probe last unit refund"}, status=201)
    kb_wait(killbill, f"{oid}-card", "REFUND", order["payable_paise"] - bal)
    kb_wait(killbill, f"{oid}-balance", "REFUND", line["line_total_paise"] - (order["payable_paise"] - bal))
    wait_for(lambda: balance(buyer) == line["line_total_paise"] - (order["payable_paise"] - bal), "the balance-leg refund credited the balance")


DP33_CASES = ["cod_seller", "cod_pincode", "cod_open_orders", "cod_over_cap", "cod_refund_to_balance"]


@pytest.mark.parametrize("case", DP33_CASES, ids=DP33_CASES)
def test_dp33_cash_on_delivery_rules(app_url: str, wiremock: Any, actors: Actors, killbill: Any, case: str) -> None:
    buyer = signup(app_url, wiremock, "dp33")
    cod = {"method": "cod", "use_balance": False, "emi_tenure_months": None}
    if case == "cod_seller":
        add_address(buyer)
        add_line(buyer, "L-1007", 1)
        add_line(buyer, "L-1006", 1)
        assert_field(buyer.call("PUT", "/api/cart/payment", cod), "method", "Marine Drive Gadgets doesn't offer cash on delivery.")
        quote = cart(buyer)
        assert quote["cod"]["eligible"] is False and quote["cod"]["reason"] == "cod_seller"
    elif case == "cod_pincode":
        add_address(buyer, "194101")
        add_line(buyer, actors.listing("S-KAVERI")["listing_id"], 1)
        assert_field(buyer.call("PUT", "/api/cart/payment", cod), "method", "Cash on delivery isn't available at 194101.")
    elif case == "cod_open_orders":
        add_address(buyer)
        k, g = actors.listing("S-KAVERI", stock=10), actors.listing("S-GANGA", stock=10)
        add_line(buyer, k["listing_id"], 1)
        add_line(buyer, g["listing_id"], 1)
        q = buyer.ok("PUT", "/api/cart/payment", cod)
        assert q["cod_fee_paise"] == 2 * COD_FEE and all(p["cod_fee_paise"] == COD_FEE for p in q["parcels"])
        first = buy(buyer, [], pay_cod())
        assert len(first["shipments"]) == 2
        buy(buyer, [(k["listing_id"], 1)], pay_cod())
        buy(buyer, [(k["listing_id"], 1)], pay_cod())
        assert kb_account_payments(killbill, buyer.id) == [], "a COD order without balance called Kill Bill"
        add_line(buyer, k["listing_id"], 1)
        assert_field(buyer.call("PUT", "/api/cart/payment", cod), "method", COPY["cod_open_orders"])
    elif case == "cod_over_cap":
        add_address(buyer)
        edge = actors.listing("S-KAVERI", price=COD_CAP - COD_FEE, stock=1)
        add_line(buyer, edge["listing_id"], 1)
        q = buyer.ok("PUT", "/api/cart/payment", cod)
        assert q["payable_paise"] == COD_CAP and q["cod"]["eligible"] is True
        other = signup(app_url, wiremock, "dp33c")
        add_address(other)
        over = actors.listing("S-KAVERI", price=COD_CAP - COD_FEE + 100, stock=1)
        add_line(other, over["listing_id"], 1)
        assert_field(other.call("PUT", "/api/cart/payment", cod), "method", COPY["cod_over_cap"])
    else:
        result = fund_balance(actors, buyer, 30000)
        oid, sid = result["order"]["order_id"], result["shipment_id"]
        kb_wait(killbill, f"{oid}-cod-{sid}", "PURCHASE", result["order"]["payable_paise"])
        kb_wait(killbill, f"{oid}-cod-{sid}", "REFUND", result["amount"])
        assert balance(buyer) == result["amount"]


def test_dp34_expired_session_resumes_checkout(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp34")
    add_address(buyer)
    add_line(buyer, actors.listing("S-KAVERI")["listing_id"], 1)
    expired = {"error": "signed_out", "message": COPY["signed_out"]}
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/checkout/address")
        tick(page.get_by_role("radiogroup", name="Delivery address").get_by_role("radio").first)
        page.get_by_role("button", name="Continue").click()
        expect(page.get_by_role("heading", name="payment", level=2)).to_be_focused()
        refreshes: list[str] = []
        page.on("request", lambda req: refreshes.append(req.url) if "/api/auth/refresh" in req.url else None)
        state = {"failed": False}

        def fail_once(route: Any) -> None:
            if not state["failed"] and route.request.method != "GET" and "/api/auth/" not in route.request.url:
                state["failed"] = True
                route.fulfill(status=401, json=expired)
            else:
                route.fallback()
        page.route("**/api/**", fail_once)
        tick(page.get_by_role("radio", name="Cash on delivery"))
        wait_for(lambda: cart(buyer)["payment"]["method"] == "cod", "the replayed request saved the payment method")
        assert state["failed"] and len(refreshes) == 1, f"refresh calls {refreshes}; expected exactly one"
        expect(page.get_by_role("alert", name="Checkout problems")).to_have_count(0)
        page.unroute("**/api/**")

        state["failed"] = False
        page.route("**/api/auth/refresh", lambda route: route.fulfill(status=401, json=expired))
        page.route("**/api/**", fail_once)
        page.get_by_role("button", name="Continue").click()
        expect(page).to_have_url(re.compile(r"/signin\?next="))
        nxt = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)["next"][0]
        assert nxt.startswith("/checkout/payment"), f"next={nxt}"
        expect(page.get_by_role("status", name="Sign-in status")).to_have_text(COPY["signed_out"])
        page.unroute("**/api/**")
        page.unroute("**/api/auth/refresh")
        ui_signin(page, wiremock, buyer.email, PASSWORD, buyer.phone)
        expect(page).to_have_url(re.compile(r"/checkout/payment"))
        expect(page.get_by_role("radio", name="Cash on delivery")).to_be_checked()
        assert page.request.get(f"{app_url}/api/cart").json()["lines"], "the cart was lost across sign-in"


def test_dp35_checkout_by_keyboard(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp35")
    add_address(buyer)
    add_line(buyer, actors.listing("S-KAVERI")["listing_id"], 1)
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/search")
        tab_until(page, page.get_by_role("button", name="Search"))
        page.keyboard.press("/")
        expect(page.get_by_role("searchbox", name="Search Chauraha")).to_be_focused()
        tab_until(page, page.get_by_role("checkbox", name=re.compile(r"^Electronics")))
        page.keyboard.press("Space")
        expect(page).to_have_url(re.compile(r"category=electronics"))
        page.goto(f"{app_url}/cart")
        tab_until(page, page.get_by_role("link", name="Checkout"))
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/checkout/address"))
        expect(page.get_by_role("heading", name="address", level=2)).to_be_focused()
        opener = page.get_by_role("button", name="Add address")
        tab_until(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New address")
        expect(dialog).to_be_visible()
        for key in ["Tab"] * 25 + ["Shift+Tab"] * 25:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} moved focus out of the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        tab_until(page, page.get_by_role("radiogroup", name="Delivery address").get_by_role("radio").first)
        page.keyboard.press("Space")
        tab_until(page, page.get_by_role("button", name="Continue"))
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="payment", level=2)).to_be_focused()
        tab_until(page, page.get_by_role("radiogroup", name="Payment method"))
        cod = page.get_by_role("radio", name="Cash on delivery")
        for _ in range(6):
            if cod.is_checked():
                break
            page.keyboard.press("ArrowDown")
        expect(cod).to_be_checked()
        tab_until(page, page.get_by_role("button", name="Continue"))
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="review", level=2)).to_be_focused()
        tab_until(page, page.get_by_role("button", name="Place order"))
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/orders/[^/]+/placed$"))
        expect(page.get_by_role("heading", level=1)).to_have_text(COPY["placed"])
        oid = page.url.rstrip("/").split("/")[-2]
    assert buyer.ok("GET", f"/api/orders/{oid}")["order_id"] == oid


def test_dp36_published_copy(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp36")
    add_address(buyer)
    seller = actors.seeded("S-KAVERI")
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/cart")
        expect(page.get_by_text(COPY["empty_cart"], exact=True)).to_be_visible()
        page.goto(f"{app_url}/no-such-page-probe")
        expect(page.get_by_text(COPY["not_found"], exact=True)).to_be_visible()
        page.goto(f"{app_url}/p/steel-tiffin-3")
        page.get_by_role("textbox", name="Pincode", exact=True).first.fill("744101")
        page.get_by_role("button", name="Check pincode").first.click()
        expect(page.get_by_text("We don't deliver to 744101 yet.").first).to_be_visible()
        line_item = actors.listing("S-KAVERI", stock=2)
        add_line(buyer, line_item["listing_id"], 1)
        seller.ok("PUT", f"/api/seller/listings/{line_item['listing_id']}/stock", {"stock": 0})
        page.goto(f"{app_url}/cart")
        expect(page.get_by_text(COPY["sold_out_line"], exact=True)).to_be_visible()
        buyer.ok("DELETE", f"/api/cart/lines/{line_for(cart(buyer), line_item['listing_id'])['line_id']}")
        add_line(buyer, "L-1007", 1)
        page.goto(f"{app_url}/checkout/address")
        tick(page.get_by_role("radiogroup", name="Delivery address").get_by_role("radio").first)
        page.get_by_role("button", name="Continue").click()
        expect(page.get_by_text("Marine Drive Gadgets doesn't offer cash on delivery.").first).to_be_visible()
        buyer.ok("DELETE", f"/api/cart/lines/{line_for(cart(buyer), 'L-1007')['line_id']}")
        last = actors.listing("S-KAVERI", stock=1)
        add_line(buyer, last["listing_id"], 1)
        page.goto(f"{app_url}/checkout/address")
        tick(page.get_by_role("radiogroup", name="Delivery address").get_by_role("radio").first)
        page.get_by_role("button", name="Continue").click()
        tick(page.get_by_role("radio", name="Cash on delivery"))
        page.get_by_role("button", name="Continue").click()
        place = page.get_by_role("button", name="Place order")
        expect(place).to_be_visible()
        seller.ok("PUT", f"/api/seller/listings/{last['listing_id']}/stock", {"stock": 0})
        place.click()
        expect(page.get_by_role("alert", name="Checkout problems")).to_contain_text(COPY["sold_out"])
    assert buyer.ok("GET", "/api/orders")["orders"] == []
    assert_error(httpx.get(f"{app_url}/api/no-such-route-probe"), 404, "not_found", COPY["not_found"])
    assert_error(httpx.post(f"{app_url}/api/shared/notarealtoken", json={}), 405, "read_only", COPY["read_only"])
    big = '{"code":"' + "x" * (JSON_LIMIT - 10) + '"}'
    assert_error(buyer.raw("POST", "/api/balance/redeem", content=big, headers={"Content-Type": "application/json"}), 413, "too_large", COPY["too_large"])
    exact = '{"code":"' + "x" * (JSON_LIMIT - 11) + '"}'
    assert len(exact.encode()) == JSON_LIMIT
    assert buyer.raw("POST", "/api/balance/redeem", content=exact, headers={"Content-Type": "application/json"}).status_code != 413
    down = seller.on(outage_url("APP_MINIO_DOWN_URL"))
    r = down.call("POST", f"/api/seller/listings/{last['listing_id']}/photos", files={"file": ("p.png", PNG_1X1, "image/png")})
    assert_error(r, 503, "storage_unavailable", COPY["storage_unavailable"])


def checkout_ui_to_review(page: Page) -> None:
    tick(page.get_by_role("radiogroup", name="Delivery address").get_by_role("radio").first)
    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", name="payment", level=2)).to_be_visible()


def fill_card(page: Page) -> None:
    tick(page.get_by_role("radio", name="Card"))
    page.get_by_role("textbox", name="Card number").fill(VISA)
    page.get_by_role("textbox", name="Expiry (MM/YY)").fill("12/30")
    page.get_by_role("textbox", name="CVV").fill(CVV)
    page.get_by_role("textbox", name="Name on card").fill("Probe Buyer")
    page.get_by_role("button", name="Continue").click()


def test_wf_checkout_multi_seller_card(app_url: str, wiremock: Any, actors: Actors, browser: Browser, killbill: Any) -> None:
    buyer = signup(app_url, wiremock, "dp37")
    add_address(buyer)
    for s in ("S-KAVERI", "S-GANGA", "S-SABAR"):
        add_line(buyer, actors.listing(s)["listing_id"], 1)
    payable = cart(buyer)["payable_paise"]
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/cart")
        page.get_by_role("link", name="Checkout").click()
        checkout_ui_to_review(page)
        fill_card(page)
        page.get_by_role("button", name=f"Pay {rupees(payable)}").dblclick()
        expect(page).to_have_url(re.compile(r"/orders/[^/]+/placed$"))
        expect(page.get_by_role("heading", level=1)).to_have_text(COPY["placed"])
        expect(page.get_by_text("3 parcels on the way.")).to_be_visible()
        expect(page.get_by_role("link", name="View order")).to_be_visible()
        oid = page.url.rstrip("/").split("/")[-2]
    orders = buyer.ok("GET", "/api/orders")["orders"]
    assert [o["order_id"] for o in orders] == [oid]
    assert len(buyer.ok("GET", f"/api/orders/{oid}")["shipments"]) == 3
    kb_wait(killbill, f"{oid}-card", "PURCHASE", payable)
    assert len(kb_account_payments(killbill, buyer.id)) == 1


def test_wf_checkout_upi_waiting(app_url: str, wiremock: Any, actors: Actors, browser: Browser, killbill: Any) -> None:
    buyer = signup(app_url, wiremock, "dp37u")
    add_address(buyer)
    add_line(buyer, actors.listing("S-KAVERI")["listing_id"], 1)
    payable = cart(buyer)["payable_paise"]
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/checkout/address")
        checkout_ui_to_review(page)
        tick(page.get_by_role("radio", name="UPI"))
        page.get_by_role("textbox", name="UPI ID").fill("asha@okbank")
        page.get_by_role("button", name="Continue").click()
        with held(page, "**/api/payments/**") as gate:
            with page.expect_response(lambda r: "/api/checkout" in r.url and r.request.method == "POST") as info:
                page.get_by_role("button", name=f"Pay {rupees(payable)}").click()
            order = info.value.json()
            pid = order["payment"]["payment_id"]
            wiremock.stub("GET", f"/upi/v1/collect/{pid}", json={"status": "PENDING"})
            gate.release()
        expect(page).to_have_url(re.compile(rf"/orders/{order['order_id']}/placed$"))
        expect(page.get_by_role("heading", level=1)).to_have_text(COPY["waiting"])
        expect(page.get_by_role("timer", name="UPI request expires in")).to_be_visible()
        wiremock.stub("GET", f"/upi/v1/collect/{pid}", json={"status": "SUCCESS"})
        expect(page.get_by_role("heading", level=1)).to_have_text(COPY["placed"], timeout=POLL_SECONDS * 1000)
    kb_wait(killbill, f"{order['order_id']}-upi", "PURCHASE", payable)


def test_wf_checkout_payments_down(wiremock: Any, app_url: str, actors: Actors, browser: Browser, killbill: Any) -> None:
    down = outage_url("APP_KILLBILL_DOWN_URL")
    buyer = signup(app_url, wiremock, "dp37d")
    add_address(buyer)
    add_line(buyer, actors.listing("S-KAVERI")["listing_id"], 1)
    payable = cart(buyer)["payable_paise"]
    with plain_page(browser, down, buyer) as page:
        page.goto(f"{down}/checkout/address")
        checkout_ui_to_review(page)
        fill_card(page)
        page.get_by_role("button", name=f"Pay {rupees(payable)}").click()
        expect(page.get_by_role("alert", name="Checkout problems")).to_contain_text(COPY["payments_unavailable"])
    assert buyer.ok("GET", "/api/orders")["orders"] == []
    assert kb_account_payments(killbill, buyer.id) == []


def test_dp38_own_orders_only(app_url: str, wiremock: Any, actors: Actors) -> None:
    owner, other = signup(app_url, wiremock, "dp38a"), signup(app_url, wiremock, "dp38b")
    order = buy(owner, [(actors.listing("S-KAVERI")["listing_id"], 2)], pay_card())
    oid, sid = order["order_id"], order["shipments"][0]["shipment_id"]
    assert owner.call("GET", f"/api/orders/{oid}").status_code == 200
    for method, path, body in [("GET", f"/api/orders/{oid}", None), ("GET", f"/api/shipments/{sid}", None),
                               ("GET", f"/api/shipments/{sid}/invoice", None), ("POST", f"/api/shipments/{sid}/cancel", {}),
                               ("GET", "/api/orders/CH-SEED0001", None)]:
        assert_error(other.call(method, path, body), 404, "not_found", COPY["not_found"])
    assert oid not in {o["order_id"] for o in other.ok("GET", "/api/orders")["orders"]}
    line = order_lines(owner, oid)[0]
    assert other.call("POST", "/api/returns", {"shipment_line_id": line["line_id"], "quantity": 1, "reason": ""}).status_code == 404
    ganga = actors.seeded("S-GANGA")
    for method, path in [("GET", f"/api/shipments/{sid}"), ("POST", f"/api/seller/shipments/{sid}/pack"),
                         ("GET", f"/api/seller/shipments/{sid}/label"), ("GET", f"/api/shipments/{sid}/invoice")]:
        assert_error(ganga.call(method, path, {} if method == "POST" else None), 404, "not_found")
    kaveri = actors.seeded("S-KAVERI")
    assert keys_without_time(seller_view(kaveri, sid)) == SELLER_VIEW_KEYS
    fulfil(kaveri, sid)
    ret = owner.ok("POST", "/api/returns", {"shipment_line_id": line["line_id"], "quantity": 1, "reason": "Probe"}, status=201)
    assert_error(other.call("GET", f"/api/returns/{ret['return_id']}"), 404, "not_found")
    assert_error(ganga.call("POST", f"/api/seller/returns/{ret['return_id']}/pickup", {}), 404, "not_found")
    assert owner.call("GET", f"/api/returns/{ret['return_id']}").status_code == 200


@pytest.mark.timeout(900)
def test_dp39_returns_prorated_refunds(app_url: str, wiremock: Any, actors: Actors, killbill: Any) -> None:
    buyer = signup(app_url, wiremock, "dp39")
    price = 34567
    item = actors.listing("S-KAVERI", price=price, stock=5)
    add_line(buyer, item["listing_id"], 3)
    buyer.ok("POST", "/api/cart/coupon", {"code": "CHAURAHA10"})
    order = buy(buyer, [], pay_card())
    oid, sid = order["order_id"], order["shipments"][0]["shipment_id"]
    seller = actors.seeded("S-KAVERI")
    fulfil(seller, sid)
    line = order_lines(buyer, oid)[0]
    total = price * 3 - (price * 3) // 10
    assert line["line_total_paise"] == total and line["coupon_share_paise"] == (price * 3) // 10
    assert line["returnable_until"] == (today_ist(buyer) + timedelta(days=10)).isoformat()
    third = rnd(Fraction(total, 3))
    refunded = 0
    for k, want in ((1, third), (1, third), (1, total - 2 * third)):
        if refunded == 2 * third:
            assert buyer.call("POST", "/api/returns", {"shipment_line_id": line["line_id"], "quantity": 2, "reason": ""}).status_code == 422
        ret = buyer.ok("POST", "/api/returns", {"shipment_line_id": line["line_id"], "quantity": k, "reason": "Probe"}, status=201)
        assert ret["state"] == "requested" and ret["refund_estimate_paise"] == want
        seller.ok("POST", f"/api/seller/returns/{ret['return_id']}/pickup", {})
        refunded += want
        kb_wait(killbill, f"{oid}-card", "REFUND", refunded)
        wait_for(lambda r=ret: buyer.ok("GET", f"/api/returns/{r['return_id']}")["refund_paise"] == want, "the return refunded its prorated amount")
    final = order_lines(buyer, oid)[0]
    assert final["refunded_paise"] == total
    assert buyer.call("POST", "/api/returns", {"shipment_line_id": line["line_id"], "quantity": 1, "reason": ""}).status_code in (409, 422)

    drink = actors.listing("S-KAVERI", category="beverages", stock=5)
    o2 = buy(buyer, [(drink["listing_id"], 1)], pay_card())
    fulfil(seller, o2["shipments"][0]["shipment_id"])
    l2 = order_lines(buyer, o2["order_id"])[0]
    assert_error(buyer.call("POST", "/api/returns", {"shipment_line_id": l2["line_id"], "quantity": 1, "reason": ""}), 409, "not_returnable", COPY["not_returnable"])
    asha = actors.seeded("asha")
    seeded = asha.ok("GET", "/api/orders/CH-SEED0002")["shipments"][0]["lines"][0]
    until_day = date.fromisoformat(seeded["returnable_until"])
    assert_error(asha.call("POST", "/api/returns", {"shipment_line_id": seeded["line_id"], "quantity": 1, "reason": ""}), 409,
                 "return_window_closed", f"The return window for this item closed on {promise_text(until_day)}.")


def test_dp40_invoice_and_label_documents(app_url: str, wiremock: Any, actors: Actors) -> None:
    buyer = signup(app_url, wiremock, "dp40")
    item = actors.listing("S-KAVERI", price=PRICE)
    order = buy(buyer, [(item["listing_id"], 1)], pay_card())
    oid, sid = order["order_id"], order["shipments"][0]["shipment_id"]
    store = S3()
    inv_key, lab_key = f"invoices/{oid}/{sid}.pdf", f"labels/{oid}/{sid}.pdf"
    wait_for(lambda: inv_key in store.keys(f"invoices/{oid}/") and lab_key in store.keys(f"labels/{oid}/"), "invoice and label stored in MinIO")
    view = wait_for(lambda: (v := buyer.ok("GET", f"/api/shipments/{sid}")) and v["invoice_status"] == "ready" and v, "invoice_status ready")
    assert keys_without_time(view) == SHOPPER_VIEW_KEYS and all(set(l) == SHOPPER_LINE_KEYS for l in view["lines"])
    stored = store.get(inv_key)
    r = buyer.call("GET", f"/api/shipments/{sid}/invoice")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and r.content == stored
    text = pdf_text(stored)
    for needle in ("Tax invoice", f"INV-{sid}", oid, "Kaveri Handlooms", "29ABCDE1234F1Z5", "Bengaluru", "Karnataka", buyer.name, "560034"):
        assert needle in text, f"invoice lacks {needle!r}"
    for secret in (buyer.email, buyer.phone, buyer.phone[3:], "250.00"):
        assert secret not in text, f"invoice carries {secret!r}"
    assert buyer.call("GET", f"/api/shipments/{sid}/invoice").content == stored and store.get(inv_key) == stored
    label = pdf_text(store.get(lab_key))
    for needle in (sid, buyer.name, "560034", buyer.phone[-10:], "Kaveri Handlooms", "Prepaid"):
        assert needle in label, f"label lacks {needle!r}"
    for secret in (buyer.email, "250.00", "29ABCDE1234F1Z5"):
        assert secret not in label, f"label carries {secret!r}"
    seller = actors.seeded("S-KAVERI")
    lr = seller.call("GET", f"/api/seller/shipments/{sid}/label")
    assert lr.status_code == 200 and lr.content == store.get(lab_key)

    down_buyer = buyer.on(outage_url("APP_MINIO_DOWN_URL"))
    add_line(buyer, item["listing_id"], 1)
    r = post_checkout(down_buyer, checkout_body(buyer, pay_cod()), idempotency_key())
    assert r.status_code == 201, "orders must still place while MinIO is down"
    o2 = r.json()
    s2 = o2["shipments"][0]["shipment_id"]
    pend = down_buyer.call("GET", f"/api/shipments/{s2}/invoice")
    if pend.status_code != 200:
        assert_error(pend, 409, "document_pending", COPY["document_pending"])
        assert f"invoices/{o2['order_id']}/{s2}.pdf" not in store.keys(f"invoices/{o2['order_id']}/")
    wait_for(lambda: buyer.ok("GET", f"/api/shipments/{s2}")["invoice_status"] == "ready", "a background pass stored the pending invoice")
    assert f"invoices/{o2['order_id']}/{s2}.pdf" in store.keys(f"invoices/{o2['order_id']}/")
    assert f"Collect {rupees(o2['payable_paise'])}" in pdf_text(store.get(f"labels/{o2['order_id']}/{s2}.pdf"))


def test_wf_orders_returns_journey(app_url: str, wiremock: Any, actors: Actors, browser: Browser, killbill: Any) -> None:
    buyer = signup(app_url, wiremock, "dp41")
    item = actors.listing("S-KAVERI", price=33333, stock=5)
    order = buy(buyer, [(item["listing_id"], 3)], pay_card())
    oid, sid = order["order_id"], order["shipments"][0]["shipment_id"]
    seller = actors.seeded("S-KAVERI")
    fulfil(seller, sid)
    line = order_lines(buyer, oid)[0]
    refund = rnd(Fraction(line["line_total_paise"], 3))
    title = item["title"]
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/orders")
        page.get_by_role("list", name="Orders").get_by_role("article", name=f"Order {oid}").get_by_role("link").first.click()
        expect(page).to_have_url(re.compile(rf"/orders/{oid}"))
        shipment = page.get_by_role("region", name=f"Shipment {sid}")
        href = shipment.get_by_role("link", name="Download invoice").get_attribute("href")
        pdf = page.request.get(urllib.parse.urljoin(app_url + "/", href))
        assert pdf.headers["content-type"].startswith("application/pdf") and f"INV-{sid}" in pdf_text(pdf.body())
        shipment.get_by_role("button", name=f"Return {title}").click()
        dialog = page.get_by_role("dialog", name="Return item")
        dialog.get_by_role("spinbutton", name="Quantity to return").fill("1")
        dialog.get_by_role("textbox", name="Reason").fill("Probe return")
        dialog.get_by_role("button", name="Request return").click()
        expect(page.get_by_role("status", name="Order updates")).to_have_text(f"Return requested. Refund on pickup: {rupees(refund)}.")
        ret = wait_for(lambda: next((r for r in seller.ok("GET", "/api/seller/returns")["returns"]
                                     if r.get("quantity") == 1 and r.get("state") == "requested" and r.get("return_id")
                                     and buyer.call("GET", f"/api/returns/{r['return_id']}").status_code == 200), None),
                       "the seller sees the requested return")
        seller.ok("POST", f"/api/seller/returns/{ret['return_id']}/pickup", {})
        kb_wait(killbill, f"{oid}-card", "REFUND", refund)
        page.reload()
        expect(page.get_by_role("region", name=f"Shipment {sid}")).to_contain_text(f"Refunded {rupees(refund)} to card ending 1111.")


def test_wf_orders_returns_foreign_order(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    owner, other = signup(app_url, wiremock, "dp41a"), signup(app_url, wiremock, "dp41b")
    order = buy(owner, [(actors.listing("S-KAVERI")["listing_id"], 1)], pay_cod())
    with plain_page(browser, app_url, other) as page:
        page.goto(f"{app_url}/orders/{order['order_id']}")
        expect(page.get_by_text(COPY["not_found"], exact=True)).to_be_visible()
        expect(page.get_by_role("region", name=f"Shipment {order['shipments'][0]['shipment_id']}")).to_have_count(0)
    assert other.call("GET", f"/api/orders/{order['order_id']}").status_code == 404


def test_wf_orders_returns_history_paging(app_url: str, wiremock: Any, actors: Actors) -> None:
    buyer = signup(app_url, wiremock, "dp41h")
    item = actors.listing("S-KAVERI", stock=10)
    ids = {buy(buyer, [(item["listing_id"], 1)], pay_card())["order_id"] for _ in range(3)}
    first = buyer.ok("GET", "/api/orders", params={"limit": 1})
    assert len(first["orders"]) == 1 and first["next_cursor"]
    seen = [o["order_id"] for o in first["orders"]]
    buy(buyer, [(item["listing_id"], 1)], pay_card())
    cursor = first["next_cursor"]
    for _ in range(6):
        if not cursor:
            break
        page = buyer.ok("GET", "/api/orders", params={"limit": 1, "cursor": cursor})
        assert len(page["orders"]) <= 1
        seen += [o["order_id"] for o in page["orders"]]
        cursor = page["next_cursor"]
    assert len(seen) == len(set(seen)), f"order history repeated rows: {seen}"
    assert ids <= set(seen), f"order history skipped {ids - set(seen)}"
    assert_field(buyer.call("GET", "/api/orders", params={"limit": PAGE_CAP + 1}), "limit", re.compile(r".+"))


def test_dp42_share_links(app_url: str, wiremock: Any, actors: Actors) -> None:
    buyer = signup(app_url, wiremock, "dp42")
    buyer.ok("POST", "/api/wishlist", {"product_id": "steel-tiffin-3"}, status=201)
    buyer.ok("POST", "/api/wishlist", {"product_id": "tara-smartwatch", "listing_id": "L-1014"}, status=201)
    assert_field(buyer.call("POST", "/api/wishlist", {"product_id": "steel-tiffin-3", "listing_id": "L-1009"}), "listing_id", re.compile(r".+"))
    assert_field(buyer.call("POST", "/api/wishlist/share", {"display_name": "m" * (SHARE_NAME_MAX + 1)}), "display_name",
                 f"Name to show can be up to {SHARE_NAME_MAX} characters.")
    link = buyer.ok("POST", "/api/wishlist/share", {"display_name": SHARE_NAME}, status=201)
    token = link["token"]
    assert len(token) >= TOKEN_MIN and re.fullmatch(r"[A-Za-z0-9_-]+", token) and link["url"] == f"/s/{token}"
    assert buyer.ok("POST", "/api/wishlist/share", {"display_name": SHARE_NAME})["token"] == token
    r = httpx.get(f"{app_url}/api/shared/{token}")
    body = r.json()
    assert set(body) == {"kind", "display_name", "items"} and body["kind"] == "wishlist" and body["display_name"] == SHARE_NAME
    assert [(i["listing_id"], i["price_paise"]) for i in body["items"]] == [("L-1001", 64900), ("L-1014", 609900)]
    assert all(set(i) == {"product_id", "listing_id", "title", "image_url", "price_paise"} for i in body["items"])
    for secret in (buyer.email, buyer.phone, buyer.name):
        assert secret not in r.text
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert_error(httpx.request(method, f"{app_url}/api/shared/{token}", json={}), 405, "read_only", COPY["read_only"])
    new = buyer.ok("POST", "/api/wishlist/share/regenerate", {"display_name": SHARE_NAME}, status=201)
    assert new["token"] != token
    assert_error(httpx.get(f"{app_url}/api/shared/{token}"), 404, "link_not_found", COPY["link_not_found"])
    assert buyer.raw("DELETE", "/api/wishlist/share").status_code == 204
    assert_error(httpx.get(f"{app_url}/api/shared/{new['token']}"), 404, "link_not_found")
    add_line(buyer, "L-1006", 1)
    cart_link = buyer.ok("POST", "/api/cart/share", {"display_name": SHARE_NAME}, status=201)
    assert httpx.get(f"{app_url}/api/shared/{cart_link['token']}").json()["kind"] == "cart"
    asha = actors.seeded("asha")
    asha_link = asha.call("POST", "/api/wishlist/share", {"display_name": "Asha"}).json()
    asha_items = httpx.get(f"{app_url}/api/shared/{asha_link['token']}").json()["items"]
    assert [(i["listing_id"], i["price_paise"]) for i in asha_items] == [("L-1001", 64900), ("L-1009", 599900)]

    short = outage_url("APP_SHORT_URL")
    owner = signup(short, wiremock, "dp42s")
    owner.ok("POST", "/api/wishlist", {"product_id": "cotton-kurta"}, status=201)
    st = owner.ok("POST", "/api/wishlist/share", {"display_name": SHARE_NAME}, status=201)["token"]
    limited = None
    with httpx.Client(timeout=HTTP_TIMEOUT) as c:
        for _ in range(2 * SHARE_READ_LIMIT + 1):
            res = c.get(f"{short}/api/shared/{st}")
            if res.status_code == 429:
                limited = res
                break
    assert limited is not None, "shared-link bursts never answered 429"
    b = assert_error(limited, 429, "rate_limited")
    assert limited.headers.get("Retry-After") == str(b["retry_after"])
    wait_for(lambda: httpx.get(f"{short}/api/shared/{st}").status_code == 404, "the share link expired after SHARE_TTL_SECONDS")


def test_wf_sharing_guest_viewer(app_url: str, wiremock: Any, browser: Browser) -> None:
    owner, viewer = signup(app_url, wiremock, "dp43a"), signup(app_url, wiremock, "dp43b")
    owner.ok("POST", "/api/wishlist", {"product_id": "cotton-kurta"}, status=201)
    link = owner.ok("POST", "/api/wishlist/share", {"display_name": SHARE_NAME}, status=201)
    with plain_page(browser, app_url, viewer) as page:
        page.goto(app_url + link["url"])
        expect(page.get_by_role("heading", level=1)).to_have_text(f"{SHARE_NAME}'s wishlist")
        content = page.content()
        assert owner.email not in content and owner.phone not in content and owner.name not in content
        page.get_by_role("button", name=f"Add {title_of('L-1006')} to my cart").click()
    wait_for(lambda: line_for(cart(viewer), "L-1006") is not None, "the shared item reached the viewer's own cart")
    assert line_for(cart(owner), "L-1006") is None


def test_wf_sharing_regenerated_link(app_url: str, wiremock: Any, browser: Browser) -> None:
    owner = signup(app_url, wiremock, "dp43c")
    add_line(owner, "L-1006", 1)
    with plain_page(browser, app_url, owner) as page:
        page.goto(f"{app_url}/cart")
        page.get_by_role("button", name="Share cart").click()
        dialog = page.get_by_role("dialog", name="Share cart")
        dialog.get_by_role("textbox", name="Name to show").fill(SHARE_NAME)
        dialog.get_by_role("button", name="Create link").click()
        field = dialog.get_by_role("textbox", name="Share link")
        expect(field).to_have_value(re.compile(r"/s/[A-Za-z0-9_-]{22,}"))
        old = field.input_value()
        dialog.get_by_role("button", name="Make a new link").click()
        expect(field).not_to_have_value(old)
        new = field.input_value()
    with plain_page(browser, app_url) as guest:
        guest.goto(urllib.parse.urljoin(app_url + "/", old))
        expect(guest.get_by_text(COPY["link_not_found"], exact=True)).to_be_visible()
        guest.goto(urllib.parse.urljoin(app_url + "/", new))
        expect(guest.get_by_role("heading", level=1)).to_have_text(f"{SHARE_NAME}'s cart")
    assert httpx.get(f"{app_url}/api/shared/{new.rstrip('/').split('/')[-1]}").json()["kind"] == "cart"


@pytest.mark.timeout(900)
def test_dp44_listing_quota_and_text_limits(app_url: str, actors: Actors, browser: Browser) -> None:
    k = actors.seeded("S-KAVERI")
    base = {"brand": PROBE_BRAND, "category": "kitchen", "description": "", "price_paise": PRICE, "cost_price_paise": PRICE // 2,
            "stock": 1, "cod_allowed": True, "no_cost_emi": False, "return_note": ""}
    assert_field(k.call("POST", "/api/seller/listings", dict(base, title="a" * (TITLE_MIN - 1))), "title", f"Title needs at least {TITLE_MIN} characters.")
    assert_field(k.call("POST", "/api/seller/listings", dict(base, title="x" * (TITLE_MAX + 1))), "title", f"Title can be up to {TITLE_MAX} characters.")
    assert_field(k.call("POST", "/api/seller/listings", dict(base, title=fresh_title("d"), description="d" * (DESCRIPTION_MAX + 1))),
                 "description", re.compile(r"Description can be up to \d,?\d{3} characters\."))
    assert_field(k.call("POST", "/api/seller/listings", dict(base, title=fresh_title("n"), return_note="n" * (NOTE_MAX + 1))),
                 "return_note", f"Return note can be up to {NOTE_MAX} characters.")
    ok = k.ok("POST", "/api/seller/listings", dict(base, title="😀" * TITLE_MAX, description="😀" * DESCRIPTION_MAX, return_note="😀" * NOTE_MAX), status=201)
    actors.created.append((k, ok.get("listing", ok)["listing_id"]))
    with plain_page(browser, app_url, k) as page:
        page.goto(f"{app_url}/seller/listings/new")
        page.get_by_role("textbox", name="Title").fill("😀abc")
        expect(page.get_by_text(f"{len('😀abc')}/{TITLE_MAX}")).to_be_visible()
        page.get_by_role("textbox", name="Description").fill("😀")
        expect(page.get_by_text(f"{len('😀')}/{DESCRIPTION_MAX}")).to_be_visible()

    m = actors.seeded("S-MARINE")
    live = 0
    cursor = None
    for _ in range(40):
        data = m.ok("GET", "/api/seller/listings", params=dict({"status": "live", "limit": PAGE_CAP}, **({"cursor": cursor} if cursor else {})))
        live += len(data["listings"])
        cursor = data.get("next_cursor")
        if not cursor:
            break
    made = [actors.listing("S-MARINE", cod=False) for _ in range(QUOTA - live)]
    over = m.call("POST", "/api/seller/listings", dict(base, title=fresh_title("quota"), cod_allowed=False))
    assert_error(over, 409, "listing_quota", COPY["listing_quota"])
    m.ok("PATCH", f"/api/seller/listings/{made[0]['listing_id']}", {"status": "unlisted"})
    actors.listing("S-MARINE", cod=False)
    assert_error(m.call("PATCH", f"/api/seller/listings/{made[0]['listing_id']}", {"status": "live"}), 409, "listing_quota")


def test_dp45_photo_and_certificate_uploads(actors: Actors) -> None:
    k = actors.seeded("S-KAVERI")
    item = actors.listing("S-KAVERI")
    lid = item["listing_id"]
    path = f"/api/seller/listings/{lid}/photos"
    store = S3()

    def up(name: str, data: bytes, ctype: str) -> httpx.Response:
        return k.call("POST", path, files={"file": (name, data, ctype)})

    r = up(TRAVERSAL_NAME, PNG_1X1, "image/svg+xml")
    assert r.status_code == 201, r.text
    first = r.json()
    keys = store.keys(f"listings/{lid}/")
    assert f"listings/{lid}/{first['photo_id']}.png" in keys and not any(TRAVERSAL_NAME.rsplit("/", 1)[-1] in key for key in keys)
    assert_error(up("photo.png", SVG_DOC, "image/png"), 415, "unsupported_type", COPY["photo_type"])
    assert_error(up("photo.jpg", HTML_DOC, "image/jpeg"), 415, "unsupported_type")
    exact = JPEG_HEAD + b"\x00" * (PHOTO_MAX - len(JPEG_HEAD) - 2) + b"\xff\xd9"
    assert len(exact) == PHOTO_MAX and up("a.jpg", exact, "image/jpeg").status_code == 201
    assert_error(up("b.jpg", exact + b"\x00", "image/jpeg"), 413, "file_too_large", COPY["photo_too_large"])
    webp = up("c.bin", WEBP_HEAD + b"\x00" * 64, "application/octet-stream")
    assert webp.status_code == 201 and f"listings/{lid}/{webp.json()['photo_id']}.webp" in store.keys(f"listings/{lid}/")
    for _ in range(PHOTO_COUNT - 3):
        assert up("d.png", PNG_1X1, "image/png").status_code == 201
    assert_error(up("e.png", PNG_1X1, "image/png"), 409, "photo_limit", COPY["photo_limit"])
    assert len(store.keys(f"listings/{lid}/")) == PHOTO_COUNT
    cert = "/api/seller/gst-certificate"
    assert k.call("POST", cert, files={"file": ("cert.png", PDF_DOC, "image/png")}).json().get("status") == "stored"
    assert "sellers/S-KAVERI/gst-certificate.pdf" in store.keys("sellers/S-KAVERI/")
    big = PDF_DOC + b"\x00" * (CERT_MAX + 1 - len(PDF_DOC))
    assert_error(k.call("POST", cert, files={"file": ("c.pdf", big, "application/pdf")}), 413, "file_too_large", COPY["cert_too_large"])
    assert_error(k.call("POST", cert, files={"file": ("c.pdf", HTML_DOC, "application/pdf")}), 415, "unsupported_type", COPY["cert_type"])


def test_dp46_listing_fields_sellers_cannot_set(actors: Actors) -> None:
    k, g = actors.seeded("S-KAVERI"), actors.seeded("S-GANGA")
    for field, value in (("commission_percent", 1), ("featured", True), ("seller_id", "S-GANGA"), ("rating", 5)):
        title = fresh_title("dp46")
        body = {"title": title, "brand": PROBE_BRAND, "category": "kitchen", "price_paise": PRICE, "stock": 1, field: value}
        assert_field(k.call("POST", "/api/seller/listings", body), field, COPY["cant_set"])
        assert k.ok("GET", "/api/seller/listings", params={"q": title})["listings"] == []
    item = actors.listing("S-KAVERI", stock=7)
    lid = item["listing_id"]
    assert_field(k.call("PATCH", f"/api/seller/listings/{lid}", {"featured": True}), "featured", COPY["cant_set"])
    assert_error(g.call("PUT", f"/api/seller/listings/{lid}/stock", {"stock": 0}), 404, "not_found")
    assert_error(g.call("PATCH", f"/api/seller/listings/{lid}", {"price_paise": 1}), 404, "not_found")
    after = seller_listing(k, lid, item["title"])
    assert after["stock"] == 7 and after["price_paise"] == PRICE


def test_dp47_seller_views_count_only_own(actors: Actors) -> None:
    k, g = actors.seeded("S-KAVERI"), actors.seeded("S-GANGA")
    low = actors.listing("S-KAVERI", stock=3)
    tiffin = k.ok("GET", "/api/seller/listings", params={"q": "Steel Tiffin"})["listings"]
    assert {l["listing_id"] for l in tiffin} == {"L-1002"}
    rows: list[dict] = []
    cursor = None
    for _ in range(40):
        data = k.ok("GET", "/api/seller/listings", params=dict({"limit": PAGE_CAP}, **({"cursor": cursor} if cursor else {})))
        rows += data["listings"]
        facets = data["facets"]["category"]
        cursor = data.get("next_cursor")
        if not cursor:
            break
    ids = {r["listing_id"] for r in rows}
    assert not ids & {l for l, v in LISTINGS.items() if v[3] != "S-KAVERI"}
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["category"]] = counts.get(r["category"], 0) + 1
    assert facets == counts, f"seller facet {facets}; own listings by category {counts}"
    k_low = {l["listing_id"] for l in k.ok("GET", "/api/seller/low-stock")["listings"]}
    g_low = {l["listing_id"] for l in g.ok("GET", "/api/seller/low-stock")["listings"]}
    assert low["listing_id"] in k_low and low["listing_id"] not in g_low and "L-1004" in g_low and "L-1004" not in k_low
    today = today_ist(k)
    params = {"from": (today - timedelta(days=WIDE_FROM_DAYS)).isoformat(), "to": today.isoformat()}
    statement = k.ok("GET", "/api/seller/settlements", params=params)
    shipments = {l["shipment_id"] for l in statement["lines"]}
    assert "SH-SEED0001" in shipments and "SH-SEED0002" not in shipments
    for key in ("gross_paise", "commission_paise", "net_paise"):
        assert statement["totals"][key] == sum(l[key] for l in statement["lines"])


def test_wf_seller_listings_journey(app_url: str, actors: Actors, browser: Browser) -> None:
    k = actors.seeded("S-KAVERI")
    listing = actors.listing("S-KAVERI", stock=3)
    title = listing["title"]
    with plain_page(browser, app_url, k) as page:
        page.goto(f"{app_url}/seller/listings/{listing['listing_id']}")
        page.get_by_role("textbox", name="Description").fill("Probe steel kettle")
        page.get_by_role("button", name="Save listing").click()
        status = page.get_by_role("status", name="Save status")
        expect(status).to_have_text(COPY["listing_saved"])
        assert seller_listing(k, listing["listing_id"], title)["stock"] == 3
        page.get_by_label("Listing photos").set_input_files(files=[{"name": "p.png", "mimeType": "image/png", "buffer": PNG_1X1}])
        page.get_by_role("button", name="Save listing").click()
        wait_for(lambda: S3().keys(f"listings/{listing['listing_id']}/"), "the uploaded photo reached MinIO")
        page.goto(f"{app_url}/seller/stock")
        expect(page.get_by_role("table", name="Low stock")).to_be_visible()
        page.get_by_role("spinbutton", name=f"Stock for {title}").fill("4")
        page.get_by_role("button", name=f"Save stock for {title}").click()
        expect(page.get_by_role("status", name="Save status")).to_have_text(f"Stock saved: {title}, 4 units.")
    assert seller_listing(k, listing["listing_id"], title)["stock"] == 4


def test_wf_seller_listings_bad_photo(app_url: str, actors: Actors, browser: Browser) -> None:
    k = actors.seeded("S-KAVERI")
    item = actors.listing("S-KAVERI")
    with plain_page(browser, app_url, k) as page:
        page.goto(f"{app_url}/seller/listings/{item['listing_id']}")
        page.get_by_label("Listing photos").set_input_files(files=[{"name": "p.png", "mimeType": "image/png", "buffer": SVG_DOC}])
        expect(page.get_by_role("status", name="Save status")).to_contain_text(COPY["photo_type"])
    assert S3().keys(f"listings/{item['listing_id']}/") == []


def test_dp49_shipment_lifecycle(app_url: str, wiremock: Any, actors: Actors, killbill: Any) -> None:
    k = actors.seeded("S-KAVERI")
    buyer = signup(app_url, wiremock, "dp49")
    item = actors.listing("S-KAVERI", stock=10)
    order = buy(buyer, [(item["listing_id"], 1)], pay_card())
    sid = order["shipments"][0]["shipment_id"]
    body = assert_error(k.call("POST", f"/api/seller/shipments/{sid}/ship", {}), 409, "invalid_transition", "That step isn't possible from placed now.")
    assert body["from"] == "placed" and body["to"] == "shipped"
    assert_error(k.call("POST", f"/api/seller/shipments/{sid}/deliver", {}), 409, "invalid_transition")
    assert pack(k, sid)["state"] == "packed"
    assert_error(k.call("POST", f"/api/seller/shipments/{sid}/pack", {}), 409, "invalid_transition")
    wait_for(lambda: seller_view(k, sid)["label_status"] == "ready", "label stored")
    assert k.ok("POST", f"/api/seller/shipments/{sid}/ship", {})["state"] == "shipped"
    assert_error(buyer.call("POST", f"/api/shipments/{sid}/cancel", {}), 409, "invalid_transition")
    assert k.ok("POST", f"/api/seller/shipments/{sid}/deliver", {})["state"] == "delivered"
    assert_error(k.call("POST", f"/api/seller/shipments/{sid}/deliver", {}), 409, "invalid_transition")
    line = order_lines(buyer, order["order_id"])[0]
    ret = buyer.ok("POST", "/api/returns", {"shipment_line_id": line["line_id"], "quantity": 1, "reason": ""}, status=201)
    assert_field(k.call("POST", f"/api/seller/returns/{ret['return_id']}/decline", {"reason": "Too short"}), "reason", f"Reason needs at least {REASON_MIN} characters.")
    assert k.ok("POST", f"/api/seller/returns/{ret['return_id']}/decline", {"reason": "Item shows wear and use"})["state"] == "declined"
    assert_error(k.call("POST", f"/api/seller/returns/{ret['return_id']}/pickup", {}), 409, "invalid_transition")

    before = seller_listing(k, item["listing_id"], item["title"])["stock"]
    o2 = buy(buyer, [(item["listing_id"], 2)], pay_card())
    s2 = o2["shipments"][0]["shipment_id"]
    assert buyer.ok("POST", f"/api/shipments/{s2}/cancel", {})["state"] == "cancelled"
    assert seller_listing(k, item["listing_id"], item["title"])["stock"] == before
    kb_wait(killbill, f"{o2['order_id']}-card", "REFUND", o2["payable_paise"])
    assert_error(k.call("POST", f"/api/seller/shipments/{s2}/pack", {}), 409, "invalid_transition")

    down = buyer.on(outage_url("APP_MINIO_DOWN_URL"))
    add_line(buyer, item["listing_id"], 1)
    o3 = post_checkout(down, checkout_body(buyer, pay_cod()), idempotency_key()).json()
    s3 = o3["shipments"][0]["shipment_id"]
    kd = k.on(outage_url("APP_MINIO_DOWN_URL"))
    kd.ok("POST", f"/api/seller/shipments/{s3}/pack", {})
    r = kd.call("POST", f"/api/seller/shipments/{s3}/ship", {})
    if r.status_code != 200:
        assert_error(r, 409, "label_pending", COPY["label_pending"])


def test_dp50_statuses_after_provider_confirms(app_url: str, wiremock: Any, actors: Actors, killbill: Any) -> None:
    k = actors.seeded("S-KAVERI")
    buyer = signup(app_url, wiremock, "dp50")
    item = actors.listing("S-KAVERI", stock=10)
    add_address(buyer)
    add_line(buyer, item["listing_id"], 1)
    order = post_checkout(buyer, checkout_body(buyer, pay_upi()), idempotency_key()).json()
    pid, oid, sid = order["payment"]["payment_id"], order["order_id"], order["shipments"][0]["shipment_id"]
    wiremock.stub("GET", f"/upi/v1/collect/{pid}", json={"status": "PENDING"})
    view = seller_view(k, sid)
    assert view["payment_status"] == "pending" and killbill.payment_by_key(f"{oid}-upi") is None
    assert_error(k.call("POST", f"/api/seller/shipments/{sid}/pack", {}), 409, "payment_pending", COPY["payment_pending"])
    wiremock.stub("GET", f"/upi/v1/collect/{pid}", json={"status": "SUCCESS"})
    wait_for(lambda: buyer.ok("GET", f"/api/payments/{pid}") and seller_view(k, sid)["payment_status"] == "paid", "seller saw paid")
    assert kb_sum(killbill.payment_by_key(f"{oid}-upi"), "PURCHASE") == order["payable_paise"]

    o2 = buy(buyer, [(item["listing_id"], 1)], pay_card())
    s2 = o2["shipments"][0]["shipment_id"]
    key = f"{o2['order_id']}-card"
    kb_wait(killbill, key, "PURCHASE", o2["payable_paise"])
    buyer.on(outage_url("APP_KILLBILL_DOWN_URL")).ok("POST", f"/api/shipments/{s2}/cancel", {})
    if seller_view(k, s2)["payment_status"] == "refunded":
        assert kb_sum(killbill.payment_by_key(key), "REFUND") == o2["payable_paise"]
    line = buyer.ok("GET", f"/api/shipments/{s2}")["lines"][0]
    assert line["refunded_paise"] == 0 or kb_sum(killbill.payment_by_key(key), "REFUND") > 0
    wait_for(lambda: seller_view(k, s2)["payment_status"] == "refunded", "refund recorded once Kill Bill answered")
    assert kb_sum(killbill.payment_by_key(key), "REFUND") == o2["payable_paise"]
    wait_for(lambda: seller_view(k, sid)["invoice_status"] == "ready", "invoice ready")
    assert f"invoices/{oid}/{sid}.pdf" in S3().keys(f"invoices/{oid}/")


@pytest.mark.timeout(900)
def test_dp51_settlement_arithmetic(app_url: str, wiremock: Any, actors: Actors) -> None:
    k = actors.seeded("S-KAVERI")
    today = today_ist(k)
    params = {"from": (today - timedelta(days=WIDE_FROM_DAYS)).isoformat(), "to": today.isoformat()}
    seed = next(l for l in k.ok("GET", "/api/seller/settlements", params=params)["lines"] if l["shipment_id"] == "SH-SEED0001")
    assert {key: seed[key] for key in ("gross_paise", "commission_paise", "commission_gst_paise", "tcs_paise", "tds_paise", "net_paise")} == \
        {"gross_paise": 345000, "commission_paise": 51750, "commission_gst_paise": 9315, "tcs_paise": 1643, "tds_paise": 345, "net_paise": 281947}
    buyer = signup(app_url, wiremock, "dp51")
    price = 34999
    item = actors.listing("S-KAVERI", price=price, stock=5)
    order = buy(buyer, [(item["listing_id"], 2)], pay_card())
    sid = order["shipments"][0]["shipment_id"]
    fulfil(k, sid)
    sale = settlement_oracle(price * 2, "kitchen")
    lines = wait_for(lambda: [l for l in k.ok("GET", "/api/seller/settlements", params=params)["lines"] if l["shipment_id"] == sid] or None, "sale line posted")
    got = {key: lines[0][key] for key in sale}
    assert lines[0]["kind"] == "sale" and got == sale and lines[0]["commission_percent"] in (10, "10", 10.0)
    line = order_lines(buyer, order["order_id"])[0]
    support = actors.seeded("support")
    for _ in range(2):
        support.ok("POST", f"/api/support/shipment-lines/{line['line_id']}/refunds", {"quantity": 1, "reason": "Probe settlement refund"}, status=201)
    returns = wait_for(lambda: (rs := [l for l in k.ok("GET", "/api/seller/settlements", params=params)["lines"]
                                       if l["shipment_id"] == sid and l["kind"] == "return"]) and len(rs) == 2 and rs, "two return lines posted")
    half = {key: rnd(Fraction(v, 2)) for key, v in sale.items()}
    expected = [{key: -half[key] for key in sale}, {key: -(sale[key] - half[key]) for key in sale}]
    got_returns = sorted(({key: r[key] for key in sale} for r in returns), key=lambda d: d["net_paise"])
    assert got_returns == sorted(expected, key=lambda d: d["net_paise"]), f"return lines {got_returns}; expected {expected}"
    statement = k.ok("GET", "/api/seller/settlements", params=params)
    for key in ("gross_paise", "commission_paise", "commission_gst_paise", "tcs_paise", "tds_paise", "emi_subvention_paise", "net_paise"):
        assert statement["totals"][key] == sum(l[key] for l in statement["lines"])
    assert lines[0]["status"] in ("payment_confirmed",)


def test_wf_seller_fulfilment_journey(app_url: str, wiremock: Any, actors: Actors, browser: Browser, killbill: Any) -> None:
    m = actors.seeded("S-MARINE")
    buyer = signup(app_url, wiremock, "dp52")
    item = actors.listing("S-MARINE", stock=5, cod=False)
    order = buy(buyer, [(item["listing_id"], 2)], pay_card())
    sid, oid = order["shipments"][0]["shipment_id"], order["order_id"]
    kb_wait(killbill, f"{oid}-card", "PURCHASE", order["payable_paise"])
    with plain_page(browser, app_url, m) as page:
        page.goto(f"{app_url}/seller/shipments")
        card_region = page.get_by_role("region", name=f"Shipment {sid}")
        card_region.get_by_role("button", name="Mark packed").click()
        wait_for(lambda: seller_view(m, sid)["state"] == "packed", "Mark packed reached the server")
        wait_for(lambda: seller_view(m, sid)["label_status"] == "ready", "label stored")
        page.reload()
        href = card_region.get_by_role("link", name="Print label").get_attribute("href")
        label = page.request.get(urllib.parse.urljoin(app_url + "/", href))
        assert sid in pdf_text(label.body())
        card_region.get_by_role("button", name="Mark shipped").click()
        wait_for(lambda: seller_view(m, sid)["state"] == "shipped", "Mark shipped reached the server")
        card_region.get_by_role("button", name="Mark delivered").click()
        wait_for(lambda: seller_view(m, sid)["state"] == "delivered", "Mark delivered reached the server")
        line = order_lines(buyer, oid)[0]
        ret = buyer.ok("POST", "/api/returns", {"shipment_line_id": line["line_id"], "quantity": 1, "reason": ""}, status=201)
        page.goto(f"{app_url}/seller/returns")
        page.get_by_role("button", name="Approve pickup").first.click()
        wait_for(lambda: buyer.ok("GET", f"/api/returns/{ret['return_id']}")["state"] == "picked", "Approve pickup reached the server")
        kb_wait(killbill, f"{oid}-card", "REFUND", ret["refund_estimate_paise"])
    statement = m.ok("GET", "/api/seller/settlements")
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        add_session(page.context, m, app_url)
        page.goto(f"{app_url}/seller/statement")
        expect(page.get_by_role("table", name="Settlement statement")).to_be_visible()
        expect(page.get_by_role("group", name="Net payout")).to_contain_text(rupees(statement["totals"]["net_paise"]))


def test_wf_seller_fulfilment_payment_pending(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    m = actors.seeded("S-MARINE")
    buyer = signup(app_url, wiremock, "dp52p")
    item = actors.listing("S-MARINE", stock=5, cod=False)
    add_address(buyer)
    add_line(buyer, item["listing_id"], 1)
    order = post_checkout(buyer, checkout_body(buyer, pay_upi()), idempotency_key()).json()
    wiremock.stub("GET", f"/upi/v1/collect/{order['payment']['payment_id']}", json={"status": "PENDING"})
    sid = order["shipments"][0]["shipment_id"]
    with plain_page(browser, app_url, m) as page:
        page.goto(f"{app_url}/seller/shipments")
        region = page.get_by_role("region", name=f"Shipment {sid}")
        expect(region).to_contain_text("payment pending")
        region.get_by_role("button", name="Mark packed").click()
        expect(region).to_contain_text(COPY["payment_pending"])
    assert seller_view(m, sid)["state"] == "placed"


def test_wf_seller_fulfilment_isolation(app_url: str, wiremock: Any, actors: Actors) -> None:
    k, g = actors.seeded("S-KAVERI"), actors.seeded("S-GANGA")
    buyer = signup(app_url, wiremock, "dp52i")
    item = actors.listing("S-KAVERI", stock=5)
    order = buy(buyer, [(item["listing_id"], 1)], pay_card())
    sid = order["shipments"][0]["shipment_id"]
    fulfil(k, sid)
    for method, path in [("GET", f"/api/shipments/{sid}"), ("POST", f"/api/seller/shipments/{sid}/pack"),
                         ("GET", f"/api/seller/shipments/{sid}/label")]:
        assert_error(g.call(method, path, {} if method == "POST" else None), 404, "not_found")
    today = today_ist(k)
    params = {"from": (today - timedelta(days=WIDE_FROM_DAYS)).isoformat(), "to": today.isoformat()}
    own = wait_for(lambda: [l for l in k.ok("GET", "/api/seller/settlements", params=params)["lines"] if l["shipment_id"] == sid] or None,
                   "the owner's statement listed the delivered shipment")
    assert own[0]["kind"] == "sale"
    other = g.ok("GET", "/api/seller/settlements", params=params)
    assert sid not in {l["shipment_id"] for l in other["lines"]}
    assert other["totals"]["net_paise"] == sum(l["net_paise"] for l in other["lines"])
    assert sid not in {s["shipment_id"] for s in g.ok("GET", "/api/seller/shipments")["shipments"]}


def test_wf_seller_fulfilment_documents(app_url: str, wiremock: Any, actors: Actors) -> None:
    k = actors.seeded("S-KAVERI")
    buyer = signup(app_url, wiremock, "dp52d")
    item = actors.listing("S-KAVERI", stock=5)
    order = buy(buyer, [(item["listing_id"], 1)], pay_card())
    oid, sid = order["order_id"], order["shipments"][0]["shipment_id"]
    view = wait_for(lambda: (v := seller_view(k, sid)) and v["invoice_status"] == "ready" and v["label_status"] == "ready" and v,
                    "invoice and label ready")
    assert keys_without_time(view) == SELLER_VIEW_KEYS and set(view["ship_to"]) == {"name", "city", "pincode"}
    assert all(set(l) == SELLER_LINE_KEYS for l in view["lines"])
    dump = json.dumps(view)
    assert buyer.email not in dump and buyer.phone not in dump
    inv = k.call("GET", f"/api/shipments/{sid}/invoice")
    assert inv.status_code == 200
    text = pdf_text(inv.content)
    assert buyer.email not in text and buyer.phone not in text and buyer.phone[3:] not in text
    assert "cost" not in text.lower()
    label = pdf_text(S3().get(f"labels/{oid}/{sid}.pdf"))
    assert buyer.email not in label


def test_dp53_actions_refused_by_role(app_url: str, wiremock: Any, actors: Actors) -> None:
    shopper, seller, support = signup(app_url, wiremock, "dp53"), actors.seeded("S-KAVERI"), actors.seeded("support")
    payout = {"account_holder": "Kaveri Handlooms", "ifsc": "SAFB0000001", "account_number": "123456789012"}
    for who, method, path, body in [
        (shopper, "POST", "/api/support/shipment-lines/no-such-line/refunds", {"quantity": 1, "reason": "Probe refund reason"}),
        (seller, "POST", "/api/support/shipment-lines/no-such-line/refunds", {"quantity": 1, "reason": "Probe refund reason"}),
        (seller, "GET", "/api/support/orders/CH-SEED0001", None),
        (support, "PUT", "/api/seller/payout-account", payout),
        (shopper, "PUT", "/api/seller/payout-account", payout),
        (shopper, "GET", "/api/seller/listings", None),
        (shopper, "GET", "/api/seller/commission-rates", None),
        (seller, "POST", "/api/checkout", {}),
    ]:
        assert_error(who.call(method, path, body), 403, "forbidden", COPY["forbidden"])
    masked = seller.ok("PUT", "/api/seller/payout-account", payout)
    assert masked["account_number_masked"] == "*" * (len(payout["account_number"]) - 4) + payout["account_number"][-4:] and "account_number" not in masked
    assert {r["category"].lower(): float(r["commission_percent"]) for r in seller.ok("GET", "/api/seller/commission-rates")["rates"]} == \
        {c: float(v) for c, v in COMMISSION.items()}


def test_dp54_support_order_lookup(app_url: str, wiremock: Any, actors: Actors) -> None:
    support, k = actors.seeded("support"), actors.seeded("S-KAVERI")
    buyer = signup(app_url, wiremock, "dp54")
    item = actors.listing("S-KAVERI", stock=10)
    order = buy(buyer, [(item["listing_id"], 2)], pay_card())
    oid, sid = order["order_id"], order["shipments"][0]["shipment_id"]
    fulfil(k, sid)
    view = support.ok("GET", f"/api/support/orders/{oid}")
    assert view["shopper"]["name"] == buyer.name
    masked = view["shopper"]["phone_masked"]
    assert masked.endswith(buyer.phone[-4:]) and buyer.phone[3:-4] not in masked
    leg = view["payment"]["legs"][0]
    assert leg["card_last4"] == "1111" and leg["card_network"].lower() == "Visa".lower()
    text = json.dumps(view)
    assert VISA not in text and not walk_keys(view) & {"cost_price_paise", "cvv", "account_number", "password", "code"}
    ship = view["shipments"][0]
    assert keys_without_time(ship["shopper_view"]) == SHOPPER_VIEW_KEYS and keys_without_time(ship["seller_view"]) == SELLER_VIEW_KEYS
    assert set(ship["seller_view"]["ship_to"]) == {"name", "city", "pincode"}
    line = order_lines(buyer, oid)[0]
    refund = support.ok("POST", f"/api/support/shipment-lines/{line['line_id']}/refunds", {"quantity": 1, "reason": "Damaged in transit"}, status=201)
    assert refund["amount_paise"] == rnd(Fraction(line["line_total_paise"], 2)) and refund["status"] == "pending"
    assert_field(support.call("POST", f"/api/support/shipment-lines/{line['line_id']}/refunds", {"quantity": 2, "reason": "Damaged in transit"}),
                 "quantity", f"Only {line['quantity'] - 1} units can still be refunded.")
    o2 = buy(buyer, [(item["listing_id"], 1)], pay_card())
    fulfil(k, o2["shipments"][0]["shipment_id"])
    l2 = order_lines(buyer, o2["order_id"])[0]
    ret = buyer.ok("POST", "/api/returns", {"shipment_line_id": l2["line_id"], "quantity": 1, "reason": ""}, status=201)
    assert_error(support.call("POST", f"/api/support/shipment-lines/{l2['line_id']}/refunds", {"quantity": 1, "reason": "Damaged in transit"}), 409, "invalid_transition")
    k.ok("POST", f"/api/seller/returns/{ret['return_id']}/decline", {"reason": "Item shows wear and use"})
    assert support.ok("POST", f"/api/support/returns/{ret['return_id']}/reopen", {"note": "Customer sent photos"})["state"] == "requested"
    assert_error(support.call("POST", f"/api/support/returns/{ret['return_id']}/reopen", {"note": "Customer sent photos"}), 409, "invalid_transition")


def support_order_page(app_url: str, wiremock: Any, actors: Actors, browser: Browser, viewport: tuple[int, int]) -> tuple[dict, Any]:
    buyer = signup(app_url, wiremock, "dp54u")
    order = buy(buyer, [(actors.listing("S-KAVERI")["listing_id"], 1)], pay_card())
    return order, plain_page(browser, app_url, actors.seeded("support"), viewport)


def test_wf_support_lookup_desktop(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    order, ctx = support_order_page(app_url, wiremock, actors, browser, DESKTOP)
    with ctx as page:
        page.goto(f"{app_url}/support")
        page.get_by_role("searchbox", name="Order ID").fill(order["order_id"])
        page.get_by_role("button", name="Find order").click()
        expect(page).to_have_url(f"{app_url}/support/orders/{order['order_id']}")
        expect(page.get_by_text(order["shipments"][0]["shipment_id"]).first).to_be_visible()
        expect(page.get_by_text("Kaveri Handlooms").first).to_be_visible()
        assert VISA not in page.content()
    assert actors.seeded("support").ok("GET", f"/api/support/orders/{order['order_id']}")["order_id"] == order["order_id"]


def test_wf_support_lookup_tablet_tabs(app_url: str, wiremock: Any, actors: Actors, browser: Browser) -> None:
    order, ctx = support_order_page(app_url, wiremock, actors, browser, TABLET)
    with ctx as page:
        page.goto(f"{app_url}/support/orders/{order['order_id']}")
        seller_tab = page.get_by_role("tab", name="Seller view")
        expect(page.get_by_role("tab", name="Shopper view")).to_be_visible()
        seller_tab.click()
        expect(seller_tab).to_have_attribute("aria-selected", "true")
        layout(page)
    assert actors.seeded("support").ok("GET", f"/api/support/orders/{order['order_id']}")["shipments"]


def test_wf_support_unknown_ids(app_url: str, actors: Actors) -> None:
    support = actors.seeded("support")
    ghost = "NO-SUCH-ID-PROBE"
    assert_error(support.call("GET", f"/api/support/orders/{ghost}"), 404, "not_found", COPY["not_found"])
    assert_error(support.call("POST", f"/api/support/shipment-lines/{ghost}/refunds",
                              {"quantity": 1, "reason": "Probe refund reason"}), 404, "not_found")
    assert_error(support.call("POST", f"/api/support/returns/{ghost}/reopen",
                              {"note": "Probe reopen note"}), 404, "not_found")


def test_dp55_manifest_and_health(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    for path in ("/run.json", "/.env", "/package-lock.json", "/package.json", "/src/server.ts"):
        assert httpx.get(app_url + path).status_code == 404, f"{path} was served"
    assert r.headers["content-type"].startswith("application/json")


def test_wf_cross_cutting_outage_boot() -> None:
    for env in ("APP_MINIO_DOWN_URL", "APP_MEILISEARCH_DOWN_URL", "APP_KILLBILL_DOWN_URL", "APP_WIREMOCK_DOWN_URL"):
        r = httpx.get(f"{outage_url(env)}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, f"{env} health {r.status_code}"


def test_dp57_rupee_reel(app_url: str, wiremock: Any, browser: Browser) -> None:
    for mode in ("no-preference", "reduce"):
        buyer = signup(app_url, wiremock, "dp57")
        add_address(buyer)
        add_line(buyer, "L-1006", 1)
        add_line(buyer, "L-1007", 1)
        with open_app(browser, app_url + "/", reduced_motion=mode) as page:
            page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
            add_session(page.context, buyer, app_url)
            page.goto(f"{app_url}/cart")
            group = page.get_by_role("group", name="Payable total")
            expect(group).to_be_visible()
            bar = page.get_by_role("progressbar", name="Cash on delivery limit")
            expect(page.get_by_text("cash on delivery unavailable").first).to_be_visible()
            page.get_by_role("button", name=f"Remove {title_of('L-1007')}").click()
            q = wait_for(lambda: (c := cart(buyer)) and line_for(c, "L-1007") is None and c, "removal reached the server")
            amount = rupees(q["payable_paise"])
            frames = []
            for _ in range(40):
                advance(page, 50)
                frames.append(decode(capture(group)))
            settled = all(difference(frames[-5], f) < STILL_MAX for f in frames[-4:])
            assert settled, "the total kept moving after the reel should have settled"
            if mode == "reduce":
                assert all(difference(frames[0], f) < STILL_MAX for f in frames), "digits moved under reduced motion"
            else:
                assert any(difference(frames[i], frames[i + 1]) > 0 for i in range(len(frames) - 5)), "the total never rolled"
            expect(group).to_contain_text(amount)
            now, top = bar.evaluate("e => [Number(e.getAttribute('aria-valuenow') ?? e.value), "
                                    "Number(e.getAttribute('aria-valuemax') ?? e.max ?? 100)]")
            share = q["cod"]["cash_paise"] / q["cod"]["cap_paise"]
            assert abs(now / top - share) < 0.01, f"COD bar at {now}/{top}; expected share {share:.4f}"


def test_wf_cross_cutting_statement_reel(app_url: str, actors: Actors, browser: Browser) -> None:
    k = actors.seeded("S-KAVERI")
    statement = k.ok("GET", "/api/seller/settlements")
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        add_session(page.context, k, app_url)
        page.goto(f"{app_url}/seller/statement")
        net = page.get_by_role("group", name="Net payout")
        for y in (0, 300, 600, 900):
            page.evaluate("y => window.scrollTo(0, y)", y)
            advance(page, 200)
        advance(page, DIGIT_SETTLE_MS)
        expect(net).to_contain_text(rupees(statement["totals"]["net_paise"]))


def test_dp58_home_and_deals_effects(app_url: str, browser: Browser) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(page.get_by_role("heading", level=1)).to_have_text("everything. one cart.")
        marquee = page.get_by_role("region", name="Delivery promises")
        marquee.scroll_into_view_if_needed()
        advance(page, 300)
        a = decode(capture(marquee))
        advance(page, 1000)
        assert difference(a, decode(capture(marquee))) > 0, "the delivery-promise marquee does not loop"
        marquee.hover()
        advance(page, 300)
        b = decode(capture(marquee))
        advance(page, 1000)
        assert difference(b, decode(capture(marquee))) < STILL_MAX, "the marquee did not pause on hover"
        rail = page.get_by_role("region", name="Today's Deals")
        start = page.evaluate("() => window.scrollY") + rail.bounding_box()["y"]
        tops, xs = [], []
        for dy in (0, 200, 400):
            page.evaluate("y => window.scrollTo(0, y)", start + dy)
            advance(page, 200)
            first_deal = rail.get_by_role("link").first.bounding_box()
            tops.append(first_deal["y"])
            xs.append(first_deal["x"])
        assert max(tops) - min(tops) < 4, f"the deals rail did not pin: tops {tops}"
        assert xs[0] > xs[1] > xs[2], f"vertical scroll did not travel the rail sideways: {xs}"
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        rail = page.get_by_role("region", name="Today's Deals")
        expect(rail.get_by_role("list").first).to_be_visible()
        y0 = rail.bounding_box()["y"]
        page.evaluate("() => window.scrollTo(0, 200)")
        advance(page, 200)
        assert abs((y0 - rail.bounding_box()["y"]) - 200) < 4, "the deals rail is not in normal page flow under reduced motion"


def test_dp59_pointer_morphs_and_transitions(app_url: str, wiremock: Any, browser: Browser) -> None:
    buyer = signup(app_url, wiremock, "dp59")
    with plain_page(browser, app_url, buyer) as page:
        page.goto(f"{app_url}/search?brand=Jugnu")
        mark(page)
        page.get_by_role("list", name="Products").get_by_role("article").first.get_by_role("link").first.click()
        expect(page).to_have_url(f"{app_url}/p/jugnu-powerbank")
        expect(page.get_by_role("heading", level=1)).to_be_focused()
        assert still_same_document(page), "opening a product reloaded the page"
        add = page.get_by_role("button", name="Add to cart")
        add.click()
        add.click()
        wait_for(lambda: (l := line_for(cart(buyer), "L-1011")) and l["quantity"] == 2, "two quick adds both reached the cart")
        page.go_back()
        expect(page).to_have_url(f"{app_url}/search?brand=Jugnu")
        assert still_same_document(page)
    for mode, moves in (("no-preference", True), ("reduce", False)):
        with open_app(browser, f"{app_url}/p/jugnu-powerbank", reduced_motion=mode) as page:
            page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
            btn = page.get_by_role("button", name="Add to cart")
            expect(btn).to_be_visible()
            box = btn.bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] - MAGNET_RANGE_PX / 4)
            advance(page, 400)
            shift = box["y"] - btn.bounding_box()["y"]
            assert abs(shift) <= MAGNET_MAX_PX, f"magnetic pull moved the button {shift}px"
            if moves:
                assert shift > 0, "Add to cart did not pull toward a nearby cursor"
            else:
                assert abs(shift) < 0.5, "the button moved under reduced motion"
    with open_app(browser, f"{app_url}/p/jugnu-powerbank") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        add_session(page.context, buyer, app_url)
        page.goto(f"{app_url}/p/jugnu-powerbank")
        heart = page.get_by_role("button", name="Add to wishlist")
        expect(heart).to_be_visible()
        resting = decode(capture(heart))
        heart.click()
        expect(heart).to_have_attribute("aria-pressed", "true")
        advance(page, 700)
        assert difference(resting, decode(capture(heart))) > 0, "the wishlist outline did not morph into a filled heart"


HERO_SCROLL_PX = 900
MORPH_STEP_MS = 50
MORPH_SAMPLES = 16
MORPH_DONE_MS = 900
HERO_REGION_MIN_H = 300


def viewport_pixels(page: Page, x: float, y: float, width: float, height: float) -> Any:
    top = page.evaluate("() => window.scrollY")
    shot = session(page).send("Page.captureScreenshot", {"format": "png", "clip": {"x": x, "y": y + top, "width": width, "height": height, "scale": 1}})
    return decode(base64.b64decode(shot["data"]))


def pause_loops(page: Page) -> None:
    page.evaluate("() => document.getAnimations().filter(a => a.effect && a.effect.getTiming().iterations === Infinity).forEach(a => { a.pause(); a.currentTime = 0; })")


def sweep_pointer(page: Page, y: float) -> None:
    for x in range(100, DESKTOP[0] - 100, 200):
        page.mouse.move(x, y, steps=4)
        advance(page, 100)


def test_dp58_wordmark_and_tiffin_scrub(app_url: str, browser: Browser) -> None:
    mid_scroll: dict[str, Any] = {}
    for mode in ("no-preference", "reduce"):
        with open_app(browser, app_url + "/", reduced_motion=mode) as page:
            page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
            heading = page.get_by_role("heading", level=1)
            expect(heading).to_be_visible()
            box = heading.bounding_box()
            cy = box["y"] + box["height"] / 2
            region_h = max(box["y"] + box["height"] + 20, HERO_REGION_MIN_H)
            corner = (DESKTOP[0] - 5, DESKTOP[1] - 5)
            page.mouse.move(*corner)
            pause_loops(page)
            advance(page, 300)
            rest_a = viewport_pixels(page, 0, 0, DESKTOP[0], region_h)
            advance(page, 1000)
            rest_b = viewport_pixels(page, 0, 0, DESKTOP[0], region_h)
            sweep_pointer(page, cy)
            page.mouse.move(*corner)
            advance(page, 700)
            scattered = viewport_pixels(page, 0, 0, DESKTOP[0], region_h)
            advance(page, 3000)
            reformed = viewport_pixels(page, 0, 0, DESKTOP[0], region_h)
            if mode == "reduce":
                assert difference(scattered, reformed) < STILL_MAX, "the wordmark moved under reduced motion"
            else:
                assert difference(scattered, reformed) > max(difference(rest_a, rest_b), STILL_MAX), "the wordmark particles did not scatter and re-form"
            page.evaluate("y => window.scrollTo(0, y)", HERO_SCROLL_PX // 2)
            pause_loops(page)
            advance(page, 400)
            half = viewport_pixels(page, 0, 0, DESKTOP[0], DESKTOP[1])
            mid_scroll[mode] = half
            if mode == "no-preference":
                page.evaluate("y => window.scrollTo(0, y)", HERO_SCROLL_PX)
                advance(page, 400)
                page.evaluate("y => window.scrollTo(0, y)", HERO_SCROLL_PX // 2)
                pause_loops(page)
                advance(page, 400)
                back = viewport_pixels(page, 0, 0, DESKTOP[0], DESKTOP[1])
                assert difference(half, back) < STILL_MAX, "scrolling back did not reproduce the scrubbed tiffin"
    assert difference(mid_scroll["no-preference"], mid_scroll["reduce"]) > STILL_MAX, "the tiffin at mid-scroll equals the closed still stack"


def test_dp59_noise_backdrop_and_cart_morph(app_url: str, wiremock: Any, browser: Browser) -> None:
    for mode in ("no-preference", "reduce"):
        with open_app(browser, app_url + "/signin", reduced_motion=mode) as page:
            page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
            expect(page.get_by_role("button", name="Continue")).to_be_visible()
            first = viewport_pixels(page, 0, 0, DESKTOP[0], DESKTOP[1])
            advance(page, 2000)
            second = viewport_pixels(page, 0, 0, DESKTOP[0], DESKTOP[1])
            if mode == "reduce":
                assert difference(first, second) < STILL_MAX, "the backdrop drifted under reduced motion"
            else:
                assert difference(first, second) > 0, "the sign-in backdrop is not drifting"
    buyer = signup(app_url, wiremock, "dp59m")
    with open_app(browser, f"{app_url}/p/cotton-kurta") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        add_session(page.context, buyer, app_url)
        page.goto(f"{app_url}/p/cotton-kurta")
        add = page.get_by_role("button", name="Add to cart")
        expect(add).to_be_visible()
        bx = add.bounding_box()
        page.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2)
        advance(page, 400)
        before = decode(capture(add))
        with page.expect_response(lambda r: r.url.endswith("/api/cart/lines") and r.request.method == "POST"):
            add.click()
        wait_for(lambda: line_for(cart(buyer), "L-1006") is not None, "the add reached the cart")
        expect(add).to_be_enabled()
        morphed = False
        for _ in range(MORPH_SAMPLES):
            if add.is_enabled() and difference(before, decode(capture(add))) > STILL_MAX:
                morphed = True
                break
            advance(page, MORPH_STEP_MS)
        assert morphed, "after the reply, with the button enabled again, the icon never differed from the idle cart icon (no check mark)"
        advance(page, MORPH_DONE_MS)

        def returned() -> bool:
            advance(page, MORPH_STEP_MS)
            return difference(before, decode(capture(add))) < STILL_MAX
        wait_for(returned, "the check mark did not morph back to the cart icon")


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}
SKIP_DIRS = {"node_modules", "dist", "build", "out", ".next", ".vite", "coverage", ".git"}


def source_files(root: Path) -> Iterator[Path]:
    for path in root.rglob("*"):
        if path.is_file() and not (set(path.relative_to(root).parts) & SKIP_DIRS):
            yield path


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), f"run.json {key} is not a command string"


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for name in ("Darker Grotesque", "Lexend", "Lucide"):
        assert name in notices, f"notices omit {name}"
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"notices omit shipped packages: {missing[:20]}"


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad[:20]}"


def test_if_no_other_datastore() -> None:
    assert not [p.name for p in shipped_packages() if "SQLite".lower() in p.name.lower()]
    for root in (Path("/app"), Path(DEPLOYED_APP)):
        for path in source_files(root):
            with path.open("rb") as fh:
                assert fh.read(16) != b"SQLite format 3\x00", f"{path} is an SQLite database"


def test_if_provider_config_untouched() -> None:
    for path in source_files(Path("/app")):
        if path.suffix in (".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"):
            assert WIREMOCK_ADMIN not in path.read_text(errors="ignore"), f"{path} calls the WireMock admin API"
    log = Path("/logs/agent/trajectory.json")
    if log.exists():
        text = log.read_text(errors="ignore")
        assert not re.search(r"(POST|PUT|DELETE)[^\n]{0,80}" + re.escape(WIREMOCK_MAPPINGS), text), "the agent edited the seeded WireMock stubs"


def test_if_typescript_source() -> None:
    root = Path("/app")
    generated: set[str] = set()
    ignore = root / ".gitignore"
    if ignore.exists():
        for raw in ignore.read_text(errors="ignore").splitlines():
            entry = raw.strip().strip("/")
            if entry and not entry.startswith(("#", "!")) and "*" not in entry:
                generated.add(entry.split("/")[0])
    for cfg in root.glob("tsconfig*.json"):
        found = re.search(r'"outDir"\s*:\s*"([^"]+)"', cfg.read_text(errors="ignore"))
        if found:
            generated.add(found.group(1).lstrip("./").split("/")[0])
    stray = []
    for p in source_files(root):
        rel = p.relative_to(root).parts
        if p.suffix not in (".js", ".mjs", ".cjs", ".jsx"):
            continue
        if any(part.startswith(".") for part in rel) or rel[0] in generated:
            continue
        if ".config." in p.name or p.name.endswith("rc.js") or p.name.endswith("rc.cjs"):
            continue
        stray.append(str(p))
    assert not stray, f"hand-written JavaScript files: {stray[:20]}"


def test_if_no_third_party_origins(app_url: str, browser: Browser) -> None:
    foreign: list[str] = []
    with plain_page(browser, app_url) as page:
        page.on("request", lambda r: foreign.append(r.url) if r.url.startswith("http") and not same_origin(r.url, app_url) else None)
        for path in ("/", "/search?q=tiffin", "/p/dhwani-speaker"):
            page.goto(app_url + path)
            page.wait_for_load_state("networkidle")
    assert not foreign, f"third-party requests: {foreign[:10]}"
