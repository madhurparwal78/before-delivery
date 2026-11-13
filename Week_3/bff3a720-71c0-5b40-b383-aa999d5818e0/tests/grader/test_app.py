from __future__ import annotations

import csv
import io
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
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    tap,
    text,
)

BRUSSELS = ZoneInfo("Europe/Brussels")
SEAT_HOLD_SECONDS = 300
REQUEST_EXPIRY_HOURS = 12
REQUEST_CUTOFF_MINUTES = 60
BOOKING_CUTOFF_MINUTES = 30
REFUND_FULL_HOURS = 24
REFUND_HALF_HOURS = 2
REFUND_HALF_PERCENT = 50
FREE_CANCEL_SHIFT_MINUTES = 60
FREE_WINDOW_LEAD_HOURS = 2
RATING_WINDOW_DAYS = 14
MESSAGE_RATE_PER_MINUTE = 20
REQUEST_RATE_PER_HOUR = 5
SIGNIN_CODE_RATE_PER_HOUR = 5
EMAIL_CODE_TTL_SECONDS = 600
PHOTO_MAX_BYTES = 2_097_152
ID_DOC_MAX_BYTES = 5_242_880
BYTES_PER_MB = 1_048_576
PRICE_MIN_PER_KM_CENTS = 8
PRICE_MAX_PER_KM_CENTS = 13
MAX_STOPOVERS = 3
AVERAGE_SPEED_KMH = 80
TOAST_SECONDS = 5
SEARCH_DEBOUNCE_MS = 300
JSON_LIMIT_BYTES = 65_536
COMMENT_MAX = 280
SHIFT_MINUTES = 90
CANCEL_HOURS_BEFORE = 20
WHOLE_PRICE = 2150
REQUEST_PRICE = 1500
WALLET_CENTS = 20_000
TOP_UP_CENTS = 500
SECONDS_PER_MINUTE = 60
LIMIT_WINDOW_SECONDS = 3600
MESSAGE_WINDOW_SECONDS = 60
TAP_MIN_PX = 44
SHEET_SWIPE_MIN_PX = 80
TAB_SWIPE_MIN_PX = 60
SHUTTER_MAX_MS = 500
MOTION = {
    "handle-snap": 160,
    "price-roll": 280,
    "shutter-reveal": 420,
    "swap-rotate": 280,
    "sheet": 280,
    "toast": 200,
}
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
ROUTE = ["Kestrevel", "Brisanne", "Oakhythe", "Tollemarch"]
REQUEST_ROUTE = ["Vardholm", "Kestrevel", "Hesketh Mere"]
BOOKING_STATES = ["held", "requested", "accepted", "confirmed", "declined", "expired", "withdrawn",
                  "cancelled_by_passenger", "cancelled_by_driver", "completed", "rated"]
LICENCE_ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
DISTANCES = {
    ("Kestrevel", "Brisanne"): 67, ("Kestrevel", "Oakhythe"): 126, ("Kestrevel", "Tollemarch"): 213, ("Kestrevel", "Vardholm"): 70, ("Kestrevel", "Saint Ivrel"): 136, ("Kestrevel", "Corrandy"): 230, ("Kestrevel", "Hesketh Mere"): 77,
    ("Brisanne", "Oakhythe"): 59, ("Brisanne", "Tollemarch"): 146, ("Brisanne", "Vardholm"): 88, ("Brisanne", "Saint Ivrel"): 95, ("Brisanne", "Corrandy"): 173, ("Brisanne", "Hesketh Mere"): 99,
    ("Oakhythe", "Tollemarch"): 87, ("Oakhythe", "Vardholm"): 131, ("Oakhythe", "Saint Ivrel"): 84, ("Oakhythe", "Corrandy"): 127, ("Oakhythe", "Hesketh Mere"): 146,
    ("Tollemarch", "Vardholm"): 211, ("Tollemarch", "Saint Ivrel"): 134, ("Tollemarch", "Corrandy"): 99, ("Tollemarch", "Hesketh Mere"): 224,
    ("Vardholm", "Saint Ivrel"): 95, ("Vardholm", "Corrandy"): 196, ("Vardholm", "Hesketh Mere"): 146,
    ("Saint Ivrel", "Corrandy"): 101, ("Saint Ivrel", "Hesketh Mere"): 191,
    ("Corrandy", "Hesketh Mere"): 270,
}

SEAT_TAKEN = "This seat was just taken. Choose another span or ride."
NOT_FOUND = "We could not find that."
NO_ACCESS = "You do not have access to this."
VERIFY_FIRST = "Your ID must be verified before you can offer a ride."
STORAGE_DOWN = "We could not store your file right now. Nothing was lost; try again in a moment."
MAIL_QUEUED = "Saved. Emails to passengers are queued and will be sent when mail is back."

WAIT_S = 25
PROBE_MS = 400
STEP_MS = 100
HTTP_TIMEOUT = 30
MAIL_WAIT_S = 40
MAIL_SETTLE_S = 0.5
MAIL_QUIET_S = 3.0
TAB_PRESSES = 30
SHEET_SWIPE_PX = SHEET_SWIPE_MIN_PX * 3 // 2
SHORT_SWIPE_PX = SHEET_SWIPE_MIN_PX // 3
TAB_SWIPE_PX = TAB_SWIPE_MIN_PX * 2
SCROLL_PX = 600
ISO_MS_SLACK = 1000


def env(name: str) -> str:
    value = os.environ.get(name, "")
    assert value, f"verifier environment lacks {name}"
    return value


def km(a: str, b: str) -> int:
    return DISTANCES.get((a, b)) or DISTANCES[(b, a)]


def span_km(stops: list[str], a: str, b: str) -> int:
    i, j = stops.index(a), stops.index(b)
    return sum(km(stops[k], stops[k + 1]) for k in range(i, j))


def route_km(stops: list[str]) -> int:
    return span_km(stops, stops[0], stops[-1])


def half_up_50(cents: int) -> int:
    return (cents + 25) // 50 * 50


def price_range(total_km: int) -> tuple[int, int]:
    return half_up_50(total_km * PRICE_MIN_PER_KM_CENTS), half_up_50(total_km * PRICE_MAX_PER_KM_CENTS)


def seg_price(price: int, stops: list[str], a: str, b: str) -> int:
    return price * span_km(stops, a, b) // route_km(stops)


