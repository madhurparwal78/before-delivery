from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import random
import re
import socket
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from typing import Any, Callable

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page
from playwright.sync_api import expect as playwright_expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    axe,
    capture,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    open_app,
    same_origin,
    select,
    state_styles,
    tab_order,
    tap,
    text,
    unique,
)


PASSWORD = "lacquer-demo-2026"
INES = "ines@marrowlark.test"
TOMAS = "tomas@marrowlark.test"
LUCA = "luca@marrowlark.test"
LUCA_NAME = "Luca Marent"
ODILE = "odile@marrowlark.test"
RAFAEL = "rafael@marrowlark.test"
HENRIETTA = "henrietta@owners.test"
KENJI = "kenji@owners.test"
OWNER_EMAIL = {"u-henrietta": HENRIETTA, "u-kenji": KENJI}
STAFF_IDS = {"u-ines", "u-tomas", "u-luca", "u-odile", "u-rafael"}
STAFF_NAMES = {"Ines Varga", "Tomas Riedl", "Luca Marent", "Odile Fenner", "Rafael Amsel"}
HOUSE_ACTOR = {"id": "house", "name": "Marrow & Lark Motor House"}
ZURICH = ZoneInfo("Europe/Zurich")
PANELS = [
    ("front_valance", "Front valance"), ("bonnet", "Bonnet"), ("front_wing_l", "Front wing L"),
    ("front_wing_r", "Front wing R"), ("door_l", "Door L"), ("door_r", "Door R"), ("sill_l", "Sill L"),
    ("sill_r", "Sill R"), ("roof", "Roof"), ("rear_quarter_l", "Rear quarter L"),
    ("rear_quarter_r", "Rear quarter R"), ("boot_lid", "Boot lid"),
]
PANEL_NAME = dict(PANELS)
STAGES = ["Intake", "Stripped", "Epoxy primer", "Guide coat", "2K primer", "Base", "Clear", "Cut and polish"]
BAND_LABEL = {"thin": "Thin", "factory": "Factory", "refinished": "Refinished", "filler_suspected": "Filler suspected"}
CLASS_LABEL = {"standard": "Standard", "covered_lift": "Covered lift", "sealed_capsule": "Sealed capsule"}
OPEN_RELEASE = ("requested", "booked", "staged")
SLOT_TIMES = [f"{h:02d}:{m:02d}" for h in range(8, 18) for m in (0, 30)]
STORAGE_NOTICE = "Photo storage is unreachable. Photos and condition reports can't be uploaded right now; bays, belongings and care rounds still work."
BILLING_NOTICE = "Billing is unreachable. Invoices can't be issued or paid right now; bay billing will catch up when it's back."
MAIL_NOTICE = "Email is unreachable. Owner emails are queued, and releases can't be completed until it's back."

J1001_LINES = [
    {"kind": "part", "description": "Bonnet hinge bushes", "quantity": "2", "unit_price": "37.45"},
    {"kind": "labour", "description": "Strip, prime and paint bonnet and front wings", "quantity": "26.50", "unit_price": None},
    {"kind": "paint_materials", "description": "Primer, base and clear", "quantity": "1", "unit_price": "218.30"},
]
J1002_LINES = [
    {"kind": "labour", "description": "Fill, flat and blend front valance chips", "quantity": "3.25", "unit_price": None},
    {"kind": "paint_materials", "description": "Touch-up primer and base", "quantity": "1", "unit_price": "64.80"},
]
J1003_LINES = [
    {"kind": "part", "description": "Touch-in kit", "quantity": "1", "unit_price": "12.90"},
    {"kind": "labour", "description": "Flat and touch in sill chips", "quantity": "1.75", "unit_price": None},
    {"kind": "paint_materials", "description": "Base and clear", "quantity": "1", "unit_price": "38.40"},
]
J1004_LINES = [{"kind": "labour", "description": "Lift boot floor mat and inspect for corrosion", "quantity": "2.00", "unit_price": None}]
TOTALS = {"J-1001": ("4470.70", "0.01"), "J-1002": ("579.45", "-0.02"), "J-1003": ("329.75", "0.00"), "J-1004": ("313.50", "0.01")}
LINE_SETS = {"J-1001": J1001_LINES, "J-1002": J1002_LINES, "J-1003": J1003_LINES, "J-1004": J1004_LINES}
VAT = Decimal("8.1") / Decimal(100)
LABOUR_RATE = Decimal("145.00")
CENT = Decimal("0.01")
FIVE_CENTIMES = Decimal("0.05")

VIEWPORTS = {
    "phone": {"width": 375, "height": 812},
    "tablet": {"width": 768, "height": 1024},
    "w1199": {"width": 1199, "height": 800},
    "w1200": {"width": 1200, "height": 800},
    "laptop": {"width": 1280, "height": 800},
}
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
LAPTOP = {"width": 1280, "height": 800}
TWO_PANES_FROM = 768
THREE_PANES_FROM = 1200
CLEARANCE_MM = 500
REREAD_MS = 10_000
ROUND_REREAD_MS = 15_000
NOTICE_CHECK_MS = 5_000
NOTICE_DEADLINE_S = 15
DEBOUNCE_MS = 300
QUEUE_DEADLINE_S = 30
CLAIM_ANSWER_S = 1
ABANDON_CLEAN_S = 5
ABANDONED_RUNS = 30
READ_BUDGET_S = 0.5
JSON_LIMIT = 100_000
UPLOAD_LIMIT = 10_000_000
TOUCH_MIN_PX = 44
OUTLINE_RATIO = 3
STEP_SETTLE_MS = 1_500
PANEL_WIPE_MAX_MS = 1_000
STAGGER_MIN_MS = 150
STAGGER_MAX_MS = 700
CROSS_SECTION_MIN_MS = 100
TRANSFER_AMOUNT = "1000.00"
AFTER_TRANSFER = "3470.70"
OVER_BALANCE = "3470.71"
LAST_BALANCE = "470.70"
BATTERY_OK = "12.62"
LOW_BATTERY = "12.39"
EDGE_BATTERY = "12.40"
TYRE_SPEC = "2.20"
ITEM_LABEL = "Key sets"


FILM = 158
BONNET_MIL = "6.2"
BONNET_MIL_UM = int((Decimal(BONNET_MIL) * Decimal("25.4")).quantize(Decimal(1), ROUND_HALF_UP))
ROOF_UM = 131
COAT_INTAKE = {
    "front_valance": 112, "bonnet": 142, "front_wing_l": 268, "front_wing_r": 335, "door_l": 80, "door_r": 79,
    "sill_l": 180, "sill_r": 181, "roof": 300, "rear_quarter_l": 301, "rear_quarter_r": 124, "boot_lid": 138,
}
COAT = [
    ("Intake", COAT_INTAKE),
    ("Stripped", {"bonnet": 0}),
    ("Epoxy primer", {"bonnet": 48}),
    ("2K primer", {"bonnet": 132, "roof": 250}),
    ("Base", {"bonnet": 158}),
]
MOTION_COAT = [
    ("Intake", {p: FILM for p, _ in PANELS}),
    ("Stripped", {p: 0 for p, _ in PANELS}),
    ("Epoxy primer", {p: FILM for p, _ in PANELS}),
]
COAT_NAMES = [n for n, _ in COAT]
MOTION_NAMES = [n for n, _ in MOTION_COAT]
MOTION_FROM = MOTION_COAT[1][1]["bonnet"]
TRANSFER_REF = "RF18 5390 0754 7034"
SMALL_AMOUNT = "100.00"
NOTE_TEXT = "checked cover"
LEAD_TITLE = "Lead's title"
MANAGER_TITLE = "Manager's title"
PROBE_TITLE = "Probe title"
PHOTO_NAME = "intake.png"
EVIL_HOST = "evil.test"
DEVICE_TZ = "America/Los_Angeles"
FAR_FUTURE = datetime(2031, 6, 1, 12, 0, tzinfo=timezone.utc)
FAR_PAST = datetime(2020, 1, 1, 12, 0, tzinfo=timezone.utc)
EVIL_ORIGIN = "http://evil.test"
SLOT_MIN_DAYS = 7
SLOT_MAX_DAYS = 3000
SLOT_TRIES = 8
HTTP_TIMEOUT_S = 60
DEADLINE_S = 60
SHORT_WAIT_S = 240
REREAD_PHASE_S = 30
POLL_S = 0.25
EXPECT_MS = 1_500
SETTLE_WAIT_S = 30
CREEP_ATTEMPT_MS = 250
TYPECHECK_SCRIPTS = ("typecheck", "type-check", "check-types", "tsc")
TSCONFIG_DEPTH = 3
TSCONFIG_REFERENCE = re.compile(r'"path"\s*:\s*"([^"]+)"')
DIALOG_SETTLE_MS = 1_000
CREEP_MS = 50
TAB_LIMIT = 80
MOTION_SAMPLES = 80
MOTION_SAMPLE_MS = 20
WIPE_MARK = 0.25
ORDER_SLACK_MS = 40
STREAM_TOTAL = 5_000_000
STREAM_CHUNK = 65_536
NO_EARLY_ANSWER_S = 0.3
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def instance(var: str) -> str:
    value = os.environ.get(var, "")
    assert value, f"{var} is not set"
    return value.rstrip("/")


def short_url() -> str:
    return instance("APP_SHORT_URL")


def minio_down() -> str:
    return instance("APP_MINIO_DOWN_URL")


def killbill_down() -> str:
    return instance("APP_KILLBILL_DOWN_URL")


def mail_down() -> str:
    return instance("APP_MAILPIT_DOWN_URL")


def tag() -> str:
    raw = re.sub(r"[^A-Za-z0-9]", "", unique("lq")[0])
    return "Q" + raw[-12:]


def pdf_bytes() -> bytes:
    return b"%PDF-1.4\n%" + os.urandom(32).hex().encode() + b"\n%%EOF\n"


def poll(fn, seconds=DEADLINE_S, what="condition"):
    end = time.monotonic() + seconds
    last = None
    while True:
        last = fn()
        if last:
            return last
        if time.monotonic() > end:
            raise AssertionError(f"timed out waiting for {what}: {last!r}")
        threading.Event().wait(POLL_S)


def eventually(page, check, seconds=DEADLINE_S, step_ms=1000):
    end = time.monotonic() + seconds
    while True:
        try:
            check()
            return
        except AssertionError:
            if time.monotonic() > end:
                raise
            advance(page, step_ms)


class Creeping:

    def __init__(self, target: Any, message: str | None = None) -> None:
        self.target, self.message = target, message

    def __getattr__(self, name: str) -> Callable[..., None]:
        page = self.target if isinstance(self.target, Page) else getattr(self.target, "page", None)
        if not isinstance(page, Page) or not name.startswith(("to_", "not_to_")):
            return getattr(playwright_expect(self.target, self.message), name)

        def retried(*args: Any, timeout: float | None = None, **kwargs: Any) -> None:
            deadline = time.monotonic() + (timeout / 1000 if timeout else SETTLE_WAIT_S)
            while True:
                try:
                    return getattr(playwright_expect(self.target, self.message), name)(*args, timeout=CREEP_ATTEMPT_MS, **kwargs)
                except AssertionError:
                    if time.monotonic() >= deadline:
                        raise
                try:
                    advance(page, CREEP_MS)
                except PlaywrightError:
                    pass

        return retried


def expect(target: Any, message: str | None = None) -> Creeping:
    return Creeping(target, message)


def text_visible(scope: Any, text: Any, timeout: float | None = None, exact: bool | None = None) -> None:
    page = scope if isinstance(scope, Page) else scope.page
    matches = scope.get_by_text(text, exact=exact)
    deadline = time.monotonic() + (timeout / 1000 if timeout else SETTLE_WAIT_S)
    while not any(matches.nth(i).is_visible() for i in range(matches.count())):
        if time.monotonic() >= deadline:
            raise AssertionError(f"no visible text {text!r}")
        threading.Event().wait(CREEP_ATTEMPT_MS / 1000)
        try:
            advance(page, CREEP_MS)
        except PlaywrightError:
            pass


def together(calls):
    barrier = threading.Barrier(len(calls))

    def run(fn):
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def day_of(value: str) -> str:
    return value[:10]


def zdate(day: str) -> str:
    d = date.fromisoformat(day[:10])
    return f"{d.day} {d.strftime('%b')} {d.year}"


def to_zurich(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(ZURICH)


def zdate_ts(ts: str) -> str:
    dt = to_zurich(ts)
    return f"{dt.day} {dt.strftime('%b')} {dt.year}"


def label_of(dt: datetime) -> str:
    return f"{dt.strftime('%a')} {dt.day} {dt.strftime('%b')} {dt.year}, {dt.strftime('%H:%M')}"


def slot_label(slot: str) -> str:
    return label_of(datetime.fromisoformat(slot))


def moment_label(ts: str) -> str:
    return label_of(to_zurich(ts))


def status(page, name):
    return page.get_by_role("status", name=name)


def quoted(version) -> str:
    return f'"{version}"'


def stage_text(names, k) -> str:
    return f"{names[k]}, stage {k + 1} of {len(names)}"


def announce(names, k, panel, um) -> str:
    return f"{stage_text(names, k)}. {PANEL_NAME[panel]}: {um} µm, {BAND_LABEL[band_of(um)]}."


class Api:
    def __init__(self, base: str, email: str | None = None, password: str = PASSWORD, renew: bool = True):
        self.base = base.rstrip("/")
        parts = urlparse(self.base)
        self.origin = f"{parts.scheme}://{parts.netloc}"
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, headers={"Origin": self.origin})
        self.email = email
        self.password = password
        self.renew = renew
        self.user = None
        if email:
            self.sign_in()

    def sign_in(self):
        r = self.c.post("/api/session", json={"email": self.email, "password": self.password})
        assert r.status_code == 200, f"sign-in {self.email} on {self.base}: {r.status_code} {r.text}"
        self.user = r.json()["user"]

    def send(self, method, path, body, h):
        if body is None:
            return self.c.request(method, path, headers=h)
        return self.c.request(method, path, json=body, headers=h)

    def call(self, method, path, body=None, key=None, headers=None):
        h = dict(headers or {})
        if key is not None:
            h["Idempotency-Key"] = key
        if method in ("POST", "PATCH", "PUT") and body is None:
            body = {}
        r = self.send(method, path, body, h)
        if self.renew and self.email and r.status_code == 401:
            try:
                code = r.json().get("error")
            except ValueError:
                code = None
            if code == "session_expired":
                self.sign_in()
                r = self.send(method, path, body, h)
        return r

    def ok(self, method, path, body=None, key=None, headers=None):
        r = self.call(method, path, body, key, headers)
        assert r.status_code in (200, 201, 204), f"{method} {path}: {r.status_code} {r.text}"
        return r.json() if r.content else {}

    def cookies(self):
        return [{"name": c.name, "value": c.value, "url": self.origin} for c in self.c.cookies.jar]

    def cookie_header(self):
        return "; ".join(f"{c.name}={c.value}" for c in self.c.cookies.jar)


def set_units(api: Api, film="um", pressure="bar", distance="km"):
    api.ok("PUT", "/api/me/units", {"film": film, "pressure": pressure, "distance": distance})


def upload_report(api: Api, car_id: str, data: bytes):
    return api.c.post(f"/api/cars/{car_id}/condition-report", files={"file": ("report.pdf", data, "application/pdf")})


def upload_photo(api: Api, car_id: str, data: bytes, name="intake.png", ctype="image/png", kind="intake", job_id=None):
    fields = {"kind": kind}
    if job_id:
        fields["job_id"] = job_id
    return api.c.post(f"/api/cars/{car_id}/photos", data=fields, files={"file": (name, data, ctype)})


def register_car(api: Api, body: dict) -> dict:
    r = api.call("POST", "/api/cars", body)
    if r.status_code == 422 and set(r.json().get("errors", {})) == {"odometer.value"}:
        r = api.call("POST", "/api/cars", {**body, "odometer": {**body["odometer"], "value": str(body["odometer"]["value"])}})
    assert r.status_code == 201, f"POST /api/cars: {r.status_code} {r.text}"
    return r.json()["car"]


CLEANUP_ERRORS: list[str] = []


class Garage:

    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.clients: dict = {}
        self.cars: list = []

    def as_(self, email, base=None) -> Api:
        b = (base or self.base).rstrip("/")
        if (b, email) not in self.clients:
            self.clients[(b, email)] = Api(b, email)
        return self.clients[(b, email)]

    def home(self, base):
        b = (base or self.base).rstrip("/")
        return b if b == os.environ.get("APP_SHORT_URL", "").rstrip("/") else self.base

    def car(self, owner="u-kenji", length=4000, width=1700, schedule=True, tyre=TYRE_SPEC, store=True,
            cls=None, code=None, base=None, model=None):
        model = model or tag()
        body = {
            "owner_id": owner, "year": 1971, "make": "Lark", "model": model, "registration": model[-20:],
            "colour": "Blu Lancia", "length_mm": length, "width_mm": width,
            "odometer": {"value": 112045, "unit": "km"}, "tyre_spec": {"value": tyre, "unit": "bar"},
            "startup_schedule": schedule,
        }
        car = register_car(self.as_(INES, base), body)
        self.cars.append((self.home(base), car["id"]))
        return self.store(car["id"], cls, code, base) if store else car

    def store(self, car_id, cls=None, code=None, base=None):
        api = self.as_(INES, base)
        bays = api.ok("GET", f"/api/bays?fits={car_id}")["bays"]
        pick = [b for b in bays if b["eligible"] and cls in (None, b["class"]) and code in (None, b["code"])]
        assert pick, f"no free bay fits car {car_id}: {[(b['code'], b['reason']) for b in bays]}; earlier cleanups failed: {CLEANUP_ERRORS[-3:]}"
        return api.ok("POST", f"/api/cars/{car_id}/bay", {"bay_id": pick[0]["id"]})["car"]

    def detail(self, car_id, base=None):
        return self.as_(RAFAEL, base).ok("GET", f"/api/cars/{car_id}")["car"]

    def owner_api(self, car, base=None):
        return self.as_(OWNER_EMAIL[car["owner"]["id"]], base)

    def slot(self, base=None):
        earliest = self.as_(INES, base).ok("GET", "/api/releases/earliest-slot")["earliest"]
        day = date.fromisoformat(earliest[:10]) + timedelta(days=random.randint(SLOT_MIN_DAYS, SLOT_MAX_DAYS))
        if day.weekday() == 6:
            day += timedelta(days=1)
        return f"{day.isoformat()}T{random.choice(SLOT_TIMES)}"

    def request(self, car_id, base=None, slot=None, key=None):
        owner = self.owner_api(self.detail(car_id, base), base)
        for _ in range(SLOT_TRIES):
            chosen = slot or self.slot(base)
            r = owner.call("POST", "/api/releases", {"car_id": car_id, "slot": chosen}, key=key or idempotency_key())
            if slot is None and r.status_code == 409 and r.json().get("error") == "slot_taken":
                continue
            assert r.status_code == 201, f"request release: {r.status_code} {r.text}"
            return r.json()["release"]
        raise AssertionError("no free release slot found")

    def open_release(self, car_id, base=None):
        return next((r for r in self.detail(car_id, base)["releases"] if r["status"] in OPEN_RELEASE), None)

    def staged(self, car_id, base=None):
        rel = self.open_release(car_id, base) or self.request(car_id, base)
        ines = self.as_(INES, base)
        if rel["status"] == "requested":
            rel = ines.ok("POST", f"/api/releases/{rel['id']}/book")["release"]
        if rel["status"] == "booked":
            rel = ines.ok("POST", f"/api/releases/{rel['id']}/stage")["release"]
        return rel

    def empty(self, car_id, base=None):
        ines = self.as_(INES, base)
        for item in self.detail(car_id, base)["belongings"]:
            if item["count_in"] > 0:
                ines.ok("POST", f"/api/belongings/{item['id']}/movements", {"direction": "out", "count": item["count_in"]})

    def settle(self, car_id, base=None):
        lead = self.as_(ODILE, base)
        mgr = self.as_(RAFAEL, base)
        for j in self.detail(car_id, base)["jobs"]:
            job = lead.ok("GET", f"/api/jobs/{j['id']}")["job"]
            if job["status"] == "in_progress":
                job = lead.ok("POST", f"/api/jobs/{job['id']}/finish")["job"]
            if job["invoice_id"]:
                inv = mgr.ok("GET", f"/api/invoices/{job['invoice_id']}")["invoice"]
                if Decimal(inv["balance"]) > 0:
                    r = self.pay(inv["id"], inv["balance"], base=base)
                    assert r.status_code == 200, r.text

    def complete(self, car_id, base=None):
        self.settle(car_id, base)
        rel = self.staged(car_id, base)
        self.empty(car_id, base)
        return self.as_(INES, base).ok("POST", f"/api/releases/{rel['id']}/complete")

    def cleanup(self):
        for base, car_id in reversed(self.cars):
            try:
                if self.detail(car_id, base)["status"] == "stored":
                    self.complete(car_id, base)
            except Exception as e:
                CLEANUP_ERRORS.append(f"{car_id}: {e!r}"[:600])

    def job(self, car, lines=None, base=None):
        body = {"car_id": car["id"], "title": f"Respray {car['model']}", "lines": lines or J1001_LINES}
        return self.as_(ODILE, base).ok("POST", "/api/jobs", body)["job"]

    def etag(self, job_id, base=None, email=ODILE):
        return self.as_(email, base).call("GET", f"/api/jobs/{job_id}").headers["etag"]

    def send(self, job_id, base=None):
        return self.as_(ODILE, base).ok("POST", f"/api/jobs/{job_id}/send", headers={"If-Match": self.etag(job_id, base)})["job"]

    def approved(self, owner="u-kenji", lines=None, base=None, **kw):
        car = self.car(owner, base=base, **kw)
        job = self.job(car, lines, base)
        self.send(job["id"], base)
        job = self.as_(OWNER_EMAIL[owner], base).ok("POST", f"/api/jobs/{job['id']}/approve")["job"]
        return car, job

    def log(self, job_id, name, values, base=None, unit="um", email=ODILE):
        readings = [{"panel": p, "value": v, "unit": unit} for p, v in values.items()]
        return self.as_(email, base).call("POST", f"/api/jobs/{job_id}/stages", {"name": name, "readings": readings})

    def stack(self, job_id, stages, base=None):
        for name, values in stages:
            r = self.log(job_id, name, values, base)
            assert r.status_code == 201, f"log {name}: {r.status_code} {r.text}"

    def finished(self, owner="u-kenji", lines=None, base=None):
        car, job = self.approved(owner, lines, base)
        self.stack(job["id"], [("Intake", {p: FILM for p, _ in PANELS})], base)
        job = self.as_(ODILE, base).ok("POST", f"/api/jobs/{job['id']}/finish")["job"]
        return car, job

    def invoiced(self, owner="u-kenji", lines=None, base=None):
        car, job = self.finished(owner, lines, base)
        out = self.as_(ODILE, base).ok("POST", f"/api/jobs/{job['id']}/invoice", key=idempotency_key())
        return car, out["job"], out["invoice"]

    def pay(self, invoice_id, amount, reference=TRANSFER_REF, base=None, key=None):
        return self.as_(RAFAEL, base).call(
            "POST", f"/api/invoices/{invoice_id}/payments", {"reference": reference, "amount": amount},
            key=key or idempotency_key())


@pytest.fixture
def garage(app_url):
    g = Garage(app_url)
    yield g
    g.cleanup()


@contextmanager
def screen(browser, base, email, path, size=LAPTOP, reduced_motion="no-preference", api=None):
    base = base.rstrip("/")
    with open_app(browser, base + "/sign-in", reduced_motion=reduced_motion) as page:
        page.set_viewport_size(size)
        client = api or (Api(base, email) if email else None)
        if client:
            page.context.add_cookies(client.cookies())
        page.goto(base + path)
        yield page


def tab_into(page, locator, presses=TAB_LIMIT):
    for _ in range(presses):
        page.keyboard.press("Tab")
        if locator.evaluate("(el) => el.contains(document.activeElement)"):
            return
    raise AssertionError("keyboard focus never reached the control")


def focus_inside(locator) -> bool:
    return locator.evaluate("(el) => el.contains(document.activeElement) && document.activeElement !== document.body")


def kb_account(killbill, email):
    return poll(lambda: killbill.account(email), QUEUE_DEADLINE_S * 2, f"Kill Bill account {email}")


