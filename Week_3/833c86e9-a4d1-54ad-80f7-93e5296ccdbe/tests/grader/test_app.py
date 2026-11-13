from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import itertools
import json
import math
import os
import re
import signal
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qsl, quote, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    center,
    click,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    style,
    tap,
    unique,
)

UTC = dt.timezone.utc

CLOCK_START = "2027-03-01T09:00:00Z"
TODAY = dt.date.fromisoformat(CLOCK_START[:10])
START_TABLE = {"EUR": 1000000, "USD": 1080000, "JPY": 161500000, "KWD": 332000}
DECIMALS = {"EUR": 2, "USD": 2, "JPY": 0, "KWD": 3}
HOLD_MS = 900000
QUOTE_TTL_MS = 600000
REVIEW_WINDOW_MS = 2592000000
MAP_DEBOUNCE_MS = 400
TYPE_DEBOUNCE_MS = 200
IMPORT_MAX_BYTES = 1000000
JSON_MAX_BYTES = 65536
LOYALTY_DAYS = 730
HERON_PCT = 5
COMMISSION_PCT = 9
HALF_LIFE_DAYS = 180
COMMENT_MAX = 2000
NO_REVIEW_SCORE10 = 60
BUCKET_MINOR = 5000
BUCKETS = 12
MAX_ADULTS = 16
SHEET_MS = 240
GALLERY_MS = 240
NIGHT_EXPAND_MS = 320
SWIPE_PX = 60
FOCUS_RING_PX = 3
TAP_MIN_PX = 44
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desk": (1280, 800), "narrow": (320, 812)}
ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
PASSWORD = "secret-pass"
GIVEN, SURNAME = "Ada", "Lind"
COMMENT = "Quiet harbour room."
CARD_OK = "9000 0000 0000 0002"
CARD_DECLINED = "9000 0000 0000 0010"
CARD_EXPIRED = "9000 0000 0000 0028"
CARD_STEP_UP = "9000 0000 0000 0036"
STEP_UP_CODE = "1234"
FREE_TIER = {"days_before": 3, "hour": 18, "refund_pct": 100}
HALF_TIER = {"days_before": 1, "hour": 18, "refund_pct": 50}
LINE_KEYS = ("plan_rate", "occupancy", "children", "length_of_stay", "early_booking", "last_minute", "loyalty", "breakfast", "vat", "city_tax", "tourism_levy", "night_total")
LABELS = {"plan_rate": "Plan rate", "occupancy": "Occupancy", "children": "Children", "length_of_stay": "Length of stay", "early_booking": "Early booking", "last_minute": "Last minute", "loyalty": "Loyalty", "breakfast": "Breakfast", "vat": "VAT", "city_tax": "City tax", "tourism_levy": "Tourism levy", "night_total": "Night total"}
WORKED_STEPS = (12000, 14500, 16000, 14400, 13680)
WORKED_BREAKFAST, WORKED_TAXABLE, WORKED_VAT, WORKED_CITY, WORKED_LEVY = 3600, 17280, 1210, 900, 90
WORKED_NIGHTS = (19480, 22224, 19480)
WORKED_TOTAL = 61184
WORKED_SECOND_BASE = 15000
WORKED_LEAD_DAYS = 90
WORKED_CONVERTED = {"USD": (66079, (21039, 24002, 21038)), "JPY": (98812, (31460, 35892, 31460)), "KWD": (203131, (64674, 73784, 64673))}
SCORE_EXAMPLE = ((9, 0), (7, 180), (5, 360))
SCORE_EXAMPLE_SHOWN = 79
BASE_RATE = 12000
CHECKOUT_EXAMPLE = "2027-01-10"
AGE_LABEL = "Age of child {n}"
ROOMS_SPIN = "{room type name} rooms"
CLUSTER = "{count:property}, zoom in"
LANGUAGE_BOX = re.compile("^(Language|Sprache|اللغة)$")
PROPERTIES = "{n} properties"
CANCEL_ROOM = "Cancel room {n}"
REPLACE_BTN = "Replace {season}"
PICTURE = "Picture {i} of {n}"
RATE_FOR = "Rate for room {n}"
BREAKFAST_FOR = "Breakfast for room {n}"
CARD_LABEL = "Card number"
DECLINED = "Your card was declined. Try another card."
MAX_LABEL = "Maximum stay"
MAX_BELOW_MIN = "Maximum stay must not be below minimum stay."
UNKNOWN_PREFIX = "/no-such-"
FORMULA_SURNAME = "=SUM(1)"


def sub(template: str, key: str, value: Any) -> str:
    return template.replace("{" + key + "}", str(value))

EXPIRY = "12/29"
SECURITY = "123"
PROBE_TABLE = {"EUR": 1000000, "USD": 1234567, "JPY": 98765432, "KWD": 456789}
DST_SPRING = "2027-03-28"
DST_AUTUMN = "2027-10-31"
OTHER_ZONE = "America/New_York"
FOREIGN_ORIGIN = "http://elsewhere.invalid"
PRIVATE_PATHS = ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts")
FORBIDDEN_PACKAGES = ("redis", "ioredis", "mongodb", "mongoose", "amqplib", "kafkajs", "nodemailer", "stripe", "bullmq", "meilisearch", "memcached", "sqlite3", "better-sqlite3", "mysql", "mysql2")
RACE_CLIENTS = 6
LOOKUP_PROBES = 1500
HTTP_TIMEOUT = 60
WAIT_S = 25
BOOT_S = 180
SHORT_MS = 250
STEP_MS = 20
EDGE_MARGIN_MS = 1000
CLOCK_DRIFT_MS = 120000
TABS_MAX = 80
TRAP_PRESSES = 25
MAX_PAGES = 20
GAP_SEARCH_MIN = 180
PAGE_SIZE_PROBE = 8

FMT_JS = """([kind, value, lang, zone, extra]) => {
  const loc = {en: 'en-GB', de: 'de-DE', ar: 'ar-KW'}[lang];
  if (kind === 'money') {
    const d = {EUR: 2, USD: 2, JPY: 0, KWD: 3}[extra];
    return new Intl.NumberFormat(loc, {style: 'currency', currency: extra, numberingSystem: 'latn'}).format(value / 10 ** d);
  }
  if (kind === 'num1') {
    return new Intl.NumberFormat(loc, {minimumFractionDigits: 1, maximumFractionDigits: 1, numberingSystem: 'latn'}).format(value);
  }
  const parts = {date: {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'},
                 daymonth: {day: 'numeric', month: 'long'},
                 wdm: {weekday: 'long', day: 'numeric', month: 'long'},
                 monthyear: {month: 'long', year: 'numeric'}}[kind];
  return new Intl.DateTimeFormat(loc, {...parts, numberingSystem: 'latn', timeZone: zone}).format(new Date(value + 'T12:00:00Z'));
}"""

RECORD_JS = """() => {
  if (window.__kipRec) return;
  window.__kipRec = [];
  const original = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = original.call(this, keyframes, options);
    window.__kipRec.push(animation);
    return animation;
  };
}"""
RECORDED_JS = """() => {
  const all = new Set([...(window.__kipRec || []), ...document.getAnimations()]);
  return [...all].map(a => ({id: a.id, duration: a.effect ? a.effect.getTiming().duration : null}));
}"""


def rnd(a: int, b: int) -> int:
    return (2 * a + b) // (2 * b)


def off(x: int, p: int) -> int:
    return x - rnd(x * p, 100)


def convert(eur_nights: list[int], ppm: int, cur: str) -> tuple[int, list[int]]:
    den = 100 * 10**6
    num = [a * ppm * 10 ** DECIMALS[cur] for a in eur_nights]
    total = rnd(sum(num), den)
    whole = [n // den for n in num]
    order = sorted(range(len(num)), key=lambda i: (-(num[i] % den), i))
    for i in order[: total - sum(whole)]:
        whole[i] += 1
    return total, whole


def day(n: int, base: dt.date = TODAY) -> str:
    return (base + dt.timedelta(days=n)).isoformat()


def span(din: str, dout: str) -> list[str]:
    a, b = dt.date.fromisoformat(din), dt.date.fromisoformat(dout)
    return [(a + dt.timedelta(days=i)).isoformat() for i in range((b - a).days)]


def instant(text: str) -> dt.datetime:
    return dt.datetime.fromisoformat(text.replace("Z", "+00:00"))


def iso_ms(moment: dt.datetime) -> str:
    moment = moment.astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def ms_between(a: dt.datetime, b: dt.datetime) -> int:
    return round((b - a).total_seconds() * 1000)


def local_moment(day_iso: str, hour: int, zone: str) -> dt.datetime:
    tz = ZoneInfo(zone)
    d = dt.date.fromisoformat(day_iso)
    wall = dt.datetime(d.year, d.month, d.day, hour, 0)
    for minute in range(GAP_SEARCH_MIN):
        cand = wall + dt.timedelta(minutes=minute)
        aware = cand.replace(tzinfo=tz, fold=0)
        if aware.astimezone(UTC).astimezone(tz).replace(tzinfo=None) == cand:
            return aware.astimezone(UTC)
    pytest.fail(f"no valid wall time after {wall} in {zone}")


def deadline(arrival: str, tier: dict, zone: str) -> dt.datetime:
    return local_moment(day(-tier["days_before"], dt.date.fromisoformat(arrival)), tier["hour"], zone)


def completion(out: str, zone: str = "Europe/Lisbon") -> dt.datetime:
    return local_moment(out, 11, zone)


def hhmm(moment: dt.datetime, zone: str) -> str:
    return moment.astimezone(ZoneInfo(zone)).strftime("%H:%M")


class Api:
    def __init__(self, base: str, visitor: bool = True):
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        if visitor:
            self.http.get("/api/time")

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.get(path, **kw)

    def send(self, method: str, path: str, body: Any = None, headers: dict | None = None) -> httpx.Response:
        return self.http.request(method, path, json=body, headers=headers or {})

    def post(self, path: str, body: Any = None, headers: dict | None = None) -> httpx.Response:
        return self.send("POST", path, body, headers)

    def patch(self, path: str, body: Any = None, headers: dict | None = None) -> httpx.Response:
        return self.send("PATCH", path, body, headers)

    def sign_in(self, username: str) -> "Api":
        r = self.post("/api/grading/session", {"username": username})
        assert r.status_code == 200, f"POST /api/grading/session answered {r.status_code} {r.text}"
        return self


def poll(fn: Callable[[], Any], contract: str, seconds: float = WAIT_S) -> Any:
    deadline_at = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline_at:
        last = fn()
        if last:
            return last
    pytest.fail(f"{contract}; last value {last!r}")


def fresh(app_url: str) -> Api:
    api = Api(app_url)
    set_clock(api, CLOCK_START)
    r = api.post("/api/grading/currency", START_TABLE)
    assert r.status_code == 200, r.text
    return api


def set_clock(api: Api, at: str) -> dt.datetime:
    r = api.post("/api/grading/clock", {"set": at})
    assert r.status_code == 200, f"POST /api/grading/clock answered {r.status_code} {r.text}"
    return instant(r.json()["now"])


def advance_clock(api: Api, ms: int) -> dt.datetime:
    r = api.post("/api/grading/clock", {"advance_ms": ms})
    assert r.status_code == 200, r.text
    return instant(r.json()["now"])


def server_now(api: Api) -> dt.datetime:
    return instant(api.get("/api/time").json()["now"])


def seed(api: Api, **body: Any) -> dict:
    r = api.post("/api/grading/seed", body)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code} {r.text}"
    return r.json()


def new_tag() -> str:
    first = str(unique("kw")[0])
    return hashlib.sha1(f"{first}{uuid.uuid4()}".encode()).hexdigest()[:8]


def room_type(code: str, suffix: str = "DBL", name: str = "Double", rooms: int = 1, rate: int = BASE_RATE,
              max_adults: int = 2, max_guests: int = 3) -> dict:
    return {"code": f"{code}-{suffix}", "name": name, "included_adults": 2, "max_adults": max_adults,
            "max_guests": max_guests, "extra_adult_minor": 2500, "child_minor": 1500, "rooms": rooms,
            "base_rate_minor": rate}


def night(rt: str, d: str, to: str | None = None, **fields: Any) -> dict:
    return {"room_type": rt, "from": d, "to": to or d, **fields}


class World:

    def __init__(self, api: Api, zone: str = "Europe/Lisbon"):
        self.api = api
        self.tag = new_tag()
        self.zone = zone
        self.dest = f"d{self.tag}"
        self.dest_name = f"Brineholm {self.tag.upper()}"
        self.props: dict[str, dict] = {}
        self.rates: dict[tuple[str, str], int] = {}
        self.count = 0
        seed(api, destinations=[{"code": self.dest, "name": self.dest_name, "zone": zone, "cx": 500.0, "cy": 500.0}])

    def code(self, i: int = 0) -> str:
        return f"P{self.tag.upper()}{i}"

    def name(self, i: int = 0) -> str:
        return f"Lantern Rooms {self.code(i)}"

    def spec(self, i: int = 0, rooms: int = 1, rate: int = BASE_RATE, family: tuple[int, int] | None = None,
             max_adults: int = 2, max_guests: int = 3, **kw: Any) -> dict:
        code = self.code(i)
        rts = [room_type(code, rooms=rooms, rate=rate, max_adults=max_adults, max_guests=max_guests)]
        if family:
            rts.append(room_type(code, "FAM", "Family", rooms=family[0], rate=family[1], max_adults=4, max_guests=5))
        spec = {"code": code, "name": self.name(i), "destination": self.dest, "x": 503.0, "y": 498.0, "stars": 4,
                "amenities": ["wifi"], "policy": [dict(FREE_TIER)], "vat_pct": 7, "city_minor": 300, "levy_pct": 10,
                "breakfast_minor": 900, "single_pct": 10, "room_types": rts}
        spec.update(kw)
        return spec

    def add(self, *specs: dict, nights: tuple | list = ()) -> list[str]:
        seed(self.api, properties=list(specs))
        for s in specs:
            self.props[s["code"]] = s
        if nights:
            self.nights(*nights)
        return [s["code"] for s in specs]

    def nights(self, *entries: dict) -> None:
        seed(self.api, nights=list(entries))
        for n in entries:
            if "base_rate_minor" in n:
                for d in span(n["from"], day(1, dt.date.fromisoformat(n["to"]))):
                    self.rates[(n["room_type"], d)] = n["base_rate_minor"]

    def user(self, role: str = "guest", manages: tuple = (), completed: tuple = ()) -> str:
        self.count += 1
        name = f"{role[0]}{self.tag}{self.count}"
        u: dict[str, Any] = {"username": name, "password": PASSWORD, "role": role}
        if manages:
            u["manages"] = list(manages)
        if completed:
            u["completed_stays"] = [{"property": p, "checkout": c} for p, c in completed]
        seed(self.api, users=[u])
        return name

    def rt(self, code: str, rt_code: str) -> dict:
        return next(r for r in self.props[code]["room_types"] if r["code"] == rt_code)

    def rate(self, code: str, rt_code: str, d: str) -> int:
        return self.rates.get((rt_code, d), self.rt(code, rt_code)["base_rate_minor"])


def room(rt: str, adults: int = 2, ages: tuple | list = (), plan: str = "refundable", breakfast: bool = False) -> dict:
    return {"room_type": rt, "plan": plan, "breakfast": breakfast, "adults": adults, "ages": list(ages)}


def booking_body(code: str, din: str, dout: str, guest: str | None = None, rooms: list | None = None,
                 state: str = "confirmed", surname: str = SURNAME) -> dict:
    return {"guest": guest, "given_name": GIVEN, "surname": surname, "property": code, "in": din, "out": dout,
            "currency": "EUR", "rooms": rooms or [room(f"{code}-DBL")], "state": state}


def night_lines(spec: dict, rt: dict, rm: dict, base: int, n_nights: int, lead: int, tier_pct: int) -> tuple[dict, int, int]:
    lines: dict[str, int] = {}
    x = base if rm["plan"] == "refundable" else off(base, 10)
    lines["plan_rate"] = x
    adults, ages = rm["adults"], list(rm["ages"])
    y = off(x, spec["single_pct"]) if adults == 1 and rt["included_adults"] >= 2 else x + rt["extra_adult_minor"] * max(0, adults - rt["included_adults"])
    lines["occupancy"], x = y - x, y
    y = x + sum(rt["child_minor"] if 3 <= a <= 11 else rt["extra_adult_minor"] if a >= 12 else 0 for a in ages)
    lines["children"], x = y - x, y
    y = off(x, 12) if n_nights >= 14 else off(x, 8) if n_nights >= 7 else x
    lines["length_of_stay"], x = y - x, y
    lines["early_booking"] = lines["last_minute"] = 0
    if rm["plan"] == "refundable":
        if lead >= 60:
            y = off(x, 10)
            lines["early_booking"], x = y - x, y
        elif lead <= 3 and n_nights < 7:
            y = off(x, 15)
            lines["last_minute"], x = y - x, y
    y = off(x, tier_pct)
    lines["loyalty"], x = y - x, y
    discounted = x
    eaters = adults + sum(1 for a in ages if a >= 3)
    lines["breakfast"] = spec["breakfast_minor"] * eaters if rm["breakfast"] else 0
    t = discounted + lines["breakfast"]
    lines["vat"] = rnd(t * spec["vat_pct"], 100)
    lines["city_tax"] = spec["city_minor"] * (adults + sum(1 for a in ages if a >= 12))
    lines["tourism_levy"] = rnd(lines["city_tax"] * spec["levy_pct"], 100)
    lines["night_total"] = t + lines["vat"] + lines["city_tax"] + lines["tourism_levy"]
    return {k: v for k, v in lines.items() if v != 0}, t, discounted


def price_stay(w: World, code: str, rooms: list[dict], din: str, dout: str, tier_pct: int = 0,
               today: dt.date = TODAY) -> dict:
    spec = w.props[code]
    dates = span(din, dout)
    lead = (dt.date.fromisoformat(din) - today).days
    out_nights, per_room = [], [[] for _ in rooms]
    for d in dates:
        summed: dict[str, int] = {}
        total = taxable = 0
        for i, rm in enumerate(rooms):
            lines, t, disc = night_lines(spec, w.rt(code, rm["room_type"]), rm, w.rate(code, rm["room_type"], d), len(dates), lead, tier_pct)
            per_room[i].append({"date": d, "lines": lines, "total": lines["night_total"], "t": t, "discounted": disc})
            for k, v in lines.items():
                summed[k] = summed.get(k, 0) + v
            total += lines["night_total"]
            taxable += t
        out_nights.append({"date": d, "lines": summed, "total": total, "t": taxable})
    return {"total": sum(n["total"] for n in out_nights), "nights": out_nights, "rooms": per_room,
            "room_totals": [sum(n["total"] for n in r) for r in per_room]}


def compositions(n: int, k: int) -> Iterator[tuple[int, ...]]:
    if k == 1:
        yield (n,)
        return
    for i in range(n + 1):
        for rest in compositions(n - i, k - 1):
            yield (i,) + rest


def place(w: World, code: str, combo: list[str], adults: int, ages: list[int], din: str, dout: str):
    bands = [[a for a in ages if 12 <= a <= 17], [a for a in ages if 3 <= a <= 11], [a for a in ages if a <= 2]]
    k = len(combo)
    best = None
    for ad in compositions(adults, k):
        if any(a < 1 or a > w.rt(code, rt)["max_adults"] for a, rt in zip(ad, combo)):
            continue
        for b0, b1, b2 in itertools.product(*(list(compositions(len(b), k)) for b in bands)):
            if any(ad[i] + b0[i] + b1[i] + b2[i] > w.rt(code, combo[i])["max_guests"] for i in range(k)):
                continue
            rooms, cursors = [], [0, 0, 0]
            for i in range(k):
                kids = []
                for bi, counts in enumerate((b0, b1, b2)):
                    kids += bands[bi][cursors[bi]: cursors[bi] + counts[i]]
                    cursors[bi] += counts[i]
                rooms.append(room(combo[i], ad[i], kids))
            total = price_stay(w, code, rooms, din, dout)["total"]
            key = (total,) + tuple(-x for x in ad + b0 + b1 + b2)
            if best is None or key < best[0]:
                best = (key, rooms)
    return best


def recommend(w: World, code: str, adults: int, ages: list[int], din: str, dout: str):
    rts = sorted(r["code"] for r in w.props[code]["room_types"])
    best = None
    for k in range(1, 5):
        for combo in itertools.combinations_with_replacement(rts, k):
            if any(combo.count(rt) > w.rt(code, rt)["rooms"] for rt in set(combo)):
                continue
            found = place(w, code, list(combo), adults, ages, din, dout)
            if found:
                key = (found[0][0], k, combo) + found[0][1:]
                if best is None or key < best[0]:
                    best = (key, found[1])
    return best[1], best[0][0]


def make_quote(api: Api, code: str, din: str, dout: str, rooms: list[dict], currency: str = "EUR") -> dict:
    body = {"property": code, "in": din, "out": dout, "currency": currency,
            "adults": sum(r["adults"] for r in rooms), "ages": [a for r in rooms for a in r["ages"]], "rooms": rooms}
    r = api.post("/api/quotes", body)
    assert r.status_code == 201, f"POST /api/quotes answered {r.status_code} {r.text}"
    return r.json()


def make_hold(api: Api, q: dict) -> dict:
    r = api.post("/api/holds", {"quote_id": q["id"]})
    assert r.status_code == 201, f"POST /api/holds answered {r.status_code} {r.text}"
    return r.json()


def pay_body(h: dict, q: dict, card: str = CARD_OK, **fields: Any) -> dict:
    body = {"hold_id": h["id"], "quote_id": q["id"], "given_name": GIVEN, "surname": SURNAME, "card_number": card,
            "expiry": EXPIRY, "security_code": SECURITY}
    body.update(fields)
    return body


def pay(api: Api, h: dict, q: dict, card: str = CARD_OK, key: str | None = None, **fields: Any) -> httpx.Response:
    return api.post("/api/bookings", pay_body(h, q, card, **fields), {"Idempotency-Key": key or idempotency_key()})


def book(api: Api, code: str, din: str, dout: str, rooms: list[dict], **fields: Any) -> dict:
    q = make_quote(api, code, din, dout, rooms)
    h = make_hold(api, q)
    r = pay(api, h, q, **fields)
    assert r.status_code == 201, f"POST /api/bookings answered {r.status_code} {r.text}"
    return r.json()


def get_booking(api: Api, code: str) -> tuple[dict, str]:
    r = api.get(f"/api/bookings/{code}")
    assert r.status_code == 200, f"GET /api/bookings/{code} answered {r.status_code} {r.text}"
    return r.json(), r.headers.get("etag", "")


def left(api: Api, code: str, rt: str, din: str, dout: str) -> int:
    r = api.get(f"/api/properties/{code}", params={"in": din, "out": dout, "adults": 2, "cur": "EUR"})
    assert r.status_code == 200, r.text
    return next(t["left"] for t in r.json()["room_types"] if t["code"] == rt)


def edit_nights(api: Api, code: str, rts: list[str], din: str, dout: str, **fields: Any) -> httpx.Response:
    return api.patch(f"/api/manage/{code}/nights", {"room_types": rts, "from": din, "to": dout, "weekdays": fields.pop("weekdays", ALL_WEEKDAYS), **fields})


def balanced(ledger: list[dict]) -> None:
    assert sum(e["debit_minor"] for e in ledger) == sum(e["credit_minor"] for e in ledger), ledger
    pairs: dict[Any, list[dict]] = {}
    for e in ledger:
        pairs.setdefault(e["pair"], []).append(e)
    for pair, entries in pairs.items():
        assert len(entries) == 2, f"ledger pair {pair} has {len(entries)} entries"
        assert sum(e["debit_minor"] for e in entries) == sum(e["credit_minor"] for e in entries), entries