def minutes_to(stops: list[str], city: str) -> int:
    return -(-span_km(stops, stops[0], city) * 60 // AVERAGE_SPEED_KMH) if city != stops[0] else 0


def euros(cents: int) -> str:
    return f"€{cents // 100}.{cents % 100:02d}"


def signed(cents: int) -> str:
    return f"{'-' if cents < 0 else '+'}{euros(abs(cents))}"


def local(dt: datetime) -> datetime:
    return dt.astimezone(BRUSSELS)


def iso(dt: datetime) -> str:
    return local(dt).isoformat(timespec="seconds")


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def at(day: date, hour: int, minute: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=BRUSSELS)


def floor_minute(dt: datetime) -> datetime:
    return local(dt).replace(second=0, microsecond=0)


def hhmm(dt: datetime) -> str:
    return f"{local(dt):%H:%M}"


def ddd(dt: datetime | date) -> str:
    d = local(dt) if isinstance(dt, datetime) else dt
    return f"{d:%a} {d.day} {d:%b}"


def long_name(d: date) -> str:
    return f"{d:%A} {d.day} {d:%B} {d.year}"


def button_name(d: date) -> str:
    return f"Date, {d:%a} {d.day} {d:%b} {d.year}"


def month_name(d: date) -> str:
    return f"{d:%B} {d.year}"


def month_key(d: date | datetime) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    return date(y, m, min(d.day, last))


def count_phrase(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def band_name(seat: int, legs: list[str], stops: list[str]) -> str:
    runs, start = [], 0
    for i in range(1, len(legs) + 1):
        if i == len(legs) or legs[i] != legs[start]:
            runs.append(f"{legs[start]} from {stops[start]} to {stops[i]}")
            start = i
    return f"Seat {seat}: " + ", ".join(runs)


def png(size: int = 0) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    body = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff")) + chunk(b"IEND", b""))
    return body + b"\x00" * max(0, size - len(body))


JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
GIF = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"


def call(base: str, method: str, path: str, sess: str | None = None, *, body: Any = None, key: str | None = None,
         headers: dict[str, str] | None = None, raw: bytes | None = None, files: Any = None) -> httpx.Response:
    h = dict(headers or {})
    if sess:
        h["Cookie"] = f"ls_session={sess}"
    if key:
        h["Idempotency-Key"] = key
    kw: dict[str, Any] = {}
    if body is not None:
        kw["json"] = body
    if raw is not None:
        kw["content"] = raw
    if files is not None:
        kw["files"] = files
    return httpx.request(method, base + path, headers=h, timeout=HTTP_TIMEOUT, **kw)


def fails(r: httpx.Response, status: int, code: str, message: str | re.Pattern | None = None) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code}: {r.text[:400]}"
    body = r.json()
    assert body.get("error") == code, f"expected error {code!r}, got {body}"
    if isinstance(message, re.Pattern):
        assert message.fullmatch(body.get("message", "")), f"message {body.get('message')!r} !~ {message.pattern}"
    elif message is not None:
        assert body.get("message") == message, f"message {body.get('message')!r} != {message!r}"
    return body


def ok(r: httpx.Response, status: int, what: str) -> Any:
    assert r.status_code == status, f"{what} answered {r.status_code}: {r.text[:400]}"
    return r.json() if r.content else None


def clock(base: str, seconds: int) -> datetime:
    r = httpx.post(f"{base}/api/grading/clock", json={"advance_seconds": seconds},
                   headers={"X-Grading-Token": env("GRADING_TOKEN")}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"POST /api/grading/clock answered {r.status_code}: {r.text}"
    return parse(r.json()["now"])


def server_now(base: str) -> datetime:
    return clock(base, 0)


@dataclass
class World:
    base: str
    now: datetime
    tag: str
    names: dict[str, str]
    emails: dict[str, str]
    members: dict[str, dict]
    rides: dict[str, str]
    bookings: dict[str, str]
    vehicles: dict[str, str]

    def s(self, key: str) -> str:
        return self.members[key]["session"]

    def id(self, key: str) -> str:
        return self.members[key]["id"]

    def api(self, method: str, path: str, who: str | None = None, **kw: Any) -> httpx.Response:
        return call(self.base, method, path, self.s(who) if who else None, **kw)


FIRST = {"mara": "Mara", "lune": "Lune", "tobin": "Tobin", "idris": "Idris", "wren": "Wren"}


def ride(key: str, driver: str, departure: datetime, *, stops: list[str] | None = None, seats: int = 3,
         price: int = WHOLE_PRICE, mode: str = "instant", state: str = "published") -> dict:
    return {"key": key, "driver": driver, "vehicle": f"car-{driver}", "stops": list(stops or ROUTE),
            "departure": iso(departure), "seats": seats, "price_cents": price, "booking_mode": mode, "state": state}


def booking(key: str, ride_key: str, passenger: str, boarding: str, alighting: str, *, created: datetime,
            seats: int = 1, state: str = "confirmed", refund: int | None = None) -> dict:
    b = {"key": key, "ride": ride_key, "passenger": passenger, "boarding": boarding, "alighting": alighting,
         "seats": seats, "state": state, "created_at": iso(created)}
    if refund is not None:
        b["refund_percent"] = refund
    return b


def seed(base: str, members: dict[str, dict], rides: list[dict] = (), bookings: list[dict] = (),
         messages: list[dict] = (), ratings: list[dict] = ()) -> World:
    tag = uuid.uuid4().hex[:8]
    names, emails, people, cars = {}, {}, [], []
    for key, spec in members.items():
        roles = spec.get("roles", ["driver", "passenger"])
        names[key] = spec.get("name", f"{FIRST.get(key, key.capitalize())} {tag}")
        emails[key] = f"{key}.{tag}@example.test"
        people.append({"key": key, "display_name": names[key], "email": emails[key], "roles": roles,
                       "id_state": spec.get("id_state", "verified" if "driver" in roles else "none"),
                       "wallet_cents": spec.get("wallet", 0), "photo": spec.get("photo", False)})
        if spec.get("car"):
            cars.append({"key": f"car-{key}", "owner": key, "make_model": "Rowan Estate", "colour": "Slate grey",
                         "seats": spec["car"]})
    body = {"members": people, "vehicles": cars, "rides": list(rides), "bookings": list(bookings),
            "messages": list(messages), "ratings": list(ratings)}
    r = httpx.post(f"{base}/api/grading/setup", json=body, headers={"X-Grading-Token": env("GRADING_TOKEN")},
                   timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"POST /api/grading/setup answered {r.status_code}: {r.text[:600]}"
    j = r.json()
    return World(base, parse(j["now"]), tag, names, emails, j["members"], j.get("rides", {}),
                 j.get("bookings", {}), j.get("vehicles", {}))


def get_ride(w: World, rk: str, who: str | None = None) -> dict:
    return ok(w.api("GET", f"/api/rides/{w.rides[rk]}", who), 200, "GET /api/rides/<id>")


def get_booking(w: World, bid: str, who: str) -> dict:
    return ok(w.api("GET", f"/api/bookings/{bid}", who), 200, "GET /api/bookings/<id>")


def attempt(w: World, who: str, rk: str, boarding: str, alighting: str, seats: int = 1, *, key: str | None = None,
            version: int | None = None) -> httpx.Response:
    rid = w.rides[rk]
    if version is None:
        version = get_ride(w, rk, who)["version"]
    return w.api("POST", f"/api/rides/{rid}/bookings", who,
                 body={"boarding": boarding, "alighting": alighting, "seats": seats, "ride_version": version},
                 key=key or idempotency_key())


def booked(w: World, who: str, rk: str, boarding: str, alighting: str, seats: int = 1) -> dict:
    b = ok(attempt(w, who, rk, boarding, alighting, seats), 201, "POST /api/rides/<id>/bookings")
    if b["state"] == "held":
        b = ok(w.api("POST", f"/api/bookings/{b['id']}/confirm", who, key=idempotency_key()), 200,
               "POST /api/bookings/<id>/confirm")
    return b


def wallet(w: World, who: str) -> dict:
    return ok(w.api("GET", "/api/wallet", who), 200, "GET /api/wallet")


def ledger(w: World, who: str, bid: str) -> list[dict]:
    entries = ok(w.api("GET", f"/api/bookings/{bid}/ledger", who), 200, "GET /api/bookings/<id>/ledger")["entries"]
    for e in entries:
        assert 2 <= len(e["lines"]) <= 3, f"ledger entry {e['id']} has {len(e['lines'])} lines; expected two or three"
        assert sum(line["amount_cents"] for line in e["lines"]) == 0, f"ledger entry {e} does not sum to zero"
    return entries


def accounts(entry: dict) -> dict[str, int]:
    return {line["account"]: line["amount_cents"] for line in entry["lines"]}


def search(w: World, frm: str, to: str, day: date, seats: int = 1, **extra: Any) -> list[dict]:
    q = {"from": frm, "to": to, "date": day.isoformat(), "seats": seats, **extra}
    return ok(w.api("GET", "/api/rides/search?" + urlencode(q)), 200, "GET /api/rides/search")["rides"]


def search_path(frm: str, to: str, day: date, seats: int = 1) -> str:
    return "/search?" + urlencode({"from": frm, "to": to, "date": day.isoformat(), "seats": seats})


def poll(base: str, fetch: Callable[[], Any], good: Callable[[Any], bool], what: str, seconds: float = WAIT_S) -> Any:
    deadline, last = time.monotonic() + seconds, None
    while time.monotonic() < deadline:
        clock(base, 0)
        last = fetch()
        if good(last):
            return last
    pytest.fail(f"{what}; last seen: {str(last)[:400]}")


def boarding_departure(now: datetime, lead: timedelta, stops: list[str], city: str) -> datetime:
    return floor_minute(now + lead - timedelta(minutes=minutes_to(stops, city)))


def inbox(mail: Any, to: str, subject: str, minimum: int = 1) -> list[dict]:
    deadline, found = time.monotonic() + MAIL_WAIT_S, []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages(settle=MAIL_SETTLE_S)
                 if to in addresses(m.get("To")) and m.get("Subject") == subject]
        if len(found) >= minimum:
            return found
    pytest.fail(f"Mailpit has {len(found)} email(s) to {to} with subject {subject!r}; expected at least {minimum}")


def exactly(mail: Any, to: str, subject: str, count: int = 1) -> list[dict]:
    inbox(mail, to, subject, count)
    found = [m for m in mail.messages(settle=MAIL_QUIET_S)
             if to in addresses(m.get("To")) and m.get("Subject") == subject]
    assert len(found) == count, f"Mailpit has {len(found)} emails to {to} with subject {subject!r}; expected {count}"
    return found


def none_to(mail: Any, to: str, subject: str) -> None:
    found = [m for m in mail.messages(settle=MAIL_QUIET_S)
             if to in addresses(m.get("To")) and m.get("Subject") == subject]
    assert not found, f"Mailpit unexpectedly has {len(found)} email(s) to {to} with subject {subject!r}"


class Live:
    def __init__(self, base: str, query: str = "", sess: str | None = None):
        self.events: list[tuple[str, Any]] = []
        self.status: int | None = None
        self.content_type = ""
        self.closed = False
        self.cond = threading.Condition()
        headers = {"Accept": "text/event-stream"}
        if sess:
            headers["Cookie"] = f"ls_session={sess}"
        self.client = httpx.Client(timeout=httpx.Timeout(HTTP_TIMEOUT, read=None))
        self.thread = threading.Thread(target=self._run, args=(f"{base}/api/live{query}", headers), daemon=True)
        self.thread.start()

    def _run(self, url: str, headers: dict[str, str]) -> None:
        try:
            with self.client.stream("GET", url, headers=headers) as r:
                with self.cond:
                    self.status, self.content_type = r.status_code, r.headers.get("content-type", "")
                    self.cond.notify_all()
                kind = "message"
                for line in r.iter_lines():
                    if line.startswith("event:"):
                        kind = line[6:].strip()
                    elif line.startswith("data:"):
                        try:
                            data = json.loads(line[5:].strip())
                        except ValueError:
                            data = line[5:].strip()
                        with self.cond:
                            self.events.append((kind, data))
                            self.cond.notify_all()
        except (httpx.HTTPError, RuntimeError, ValueError):
            pass
        finally:
            with self.cond:
                self.closed = True
                self.cond.notify_all()

    def wait(self, pred: Callable[[str, Any], bool], what: str, seconds: float = WAIT_S) -> tuple[str, Any]:
        deadline = time.monotonic() + seconds
        with self.cond:
            while time.monotonic() < deadline:
                for e in self.events:
                    if pred(*e):
                        return e
                if self.closed:
                    break
                self.cond.wait(timeout=max(0.0, deadline - time.monotonic()))
        pytest.fail(f"/api/live never delivered {what}; got {[k for k, _ in self.events]}")

    def close(self) -> None:
        self.client.close()


_CDP: dict[int, Any] = {}


@contextmanager
def opened(browser: Browser, base: str, path: str, sess: str | None = None, *, viewport: dict = DESKTOP,
           reduced: bool = False, device_time: datetime | None = None, touch: bool = False) -> Iterator[Page]:
    with open_app(browser, f"{base}/health", reduced_motion="reduce" if reduced else "no-preference") as p:
        p.set_viewport_size(viewport)
        if touch:
            cdp = session(p)
            _CDP[id(p)] = cdp
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        if sess:
            p.context.add_cookies([{"name": "ls_session", "value": sess, "url": base}])
        if device_time is not None:
            p.clock.set_system_time(device_time)
        p.goto(f"{base}{path}")
        yield p


def eventually(pages: Page | list[Page], probe: Callable[[], Any], what: str, seconds: float = WAIT_S) -> None:
    group = pages if isinstance(pages, list) else [pages]
    deadline, last = time.monotonic() + seconds, ""
    while time.monotonic() < deadline:
        try:
            probe()
            return
        except (AssertionError, PlaywrightTimeout) as exc:
            last = (str(exc).splitlines() or [repr(exc)])[0]
        for pg in group:
            advance(pg, STEP_MS)
    pytest.fail(f"{what} (last check: {last})")


def ensure(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def see(pages: Page | list[Page], loc: Locator, what: str) -> None:
    eventually(pages, lambda: expect(loc).to_be_visible(timeout=PROBE_MS), what)


def says(pages: Page | list[Page], loc: Locator, content: str | re.Pattern, what: str) -> None:
    eventually(pages, lambda: expect(loc).to_contain_text(content, timeout=PROBE_MS, use_inner_text=True), what)


def hidden(pages: Page | list[Page], loc: Locator, what: str) -> None:
    eventually(pages, lambda: expect(loc).to_be_hidden(timeout=PROBE_MS), what)


def focused(pages: Page | list[Page], loc: Locator, what: str) -> None:
    eventually(pages, lambda: expect(loc).to_be_focused(timeout=PROBE_MS), what)


def announced(page: Page, content: str | re.Pattern, others: list[Page] | None = None) -> None:
    region = page.get_by_role("status", name="Announcements")
    says([page, *(others or [])], region, content, f'status "Announcements" read {content!r}')


def press(page: Page, loc: Locator, *keys: str) -> None:
    loc.focus()
    for k in keys:
        page.keyboard.press(k)


def focus_in(loc: Locator, what: str) -> Callable[[], None]:
    def probe() -> None:
        ensure(loc.count() > 0 and loc.first.evaluate("e => e.contains(document.activeElement)"), what)
    return probe


def value_text(loc: Locator) -> str:
    return loc.get_attribute("aria-valuetext") or loc.input_value()


def value_now(loc: Locator) -> int:
    raw = loc.get_attribute("aria-valuenow") or loc.input_value()
    return int(re.search(r"\d+", raw).group(0))


def value_is(page: Page, loc: Locator, expected: str, what: str) -> None:
    eventually(page, lambda: ensure(value_text(loc) == expected, f"{what}: value text {value_text(loc)!r}"), what)


def entry(page: Page, record_id: str) -> Locator:
    return page.locator(f'[data-id="{record_id}"]')


def entry_link(page: Page, record_id: str, name: str) -> Locator:
    link = page.get_by_role("link", name=name, exact=True)
    return link.and_(entry(page, record_id)).or_(entry(page, record_id).get_by_role("link", name=name, exact=True))


def town(page: Page, name: str, typed: str, city: str) -> None:
    box = page.get_by_role("combobox", name=name, exact=True)
    box.focus()
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.type(typed)
    towns = page.get_by_role("listbox", name="Towns")
    see(page, towns.get_by_role("option", name=city, exact=True), f'typing {typed!r} in {name} offered option "{city}"')
    page.keyboard.press("ArrowDown")
    announced(page, f"{city}, 1 of 1")
    active = box.get_attribute("aria-activedescendant")
    assert active, f'combobox "{name}" has no active descendant after ArrowDown'
    expect(towns.get_by_role("option", name=city, exact=True)).to_have_attribute("id", active)
    page.keyboard.press("Enter")
    hidden(page, towns, f'Enter in "{name}" closed listbox "Towns"')


def choose_vehicle(page: Page, make_model: str = "Rowan Estate") -> None:
    box = page.get_by_role("combobox", name="Vehicle")
    see(page, box, 'Offer a ride shows combobox "Vehicle"')
    labels = [t.strip() for t in box.get_by_role("option").all_inner_texts()]
    select(box, next((t for t in labels if make_model in t), make_model))


def date_button(page: Page) -> Locator:
    return page.get_by_role("button", name=re.compile(r"^Date, "))


def shown_date(page: Page) -> date:
    snap = date_button(page).aria_snapshot()
    m = re.search(r"Date, \w+ (\d{1,2}) (\w+) (\d{4})", snap)
    assert m, f"date button does not read 'Date, <Ddd D Mon YYYY>': {snap}"
    month = next(i for i in range(1, 13) if date(2000, i, 1).strftime("%b").lower() == m.group(2)[:3].lower())
    return date(int(m.group(3)), month, int(m.group(1)))


def walk(page: Page, cur: date, target: date) -> date:
    delta = (target - cur).days
    for _ in range(abs(delta)):
        page.keyboard.press("ArrowRight" if delta > 0 else "ArrowLeft")
    return target


def at_day(page: Page, dialog: Locator, d: date) -> None:
    cell = dialog.get_by_role("gridcell", name=long_name(d), exact=True)
    eventually(page, focus_in(cell, f"focus is not on gridcell {long_name(d)}"), f"focus moved to {long_name(d)}")


def pick_date(page: Page, target: date) -> None:
    opener = date_button(page)
    start = shown_date(page)
    press(page, opener, "Enter")
    dialog = page.get_by_role("dialog", name="Choose a date")
    see(page, dialog, 'the date button opened dialog "Choose a date"')
    at_day(page, dialog, start)
    walk(page, start, target)
    at_day(page, dialog, target)
    page.keyboard.press("Enter")
    hidden(page, dialog, "Enter on a day closed the date picker")
    eventually(page, lambda: expect(date_button(page)).to_have_accessible_name(button_name(target), timeout=PROBE_MS),
               f"date button reads {button_name(target)!r}")
    expect(date_button(page)).to_be_focused()


def query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query)


def center(box: dict[str, float]) -> tuple[float, float]:
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def touch_drag(page: Page, x0: float, y0: float, x1: float, y1: float, steps: int = 8) -> None:
    cdp = _CDP.get(id(page)) or session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
            {"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def swipe_down(page: Page, sheet: Locator, distance: float) -> None:
    box = sheet.bounding_box()
    assert box, "sheet has no box to swipe on"
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 4
    touch_drag(page, x, y, x, y + distance)


def sheet_gone(page: Page, name: str) -> Callable[[], None]:
    def probe() -> None:
        d = page.get_by_role("dialog", name=name)
        if d.count() == 0:
            return
        box = d.first.bounding_box()
        state = d.first.get_attribute("data-state")
        ensure(box is None or not d.first.is_visible() or state == "closed"
               or box["y"] >= page.viewport_size["height"] - 1, f'dialog "{name}" is still open')
    return probe


MOTION_LOG = """() => {
  window.__motionLog = [];
  const rec = (el) => { if (el.nodeType === 1 && el.hasAttribute('data-motion')) window.__motionLog.push(
    [el.getAttribute('data-motion'), el.getAttribute('data-motion-ms'), el.getAttribute('data-state')]); };
  document.querySelectorAll('[data-motion]').forEach(rec);
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') rec(m.target);
    for (const n of m.addedNodes || []) { if (n.nodeType === 1) { rec(n); n.querySelectorAll('[data-motion]').forEach(rec); } } } })
    .observe(document.documentElement, {subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-state', 'data-motion', 'data-motion-ms']});
}"""

MOTION_STATES = """(name) => [...document.querySelectorAll('[data-motion]')]
  .filter((e) => e.getAttribute('data-motion') === name)
  .map((e) => [e.getAttribute('data-motion-ms'), e.getAttribute('data-state')])"""


def motion_log(page: Page, name: str) -> list[list[str]]:
    return [e for e in page.evaluate("() => window.__motionLog || []") if e[0] == name]


def motion_states(page: Page, name: str) -> list[list[str]]:
    return page.evaluate(MOTION_STATES, name)


def keep_marker(page: Page) -> None:
    page.evaluate("() => { window.__noReload = true; }")


def assert_no_reload(page: Page) -> None:
    assert page.evaluate("() => window.__noReload === true"), "the page reloaded; expected a live update"


def seat_bands(page: Page, names: list[str], what: str) -> None:
    span = page.get_by_role("group", name="Leg Span")
    for n in names:
        see(page, span.get_by_role("img", name=n, exact=True), f"{what}: seat band {n!r}")


def test_wf_publish_ride_keyboard_happy(browser: Browser, app_url: str) -> None:
    w = seed(app_url, {"mara": {"car": 3}})
    total = route_km(ROUTE)
    low, high = price_range(total)
    with opened(browser, app_url, "/offer", w.s("mara")) as p:
        see(p, p.get_by_role("heading", level=1, name="Offer a ride"), "Offer a ride heading")
        price = p.get_by_role("spinbutton", name="Price per seat")
        expect(price).to_be_disabled()
        choose_vehicle(p)
        town(p, "Leaving from", "kes", "Kestrevel")
        town(p, "Going to", "tol", "Tollemarch")
        town(p, "Add a stopover", "oak", "Oakhythe")
        town(p, "Add a stopover", "bri", "Brisanne")
        stopovers = p.get_by_role("list", name="Stopovers")
        expect(stopovers.get_by_role("listitem")).to_have_count(2)
        up = p.get_by_role("button", name="Move Brisanne up", exact=True)
        press(p, up, "Enter")
        announced(p, "Brisanne moved to stop 1 of 2")
        expect(up).to_be_focused()
        says(p, stopovers.get_by_role("listitem").first, "Brisanne", "Brisanne is the first stopover")
        press(p, p.get_by_role("button", name="Remove Oakhythe", exact=True), "Enter")
        announced(p, f"Oakhythe removed. Undo is available for {TOAST_SECONDS} seconds.")
        expect(stopovers.get_by_role("listitem")).to_have_count(1)
        press(p, p.get_by_role("button", name="Undo"), "Enter")
        announced(p, "Oakhythe restored to stop 2")
        focused(p, p.get_by_role("button", name="Remove Oakhythe", exact=True), "Undo returned focus to Remove Oakhythe")
        expect(stopovers.get_by_role("listitem")).to_have_count(2)
        see(p, p.get_by_text(f"Recommended: {euros(low)} to {euros(high)} for {total} km"), "recommended range text")
        expect(price).to_be_enabled()
        value_is(p, price, euros(half_up_50((low + high) // 2)), "price resets to the middle of the range")
        press(p, price, "End")
        value_is(p, price, euros(high), "End goes to the top of the range")
        p.keyboard.press("ArrowUp")
        announced(p, f"Price per seat: {euros(high)}. This is the top of the recommended range.")
        p.keyboard.press("Home")
        p.keyboard.press("PageUp")
        p.keyboard.press("ArrowDown")
        value_is(p, price, euros(WHOLE_PRICE), "Home, Page Up and ArrowDown step to €21.50")
        seats = p.get_by_role("spinbutton", name="Seats", exact=True)
        assert value_now(seats) == 3, "Seats starts at 3 on the offer form (L221)"
        press(p, seats, "ArrowUp")
        announced(p, "Seats: 3. This is the most.")
        p.keyboard.press("Home")
        p.keyboard.press("ArrowDown")
        announced(p, "Seats: 1. This is the fewest.")
        p.keyboard.press("PageUp")
        eventually(p, lambda: ensure(value_now(seats) == 3, "seats"), "Page Up stepped two seats to 3")
        start = shown_date(p)
        opener = date_button(p)
        press(p, opener, "Enter")
        dialog = p.get_by_role("dialog", name="Choose a date")
        see(p, dialog, "date picker opened")
        at_day(p, dialog, start)
        p.keyboard.press("PageDown")
        target = add_months(start, 1)
        at_day(p, dialog, target)
        see(p, dialog.get_by_role("grid", name=month_name(target)), "grid renamed to the new month")
        announced(p, month_name(target))
        p.keyboard.press("Enter")
        hidden(p, dialog, "Enter picked the day and closed the picker")
        eventually(p, lambda: expect(date_button(p)).to_have_accessible_name(button_name(target), timeout=PROBE_MS),
                   "date button carries the picked date")
        expect(date_button(p)).to_be_focused()
        departure_box = p.get_by_role("textbox", name="Departure time")
        departure_box.focus()
        p.keyboard.press("ControlOrMeta+a")
        p.keyboard.type("08:30")
        press(p, p.get_by_role("radio", name="Instant booking"), "Space")
        expect(p.get_by_role("radio", name="Instant booking")).to_be_checked()
        press(p, p.get_by_role("button", name="Publish ride"), "Enter")
        eventually(p, lambda: expect(p).to_have_url(re.compile(r"/rides/[^/?#]+$"), timeout=PROBE_MS),
                   "Publish ride opened the ride page")
        ride_id = urlparse(p.url).path.rsplit("/", 1)[1]
        dep = at(target, 8, 30)
        times = [hhmm(dep + timedelta(minutes=minutes_to(ROUTE, c))) for c in ROUTE]
        see(p, p.get_by_role("heading", level=1, name=f"Kestrevel to Tollemarch, {ddd(target)}"), "ride heading")
        eventually(p, lambda: expect(p.get_by_role("list", name="Stops").get_by_role("listitem")).to_have_text(
            [f"{t} {c}" for t, c in zip(times, ROUTE)], timeout=PROBE_MS, use_inner_text=True), "four stops with times")
        seat_bands(p, [f"Seat {n}: free from Kestrevel to Tollemarch" for n in (1, 2, 3)], "empty Leg Span")
    r = ok(call(app_url, "GET", f"/api/rides/{ride_id}", w.s("mara")), 200, "GET /api/rides/<id>")
    assert r["state"] == "published" and r["version"] == 1 and r["booking_mode"] == "instant"
    assert [s["city"] for s in r["stops"]] == ROUTE and r["price_cents"] == WHOLE_PRICE and r["seats"] == 3
    assert parse(r["stops"][0]["time"]) == dep, f"departure stored as {r['stops'][0]['time']}; expected {iso(dep)}"


def test_wf_publish_ride_keyboard_price_clamp(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    target = local(now).date() + timedelta(days=5)
    w = seed(app_url, {"idris": {"car": 4}})
    total = km("Vardholm", "Hesketh Mere")
    low, high = price_range(total)
    with opened(browser, app_url, "/offer", w.s("idris")) as p:
        price = p.get_by_role("spinbutton", name="Price per seat")
        see(p, price, "price stepper")
        expect(price).to_be_disabled()
        choose_vehicle(p)
        town(p, "Leaving from", "var", "Vardholm")
        town(p, "Going to", "hes", "Hesketh Mere")
        see(p, p.get_by_text(f"Recommended: {euros(low)} to {euros(high)} for {total} km"), "range for 146 km")
        value_is(p, price, euros(half_up_50((low + high) // 2)), "price starts at the middle")
        press(p, price, "Home")
        value_is(p, price, euros(low), "Home goes to the bottom")
        p.keyboard.press("ArrowDown")
        announced(p, f"Price per seat: {euros(low)}. This is the bottom of the recommended range.")
        value_is(p, price, euros(low), "price stays at the bottom")
        pick_date(p, target)
        box = p.get_by_role("textbox", name="Departure time")
        box.focus()
        p.keyboard.press("ControlOrMeta+a")
        p.keyboard.type("08:30")
        press(p, p.get_by_role("radio", name="Review each request"), "Space")
        press(p, p.get_by_role("button", name="Publish ride"), "Enter")
        eventually(p, lambda: expect(p).to_have_url(re.compile(r"/rides/[^/?#]+$"), timeout=PROBE_MS), "published")
        ride_id = urlparse(p.url).path.rsplit("/", 1)[1]
    r = ok(call(app_url, "GET", f"/api/rides/{ride_id}", w.s("idris")), 200, "GET ride")
    assert r["price_cents"] == low and r["route_km"] == total and r["booking_mode"] == "request"
    assert [s["city"] for s in r["stops"]] == ["Vardholm", "Hesketh Mere"]


def test_price_range_api(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=6)
    w = seed(app_url, {"mara": {"car": 3}})
    created = 0
    for stops in (["Kestrevel", "Tollemarch"], ["Vardholm", "Hesketh Mere"], REQUEST_ROUTE, ROUTE):
        total = route_km(stops)
        low, high = price_range(total)
        rng = ok(w.api("GET", "/api/price-range?stops=" + ",".join(stops)), 200, "GET /api/price-range")
        assert (rng["route_km"], rng["low_cents"], rng["high_cents"]) == (total, low, high), rng
        msg = f"Set a price between {euros(low)} and {euros(high)} for {total} km."
        for price, good in ((low - 50, False), (high + 50, False), (low + 25, False), (low, True), (high, True)):
            r = w.api("POST", "/api/rides", "mara", body={"vehicle_id": w.vehicles["car-mara"], "stops": stops,
                      "departure": iso(at(day, 8, 30)), "seats": 3, "price_cents": price, "booking_mode": "instant"})
            if good:
                assert ok(r, 201, f"publish at {price}")["price_cents"] == price
                created += 1
            else:
                fails(r, 422, "price_out_of_range", msg)
    rides = ok(w.api("GET", "/api/me/bookings?tab=upcoming", "mara"), 200, "my rides")["rides"]
    assert len(rides) == created, f"{len(rides)} rides stored; expected only the {created} accepted ones"


def test_publish_rules(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=4)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"car": 3, "id_state": "none"},
                       "tobin": {"car": 3, "id_state": "pending"}})

    def body(who: str, stops: list[str], price: int = WHOLE_PRICE, **kw: Any) -> dict:
        return {"vehicle_id": w.vehicles[f"car-{who}"], "stops": stops, "departure": iso(at(day, 8, 30)),
                "seats": 3, "price_cents": price, "booking_mode": "instant", **kw}

    r = ok(w.api("POST", "/api/rides", "mara", body=body("mara", ROUTE)), 201, "publish")
    assert r["state"] == "published" and r["version"] == 1 and r["route_km"] == route_km(ROUTE)
    assert [(leg["from"], leg["to"], leg["km"]) for leg in r["legs"]] == [
        (ROUTE[i], ROUTE[i + 1], km(ROUTE[i], ROUTE[i + 1])) for i in range(3)]
    dep = at(day, 8, 30)
    assert [parse(s["time"]) for s in r["stops"]] == [dep + timedelta(minutes=minutes_to(ROUTE, c)) for c in ROUTE]
    assert [s["km"] for s in r["stops"]] == [span_km(ROUTE, ROUTE[0], c) for c in ROUTE]
    assert sorted(s["seat"] for s in r["seat_map"]) == [1, 2, 3]
    assert all(leg == "free" for s in r["seat_map"] for leg in s["legs"])
    for who in ("lune", "tobin"):
        fails(w.api("POST", "/api/rides", who, body=body(who, ROUTE)), 403, "forbidden", VERIFY_FIRST)
        assert ok(w.api("GET", "/api/me/bookings?tab=upcoming", who), 200, "my rides")["rides"] == []
    six = ["Kestrevel", "Vardholm", "Brisanne", "Oakhythe", "Saint Ivrel", "Tollemarch"]
    many = f"A ride can have at most {MAX_STOPOVERS} stopovers."
    fails(w.api("POST", "/api/rides", "mara", body=body("mara", six)), 422, "too_many_stopovers", many)
    fails(w.api("POST", "/api/rides", "mara", body=body("mara", six, price=50)), 422, "too_many_stopovers", many)
    five = ["Kestrevel", "Vardholm", "Brisanne", "Oakhythe", "Tollemarch"]
    low, _ = price_range(route_km(five))
    ok(w.api("POST", "/api/rides", "mara", body=body("mara", five, price=low)), 201, "three stopovers")
    fails(w.api("POST", "/api/rides", "mara", body=body("mara", ROUTE, seats=4)), 422, "validation_failed")
    past = body("mara", ROUTE)
    past["departure"] = iso(now - timedelta(hours=1))
    fails(w.api("POST", "/api/rides", "mara", body=past), 422, "validation_failed")
    fails(w.api("POST", "/api/rides", "mara", body=body("mara", ["Kestrevel", "Brisanne", "Kestrevel"])), 422,
          "validation_failed")


def test_wf_search_keyboard_happy(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    today = local(now).date()
    day = today + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("r", "mara", at(day, 8, 30))])
    board = at(day, 8, 30) + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
    with opened(browser, app_url, "/", w.s("lune")) as p:
        see(p, p.get_by_role("search", name="Find a ride"), 'search "Find a ride"')
        going = p.get_by_role("combobox", name="Going to", exact=True)
        going.focus()
        p.keyboard.type("tol")
        towns = p.get_by_role("listbox", name="Towns")
        see(p, towns, "typing opened the towns list")
        p.keyboard.press("Escape")
        hidden(p, towns, "Escape closed the towns list")
        expect(going).to_have_value("tol")
        town(p, "Leaving from", "bri", "Brisanne")
        town(p, "Going to", "tol", "Tollemarch")
        swap = p.get_by_role("button", name="Swap cities")
        press(p, swap, "Enter")
        announced(p, "Leaving from Tollemarch, going to Brisanne")
        press(p, swap, "Enter")
        announced(p, "Leaving from Brisanne, going to Tollemarch")
        start = shown_date(p)
        opener = date_button(p)
        press(p, opener, "Enter")
        dialog = p.get_by_role("dialog", name="Choose a date")
        see(p, dialog, "date picker")
        at_day(p, dialog, start)
        cur = start
        for key, step in (("ArrowRight", 1), ("ArrowDown", 7), ("ArrowUp", -7), ("ArrowLeft", -1)):
            p.keyboard.press(key)
            cur += timedelta(days=step)
            at_day(p, dialog, cur)
        p.keyboard.press("End")
        cur += timedelta(days=6 - cur.weekday())
        at_day(p, dialog, cur)
        p.keyboard.press("Home")
        cur -= timedelta(days=cur.weekday())
        at_day(p, dialog, cur)
        p.keyboard.press("PageDown")
        cur = add_months(cur, 1)
        at_day(p, dialog, cur)
        see(p, dialog.get_by_role("grid", name=month_name(cur)), "grid renamed after Page Down")
        announced(p, month_name(cur))
        p.keyboard.press("PageUp")
        cur = add_months(cur, -1)
        at_day(p, dialog, cur)
        cur = walk(p, cur, today - timedelta(days=1))
        at_day(p, dialog, cur)
        p.keyboard.press("Enter")
        announced(p, "Past dates cannot be chosen")
        expect(dialog).to_be_visible()
        walk(p, cur, day)
        at_day(p, dialog, day)
        p.keyboard.press("Enter")
        hidden(p, dialog, "Enter picked the day")
        eventually(p, lambda: expect(date_button(p)).to_have_accessible_name(button_name(day), timeout=PROBE_MS),
                   "date button carries the picked day")
        expect(date_button(p)).to_be_focused()
        press(p, date_button(p), "Enter")
        see(p, dialog, "picker reopened")
        p.keyboard.press("Escape")
        hidden(p, dialog, "Escape closed the picker")
        focused(p, date_button(p), "focus returned to the date button")
        seats = p.get_by_role("spinbutton", name="Seats", exact=True)
        press(p, seats, "ArrowDown")
        announced(p, "Seats: 1. This is the fewest.")
        p.keyboard.press("End")
        p.keyboard.press("ArrowUp")
        announced(p, "Seats: 4. This is the most.")
        p.keyboard.press("Home")
        eventually(p, lambda: ensure(value_now(seats) == 1, "seats"), "Home went back to 1 seat")
        press(p, p.get_by_role("button", name="Search"), "Enter")
        eventually(p, lambda: ensure(urlparse(p.url).path == "/search", p.url), "Search opened /search")
        q = query(p.url)
        assert (q["from"], q["to"], q["date"], q["seats"]) == (["Brisanne"], ["Tollemarch"], [day.isoformat()], ["1"])
        name = f"{hhmm(board)} Brisanne to Tollemarch, 3 seats left, {euros(seg_price(WHOLE_PRICE, ROUTE, 'Brisanne', 'Tollemarch'))}"
        see(p, p.get_by_role("list", name="Morning rides").locator(f'[data-id="{w.rides["r"]}"]'), "ride in Morning")
        see(p, entry_link(p, w.rides["r"], name), f"result reads {name!r}")
        n = len(search(w, "Brisanne", "Tollemarch", day, 1))
        announced(p, f"{count_phrase(n, 'ride')} found")


def test_wf_search_keyboard_filters_url(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}},
             rides=[ride("i", "mara", at(day, 8, 30)), ride("q", "mara", at(day, 10, 0), price=2000, mode="request")])
    names = {}
    for rk, dep, price in (("i", at(day, 8, 30), WHOLE_PRICE), ("q", at(day, 10, 0), 2000)):
        board = dep + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
        names[rk] = f"{hhmm(board)} Brisanne to Tollemarch, 3 seats left, {euros(seg_price(price, ROUTE, 'Brisanne', 'Tollemarch'))}"
    with opened(browser, app_url, search_path("Brisanne", "Tollemarch", day), w.s("lune")) as p:
        instant_link, request_link = entry_link(p, w.rides["i"], names["i"]), entry_link(p, w.rides["q"], names["q"])
        see(p, instant_link, "instant ride listed")
        see(p, request_link, "request ride listed")
        filters = p.get_by_role("button", name="Filters")
        press(p, filters, "Enter")
        dialog = p.get_by_role("dialog", name="Filters")
        see(p, dialog, "Filters dialog")
        press(p, dialog.get_by_role("checkbox", name="Instant booking only"), "Space")
        advance(p, SEARCH_DEBOUNCE_MS // 2)
        assert "instant" not in query(p.url), "the URL changed before the debounce elapsed"
        eventually(p, lambda: ensure(query(p.url).get("instant") == ["1"], p.url), "instant=1 reached the URL")
        eventually(p, lambda: expect(request_link).to_have_count(0, timeout=PROBE_MS), "request ride left the results")
        n = len(search(w, "Brisanne", "Tollemarch", day, 1, instant=1))
        show = "Show 1 ride" if n == 1 else f"Show {n} rides"
        see(p, dialog.get_by_role("button", name=show, exact=True), f"{show!r} carries the server count")
        p.keyboard.press("Escape")
        hidden(p, dialog, "Escape closed Filters")
        focused(p, filters, "focus returned to Filters")
        assert query(p.url).get("instant") == ["1"], "closing the dialog undid the filter"
        p.reload()
        see(p, instant_link, "reload restores the instant ride")
        expect(request_link).to_have_count(0)
        press(p, filters, "Enter")
        see(p, dialog, "Filters reopened")
        expect(dialog.get_by_role("checkbox", name="Instant booking only")).to_be_checked()
        press(p, dialog.get_by_role("radio", name="Lowest price"), "Space")
        eventually(p, lambda: ensure(query(p.url).get("sort") == ["price"], p.url), "sort=price reached the URL")
        press(p, dialog.get_by_role("button", name=re.compile(r"^Show \d+ rides?$")), "Enter")
        hidden(p, dialog, "Show closed Filters")
        focused(p, filters, "focus returned to Filters")


def test_search_api_rules(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=5)
    soon = [floor_minute(now + timedelta(minutes=20)), floor_minute(now + timedelta(minutes=50))]
    short = ["Brisanne", "Oakhythe", "Tollemarch"]
    w = seed(app_url, {"mara": {"car": 3}, "idris": {"car": 3, "id_state": "none"}, "lune": {"roles": ["passenger"]}},
             rides=[ride("a", "mara", at(day, 8, 30)), ride("b", "mara", at(day, 7, 0), price=2700, mode="request"),
                    ride("c", "mara", at(day, 8, 0), stops=list(reversed(ROUTE))),
                    ride("d", "mara", at(day + timedelta(days=1), 8, 30)), ride("e", "mara", at(day, 8, 30), seats=1),
                    ride("f", "mara", at(day, 8, 30), state="cancelled"), ride("g", "idris", at(day, 9, 0)),
                    ride("x", "mara", soon[0], stops=short), ride("y", "mara", soon[1], stops=short)],
             bookings=[booking("be", "e", "lune", "Brisanne", "Tollemarch", created=now - timedelta(hours=1))])
    ids = w.rides
    found = {r["id"]: r for r in search(w, "Brisanne", "Tollemarch", day)}
    for rk in "abg":
        assert ids[rk] in found, f"ride {rk} missing from search"
    for rk in "cdef":
        assert ids[rk] not in found, f"ride {rk} listed; it is reversed, another day, full or cancelled"
    a = found[ids["a"]]
    assert a["segment_price_cents"] == seg_price(WHOLE_PRICE, ROUTE, "Brisanne", "Tollemarch")
    assert a["segment_km"] == span_km(ROUTE, "Brisanne", "Tollemarch") and a["seats_left"] == 3
    assert parse(a["boarding_time"]) == at(day, 8, 30) + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
    assert parse(a["alighting_time"]) == at(day, 8, 30) + timedelta(minutes=minutes_to(ROUTE, "Tollemarch"))
    assert found[ids["b"]]["segment_price_cents"] == seg_price(2700, ROUTE, "Brisanne", "Tollemarch")

    def order(rows: list[dict]) -> list[str]:
        mine = {ids["a"]: "a", ids["b"]: "b", ids["g"]: "g"}
        return [mine[r["id"]] for r in rows if r["id"] in mine]

    assert order(search(w, "Brisanne", "Tollemarch", day)) == ["b", "a", "g"], "earliest order"
    assert order(search(w, "Brisanne", "Tollemarch", day, sort="earliest")) == ["b", "a", "g"]
    assert order(search(w, "Brisanne", "Tollemarch", day, sort="price")) == ["a", "g", "b"], "price then time"
    assert order(search(w, "Brisanne", "Tollemarch", day, sort="shortest")) == ["b", "a", "g"], "same span, by time"
    assert ids["b"] not in {r["id"] for r in search(w, "Brisanne", "Tollemarch", day, instant=1)}
    assert ids["g"] not in {r["id"] for r in search(w, "Brisanne", "Tollemarch", day, verified=1)}
    three = {r["id"] for r in search(w, "Brisanne", "Tollemarch", day, 3)}
    assert ids["a"] in three and ids["e"] not in three
    assert ids["a"] not in {r["id"] for r in search(w, "Brisanne", "Tollemarch", day, 4)}
    assert ids["c"] in {r["id"] for r in search(w, "Brisanne", "Kestrevel", day)}
    assert ids["a"] not in {r["id"] for r in search(w, "Brisanne", "Kestrevel", day)}
    for rk, dep, listed in (("x", soon[0], False), ("y", soon[1], True)):
        rows = {r["id"] for r in search(w, "Brisanne", "Tollemarch", local(dep).date())}
        assert (ids[rk] in rows) == listed, f"ride boarding {hhmm(dep)}: listed={ids[rk] in rows}, cutoff is 30 minutes"
    fails(w.api("GET", "/api/rides/search?" + urlencode({"to": "Tollemarch", "date": day.isoformat(), "seats": 1})),
          422, "validation_failed")


def test_wf_search_phone_sheets(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("r", "mara", at(day, 8, 30))])
    with opened(browser, app_url, search_path("Brisanne", "Tollemarch", day), w.s("lune"), viewport=PHONE, touch=True) as p:
        opener = date_button(p)
        see(p, opener, "date button on results")
        sheet = p.get_by_role("dialog", name="Choose a date")
        tap(opener)
        see(p, sheet, "date sheet rose")
        advance(p, MOTION["sheet"])
        p.keyboard.press("Escape")
        eventually(p, sheet_gone(p, "Choose a date"), "Escape closed the date sheet")
        focused(p, opener, "focus returned to the date button")
        tap(opener)
        see(p, sheet, "date sheet rose again")
        advance(p, MOTION["sheet"])
        swipe_down(p, sheet, SHORT_SWIPE_PX)
        advance(p, MOTION["sheet"] * 2)
        expect(sheet).to_be_visible()
        box = sheet.bounding_box()
        assert box and box["y"] < PHONE["height"] - 1, "a short swipe closed the sheet"
        swipe_down(p, sheet, SHEET_SWIPE_PX)
        eventually(p, sheet_gone(p, "Choose a date"), "a downward swipe past 80 px closed the date sheet")
        focused(p, opener, "focus returned after the swipe")
        assert shown_date(p) == day and query(p.url)["date"] == [day.isoformat()], "closing changed the date"
        tap(opener)
        see(p, sheet, "date sheet for picking")
        nxt = day + timedelta(days=1)
        tap(sheet.get_by_role("gridcell", name=long_name(nxt), exact=True))
        eventually(p, sheet_gone(p, "Choose a date"), "tapping a day closed the sheet")
        eventually(p, lambda: expect(date_button(p)).to_have_accessible_name(button_name(nxt), timeout=PROBE_MS),
                   "date button carries the tapped day")
        focused(p, date_button(p), "focus returned to the date button")
        filters = p.get_by_role("button", name="Filters")
        tap(filters)
        fsheet = p.get_by_role("dialog", name="Filters")
        see(p, fsheet, "filters sheet")
        tap(fsheet.get_by_role("button", name=re.compile(r"^Show \d+ rides?$")))
        eventually(p, sheet_gone(p, "Filters"), "Show closed the filters sheet")
        focused(p, filters, "focus returned to Filters")
        tap(filters)
        see(p, fsheet, "filters sheet again")
        advance(p, MOTION["sheet"])
        swipe_down(p, fsheet, SHEET_SWIPE_PX)
        eventually(p, sheet_gone(p, "Filters"), "a downward swipe closed the filters sheet")
        focused(p, filters, "focus returned to Filters after the swipe")


def test_wf_search_phone_ride_and_tabs(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("b", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    board = at(day, 8, 30) + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
    name = f"{hhmm(board)} Brisanne to Tollemarch, 3 seats left, {euros(seg_price(WHOLE_PRICE, ROUTE, 'Brisanne', 'Tollemarch'))}"
    with opened(browser, app_url, search_path("Brisanne", "Tollemarch", day), w.s("lune"), viewport=PHONE, touch=True) as p:
        link = entry_link(p, w.rides["r"], name)
        see(p, link, "result on the phone")
        p.evaluate(MOTION_LOG)
        tap(link)
        heading = p.get_by_role("heading", level=1, name=f"Kestrevel to Tollemarch, {ddd(day)}")
        focused(p, heading, "the ride heading took focus after the shutter reveal")
        log = motion_log(p, "shutter-reveal")
        assert log, "no element published data-motion=shutter-reveal"
        assert all(e[1] == str(MOTION["shutter-reveal"]) for e in log if e[1] is not None), log
        assert int(log[-1][1]) < SHUTTER_MAX_MS
        states = [e[2] for e in log]
        assert "running" in states and "done" in states[states.index("running"):], f"shutter states {states}"
        bar = p.get_by_role("region", name="Book bar")
        see(p, bar, "Book bar")
        before = bar.bounding_box()
        p.evaluate(f"() => window.scrollBy(0, {SCROLL_PX})")
        assert p.evaluate("() => window.scrollY") > 0, "the ride page did not scroll"
        after = bar.bounding_box()
        for box in (before, after):
            assert abs(box["y"] + box["height"] - PHONE["height"]) <= 1, f"Book bar not at viewport bottom: {box}"
        p.reload()
        see(p, heading, "direct load")
        for _, st in motion_states(p, "shutter-reveal"):
            assert st == "done", f"a direct load shows shutter-reveal {st}"
    with opened(browser, app_url, "/my-rides?tab=upcoming", w.s("lune"), viewport=PHONE, touch=True) as p:
        upcoming, past = p.get_by_role("tab", name="Upcoming"), p.get_by_role("tab", name="Past")
        eventually(p, lambda: expect(upcoming).to_have_attribute("aria-selected", "true", timeout=PROBE_MS), "Upcoming")
        panel = p.get_by_role("tabpanel")
        x, y = center(panel.bounding_box())
        touch_drag(p, x + TAB_SWIPE_PX / 2, y, x - TAB_SWIPE_PX / 2, y)
        eventually(p, lambda: expect(past).to_have_attribute("aria-selected", "true", timeout=PROBE_MS), "swipe to Past")
        eventually(p, lambda: ensure(query(p.url).get("tab") == ["past"], p.url), "tab=past in URL")
        p.reload()
        eventually(p, lambda: expect(past).to_have_attribute("aria-selected", "true", timeout=PROBE_MS), "reload keeps Past")
        x, y = center(p.get_by_role("tabpanel").bounding_box())
        touch_drag(p, x - TAB_SWIPE_PX / 2, y, x + TAB_SWIPE_PX / 2, y)
        eventually(p, lambda: expect(upcoming).to_have_attribute("aria-selected", "true", timeout=PROBE_MS), "back")
        eventually(p, lambda: ensure(query(p.url).get("tab") == ["upcoming"], p.url), "tab=upcoming in URL")


def test_wf_search_phone_reduced_touch(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("r", "mara", at(day, 8, 30))])
    board = at(day, 8, 30) + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
    name = f"{hhmm(board)} Brisanne to Tollemarch, 3 seats left, {euros(seg_price(WHOLE_PRICE, ROUTE, 'Brisanne', 'Tollemarch'))}"
    with opened(browser, app_url, search_path("Brisanne", "Tollemarch", day), w.s("lune"), viewport=PHONE,
                touch=True, reduced=True) as p:
        assert p.evaluate("() => document.documentElement.getAttribute('data-motion-pref')") == "reduced"
        link = entry_link(p, w.rides["r"], name)
        see(p, link, "result")
        p.evaluate(MOTION_LOG)
        tap(link)
        focused(p, p.get_by_role("heading", level=1, name=f"Kestrevel to Tollemarch, {ddd(day)}"), "heading focus")
        for e in motion_log(p, "shutter-reveal"):
            assert e[1] in (None, "0") and e[2] != "running", f"reduced shutter published {e}"
        boarding = p.get_by_role("slider", name="Boarding stop")
        alighting = p.get_by_role("slider", name="Alighting stop")
        value_is(p, boarding, "Brisanne", "Leg Span starts on the searched span")
        p.get_by_role("group", name="Leg Span").scroll_into_view_if_needed()
        xb, yb = center(boarding.bounding_box())
        xt, _ = center(alighting.bounding_box())
        xk = xb - (xt - xb) * km("Kestrevel", "Brisanne") / km("Brisanne", "Tollemarch")
        touch_drag(p, xb, yb, xk, yb)
        value_is(p, boarding, "Kestrevel", "touch release snapped boarding to Kestrevel")
        announced(p, f"Kestrevel to Tollemarch, {route_km(ROUTE)} km, 3 seats free, {euros(WHOLE_PRICE)}")


def test_wf_instant_book_live_happy(browser: Browser, app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30))])
    price = seg_price(WHOLE_PRICE, ROUTE, "Brisanne", "Tollemarch")
    path = f"/rides/{w.rides['r']}"
    with opened(browser, app_url, path, w.s("mara")) as d, opened(browser, app_url, path, w.s("lune")) as p:
        seat_bands(d, ["Seat 1: free from Kestrevel to Tollemarch"], "driver before")
        keep_marker(d)
        press(p, p.get_by_role("slider", name="Boarding stop"), "ArrowRight")
        announced(p, f"Brisanne to Tollemarch, {span_km(ROUTE, 'Brisanne', 'Tollemarch')} km, 3 seats free, {euros(price)}")
        press(p, p.get_by_role("button", name="Book", exact=True), "Enter")
        dialog = p.get_by_role("dialog", name="Confirm your seat")
        see(p, dialog, "Book opened Confirm your seat")
        seat_bands(d, [band_name(1, ["free", "taken", "taken"], ROUTE)], "driver sees the hold live")
        press(p, dialog.get_by_role("button", name="Confirm and pay"), "Enter")
        hidden(p, dialog, "confirm closed the dialog")
        yours = p.get_by_role("region", name="Your booking")
        focused(p, yours.get_by_role("heading", name="Seat booked"), "focus on Seat booked")
        expect(yours.get_by_role("link", name="Open your booking")).to_be_visible()
        announced(p, f"Seat booked: Brisanne to Tollemarch, {ddd(day)}. {euros(price)} paid from your wallet.")
        announced(d, f"Seat booked by {w.names['lune']}: Brisanne to Tollemarch. 2 seats left.")
        assert_no_reload(d)
    label = f"Seat booked: Brisanne to Tollemarch, {ddd(day)}"
    wl = wallet(w, "lune")
    assert [l["amount_cents"] for l in wl["lines"] if l["label"] == label] == [-price]
    assert wl["balance_cents"] == WALLET_CENTS - price
    m = exactly(mail, w.emails["lune"], label)
    assert f"{euros(price)} was paid from your Longseat wallet." in text(m[0])
    seat1 = next(s for s in get_ride(w, "r", "mara")["seat_map"] if s["seat"] == 1)
    assert seat1["legs"] == ["free", "taken", "taken"]


def test_wf_instant_book_live_leg_span(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "tobin": {"roles": ["passenger"]}, "lune": {"roles": ["passenger"]}},
             rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("b", "r", "tobin", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    sp = lambda a, b: seg_price(WHOLE_PRICE, ROUTE, a, b)
    with opened(browser, app_url, f"/rides/{w.rides['r']}", w.s("lune")) as p:
        seat_bands(p, [band_name(1, ["taken", "free", "free"], ROUTE), "Seat 2: free from Kestrevel to Tollemarch",
                       "Seat 3: free from Kestrevel to Tollemarch"], "bands before")
        boarding, alighting = p.get_by_role("slider", name="Boarding stop"), p.get_by_role("slider", name="Alighting stop")
        value_is(p, boarding, "Kestrevel", "whole route on direct load")
        value_is(p, alighting, "Tollemarch", "whole route on direct load")
        settle = MOTION["handle-snap"] * 2
        xs = {"Kestrevel": center(boarding.bounding_box())[0], "Tollemarch": center(alighting.bounding_box())[0]}
        for city in ("Brisanne", "Oakhythe"):
            press(p, boarding, "ArrowRight")
            value_is(p, boarding, city, f"ArrowRight moved boarding to {city}")
            advance(p, settle)
            xs[city] = center(boarding.bounding_box())[0]
        announced(p, f"Oakhythe to Tollemarch, {span_km(ROUTE, 'Oakhythe', 'Tollemarch')} km, 3 seats free, {euros(sp('Oakhythe', 'Tollemarch'))}")
        k, b, o, t = (xs[c] for c in ROUTE)
        assert k < b < o < t and (o - b) < (b - k) < (t - o), f"stops not placed by km: {xs}"
        p.keyboard.press("End")
        p.keyboard.press("ArrowRight")
        value_is(p, boarding, "Oakhythe", "boarding never reaches alighting")
        press(p, alighting, "ArrowLeft")
        value_is(p, alighting, "Tollemarch", "a crossing move does nothing")
        press(p, boarding, "Home")
        announced(p, f"Kestrevel to Tollemarch, {route_km(ROUTE)} km, 2 seats free, {euros(WHOLE_PRICE)}")
        press(p, alighting, "Home")
        value_is(p, alighting, "Brisanne", "Home took alighting to the nearest allowed stop")
        announced(p, f"Kestrevel to Brisanne, {km('Kestrevel', 'Brisanne')} km, 2 seats free, {euros(sp('Kestrevel', 'Brisanne'))}")
        seats = p.get_by_role("spinbutton", name="Seats", exact=True)
        press(p, seats, "ArrowUp")
        says(p, p.get_by_role("region", name="Book bar"), euros(2 * sp("Kestrevel", "Brisanne")), "Book bar price")
        p.keyboard.press("ArrowUp")
        announced(p, "Seats: 2. This is the most.")
        advance(p, settle)
        p.get_by_role("group", name="Leg Span").scroll_into_view_if_needed()
        x0, y0 = center(alighting.bounding_box())
        p.mouse.move(x0, y0)
        p.mouse.down()
        p.mouse.move(t, y0, steps=8)
        p.mouse.up()
        value_is(p, alighting, "Tollemarch", "drag release snapped to Tollemarch")
        announced(p, f"Kestrevel to Tollemarch, {route_km(ROUTE)} km, 2 seats free, {euros(2 * WHOLE_PRICE)}")


def test_instant_booking_api(app_url: str, mail: Any, valkey: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "tobin": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "idris": {"roles": ["passenger"], "wallet": TOP_UP_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30))])
    price = seg_price(WHOLE_PRICE, ROUTE, "Brisanne", "Tollemarch")
    fails(w.api("POST", f"/api/rides/{w.rides['r']}/bookings", "lune", body={"boarding": "Brisanne", "alighting": "Tollemarch",
          "seats": 1, "ride_version": 1}), 422, "validation_failed")
    key = idempotency_key()
    first = attempt(w, "lune", "r", "Brisanne", "Tollemarch", key=key)
    b = ok(first, 201, "hold")
    assert b["state"] == "held" and b["seat_numbers"] == [1] and b["price_cents"] == price
    held_at = parse(next(h["at"] for h in b["history"] if h["state"] == "held"))
    assert parse(b["hold_expires_at"]) - held_at == timedelta(seconds=SEAT_HOLD_SECONDS)
    again = attempt(w, "lune", "r", "Brisanne", "Tollemarch", key=key)
    assert again.status_code == 201 and again.json()["id"] == b["id"] and again.headers.get("Idempotent-Replay") == "true"
    fails(attempt(w, "lune", "r", "Brisanne", "Tollemarch", 2, key=key), 409, "idempotency_conflict",
          "This request was already sent with different details.")
    for leg in get_ride(w, "r", "lune")["legs"][1:]:
        k = f"longseat:hold:{w.rides['r']}:{leg['index']}:1"
        assert valkey.command("GET", k) == b["id"] and 0 < valkey.ttl(k) <= SEAT_HOLD_SECONDS, k
    ckey = idempotency_key()
    c1 = ok(w.api("POST", f"/api/bookings/{b['id']}/confirm", "lune", key=ckey), 200, "confirm")
    c2 = w.api("POST", f"/api/bookings/{b['id']}/confirm", "lune", key=ckey)
    assert c1["state"] == "confirmed" and c2.status_code == 200 and c2.json()["state"] == "confirmed"
    label = f"Seat booked: Brisanne to Tollemarch, {ddd(day)}"
    wl = wallet(w, "lune")
    assert wl["balance_cents"] == WALLET_CENTS - price and [l["label"] for l in wl["lines"]].count(label) == 1
    pays = [e for e in ledger(w, "lune", b["id"]) if accounts(e).get(f"held:{b['id']}") == price]
    assert len(pays) == 1 and accounts(pays[0])[f"wallet:{w.id('lune')}"] == -price
    exactly(mail, w.emails["lune"], label)
    t = ok(attempt(w, "tobin", "r", "Kestrevel", "Brisanne"), 201, "second hold")
    clock(app_url, SEAT_HOLD_SECONDS + 1)
    late = w.api("POST", f"/api/bookings/{t['id']}/confirm", "tobin", key=idempotency_key())
    assert late.status_code == 409 and late.json().get("error") in ("hold_expired", "invalid_transition"), late.text
    assert get_booking(w, t["id"], "tobin")["state"] == "expired" and wallet(w, "tobin")["balance_cents"] == WALLET_CENTS
    poor = attempt(w, "idris", "r", "Brisanne", "Tollemarch", 1)
    fails(poor, 422, "insufficient_funds", f"Your wallet has {euros(TOP_UP_CENTS)}. Add money to book this seat.")
    seat2 = next(s for s in get_ride(w, "r", "mara")["seat_map"] if s["seat"] == 2)
    assert seat2["legs"] == ["free", "free", "free"], "a refused booking took a seat"


def test_wf_request_approve_expire_accept(browser: Browser, app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"idris": {"car": 4}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("q", "idris", at(day, 14, 0), stops=REQUEST_ROUTE, seats=4, price=REQUEST_PRICE, mode="request")])
    path = f"/rides/{w.rides['q']}"
    with opened(browser, app_url, path, w.s("idris")) as d, \
            opened(browser, app_url, path, w.s("lune"), device_time=now - timedelta(days=5)) as p:
        press(p, p.get_by_role("button", name="Request to book"), "Enter")
        panel = p.get_by_role("region", name="Your request")
        see(p, panel, "Your request replaced the button")
        b = poll(app_url, lambda: ok(w.api("GET", f"/api/rides/{w.rides['q']}/bookings", "idris"), 200, "ride bookings")["bookings"],
                 lambda rows: len(rows) == 1, "request stored")[0]
        assert b["state"] == "requested"
        exp = parse(b["expires_at"])
        says(p, panel, f"Waiting for {w.names['idris']} to answer. This request expires at {hhmm(exp)} on {ddd(exp)} (",
             "server expiry shown")
        says(p, panel, re.compile(r"\((11|12) h \d+ min left\)\."), "time left comes from the server")
        announced(d, f"New request from {w.names['lune']}: Vardholm to Hesketh Mere.")
        press(d, d.get_by_role("button", name=f"Accept {w.names['lune']}", exact=True), "Enter")
        focused(d, d.get_by_role("region", name="Requests").get_by_role("heading"), "focus to Requests heading")
        announced(p, f"Request accepted by {w.names['idris']}.")
    got = get_booking(w, b["id"], "lune")
    assert got["state"] == "confirmed" and {"accepted", "confirmed"} <= {h["state"] for h in got["history"]}
    label = f"Seat requested: Vardholm to Hesketh Mere, {ddd(day)}"
    assert [l["amount_cents"] for l in wallet(w, "lune")["lines"] if l["label"] == label] == [-REQUEST_PRICE]
    m = exactly(mail, w.emails["lune"], "Your request was accepted")
    assert f"{w.names['idris']} accepted your request: Vardholm to Hesketh Mere, {ddd(day)}." in text(m[0])