def kb_subs(killbill, email, car_id, pred=lambda s: True, seconds=QUEUE_DEADLINE_S * 2):
    acct = kb_account(killbill, email)

    def find():
        subs = [s for s in killbill.subscriptions(acct["accountId"])
                if any(str(s.get(k) or "").endswith(f"car-{car_id}") for k in ("externalKey", "bundleExternalKey"))]
        return subs if subs and all(pred(s) for s in subs) else None

    return poll(find, seconds, f"subscription for {car_id}")


def kb_invoice(killbill, email, kb_invoice_id):
    acct = kb_account(killbill, email)
    return next((i for i in killbill.invoices(acct["accountId"]) if i.get("invoiceId") == kb_invoice_id), None)


def kb_invoices_for(killbill, email, description):
    acct = kb_account(killbill, email)
    return [i for i in killbill.invoices(acct["accountId"])
            if any(item.get("description") == description for item in i.get("items") or [])]


def kb_payments(killbill, email, ids):
    acct = kb_account(killbill, email)
    return [p for p in killbill.payments(acct["accountId"]) if p.get("paymentId") in ids]


def kb_refund(payment_id: str, amount: str):
    r = httpx.post(
        f"{os.environ['KILLBILL_URL'].rstrip('/')}/1.0/kb/payments/{payment_id}/refunds",
        json={"amount": float(amount), "currency": "CHF"},
        auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
        headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"], "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
                 "X-Killbill-CreatedBy": "verifier"},
        timeout=HTTP_TIMEOUT_S,
    )
    assert r.status_code in (200, 201), f"Kill Bill refund: {r.status_code} {r.text}"


def mails(mail, subject, count, seconds=QUEUE_DEADLINE_S * 2):
    poll(lambda: sum(m.get("Subject") == subject for m in mail.messages(0, 0.2)) >= count, seconds, f"mail {subject!r}")
    return [m for m in mail.messages(0) if m.get("Subject") == subject]


def no_mail(mail, subject):
    return [m for m in mail.messages(0) if m.get("Subject") == subject] == []


def app_sessions_busy(pg: Postgres) -> int:
    rows = pg.rows(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user "
        "AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')")
    return rows[0]["n"]


def line_money(line):
    price = LABOUR_RATE if line["kind"] == "labour" else Decimal(line["unit_price"])
    net = (Decimal(line["quantity"]) * price).quantize(CENT, ROUND_HALF_UP)
    return net, (net * VAT).quantize(CENT, ROUND_HALF_UP)


def band_of(um):
    if um is None:
        return None
    if um < 80:
        return "thin"
    if um <= 180:
        return "factory"
    if um <= 300:
        return "refinished"
    return "filler_suspected"


def derive(stages):
    cur = {p: None for p, _ in PANELS}
    layers = {p: [] for p, _ in PANELS}
    out = []
    for name, values in stages:
        for p, _ in PANELS:
            if p not in values:
                continue
            v, prev = values[p], cur[p]
            if v < 20:
                layers[p] = []
            elif prev is None or v > prev:
                layers[p] = layers[p] + [[name, v - (prev or 0)]]
            elif v < prev:
                diff = prev - v
                stack = [list(x) for x in layers[p]]
                while diff > 0 and stack:
                    if stack[-1][1] <= diff:
                        diff -= stack[-1][1]
                        stack.pop()
                    else:
                        stack[-1][1] -= diff
                        diff = 0
                layers[p] = stack
            cur[p] = v
        out.append({p: (cur[p], band_of(cur[p]), [tuple(x) for x in layers[p]]) for p, _ in PANELS})
    return out


def panel_label(panel, um, film="um"):
    if um is None:
        return f"{PANEL_NAME[panel]}, No reading"
    reading = f"{um} µm" if film == "um" else f"{(Decimal(um) / Decimal('25.4')).quantize(Decimal('0.1'), ROUND_HALF_UP)} mil"
    return f"{PANEL_NAME[panel]}, {reading}, {BAND_LABEL[band_of(um)]}"


def assert_panes(page, names, width):
    boxes = [page.get_by_role("region", name=n).bounding_box() for n in names]
    assert all(boxes), f"panes missing: {names}"
    a, b, c = boxes
    if width < TWO_PANES_FROM:
        assert b["y"] >= a["y"] + a["height"] - 1 and c["y"] >= b["y"] + b["height"] - 1, f"not stacked: {boxes}"
    elif width < THREE_PANES_FROM:
        assert abs(a["y"] - b["y"]) < 2 and b["x"] > a["x"], f"first two not side by side: {boxes}"
        assert c["y"] >= max(a["y"] + a["height"], b["y"] + b["height"]) - 1, f"third not below: {boxes}"
        assert c["width"] > max(a["width"], b["width"]), f"third pane not full width: {boxes}"
    else:
        assert abs(a["y"] - b["y"]) < 2 and abs(b["y"] - c["y"]) < 2, f"not one row: {boxes}"
        assert a["x"] < b["x"] < c["x"], f"wrong order: {boxes}"


COLOUR_FN = r"(?:rgba?|oklch|oklab|lch|lab|color)\([^)]*\)"


def _srgb(linear: float) -> float:
    linear = min(1.0, max(0.0, linear))
    return 255 * (12.92 * linear if linear <= 0.0031308 else 1.055 * linear ** (1 / 2.4) - 0.055)


def _from_xyz_d65(x: float, y: float, z: float):
    r = 3.2409699 * x - 1.5373832 * y - 0.4986108 * z
    g = -0.9692436 * x + 1.8759675 * y + 0.0415551 * z
    b = 0.0556301 * x - 0.2039770 * y + 1.0569715 * z
    return _srgb(r), _srgb(g), _srgb(b)


def parse_rgb(value: str):
    m = re.match(r"\s*(rgba?|oklch|oklab|lch|lab|color)\(([^)]*)\)", value or "")
    if not m:
        return None
    fn, body = m.group(1), m.group(2).replace(",", " ")
    parts, _, alpha = body.partition("/")
    words = parts.split()
    if fn in ("rgb", "rgba") and len(words) == 4:
        words, alpha = words[:3], words[3]
    if alpha.strip():
        a = alpha.strip()
        if (float(a[:-1]) / 100 if a.endswith("%") else float(a)) == 0:
            return None

    def num(w: str, scale: float = 1.0) -> float:
        return 0.0 if w == "none" else (float(w[:-1]) / 100 * scale if w.endswith("%") else float(w))

    if fn in ("rgb", "rgba"):
        return tuple(num(w, 255) for w in words[:3])
    if fn == "color":
        space, comps = words[0], [num(w, 1) for w in words[1:4]]
        if space in ("srgb", "display-p3", "a98-rgb", "rec2020", "prophoto-rgb"):
            return tuple(255 * min(1.0, max(0.0, c)) for c in comps)
        if space == "srgb-linear":
            return tuple(_srgb(c) for c in comps)
        if space in ("xyz", "xyz-d65"):
            return _from_xyz_d65(*comps)
        return None
    if fn in ("oklab", "oklch"):
        L = num(words[0], 1)
        if fn == "oklch":
            c, h = num(words[1], 0.4), math.radians(num(words[2]))
            a, b = c * math.cos(h), c * math.sin(h)
        else:
            a, b = num(words[1], 0.4), num(words[2], 0.4)
        l_, m_, s_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
        r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
        g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
        bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_
        return _srgb(r), _srgb(g), _srgb(bl)
    L = num(words[0], 100)
    if fn == "lch":
        c, h = num(words[1], 150), math.radians(num(words[2]))
        a, b = c * math.cos(h), c * math.sin(h)
    else:
        a, b = num(words[1], 125), num(words[2], 125)
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    inv = lambda t: t ** 3 if t ** 3 > 0.008856 else (116 * t - 16) / 903.3
    x, y, z = 0.96422 * inv(fx), inv(fy), 0.82521 * inv(fz)
    return _from_xyz_d65(0.9554734 * x - 0.0230985 * y + 0.0632593 * z, -0.0283697 * x + 1.0099956 * y + 0.0210414 * z, 0.0123140 * x - 0.0205077 * y + 1.3303659 * z)


def contrast(a, b) -> float:
    def lum(rgb):
        chans = []
        for c in rgb:
            c = c / 255
            chans.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
        return 0.2126 * chans[0] + 0.7152 * chans[1] + 0.0722 * chans[2]

    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


ICON_JS = """(el) => {
  // An icon may be an element (svg, img, role=img), a CSS pseudo-element, a background or mask image, or a glyph.
  const scope = [el, el.parentElement, ...el.querySelectorAll('*'), ...el.parentElement.querySelectorAll('*')];
  if (scope.some((n) => n.matches('svg,img,[role=img]'))) return true;
  const drawn = (n, pseudo) => {
    const cs = getComputedStyle(n, pseudo);
    const content = pseudo ? cs.content : 'normal';
    if (pseudo && (!content || content === 'none' || content === 'normal')) return false;
    return (pseudo && content !== '""') || cs.backgroundImage !== 'none' || (cs.maskImage || cs.webkitMaskImage || 'none') !== 'none';
  };
  // A background or mask counts only on a small inner element, so a tinted line itself never passes as an icon.
  const small = (n) => n !== el && n !== el.parentElement && n.getBoundingClientRect().width <= 48;
  if (scope.some((n) => drawn(n, '::before') || drawn(n, '::after') || (small(n) && drawn(n, null)))) return true;
  return /[\\u2190-\\u2BFF\\uE000-\\uF8FF]/.test(el.parentElement.textContent);
}"""


BOUNDARY_JS = """(el) => {
  const out = [];
  const cs = getComputedStyle(el);
  if (parseFloat(cs.borderTopWidth) > 0) out.push(cs.borderTopColor);
  out.push(cs.backgroundColor);
  // An outline may also be drawn with the outline property or a box-shadow ring (for example Tailwind ring-1).
  if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) out.push(cs.outlineColor);
  for (const c of (cs.boxShadow || '').match(/(?:rgba?|oklch|oklab|lch|lab|color)\\([^)]*\\)/g) || []) out.push(c);
  for (const n of [el, ...el.querySelectorAll('*')]) {
    if (n instanceof SVGElement) { const s = getComputedStyle(n); out.push(s.stroke); }
    else { const s = getComputedStyle(n); if (parseFloat(s.borderTopWidth) > 0) out.push(s.borderTopColor); }
  }
  return out;
}"""


def ground(page):
    bg = parse_rgb(page.evaluate("getComputedStyle(document.body).backgroundColor"))
    return bg or parse_rgb(page.evaluate("getComputedStyle(document.documentElement).backgroundColor")) or (255.0, 255.0, 255.0)


def focus_ring(focus: dict) -> list:
    colours = [focus["outline-color"]] if focus["outline-style"] != "none" else []
    colours += re.findall(COLOUR_FN, focus["box-shadow"] or "")
    return [c for c in map(parse_rgb, colours) if c]


def test_wf_cross_cutting_roles(app_url):
    roles = {INES: "concierge", TOMAS: "care_technician", ODILE: "workshop_lead", RAFAEL: "house_manager",
             KENJI: "owner", HENRIETTA: "owner"}
    clients = {}
    for email, role in roles.items():
        clients[email] = Api(app_url, email)
        me = clients[email].ok("GET", "/api/me")
        assert me["user"]["email"] == email and me["user"]["role"] == role
    anon = Api(app_url)
    assert anon.call("GET", "/api/health").status_code == 200
    assert anon.call("GET", "/api/status").status_code == 200
    for path in ("/api/me", "/api/cars", "/api/bays", "/api/care-round", "/api/jobs", "/api/invoices",
                 "/api/releases", "/api/board", "/api/staff", "/api/house", "/api/owners", "/api/cars/c-etype"):
        r = anon.call("GET", path)
        assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}, (path, r.text)
    r = anon.call("POST", "/api/session", {"email": KENJI, "password": PASSWORD + "x"})
    assert r.status_code == 401 and r.json() == {"error": "invalid_credentials"}
    forbidden = [
        (TOMAS, "POST", "/api/cars", {}), (KENJI, "POST", "/api/cars", {}), (INES, "GET", "/api/board", None),
        (INES, "GET", "/api/invoices", None), (ODILE, "GET", "/api/staff", None), (TOMAS, "POST", "/api/jobs", {}),
        (KENJI, "GET", "/api/board", None), (KENJI, "GET", "/api/owners", None), (KENJI, "GET", "/api/bays", None),
        (INES, "POST", "/api/cars/c-etype/care-entries", {}), (ODILE, "POST", "/api/cars/c-etype/belongings", {}),
        (TOMAS, "POST", "/api/jobs/j-1004/finish", {}), (INES, "PATCH", "/api/staff/u-luca", {"active": False}),
    ]
    for email, method, path, body in forbidden:
        r = clients[email].call(method, path, body)
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}, (email, method, path, r.text)
    assert clients[RAFAEL].call("GET", "/api/board").status_code == 200
    assert clients[TOMAS].call("GET", "/api/care-round").status_code == 200
    assert clients[KENJI].call("GET", "/api/releases/earliest-slot").status_code == 200
    assert clients[INES].call("GET", "/api/cars/c-etype").status_code == 200
    assert Api(app_url, LUCA).ok("GET", "/api/me")["user"]["role"] == "care_technician"


def test_wf_cross_cutting_error_order(app_url, garage):
    ines = garage.as_(INES)
    tomas = garage.as_(TOMAS)
    anon = Api(app_url)
    r = ines.call("GET", "/api/no-such-route")
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    r = anon.call("GET", "/api/cars/no-such-car")
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    r = anon.c.post("/api/cars", content=pdf_bytes(), headers={"Content-Type": "application/pdf"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    r = anon.call("POST", "/api/cars", {}, headers={"Origin": EVIL_ORIGIN})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    r = ines.call("GET", "/api/invoices/no-such-invoice")
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    r = tomas.call("POST", "/api/cars", {})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    bad = {"owner_id": "u-kenji", "year": 1971, "make": "", "model": "Fulvia", "registration": "R" * 21,
           "colour": "Blu Lancia", "length_mm": 1999, "width_mm": 2601,
           "odometer": {"value": 10, "unit": "km"}, "tyre_spec": {"value": "0.49", "unit": "bar"}, "startup_schedule": True}
    first = ines.call("POST", "/api/cars", bad)
    second = ines.call("POST", "/api/cars", bad)
    assert first.status_code == 422 and set(first.json()) == {"errors"}
    errors = first.json()["errors"]
    assert errors["make"] == "Enter 1 to 60 characters."
    assert errors["registration"] == "Enter 1 to 20 characters."
    assert errors["length_mm"] == "Enter a length from 2000 to 7000 mm."
    assert errors["width_mm"] == "Enter a width from 1200 to 2600 mm."
    assert errors["tyre_spec.value"] == "Enter a pressure from 0.50 to 5.00 bar."
    assert (second.status_code, second.json()) == (first.status_code, first.json())
    r = ines.call("POST", "/api/cars", {**bad, "owner_id": "u-nobody"})
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    waiting = garage.car(store=False)
    for key in (idempotency_key(), None):
        r = tomas.call("POST", f"/api/cars/{waiting['id']}/care-entries", {}, key=key)
        assert r.status_code == 409 and r.json() == {"error": "car_not_stored"}, r.text
    stored = garage.car()
    r = tomas.call("POST", f"/api/cars/{stored['id']}/care-entries", {"started": True, "battery_v": None, "tyres": None, "note": ""})
    assert r.status_code == 422 and r.json() == {"errors": {"idempotency_key": "Send an Idempotency-Key header."}}
    assert garage.detail(stored["id"])["care_entries"] == []


def test_idempotent_submissions(app_url, garage, killbill):
    car = garage.car()
    path = f"/api/cars/{car['id']}/care-entries"
    tomas = garage.as_(TOMAS)
    key = idempotency_key()
    body = {"started": False, "battery_v": BATTERY_OK, "tyres": None, "note": ""}
    first = tomas.call("POST", path, body, key=key)
    assert first.status_code == 201, first.text
    again = tomas.call("POST", path, body, key=key)
    assert again.status_code == 201 and again.json() == first.json()
    other = Api(minio_down(), TOMAS).call("POST", path, body, key=key)
    assert other.status_code == 201 and other.json() == first.json()
    conflict = tomas.call("POST", path, {**body, "battery_v": EDGE_BATTERY}, key=key)
    assert conflict.status_code == 409 and conflict.json() == {"error": "idempotency_conflict"}
    entries = garage.detail(car["id"])["care_entries"]
    assert [e["id"] for e in entries] == [first.json()["entry"]["id"]]

    _, _, inv = garage.invoiced(lines=J1001_LINES)
    pay_key = idempotency_key()
    down = Api(killbill_down(), RAFAEL).call("POST", f"/api/invoices/{inv['id']}/payments",
                                             {"reference": TRANSFER_REF, "amount": TRANSFER_AMOUNT}, key=pay_key)
    assert down.status_code == 503 and down.json() == {"error": "billing_unavailable"}
    up = garage.pay(inv["id"], TRANSFER_AMOUNT, key=pay_key)
    assert up.status_code == 200 and up.json()["invoice"]["balance"] == AFTER_TRANSFER
    replay = garage.pay(inv["id"], TRANSFER_AMOUNT, key=pay_key)
    assert replay.status_code == 200 and replay.json() == up.json()
    ids = [p["killbill_payment_id"] for p in garage.as_(RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]["payments"]]
    assert len(ids) == 1
    paid = kb_payments(killbill, KENJI, ids)
    assert len(paid) == 1 and Decimal(str(paid[0]["purchasedAmount"])) == Decimal(TRANSFER_AMOUNT)


def test_bay_fit_clearance(garage):
    ines = garage.as_(INES)
    assert ines.ok("GET", "/api/house")["clearance_mm"] == CLEARANCE_MM
    free = [b for b in ines.ok("GET", "/api/bays")["bays"] if b["car"] is None and b["class"] == "standard"]
    bay = max(free, key=lambda b: (b["length_mm"], b["width_mm"]))
    length, width = bay["length_mm"] - CLEARANCE_MM, bay["width_mm"] - CLEARANCE_MM
    for extra_l, extra_w in ((1, 0), (0, 1)):
        car = garage.car(length=length + extra_l, width=width + extra_w, store=False)
        fits = {b["id"]: b for b in ines.ok("GET", f"/api/bays?fits={car['id']}")["bays"]}
        assert fits[bay["id"]]["eligible"] is False and fits[bay["id"]]["reason"] == "too_small"
        r = ines.call("POST", f"/api/cars/{car['id']}/bay", {"bay_id": bay["id"]})
        assert r.status_code == 409 and r.json() == {"error": "bay_too_small"}
        assert garage.detail(car["id"])["status"] == "awaiting_intake"
    exact = garage.car(length=length, width=width, store=False)
    fits = {b["id"]: b for b in ines.ok("GET", f"/api/bays?fits={exact['id']}")["bays"]}
    assert fits[bay["id"]]["eligible"] is True and fits[bay["id"]]["reason"] is None
    placed = ines.ok("POST", f"/api/cars/{exact['id']}/bay", {"bay_id": bay["id"]})["car"]
    assert placed["status"] == "stored" and placed["bay"]["code"] == bay["code"]


def test_one_car_per_bay(app_url, garage):
    cars = [garage.car(store=False, length=3900, width=1600) for _ in range(4)]
    ines = garage.as_(INES)
    bay = next(b for b in ines.ok("GET", f"/api/bays?fits={cars[0]['id']}")["bays"] if b["eligible"])
    clients = [Api(app_url, INES), Api(app_url, INES), Api(minio_down(), INES), Api(minio_down(), INES)]
    results = together([lambda c=c, car=car: c.call("POST", f"/api/cars/{car['id']}/bay", {"bay_id": bay["id"]})
                        for c, car in zip(clients, cars)])
    wins = [r for r in results if r.status_code == 200]
    losses = [r for r in results if r.status_code != 200]
    assert len(wins) == 1, [r.text for r in results]
    assert all(r.status_code == 409 and r.json() == {"error": "bay_occupied"} for r in losses)
    winner = wins[0].json()["car"]["id"]
    after = {b["id"]: b for b in ines.ok("GET", "/api/bays")["bays"]}
    assert after[bay["id"]]["car"]["id"] == winner
    assert sum(garage.detail(c["id"])["status"] == "stored" for c in cars) == 1


def test_moves_stay_in_class(garage, killbill):
    car = garage.car("u-henrietta", length=3900, width=1600, cls="standard")
    ines = garage.as_(INES)
    first_bay = car["bay"]["code"]
    fits = ines.ok("GET", f"/api/bays?fits={car['id']}")["bays"]
    own = next(b for b in fits if b["code"] == first_bay)
    assert own["eligible"] is False and own["reason"] == "occupied"
    other_class = next(b for b in fits if b["car"] is None and b["class"] != "standard")
    assert other_class["reason"] == "class_change" and other_class["eligible"] is False
    r = ines.call("POST", f"/api/cars/{car['id']}/bay", {"bay_id": other_class["id"]})
    assert r.status_code == 409 and r.json() == {"error": "bay_class_change"}
    target = next(b for b in fits if b["eligible"] and b["class"] == "standard")
    moved = ines.ok("POST", f"/api/cars/{car['id']}/bay", {"bay_id": target["id"]})["car"]
    assert moved["bay"]["code"] == target["code"] and moved["status"] == "stored"
    bays = {b["code"]: b for b in ines.ok("GET", "/api/bays")["bays"]}
    assert bays[first_bay]["car"] is None and bays[target["code"]]["car"]["id"] == car["id"]
    subs = kb_subs(killbill, HENRIETTA, car["id"])
    assert len(subs) == 1 and subs[0]["planName"] == "bay-standard-monthly"


def test_condition_report_bytes(garage):
    car = garage.car()
    ines = garage.as_(INES)
    r = upload_report(ines, car["id"], b"not a pdf")
    assert r.status_code == 422 and r.json()["errors"]["file"] == "Upload a PDF."
    assert S3().keys(f"cars/{car['id']}/condition-reports/") == []
    data = pdf_bytes()
    r = upload_report(ines, car["id"], data)
    assert r.status_code == 201, r.text
    report = r.json()["report"]
    assert report["sha256"] == hashlib.sha256(data).hexdigest() and report["size_bytes"] == len(data)
    assert report["uploaded_by"]["id"] == "u-ines"
    key = f"cars/{car['id']}/condition-reports/{report['id']}.pdf"
    assert S3().keys(f"cars/{car['id']}/condition-reports/") == [key]
    assert S3().get(key) == data
    down = ines.call("GET", f"/api/condition-reports/{report['id']}/file")
    assert down.status_code == 200 and down.content == data
    assert down.headers["Content-Type"].startswith("application/pdf")
    again = upload_report(ines, car["id"], pdf_bytes())
    assert again.status_code == 409 and again.json() == {"error": "report_already_signed"}
    assert S3().keys(f"cars/{car['id']}/condition-reports/") == [key]
    assert garage.detail(car["id"])["condition_report"]["sha256"] == report["sha256"]


def test_photos_attach_after_storage(garage):
    car = garage.car()
    ines = garage.as_(INES)
    prefix = f"cars/{car['id']}/photos/"
    r = upload_photo(ines, car["id"], b"GIF89a....", name="x.gif", ctype="image/gif")
    assert r.status_code == 422 and r.json()["errors"]["file"] == "Upload a JPEG or PNG image."
    down = upload_photo(Api(minio_down(), INES), car["id"], PNG)
    assert down.status_code == 503 and down.json() == {"error": "storage_unavailable"}
    assert garage.detail(car["id"])["photos"] == [] and S3().keys(prefix) == []
    r = upload_photo(ines, car["id"], PNG)
    assert r.status_code == 201, r.text
    photo = r.json()["photo"]
    assert photo["attached"] is True and photo["kind"] == "intake"
    assert S3().keys(prefix) == [f"{prefix}{photo['id']}.png"] and S3().get(f"{prefix}{photo['id']}.png") == PNG
    content = ines.call("GET", f"/api/photos/{photo['id']}/content")
    assert content.status_code == 200 and content.content == PNG
    assert content.headers["Content-Type"].split(";")[0].strip() == photo["content_type"]
    assert [p["id"] for p in garage.detail(car["id"])["photos"]] == [photo["id"]]


def test_bay_picker_keyboard_touch(browser, app_url, garage):
    car = garage.car(length=4600, width=1900, store=False)
    ines = garage.as_(INES)
    fits = ines.ok("GET", f"/api/bays?fits={car['id']}")["bays"]

    def state(b):
        if b["eligible"]:
            return "free"
        occupant = (b["car"] or {}).get("name")
        return {"occupied": f"occupied by {occupant}", "too_small": "too small", "class_change": "other class"}[b["reason"]]

    eligible_row1 = [b for b in fits if b["row"] == 1 and b["eligible"]]
    assert eligible_row1, "no eligible bay in row 1"
    target = eligible_row1[0]
    with screen(browser, app_url, INES, f"/cars/{car['id']}", PHONE) as page:
        page.get_by_role("button", name="Choose bay").click()
        dialog = page.get_by_role("dialog", name="Choose bay")
        plan = dialog.get_by_role("group", name="Floor plan")
        ineligible = next(b for b in fits if not b["eligible"])
        tap(plan.get_by_role("button", name=f"Bay {ineligible['code']}, {CLASS_LABEL[ineligible['class']]}, {state(ineligible)}"))
        expect(dialog.get_by_role("button", name=f"Assign bay {ineligible['code']}")).to_have_count(0)
        tap(plan.get_by_role("button", name=f"Bay {target['code']}, {CLASS_LABEL[target['class']]}, free"))
        expect(dialog.get_by_role("button", name=f"Assign bay {target['code']}")).to_be_visible()
    with screen(browser, app_url, INES, f"/cars/{car['id']}") as page:
        page.get_by_role("button", name="Choose bay").click()
        dialog = page.get_by_role("dialog", name="Choose bay")
        plan = dialog.get_by_role("group", name="Floor plan")
        for b in fits:
            expect(plan.get_by_role("button", name=f"Bay {b['code']}, {CLASS_LABEL[b['class']]}, {state(b)}")).to_have_count(1)
        origin = fits[0]
        tab_into(page, plan)
        first = plan.get_by_role("button", name=re.compile(rf"^Bay {re.escape(origin['code'])}, "))
        expect(first).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(first).to_be_focused()
        if not origin["eligible"]:
            page.keyboard.press("Enter")
            expect(dialog.get_by_role("button", name=f"Assign bay {origin['code']}")).to_have_count(0)
            expect(first).to_be_focused()
        for _ in range(target["column"] - 1):
            page.keyboard.press("ArrowRight")
        expect(plan.get_by_role("button", name=re.compile(rf"^Bay {target['code']}, "))).to_be_focused()
        page.keyboard.press("Enter")
        assign = dialog.get_by_role("button", name=f"Assign bay {target['code']}")
        expect(assign).to_be_focused()
        page.keyboard.press("Enter")
        expect(status(page, "Bay updates")).to_have_text(f"{car['name']} assigned to bay {target['code']}.")
    stored = garage.detail(car["id"])
    assert stored["status"] == "stored" and stored["bay"]["code"] == target["code"]


def test_wf_intake_happy(browser, app_url, garage, killbill):
    model = tag()
    name = f"1971 Lark {model}"
    pdf = pdf_bytes()
    ines = garage.as_(INES)
    with screen(browser, app_url, INES, "/bays") as page:
        page.get_by_role("button", name="Register car").click()
        d = page.get_by_role("dialog", name="Register car")
        select(d.get_by_role("combobox", name="Owner"), "Kenji Arlow")
        d.get_by_role("spinbutton", name="Year").fill("1971")
        d.get_by_role("textbox", name="Make").fill("Lark")
        d.get_by_role("textbox", name="Model").fill(model)
        d.get_by_role("textbox", name="Registration").fill(model[-20:])
        d.get_by_role("textbox", name="Colour").fill("Blu Lancia")
        d.get_by_role("spinbutton", name="Length (mm)").fill("3975")
        d.get_by_role("spinbutton", name="Width (mm)").fill("1555")
        d.get_by_role("textbox", name=re.compile(r"^Odometer \(")).fill("112045")
        d.get_by_role("textbox", name=re.compile(r"^Tyre pressure \(")).fill("1.80")
        d.get_by_role("checkbox", name="Start-up schedule").check()
        d.get_by_role("button", name="Register").click()
        expect(status(page, "Bay updates")).to_have_text(f"{name} registered.")
        found = poll(lambda: ines.ok("GET", f"/api/cars?q={quote(model)}")["cars"], DEADLINE_S, "registered car")
        car = found[0]
        garage.cars.append((app_url.rstrip("/"), car["id"]))
        assert car["status"] == "awaiting_intake" and car["owner"]["id"] == "u-kenji"
        fits = ines.ok("GET", f"/api/bays?fits={car['id']}")["bays"]
        target = next(b for b in fits if b["eligible"] and b["row"] == 1)

        page.goto(app_url.rstrip("/") + f"/cars/{car['id']}")
        page.get_by_role("button", name="Choose bay").click()
        dialog = page.get_by_role("dialog", name="Choose bay")
        plan = dialog.get_by_role("group", name="Floor plan")
        tab_into(page, plan)
        for _ in range(target["column"] - 1):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        expect(status(page, "Bay updates")).to_have_text(f"{name} assigned to bay {target['code']}.")
        sub = kb_subs(killbill, KENJI, car["id"], lambda s: s.get("chargedThroughDate"))[0]
        eventually(page, lambda: expect(page.get_by_label("Bay billing", exact=True)).to_contain_text(
            f"Billed monthly, paid through {zdate(sub['chargedThroughDate'])}", timeout=EXPECT_MS))

        page.get_by_role("button", name="Add item").click()
        add = page.get_by_role("dialog", name="Add item")
        select(add.get_by_role("combobox", name="Item kind"), "Key set")
        add.get_by_role("textbox", name="Item label").fill(ITEM_LABEL)
        add.get_by_role("spinbutton", name="Count").fill("2")
        add.get_by_role("button", name="Add").click()
        expect(status(page, "Belongings updates")).to_have_text(f"{ITEM_LABEL}: 2 checked in.")

        page.get_by_label("Signed condition report (PDF)").set_input_files(
            {"name": "report.pdf", "mimeType": "application/pdf", "buffer": pdf})
        page.get_by_role("button", name="Upload report").click()
        expect(status(page, "Upload updates")).to_have_text(f"Signed condition report stored for {name}.")
        expect(page.get_by_role("link", name="Download signed report")).to_be_visible()
        text_visible(page, hashlib.sha256(pdf).hexdigest())

        page.get_by_label("Intake photo").set_input_files({"name": "intake.png", "mimeType": "image/png", "buffer": PNG})
        page.get_by_role("button", name="Upload photo").click()
        expect(status(page, "Upload updates")).to_have_text(f"Photo attached to {name}.")
        expect(page.get_by_role("list", name="Photos").get_by_role("listitem")).to_have_count(1)
        expect(page.get_by_role("table", name="Belongings")).to_contain_text(ITEM_LABEL)

    detail = garage.detail(car["id"])
    assert detail["bay"]["code"] == target["code"] and detail["status"] == "stored"
    assert [(i["label"], i["count_in"]) for i in detail["belongings"]] == [(ITEM_LABEL, 2)]
    reports = S3().keys(f"cars/{car['id']}/condition-reports/")
    assert len(reports) == 1 and S3().get(reports[0]) == pdf
    photos = S3().keys(f"cars/{car['id']}/photos/")
    assert len(photos) == 1 and S3().get(photos[0]) == PNG
    subs = kb_subs(killbill, KENJI, car["id"])
    assert len(subs) == 1 and subs[0]["planName"] == f"bay-{target['class'].replace('_', '-')}-monthly"


def test_wf_intake_search(browser, app_url, garage):
    tok = tag()
    garage.car(store=False, model=f"{tok}Fx")
    garage.car(store=False, model=f"{tok}Fxy")
    early, late = f"{tok}Fx", f"{tok}Fxy"
    parked = []

    def hold_early(route):
        q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
        if q == early and not parked:
            parked.append(route)
            return
        route.fallback()

    with screen(browser, app_url, INES, "/bays") as page:
        expect(status(page, "Bay updates")).to_have_text("")
        page.route("**/api/cars?**", hold_early)
        box = page.get_by_role("searchbox", name="Search cars")
        box.fill(early)
        advance(page, DEBOUNCE_MS)
        poll(lambda: parked, DEADLINE_S, "early search held")
        box.fill(late)
        advance(page, DEBOUNCE_MS)
        rows = page.get_by_role("table", name="Cars").get_by_role("row").filter(has_text=tok)
        eventually(page, lambda: expect(rows).to_have_count(1, timeout=EXPECT_MS), step_ms=100)
        expect(status(page, "Bay updates")).to_have_text("1 car found.")
        parked[0].fallback()
        advance(page, DEBOUNCE_MS)
        page.wait_for_load_state("networkidle")
        expect(rows).to_have_count(1)
        expect(status(page, "Bay updates")).to_have_text("1 car found.")
        assert parse_qs(urlparse(page.url).query).get("q") == [late]


def test_search_address(browser, app_url, garage):
    tok = tag()
    seeded = [garage.car(store=False, model=f"{tok}{suffix}") for suffix in "AB"]
    with screen(browser, app_url, INES, "/bays") as page:
        box = page.get_by_role("searchbox", name="Search cars")
        history = page.evaluate("history.length")
        box.fill(tok)
        advance(page, DEBOUNCE_MS)
        rows = page.get_by_role("table", name="Cars").get_by_role("row").filter(has_text=tok)
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"[?&]q="), timeout=EXPECT_MS), step_ms=100)
        expect(rows).to_have_count(2)
        expect(status(page, "Bay updates")).to_have_text(f"{len(seeded)} cars found.")
        assert parse_qs(urlparse(page.url).query).get("q") == [tok]
        assert page.evaluate("history.length") == history
        page.reload()
        box = page.get_by_role("searchbox", name="Search cars")
        expect(box).to_have_value(tok)
        expect(page.get_by_role("table", name="Cars").get_by_role("row").filter(has_text=tok)).to_have_count(2)
        expect(status(page, "Bay updates")).to_have_text("")
        box.fill("")
        advance(page, DEBOUNCE_MS)
        eventually(page, lambda: expect(page).not_to_have_url(re.compile(r"[?&]q="), timeout=EXPECT_MS), step_ms=100)
        expect(page.get_by_role("table", name="Cars").get_by_role("row").filter(has_text=tok)).to_have_count(2)
    with screen(browser, app_url, INES, f"/bays?q={quote(tok)}") as page:
        expect(page.get_by_role("searchbox", name="Search cars")).to_have_value(tok)
        expect(page.get_by_role("table", name="Cars").get_by_role("row").filter(has_text=tok)).to_have_count(2)
        expect(status(page, "Bay updates")).to_have_text("")