def search_query(dest: str, din: str, dout: str, adults: int = 2, ages: tuple | list = (), lang: str = "en",
                 cur: str = "EUR", **more: Any) -> str:
    q = [("dest", dest), ("in", din), ("out", dout)]
    if adults != 2:
        q.append(("adults", str(adults)))
    if ages:
        q.append(("ages", ",".join(str(a) for a in sorted(ages))))
    q += [("lang", lang), ("cur", cur)]
    for k in ("display", "tax", "stars", "amen", "free", "min", "max", "sort", "cursor", "zoom", "cx", "cy", "sel"):
        if k in more:
            q.append((k, str(more[k])))
    return urlencode(q, safe=",~")


def search_path(w: World, din: str, dout: str, **kw: Any) -> str:
    return "/search?" + search_query(w.dest, din, dout, **kw)


def prop_path(w: World, code: str, din: str, dout: str, **kw: Any) -> str:
    return f"/properties/{code}?" + search_query(w.dest, din, dout, **kw)


def search_all(api: Api, query: str) -> tuple[dict, list[dict]]:
    first, results, cursor = None, [], None
    for _ in range(MAX_PAGES):
        r = api.get("/api/search?" + query + (f"&cursor={quote(cursor, safe='')}" if cursor else ""))
        assert r.status_code == 200, f"GET /api/search answered {r.status_code} {r.text}"
        body = r.json()
        first = first or body
        results += body["results"]
        cursor = body["next_cursor"]
        if not cursor:
            return first, results
    pytest.fail("GET /api/search kept returning next_cursor; expected paging to end")


class Stream:

    def __init__(self, api: Api):
        self.events: list[tuple[str, Any]] = []
        self.lock = threading.Lock()
        self.ctype = ""
        self.client = httpx.Client(base_url=api.base, cookies=api.http.cookies, timeout=httpx.Timeout(HTTP_TIMEOUT, read=None))
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        try:
            with self.client.stream("GET", "/api/events") as r:
                self.ctype = r.headers.get("content-type", "")
                name, data = "message", []
                for line in r.iter_lines():
                    if line == "":
                        if data:
                            try:
                                payload = json.loads("\n".join(data))
                            except ValueError:
                                payload = "\n".join(data)
                            with self.lock:
                                self.events.append((name, payload))
                        name, data = "message", []
                    elif line.startswith("event:"):
                        name = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].lstrip())
        except Exception:
            return

    def wait(self, name: str, pred: Callable[[Any], bool] = lambda d: True, seconds: float = WAIT_S) -> int:
        deadline_at = time.monotonic() + seconds
        while time.monotonic() < deadline_at:
            with self.lock:
                for i, (n, d) in enumerate(self.events):
                    if n == name and isinstance(d, dict) and pred(d):
                        return i
        with self.lock:
            seen = [n for n, _ in self.events]
        pytest.fail(f"GET /api/events never delivered a matching {name} event; saw {seen}")

    def close(self) -> None:
        self.client.close()


@contextlib.contextmanager
def browse(browser: Browser, app_url: str, path: str, *, user: str | None = None, size: str = "desk",
           reduced: bool = False, zone: str | None = None) -> Iterator[Page]:
    opened = open_app(browser, app_url + "/", reduced_motion="reduce" if reduced else "no-preference")
    page = opened.__enter__() if hasattr(opened, "__enter__") else next(opened)
    try:
        width, height = VIEWPORTS[size]
        page.set_viewport_size({"width": width, "height": height})
        if zone:
            session(page).send("Emulation.setTimezoneOverride", {"timezoneId": zone})
        if user:
            sign_in_page(page, app_url, user)
        page.goto(app_url + path)
        yield page
    finally:
        if hasattr(opened, "__exit__"):
            opened.__exit__(None, None, None)
        else:
            opened.close()


def sign_in_page(page: Page, app_url: str, user: str) -> None:
    r = page.request.post(f"{app_url}/api/grading/session", data={"username": user})
    assert r.status == 200, f"POST /api/grading/session answered {r.status}"


def soon(page: Page, check: Callable[[], None], contract: str, seconds: float = WAIT_S) -> None:
    deadline_at = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline_at:
        try:
            check()
            return
        except AssertionError as error:
            last = error
        advance(page, STEP_MS)
    pytest.fail(f"{contract}: {last}")


def shows(page: Page, loc: Locator, contract: str, text: Any = None) -> None:
    def check() -> None:
        if text is None:
            expect(loc).to_be_visible(timeout=SHORT_MS)
        else:
            expect(loc).to_have_text(text, timeout=SHORT_MS)
    soon(page, check, contract)


def contains(page: Page, loc: Locator, text: str, contract: str) -> None:
    soon(page, lambda: expect(loc).to_contain_text(text, timeout=SHORT_MS), contract)


def gone(page: Page, loc: Locator, contract: str) -> None:
    soon(page, lambda: expect(loc).to_have_count(0, timeout=SHORT_MS), contract)


def named(page: Page, loc: Locator, name: Any, contract: str) -> None:
    soon(page, lambda: expect(loc).to_have_accessible_name(name, timeout=SHORT_MS), contract)


def focused(page: Page, loc: Locator, contract: str) -> None:
    soon(page, lambda: expect(loc).to_be_focused(timeout=SHORT_MS), contract)


def attr(page: Page, loc: Locator, name: str, value: Any, contract: str) -> None:
    soon(page, lambda: expect(loc).to_have_attribute(name, value, timeout=SHORT_MS), contract)


def holds(page: Page, fn: Callable[[], bool], contract: str) -> None:
    def check() -> None:
        assert fn(), contract
    soon(page, check, contract)


def settled(page: Page) -> None:
    attr(page, page.locator("body"), "data-pending", "0", "body data-pending reads 0 once requests settle")


def tab_to(page: Page, loc: Locator, contract: str) -> None:
    for _ in range(TABS_MAX):
        if loc.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"):
            return
        page.keyboard.press("Tab")
    pytest.fail(f"Tab never reached {contract}")


def trapped(page: Page, dialog: Locator, contract: str) -> None:
    for key in ["Tab"] * TRAP_PRESSES + ["Shift+Tab"] * TRAP_PRESSES:
        page.keyboard.press(key)
        assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} moved focus out of {contract}"


def minors(loc: Locator) -> list[int]:
    return [int(v) for v in loc.locator("[data-minor]").evaluate_all("els => els.map(e => e.getAttribute('data-minor'))")]


def spin_value(loc: Locator) -> str:
    return str(loc.evaluate("e => e.getAttribute('aria-valuenow') ?? e.value"))


def shown_value(loc: Locator) -> str:
    return loc.evaluate("e => (e.selectedOptions && e.selectedOptions.length ? e.selectedOptions[0].textContent : (e.tagName === 'INPUT' ? e.value : e.textContent)).trim()")


def arrow_to(page: Page, target: str) -> None:
    settled(page)
    gap = (dt.date.fromisoformat(target) - dt.date.fromisoformat(active_date(page))).days
    for _ in range(abs(gap)):
        page.keyboard.press("ArrowRight" if gap > 0 else "ArrowLeft")
    holds(page, lambda: active_date(page) == target, f"arrow keys reach {target}")


def active_date(page: Page) -> str | None:
    return page.evaluate("() => { let n = document.activeElement; while (n && !(n.dataset && n.dataset.date)) n = n.parentElement; return n ? n.dataset.date : null; }")


def money(page: Page, minor: int, cur: str = "EUR", lang: str = "en") -> str:
    return page.evaluate(FMT_JS, ["money", minor, lang, None, cur])


def when(page: Page, iso: str, kind: str = "date", lang: str = "en", zone: str = "Europe/Lisbon") -> str:
    return page.evaluate(FMT_JS, [kind, iso, lang, zone, None])


def num1(page: Page, value: float, lang: str = "en") -> str:
    return page.evaluate(FMT_JS, ["num1", value, lang, None, None])


def query_pairs(url: str) -> list[tuple[str, str]]:
    return parse_qsl(urlparse(url).query, keep_blank_values=True)


def article(page: Page, name: str) -> Locator:
    return page.get_by_role("article", name=re.compile("^" + re.escape(name) + "[,،] "))


def price_region(page: Page, lang_name: str = "Price and reserve") -> Locator:
    return page.get_by_role("region", name=lang_name)


def to_checkout(page: Page) -> str:
    settled(page)
    click(price_region(page).get_by_role("button", name="Reserve"))
    holds(page, lambda: "/checkout/" in page.url, "Reserve on the property page opens /checkout/<quote id>")
    settled(page)
    return urlparse(page.url).path.rsplit("/", 1)[1]


def place_hold(page: Page) -> None:
    click(price_region(page).get_by_role("button", name="Reserve"))
    shows(page, page.get_by_role("timer", name="Time left"), "Reserve on checkout places the hold and shows timer Time left")


def fill_guest(page: Page, card: str, scope: Any = None) -> None:
    scope = scope or page
    for label, value in (("Given name", GIVEN), ("Surname", SURNAME), ("Card number", card), ("Expiry", EXPIRY), ("Security code", SECURITY)):
        boxes = scope.get_by_role("textbox", name=label)
        if boxes.count():
            fill(boxes.first, value)


def booking_code_from(page: Page) -> str:
    holds(page, lambda: re.search(r"/bookings/KW-[A-Z2-9]{6}", page.url) is not None, "payment ends on /bookings/KW-…")
    return re.search(r"/bookings/(KW-[A-Z2-9]{6})", page.url).group(1)


def page_book(page: Page, app_url: str, code: str, din: str, dout: str, rooms: list[dict]) -> dict:
    body = {"property": code, "in": din, "out": dout, "currency": "EUR", "adults": sum(r["adults"] for r in rooms),
            "ages": [a for r in rooms for a in r["ages"]], "rooms": rooms}
    q = page.request.post(f"{app_url}/api/quotes", data=body)
    assert q.status == 201, q.text()
    h = page.request.post(f"{app_url}/api/holds", data={"quote_id": q.json()["id"]})
    assert h.status == 201, h.text()
    b = page.request.post(f"{app_url}/api/bookings", data=pay_body(h.json(), q.json()), headers={"Idempotency-Key": idempotency_key()})
    assert b.status == 201, b.text()
    return b.json()


def swipe(page: Page, loc: Locator, dx: float) -> None:
    x, y = center(loc)
    cdp = session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for i in range(1, 7):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * i / 6, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def recorded(page: Page, anim_id: str) -> list[dict]:
    return [a for a in page.evaluate(RECORDED_JS) if a["id"] == anim_id]


def expect_motion(page: Page, anim_id: str, duration: int, reduced: bool) -> None:
    found = recorded(page, anim_id)
    if reduced:
        assert not found, f"reduced motion still created the {anim_id} animation: {found}"
    else:
        assert any(a["duration"] == duration for a in found), f"expected a {anim_id} animation of {duration} ms; saw {found}"


def test_health_reports_storage(app_url):
    api = Api(app_url)
    r = api.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}, r.text
    try:
        assert api.post("/api/grading/storage", {"down": True}).status_code == 200
        r = api.get("/api/health")
        assert r.status_code == 200 and r.json() == {"status": "unavailable"}, r.text
    finally:
        api.post("/api/grading/storage", {"down": False})
    poll(lambda: api.get("/api/health").json() == {"status": "ok"}, "GET /api/health returns ok once storage is back")


def test_grading_routes_behave(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    g = w.user()
    out = seed(api, bookings=[booking_body(code, day(10), day(12), guest=g), booking_body(code, day(20), day(22), guest=g, state="held")])
    confirmed, held = out["bookings"]
    assert re.fullmatch(r"KW-[A-Z2-9]{6}", confirmed["code"]) and confirmed["state"] == "confirmed"
    assert confirmed["hold_id"] is None and confirmed["quote_id"] is None and confirmed["expires_at"] is None
    assert confirmed["review_link"].startswith("/reviews/")
    assert held["state"] == "held" and held["hold_id"] and held["quote_id"] and held["expires_at"]
    dup = api.post("/api/grading/seed", {"properties": [w.props[code]]})
    assert dup.status_code == 409 and dup.json() == {"error": "exists", "code": code}, dup.text
    bad = api.post("/api/grading/seed", {"properties": [w.spec(9, stars="four")]})
    assert bad.status_code == 422 and bad.json().get("error") == "validation", bad.text
    other = Api(app_url)
    r = other.post("/api/grading/session", {"username": g})
    assert r.status_code == 200 and r.json() == {"username": g, "role": "guest"}, r.text
    assert other.get("/api/me").json()["user"]["username"] == g
    r = other.post("/api/grading/session", {"username": f"x{w.tag}none"})
    assert r.status_code == 404, r.text
    r = api.post("/api/grading/clock", {"set": CLOCK_START})
    assert r.status_code == 200 and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", r.json()["now"]), r.text
    set_at = instant(r.json()["now"])
    assert 0 <= ms_between(instant(CLOCK_START), set_at) < CLOCK_DRIFT_MS
    moved = advance_clock(api, 60000)
    assert 60000 <= ms_between(set_at, moved) < 60000 + CLOCK_DRIFT_MS
    try:
        r = api.post("/api/grading/currency", PROBE_TABLE)
        assert r.status_code == 200 and r.json() == PROBE_TABLE, r.text
        assert api.get("/api/currency").json() == PROBE_TABLE
        missing = {k: v for k, v in PROBE_TABLE.items() if k != "KWD"}
        assert api.post("/api/grading/currency", missing).status_code == 422
        assert api.post("/api/grading/currency", {**PROBE_TABLE, "USD": 0}).status_code == 422
        assert api.get("/api/currency").json() == PROBE_TABLE, "a refused table must not replace the stored one"
    finally:
        api.post("/api/grading/currency", START_TABLE)
    try:
        assert api.post("/api/grading/storage", {"down": True}).json() == {"down": True}
    finally:
        assert api.post("/api/grading/storage", {"down": False}).json() == {"down": False}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def log_tail(log: Path) -> str:
    return log.read_text(errors="replace")[-4000:] if log.exists() else ""


@pytest.mark.timeout(600)
def test_grading_routes_absent_without_flag(tmp_path):
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = {k: v for k, v in os.environ.items() if k != "KIP_GRADING"}
    env["APP_PUBLIC_PORT"] = str(port)
    log = tmp_path / "copy.log"
    with open(log, "wb") as out:
        proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=out,
                                stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline_at = time.monotonic() + BOOT_S
        up = False
        while time.monotonic() < deadline_at and not up:
            try:
                up = httpx.get(base + "/api/health", timeout=5).status_code == 200
            except httpx.HTTPError:
                pass
            try:
                proc.wait(timeout=0.5)
                pytest.fail(f"app copy exited early:\n{log_tail(log)}")
            except subprocess.TimeoutExpired:
                pass
        assert up, f"app copy never answered GET /api/health 200:\n{log_tail(log)}"
        with httpx.Client(base_url=base, timeout=HTTP_TIMEOUT) as c:
            c.get("/api/time")
            for path, body in (("/api/grading/seed", {}), ("/api/grading/session", {"username": "founder"}),
                               ("/api/grading/clock", {"advance_ms": 60000}), ("/api/grading/currency", START_TABLE),
                               ("/api/grading/storage", {"down": True})):
                r = c.post(path, json=body)
                assert r.status_code == 404 and r.json() == {"error": "not_found"}, f"{path}: {r.status_code} {r.text}"
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=30)


def test_server_clock_and_event_stream(app_url):
    admin = fresh(app_url)
    c = Api(app_url, visitor=False)
    r = c.get("/api/time")
    assert 0 <= ms_between(instant(CLOCK_START), instant(r.json()["now"])) < CLOCK_DRIFT_MS
    cookie = " ".join(r.headers.get_list("set-cookie"))
    assert "kip_visitor" in cookie and "HttpOnly" in cookie and re.search(r"SameSite=Lax", cookie, re.I), cookie
    w = World(admin)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    s = Stream(c)
    try:
        s.wait("clock", lambda d: "now" in d)
        assert s.ctype.startswith("text/event-stream"), s.ctype
        q = make_quote(c, code, day(10), day(12), [room(rt)])
        h = make_hold(c, q)
        s.wait("availability", lambda d: d.get("property") == code)
        after = advance_clock(admin, HOLD_MS)
        i_exp = s.wait("hold.expired", lambda d: d.get("hold_id") == h["id"])
        s.wait("quote.changed", lambda d: d.get("quote_id") == q["id"] and d.get("reason") == "expired")
        i_clock = s.wait("clock", lambda d: instant(d["now"]) >= after - dt.timedelta(milliseconds=EDGE_MARGIN_MS))
        assert i_clock > i_exp, "the clock event follows the events that fell due"
        q2 = make_quote(c, code, day(10), day(12), [room(rt)])
        r = edit_nights(mgr, code, [rt], day(10), day(10), rate_minor=BASE_RATE + 1000)
        assert r.status_code == 200, r.text
        w.rates[(rt, day(10))] = BASE_RATE + 1000
        new = price_stay(w, code, [room(rt)], day(10), day(12))["total"]
        s.wait("quote.changed", lambda d: d.get("quote_id") == q2["id"] and d.get("reason") == "rate"
               and d.get("old_total_minor") == q2["total_minor"] and d.get("new_total_minor") == new)
    finally:
        s.close()


BOUNDARY_CASES = ["too_large", "media_type", "cross_origin", "private_files", "rate_limit"]


def sized_signup(username: str, size: int) -> bytes:
    empty = len(json.dumps({"username": username, "password": ""}).encode())
    body = json.dumps({"username": username, "password": "a" * (size - empty)}).encode()
    assert len(body) == size
    return body


@pytest.mark.parametrize("case", BOUNDARY_CASES, ids=BOUNDARY_CASES)
def test_server_boundary(app_url, case):
    api = Api(app_url)
    t = new_tag()
    json_h = {"content-type": "application/json"}
    if case == "too_large":
        r = api.http.post("/api/signup", content=sized_signup(f"a{t}", JSON_MAX_BYTES), headers=json_h)
        assert r.status_code not in (413, 415), r.text
        r = api.http.post("/api/signup", content=sized_signup(f"b{t}", JSON_MAX_BYTES + 1), headers=json_h)
        assert r.status_code == 413 and r.json() == {"error": "too_large"}, r.text
        assert api.post("/api/signin", {"username": f"b{t}", "password": PASSWORD}).status_code == 401
    elif case == "media_type":
        r = api.http.post("/api/signin", content=json.dumps({"username": "ada", "password": PASSWORD}), headers={"content-type": "text/plain"})
        assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}, r.text
    elif case == "cross_origin":
        r = api.post("/api/signup", {"username": f"c{t}", "password": PASSWORD}, {"Origin": FOREIGN_ORIGIN})
        assert r.status_code == 403 and r.json() == {"error": "cross_origin"}, r.text
        assert api.post("/api/signin", {"username": f"c{t}", "password": PASSWORD}).status_code == 401
        origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
        assert api.post("/api/signup", {"username": f"c{t}", "password": PASSWORD}, {"Origin": origin}).status_code == 201
    elif case == "private_files":
        for path in PRIVATE_PATHS:
            assert api.get(path).status_code == 404, f"{path} was served"
        r = api.get("/api" + UNKNOWN_PREFIX + t)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
        assert api.get(UNKNOWN_PREFIX + t).status_code == 404
    else:
        for i in range(LOOKUP_PROBES):
            r = api.post("/api/bookings/find", {"code": "KW-AAAAAA", "surname": SURNAME})
            if r.status_code == 429:
                assert re.fullmatch(r"\d+", r.headers.get("retry-after", "")), r.headers
                assert r.json() == {"error": "rate_limited"}
                assert i > 0, "the first lookup must not be limited"
                return
            assert r.status_code == 404 and r.json() == {"error": "not_found"}, r.text
        pytest.fail("POST /api/bookings/find never answered 429 within the probe bound")


def test_dialogs_trap_focus_and_forced_colours(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(12))) as page:
        settled(page)
        dates = page.get_by_role("button", name=re.compile(r"^Dates"))
        dates.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Choose dates")
        shows(page, dialog, "button Dates opens dialog Choose dates")
        settled(page)
        trapped(page, dialog, "dialog Choose dates")
        page.keyboard.press("Escape")
        gone(page, dialog, "Escape closes dialog Choose dates")
        focused(page, dates, "focus returns to button Dates")
        page.goto(app_url + "/properties/HRB-QUAY?" + search_query("harrowmere", day(10), day(12)))
        settled(page)
        pics = page.get_by_role("button", name="Show pictures")
        pics.focus()
        page.keyboard.press("Enter")
        gallery = page.get_by_role("dialog", name="Pictures")
        shows(page, gallery, "button Show pictures opens dialog Pictures")
        trapped(page, gallery, "dialog Pictures")
        page.keyboard.press("Escape")
        gone(page, gallery, "Escape closes dialog Pictures")
        focused(page, pics, "focus returns to button Show pictures")
        page.emulate_media(forced_colors="active")
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Tab")
        focused(page, pics, "keyboard focus back on Show pictures")
        ring = style(pics, "outline-width", "outline-style")
        assert float(ring["outline-width"].rstrip("px")) >= FOCUS_RING_PX and ring["outline-style"] == "solid", ring


MOTION_CASES = ["motion", "reduced"]


@pytest.mark.parametrize("mode", MOTION_CASES, ids=MOTION_CASES)
def test_named_motion_and_reduced_motion(browser, app_url, mode):
    reduced = mode == "reduced"
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(12)), reduced=reduced) as page:
        settled(page)
        page.evaluate(RECORD_JS)
        first = page.get_by_role("group", name="Night Strip").locator("[data-date]").first
        first.focus()
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("list", name="Price lines"), "Enter expands the night into list Price lines")
        expect_motion(page, "night-expand", NIGHT_EXPAND_MS, reduced)
        page.keyboard.press("Escape")
        page.goto(app_url + "/properties/HRB-QUAY?" + search_query("harrowmere", day(10), day(12)))
        settled(page)
        page.evaluate(RECORD_JS)
        click(page.get_by_role("button", name="Show pictures"))
        gallery = page.get_by_role("dialog", name="Pictures")
        attr(page, gallery, "data-index", "1", "gallery opens on picture 1")
        click(gallery.get_by_role("button", name="Next picture"))
        attr(page, gallery, "data-index", "2", "Next picture moves to picture 2")
        expect_motion(page, "gallery-slide", GALLERY_MS, reduced)
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": VIEWPORTS["phone"][0], "height": VIEWPORTS["phone"][1]})
        page.goto(app_url + search_path(w, day(10), day(12)))
        settled(page)
        page.evaluate(RECORD_JS)
        click(page.get_by_role("button", name="Filters"))
        sheet = page.get_by_role("dialog", name="Filters")
        shows(page, sheet, "button Filters opens the Filters sheet")
        assert sheet.get_attribute("data-sheet") is not None
        expect_motion(page, "sheet-open", SHEET_MS, reduced)
        settle(sheet)
        box = sheet.bounding_box()
        assert box and box["y"] >= 0 and box["y"] + box["height"] <= VIEWPORTS["phone"][1] + 1, box


