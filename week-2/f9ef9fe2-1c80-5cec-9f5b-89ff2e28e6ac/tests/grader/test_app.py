import contextlib
import csv
import fnmatch
import io
import json
import os
import random
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from datetime import time as dtime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Page, expect

from conftest import (
    AXE,
    CLOCK_START,
    DEPLOYED_APP,
    HERE,
    S3,
    Postgres,
    addresses,
    advance,
    animations,
    capture,
    center,
    click,
    decode,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    post_json,
    select,
    settle,
    text,
)

APP_ROOT = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")
PASSWORD = "nightshift-demo-26"

NSC = "kit-nsc"
LARK = "kit-lark"
NSC_NAME = "Night Shift Commons"
LARK_NAME = "Larkspur Commissary"
NSC_ZONE = "America/Chicago"

OPERATOR = "operator@nightshift.test"
EMBER = "ember@pilotlight.test"
SALTLINE = "saltline@pilotlight.test"
WREN = "wren@pilotlight.test"
TIDEWATER = "tidewater@pilotlight.test"
INES = "books@ledgerline.test"
TEO = "operator@larkspur.test"
COPPER = "copperpot@pilotlight.test"

SEEDED = [
    (OPERATOR, "operator", NSC, None),
    (EMBER, "member", NSC, "mem-ember"),
    (SALTLINE, "member", NSC, "mem-saltline"),
    (WREN, "member", NSC, "mem-wren"),
    (TIDEWATER, "member", NSC, "mem-tidewater"),
    (INES, "bookkeeper", NSC, None),
    (TEO, "operator", LARK, None),
    (COPPER, "member", LARK, "mem-copper"),
]

STATION_NAME = {
    "st-deck-1": "Deck oven 1",
    "st-deck-2": "Deck oven 2",
    "st-convection": "Convection oven",
    "st-mixer": "60-quart mixer",
    "st-chiller": "Blast chiller",
    "st-prep-a": "Prep table A",
    "st-prep-b": "Prep table B",
    "st-range": "Six-burner range",
    "st-kettle": "Steam kettle",
    "st-walkin": "Walk-in cooler",
}
NSC_STATIONS = list(STATION_NAME)
LARK_STATIONS = ["st-l-oven", "st-l-mixer", "st-l-kettle", "st-l-prep", "st-l-chiller", "st-l-cooler"]
NSC_BUSINESSES = ("Ember & Rye Bakery", "Saltline Catering", "Wren Street Dumplings", "Tidewater Granola")
MEM_EMBER = "mem-ember"
MEM_SALTLINE = "mem-saltline"
MEM_WREN = "mem-wren"
EMBER_COI = "doc-ember-coi"
SALTLINE_COI = "doc-saltline-coi"
TIDE_COI = "doc-tide-coi"

FIRST_CELL = "04:00"
LAST_CELL = "23:45"
COLUMNS = 80
QUARTER_MINUTES = 15
HORIZON_DAYS = 365
MAX_CELLS = 320
PACK_QUARTERS = 80
SEED_WINDOW_HOURS = 72
WINDOW_MAX_HOURS = 336
WEEKS_MIN = 2
WEEKS_MAX = 12
JSON_LIMIT = 64000
FILE_LIMIT = 5_000_000
NAME_MAX = 200
REASON_MAX = 300
REMINDER_DAYS = 14
REMINDER_SECONDS = 60
RECOVERY_SECONDS = 30
STATUS_SECONDS = 15
POLL_SECONDS = 10

TARGET_PX = 44
FOCUS_RING_PX = 2
LIGHT_MAX_MS = 250
STAGGER_MIN_MS = 30
STAGGER_MAX_MS = 60
COUNT_MIN_MS = 250
COUNT_MAX_MS = 400

WIDE = (1280, 800)
MIDDLE = (768, 1024)
NARROW = (375, 812)

CELL_LABELS = ("Selected", "Held", "Booked", "Taken", "Conflict", "Papers")
CSV_HEADER = "invoice_ref,kind,member,booking_ref,date,station,tier,paid_by,hours,amount"
BILLING_DOWN_COPY = ("Billing is unreachable. Confirming, cancelling, recurring slots and pack purchases are paused. "
                     "Brushing and holds still work.")
FILES_DOWN_COPY = ("File storage is unreachable. Uploading and opening documents are paused. "
                   "Bookings still use the papers on file.")
BILLING_PAUSED = {"confirm_booking", "create_series", "cancel_booking", "buy_pack"}
FILES_PAUSED = {"upload_document", "view_document"}
TYPEFACES = ("Instrument Serif", "Inter", "JetBrains Mono")
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}

FOREIGN = "http://elsewhere.invalid"
PROBE_ZONE = "Pacific/Auckland"
PRIVATE_PATHS = ("/run.json", "/package.json", "/package-lock.json", "/.env", "/.git/config",
                 "/node_modules/.package-lock.json", "/tsconfig.json", "/src/server.ts")
NEAR = 7
FAR = 120
QUIET_FROM = 121
QUIET_TO = 300
FUTURE_CARD_FROM = 400
FUTURE_CARD_TO = 3000
NEW_TIERS = ("40.00", "37.00", "34.00", "31.00")
NEW_SURCHARGE = "7.00"
NEW_WINDOW = 48
NEW_PACK = "640.00"
RACERS = 8
RIG_HOLD_SECONDS = 20
UNKNOWN_ID = "no-such-booking"
REJECT_REASON = "Blurry scan"

PDF_BYTES = b"%PDF-1.4\n%probe document\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + bytes(24)
JPEG_BYTES = b"\xff\xd8\xff\xe0" + bytes(24)
SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML_BYTES = b"<!doctype html><script>alert(1)</script>"

HTTP_TIMEOUT = 30
DEPENDENCY_DIR = "node_modules"
COOKIE_NAME = "pl_session"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax", "Path=/")
NPM_SECONDS = 300
MAIL_SECONDS = 30
MAIL_SLACK = 30
MAIL_SETTLE = 3
BOOT_SECONDS = 240
STOP_SECONDS = 20
CONNECT_SECONDS = 5
POLL_INTERVAL = 0.5
SPAN_SLACK = 2
CLOCK_SKEW = 1
BAR_SLACK = 1.5
UI_SECONDS = 30
UI_MS = 30000
EXPECT_MS = 500
STEP_MS = 100
FINE_STEP_MS = 10
SAMPLE_END_MS = 600
DIM_SETTLE_MS = 500
MOTION_TOL_MS = 20
COUNTDOWN_PROBE_MS = 3000
TAB_LIMIT = 40
BANNER_STEP_MS = 1000
ROUNDING_PX = 1
EDGE_SLACK = 0.5
NUDGE_PX = 1
ACTION_MS = 5000
NAVIGATION_MS = 15000
AXE_POLLS = 625
AXE_STEP_MS = 16
ID_MIN = 8
ID_FIELD = re.compile(r"(^|_)(id|ref|business|member|owner|name)$")
OPENER = re.compile(r"\b(open|view|details?|(?<!no-)(?<!no )show|select|more|expand)\b", re.I)
LOADER = re.compile(r"\b(load|show|view|run|go|apply|submit|update|refresh)\b|report", re.I)
OUTCOME_WORDS = {
    "in window": (r"\bin[- ]window\b", r"\boutside the \d+-hour\b", r"\bbefore the \d+-hour\b"),
    "late": (r"\blate\b", r"\binside the \d+-hour\b", r"\bstill charged\b"),
}

BUILD_DIRS = {".next", ".nuxt", ".output", ".svelte-kit", ".vite", ".turbo", ".cache", ".parcel-cache", "coverage"}
BUILD_PREFIXES = ("dist", "build", "out")
TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs", "e2e", "cypress", "playwright"}
TEST_FILE = re.compile(r"\.(test|spec|e2e)\.[cm]?[jt]sx?$")
COMPILED_MARKS = ("sourceMappingURL=", 'Object.defineProperty(exports, "__esModule"')
SERVICE_CONFIG = re.compile(r"^/(etc|var/lib|opt|srv|usr/local/etc|usr/share)/(.*/)?"
                            r"(postgres\w*|pg\w*|killbill\w*|kill-bill|kaui|minio\w*|mailpit\w*)(/|$)"
                            r"|/docker-entrypoint-initdb\.d(/|$)", re.I)
COMPOSE_FILE = re.compile(r"^(docker-)?compose(\.[\w-]+)?\.ya?ml$|^Dockerfile(\.[\w-]+)?$", re.I)
JS_SUFFIXES = (".js", ".jsx", ".mjs", ".cjs")
TS_SUFFIXES = (".ts", ".tsx")
STRICT_FLAGS = ("noImplicitAny", "strictNullChecks", "strictFunctionTypes", "strictBindCallApply",
                "strictPropertyInitialization", "noImplicitThis", "alwaysStrict")
STORE_SUFFIXES = (".json", ".csv")


def poll(check_fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        result = check_fn()
        if result:
            return result
        assert time.monotonic() < deadline, f"timed out waiting for {what}"
        threading.Event().wait(POLL_INTERVAL)


def truth(value: Any, why: str = "") -> None:
    assert value, why


def origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def tag(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def block(stations: list[str], start: str, end: str) -> list[dict]:
    return [{"station_id": s, "start": clock(m)} for s in stations
            for m in range(mins(start), mins(end), QUARTER_MINUTES)]


def keys(cells: list[dict]) -> set[tuple[str, str]]:
    return {(c["station_id"], c["start"]) for c in cells}


def hours_text(quarters: int) -> str:
    return f"{Decimal(quarters) / 4:.2f}"


def quarters_of(hours: str) -> int:
    return int(Decimal(hours) * 4)


def to_cents(amount: str) -> int:
    return int((Decimal(amount.replace("$", "").replace(",", "")) * 100).quantize(Decimal(1), ROUND_HALF_UP))


def dollars(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def cents_of(shown: str) -> int | None:
    found = re.search(r"\$([\d,]+\.\d{2})", shown)
    return to_cents(found.group(1)) if found else None


def instant(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def local(stamp: str, zone: str = NSC_ZONE) -> datetime:
    return instant(stamp).astimezone(ZoneInfo(zone))


EXAMPLE_LINES = [
    ("st-deck-1", 1, "cash", 8, to_cents("$76.00")), ("st-deck-1", 2, "cash", 1, to_cents("$8.88")),
    ("st-deck-2", 1, "cash", 8, to_cents("$76.00")), ("st-deck-2", 2, "cash", 1, to_cents("$8.88")),
    ("st-mixer", 1, "cash", 8, to_cents("$71.50")), ("st-mixer", 2, "cash", 1, to_cents("$8.31")),
    ("st-chiller", 1, "cash", 8, to_cents("$75.00")), ("st-chiller", 2, "cash", 1, to_cents("$8.75")),
]
EXAMPLE_TOTAL = to_cents("$333.32")


class Api:
    def __init__(self, base: str, email: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, headers={"Origin": origin(self.base)})
        self.user: dict | None = None
        if email:
            r = self.http.post("/api/session", json={"email": email, "password": PASSWORD})
            assert r.status_code == 200, r.text
            self.user = r.json()["user"]

    @property
    def member_id(self) -> str:
        return self.user["member_id"]

    def get(self, path: str, **params: str) -> httpx.Response:
        return self.http.get(path, params=params or None)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        headers = {"Idempotency-Key": key} if key is not None else {}
        return self.http.post(path, json={} if body is None else body, headers=headers)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)


def refused(r: httpx.Response, code: int, error: str) -> dict:
    assert r.status_code == code, f"{r.status_code} {r.text}"
    body = r.json()
    assert body["error"] == error and isinstance(body["message"], str), body
    return body


def status(base: str) -> dict:
    r = httpx.get(base.rstrip("/") + "/api/status", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def reachable(base: str) -> bool:
    try:
        return httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).status_code == 200
    except httpx.HTTPError:
        return False


def outage(url_env: str, service: str) -> str:
    base = os.environ[url_env].rstrip("/")
    poll(lambda: reachable(base) and status(base)["services"][service] == "down", BOOT_SECONDS,
         f"{url_env} reporting {service} down")
    return base


def kitchen(api: Api, kid: str | None = None) -> dict:
    r = api.get(f"/api/kitchens/{kid or api.user['kitchen_id']}")
    assert r.status_code == 200, r.text
    return r.json()["kitchen"]


def today_of(api: Api) -> date:
    return date.fromisoformat(kitchen(api)["today"])


def station_order(api: Api, kid: str | None = None) -> dict[str, int]:
    return {s["id"]: s["order"] for s in kitchen(api, kid)["stations"]}


def in_force_card(op: Api, kid: str = NSC) -> dict:
    r = op.get(f"/api/kitchens/{kid}/rate-cards")
    assert r.status_code == 200, r.text
    return next(c for c in r.json()["rate_cards"] if c["in_force"])


def tier_of(count: int) -> int:
    if count < 32:
        return 1
    if count < 80:
        return 2
    if count < 120:
        return 3
    return 4


def price(cells: list[dict], start_quarters: int, card: dict, order: dict[str, int],
          pack_quarters: int = 0) -> tuple[list[tuple], list[int]]:
    walk = sorted(cells, key=lambda c: (c["start"], order[c["station_id"]]))
    groups: dict[tuple[str, int, str], int] = {}
    count = start_quarters
    first_tier = tier_of(count)
    entered: list[int] = []
    for i, c in enumerate(walk):
        tier = tier_of(count)
        if tier > first_tier and tier not in entered:
            entered.append(tier)
        paid = "pack" if i < pack_quarters else "cash"
        k = (c["station_id"], tier, paid)
        groups[k] = groups.get(k, 0) + 1
        count += 1
    lines = []
    for (sid, tier, paid), q in sorted(groups.items(), key=lambda kv: (order[kv[0][0]], kv[0][1], kv[0][2] == "pack")):
        rate = card["tier_rates_cents"][tier - 1] + card["station_surcharges_cents"][sid]
        amount = 0 if paid == "pack" else (q * rate + 2) // 4
        lines.append((sid, tier, paid, q, rate, amount))
    return lines, entered


def shape(lines: list[dict]) -> list[tuple]:
    return [(l["station_id"], l["tier"], l["paid_by"], l["quarters"], l["hourly_rate_cents"], l["amount_cents"])
            for l in lines]


def quote(api: Api, d: str, cells: list[dict], use_pack: bool = False, member_id: str | None = None) -> dict:
    body: dict[str, Any] = {"date": d, "cells": cells, "use_pack": use_pack}
    if member_id:
        body["member_id"] = member_id
    r = api.post("/api/quotes", body)
    assert r.status_code == 200, r.text
    return r.json()


def loom(api: Api, d: str, member_id: str | None = None) -> dict:
    params = {"date": d, **({"member_id": member_id} if member_id else {})}
    r = api.get(f"/api/kitchens/{api.user['kitchen_id']}/loom", **params)
    assert r.status_code == 200, r.text
    return r.json()


def find_slot(api: Api, candidates: list[list[dict]], first: int = NEAR, last: int = FAR) -> tuple[str, list[dict]]:
    today = today_of(api)
    offsets = list(range(first, last + 1))
    random.shuffle(offsets)
    for off in offsets:
        d = (today + timedelta(days=off)).isoformat()
        for cells in candidates:
            body = quote(api, d, cells)
            if not body["taken"] and not body["papers"]:
                return d, cells
    pytest.fail("no free slot found")


def free_date(api: Api, cells: list[dict], first: int = NEAR, last: int = FAR) -> str:
    return find_slot(api, [cells], first, last)[0]


def place_hold(api: Api, d: str, cells: list[dict]) -> dict:
    r = api.post("/api/holds", {"date": d, "cells": cells})
    assert r.status_code == 201, r.text
    return r.json()["hold"]


def release(api: Api, hold_id: str) -> None:
    api.delete(f"/api/holds/{hold_id}")


def confirm(api: Api, hold_id: str, total: int, use_pack: bool = False, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/holds/{hold_id}/confirm", {"use_pack": use_pack, "quoted_total_cents": total},
                    key=key or idempotency_key())


def book(api: Api, d: str, cells: list[dict], use_pack: bool = False) -> dict:
    q = quote(api, d, cells, use_pack)["quote"]
    h = place_hold(api, d, cells)
    r = confirm(api, h["id"], q["total_cents"], use_pack)
    assert r.status_code == 201, r.text
    return r.json()


def cancel(api: Api, booking_id: str) -> httpx.Response:
    return api.post(f"/api/bookings/{booking_id}/cancel", {})


def own_bookings(api: Api, d: str) -> list[dict]:
    r = api.get("/api/bookings", date=d)
    assert r.status_code == 200, r.text
    return [b for b in r.json()["bookings"] if b["date"] == d and not b["state"].startswith("cancelled")]


def buy_pack(api: Api, member_id: str, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/members/{member_id}/packs", {}, key=key or idempotency_key())


def pack(api: Api, member_id: str) -> dict:
    r = api.get(f"/api/members/{member_id}/pack")
    assert r.status_code == 200, r.text
    return r.json()


def upload(api: Api, fields: dict[str, str], name: str, content: bytes) -> httpx.Response:
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    filename = name.replace('"', "%22")
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                 f"Content-Type: application/octet-stream\r\n\r\n".encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return api.http.post("/api/documents", content=b"".join(parts),
                         headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def documents(api: Api) -> list[dict]:
    r = api.get("/api/documents")
    assert r.status_code == 200, r.text
    return r.json()["documents"]


def uncovered_date(op: Api, member_id: str) -> str:
    today = today_of(op)
    cover = op.get(f"/api/members/{member_id}").json()["member"]["covered_until"]
    if cover is None:
        return (today + timedelta(days=NEAR)).isoformat()
    d = max(date.fromisoformat(cover) + timedelta(days=1), today)
    assert d <= today + timedelta(days=HORIZON_DAYS), "cover reaches past the booking horizon"
    return d.isoformat()


@contextlib.contextmanager
def same_day_open(op: Api) -> Iterator[None]:
    kid = op.user["kitchen_id"]
    before = kitchen(op)["same_day_cutoff"]
    assert op.patch(f"/api/kitchens/{kid}/settings", {"same_day_cutoff": LAST_CELL}).status_code == 200
    try:
        yield
    finally:
        op.patch(f"/api/kitchens/{kid}/settings", {"same_day_cutoff": before})


def kitchen_now(api: Api) -> tuple[str, int]:
    k = kitchen(api)
    now = local(k["server_now"], k["timezone"])
    return k["today"], now.hour * 60 + now.minute


DAY_KITCHENS = [
    (OPERATOR, [(SALTLINE, "mem-saltline", "Saltline Catering"), (WREN, "mem-wren", "Wren Street Dumplings")], NSC_STATIONS),
    (TEO, [(COPPER, "mem-copper", "Copper Pot Jams"), (COPPER, "mem-copper", "Copper Pot Jams")], LARK_STATIONS),
]


def today_cells(op: Api, member_id: str, stations: list[str], n: int) -> tuple[str, list[list[dict]]] | None:
    today, now_at = kitchen_now(op)
    margin = 2
    start = max(mins(FIRST_CELL), ((now_at + margin) // QUARTER_MINUTES + 1) * QUARTER_MINUTES)
    picks: list[list[dict]] = []
    for at in range(start, mins(LAST_CELL) + 1, QUARTER_MINUTES):
        for s in stations:
            cells = [{"station_id": s, "start": clock(at)}]
            body = quote(op, today, cells, member_id=member_id)
            if not body["taken"] and not body["papers"]:
                picks.append(cells)
                if len(picks) == n:
                    return today, picks
    return None


@contextlib.contextmanager
def today_bookings(app_url: str, n: int) -> Iterator[tuple[str, Api, str, list[tuple[Api, dict, str]]]]:
    for op_email, members, stations in DAY_KITCHENS:
        op = Api(app_url, op_email)
        with same_day_open(op):
            found = today_cells(op, members[0][1], stations, n)
            if not found:
                continue
            d, picks = found
            made = []
            for (email, _, business), cells in zip(members, picks):
                member = Api(app_url, email)
                made.append((member, book(member, d, cells)["booking"], business))
        yield op_email, op, d, made
        return
    pytest.fail("no seeded kitchen has a quarter hour left today")


def recipients(message: dict) -> list[str]:
    return addresses(message["To"])


def mail_text(message: dict) -> str:
    return text(message)


def mail_ids(mail) -> set[str]:
    return {m["ID"] for m in mail.messages(settle=0)}


def fresh_mail(mail, seen: set[str], pred: Callable[[dict], bool], settle: float) -> list[dict]:
    return [m for m in mail.messages(settle=settle) if m["ID"] not in seen and pred(m)]


def await_mail(mail, seen: set[str], pred: Callable[[dict], bool], count: int = 1,
               seconds: float = MAIL_SECONDS) -> list[dict]:
    def found() -> list[dict] | None:
        got = fresh_mail(mail, seen, pred, 0)
        return got if len(got) >= count else None

    return poll(found, seconds, "mail")


def settled_mail(mail, seen: set[str], pred: Callable[[dict], bool]) -> list[dict]:
    return fresh_mail(mail, seen, pred, MAIL_SETTLE)


class Relay:
    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        self.port = probe.getsockname()[1]
        probe.close()
        self.listener: socket.socket | None = None
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()

    def open(self) -> None:
        if self.listener:
            return
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.listener = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def _accept(self, s: socket.socket) -> None:
        while True:
            try:
                client, _ = s.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=CONNECT_SECONDS)
                upstream.settimeout(None)
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
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for sock in (src, dst):
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def close(self) -> None:
        s, self.listener = self.listener, None
        if s:
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            s.close()
        with self.lock:
            conns, self.conns = self.conns, []
        for c in conns:
            try:
                c.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            c.close()

    def stop(self) -> None:
        self.close()


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def log_tail(log: Path) -> str:
    return log.read_text(errors="replace")[-4000:]


@contextlib.contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = Path(tempfile.mkstemp(suffix=".log")[1])
    base = f"http://127.0.0.1:{port}"
    with log.open("wb") as out:
        proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=out,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            def healthy() -> bool:
                assert proc.poll() is None, f"app copy exited before health:\n{log_tail(log)}"
                return reachable(base)

            poll(healthy, BOOT_SECONDS, "app copy health")
            yield base
            assert proc.poll() is None, f"app copy exited during the test:\n{log_tail(log)}"
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=STOP_SECONDS)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


def provider(url_env: str) -> tuple[str, int]:
    parts = urlsplit(os.environ[url_env])
    assert parts.hostname and parts.port, f"{url_env} must name a host and port"
    return parts.hostname, parts.port


class Rig:
    def __init__(self, base: str, relays: dict[str, Relay]) -> None:
        self.base = base
        self.relays = relays

    def ensure(self, **wanted: bool) -> None:
        for name, up in wanted.items():
            (self.relays[name].open if up else self.relays[name].close)()

        def matches() -> bool:
            services = status(self.base)["services"]
            return all(services[n] == ("up" if up else "down") for n, up in wanted.items())

        poll(matches, RECOVERY_SECONDS + STATUS_SECONDS, f"controlled copy services {wanted}")


@pytest.fixture(scope="module")
def rig() -> Iterator[Rig]:
    relays = {
        "billing": Relay(*provider("KILLBILL_URL")),
        "files": Relay(*provider("S3_ENDPOINT")),
        "mail": Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])),
    }
    for r in relays.values():
        r.open()
    kb = urlsplit(os.environ["KILLBILL_URL"])
    s3 = urlsplit(os.environ["S3_ENDPOINT"])
    env = {
        "KILLBILL_URL": f"{kb.scheme}://127.0.0.1:{relays['billing'].port}{kb.path}",
        "S3_ENDPOINT": f"{s3.scheme}://127.0.0.1:{relays['files'].port}{s3.path}",
        "SMTP_HOST": "127.0.0.1",
        "SMTP_PORT": str(relays["mail"].port),
        "PILOTLIGHT_HOLD_SECONDS": str(RIG_HOLD_SECONDS),
    }
    try:
        with app_copy(env) as base:
            yield Rig(base, relays)
    finally:
        for r in relays.values():
            r.stop()


def soon(page: Page, attempt: Callable[[], Any], seconds: float = UI_SECONDS, step: float = STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            attempt()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, step)


def shows(page: Page, locator) -> None:
    soon(page, lambda: expect(locator).to_be_visible(timeout=EXPECT_MS))


def says(page: Page, locator, value) -> None:
    soon(page, lambda: expect(locator).to_contain_text(value, timeout=EXPECT_MS))


def says_live(page: Page, locator, value) -> None:
    soon(page, lambda: expect(locator).to_contain_text(value, timeout=EXPECT_MS),
         seconds=RECOVERY_SECONDS + STATUS_SECONDS, step=BANNER_STEP_MS)


def nonempty(items: list, count: int = 1) -> None:
    assert len(items) >= count


class Watch:
    def __init__(self, page: Page, fragment: str, method: str = "POST") -> None:
        self.requests: list = []
        self.responses: list = []
        page.on("request", lambda r: self.requests.append(r) if fragment in r.url and r.method == method else None)
        page.on(
            "response",
            lambda r: self.responses.append(r) if fragment in r.url and r.request.method == method else None,
        )


def wait_responses(page: Page, watch: Watch, count: int) -> None:
    poll(lambda: page.evaluate("1") == 1 and len(watch.responses) >= count, UI_SECONDS, "browser API response")


def latest(watch: Watch) -> dict:
    response = watch.requests[-1].response()
    assert response is not None, "the latest request got no response"
    return response.json()


@contextlib.contextmanager
def open_mouse(browser, url: str, reduced_motion: str = "no-preference") -> Iterator[Page]:
    with contextlib.closing(browser.new_context(viewport={"width": WIDE[0], "height": WIDE[1]}, has_touch=False,
                                                reduced_motion=reduced_motion, service_workers="block")) as context:
        context.add_init_script(path=str(HERE / "instrument.js"))
        tab = context.new_page()
        tab.set_default_timeout(ACTION_MS)
        tab.set_default_navigation_timeout(NAVIGATION_MS)
        tab.clock.install(time=CLOCK_START)
        tab.clock.pause_at(CLOCK_START + 10)
        tab.goto(url)
        yield tab


def sign_in(page: Page, base: str, email: str) -> None:
    page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
    page.goto(base + "/signin")
    button = page.get_by_role("button", name="Sign in")
    shows(page, button)
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), PASSWORD)
    click(button)
    soon(page, lambda: expect(page).not_to_have_url(re.compile(r"/signin"), timeout=EXPECT_MS))