def test_belongings_ledger(garage):
    car = garage.car()
    ines = garage.as_(INES)
    item = ines.ok("POST", f"/api/cars/{car['id']}/belongings", {"kind": "key_set", "label": ITEM_LABEL, "count": 2})["item"]
    assert item["count_in"] == 2
    zero = ines.ok("POST", f"/api/cars/{car['id']}/belongings", {"kind": "cover", "label": "Indoor cover", "count": 0})["item"]
    assert zero["count_in"] == 0
    r = ines.call("POST", f"/api/cars/{car['id']}/belongings", {"kind": "cover", "label": "Indoor cover", "count": 21})
    assert r.status_code == 422 and r.json()["errors"]["count"] == "Enter a whole number from 0 to 20."
    out = ines.ok("POST", f"/api/belongings/{item['id']}/movements", {"direction": "out", "count": 1})
    assert out["item"]["count_in"] == 1 and out["movement"]["by"]["id"] == "u-ines"
    r = ines.call("POST", f"/api/belongings/{item['id']}/movements", {"direction": "out", "count": 2})
    assert r.status_code == 409 and r.json() == {"error": "insufficient_items"}
    r = ines.call("POST", f"/api/belongings/{item['id']}/movements", {"direction": "out", "count": 0})
    assert r.status_code == 422 and r.json()["errors"]["count"] == "Enter a whole number from 1 to 20."
    moves = ines.ok("GET", f"/api/belongings/{item['id']}/movements")["movements"]
    assert [(m["direction"], m["count"]) for m in moves] == [("in", 2), ("out", 1)]
    rel = garage.staged(car["id"])
    r = ines.call("POST", f"/api/releases/{rel['id']}/complete")
    assert r.status_code == 409 and r.json()["error"] == "belongings_checked_in"
    assert [(i["id"], i["count_in"]) for i in r.json()["items"]] == [(item["id"], 1)]
    assert ines.ok("GET", f"/api/releases/{rel['id']}")["release"]["status"] == "staged"


def test_care_entries_flags(garage):
    car = garage.car(tyre=TYRE_SPEC)
    tomas = garage.as_(TOMAS)
    path = f"/api/cars/{car['id']}/care-entries"
    flagged = tomas.ok("POST", path, {"started": False, "battery_v": LOW_BATTERY,
                                       "tyres": {"unit": "bar", "fl": "2.20", "fr": "2.41", "rl": "2.20", "rr": "2.20"},
                                       "note": ""}, key=idempotency_key())
    e = flagged["entry"]
    assert set(e["flags"]) == {"battery_low", "tyre_pressure"}
    assert e["by"]["id"] == "u-tomas" and e["at"].endswith("Z") and e["battery_v"] == LOW_BATTERY
    assert e["tyres_bar"] == {"fl": "2.20", "fr": "2.41", "rl": "2.20", "rr": "2.20"}
    assert flagged["message"].startswith(f"Round entry saved for {car['name']}. Flagged: ")
    assert "battery low" in flagged["message"] and "tyre pressure off" in flagged["message"]
    clean = tomas.ok("POST", path, {"started": False, "battery_v": EDGE_BATTERY,
                                     "tyres": {"unit": "bar", "fl": "2.40", "fr": "2.00", "rl": "2.20", "rr": "2.20"},
                                     "note": ""}, key=idempotency_key())
    assert clean["entry"]["flags"] == [] and clean["message"] == f"Round entry saved for {car['name']}."
    r = tomas.call("POST", path, {"started": False, "battery_v": None, "tyres": None, "note": ""}, key=idempotency_key())
    assert r.status_code == 422 and r.json()["errors"]["entry"] == "Record a start-up, a battery voltage or tyre pressures."
    r = tomas.call("POST", path, {"started": False, "battery_v": None,
                                  "tyres": {"unit": "bar", "fl": "2.20", "fr": None, "rl": None, "rr": None}, "note": ""},
                   key=idempotency_key())
    assert r.status_code == 422 and r.json()["errors"]["tyres"] == "Enter all four tyres from 0.50 to 5.00 bar."
    started = tomas.ok("POST", path, {"started": True, "battery_v": None, "tyres": None, "note": ""}, key=idempotency_key())
    assert started["entry"]["started"] is True and started["startup"]["status"] == "ok"
    assert len(garage.detail(car["id"])["care_entries"]) == 3


def test_startup_status_server(browser, garage):
    base = short_url()
    tomas = garage.as_(TOMAS, base)
    car = garage.car(base=base, schedule=True)
    plain = garage.car(base=base, schedule=False)
    st = tomas.ok("GET", f"/api/cars/{car['id']}")["car"]["startup"]
    assert st["scheduled"] is True and st["status"] == "ok" and st["next_due"]
    assert tomas.ok("GET", f"/api/cars/{plain['id']}")["car"]["startup"]["status"] == "not_scheduled"
    with screen(browser, base, TOMAS, "/round") as page:
        page.clock.set_system_time(FAR_FUTURE)
        page.reload()
        row = page.get_by_role("table", name="Care round").get_by_role("row").filter(has_text=car["name"])
        expect(row).to_contain_text(f"Next start-up due {zdate(st['next_due'])}")
        expect(page.get_by_role("table", name="Care round").get_by_role("row").filter(has_text=plain["name"])).to_contain_text("No start-up schedule")
        poll(lambda: tomas.ok("GET", f"/api/cars/{car['id']}")["car"]["startup"]["status"] == "overdue", SHORT_WAIT_S, "overdue")
        page.clock.set_system_time(FAR_PAST)
        page.reload()
        expect(page.get_by_role("table", name="Care round").get_by_role("row").filter(has_text=car["name"])).to_contain_text("Start-up overdue")


def test_wf_care_round_phone(browser, garage):
    base = short_url()
    tomas = garage.as_(TOMAS, base)
    set_units(tomas)
    car = garage.car(base=base, schedule=True)
    name = car["name"]
    poll(lambda: tomas.ok("GET", f"/api/cars/{car['id']}")["car"]["startup"]["status"] == "overdue", SHORT_WAIT_S, "overdue")
    with screen(browser, base, TOMAS, "/round", PHONE, api=Api(base, TOMAS)) as page:
        expect(page.get_by_role("button", name="Menu")).to_be_visible()
        listing = page.get_by_role("list", name="Care round")
        expect(listing).to_be_visible()
        expect(page.get_by_role("table", name="Care round")).to_have_count(0)
        rows = tomas.ok("GET", "/api/care-round")["cars"]
        statuses = [r["startup"]["status"] for r in rows]
        assert statuses == sorted(statuses, key=lambda s: s != "overdue")
        expect(listing.get_by_role("button", name=re.compile(r"^Log round entry for "))).to_have_count(len(rows))
        names = listing.get_by_role("button", name=re.compile(r"^Log round entry for ")).all_inner_texts()
        assert len(names) == len(rows)
        card = listing.get_by_role("listitem").filter(has=page.get_by_role("button", name=f"Log round entry for {name}"))
        expect(card).to_contain_text("Start-up overdue")
        tap(page.get_by_role("button", name=f"Log round entry for {name}"))
        d = page.get_by_role("dialog", name=f"Round entry: {name}")
        d.get_by_role("checkbox", name="Started the engine").check()
        d.get_by_role("textbox", name="Battery voltage (V)").fill(BATTERY_OK)
        tap(d.get_by_role("button", name="Save entry"))
        expect(d).to_be_hidden()
        due = tomas.ok("GET", f"/api/cars/{car['id']}")["car"]["startup"]["next_due"]
        expect(status(page, "Round updates")).to_have_text(f"Start-up logged for {name}. Next start-up due {zdate(due)}.")
        expect(card).to_contain_text(f"Next start-up due {zdate(due)}")
        expect(card).not_to_contain_text("Start-up overdue")
    entries = tomas.ok("GET", f"/api/cars/{car['id']}")["car"]["care_entries"]
    assert len(entries) == 1 and entries[0]["started"] is True and entries[0]["battery_v"] == BATTERY_OK
    assert entries[0]["by"]["id"] == "u-tomas"


def test_wf_care_round_rows_move(browser, garage):
    base = short_url()
    tomas = garage.as_(TOMAS, base)
    mover = garage.car(base=base, schedule=True)
    steady = garage.car(base=base, schedule=False)
    with screen(browser, base, TOMAS, "/round", api=Api(base, TOMAS)) as page:
        table = page.get_by_role("table", name="Care round")
        mover_row = table.get_by_role("row").filter(has_text=mover["name"])
        expect(mover_row).not_to_contain_text("Start-up overdue")
        page.get_by_role("button", name=f"Log round entry for {steady['name']}").click()
        d = page.get_by_role("dialog", name=f"Round entry: {steady['name']}")
        d.get_by_role("textbox", name="Battery voltage (V)").fill(BATTERY_OK)
        note = d.get_by_role("textbox", name="Note")
        note.fill(NOTE_TEXT)
        note.focus()
        scroll = page.evaluate("window.scrollY")
        eventually(page, lambda: expect(mover_row).to_contain_text("Start-up overdue", timeout=EXPECT_MS),
                   SHORT_WAIT_S, ROUND_REREAD_MS)
        expect(d).to_be_visible()
        expect(d.get_by_role("textbox", name="Battery voltage (V)")).to_have_value(BATTERY_OK)
        expect(note).to_have_value(NOTE_TEXT)
        expect(note).to_be_focused()
        assert page.evaluate("window.scrollY") == scroll
        order = [f"Log round entry for {r['car']['name']}" for r in tomas.ok("GET", "/api/care-round")["cars"]]
        shown = table.get_by_role("button", name=re.compile(r"^Log round entry for ")).evaluate_all(
            "(els) => els.map(e => e.getAttribute('aria-label') || e.textContent.trim())")
        assert [n for n in shown if n in order] == order
        d.get_by_role("button", name="Cancel").click()
        expect(page.get_by_role("button", name=f"Log round entry for {steady['name']}")).to_be_focused()


def test_wf_care_round_lost_answer(browser, app_url, garage):
    car = garage.car()
    name = car["name"]
    keys = []

    def lose_first(route):
        keys.append(route.request.headers.get("idempotency-key"))
        if len(keys) == 1:
            route.fetch()
            route.abort("connectionreset")
        else:
            route.fallback()

    with screen(browser, app_url, TOMAS, "/round") as page:
        page.route("**/api/cars/*/care-entries", lose_first)
        page.get_by_role("button", name=f"Log round entry for {name}").click()
        d = page.get_by_role("dialog", name=f"Round entry: {name}")
        d.get_by_role("textbox", name="Battery voltage (V)").fill(BATTERY_OK)
        d.get_by_role("button", name="Save entry").click()
        expect(status(page, "Round updates")).to_have_text("No answer from the server. Press Save entry again; it won't be logged twice.")
        expect(d.get_by_role("textbox", name="Battery voltage (V)")).to_have_value(BATTERY_OK)
        d.get_by_role("button", name="Save entry").click()
        expect(status(page, "Round updates")).to_have_text(f"Round entry saved for {name}.")
    assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
    assert len(garage.detail(car["id"])["care_entries"]) == 1

    released_keys = []

    def lose_release(route):
        if route.request.method != "POST":
            route.fallback()
            return
        released_keys.append(route.request.headers.get("idempotency-key"))
        if len(released_keys) == 1:
            route.fetch()
            route.abort("connectionreset")
        else:
            route.fallback()

    slot = garage.slot()
    with screen(browser, app_url, KENJI, f"/portal/cars/{car['id']}/release") as page:
        page.route("**/api/releases", lose_release)
        page.get_by_role("textbox", name="Date").fill(slot[:10])
        select(page.get_by_role("combobox", name="Time"), slot[11:])
        page.get_by_role("button", name="Request release").click()
        expect(status(page, "Release updates")).to_have_text("No answer from the server. Press Request release again; it won't be requested twice.")
        page.get_by_role("button", name="Request release").click()
        expect(page.get_by_role("heading", name="We've received your release request")).to_be_visible()
    assert len(released_keys) == 2 and released_keys[0] == released_keys[1]
    assert [r["status"] for r in garage.detail(car["id"])["releases"]] == ["requested"]


def test_collapsed_menu(browser, app_url):
    with screen(browser, app_url, TOMAS, "/round", TABLET) as page:
        nav = page.get_by_role("navigation", name="Main")
        links = nav.get_by_role("link").evaluate_all("(els) => els.map(e => e.textContent.trim())")
        assert links
        expect(page.get_by_role("button", name="Menu")).to_have_count(0)
    with screen(browser, app_url, TOMAS, "/round", PHONE) as page:
        menu = page.get_by_role("button", name="Menu")
        nav = page.get_by_role("navigation", name="Main")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(nav.get_by_role("link")).to_have_count(0)
        layout(page)
        assert not set(tab_order(page, 20)) & set(links)
        menu.click()
        expect(menu).to_have_attribute("aria-expanded", "true")
        expect(nav.get_by_role("link").first).to_be_focused()
        page.keyboard.press("Escape")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(menu).to_be_focused()
        expect(nav.get_by_role("link")).to_have_count(0)
        menu.click()
        nav.get_by_role("link").first.click()
        expect(page.get_by_role("button", name="Menu")).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("navigation", name="Main").get_by_role("link")).to_have_count(0)