def test_destination_and_party_controls(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec())
    with browse(browser, app_url, "/search") as page:
        settled(page)
        cb = page.get_by_role("combobox", name="Destination")
        cb.focus()
        page.keyboard.type(w.dest_name[3:].upper())
        advance(page, TYPE_DEBOUNCE_MS)
        option = page.get_by_role("option", name=f"{w.dest_name}, 1 property")
        shows(page, option, "typing a case-insensitive part lists the destination with its count")
        page.keyboard.press("ArrowDown")
        holds(page, lambda: bool(cb.get_attribute("aria-activedescendant")), "ArrowDown sets aria-activedescendant")
        expect(cb).to_be_focused()
        page.keyboard.press("Enter")
        holds(page, lambda: cb.evaluate("e => e.value") == w.dest_name, "Enter fills the combobox with the name")
        gone(page, page.get_by_role("listbox"), "Enter closes the list")
        expect(cb).to_be_focused()
        page.keyboard.type(" ")
        page.keyboard.press("Backspace")
        advance(page, TYPE_DEBOUNCE_MS)
        shows(page, page.get_by_role("listbox"), "typing reopens the list")
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("listbox"), "Escape closes the list")
        assert cb.evaluate("e => e.value") == w.dest_name
        page.keyboard.press("Escape")
        holds(page, lambda: cb.evaluate("e => e.value") == "", "a second Escape clears the text")
        adults = page.get_by_role("spinbutton", name="Adults")
        children = page.get_by_role("spinbutton", name="Children")
        assert spin_value(adults) == "2" and spin_value(children) == "0"
        adults.focus()
        for key, value in (("ArrowUp", "3"), ("ArrowDown", "2"), ("End", str(MAX_ADULTS)), ("Home", "1")):
            page.keyboard.press(key)
            holds(page, lambda v=value: spin_value(adults) == v, f"{key} on Adults gives {value}")
        fill(adults, "4")
        holds(page, lambda: spin_value(adults) == "4", "typing a number sets Adults")
        children.focus()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        for n in (1, 2):
            age = page.get_by_role("combobox", name=sub(AGE_LABEL, "n", n))
            shows(page, age, f"Children 2 adds the age combobox for child {n}")
            assert shown_value(age) == "8"
        page.keyboard.press("ArrowDown")
        gone(page, page.get_by_role("combobox", name=sub(AGE_LABEL, "n", 2)), "lowering Children removes the last age")
        expect(page.get_by_role("combobox", name=sub(AGE_LABEL, "n", 1))).to_be_visible()