def test_wf_request_approve_expire_expired(browser: Browser, app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"idris": {"car": 4}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("q", "idris", at(day, 14, 0), stops=REQUEST_ROUTE, seats=4, price=REQUEST_PRICE, mode="request")],
             bookings=[booking("b", "q", "lune", "Vardholm", "Hesketh Mere", state="requested",
                               created=now - timedelta(hours=REQUEST_EXPIRY_HOURS) + timedelta(seconds=30))])
    bid = w.bookings["b"]
    with opened(browser, app_url, f"/bookings/{bid}", w.s("lune")) as p:
        panel = p.get_by_role("region", name="Your request")
        says(p, panel, f"Waiting for {w.names['idris']} to answer.", "request is waiting")
        clock(app_url, SECONDS_PER_MINUTE)
        see(p, panel.get_by_role("heading", name="This request expired"), "expiry heading live")
        says(p, panel, f"{euros(REQUEST_PRICE)} is back in your wallet.", "refund line")
        announced(p, "This request expired")
    assert get_booking(w, bid, "lune")["state"] == "expired"
    assert wallet(w, "lune")["balance_cents"] == WALLET_CENTS
    m = exactly(mail, w.emails["lune"], "Your request expired")
    assert f"{euros(REQUEST_PRICE)} is back in your Longseat wallet." in text(m[0])


