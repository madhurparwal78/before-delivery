from __future__ import annotations

import hashlib
import json
import os
import random
import re
import subprocess
import threading
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, time as dtime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from math import asin, ceil, cos, floor, radians, sin, sqrt
from pathlib import Path
from time import monotonic
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect

from conftest import (
    addresses,
    advance,
    animations,
    axe,
    capture,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    sample,
    select,
    session,
    state_styles,
    tab_order,
    text,
    unique,
)

APP_DIR = "/app"
HTTP_TIMEOUT = 60
UI_WAIT = 25
MAIL_WAIT = 60
QUIET_SETTLE = 7
SETTLE_MARGIN_MS = 150
PASSWORD = "Glide2026ride"
NEW_PASSWORD = "Swell2027wave"
PHONE = "+14155550100"
US_POSTAL = "10001"
UNKNOWN_BUILD = "B-0000000000"
UNKNOWN_MATCH = "999999999"
UNKNOWN_TOKEN = "Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz9"
UNKNOWN_ORDER = "TF-999999"
FAR_BASE = datetime(2032, 1, 5, 9, 0, tzinfo=timezone.utc)
TOKYO = "Asia/Tokyo"
UNKNOWN_PAGE = "/no-such-page-tern"
CLOCK_PROBE = "2030-05-21T12:00:00Z"
UNICODE_NAME = "Zoë Ångström"
CALLER = "Ana Rider"
CASE_SUBJECT = "Charging question"
OUT_OF_HOURS = "08:30"
SET_COOKIE = "Set-Cookie"
RIDER_MAX = 120
RIDER_OVER_90 = 95
GEAR_MIN = 1
PRESS_QUOTES = 4
THANKS_RE = re.compile(re.escape(f"Thanks, {CALLER.split()[0]}.") + r" Your reference is CB-\d+\.")

EXAMPLE_TOTAL = 1889800
FIN_EXAMPLE_A = 1099900
FIN_EXAMPLE_12 = (91659, 91651)
FIN_EXAMPLE_6 = (183317, 183315)
FIN_MINIMUM = 50000
APR_DIVISOR = 120000
TAX_DIVISOR = 100000
CHARGE25_CENTS = 2500
CHARGE25_MIN = 10000
SHARE_TTL = 2592000
QUOTE_TTL = 1209600
BOOKING_CLOSE = 3600
CANCEL_LIMIT = 86400
DEMO_CREDIT = 20000
DEMO_TTL = 7776000
PROTECT_WINDOW = 2592000
PROTECT_PRICES = {2: 79900, 3: 129900}
LOOKUP_WINDOW = 900
RETRY_AT_600 = 300
LOOKUP_STEP = 600
RESET_TTL = 1800
BODY_LIMIT = 65536
EARTH_KM = 6371.0
MAX_RADIUS = 500
DEFAULT_RADIUS = 100
SEARCH_MAX = 64
SEARCH_RESULTS = 20
ORDER_LIMIT_MAX = 50
ORDER_DEFAULT_PAGE = 20
CALL_LEAD = 7200
CALL_HORIZON = 2592000
CAP_BUILD_LINE = 2
CAP_BUILDS = 3
CAP_ACCESSORY = 5
SLOT_CAPACITY_MAX = 20
QUOTE_MIN, QUOTE_MAX = 100, 500000
FIRST_ORDER = 100001
DELIVERED_AT = "2030-06-15T22:30:00Z"
DAYS_365_AT = "2030-06-16T03:59:59Z"
DAYS_364_AT = "2030-06-16T04:00:00Z"
WARRANTY_START = "2030-06-15"
BOARD_WARRANTY_END = "2031-06-15"
BATTERY_MONTHS = 18
DE_BEFORE = "2026-10-26T12:59:00Z"
DE_AT = "2026-10-26T13:00:00Z"
CALL_NOW = "2030-10-21T00:00:00Z"
BERLIN_LOCAL = "2030-10-28T09:00"
BERLIN_UTC = "2030-10-28T08:00:00Z"
BERLIN_LINE = "We will call you on Mon 28 Oct 2030 at 09:00 Europe/Berlin (08:00 UTC)."
CUTOFF = dtime(14, 0)

HERO_CHECK_MS = 300
HERO_REST_MS = 1050
DRAWER_ENTER_MS = 300
DRAWER_CHECK_MS = 150
QUIZ_REST_MS = 500
QUIZ_CHECK_MS = 350
SWAP_CHECK_MS = 200
SWAP_REST_MS = 450
CAMERA_GLIDE_MS = 600
CAMERA_CHECK_MS = 300
KEY_STEP_MS = 200
RIDE_COUNT_MS = 400
RIDE_CHECK_MS = 200
PROGRESS_MS = 400
GHOST_CLEAR_MS = 100
VIEWER_READY_S = 3
HERO_TEXT_S = 2
QUOTE_BUDGET_S = 0.3
ANGLE_TOL, METRE_TOL, ZOOM_TOL = 0.5, 0.01, 0.01

STAFF = {
    "admin": ("staff@ternfoils.com", "StaffPass2026"),
    "dealer": ("dealer@ternfoils.com", "DealerPass2026"),
    "support": ("support@ternfoils.com", "SupportPass2026"),
}

SLOTS = ("wing", "mast", "propulsion", "battery", "controller")
BOARD_NAMES = ("Drift", "Crest", "Swift")
BOARDS = {
    "DR-49": {"board": "Drift", "size": "4'9", "finish": "pearl white", "price": 1099900, "defaults": ("WNG-B170", "MST-AL28", "PRP-68", "BAT-18", "CTL-STD"), "stock": 5},
    "DR-54": {"board": "Drift", "size": "5'4", "finish": "pearl white", "price": 1099900, "defaults": ("WNG-B170", "MST-AL28", "PRP-68", "BAT-18", "CTL-STD"), "stock": 5},
    "CR-52": {"board": "Crest", "size": "5'2", "finish": "carbon black", "price": 1499900, "defaults": ("WNG-Q150", "MST-CF28", "PRP-68", "BAT-22", "CTL-ELT"), "stock": 3},
    "CR-58": {"board": "Crest", "size": "5'8", "finish": "carbon black", "price": 1499900, "defaults": ("WNG-Q150", "MST-CF28", "PRP-68", "BAT-22", "CTL-ELT"), "stock": 1},
    "SW-43": {"board": "Swift", "size": "4'3", "finish": "graphite", "price": 1399900, "defaults": ("WNG-Q120", "MST-CF32", "PRP-55F", "BAT-10", "CTL-ELT"), "stock": 2},
    "SW-48": {"board": "Swift", "size": "4'8", "finish": "graphite", "price": 1399900, "defaults": ("WNG-Q120", "MST-CF32", "PRP-55F", "BAT-10", "CTL-ELT"), "stock": 2},
    "SW-52": {"board": "Swift", "size": "5'2", "finish": "graphite", "price": 1399900, "defaults": ("WNG-Q120", "MST-CF32", "PRP-55F", "BAT-10", "CTL-ELT"), "stock": 0},
}
COMPONENTS = {
    "WNG-B170": {"slot": "wing", "name": "Bolt-on Glide 170", "colour": "sky blue", "price": 89900, "wh": None, "mast_m": None, "draw": 900, "per_gear": 150, "fits": ["Drift"]},
    "WNG-Q150": {"slot": "wing", "name": "Arc Pro 150 SnapFit", "colour": "teal", "price": 159900, "wh": None, "mast_m": None, "draw": 1000, "per_gear": 170, "fits": ["Crest", "Swift"]},
    "WNG-Q180": {"slot": "wing", "name": "Arc Pro 180 Wide SnapFit", "colour": "deep teal", "price": 179900, "wh": None, "mast_m": None, "draw": 950, "per_gear": 160, "fits": ["Crest"]},
    "WNG-Q120": {"slot": "wing", "name": "Reef 120 SnapFit", "colour": "coral", "price": 149900, "wh": None, "mast_m": None, "draw": 1100, "per_gear": 200, "fits": ["Swift"]},
    "MST-AL28": {"slot": "mast", "name": '28" aluminum', "colour": "brushed silver", "price": 49900, "wh": None, "mast_m": "0.711", "fits": ["Drift"]},
    "MST-CF28": {"slot": "mast", "name": '28" carbon SnapFit', "colour": "black", "price": 119900, "wh": None, "mast_m": "0.711", "fits": ["Drift", "Crest"]},
    "MST-CF32": {"slot": "mast", "name": '32" carbon SnapFit', "colour": "black", "price": 139900, "wh": None, "mast_m": "0.813", "fits": ["Crest", "Swift"]},
    "PRP-68": {"slot": "propulsion", "name": "68 mm direct drive", "colour": "dark grey", "price": 299900, "wh": None, "mast_m": None, "fits": ["Drift", "Crest"]},
    "PRP-55F": {"slot": "propulsion", "name": "55 mm folding glide", "colour": "light grey", "price": 279900, "wh": None, "mast_m": None, "fits": ["Swift"]},
    "BAT-18": {"slot": "battery", "name": "1.8 kWh pack", "colour": "yellow", "price": 299900, "wh": 1800, "mast_m": None, "fits": ["Drift"]},
    "BAT-22": {"slot": "battery", "name": "2.2 kWh pack", "colour": "orange", "price": 349900, "wh": 2200, "mast_m": None, "fits": ["Drift", "Crest"]},
    "BAT-10": {"slot": "battery", "name": "1.0 kWh pack", "colour": "green", "price": 249900, "wh": 1000, "mast_m": None, "fits": ["Swift"]},
    "CTL-STD": {"slot": "controller", "name": "Hand Controller", "colour": "white", "price": 29900, "wh": None, "mast_m": None, "fits": ["Drift", "Crest", "Swift"]},
    "CTL-ELT": {"slot": "controller", "name": "Grip Pro Hand Controller", "colour": "black", "price": 59900, "wh": None, "mast_m": None, "fits": ["Crest", "Swift"]},
}
COMPONENT_STOCK = 50
ACCESSORIES = {
    "ACC-FLOAT": ("Floatpad inflatable", 129900, 10),
    "ACC-CHG": ("Fast charger", 39900, 50),
    "ACC-BAG": ("Board bag", 24900, 50),
    "SFB-40-18": ("4'0 18L Tow board", 165000, 0),
    "SFB-50-60": ("5'0 60L Prone board", 189900, 4),
    "SFB-59-105": ("5'9 105L Wing board", 219900, 3),
}
LOCATIONS = {
    1: ("Bayfront Demo Center", "San Juan", "PR", 18.4655, -66.1057, "America/Puerto_Rico"),
    2: ("Harbor Point Rentals", "Miami", "US", 25.7617, -80.1918, "America/New_York"),
    3: ("Lakeside Foil Club", "Austin", "US", 30.2672, -97.7431, "America/Chicago"),
    4: ("North Shore Watersports", "Toronto", "CA", 43.6532, -79.3832, "America/Toronto"),
    5: ("Elbe Foil Station", "Hamburg", "DE", 53.5511, 9.9937, "Europe/Berlin"),
    6: ("Riviera Foil Lab", "Nice", "FR", 43.7102, 7.2620, "Europe/Paris"),
    7: ("Coastline Demo Hub", "Sydney", "AU", -33.8688, 151.2093, "Australia/Sydney"),
}
COUNTRIES = {
    "US": {"name": "United States", "package": 0, "accessory": 1500, "free_from": 100000, "packed": 2500, "alone": 4500, "taxes": [("Sales tax", 7250)], "transit": 2},
    "PR": {"name": "Puerto Rico", "package": 0, "accessory": 1500, "free_from": 100000, "packed": 5500, "alone": 9500, "taxes": [("Sales tax", 11500)], "transit": 1},
    "CA": {"name": "Canada", "package": 39900, "accessory": 3500, "free_from": None, "packed": 3500, "alone": 6500, "taxes": None, "transit": 4},
    "DE": {"name": "Germany", "package": 59900, "accessory": 4500, "free_from": None, "packed": 4500, "alone": 8500, "taxes": [("VAT", 19000)], "transit": 3},
    "FR": {"name": "France", "package": 59900, "accessory": 4500, "free_from": None, "packed": 4500, "alone": 8500, "taxes": [("VAT", 20000)], "transit": 2},
    "AU": {"name": "Australia", "package": 79900, "accessory": 6500, "free_from": None, "packed": 7500, "alone": 12500, "taxes": [("GST", 10000)], "transit": 6},
}
PROVINCES = {
    "A": [("HST", 15000)], "C": [("HST", 15000)], "E": [("HST", 15000)],
    "B": [("HST", 14000)],
    "K": [("HST", 13000)], "L": [("HST", 13000)], "M": [("HST", 13000)], "N": [("HST", 13000)], "P": [("HST", 13000)],
    "G": [("GST", 5000), ("QST", 9975)], "H": [("GST", 5000), ("QST", 9975)], "J": [("GST", 5000), ("QST", 9975)],
    "R": [("GST", 5000), ("PST", 7000)], "V": [("GST", 5000), ("PST", 7000)],
    "S": [("GST", 5000), ("PST", 6000)],
    "T": [("GST", 5000)], "X": [("GST", 5000)], "Y": [("GST", 5000)],
}
HOLIDAYS = {
    "America/Puerto_Rico": {"2026-11-11", "2026-11-19", "2026-11-26", "2026-12-25", "2027-01-01", "2027-01-06"},
    "Europe/Madrid": {"2026-11-02", "2026-11-09", "2026-12-07", "2026-12-08", "2026-12-25", "2027-01-01", "2027-01-06"},
}
COUNTRY_ZONES = {"US": "America/New_York", "PR": "America/Puerto_Rico", "CA": "America/Toronto", "DE": "Europe/Berlin", "FR": "Europe/Paris", "AU": "Australia/Sydney"}

CR52_PARTS = {"wing": "WNG-Q180", "mast": "MST-CF32", "propulsion": "PRP-68", "battery": "BAT-22", "controller": "CTL-STD"}

USER_KEYS = {"id", "email", "role"}
TERM_KEYS = {"months", "apr_bp", "monthly_cents", "last_cents"}
BOARD_KEYS = {"sku", "name", "size", "finish", "price_cents", "defaults", "stock", "in_stock", "as_low_as_cents"}
COMPONENT_KEYS = {"sku", "slot", "name", "colour", "price_cents", "wh", "mast_m", "fits", "stock", "in_stock", "as_low_as_cents"}
ACCESSORY_KEYS = {"sku", "name", "price_cents", "stock", "in_stock", "as_low_as_cents"}
BUILD_KEYS = {"code", "board_sku", "board_name", "slots", "spares", "rider_kg", "gear", "total_cents", "ride_min", "total_ride_min", "battery_bars", "financing"}
MATCH_KEYS = {"id", "answers", "recommended", "scores", "reasons"}
LINE_KEYS = {"id", "type", "code", "sku", "name", "quantity", "unit_cents", "line_cents"}
CART_KEYS = {"lines", "accessory_subtotal_cents", "build_subtotal_cents", "subtotal_cents", "codes", "item_count", "financing"}
SNAPSHOT_KEYS = {"type", "code", "sku", "name", "quantity", "unit_cents"}
BREAKDOWN_KEYS = {"lines", "subtotal_cents", "discounts", "credits", "taxable_cents", "shipping_cents", "free_shipping", "packed_batteries", "standalone_batteries", "dangerous_goods_cents", "taxes", "tax_cents", "total_cents", "ships_on", "arrives_on", "financing"}
ORDER_KEYS = {"number", "status", "placed_at", "country", "address", "lines", "subtotal_cents", "discounts", "credits", "taxable_cents", "shipping_cents", "packed_batteries", "standalone_batteries", "dangerous_goods_cents", "taxes", "tax_cents", "total_cents", "ships_on", "arrives_on", "trade_in_id", "billing_account_key", "billing_invoice_id", "events"}
ORDER_LINE_KEYS = {"id", "type", "sku", "code", "name", "quantity", "unit_cents", "line_cents", "protected_until"}
TRACKING_KEYS = {"number", "status", "events", "lines"}
REGISTRATION_KEYS = {"serial", "order_number", "board_name", "country", "registered_at", "board_warranty_ends_on", "battery_warranty_ends_on", "board_days_left", "battery_days_left"}
TRADE_IN_KEYS = {"id", "status", "brand", "model_year", "condition", "serial", "note", "quote_cents", "quote_expires_at", "reject_reason", "order_number"}
LOCATION_KEYS = {"id", "name", "city", "country", "timezone", "opening_hours", "lat", "lon", "distance_km"}
SLOT_KEYS = {"id", "location_id", "starts_at", "ends_at", "capacity", "seats_left", "timezone", "label"}
BOOKING_KEYS = {"id", "slot_id", "status", "customer_email"}
EVENT_KEYS = {"id", "title", "location_id", "location_name", "city", "starts_on", "ends_on"}
CASE_KEYS = {"reference", "status", "subject", "opened_at"}
PLAN_KEYS = {"line_id", "term_years", "price_cents", "tax_cents", "protected_until"}
NOTICE_KEYS = {"id", "to", "template", "reference", "subject", "status", "attempts", "created_at", "sent_at"}
TAX_KEYS = {"name", "rate_pcm", "amount_cents"}

MATCH_POINTS = {
    "never": (1, 3, 0, 0), "foiled": (1, 0, 1, 3), "powered": (1, 0, 2, 1),
    "calm": (2, 2, 1, 0), "swell": (2, 0, 1, 2), "mixed": (2, 0, 2, 0),
    "stability": (3, 2, 0, 0), "range": (3, 0, 3, 0), "lightness": (3, 0, 0, 3),
    "under-12k": (4, 3, 0, 0), "12k-14k": (4, 0, 0, 2), "any": (4, 0, 2, 0),
    "under-70": (5, 0, 0, 1), "70-90": (5, 0, 1, 0), "over-90": (5, 1, 1, 0),
}


def rhu(x: Any) -> int:
    return floor(Fraction(x) + Fraction(1, 2))


def money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    c = abs(cents)
    return f"{sign}${c // 100:,}.{c % 100:02d}"


def pct(rate_pcm: int) -> str:
    s = f"{Decimal(rate_pcm) / 1000:f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s + "%"


def day_label(iso_day: str) -> str:
    d = date.fromisoformat(iso_day)
    return f"{d:%a}, {d:%b} {d.day}"


def long_date(instant: str) -> str:
    d = parse_iso(instant)
    return f"{d.day} {d:%B} {d.year}"


def picks(board: str = "DR-49", spares: int = 0, rider: int = 80, gear: int = 5, **parts: str) -> dict[str, Any]:
    chosen = dict(zip(SLOTS, BOARDS[board]["defaults"]))
    chosen.update(parts)
    return {"board_sku": board, **chosen, "spares": spares, "rider_kg": rider, "gear": gear}


CR52_EXAMPLE = picks("CR-52", spares=1, **CR52_PARTS)


def build_code(p: dict[str, Any]) -> str:
    canon = "|".join(str(p[k]) for k in ("board_sku", *SLOTS, "spares", "rider_kg", "gear"))
    return "B-" + hashlib.sha256(canon.encode()).hexdigest().upper()[:10]