def test_wf_care_round_session_expiry(browser, garage):
    base = short_url()
    car = garage.car(base=base, schedule=False)
    name = car["name"]
    tomas = Api(base, TOMAS, renew=False)
    set_units(tomas)
    posts = []
    with screen(browser, base, TOMAS, "/round", api=tomas) as page:
        page.on("request", lambda r: posts.append((r.url, r.method, r.headers.get("idempotency-key"), r.post_data))
                if r.method in ("POST", "PUT") else None)
        page.get_by_role("button", name=f"Log round entry for {name}").click()
        d = page.get_by_role("dialog", name=f"Round entry: {name}")
        d.get_by_role("textbox", name="Battery voltage (V)").fill(BATTERY_OK)
        start = time.monotonic()

        def expired():
            if time.monotonic() - start < REREAD_PHASE_S:
                advance(page, ROUND_REREAD_MS)
            r = tomas.call("GET", "/api/me")
            return r.status_code == 401 and r.json()["error"] == "session_expired"

        poll(expired, SHORT_WAIT_S, "session expiry")
        d.get_by_role("button", name="Save entry").click()
        again = page.get_by_role("dialog", name="Sign in again")
        expect(again).to_be_visible()
        expect(again).to_contain_text("Your session has ended. Sign in again to carry on.")
        expect(again).to_contain_text(TOMAS)
        expect(again.get_by_role("textbox", name="Password")).to_be_focused()
        expect(d.get_by_role("textbox", name="Battery voltage (V)")).to_have_value(BATTERY_OK)
        page.keyboard.press("Escape")
        expect(again).to_be_visible()
        again.get_by_role("textbox", name="Password").fill(PASSWORD)
        again.get_by_role("button", name="Sign in again").click()
        expect(status(page, "Round updates")).to_have_text(f"Round entry saved for {name}.")
        entry_posts = [p for p in posts if "/care-entries" in p[0]]
        assert len(entry_posts) == 2 and entry_posts[0][2] == entry_posts[1][2] and entry_posts[0][3] == entry_posts[1][3]

        poll(lambda: page.evaluate("fetch('/api/me').then(r => r.status)") == 401, SHORT_WAIT_S, "second expiry")
        page.get_by_role("button", name="Units").click()
        units = page.get_by_role("dialog", name="Units")
        units.get_by_role("radio", name="psi").check()
        units.get_by_role("button", name="Save units").click()
        again = page.get_by_role("dialog", name="Sign in again")
        expect(again).to_be_visible()
        again.get_by_role("textbox", name="Password").fill(PASSWORD)
        again.get_by_role("button", name="Sign in again").click()
        expect(status(page, "Settings updates")).to_have_text("Signed in again. Nothing was saved; press again.")
        assert len([p for p in posts if p[1] == "PUT" and "/api/me/units" in p[0]]) == 1
    assert len(garage.as_(RAFAEL, base).ok("GET", f"/api/cars/{car['id']}")["car"]["care_entries"]) == 1
    assert Api(base, TOMAS).ok("GET", "/api/me")["units"]["pressure"] == "bar"


def test_round_entry_outlives_car(browser, app_url, garage):
    car = garage.car()
    name = car["name"]
    with screen(browser, app_url, TOMAS, "/round") as page:
        page.get_by_role("button", name=f"Log round entry for {name}").click()
        d = page.get_by_role("dialog", name=f"Round entry: {name}")
        volts = d.get_by_role("textbox", name="Battery voltage (V)")
        volts.fill(BATTERY_OK)
        volts.focus()
        garage.complete(car["id"])
        eventually(page, lambda: expect(page.get_by_role("button", name=f"Log round entry for {name}")).to_have_count(0, timeout=EXPECT_MS),
                   step_ms=ROUND_REREAD_MS)
        expect(d).to_be_visible()
        expect(volts).to_have_value(BATTERY_OK)
        expect(volts).to_be_focused()
        d.get_by_role("button", name="Save entry").click()
        expect(d).to_be_hidden()
        expect(page.get_by_role("heading", name="Care round", level=1)).to_be_focused()
        copy = "This car is no longer in a bay."
        expect(status(page, "Round updates")).to_have_text(copy)
        advance(page, ROUND_REREAD_MS)
        advance(page, ROUND_REREAD_MS)
        expect(status(page, "Round updates")).to_have_text(copy)
    assert garage.detail(car["id"])["care_entries"] == []


def test_readings_stored_once(browser, app_url, garage):
    ines = garage.as_(INES)
    model = tag()
    car = register_car(ines, {
        "owner_id": "u-kenji", "year": 1971, "make": "Lark", "model": model, "registration": model[-20:],
        "colour": "Blu Lancia", "length_mm": 4000, "width_mm": 1700, "odometer": {"value": 29957, "unit": "mi"},
        "tyre_spec": {"value": "31.9", "unit": "psi"}, "startup_schedule": False})
    garage.cars.append((app_url.rstrip("/"), car["id"]))
    odometer_km = int((Decimal(29957) * Decimal("1.609344")).quantize(Decimal(1), ROUND_HALF_UP))
    assert car["odometer_km"] == odometer_km and car["tyre_spec_bar"] == TYRE_SPEC
    garage.store(car["id"])
    entry = garage.as_(TOMAS).ok("POST", f"/api/cars/{car['id']}/care-entries", {
        "started": False, "battery_v": None, "tyres": {"unit": "psi", "fl": "31.9", "fr": "31.9", "rl": "31.9", "rr": "31.9"},
        "note": ""}, key=idempotency_key())["entry"]
    assert entry["tyres_bar"] == {"fl": TYRE_SPEC, "fr": TYRE_SPEC, "rl": TYRE_SPEC, "rr": TYRE_SPEC}
    job = garage.job(car)
    garage.send(job["id"])
    garage.as_(KENJI).ok("POST", f"/api/jobs/{job['id']}/approve")
    lead = garage.as_(ODILE)
    readings = [{"panel": p, "value": FILM, "unit": "um"} for p, _ in PANELS if p != "bonnet"]
    readings.append({"panel": "bonnet", "value": BONNET_MIL, "unit": "mil"})
    r = lead.call("POST", f"/api/jobs/{job['id']}/stages", {"name": "Intake", "readings": readings})
    assert r.status_code == 201, r.text
    stack = lead.ok("GET", f"/api/jobs/{job['id']}/coat-stack")
    bonnet = next(p for p in stack["stages"][0]["panels"] if p["panel"] == "bonnet")
    assert bonnet["film_um"] == BONNET_MIL_UM
    try:
        set_units(lead, film="mil")
        with screen(browser, app_url, ODILE, f"/jobs/{job['id']}?stage=0&panel=bonnet", api=lead) as page:
            panels = page.get_by_role("group", name="Panel map")
            expect(panels.get_by_role("button", name=panel_label("bonnet", BONNET_MIL_UM, "mil"))).to_have_count(1)
            expect(panels.get_by_role("button", name=panel_label("front_valance", FILM, "mil"))).to_have_count(1)
            expect(page.get_by_label("Total film build", exact=True)).to_contain_text(f"{BONNET_MIL} mil")
    finally:
        set_units(lead)
    assert lead.ok("GET", f"/api/jobs/{job['id']}/coat-stack")["stages"][0]["panels"][1]["film_um"] == BONNET_MIL_UM


def test_paint_stages_readings(garage):
    car, job = garage.approved()
    jid = job["id"]
    lead = garage.as_(ODILE)
    all_panels = {p: FILM for p, _ in PANELS}
    r = garage.log(jid, "Intake", dict(list(all_panels.items())[:-1]))
    assert r.status_code == 422 and r.json()["errors"]["readings"] == "Intake needs a reading for every panel."
    r = garage.log(jid, "Polish", {"bonnet": FILM})
    assert r.status_code == 422 and r.json()["errors"]["name"] == "Choose a stage from the list."
    r = garage.log(jid, "Intake", all_panels)
    assert r.status_code == 201 and r.json()["job"]["status"] == "in_progress"
    assert r.json()["stage"]["readings_count"] == 12
    r = garage.log(jid, "Intake", all_panels)
    assert r.status_code == 409 and r.json() == {"error": "stage_already_logged"}
    assert garage.log(jid, "Base", {"bonnet": 158}).status_code == 201
    r = garage.log(jid, "Stripped", {"bonnet": 0})
    assert r.status_code == 409 and r.json() == {"error": "stage_out_of_order"}
    r = garage.log(jid, "Clear", {})
    assert r.status_code == 422 and r.json()["errors"]["readings"] == "Add at least one reading."
    r = garage.log(jid, "Clear", {"bonnet": 2001})
    assert r.status_code == 422 and r.json()["errors"]["readings[0].value"] == "Enter a reading from 0 to 2000 µm."
    r = lead.call("POST", f"/api/jobs/{jid}/stages", {"name": "Clear", "readings": [
        {"panel": "bonnet", "value": 160, "unit": "um"}, {"panel": "bonnet", "value": 161, "unit": "um"}]})
    assert r.status_code == 422 and r.json()["errors"]["readings[1].panel"] == "Choose a panel from the list."
    stages = lead.ok("GET", f"/api/jobs/{jid}")["job"]["stages"]
    assert [s["name"] for s in stages] == ["Intake", "Base"]
    intake = stages[0]
    added = lead.ok("POST", f"/api/jobs/{jid}/stages/{intake['id']}/readings", {"panel": "bonnet", "value": FILM, "unit": "um"})["reading"]
    assert added["film_um"] == FILM and added["logged_by"]["id"] == "u-odile"
    history = lead.ok("GET", f"/api/jobs/{jid}/panels/bonnet/readings")["readings"]
    assert [h["film_um"] for h in history] == [FILM, 158, FILM]
    assert all(h["logged_by"]["id"] == "u-odile" and h["logged_at"] for h in history)
    assert [h["logged_at"] for h in history] == sorted(h["logged_at"] for h in history)


def test_wf_paint_stages_keyboard(browser, app_url, garage):
    car, job = garage.approved()
    lead = garage.as_(ODILE)
    set_units(lead)
    with screen(browser, app_url, ODILE, f"/jobs/{job['id']}", api=lead) as page:
        opener = page.get_by_role("button", name="Log stage")
        tab_into(page, opener)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        d = page.get_by_role("dialog", name="Log stage")
        stage = d.get_by_role("combobox", name="Stage")
        expect(stage).to_be_focused()
        select(stage, "Intake")
        for pid, pname in PANELS:
            d.get_by_role("textbox", name=f"{pname} reading").focus()
            page.keyboard.type(str(FILM))
        stage.focus()
        page.keyboard.press("Shift+Tab")
        assert focus_inside(d) and not stage.evaluate("(el) => el === document.activeElement")
        page.keyboard.press("Tab")
        expect(stage).to_be_focused()
        d.get_by_role("button", name="Save stage").focus()
        page.keyboard.press("Enter")
        expect(d).to_be_hidden()
        expect(status(page, "Job updates")).to_have_text(f"Intake logged with {len(PANELS)} readings.")
        expect(page.get_by_role("button", name="Log stage")).to_be_focused()
        add = page.get_by_role("button", name="Add reading")
        tab_into(page, add)
        page.keyboard.press("Enter")
        ad = page.get_by_role("dialog", name="Add reading")
        expect(ad.get_by_role("combobox", name="Logged stage")).to_be_focused()
        page.keyboard.press("Escape")
        expect(ad).to_be_hidden()
        expect(add).to_be_focused()
        page.keyboard.press("Enter")
        select(ad.get_by_role("combobox", name="Logged stage"), "Intake")
        select(ad.get_by_role("combobox", name="Panel"), "Roof")
        ad.get_by_role("textbox", name="Reading").focus()
        page.keyboard.type(str(ROOF_UM))
        ad.get_by_role("button", name="Save reading").focus()
        page.keyboard.press("Enter")
        expect(status(page, "Job updates")).to_have_text(f"Reading saved: {PANEL_NAME['roof']} {ROOF_UM} µm.")
        expect(add).to_be_focused()
    roof = lead.ok("GET", f"/api/jobs/{job['id']}/panels/roof/readings")["readings"]
    assert [r["film_um"] for r in roof] == [FILM, ROOF_UM]


def test_wf_paint_stages_concurrent(app_url, garage):
    car, job = garage.approved()
    jid = job["id"]
    leads = [Api(app_url, ODILE), Api(app_url, ODILE), Api(minio_down(), ODILE), Api(minio_down(), RAFAEL)]
    intake = {"name": "Intake", "readings": [{"panel": p, "value": FILM, "unit": "um"} for p, _ in PANELS]}
    results = together([lambda c=c: c.call("POST", f"/api/jobs/{jid}/stages", intake) for c in leads])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    assert all(r.json() == {"error": "stage_already_logged"} for r in results if r.status_code == 409)

    def one(name):
        return {"name": name, "readings": [{"panel": "bonnet", "value": FILM, "unit": "um"}]}

    stripped, base = together([lambda: leads[0].call("POST", f"/api/jobs/{jid}/stages", one("Stripped")),
                               lambda: leads[2].call("POST", f"/api/jobs/{jid}/stages", one("Base"))])
    assert base.status_code == 201
    assert stripped.status_code == 201 or (stripped.status_code == 409 and stripped.json() == {"error": "stage_out_of_order"})
    clear, finish = together([lambda: leads[1].call("POST", f"/api/jobs/{jid}/stages", one("Clear")),
                              lambda: leads[3].call("POST", f"/api/jobs/{jid}/finish")])
    assert finish.status_code == 200
    assert clear.status_code == 201 or (clear.status_code == 409 and clear.json() == {"error": "invalid_transition"})
    final = leads[0].ok("GET", f"/api/jobs/{jid}")["job"]
    assert final["status"] == "finished"
    times = [s["logged_at"] for s in sorted(final["stages"], key=lambda s: STAGES.index(s["name"]))]
    assert times == sorted(times) and all(t <= final["finished_at"] for t in times)
    for pid, _ in PANELS:
        for reading in leads[0].ok("GET", f"/api/jobs/{jid}/panels/{pid}/readings")["readings"]:
            assert reading["logged_at"] <= final["finished_at"]
    r = leads[0].call("POST", f"/api/jobs/{jid}/stages", one("Cut and polish"))
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}
    r = leads[0].call("POST", f"/api/jobs/{jid}/stages/{final['stages'][0]['id']}/readings", {"panel": "roof", "value": FILM, "unit": "um"})
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}


def test_coat_stack_data(browser, app_url, garage):
    car, job = garage.approved()
    garage.stack(job["id"], COAT)
    lead = garage.as_(ODILE)
    set_units(lead)
    stack = lead.ok("GET", f"/api/jobs/{job['id']}/coat-stack")
    assert [p["id"] for p in stack["panels"]] == [p for p, _ in PANELS]
    expected = derive(COAT)
    assert [s["name"] for s in stack["stages"]] == [n for n, _ in COAT]
    for k, stage in enumerate(stack["stages"]):
        assert stage["index"] == k
        for panel in stage["panels"]:
            um, band, layers = expected[k][panel["panel"]]
            assert panel["film_um"] == um and panel["band"] == band, (k, panel)
            assert [(l["stage"], l["um"]) for l in panel["layers"]] == layers, (k, panel)
    bonnet = next(p for p in stack["stages"][4]["panels"] if p["panel"] == "bonnet")
    assert (bonnet["film_um"], bonnet["band"]) == (158, "factory")
    assert [(l["stage"], l["um"]) for l in bonnet["layers"]] == [("Epoxy primer", 48), ("2K primer", 84), ("Base", 26)]
    with screen(browser, app_url, ODILE, f"/jobs/{job['id']}?stage=4&panel=bonnet", api=lead) as page:
        group = page.get_by_role("group", name="Panel map")
        for pid, _ in PANELS:
            expect(group.get_by_role("button", name=panel_label(pid, expected[4][pid][0]))).to_have_count(1)
        expect(page.get_by_label("Total film build", exact=True)).to_contain_text("158 µm")
        table = page.get_by_role("table", name="Panel readings")
        expect(table.get_by_role("row").filter(has_text="Door R")).to_contain_text(f"{COAT_INTAKE['door_r']} µm")
        expect(table.get_by_role("row").filter(has_text="Door R")).to_contain_text("Thin")
        expect(table.get_by_role("row").filter(has_text="Rear quarter L")).to_contain_text("Filler suspected")


def test_wf_coat_stack_shared_link(browser, app_url, garage):
    car, job = garage.approved()
    garage.stack(job["id"], COAT)
    jid = job["id"]
    lead = garage.as_(ODILE)
    set_units(lead)
    with screen(browser, app_url, ODILE, f"/jobs/{jid}?stage=0&panel=sill_l", api=lead) as page:
        for pane in ("Car plan", "Cross-section", "Job ledger"):
            expect(page.get_by_role("region", name=pane)).to_be_visible()
        group = page.get_by_role("group", name="Panel map")
        expect(group.get_by_role("button")).to_have_count(12)
        expect(group.get_by_role("button", name=panel_label("sill_l", COAT_INTAKE["sill_l"]))).to_have_attribute("aria-pressed", "true")
        expect(page.get_by_role("slider", name="Stage")).to_have_attribute("aria-valuetext", stage_text(COAT_NAMES, 0))
        expect(page.get_by_label("Total film build", exact=True)).to_contain_text(f"{COAT_INTAKE['sill_l']} µm")
        history = page.evaluate("history.length")
        group.get_by_role("button", name=panel_label("roof", COAT_INTAKE["roof"])).click()
        expect(page).to_have_url(re.compile(r"panel=roof"))
        assert parse_qs(urlparse(page.url).query)["stage"] == ["0"] and page.evaluate("history.length") == history
        page.reload()
        expect(page.get_by_role("group", name="Panel map").get_by_role("button", name=panel_label("roof", COAT_INTAKE["roof"]))).to_have_attribute("aria-pressed", "true")
        page.goto(app_url.rstrip("/") + f"/jobs/{jid}?stage=99&panel=nope")
        expect(page.get_by_role("group", name="Panel map").get_by_role("button", name=panel_label("bonnet", COAT[-1][1]["bonnet"]))).to_have_attribute("aria-pressed", "true")
        expect(page.get_by_role("slider", name="Stage")).to_have_attribute("aria-valuetext", stage_text(COAT_NAMES, len(COAT_NAMES) - 1))
        page.goto(app_url.rstrip("/") + f"/portal/jobs/{jid}?stage=0&panel=roof")
        expect(page).to_have_url(re.compile(rf"/jobs/{jid}\?stage=0&panel=roof$"))
    with screen(browser, app_url, KENJI, f"/jobs/{jid}?stage=0&panel=roof") as page:
        expect(page).to_have_url(re.compile(rf"/portal/jobs/{jid}\?stage=0&panel=roof$"))
        expect(page.get_by_role("region", name="Cross-section")).to_contain_text(f"{COAT_INTAKE['roof']} µm")
        expect(page.get_by_role("slider", name="Stage")).to_have_attribute("aria-valuetext", stage_text(COAT_NAMES, 0))
    empty_car, empty = garage.approved()
    with screen(browser, app_url, ODILE, f"/jobs/{empty['id']}", api=lead) as page:
        group = page.get_by_role("group", name="Panel map")
        for pid, name in PANELS:
            expect(group.get_by_role("button", name=f"{name}, No reading")).to_have_count(1)
        expect(page.get_by_role("slider", name="Stage")).to_be_disabled()


def test_panel_map_scrubber_keyboard_touch(browser, app_url, garage):
    car, job = garage.approved()
    garage.stack(job["id"], COAT)
    lead = garage.as_(ODILE)
    set_units(lead)
    with screen(browser, app_url, ODILE, f"/jobs/{job['id']}", api=lead) as page:
        group = page.get_by_role("group", name="Panel map")
        tab_into(page, group)
        expect(group.get_by_role("button", name=re.compile(r"^Bonnet, "))).to_be_focused()
        page.keyboard.press("ArrowRight")
        wing = group.get_by_role("button", name=re.compile(r"^Front wing L, "))
        expect(wing).to_be_focused()
        expect(wing).to_have_attribute("aria-pressed", "true")
        expect(page).to_have_url(re.compile(r"panel=front_wing_l"))
        for _ in range(3):
            page.keyboard.press("ArrowLeft")
        valance = group.get_by_role("button", name=re.compile(r"^Front valance, "))
        expect(valance).to_be_focused()
        page.keyboard.press("Enter")
        history = page.get_by_role("dialog", name=f"Reading history: {PANEL_NAME['front_valance']}")
        expect(history).to_be_visible()
        page.keyboard.press("Escape")
        slider = page.get_by_role("slider", name="Stage")
        slider.focus()
        last = len(COAT_NAMES) - 1
        for key, k in (("Home", 0), ("ArrowRight", 1), ("ArrowUp", 2), ("End", last), ("ArrowDown", last - 1), ("ArrowLeft", last - 2)):
            page.keyboard.press(key)
            expect(slider).to_have_attribute("aria-valuetext", stage_text(COAT_NAMES, k))
    with screen(browser, app_url, ODILE, f"/jobs/{job['id']}?stage=0&panel=bonnet", PHONE, api=lead) as page:
        group = page.get_by_role("group", name="Panel map")
        roof = group.get_by_role("button", name=re.compile(r"^Roof, "))
        tap(roof)
        expect(roof).to_have_attribute("aria-pressed", "true")
        tap(page.get_by_role("button", name="Reading history"))
        expect(page.get_by_role("dialog", name=f"Reading history: {PANEL_NAME['roof']}")).to_be_visible()
        page.keyboard.press("Escape")
        slider = page.get_by_role("slider", name="Stage")
        slider.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
        box = slider.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(PHONE["width"] - 2, box["y"] + box["height"] / 2, steps=12)
        page.mouse.up()
        expect(slider).to_have_attribute("aria-valuetext", stage_text(COAT_NAMES, len(COAT_NAMES) - 1))


SEEK_JS = """
([elapsed, step]) => {
  const s = window.__lqSeek || (window.__lqSeek = {seen: new Map(), skip: new Set(), svgs: new Map()});
  const svgs = Array.from(document.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'svg'));
  for (const svg of svgs) {
    if (!s.svgs.has(svg)) { svg.pauseAnimations(); s.svgs.set(svg, svg.getCurrentTime()); }
  }
  if (elapsed === null) {
    for (const a of document.getAnimations()) s.skip.add(a);
    return;
  }
  for (const a of document.getAnimations()) {
    if (s.skip.has(a)) continue;
    if (!s.seen.has(a)) s.seen.set(a, elapsed - step);
    const local = Math.max(0, elapsed - s.seen.get(a));
    const end = a.effect ? a.effect.getComputedTiming().endTime : 0;
    a.pause();
    if (Number.isFinite(end) && local >= end) { a.finish(); s.skip.add(a); }
    else a.currentTime = local;
  }
  for (const svg of svgs) svg.setCurrentTime(s.svgs.get(svg) + elapsed / 1000);
}
"""


def test_coat_stack_motion(browser, app_url, garage):
    car, job = garage.approved()
    garage.stack(job["id"], MOTION_COAT)
    lead = garage.as_(ODILE)
    set_units(lead)
    with screen(browser, app_url, ODILE, f"/jobs/{job['id']}?stage=1&panel=bonnet", api=lead) as page:
        group = page.get_by_role("group", name="Panel map")
        panels = [group.get_by_role("button", name=re.compile(rf"^{re.escape(n)}, ")) for _, n in PANELS]
        numeral = page.get_by_label("Total film build", exact=True)
        expect(numeral).to_contain_text(f"{MOTION_FROM} µm")
        before = [decode(capture(p)) for p in panels]
        page.evaluate(SEEK_JS, [None, MOTION_SAMPLE_MS])
        slider = page.get_by_role("slider", name="Stage")
        slider.focus()
        page.keyboard.press("ArrowRight")
        frames, texts = [], []
        for i in range(1, MOTION_SAMPLES + 1):
            elapsed = i * MOTION_SAMPLE_MS
            page.clock.run_for(MOTION_SAMPLE_MS)
            page.evaluate(SEEK_JS, [elapsed, MOTION_SAMPLE_MS])
            frames.append([decode(capture(p)) for p in panels])
            texts.append((elapsed, numeral.inner_text()))
        expect(numeral).to_contain_text(f"{FILM} µm")
    final = frames[-1]
    begins, dones = [], []
    for k, (_, pname) in enumerate(PANELS):
        full = difference(before[k], final[k])
        assert full > 0, f"{pname} never changed its fill"
        gone = [difference(before[k], f[k]) for f in frames]
        left = [difference(f[k], final[k]) for f in frames]
        begin = next(i for i, g in enumerate(gone) if g >= full * WIPE_MARK)
        done = max((i for i, l in enumerate(left) if l >= full * WIPE_MARK), default=-1) + 1
        assert any(g >= full * WIPE_MARK and l >= full * WIPE_MARK for g, l in zip(gone, left)), f"{pname} swapped at once"
        begins.append((begin + 1) * MOTION_SAMPLE_MS)
        dones.append((done + 1) * MOTION_SAMPLE_MS)
    assert all(b >= a - ORDER_SLACK_MS for a, b in zip(begins, begins[1:])), begins
    assert STAGGER_MIN_MS <= begins[-1] - begins[0] <= STAGGER_MAX_MS, begins
    assert all(d - b <= PANEL_WIPE_MAX_MS for b, d in zip(begins, dones)), (begins, dones)
    assert max(dones) <= STEP_SETTLE_MS, dones
    values = [(t, int(re.search(r"\d+", s).group())) for t, s in texts if re.search(r"\d+", s)]
    first_change = next(t for t, v in values if v != MOTION_FROM)
    assert first_change >= CROSS_SECTION_MIN_MS, values[:20]
    assert any(MOTION_FROM < v < FILM for _, v in values), "numeral jumped without counting"
    settled = next(t for t, v in values if v == FILM)
    assert settled <= STEP_SETTLE_MS


