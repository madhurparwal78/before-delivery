from __future__ import annotations

import concurrent.futures
import json
import os
import random
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
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Locator, Page

from conftest import (
    DEPLOYED_APP,
    Postgres,
    addresses,
    advance,
    capture,
    center,
    check,
    click,
    decode,
    difference,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    motion,
    open_app,
    post_json,
    same_origin,
    select,
    session,
    shipped_packages,
    style,
    tab_order,
    text,
    unique,
)


AMS = ZoneInfo("Europe/Amsterdam")
APP_SOURCE = Path("/") / "app"
FITTER_EMAIL = "fitter@ommezwaai.example"
FITTER_PASSWORD = "Werkbank-2026!"
RIDER_PASSWORD = "Feeler-2026!"
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
STAGES = ["deposit", "instalment-1", "instalment-2", "instalment-3"]
PLAN = {"name": "Probe Rider", "street": "Kade 1", "postcode": "1011AB", "city": "Amsterdam"}
HTTP_TIMEOUT = 30
POLL_S = 45
POLL_PACE_S = 0.1
pace = threading.Event()
BANNER_S = 10
SLACK_S = 8
HOLD_LIMIT_S = 1
SLOW_LOOKUP_S = 2
SHORT_SESSION_WAIT_S = 40
FLIGHT_MS = 680
PANEL_MS = 320
HOVER_MS = 160
TIMING_TOLERANCE = 0.25
SPRING_MS = 500
FAST_CLOCK_RATE = "86400"
DEAD_ORIGIN = "http://127.0.0.1:9"
SECRET_MIN = 32
MINIMUM = "3.0"
TYPED_CITY = "Utrecht"
TYPED_NOTE = "Ring the bell"
SAVED_CITY = "Delft"
DRAFT_CITY = "Tiel"
SESSION_CITY = "Haarlem"
SESSION_NOTE = "Mornings only"
RESIZE_CITY = "Leiden"
BODY_LIMIT = 65536
HANDLE_TOLERANCE_PX = 4
ORBIT_MIN_PX = 5
FOUL_SQUARE = 40
FOUL_MIN_PIXELS = 12
FOUL_LEVELS = 12
FADE_MIN = 0.05
STORY_DIFF_MIN = 0.02
STORY_MATCH_MIN = 0.99
STORY_LEVELS = 8
PANELS_FOR_PACK = ["Seat", "Left side panel", "Right side panel", "Footboard"]
STORY_PARTS = {
    "front-panel": (1, 0, 1, 220), "leg-shield": (1, 0, 1, 160), "seat": (1, 2, 1, 240),
    "side-panel-left": (1, 1, 1, 200), "side-panel-right": (1, 1, -1, 200), "footboard": (2, 2, -1, 180),
    "fuel-tank": (3, 2, 1, 260), "engine-exhaust": (3, 1, 1, 300), "hub-motor": (4, 1, 1, 180),
    "traction-pack": (5, 0, -1, 210), "controller": (6, 2, 1, 140),
}
STORY_CAPTIONS = ["Body panels off", "Footboard out", "Petrol out", "Hub on its axle line", "Pack on its rail",
                  "Controller and harness"]
PART_NAMES = ["Front panel", "Leg shield", "Seat", "Left side panel", "Right side panel", "Footboard", "Fuel tank",
              "Engine and exhaust", "Hub motor", "Traction pack", "Controller", "Frame", "Front fork", "Front wheel",
              "Rear wheel", "Swingarm"]
INSURANCE = "Insurance: the scooter is uninsured on public roads once the work has begun, until it passes inspection."
CLASS_NOTICES = ["Plate: a new plate is needed for the new class.", "Helmet: a helmet is required in the 45 km/h class.",
                 "Licence: check the licence your class requires before riding."]