def test_request_decisions_api(app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"idris": {"car": 4}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "tobin": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "wren": {"roles": ["passenger"], "wallet": WALLET_CENTS}, "stranger": {"car": 3}},
             rides=[ride("q", "idris", at(day, 14, 0), stops=REQUEST_ROUTE, seats=4, price=REQUEST_PRICE, mode="request")],
             bookings=[booking(k, "q", who, "Vardholm", "Hesketh Mere", state="requested", created=now - timedelta(hours=1))
                       for k, who in (("a", "lune"), ("d", "tobin"), ("x", "wren"))])
    a, d, x = w.bookings["a"], w.bookings["d"], w.bookings["x"]
    fails(w.api("POST", f"/api/bookings/{a}/accept", "stranger"), 404, "not_found", NOT_FOUND)
    fails(w.api("POST", f"/api/bookings/{a}/accept", "lune"), 403, "forbidden", NO_ACCESS)
    assert ok(w.api("POST", f"/api/bookings/{a}/accept", "idris"), 200, "accept")["state"] == "confirmed"
    done = "This was already decided."
    fails(w.api("POST", f"/api/bookings/{a}/accept", "idris"), 409, "already_decided", done)
    fails(w.api("POST", f"/api/bookings/{a}/decline", "idris"), 409, "already_decided", done)
    assert ok(w.api("POST", f"/api/bookings/{d}/decline", "idris"), 200, "decline")["state"] == "declined"
    fails(w.api("POST", f"/api/bookings/{d}/accept", "idris"), 409, "already_decided", done)
    assert wallet(w, "tobin")["balance_cents"] == WALLET_CENTS
    label = f"Request declined: Vardholm to Hesketh Mere, {ddd(day)}"
    assert [l["amount_cents"] for l in wallet(w, "tobin")["lines"] if l["label"] == label] == [REQUEST_PRICE]
    release = [e for e in ledger(w, "tobin", d) if accounts(e).get(f"held:{d}") == -REQUEST_PRICE]
    assert len(release) == 1 and accounts(release[0])[f"wallet:{w.id('tobin')}"] == REQUEST_PRICE
    m = exactly(mail, w.emails["tobin"], "Your request was declined")
    assert f"{euros(REQUEST_PRICE)} is back in your Longseat wallet." in text(m[0])
    assert ok(w.api("POST", f"/api/bookings/{x}/withdraw", "wren"), 200, "withdraw")["state"] == "withdrawn"
    assert wallet(w, "wren")["balance_cents"] == WALLET_CENTS
    taken = sum(leg == "taken" for s in get_ride(w, "q", "idris")["seat_map"] for leg in s["legs"][:1])
    assert taken == 1, "declined and withdrawn requests still hold seats"


def test_request_expiry_edges(app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    near = floor_minute(now + timedelta(minutes=90))
    w = seed(app_url, {"idris": {"car": 4}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "tobin": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "wren": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("q", "idris", at(day, 14, 0), stops=REQUEST_ROUTE, seats=4, price=REQUEST_PRICE, mode="request"),
                    ride("n", "idris", near, stops=REQUEST_ROUTE, seats=4, price=REQUEST_PRICE, mode="request")],
             bookings=[booking("before", "q", "lune", "Vardholm", "Hesketh Mere", state="requested",
                               created=now - timedelta(hours=REQUEST_EXPIRY_HOURS) + timedelta(seconds=300)),
                       booking("late", "q", "tobin", "Vardholm", "Hesketh Mere", state="requested",
                               created=now - timedelta(hours=REQUEST_EXPIRY_HOURS)),
                       booking("cut", "n", "wren", "Vardholm", "Hesketh Mere", state="requested",
                               created=now - timedelta(minutes=1))])
    assert ok(w.api("POST", f"/api/bookings/{w.bookings['before']}/accept", "idris"), 200, "accept before")["state"] == "confirmed"
    late = w.bookings["late"]
    fails(w.api("POST", f"/api/bookings/{late}/accept", "idris"), 409, "request_expired",
          "This request expired before you answered it.")
    assert get_booking(w, late, "tobin")["state"] == "expired" and wallet(w, "tobin")["balance_cents"] == WALLET_CENTS
    exactly(mail, w.emails["tobin"], "Your request expired")
    cut = get_booking(w, w.bookings["cut"], "wren")
    deadline = near - timedelta(minutes=REQUEST_CUTOFF_MINUTES)
    assert parse(cut["expires_at"]) == deadline, f"expires_at {cut['expires_at']}; expected boarding minus 60 min"
    assert 0 < cut["expires_in_seconds"] <= REQUEST_CUTOFF_MINUTES * SECONDS_PER_MINUTE // 2 and "server_now" in cut
    clock(app_url, math.ceil((deadline - server_now(app_url)).total_seconds()))
    poll(app_url, lambda: get_booking(w, w.bookings["cut"], "wren"), lambda b: b["state"] == "expired",
         "the sweep expired the request at its cutoff deadline")
    assert wallet(w, "wren")["balance_cents"] == WALLET_CENTS
    assert get_booking(w, w.bookings["cut"], "wren")["expires_in_seconds"] == 0


def test_wf_last_seat_race_two_pages(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "tobin": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30), seats=1)])
    path = f"/rides/{w.rides['r']}"
    glob = "**/api/rides/*/bookings"
    with opened(browser, app_url, path, w.s("lune")) as pa, opened(browser, app_url, path, w.s("tobin")) as pb:
        press(pa, pa.get_by_role("slider", name="Alighting stop"), "ArrowLeft")
        value_is(pa, pa.get_by_role("slider", name="Alighting stop"), "Oakhythe", "A spans Kestrevel to Oakhythe")
        press(pb, pb.get_by_role("slider", name="Boarding stop"), "ArrowRight")
        value_is(pb, pb.get_by_role("slider", name="Boarding stop"), "Brisanne", "B spans Brisanne to Tollemarch")
        with held(pa, glob) as ha, held(pb, glob) as hb:
            press(pa, pa.get_by_role("button", name="Book", exact=True), "Enter")
            press(pb, pb.get_by_role("button", name="Book", exact=True), "Enter")
            for pg in (pa, pb):
                says(pg, pg.get_by_role("region", name="Book bar"), "Working", "pending state while held")
            ha.release()
            hb.release()
        dialogs = {pg: pg.get_by_role("dialog", name="Confirm your seat") for pg in (pa, pb)}
        eventually([pa, pb], lambda: ensure(sum(d.is_visible() for d in dialogs.values()) == 1, "dialogs"),
                   "exactly one page got the seat hold")
        winner = pa if dialogs[pa].is_visible() else pb
        loser = pb if winner is pa else pa
        see(loser, loser.get_by_role("alert").filter(has_text=SEAT_TAKEN), "loser sees the seat-taken alert")
        expect(dialogs[loser]).to_be_hidden()
        legs = ["taken", "taken", "free"] if winner is pa else ["free", "taken", "taken"]
        seat_bands(loser, [band_name(1, legs, ROUTE)], "loser's bands redrawn")
        eventually(loser, lambda: expect(loser.get_by_role("button", name="Book", exact=True)).to_be_disabled(timeout=PROBE_MS),
                   "loser's Book is disabled with the selection cleared")
    rows = ok(w.api("GET", f"/api/rides/{w.rides['r']}/bookings", "mara"), 200, "ride bookings")["bookings"]
    assert [r["state"] for r in rows] == ["held"], f"expected exactly one hold, got {[r['state'] for r in rows]}"
    assert rows[0]["passenger"]["id"] == w.id("lune" if winner is pa else "tobin")


def test_last_seat_race_api(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    racers = [f"p{i}" for i in range(6)]
    w = seed(app_url, {"mara": {"car": 3}, **{k: {"roles": ["passenger"], "wallet": WALLET_CENTS} for k in racers}},
             rides=[ride("i", "mara", at(day, 8, 30), seats=1), ride("q", "mara", at(day, 9, 0), seats=1, mode="request")])
    for rk in ("i", "q"):
        version = get_ride(w, rk, "mara")["version"]
        barrier = threading.Barrier(len(racers))
        out: dict[str, httpx.Response] = {}

        def run(who: str, span: tuple[str, str]) -> None:
            barrier.wait()
            out[who] = attempt(w, who, rk, *span, version=version)

        threads = [threading.Thread(target=run, args=(k, ("Kestrevel", "Oakhythe") if i % 2 else ("Brisanne", "Tollemarch")))
                   for i, k in enumerate(racers)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=HTTP_TIMEOUT * 2)
        wins = [k for k, r in out.items() if r.status_code == 201]
        assert len(out) == len(racers) and len(wins) == 1, f"{rk}: {[(k, r.status_code) for k, r in out.items()]}"
        for k, r in out.items():
            if k not in wins:
                fails(r, 409, "seat_taken", SEAT_TAKEN)
        seat = get_ride(w, rk, "mara")["seat_map"]
        assert len(seat) == 1 and seat[0]["legs"][1] == "taken"
        if rk == "q":
            for k in racers:
                bal = wallet(w, k)["balance_cents"]
                span = ("Kestrevel", "Oakhythe") if racers.index(k) % 2 else ("Brisanne", "Tollemarch")
                assert bal == (WALLET_CENTS - seg_price(WHOLE_PRICE, ROUTE, *span) if k in wins else WALLET_CENTS), \
                    f"{k} balance {bal}"


def test_wf_last_seat_race_rate_limit(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30))])
    for _ in range(REQUEST_RATE_PER_HOUR):
        b = ok(attempt(w, "lune", "r", "Kestrevel", "Brisanne"), 201, "attempt")
        ok(w.api("POST", f"/api/bookings/{b['id']}/release", "lune"), 200, "release")
    copy = re.compile(rf"You have made {REQUEST_RATE_PER_HOUR} booking requests in the last hour\. Try again in (\d+) minutes\.")
    with opened(browser, app_url, f"/rides/{w.rides['r']}", w.s("lune")) as p:
        press(p, p.get_by_role("button", name="Book", exact=True), "Enter")
        alert = p.get_by_role("alert").filter(has_text=copy)
        see(p, alert, "the wait copy appears beside Book")
        m = int(copy.search(alert.first.inner_text()).group(1))
        assert 1 <= m <= LIMIT_WINDOW_SECONDS // SECONDS_PER_MINUTE
        expect(p.get_by_role("dialog", name="Confirm your seat")).to_have_count(0)
    rows = ok(w.api("GET", f"/api/rides/{w.rides['r']}/bookings", "mara"), 200, "bookings")["bookings"]
    assert len(rows) == REQUEST_RATE_PER_HOUR and all(r["state"] == "expired" for r in rows)


def test_booking_attempt_limit_api(app_url: str, valkey: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30))])
    first_key = idempotency_key()
    first = ok(attempt(w, "lune", "r", "Kestrevel", "Brisanne", key=first_key), 201, "first")
    fails(attempt(w, "lune", "r", "Kestrevel", "Brisanne", version=99), 409, "ride_changed")
    for _ in range(REQUEST_RATE_PER_HOUR - 2):
        ok(attempt(w, "lune", "r", "Brisanne", "Oakhythe"), 201, "attempt")
    assert valkey.command("ZCARD", f"longseat:rate:requests:{w.id('lune')}") == REQUEST_RATE_PER_HOUR
    replay = attempt(w, "lune", "r", "Kestrevel", "Brisanne", key=first_key)
    assert replay.status_code == 201 and replay.json()["id"] == first["id"], "replay was refused or counted"
    pattern = re.compile(rf"You have made {REQUEST_RATE_PER_HOUR} booking requests in the last hour\. Try again in (\d+) minutes\.")
    for _ in range(2):
        r = attempt(w, "lune", "r", "Oakhythe", "Tollemarch")
        body = fails(r, 429, "rate_limited", pattern)
        retry = int(r.headers["Retry-After"])
        assert 1 <= retry <= LIMIT_WINDOW_SECONDS
        assert int(pattern.fullmatch(body["message"]).group(1)) == math.ceil(retry / SECONDS_PER_MINUTE)
    rows = ok(w.api("GET", f"/api/rides/{w.rides['r']}/bookings", "mara"), 200, "bookings")["bookings"]
    assert len(rows) == REQUEST_RATE_PER_HOUR - 1, "a refused attempt wrote a booking"
    clock(app_url, LIMIT_WINDOW_SECONDS)
    ok(attempt(w, "lune", "r", "Oakhythe", "Tollemarch"), 201, "after the window slides")