def test_wf_coat_stack_reduced_motion(browser, app_url, garage):
    car, job = garage.approved()
    garage.stack(job["id"], MOTION_COAT)
    lead = garage.as_(ODILE)
    set_units(lead)
    with screen(browser, app_url, ODILE, f"/jobs/{job['id']}?stage=1&panel=bonnet", reduced_motion="reduce", api=lead) as page:
        slider = page.get_by_role("slider", name="Stage")
        slider.focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_label("Total film build", exact=True)).to_contain_text(f"{FILM} µm")
        expect(page.get_by_role("group", name="Panel map").get_by_role("button", name=panel_label("bonnet", FILM))).to_have_count(1)
        running = page.evaluate("document.getAnimations().filter(a => a.playState === 'running' && (a.effect.getComputedTiming().activeDuration || 0) > 0).length")
        assert running == 0
        expect(status(page, "Stage announcer")).to_have_text(announce(MOTION_NAMES, 2, "bonnet", FILM))
        page.keyboard.press("ArrowLeft")
        expect(page.get_by_label("Total film build", exact=True)).to_contain_text(f"{MOTION_FROM} µm")
        expect(status(page, "Stage announcer")).to_have_text(announce(MOTION_NAMES, 1, "bonnet", MOTION_FROM))


def test_job_states(garage):
    car = garage.car()
    lead = garage.as_(ODILE)
    kenji = garage.as_(KENJI)
    job = garage.job(car, J1003_LINES)
    jid = job["id"]
    version = job["version"]
    assert job["status"] == "draft" and version == 1
    assert kenji.call("GET", f"/api/jobs/{jid}").status_code == 404

    def refused(api, path, code="invalid_transition", key=None):
        before = lead.ok("GET", f"/api/jobs/{jid}")["job"]
        r = api.call("POST", path, key=key)
        assert r.status_code == 409 and r.json() == {"error": code}, (path, r.text)
        after = lead.ok("GET", f"/api/jobs/{jid}")["job"]
        assert (after["status"], after["version"]) == (before["status"], before["version"])

    def step(api, path, expect_status, key=None):
        nonlocal version
        out = api.ok("POST", path, key=key)["job"]
        assert out["status"] == expect_status and out["version"] == version + 1, out
        version = out["version"]
        return out

    refused(lead, f"/api/jobs/{jid}/finish")
    sent = garage.send(jid)
    assert sent["status"] == "sent" and sent["version"] == version + 1 and sent["sent_at"] and sent["expires_at"]
    version = sent["version"]
    refused(lead, f"/api/jobs/{jid}/revise")
    r = garage.log(jid, "Intake", {p: FILM for p, _ in PANELS})
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}
    step(kenji, f"/api/jobs/{jid}/decline", "declined")
    refused(kenji, f"/api/jobs/{jid}/approve")
    revised = step(lead, f"/api/jobs/{jid}/revise", "draft")
    assert revised["sent_at"] is None and revised["expires_at"] is None
    version = garage.send(jid)["version"]
    step(kenji, f"/api/jobs/{jid}/approve", "approved")
    refused(lead, f"/api/jobs/{jid}/finish")
    refused(lead, f"/api/jobs/{jid}/invoice", key=idempotency_key())
    logged = garage.log(jid, "Intake", {p: FILM for p, _ in PANELS})
    assert logged.json()["job"]["status"] == "in_progress" and logged.json()["job"]["version"] == version + 1
    version += 1
    stage_id = logged.json()["stage"]["id"]
    lead.ok("POST", f"/api/jobs/{jid}/stages/{stage_id}/readings", {"panel": "roof", "value": FILM, "unit": "um"})
    version += 1
    step(lead, f"/api/jobs/{jid}/finish", "finished")
    r = garage.log(jid, "Clear", {"roof": FILM})
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}
    out = lead.ok("POST", f"/api/jobs/{jid}/invoice", key=idempotency_key())
    assert out["job"]["status"] == "invoiced" and out["job"]["version"] == version + 1
    version += 1
    assert garage.pay(out["invoice"]["id"], out["invoice"]["total"]).status_code == 200
    paid = lead.ok("GET", f"/api/jobs/{jid}")["job"]
    assert paid["status"] == "paid" and paid["version"] == version + 1


def test_estimate_expiry(garage):
    base = short_url()
    car = garage.car(base=base)
    job = garage.job(car, J1003_LINES, base)
    sent = garage.send(job["id"], base)
    kenji = garage.as_(KENJI, base)
    assert sent["status"] == "sent" and sent["expires_at"] > sent["sent_at"]
    poll(lambda: garage.as_(ODILE, base).ok("GET", f"/api/jobs/{job['id']}")["job"]["status"] == "expired", SHORT_WAIT_S, "expiry")
    assert kenji.ok("GET", f"/api/jobs/{job['id']}")["job"]["status"] == "expired"
    for action in ("approve", "decline"):
        r = kenji.call("POST", f"/api/jobs/{job['id']}/{action}")
        assert r.status_code == 409 and r.json() == {"error": "estimate_expired"}
    revised = garage.as_(ODILE, base).ok("POST", f"/api/jobs/{job['id']}/revise")["job"]
    assert revised["status"] == "draft" and revised["expires_at"] is None


def test_wf_estimate_approval_happy(browser, app_url, garage, mail):
    car = garage.car()
    name = car["name"]
    lead = garage.as_(ODILE)
    set_units(lead)
    title = f"Respray {car['model']}"
    with screen(browser, app_url, ODILE, "/jobs", api=lead) as page:
        page.get_by_role("button", name="New estimate").click()
        d = page.get_by_role("dialog", name="Estimate")
        select(d.get_by_role("combobox", name="Car"), name)
        d.get_by_role("textbox", name="Job title").fill(title)
        kinds = d.get_by_role("combobox", name="Line kind")
        if kinds.count() == 0:
            d.get_by_role("button", name="Add line").click()
        expect(kinds).to_have_count(1)
        select(kinds.first, "Part")
        d.get_by_role("textbox", name="Description").first.fill("Bonnet hinge bushes")
        d.get_by_role("textbox", name="Quantity").first.fill("2")
        d.get_by_role("textbox", name="Unit price (CHF)").first.fill("37.45")
        d.get_by_role("button", name="Save estimate").click()
        expect(status(page, "Job updates")).to_have_text(re.compile(r"^Estimate J-\d+ saved\.$"))
    job = next(j for j in lead.ok("GET", "/api/jobs")["jobs"] if j["car"]["id"] == car["id"])
    num = job["number"]
    with screen(browser, app_url, ODILE, f"/jobs/{job['id']}", api=lead) as lead_page:
        lead_page.get_by_role("button", name="Send to owner").click()
        expect(status(lead_page, "Job updates")).to_have_text(f"Estimate {num} sent to Kenji Arlow.")
        sent = lead.ok("GET", f"/api/jobs/{job['id']}")["job"]
        expect(lead_page.get_by_label("Estimate", exact=True)).to_contain_text(f"Sent, approve by {zdate_ts(sent['expires_at'])}")
        msg = mails(mail, f"Estimate {num} for your {name} is ready", 1)[0]
        link = re.search(r"https?://[^\s\"'<>]+(/portal/jobs/[^\s\"'<>]+)", text(msg))
        assert link and job["id"] in link.group(1)
        with open_app(browser, app_url.rstrip("/") + link.group(1)) as owner:
            owner.clock.set_system_time(FAR_FUTURE)
            expect(owner).to_have_url(re.compile(r"/sign-in\?next="))
            owner.get_by_role("textbox", name="Email").fill(KENJI)
            owner.get_by_role("textbox", name="Password").fill(PASSWORD)
            owner.get_by_role("button", name="Sign in").click()
            expect(owner).to_have_url(re.compile(rf"/portal/jobs/{job['id']}"))
            owner.get_by_role("button", name="Decline estimate").click()
            dd = owner.get_by_role("dialog", name="Decline estimate?")
            dd.get_by_role("button", name="Keep estimate").click()
            expect(dd).to_be_hidden()
            owner.get_by_role("button", name="Approve estimate").click()
            expect(status(owner, "Job updates")).to_have_text(f"Estimate approved. Work on your {name} can begin.")
        eventually(lead_page, lambda: expect(lead_page.get_by_label("Estimate", exact=True)).to_contain_text("Approved", timeout=EXPECT_MS),
                   step_ms=REREAD_MS)
        expect(status(lead_page, "Job updates")).to_have_text(f"Kenji Arlow approved estimate {num}.")
        expect(lead_page.get_by_role("button", name="Log stage")).to_be_visible()
    assert lead.ok("GET", f"/api/jobs/{job['id']}")["job"]["status"] == "approved"


def test_estimate_answers_live(browser, app_url, garage):
    lead = garage.as_(ODILE)
    set_units(lead)
    kenji = garage.as_(KENJI)
    for action, verb, button in (("approve", "approved", "Log stage"), ("decline", "declined", "Revise estimate")):
        car = garage.car()
        job = garage.job(car, J1003_LINES)
        garage.send(job["id"])
        with screen(browser, app_url, ODILE, f"/jobs/{job['id']}", api=lead) as page, \
                screen(browser, app_url, ODILE, "/jobs", api=lead) as jobs_page:
            expect(status(page, "Job updates")).to_have_text("")
            row = jobs_page.get_by_role("table", name="Jobs").get_by_role("row").filter(has_text=job["number"])
            before = row.inner_text()
            scroll = page.evaluate("window.scrollY")
            kenji.ok("POST", f"/api/jobs/{job['id']}/{action}")
            copy = f"Kenji Arlow {verb} estimate {job['number']}."
            eventually(page, lambda: expect(status(page, "Job updates")).to_have_text(copy, timeout=EXPECT_MS), step_ms=REREAD_MS)
            expect(page.get_by_label("Estimate", exact=True)).to_contain_text(verb.capitalize())
            expect(page.get_by_role("button", name=button)).to_be_visible()
            advance(page, REREAD_MS)
            expect(status(page, "Job updates")).to_have_text(copy)
            assert page.evaluate("window.scrollY") == scroll
            eventually(jobs_page, lambda: expect(row).not_to_have_text(before, timeout=EXPECT_MS), step_ms=REREAD_MS)


def test_wf_estimate_approval_stale_edit(browser, app_url, garage, mail):
    car = garage.car()
    lead = garage.as_(ODILE)
    set_units(lead)
    job = garage.job(car, J1003_LINES)
    jid, num = job["id"], job["number"]
    v1 = job["version"]
    r = lead.call("GET", f"/api/jobs/{jid}")
    assert r.headers["etag"] == quoted(v1) and r.json()["job"]["version"] == 1
    lines = J1003_LINES
    ok = lead.call("PATCH", f"/api/jobs/{jid}", {"title": "Sill touch-in", "lines": lines}, headers={"If-Match": quoted(v1)})
    assert ok.status_code == 200 and ok.json()["job"]["version"] == v1 + 1 and ok.headers["etag"] == quoted(v1 + 1)
    stale = lead.call("PATCH", f"/api/jobs/{jid}", {"title": "Boot floor inspection", "lines": lines}, headers={"If-Match": quoted(v1)})
    assert stale.status_code == 412 and stale.json() == {"error": "estimate_changed"}
    assert lead.ok("GET", f"/api/jobs/{jid}")["job"]["title"] == "Sill touch-in"
    r = lead.call("PATCH", f"/api/jobs/{jid}", {"title": PROBE_TITLE, "lines": lines})
    assert r.status_code == 422 and r.json() == {"errors": {"if_match": "Send the estimate version you edited."}}
    clients = [Api(app_url, ODILE), Api(app_url, RAFAEL), Api(minio_down(), ODILE)]
    results = together([lambda c=c, i=i: c.call("PATCH", f"/api/jobs/{jid}", {"title": f"{PROBE_TITLE} {i}", "lines": lines},
                                                   headers={"If-Match": quoted(v1 + 1)}) for i, c in enumerate(clients)])
    assert sorted(r.status_code for r in results) == [200, 412, 412]
    r = lead.call("POST", f"/api/jobs/{jid}/send", headers={"If-Match": quoted(v1 + 1)})
    assert r.status_code == 412 and r.json() == {"error": "estimate_changed"}
    sends = together([lambda c=c: c.call("POST", f"/api/jobs/{jid}/send", headers={"If-Match": quoted(v1 + 2)}) for c in clients])
    assert sorted(r.status_code for r in sends) == [200, 409, 409]
    assert all(r.json() == {"error": "invalid_transition"} for r in sends if r.status_code == 409)
    subject = f"Estimate {num} for your {car['name']} is ready"
    assert len(mails(mail, subject, 1)) == 1
    garage.as_(KENJI).ok("POST", f"/api/jobs/{jid}/decline")
    pre_revise = lead.call("GET", f"/api/jobs/{jid}").headers["etag"]
    lead.ok("POST", f"/api/jobs/{jid}/revise")
    r = lead.call("PATCH", f"/api/jobs/{jid}", {"title": PROBE_TITLE, "lines": lines}, headers={"If-Match": pre_revise})
    assert r.status_code == 412
    with screen(browser, app_url, ODILE, f"/jobs/{jid}", api=lead) as page:
        page.get_by_role("button", name="Edit estimate").click()
        d = page.get_by_role("dialog", name="Estimate")
        d.get_by_role("textbox", name="Job title").fill(LEAD_TITLE)
        garage.as_(RAFAEL).ok("PATCH", f"/api/jobs/{jid}", {"title": MANAGER_TITLE, "lines": lines},
                              headers={"If-Match": garage.etag(jid, email=RAFAEL)})
        d.get_by_role("button", name="Save estimate").click()
        expect(status(page, "Job updates")).to_have_text(
            f"Estimate {num} was changed by someone else. Your edits are kept; reload to see the latest.")
        expect(d).to_be_visible()
        expect(d.get_by_role("textbox", name="Job title")).to_have_value(LEAD_TITLE)
        expect(d.get_by_role("button", name="Save estimate")).to_be_focused()
    assert lead.ok("GET", f"/api/jobs/{jid}")["job"]["title"] == MANAGER_TITLE
    assert len(mails(mail, subject, 1)) == 1


def test_decline_dialog_survives_expiry(browser, garage):
    base = short_url()
    car = garage.car(base=base)
    job = garage.job(car, J1003_LINES, base)
    sent = garage.send(job["id"], base)
    with screen(browser, base, KENJI, f"/portal/jobs/{job['id']}") as page:
        page.get_by_role("button", name="Decline estimate").click()
        d = page.get_by_role("dialog", name="Decline estimate?")
        expect(d).to_be_visible()
        focused = page.evaluate("document.activeElement.textContent.trim()")
        poll(lambda: garage.as_(KENJI, base).ok("GET", f"/api/jobs/{job['id']}")["job"]["status"] == "expired", SHORT_WAIT_S, "expiry")
        ledger = page.get_by_role("region", name="Job ledger")
        eventually(page, lambda: expect(ledger.get_by_role("button", name="Approve estimate")).to_have_count(0, timeout=EXPECT_MS),
                   step_ms=REREAD_MS)
        expect(page.get_by_label("Estimate", exact=True)).to_contain_text("Expired")
        expect(d).to_be_visible()
        assert page.evaluate("document.activeElement.textContent.trim()") == focused
        expect(status(page, "Job updates")).to_have_text("")
        d.get_by_role("button", name="Decline", exact=True).click()
        copy = f"This estimate expired on {zdate_ts(sent['expires_at'])} and can no longer be answered."
        expect(status(page, "Job updates")).to_have_text(copy)
        expect(d).to_be_hidden()
        expect(page.get_by_role("heading", name="Job ledger", level=2)).to_be_focused()
        advance(page, REREAD_MS)
        advance(page, REREAD_MS)
        expect(status(page, "Job updates")).to_have_text(copy)


def test_invoice_money(garage):
    car = garage.car()
    lead = garage.as_(ODILE)
    house = lead.ok("GET", "/api/house")
    assert house["vat_rate"] == "8.1" and house["labour_rate"] == "145.00"
    job = garage.job(car, J1004_LINES)
    for number, lines in LINE_SETS.items():
        r = lead.call("PATCH", f"/api/jobs/{job['id']}", {"title": "Totals", "lines": lines},
                      headers={"If-Match": garage.etag(job["id"])})
        assert r.status_code == 200, r.text
        out = r.json()["job"]
        total, rounding = TOTALS[number]
        nets, vats = zip(*(line_money(l) for l in lines))
        assert out["net_total"] == str(sum(nets)) and out["vat_total"] == str(sum(vats))
        assert out["total"] == total and out["rounding"] == rounding and out["currency"] == "CHF"
        unrounded = sum(nets) + sum(vats)
        assert Decimal(total) == (unrounded / FIVE_CENTIMES).quantize(Decimal(1), ROUND_HALF_UP) * FIVE_CENTIMES
        for got, src, net, vat in zip(out["lines"], lines, nets, vats):
            assert got["net"] == str(net) and got["vat"] == str(vat)
            assert re.fullmatch(r"\d+\.\d{2}", got["quantity"])
            if src["kind"] == "labour":
                assert got["unit_price"] == "145.00"
    bad = [{**J1004_LINES[0], "unit_price": "145.00"}]
    r = lead.call("PATCH", f"/api/jobs/{job['id']}", {"title": "x", "lines": bad}, headers={"If-Match": garage.etag(job["id"])})
    assert r.status_code == 422 and r.json()["errors"]["lines[0].unit_price"] == "Labour is billed at the house rate."
    r = lead.call("PATCH", f"/api/jobs/{job['id']}", {"title": "x", "lines": [{**J1004_LINES[0], "quantity": "0.30"}]},
                  headers={"If-Match": garage.etag(job["id"])})
    assert r.json()["errors"]["lines[0].quantity"] == "Enter hours in quarter-hour steps from 0.25 to 200.00."
    r = lead.call("PATCH", f"/api/jobs/{job['id']}", {"title": "x", "lines": [{**J1003_LINES[0], "quantity": "1.5"}]},
                  headers={"If-Match": garage.etag(job["id"])})
    assert r.json()["errors"]["lines[0].quantity"] == "Enter a whole number of parts from 1 to 999."
    r = lead.call("PATCH", f"/api/jobs/{job['id']}", {"title": "x", "lines": []}, headers={"If-Match": garage.etag(job["id"])})
    assert r.json()["errors"]["lines"] == "Add at least one line."


def test_invoice_balance_from_killbill(garage, killbill):
    car, job, inv = garage.invoiced(lines=J1001_LINES)
    assert (inv["total"], inv["net_total"], inv["vat_total"], inv["rounding"]) == ("4470.70", "4135.70", "334.99", "0.01")
    assert inv["status"] == "awaiting_payment" and inv["balance"] == "4470.70" and inv["balance_live"] is True
    assert [l["description"] for l in inv["lines"]] == [l["description"] for l in J1001_LINES]
    kb = kb_invoice(killbill, KENJI, inv["killbill_invoice_id"])
    assert kb and Decimal(str(kb["amount"])) == Decimal("4470.70") and Decimal(str(kb["balance"])) == Decimal("4470.70")
    assert any(i.get("description") == f"Workshop job {job['number']}" for i in kb["items"])
    r = garage.pay(inv["id"], TRANSFER_AMOUNT)
    assert r.status_code == 200, r.text
    after = r.json()["invoice"]
    assert after["balance"] == AFTER_TRANSFER and after["status"] == "awaiting_payment"
    assert Decimal(str(kb_invoice(killbill, KENJI, inv["killbill_invoice_id"])["balance"])) == Decimal(AFTER_TRANSFER)
    payment = after["payments"][0]
    assert payment["amount"] == TRANSFER_AMOUNT and payment["reference"] == TRANSFER_REF and payment["recorded_by"]["id"] == "u-rafael"
    kbp = kb_payments(killbill, KENJI, [payment["killbill_payment_id"]])
    assert len(kbp) == 1 and Decimal(str(kbp[0]["purchasedAmount"])) == Decimal(TRANSFER_AMOUNT)
    r = garage.pay(inv["id"], OVER_BALANCE)
    assert r.status_code == 422 and r.json()["errors"]["amount"] == f"Enter an amount from 0.01 to {AFTER_TRANSFER}."
    r = garage.pay(inv["id"], "0.00")
    assert r.status_code == 422
    assert len(garage.as_(RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]["payments"]) == 1
    board = garage.as_(RAFAEL).ok("GET", "/api/board")
    assert next(i for i in board["unpaid"]["invoices"] if i["id"] == inv["id"])["balance"] == AFTER_TRANSFER


def test_one_invoice_per_job(app_url, garage, killbill):
    jobs = [garage.finished(lines=J1003_LINES)[1] for _ in range(3)]
    clients = [Api(app_url, ODILE), Api(app_url, RAFAEL), Api(minio_down(), ODILE), Api(minio_down(), RAFAEL)]
    j1 = jobs[0]
    results = together([lambda c=c: c.call("POST", f"/api/jobs/{j1['id']}/invoice", key=idempotency_key()) for c in clients])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    assert all(r.json() == {"error": "invalid_transition"} for r in results if r.status_code == 409)
    first = next(r for r in results if r.status_code == 201).json()["invoice"]
    assert len(kb_invoices_for(killbill, KENJI, f"Workshop job {j1['number']}")) == 1
    down = Api(killbill_down(), ODILE).call("POST", f"/api/jobs/{jobs[1]['id']}/invoice", key=idempotency_key())
    assert down.status_code == 503 and down.json() == {"error": "billing_unavailable"}
    still = garage.as_(ODILE).ok("GET", f"/api/jobs/{jobs[1]['id']}")["job"]
    assert still["status"] == "finished" and still["invoice_id"] is None
    assert kb_invoices_for(killbill, KENJI, f"Workshop job {jobs[1]['number']}") == []
    pair = together([lambda j=j: Api(app_url, ODILE).call("POST", f"/api/jobs/{j['id']}/invoice", key=idempotency_key()) for j in jobs[1:]])
    assert [r.status_code for r in pair] == [201, 201]
    numbers = [first["number"]] + [r.json()["invoice"]["number"] for r in pair]
    assert all(re.fullmatch(r"INV-\d{4}-\d{4}", n) for n in numbers)
    seqs = sorted(int(n[-4:]) for n in numbers)
    assert seqs == [seqs[0], seqs[0] + 1, seqs[0] + 2] and int(first["number"][-4:]) == seqs[0]


def test_wf_invoicing_partial_payments(app_url, garage, killbill):
    car, job, inv = garage.invoiced(lines=J1001_LINES)
    first_key = idempotency_key()
    first = garage.pay(inv["id"], TRANSFER_AMOUNT, key=first_key)
    assert first.json()["invoice"]["balance"] == AFTER_TRANSFER
    clients = [Api(app_url, RAFAEL), Api(app_url, RAFAEL), Api(minio_down(), RAFAEL), Api(minio_down(), RAFAEL), Api(app_url, RAFAEL)]
    results = together([lambda c=c: c.call("POST", f"/api/invoices/{inv['id']}/payments",
                                            {"reference": TRANSFER_REF, "amount": TRANSFER_AMOUNT}, key=idempotency_key()) for c in clients])
    assert sorted(r.status_code for r in results) == [200, 200, 200, 422, 422]
    assert all(r.json()["errors"]["amount"] == f"Enter an amount from 0.01 to {LAST_BALANCE}." for r in results if r.status_code == 422)
    replay = garage.pay(inv["id"], TRANSFER_AMOUNT, key=first_key)
    assert replay.status_code == 200 and replay.json() == first.json()
    now = garage.as_(RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]
    assert now["balance"] == LAST_BALANCE
    assert [p["reference"] for p in now["payments"]] == [TRANSFER_REF] * 4
    kbp = kb_payments(killbill, KENJI, [p["killbill_payment_id"] for p in now["payments"]])
    assert len(kbp) == 4 and all(Decimal(str(p["purchasedAmount"])) == Decimal(TRANSFER_AMOUNT) for p in kbp)
    done = garage.pay(inv["id"], LAST_BALANCE).json()["invoice"]
    assert done["status"] == "paid" and done["balance"] == "0.00" and done["paid_at"]
    assert garage.as_(ODILE).ok("GET", f"/api/jobs/{job['id']}")["job"]["status"] == "paid"
    r = garage.pay(inv["id"], "0.01")
    assert r.status_code == 409 and r.json() == {"error": "already_paid"}