KB_BANNER = "Payments are paused. Nothing has been charged."
REGISTRY_BANNER = "Plate registry unreachable. Your fit stays unconfirmed until it answers."
NOT_FOUND = "We couldn't find that page."
PLAN_STALE = "This plan changed elsewhere. Your entries are kept; reload to see the latest."
LICENCES = {"MIT", "ISC", "Apache-2.0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "OFL-1.1"}
REGISTRY_ROWS = [
    ("FGH-12-K", "NL", "K50", 2019, 25, "blue"), ("DBR-45-T", "NL", "K50", 2021, 45, "yellow"),
    ("GHJ-77-M", "NL", "D50", 2020, 45, "yellow"), ("A-KLM-204", "BE", "P50", 2018, 25, "white"),
    ("B-NOP-318", "BE", "P50", 2020, 45, "white"), ("418-RTV", "DE", "R50", 2017, 25, "white"),
    ("725-XKM", "DE", "R50", 2022, 45, "white"), ("LMN-31-K", "NL", "K50", 2019, 25, "blue"),
    ("PQR-58-S", "NL", "K50", 2019, 25, "blue"),
]


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def poll(fn: Callable[[], Any], message: str, seconds: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
        pace.wait(POLL_PACE_S)
    pytest.fail(f"{message} (not within {seconds}s; last={last!r})")


def settled(page: Page, fn: Callable[[], Any], message: str, seconds: float = POLL_S, step: int = 250) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        advance(page, step)
        last = fn()
        if last:
            return last
    pytest.fail(f"{message} (not within {seconds}s; last={last!r})")


def stays(page: Page, fn: Callable[[], Any], message: str, seconds: float, step: int = 250) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        advance(page, step)
        assert fn(), message


def has_param(url: str, name: str, value: str) -> bool:
    return parse_qs(urlparse(url).query).get(name) == [value]


def norm(value: str | None) -> str:
    return " ".join((value or "").split())


def read(locator: Locator) -> str:
    return norm(locator.first.text_content(timeout=2000)) if locator.count() else ""


def attr(locator: Locator, name: str) -> str | None:
    return locator.first.get_attribute(name, timeout=2000) if locator.count() else None


def has_focus(locator: Locator) -> bool:
    return locator.count() > 0 and locator.first.evaluate("e => e.contains(document.activeElement)")


def tab_to(page: Page, locator: Locator, presses: int = 80) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        advance(page, 20)
        if has_focus(locator):
            return
    pytest.fail(f"Tab never reached {locator}")


def role(page: Page | Locator, kind: str, name: str) -> Locator:
    return page.get_by_role(kind, name=name, exact=True)


def status(page: Page, name: str) -> Locator:
    return role(page, "status", name)


def row_attr(page: Page, name: str, attribute: str) -> str | None:
    return part_row(page, name).evaluate("(e, a) => (e.closest('[data-part-id]') || e).getAttribute(a)", attribute)


def axle_shift_points(hub_mass: str) -> str:
    d = lambda s: Fraction(Decimal(s))
    donor = (d("50.0") * d("600.0") + d("30.0") * d("100.0") + d("5.0") * d("200.0")) / ((d("50.0") + d("30.0") + d("5.0")) * d("1000.0"))
    mass = d("50.0") + d("8.0") + d(hub_mass) + d("2.0")
    built = (d("50.0") * d("600.0") + d("8.0") * d("527.5") + d("2.0") * d("640.0")) / (mass * d("1000.0"))
    points = abs(built - donor) * 100
    tenths = half_up(points.numerator * 10, points.denominator)
    return f"{tenths // 10}.{tenths % 10}"


def wait_text(page: Page, locator: Locator, expected: str, seconds: float = POLL_S) -> None:
    settled(page, lambda: read(locator) == expected, f"{locator} should read {expected!r}, got {read(locator)!r}", seconds)


def wait_contains(page: Page, locator: Locator, expected: str, seconds: float = POLL_S) -> None:
    settled(page, lambda: expected in read(locator), f"{locator} should contain {expected!r}, got {read(locator)!r}", seconds)


def page_says(page: Page, copy: str) -> bool:
    return copy in norm(page.locator("body").text_content(timeout=2000))


class Shop:

    def __init__(self, base: str, cookie: str = "", user: dict | None = None, email: str = "", password: str = ""):
        self.base, self.cookie, self.user, self.email, self.password = base.rstrip("/"), cookie, user or {}, email, password

    def at(self, base: str) -> "Shop":
        return Shop(base, self.cookie, self.user, self.email, self.password)

    def call(self, method: str, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        headers = {"Cookie": self.cookie} if self.cookie else {}
        if key is not None:
            headers["Idempotency-Key"] = key
        kwargs = {} if body is None else {"json": body}
        return httpx.request(method, self.base + path, headers=headers, timeout=HTTP_TIMEOUT, **kwargs)

    def get(self, path: str) -> httpx.Response:
        return self.call("GET", path)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        return self.call("POST", path, {} if body is None else body, key)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.call("PATCH", path, body)

    def order(self, oid: Any) -> dict:
        return is_status(self.get(f"/api/orders/{oid}"), 200)


def is_status(response: httpx.Response, code: int) -> Any:
    assert response.status_code == code, f"{response.request.method} {response.request.url}: {response.status_code} {response.text[:600]}"
    return response.json() if response.content else None


def refused(response: httpx.Response, code: int, error: str) -> None:
    assert response.status_code == code, f"{response.request.url}: expected {code} {error}, got {response.status_code} {response.text[:400]}"
    assert response.json() == {"error": error}


def cookie_of(response: httpx.Response) -> str:
    return "; ".join(f"{k}={v}" for k, v in response.cookies.items())


def register(base: str, country: str = "NL") -> Shop:
    a, b = unique("rider")
    email, name = (a, b) if "@" in a else (b, a)
    response = httpx.post(base.rstrip("/") + "/api/auth/register",
                          json={"email": email, "password": RIDER_PASSWORD, "name": name, "country": country}, timeout=HTTP_TIMEOUT)
    user = is_status(response, 201)
    return Shop(base, cookie_of(response), user, email, RIDER_PASSWORD)


def sign_in(base: str, email: str, password: str) -> Shop:
    response = httpx.post(base.rstrip("/") + "/api/auth/sign-in", json={"email": email, "password": password}, timeout=HTTP_TIMEOUT)
    return Shop(base, cookie_of(response), is_status(response, 200), email, password)


def fitter(base: str) -> Shop:
    return sign_in(base, FITTER_EMAIL, FITTER_PASSWORD)


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [f.result() for f in [pool.submit(c) for c in calls]]


def shop_now(base: str) -> datetime:
    data = is_status(httpx.get(base.rstrip("/") + "/api/status", timeout=HTTP_TIMEOUT), 200)
    return datetime.fromisoformat(data["serverNow"].replace("Z", "+00:00")).astimezone(AMS)


def kit(plate: str = "FGH-12-K", reg: str = "NL", pack: str = "P-1500", hub: str = "H-1000", road: int = 25,
        fulfilment: str = "posted", country: str = "NL") -> dict:
    return {"donor": {"plate": plate, "country": reg}, "packId": pack, "hubId": hub, "roadClass": road,
            "fulfilment": fulfilment, "country": country}


def manual_donor(model: str = "K50", reg: str = "NL", year: int = 2019, road: int = 25, colour: str = "blue", mass: float = 110.0) -> dict:
    return {"manual": {"model": model, "country": reg, "firstAdmissionYear": year, "roadClass": road,
                       "plateColour": colour, "registeredMassKg": mass}}


def fit(base: str, donor: dict, pack: str = "P-1500", hub: str = "H-1000", road: int = 25, **extra: Any) -> dict:
    return is_status(post_json(base, "/api/fit-checks", {"donor": donor, "packId": pack, "hubId": hub, "roadClass": road, **extra}), 200)


def plate(number: str, country: str = "NL") -> dict:
    return {"plate": number, "country": country}


def new_order(rider: Shop, config: dict | None = None, **options: Any) -> dict:
    config = config or kit(**options)
    quote = is_status(rider.post("/api/quotes", config), 200)
    return is_status(rider.post("/api/orders", {"kind": "kit", "config": config, "plan": PLAN,
                                                "expectedTotalCents": quote["totalCents"]}), 201)


def stage_of(order: dict, name: str) -> dict:
    return next(s for s in order["schedule"] if s["stage"] == name)


def line_of(order: dict, code: str) -> dict:
    return next(l for l in order["lines"] if l["code"] == code)


def money(cents: int) -> str:
    return f"€{cents // 100:,}.{cents % 100:02d}"


def half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def vat_of(gross: int, rate: int) -> int:
    return half_up(gross * rate, 100 + rate)


def spread(total: int) -> list[int]:
    deposit = half_up(total * 20, 100)
    each, left = divmod(total - deposit, 3)
    return [deposit] + [each + (1 if i < left else 0) for i in range(3)]


def allocate(amount: int, grosses: list[int], total: int) -> list[int]:
    parts = [amount * g // total for g in grosses]
    remainders = [amount * g % total for g in grosses]
    order = sorted(range(len(grosses)), key=lambda i: (-remainders[i], i))
    for i in order[: amount - sum(parts)]:
        parts[i] += 1
    return parts


def kb_all(killbill: Any, rider: Shop) -> list[tuple[dict, dict]]:
    account = killbill.account_by_key(f"rider-{rider.user['id']}")
    if not account:
        return []
    return [(p, t) for p in killbill.payments(account["accountId"]) for t in p.get("transactions", [])]


def kb_tx(killbill: Any, rider: Shop, external_key: str, seconds: float = POLL_S) -> tuple[dict, dict]:
    def find() -> Any:
        return next(((p, t) for p, t in kb_all(killbill, rider) if t.get("transactionExternalKey") == external_key), None)
    return poll(find, f"Kill Bill should hold a transaction with external key {external_key}", seconds)


def kb_count(killbill: Any, rider: Shop, kind: str = "PURCHASE") -> int:
    return sum(1 for _, t in kb_all(killbill, rider) if t.get("transactionType") == kind)


def kb_refunds(killbill: Any, rider: Shop, count: int, seconds: float = POLL_S) -> list[dict]:
    def found() -> Any:
        listed = [t for _, t in kb_all(killbill, rider) if t.get("transactionType") != "PURCHASE"]
        return listed if len(listed) >= count else None
    return poll(found, f"Kill Bill should hold {count} refund transaction(s)", seconds)


def mails_to(mail: Any, email: str, expected: int = 0, subject: str = "") -> list[dict]:
    def mine(settle: float) -> list[dict]:
        return [m for m in mail.messages(0, settle=settle)
                if email in addresses(m.get("To")) and subject in m.get("Subject", "")]
    poll(lambda: len(mine(0)) >= expected, f"{expected} mail(s) with subject containing {subject!r} to {email}")
    return mine(1.5)


_secrets: dict[str, str] = {}


def notification_secret(base: str, suffix: str) -> str:
    if suffix in _secrets:
        return _secrets[suffix]
    store = Postgres(suffix)

    def find() -> str | None:
        tables = sorted(store.tables(), key=lambda t: not re.search("secret|callback|setting|config|meta|kv", t, re.I))
        for table in tables:
            quoted = ".".join(f'"{part}"' for part in table.split("."))
            blob = json.dumps(store.rows(f"SELECT * FROM {quoted}"))
            for token in set(re.findall(rf"[A-Za-z0-9_~-]{{{SECRET_MIN},}}", blob)):
                answer = post_json(base, f"/api/killbill/notifications/{token}", {"objectType": "INVOICE", "objectId": str(uuid.uuid4())})
                if answer.status_code == 200:
                    return token
        return None

    _secrets[suffix] = poll(find, "the shop should store a callback secret of at least 32 characters in PostgreSQL")
    return _secrets[suffix]


def deliver(base: str, secret: str, payment: dict, event: str = "PAYMENT_SUCCESS") -> httpx.Response:
    return post_json(base, f"/api/killbill/notifications/{secret}",
                     {"eventType": event, "objectType": "PAYMENT", "objectId": payment["paymentId"],
                      "accountId": payment.get("accountId", ""), "metaData": ""})


def pay(rider: Shop, oid: Any, name: str) -> tuple[httpx.Response, str]:
    key = idempotency_key()
    return rider.post(f"/api/orders/{oid}/payments", {"stage": name}, key=key), key


def wait_order(shop: Shop, oid: Any, fn: Callable[[dict], Any], message: str, seconds: float = POLL_S, path: str = "/api/orders") -> dict:
    holder: dict = {}

    def probe() -> bool:
        holder["o"] = is_status(shop.get(f"{path}/{oid}"), 200)
        return bool(fn(holder["o"]))
    poll(probe, message, seconds)
    return holder["o"]


def pay_confirmed(rider: Shop, killbill: Any, secret: str, oid: Any, name: str) -> dict:
    response, key = pay(rider, oid, name)
    is_status(response, 202)
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    is_status(deliver(rider.base, secret, payment), 200)
    return wait_order(rider, oid, lambda o: stage_of(o, name)["status"] == "paid", f"{name} should read paid after a believed notification")


def pay_all(rider: Shop, killbill: Any, secret: str, oid: Any) -> dict:
    order = {}
    for name in STAGES:
        order = pay_confirmed(rider, killbill, secret, oid, name)
    return order


def settle_refund(base: str, secret: str, rider: Shop, killbill: Any, oid: Any) -> None:
    def pending_draws() -> list[dict]:
        return [d for r in rider.order(oid)["refunds"] for d in r["draws"] if d["status"] == "pending"]

    def sent() -> Any:
        held = {p["paymentId"] for p, t in kb_all(killbill, rider) if t.get("transactionType") != "PURCHASE"}
        draws = pending_draws()
        return draws if draws and all(d["killbillPaymentId"] in held for d in draws) else None

    for draw in poll(sent, "Kill Bill should hold a refund transaction for every pending draw"):
        is_status(deliver(base, secret, {"paymentId": draw["killbillPaymentId"]}, "REFUND_SUCCESS"), 200)


def refund_line(desk: Shop, oid: Any, line_id: Any, cents: int) -> httpx.Response:
    return desk.post(f"/api/desk/orders/{oid}/refunds", {"lineId": line_id, "amountCents": cents}, key=idempotency_key())


def open_slot(desk: Shop, day: date, bike: str = "BK-KADE-25") -> dict:
    for _ in range(40):
        minute = f"{random.randrange(8, 21):02d}:{random.randrange(60):02d}"
        response = desk.post("/api/desk/ride-days", {"bikeId": bike, "date": day.isoformat(), "times": [minute]})
        if response.status_code == 201:
            listed = is_status(desk.get(f"/api/bikes/{bike}/slots"), 200)["slots"]
            return next(s for s in listed if s["localDate"] == day.isoformat() and s["localTime"] == minute)
    pytest.fail("POST /api/desk/ride-days should open a fresh slot")


def later(base: str, days: int) -> date:
    return shop_now(base).date() + timedelta(days=days)


def due_day(value: str) -> date:
    if len(value) == 10:
        return date.fromisoformat(value)
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(AMS).date()


class HttpRelay:

    def __init__(self, upstream: str):
        self.upstream = upstream.rstrip("/")
        self.reset()
        self.log: list[tuple[float, str, str, str]] = []
        relay = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:
                return

            def reply(self, code: int, payload: bytes, headers: dict[str, str]) -> None:
                self.send_response(code)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def drop(self) -> None:
                self.close_connection = True
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            def serve(self) -> None:
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if relay.down:
                    self.drop()
                    return
                decoded = body.decode("utf-8", "replace")
                relay.log.append((time.monotonic(), self.command, self.path, decoded))
                if relay.refuse and relay.refuse(self.command, self.path, decoded):
                    self.reply(400, b'{"code":400,"message":"refused"}', {"Content-Type": "application/json"})
                    return
                skip = {"host", "content-length", "connection", "accept-encoding"}
                headers = {k: v for k, v in self.headers.items() if k.lower() not in skip}
                try:
                    answer = httpx.request(self.command, relay.upstream + self.path, content=body, headers=headers, timeout=HTTP_TIMEOUT)
                except httpx.HTTPError:
                    self.drop()
                    return
                code, payload = answer.status_code, answer.content
                if relay.rewrite:
                    code, payload = relay.rewrite(self.command, self.path, code, payload)
                drop = {"transfer-encoding", "content-length", "connection", "content-encoding"}
                out = {k: v.replace(relay.upstream, relay.url) for k, v in answer.headers.items() if k.lower() not in drop}
                self.reply(code, payload, out)

            do_GET = do_POST = do_PUT = do_DELETE = serve

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def reset(self) -> None:
        self.down = False
        self.refuse: Callable[[str, str, str], bool] | None = None
        self.rewrite: Callable[[str, str, int, bytes], tuple[int, bytes]] | None = None

    def stop(self) -> None:
        self.server.shutdown()
        self.server.socket.shutdown(socket.SHUT_RDWR)
        self.server.server_close()


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextmanager
def app_copy(port: int | None = None, **overrides: str) -> Iterator[str]:
    port = port or free_port()
    serve = json.loads((APP_SOURCE / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), **overrides}
    process = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-2000:]

    def healthy() -> bool:
        assert process.poll() is None, f"the app copy exited: {tail()}"
        try:
            return httpx.get(base + "/api/health", timeout=5).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(healthy, "the app copy should answer GET /api/health", 90)
        yield base
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(15)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


@pytest.fixture(scope="module")
def manual_relay_copy() -> Iterator[tuple[str, HttpRelay]]:
    relay = HttpRelay(os.environ["KILLBILL_URL"])
    with app_copy(KILLBILL_URL=relay.url, KILLBILL_CALLBACK_ORIGIN=DEAD_ORIGIN, DATABASE_URL=os.environ["DATABASE_URL"] + "_manual") as base:
        yield base, relay
    relay.stop()


@pytest.fixture
def relay_shop(manual_relay_copy: tuple[str, HttpRelay]) -> Iterator[tuple[str, HttpRelay]]:
    base, relay = manual_relay_copy
    relay.reset()
    poll(lambda: httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT).json()["killbill"] == "up", "the relayed copy should see Kill Bill up")
    yield base, relay
    relay.reset()


def patch_read(status_value: str | None = None, amount_delta: float = 0) -> Callable[[str, str, int, bytes], tuple[int, bytes]]:
    def rewrite(method: str, path: str, code: int, payload: bytes) -> tuple[int, bytes]:
        if method != "GET" or "/payments" not in path or code != 200:
            return code, payload
        data = json.loads(payload)
        for payment in data if isinstance(data, list) else [data]:
            for tx in payment.get("transactions", []):
                if status_value:
                    tx["status"] = status_value
                if amount_delta:
                    tx["amount"] = float(tx["amount"]) + amount_delta
        return code, json.dumps(data).encode()
    return rewrite


def png_rows(data: bytes) -> tuple[int, int, int, list[bytes]]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "capture should be a PNG"
    offset, idat, width, height, colour = 8, b"", 0, 0, 6
    while offset < len(data):
        length, kind = struct.unpack(">I4s", data[offset:offset + 8])
        chunk = data[offset + 8:offset + 8 + length]
        if kind == b"IHDR":
            width, height, _, colour = struct.unpack(">IIBB", chunk[:10])
        elif kind == b"IDAT":
            idat += chunk
        offset += 12 + length
    channels = {2: 3, 6: 4}[colour]
    raw = zlib.decompress(idat)
    stride = width * channels
    rows: list[bytes] = []
    previous = bytearray(stride)
    position = 0
    for _ in range(height):
        kind = raw[position]
        row = bytearray(raw[position + 1:position + 1 + stride])
        position += stride + 1
        for i in range(stride):
            a = row[i - channels] if i >= channels else 0
            b = previous[i]
            c = previous[i - channels] if i >= channels else 0
            if kind == 1:
                row[i] = (row[i] + a) & 255
            elif kind == 2:
                row[i] = (row[i] + b) & 255
            elif kind == 3:
                row[i] = (row[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(row))
        previous = row
    return width, height, channels, rows


def fraction_within(before: bytes, after: bytes, levels: int) -> float:
    w, h, ch, a = png_rows(before)
    _, _, ch2, b = png_rows(after)
    same = total = 0
    for y in range(h):
        for x in range(w):
            total += 1
            if all(abs(a[y][x * ch + c] - b[y][x * ch2 + c]) <= levels for c in range(3)):
                same += 1
    return same / total


def square_changed(before: bytes, after: bytes, x: float, y: float) -> float:
    w, h, ch, a = png_rows(before)
    _, _, ch2, b = png_rows(after)
    half = FOUL_SQUARE // 2
    changed_pixels = total = 0
    for py in range(max(0, int(y) - half), min(h, int(y) + half)):
        for px in range(max(0, int(x) - half), min(w, int(x) + half)):
            total += 1
            if any(a[py][px * ch + c] != b[py][px * ch2 + c] for c in range(3)):
                changed_pixels += 1
    return changed_pixels / max(total, 1)


def square_near(data: bytes, x: float, y: float, rgb: tuple[int, int, int]) -> int:
    w, h, ch, rows = png_rows(data)
    half = FOUL_SQUARE // 2
    count = 0
    for py in range(max(0, int(y) - half), min(h, int(y) + half)):
        for px in range(max(0, int(x) - half), min(w, int(x) + half)):
            if all(abs(rows[py][px * ch + c] - rgb[c]) <= FOUL_LEVELS for c in range(3)):
                count += 1
    return count


def primary_fill(locator: Locator) -> tuple[int, int, int]:
    value = next(iter(style(locator, "background-color").values()))
    numbers = re.findall(r"[\d.]+", value)
    return int(float(numbers[0])), int(float(numbers[1])), int(float(numbers[2]))


def configure_url(base: str, **params: Any) -> str:
    defaults: dict[str, Any] = {"plate": "FGH-12-K", "regCountry": "NL"}
    return f"{base.rstrip('/')}/configure?{urlencode({**defaults, **params})}"


def browser_sign_in(page: Page, base: str, email: str, password: str) -> None:
    response = page.request.post(f"{base.rstrip('/')}/api/auth/sign-in", data={"email": email, "password": password})
    assert response.status == 200, f"sign-in answered {response.status}"


def figures_ready(page: Page) -> None:
    settled(page, lambda: read(status(page, "Figures")).startswith("Total "), "status Figures should announce a quoted total")


def steady_figures(page: Page) -> str:
    held = {"text": "", "since": time.monotonic()}

    def still() -> bool:
        text = read(status(page, "Figures"))
        if text != held["text"]:
            held.update(text=text, since=time.monotonic())
        return text.startswith("Total ") and time.monotonic() - held["since"] >= 1

    settled(page, still, "status Figures should settle on a quoted total")
    return held["text"]


def scene_of(page: Page) -> Locator:
    return role(page, "application", "Moped scene")


def clearance(page: Page) -> Locator:
    return role(page, "region", "Clearance")


def slider(page: Page) -> Locator:
    return role(page, "slider", "Insertion travel")


def parts_list(page: Page) -> Locator:
    return role(page, "list", "Parts schedule")


def part_row(page: Page, name: str) -> Locator:
    return role(parts_list(page), "button", name)


def select_part(page: Page, name: str, part_id: str | None = None) -> None:
    if page.viewport_size["width"] < 768:
        click(role(page, "button", "Parts schedule"))
        settled(page, lambda: part_row(page, name).count() > 0, "dialog Parts schedule should list the row")
    click(part_row(page, name))
    if part_id:
        settled(page, lambda: attr(clearance(page), "data-part") == part_id, f"Clearance should show {part_id}")
    advance(page, FLIGHT_MS * 1.25)


def at_stop(page: Page) -> bool:
    region = clearance(page)
    return attr(region, "data-contact") == "true" or (attr(region, "data-travel-mm") not in (None, "", "0.0")
                                                      and attr(region, "data-travel-mm") == attr(region, "data-rail-mm"))


def drive(page: Page, name: str, part_id: str) -> None:
    select_part(page, name, part_id)
    slider(page).focus()
    page.keyboard.press("End")
    settled(page, lambda: at_stop(page), f"End should take {name} to its stop")


def verdict_done(page: Page) -> None:
    settled(page, lambda: read(status(page, "Fit verdict")) not in ("", "Checking fit..."), "status Fit verdict should settle")


def drive_both(page: Page) -> None:
    drive(page, "Traction pack", "traction-pack")
    drive(page, "Hub motor", "hub-motor")
    verdict_done(page)


def enabled(locator: Locator) -> bool:
    return locator.count() > 0 and attr(locator, "aria-disabled") != "true"


def open_checkout(page: Page) -> Locator:
    start = role(page, "button", "Start checkout")
    settled(page, lambda: enabled(start), "Start checkout should open once both rails are driven")
    click(start)
    dialog = role(page, "dialog", "Checkout")
    settled(page, lambda: dialog.count() > 0, "dialog Checkout should open")
    return dialog


def fill_delivery(dialog: Locator) -> None:
    fill(role(dialog, "textbox", "Name"), PLAN["name"])
    fill(role(dialog, "textbox", "Street"), PLAN["street"])
    fill(role(dialog, "textbox", "Postcode"), PLAN["postcode"])
    fill(role(dialog, "textbox", "City"), PLAN["city"])


def to_deposit_step(page: Page, dialog: Locator) -> Locator:
    fill_delivery(dialog)
    click(role(dialog, "button", "Next"))
    settled(page, lambda: role(dialog, "button", "Next").count() > 0, "the Schedule step should offer Next")
    advance(page, PANEL_MS)
    click(role(dialog, "button", "Next"))
    pay_button = role(dialog, "button", "Pay deposit")
    settled(page, lambda: pay_button.count() > 0, "the Deposit step should offer Pay deposit")
    return pay_button


def landed_on_order(page: Page) -> str:
    settled(page, lambda: re.search(r"/orders/[^/?#]+$", urlparse(page.url).path), f"deposit should land on /orders/<id>, at {page.url}")
    return urlparse(page.url).path.rsplit("/", 1)[1]


def rail_cents(page: Page) -> list[int]:
    return role(page, "region", "Price rail").evaluate(
        "e => [e, ...e.querySelectorAll('[data-cents]')].map(n => n.getAttribute('data-cents')).filter(Boolean).map(Number)")


def rail_words(page: Page) -> set[str]:
    return set(role(page, "region", "Price rail").evaluate(
        "e => [e, ...e.querySelectorAll('[data-figures]')].map(n => n.getAttribute('data-figures')).filter(Boolean)"))


def radio(page: Page, group: str, name: str) -> Locator:
    return role(role(page, "radiogroup", group), "radio", name)


def scene_angles(page: Page) -> tuple[float, float, float]:
    scene = scene_of(page)
    return (float(attr(scene, "data-azimuth-deg")), float(attr(scene, "data-elevation-deg")), float(attr(scene, "data-zoom")))


def edge_gap(page: Page) -> float:
    region = clearance(page)
    x, y = center(role(page, "button", "Rail handle"))
    return max(abs(x - float(attr(region, "data-leading-edge-screen-x"))), abs(y - float(attr(region, "data-leading-edge-screen-y"))))


def touch(page: Page, kind: str, points: list[tuple[float, float]]) -> None:
    session(page).send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})
    advance(page, 16)


def swipe(page: Page, start: tuple[float, float], moves: list[tuple[float, float]]) -> None:
    touch(page, "touchStart", [start])
    for point in moves:
        touch(page, "touchMove", [point])
    touch(page, "touchEnd", [])
    advance(page, 100)


def steps(start: tuple[float, float], dx: float, dy: float, count: int = 10) -> list[tuple[float, float]]:
    return [(start[0] + dx * i / count, start[1] + dy * i / count) for i in range(1, count + 1)]


def story_progress_to(page: Page, target: float) -> float:
    region = role(page, "region", "Teardown story")
    low, high = 0, page.evaluate("() => document.documentElement.scrollHeight")
    value = 0.0
    for _ in range(16):
        middle = (low + high) // 2
        page.evaluate("y => window.scrollTo(0, y)", middle)
        advance(page, 100)
        value = float(attr(region, "data-story-progress"))
        if abs(value - target) < 0.004:
            return value
        if value < target:
            low = middle
        else:
            high = middle
    if target == 0:
        page.evaluate("() => window.scrollTo(0, 0)")
        advance(page, 100)
        value = float(attr(region, "data-story-progress"))
    return value


def expected_offsets(progress: float) -> dict[str, list[float]]:
    out = {}
    for part, (stage, axis, sign, distance) in STORY_PARTS.items():
        share = min(1.0, max(0.0, progress * 6 - (stage - 1)))
        vector = [0.0, 0.0, 0.0]
        vector[axis] = sign * distance * share
        out[part] = vector
    return out


def test_plate_lookup_api(app_url: str, wiremock: Any) -> None:
    found = is_status(post_json(app_url, "/api/plates/lookup", {"plate": "fgh 12 k", "country": "NL"}), 200)
    assert found["plate"] == "FGH-12-K" and found["model"] == "K50" and found["modelName"] == "Kade K50"
    assert found["firstAdmissionYear"] == 2019 and found["className"] == "snorfiets" and found["plateColour"] == "blue"
    assert found["revision"] == "A" and found["confirmed"] is True
    assert wiremock.requests("/v1/plates/FGH-12-K"), "the registry should be read with the canonical plate"
    assert is_status(post_json(app_url, "/api/plates/lookup", {"plate": "a klm 204", "country": "BE"}), 200)["plate"] == "A-KLM-204"
    assert is_status(post_json(app_url, "/api/plates/lookup", {"plate": "418rtv", "country": "DE"}), 200)["plate"] == "418-RTV"
    refused(post_json(app_url, "/api/plates/lookup", {"plate": "XQX-00-X", "country": "NL"}), 404, "plate_not_found")
    missing = post_json(app_url, "/api/plates/lookup", {"plate": "ZZX-99-Q", "country": "NL"})
    assert missing.status_code == 422 and missing.json() == {"errors": {"plate": "That model is not in our catalogue yet."}}


def test_donor_lookup_invalid_plate_no_call(app_url: str, wiremock: Any, browser: Any) -> None:
    for number, country, example in [("12345", "NL", "FGH-12-K"), ("FGH12K9", "BE", "A-KLM-204"), ("41-RTV", "DE", "418-RTV")]:
        response = post_json(app_url, "/api/plates/lookup", {"plate": number, "country": country})
        assert response.status_code == 422
        assert response.json() == {"errors": {"plate": f"Enter a plate like {example}."}}
        assert not wiremock.requests(f"/v1/plates/{number}"), "no registry request for an invalid plate"
    with open_app(browser, f"{app_url}/configure") as page:
        page.set_viewport_size(DESKTOP)
        select(role(page, "combobox", "Registration country"), "NL")
        fill(role(page, "textbox", "Plate"), "99999")
        click(role(page, "button", "Look up plate"))
        wait_text(page, status(page, "Plate lookup"), "Enter a plate like FGH-12-K.")
        assert not wiremock.requests("/v1/plates/99999")
        fill(role(page, "textbox", "Plate"), "XQX-00-X")
        click(role(page, "button", "Look up plate"))
        wait_text(page, status(page, "Plate lookup"), "No scooter found for that plate.")
        fill(role(page, "textbox", "Plate"), "ZZX-99-Q")
        click(role(page, "button", "Look up plate"))
        wait_text(page, status(page, "Plate lookup"), "That model is not in our catalogue yet.")


def test_donor_lookup_latest_lookup_wins(app_url: str, browser: Any) -> None:
    with open_app(browser, f"{app_url}/configure") as page:
        page.set_viewport_size(DESKTOP)
        select(role(page, "combobox", "Registration country"), "NL")
        lookup_status = status(page, "Plate lookup")
        fill(role(page, "textbox", "Plate"), "SLW-22-T")
        click(role(page, "button", "Look up plate"))
        wait_text(page, lookup_status, "Looking up SLW-22-T...")
        fill(role(page, "textbox", "Plate"), "GHJ-77-M")
        click(role(page, "button", "Look up plate"))
        found = "Found Dijk D50, 2020, bromfiets, yellow plate."
        wait_text(page, lookup_status, found)
        stays(page, lambda: read(lookup_status) == found and "SLW" not in page.url, "the slow earlier lookup must not change anything",
              SLOW_LOOKUP_S + 2)
        assert parse_qs(urlparse(page.url).query)["plate"] == ["GHJ-77-M"]

        held_routes: list[Any] = []
        page.route("**/api/plates/lookup", lambda route: held_routes.append(route))
        fill(role(page, "textbox", "Plate"), "FGH-12-K")
        click(role(page, "button", "Look up plate"))
        settled(page, lambda: len(held_routes) >= 1, "the first lookup request should be sent")
        fill(role(page, "textbox", "Plate"), "DBR-45-T")
        click(role(page, "button", "Look up plate"))
        settled(page, lambda: len(held_routes) >= 2, "the second lookup request should be sent")
        try:
            held_routes[0].continue_()
        except Exception:
            pass
        stays(page, lambda: read(lookup_status) == "Looking up DBR-45-T..." and "FGH-12-K" not in page.url,
              "an answer to the earlier lookup must not change the screen", 2)
        held_routes[1].continue_()
        wait_text(page, lookup_status, "Found Kade K50, 2021, bromfiets, yellow plate.")
        settled(page, lambda: parse_qs(urlparse(page.url).query).get("plate") == ["DBR-45-T"], "the address should hold the latest plate")


def test_wf_donor_lookup_hand_entry(app_url: str, browser: Any, wiremock: Any) -> None:
    with open_app(browser, f"{app_url}/configure") as page:
        page.set_viewport_size(DESKTOP)
        click(role(page, "button", "Enter frame details by hand"))
        form = role(page, "form", "Frame details")
        settled(page, lambda: form.count() > 0, "form Frame details should open")
        select(role(form, "combobox", "Model"), "Kade K50")
        fill(role(form, "spinbutton", "First-admission year"), "2019")
        select(role(form, "combobox", "Registered road class"), "25 km/h")
        select(role(form, "combobox", "Plate colour"), "blue")
        fill(role(form, "textbox", "Registered mass in kg"), "110.0")
        click(role(form, "button", "Try this frame"))
        settled(page, lambda: "manual=1" in page.url, "the address should hold manual=1")
        query = parse_qs(urlparse(page.url).query)
        assert query["model"] == ["K50"] and query["year"] == ["2019"] and query["regClass"] == ["25"] and query["colour"] == ["blue"]
        figures_ready(page)
        drive_both(page)
        wait_contains(page, status(page, "Fit verdict"), fit(app_url, manual_donor())["sentence"])
        wait_contains(page, status(page, "Fit verdict"), "Donor unconfirmed.")
    result = fit(app_url, manual_donor())
    assert result["confirmed"] is False and result["verdict"] == "fits"
    bad = post_json(app_url, "/api/fit-checks", {"donor": manual_donor(reg="LU"), "packId": "P-1500", "hubId": "H-1000", "roadClass": 25})
    assert bad.status_code == 422 and bad.json()["errors"]["country"] == "Enter NL, BE or DE."


def test_feeler_sweep_keyboard_at_375(app_url: str, browser: Any) -> None:
    with open_app(browser, configure_url(app_url)) as page:
        page.set_viewport_size(PHONE)
        figures_ready(page)
        names = tab_order(page, 40)
        assert not set(names) & set(PART_NAMES), f"closed sheet rows reached by Tab: {names}"
        assert "Story" not in names, "closed navigation drawer reached by Tab"
        opener = role(page, "button", "Parts schedule")
        opener.focus()
        page.keyboard.press("Enter")
        settled(page, lambda: role(page, "dialog", "Parts schedule").count() > 0, "dialog Parts schedule should open by keyboard")
        tab_to(page, parts_list(page), 20)
        page.keyboard.press("Home")
        row = part_row(page, "Traction pack")
        for _ in range(len(PART_NAMES)):
            if has_focus(row):
                break
            page.keyboard.press("ArrowDown")
            advance(page, 20)
        assert has_focus(row), "ArrowDown should rove to the row"
        page.keyboard.press("Enter")
        settled(page, lambda: has_focus(slider(page)), "selecting in the sheet should move focus to the slider")
        assert role(page, "dialog", "Parts schedule").count() == 0
        advance(page, FLIGHT_MS * 1.25)
        region = clearance(page)
        page.keyboard.press("ArrowRight")
        settled(page, lambda: attr(region, "data-travel-mm") == "5.0", "ArrowRight moves 5 mm")
        page.keyboard.press("Shift+ArrowRight")
        settled(page, lambda: attr(region, "data-travel-mm") == "6.0", "Shift+ArrowRight moves 1 mm")
        page.keyboard.press("ArrowLeft")
        settled(page, lambda: attr(region, "data-travel-mm") == "1.0", "ArrowLeft moves 5 mm back")
        assert f"{attr(region, 'data-travel-mm')} mm" in (attr(slider(page), "aria-valuetext") or ""), "value text reads the travel"
        assert attr(region, "data-gap-s1-mm") in ("", None), "no gap until the part reaches the station"
        page.keyboard.press("Home")
        for _ in range(12):
            page.keyboard.press("ArrowRight")
        settled(page, lambda: attr(region, "data-travel-mm") == "60.0", "twelve steps reach Bay mouth")
        gaps = [s["gapMm"] for s in fit(app_url, plate("FGH-12-K"))["rails"]["pack"]["stations"]]
        assert attr(region, "data-gap-s1-mm") == gaps[0] and attr(region, "data-gap-s2-mm") in ("", None)
        page.keyboard.press("End")
        settled(page, lambda: attr(region, "data-travel-mm") == "210.0", "End goes to the rail length")
        assert attr(region, "data-gap-s2-mm") == gaps[1] and attr(region, "data-gap-s3-mm") == gaps[2]
        assert attr(region, "data-smallest-gap-mm") == str(min(Decimal(g) for g in gaps)) and attr(region, "data-contact") == "false"
        page.keyboard.press("Escape")
        settled(page, lambda: attr(region, "data-travel-mm") == "0.0" and has_focus(opener), "Escape returns to the start and to Parts schedule")
        layout(page)


def test_feeler_flight_fade_and_handle(app_url: str, browser: Any) -> None:
    with open_app(browser, configure_url(app_url)) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        scene = scene_of(page)
        scene.scroll_into_view_if_needed()
        advance(page, 1000)
        assert row_attr(page, "Seat", "data-panel-fade") == "1"
        box = scene.bounding_box()
        seat_x = float(row_attr(page, "Seat", "data-screen-x")) - box["x"]
        seat_y = float(row_attr(page, "Seat", "data-screen-y")) - box["y"]
        before = capture(scene)
        click(part_row(page, "Traction pack"))
        advance(page, FLIGHT_MS * (1 - TIMING_TOLERANCE))
        early = capture(scene)
        advance(page, FLIGHT_MS * 2 * TIMING_TOLERANCE + 16)
        done = capture(scene)
        advance(page, 300)
        final = capture(scene)
        assert difference(decode(early), decode(final)) > 0, "the flight should still be moving before its published time"
        assert difference(decode(done), decode(final)) <= 0.001, "the flight should have settled by its published time"
        assert attr(scene, "data-selected-part") == "traction-pack"
        for part in PANELS_FOR_PACK:
            assert row_attr(page, part, "data-panel-fade") == "0.25", part
        assert row_attr(page, "Front panel", "data-panel-fade") == "1"
        assert square_changed(before, final, seat_x, seat_y) >= FADE_MIN, "the faded panel must change in pixels"
        handle = role(page, "button", "Rail handle")
        size = handle.bounding_box()
        assert size["width"] >= 44 and size["height"] >= 44
        assert edge_gap(page) <= HANDLE_TOLERANCE_PX
        slider(page).focus()
        page.keyboard.press("Home")
        advance(page, 200)
        scene_box = scene.bounding_box()
        rest_png = capture(scene)
        for _ in range(10):
            page.keyboard.press("ArrowRight")
        settled(page, lambda: attr(clearance(page), "data-travel-mm") == "50.0", "ten steps make 50 mm")
        advance(page, 200)
        moved_png = capture(scene)
        edge_x = float(attr(clearance(page), "data-leading-edge-screen-x")) - scene_box["x"]
        edge_y = float(attr(clearance(page), "data-leading-edge-screen-y")) - scene_box["y"]
        assert difference(decode(rest_png), decode(moved_png)) > 0, "driving the rail by keys must change the scene pixels"
        assert square_changed(rest_png, moved_png, edge_x, edge_y) >= FADE_MIN, "pixels must change at the leading edge after keyed travel"
        page.keyboard.press("Home")
        advance(page, 200)
        grab_x, grab_y = center(handle)
        page.mouse.move(grab_x, grab_y)
        page.mouse.down()
        page.mouse.move(grab_x + 40, grab_y, steps=4)
        advance(page, 100)
        if float(attr(clearance(page), "data-travel-mm")) == 0:
            page.mouse.move(grab_x - 40, grab_y, steps=4)
            advance(page, 100)
        assert float(attr(clearance(page), "data-travel-mm")) > 0, "dragging the handle moves the part"
        dragged_png = capture(scene)
        drag_x = float(attr(clearance(page), "data-leading-edge-screen-x")) - scene_box["x"]
        drag_y = float(attr(clearance(page), "data-leading-edge-screen-y")) - scene_box["y"]
        page.mouse.up()
        assert square_changed(rest_png, dragged_png, drag_x, drag_y) >= FADE_MIN, "pixels must change at the leading edge after a drag"
        advance(page, SPRING_MS * 2)
        slider(page).focus()
        page.keyboard.press("End")
        settled(page, lambda: attr(clearance(page), "data-travel-mm") == "210.0", "End seats the pack")
        advance(page, 100)
        assert edge_gap(page) <= HANDLE_TOLERANCE_PX
        start = center(handle)
        tab_to(page, scene)
        page.keyboard.press("ArrowRight")
        advance(page, 100)
        moved = center(handle)
        assert max(abs(moved[0] - start[0]), abs(moved[1] - start[1])) >= ORBIT_MIN_PX, "a 15-degree orbit moves the handle"
        assert edge_gap(page) <= HANDLE_TOLERANCE_PX
        page.keyboard.press("+")
        advance(page, 100)
        assert edge_gap(page) <= HANDLE_TOLERANCE_PX
        page.set_viewport_size({"width": 1400, "height": 900})
        advance(page, 200)
        assert edge_gap(page) <= HANDLE_TOLERANCE_PX
        box = scene.bounding_box()
        x, y = center(handle)
        assert box["x"] <= x <= box["x"] + box["width"] and box["y"] <= y <= box["y"] + box["height"]
        click(part_row(page, "Front panel"))
        settled(page, lambda: clearance(page).count() == 0 or not clearance(page).is_visible(), "Clearance shows only for rail parts")


def test_feeler_sweep_pixel_fouling(app_url: str, browser: Any) -> None:
    url = configure_url(app_url, plate="A-KLM-204", regCountry="BE", pack="P-2100")
    with open_app(browser, url) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        scene_of(page).scroll_into_view_if_needed()
        drive(page, "Hub motor", "hub-motor")
        select_part(page, "Traction pack", "traction-pack")
        region = clearance(page)
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        settled(page, lambda: attr(region, "data-travel-mm") == "5.0", "ArrowRight should move the pack")
        advance(page, 200)
        scene = scene_of(page)
        before = capture(scene)
        assert attr(region, "data-fouling-screen-x") in ("", None), "no fouling point before contact"
        page.keyboard.press("End")
        settled(page, lambda: attr(region, "data-contact") == "true", "the pack should reach first contact")
        advance(page, 1000)
        assert attr(region, "data-travel-mm") == "120.0"
        assert attr(region, "data-fouling-feature") == "Centre stand brace"
        assert attr(region, "data-gap-s1-mm") == "0.0" and attr(region, "data-gap-s3-mm") in ("", None)
        page.keyboard.press("ArrowRight")
        advance(page, 100)
        assert attr(region, "data-travel-mm") == "120.0", "steps clamp at the stop"
        x, y = float(attr(region, "data-fouling-screen-x")), float(attr(region, "data-fouling-screen-y"))
        assert abs(float(attr(region, "data-leading-edge-screen-x")) - x) <= HANDLE_TOLERANCE_PX
        assert abs(float(attr(region, "data-leading-edge-screen-y")) - y) <= HANDLE_TOLERANCE_PX
        wait_contains(page, status(page, "Fit verdict"), fit(app_url, plate("A-KLM-204", "BE"), "P-2100")["sentence"])
        start = role(page, "button", "Start checkout")
        settled(page, lambda: enabled(start), "both rails have reached their stops")
        fill_rgb = primary_fill(start)
        box = scene.bounding_box()
        after = capture(scene)
        assert square_near(after, x - box["x"], y - box["y"], fill_rgb) >= FOUL_MIN_PIXELS, "accent edge at the published point"
        assert square_near(before, x - box["x"], y - box["y"], fill_rgb) == 0, "no accent edge there before contact"


def test_wf_feeler_sweep_release_and_seat(app_url: str, browser: Any) -> None:
    with open_app(browser, configure_url(app_url)) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        select_part(page, "Traction pack", "traction-pack")
        region = clearance(page)
        handle = role(page, "button", "Rail handle")
        x, y = center(handle)
        page.mouse.move(x, y)
        page.mouse.down()
        direction = 1
        page.mouse.move(x + 20, y, steps=4)
        advance(page, 50)
        if float(attr(region, "data-travel-mm")) == 0:
            direction = -1
            page.mouse.move(x - 20, y, steps=4)
            advance(page, 50)
        first = float(attr(region, "data-travel-mm"))
        assert first > 0, "dragging the handle should move travel"
        page.mouse.move(x + 40 * direction, y, steps=4)
        advance(page, 50)
        second = float(attr(region, "data-travel-mm"))
        assert second == pytest.approx(first * 2, rel=0.3), "travel moves in proportion to the drag"
        page.mouse.up()
        travelled = 0
        limit = SPRING_MS * (1 + TIMING_TOLERANCE)
        while travelled < limit and attr(region, "data-travel-mm") != "0.0":
            advance(page, 50)
            travelled += 50
            assert float(attr(region, "data-travel-mm")) >= 0, "no overshoot"
        assert attr(region, "data-travel-mm") == "0.0", "releasing short of contact should spring back in about half a second"

        x, y = center(handle)
        touch(page, "touchStart", [(x, y)])
        touch(page, "touchMove", [(x + 30 * direction, y)])
        touch(page, "touchMove", [(x + 40 * direction, y)])
        assert float(attr(region, "data-travel-mm")) > 0, "touching the handle should drive the rail"
        session(page).send("Input.dispatchTouchEvent", {"type": "touchCancel", "touchPoints": []})
        settled(page, lambda: attr(region, "data-travel-mm") == "0.0", "a cancelled handle touch should spring back", 5)

        slider(page).focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        settled(page, lambda: attr(region, "data-travel-mm") == "10.0", "two steps make 10 mm")
        advance(page, 2000)
        assert attr(region, "data-travel-mm") == "10.0", "keyboard travel stays where it is left"

        checks: list[str] = []
        page.on("request", lambda r: checks.append(r.url) if r.method == "POST" and re.search(r"/api/(fit-checks|quotes)$", r.url) else None)
        page.keyboard.press("End")
        settled(page, lambda: at_stop(page) and checks, "reaching the full seat should ask the server for the fit")
        wait_contains(page, status(page, "Fit verdict"), "Fits.")
        advance(page, 1500)
        assert attr(region, "data-travel-mm") == "210.0", "full seat holds"


def test_feeler_readout_agrees_with_verdict(app_url: str, browser: Any) -> None:
    for number, word, gap in [
        ("FGH-12-K", "Fits", "3.0"),
        ("DBR-45-T", "Too tight", "0.0"),
    ]:
        road = 25 if number == "FGH-12-K" else 45
        result = fit(app_url, plate(number), "P-2100", road=road)
        with open_app(browser, configure_url(app_url, plate=number, pack="P-2100", **{"class": road})) as page:
            page.set_viewport_size(DESKTOP)
            figures_ready(page)
            drive(page, "Hub motor", "hub-motor")
            drive(page, "Traction pack", "traction-pack")
            wait_contains(page, status(page, "Fit verdict"), result["sentence"])
            region = clearance(page)
            stations = result["rails"]["pack"]["stations"]
            for index, station in enumerate(stations, 1):
                assert attr(region, f"data-gap-s{index}-mm") == station["gapMm"]
            assert attr(region, "data-gap-s2-mm") == gap and attr(region, "data-smallest-gap-mm") == gap
            assert attr(region, "data-travel-mm") == result["rails"]["pack"]["stopTravelMm"]
            assert page.get_by_text(word, exact=True).count() >= 1, f"verdict word {word} beside the readout"


def test_scene_keys_and_parts_list(app_url: str, browser: Any) -> None:
    url = configure_url(app_url)
    with open_app(browser, url) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        scene = scene_of(page)
        scene.scroll_into_view_if_needed()
        assert attr(scene, "data-renderer") == "webgl" and int(attr(scene, "data-mesh-count")) >= 16
        for name in PART_NAMES:
            assert part_row(page, name).count() == 1, name
        assert row_attr(page, "Front wheel", "data-position-mm") == "1240,0,190"
        assert row_attr(page, "Traction pack", "data-position-mm") == "500,0,360"
        tab_to(page, scene)
        assert scene_angles(page) == (30, 15, 1)
        before = capture(scene)
        page.keyboard.press("ArrowRight")
        advance(page, 200)
        assert abs(scene_angles(page)[0] - 30) == 15
        assert difference(decode(before), decode(capture(scene))) > 0, "orbit must change pixels"
        extremes = set()
        for key in ("ArrowUp", "ArrowDown"):
            for _ in range(12):
                page.keyboard.press(key)
            advance(page, 100)
            extremes.add(scene_angles(page)[1])
        assert extremes == {75, -15}
        zooms = set()
        for key in ("+", "-"):
            for _ in range(20):
                page.keyboard.press(key)
            advance(page, 100)
            zooms.add(scene_angles(page)[2])
        assert zooms == {2.0, 0.5}
        page.keyboard.press("Home")
        advance(page, 100)
        assert scene_angles(page) == (30, 15, 1)
        page.keyboard.press("Escape")
        settled(page, lambda: has_focus(parts_list(page)), "Escape moves to the first parts row")
        page.keyboard.press("End")
        advance(page, 30)
        assert has_focus(part_row(page, PART_NAMES[-1])) or has_focus(parts_list(page))
        page.keyboard.press("Home")
        for _ in range(len(PART_NAMES)):
            if has_focus(part_row(page, "Seat")):
                break
            page.keyboard.press("ArrowDown")
            advance(page, 20)
        page.keyboard.press("Enter")
        settled(page, lambda: attr(scene, "data-selected-part") == "seat", "Enter selects the part in the scene")
        page.keyboard.press("Tab")
        advance(page, 30)
        assert not has_focus(parts_list(page)), "the list is one Tab stop"
        tab_to(page, scene)
        page.keyboard.press("Tab")
        advance(page, 30)
        assert not has_focus(scene), "Tab always leaves the scene"
        tab_to(page, scene)
        page.keyboard.press("Shift+Tab")
        advance(page, 30)
        assert not has_focus(scene), "Shift+Tab always leaves the scene"
        page.mouse.click(float(row_attr(page, "Front wheel", "data-screen-x")), float(row_attr(page, "Front wheel", "data-screen-y")))
        settled(page, lambda: attr(scene, "data-selected-part") == "front-wheel", "clicking the part selects it")
        box = scene.bounding_box()
        start_angles = scene_angles(page)
        page.mouse.move(box["x"] + 30, box["y"] + 30)
        page.mouse.down()
        page.mouse.move(box["x"] + 130, box["y"] + 90, steps=6)
        page.mouse.up()
        advance(page, 100)
        now = scene_angles(page)
        assert now[0] != start_angles[0] and now[1] != start_angles[1], "a mouse drag orbits on both axes"


def test_feeler_sweep_proof_gate(app_url: str, browser: Any) -> None:
    rider = register(app_url)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, app_url, rider.email, rider.password)
        page.goto(configure_url(app_url))
        figures_ready(page)
        start = role(page, "button", "Start checkout")
        reason = "Drive the pack and hub to their stops first."

        def shut() -> None:
            assert attr(start, "aria-disabled") == "true", "Start checkout should be disabled"
            start.focus()
            page.keyboard.press("Enter")
            advance(page, 100)
            assert role(page, "dialog", "Checkout").count() == 0, "a disabled Start checkout opens nothing"
            assert page_says(page, reason), "the published reason should show"

        shut()
        drive(page, "Traction pack", "traction-pack")
        shut()
        drive(page, "Hub motor", "hub-motor")
        settled(page, lambda: enabled(start), "both rails driven should open checkout")
        check(radio(page, "Units", "Imperial"))
        settled(page, lambda: "units=imperial" in page.url and enabled(start), "units keep the proof")
        select(role(page, "combobox", "Delivery country"), "DE")
        settled(page, lambda: "country=DE" in page.url and enabled(start), "country keeps the proof")
        select(role(page, "combobox", "Pack"), "P-1100 1100 Wh")
        settled(page, lambda: "pack=P-1100" in page.url and read(status(page, "Figures")).startswith("Total "), "pack change re-quotes")
        shut()
        drive_both(page)
        settled(page, lambda: enabled(start), "driving again re-opens checkout")
        page.reload()
        figures_ready(page)
        shut()