def test_wf_segment_seats_concurrent_halves(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "tobin": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30), seats=1)])
    path = f"/rides/{w.rides['r']}"
    with opened(browser, app_url, path, w.s("lune")) as pa, opened(browser, app_url, path, w.s("tobin")) as pb:
        press(pa, pa.get_by_role("slider", name="Alighting stop"), "ArrowLeft", "ArrowLeft")
        value_is(pa, pa.get_by_role("slider", name="Alighting stop"), "Brisanne", "A spans Kestrevel to Brisanne")
        announced(pa, re.compile(re.escape(f"Kestrevel to Brisanne, {span_km(ROUTE, 'Kestrevel', 'Brisanne')} km, 1 ")
                                 + r"seats? free, " + re.escape(euros(seg_price(WHOLE_PRICE, ROUTE, "Kestrevel", "Brisanne")))))
        press(pb, pb.get_by_role("slider", name="Boarding stop"), "ArrowRight")
        value_is(pb, pb.get_by_role("slider", name="Boarding stop"), "Brisanne", "B spans Brisanne to Tollemarch")
        announced(pb, re.compile(re.escape(f"Brisanne to Tollemarch, {span_km(ROUTE, 'Brisanne', 'Tollemarch')} km, 1 ")
                                 + r"seats? free, " + re.escape(euros(seg_price(WHOLE_PRICE, ROUTE, "Brisanne", "Tollemarch")))))
        rolls = motion_states(pb, "price-roll")
        assert rolls and all(ms == str(MOTION["price-roll"]) for ms, _ in rolls), f"price-roll publishes {rolls}"
        advance(pb, MOTION["price-roll"] * 2)
        eventually(pb, lambda: ensure(all(st == "done" for _, st in motion_states(pb, "price-roll")), "still running"),
                   "price-roll reached done")
        with held(pa, "**/api/rides/*/bookings") as ha, held(pb, "**/api/rides/*/bookings") as hb:
            press(pa, pa.get_by_role("button", name="Book", exact=True), "Enter")
            press(pb, pb.get_by_role("button", name="Book", exact=True), "Enter")
            ha.release()
            hb.release()
        for pg in (pa, pb):
            dialog = pg.get_by_role("dialog", name="Confirm your seat")
            see(pg, dialog, "both halves got a hold")
            press(pg, dialog.get_by_role("button", name="Confirm and pay"), "Enter")
            see(pg, pg.get_by_role("region", name="Your booking"), "both confirmed")
        seat_bands(pa, [band_name(1, ["taken"] * 3, ROUTE)], "A sees B's half filled live")
        seat_bands(pb, [band_name(1, ["taken"] * 3, ROUTE)], "B sees A's half filled live")
        rows = ok(w.api("GET", f"/api/rides/{w.rides['r']}/bookings", "mara"), 200, "bookings")["bookings"]
        assert sorted((r["boarding"], r["state"], tuple(r["seat_numbers"])) for r in rows) == [
            ("Brisanne", "confirmed", (1,)), ("Kestrevel", "confirmed", (1,))]
        assert get_ride(w, "r", "mara")["seat_map"][0]["legs"] == ["taken"] * 3
        mine = next(r for r in rows if r["boarding"] == "Kestrevel")
        ok(w.api("POST", f"/api/bookings/{mine['id']}/cancel", "lune", key=idempotency_key()), 200, "cancel")
        seat_bands(pb, [band_name(1, ["free", "taken", "taken"], ROUTE)], "only Kestrevel to Brisanne frees, live")
    assert get_ride(w, "r", "mara")["seat_map"][0]["legs"] == ["free", "taken", "taken"]


def test_per_leg_seat_accounting(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    who = ["a", "b", "c", "d", "e"]
    w = seed(app_url, {"mara": {"car": 3}, **{k: {"roles": ["passenger"], "wallet": WALLET_CENTS} for k in who}},
             rides=[ride("r", "mara", at(day, 8, 30))])
    pa = booked(w, "a", "r", "Kestrevel", "Brisanne")
    pb = booked(w, "b", "r", "Brisanne", "Tollemarch", 2)
    pc = ok(attempt(w, "c", "r", "Kestrevel", "Oakhythe"), 201, "c hold")
    pd = ok(attempt(w, "d", "r", "Oakhythe", "Tollemarch"), 201, "d hold")
    assert (pa["seat_numbers"], pb["seat_numbers"], pc["seat_numbers"], pd["seat_numbers"]) == ([1], [1, 2], [3], [3])
    fails(attempt(w, "e", "r", "Kestrevel", "Brisanne", 2), 409, "seat_taken", SEAT_TAKEN)
    assert booked(w, "e", "r", "Kestrevel", "Brisanne")["seat_numbers"] == [2]
    seats = get_ride(w, "r", "mara")["seat_map"]
    assert all(sum(s["legs"][i] == "taken" for s in seats) <= 3 for i in range(3))
    ok(w.api("POST", f"/api/bookings/{pb['id']}/cancel", "b", key=idempotency_key()), 200, "cancel b")
    ok(w.api("POST", f"/api/bookings/{pd['id']}/release", "d"), 200, "release d")
    by_seat = {s["seat"]: s["legs"] for s in get_ride(w, "r", "mara")["seat_map"]}
    assert by_seat == {1: ["taken", "free", "free"], 2: ["taken", "free", "free"], 3: ["taken", "taken", "free"]}, by_seat


def test_wf_segment_seats_same_figure(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30))])
    price = seg_price(WHOLE_PRICE, ROUTE, "Brisanne", "Tollemarch")
    board = at(day, 8, 30) + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
    with opened(browser, app_url, search_path("Brisanne", "Tollemarch", day), w.s("lune")) as p:
        link = entry_link(p, w.rides["r"], f"{hhmm(board)} Brisanne to Tollemarch, 3 seats left, {euros(price)}")
        see(p, link, "search shows the segment price")
        press(p, link, "Enter")
        value_is(p, p.get_by_role("slider", name="Boarding stop"), "Brisanne", "Leg Span opens on the searched span")
        says(p, p.get_by_role("region", name="Book bar"), euros(price), "Book bar shows the segment price")
        press(p, p.get_by_role("button", name="Book", exact=True), "Enter")
        dialog = p.get_by_role("dialog", name="Confirm your seat")
        see(p, dialog, "confirm dialog")
        press(p, dialog.get_by_role("button", name="Confirm and pay"), "Enter")
        see(p, p.get_by_role("region", name="Your booking"), "booked")
        p.goto(f"{app_url}/wallet")
        says(p, p.get_by_role("list", name="Wallet"), f"Seat booked: Brisanne to Tollemarch, {ddd(day)} {signed(-price)}",
             "wallet line carries the segment price")
    rows = ok(w.api("GET", f"/api/driver/earnings?month={month_key(day)}", "mara"), 200, "earnings")["rows"]
    assert [r["paid_cents"] for r in rows] == [price]
    with opened(browser, app_url, f"/earnings?month={month_key(day)}", w.s("mara")) as d:
        says(d, entry(d, rows[0]["booking_id"]), euros(price), "earnings row shows the same price")
    b = get_booking(w, rows[0]["booking_id"], "lune")
    assert b["price_cents"] == price and b["segment_km"] == span_km(ROUTE, "Brisanne", "Tollemarch")


def test_wf_live_chat_happy(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("b", "r", "lune", "Brisanne", "Tollemarch", created=now - timedelta(hours=1))])
    bid, mara, lune = w.bookings["b"], w.names["mara"], w.names["lune"]
    with opened(browser, app_url, f"/bookings/{bid}", w.s("mara")) as d:
        see(d, d.get_by_role("heading", level=1, name=f"{lune}: Brisanne to Tollemarch, {ddd(day)}"), "driver heading")
        see(d, d.get_by_text(f"{lune} has not opened this thread yet"), "presence before the passenger opens it")
        with opened(browser, app_url, f"/bookings/{bid}", w.s("lune")) as p:
            see(p, p.get_by_role("heading", level=1, name=f"Your seat: Brisanne to Tollemarch, {ddd(day)}"), "passenger heading")
            see(d, d.get_by_text(f"{lune} is online"), "driver sees the passenger online")
            box = d.get_by_role("textbox", name=f"Message {lune}")
            box.focus()
            d.keyboard.type("Is there room")
            d.keyboard.press("Shift+Enter")
            d.keyboard.type("for a rucksack?")
            d.keyboard.press("Enter")
            eventually(d, lambda: expect(box).to_have_value("", timeout=PROBE_MS), "text box empties after send")
            says(p, p.get_by_role("log", name=f"Messages with {mara}"), "for a rucksack?", "message arrives live")
            announced(p, f"New message from {mara}")
        see(d, d.get_by_text(re.compile(rf"{re.escape(lune)} was online at \d{{2}}:\d{{2}}")), "last seen after close")
    msgs = ok(w.api("GET", f"/api/bookings/{bid}/messages", "lune"), 200, "messages")["messages"]
    assert [m["body"] for m in msgs] == ["Is there room\nfor a rucksack?"] and msgs[0]["author_id"] == w.id("mara")


def test_wf_live_chat_rate_limit(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("b", "r", "lune", "Brisanne", "Tollemarch", created=now - timedelta(hours=1))])
    bid = w.bookings["b"]
    for i in range(MESSAGE_RATE_PER_MINUTE):
        ok(w.api("POST", f"/api/bookings/{bid}/messages", "lune", body={"body": f"Is there room {i}"}), 201, "message")
    copy = re.compile(r"You are sending messages too fast\. Try again in (\d+) seconds\.")
    with opened(browser, app_url, f"/bookings/{bid}", w.s("lune")) as p:
        box = p.get_by_role("textbox", name=f"Message {w.names['mara']}")
        box.focus()
        p.keyboard.type("Is there room for a rucksack?")
        p.keyboard.press("Enter")
        see(p, p.get_by_role("alert").filter(has_text=copy), "wait copy beside the box")
        expect(box).to_have_value("Is there room for a rucksack?")
    r = w.api("POST", f"/api/bookings/{bid}/messages", "lune", body={"body": "Is there room for a rucksack?"})
    body = fails(r, 429, "rate_limited", copy)
    retry = int(r.headers["Retry-After"])
    assert 1 <= retry <= MESSAGE_WINDOW_SECONDS and copy.fullmatch(body["message"]).group(1) == str(retry)
    msgs = ok(w.api("GET", f"/api/bookings/{bid}/messages", "lune"), 200, "messages")["messages"]
    assert len(msgs) == MESSAGE_RATE_PER_MINUTE, "a refused message was stored"
    ok(w.api("POST", f"/api/bookings/{bid}/messages", "mara", body={"body": "Is there room"}), 201, "driver unaffected")


def test_wf_live_chat_private(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}, "tobin": {"roles": ["passenger"]}},
             rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("b", "r", "lune", "Brisanne", "Tollemarch", created=now - timedelta(hours=1))],
             messages=[{"booking": "b", "author": "lune", "body": "Is there room for a rucksack?", "sent_at": iso(now - timedelta(minutes=30))}])
    bid = w.bookings["b"]
    with opened(browser, app_url, f"/bookings/{bid}", w.s("tobin")) as p:
        see(p, p.get_by_role("link", name="Longseat"), "page rendered")
        advance(p, STEP_MS)
        expect(p.get_by_text("Is there room for a rucksack?")).to_have_count(0)
        expect(p.get_by_role("log", name=f"Messages with {w.names['mara']}")).to_have_count(0)
    fails(w.api("GET", f"/api/bookings/{bid}/messages", "tobin"), 404, "not_found", NOT_FOUND)


def test_private_records_api(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "idris": {"car": 3}, "lune": {"roles": ["passenger"], "id_state": "pending"},
                       "tobin": {"roles": ["passenger"], "wallet": TOP_UP_CENTS}, "wren": {"roles": ["founder"]}},
             rides=[ride("r", "mara", at(day, 8, 30)), ride("x", "mara", at(day, 9, 0), state="cancelled")],
             bookings=[booking("b", "r", "lune", "Brisanne", "Tollemarch", created=now - timedelta(hours=1))],
             messages=[{"booking": "b", "author": "lune", "body": "Is there room for a rucksack?", "sent_at": iso(now - timedelta(minutes=30))}])
    bid = w.bookings["b"]
    doc = ok(w.api("GET", "/api/me/id-document", "lune"), 200, "own id doc")
    probes = [("GET", f"/api/bookings/{bid}", None, None), ("GET", f"/api/bookings/{bid}/ledger", None, None),
              ("GET", f"/api/bookings/{bid}/messages", None, None), ("GET", f"/api/bookings/{bid}/rating", None, None),
              ("POST", f"/api/bookings/{bid}/messages", {"body": "Is there room"}, None),
              ("POST", f"/api/bookings/{bid}/cancel", None, idempotency_key()),
              ("GET", f"/api/rides/{w.rides['x']}", None, None)]
    if doc.get("file_id"):
        probes.append(("GET", f"/api/files/{doc['file_id']}", None, None))
    for method, path, body, key in probes:
        fails(w.api(method, path, "tobin", body=body, key=key), 404, "not_found", NOT_FOUND)
    fails(w.api("POST", "/api/rides", "idris", body={"vehicle_id": w.vehicles["car-mara"], "stops": ROUTE,
          "departure": iso(at(day, 8, 30)), "seats": 3, "price_cents": WHOLE_PRICE, "booking_mode": "instant"}),
          404, "not_found", NOT_FOUND)
    assert get_booking(w, bid, "lune")["state"] == "confirmed"
    assert len(ok(w.api("GET", f"/api/bookings/{bid}/messages", "lune"), 200, "msgs")["messages"]) == 1
    ok(w.api("GET", f"/api/bookings/{bid}", "wren"), 200, "founder reads the booking")
    pub = ok(w.api("GET", f"/api/members/{w.id('lune')}", "tobin"), 200, "public member")
    assert "email" not in pub and "wallet_cents" not in pub
    assert wallet(w, "tobin")["balance_cents"] == TOP_UP_CENTS


def test_ride_versions(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30)), ride("c", "mara", at(day, 9, 0))])
    rid = w.rides["r"]
    fails(w.api("PATCH", f"/api/rides/{rid}", "mara", body={"seats": 2}), 422, "validation_failed")
    v2 = ok(w.api("PATCH", f"/api/rides/{rid}", "mara", body={"seats": 2}, headers={"If-Match": "1"}), 200, "edit")["ride"]
    assert v2["version"] == 2 and v2["state"] == "changed" and v2["seats"] == 2
    fails(w.api("PATCH", f"/api/rides/{rid}", "mara", body={"seats": 3}, headers={"If-Match": "1"}), 409, "edit_conflict",
          "This ride was changed in another window. Reload to see the latest version.")
    assert get_ride(w, "r", "mara")["seats"] == 2
    body = fails(attempt(w, "lune", "r", "Kestrevel", "Tollemarch", version=1), 409, "ride_changed",
                 "The driver changed this ride. Check the new times before booking.")
    assert body["ride"]["version"] == 2
    ok(attempt(w, "lune", "r", "Kestrevel", "Tollemarch", 2, version=2), 201, "book current version")
    assert get_ride(w, "r", "mara")["version"] == 2, "booking changed the version"
    r = w.api("PATCH", f"/api/rides/{rid}", "mara", body={"seats": 1}, headers={"If-Match": "2"})
    assert fails(r, 422, "validation_failed")["fields"]["seats"] == "Seats cannot go below the 2 already taken on one leg."
    r = w.api("PATCH", f"/api/rides/{w.rides['c']}", "mara", body={"seats": 4}, headers={"If-Match": "1"})
    assert fails(r, 422, "validation_failed")["fields"]["seats"] == "Seats cannot be more than the car has."
    r = w.api("PATCH", f"/api/rides/{rid}", "mara", body={"departure": iso(now - timedelta(hours=1))}, headers={"If-Match": "2"})
    assert fails(r, 422, "validation_failed")["fields"]["departure"] == "Choose a time later than now."
    ok(w.api("POST", f"/api/rides/{w.rides['c']}/cancel", "mara", key=idempotency_key()), 200, "cancel ride")
    current = str(get_ride(w, "c", "mara")["version"])
    fails(w.api("PATCH", f"/api/rides/{w.rides['c']}", "mara", body={"seats": 2}, headers={"If-Match": current}), 409,
          "invalid_transition")


def test_wf_ride_change_email_happy(browser: Browser, app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    dep = at(day, 8, 30)
    new = dep + timedelta(minutes=SHIFT_MINUTES)
    until = new - timedelta(hours=FREE_WINDOW_LEAD_HOURS)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}, "tobin": {"roles": ["passenger"]}},
             rides=[ride("r", "mara", dep)],
             bookings=[booking("a", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1)),
                       booking("b", "r", "tobin", "Kestrevel", "Oakhythe", created=now - timedelta(hours=1))])
    banner = f"Departure moved from {hhmm(dep)} to {hhmm(new)}. You can cancel for free until {hhmm(until)} on {ddd(until)}."
    with opened(browser, app_url, f"/rides/{w.rides['r']}", w.s("mara")) as d, \
            opened(browser, app_url, f"/bookings/{w.bookings['a']}", w.s("lune")) as pa, \
            opened(browser, app_url, f"/bookings/{w.bookings['b']}", w.s("tobin")) as pb:
        opener = d.get_by_role("button", name="Change departure")
        press(d, opener, "Enter")
        dialog = d.get_by_role("dialog", name="Change departure")
        box = dialog.get_by_role("textbox", name="New departure time")
        see(d, box, "change dialog")
        expect(box).to_have_value(hhmm(dep))
        box.focus()
        d.keyboard.press("ControlOrMeta+a")
        d.keyboard.type(hhmm(new))
        press(d, dialog.get_by_role("button", name="Save new time"), "Enter")
        announced(d, "Departure saved and 2 passengers emailed.")
        for pg in (pa, pb):
            says(pg, pg.get_by_role("region", name="Ride update"), banner, "passenger banner live")
        notices = d.get_by_role("list", name="Passenger notices")
        for who in ("lune", "tobin"):
            says(d, notices, re.compile(rf"{re.escape(w.names[who])}: time change sent at \d{{2}}:\d{{2}}"), "notice sent")
        paid = seg_price(WHOLE_PRICE, ROUTE, "Kestrevel", "Brisanne")
        opener = pa.get_by_role("button", name="Cancel my seat")
        press(pa, opener, "Enter")
        quote = pa.get_by_role("dialog", name="Cancel this booking")
        says(pa, quote, f"Cancelling now refunds {euros(paid)} of {euros(paid)} (100%, free after the driver's time change).",
             "free-cancel quote")
        pa.keyboard.press("Escape")
        hidden(pa, quote, "Escape closes the cancel dialog")
        focused(pa, opener, "focus back on Cancel my seat")
    subject = f"Your Longseat ride on {ddd(day)} now leaves at {hhmm(new)}"
    for who in ("lune", "tobin"):
        body = text(exactly(mail, w.emails[who], subject)[0])
        assert f"{w.names['mara']} moved the departure from {hhmm(dep)} to {hhmm(new)}." in body
        assert f"You can cancel for free until {hhmm(until)} on {ddd(until)}." in body
    rows = ok(w.api("GET", f"/api/rides/{w.rides['r']}/notices", "mara"), 200, "notices")["notices"]
    assert sorted((n["passenger_id"], n["kind"], n["status"]) for n in rows) == sorted(
        (w.id(k), "time_change", "sent") for k in ("lune", "tobin"))


def test_wf_ride_change_email_mail_down(browser: Browser, app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    dep = at(day, 8, 30)
    new = dep + timedelta(minutes=SHIFT_MINUTES)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}, "tobin": {"roles": ["passenger"]}},
             rides=[ride("r", "mara", dep)],
             bookings=[booking("a", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1)),
                       booking("b", "r", "tobin", "Kestrevel", "Oakhythe", created=now - timedelta(hours=1))])
    down = env("APP_MAIL_DOWN_URL")
    with opened(browser, down, f"/rides/{w.rides['r']}", w.s("mara")) as d:
        press(d, d.get_by_role("button", name="Change departure"), "Enter")
        dialog = d.get_by_role("dialog", name="Change departure")
        box = dialog.get_by_role("textbox", name="New departure time")
        see(d, box, "change dialog")
        box.focus()
        d.keyboard.press("ControlOrMeta+a")
        d.keyboard.type(hhmm(new))
        press(d, dialog.get_by_role("button", name="Save new time"), "Enter")
        see(d, d.get_by_role("alert").filter(has_text=MAIL_QUEUED), "queued banner verbatim")
        for who in ("lune", "tobin"):
            says(d, d.get_by_role("list", name="Passenger notices"), f"{w.names[who]}: time change queued", "queued notice")
    assert parse(get_ride(w, "r", "mara")["stops"][0]["time"]) == new, "the save did not persist"
    subject = f"Your Longseat ride on {ddd(day)} now leaves at {hhmm(new)}"
    for who in ("lune", "tobin"):
        exactly(mail, w.emails[who], subject)
    poll(app_url, lambda: ok(w.api("GET", f"/api/rides/{w.rides['r']}/notices", "mara"), 200, "notices")["notices"],
         lambda rows: len(rows) == 2 and all(n["status"] == "sent" for n in rows), "notices became sent")
    with opened(browser, app_url, f"/rides/{w.rides['r']}", w.s("mara")) as d:
        says(d, d.get_by_role("list", name="Passenger notices"),
             re.compile(rf"{re.escape(w.names['lune'])}: time change sent at \d{{2}}:\d{{2}}"), "notice reads sent")