def test_wf_invoicing_refund_reopens(garage, killbill):
    car, job, inv = garage.invoiced(lines=J1003_LINES)
    lead, mgr = garage.as_(ODILE), garage.as_(RAFAEL)
    v_invoiced = job["version"]
    paid = garage.pay(inv["id"], inv["total"]).json()["invoice"]
    assert paid["status"] == "paid"
    assert lead.ok("GET", f"/api/jobs/{job['id']}")["job"]["version"] == v_invoiced + 1
    assert inv["id"] not in [i["id"] for i in mgr.ok("GET", "/api/board")["unpaid"]["invoices"]]
    rel = garage.staged(car["id"])
    kb_refund(paid["payments"][0]["killbill_payment_id"], inv["total"])
    reopened = poll(lambda: (lambda i: i if i["status"] == "awaiting_payment" else None)(
        mgr.ok("GET", f"/api/invoices/{inv['id']}")["invoice"]), DEADLINE_S, "reopened invoice")
    assert reopened["balance"] == inv["total"] and reopened["paid_at"] is None
    assert reopened["payments"][0]["refunded"] == inv["total"]
    j = lead.ok("GET", f"/api/jobs/{job['id']}")["job"]
    assert j["status"] == "invoiced" and j["version"] == v_invoiced + 2
    assert inv["id"] in [i["id"] for i in mgr.ok("GET", "/api/board")["unpaid"]["invoices"]]
    assert [h["id"] for h in garage.as_(INES).ok("GET", f"/api/releases/{rel['id']}")["release"]["held_by"]] == [inv["id"]]
    garage.empty(car["id"])
    r = garage.as_(INES).call("POST", f"/api/releases/{rel['id']}/complete")
    assert r.status_code == 409 and r.json()["error"] == "invoice_unpaid"


def test_transfer_dialog_outlives_row(browser, app_url, garage, killbill):
    car, job, inv = garage.invoiced(lines=J1003_LINES)
    with screen(browser, app_url, RAFAEL, "/board") as page:
        opener = page.get_by_role("button", name=f"Record bank transfer for {inv['number']}")
        opener.click()
        d = page.get_by_role("dialog", name="Record bank transfer")
        amount = d.get_by_role("textbox", name="Amount (CHF)")
        expect(amount).to_have_value(inv["total"])
        d.get_by_role("textbox", name="Bank reference").fill(TRANSFER_REF)
        assert garage.pay(inv["id"], inv["total"]).status_code == 200
        eventually(page, lambda: expect(opener).to_have_count(0, timeout=EXPECT_MS), step_ms=REREAD_MS)
        expect(d).to_be_visible()
        expect(d.get_by_role("textbox", name="Bank reference")).to_have_value(TRANSFER_REF)
        expect(amount).to_have_value(inv["total"])
        d.get_by_role("button", name="Record transfer").click()
        expect(status(page, "Invoice updates")).to_have_text("This invoice is already paid.")
        expect(d).to_be_hidden()
        expect(page.get_by_role("region", name="Unpaid invoices").get_by_role("heading", name="Unpaid invoices", level=2)).to_be_focused()
    payments = garage.as_(RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]["payments"]
    assert len(payments) == 1 and len(kb_payments(killbill, KENJI, [payments[0]["killbill_payment_id"]])) == 1


def test_release_notice(browser, app_url, garage):
    car = garage.car()
    kenji = garage.as_(KENJI)
    r = kenji.call("GET", "/api/releases/earliest-slot")
    body = r.json()
    earliest = body["earliest"]
    assert body["time_zone"] == "Europe/Zurich" and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", earliest)
    assert earliest[11:] in SLOT_TIMES and date.fromisoformat(earliest[:10]).weekday() != 6
    assert body["earliest_label"] == slot_label(earliest)
    server_now = datetime.strptime(r.headers["date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
    at = datetime.fromisoformat(earliest).replace(tzinfo=ZURICH)
    assert at - server_now >= timedelta(hours=48)
    prev = at - timedelta(minutes=30)
    while prev.strftime("%H:%M") not in SLOT_TIMES or prev.weekday() == 6:
        prev -= timedelta(minutes=30)
    path = "/api/releases"
    r = kenji.call("POST", path, {"car_id": car["id"], "slot": prev.strftime("%Y-%m-%dT%H:%M")}, key=idempotency_key())
    assert r.status_code == 422 and r.json()["errors"]["slot"] == "Releases need at least 48 hours' notice."
    far = date.fromisoformat(earliest[:10]) + timedelta(days=SLOT_MIN_DAYS)
    sunday = far + timedelta(days=(6 - far.weekday()) % 7)
    weekday = sunday + timedelta(days=2)
    for slot in (f"{weekday}T10:15", f"{weekday}T18:00", f"{sunday}T10:00"):
        r = kenji.call("POST", path, {"car_id": car["id"], "slot": slot}, key=idempotency_key())
        assert r.status_code == 422 and r.json()["errors"]["slot"] == "Choose a half-hour slot between 08:00 and 17:30, Monday to Saturday."
    r = kenji.call("POST", path, {"car_id": car["id"], "slot": f"{weekday} 10:30"}, key=idempotency_key())
    assert r.status_code == 422 and r.json()["errors"]["slot"] == "Use a date and time like 2026-11-03T10:30."
    assert garage.detail(car["id"])["releases"] == []
    with screen(browser, app_url, KENJI, f"/portal/cars/{car['id']}/release") as page:
        page.clock.set_system_time(FAR_FUTURE)
        page.reload()
        text_visible(page, f"Earliest slot: {body['earliest_label']}")
        expect(page.get_by_role("textbox", name="Date")).to_have_value(earliest[:10])
    rel = kenji.ok("POST", path, {"car_id": car["id"], "slot": earliest}, key=idempotency_key())["release"]
    assert rel["status"] == "requested" and rel["slot"] == earliest
    kenji.ok("POST", f"/api/releases/{rel['id']}/cancel")


def test_release_states_slots(app_url, garage):
    a, b = garage.car(), garage.car()
    kenji_a, kenji_b = Api(app_url, KENJI), Api(minio_down(), KENJI)
    ines = garage.as_(INES)
    slot = garage.slot()
    results = together([lambda: kenji_a.call("POST", "/api/releases", {"car_id": a["id"], "slot": slot}, key=idempotency_key()),
                        lambda: kenji_b.call("POST", "/api/releases", {"car_id": b["id"], "slot": slot}, key=idempotency_key())])
    assert sorted(r.status_code for r in results) == [201, 409]
    loser = next(r for r in results if r.status_code == 409)
    assert loser.json() == {"error": "slot_taken"}
    winner = next(r for r in results if r.status_code == 201).json()["release"]
    rid = winner["id"]
    r = ines.call("POST", f"/api/releases/{rid}/stage")
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}
    r = garage.as_(KENJI).call("POST", "/api/releases", {"car_id": winner["car"]["id"], "slot": garage.slot()}, key=idempotency_key())
    assert r.status_code == 409 and r.json() == {"error": "release_already_open"}
    assert ines.ok("POST", f"/api/releases/{rid}/book")["release"]["status"] == "booked"
    assert ines.call("POST", f"/api/releases/{rid}/book").status_code == 409
    assert ines.ok("POST", f"/api/releases/{rid}/stage")["release"]["status"] == "staged"
    cancelled = ines.ok("POST", f"/api/releases/{rid}/cancel")["release"]
    assert cancelled["status"] == "cancelled" and cancelled["held_by"] == []
    assert [(e["status"], e["by"]["id"]) for e in cancelled["events"]] == [
        ("requested", "u-kenji"), ("booked", "u-ines"), ("staged", "u-ines"), ("cancelled", "u-ines")]
    r = ines.call("POST", f"/api/releases/{rid}/book")
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}
    other = b if winner["car"]["id"] == a["id"] else a
    again = garage.as_(KENJI).ok("POST", "/api/releases", {"car_id": other["id"], "slot": slot}, key=idempotency_key())["release"]
    assert garage.as_(KENJI).ok("POST", f"/api/releases/{again['id']}/cancel")["release"]["status"] == "cancelled"
    waiting = garage.car(store=False)
    r = garage.as_(KENJI).call("POST", "/api/releases", {"car_id": waiting["id"], "slot": garage.slot()}, key=idempotency_key())
    assert r.status_code == 409 and r.json() == {"error": "car_not_stored"}
    r = garage.as_(HENRIETTA).call("POST", "/api/releases", {"car_id": "c-911rs", "slot": garage.slot()}, key=idempotency_key())
    assert r.status_code == 409 and r.json() == {"error": "car_in_workshop"}


def test_release_all_or_nothing(garage, mail):
    car = garage.car()
    ines = garage.as_(INES)
    ines.ok("POST", f"/api/cars/{car['id']}/belongings", {"kind": "key_set", "label": ITEM_LABEL, "count": 1})
    rel = garage.staged(car["id"])
    subject = f"Your {car['name']} has been released"
    r = ines.call("POST", f"/api/releases/{rel['id']}/complete")
    assert r.status_code == 409 and r.json()["error"] == "belongings_checked_in"
    garage.empty(car["id"])
    r = Api(mail_down(), INES).call("POST", f"/api/releases/{rel['id']}/complete")
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable"}
    detail = garage.detail(car["id"])
    assert detail["status"] == "stored" and detail["bay"]["code"] == car["bay"]["code"]
    assert detail["bay_billing"]["cancel_requested"] is False
    assert ines.ok("GET", f"/api/releases/{rel['id']}")["release"]["status"] == "staged"
    bays = {b["code"]: b for b in ines.ok("GET", "/api/bays")["bays"]}
    assert bays[car["bay"]["code"]]["car"]["id"] == car["id"]
    assert no_mail(mail, subject)
    out = ines.ok("POST", f"/api/releases/{rel['id']}/complete")
    assert out["release"]["status"] == "released" and out["car"]["status"] == "released"
    bays = {b["code"]: b for b in ines.ok("GET", "/api/bays")["bays"]}
    assert bays[car["bay"]["code"]]["car"] is None
    sent = mails(mail, subject, 1)
    assert len(sent) == 1 and addresses(sent[0]["To"]) == [KENJI]


def test_release_hold(app_url, garage):
    held_car, job, inv = garage.invoiced("u-henrietta", J1003_LINES)
    free_car = garage.car("u-henrietta")
    ines = garage.as_(INES)
    rel_free = garage.staged(free_car["id"])
    assert ines.ok("POST", f"/api/releases/{rel_free['id']}/complete")["release"]["status"] == "released"
    ines.ok("POST", f"/api/cars/{held_car['id']}/belongings", {"kind": "key_set", "label": ITEM_LABEL, "count": 1})
    rel = garage.staged(held_car["id"])
    r = ines.call("POST", f"/api/releases/{rel['id']}/complete")
    assert r.status_code == 409 and r.json()["error"] == "invoice_unpaid"
    assert r.json()["invoices"] == [{"id": inv["id"], "number": inv["number"], "balance": inv["total"]}]
    assert ines.ok("GET", f"/api/releases/{rel['id']}")["release"]["held_by"] == [{"id": inv["id"], "number": inv["number"], "balance": inv["total"]}]
    kb_down = Api(killbill_down(), INES)
    r = kb_down.call("POST", f"/api/releases/{rel['id']}/complete")
    assert r.status_code == 409 and r.json()["error"] == "invoice_unpaid"
    assert garage.pay(inv["id"], inv["total"]).status_code == 200
    assert garage.as_(RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]["status"] == "paid"
    r = kb_down.call("POST", f"/api/releases/{rel['id']}/complete")
    assert r.status_code == 409 and r.json()["error"] == "belongings_checked_in"
    garage.empty(held_car["id"])
    assert ines.ok("POST", f"/api/releases/{rel['id']}/complete")["release"]["status"] == "released"


def test_wf_release_one_car_one_change(app_url, garage):
    car = garage.car()
    ines = garage.as_(INES)
    item = ines.ok("POST", f"/api/cars/{car['id']}/belongings", {"kind": "key_set", "label": ITEM_LABEL, "count": 1})["item"]
    rel = garage.staged(car["id"])
    garage.empty(car["id"])
    a, b = Api(app_url, INES), Api(minio_down(), INES)
    done, checkin = together([lambda: a.call("POST", f"/api/releases/{rel['id']}/complete"),
                              lambda: b.call("POST", f"/api/belongings/{item['id']}/movements", {"direction": "in", "count": 1})])
    if done.status_code == 200:
        assert checkin.status_code == 409 and checkin.json() == {"error": "car_released"}
    else:
        assert checkin.status_code == 201
        assert done.status_code == 409 and done.json()["error"] == "belongings_checked_in"
        garage.empty(car["id"])
        ines.ok("POST", f"/api/releases/{rel['id']}/complete")
    detail = garage.detail(car["id"])
    assert detail["status"] == "released" and all(i["count_in"] == 0 for i in detail["belongings"])
    moves = len(ines.ok("GET", f"/api/belongings/{item['id']}/movements")["movements"])
    for method, path, body in (("POST", f"/api/belongings/{item['id']}/movements", {"direction": "in", "count": 1}),
                               ("POST", f"/api/cars/{car['id']}/belongings", {"kind": "cover", "label": "Indoor cover", "count": 1}),
                               ("POST", f"/api/cars/{car['id']}/bay", {"bay_id": car["bay"]["id"]})):
        r = ines.call(method, path, body)
        assert r.status_code == 409 and r.json() == {"error": "car_released"}, (path, r.text)
    assert len(ines.ok("GET", f"/api/belongings/{item['id']}/movements")["movements"]) == moves
    assert len(garage.detail(car["id"])["belongings"]) == 1


def test_release_status_live(browser, app_url, garage):
    car = garage.car()
    rel = garage.request(car["id"])
    label = slot_label(rel["slot"])
    with screen(browser, app_url, KENJI, f"/portal/releases/{rel['id']}") as owner, \
            screen(browser, app_url, INES, "/releases") as desk:
        expect(owner.get_by_role("heading", name="Release requested", level=1)).to_be_visible()
        expect(status(owner, "Release updates")).to_have_text("")
        row = desk.get_by_role("table", name="Releases").get_by_role("row").filter(has_text=car["name"])
        row.get_by_role("button", name="Book release").focus()
        garage.as_(RAFAEL).ok("POST", f"/api/releases/{rel['id']}/book")
        eventually(owner, lambda: expect(owner.get_by_role("heading", name="Your release is booked", level=1)).to_be_visible(timeout=EXPECT_MS),
                   step_ms=REREAD_MS)
        expect(status(owner, "Release updates")).to_have_text(f"Your release is booked for {label}.")
        eventually(desk, lambda: expect(row.get_by_role("button", name="Book release")).to_have_count(0, timeout=EXPECT_MS), step_ms=REREAD_MS)
        expect(row.get_by_role("button", name="Car staged")).to_be_visible()
        assert focus_inside(row)
        advance(owner, REREAD_MS)
        advance(owner, REREAD_MS)
        expect(status(owner, "Release updates")).to_have_text(f"Your release is booked for {label}.")
        garage.as_(RAFAEL).ok("POST", f"/api/releases/{rel['id']}/stage")
        eventually(owner, lambda: expect(status(owner, "Release updates")).to_have_text("Your car is ready for handover.", timeout=EXPECT_MS),
                   step_ms=REREAD_MS)
        expect(owner.get_by_role("heading", name="Your car is ready for handover", level=1)).to_be_visible()


def test_wf_release_held_journey(browser, app_url, garage, mail):
    car, job, inv = garage.invoiced("u-henrietta", J1003_LINES)
    name, code = car["name"], car["bay"]["code"]
    garage.as_(INES).ok("POST", f"/api/cars/{car['id']}/belongings", {"kind": "key_set", "label": ITEM_LABEL, "count": 1})
    slot = garage.slot()
    label = slot_label(slot)
    with screen(browser, app_url, HENRIETTA, f"/portal/cars/{car['id']}/release") as owner:
        owner.get_by_role("textbox", name="Date").fill(slot[:10])
        select(owner.get_by_role("combobox", name="Time"), slot[11:])
        owner.get_by_role("button", name="Request release").click()
        expect(owner.get_by_role("heading", name="We've received your release request")).to_be_visible()
        text_visible(owner, f"We'll confirm {label} by email once the concierge books it.")
    rel = garage.open_release(car["id"])
    assert rel and rel["slot"] == slot
    with screen(browser, app_url, HENRIETTA, f"/portal/releases/{rel['id']}") as owner, \
            screen(browser, app_url, INES, "/releases") as desk:
        expect(owner.get_by_role("heading", name="Release requested", level=1)).to_be_visible()
        row = desk.get_by_role("table", name="Releases").get_by_role("row").filter(has_text=name)
        row.get_by_role("button", name="Book release").click()
        expect(status(desk, "Release updates")).to_have_text(f"Release booked for {name}, {label}. The owner will be emailed.")
        eventually(owner, lambda: expect(owner.get_by_role("heading", name="Your release is booked", level=1)).to_be_visible(timeout=EXPECT_MS),
                   step_ms=REREAD_MS)
        booked = mails(mail, f"Release booked: {name}, {label}", 1)
        assert len(booked) == 1 and code in text(booked[0])
        row.get_by_role("button", name="Car staged").click()
        expect(status(desk, "Release updates")).to_have_text(f"{name} staged for handover.")
        eventually(owner, lambda: expect(owner.get_by_role("heading", name="Your car is ready for handover", level=1)).to_be_visible(timeout=EXPECT_MS),
                   step_ms=REREAD_MS)
        expect(row).to_contain_text("Held: unpaid invoice")
        text_visible(owner, f"Your car is held until invoice {inv['number']} is paid.")
        row.get_by_role("button", name="Complete release").click()
        expect(status(desk, "Release updates")).to_have_text(f"Invoice {inv['number']} is unpaid. Record the payment before release.")
        assert garage.pay(inv["id"], inv["total"]).status_code == 200
        with screen(browser, app_url, INES, f"/cars/{car['id']}") as car_page:
            car_page.get_by_role("button", name=f"Check out {ITEM_LABEL}").click()
            expect(status(car_page, "Belongings updates")).to_have_text(f"{ITEM_LABEL}: 0 checked in.")
        advance(desk, REREAD_MS)
        row.get_by_role("button", name="Complete release").click()
        expect(status(desk, "Release updates")).to_have_text(f"{name} released. Bay {code} is free.")
        eventually(owner, lambda: expect(owner.get_by_role("heading", name="Released", level=1)).to_be_visible(timeout=EXPECT_MS),
                   step_ms=REREAD_MS)
    assert len(mails(mail, f"Your {name} has been released", 1)) == 1
    bay = next(b for b in garage.as_(INES).ok("GET", "/api/bays")["bays"] if b["code"] == code)
    assert bay["car"] is None
    with screen(browser, app_url, INES, "/bays") as page:
        expect(page.get_by_role("group", name="Floor plan").get_by_role(
            "button", name=f"Bay {code}, {CLASS_LABEL[bay['class']]}, free")).to_have_count(1)


def test_owner_isolation(garage):
    kcar = garage.car("u-kenji")
    ines, kenji, hen = garage.as_(INES), garage.as_(KENJI), garage.as_(HENRIETTA)
    report = upload_report(ines, kcar["id"], pdf_bytes()).json()["report"]
    photo = upload_photo(ines, kcar["id"], PNG).json()["photo"]
    for path in (f"/api/cars/{kcar['id']}", f"/api/condition-reports/{report['id']}/file", f"/api/photos/{photo['id']}/content",
                 "/api/cars/c-testarossa", "/api/jobs/j-1002", "/api/jobs/j-1002/coat-stack", "/api/jobs/j-1004",
                 "/api/belongings/b-testarossa-keys/movements", "/api/jobs/j-1002/panels/bonnet/readings"):
        r = hen.call("GET", path)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, (path, r.text)
    r = hen.call("POST", "/api/releases", {"car_id": kcar["id"], "slot": garage.slot()}, key=idempotency_key())
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    r = hen.call("POST", "/api/jobs/j-1002/approve")
    assert r.status_code == 404
    assert garage.detail(kcar["id"])["releases"] == []
    for q in (kcar["model"], "Kenji", "Testarossa"):
        found = hen.ok("GET", f"/api/cars?q={quote(q)}")
        assert found["cars"] == [] and found["total"] == 0
    mine = hen.ok("GET", "/api/cars")
    assert mine["total"] == len(mine["cars"]) and all(c["owner"]["id"] == "u-henrietta" for c in mine["cars"])
    assert all(j["owner"]["id"] == "u-henrietta" and j["status"] != "draft" for j in hen.ok("GET", "/api/jobs")["jobs"])
    assert all(i["owner"]["id"] == "u-henrietta" for i in hen.ok("GET", "/api/invoices")["invoices"])
    assert all(r["owner"]["id"] == "u-henrietta" for r in hen.ok("GET", "/api/releases")["releases"])
    assert kenji.ok("GET", f"/api/cars?q={quote(kcar['model'])}")["total"] == 1
    assert kenji.call("GET", f"/api/condition-reports/{report['id']}/file").status_code == 200


def test_owner_emails(garage, mail):
    car = garage.car("u-kenji")
    name = car["name"]
    job = garage.job(car, J1003_LINES)
    sent = garage.as_(ODILE, mail_down()).ok("POST", f"/api/jobs/{job['id']}/send",
                                              headers={"If-Match": garage.etag(job["id"], mail_down())})["job"]

    def only_kenji(msg):
        body = text(msg)
        assert addresses(msg["To"]) == [KENJI]
        assert "Henrietta" not in body and HENRIETTA not in body

    est = mails(mail, f"Estimate {sent['number']} for your {name} is ready", 1, QUEUE_DEADLINE_S + DEADLINE_S)
    assert len(est) == 1
    only_kenji(est[0])
    body = text(est[0])
    assert f"CHF {sent['total']}" in body and sent["title"] in body and zdate_ts(sent["expires_at"]) in body
    assert f"/portal/jobs/{job['id']}" in body
    garage.as_(KENJI).ok("POST", f"/api/jobs/{job['id']}/approve")
    garage.stack(job["id"], [("Intake", {p: FILM for p, _ in PANELS})])
    garage.as_(ODILE).ok("POST", f"/api/jobs/{job['id']}/finish")
    inv = garage.as_(ODILE).ok("POST", f"/api/jobs/{job['id']}/invoice", key=idempotency_key())["invoice"]
    issued = mails(mail, f"Invoice {inv['number']} for your {name}", 1)
    assert len(issued) == 1
    only_kenji(issued[0])
    assert f"CHF {inv['total']}" in text(issued[0]) and f"/portal/invoices/{inv['id']}" in text(issued[0])
    rel = garage.request(car["id"])
    garage.as_(INES).ok("POST", f"/api/releases/{rel['id']}/book")
    booked = mails(mail, f"Release booked: {name}, {slot_label(rel['slot'])}", 1)
    assert len(booked) == 1
    only_kenji(booked[0])
    assert car["bay"]["code"] in text(booked[0]) and f"/portal/releases/{rel['id']}" in text(booked[0])
    out = garage.complete(car["id"])
    released_at = next(e["at"] for e in out["release"]["events"] if e["status"] == "released")
    done = mails(mail, f"Your {name} has been released", 1)
    assert len(done) == 1
    only_kenji(done[0])
    assert moment_label(released_at) in text(done[0]) and car["bay"]["code"] in text(done[0])
    assert len(mails(mail, f"Estimate {sent['number']} for your {name} is ready", 1)) == 1