def test_fit_rules_exact_boundary_rationals(app_url: str) -> None:
    exact = fit(app_url, plate("GHJ-77-M"), "P-1100", "H-3600", 45)
    assert exact["axle"] == {"donorFrontPct": "40.0", "builtFrontPct": "50.0", "shiftPct": "10.0", "passes": True}
    assert exact["verdict"] == "fits"
    over = fit(app_url, plate("GHJ-77-M"), "P-1100", "H-2400", 45)
    shift_over = axle_shift_points("9.5")
    assert over["axle"]["passes"] is False and over["axle"]["shiftPct"] == shift_over
    assert over["verdict"] == "outside_limits" and over["word"] == "Outside limits"
    assert f"Axle split moves {shift_over} points; the limit is 10.0." in over["sentence"]
    rounded = fit(app_url, plate("GHJ-77-M"), "P-1100", "H-4200", 45)
    assert rounded["axle"]["shiftPct"] == axle_shift_points("11.5") and rounded["axle"]["passes"] is True


def test_fit_rules_revision_by_year(app_url: str, wiremock: Any) -> None:
    before = len(wiremock.requests("/v1/plates/FGH-12-K"))
    a = fit(app_url, plate("FGH-12-K"), "P-2100")
    assert a["revision"] == "A" and a["verdict"] == "fits" and a["rails"]["pack"]["stations"][1]["gapMm"] == "3.0"
    assert a["rails"]["pack"]["stations"][1]["name"] == "Footboard rib"
    assert f"Smallest gap {a['rails']['pack']['stations'][1]['gapMm']} mm at Footboard rib" in a["sentence"]
    fit(app_url, plate("FGH-12-K"), "P-2100")
    assert len(wiremock.requests("/v1/plates/FGH-12-K")) == before + 2, "no cached registry answer"
    b = fit(app_url, plate("DBR-45-T"), "P-2100", road=45)
    assert b["revision"] == "B" and b["verdict"] == "too_tight" and b["rails"]["pack"]["stations"][1]["gapMm"] == "0.0"
    assert b["rails"]["pack"]["stopTravelMm"] == "210.0" and b["rails"]["pack"]["foulingFeature"] is None
    assert f"Gap {b['rails']['pack']['stations'][1]['gapMm']} mm at Footboard rib; the minimum is {MINIMUM} mm." in b["sentence"]
    assert fit(app_url, manual_donor(year=2020), "P-2100")["revision"] == "A"
    hand = fit(app_url, manual_donor(year=2021), "P-2100")
    assert hand["revision"] == "B" and hand["verdict"] == "too_tight"
    fouled = fit(app_url, plate("A-KLM-204", "BE"), "P-2100")
    pack = fouled["rails"]["pack"]
    assert fouled["verdict"] == "fouls" and pack["stopTravelMm"] == "120.0" and pack["foulingFeature"] == "Centre stand brace"
    assert pack["stations"][0]["gapMm"] == "0.0" and pack["stations"][2]["gapMm"] is None
    assert f"Traction pack stops at {pack['stopTravelMm']} mm on {pack['foulingFeature']}." in fouled["sentence"]


def test_fit_hub_and_shaft(app_url: str) -> None:
    exact = fit(app_url, plate("B-NOP-318", "BE"), hub="H-2400", road=45)
    arm_gap = exact["rails"]["hub"]["stations"][1]["gapMm"]
    assert exact["verdict"] == "fits" and arm_gap == MINIMUM and f"Smallest gap {arm_gap} mm at Swingarm arm" in exact["sentence"]
    assert [s["gapMm"] for s in exact["rails"]["hub"]["stations"]] == ["6.0", "3.0", "4.0"]
    tight = fit(app_url, plate("725-XKM", "DE"), hub="H-2400", road=45)
    slack = str(Decimal("106.9") - Decimal("104.0"))
    assert tight["verdict"] == "too_tight" and f"Gap {slack} mm at Sprocket line; the minimum is {MINIMUM} mm." in tight["sentence"]
    fouled = fit(app_url, plate("725-XKM", "DE"), hub="H-3600", road=45)
    assert fouled["verdict"] == "fouls" and fouled["rails"]["hub"]["stopTravelMm"] == "45.0"
    assert fouled["rails"]["hub"]["foulingFeature"] == "Swingarm arm" and fouled["rails"]["hub"]["stations"][2]["gapMm"] is None
    hub_rail = fouled["rails"]["hub"]
    assert f"Hub motor stops at {hub_rail['stopTravelMm']} mm on {hub_rail['foulingFeature']}." in fouled["sentence"]


def test_fit_mass_dimensions_tank(app_url: str) -> None:
    built = Decimal("52.0") + Decimal("10.5") + Decimal("7.5") + Decimal("2.0")
    equal = fit(app_url, manual_donor("R50", "DE", 2017, 25, "white", float(built)))
    assert equal["builtMassKg"] == str(built) and equal["verdict"] == "fits"
    under = built - Decimal("0.1")
    over = fit(app_url, manual_donor("R50", "DE", 2017, 25, "white", float(under)))
    assert over["verdict"] == "outside_limits" and f"Built mass {built} kg is over the registered {under} kg." in over["sentence"]
    assert next(l for l in over["limits"] if l["rule"] == "registered_mass")["passes"] is False
    grown = fit(app_url, plate("FGH-12-K"), "P-1800")
    growth = next(l for l in grown["limits"] if l["rule"] == "overall_dimensions")
    assert grown["verdict"] == "outside_limits" and growth["passes"] is False
    assert growth["sentence"] in grown["sentence"] and growth["sentence"].startswith("The kit grows the overall length by ")
    assert "6.0" in growth["sentence"] and growth["sentence"].endswith(" mm.")
    for config in (kit(), kit(fulfilment="workshop"), kit("418-RTV", "DE", country="LU")):
        quote = is_status(post_json(app_url, "/api/quotes", config), 200)
        assert line_of(quote, "TANK-OUT")["grossCents"] == 4900
        assert INSURANCE in quote["notices"]


def test_fit_road_class_and_power(app_url: str) -> None:
    at_class = fit(app_url, plate("FGH-12-K"))
    assert next(l for l in at_class["limits"] if l["rule"] == "road_class_power")["passes"] is True
    at_donor = fit(app_url, plate("FGH-12-K"), hub="H-3600", road=45)
    assert at_donor["verdict"] == "fits" and next(l for l in at_donor["limits"] if l["rule"] == "donor_power")["passes"] is True
    over = fit(app_url, plate("DBR-45-T"), hub="H-4200", road=45)
    assert over["verdict"] == "outside_limits" and "Hub power 4.2 kW is over the bromfiets limit of 4.0 kW." in over["sentence"]
    donor_rule = next(l for l in over["limits"] if l["rule"] == "donor_power")
    assert donor_rule["passes"] is False and "Hub power 4.2 kW is over 120 percent of the donor's 3.0 kW." in donor_rule["sentence"]
    low = fit(app_url, plate("A-KLM-204", "BE"), hub="H-2400")
    assert low["verdict"] == "outside_limits" and "Hub power 2.4 kW is over the class A limit of 1.0 kW." in low["sentence"]


def test_class_move_costs_and_notices(app_url: str) -> None:
    morning = env_url("APP_CLOCK_MORNING_URL")
    up = is_status(post_json(morning, "/api/quotes", kit(road=45)), 200)
    fee = line_of(up, "INSPECT-NL")
    assert fee["grossCents"] == 13100 and fee["vatRatePct"] == 0 and fee["vatCents"] == 0 and fee["name"] == "Inspection fee"
    assert set(CLASS_NOTICES) <= set(up["notices"])
    be = is_status(post_json(morning, "/api/quotes", kit("A-KLM-204", "BE", road=45, country="DE")), 200)
    assert line_of(be, "INSPECT-BE")["grossCents"] == 9500, "the fee follows the registration country, not delivery"
    same = is_status(post_json(morning, "/api/quotes", kit()), 200)
    assert not [l for l in same["lines"] if l["code"].startswith("INSPECT-")]
    assert not set(CLASS_NOTICES) & set(same["notices"])
    down = post_json(morning, "/api/quotes", kit("DBR-45-T", road=25))
    assert down.status_code == 422 and down.json()["errors"]["roadClass"] == "A kit cannot move a scooter down a road class."


def test_units_never_change_a_verdict(app_url: str, browser: Any) -> None:
    metric = fit(app_url, plate("FGH-12-K"), "P-2100", units="metric")
    imperial = fit(app_url, plate("FGH-12-K"), "P-2100", units="imperial")
    assert metric["verdict"] == imperial["verdict"] == "fits"
    assert metric["rails"]["pack"]["stations"] == imperial["rails"]["pack"]["stations"]
    with open_app(browser, configure_url(app_url, pack="P-2100")) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        drive(page, "Hub motor", "hub-motor")
        drive(page, "Traction pack", "traction-pack")
        wait_contains(page, status(page, "Fit verdict"), metric["sentence"])
        check(radio(page, "Units", "Imperial"))
        wait_contains(page, status(page, "Fit verdict"), imperial["sentence"])
        region = clearance(page)
        assert attr(region, "data-gap-s2-mm") == "3.0" and attr(region, "data-travel-mm") == "210.0"
        inches = (Decimal("210.0") / Decimal("25.4")).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        assert f"{inches} in" in (attr(slider(page), "aria-valuetext") or "")


def test_fit_rules_dated_fee(app_url: str) -> None:
    december = is_status(post_json(env_url("APP_CLOCK_MORNING_URL"), "/api/quotes", kit(road=45)), 200)
    assert line_of(december, "INSPECT-NL")["grossCents"] == 13100
    new_year = env_url("APP_CLOCK_NEW_YEAR_URL")
    january = is_status(post_json(new_year, "/api/quotes", kit(road=45)), 200)
    assert line_of(january, "INSPECT-NL")["grossCents"] == 13600
    assert january["totalCents"] == december["totalCents"] + 500
    assert line_of(is_status(post_json(new_year, "/api/quotes", kit("A-KLM-204", "BE", road=45)), 200), "INSPECT-BE")["grossCents"] == 9800
    assert line_of(is_status(post_json(new_year, "/api/quotes", kit("418-RTV", "DE", road=45, country="DE")), 200), "INSPECT-DE")["grossCents"] == 8900


def test_stale_quote_requoted_before_deposit(killbill: Any) -> None:
    flip = datetime.fromisoformat("2026-12-31T23:00:00+00:00")
    with app_copy(SHOP_CLOCK_START="2026-12-31T22:00:00Z", SHOP_CLOCK_RATE="60",
                  KILLBILL_CALLBACK_ORIGIN=DEAD_ORIGIN, DATABASE_URL=os.environ["DATABASE_URL"] + "_manual") as base:
        rider = register(base)
        config = kit(road=45)
        quote = is_status(rider.post("/api/quotes", config), 200)
        assert line_of(quote, "INSPECT-NL")["grossCents"] == 13100
        wrong = rider.post("/api/orders", {"kind": "kit", "config": config, "plan": PLAN, "expectedTotalCents": quote["totalCents"] + 1})
        refused(wrong, 409, "quote_changed")
        assert is_status(rider.get("/api/orders"), 200)["orders"] == [], "a differing total creates nothing"
        missing = rider.post("/api/orders", {"kind": "kit", "config": config, "plan": PLAN})
        assert missing.status_code == 422 and missing.json()["errors"]["expectedTotalCents"] == "Required."
        order = new_order(rider, config)
        assert line_of(order, "INSPECT-NL")["grossCents"] == 13100
        poll(lambda: shop_now(base) >= flip, "the copy's shop clock should reach the new fee", 90)
        assert line_of(rider.order(order["id"]), "INSPECT-NL")["grossCents"] == 13100, "a quoted order keeps its fee until re-quoted"
        response, _ = pay(rider, order["id"], "deposit")
        refused(response, 409, "quote_changed")
        assert kb_count(killbill, rider) == 0, "re-quoting makes no Kill Bill call"
        requoted = rider.order(order["id"])
        assert line_of(requoted, "INSPECT-NL")["grossCents"] == 13600 and requoted["totalCents"] == order["totalCents"] + 500
        assert requoted["state"] == "quoted"
        response, key = pay(rider, order["id"], "deposit")
        assert is_status(response, 202)["state"] == "deposit pending"
        kb_tx(killbill, rider, f"{rider.user['id']}:{key}")


def test_configurator_live_stale_reply_dropped(app_url: str, browser: Any) -> None:
    with open_app(browser, configure_url(app_url)) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        page.evaluate("() => { window.__sameDocument = true }")
        routes: list[Any] = []
        page.route("**/api/quotes", lambda route: routes.append(route))
        select(role(page, "combobox", "Pack"), "P-1800 1800 Wh")
        settled(page, lambda: len(routes) >= 1, "the first change should request a quote")
        select(role(page, "combobox", "Pack"), "P-2100 2100 Wh")
        settled(page, lambda: len(routes) >= 2, "the second change should request a quote")
        routes[-1].continue_()
        total = 41900 + 84900 + 34900 + 4900 + 3900
        vat = sum(vat_of(g, 21) for g in (41900, 84900, 34900, 4900, 3900))
        expected = f"Total {money(total)} quoted. VAT {money(vat)}. Range 95 km."
        wait_text(page, status(page, "Figures"), expected)
        try:
            routes[0].continue_()
        except Exception:
            pass
        stays(page, lambda: read(status(page, "Figures")) == expected and total in rail_cents(page), "the stale quote must be dropped", 2)
        assert total - 10000 not in rail_cents(page), "the superseded P-1800 total must not show"
        assert page.evaluate("() => window.__sameDocument") is True, "figures update without a reload"


def test_configurator_live_honest_word(app_url: str, browser: Any) -> None:
    with open_app(browser, configure_url(app_url)) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        drive_both(page)
        start = role(page, "button", "Start checkout")
        settled(page, lambda: enabled(start), "both rails driven")
        rail = role(page, "region", "Price rail")
        routes: list[Any] = []
        page.route("**/api/quotes", lambda route: routes.append(route))
        select(role(page, "combobox", "Delivery country"), "DE")
        wait_text(page, status(page, "Figures"), "Checking figures...")
        assert "checking" in rail_words(page) and "checking" in read(rail)
        assert "€" in read(rail), "figures stay visible while checking"
        assert attr(start, "aria-disabled") == "true"
        routes[-1].fulfill(status=503, content_type="application/json", body='{"error":"registry_unreachable"}')
        wait_text(page, status(page, "Figures"), "Figures could not be refreshed. Nothing here is a current quote.")
        assert "not current" in rail_words(page) and "not current" in read(rail)
        assert attr(start, "aria-disabled") == "true"
        page.unroute("**/api/quotes")
        select(role(page, "combobox", "Delivery country"), "BE")
        settled(page, lambda: read(status(page, "Figures")).startswith("Total "), "the next good answer clears the state")
        settled(page, lambda: "quoted" in rail_words(page) and enabled(start), "the next good answer reopens checkout")


def test_configurator_live_vat_oracle(app_url: str, browser: Any) -> None:
    posted = is_status(post_json(app_url, "/api/quotes", kit("418-RTV", "DE", country="DE")), 200)
    assert posted["totalCents"] == 149500 and posted["vatCents"] == 23870 and posted["vatRatePct"] == 19
    assert [l["vatCents"] for l in posted["lines"]] == [6690, 10203, 5572, 782, 623]
    fitted = is_status(post_json(app_url, "/api/quotes", kit("418-RTV", "DE", fulfilment="workshop", country="DE")), 200)
    assert fitted["totalCents"] == 174500 and fitted["vatCents"] == 30285
    assert [l["vatCents"] for l in fitted["lines"]] == [7272, 11090, 6057, 850, 5016]
    for country, rate in [("NL", 21), ("BE", 21), ("DE", 19), ("LU", 17)]:
        quote = is_status(post_json(app_url, "/api/quotes", kit(country=country)), 200)
        for line in quote["lines"]:
            assert line["vatRatePct"] == rate and line["vatCents"] == vat_of(line["grossCents"], rate)
            assert line["netCents"] == line["grossCents"] - line["vatCents"]
        fit_quote = is_status(post_json(app_url, "/api/quotes", kit(fulfilment="workshop", country=country)), 200)
        assert {l["vatRatePct"] for l in fit_quote["lines"]} == {21}, "workshop fitting uses the NL rate"
    rider = register(app_url)
    bike = is_status(rider.post("/api/orders", {"kind": "bike", "bikeId": "BK-KADE-25", "plan": PLAN, "expectedTotalCents": 229800}), 201)
    assert [l["vatCents"] for l in bike["lines"]] == [vat_of(219900, 21), vat_of(9900, 21)]
    with open_app(browser, configure_url(app_url, plate="418-RTV", regCountry="DE", country="DE")) as page:
        page.set_viewport_size(DESKTOP)
        wait_text(page, status(page, "Figures"), "Total €1,495.00 quoted. VAT €238.70. Range 68 km.")
        assert {149500, 23870, 29900, 39867} <= set(rail_cents(page))
        check(radio(page, "Fulfilment", "Fitted at workshop"))
        wait_text(page, status(page, "Figures"), "Total €1,745.00 quoted. VAT €302.85. Range 68 km.")
        assert {174500, 30285} <= set(rail_cents(page))


def test_wf_configurator_live_share_and_back(app_url: str, browser: Any) -> None:
    with open_app(browser, configure_url(app_url)) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        first = read(status(page, "Figures"))
        select(role(page, "combobox", "Pack"), "P-2100 2100 Wh")
        settled(page, lambda: "pack=P-2100" in page.url and read(status(page, "Figures")).startswith("Total ") and read(status(page, "Figures")) != first, "pack change")
        second = read(status(page, "Figures"))
        select(role(page, "combobox", "Hub"), "H-1000 1.0 kW")
        check(radio(page, "Road class", "45 km/h"))
        settled(page, lambda: "class=45" in page.url and read(status(page, "Figures")).startswith("Total ") and read(status(page, "Figures")) != second, "class change")
        check(radio(page, "Units", "Imperial"))
        settled(page, lambda: "units=imperial" in page.url and read(status(page, "Figures")).startswith("Total "), "units change")
        posted = steady_figures(page)
        check(radio(page, "Fulfilment", "Fitted at workshop"))
        settled(page, lambda: "fulfilment=workshop" in page.url and read(status(page, "Figures")).startswith("Total ") and read(status(page, "Figures")) != posted, "fulfilment change")
        workshop = steady_figures(page)
        select(role(page, "combobox", "Delivery country"), "BE")
        settled(page, lambda: has_param(page.url, "country", "BE") and read(status(page, "Figures")).startswith("Total "), "country change")
        query = parse_qs(urlparse(page.url).query)
        assert query["plate"] == ["FGH-12-K"] and query["regCountry"] == ["NL"] and query["pack"] == ["P-2100"]
        assert query["hub"] == ["H-1000"] and query["class"] == ["45"]
        shared, figures = page.url, steady_figures(page)
        page.reload()
        wait_text(page, status(page, "Figures"), figures)
        assert radio(page, "Units", "Imperial").is_checked() and radio(page, "Road class", "45 km/h").is_checked()
        with open_app(browser, shared) as other:
            other.set_viewport_size(DESKTOP)
            wait_text(other, status(other, "Figures"), figures)
            assert radio(other, "Fulfilment", "Fitted at workshop").is_checked()
        page.go_back()
        settled(page, lambda: not has_param(page.url, "country", "BE") and "fulfilment=workshop" in page.url and read(status(page, "Figures")) == workshop,
                "back restores the earlier country and its figures")
        page.go_back()
        settled(page, lambda: "fulfilment=workshop" not in page.url and read(status(page, "Figures")) == posted,
                "back again restores the earlier fulfilment and its figures")
        page.go_forward()
        settled(page, lambda: "fulfilment=workshop" in page.url and read(status(page, "Figures")) == workshop,
                "forward restores the fulfilment and its figures")
        page.go_forward()
        wait_text(page, status(page, "Figures"), figures)
        assert has_param(page.url, "country", "BE")