def test_free_cancel_window(app_url: str) -> None:
    now = server_now(app_url)
    dep = floor_minute(now + timedelta(hours=5))
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}, "tobin": {"roles": ["passenger"]}},
             rides=[ride("r", "mara", dep)],
             bookings=[booking("a", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1)),
                       booking("b", "r", "tobin", "Kestrevel", "Oakhythe", created=now - timedelta(hours=1))])
    rid = w.rides["r"]
    first = dep + timedelta(minutes=FREE_CANCEL_SHIFT_MINUTES)
    ok(w.api("PATCH", f"/api/rides/{rid}", "mara", body={"departure": iso(first)}, headers={"If-Match": "1"}), 200, "60 min")
    a = get_booking(w, w.bookings["a"], "lune")
    assert a["free_cancel_until"] is None and a["cancel_quote"]["reason"] == "tier"
    second = first + timedelta(minutes=FREE_CANCEL_SHIFT_MINUTES + 1)
    ok(w.api("PATCH", f"/api/rides/{rid}", "mara", body={"departure": iso(second)}, headers={"If-Match": "2"}), 200, "61 min")
    until = second - timedelta(hours=FREE_WINDOW_LEAD_HOURS)
    for k, who in (("a", "lune"), ("b", "tobin")):
        b = get_booking(w, w.bookings[k], who)
        assert parse(b["free_cancel_until"]) == until
        q = b["cancel_quote"]
        assert (q["reason"], q["percent"], q["refund_cents"], q["kept_cents"]) == ("free_window", 100, b["price_cents"], 0)
    clock(app_url, max(0, int((until - server_now(app_url)).total_seconds()) - 2))
    q = get_booking(w, w.bookings["a"], "lune")["cancel_quote"]
    assert q["reason"] == "free_window" and q["percent"] == 100, f"just before the window end: {q}"
    clock(app_url, math.ceil((until - server_now(app_url)).total_seconds()) + 1)
    b = get_booking(w, w.bookings["a"], "lune")
    q = b["cancel_quote"]
    assert q["reason"] == "tier" and q["percent"] == 0 and q["refund_cents"] == 0, \
        f"after the window, under 2 hours before boarding, the 0% tier applies: {q}"
    r = ok(w.api("POST", f"/api/bookings/{w.bookings['a']}/cancel", "lune", key=idempotency_key()), 200, "cancel")
    assert r["refund_cents"] == 0 and r["kept_cents"] == b["price_cents"]


def test_wf_cancel_refunds_quote(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    dep = boarding_departure(now, timedelta(hours=CANCEL_HOURS_BEFORE, minutes=30), ROUTE, "Brisanne")
    board = dep + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("r", "mara", dep)],
             bookings=[booking("b", "r", "lune", "Brisanne", "Tollemarch", created=now - timedelta(hours=1))])
    bid = w.bookings["b"]
    paid = seg_price(WHOLE_PRICE, ROUTE, "Brisanne", "Tollemarch")
    refund = paid * REFUND_HALF_PERCENT // 100
    kept = paid - refund
    with opened(browser, app_url, f"/rides/{w.rides['r']}", w.s("mara")) as d, \
            opened(browser, app_url, f"/bookings/{bid}", w.s("lune"), device_time=now + timedelta(days=3)) as p:
        opener = p.get_by_role("button", name="Cancel my seat")
        dialog = p.get_by_role("dialog", name="Cancel this booking")
        press(p, opener, "Enter")
        see(p, dialog, "cancel dialog opens")
        p.keyboard.press("Escape")
        hidden(p, dialog, "Escape closes the cancel dialog")
        focused(p, opener, "focus back on Cancel my seat")
        press(p, opener, "Enter")
        says(p, dialog, f"Cancelling now refunds {euros(refund)} of {euros(paid)} ({REFUND_HALF_PERCENT}%, "
             f"{CANCEL_HOURS_BEFORE} hours before departure).", "server quote with a wrong device clock")
        press(p, dialog.get_by_role("button", name="Cancel booking"), "Enter")
        eventually(p, lambda: ensure(urlparse(p.url).path == "/wallet", p.url), "went to /wallet")
        focused(p, p.get_by_role("heading", level=1, name="Wallet"), "focus on the Wallet heading")
        label = re.escape(f"Refund {REFUND_HALF_PERCENT}%: Brisanne to Tollemarch, ") + f"({ddd(dep)}|{ddd(board)})"
        says(p, p.get_by_role("list", name="Wallet"), re.compile(label + re.escape(f" {signed(refund)}")), "refund line")
        announced(d, f"{w.names['lune']} cancelled: Brisanne to Tollemarch. You keep {euros(kept)}.")
    cancel = [e for e in ledger(w, "lune", bid) if accounts(e).get(f"held:{bid}") == -paid]
    assert len(cancel) == 1 and accounts(cancel[0]) == {f"held:{bid}": -paid, f"wallet:{w.id('lune')}": refund,
                                                        f"earnings:{w.id('mara')}": kept}
    row = next(r for r in ok(w.api("GET", f"/api/driver/earnings?month={month_key(local(dep))}", "mara"), 200,
                             "earnings")["rows"] if r["booking_id"] == bid)
    assert (row["paid_cents"], row["refunded_cents"], row["earned_cents"]) == (paid, refund, kept)


@pytest.mark.parametrize("tier", ["full", "half", "none"], ids=["full", "half", "none"])
def test_paired_ledger(app_url: str, tier: str) -> None:
    lead, percent = {"full": (timedelta(hours=30), 100), "half": (timedelta(hours=CANCEL_HOURS_BEFORE, minutes=30), REFUND_HALF_PERCENT),
                     "none": (timedelta(hours=1, minutes=30), 0)}[tier]
    now = server_now(app_url)
    dep = boarding_departure(now, lead, ROUTE, "Brisanne")
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}}, rides=[ride("r", "mara", dep)])
    ok(w.api("POST", "/api/wallet/top-ups", "lune", body={"amount_cents": TOP_UP_CENTS}), 201, "top-up")
    b = booked(w, "lune", "r", "Brisanne", "Tollemarch")
    paid = b["price_cents"]
    q = b["cancel_quote"]
    refund = paid * percent // 100
    assert (q["percent"], q["refund_cents"], q["kept_cents"]) == (percent, refund, paid - refund), q
    key = idempotency_key()
    r1 = w.api("POST", f"/api/bookings/{b['id']}/cancel", "lune", key=key)
    res = ok(r1, 200, "cancel")
    assert res["refund_cents"] == refund and res["refund_cents"] + res["kept_cents"] == paid
    r2 = w.api("POST", f"/api/bookings/{b['id']}/cancel", "lune", key=key)
    assert r2.status_code == 200 and r2.json() == res and r2.headers.get("Idempotent-Replay") == "true"
    fails(w.api("POST", f"/api/bookings/{b['id']}/cancel", "lune", key=idempotency_key()), 409, "invalid_transition")
    entries = ledger(w, "lune", b["id"])
    cancel = [e for e in entries if accounts(e).get(f"held:{b['id']}") == -paid]
    assert len(cancel) == 1 and accounts(cancel[0]) == {f"held:{b['id']}": -paid, f"wallet:{w.id('lune')}": refund,
                                                        f"earnings:{w.id('mara')}": paid - refund}
    wl = wallet(w, "lune")
    assert wl["balance_cents"] == sum(l["amount_cents"] for l in wl["lines"]) == WALLET_CENTS + TOP_UP_CENTS - paid + refund
    board = dep + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
    label = re.compile(re.escape(f"Refund {percent}%: Brisanne to Tollemarch, ") + f"({ddd(dep)}|{ddd(board)})")
    assert sum(1 for l in wl["lines"] if label.fullmatch(l["label"])) == 1
    row = next(r for r in ok(w.api("GET", f"/api/driver/earnings?month={month_key(local(dep))}", "mara"), 200,
                             "earnings")["rows"] if r["booking_id"] == b["id"])
    assert (row["paid_cents"], row["refunded_cents"], row["earned_cents"]) == (paid, refund, paid - refund)


def test_wf_cancel_refunds_driver_cancels(browser: Browser, app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}, "tobin": {"roles": ["passenger"]}},
             rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("a", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1)),
                       booking("b", "r", "tobin", "Kestrevel", "Oakhythe", created=now - timedelta(hours=1))])
    prices = {"lune": seg_price(WHOLE_PRICE, ROUTE, "Kestrevel", "Brisanne"),
              "tobin": seg_price(WHOLE_PRICE, ROUTE, "Kestrevel", "Oakhythe")}
    with opened(browser, app_url, f"/rides/{w.rides['r']}", w.s("mara")) as d, \
            opened(browser, app_url, f"/bookings/{w.bookings['a']}", w.s("lune")) as pa, \
            opened(browser, app_url, f"/bookings/{w.bookings['b']}", w.s("tobin")) as pb:
        press(d, d.get_by_role("button", name="Cancel ride"), "Enter")
        dialog = d.get_by_role("dialog", name="Cancel this ride")
        see(d, dialog, "cancel dialog")
        press(d, dialog.get_by_role("button", name="Cancel ride for everyone"), "Enter")
        announced(d, "Ride cancelled. Every passenger has been refunded.")
        for pg, who in ((pa, "lune"), (pb, "tobin")):
            says(pg, pg.get_by_role("region", name="Ride update"),
                 f"{w.names['mara']} cancelled this ride. {euros(prices[who])} is back in your wallet.", "cancelled banner")
    for k, who, alight in (("a", "lune", "Brisanne"), ("b", "tobin", "Oakhythe")):
        assert get_booking(w, w.bookings[k], who)["state"] == "cancelled_by_driver"
        assert wallet(w, who)["balance_cents"] == 0
        label = f"Refund 100%: Kestrevel to {alight}, {ddd(day)}"
        assert [l["amount_cents"] for l in wallet(w, who)["lines"] if l["label"] == label] == [prices[who]]
        m = exactly(mail, w.emails[who], f"Your Longseat ride on {ddd(day)} was cancelled")
        assert f"{euros(prices[who])} has been refunded to your Longseat wallet." in text(m[0])
    assert get_ride(w, "r", "mara")["state"] == "cancelled"


def rate_by_keyboard(p: Page, other: str, stars: int) -> None:
    group = p.get_by_role("radiogroup", name=f"Rating for {other}")
    see(p, group, "rating radiogroup")
    group.get_by_role("radio", name="1 star", exact=True).focus()
    for _ in range(stars - 1):
        p.keyboard.press("ArrowRight")
    eventually(p, lambda: expect(group.get_by_role("radio", name=f"{stars} stars", exact=True)).to_be_checked(timeout=PROBE_MS),
               f"arrows checked {stars} stars")
    p.keyboard.press("Tab")
    expect(p.get_by_role("textbox", name="Comment")).to_be_focused()
    press(p, p.get_by_role("button", name="Submit rating"), "Enter")


def arrived_world(app_url: str, arrival_ago: timedelta) -> World:
    now = server_now(app_url)
    dep = floor_minute(now - arrival_ago - timedelta(minutes=minutes_to(ROUTE, "Tollemarch")))
    return seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}, "tobin": {"roles": ["passenger"]}},
                rides=[ride("r", "mara", dep, state="arrived")],
                bookings=[booking("b", "r", "lune", "Kestrevel", "Brisanne", state="completed", created=dep - timedelta(days=1))])


def test_wf_rating_reveal_both(browser: Browser, app_url: str, mail: Any) -> None:
    w = arrived_world(app_url, timedelta(hours=1))
    bid, mara, lune = w.bookings["b"], w.names["mara"], w.names["lune"]
    with opened(browser, app_url, f"/bookings/{bid}", w.s("lune")) as p, \
            opened(browser, app_url, f"/bookings/{bid}", w.s("mara")) as d:
        rate_by_keyboard(p, mara, 5)
        for pg in (p, d):
            says(pg, pg.get_by_role("region", name="Rating"), "Waiting for both ratings", "waiting on both pages")
        theirs = ok(w.api("GET", f"/api/bookings/{bid}/rating", "mara"), 200, "rating")
        assert theirs["state"] == "waiting" and theirs["other_submitted"] is True and theirs["theirs"] is None
        assert ok(w.api("GET", f"/api/members/{w.id('mara')}", "tobin"), 200, "member")["rating"]["count"] == 0
        fails(w.api("GET", f"/api/bookings/{bid}/rating", "tobin"), 404, "not_found", NOT_FOUND)
        rate_by_keyboard(d, lune, 4)
        announced(p, f"Ratings revealed: you gave 5 stars, {mara} gave you 4 stars.")
        announced(d, f"Ratings revealed: you gave 4 stars, {lune} gave you 5 stars.")
    rating = ok(w.api("GET", f"/api/bookings/{bid}/rating", "lune"), 200, "rating")
    assert rating["state"] == "revealed" and rating["theirs"]["stars"] == 4 and rating["mine"]["stars"] == 5
    assert get_booking(w, bid, "lune")["state"] == "rated"
    avg = ok(w.api("GET", f"/api/members/{w.id('mara')}", "tobin"), 200, "member")["rating"]
    assert (avg["average"], avg["count"]) == (5, 1)
    dep = parse(get_ride(w, "r", "lune")["stops"][0]["time"])
    frm, to = "Kestrevel", "Brisanne"
    for who in ("lune", "mara"):
        m = exactly(mail, w.emails[who], "Your Longseat ratings are in")
        assert f"Ratings are revealed for {frm} to {to}, {ddd(dep)}." in text(m[0])