def test_owner_projection(browser, app_url, garage):
    car, job, inv = garage.invoiced("u-kenji", J1003_LINES)
    ines, kenji, staff = garage.as_(INES), garage.as_(KENJI), garage.as_(RAFAEL)
    item = ines.ok("POST", f"/api/cars/{car['id']}/belongings", {"kind": "key_set", "label": ITEM_LABEL, "count": 1})["item"]
    ines.ok("POST", f"/api/belongings/{item['id']}/movements", {"direction": "out", "count": 1})
    upload_report(ines, car["id"], pdf_bytes())
    garage.as_(TOMAS).ok("POST", f"/api/cars/{car['id']}/care-entries", {"started": True, "battery_v": None, "tyres": None, "note": ""},
                         key=idempotency_key())
    garage.pay(inv["id"], SMALL_AMOUNT)
    rel = garage.request(car["id"])
    ines.ok("POST", f"/api/releases/{rel['id']}/book")
    paths = [f"/api/cars/{car['id']}", f"/api/belongings/{item['id']}/movements", f"/api/jobs/{job['id']}/panels/bonnet/readings",
             f"/api/invoices/{inv['id']}", f"/api/releases/{rel['id']}", f"/api/jobs/{job['id']}", "/api/invoices", "/api/releases", "/api/cars"]

    def leaks(obj, found):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("killbill_invoice_id", "killbill_payment_id", "recorded_by"):
                    found.append(k)
                leaks(v, found)
        elif isinstance(obj, list):
            for v in obj:
                leaks(v, found)
        elif isinstance(obj, str) and (obj in STAFF_IDS or obj in STAFF_NAMES):
            found.append(obj)
        return found

    for path in paths:
        body = kenji.ok("GET", path)
        assert leaks(body, []) == [], (path, leaks(body, []))
    owned = kenji.ok("GET", f"/api/cars/{car['id']}")["car"]
    assert owned["care_entries"][0]["by"] == HOUSE_ACTOR and owned["condition_report"]["uploaded_by"] == HOUSE_ACTOR
    assert kenji.ok("GET", f"/api/belongings/{item['id']}/movements")["movements"][0]["by"] == HOUSE_ACTOR
    assert kenji.ok("GET", f"/api/jobs/{job['id']}/panels/bonnet/readings")["readings"][0]["logged_by"] == HOUSE_ACTOR
    events = kenji.ok("GET", f"/api/releases/{rel['id']}")["release"]["events"]
    assert events[0]["by"] == {"id": "u-kenji", "name": "Kenji Arlow"} and events[1]["by"] == HOUSE_ACTOR
    seen = staff.ok("GET", f"/api/cars/{car['id']}")["car"]
    assert seen["care_entries"][0]["by"]["id"] == "u-tomas" and seen["condition_report"]["uploaded_by"]["id"] == "u-ines"
    staff_inv = staff.ok("GET", f"/api/invoices/{inv['id']}")["invoice"]
    assert staff_inv["killbill_invoice_id"] and staff_inv["payments"][0]["recorded_by"]["id"] == "u-rafael"
    with screen(browser, app_url, KENJI, f"/portal/cars/{car['id']}") as page:
        expect(page.get_by_role("heading").first).to_be_visible()
        body = page.inner_text("body")
        assert not any(n in body for n in STAFF_NAMES)