def test_teardown_story_pixel_reassembly(app_url: str, browser: Any) -> None:
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        story = role(page, "region", "Teardown story")
        settled(page, lambda: attr(story, "data-story-progress") is not None, "region Teardown story should publish progress")
        scene = scene_of(page)
        story_progress_to(page, 0)
        advance(page, 1000)
        assert float(attr(story, "data-story-progress")) == 0 and attr(story, "data-story-stage") == "1"
        start_png = capture(scene)
        pins = []

        def check_at(target: float) -> dict:
            value = story_progress_to(page, target)
            advance(page, 100)
            value = float(attr(story, "data-story-progress"))
            near = abs(value * 6 - round(value * 6)) < 0.01
            allowed = {6 if value >= 1 else int(value * 6) + 1}
            if near:
                allowed |= {max(1, round(value * 6)), min(6, round(value * 6) + 1)}
            assert int(attr(story, "data-story-stage")) in allowed
            offsets = json.loads(attr(scene, "data-story-offsets"))
            for part, vector in expected_offsets(value).items():
                assert offsets[part] == pytest.approx(vector, abs=1.5), f"{part} at p={value}"
            return offsets

        forward = []
        for tick in range(0, 13):
            forward.append(check_at(tick / 12))
            if 2 <= tick <= 10:
                pins.append(scene.bounding_box()["y"])
            if tick % 2:
                caption = STORY_CAPTIONS[int(float(attr(story, "data-story-progress")) * 6)]
                assert page_says(page, caption), caption
        assert max(pins) - min(pins) <= 2, "the story stays pinned while scrubbing"
        for earlier, later_offsets in zip(forward, forward[1:]):
            for part in STORY_PARTS:
                assert max(map(abs, later_offsets[part])) >= max(map(abs, earlier[part])) - 1.5
        check_at(0.5)
        advance(page, 500)
        middle_png = capture(scene)
        assert 1 - fraction_within(start_png, middle_png, 0) >= STORY_DIFF_MIN, "p = 0.5 should differ in pixels"
        for tick in range(11, -1, -1):
            check_at(tick / 12)
        story_progress_to(page, 0)
        advance(page, 1000)
        offsets = json.loads(attr(scene, "data-story-offsets"))
        assert all(v == 0 for vector in offsets.values() for v in vector), "every offset back to exactly 0"
        assert fraction_within(start_png, capture(scene), STORY_LEVELS) >= STORY_MATCH_MIN, "pixels should reassemble"


def test_teardown_story_touch_axis_lock(app_url: str, browser: Any) -> None:
    with open_app(browser, f"{app_url}/") as story_page:
        story_page.set_viewport_size(DESKTOP)
        scene = scene_of(story_page)
        settled(story_page, lambda: scene.count() > 0, "the story holds the scene")
        tab_to(story_page, scene)
        azimuth = scene_angles(story_page)[0]
        story_page.keyboard.press("ArrowRight")
        advance(story_page, 100)
        assert abs(scene_angles(story_page)[0] - azimuth) == 15, "scene keys work on the story"
    with open_app(browser, configure_url(app_url)) as page:
        page.set_viewport_size({"width": 767, "height": 1024})
        figures_ready(page)
        advance(page, 300)
        assert role(page, "button", "Parts schedule").is_visible(), "767 px uses the one-column layout"
        page.set_viewport_size({"width": 768, "height": 1024})
        advance(page, 300)
        assert parts_list(page).is_visible() and role(page, "button", "Parts schedule").count() == 0, "768 px uses the two-column layout"
        page.set_viewport_size({"width": 1199, "height": 800})
        advance(page, 300)
        assert role(page, "region", "Price rail").bounding_box()["x"] < parts_list(page).bounding_box()["x"] + 1 or \
            role(page, "region", "Price rail").bounding_box()["y"] >= scene_of(page).bounding_box()["y"] + scene_of(page).bounding_box()["height"] - 1, "1199 px keeps the rail beneath"
        page.set_viewport_size({"width": 1200, "height": 800})
        advance(page, 300)
        assert parts_list(page).bounding_box()["x"] < role(page, "region", "Price rail").bounding_box()["x"], "1200 px uses three columns"
        page.set_viewport_size(PHONE)
        figures_ready(page)
        session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        scene = scene_of(page)
        scene.scroll_into_view_if_needed()
        advance(page, 100)
        box = scene.bounding_box()
        middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        azimuth, elevation, zoom = scene_angles(page)
        half = box["width"] / 2
        start = (box["x"] + box["width"] * 0.1, middle[1])
        swipe(page, start, steps(start, min(half, box["width"] * 0.8), 0))
        now = scene_angles(page)
        assert abs(now[0] - azimuth) == pytest.approx(90 * min(half, box["width"] * 0.8) / half, rel=0.3), "half the width turns about 90 degrees"
        assert now[1] == elevation and now[2] == zoom
        locked = scene_angles(page)
        moves = steps(middle, 30, 0, 3) + steps((middle[0] + 30, middle[1]), 0, 70, 7)
        swipe(page, middle, moves)
        assert scene_angles(page)[1] == locked[1], "a horizontal lock holds until the finger lifts"
        azimuth_before = scene_angles(page)
        scroll_before = page.evaluate("() => window.scrollY")
        low = (middle[0], box["y"] + box["height"] - 10)
        swipe(page, low, steps(low, 0, -200))
        settled(page, lambda: page.evaluate("() => window.scrollY") > scroll_before, "a vertical swipe should scroll the page", 5)
        assert scene_angles(page) == azimuth_before, "a vertical swipe changes neither azimuth nor elevation"
        page.evaluate("y => window.scrollTo(0, y)", scroll_before)
        advance(page, 100)
        before = scene_angles(page)
        moves = steps(low, 0, -40, 4) + steps((low[0], low[1] - 40), 100, 0, 6)
        swipe(page, low, moves)
        assert scene_angles(page) == before, "a vertical lock holds until the finger lifts"
        page.evaluate("y => window.scrollTo(0, y)", scroll_before)
        advance(page, 100)
        box = scene.bounding_box()
        middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        before = scene_angles(page)
        touch(page, "touchStart", [(middle[0] - 20, middle[1]), (middle[0] + 20, middle[1])])
        for gap in range(30, 100, 10):
            touch(page, "touchMove", [(middle[0] - gap, middle[1]), (middle[0] + gap, middle[1])])
        touch(page, "touchEnd", [])
        advance(page, 100)
        now = scene_angles(page)
        assert now[2] > before[2] and now[0] == before[0] and now[1] == before[1], "a pinch changes zoom only"

        select_part(page, "Traction pack", "traction-pack")
        region = clearance(page)
        scene.scroll_into_view_if_needed()
        advance(page, 100)
        box = scene.bounding_box()
        handle = role(page, "button", "Rail handle")
        hx, hy = center(handle)
        far = (box["x"] + 10 if hx > box["x"] + box["width"] / 2 else box["x"] + box["width"] - 60, box["y"] + 10)
        before = scene_angles(page)
        swipe(page, far, steps(far, 40, 0))
        assert attr(region, "data-travel-mm") == "0.0", "rail drag begins only on the handle"
        assert scene_angles(page)[0] != before[0], "off the handle a drag orbits"
        hx, hy = center(handle)
        touch(page, "touchStart", [(hx, hy)])
        direction = -1 if hx > box["x"] + box["width"] / 2 else 1
        for delta in (12, 24, 36):
            touch(page, "touchMove", [(hx + delta * direction, hy)])
        moved = float(attr(region, "data-travel-mm"))
        if moved == 0:
            for delta in (12, 24, 36):
                touch(page, "touchMove", [(hx - delta * direction, hy)])
            moved = float(attr(region, "data-travel-mm"))
        assert moved > 0, "dragging the handle drives the rail on touch"
        touch(page, "touchEnd", [])
        settled(page, lambda: attr(region, "data-travel-mm") == "0.0", "lifting short of contact springs back", 5)


def test_staged_checkout_cross_instance_one_transaction(killbill: Any) -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    rider = register(base)
    order = new_order(rider)
    oid = order["id"]
    missing = rider.post(f"/api/orders/{oid}/payments", {"stage": "deposit"})
    assert missing.status_code == 422 and missing.json() == {"errors": {"idempotencyKey": "Required."}}
    key = idempotency_key()
    refused(rider.post(f"/api/orders/{oid}/payments", {"stage": "instalment-1"}, key=key), 409, "illegal_transition")
    shops = [rider, rider.at(peer)] * 4
    answers = together([lambda s=s: s.post(f"/api/orders/{oid}/payments", {"stage": "deposit"}, key=key) for s in shops])
    assert {a.status_code for a in answers} == {202}, "the refused key stayed usable and every repeat gets the first answer"
    assert all(a.json() == answers[0].json() for a in answers), "concurrent repeats return the same body"
    assert answers[0].json()["state"] == "deposit pending" and stage_of(answers[0].json(), "deposit")["status"] == "pending"
    replay = rider.at(peer).post(f"/api/orders/{oid}/payments", {"stage": "deposit"}, key=key)
    assert replay.status_code == 202 and replay.json() == answers[0].json()
    refused(rider.post(f"/api/orders/{oid}/payments", {"stage": "instalment-1"}, key=key), 409, "idempotency_conflict")
    _, tx = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    assert tx["transactionType"] == "PURCHASE" and float(tx["amount"]) == stage_of(order, "deposit")["amountCents"] / 100
    assert kb_count(killbill, rider) == 1, "one key makes exactly one Kill Bill transaction"


def test_staged_checkout_donor_changed(app_url: str, wiremock: Any, killbill: Any) -> None:
    rider = register(app_url)
    order = new_order(rider, plate="LMN-31-K")
    path = "/v1/plates/LMN-31-K"
    true_read = {"plate": "LMN-31-K", "country": "NL", "model": "K50", "firstAdmissionYear": 2019, "roadClass": 25, "plateColour": "blue", "registeredMassKg": 110.0}
    for change in ({"model": "D50"}, {"firstAdmissionYear": 2021}, {"roadClass": 45}, {"plateColour": "yellow"}, {"registeredMassKg": 111.0}):
        wiremock.stub("GET", path, json={**true_read, **change})
        response, _ = pay(rider, order["id"], "deposit")
        refused(response, 409, "donor_changed")
    wiremock.stub("GET", path, status=404, json={"error": "plate_not_found"})
    response, _ = pay(rider, order["id"], "deposit")
    refused(response, 409, "donor_changed")
    assert kb_count(killbill, rider) == 0, "no gate refusal makes a Kill Bill call"
    assert rider.order(order["id"])["state"] == "quoted"
    wiremock.stub("GET", path, json=true_read)
    response, _ = pay(rider, order["id"], "deposit")
    assert is_status(response, 202)["state"] == "deposit pending"


def test_deposit_gate_order(browser: Any, killbill: Any) -> None:
    base, down = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_DOWN_URL")
    rider = register(base)
    hand = new_order(rider, {**kit(), "donor": manual_donor()})
    assert hand["donor"]["confirmed"] is False
    response, _ = pay(rider, hand["id"], "deposit")
    refused(response, 409, "donor_unconfirmed")
    failing_hand = new_order(rider, {**kit(pack="P-2100"), "donor": manual_donor(year=2021)})
    response, _ = pay(rider, failing_hand["id"], "deposit")
    refused(response, 409, "donor_unconfirmed")
    fouled = new_order(rider, plate="A-KLM-204", reg="BE", pack="P-2100")
    response, _ = pay(rider, fouled["id"], "deposit")
    refused(response, 409, "fit_not_passed")
    good = new_order(rider)
    poll(lambda: httpx.get(down + "/api/status", timeout=HTTP_TIMEOUT).json()["killbill"] == "down", "the Kill Bill down instance reports down")
    refused(rider.at(down).post(f"/api/orders/{good['id']}/payments", {"stage": "deposit"}, key=idempotency_key()), 503, "payments_paused")
    assert kb_count(killbill, rider) == 0
    bike = is_status(rider.post("/api/orders", {"kind": "bike", "bikeId": "BK-KADE-25", "plan": PLAN, "expectedTotalCents": 229800}), 201)
    response, _ = pay(rider, bike["id"], "deposit")
    is_status(response, 202)
    url = configure_url(base, plate="A-KLM-204", regCountry="BE", pack="P-2100")
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(url)
        figures_ready(page)
        drive_both(page)
        dialog = open_checkout(page)
        pay_button = to_deposit_step(page, dialog)
        settled(page, lambda: attr(pay_button, "aria-disabled") == "true", "Pay deposit should be disabled on a failing fit")
        assert page_says(page, "Fit not proven. No deposit can be taken.")
        page.goto(configure_url(base, plate="", regCountry="NL", manual=1, model="K50", year=2019, regClass=25, colour="blue", mass="110.0"))
        figures_ready(page)
        drive_both(page)
        dialog = open_checkout(page)
        pay_button = to_deposit_step(page, dialog)
        settled(page, lambda: attr(pay_button, "aria-disabled") == "true", "Pay deposit should be disabled on a hand donor")
        assert page_says(page, "Donor unconfirmed. No deposit can be taken.")


def test_keyboard_checkout_all_viewports(browser: Any, killbill: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    for viewport in (PHONE, TABLET, DESKTOP):
        rider = register(base)
        with open_app(browser, f"{base}/") as page:
            page.set_viewport_size(viewport)
            browser_sign_in(page, base, rider.email, rider.password)
            page.goto(configure_url(base))
            figures_ready(page)
            for name, part_id in (("Traction pack", "traction-pack"), ("Hub motor", "hub-motor")):
                if viewport["width"] < 768:
                    tab_to(page, role(page, "button", "Parts schedule"))
                    page.keyboard.press("Enter")
                    settled(page, lambda: role(page, "dialog", "Parts schedule").count() > 0, "sheet opens")
                    tab_to(page, parts_list(page), 20)
                else:
                    tab_to(page, parts_list(page))
                page.keyboard.press("Home")
                for _ in range(len(PART_NAMES)):
                    if has_focus(part_row(page, name)):
                        break
                    page.keyboard.press("ArrowDown")
                    advance(page, 20)
                page.keyboard.press("Enter")
                settled(page, lambda: attr(clearance(page), "data-part") == part_id, f"{name} selected by keyboard")
                advance(page, FLIGHT_MS * 1.25)
                if not has_focus(slider(page)):
                    tab_to(page, slider(page))
                page.keyboard.press("End")
                settled(page, lambda: at_stop(page), f"{name} driven by keyboard")
            start = role(page, "button", "Start checkout")
            settled(page, lambda: enabled(start), "both rails driven")
            tab_to(page, start)
            page.keyboard.press("Enter")
            dialog = role(page, "dialog", "Checkout")
            settled(page, lambda: dialog.count() > 0 and has_focus(dialog), "dialog Checkout takes focus")
            for _ in range(20):
                page.keyboard.press("Tab")
                assert has_focus(dialog), "Tab stays inside the dialog"
            for _ in range(5):
                page.keyboard.press("Shift+Tab")
                assert has_focus(dialog), "Shift+Tab stays inside the dialog"
            page.keyboard.press("Escape")
            settled(page, lambda: dialog.count() == 0 and has_focus(start), "Escape closes and returns focus to the opener")
            page.keyboard.press("Enter")
            settled(page, lambda: dialog.count() > 0 and has_focus(dialog), "dialog reopens")
            for name, value in (("Name", PLAN["name"]), ("Street", PLAN["street"]), ("Postcode", PLAN["postcode"]), ("City", PLAN["city"])):
                tab_to(page, role(dialog, "textbox", name), 12)
                page.keyboard.type(value)
            tab_to(page, role(dialog, "button", "Next"), 12)
            page.keyboard.press("Enter")
            settled(page, lambda: role(dialog, "textbox", "Name").count() == 0, "Enter activates Next")
            tab_to(page, role(dialog, "button", "Back"), 12)
            page.keyboard.press("Enter")
            settled(page, lambda: role(dialog, "textbox", "Name").count() > 0, "Back returns to Delivery")
            assert role(dialog, "textbox", "Name").input_value() == PLAN["name"], "Back keeps entered values"
            tab_to(page, role(dialog, "button", "Next"), 12)
            page.keyboard.press("Enter")
            settled(page, lambda: role(dialog, "textbox", "Name").count() == 0, "Schedule step")
            advance(page, PANEL_MS)
            tab_to(page, role(dialog, "button", "Next"), 12)
            page.keyboard.press("Enter")
            pay_button = role(dialog, "button", "Pay deposit")
            settled(page, lambda: pay_button.count() > 0, "Deposit step")
            advance(page, PANEL_MS)
            tab_to(page, pay_button, 12)
            settled(page, lambda: enabled(pay_button), "Pay deposit should be open")
            page.keyboard.press("Enter")
            oid = landed_on_order(page)
            order = rider.order(oid)
            assert stage_of(order, "deposit")["status"] == "pending"
            assert kb_count(killbill, rider) == 1, "one press makes one purchase"
            layout(page)


def test_staged_checkout_focus_survives_outage(relay_shop: tuple[str, HttpRelay], browser: Any, killbill: Any) -> None:
    base, relay = relay_shop
    rider = register(base)
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(configure_url(base))
        figures_ready(page)
        drive_both(page)
        dialog = open_checkout(page)
        pay_button = to_deposit_step(page, dialog)
        settled(page, lambda: enabled(pay_button), "Pay deposit should be open with Kill Bill up")
        pay_button.focus()
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if r.method == "POST" and "/api/orders" in r.url else None)
        relay.down = True
        wait_contains(page, role(page, "alert", "Provider outage"), KB_BANNER, BANNER_S + SLACK_S)
        settled(page, lambda: attr(pay_button, "aria-disabled") == "true", "Pay deposit should disable during the outage", BANNER_S)
        assert has_focus(pay_button), "focus stays on the disabled control"
        page.keyboard.press("Enter")
        advance(page, 500)
        assert not sent, "a disabled Pay deposit sends nothing"
        assert dialog.count() == 1
        relay.down = False
        settled(page, lambda: enabled(pay_button), "Pay deposit should reopen when Kill Bill returns", BANNER_S + SLACK_S)
        assert has_focus(pay_button)
        page.keyboard.press("Enter")
        oid = landed_on_order(page)
        assert rider.order(oid)["plan"]["city"] == PLAN["city"], "entries survived the outage"
        assert kb_count(killbill, rider) == 1


def test_wf_staged_checkout_deposit_landing(app_url: str, browser: Any, mail: Any, killbill: Any) -> None:
    rider = register(app_url)
    secret = notification_secret(app_url, "")
    keys: list[str] = []
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key", "")) if r.method == "POST" and r.url.endswith("/payments") else None)
        browser_sign_in(page, app_url, rider.email, rider.password)
        page.goto(configure_url(app_url))
        figures_ready(page)
        drive_both(page)
        dialog = open_checkout(page)
        pay_button = to_deposit_step(page, dialog)
        settled(page, lambda: enabled(pay_button), "Pay deposit should be open")
        click(pay_button)
        oid = landed_on_order(page)
        assert urlparse(page.url).path == f"/orders/{oid}"
        order_state = status(page, "Order state")
        settled(page, lambda: read(order_state) in ("deposit pending", "deposit confirmed"), "Order state should read the deposit state")
        payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{keys[-1]}")
        is_status(deliver(app_url, secret, payment), 200)
        wait_text(page, order_state, "deposit confirmed")
        wait_text(page, status(page, "Payment status"), "Deposit paid.")
        assert role(page, "table", "Kit lines").count() == 1 and role(page, "table", "Payment schedule").count() == 1
        page.reload()
        wait_text(page, status(page, "Order state"), "deposit confirmed")
        assert urlparse(page.url).path == f"/orders/{oid}"
        order = rider.order(oid)
        number = order["number"]
        assert re.fullmatch(r"OM-\d{5}", number)
        mails_to(mail, rider.email, 1, f"VAT receipt: Deposit for order {number}")
        pay_next = role(page, "button", "Pay Instalment 1")
        settled(page, lambda: enabled(pay_next), "the next stage should be payable")
        click(pay_next)
        settled(page, lambda: len(keys) == 2, "Pay Instalment 1 should send its payment")
        payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{keys[-1]}")
        is_status(deliver(app_url, secret, payment), 200)
        wait_text(page, status(page, "Payment status"), "Instalment 1 paid.")
        assert read(status(page, "Order state")) == "instalments running"
        assert len(mails_to(mail, rider.email, 1, f"VAT receipt: Instalment 1 for order {number}")) == 1
        assert len(mails_to(mail, rider.email, 1, f"VAT receipt: Deposit for order {number}")) == 1
        assert kb_count(killbill, rider) == 2
        with open_app(browser, f"{app_url}/") as other:
            other.set_viewport_size(DESKTOP)
            browser_sign_in(other, app_url, rider.email, rider.password)
            other.goto(f"{app_url}/orders/{oid}")
            wait_text(other, status(other, "Order state"), "instalments running")


def test_callback_registration_retries(killbill: Any) -> None:
    relay = HttpRelay(os.environ["KILLBILL_URL"])
    relay.down = True
    origin = f"http://127.0.0.1:{free_port()}"
    db = os.environ["DATABASE_URL"] + "_manual"
    port = free_port()
    posts = lambda: [entry for entry in relay.log if entry[1] == "POST" and "registerNotificationCallback" in entry[2]]
    try:
        with app_copy(port=port, KILLBILL_URL=relay.url, KILLBILL_CALLBACK_ORIGIN=origin, DATABASE_URL=db) as base:
            poll(lambda: httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT).json()["killbill"] == "down",
                 "status should report Kill Bill down", BANNER_S + SLACK_S)
            assert not posts()
            relay.down = False
            poll(posts, "the shop should register its callback once Kill Bill answers", BANNER_S + POLL_S)
            registered = parse_qs(urlparse(posts()[0][2]).query)["cb"][0]
            own = [url for url in registered.split(",") if url.startswith(f"{origin}/api/killbill/notifications/")]
            assert len(own) == 1, f"this instance's URL should be registered once: {registered}"
            secret = own[0].rsplit("/", 1)[1]
            assert len(secret) >= SECRET_MIN
            assert post_json(base, f"/api/killbill/notifications/{secret}", {"objectType": "INVOICE", "objectId": str(uuid.uuid4())}).status_code == 200
            assert post_json(base, f"/api/killbill/notifications/{secret}x", {"objectType": "INVOICE"}).status_code == 404
            assert secret == notification_secret(env_url("APP_MANUAL_URL"), "_manual"), "one secret per database"
            poll(lambda: httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT).json()["killbill"] == "up", "status should report Kill Bill up")
        relay.log.clear()
        with app_copy(port=port, KILLBILL_URL=relay.url, KILLBILL_CALLBACK_ORIGIN=origin, DATABASE_URL=db):
            poll(lambda: [e for e in relay.log if e[1] == "GET" and "registerNotificationCallback" in e[2]], "a restart should read the tenant's callbacks")
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                assert not posts(), "a URL already registered must not be added again"
                pace.wait(POLL_PACE_S)
    finally:
        relay.stop()


def test_provider_notifications_forged_no_change(mail: Any, killbill: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider)
    response, key = pay(rider, order["id"], "deposit")
    is_status(response, 202)
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    wrong = deliver(base, "x" * SECRET_MIN, payment)
    refused(wrong, 404, "not_found")
    assert httpx.post(base + "/api/no-such-route-here", json={}, timeout=HTTP_TIMEOUT).json() == wrong.json()
    bad = httpx.post(f"{base}/api/killbill/notifications/{secret}", content=b"not json", headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    refused(bad, 400, "bad_notification")
    for body in ({"eventType": "PAYMENT_SUCCESS", "objectType": "PAYMENT", "objectId": str(uuid.uuid4()), "accountId": payment["accountId"], "metaData": ""},
                 {"eventType": "PAYMENT_SUCCESS", "objectType": "INVOICE", "objectId": payment["paymentId"], "accountId": payment["accountId"], "metaData": ""}):
        answer = post_json(base, f"/api/killbill/notifications/{secret}", body)
        assert answer.status_code == 200 and answer.json() == {"status": "ok"}
    after = rider.order(order["id"])
    assert after["state"] == "deposit pending" and stage_of(after, "deposit")["status"] == "pending"
    assert mails_to(mail, rider.email) == [], "a forged delivery sends nothing"
    is_status(deliver(base, secret, payment), 200)
    wait_order(rider, order["id"], lambda o: o["state"] == "deposit confirmed", "the genuine delivery is still believed")


def test_notification_reread_decides(relay_shop: tuple[str, HttpRelay], killbill: Any, mail: Any) -> None:
    base, relay = relay_shop
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider)
    oid = order["id"]
    response, key = pay(rider, oid, "deposit")
    is_status(response, 202)
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    for rewrite in (patch_read("PENDING"), patch_read("UNKNOWN"), patch_read(amount_delta=1)):
        relay.rewrite = rewrite
        is_status(deliver(base, secret, payment), 200)
        assert stage_of(rider.order(oid), "deposit")["status"] == "pending", "this re-read must change nothing"
    relay.rewrite = None
    relay.down = True
    refused(deliver(base, secret, payment), 503, "provider_unreachable")
    relay.down = False
    poll(lambda: httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT).json()["killbill"] == "up", "status should report Kill Bill up again")
    assert stage_of(rider.order(oid), "deposit")["status"] == "pending"
    relay.rewrite = patch_read("PAYMENT_FAILURE")
    is_status(deliver(base, secret, payment, "PAYMENT_SUCCESS"), 200)
    failed = wait_order(rider, oid, lambda o: stage_of(o, "deposit")["status"] == "failed", "a failure in the re-read fails the stage despite eventType")
    assert failed["state"] == "deposit pending"
    relay.rewrite = None
    assert mails_to(mail, rider.email) == []
    response, key = pay(rider, oid, "deposit")
    is_status(response, 202)
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    is_status(deliver(base, secret, payment, "PAYMENT_FAILED"), 200)
    wait_order(rider, oid, lambda o: stage_of(o, "deposit")["status"] == "paid", "a SUCCESS re-read confirms despite eventType")