def test_rating_window_errors(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("f", "mara", at(day, 8, 30))],
             bookings=[booking("fb", "f", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    fails(w.api("POST", f"/api/bookings/{w.bookings['fb']}/rating", "lune", body={"stars": 5}), 409, "rating_not_open",
          "You can rate this trip once it arrives.")
    a = arrived_world(app_url, timedelta(hours=1))
    path = f"/api/bookings/{a.bookings['b']}/rating"
    for bad in ({"stars": 0}, {"stars": 6}, {"stars": 5, "comment": "x" * (COMMENT_MAX + 1)}):
        fails(a.api("POST", path, "lune", body=bad), 422, "validation_failed")
    ok(a.api("POST", path, "lune", body={"stars": 5, "comment": "x" * COMMENT_MAX}), 201, "rate")
    fails(a.api("POST", path, "lune", body={"stars": 4}), 409, "already_rated", "You have already rated this trip.")
    late = arrived_world(app_url, timedelta(days=RATING_WINDOW_DAYS, hours=1))
    fails(late.api("POST", f"/api/bookings/{late.bookings['b']}/rating", "lune", body={"stars": 5}), 409, "rating_closed",
          "The rating window for this trip has closed.")


def test_wf_rating_reveal_window_close(browser: Browser, app_url: str, mail: Any) -> None:
    w = arrived_world(app_url, timedelta(days=RATING_WINDOW_DAYS) - timedelta(minutes=10))
    bid, mara, lune = w.bookings["b"], w.names["mara"], w.names["lune"]
    ok(w.api("POST", f"/api/bookings/{bid}/rating", "lune", body={"stars": 5}), 201, "rate")
    with opened(browser, app_url, f"/bookings/{bid}", w.s("lune"), device_time=w.now + timedelta(days=30)) as p, \
            opened(browser, app_url, f"/bookings/{bid}", w.s("mara")) as d:
        says(p, p.get_by_role("region", name="Rating"), "Waiting for both ratings", "server state despite device clock")
        clock(app_url, 11 * SECONDS_PER_MINUTE)
        announced(p, f"Ratings revealed: you gave 5 stars. {mara} did not rate.")
        announced(d, f"Ratings revealed: {lune} gave you 5 stars. You did not rate.")
    assert get_booking(w, bid, "lune")["state"] == "rated"
    assert ok(w.api("GET", f"/api/members/{w.id('mara')}", "lune"), 200, "m")["rating"]["count"] == 1
    for who in ("lune", "mara"):
        exactly(mail, w.emails[who], "Your Longseat ratings are in")


def test_blind_ratings_api(app_url: str) -> None:
    w = arrived_world(app_url, timedelta(hours=1))
    comment = f"Rucksack {w.tag}"
    bid = w.bookings["b"]
    ok(w.api("POST", f"/api/bookings/{bid}/rating", "lune", body={"stars": 2, "comment": comment}), 201, "rate")
    for path in (f"/api/bookings/{bid}/rating", f"/api/bookings/{bid}", "/api/me/bookings?tab=past",
                 f"/api/rides/{w.rides['r']}/bookings", f"/api/members/{w.id('mara')}"):
        assert comment not in w.api("GET", path, "mara").text, f"{path} leaked the unrevealed rating"
    assert ok(w.api("GET", f"/api/members/{w.id('mara')}", "mara"), 200, "m")["rating"] == {"average": None, "count": 0}
    ok(w.api("POST", f"/api/bookings/{bid}/rating", "mara", body={"stars": 4}), 201, "driver rates")
    got = ok(w.api("GET", f"/api/bookings/{bid}/rating", "mara"), 200, "rating")
    assert got["state"] == "revealed" and got["theirs"] == {"stars": 2, "comment": comment}
    assert ok(w.api("GET", f"/api/members/{w.id('lune')}", "mara"), 200, "m")["rating"] == {"average": 4, "count": 1}


def code_from(mail: Any, email: str, minimum: int = 1) -> str:
    body = text(inbox(mail, email, "Your Longseat sign-in code", minimum)[0])
    m = re.search(r"Your code is (\d{6})\. It expires in (\d+) minutes\.", body)
    assert m and int(m.group(2)) == EMAIL_CODE_TTL_SECONDS // SECONDS_PER_MINUTE, body
    return m.group(1)


def test_wf_id_upload_outage_sign_in(browser: Browser, app_url: str, mail: Any) -> None:
    tag = uuid.uuid4().hex[:8]
    email, name = f"tobin.{tag}@example.test", f"Tobin {tag}"
    with opened(browser, app_url, "/sign-in") as p:
        box = p.get_by_role("textbox", name="Email")
        box.focus()
        p.keyboard.type(email)
        press(p, p.get_by_role("button", name="Send code"), "Enter")
        says(p, p.locator("body"), f"Your code is on its way to {email}.", "sent copy")
        code = code_from(mail, email)
        assert mail_from_address() in addresses(inbox(mail, email, "Your Longseat sign-in code")[0].get("From"))
        wrong = f"{(int(code) + 1) % 1_000_000:06d}"
        p.get_by_role("textbox", name="Code").focus()
        p.keyboard.type(wrong)
        p.get_by_role("textbox", name="Display name").focus()
        p.keyboard.type(name)
        press(p, p.get_by_role("button", name="Sign in"), "Enter")
        see(p, p.get_by_role("alert").filter(has_text="That code is not right. Check the email and try again."), "wrong code")
        p.get_by_role("textbox", name="Code").focus()
        p.keyboard.press("ControlOrMeta+a")
        p.keyboard.type(code)
        press(p, p.get_by_role("button", name="Sign in"), "Enter")
        see(p, p.get_by_role("navigation", name="Main").get_by_role("link", name="Profile"), "member navigation")
        cookie = next(c for c in p.context.cookies() if c["name"] == "ls_session")
        assert cookie["httpOnly"] and cookie["sameSite"] == "Lax" and cookie["path"] == "/"
    me = ok(call(app_url, "GET", "/api/me", cookie["value"]), 200, "me")
    assert me["display_name"] == name and sorted(me["roles"]) == ["driver", "passenger"] and me["id_state"] == "none"


def test_sign_in_code_rules(app_url: str, mail: Any) -> None:
    tag = uuid.uuid4().hex[:8]
    a, b, c = (f"{k}.{tag}@example.test" for k in ("ama", "bel", "cyr"))
    assert ok(call(app_url, "POST", "/api/auth/code", body={"email": a}), 202, "code") == {"sent": True}
    first = code_from(mail, a)
    fails(call(app_url, "POST", "/api/auth/verify", body={"email": a, "code": first}), 422, "validation_failed")
    clock(app_url, EMAIL_CODE_TTL_SECONDS)
    fails(call(app_url, "POST", "/api/auth/verify", body={"email": a, "code": first, "display_name": "Ama"}), 422,
          "code_expired", "This code has expired. Ask for a new one.")
    ok(call(app_url, "POST", "/api/auth/code", body={"email": b}), 202, "code b1")
    old = code_from(mail, b)
    ok(call(app_url, "POST", "/api/auth/code", body={"email": b}), 202, "code b2")
    new = code_from(mail, b, 2)
    if old != new:
        r = call(app_url, "POST", "/api/auth/verify", body={"email": b, "code": old, "display_name": "Bel"})
        assert r.status_code == 422 and r.json()["error"] in ("code_invalid", "code_expired"), r.text
    ok(call(app_url, "POST", "/api/auth/verify", body={"email": b, "code": new, "display_name": "Bel"}), 200, "verify")
    fails(call(app_url, "POST", "/api/auth/verify", body={"email": b, "code": new}), 422, "code_invalid")
    for _ in range(SIGNIN_CODE_RATE_PER_HOUR):
        ok(call(app_url, "POST", "/api/auth/code", body={"email": c}), 202, "code c")
    r = call(app_url, "POST", "/api/auth/code", body={"email": c})
    fails(r, 429, "rate_limited", re.compile(r"Too many codes asked for\. Try again in \d+ minutes\."))
    assert int(r.headers["Retry-After"]) >= 1
    exactly(mail, c, "Your Longseat sign-in code", SIGNIN_CODE_RATE_PER_HOUR)


def test_wf_id_upload_outage_storage_down(browser: Browser, app_url: str) -> None:
    w = seed(app_url, {"lune": {"roles": ["passenger"]}})
    with opened(browser, env("APP_STORAGE_DOWN_URL"), "/profile", w.s("lune")) as p:
        see(p, p.get_by_text("ID status: not uploaded"), "status before")
        field = p.get_by_label("ID document")
        field.set_input_files({"name": "id.png", "mimeType": "image/png", "buffer": png()})
        press(p, p.get_by_role("button", name="Upload ID document"), "Enter")
        see(p, p.get_by_role("alert").filter(has_text=STORAGE_DOWN), "outage copy verbatim")
        retry = p.get_by_role("button", name="Try again")
        see(p, retry, "Try again offered")
        assert field.evaluate("e => e.files.length") == 1, "the chosen file was dropped"
        press(p, retry, "Enter")
        see(p, p.get_by_role("alert").filter(has_text=STORAGE_DOWN), "retry still reports the outage")
        expect(p.get_by_text("ID status: not uploaded")).to_be_visible()
    assert S3().keys(f"id-documents/{w.id('lune')}/") == []
    assert ok(w.api("GET", "/api/me/id-document", "lune"), 200, "doc")["id_state"] == "none"


def test_upload_checks(app_url: str) -> None:
    w = seed(app_url, {"lune": {"roles": ["passenger"]}, "tobin": {"roles": ["passenger"]}})
    s3, mid = S3(), w.id("lune")

    def up(route: str, data: bytes, name: str, kind: str, base: str = app_url) -> httpx.Response:
        return call(base, "POST", route, w.s("lune"), files={"file": (name, data, kind)})

    photo_err, doc_err = "Upload a PNG or JPEG file.", "Upload a PNG, JPEG or PDF file."
    for data, name, kind in ((png(), "p.png", "image/png"), (JPEG, "p.jpg", "image/jpeg"), (png(PHOTO_MAX_BYTES), "big.png", "image/png")):
        res = ok(up("/api/me/photo", data, name, kind), 201, f"photo {name}")
        assert res["photo_url"] == f"/api/files/{res['file_id']}"
        assert s3.get(f"photos/{mid}/{res['file_id']}") == data
        got = w.api("GET", res["photo_url"], "tobin")
        assert got.status_code == 200 and got.content == data
    before = s3.keys(f"photos/{mid}/")
    fails(up("/api/me/photo", PDF, "p.pdf", "application/pdf"), 422, "file_type", photo_err)
    fails(up("/api/me/photo", GIF, "p.png", "image/png"), 422, "file_type", photo_err)
    fails(up("/api/me/photo", png(PHOTO_MAX_BYTES + 1), "p.png", "image/png"), 422, "file_too_large",
          f"The file must be {PHOTO_MAX_BYTES // BYTES_PER_MB} MB or smaller.")
    assert s3.keys(f"photos/{mid}/") == before
    fails(up("/api/me/id-document", GIF, "d.pdf", "application/pdf"), 422, "file_type", doc_err)
    fails(up("/api/me/id-document", png(ID_DOC_MAX_BYTES + 1), "d.png", "image/png"), 422, "file_too_large",
          f"The file must be {ID_DOC_MAX_BYTES // BYTES_PER_MB} MB or smaller.")
    assert s3.keys(f"id-documents/{mid}/") == []
    down = env("APP_STORAGE_DOWN_URL")
    fails(up("/api/me/id-document", PDF, "d.pdf", "application/pdf", down), 503, "storage_unavailable", STORAGE_DOWN)
    fails(call(down, "GET", f"/api/files/{before[0].rsplit('/', 1)[1]}", w.s("lune")), 503, "storage_unavailable")
    assert ok(w.api("GET", "/api/me/id-document", "lune"), 200, "doc")["id_state"] == "none"
    res = ok(up("/api/me/id-document", PDF, "d.pdf", "application/pdf"), 201, "id document")
    assert res["id_state"] == "pending" and s3.get(f"id-documents/{mid}/{res['file_id']}") == PDF
    assert ok(w.api("GET", "/api/me/id-document", "lune"), 200, "doc")["file_id"] == res["file_id"]


def test_wf_id_upload_outage_review(browser: Browser, app_url: str, mail: Any) -> None:
    w = seed(app_url, {"lune": {}, "tobin": {"id_state": "none"}, "idris": {"roles": ["passenger"]}, "wren": {"roles": ["founder"]}})
    lune, tobin = w.names["lune"], w.names["tobin"]
    reason = f"Blurred photo {w.tag}"
    ok(w.api("POST", "/api/me/id-document", "tobin", files={"file": ("d.png", png(), "image/png")}), 201, "tobin uploads")
    with opened(browser, app_url, "/profile", w.s("lune")) as m:
        m.get_by_label("ID document").set_input_files({"name": "id.png", "mimeType": "image/png", "buffer": png()})
        press(m, m.get_by_role("button", name="Upload ID document"), "Enter")
        announced(m, "ID document received. It is waiting for review.")
        see(m, m.get_by_text("ID status: waiting for review"), "pending status")
        doc = ok(w.api("GET", "/api/me/id-document", "lune"), 200, "doc")
        assert S3().get(f"id-documents/{w.id('lune')}/{doc['file_id']}") == png()
        fails(w.api("GET", f"/api/files/{doc['file_id']}", "idris"), 404, "not_found", NOT_FOUND)
        assert w.api("GET", f"/api/files/{doc['file_id']}", "wren").content == png()
        with opened(browser, app_url, "/founder/id-review", w.s("wren")) as f:
            queue = f.get_by_role("list", name="ID review queue")
            see(f, queue.get_by_role("link", name=f"View document for {lune}"), "queue item")
            press(f, queue.get_by_role("button", name=f"Approve {lune}", exact=True), "Enter")
            announced(f, f"{lune} is verified.")
            press(f, queue.get_by_role("button", name=f"Ask {tobin} to upload again", exact=True), "Enter")
            dialog = f.get_by_role("dialog", name="Ask for a new upload")
            dialog.get_by_role("textbox", name="Reason").focus()
            f.keyboard.type(reason)
            press(f, dialog.get_by_role("button", name="Send request"), "Enter")
            announced(f, f"{tobin} was asked to upload again.")
        announced(m, "Your ID is verified.")
        see(m, m.get_by_text("ID status: verified"), "verified status live")
    assert ok(w.api("GET", "/api/me/id-document", "lune"), 200, "doc")["id_state"] == "verified"
    t = ok(w.api("GET", "/api/me/id-document", "tobin"), 200, "doc")
    assert t["id_state"] == "rejected" and t["reason"] == reason
    assert "Your ID is verified." in text(exactly(mail, w.emails["lune"], "Your Longseat ID review")[0])
    assert f"Please upload your ID again: {reason}." in text(exactly(mail, w.emails["tobin"], "Your Longseat ID review")[0])


def test_founder_network(browser: Browser, app_url: str, mail: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    founder = seed(app_url, {"wren": {"roles": ["founder"]}, "lune": {"roles": ["passenger"]}})
    before = ok(founder.api("GET", "/api/founder/bookings-by-state", "wren"), 200, "counts")["counts"]
    assert set(BOOKING_STATES) <= set(before), f"missing states: {set(BOOKING_STATES) - set(before)}"
    seed(app_url, {"mara": {"car": 3}, "tobin": {"roles": ["passenger"]}}, rides=[ride("r", "mara", at(day, 8, 30))],
         bookings=[booking("c", "r", "tobin", "Kestrevel", "Brisanne", state="cancelled_by_passenger", refund=100,
                           created=now - timedelta(hours=1))])
    after = ok(founder.api("GET", "/api/founder/bookings-by-state", "wren"), 200, "counts")["counts"]
    assert after["cancelled_by_passenger"] == before["cancelled_by_passenger"] + 1
    email = f"net.{founder.tag}@example.test"
    ok(call(app_url, "POST", "/api/auth/code", body={"email": email}), 202, "code")
    inbox(mail, email, "Your Longseat sign-in code")
    item = poll(app_url, lambda: [i for i in ok(founder.api("GET", "/api/founder/outbox", "wren"), 200, "outbox")["items"]
                                  if i["to"] == email], lambda xs: xs and xs[0]["status"] == "sent", "outbox row sent")[0]
    assert item["kind"] == "sign_in_code" and item["subject"] == "Your Longseat sign-in code" and item["attempts"] >= 1
    fails(founder.api("GET", "/api/founder/outbox", "lune"), 403, "forbidden", NO_ACCESS)
    fails(founder.api("GET", "/api/founder/bookings-by-state", "lune"), 403, "forbidden", NO_ACCESS)
    with opened(browser, app_url, "/founder/network", founder.s("wren")) as p:
        see(p, p.get_by_role("heading", level=1, name="Network"), "Network page")
        says(p, entry(p, item["id"]), email, "outbox row on the page")
        expect(p.get_by_role("table", name="Bookings by state")).to_be_visible()
    with opened(browser, app_url, "/founder/network", founder.s("lune")) as p:
        see(p, p.get_by_text(NO_ACCESS), "member sees the 403 copy")


def test_wf_earnings_csv_live_cancel(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    dep = boarding_departure(now, timedelta(hours=CANCEL_HOURS_BEFORE, minutes=30), ROUTE, "Brisanne")
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}, "tobin": {"roles": ["passenger"]},
                       "idris": {"roles": ["passenger"], "wallet": WALLET_CENTS}}, rides=[ride("r", "mara", dep)],
             bookings=[booking("a", "r", "lune", "Brisanne", "Tollemarch", created=now - timedelta(hours=1)),
                       booking("b", "r", "tobin", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    ok(attempt(w, "idris", "r", "Kestrevel", "Oakhythe"), 201, "a hold that never confirms")
    month = month_key(local(dep))
    paid = seg_price(WHOLE_PRICE, ROUTE, "Brisanne", "Tollemarch")
    refund = paid * REFUND_HALF_PERCENT // 100
    with opened(browser, app_url, f"/earnings?month={month}", w.s("mara")) as p:
        table = p.get_by_role("table", name="Earnings")
        says(p, table, f"Total earned {euros(0)}", "totals line while confirmed")
        for k in ("a", "b"):
            see(p, entry(p, w.bookings[k]), "row per confirmed booking")
        keep_marker(p)
        with opened(browser, app_url, f"/bookings/{w.bookings['a']}", w.s("lune")) as q:
            opener = q.get_by_role("button", name="Cancel my seat")
            dialog = q.get_by_role("dialog", name="Cancel this booking")
            press(q, opener, "Enter")
            see(q, dialog, "cancel dialog opens")
            q.keyboard.press("Escape")
            hidden(q, dialog, "Escape closes the cancel dialog")
            focused(q, opener, "focus back on Cancel my seat")
            press(q, opener, "Enter")
            says(q, dialog, f"Cancelling now refunds {euros(refund)} of {euros(paid)} ({REFUND_HALF_PERCENT}%, "
                 f"{CANCEL_HOURS_BEFORE} hours before departure).", "50% quote")
            press(q, dialog.get_by_role("button", name="Cancel booking"), "Enter")
            focused(q, q.get_by_role("heading", level=1, name="Wallet"), "focus on the Wallet heading")
        says(p, entry(p, w.bookings["a"]), euros(paid - refund), "row updates live")
        says(p, table, f"Total earned {euros(paid - refund)}", "total updates live")
        assert_no_reload(p)
        with p.expect_download() as dl:
            press(p, p.get_by_role("button", name="Export earnings CSV"), "Enter")
        raw = Path(dl.value.path()).read_bytes()
        assert dl.value.suggested_filename == f"longseat-earnings-{month}.csv", dl.value.suggested_filename
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))
    api = ok(w.api("GET", f"/api/driver/earnings?month={month}", "mara"), 200, "earnings")
    mine = {w.bookings["a"], w.bookings["b"]}
    assert {r["booking_id"] for r in rows} == mine == {r["booking_id"] for r in api["rows"]}
    for r in rows:
        a = next(x for x in api["rows"] if x["booking_id"] == r["booking_id"])
        assert (r["paid"], r["refunded"], r["earned"]) == tuple(euros(a[k])[1:] for k in ("paid_cents", "refunded_cents", "earned_cents"))
    assert api["total_earned_cents"] == sum(x["earned_cents"] for x in api["rows"]) == paid - refund


def test_wf_earnings_csv_empty_month(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("b", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    empty = add_months(day, 1)
    with opened(browser, app_url, f"/earnings?month={month_key(empty)}", w.s("mara")) as p:
        see(p, p.get_by_text("No bookings on rides in this month."), "empty sentence")
        select(p.get_by_role("combobox", name="Month"), month_name(day))
        see(p, entry(p, w.bookings["b"]), "row for the chosen month")


def test_earnings_csv_format(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    tag = uuid.uuid4().hex[:8]
    odd = f'Lune "Quell", {tag}'
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "name": odd}, "tobin": {"roles": ["passenger"]}},
             rides=[ride("late", "mara", at(day, 8, 30)), ride("early", "mara", at(day, 6, 0))],
             bookings=[booking("a", "late", "lune", "Brisanne", "Tollemarch", created=now - timedelta(hours=1)),
                       booking("b", "early", "tobin", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    month = month_key(day)
    r = w.api("GET", f"/api/driver/earnings.csv?month={month}", "mara")
    published_type = "text/csv; charset=utf-8"
    assert r.status_code == 200
    assert r.headers["content-type"].replace(" ", "").lower() == published_type.replace(" ", "")
    assert r.headers["content-disposition"] == f'attachment; filename="longseat-earnings-{month}.csv"'
    raw = r.content
    assert not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\r\n") and raw.count(b"\n") == raw.count(b"\r\n")
    assert raw.split(b"\r\n")[0] == b"booking_id,departure,from,to,passenger,seats,paid,refunded,earned,status"
    assert ('"' + odd.replace('"', '""') + '"').encode() in raw
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))
    assert [x["booking_id"] for x in rows] == [w.bookings["b"], w.bookings["a"]], "not ordered by departure"
    a = rows[1]
    board = at(day, 8, 30) + timedelta(minutes=minutes_to(ROUTE, "Brisanne"))
    assert (a["departure"], a["from"], a["to"], a["passenger"], a["seats"]) == (f"{board:%Y-%m-%d %H:%M}", "Brisanne", "Tollemarch", odd, "1")
    assert (a["paid"], a["refunded"], a["earned"], a["status"]) == (euros(seg_price(WHOLE_PRICE, ROUTE, "Brisanne", "Tollemarch"))[1:], "0.00", "0.00", "confirmed")
    fails(w.api("GET", f"/api/driver/earnings.csv?month={month}", "lune"), 403, "forbidden", NO_ACCESS)
    fails(w.api("GET", "/api/driver/earnings.csv?month=not-a-month", "mara"), 422, "validation_failed")


def test_grading_routes(app_url: str) -> None:
    for headers in ({}, {"X-Grading-Token": "wrong-token"}):
        for path, body in (("/api/grading/clock", {"advance_seconds": 0}), ("/api/grading/setup", {"members": []})):
            fails(call(app_url, "POST", path, body=body, headers=headers), 404, "not_found", NOT_FOUND)
    before = server_now(app_url)
    after = clock(app_url, 120)
    assert after - before >= timedelta(seconds=120)
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    states = ["published", "changed", "departed", "arrived", "cancelled"]
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": TOP_UP_CENTS}, "wren": {"roles": ["founder"]}},
             rides=[ride(s, "mara", at(day, 8, 30) if s in ("published", "changed", "cancelled") else now - timedelta(hours=8 if s == "arrived" else 1), state=s)
                    for s in states])
    for s in states:
        assert get_ride(w, s, "wren")["state"] == s
    assert wallet(w, "lune")["lines"][0]["label"] == "Added to wallet"
    dup = {"members": [{"key": "x", "display_name": "Ama", "email": f"x.{w.tag}@example.test", "roles": ["passenger"],
                        "id_state": "none", "wallet_cents": 0, "photo": False},
                       {"key": "y", "display_name": "Bel", "email": w.emails["lune"], "roles": ["passenger"],
                        "id_state": "none", "wallet_cents": 0, "photo": False}]}
    r = call(app_url, "POST", "/api/grading/setup", body=dup, headers={"X-Grading-Token": env("GRADING_TOKEN")})
    fails(r, 422, "validation_failed")
    again = call(app_url, "POST", "/api/grading/setup", body={"members": dup["members"][:1]}, headers={"X-Grading-Token": env("GRADING_TOKEN")})
    assert again.status_code == 201, "the refused setup created its first member"


PRECEDENCE_CASES = ["type_before_auth", "size_before_auth", "size_limit_inclusive", "unauthenticated", "hidden_before_role",
                    "role_forbidden", "replay_before_conflict", "conflict_before_input", "limit_before_conflict",
                    "input_order", "missing_key"]


@pytest.mark.parametrize("case", PRECEDENCE_CASES, ids=PRECEDENCE_CASES)
def test_error_precedence(app_url: str, case: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}, "poor": {"roles": ["passenger"]},
                       "wren": {"roles": ["founder"]}},
             rides=[ride("r", "mara", at(day, 8, 30)), ride("x", "mara", at(day, 9, 0), state="cancelled")])

    def padded(size: int) -> bytes:
        head = b'{"amount_cents":500,"note":"'
        return head + b"x" * (size - len(head) - 2) + b'"}'

    if case == "type_before_auth":
        fails(call(app_url, "POST", "/api/wallet/top-ups", raw=b'{"amount_cents":500}', headers={"Content-Type": "text/plain"}),
              415, "unsupported_media_type", "Send this request as JSON.")
    elif case == "size_before_auth":
        fails(call(app_url, "POST", "/api/wallet/top-ups", raw=padded(JSON_LIMIT_BYTES + 1), headers={"Content-Type": "application/json"}),
              413, "payload_too_large", "The request is too large.")
    elif case == "size_limit_inclusive":
        r = w.api("POST", "/api/wallet/top-ups", "lune", raw=padded(JSON_LIMIT_BYTES), headers={"Content-Type": "application/json"})
        assert r.status_code not in (413, 415), f"a body of exactly 65,536 bytes was refused: {r.status_code}"
    elif case == "unauthenticated":
        for r in (call(app_url, "GET", "/api/me"), call(app_url, "GET", "/api/me", "junk-session"),
                  call(app_url, "POST", "/api/wallet/top-ups", body={"amount_cents": TOP_UP_CENTS})):
            fails(r, 401, "unauthenticated", "Sign in to continue.")
    elif case == "hidden_before_role":
        fails(w.api("GET", f"/api/rides/{w.rides['x']}/bookings", "lune"), 404, "not_found", NOT_FOUND)
        fails(w.api("GET", f"/api/rides/{w.rides['r']}/bookings", "lune"), 403, "forbidden", NO_ACCESS)
    elif case == "role_forbidden":
        fails(w.api("GET", "/api/founder/outbox", "lune"), 403, "forbidden", NO_ACCESS)
        fails(w.api("GET", f"/api/driver/earnings?month={month_key(day)}", "lune"), 403, "forbidden", NO_ACCESS)
        fails(attempt(w, "mara", "r", "Kestrevel", "Brisanne"), 403, "forbidden", NO_ACCESS)
    elif case == "replay_before_conflict":
        key = idempotency_key()
        b = ok(attempt(w, "lune", "r", "Kestrevel", "Brisanne", key=key), 201, "hold")
        ok(w.api("POST", f"/api/bookings/{b['id']}/release", "lune"), 200, "release")
        r = attempt(w, "lune", "r", "Kestrevel", "Brisanne", key=key)
        assert r.status_code == 201 and r.headers.get("Idempotent-Replay") == "true" and r.json()["id"] == b["id"]
        fails(w.api("POST", f"/api/bookings/{b['id']}/release", "lune"), 409, "invalid_transition",
              "This booking can no longer change that way.")
    elif case == "conflict_before_input":
        ok(w.api("PATCH", f"/api/rides/{w.rides['r']}", "mara", body={"seats": 2}, headers={"If-Match": "1"}), 200, "edit")
        assert fails(attempt(w, "poor", "r", "Kestrevel", "Brisanne", version=1), 409, "ride_changed")["ride"]["version"] == 2
        fails(attempt(w, "poor", "r", "Kestrevel", "Brisanne"), 422, "insufficient_funds",
              "Your wallet has €0.00. Add money to book this seat.")
    elif case == "limit_before_conflict":
        for _ in range(REQUEST_RATE_PER_HOUR):
            attempt(w, "poor", "r", "Kestrevel", "Brisanne", version=99)
        fails(attempt(w, "poor", "r", "Kestrevel", "Brisanne", version=99), 429, "rate_limited")
    elif case == "input_order":
        six = ["Kestrevel", "Vardholm", "Brisanne", "Oakhythe", "Saint Ivrel", "Tollemarch"]
        base = {"vehicle_id": w.vehicles["car-mara"], "departure": iso(at(day, 8, 30)), "booking_mode": "instant"}
        body = fails(w.api("POST", "/api/rides", "mara", body={**base, "stops": six, "seats": 9, "price_cents": 50}), 422,
                     "validation_failed", "Check the highlighted fields.")
        assert "seats" in body["fields"]
        fails(w.api("POST", "/api/rides", "mara", body={**base, "stops": six, "seats": 3, "price_cents": 50}), 422, "too_many_stopovers")
        fails(w.api("POST", "/api/rides", "mara", body={**base, "stops": ROUTE, "seats": 3, "price_cents": 50}), 422, "price_out_of_range")
        fails(attempt(w, "poor", "r", "Kestrevel", "Brisanne", 9), 422, "validation_failed")
    elif case == "missing_key":
        b = booked(w, "lune", "r", "Kestrevel", "Brisanne")
        for who, path in (("lune", f"/api/rides/{w.rides['r']}/bookings"), ("lune", f"/api/bookings/{b['id']}/cancel"),
                          ("mara", f"/api/rides/{w.rides['r']}/cancel")):
            body = {"boarding": "Brisanne", "alighting": "Oakhythe", "seats": 1, "ride_version": 1} if path.endswith("/bookings") else None
            got = fails(w.api("POST", path, who, body=body), 422, "validation_failed")
            assert got["fields"]["idempotency_key"] == "Send an Idempotency-Key header."
        assert get_booking(w, b["id"], "lune")["state"] == "confirmed" and get_ride(w, "r", "mara")["state"] == "published"