def test_date_picker_labels_and_keys(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.code()
    rt = f"{code}-DBL"
    w.add(w.spec(), nights=[night(rt, day(2), stop_sell=True), night(rt, day(4), min_stay=2)])
    with browse(browser, app_url, f"/search?dest={w.dest}&lang=en&cur=EUR") as page:
        settled(page)
        opener = page.get_by_role("button", name=re.compile(r"^Dates"))
        click(opener)
        dialog = page.get_by_role("dialog", name="Choose dates")
        shows(page, dialog, "button Dates opens dialog Choose dates")
        holds(page, lambda: active_date(page) == day(0), "focus starts on today by the server clock")
        cell = lambda d: dialog.locator(f'[data-date="{d}"]')
        named(page, cell(day(0)), f"{when(page, day(0))}, available, from {BASE_RATE // 100} euros, minimum stay 1 night", "day.available label")
        d1 = dt.date.fromisoformat(day(1))
        moves = [("ArrowRight", d1), ("ArrowDown", d1 + dt.timedelta(7)), ("ArrowUp", d1),
                 ("PageDown", d1.replace(month=d1.month + 1)), ("PageUp", d1),
                 ("Shift+PageDown", d1.replace(year=d1.year + 1)), ("Shift+PageUp", d1),
                 ("Home", d1 - dt.timedelta(d1.weekday())), ("End", d1 + dt.timedelta(6 - d1.weekday()))]
        for key, target in moves:
            page.keyboard.press(key)
            holds(page, lambda t=target: active_date(page) == t.isoformat(), f"{key} moves focus to {target}")
        page.keyboard.press("Home")
        for _ in range((dt.date.fromisoformat(day(2)) - (d1 - dt.timedelta(d1.weekday()))).days):
            page.keyboard.press("ArrowRight")
        holds(page, lambda: active_date(page) == day(2), "arrow keys reach the stop-sell day")
        reason = f"Not on sale on {when(page, day(2))}."
        named(page, cell(day(2)), f"{when(page, day(2))}, not available, {reason}", "day.blocked label")
        page.keyboard.press("Enter")
        date_help = page.get_by_role("status", name="Date help")
        contains(page, date_help, reason, "picking a blocked day puts its reason in Date help")
        assert active_date(page) == day(2)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        shows(page, date_help, "date.end after the arrival", f"Minimum stay from {when(page, day(4))} is 2 nights. Pick your departure date.")
        named(page, cell(day(3)), f"{when(page, day(3))}, not available, before your arrival", "day.before label")
        named(page, cell(day(5)), f"{when(page, day(5))}, not available, too short, minimum stay 2 nights", "day.short label")
        named(page, cell(day(6)), re.compile("^" + re.escape(f"{when(page, day(6))}, available")), "a passing departure is available")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        gone(page, dialog, "picking the departure closes the dialog")
        focused(page, opener, "focus returns to the Dates button")
        named(page, opener, f"Dates, {when(page, day(4), 'daymonth')} to {when(page, day(6), 'daymonth')}, 2 nights", "the opener names the range")
        click(opener)
        shows(page, dialog, "the date picker reopens")
        inside = dialog.get_by_role("gridcell").filter(has=page.locator(f'[data-date="{day(5)}"]'))
        attr(page, inside, "aria-selected", "true", "a day inside the range is selected")
        outside = dialog.get_by_role("gridcell").filter(has=page.locator(f'[data-date="{day(3)}"]'))
        assert outside.get_attribute("aria-selected") != "true"


RESTRICTIONS = {
    "release": ({0: {"release_days": 15, "closed_to_arrival": True}}, 2, "release", None, 15),
    "no_arrival": ({0: {"closed_to_arrival": True, "min_stay": 5}}, 2, "no_arrival", 0, None),
    "no_departure": ({0: {"min_stay": 5}, 2: {"closed_to_departure": True}}, 2, "no_departure", 2, None),
    "min_stay": ({0: {"min_stay": 3}, 1: {"stop_sell": True}}, 2, "min_stay", 0, 3),
    "max_stay": ({0: {"max_stay": 2}, 1: {"stop_sell": True}}, 3, "max_stay", 0, 2),
    "stop_sell": ({0: {"allotment": 0}, 2: {"stop_sell": True}}, 3, "stop_sell", 2, None),
    "sold_out": ({1: {"allotment": 0}}, 2, "sold_out", 1, None),
}


@pytest.mark.parametrize("case", list(RESTRICTIONS), ids=list(RESTRICTIONS))
def test_stay_restrictions_first_failure(app_url, case):
    overrides, length, code_expected, at, n = RESTRICTIONS[case]
    api = fresh(app_url)
    w = World(api)
    code = w.code()
    rt = f"{code}-DBL"
    a = dt.date.fromisoformat(day(10))
    w.add(w.spec(), nights=[night(rt, day(k, a), **f) for k, f in overrides.items()])
    body = {"property": code, "in": day(0, a), "out": day(length, a), "currency": "EUR", "adults": 2, "ages": [], "rooms": [room(rt)]}
    r = api.post("/api/quotes", body)
    assert r.status_code == 422 and r.json()["error"] == "restricted", r.text
    reason = r.json()["reason"]
    assert reason["code"] == code_expected, reason
    if at is not None:
        assert reason["date"] == day(at, a), reason
    if n is not None:
        assert reason["n"] == n, reason


RANK_SPECS = [
    (3, ["wifi"], 3.0, 0.0, 8000, True, None),
    (4, ["pool", "wifi"], 0.0, 12.0, 15000, False, 9),
    (5, ["spa", "pool"], 30.0, 0.0, 26000, True, 8),
    (4, ["parking"], 0.0, -5.0, 11000, True, None),
    (3, ["pets", "wifi"], -20.0, 0.0, 9000, False, 7),
    (5, ["wifi", "spa"], 7.0, 0.0, 60000, False, None),
]


def ranked_world(api: Api) -> tuple[World, dict]:
    w = World(api)
    specs = [w.spec(i, rate=rate, stars=stars, amenities=amen, x=500.0 + dx, y=500.0 + dy, policy=[dict(FREE_TIER)] if free else [])
             for i, (stars, amen, dx, dy, rate, free, _) in enumerate(RANK_SPECS)]
    w.add(*specs)
    g = w.user()
    reviews = [{"property": w.code(i), "guest": g, "scores": [s] * 5, "comment": COMMENT, "age_days": 0, "state": "published"}
               for i, (*_, s) in enumerate(RANK_SPECS) if s]
    seed(api, reviews=reviews)
    exp = {}
    for i, (stars, amen, dx, dy, rate, free, score) in enumerate(RANK_SPECS):
        code = w.code(i)
        total = price_stay(w, code, [room(f"{code}-DBL")], day(10), day(12))["total"]
        avg = rnd(total, 2)
        s10 = score * 10 if score else NO_REVIEW_SCORE10
        dist = math.hypot(dx, dy)
        exp[code] = {"stars": stars, "amen": amen, "free": free, "total": total, "avg": avg, "s10": s10, "dist": dist,
                     "rank": 3 * s10 - 2 * math.floor(dist) - avg // 1000}
    return w, exp


def test_search_rank_filters_counts(app_url):
    api = fresh(app_url)
    w, exp = ranked_world(api)
    base = search_query(w.dest, day(10), day(12))
    first, results = search_all(api, base)
    assert first["count"] == len(exp)
    assert [r["code"] for r in results] == sorted(exp, key=lambda c: (-exp[c]["rank"], exp[c]["total"], c))
    for r in results:
        e = exp[r["code"]]
        assert (r["total_minor"], r["rank"], r["refundable"]) == (e["total"], e["rank"], e["free"]), r
        assert round(r["score"] * 10) == e["s10"] and round(r["distance_km"] * 10) == round(e["dist"] * 10), r
    assert {p["code"] for p in first["pins"]} == set(exp), "pins cover every result, not only the page"
    hist = [(b["from_minor"], b["count"]) for b in first["histogram"]]
    assert hist == [(BUCKET_MINOR * i, sum(1 for e in exp.values() if min(e["avg"] // BUCKET_MINOR, BUCKETS - 1) == i)) for i in range(BUCKETS)]
    cs = first["counts"]
    assert {k: cs["stars"][k] for k in ("3", "4", "5")} == {str(s): sum(e["stars"] == s for e in exp.values()) for s in (3, 4, 5)}
    assert cs["free"] == sum(e["free"] for e in exp.values())
    for a in ("pool", "parking", "wifi", "spa", "pets"):
        assert cs["amen"][a] == sum(a in e["amen"] for e in exp.values()), a
    fq = search_query(w.dest, day(10), day(12), stars="4,5", amen="wifi")
    first, results = search_all(api, fq)
    match = {c for c, e in exp.items() if e["stars"] in (4, 5) and "wifi" in e["amen"]}
    assert {r["code"] for r in results} == match and first["count"] == len(match)
    cs = first["counts"]
    for s in (3, 4, 5):
        assert cs["stars"][str(s)] == sum(e["stars"] == s and "wifi" in e["amen"] for e in exp.values())
    for a in ("pool", "parking", "wifi", "spa", "pets"):
        assert cs["amen"][a] == sum(e["stars"] in (4, 5) and a in e["amen"] for e in exp.values()), a
    assert cs["free"] == sum(e["free"] for c, e in exp.items() if c in match)
    low, high = 100, 200
    _, results = search_all(api, search_query(w.dest, day(10), day(12), min=high, max=low))
    assert {r["code"] for r in results} == {c for c, e in exp.items() if low * 100 <= e["avg"] <= high * 100}
    orders = {"price_asc": lambda c: (exp[c]["total"], c), "price_desc": lambda c: (-exp[c]["total"], c),
              "score_desc": lambda c: (-exp[c]["s10"], c), "distance_asc": lambda c: (round(exp[c]["dist"] * 1000), c)}
    for sort, key in orders.items():
        _, results = search_all(api, search_query(w.dest, day(10), day(12), sort=sort))
        assert [r["code"] for r in results] == sorted(exp, key=key), sort


def test_search_stable_paging(app_url):
    api = fresh(app_url)
    w = World(api)
    codes = w.add(*[w.spec(i, rate=8000 + 500 * i) for i in range(PAGE_SIZE_PROBE)])
    q = search_query(w.dest, day(10), day(12), sort="price_asc")
    page1 = api.get("/api/search?" + q).json()
    assert page1["next_cursor"] and len(page1["results"]) < PAGE_SIZE_PROBE, "the deployment's page size is below the probe"
    last = page1["results"][-1]
    assert page1["next_cursor"] == f"{last['total_minor']}_{last['code']}"
    late = w.spec(PAGE_SIZE_PROBE, rate=BASE_RATE * 2)
    w.add(late)
    seen = [r["code"] for r in page1["results"]]
    cursor = page1["next_cursor"]
    for _ in range(MAX_PAGES):
        body = api.get("/api/search?" + q + f"&cursor={quote(cursor, safe='')}").json()
        seen += [r["code"] for r in body["results"]]
        cursor = body["next_cursor"]
        if not cursor:
            break
    for c in codes:
        assert seen.count(c) == 1, f"{c} appeared {seen.count(c)} times across pages"
    assert seen.count(late["code"]) == 1
    rank1 = api.get("/api/search?" + search_query(w.dest, day(10), day(12))).json()
    last = rank1["results"][-1]
    assert rank1["next_cursor"] == f"{last['rank']}~{last['total_minor']}_{last['code']}"


def test_search_link_normalisation(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec())
    raw = f"zzz=1&dest={w.dest}&in=soon&out={day(0)}&adults=40&ages=7,30&sort=bogus&min=300&max=100"
    body = api.get("/api/search?" + raw).json()
    canonical = [("dest", w.dest), ("in", day(0)), ("out", day(1)), ("adults", str(MAX_ADULTS)), ("ages", "7"),
                 ("lang", "en"), ("cur", "EUR"), ("min", "100"), ("max", "300")]
    assert parse_qsl(body["canonical"]) == canonical, body["canonical"]
    keys = [n["key"].split(".")[-1] for n in body["notices"]]
    assert keys == ["ignored", "arrival", "departure", "adults", "age", "reset", "swapped"], body["notices"]
    with browse(browser, app_url, "/search?" + raw) as page:
        settled(page)
        text = (f"Ignored zzz. Arrival moved to {when(page, day(0))}. Departure moved to {when(page, day(1))}. "
                f"Adults set to {MAX_ADULTS}. Removed child age 30. Reset sort. Price range swapped.")
        shows(page, page.get_by_role("status", name="Link notice"), "Link notice joins the notices", text)
        holds(page, lambda: query_pairs(page.url) == canonical, "the page replaces its URL with the canonical form")


def test_search_history_restores_scroll_and_focus(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(*[w.spec(i, stars=4 if i % 2 else 3, rate=8000 + 700 * i) for i in range(6)])
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        heading = page.get_by_role("heading", name="Results")
        focused(page, heading, "a first load focuses heading Results")
        shows(page, page.get_by_role("status", name="Search announcements"), "count announced", "6 properties found")
        length = page.evaluate("() => history.length")
        check_box = page.get_by_role("checkbox", name=re.compile(r"^4 stars \(\d+\)$"))
        click(check_box)
        holds(page, lambda: ("stars", "4") in query_pairs(page.url), "ticking 4 stars puts stars=4 in the URL")
        settled(page)
        assert page.evaluate("() => history.length") == length + 1
        sort = page.get_by_role("combobox", name="Sort by")
        sort.focus()
        key = sort.evaluate("e => document.activeElement.dataset.focusKey")
        y = page.evaluate("() => { window.scrollTo(0, Math.min(150, document.documentElement.scrollHeight - innerHeight)); return scrollY; }")
        select(sort, "Price, low to high")
        holds(page, lambda: ("sort", "price_asc") in query_pairs(page.url), "sort enters the URL")
        settled(page)
        page.go_back()
        holds(page, lambda: ("sort", "price_asc") not in query_pairs(page.url) and ("stars", "4") in query_pairs(page.url), "back restores the stars entry")
        settled(page)
        names = [a.get_by_role("link").first.inner_text() for a in page.get_by_role("article").all()]
        expected = [r["name"] for r in api.get("/api/search?" + urlparse(page.url).query).json()["results"]]
        assert names == expected
        holds(page, lambda: abs(page.evaluate("() => scrollY") - y) <= 1, "back restores the scroll position within 1px")
        holds(page, lambda: page.evaluate("() => document.activeElement && document.activeElement.dataset.focusKey") == key, "back restores focus by data-focus-key")
        page.go_forward()
        holds(page, lambda: ("sort", "price_asc") in query_pairs(page.url), "forward restores the sorted entry")


MAP_POINTS = [(510.0, 500.0), (515.0, 505.0), (400.0, 500.0), (500.0, 400.0), (600.0, 500.0), (900.0, 900.0)]


def test_map_clusters_pins_and_area(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(*[w.spec(i, x=x, y=y) for i, (x, y) in enumerate(MAP_POINTS)])
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        m = page.get_by_role("region", name="Map")
        for a, v in (("data-zoom", "2"), ("data-cx", "500.0"), ("data-cy", "500.0")):
            attr(page, m, a, v, f"default view {a}")
        pin = lambda i: m.get_by_role("button", name=re.compile("^" + re.escape(w.name(i)) + r", score 6\.0, from "))
        cluster = m.get_by_role("button", name=sub(CLUSTER, "count:property", sub(PROPERTIES, "n", 2)))
        shows(page, cluster, "two results in one cell form a cluster")
        for i in (2, 3, 4):
            shows(page, pin(i), f"pin {i} drawn")
        expect(pin(5)).to_have_count(0)
        click(pin(2))
        attr(page, pin(2), "aria-pressed", "true", "a clicked pin is pressed")
        attr(page, article(page, w.name(2)), "aria-current", "true", "the matching row is current")
        holds(page, lambda: ("sel", w.code(2)) in query_pairs(page.url), "sel enters the URL")
        pin(2).focus()
        page.keyboard.press("ArrowRight")
        focused(page, cluster, "ArrowRight moves to the nearest item to the east")
        page.keyboard.press("ArrowUp")
        focused(page, pin(3), "ArrowUp moves to the nearest item to the north")
        page.keyboard.press("ArrowUp")
        focused(page, pin(3), "with no candidate focus stays")
        page.keyboard.press("Escape")
        focused(page, m.get_by_role("button", name="Zoom in", exact=True), "Escape moves focus to Zoom in")
        click(m.get_by_role("button", name="Pan west"))
        click(m.get_by_role("button", name="Pan west"))
        attr(page, m, "data-cx", "450.0", "each pan moves 100/2^zoom km")
        area = page.get_by_role("button", name="Search this area")
        advance(page, MAP_DEBOUNCE_MS)
        shows(page, area, "Search this area appears after the map debounce")
        click(area)
        holds(page, lambda: {"zoom", "cx", "cy"} <= {k for k, _ in query_pairs(page.url)}, "the area search pushes zoom, cx, cy")
        settled(page)
        soon(page, lambda: expect(page.get_by_role("article")).to_have_count(4, timeout=SHORT_MS), "only results inside the view remain")
        gone(page, area, "Search this area hides while the view equals the searched view")
        click(page.get_by_role("button", name=f"Show {w.name(3)} on the map"))
        attr(page, m, "data-cy", "400.0", "Show on the map centres on the pin")
        attr(page, pin(3), "aria-pressed", "true", "Show on the map selects the pin")
        click(cluster)
        attr(page, m, "data-zoom", "3", "a cluster zooms in one level")
        attr(page, m, "data-cx", "512.5", "centred on the cluster's mean")
        attr(page, m, "data-cy", "502.5", "centred on the cluster's mean")


PRICE_CASES = ["worked_example", "single_nonrefundable", "long_stay_teen_breakfast"]


def worked_world(api: Api) -> tuple[World, str, str, str, str, str, list[dict]]:
    w = World(api)
    code = w.code()
    rt = f"{code}-DBL"
    din = day(WORKED_LEAD_DAYS)
    w.add(w.spec(rooms=2, max_adults=3, max_guests=5),
          nights=[night(rt, day(1, dt.date.fromisoformat(din)), base_rate_minor=WORKED_SECOND_BASE)])
    user = w.user(completed=((code, CHECKOUT_EXAMPLE), (code, CHECKOUT_EXAMPLE)))
    return w, code, rt, user, din, day(3, dt.date.fromisoformat(din)), [room(rt, 3, (7, 1), breakfast=True)]


@pytest.mark.parametrize("case", PRICE_CASES, ids=PRICE_CASES)
def test_nightly_price_build(app_url, case):
    api = fresh(app_url)
    tier = 0
    if case == "worked_example":
        w, code, rt, user, din, dout, rooms = worked_world(api)
        client = Api(app_url).sign_in(user)
        tier = HERON_PCT
    else:
        w = World(api)
        code = w.code()
        rt = f"{code}-DBL"
        w.add(w.spec(rooms=2, max_guests=4))
        client = Api(app_url)
        if case == "single_nonrefundable":
            din, dout, rooms = day(70), day(72), [room(rt, 1, plan="nonrefundable")]
        else:
            din, dout, rooms = day(2), day(9), [room(rt, 2, (13, 2), breakfast=True)]
    q = make_quote(client, code, din, dout, rooms)
    e = price_stay(w, code, rooms, din, dout, tier_pct=tier)
    assert q["total_minor"] == e["total"], (q["total_minor"], e["total"])
    for got, want in zip(q["rooms"][0]["nights"], e["rooms"][0]):
        keys = [line["key"] for line in got["lines"]]
        assert keys == [k for k in LINE_KEYS if k in want["lines"]], keys
        lines = {line["key"]: line["minor"] for line in got["lines"]}
        assert lines == want["lines"], (got["date"], lines, want["lines"])
        assert sum(v for k, v in lines.items() if k != "night_total") == lines["night_total"]
        assert (got["total_minor"], got["taxable_minor"]) == (want["total"], want["t"])
    assert [n["total_minor"] for n in q["nights"]] == [n["total"] for n in e["nights"]]
    if case == "worked_example":
        assert q["tier"] == "Heron" and q["total_minor"] == WORKED_TOTAL
        assert tuple(n["total_minor"] for n in q["nights"]) == WORKED_NIGHTS
        first = {line["key"]: line["minor"] for line in q["rooms"][0]["nights"][0]["lines"]}
        steps = [first["plan_rate"]]
        for k in ("occupancy", "children", "early_booking", "loyalty"):
            steps.append(steps[-1] + first[k])
        assert tuple(steps) == WORKED_STEPS
        assert (first["breakfast"], first["vat"], first["city_tax"], first["tourism_levy"]) == (WORKED_BREAKFAST, WORKED_VAT, WORKED_CITY, WORKED_LEVY)
        assert q["rooms"][0]["nights"][0]["taxable_minor"] == WORKED_TAXABLE
    h = make_hold(client, q)
    r = pay(client, h, q)
    assert r.status_code == 201, r.text
    assert r.json()["total_minor"] == e["total"] and r.json()["paid_minor"] == e["total"]


CURRENCY_CASES = ["USD", "JPY", "KWD"]


@pytest.mark.parametrize("cur", CURRENCY_CASES, ids=CURRENCY_CASES)
def test_currency_split_and_display(app_url, cur):
    api = fresh(app_url)
    w, code, rt, user, din, dout, rooms = worked_world(api)
    client = Api(app_url).sign_in(user)
    q = make_quote(client, code, din, dout, rooms, currency=cur)
    total, split = WORKED_CONVERTED[cur]
    assert q["currency"] == cur and q["converted_total_minor"] == total
    assert tuple(n["converted_minor"] for n in q["nights"]) == split
    try:
        assert api.post("/api/grading/currency", PROBE_TABLE).status_code == 200
        q2 = make_quote(client, code, din, dout, rooms, currency=cur)
        assert q2["rates_ppm"][cur] == PROBE_TABLE[cur]
        t2, s2 = convert([n["total_minor"] for n in q2["nights"]], PROBE_TABLE[cur], cur)
        assert q2["converted_total_minor"] == t2 and [n["converted_minor"] for n in q2["nights"]] == s2
        tx, sx = convert([n["taxable_minor"] for n in q2["nights"]], PROBE_TABLE[cur], cur)
        assert q2["converted_taxable_minor"] == tx and [n["converted_taxable_minor"] for n in q2["nights"]] == sx
        assert client.get(f"/api/quotes/{q['id']}").json()["converted_total_minor"] == total, "a quote pins its table"
    finally:
        api.post("/api/grading/currency", START_TABLE)
    visitor = Api(app_url)
    e = price_stay(w, code, [room(rt)], din, dout)
    n = len(e["nights"])
    for display, tax in (("total", "1"), ("night", "1"), ("total", "0"), ("night", "0")):
        extra = {k: v for k, v in (("display", display), ("tax", tax)) if (k, v) not in (("display", "total"), ("tax", "1"))}
        body = visitor.get("/api/search?" + search_query(w.dest, din, dout, cur=cur, **extra)).json()
        res = next(r for r in body["results"] if r["code"] == code)
        amounts = [x["total"] if tax == "1" else x["t"] for x in e["nights"]]
        conv = convert(amounts, START_TABLE[cur], cur)[0]
        assert res["display_currency"] == cur
        assert res["display_minor"] == (conv if display == "total" else rnd(conv, n)), (display, tax, res)


def test_room_allocation_and_advice(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.code()
    w.add(w.spec(rooms=5, family=(2, 18000)))
    dbl, fam = f"{code}-DBL", f"{code}-FAM"
    din, dout = day(10), day(12)
    rec_rooms, rec_total = recommend(w, code, 4, [7], din, dout)
    r = api.get(f"/api/properties/{code}", params={"in": din, "out": dout, "adults": 4, "ages": "7", "cur": "EUR"}).json()
    got = [{"room_type": x["room_type"], "adults": x["adults"], "ages": x["ages"]} for x in r["recommendation"]["rooms"]]
    assert got == [{"room_type": x["room_type"], "adults": x["adults"], "ages": x["ages"]} for x in rec_rooms]
    assert r["recommendation"]["total_minor"] == rec_total
    alloc = lambda counts: api.post("/api/allocations", {"property": code, "in": din, "out": dout, "adults": 4, "ages": [7], "counts": counts})
    best = place(w, code, [dbl, dbl], 4, [7], din, dout)
    r = alloc({dbl: 2})
    assert r.status_code == 200 and r.json()["total_minor"] == best[0][0], r.text
    assert [(x["adults"], x["ages"]) for x in r.json()["rooms"]] == [(x["adults"], x["ages"]) for x in best[1]]
    for counts, advice in (({dbl: 1}, {"code": "capacity", "n": 3, "m": 5}), ({dbl: 5}, {"code": "adult"}), ({fam: 3}, {"code": "left", "n": 2})):
        r = alloc(counts)
        assert r.status_code == 422 and r.json()["error"] == "room_advice", r.text
        assert {k: r.json()["advice"].get(k) for k in advice} == advice, r.text
    mixed = place(w, code, [dbl, fam], 4, [7], din, dout)[0][0]
    with browse(browser, app_url, prop_path(w, code, din, dout, adults=4, ages=(7,))) as page:
        settled(page)
        group = page.get_by_role("group", name="Rooms")
        d_spin = group.get_by_role("spinbutton", name=sub(ROOMS_SPIN, "room type name", "Double"))
        f_spin = group.get_by_role("spinbutton", name=sub(ROOMS_SPIN, "room type name", "Family"))
        holds(page, lambda: (spin_value(d_spin), spin_value(f_spin)) == ("0", "1"), "spinbuttons show the recommendation")
        expect(group.get_by_text("Recommended", exact=True)).to_be_visible()
        region = price_region(page)
        holds(page, lambda: rec_total in minors(region), "the price region shows the recommended total")
        d_spin.focus()
        page.keyboard.press("ArrowUp")
        holds(page, lambda: mixed in minors(region), "an accepted override re-prices")
        gone(page, group.get_by_text("Recommended", exact=True), "the tag leaves when counts differ")
        f_spin.focus()
        page.keyboard.press("ArrowDown")
        shows(page, page.get_by_role("status", name="Room advice"), "advice.capacity", "These rooms sleep 3. Your party is 5.")
        settled(page)
        assert mixed in minors(region), "a refused override keeps the previous prices"
        click(page.get_by_role("button", name="Use recommended rooms"))
        holds(page, lambda: rec_total in minors(region), "Use recommended rooms restores the recommendation")


def test_night_strip_states_and_lines(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    din, dout = day(10), day(13)
    e = price_stay(w, code, [room(rt)], din, dout)
    with browse(browser, app_url, prop_path(w, code, din, dout)) as page:
        settled(page)
        nights = page.get_by_role("group", name="Night Strip").locator("[data-date]")
        soon(page, lambda: expect(nights).to_have_count(3, timeout=SHORT_MS), "one column per night")
        for i, n in enumerate(e["nights"]):
            b = nights.nth(i)
            assert b.get_attribute("data-date") == n["date"] and b.get_attribute("data-state") == "base"
            assert minors(b)[0] == n["total"]
            named(page, b, f"{when(page, n['date'], 'wdm')}, {money(page, n['total'])}", "night button name")
        nights.nth(0).focus()
        page.keyboard.press("ArrowRight")
        focused(page, nights.nth(1), "ArrowRight moves to the next night")
        shows(page, page.get_by_role("status", name="Search announcements"), "moving announces the night",
              f"{when(page, e['nights'][1]['date'], 'wdm')}, {money(page, e['nights'][1]['total'])}")
        page.keyboard.press("End")
        focused(page, nights.nth(2), "End goes to the last night")
        page.keyboard.press("Home")
        focused(page, nights.nth(0), "Home goes to the first night")
        page.keyboard.press("Enter")
        lines = page.get_by_role("list", name="Price lines")
        shows(page, lines, "Enter expands the night")
        items = lines.get_by_role("listitem")
        want = [(k, v) for k, v in e["nights"][0]["lines"].items()]
        soon(page, lambda: expect(items).to_have_count(len(want), timeout=SHORT_MS), "one item per non-zero line")
        for i, (k, v) in enumerate(want):
            assert items.nth(i).get_attribute("data-minor") == str(v) and items.nth(i).get_attribute("data-currency") == "EUR"
            named(page, items.nth(i), f"{LABELS[k]}: {money(page, v)}", "price line name")
        page.keyboard.press("Enter")
        gone(page, lines, "Enter again collapses")
        page.keyboard.press("Enter")
        shows(page, lines, "Enter expands again")
        page.keyboard.press("Escape")
        gone(page, lines, "Escape collapses")
        expect(nights.nth(0)).to_be_focused()
        to_checkout(page)
        soon(page, lambda: expect(nights).to_have_count(3, timeout=SHORT_MS), "checkout keeps one column per night")
        assert edit_nights(mgr, code, [rt], day(11), day(11), stop_sell=True).status_code == 200
        attr(page, nights.nth(1), "data-state", "closed", "a stop-sold night turns closed live")
        assert minors(nights.nth(1))[0] == e["nights"][1]["total"], "a closed column keeps its last amount"
    with browse(browser, app_url, prop_path(w, code, day(14), day(16), adults=1)) as page:
        settled(page)
        nights = page.get_by_role("group", name="Night Strip").locator("[data-date]")
        soon(page, lambda: expect(nights.first).to_have_attribute("data-state", "discount", timeout=SHORT_MS), "a single adult discount shows discount")


def test_quote_and_hold_edges(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    v = Api(app_url)
    din, dout = day(10), day(12)
    t0 = server_now(api)
    q1 = make_quote(v, code, din, dout, [room(rt)])
    t1 = server_now(api)
    exp1 = instant(q1["expires_at"])
    assert ms_between(t0, exp1) >= QUOTE_TTL_MS and ms_between(t1, exp1) <= QUOTE_TTL_MS
    set_clock(api, iso_ms(exp1))
    r = v.post("/api/holds", {"quote_id": q1["id"]})
    assert r.status_code == 410 and r.json() == {"error": "quote_expired"}, r.text
    q2 = make_quote(v, code, din, dout, [room(rt)])
    set_clock(api, iso_ms(instant(q2["expires_at"]) - dt.timedelta(milliseconds=EDGE_MARGIN_MS)))
    t2 = server_now(api)
    h = make_hold(v, q2)
    t3 = server_now(api)
    hexp = instant(h["expires_at"])
    assert ms_between(t2, hexp) >= HOLD_MS and ms_between(t3, hexp) <= HOLD_MS
    assert left(api, code, rt, din, dout) == 0, "a hold reduces rooms left at once"
    set_clock(api, iso_ms(hexp))
    r = pay(v, h, q2)
    assert r.status_code == 410 and r.json() == {"error": "hold_expired"}, r.text
    assert left(api, code, rt, din, dout) == 1, "an ended hold returns its rooms"


def test_last_room_hold_race(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    din, dout = day(10), day(12)
    clients = [Api(app_url) for _ in range(RACE_CLIENTS)]
    quotes = [make_quote(c, code, din, dout, [room(rt)]) for c in clients]
    barrier = threading.Barrier(RACE_CLIENTS)
    results: list[httpx.Response] = [None] * RACE_CLIENTS

    def go(i: int) -> None:
        barrier.wait()
        results[i] = clients[i].post("/api/holds", {"quote_id": quotes[i]["id"]})

    threads = [threading.Thread(target=go, args=(i,)) for i in range(RACE_CLIENTS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT)
    statuses = sorted(r.status_code for r in results)
    assert statuses == [201] + [409] * (RACE_CLIENTS - 1), statuses
    for r in results:
        if r.status_code == 409:
            assert r.json()["error"] == "sold_out" and r.json()["date"] in span(din, dout), r.text
    assert left(api, code, rt, din, dout) == 0


def test_payment_cards_and_error_order(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    v = Api(app_url)
    q = make_quote(v, code, day(10), day(12), [room(rt)])
    h = make_hold(v, q)
    r = v.post("/api/bookings", pay_body(h, q))
    assert r.status_code == 422 and r.json()["fields"].get("Idempotency-Key") == "required", r.text
    r = pay(v, h, q, given_name="", expiry="13/29", security_code="12")
    assert r.status_code == 422 and r.json()["error"] == "validation", r.text
    assert r.json()["fields"]["given_name"] == "required"
    assert {"expiry", "security_code"} <= set(r.json()["fields"])
    unknown = "9000 0000 0000 0044"
    for card, outcome in ((unknown, "unknown"), (CARD_DECLINED, "declined"), (CARD_EXPIRED, "expired"), (CARD_STEP_UP, "step_up")):
        r = pay(v, h, q, card)
        assert r.status_code == 402 and r.json() == {"error": "card", "outcome": outcome}, r.text
    r = pay(v, h, q, CARD_STEP_UP, step_up_code="0000")
    assert r.status_code == 402 and r.json()["outcome"] == "wrong_code", r.text
    assert Api(app_url).post("/api/bookings", pay_body(h, q), {"Idempotency-Key": idempotency_key()}).status_code == 404
    assert Api(app_url, visitor=False).post("/api/bookings", pay_body(h, q), {"Idempotency-Key": idempotency_key()}).status_code == 401
    r = pay(v, h, q, CARD_STEP_UP, step_up_code=STEP_UP_CODE)
    assert r.status_code == 201, r.text
    b = r.json()
    assert re.fullmatch(r"KW-[A-Z2-9]{6}", b["code"]) and b["card_last4"] == "0036" and b["state"] == "confirmed"
    assert b["paid_minor"] == b["total_minor"] == q["total_minor"]
    assert len(b["ledger"]) == 2 and b["balance_minor"] == 0
    balanced(b["ledger"])
    guest = next(e for e in b["ledger"] if e["account"] == "guest")
    assert guest["kind"] == "charge" and guest["debit_minor"] == b["total_minor"]
    q2 = make_quote(v, code, day(10), day(12), [room(rt)])
    h2 = make_hold(v, q2)
    set_clock(api, h2["expires_at"])
    r = pay(v, h2, q2, CARD_DECLINED)
    assert r.status_code == 410 and r.json() == {"error": "hold_expired"}, "410 answers before a 402 card outcome"


def test_payment_idempotency(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    v = Api(app_url)
    q = make_quote(v, code, day(10), day(12), [room(rt)])
    h = make_hold(v, q)
    k2 = idempotency_key()
    first402 = pay(v, h, q, CARD_DECLINED, key=k2)
    again402 = pay(v, h, q, CARD_DECLINED, key=k2)
    assert first402.status_code == again402.status_code == 402 and first402.json() == again402.json()
    key = idempotency_key()
    a = pay(v, h, q, key=key)
    b = pay(v, h, q, key=key)
    assert (a.status_code, b.status_code) == (201, 200) and a.json() == b.json()
    c = pay(v, h, q, key=key, surname="Lindqvist")
    assert c.status_code == 409 and c.json() == {"error": "idempotency_conflict"}, c.text
    booking, _ = get_booking(v, a.json()["code"])
    assert len(booking["ledger"]) == 2
    rows = [x for x in mgr.get(f"/api/manage/{code}/reservations").json() if x["code"] == booking["code"]]
    assert len(rows) == 1 and len(mgr.get(f"/api/manage/{code}/reservations").json()) == 1


def parse_timer(text: str) -> int:
    m = re.fullmatch(r"(\d\d):(\d\d)", text.strip())
    assert m, f"timer reads {text!r}, expected mm:ss"
    return int(m.group(1)) * 60 + int(m.group(2))


def test_checkout_countdown_and_hold_ended(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(12))) as page:
        qid = to_checkout(page)
        t0 = server_now(api)
        place_hold(page)
        t1 = server_now(api)
        set_clock(api, iso_ms(t1))
        timer = page.get_by_role("timer", name="Time left")
        lo, hi = math.ceil((HOLD_MS - ms_between(t0, t1)) / 1000), HOLD_MS // 1000
        holds(page, lambda: lo <= parse_timer(timer.inner_text()) <= hi, "the countdown follows the server clock")
        announce = page.get_by_role("status", name="Hold announcements")
        for step, text in ((HOLD_MS - 300000, "Your room is held for 5 more minutes"), (180000, "Your room is held for 2 more minutes"),
                           (60000, "Your room is held for 1 more minute")):
            page.clock.fast_forward(step)
            shows(page, announce, "hold.minutes threshold", text)
        page.clock.fast_forward(120000)
        shows(page, timer, "the countdown never goes below 00:00", "00:00")
        expect(page.get_by_role("alertdialog")).to_have_count(0)
        assert page.request.get(f"{app_url}/api/quotes/{qid}").json()["hold_id"], "the browser countdown ends nothing"
        set_clock(api, iso_ms(t1 + dt.timedelta(milliseconds=HOLD_MS + EDGE_MARGIN_MS)))
        dialog = page.get_by_role("alertdialog", name="Your hold ended")
        shows(page, dialog, "hold.expired raises the dialog live")
        expect(dialog).to_contain_text("The rooms are back on sale.")
        page.keyboard.press("Escape")
        expect(dialog).to_be_visible()
        expect(dialog).to_be_visible()


def test_checkout_price_changed_dialog(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    din, dout = day(10), day(12)
    old = price_stay(w, code, [room(rt)], din, dout)["total"]
    with browse(browser, app_url, prop_path(w, code, din, dout)) as page:
        to_checkout(page)
        place_hold(page)
        assert edit_nights(mgr, code, [rt], din, din, rate_minor=BASE_RATE + 2000).status_code == 200
        w.rates[(rt, din)] = BASE_RATE + 2000
        new = price_stay(w, code, [room(rt)], din, dout)["total"]
        dialog = page.get_by_role("alertdialog", name="The price changed")
        shows(page, dialog, "quote.changed raises the dialog live")
        expect(dialog).to_contain_text(f"The total changed from {money(page, old)} to {money(page, new)}.")
        page.keyboard.press("Escape")
        expect(dialog).to_be_visible()
        click(dialog.get_by_role("button", name="Accept new price"))
        gone(page, dialog, "Accept new price closes the dialog")
        focused(page, page.get_by_role("button", name="Pay"), "focus moves to Pay")
        expect(page.get_by_role("timer", name="Time left")).to_be_visible()
        holds(page, lambda: new in minors(price_region(page)) or new in minors(page.locator("body")), "the new total shows")


def test_checkout_just_taken_dialog(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    with browse(browser, app_url, prop_path(w, code, day(10), day(12))) as page:
        to_checkout(page)
        other = Api(app_url)
        make_hold(other, make_quote(other, code, day(10), day(12), [room(rt)]))
        dialog = page.get_by_role("alertdialog", name="Just taken")
        shows(page, dialog, "availability raises Just taken live")
        expect(dialog).to_contain_text("Someone else just took the last room.")
        page.keyboard.press("Escape")
        expect(dialog).to_be_visible()
        click(dialog.get_by_role("button", name="Keep searching"))
        holds(page, lambda: urlparse(page.url).path == "/search", "Keep searching returns to the search")


def test_languages_strings_and_rtl(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(0, stars=4), w.spec(1, stars=5))
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        page.evaluate("() => { window.__kipStay = true; }")
        length = page.evaluate("() => history.length")
        select(page.get_by_role("combobox", name=LANGUAGE_BOX), "Deutsch")
        shows(page, page.get_by_role("heading", name="Ergebnisse"), "German heading")
        expect(page.get_by_role("link", name="Reiseziele")).to_be_visible()
        assert page.evaluate("() => window.__kipStay === true"), "the language change must not reload"
        assert page.evaluate("() => history.length") == length + 1 and ("lang", "de") in query_pairs(page.url)
        total = api.get("/api/search?" + search_query(w.dest, day(10), day(12))).json()
        r0 = next(r for r in total["results"] if r["code"] == w.code(0))
        dist = math.hypot(3.0, 2.0)
        name_de = f"{w.name(0)}, 4 Sterne, Bewertung {num1(page, 6.0, 'de')}, {num1(page, round(dist, 1), 'de')} Kilometer, gesamt {money(page, r0['display_minor'], 'EUR', 'de')}"
        shows(page, page.get_by_role("article", name=name_de), "German row label with de-DE numbers")
        click(page.get_by_role("checkbox", name=re.compile(r"^5 Sterne \(\d+\)$")))
        shows(page, page.get_by_role("status", name="Suchmeldungen"), "German singular", "1 Unterkunft gefunden")
        select(page.get_by_role("combobox", name=LANGUAGE_BOX), "العربية")
        shows(page, page.get_by_role("heading", name="النتائج"), "Arabic heading")
        assert page.evaluate("() => document.documentElement.dir") == "rtl"
        click(page.get_by_role("checkbox", name=re.compile(r"^5 نجوم \(\d+\)$")))
        shows(page, page.get_by_role("status", name="إعلانات البحث"), "Arabic dual", "مكانان للإقامة")
        word = page.get_by_role("link", name="KIPWELL").bounding_box()
        dest = page.get_by_role("link", name="الوجهات").bounding_box()
        assert word["x"] > dest["x"], "the header starts on the right in Arabic"
        assert not re.search("[٠-٩]", page.locator("body").inner_text()), "numbers use Western digits"
        click(page.get_by_role("button", name=re.compile(r"^التواريخ")))
        dialog = page.get_by_role("dialog", name="اختر التواريخ")
        shows(page, dialog, "Arabic date picker")
        start = dt.date.fromisoformat(active_date(page))
        page.keyboard.press("ArrowLeft")
        holds(page, lambda: active_date(page) == (start + dt.timedelta(1)).isoformat(), "ArrowLeft moves forward in Arabic")
        page.keyboard.press("ArrowDown")
        later = start + dt.timedelta(8)
        holds(page, lambda: active_date(page) == later.isoformat(), "ArrowDown moves one week")
        page.keyboard.press("Home")
        sat = later - dt.timedelta((later.weekday() - 5) % 7)
        holds(page, lambda: active_date(page) == sat.isoformat(), "the Arabic week starts on Saturday")


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_viewport_layouts_and_touch(browser, app_url, size):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(0, rooms=3), w.spec(1, rooms=3, x=520.0, y=480.0))[0]
    width, height = VIEWPORTS[size]
    din, dout = day(10), day(12)
    with browse(browser, app_url, search_path(w, din, dout), size=size) as page:
        settled(page)
        layout(page)
        row = page.get_by_role("article").first.bounding_box()
        if size in ("desk", "tablet"):
            stars = page.get_by_role("group", name="Stars").bounding_box()
            mp = page.get_by_role("region", name="Map").bounding_box()
            assert stars["x"] + stars["width"] <= row["x"] + 1, "filters sit on the start side"
            if size == "desk":
                assert mp["x"] >= row["x"] + row["width"] - 1, "the map sits on the end side"
                page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
                box = page.get_by_role("region", name="Map").bounding_box()
                assert box["y"] < height and box["y"] + box["height"] > 0, "the desk map stays in view"
            else:
                assert mp["y"] + mp["height"] <= row["y"] + 1, "the tablet map is a band above the rows"
        else:
            for label in ("Filters", "Map"):
                b = page.get_by_role("button", name=label, exact=True).bounding_box()
                assert b["width"] >= TAP_MIN_PX and b["height"] >= TAP_MIN_PX, (label, b)
        if size == "phone":
            for label in ("Filters", "Map"):
                opener = page.get_by_role("button", name=label, exact=True)
                click(opener)
                sheet = page.get_by_role("dialog", name=label)
                shows(page, sheet, f"{label} opens as a sheet")
                assert sheet.get_attribute("data-sheet") is not None
                page.keyboard.press("Escape")
                gone(page, sheet, f"Escape closes the {label} sheet")
                focused(page, opener, f"focus returns to {label}")
        page.goto(app_url + prop_path(w, code, din, dout))
        settled(page)
        layout(page)
        if size in ("phone", "narrow"):
            bar = price_region(page)
            tops = []
            for js in ("() => window.scrollTo(0, 0)", "() => window.scrollTo(0, document.documentElement.scrollHeight)"):
                page.evaluate(js)
                b = bar.bounding_box()
                assert b["y"] + b["height"] <= height + 1, b
                tops.append(round(b["y"]))
            assert tops[0] == tops[1], "the price bar stays fixed at the bottom"
        if size == "phone":
            tap(page.get_by_role("button", name=re.compile(r"^Dates")))
            dialog = page.get_by_role("dialog", name="Choose dates")
            shows(page, dialog, "Dates opens the picker")
            tap(dialog.locator(f'[data-date="{day(14)}"]'))
            tap(dialog.locator(f'[data-date="{day(16)}"]'))
            gone(page, dialog, "two taps pick a range")
            named(page, page.get_by_role("button", name=re.compile(r"^Dates")), re.compile(r", 2 nights$"), "the range has 2 nights")
            settled(page)
            page.goto(app_url + "/properties/HRB-QUAY?" + search_query("harrowmere", day(10), day(12)))
            settled(page)
            click(page.get_by_role("button", name="Show pictures"))
            gallery = page.get_by_role("dialog", name="Pictures")
            attr(page, gallery, "data-index", "1", "gallery opens on 1")
            swipe(page, gallery.get_by_role("img").first, -(SWIPE_PX + 10))
            attr(page, gallery, "data-index", "2", "a leftward drag of 60px or more moves forward")
        if size == "narrow":
            to_checkout(page)
            layout(page)
            b = page_book(page, app_url, code, day(20), day(22), [room(f"{code}-DBL")])
            page.goto(f"{app_url}/bookings/{b['code']}")
            settled(page)
            layout(page)


def test_deadlines_in_property_time(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    tiers = [{"days_before": 2, "hour": 1, "refund_pct": 100}, {"days_before": 1, "hour": 18, "refund_pct": 50}]
    code = w.add(w.spec(rooms=2, policy=tiers))[0]
    g = w.user()
    arrive = day(2, dt.date.fromisoformat(DST_SPRING))
    autumn = day(2, dt.date.fromisoformat(DST_AUTUMN))
    seeded = seed(api, bookings=[booking_body(code, arrive, day(1, dt.date.fromisoformat(arrive)), guest=g),
                                 booking_body(code, autumn, day(1, dt.date.fromisoformat(autumn)), guest=g)])["bookings"]
    client = Api(app_url).sign_in(g)
    d1, d2 = deadline(arrive, tiers[0], w.zone), deadline(arrive, tiers[1], w.zone)
    b, _ = get_booking(client, seeded[0]["code"])
    got = {t["refund_pct"]: (t["deadline_utc"], t["deadline_local"]) for t in b["cancellation"]["tiers"]}
    tz = ZoneInfo(w.zone)
    assert got == {100: (iso_ms(d1), d1.astimezone(tz).strftime("%Y-%m-%dT%H:%M")), 50: (iso_ms(d2), d2.astimezone(tz).strftime("%Y-%m-%dT%H:%M"))}, got
    fall = get_booking(client, seeded[1]["code"])[0]
    assert next(t["deadline_utc"] for t in fall["cancellation"]["tiers"] if t["refund_pct"] == 100) == iso_ms(deadline(autumn, tiers[0], w.zone))
    assert b["cancellation"]["status"] == {"kind": "free", "refund_pct": 100, "until_utc": iso_ms(d1)}
    with browse(browser, app_url, f"/bookings/{b['code']}", user=g, zone=OTHER_ZONE) as page:
        page.clock.set_system_time(dt.datetime(2030, 1, 1, tzinfo=UTC))
        settled(page)
        region = page.get_by_role("region", name="Cancellation")
        shows(page, region, "region Cancellation")
        stamps = region.locator("[data-deadline-utc]").evaluate_all("els => els.map(e => e.getAttribute('data-deadline-utc'))")
        assert sorted(stamps) == sorted([iso_ms(d1), iso_ms(d2)]), stamps
        for text in (w.zone, "your time", hhmm(d1, w.zone), hhmm(d1, OTHER_ZONE), "Free cancellation", "50% refund"):
            expect(region).to_contain_text(text)
        status = page.get_by_role("status", name="Refund status")
        contains(page, status, "Free cancellation until ", "refund.free from the server")
        page.evaluate("() => { window.__kipStay = true; }")
        set_clock(api, iso_ms(d1))
        contains(page, status, "50% refund until ", "the status changes live when the deadline passes")
        assert page.evaluate("() => window.__kipStay === true")
    assert get_booking(client, b["code"])[0]["cancellation"]["status"]["kind"] == "partial"
    set_clock(api, iso_ms(d2))
    st = get_booking(client, b["code"])[0]["cancellation"]["status"]
    assert st["kind"] == "none" and st["refund_pct"] == 0 and st["until_utc"] is None
    assert client.get(f"/api/bookings/{b['code']}/cancellations/preview", params={"rooms": "1"}).json()["refund_minor"] == 0


def test_room_cancellation_ledger(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2, policy=[dict(FREE_TIER), dict(HALF_TIER)]))[0]
    rt = f"{code}-DBL"
    v = Api(app_url)
    din, dout = day(10), day(12)
    b = book(v, code, din, dout, [room(rt), room(rt)])
    assert left(api, code, rt, din, dout) == 0
    pv = v.get(f"/api/bookings/{b['code']}/cancellations/preview", params={"rooms": "1"}).json()
    paid1 = b["rooms"][0]["paid_minor"]
    assert pv == {"refund_minor": paid1, "refund_pct": 100} or (pv["refund_minor"], pv["refund_pct"]) == (paid1, 100)
    path = f"/api/bookings/{b['code']}/cancellations"
    r = v.post(path, {"rooms": [1]})
    assert r.status_code == 422 and r.json()["fields"].get("If-Match") == "required", r.text
    before, etag = get_booking(v, b["code"])
    r = v.post(path, {"rooms": [1]}, {"If-Match": etag})
    assert r.status_code == 201 and r.json()["refund_minor"] == paid1, r.text
    after = r.json()["booking"]
    assert [x["state"] for x in after["rooms"]] == ["cancelled", "confirmed"] and after["version"] != before["version"]
    assert after["ledger"][:2] == before["ledger"], "earlier entries never change"
    new = after["ledger"][2:]
    assert len(new) == 2 and {e["kind"] for e in new} == {"refund"} and len({e["pair"] for e in new}) == 1
    assert next(e for e in new if e["account"] == "property")["debit_minor"] == paid1
    assert next(e for e in new if e["account"] == "guest")["credit_minor"] == paid1
    balanced(after["ledger"])
    assert after["balance_minor"] == 0
    assert left(api, code, rt, din, dout) == 1, "the cancelled room is back on sale at once"
    r = v.post(path, {"rooms": [2]}, {"If-Match": etag})
    assert r.status_code == 409 and r.json() == {"error": "version_conflict"}, r.text
    _, etag = get_booking(v, b["code"])
    r = v.post(path, {"rooms": [1]}, {"If-Match": etag})
    assert r.status_code == 409 and r.json() == {"error": "invalid_state"}, r.text
    set_clock(api, iso_ms(deadline(din, FREE_TIER, w.zone)))
    _, etag = get_booking(v, b["code"])
    paid2 = after["rooms"][1]["paid_minor"]
    r = v.post(path, {"rooms": [2]}, {"If-Match": etag})
    assert r.status_code == 201 and r.json()["refund_minor"] == rnd(paid2 * HALF_TIER["refund_pct"], 100), r.text
    final = r.json()["booking"]
    assert final["state"] == "cancelled" and len(final["ledger"]) == 6 and final["balance_minor"] == 0


def test_date_changes_pay_and_refund(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2, policy=[dict(FREE_TIER), dict(HALF_TIER)]))[0]
    rt = f"{code}-DBL"
    w.nights(night(rt, day(20), min_stay=3))
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    v = Api(app_url)
    b = book(v, code, day(10), day(12), [room(rt)])
    base = f"/api/bookings/{b['code']}/changes"
    r = v.post(base + "/preview", {"in": day(20), "out": day(22)})
    assert r.status_code == 422 and r.json()["reason"]["code"] == "min_stay", r.text
    assert get_booking(v, b["code"])[0]["version"] == b["version"], "a refused change changes nothing"
    assert edit_nights(mgr, code, [rt], day(12), day(12), rate_minor=BASE_RATE + 8000).status_code == 200
    w.rates[(rt, day(12))] = BASE_RATE + 8000
    longer = price_stay(w, code, [room(rt)], day(10), day(13))["total"]
    pv = v.post(base + "/preview", {"in": day(10), "out": day(13)}).json()
    assert (pv["new_total_minor"], pv["paid_minor"], pv["pay_minor"]) == (longer, b["total_minor"], longer - b["total_minor"]), pv
    _, etag = get_booking(v, b["code"])
    body = {"in": day(10), "out": day(13), "card_number": CARD_OK, "expiry": EXPIRY, "security_code": SECURITY}
    assert v.post(base, body, {"Idempotency-Key": idempotency_key()}).status_code == 422, "If-Match is required"
    key = idempotency_key()
    r1 = v.post(base, body, {"If-Match": etag, "Idempotency-Key": key})
    assert r1.status_code == 200, r1.text
    c = r1.json()
    assert (c["in"], c["out"], c["state"]) == (day(10), day(13), "changed")
    change = [e for e in c["ledger"] if e["kind"] == "change"]
    assert len(change) == 2 and next(e for e in change if e["account"] == "guest")["debit_minor"] == longer - b["total_minor"]
    r2 = v.post(base, body, {"If-Match": etag, "Idempotency-Key": key})
    assert r2.status_code == 200 and r2.json() == c, "a replay answers the stored body"
    r3 = v.post(base, {**body, "out": day(14)}, {"If-Match": etag, "Idempotency-Key": key})
    assert r3.status_code == 409 and r3.json()["error"] == "idempotency_conflict", r3.text
    assert len(get_booking(v, b["code"])[0]["ledger"]) == 4
    shorter = price_stay(w, code, [room(rt)], day(10), day(11))["total"]
    refund = rnd((get_booking(v, b["code"])[0]["paid_minor"] - shorter) * 100, 100)
    pv = v.post(base + "/preview", {"in": day(10), "out": day(11)}).json()
    assert pv["refund_minor"] == refund, pv
    _, etag = get_booking(v, b["code"])
    r = v.post(base, {"in": day(10), "out": day(11)}, {"If-Match": etag, "Idempotency-Key": idempotency_key()})
    assert r.status_code == 200, r.text
    last = r.json()["ledger"][-2:]
    assert next(e for e in last if e["account"] == "guest")["credit_minor"] == refund and r.json()["balance_minor"] == 0
    nr = book(v, code, day(25), day(27), [room(rt, plan="nonrefundable")])
    r = v.post(f"/api/bookings/{nr['code']}/changes/preview", {"in": day(26), "out": day(28)})
    assert r.status_code == 422 and r.json() == {"error": "nonrefundable"}, r.text
    g = w.user()
    today = seed(api, bookings=[booking_body(code, day(0), day(1), guest=g)])["bookings"][0]
    r = Api(app_url).sign_in(g).post(f"/api/bookings/{today['code']}/changes/preview", {"in": day(3), "out": day(4)})
    assert r.status_code == 409 and r.json() == {"error": "invalid_state"}, r.text


def review_score(pairs: list[tuple[float, int]]) -> int:
    weights = [0.5 ** (age / HALF_LIFE_DAYS) for _, age in pairs]
    x = sum(wt * v for wt, (v, _) in zip(weights, pairs)) / sum(weights)
    return math.floor(x * 10 + 0.5 + 1e-9)


def test_review_window_moderation_score(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=3))[0]
    g = w.user()
    op = Api(app_url).sign_in(w.user("operator"))
    seed(api, reviews=[{"property": code, "guest": g, "scores": [v] * 5, "comment": COMMENT, "age_days": a, "state": "published"} for v, a in SCORE_EXAMPLE])
    query = search_query(w.dest, day(10), day(12))
    res = lambda: next(r for r in api.get("/api/search?" + query).json()["results"] if r["code"] == code)
    assert round(res()["score"] * 10) == SCORE_EXAMPLE_SHOWN == review_score(list(SCORE_EXAMPLE))
    rank0 = res()["rank"]
    pending = seed(api, reviews=[{"property": code, "guest": g, "scores": [10] * 5, "comment": COMMENT, "age_days": 3, "state": "pending"},
                                 {"property": code, "guest": g, "scores": [1] * 5, "comment": COMMENT, "age_days": 1, "state": "pending"}])["reviews"]
    ids = [p["id"] for p in pending]
    listed = [x["id"] for x in op.get("/api/moderation/reviews").json() if x["id"] in ids]
    assert listed == ids, "pending reviews are oldest first"
    assert Api(app_url).sign_in(g).get("/api/moderation/reviews").status_code == 403
    assert Api(app_url).get("/api/moderation/reviews").status_code == 401
    r = op.post(f"/api/moderation/reviews/{ids[0]}/publish")
    assert r.status_code == 200 and r.json()["state"] == "published", r.text
    assert op.post(f"/api/moderation/reviews/{ids[0]}/reject").json()["error"] == "not_pending"
    assert op.post(f"/api/moderation/reviews/{ids[1]}/reject").json()["state"] == "rejected"
    assert op.post(f"/api/moderation/reviews/{uuid.uuid4().hex}/publish").status_code == 404
    want = review_score(list(SCORE_EXAMPLE) + [(10, 3)])
    assert round(res()["score"] * 10) == want and res()["rank"] == rank0 + 3 * (want - SCORE_EXAMPLE_SHOWN)
    links = seed(api, bookings=[booking_body(code, day(1), day(2), guest=g), booking_body(code, day(1), day(2), guest=g)])["bookings"]
    token = "/api" + links[0]["review_link"]
    assert api.get(token).status_code == 403 and api.get(token).json() == {"error": "too_early"}
    done = completion(day(2), w.zone)
    set_clock(api, iso_ms(done))
    r = api.get(token)
    assert r.status_code == 200 and instant(r.json()["open_until"]) == done + dt.timedelta(milliseconds=REVIEW_WINDOW_MS), r.text
    inbox = Api(app_url).sign_in(g).get("/api/inbox").json()
    assert any(m["link"] == links[0]["review_link"] and m["kind"] == "review" for m in inbox)
    scores = {k: 9 for k in ("cleanliness", "comfort", "location", "staff", "value")}
    r = api.post(token, {**scores, "cleanliness": 11, "comment": COMMENT})
    assert r.status_code == 422 and "review.score_range" in json.dumps(r.json()), r.text
    r = api.post(token, {**scores, "comment": "a" * (COMMENT_MAX + 1)})
    assert r.status_code == 422 and "too_long" in json.dumps(r.json()), r.text
    r = api.post(token, {**scores, "comment": COMMENT})
    assert r.status_code == 201 and r.json()["state"] == "pending", r.text
    assert api.post(token, {**scores, "comment": COMMENT}).json() == {"error": "already_reviewed"}
    set_clock(api, iso_ms(done + dt.timedelta(milliseconds=REVIEW_WINDOW_MS)))
    r = api.get("/api" + links[1]["review_link"])
    assert r.status_code == 410 and r.json() == {"error": "window_closed"}, r.text


def test_calendar_validation_and_seasons(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    book(Api(app_url), code, day(5), day(6), [room(rt)])
    cal = mgr.get(f"/api/manage/{code}/calendar", params={"from": day(0), "days": 28}).json()
    assert len([c for c in cal["cells"] if c["room_type"] == rt]) == 28
    errors = lambda r: json.dumps(r.json())
    r = edit_nights(mgr, code, [rt], day(30), day(30), rate_minor=0)
    assert r.status_code == 422 and "rate_min" in errors(r)
    r = edit_nights(mgr, code, [rt], day(30), day(30), min_stay=5, max_stay=2)
    assert r.status_code == 422 and "max_below_min" in errors(r)
    r = edit_nights(mgr, code, [rt], day(5), day(5), rooms=0)
    assert r.status_code == 422 and "rooms_sold" in errors(r) and re.search(r'"n":\s*1\b', errors(r)), r.text
    r = edit_nights(mgr, code, [rt], day(14), day(20), rate_minor=BASE_RATE + 1000)
    assert r.status_code == 422 and "season_name" in errors(r)
    weekdays = [1, 2, 3, 4, 5]
    r = edit_nights(mgr, code, [rt], day(14), day(20), weekdays=weekdays, rate_minor=BASE_RATE + 1000, season_name="Spring")
    assert r.status_code == 200 and r.json()["season"] == {"name": "Spring"}
    assert r.json()["changed_nights"] == sum(dt.date.fromisoformat(d).isoweekday() in weekdays for d in span(day(14), day(21)))
    r = edit_nights(mgr, code, [rt], day(14), day(20), weekdays=[6, 7], rate_minor=BASE_RATE + 500, season_name="Weekend")
    assert r.status_code == 200, "seasons on disjoint weekdays do not overlap"
    r = edit_nights(mgr, code, [rt], day(18), day(24), weekdays=[5, 6, 7], rate_minor=BASE_RATE + 1500, season_name="Summer")
    shared = [d for d in span(day(18), day(21)) if dt.date.fromisoformat(d).isoweekday() == 5]
    assert r.status_code == 409, r.text
    assert {k: r.json()[k] for k in ("error", "season", "other", "from", "to")} == {"error": "season_overlap", "season": "Summer", "other": "Spring", "from": shared[0], "to": shared[-1]}
    cells = {c["date"]: c for c in mgr.get(f"/api/manage/{code}/calendar", params={"from": day(14), "days": 28}).json()["cells"] if c["room_type"] == rt}
    for d in span(day(14), day(21)):
        wd = dt.date.fromisoformat(d).isoweekday()
        assert cells[d]["rate_minor"] == BASE_RATE + (1000 if wd <= 5 else 500), d
    assert edit_nights(mgr, code, [rt], day(40), day(40), rate_minor=BASE_RATE * 2).status_code == 200
    w.rates[(rt, day(40))] = BASE_RATE * 2
    res = api.get("/api/search?" + search_query(w.dest, day(40), day(41))).json()["results"]
    assert next(x for x in res if x["code"] == code)["total_minor"] == price_stay(w, code, [room(rt)], day(40), day(41))["total"]
    other = World(api)
    ocode = other.add(other.spec())[0]
    assert mgr.get(f"/api/manage/{ocode}/calendar", params={"from": day(0), "days": 28}).status_code == 404
    assert Api(app_url).get(f"/api/manage/{code}/calendar", params={"from": day(0), "days": 28}).status_code == 401


def test_accounts_signup_signin_signout(app_url):
    api = Api(app_url)
    t = new_tag()
    r = api.post("/api/signup", {"username": f"Ab_{t}", "password": PASSWORD})
    assert r.status_code == 201 and r.json() == {"username": f"ab_{t}", "role": "guest"}, r.text
    cookie = " ".join(r.headers.get_list("set-cookie"))
    assert "kip_session" in cookie and "HttpOnly" in cookie and re.search("SameSite=Lax", cookie, re.I)
    assert api.get("/api/me").json()["user"]["username"] == f"ab_{t}"
    assert "signup.username" in json.dumps(Api(app_url).post("/api/signup", {"username": "ab", "password": PASSWORD}).json())
    assert "signup.password" in json.dumps(Api(app_url).post("/api/signup", {"username": f"c{t}", "password": "short"}).json())
    dup = Api(app_url).post("/api/signup", {"username": f"ab_{t}", "password": PASSWORD})
    assert dup.status_code == 409 and dup.json() == {"error": "username_taken"}
    wrong = Api(app_url).post("/api/signin", {"username": f"ab_{t}", "password": PASSWORD + "x"})
    assert wrong.status_code == 401 and wrong.json() == {"error": "bad_credentials"}
    a, b = Api(app_url), Api(app_url)
    for c in (a, b):
        r = c.post("/api/signin", {"username": f"ab_{t}", "password": PASSWORD})
        assert r.status_code == 200 and r.json()["manages"] == [] and r.json()["role"] == "guest"
    r = a.patch("/api/me/preferences", {"lang": "de", "cur": "JPY"})
    assert r.status_code == 200 and (r.json()["lang"], r.json()["cur"]) == ("de", "JPY")
    assert a.patch("/api/me/preferences", {"lang": "xx"}).status_code == 422
    s = Stream(b)
    try:
        s.wait("clock")
        a.patch("/api/me/preferences", {"cur": "KWD"})
        s.wait("account.changed", lambda d: d.get("cur") == "KWD")
        assert a.post("/api/signout-everywhere").status_code == 204
        s.wait("account.changed", lambda d: d.get("signed_out") is True)
    finally:
        s.close()
    assert b.get("/api/me").json()["user"] is None and a.get("/api/me").json()["user"] is None
    assert a.post("/api/signout-everywhere").status_code == 401
    c = Api(app_url)
    c.post("/api/signin", {"username": f"ab_{t}", "password": PASSWORD})
    assert c.post("/api/signout").status_code == 204 and c.get("/api/me").json()["user"] is None


def test_loyalty_tiers_rolling(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=5))[0]
    rt = f"{code}-DBL"
    past = lambda k: day(-20 * (k + 1))
    me = lambda u: Api(app_url).sign_in(u).get("/api/me").json()
    kestrel = me(w.user(completed=tuple((code, past(k)) for k in range(5))))
    assert (kestrel["tier"], kestrel["completed_stays"], len(kestrel["perks"])) == ("Kestrel", 5, 2)
    u = w.user(completed=((code, past(0)),))
    seed(api, bookings=[booking_body(code, day(3), day(4), guest=u, state="cancelled"), booking_body(code, day(-3), day(-2), guest=u, state="no_show")])
    seed(api, bookings=[booking_body(code, day(0), day(1), guest=u)])
    assert (me(u)["tier"], me(u)["completed_stays"]) == ("Wren", 1)
    done = completion(day(1), w.zone)
    set_clock(api, iso_ms(done - dt.timedelta(minutes=5)))
    client = Api(app_url).sign_in(u)
    q1 = make_quote(client, code, day(20), day(22), [room(rt)])
    assert q1["tier"] == "Wren"
    advance_clock(api, 360000)
    after = me(u)
    assert (after["tier"], after["completed_stays"], len(after["perks"])) == ("Heron", 2, 1)
    assert client.get(f"/api/quotes/{q1['id']}").json()["tier"] == "Wren", "a live quote keeps its pinned tier"
    q2 = make_quote(client, code, day(20), day(22), [room(rt)])
    assert q2["tier"] == "Heron"
    assert q2["total_minor"] == price_stay(w, code, [room(rt)], day(20), day(22), HERON_PCT, today=dt.date.fromisoformat(day(1)))["total"]
    r = w.user(completed=((code, "2026-01-10"), (code, CHECKOUT_EXAMPLE)))
    assert me(r)["tier"] == "Heron"
    set_clock(api, iso_ms(completion("2026-01-10", w.zone) + dt.timedelta(days=LOYALTY_DAYS, hours=1)))
    assert (me(r)["tier"], me(r)["completed_stays"]) == ("Wren", 1)


RATE_HEADER = "KIPRATES 1"


def bad_rate_file(rt: str) -> tuple[bytes, list[tuple[int, str]]]:
    lines = [RATE_HEADER, "A|B|C", f"NOPE|refundable|{day(30)}|{day(31)}|MTWTFSS|100||",
             f"{rt}|nonrefundable|{day(30)}|{day(31)}|MTWTFSS|100||", f"{rt}|refundable|2027-02-30|{day(31)}|MTWTFSS|100||",
             f"{rt}|refundable|{day(36)}|{day(30)}|MTWTFSS|100||", f"{rt}|refundable|{day(30)}|{day(31)}|MTWXFSS|100||",
             f"{rt}|refundable|{day(30)}|{day(31)}|MTWTFSS|0||", f"{rt}|refundable|{day(30)}|{day(31)}|MTWTFSS|100|3|2",
             "# a comment", "", f"{rt}|refundable|{day(40)}|{day(42)}|MTWTFSS|100||", f"{rt}|refundable|{day(42)}|{day(44)}|MTWTFSS|100||"]
    keys = [(2, "fields"), (3, "room"), (4, "plan"), (5, "date"), (6, "order"), (7, "weekdays"), (8, "rate"), (9, "limits"), (13, "overlap")]
    return ("\n".join(lines) + "\n").encode(), keys


def good_rate_file(rt: str) -> bytes:
    return "\r\n".join([RATE_HEADER, f"{rt}|refundable|{day(30)}|{day(36)}|MTWTF--|14000||",
                        f"{rt}|refundable|{day(37)}|{day(38)}|MTWTFSS|15000|2|5", ""]).encode()


def good_changes(rt: str) -> list[tuple[str, str, int, int]]:
    rows = [(rt, d, BASE_RATE, 14000) for d in span(day(30), day(37)) if dt.date.fromisoformat(d).isoweekday() <= 5]
    return rows + [(rt, d, BASE_RATE, 15000) for d in span(day(37), day(39))]


def test_rate_import_validation_and_apply(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    raw = lambda path, data: mgr.http.post(path, content=data, headers={"content-type": "text/plain"})
    pre, app = f"/api/manage/{code}/imports/preview", f"/api/manage/{code}/imports"
    r = raw(pre, b"KIPRATES 2\nanything\n")
    assert r.status_code == 422 and [(x["line"], x["key"].split(".")[-1]) for x in r.json()["lines"]] == [(1, "header")]
    data, keys = bad_rate_file(rt)
    r = raw(pre, data)
    assert r.status_code == 422 and r.json()["error"] == "import_invalid"
    assert [(x["line"], x["key"].split(".")[-1]) for x in r.json()["lines"]] == keys
    assert raw(app, data).status_code == 422
    good = good_rate_file(rt)
    sha = hashlib.sha256(good).hexdigest()
    r = raw(pre, good)
    assert r.status_code == 200 and r.json()["sha256"] == sha, r.text
    rows = [(c["room"], c["date"], c["old_minor"], c["new_minor"]) for c in r.json()["changes"]]
    assert rows == good_changes(rt) and r.json()["count"] == len(rows)
    assert not S3().keys(f"imports/{code}/"), "a preview stores nothing"
    r = raw(app, good)
    assert r.status_code == 201 and r.json()["sha256"] == sha and r.json()["count"] == len(rows), r.text
    assert S3().get(f"imports/{code}/{sha}.kiprates") == good
    cells = {c["date"]: c for c in mgr.get(f"/api/manage/{code}/calendar", params={"from": day(30), "days": 28}).json()["cells"] if c["room_type"] == rt}
    for _, d, _, new in rows:
        assert cells[d]["rate_minor"] == new, d
    assert (cells[day(37)]["min_stay"], cells[day(37)]["max_stay"]) == (2, 5)
    assert raw(app, good).json()["count"] == 0, "re-applying the same file changes nothing"
    edge = RATE_HEADER.encode() + b"\n"
    edge += b"#" * (IMPORT_MAX_BYTES - len(edge) - 1) + b"\n"
    assert len(edge) == IMPORT_MAX_BYTES and raw(pre, edge).status_code == 200
    r = raw(pre, edge + b"#")
    assert r.status_code == 413 and r.json() == {"error": "too_large"}
    other = World(api)
    assert raw(f"/api/manage/{other.add(other.spec())[0]}/imports/preview", good).status_code == 404


def test_storage_outage_instance(app_url):
    down = Api(os.environ["APP_MINIO_DOWN_URL"])
    assert down.get("/api/health").json() == {"status": "unavailable"}
    set_clock(down, CLOCK_START)
    w = World(down)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = Api(down.base).sign_in(w.user("manager", manages=(code,)))
    res = down.get("/api/search?" + search_query(w.dest, day(10), day(12))).json()
    assert [r["code"] for r in res["results"]] == [code]
    good = good_rate_file(rt)
    r = mgr.http.post(f"/api/manage/{code}/imports/preview", content=good, headers={"content-type": "text/plain"})
    assert r.status_code == 200
    r = mgr.http.post(f"/api/manage/{code}/imports", content=good, headers={"content-type": "text/plain"})
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    cells = {c["date"]: c for c in mgr.get(f"/api/manage/{code}/calendar", params={"from": day(30), "days": 28}).json()["cells"] if c["room_type"] == rt}
    assert cells[day(30)]["rate_minor"] == BASE_RATE, "a failed import applies nothing"
    assert not S3().keys(f"imports/{code}/")
    r = down.get(f"/images/{code}/1.svg")
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    b = book(down, code, day(10), day(12), [room(rt)])
    r = down.get(f"/bookings/{b['code']}/invoice")
    assert r.status_code == 503 and "Storage is unavailable. Try again." in r.text
    set_clock(down, "2027-04-01T12:00:00.000Z")
    r = mgr.get(f"/api/manage/{code}/statements/{TODAY.strftime('%Y-%m')}.csv")
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}


def test_access_order_404_before_403(app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    a, b = w.user(), w.user()
    other = World(api)
    ocode = other.add(other.spec())[0]
    mine, theirs = Api(app_url).sign_in(w.user("manager", manages=(code,))), Api(app_url).sign_in(other.user("manager", manages=(ocode,)))
    ga, gb = Api(app_url).sign_in(a), Api(app_url).sign_in(b)
    bk = seed(api, bookings=[booking_body(code, day(10), day(12), guest=a)])["bookings"][0]["code"]
    path = f"/api/bookings/{bk}"
    unknown = gb.get("/api/bookings/KW-AAAAAA")
    for c in (gb, Api(app_url), theirs):
        r = c.get(path)
        assert r.status_code == 404 and r.json() == unknown.json(), r.text
    assert ga.get(path).status_code == 200 and mine.get(path).status_code == 200
    assert gb.post(f"{path}/cancellations", {"rooms": [1]}).status_code == 404, "404 before 422"
    assert gb.post(f"{path}/no-show").status_code == 404
    r = ga.post(f"{path}/no-show", headers={"If-Match": get_booking(ga, bk)[1]})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert gb.get(f"/bookings/{bk}/invoice").status_code == 404
    assert theirs.get(f"/api/manage/{code}/reservations").status_code == 404
    assert Api(app_url).get(f"/api/manage/{code}/reservations").status_code == 401
    rid = seed(api, reviews=[{"property": code, "guest": a, "scores": [8] * 5, "comment": COMMENT, "age_days": 0, "state": "pending"}])["reviews"][0]["id"]
    assert ga.post(f"/api/moderation/reviews/{rid}/publish").status_code == 403
    finder = Api(app_url)
    r = finder.post("/api/bookings/find", {"code": bk.lower(), "surname": f"  {SURNAME.upper()} "})
    assert r.status_code == 200 and r.json() == {"code": bk}
    assert finder.get(path).status_code == 200
    miss = Api(app_url).post("/api/bookings/find", {"code": bk, "surname": "Other"})
    assert miss.status_code == 404 and miss.json() == {"error": "not_found"}


def csv_cell(value: str) -> str:
    if value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        value = "'" + value
    return f'"{value.replace(chr(34), chr(34) * 2)}"' if any(ch in value for ch in ',"\n\r') else value


def export_world(api: Api, app_url: str) -> dict:
    w = World(api)
    code = w.add(w.spec(rooms=2, policy=[dict(FREE_TIER), dict(HALF_TIER)]))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    v = Api(app_url)
    b1 = book(v, code, day(3), day(5), [room(rt)], surname=FORMULA_SURNAME)
    b2 = book(v, code, day(10), day(12), [room(rt), room(rt, breakfast=True)], surname='Lind, "Ada"')
    set_clock(api, iso_ms(deadline(day(10), FREE_TIER, w.zone)))
    _, etag = get_booking(v, b2["code"])
    refund = v.post(f"/api/bookings/{b2['code']}/cancellations", {"rooms": [2]}, {"If-Match": etag}).json()["refund_minor"]
    e1 = price_stay(w, code, [room(rt)], day(3), day(5))
    e2 = price_stay(w, code, [room(rt), room(rt, breakfast=True)], day(10), day(12))
    retained = b2["rooms"][1]["paid_minor"] - refund
    stay = sorted([(b1["code"], sum(n["t"] for n in e1["rooms"][0])), (b2["code"], sum(n["t"] for n in e2["rooms"][0]))])
    lines = [(c, "stay", base, rnd(base * COMMISSION_PCT, 100)) for c, base in stay] + [(b2["code"], "cancellation", retained, rnd(retained * COMMISSION_PCT, 100))]
    reservations = "code,surname,arrival,departure,rooms,total_minor\n" + "".join(
        f"{b['code']},{csv_cell(s)},{din},{dout},{n},{t}\n" for b, s, din, dout, n, t in
        ((b1, FORMULA_SURNAME, day(3), day(5), 1, b1["total_minor"]), (b2, 'Lind, "Ada"', day(10), day(12), 1, b2["total_minor"] - refund)))
    statement = "code,kind,base_minor,commission_minor\n" + "".join(f"{c},{k},{b},{m}\n" for c, k, b, m in lines)
    statement += f"total,,{sum(x[2] for x in lines)},{sum(x[3] for x in lines)}\n"
    return {"w": w, "code": code, "mgr": mgr, "lines": lines, "reservations": reservations, "statement": statement, "month": TODAY.strftime("%Y-%m")}


def test_exports_and_statements(app_url):
    api = fresh(app_url)
    x = export_world(api, app_url)
    mgr, code, month = x["mgr"], x["code"], x["month"]
    r = mgr.get(f"/api/manage/{code}/reservations.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and r.text == x["reservations"], r.text
    st = mgr.get(f"/api/manage/{code}/statements/{month}").json()
    assert [(l["code"], l["kind"], l["base_minor"], l["commission_minor"]) for l in st["lines"]] == x["lines"]
    assert st["total_commission_minor"] == sum(l[3] for l in x["lines"]) and st["downloadable"] is False
    r = mgr.get(f"/api/manage/{code}/statements/{month}.csv")
    assert r.status_code == 409 and r.json() == {"error": "month_open"}
    set_clock(api, "2027-04-01T12:00:00.000Z")
    assert mgr.get(f"/api/manage/{code}/statements/{month}").json()["downloadable"] is True
    r = mgr.get(f"/api/manage/{code}/statements/{month}.csv")
    assert r.status_code == 200 and r.text == x["statement"], r.text
    assert S3().get(f"statements/{code}/{month}.csv").decode() == x["statement"]


def test_invoice_and_print(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    g = w.user()
    client = Api(app_url).sign_in(g)
    b = book(client, code, day(10), day(12), [room(rt), room(rt)])
    e = price_stay(w, code, [room(rt), room(rt)], day(10), day(12))
    r = client.get(f"/bookings/{b['code']}/invoice")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert S3().get(f"invoices/{b['code']}.html").decode() == r.text
    for text in (b["code"], GIVEN, SURNAME, w.name(), w.zone, "Paid by card ending 0002"):
        assert text in r.text, text
    amounts = {int(m) for m in re.findall(r'data-minor="(-?\d+)"', r.text)}
    want = {e["total"], sum(n["lines"]["vat"] for n in e["nights"]), sum(n["lines"]["city_tax"] for n in e["nights"])}
    want |= {v for n in e["nights"] for v in n["lines"].values()}
    assert want <= amounts, want - amounts
    _, etag = get_booking(client, b["code"])
    refund = client.post(f"/api/bookings/{b['code']}/cancellations", {"rooms": [1]}, {"If-Match": etag}).json()["refund_minor"]
    again = client.get(f"/bookings/{b['code']}/invoice").text
    assert str(refund) in re.findall(r'data-minor="(-?\d+)"', again) and S3().get(f"invoices/{b['code']}.html").decode() == again
    with browse(browser, app_url, f"/bookings/{b['code']}", user=g) as page:
        settled(page)
        page.emulate_media(media="print")
        text = page.locator("body").inner_text()
        for piece in (b["code"], GIVEN, w.name(), w.zone, "Plan rate", "Night total"):
            assert piece in text, piece
        assert "Cancel booking" not in text and "Language" not in text, "print hides buttons and the header"


def test_wf_search_by_keyboard_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(0, rooms=2), w.spec(1, rooms=2, rate=9000))
    with browse(browser, app_url, "/") as page:
        settled(page)
        link = page.get_by_role("link", name="Search stays")
        tab_to(page, link, "link Search stays")
        page.keyboard.press("Enter")
        holds(page, lambda: urlparse(page.url).path == "/search", "Search stays opens /search")
        settled(page)
        cb = page.get_by_role("combobox", name="Destination")
        tab_to(page, cb, "combobox Destination")
        page.keyboard.type(w.dest_name[3:].lower())
        advance(page, TYPE_DEBOUNCE_MS)
        shows(page, page.get_by_role("option", name=f"{w.dest_name}, 2 properties"), "the destination is listed")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        dates = page.get_by_role("button", name=re.compile(r"^Dates"))
        tab_to(page, dates, "button Dates")
        page.keyboard.press("Enter")
        settled(page)
        shows(page, page.get_by_role("status", name="Date help"), "date.start", "Pick your arrival date.")
        for _ in range(10):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("status", name="Date help"), "date.end", f"Minimum stay from {when(page, day(10))} is 1 night. Pick your departure date.")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        focused(page, dates, "focus returns to Dates")
        children = page.get_by_role("spinbutton", name="Children")
        tab_to(page, children, "spinbutton Children")
        page.keyboard.press("ArrowUp")
        select(page.get_by_role("combobox", name=sub(AGE_LABEL, "n", 1)), "7")
        search = page.get_by_role("button", name="Search")
        tab_to(page, search, "button Search")
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("status", name="Search announcements"), "count.found", "2 properties found")
        settled(page)
        query = urlparse(page.url).query
        api_res = api.get("/api/search?" + query).json()
        assert api_res["count"] == 2 and ("ages", "7") in parse_qsl(query) and ("in", day(10)) in parse_qsl(query)
        for r in api_res["results"]:
            assert r["display_minor"] in minors(article(page, r["name"]))
        first = page.get_by_role("article").first.get_by_role("link", name=api_res["results"][0]["name"])
        tab_to(page, first, "the first row's name link")
        page.keyboard.press("Enter")
        holds(page, lambda: urlparse(page.url).path == f"/properties/{api_res['results'][0]['code']}", "Enter on a row opens the property page")


def test_wf_search_by_keyboard_blocked_day(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.code()
    rt = f"{code}-DBL"
    w.add(w.spec(rooms=2), nights=[night(rt, day(3), stop_sell=True), night(rt, day(5), min_stay=3)])
    with browse(browser, app_url, f"/search?dest={w.dest}&lang=en&cur=EUR") as page:
        settled(page)
        dates = page.get_by_role("button", name=re.compile(r"^Dates"))
        dates.focus()
        page.keyboard.press("Enter")
        settled(page)
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        contains(page, page.get_by_role("status", name="Date help"), f"Not on sale on {when(page, day(3))}.", "reason.stop_sell in Date help")
        assert active_date(page) == day(3)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("status", name="Date help"), "date.end", f"Minimum stay from {when(page, day(5))} is 3 nights. Pick your departure date.")
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        focused(page, dates, "the range closes the picker")
        search = page.get_by_role("button", name="Search")
        search.focus()
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("status", name="Search announcements"), "count.found", "1 property found")
        res = api.get("/api/search?" + urlparse(page.url).query).json()
        assert res["count"] == 1 and ("in", day(5)) in query_pairs(page.url) and ("out", day(8)) in query_pairs(page.url)


def test_wf_search_history_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(*[w.spec(i, stars=4 if i < 6 else 3, rate=8000 + 600 * i, x=480.0 + 5 * i, y=500.0) for i in range(PAGE_SIZE_PROBE)])
    names = lambda p: [a.get_by_role("link").first.inner_text() for a in p.get_by_role("article").all()]
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        click(page.get_by_role("checkbox", name=re.compile(r"^4 stars \(\d+\)$")))
        holds(page, lambda: ("stars", "4") in query_pairs(page.url), "stars in the URL")
        select(page.get_by_role("combobox", name="Sort by"), "Price, low to high")
        holds(page, lambda: ("sort", "price_asc") in query_pairs(page.url), "sort in the URL")
        m = page.get_by_role("region", name="Map")
        click(m.get_by_role("button", name="Pan west"))
        click(m.get_by_role("button", name="Pan west"))
        advance(page, MAP_DEBOUNCE_MS)
        click(page.get_by_role("button", name="Search this area"))
        holds(page, lambda: {"zoom", "cx", "cy"} <= {k for k, _ in query_pairs(page.url)}, "area in the URL")
        settled(page)
        first_names = names(page)
        click(page.get_by_role("link", name="Next page"))
        holds(page, lambda: "cursor" in {k for k, _ in query_pairs(page.url)}, "Next page pushes the cursor")
        settled(page)
        second_names = names(page)
        assert not set(first_names) & set(second_names), "paging never repeats a property"
        shared = page.url
        api_names = [r["name"] for r in api.get("/api/search?" + urlparse(shared).query).json()["results"]]
        assert second_names == api_names
        with browse(browser, app_url, urlparse(shared).path + "?" + urlparse(shared).query) as other:
            settled(other)
            focused(other, other.get_by_role("heading", name="Results"), "a shared link focuses Results")
            assert names(other) == second_names
        page.go_back()
        holds(page, lambda: "cursor" not in {k for k, _ in query_pairs(page.url)}, "back leaves the cursor")
        settled(page)
        assert names(page) == first_names
        page.go_forward()
        holds(page, lambda: "cursor" in {k for k, _ in query_pairs(page.url)}, "forward restores the page")
        settled(page)
        assert names(page) == second_names


def test_wf_search_history_normalise(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec())
    with browse(browser, app_url, "/") as page:
        assert page.request.patch(f"{app_url}/api/me/preferences", data={"cur": "JPY"}).status == 200
        page.goto(f"{app_url}/search?dest={w.dest}&in={day(10)}&out={day(12)}&zzz=1")
        settled(page)
        shows(page, page.get_by_role("status", name="Link notice"), "notice.ignored", "Ignored zzz.")
        canonical = [("dest", w.dest), ("in", day(10)), ("out", day(12)), ("lang", "en"), ("cur", "JPY")]
        holds(page, lambda: query_pairs(page.url) == canonical, "the URL is replaced with the canonical form")
        body = page.request.get(f"{app_url}/api/search?dest={w.dest}&in={day(10)}&out={day(12)}&zzz=1").json()
        assert parse_qsl(body["canonical"]) == canonical


def test_wf_quote_build_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.code()
    w.add(w.spec(rooms=3, rate=9000, family=(1, 30000)))
    user = w.user(completed=((code, CHECKOUT_EXAMPLE), (code, "2027-01-20")))
    din, dout = day(10), day(12)
    rec, _ = recommend(w, code, 3, [7], din, dout)
    assert len(rec) == 2
    with browse(browser, app_url, prop_path(w, code, din, dout, adults=3, ages=(7,)), user=user) as page:
        settled(page)
        to_checkout(page)
        select(page.get_by_role("combobox", name="Currency"), "KWD")
        settled(page)
        nights = page.get_by_role("group", name="Night Strip").locator("[data-date]")
        holds(page, lambda: all(n.locator("[data-minor]").first.get_attribute("data-currency") == "KWD" for n in nights.all()), "nights show KWD")
        qid = urlparse(page.url).path.rsplit("/", 1)[1]
        q = page.request.get(f"{app_url}/api/quotes/{qid}").json()
        total, split = convert([n["total_minor"] for n in q["nights"]], q["rates_ppm"]["KWD"], "KWD")
        assert [minors(n)[0] for n in nights.all()] == split and total in minors(price_region(page))
        click(page.get_by_role("radio", name="Per night"))
        holds(page, lambda: rnd(total, len(split)) in minors(price_region(page)), "Per night shows round(total / nights)")
        nights.first.focus()
        for i in range(len(split)):
            page.keyboard.press("Enter")
            items = page.get_by_role("list", name="Price lines").get_by_role("listitem")
            soon(page, lambda: expect(items.first).to_be_visible(timeout=SHORT_MS), "Enter shows price lines")
            got = {it.get_attribute("data-currency") for it in items.all()}
            vals = [int(it.get_attribute("data-minor")) for it in items.all()]
            assert got == {"EUR"} and sum(vals[:-1]) == vals[-1] == q["nights"][i]["total_minor"]
            page.keyboard.press("Escape")
            page.keyboard.press("ArrowRight")
    assert q["tier"] == "Heron" and len(q["rooms"]) == 2 and [7] in [r["ages"] for r in q["rooms"]]
    assert q["total_minor"] == price_stay(w, code, rec, din, dout, HERON_PCT)["total"]
    assert any(l["key"] == "tourism_levy" for l in q["rooms"][0]["nights"][0]["lines"])


def test_wf_quote_build_options(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.code()
    rt = f"{code}-DBL"
    w.add(w.spec(rooms=3))
    din, dout = day(10), day(12)
    with browse(browser, app_url, prop_path(w, code, din, dout, adults=4)) as page:
        settled(page)
        click(page.get_by_role("radiogroup", name=sub(RATE_FOR, "n", 1)).get_by_role("radio", name="Nonrefundable"))
        settled(page)
        click(page.get_by_role("checkbox", name=sub(BREAKFAST_FOR, "n", 2)))
        settled(page)
        want = price_stay(w, code, [room(rt, plan="nonrefundable"), room(rt, breakfast=True)], din, dout)["total"]
        holds(page, lambda: want in minors(price_region(page)), "the page shows the chosen selection's total")
        qid = to_checkout(page)
        q = page.request.get(f"{app_url}/api/quotes/{qid}").json()
    assert [(r["plan"], r["breakfast"]) for r in q["rooms"]] == [("nonrefundable", False), ("refundable", True)]
    assert q["total_minor"] == want


def test_wf_checkout_pressure_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    path = prop_path(w, code, day(10), day(12))
    with browse(browser, app_url, path) as a, browse(browser, app_url, path) as b:
        to_checkout(a)
        to_checkout(b)
        place_hold(a)
        shows(b, b.get_by_role("alertdialog", name="Just taken"), "the loser sees Just taken")
        assert edit_nights(mgr, code, [rt], day(10), day(10), rate_minor=BASE_RATE + 3000).status_code == 200
        w.rates[(rt, day(10))] = BASE_RATE + 3000
        changed = a.get_by_role("alertdialog", name="The price changed")
        shows(a, changed, "the winner sees The price changed")
        click(changed.get_by_role("button", name="Accept new price"))
        fill_guest(a, CARD_DECLINED)
        click(a.get_by_role("button", name="Pay"))
        problems = a.get_by_role("region", name="Problems")
        shows(a, problems, "a declined card lists a problem")
        expect(problems.get_by_role("heading")).to_have_text("There is 1 problem")
        expect(problems.get_by_role("link", name=f"{CARD_LABEL}: {DECLINED}")).to_be_visible()
        fill(a.get_by_role("textbox", name="Card number"), CARD_OK)
        a.get_by_role("button", name="Pay").dblclick()
        bk = booking_code_from(a)
        shows(a, a.get_by_role("heading", name=f"Booking {bk}"), "the booking page")
    rows = mgr.get(f"/api/manage/{code}/reservations").json()
    assert [r["code"] for r in rows] == [bk]
    booking = mgr.get(f"/api/bookings/{bk}").json()
    assert len([e for e in booking["ledger"] if e["kind"] == "charge"]) == 2 and booking["balance_minor"] == 0
    assert booking["total_minor"] == price_stay(w, code, [room(rt)], day(10), day(12))["total"]


def test_wf_checkout_pressure_expired(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    with browse(browser, app_url, prop_path(w, code, day(10), day(12))) as page:
        qid = to_checkout(page)
        place_hold(page)
        assert left(api, code, rt, day(10), day(12)) == 0
        q = page.request.get(f"{app_url}/api/quotes/{qid}").json()
        advance_clock(api, HOLD_MS)
        shows(page, page.get_by_role("alertdialog", name="Your hold ended"), "hold.expired raises the dialog")
        r = page.request.post(f"{app_url}/api/bookings", data=pay_body({"id": q["hold_id"]}, q), headers={"Idempotency-Key": idempotency_key()})
        assert r.status == 410 and r.json() == {"error": "hold_expired"}
    assert left(api, code, rt, day(10), day(12)) == 1


def test_wf_arabic_journey_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(0, rooms=2, stars=4), w.spec(1, rooms=2, stars=5))[0]
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        click(page.get_by_role("checkbox", name=re.compile(r"^4 stars \(\d+\)$")))
        settled(page)
        page.evaluate("() => { window.__kipStay = true; }")
        select(page.get_by_role("combobox", name=LANGUAGE_BOX), "العربية")
        shows(page, page.get_by_role("heading", name="النتائج"), "Arabic heading")
        select(page.get_by_role("combobox", name="العملة"), "KWD")
        holds(page, lambda: {("lang", "ar"), ("cur", "KWD"), ("stars", "4")} <= set(query_pairs(page.url)), "filters kept with ar and KWD")
        assert page.evaluate("() => window.__kipStay === true && document.documentElement.dir === 'rtl'")
        expect(page.get_by_role("checkbox", name=re.compile(r"^4 نجوم"))).to_be_checked()
        page.goto(app_url + prop_path(w, code, day(10), day(12), lang="ar", cur="KWD"))
        settled(page)
        click(page.get_by_role("button", name=re.compile(r"^التواريخ")))
        shows(page, page.get_by_role("dialog", name="اختر التواريخ"), "Arabic date picker")
        start = dt.date.fromisoformat(active_date(page))
        page.keyboard.press("ArrowLeft")
        holds(page, lambda: active_date(page) == (start + dt.timedelta(1)).isoformat(), "ArrowLeft moves forward")
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Enter")
        settled(page)
        click(price_region(page, "السعر والحجز").get_by_role("button", name="احجز"))
        holds(page, lambda: "/checkout/" in page.url, "Reserve opens checkout")
        settled(page)
        q = page.request.get(f"{app_url}/api/quotes/{urlparse(page.url).path.rsplit('/', 1)[1]}").json()
        nights = page.get_by_role("group", name="Night Strip").locator("[data-date]")
        split = [minors(n)[0] for n in nights.all()]
    assert q["currency"] == "KWD" and q["in"] == (start + dt.timedelta(1)).isoformat()
    assert split == [n["converted_minor"] for n in q["nights"]] and sum(split) == q["converted_total_minor"]


def test_wf_arabic_journey_shared_link(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec())
    with browse(browser, app_url, search_path(w, day(10), day(12), lang="ar", cur="KWD")) as page:
        settled(page)
        shows(page, page.get_by_role("heading", name="النتائج"), "Arabic heading")
        assert page.evaluate("() => document.documentElement.dir") == "rtl"
        r = next(x for x in page.request.get(f"{app_url}/api/search?" + search_query(w.dest, day(10), day(12), lang="ar", cur="KWD")).json()["results"])
        assert r["display_currency"] == "KWD" and r["display_minor"] in minors(page.get_by_role("article").first)
        me = page.request.get(f"{app_url}/api/me").json()
        assert (me["lang"], me["cur"]) == ("en", "EUR"), "URL values never change the stored ones"


def test_wf_phone_journey_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(0, rooms=2), w.spec(1, rooms=2, stars=3, x=520.0))[0]
    with browse(browser, app_url, search_path(w, day(10), day(12)), size="narrow", reduced=True) as page:
        settled(page)
        tap(page.get_by_role("button", name="Filters"))
        sheet = page.get_by_role("dialog", name="Filters")
        shows(page, sheet, "Filters sheet")
        tap(sheet.get_by_role("checkbox", name=re.compile(r"^4 stars \(\d+\)$")))
        holds(page, lambda: ("stars", "4") in query_pairs(page.url), "the filter applies")
        page.keyboard.press("Escape")
        tap(page.get_by_role("button", name="Map", exact=True))
        msheet = page.get_by_role("dialog", name="Map")
        shows(page, msheet, "Map sheet")
        tap(msheet.get_by_role("button", name=re.compile("^" + re.escape(w.name(0)) + ", score")))
        gone(page, msheet, "a pin closes the map sheet")
        focused(page, page.get_by_role("button", name=f"Show {w.name(0)} on the map"), "focus returns to the row's map button")
        attr(page, article(page, w.name(0)), "aria-current", "true", "the row is selected")
        tap(article(page, w.name(0)).get_by_role("link", name=w.name(0)))
        holds(page, lambda: f"/properties/{code}" in page.url, "the row opens the property")
        settled(page)
        tap(page.get_by_role("button", name=re.compile(r"^Dates")))
        dialog = page.get_by_role("dialog", name="Choose dates")
        tap(dialog.locator(f'[data-date="{day(14)}"]'))
        tap(dialog.locator(f'[data-date="{day(16)}"]'))
        gone(page, dialog, "two taps set the range")
        settled(page)
        property_url = page.url
        page.goto(app_url + "/properties/HRB-QUAY?" + search_query("harrowmere", day(10), day(12)))
        settled(page)
        tap(page.get_by_role("button", name="Show pictures"))
        gallery = page.get_by_role("dialog", name="Pictures")
        page.evaluate(RECORD_JS)
        swipe(page, gallery.get_by_role("img").first, -(SWIPE_PX + 10))
        attr(page, gallery, "data-index", "2", "a long swipe moves forward")
        assert not recorded(page, "gallery-slide"), "reduced motion jumps"
        page.keyboard.press("Escape")
        page.goto(property_url)
        settled(page)
        tap(price_region(page).get_by_role("button", name="Reserve"))
        holds(page, lambda: "/checkout/" in page.url, "the price bar reserves")
        settled(page)
        tap(price_region(page).get_by_role("button", name="Reserve"))
        shows(page, page.get_by_role("timer", name="Time left"), "hold placed")
        fill_guest(page, CARD_OK)
        tap(page.get_by_role("button", name="Pay"))
        bk = booking_code_from(page)
        settled(page)
        layout(page)
        b = page.request.get(f"{app_url}/api/bookings/{bk}").json()
    assert b["state"] == "confirmed" and (b["in"], b["out"]) == (day(14), day(16))


def test_wf_phone_journey_short_swipe(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec())[0]
    with browse(browser, app_url, "/properties/HRB-QUAY?" + search_query("harrowmere", day(10), day(12)), size="phone") as page:
        settled(page)
        tap(page.get_by_role("button", name="Show pictures"))
        gallery = page.get_by_role("dialog", name="Pictures")
        img = lambda i: gallery.get_by_role("img", name=sub(sub(PICTURE, "i", i), "n", 3))
        swipe(page, img(1), -(SWIPE_PX - 20))
        settle(gallery)
        attr(page, gallery, "data-index", "1", "a short drag snaps back")
        swipe(page, img(1), -(SWIPE_PX + 10))
        attr(page, gallery, "data-index", "2", "a long leftward drag moves forward")
        settle(gallery)
        swipe(page, img(2), SWIPE_PX + 10)
        attr(page, gallery, "data-index", "1", "a long rightward drag moves back")
        expect(gallery.get_by_role("img", name=sub(sub(PICTURE, "i", 1), "n", 3))).to_be_visible()
    r = Api(app_url).get("/images/<code>/<n>.svg".replace("<code>", "HRB-QUAY").replace("<n>", "1"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")


def test_wf_cancellation_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    tiers = [{"days_before": 2, "hour": 1, "refund_pct": 100}]
    code = w.add(w.spec(rooms=2, policy=tiers))[0]
    rt = f"{code}-DBL"
    g = w.user()
    arrive = day(2, dt.date.fromisoformat(DST_SPRING))
    out = day(2, dt.date.fromisoformat(arrive))
    client = Api(app_url).sign_in(g)
    b = book(client, code, arrive, out, [room(rt), room(rt)])
    d1 = deadline(arrive, tiers[0], w.zone)
    with browse(browser, app_url, f"/bookings/{b['code']}", user=g, zone=OTHER_ZONE) as page, \
         browse(browser, app_url, search_path(w, arrive, out)) as other:
        settled(page)
        region = page.get_by_role("region", name="Cancellation")
        assert region.locator("[data-deadline-utc]").first.get_attribute("data-deadline-utc") == iso_ms(d1)
        for text in (w.zone, hhmm(d1, w.zone), hhmm(d1, OTHER_ZONE), "your time"):
            expect(region).to_contain_text(text)
        settled(other)
        expect(other.get_by_text("NOTHING", exact=True)).to_be_visible()
        click(page.get_by_role("button", name=sub(CANCEL_ROOM, "n", 1)))
        dialog = page.get_by_role("dialog", name="Cancel this room?")
        contains(page, dialog, f"Refund: {money(page, b['rooms'][0]['paid_minor'])}", "the dialog shows the server's refund")
        click(dialog.get_by_role("button", name="Confirm cancellation"))
        shows(page, page.get_by_role("status", name="Toast"), "toast.cancelled", f"Cancelled. Refund: {money(page, b['rooms'][0]['paid_minor'])}")
        ledger = page.get_by_role("table", name="Ledger")
        attr(page, ledger, "data-balance-minor", "0", "the ledger balances")
        soon(other, lambda: expect(other.get_by_role("article")).to_have_count(1, timeout=SHORT_MS), "the room is back in search live")
    final, _ = get_booking(client, b["code"])
    assert [r["state"] for r in final["rooms"]] == ["cancelled", "confirmed"] and len(final["ledger"]) == 4 and final["balance_minor"] == 0


def test_wf_cancellation_live_status(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2, policy=[dict(FREE_TIER), dict(HALF_TIER)]))[0]
    g = w.user()
    bk = seed(api, bookings=[booking_body(code, day(10), day(12), guest=g)])["bookings"][0]["code"]
    with browse(browser, app_url, f"/bookings/{bk}", user=g) as page:
        page.clock.set_system_time(dt.datetime(2030, 1, 1, tzinfo=UTC))
        settled(page)
        status = page.get_by_role("status", name="Refund status")
        contains(page, status, "Free cancellation until ", "the server status is free")
        set_clock(api, iso_ms(deadline(day(10), FREE_TIER, w.zone)))
        contains(page, status, "50% refund until ", "the status updates live")
    assert get_booking(Api(app_url).sign_in(g), bk)[0]["cancellation"]["status"]["refund_pct"] == 50


def test_wf_change_dates_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.code()
    rt = f"{code}-DBL"
    w.add(w.spec(rooms=2), nights=[night(rt, day(20), stop_sell=True)])
    g = w.user()
    client = Api(app_url).sign_in(g)
    b = book(client, code, day(10), day(12), [room(rt)])
    new = price_stay(w, code, [room(rt)], day(14), day(17))["total"]
    with browse(browser, app_url, f"/bookings/{b['code']}", user=g) as page:
        settled(page)
        click(page.get_by_role("button", name="Change dates"))
        dialog = page.get_by_role("dialog", name="Change dates")
        shows(page, dialog, "dialog Change dates")
        arrow_to(page, day(20))
        page.keyboard.press("Enter")
        contains(page, page.get_by_role("status", name="Date help"), f"Not on sale on {when(page, day(20))}.", "the refused day reads its reason")
        arrow_to(page, day(14))
        page.keyboard.press("Enter")
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        for text in (f"New total: {money(page, new)}", f"Already paid: {money(page, b['total_minor'])}", f"You pay: {money(page, new - b['total_minor'])}"):
            contains(page, dialog, text, "the dialog shows the server's figures")
        fill_guest(page, CARD_OK, dialog)
        click(dialog.get_by_role("button", name="Pay"))
        shows(page, page.get_by_role("status", name="Toast"), "toast.changed", "Dates changed.")
    after, _ = get_booking(client, b["code"])
    assert (after["in"], after["out"], after["state"]) == (day(14), day(17), "changed")
    pair = [e for e in after["ledger"] if e["kind"] == "change"]
    assert len(pair) == 2 and next(e for e in pair if e["account"] == "guest")["debit_minor"] == new - b["total_minor"]


def test_wf_change_dates_refund(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2, policy=[dict(FREE_TIER), dict(HALF_TIER)]))[0]
    rt = f"{code}-DBL"
    g = w.user()
    client = Api(app_url).sign_in(g)
    b = book(client, code, day(10), day(13), [room(rt)])
    set_clock(api, iso_ms(deadline(day(10), FREE_TIER, w.zone)))
    refund = rnd((b["paid_minor"] - price_stay(w, code, [room(rt)], day(10), day(11), today=dt.date.fromisoformat(day(7)))["total"]) * HALF_TIER["refund_pct"], 100)
    with browse(browser, app_url, f"/bookings/{b['code']}", user=g) as page:
        settled(page)
        click(page.get_by_role("button", name="Change dates"))
        dialog = page.get_by_role("dialog", name="Change dates")
        shows(page, dialog, "dialog Change dates")
        arrow_to(page, day(10))
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        contains(page, dialog, f"Refund: {money(page, refund)}", "refund.amount under the tier in force")
        click(dialog.get_by_role("button", name="Confirm change"))
        shows(page, page.get_by_role("status", name="Toast"), "toast.changed", "Dates changed.")
    after, _ = get_booking(client, b["code"])
    pair = [e for e in after["ledger"] if e["kind"] == "change"]
    assert next(e for e in pair if e["account"] == "guest")["credit_minor"] == refund and after["balance_minor"] == 0


def test_wf_reviews_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    g, op = w.user(), w.user("operator")
    bk = seed(api, bookings=[booking_body(code, day(1), day(2), guest=g)])["bookings"][0]
    query = search_query(w.dest, day(10), day(12))
    before = next(r for r in api.get("/api/search?" + query).json()["results"] if r["code"] == code)
    with browse(browser, app_url, bk["review_link"], user=g) as page:
        settled(page)
        shows(page, page.get_by_text("You can review after your stay ends.", exact=True), "review.early")
        set_clock(api, iso_ms(completion(day(2), w.zone)))
        shows(page, page.get_by_role("spinbutton", name="Cleanliness"), "the form appears live")
        page.goto(app_url + "/inbox")
        link = page.get_by_role("region", name="Inbox").get_by_role("link", name=f"Review your stay at {w.name()}")
        shows(page, link, "the inbox message")
        click(link)
        holds(page, lambda: urlparse(page.url).path == bk["review_link"], "the inbox link opens the review")
        for label in ("Cleanliness", "Comfort", "Location", "Staff", "Value"):
            fill(page.get_by_role("spinbutton", name=label), "10")
        fill(page.get_by_role("textbox", name="Comment"), COMMENT)
        click(page.get_by_role("button", name="Send review"))
        shows(page, page.get_by_role("status", name="Toast"), "toast.review_sent", "Thanks. Your review is waiting for moderation.")
    with browse(browser, app_url, "/moderation", user=op) as page:
        settled(page)
        item = page.get_by_role("article").filter(has_text=w.name())
        click(item.get_by_role("button", name=re.compile(r"^Publish review ")))
        shows(page, page.get_by_role("status", name="Toast"), "toast.published", "Review published.")
    after = next(r for r in api.get("/api/search?" + query).json()["results"] if r["code"] == code)
    assert round(after["score"] * 10) == 100 and after["rank"] == before["rank"] + 3 * (100 - NO_REVIEW_SCORE10)


def test_wf_reviews_closed(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    g = w.user()
    bk = seed(api, bookings=[booking_body(code, day(1), day(2), guest=g)])["bookings"][0]
    done = completion(day(2), w.zone)
    set_clock(api, iso_ms(done))
    with browse(browser, app_url, bk["review_link"], user=g) as page:
        settled(page)
        shows(page, page.get_by_role("spinbutton", name="Cleanliness"), "the window is open")
        set_clock(api, iso_ms(done + dt.timedelta(milliseconds=REVIEW_WINDOW_MS)))
        shows(page, page.get_by_text("This review window has closed.", exact=True), "review.closed live")
    assert api.get("/api" + bk["review_link"]).status_code == 410


def calendar_go(page: Page, target: str) -> None:
    grid = page.get_by_role("grid", name="Rates and availability")
    tab_to(page, grid, "grid Rates and availability")
    current = dt.date.fromisoformat(active_date(page))
    steps = (dt.date.fromisoformat(target) - current).days
    for _ in range(abs(steps)):
        page.keyboard.press("ArrowRight" if steps > 0 else "ArrowLeft")
    holds(page, lambda: active_date(page) == target, f"arrow keys reach {target}")


def test_wf_manager_calendar_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = w.user("manager", manages=(code,))
    monday = next(d for d in (day(i) for i in range(14, 21)) if dt.date.fromisoformat(d).isoweekday() == 1)
    m0 = dt.date.fromisoformat(monday)
    with browse(browser, app_url, f"/manage/{code}/calendar", user=mgr) as page, \
         browse(browser, app_url, prop_path(w, code, day(6, m0), day(9, m0))) as traveller:
        settled(page)
        calendar_go(page, monday)
        for _ in range(4):
            page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Edit nights")
        shows(page, dialog, "Enter opens Edit nights")
        weekdays = dialog.get_by_role("group", name="Weekdays").get_by_role("checkbox")
        assert weekdays.count() == 7 and all(c.is_checked() for c in weekdays.all())
        fill(dialog.get_by_role("spinbutton", name="Rate"), "130")
        fill(dialog.get_by_role("textbox", name="Season name"), "Spring")
        click(dialog.get_by_role("button", name="Apply"))
        shows(page, page.get_by_role("status", name="Toast"), "toast.nights_saved", "Nights updated.")
        calendar_go(page, day(3, m0))
        for _ in range(3):
            page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Enter")
        fill(dialog.get_by_role("spinbutton", name="Rate"), "150")
        fill(dialog.get_by_role("textbox", name="Season name"), "Summer")
        click(dialog.get_by_role("button", name="Apply"))
        problems = dialog.get_by_role("region", name="Problems")
        shows(page, problems.get_by_role("link", name=f"Season name: Season Summer overlaps Spring from {when(page, day(3, m0))} to {when(page, day(4, m0))}."), "season.overlap")
        click(dialog.get_by_role("button", name=sub(REPLACE_BTN, "season", "Spring")))
        shows(page, page.get_by_role("status", name="Toast"), "toast.nights_saved", "Nights updated.")
        settled(traveller)
        calendar_go(page, day(7, m0))
        page.keyboard.press("Enter")
        check = dialog.get_by_role("checkbox", name="Stop sell")
        click(check)
        click(dialog.get_by_role("button", name="Apply"))
        shows(page, page.get_by_role("status", name="Toast"), "toast.nights_saved", "Nights updated.")
        closed = traveller.get_by_role("group", name="Night Strip").locator(f'[data-date="{day(7, m0)}"]')
        attr(traveller, closed, "data-state", "closed", "the traveller sees the night closed live")
    cells = {c["date"]: c for c in Api(app_url).sign_in(mgr).get(f"/api/manage/{code}/calendar", params={"from": monday, "days": 28}).json()["cells"] if c["room_type"] == rt}
    assert [cells[day(i, m0)]["rate_minor"] for i in range(7)] == [13000, 13000, 13000, 15000, 15000, 15000, 15000]
    assert cells[day(7, m0)]["stop_sell"] is True


def test_wf_manager_calendar_validation(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = w.user("manager", manages=(code,))
    with browse(browser, app_url, f"/manage/{code}/calendar", user=mgr) as page:
        settled(page)
        calendar_go(page, day(5))
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Edit nights")
        fill(dialog.get_by_role("spinbutton", name="Minimum stay"), "5")
        fill(dialog.get_by_role("spinbutton", name="Maximum stay"), "2")
        click(dialog.get_by_role("button", name="Apply"))
        link = dialog.get_by_role("region", name="Problems").get_by_role("link", name=f"{MAX_LABEL}: {MAX_BELOW_MIN}")
        shows(page, link, "edit.max_below_min under Maximum stay")
        click(link)
        focused(page, dialog.get_by_role("spinbutton", name="Maximum stay"), "the link focuses its field")
        page.keyboard.press("Escape")
        gone(page, dialog, "Escape closes Edit nights")
        holds(page, lambda: active_date(page) == day(5), "focus returns to the same cell")
    cell = next(c for c in Api(app_url).sign_in(mgr).get(f"/api/manage/{code}/calendar", params={"from": day(5), "days": 28}).json()["cells"] if c["room_type"] == rt and c["date"] == day(5))
    assert (cell["min_stay"], cell["max_stay"]) == (1, 30)


def test_wf_two_tabs_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=3))[0]
    u = w.user(completed=((code, CHECKOUT_EXAMPLE),))
    seed(api, bookings=[booking_body(code, day(0), day(1), guest=u)])
    with browse(browser, app_url, search_path(w, day(10), day(12)), user=u) as one:
        two = one.context.new_page()
        two.goto(app_url + "/account")
        settled(one)
        settled(two)
        select(one.get_by_role("combobox", name=LANGUAGE_BOX), "Deutsch")
        shows(two, two.get_by_role("region", name="Treue"), "the other tab follows the language")
        select(one.get_by_role("combobox", name="Währung"), "JPY")
        holds(two, lambda: shown_value(two.get_by_role("combobox", name="Währung")) == "JPY", "the other tab follows the currency")
        done = completion(day(1), w.zone)
        set_clock(api, iso_ms(done - dt.timedelta(minutes=1)))
        advance_clock(api, 120000)
        contains(two, two.get_by_role("region", name="Treue"), "Heron: 2 abgeschlossene Aufenthalte", "the tier updates live")
        click(two.get_by_role("button", name="Überall abmelden"))
        holds(one, lambda: urlparse(one.url).path == "/signin", "the other tab moves to /signin")
        toast = one.get_by_role("status", name=re.compile(r"^(Toast|Mitteilung)$"))
        holds(one, lambda: toast.inner_text().strip() in ("You were signed out.", "Sie wurden abgemeldet."), "signed.out toast")
        assert one.request.get(f"{app_url}/api/me").json()["user"] is None


def test_wf_two_tabs_new_quote_tier(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=3))[0]
    u = w.user(completed=((code, CHECKOUT_EXAMPLE),))
    seed(api, bookings=[booking_body(code, day(0), day(1), guest=u)])
    done = completion(day(1), w.zone)
    set_clock(api, iso_ms(done - dt.timedelta(minutes=1)))
    path = prop_path(w, code, day(10), day(12))
    with browse(browser, app_url, path, user=u) as page:
        q1 = to_checkout(page)
        advance_clock(api, 120000)
        assert poll(lambda: page.request.get(f"{app_url}/api/me").json()["tier"] == "Heron", "GET /api/me reports Heron")
        assert page.request.get(f"{app_url}/api/quotes/{q1}").json()["tier"] == "Wren"
        page.goto(app_url + path)
        q2 = to_checkout(page)
        assert page.request.get(f"{app_url}/api/quotes/{q2}").json()["tier"] == "Heron"


def test_wf_rate_import_happy(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = w.user("manager", manages=(code,))
    bad, _ = bad_rate_file(rt)
    good = good_rate_file(rt)
    with browse(browser, app_url, f"/manage/{code}/import", user=mgr) as page:
        settled(page)
        page.get_by_label("Rate file").set_input_files({"name": "rates.kiprates", "mimeType": "text/plain", "buffer": bad})
        click(page.get_by_role("button", name="Preview"))
        errors = page.get_by_role("list", name="Import errors")
        shows(page, errors, "list Import errors")
        for text in ("Line 2: expected 8 fields, found 3.", "Line 3: unknown room NOPE.", "Line 7: bad weekdays MTWXFSS.",
                     "Line 8: rate must be a whole number above 0.", "Line 9: bad stay limits 3|2.", "Line 13: overlaps line 12."):
            expect(errors).to_contain_text(text)
        expect(page.get_by_role("button", name="Apply")).to_be_disabled()
        page.get_by_label("Rate file").set_input_files({"name": "rates.kiprates", "mimeType": "text/plain", "buffer": good})
        click(page.get_by_role("button", name="Preview"))
        shows(page, page.get_by_role("table", name="Import preview"), "table Import preview")
        expect(page.locator("body")).to_contain_text(f"{len(good_changes(rt))} nights will change.")
        click(page.get_by_role("button", name="Apply"))
        shows(page, page.get_by_role("status", name="Toast"), "toast.imported", "Rates imported.")
    assert S3().get(f"imports/{code}/{hashlib.sha256(good).hexdigest()}.kiprates") == good


def test_wf_rate_import_preview_rows_by_keyboard(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = w.user("manager", manages=(code,))
    good = good_rate_file(rt)
    with browse(browser, app_url, f"/manage/{code}/import", user=mgr) as page:
        settled(page)
        page.get_by_label("Rate file").set_input_files({"name": "rates.kiprates", "mimeType": "text/plain", "buffer": good})
        preview = page.get_by_role("button", name="Preview")
        preview.focus()
        page.keyboard.press("Enter")
        table = page.get_by_role("table", name="Import preview")
        shows(page, table, "table Import preview")
        for room_code, date, old, new in good_changes(rt):
            expect(table).to_contain_text(f"{room_code} {date} {money(page, old)} to {money(page, new)}")
        apply_button = page.get_by_role("button", name="Apply")
        apply_button.focus()
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("status", name="Toast"), "toast.imported", "Rates imported.")
        page.goto(f"{app_url}/manage/{code}/calendar")
        settled(page)
        click(page.get_by_role("button", name="Later dates"))
        settled(page)
        target = good_changes(rt)[0]
        cell = page.locator(f'[data-date="{target[1]}"][data-room-type="{rt}"]')
        attr(page, cell, "data-rate-minor", str(target[3]), "the calendar shows the applied rate")


def test_wf_rate_import_header_error_german(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    mgr = w.user("manager", manages=(code,))
    with browse(browser, app_url, f"/manage/{code}/import?lang=de", user=mgr) as page:
        settled(page)
        page.get_by_label("Tarifdatei").set_input_files({"name": "rates.kiprates", "mimeType": "text/plain", "buffer": b"KIPRATES 9\n"})
        click(page.get_by_role("button", name="Vorschau"))
        errors = page.get_by_role("list", name="Importfehler")
        shows(page, errors, "the German error list")
        expect(errors).to_contain_text("Zeile 1: Diese Datei muss mit KIPRATES 1 beginnen.")
        expect(page.get_by_role("button", name="Übernehmen")).to_be_disabled()


def test_wf_rate_import_outage(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    mgr = w.user("manager", manages=(code,))
    good = good_rate_file(rt)
    key = f"imports/{code}/{hashlib.sha256(good).hexdigest()}.kiprates"
    with browse(browser, app_url, f"/manage/{code}/import", user=mgr) as page:
        settled(page)
        page.get_by_label("Rate file").set_input_files({"name": "rates.kiprates", "mimeType": "text/plain", "buffer": good})
        click(page.get_by_role("button", name="Preview"))
        shows(page, page.get_by_role("table", name="Import preview"), "preview")
        try:
            api.post("/api/grading/storage", {"down": True})
            click(page.get_by_role("button", name="Apply"))
            shows(page, page.get_by_role("alert"), "storage.import band", "Storage is unavailable. Your file was not saved. Try again.")
            expect(page.get_by_role("table", name="Import preview")).to_be_visible()
            cell = next(c for c in Api(app_url).sign_in(mgr).get(f"/api/manage/{code}/calendar", params={"from": day(30), "days": 28}).json()["cells"] if c["date"] == day(30) and c["room_type"] == rt)
            assert cell["rate_minor"] == BASE_RATE and key not in S3().keys(f"imports/{code}/")
        finally:
            api.post("/api/grading/storage", {"down": False})
        click(page.get_by_role("button", name="Apply"))
        shows(page, page.get_by_role("status", name="Toast"), "the retry succeeds", "Rates imported.")
    assert S3().get(key) == good


def test_wf_documents_export(browser, app_url):
    api = fresh(app_url)
    x = export_world(api, app_url)
    set_clock(api, "2027-04-01T12:00:00.000Z")
    mgr = x["w"].user("manager", manages=(x["code"],))
    with browse(browser, app_url, f"/manage/{x['code']}/reservations", user=mgr) as page:
        settled(page)
        expect(page.get_by_role("table", name="Reservations")).to_contain_text(FORMULA_SURNAME)
        with page.expect_download() as dl:
            click(page.get_by_role("link", name="Export CSV"))
        assert Path(dl.value.path()).read_text() == x["reservations"]
        page.goto(f"{app_url}/manage/{x['code']}/statements")
        settled(page)
        select(page.get_by_role("combobox", name="Month"), when(page, TODAY.isoformat(), "monthyear"))
        settled(page)
        expect(page.get_by_role("table", name="Statement")).to_contain_text("Total")
        with page.expect_download() as dl:
            click(page.get_by_role("link", name="Download statement"))
        body = Path(dl.value.path()).read_bytes()
    assert body.decode() == x["statement"] and S3().get(f"statements/{x['code']}/{x['month']}.csv") == body


def test_wf_documents_access(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    a, b = w.user(), w.user()
    other = World(api)
    ocode = other.add(other.spec())[0]
    omgr = other.user("manager", manages=(ocode,))
    bk = seed(api, bookings=[booking_body(code, day(10), day(12), guest=a)])["bookings"][0]["code"]
    with browse(browser, app_url, "/", user=b) as page:
        r = page.goto(f"{app_url}/bookings/{bk}")
        assert r.status == 404
        expect(page.get_by_text("NOTHING", exact=True)).to_be_visible()
        expect(page.get_by_text("We couldn't find that page.", exact=True)).to_be_visible()
        page.goto(f"{app_url}/moderation")
        shows(page, page.get_by_text("You don't have access to this page.", exact=True), "page.forbidden")
    with browse(browser, app_url, f"/manage/{code}/calendar", user=omgr) as page:
        shows(page, page.get_by_text("We couldn't find that page.", exact=True), "another manager gets not found")
    assert Api(app_url).sign_in(b).get(f"/api/bookings/{bk}").status_code == 404


def test_wf_keyboard_picker_escape_keeps_range(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(rooms=2))
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        dates = page.get_by_role("button", name=re.compile(r"^Dates"))
        before = dates.get_attribute("aria-label") or dates.inner_text()
        url = page.url
        dates.focus()
        page.keyboard.press("Enter")
        settled(page)
        dialog = page.get_by_role("dialog", name="Choose dates")
        shows(page, dialog, "Enter opens the picker")
        holds(page, lambda: active_date(page) == day(10), "focus starts on the chosen arrival")
        page.keyboard.press("ArrowRight")
        holds(page, lambda: active_date(page) == day(11), "ArrowRight moves one day")
        page.keyboard.press("Escape")
        gone(page, dialog, "Escape closes the picker")
        focused(page, dates, "focus returns to Dates")
        assert (dates.get_attribute("aria-label") or dates.inner_text()) == before and page.url == url


def test_wf_keyboard_picker_keeps_tab_inside(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(rooms=2))
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        dates = page.get_by_role("button", name=re.compile(r"^Dates"))
        dates.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Choose dates")
        shows(page, dialog, "button Dates opens dialog Choose dates")
        settled(page)
        trapped(page, dialog, "dialog Choose dates")


def test_wf_keyboard_results_labels(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(rooms=2, stars=5))
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        focused(page, page.get_by_role("heading", name="Results"), "a deep link focuses Results")
        shows(page, page.get_by_role("status", name="Search announcements"), "count.found", "1 property found")
        r = api.get("/api/search?" + search_query(w.dest, day(10), day(12))).json()["results"][0]
        label = f"{w.name()}, 5 stars, score {num1(page, r['score'])}, {num1(page, r['distance_km'])} kilometres, total {money(page, r['display_minor'])}"
        row = page.get_by_role("article", name=label)
        shows(page, row, "the result row label")
        show = row.get_by_role("button", name=f"Show {w.name()} on the map")
        show.focus()
        page.keyboard.press("Enter")
        attr(page, row, "aria-current", "true", "the row is selected")
        pin = page.get_by_role("region", name="Map").get_by_role("button", name=re.compile("^" + re.escape(w.name()) + ", score"))
        attr(page, pin, "aria-pressed", "true", "the pin is selected")
        holds(page, lambda: ("sel", w.code()) in query_pairs(page.url), "sel enters the URL")


def test_wf_arabic_plurals_and_day_label(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(0, rooms=2), w.spec(1, rooms=2), w.spec(2, rooms=2))
    single = World(api)
    single.add(single.spec(rooms=2))
    with browse(browser, app_url, search_path(w, day(10), day(12), lang="ar")) as page:
        settled(page)
        shows(page, page.get_by_role("status", name="إعلانات البحث"), "count.found few form", "3 أماكن إقامة")
        page.goto(app_url + search_path(single, day(10), day(12), lang="ar"))
        settled(page)
        shows(page, page.get_by_role("status", name="إعلانات البحث"), "count.found one form", "مكان إقامة واحد")
        click(page.get_by_role("button", name=re.compile(r"^التواريخ")))
        dialog = page.get_by_role("dialog", name="اختر التواريخ")
        shows(page, dialog, "Arabic date picker")
        label = f"{when(page, day(11), lang='ar', zone=single.zone)}، متاح، من {BASE_RATE // 100} يورو، الحد الأدنى للإقامة ليلة واحدة"
        named(page, dialog.locator(f'[data-date="{day(11)}"]'), label, "day.available in Arabic")


def test_wf_arabic_night_strip_mirrored(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(13), lang="ar", cur="KWD")) as page:
        settled(page)
        nights = page.get_by_role("group", name="Night Strip").locator("[data-date]")
        soon(page, lambda: expect(nights).to_have_count(3, timeout=SHORT_MS), "one column per night")
        assert nights.nth(1).bounding_box()["x"] < nights.nth(0).bounding_box()["x"], "the strip runs right to left"
        nights.nth(0).focus()
        page.keyboard.press("ArrowLeft")
        focused(page, nights.nth(1), "ArrowLeft moves to the next night in Arabic")
        page.keyboard.press("ArrowRight")
        focused(page, nights.nth(0), "ArrowRight moves back in Arabic")
        split = [minors(n)[0] for n in nights.all()]
        assert sum(split) in minors(price_region(page, "السعر والحجز")), "the nights add up to the total"
        assert {n.locator("[data-minor]").first.get_attribute("data-currency") for n in nights.all()} == {"KWD"}


def test_wf_arabic_switch_keeps_checkout(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(12))) as page:
        to_checkout(page)
        place_hold(page)
        fill(page.get_by_role("textbox", name="Given name"), GIVEN)
        page.evaluate("() => { window.__kipStay = true; }")
        select(page.get_by_role("combobox", name=LANGUAGE_BOX), "العربية")
        box = page.get_by_role("textbox", name="الاسم الأول")
        shows(page, box, "the field is named in Arabic")
        assert box.input_value() == GIVEN, "the typed value stays"
        assert page.evaluate("() => window.__kipStay === true"), "the language change must not reload"
        shows(page, page.get_by_role("timer", name="الوقت المتبقي"), "the hold stays")
        holds(page, lambda: ("lang", "ar") in query_pairs(page.url), "lang enters the URL")
        page.clock.fast_forward(HOLD_MS - 300000)
        shows(page, page.get_by_role("status", name="إعلانات الحجز المؤقت"), "hold.minutes at 5 minutes", "يبقى حجز غرفتك 5 دقائق")
        page.clock.fast_forward(180000)
        shows(page, page.get_by_role("status", name="إعلانات الحجز المؤقت"), "hold.minutes dual form", "يبقى حجز غرفتك دقيقتان")


def stars_box(page: Page, stars: int, count: int) -> Locator:
    return page.get_by_role("checkbox", name=f"{stars} stars ({count})")


def pool_box(page: Page, count: int) -> Locator:
    return page.get_by_role("checkbox", name=f"Pool ({count})")


def test_wf_history_counts_restore(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(0, rooms=2), w.spec(1, rooms=2), w.spec(2, rooms=2, stars=5, amenities=["wifi", "pool"]))
    bars = lambda p: sum(int(b.get_attribute("data-count")) for b in p.locator("[data-from]").all())
    with browse(browser, app_url, search_path(w, day(10), day(12))) as page:
        settled(page)
        four = stars_box(page, 4, 2)
        five = stars_box(page, 5, 1)
        shows(page, four, "4 stars counts 2")
        pool = pool_box(page, 1)
        shows(page, pool, "Pool counts 1")
        click(four)
        holds(page, lambda: ("stars", "4") in query_pairs(page.url), "stars in the URL")
        settled(page)
        shows(page, five, "another option in the group keeps its count")
        shows(page, stars_box(page, 4, 2), "the selected option keeps its count")
        shows(page, pool_box(page, 0), "another group's count follows the selection")
        soon(page, lambda: expect(page.get_by_role("article")).to_have_count(2, timeout=SHORT_MS), "two rows")
        assert bars(page) == 2, "the histogram follows the stars filter"
        page.go_back()
        holds(page, lambda: "stars" not in {k for k, _ in query_pairs(page.url)}, "back leaves the filter")
        settled(page)
        soon(page, lambda: expect(page.get_by_role("article")).to_have_count(3, timeout=SHORT_MS), "three rows again")
        expect(stars_box(page, 4, 2)).not_to_be_checked()
        shows(page, pool_box(page, 1), "Pool counts 1 again")
        assert bars(page) == 3, "the histogram is restored"


def worked_page(page: Page) -> None:
    settled(page)
    click(page.get_by_role("checkbox", name=sub(BREAKFAST_FOR, "n", 1)))
    settled(page)


def test_wf_quote_jpy_display_switch(browser, app_url):
    api = fresh(app_url)
    w, code, rt, user, din, dout, rooms = worked_world(api)
    with browse(browser, app_url, prop_path(w, code, din, dout, adults=3, ages=(7, 1), cur="JPY"), user=user) as page:
        worked_page(page)
        total, split = WORKED_CONVERTED["JPY"]
        nights = page.get_by_role("group", name="Night Strip").locator("[data-date]")
        holds(page, lambda: [minors(n)[0] for n in nights.all()] == list(split), "Night Strip shows the JPY split")
        holds(page, lambda: total in minors(price_region(page)), "the bar shows the JPY total")
        taxable = [n["t"] for n in price_stay(w, code, rooms, din, dout, HERON_PCT)["nights"]]
        net = convert(taxable, START_TABLE["JPY"], "JPY")[0]
        click(page.get_by_role("switch", name="Include taxes"))
        holds(page, lambda: ("tax", "0") in query_pairs(page.url), "tax=0 in the URL")
        holds(page, lambda: net in minors(price_region(page)), "without taxes the bar shows the converted sum of t")
        click(page.get_by_role("radio", name="Per night"))
        holds(page, lambda: ("display", "night") in query_pairs(page.url), "display=night in the URL")
        holds(page, lambda: rnd(net, len(split)) in minors(price_region(page)), "per night is round(total / nights)")


def test_wf_quote_worked_lines_by_keyboard(browser, app_url):
    api = fresh(app_url)
    w, code, rt, user, din, dout, rooms = worked_world(api)
    with browse(browser, app_url, prop_path(w, code, din, dout, adults=3, ages=(7, 1)), user=user) as page:
        worked_page(page)
        nights = page.get_by_role("group", name="Night Strip").locator("[data-date]")
        soon(page, lambda: expect(nights).to_have_count(3, timeout=SHORT_MS), "one column per night")
        nights.nth(0).focus()
        page.keyboard.press("ArrowRight")
        focused(page, nights.nth(1), "ArrowRight moves to the second night")
        page.keyboard.press("Enter")
        items = page.get_by_role("list", name="Price lines").get_by_role("listitem")
        want = list(price_stay(w, code, rooms, din, dout, HERON_PCT)["nights"][1]["lines"].items())
        soon(page, lambda: expect(items).to_have_count(len(want), timeout=SHORT_MS), "one item per non-zero line")
        for i, (k, v) in enumerate(want):
            assert int(items.nth(i).get_attribute("data-minor")) == v, (k, v)
            named(page, items.nth(i), f"{LABELS[k]}: {money(page, v)}", "price line name")
        assert want[-1] == ("night_total", WORKED_NIGHTS[1])


PAY_FIELDS = (("Given name", "Enter your given name."), ("Surname", "Enter your surname."), ("Card number", "Enter a card number."),
              ("Expiry", "Enter a date as MM/YY."), ("Security code", "Enter a 3-digit code."))


def problem_link(problems: Locator, field: str) -> Locator:
    return problems.get_by_role("link", name=f"{field}: {dict(PAY_FIELDS)[field]}")


def test_wf_checkout_problems_and_step_up(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(12))) as page:
        to_checkout(page)
        place_hold(page)
        click(page.get_by_role("button", name="Pay"))
        problems = page.get_by_role("region", name="Problems")
        shows(page, problems, "Pay lists the problems")
        holds(page, lambda: problems.evaluate("e => e.contains(document.activeElement)"), "Problems takes focus")
        expect(problems.get_by_role("heading")).to_have_text(f"There are {len(PAY_FIELDS)} problems")
        link = problem_link(problems, "Surname")
        link.focus()
        page.keyboard.press("Enter")
        focused(page, page.get_by_role("textbox", name="Surname"), "the link focuses its field")
        fill_guest(page, CARD_STEP_UP)
        click(page.get_by_role("button", name="Pay"))
        dialog = page.get_by_role("dialog", name="Confirm your payment")
        shows(page, dialog, "a step-up card opens the dialog")
        box = dialog.get_by_role("textbox", name="Code")
        focused(page, box, "focus lands in Code")
        fill(box, "0000")
        click(dialog.get_by_role("button", name="Confirm"))
        contains(page, dialog, "That code is wrong.", "card.wrong_code keeps the dialog")
        fill(box, STEP_UP_CODE)
        click(dialog.get_by_role("button", name="Confirm"))
        shows(page, page.get_by_role("heading", name=f"Booking {booking_code_from(page)}"), "the booking page")


def test_wf_phone_tap_range_updates_bar(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    rt = f"{code}-DBL"
    want = price_stay(w, code, [room(rt)], day(14), day(17))
    with browse(browser, app_url, prop_path(w, code, day(10), day(12)), size="narrow") as page:
        settled(page)
        tap(page.get_by_role("button", name=re.compile(r"^Dates")))
        dialog = page.get_by_role("dialog", name="Choose dates")
        shows(page, dialog, "Dates opens the picker")
        tap(dialog.locator(f'[data-date="{day(14)}"]'))
        tap(dialog.locator(f'[data-date="{day(17)}"]'))
        gone(page, dialog, "two taps set the range")
        settled(page)
        nights = page.get_by_role("group", name="Night Strip").locator("[data-date]")
        soon(page, lambda: expect(nights).to_have_count(3, timeout=SHORT_MS), "three nights")
        holds(page, lambda: want["total"] in minors(price_region(page)), "the fixed bar shows the new total")
        assert {("in", day(14)), ("out", day(17))} <= set(query_pairs(page.url))
        layout(page)


def test_wf_phone_map_sheet_keeps_selection(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(0, rooms=2), w.spec(1, rooms=2, x=600.0))
    pin = lambda sheet: sheet.get_by_role("button", name=re.compile("^" + re.escape(w.name(0)) + ", score"))
    with browse(browser, app_url, search_path(w, day(10), day(12)), size="phone") as page:
        settled(page)
        opener = page.get_by_role("button", name="Map", exact=True)
        tap(opener)
        sheet = page.get_by_role("dialog", name="Map")
        shows(page, sheet, "Map opens as a sheet")
        settle(sheet)
        tap(pin(sheet))
        gone(page, sheet, "a pin closes the sheet")
        holds(page, lambda: ("sel", w.code(0)) in query_pairs(page.url), "sel enters the URL")
        attr(page, article(page, w.name(0)), "aria-current", "true", "the row is selected")
        tap(opener)
        shows(page, sheet, "Map reopens")
        settle(sheet)
        attr(page, pin(sheet), "aria-pressed", "true", "the pin stays pressed")
        page.keyboard.press("Escape")
        gone(page, sheet, "Escape closes the sheet")
        page.go_back()
        holds(page, lambda: "sel" not in {k for k, _ in query_pairs(page.url)}, "back removes the selection")
        settled(page)
        holds(page, lambda: article(page, w.name(0)).get_attribute("aria-current") != "true", "the row is no longer selected")


def test_wf_phone_problems_at_320(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(12)), size="narrow") as page:
        to_checkout(page)
        place_hold(page)
        pay = page.get_by_role("button", name="Pay")
        b = pay.bounding_box()
        assert b["width"] >= TAP_MIN_PX and b["height"] >= TAP_MIN_PX, b
        tap(pay)
        problems = page.get_by_role("region", name="Problems")
        shows(page, problems, "Pay lists the problems")
        layout(page)
        tap(problem_link(problems, "Card number"))
        focused(page, page.get_by_role("textbox", name="Card number"), "the link focuses its field")


def test_forced_colours_selected_day(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=2))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(13))) as page:
        settled(page)
        page.emulate_media(forced_colors="active")
        click(page.get_by_role("button", name=re.compile(r"^Dates")))
        dialog = page.get_by_role("dialog", name="Choose dates")
        shows(page, dialog, "Dates opens the picker")
        cell = dialog.get_by_role("gridcell").filter(has=page.locator(f'[data-date="{day(11)}"]'))
        attr(page, cell, "aria-selected", "true", "a day inside the range is selected")
        settle(dialog)
        got = cell.evaluate("""c => {
          const probe = document.createElement('div');
          probe.style.cssText = 'background-color: Highlight; color: HighlightText';
          document.body.append(probe);
          const want = getComputedStyle(probe);
          const system = [want.backgroundColor, want.color];
          probe.remove();
          const day = c.querySelector('[data-date]');
          const seen = [c, day].map(e => getComputedStyle(e));
          return {system, fill: seen.map(s => s.backgroundColor), ink: getComputedStyle(day).color};
        }""")
        assert got["system"][0] in got["fill"] and got["ink"] == got["system"][1], got


def test_sheets_keep_tab_inside(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    w.add(w.spec(rooms=2))
    with browse(browser, app_url, search_path(w, day(10), day(12)), size="phone") as page:
        settled(page)
        for label in ("Filters", "Map"):
            opener = page.get_by_role("button", name=label, exact=True)
            opener.focus()
            page.keyboard.press("Enter")
            sheet = page.get_by_role("dialog", name=label)
            shows(page, sheet, f"{label} opens as a sheet")
            settle(sheet)
            trapped(page, sheet, f"dialog {label}")
            page.keyboard.press("Escape")
            gone(page, sheet, f"Escape closes the {label} sheet")
            focused(page, opener, f"focus returns to {label}")


def test_price_dialog_holds_focus(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    rt = f"{code}-DBL"
    mgr = Api(app_url).sign_in(w.user("manager", manages=(code,)))
    with browse(browser, app_url, prop_path(w, code, day(10), day(12))) as page:
        to_checkout(page)
        place_hold(page)
        assert edit_nights(mgr, code, [rt], day(10), day(10), rate_minor=BASE_RATE + 3000).status_code == 200
        dialog = page.get_by_role("alertdialog", name="The price changed")
        shows(page, dialog, "the rate edit raises the dialog")
        trapped(page, dialog, "alertdialog The price changed")
        page.keyboard.press("Escape")
        expect(dialog).to_be_visible()
        accept = dialog.get_by_role("button", name="Accept new price")
        accept.focus()
        page.keyboard.press("Enter")
        gone(page, dialog, "Accept closes the dialog")
        focused(page, page.get_by_role("button", name="Pay"), "focus moves to Pay")


def test_clock_event_corrects_open_timer(browser, app_url):
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec(rooms=1))[0]
    with browse(browser, app_url, prop_path(w, code, day(10), day(12))) as page:
        to_checkout(page)
        place_hold(page)
        timer = page.get_by_role("timer", name="Time left")
        page.evaluate("() => { window.__kipStay = true; }")
        moved = 300000
        advance_clock(api, HOLD_MS - moved)
        holds(page, lambda: parse_timer(timer.inner_text()) <= moved // 1000, "the timer follows the clock event")
        shows(page, page.get_by_role("status", name="Hold announcements"), "hold.minutes threshold", "Your room is held for 5 more minutes")
        assert page.evaluate("() => window.__kipStay === true"), "a clock event must not reload the page"


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for p in shipped_packages():
        assert p.name in notices, f"{p.name} missing from THIRD_PARTY_NOTICES.md"
    for font in ("Chivo", "IBM Plex Sans Arabic"):
        assert font in notices, font


def test_if_licences_allowed():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, bad
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_services_only(browser, app_url):
    names = {p.name for p in shipped_packages()}
    assert not names & set(FORBIDDEN_PACKAGES), names & set(FORBIDDEN_PACKAGES)
    api = fresh(app_url)
    w = World(api)
    code = w.add(w.spec())[0]
    with browse(browser, app_url, "/") as page:
        seen: list[str] = []
        page.on("request", lambda req: seen.append(req.url))
        for path in ("/", search_path(w, day(10), day(12)), prop_path(w, code, day(10), day(12))):
            page.goto(app_url + path)
            settled(page)
        outside = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert not outside, outside


def test_if_service_config_untouched():
    assert Postgres().tables(), "the provided database holds the app's tables"
    keys = set(S3().keys("images/HRB-QUAY/"))
    assert {f"images/HRB-QUAY/{n}.svg" for n in (1, 2, 3)} <= keys, "the provided bucket holds the seeded pictures"


def test_if_typescript_source():
    skip = {"node_modules", "dist", "build", ".git", "coverage"}
    ts, js = [], []
    for path in Path("/app").rglob("*"):
        if any(part in skip for part in path.parts) or not path.is_file():
            continue
        if path.suffix in (".ts", ".tsx"):
            ts.append(path)
        elif path.suffix in (".js", ".jsx", ".mjs", ".cjs") and ".config." not in path.name:
            js.append(path)
    assert ts, "no TypeScript source found"
    assert not js, js