def test_provider_notifications_concurrent_across_instances(mail: Any, killbill: Any) -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider)
    response, key = pay(rider, order["id"], "deposit")
    is_status(response, 202)
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    answers = together([lambda b=b: deliver(b, secret, payment) for b in [base, peer] * 5])
    assert {a.status_code for a in answers} == {200}
    done = wait_order(rider, order["id"], lambda o: o["state"] == "deposit confirmed", "the deposit is confirmed")
    confirmed_at = stage_of(done, "deposit")["confirmedAt"]
    is_status(deliver(peer, secret, payment), 200)
    again = rider.order(order["id"])
    assert stage_of(again, "deposit")["confirmedAt"] == confirmed_at and again["state"] == "deposit confirmed"
    assert len(mails_to(mail, rider.email, 1, "VAT receipt: Deposit")) == 1, "one receipt across instances"
    assert kb_count(killbill, rider) == 1


def test_provider_notifications_failure_after_success(mail: Any, killbill: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider)
    pay_confirmed(rider, killbill, secret, order["id"], "deposit")
    response, key = pay(rider, order["id"], "instalment-1")
    is_status(response, 202)
    deposit_payment = next(p for p, t in kb_all(killbill, rider) if not t["transactionExternalKey"].endswith(key))
    is_status(deliver(base, secret, deposit_payment, "PAYMENT_FAILED"), 200)
    state = rider.order(order["id"])
    assert stage_of(state, "deposit")["status"] == "paid", "the re-read decides, so the success stands"
    assert stage_of(state, "instalment-1")["status"] == "pending", "a delivery about the deposit does not touch the instalment"
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    is_status(deliver(base, secret, payment), 200)
    wait_order(rider, order["id"], lambda o: stage_of(o, "instalment-1")["status"] == "paid", "instalment confirmed")
    is_status(deliver(base, secret, payment, "PAYMENT_FAILED"), 200)
    assert stage_of(rider.order(order["id"]), "instalment-1")["status"] == "paid"
    assert len(mails_to(mail, rider.email, 2, "VAT receipt:")) == 2, "one receipt per stage"


def test_pending_until_confirmed(browser: Any, killbill: Any, mail: Any) -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider)
    oid = order["id"]
    response, key = pay(rider, oid, "deposit")
    is_status(response, 202)
    payment, tx = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    assert tx["status"] == "SUCCESS", "Kill Bill already holds the success"
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(f"{base}/orders/{oid}")
        wait_text(page, status(page, "Order state"), "deposit pending")
        schedule = role(page, "table", "Payment schedule")
        settled(page, lambda: "pending" in read(schedule), "the schedule prints pending")

        def still_pending() -> bool:
            return (read(status(page, "Order state")) == "deposit pending"
                    and stage_of(rider.order(oid), "deposit")["status"] == "pending"
                    and stage_of(rider.at(peer).order(oid), "deposit")["status"] == "pending"
                    and "paid" not in read(status(page, "Payment status")))

        stays(page, still_pending, "a payment must read pending until a believed notification", 8)
        assert mails_to(mail, rider.email) == [], "no receipt before confirmation"
        is_status(deliver(base, secret, payment), 200)
        wait_text(page, status(page, "Payment status"), "Deposit paid.")
        wait_text(page, status(page, "Order state"), "deposit confirmed")


def test_receipt_once_with_vat_split(mail: Any, killbill: Any) -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    number = order["number"]
    response, key = pay(rider, order["id"], "deposit")
    is_status(response, 202)
    assert mails_to(mail, rider.email) == []
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    is_status(deliver(base, secret, payment), 200)
    is_status(deliver(peer, secret, payment), 200)
    subject = f"VAT receipt: Deposit for order {number}"
    messages = mails_to(mail, rider.email, 1, subject)
    assert len(messages) == 1 and messages[0]["Subject"] == subject
    assert mail_from_address() in addresses(messages[0].get("From"))
    body = text(messages[0])
    for cents in (29900, 4774, 29900 - 4774, 8380, 12780, 6980, 980, 780):
        assert re.search(re.escape(money(cents)) + r"\W*paid", body), f"{money(cents)} should carry paid in the receipt"
    pay_confirmed(rider, killbill, secret, order["id"], "instalment-1")
    assert len(mails_to(mail, rider.email, 1, f"VAT receipt: Instalment 1 for order {number}")) == 1
    assert len(mails_to(mail, rider.email, 2, "VAT receipt:")) == 2


def test_payment_schedule_oracle(app_url: str) -> None:
    example = is_status(post_json(app_url, "/api/quotes", kit("418-RTV", "DE", country="DE")), 200)
    assert [s["amountCents"] for s in example["schedule"]] == [29900, 39867, 39867, 39866]
    assert [s["label"] for s in example["schedule"]] == ["Deposit", "Instalment 1", "Instalment 2", "Instalment 3"]
    for config in (kit(), kit(pack="P-2100"), kit(road=45), kit(fulfilment="workshop"), kit("A-KLM-204", "BE", pack="P-1100", country="LU")):
        quote = is_status(post_json(app_url, "/api/quotes", config), 200)
        amounts = [s["amountCents"] for s in quote["schedule"]]
        assert amounts == spread(quote["totalCents"]) and sum(amounts) == quote["totalCents"]
    rider = register(app_url)
    bike = is_status(rider.post("/api/orders", {"kind": "bike", "bikeId": "BK-DIJK-45", "plan": PLAN, "expectedTotalCents": 344800}), 201)
    assert [s["amountCents"] for s in bike["schedule"]] == spread(344800)


def test_instalment_plan_allocation_oracle(app_url: str) -> None:
    rider = register(app_url)
    example = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    assert [a["grossCents"] for a in stage_of(example, "deposit")["allocations"]] == [8380, 12780, 6980, 980, 780]
    assert [a["grossCents"] for a in stage_of(example, "instalment-1")["allocations"]] == [11173, 17040, 9307, 1307, 1040]
    assert [a["vatCents"] for a in stage_of(example, "deposit")["allocations"]] == [1338, 2041, 1114, 156, 125]
    for options in (dict(plate="418-RTV", reg="DE", country="DE"), dict(road=45), dict(pack="P-1100", country="LU"), dict(fulfilment="workshop", country="BE")):
        order = new_order(rider, **options)
        total = order["totalCents"]
        grosses = [l["grossCents"] for l in order["lines"]]
        rates = [l["vatRatePct"] for l in order["lines"]]
        left_gross, left_vat = list(grosses), [l["vatCents"] for l in order["lines"]]
        for index, name in enumerate(STAGES):
            stage = stage_of(order, name)
            parts = {a["lineId"]: a for a in stage["allocations"]}
            wanted = allocate(stage["amountCents"], grosses, total) if index < 3 else list(left_gross)
            vat_sum = 0
            for i, line in enumerate(order["lines"]):
                part = parts[line["id"]]
                vat = vat_of(wanted[i], rates[i]) if index < 3 else left_vat[i]
                assert part["grossCents"] == wanted[i], f"{name} {line['code']} gross"
                assert part["vatCents"] == vat, f"{name} {line['code']} VAT"
                assert part["netCents"] == wanted[i] - vat
                left_gross[i] -= wanted[i]
                left_vat[i] -= vat
                vat_sum += vat
            assert sum(p["grossCents"] for p in parts.values()) == stage["amountCents"]
            assert stage["vatCents"] == vat_sum
        assert not any(left_gross) and not any(left_vat), "each line's allocations sum exactly to its gross and VAT"


def test_paying_by_stage_refusals(killbill: Any) -> None:
    base, down = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_DOWN_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    order = new_order(rider)
    oid = order["id"]

    def attempt(name: str, shop: Shop = rider) -> httpx.Response:
        return shop.post(f"/api/orders/{oid}/payments", {"stage": name}, key=idempotency_key())

    refused(attempt("instalment-1"), 409, "illegal_transition")
    first = attempt("deposit")
    assert is_status(first, 202)["state"] == "deposit pending"
    refused(attempt("deposit"), 409, "payment_in_flight")
    refused(attempt("instalment-1"), 409, "stage_out_of_order")
    refused(attempt("deposit", rider.at(down)), 409, "payment_in_flight")
    assert kb_count(killbill, rider) == 1
    payment = poll(lambda: next((p for p, _ in kb_all(killbill, rider)), None), "the deposit purchase")
    is_status(deliver(base, secret, payment), 200)
    wait_order(rider, oid, lambda o: o["state"] == "deposit confirmed", "deposit confirmed")
    refused(attempt("deposit"), 409, "stage_already_paid")
    refused(attempt("deposit", rider.at(down)), 409, "stage_already_paid")
    refused(attempt("instalment-2"), 409, "stage_out_of_order")
    done = pay_confirmed(rider, killbill, secret, oid, "instalment-1")
    assert done["state"] == "instalments running"
    is_status(refund_line(desk, oid, line_of(done, "P-1500")["id"], 100), 202)
    refused(attempt("instalment-2"), 409, "refund_in_flight")
    assert kb_count(killbill, rider) == 2, "refusals make no purchase"


def test_instalment_plan_panel_survives_poll(app_url: str, browser: Any) -> None:
    rider = register(app_url)
    desk = fitter(app_url)
    order = new_order(rider)
    slot = open_slot(desk, later(app_url, 3))
    is_status(rider.post("/api/test-rides/holds", {"slotId": slot["id"]}), 201)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, app_url, rider.email, rider.password)
        page.goto(f"{app_url}/orders/{order['id']}")
        toggle = role(page, "button", "Payment plan")
        settled(page, lambda: toggle.count() > 0, "button Payment plan should show")
        click(toggle)
        panel = role(page, "region", "Payment plan")
        settled(page, lambda: panel.count() > 0 and attr(toggle, "aria-expanded") == "true", "the plan panel should open")
        fill(role(panel, "textbox", "City"), TYPED_CITY)
        note = role(panel, "textbox", "Note to workshop")
        fill(note, TYPED_NOTE)
        note.focus()
        timer = role(page, "timer", "Hold countdown")
        settled(page, lambda: re.fullmatch(r"Hold ends in \d+:\d\d", read(timer)), "the countdown should tick")
        ticks = {read(timer)}
        for _ in range(16):
            advance(page, 500)
            ticks.add(read(timer))
            assert attr(toggle, "aria-expanded") == "true" and panel.count() == 1, "the panel stays open"
            assert has_focus(note), "focus stays in the note"
            assert note.input_value() == TYPED_NOTE and role(panel, "textbox", "City").input_value() == TYPED_CITY
        assert len(ticks) > 1, "the countdown should have ticked meanwhile"
        click(role(panel, "button", "Save plan"))
        wait_text(page, status(page, "Plan status"), "Plan saved.")
    saved = rider.order(order["id"])
    assert saved["plan"]["city"] == TYPED_CITY and saved["plan"]["note"] == TYPED_NOTE and saved["planVersion"] == 2


def test_instalment_plan_stale_412(app_url: str, browser: Any) -> None:
    rider = register(app_url)
    order = new_order(rider)
    path = f"/api/orders/{order['id']}"
    assert order["planVersion"] == 1
    assert is_status(rider.patch(path, {"planVersion": 1, "plan": {**PLAN, "city": SAVED_CITY}}), 200)["planVersion"] == 2
    refused(rider.patch(path, {"planVersion": 1, "plan": {**PLAN, "city": "Gouda"}}), 412, "stale_version")
    assert rider.order(order["id"])["plan"]["city"] == SAVED_CITY
    race = together([lambda c=c: rider.patch(path, {"planVersion": 2, "plan": {**PLAN, "city": c}}) for c in ("Breda", "Assen", "Zwolle", "Emmen")])
    assert sorted(r.status_code for r in race) == [200, 412, 412, 412], "exactly one save of a version wins"
    long_note = rider.patch(path, {"planVersion": 3, "plan": {**PLAN, "note": "n" * 501}})
    assert long_note.status_code == 422 and long_note.json()["errors"]["note"] == "Keep the note to 500 characters."
    is_status(rider.patch(path, {"planVersion": 3, "plan": {**PLAN, "note": "n" * 500}}), 200)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, app_url, rider.email, rider.password)
        page.goto(f"{app_url}{urlparse(path).path.replace('/api', '')}")
        toggle = role(page, "button", "Payment plan")
        settled(page, lambda: toggle.count() > 0, "button Payment plan should show")
        click(toggle)
        panel = role(page, "region", "Payment plan")
        settled(page, lambda: panel.count() > 0, "the plan panel should open")
        fill(role(panel, "textbox", "City"), DRAFT_CITY)
        is_status(rider.patch(path, {"planVersion": 4, "plan": PLAN}), 200)
        click(role(panel, "button", "Save plan"))
        wait_text(page, status(page, "Plan status"), PLAN_STALE)
        assert role(panel, "textbox", "City").input_value() == DRAFT_CITY, "the rider's entries are kept"
    assert rider.order(order["id"])["plan"]["city"] == PLAN["city"]


def test_collections_month_end_anchor(killbill: Any) -> None:
    base = env_url("APP_CLOCK_MONTH_END_URL")
    secret = notification_secret(base, "_monthend")
    rider = register(base)
    order = new_order(rider)
    pay_confirmed(rider, killbill, secret, order["id"], "deposit")
    done = wait_order(rider, order["id"], lambda o: o["state"] == "deposit confirmed", "a believed notification should confirm the deposit")
    assert [due_day(stage_of(done, s)["dueDate"]).isoformat() for s in STAGES[1:]] == ["2027-02-28", "2027-03-31", "2027-04-30"]
    assert kb_count(killbill, rider) == 1


def test_monthly_collection_without_client(killbill: Any, mail: Any) -> None:
    base = env_url("APP_FAST_MANUAL_URL")
    secret = notification_secret(base, "_fastmanual")
    rider = register(base)
    order = new_order(rider)
    done = pay_confirmed(rider, killbill, secret, order["id"], "deposit")
    due = stage_of(done, "instalment-1")
    payment, tx = kb_tx(killbill, rider, f"collect:{order['id']}:instalment-1:1", POLL_S)
    assert tx["transactionType"] == "PURCHASE" and float(tx["amount"]) == due["amountCents"] / 100
    assert shop_now(base).date() >= due_day(due["dueDate"]), "collection only once the due date has arrived"
    current = rider.order(order["id"])
    assert stage_of(current, "instalment-1")["status"] == "pending" and stage_of(current, "instalment-1")["attempts"] == 1
    assert current["state"] == "instalments running"
    is_status(deliver(base, secret, payment), 200)
    wait_order(rider, order["id"], lambda o: stage_of(o, "instalment-1")["status"] == "paid", "the collected stage is believed")
    assert len(mails_to(mail, rider.email, 1, f"VAT receipt: Instalment 1 for order {order['number']}")) == 1


def test_collections_deferred_not_counted(killbill: Any) -> None:
    base = env_url("APP_FAST_MANUAL_URL")
    secret = notification_secret(base, "_fastmanual")
    rider = register(base)
    desk = fitter(base)
    order = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    oid = order["id"]
    done = pay_confirmed(rider, killbill, secret, oid, "deposit")
    refund = is_status(refund_line(desk, oid, line_of(done, "P-1500")["id"], 1000), 202)["refunds"][0]
    due = due_day(stage_of(done, "instalment-1")["dueDate"])
    poll(lambda: shop_now(base).date() > due + timedelta(days=1), "the shop clock should pass the due date", POLL_S)
    waiting = stage_of(rider.order(oid), "instalment-1")
    assert waiting["attempts"] == 0 and waiting["status"] == "scheduled", "a pending refund defers the collection"
    key = f"collect:{oid}:instalment-1:1"
    assert not [t for _, t in kb_all(killbill, rider) if t.get("transactionExternalKey") == key]
    sent_refund = wait_order(rider, oid, lambda o: all(d["killbillPaymentId"] for d in o["refunds"][0]["draws"]),
                             "the draw should be sent to Kill Bill")["refunds"][0]
    settle_refund(base, secret, rider, killbill, oid)
    _, tx = kb_tx(killbill, rider, key, HOLD_LIMIT_S + SLACK_S)
    assert float(tx["amount"]) == 39867 / 100
    after = wait_order(rider, oid, lambda o: stage_of(o, "instalment-1")["attempts"] == 1, "the first attempt counts once")
    assert stage_of(after, "instalment-1")["status"] == "pending"


def test_collections_retries_and_arrears(killbill: Any) -> None:
    relay = HttpRelay(os.environ["KILLBILL_URL"])
    db = os.environ["DATABASE_URL"] + "_dst"
    try:
        with app_copy(KILLBILL_URL=relay.url, KILLBILL_CALLBACK_ORIGIN=DEAD_ORIGIN, DATABASE_URL=db,
                      SHOP_CLOCK_START="2027-05-03T09:00:00+02:00", SHOP_CLOCK_RATE=FAST_CLOCK_RATE) as base:
            secret = notification_secret(base, "_dst")
            rider = register(base)
            desk = fitter(base)
            order = new_order(rider)
            oid = order["id"]
            relay.refuse = lambda method, path, body: method == "POST" and path.split("?")[0].endswith("/payments") and "collect:" in body
            pay_confirmed(rider, killbill, secret, oid, "deposit")
            arrears = wait_order(rider, oid, lambda o: o["state"] == "in arrears", "three refused collections should move the order into arrears", POLL_S + 30)
            stage = stage_of(arrears, "instalment-1")
            assert stage["status"] == "overdue" and stage["attempts"] == 3
            times = {}
            for moment, method, path, body in relay.log:
                found = re.search(rf"collect:{re.escape(str(oid))}:instalment-1:(\d)", body)
                if method == "POST" and found:
                    times.setdefault(found.group(1), moment)
            assert sorted(times) == ["1", "2", "3"], f"attempt keys seen: {sorted(times)}"
            assert 1.5 <= times["2"] - times["1"] <= 5 and 1.5 <= times["3"] - times["2"] <= 5, "retries fall 3 and 6 shop days after due"
            refused(desk.post(f"/api/desk/orders/{oid}/transitions", {"to": "kit dispatched"}), 409, "in_arrears")
            relay.refuse = None
            paid = pay_confirmed(rider, killbill, secret, oid, "instalment-1")
            assert paid["state"] == "instalments running"
    finally:
        relay.stop()


def test_order_transitions(killbill: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    posted = new_order(rider)
    oid = posted["id"]
    move = lambda target, order_id=oid: desk.post(f"/api/desk/orders/{order_id}/transitions", {"to": target})
    refused(move("kit dispatched"), 409, "illegal_transition")
    refused(rider.post(f"/api/desk/orders/{oid}/transitions", {"to": "kit dispatched"}), 403, "forbidden")
    states = [posted["state"]]
    for name in STAGES:
        states.append(pay_confirmed(rider, killbill, secret, oid, name)["state"])
    assert states == ["quoted", "deposit confirmed", "instalments running", "instalments running", "paid in full"]
    refused(desk.post(f"/api/desk/orders/{oid}/delivered", {"deliveredOn": shop_now(base).date().isoformat()}), 409, "illegal_transition")
    refused(move("fitted"), 409, "illegal_transition")
    assert is_status(move("kit dispatched"), 200)["state"] == "kit dispatched"
    refused(move("kit dispatched"), 409, "illegal_transition")
    refused(desk.post(f"/api/desk/orders/{oid}/inspection"), 409, "illegal_transition")
    delivered = lambda value: desk.post(f"/api/desk/orders/{oid}/delivered", {"deliveredOn": value})
    future = delivered((shop_now(base).date() + timedelta(days=2)).isoformat())
    assert future.status_code == 422 and future.json()["errors"]["deliveredOn"] == "The delivery date cannot be in the future."
    malformed = delivered("07-12-2026")
    assert malformed.status_code == 422 and malformed.json()["errors"]["deliveredOn"] == "Enter a date as YYYY-MM-DD."
    today = shop_now(base).date().isoformat()
    assert is_status(delivered(today), 200)["withdrawalDeadline"]
    refused(delivered(today), 409, "illegal_transition")
    fitted = new_order(rider, fulfilment="workshop")
    pay_all(rider, killbill, secret, fitted["id"])
    refused(move("kit dispatched", fitted["id"]), 409, "illegal_transition")
    assert is_status(move("fitted", fitted["id"]), 200)["state"] == "fitted"
    refused(rider.post(f"/api/orders/{fitted['id']}/withdraw", {}, key=idempotency_key()), 409, "illegal_transition")
    quoted = new_order(rider)
    assert is_status(rider.post(f"/api/orders/{quoted['id']}/withdraw", {}, key=idempotency_key()), 200)["state"] == "withdrawn"
    refused(move("kit dispatched", quoted["id"]), 409, "illegal_transition")


def test_collections_rollover_deadline(browser: Any, killbill: Any) -> None:
    base = env_url("APP_FAST_MANUAL_URL")
    secret = notification_secret(base, "_fastmanual")
    desk = fitter(base)
    poll(lambda: shop_now(base).date() > date(2027, 3, 31), "the fast clock should pass the published examples", 150)
    rider = register(base)

    def dispatched(country: str) -> dict:
        order = new_order(rider, country=country)
        pay_all(rider, killbill, secret, order["id"])
        is_status(desk.post(f"/api/desk/orders/{order['id']}/transitions", {"to": "kit dispatched"}), 200)
        return order

    closed = None
    for delivered_on, country, deadline in [("2026-12-07", "NL", "2026-12-21T23:59:00+01:00"), ("2026-12-11", "NL", "2026-12-28T23:59:00+01:00"),
                                            ("2027-03-12", "DE", "2027-03-30T23:59:00+02:00"), ("2027-03-12", "NL", "2027-03-26T23:59:00+01:00")]:
        closed = dispatched(country)
        marked = is_status(desk.post(f"/api/desk/orders/{closed['id']}/delivered", {"deliveredOn": delivered_on}), 200)
        assert marked["withdrawalDeadline"] == deadline and marked["withdrawalOpen"] is False
    refused(rider.post(f"/api/orders/{closed['id']}/withdraw", {}, key=idempotency_key()), 409, "withdrawal_closed")
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        page.clock.set_system_time("2026-12-08T09:00:00+01:00")
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(f"{base}/orders/{closed['id']}")
        settled(page, lambda: read(status(page, "Order state")) == "kit dispatched", "the order page should load")
        advance(page, 1000)
        assert role(page, "button", "Withdraw").count() == 0, "the screen follows withdrawalOpen, not the device clock"
    opened = dispatched("NL")
    today = shop_now(base).date().isoformat()
    marked = is_status(desk.post(f"/api/desk/orders/{opened['id']}/delivered", {"deliveredOn": today}), 200)
    assert marked["withdrawalOpen"] is True
    taken = is_status(rider.post(f"/api/orders/{opened['id']}/withdraw", {}, key=idempotency_key()), 200)
    assert taken["state"] == "withdrawn" and {r["status"] for r in taken["refunds"]} == {"pending"}


def test_withdrawal_refunds_through_kill_bill(browser: Any, killbill: Any, mail: Any) -> None:
    base, down = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_DOWN_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider)
    oid = order["id"]
    response, key = pay(rider, oid, "deposit")
    is_status(response, 202)
    refused(rider.post(f"/api/orders/{oid}/withdraw", {}, key=idempotency_key()), 409, "payment_in_flight")
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    is_status(deliver(base, secret, payment), 200)
    done = wait_order(rider, oid, lambda o: o["state"] == "deposit confirmed", "deposit confirmed")
    assert done["withdrawalOpen"] is True
    refused(rider.at(down).post(f"/api/orders/{oid}/withdraw", {}, key=idempotency_key()), 503, "payments_paused")
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(f"{base}/orders/{oid}")
        button = role(page, "button", "Withdraw")
        settled(page, lambda: enabled(button), "button Withdraw should be open")
        click(button)
        wait_text(page, status(page, "Payment status"), "Order withdrawn.")
        wait_text(page, status(page, "Order state"), "withdrawn")
        settled(page, lambda: button.count() == 0 and has_focus(status(page, "Payment status")), "focus moves to Payment status when Withdraw vanishes")
    taken = rider.order(oid)
    assert taken["withdrawalOpen"] is False and {r["status"] for r in taken["refunds"]} == {"pending"}
    assert sum(r["amountCents"] for r in taken["refunds"]) == stage_of(done, "deposit")["amountCents"]
    assert len({r["lineId"] for r in taken["refunds"]}) == len(taken["refunds"]) == len(taken["lines"])
    refunds = kb_refunds(killbill, rider, len(taken["refunds"]))
    assert round(sum(float(t["amount"]) for t in refunds) * 100) == stage_of(done, "deposit")["amountCents"]
    assert mails_to(mail, rider.email, 0, "Credit note") == [], "no credit note before the provider confirms"
    settle_refund(base, secret, rider, killbill, oid)
    settled_order = wait_order(rider, oid, lambda o: {r["status"] for r in o["refunds"]} == {"returned"}, "every refund should read returned")
    assert settled_order["state"] == "withdrawn"
    assert len(mails_to(mail, rider.email, len(taken["refunds"]), "Credit note")) == len(taken["refunds"])
    refused(rider.post(f"/api/orders/{oid}/withdraw", {}, key=idempotency_key()), 409, "illegal_transition")
    empty = new_order(rider)
    assert is_status(rider.at(down).post(f"/api/orders/{empty['id']}/withdraw", {}, key=idempotency_key()), 200)["state"] == "withdrawn"