def cell(page: Page, station: str, start: str, label: str | None = None):
    if label is not None:
        return page.get_by_role("gridcell", name=f"{station}, {start}, {label}", exact=True)
    return page.get_by_role("gridcell", name=re.compile(rf"^{re.escape(station)}, {start}, "))


def open_loom(page: Page, base: str, d: str, query: str = "") -> None:
    page.goto(f"{base}/loom?date={d}{query}")
    shows(page, cell(page, "Deck oven 1", FIRST_CELL))


def go(page: Page, name: str) -> None:
    link = page.get_by_role("navigation", name="Main").get_by_role("link", name=name, exact=True)
    menu = page.get_by_role("button", name="Menu")
    if not link.is_visible() and menu.count() and menu.is_visible():
        click(menu)
    shows(page, link)
    click(link)


def inside(locator) -> bool:
    return bool(locator.evaluate("e => e.contains(document.activeElement)"))


def is_focused(locator) -> bool:
    return bool(locator.evaluate("e => e === document.activeElement"))


def focus_grid(page: Page) -> None:
    grid = page.get_by_role("grid", name="Station loom")
    for _ in range(TAB_LIMIT):
        if inside(grid):
            return
        page.keyboard.press("Tab")
    pytest.fail("Tab never reached the loom grid")


def tab_to(page: Page, locator) -> None:
    shows(page, locator)
    for _ in range(TAB_LIMIT):
        if is_focused(locator):
            return
        page.keyboard.press("Tab")
    pytest.fail("Tab never reached the control")


def press_on(page: Page, locator) -> None:
    x, y = center(locator)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + NUDGE_PX, y)


def aim(page: Page, locator) -> None:
    expect(locator).to_be_visible()
    locator.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    box = locator.bounding_box()
    assert box is not None
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def extend(page: Page, *arrows: str) -> None:
    page.keyboard.down("Shift")
    for key in arrows:
        page.keyboard.press(key)
    page.keyboard.up("Shift")


def set_month(page: Page, month: str) -> None:
    field = page.get_by_label("Month")
    shows(page, field)
    if field.evaluate("e => e.tagName") != "SELECT":
        fill(field, month)
        return
    named = date.fromisoformat(month + "-01").strftime("%B %Y")
    choice = month if field.evaluate("(e, m) => [...e.options].some(o => o.value === m || (o.label || o.text || '').trim() === m)", month) else named
    select(field, choice)


HIT_JS = "(e, p) => { const h = document.elementFromPoint(p.x, p.y); return h === e || e.contains(h); }"
LABEL_POINT_JS = (
    "e => { const l = e.labels && e.labels[0]; if (!l) return null;"
    " l.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});"
    " const r = l.getBoundingClientRect(); const p = {x: r.left + r.width / 2, y: r.top + r.height / 2};"
    " const h = document.elementFromPoint(p.x, p.y); return h === l || l.contains(h) || h === e ? p : null; }"
)


def set_box(locator, on: bool) -> None:
    if locator.is_checked() != on:
        expect(locator).to_be_enabled()
        locator.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
        box = locator.bounding_box()
        point = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2} if box else None
        if not (point and locator.evaluate(HIT_JS, point)):
            point = locator.evaluate(LABEL_POINT_JS)
        assert point, "checkbox is obscured and has no label to click"
        locator.page.mouse.click(point["x"], point["y"])
    expect(locator).to_be_checked(checked=on)


def hold_id_from(page: Page) -> str | None:
    found = parse_qs(urlsplit(page.url).query).get("hold")
    return found[0] if found else None


def loom_status(page: Page):
    return page.get_by_role("status", name="Loom status")


def form_status(page: Page):
    return page.get_by_role("status", name="Form status")


def booking_row(page: Page, ref: str):
    return page.get_by_role("table", name="Bookings").get_by_role("row").filter(has_text=ref)


def doc_row(page: Page, table, label: str, expires: str, business: str | None = None):
    rows = table.get_by_role("row").filter(has_text=label)
    if business:
        rows = rows.filter(has_text=business)
    picked: list = []

    def found() -> None:
        hits = [i for i in range(rows.count()) if mentions_date(rows.nth(i).inner_text(), expires)]
        assert hits, f"no {label} row expiring {expires}"
        picked[:] = [rows.nth(hits[0])]

    soon(page, found)
    return picked[0]


def opens(page: Page, target, controls: list) -> bool:
    for control in controls:
        if target.count() and target.first.is_visible():
            return True
        if not control.count() or not control.first.is_visible():
            continue
        with contextlib.suppress(AssertionError):
            click(control.first)
            soon(page, lambda: expect(target.first).to_be_visible(timeout=EXPECT_MS), seconds=UI_SECONDS / 6)
            return True
    return bool(target.count() and target.first.is_visible())


def open_booking(page: Page, ref: str):
    row = booking_row(page, ref).first
    shows(page, row)
    region = page.get_by_role("region", name=f"Booking {ref}")
    opens(page, region, [row.get_by_role("link", name=ref), row.get_by_role("button", name=ref),
                         row.get_by_text(ref), row.get_by_role("cell").first,
                         row.get_by_role("button", name=OPENER), row.get_by_role("link", name=OPENER)])
    shows(page, region)
    return region


LAYER_JS = (
    "const layer = (el, root) => { const r = el.getBoundingClientRect();"
    " const over = n => { if (n.contains(el) || el.contains(n)) return false; const b = n.getBoundingClientRect();"
    "  const x = b.left + b.width / 2, y = b.top + b.height / 2;"
    "  return b.width + b.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };"
    " return [el, ...el.querySelectorAll('*'), ...[...(root || el.parentElement || el).querySelectorAll('*')].filter(over)]; };"
)
TIMING_JS = (
    "(el, root) => { " + LAYER_JS + " return layer(el, root).flatMap(n => n.getAnimations({subtree: true}))"
    ".filter(a => a.playState !== 'finished').map(a => {"
    " const t = a.effect.getComputedTiming(); return {delay: Number(t.delay), duration: Number(t.duration)}; }); }"
)
LOOK_JS = (
    "(el, root) => { " + LAYER_JS + " return layer(el, root).map(n => { const s = getComputedStyle(n);"
    " return [s.stroke, s.fill, s.color, s.opacity, s.filter, s.borderColor, s.outlineColor, s.boxShadow].join('|'); })"
    ".join(';'); }"
)


def pixels_of(img) -> Any:
    return decode(capture(img))


def unlike(a, b) -> float:
    w, h = min(a.width, b.width), min(a.height, b.height)
    assert w > 0 and h > 0, "empty capture"

    def area(p) -> bytes:
        x0, y0 = (p.width - w) // 2, (p.height - h) // 2
        return b"".join(p.rgb[((y0 + y) * p.width + x0) * 3:((y0 + y) * p.width + x0 + w) * 3] for y in range(h))

    return sum(abs(x - y) for x, y in zip(area(a), area(b), strict=True)) / (w * h * 3)


def motion_starts(page: Page, imgs: list, trigger: Callable[[], Any], root=None,
                  horizon_ms: int = SAMPLE_END_MS) -> dict[int, tuple[float, float]]:
    handle = root.element_handle() if root is not None else None
    looks = [img.evaluate(LOOK_JS, handle) for img in imgs]
    shots = [pixels_of(img) for img in imgs]
    trigger()
    timed: dict[int, tuple[float, float]] = {}
    first: dict[int, float] = {}
    last: dict[int, float] = {}
    styled: set[int] = set()
    elapsed = 0
    while elapsed <= horizon_ms:
        for i, img in enumerate(imgs):
            if i not in timed:
                found = img.evaluate(TIMING_JS, handle)
                if found:
                    timed[i] = (elapsed + min(f["delay"] for f in found), max(f["duration"] for f in found))
            look = img.evaluate(LOOK_JS, handle)
            if look != looks[i]:
                styled.add(i)
                first.setdefault(i, elapsed)
                last[i] = elapsed
                looks[i] = look
            elif i not in timed and i not in styled:
                shot = pixels_of(img)
                if unlike(shot, shots[i]) > 0:
                    first.setdefault(i, elapsed)
                    last[i] = elapsed
                    shots[i] = shot
        advance(page, FINE_STEP_MS)
        elapsed += FINE_STEP_MS
    seen = {i: timed.get(i) or (first[i], last[i] - first[i]) for i in range(len(imgs)) if i in timed or i in first}
    assert len(seen) == len(imgs), f"only {len(seen)} of {len(imgs)} contours changed"
    return seen


def moving(locator) -> list[dict]:
    return [a for a in animations(locator) if a["playState"] == "running" and a["duration"] > MOTION_TOL_MS]


def contrast(page: Page) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate(
        """rules => {
          const result={done:false,error:null,violations:[]};
          Object.defineProperty(window,'__VERIFIER_CONTRAST__',{value:()=>structuredClone(result),configurable:true});
          axe.run(document,{runOnly:{type:'rule',values:rules}}).then(value=>{
            result.violations=value.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));result.done=true;
          },error=>{result.error=String(error);result.done=true});
        }""",
        ["color-contrast"],
    )
    for _ in range(AXE_POLLS):
        found = page.evaluate("window.__VERIFIER_CONTRAST__()")
        if found["done"]:
            assert found["error"] is None, found["error"]
            assert not found["violations"], f"contrast violations: {found['violations']}"
            return
        advance(page, AXE_STEP_MS)
    raise AssertionError("contrast audit did not settle under controlled time")


RING_JS = (
    "e => { const props = ['outline-style','outline-width','outline-color','box-shadow','border-top-width',"
    "'border-top-color','border-bottom-color','border-left-color','border-right-color'];"
    " const read = s => props.map(p => s.getPropertyValue(p)).join('|');"
    " const out = [read(getComputedStyle(e)), read(getComputedStyle(e,'::before')), read(getComputedStyle(e,'::after'))];"
    " let p = e.parentElement; for (let i = 0; p && i < 2; i++, p = p.parentElement) out.push(read(getComputedStyle(p)));"
    " const s = getComputedStyle(e); return {looks: out, style: s.outlineStyle, width: parseFloat(s.outlineWidth) || 0}; }"
)


def focus_ring(locator) -> None:
    settle(locator)
    focused = locator.evaluate(RING_JS)
    locator.evaluate("e => e.blur()")
    settle(locator)
    rest = locator.evaluate(RING_JS)
    locator.focus()
    outline = focused["style"] != "none" and focused["width"] >= FOCUS_RING_PX
    assert outline or focused["looks"] != rest["looks"], (rest, focused)


def mentions_date(body: str, d: str) -> bool:
    day = date.fromisoformat(d)
    forms = {d, f"{day:%B} {day.day}", f"{day.day} {day:%B}", f"{day:%b} {day.day}", f"{day.day} {day:%b}",
             f"{day.month}/{day.day}/{day.year}", f"{day.day}/{day.month}/{day.year}", f"{day:%m/%d/%Y}", f"{day:%d/%m/%Y}"}
    return any(re.search(rf"(?<!\d){re.escape(f)}(?!\d)", body) for f in forms)


def mentions_amount(body: str, shown: str) -> bool:
    return shown.replace("$", "").replace(",", "") in body.replace(",", "")