def test_live_stream(app_url: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS}, "tobin": {"roles": ["passenger"]}},
             rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("t", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    rid, tid = w.rides["r"], w.bookings["t"]
    streams = [Live(app_url, f"?ride={rid}"), Live(app_url, f"?thread={tid}", w.s("lune")),
               Live(app_url, f"?thread={tid}", w.s("tobin"))]
    anon, mine, other = streams
    try:
        for s in (anon, mine):
            kind, data = s.wait(lambda k, d: True, "a first event")
            assert kind == "hello" and "server_now" in data, f"first event {kind}"
            assert s.status == 200 and s.content_type.startswith("text/event-stream")
        b = ok(attempt(w, "lune", "r", "Brisanne", "Tollemarch"), 201, "hold")
        _, seat = anon.wait(lambda k, d: k == "seat" and d.get("ride_id") == rid, "a seat event")
        assert next(s for s in seat["seat_map"] if s["seat"] == 1)["legs"] == ["taken", "taken", "taken"]
        mine.wait(lambda k, d: k == "booking" and d["booking"]["id"] == b["id"], "a booking event")
        ok(w.api("POST", f"/api/bookings/{b['id']}/confirm", "lune", key=idempotency_key()), 200, "confirm")
        expected = WALLET_CENTS - seg_price(WHOLE_PRICE, ROUTE, "Kestrevel", "Brisanne") - b["price_cents"]
        mine.wait(lambda k, d: k == "wallet" and d.get("balance_cents") == expected, "a wallet event")
        ok(w.api("POST", f"/api/bookings/{tid}/messages", "mara", body={"body": "Is there room"}), 201, "message")
        mine.wait(lambda k, d: k == "message" and d.get("booking_id") == tid, "a message event")
        moved = clock(app_url, 1)
        for s in (anon, mine):
            s.wait(lambda k, d: k == "clock" and parse(d["server_now"]) >= moved - timedelta(seconds=1), "a clock event")
        assert not [e for e in other.events if e[0] in ("message", "presence")], "a stranger received thread events"
    finally:
        for s in streams:
            s.close()


BOOT_WAIT_S = 90
SWEEP_ROUNDS = 3
VALKEY_PORT = 6379


def valkey_write(*commands: tuple[Any, ...]) -> None:
    u = urlparse(env("VALKEY_URL"))
    with socket.create_connection((u.hostname, u.port or VALKEY_PORT), timeout=HTTP_TIMEOUT) as sock:
        reader = sock.makefile("rb")

        def send(*args: Any) -> None:
            parts = [str(a).encode() for a in args]
            sock.sendall(b"*%d\r\n" % len(parts) + b"".join(b"$%d\r\n%s\r\n" % (len(p), p) for p in parts))
            reply = reader.readline()
            assert reply and not reply.startswith(b"-"), f"Valkey refused {args[0]}: {reply!r}"

        if u.password:
            send("AUTH", *([unquote(u.username)] if u.username else []), unquote(u.password))
        if u.path.strip("/"):
            send("SELECT", u.path.strip("/"))
        for command in commands:
            send(*command)


def tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-2000:]


@contextmanager
def extra_instance() -> Iterator[str]:
    serve = json.loads((APP / "run.json").read_text())["serve"]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env={**os.environ, "APP_PUBLIC_PORT": str(port)},
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline, up = time.monotonic() + BOOT_WAIT_S, False
        while time.monotonic() < deadline and not up:
            try:
                proc.wait(timeout=0.5)
                pytest.fail(f"second instance exited with {proc.returncode}: {tail(log.name)}")
            except subprocess.TimeoutExpired:
                pass
            try:
                up = httpx.get(f"{base}/health", timeout=2).status_code == 200
            except httpx.HTTPError:
                up = False
        if not up:
            pytest.fail(f"second instance never answered /health on {base}: {tail(log.name)}")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


@pytest.mark.timeout(900)
def test_outbox_and_valkey(app_url: str, mail: Any, valkey: Any) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    pax = [f"p{i}" for i in range(6)]
    spans = [("Kestrevel", "Brisanne")] * 4 + [("Brisanne", "Oakhythe")] * 2
    w = seed(app_url, {"mara": {"car": 4}, "idris": {"car": 4}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       **{k: {"roles": ["passenger"]} for k in pax}},
             rides=[ride("r", "mara", at(day, 8, 30), seats=4), ride("s", "mara", at(day, 10, 0)),
                    ride("q", "idris", at(day, 14, 0), stops=REQUEST_ROUTE, seats=4, price=REQUEST_PRICE, mode="request")],
             bookings=[booking(k, "r", k, *span, created=now - timedelta(hours=1)) for k, span in zip(pax, spans)])
    h = ok(attempt(w, "lune", "s", "Kestrevel", "Tollemarch"), 201, "hold")
    assert h["state"] == "held"
    q = ok(attempt(w, "lune", "q", "Vardholm", "Kestrevel"), 201, "request")
    deadline_ms = parse(q["expires_at"]).timestamp() * 1000
    hold_keys = [f"longseat:hold:{w.rides['s']}:{leg['index']}:{h['seat_numbers'][0]}" for leg in get_ride(w, "s", "lune")["legs"]]
    assert valkey.command("ZCARD", f"longseat:rate:requests:{w.id('lune')}") == 2

    def state() -> dict:
        return {"holds": [valkey.command("GET", k) for k in hold_keys], "ttls": [valkey.ttl(k) for k in hold_keys],
                "score": valkey.command("ZSCORE", "longseat:request-deadlines", q["id"])}

    def mirrored(s: dict) -> bool:
        return (all(v == h["id"] for v in s["holds"]) and all(0 < t <= SEAT_HOLD_SECONDS for t in s["ttls"])
                and s["score"] is not None and abs(float(s["score"]) - deadline_ms) <= ISO_MS_SLACK)

    assert mirrored(state()), f"Valkey does not mirror the hold and request deadline: {state()}"
    valkey_write(("DEL", *hold_keys), ("ZREM", "longseat:request-deadlines", q["id"]))
    lost = state()
    assert lost["score"] is None and not any(lost["holds"]), f"the simulated loss did not take: {lost}"
    poll(app_url, state, mirrored, "the sweep rebuilt the lost hold keys and request deadline from PostgreSQL")
    with extra_instance() as extra:
        r = call(env("APP_MAIL_DOWN_URL"), "POST", f"/api/rides/{w.rides['r']}/cancel", w.s("mara"), key=idempotency_key())
        notices = ok(r, 200, "cancel on the mail-down copy")["notices"]
        assert sorted(n["passenger_id"] for n in notices) == sorted(w.id(k) for k in pax)
        for _ in range(SWEEP_ROUNDS):
            barrier = threading.Barrier(2)

            def sweep(base: str, gate: threading.Barrier = barrier) -> None:
                gate.wait()
                clock(base, 0)

            threads = [threading.Thread(target=sweep, args=(b,)) for b in (app_url, extra)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=HTTP_TIMEOUT * 2)
        subject = f"Your Longseat ride on {ddd(day)} was cancelled"
        for k in pax:
            exactly(mail, w.emails[k], subject)
    founder = seed(app_url, {"wren": {"roles": ["founder"]}})
    rows = [i for i in ok(founder.api("GET", "/api/founder/outbox", "wren"), 200, "outbox")["items"]
            if i["to"] in {w.emails[k] for k in pax}]
    assert len(rows) == len(pax) and all(i["status"] == "sent" and i["kind"] == "cancellation" and i["attempts"] >= 1 for i in rows)


@pytest.mark.parametrize("mode", ["full", "reduced"], ids=["full", "reduced"])
def test_motion_attributes(browser: Browser, app_url: str, mode: str) -> None:
    reduced = mode == "reduced"
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"]}}, rides=[ride("r", "mara", at(day, 8, 30))])

    def expected_ms(name: str) -> str:
        return "0" if reduced else str(MOTION[name])

    def running(page: Page, name: str) -> bool:
        return any(st == "running" for _, st in motion_states(page, name))

    with opened(browser, app_url, f"/rides/{w.rides['r']}", w.s("lune"), reduced=reduced) as p:
        assert p.evaluate("() => document.documentElement.getAttribute('data-motion-pref')") == ("reduced" if reduced else "full")
        slider = p.get_by_role("slider", name="Boarding stop")
        see(p, slider, "Leg Span")
        p.evaluate(MOTION_LOG)
        press(p, slider, "ArrowRight")
        announced(p, f"Brisanne to Tollemarch, {span_km(ROUTE, 'Brisanne', 'Tollemarch')} km, 3 seats free, "
                     f"{euros(seg_price(WHOLE_PRICE, ROUTE, 'Brisanne', 'Tollemarch'))}")
        for name in ("handle-snap", "price-roll"):
            found = motion_states(p, name)
            assert found, f"no element publishes data-motion={name}"
            assert all(ms == expected_ms(name) for ms, _ in found), f"{name} publishes {found}"
        if reduced:
            assert not [e for e in motion_log(p, "handle-snap") + motion_log(p, "price-roll") if e[2] == "running"]
        else:
            advance(p, MOTION["price-roll"] * 2)
            press(p, slider, "End")
            assert running(p, "handle-snap"), "End started no handle-snap"
            advance(p, MOTION["handle-snap"] // 2)
            assert running(p, "handle-snap"), "handle-snap ended before its published duration"
            advance(p, MOTION["handle-snap"])
            eventually(p, lambda: ensure(not running(p, "handle-snap"), "still running"), "handle-snap reached done")
            eventually(p, lambda: ensure(not running(p, "price-roll"), "still running"), "price-roll reached done")
    with opened(browser, app_url, "/", w.s("lune"), reduced=reduced) as p:
        town(p, "Leaving from", "bri", "Brisanne")
        town(p, "Going to", "tol", "Tollemarch")
        press(p, p.get_by_role("button", name="Swap cities"), "Enter")
        announced(p, "Leaving from Tollemarch, going to Brisanne")
        found = motion_states(p, "swap-rotate")
        assert found, "no element publishes data-motion=swap-rotate"
        assert all(ms == expected_ms("swap-rotate") for ms, _ in found), f"swap-rotate publishes {found}"
        if reduced:
            assert all(st == "done" for _, st in found), f"reduced swap-rotate states {found}"
        else:
            eventually(p, lambda: ensure(all(st == "done" for _, st in motion_states(p, "swap-rotate")), "not done"),
                       "swap-rotate reached done")


DIALOG_CASES = ["choose_date", "filters", "add_money", "confirm_seat", "cancel_booking", "change_departure", "cancel_ride",
                "ask_upload_again"]


@pytest.mark.parametrize("case", DIALOG_CASES, ids=DIALOG_CASES)
def test_dialog_keyboard(browser: Browser, app_url: str, case: str) -> None:
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"roles": ["passenger"], "wallet": WALLET_CENTS},
                       "tobin": {"roles": ["passenger"], "id_state": "pending"}, "wren": {"roles": ["founder"]},
                       "pax": {"roles": ["passenger"], "wallet": WALLET_CENTS}},
             rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("b", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    path, who, opener_role, dialog_name = {
        "choose_date": ("/", "lune", ("button", re.compile(r"^Date, ")), "Choose a date"),
        "filters": (search_path("Brisanne", "Tollemarch", day), "lune", ("button", "Filters"), "Filters"),
        "add_money": ("/wallet", "lune", ("button", "Add money"), "Add money"),
        "confirm_seat": (f"/rides/{w.rides['r']}", "pax", ("button", "Book"), "Confirm your seat"),
        "cancel_booking": (f"/bookings/{w.bookings['b']}", "lune", ("button", "Cancel my seat"), "Cancel this booking"),
        "change_departure": (f"/rides/{w.rides['r']}", "mara", ("button", "Change departure"), "Change departure"),
        "cancel_ride": (f"/rides/{w.rides['r']}", "mara", ("button", "Cancel ride"), "Cancel this ride"),
        "ask_upload_again": ("/founder/id-review", "wren", ("button", f"Ask {w.names['tobin']} to upload again"), "Ask for a new upload"),
    }[case]
    with opened(browser, app_url, path, w.s(who)) as p:
        opener = p.get_by_role(opener_role[0], name=opener_role[1], exact=isinstance(opener_role[1], str))
        see(p, opener, f"opener for {dialog_name}")
        _, focus = state_styles(opener, "outline-style", "outline-width", state="focus")
        assert focus["outline-style"] != "none" and focus["outline-width"] not in ("0px", ""), f"no focus outline: {focus}"
        press(p, opener, "Enter")
        dialog = p.get_by_role("dialog", name=dialog_name)
        see(p, dialog, f"dialog {dialog_name!r} opened")
        for key in ("Tab", "Shift+Tab"):
            for i in range(TAB_PRESSES):
                p.keyboard.press(key)
                assert dialog.evaluate("e => e.contains(document.activeElement)"), f"{key} #{i + 1} left {dialog_name!r}"
        p.keyboard.press("Escape")
        hidden(p, dialog, f"Escape closed {dialog_name!r}")
        focused(p, opener, "focus returned to the opener")
    if case == "confirm_seat":
        rows = ok(w.api("GET", f"/api/rides/{w.rides['r']}/bookings", "mara"), 200, "bookings")["bookings"]
        assert all(r["state"] != "held" for r in rows), "Escape did not end the hold"


VIEWPORTS = ["phone", "tablet", "desktop"]


@pytest.mark.parametrize("size", VIEWPORTS, ids=VIEWPORTS)
def test_three_viewports(browser: Browser, app_url: str, size: str) -> None:
    viewport = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}[size]
    now = server_now(app_url)
    day = local(now).date() + timedelta(days=3)
    w = seed(app_url, {"mara": {"car": 3}, "lune": {"wallet": WALLET_CENTS}}, rides=[ride("r", "mara", at(day, 8, 30))],
             bookings=[booking("b", "r", "lune", "Kestrevel", "Brisanne", created=now - timedelta(hours=1))])
    paths = ["/", search_path("Brisanne", "Tollemarch", day), f"/rides/{w.rides['r']}", f"/bookings/{w.bookings['b']}",
             "/wallet", f"/earnings?month={month_key(day)}", "/profile", "/my-rides?tab=upcoming", "/offer",
             "/no-such-page"]
    with opened(browser, app_url, "/", w.s("lune"), viewport=viewport, touch=size == "phone") as p:
        for path in paths:
            p.goto(app_url + path)
            see(p, p.get_by_role("link", name="Longseat"), f"{path} rendered")
            advance(p, SHUTTER_MAX_MS)
            layout(p)
            for role in ("button", "link"):
                for loc in p.get_by_role(role).all():
                    box = loc.bounding_box() if loc.is_visible() else None
                    if box:
                        assert round(box["width"]) >= TAP_MIN_PX and round(box["height"]) >= TAP_MIN_PX, \
                            f"{path}: {role} {loc.text_content()!r} is {box['width']:.0f}x{box['height']:.0f}"
        if size == "phone":
            menu = p.get_by_role("button", name="Menu")
            tap(menu)
            see(p, p.get_by_role("dialog", name="Menu").get_by_role("link", name="Wallet"), "Menu sheet has the navigation")
        else:
            see(p, p.get_by_role("navigation", name="Main").get_by_role("link", name="Wallet"), "navigation inline")


def test_server_boundary(browser: Browser, app_url: str) -> None:
    assert ok(call(app_url, "GET", "/health"), 200, "health") == {"status": "ok"}
    for name in ("APP_MAIL_DOWN_URL", "APP_STORAGE_DOWN_URL"):
        assert ok(call(env(name), "GET", "/health"), 200, f"{name} health") == {"status": "unavailable"}
    secrets = [v for k in ("GRADING_TOKEN", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "VALKEY_URL")
               if len(v := os.environ.get(k, "")) >= 8]
    for path in ("/run.json", "/package-lock.json", "/package.json", "/.env", "/tsconfig.json", "/src/server.ts"):
        r = call(app_url, "GET", path)
        assert r.status_code == 404 and "run-manifest-v1" not in r.text, f"{path} answered {r.status_code}"
    w = seed(app_url, {"lune": {"roles": ["passenger"], "wallet": TOP_UP_CENTS}})
    fails(w.api("POST", "/api/wallet/top-ups", "lune", body={"amount_cents": TOP_UP_CENTS}, headers={"Origin": "http://elsewhere.test"}),
          403, "forbidden")
    assert wallet(w, "lune")["balance_cents"] == TOP_UP_CENTS
    bodies, foreign = [], []
    with opened(browser, app_url, "/", w.s("lune")) as p:
        p.on("request", lambda req: foreign.append(req.url) if not req.url.startswith(("data:", "blob:")) and not same_origin(req.url, app_url) else None)
        p.on("response", lambda resp: bodies.append(resp) if same_origin(resp.url, app_url) else None)
        for path in ("/", "/wallet", "/no-such-page"):
            p.goto(app_url + path)
            see(p, p.get_by_role("link", name="Longseat"), f"{path} rendered")
        see(p, p.get_by_role("heading", name="We could not find that page"), "not-found heading")
        expect(p.get_by_role("link", name="Back to search")).to_be_visible()
        assert p.evaluate("async () => (await navigator.serviceWorker?.getRegistrations?.() || []).length") == 0
        texts = []
        for resp in bodies:
            try:
                texts.append(resp.text())
            except Exception:
                pass
    assert call(app_url, "GET", "/no-such-page").status_code == 404
    assert not foreign, f"the page loaded from other origins: {foreign[:5]}"
    for secret in secrets:
        assert not any(secret in t for t in texts), "a configured secret reached the browser"


APP = Path("/app")


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing[:20]}"


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCE_ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"


FOREIGN_CLIENTS = {"mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "kafkajs", "amqplib", "nats",
                   "@elastic/elasticsearch", "firebase", "firebase-admin", "cassandra-driver", "neo4j-driver",
                   "@google-cloud/storage", "@supabase/supabase-js", "memcached", "stripe", "twilio"}


def test_if_no_extra_services() -> None:
    found = sorted({p.name for p in shipped_packages()} & FOREIGN_CLIENTS)
    assert not found, f"shipped clients for other services: {found}"


COMPOSE_NAMES = ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
EDIT_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit", "str_replace_editor", "write_file", "edit_file"}
TRAJECTORY = Path("/logs/agent/trajectory.json")
SERVICE_NAMES = ("postgres", "valkey", "minio", "mailpit")


def tool_nodes(node: Any) -> Iterator[dict]:
    if isinstance(node, dict):
        if node.get("name") in EDIT_TOOLS:
            yield node
        for value in node.values():
            yield from tool_nodes(value)
    elif isinstance(node, list):
        for value in node:
            yield from tool_nodes(value)


PATH_KEYS = {"file_path", "path", "notebook_path", "filePath"}


def target_paths(node: Any) -> Iterator[str]:
    if isinstance(node, dict):
        for key, value in node.items():
            if key in PATH_KEYS and isinstance(value, str):
                yield value
            else:
                yield from target_paths(value)
    elif isinstance(node, list):
        for value in node:
            yield from target_paths(value)


def test_if_compose_unchanged() -> None:
    files = [f for f in APP.rglob("*") if f.is_file() and f.name in COMPOSE_NAMES and "node_modules" not in f.parts]
    assert files, "the development compose file is gone"
    content = "\n".join(f.read_text() for f in files).lower()
    for name in SERVICE_NAMES:
        assert name in content, f"compose file no longer defines {name}"
    if TRAJECTORY.exists():
        edits = [json.dumps(n)[:200] for n in tool_nodes(json.loads(TRAJECTORY.read_text()))
                 if any(Path(t).name in COMPOSE_NAMES for t in target_paths(n))]
        assert not edits, f"the agent edited the compose file: {edits[:3]}"


def test_if_typescript_lockfile() -> None:
    assert (APP / "package-lock.json").exists() or (APP / "npm-shrinkwrap.json").exists()
    skip = {"node_modules", "dist", "build", ".git", "public"}
    ts, js = [], []
    for f in APP.rglob("*"):
        if f.is_file() and not skip & set(f.relative_to(APP).parts):
            if f.suffix in (".ts", ".tsx"):
                ts.append(f)
            elif f.suffix in (".js", ".jsx", ".mjs", ".cjs") and {"src", "server", "client"} & set(f.relative_to(APP).parts):
                js.append(f)
    assert ts, "no TypeScript source"
    assert not js, f"JavaScript source files: {[str(f) for f in js[:10]]}"