def two_payments(rider: Shop, killbill: Any, secret: str) -> dict:
    order = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    pay_confirmed(rider, killbill, secret, order["id"], "deposit")
    return pay_confirmed(rider, killbill, secret, order["id"], "instalment-1")


def test_partial_refunds_mixed_draw_outcome(relay_shop: tuple[str, HttpRelay], killbill: Any, mail: Any) -> None:
    base, relay = relay_shop
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    order = two_payments(rider, killbill, secret)
    oid = order["id"]
    pack = line_of(order, "P-1500")
    latest_share, earlier_share = 17040, 12780
    returned = earlier_share // 4
    ask = latest_share + returned
    assert pack["collectedCents"] == earlier_share + latest_share
    latest = next(p["killbillPaymentId"] for p in is_status(desk.get(f"/api/desk/orders/{oid}"), 200)["payments"] if p["stage"] == "instalment-1")
    relay.refuse = lambda method, path, body: method == "POST" and f"/payments/{latest}/refunds" in path
    sent = is_status(refund_line(desk, oid, pack["id"], ask), 202)
    refund = sent["refunds"][0]
    assert refund["status"] == "pending"
    by_stage = {d["stage"]: d for d in refund["draws"]}
    assert by_stage["instalment-1"]["amountCents"] == latest_share and by_stage["deposit"]["amountCents"] == returned, "latest payment is drawn first"
    polled = wait_order(
        rider, oid,
        lambda o: {d["stage"]: d["status"] for d in o["refunds"][0]["draws"]} == {"instalment-1": "failed", "deposit": "pending"}
        and all(d["killbillPaymentId"] for d in o["refunds"][0]["draws"] if d["stage"] == "deposit"),
        "the refused draw should read failed and the other pending")
    relay.refuse = None
    kb_refunds(killbill, rider, 1)
    by_stage = {d["stage"]: d for d in polled["refunds"][0]["draws"]}
    held = rider.order(oid)
    assert held["partlyRefunded"] is False and line_of(held, "P-1500")["grossCents"] == 63900
    assert mails_to(mail, rider.email, 0, "Credit note") == [], "no credit note while a draw is pending"
    is_status(deliver(base, secret, {"paymentId": by_stage["deposit"]["killbillPaymentId"]}), 200)
    done = wait_order(rider, oid, lambda o: o["refunds"][0]["status"] == "partly returned", "the refund should read partly returned")
    final = done["refunds"][0]
    vat = vat_of(returned, 19)
    assert final["returnedCents"] == returned and final["failedCents"] == latest_share and final["vatCents"] == vat
    line = line_of(done, "P-1500")
    assert line["grossCents"] == 63900 - returned and line["vatCents"] == 10203 - vat
    assert line["refundedCents"] == returned and line["collectedCents"] == earlier_share + latest_share - returned
    assert done["partlyRefunded"] is True and done["totalCents"] == 149500 - returned
    messages = mails_to(mail, rider.email, 1, f"Credit note for order {order['number']}: {money(returned)}")
    assert len(messages) == 1 and re.search(re.escape(money(returned)) + r"\W*returned", text(messages[0]))
    assert len(mails_to(mail, rider.email, 0, "Credit note")) == 1
    assert sum(s["amountCents"] for s in done["schedule"]) == done["totalCents"] + returned, "confirmed stages stay; the unpaid balance keeps its size"
    rest = refund_line(desk, oid, pack["id"], earlier_share + latest_share - returned)
    is_status(rest, 202)


def test_refund_all_draws_failed(relay_shop: tuple[str, HttpRelay], killbill: Any, mail: Any) -> None:
    base, relay = relay_shop
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    order = new_order(rider)
    done = pay_confirmed(rider, killbill, secret, order["id"], "deposit")
    relay.refuse = lambda method, path, body: method == "POST" and path.split("?")[0].endswith("/refunds")
    is_status(refund_line(desk, order["id"], line_of(done, "P-1500")["id"], 500), 202)
    failed = wait_order(rider, order["id"], lambda o: o["refunds"][0]["status"] == "failed", "a fully refused refund should read failed")
    relay.refuse = None
    assert failed["partlyRefunded"] is False and failed["refunds"][0]["returnedCents"] == 0
    assert line_of(failed, "P-1500") == line_of(done, "P-1500")
    assert mails_to(mail, rider.email, 0, "Credit note") == []


def test_partial_refunds_in_flight_guards(killbill: Any) -> None:
    base, peer, down = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL"), env_url("APP_MANUAL_DOWN_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    order = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    oid = order["id"]
    pack = line_of(order, "P-1500")["id"]
    refused(refund_line(desk, oid, pack, 100), 409, "illegal_transition")
    refused(rider.post(f"/api/desk/orders/{oid}/refunds", {"lineId": pack, "amountCents": 100}, key=idempotency_key()), 403, "forbidden")
    response, key = pay(rider, oid, "deposit")
    is_status(response, 202)
    refused(refund_line(desk, oid, pack, 100), 409, "payment_in_flight")
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    is_status(deliver(base, secret, payment), 200)
    wait_order(rider, oid, lambda o: o["state"] == "deposit confirmed", "deposit confirmed")
    refused(desk.at(down).post(f"/api/desk/orders/{oid}/refunds", {"lineId": pack, "amountCents": 100}, key=idempotency_key()), 503, "payments_paused")
    too_much = refund_line(desk, oid, pack, 12780 + 1)
    assert too_much.status_code == 422 and too_much.json()["errors"]["amountCents"] == "That is more than this line has collected."
    assert refund_line(desk, oid, pack, 0).status_code == 422
    assert refund_line(desk, oid, str(uuid.uuid4()), 100).status_code == 404
    shops = [desk, desk.at(peer), desk, desk.at(peer)]
    race = together([lambda s=s: refund_line(s, oid, pack, 12780 * 2 // 5) for s in shops])
    assert sorted(r.status_code for r in race) == [202, 202, 422, 422], "parallel refunds can never jointly exceed the line"
    for loser in (r for r in race if r.status_code == 422):
        assert loser.json()["errors"]["amountCents"] == "That is more than this line has collected."
    refunds_in_kb = kb_refunds(killbill, rider, 2)
    assert len(refunds_in_kb) == 2

    other_key = idempotency_key()
    tank = line_of(order, "TANK-OUT")["id"]
    first = desk.post(f"/api/desk/orders/{oid}/refunds", {"lineId": tank, "amountCents": 980}, key=other_key)
    body = is_status(first, 202)
    replay = desk.at(peer).post(f"/api/desk/orders/{oid}/refunds", {"lineId": tank, "amountCents": 980}, key=other_key)
    assert replay.status_code == 202 and replay.json() == body
    refused(desk.post(f"/api/desk/orders/{oid}/refunds", {"lineId": tank, "amountCents": 980 + 1}, key=other_key), 409, "idempotency_conflict")
    drawn = next(r for r in body["refunds"] if r["lineId"] == tank)
    assert drawn["vatCents"] == 156, "a draw emptying the allocation reverses its remaining VAT"
    assert len(kb_refunds(killbill, rider, 3)) == 3


def test_partial_refunds_respread_oracle(killbill: Any, mail: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    order = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    oid = order["id"]
    done = pay_confirmed(rider, killbill, secret, oid, "deposit")
    sent = is_status(refund_line(desk, oid, line_of(done, "P-1500")["id"], 1000), 202)
    refund = sent["refunds"][0]
    assert refund["status"] == "pending" and [d["stage"] for d in refund["draws"]] == ["deposit"] and refund["vatCents"] == 160
    held = rider.order(oid)
    assert stage_of(held, "instalment-1")["allocations"] == stage_of(done, "instalment-1")["allocations"], "no re-spread before the draw is believed"
    assert held["totalCents"] == 149500 and held["partlyRefunded"] is False
    sent_refund = wait_order(rider, oid, lambda o: all(d["killbillPaymentId"] for d in o["refunds"][0]["draws"]),
                             "the draw should be sent to Kill Bill")["refunds"][0]
    settle_refund(base, secret, rider, killbill, oid)
    after = wait_order(rider, oid, lambda o: o["refunds"][0]["status"] == "returned", "the refund should read returned")
    pack = line_of(after, "P-1500")
    assert pack["grossCents"] == 62900 and pack["vatCents"] == 10043 and pack["refundedCents"] == 1000
    assert after["totalCents"] == 148500 and after["vatCents"] == 23710 and after["partlyRefunded"] is True
    assert [stage_of(after, s)["amountCents"] for s in STAGES] == [29900, 39867, 39867, 39866]
    assert [a["grossCents"] for a in stage_of(after, "instalment-1")["allocations"]] == [11249, 16886, 9369, 1316, 1047]
    assert stage_of(after, "deposit")["confirmedAt"] == stage_of(done, "deposit")["confirmedAt"]
    assert len(mails_to(mail, rider.email, 1, f"Credit note for order {order['number']}: €10.00")) == 1


def test_bike_comparison(app_url: str, browser: Any) -> None:
    names = lambda query="": [b["id"] for b in is_status(httpx.get(f"{app_url}/api/bikes{query}", timeout=HTTP_TIMEOUT), 200)["bikes"]]
    assert names() == ["BK-POLDER-45", "BK-DIJK-45", "BK-KADE-25"]
    assert names("?class=45") == ["BK-POLDER-45", "BK-DIJK-45"] and names("?class=25") == ["BK-KADE-25"]
    with open_app(browser, f"{app_url}/bikes") as page:
        page.set_viewport_size(DESKTOP)
        table = role(page, "table", "Bike comparison")
        settled(page, lambda: "Kade Stroom 25" in read(table), "the table should list the bikes")
        content = read(table)
        assert content.index("Polder Stroom 45") < content.index("Dijk Stroom 45") < content.index("Kade Stroom 25")
        page.evaluate("() => { window.__sameDocument = true }")
        check(radio(page, "Road class filter", "45 km/h"))
        settled(page, lambda: "Kade Stroom 25" not in read(table) and "class=45" in page.url, "the filter should apply in place")
        assert page.evaluate("() => window.__sameDocument") is True
        check(radio(page, "Road class filter", "All"))
        settled(page, lambda: "Kade Stroom 25" in read(table) and "class=" not in page.url, "All clears the filter")
        page.goto(f"{app_url}/bikes?class=25")
        settled(page, lambda: "Kade Stroom 25" in read(table) and "Dijk Stroom 45" not in read(table), "a deep link holds the filter")
        assert radio(page, "Road class filter", "25 km/h").is_checked()


def test_test_ride_booking_one_hold_per_rider_race() -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    desk = fitter(base)
    rider = register(base)
    day = later(base, 5)
    slots = [open_slot(desk, day) for _ in range(6)]
    shops = [rider, rider.at(peer)] * 3
    answers = together([lambda s=s, slot=slot: s.post("/api/test-rides/holds", {"slotId": slot["id"]}) for s, slot in zip(shops, slots)])
    assert sorted(a.status_code for a in answers) == [201, 409, 409, 409, 409, 409]
    assert {a.json()["error"] for a in answers if a.status_code == 409} == {"hold_exists"}
    held_id = next(a.json()["slotId"] for a in answers if a.status_code == 201)
    listed = is_status(rider.get("/api/bikes/BK-KADE-25/slots"), 200)["slots"]
    states = {s["id"]: s["status"] for s in listed}
    assert states[held_id] == "held"
    assert all(states[s["id"]] == "free" for s in slots if s["id"] != held_id), "losing claims leave their slots free"


def test_last_slot_race_across_instances(browser: Any) -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    desk = fitter(base)
    slot = open_slot(desk, later(base, 6))
    riders = [register(b) for b in [base, peer] * 4]
    answers = together([lambda r=r: r.post("/api/test-rides/holds", {"slotId": slot["id"]}) for r in riders])
    assert sorted(a.status_code for a in answers) == [201] + [409] * 7
    assert {a.json()["error"] for a in answers if a.status_code == 409} == {"slot_gone"}
    app_url = env_url("APP_CLOCK_MORNING_URL")
    front = fitter(app_url)
    day = later(app_url, 4)
    contested, spare = open_slot(front, day), open_slot(front, day)
    buyer, rival = register(app_url), register(app_url)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, app_url, buyer.email, buyer.password)
        page.goto(f"{app_url}/bikes/BK-KADE-25")
        target = role(page, "button", f"Hold {contested['localDate']} {contested['localTime']}")
        settled(page, lambda: target.count() > 0, "the free slot should offer Hold")
        is_status(rival.post("/api/test-rides/holds", {"slotId": contested["id"]}), 201)
        click(target)
        wait_text(page, status(page, "Test-ride hold"), "That slot has just gone. Pick another.")
        other = role(page, "button", f"Hold {spare['localDate']} {spare['localTime']}")
        is_status(buyer.post("/api/test-rides/holds", {"slotId": open_slot(front, day)["id"]}), 201)
        settled(page, lambda: other.count() > 0, "the spare slot should offer Hold")
        click(other)
        wait_text(page, status(page, "Test-ride hold"), "You already hold a slot. Confirm it or let it run out.")


def test_test_ride_booking_server_expiry(browser: Any) -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    desk = fitter(base)
    slot = open_slot(desk, later(base, 7))
    rider, other = register(base), register(peer)
    ride = is_status(rider.post("/api/test-rides/holds", {"slotId": slot["id"]}), 201)
    assert ride["state"] == "held" and 0 < ride["remainingSeconds"] <= 8
    def slot_free() -> bool:
        listed = is_status(httpx.get(f"{peer}/api/bikes/BK-KADE-25/slots", timeout=HTTP_TIMEOUT), 200)["slots"]
        return next(s for s in listed if s["id"] == slot["id"])["status"] == "free"
    poll(slot_free, "the slot should come free when the hold's time is up", 8 + HOLD_LIMIT_S + SLACK_S)
    refused(rider.post(f"/api/test-rides/{ride['id']}/confirm"), 409, "hold_expired")
    for shop in (rider, rider.at(peer)):
        assert is_status(shop.get(f"/api/test-rides/{ride['id']}"), 200)["state"] == "expired"
    is_status(other.post("/api/test-rides/holds", {"slotId": slot["id"]}), 201)
    short = env_url("APP_SHORT_HOLD_URL")
    front = fitter(short)
    fresh = open_slot(front, later(short, 7))
    buyer = register(short)
    with open_app(browser, f"{short}/") as page:
        page.set_viewport_size(DESKTOP)
        page.clock.set_system_time("2031-01-01T00:00:00Z")
        browser_sign_in(page, short, buyer.email, buyer.password)
        page.goto(f"{short}/bikes/BK-KADE-25")
        hold = role(page, "button", f"Hold {fresh['localDate']} {fresh['localTime']}")
        settled(page, lambda: hold.count() > 0, "the slot should offer Hold")
        click(hold)
        timer = role(page, "timer", "Hold countdown")
        settled(page, lambda: re.fullmatch(r"Hold ends in 0:0[0-5]", read(timer)), "the timer shows the server's remaining time, not the device clock's")
        wait_text(page, status(page, "Test-ride hold"), "Your hold ran out. The slot is free again.")
        assert timer.count() == 0, "the timer exists only during a live hold"
    assert is_status(buyer.get("/api/test-rides"), 200)["rides"][0]["state"] == "expired"


def test_wf_test_ride_booking_confirm(app_url: str, browser: Any, mail: Any) -> None:
    desk = fitter(app_url)
    slot = open_slot(desk, later(app_url, 8))
    rider = register(app_url)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, app_url, rider.email, rider.password)
        page.goto(f"{app_url}/bikes/BK-KADE-25")
        hold = role(page, "button", f"Hold {slot['localDate']} {slot['localTime']}")
        settled(page, lambda: hold.count() > 0, "the slot should offer Hold")
        click(hold)
        settled(page, lambda: read(status(page, "Test-ride hold")).startswith("Hold ends in "), "the hold is announced")
        confirm = role(page, "button", "Confirm ride")
        settled(page, lambda: confirm.count() > 0, "button Confirm ride should show")
        click(confirm)
        settled(page, lambda: re.search(r"/rides/[^/?#]+$", urlparse(page.url).path), "confirming should land on /rides/<id>")
        rid = urlparse(page.url).path.rsplit("/", 1)[1]
        heading = page.get_by_role("heading", name="Test ride confirmed", exact=True)
        settled(page, lambda: heading.count() > 0 and has_focus(heading), "focus should move to the top heading")
        page.reload()
        settled(page, lambda: heading.count() > 0, "reload shows the same screen")
        assert urlparse(page.url).path == f"/rides/{rid}"
    ride = is_status(rider.get(f"/api/test-rides/{rid}"), 200)
    assert ride["state"] == "confirmed" and ride["localDate"] == slot["localDate"] and ride["localTime"] == slot["localTime"]
    assert is_status(rider.post(f"/api/test-rides/{rid}/confirm"), 200)["id"] == ride["id"]
    subject = f"Test ride confirmed: Kade Stroom 25 on {slot['localDate']} at {slot['localTime']}"
    messages = mails_to(mail, rider.email, 1, subject)
    assert len(messages) == 1 and f"/rides/{rid}" in text(messages[0])


def test_test_ride_booking_dst_cutoff() -> None:
    base = env_url("APP_CLOCK_DST_URL")
    desk = fitter(base)
    rider = register(base)
    missing = desk.post("/api/desk/ride-days", {"bikeId": "BK-DIJK-45", "date": "2027-03-28", "times": ["02:30"]})
    assert missing.status_code == 422 and missing.json()["errors"]["times"] == "That time does not exist on this date."
    tomorrow = open_slot(desk, date(2027, 3, 29))
    ride = is_status(rider.post("/api/test-rides/holds", {"slotId": tomorrow["id"]}), 201)
    assert ride["startsAt"].endswith("+02:00") and ride["startsAt"].startswith(f"2027-03-29T{tomorrow['localTime']}")
    ride = is_status(rider.post(f"/api/test-rides/{ride['id']}/confirm"), 200)
    assert ride["freeCancellation"] is False, "18:30 CEST is past the 18:00 cutoff on the true offset"
    refused(rider.post(f"/api/test-rides/{ride['id']}/cancel"), 409, "cancellation_closed")
    assert is_status(rider.get(f"/api/test-rides/{ride['id']}"), 200)["state"] == "confirmed"
    second = register(base)
    later_slot = open_slot(desk, date(2027, 3, 30))
    later_ride = is_status(second.post("/api/test-rides/holds", {"slotId": later_slot["id"]}), 201)
    later_ride = is_status(second.post(f"/api/test-rides/{later_ride['id']}/confirm"), 200)
    assert later_ride["freeCancellation"] is True
    assert is_status(second.post(f"/api/test-rides/{later_ride['id']}/cancel"), 200)["state"] == "cancelled"
    refused(second.post(f"/api/test-rides/{later_ride['id']}/cancel"), 409, "illegal_transition")
    autumn = desk.post("/api/desk/ride-days", {"bikeId": "BK-KADE-25", "date": "2027-10-31", "times": ["02:30"]})
    assert autumn.status_code in (201, 409), "a repeated time is accepted; 409 means an earlier run opened it"
    listed = is_status(desk.get("/api/bikes/BK-KADE-25/slots"), 200)["slots"]
    repeated = next(s for s in listed if s["localDate"] == "2027-10-31" and s["localTime"] == "02:30")
    assert repeated["startsAt"].endswith("+02:00"), "the first occurrence of the repeated time is on summer time"


def test_same_day_cutoffs() -> None:
    noon = env_url("APP_CLOCK_NOON_URL")
    desk = fitter(noon)
    assert shop_now(noon).date() == date(2026, 12, 7), "the noon instance's shop date"
    today = open_slot(desk, date(2026, 12, 7))
    rider = register(noon)
    refused(rider.post("/api/test-rides/holds", {"slotId": today["id"]}), 409, "same_day_closed")
    tomorrow = open_slot(desk, date(2026, 12, 8))
    is_status(rider.post("/api/test-rides/holds", {"slotId": tomorrow["id"]}), 201)
    second = register(noon)
    refused(second.post("/api/test-rides/holds", {"slotId": today["id"]}), 409, "same_day_closed")
    morning = env_url("APP_CLOCK_MORNING_URL")
    front = fitter(morning)
    now = shop_now(morning)
    slot = open_slot(front, now.date())
    buyer = register(morning)
    answer = buyer.post("/api/test-rides/holds", {"slotId": slot["id"]})
    if now.hour < 12 and f"{now.hour:02d}:{now.minute:02d}" < slot["localTime"]:
        is_status(answer, 201)
    else:
        refused(answer, 409, "same_day_closed")


def test_workshop_desk_desk_input_survives_poll(browser: Any) -> None:
    base = env_url("APP_FAST_CLOCK_URL")
    desk_api = fitter(base)
    ride_day = later(base, 4)
    far_day = later(base, 400)
    times = f"{random.randrange(8, 13):02d}:{random.randrange(60):02d}, {random.randrange(13, 20):02d}:{random.randrange(60):02d}"
    riders = [register(base), register(base)]
    rides = []
    for rider in riders:
        slot = open_slot(desk_api, ride_day)
        held_ride = is_status(rider.post("/api/test-rides/holds", {"slotId": slot["id"]}), 201)
        rides.append(is_status(rider.post(f"/api/test-rides/{held_ride['id']}/confirm"), 200))
    refused(desk_api.post(f"/api/desk/rides/{rides[0]['id']}/outcome", {"outcome": "ridden"}), 409, "ride_not_started")
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, FITTER_EMAIL, FITTER_PASSWORD)
        page.goto(f"{base}/desk")
        date_box = role(page, "textbox", "Ride date")
        settled(page, lambda: date_box.count() > 0, "the desk should show Ride date")
        fill(date_box, far_day.isoformat())
        settled(page, lambda: page_says(page, "No test rides on this day."), "an empty day shows its copy")
        select(role(page, "combobox", "Bike"), "Dijk Stroom 45")
        slot_times = role(page, "textbox", "Slot times")
        fill(slot_times, times)
        slot_times.focus()
        for _ in range(16):
            advance(page, 500)
            assert slot_times.input_value() == times and has_focus(slot_times), "polling must keep typed times and focus"
        click(role(page, "button", "Open slots"))
        wait_text(page, status(page, "Desk status"), "Opened 2 slots.")
        for _ in range(12):
            advance(page, 500)
            assert read(status(page, "Desk status")) == "Opened 2 slots.", "polling must keep the last message"
        created = [s for s in is_status(desk_api.get("/api/bikes/BK-DIJK-45/slots"), 200)["slots"] if s["localDate"] == far_day.isoformat()]
        assert {s["localTime"] for s in created} >= {t.strip() for t in times.split(",")}
        click(role(page, "button", "Open slots"))
        wait_text(page, status(page, "Desk status"), "Those slots already exist.")
        poll(lambda: shop_now(base).date() >= ride_day, "the fast clock should reach the ride date", 30)
        fill(date_box, ride_day.isoformat())
        table = role(page, "table", "Ride day")
        row_of = lambda rider: table.get_by_role("row").filter(has_text=rider.user["name"])
        settled(page, lambda: row_of(riders[0]).count() > 0 and row_of(riders[1]).count() > 0, "the day's rides should list both riders")
        for rider, button, copy in ((riders[0], "Mark ridden", "Marked ridden."), (riders[1], "Mark no-show", "Marked no-show.")):
            click(role(row_of(rider), "button", button))
            wait_text(page, status(page, "Desk status"), copy)
            settled(page, lambda: has_focus(status(page, "Desk status")), "focus moves to Desk status when the control vanishes")
    assert is_status(riders[0].get(f"/api/test-rides/{rides[0]['id']}"), 200)["state"] == "ridden"
    assert is_status(riders[1].get(f"/api/test-rides/{rides[1]['id']}"), 200)["state"] == "no-show"
    refused(desk_api.post(f"/api/desk/rides/{rides[0]['id']}/outcome", {"outcome": "no-show"}), 409, "illegal_transition")


def test_workshop_desk_provider_status_only(browser: Any, killbill: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider)
    oid, number = order["id"], order["number"]
    response, key = pay(rider, oid, "deposit")
    is_status(response, 202)
    payment, tx = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    assert tx["status"] == "SUCCESS"
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, FITTER_EMAIL, FITTER_PASSWORD)
        page.goto(f"{base}/desk")
        link = role(role(page, "table", "Payments waiting"), "link", f"Open order {number}")
        settled(page, lambda: link.count() > 0, "the pending order should wait on the desk")
        click(link)
        settled(page, lambda: urlparse(page.url).path == f"/desk/orders/{oid}", "the link opens the desk order page")
        payments = role(page, "table", "Payments")
        settled(page, lambda: "pending" in read(payments), "the payment should read pending")
        stays(page, lambda: "paid" not in read(payments), "Kill Bill's SUCCESS alone must not read paid", 4)
        is_status(deliver(base, secret, payment), 200)
        settled(page, lambda: "paid" in read(payments), "a believed delivery should read paid")
        select(role(page, "combobox", "Refund line"), "Traction pack P-1500")
        amount = role(page, "textbox", "Refund amount in euros")
        fill(amount, "12,50")
        press = role(page, "button", "Refund line")
        click(press)
        settled(page, lambda: page_says(page, "Enter an amount like 12.50."), "a comma amount shows the published message")
        fill(amount, "12.50")
        amount.focus()
        for _ in range(12):
            advance(page, 500)
            assert amount.input_value() == "12.50" and has_focus(amount), "polling must keep the amount and focus"
        settled(page, lambda: enabled(press), "button Refund line should be open")
        click(press)
        refund_status = status(page, "Refund status")
        wait_text(page, refund_status, "Refund of €12.50 sent. Pending until the provider confirms.")
        stays(page, lambda: read(refund_status).endswith("Pending until the provider confirms."), "polling must keep the last message", 4)
        assert urlparse(page.url).path == f"/desk/orders/{oid}", "a refund lands on the desk order page"
        refund = rider.order(oid)["refunds"][0]
        assert refund["status"] == "pending" and refund["amountCents"] == int(Decimal("12.50") * 100)
        settled(page, lambda: "pending" in read(payments), "the draw should show pending")
        kb_refund = kb_refunds(killbill, rider, 1)
        assert Decimal(str(kb_refund[0]["amount"])) == Decimal("12.50")
        settle_refund(base, secret, rider, killbill, oid)
        wait_text(page, refund_status, "Refund of €12.50 returned.")
        settled(page, lambda: "returned" in read(payments), "the draw should show returned")
        page.reload()
        settled(page, lambda: "returned" in read(role(page, "table", "Payments")), "reload shows the same screen")