def keyed(node: Any, key: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(node, dict):
        for k, v in node.items():
            yield from keyed(v, str(k))
    elif isinstance(node, list):
        for v in node:
            yield from keyed(v, key)
    elif node is not None:
        yield key, str(node)


def leaked(resp: httpx.Response, secrets_: list) -> list[str]:
    named = {v for k, v in keyed(resp.json()) if ID_FIELD.search(k.lower())}
    return [str(s) for s in secrets_ if (str(s) in resp.text if len(str(s)) >= ID_MIN else str(s) in named)]


def day_action(page: Page, ref: str, name: str) -> None:
    places = [page.get_by_role("region", name=f"Booking {ref}").get_by_role("button", name=name),
              booking_row(page, ref).get_by_role("button", name=name)]

    def present() -> None:
        assert any(p.count() for p in places), f"no {name} button for {ref}"

    soon(page, present)
    click(next(p for p in places if p.count()).first)


def book_this_month(op: Api, member: Api, candidates: list[list[dict]]) -> dict:
    today = today_of(member)
    left = ((today.replace(day=28) + timedelta(days=4)).replace(day=1) - today).days - 1
    if left >= 1:
        d, cells = find_slot(member, candidates, min(NEAR // 2, left), left)
        return book(member, d, cells)
    with same_day_open(op):
        found = today_cells(op, member.member_id, NSC_STATIONS, 1)
        if found:
            return book(member, found[0], found[1][0])
    d, cells = find_slot(member, candidates, 1, NEAR)
    return book(member, d, cells)


def issued_month(invoice: dict) -> str:
    return local(invoice["issued_at"]).strftime("%Y-%m")


def load_report(page: Page, month: str) -> None:
    set_month(page, month)
    tables = page.get_by_role("table", name="Invoices")
    field = page.get_by_label("Month")

    def loaded(seconds: float = UI_SECONDS / 6) -> bool:
        with contextlib.suppress(AssertionError):
            soon(page, lambda: expect(tables).to_be_visible(timeout=EXPECT_MS), seconds=seconds)
            return True
        return False

    if loaded():
        return
    field.evaluate("e => { e.dispatchEvent(new Event('change', {bubbles: true})); e.blur(); }")
    if loaded():
        return
    if not field.evaluate("e => { if (!e.form) return false; e.form.requestSubmit(); return true; }"):
        field.focus()
        page.keyboard.press("Enter")
    if loaded():
        return
    opens(page, tables, [page.get_by_role("button", name=LOADER)])
    shows(page, tables)


def assert_stagger(timings: list[tuple[float, float]]) -> None:
    for start, duration in timings:
        assert duration <= LIGHT_MAX_MS, timings
    for (a, _), (b, _) in zip(timings, timings[1:]):
        assert STAGGER_MIN_MS - MOTION_TOL_MS <= b - a <= STAGGER_MAX_MS + MOTION_TOL_MS, timings


def test_health_and_status(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["content-type"].startswith("application/json")
    body = status(app_url)
    assert set(body["services"]) == {"billing", "files", "mail"}
    assert all(v in ("up", "down") for v in body["services"].values())
    assert isinstance(body["paused"], list)
    assert Api(app_url, EMBER).get("/api/me").json()["user"]["email"] == EMBER


def test_server_boundary(app_url):
    refused(post_json(app_url, "/api/session", {"email": EMBER, "password": PASSWORD}, Origin=FOREIGN), 403, "cross_origin")
    ember = Api(app_url, EMBER)
    refused(ember.http.delete("/api/session", headers={"Origin": FOREIGN}), 403, "cross_origin")
    assert ember.get("/api/me").status_code == 200
    r = httpx.post(app_url + "/api/session", json={"email": EMBER, "password": PASSWORD},
                   headers={"Origin": origin(app_url)}, timeout=HTTP_TIMEOUT)
    cookie = r.headers["set-cookie"]
    assert r.cookies.get(COOKIE_NAME), cookie
    for flag in COOKIE_FLAGS:
        assert flag.lower() in cookie.lower(), (flag, cookie)

    prefix, suffix = '{"email":"","password":"","pad":"', '"}'

    def padded(n: int) -> bytes:
        return (prefix + "x" * (n - len(prefix) - len(suffix)) + suffix).encode()

    headers = {"Origin": origin(app_url), "Content-Type": "application/json"}
    at_limit = httpx.post(app_url + "/api/session", content=padded(JSON_LIMIT), headers=headers, timeout=HTTP_TIMEOUT)
    refused(at_limit, 422, "validation")
    over = httpx.post(app_url + "/api/session", content=padded(JSON_LIMIT + 1), headers=headers, timeout=HTTP_TIMEOUT)
    refused(over, 413, "payload_too_large")
    wrong = httpx.post(app_url + "/api/session", content=b"email=x", timeout=HTTP_TIMEOUT,
                       headers={"Origin": origin(app_url), "Content-Type": "text/plain"})
    refused(wrong, 415, "unsupported_media_type")
    for path in PRIVATE_PATHS:
        p = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert p.status_code == 404, path
        assert b"run-manifest-v1" not in p.content
    for path in ("/api/health", "/signin", "/api/me", "/run.json"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT).headers["x-content-type-options"] == "nosniff"


def test_error_shape_and_precedence(app_url):
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT, headers={"Origin": origin(app_url)})
    jtype = {"Content-Type": "application/json"}
    big_bad = b"{" + b"x" * JSON_LIMIT
    refused(anon.post("/api/holds", content=big_bad, headers={**jtype, "Origin": FOREIGN}), 403, "cross_origin")
    refused(anon.post("/api/holds", content=big_bad, headers=jtype), 413, "payload_too_large")
    refused(anon.post("/api/holds", content=b"{not json", headers=jtype), 400, "invalid_json")
    refused(anon.get("/api/me"), 401, "unauthenticated")
    refused(anon.get(f"/api/bookings/{UNKNOWN_ID}"), 401, "unauthenticated")

    ember, salt = Api(app_url, EMBER), Api(app_url, SALTLINE)
    refused(ember.get(f"/api/bookings/{UNKNOWN_ID}"), 404, "not_found")
    d, cells = find_slot(salt, [block([s], "21:00", "21:30") for s in NSC_STATIONS])
    sb = book(salt, d, cells)["booking"]
    try:
        refused(ember.post(f"/api/bookings/{sb['id']}/check-in"), 404, "not_found")
        refused(salt.post(f"/api/bookings/{sb['id']}/check-in"), 403, "forbidden")
        mine = place_hold(ember, *find_slot(ember, [block([s], "21:30", "22:00") for s in NSC_STATIONS]))
        theirs = place_hold(salt, *find_slot(salt, [block([s], "22:00", "22:30") for s in NSC_STATIONS]))
        refused(ember.post(f"/api/holds/{theirs['id']}/confirm", {"use_pack": False, "quoted_total_cents": 0}), 404, "not_found")
        release(salt, theirs["id"])
        release(ember, mine["id"])
        nokey = refused(ember.post(f"/api/holds/{mine['id']}/confirm", {"use_pack": False, "quoted_total_cents": 0}),
                        422, "validation")
        assert "Idempotency-Key" in nokey["errors"]
        refused(confirm(ember, mine["id"], 0), 409, "hold_not_active")
        bad = refused(ember.post("/api/quotes", {"date": "not-a-date", "cells": [], "use_pack": False}), 422, "validation")
        assert isinstance(bad["errors"], dict) and bad["errors"]
    finally:
        cancel(salt, sb["id"])


def test_roles_and_sessions(app_url):
    for email, role, kid, member in SEEDED:
        a = Api(app_url, email)
        assert (a.user["email"], a.user["role"], a.user["kitchen_id"], a.user["member_id"]) == (email, role, kid, member)
        assert a.get("/api/me").json()["user"]["id"] == a.user["id"]
    anon = Api(app_url)
    refused(anon.post("/api/session", {"email": EMBER, "password": "not-the-password"}), 401, "invalid_credentials")
    assert "email" in refused(anon.post("/api/session", {"password": PASSWORD}), 422, "validation")["errors"]
    assert "password" in refused(anon.post("/api/session", {"email": EMBER, "password": 7}), 422, "validation")["errors"]

    month = kitchen(Api(app_url, OPERATOR))["today"][:7]
    ines = Api(app_url, INES)
    for path in ("/api/bookings", "/api/invoices", f"/api/kitchens/{NSC}/rate-cards", f"/api/members/{MEM_EMBER}/pack"):
        assert ines.get(path).status_code == 200, path
    assert ines.get(f"/api/kitchens/{NSC}/reports/usage", month=month).status_code == 200
    refused(ines.post("/api/quotes", {"date": month + "-01", "cells": [], "use_pack": False}), 403, "forbidden")
    refused(ines.get("/api/documents"), 403, "forbidden")
    refused(ines.get(f"/api/kitchens/{NSC}/loom", date=month + "-01"), 403, "forbidden")
    refused(buy_pack(ines, "mem-ember"), 403, "forbidden")
    ember = Api(app_url, EMBER)
    refused(ember.get(f"/api/kitchens/{NSC}/rate-cards"), 403, "forbidden")
    refused(ember.get(f"/api/kitchens/{NSC}/members"), 403, "forbidden")
    refused(ember.patch(f"/api/kitchens/{NSC}/settings", {"same_day_cutoff": "14:00"}), 403, "forbidden")
    teo = Api(app_url, TEO)
    refused(teo.get(f"/api/kitchens/{NSC}"), 404, "not_found")
    refused(teo.get(f"/api/kitchens/{NSC}/members"), 404, "not_found")
    assert ember.delete("/api/session").status_code == 204
    refused(ember.get("/api/me"), 401, "unauthenticated")


def test_wf_cross_cutting_signin_roles(app_url, browser):
    with open_app(browser, app_url + "/signin") as page:
        page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
        fill(page.get_by_role("textbox", name="Email"), EMBER)
        fill(page.get_by_label("Password", exact=True), "not-the-password")
        click(page.get_by_role("button", name="Sign in"))
        says(page, page.get_by_role("alert"), "Email or password is incorrect.")
        page.goto(app_url + "/loom")
        soon(page, lambda: expect(page).to_have_url(re.compile(r"/signin"), timeout=EXPECT_MS))
        sign_in(page, app_url, EMBER)
        soon(page, lambda: expect(page).to_have_url(re.compile(r"/loom"), timeout=EXPECT_MS))
        nav = page.get_by_role("navigation", name="Main")
        for name in ("Loom", "Bookings", "Papers", "Billing"):
            shows(page, nav.get_by_role("link", name=name, exact=True))
        for name in ("Members", "Rates", "Reports"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_have_count(0)
        cookie = [c for c in page.context.cookies() if c["name"] == "pl_session"]
        assert cookie and cookie[0]["httpOnly"] and cookie[0]["sameSite"] == "Lax"
        assert page.request.get(app_url + "/api/me").json()["user"]["email"] == EMBER
        click(page.get_by_role("button", name="Sign out"))
        soon(page, lambda: expect(page).to_have_url(re.compile(r"/signin"), timeout=EXPECT_MS))
        assert page.request.get(app_url + "/api/me").status == 401
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, OPERATOR)
        soon(page, lambda: expect(page).to_have_url(re.compile(r"/loom"), timeout=EXPECT_MS))
        nav = page.get_by_role("navigation", name="Main")
        for name in ("Loom", "Bookings", "Papers", "Members", "Rates", "Reports"):
            shows(page, nav.get_by_role("link", name=name, exact=True))
        expect(nav.get_by_role("link", name="Billing", exact=True)).to_have_count(0)
        shows(page, page.get_by_role("combobox", name="Book for member"))
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, INES)
        shows(page, page.get_by_label("Month"))
        nav = page.get_by_role("navigation", name="Main")
        for name in ("Bookings", "Reports"):
            shows(page, nav.get_by_role("link", name=name, exact=True))
        for name in ("Loom", "Papers", "Members", "Rates"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_have_count(0)


SCREEN_MARK: dict[str, Callable[[Page], Any]] = {
    "Loom": lambda p: p.get_by_role("grid", name="Station loom"),
    "Bookings": lambda p: p.get_by_role("table", name="Bookings"),
    "Papers": lambda p: p.get_by_role("form", name="Upload document"),
    "Billing": lambda p: p.get_by_role("heading", name="Pack balance"),
    "Members": lambda p: p.get_by_role("table", name="Members"),
    "Rates": lambda p: p.get_by_role("table", name="Rate cards"),
    "Reports": lambda p: p.get_by_label("Month"),
}


def visit(page: Page, name: str) -> None:
    go(page, name)
    shows(page, SCREEN_MARK[name](page))


def test_wf_cross_cutting_viewports(app_url, browser):
    for email, screens in ((OPERATOR, ["Loom", "Bookings", "Papers", "Members", "Rates", "Reports"]),
                           (EMBER, ["Loom", "Billing"])):
        with open_app(browser, app_url + "/signin") as page:
            sign_in(page, app_url, email)
            for width, height in (NARROW, MIDDLE, WIDE):
                page.set_viewport_size({"width": width, "height": height})
                for name in screens:
                    visit(page, name)
                    advance(page, STEP_MS)
                    layout(page)
                    menu = page.get_by_role("button", name="Menu")
                    if (width, height) == NARROW:
                        expect(menu).to_be_visible()
                    else:
                        expect(menu).to_have_count(0)
                    if name != "Loom":
                        continue
                    heads = page.get_by_role("grid", name="Station loom").get_by_role("rowheader")
                    if (width, height) == NARROW:
                        shows(page, page.get_by_role("button", name="Show quote"))
                        continue
                    label, bottom = heads.first.bounding_box(), heads.last.bounding_box()
                    rail = page.get_by_role("complementary", name="Quote").bounding_box()
                    if (width, height) == WIDE:
                        assert rail["x"] >= label["x"] + label["width"] - ROUNDING_PX
                        assert rail["x"] + rail["width"] <= width + ROUNDING_PX
                        assert rail["y"] < bottom["y"] + bottom["height"]
                    else:
                        assert rail["y"] >= bottom["y"] + bottom["height"] - ROUNDING_PX
    with open_app(browser, app_url + "/signin") as page:
        for width, height in (NARROW, MIDDLE, WIDE):
            page.set_viewport_size({"width": width, "height": height})
            shows(page, page.get_by_role("button", name="Sign in"))
            layout(page)


LABEL_BOX_JS = (
    "e => { const l = e.labels && e.labels[0]; if (!l) return null;"
    " const r = l.getBoundingClientRect(); return {width: r.width, height: r.height}; }"
)


def small_targets(page: Page) -> list[str]:
    small = []
    for role in ("button", "link", "checkbox", "menuitem"):
        for el in page.get_by_role(role).all():
            if not el.is_visible():
                continue
            box = el.bounding_box()
            if box is None:
                continue
            w, h = box["width"], box["height"]
            if role == "checkbox" and (w < TARGET_PX or h < TARGET_PX):
                lab = el.evaluate(LABEL_BOX_JS)
                if lab:
                    w, h = max(w, lab["width"]), max(h, lab["height"])
            if w + ROUNDING_PX < TARGET_PX or h + ROUNDING_PX < TARGET_PX:
                small.append(f"{role} {el.get_attribute('aria-label') or el.inner_text()[:30]!r} {w}x{h}")
    return small


def test_contrast_and_targets(app_url, browser):
    for email, screens in ((OPERATOR, ["Loom", "Bookings", "Papers", "Members", "Rates", "Reports"]),
                           (EMBER, ["Billing"])):
        with open_app(browser, app_url + "/signin") as page:
            sign_in(page, app_url, email)
            for name in screens:
                visit(page, name)
                advance(page, STEP_MS)
                contrast(page)
                assert not small_targets(page), small_targets(page)
            page.set_viewport_size({"width": NARROW[0], "height": NARROW[1]})
            visit(page, "Loom")
            assert not small_targets(page), small_targets(page)


def test_station_loom_grid(app_url, browser):
    ember = Api(app_url, EMBER)
    d = (today_of(ember) + timedelta(days=NEAR)).isoformat()
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        open_loom(page, app_url, d)
        grid = page.get_by_role("grid", name="Station loom")
        heads = grid.get_by_role("rowheader")
        expect(heads).to_have_count(len(NSC_STATIONS))
        for i, sid in enumerate(NSC_STATIONS):
            expect(heads.nth(i)).to_contain_text(STATION_NAME[sid])
        expect(grid.get_by_role("columnheader", name=re.compile(r"^\d{2}:\d{2}$"))).to_have_count(COLUMNS)
        expect(grid.get_by_role("columnheader", name=FIRST_CELL, exact=True)).to_have_count(1)
        expect(grid.get_by_role("columnheader", name=LAST_CELL, exact=True)).to_have_count(1)
        row = grid.get_by_role("row").filter(has=page.get_by_role("rowheader", name="Deck oven 1"))
        expect(row.get_by_role("gridcell")).to_have_count(COLUMNS)
        label = grid.get_by_role("rowheader").first
        before = label.bounding_box()
        cell(page, "Deck oven 1", LAST_CELL).scroll_into_view_if_needed()
        advance(page, STEP_MS)
        after = label.bounding_box()
        assert abs(after["x"] - before["x"]) <= ROUNDING_PX and after["x"] >= 0
        layout(page)


def test_reduced_motion_substitutes(app_url, browser):
    ember = Api(app_url, EMBER)
    d = free_date(ember, block(["st-deck-1", "st-deck-2"], "04:00", "04:30"))
    with open_app(browser, app_url + "/signin", reduced_motion="reduce") as page:
        sign_in(page, app_url, EMBER)
        open_loom(page, app_url, d)
        quotes, holds = Watch(page, "/api/quotes"), Watch(page, "/api/holds")
        focus_grid(page)
        extend(page, "ArrowRight", "ArrowDown")
        total = page.get_by_role("group", name="Quote total")
        seen: list[dict] = []

        def landed() -> None:
            nonempty(quotes.requests)
            q = latest(quotes)["quote"]
            if q["quarters"] == 4:
                seen[:] = [q]
            expect(total).to_contain_text(q["total"], timeout=EXPECT_MS)
            assert seen, "no quote of the extended brush yet"

        soon(page, landed, step=FINE_STEP_MS)
        q = seen[0]
        says(page, page.get_by_role("status", name="Quote announcement"), f"Total {q['total']} for {q['hours']} hours.")
        plan = page.get_by_role("group", name="Kitchen floor plan")
        shows(page, plan.get_by_role("img", name=f"{STATION_NAME['st-deck-2']}, lit"))
        assert moving(plan) == []
        page.keyboard.press("Enter")
        wait_responses(page, holds, 1)
        hold = latest(holds)["hold"]
        try:
            rail = page.get_by_role("complementary", name="Quote")
            says(page, rail, f"held until {hold['expires_local']}")
            expect(page.get_by_role("progressbar", name="Hold time left")).not_to_be_visible()
            assert moving(page.get_by_role("grid", name="Station loom")) == []
            tab_to(page, page.get_by_role("button", name="Confirm booking"))
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Confirm booking")
            shows(page, dialog)
            assert moving(dialog) == []
            page.keyboard.press("Escape")
            soon(page, lambda: expect(dialog).to_be_hidden(timeout=EXPECT_MS))
        finally:
            release(ember, hold["id"])


ICON_JS = (
    "e => { const bad = new Set(['none', 'normal', '\"\"', \"''\"]);"
    " const glyph = t => /[\\uE000-\\uF8FF\\u2190-\\u2BFF]|[\\u{1F300}-\\u{1FAFF}]/u.test(t);"
    " const iconFont = f => /icon|symbol|material|awesome|phosphor|lucide|tabler|feather/i.test(f || '');"
    " return [e, ...e.querySelectorAll('*')].some(n => {"
    "  if (n !== e && ['svg', 'img', 'canvas', 'use', 'i', 'picture', 'object'].includes(n.localName)) {"
    "   const r = n.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return true; }"
    "  if (n !== e && n.childElementCount === 0) { const t = (n.textContent || '').trim();"
    "   if (t && (glyph(t) || iconFont(getComputedStyle(n).fontFamily))) return true; }"
    "  return [null, '::before', '::after'].some(p => { const s = getComputedStyle(n, p);"
    "   const mask = s.maskImage || s.webkitMaskImage || 'none';"
    "   if (mask !== 'none' || (s.backgroundImage || '').includes('url(')) return true;"
    "   if (p === null) return false;"
    "   return !bad.has(s.content); }); }); }"
)
PSEUDO_LABEL_JS = (
    "(g, a) => [...g.querySelectorAll('*')].some(n => ['::before', '::after'].some(p => {"
    " const c = getComputedStyle(n, p).content || ''; if (c === 'none' || c === 'normal') return false;"
    " const t = c.replace(/attr\\(\\s*([^)\\s]+)\\s*\\)/g, (_, x) => JSON.stringify(n.getAttribute(x) || ''))"
    "  .replace(/\"([^\"]*)\"/g, '$1').trim().toLowerCase();"
    " const w = a.words.toLowerCase(); return a.whole ? t === w : t.includes(w); }))"
)


def look(target) -> Any:
    target.scroll_into_view_if_needed()
    settle(target)
    return decode(capture(target))


def prints(page: Page, words: str, whole: bool = True) -> None:
    pattern = rf"^\s*{re.escape(words)}\s*$" if whole else re.escape(words)
    grid = page.get_by_role("grid", name="Station loom")
    found = grid.get_by_text(re.compile(pattern, re.I))

    def seen() -> None:
        boxes = [w.bounding_box() for w in found.all() if w.is_visible()]
        as_text = any(b and b["width"] > ROUNDING_PX and b["height"] > ROUNDING_PX for b in boxes)
        assert as_text or grid.evaluate(PSEUDO_LABEL_JS, {"words": words, "whole": whole}), \
            f"no printed run label {words!r}"

    soon(page, seen)


def test_cell_states_pattern_and_label(app_url, browser):
    ember, salt, op = Api(app_url, EMBER), Api(app_url, SALTLINE), Api(app_url, OPERATOR)
    stations = ["st-deck-1", "st-deck-2", "st-convection", "st-mixer", "st-chiller"]
    d = free_date(ember, block(stations, "04:00", "05:30"))
    mine = place_hold(ember, d, block(["st-deck-1"], "04:00", "04:30"))
    booked = book(ember, d, block(["st-deck-2"], "04:00", "04:30"))["booking"]
    theirs = place_hold(salt, d, block(["st-chiller"], "04:00", "05:30"))
    looks: dict[str, Any] = {}
    try:
        with open_app(browser, app_url + "/signin") as page:
            sign_in(page, app_url, EMBER)
            open_loom(page, app_url, d)
            shows(page, cell(page, "Deck oven 1", "04:00", "held"))
            shows(page, cell(page, "Deck oven 2", "04:15", "booked"))
            shows(page, cell(page, "Blast chiller", "05:00", "taken"))
            focus_grid(page)
            for _ in range(3):
                page.keyboard.press("ArrowDown")
            extend(page, "ArrowDown", "ArrowRight", "ArrowRight")
            shows(page, cell(page, "60-quart mixer", "04:00", "selected"))
            shows(page, cell(page, "60-quart mixer", "04:30", "selected"))
            shows(page, cell(page, "Blast chiller", "04:00", "taken conflicts with your brush"))
            shows(page, cell(page, "Blast chiller", "04:30", "taken conflicts with your brush"))
            shows(page, cell(page, "Blast chiller", "04:45", "taken"))
            legend = page.get_by_role("list", name="Loom legend")
            for item in CELL_LABELS:
                expect(legend.get_by_role("listitem").filter(has_text=item)).to_have_count(1)
            samples = {
                "free": cell(page, "Deck oven 1", "05:15", "free"),
                "held": cell(page, "Deck oven 1", "04:15", "held"),
                "booked": cell(page, "Deck oven 2", "04:15", "booked"),
                "selected": cell(page, "60-quart mixer", "04:15", "selected"),
                "conflict": cell(page, "Blast chiller", "04:15", "taken conflicts with your brush"),
                "taken": cell(page, "Blast chiller", "05:00", "taken"),
            }
            for state, target in samples.items():
                looks[state] = look(target)
                if state != "free":
                    assert target.evaluate(ICON_JS) or unlike(looks[state], looks["free"]) > 0, \
                        f"no icon in a {state} cell"
            for word in ("selected", "held", "booked", "taken", "conflict"):
                prints(page, word)
            page.keyboard.press("Escape")
            uncovered = uncovered_date(op, "mem-ember")
            open_loom(page, app_url, uncovered)
            papers = cell(page, "Deck oven 1", "04:15", "papers")
            shows(page, papers)
            shows(page, cell(page, "Walk-in cooler", LAST_CELL, "papers"))
            looks["papers"] = look(papers)
            assert papers.evaluate(ICON_JS) or unlike(looks["papers"], looks["free"]) > 0, \
                "no icon in a papers cell"
            prints(page, "papers")
        names = list(looks)
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                assert unlike(looks[a], looks[b]) > 0, f"{a} and {b} cells render alike"
        with open_app(browser, app_url + "/signin") as page:
            sign_in(page, app_url, OPERATOR)
            open_loom(page, app_url, d)
            shows(page, cell(page, "Deck oven 2", "04:00", "booked by Ember & Rye Bakery"))
            shows(page, cell(page, "Deck oven 1", "04:00", "held by Ember & Rye Bakery"))
            shows(page, cell(page, "Blast chiller", "04:00", "held by Saltline Catering"))
            prints(page, "Ember & Rye Bakery", whole=False)
            prints(page, "Saltline Catering", whole=False)
    finally:
        release(ember, mine["id"])
        release(salt, theirs["id"])
        cancel(ember, booked["id"])


def test_wf_brush_and_hold_pointer(app_url, browser):
    ember, salt = Api(app_url, EMBER), Api(app_url, SALTLINE)
    d = free_date(ember, block(["st-deck-1", "st-deck-2"], "04:00", "05:00"))
    theirs = place_hold(salt, d, block(["st-deck-2"], "04:30", "05:00"))
    hold_id = None
    try:
        with open_mouse(browser, app_url + "/signin") as page:
            sign_in(page, app_url, EMBER)
            open_loom(page, app_url, d)
            shows(page, cell(page, "Deck oven 2", "04:30", "taken"))
            press_on(page, cell(page, "Deck oven 1", "04:00"))
            aim(page, cell(page, "Deck oven 2", "04:45"))
            shows(page, cell(page, "Deck oven 1", "04:45", "selected"))
            shows(page, cell(page, "Deck oven 2", "04:30", "taken conflicts with your brush"))
            says(page, page.get_by_role("group", name="Quote total"), "$")
            page.mouse.up()
            says(page, loom_status(page), "Held 6 cells until")
            shows(page, cell(page, "Deck oven 2", "04:15", "held"))
            soon(page, lambda: expect(page).to_have_url(re.compile(r"hold="), timeout=EXPECT_MS))
            hold_id = hold_id_from(page)
        h = ember.get(f"/api/holds/{hold_id}").json()["hold"]
        assert h["state"] == "held"
        expected = keys(block(["st-deck-1"], "04:00", "05:00") + block(["st-deck-2"], "04:00", "04:30"))
        assert keys(h["cells"]) == expected
    finally:
        release(salt, theirs["id"])
        if hold_id:
            release(ember, hold_id)


def test_floor_plan_lighting(app_url, browser):
    ember = Api(app_url, EMBER)
    d = free_date(ember, block(["st-deck-1", "st-deck-2", "st-convection", "st-mixer"], "04:00", "04:30"))
    with open_mouse(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        open_loom(page, app_url, d)
        plan = page.get_by_role("group", name="Kitchen floor plan")
        joining = ["Deck oven 2", "Convection oven", "60-quart mixer"]
        imgs = [plan.get_by_role("img", name=re.compile(rf"^{re.escape(n)}(, lit)?$")) for n in joining]
        press_on(page, cell(page, "Deck oven 1", "04:00"))
        advance(page, DIM_SETTLE_MS)
        shows(page, plan.get_by_role("img", name=f"{STATION_NAME['st-deck-1']}, lit"))
        advance(page, DIM_SETTLE_MS)
        lit = motion_starts(page, imgs, lambda: aim(page, cell(page, "60-quart mixer", "04:15")), plan)
        assert_stagger([lit[0], lit[1], lit[2]])
        for n in joining:
            shows(page, plan.get_by_role("img", name=f"{n}, lit"))
        advance(page, DIM_SETTLE_MS)
        dim = motion_starts(page, imgs, lambda: aim(page, cell(page, "Deck oven 1", "04:15")), plan)
        assert_stagger([dim[2], dim[1], dim[0]])
        for n in joining:
            shows(page, plan.get_by_role("img", name=n, exact=True))
        page.mouse.up()
        says(page, loom_status(page), "Held")
        hold_id = hold_id_from(page)
    if hold_id:
        release(ember, hold_id)


def test_counting_quote_total(app_url, browser):
    ember = Api(app_url, EMBER)
    d = free_date(ember, block(["st-deck-1"], "04:00", "04:15"))
    hold_id = None
    with open_mouse(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        open_loom(page, app_url, d)
        quotes = Watch(page, "/api/quotes")
        total = page.get_by_role("group", name="Quote total")
        with held(page, "**/api/quotes") as gate:
            press_on(page, cell(page, "Deck oven 1", "04:00"))
            soon(page, lambda: nonempty(quotes.requests), step=FINE_STEP_MS)
            says(page, total, "Pricing…")
            gate.release()
        wait_responses(page, quotes, len(quotes.requests))
        first = latest(quotes)["quote"]
        says(page, total, first["total"])
        advance(page, SAMPLE_END_MS)
        sent = len(quotes.requests)
        aim(page, cell(page, "Walk-in cooler", "06:00"))
        soon(page, lambda: nonempty(quotes.requests, sent + 1), step=FINE_STEP_MS)
        wait_responses(page, quotes, len(quotes.requests))
        second = latest(quotes)["quote"]
        samples = []
        for step in range(1, SAMPLE_END_MS // FINE_STEP_MS + 1):
            advance(page, FINE_STEP_MS)
            samples.append((step * FINE_STEP_MS, cents_of(total.inner_text())))
        final, previous = second["total_cents"], first["total_cents"]
        assert samples[-1][1] == final, samples
        land = next(t for i, (t, v) in enumerate(samples) if all(x == final for _, x in samples[i:]))
        assert COUNT_MIN_MS - MOTION_TOL_MS <= land <= COUNT_MAX_MS + MOTION_TOL_MS, samples
        assert any(v not in (previous, final) for t, v in samples if t < land), samples
        lines = page.get_by_role("list", name="Quote lines").get_by_role("listitem")
        expect(lines).to_have_count(len(second["lines"]))
        for line in second["lines"]:
            expect(lines.filter(has_text=line["station"]).first).to_be_visible()
        expected = f"Total {second['total']} for {second['hours']} hours." + "".join(
            f" Crosses into tier {t}." for t in second["tier_steps_crossed"])
        says(page, page.get_by_role("status", name="Quote announcement"), expected)
        page.mouse.up()
        advance(page, STEP_MS)
        hold_id = hold_id_from(page)
    if hold_id:
        release(ember, hold_id)


def test_wf_brush_and_hold_keyboard(app_url, browser):
    ember = Api(app_url, EMBER)
    d = free_date(ember, block(["st-deck-1", "st-deck-2"], "04:00", "04:30"))
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        open_loom(page, app_url, d)
        grid = page.get_by_role("grid", name="Station loom")
        start = cell(page, "Deck oven 1", "04:00")
        stops = {"nav": page.get_by_role("navigation", name="Main").get_by_role("link", name="Loom", exact=True),
                 "date": page.get_by_label("Kitchen date"), "stations": page.get_by_role("button", name="Stations"),
                 "grid": start}
        reached: dict[str, int] = {}
        for i in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            for stop, target in stops.items():
                if stop not in reached and is_focused(target):
                    reached[stop] = i
            if "grid" in reached:
                break
        assert set(reached) == set(stops), reached
        assert reached["nav"] < reached["date"] < reached["stations"] < reached["grid"], reached
        page.keyboard.press("Tab")
        assert not inside(grid), "the grid is more than one Tab stop"
        open_loom(page, app_url, d)
        focus_grid(page)
        soon(page, lambda: expect(start).to_be_focused(timeout=EXPECT_MS))
        for key, station, at in (("ArrowRight", "Deck oven 1", "04:15"), ("End", "Deck oven 1", LAST_CELL),
                                 ("Home", "Deck oven 1", FIRST_CELL), ("ArrowDown", "Deck oven 2", FIRST_CELL),
                                 ("ArrowUp", "Deck oven 1", FIRST_CELL)):
            page.keyboard.press(key)
            target = cell(page, station, at)
            soon(page, lambda: expect(target).to_be_focused(timeout=EXPECT_MS))
        extend(page, "ArrowRight", "ArrowDown")
        shows(page, cell(page, "Deck oven 2", "04:15", "selected"))
        page.keyboard.press("Escape")
        shows(page, cell(page, "Deck oven 2", "04:15", "free"))
        page.keyboard.press("Home")
        second = cell(page, "Deck oven 2", FIRST_CELL)
        soon(page, lambda: truth(is_focused(start) or is_focused(second), "Home did not move to 04:00"))
        if is_focused(second):
            page.keyboard.press("ArrowUp")
        soon(page, lambda: expect(start).to_be_focused(timeout=EXPECT_MS))
        extend(page, "ArrowRight", "ArrowDown")
        shows(page, cell(page, "Deck oven 2", "04:15", "selected"))
        page.keyboard.press("Enter")
        says(page, loom_status(page), "Held 4 cells until")
        assert inside(grid)
        opener = page.get_by_role("button", name="Confirm booking")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Confirm booking")
        soon(page, lambda: expect(dialog.get_by_role("button", name="Confirm", exact=True)).to_be_focused(timeout=EXPECT_MS))
        for _ in range(6):
            page.keyboard.press("Tab")
            assert inside(dialog)
        page.keyboard.press("Shift+Tab")
        assert inside(dialog)
        page.keyboard.press("Escape")
        soon(page, lambda: expect(dialog).to_be_hidden(timeout=EXPECT_MS))
        soon(page, lambda: expect(opener).to_be_focused(timeout=EXPECT_MS))
        page.keyboard.press("Enter")
        soon(page, lambda: expect(dialog.get_by_role("button", name="Confirm", exact=True)).to_be_focused(timeout=EXPECT_MS))
        page.keyboard.press("Enter")
        says(page, loom_status(page), re.compile(rf"Booking (PL-\d{{6}}) confirmed\. Confirmation sent to {re.escape(EMBER)}\."))
        ref = re.search(r"PL-\d{6}", loom_status(page).inner_text()).group(0)
        soon(page, lambda: truth(inside(grid), "focus did not return to the grid"))
        stations = page.get_by_role("button", name="Stations")
        tab_to(page, stations)
        focus_ring(stations)
        page.keyboard.press("Enter")
        chooser = page.get_by_role("dialog", name="Choose stations")
        shows(page, chooser)
        page.keyboard.press("Tab")
        assert inside(chooser)
        page.keyboard.press("Escape")
        soon(page, lambda: expect(stations).to_be_focused(timeout=EXPECT_MS))
    mine = [b for b in own_bookings(ember, d) if b["ref"] == ref]
    assert len(mine) == 1 and keys(mine[0]["cells"]) == keys(block(["st-deck-1", "st-deck-2"], "04:00", "04:30"))
    cancel(ember, mine[0]["id"])


def test_brush_in_address(app_url, browser):
    ember = Api(app_url, EMBER)
    d = free_date(ember, block(["st-deck-1", "st-deck-2"], "04:00", "04:30"))
    hold_id = None
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        open_loom(page, app_url, d)
        length = page.evaluate("history.length")
        focus_grid(page)
        extend(page, "ArrowRight", "ArrowDown")
        soon(page, lambda: expect(page).to_have_url(re.compile(r"sel=st-deck-1(\.\.|%2E%2E)st-deck-2(@|%40)04(:|%3A)00-04(:|%3A)30"), timeout=EXPECT_MS))
        assert page.evaluate("history.length") == length
        page.reload()
        shows(page, cell(page, "Deck oven 2", "04:15", "selected"))
        says(page, page.get_by_role("group", name="Quote total"), "$")
        click(page.get_by_role("button", name="Stations"))
        chooser = page.get_by_role("dialog", name="Choose stations")
        set_box(chooser.get_by_role("checkbox", name="Convection oven"), False)
        click(chooser.get_by_role("button", name="Apply"))
        soon(page, lambda: expect(page).to_have_url(re.compile(r"stations="), timeout=EXPECT_MS))
        chosen = parse_qs(urlsplit(page.url).query)["stations"][0].split(",")
        assert "st-convection" not in chosen and "st-deck-1" in chosen
        page.reload()
        shows(page, cell(page, "Deck oven 1", "04:00"))
        expect(page.get_by_role("rowheader", name="Convection oven")).to_have_count(0)
        focus_grid(page)
        page.keyboard.press("Escape")
        page.keyboard.press("Home")
        top = cell(page, "Deck oven 1", FIRST_CELL)
        soon(page, lambda: truth(is_focused(top) or is_focused(cell(page, "Deck oven 2", FIRST_CELL)),
                                 "Home did not move to 04:00"))
        if not is_focused(top):
            page.keyboard.press("ArrowUp")
        soon(page, lambda: expect(top).to_be_focused(timeout=EXPECT_MS))
        extend(page, "ArrowRight", "ArrowDown")
        shows(page, cell(page, "Deck oven 2", "04:15", "selected"))
        page.keyboard.press("Enter")
        soon(page, lambda: expect(page).to_have_url(re.compile(r"hold="), timeout=EXPECT_MS))
        assert "sel" not in parse_qs(urlsplit(page.url).query)
        hold_id = hold_id_from(page)
        page.reload()
        shows(page, cell(page, "Deck oven 2", "04:15", "held"))
        shows(page, page.get_by_role("progressbar", name="Hold time left"))
        page.goto(f"{app_url}/loom?date={d}&sel=not-a-brush")
        shows(page, cell(page, "Deck oven 1", "04:00"))
        expect(page.get_by_role("gridcell", name=re.compile(r", selected$"))).to_have_count(0)
    if hold_id:
        release(ember, hold_id)


def test_quotes_price_without_holding(app_url):
    ember, salt, op = Api(app_url, EMBER), Api(app_url, SALTLINE), Api(app_url, OPERATOR)
    order, card = station_order(ember), in_force_card(op)
    cells = block(["st-convection", "st-mixer", "st-range"], "08:00", "11:00")
    d = free_date(ember, cells)
    taken = block(["st-mixer"], "08:00", "08:30")
    theirs = place_hold(salt, d, taken)
    try:
        body = quote(ember, d, cells)
        assert keys(body["taken"]) == keys(taken) and body["papers"] == []
        q = body["quote"]
        priced = [c for c in cells if (c["station_id"], c["start"]) not in keys(taken)]
        lines, steps = price(priced, quarters_of(q["month_hours_before"]), card, order)
        assert shape(q["lines"]) == lines
        assert all(l["hours"] == hours_text(l["quarters"]) for l in q["lines"])
        total = sum(l[5] for l in lines)
        assert (q["total_cents"], q["total"], q["tier_steps_crossed"]) == (total, dollars(total), steps)
        assert (q["quarters"], q["hours"], q["pack_quarters"]) == (len(priced), hours_text(len(priced)), 0)
        assert q["month"] == d[:7] and q["rate_card_id"] == card["id"]
        assert not any("hold_id" in c for c in loom(ember, d)["cells"])
        assert quote(op, d, cells, member_id="mem-ember")["quote"]["total_cents"] == q["total_cents"]
        later = place_hold(salt, d, priced)
        release(salt, later["id"])
    finally:
        release(salt, theirs["id"])
    today = today_of(ember)
    assert ember.post("/api/quotes", {"date": (today + timedelta(days=HORIZON_DAYS)).isoformat(),
                                      "cells": cells[:1], "use_pack": False}).status_code == 200
    for bad_date in ((today + timedelta(days=HORIZON_DAYS + 1)).isoformat(), (today - timedelta(days=1)).isoformat()):
        assert "date" in refused(ember.post("/api/quotes", {"date": bad_date, "cells": cells[:1], "use_pack": False}),
                                 422, "validation")["errors"]
    every = block(NSC_STATIONS, FIRST_CELL, "24:00")
    for bad_cells in ([], cells[:1] * 2, [{"station_id": "st-mixer", "start": "08:10"}],
                      [{"station_id": "st-mixer", "start": "03:45"}], every[:MAX_CELLS + 1]):
        assert "cells" in refused(ember.post("/api/quotes", {"date": d, "cells": bad_cells, "use_pack": False}),
                                  422, "validation")["errors"]
    refused(op.post("/api/quotes", {"date": d, "cells": cells[:1], "use_pack": False}), 422, "validation")
    refused(op.post("/api/quotes", {"date": d, "cells": cells[:1], "use_pack": False, "member_id": "mem-copper"}),
            404, "not_found")


def test_holds_take_free_cells(app_url):
    ember, salt = Api(app_url, EMBER), Api(app_url, SALTLINE)
    k = kitchen(ember)
    cells = block(["st-prep-a", "st-prep-b"], "12:00", "13:00")
    d = free_date(ember, cells)
    stolen = block(["st-prep-b"], "12:00", "12:30")
    theirs = place_hold(salt, d, stolen)
    try:
        r = ember.post("/api/holds", {"date": d, "cells": cells})
        assert r.status_code == 201, r.text
        h, taken = r.json()["hold"], r.json()["taken"]
        assert keys(taken) == keys(stolen)
        assert keys(h["cells"]) == keys(cells) - keys(stolen)
        assert (h["state"], h["date"], h["member_id"]) == ("held", d, "mem-ember")
        span = (instant(h["expires_at"]) - instant(h["server_now"])).total_seconds()
        assert k["hold_seconds"] - SPAN_SLACK - CLOCK_SKEW <= span <= k["hold_seconds"] + CLOCK_SKEW
        assert h["expires_local"] == local(h["expires_at"], k["timezone"]).strftime("%H:%M")
        assert h["quote"]["quarters"] == len(h["cells"])
        again = refused(ember.post("/api/holds", {"date": d, "cells": h["cells"]}), 409, "cells_taken")
        assert keys(again["taken"]) == keys(h["cells"])
        assert {c.get("hold_id") for c in loom(ember, d)["cells"] if c.get("hold_id")} == {h["id"]}
        assert ember.get(f"/api/holds/{h['id']}").json()["hold"]["state"] == "held"
        r = ember.delete(f"/api/holds/{h['id']}")
        assert r.status_code == 200 and r.json()["hold"]["state"] == "released"
        assert refused(ember.delete(f"/api/holds/{h['id']}"), 409, "hold_not_active")["state"] == "released"
        free = place_hold(salt, d, h["cells"])
        release(salt, free["id"])
    finally:
        release(salt, theirs["id"])


def test_concurrent_holds_one_winner(app_url):
    clients = [Api(app_url, SALTLINE) for _ in range(RACERS // 2)] + [Api(app_url, WREN) for _ in range(RACERS // 2)]
    cells = block(["st-chiller"], "05:00", "07:00")
    d = free_date(clients[-1], cells, first=1, last=10)
    gate = threading.Barrier(len(clients))

    def claim(c: Api) -> httpx.Response:
        gate.wait()
        return c.post("/api/holds", {"date": d, "cells": cells})

    with ThreadPoolExecutor(len(clients)) as pool:
        results = list(pool.map(claim, clients))
    winners = [(c, r) for c, r in zip(clients, results) if r.status_code == 201]
    try:
        assert len(winners) == 1, [r.status_code for r in results]
        assert winners[0][1].json()["taken"] == []
        for r in results:
            if r.status_code != 201:
                assert keys(refused(r, 409, "cells_taken")["taken"]) == keys(cells)
    finally:
        for c, r in winners:
            release(c, r.json()["hold"]["id"])


def test_wf_brush_and_hold_race(app_url, browser):
    wren = Api(app_url, WREN)
    d = free_date(wren, block(["st-chiller"], "05:00", "07:00"), first=1, last=10)
    with open_mouse(browser, app_url + "/signin") as first, open_mouse(browser, app_url + "/signin") as second:
        for page, email in ((first, SALTLINE), (second, WREN)):
            sign_in(page, app_url, email)
            open_loom(page, app_url, d)
            press_on(page, cell(page, "Blast chiller", "05:00"))
            aim(page, cell(page, "Blast chiller", "06:45"))
            shows(page, cell(page, "Blast chiller", "06:45", "selected"))
        first.mouse.up()
        says(first, loom_status(first), "Held 8 cells until")
        second.mouse.up()
        says(second, loom_status(second), "Those cells were just taken. Nothing was held.")
        shows(second, cell(second, "Blast chiller", "05:00", "taken"))
        plan = second.get_by_role("group", name="Kitchen floor plan")
        shows(second, plan.get_by_role("img", name="Blast chiller", exact=True))
        says(second, second.get_by_role("group", name="Quote total"), "$0.00")
        hold_id = hold_id_from(first)
    view = loom(Api(app_url, OPERATOR), d)
    owners = {c.get("business") for c in view["cells"] if (c["station_id"], c["start"]) in keys(block(["st-chiller"], "05:00", "07:00"))}
    assert owners == {"Saltline Catering"}
    release(Api(app_url, SALTLINE), hold_id)


def test_hold_expiry_server_judged(rig):
    rig.ensure(billing=True, files=True, mail=True)
    ember, salt = Api(rig.base, EMBER), Api(rig.base, SALTLINE)
    assert kitchen(ember)["hold_seconds"] == RIG_HOLD_SECONDS
    d, cells = find_slot(ember, [block([s], "20:00", "20:30") for s in NSC_STATIONS])
    h = place_hold(ember, d, cells)
    expires = instant(h["expires_at"])
    span = (expires - instant(h["server_now"])).total_seconds()
    assert RIG_HOLD_SECONDS - SPAN_SLACK - CLOCK_SKEW <= span <= RIG_HOLD_SECONDS + CLOCK_SKEW

    def expired() -> bool:
        g = ember.get(f"/api/holds/{h['id']}").json()["hold"]
        assert g["expires_at"] == h["expires_at"]
        seconds = (instant(g["server_now"]) - expires).total_seconds()
        if seconds < -EDGE_SLACK - CLOCK_SKEW:
            assert g["state"] == "held", g
            return False
        if seconds < EDGE_SLACK + CLOCK_SKEW:
            return False
        assert g["state"] == "expired", g
        return True

    poll(expired, RIG_HOLD_SECONDS + SPAN_SLACK + EDGE_SLACK + 2 * CLOCK_SKEW, "hold expiry")
    refused(confirm(ember, h["id"], h["quote"]["total_cents"]), 410, "hold_expired")
    refused(ember.delete(f"/api/holds/{h['id']}"), 410, "hold_expired")
    assert not [b for b in own_bookings(ember, d) if keys(b["cells"]) & keys(cells)]
    again = place_hold(salt, d, cells)
    release(salt, again["id"])


def test_held_cells_and_lost_cells(app_url, browser):
    ember, salt = Api(app_url, EMBER), Api(app_url, SALTLINE)
    cells = block(["st-deck-1", "st-deck-2"], "04:00", "05:00")
    d = free_date(ember, cells)
    stolen = block(["st-deck-2"], "04:30", "05:00")
    theirs = None
    hold = None
    try:
        with open_mouse(browser, app_url + "/signin") as page:
            sign_in(page, app_url, EMBER)
            open_loom(page, app_url, d)
            holds, quotes = Watch(page, "/api/holds"), Watch(page, "/api/quotes")
            press_on(page, cell(page, "Deck oven 1", "04:00"))
            aim(page, cell(page, "Deck oven 2", "04:45"))
            shows(page, cell(page, "Deck oven 2", "04:45", "selected"))

            def quoted() -> None:
                nonempty(quotes.requests)
                assert latest(quotes)["quote"]["quarters"] == len(cells), "no quote of the whole brush yet"
                expect(page.get_by_role("group", name="Quote total")).to_contain_text(
                    latest(quotes)["quote"]["total"], timeout=EXPECT_MS)

            soon(page, quoted)
            theirs = place_hold(salt, d, stolen)
            page.mouse.up()
            wait_responses(page, holds, 1)
            body = latest(holds)
            hold = body["hold"]
            shown_at = page.evaluate("Date.now()")
            n, m = len(hold["cells"]), len(body["taken"])
            assert (n, m) == (len(cells) - len(stolen), len(stolen))
            says(page, loom_status(page), f"Held {n} cells until {hold['expires_local']} kitchen time. "
                                          f"{m} cells were just taken by another booking.")
            for c in stolen:
                shows(page, cell(page, STATION_NAME[c["station_id"]], c["start"], "taken"))
            shows(page, cell(page, "Deck oven 1", "04:00", "held"))
            says(page, page.get_by_role("group", name="Quote total"), hold["quote"]["total"])
            says(page, page.get_by_role("complementary", name="Quote"), f"held until {hold['expires_local']}")
            bar = page.get_by_role("progressbar", name="Hold time left")
            shows(page, bar)
            value = "e => Number(e.getAttribute('aria-valuenow') ?? e.value)"
            spent = (page.evaluate("Date.now()") - shown_at) / 1000
            left = (instant(hold["expires_at"]) - instant(hold["server_now"])).total_seconds() - spent
            before = bar.evaluate(value)
            assert abs(before - left) <= BAR_SLACK, (before, left)
            advance(page, COUNTDOWN_PROBE_MS)
            after = bar.evaluate(value)
            assert abs((before - after) - COUNTDOWN_PROBE_MS / 1000) <= BAR_SLACK, (before, after)
    finally:
        if theirs:
            release(salt, theirs["id"])
        if hold:
            release(ember, hold["id"])


def test_same_day_cutoff_kitchen_time(app_url, browser):
    op, ember = Api(app_url, OPERATOR), Api(app_url, EMBER)
    k = kitchen(op)
    now = local(k["server_now"], k["timezone"])
    assert k["today"] == now.date().isoformat() and k["timezone"] == NSC_ZONE
    before = k["same_day_cutoff"]

    def hold_today(day: str, start: str, station: str = "st-walkin") -> httpx.Response:
        return ember.post("/api/holds", {"date": day, "cells": [{"station_id": station, "start": start}]})

    def closed_or_started(r: httpx.Response) -> None:
        assert r.status_code == 422 and r.json()["error"] in ("same_day_closed", "cell_in_past"), r.text

    try:
        r = op.patch(f"/api/kitchens/{NSC}/settings", {"same_day_cutoff": "00:00"})
        assert r.status_code == 200 and r.json()["kitchen"]["same_day_cutoff"] == "00:00"
        today, at = kitchen_now(op)
        ahead = max(mins(FIRST_CELL), at // QUARTER_MINUTES * QUARTER_MINUTES + 2 * QUARTER_MINUTES)
        if ahead <= mins(LAST_CELL):
            refused(hold_today(today, clock(ahead)), 422, "same_day_closed")
        else:
            closed_or_started(hold_today(today, LAST_CELL))
        assert op.patch(f"/api/kitchens/{NSC}/settings", {"same_day_cutoff": LAST_CELL}).status_code == 200
        today, at = kitchen_now(op)
        if mins(FIRST_CELL) <= at < mins(LAST_CELL):
            refused(hold_today(today, clock(at // QUARTER_MINUTES * QUARTER_MINUTES)), 422, "cell_in_past")
        elif at < mins(FIRST_CELL):
            placed = None
            for s in NSC_STATIONS:
                r = hold_today(today, FIRST_CELL, s)
                if r.status_code == 201:
                    placed = r.json()["hold"]
                    break
                refused(r, 409, "cells_taken")
            assert placed, "every first cell of today is taken"
            release(ember, placed["id"])
        else:
            closed_or_started(hold_today(today, FIRST_CELL))
        refused(op.patch(f"/api/kitchens/{NSC}/settings", {"same_day_cutoff": "10:10"}), 422, "validation")
    finally:
        op.patch(f"/api/kitchens/{NSC}/settings", {"same_day_cutoff": before})
    ctx = browser.new_context(timezone_id=PROBE_ZONE, viewport={"width": WIDE[0], "height": WIDE[1]})
    try:
        page = ctx.new_page()
        page.goto(app_url + "/signin")
        fill(page.get_by_role("textbox", name="Email"), EMBER)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("grid", name="Station loom")).to_be_visible(timeout=UI_MS)
        click(page.get_by_role("button", name="Today"))
        expect(page.get_by_label("Kitchen date")).to_have_value(re.compile("|".join(
            re.escape(day) for day in {k["today"], kitchen(op)["today"]})), timeout=UI_MS)
        expect(page.get_by_text("Kitchen time").first).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("columnheader", name=FIRST_CELL, exact=True)).to_be_visible(timeout=UI_MS)
    finally:
        ctx.close()


def test_wf_confirm_booking_happy(app_url, browser, mail, killbill):
    ember = Api(app_url, EMBER)
    d = free_date(ember, block(["st-deck-1", "st-deck-2"], "04:00", "05:00"))
    seen = mail_ids(mail)
    with open_mouse(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        open_loom(page, app_url, d)
        press_on(page, cell(page, "Deck oven 1", "04:00"))
        aim(page, cell(page, "Deck oven 2", "04:45"))
        shows(page, cell(page, "Deck oven 2", "04:45", "selected"))
        page.mouse.up()
        says(page, loom_status(page), "Held 8 cells until")
        click(page.get_by_role("button", name="Confirm booking"))
        dialog = page.get_by_role("dialog", name="Confirm booking")
        shows(page, dialog)
        click(dialog.get_by_role("button", name="Confirm", exact=True))
        says(page, loom_status(page), re.compile(rf"Booking PL-\d{{6}} confirmed\. Confirmation sent to {re.escape(EMBER)}\."))
        ref = re.search(r"PL-\d{6}", loom_status(page).inner_text()).group(0)
        shows(page, cell(page, "Deck oven 1", "04:00", "booked"))
        visit(page, "Bookings")
        shows(page, booking_row(page, ref))
        booking = next(b for b in own_bookings(ember, d) if b["ref"] == ref)
        invoice = ember.get(f"/api/invoices/{booking['invoice_id']}").json()["invoice"]
        visit(page, "Billing")
        shows(page, page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text=invoice["ref"]))
    assert keys(booking["cells"]) == keys(block(["st-deck-1", "st-deck-2"], "04:00", "05:00"))
    got = await_mail(mail, seen, lambda m: m["Subject"] == f"Booking {ref} confirmed — {NSC_NAME}")
    assert recipients(got[0]) == [EMBER]
    assert killbill.account_by_key("mem-ember") is not None
    cancel(ember, booking["id"])


def test_wf_confirm_booking_hold_expired(rig, browser):
    rig.ensure(billing=True, files=True, mail=True)
    ember = Api(rig.base, EMBER)
    cells = block(["st-deck-1", "st-deck-2"], "04:00", "04:30")
    d = free_date(ember, cells)
    with open_app(browser, rig.base + "/signin") as page:
        sign_in(page, rig.base, EMBER)
        open_loom(page, rig.base, d)
        focus_grid(page)
        extend(page, "ArrowRight", "ArrowDown")
        page.keyboard.press("Enter")
        says(page, loom_status(page), "Held 4 cells until")
        soon(page, lambda: expect(page).to_have_url(re.compile(r"hold="), timeout=EXPECT_MS))
        hold_id = hold_id_from(page)
        h = ember.get(f"/api/holds/{hold_id}").json()["hold"]
        poll(lambda: ember.get(f"/api/holds/{hold_id}").json()["hold"]["state"] == "expired",
             RIG_HOLD_SECONDS + SPAN_SLACK, "server-side hold expiry")
        click(page.get_by_role("button", name="Confirm booking"))
        dialog = page.get_by_role("dialog", name="Confirm booking")
        copy = f"Your hold expired at {h['expires_local']} kitchen time. Brush the block again."
        pressed: list[bool] = []

        def outcome() -> None:
            if not pressed and dialog.is_visible():
                click(dialog.get_by_role("button", name="Confirm", exact=True))
                pressed.append(True)
            dropped = not dialog.is_visible() and cell(page, "Deck oven 1", "04:00", "free").count() == 1
            assert copy in loom_status(page).inner_text() or dropped, "the expired hold was neither reported nor dropped"

        soon(page, outcome)
    assert not [b for b in own_bookings(ember, d) if keys(b["cells"]) & keys(cells)]
    again = place_hold(ember, d, cells)
    release(ember, again["id"])


def test_tiered_price_exact_cents(app_url):
    ember, op = Api(app_url, EMBER), Api(app_url, OPERATOR)
    order, card, today = station_order(ember), in_force_card(op), today_of(ember)
    example = block(["st-deck-1", "st-deck-2", "st-mixer", "st-chiller"], "04:00", "06:15")
    chosen = None
    for off in range(QUIET_FROM, QUIET_TO):
        d = (today + timedelta(days=off)).isoformat()
        body = quote(ember, d, example)
        if not body["taken"] and not body["papers"] and body["quote"]["month_hours_before"] == "0.00":
            chosen = (d, body["quote"])
            break
    assert chosen, "no zero-hour month with free cells for the worked example"
    d, q = chosen
    assert q["rate_card_id"] == "rc-nsc-seed"
    assert [(l["station_id"], l["tier"], l["paid_by"], l["quarters"], l["amount_cents"]) for l in q["lines"]] == EXAMPLE_LINES
    assert (q["total_cents"], q["total"], q["tier_steps_crossed"]) == (EXAMPLE_TOTAL, "$333.32", [2])
    big = block(NSC_STATIONS, "08:00", "12:00")
    bq = quote(ember, d, big)
    priced = [c for c in big if (c["station_id"], c["start"]) not in keys(bq["taken"])]
    lines, steps = price(priced, 0, card, order)
    assert shape(bq["quote"]["lines"]) == lines and bq["quote"]["tier_steps_crossed"] == steps
    assert bq["quote"]["total_cents"] == sum(l[5] for l in lines)
    h = place_hold(ember, d, example)
    r = confirm(ember, h["id"], EXAMPLE_TOTAL)
    assert r.status_code == 201, r.text
    booking, invoice = r.json()["booking"], r.json()["invoice"]
    try:
        assert shape(booking["lines"]) == shape(q["lines"]) and booking["total_cents"] == EXAMPLE_TOTAL
        assert invoice["total_cents"] == EXAMPLE_TOTAL and invoice["total"] == "$333.32"
        assert shape([l for l in invoice["lines"] if "station_id" in l]) == shape(q["lines"])
        nxt = quote(ember, d, block(["st-convection"], "08:00", "08:15"))["quote"]
        assert nxt["month_hours_before"] == hours_text(len(example))
        rate = card["tier_rates_cents"][1] + card["station_surcharges_cents"]["st-convection"]
        assert shape(nxt["lines"]) == [("st-convection", 2, "cash", 1, rate, (rate + 2) // 4)]
    finally:
        cancel(ember, booking["id"])


def test_confirm_refuses_changed_quote(app_url, mail):
    ember = Api(app_url, EMBER)
    d, cells = find_slot(ember, [block([s], "09:00", "10:00") for s in NSC_STATIONS])
    q = quote(ember, d, cells)["quote"]
    h = place_hold(ember, d, cells)
    seen = mail_ids(mail)
    body = refused(confirm(ember, h["id"], q["total_cents"] + 1), 409, "quote_changed")
    assert body["quote"]["total_cents"] == q["total_cents"]
    assert ember.get(f"/api/holds/{h['id']}").json()["hold"]["state"] == "held"
    assert not [b for b in own_bookings(ember, d) if keys(b["cells"]) & keys(cells)]
    r = confirm(ember, h["id"], q["total_cents"])
    assert r.status_code == 201, r.text
    ref = r.json()["booking"]["ref"]
    await_mail(mail, seen, lambda m: EMBER in recipients(m) and "confirmed" in m["Subject"])
    got = settled_mail(mail, seen, lambda m: EMBER in recipients(m) and "confirmed" in m["Subject"])
    assert [m["Subject"] for m in got] == [f"Booking {ref} confirmed — {NSC_NAME}"]
    cancel(ember, r.json()["booking"]["id"])


def test_confirm_idempotency(app_url, mail):
    ember, twin = Api(app_url, EMBER), Api(app_url, EMBER)
    d, c1 = find_slot(ember, [block([s], "10:00", "10:30") for s in NSC_STATIONS])
    q1 = quote(ember, d, c1)["quote"]
    h1 = place_hold(ember, d, c1)
    d2, c2 = find_slot(ember, [block([s], "10:30", "11:00") for s in NSC_STATIONS])
    h2 = place_hold(ember, d2, c2)
    seen = mail_ids(mail)
    key = idempotency_key()
    first = confirm(ember, h1["id"], q1["total_cents"], key=key)
    assert first.status_code == 201, first.text
    q2 = ember.get(f"/api/holds/{h2['id']}").json()["hold"]["quote"]
    replay = confirm(ember, h1["id"], q1["total_cents"], key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    refused(confirm(ember, h1["id"], q1["total_cents"] + 1, key=key), 409, "idempotency_key_reused")
    refused(confirm(ember, h2["id"], q2["total_cents"], key=key), 409, "idempotency_key_reused")
    assert ember.get(f"/api/holds/{h2['id']}").json()["hold"]["state"] == "held"
    assert "Idempotency-Key" in refused(confirm(ember, h2["id"], q2["total_cents"], key="k" * 101), 422, "validation")["errors"]
    key2 = idempotency_key()
    with ThreadPoolExecutor(2) as pool:
        both = list(pool.map(lambda a: confirm(a, h2["id"], q2["total_cents"], key=key2), [ember, twin]))
    assert [r.status_code for r in both] == [201, 201]
    assert both[0].json()["booking"]["id"] == both[1].json()["booking"]["id"]
    refs = [first.json()["booking"]["ref"], both[0].json()["booking"]["ref"]]
    assert len([b for b in own_bookings(ember, d) if keys(b["cells"]) == keys(c1)]) == 1
    for ref in refs:
        subj = f"Booking {ref} confirmed — {NSC_NAME}"
        await_mail(mail, seen, lambda m, s=subj: m["Subject"] == s)
        assert len(settled_mail(mail, seen, lambda m, s=subj: m["Subject"] == s)) == 1
    for r in (first, both[0]):
        cancel(ember, r.json()["booking"]["id"])


def test_confirm_all_or_nothing(app_url, rig, mail):
    kb = outage("APP_KILLBILL_DOWN_URL", "billing")
    ember, salt = Api(kb, EMBER), Api(app_url, SALTLINE)
    d, cells = find_slot(Api(app_url, EMBER), [block([s], "11:00", "11:30") for s in NSC_STATIONS])
    q = quote(ember, d, cells)["quote"]
    h = place_hold(ember, d, cells)
    seen = mail_ids(mail)
    invoices_before = {i["id"] for i in ember.get("/api/invoices").json()["invoices"]}
    refused(confirm(ember, h["id"], q["total_cents"]), 503, "billing_unavailable")
    assert ember.get(f"/api/holds/{h['id']}").json()["hold"]["state"] == "released"
    assert not [b for b in own_bookings(ember, d) if keys(b["cells"]) & keys(cells)]
    assert {i["id"] for i in ember.get("/api/invoices").json()["invoices"]} == invoices_before
    again = place_hold(salt, d, cells)
    release(salt, again["id"])

    rig.ensure(billing=True, files=True, mail=False)
    try:
        e2 = Api(rig.base, EMBER)
        q = quote(e2, d, cells)["quote"]
        h = place_hold(e2, d, cells)
        refused(confirm(e2, h["id"], q["total_cents"]), 503, "mail_unavailable")
        assert e2.get(f"/api/holds/{h['id']}").json()["hold"]["state"] == "released"
        assert not [b for b in own_bookings(e2, d) if keys(b["cells"]) & keys(cells)]
        assert {i["id"] for i in e2.get("/api/invoices").json()["invoices"]} == invoices_before
    finally:
        rig.ensure(mail=True)
    assert not settled_mail(mail, seen, lambda m: EMBER in recipients(m) and "confirmed" in m["Subject"])


def test_wf_confirm_booking_billing_down(browser, app_url):
    kb = outage("APP_KILLBILL_DOWN_URL", "billing")
    ember = Api(kb, EMBER)
    d = free_date(ember, block(["st-deck-1", "st-deck-2"], "04:00", "04:30"))
    with open_app(browser, kb + "/signin") as page:
        sign_in(page, kb, EMBER)
        open_loom(page, kb, d)
        says(page, page.get_by_role("status", name="Service status"), BILLING_DOWN_COPY)
        focus_grid(page)
        extend(page, "ArrowRight", "ArrowDown")
        page.keyboard.press("Enter")
        says(page, loom_status(page), "Held 4 cells until")
        soon(page, lambda: expect(page).to_have_url(re.compile(r"hold="), timeout=EXPECT_MS))
        hold_id = hold_id_from(page)
    h = ember.get(f"/api/holds/{hold_id}").json()["hold"]
    refused(confirm(ember, hold_id, h["quote"]["total_cents"]), 503, "billing_unavailable")
    assert ember.get(f"/api/holds/{hold_id}").json()["hold"]["state"] == "released"


def test_billing_invoice_per_booking(app_url, killbill):
    salt = Api(app_url, SALTLINE)
    d, cells = find_slot(salt, [block([s], "13:00", "14:00") for s in NSC_STATIONS])
    out = book(salt, d, cells)
    b, inv = out["booking"], out["invoice"]
    assert inv["kind"] == "booking" and inv["booking_ids"] == [b["id"]] and b["invoice_id"] == inv["id"]
    assert inv["killbill_invoice_id"]
    live = salt.get(f"/api/invoices/{inv['id']}").json()["invoice"]
    assert live["billing_amount_cents"] == live["total_cents"] == b["total_cents"]
    acct = killbill.account_by_key("mem-saltline")
    assert acct and acct["name"] == "Saltline Catering" and acct["email"] == SALTLINE and acct["currency"] == "USD"
    assert buy_pack(salt, "mem-saltline").status_code == 201
    d2, c2 = find_slot(salt, [block([s], "14:00", "14:30") for s in NSC_STATIONS])
    zero = book(salt, d2, c2, use_pack=True)
    assert zero["booking"]["total_cents"] == 0 and all(l["paid_by"] == "pack" for l in zero["booking"]["lines"])
    zinv = salt.get(f"/api/invoices/{zero['booking']['invoice_id']}").json()["invoice"]
    assert zinv["killbill_invoice_id"] is None and zinv["billing_amount_cents"] in (None, 0)
    cancel(salt, b["id"])
    cancel(salt, zero["booking"]["id"])


def test_confirmation_email(app_url, mail):
    ember = Api(app_url, EMBER)
    d, cells = find_slot(ember, [block(["st-kettle", "st-walkin"], "15:00", "16:00")])
    seen = mail_ids(mail)
    b = book(ember, d, cells)["booking"]
    subj = f"Booking {b['ref']} confirmed — {NSC_NAME}"
    await_mail(mail, seen, lambda m: m["Subject"] == subj)
    got = settled_mail(mail, seen, lambda m: m["Subject"] == subj)
    assert len(got) == 1 and recipients(got[0]) == [EMBER]
    assert addresses(got[0]["From"]) == [mail_from_address()]
    body = mail_text(got[0])
    for piece in (b["ref"], "Steam kettle", "Walk-in cooler"):
        assert piece in body, piece
    assert mentions_date(body, d), d
    assert mentions_amount(body, b["total"]), b["total"]
    for other in ("Saltline Catering", "Wren Street Dumplings", "Tidewater Granola", "Copper Pot Jams"):
        assert other not in body
    cancel(ember, b["id"])


def entries(movement: dict) -> dict[str, int]:
    return {e["account"]: e["quarters"] for e in movement["entries"]}


def test_buy_pack(app_url, killbill):
    ember, op, salt, ines = Api(app_url, EMBER), Api(app_url, OPERATOR), Api(app_url, SALTLINE), Api(app_url, INES)
    card = in_force_card(op)
    before = pack(ember, "mem-ember")["balance_quarters"]
    key = idempotency_key()
    r = buy_pack(ember, "mem-ember", key)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["movement"]["kind"] == "purchase" and abs(body["movement"]["quarters"]) == PACK_QUARTERS
    assert entries(body["movement"]) == {"member_pack": PACK_QUARTERS, "pack_sales": -PACK_QUARTERS}
    assert body["balance_quarters"] == before + PACK_QUARTERS
    assert body["invoice"]["kind"] == "pack" and body["invoice"]["total_cents"] == card["pack_price_cents"]
    replay = buy_pack(ember, "mem-ember", key)
    assert replay.status_code == 201 and replay.json() == body
    assert pack(ember, "mem-ember")["balance_quarters"] == before + PACK_QUARTERS
    live = ember.get(f"/api/invoices/{body['invoice']['id']}").json()["invoice"]
    assert live["killbill_invoice_id"] and live["billing_amount_cents"] == card["pack_price_cents"]
    assert killbill.account_by_key("mem-ember") is not None
    wren_before = pack(op, "mem-wren")["balance_quarters"]
    assert buy_pack(op, "mem-wren").status_code == 201
    assert pack(op, "mem-wren")["balance_quarters"] == wren_before + PACK_QUARTERS
    refused(buy_pack(salt, "mem-ember"), 404, "not_found")
    refused(buy_pack(op, "mem-copper"), 404, "not_found")
    refused(buy_pack(ines, "mem-ember"), 403, "forbidden")


def test_pack_draw_in_cell_order(app_url):
    copper, teo = Api(app_url, COPPER), Api(app_url, TEO)
    order, card = station_order(copper), in_force_card(teo, LARK)
    assert buy_pack(copper, "mem-copper").status_code == 201
    balance = pack(copper, "mem-copper")["balance_quarters"]
    need = balance + 4
    assert need <= MAX_CELLS
    per = -(-need // len(LARK_STATIONS))
    rect = block(LARK_STATIONS, FIRST_CELL, clock(mins(FIRST_CELL) + per * QUARTER_MINUTES))
    cells = sorted(rect, key=lambda c: (c["start"], order[c["station_id"]]))[:need]
    d = free_date(copper, cells)
    q = quote(copper, d, cells, use_pack=True)["quote"]
    lines, _ = price(cells, quarters_of(q["month_hours_before"]), card, order, pack_quarters=balance)
    assert shape(q["lines"]) == lines and q["pack_quarters"] == balance
    assert q["total_cents"] == sum(l[5] for l in lines)
    h = place_hold(copper, d, cells)
    r = confirm(copper, h["id"], q["total_cents"], use_pack=True)
    assert r.status_code == 201, r.text
    b = r.json()["booking"]
    assert b["pack_quarters"] == balance and shape(b["lines"]) == lines
    ledger = pack(copper, "mem-copper")
    draw = [m for m in ledger["movements"] if m["kind"] == "draw" and m["booking_id"] == b["id"]]
    assert draw and sum(entries(m)["member_pack"] for m in draw) == -balance
    assert all(set(entries(m)) == {"member_pack", "hours_used"} and entries(m)["hours_used"] == -entries(m)["member_pack"] > 0
               for m in draw), draw
    assert ledger["balance_quarters"] == 0
    d2, c2 = find_slot(copper, [block([s], "20:00", "20:15") for s in LARK_STATIONS])
    h2 = place_hold(copper, d2, c2)
    assert "use_pack" in refused(confirm(copper, h2["id"], 0, use_pack=True), 422, "validation")["errors"]
    release(copper, h2["id"])


def test_pack_ledger_pairs(app_url):
    salt = Api(app_url, SALTLINE)
    assert buy_pack(salt, "mem-saltline").status_code == 201
    d, cells = find_slot(salt, [block([s], "16:00", "17:00") for s in NSC_STATIONS])
    b = book(salt, d, cells, use_pack=True)["booking"]
    assert cancel(salt, b["id"]).status_code == 200
    ledger = pack(salt, "mem-saltline")
    allowed = {"purchase": {"member_pack", "pack_sales"}, "draw": {"member_pack", "hours_used"},
               "refund": {"member_pack", "hours_used"}}
    for m in ledger["movements"]:
        assert len(m["entries"]) == 2 and sum(e["quarters"] for e in m["entries"]) == 0, m
        assert set(entries(m)) == allowed[m["kind"]], m
    total = sum(e["quarters"] for m in ledger["movements"] for e in m["entries"] if e["account"] == "member_pack")
    assert ledger["balance_quarters"] == total >= 0 and ledger["balance_hours"] == hours_text(total)
    draws = [m for m in ledger["movements"] if m["kind"] == "draw" and m["booking_id"] == b["id"]]
    assert draws
    for draw in draws:
        refunds = [m for m in ledger["movements"] if m["kind"] == "refund" and m["reverses"] == draw["id"]]
        assert len(refunds) == 1 and entries(refunds[0]) == {k: -v for k, v in entries(draw).items()}
    reversed_ids = [m["reverses"] for m in ledger["movements"] if m["kind"] == "refund"]
    assert len(reversed_ids) == len(set(reversed_ids))
    body = refused(cancel(salt, b["id"]), 409, "invalid_transition")
    assert (body["from"], body["to"]) == ("cancelled_in_window", "cancelled")
    assert pack(salt, "mem-saltline") == ledger


def test_wf_prepaid_pack_buy_and_book(app_url, browser):
    ember = Api(app_url, EMBER)
    before = pack(ember, "mem-ember")["balance_quarters"]
    d = free_date(ember, block(["st-deck-1", "st-deck-2"], "04:00", "04:30"))
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        visit(page, "Billing")
        shows(page, page.get_by_role("table", name="Pack movements"))
        click(page.get_by_role("button", name="Buy 20-hour pack"))
        says(page, form_status(page), f"20-hour pack added. Balance {hours_text(before + PACK_QUARTERS)} hours.")
        open_loom(page, app_url, d)
        rail = page.get_by_role("complementary", name="Quote")
        grid = page.get_by_role("grid", name="Station loom")
        focus_grid(page)
        extend(page, "ArrowRight", "ArrowDown")
        shows(page, cell(page, "Deck oven 2", "04:15", "selected"))
        set_box(rail.get_by_role("checkbox", name=re.compile(r"^Use pack hours")), True)
        says(page, page.get_by_role("list", name="Quote lines"), "pack")
        for _ in range(TAB_LIMIT):
            if inside(grid):
                break
            page.keyboard.press("Shift+Tab")
        assert inside(grid), "Shift+Tab never returned to the loom grid"
        page.keyboard.press("Enter")
        says(page, loom_status(page), "Held 4 cells until")
        click(page.get_by_role("button", name="Confirm booking"))
        dialog = page.get_by_role("dialog", name="Confirm booking")
        shows(page, dialog)
        set_box(dialog.get_by_role("checkbox", name=re.compile(r"^Use pack hours")), True)
        click(dialog.get_by_role("button", name="Confirm", exact=True))
        says(page, loom_status(page), "confirmed")
        visit(page, "Billing")
        left = hours_text(before + PACK_QUARTERS - 4)
        shows(page, page.get_by_text(re.compile(rf"(^|[^\d.]){re.escape(left)} hours")).first)
    b = next(b for b in own_bookings(ember, d) if keys(b["cells"]) == keys(block(["st-deck-1", "st-deck-2"], "04:00", "04:30")))
    assert b["pack_quarters"] == 4 and b["total_cents"] == 0
    ledger = pack(ember, "mem-ember")
    assert ledger["balance_quarters"] == before + PACK_QUARTERS - 4
    assert [m for m in ledger["movements"] if m["kind"] == "draw" and m["booking_id"] == b["id"]]
    cancel(ember, b["id"])


def test_wf_prepaid_pack_operator_buys(app_url, browser, killbill):
    op = Api(app_url, OPERATOR)
    before = pack(op, "mem-wren")["balance_quarters"]
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, OPERATOR)
        visit(page, "Members")
        row = page.get_by_role("table", name="Members").get_by_role("row").filter(has_text="Wren Street Dumplings")
        click(row.get_by_role("button", name="Buy 20-hour pack"))
        says(page, form_status(page), f"20-hour pack added. Balance {hours_text(before + PACK_QUARTERS)} hours.")
    assert pack(op, "mem-wren")["balance_quarters"] == before + PACK_QUARTERS
    assert killbill.account_by_key("mem-wren") is not None


def test_cancellation_window(app_url):
    salt = Api(app_url, SALTLINE)
    db, cb = find_slot(salt, [block([s], "17:30", "18:30") for s in NSC_STATIONS])
    b = book(salt, db, cb)["booking"]
    dc, cc = find_slot(salt, [block([s], "22:00", "22:30") for s in NSC_STATIONS], first=1, last=1)
    c = book(salt, dc, cc)["booking"]
    b = salt.get(f"/api/bookings/{b['id']}").json()["booking"]
    c = salt.get(f"/api/bookings/{c['id']}").json()["booking"]
    for bk, cells in ((b, cb), (c, cc)):
        start = local(bk["starts_at"], NSC_ZONE)
        assert start.date().isoformat() == bk["date"] and start.strftime("%H:%M") == min(x["start"] for x in cells)
        assert bk["cancellation_window_hours"] == SEED_WINDOW_HOURS
    hb = quote(salt, db, block(["st-walkin"], "04:00", "04:15"))["quote"]["month_hours_before"]
    rb = cancel(salt, b["id"])
    assert rb.status_code == 200, rb.text
    assert rb.json()["booking"]["state"] == "cancelled_in_window"
    after = quote(salt, db, block(["st-walkin"], "04:00", "04:15"))["quote"]["month_hours_before"]
    assert quarters_of(hb) - quarters_of(after) == b["quarters"]
    hc = quote(salt, dc, block(["st-walkin"], "04:00", "04:15"))["quote"]["month_hours_before"]
    rc = cancel(salt, c["id"])
    assert rc.status_code == 200, rc.text
    assert rc.json()["booking"]["state"] == "cancelled_late"
    assert quote(salt, dc, block(["st-walkin"], "04:00", "04:15"))["quote"]["month_hours_before"] == hc


def test_cancellation_refunds_receipt(app_url, mail):
    salt, ember = Api(app_url, SALTLINE), Api(app_url, EMBER)
    assert buy_pack(salt, "mem-saltline").status_code == 201
    seen = mail_ids(mail)
    da, ca = find_slot(salt, [block([s], "17:00", "17:30") for s in NSC_STATIONS])
    a = book(salt, da, ca, use_pack=True)["booking"]
    db, cb = find_slot(salt, [block([s], "18:30", "19:30") for s in NSC_STATIONS])
    b = book(salt, db, cb)["booking"]
    dc, cc = find_slot(salt, [block([s], "21:30", "22:00") for s in NSC_STATIONS], first=1, last=1)
    c = book(salt, dc, cc)["booking"]
    balance = pack(salt, "mem-saltline")["balance_quarters"]
    ra = cancel(salt, a["id"]).json()
    assert ra["booking"]["state"] == "cancelled_in_window"
    assert ra["refund"]["pack_quarters"] == a["pack_quarters"] > 0 and ra["refund"]["amount_cents"] == 0
    assert pack(salt, "mem-saltline")["balance_quarters"] == balance + a["pack_quarters"]
    moves = pack(salt, "mem-saltline")["movements"]
    draws = {m["id"] for m in moves if m["kind"] == "draw" and m["booking_id"] == a["id"]}
    refunds = [m for m in moves if m["kind"] == "refund" and m["reverses"] in draws]
    assert draws and len(refunds) == len(draws)
    assert sum(entries(m)["member_pack"] for m in refunds) == a["pack_quarters"]
    assert all(entries(m)["hours_used"] == -entries(m)["member_pack"] for m in refunds), refunds
    rb = cancel(salt, b["id"]).json()
    assert rb["booking"]["state"] == "cancelled_in_window"
    assert (rb["refund"]["amount_cents"], rb["refund"]["amount"], rb["refund"]["pack_quarters"]) == (b["total_cents"], b["total"], 0)
    late_balance = pack(salt, "mem-saltline")["balance_quarters"]
    rc = cancel(salt, c["id"]).json()
    assert rc["booking"]["state"] == "cancelled_late"
    assert (rc["refund"]["pack_quarters"], rc["refund"]["amount_cents"]) == (0, 0)
    assert pack(salt, "mem-saltline")["balance_quarters"] == late_balance
    for bk, refund, word in ((a, ra, "in window"), (b, rb, "in window"), (c, rc, "late")):
        subj = f"Booking {bk['ref']} cancelled — {hours_text(refund['refund']['pack_quarters'])} pack hours refunded"
        got = await_mail(mail, seen, lambda m, s=subj: m["Subject"] == s)
        body = mail_text(got[0]).lower()
        assert recipients(got[0]) == [SALTLINE] and any(re.search(w, body) for w in OUTCOME_WORDS[word]), body
        assert len(settled_mail(mail, seen, lambda m, s=subj: m["Subject"] == s)) == 1
    for d, cells in ((da, ca), (db, cb), (dc, cc)):
        h = place_hold(ember, d, cells)
        release(ember, h["id"])


def test_wf_cancel_booking_in_window(app_url, browser, mail):
    ember = Api(app_url, EMBER)
    d, cells = find_slot(ember, [block([s], "18:30", "19:00") for s in NSC_STATIONS])
    b = book(ember, d, cells)["booking"]
    seen = mail_ids(mail)
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        visit(page, "Bookings")
        region = open_booking(page, b["ref"])
        click(region.get_by_role("button", name="Cancel booking"))
        dialog = page.get_by_role("dialog", name="Cancel booking")
        says(page, dialog, f"Cancelling now refunds 0.00 pack hours and {b['total']}.")
        click(dialog.get_by_role("button", name="Yes, cancel"))
        says(page, form_status(page), f"Booking {b['ref']} cancelled. 0.00 pack hours and {b['total']} refunded.")
    assert ember.get(f"/api/bookings/{b['id']}").json()["booking"]["state"] == "cancelled_in_window"
    await_mail(mail, seen, lambda m: m["Subject"] == f"Booking {b['ref']} cancelled — 0.00 pack hours refunded")


def test_wf_cancel_booking_late(app_url, browser):
    ember = Api(app_url, EMBER)
    d, cells = find_slot(ember, [block([s], "22:30", "23:00") for s in NSC_STATIONS], first=1, last=1)
    b = book(ember, d, cells)["booking"]
    w = b["cancellation_window_hours"]
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        visit(page, "Bookings")
        region = open_booking(page, b["ref"])
        opener = region.get_by_role("button", name="Cancel booking")
        click(opener)
        dialog = page.get_by_role("dialog", name="Cancel booking")
        says(page, dialog, f"This is inside the {w}-hour cancellation window. Cancelling now refunds nothing.")
        click(dialog.get_by_role("button", name="Keep booking"))
        soon(page, lambda: expect(dialog).to_be_hidden(timeout=EXPECT_MS))
        click(opener)
        click(dialog.get_by_role("button", name="Yes, cancel"))
        says(page, form_status(page), f"Booking {b['ref']} cancelled inside the {w}-hour window, so it is still charged.")
    assert ember.get(f"/api/bookings/{b['id']}").json()["booking"]["state"] == "cancelled_late"


def card_body(eff: str, stations: list[str]) -> dict:
    return {
        "effective_from": eff,
        "tier_rates_cents": [to_cents(t) for t in NEW_TIERS],
        "station_surcharges_cents": {s: to_cents(NEW_SURCHARGE) for s in stations},
        "cancellation_window_hours": NEW_WINDOW,
        "pack_price_cents": to_cents(NEW_PACK),
    }


def add_future_card(op: Api) -> dict:
    today = today_of(op)
    offsets = list(range(FUTURE_CARD_FROM, FUTURE_CARD_TO))
    random.shuffle(offsets)
    for off in offsets:
        r = op.post(f"/api/kitchens/{NSC}/rate-cards", card_body((today + timedelta(days=off)).isoformat(), NSC_STATIONS))
        if r.status_code == 201:
            return r.json()["rate_card"]
        refused(r, 409, "rate_card_exists")
    pytest.fail("no free future effective date")


def cards(op: Api) -> list[dict]:
    return op.get(f"/api/kitchens/{NSC}/rate-cards").json()["rate_cards"]


def test_rate_cards_effective_dated(app_url):
    op = Api(app_url, OPERATOR)
    today = today_of(op)
    before = {c["id"]: {k: v for k, v in c.items() if k != "in_force"} for c in cards(op)}
    new = add_future_card(op)
    assert new["in_force"] is False and new["tier_rates_cents"] == [to_cents(t) for t in NEW_TIERS]
    after = cards(op)
    for c in after:
        if c["id"] in before:
            assert {k: v for k, v in c.items() if k != "in_force"} == before[c["id"]]
    assert new["id"] in {c["id"] for c in after}
    live = [c for c in after if c["in_force"]]
    eligible = [c for c in after if c["effective_from"] <= today.isoformat()]
    assert len(live) == 1 and live[0]["effective_from"] == max(c["effective_from"] for c in eligible)
    refused(op.post(f"/api/kitchens/{NSC}/rate-cards", card_body(new["effective_from"], NSC_STATIONS)), 409, "rate_card_exists")
    refused(op.post(f"/api/kitchens/{NSC}/rate-cards", card_body((today - timedelta(days=1)).isoformat(), NSC_STATIONS)),
            422, "validation")
    future = (today + timedelta(days=FUTURE_CARD_TO)).isoformat()
    refused(op.post(f"/api/kitchens/{NSC}/rate-cards", card_body(future, NSC_STATIONS[1:])), 422, "validation")
    bad = card_body(future, NSC_STATIONS)
    bad["cancellation_window_hours"] = WINDOW_MAX_HOURS + 1
    refused(op.post(f"/api/kitchens/{NSC}/rate-cards", bad), 422, "validation")
    refused(Api(app_url, EMBER).post(f"/api/kitchens/{NSC}/rate-cards", card_body(future, NSC_STATIONS)), 403, "forbidden")
    refused(Api(app_url, INES).post(f"/api/kitchens/{NSC}/rate-cards", card_body(future, NSC_STATIONS)), 403, "forbidden")
    refused(Api(app_url, TEO).post(f"/api/kitchens/{NSC}/rate-cards", card_body(future, NSC_STATIONS)), 404, "not_found")


SECONDS_PER_HOUR = 3600
SHIFT_SLACK_S = 300
WINDOW_MARGIN_S = 3600
PSQL_SECONDS = 60
SHIFT_ENV = "PL_VERIFIER_CLOCK_SHIFT_MS"
CLOCK_SHIFT_JS = (
    f"const shift = Number(process.env.{SHIFT_ENV} || 0);\n"
    "const Real = Date;\n"
    "class Shifted extends Real {\n"
    "  constructor(...args) { if (args.length === 0) super(Real.now() + shift); else super(...args); }\n"
    "  static now() { return Real.now() + shift; }\n"
    "}\n"
    "globalThis.Date = Shifted;\n"
)


@contextlib.contextmanager
def scratch_database() -> Iterator[str]:
    base = os.environ["DATABASE_URL"]
    name = f"pl_scratch_{uuid.uuid4().hex[:10]}"

    def admin(sql: str) -> subprocess.CompletedProcess:
        return subprocess.run(["psql", base, "-v", "ON_ERROR_STOP=1", "-c", sql],
                              capture_output=True, text=True, timeout=PSQL_SECONDS)

    made = admin(f'CREATE DATABASE "{name}"')
    assert made.returncode == 0, made.stderr
    try:
        yield urlsplit(base)._replace(path=f"/{name}").geturl()
    finally:
        if admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)').returncode != 0:
            admin(f'DROP DATABASE IF EXISTS "{name}"')


def signed_in(base: str, email: str) -> Api:
    def attempt() -> Api | None:
        r = httpx.post(base + "/api/session", json={"email": email, "password": PASSWORD},
                       headers={"Origin": origin(base)}, timeout=HTTP_TIMEOUT)
        return Api(base, email) if r.status_code == 200 else None

    return poll(attempt, BOOT_SECONDS, f"seeded sign-in for {email}")


@contextlib.contextmanager
def shifted_copy(db_url: str, shift_ms: int) -> Iterator[str]:
    preload = Path(tempfile.mkstemp(suffix=".cjs")[1])
    preload.write_text(CLOCK_SHIFT_JS)
    options = f"{os.environ.get('NODE_OPTIONS', '')} --require={preload}".strip()
    with app_copy({"DATABASE_URL": db_url, "NODE_OPTIONS": options, SHIFT_ENV: str(shift_ms)}) as base:
        yield base


def test_kept_terms():
    kept = ("lines", "total_cents", "total", "pack_quarters", "rate_card_id", "cancellation_window_hours")
    with scratch_database() as db_url:
        with app_copy({"DATABASE_URL": db_url}) as base:
            op, ember = signed_in(base, OPERATOR), signed_in(base, EMBER)
            order, old = station_order(ember), in_force_card(op)
            k = kitchen(op)
            zone, today, now = ZoneInfo(k["timezone"]), date.fromisoformat(k["today"]), instant(k["server_now"])
            shift = (datetime.combine(today + timedelta(days=1), dtime(0), zone) - now).total_seconds() + SHIFT_SLACK_S
            far_cells = block(["st-convection", "st-range"], "08:00", "09:00")
            far = book(ember, (today + timedelta(days=FAR)).isoformat(), far_cells, use_pack=True)
            starts = [datetime.combine(today + timedelta(days=off), dtime(m // 60, m % 60), zone)
                      for off in range(1, 6) for m in range(mins(FIRST_CELL), mins(LAST_CELL) + 1, QUARTER_MINUTES)]
            edge_start = next(s for s in starts if (s - now).total_seconds() - shift
                              >= NEW_WINDOW * SECONDS_PER_HOUR + WINDOW_MARGIN_S)
            edge = book(ember, edge_start.date().isoformat(),
                        [{"station_id": "st-walkin", "start": edge_start.strftime("%H:%M")}], use_pack=True)
            r = op.post(f"/api/kitchens/{NSC}/rate-cards", card_body((today + timedelta(days=1)).isoformat(), NSC_STATIONS))
            assert r.status_code == 201, r.text
            new = r.json()["rate_card"]
            listed = {c["id"]: c for c in cards(op)}
            assert listed[old["id"]]["in_force"] and not listed[new["id"]]["in_force"]
        with shifted_copy(db_url, int(shift * 1000)) as base:
            op, ember = signed_in(base, OPERATOR), signed_in(base, EMBER)
            k2 = kitchen(op)
            moved = k2["today"] != today.isoformat()
            if moved:
                assert k2["today"] == (today + timedelta(days=1)).isoformat(), k2
            listed = {c["id"]: c for c in cards(op)}
            in_force = [c["id"] for c in listed.values() if c["in_force"]]
            assert len(in_force) == 1 and in_force[0] in (old["id"], new["id"]), listed
            live = new if in_force[0] == new["id"] else old
            for card in (old, new):
                assert ({key: v for key, v in listed[card["id"]].items() if key != "in_force"}
                        == {key: v for key, v in card.items() if key != "in_force"})
            for out in (far, edge):
                b, inv = out["booking"], out["invoice"]
                again = ember.get(f"/api/bookings/{b['id']}").json()["booking"]
                for field in kept:
                    assert again[field] == b[field], field
                assert (again["rate_card_id"], again["cancellation_window_hours"]) == (old["id"], old["cancellation_window_hours"])
                bill = ember.get(f"/api/invoices/{inv['id']}").json()["invoice"]
                assert bill["total_cents"] == inv["total_cents"]
                assert shape([l for l in bill["lines"] if "station_id" in l]) == shape(b["lines"])
            qd = (date.fromisoformat(k2["today"]) + timedelta(days=NEAR)).isoformat()
            q = quote(ember, qd, far_cells)["quote"]
            lines, _ = price(far_cells, quarters_of(q["month_hours_before"]), live, order)
            assert q["rate_card_id"] == live["id"] and shape(q["lines"]) == lines
            fr = cancel(ember, far["booking"]["id"])
            assert fr.status_code == 200, fr.text
            assert fr.json()["booking"]["state"] == "cancelled_in_window"
            assert fr.json()["refund"]["pack_quarters"] == far["booking"]["pack_quarters"]
            gap = (instant(edge["booking"]["starts_at"]) - instant(kitchen(op)["server_now"])).total_seconds()
            gaps = (gap, gap + shift) if moved else (gap,)
            er = cancel(ember, edge["booking"]["id"])
            assert er.status_code == 200, er.text
            low = NEW_WINDOW * SECONDS_PER_HOUR + WINDOW_MARGIN_S / 4
            high = old["cancellation_window_hours"] * SECONDS_PER_HOUR - WINDOW_MARGIN_S / 4
            if all(low <= g <= high for g in gaps):
                assert er.json()["booking"]["state"] == "cancelled_late", er.json()
                assert er.json()["refund"]["pack_quarters"] == 0


def fill_card_form(page: Page, eff: str) -> None:
    form = page.get_by_role("form", name="New rate card")
    fill(form.get_by_label("Effective from"), eff)
    for i, amount in enumerate(NEW_TIERS, start=1):
        fill(form.get_by_label(f"Tier {i} hourly rate"), amount)
    for name in STATION_NAME.values():
        fill(form.get_by_label(f"{name} surcharge"), NEW_SURCHARGE)
    fill(form.get_by_label("Cancellation window (hours)"), str(NEW_WINDOW))
    fill(form.get_by_label("Pack price"), NEW_PACK)
    click(form.get_by_role("button", name="Add rate card"))


def free_card_date(op: Api) -> str:
    taken = {c["effective_from"] for c in cards(op)}
    today = today_of(op)
    options = [(today + timedelta(days=o)).isoformat() for o in range(FUTURE_CARD_FROM, FUTURE_CARD_TO)]
    return random.choice([o for o in options if o not in taken])


def test_wf_rates_and_policy_add_card(app_url, browser):
    op = Api(app_url, OPERATOR)
    eff = free_card_date(op)
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, OPERATOR)
        visit(page, "Rates")
        listed = page.get_by_role("table", name="Rate cards").get_by_role("row").filter(has=page.get_by_role("cell"))
        count = len(cards(op))
        soon(page, lambda: expect(listed).to_have_count(count, timeout=EXPECT_MS))
        fill_card_form(page, eff)
        says(page, form_status(page), f"Rate card added. It applies from {eff}.")
        soon(page, lambda: expect(listed).to_have_count(count + 1, timeout=EXPECT_MS))
    stored = [c for c in cards(op) if c["effective_from"] == eff]
    assert len(stored) == 1
    assert stored[0]["tier_rates_cents"] == [to_cents(t) for t in NEW_TIERS]
    assert stored[0]["station_surcharges_cents"] == {s: to_cents(NEW_SURCHARGE) for s in NSC_STATIONS}
    assert (stored[0]["cancellation_window_hours"], stored[0]["pack_price_cents"]) == (NEW_WINDOW, to_cents(NEW_PACK))


def test_wf_rates_and_policy_duplicate_date(app_url, browser):
    op = Api(app_url, OPERATOR)
    eff = add_future_card(op)["effective_from"]
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, OPERATOR)
        visit(page, "Rates")
        fill_card_form(page, eff)
        says(page, form_status(page), f"A rate card already starts on {eff}.")
    assert len([c for c in cards(op) if c["effective_from"] == eff]) == 1


def series_body(stations, start, end, first, weeks, total=None) -> dict:
    body = {"station_ids": stations, "start": start, "end": end, "first_date": first, "weeks": weeks, "use_pack": False}
    if total is not None:
        body["quoted_total_cents"] = total
    return body


def series_slot(api: Api, stations, start, end, weeks, first=NEAR, last=FAR):
    today = today_of(api)
    offsets = list(range(first, last + 1))
    random.shuffle(offsets)
    for off in offsets:
        d = (today + timedelta(days=off)).isoformat()
        r = api.post("/api/series/quote", series_body(stations, start, end, d, weeks))
        if r.status_code == 200:
            return d, r.json()
    pytest.fail("no free weekly slot")


def series_shown(page: Page, dialog, sq: dict) -> None:
    def listed() -> None:
        body = dialog.inner_text()
        missing = [o["date"] for o in sq["occurrences"] if not mentions_date(body, o["date"])]
        totals = re.findall(r"\$\s?\d[\d,]*\.\d{2}", body)
        assert not missing and len(totals) > len(sq["occurrences"]), f"weeks not previewed: {missing}, totals {totals}"

    soon(page, listed)


def test_weekly_series(app_url, mail):
    ember, salt = Api(app_url, EMBER), Api(app_url, SALTLINE)
    st = ["st-prep-a", "st-prep-b"]
    first, sq = series_slot(ember, st, "20:00", "21:00", 4)
    seen = mail_ids(mail)
    key = idempotency_key()
    body = series_body(st, "20:00", "21:00", first, 4, sq["total_cents"])
    r = ember.post("/api/series", body, key=key)
    assert r.status_code == 201, r.text
    out = r.json()
    bookings, inv = out["bookings"], out["invoice"]
    dates = [(date.fromisoformat(first) + timedelta(weeks=i)).isoformat() for i in range(4)]
    bookings = sorted(bookings, key=lambda b: b["date"])
    assert [b["date"] for b in bookings] == dates
    assert sorted(out["series"]["booking_ids"]) == sorted(b["id"] for b in bookings)
    assert inv["kind"] == "series" and sorted(inv["booking_ids"]) == sorted(b["id"] for b in bookings)
    assert all(b["invoice_id"] == inv["id"] and b["series_id"] == out["series"]["id"] for b in bookings)
    assert inv["total_cents"] == sum(b["total_cents"] for b in bookings) == sq["total_cents"]
    assert len(inv["lines"]) == sum(len(b["lines"]) for b in bookings)
    replay = ember.post("/api/series", body, key=key)
    assert replay.status_code == 201 and replay.json() == out
    refused(ember.post("/api/series", {**body, "weeks": 3}, key=key), 409, "idempotency_key_reused")
    subj = f"Weekly series {bookings[0]['ref']} to {bookings[-1]['ref']} confirmed — {NSC_NAME}"
    got = await_mail(mail, seen, lambda m: m["Subject"] == subj)
    assert recipients(got[0]) == [EMBER]
    text_body = mail_text(got[0])
    assert all(b["ref"] in text_body and mentions_date(text_body, b["date"]) for b in bookings)
    assert "Saltline Catering" not in text_body
    assert len(settled_mail(mail, seen, lambda m: m["Subject"] == subj)) == 1

    first2, sq2 = series_slot(ember, st, "21:00", "22:00", 4)
    d3 = (date.fromisoformat(first2) + timedelta(weeks=2)).isoformat()
    blocker = place_hold(salt, d3, block(st[:1], "21:00", "21:15"))
    try:
        c = refused(ember.post("/api/series/quote", series_body(st, "21:00", "22:00", first2, 4)), 409, "series_conflict")
        assert c["dates"] == [d3] and all(t["date"] == d3 for t in c["taken"])
        refused(ember.post("/api/series", series_body(st, "21:00", "22:00", first2, 4, sq2["total_cents"]), key=idempotency_key()),
                409, "series_conflict")
        for i in range(4):
            d = (date.fromisoformat(first2) + timedelta(weeks=i)).isoformat()
            assert not [b for b in own_bookings(ember, d) if keys(b["cells"]) & keys(block(st, "21:00", "22:00"))]
    finally:
        release(salt, blocker["id"])
    for weeks in (WEEKS_MIN - 1, WEEKS_MAX + 1):
        refused(ember.post("/api/series/quote", series_body(st, "21:00", "22:00", first2, weeks)), 422, "validation")
    for b in bookings:
        cancel(ember, b["id"])


def next_transition(zone: str, after: date) -> date:
    tz = ZoneInfo(zone)
    d = after
    for _ in range(HORIZON_DAYS):
        if datetime.combine(d, dtime(12), tz).utcoffset() != datetime.combine(d + timedelta(days=1), dtime(12), tz).utcoffset():
            return d + timedelta(days=1)
        d += timedelta(days=1)
    pytest.fail("no daylight-saving change within a year")


def test_series_wall_clock_across_dst(app_url):
    ember = Api(app_url, EMBER)
    today = today_of(ember)
    change = next_transition(NSC_ZONE, today + timedelta(days=NEAR))
    first = max(today + timedelta(days=NEAR), change - timedelta(days=14))
    options = [["st-deck-1", "st-deck-2"], ["st-prep-a", "st-prep-b"], ["st-range", "st-kettle"], ["st-convection", "st-mixer"]]
    chosen = None
    for shift in range(7):
        start = first - timedelta(days=shift)
        if start <= today:
            break
        for st in options:
            r = ember.post("/api/series/quote", series_body(st, "04:30", "06:30", start.isoformat(), 4))
            if r.status_code == 200:
                chosen = (st, start.isoformat(), r.json())
                break
        if chosen:
            break
    assert chosen, "no free weekly slot across the clock change"
    st, start, sq = chosen
    r = ember.post("/api/series", series_body(st, "04:30", "06:30", start, 4, sq["total_cents"]), key=idempotency_key())
    assert r.status_code == 201, r.text
    bookings = r.json()["bookings"]
    try:
        for occ in sq["occurrences"]:
            assert local(occ["starts_at"]).strftime("%H:%M") == "04:30"
        for b in bookings:
            s, e = local(b["starts_at"]), local(b["ends_at"])
            assert s.date().isoformat() == b["date"] and s.strftime("%H:%M") == "04:30" and e.strftime("%H:%M") == "06:30"
            assert b["quarters"] == bookings[0]["quarters"]
        assert len({local(b["starts_at"]).utcoffset() for b in bookings}) == 2
    finally:
        for b in bookings:
            cancel(ember, b["id"])


def test_wf_recurring_slot_weekly(app_url, browser):
    ember = Api(app_url, EMBER)
    st = ["st-deck-1", "st-deck-2"]
    first, sq = series_slot(ember, st, "04:00", "04:30", 4)
    dates = [(date.fromisoformat(first) + timedelta(weeks=i)).isoformat() for i in range(4)]
    assert [o["date"] for o in sq["occurrences"]] == dates, sq
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        open_loom(page, app_url, first)
        focus_grid(page)
        extend(page, "ArrowRight", "ArrowDown")
        shows(page, cell(page, "Deck oven 2", "04:15", "selected"))
        click(page.get_by_role("button", name="Repeat weekly"))
        dialog = page.get_by_role("dialog", name="Repeat weekly")
        fill(dialog.get_by_role("spinbutton", name="Weeks"), "4")
        series_shown(page, dialog, sq)
        click(dialog.get_by_role("button", name="Book series"))
        says(page, loom_status(page), f"Booked 4 weekly slots, {dates[0]} to {dates[-1]}.")
    found = [b for d in dates for b in own_bookings(ember, d) if keys(b["cells"]) == keys(block(st, "04:00", "04:30"))]
    assert len(found) == 4 and len({b["series_id"] for b in found}) == 1 and found[0]["series_id"]
    for b in found:
        cancel(ember, b["id"])


def test_wf_recurring_slot_conflict(app_url, browser):
    ember, salt = Api(app_url, EMBER), Api(app_url, SALTLINE)
    st = ["st-deck-1", "st-deck-2"]
    first, sq = series_slot(ember, st, "04:00", "04:30", 4)
    dates = [(date.fromisoformat(first) + timedelta(weeks=i)).isoformat() for i in range(4)]
    blocker = None
    try:
        with open_app(browser, app_url + "/signin") as page:
            sign_in(page, app_url, EMBER)
            open_loom(page, app_url, first)
            focus_grid(page)
            extend(page, "ArrowRight", "ArrowDown")
            click(page.get_by_role("button", name="Repeat weekly"))
            dialog = page.get_by_role("dialog", name="Repeat weekly")
            fill(dialog.get_by_role("spinbutton", name="Weeks"), "4")
            series_shown(page, dialog, sq)
            blocker = place_hold(salt, dates[2], block(["st-deck-1"], "04:00", "04:15"))
            click(dialog.get_by_role("button", name="Book series"))
            says(page, loom_status(page), f"These weeks are already taken: {dates[2]}. Nothing was booked.")
        for d in dates:
            assert not [b for b in own_bookings(ember, d) if keys(b["cells"]) & keys(block(st, "04:00", "04:30"))]
    finally:
        if blocker:
            release(salt, blocker["id"])


def test_document_upload_limits(app_url):
    ember, op = Api(app_url, EMBER), Api(app_url, OPERATOR)
    expiry = (today_of(ember) + timedelta(days=FAR)).isoformat()
    fields = {"type": "insurance", "expires_on": expiry}
    store = S3()
    prefix = f"documents/{NSC}/mem-ember/"
    keys_before = set(store.keys(prefix))
    ok = tag("coi")
    accepted = []
    for content, name, ctype in ((PDF_BYTES, f"{ok}.pdf", "application/pdf"), (PNG_BYTES, f"{ok}-png.pdf", "image/png"),
                                 (JPEG_BYTES, f"{ok}.jpg", "image/jpeg"),
                                 (b"%PDF-" + bytes(FILE_LIMIT - len(b"%PDF-")), f"{ok}-edge.pdf", "application/pdf")):
        r = upload(ember, fields, name, content)
        assert r.status_code == 201, r.text
        doc = r.json()["document"]
        assert (doc["state"], doc["content_type"], doc["original_name"], doc["size_bytes"]) == ("uploaded", ctype, name, len(content))
        accepted.append(doc["id"])
    bad = tag("bad")
    refused(upload(ember, fields, f"{bad}.pdf", SVG_BYTES), 415, "unsupported_type")
    refused(upload(ember, fields, f"{bad}.png", HTML_BYTES), 415, "unsupported_type")
    refused(upload(ember, fields, f"{bad}-big.pdf", b"%PDF-" + bytes(FILE_LIMIT + 1 - len(b"%PDF-"))), 413, "file_too_large")
    for name in (f"dir/{bad}.pdf", f"dir\\\\{bad}.pdf", f"{bad}..pdf", f"{bad}\x07.pdf", "a" * (NAME_MAX - 3) + ".pdf"):
        assert "file" in refused(upload(ember, fields, name, PDF_BYTES), 422, "validation")["errors"], name
    assert "file" in refused(upload(ember, fields, f"{bad}-empty.pdf", b""), 422, "validation")["errors"]
    yesterday = (today_of(ember) - timedelta(days=1)).isoformat()
    assert "expires_on" in refused(upload(ember, {"type": "insurance", "expires_on": yesterday}, f"{bad}.pdf", PDF_BYTES),
                                   422, "validation")["errors"]
    assert "expires_on" in refused(upload(ember, {"type": "food_handler"}, f"{bad}.pdf", PDF_BYTES), 422, "validation")["errors"]
    refused(upload(ember, {"type": "kitchen_agreement"}, f"{bad}.pdf", PDF_BYTES), 403, "forbidden")
    refused(upload(op, {"type": "kitchen_agreement", "expires_on": expiry, "member_id": "mem-ember"}, f"{bad}.pdf", PDF_BYTES),
            422, "validation")
    assert not [d for d in documents(ember) if bad in d["original_name"]]
    assert set(store.keys(prefix)) - keys_before == {prefix + i for i in accepted}


def test_private_document_files(app_url):
    ember = Api(app_url, EMBER)
    name = f"{tag('secret')}.png"
    r = upload(ember, {"type": "food_handler", "expires_on": (today_of(ember) + timedelta(days=FAR)).isoformat()}, name, PNG_BYTES)
    assert r.status_code == 201, r.text
    doc = r.json()["document"]
    store = S3()
    key = f"documents/{NSC}/mem-ember/{doc['id']}"
    assert key in store.keys(f"documents/{NSC}/mem-ember/") and store.get(key) == PNG_BYTES
    assert not [k for k in store.keys("documents/") if name in k]
    f = ember.get(f"/api/documents/{doc['id']}/file")
    assert f.status_code == 200 and f.content == PNG_BYTES
    assert f.headers["content-type"].startswith("image/png") and f.headers["x-content-type-options"] == "nosniff"
    assert f.headers["content-disposition"] == f'attachment; filename="{name}"'
    assert Api(app_url, OPERATOR).get(f"/api/documents/{doc['id']}/file").content == PNG_BYTES
    for other in (SALTLINE, TEO):
        refused(Api(app_url, other).get(f"/api/documents/{doc['id']}/file"), 404, "not_found")
        refused(Api(app_url, other).get(f"/api/documents/{doc['id']}"), 404, "not_found")
    refused(Api(app_url, INES).get(f"/api/documents/{doc['id']}/file"), 403, "forbidden")
    seeded = ember.get(f"/api/documents/{EMBER_COI}/file")
    assert seeded.status_code == 200 and seeded.content.startswith(b"%PDF-")


def test_document_review_states(app_url):
    op, salt = Api(app_url, OPERATOR), Api(app_url, SALTLINE)
    today = today_of(op)

    def up(member: str, days: int, kind: str = "insurance") -> dict:
        r = upload(op, {"type": kind, "expires_on": (today + timedelta(days=days)).isoformat(), "member_id": member},
                   f"{tag('rev')}.pdf", PDF_BYTES)
        assert r.status_code == 201, r.text
        return r.json()["document"]

    edge, beyond = up("mem-saltline", REMINDER_DAYS), up("mem-saltline", REMINDER_DAYS + 1)
    assert salt.get(f"/api/documents/{edge['id']}").json()["document"]["state"] == "uploaded"
    refused(salt.post(f"/api/documents/{edge['id']}/verify", {}), 403, "forbidden")
    assert op.post(f"/api/documents/{edge['id']}/verify", {}).json()["document"]["state"] == "expiring"
    assert op.post(f"/api/documents/{beyond['id']}/verify", {}).json()["document"]["state"] == "verified"
    again = refused(op.post(f"/api/documents/{beyond['id']}/verify", {}), 409, "invalid_transition")
    assert "from" in again and "to" in again
    wren_path = f"/api/members/{MEM_WREN}"
    wren_cover = op.get(wren_path).json()["member"]["covered_until"]
    rej = up(MEM_WREN, FAR)
    refused(op.post(f"/api/documents/{rej['id']}/reject", {"reason": ""}), 422, "validation")
    refused(op.post(f"/api/documents/{rej['id']}/reject", {"reason": "x" * (REASON_MAX + 1)}), 422, "validation")
    assert op.get(wren_path).json()["member"]["covered_until"] == wren_cover
    done = op.post(f"/api/documents/{rej['id']}/reject", {"reason": REJECT_REASON}).json()["document"]
    assert done["state"] == "rejected" and done["reject_reason"] == REJECT_REASON
    refused(op.post(f"/api/documents/{rej['id']}/reject", {"reason": REJECT_REASON}), 409, "invalid_transition")
    refused(op.post(f"/api/documents/{rej['id']}/verify", {}), 409, "invalid_transition")
    assert op.get(wren_path).json()["member"]["covered_until"] == wren_cover
    assert op.get(f"/api/documents/{TIDE_COI}").json()["document"]["state"] == "expired"


def test_expiry_reminder(app_url, mail):
    op = Api(app_url, OPERATOR)
    today = today_of(op)
    soon_expiry = (today + timedelta(days=REMINDER_DAYS // 2)).isoformat()
    later_expiry = (today + timedelta(days=REMINDER_DAYS + 6)).isoformat()
    seen = mail_ids(mail)
    ids = []
    for kind, exp in (("food_handler", soon_expiry), ("insurance", later_expiry)):
        r = upload(op, {"type": kind, "expires_on": exp, "member_id": "mem-saltline"}, f"{tag('rem')}.pdf", PDF_BYTES)
        assert r.status_code == 201, r.text
        ids.append(r.json()["document"]["id"])
    for i in ids:
        assert op.post(f"/api/documents/{i}/verify", {}).status_code == 200
    near = f"Food-handler card for Saltline Catering expires {soon_expiry}"
    far = f"Insurance certificate for Saltline Catering expires {later_expiry}"
    await_mail(mail, seen, lambda m: m["Subject"] == near, count=2, seconds=REMINDER_SECONDS + MAIL_SLACK)
    got = settled_mail(mail, seen, lambda m: m["Subject"] in (near, far))
    assert sorted(tuple(recipients(m)) for m in got if m["Subject"] == near) == [(OPERATOR,), (SALTLINE,)]
    assert not [m for m in got if m["Subject"] == far]


def test_wf_compliance_documents_upload_verify(app_url, browser):
    op = Api(app_url, OPERATOR)
    expiry = (today_of(op) + timedelta(days=random.randint(REMINDER_DAYS + 6, FAR))).isoformat()
    name = f"{tag('tide')}.pdf"
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, TIDEWATER)
        visit(page, "Papers")
        form = page.get_by_role("form", name="Upload document")
        select(form.get_by_role("combobox", name="Document type"), "Insurance certificate")
        fill(form.get_by_label("Expiry date"), expiry)
        form.get_by_label("File").set_input_files({"name": name, "mimeType": "application/pdf", "buffer": PDF_BYTES})
        click(form.get_by_role("button", name="Upload"))
        says(page, form_status(page), "Uploaded Insurance certificate. It counts once the kitchen verifies it.")
        mine = doc_row(page, page.get_by_role("table", name="My documents"), "Insurance certificate", expiry)
        before = mine.inner_text()
    doc = next(d for d in documents(Api(app_url, TIDEWATER)) if d["original_name"] == name)
    assert (doc["type"], doc["expires_on"]) == ("insurance", expiry)
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, OPERATOR)
        visit(page, "Papers")
        target = doc_row(page, page.get_by_role("table", name="Documents to review"), "Insurance certificate", expiry,
                         business="Tidewater Granola")
        verify = page.get_by_role("button", name="Verify")
        inline = target.get_by_role("button", name="Verify")
        if inline.count():
            click(inline.first)
        else:
            opens(page, verify, [target.get_by_role("link", name=OPENER), target.get_by_role("button", name=OPENER),
                                 target.get_by_role("cell").first, target.get_by_role("link").first])
            click(verify.first)
        says(page, form_status(page), "Verified Insurance certificate for Tidewater Granola.")
    assert op.get(f"/api/documents/{doc['id']}").json()["document"]["state"] == "verified"
    assert f"documents/{NSC}/mem-tidewater/{doc['id']}" in S3().keys(f"documents/{NSC}/mem-tidewater/")
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, TIDEWATER)
        visit(page, "Papers")
        mine = doc_row(page, page.get_by_role("table", name="My documents"), "Insurance certificate", expiry)
        soon(page, lambda: truth(mine.inner_text() != before, f"the state shown is unchanged: {before!r}"))


def test_wf_compliance_documents_storage_returns(rig, browser):
    rig.ensure(billing=True, files=True, mail=True)
    ember = Api(rig.base, EMBER)
    expiry = (today_of(ember) + timedelta(days=FAR)).isoformat()
    name = f"{tag('back')}.pdf"
    with open_app(browser, rig.base + "/signin") as page:
        sign_in(page, rig.base, EMBER)
        visit(page, "Papers")
        form = page.get_by_role("form", name="Upload document")
        button = form.get_by_role("button", name="Upload")
        rig.relays["files"].close()
        banner = page.get_by_role("status", name="Service status")
        says_live(page, banner, FILES_DOWN_COPY)
        soon(page, lambda: expect(button).to_be_disabled(timeout=EXPECT_MS))
        rig.relays["files"].open()
        says_live(page, banner, "File storage is back. Paused actions are available again.")
        select(form.get_by_role("combobox", name="Document type"), "Insurance certificate")
        fill(form.get_by_label("Expiry date"), expiry)
        form.get_by_label("File").set_input_files({"name": name, "mimeType": "application/pdf", "buffer": PDF_BYTES})
        soon(page, lambda: expect(button).to_be_enabled(timeout=EXPECT_MS), step=BANNER_STEP_MS)
        click(button)
        says(page, form_status(page), "Uploaded Insurance certificate. It counts once the kitchen verifies it.")
    doc = next(d for d in documents(ember) if d["original_name"] == name)
    assert doc["state"] == "uploaded"
    store = S3()
    key = f"documents/{NSC}/mem-ember/{doc['id']}"
    assert key in store.keys(f"documents/{NSC}/mem-ember/") and store.get(key) == PDF_BYTES


def test_wf_compliance_documents_bad_type(app_url, browser):
    ember = Api(app_url, EMBER)
    name = f"{tag('fake')}.pdf"
    keys_before = set(S3().keys(f"documents/{NSC}/mem-ember/"))
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        visit(page, "Papers")
        form = page.get_by_role("form", name="Upload document")
        select(form.get_by_role("combobox", name="Document type"), "Insurance certificate")
        fill(form.get_by_label("Expiry date"), (today_of(ember) + timedelta(days=FAR)).isoformat())
        form.get_by_label("File").set_input_files({"name": name, "mimeType": "application/pdf", "buffer": HTML_BYTES})
        click(form.get_by_role("button", name="Upload"))
        says(page, form_status(page), "Upload a PDF, PNG or JPEG file.")
    assert not [d for d in documents(ember) if d["original_name"] == name]
    assert set(S3().keys(f"documents/{NSC}/mem-ember/")) == keys_before


def test_compliance_gate(app_url):
    op, ember, tide = Api(app_url, OPERATOR), Api(app_url, EMBER), Api(app_url, TIDEWATER)
    cells = block(["st-walkin"], "12:00", "12:30")
    edge = op.get(f"/api/members/{MEM_EMBER}").json()["member"]["covered_until"]
    after = (date.fromisoformat(edge) + timedelta(days=1)).isoformat()
    assert quote(ember, edge, cells)["papers"] == []
    blocked = quote(ember, after, cells)
    assert keys(blocked["papers"]) == keys(cells) and blocked["quote"]["lines"] == [] and blocked["quote"]["total_cents"] == 0
    d = uncovered_date(op, "mem-tidewater")
    q = quote(tide, d, cells)
    assert keys(q["papers"]) == keys(cells) and q["quote"]["total_cents"] == 0
    refused(tide.post("/api/holds", {"date": d, "cells": cells}), 422, "compliance_blocked")
    refused(tide.post("/api/series/quote", series_body(["st-walkin"], "12:00", "12:30", d, WEEKS_MIN)), 422, "compliance_blocked")
    refused(tide.post("/api/series", series_body(["st-walkin"], "12:00", "12:30", d, WEEKS_MIN, 0), key=idempotency_key()),
            422, "compliance_blocked")
    refused(ember.post("/api/holds", {"date": after, "cells": cells}), 422, "compliance_blocked")
    assert not any("hold_id" in c for c in loom(tide, d)["cells"])


def test_wf_compliance_gate_member_blocked(app_url, browser):
    op = Api(app_url, OPERATOR)
    d = uncovered_date(op, "mem-tidewater")
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, TIDEWATER)
        open_loom(page, app_url, d)
        shows(page, cell(page, "Deck oven 1", "04:00", "papers"))
        shows(page, cell(page, "Walk-in cooler", LAST_CELL, "papers"))
        focus_grid(page)
        extend(page, "ArrowRight")
        papers_copy = (f"Your papers do not cover {d}. Upload a current insurance certificate and "
                       "food-handler card to book this day.")
        says(page, loom_status(page), papers_copy)
        page.keyboard.press("Enter")
        answers = (papers_copy, "Nothing free to hold in that brush.")
        soon(page, lambda: truth(any(a in loom_status(page).inner_text() for a in answers),
                                 "Enter showed neither the papers nor the nothing-free copy"))
        expect(loom_status(page)).not_to_contain_text("Held")
    view = loom(Api(app_url, TIDEWATER), d)
    assert view["papers"] is True and not any("hold_id" in c for c in view["cells"])


def test_wf_compliance_gate_operator_view(app_url, browser):
    op = Api(app_url, OPERATOR)
    d = uncovered_date(op, "mem-tidewater")
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, OPERATOR)
        open_loom(page, app_url, d)
        select(page.get_by_role("combobox", name="Book for member"), "Tidewater Granola")
        shows(page, cell(page, "Deck oven 1", "04:00", "papers"))
        focus_grid(page)
        extend(page, "ArrowRight")
        says(page, loom_status(page), f"Tidewater Granola's papers do not cover {d}.")
    assert loom(op, d, member_id="mem-tidewater")["papers"] is True


def test_booking_lifecycle(app_url):
    nsc_op, salt = Api(app_url, OPERATOR), Api(app_url, SALTLINE)
    fd, fc = find_slot(salt, [block([s], "23:00", "23:30") for s in NSC_STATIONS])
    f = book(salt, fd, fc)["booking"]

    def move(op: Api, bid: str, action: str) -> httpx.Response:
        return op.post(f"/api/bookings/{bid}/{action}", {})

    def illegal(r: httpx.Response, frm: str, to: str) -> None:
        body = refused(r, 409, "invalid_transition")
        assert (body["from"], body["to"]) == (frm, to)

    try:
        refused(salt.post(f"/api/bookings/{f['id']}/check-in", {}), 403, "forbidden")
        with today_bookings(app_url, 2) as (_, op, _, made):
            (member, a, _), (_, b, _) = made
            refused(member.post(f"/api/bookings/{a['id']}/check-in", {}), 403, "forbidden")
            illegal(move(op, a["id"], "complete"), "confirmed", "completed")
            assert move(op, a["id"], "check-in").json()["booking"]["state"] == "checked_in"
            illegal(move(op, a["id"], "check-in"), "checked_in", "checked_in")
            illegal(move(op, a["id"], "no-show"), "checked_in", "no_show")
            illegal(cancel(op, a["id"]), "checked_in", "cancelled")
            assert move(op, a["id"], "complete").json()["booking"]["state"] == "completed"
            illegal(move(op, a["id"], "complete"), "completed", "completed")
            assert move(op, b["id"], "no-show").json()["booking"]["state"] == "no_show"
            illegal(move(op, b["id"], "check-in"), "no_show", "checked_in")
        refused(move(nsc_op, f["id"], "check-in"), 409, "booking_day_not_reached")
        refused(move(nsc_op, f["id"], "no-show"), 409, "booking_day_not_reached")
        illegal(move(nsc_op, f["id"], "complete"), "confirmed", "completed")
        assert nsc_op.get(f"/api/bookings/{f['id']}").json()["booking"]["state"] == "confirmed"
    finally:
        cancel(salt, f["id"])


def test_wf_operator_day_sheet(app_url, browser):
    with today_bookings(app_url, 2) as (op_email, op, d, made):
        (_, a, business), (_, b, _) = made
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, op_email)
        visit(page, "Bookings")
        fill(page.get_by_label("Date", exact=True), d)
        open_booking(page, a["ref"])
        day_action(page, a["ref"], "Check in")
        says(page, form_status(page), f"Checked in {business}.")
        day_action(page, a["ref"], "Mark completed")
        says(page, form_status(page), f"Marked {a['ref']} completed.")
        open_booking(page, b["ref"])
        day_action(page, b["ref"], "Mark no-show")
        says(page, form_status(page), f"Marked {b['ref']} as a no-show.")
        says(page, booking_row(page, a["ref"]), re.compile(r"completed", re.I))
        says(page, booking_row(page, b["ref"]), re.compile(r"no.show", re.I))
    assert op.get(f"/api/bookings/{a['id']}").json()["booking"]["state"] == "completed"
    assert op.get(f"/api/bookings/{b['id']}").json()["booking"]["state"] == "no_show"


def test_wf_operator_day_billing_down(app_url, browser):
    with today_bookings(app_url, 1) as (op_email, op, d, made):
        (_, a, business), = made
    kb = outage("APP_KILLBILL_DOWN_URL", "billing")
    with open_app(browser, kb + "/signin") as page:
        sign_in(page, kb, op_email)
        says(page, page.get_by_role("status", name="Service status"), BILLING_DOWN_COPY)
        visit(page, "Bookings")
        fill(page.get_by_label("Date", exact=True), d)
        open_booking(page, a["ref"])
        day_action(page, a["ref"], "Check in")
        says(page, form_status(page), f"Checked in {business}.")
    assert op.get(f"/api/bookings/{a['id']}").json()["booking"]["state"] == "checked_in"


def test_wf_operator_day_too_early(app_url, browser):
    op, salt = Api(app_url, OPERATOR), Api(app_url, SALTLINE)
    d, cells = find_slot(salt, [block([s], "23:30", "24:00") for s in NSC_STATIONS])
    f = book(salt, d, cells)["booking"]
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, OPERATOR)
        visit(page, "Bookings")
        fill(page.get_by_label("Date", exact=True), d)
        open_booking(page, f["ref"])
        expect(page.get_by_role("button", name="Check in")).to_have_count(0)
        expect(page.get_by_role("button", name="Mark no-show")).to_have_count(0)
    refused(op.post(f"/api/bookings/{f['id']}/check-in", {}), 409, "booking_day_not_reached")
    assert op.get(f"/api/bookings/{f['id']}").json()["booking"]["state"] == "confirmed"
    cancel(salt, f["id"])


def test_own_records_only(app_url):
    ember, salt, teo = Api(app_url, EMBER), Api(app_url, SALTLINE), Api(app_url, TEO)
    d, cells = find_slot(salt, [block([s], "06:00", "06:30") for s in NSC_STATIONS])
    out = book(salt, d, cells)
    d2, c2 = find_slot(salt, [block([s], "06:30", "07:00") for s in NSC_STATIONS])
    h = place_hold(salt, d2, c2)
    try:
        sb, inv = out["booking"], out["invoice"]
        for path in (f"/api/bookings/{sb['id']}", f"/api/holds/{h['id']}", f"/api/invoices/{inv['id']}",
                     f"/api/documents/{SALTLINE_COI}", f"/api/documents/{SALTLINE_COI}/file",
                     f"/api/members/{MEM_SALTLINE}/pack", f"/api/members/{MEM_SALTLINE}"):
            refused(ember.get(path), 404, "not_found")
        refused(ember.delete(f"/api/holds/{h['id']}"), 404, "not_found")
        refused(cancel(ember, sb["id"]), 404, "not_found")
        assert salt.get(f"/api/holds/{h['id']}").json()["hold"]["state"] == "held"
        assert salt.get(f"/api/bookings/{sb['id']}").json()["booking"]["state"] == "confirmed"
        for path, field in (("/api/bookings", "bookings"), ("/api/invoices", "invoices"), ("/api/documents", "documents")):
            assert all(x["member_id"] == "mem-ember" for x in ember.get(path).json()[field])
        refused(teo.get(f"/api/bookings/{sb['id']}"), 404, "not_found")
        refused(teo.get(f"/api/members/{MEM_EMBER}/pack"), 404, "not_found")
    finally:
        release(salt, h["id"])
        cancel(salt, out["booking"]["id"])


def test_anonymous_occupancy(app_url):
    ember, salt, op = Api(app_url, EMBER), Api(app_url, SALTLINE), Api(app_url, OPERATOR)
    d, cells = find_slot(ember, [block(["st-kettle"], "07:00", "08:00")])
    out = book(salt, d, block(["st-kettle"], "07:00", "07:30"))
    h = place_hold(salt, d, block(["st-kettle"], "07:30", "08:00"))
    secrets_ = [out["booking"]["id"], out["booking"]["ref"], h["id"], "mem-saltline", "Saltline Catering",
                out["invoice"]["id"]]
    try:
        r = ember.get(f"/api/kitchens/{NSC}/loom", date=d)
        theirs = [c for c in r.json()["cells"] if (c["station_id"], c["start"]) in keys(cells)]
        assert len(theirs) == len(cells) and all(set(c) == {"station_id", "start", "state"} and c["state"] == "taken" for c in theirs)
        q = ember.post("/api/quotes", {"date": d, "cells": cells, "use_pack": False})
        assert keys(q.json()["taken"]) == keys(cells)
        e = ember.post("/api/holds", {"date": d, "cells": cells})
        refused(e, 409, "cells_taken")
        for resp in (r, q, e):
            assert not leaked(resp, secrets_), resp.text
        owners = {c.get("business") for c in loom(op, d)["cells"] if (c["station_id"], c["start"]) in keys(cells)}
        assert owners == {"Saltline Catering"}
    finally:
        release(salt, h["id"])
        cancel(salt, out["booking"]["id"])


def test_wf_member_records_anonymous_loom(app_url, browser):
    salt = Api(app_url, SALTLINE)
    d, cells = find_slot(Api(app_url, EMBER), [block(["st-deck-1"], "04:00", "05:00")])
    out = book(salt, d, cells)
    try:
        with open_app(browser, app_url + "/signin") as page:
            sign_in(page, app_url, EMBER)
            open_loom(page, app_url, d)
            shows(page, cell(page, "Deck oven 1", "04:30", "taken"))
            html = page.content()
            for s in (out["booking"]["id"], out["booking"]["ref"], "mem-saltline", "Saltline Catering", out["booking"]["total"]):
                assert len(str(s)) < ID_MIN or str(s) not in html, s
    finally:
        cancel(salt, out["booking"]["id"])


def test_invoices_match_billing(app_url):
    ember = Api(app_url, EMBER)
    d, cells = find_slot(ember, [block([s], "07:00", "07:30") for s in NSC_STATIONS])
    out = book(ember, d, cells)
    b = out["booking"]
    inv = ember.get(f"/api/invoices/{b['invoice_id']}").json()["invoice"]
    assert shape([l for l in inv["lines"] if "station_id" in l]) == shape(b["lines"])
    assert inv["total_cents"] == b["total_cents"] and inv["killbill_invoice_id"]
    assert inv["billing_amount_cents"] == inv["total_cents"]
    down = Api(outage("APP_KILLBILL_DOWN_URL", "billing"), EMBER)
    blind = down.get(f"/api/invoices/{inv['id']}").json()["invoice"]
    assert blind["killbill_invoice_id"] == inv["killbill_invoice_id"] and blind["billing_amount_cents"] is None
    cancel(ember, b["id"])


def test_wf_member_records_booking_invoice(app_url, browser):
    ember = Api(app_url, EMBER)
    d, cells = find_slot(ember, [block(["st-convection", "st-range"], "07:30", "08:30")])
    out = book(ember, d, cells)
    b, inv = out["booking"], out["invoice"]
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, EMBER)
        visit(page, "Bookings")
        region = open_booking(page, b["ref"])
        says(page, region, b["total"])
        click(page.get_by_role("link", name=f"Invoice {inv['ref']}").first)
        detail = page.get_by_role("region", name=f"Invoice {inv['ref']}")
        shows(page, detail)
        says(page, detail, b["total"])
        for name in ("Convection oven", "Six-burner range"):
            says(page, detail, name)
    api_inv = ember.get(f"/api/invoices/{inv['id']}").json()["invoice"]
    assert shape([l for l in api_inv["lines"] if "station_id" in l]) == shape(b["lines"])
    assert api_inv["total_cents"] == b["total_cents"]
    cancel(ember, b["id"])


def report_csv(api: Api, kid: str, month: str) -> httpx.Response:
    return api.get(f"/api/kitchens/{kid}/reports/usage.csv", month=month)


def test_usage_report_one_kitchen(app_url):
    ember, ines, op, teo = Api(app_url, EMBER), Api(app_url, INES), Api(app_url, OPERATOR), Api(app_url, TEO)
    out = book_this_month(op, ember, [block([s], "08:30", "09:30") for s in NSC_STATIONS])
    b, inv = out["booking"], out["invoice"]
    month, inv_month = b["date"][:7], issued_month(inv)
    r = ines.get(f"/api/kitchens/{NSC}/reports/usage", month=month)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["kitchen"]["id"] == NSC and rep["month"] == month
    issued = ines.get(f"/api/kitchens/{NSC}/reports/usage", month=inv_month)
    assert issued.status_code == 200, issued.text
    row = next(i for i in issued.json()["invoices"] if i["invoice_id"] == inv["id"])
    assert (row["killbill_invoice_id"], row["total_cents"], row["business"]) == (inv["killbill_invoice_id"], inv["total_cents"], "Ember & Rye Bakery")
    assert {m["business"] for m in rep["members"]} <= set(NSC_BUSINESSES)
    assert {s["station_id"] for s in rep["stations"]} <= set(NSC_STATIONS)
    ember_rows = [m for m in rep["members"] if m["member_id"] == "mem-ember"]
    assert len(ember_rows) == 1, rep["members"]
    assert ember_rows[0]["pack_balance_hours"] == pack(ember, "mem-ember")["balance_hours"]
    for word in ("Copper Pot Jams", LARK_NAME, "mem-copper"):
        assert word not in r.text
    c = report_csv(ines, NSC, inv_month)
    assert c.status_code == 200 and c.headers["content-type"].startswith("text/csv")
    assert c.headers["content-disposition"] == f'attachment; filename="pilotlight-usage-{NSC}-{inv_month}.csv"'
    assert c.text.splitlines()[0] == CSV_HEADER
    rows = [x for x in csv.DictReader(io.StringIO(c.text)) if x["invoice_ref"] == inv["ref"]]
    assert len(rows) == len(inv["lines"]) and all(x["booking_ref"] == b["ref"] for x in rows)
    assert sum(to_cents(x["amount"]) for x in rows) == inv["total_cents"]
    assert "Copper Pot Jams" not in c.text and LARK_NAME not in c.text
    refused(ines.get(f"/api/kitchens/{LARK}/reports/usage", month=month), 404, "not_found")
    refused(op.get(f"/api/kitchens/{LARK}/reports/usage", month=month), 404, "not_found")
    refused(teo.get(f"/api/kitchens/{NSC}/reports/usage", month=month), 404, "not_found")
    refused(report_csv(teo, NSC, month), 404, "not_found")
    refused(ember.get(f"/api/kitchens/{NSC}/reports/usage", month=month), 403, "forbidden")
    refused(ines.get(f"/api/kitchens/{NSC}/reports/usage", month="2026-13"), 422, "validation")
    lark = teo.get(f"/api/kitchens/{LARK}/reports/usage", month=month)
    assert lark.status_code == 200 and not [n for n in NSC_BUSINESSES if n in lark.text]
    cancel(ember, b["id"])


def test_wf_bookkeeper_report_reconcile(app_url, browser):
    ember, ines = Api(app_url, EMBER), Api(app_url, INES)
    out = book_this_month(Api(app_url, OPERATOR), ember, [block([s], "09:30", "10:00") for s in NSC_STATIONS])
    inv = out["invoice"]
    month = issued_month(inv)
    with open_app(browser, app_url + "/signin") as page:
        sign_in(page, app_url, INES)
        shows(page, page.get_by_label("Month"))
        load_report(page, month)
        invoices = page.get_by_role("table", name="Invoices")
        row = invoices.get_by_role("row").filter(has_text=inv["ref"])
        says(page, row, inv["killbill_invoice_id"])
        shows(page, page.get_by_role("table", name="Usage by member"))
        shows(page, page.get_by_role("table", name="Station occupancy"))
        with page.expect_download() as dl:
            click(page.get_by_role("link", name="Download CSV"))
        content = Path(dl.value.path()).read_text()
    assert content.splitlines()[0] == CSV_HEADER
    rows = [x for x in csv.DictReader(io.StringIO(content)) if x["invoice_ref"] == inv["ref"]]
    assert sum(to_cents(x["amount"]) for x in rows) == inv["total_cents"]
    api_row = next(i for i in ines.get(f"/api/kitchens/{NSC}/reports/usage", month=month).json()["invoices"]
                   if i["invoice_id"] == inv["id"])
    assert api_row["killbill_invoice_id"] == inv["killbill_invoice_id"]
    cancel(ember, out["booking"]["id"])


def test_wf_bookkeeper_report_other_kitchen(app_url, browser):
    ines, ember = Api(app_url, INES), Api(app_url, EMBER)
    out = book_this_month(Api(app_url, OPERATOR), ember, [block([s], "10:00", "10:30") for s in NSC_STATIONS])
    month = out["booking"]["date"][:7]
    try:
        with open_app(browser, app_url + "/signin") as page:
            sign_in(page, app_url, INES)
            load_report(page, month)
            shows(page, page.get_by_role("table", name="Usage by member"))
            html = page.content()
            for word in (LARK_NAME, "Copper Pot Jams"):
                assert word not in html
        refused(ines.get(f"/api/kitchens/{LARK}/reports/usage", month=month), 404, "not_found")
    finally:
        cancel(ember, out["booking"]["id"])


def test_boot_with_service_down(app_url):
    kb = outage("APP_KILLBILL_DOWN_URL", "billing")
    assert httpx.get(kb + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert set(status(kb)["paused"]) == BILLING_PAUSED
    ember, main = Api(kb, EMBER), Api(app_url, EMBER)
    d, cells = find_slot(main, [block([s], "10:00", "10:30") for s in NSC_STATIONS])
    q = quote(ember, d, cells)["quote"]
    h = place_hold(ember, d, cells)
    refused(confirm(ember, h["id"], q["total_cents"]), 503, "billing_unavailable")
    before = pack(ember, "mem-ember")["balance_quarters"]
    refused(buy_pack(ember, "mem-ember"), 503, "billing_unavailable")
    assert pack(ember, "mem-ember")["balance_quarters"] == before
    first, sq = series_slot(main, ["st-prep-a"], "18:00", "18:30", WEEKS_MIN)
    refused(ember.post("/api/series", series_body(["st-prep-a"], "18:00", "18:30", first, WEEKS_MIN, sq["total_cents"]),
                       key=idempotency_key()), 503, "billing_unavailable")
    assert not [b for b in own_bookings(main, first) if keys(b["cells"]) & keys(block(["st-prep-a"], "18:00", "18:30"))]
    d2, c2 = find_slot(main, [block([s], "10:30", "11:00") for s in NSC_STATIONS])
    live = book(main, d2, c2)["booking"]
    refused(cancel(ember, live["id"]), 503, "billing_unavailable")
    assert main.get(f"/api/bookings/{live['id']}").json()["booking"]["state"] == "confirmed"
    cancel(main, live["id"])
    ok = upload(ember, {"type": "insurance", "expires_on": (today_of(main) + timedelta(days=FAR)).isoformat()},
                f"{tag('up')}.pdf", PDF_BYTES)
    assert ok.status_code == 201, ok.text

    s3 = outage("APP_MINIO_DOWN_URL", "files")
    assert httpx.get(s3 + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert set(status(s3)["paused"]) == FILES_PAUSED
    e3 = Api(s3, EMBER)
    name = f"{tag('down')}.pdf"
    refused(upload(e3, {"type": "insurance", "expires_on": (today_of(main) + timedelta(days=FAR)).isoformat()}, name, PDF_BYTES),
            503, "files_unavailable")
    assert not [x for x in documents(main) if x["original_name"] == name]
    refused(e3.get(f"/api/documents/{EMBER_COI}/file"), 503, "files_unavailable")
    assert e3.get(f"/api/documents/{EMBER_COI}").status_code == 200
    d3, c3 = find_slot(main, [block([s], "11:30", "12:00") for s in NSC_STATIONS])
    b3 = book(e3, d3, c3)["booking"]
    cancel(main, b3["id"])


def test_recover_without_restart(rig):
    rig.ensure(billing=True, files=True, mail=True)
    ember = Api(rig.base, EMBER)
    mid = ember.member_id
    rig.relays["billing"].close()
    poll(lambda: status(rig.base)["services"]["billing"] == "down", STATUS_SECONDS + POLL_SECONDS, "billing down")
    assert BILLING_PAUSED <= set(status(rig.base)["paused"])
    before = pack(ember, mid)["balance_quarters"]
    refused(buy_pack(ember, mid), 503, "billing_unavailable")
    rig.relays["billing"].open()

    def bought() -> Any:
        r = buy_pack(ember, mid)
        if r.status_code == 503:
            return None
        assert r.status_code == 201, r.text
        return r.json()

    poll(bought, RECOVERY_SECONDS, "pack purchase after billing returns")
    assert pack(ember, mid)["balance_quarters"] == before + PACK_QUARTERS
    poll(lambda: status(rig.base)["services"]["billing"] == "up", RECOVERY_SECONDS, "billing up")

    rig.relays["files"].close()
    poll(lambda: status(rig.base)["services"]["files"] == "down", STATUS_SECONDS + POLL_SECONDS, "files down")
    fields = {"type": "insurance", "expires_on": (today_of(ember) + timedelta(days=FAR)).isoformat()}
    refused(upload(ember, fields, f"{tag('rec')}.pdf", PDF_BYTES), 503, "files_unavailable")
    rig.relays["files"].open()

    def uploaded() -> Any:
        r = upload(ember, fields, f"{tag('rec')}.pdf", PDF_BYTES)
        if r.status_code == 503:
            return None
        assert r.status_code == 201, r.text
        return r.json()["document"]

    doc = poll(uploaded, RECOVERY_SECONDS, "upload after storage returns")
    assert ember.get(f"/api/documents/{doc['id']}/file").content == PDF_BYTES


def test_wf_outage_recovery_billing_banner(app_url, browser):
    kb = outage("APP_KILLBILL_DOWN_URL", "billing")
    before = pack(Api(app_url, EMBER), "mem-ember")["balance_quarters"]
    with open_app(browser, kb + "/signin") as page:
        sign_in(page, kb, EMBER)
        says(page, page.get_by_role("status", name="Service status"), BILLING_DOWN_COPY)
        visit(page, "Billing")
        soon(page, lambda: expect(page.get_by_role("button", name="Buy 20-hour pack")).to_be_disabled(timeout=EXPECT_MS))
    assert BILLING_PAUSED <= set(status(kb)["paused"])
    assert pack(Api(app_url, EMBER), "mem-ember")["balance_quarters"] == before


def test_wf_outage_recovery_files_banner(app_url, browser):
    s3 = outage("APP_MINIO_DOWN_URL", "files")
    before = {d["id"] for d in documents(Api(app_url, EMBER))}
    keys_before = set(S3().keys(f"documents/{NSC}/mem-ember/"))
    with open_app(browser, s3 + "/signin") as page:
        sign_in(page, s3, EMBER)
        says(page, page.get_by_role("status", name="Service status"), FILES_DOWN_COPY)
        visit(page, "Papers")
        soon(page, lambda: expect(page.get_by_role("button", name="Upload")).to_be_disabled(timeout=EXPECT_MS))
    assert FILES_PAUSED <= set(status(s3)["paused"])
    assert {d["id"] for d in documents(Api(app_url, EMBER))} == before
    assert set(S3().keys(f"documents/{NSC}/mem-ember/")) == keys_before


def test_wf_outage_recovery_banner_returns(rig, browser):
    rig.ensure(billing=True, files=True, mail=True)
    ember = Api(rig.base, EMBER)
    before = pack(ember, "mem-ember")["balance_quarters"]
    with open_app(browser, rig.base + "/signin") as page:
        sign_in(page, rig.base, EMBER)
        visit(page, "Billing")
        rig.relays["billing"].close()
        banner = page.get_by_role("status", name="Service status")
        says_live(page, banner, BILLING_DOWN_COPY)
        buy = page.get_by_role("button", name="Buy 20-hour pack")
        soon(page, lambda: expect(buy).to_be_disabled(timeout=EXPECT_MS))
        rig.relays["billing"].open()
        says_live(page, banner, "Billing is back. Paused actions are available again.")
        soon(page, lambda: expect(buy).to_be_enabled(timeout=EXPECT_MS))
        click(buy)
        says(page, form_status(page), f"20-hour pack added. Balance {hours_text(before + PACK_QUARTERS)} hours.")
    assert pack(ember, "mem-ember")["balance_quarters"] == before + PACK_QUARTERS


def npm_tree(long: bool = False) -> dict[str, dict]:
    args = ["npm", "ls", "--omit=dev", "--all", "--json"] + (["--long"] if long else [])
    out = subprocess.run(args, cwd=DEPLOYED_APP, capture_output=True, text=True, timeout=NPM_SECONDS)
    tree = json.loads(out.stdout or "{}")
    found: dict[str, dict] = {}

    def walk(deps: dict | None) -> None:
        for name, info in (deps or {}).items():
            if info.get("missing") or info.get("peerMissing") or not info.get("version"):
                continue
            if name not in found:
                found[name] = info
                walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return found


def test_if_run_manifest():
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for step in ("install", "build", "serve"):
        assert isinstance(manifest[step], str) and manifest[step].strip()


def test_if_third_party_notices():
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    shipped = npm_tree()
    assert [n for n in shipped if n not in notices] == []
    assert [f for f in TYPEFACES if f not in notices] == []


def licence_key(name: str) -> str:
    words = re.sub(r"\b(the|licen[cs]e[sd]?|version)\b|\bv(?=\d)", " ", name.lower().replace("_", " "))
    return re.sub(r"[^a-z0-9.]+", "", re.sub(r"\.0\b", "", words))


ALLOWED = {licence_key(n) for n in LICENCES}


def licence_ok(expression: str) -> bool:
    parts = re.split(r"(\(|\)|/|\s+or\s+|\s+and\s+)", f" {expression.strip()} ", flags=re.I)
    tokens = [t.strip() for t in parts if t.strip()]
    at = 0

    def alternative() -> bool:
        nonlocal at
        ok = conjunction()
        while at < len(tokens) and tokens[at].lower() in ("or", "/"):
            at += 1
            ok = conjunction() or ok
        return ok

    def conjunction() -> bool:
        nonlocal at
        ok = term()
        while at < len(tokens) and tokens[at].lower() == "and":
            at += 1
            ok = term() and ok
        return ok

    def term() -> bool:
        nonlocal at
        if at >= len(tokens):
            return False
        token = tokens[at]
        at += 1
        if token == "(":
            ok = alternative()
            at += 1 if at < len(tokens) and tokens[at] == ")" else 0
            return ok
        return licence_key(re.split(r"\s+with\s+", token, flags=re.I)[0]) in ALLOWED

    return bool(tokens) and alternative() and at == len(tokens)


def test_if_licences_allowed():
    bad = []
    for name, info in npm_tree(long=True).items():
        if info.get("private") or str(info.get("resolved", "")).startswith(("file:", "link:", "workspace:")):
            continue
        lic = info.get("license") or info.get("licenses")
        if not lic:
            manifest = Path(info.get("path") or Path(DEPLOYED_APP) / DEPENDENCY_DIR / name) / "package.json"
            with contextlib.suppress(OSError, ValueError):
                meta = json.loads(manifest.read_text())
                lic = meta.get("license") or meta.get("licenses")
        lic = lic if isinstance(lic, list) else [lic]
        lic = " OR ".join(str(x.get("type") if isinstance(x, dict) else x) for x in lic if x)
        if not licence_ok(str(lic or "")):
            bad.append(f"{name}: {lic}")
    assert bad == []


def quoted_table(name: str) -> str:
    return ".".join('"' + part.replace('"', '""') + '"' for part in name.split("."))


def app_roots() -> list[Path]:
    roots = [APP_ROOT, Path(DEPLOYED_APP)]
    return [r for i, r in enumerate(roots) if r.resolve() not in {x.resolve() for x in roots[:i]}]


def test_if_postgres_only(app_url):
    files = [p for p in APP_ROOT.rglob("*") if DEPENDENCY_DIR not in p.parts and ".git" not in p.parts
             and p.suffix.lower() in (".sqlite", ".sqlite3", ".db")]
    assert files == []
    ember = Api(app_url, EMBER)
    name = f"{tag('pgonly')}.pdf"
    r = upload(ember, {"type": "insurance", "expires_on": (today_of(ember) + timedelta(days=FAR)).isoformat()}, name, PDF_BYTES)
    assert r.status_code == 201, r.text
    pg = Postgres()
    holders = [t for t in pg.tables()
               if pg.rows(f"SELECT count(*) AS n FROM {quoted_table(t)} t WHERE t::text LIKE '%{name}%'")[0]["n"]]
    assert holders, "the new document record is not in PostgreSQL"
    stray = [str(p) for root in app_roots() for p in root.rglob("*")
             if p.is_file() and p.suffix.lower() in STORE_SUFFIXES and DEPENDENCY_DIR not in p.parts
             and name.encode() in p.read_bytes()]
    assert stray == []


def test_if_service_config_untouched():
    trajectory = json.loads(TRAJECTORY.read_text()) if TRAJECTORY.exists() else []
    written: list[str] = []

    def walk(node: Any, tool: str = "") -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or tool)
            for k, v in node.items():
                if k in ("file_path", "path") and isinstance(v, str) and re.search(r"write|edit", name, re.I):
                    written.append(v)
                walk(v, name)
        elif isinstance(node, list):
            for item in node:
                walk(item, tool)

    walk(trajectory)
    scratch = ("/app/", "/tmp/", "/var/tmp/")
    absolute = [os.path.normpath(p) for p in written if p.startswith("/")]
    touched = [p for p in absolute if not (p + "/").startswith(scratch)
               and (SERVICE_CONFIG.search(p) or COMPOSE_FILE.match(os.path.basename(p)))]
    assert touched == []


def strip_comments(raw: str) -> str:
    out: list[str] = []
    i, quoted = 0, False
    while i < len(raw):
        ch, nxt = raw[i], raw[i + 1:i + 2]
        if quoted:
            out.append(ch)
            if ch == "\\":
                out.append(nxt)
                i += 2
                continue
            if ch == '"':
                quoted = False
            i += 1
            continue
        if ch == '"':
            quoted = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and nxt == "/":
            end = raw.find("\n", i)
            i = len(raw) if end < 0 else end
            continue
        if ch == "/" and nxt == "*":
            end = raw.find("*" + "/", i + 2)
            i = len(raw) if end < 0 else end + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def tsconfig(path: Path) -> dict:
    raw = strip_comments(path.read_text())
    raw = re.sub(r",(\s*[}\]])", r"\1", raw)
    data = json.loads(raw)
    ext = data.get("extends")
    merged: dict = {}
    for name in ([ext] if isinstance(ext, str) else ext if isinstance(ext, list) else []):
        bases = [path.parent / name] if name.startswith(".") else [r / DEPENDENCY_DIR / name for r in app_roots()]
        for base in bases:
            if base.is_dir():
                base = base / "tsconfig.json"
            if base.suffix != ".json":
                base = base.with_suffix(".json")
            if base.exists():
                merged.update(tsconfig(base).get("compilerOptions", {}))
                break
    data["compilerOptions"] = {**merged, **data.get("compilerOptions", {})}
    return data


def shown_config(tsc: Path, cfg: Path) -> dict | None:
    if not tsc.exists():
        return None
    out = subprocess.run([str(tsc), "-p", str(cfg), "--showConfig"], cwd=cfg.parent,
                         capture_output=True, text=True, timeout=NPM_SECONDS)
    try:
        return json.loads(out.stdout) if out.returncode == 0 else None
    except json.JSONDecodeError:
        return None


def solution_style(data: dict) -> bool:
    return bool(data.get("references")) and data.get("files") == [] and not data.get("include")


def strict_on(options: dict) -> bool:
    return options.get("strict") is True or all(options.get(flag) is True for flag in STRICT_FLAGS)


def strict_config(cfg: Path, tsc: Path) -> bool:
    data = tsconfig(cfg)
    if solution_style(data):
        return True
    shown = shown_config(tsc, cfg)
    return strict_on(data["compilerOptions"]) or bool(shown and strict_on(shown.get("compilerOptions", {})))


def project_configs(root: Path) -> list[Path]:
    return [p for p in root.rglob("tsconfig*.json") if DEPENDENCY_DIR not in p.parts]


def out_dirs(root: Path) -> set[Path]:
    found = set()
    for cfg in project_configs(root):
        with contextlib.suppress(ValueError, OSError):
            out = tsconfig(cfg)["compilerOptions"].get("outDir")
            target = (cfg.parent / out).resolve() if isinstance(out, str) and out.strip() else None
            if target and not cfg.parent.resolve().is_relative_to(target):
                found.add(target)
    return found


def compiled(p: Path) -> bool:
    if Path(str(p) + ".map").exists():
        return True
    with contextlib.suppress(OSError):
        raw = p.read_bytes()
        return any(mark.encode() in raw[:400] + raw[-400:] for mark in COMPILED_MARKS)
    return False


def excluded(p: Path, configs: list[Path]) -> bool:
    for cfg in configs:
        with contextlib.suppress(ValueError, OSError):
            rel = p.resolve().relative_to(cfg.parent.resolve()).as_posix()
            for pattern in tsconfig(cfg).get("exclude") or []:
                pattern = str(pattern).lstrip("./").rstrip("/")
                if pattern and (fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(rel, pattern + "/*")
                                or rel.startswith(pattern + "/")):
                    return True
    return False


def authored(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    skip = {DEPENDENCY_DIR, ".git", *BUILD_DIRS, *TEST_DIRS}
    outs = out_dirs(root)

    def generated(p: Path) -> bool:
        parts = p.relative_to(root).parts[:-1]
        if set(parts) & skip or any(d.startswith(BUILD_PREFIXES) for d in parts):
            return True
        return any(p.resolve().is_relative_to(o) for o in outs) or (p.name.endswith(JS_SUFFIXES) and compiled(p))

    return [p for p in root.rglob("*") if p.is_file() and p.name.endswith(suffixes) and not generated(p)
            and ".config." not in p.name and not TEST_FILE.search(p.name)
            and not p.name.startswith(".") and not re.search(r"rc\.[cm]?js$", p.name)]


def test_if_strict_typescript():
    deployed = Path(DEPLOYED_APP)
    tsc = deployed / DEPENDENCY_DIR / ".bin" / "tsc"
    configs = project_configs(APP_ROOT)
    if not configs:
        scripts = (APP_ROOT / "run.json").read_text() + ((APP_ROOT / "package.json").read_text()
                                                        if (APP_ROOT / "package.json").exists() else "")
        assert "--strict" in scripts, "no tsconfig and no strict compiler flag"
    assert [str(p) for p in configs if not strict_config(p, tsc)] == []
    assert [str(p) for p in authored(APP_ROOT, JS_SUFFIXES)] == []
    sources = [p for p in authored(deployed, TS_SUFFIXES) if not p.name.endswith(".d.ts")]
    assert sources
    deployed_configs = project_configs(deployed)
    assert [str(p) for p in deployed_configs if not strict_config(p, tsc)] == []
    if not tsc.exists() or not deployed_configs:
        return
    covered: set[Path] = set()
    for cfg in deployed_configs:
        out = subprocess.run([str(tsc), "-p", str(cfg), "--listFilesOnly"], cwd=cfg.parent,
                             capture_output=True, text=True, timeout=NPM_SECONDS)
        for line in out.stdout.splitlines():
            listed = Path(line.strip())
            if listed.is_absolute():
                covered.add(listed.resolve())
    assert [str(p) for p in sources if p.resolve() not in covered and not excluded(p, deployed_configs)] == []