def expected_build(p: dict[str, Any]) -> dict[str, Any]:
    board = BOARDS[p["board_sku"]]
    defaults = dict(zip(SLOTS, board["defaults"]))
    deltas = {s: max(0, COMPONENTS[p[s]]["price"] - COMPONENTS[defaults[s]]["price"]) for s in SLOTS}
    total = board["price"] + sum(deltas.values()) + p["spares"] * COMPONENTS[p["battery"]]["price"]
    wing = COMPONENTS[p["wing"]]
    draw = wing["draw"] + (p["gear"] - 1) * wing["per_gear"]
    exact = Fraction(COMPONENTS[p["battery"]]["wh"] * 60 * 1000, draw * (1000 + 4 * max(0, p["rider_kg"] - 80)))
    ride = 5 * floor(exact / 5)
    total_ride = ride * (1 + p["spares"])
    return {"total": total, "deltas": deltas, "ride": ride, "total_ride": total_ride, "bars": min(4, 1 + total_ride // 90)}


def financing(amount: int, country: str | None = None) -> list[dict[str, int]]:
    if amount < FIN_MINIMUM:
        return []
    terms = [(12, 0), (24, 999)] if country == "CA" else [(6, 0), (12, 0), (24, 999), (36, 999)]
    out = []
    for months, apr in terms:
        if apr == 0:
            monthly = -(-amount // months)
            last = amount - monthly * (months - 1)
        else:
            r = Fraction(apr, APR_DIVISOR)
            monthly = ceil(amount * r / (1 - (1 + r) ** -months))
            balance = amount
            for _ in range(months - 1):
                balance = balance + rhu(Fraction(balance * apr, APR_DIVISOR)) - monthly
            last = balance + rhu(Fraction(balance * apr, APR_DIVISOR))
        out.append({"months": months, "apr_bp": apr, "monthly_cents": monthly, "last_cents": last})
    return out


def as_low_as(amount: int, country: str | None = None) -> int | None:
    terms = financing(amount, country)
    return min(t["monthly_cents"] for t in terms) if terms else None


def tax_components(country: str, postal: str | None) -> list[tuple[str, int]]:
    if country == "CA":
        return PROVINCES[(postal or "?")[0].upper()]
    return COUNTRIES[country]["taxes"]


def code_amounts(codes: list[str], acc_subtotal: int) -> list[int]:
    out, remaining = [], acc_subtotal
    for code in codes:
        amount = rhu(Fraction(acc_subtotal * 10, 100)) if code.upper() == "FLYFIRST" else (CHARGE25_CENTS if acc_subtotal >= CHARGE25_MIN else 0)
        amount = min(amount, remaining)
        remaining -= amount
        out.append(amount)
    return out


def unit_price(sku: str) -> int:
    return ACCESSORIES[sku][1] if sku in ACCESSORIES else COMPONENTS[sku]["price"]


def expected_checkout(lines: list[tuple[str, Any, int]], codes: list[str], country: str, postal: str | None, credits: int = 0) -> dict[str, Any]:
    acc = sum(unit_price(item) * q for kind, item, q in lines if kind == "acc")
    builds = sum(expected_build(item)["total"] * q for kind, item, q in lines if kind == "build")
    taxable = acc + builds - sum(code_amounts(codes, acc)) - credits
    c = COUNTRIES[country]
    has_build = any(kind == "build" for kind, _, _ in lines)
    shipping = c["package"] if has_build else c["accessory"]
    free = c["free_from"] is not None and taxable >= c["free_from"]
    if free:
        shipping = 0
    packed = sum(item["spares"] * q for kind, item, q in lines if kind == "build")
    alone = sum(q for kind, item, q in lines if kind == "acc" and item.startswith("BAT-"))
    dg = packed * c["packed"] + alone * c["alone"]
    taxes = [(n, r, rhu(Fraction(taxable * r, TAX_DIVISOR))) for n, r in tax_components(country, postal)]
    tax = sum(a for _, _, a in taxes)
    return {"taxable": taxable, "shipping": shipping, "free": free, "packed": packed, "alone": alone, "dg": dg, "taxes": taxes, "tax": tax, "total": taxable + shipping + dg + tax}


def ship_dates(now_iso: str, country: str) -> tuple[str, str]:
    zone = "Europe/Madrid" if country in ("DE", "FR") else "America/Puerto_Rico"
    holidays = HOLIDAYS[zone]
    local = parse_iso(now_iso).astimezone(ZoneInfo(zone))

    def business(d: date) -> bool:
        return d.weekday() < 5 and d.isoformat() not in holidays

    def following(d: date) -> date:
        d += timedelta(days=1)
        while not business(d):
            d += timedelta(days=1)
        return d

    today = local.date()
    ships = today if business(today) and local.time() < CUTOFF else following(today)
    arrives = ships
    for _ in range(COUNTRIES[country]["transit"]):
        arrives = following(arrives)
    return ships.isoformat(), arrives.isoformat()


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, monthrange(year, month)[1]))


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    a = sin(radians(lat2 - lat1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lon2 - lon1) / 2) ** 2
    d = 2 * EARTH_KM * asin(sqrt(a))
    return float(Decimal(repr(d)).quantize(Decimal("0.1"), ROUND_HALF_UP))


def luhn_serial() -> str:
    payload = [random.randint(0, 9) for _ in range(8)]
    total = 0
    for i, digit in enumerate(reversed(payload)):
        v = digit * 2 if i % 2 == 0 else digit
        total += v - 9 if v > 9 else v
    return "TF" + "".join(map(str, payload)) + str((10 - total % 10) % 10)


def slot_label(starts: str, ends: str, zone: str) -> str:
    s = parse_iso(starts).astimezone(ZoneInfo(zone))
    e = parse_iso(ends).astimezone(ZoneInfo(zone))
    return f"{s:%a} {s.day} {s:%b} {s.year}, {s:%H:%M} to {e:%H:%M} local time"


def mask(email: str) -> str:
    local, domain = email.split("@", 1)
    return f"{local[0]}***@{domain}"


KB_ENV = ("KILLBILL_URL", "KILLBILL_USERNAME", "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET")
KB_CREATED_BY = "tern-foils"
KB_PLACED = "order_placed"
KB_CANCELLED = "order_cancelled"


def kb_get(path: str, **params: str) -> Any:
    url, user, password, key, secret = (os.environ[k] for k in KB_ENV)
    r = httpx.get(url.rstrip("/") + path, params=params, auth=(user, password), timeout=HTTP_TIMEOUT,
                  headers={"X-Killbill-ApiKey": key, "X-Killbill-ApiSecret": secret, "Accept": "application/json"})
    assert r.status_code == 200, r.text
    return r.json()


def kb_cents(amount: Any) -> int:
    return int(Decimal(str(amount)) * 100)


def kb_invoice(invoice_id: str) -> dict[str, Any]:
    return kb_get(f"/1.0/kb/invoices/{invoice_id}", withChildrenItems="false", audit="FULL")


def kb_logs(inv: dict[str, Any]) -> list[dict[str, Any]]:
    logs = list(inv.get("auditLogs") or [])
    for item in inv.get("items") or []:
        logs += item.get("auditLogs") or []
    return logs


def kb_attributed(inv: dict[str, Any], reason: str, number: str) -> bool:
    return any(l.get("changedBy") == KB_CREATED_BY and l.get("reasonCode") == reason and l.get("comments") == number for l in kb_logs(inv))


def kb_items(inv: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [i for i in inv.get("items") or [] if i.get("itemType") == kind]


def kb_account_invoices(account_id: str) -> list[dict[str, Any]]:
    return [kb_invoice(i["invoiceId"]) for i in kb_get(f"/1.0/kb/accounts/{account_id}/invoices")]


def kb_order_invoices(account_id: str, number: str) -> list[dict[str, Any]]:
    return [i for i in kb_account_invoices(account_id)
            if any(str(it.get("description", "")).startswith(number + " ") for it in i.get("items") or [])]


def kb_balance(account_id: str) -> int:
    return kb_cents(kb_get(f"/1.0/kb/accounts/{account_id}", accountWithBalance="true")["accountBalance"])


def assert_invoice(order: dict[str, Any]) -> dict[str, Any]:
    n = order["number"]
    want = [(f"{n} merchandise", order["taxable_cents"]), (f"{n} shipping", order["shipping_cents"]),
            (f"{n} dangerous goods", order["dangerous_goods_cents"]), (f"{n} tax", order["tax_cents"])]
    want = [w for w in want if w[1]]
    inv = kb_invoice(order["billing_invoice_id"])
    charges = kb_items(inv, "EXTERNAL_CHARGE")
    got = [(i["description"], kb_cents(i["amount"])) for i in charges]
    assert sorted(got) == sorted(want), got
    assert sum(c for _, c in got) == order["total_cents"]
    assert inv.get("currency") == "USD"
    assert kb_attributed(inv, KB_PLACED, n), kb_logs(inv)
    return inv


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def shift(instant: str, seconds: int) -> str:
    return iso(parse_iso(instant) + timedelta(seconds=seconds))


def near(actual: str, expected: str) -> bool:
    return 0 <= (parse_iso(actual) - parse_iso(expected)).total_seconds() <= 1


@contextmanager
def server_clock(base: str) -> Iterator[Callable[[str], str]]:
    def set_now(instant: str) -> str:
        r = httpx.put(base + "/api/_clock", json={"now": instant}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        return r.json()["now"]

    try:
        yield set_now
    finally:
        httpx.delete(base + "/api/_clock", timeout=HTTP_TIMEOUT)


def far_slot_start() -> datetime:
    return FAR_BASE + timedelta(hours=random.randrange(0, 60000))


class Who:
    def __init__(self, c: httpx.Client, email: str, name: str, password: str = PASSWORD):
        self.c, self.email, self.name, self.password = c, email, name, password


def ident(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    email, name = (a, b) if "@" in a else (b, a)
    name = (name or prefix).strip()[:40]
    return email.strip().lower(), name if len(name) >= 2 else "Rider " + name


def http(base: str, cookie_header: str | None = None) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, headers={"Cookie": cookie_header} if cookie_header else None)


def signup(base: str, prefix: str = "customer") -> Who:
    email, name = ident(prefix)
    c = http(base)
    r = c.post("/api/auth/signup", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return Who(c, email, name)


def login(base: str, email: str, password: str) -> httpx.Client:
    c = http(base)
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def staff(base: str, role: str) -> Who:
    email, password = STAFF[role]
    return Who(login(base, email, password), email, role, password)


def cookie_header(c: httpx.Client) -> str:
    return "; ".join(f"{k}={v}" for k, v in c.cookies.items())


def elsewhere(base: str, who: Who) -> Who:
    return Who(http(base, cookie_header(who.c)), who.email, who.name)


def err(r: httpx.Response, status: int, code: str, message: str | None = None, fields: dict[str, str] | None = None) -> dict[str, Any]:
    assert r.status_code == status, (r.status_code, r.text)
    assert r.headers.get("content-type", "").startswith("application/json"), r.headers
    body = r.json()
    assert body["error"] == code, body
    assert set(body) <= {"error", "message", "fields"}, body
    if message is not None:
        assert body["message"] == message, body
    for k, v in (fields or {}).items():
        assert body["fields"][k] == v, body
    return body


def save(c: httpx.Client, p: dict[str, Any]) -> str:
    r = c.post("/api/builds", json=p)
    assert r.status_code in (200, 201), r.text
    return r.json()["code"]


def add_build(who: Who | httpx.Client, p: dict[str, Any], qty: int = 1) -> str:
    c = who.c if isinstance(who, Who) else who
    code = save(c, p)
    r = c.post("/api/cart/lines", json={"type": "build", "code": code, "quantity": qty})
    assert r.status_code == 200, r.text
    return code


def add_acc(who: Who | httpx.Client, sku: str, qty: int = 1) -> dict[str, Any]:
    c = who.c if isinstance(who, Who) else who
    r = c.post("/api/cart/lines", json={"type": "accessory", "sku": sku, "quantity": qty})
    assert r.status_code == 200, r.text
    return r.json()


def order_body(who: Who, country: str = "US", postal: str = US_POSTAL, **flags: bool) -> dict[str, Any]:
    return {
        "country": country,
        "address": {"name": who.name, "line1": "12 Harbour Road", "city": "San Juan", "postal_code": postal, "phone": PHONE},
        "use_trade_in": flags.get("use_trade_in", False),
        "use_demo_credit": flags.get("use_demo_credit", False),
    }


def place(who: Who, country: str = "US", postal: str = US_POSTAL, key: str | None = None, **flags: bool) -> httpx.Response:
    return who.c.post("/api/orders", json=order_body(who, country, postal, **flags), headers={"Idempotency-Key": key or idempotency_key()})


def placed(who: Who, country: str = "US", postal: str = US_POSTAL, **flags: bool) -> dict[str, Any]:
    r = place(who, country, postal, **flags)
    assert r.status_code == 201, r.text
    return r.json()


def checkout_quote(who: Who, country: str, postal: str | None = None, **flags: bool) -> httpx.Response:
    body: dict[str, Any] = {"country": country, "use_trade_in": flags.get("use_trade_in", False), "use_demo_credit": flags.get("use_demo_credit", False)}
    if postal is not None:
        body["postal_code"] = postal
    return who.c.post("/api/checkout/quote", json=body)


def cancel_quietly(who: Who, numbers: list[str]) -> None:
    for n in numbers:
        who.c.post(f"/api/orders/{n}/cancel")


def catalog(base: str) -> dict[str, dict[str, Any]]:
    body = http(base).get("/api/catalog").json()
    return {item["sku"]: item for group in ("boards", "components", "accessories") for item in body[group]}


def number_of(n: str) -> int:
    assert re.fullmatch(r"TF-\d{6}", n), n
    return int(n[3:])


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    gate = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        gate.wait()
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def new_slot(base: str, location: int, capacity: int, start: datetime | None = None, hours: int = 2) -> dict[str, Any]:
    start = start or far_slot_start()
    r = staff(base, "admin").c.post(f"/api/staff/locations/{location}/slots", json={"starts_at": iso(start), "ends_at": iso(start + timedelta(hours=hours)), "capacity": capacity})
    assert r.status_code == 201, r.text
    return r.json()


def outbox(base: str) -> list[dict[str, Any]]:
    r = staff(base, "support").c.get("/api/staff/outbox")
    assert r.status_code == 200, r.text
    return r.json()["notices"]


def submit_trade_in(who: Who) -> dict[str, Any]:
    r = who.c.post("/api/trade-ins", json={"brand": "Tern Foils", "model_year": 2022, "condition": "B", "serial": "ABC12345", "note": ""})
    assert r.status_code == 201, r.text
    return r.json()


def staff_quote(base: str, trade_in_id: Any, cents: int) -> dict[str, Any]:
    r = staff(base, "support").c.post(f"/api/staff/trade-ins/{trade_in_id}/quote", json={"amount_cents": cents})
    assert r.status_code == 200, r.text
    return r.json()


def callback_body(address: str, name: str = CALLER, **over: Any) -> dict[str, Any]:
    body = {"name": name, "email": address, "phone": PHONE, "timezone": "Europe/Berlin", "preferred_start": BERLIN_LOCAL, "topic": "Choosing a board", "message": ""}
    body.update(over)
    return body


def mail_to(mail: Any, email: str, count: int = 1, deadline: float = MAIL_WAIT) -> list[dict[str, Any]]:
    end = monotonic() + deadline
    while True:
        found = [m for m in mail.messages() if email.lower() in [a.lower() for a in addresses(m.get("To"))]]
        if len(found) >= count or monotonic() > end:
            return found


def quiet_mail_to(mail: Any, email: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=QUIET_SETTLE) if email.lower() in [a.lower() for a in addresses(m.get("To"))]]


def body_lines(message: dict[str, Any]) -> list[str]:
    return [line.strip() for line in text(message).splitlines() if line.strip()]


@contextmanager
def browse(browser: Any, base: str, path: str, **options: Any) -> Iterator[Any]:
    with open_app(browser, base + path, **options) as page:
        yield page


def wait_for(page: Any, predicate: Callable[[], Any], seconds: float = UI_WAIT, step: float = 100) -> float:
    end, advanced = monotonic() + seconds, 0.0
    while True:
        try:
            if predicate():
                return advanced
        except PlaywrightError:
            pass
        assert monotonic() < end, "UI state did not settle in time"
        advance(page, step)
        advanced += step


def shows(page: Any, content: str | re.Pattern[str]) -> None:
    wait_for(page, lambda: page.get_by_text(content).first.is_visible())


def page_text(page: Any) -> str:
    return page.evaluate("document.body.innerText")


def sign_in_page(page: Any, base: str, email: str, password: str) -> None:
    r = page.request.post(base + "/api/auth/login", data={"email": email, "password": password})
    assert r.ok, r.text()


def query(page: Any) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}


def focused(locator: Any) -> bool:
    return locator.evaluate("e => e === document.activeElement")


def viewer(page: Any) -> Any:
    return page.get_by_role("region", name="Board viewer")


def ready(page: Any) -> None:
    wait_for(page, lambda: viewer(page).get_attribute("data-ready") == "true")


def summary(page: Any) -> Any:
    return page.get_by_role("region", name="Build summary")


def question_name(n: int) -> str:
    return f"Question {n} of 5"


def question(page: Any, n: int) -> Any:
    return page.get_by_role("heading", name=question_name(n))


ATTR_JS = """(el, name) => {
  for (let n = el; n; n = n.parentElement) if (n.hasAttribute(name)) return n.getAttribute(name);
  for (const n of el.getElementsByTagName('*')) if (n.hasAttribute(name)) return n.getAttribute(name);
  return null;
}"""


def data_attr(locator: Any, name: str) -> str | None:
    return locator.evaluate(ATTR_JS, name)


FINANCE_RE = re.compile(r"As low as \$[\d,]+\.\d\d/mo")


def monthly_shown(scope: Any) -> int:
    return int(data_attr(scope.get_by_text(FINANCE_RE).first, "data-monthly-cents"))


def ride_readout(page: Any) -> Any:
    return summary(page).get_by_text(re.compile(r"Up to \d+ min")).first


def camera_state(page: Any) -> dict[str, Any]:
    v = viewer(page)
    return {
        "yaw": float(v.get_attribute("data-camera-yaw")),
        "pitch": float(v.get_attribute("data-camera-pitch")),
        "zoom": float(v.get_attribute("data-camera-zoom")),
        "pos": [float(x) for x in v.get_attribute("data-camera").split(",")],
        "preset": v.get_attribute("data-preset"),
    }


def angle_close(a: float, b: float) -> bool:
    return abs((a - b + 180) % 360 - 180) <= ANGLE_TOL


def build_path(p: dict[str, Any]) -> str:
    return (f"/build?board={p['board_sku']}&wing={p['wing']}&mast={p['mast']}&propulsion={p['propulsion']}"
            f"&battery={p['battery']}&controller={p['controller']}&spares={p['spares']}&rider={p['rider_kg']}&gear={p['gear']}")


SEEN_OPACITY = "e => { let o = 1; for (let x = e; x; x = x.parentElement) o *= Number(getComputedStyle(x).opacity); return o; }"
BAR_LOOK = """e => [e, ...e.querySelectorAll('*')].map(x => [getComputedStyle(x), getComputedStyle(x, '::before'),
  getComputedStyle(x, '::after')].map(s => [s.width, s.transform, s.scale, s.clipPath, s.backgroundSize,
  s.backgroundPosition].join(',')).join(';') + (x.getAttribute('width') || '')).join('|')"""
BAR_TWEEN_PROBE_MS = PROGRESS_MS


def bar_looks(page: Any, bar: Any, ms: float) -> int:
    looks = set()
    for _ in range(int(ms // 16) + 1):
        looks.add(bar.evaluate(BAR_LOOK))
        page.clock.run_for(16)
    return len(looks)


FRAMES_JS = """([els, n]) => {
  const seen = e => { let o = 1; for (let x = e; x; x = x.parentElement) o *= Number(getComputedStyle(x).opacity); return o; };
  const read = () => els.map(e => { const r = e.getBoundingClientRect();
    return {x: r.left, y: r.top, width: r.width, height: r.height, opacity: seen(e)}; });
  const fresh = document.getAnimations().filter(a => !a.__seeked && a.playState !== 'finished' && a.effect
    && Number.isFinite(a.effect.getComputedTiming().endTime) && a.effect.getComputedTiming().endTime > 0);
  if (!fresh.length) return [read()];
  const now = document.timeline.currentTime ?? 0;
  const runs = fresh.map(a => ({a, start: a.startTime ?? now, end: a.effect.getComputedTiming().endTime,
                                cur: a.currentTime ?? 0, state: a.playState}));
  const t0 = Math.min(...runs.map(r => r.start)), t1 = Math.max(...runs.map(r => r.start + r.end)), out = [];
  runs.forEach(r => { r.a.pause(); r.a.__seeked = true; });
  for (let k = 0; k <= n; k++) {
    const t = t0 + (t1 - t0) * k / n;
    runs.forEach(r => { r.a.currentTime = Math.min(r.end, Math.max(0, t - r.start)); });
    out.push(read());
  }
  runs.forEach(r => { r.a.currentTime = r.cur; if (r.state !== 'paused') r.a.play(); });
  return out;
}"""


def frames(page: Any, locators: list[Any], ms: float) -> list[list[dict[str, float]]]:
    deadline, fake, out = monotonic() + ms / 1000 + 3, 0, []
    while not all(loc.count() for loc in locators):
        assert monotonic() < deadline, "the moving element never appeared"
        page.clock.run_for(16)
        fake += 16
    handles = [loc.first.element_handle() for loc in locators]
    while fake <= ms or not out:
        out.extend(page.evaluate(FRAMES_JS, [handles, 24]))
        page.clock.run_for(16)
        fake += 16
    return out


def fill_checkout(page: Any, who: Who, country: str, postal: str) -> None:
    fill(page.get_by_role("textbox", name="Full name", exact=True), who.name)
    fill(page.get_by_role("textbox", name="Address", exact=True), "12 Harbour Road")
    fill(page.get_by_role("textbox", name="City", exact=True), "San Juan")
    fill(page.get_by_role("textbox", name="Phone", exact=True), PHONE)
    select(page.get_by_role("combobox", name="Country", exact=True), COUNTRIES[country]["name"])
    fill(page.get_by_role("textbox", name="Postal code", exact=True), postal)


def out_of_stock_badges(page: Any) -> int:
    return page.get_by_text("Out of Stock", exact=True).count()


def test_match_scoring_and_storage(app_url: str) -> None:
    cases = [
        (["never", "calm", "stability", "under-12k", "over-90"], "Drift", {"Drift": 11, "Crest": 2, "Swift": 0}, [1, 4]),
        (["powered", "mixed", "range", "any", "70-90"], "Crest", {"Drift": 0, "Crest": 10, "Swift": 1}, [3, 1]),
        (["never", "mixed", "range", "under-12k", "70-90"], "Drift", None, [1, 4]),
        (["foiled", "mixed", "lightness", "any", "70-90"], "Crest", None, [2, 4]),
    ]
    c = http(app_url)
    for answers, winner, scores, reasons in cases:
        totals = {b: sum(MATCH_POINTS[a][1 + i] for a in answers) for i, b in enumerate(BOARD_NAMES)}
        if scores is not None:
            assert totals == scores
        r = c.post("/api/match", json={"answers": answers})
        assert r.status_code == 201, r.text
        body = r.json()
        assert set(body) == MATCH_KEYS
        assert body["scores"] == totals and body["recommended"] == winner and body["reasons"] == reasons
        assert body["answers"] == answers
        again = http(app_url).get(f"/api/match/{body['id']}")
        assert again.status_code == 200 and again.json() == body
    for bad in (["never", "calm", "stability", "under-12k"],
                ["never", "calm", "stability", "under-12k", "over-90", "over-90"],
                ["never", "calm", "stability", "under-12k", "sometimes"],
                ["calm", "never", "stability", "under-12k", "over-90"]):
        err(c.post("/api/match", json={"answers": bad}), 422, "validation_error", fields={"answers": "Answer all five questions."})
    err(c.get(f"/api/match/{UNKNOWN_MATCH}"), 404, "not_found", "We could not find that match.")


def fresh_picks(c: httpx.Client) -> dict[str, Any]:
    combos = [(s, r, g) for s in (0, 1, 2) for r in range(50, 125, 5) for g in range(1, 11)]
    random.shuffle(combos)
    for spares, rider, gear in combos:
        p = picks("DR-49", spares=spares, rider=rider, gear=gear, battery="BAT-22")
        if c.get(f"/api/builds/{build_code(p)}").status_code == 404:
            return p
    raise AssertionError("no unsaved build combination left")


def test_build_save_and_reload(app_url: str) -> None:
    c = http(app_url)
    p = fresh_picks(c)
    first = c.post("/api/builds", json=p)
    assert first.status_code == 201, first.text
    code = first.json()["code"]
    again = c.post("/api/builds", json=dict(reversed(list(p.items()))))
    assert again.status_code == 200 and again.json()["code"] == code
    other = http(app_url).get(f"/api/builds/{code}")
    assert other.status_code == 200
    assert other.json() == first.json()
    assert other.json()["total_cents"] == expected_build(p)["total"]
    err(http(app_url).get(f"/api/builds/{UNKNOWN_BUILD}"), 404, "not_found", "We could not find that build.")


RIDE_CASES = {
    "dr49-defaults": (picks("DR-49"), 70, 70, 1),
    "cr52-example": (CR52_EXAMPLE, 80, 160, 2),
    "cr52-heavy-rider": (picks("CR-52", spares=1, rider=100, **CR52_PARTS), 75, 150, 2),
    "sw43-max": (picks("SW-43", rider=120, gear=10), 15, 15, 1),
    "dr49-bat22-spares": (picks("DR-49", spares=2, rider=70, gear=1, battery="BAT-22"), 145, 435, 4),
}


RIDE_IDS = ["dr49-defaults", "cr52-example", "cr52-heavy-rider", "sw43-max", "dr49-bat22-spares"]


@pytest.mark.parametrize("case", RIDE_IDS, ids=RIDE_IDS)
def test_build_price_ride_time_and_code(app_url: str, case: str) -> None:
    p, ride, total_ride, bars = RIDE_CASES[case]
    r = http(app_url).post("/api/builds/quote", json=p)
    assert r.status_code == 200, r.text
    body = r.json()
    want = expected_build(p)
    assert set(body) == BUILD_KEYS
    assert body["total_cents"] == want["total"]
    if case == "cr52-example":
        assert body["total_cents"] == EXAMPLE_TOTAL
    assert (body["ride_min"], body["total_ride_min"], body["battery_bars"]) == (ride, total_ride, bars)
    assert body["code"] == build_code(p)
    assert body["board_name"] == BOARDS[p["board_sku"]]["board"]
    for s in SLOTS:
        assert set(body["slots"][s]) == {"sku", "name", "delta_cents"}
        assert body["slots"][s]["sku"] == p[s] and body["slots"][s]["name"] == COMPONENTS[p[s]]["name"]
        assert body["slots"][s]["delta_cents"] == want["deltas"][s]
    assert body["financing"] == financing(want["total"])


def test_catalog_matches_seed(app_url: str) -> None:
    body = http(app_url).get("/api/catalog").json()
    assert set(body) == {"boards", "components", "accessories"}
    boards = {b["sku"]: b for b in body["boards"]}
    assert set(boards) == set(BOARDS)
    for sku, seed in BOARDS.items():
        b = boards[sku]
        assert set(b) == BOARD_KEYS
        assert seed["board"] in b["name"] and b["size"] == seed["size"] and b["finish"] == seed["finish"]
        assert b["price_cents"] == seed["price"] and b["defaults"] == dict(zip(SLOTS, seed["defaults"]))
        assert isinstance(b["stock"], int) and 0 <= b["stock"] <= seed["stock"] and b["in_stock"] == (b["stock"] > 0)
        assert b["as_low_as_cents"] == as_low_as(seed["price"])
    assert boards["SW-52"]["stock"] == 0 and boards["SW-52"]["in_stock"] is False
    comps = {x["sku"]: x for x in body["components"]}
    assert set(comps) == set(COMPONENTS)
    for sku, seed in COMPONENTS.items():
        x = comps[sku]
        assert set(x) == COMPONENT_KEYS
        assert (x["slot"], x["name"], x["colour"], x["price_cents"], x["wh"], x["mast_m"], x["fits"]) == (
            seed["slot"], seed["name"], seed["colour"], seed["price"], seed["wh"], seed["mast_m"], seed["fits"])
        assert 0 <= x["stock"] <= COMPONENT_STOCK and x["in_stock"] == (x["stock"] > 0)
        assert x["as_low_as_cents"] == as_low_as(seed["price"])
    accs = {x["sku"]: x for x in body["accessories"]}
    assert set(accs) == set(ACCESSORIES)
    for sku, (name, price, stock) in ACCESSORIES.items():
        x = accs[sku]
        assert set(x) == ACCESSORY_KEYS
        assert x["name"] == name and x["price_cents"] == price and 0 <= x["stock"] <= stock
        assert x["in_stock"] == (x["stock"] > 0) and x["as_low_as_cents"] == as_low_as(price)
    assert accs["SFB-40-18"]["in_stock"] is False and accs["ACC-BAG"]["as_low_as_cents"] is None


def test_build_unknown_fields(app_url: str) -> None:
    c = http(app_url)
    p = fresh_picks(c)
    extra = {**p, "total_cents": 1, "unit_cents": 1}
    for path in ("/api/builds/quote", "/api/builds"):
        body = err(c.post(path, json=extra), 422, "unknown_field", "This request has fields we do not accept.")
        assert body["fields"] == {"total_cents": "Unknown field.", "unit_cents": "Unknown field."}
        err(c.post(path, json={**picks("SW-52"), "board_sku": "XX-00", "spares": "1", "colour": "red"}), 422, "unknown_field",
            fields={"colour": "Unknown field."})
    assert c.get(f"/api/builds/{build_code(p)}").status_code == 404
    err(c.post("/api/builds", json={**picks("SW-52"), "price_cents": 1}), 422, "unknown_field")


BUILD_CHECKS = {
    "unknown-key-first": (("DR-49", {"board_sku": "XX-00", "spares": "1", "total_cents": 1}), "unknown_field", "total_cents", "Unknown field."),
    "unknown-board": (("DR-49", {"board_sku": "XX-00", "wing": "WNG-X"}), "unknown_board", "board_sku", "Unknown board."),
    "board-not-string": (("DR-49", {"board_sku": 49}), "unknown_board", "board_sku", "Unknown board."),
    "unknown-part": (("DR-49", {"wing": "WNG-X", "mast": "MST-CF32"}), "unknown_component", "wing", "Unknown part."),
    "part-in-wrong-slot": (("DR-49", {"battery": "MST-AL28"}), "unknown_component", "battery", "Unknown part."),
    "incompatible-before-spares": (("DR-49", {"wing": "WNG-Q150", "spares": 7}), "incompatible", "wing", "Not compatible with Drift."),
    "spares-string": (("DR-49", {"spares": "1"}), "validation_error", "spares", "Choose 0, 1 or 2 spare batteries."),
    "rider-step": (("DR-49", {"rider_kg": 82}), "validation_error", "rider_kg", "Choose a rider weight from 50 to 120 kg in steps of 5."),
    "rider-fraction": (("DR-49", {"rider_kg": 82.5}), "validation_error", "rider_kg", "Choose a rider weight from 50 to 120 kg in steps of 5."),
    "gear-boolean": (("DR-49", {"gear": True}), "validation_error", "gear", "Choose a gear from 1 to 10."),
    "gear-null": (("DR-49", {"gear": None}), "validation_error", "gear", "Choose a gear from 1 to 10."),
    "gear-before-stock": (("SW-52", {"gear": 11}), "validation_error", "gear", "Choose a gear from 1 to 10."),
    "sold-out": (("SW-52", {}), "out_of_stock", None, "This size is out of stock."),
}


BUILD_CHECK_IDS = ["unknown-key-first", "unknown-board", "board-not-string", "unknown-part", "part-in-wrong-slot", "incompatible-before-spares",
                   "spares-string", "rider-step", "rider-fraction", "gear-boolean", "gear-null", "gear-before-stock", "sold-out"]


@pytest.mark.parametrize("case", BUILD_CHECK_IDS, ids=BUILD_CHECK_IDS)
def test_build_checks_in_order(app_url: str, case: str) -> None:
    (board, mutation), code, field, message = BUILD_CHECKS[case]
    body = {**picks(board), **mutation}
    for path in ("/api/builds/quote", "/api/builds"):
        r = http(app_url).post(path, json=body)
        if field is None:
            err(r, 422, code, message)
        else:
            got = err(r, 422, code)
            assert got["fields"][field] == message
            if code in ("unknown_board", "unknown_component", "incompatible"):
                assert got["message"] == message


MALFORMED = {
    "invalid-json": (b'{"board_sku": ', "application/json", 400, "bad_request"),
    "array": (b"[1, 2]", "application/json", 400, "bad_request"),
    "string": (b'"DR-49"', "application/json", 400, "bad_request"),
    "number": (b"49", "application/json", 400, "bad_request"),
    "wrong-content-type": (b"board_sku=DR-49", "text/plain", 415, "unsupported_media_type"),
    "too-large": (None, "application/json", 413, "payload_too_large"),
    "too-large-and-wrong-type": (None, "text/plain", 413, "payload_too_large"),
    "exactly-at-limit": ("limit", "application/json", 422, "unknown_field"),
}
LEAKS = ("Traceback", "    at ", "node_modules", "/app/", "SELECT ", "<html", "<!DOCTYPE", "stack")


def padded(size: int) -> bytes:
    head = json.dumps({**picks("DR-49"), "pad": ""})
    filler = size - len(head.encode())
    return json.dumps({**picks("DR-49"), "pad": "x" * filler}).encode()


MALFORMED_IDS = ["invalid-json", "array", "string", "number", "wrong-content-type", "too-large", "too-large-and-wrong-type", "exactly-at-limit"]


@pytest.mark.parametrize("case", MALFORMED_IDS, ids=MALFORMED_IDS)
def test_malformed_bodies(app_url: str, case: str) -> None:
    raw, ctype, status, code = MALFORMED[case]
    if raw is None:
        raw = padded(BODY_LIMIT + 1)
    elif raw == "limit":
        raw = padded(BODY_LIMIT)
        assert len(raw) == BODY_LIMIT
    r = http(app_url).post("/api/builds/quote", content=raw, headers={"Content-Type": ctype})
    messages = {"bad_request": "The request body is not valid JSON.", "unsupported_media_type": "Send the request body as JSON.",
                "payload_too_large": "The request body is too large.", "unknown_field": "This request has fields we do not accept."}
    err(r, status, code, messages[code])
    assert not any(leak in r.text for leak in LEAKS)
    assert "X-Powered-By" not in r.headers


def test_cart_caps_and_strict_lines(app_url: str) -> None:
    c = http(app_url)
    cart = c.post("/api/cart/lines", json={"type": "accessory", "sku": "ACC-BAG", "quantity": CAP_ACCESSORY}).json()
    line = next(l for l in cart["lines"] if l["sku"] == "ACC-BAG")
    assert set(line) == LINE_KEYS and set(cart) == CART_KEYS
    assert line["type"] == "accessory" and line["code"] is None and line["unit_cents"] == ACCESSORIES["ACC-BAG"][1]
    assert line["line_cents"] == ACCESSORIES["ACC-BAG"][1] * CAP_ACCESSORY and cart["item_count"] == CAP_ACCESSORY

    def unchanged(r: httpx.Response, status: int, code: str, message: str | None = None, fields: dict[str, str] | None = None) -> None:
        before = c.get("/api/cart").json()
        err(r, status, code, message, fields)
        assert c.get("/api/cart").json() == before

    before = c.get("/api/cart").json()
    unchanged(c.post("/api/cart/lines", json={"type": "accessory", "sku": "ACC-BAG", "quantity": 1}), 422, "limit", "Limit 5 per order.")
    assert c.get("/api/cart").json() == before
    unchanged(c.post("/api/cart/lines", json={"type": "accessory", "sku": "ACC-CHG", "unit_cents": 1}), 422, "unknown_field", fields={"unit_cents": "Unknown field."})
    unchanged(c.post("/api/cart/lines", json={"type": "accessory", "sku": "ACC-CHG", "quantity": "2"}), 422, "validation_error")
    unchanged(c.post("/api/cart/lines", json={"type": "accessory", "sku": "ACC-CHG", "quantity": 0}), 422, "validation_error")
    unchanged(c.post("/api/cart/lines", json={"type": "accessory", "sku": "ZZ-404"}), 422, "validation_error")
    unchanged(c.post("/api/cart/lines", json={"type": "accessory", "sku": "SFB-40-18"}), 422, "out_of_stock", "Not enough stock for SFB-40-18.")
    codes = [save(c, picks("DR-54", rider=r)) for r in (50, 55, 60)]
    c.post("/api/cart/lines", json={"type": "build", "code": codes[0], "quantity": CAP_BUILD_LINE})
    unchanged(c.post("/api/cart/lines", json={"type": "build", "code": codes[0]}), 422, "limit", "Limit 2 per order.")
    c.post("/api/cart/lines", json={"type": "build", "code": codes[1]})
    unchanged(c.post("/api/cart/lines", json={"type": "build", "code": codes[2]}), 422, "limit", "Limit 3 per order.")
    unchanged(c.post("/api/cart/lines", json={"type": "build", "code": UNKNOWN_BUILD}), 422, "validation_error")
    cart = c.get("/api/cart").json()
    build_line = next(l for l in cart["lines"] if l["code"] == codes[0])
    assert build_line["type"] == "build" and build_line["sku"] == "DR-54"
    assert build_line["unit_cents"] == expected_build(picks("DR-54", rider=50))["total"]
    assert cart["item_count"] == CAP_ACCESSORY + CAP_BUILDS
    bag = next(l for l in cart["lines"] if l["sku"] == "ACC-BAG")
    unchanged(c.patch(f"/api/cart/lines/{bag['id']}", json={"quantity": CAP_ACCESSORY + 1}), 422, "limit", "Limit 5 per order.")
    after = c.patch(f"/api/cart/lines/{bag['id']}", json={"quantity": 0})
    assert after.status_code == 200 and all(l["sku"] != "ACC-BAG" for l in after.json()["lines"])
    gone = c.delete(f"/api/cart/lines/{build_line['id']}")
    assert gone.status_code == 200 and all(l["code"] != codes[0] for l in gone.json()["lines"])


def test_discount_codes(app_url: str) -> None:
    c = http(app_url)
    add_acc(c, "ACC-CHG", 2)
    acc = ACCESSORIES["ACC-CHG"][1] * 2
    r = c.post("/api/cart/codes", json={"code": "flyfirst"})
    assert r.status_code == 200
    assert [(x["code"].upper(), x["amount_cents"]) for x in r.json()["codes"]] == [("FLYFIRST", code_amounts(["FLYFIRST"], acc)[0])]
    before = c.get("/api/cart").json()
    err(c.post("/api/cart/codes", json={"code": "FLYFIRST"}), 409, "code_already_applied", "This code is already applied.")
    err(c.post("/api/cart/codes", json={"code": "NOPE10"}), 422, "invalid_code", "This code is not valid.")
    assert c.get("/api/cart").json() == before
    r = c.post("/api/cart/codes", json={"code": "CHARGE25"})
    assert [x["amount_cents"] for x in r.json()["codes"]] == code_amounts(["FLYFIRST", "CHARGE25"], acc)
    before = c.get("/api/cart").json()
    again = c.post("/api/cart/codes", json={"code": "charge25"})
    assert (again.status_code, again.json()["error"]) in {(422, "too_many_codes"), (409, "code_already_applied")}, again.text
    assert c.get("/api/cart").json() == before
    add_build(c, picks("DR-49"))
    cart = c.get("/api/cart").json()
    assert cart["accessory_subtotal_cents"] == acc
    assert [x["amount_cents"] for x in cart["codes"]] == code_amounts(["FLYFIRST", "CHARGE25"], acc)
    assert cart["financing"] == financing(cart["subtotal_cents"] - sum(code_amounts(["FLYFIRST", "CHARGE25"], acc)))
    chg = next(l for l in cart["lines"] if l["sku"] == "ACC-CHG")
    cart = c.delete(f"/api/cart/lines/{chg['id']}").json()
    assert [(x["code"].upper(), x["amount_cents"]) for x in cart["codes"]] == [("FLYFIRST", 0), ("CHARGE25", 0)]
    dropped = "CHARGE25"
    cart = c.delete(f"/api/cart/codes/{dropped}").json()
    assert [x["code"].upper() for x in cart["codes"]] == ["FLYFIRST"]


def test_guest_cart_merge(app_url: str) -> None:
    owner = signup(app_url, "merge")
    x = add_build(owner, picks("DR-49", rider=65))
    owner.c.post("/api/auth/logout")
    guest = http(app_url)
    add_build(guest, picks("DR-49", rider=65), 1)
    y = add_build(guest, picks("DR-49", rider=70), 2)
    guest.post("/api/cart/codes", json={"code": "FLYFIRST"})
    add_acc(guest, "ACC-CHG")
    guest_only = http(app_url, cookie_header(guest))
    assert guest_only.get("/api/cart").json()["item_count"] == 4
    second = login(app_url, owner.email, PASSWORD)
    r = guest.post("/api/auth/login", json={"email": owner.email, "password": PASSWORD})
    assert r.status_code == 200
    merged = guest.get("/api/cart").json()
    qty = {l["code"] or l["sku"]: l["quantity"] for l in merged["lines"]}
    assert qty[x] == CAP_BUILD_LINE and qty[y] == 1 and qty["ACC-CHG"] == 1
    assert [cd["code"].upper() for cd in merged["codes"]] == ["FLYFIRST"]
    assert merged["codes"][0]["amount_cents"] == code_amounts(["FLYFIRST"], ACCESSORIES["ACC-CHG"][1])[0]
    assert second.get("/api/cart").json() == merged
    assert guest_only.get("/api/cart").json()["lines"] == []


def test_shared_cart_links(app_url: str) -> None:
    owner = http(app_url)
    add_acc(owner, "ACC-CHG", 2)
    reader = http(app_url)
    with server_clock(app_url) as clock:
        t0 = clock("2031-04-01T10:00:00Z")
        first = owner.post("/api/cart/share")
        second = owner.post("/api/cart/share")
        assert first.status_code == 201 and second.status_code == 201
        token, other = first.json()["token"], second.json()["token"]
        assert token != other
        for t in (token, other):
            assert re.fullmatch(r"[A-Za-z0-9_-]{22,}", t)
        expires = first.json()["expires_at"]
        assert near(expires, shift(t0, SHARE_TTL))
        clock(shift(expires, -1))
        read = reader.get(f"/api/cart/shared/{token}")
        assert read.status_code == 200
        assert set(read.json()) == {"lines", "expires_at"}
        assert all(set(l) == SNAPSHOT_KEYS for l in read.json()["lines"])
        assert [(l["sku"], l["quantity"]) for l in read.json()["lines"]] == [("ACC-CHG", 2)]
        for resp in (read, reader.get(f"/cart/shared/{token}")):
            assert resp.headers.get("Referrer-Policy") == "no-referrer"
            assert "no-store" in resp.headers.get("Cache-Control", "")
            assert "noindex" in resp.headers.get("X-Robots-Tag", "")
        clock(expires)
        expired = reader.get(f"/api/cart/shared/{token}")
        unknown = reader.get(f"/api/cart/shared/{UNKNOWN_TOKEN}")
        before = reader.get("/api/cart").json()
        imported = reader.post(f"/api/cart/shared/{token}/import")
        for resp in (expired, unknown, imported):
            err(resp, 404, "not_found", "Not found.")
        assert expired.content == unknown.content == imported.content
        assert reader.get("/api/cart").json() == before
        clock(t0)
        ok = reader.post(f"/api/cart/shared/{other}/import")
        assert ok.status_code == 200 and [(l["sku"], l["quantity"]) for l in ok.json()["lines"]] == [("ACC-CHG", 2)]


def test_financing_terms(app_url: str) -> None:
    quote = http(app_url).post("/api/builds/quote", json=picks("DR-49")).json()
    terms = {t["months"]: t for t in quote["financing"]}
    assert all(set(t) == TERM_KEYS for t in quote["financing"])
    assert quote["financing"] == financing(FIN_EXAMPLE_A)
    assert (terms[12]["monthly_cents"], terms[12]["last_cents"]) == FIN_EXAMPLE_12
    assert (terms[6]["monthly_cents"], terms[6]["last_cents"]) == FIN_EXAMPLE_6
    c = http(app_url)
    cart = add_acc(c, "ACC-BAG", 2)
    assert cart["subtotal_cents"] < FIN_MINIMUM and cart["financing"] == []
    cart = add_acc(c, "ACC-CHG")
    assert cart["financing"] == financing(cart["subtotal_cents"])
    who = signup(app_url, "finance")
    add_acc(who, "ACC-FLOAT")
    ca = checkout_quote(who, "CA", "M5V 2T6").json()
    assert [t["months"] for t in ca["financing"]] == [12, 24] and ca["financing"] == financing(ca["total_cents"], "CA")
    us = checkout_quote(who, "US").json()
    assert us["financing"] == financing(us["total_cents"], "US")


CHECKOUT_CASES = {
    "us-chargers-flyfirst": ([("acc", "ACC-CHG", 2)], ["FLYFIRST"], "US", None, (71820, 1500, 0, 5207, 78527)),
    "ca-ontario-build": ([("build", CR52_EXAMPLE, 1)], [], "CA", "M5V 2T6", (1889800, 39900, 3500, 245674, 2178874)),
    "ca-quebec-float": ([("acc", "ACC-FLOAT", 1)], ["FLYFIRST"], "CA", "H2X 1Y4", (116910, 3500, 0, 17508, 137918)),
    "au-standalone-batteries": ([("acc", "BAT-10", 2)], [], "AU", None, (499800, 6500, 25000, 49980, 581280)),
    "pr-packed-spares": ([("build", picks("DR-49", spares=2), 2)], [], "PR", None, None),
    "us-free-accessory-shipping": ([("acc", "ACC-FLOAT", 1)], [], "US", None, None),
    "unsupported-country": ([("acc", "ACC-BAG", 1)], [], "GB", None, None),
}
PR_PACKED_DG = 22000


CHECKOUT_IDS = ["us-chargers-flyfirst", "ca-ontario-build", "ca-quebec-float", "au-standalone-batteries", "pr-packed-spares",
                "us-free-accessory-shipping", "unsupported-country"]


@pytest.mark.parametrize("case", CHECKOUT_IDS, ids=CHECKOUT_IDS)
def test_checkout_totals(app_url: str, case: str) -> None:
    lines, codes, country, postal, literal = CHECKOUT_CASES[case]
    who = signup(app_url, "totals")
    for kind, item, qty in lines:
        add_build(who, item, qty) if kind == "build" else add_acc(who, item, qty)
    for code in codes:
        who.c.post("/api/cart/codes", json={"code": code})
    if country == "GB":
        err(checkout_quote(who, country), 422, "unsupported_country", "We do not ship to this country yet.")
        err(place(who, country), 422, "unsupported_country")
        return
    q = checkout_quote(who, country, postal)
    assert q.status_code == 200, q.text
    body = q.json()
    assert set(body) == BREAKDOWN_KEYS
    want = expected_checkout(lines, codes, country, postal)
    got = (body["taxable_cents"], body["shipping_cents"], body["dangerous_goods_cents"], body["tax_cents"], body["total_cents"])
    assert got == (want["taxable"], want["shipping"], want["dg"], want["tax"], want["total"])
    if literal:
        assert got == literal
    if case == "pr-packed-spares":
        assert body["dangerous_goods_cents"] == PR_PACKED_DG
    assert (body["packed_batteries"], body["standalone_batteries"], body["free_shipping"]) == (want["packed"], want["alone"], want["free"])
    assert [(t["name"], t["rate_pcm"], t["amount_cents"]) for t in body["taxes"]] == want["taxes"]
    assert all(set(t) == TAX_KEYS for t in body["taxes"])
    order = placed(who, country, postal or US_POSTAL)
    try:
        for k in ("taxable_cents", "shipping_cents", "packed_batteries", "standalone_batteries", "dangerous_goods_cents", "taxes", "tax_cents", "total_cents"):
            assert order[k] == body[k], k
    finally:
        cancel_quietly(who, [order["number"]])


PROVINCE_CASES = {
    "A-newfoundland": "A1A 1A1", "B-nova-scotia": "B3H 1A1", "K-ontario": "K1A 0B1", "G-quebec": "G1R 4P5",
    "V-british-columbia": "V6B 1A1", "S-saskatchewan": "S4P 3Y2", "T-alberta": "T2P 1J9", "lowercase-no-space": "m5v2t6",
    "forbidden-first-letter": "D1A 1A1", "missing": None,
}


PROVINCE_IDS = ["A-newfoundland", "B-nova-scotia", "K-ontario", "G-quebec", "V-british-columbia", "S-saskatchewan", "T-alberta",
                "lowercase-no-space", "forbidden-first-letter", "missing"]


@pytest.mark.parametrize("case", PROVINCE_IDS, ids=PROVINCE_IDS)
def test_canadian_tax_by_postal_code(app_url: str, case: str) -> None:
    postal = PROVINCE_CASES[case]
    who = signup(app_url, "province")
    add_acc(who, "ACC-CHG")
    r = checkout_quote(who, "CA", postal)
    if case in ("forbidden-first-letter", "missing"):
        body = err(r, 422, "validation_error")
        assert "Enter a valid Canadian postal code." in body["fields"].values()
        return
    assert r.status_code == 200, r.text
    taxable = ACCESSORIES["ACC-CHG"][1]
    want = [(n, rate, rhu(Fraction(taxable * rate, TAX_DIVISOR))) for n, rate in PROVINCES[postal[0].upper()]]
    assert [(t["name"], t["rate_pcm"], t["amount_cents"]) for t in r.json()["taxes"]] == want
    assert r.json()["tax_cents"] == sum(a for _, _, a in want)


def test_protection_plans(app_url: str) -> None:
    who = signup(app_url, "protect")
    add_build(who, picks("DR-49"))
    add_build(who, picks("DR-54"))
    add_acc(who, "ACC-BAG")
    with server_clock(app_url) as clock:
        clock("2031-03-10T10:00:00Z")
        order = placed(who)
        n, placed_at = order["number"], order["placed_at"]
        try:
            lines = {l["sku"]: l for l in order["lines"]}
            url = f"/api/orders/{n}/protection"
            err(who.c.post(url, json={"line_id": lines["DR-49"]["id"], "term_years": 4}), 422, "validation_error")
            err(who.c.post(url, json={"line_id": lines["ACC-BAG"]["id"], "term_years": 2}), 422, "not_eligible", "Protection is available for boards only.")
            clock(shift(placed_at, PROTECT_WINDOW - 1))
            for sku, term in (("DR-49", 3), ("DR-54", 2)):
                r = who.c.post(url, json={"line_id": lines[sku]["id"], "term_years": term})
                assert r.status_code == 201, r.text
                plan = r.json()
                assert set(plan) == PLAN_KEYS and plan["price_cents"] == PROTECT_PRICES[term]
                assert plan["tax_cents"] == sum(rhu(Fraction(PROTECT_PRICES[term] * t["rate_pcm"], TAX_DIVISOR)) for t in order["taxes"])
                start = parse_iso(placed_at)
                assert str(plan["protected_until"]).startswith(f"{start.year + term}-{start:%m-%d}")
            err(who.c.post(url, json={"line_id": lines["DR-49"]["id"], "term_years": 2}), 409, "already_protected", "This board is already protected.")
            clock(shift(placed_at, PROTECT_WINDOW))
            err(who.c.post(url, json={"line_id": lines["DR-49"]["id"], "term_years": 2}), 422, "window_closed", "Protection can be added within 30 days of your order.")
            assert all(l["protected_until"] for l in who.c.get(f"/api/orders/{n}").json()["lines"] if l["type"] == "build")
            assert who.c.post(f"/api/orders/{n}/cancel").status_code == 200
            assert all(l["protected_until"] is None for l in who.c.get(f"/api/orders/{n}").json()["lines"])
            clock(shift(placed_at, 60))
            err(who.c.post(url, json={"line_id": lines["DR-49"]["id"], "term_years": 2}), 409, "illegal_transition", "This order cannot be changed now.")
        finally:
            cancel_quietly(who, [n])


def test_shipping_and_not_found_pages(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/shipping") as page:
        shows(page, "Spare batteries ship at 30% charge or less.")
        body = page_text(page)
        for col in ("Board shipping", "Accessory shipping", "Free accessory shipping from", "Dangerous goods fee per spare packed with a board",
                    "Dangerous goods fee per spare shipped alone", "Arrives in", "Postal code starts with", "Province or territory"):
            assert col in body
        for code, c in COUNTRIES.items():
            assert c["name"] in body and money(c["accessory"]) in body and money(c["packed"]) in body and money(c["alone"]) in body
            assert f"{c['transit']} business days" in body
        assert money(COUNTRIES["US"]["free_from"]) in body and "Not offered" in body and "By province" in body
        rates = {r for c in COUNTRIES.values() for _, r in (c["taxes"] or [])} | {r for comps in PROVINCES.values() for _, r in comps}
        for rate in rates:
            assert pct(rate) in body, rate
        for province in ("Ontario", "Quebec", "Nova Scotia", "Saskatchewan", "Alberta", "Yukon"):
            assert province in body
        r = http(app_url).get(UNKNOWN_PAGE)
        assert r.status_code == 404
        page.goto(app_url + UNKNOWN_PAGE)
        shows(page, "Page not found")
        assert page.get_by_role("link", name="Back to home").is_visible()


def test_idempotent_order_placement(app_url: str, mail: Any) -> None:
    who = signup(app_url, "idem")
    add_acc(who, "ACC-BAG")
    body = order_body(who)
    err(who.c.post("/api/orders", json=body), 400, "idempotency_key_required", "Send an Idempotency-Key header of 8 to 64 characters.")
    err(who.c.post("/api/orders", json=body, headers={"Idempotency-Key": "abc"}), 400, "idempotency_key_required")
    key = idempotency_key()
    err(who.c.post("/api/orders", json={**body, "country": "GB"}, headers={"Idempotency-Key": key}), 422, "unsupported_country")
    clients = [http(app_url, cookie_header(who.c)) for _ in range(4)]
    results = together([lambda c=c: c.post("/api/orders", json=body, headers={"Idempotency-Key": key}) for c in clients])
    created = [r for r in results if r.status_code == 201]
    assert len(created) == 1
    for r in results:
        if r.status_code == 409:
            err(r, 409, "idempotency_in_progress", "This order is still being placed. Retry with the same key.")
        else:
            assert r.status_code in (200, 201)
    n = created[0].json()["number"]
    try:
        reordered = {"use_demo_credit": False, "address": dict(reversed(list(body["address"].items()))), "use_trade_in": False, "country": "US"}
        replay = who.c.post("/api/orders", json=reordered, headers={"Idempotency-Key": key})
        assert replay.status_code == 200 and replay.json()["number"] == n
        err(who.c.post("/api/orders", json={**body, "country": "PR"}, headers={"Idempotency-Key": key}), 409, "idempotency_conflict",
            "This key was already used for a different order.")
        assert [o["number"] for o in who.c.get("/api/orders").json()["orders"]] == [n]
        confirmations = [m for m in quiet_mail_to(mail, who.email) if m.get("Subject") == f"Order confirmed: {n}"]
        assert len(confirmations) == 1
    finally:
        cancel_quietly(who, [n])


def test_killbill_account_per_customer(app_url: str, killbill: Any) -> None:
    who = signup(app_url, "billing")
    numbers = []
    try:
        add_acc(who, "ACC-BAG")
        key = idempotency_key()
        first = place(who, key=key).json()
        numbers.append(first["number"])
        account = killbill.account_by_key("tern-" + who.email)
        assert account is not None
        aid = account["accountId"]
        assert account.get("currency") == "USD" and account.get("email") == who.email and account.get("country") == "US"
        assert account.get("name") == who.name
        assert first["billing_account_key"] == "tern-" + who.email and first["billing_invoice_id"]
        assert first["dangerous_goods_cents"] == 0
        inv = assert_invoice(first)
        assert len(kb_items(inv, "EXTERNAL_CHARGE")) == 3
        assert len(kb_order_invoices(aid, first["number"])) == 1
        invoices_before = len(kb_account_invoices(aid))
        assert place(who, key=key).status_code == 200
        assert len(kb_account_invoices(aid)) == invoices_before
        assert len(kb_order_invoices(aid, first["number"])) == 1
        add_acc(who, "ACC-CHG")
        second = placed(who, "PR")
        numbers.append(second["number"])
        assert second["billing_invoice_id"] != first["billing_invoice_id"]
        assert_invoice(second)
        assert len(kb_order_invoices(aid, second["number"])) == 1
        assert len(kb_account_invoices(aid)) == invoices_before + 1
        assert kb_balance(aid) == first["total_cents"] + second["total_cents"]
        again = killbill.account(who.email)
        assert again is not None and again.get("accountId") == aid
    finally:
        cancel_quietly(who, numbers)


def test_billing_outage_refuses_order(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    first_who = signup(app_url, "before")
    add_acc(first_who, "ACC-BAG")
    first = placed(first_who)
    who = signup(down, "outage")
    add_acc(who, "ACC-CHG")
    stock_before = catalog(app_url)["ACC-CHG"]["stock"]
    key = idempotency_key()
    after = None
    try:
        err(place(who, key=key), 503, "billing_unavailable", "Billing is unavailable. Your order was not placed.")
        assert [l["sku"] for l in who.c.get("/api/cart").json()["lines"]] == ["ACC-CHG"]
        assert catalog(app_url)["ACC-CHG"]["stock"] == stock_before
        assert who.c.get("/api/orders").json()["orders"] == []
        assert killbill.account_by_key("tern-" + who.email) is None
        with browse(browser, down, "/login") as page:
            sign_in_page(page, down, who.email, PASSWORD)
            page.goto(down + "/checkout")
            fill_checkout(page, who, "US", US_POSTAL)
            click(page.get_by_role("button", name="Place order"))
            wait_for(page, lambda: page.get_by_role("alert").filter(has_text="Billing is unavailable. Your order was not placed.").first.is_visible())
        assert quiet_mail_to(mail, who.email) == []
        retry = elsewhere(app_url, who)
        r = place(retry, key=key)
        assert r.status_code == 201, r.text
        after = r.json()["number"]
        assert number_of(after) == number_of(first["number"]) + 1
    finally:
        cancel_quietly(first_who, [first["number"]])
        if after:
            cancel_quietly(elsewhere(app_url, who), [after])


def test_cancellation_and_billing_outage(app_url: str, killbill: Any) -> None:
    who = signup(app_url, "cancel")
    add_acc(who, "ACC-BAG")
    first = placed(who)
    add_acc(who, "ACC-CHG")
    kept = placed(who)
    n = first["number"]
    try:
        aid = killbill.account_by_key("tern-" + who.email)["accountId"]
        assert kb_balance(aid) == first["total_cents"] + kept["total_cents"]
        down = elsewhere(os.environ["APP_KILLBILL_DOWN_URL"], who)
        err(down.c.post(f"/api/orders/{n}/cancel"), 503, "billing_unavailable", "Billing is unavailable. Your order was not cancelled.")
        assert who.c.get(f"/api/orders/{n}").json()["status"] == "placed"
        assert kb_items(kb_invoice(first["billing_invoice_id"]), "ITEM_ADJ") == []
        r = who.c.post(f"/api/orders/{n}/cancel")
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        assert r.json()["events"][-1]["status"] == "cancelled" and r.json()["events"][-1]["by"] == who.email
        inv = kb_invoice(first["billing_invoice_id"])
        charges, adjustments = kb_items(inv, "EXTERNAL_CHARGE"), kb_items(inv, "ITEM_ADJ")
        assert charges and len(adjustments) == len(charges)
        for charge in charges:
            linked = [a for a in adjustments if a.get("linkedInvoiceItemId") == charge["invoiceItemId"]]
            assert len(linked) == 1 and kb_cents(linked[0]["amount"]) == -kb_cents(charge["amount"])
        assert kb_attributed(inv, KB_CANCELLED, n), kb_logs(inv)
        assert kb_balance(aid) == kept["total_cents"]
        err(who.c.post(f"/api/orders/{n}/cancel"), 409, "illegal_transition")
        assert len(kb_items(kb_invoice(first["billing_invoice_id"]), "ITEM_ADJ")) == len(charges)
    finally:
        cancel_quietly(who, [kept["number"]])
    assert kb_balance(aid) == 0


def test_gap_free_order_numbers(app_url: str) -> None:
    a = signup(app_url, "gap")
    add_acc(a, "ACC-BAG")
    n1 = placed(a)["number"]
    racers = [signup(app_url, "gaprace") for _ in range(3)]
    numbers = [n1]
    try:
        assert number_of(n1) >= FIRST_ORDER
        err(place(a), 422, "empty_cart", "Your cart is empty.")
        for r in racers:
            add_acc(r, "ACC-BAG")
        err(place(racers[0], "GB"), 422, "unsupported_country")
        bad = order_body(racers[0])
        bad["address"]["phone"] = "12"
        err(racers[0].c.post("/api/orders", json=bad, headers={"Idempotency-Key": idempotency_key()}), 422, "validation_error")
        results = together([lambda w=w: place(w) for w in racers])
        assert all(r.status_code == 201 for r in results)
        numbers += [r.json()["number"] for r in results]
        ints = sorted(number_of(n) for n in numbers)
        assert ints == list(range(ints[0], ints[0] + len(ints)))
    finally:
        cancel_quietly(a, [n1])
        for w, n in zip(racers, numbers[1:]):
            cancel_quietly(w, [n])


def test_order_events_attributed(app_url: str) -> None:
    who = signup(app_url, "events")
    add_acc(who, "ACC-BAG")
    order = placed(who)
    n = order["number"]
    assert set(order) == ORDER_KEYS and all(set(l) == ORDER_LINE_KEYS for l in order["lines"])
    assert [(e["status"], e["by"]) for e in order["events"]] == [("placed", who.email)]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", order["events"][0]["at"])
    admin = staff(app_url, "admin")
    assert admin.c.post(f"/api/staff/orders/{n}/ship").status_code == 200
    events = who.c.get(f"/api/orders/{n}").json()["events"]
    assert events[0] == order["events"][0]
    assert [(e["status"], e["by"]) for e in events] == [("placed", who.email), ("shipped", STAFF["admin"][0])]
    for method in ("DELETE", "PATCH", "PUT"):
        r = who.c.request(method, f"/api/orders/{n}", json={})
        assert r.status_code == 405 and r.headers.get("allow") == "GET"
    track = http(app_url).post("/api/track", json={"order_number": n, "email": who.email}).json()
    assert [set(e) for e in track["events"]] == [{"status", "at"}, {"status", "at"}]


SHIP_CASES = {
    "de-before-cutoff": (DE_BEFORE, "DE"),
    "de-at-cutoff": (DE_AT, "DE"),
    "us-after-cutoff-holiday": ("2026-11-10T19:00:00Z", "US"),
    "fr-friday-holiday": ("2026-11-06T14:00:00Z", "FR"),
    "au-christmas-eve": ("2026-12-24T20:00:00Z", "AU"),
}


SHIP_IDS = ["de-before-cutoff", "de-at-cutoff", "us-after-cutoff-holiday", "fr-friday-holiday", "au-christmas-eve"]


@pytest.mark.parametrize("case", SHIP_IDS, ids=SHIP_IDS)
def test_ship_by_dates(app_url: str, case: str) -> None:
    instant, country = SHIP_CASES[case]
    who = signup(app_url, "shipby")
    add_acc(who, "ACC-BAG")
    ships, arrives = ship_dates(instant, country)
    short = lambda d: f"{date.fromisoformat(d):%a} {date.fromisoformat(d).day} {date.fromisoformat(d):%b}"
    if case == "de-before-cutoff":
        assert (short(ships), short(arrives)) == ("Mon 26 Oct", "Thu 29 Oct")
    if case == "de-at-cutoff":
        assert (short(ships), short(arrives)) == ("Tue 27 Oct", "Fri 30 Oct")
    with server_clock(app_url) as clock:
        clock(instant)
        q = checkout_quote(who, country).json()
        assert (q["ships_on"], q["arrives_on"]) == (ships, arrives)
        key = idempotency_key()
        order = place(who, country, key=key).json()
        try:
            assert (order["ships_on"], order["arrives_on"]) == (ships, arrives)
            clock(shift(instant, 7 * 86400))
            replay = place(who, country, key=key)
            assert replay.status_code == 200 and (replay.json()["ships_on"], replay.json()["arrives_on"]) == (ships, arrives)
        finally:
            cancel_quietly(who, [order["number"]])


def test_last_unit_race(app_url: str) -> None:
    assert catalog(app_url)["CR-58"]["stock"] == BOARDS["CR-58"]["stock"]
    racers = [signup(app_url, "lastunit") for _ in range(4)]
    for w in racers:
        add_build(w, picks("CR-58"))
    results = together([lambda w=w: place(w) for w in racers])
    winners = [(w, r) for w, r in zip(racers, results) if r.status_code == 201]
    try:
        assert len(winners) == 1
        for r in results:
            if r.status_code != 201:
                err(r, 409, "out_of_stock", "CR-58 is out of stock.")
        item = catalog(app_url)["CR-58"]
        assert item["stock"] == 0 and item["in_stock"] is False
    finally:
        for w, r in winners:
            cancel_quietly(w, [r.json()["number"]])
    assert catalog(app_url)["CR-58"]["stock"] == BOARDS["CR-58"]["stock"]


def test_stock_conservation(browser: Any, app_url: str) -> None:
    before = catalog(app_url)
    b43, b48 = before["SW-43"]["stock"], before["SW-48"]["stock"]
    assert b43 >= 1 and b48 >= 1
    racers = [signup(app_url, "conserve") for _ in range(4)]
    for i, w in enumerate(racers):
        order = (picks("SW-43"), picks("SW-48")) if i % 2 else (picks("SW-48"), picks("SW-43"))
        for p in order:
            add_build(w, p)
    with browse(browser, app_url, "/boards") as page:
        shows(page, "Out of Stock")
        badges_before = out_of_stock_badges(page)
        results = together([lambda w=w: place(w) for w in racers])
        winners = [(w, r.json()["number"]) for w, r in zip(racers, results) if r.status_code == 201]
        try:
            for r in results:
                assert r.status_code in (201, 409)
                if r.status_code == 409:
                    assert r.json()["error"] == "out_of_stock"
            assert len(winners) == min(b43, b48, len(racers))
            after = catalog(app_url)
            assert after["SW-43"]["stock"] == b43 - len(winners) and after["SW-48"]["stock"] == b48 - len(winners)
            sold_out = [s for s in ("SW-43", "SW-48") if after[s]["stock"] == 0]
            for s in sold_out:
                assert after[s]["in_stock"] is False
                err(http(app_url).post("/api/builds/quote", json=picks(s)), 422, "out_of_stock", "This size is out of stock.")
            page.reload()
            wait_for(page, lambda: out_of_stock_badges(page) == badges_before + len(sold_out))
        finally:
            for w, n in winners:
                cancel_quietly(w, [n])
        restored = catalog(app_url)
        assert restored["SW-43"]["stock"] == b43 and restored["SW-48"]["stock"] == b48 and restored["SW-43"]["in_stock"]
        assert http(app_url).post("/api/builds/quote", json=picks("SW-43")).status_code == 200
        page.reload()
        wait_for(page, lambda: out_of_stock_badges(page) == badges_before)


def test_order_lifecycle(app_url: str) -> None:
    who = signup(app_url, "lifecycle")
    admin = staff(app_url, "admin")
    add_acc(who, "ACC-BAG")
    n = placed(who)["number"]
    msg = "This order cannot be changed now."
    err(admin.c.post(f"/api/staff/orders/{n}/deliver"), 409, "illegal_transition", msg)
    err(who.c.post(f"/api/staff/orders/{n}/ship"), 403, "forbidden")
    assert admin.c.post(f"/api/staff/orders/{n}/ship").json()["status"] == "shipped"
    err(admin.c.post(f"/api/staff/orders/{n}/ship"), 409, "illegal_transition", msg)
    err(who.c.post(f"/api/orders/{n}/cancel"), 409, "illegal_transition", msg)
    assert admin.c.post(f"/api/staff/orders/{n}/deliver").json()["status"] == "delivered"
    for path in (f"/api/staff/orders/{n}/ship", f"/api/staff/orders/{n}/deliver"):
        err(admin.c.post(path), 409, "illegal_transition", msg)
    err(who.c.post(f"/api/orders/{n}/cancel"), 409, "illegal_transition", msg)
    stock = catalog(app_url)["ACC-CHG"]["stock"]
    add_acc(who, "ACC-CHG", 2)
    m = placed(who)["number"]
    assert catalog(app_url)["ACC-CHG"]["stock"] == stock - 2
    assert who.c.post(f"/api/orders/{m}/cancel").json()["status"] == "cancelled"
    assert catalog(app_url)["ACC-CHG"]["stock"] == stock
    err(admin.c.post(f"/api/staff/orders/{m}/ship"), 409, "illegal_transition", msg)


def test_order_list_pages(app_url: str) -> None:
    who = signup(app_url, "pages")
    numbers = []
    try:
        for _ in range(3):
            add_acc(who, "ACC-BAG")
            numbers.append(placed(who)["number"])
        p1 = who.c.get("/api/orders", params={"limit": 1}).json()
        assert [o["number"] for o in p1["orders"]] == [numbers[2]] and isinstance(p1["next_cursor"], str)
        add_acc(who, "ACC-BAG")
        numbers.append(placed(who)["number"])
        p2 = who.c.get("/api/orders", params={"limit": 1, "cursor": p1["next_cursor"]}).json()
        assert [o["number"] for o in p2["orders"]] == [numbers[1]]
        who.c.post(f"/api/orders/{numbers[1]}/cancel")
        p3 = who.c.get("/api/orders", params={"limit": 1, "cursor": p2["next_cursor"]}).json()
        assert [o["number"] for o in p3["orders"]] == [numbers[0]]
        if p3["next_cursor"] is not None:
            assert who.c.get("/api/orders", params={"limit": 1, "cursor": p3["next_cursor"]}).json()["orders"] == []
        full = who.c.get("/api/orders").json()
        assert [o["number"] for o in full["orders"]] == [numbers[3], numbers[2], numbers[1], numbers[0]] and full["next_cursor"] is None
        for bad in (0, ORDER_LIMIT_MAX + 1, "x", "2.5"):
            err(who.c.get("/api/orders", params={"limit": bad}), 422, "validation_error", fields={"limit": "Choose 1 to 50."})
        cursor = p1["next_cursor"]
        mid = len(cursor) // 2
        altered = cursor[:mid] + ("A" if cursor[mid] != "A" else "B") + cursor[mid + 1:]
        for bad in ("garbage", altered):
            err(who.c.get("/api/orders", params={"cursor": bad}), 422, "validation_error", fields={"cursor": "This page link is invalid."})
        admin = staff(app_url, "admin")
        seen, cursor, page_no = [], None, 0
        while True:
            params = {"limit": ORDER_LIMIT_MAX} | ({"cursor": cursor} if cursor else {})
            body = admin.c.get("/api/staff/orders", params=params).json()
            assert len(body["orders"]) <= ORDER_LIMIT_MAX
            seen += [o["number"] for o in body["orders"]]
            if page_no == 0:
                add_acc(who, "ACC-BAG")
                numbers.append(placed(who)["number"])
            page_no += 1
            cursor = body["next_cursor"]
            if cursor is None:
                break
        assert len(seen) == len(set(seen))
        assert all(seen.count(n) == 1 for n in numbers[:4])
        assert seen == sorted(seen, reverse=True)
    finally:
        cancel_quietly(who, numbers)


def delivered_order(base: str, who: Who, lines: list[tuple[str, Any, int]], deliver_at: str | None = None) -> dict[str, Any]:
    for kind, item, qty in lines:
        add_build(who, item, qty) if kind == "build" else add_acc(who, item, qty)
    order = placed(who)
    admin = staff(base, "admin")
    assert admin.c.post(f"/api/staff/orders/{order['number']}/ship").status_code == 200
    if deliver_at:
        with server_clock(base) as clock:
            clock(deliver_at)
            assert admin.c.post(f"/api/staff/orders/{order['number']}/deliver").status_code == 200
    else:
        assert admin.c.post(f"/api/staff/orders/{order['number']}/deliver").status_code == 200
    return order


def test_board_registration_and_warranty(app_url: str) -> None:
    who = signup(app_url, "register")
    other = signup(app_url, "newowner")
    add_build(who, picks("DR-54"), 2)
    add_acc(who, "ACC-BAG")
    order = placed(who)
    n = order["number"]
    lines = {l["type"]: l for l in order["lines"]}
    reg = lambda w, line, serial: w.c.post("/api/registrations", json={"order_number": n, "line_id": line, "serial": serial})
    err(reg(who, lines["build"]["id"], luhn_serial()), 409, "not_delivered", "Boards can be registered once the order is delivered.")
    err(reg(who, lines["build"]["id"], "TF123456780"), 422, "validation_error", fields={"serial": "Enter the serial from the deck plate, like TF123456782."})
    err(reg(who, "x", luhn_serial()), 422, "validation_error", fields={"line_id": "Choose a board."})
    admin = staff(app_url, "admin")
    admin.c.post(f"/api/staff/orders/{n}/ship")
    with server_clock(app_url) as clock:
        clock(DELIVERED_AT)
        assert admin.c.post(f"/api/staff/orders/{n}/deliver").status_code == 200
        err(reg(who, lines["accessory"]["id"], luhn_serial()), 422, "not_eligible", "Only boards can be registered.")
        err(reg(other, lines["build"]["id"], luhn_serial()), 404, "not_found")
        s1 = luhn_serial()
        results = together([lambda: reg(who, lines["build"]["id"], s1) for _ in range(3)])
        assert sorted(r.status_code for r in results) == [201, 409, 409]
        for r in results:
            if r.status_code == 409:
                err(r, 409, "already_registered", "This board is already registered.")
        first = next(r.json() for r in results if r.status_code == 201)
        assert set(first) == REGISTRATION_KEYS and first["country"] == "US" and first["order_number"] == n
        assert first["board_warranty_ends_on"] == BOARD_WARRANTY_END
        assert first["battery_warranty_ends_on"] == add_months(date.fromisoformat(WARRANTY_START), BATTERY_MONTHS).isoformat()
        s2, s3 = luhn_serial(), luhn_serial()
        results = together([lambda s=s: reg(who, lines["build"]["id"], s) for s in (s2, s3)])
        assert sorted(r.status_code for r in results) == [201, 409]
        err(next(r for r in results if r.status_code == 409), 409, "nothing_to_register", "Every board on this line is already registered.")
        battery_end = date.fromisoformat(first["battery_warranty_ends_on"])
        for instant, board_days in ((DAYS_365_AT, 365), (DAYS_364_AT, 364)):
            clock(instant)
            mine = {x["serial"]: x for x in who.c.get("/api/registrations/mine").json()["registrations"]}
            today = parse_iso(instant).astimezone(ZoneInfo(COUNTRY_ZONES["US"])).date()
            assert mine[s1]["board_days_left"] == board_days
            assert mine[s1]["battery_days_left"] == (battery_end - today).days
    message = "Enter the email of another Tern Foils customer."
    err(who.c.post(f"/api/registrations/{s1}/transfer", json={"email": who.email}), 422, "validation_error", fields={"email": message})
    err(who.c.post(f"/api/registrations/{s1}/transfer", json={"email": "nobody-" + other.email}), 422, "validation_error", fields={"email": message})
    err(other.c.post(f"/api/registrations/{s1}/transfer", json={"email": other.email}), 404, "not_found")
    moved = who.c.post(f"/api/registrations/{s1}/transfer", json={"email": other.email})
    assert moved.status_code == 200
    assert (moved.json()["board_warranty_ends_on"], moved.json()["battery_warranty_ends_on"], moved.json()["country"]) == (
        first["board_warranty_ends_on"], first["battery_warranty_ends_on"], "US")
    assert s1 not in [x["serial"] for x in who.c.get("/api/registrations/mine").json()["registrations"]]
    assert s1 in [x["serial"] for x in other.c.get("/api/registrations/mine").json()["registrations"]]


def test_registered_boards_on_account(browser: Any, app_url: str) -> None:
    who = signup(app_url, "acctboard")
    other = signup(app_url, "acctnew")
    order = delivered_order(app_url, who, [("build", picks("DR-49"), 1)])
    serial = luhn_serial()
    line = order["lines"][0]["id"]
    assert who.c.post("/api/registrations", json={"order_number": order["number"], "line_id": line, "serial": serial}).status_code == 201
    with server_clock(app_url) as clock:
        clock("2031-01-10T12:00:00Z")
        reg = who.c.get("/api/registrations/mine").json()["registrations"][0]
        with browse(browser, app_url, "/login") as page:
            sign_in_page(page, app_url, who.email, PASSWORD)
            page.goto(app_url + "/account")
            shows(page, f"{reg['board_name']} {serial}")
            shows(page, f"Board warranty: {reg['board_days_left']} days left")
            shows(page, f"Battery warranty: {reg['battery_days_left']} days left")
            click(page.get_by_role("button", name=f"Transfer {serial}"))
            dialog = page.get_by_role("dialog", name=f"Transfer {serial}")
            fill(dialog.get_by_role("textbox", name="New owner's email"), other.email)
            click(dialog.get_by_role("button", name="Transfer board"))
            shows(page, f"Board {serial} transferred.")
            wait_for(page, lambda: page.get_by_role("button", name=f"Transfer {serial}").count() == 0)
    assert serial in [x["serial"] for x in other.c.get("/api/registrations/mine").json()["registrations"]]


QUOTE_CENTS = 50000


def test_trade_in_lifecycle(app_url: str, mail: Any) -> None:
    who = signup(app_url, "tradein")
    support = staff(app_url, "support")
    bad = who.c.post("/api/trade-ins", json={"brand": "Acme", "model_year": 2017, "condition": "D", "serial": "ab", "note": "x" * 501})
    assert set(err(bad, 422, "validation_error")["fields"]) == {"brand", "model_year", "condition", "serial", "note"}
    t = submit_trade_in(who)
    assert set(t) == TRADE_IN_KEYS and t["status"] == "submitted" and t["quote_cents"] is None
    for client, status, code in ((http(app_url), 401, "unauthorized"), (who.c, 403, "forbidden"), (staff(app_url, "dealer").c, 403, "forbidden")):
        err(client.post(f"/api/staff/trade-ins/{t['id']}/quote", json={"amount_cents": QUOTE_CENTS}), status, code)
        err(client.post(f"/api/staff/trade-ins/{t['id']}/reject", json={"reason": "Too worn"}), status, code)
    assert who.c.get(f"/api/trade-ins/{t['id']}").json()["status"] == "submitted"
    err(who.c.post("/api/trade-ins", json={"brand": "Tern Foils", "model_year": 2022, "condition": "A", "serial": "XYZ98765", "note": ""}),
        409, "open_trade_in", "You already have an open trade-in.")
    msg = "This trade-in cannot be changed now."
    err(who.c.post(f"/api/trade-ins/{t['id']}/accept"), 409, "illegal_transition", msg)
    err(support.c.post(f"/api/staff/trade-ins/{t['id']}/quote", json={"amount_cents": QUOTE_MIN - 1}), 422, "validation_error")
    err(support.c.post(f"/api/staff/trade-ins/{t['id']}/quote", json={"amount_cents": QUOTE_MAX + 1}), 422, "validation_error")
    q = staff_quote(app_url, t["id"], QUOTE_CENTS)
    assert q["status"] == "quoted" and q["quote_cents"] == QUOTE_CENTS
    mails = [m for m in mail_to(mail, who.email) if m.get("Subject") == f"Trade-in quoted: {money(QUOTE_CENTS)}"]
    assert len(mails) == 1
    err(support.c.post(f"/api/staff/trade-ins/{t['id']}/reject", json={"reason": "Too worn"}), 409, "illegal_transition", msg)
    assert who.c.post(f"/api/trade-ins/{t['id']}/accept").json()["status"] == "accepted"
    err(who.c.post(f"/api/trade-ins/{t['id']}/decline"), 409, "illegal_transition", msg)
    add_acc(who, "ACC-BAG")
    err(checkout_quote(who, "US", use_trade_in=True), 422, "trade_in_not_applicable", "Trade-in credit applies to Crest boards only.")
    add_build(who, picks("CR-52"))
    q = checkout_quote(who, "US", use_trade_in=True).json()
    assert q["credits"] == [{"kind": "trade_in", "amount_cents": QUOTE_CENTS}]
    assert q["taxable_cents"] == BOARDS["CR-52"]["price"] + ACCESSORIES["ACC-BAG"][1] - QUOTE_CENTS
    order = placed(who, use_trade_in=True)
    try:
        assert order["trade_in_id"] == t["id"]
        now = who.c.get(f"/api/trade-ins/{t['id']}").json()
        assert now["status"] == "applied" and now["order_number"] == order["number"]
    finally:
        cancel_quietly(who, [order["number"]])
    back = who.c.get(f"/api/trade-ins/{t['id']}").json()
    assert back["status"] == "accepted" and back["order_number"] is None
    plain = signup(app_url, "nocredit")
    add_build(plain, picks("CR-52"))
    err(checkout_quote(plain, "US", use_trade_in=True), 422, "credit_unavailable", "This credit is not available.")


def test_trade_in_quote_expiry(app_url: str) -> None:
    a, b = signup(app_url, "expiry"), signup(app_url, "expiry")
    support = staff(app_url, "support")
    with server_clock(app_url) as clock:
        t0 = clock("2031-02-03T10:00:00Z")
        ta, tb = submit_trade_in(a), submit_trade_in(b)
        qa = staff_quote(app_url, ta["id"], QUOTE_CENTS)
        clock(t0)
        qb = staff_quote(app_url, tb["id"], QUOTE_CENTS)
        assert near(qa["quote_expires_at"], shift(t0, QUOTE_TTL)) and near(qb["quote_expires_at"], shift(t0, QUOTE_TTL))
        clock(shift(qa["quote_expires_at"], -1))
        assert a.c.post(f"/api/trade-ins/{ta['id']}/accept").json()["status"] == "accepted"
        clock(shift(qb["quote_expires_at"], -1))
        assert b.c.get(f"/api/trade-ins/{tb['id']}").json()["status"] == "quoted"
        clock(qb["quote_expires_at"])
        assert b.c.get(f"/api/trade-ins/{tb['id']}").json()["status"] == "expired"
        assert [x["status"] for x in b.c.get("/api/trade-ins/mine").json()["trade_ins"] if x["id"] == tb["id"]] == ["expired"]
        assert tb["id"] in [x["id"] for x in support.c.get("/api/staff/trade-ins", params={"status": "expired"}).json()["trade_ins"]]
        assert tb["id"] not in [x["id"] for x in support.c.get("/api/staff/trade-ins", params={"status": "quoted"}).json()["trade_ins"]]
        err(b.c.post(f"/api/trade-ins/{tb['id']}/accept"), 409, "quote_expired", "This quote has expired.")
        err(b.c.post(f"/api/trade-ins/{tb['id']}/decline"), 409, "illegal_transition")
        assert submit_trade_in(b)["status"] == "submitted"
        assert a.c.get(f"/api/trade-ins/{ta['id']}").json()["status"] == "accepted"


def test_trade_ins_stay_private(app_url: str) -> None:
    a, b = signup(app_url, "private"), signup(app_url, "snoop")
    t = submit_trade_in(a)
    staff_quote(app_url, t["id"], QUOTE_CENTS)
    for method, path in (("GET", ""), ("POST", "/accept"), ("POST", "/decline")):
        err(b.c.request(method, f"/api/trade-ins/{t['id']}{path}"), 404, "not_found", "Not found.")
    assert a.c.get(f"/api/trade-ins/{t['id']}").json()["status"] == "quoted"
    assert t["id"] not in [x["id"] for x in b.c.get("/api/trade-ins/mine").json()["trade_ins"]]


def book(who: Who, slot_id: Any) -> httpx.Response:
    return who.c.post("/api/demo-bookings", json={"slot_id": slot_id})


def test_demo_seats_never_overbook(app_url: str) -> None:
    slot = new_slot(app_url, 5, 2)
    assert set(slot) == SLOT_KEYS
    racers = [signup(app_url, "seat") for _ in range(5)]
    results = together([lambda w=w: book(w, slot["id"]) for w in racers])
    assert sorted(r.status_code for r in results) == [201, 201, 409, 409, 409]
    for r in results:
        if r.status_code == 409:
            err(r, 409, "slot_full", "This demo day is fully booked.")
        else:
            assert set(r.json()) == BOOKING_KEYS and r.json()["status"] == "booked"
    listed = {s["id"]: s for s in http(app_url).get(f"/api/locations/{slot['location_id']}/slots").json()["slots"]}
    assert listed[slot["id"]]["seats_left"] == 0
    start = far_slot_start()
    a = new_slot(app_url, 6, 3, start)
    b = new_slot(app_url, 6, 3, start + timedelta(hours=1))
    c = new_slot(app_url, 6, 3, start + timedelta(hours=2))
    who = signup(app_url, "overlap")
    assert book(who, a["id"]).status_code == 201
    err(book(who, b["id"]), 409, "already_booked", "You already hold a seat at this time.")
    assert book(who, c["id"]).status_code == 201
    admin, dealer, support = (staff(app_url, r) for r in ("admin", "dealer", "support"))
    s = far_slot_start()
    url = "/api/staff/locations/5/slots"
    err(admin.c.post(url, json={"starts_at": "2020-01-01T00:00:00Z", "ends_at": "2020-01-01T02:00:00Z", "capacity": 2}), 422, "validation_error")
    assert "ends_at" in err(admin.c.post(url, json={"starts_at": iso(s), "ends_at": iso(s - timedelta(hours=1)), "capacity": 2}), 422, "validation_error")["fields"]
    for cap in (0, SLOT_CAPACITY_MAX + 1):
        assert "capacity" in err(admin.c.post(url, json={"starts_at": iso(s), "ends_at": iso(s + timedelta(hours=2)), "capacity": cap}), 422, "validation_error")["fields"]
    assert dealer.c.post(url, json={"starts_at": iso(s), "ends_at": iso(s + timedelta(hours=2)), "capacity": SLOT_CAPACITY_MAX}).status_code == 201
    err(support.c.post(url, json={"starts_at": iso(s), "ends_at": iso(s + timedelta(hours=2)), "capacity": 2}), 403, "forbidden")


def test_demo_time_rules(app_url: str) -> None:
    slot = new_slot(app_url, 5, 4)
    start = slot["starts_at"]
    assert slot["timezone"] == "Europe/Berlin" and slot["label"] == slot_label(start, slot["ends_at"], "Europe/Berlin")
    c, d, a, b = (signup(app_url, "demotime") for _ in range(4))
    cb, db = book(c, slot["id"]).json(), book(d, slot["id"]).json()
    admin = staff(app_url, "admin")
    with server_clock(app_url) as clock:
        clock(shift(start, -CANCEL_LIMIT - 1))
        assert c.c.post(f"/api/demo-bookings/{cb['id']}/cancel").json()["status"] == "cancelled"
        clock(shift(start, -CANCEL_LIMIT))
        err(d.c.post(f"/api/demo-bookings/{db['id']}/cancel"), 409, "too_late", "Bookings can be cancelled up to 24 hours before the start.")
        clock(shift(start, -BOOKING_CLOSE - 1))
        ab = book(a, slot["id"])
        assert ab.status_code == 201
        clock(shift(start, -BOOKING_CLOSE))
        err(book(b, slot["id"]), 409, "booking_closed", "Booking for this demo day has closed.")
        clock(shift(start, -1))
        err(admin.c.post(f"/api/staff/demo-bookings/{ab.json()['id']}/attended"), 409, "not_started", "This demo day has not started yet.")
        clock(start)
        for client, status, code in ((http(app_url), 401, "unauthorized"), (a.c, 403, "forbidden"), (staff(app_url, "support").c, 403, "forbidden")):
            err(client.post(f"/api/staff/demo-bookings/{ab.json()['id']}/attended"), status, code)
        assert a.c.get("/api/demo-bookings/mine").json()["bookings"][0]["status"] == "booked"
        assert admin.c.post(f"/api/staff/demo-bookings/{ab.json()['id']}/attended").json()["status"] == "attended"
        err(c.c.post(f"/api/demo-bookings/{cb['id']}/cancel"), 409, "illegal_transition", "This booking cannot be changed now.")


def test_demo_credit(app_url: str) -> None:
    who = signup(app_url, "credit")
    start = far_slot_start()
    s1 = new_slot(app_url, 5, 2, start)
    s2 = new_slot(app_url, 5, 2, start + timedelta(days=1))
    b1, b2 = book(who, s1["id"]).json(), book(who, s2["id"]).json()
    admin = staff(app_url, "admin")
    assert who.c.get("/api/me").json()["demo_credit"] is None
    with server_clock(app_url) as clock:
        clock(s1["starts_at"])
        admin.c.post(f"/api/staff/demo-bookings/{b1['id']}/attended")
        credit = who.c.get("/api/me").json()["demo_credit"]
        assert set(credit) == {"amount_cents", "expires_at", "used"}
        assert credit["amount_cents"] == DEMO_CREDIT and credit["used"] is False
        assert near(credit["expires_at"], shift(s1["starts_at"], DEMO_TTL))
        clock(s2["starts_at"])
        admin.c.post(f"/api/staff/demo-bookings/{b2['id']}/attended")
        assert who.c.get("/api/me").json()["demo_credit"] == credit
        add_build(who, picks("DR-54"))
        q = checkout_quote(who, "DE", use_demo_credit=True).json()
        assert q["credits"] == [{"kind": "demo", "amount_cents": DEMO_CREDIT}]
        assert (q["taxable_cents"], q["shipping_cents"], q["tax_cents"], q["total_cents"]) == (1079900, 59900, 205181, 1344981)
        order = placed(who, "DE", use_demo_credit=True)
        try:
            assert who.c.get("/api/me").json()["demo_credit"]["used"] is True
        finally:
            cancel_quietly(who, [order["number"]])
        assert who.c.get("/api/me").json()["demo_credit"] == credit
        clock(credit["expires_at"])
        err(checkout_quote(who, "DE", use_demo_credit=True), 422, "credit_unavailable", "This credit is not available.")


def test_locator_distances_and_events(app_url: str) -> None:
    c = http(app_url)
    lat, lon = 48.0, 8.0
    r = c.get("/api/locations", params={"lat": lat, "lon": lon, "radius_km": MAX_RADIUS}).json()["locations"]
    want = sorted(((haversine(lat, lon, v[3], v[4]), v[0]) for v in LOCATIONS.values() if haversine(lat, lon, v[3], v[4]) <= MAX_RADIUS))
    assert [(x["distance_km"], x["name"]) for x in r] == want
    assert all(set(x) == LOCATION_KEYS for x in r)
    home = c.get("/api/locations", params={"lat": LOCATIONS[5][3], "lon": LOCATIONS[5][4]}).json()["locations"]
    assert home[0]["name"] == "Elbe Foil Station" and home[0]["distance_km"] == 0.0
    assert all(x["distance_km"] <= DEFAULT_RADIUS for x in home)
    nice = c.get("/api/locations", params={"lat": LOCATIONS[6][3], "lon": LOCATIONS[6][4], "radius_km": MAX_RADIUS, "country": "FR"}).json()["locations"]
    assert [x["name"] for x in nice] == ["Riviera Foil Lab"]
    every = c.get("/api/locations").json()["locations"]
    assert [x["name"] for x in every] == sorted(v[0] for v in LOCATIONS.values()) and all(x["distance_km"] is None for x in every)
    err(c.get("/api/locations", params={"lat": 90.5, "lon": 0}), 422, "validation_error", fields={"lat": "Enter a valid coordinate."})
    err(c.get("/api/locations", params={"lat": 0, "lon": -180.5}), 422, "validation_error", fields={"lon": "Enter a valid coordinate."})
    for radius in (0, MAX_RADIUS + 1, "10.5"):
        err(c.get("/api/locations", params={"lat": 0, "lon": 0, "radius_km": radius}), 422, "validation_error", fields={"radius_km": "Choose a radius up to 500 km."})
    events = c.get("/api/events").json()["events"]
    titles = [e["title"] for e in events]
    assert {"Spring Demo Tour", "Euro Demo Days", "Island Glide Weekend"} <= set(titles) and "Winter Demo (past)" not in titles
    assert all(set(e) == EVENT_KEYS for e in events)
    assert [e["starts_on"] for e in events] == sorted(e["starts_on"] for e in events)


def test_dealer_sees_masked_emails(app_url: str) -> None:
    slot = new_slot(app_url, 3, 3)
    who = signup(app_url, "masked")
    b = book(who, slot["id"]).json()
    rows = lambda role: {x["id"]: x for x in staff(app_url, role).c.get(f"/api/staff/locations/{slot['location_id']}/bookings").json()["bookings"]}
    dealer, admin = rows("dealer")[b["id"]], rows("admin")[b["id"]]
    assert set(dealer) == BOOKING_KEYS and dealer["customer_email"] == mask(who.email)
    assert admin["customer_email"] == who.email
    mine = {x["id"]: x for x in who.c.get("/api/demo-bookings/mine").json()["bookings"]}
    assert mine[b["id"]]["customer_email"] == who.email


CALL_REFUSALS = [
    ({"name": "J"}, "name", "Enter your name."),
    ({"email": "not-an-email"}, "email", "Enter a valid email."),
    ({"phone": "4155550100"}, "phone", "Enter your number in international format, like +14155550100."),
    ({"timezone": "Asia/Tokyo"}, "timezone", "Choose a timezone."),
    ({"preferred_start": "28/10/2030 09:00"}, "preferred_start", "Choose a date and time."),
    ({"preferred_start": "2030-10-28T09:15"}, "preferred_start", "Choose a time on the hour or half hour."),
    ({"preferred_start": "2030-10-26T10:00"}, "preferred_start", "We call on weekdays between 9:00 and 17:00 your time."),
    ({"preferred_start": "2030-10-28T17:00"}, "preferred_start", "We call on weekdays between 9:00 and 17:00 your time."),
    ({"preferred_start": "2030-10-28T08:30"}, "preferred_start", "We call on weekdays between 9:00 and 17:00 your time."),
    ({"timezone": "Australia/Sydney", "preferred_start": "2030-10-21T12:00"}, "preferred_start", "Choose a time at least 2 hours from now."),
    ({"timezone": "Australia/Sydney", "preferred_start": "2030-11-20T11:30"}, "preferred_start", "Choose a time within the next 30 days."),
    ({"topic": "Other"}, "topic", "Choose a topic."),
    ({"message": "x" * 1001}, "message", "Keep your message under 1000 characters."),
    ({"build_code": UNKNOWN_BUILD}, "build_code", "We could not find that build."),
]


def test_callback_rules(app_url: str) -> None:
    c = http(app_url)
    with server_clock(app_url) as clock:
        clock(CALL_NOW)
        ok = c.post("/api/callbacks", json=callback_body(ident("call")[0]))
        assert ok.status_code == 201, ok.text
        assert set(ok.json()) == {"reference", "preferred_start_utc"} and ok.json()["preferred_start_utc"] == BERLIN_UTC
        assert re.fullmatch(r"CB-\d+", ok.json()["reference"])
        assert c.post("/api/callbacks", json=callback_body(ident("call")[0], preferred_start="2030-10-28T16:30")).status_code == 201
        for over, field, message in CALL_REFUSALS:
            err(c.post("/api/callbacks", json=callback_body(ident("call")[0], **over)), 422, "validation_error", fields={field: message})
        many = err(c.post("/api/callbacks", json=callback_body(ident("call")[0], name="x", phone="12", topic="Other")), 422, "validation_error")
        assert {"name", "phone", "topic"} <= set(many["fields"])
        email = ident("callrace")[0]
        times = ("2030-10-28T09:00", "2030-10-28T09:30", "2030-10-28T10:00", "2030-10-28T10:30")
        results = together([lambda t=t: http(app_url).post("/api/callbacks", json=callback_body(email, preferred_start=t)) for t in times])
        assert sorted(r.status_code for r in results) == [201, 201, 409, 409]
        for r in results:
            if r.status_code == 409:
                err(r, 409, "too_many_requests", "You already have two callbacks booked.")


def test_no_header_or_recipient_injection(app_url: str, mail: Any) -> None:
    c = http(app_url)
    with server_clock(app_url) as clock:
        clock(CALL_NOW)
        email = ident("inject")[0]
        first = c.post("/api/callbacks", json=callback_body(ident("inject")[0])).json()["reference"]
        for over, field, message in (({"name": "Ana\nBcc: x@example.com"}, "name", "Enter your name."),
                                     ({"name": "Ana\u2028Lee"}, "name", "Enter your name."),
                                     ({"name": "Ana\x7fLee"}, "name", "Enter your name."),
                                     ({"email": "a@example.com,b@example.com"}, "email", "Enter a valid email."),
                                     ({"email": "<a@example.com>"}, "email", "Enter a valid email."),
                                     ({"email": "a b@example.com"}, "email", "Enter a valid email."),
                                     ({"email": "a@example.com;b@example.com"}, "email", "Enter a valid email.")):
            err(c.post("/api/callbacks", json=callback_body(email, **over)), 422, "validation_error", fields={field: message})
        second = c.post("/api/callbacks", json=callback_body(email, name=UNICODE_NAME)).json()["reference"]
        assert int(second[3:]) == int(first[3:]) + 1
    case_email = ident("case")[0]
    case_body = {"email": case_email, "subject": "Hello there", "message": "My board will not power on after charging."}
    s1 = c.post("/api/cases", json=case_body).json()["reference"]
    err(c.post("/api/cases", json={**case_body, "subject": "Hello\rthere friend"}), 422, "validation_error", fields={"subject": "Enter a subject of 5 to 120 characters."})
    err(c.post("/api/cases", json={**case_body, "email": case_email + "\n"}), 422, "validation_error", fields={"email": "Enter a valid email."})
    s2 = c.post("/api/cases", json=case_body).json()["reference"]
    assert int(s2[3:]) == int(s1[3:]) + 1
    msgs = [m for m in mail_to(mail, email) if m.get("Subject") == f"Callback requested: {second}"]
    assert len(msgs) == 1
    m = msgs[0]
    assert [a.lower() for a in addresses(m.get("To"))] == [email]
    assert not addresses(m.get("Cc")) and not addresses(m.get("Bcc"))
    assert body_lines(m)[0] == f"Hi {UNICODE_NAME.split()[0]},"


def test_notices_queue_while_mail_down(app_url: str, mail: Any) -> None:
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    email = ident("maildown")[0]
    with server_clock(down) as clock:
        clock(CALL_NOW)
        refs = []
        for t in ("2030-10-28T09:00", "2030-10-28T10:00"):
            r = http(down).post("/api/callbacks", json=callback_body(email, preferred_start=t))
            assert r.status_code == 201, r.text
            refs.append(r.json()["reference"])
    assert int(refs[1][3:]) == int(refs[0][3:]) + 1
    notices = {n["reference"]: n for n in outbox(down) if n["reference"] in refs}
    assert set(notices) == set(refs) and all(n["template"] == "callback_requested" and n["to"] == email for n in notices.values())
    messages = mail_to(mail, email, 2)
    for ref in refs:
        assert len([m for m in messages if m.get("Subject") == f"Callback requested: {ref}"]) == 1
    deadline = monotonic() + MAIL_WAIT
    while True:
        sent = {n["reference"]: n for n in outbox(app_url) if n["reference"] in refs}
        if all(n["status"] == "sent" for n in sent.values()) or monotonic() > deadline:
            break
    assert all(n["status"] == "sent" and n["sent_at"] and n["attempts"] >= 1 for n in sent.values())
    assert sent[refs[0]]["sent_at"] <= sent[refs[1]]["sent_at"]
    assert len([m for m in quiet_mail_to(mail, email) if m.get("Subject", "").startswith("Callback requested")]) == 2


def test_exactly_the_listed_notices(app_url: str, mail: Any) -> None:
    who = signup(app_url, "notices")
    build = save(who.c, picks("DR-49"))
    with server_clock(app_url) as clock:
        clock(CALL_NOW)
        cb = who.c.post("/api/callbacks", json=callback_body(who.email, build_code=build)).json()["reference"]
    case = who.c.post("/api/cases", json={"email": who.email, "subject": CASE_SUBJECT, "message": "How long does a full charge take?"}).json()["reference"]
    slot = new_slot(app_url, 5, 2)
    bk = book(who, slot["id"]).json()
    http(app_url).post("/api/auth/password-reset", json={"email": who.email})
    add_acc(who, "ACC-BAG")
    order = placed(who)
    expected = {f"Callback requested: {cb}", f"Support case opened: {case}", "Demo booked: Elbe Foil Station",
                "Reset your Tern Foils password", f"Order confirmed: {order['number']}"}
    messages = mail_to(mail, who.email, len(expected))
    assert {m.get("Subject") for m in messages} == expected
    call = next(m for m in messages if m.get("Subject") == f"Callback requested: {cb}")
    assert body_lines(call)[:4] == [f"Hi {CALLER.split()[0]},", f"Reference {cb}", BERLIN_LINE, f"Build {build}"]
    conf = next(m for m in messages if m.get("Subject", "").startswith("Order confirmed"))
    lines = body_lines(conf)
    assert lines[0] == f"Order {order['number']}" and lines[1] == f"Board bag x 1: {money(ACCESSORIES['ACC-BAG'][1])}"
    assert f"Shipping: {money(order['shipping_cents'])}" in lines and f"Total: {money(order['total_cents'])}" in lines
    assert lines[-1] == f"Arrives {day_label(order['arrives_on'])}"
    rows = [n for n in outbox(app_url) if n["to"] == who.email]
    assert sorted(n["template"] for n in rows) == sorted(["callback_requested", "case_opened", "demo_booked", "password_reset", "order_confirmed"])
    assert {n["reference"] for n in rows} >= {cb, case, order["number"]} and all(set(n) == NOTICE_KEYS for n in rows)
    assert str(bk["id"]) in {str(n["reference"]) for n in rows}
    login(app_url, who.email, PASSWORD)
    who.c.post(f"/api/orders/{order['number']}/cancel")
    http(app_url).post("/api/newsletter", json={"email": who.email, "consent": True})
    http(app_url).post("/api/newsletter", json={"email": who.email, "consent": True})
    assert len(quiet_mail_to(mail, who.email)) == len(expected)


def test_lookups_never_reveal_existence(app_url: str) -> None:
    who = signup(app_url, "track")
    add_acc(who, "ACC-BAG")
    n = placed(who)["number"]
    c = http(app_url)
    try:
        ok = c.post("/api/track", json={"order_number": n, "email": "  " + who.email.upper() + " "})
        assert ok.status_code == 200 and set(ok.json()) == TRACKING_KEYS and ok.json()["lines"] == ["Board bag"]
        assert all(set(e) == {"status", "at"} for e in ok.json()["events"])
        misses = [c.post("/api/track", json={"order_number": n, "email": ident("wrong")[0]}),
                  c.post("/api/track", json={"order_number": UNKNOWN_ORDER, "email": ident("wrong")[0]})]
        for m in misses:
            err(m, 404, "not_found", "We could not find an order with those details.")
        assert misses[0].content == misses[1].content
        ref = c.post("/api/cases", json={"email": who.email, "subject": "Tracking help", "message": "Where is my board bag right now?"}).json()["reference"]
        found = c.post("/api/cases/lookup", json={"reference": ref, "email": who.email.upper()})
        assert found.status_code == 200 and set(found.json()) == CASE_KEYS and found.json()["status"] == "open"
        cm = [c.post("/api/cases/lookup", json={"reference": ref, "email": ident("wrong")[0]}),
              c.post("/api/cases/lookup", json={"reference": "SC-999999", "email": ident("wrong")[0]})]
        for m in cm:
            err(m, 404, "not_found", "We could not find a case with those details.")
        assert cm[0].content == cm[1].content
    finally:
        cancel_quietly(who, [n])


def test_lookup_attempt_limit(app_url: str) -> None:
    who = signup(app_url, "limit")
    add_acc(who, "ACC-BAG")
    n = placed(who)["number"]
    c = http(app_url)
    try:
        with server_clock(app_url) as clock:
            t0 = "2031-05-05T10:00:00Z"
            for i in range(5):
                clock(t0)
                path = "/api/track" if i % 2 == 0 else "/api/cases/lookup"
                body = {"order_number": UNKNOWN_ORDER, "email": who.email} if i % 2 == 0 else {"reference": "SC-999999", "email": who.email}
                assert c.post(path, json=body).status_code == 404
            clock(t0)
            blocked = c.post("/api/track", json={"order_number": n, "email": who.email})
            err(blocked, 429, "too_many_attempts", "Too many attempts. Try again later.")
            assert blocked.headers.get("retry-after") == str(LOOKUP_WINDOW)
            other = c.post("/api/track", json={"order_number": UNKNOWN_ORDER, "email": who.email.upper()})
            assert other.status_code == 429 and other.content == blocked.content
            assert c.post("/api/track", json={"order_number": UNKNOWN_ORDER, "email": ident("free")[0]}).status_code == 404
            assert c.post("/api/track", json={"order_number": n, "email": 5}).status_code == 404
            clock(shift(t0, LOOKUP_STEP))
            assert c.post("/api/track", json={"order_number": n, "email": who.email}).headers.get("retry-after") == str(RETRY_AT_600)
            clock(shift(t0, LOOKUP_WINDOW))
            assert c.post("/api/track", json={"order_number": n, "email": who.email}).status_code == 200
    finally:
        cancel_quietly(who, [n])


CUSTOMER_ENDPOINTS = [("POST", "/api/checkout/quote"), ("POST", "/api/orders"), ("GET", "/api/orders"), ("GET", "/api/orders/TF-100001"),
                      ("POST", "/api/orders/TF-100001/cancel"), ("POST", "/api/orders/TF-100001/protection"), ("POST", "/api/registrations"),
                      ("GET", "/api/registrations/mine"), ("POST", "/api/registrations/TF123456782/transfer"), ("POST", "/api/trade-ins"),
                      ("GET", "/api/trade-ins/mine"), ("GET", "/api/trade-ins/1"), ("POST", "/api/trade-ins/1/accept"),
                      ("POST", "/api/trade-ins/1/decline"), ("POST", "/api/demo-bookings"), ("GET", "/api/demo-bookings/mine"),
                      ("POST", "/api/demo-bookings/1/cancel")]
STAFF_ENDPOINTS = [("GET", "/api/staff/trade-ins", {"admin", "support"}), ("POST", "/api/staff/trade-ins/1/quote", {"admin", "support"}),
                   ("POST", "/api/staff/trade-ins/1/reject", {"admin", "support"}), ("POST", "/api/staff/locations/1/slots", {"admin", "dealer"}),
                   ("GET", "/api/staff/locations/1/bookings", {"admin", "dealer"}), ("POST", "/api/staff/demo-bookings/1/attended", {"admin", "dealer"}),
                   ("GET", "/api/staff/orders", {"admin"}), ("POST", "/api/staff/orders/TF-100001/ship", {"admin"}),
                   ("POST", "/api/staff/orders/TF-100001/deliver", {"admin"}), ("GET", "/api/staff/outbox", {"admin", "support"})]


def test_role_guards(app_url: str) -> None:
    visitor = http(app_url)
    customer = signup(app_url, "guard")
    roles = {r: staff(app_url, r) for r in STAFF}
    for method, path in CUSTOMER_ENDPOINTS:
        err(visitor.request(method, path, json={}), 401, "unauthorized", "Please sign in.")
        err(roles["admin"].c.request(method, path, json={}), 403, "forbidden", "You do not have access to this.")
    for method, path, allowed in STAFF_ENDPOINTS:
        err(visitor.request(method, path, json={}), 401, "unauthorized")
        err(customer.c.request(method, path, json={}), 403, "forbidden")
        for role in set(STAFF) - allowed:
            err(roles[role].c.request(method, path, json={}), 403, "forbidden")
        if method == "GET":
            for role in allowed:
                assert roles[role].c.get(path).status_code == 200
    owner = signup(app_url, "owner")
    add_acc(owner, "ACC-BAG")
    n = placed(owner)["number"]
    try:
        err(customer.c.get(f"/api/orders/{n}"), 404, "not_found")
        err(customer.c.post(f"/api/orders/{n}/cancel"), 404, "not_found")
        assert owner.c.get(f"/api/orders/{n}").json()["status"] == "placed"
    finally:
        cancel_quietly(owner, [n])


def test_signup_login_sessions(app_url: str) -> None:
    email = ident("signup")[0]
    c = http(app_url)
    for weak in ("short1", "abcdefghijkl", "1234567890123"):
        err(c.post("/api/auth/signup", json={"email": email, "password": weak}), 422, "validation_error",
            fields={"password": "Use 10 or more characters with a letter and a digit."})
    r = c.post("/api/auth/signup", json={"email": "  " + email.upper() + " ", "password": PASSWORD})
    assert r.status_code == 201 and set(r.json()["user"]) == USER_KEYS
    assert r.json()["user"]["email"] == email and r.json()["user"]["role"] == "customer"
    assert any("HttpOnly".lower() in h.lower() for h in r.headers.get_list(SET_COOKIE))
    me = c.get("/api/me").json()
    assert set(me) == {"user", "demo_credit"} and me["demo_credit"] is None
    err(http(app_url).post("/api/auth/signup", json={"email": email, "password": PASSWORD}), 409, "email_taken", "An account with this email already exists.")
    wrong_pw = http(app_url).post("/api/auth/login", json={"email": email, "password": NEW_PASSWORD})
    wrong_email = http(app_url).post("/api/auth/login", json={"email": "x" + email, "password": PASSWORD})
    err(wrong_pw, 401, "invalid_credentials", "Email or password is incorrect.")
    assert wrong_pw.content == wrong_email.content
    assert c.post("/api/auth/logout").status_code == 200
    err(c.get("/api/me"), 401, "unauthorized")


def reset_tokens(mail: Any, email: str, count: int) -> list[str]:
    msgs = [m for m in mail_to(mail, email, count) if m.get("Subject") == "Reset your Tern Foils password"][::-1]
    return [re.search(r"reset-password\?token=([A-Za-z0-9_\-%.~]+)", text(m)).group(1) for m in msgs]


def test_password_reset_and_change(app_url: str, mail: Any) -> None:
    who = signup(app_url, "reset")
    other_session = login(app_url, who.email, PASSWORD)
    answers = [http(app_url).post("/api/auth/password-reset", json=b) for b in ({"email": who.email}, {"email": ident("ghost")[0]}, {})]
    assert all(r.status_code == 202 for r in answers) and len({r.content for r in answers}) == 1
    assert answers[0].json() == {"message": "If an account exists for that email, a reset link is on its way."}
    token = reset_tokens(mail, who.email, 1)[0]
    assert len(token) >= 32
    c = http(app_url)
    err(c.post("/api/auth/password-reset/confirm", json={"token": "junk", "password": "short"}), 422, "validation_error")
    ok = c.post("/api/auth/password-reset/confirm", json={"token": token, "password": NEW_PASSWORD})
    assert ok.status_code == 200 and ok.json() == {"message": "Your password has been reset."}
    err(c.post("/api/auth/password-reset/confirm", json={"token": token, "password": NEW_PASSWORD}), 422, "invalid_token", "This reset link is invalid or has expired.")
    for s in (who.c, other_session):
        assert s.get("/api/me").status_code == 401
    with server_clock(app_url) as clock:
        t0 = clock("2031-06-02T10:00:00Z")
        http(app_url).post("/api/auth/password-reset", json={"email": who.email})
        clock(t0)
        http(app_url).post("/api/auth/password-reset", json={"email": who.email})
        tokens = reset_tokens(mail, who.email, 3)
        older, newer = tokens[-2], tokens[-1]
        err(c.post("/api/auth/password-reset/confirm", json={"token": older, "password": PASSWORD}), 422, "invalid_token")
        clock(shift(t0, RESET_TTL))
        err(c.post("/api/auth/password-reset/confirm", json={"token": newer, "password": PASSWORD}), 422, "invalid_token")
        http(app_url).post("/api/auth/password-reset", json={"email": who.email})
        fresh = reset_tokens(mail, who.email, 4)[-1]
        clock(shift(t0, RESET_TTL + RESET_TTL - 1))
        assert c.post("/api/auth/password-reset/confirm", json={"token": fresh, "password": PASSWORD}).status_code == 200
    a, b = login(app_url, who.email, PASSWORD), login(app_url, who.email, PASSWORD)
    err(a.post("/api/auth/password", json={"current_password": NEW_PASSWORD, "new_password": NEW_PASSWORD}), 422, "validation_error",
        fields={"current_password": "Your current password is incorrect."})
    assert a.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}).json() == {}
    assert a.get("/api/me").status_code == 200 and b.get("/api/me").status_code == 401


def test_newsletter_and_partners_once(app_url: str) -> None:
    c = http(app_url)
    email = ident("news")[0]
    err(c.post("/api/newsletter", json={"email": email, "consent": False}), 422, "validation_error", fields={"consent": "Please agree to the terms to sign up."})
    err(c.post("/api/newsletter", json={"email": "bad", "consent": True}), 422, "validation_error", fields={"email": "Enter a valid email."})
    first = c.post("/api/newsletter", json={"email": email, "consent": True})
    assert first.status_code == 201 and first.json() == {"message": "Thanks for subscribing."}
    again = c.post("/api/newsletter", json={"email": " " + email.upper(), "consent": True})
    assert again.status_code == 200 and again.json() == {"message": "Thanks for subscribing."}
    race = ident("newsrace")[0]
    results = together([lambda: http(app_url).post("/api/newsletter", json={"email": race, "consent": True}) for _ in range(5)])
    assert sorted(r.status_code for r in results) == [200, 200, 200, 200, 201]
    app = {"business_name": "Glide Shop", "email": ident("partner")[0], "country": "DE", "kind": "dealer", "website": "https://example.com"}
    bad = err(c.post("/api/partner-applications", json={**app, "country": "de", "kind": "reseller", "website": "ftp://example.com"}), 422, "validation_error")
    assert bad["fields"] == {"country": "Enter a two-letter country code.", "kind": "Choose a partner type.", "website": "Enter a web address starting with http:// or https://."}
    ok = c.post("/api/partner-applications", json=app)
    assert ok.status_code == 201 and set(ok.json()) == {"id"}
    err(c.post("/api/partner-applications", json=app), 409, "already_applied", "This email has already applied.")
    rapp = {**app, "email": ident("partnerrace")[0]}
    results = together([lambda: http(app_url).post("/api/partner-applications", json=rapp) for _ in range(4)])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    clean = ident("partnerclean")[0]
    for bad in ({"business_name": "Shop\tName"}, {"business_name": "Shop\u2028Name"}, {"business_name": "Shop\r\nBcc: x"}):
        err(c.post("/api/partner-applications", json={**app, "email": clean, **bad}), 422, "validation_error",
            fields={"business_name": "Enter your business name."})
    for bad_email in (clean + ",x@example.com", "<" + clean + ">", clean + "\r\nBcc: x@example.com", clean + ";x@example.com"):
        err(c.post("/api/newsletter", json={"email": bad_email, "consent": True}), 422, "validation_error", fields={"email": "Enter a valid email."})
        err(c.post("/api/partner-applications", json={**app, "email": bad_email}), 422, "validation_error", fields={"email": "Enter a valid email."})
    assert c.post("/api/partner-applications", json={**app, "email": clean}).status_code == 201
    assert c.post("/api/newsletter", json={"email": clean, "consent": True}).status_code == 201


def test_literal_bounded_search(app_url: str) -> None:
    c = http(app_url)
    r = c.get("/api/search", params={"q": "18l"}).json()
    assert [x["sku"] for x in r["results"]] == ["SFB-40-18"] and set(r["results"][0]) == {"sku", "name", "price_cents"}
    for q in ("%%", "__", "\\\\"):
        assert c.get("/api/search", params={"q": q}).json() == {"results": []}
    for q in ("  x ", "a" * (SEARCH_MAX + 1)):
        err(c.get("/api/search", params={"q": q}), 422, "validation_error", fields={"q": "Enter 2 to 64 characters."})
    assert c.get("/api/search", params={"q": "a" * SEARCH_MAX}).status_code == 200
    items = [(f"{v['board']} {v['size']}", k) for k, v in BOARDS.items()] + [(v["name"], k) for k, v in COMPONENTS.items()] + [(v[0], k) for k, v in ACCESSORIES.items()]
    want = sorted(((n.lower(), k) for n, k in items if "ar" in n.lower()))[:SEARCH_RESULTS]
    got = c.get("/api/search", params={"q": "  AR "}).json()["results"]
    assert [x["sku"] for x in got] == [k for _, k in want]


def test_health_boot_and_speed(browser: Any, app_url: str) -> None:
    for base in (app_url, os.environ["APP_KILLBILL_DOWN_URL"], os.environ["APP_MAILPIT_DOWN_URL"]):
        r = http(base).get("/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}
    c = http(app_url)
    c.post("/api/builds/quote", json=picks("DR-49"))
    for gear in range(1, 6):
        start = monotonic()
        assert c.post("/api/builds/quote", json=picks("DR-49", gear=gear)).status_code == 200
        assert monotonic() - start <= QUOTE_BUDGET_S
    with browse(browser, app_url, "/") as page:
        start = monotonic()
        page.goto(app_url + "/")
        wait_for(page, lambda: page.get_by_role("heading", name="Lift off quietly").is_visible())
        assert monotonic() - start <= HERO_TEXT_S


def test_published_api_surface(app_url: str) -> None:
    c = http(app_url)
    r = c.get("/api/no-such-thing")
    err(r, 404, "not_found", "Not found.")
    assert not any(leak in r.text for leak in LEAKS)
    deep = c.post("/api/orders/TF-100001/nothing", json={})
    err(deep, 404, "not_found", "Not found.")
    assert not any(leak in deep.text for leak in LEAKS)
    for method, path, allow in (("PUT", "/api/health", ["GET"]), ("GET", "/api/orders/TF-100001/cancel", ["POST"]),
                                ("GET", "/api/cart/lines", ["POST"]), ("POST", "/api/cart/lines/1", ["PATCH", "DELETE"]),
                                ("DELETE", "/api/catalog", ["GET"])):
        resp = c.request(method, path, json={})
        err(resp, 405, "method_not_allowed", "Method not allowed.")
        assert [x.strip() for x in resp.headers["Allow"].split(",")] == allow
        assert not any(leak in resp.text for leak in LEAKS)
    head = c.head("/api/health")
    assert head.status_code == 200
    for resp in (r, head, c.get("/"), c.get("/api/catalog")):
        assert "X-Powered-By" not in resp.headers


def test_never_in_response(app_url: str, mail: Any, killbill: Any) -> None:
    who = signup(app_url, "secrets")
    add_acc(who, "ACC-BAG")
    order = placed(who)
    try:
        http(app_url).post("/api/auth/password-reset", json={"email": who.email})
        token = reset_tokens(mail, who.email, 2)[-1]
        account = killbill.account_by_key("tern-" + who.email)["accountId"]
        cookies = [v for v in who.c.cookies.values() if len(v) >= 16]
        me = who.c.get("/api/me")
        assert set(me.json()["user"]) == USER_KEYS
        cart = who.c.get("/api/cart")
        assert set(cart.json()) == CART_KEYS
        one = who.c.get(f"/api/orders/{order['number']}")
        assert set(one.json()) == ORDER_KEYS and set(one.json()["address"]) == {"name", "line1", "city", "postal_code", "phone"}
        box = staff(app_url, "support").c.get("/api/staff/outbox")
        mine = [n for n in box.json()["notices"] if n["to"] == who.email]
        assert mine and all(set(n) == NOTICE_KEYS for n in mine)
        for resp in (me, cart, one, who.c.get("/api/orders"), box):
            for secret in [PASSWORD, token, account, *cookies]:
                assert secret not in resp.text
            assert not re.search(r"\$2[aby]\$|\$argon2", resp.text)
            assert "Total: " not in resp.text
    finally:
        cancel_quietly(who, [order["number"]])


def test_controlled_clock(app_url: str) -> None:
    c = http(app_url)
    with server_clock(app_url) as clock:
        assert clock(CLOCK_PROBE) == CLOCK_PROBE
        titles = [e["title"] for e in c.get("/api/events").json()["events"]]
        assert "Spring Demo Tour" not in titles and "Euro Demo Days" in titles
        for bad in ("2030-05-21 12:00", 5, "2030-05-21T12:00:00+02:00"):
            err(c.put("/api/_clock", json={"now": bad}), 422, "validation_error", fields={"now": "Send an ISO 8601 UTC time ending in Z."})
    r = c.delete("/api/_clock")
    assert r.status_code == 200 and r.json()["now"] != CLOCK_PROBE
    assert "Spring Demo Tour" in [e["title"] for e in c.get("/api/events").json()["events"]]


CONTRAST_MIN = 4.5
QUIZ_OPACITY = (0.2, 0.9)
QUIZ_OUT_MS = 200
HERO_EYEBROW_OPACITY = (0.3, 0.95)
DRAWER_SHARE = (0.3, 0.9)
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
STEP_MS = 10
IDLE_MS = 1000
TARGET_Y = -0.3
BASE_DISTANCE = 3.4
MIN_DISTANCE, MAX_DISTANCE = 1.8, 6.0
YAW_STEP, PITCH_STEP = 15, 10
PITCH_MIN, PITCH_MAX = -10, 90
PRESETS = {"front": ("Front view", 90, 0), "side": ("Side view", 0, 0), "top": ("Top view", 0, 90), "three-quarter": ("Three-quarter view", 45, 25)}
SIDE_STEP_ORBIT = f"{YAW_STEP},0,{round(BASE_DISTANCE * 100)}"
LOAD_MORE_ROUNDS = 200
FIXED_TOL_PX = 1
SCROLL_PROBE = 600
BULK_ORDERS = ORDER_DEFAULT_PAGE + 1
DRAG_PX = 120
WHEEL_PX = 400
LAYOUT_PAGES = ["/", "/boards", "/foil-boards", "/parts", "/build", "/cart", "/match", "/locations", "/callback", "/track", "/support", "/shipping", "/signup", "/login"]
INTERACTIVE = {"button", "link", "textbox", "combobox", "checkbox", "radio", "slider", "searchbox", "spinbutton", "tab", "switch", "menuitem"}

OPACITY_JS = "e => { let o = 1; for (let n = e; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; }"
CONTRAST_JS = """e => {
  const parse = s => { const m = (s.match(/[\\d.]+/g) || ['0','0','0','0']).map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
  let op = 1; for (let n = e; n; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity);
  const chain = []; for (let n = e; n; n = n.parentElement) chain.unshift(n);
  let bg = [255, 255, 255];
  for (const n of chain) { const c = parse(getComputedStyle(n).backgroundColor); bg = [0, 1, 2].map(i => c[i] * c[3] + bg[i] * (1 - c[3])); }
  const fg = parse(getComputedStyle(e).color); const a = fg[3] * op;
  const f = [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
  const lum = c => { const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const l1 = lum(f), l2 = lum(bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}"""


def cam_pos(yaw: float, pitch: float, dist: float) -> list[float]:
    y, p = radians(yaw), radians(pitch)
    return [dist * cos(p) * sin(y), TARGET_Y + dist * sin(p), dist * cos(p) * cos(y)]


def zoom_of(dist: float) -> float:
    return float(Decimal(repr(BASE_DISTANCE / dist)).quantize(Decimal("0.01"), ROUND_HALF_UP))


def pose_ok(page: Any, yaw: float, pitch: float, dist: float, preset: str | None = None) -> None:
    s = camera_state(page)
    assert angle_close(s["yaw"], yaw % 360), s
    assert abs(s["pitch"] - pitch) <= ANGLE_TOL, s
    assert abs(s["zoom"] - zoom_of(dist)) <= ZOOM_TOL, s
    assert all(abs(a - b) <= METRE_TOL for a, b in zip(s["pos"], cam_pos(yaw, pitch, dist))), s
    if preset is not None:
        assert s["preset"] == preset, s


def radio(page: Any, group: str, name: str) -> Any:
    return page.get_by_role("radiogroup", name=group, exact=True).get_by_role("radio", name=re.compile(r"^\s*" + re.escape(name)))


def opacity(locator: Any) -> float:
    return locator.evaluate(OPACITY_JS)


def contrast(locator: Any) -> float:
    return locator.evaluate(CONTRAST_JS)


def announcements(page: Any) -> Any:
    return page.get_by_role("status", name="Announcements")


def announced(page: Any, pattern: str) -> None:
    wait_for(page, lambda: re.search(pattern, announcements(page).inner_text()) is not None)


def page_post(page: Any, base: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
    r = page.request.post(base + path, data=body)
    assert r.ok, r.text()
    return r.json()


@contextmanager
def as_user(browser: Any, base: str, path: str, email: str, password: str, **options: Any) -> Iterator[Any]:
    with browse(browser, base, "/login", **options) as page:
        sign_in_page(page, base, email, password)
        page.goto(base + path)
        yield page


def enter(locator: Any, value: str) -> None:
    if locator.evaluate("e => e.tagName") == "SELECT":
        select(locator, value)
    else:
        fill(locator, value)


def ride_min_attr(page: Any) -> str | None:
    return data_attr(ride_readout(page), "data-ride-min")


def shown_minutes(page: Any) -> int:
    return int(re.search(r"Up to (\d+) min", summary(page).inner_text()).group(1))


def gauge(page: Any, bars: int) -> Any:
    return summary(page).get_by_role("img", name=f"Battery gauge, {bars} of 4 bars")


def load_all(page: Any) -> None:
    more = page.get_by_role("button", name="Load more orders")
    for _ in range(LOAD_MORE_ROUNDS):
        if not more.is_visible():
            return
        before = len(page_text(page))
        click(more)
        wait_for(page, lambda: len(page_text(page)) != before or not more.is_visible())
    raise AssertionError("Load more orders never ran out")


def reveal(page: Any, target: Any) -> None:
    more = page.get_by_role("button", name="Load more orders")
    for _ in range(LOAD_MORE_ROUNDS):
        wait_for(page, lambda: target.count() > 0 or more.is_visible())
        if target.count():
            return
        before = len(page_text(page))
        click(more)
        wait_for(page, lambda: len(page_text(page)) != before or not more.is_visible())
    raise AssertionError("row never appeared")


def duplicate_controls(page: Any) -> list[tuple[str, str]]:
    cdp = session(page)
    cdp.send("Accessibility.enable")
    seen: dict[tuple[str, str], int] = {}
    for n in cdp.send("Accessibility.getFullAXTree")["nodes"]:
        if n.get("ignored"):
            continue
        role, name = n.get("role", {}).get("value"), n.get("name", {}).get("value", "")
        if role in INTERACTIVE and name:
            seen[(role, name)] = seen.get((role, name), 0) + 1
    return [k for k, v in seen.items() if v > 1]


def banner_number(page: Any) -> str:
    wait_for(page, lambda: re.search(r"Order TF-\d{6} placed\.", page_text(page)) is not None)
    return re.search(r"Order (TF-\d{6}) placed\.", page_text(page)).group(1)


def test_quiz_step_transition(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/match") as page:
        wait_for(page, lambda: question(page, 1).is_visible())
        click(page.get_by_role("radio", name="Never", exact=True))
        nxt = page.get_by_role("button", name="Next", exact=True)
        box = nxt.bounding_box()
        click(nxt)
        heading = question(page, 2)
        path = [f[0] for f in frames(page, [heading], QUIZ_REST_MS + SETTLE_MARGIN_MS)]
        wait_for(page, lambda: heading.evaluate(SEEN_OPACITY) == 1)
        rest = heading.bounding_box()["x"]
        assert any(QUIZ_OPACITY[0] <= f["opacity"] <= QUIZ_OPACITY[1] and f["x"] > rest + 1 for f in path), path
        wait_for(page, lambda: focused(heading))
        announced(page, question_name(2))
        after = page.get_by_role("button", name="Next", exact=True).bounding_box()
        assert (after["x"], after["y"]) == (box["x"], box["y"])
    with browse(browser, app_url, "/match", reduced_motion="reduce") as page:
        wait_for(page, lambda: question(page, 1).is_visible())
        click(page.get_by_role("radio", name="Never", exact=True))
        nxt = page.get_by_role("button", name="Next", exact=True)
        box = nxt.bounding_box()
        click(nxt)
        heading = question(page, 2)
        waited = wait_for(page, lambda: heading.is_visible() and opacity(heading) == 1, step=STEP_MS)
        assert waited < QUIZ_OUT_MS
        wait_for(page, lambda: focused(heading))
        announced(page, question_name(2))
        after = page.get_by_role("button", name="Next", exact=True).bounding_box()
        assert (after["x"], after["y"]) == (box["x"], box["y"])


def test_ride_time_readout(browser: Any, app_url: str) -> None:
    old = expected_build(picks("DR-49"))
    new = expected_build(picks("DR-49", gear=1))
    assert old["bars"] != new["bars"]
    with browse(browser, app_url, "/build") as page:
        ready(page)
        wait_for(page, lambda: ride_min_attr(page) == str(old["total_ride"]))
        slider = page.get_by_role("slider", name="Speed gear")
        slider.focus()
        page.keyboard.press("Home")
        wait_for(page, lambda: ride_min_attr(page) == str(new["total_ride"]), step=STEP_MS)
        advance(page, RIDE_CHECK_MS)
        mid = shown_minutes(page)
        assert min(old["total_ride"], new["total_ride"]) < mid < max(old["total_ride"], new["total_ride"])
        assert gauge(page, old["bars"]).count() == 1
        advance(page, RIDE_COUNT_MS - RIDE_CHECK_MS + SETTLE_MARGIN_MS)
        assert shown_minutes(page) == new["total_ride"]
        expect(gauge(page, new["bars"])).to_be_visible()
        assert viewer(page).get_attribute("data-battery-fill") == str(new["bars"])
        assert slider.get_attribute("aria-valuetext") == f"Gear {GEAR_MIN}"
    with browse(browser, app_url, "/build", reduced_motion="reduce") as page:
        ready(page)
        page.get_by_role("slider", name="Speed gear").focus()
        page.keyboard.press("End")
        top = expected_build(picks("DR-49", gear=10))
        wait_for(page, lambda: ride_min_attr(page) == str(top["total_ride"]), step=STEP_MS)
        assert shown_minutes(page) == top["total_ride"]
        page.get_by_role("slider", name="Rider weight").focus()
        page.keyboard.press("End")
        heavy = expected_build(picks("DR-49", gear=10, rider=120))
        wait_for(page, lambda: ride_min_attr(page) == str(heavy["total_ride"]), step=STEP_MS)
        assert shown_minutes(page) == heavy["total_ride"]
        assert page.get_by_role("slider", name="Rider weight").get_attribute("aria-valuetext") == f"{RIDER_MAX} kg"
        assert viewer(page).get_attribute("data-battery-fill") == str(heavy["bars"])


def test_board_viewer_contract(browser: Any, app_url: str) -> None:
    p = CR52_EXAMPLE
    want = expected_build(p)
    parts = [p["board_sku"], *(p[s] for s in SLOTS)]
    colours = [BOARDS["CR-52"]["finish"], *(COMPONENTS[p[s]]["colour"] for s in SLOTS)]
    with browse(browser, app_url, build_path(p), reduced_motion="reduce") as page:
        start = monotonic()
        ready(page)
        assert monotonic() - start <= VIEWER_READY_S
        v = viewer(page)
        assert v.get_attribute("data-renderer") == "webgl"
        assert v.get_attribute("data-parts").split(",") == parts
        assert [c.strip() for c in v.get_attribute("data-colours").split(",")] == colours
        assert v.get_attribute("data-mast-m") == COMPONENTS["MST-CF32"]["mast_m"]
        assert v.get_attribute("data-spares") == "1" and v.get_attribute("data-finish") == "carbon black"
        assert v.get_attribute("data-battery-fill") == str(want["bars"])
        assert v.get_attribute("data-target") == "0.000,-0.300,0.000" and v.get_attribute("data-fov") == "35"
        assert v.get_attribute("data-ghost") in ("", None) and v.get_attribute("data-swap") in ("", None)
        assert v.get_attribute("data-preset") == "three-quarter"
        advance(page, SWAP_REST_MS + SETTLE_MARGIN_MS)
        first = decode(capture(v))
        assert first.variance() > 0
        advance(page, IDLE_MS)
        assert difference(first, decode(capture(v))) == 0
        click(radio(page, "Wing", "Arc Pro 150 SnapFit"))
        wait_for(page, lambda: v.get_attribute("data-parts").split(",")[1] == "WNG-Q150" and v.get_attribute("data-ready") == "true")
        advance(page, SWAP_REST_MS + SETTLE_MARGIN_MS)
        assert difference(first, decode(capture(v))) > 0
    with browse(browser, app_url, build_path(p), no_webgl=True) as page:
        v = viewer(page)
        wait_for(page, lambda: v.get_attribute("data-renderer") == "fallback" and v.get_attribute("data-ready") == "true")
        assert v.get_attribute("data-parts").split(",") == parts
        assert v.get_attribute("data-battery-fill") == str(want["bars"])
        drawn = v.inner_text()
        for s in SLOTS:
            assert COMPONENTS[p[s]]["name"] in drawn
        assert not page.get_by_role("button", name="Front view").is_visible()


def test_camera_views_and_keys(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/build") as page:
        ready(page)
        pose_ok(page, 45, 25, BASE_DISTANCE, "three-quarter")
        click(page.get_by_role("button", name="Front view"))
        advance(page, CAMERA_CHECK_MS)
        s = camera_state(page)
        assert 45 < s["yaw"] < 90 or 0 < s["pitch"] < 25, s
        advance(page, CAMERA_GLIDE_MS - CAMERA_CHECK_MS + SETTLE_MARGIN_MS)
        pose_ok(page, 90, 0, BASE_DISTANCE, "front")
        assert page.get_by_role("button", name="Front view").get_attribute("aria-pressed") == "true"
        assert page.get_by_role("button", name="Side view").get_attribute("aria-pressed") == "false"
        wait_for(page, lambda: query(page).get("view") == "front")
        viewer(page).focus()
        page.keyboard.press("ArrowRight")
        advance(page, KEY_STEP_MS + SETTLE_MARGIN_MS)
        pose_ok(page, 90 + YAW_STEP, 0, BASE_DISTANCE, "custom")
    with browse(browser, app_url, "/build", reduced_motion="reduce") as page:
        ready(page)
        for preset, (button, yaw, pitch) in PRESETS.items():
            click(page.get_by_role("button", name=button))
            advance(page, STEP_MS)
            pose_ok(page, yaw, pitch, BASE_DISTANCE, preset)
            wait_for(page, lambda: query(page).get("view") == preset)
        click(page.get_by_role("button", name="Top view"))
        click(page.get_by_role("button", name="Reset view"))
        advance(page, STEP_MS)
        pose_ok(page, 45, 25, BASE_DISTANCE, "three-quarter")
        scroll = page.evaluate("window.scrollY")
        viewer(page).focus()
        page.keyboard.press("ArrowRight")
        advance(page, STEP_MS)
        pose_ok(page, 45 + YAW_STEP, 25, BASE_DISTANCE, "custom")
        wait_for(page, lambda: query(page).get("orbit") == "60,25,340")
        for _ in range(8):
            page.keyboard.press("ArrowUp")
        advance(page, STEP_MS)
        pose_ok(page, 45 + YAW_STEP, PITCH_MAX, BASE_DISTANCE)
        for _ in range(12):
            page.keyboard.press("ArrowDown")
        advance(page, STEP_MS)
        pose_ok(page, 45 + YAW_STEP, PITCH_MIN, BASE_DISTANCE)
        for _ in range(6):
            page.keyboard.press("=")
        advance(page, STEP_MS)
        pose_ok(page, 45 + YAW_STEP, PITCH_MIN, MIN_DISTANCE)
        for _ in range(12):
            page.keyboard.press("-")
        advance(page, STEP_MS)
        pose_ok(page, 45 + YAW_STEP, PITCH_MIN, MAX_DISTANCE)
        page.keyboard.press("Home")
        advance(page, STEP_MS)
        pose_ok(page, 45, 25, BASE_DISTANCE, "three-quarter")
        assert page.evaluate("window.scrollY") == scroll
        box = viewer(page).bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + DRAG_PX, cy, steps=6)
        page.mouse.up()
        advance(page, STEP_MS)
        s = camera_state(page)
        assert not angle_close(s["yaw"], 45) and s["preset"] == "custom"
        zoom_before = s["zoom"]
        page.mouse.wheel(0, WHEEL_PX)
        advance(page, KEY_STEP_MS + SETTLE_MARGIN_MS)
        z = camera_state(page)["zoom"]
        assert z != zoom_before and zoom_of(MAX_DISTANCE) - ZOOM_TOL <= z <= zoom_of(MIN_DISTANCE) + ZOOM_TOL
    with browse(browser, app_url, "/build?view=top", reduced_motion="reduce") as page:
        ready(page)
        pose_ok(page, 0, 90, BASE_DISTANCE, "top")
    with browse(browser, app_url, "/build?orbit=60,25,340", reduced_motion="reduce") as page:
        ready(page)
        pose_ok(page, 60, 25, BASE_DISTANCE, "custom")
    with browse(browser, app_url, "/build?orbit=30,120,900", reduced_motion="reduce") as page:
        ready(page)
        pose_ok(page, 30, PITCH_MAX, MAX_DISTANCE)


def test_part_swap_choreography(browser: Any, app_url: str) -> None:
    mast = '28" carbon SnapFit'
    with browse(browser, app_url, "/build") as page:
        ready(page)
        v = viewer(page)
        advance(page, SWAP_REST_MS + SETTLE_MARGIN_MS)
        old = decode(capture(v))
        click(radio(page, "Mast", mast))
        waited = wait_for(page, lambda: bool(v.get_attribute("data-swap")), step=STEP_MS)
        advance(page, max(0, SWAP_CHECK_MS - waited))
        assert v.get_attribute("data-swap") == f"{BOARDS['DR-49']['defaults'][1]} to MST-CF28"
        mid = decode(capture(v))
        advance(page, SWAP_REST_MS - SWAP_CHECK_MS + SETTLE_MARGIN_MS)
        assert v.get_attribute("data-swap") in ("", None)
        new = decode(capture(v))
        advance(page, IDLE_MS)
        assert difference(new, decode(capture(v))) == 0
        assert difference(mid, old) > 0 and difference(mid, new) > 0 and difference(old, new) > 0
    with browse(browser, app_url, "/build", reduced_motion="reduce") as page:
        ready(page)
        v = viewer(page)
        swaps: list[str | None] = []
        click(radio(page, "Mast", mast))

        def swapped() -> bool:
            swaps.append(v.get_attribute("data-swap"))
            return v.get_attribute("data-parts").split(",")[2] == "MST-CF28"

        wait_for(page, swapped, step=STEP_MS)
        assert all(s in ("", None) for s in swaps)
        settled = decode(capture(v))
        advance(page, IDLE_MS)
        assert difference(settled, decode(capture(v))) == 0


def test_disabled_options_contrast(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/build", reduced_motion="reduce") as page:
        ready(page)
        groups = {"wing": "Wing", "mast": "Mast", "propulsion": "Propulsion", "battery": "Battery", "controller": "Controller"}
        for sku, comp in COMPONENTS.items():
            option = radio(page, groups[comp["slot"]], comp["name"])
            name_el = page.get_by_role("radiogroup", name=groups[comp["slot"]], exact=True).get_by_text(comp["name"]).first
            assert contrast(name_el) >= CONTRAST_MIN, sku
            if "Drift" not in comp["fits"]:
                expect(option).to_be_disabled()
                expect(option).to_have_accessible_description(re.compile("Not compatible with Drift"))
        reasons = page.get_by_text(re.compile(r"^\s*Not compatible with Drift\.?\s*$")).all()
        assert len(reasons) == sum(1 for c in COMPONENTS.values() if "Drift" not in c["fits"])
        for el in reasons:
            assert contrast(el) >= CONTRAST_MIN
        sold = radio(page, "Board", "Swift 5'2")
        expect(sold).to_be_disabled()
        expect(sold).to_have_accessible_description(re.compile("Out of Stock"))
        badge = page.get_by_role("radiogroup", name="Board", exact=True).get_by_text("Out of Stock", exact=True).first
        assert contrast(badge) >= CONTRAST_MIN
    with browse(browser, app_url, "/boards", reduced_motion="reduce") as page:
        shows(page, "Out of Stock")
        for el in page.get_by_text("Out of Stock", exact=True).all():
            assert contrast(el) >= CONTRAST_MIN


def test_cart_page_and_checkout_redirect(browser: Any, app_url: str) -> None:
    who = signup(app_url, "cartpage")
    with browse(browser, app_url, "/cart", reduced_motion="reduce") as page:
        shows(page, "Your cart is empty")
        assert page.get_by_role("link", name="Continue shopping").is_visible()
        page_post(page, app_url, "/api/cart/lines", {"type": "accessory", "sku": "ACC-BAG", "quantity": CAP_ACCESSORY})
        page.reload()
        plus = page.get_by_role("button", name=f"Increase {ACCESSORIES['ACC-BAG'][0]}")
        wait_for(page, lambda: plus.is_visible())
        expect(plus).to_be_disabled()
        shows(page, "Limit 5 per order.")
        assert page.get_by_role("spinbutton", name=f"Quantity for {ACCESSORIES['ACC-BAG'][0]}").is_visible()
        fill(page.get_by_role("textbox", name="Discount code"), "NOPE10")
        click(page.get_by_role("button", name="Apply", exact=True))
        shows(page, "This code is not valid.")
        page.goto(app_url + f"/cart/shared/{UNKNOWN_TOKEN}")
        shows(page, "This shared cart has expired or does not exist.")
        assert page.get_by_role("link", name="Continue shopping").is_visible()
        page.goto(app_url + "/checkout")
        wait_for(page, lambda: urlparse(page.url).path == "/login")
        assert query(page).get("next") == "/checkout"
        fill(page.get_by_role("textbox", name="Email", exact=True), who.email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_for(page, lambda: urlparse(page.url).path == "/checkout")
        wait_for(page, lambda: page.get_by_role("button", name="Place order").is_visible())
    assert [(l["sku"], l["quantity"]) for l in who.c.get("/api/cart").json()["lines"]] == [("ACC-BAG", CAP_ACCESSORY)]


def test_header_menus_and_cart_drawer(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/build") as page:
        page.set_viewport_size({"width": VIEWPORTS["desktop"][0], "height": VIEWPORTS["desktop"][1]})
        ready(page)
        boards = page.get_by_role("button", name="Boards", exact=True)
        parts = page.get_by_role("button", name="Parts", exact=True)
        click(boards)
        wait_for(page, lambda: boards.get_attribute("aria-expanded") == "true")
        click(parts)
        wait_for(page, lambda: parts.get_attribute("aria-expanded") == "true" and boards.get_attribute("aria-expanded") == "false")
        page.keyboard.press("Escape")
        wait_for(page, lambda: parts.get_attribute("aria-expanded") == "false" and focused(parts))
        add = summary(page).get_by_role("button", name="Add to cart")
        click(add)
        drawer = page.get_by_role("dialog", name="Item added to your cart")
        path = [f[0] for f in frames(page, [drawer], DRAWER_ENTER_MS + SETTLE_MARGIN_MS)]
        width = page.viewport_size["width"]
        assert any(f["width"] and DRAWER_SHARE[0] <= (width - f["x"]) / f["width"] <= DRAWER_SHARE[1] for f in path), path
        view = drawer.get_by_role("link", name="View cart")
        wait_for(page, lambda: focused(view))
        assert set(tab_order(page, 4)) <= {"View cart", "Check out", "Close"}
        wait_for(page, lambda: page.get_by_role("link", name=re.compile(r"^Cart, 1 items?$")).count() == 1)
        announced(page, r"Added .+\. Cart has 1 items?\.")
        page.keyboard.press("Escape")
        wait_for(page, lambda: not drawer.is_visible())
        wait_for(page, lambda: focused(add))
        click(add)
        wait_for(page, lambda: page.get_by_role("link", name=re.compile(r"^Cart, 2 items?$")).count() == 1)
        click(page.get_by_role("dialog", name="Item added to your cart").get_by_role("button", name="Close"))
        wait_for(page, lambda: focused(add))
    assert True


def test_checkout_page_places_one_order(browser: Any, app_url: str) -> None:
    who = signup(app_url, "checkoutui")
    add_acc(who, "ACC-FLOAT")
    who.c.post("/api/cart/codes", json={"code": "FLYFIRST"})
    lines = [("acc", "ACC-FLOAT", 1)]
    with as_user(browser, app_url, "/checkout", who.email, PASSWORD, reduced_motion="reduce") as page:
        shows(page, "Choose a country")
        page.evaluate("window.__ternProbe = 1")
        fill_checkout(page, who, "CA", "M5V 2T6")
        ontario = expected_checkout(lines, ["FLYFIRST"], "CA", "M5V 2T6")
        shows(page, "HST (13%)")
        shows(page, money(ontario["total"]))
        fill(page.get_by_role("textbox", name="Postal code", exact=True), "H2X 1Y4")
        quebec = expected_checkout(lines, ["FLYFIRST"], "CA", "H2X 1Y4")
        shows(page, "GST (5%)")
        shows(page, "QST (9.975%)")
        shows(page, money(quebec["total"]))
        q = checkout_quote(who, "CA", "H2X 1Y4").json()
        shows(page, f"Ships {day_label(q['ships_on'])}, arrives {day_label(q['arrives_on'])}")
        wait_for(page, lambda: monthly_shown(page) == as_low_as(quebec["total"], "CA"))
        assert page.evaluate("window.__ternProbe") == 1
        keys: list[str | None] = []
        bodies: list[Any] = []

        def record(r: Any) -> None:
            if r.method == "POST" and urlparse(r.url).path == "/api/orders":
                keys.append(r.headers.get("idempotency-key"))
                bodies.append(r.post_data_json)

        page.on("request", record)
        page.get_by_role("button", name="Place order").dblclick()
        n = banner_number(page)
        wait_for(page, lambda: urlparse(page.url).path == f"/account/orders/{n}")
        try:
            assert [o["number"] for o in who.c.get("/api/orders").json()["orders"]] == [n]
            assert keys and len(set(keys)) == 1 and keys[0]
            replay = page.request.post(app_url + "/api/orders", data=bodies[0], headers={"Idempotency-Key": keys[0]})
            assert replay.status == 200 and replay.json()["number"] == n
            assert who.c.get(f"/api/orders/{n}").json()["total_cents"] == quebec["total"]
        finally:
            cancel_quietly(who, [n])


def test_checkout_progress_bar(browser: Any, app_url: str) -> None:
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    who = signup(down, "progress")
    add_acc(who, "ACC-BAG")

    def address(page: Any) -> None:
        fill(page.get_by_role("textbox", name="Full name", exact=True), who.name)
        fill(page.get_by_role("textbox", name="Address", exact=True), "12 Harbour Road")
        fill(page.get_by_role("textbox", name="City", exact=True), "San Juan")
        fill(page.get_by_role("textbox", name="Postal code", exact=True), "M5V 2T6")
        fill(page.get_by_role("textbox", name="Phone", exact=True), PHONE)

    with as_user(browser, down, "/checkout", who.email, PASSWORD) as page:
        bar = page.get_by_role("progressbar", name="Checkout progress")
        value = lambda: bar.get_attribute("aria-valuenow")
        wait_for(page, lambda: value() == "0")
        address(page)
        assert animations(bar) or bar_looks(page, bar, BAR_TWEEN_PROBE_MS) >= 3
        wait_for(page, lambda: value() == "1", step=STEP_MS)
        select(page.get_by_role("combobox", name="Country", exact=True), "Canada")
        wait_for(page, lambda: value() == "2")
        with held(page, "**/api/orders") as gate:
            click(page.get_by_role("button", name="Place order"))
            wait_for(page, lambda: value() == "3")
            gate.release()
        wait_for(page, lambda: value() == "2")
        wait_for(page, lambda: page.get_by_role("alert").filter(has_text="Billing is unavailable. Your order was not placed.").first.is_visible())
    with as_user(browser, down, "/checkout", who.email, PASSWORD, reduced_motion="reduce") as page:
        bar = page.get_by_role("progressbar", name="Checkout progress")
        wait_for(page, lambda: bar.get_attribute("aria-valuenow") == "0")
        address(page)
        wait_for(page, lambda: bar.get_attribute("aria-valuenow") == "1", step=STEP_MS)
        assert animations(bar) == []
    assert who.c.get("/api/orders").json()["orders"] == []


def test_storefront_pages_and_hero(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/privacy-policy") as page:
        cdp = session(page)
        cdp.send("Animation.enable")
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 0})
        page.goto(app_url + "/")
        eyebrow = page.get_by_text("Hand-built by a family workshop since 2018")
        link = page.get_by_role("link", name="Find my board")
        path = frames(page, [eyebrow, link], HERO_REST_MS + SETTLE_MARGIN_MS)
        assert any(HERO_EYEBROW_OPACITY[0] <= e["opacity"] <= HERO_EYEBROW_OPACITY[1] and l["opacity"] == 0
                   for e, l in path), path
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
        wait_for(page, lambda: eyebrow.evaluate(SEEN_OPACITY) == 1 and link.evaluate(SEEN_OPACITY) == 1)
    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        heading = page.get_by_role("heading", name="Lift off quietly")
        wait_for(page, lambda: heading.is_visible())
        assert opacity(page.get_by_text("Hand-built by a family workshop since 2018")) == 1
        assert opacity(page.get_by_role("heading", name="Rider questions")) == 1
        assert urlparse(page.get_by_role("link", name="Find my board").get_attribute("href")).path == "/match"
        body = page_text(page).casefold()
        for copy in ("Three boards, one snap-fit parts system, and a set-up for every kind of water.", "Ride a demo first", "Snap-fit parts",
                     "Trade in your board", "Covered for a year", "Extend to 2 or 3 years", "Pick the board that fits your water.",
                     "Not sure? Take the five-question quiz", "First flights", "Longest range", "Lightest carry", "Why riders choose a modular board",
                     "Snap-fit in a minute", "Tools and bolts", "What the rider magazines wrote", "Our workshop in numbers", "Want a person to answer?"):
            assert copy.casefold() in body, copy
        for price in (1099900, 1499900, 1399900):
            assert f"From {money(price)}".casefold() in body
        shown = {int(data_attr(el, "data-monthly-cents")) for el in page.get_by_text(FINANCE_RE).all()}
        assert {as_low_as(1099900), as_low_as(1499900), as_low_as(1399900)} <= shown
        shows(page, f"{1} of {PRESS_QUOTES}")
        click(page.get_by_role("button", name="Previous quote"))
        shows(page, f"{PRESS_QUOTES} of {PRESS_QUOTES}")
        click(page.get_by_role("button", name="Next quote"))
        shows(page, f"{1} of {PRESS_QUOTES}")
        page.goto(app_url + "/boards")
        shows(page, "Out of Stock")
        hrefs = set()
        for link in page.get_by_role("link", name=re.compile("Build yours")).all():
            u = urlparse(link.get_attribute("href"))
            hrefs.add(f"{u.path}?{u.query}")
        assert hrefs == {f"/build?board={sku}" for sku in ("DR-49", "CR-52", "SW-43")}
        page.goto(app_url + "/foil-boards")
        wait_for(page, lambda: page.get_by_role("heading", name="Foil boards").is_visible())
        body = page_text(page).casefold()
        assert "Unpowered boards for prone, wing and towed riding.".casefold() in body and "out of stock" in body
        for sku in ("SFB-40-18", "SFB-50-60", "SFB-59-105"):
            assert ACCESSORIES[sku][0].casefold() in body and f"Price {money(ACCESSORIES[sku][1])}".casefold() in body
        page.goto(app_url + "/parts")
        shows(page, "Arc Pro 180 Wide SnapFit")
        body = page_text(page)
        for sku in ("MST-AL28", "MST-CF28", "MST-CF32", "WNG-B170", "WNG-Q150", "WNG-Q180", "WNG-Q120"):
            comp = COMPONENTS[sku]
            assert comp["name"] in body and f"Price {money(comp['price'])}" in body
        for sku in ("MST-CF28", "MST-CF32", "MST-AL28"):
            assert f"Fits: {', '.join(COMPONENTS[sku]['fits'])}" in body


QUIZ_PATH = [("Never", "never"), ("Calm water", "calm"), ("Stability", "stability"), ("Under $12k", "under-12k"), ("Over 90 kg", "over-90")]


def on_question(page: Any, n: int, label: str) -> None:
    wait_for(page, lambda: page.get_by_role("heading", name=f"Question {n} of 5").is_visible())
    wait_for(page, lambda: page.get_by_role("radio", name=label, exact=True).is_checked())


def result_copy(page: Any) -> None:
    for line in ("Your match: Drift", "Drift: 11 points", "Crest: 2 points", "Swift: 0 points",
                 "Question 1: How much have you foiled?", "Question 4: What is your budget?"):
        shows(page, line)


def test_wf_rider_match_build_save_quiz_address(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/match", reduced_motion="reduce") as page:
        for i, (label, _) in enumerate(QUIZ_PATH):
            wait_for(page, lambda: page.get_by_role("heading", name=f"Question {i + 1} of 5").is_visible())
            click(page.get_by_role("radio", name=label, exact=True))
            if i < 4:
                click(page.get_by_role("button", name="Next", exact=True))
        assert query(page)["step"] == "5" and query(page)["answers"] == ",".join(k for _, k in QUIZ_PATH)
        page.go_back()
        page.go_back()
        on_question(page, 3, "Stability")
        page.go_forward()
        on_question(page, 4, "Under $12k")
        page.reload()
        on_question(page, 4, "Under $12k")
        with browse(browser, page.url, "", reduced_motion="reduce") as other:
            on_question(other, 4, "Under $12k")
            assert other.get_by_role("radio", name="Under $12k", exact=True).is_checked()
        click(page.get_by_role("button", name="Next", exact=True))
        wait_for(page, lambda: question(page, 5).is_visible())
        click(page.get_by_role("radio", name="Over 90 kg", exact=True))
        click(page.get_by_role("button", name="See my match"))
        wait_for(page, lambda: "result" in query(page))
        rid = query(page)["result"]
        result_copy(page)
        stored = http(app_url).get(f"/api/match/{rid}").json()
        assert stored["answers"] == [k for _, k in QUIZ_PATH] and stored["recommended"] == "Drift"
        with browse(browser, app_url, f"/match?result={rid}", reduced_motion="reduce") as other:
            result_copy(other)
        click(page.get_by_role("link", name="Build this board"))
        wait_for(page, lambda: urlparse(page.url).path == "/build")
        assert query(page)["board"] == "DR-49" and query(page)["rider"] == str(RIDER_OVER_90)
        ready(page)
        assert page.get_by_role("slider", name="Rider weight").get_attribute("aria-valuetext") == f"{RIDER_OVER_90} kg"
        assert viewer(page).get_attribute("data-preset") == "three-quarter"
    for bad in ("/match?step=4&answers=never", "/match?step=1&answers=bogus"):
        with browse(browser, app_url, bad, reduced_motion="reduce") as page:
            wait_for(page, lambda: question(page, 1).is_visible())
            assert urlparse(page.url).path == "/match" and query(page).get("step") in (None, "1")


def test_wf_rider_match_build_save_shared_link(browser: Any, app_url: str) -> None:
    p = CR52_EXAMPLE
    want = expected_build(p)
    with browse(browser, app_url, build_path(p), reduced_motion="reduce") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        ready(page)
        click(page.get_by_role("button", name="Side view"))
        advance(page, STEP_MS)
        viewer(page).focus()
        page.keyboard.press("ArrowRight")
        advance(page, STEP_MS)
        wait_for(page, lambda: query(page).get("orbit") == SIDE_STEP_ORBIT)
        click(summary(page).get_by_role("button", name="Save build"))
        wait_for(page, lambda: urlparse(page.url).path.startswith("/build/"))
        code = urlparse(page.url).path.rsplit("/", 1)[1]
        assert code == build_code(p)
        announced(page, r"Build saved\.")
        assert query(page).get("orbit") == SIDE_STEP_ORBIT
        click(summary(page).get_by_role("button", name="Copy link"))
        announced(page, r"Link copied\.")
        copied = page.evaluate("navigator.clipboard.readText()")
        assert copied == page.url
        assert money(want["total"]) in summary(page).inner_text()
        monthly = monthly_shown(summary(page))
        assert monthly == as_low_as(want["total"])
        parts, colours = viewer(page).get_attribute("data-parts"), viewer(page).get_attribute("data-colours")
    err(http(app_url).post("/api/builds", json={**p, "total_cents": 1}), 422, "unknown_field", fields={"total_cents": "Unknown field."})
    assert http(app_url).get(f"/api/builds/{code}").json()["total_cents"] == EXAMPLE_TOTAL
    with browse(browser, copied, "", reduced_motion="reduce") as other:
        ready(other)
        v = viewer(other)
        assert v.get_attribute("data-parts") == parts and v.get_attribute("data-colours") == colours
        assert v.get_attribute("data-mast-m") == COMPONENTS["MST-CF32"]["mast_m"] and v.get_attribute("data-spares") == "1"
        assert v.get_attribute("data-battery-fill") == str(want["bars"])
        pose_ok(other, YAW_STEP, 0, BASE_DISTANCE, "custom")
        text_now = summary(other).inner_text()
        assert money(want["total"]) in text_now and f"Up to {want['total_ride']} min" in text_now
        assert ride_min_attr(other) == str(want["total_ride"])
        assert monthly_shown(summary(other)) == monthly
        for s, group in zip(SLOTS, ("Wing", "Mast", "Propulsion", "Battery", "Controller")):
            assert radio(other, group, COMPONENTS[p[s]]["name"]).is_checked()
        assert radio(other, "Spare batteries", "1").is_checked()


def check_surfaces(page: Any, p: dict[str, Any], announce: bool = True) -> None:
    q = http(app_url_of(page)).post("/api/builds/quote", json=p).json()
    wanted = [p["board_sku"], *(p[s] for s in SLOTS)]
    wait_for(page, lambda: viewer(page).get_attribute("data-parts").split(",") == wanted and ride_min_attr(page) == str(q["total_ride_min"]))
    text_now = summary(page).inner_text()
    assert money(q["total_cents"]) in text_now and f"Up to {q['total_ride_min']} min" in text_now
    for s in SLOTS:
        assert q["slots"][s]["name"] in text_now
    expect(gauge(page, q["battery_bars"])).to_be_visible()
    assert monthly_shown(summary(page)) == min(t["monthly_cents"] for t in q["financing"])
    addr = query(page)
    assert (addr["board"], addr["wing"], addr["mast"], addr["propulsion"], addr["battery"], addr["controller"]) == tuple(wanted)
    assert (addr["spares"], addr["rider"], addr["gear"]) == (str(p["spares"]), str(p["rider_kg"]), str(p["gear"]))
    if announce:
        announced(page, re.escape(f"Build total {money(q['total_cents'])}, up to {q['total_ride_min']} min."))


def app_url_of(page: Any) -> str:
    u = urlparse(page.url)
    return f"{u.scheme}://{u.netloc}"


def test_wf_configurator_pricing_live_summary(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/build", reduced_motion="reduce") as page:
        ready(page)
        check_surfaces(page, picks("DR-49"), announce=False)
        click(radio(page, "Board", "Crest 5'2"))
        check_surfaces(page, picks("CR-52"))
        click(radio(page, "Wing", "Arc Pro 180 Wide SnapFit"))
        check_surfaces(page, picks("CR-52", wing="WNG-Q180"))
        click(radio(page, "Spare batteries", "1"))
        check_surfaces(page, picks("CR-52", spares=1, wing="WNG-Q180"))
    bad = http(app_url).post("/api/builds/quote", content=b'{"board_sku": "CR-52",', headers={"Content-Type": "application/json"})
    err(bad, 400, "bad_request", "The request body is not valid JSON.")
    assert not any(leak in bad.text for leak in LEAKS)


def test_wf_configurator_pricing_stale_answer(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/build", reduced_motion="reduce") as page:
        ready(page)
        stalled: list[Any] = []

        def hold(route: Any) -> None:
            body = route.request.post_data_json or {}
            if body.get("gear") == 4 and not stalled:
                stalled.append(route)
            else:
                route.continue_()

        page.route("**/api/builds/quote", hold)
        page.get_by_role("slider", name="Speed gear").focus()
        page.keyboard.press("ArrowLeft")
        wait_for(page, lambda: bool(stalled))
        page.keyboard.press("ArrowLeft")
        newest = expected_build(picks("DR-49", gear=3))
        older = expected_build(picks("DR-49", gear=4))
        assert newest["total_ride"] != older["total_ride"]
        wait_for(page, lambda: ride_min_attr(page) == str(newest["total_ride"]) and query(page).get("gear") == "3")
        with page.expect_response("**/api/builds/quote"):
            stalled[0].continue_()
        advance(page, RIDE_COUNT_MS + SETTLE_MARGIN_MS)
        assert ride_min_attr(page) == str(newest["total_ride"]) and shown_minutes(page) == newest["total_ride"]
        assert query(page).get("gear") == "3"
        assert page.get_by_role("slider", name="Speed gear").get_attribute("aria-valuetext") == f"Gear {picks('DR-49', gear=3)['gear']}"
        expect(gauge(page, newest["bars"])).to_be_visible()


def test_wf_build_validation_ghost(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/build", reduced_motion="reduce") as page:
        ready(page)
        v = viewer(page)
        option = radio(page, "Wing", "Arc Pro 150 SnapFit")
        expect(option).to_be_attached()
        expect(option).to_be_disabled()
        expect(option).to_have_accessible_description(re.compile("Not compatible with Drift"))
        shows(page, "Not compatible with Drift")
        parts, address = v.get_attribute("data-parts"), page.url
        quotes: list[str] = []
        page.on("request", lambda r: quotes.append(r.url) if "/api/builds/quote" in r.url else None)
        option.hover(force=True)
        wait_for(page, lambda: v.get_attribute("data-ghost") == "WNG-Q150")
        assert v.get_attribute("data-parts") == parts and page.url == address and quotes == []
        page.mouse.move(0, 0)
        cleared = wait_for(page, lambda: v.get_attribute("data-ghost") in ("", None), step=STEP_MS)
        assert cleared <= GHOST_CLEAR_MS
        assert v.get_attribute("data-parts") == parts and page.url == address and quotes == []
    err(http(app_url).post("/api/builds/quote", json=picks("DR-49", wing="WNG-Q150")), 422, "incompatible", "Not compatible with Drift.")


def test_wf_build_validation_sold_out_size(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/build", reduced_motion="reduce") as page:
        ready(page)
        sold = radio(page, "Board", "Swift 5'2")
        expect(sold).to_be_disabled()
        expect(sold).to_have_accessible_description(re.compile("Out of Stock"))
        click(radio(page, "Board", "Swift 4'3"))
        wait_for(page, lambda: query(page).get("board") == "SW-43")
        page.keyboard.press("ArrowDown")
        wait_for(page, lambda: query(page).get("board") == "SW-48")
        page.keyboard.press("ArrowDown")
        wait_for(page, lambda: query(page).get("board") == "DR-49")
        assert not sold.is_checked() and radio(page, "Board", "Drift 4'9").is_checked()
    err(http(app_url).post("/api/builds/quote", json=picks("SW-52")), 422, "out_of_stock", "This size is out of stock.")


def test_wf_cart_rules_financing_surfaces(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/parts", reduced_motion="reduce") as page:
        shows(page, "Arc Pro 180 Wide SnapFit")
        shown = {int(data_attr(el, "data-monthly-cents")) for el in page.get_by_text(FINANCE_RE).all()}
        priced = [COMPONENTS[s]["price"] for s in ("MST-AL28", "MST-CF28", "MST-CF32", "WNG-B170", "WNG-Q150", "WNG-Q180", "WNG-Q120")]
        assert shown == {as_low_as(x) for x in priced if as_low_as(x) is not None}
        page.goto(app_url + "/build")
        ready(page)
        assert monthly_shown(summary(page)) == as_low_as(BOARDS["DR-49"]["price"])
        page_post(page, app_url, "/api/cart/lines", {"type": "accessory", "sku": "ACC-CHG", "quantity": 1})
        page.goto(app_url + "/cart")
        shows(page, "Fast charger")

        def api_monthly() -> int | None:
            cart = page.request.get(app_url + "/api/cart").json()
            return min(t["monthly_cents"] for t in cart["financing"]) if cart["financing"] else None

        wait_for(page, lambda: page.get_by_text(FINANCE_RE).count() == 0)
        assert api_monthly() is None
        click(page.get_by_role("button", name=f"Increase {ACCESSORIES['ACC-CHG'][0]}"))
        wait_for(page, lambda: page.get_by_text(FINANCE_RE).count() > 0 and monthly_shown(page) == api_monthly())
        assert monthly_shown(page) == as_low_as(ACCESSORIES["ACC-CHG"][1] * 2)
        fill(page.get_by_role("textbox", name="Discount code"), "FLYFIRST")
        click(page.get_by_role("button", name="Apply", exact=True))
        announced(page, r"Code FLYFIRST applied\.")
        expected = as_low_as(ACCESSORIES["ACC-CHG"][1] * 2 - code_amounts(["FLYFIRST"], ACCESSORIES["ACC-CHG"][1] * 2)[0])
        wait_for(page, lambda: page.get_by_text(FINANCE_RE).count() > 0 and monthly_shown(page) == expected)
        assert api_monthly() == expected


def test_wf_cart_rules_financing_country(browser: Any, app_url: str) -> None:
    who = signup(app_url, "fincountry")
    add_acc(who, "ACC-FLOAT")
    with as_user(browser, app_url, "/checkout", who.email, PASSWORD, reduced_motion="reduce") as page:
        fill_checkout(page, who, "US", US_POSTAL)
        us = checkout_quote(who, "US").json()
        wait_for(page, lambda: page.get_by_text(FINANCE_RE).count() > 0 and monthly_shown(page) == min(t["monthly_cents"] for t in us["financing"]))
        select(page.get_by_role("combobox", name="Country", exact=True), "Canada")
        fill(page.get_by_role("textbox", name="Postal code", exact=True), "M5V 2T6")
        ca = checkout_quote(who, "CA", "M5V 2T6").json()
        assert [t["months"] for t in ca["financing"]] == [12, 24]
        wait_for(page, lambda: page.get_by_text(FINANCE_RE).count() > 0 and monthly_shown(page) == min(t["monthly_cents"] for t in ca["financing"]))
        assert monthly_shown(page) == as_low_as(ca["total_cents"], "CA")


def ui_checkout(browser: Any, base: str, mail: Any, killbill: Any, prefix: str, lines: list[tuple[str, Any, int]], codes: list[str], postal: str, rows: list[str]) -> tuple[Who, dict[str, Any], Any]:
    who = signup(base, prefix)
    for kind, item, qty in lines:
        add_build(who, item, qty) if kind == "build" else add_acc(who, item, qty)
    for code in codes:
        who.c.post("/api/cart/codes", json={"code": code})
    want = expected_checkout(lines, codes, "CA", postal)
    quote = checkout_quote(who, "CA", postal).json()
    assert quote["total_cents"] == want["total"]
    with as_user(browser, base, "/checkout", who.email, PASSWORD, reduced_motion="reduce") as page:
        fill_checkout(page, who, "CA", postal)
        for copy in [*rows, money(want["total"]), f"Ships {day_label(quote['ships_on'])}, arrives {day_label(quote['arrives_on'])}"]:
            shows(page, copy)
        for name, rate, amount in want["taxes"]:
            shows(page, money(amount))
        wait_for(page, lambda: monthly_shown(page) == as_low_as(want["total"], "CA"))
        click(page.get_by_role("button", name="Place order"))
        n = banner_number(page)
    order = who.c.get(f"/api/orders/{n}").json()
    assert (order["taxable_cents"], order["shipping_cents"], order["dangerous_goods_cents"], order["tax_cents"], order["total_cents"]) == (
        want["taxable"], want["shipping"], want["dg"], want["tax"], want["total"])
    assert [(t["name"], t["rate_pcm"], t["amount_cents"]) for t in order["taxes"]] == want["taxes"]
    assert order["arrives_on"] == quote["arrives_on"]
    confirmation = [m for m in mail_to(mail, who.email) if m.get("Subject") == f"Order confirmed: {n}"]
    assert len(confirmation) == 1
    lines_in_mail = body_lines(confirmation[0])
    expected_lines = [f"Shipping: {money(want['shipping'])}", f"Dangerous goods handling: {money(want['dg'])}", f"Tax: {money(want['tax'])}",
                      f"Total: {money(want['total'])}", f"Arrives {day_label(order['arrives_on'])}"]
    expected_lines += [f"{name}: {money(amount)}" for name, _, amount in want["taxes"]]
    for line in expected_lines:
        assert line in lines_in_mail, line
    assert order["billing_invoice_id"] and killbill.account_by_key(order["billing_account_key"]) is not None
    assert_invoice(order)
    return who, order, want


def test_wf_checkout_totals_ontario_order(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    lines = [("build", CR52_EXAMPLE, 1), ("acc", "ACC-CHG", 2)]
    want = expected_checkout(lines, ["FLYFIRST"], "CA", "M5V 2T6")
    hst = want["taxes"][0][2]
    who, order, _ = ui_checkout(browser, app_url, mail, killbill, "ontario", lines, ["FLYFIRST"], "M5V 2T6",
                                [f"{want['taxes'][0][0]} ({pct(want['taxes'][0][1])})", money(hst), "1 packed with a board, 0 shipped alone", money(want["shipping"]), money(want["dg"])])
    n = order["number"]
    try:
        with as_user(browser, app_url, f"/account/orders/{n}", who.email, PASSWORD, reduced_motion="reduce") as page:
            shows(page, money(order["total_cents"]))
            assert page_text(page).count(f"{want['taxes'][0][0]} (") == 1
            click(page.get_by_role("button", name="Cancel order"))
            dialog = page.get_by_role("dialog", name="Cancel this order?")
            click(dialog.get_by_role("button", name="Yes, cancel order"))
            shows(page, f"Order {n} cancelled.")
        assert who.c.get(f"/api/orders/{n}").json()["status"] == "cancelled"
    finally:
        cancel_quietly(who, [n])


def test_wf_checkout_totals_quebec_order(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    lines = [("acc", "ACC-FLOAT", 1)]
    want = expected_checkout(lines, ["FLYFIRST"], "CA", "H2X 1Y4")
    assert (want["taxable"], want["tax"], want["total"]) == (116910, 17508, 137918)
    who, order, _ = ui_checkout(browser, app_url, mail, killbill, "quebec", lines, ["FLYFIRST"], "H2X 1Y4", ["GST (5%)", "QST (9.975%)", money(want["shipping"])])
    cancel_quietly(who, [order["number"]])


def test_wf_idempotent_orders_staff_ship_deliver(browser: Any, app_url: str, mail: Any) -> None:
    who = signup(app_url, "shipui")
    add_acc(who, "ACC-BAG")
    order = placed(who)
    n = order["number"]
    with as_user(browser, app_url, "/staff", *STAFF["admin"], reduced_motion="reduce") as page:
        click(page.get_by_role("tab", name="Orders"))
        ship = page.get_by_role("button", name=f"Mark shipped {n}")
        reveal(page, ship)
        assert page.get_by_role("button", name=f"Mark delivered {n}").count() == 0
        click(ship)
        announced(page, re.escape(f"Order {n} marked shipped."))
        deliver = page.get_by_role("button", name=f"Mark delivered {n}")
        wait_for(page, lambda: deliver.is_visible())
        click(deliver)
        announced(page, re.escape(f"Order {n} marked delivered."))
    now = who.c.get(f"/api/orders/{n}").json()
    assert [(e["status"], e["by"]) for e in now["events"]] == [("placed", who.email), ("shipped", STAFF["admin"][0]), ("delivered", STAFF["admin"][0])]
    with as_user(browser, app_url, f"/account/orders/{n}", who.email, PASSWORD, reduced_motion="reduce") as page:
        shows(page, n)
        body = page_text(page).lower()
        assert "shipped" in body and "delivered" in body
        shows(page, money(order["total_cents"]))
        shows(page, f"Billing account {order['billing_account_key']}")
    confirmation = [m for m in mail_to(mail, who.email) if m.get("Subject") == f"Order confirmed: {n}"]
    assert len(confirmation) == 1 and f"Total: {money(order['total_cents'])}" in body_lines(confirmation[0])


def test_wf_idempotent_orders_second_session(browser: Any, app_url: str) -> None:
    who = signup(app_url, "twosessions")
    add_acc(who, "ACC-CHG")
    order = placed(who)
    n = order["number"]
    seen = []
    try:
        for _ in range(2):
            with as_user(browser, app_url, f"/account/orders/{n}", who.email, PASSWORD, reduced_motion="reduce") as page:
                shows(page, n)
                for copy in (money(order["total_cents"]), f"Ships {day_label(order['ships_on'])}, arrives {day_label(order['arrives_on'])}",
                             f"Billing account {order['billing_account_key']}"):
                    shows(page, copy)
                assert "placed" in page_text(page).lower()
                seen.append(login(app_url, who.email, PASSWORD).get(f"/api/orders/{n}").json())
        assert seen[0] == seen[1] == who.c.get(f"/api/orders/{n}").json()
    finally:
        cancel_quietly(who, [n])


def test_wf_stock_races_sold_out_checkout(browser: Any, app_url: str) -> None:
    a, b = signup(app_url, "loser"), signup(app_url, "winner")
    code = add_build(a, picks("CR-58"))
    add_acc(a, "ACC-BAG")
    add_build(b, picks("CR-58"))
    won = None
    try:
        with browse(browser, app_url, "/boards", reduced_motion="reduce") as boards:
            shows(boards, "Out of Stock")
            before = out_of_stock_badges(boards)
            with as_user(browser, app_url, "/checkout", a.email, PASSWORD, reduced_motion="reduce") as page:
                fill_checkout(page, a, "US", US_POSTAL)
                wait_for(page, lambda: page.get_by_role("progressbar", name="Checkout progress").get_attribute("aria-valuenow") == "2")
                won = placed(b)["number"]
                click(page.get_by_role("button", name="Place order"))
                shows(page, f"Sorry, Crest 5'8 build {code} just sold out. Your cart has been updated.")
            assert [l["sku"] for l in a.c.get("/api/cart").json()["lines"]] == ["ACC-BAG"]
            assert a.c.get("/api/orders").json()["orders"] == []
            boards.reload()
            wait_for(boards, lambda: out_of_stock_badges(boards) == before + 1)
    finally:
        if won:
            cancel_quietly(b, [won])


def test_wf_stock_races_load_more(browser: Any, app_url: str) -> None:
    who = signup(app_url, "loadmore")
    numbers = []
    try:
        for _ in range(BULK_ORDERS):
            add_acc(who, "ACC-BAG")
            numbers.append(placed(who)["number"])
        with as_user(browser, app_url, "/account", who.email, PASSWORD, reduced_motion="reduce") as page:
            shows(page, numbers[-1])
            wait_for(page, lambda: page.get_by_role("button", name="Load more orders").is_visible())
            add_acc(who, "ACC-BAG")
            numbers.append(placed(who)["number"])
            click(page.get_by_role("button", name="Load more orders"))
            announced(page, r"\d+ more orders shown\.")
            load_all(page)
            body = page_text(page)
            per_row = body.count(numbers[-2])
            assert per_row >= 1 and all(body.count(n) == per_row for n in numbers[:-1])
        with as_user(browser, app_url, "/staff", *STAFF["admin"], reduced_motion="reduce") as page:
            click(page.get_by_role("tab", name="Orders"))
            reveal(page, page.get_by_role("button", name=f"Mark shipped {numbers[0]}"))
            body = page_text(page)
            per_row = body.count(numbers[-1])
            assert per_row >= 1 and all(body.count(n) == per_row for n in numbers)
    finally:
        cancel_quietly(who, numbers)


def submit_trade_in_ui(page: Any) -> None:
    select(page.get_by_label("Current board"), "Tern Foils")
    enter(page.get_by_label("Model year"), "2022")
    click(page.get_by_role("radio", name="B", exact=True))
    fill(page.get_by_label("Serial number"), "ABC12345")
    click(page.get_by_role("button", name="Submit trade-in"))


def test_wf_trade_in_quote_accept(browser: Any, app_url: str, mail: Any) -> None:
    who = signup(app_url, "tradeui")
    with as_user(browser, app_url, "/trade-in", who.email, PASSWORD, reduced_motion="reduce") as page:
        wait_for(page, lambda: page.get_by_role("heading", name="Trade your board for credit toward a Crest.").is_visible())
        submit_trade_in_ui(page)
        announced(page, r"Trade-in submitted\.")
        shows(page, "Submitted")
    t = who.c.get("/api/trade-ins/mine").json()["trade_ins"][0]
    assert t["status"] == "submitted"
    with as_user(browser, app_url, "/staff", *STAFF["support"], reduced_motion="reduce") as page:
        click(page.get_by_role("tab", name="Trade-ins"))
        click(page.get_by_role("button", name=f"Quote {t['id']}"))
        amount = page.get_by_label("Amount in dollars")
        fill(amount, f"{QUOTE_CENTS // 100}.{QUOTE_CENTS % 100:02d}")
        amount.press("Enter")
        announced(page, r"Quote saved\.")
    quoted = who.c.get(f"/api/trade-ins/{t['id']}").json()
    assert quoted["status"] == "quoted" and quoted["quote_cents"] == QUOTE_CENTS
    assert len([m for m in mail_to(mail, who.email) if m.get("Subject") == f"Trade-in quoted: {money(QUOTE_CENTS)}"]) == 1
    exp = parse_iso(quoted["quote_expires_at"])
    with as_user(browser, app_url, "/trade-in", who.email, PASSWORD, reduced_motion="reduce") as page:
        shows(page, f"Credit {money(QUOTE_CENTS)}")
        shows(page, f"Valid until {long_date(quoted['quote_expires_at'])}, {exp:%H:%M} UTC")
        shows(page, "Quoted")
        click(page.get_by_role("button", name="Accept quote"))
        announced(page, r"Quote accepted\.")
        shows(page, "Accepted")
    assert who.c.get(f"/api/trade-ins/{t['id']}").json()["status"] == "accepted"


def test_wf_trade_in_expired(browser: Any, app_url: str) -> None:
    who = signup(app_url, "tradeexp")
    with server_clock(app_url) as clock:
        clock("2031-07-07T09:00:00Z")
        t = submit_trade_in(who)
        q = staff_quote(app_url, t["id"], QUOTE_CENTS)
        clock(q["quote_expires_at"])
        with as_user(browser, app_url, "/trade-in", who.email, PASSWORD, reduced_motion="reduce") as page:
            shows(page, f"This quote expired on {long_date(q['quote_expires_at'])}.")
            shows(page, "Expired")
            assert page.get_by_role("button", name="Accept quote").count() == 0
            submit_trade_in_ui(page)
            announced(page, r"Trade-in submitted\.")
        mine = who.c.get("/api/trade-ins/mine").json()["trade_ins"]
        assert [x["status"] for x in mine] == ["submitted", "expired"]


def test_wf_demo_days_dst_labels(browser: Any, app_url: str) -> None:
    slot = new_slot(app_url, 5, 3)
    label = slot_label(slot["starts_at"], slot["ends_at"], "Europe/Berlin")
    who = signup(app_url, "dst")
    with as_user(browser, app_url, "/locations", who.email, PASSWORD, reduced_motion="reduce") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": TOKYO})
        page.reload()
        wait_for(page, lambda: page.get_by_role("heading", name="Demo stations near you").is_visible())
        fill(page.get_by_role("textbox", name="Latitude"), str(LOCATIONS[5][3]))
        lon = page.get_by_role("textbox", name="Longitude")
        fill(lon, str(LOCATIONS[5][4]))
        lon.press("Enter")
        shows(page, "Elbe Foil Station")
        shows(page, "0.0 km")
        click(page.get_by_role("button", name=f"See demo days at {LOCATIONS[5][0]}"))
        shows(page, "Sat 26 Oct 2030, 10:00 to 12:00 local time")
        shows(page, "Sun 27 Oct 2030, 10:00 to 12:00 local time")
        shows(page, "3 of 3 seats left")
        click(page.get_by_role("button", name=f"Book a seat, {label}"))
        announced(page, r"Seat booked\. 2 of 3 seats left\.")
        shows(page, "2 of 3 seats left")
    listed = {s["id"]: s for s in http(app_url).get(f"/api/locations/{slot['location_id']}/slots").json()["slots"]}
    assert listed[slot["id"]]["seats_left"] == 2 and listed[slot["id"]]["label"] == label
    assert slot["id"] in [b["slot_id"] for b in who.c.get("/api/demo-bookings/mine").json()["bookings"]]


def test_wf_demo_days_booking_race(browser: Any, app_url: str) -> None:
    slot = new_slot(app_url, 6, 1)
    label = slot_label(slot["starts_at"], slot["ends_at"], "Europe/Paris")
    a, b = signup(app_url, "racea"), signup(app_url, "raceb")
    with as_user(browser, app_url, "/locations", a.email, PASSWORD, reduced_motion="reduce") as page:
        select(page.get_by_role("combobox", name="City"), "Nice")
        page.get_by_role("textbox", name="Longitude").press("Enter")
        click(page.get_by_role("button", name=f"See demo days at {LOCATIONS[6][0]}"))
        button = page.get_by_role("button", name=f"Book a seat, {label}")
        wait_for(page, lambda: button.is_visible())
        assert book(b, slot["id"]).status_code == 201
        click(button)
        wait_for(page, lambda: page.get_by_role("alert").filter(has_text="This demo day is fully booked.").first.is_visible())
        shows(page, "Fully booked")
        wait_for(page, lambda: button.count() == 0)
    assert slot["id"] not in [x["slot_id"] for x in a.c.get("/api/demo-bookings/mine").json()["bookings"]]


def fill_callback(page: Any, email: str, name: str, time_value: str) -> None:
    fill(page.get_by_role("textbox", name="Name", exact=True), name)
    fill(page.get_by_role("textbox", name="Email", exact=True), email)
    fill(page.get_by_role("textbox", name="Phone", exact=True), PHONE)
    select(page.get_by_label("Timezone"), "Europe/Berlin")
    fill(page.get_by_label("Preferred date"), BERLIN_LOCAL[:10])
    select(page.get_by_label("Preferred time"), time_value)
    select(page.get_by_label("Topic"), "Choosing a board")


def test_wf_callbacks_build_panel(browser: Any, app_url: str, mail: Any) -> None:
    code = save(http(app_url), picks("DR-49"))
    email = ident("cbui")[0]
    with server_clock(app_url) as clock:
        clock(CALL_NOW)
        with browse(browser, app_url, f"/callback?build={code}&view=side", reduced_motion="reduce") as page:
            panel = page.get_by_role("region", name="Build to discuss")
            v = panel.get_by_role("region", name="Board viewer")
            wait_for(page, lambda: v.get_attribute("data-ready") == "true")
            assert v.get_attribute("data-parts").split(",") == ["DR-49", *BOARDS["DR-49"]["defaults"]]
            pose_ok(page, 0, 0, BASE_DISTANCE, "side")
            shows(page, f"Drift 4'9, {money(BOARDS['DR-49']['price'])}")
            fill_callback(page, email, CALLER, "09:00")
            click(page.get_by_role("button", name="Request call"))
            wait_for(page, lambda: THANKS_RE.search(page_text(page)) is not None)
            ref = re.search(r"(CB-\d+)", page_text(page)).group(1)
            assert panel.is_visible()
    notices = [n for n in outbox(app_url) if n["reference"] == ref]
    assert len(notices) == 1 and notices[0]["to"] == email and notices[0]["template"] == "callback_requested"
    message = [m for m in mail_to(mail, email) if m.get("Subject") == f"Callback requested: {ref}"]
    assert len(message) == 1 and f"Build {code}" in body_lines(message[0]) and BERLIN_LINE in body_lines(message[0])


def test_wf_callbacks_field_errors(browser: Any, app_url: str) -> None:
    email = ident("cberr")[0]
    with server_clock(app_url) as clock:
        clock(CALL_NOW)
        with browse(browser, app_url, "/callback", reduced_motion="reduce") as page:
            wait_for(page, lambda: page.get_by_role("heading", name="Book a call with a rider advisor").is_visible())
            fill_callback(page, email, "Ana\u2028Lee", OUT_OF_HOURS)
            click(page.get_by_role("button", name="Request call"))
            shows(page, "Enter your name.")
            shows(page, "We call on weekdays between 9:00 and 17:00 your time.")
            name = page.get_by_role("textbox", name="Name", exact=True)
            wait_for(page, lambda: focused(name))
            assert page.get_by_role("textbox", name="Email", exact=True).input_value() == email
            assert [n for n in outbox(app_url) if n["to"] == email] == []
            fill(name, "Ana Lee")
            select(page.get_by_label("Preferred time"), "10:00")
            click(page.get_by_role("button", name="Request call"))
            wait_for(page, lambda: THANKS_RE.search(page_text(page)) is not None)
    assert len([n for n in outbox(app_url) if n["to"] == email]) == 1


def track_ui(page: Any, number: str, email: str) -> None:
    fill(page.get_by_role("textbox", name="Order number"), number)
    fill(page.get_by_role("textbox", name="Order email"), email)
    click(page.get_by_role("button", name="Track order"))


def test_wf_tracking_lookup_found(browser: Any, app_url: str) -> None:
    who = signup(app_url, "trackui")
    add_acc(who, "ACC-BAG")
    n = placed(who)["number"]
    try:
        with browse(browser, app_url, "/track", reduced_motion="reduce") as page:
            track_ui(page, n, ident("wrong")[0])
            shows(page, "We could not find an order with those details.")
            track_ui(page, n, who.email.upper())
            wait_for(page, lambda: re.search(r"placed", page_text(page), re.I) is not None)
            assert "We could not find an order with those details." not in page_text(page)
        assert http(app_url).post("/api/track", json={"order_number": n, "email": who.email}).json()["status"] == "placed"
    finally:
        cancel_quietly(who, [n])


def test_wf_tracking_lookup_limit(browser: Any, app_url: str) -> None:
    who = signup(app_url, "trackmax")
    add_acc(who, "ACC-BAG")
    n = placed(who)["number"]
    try:
        with browse(browser, app_url, "/track", reduced_motion="reduce") as page:
            for _ in range(5):
                track_ui(page, UNKNOWN_ORDER, who.email)
                shows(page, "We could not find an order with those details.")
            track_ui(page, n, who.email)
            shows(page, "Too many attempts. Try again later.")
            track_ui(page, UNKNOWN_ORDER, ident("other")[0])
            shows(page, "We could not find an order with those details.")
        blocked = http(app_url).post("/api/track", json={"order_number": n, "email": who.email})
        assert blocked.status_code == 429 and blocked.headers.get("retry-after")
    finally:
        cancel_quietly(who, [n])


def test_wf_tracking_lookup_support_case(browser: Any, app_url: str) -> None:
    email = ident("supportui")[0]
    with browse(browser, app_url, "/support", reduced_motion="reduce") as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Subject"), CASE_SUBJECT)
        fill(page.get_by_role("textbox", name="Message"), "How long does a full charge take for the board?")
        click(page.get_by_role("button", name="Open case"))
        wait_for(page, lambda: re.search(r"Case SC-\d+ opened\.", page_text(page)) is not None)
        ref = re.search(r"(SC-\d+)", page_text(page)).group(1)
        page.goto(app_url + "/track")
        fill(page.get_by_role("textbox", name="Case reference"), ref)
        fill(page.get_by_role("textbox", name="Case email"), email)
        click(page.get_by_role("button", name="Find case"))
        wait_for(page, lambda: re.search(r"open", page_text(page), re.I) is not None)
    found = http(app_url).post("/api/cases/lookup", json={"reference": ref, "email": email})
    assert found.status_code == 200 and found.json()["subject"] == CASE_SUBJECT


def test_wf_access_control_signup_login(browser: Any, app_url: str) -> None:
    email = ident("signupui")[0]
    with browse(browser, app_url, "/signup", reduced_motion="reduce") as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        fill(page.get_by_label("Confirm password"), NEW_PASSWORD)
        click(page.get_by_role("button", name="Create account"))
        shows(page, "Passwords do not match.")
        fill(page.get_by_label("Confirm password"), PASSWORD)
        click(page.get_by_role("button", name="Create account"))
        wait_for(page, lambda: urlparse(page.url).path == "/account")
        assert page.request.get(app_url + "/api/me").json()["user"]["email"] == email
        click(page.get_by_role("button", name="Account"))
        click(page.get_by_role("button", name="Sign out"))
        wait_for(page, lambda: page.request.get(app_url + "/api/me").status == 401)
        for _ in range(3):
            try:
                page.goto(app_url + "/login")
                break
            except Exception as error:
                if "interrupted by another navigation" not in str(error):
                    raise
                page.wait_for_load_state()
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_for(page, lambda: urlparse(page.url).path == "/account")
        page.goto(app_url + "/forgot-password")
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        click(page.get_by_role("button", name="Send reset link"))
        shows(page, "If an account exists for that email, a reset link is on its way.")


def test_wf_access_control_staff_tabs(browser: Any, app_url: str) -> None:
    tabs = {"admin": ["Trade-ins", "Demo days", "Orders", "Outbox"], "dealer": ["Demo days"], "support": ["Trade-ins", "Outbox"]}
    for role, names in tabs.items():
        with as_user(browser, app_url, "/staff", *STAFF[role], reduced_motion="reduce") as page:
            tablist = page.get_by_role("tablist", name="Staff console")
            wait_for(page, lambda: tablist.is_visible())
            assert tablist.get_by_role("tab").count() == len(names)
            for name in names:
                assert tablist.get_by_role("tab", name=name, exact=True).count() == 1
    who = signup(app_url, "nostaff")
    with as_user(browser, app_url, "/staff", who.email, PASSWORD, reduced_motion="reduce") as page:
        shows(page, "You do not have access to this page.")
        assert page.get_by_role("tablist", name="Staff console").count() == 0
    with browse(browser, app_url, "/staff", reduced_motion="reduce") as page:
        wait_for(page, lambda: urlparse(page.url).path == "/login")
        assert query(page).get("next") == "/staff"
    err(staff(app_url, "dealer").c.post(f"/api/staff/orders/{UNKNOWN_ORDER}/ship"), 403, "forbidden")


def test_wf_newsletter_partners_newsletter(browser: Any, app_url: str) -> None:
    email = ident("newsui")[0]
    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        box = page.get_by_role("textbox", name="Newsletter email")
        fill(box, email)
        click(page.get_by_role("button", name="Sign up for the newsletter"))
        shows(page, "Please agree to the terms to sign up.")
        check(page.get_by_role("checkbox", name="I agree to receive the dispatch and have read the privacy notice"))
        with held(page, "**/api/newsletter") as gate:
            click(page.get_by_role("button", name="Sign up for the newsletter"))
            shows(page, "Signing up...")
            gate.release()
        shows(page, "Thanks for subscribing.")
        assert duplicate_controls(page) == []
    again = http(app_url).post("/api/newsletter", json={"email": email, "consent": True})
    assert again.status_code == 200


def test_wf_newsletter_partners_search(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        opener = page.get_by_role("button", name="Search", exact=True).first
        click(opener)
        dialog = page.get_by_role("dialog", name="Search")
        box = dialog.get_by_role("searchbox", name="Search the catalog")
        wait_for(page, lambda: box.is_visible())
        fill(box, "18l")
        wait_for(page, lambda: "4'0 18L Tow board" in dialog.get_by_role("list", name="Search results").inner_text())
        fill(box, "%%")
        wait_for(page, lambda: "No matches." in dialog.inner_text())
        fill(box, "x")
        box.press("Enter")
        wait_for(page, lambda: "Enter 2 to 64 characters." in dialog.inner_text())
        box.focus()
        for _ in range(4):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        wait_for(page, lambda: not dialog.is_visible() and focused(opener))


def test_wf_deployment_storage_second_instance_build(browser: Any, app_url: str) -> None:
    second = os.environ["APP_KILLBILL_DOWN_URL"]
    with browse(browser, app_url, build_path(picks("DR-54", rider=105, gear=7)), reduced_motion="reduce") as page:
        ready(page)
        click(summary(page).get_by_role("button", name="Save build"))
        wait_for(page, lambda: urlparse(page.url).path.startswith("/build/"))
        code = urlparse(page.url).path.rsplit("/", 1)[1]
        parts, colours = viewer(page).get_attribute("data-parts"), viewer(page).get_attribute("data-colours")
    with browse(browser, second, f"/build/{code}?view=top", reduced_motion="reduce") as page:
        ready(page)
        assert viewer(page).get_attribute("data-parts") == parts and viewer(page).get_attribute("data-colours") == colours
        pose_ok(page, 0, 90, BASE_DISTANCE, "top")
        assert money(expected_build(picks("DR-54", rider=105, gear=7))["total"]) in summary(page).inner_text()
    assert http(second).get(f"/api/builds/{code}").json() == http(app_url).get(f"/api/builds/{code}").json()
    guest = http(app_url)
    add_acc(guest, "ACC-CHG", 2)
    assert http(second, cookie_header(guest)).get("/api/cart").json() == guest.get("/api/cart").json()


def test_wf_deployment_storage_second_instance_order(browser: Any, app_url: str) -> None:
    second = os.environ["APP_KILLBILL_DOWN_URL"]
    who = signup(app_url, "secondinst")
    add_acc(who, "ACC-CHG")
    order = placed(who)
    n = order["number"]
    try:
        with as_user(browser, second, f"/account/orders/{n}", who.email, PASSWORD, reduced_motion="reduce") as page:
            shows(page, n)
            shows(page, money(order["total_cents"]))
            shows(page, f"Billing account {order['billing_account_key']}")
        assert login(second, who.email, PASSWORD).get(f"/api/orders/{n}").json() == who.c.get(f"/api/orders/{n}").json()
        here = [(x["id"], x["template"], x["subject"]) for x in outbox(app_url) if x["reference"] == n]
        there = [(x["id"], x["template"], x["subject"]) for x in outbox(second) if x["reference"] == n]
        assert here == there and len(here) == 1 and here[0][2] == f"Order confirmed: {n}"
    finally:
        cancel_quietly(who, [n])


def test_wf_cross_cutting_layouts(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        for vp, (w, h) in VIEWPORTS.items():
            page.set_viewport_size({"width": w, "height": h})
            for path in LAYOUT_PAGES:
                page.goto(app_url + path)
                page.wait_for_load_state()
                layout(page)
            if vp == "phone":
                page.goto(app_url + "/")
                menu = page.get_by_role("button", name="Menu")
                wait_for(page, lambda: menu.is_visible())
                assert not page.get_by_role("button", name="Boards", exact=True).is_visible()
                click(menu)
                wait_for(page, lambda: page.get_by_role("dialog", name="Menu").is_visible() and menu.get_attribute("aria-expanded") == "true")
                page.goto(app_url + "/build")
                ready(page)
                bar = summary(page)
                box = bar.bounding_box()
                assert abs(box["y"] + box["height"] - h) <= FIXED_TOL_PX
                assert bar.get_by_role("button", name="Add to cart").is_visible()
                page.mouse.wheel(0, SCROLL_PROBE)
                wait_for(page, lambda: page.evaluate("window.scrollY") > 0)
                box = bar.bounding_box()
                assert abs(box["y"] + box["height"] - h) <= FIXED_TOL_PX
            if vp == "desktop":
                page.goto(app_url + "/")
                assert page.get_by_role("button", name="Boards", exact=True).is_visible()
                assert not page.get_by_role("button", name="Menu").is_visible()


def test_wf_cross_cutting_keyboard_and_axe(browser: Any, app_url: str) -> None:
    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        wait_for(page, lambda: page.get_by_role("heading", name="Lift off quietly").is_visible())
        order = tab_order(page, 4)
        assert "Trade in your old board for credit" in order and "Tern Foils home" in order
        assert order.index("Trade in your old board for credit") < order.index("Tern Foils home")
        rest, focus = state_styles(page.get_by_role("link", name="Trade in your old board for credit"), "outline-style", "outline-width", "box-shadow", state="focus")
        assert rest != focus
        for path in ("/", "/build", "/cart", "/match", "/track", "/signup", "/locations", "/callback"):
            page.goto(app_url + path)
            page.wait_for_load_state()
            if path == "/build":
                ready(page)
            axe(page)
            if path != "/locations":
                assert duplicate_controls(page) == [], path
    who = signup(app_url, "axe")
    add_acc(who, "ACC-BAG")
    with as_user(browser, app_url, "/checkout", who.email, PASSWORD, reduced_motion="reduce") as page:
        wait_for(page, lambda: page.get_by_role("button", name="Place order").is_visible())
        axe(page)
        assert duplicate_controls(page) == []
        page.goto(app_url + "/account")
        page.wait_for_load_state()
        axe(page)
    with as_user(browser, app_url, "/staff", *STAFF["admin"], reduced_motion="reduce") as page:
        wait_for(page, lambda: page.get_by_role("tablist", name="Staff console").is_visible())
        axe(page)


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
FONTS = ("Montserrat", "Open Sans")
NPM_TIMEOUT = 600
OTHER_STORES = ("sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "lowdb", "nedb", "level", "mongodb", "mongoose")


def npm_tree() -> dict[str, Any]:
    from conftest import DEPLOYED_APP
    root = DEPLOYED_APP if Path(DEPLOYED_APP, "node_modules").is_dir() else APP_DIR
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=root, capture_output=True, text=True, timeout=NPM_TIMEOUT)
    data = json.loads(out.stdout or "{}")
    pkgs: dict[str, Any] = {}

    def walk(deps: dict[str, Any] | None) -> None:
        for name, info in (deps or {}).items():
            if not info.get("version"):
                continue
            licence = info.get("license")
            if licence is None and info.get("path"):
                manifest = Path(info["path"], "package.json")
                if manifest.exists():
                    licence = json.loads(manifest.read_text()).get("license")
            pkgs[name] = licence
            walk(info.get("dependencies"))

    walk(data.get("dependencies"))
    return pkgs


def licence_ok(licence: Any) -> bool:
    if isinstance(licence, dict):
        licence = licence.get("type")
    if not isinstance(licence, str):
        return False
    expr = licence.replace("(", " ").replace(")", " ").strip()
    if " OR " in expr:
        return any(licence_ok(part.strip()) for part in expr.split(" OR "))
    if " AND " in expr:
        return all(licence_ok(part.strip()) for part in expr.split(" AND "))
    return expr in ALLOWED_LICENCES


def test_if_run_manifest() -> None:
    data = json.loads(Path(APP_DIR, "run.json").read_text())
    assert isinstance(data, dict) and data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip()


def test_if_user_readme() -> None:
    body = Path(APP_DIR, "USER_README.md").read_text()
    for role, (email, password) in STAFF.items():
        assert email in body and password in body and role in body.lower()


def test_if_third_party_notices() -> None:
    body = Path(APP_DIR, "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in npm_tree() if name not in body]
    assert missing == []
    for font in FONTS:
        assert font in body


def test_if_licences() -> None:
    bad = {name: licence for name, licence in npm_tree().items()
           if not (licence_ok(licence) or ("font" in name.lower() and "OFL" in str(licence).upper()))}
    assert bad == {}
    body = Path(APP_DIR, "THIRD_PARTY_NOTICES.md").read_text()
    assert re.search(r"Open Font License|\bOFL\b", body, re.I)


def test_if_no_other_datastore() -> None:
    tree = npm_tree()
    assert [name for name in OTHER_STORES if name in tree] == []
    files = [p for p in Path(APP_DIR).rglob("*") if "node_modules" not in p.parts and p.suffix in (".sqlite", ".sqlite3", ".db")]
    assert files == []
    procs = []
    for cmd in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            line = cmd.read_bytes().replace(b"\0", b" ").decode(errors="ignore")
        except OSError:
            continue
        if any(name in line for name in ("redis-server", "mongod", "sqlite3 ")):
            procs.append(line)
    assert procs == []


def test_if_browser_dirs() -> None:
    for name in (".browser_screenshots", ".downloads"):
        d = Path(APP_DIR, name)
        assert d.is_dir() and list(d.iterdir()) == []