def test_rider_isolation_not_found_parity(browser: Any, killbill: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    owner, other = register(base), register(base)
    desk = fitter(base)
    order = new_order(owner)
    ride = is_status(owner.post("/api/test-rides/holds", {"slotId": open_slot(desk, later(base, 9))["id"]}), 201)
    ghost = str(uuid.uuid4())
    probes = [("GET", "/api/orders/{}", None, False), ("PATCH", "/api/orders/{}", {"planVersion": 1, "plan": PLAN}, False),
              ("POST", "/api/orders/{}/payments", {"stage": "deposit"}, True), ("POST", "/api/orders/{}/withdraw", {}, True),
              ("POST", "/api/orders/{}/switch-to-workshop", {}, True)]
    for method, path, body, keyed in probes:
        theirs = other.call(method, path.format(order["id"]), body, idempotency_key() if keyed else None)
        missing = other.call(method, path.format(ghost), body, idempotency_key() if keyed else None)
        assert theirs.status_code == missing.status_code == 404 and theirs.json() == missing.json() == {"error": "not_found"}, path
    for method, path in (("GET", "/api/test-rides/{}"), ("POST", "/api/test-rides/{}/confirm"), ("POST", "/api/test-rides/{}/cancel")):
        body = {} if method == "POST" else None
        theirs, missing = other.call(method, path.format(ride["id"]), body), other.call(method, path.format(ghost), body)
        assert theirs.status_code == missing.status_code == 404 and theirs.json() == missing.json(), path
    refused(other.post("/api/test-rides/holds", {"slotId": ghost}), 404, "not_found")
    assert is_status(other.get("/api/orders"), 200)["orders"] == [] and is_status(other.get("/api/test-rides"), 200)["rides"] == []
    refused(Shop(base).get(f"/api/orders/{order['id']}"), 401, "unauthenticated")
    assert owner.order(order["id"])["state"] == "quoted", "the probes changed nothing"
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, other.email, other.password)
        for path in (f"/orders/{order['id']}", f"/orders/{ghost}", f"/rides/{ride['id']}", f"/rides/{ghost}"):
            page.goto(base + path)
            heading = page.get_by_role("heading", name=NOT_FOUND, exact=True)
            settled(page, lambda: heading.count() > 0, f"{path} should show the not-found page")
            assert order["number"] not in read(page.locator("body"))


def session_lapsed(page: Page, base: str) -> None:
    poll(lambda: page.request.get(f"{base}/api/me").status == 401, "the 20 second session should lapse", SHORT_SESSION_WAIT_S)


def test_rider_isolation_session_end_keeps_input(browser: Any) -> None:
    base = env_url("APP_SHORT_SESSION_URL")
    rider = register(base)
    order = new_order(rider)
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, rider.email, rider.password)
        target = f"{base}/orders/{order['id']}"
        page.goto(target)
        toggle = role(page, "button", "Payment plan")
        settled(page, lambda: toggle.count() > 0, "button Payment plan should show")
        click(toggle)
        panel = role(page, "region", "Payment plan")
        settled(page, lambda: panel.count() > 0, "the plan panel should open")
        fill(role(panel, "textbox", "City"), SESSION_CITY)
        fill(role(panel, "textbox", "Note to workshop"), SESSION_NOTE)
        session_lapsed(page, base)
        dialog = role(page, "dialog", "Sign in again")
        for _ in range(12):
            advance(page, 500)
            assert dialog.count() == 0 and page.url == target, "a poll answering 401 neither navigates nor opens the dialog"
            assert role(panel, "textbox", "City").input_value() == SESSION_CITY
        saves: list[str] = []
        page.on("request", lambda r: saves.append(r.url) if r.method == "PATCH" else None)
        save = role(panel, "button", "Save plan")
        click(save)
        settled(page, lambda: dialog.count() > 0, "the next action answering 401 should open dialog Sign in again")
        assert page_says(page, "Your session ended. Sign in to carry on.")
        email = role(dialog, "textbox", "Email")
        assert email.input_value() == rider.email and not email.is_editable(), "email is prefilled and read-only"
        assert page.url == target and role(panel, "textbox", "City").input_value() == SESSION_CITY
        fill(role(dialog, "textbox", "Password"), rider.password)
        click(role(dialog, "button", "Sign in"))
        wait_text(page, status(page, "Plan status"), "Plan saved.")
        settled(page, lambda: dialog.count() == 0 and has_focus(save), "focus returns to the control pressed")
        assert page.url == target, "signing in through the dialog does not navigate"
        assert len(saves) == 2, f"one refused save and one retry, saw {len(saves)}"
        assert role(panel, "textbox", "Note to workshop").input_value() == SESSION_NOTE
        fresh = page.request.get(f"{base}/api/orders/{order['id']}").json()
        assert fresh["plan"]["city"] == SESSION_CITY and fresh["plan"]["note"] == SESSION_NOTE


def test_rider_isolation_no_auto_resend(browser: Any, killbill: Any) -> None:
    base = env_url("APP_SHORT_SESSION_URL")
    rider = register(base)
    order = new_order(rider)
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(f"{base}/orders/{order['id']}")
        press = role(page, "button", "Pay Deposit")
        settled(page, lambda: enabled(press), "button Pay Deposit should be open")
        session_lapsed(page, base)
        keys: list[str] = []
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key", "")) if r.method == "POST" and r.url.endswith("/payments") else None)
        click(press)
        dialog = role(page, "dialog", "Sign in again")
        settled(page, lambda: dialog.count() > 0, "the refused press should open dialog Sign in again")
        assert len(keys) == 1
        fill(role(dialog, "textbox", "Password"), rider.password)
        click(role(dialog, "button", "Sign in"))
        settled(page, lambda: dialog.count() == 0, "signing in closes the dialog")
        stays(page, lambda: len(keys) == 1, "a money action must not be re-sent automatically", 3)
        assert kb_count(killbill, rider) == 0
        click(press)
        settled(page, lambda: len(keys) == 2, "a fresh press sends the request again")
        assert keys[0] and keys[1] == keys[0], "the fresh press reuses the same key"
        kb_tx(killbill, rider, f"{rider.user['id']}:{keys[0]}")
        assert kb_count(killbill, rider) == 1


def test_wf_rider_isolation_sign_in_landing(browser: Any) -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    a, b = unique("signup")
    email, name = (a, b) if "@" in a else (b, a)
    with open_app(browser, f"{base}/register") as page:
        page.set_viewport_size(DESKTOP)
        form = role(page, "form", "Register")
        settled(page, lambda: form.count() > 0, "form Register should show")
        fill(role(form, "textbox", "Email"), email)
        fill(role(form, "textbox", "Password"), RIDER_PASSWORD)
        fill(role(form, "textbox", "Name"), name)
        select(role(form, "combobox", "Country"), "BE")
        click(role(form, "button", "Register"))
        settled(page, lambda: urlparse(page.url).path == "/orders", "registering lands on /orders")
        page.reload()
        settled(page, lambda: page_says(page, "No orders yet. Prove a fit first."), "reloading /orders shows the same screen")
        click(role(page, "button", "Sign out") if role(page, "button", "Sign out").count() else role(page, "link", "Sign out"))
        settled(page, lambda: role(page, "link", "Sign in").count() > 0 or role(page, "button", "Sign in").count() > 0, "signing out offers Sign in")
        page.goto(f"{base}/sign-in")
        form = role(page, "form", "Sign in")
        settled(page, lambda: form.count() > 0, "form Sign in should show")
        fill(role(form, "textbox", "Email"), email)
        fill(role(form, "textbox", "Password"), "wrong-password-1")
        click(role(form, "button", "Sign in"))
        settled(page, lambda: page_says(page, "Email or password is wrong."), "a failed sign-in shows its copy")
        fill(role(form, "textbox", "Password"), RIDER_PASSWORD)
        click(role(form, "button", "Sign in"))
        settled(page, lambda: urlparse(page.url).path == "/orders", "a rider lands on /orders")
    with open_app(browser, f"{base}/sign-in") as page:
        page.set_viewport_size(DESKTOP)
        form = role(page, "form", "Sign in")
        settled(page, lambda: form.count() > 0, "form Sign in should show")
        fill(role(form, "textbox", "Email"), FITTER_EMAIL)
        fill(role(form, "textbox", "Password"), FITTER_PASSWORD)
        click(role(form, "button", "Sign in"))
        settled(page, lambda: urlparse(page.url).path == "/desk", "the fitter lands on /desk")
        assert role(page, "link", "Desk").count() >= 1 or page.get_by_role("button", name="Menu").count() >= 1
    rider = register(base)
    with open_app(browser, configure_url(base)) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        address = page.url
        drive_both(page)
        click(role(page, "button", "Start checkout"))
        settled(page, lambda: urlparse(page.url).path == "/sign-in", "with no session Start checkout goes to /sign-in")
        form = role(page, "form", "Sign in")
        settled(page, lambda: form.count() > 0, "form Sign in should show")
        fill(role(form, "textbox", "Email"), rider.email)
        fill(role(form, "textbox", "Password"), rider.password)
        click(role(form, "button", "Sign in"))
        settled(page, lambda: urlparse(page.url).path == "/orders", "a rider lands on /orders")
        resume = role(page, "link", "Resume your configuration")
        settled(page, lambda: resume.count() > 0, "link Resume your configuration should show")
        click(resume)
        settled(page, lambda: parse_qs(urlparse(page.url).query).get("plate") == parse_qs(urlparse(address).query)["plate"], "the link returns to the configurator address")
    me = rider.at(peer).get("/api/me")
    user = is_status(me, 200)
    assert user["email"] == rider.email and user["role"] == "rider" and user["landing"] == "/orders"
    assert fitter(base).user["landing"] == "/desk" and fitter(base).user["role"] == "fitter"
    refused(httpx.post(base + "/api/auth/sign-in", json={"email": rider.email, "password": "wrong-password-1"}, timeout=HTTP_TIMEOUT), 401, "bad_credentials")
    taken = httpx.post(base + "/api/auth/register", json={"email": rider.email, "password": RIDER_PASSWORD, "name": "Probe", "country": "NL"}, timeout=HTTP_TIMEOUT)
    refused(taken, 409, "email_taken")
    a, b = unique("short")
    fresh = a if "@" in a else b
    assert httpx.post(base + "/api/auth/register", json={"email": fresh, "password": "123456789", "name": "Probe", "country": "NL"}, timeout=HTTP_TIMEOUT).status_code == 422
    assert httpx.post(base + "/api/auth/register", json={"email": fresh, "password": "1234567890", "name": "Probe", "country": "NL"}, timeout=HTTP_TIMEOUT).status_code == 201
    assert httpx.post(base + "/api/auth/sign-out", headers={"Cookie": rider.cookie}, timeout=HTTP_TIMEOUT).status_code == 204


def test_published_empty_lists(browser: Any) -> None:
    base = env_url("APP_SHORT_HOLD_URL")
    rider = register(base)
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(f"{base}/orders")
        copy = page.get_by_text("No orders yet. Prove a fit first.", exact=True)
        settled(page, lambda: copy.count() > 0, "/orders should show its empty wording")
        page.goto(f"{base}/rides")
        copy = page.get_by_text("No test rides booked.", exact=True)
        settled(page, lambda: copy.count() > 0, "/rides should show its empty wording")
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, FITTER_EMAIL, FITTER_PASSWORD)
        page.goto(f"{base}/desk")
        copy = page.get_by_text("No payments waiting on the provider.", exact=True)
        settled(page, lambda: copy.count() > 0, "the desk should show its empty payments wording")
        fill(role(page, "textbox", "Ride date"), later(base, 500).isoformat())
        copy = page.get_by_text("No test rides on this day.", exact=True)
        settled(page, lambda: copy.count() > 0, "the desk should show its empty ride-day wording")


def test_provider_outages_pending_never_paid(browser: Any, killbill: Any, mail: Any) -> None:
    base, down = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_DOWN_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider)
    oid = order["id"]
    response, key = pay(rider, oid, "deposit")
    is_status(response, 202)
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    refused(deliver(down, secret, payment), 503, "provider_unreachable")
    assert is_status(httpx.get(down + "/api/status", timeout=HTTP_TIMEOUT), 200)["killbill"] == "down"
    assert fit(down, plate("FGH-12-K"))["verdict"] == "fits", "the fit check keeps working"
    assert is_status(httpx.get(down + "/api/bikes", timeout=HTTP_TIMEOUT), 200)["bikes"]
    with open_app(browser, f"{down}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, down, rider.email, rider.password)
        page.goto(f"{down}/orders/{oid}")
        wait_contains(page, role(page, "alert", "Provider outage"), KB_BANNER, BANNER_S + SLACK_S)
        wait_text(page, status(page, "Order state"), "deposit pending")
        withdraw = role(page, "button", "Withdraw")
        settled(page, lambda: attr(withdraw, "aria-disabled") == "true", "Withdraw should be disabled while Kill Bill is down")
        withdraw.focus()
        assert has_focus(withdraw), "a disabled money control stays focusable"
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if r.method == "POST" else None)
        page.keyboard.press("Enter")
        stays(page, lambda: read(status(page, "Order state")) == "deposit pending" and "Deposit paid." not in read(status(page, "Payment status")),
              "pending must never read as paid", 4)
        assert not [u for u in sent if "/withdraw" in u], "a disabled control sends nothing"
        assert "pending" in read(role(page, "table", "Payment schedule"))
        page.goto(configure_url(down))
        figures_ready(page)
        drive_both(page)
        start = role(page, "button", "Start checkout")
        settled(page, lambda: attr(start, "aria-disabled") == "true", "Start checkout should be disabled while Kill Bill is down")
    assert stage_of(rider.order(oid), "deposit")["status"] == "pending"
    assert mails_to(mail, rider.email) == []


def test_registry_unreachable(browser: Any, wiremock: Any, killbill: Any) -> None:
    down = env_url("APP_REGISTRY_DOWN_URL")
    assert is_status(httpx.get(down + "/api/status", timeout=HTTP_TIMEOUT), 200)["registry"] == "down"
    refused(post_json(down, "/api/plates/lookup", {"plate": "FGH-12-K", "country": "NL"}), 503, "registry_unreachable")
    refused(post_json(down, "/api/fit-checks", {"donor": plate("FGH-12-K"), "packId": "P-1500", "hubId": "H-1000", "roadClass": 25}), 503, "registry_unreachable")
    hand = fit(down, manual_donor())
    assert hand["confirmed"] is False and hand["verdict"] == "fits"
    rider = register(down)
    refused(rider.post("/api/orders", {"kind": "kit", "config": kit(), "plan": PLAN, "expectedTotalCents": 149500}), 503, "registry_unreachable")
    order = new_order(rider, {**kit(), "donor": manual_donor()})
    response, _ = pay(rider, order["id"], "deposit")
    refused(response, 409, "donor_unconfirmed")
    with open_app(browser, f"{down}/configure") as page:
        page.set_viewport_size(DESKTOP)
        wait_contains(page, role(page, "alert", "Provider outage"), REGISTRY_BANNER, BANNER_S + SLACK_S)
        click(role(page, "button", "Enter frame details by hand"))
        form = role(page, "form", "Frame details")
        settled(page, lambda: form.count() > 0, "hand entry stays available")
        select(role(form, "combobox", "Model"), "Kade K50")
        fill(role(form, "spinbutton", "First-admission year"), "2019")
        select(role(form, "combobox", "Registered road class"), "25 km/h")
        select(role(form, "combobox", "Plate colour"), "blue")
        fill(role(form, "textbox", "Registered mass in kg"), "110.0")
        click(role(form, "button", "Try this frame"))
        figures_ready(page)
        drive_both(page)
        wait_contains(page, status(page, "Fit verdict"), "Donor unconfirmed.")
    app_url = env_url("APP_MANUAL_URL")
    buyer = register(app_url)
    pending = new_order(buyer, plate="PQR-58-S")
    wiremock.stub("GET", "/v1/plates/PQR-58-S", status=503, json={"error": "probe"})
    response, _ = pay(buyer, pending["id"], "deposit")
    refused(response, 503, "registry_unreachable")
    assert kb_count(killbill, buyer) == 0


def test_provider_outages_auto_relookup(app_url: str, browser: Any, wiremock: Any) -> None:
    probe, lane = "/v1/plates/PROBE", "/v1/plates/PQR-58-S"
    true_read = {"plate": "PQR-58-S", "country": "NL", "model": "K50", "firstAdmissionYear": 2019, "roadClass": 25, "plateColour": "blue", "registeredMassKg": 110.0}
    try:
        wiremock.stub("GET", probe, status=503, json={"error": "probe"})
        wiremock.stub("GET", lane, status=503, json={"error": "probe"})
        poll(lambda: httpx.get(app_url + "/api/status", timeout=HTTP_TIMEOUT).json()["registry"] == "down", "status should report the registry down", BANNER_S + SLACK_S)
        with open_app(browser, configure_url(app_url, plate="PQR-58-S")) as page:
            page.set_viewport_size(DESKTOP)
            banner = role(page, "alert", "Provider outage")
            wait_contains(page, banner, REGISTRY_BANNER, BANNER_S + SLACK_S)
            page.evaluate("() => { window.__sameDocument = true }")
            assert not read(status(page, "Plate lookup")).startswith("Found ")
            seen = len(wiremock.requests(lane))
            wiremock.stub("GET", probe, status=404, json={"error": "plate_not_found"})
            wiremock.stub("GET", lane, json=true_read)
            found = "Found Kade K50, 2019, snorfiets, blue plate."
            wait_text(page, status(page, "Plate lookup"), found, BANNER_S + SLACK_S)
            settled(page, lambda: REGISTRY_BANNER not in read(banner), "the banner should clear without a reload", BANNER_S + SLACK_S)
            figures_ready(page)
            assert len(wiremock.requests(lane)) > seen, "the plate must be read afresh"
            assert page.evaluate("() => window.__sameDocument") is True, "recovery must not reload the page"
    finally:
        wiremock.stub("GET", probe, status=404, json={"error": "plate_not_found"})
        wiremock.stub("GET", lane, json=true_read)


def test_provider_outages_boot_down_recover(browser: Any) -> None:
    bill = HttpRelay(os.environ["KILLBILL_URL"])
    registry = HttpRelay(os.environ["WIREMOCK_URL"])
    bill.down = registry.down = True
    try:
        with app_copy(KILLBILL_URL=bill.url, WIREMOCK_URL=registry.url, KILLBILL_CALLBACK_ORIGIN=DEAD_ORIGIN,
                      DATABASE_URL=os.environ["DATABASE_URL"] + "_manual") as base:
            assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
            state = lambda: httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT).json()
            poll(lambda: state()["killbill"] == "down" and state()["registry"] == "down", "status should report both down", BANNER_S + SLACK_S)
            with open_app(browser, f"{base}/configure") as page:
                page.set_viewport_size(DESKTOP)
                banner = role(page, "alert", "Provider outage")
                wait_contains(page, banner, KB_BANNER, BANNER_S + SLACK_S)
                wait_contains(page, banner, REGISTRY_BANNER, BANNER_S + SLACK_S)
                page.evaluate("() => { window.__sameDocument = true }")
                bill.down = registry.down = False
                settled(page, lambda: KB_BANNER not in read(banner) and REGISTRY_BANNER not in read(banner), "both banners should clear with no reload", BANNER_S + SLACK_S)
                assert page.evaluate("() => window.__sameDocument") is True
            assert state()["killbill"] == "up" and state()["registry"] == "up"
            assert is_status(post_json(base, "/api/plates/lookup", {"plate": "FGH-12-K", "country": "NL"}), 200)["confirmed"] is True
    finally:
        bill.stop()
        registry.stop()