def test_wf_owner_portal_invoice_live(browser, app_url, garage, killbill):
    car, job, inv = garage.invoiced("u-kenji", J1001_LINES)
    with open_app(browser, app_url.rstrip("/") + "/sign-in") as page:
        page.set_viewport_size(LAPTOP)
        expect(page.get_by_role("heading", name="Sign in to Lacquer")).to_be_visible()
        page.get_by_role("textbox", name="Email").fill(KENJI)
        page.get_by_role("textbox", name="Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(page).to_have_url(re.compile(r"/portal$"))
        cars = page.get_by_role("list", name="My cars")
        card = cars.get_by_role("listitem").filter(has=page.get_by_role("link", name=car["name"]))
        expect(card).to_contain_text(f"Bay {car['bay']['code']}")
        expect(cars.get_by_role("link", name="1967 Jaguar E-Type")).to_have_count(0)
        expect(cars.get_by_role("link", name="1973 Porsche 911 Carrera RS 2.7")).to_have_count(0)
        page.goto(app_url.rstrip("/") + f"/portal/jobs/{job['id']}")
        for pane in ("Car plan", "Cross-section", "Job ledger"):
            expect(page.get_by_role("region", name=pane)).to_be_visible()
        expect(page.get_by_label("Total film build", exact=True)).to_contain_text(f"{FILM} µm")
        page.goto(app_url.rstrip("/") + f"/portal/invoices/{inv['id']}")
        expect(page.get_by_label("Outstanding", exact=True)).to_contain_text(f"Outstanding: CHF {inv['total']}")
        text_visible(page, "Awaiting payment")
        assert garage.pay(inv["id"], TRANSFER_AMOUNT).status_code == 200
        eventually(page, lambda: expect(page.get_by_label("Outstanding", exact=True)).to_contain_text(f"Outstanding: CHF {AFTER_TRANSFER}", timeout=EXPECT_MS),
                   step_ms=REREAD_MS)
        assert urlparse(page.url).path == f"/portal/invoices/{inv['id']}"
        assert garage.pay(inv["id"], AFTER_TRANSFER).status_code == 200
        eventually(page, lambda: text_visible(page, "Paid", exact=True, timeout=EXPECT_MS), step_ms=REREAD_MS)
    kb_id = garage.as_(RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]["killbill_invoice_id"]
    assert Decimal(str(kb_invoice(killbill, KENJI, kb_id)["balance"])) == 0


def test_owner_invoice_announcements(browser, app_url, garage):
    car, job, inv = garage.invoiced("u-kenji", J1001_LINES)
    with screen(browser, app_url, KENJI, f"/portal/invoices/{inv['id']}") as page:
        outstanding = page.get_by_label("Outstanding", exact=True)
        expect(outstanding).to_contain_text(f"Outstanding: CHF {inv['total']}")
        updates = status(page, "Invoice updates")
        expect(updates).to_have_text("")
        updates.evaluate(
            "(el) => { window.__inv = []; new MutationObserver(() => { const t = el.textContent.trim();"
            " if (window.__inv[window.__inv.length - 1] !== t) window.__inv.push(t); })"
            ".observe(el, {subtree: true, childList: true, characterData: true}); }")
        advance(page, REREAD_MS)
        advance(page, REREAD_MS)
        expect(updates).to_have_text("")
        assert garage.pay(inv["id"], TRANSFER_AMOUNT).status_code == 200
        first = f"Payment received. CHF {AFTER_TRANSFER} outstanding."
        eventually(page, lambda: expect(updates).to_have_text(first, timeout=EXPECT_MS), step_ms=REREAD_MS)
        expect(outstanding).to_contain_text(f"Outstanding: CHF {AFTER_TRANSFER}")
        advance(page, REREAD_MS)
        advance(page, REREAD_MS)
        expect(updates).to_have_text(first)
        assert garage.pay(inv["id"], AFTER_TRANSFER).status_code == 200
        second = f"Invoice {inv['number']} is paid."
        eventually(page, lambda: expect(updates).to_have_text(second, timeout=EXPECT_MS), step_ms=REREAD_MS)
        advance(page, REREAD_MS)
        expect(updates).to_have_text(second)
        said = [t for t in page.evaluate("window.__inv") if t]
        assert said == [first, second], said


def test_wf_owner_portal_return_address(browser, app_url):
    target = "/portal/jobs/j-1002?stage=0&panel=roof"
    with open_app(browser, app_url.rstrip("/") + target) as page:
        expect(page).to_have_url(re.compile(r"/sign-in\?next="))
        assert parse_qs(urlparse(page.url).query)["next"] == [target]
        page.get_by_role("textbox", name="Email").fill(KENJI)
        page.get_by_role("textbox", name="Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(page).to_have_url(re.compile(re.escape(target) + "$"))
        expect(page.get_by_role("heading", name="Job ledger", level=2)).to_be_visible()
    cases = {KENJI: ("/portal", "/portal/cars/c-300sl"), ODILE: ("/jobs", "/jobs/j-1001?stage=2&panel=bonnet")}
    for email, (home, good) in cases.items():
        r = Api(app_url).call("POST", "/api/session", {"email": email, "password": PASSWORD, "next": good})
        assert r.json()["redirect"] == good
        for bad in ("/" * 2 + EVIL_HOST, "/\\" + EVIL_HOST, f"https://{EVIL_HOST}/", "/api/me", "/sign-in"):
            r = Api(app_url).call("POST", "/api/session", {"email": email, "password": PASSWORD, "next": bad})
            assert r.status_code == 200 and r.json()["redirect"] == home, (email, bad, r.text)


@pytest.mark.parametrize("name", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_owner_breakpoints(browser, app_url, name):
    size = VIEWPORTS[name]
    order = [c["name"] for c in Api(app_url, KENJI).ok("GET", "/api/cars")["cars"]]
    assert len(order) >= 3
    with screen(browser, app_url, KENJI, "/portal", size) as page:
        layout(page)
        cards = page.get_by_role("list", name="My cars").get_by_role("listitem")
        names = [cards.nth(i).get_by_role("link").first.inner_text().strip() for i in range(len(order))]
        assert names == order
        tops = [cards.nth(i).bounding_box()["y"] for i in range(3)]
        per_row = 1 if size["width"] < TWO_PANES_FROM else 2 if size["width"] < THREE_PANES_FROM else 3
        assert sum(abs(t - tops[0]) < 2 for t in tops) == per_row, tops
        boxes = [cards.nth(i).bounding_box() for i in range(per_row)]
        assert all(b["x"] + b["width"] <= size["width"] + 1 for b in boxes)
        page.goto(app_url.rstrip("/") + "/portal/jobs/j-1002")
        layout(page)
        assert_panes(page, ["Car plan", "Cross-section", "Job ledger"], size["width"])


def test_wf_bay_billing_subscription(garage, killbill):
    std = garage.car("u-henrietta", cls="standard")
    capsule = garage.car("u-henrietta", length=4400, width=1800, cls="sealed_capsule")
    for car, plan, product, price in ((std, "bay-standard-monthly", "bay-standard", "480.00"),
                                      (capsule, "bay-sealed-capsule-monthly", "bay-sealed-capsule", "950.00")):
        subs = kb_subs(killbill, HENRIETTA, car["id"], lambda s: s.get("chargedThroughDate"))
        assert len(subs) == 1 and subs[0]["planName"] == plan
        bb = poll(lambda: (lambda b: b if b["status"] == "active" else None)(garage.detail(car["id"])["bay_billing"]),
                  QUEUE_DEADLINE_S * 2, "active bay billing")
        assert bb["plan"] in (plan, product) and bb["monthly_price"] == price
        assert bb["charged_through_date"] == subs[0]["chargedThroughDate"]
    garage.complete(std["id"])
    assert garage.detail(std["id"])["bay_billing"]["cancel_requested"] is True
    sub = kb_subs(killbill, HENRIETTA, std["id"], lambda s: s.get("billingEndDate"))[0]
    assert day_of(sub["billingEndDate"]) == day_of(sub["chargedThroughDate"])
    bb = poll(lambda: (lambda b: b if b["status"] == "ending" else None)(garage.detail(std["id"])["bay_billing"]),
              QUEUE_DEADLINE_S * 2, "ending bay billing")
    assert day_of(bb["billing_end_date"]) == day_of(sub["billingEndDate"]) and day_of(bb["charged_through_date"]) == day_of(sub["chargedThroughDate"])


def test_reread_keeps_dialog(browser, app_url, garage, killbill):
    car = garage.car()
    rel = garage.request(car["id"])
    with screen(browser, app_url, INES, f"/cars/{car['id']}") as page:
        page.get_by_role("button", name="Add item").click()
        d = page.get_by_role("dialog", name="Add item")
        d.get_by_role("textbox", name="Item label").fill(ITEM_LABEL)
        count = d.get_by_role("spinbutton", name="Count")
        count.fill("2")
        count.focus()
        garage.as_(RAFAEL).ok("POST", f"/api/releases/{rel['id']}/book")
        for _ in range(2):
            with page.expect_response(lambda r: f"/api/cars/{car['id']}" in r.url and r.request.method == "GET", timeout=DEADLINE_S * 1000):
                advance(page, REREAD_MS)
        sub = kb_subs(killbill, KENJI, car["id"], lambda s: s.get("chargedThroughDate"))[0]
        eventually(page, lambda: expect(page.get_by_label("Bay billing", exact=True)).to_contain_text(
            f"Billed monthly, paid through {zdate(sub['chargedThroughDate'])}", timeout=EXPECT_MS), step_ms=REREAD_MS)
        expect(d).to_be_visible()
        expect(d.get_by_role("textbox", name="Item label")).to_have_value(ITEM_LABEL)
        expect(count).to_have_value("2")
        expect(count).to_be_focused()
        expect(status(page, "Belongings updates")).to_have_text("")


def test_zurich_dates(browser, app_url, garage, killbill):
    car = garage.car("u-henrietta")
    sub = kb_subs(killbill, HENRIETTA, car["id"], lambda s: s.get("chargedThroughDate"))[0]
    poll(lambda: garage.detail(car["id"])["bay_billing"]["status"] == "active", QUEUE_DEADLINE_S * 2, "active")
    acct = kb_account(killbill, HENRIETTA)
    assert acct["timeZone"] == "Europe/Zurich" and acct["currency"] == "CHF"
    earliest = garage.as_(HENRIETTA).ok("GET", "/api/releases/earliest-slot")
    rel = garage.request(car["id"])
    ctx = browser.new_context(timezone_id=DEVICE_TZ, viewport=LAPTOP)
    try:
        for email in (HENRIETTA, INES):
            ctx.add_cookies(Api(app_url, email).cookies())
            page = ctx.new_page()
            if email == HENRIETTA:
                page.goto(app_url.rstrip("/") + "/portal")
                card = page.get_by_role("list", name="My cars").get_by_role("listitem").filter(has=page.get_by_role("link", name=car["name"]))
                expect(card).to_contain_text(f"Billed monthly, paid through {zdate(sub['chargedThroughDate'])}")
                page.goto(app_url.rstrip("/") + f"/portal/cars/{car['id']}/release")
                text_visible(page, f"Earliest slot: {slot_label(earliest['earliest'])}")
                expect(page.get_by_role("textbox", name="Date")).to_have_value(earliest["earliest"][:10])
                page.goto(app_url.rstrip("/") + f"/portal/releases/{rel['id']}")
                text_visible(page, slot_label(rel["slot"]))
            else:
                page.goto(app_url.rstrip("/") + f"/cars/{car['id']}")
                expect(page.get_by_label("Bay billing", exact=True)).to_contain_text(f"Billed monthly, paid through {zdate(sub['chargedThroughDate'])}")
            page.close()
            ctx.clear_cookies()
    finally:
        ctx.close()


def test_wf_bay_billing_my_cars_release(browser, app_url, garage, killbill):
    car = garage.car("u-henrietta")
    poll(lambda: garage.detail(car["id"])["bay_billing"]["status"] == "active", QUEUE_DEADLINE_S * 2, "active")
    garage.staged(car["id"])
    with screen(browser, app_url, HENRIETTA, "/portal") as page:
        cars = page.get_by_role("list", name="My cars")
        anchor = cars.get_by_role("link", name="1967 Jaguar E-Type")
        anchor.focus()
        scroll = page.evaluate("window.scrollY")
        expect(status(page, "Car updates")).to_have_text("")
        garage.complete(car["id"])
        sub = kb_subs(killbill, HENRIETTA, car["id"], lambda s: s.get("billingEndDate"))[0]
        copy = f"Bay billing for {car['name']} ends {zdate(sub['billingEndDate'])}."
        eventually(page, lambda: expect(status(page, "Car updates")).to_have_text(copy, timeout=EXPECT_MS), DEADLINE_S * 2, REREAD_MS)
        card = cars.get_by_role("listitem").filter(has=page.get_by_role("link", name=car["name"]))
        expect(card).to_contain_text("Released")
        expect(card).to_contain_text(f"Bay billing ends {zdate(sub['billingEndDate'])}")
        advance(page, REREAD_MS)
        advance(page, REREAD_MS)
        expect(status(page, "Car updates")).to_have_text(copy)
        expect(anchor).to_be_focused()
        assert page.evaluate("window.scrollY") == scroll


def test_wf_house_manager_board(browser, app_url, garage, killbill):
    car, job, inv = garage.invoiced("u-kenji", J1001_LINES)
    mgr = garage.as_(RAFAEL)
    try:
        with screen(browser, app_url, RAFAEL, "/board") as page:
            board = mgr.ok("GET", "/api/board")
            for pane in ("Occupancy", "Overdue care", "Unpaid invoices"):
                expect(page.get_by_role("region", name=pane).get_by_role("heading", name=pane, level=2)).to_be_visible()
            occ = board["occupancy"]
            expect(page.get_by_role("region", name="Occupancy")).to_contain_text(f"{occ['occupied']} of {occ['total']} bays occupied")
            unpaid = page.get_by_role("region", name="Unpaid invoices")
            expect(unpaid).to_contain_text(re.compile(r"Unpaid: CHF \d+\.\d{2}"))
            unpaid.get_by_role("button", name=f"Record bank transfer for {inv['number']}").click()
            d = page.get_by_role("dialog", name="Record bank transfer")
            expect(d.get_by_role("textbox", name="Amount (CHF)")).to_have_value(inv["total"])
            d.get_by_role("textbox", name="Bank reference").fill(TRANSFER_REF)
            d.get_by_role("textbox", name="Amount (CHF)").fill(TRANSFER_AMOUNT)
            d.get_by_role("button", name="Record transfer").click()
            expect(status(page, "Invoice updates")).to_have_text(f"Payment of CHF {TRANSFER_AMOUNT} recorded. CHF {AFTER_TRANSFER} outstanding.")
            page.goto(app_url.rstrip("/") + "/staff")
            page.get_by_role("button", name=f"Revoke access for {LUCA_NAME}").click()
            page.get_by_role("alertdialog", name=f"Revoke access for {LUCA_NAME}?").get_by_role("button", name="Revoke access").click()
            expect(status(page, "Access updates")).to_have_text(f"Access revoked for {LUCA_NAME}.")
            expect(page.get_by_role("table", name="Staff access").get_by_role("row").filter(has_text=LUCA)).to_contain_text("Access revoked")
        final = mgr.ok("GET", f"/api/invoices/{inv['id']}")["invoice"]
        assert final["balance"] == AFTER_TRANSFER
        assert Decimal(str(kb_invoice(killbill, KENJI, final["killbill_invoice_id"])["balance"])) == Decimal(AFTER_TRANSFER)
        r = Api(app_url).call("POST", "/api/session", {"email": LUCA, "password": PASSWORD})
        assert r.status_code == 401 and r.json() == {"error": "invalid_credentials"}
    finally:
        mgr.ok("PATCH", "/api/staff/u-luca", {"active": True})


def test_wf_house_manager_revoke_keyboard(browser, app_url, garage):
    mgr = garage.as_(RAFAEL)
    try:
        with screen(browser, app_url, RAFAEL, "/staff") as page:
            opener = page.get_by_role("button", name=f"Revoke access for {LUCA_NAME}")
            opener.focus()
            page.keyboard.press("Enter")
            d = page.get_by_role("alertdialog", name=f"Revoke access for {LUCA_NAME}?")
            expect(d).to_contain_text(f"{LUCA_NAME} will be signed out on every device.")
            expect(d.get_by_role("button", name="Keep access")).to_be_focused()
            for key in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
                page.keyboard.press(key)
                assert focus_inside(d), key
            page.keyboard.press("Escape")
            expect(d).to_be_hidden()
            expect(opener).to_be_focused()
            page.keyboard.press("Enter")
            d.get_by_role("button", name="Revoke access").focus()
            page.keyboard.press("Enter")
            restore = page.get_by_role("button", name=f"Restore access for {LUCA_NAME}")
            expect(restore).to_be_focused()
            expect(status(page, "Access updates")).to_have_text(f"Access revoked for {LUCA_NAME}.")
            page.keyboard.press("Enter")
            expect(page.get_by_role("button", name=f"Revoke access for {LUCA_NAME}")).to_be_focused()
            expect(status(page, "Access updates")).to_have_text(f"Access restored for {LUCA_NAME}.")
        member = next(m for m in mgr.ok("GET", "/api/staff")["staff"] if m["id"] == "u-luca")
        assert member["active"] is True and member["revoked_at"] is None
    finally:
        mgr.ok("PATCH", "/api/staff/u-luca", {"active": True})


def test_revoked_sessions(browser, app_url, garage):
    mgr = garage.as_(RAFAEL)
    one, two = Api(app_url, LUCA), Api(minio_down(), LUCA)
    try:
        with screen(browser, app_url, LUCA, "/round", api=one) as page:
            expect(page.get_by_role("heading", name="Care round", level=1)).to_be_visible()
            member = mgr.ok("PATCH", "/api/staff/u-luca", {"active": False})["member"]
            assert member["active"] is False and member["revoked_at"]
            for api in (one, two):
                r = api.call("GET", "/api/me")
                assert r.status_code == 401 and r.json() == {"error": "access_revoked"}
            eventually(page, lambda: expect(page).to_have_url(re.compile(r"/sign-in$"), timeout=EXPECT_MS), step_ms=ROUND_REREAD_MS)
            expect(page.get_by_role("alert", name="There is a problem")).to_contain_text("Your access has been revoked.")
        r = Api(app_url).call("POST", "/api/session", {"email": LUCA, "password": PASSWORD})
        assert r.status_code == 401 and r.json() == {"error": "invalid_credentials"}
        mgr.ok("PATCH", "/api/staff/u-luca", {"active": True})
        for api in (one, two):
            assert api.call("GET", "/api/me").json() == {"error": "access_revoked"}
        assert Api(app_url, LUCA).call("GET", "/api/me").status_code == 200
        r = mgr.call("PATCH", "/api/staff/u-rafael", {"active": False})
        assert r.status_code == 409 and r.json() == {"error": "cannot_change_own_access"}
        r = mgr.call("PATCH", "/api/staff/u-kenji", {"active": False})
        assert r.status_code == 404
    finally:
        mgr.ok("PATCH", "/api/staff/u-luca", {"active": True})


def test_contrast_not_tint(browser, app_url, garage):
    car, job, inv = garage.invoiced("u-kenji", J1003_LINES)
    for name in ("phone", "tablet", "laptop"):
        size = VIEWPORTS[name]
        with screen(browser, app_url, RAFAEL, "/board", size) as page:
            axe(page)
            putty = ground(page)
            plan = page.get_by_role("group", name="Floor plan")
            for bay in plan.get_by_role("button").all():
                shown = bay.evaluate("e => e.textContent")
                label = bay.get_attribute("aria-label") or shown
                if "occupied by" in label:
                    assert label.split("occupied by ", 1)[1] in shown, label
                else:
                    assert "Free" in shown, label
            buttons = [b for b in page.get_by_role("button").all() if b.is_visible()]
            for b in buttons:
                colours = [parse_rgb(c) for c in b.evaluate(BOUNDARY_JS)]
                best = max((contrast(c, putty) for c in colours if c), default=0)
                assert best >= OUTLINE_RATIO, (b.get_attribute("aria-label") or b.evaluate("e => e.textContent"), best)
            rest, focus = state_styles(buttons[0], "outline-color", "outline-style", "box-shadow", state="focus")
            ring = focus_ring(focus)
            assert max((contrast(c, putty) for c in ring), default=0) >= OUTLINE_RATIO, ring
            line = page.get_by_role("region", name="Unpaid invoices").get_by_text(re.compile(r"Unpaid: CHF")).first
            assert line.evaluate(ICON_JS), "the line carries no icon"
            page.get_by_role("button", name=f"Record bank transfer for {inv['number']}").click()
            d = page.get_by_role("dialog", name="Record bank transfer")
            expect(d).to_be_visible()
            advance(page, DIALOG_SETTLE_MS)
            axe(page)
            for field in (d.get_by_role("textbox", name="Bank reference"), d.get_by_role("textbox", name="Amount (CHF)")):
                best = max((contrast(c, putty) for c in map(parse_rgb, field.evaluate(BOUNDARY_JS)) if c), default=0)
                assert best >= OUTLINE_RATIO
            page.keyboard.press("Escape")
            page.goto(app_url.rstrip("/") + "/staff")
            expect(page.get_by_role("table", name="Staff access")).to_be_visible()
            axe(page)


def test_wf_outages_recovery(app_url, garage, killbill):
    for base, service in ((minio_down(), "storage"), (killbill_down(), "billing"), (mail_down(), "mail")):
        anon = Api(base).ok("GET", "/api/status")
        assert anon[service] == "down" and all(v == "up" for k, v in anon.items() if k != service), (base, anon)
        ines, tomas = Api(base, INES), Api(base, TOMAS)
        assert ines.call("GET", "/api/bays").status_code == 200 and ines.call("GET", "/api/cars").status_code == 200
        assert tomas.call("GET", "/api/care-round").status_code == 200
        car = garage.car(base=base)
        item = ines.ok("POST", f"/api/cars/{car['id']}/belongings", {"kind": "key_set", "label": ITEM_LABEL, "count": 1})["item"]
        assert ines.ok("POST", f"/api/belongings/{item['id']}/movements", {"direction": "out", "count": 1})["item"]["count_in"] == 0
        tomas.ok("POST", f"/api/cars/{car['id']}/care-entries", {"started": True, "battery_v": None, "tyres": None, "note": ""},
                 key=idempotency_key())
        if service == "storage":
            data = pdf_bytes()
            r = upload_report(ines, car["id"], data)
            assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
            assert S3().keys(f"cars/{car['id']}/") == [] and garage.detail(car["id"])["condition_report"] is None
            assert upload_report(garage.as_(INES), car["id"], data).status_code == 201
            assert len(S3().keys(f"cars/{car['id']}/condition-reports/")) == 1
        if service == "billing":
            subs = kb_subs(killbill, KENJI, car["id"], seconds=QUEUE_DEADLINE_S + DEADLINE_S)
            assert len(subs) == 1
            _, job = garage.finished(lines=J1003_LINES)
            key = idempotency_key()
            r = Api(base, ODILE).call("POST", f"/api/jobs/{job['id']}/invoice", key=key)
            assert r.status_code == 503 and r.json() == {"error": "billing_unavailable"}
            assert garage.as_(ODILE).ok("GET", f"/api/jobs/{job['id']}")["job"]["status"] == "finished"
            assert kb_invoices_for(killbill, KENJI, f"Workshop job {job['number']}") == []
            assert garage.as_(ODILE).call("POST", f"/api/jobs/{job['id']}/invoice", key=key).status_code == 201
            assert len(kb_invoices_for(killbill, KENJI, f"Workshop job {job['number']}")) == 1


@pytest.mark.parametrize("service", ["storage", "billing", "mail"], ids=["storage", "billing", "mail"])
def test_outage_notices(browser, app_url, service):
    base, copy = {"storage": (minio_down(), STORAGE_NOTICE), "billing": (killbill_down(), BILLING_NOTICE),
                  "mail": (mail_down(), MAIL_NOTICE)}[service]
    for email, path in ((INES, "/bays"), (RAFAEL, "/board")):
        with screen(browser, base, email, path) as page:
            start = time.monotonic()
            eventually(page, lambda: expect(status(page, "Service notice")).to_contain_text(copy, timeout=EXPECT_MS), NOTICE_DEADLINE_S,
                       NOTICE_CHECK_MS // 5)
            assert time.monotonic() - start <= NOTICE_DEADLINE_S
    with screen(browser, app_url, INES, "/bays") as page:
        advance(page, NOTICE_DEADLINE_S * 1000)
        notice = status(page, "Service notice")
        if notice.count():
            for line in (STORAGE_NOTICE, BILLING_NOTICE, MAIL_NOTICE):
                expect(notice).not_to_contain_text(line)


def test_wf_outages_no_false_success(browser, app_url, garage):
    car = garage.car(store=False, length=3900, width=1600)
    bay = next(b for b in garage.as_(INES).ok("GET", f"/api/bays?fits={car['id']}")["bays"] if b["eligible"])
    with screen(browser, app_url, INES, f"/cars/{car['id']}") as page:
        page.get_by_role("button", name="Choose bay").click()
        dialog = page.get_by_role("dialog", name="Choose bay")
        dialog.get_by_role("group", name="Floor plan").get_by_role("button", name=re.compile(rf"^Bay {bay['code']}, ")).click()
        with held(page, "**/api/cars/*/bay") as gate:
            dialog.get_by_role("button", name=f"Assign bay {bay['code']}").click()
            expect(status(page, "Bay updates")).to_have_text(f"Assigning bay {bay['code']}...")
            expect(page.get_by_label("Bay billing", exact=True)).not_to_contain_text("paid through")
            gate.release()
        expect(status(page, "Bay updates")).to_have_text(f"{car['name']} assigned to bay {bay['code']}.")
        with held(page, "**/api/cars/*/photos") as gate:
            page.get_by_label("Intake photo").set_input_files({"name": PHOTO_NAME, "mimeType": "image/png", "buffer": PNG})
            page.get_by_role("button", name="Upload photo").click()
            expect(status(page, "Upload updates")).to_have_text(f"Uploading {PHOTO_NAME}...")
            expect(page.get_by_role("list", name="Photos").get_by_role("listitem")).to_have_count(0)
            bar = page.get_by_role("progressbar", name="Upload progress")
            if bar.count():
                assert int(float(bar.get_attribute("aria-valuenow") or 0)) <= 95
            gate.release()
        expect(page.get_by_role("list", name="Photos").get_by_role("listitem")).to_have_count(1)
    with screen(browser, minio_down(), INES, f"/cars/{car['id']}") as page:
        photos = page.get_by_role("list", name="Photos").get_by_role("listitem")
        expect(photos).to_have_count(1)
        page.get_by_label("Intake photo").set_input_files({"name": "intake.png", "mimeType": "image/png", "buffer": PNG})
        page.get_by_role("button", name="Upload photo").click()
        copy = "Photo storage is unreachable. Nothing was uploaded; try again when the notice clears."
        expect(status(page, "Upload updates")).to_have_text(copy)
        expect(photos).to_have_count(1)
        bar = page.get_by_role("progressbar", name="Upload progress")
        assert bar.count() == 0 or bar.get_attribute("aria-valuenow") != "100"
        advance(page, REREAD_MS)
        expect(status(page, "Upload updates")).to_have_text(copy)
    assert len(garage.detail(car["id"])["photos"]) == 1 and len(S3().keys(f"cars/{car['id']}/photos/")) == 1


def test_refusal_stays(browser, garage):
    car = garage.car()
    rel = garage.staged(car["id"])
    with screen(browser, mail_down(), INES, "/releases") as page:
        row = page.get_by_role("table", name="Releases").get_by_role("row").filter(has_text=car["name"])
        button = row.get_by_role("button", name="Complete release")
        button.click()
        copy = "Email is unreachable, so the release was not completed. Nothing has changed."
        expect(status(page, "Release updates")).to_have_text(copy)
        expect(button).to_be_focused()
        for _ in range(3):
            advance(page, NOTICE_CHECK_MS)
            advance(page, REREAD_MS)
            expect(status(page, "Release updates")).to_have_text(copy)
            expect(button).to_be_focused()
        expect(button).to_be_visible()
    assert garage.as_(INES).ok("GET", f"/api/releases/{rel['id']}")["release"]["status"] == "staged"
    assert garage.detail(car["id"])["status"] == "stored"


def test_cross_system_order(app_url, garage, killbill, mail):
    base = killbill_down()
    car = garage.car("u-henrietta", base=base)
    ines_kb = Api(base, INES)
    ines_kb.ok("POST", f"/api/cars/{car['id']}/belongings", {"kind": "key_set", "label": ITEM_LABEL, "count": 1})
    rel = garage.staged(car["id"], base)
    r = ines_kb.call("POST", f"/api/releases/{rel['id']}/complete")
    assert r.status_code == 409 and r.json()["error"] == "belongings_checked_in"
    subs = kb_subs(killbill, HENRIETTA, car["id"], lambda s: s.get("chargedThroughDate"), QUEUE_DEADLINE_S + DEADLINE_S)
    assert len(subs) == 1 and not subs[0].get("billingEndDate")
    assert garage.detail(car["id"])["bay_billing"]["cancel_requested"] is False
    garage.empty(car["id"])
    clients = [Api(base, INES), Api(base, INES), Api(app_url, INES)]
    results = together([lambda c=c: c.call("POST", f"/api/releases/{rel['id']}/complete") for c in clients])
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    assert all(r.json() == {"error": "invalid_transition"} for r in results if r.status_code == 409)
    assert len(mails(mail, f"Your {car['name']} has been released", 1)) == 1
    sub = kb_subs(killbill, HENRIETTA, car["id"], lambda s: s.get("billingEndDate"), QUEUE_DEADLINE_S + DEADLINE_S)[0]
    assert day_of(sub["billingEndDate"]) == day_of(sub["chargedThroughDate"])
    acct = kb_account(killbill, HENRIETTA)
    assert any(i.get("subscriptionId") == sub["subscriptionId"] for inv in killbill.invoices(acct["accountId"]) for i in inv.get("items") or [])
    bb = poll(lambda: (lambda b: b if b["status"] == "ending" else None)(garage.detail(car["id"])["bay_billing"]), DEADLINE_S, "ending")
    assert day_of(bb["billing_end_date"]) == day_of(sub["billingEndDate"])
    other = garage.car()
    uploaders = [Api(app_url, INES), Api(minio_down(), RAFAEL), Api(app_url, RAFAEL)]
    ups = together([lambda c=c: upload_report(c, other["id"], pdf_bytes()) for c in uploaders])
    codes = sorted(r.status_code for r in ups)
    assert codes.count(201) <= 1 and all(r.json() == {"error": "report_already_signed"} for r in ups if r.status_code == 409)
    if 201 not in codes:
        assert 503 in codes, codes
        retry = poll(lambda: (lambda r: r if r.status_code != 409 else None)(upload_report(Api(app_url, INES), other["id"], pdf_bytes())), DEADLINE_S, "claim released")
        assert retry.status_code == 201, retry.text
    assert len(S3().keys(f"cars/{other['id']}/condition-reports/")) == 1


def test_stale_balances(browser, garage):
    car, job, inv = garage.invoiced("u-kenji", J1003_LINES)
    live = garage.as_(RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]
    assert live["balance_live"] is True
    base = killbill_down()
    stale = Api(base, RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]
    assert stale["balance_live"] is False and stale["balance"] == inv["total"] and stale["status_confirmed_at"]
    when = zdate_ts(stale["status_confirmed_at"])
    board = Api(base, RAFAEL).ok("GET", "/api/board")
    assert board["unpaid"]["live"] is False and inv["id"] in [i["id"] for i in board["unpaid"]["invoices"]]
    line = f"Outstanding: CHF {inv['total']}, last confirmed {when}"
    with screen(browser, base, KENJI, f"/portal/invoices/{inv['id']}") as page:
        expect(page.get_by_label("Outstanding", exact=True)).to_contain_text(line)
    with screen(browser, base, ODILE, f"/jobs/{job['id']}") as page:
        expect(page.get_by_role("region", name="Job ledger").get_by_label("Outstanding", exact=True)).to_contain_text(line)
    with screen(browser, base, RAFAEL, "/board") as page:
        expect(page.get_by_role("region", name="Unpaid invoices")).to_contain_text(line)
        expect(page.get_by_role("region", name="Unpaid invoices")).to_contain_text(re.compile(r"Unpaid: CHF \d+\.\d{2}, last confirmed "))
    assert garage.pay(inv["id"], SMALL_AMOUNT).status_code == 200
    remaining = str(Decimal(inv["total"]) - Decimal(SMALL_AMOUNT))
    assert garage.as_(RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]["balance"] == remaining
    after = Api(base, RAFAEL).ok("GET", f"/api/invoices/{inv['id']}")["invoice"]
    assert after["balance"] == remaining and after["balance_live"] is False


def start_stream(api: Api, path: str, head: bytes, total: int, first: bytes) -> socket.socket:
    parts = urlparse(api.base)
    tail = b"\r\n--lacquerboundary--\r\n"
    request = (f"POST {parts.path.rstrip('/')}{path} HTTP/1.1\r\nHost: {parts.netloc}\r\nOrigin: {api.origin}\r\n"
               f"Cookie: {api.cookie_header()}\r\nContent-Type: multipart/form-data; boundary=lacquerboundary\r\n"
               f"Content-Length: {len(head) + total + len(tail)}\r\nConnection: close\r\n\r\n").encode()
    sock = socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT_S)
    sock.sendall(request + head + first)
    return sock


def file_part(name: str, ctype: str) -> bytes:
    return (f"--lacquerboundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n").encode()


def test_abandoned_uploads(app_url, garage):
    car = garage.car()
    ines = Api(app_url, INES)
    pg = Postgres()
    sock = start_stream(ines, f"/api/cars/{car['id']}/condition-report", file_part("report.pdf", "application/pdf"),
                        STREAM_TOTAL, b"%PDF-1.4\n" + b"0" * STREAM_CHUNK)
    sock.settimeout(NO_EARLY_ANSWER_S)
    try:
        assert sock.recv(1) == b""
    except socket.timeout:
        pass
    began = time.monotonic()
    second = upload_report(Api(app_url, INES), car["id"], pdf_bytes())
    assert time.monotonic() - began < CLAIM_ANSWER_S
    assert second.status_code == 409 and second.json() == {"error": "report_already_signed"}
    sock.shutdown(socket.SHUT_RDWR)
    sock.close()
    poll(lambda: S3().keys(f"cars/{car['id']}/") == [] and app_sessions_busy(pg) == 0, ABANDON_CLEAN_S, "abandoned upload clean-up")
    assert garage.detail(car["id"])["condition_report"] is None
    data = pdf_bytes()
    assert upload_report(ines, car["id"], data).status_code == 201
    keys = S3().keys(f"cars/{car['id']}/condition-reports/")
    assert len(keys) == 1 and S3().get(keys[0]) == data
    kind = b"--lacquerboundary\r\nContent-Disposition: form-data; name=\"kind\"\r\n\r\nintake\r\n"
    for _ in range(ABANDONED_RUNS):
        s = start_stream(ines, f"/api/cars/{car['id']}/photos", kind + file_part("intake.png", "image/png"), STREAM_TOTAL, PNG + b"0" * STREAM_CHUNK)
        s.shutdown(socket.SHUT_RDWR)
        s.close()
    poll(lambda: S3().keys(f"cars/{car['id']}/photos/") == [] and app_sessions_busy(pg) == 0, ABANDON_CLEAN_S * 2, "photo clean-up")
    for path in ("/api/cars", "/api/bays", "/api/care-round"):
        began = time.monotonic()
        assert garage.as_(RAFAEL).call("GET", path).status_code == 200
        assert time.monotonic() - began < READ_BUDGET_S, path
    assert garage.detail(car["id"])["photos"] == []


@pytest.mark.parametrize("name", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_breakpoints(browser, app_url, name):
    size = VIEWPORTS[name]
    with screen(browser, app_url, RAFAEL, "/board", size) as page:
        layout(page)
        assert_panes(page, ["Occupancy", "Overdue care", "Unpaid invoices"], size["width"])
        page.goto(app_url.rstrip("/") + "/jobs/j-1001")
        layout(page)
        assert_panes(page, ["Car plan", "Cross-section", "Job ledger"], size["width"])


def test_announced_results(browser, app_url, garage):
    car = garage.car()
    with screen(browser, app_url, INES, f"/cars/{car['id']}") as page:
        page.get_by_role("button", name="Add item").click()
        d = page.get_by_role("dialog", name="Add item")
        select(d.get_by_role("combobox", name="Item kind"), "Key set")
        d.get_by_role("textbox", name="Item label").fill(ITEM_LABEL)
        d.get_by_role("spinbutton", name="Count").fill("1")
        with held(page, "**/api/cars/*/belongings") as gate:
            d.get_by_role("button", name="Add").click()
            expect(status(page, "Belongings updates")).to_have_text("Saving...")
            gate.release()
        expect(status(page, "Belongings updates")).to_have_text(f"{ITEM_LABEL}: 1 checked in.")
        page.get_by_role("button", name="Units").click()
        with held(page, "**/api/me/units") as gate:
            page.get_by_role("dialog", name="Units").get_by_role("button", name="Save units").click()
            expect(status(page, "Settings updates")).to_have_text("Saving units...")
            gate.release()
        expect(status(page, "Settings updates")).to_have_text("Units updated.")
        page.goto(app_url.rstrip("/") + "/bays")
        page.get_by_role("button", name="Register car").click()
        r = page.get_by_role("dialog", name="Register car")
        select(r.get_by_role("combobox", name="Owner"), "Kenji Arlow")
        r.get_by_role("spinbutton", name="Year").fill("1971")
        r.get_by_role("textbox", name="Make").fill("Lark")
        r.get_by_role("textbox", name="Model").fill(tag())
        r.get_by_role("textbox", name="Registration").fill("TI 19710")
        r.get_by_role("textbox", name="Colour").fill("Blu Lancia")
        r.get_by_role("spinbutton", name="Length (mm)").fill("1")
        r.get_by_role("spinbutton", name="Width (mm)").fill("1555")
        r.get_by_role("textbox", name=re.compile(r"^Odometer \(")).fill("112045")
        r.get_by_role("textbox", name=re.compile(r"^Tyre pressure \(")).fill("1.80")
        r.get_by_role("button", name="Register").click()
        summary = page.get_by_role("alert", name="There is a problem")
        expect(summary).to_be_visible()
        text_visible(r, "Enter a length from 2000 to 7000 mm.")
        summary.get_by_role("link", name="Enter a length from 2000 to 7000 mm.").click()
        expect(r.get_by_role("spinbutton", name="Length (mm)")).to_be_focused()


SCREEN_IDS = ["bays", "round", "jobs", "job", "board", "staff", "releases", "portal"]
SCREENS = {
    "bays": (INES, "/bays"), "round": (TOMAS, "/round"), "jobs": (ODILE, "/jobs"), "job": (ODILE, "/jobs/j-1001"),
    "board": (RAFAEL, "/board"), "staff": (RAFAEL, "/staff"), "releases": (INES, "/releases"), "portal": (KENJI, "/portal"),
}


@pytest.mark.parametrize("screen_id", SCREEN_IDS, ids=SCREEN_IDS)
def test_touch_phone_width(browser, app_url, screen_id):
    email, path = SCREENS[screen_id]
    with screen(browser, app_url, email, path, PHONE) as page:
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
        layout(page)
        for role in ("button", "textbox", "searchbox", "combobox"):
            for control in page.get_by_role(role).all():
                if not control.is_visible():
                    continue
                box = control.bounding_box()
                assert box["width"] >= TOUCH_MIN_PX - 0.5 and box["height"] >= TOUCH_MIN_PX - 0.5, \
                    (role, control.get_attribute("aria-label") or control.inner_text(), box)


def test_health_manifest(app_url):
    anon = Api(app_url)
    r = anon.call("GET", "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    st = anon.ok("GET", "/api/status")
    assert set(st) == {"storage", "billing", "mail"} and all(v in ("up", "down") for v in st.values())
    page = anon.call("GET", "/")
    assert page.status_code == 200 and page.text
    port = urlparse(app_url).port
    assert port is None or port in (4173, int(os.environ.get("APP_PUBLIC_PORT", "4173")))


def test_server_boundary(app_url, garage):
    ines = garage.as_(INES)
    model = tag()
    body = {"owner_id": "u-kenji", "year": 1971, "make": "Lark", "model": model, "registration": model[-20:], "colour": "Blu Lancia",
            "length_mm": 4000, "width_mm": 1700, "odometer": {"value": 10, "unit": "km"}, "tyre_spec": {"value": TYRE_SPEC, "unit": "bar"},
            "startup_schedule": False}
    r = ines.call("POST", "/api/cars", body, headers={"Origin": EVIL_ORIGIN})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert ines.ok("GET", f"/api/cars?q={quote(model)}")["total"] == 0

    prefix, suffix = b'{"make":"', b'"}'
    exact = prefix + b"x" * (JSON_LIMIT - len(prefix) - len(suffix)) + suffix
    r = ines.c.post("/api/cars", content=exact, headers={"Content-Type": "application/json"})
    assert r.status_code != 413
    r = ines.c.post("/api/cars", content=exact[:-2] + b'x"}', headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    car = garage.car()
    big = b"%PDF-1.4\n" + b"0" * UPLOAD_LIMIT
    r = upload_report(ines, car["id"], big)
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    assert S3().keys(f"cars/{car['id']}/") == [] and garage.detail(car["id"])["condition_report"] is None
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "KILLBILL_API_SECRET", "KILLBILL_PASSWORD", "DATABASE_URL")]
    secrets = [s for s in secrets if len(s) >= 6 and not s.isalpha()]
    anon = Api(app_url)
    for path, marker in (("/run.json", "run-manifest-v1"), ("/package.json", '"dependencies"'), ("/package-lock.json", "lockfileVersion"),
                         ("/.env", "DATABASE_URL"), ("/tsconfig.json", "compilerOptions")):
        r = anon.call("GET", path)
        assert r.status_code != 200 or marker not in r.text, path
    index = anon.call("GET", "/").text
    assets = re.findall(r"""(?:src|href)=["'](/[^"']+\.(?:js|css|mjs))["']""", index)
    for blob in [index] + [anon.call("GET", a).text for a in assets]:
        assert not any(s in blob for s in secrets)


def typecheck_commands() -> list[list[str]]:
    root = DEPLOYED_APP
    pkg = root / "package.json"
    scripts = json.loads(pkg.read_text()).get("scripts", {}) if pkg.is_file() else {}
    for name in TYPECHECK_SCRIPTS:
        if name in scripts:
            return [["npm", "run", "--silent", name]]
    configs: list[str] = []
    if (root / "tsconfig.json").is_file():
        configs = ["tsconfig.json"] + sorted(set(TSCONFIG_REFERENCE.findall((root / "tsconfig.json").read_text())))
    if not configs:
        configs = sorted(str(p.relative_to(root)) for p in root.rglob("tsconfig.json")
                         if "node_modules" not in p.parts and len(p.relative_to(root).parts) <= TSCONFIG_DEPTH)
    assert configs, "no tsconfig.json and no type-check script"
    return [["npx", "--no-install", "tsc", "--noEmit", "-p", c] for c in configs]


def npm_tree():
    cwd = "/app" if Path("/app/node_modules").exists() else str(DEPLOYED_APP)
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd, capture_output=True, text=True, timeout=600)
    data = json.loads(out.stdout or "{}")
    found = {}

    def walk(deps):
        for name, info in (deps or {}).items():
            if info.get("version") and not info.get("missing"):
                found[name] = info
            walk(info.get("dependencies"))

    walk(data.get("dependencies"))
    return cwd, found


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    _, tree = npm_tree()
    missing = [n for n in tree if n not in notices]
    assert not missing, missing
    for font in ("Archivo", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices


def test_if_licences():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
    cwd, tree = npm_tree()
    bad = []
    for name, info in tree.items():
        lic = info.get("license")
        if lic is None:
            pkg = Path(info.get("path") or Path(cwd) / "node_modules" / name) / "package.json"
            lic = json.loads(pkg.read_text()).get("license") if pkg.exists() else None
        if isinstance(lic, dict):
            lic = lic.get("type")
        expr = (lic or "").strip("()")
        if " OR " in expr:
            ok = any(p.strip("() ") in allowed for p in expr.split(" OR "))
        elif expr:
            ok = all(p.strip("() ") in allowed for p in expr.split(" AND "))
        else:
            ok = False
        if not ok:
            bad.append((name, lic))
    assert not bad, bad
    assert re.search(r"OFL|Open Font Licen[cs]e", Path("/app/THIRD_PARTY_NOTICES.md").read_text(), re.I)


def test_if_no_extra_datastore():
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "@seald-io/nedb", "level",
              "leveldown", "classic-level", "lmdb", "pouchdb", "lokijs", "node-persist"}
    _, tree = npm_tree()
    assert not banned & set(tree), banned & set(tree)
    assert Postgres().tables()


def test_if_typescript():
    for command in typecheck_commands():
        out = subprocess.run(command, cwd=str(DEPLOYED_APP), capture_output=True, text=True, timeout=900)
        assert out.returncode == 0, (command, out.stdout[-4000:] + out.stderr[-2000:])
    skip = {"node_modules", "dist", "build", ".git", "coverage", ".vite", "out", ".next"}
    stray = [str(p) for p in Path("/app").rglob("*") if p.suffix in (".js", ".jsx", ".mjs", ".cjs")
             and not skip & set(p.parts) and ".config." not in p.name
             and p.parent != Path("/app")]
    assert not stray, stray


def test_if_same_origin_assets(browser, app_url):
    seen = []
    for email, path in ((INES, "/bays"), (KENJI, "/portal"), (ODILE, "/jobs/j-1001")):
        with screen(browser, app_url, email, path) as page:
            page.on("request", lambda r: seen.append(r.url))
            page.reload()
            page.wait_for_load_state("networkidle")
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_provided_services(app_url, killbill):
    st = Api(app_url).ok("GET", "/api/status")
    assert st == {"storage": "up", "billing": "up", "mail": "up"}
    acct = kb_account(killbill, KENJI)
    assert str(acct.get("externalKey", "")).endswith("owner-u-kenji")
    assert Postgres().tables()
    assert isinstance(S3().keys(""), list)