def test_fulfilment_change_vat_correction_oracle(browser: Any, killbill: Any, mail: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    order = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    oid = order["id"]
    before = pay_confirmed(rider, killbill, secret, oid, "deposit")
    post_line = line_of(before, "POST")
    purchases = kb_count(killbill, rider)
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(f"{base}/orders/{oid}")
        button = role(page, "button", "Switch to workshop fitting")
        settled(page, lambda: enabled(button), "button Switch to workshop fitting should be open")
        click(button)
        payment_status = status(page, "Payment status")
        wait_text(page, payment_status, "Fulfilment changed to workshop fitting. VAT on paid stages corrected by €4.14.")
        settled(page, lambda: button.count() == 0 and has_focus(payment_status), "focus moves to Payment status when Switch vanishes")
        assert "corrected" in read(page.locator("body"))
    after = rider.order(oid)
    deposit = stage_of(after, "deposit")
    assert deposit["amountCents"] == 29900 and deposit["vatCents"] == 5188 and deposit["vatCorrectedCents"] == 414
    assert [a["vatCents"] for a in deposit["allocations"]] == [1454, 2218, 1211, 170, 135]
    assert [a["grossCents"] for a in deposit["allocations"]] == [8380, 12780, 6980, 980, 780]
    assert after["totalCents"] == 174500 and after["vatCents"] == 30285
    assert [stage_of(after, s)["amountCents"] for s in STAGES[1:]] == [48200, 48200, 48200]
    assert [a["grossCents"] for a in stage_of(after, "instalment-1")["allocations"]] == [11574, 17650, 9640, 1353, 7983]
    assert stage_of(after, "instalment-1")["dueDate"] == stage_of(before, "instalment-1")["dueDate"]
    fit_line = line_of(after, "FIT")
    assert fit_line["id"] == post_line["id"] and after["lines"][-1]["code"] == "FIT" and fit_line["name"] == "Workshop fitting" and fit_line["grossCents"] == 28900
    assert {l["vatRatePct"] for l in after["lines"]} == {21}
    assert kb_count(killbill, rider) == purchases, "a switch makes no Kill Bill transaction"
    messages = mails_to(mail, rider.email, 1, f"VAT correction for order {order['number']}: €4.14")
    assert len(messages) == 1
    body = text(messages[0])
    assert money(4774) in body and money(5188) in body and re.search(re.escape(money(414)) + r"\W*corrected", body)


def test_fulfilment_change_zero_correction_no_mail(killbill: Any, mail: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    for country in ("NL", "BE"):
        order = new_order(rider, country=country)
        pay_confirmed(rider, killbill, secret, order["id"], "deposit")
        switched = is_status(rider.post(f"/api/orders/{order['id']}/switch-to-workshop", {}, key=idempotency_key()), 200)
        assert all(s["vatCorrectedCents"] == 0 for s in switched["schedule"])
        assert line_of(switched, "FIT")["grossCents"] == 28900
    assert mails_to(mail, rider.email, 0, "VAT correction") == []


def test_switch_guards_and_later_refund(killbill: Any) -> None:
    base, down = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_DOWN_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    switch = lambda oid, shop=rider, key=None: shop.post(f"/api/orders/{oid}/switch-to-workshop", {}, key=key or idempotency_key())
    quoted = new_order(rider)
    refused(switch(quoted["id"]), 409, "illegal_transition")
    workshop = new_order(rider, fulfilment="workshop")
    pay_confirmed(rider, killbill, secret, workshop["id"], "deposit")
    refused(switch(workshop["id"]), 409, "illegal_transition")
    order = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    oid = order["id"]
    response, key = pay(rider, oid, "deposit")
    is_status(response, 202)
    payment, _ = kb_tx(killbill, rider, f"{rider.user['id']}:{key}")
    is_status(deliver(base, secret, payment), 200)
    done = wait_order(rider, oid, lambda o: o["state"] == "deposit confirmed", "deposit confirmed")
    refund = is_status(refund_line(desk, oid, line_of(done, "P-1500")["id"], 100), 202)["refunds"][0]
    refused(switch(oid), 409, "payment_in_flight")
    sent_refund = wait_order(rider, oid, lambda o: all(d["killbillPaymentId"] for d in o["refunds"][0]["draws"]),
                             "the draw should be sent to Kill Bill")["refunds"][0]
    settle_refund(base, secret, rider, killbill, oid)
    wait_order(rider, oid, lambda o: o["refunds"][0]["status"] == "returned", "the refund settles")
    refused(switch(oid), 409, "illegal_transition")

    clean = new_order(rider, plate="418-RTV", reg="DE", country="DE")
    cid = clean["id"]
    paid = pay_confirmed(rider, killbill, secret, cid, "deposit")
    count = kb_count(killbill, rider)
    switch_key = idempotency_key()
    first = switch(cid, rider.at(down), switch_key)
    body = is_status(first, 200)
    assert line_of(body, "FIT")["id"] == line_of(paid, "POST")["id"] and stage_of(body, "deposit")["amountCents"] == 29900
    replay = switch(cid, rider, switch_key)
    assert replay.status_code == 200 and replay.json() == body
    assert kb_count(killbill, rider) == count, "no Kill Bill transaction"
    refused(rider.patch(f"/api/orders/{cid}", {"planVersion": body["planVersion"], "config": {"fulfilment": "posted", "country": "NL"}}), 409, "quote_locked")
    later_refund = is_status(refund_line(desk, cid, line_of(body, "P-1500")["id"], 1000), 202)["refunds"][0]
    assert later_refund["vatCents"] == vat_of(1000, 21), "later refunds use the new rate"


def paid_class_move(base: str, rider: Shop, killbill: Any, secret: str, number: str) -> dict:
    order = new_order(rider, plate=number, road=45)
    pay_all(rider, killbill, secret, order["id"])
    is_status(fitter(base).post(f"/api/desk/orders/{order['id']}/transitions", {"to": "kit dispatched"}), 200)
    return order


def test_class_move_inspection_registry_gates_state(browser: Any, wiremock: Any, killbill: Any, mail: Any) -> None:
    base, peer = env_url("APP_MANUAL_URL"), env_url("APP_MANUAL_PEER_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    order = paid_class_move(base, rider, killbill, secret, "PQR-58-S")
    oid = order["id"]
    path = "/v1/plates/PQR-58-S"
    read_row = {"plate": "PQR-58-S", "country": "NL", "model": "K50", "firstAdmissionYear": 2019, "registeredMassKg": 110.0}
    inspect = f"/api/desk/orders/{oid}/inspection"
    seen = len(wiremock.requests(path))
    refused(desk.post(inspect), 409, "registry_not_updated")
    assert len(wiremock.requests(path)) == seen + 1, "each request reads the plate fresh"
    wiremock.stub("GET", path, json={**read_row, "roadClass": 45, "plateColour": "blue"})
    refused(desk.post(inspect), 409, "registry_not_updated")
    wiremock.stub("GET", path, status=503, json={"error": "probe"})
    refused(desk.post(inspect), 503, "registry_unreachable")
    wiremock.stub("GET", path, json={**read_row, "roadClass": 25, "plateColour": "blue"})
    assert rider.order(oid)["state"] == "kit dispatched"
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, FITTER_EMAIL, FITTER_PASSWORD)
        target = f"{base}/desk/orders/{oid}"
        page.goto(target)
        button = role(page, "button", "Record inspection")
        settled(page, lambda: button.count() > 0, "button Record inspection should show")
        click(button)
        wait_text(page, status(page, "Inspection status"), "The registry still shows snorfiets. Inspection not recorded.")
        wiremock.stub("GET", path, json={**read_row, "roadClass": 45, "plateColour": "yellow"})
        click(button)
        wait_text(page, status(page, "Inspection status"), "Inspection recorded. Fit the new plate before riding.")
        settled(page, lambda: button.count() == 0 and has_focus(status(page, "Inspection status")), "focus moves to Inspection status")
        assert page.url == target
        page.reload()
        wait_text(page, status(page, "Order state"), "inspection passed")
    repeats = together([lambda s=s: s.post(inspect) for s in [desk, desk.at(peer)] * 3])
    assert {r.status_code for r in repeats} == {200} and {r.json()["state"] for r in repeats} == {"inspection passed"}
    messages = mails_to(mail, rider.email, 1, f"Inspection recorded for order {order['number']}")
    assert len(messages) == 1, "one inspection mail"
    body = text(messages[0])
    fee = next(l for l in order["lines"] if l["code"] == "INSPECT-NL")["grossCents"]
    assert "PQR-58-S" in body and "bromfiets" in body and re.search(re.escape(money(fee)) + r"\W*paid", body)
    plain = new_order(rider)
    pay_all(rider, killbill, secret, plain["id"])
    is_status(desk.post(f"/api/desk/orders/{plain['id']}/transitions", {"to": "kit dispatched"}), 200)
    refused(desk.post(f"/api/desk/orders/{plain['id']}/inspection"), 409, "illegal_transition")


def test_class_move_inspection_fee_spent_block(browser: Any, wiremock: Any, killbill: Any) -> None:
    base = env_url("APP_MANUAL_URL")
    secret = notification_secret(base, "_manual")
    rider = register(base)
    desk = fitter(base)
    order = paid_class_move(base, rider, killbill, secret, "LMN-31-K")
    oid = order["id"]
    wiremock.stub("GET", "/v1/plates/LMN-31-K", json={"plate": "LMN-31-K", "country": "NL", "model": "K50", "firstAdmissionYear": 2019,
                                                      "roadClass": 45, "plateColour": "yellow", "registeredMassKg": 110.0})
    passed = is_status(desk.post(f"/api/desk/orders/{oid}/inspection"), 200)
    assert passed["state"] == "inspection passed" and passed["withdrawalOpen"] is False
    refused(refund_line(desk, oid, line_of(passed, "INSPECT-NL")["id"], 100), 409, "fee_already_spent")
    refused(rider.post(f"/api/orders/{oid}/withdraw", {}, key=idempotency_key()), 409, "illegal_transition")
    assert sum(1 for _, t in kb_all(killbill, rider) if t["transactionType"] != "PURCHASE") == 0
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        browser_sign_in(page, base, FITTER_EMAIL, FITTER_PASSWORD)
        page.goto(f"{base}/desk/orders/{oid}")
        line_box = role(page, "combobox", "Refund line")
        settled(page, lambda: line_box.count() > 0, "combobox Refund line should show")
        select(line_box, "Inspection fee")
        fill(role(page, "textbox", "Refund amount in euros"), "1.00")
        click(role(page, "button", "Refund line"))
        wait_text(page, status(page, "Refund status"), "The inspection fee has been passed on and cannot be refunded.")
        browser_sign_in(page, base, rider.email, rider.password)
        page.goto(f"{base}/orders/{oid}")
        wait_text(page, status(page, "Order state"), "inspection passed")
        assert role(page, "button", "Withdraw").count() == 0
    assert is_status(refund_line(desk, oid, line_of(passed, "P-1500")["id"], 100), 202)["refunds"], "other lines stay refundable"


def test_run_manifest_and_health(app_url: str) -> None:
    for base, field in ((app_url, None), (env_url("APP_KILLBILL_DOWN_URL"), "killbill"), (env_url("APP_REGISTRY_DOWN_URL"), "registry")):
        health = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
        assert health.status_code == 200 and health.json() == {"status": "ok"}
        data = is_status(httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT), 200)
        assert data["killbill"] in ("up", "down") and data["registry"] in ("up", "down")
        assert datetime.fromisoformat(data["serverNow"].replace("Z", "+00:00"))
        if field:
            poll(lambda: httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT).json()[field] == "down", f"{field} should report down", BANNER_S + SLACK_S)
    port = free_port()
    with app_copy(port=port, DATABASE_URL=os.environ["DATABASE_URL"] + "_manual", KILLBILL_CALLBACK_ORIGIN=DEAD_ORIGIN) as base:
        assert base.endswith(str(port))
        assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_server_boundary(app_url: str) -> None:
    host = urlparse(app_url).netloc
    credentials = {"email": FITTER_EMAIL, "password": FITTER_PASSWORD}
    cross = httpx.post(app_url + "/api/auth/sign-in", json=credentials, headers={"Origin": "http://evil.example"}, timeout=HTTP_TIMEOUT)
    refused(cross, 403, "cross_origin")
    same = httpx.post(app_url + "/api/auth/sign-in", json=credentials, headers={"Origin": f"http://{host}"}, timeout=HTTP_TIMEOUT)
    assert same.status_code == 200
    frame = b'{"email":"a","password":""}'
    exact = frame[:-2] + b"x" * (BODY_LIMIT - len(frame)) + b'"}'
    assert len(exact) == BODY_LIMIT
    headers = {"Content-Type": "application/json"}
    assert httpx.post(app_url + "/api/auth/sign-in", content=exact, headers=headers, timeout=HTTP_TIMEOUT).status_code != 413
    over = frame[:-2] + b"x" * (BODY_LIMIT + 1 - len(frame)) + b'"}'
    refused(httpx.post(app_url + "/api/auth/sign-in", content=over, headers=headers, timeout=HTTP_TIMEOUT), 413, "payload_too_large")
    secret_values = [os.environ.get("DATABASE_URL", "")] + [v for v in (os.environ.get("KILLBILL_API_SECRET", ""), os.environ.get("KILLBILL_PASSWORD", "")) if len(v) >= 12]
    secret_values.append(notification_secret(app_url, ""))
    bodies = {}
    for path in ("/", "/configure", "/bikes", "/package.json", "/run.json", "/.env", "/tsconfig.json", "/src/server.ts", "/server.ts", "/../package.json"):
        response = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        bodies[path] = response.text
    for path in ("/package.json", "/run.json", "/tsconfig.json"):
        body = bodies[path]
        assert "run-manifest-v1" not in body and "npm run start" not in body and "npm run build" not in body, f"{path} must not be served"
    assets = set()
    for path in ("/", "/configure", "/bikes"):
        assets |= {a for a in re.findall(r'(?:src|href)="(/[^"]+)"', bodies[path])}
    for asset in assets:
        bodies[asset] = httpx.get(app_url + asset, timeout=HTTP_TIMEOUT).text
    for path, body in bodies.items():
        for value in secret_values:
            assert not value or value not in body, f"{path} serves a secret value"


def test_published_layouts(app_url: str, browser: Any) -> None:
    rider = register(app_url)
    with open_app(browser, f"{app_url}/") as page:
        browser_sign_in(page, app_url, rider.email, rider.password)
        page.set_viewport_size(DESKTOP)
        page.goto(configure_url(app_url))
        figures_ready(page)

        def boxes() -> dict[str, dict]:
            return {"plate": role(page, "textbox", "Plate").bounding_box(), "scene": scene_of(page).bounding_box(),
                    "clearance": clearance(page).bounding_box(), "rail": role(page, "region", "Price rail").bounding_box()}

        for width, height in ((375, 812), (767, 1024), (768, 1024), (1199, 800), (1200, 800), (1280, 800)):
            page.set_viewport_size({"width": width, "height": height})
            advance(page, 500)
            layout(page)
            if clearance(page).count() == 0 or not clearance(page).is_visible():
                select_part(page, "Traction pack", "traction-pack")
            advance(page, 200)
            b = boxes()
            if width < 768:
                sheet = role(page, "button", "Parts schedule").bounding_box()
                assert b["plate"]["y"] < b["scene"]["y"] < b["clearance"]["y"] < sheet["y"] < b["rail"]["y"], f"one column order at {width}"
                assert role(page, "button", "Menu").is_visible()
            else:
                schedule = parts_list(page).bounding_box()
                assert role(page, "button", "Menu").count() == 0 or not role(page, "button", "Menu").is_visible(), f"no Menu at {width}"
                assert b["plate"]["y"] < b["scene"]["y"] and b["clearance"]["y"] >= b["scene"]["y"] + b["scene"]["height"] - 1
                assert b["scene"]["x"] < schedule["x"], f"parts schedule right of the scene at {width}"
                if width < 1200:
                    assert b["rail"]["y"] >= b["clearance"]["y"], f"price rail beneath at {width}"
                    assert b["rail"]["width"] >= width * 0.8, f"price rail spans the width at {width}"
                else:
                    assert schedule["x"] < b["rail"]["x"] and b["rail"]["y"] < b["scene"]["y"] + b["scene"]["height"], f"three columns at {width}"
            canvas = scene_of(page).locator("canvas")
            sizes = canvas.evaluate("c => [c.width, c.height, c.clientWidth, c.clientHeight, Math.min(devicePixelRatio, 2)]")
            assert abs(sizes[0] - sizes[2] * sizes[4]) <= 1 and abs(sizes[1] - sizes[3] * sizes[4]) <= 1, "the drawing buffer follows the displayed size"

        page.set_viewport_size(PHONE)
        advance(page, 300)
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        travel = None
        settled(page, lambda: attr(clearance(page), "data-travel-mm") not in (None, "", "0.0"), "travel should move")
        travel = attr(clearance(page), "data-travel-mm")
        click(role(page, "button", "Parts schedule"))
        settled(page, lambda: role(page, "dialog", "Parts schedule").count() > 0, "sheet opens")
        page.set_viewport_size(TABLET)
        settled(page, lambda: role(page, "dialog", "Parts schedule").count() == 0, "crossing 768 closes the sheet at once", 2)
        settled(page, lambda: has_focus(part_row(page, "Traction pack")), "focus moves to the selected row")
        assert attr(clearance(page), "data-travel-mm") == travel, "selection and travel survive"
        assert page.evaluate("() => document.documentElement.scrollHeight >= innerHeight && getComputedStyle(document.body).overflow !== 'hidden'"), "no scroll lock remains"
        page.set_viewport_size(PHONE)
        advance(page, 300)
        click(role(page, "button", "Menu"))
        settled(page, lambda: role(page, "dialog", "Navigation").count() > 0, "drawer opens")
        page.set_viewport_size(TABLET)
        settled(page, lambda: role(page, "dialog", "Navigation").count() == 0, "crossing 768 closes the drawer at once", 2)
        settled(page, lambda: has_focus(role(page, "link", "Story")), "focus moves to link Story when the opener is hidden")
        drive_both(page)
        dialog = open_checkout(page)
        fill(role(dialog, "textbox", "City"), RESIZE_CITY)
        page.set_viewport_size(PHONE)
        advance(page, 500)
        assert dialog.count() == 1 and role(dialog, "textbox", "City").input_value() == RESIZE_CITY, "checkout stays open across the resize"
        layout(page)


def test_closed_panels_unavailable(app_url: str, browser: Any) -> None:
    with open_app(browser, configure_url(app_url)) as page:
        for viewport in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(viewport)
            advance(page, 500)
            figures_ready(page)
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            names = tab_order(page, 45)
            if viewport["width"] < 768:
                assert not set(names) & set(PART_NAMES + ["Bikes", "My orders", "My rides"]), f"closed panels reached by Tab: {names}"
            hidden = page.evaluate("() => { const e = document.activeElement; const r = e.getBoundingClientRect(); return e === document.body || (r.width > 0 && r.height > 0) }")
            assert hidden, "focus never lands on a hidden control"
        page.set_viewport_size(PHONE)
        advance(page, 300)
        menu = role(page, "button", "Menu")
        assert attr(menu, "aria-expanded") == "false"
        menu.focus()
        page.keyboard.press("Enter")
        drawer = role(page, "dialog", "Navigation")
        settled(page, lambda: drawer.count() > 0 and attr(menu, "aria-expanded") == "true", "the drawer opens from Menu")
        advance(page, PANEL_MS * 2)
        settled(page, lambda: has_focus(drawer), "the drawer takes focus")
        for _ in range(12):
            page.keyboard.press("Tab")
            assert has_focus(drawer), "Tab wraps inside the drawer"
        story = role(page, "link", "Story")
        box = story.bounding_box()
        page.keyboard.press("Escape")
        assert drawer.count() == 0 or not has_focus(drawer)
        assert not has_focus(story), "nothing inside is focusable from the first moment of closing"
        settled(page, lambda: has_focus(menu), "focus returns to Menu", 3)
        at_point = page.evaluate("([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.textContent : '' }", [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])
        assert at_point.strip() != "Story", "a closed link cannot be activated by click"
        page.keyboard.press("Enter")
        settled(page, lambda: drawer.count() > 0, "drawer reopens")
        page.keyboard.press("Escape")
        advance(page, PANEL_MS * 0.3)
        menu.focus()
        page.keyboard.press("Enter")
        advance(page, PANEL_MS * 3)
        settled(page, lambda: drawer.count() > 0 and attr(menu, "aria-expanded") == "true", "reopening during the closing motion leaves the panel open", 3)
        stays(page, lambda: drawer.count() > 0, "a stale close must not re-hide the reopened panel", 1)


def running_durations(page: Page, dialog: Locator) -> list[float]:
    return dialog.evaluate(
        "d => document.getAnimations().filter(a => a.effect && a.effect.target && (d.contains(a.effect.target) || a.effect.target.contains(d)))"
        ".map(a => a.effect.getComputedTiming().duration)") if dialog.count() else []


def test_motion_and_reduced_motion(app_url: str, browser: Any) -> None:
    with open_app(browser, configure_url(app_url)) as page:
        page.set_viewport_size(PHONE)
        figures_ready(page)
        scene = scene_of(page)
        scene.scroll_into_view_if_needed()
        advance(page, 1000)
        azimuth = scene_angles(page)[0]
        first = capture(scene)
        advance(page, 3000)
        assert difference(decode(first), decode(capture(scene))) <= 0.001, "two captures 3 seconds apart are identical"
        assert scene_angles(page)[0] == azimuth, "no idle turn"
        menu = role(page, "button", "Menu")
        menu.focus()
        page.keyboard.press("Enter")
        drawer = role(page, "dialog", "Navigation")
        settled(page, lambda: drawer.count() > 0, "the drawer opens", 3, 10)
        durations = running_durations(page, drawer)
        if durations:
            assert PANEL_MS * (1 - TIMING_TOLERANCE) <= max(durations) <= PANEL_MS * (1 + TIMING_TOLERANCE), f"drawer motion took {durations}"
        else:
            assert motion(drawer, PANEL_MS), "the drawer should have a measurable motion"
        page.keyboard.press("Escape")
        advance(page, PANEL_MS * 2)
        page.set_viewport_size(DESKTOP)
        advance(page, 300)
        lookup = role(page, "button", "Look up plate")
        declared = lookup.evaluate("e => [e, e.parentElement, ...e.querySelectorAll('*')].flatMap(n => getComputedStyle(n).transitionDuration.split(','))")
        timed = [float(v.strip()[:-2]) if v.strip().endswith("ms") else float(v.strip()[:-1]) * 1000 for v in declared]
        lookup.hover()
        timed += [v for v in running_durations(page, lookup) if isinstance(v, (int, float))]
        assert any(HOVER_MS * (1 - TIMING_TOLERANCE) <= v <= HOVER_MS * (1 + TIMING_TOLERANCE) for v in timed), f"hover feedback {timed}"
        select(role(page, "combobox", "Pack"), "P-2100 2100 Wh")
        settled(page, lambda: 170500 in rail_cents(page), "the final value is in data-cents at once", 5, 50)
        for _ in range(4):
            advance(page, FLIGHT_MS // 8)
            assert "€" in read(role(page, "region", "Price rail")), "numbers stay visible while counting"
    with open_app(browser, f"{app_url}/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        story = role(page, "region", "Teardown story")
        stills = story.locator("[data-story-stage][data-story-offsets]")
        settled(page, lambda: stills.count() == 6, "reduced motion stacks six stills")
        for index in range(6):
            still = stills.nth(index)
            stage = int(attr(still, "data-story-stage"))
            offsets = json.loads(attr(still, "data-story-offsets"))
            for part, (part_stage, axis, sign, distance) in STORY_PARTS.items():
                assert offsets[part][axis] == pytest.approx(sign * distance if part_stage <= stage else 0, abs=0.05), f"{part} on still {stage}"
            assert STORY_CAPTIONS[stage - 1] in read(still) or page_says(page, STORY_CAPTIONS[stage - 1])
        page.emulate_media(reduced_motion="no-preference")
        settled(page, lambda: stills.count() == 0 and scene_of(page).count() == 1, "turning the setting off swaps to the pinned story", 2)
        page.emulate_media(reduced_motion="reduce")
        settled(page, lambda: stills.count() == 6, "turning the setting on swaps to the stills", 2)
    with open_app(browser, configure_url(app_url), reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        click(part_row(page, "Traction pack"))
        advance(page, 150)
        assert row_attr(page, "Seat", "data-panel-fade") == "0.25", "panels at 25 percent at once"
        slider(page).focus()
        page.keyboard.press("End")
        settled(page, lambda: attr(clearance(page), "data-travel-mm") == "210.0", "the slider keeps working", 2)
        scene_of(page).scroll_into_view_if_needed()
        box = scene_of(page).bounding_box()
        before = scene_angles(page)
        page.mouse.move(box["x"] + 30, box["y"] + 30)
        page.mouse.down()
        page.mouse.move(box["x"] + 120, box["y"] + 30, steps=4)
        page.mouse.up()
        advance(page, 100)
        assert scene_angles(page)[0] != before[0], "dragging orbits under reduced motion"


def test_still_drawing_without_webgl(app_url: str, browser: Any) -> None:
    url = configure_url(app_url, plate="A-KLM-204", regCountry="BE", pack="P-2100")
    with open_app(browser, url, no_webgl=True) as page:
        page.set_viewport_size(DESKTOP)
        figures_ready(page)
        drawing = role(page, "img", "Moped drawing")
        settled(page, lambda: drawing.count() == 1, "img Moped drawing should replace the scene")
        drawing.scroll_into_view_if_needed()
        assert attr(drawing, "data-renderer") == "still" and role(page, "application", "Moped scene").count() == 0
        assert row_attr(page, "Traction pack", "data-position-mm") not in (None, "")
        drive(page, "Hub motor", "hub-motor")
        select_part(page, "Traction pack", "traction-pack")
        assert attr(drawing, "data-selected-part") == "traction-pack"
        region = clearance(page)
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        settled(page, lambda: attr(region, "data-travel-mm") == "5.0", "the slider moves the part")
        advance(page, 200)
        before = capture(drawing)
        page.keyboard.press("End")
        settled(page, lambda: attr(region, "data-contact") == "true", "first contact")
        advance(page, 1000)
        assert attr(region, "data-travel-mm") == "120.0" and attr(region, "data-fouling-feature") == "Centre stand brace"
        wait_contains(page, status(page, "Fit verdict"), fit(app_url, plate("A-KLM-204", "BE"), "P-2100")["sentence"])
        start = role(page, "button", "Start checkout")
        settled(page, lambda: enabled(start), "both rails driven")
        fill_rgb = primary_fill(start)
        box = drawing.bounding_box()
        x = float(attr(region, "data-fouling-screen-x")) - box["x"]
        y = float(attr(region, "data-fouling-screen-y")) - box["y"]
        assert square_near(capture(drawing), x, y, fill_rgb) >= FOUL_MIN_PIXELS, "a visible fouling edge at the published point"
        assert square_near(before, x, y, fill_rgb) == 0, "no fouling edge before contact"


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_SOURCE / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest[field], str) and manifest[field].strip()


def test_if_third_party_notices() -> None:
    notices = (APP_SOURCE / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"not in THIRD_PARTY_NOTICES.md: {missing}"
    for font in ("Big Shoulders Display", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices, font


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_no_extra_datastore() -> None:
    banned = {"redis", "ioredis", "mongodb", "mongoose", "sqlite3", "better-sqlite3", "mysql", "mysql2", "amqplib", "kafkajs", "bullmq", "memcached", "stripe"}
    assert not banned & {p.name for p in shipped_packages()}


def test_if_seeded_config_unchanged(app_url: str, wiremock: Any) -> None:
    for number, country, model, year, road, colour in REGISTRY_ROWS:
        found = is_status(post_json(app_url, "/api/plates/lookup", {"plate": number, "country": country}), 200)
        assert (found["model"], found["firstAdmissionYear"], found["roadClass"], found["plateColour"]) == (model, year, road, colour), number
    for path in APP_SOURCE.glob("*compose*.y*ml"):
        assert not re.search(r"image:\s*\S*(redis|mongo|mysql|rabbitmq|kafka|minio)", path.read_text()), path.name


def test_if_no_other_origin(app_url: str, browser: Any) -> None:
    origin = "{0.scheme}://{0.netloc}".format(urlparse(app_url))
    with open_app(browser, f"{app_url}/") as page:
        foreign: list[str] = []
        page.on("request", lambda r: foreign.append(r.url) if r.url.startswith("http") and not same_origin(r.url, origin) else None)
        page.set_viewport_size(DESKTOP)
        for path in ("/", "/bikes", "/sign-in"):
            page.goto(app_url + path)
            advance(page, 1500)
        page.goto(configure_url(app_url))
        figures_ready(page)
        assert not foreign, f"requests to other origins: {foreign}"
