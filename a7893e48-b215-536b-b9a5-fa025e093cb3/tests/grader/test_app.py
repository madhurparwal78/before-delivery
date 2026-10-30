from __future__ import annotations

import json
import math
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
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (DEPLOYED_APP, S3, addresses, advance, animations, axe, check, click, fill, held,
                      idempotency_key, layout, mail_from_address, motion, open_app, same_origin, select, tab_order,
                      text)

HALSTED, CORKTOWN, FREMONT = "site-halsted", "site-corktown", "site-fremont"
TZ = {HALSTED: "America/Chicago", CORKTOWN: "America/Detroit", FREMONT: "America/Los_Angeles"}
SITE_NAMES = {HALSTED: "Ember Row — Halsted", CORKTOWN: "Ember Row — Corktown", FREMONT: "Cedar Commons — Fremont"}
DEPOSIT = {HALSTED: 7500, CORKTOWN: 7500, FREMONT: 6000}
CLEANING = {HALSTED: 3500, CORKTOWN: 3500, FREMONT: 3000}
STATIONS = {
    HALSTED: [("st-deck-1", "Deck oven 1", 3800), ("st-deck-2", "Deck oven 2", 3800),
              ("st-range-a", "Range line A", 3200), ("st-prep-3", "Prep table 3", 2000),
              ("st-walkin-4", "Walk-in shelf 4", 600)],
    CORKTOWN: [("st-ct-deck", "Deck oven", 3600), ("st-ct-range", "Range line", 3000),
               ("st-ct-prep", "Prep table", 1800)],
    FREMONT: [("st-fr-deck", "Deck oven", 4000), ("st-fr-range", "Range line", 3400),
              ("st-fr-prep", "Prep table", 2200)],
}
SEED_PASSWORD = "hearth-demo-2026"
ODILE, PRIYA, MARCUS = "odile@emberrow.test", "desk.halsted@emberrow.test", "desk.corktown@emberrow.test"
WEN, ADA, TAMSIN = "wen@cedarcommons.test", "desk@cedarcommons.test", "tamsin@junipercrumb.test"
RAFA, IKE, JUNE = "rafa@saltboxtacos.test", "ike@nightjarpies.test", "june@littleledger.test"
SEEDED = {TAMSIN: ("rn-juniper", "Tamsin Okoro", "Juniper Crumb Bakery", "+1-312-555-0141"),
          RAFA: ("rn-saltbox", "Rafa Quintero", "Saltbox Tacos", "+1-312-555-0172"),
          IKE: ("rn-nightjar", "Ike Brennan", "Nightjar Pies", "+1-312-555-0190"),
          JUNE: ("rn-ledger", "June Abernathy", "Little Ledger Meal Prep", "+1-313-555-0118")}
DESK = {HALSTED: PRIYA, CORKTOWN: MARCUS}
MANAGER = {HALSTED: ODILE, CORKTOWN: ODILE, FREMONT: WEN}

PACK_MINUTES = 1200
PACK_PRICE_CENTS = 56000
MAX_OCCURRENCE_MIN = 720
DAY_NORMAL, DAY_SPRING, DAY_AUTUMN = 1440, 1380, 1500
FALLBACK_SHIFT_MIN, NORMAL_SHIFT_MIN = 300, 240
OVERRUN_MINUTES = 40
OVERRUN_MAX = 240
MAX_NOTICE = 168
REASON_MIN, REASON_MAX = 5, 500
FILE_LIMIT = 5000000
UPLOAD_BODY_LIMIT = 5100000
JSON_BODY_LIMIT = 64000
BINDER_MAX_DAYS = 31
BINDER_TTL_DEFAULT_S = 604800
REPEAT_MAX = 12
DAYS_AHEAD_MAX = 365
REMINDER_DAYS = 14
REMINDER_FIRST_S = 60
REMINDER_EVERY_S = 15
CUTOFF_GRACE_S = 60
HOLD_EXPIRY_STATUS_S = 15
BANNER_S = 15
RECOVERY_S = 30
SEARCH_PAUSE_MS = 500
DIALOG_IN_MAX_MS = 500
TICKET_SLIDE_MAX_MS = 500

TERMS = "Free cancellation until {} hours before start. Later cancellations keep the time charge and the deposit."
COPY_HELD = r"Held until \d\d:\d\d\. Finish checkout to keep it\."
COPY_CONFIRMED = "Booking confirmed. Confirmation email queued."
COPY_CONFIRM_503 = "Card payments are delayed while billing is unreachable. Nothing was charged."
COPY_HOLD_RAN_OUT = "Your hold ran out before payment. Nothing was charged."
COPY_OVERRUN_503 = "Overrun can't be charged while billing is unreachable. Nothing was charged."
COPY_DEAD_LINK = "This binder link is no longer valid"
COPY_BANNER_BILLING = "Card payments are delayed: billing is unreachable. Pack bookings still work."
COPY_BANNER_MAIL = "Emails are delayed and will send automatically when mail is back."
SUBJ_CONFIRM_ONE = "Booking confirmed: {} on {}"
SUBJ_CONFIRM_SERIES = "Booking confirmed: {}, {} dates from {}"
SUBJ_HOLD_EXPIRED = "Hold expired: {} on {}"
SUBJ_UNPAID = "Booking cancelled: balance unpaid for {} on {}"
SUBJ_LIABILITY = "Your liability certificate expires on {}"
SUBJ_FOOD = "Your food handler card expires on {}"
CERT_FROM, CERT_TO = "2026-01-01", "2030-12-31"
EXPIRED_FROM, EXPIRED_TO = "2025-02-01", "2026-01-31"
FONTS_AND_ICONS = ["Archivo", "Public Sans", "JetBrains Mono", "Lucide"]
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}

PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 17
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML = b"<!doctype html><html><body><script>alert(1)</script></body></html>"

HTTP_TIMEOUT_S = 30
UI_DEADLINE_S = 30
MAIL_DEADLINE_S = 30
BOOT_S = 180
POLL_S = 0.5
UI_STEP_MS = 200
MOTION_WINDOW_MS = 1000
CUTOFF_LEAD_S = 60
SHORT_BINDER_TTL_S = 20
SHORT_HOLD_TTL_S = 20
KB_ACCOUNT_ID = "accountId"
MP_TO, MP_FROM, MP_SUBJECT = "To", "From", "Subject"


def z(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def resolve(site: str, day: date, hhmm: str) -> datetime:
    hour, minute = (int(x) for x in hhmm.split(":"))
    local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo(TZ[site]), fold=0)
    return local.astimezone(timezone.utc)


def hm(moment: datetime, site: str) -> str:
    return moment.astimezone(ZoneInfo(TZ[site])).strftime("%H:%M")


def abbr(moment: datetime, site: str) -> str:
    return moment.astimezone(ZoneInfo(TZ[site])).tzname() or ""


def money(cents: int) -> str:
    return f"${cents // 100}.{cents % 100:02d}"


def hours(minutes: int) -> str:
    return str((Decimal(minutes) / Decimal(60)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def ceil_quarter(moment: datetime) -> datetime:
    bump = timedelta(minutes=1) if moment.second or moment.microsecond else timedelta(0)
    moment = moment.replace(second=0, microsecond=0) + bump
    return moment + timedelta(minutes=(-moment.minute) % 15)


def cutoff_of(site: str, start_at: datetime) -> datetime:
    local = start_at.astimezone(ZoneInfo(TZ[site]))
    return resolve(site, local.date() - timedelta(days=2), local.strftime("%H:%M"))


def minutes_into_day(start_at: datetime, site: str) -> int:
    local = start_at.astimezone(ZoneInfo(TZ[site]))
    return int((start_at - resolve(site, local.date(), "00:00")).total_seconds() // 60)


def clock_changes(site: str, after: date) -> tuple[date, date]:
    spring: date | None = None
    autumn: date | None = None
    day = after
    while spring is None or autumn is None:
        length = resolve(site, day + timedelta(days=1), "00:00") - resolve(site, day, "00:00")
        if length == timedelta(minutes=DAY_SPRING) and spring is None:
            spring = day
        if length == timedelta(minutes=DAY_AUTUMN) and autumn is None:
            autumn = day
        day += timedelta(days=1)
    return spring, autumn


_IDLE = threading.Event()


def pause(seconds: float) -> None:
    _IDLE.wait(seconds)


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds:.0f}s waiting for {what}")
        pause(POLL_S)


class Api:
    def __init__(self, base: str, email: str, password: str = SEED_PASSWORD) -> None:
        self.base = base
        self.client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        r = self.client.post("/api/session", json={"email": email, "password": password})
        assert r.status_code == 200, f"sign-in for {email}: {r.status_code} {r.text}"
        self.user = r.json()["user"]

    def get(self, path: str, params: dict | None = None) -> httpx.Response:
        return self.client.get(path, params=params)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        headers = {"Idempotency-Key": key} if key else {}
        return self.client.post(path, json={} if body is None else body, headers=headers)

    def delete(self, path: str) -> httpx.Response:
        return self.client.delete(path)


@lru_cache(maxsize=None)
def staff(base: str, email: str) -> Api:
    return Api(base, email)


@dataclass
class Renter:
    api: Api
    id: str
    email: str
    password: str
    name: str
    business: str
    phone: str


def upload(api: Api, kind: str, valid_from: str, expires_on: str, content: bytes | None,
           name: str = "document.pdf", declared: str = "application/pdf") -> httpx.Response:
    parts: dict[str, Any] = {"kind": (None, kind), "valid_from": (None, valid_from), "expires_on": (None, expires_on)}
    if content is not None:
        parts["file"] = (name, content, declared)
    return api.client.post("/api/documents", files=parts)


def new_renter(base: str, home: str = HALSTED, cert: bool = True) -> Renter:
    tag = uuid.uuid4().hex[:10]
    email = f"renter-{tag}@verifier.test"
    phone = f"+1-312-555-{random.randint(1000, 9999)}"
    name, business = f"Verifier {tag}", f"Verifier Kitchen {tag}"
    body = {"name": name, "business": business, "email": email, "phone": phone, "password": SEED_PASSWORD,
            "home_site_id": home}
    r = staff(base, MANAGER[home]).post("/api/renters", body)
    assert r.status_code == 201, r.text
    renter = Renter(Api(base, email), r.json()["renter"]["id"], email, SEED_PASSWORD, name, business, phone)
    if cert:
        assert upload(renter.api, "liability", CERT_FROM, CERT_TO, PDF).status_code == 201
    return renter


def seeded(base: str, email: str) -> Renter:
    renter_id, name, business, phone = SEEDED[email]
    return Renter(Api(base, email), renter_id, email, SEED_PASSWORD, name, business, phone)


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text}"
    body = r.json()
    assert body.get("error") == code and isinstance(body.get("message"), str), body
    return body


def server_now(api: Api) -> datetime:
    stamp = api.client.get("/api/health").headers.get("date")
    return parsedate_to_datetime(stamp).astimezone(timezone.utc) if stamp else datetime.now(timezone.utc)


def local_today(api: Api, site: str) -> date:
    return server_now(api).astimezone(ZoneInfo(TZ[site])).date()


def day_view(api: Api, site: str, day: date) -> dict:
    r = api.get(f"/api/sites/{site}/day", params={"date": day.isoformat()})
    assert r.status_code == 200, r.text
    return r.json()


def segments(view: dict, station_id: str) -> list[dict]:
    return next(s for s in view["stations"] if s["id"] == station_id)["segments"]


def pack(api: Api) -> dict:
    r = api.get("/api/me/pack")
    assert r.status_code == 200, r.text
    return r.json()


def booking(api: Api, booking_id: str) -> dict:
    r = api.get(f"/api/bookings/{booking_id}")
    assert r.status_code == 200, r.text
    return r.json()["booking"]


def audit(api: Api, booking_id: str) -> list[dict]:
    r = api.get(f"/api/bookings/{booking_id}/audit")
    assert r.status_code == 200, r.text
    return r.json()["events"]


def buy_pack(api: Api) -> dict:
    r = api.post("/api/packs", {"product": "20h"}, idempotency_key())
    assert r.status_code == 201, r.text
    return r.json()


def notice_in_force(base: str, site: str) -> dict:
    mgr = staff(base, MANAGER[site])
    now = server_now(mgr)
    versions = mgr.get(f"/api/sites/{site}/policies").json()["versions"]
    return max((v for v in versions if iso(v["effective_at"]) <= now), key=lambda v: iso(v["effective_at"]))


def free_policy_date(api: Api, site: str) -> date:
    taken = {v["effective_from"] for v in api.get(f"/api/sites/{site}/policies").json()["versions"]}
    today = local_today(api, site)
    for offset in random.sample(range(200, 361), 161):
        candidate = today + timedelta(days=offset)
        if candidate.isoformat() not in taken:
            return candidate
    raise AssertionError("no free policy date")


@dataclass
class Slot:
    site: str
    station: str
    name: str
    rate: int
    date: date
    start: str
    end: str
    start_at: datetime
    end_at: datetime

    @property
    def minutes(self) -> int:
        return int((self.end_at - self.start_at).total_seconds() // 60)


def slot_at(site: str, st: tuple[str, str, int], day: date, start: str, end: str) -> Slot:
    end_day = day + timedelta(days=1) if end <= start else day
    return Slot(site, st[0], st[1], st[2], day, start, end, resolve(site, day, start), resolve(site, end_day, end))


def hold_body(slot: Slot) -> dict:
    return {"station_id": slot.station, "start_at": z(slot.start_at), "end_at": z(slot.end_at)}


def place(api: Api, slot: Slot) -> dict:
    r = api.post("/api/holds", hold_body(slot))
    assert r.status_code == 201, r.text
    return r.json()["hold"]


def confirm(api: Api, hold_id: str, use_pack: bool = False, pay_now: bool = True) -> httpx.Response:
    return api.post(f"/api/holds/{hold_id}/confirm", {"use_pack": use_pack, "pay_now": pay_now}, idempotency_key())


def book(api: Api, slot: Slot, use_pack: bool = False, pay_now: bool = True) -> list[dict]:
    hold = place(api, slot)
    r = confirm(api, hold["id"], use_pack=use_pack, pay_now=pay_now)
    assert r.status_code == 201, r.text
    return r.json()["bookings"]


def fresh_day(base: str, offsets: tuple[int, ...] = (0,), site: str = HALSTED,
              stations: list[tuple[str, str, int]] | None = None, on: date | None = None
              ) -> tuple[date, tuple[str, str, int]]:
    viewer = staff(base, MANAGER[site])
    pool = list(stations or STATIONS[site])
    today = local_today(viewer, site)
    rng = random.Random(uuid.uuid4().int)
    for _ in range(40):
        day = on or today + timedelta(days=rng.randint(30, 300))
        views = [day_view(viewer, site, day + timedelta(days=o)) for o in offsets]
        if on is None and any(v["hours"] != DAY_NORMAL // 60 for v in views):
            continue
        free = [s for s in rng.sample(pool, len(pool)) if all(not segments(v, s[0]) for v in views)]
        if free:
            return day, free[0]
    raise AssertionError("no free station day")


def find_slot(base: str, sites: tuple[str, ...], earliest: datetime, latest: datetime, minutes: int,
              count: int = 1) -> list[Slot]:
    found: list[Slot] = []
    views: dict[tuple[str, date], dict] = {}
    start = ceil_quarter(earliest)
    while start <= latest and len(found) < count:
        end = start + timedelta(minutes=minutes)
        for site in sites:
            zone = ZoneInfo(TZ[site])
            days = {start.astimezone(zone).date(), (end - timedelta(seconds=1)).astimezone(zone).date()}
            for st in STATIONS[site]:
                if len(found) >= count:
                    break
                if any(s.station == st[0] and s.start_at < end and start < s.end_at for s in found):
                    continue
                busy = False
                for day in days:
                    if (site, day) not in views:
                        views[(site, day)] = day_view(staff(base, MANAGER[site]), site, day)
                    busy = busy or any(iso(seg["start_at"]) < end and start < iso(seg["end_at"])
                                       for seg in segments(views[(site, day)], st[0]))
                if not busy:
                    local = start.astimezone(zone)
                    found.append(Slot(site, st[0], st[1], st[2], local.date(), local.strftime("%H:%M"),
                                      end.astimezone(zone).strftime("%H:%M"), start, end))
        start += timedelta(minutes=15)
    return found


def near_slot(base: str, sites: tuple[str, ...] = (HALSTED, CORKTOWN), minutes: int = 60, lead_min: int = 2) -> Slot:
    now = server_now(staff(base, ODILE))
    slots = find_slot(base, sites, now + timedelta(minutes=lead_min), now + timedelta(minutes=28), minutes)
    assert slots, "no free station inside the check-in window"
    return slots[0]


def kb_tx(killbill: Any, key: str, kind: str) -> list[int]:
    payment = killbill.payment_by_key(key)
    if not payment:
        return []
    return [int((Decimal(str(t["amount"])) * 100).quantize(Decimal(1))) for t in payment.get("transactions", [])
            if t.get("transactionType") == kind and t.get("status") == "SUCCESS"]


def kb_payment_count(killbill: Any, renter_id: str) -> int:
    account = killbill.account_by_key(f"hs-renter-{renter_id}")
    return len(killbill.payments(account[KB_ACCOUNT_ID])) if account else 0


def mails(mail: Any, email: str, subject: str | None = None, prefix: str | None = None) -> list[dict]:
    out = []
    for message in mail.messages(0, settle=0):
        if email not in addresses(message.get(MP_TO)):
            continue
        title = message.get(MP_SUBJECT, "")
        if subject is not None and title != subject:
            continue
        if prefix is not None and not title.startswith(prefix):
            continue
        out.append(message)
    return out


def await_mail(mail: Any, email: str, subject: str, count: int, seconds: float = MAIL_DEADLINE_S) -> list[dict]:
    found = poll(lambda: (lambda xs: xs if len(xs) >= count else None)(mails(mail, email, subject)), seconds,
                 f"{count} x {subject!r} to {email}")
    assert len(found) == count, [m.get(MP_SUBJECT) for m in found]
    return found


def quiet_mail(mail: Any, email: str, prefix: str, count: int, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while True:
        got = mails(mail, email, prefix=prefix)
        assert len(got) <= count, [m.get(MP_SUBJECT) for m in got]
        if time.monotonic() > deadline:
            assert len(got) == count, [m.get(MP_SUBJECT) for m in got]
            return
        pause(POLL_S)


@pytest.fixture
def s3() -> S3:
    return S3()


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def scratch_database() -> tuple[str, str]:
    url = os.environ["DATABASE_URL"]
    name = f"hs_verify_{uuid.uuid4().hex[:12]}"
    run = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}"'],
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return urlunsplit(urlsplit(url)._replace(path=f"/{name}")), name


def drop_database(name: str) -> None:
    subprocess.run(["psql", os.environ["DATABASE_URL"], "-c", f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'],
                   capture_output=True, text=True, timeout=60)


class TenantBilling:

    def __init__(self, api_key: str, api_secret: str) -> None:
        self.api_key, self.api_secret = api_key, api_secret
        self.client = httpx.Client(
            base_url=os.environ["KILLBILL_URL"].rstrip("/"), timeout=HTTP_TIMEOUT_S,
            auth=(os.environ.get("KILLBILL_USERNAME", "admin"),
                  os.environ.get("KILLBILL_PASSWORD", "password")),
            headers={"X-Killbill-ApiKey": api_key, "X-Killbill-ApiSecret": api_secret,
                     "Accept": "application/json"})

    def account_by_key(self, external_key: str) -> dict[str, Any] | None:
        r = self.client.get("/1.0/kb/accounts", params={"externalKey": external_key})
        return r.json() if r.status_code == 200 else None

    def payments(self, account_id: str) -> list[dict[str, Any]]:
        r = self.client.get(f"/1.0/kb/accounts/{account_id}/payments")
        return r.json() if r.status_code == 200 else []

    def payment_by_key(self, external_key: str) -> dict[str, Any] | None:
        r = self.client.get("/1.0/kb/payments", params={"externalKey": external_key,
                                                         "withAttempts": "false"})
        return r.json() if r.status_code == 200 else None


def new_tenant() -> TenantBilling:
    key, secret = f"hs-verify-{uuid.uuid4().hex[:12]}", uuid.uuid4().hex
    r = httpx.post(f"{os.environ['KILLBILL_URL'].rstrip('/')}/1.0/kb/tenants",
                   json={"apiKey": key, "apiSecret": secret},
                   auth=(os.environ.get("KILLBILL_USERNAME", "admin"),
                         os.environ.get("KILLBILL_PASSWORD", "password")),
                   headers={"X-Killbill-CreatedBy": "hearthshift-verifier"},
                   timeout=HTTP_TIMEOUT_S)
    assert r.status_code in (200, 201), f"Kill Bill tenant creation: {r.status_code} {r.text}"
    return TenantBilling(key, secret)


TENANTS: dict[str, TenantBilling] = {}


def kb_for(base: str, killbill: Any) -> Any:
    return TENANTS.get(base, killbill)


@contextmanager
def app_copy(env: dict[str, str], isolated: bool = False) -> Iterator[str]:
    scratch = scratch_database() if isolated else None
    tenant = new_tenant() if isolated else None
    if scratch and tenant:
        env = {**env, "DATABASE_URL": scratch[0], "KILLBILL_API_KEY": tenant.api_key,
               "KILLBILL_API_SECRET": tenant.api_secret}
    deployed = Path(DEPLOYED_APP)
    manifest_path = deployed / "run.json" if (deployed / "run.json").exists() else Path("/app/run.json")
    serve = json.loads(manifest_path.read_text())["serve"]
    port = free_port()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=deployed, stdout=log, stderr=subprocess.STDOUT,
                            env={**os.environ, **env, "APP_PUBLIC_PORT": str(port)}, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text()[-4000:]

    def healthy() -> bool:
        if proc.poll() is not None:
            raise AssertionError(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            return httpx.get(f"{base}/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        try:
            poll(healthy, BOOT_S, "app copy health")
        except AssertionError as exc:
            raise AssertionError(f"{exc}\n{tail()}") from exc
        if tenant:
            TENANTS[base] = tenant
        yield base
    finally:
        TENANTS.pop(base, None)
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=30)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()
        if scratch:
            drop_database(scratch[1])


@pytest.fixture(scope="module")
def short_ttl_app() -> Iterator[str]:
    with app_copy({"BINDER_LINK_TTL_SECONDS": str(SHORT_BINDER_TTL_S)}, isolated=True) as base:
        yield base


@pytest.fixture(scope="module")
def short_hold_app() -> Iterator[str]:
    with app_copy({"HOLD_TTL_SECONDS": str(SHORT_HOLD_TTL_S)}, isolated=True) as base:
        yield base


@pytest.fixture(scope="module")
def billing_down_app() -> Iterator[str]:
    with app_copy({"KILLBILL_URL": "http://127.0.0.1:9"}, isolated=True) as base:
        yield base


@pytest.fixture(scope="module")
def mail_down_app() -> Iterator[str]:
    env = {"SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9", "MAILPIT_URL": "http://127.0.0.1:9"}
    with app_copy(env, isolated=True) as base:
        yield base


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = free_port()
        self.server: socket.socket | None = None
        self.live: list[socket.socket] = []
        self.lock = threading.Lock()

    def open(self) -> None:
        self.server = socket.socket()
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", self.port))
        self.server.listen(32)
        threading.Thread(target=self._accept, args=(self.server,), daemon=True).start()

    def _accept(self, server: socket.socket) -> None:
        while True:
            try:
                conn, _ = server.accept()
            except OSError:
                return
            threading.Thread(target=self._pair, args=(conn,), daemon=True).start()

    def _pair(self, conn: socket.socket) -> None:
        try:
            upstream = socket.create_connection(self.target, timeout=10)
        except OSError:
            conn.close()
            return
        upstream.settimeout(None)
        with self.lock:
            self.live.extend((conn, upstream))
        for src, dst in ((conn, upstream), (upstream, conn)):
            threading.Thread(target=self._pump, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
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
        if self.server:
            try:
                self.server.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.server.close()
            self.server = None
        with self.lock:
            live, self.live = self.live, []
        for sock in live:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()


@contextmanager
def relay_billing_copy(start_open: bool) -> Iterator[tuple[str, Relay]]:
    kb = urlsplit(os.environ["KILLBILL_URL"])
    billing = Relay(kb.hostname or "127.0.0.1", kb.port or 80)
    if start_open:
        billing.open()
    env = {"KILLBILL_URL": f"{kb.scheme}://127.0.0.1:{billing.port}{kb.path}"}
    try:
        with app_copy(env, isolated=True) as base:
            yield base, billing
    finally:
        billing.close()


def billing_state(base: str) -> str:
    return httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT_S).json()["billing"]


def origin_of(page: Page) -> str:
    parts = urlsplit(page.url)
    return f"{parts.scheme}://{parts.netloc}"


def wait_ui(page: Page, locator: Locator, contains: str | None = None, pattern: str | None = None,
            seconds: float = UI_DEADLINE_S) -> Locator:
    target = locator.first
    deadline = time.monotonic() + seconds
    while True:
        try:
            if contains is None and pattern is None:
                expect(target).to_be_visible(timeout=UI_STEP_MS)
            else:
                expect(target).to_be_attached(timeout=UI_STEP_MS)
                if contains is not None:
                    expect(target).to_contain_text(contains, timeout=UI_STEP_MS)
                if pattern is not None:
                    inline_i = pattern.startswith("(?i)")
                    regex = re.compile(pattern[4:] if inline_i else pattern, re.IGNORECASE if inline_i else 0)
                    expect(target).to_contain_text(regex, timeout=UI_STEP_MS)
            return target
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, UI_STEP_MS)


def wait_until(page: Page, check_fn: Callable[[], bool], what: str, seconds: float = UI_DEADLINE_S) -> None:
    deadline = time.monotonic() + seconds
    while not check_fn():
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        advance(page, UI_STEP_MS)
        pause(UI_STEP_MS / 1000)


def wait_text(page: Page, copy: str) -> Locator:
    return wait_ui(page, page.get_by_text(copy))


def sign_in(page: Page, email: str, password: str = SEED_PASSWORD) -> None:
    if page.get_by_role("button", name="Sign in").count() == 0:
        page.goto(f"{origin_of(page)}/")
    fill(wait_ui(page, page.get_by_role("textbox", name="Email")), email)
    fill(page.get_by_label("Password", exact=True), password)
    click(page.get_by_role("button", name="Sign in"))
    wait_ui(page, page.get_by_role("navigation", name="Main"))


def nav(page: Page, name: str) -> None:
    click(wait_ui(page, page.get_by_role("navigation", name="Main").get_by_role("link", name=name, exact=True)))
    poll(lambda: page.url.rstrip("/").endswith(f"/{name.lower()}"), UI_DEADLINE_S, f"{name} screen")


def open_board(page: Page, site: str, day: date) -> None:
    page.goto(f"{origin_of(page)}/board")
    select(wait_ui(page, page.get_by_role("combobox", name="Site")), SITE_NAMES[site])
    box = page.get_by_role("textbox", name="Day")
    fill(box, day.isoformat())
    box.press("Enter")
    expect(box).to_have_value(day.isoformat())
    wait_ui(page, page.get_by_role("group", name="Station dial"))
    wait_ui(page, page.get_by_role("slider", name=STATIONS[site][0][1], exact=True))


RING_JS = """(slider, args) => {
  const [dial, minute, dayMinutes] = args;
  const box = dial.getBoundingClientRect();
  const own = slider.getBoundingClientRect();
  const square = own.width > 40 && Math.abs(own.width - own.height) < 4;
  const cx = square ? own.left + own.width / 2 : box.left + box.width / 2;
  const cy = square ? own.top + own.height / 2 : box.top + box.height / 2;
  const outer = Math.min(box.width, box.height) / 2;
  const angle = (minute / dayMinutes) * 2 * Math.PI;
  const inside = (el) => { for (let n = el; n; n = n.parentElement) { if (n === slider) return true; } return false; };
  const hits = [];
  for (let r = outer; r > 0; r -= 1) {
    const el = document.elementFromPoint(cx + r * Math.sin(angle), cy - r * Math.cos(angle));
    if (el && inside(el)) hits.push(r);
  }
  return {cx, cy, outer, hits};
}"""


def ring(page: Page, site: str, station_name: str, minute: int = 0) -> dict[str, float]:
    dial = page.get_by_role("group", name="Station dial")
    dial.scroll_into_view_if_needed()
    slider = page.get_by_role("slider", name=station_name, exact=True)
    geo = slider.evaluate(RING_JS, [dial.element_handle(), minute, DAY_NORMAL])
    hits = geo["hits"]
    if hits:
        runs: list[list[float]] = [[hits[0]]]
        for r in hits[1:]:
            if runs[-1][-1] - r <= 1.5:
                runs[-1].append(r)
            else:
                runs.append([r])
        band = max(runs, key=len)
        radius = (band[0] + band[-1]) / 2
    else:
        names = [s[1] for s in STATIONS[site]]
        radius = geo["outer"] * (1 - (names.index(station_name) + 0.5) * 0.5 / len(names))
    return {"cx": geo["cx"], "cy": geo["cy"], "r": radius}


def sweep(page: Page, site: str, station_name: str, start_min: int, end_min: int, release: bool = True) -> None:
    geo = ring(page, site, station_name, start_min)

    def to(minute: int) -> None:
        angle = math.radians(minute / DAY_NORMAL * 360)
        page.mouse.move(geo["cx"] + geo["r"] * math.sin(angle), geo["cy"] - geo["r"] * math.cos(angle))

    to(start_min)
    page.mouse.down()
    for minute in range(start_min + 5, end_min + 1, 5):
        to(minute)
        advance(page, 16)
    if release:
        page.mouse.up()


def stamp(sample: dict[str, float]) -> float:
    return sample.get("t", sample.get("time", 0.0))


def settled_at(path: list[dict[str, float]]) -> float:
    keys = [k for k in path[-1] if k not in ("t", "time")]
    last = stamp(path[0])
    for prev, cur in zip(path, path[1:]):
        if any(abs(cur[k] - prev[k]) > 0.01 for k in keys if k in prev):
            last = stamp(cur)
    return last - stamp(path[0])


def test_day_dial_segments(browser: Browser, app_url: str) -> None:
    a, b = new_renter(app_url), new_renter(app_url, cert=False)
    day, st = fresh_day(app_url)
    bk = book(a.api, slot_at(HALSTED, st, day, "08:00", "10:00"), pay_now=False)[0]
    hold = place(b.api, slot_at(HALSTED, st, day, "12:00", "13:00"))
    view_a = day_view(a.api, HALSTED, day)
    assert (view_a["site_id"], view_a["date"], view_a["time_zone"]) == (HALSTED, day.isoformat(), TZ[HALSTED])
    assert view_a["hours"] == DAY_NORMAL // 60 and len(view_a["ticks"]) == DAY_NORMAL // 60
    assert [t["label"] for t in view_a["ticks"]] == [f"{h:02d}:00" for h in range(DAY_NORMAL // 60)]
    assert [s["id"] for s in view_a["stations"]] == [s[0] for s in STATIONS[HALSTED]]
    assert view_a["pack_minutes_available"] == pack(a.api)["available_minutes"]
    by_state = {s["state"]: s for s in segments(view_a, st[0])}
    assert set(by_state) == {"yours_booked", "held"}
    assert by_state["yours_booked"]["booking_id"] == bk["id"]
    assert iso(by_state["yours_booked"]["start_at"]) == iso(bk["start_at"])
    assert by_state["held"]["renter_business"] is None and by_state["held"]["booking_id"] is None
    view_b = {s["state"]: s for s in segments(day_view(b.api, HALSTED, day), st[0])}
    assert set(view_b) == {"booked", "yours_held"} and view_b["yours_held"]["hold_id"] == hold["id"]
    assert view_b["booked"]["booking_id"] is None and view_b["booked"]["renter_business"] is None
    staff_view = {s["state"]: s for s in segments(day_view(staff(app_url, ODILE), HALSTED, day), st[0])}
    assert set(staff_view) == {"booked", "held"}
    assert staff_view["booked"]["booking_id"] == bk["id"] and staff_view["booked"]["renter_business"] == a.business
    assert staff_view["held"]["renter_business"] == b.business
    err(a.api.get(f"/api/sites/{HALSTED}/day", params={"date": "31/12/2026"}), 422, "validation")
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        for station in STATIONS[HALSTED]:
            wait_ui(page, page.get_by_role("slider", name=station[1], exact=True))
        wait_text(page, "Your booking 08:00–10:00")
        wait_text(page, "Held 12:00–13:00")
    b.api.delete(f"/api/holds/{hold['id']}")


HOLD_CASE_IDS = ["quarter_hour", "twelve_hours", "utc_form", "staff_for_renter", "off_quarter", "over_twelve_hours",
                 "end_equals_start", "past_date", "beyond_365_days", "repeat_zero", "repeat_over_max",
                 "staff_without_renter", "staff_other_operator_renter", "other_operator_station"]


@pytest.mark.parametrize("case", HOLD_CASE_IDS, ids=HOLD_CASE_IDS)
def test_place_hold_validation(app_url: str, case: str) -> None:
    renter = new_renter(app_url, cert=False)
    day, st = fresh_day(app_url)
    viewer = staff(app_url, ODILE)
    base = {"station_id": st[0], "date": day.isoformat()}
    ok = {"quarter_hour": (renter.api, {**base, "start": "10:00", "end": "10:15"}, 15),
          "twelve_hours": (renter.api, {**base, "start": "06:00", "end": "18:00"}, MAX_OCCURRENCE_MIN),
          "utc_form": (renter.api, {"station_id": st[0], "start_at": z(resolve(HALSTED, day, "10:00")),
                                    "end_at": z(resolve(HALSTED, day, "11:00"))}, 60),
          "staff_for_renter": (staff(app_url, PRIYA), {**base, "start": "10:00", "end": "11:00",
                                                       "renter_id": renter.id}, 60)}
    if case in ok:
        api, body, minutes = ok[case]
        r = api.post("/api/holds", body)
        assert r.status_code == 201, r.text
        hold = r.json()["hold"]
        assert (hold["status"], hold["renter_id"], hold["station_id"], hold["site_id"]) == (
            "held", renter.id, st[0], HALSTED)
        (occ,) = hold["occurrences"]
        assert occ["minutes"] == minutes and occ["date"] == day.isoformat()
        assert renter.api.get(f"/api/holds/{hold['id']}").status_code == 200
        assert [s["hold_id"] for s in segments(day_view(viewer, HALSTED, day), st[0])] == [hold["id"]]
        renter.api.delete(f"/api/holds/{hold['id']}")
        return
    today = local_today(viewer, HALSTED)
    other_day = {"station_id": st[0], "start": "10:00", "end": "11:00"}
    bad = {"off_quarter": (renter.api, {**base, "start": "10:05", "end": "11:00"}, {"start"}),
           "over_twelve_hours": (renter.api, {**base, "start": "06:00", "end": "18:15"}, {"start", "end"}),
           "end_equals_start": (renter.api, {**base, "start": "10:00", "end": "10:00"}, {"start", "end"}),
           "past_date": (renter.api, {**other_day, "date": (today - timedelta(days=1)).isoformat()},
                         {"date", "start"}),
           "beyond_365_days": (renter.api, {**other_day, "date": (today + timedelta(days=DAYS_AHEAD_MAX + 1))
                                            .isoformat()}, {"date", "start"}),
           "repeat_zero": (renter.api, {**base, "start": "10:00", "end": "11:00", "repeat_weeks": 0}, {"repeat_weeks"}),
           "repeat_over_max": (renter.api, {**base, "start": "10:00", "end": "11:00", "repeat_weeks": REPEAT_MAX + 1},
                               {"repeat_weeks"}),
           "staff_without_renter": (staff(app_url, PRIYA), {**base, "start": "10:00", "end": "11:00"}, {"renter_id"})}
    refused_404 = {"staff_other_operator_renter": (staff(app_url, PRIYA),
                                                   {**base, "start": "10:00", "end": "11:00", "renter_id": "rn-fennel"}),
                   "other_operator_station": (renter.api, {"station_id": "st-fr-deck", "date": day.isoformat(),
                                                           "start": "10:00", "end": "11:00"})}
    if case in bad:
        api, body, fields = bad[case]
        got = err(api.post("/api/holds", body), 422, "validation")["fields"]
        assert set(got) & fields, got
    else:
        api, body = refused_404[case]
        err(api.post("/api/holds", body), 404, "not_found")
    assert not segments(day_view(viewer, HALSTED, day), st[0])


CONTEST_SPANS = [("10:00", "12:00"), ("11:00", "13:00"), ("10:30", "11:30"), ("09:00", "11:15"),
                 ("11:00", "11:45")]


def test_contested_slot_one_winner(app_url: str) -> None:
    renters = [new_renter(app_url, cert=False) for _ in CONTEST_SPANS]
    day, st = fresh_day(app_url)
    gate = threading.Barrier(len(renters))

    def claim(i: int) -> httpx.Response:
        start, end = CONTEST_SPANS[i]
        body = {"station_id": st[0], "date": day.isoformat(), "start": start, "end": end}
        gate.wait()
        return renters[i].api.post("/api/holds", body)

    with ThreadPoolExecutor(len(renters)) as pool:
        results = list(pool.map(claim, range(len(renters))))
    winners = [i for i, r in enumerate(results) if r.status_code == 201]
    assert len(winners) == 1, [r.text for r in results]
    hold = results[winners[0]].json()["hold"]
    (occ,) = hold["occurrences"]
    for i, r in enumerate(results):
        if i == winners[0]:
            continue
        blocker = err(r, 409, "slot_taken")["blocker"]
        assert blocker["state"] == "held" and blocker["date"] == day.isoformat()
        assert iso(blocker["start_at"]) == iso(occ["start_at"]) and iso(blocker["end_at"]) == iso(occ["end_at"])
        assert blocker["label"] == f"Held {occ['start']}–{occ['end']}"
    segs = segments(day_view(staff(app_url, ODILE), HALSTED, day), st[0])
    assert [s["hold_id"] for s in segs] == [hold["id"]]
    renters[winners[0]].api.delete(f"/api/holds/{hold['id']}")


def test_hold_expiry_edge(short_hold_app: str, killbill: Any, mail: Any) -> None:
    base = short_hold_app
    killbill = kb_for(base, killbill)
    owner, rival = seeded(base, RAFA), seeded(base, IKE)
    charges = kb_payment_count(killbill, owner.id)
    day, st = fresh_day(base)
    slot = slot_at(HALSTED, st, day, "10:00", "11:00")
    hold = place(owner.api, slot)
    expires = iso(hold["expires_at"])
    assert abs((expires - iso(hold["created_at"])).total_seconds() - SHORT_HOLD_TTL_S) <= 1
    blocker = err(rival.api.post("/api/holds", hold_body(slot)), 409, "slot_taken")["blocker"]
    assert blocker["state"] == "held"
    assert owner.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "held"
    poll(lambda: server_now(owner.api) >= expires, SHORT_HOLD_TTL_S + 30, "server clock past expires_at")
    err(confirm(owner.api, hold["id"]), 410, "hold_expired")
    taken = rival.api.post("/api/holds", hold_body(slot))
    assert taken.status_code == 201, taken.text
    rival.api.delete(f"/api/holds/{taken.json()['hold']['id']}")
    poll(lambda: owner.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "expired",
         HOLD_EXPIRY_STATUS_S + 5, "hold status expired")
    err(confirm(owner.api, hold["id"]), 410, "hold_expired")
    assert kb_payment_count(killbill, owner.id) == charges
    assert not [b for b in owner.api.get("/api/bookings").json()["bookings"] if b["hold_id"] == hold["id"]]
    subject = SUBJ_HOLD_EXPIRED.format(st[1], day.isoformat())
    await_mail(mail, owner.email, subject, 1, HOLD_EXPIRY_STATUS_S + MAIL_DEADLINE_S)
    quiet_mail(mail, owner.email, subject, 1, HOLD_EXPIRY_STATUS_S)


def test_let_hold_go(browser: Browser, app_url: str, mail: Any) -> None:
    a, rival, stranger = (new_renter(app_url, cert=False) for _ in range(3))
    day, st = fresh_day(app_url)
    first = slot_at(HALSTED, st, day, "09:00", "10:00")
    hold = place(a.api, first)
    err(stranger.api.delete(f"/api/holds/{hold['id']}"), 404, "not_found")
    assert a.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "held"
    assert a.api.delete(f"/api/holds/{hold['id']}").status_code == 204
    assert a.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "expired"
    err(a.api.delete(f"/api/holds/{hold['id']}"), 409, "invalid_transition")
    err(confirm(a.api, hold["id"]), 410, "hold_expired")
    rival.api.delete(f"/api/holds/{place(rival.api, first)['id']}")
    second = place(a.api, slot_at(HALSTED, st, day, "13:00", "14:00"))
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        click(dialog.get_by_role("button", name="Let hold go"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"), contains="Hold released.")
    assert a.api.get(f"/api/holds/{second['id']}").json()["hold"]["status"] == "expired"
    assert not [s for s in segments(day_view(a.api, HALSTED, day), st[0]) if s["state"] == "yours_held"]
    quiet_mail(mail, a.email, "Hold expired", 0, HOLD_EXPIRY_STATUS_S + 5)


def test_wf_claim_station_time_lost_claim(browser: Browser, app_url: str) -> None:
    a, rival = new_renter(app_url, cert=False), new_renter(app_url, cert=False)
    day, st = fresh_day(app_url)
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        sweep(page, HALSTED, st[1], 10 * 60, 12 * 60, release=False)
        wait_ui(page, page.get_by_role("region", name="Selection summary"), contains="2.00 h")
        blocker = place(rival.api, slot_at(HALSTED, st, day, "11:00", "12:00"))
        page.mouse.up()
        wait_ui(page, page.get_by_role("status", name="Dial status"),
                contains="Another renter just took this time. Held 11:00–12:00")
        wait_text(page, "Held 11:00–12:00")
        slider = page.get_by_role("slider", name=st[1], exact=True)
        wait_until(page, lambda: slider.get_attribute("aria-valuetext") == "No selection", "selection retracted")
    states = [s["state"] for s in segments(day_view(a.api, HALSTED, day), st[0])]
    assert states == ["held"]
    rival.api.delete(f"/api/holds/{blocker['id']}")


def test_time_states_distinguishable(browser: Browser, app_url: str) -> None:
    a, b = new_renter(app_url), new_renter(app_url)
    day, st = fresh_day(app_url)
    book(a.api, slot_at(HALSTED, st, day, "06:00", "08:00"), pay_now=False)
    mine = place(a.api, slot_at(HALSTED, st, day, "09:00", "10:00"))
    book(b.api, slot_at(HALSTED, st, day, "12:00", "14:00"), pay_now=False)
    theirs = place(b.api, slot_at(HALSTED, st, day, "16:00", "17:00"))
    want = {"yours_booked": "Your booking 06:00–08:00", "yours_held": "Your hold 09:00–10:00",
            "booked": "Booked 12:00–14:00", "held": "Held 16:00–17:00"}
    assert {s["state"]: s["label"] for s in segments(day_view(a.api, HALSTED, day), st[0])} == want
    staff_labels = sorted(s["label"] for s in segments(day_view(staff(app_url, ODILE), HALSTED, day), st[0]))
    assert staff_labels == sorted(["Booked 06:00–08:00", "Held 09:00–10:00", "Booked 12:00–14:00", "Held 16:00–17:00"])
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        for label in want.values():
            wait_text(page, label)
        legend = wait_ui(page, page.get_by_role("list", name="Dial legend"))
        items = [item.inner_text().strip() for item in legend.get_by_role("listitem").all()]
        for word in ("Free", "Held", "Booked", "Yours"):
            assert any(word in item for item in items), items
        axe(page)
    a.api.delete(f"/api/holds/{mine['id']}")
    b.api.delete(f"/api/holds/{theirs['id']}")


def test_wf_claim_station_time_sweep(browser: Browser, app_url: str) -> None:
    a = new_renter(app_url)
    day, st = fresh_day(app_url, stations=STATIONS[HALSTED][:2])
    book(a.api, slot_at(HALSTED, st, day, "13:00", "15:00"), pay_now=False)
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        wait_text(page, "Your booking 13:00–15:00")
        sweep(page, HALSTED, st[1], 10 * 60, 12 * 60, release=False)
        summary = page.get_by_role("region", name="Selection summary")
        wait_ui(page, summary, contains="2.00 h")
        wait_ui(page, summary, contains=money(2 * st[2]))
        geo = ring(page, HALSTED, st[1], 12 * 60)
        for minute in range(12 * 60, 14 * 60 + 1, 5):
            angle = math.radians(minute / DAY_NORMAL * 360)
            page.mouse.move(geo["cx"] + geo["r"] * math.sin(angle), geo["cy"] - geo["r"] * math.cos(angle))
            advance(page, 16)
        wait_ui(page, page.get_by_role("status", name="Dial status"), contains="Stopped at Your booking 13:00–15:00")
        wait_text(page, "Your booking 13:00")
        wait_ui(page, summary, contains="3.00 h")
        wait_ui(page, summary, contains=money(3 * st[2]))
        page.mouse.up()
        wait_ui(page, page.get_by_role("status", name="Dial status"), pattern=COPY_HELD)
        wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        wait_ui(page, page.get_by_role("timer", name="Hold time left"), pattern=r"\d\d:\d\d")
    mine = segments(day_view(a.api, HALSTED, day), st[0])
    want = f"Your hold {hm(resolve(HALSTED, day, '10:00'), HALSTED)}–{hm(resolve(HALSTED, day, '13:00'), HALSTED)}"
    assert want in [s["label"] for s in mine]
    held_seg = next(s for s in segments(day_view(staff(app_url, ODILE), HALSTED, day), st[0]) if s["state"] == "held")
    assert held_seg["renter_business"] == a.business
    a.api.delete(f"/api/holds/{held_seg['hold_id']}")


def test_confirm_pack_first_then_card(app_url: str, killbill: Any) -> None:
    a = new_renter(app_url)
    buy_pack(a.api)
    day, st = fresh_day(app_url, offsets=(0, 7))
    r = a.api.post("/api/holds", {"station_id": st[0], "date": day.isoformat(), "start": "06:00", "end": "18:00",
                                  "repeat_weeks": 2})
    assert r.status_code == 201, r.text
    hold = r.json()["hold"]
    card_minutes = 2 * MAX_OCCURRENCE_MIN - PACK_MINUTES
    card_cents = card_minutes * st[2] // 60
    assert hold["quote"] == {"pack_minutes_available": PACK_MINUTES, "pack_minutes": PACK_MINUTES,
                             "card_minutes": card_minutes, "card_cents": card_cents,
                             "deposit_cents": DEPOSIT[HALSTED]}
    res = confirm(a.api, hold["id"], use_pack=True, pay_now=True)
    assert res.status_code == 201, res.text
    assert res.json()["email"] == "queued"
    first, second = sorted(res.json()["bookings"], key=lambda bk: bk["start_at"])
    assert (first["pack_minutes"], first["card_minutes"], first["deposit_cents"], first["paid"]) == (
        MAX_OCCURRENCE_MIN, 0, 0, True)
    assert (second["pack_minutes"], second["card_minutes"], second["card_cents"], second["deposit_cents"]) == (
        PACK_MINUTES - MAX_OCCURRENCE_MIN, card_minutes, card_cents, DEPOSIT[HALSTED])
    assert second["paid"] is True and second["balance_due_cents"] == 0
    account = killbill.account_by_key(f"hs-renter-{a.id}")
    assert account and killbill.default_plugin(account[KB_ACCOUNT_ID]) == "__EXTERNAL_PAYMENT__"
    assert kb_tx(killbill, f"hs-booking-{second['id']}", "PURCHASE") == [card_cents]
    assert kb_tx(killbill, f"hs-deposit-{second['id']}", "PURCHASE") == [DEPOSIT[HALSTED]]
    assert killbill.payment_by_key(f"hs-booking-{first['id']}") is None
    assert killbill.payment_by_key(f"hs-deposit-{first['id']}") is None
    ledger = pack(a.api)
    assert (ledger["available_minutes"], ledger["reserved_minutes"]) == (0, PACK_MINUTES)
    for bk in (first, second):
        moves = [e for e in ledger["entries"] if e["booking_id"] == bk["id"] and e["reason"] == "reserve"]
        assert len(moves) == 2 and sum(e["minutes"] for e in moves) == 0
        assert {e["account"] for e in moves} == {"available", "reserved"}


def test_confirmation_email(app_url: str, mail: Any) -> None:
    a = new_renter(app_url)
    buy_pack(a.api)
    day, st = fresh_day(app_url, offsets=(0, 7))
    r = a.api.post("/api/holds", {"station_id": st[0], "date": day.isoformat(), "start": "06:00", "end": "18:00",
                                  "repeat_weeks": 2})
    assert r.status_code == 201, r.text
    res = confirm(a.api, r.json()["hold"]["id"], use_pack=True, pay_now=True)
    assert res.status_code == 201, res.text
    first, second = sorted(res.json()["bookings"], key=lambda bk: bk["start_at"])
    subject = SUBJ_CONFIRM_SERIES.format(st[1], 2, day.isoformat())
    (message,) = await_mail(mail, a.email, subject, 1)
    assert addresses(message.get(MP_TO)) == [a.email]
    assert addresses(message.get(MP_FROM)) == [mail_from_address()]
    body = text(message)
    for piece in (day.isoformat(), (day + timedelta(days=7)).isoformat(), "12.00", money(second["card_cents"]),
                  money(DEPOSIT[HALSTED]), TERMS.format(second["policy"]["notice_hours"]), SITE_NAMES[HALSTED],
                  abbr(iso(first["start_at"]), HALSTED)):
        assert piece in body, piece
    day2, st2 = fresh_day(app_url)
    hold = place(a.api, slot_at(HALSTED, st2, day2, "10:00", "11:00"))
    key = idempotency_key()
    path = f"/api/holds/{hold['id']}/confirm"
    once = a.api.post(path, {"use_pack": False, "pay_now": False}, key)
    assert once.status_code == 201, once.text
    again = a.api.post(path, {"use_pack": False, "pay_now": False}, key)
    assert again.status_code == 201 and again.json() == once.json()
    single = text(await_mail(mail, a.email, SUBJ_CONFIRM_ONE.format(st2[1], day2.isoformat()), 1)[0])
    for piece in (day2.isoformat(), "1.00", money(st2[2]), money(DEPOSIT[HALSTED])):
        assert piece in single, piece
    quiet_mail(mail, a.email, "Booking confirmed", 2, 5)


def test_pay_now_or_later(app_url: str, killbill: Any) -> None:
    a = new_renter(app_url)
    day, st = fresh_day(app_url)
    slot = slot_at(HALSTED, st, day, "10:00", "12:00")
    (bk,) = book(a.api, slot, pay_now=False)
    card = 2 * st[2]
    assert (bk["paid"], bk["balance_due_cents"], bk["card_cents"]) == (False, card, card)
    assert iso(bk["balance_due_by"]) == cutoff_of(HALSTED, slot.start_at)
    assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "PURCHASE") == [DEPOSIT[HALSTED]]
    assert killbill.payment_by_key(f"hs-booking-{bk['id']}") is None
    assert booking(a.api, bk["id"])["paid"] is False
    key = idempotency_key()
    paid = a.api.post(f"/api/bookings/{bk['id']}/pay", {}, key)
    assert paid.status_code == 200, paid.text
    assert paid.json()["booking"]["paid"] is True and paid.json()["booking"]["balance_due_cents"] == 0
    replay = a.api.post(f"/api/bookings/{bk['id']}/pay", {}, key)
    assert replay.status_code == 200 and replay.json() == paid.json()
    assert kb_tx(killbill, f"hs-booking-{bk['id']}", "PURCHASE") == [card]
    err(a.api.post(f"/api/bookings/{bk['id']}/pay", {}, idempotency_key()), 409, "invalid_transition")
    now = server_now(a.api)
    (soon,) = find_slot(app_url, (HALSTED,), now + timedelta(hours=3), now + timedelta(hours=30), 60)
    hold = place(a.api, soon)
    before = kb_payment_count(killbill, a.id)
    err(confirm(a.api, hold["id"], pay_now=False), 422, "pay_now_required")
    assert kb_payment_count(killbill, a.id) == before
    assert a.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "held"
    a.api.delete(f"/api/holds/{hold['id']}")


def test_confirm_all_or_nothing(app_url: str, billing_down_app: str, killbill: Any, mail: Any) -> None:
    down = billing_down_app
    copy_kb = kb_for(down, killbill)
    a = seeded(down, RAFA)
    charges = kb_payment_count(copy_kb, a.id)
    day, st = fresh_day(down)
    hold = place(a.api, slot_at(HALSTED, st, day, "09:00", "10:00"))
    err(confirm(a.api, hold["id"], pay_now=True), 503, "billing_unavailable")
    after = a.api.get(f"/api/holds/{hold['id']}").json()["hold"]
    assert after["status"] == "held" and after["expires_at"] == hold["expires_at"]
    assert all(bk["hold_id"] != hold["id"] for bk in a.api.get("/api/bookings").json()["bookings"])
    assert kb_payment_count(copy_kb, a.id) == charges
    assert pack(a.api)["entries"] == []
    quiet_mail(mail, a.email, SUBJ_CONFIRM_ONE.format(st[1], day.isoformat()), 0, 5)
    a.api.delete(f"/api/holds/{hold['id']}")

    c = new_renter(app_url)
    day2, st2 = fresh_day(app_url)
    race = place(c.api, slot_at(HALSTED, st2, day2, "09:00", "10:00"))
    gate = threading.Barrier(2)

    def go(_: int) -> httpx.Response:
        gate.wait()
        return confirm(c.api, race["id"], pay_now=True)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(go, range(2)))
    wins = [r for r in results if r.status_code == 201]
    assert len(wins) == 1, [r.text for r in results]
    err(next(r for r in results if r.status_code != 201), 409, "invalid_transition")
    (bk,) = wins[0].json()["bookings"]
    assert kb_tx(killbill, f"hs-booking-{bk['id']}", "PURCHASE") == [st2[2]]
    assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "PURCHASE") == [DEPOSIT[HALSTED]]
    assert kb_payment_count(killbill, c.id) == 2
    poll(lambda: mails(mail, c.email, SUBJ_CONFIRM_ONE.format(st2[1], day2.isoformat())), MAIL_DEADLINE_S,
         "confirmation email")


def test_certificate_gate(app_url: str, killbill: Any) -> None:
    a = new_renter(app_url, cert=False)
    day, st = fresh_day(app_url, offsets=(0, 1))
    nxt = day + timedelta(days=1)
    hold = place(a.api, slot_at(HALSTED, st, day, "22:00", "02:00"))
    assert upload(a.api, "liability", EXPIRED_FROM, EXPIRED_TO, PDF).status_code == 201
    assert err(confirm(a.api, hold["id"]), 422, "certificate_required")["dates"] == [day.isoformat(), nxt.isoformat()]
    assert upload(a.api, "liability", (day - timedelta(days=30)).isoformat(), day.isoformat(), PDF).status_code == 201
    assert err(confirm(a.api, hold["id"]), 422, "certificate_required")["dates"] == [nxt.isoformat()]
    assert upload(a.api, "food_handler", nxt.isoformat(), nxt.isoformat(), PDF).status_code == 201
    assert err(confirm(a.api, hold["id"]), 422, "certificate_required")["dates"] == [nxt.isoformat()]
    assert kb_payment_count(killbill, a.id) == 0
    assert a.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "held"
    assert upload(a.api, "liability", day.isoformat(), (nxt + timedelta(days=40)).isoformat(), PDF).status_code == 201
    assert confirm(a.api, hold["id"]).status_code == 201


def test_wf_confirm_and_pay_checkout(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    a = new_renter(app_url)
    day, st = fresh_day(app_url, offsets=(0, 7))
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        nav(page, "Pack")
        click(wait_ui(page, page.get_by_role("button", name="Buy 20-hour pack")))
        wait_ui(page, page.get_by_role("status", name="Pack status"), contains="20 hours added. 20.00 h available.")
        r = a.api.post("/api/holds", {"station_id": st[0], "date": day.isoformat(), "start": "06:00", "end": "18:00",
                                      "repeat_weeks": 2})
        assert r.status_code == 201, r.text
        open_board(page, HALSTED, day)
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        check(dialog.get_by_role("checkbox", name="Use pack hours"))
        check(dialog.get_by_role("radio", name="Pay now"))
        click(dialog.get_by_role("button", name="Confirm booking"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"), contains=COPY_CONFIRMED)
        nav(page, "Tickets")
        later = (day + timedelta(days=7)).isoformat()
        wait_ui(page, page.get_by_role("listitem").filter(has_text=later), contains="Paid")
        nav(page, "Pack")
        wait_ui(page, page.get_by_role("region", name="Hour pack"), contains="0.00 h available")
    bookings = [bk for bk in a.api.get("/api/bookings").json()["bookings"] if bk["station_id"] == st[0]]
    second = max(bookings, key=lambda bk: bk["start_at"])
    assert second["paid"] is True
    assert kb_tx(killbill, f"hs-booking-{second['id']}", "PURCHASE") == [second["card_cents"]]
    assert kb_tx(killbill, f"hs-deposit-{second['id']}", "PURCHASE") == [DEPOSIT[HALSTED]]
    assert pack(a.api)["available_minutes"] == 0
    await_mail(mail, a.email, SUBJ_CONFIRM_SERIES.format(st[1], 2, day.isoformat()), 1)


def test_wf_confirm_and_pay_billing_down(browser: Browser, billing_down_app: str, killbill: Any) -> None:
    down = billing_down_app
    killbill = kb_for(down, killbill)
    a = seeded(down, RAFA)
    charges = kb_payment_count(killbill, a.id)
    day, st = fresh_day(down)
    hold = place(a.api, slot_at(HALSTED, st, day, "11:00", "12:00"))
    with open_app(browser, f"{down}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        wait_ui(page, dialog, contains="(delayed)", seconds=BANNER_S + 15)
        check(dialog.get_by_role("radio", name="Pay now"))
        click(dialog.get_by_role("button", name="Confirm booking"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"), contains=COPY_CONFIRM_503)
    assert a.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "held"
    assert kb_payment_count(killbill, a.id) == charges
    a.api.delete(f"/api/holds/{hold['id']}")


def test_wf_confirm_and_pay_expired_hold(browser: Browser, short_hold_app: str, killbill: Any) -> None:
    base = short_hold_app
    killbill = kb_for(base, killbill)
    a = seeded(base, RAFA)
    charges = kb_payment_count(killbill, a.id)
    day, st = fresh_day(base)
    with open_app(browser, f"{base}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        hold = place(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"))
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        check(dialog.get_by_role("radio", name="Pay now"))
        poll(lambda: server_now(a.api) >= iso(hold["expires_at"]), SHORT_HOLD_TTL_S + 30,
             "server clock past expires_at")
        click(dialog.get_by_role("button", name="Confirm booking"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"), contains=COPY_HOLD_RAN_OUT)
    err(confirm(a.api, hold["id"]), 410, "hold_expired")
    assert kb_payment_count(killbill, a.id) == charges
    assert not [b for b in a.api.get("/api/bookings").json()["bookings"] if b["hold_id"] == hold["id"]]
    assert pack(a.api)["entries"] == []


def test_weekly_repeat_all_or_none(app_url: str) -> None:
    a, b, c, d = (new_renter(app_url, cert=False) for _ in range(4))
    day, st = fresh_day(app_url, offsets=(0, 7, 14))
    wk2 = day + timedelta(days=7)
    viewer = staff(app_url, ODILE)
    blocker = place(b.api, slot_at(HALSTED, st, wk2, "10:00", "11:00"))
    body = {"station_id": st[0], "date": day.isoformat(), "start": "09:00", "end": "12:00", "repeat_weeks": 3}
    refused = err(a.api.post("/api/holds", body), 409, "slot_taken")["blocker"]
    assert refused["date"] == wk2.isoformat() and refused["state"] == "held"
    assert iso(refused["start_at"]) == iso(blocker["occurrences"][0]["start_at"])
    assert not segments(day_view(viewer, HALSTED, day), st[0])
    assert not segments(day_view(viewer, HALSTED, day + timedelta(days=14)), st[0])
    span = ("13:00", "15:00")
    r = a.api.post("/api/holds", {**body, "start": span[0], "end": span[1]})
    assert r.status_code == 201, r.text
    hold = r.json()["hold"]
    assert [o["date"] for o in hold["occurrences"]] == [(day + timedelta(days=7 * k)).isoformat() for k in range(3)]
    assert all(o["start"] == span[0] and o["end"] == span[1] for o in hold["occurrences"])
    assert len({hold["expires_at"]}) == 1
    gate = threading.Barrier(2)
    jobs = [(c, {"station_id": st[0], "date": day.isoformat(), "start": "16:00", "end": "17:00", "repeat_weeks": 3}),
            (d, {"station_id": st[0], "date": wk2.isoformat(), "start": "16:00", "end": "17:00", "repeat_weeks": 2})]

    def go(job: tuple[Renter, dict]) -> httpx.Response:
        gate.wait()
        return job[0].api.post("/api/holds", job[1])

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(go, jobs))
    assert sorted(x.status_code for x in results) == [201, 409], [x.text for x in results]
    loser = next(x for x in results if x.status_code == 409)
    assert err(loser, 409, "slot_taken")["blocker"]["date"] == wk2.isoformat()
    c_won = results[0].status_code == 201
    first_week = [s for s in segments(day_view(viewer, HALSTED, day), st[0])
                  if hm(iso(s["start_at"]), HALSTED) == "16:00"]
    assert len(first_week) == (1 if c_won else 0)
    a.api.delete(f"/api/holds/{hold['id']}")
    b.api.delete(f"/api/holds/{blocker['id']}")
    winner = c if c_won else d
    winner.api.delete(f"/api/holds/{next(x for x in results if x.status_code == 201).json()['hold']['id']}")


CLOCK_CASES = [("spring", "02:30", "04:00", 30), ("spring", "01:00", "04:00", 120),
               ("autumn", "01:30", "02:00", 90)]


def test_clock_change_rule(app_url: str) -> None:
    a = new_renter(app_url, cert=False)
    spring, autumn = clock_changes(HALSTED, local_today(a.api, HALSTED) + timedelta(days=3))
    for which, start, end, minutes in CLOCK_CASES:
        day = spring if which == "spring" else autumn
        for st in STATIONS[HALSTED]:
            r = a.api.post("/api/holds", {"station_id": st[0], "date": day.isoformat(), "start": start, "end": end})
            if r.status_code == 409:
                continue
            assert r.status_code == 201, r.text
            occ = r.json()["hold"]["occurrences"][0]
            begins = iso(occ["start_at"])
            assert begins == resolve(HALSTED, day, start) and occ["minutes"] == minutes
            if start == "02:30":
                assert hm(begins, HALSTED) == "03:30"
            if which == "autumn":
                assert abbr(begins, HALSTED) == "CDT"
            a.api.delete(f"/api/holds/{r.json()['hold']['id']}")
            break
        else:
            raise AssertionError(f"no free station for {day} {start}")


def autumn_series(renter: Renter) -> tuple[dict, date, date, tuple[str, str, int]]:
    today = local_today(renter.api, HALSTED)
    autumn = clock_changes(HALSTED, today + timedelta(days=3))[1]
    first = autumn - timedelta(days=7)
    if first <= today + timedelta(days=2):
        first = autumn
    for st in STATIONS[HALSTED]:
        r = renter.api.post("/api/holds", {"station_id": st[0], "date": first.isoformat(), "start": "01:00",
                                           "end": "05:00", "repeat_weeks": 4})
        if r.status_code == 201:
            return r.json()["hold"], first, autumn, st
        assert r.status_code == 409, r.text
    raise AssertionError("no station free for the overnight series")


def cleanup(base: str, booking_ids: list[str]) -> None:
    for booking_id in booking_ids:
        staff(base, ODILE).post(f"/api/bookings/{booking_id}/override",
                                {"action": "cancel_refunded", "reason": "verifier cleanup"})


def test_overnight_invoice_minutes(app_url: str, killbill: Any, mail: Any) -> None:
    a = new_renter(app_url)
    hold, first, autumn, st = autumn_series(a)
    minutes = [o["minutes"] for o in hold["occurrences"]]
    assert minutes == [FALLBACK_SHIFT_MIN if o["date"] == autumn.isoformat() else NORMAL_SHIFT_MIN
                       for o in hold["occurrences"]]
    assert hold["quote"]["card_minutes"] == sum(minutes)
    assert hold["quote"]["card_cents"] == sum(minutes) * st[2] // 60
    res = confirm(a.api, hold["id"], pay_now=True)
    assert res.status_code == 201, res.text
    bookings = res.json()["bookings"]
    try:
        change = next(bk for bk in bookings if bk["local_start"].startswith(autumn.isoformat()))
        assert change["minutes"] == FALLBACK_SHIFT_MIN
        assert change["card_cents"] == FALLBACK_SHIFT_MIN * st[2] // 60
        assert change["local_start"] == f"{autumn.isoformat()} 01:00 CDT"
        assert change["local_end"] == f"{autumn.isoformat()} 05:00 CST"
        assert all(bk["minutes"] == NORMAL_SHIFT_MIN for bk in bookings if bk is not change)
        invoice = a.api.get(f"/api/bookings/{change['id']}/invoice").json()
        assert FALLBACK_SHIFT_MIN in [line["minutes"] for line in invoice["lines"]]
        assert sum(line["amount_cents"] for line in invoice["lines"]) == invoice["total_cents"]
        assert kb_tx(killbill, f"hs-booking-{change['id']}", "PURCHASE") == [change["card_cents"]]
        subject = SUBJ_CONFIRM_SERIES.format(st[1], 4, first.isoformat())
        body = text(await_mail(mail, a.email, subject, 1)[0])
        assert "5.00" in body and "4.00" in body
    finally:
        cleanup(app_url, [bk["id"] for bk in bookings])


def test_wf_recurring_overnight_shift_change_day_dial(browser: Browser, app_url: str) -> None:
    viewer = staff(app_url, ODILE)
    spring, autumn = clock_changes(HALSTED, local_today(viewer, HALSTED) + timedelta(days=1))
    sv, av = day_view(viewer, HALSTED, spring), day_view(viewer, HALSTED, autumn)
    assert sv["hours"] == DAY_SPRING // 60 and len(sv["ticks"]) == DAY_SPRING // 60
    assert av["hours"] == DAY_AUTUMN // 60 and len(av["ticks"]) == DAY_AUTUMN // 60
    repeated = [t for t in av["ticks"] if t["label"] == "01:00"]
    assert sorted(t["zone"] for t in repeated) == ["CDT", "CST"]
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, ODILE)
        open_board(page, HALSTED, autumn)
        wait_text(page, "CDT")
        wait_text(page, "CST")


def test_wf_recurring_overnight_shift_autumn(browser: Browser, app_url: str) -> None:
    a = new_renter(app_url)
    hold, first, autumn, st = autumn_series(a)
    bookings: list[dict] = []
    try:
        with open_app(browser, f"{app_url}/") as page:
            sign_in(page, a.email, a.password)
            open_board(page, HALSTED, first)
            click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
            dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
            check(dialog.get_by_role("radio", name="Pay now"))
            click(dialog.get_by_role("button", name="Confirm booking"))
            wait_ui(page, page.get_by_role("status", name="Checkout status"), contains=COPY_CONFIRMED)
            bookings = [bk for bk in a.api.get("/api/bookings").json()["bookings"] if bk["hold_id"] == hold["id"]]
            nav(page, "Tickets")
            for occ in hold["occurrences"]:
                wait_ui(page, page.get_by_role("listitem").filter(has_text=occ["date"]), contains=hours(occ["minutes"]))
        assert len(bookings) == 4
        assert sorted(bk["minutes"] for bk in bookings) == sorted(o["minutes"] for o in hold["occurrences"])
    finally:
        cleanup(app_url, [bk["id"] for bk in bookings])


def test_pack_purchase_idempotent(app_url: str, killbill: Any) -> None:
    a = new_renter(app_url, cert=False)
    key = idempotency_key()
    r = a.api.post("/api/packs", {"product": "20h"}, key)
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["pack"]["minutes"] == PACK_MINUTES and first["pack"]["price_cents"] == PACK_PRICE_CENTS
    assert first["available_minutes"] == PACK_MINUTES == pack(a.api)["available_minutes"]
    replay = a.api.post("/api/packs", {"product": "20h"}, key)
    assert replay.status_code == 201 and replay.json() == first
    err(a.api.post("/api/packs", {"product": "40h"}, key), 409, "idempotency_key_reused")
    assert kb_tx(killbill, f"hs-pack-{first['pack']['id']}", "PURCHASE") == [PACK_PRICE_CENTS]
    key2 = idempotency_key()
    gate = threading.Barrier(2)

    def go(_: int) -> httpx.Response:
        gate.wait()
        return a.api.post("/api/packs", {"product": "20h"}, key2)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(go, range(2)))
    oks = [x for x in results if x.status_code == 201]
    assert oks and all(x.status_code == 201 or x.json().get("error") == "request_in_progress" for x in results)
    assert len({x.json()["pack"]["id"] for x in oks}) == 1
    assert kb_tx(killbill, f"hs-pack-{oks[0].json()['pack']['id']}", "PURCHASE") == [PACK_PRICE_CENTS]
    before = kb_payment_count(killbill, a.id)
    err(a.api.post("/api/packs", {"product": "30h"}, idempotency_key()), 422, "validation")
    assert kb_payment_count(killbill, a.id) == before == 2
    assert pack(a.api)["available_minutes"] == 2 * PACK_MINUTES


def test_pack_ledger_pairs(app_url: str) -> None:
    a = new_renter(app_url)
    buy_pack(a.api)
    day, st = fresh_day(app_url)
    far = book(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"), use_pack=True, pay_now=False)[0]
    r = a.api.post(f"/api/bookings/{far['id']}/cancel", {}, idempotency_key())
    assert r.status_code == 200 and r.json()["refund"]["tier"] == "full"
    lost = book(a.api, near_slot(app_url), use_pack=True)[0]
    r = a.api.post(f"/api/bookings/{lost['id']}/cancel", {}, idempotency_key())
    assert r.status_code == 200 and r.json()["refund"]["tier"] == "none"
    used_slot = near_slot(app_url)
    used = book(a.api, used_slot, use_pack=True)[0]
    desk = staff(app_url, DESK[used_slot.site])
    assert desk.post(f"/api/bookings/{used['id']}/check-in").status_code == 200
    assert desk.post(f"/api/bookings/{used['id']}/check-out").status_code == 200
    ledger = pack(a.api)
    moves: dict[str, list[dict]] = {}
    for entry in ledger["entries"]:
        moves.setdefault(entry["movement_id"], []).append(entry)
    to_account = {"purchase": "available", "reserve": "reserved", "release": "available", "use": "used",
                  "forfeit": "used"}
    accounts = {"purchase": {"purchased", "available"}, "reserve": {"available", "reserved"},
                "release": {"reserved", "available"}, "use": {"reserved", "used"}, "forfeit": {"reserved", "used"}}
    reasons = []
    for pair in moves.values():
        assert len(pair) == 2 and sum(e["minutes"] for e in pair) == 0, pair
        reason = pair[0]["reason"]
        assert pair[1]["reason"] == reason and {e["account"] for e in pair} == accounts[reason]
        assert next(e for e in pair if e["account"] == to_account[reason])["minutes"] > 0
        reasons.append(reason)
    assert sorted(reasons) == sorted(["purchase", "reserve", "reserve", "reserve", "release", "forfeit", "use"])
    sums = {k: sum(e["minutes"] for e in ledger["entries"] if e["account"] == k) for k in ("available", "reserved", "used")}
    assert (ledger["available_minutes"], ledger["reserved_minutes"], ledger["used_minutes"]) == (
        sums["available"], sums["reserved"], sums["used"])
    assert ledger["available_minutes"] == PACK_MINUTES - lost["minutes"] - used["minutes"]
    assert ledger["used_minutes"] == lost["minutes"] + used["minutes"] and ledger["reserved_minutes"] == 0
    stamps = [iso(e["created_at"]) for e in ledger["entries"]]
    assert stamps == sorted(stamps, reverse=True)


def test_wf_hour_packs_buy(browser: Browser, app_url: str, killbill: Any) -> None:
    a = new_renter(app_url)
    day, st = fresh_day(app_url)
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        nav(page, "Pack")
        region = page.get_by_role("region", name="Hour pack")
        for copy in ("0.00 h available", "0.00 h reserved", "0.00 h used"):
            wait_ui(page, region, contains=copy)
        button = wait_ui(page, page.get_by_role("button", name="Buy 20-hour pack"), contains=money(PACK_PRICE_CENTS))
        with held(page, "**/api/packs") as gate:
            click(button)
            wait_ui(page, page.get_by_role("status", name="Pack status"), contains="Buying pack…")
            gate.release()
        wait_ui(page, page.get_by_role("status", name="Pack status"), contains="20 hours added. 20.00 h available.")
        wait_ui(page, region, contains="20.00 h available")
        wait_ui(page, page.get_by_role("table", name="Pack ledger"), pattern=r"(?i)purchase")
        place(a.api, slot_at(HALSTED, st, day, "10:00", "12:00"))
        open_board(page, HALSTED, day)
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        wait_ui(page, dialog, contains="Use pack hours (20.00 h available)")
        check(dialog.get_by_role("checkbox", name="Use pack hours"))
        click(dialog.get_by_role("button", name="Confirm booking"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"), contains=COPY_CONFIRMED)
        nav(page, "Pack")
        wait_ui(page, region, contains="18.00 h available")
        wait_ui(page, region, contains="2.00 h reserved")
    ledger = pack(a.api)
    assert (ledger["available_minutes"], ledger["reserved_minutes"]) == (PACK_MINUTES - 120, 120)
    purchase = next(e for e in ledger["entries"] if e["reason"] == "purchase")
    assert kb_tx(killbill, f"hs-pack-{purchase['pack_id']}", "PURCHASE") == [PACK_PRICE_CENTS]


def test_wf_hour_packs_billing_down(browser: Browser, billing_down_app: str, killbill: Any) -> None:
    down = billing_down_app
    killbill = kb_for(down, killbill)
    a = seeded(down, JUNE)
    charges = kb_payment_count(killbill, a.id)
    with open_app(browser, f"{down}/") as page:
        sign_in(page, a.email, a.password)
        nav(page, "Pack")
        button = page.get_by_role("button", name="Buy 20-hour pack", exact=True)
        wait_ui(page, button, contains="(delayed)", seconds=BANNER_S + 15)
        click(button)
        wait_ui(page, page.get_by_role("status", name="Pack status"), contains=COPY_CONFIRM_503)
        wait_ui(page, page.get_by_role("region", name="Hour pack"), contains="0.00 h available")
    assert pack(a.api)["entries"] == [] and kb_payment_count(killbill, a.id) == charges


def test_wf_hour_packs_recover(browser: Browser, killbill: Any) -> None:
    with relay_billing_copy(start_open=False) as (base, billing):
        killbill = kb_for(base, killbill)
        poll(lambda: billing_state(base) == "delayed", BANNER_S + 15, "billing delayed")
        a = seeded(base, IKE)
        charges = kb_payment_count(killbill, a.id)
        with open_app(browser, f"{base}/") as page:
            sign_in(page, a.email, a.password)
            nav(page, "Pack")
            button = page.get_by_role("button", name="Buy 20-hour pack", exact=True)
            status = page.get_by_role("status", name="Pack status")
            region = page.get_by_role("region", name="Hour pack")
            click(wait_ui(page, button))
            wait_ui(page, status, contains=COPY_CONFIRM_503)
            assert pack(a.api)["entries"] == []
            assert kb_payment_count(killbill, a.id) == charges
            billing.open()
            poll(lambda: billing_state(base) == "ok", RECOVERY_S + 5, "billing ok after recovery")
            click(button)
            wait_ui(page, status, contains="20 hours added. 20.00 h available.")
            wait_ui(page, region, contains="20.00 h available")
        ledger = pack(a.api)
        assert ledger["available_minutes"] == PACK_MINUTES
        purchase = next(e for e in ledger["entries"] if e["reason"] == "purchase")
        assert kb_tx(killbill, f"hs-pack-{purchase['pack_id']}", "PURCHASE") == [PACK_PRICE_CENTS]


def test_check_in_out_moves_pack(app_url: str) -> None:
    a = new_renter(app_url)
    buy_pack(a.api)
    now = server_now(a.api)
    (later,) = find_slot(app_url, (HALSTED,), now + timedelta(minutes=45), now + timedelta(hours=6), 15)
    early = book(a.api, later, use_pack=True)[0]
    err(staff(app_url, PRIYA).post(f"/api/bookings/{early['id']}/check-in"), 409, "outside_check_in_window")
    assert booking(a.api, early["id"])["status"] == "confirmed"
    slot = near_slot(app_url, sites=(HALSTED,))
    bk = book(a.api, slot, use_pack=True)[0]
    err(a.api.post(f"/api/bookings/{bk['id']}/check-in"), 403, "forbidden")
    err(staff(app_url, MARCUS).post(f"/api/bookings/{bk['id']}/check-in"), 404, "not_found")
    before = pack(a.api)
    r = staff(app_url, PRIYA).post(f"/api/bookings/{bk['id']}/check-in")
    assert r.status_code == 200 and r.json()["booking"]["status"] == "checked_in"
    assert r.json()["booking"]["checked_in_at"]
    r = staff(app_url, PRIYA).post(f"/api/bookings/{bk['id']}/check-out")
    assert r.status_code == 200 and r.json()["booking"]["status"] == "checked_out"
    after = pack(a.api)
    assert after["reserved_minutes"] == before["reserved_minutes"] - bk["minutes"]
    assert after["used_minutes"] == before["used_minutes"] + bk["minutes"]
    use = [e for e in after["entries"] if e["booking_id"] == bk["id"] and e["reason"] == "use"]
    assert len(use) == 2


def test_overrun_charged_once(app_url: str, killbill: Any) -> None:
    a = new_renter(app_url)
    slot = near_slot(app_url)
    bk = book(a.api, slot)[0]
    desk = staff(app_url, DESK[slot.site])
    assert desk.post(f"/api/bookings/{bk['id']}/check-in").status_code == 200
    for bad in (0, OVERRUN_MAX + 1):
        r = desk.post(f"/api/bookings/{bk['id']}/overrun", {"minutes": bad}, idempotency_key())
        assert "minutes" in err(r, 422, "validation")["fields"]
    key = idempotency_key()
    gate = threading.Barrier(2)

    def press(_: int) -> httpx.Response:
        gate.wait()
        return desk.post(f"/api/bookings/{bk['id']}/overrun", {"minutes": OVERRUN_MINUTES}, key)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(press, range(2)))
    oks = [r for r in results if r.status_code == 201]
    assert oks and all(r.status_code == 201 or r.json().get("error") == "request_in_progress" for r in results)
    charged = oks[0].json()["booking"]
    price = half_up(OVERRUN_MINUTES * slot.rate, 60)
    assert (charged["status"], charged["overrun_minutes"], charged["overrun_cents"]) == (
        "overrun_billed", OVERRUN_MINUTES, price)
    replay = desk.post(f"/api/bookings/{bk['id']}/overrun", {"minutes": OVERRUN_MINUTES}, key)
    assert replay.status_code == 201 and replay.json() == oks[0].json()
    err(desk.post(f"/api/bookings/{bk['id']}/overrun", {"minutes": OVERRUN_MINUTES + 1}, key), 409,
        "idempotency_key_reused")
    err(desk.post(f"/api/bookings/{bk['id']}/overrun", {"minutes": OVERRUN_MINUTES}, idempotency_key()), 409,
        "invalid_transition")
    assert kb_tx(killbill, f"hs-overrun-{bk['id']}", "PURCHASE") == [price]


def test_cleaning_fee_and_settle(app_url: str, killbill: Any) -> None:
    a = new_renter(app_url)
    slot = near_slot(app_url)
    bk = book(a.api, slot)[0]
    desk = staff(app_url, DESK[slot.site])
    assert desk.post(f"/api/bookings/{bk['id']}/check-in").status_code == 200
    err(desk.post(f"/api/bookings/{bk['id']}/cleaning-fee", {}, idempotency_key()), 409, "invalid_transition")
    err(desk.post(f"/api/bookings/{bk['id']}/settle"), 409, "invalid_transition")
    assert desk.post(f"/api/bookings/{bk['id']}/check-out").status_code == 200
    r = desk.post(f"/api/bookings/{bk['id']}/cleaning-fee", {}, idempotency_key())
    assert r.status_code == 201 and r.json()["booking"]["cleaning_fee_cents"] == CLEANING[slot.site]
    assert r.json()["booking"]["status"] == "checked_out"
    err(desk.post(f"/api/bookings/{bk['id']}/cleaning-fee", {}, idempotency_key()), 409, "cleaning_fee_already_charged")
    assert kb_tx(killbill, f"hs-cleaning-{bk['id']}", "PURCHASE") == [CLEANING[slot.site]]
    r = desk.post(f"/api/bookings/{bk['id']}/settle")
    assert r.status_code == 200 and r.json()["booking"]["status"] == "settled"
    err(desk.post(f"/api/bookings/{bk['id']}/settle"), 409, "invalid_transition")
    assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "REFUND") == [DEPOSIT[slot.site]]
    assert kb_tx(killbill, f"hs-booking-{bk['id']}", "REFUND") == []


def test_booking_state_guard(app_url: str) -> None:
    a = new_renter(app_url)
    slot = near_slot(app_url)
    bk = book(a.api, slot)[0]
    desk_email = DESK[slot.site]
    desk = staff(app_url, desk_email)
    before = audit(a.api, bk["id"])
    for path, key in (("check-out", None), ("settle", None), ("cleaning-fee", idempotency_key()),
                      ("overrun", idempotency_key())):
        body = {"minutes": OVERRUN_MINUTES} if path == "overrun" else {}
        refused = err(desk.post(f"/api/bookings/{bk['id']}/{path}", body, key), 409, "invalid_transition")
        assert refused["from"] == "confirmed" and isinstance(refused["action"], str)
    err(a.api.post(f"/api/bookings/{bk['id']}/pay", {}, idempotency_key()), 409, "invalid_transition")
    assert audit(a.api, bk["id"]) == before
    assert desk.post(f"/api/bookings/{bk['id']}/check-in").status_code == 200
    assert err(desk.post(f"/api/bookings/{bk['id']}/check-in"), 409, "invalid_transition")["from"] == "checked_in"
    assert err(a.api.post(f"/api/bookings/{bk['id']}/cancel", {}, idempotency_key()), 409,
               "invalid_transition")["from"] == "checked_in"
    events = audit(a.api, bk["id"])
    confirmed = [e for e in events if e["to"] == "confirmed" and e["from"] != "confirmed"]
    checked = [e for e in events if e["to"] == "checked_in"]
    assert len(confirmed) == 1 and confirmed[0]["actor_name"] == a.name and confirmed[0]["actor_role"] == "renter"
    desk_name = {PRIYA: "Priya Lindqvist", MARCUS: "Marcus Feld"}[desk_email]
    assert len(checked) == 1 and checked[0]["actor_name"] == desk_name and checked[0]["actor_role"] == "front_desk"


def test_wf_counter_day_run(browser: Browser, app_url: str, killbill: Any) -> None:
    renter = new_renter(app_url)
    slot = near_slot(app_url, sites=(HALSTED,), minutes=30, lead_min=12)
    price = half_up(OVERRUN_MINUTES * slot.rate, 60)
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, PRIYA)
        open_board(page, HALSTED, slot.date)
        select(page.get_by_role("combobox", name="Renter"), renter.business)
        start = minutes_into_day(slot.start_at, HALSTED)
        sweep(page, HALSTED, slot.name, start, start + slot.minutes)
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        check(dialog.get_by_role("radio", name="Pay now"))
        click(dialog.get_by_role("button", name="Confirm booking"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"), contains=COPY_CONFIRMED)
        nav(page, "Counter")
        row = wait_ui(page, page.get_by_role("table", name="Today's bookings").get_by_role("row")
                      .filter(has_text=renter.business))
        status = page.get_by_role("status", name="Counter status")
        click(row.get_by_role("button", name="Check in"))
        wait_ui(page, status, contains=f"Checked in: {renter.business}.")
        click(wait_ui(page, row.get_by_role("button", name="Charge overrun")))
        overrun = wait_ui(page, page.get_by_role("dialog", name="Charge overrun"))
        fill(overrun.get_by_role("spinbutton", name="Overrun minutes"), str(OVERRUN_MINUTES))
        wait_ui(page, overrun, contains=money(price))
        charge = overrun.get_by_role("button", name="Charge", exact=True)
        desk = staff(app_url, PRIYA)
        (walk_up,) = [b for b in desk.get("/api/bookings", params={"site_id": HALSTED}).json()["bookings"]
                      if b["renter_id"] == renter.id]
        with held(page, "**/overrun") as gate:
            charge.click()
            if charge.count() and charge.is_enabled():
                charge.click()
            gate.release()
        poll(lambda: booking(desk, walk_up["id"])["status"] == "overrun_billed", UI_DEADLINE_S, "overrun billed")
        assert kb_tx(killbill, f"hs-overrun-{walk_up['id']}", "PURCHASE") == [price]
        page.goto(f"{app_url}/counter")
        row = wait_ui(page, page.get_by_role("table", name="Today's bookings").get_by_role("row")
                      .filter(has_text=renter.business))
        click(wait_ui(page, row.get_by_role("button", name="Check out")))
        wait_ui(page, status, contains=f"Checked out: {renter.business}.")
        click(wait_ui(page, row.get_by_role("button", name="Add cleaning fee")))
        wait_ui(page, status, contains=f"Cleaning fee charged: {money(CLEANING[HALSTED])}.")
        click(wait_ui(page, row.get_by_role("button", name="Settle")))
        wait_ui(page, status, contains=f"Settled. Deposit refunded: {money(DEPOSIT[HALSTED])}.")
    (bk,) = [b for b in staff(app_url, PRIYA).get("/api/bookings", params={"site_id": HALSTED}).json()["bookings"]
             if b["renter_id"] == renter.id]
    assert bk["status"] == "settled"
    assert kb_tx(killbill, f"hs-overrun-{bk['id']}", "PURCHASE") == [price]
    assert kb_tx(killbill, f"hs-cleaning-{bk['id']}", "PURCHASE") == [CLEANING[HALSTED]]
    assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "REFUND") == [DEPOSIT[HALSTED]]


def test_wf_counter_day_billing_down(browser: Browser, billing_down_app: str, killbill: Any) -> None:
    down = billing_down_app
    killbill = kb_for(down, killbill)
    renter = seeded(down, TAMSIN)
    charges = kb_payment_count(killbill, renter.id)
    slot = near_slot(down, sites=(HALSTED,))
    bk = book(renter.api, slot, use_pack=True)[0]
    assert bk["card_minutes"] == 0
    with open_app(browser, f"{down}/") as page:
        sign_in(page, PRIYA)
        nav(page, "Counter")
        row = wait_ui(page, page.get_by_role("table", name="Today's bookings").get_by_role("row")
                      .filter(has_text=renter.business).filter(has_text=slot.start))
        click(row.get_by_role("button", name="Check in"))
        status = page.get_by_role("status", name="Counter status")
        wait_ui(page, status, contains=f"Checked in: {renter.business}.")
        button = wait_ui(page, row.get_by_role("button", name="Charge overrun"), contains="(delayed)",
                         seconds=BANNER_S + 15)
        click(button)
        overrun = wait_ui(page, page.get_by_role("dialog", name="Charge overrun"))
        fill(overrun.get_by_role("spinbutton", name="Overrun minutes"), str(OVERRUN_MINUTES))
        click(overrun.get_by_role("button", name="Charge", exact=True))
        wait_ui(page, status, contains=COPY_OVERRUN_503)
    assert booking(renter.api, bk["id"])["status"] == "checked_in"
    assert kb_payment_count(killbill, renter.id) == charges


def test_schedule_policy(app_url: str) -> None:
    odile = staff(app_url, ODILE)
    site = CORKTOWN
    today = local_today(odile, site)
    path = f"/api/sites/{site}/policies"
    notice = 36
    yesterday = (today - timedelta(days=1)).isoformat()
    assert "effective_from" in err(odile.post(path, {"notice_hours": notice, "effective_from": yesterday}), 422,
                                   "validation")["fields"]
    day = free_policy_date(odile, site)
    for bad in (0, MAX_NOTICE + 1):
        assert "notice_hours" in err(odile.post(path, {"notice_hours": bad, "effective_from": day.isoformat()}), 422,
                                     "validation")["fields"]
    err(staff(app_url, MARCUS).post(path, {"notice_hours": notice, "effective_from": day.isoformat()}), 403, "forbidden")
    err(staff(app_url, WEN).post(path, {"notice_hours": notice, "effective_from": day.isoformat()}), 404, "not_found")
    r = odile.post(path, {"notice_hours": notice, "effective_from": day.isoformat()})
    assert r.status_code == 201, r.text
    version = r.json()["version"]
    assert (version["notice_hours"], version["effective_from"]) == (notice, day.isoformat())
    assert version["created_by_name"] == "Odile Marchetti"
    assert iso(version["effective_at"]) == resolve(site, day, "00:00")
    assert version["id"] in [v["id"] for v in odile.get(path).json()["versions"]]
    err(odile.post(path, {"notice_hours": 0, "effective_from": day.isoformat()}), 409, "policy_date_taken")


def test_refund_terms_fixed_at_booking(app_url: str, killbill: Any, mail: Any) -> None:
    chosen = None
    for site in (FREMONT, CORKTOWN, HALSTED):
        mgr = staff(app_url, MANAGER[site])
        today = local_today(mgr, site)
        if all(v["effective_from"] != today.isoformat()
               for v in mgr.get(f"/api/sites/{site}/policies").json()["versions"]):
            chosen = site
            break
    assert chosen, "every site already has a policy version starting today"
    site, mgr = chosen, staff(app_url, MANAGER[chosen])
    today = local_today(mgr, site)
    old = notice_in_force(app_url, site)
    n_old = old["notice_hours"]
    n_new = n_old + 48 if n_old <= 120 else n_old - 48
    renter = new_renter(app_url, home=site)
    now = server_now(mgr)
    mid = now + timedelta(hours=(n_old + n_new) / 2)
    slots = find_slot(app_url, (site,), mid, mid + timedelta(hours=3), 60, count=2)
    assert len(slots) == 2
    first = book(renter.api, slots[0])[0]
    r = mgr.post(f"/api/sites/{site}/policies", {"notice_hours": n_new, "effective_from": today.isoformat()})
    assert r.status_code == 201, r.text
    newer = r.json()["version"]
    second = book(renter.api, slots[1])[0]
    assert first["policy"]["version_id"] == old["id"] and first["policy"]["notice_hours"] == n_old
    assert second["policy"]["version_id"] == newer["id"] and second["policy"]["notice_hours"] == n_new
    for bk, notice in ((first, n_old), (second, n_new)):
        terms = TERMS.format(notice)
        assert bk["terms"] == terms
        assert renter.api.get(f"/api/bookings/{bk['id']}/invoice").json()["terms"] == terms
    if first["station_name"] != second["station_name"]:
        for bk, other in ((first, n_new), (second, n_old)):
            subject = SUBJ_CONFIRM_ONE.format(bk["station_name"], bk["local_start"][:10])
            body = text(await_mail(mail, renter.email, subject, 1)[0])
            assert bk["terms"] in body and TERMS.format(other) not in body
    for bk in (first, second):
        res = renter.api.post(f"/api/bookings/{bk['id']}/cancel", {}, idempotency_key())
        assert res.status_code == 200, res.text
        refund = res.json()["refund"]
        if bk["policy"]["notice_hours"] < (n_old + n_new) / 2:
            assert refund["tier"] == "full" and res.json()["booking"]["status"] == "cancelled_refunded"
            assert refund["card_refund_cents"] == bk["card_cents"] and refund["deposit_refund_cents"] == DEPOSIT[site]
            assert kb_tx(killbill, f"hs-booking-{bk['id']}", "REFUND") == [bk["card_cents"]]
            assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "REFUND") == [DEPOSIT[site]]
        else:
            assert refund["tier"] == "none" and res.json()["booking"]["status"] == "cancelled_forfeit"
            assert kb_tx(killbill, f"hs-booking-{bk['id']}", "REFUND") == []
            assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "REFUND") == []
        assert booking(renter.api, bk["id"])["terms"] == bk["terms"]


def test_cancel_replay_safe(app_url: str, killbill: Any) -> None:
    a = new_renter(app_url)
    buy_pack(a.api)
    day, st = fresh_day(app_url, offsets=(0, 7))
    r = a.api.post("/api/holds", {"station_id": st[0], "date": day.isoformat(), "start": "06:00", "end": "18:00",
                                  "repeat_weeks": 2})
    assert r.status_code == 201, r.text
    res = confirm(a.api, r.json()["hold"]["id"], use_pack=True)
    assert res.status_code == 201, res.text
    mixed = max(res.json()["bookings"], key=lambda bk: bk["start_at"])
    key = idempotency_key()
    first = a.api.post(f"/api/bookings/{mixed['id']}/cancel", {}, key)
    assert first.status_code == 200, first.text
    refund = first.json()["refund"]
    assert refund == {"tier": "full", "pack_minutes_returned": mixed["pack_minutes"],
                      "card_refund_cents": mixed["card_cents"], "deposit_refund_cents": DEPOSIT[HALSTED]}
    again = a.api.post(f"/api/bookings/{mixed['id']}/cancel", {}, key)
    assert again.status_code == 200 and again.json() == first.json()
    err(a.api.post(f"/api/bookings/{mixed['id']}/cancel", {"note": "again"}, key), 409,
        "idempotency_key_reused")
    err(a.api.post(f"/api/bookings/{mixed['id']}/cancel", {}, idempotency_key()), 409, "invalid_transition")
    assert kb_tx(killbill, f"hs-booking-{mixed['id']}", "REFUND") == [mixed["card_cents"]]
    assert kb_tx(killbill, f"hs-deposit-{mixed['id']}", "REFUND") == [DEPOSIT[HALSTED]]
    releases = [e for e in pack(a.api)["entries"] if e["booking_id"] == mixed["id"] and e["reason"] == "release"]
    assert len(releases) == 2


def rail_ticket(page: Page, day: date) -> Locator:
    return page.get_by_role("list", name="Booking tickets").get_by_role("listitem").filter(has_text=day.isoformat())


def open_ticket(page: Page, site: str, day: date) -> Locator:
    open_board(page, site, day)
    click(wait_ui(page, rail_ticket(page, day)))
    return wait_ui(page, page.get_by_role("dialog", name="Booking details"))


def test_wf_cancellation_policy_cancel_ticket(browser: Browser, app_url: str, killbill: Any) -> None:
    a = new_renter(app_url)
    day, st = fresh_day(app_url)
    bk = book(a.api, slot_at(HALSTED, st, day, "10:00", "12:00"))[0]
    terms = TERMS.format(bk["policy"]["notice_hours"])
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        details = open_ticket(page, HALSTED, day)
        wait_ui(page, details, contains=terms)
        click(details.get_by_role("button", name="Cancel booking"))
        alert = wait_ui(page, page.get_by_role("alertdialog", name="Cancel booking"), contains="You'll get a full refund.")
        wait_ui(page, alert, contains=terms)
        click(alert.get_by_role("button", name="Keep booking"))
        assert booking(a.api, bk["id"])["status"] == "confirmed"
        details = details if details.is_visible() else open_ticket(page, HALSTED, day)
        click(details.get_by_role("button", name="Cancel booking"))
        alert = wait_ui(page, page.get_by_role("alertdialog", name="Cancel booking"))
        click(alert.get_by_role("button", name="Yes, cancel"))
        wait_ui(page, page.get_by_role("status", name="Dial status"),
                contains=f"Cancelled. Refunded {money(bk['card_cents'])} to card, 0.00 h to your pack and the "
                         f"{money(DEPOSIT[HALSTED])} deposit.")
        page.keyboard.press("Escape")
        wait_ui(page, rail_ticket(page, day), contains="Cancelled — refunded")
    assert booking(a.api, bk["id"])["status"] == "cancelled_refunded"
    assert kb_tx(killbill, f"hs-booking-{bk['id']}", "REFUND") == [bk["card_cents"]]
    assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "REFUND") == [DEPOSIT[HALSTED]]


def test_wf_cancellation_policy_forfeit(browser: Browser, app_url: str, killbill: Any) -> None:
    a = new_renter(app_url)
    buy_pack(a.api)
    notice = notice_in_force(app_url, HALSTED)["notice_hours"]
    now = server_now(a.api)
    latest = now + max(timedelta(minutes=60), timedelta(hours=notice) - timedelta(minutes=30))
    (slot,) = find_slot(app_url, (HALSTED,), now + timedelta(minutes=45), latest, 60)
    bk = book(a.api, slot, use_pack=True)[0]
    assert bk["pack_minutes"] == slot.minutes and bk["card_minutes"] == 0
    n = bk["policy"]["notice_hours"]
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        details = open_ticket(page, HALSTED, slot.date)
        click(details.get_by_role("button", name="Cancel booking"))
        alert = wait_ui(page, page.get_by_role("alertdialog", name="Cancel booking"),
                        contains=f"You're inside the {n}-hour notice. Nothing will be refunded.")
        click(alert.get_by_role("button", name="Yes, cancel"))
        wait_ui(page, page.get_by_role("status", name="Dial status"),
                contains=f"Cancelled under your booking's {n}-hour terms. Nothing was refunded.")
        page.keyboard.press("Escape")
        wait_ui(page, rail_ticket(page, slot.date).filter(has_text=slot.start), contains="Cancelled — forfeited")
    assert booking(a.api, bk["id"])["status"] == "cancelled_forfeit"
    assert kb_tx(killbill, f"hs-booking-{bk['id']}", "REFUND") == []
    assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "REFUND") == []
    ledger = pack(a.api)
    forfeit = [e for e in ledger["entries"] if e["booking_id"] == bk["id"] and e["reason"] == "forfeit"]
    assert len(forfeit) == 2 and sum(e["minutes"] for e in forfeit) == 0
    assert {e["account"]: e["minutes"] for e in forfeit} == {"reserved": -bk["pack_minutes"],
                                                             "used": bk["pack_minutes"]}
    assert not [e for e in ledger["entries"] if e["booking_id"] == bk["id"] and e["reason"] == "release"]
    assert (ledger["reserved_minutes"], ledger["used_minutes"]) == (0, bk["pack_minutes"])


def test_booking_terms_every_surface(browser: Browser, app_url: str, mail: Any) -> None:
    odile = staff(app_url, ODILE)
    in_force = notice_in_force(app_url, HALSTED)["notice_hours"]
    later = in_force + 48 if in_force <= 120 else in_force - 48
    scheduled = odile.post(f"/api/sites/{HALSTED}/policies",
                           {"notice_hours": later, "effective_from": free_policy_date(odile, HALSTED).isoformat()})
    assert scheduled.status_code == 201, scheduled.text
    a = new_renter(app_url)
    day, st = fresh_day(app_url)
    bk = book(a.api, slot_at(HALSTED, st, day, "10:00", "12:00"), pay_now=False)[0]
    own, other = TERMS.format(in_force), TERMS.format(later)
    assert bk["policy"]["notice_hours"] == in_force and bk["terms"] == own
    assert booking(a.api, bk["id"])["terms"] == own
    assert a.api.get(f"/api/bookings/{bk['id']}/invoice").json()["terms"] == own
    body = text(await_mail(mail, a.email, SUBJ_CONFIRM_ONE.format(st[1], day.isoformat()), 1)[0])
    assert own in body and other not in body
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        details = open_ticket(page, HALSTED, day)
        wait_ui(page, details, contains=own)
        assert other not in details.inner_text()
        click(details.get_by_role("button", name="Cancel booking"))
        alert = wait_ui(page, page.get_by_role("alertdialog", name="Cancel booking"), contains=own)
        assert other not in alert.inner_text()
        click(alert.get_by_role("button", name="Keep booking"))
    assert booking(a.api, bk["id"])["status"] == "confirmed"


def cutoff_slots(base: str, count: int) -> list[Slot]:
    now = server_now(staff(base, ODILE))
    start = ceil_quarter(now + timedelta(hours=48))
    for _ in range(200):
        if cutoff_of(HALSTED, start) >= now + timedelta(seconds=CUTOFF_LEAD_S):
            chosen = find_slot(base, (HALSTED,), start, start, MAX_OCCURRENCE_MIN, count=count)
            if len(chosen) == count:
                return chosen
        start += timedelta(minutes=15)
    raise AssertionError("no free stations at a usable cutoff")


def cutoff_wait(api: Api, bk: dict) -> float:
    return (iso(bk["balance_due_by"]) - server_now(api)).total_seconds() + CUTOFF_GRACE_S + 30


def test_unpaid_cutoff(app_url: str, killbill: Any) -> None:
    a, control = new_renter(app_url), new_renter(app_url)
    buy_pack(a.api)
    far_day, far_st = fresh_day(app_url)
    book(a.api, slot_at(HALSTED, far_st, far_day, "06:00", "18:00"), use_pack=True, pay_now=False)
    chosen = cutoff_slots(app_url, 2)
    unpaid = book(a.api, chosen[0], use_pack=True, pay_now=False)[0]
    assert unpaid["pack_minutes"] > 0 and unpaid["card_minutes"] > 0 and unpaid["paid"] is False
    assert iso(unpaid["balance_due_by"]) == cutoff_of(HALSTED, chosen[0].start_at)
    paid = book(control.api, chosen[1], pay_now=False)[0]
    assert control.api.post(f"/api/bookings/{paid['id']}/pay", {}, idempotency_key()).status_code == 200
    reserved_before = pack(a.api)["reserved_minutes"]
    poll(lambda: booking(a.api, unpaid["id"])["status"] == "unpaid_cancelled", cutoff_wait(a.api, unpaid),
         "unpaid cancellation")
    after = pack(a.api)
    assert after["reserved_minutes"] == reserved_before - unpaid["pack_minutes"]
    assert len([e for e in after["entries"] if e["booking_id"] == unpaid["id"] and e["reason"] == "release"]) == 2
    assert kb_tx(killbill, f"hs-deposit-{unpaid['id']}", "PURCHASE") == [DEPOSIT[HALSTED]]
    assert kb_tx(killbill, f"hs-deposit-{unpaid['id']}", "REFUND") == []
    assert killbill.payment_by_key(f"hs-booking-{unpaid['id']}") is None
    events = [e for e in audit(a.api, unpaid["id"]) if e["to"] == "unpaid_cancelled"]
    assert len(events) == 1 and events[0]["actor_role"] == "system"
    kept = booking(control.api, paid["id"])
    assert kept["status"] == "confirmed" and kept["paid"] is True


def test_unpaid_notice_email(app_url: str, mail: Any) -> None:
    a, control = new_renter(app_url), new_renter(app_url)
    slots = cutoff_slots(app_url, 2)
    unpaid = book(a.api, slots[0], pay_now=False)[0]
    paid = book(control.api, slots[1], pay_now=False)[0]
    assert control.api.post(f"/api/bookings/{paid['id']}/pay", {}, idempotency_key()).status_code == 200
    subject = SUBJ_UNPAID.format(slots[0].name, slots[0].date.isoformat())
    (notice,) = await_mail(mail, a.email, subject, 1, cutoff_wait(a.api, unpaid) + MAIL_DEADLINE_S)
    assert addresses(notice.get(MP_TO)) == [a.email]
    body = text(notice)
    assert hm(iso(unpaid["balance_due_by"]), HALSTED) in body and "deposit" in body.lower()
    quiet_mail(mail, a.email, "Booking cancelled", 1, REMINDER_EVERY_S)
    assert not mails(mail, control.email, prefix="Booking cancelled")


def utilisation(api: Api, site: str, day: date) -> dict:
    r = api.get(f"/api/sites/{site}/utilisation", params={"date": day.isoformat()})
    assert r.status_code == 200, r.text
    return r.json()


def test_utilisation_site_day(app_url: str) -> None:
    odile = staff(app_url, ODILE)
    a = new_renter(app_url)
    day, st = fresh_day(app_url, offsets=(0, 1))
    nxt = day + timedelta(days=1)
    before = {d: utilisation(odile, HALSTED, d) for d in (day, nxt)}
    book(a.api, slot_at(HALSTED, st, day, "10:00", "12:00"), pay_now=False)
    book(a.api, slot_at(HALSTED, st, day, "23:00", "01:00"), pay_now=False)
    hold = place(a.api, slot_at(HALSTED, st, day, "14:00", "15:00"))
    gone = book(a.api, slot_at(HALSTED, st, day, "16:00", "17:00"), pay_now=False)[0]
    assert a.api.post(f"/api/bookings/{gone['id']}/cancel", {}, idempotency_key()).status_code == 200
    after = {d: utilisation(odile, HALSTED, d) for d in (day, nxt)}

    def booked(report: dict) -> int:
        return next(s["booked_minutes"] for s in report["stations"] if s["station_id"] == st[0])

    assert booked(after[day]) - booked(before[day]) == 120 + 60
    assert booked(after[nxt]) - booked(before[nxt]) == 60
    report = after[day]
    assert report["day_minutes"] == DAY_NORMAL and report["time_zone"] == TZ[HALSTED]
    assert [s["station_id"] for s in report["stations"]] == [s[0] for s in STATIONS[HALSTED]]
    for row in report["stations"]:
        want = (Decimal(row["booked_minutes"] * 100) / Decimal(report["day_minutes"])).quantize(
            Decimal("0.1"), rounding=ROUND_HALF_UP)
        assert Decimal(str(row["utilisation_percent"])) == want
    csv = odile.get(f"/api/sites/{HALSTED}/utilisation.csv", params={"date": day.isoformat()})
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    lines = csv.text.strip().splitlines()
    assert lines[0] == "station,booked_minutes,day_minutes,utilisation_percent"
    assert len(lines) == 1 + len(STATIONS[HALSTED])
    index = [s[0] for s in STATIONS[HALSTED]].index(st[0])
    cells = lines[1 + index].split(",")
    assert int(cells[1]) == booked(report) and int(cells[2]) == DAY_NORMAL
    spring, autumn = clock_changes(HALSTED, local_today(odile, HALSTED))
    assert utilisation(odile, HALSTED, spring)["day_minutes"] == DAY_SPRING
    assert utilisation(odile, HALSTED, autumn)["day_minutes"] == DAY_AUTUMN
    err(odile.get(f"/api/sites/{HALSTED}/utilisation", params={"date": "tomorrow"}), 422, "validation")
    err(a.api.get(f"/api/sites/{HALSTED}/utilisation", params={"date": day.isoformat()}), 403, "forbidden")
    err(staff(app_url, PRIYA).get(f"/api/sites/{HALSTED}/utilisation", params={"date": day.isoformat()}), 403,
        "forbidden")
    a.api.delete(f"/api/holds/{hold['id']}")


def test_wf_manager_day_report(browser: Browser, app_url: str) -> None:
    renter = new_renter(app_url)
    day, st = fresh_day(app_url)
    book(renter.api, slot_at(HALSTED, st, day, "10:00", "12:00"), pay_now=False)
    odile = staff(app_url, ODILE)
    future = free_policy_date(odile, CORKTOWN)
    notice = 30
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, ODILE)
        poll(lambda: page.url.rstrip("/").endswith("/manage"), UI_DEADLINE_S, "manager lands on Manage")
        totals = wait_ui(page, page.get_by_role("region", name="Site totals"))
        for label in ("Bookings today", "Booked hours today", "Unpaid balances", "Documents expiring in 14 days"):
            wait_ui(page, totals, contains=label)
        for site_name in (SITE_NAMES[HALSTED], SITE_NAMES[CORKTOWN]):
            wait_ui(page, totals, contains=site_name)
        assert SITE_NAMES[FREMONT] not in totals.inner_text()
        fill(page.get_by_role("searchbox", name="Search renters"), renter.business)
        advance(page, SEARCH_PAUSE_MS + 100)
        wait_ui(page, page.get_by_role("list", name="Renter results"), contains=renter.email)
        select(page.get_by_role("combobox", name="Report site"), SITE_NAMES[HALSTED])
        report_day = page.get_by_role("textbox", name="Report day")
        fill(report_day, day.isoformat())
        report_day.press("Enter")
        row = page.get_by_role("table", name="Station utilisation").get_by_role("row").filter(has_text=st[1])
        wait_ui(page, row, contains="2.00")
        wait_ui(page, row, contains="24.00")
        with page.expect_download() as info:
            click(page.get_by_role("link", name="Download CSV"))
        csv_text = Path(info.value.path()).read_text()
        assert csv_text.splitlines()[0] == "station,booked_minutes,day_minutes,utilisation_percent"
        assert any(line.split(",")[1:2] == [str(2 * 60)] for line in csv_text.splitlines()[1:])
        select(page.get_by_role("combobox", name="Policy site"), SITE_NAMES[CORKTOWN])
        fill(page.get_by_role("spinbutton", name="Notice hours"), str(notice))
        fill(page.get_by_role("textbox", name="Effective from"), future.isoformat())
        click(page.get_by_role("button", name="Schedule policy"))
        wait_ui(page, page.get_by_role("status", name="Manager status"),
                contains=f"{notice}-hour policy scheduled from {future.isoformat()}.")
        wait_ui(page, page.get_by_role("table", name="Policy versions").get_by_role("row")
                .filter(has_text=future.isoformat()), contains="Odile Marchetti")
    versions = odile.get(f"/api/sites/{CORKTOWN}/policies").json()["versions"]
    assert [v["notice_hours"] for v in versions if v["effective_from"] == future.isoformat()] == [notice]


def test_wf_manager_day_policy_conflict(browser: Browser, app_url: str) -> None:
    odile = staff(app_url, ODILE)
    taken = free_policy_date(odile, CORKTOWN)
    first_notice, second_notice = 12, 30
    r = odile.post(f"/api/sites/{CORKTOWN}/policies", {"notice_hours": first_notice, "effective_from": taken.isoformat()})
    assert r.status_code == 201, r.text
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, ODILE)
        select(wait_ui(page, page.get_by_role("combobox", name="Policy site")), SITE_NAMES[CORKTOWN])
        fill(page.get_by_role("spinbutton", name="Notice hours"), str(second_notice))
        fill(page.get_by_role("textbox", name="Effective from"), taken.isoformat())
        click(page.get_by_role("button", name="Schedule policy"))
        wait_ui(page, page.get_by_role("status", name="Manager status"), contains="A policy already starts on that date.")
    versions = odile.get(f"/api/sites/{CORKTOWN}/policies").json()["versions"]
    assert [v["notice_hours"] for v in versions if v["effective_from"] == taken.isoformat()] == [first_notice]


DOC_CASE_IDS = ["pdf", "png", "jpeg", "exact_limit", "png_named_pdf", "svg", "html", "fake_pdf", "too_large",
                "dates_reversed", "no_file"]


@pytest.mark.parametrize("case", DOC_CASE_IDS, ids=DOC_CASE_IDS)
def test_document_content_checks(app_url: str, s3: S3, case: str) -> None:
    renter = new_renter(app_url, cert=False)
    ok = {"pdf": (PDF, "cert.pdf", "application/pdf", "pdf"), "png": (PNG, "card.png", "image/png", "png"),
          "jpeg": (JPEG, "card.jpg", "image/jpeg", "jpg"),
          "exact_limit": (PDF + b"0" * (FILE_LIMIT - len(PDF)), "big.pdf", "application/pdf", "pdf"),
          "png_named_pdf": (PNG, "renamed.pdf", "application/pdf", "png")}
    bad = {"svg": (SVG, "logo.svg", "image/svg+xml", 415, "unsupported_file_type"),
           "html": (HTML, "page.pdf", "application/pdf", 415, "unsupported_file_type"),
           "fake_pdf": (b"just some text", "cert.pdf", "application/pdf", 415, "unsupported_file_type"),
           "too_large": (PDF + b"0" * (FILE_LIMIT + 1 - len(PDF)), "big.pdf", "application/pdf", 413,
                         "file_too_large")}
    if case in ok:
        content, name, declared, ext = ok[case]
        r = upload(renter.api, "food_handler", CERT_FROM, CERT_TO, content, name, declared)
        assert r.status_code == 201, r.text
        doc = r.json()["document"]
        assert doc["size_bytes"] == len(content) and doc["kind"] == "food_handler"
        served = renter.api.get(f"/api/documents/{doc['id']}/file")
        assert served.content == content
        assert f'filename="{doc["id"]}.{ext}"' in served.headers["content-disposition"]
        if ext == "pdf":
            assert served.headers["content-type"].startswith("application/pdf")
        return
    if case in bad:
        content, name, declared, status, code = bad[case]
        body = err(upload(renter.api, "food_handler", CERT_FROM, CERT_TO, content, name, declared), status, code)
        if code == "file_too_large":
            assert body["limit_bytes"] == FILE_LIMIT
    elif case == "dates_reversed":
        r = upload(renter.api, "food_handler", CERT_TO, CERT_FROM, PDF)
        assert "expires_on" in err(r, 422, "validation")["fields"]
    else:
        err(upload(renter.api, "food_handler", CERT_FROM, CERT_TO, None), 422, "validation")
    assert renter.api.get("/api/documents").json()["documents"] == []
    assert s3.keys(f"renters/{renter.id}/") == []


def test_document_storage_private(app_url: str, s3: S3) -> None:
    a = new_renter(app_url, home=CORKTOWN, cert=False)
    other = new_renter(app_url, cert=False)
    r = upload(a.api, "liability", CERT_FROM, CERT_TO, PDF, "../../etc/passwd.pdf")
    assert r.status_code == 201, r.text
    doc = r.json()["document"]
    key = f"renters/{a.id}/documents/{doc['id']}"
    assert s3.keys(f"renters/{a.id}/") == [key] and s3.get(key) == PDF
    path = f"/api/documents/{doc['id']}/file"
    own = a.api.get(path)
    assert own.status_code == 200 and own.content == PDF
    assert own.headers["content-type"].startswith("application/pdf")
    assert own.headers["content-disposition"] == f'inline; filename="{doc["id"]}.pdf"'
    assert own.headers["x-content-type-options"] == "nosniff"
    for viewer in (ODILE, PRIYA):
        assert staff(app_url, viewer).get(path).content == PDF
        listed = staff(app_url, viewer).get("/api/documents", params={"renter_id": a.id}).json()["documents"]
        assert doc["id"] in [d["id"] for d in listed]
    for viewer in (WEN, ADA):
        err(staff(app_url, viewer).get(path), 404, "not_found")
        err(staff(app_url, viewer).get("/api/documents", params={"renter_id": a.id}), 404, "not_found")
    err(other.api.get(path), 404, "not_found")
    assert other.api.get("/api/documents", params={"renter_id": a.id}).json()["documents"] == []
    err(httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S), 401, "unauthenticated")


def test_expiry_reminder_once(app_url: str, mail: Any) -> None:
    a = new_renter(app_url, cert=False)
    today = local_today(a.api, HALSTED)
    soon = today + timedelta(days=10)
    edge = today + timedelta(days=REMINDER_DAYS)
    outside = today + timedelta(days=REMINDER_DAYS + 1)
    for kind, expires in (("liability", soon), ("food_handler", edge), ("liability", outside)):
        assert upload(a.api, kind, today.isoformat(), expires.isoformat(), PDF).status_code == 201
    await_mail(mail, a.email, SUBJ_LIABILITY.format(soon.isoformat()), 1, REMINDER_FIRST_S + 30)
    await_mail(mail, a.email, SUBJ_FOOD.format(edge.isoformat()), 1, REMINDER_FIRST_S + 30)
    quiet_mail(mail, a.email, "Your ", 2, 2 * REMINDER_EVERY_S)
    assert not mails(mail, a.email, SUBJ_LIABILITY.format(outside.isoformat()))


def test_wf_renter_documents_upload_then_confirm(browser: Browser, app_url: str, killbill: Any) -> None:
    a = new_renter(app_url, cert=False)
    day, st = fresh_day(app_url)
    hold = place(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"))
    today = local_today(a.api, HALSTED)
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        check(dialog.get_by_role("radio", name="Pay now"))
        click(dialog.get_by_role("button", name="Confirm booking"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"),
                contains=f"Upload a liability certificate that covers {day.isoformat()} before confirming.")
        page.keyboard.press("Escape")
        nav(page, "Documents")
        select(wait_ui(page, page.get_by_role("combobox", name="Document type")), "Liability certificate")
        fill(page.get_by_role("textbox", name="Valid from"), today.isoformat())
        fill(page.get_by_role("textbox", name="Expires on"), (day + timedelta(days=30)).isoformat())
        page.get_by_label("Document file").set_input_files(
            files=[{"name": "certificate.pdf", "mimeType": "application/pdf", "buffer": PDF}])
        click(page.get_by_role("button", name="Upload document"))
        wait_ui(page, page.get_by_role("status", name="Documents status"), contains="Document saved.")
        wait_ui(page, page.get_by_role("table", name="My documents").get_by_role("row")
                .filter(has_text=today.isoformat()), contains="Current")
        open_board(page, HALSTED, day)
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        check(dialog.get_by_role("radio", name="Pay now"))
        click(dialog.get_by_role("button", name="Confirm booking"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"), contains=COPY_CONFIRMED)
    (bk,) = [b for b in a.api.get("/api/bookings").json()["bookings"] if b["hold_id"] == hold["id"]]
    assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "PURCHASE") == [DEPOSIT[HALSTED]]


def test_wf_renter_documents_rejected_file(browser: Browser, app_url: str, s3: S3) -> None:
    a = new_renter(app_url, cert=False)
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        nav(page, "Documents")
        select(wait_ui(page, page.get_by_role("combobox", name="Document type")), "Liability certificate")
        fill(page.get_by_role("textbox", name="Valid from"), CERT_FROM)
        fill(page.get_by_role("textbox", name="Expires on"), CERT_TO)
        page.get_by_label("Document file").set_input_files(
            files=[{"name": "logo.svg", "mimeType": "image/svg+xml", "buffer": SVG}])
        click(page.get_by_role("button", name="Upload document"))
        wait_ui(page, page.get_by_role("status", name="Documents status"), contains="Files must be PDF, PNG or JPEG.")
    assert a.api.get("/api/documents").json()["documents"] == []
    assert s3.keys(f"renters/{a.id}/") == []


def token_of(link: dict) -> str:
    assert link["url"].startswith("/binder/")
    return link["url"].split("/binder/", 1)[1]


def test_binder_links_lifecycle(app_url: str, short_ttl_app: str) -> None:
    odile = staff(app_url, ODILE)
    today = local_today(odile, HALSTED)
    path = f"/api/sites/{HALSTED}/binder-links"

    def span(a: int, b: int) -> dict:
        return {"from": (today + timedelta(days=a)).isoformat(), "to": (today + timedelta(days=b)).isoformat()}

    err(odile.post(path, span(3, 1)), 422, "validation")
    err(odile.post(path, span(0, BINDER_MAX_DAYS)), 422, "validation")
    assert odile.post(path, span(0, BINDER_MAX_DAYS - 1)).status_code == 201
    err(staff(app_url, WEN).post(path, span(0, 6)), 404, "not_found")
    err(staff(app_url, PRIYA).post(path, span(0, 6)), 403, "forbidden")
    r = odile.post(path, span(0, 6))
    assert r.status_code == 201, r.text
    link = r.json()["link"]
    assert link["site_id"] == HALSTED and link["revoked"] is False and link["from"] == span(0, 6)["from"]
    assert abs((iso(link["expires_at"]) - iso(link["created_at"])).total_seconds() - BINDER_TTL_DEFAULT_S) <= 1
    old = token_of(link)
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    assert anon.get(f"/api/binder/{old}").status_code == 200 and anon.get(f"/binder/{old}").status_code == 200
    err(staff(app_url, WEN).post(f"/api/binder-links/{link['id']}/regenerate"), 404, "not_found")
    err(staff(app_url, WEN).delete(f"/api/binder-links/{link['id']}"), 404, "not_found")
    assert anon.get(f"/api/binder/{old}").status_code == 200
    r = odile.post(f"/api/binder-links/{link['id']}/regenerate")
    assert r.status_code == 200
    new = token_of(r.json()["link"])
    assert new != old
    err(anon.get(f"/api/binder/{old}"), 404, "link_not_found")
    dead = anon.get(f"/binder/{old}")
    assert dead.status_code == 404 and COPY_DEAD_LINK in dead.text
    err(anon.get(f"/binder/{old}/binder.pdf"), 404, "link_not_found")
    assert anon.get(f"/api/binder/{new}").status_code == 200
    assert odile.delete(f"/api/binder-links/{link['id']}").status_code == 204
    err(anon.get(f"/api/binder/{new}"), 404, "link_not_found")
    listed = next(x for x in odile.get(path).json()["links"] if x["id"] == link["id"])
    assert listed["revoked"] is True
    err(odile.post(f"/api/binder-links/{link['id']}/regenerate"), 409, "invalid_transition")
    short = staff(short_ttl_app, ODILE)
    r = short.post(path, span(0, 1))
    assert r.status_code == 201, r.text
    short_link = r.json()["link"]
    assert abs((iso(short_link["expires_at"]) - iso(short_link["created_at"])).total_seconds() - SHORT_BINDER_TTL_S) <= 1
    token = token_of(short_link)
    assert httpx.get(f"{short_ttl_app}/api/binder/{token}", timeout=HTTP_TIMEOUT_S).status_code == 200
    poll(lambda: server_now(short) >= iso(short_link["expires_at"]) + timedelta(seconds=1), SHORT_BINDER_TTL_S + 30,
         "binder link expiry")
    err(httpx.get(f"{short_ttl_app}/api/binder/{token}", timeout=HTTP_TIMEOUT_S), 404, "link_not_found")


def test_binder_contents(app_url: str) -> None:
    day, st = fresh_day(app_url, offsets=(0, 1))
    nxt = day + timedelta(days=1)
    a, b, c = new_renter(app_url), new_renter(app_url), new_renter(app_url)
    lapsed = (day - timedelta(days=1)).isoformat()
    assert upload(a.api, "food_handler", CERT_FROM, lapsed, PDF).status_code == 201
    book(a.api, slot_at(HALSTED, st, day, "22:00", "02:00"), pay_now=False)
    book(b.api, slot_at(HALSTED, st, day, "10:00", "11:00"), pay_now=False)
    gone = book(c.api, slot_at(HALSTED, st, day, "12:00", "13:00"), pay_now=False)[0]
    assert c.api.post(f"/api/bookings/{gone['id']}/cancel", {}, idempotency_key()).status_code == 200
    cedar = new_renter(app_url, home=FREMONT)
    _, fr_st = fresh_day(app_url, site=FREMONT, on=day)
    book(cedar.api, slot_at(FREMONT, fr_st, day, "10:00", "11:00"), pay_now=False)
    r = staff(app_url, ODILE).post(f"/api/sites/{HALSTED}/binder-links", {"from": day.isoformat(), "to": nxt.isoformat()})
    assert r.status_code == 201, r.text
    token = token_of(r.json()["link"])
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    r = anon.get(f"/api/binder/{token}")
    assert r.status_code == 200
    binder = r.json()
    assert binder["site_name"] == SITE_NAMES[HALSTED]
    assert (binder["from"], binder["to"]) == (day.isoformat(), nxt.isoformat())
    rows_a = [x for x in binder["rows"] if x["business"] == a.business]
    assert sorted(x["date"] for x in rows_a) == [day.isoformat(), nxt.isoformat()]
    for row in rows_a:
        assert row["renter_name"] == a.name and row["station"] == st[1]
        assert row["liability"] == {"status": "current", "expires_on": CERT_TO}
        assert row["food_handler"] == {"status": "expired", "expires_on": lapsed}
    (row_b,) = [x for x in binder["rows"] if x["business"] == b.business]
    assert row_b["food_handler"] == {"status": "missing", "expires_on": None}
    assert not [x for x in binder["rows"] if x["business"] in (c.business, cedar.business)]
    for secret in (a.email, a.phone, b.email, b.phone, "_cents", "paid"):
        assert secret not in r.text
    html = anon.get(f"/binder/{token}")
    assert a.business in html.text and a.phone not in html.text and a.email not in html.text
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for path in (f"/api/binder/{token}", f"/binder/{token}"):
            err(anon.request(method, path, json={}), 405, "read_only")
    assert anon.get(f"/api/binder/{token}").status_code == 200


def test_binder_pdf(app_url: str, s3: S3) -> None:
    odile = staff(app_url, ODILE)
    today = local_today(odile, HALSTED)
    r = odile.post(f"/api/sites/{HALSTED}/binder-links",
                   {"from": today.isoformat(), "to": (today + timedelta(days=2)).isoformat()})
    assert r.status_code == 201, r.text
    link = r.json()["link"]
    key = f"sites/{HALSTED}/binders/{link['id']}.pdf"
    poll(lambda: key in s3.keys(f"sites/{HALSTED}/binders/"), 30, "binder PDF in MinIO")
    stored = s3.get(key)
    assert stored.startswith(b"%PDF")
    r = httpx.get(f"{app_url}/binder/{token_of(link)}/binder.pdf", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf")
    assert r.content == stored
    fresh = odile.post(f"/api/binder-links/{link['id']}/regenerate").json()["link"]
    r2 = httpx.get(f"{app_url}/binder/{token_of(fresh)}/binder.pdf", timeout=HTTP_TIMEOUT_S)
    assert r2.status_code == 200 and r2.content == s3.get(key) and r2.content.startswith(b"%PDF")
    err(httpx.get(f"{app_url}/binder/{token_of(link)}/binder.pdf", timeout=HTTP_TIMEOUT_S), 404, "link_not_found")


def binder_address(page: Page, from_day: date) -> tuple[Locator, str]:
    row = wait_ui(page, page.get_by_role("table", name="Binder links").get_by_role("row")
                  .filter(has_text=from_day.isoformat()), pattern=r"/binder/\S+")
    found = re.search(r"/binder/[^\s\"'<>]+", row.evaluate("e => e.innerText ?? e.textContent"))
    assert found
    return row, found.group(0)


def test_wf_inspector_binder_visit(browser: Browser, app_url: str) -> None:
    renter = new_renter(app_url)
    day, st = fresh_day(app_url)
    book(renter.api, slot_at(HALSTED, st, day, "10:00", "11:00"), pay_now=False)
    with open_app(browser, f"{app_url}/") as manager, open_app(browser, f"{app_url}/") as inspector:
        sign_in(manager, ODILE)
        select(wait_ui(manager, manager.get_by_role("combobox", name="Binder site")), SITE_NAMES[HALSTED])
        fill(manager.get_by_role("textbox", name="Binder from"), day.isoformat())
        fill(manager.get_by_role("textbox", name="Binder to"), day.isoformat())
        click(manager.get_by_role("button", name="Create binder link"))
        status = manager.get_by_role("status", name="Manager status")
        wait_ui(manager, status, contains="Binder link ready.")
        row, first = binder_address(manager, day)
        inspector.goto(f"{app_url}{first}")
        table = wait_ui(inspector, inspector.get_by_role("table", name="Compliance binder"), contains=renter.business)
        assert renter.phone not in table.evaluate("e => e.innerText")
        with inspector.expect_download() as info:
            click(inspector.get_by_role("link", name="Download PDF"))
        assert Path(info.value.path()).read_bytes().startswith(b"%PDF")
        click(row.get_by_role("button", name="Regenerate"))
        wait_ui(manager, status, contains="New link ready. The old link no longer works.")
        inspector.goto(f"{app_url}{first}")
        wait_ui(inspector, inspector.get_by_role("heading", name=COPY_DEAD_LINK))
        row, second = binder_address(manager, day)
        assert second != first
        click(row.get_by_role("button", name="Revoke"))
        wait_ui(manager, status, contains="Link revoked.")
        inspector.goto(f"{app_url}{second}")
        wait_ui(inspector, inspector.get_by_role("heading", name=COPY_DEAD_LINK))
    err(httpx.get(f"{app_url}/api{second}", timeout=HTTP_TIMEOUT_S), 404, "link_not_found")


def test_wf_inspector_binder_dead_link(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}/") as page:
        response = page.goto(f"{app_url}/binder/{uuid.uuid4().hex}")
        assert response is not None and response.status == 404
        wait_ui(page, page.get_by_role("heading", name=COPY_DEAD_LINK))
        assert not page.get_by_role("table", name="Compliance binder").count()
        assert not page.get_by_role("link", name="Download PDF").count()


def test_own_records_only(app_url: str) -> None:
    a, b = new_renter(app_url), new_renter(app_url, cert=False)
    day, st = fresh_day(app_url)
    hold = place(a.api, slot_at(HALSTED, st, day, "15:00", "16:00"))
    bk = book(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"), pay_now=False)[0]
    doc = a.api.get("/api/documents").json()["documents"][0]
    for path in (f"/api/holds/{hold['id']}", f"/api/bookings/{bk['id']}", f"/api/bookings/{bk['id']}/invoice",
                 f"/api/bookings/{bk['id']}/audit", f"/api/documents/{doc['id']}/file", f"/api/renters/{a.id}/pack",
                 f"/api/bookings/bk-{uuid.uuid4().hex}"):
        err(b.api.get(path), 404, "not_found")
    err(b.api.delete(f"/api/holds/{hold['id']}"), 404, "not_found")
    err(confirm(b.api, hold["id"]), 404, "not_found")
    err(b.api.post(f"/api/bookings/{bk['id']}/pay", {}, idempotency_key()), 404, "not_found")
    err(b.api.post(f"/api/bookings/{bk['id']}/cancel", {}, idempotency_key()), 404, "not_found")
    assert a.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "held"
    mine = booking(a.api, bk["id"])
    assert mine["status"] == "confirmed" and mine["paid"] is False
    assert a.api.get(f"/api/bookings/{bk['id']}/invoice").status_code == 200
    assert bk["id"] not in [x["id"] for x in b.api.get("/api/bookings").json()["bookings"]]
    assert doc["id"] not in [d["id"] for d in b.api.get("/api/documents", params={"renter_id": a.id}).json()["documents"]]
    a.api.delete(f"/api/holds/{hold['id']}")


def dashboard(api: Api) -> dict:
    r = api.get("/api/dashboard")
    assert r.status_code == 200, r.text
    return r.json()


def test_operator_isolation(app_url: str) -> None:
    odile, wen = staff(app_url, ODILE), staff(app_url, WEN)
    ember, cedar = new_renter(app_url, cert=False), new_renter(app_url, home=FREMONT, cert=False)
    for who, q in ((odile, cedar.business), (wen, ember.business), (staff(app_url, ADA), ember.business)):
        assert who.get("/api/renters", params={"q": q}).json()["renters"] == []
    assert cedar.email not in [r["email"] for r in odile.get("/api/renters", params={"q": ""}).json()["renters"]]
    found = staff(app_url, PRIYA).get("/api/renters", params={"q": ember.business}).json()["renters"]
    assert ember.email in [r["email"] for r in found]
    before_o, before_w = dashboard(odile), dashboard(wen)
    ember_today, cedar_today = local_today(odile, HALSTED), local_today(wen, FREMONT)
    soon = 5
    upload(ember.api, "liability", ember_today.isoformat(), (ember_today + timedelta(days=soon)).isoformat(), PDF)
    upload(cedar.api, "liability", cedar_today.isoformat(), (cedar_today + timedelta(days=soon)).isoformat(), PDF)
    after_o, after_w = dashboard(odile), dashboard(wen)
    assert {s["site_id"] for s in after_o["sites"]} == {HALSTED, CORKTOWN}
    assert {s["site_id"] for s in after_w["sites"]} == {FREMONT}

    def site(d: dict, sid: str) -> dict:
        return next(s for s in d["sites"] if s["site_id"] == sid)

    assert site(after_o, HALSTED)["expiring_documents"] == site(before_o, HALSTED)["expiring_documents"] + 1
    assert site(after_w, FREMONT)["expiring_documents"] == site(before_w, FREMONT)["expiring_documents"] + 1
    assert site(after_o, HALSTED)["local_date"] == ember_today.isoformat()
    for dash in (after_o, after_w):
        for field in ("bookings_today", "booked_minutes_today", "unpaid_balance_cents", "expiring_documents"):
            assert dash["totals"][field] == sum(s[field] for s in dash["sites"])
    day = cedar_today.isoformat()
    for path in (f"/api/sites/{FREMONT}/utilisation", f"/api/sites/{FREMONT}/utilisation.csv",
                 f"/api/sites/{FREMONT}/day", f"/api/sites/{FREMONT}/policies"):
        err(odile.get(path, params={"date": day}), 404, "not_found")
    err(odile.post(f"/api/sites/{FREMONT}/binder-links", {"from": day, "to": day}), 404, "not_found")
    err(wen.get(f"/api/sites/{HALSTED}/utilisation", params={"date": day}), 404, "not_found")
    err(wen.get(f"/api/renters/{ember.id}/pack"), 404, "not_found")
    err(cedar.api.get(f"/api/sites/{HALSTED}/day", params={"date": day}), 404, "not_found")
    assert FREMONT not in [s["id"] for s in odile.get("/api/sites").json()["sites"]]


def test_manager_override(app_url: str, killbill: Any) -> None:
    a, b = new_renter(app_url), new_renter(app_url, cert=False)
    notice = notice_in_force(app_url, HALSTED)["notice_hours"]
    now = server_now(a.api)
    latest = now + max(timedelta(hours=2), timedelta(hours=notice) - timedelta(minutes=30))
    (slot,) = find_slot(app_url, (HALSTED,), now + timedelta(minutes=45), latest, 60)
    bk = book(a.api, slot)[0]
    path = f"/api/bookings/{bk['id']}/override"
    reason = "Oven fault reported by the morning shift"
    err(a.api.post(path, {"action": "cancel_refunded", "reason": reason}), 403, "forbidden")
    err(staff(app_url, PRIYA).post(path, {"action": "cancel_refunded", "reason": reason}), 403, "forbidden")
    err(staff(app_url, WEN).post(path, {"action": "cancel_refunded", "reason": reason}), 404, "not_found")
    odile = staff(app_url, ODILE)
    for bad in ("x" * (REASON_MIN - 1), "x" * (REASON_MAX + 1)):
        assert "reason" in err(odile.post(path, {"action": "cancel_refunded", "reason": bad}), 422,
                               "validation")["fields"]
    assert booking(a.api, bk["id"])["status"] == "confirmed"
    r = odile.post(path, {"action": "cancel_refunded", "reason": reason})
    assert r.status_code == 200, r.text
    assert r.json()["booking"]["status"] == "cancelled_refunded"
    assert r.json()["refund"]["tier"] == "full" and r.json()["refund"]["card_refund_cents"] == bk["card_cents"]
    assert r.json()["refund"]["deposit_refund_cents"] == DEPOSIT[HALSTED]
    assert kb_tx(killbill, f"hs-booking-{bk['id']}", "REFUND") == [bk["card_cents"]]
    assert kb_tx(killbill, f"hs-deposit-{bk['id']}", "REFUND") == [DEPOSIT[HALSTED]]
    event = next(e for e in audit(a.api, bk["id"]) if e["to"] == "cancelled_refunded")
    assert (event["actor_name"], event["actor_role"], event["reason"]) == ("Odile Marchetti", "manager", reason)
    err(odile.post(path, {"action": "cancel_refunded", "reason": reason}), 409, "invalid_transition")
    day, st = fresh_day(app_url)
    hold_slot = slot_at(HALSTED, st, day, "10:00", "11:00")
    hold = place(a.api, hold_slot)
    r = odile.post(f"/api/holds/{hold['id']}/override", {"action": "release", "reason": reason})
    assert r.status_code == 200 and r.json()["hold"]["status"] == "expired"
    err(confirm(a.api, hold["id"]), 410, "hold_expired")
    err(odile.post(f"/api/holds/{hold['id']}/override", {"action": "release", "reason": reason}), 409,
        "invalid_transition")
    b.api.delete(f"/api/holds/{place(b.api, hold_slot)['id']}")


def test_wf_operator_oversight_search(browser: Browser, app_url: str) -> None:
    ember, cedar = new_renter(app_url, cert=False), new_renter(app_url, home=FREMONT, cert=False)
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, ODILE)
        search = wait_ui(page, page.get_by_role("searchbox", name="Search renters"))
        results = page.get_by_role("list", name="Renter results")
        fill(search, ember.business)
        advance(page, SEARCH_PAUSE_MS + 100)
        wait_ui(page, results, contains=ember.email)
        fill(search, cedar.business)
        advance(page, SEARCH_PAUSE_MS + 100)
        wait_until(page, lambda: ember.email not in results.inner_text(), "search results refreshed")
        assert cedar.email not in results.inner_text() and cedar.business not in results.inner_text()
    assert staff(app_url, ODILE).get("/api/renters", params={"q": cedar.business}).json()["renters"] == []


def test_wf_operator_oversight_own_tickets(browser: Browser, app_url: str) -> None:
    a, b = new_renter(app_url), new_renter(app_url)
    day, st = fresh_day(app_url)
    bk_a = book(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"), pay_now=False)[0]
    bk_b = book(b.api, slot_at(HALSTED, st, day, "13:00", "14:00"), pay_now=False)[0]
    for renter, own, other in ((a, "10:00", "13:00"), (b, "13:00", "10:00")):
        with open_app(browser, f"{app_url}/") as page:
            sign_in(page, renter.email, renter.password)
            nav(page, "Tickets")
            items = page.get_by_role("listitem").filter(has_text=day.isoformat())
            wait_ui(page, items.filter(has_text=own))
            assert items.filter(has_text=other).count() == 0
    err(a.api.get(f"/api/bookings/{bk_b['id']}"), 404, "not_found")
    err(b.api.get(f"/api/bookings/{bk_a['id']}"), 404, "not_found")


@pytest.mark.parametrize("service", ["billing", "mail"], ids=["billing", "mail"])
def test_outage_boot_status(browser: Browser, request: pytest.FixtureRequest, service: str) -> None:
    base = request.getfixturevalue("billing_down_app" if service == "billing" else "mail_down_app")
    r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    other = "mail" if service == "billing" else "billing"

    def delayed() -> dict | None:
        status = httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT_S).json()
        return status if status[service] == "delayed" else None

    status = poll(delayed, BANNER_S + 15, "delayed status")
    assert status[other] == "ok" and isinstance(status["queued_emails"], int)
    copy, absent = ((COPY_BANNER_BILLING, COPY_BANNER_MAIL) if service == "billing"
                    else (COPY_BANNER_MAIL, COPY_BANNER_BILLING))
    with open_app(browser, f"{base}/") as page:
        sign_in(page, TAMSIN)
        banner = wait_ui(page, page.get_by_role("status", name="Service status"), contains=copy,
                         seconds=BANNER_S + 15)
        assert absent not in banner.evaluate("e => e.innerText")
        if service == "billing":
            nav(page, "Pack")
            wait_ui(page, page.get_by_role("button", name="Buy 20-hour pack", exact=True), contains="(delayed)")


def test_billing_outage_no_trace(killbill: Any) -> None:
    reason = "Oven fault reported by the morning shift"
    with relay_billing_copy(start_open=True) as (base, billing):
        killbill = kb_for(base, killbill)
        poll(lambda: billing_state(base) == "ok", RECOVERY_S + 5, "billing ok")
        a = seeded(base, RAFA)
        buy_pack(a.api)
        day, st = fresh_day(base)
        unpaid = book(a.api, slot_at(HALSTED, st, day, "08:00", "09:00"), pay_now=False)[0]
        card = book(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"))[0]
        overridden = book(a.api, slot_at(HALSTED, st, day, "15:00", "16:00"))[0]
        counter = book(a.api, near_slot(base, sites=(HALSTED,)))[0]
        desk, odile = staff(base, PRIYA), staff(base, ODILE)
        billing.close()
        poll(lambda: billing_state(base) == "delayed", BANNER_S + 15, "billing delayed")
        pay_key = idempotency_key()
        err(a.api.post(f"/api/bookings/{unpaid['id']}/pay", {}, pay_key), 503, "billing_unavailable")
        assert booking(a.api, unpaid["id"])["paid"] is False
        assert killbill.payment_by_key(f"hs-booking-{unpaid['id']}") is None
        err(a.api.post(f"/api/bookings/{card['id']}/cancel", {}, idempotency_key()), 503, "billing_unavailable")
        assert booking(a.api, card["id"])["status"] == "confirmed"
        assert kb_tx(killbill, f"hs-booking-{card['id']}", "REFUND") == []
        err(odile.post(f"/api/bookings/{overridden['id']}/override", {"action": "cancel_refunded", "reason": reason}),
            503, "billing_unavailable")
        assert booking(a.api, overridden["id"])["status"] == "confirmed"
        assert kb_tx(killbill, f"hs-booking-{overridden['id']}", "REFUND") == []
        entries_before = pack(a.api)["entries"]
        err(a.api.post("/api/packs", {"product": "20h"}, idempotency_key()), 503, "billing_unavailable")
        err(a.api.post("/api/packs", {"product": "none"}, idempotency_key()), 422, "validation")
        assert pack(a.api)["entries"] == entries_before
        assert desk.post(f"/api/bookings/{counter['id']}/check-in").status_code == 200
        err(desk.post(f"/api/bookings/{counter['id']}/overrun", {"minutes": OVERRUN_MINUTES}, idempotency_key()), 503,
            "billing_unavailable")
        assert booking(a.api, counter["id"])["status"] == "checked_in"
        assert desk.post(f"/api/bookings/{counter['id']}/check-out").status_code == 200
        err(desk.post(f"/api/bookings/{counter['id']}/cleaning-fee", {}, idempotency_key()), 503,
            "billing_unavailable")
        err(desk.post(f"/api/bookings/{counter['id']}/settle"), 503, "billing_unavailable")
        assert booking(a.api, counter["id"])["status"] == "checked_out"
        for prefix in ("hs-overrun-", "hs-cleaning-"):
            assert killbill.payment_by_key(f"{prefix}{counter['id']}") is None
        assert kb_tx(killbill, f"hs-deposit-{counter['id']}", "REFUND") == []
        hold = place(a.api, slot_at(HALSTED, st, day, "13:00", "14:00"))
        res = confirm(a.api, hold["id"], use_pack=True, pay_now=False)
        assert res.status_code == 201, res.text
        (pack_only,) = res.json()["bookings"]
        assert pack_only["card_minutes"] == 0 and pack_only["paid"] is True
        assert killbill.payment_by_key(f"hs-deposit-{pack_only['id']}") is None
        r = a.api.post(f"/api/bookings/{pack_only['id']}/cancel", {}, idempotency_key())
        assert r.status_code == 200 and r.json()["refund"]["pack_minutes_returned"] == pack_only["pack_minutes"]
        billing.open()
        poll(lambda: billing_state(base) == "ok", RECOVERY_S + 5, "billing ok after recovery")
        retried = a.api.post(f"/api/bookings/{unpaid['id']}/pay", {}, pay_key)
        assert retried.status_code == 200 and retried.json()["booking"]["paid"] is True
        assert kb_tx(killbill, f"hs-booking-{unpaid['id']}", "PURCHASE") == [unpaid["card_cents"]]


def test_mail_outage_queues(mail_down_app: str, mail: Any) -> None:
    down = mail_down_app

    def status() -> dict:
        return httpx.get(f"{down}/api/status", timeout=HTTP_TIMEOUT_S).json()

    before = poll(lambda: (lambda s: s if s["mail"] == "delayed" else None)(status()), BANNER_S + 15,
                  "mail delayed")
    a = seeded(down, TAMSIN)
    day, st = fresh_day(down)
    hold = place(a.api, slot_at(HALSTED, st, day, "09:00", "10:00"))
    res = confirm(a.api, hold["id"], use_pack=True, pay_now=False)
    assert res.status_code == 201 and res.json()["email"] == "queued"
    subject = SUBJ_CONFIRM_ONE.format(st[1], day.isoformat())
    poll(lambda: status()["queued_emails"] == before["queued_emails"] + 1, 10,
         "one email counted as queued")
    quiet_mail(mail, a.email, subject, 0, HOLD_EXPIRY_STATUS_S)
    assert status()["queued_emails"] == before["queued_emails"] + 1


def test_wf_outage_day_recover(mail: Any) -> None:
    smtp = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    env = {"SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(smtp.port), "HOLD_TTL_SECONDS": str(SHORT_HOLD_TTL_S)}
    try:
        with app_copy(env, isolated=True) as base:
            def status() -> dict:
                return httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT_S).json()

            poll(lambda: status()["mail"] == "delayed", BANNER_S + 15, "mail delayed")
            owner = seeded(base, JUNE)
            day, st = fresh_day(base)
            hold = place(owner.api, slot_at(HALSTED, st, day, "10:00", "11:00"))
            subject = SUBJ_HOLD_EXPIRED.format(st[1], day.isoformat())
            poll(lambda: owner.api.get(f"/api/holds/{hold['id']}").json()["hold"]["status"] == "expired",
                 SHORT_HOLD_TTL_S + HOLD_EXPIRY_STATUS_S + 10, "hold expired")
            poll(lambda: status()["queued_emails"] == 1, 10, "one email counted as queued")
            assert status()["mail"] == "delayed" and not mails(mail, owner.email, subject)
            smtp.open()
            poll(lambda: status()["mail"] == "ok", RECOVERY_S + 5, "mail ok after recovery")
            await_mail(mail, owner.email, subject, 1, RECOVERY_S + 5)
            poll(lambda: status()["queued_emails"] == 0, RECOVERY_S + 5, "queue drained")
            quiet_mail(mail, owner.email, subject, 1, REMINDER_EVERY_S)
    finally:
        smtp.close()


def test_wf_outage_day_pack_only_checkout(browser: Browser, billing_down_app: str, killbill: Any) -> None:
    down = billing_down_app
    killbill = kb_for(down, killbill)
    a = seeded(down, TAMSIN)
    charges = kb_payment_count(killbill, a.id)
    day, st = fresh_day(down)
    hold = place(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"))
    with open_app(browser, f"{down}/") as page:
        sign_in(page, a.email, a.password)
        wait_ui(page, page.get_by_role("status", name="Service status"), contains=COPY_BANNER_BILLING,
                seconds=BANNER_S + 15)
        open_board(page, HALSTED, day)
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        check(dialog.get_by_role("checkbox", name="Use pack hours"))
        click(dialog.get_by_role("button", name="Confirm booking"))
        wait_ui(page, page.get_by_role("status", name="Checkout status"), contains=COPY_CONFIRMED)
    (bk,) = [b for b in a.api.get("/api/bookings").json()["bookings"] if b["hold_id"] == hold["id"]]
    assert bk["paid"] is True and bk["card_minutes"] == 0
    assert kb_payment_count(killbill, a.id) == charges


def test_health_and_status(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["content-type"].startswith("application/json")
    status = httpx.get(f"{app_url}/api/status", timeout=HTTP_TIMEOUT_S).json()
    assert status["billing"] == "ok" and status["mail"] == "ok" and isinstance(status["queued_emails"], int)
    sites = {s["id"]: s for s in Api(app_url, TAMSIN).get("/api/sites").json()["sites"]}
    assert set(sites) == {HALSTED, CORKTOWN}
    halsted = sites[HALSTED]
    assert (halsted["name"], halsted["time_zone"], halsted["deposit_cents"], halsted["cleaning_fee_cents"]) == (
        SITE_NAMES[HALSTED], TZ[HALSTED], DEPOSIT[HALSTED], CLEANING[HALSTED])
    assert [(s["id"], s["name"], s["rate_cents"]) for s in halsted["stations"]] == STATIONS[HALSTED]
    board = httpx.get(f"{app_url}/board", timeout=HTTP_TIMEOUT_S)
    assert board.status_code == 200


SEED_USERS = [(ODILE, "manager", "Odile Marchetti", "op-ember", [HALSTED, CORKTOWN], None),
              (PRIYA, "front_desk", "Priya Lindqvist", "op-ember", [HALSTED], None),
              (MARCUS, "front_desk", "Marcus Feld", "op-ember", [CORKTOWN], None),
              (WEN, "manager", "Wen Hollis", "op-cedar", [FREMONT], None),
              (ADA, "front_desk", "Ada Moreno", "op-cedar", [FREMONT], None),
              (TAMSIN, "renter", "Tamsin Okoro", "op-ember", None, "rn-juniper")]


def test_session_roles(app_url: str) -> None:
    for email, role, name, operator, site_ids, renter_id in SEED_USERS:
        client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
        r = client.post("/api/session", json={"email": email, "password": SEED_PASSWORD})
        assert r.status_code == 200, r.text
        cookie = r.headers.get("set-cookie", "")
        assert "hs_session" in client.cookies
        assert re.search("HttpOnly", cookie, re.IGNORECASE) and re.search("SameSite=Lax", cookie, re.IGNORECASE)
        user = r.json()["user"]
        assert (user["email"], user["role"], user["name"], user["operator_id"], user["renter_id"]) == (
            email, role, name, operator, renter_id)
        if site_ids is not None:
            assert sorted(user["site_ids"]) == sorted(site_ids)
        assert client.get("/api/me").json()["user"]["email"] == email
        assert client.delete("/api/session").status_code == 204
        err(client.get("/api/me"), 401, "unauthenticated")
    bad = httpx.post(f"{app_url}/api/session", json={"email": TAMSIN, "password": "not-the-password"},
                     timeout=HTTP_TIMEOUT_S)
    err(bad, 401, "invalid_credentials")
    assert "hs_session" not in bad.headers.get("set-cookie", "")
    err(httpx.get(f"{app_url}/api/me", timeout=HTTP_TIMEOUT_S), 401, "unauthenticated")
    err(staff(app_url, PRIYA).get("/api/dashboard"), 403, "forbidden")
    err(Api(app_url, TAMSIN).get("/api/renters", params={"q": ""}), 403, "forbidden")
    assert [s["id"] for s in staff(app_url, PRIYA).get("/api/sites").json()["sites"]] == [HALSTED]


def test_error_shape_precedence(app_url: str) -> None:
    a, b = new_renter(app_url), new_renter(app_url, cert=False)
    day, st = fresh_day(app_url)
    bk = book(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"), pay_now=False)[0]
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    err(anon.post("/api/holds", content=b"{not json", headers={"Content-Type": "application/json"}), 400,
        "invalid_json")
    err(anon.post("/api/holds", json={}), 401, "unauthenticated")
    pay = f"/api/bookings/{bk['id']}/pay"
    err(b.api.client.post(pay, json={}), 404, "not_found")
    err(a.api.client.post(f"/api/bookings/{bk['id']}/overrun", json={"minutes": OVERRUN_MINUTES}), 403, "forbidden")
    err(a.api.client.post(pay, json={}), 400, "idempotency_key_required")
    err(a.api.post(pay, {}, "short"), 400, "idempotency_key_required")
    err(a.api.post(pay, {}, "bad key with spaces"), 400, "idempotency_key_required")
    err(staff(app_url, PRIYA).post(f"/api/bookings/{bk['id']}/overrun", {"minutes": 0}, idempotency_key()), 409,
        "invalid_transition")
    body = err(a.api.post("/api/holds", {"station_id": st[0], "date": "2026-13-45", "start": "10:00",
                                         "end": "11:00"}), 422, "validation")
    assert isinstance(body["fields"], dict) and body["fields"]
    key = idempotency_key()
    first = a.api.post(pay, {}, key)
    assert first.status_code == 200, first.text
    replay = a.api.post(pay, {}, key)
    assert replay.status_code == 200 and replay.json() == first.json()


def test_server_boundary(app_url: str) -> None:
    a = new_renter(app_url, cert=False)
    foreign = "http://elsewhere.invalid"
    err(httpx.post(f"{app_url}/api/holds", json={}, headers={"Origin": foreign}, timeout=HTTP_TIMEOUT_S), 403,
        "cross_origin")
    login = httpx.post(f"{app_url}/api/session", json={"email": TAMSIN, "password": SEED_PASSWORD},
                       headers={"Origin": foreign}, timeout=HTTP_TIMEOUT_S)
    err(login, 403, "cross_origin")
    assert "hs_session" not in login.headers.get("set-cookie", "")
    err(a.api.client.post("/api/packs", json={"product": "20h"},
                          headers={"Origin": foreign, "Idempotency-Key": idempotency_key()}), 403, "cross_origin")
    assert pack(a.api)["entries"] == []
    own_origin = a.api.client.post("/api/packs", json={"product": "none"},
                                   headers={"Origin": app_url.rstrip("/"), "Idempotency-Key": idempotency_key()})
    err(own_origin, 422, "validation")
    big = {"product": "x" * (JSON_BODY_LIMIT + 1)}
    err(a.api.client.post("/api/packs", json=big, headers={"Idempotency-Key": idempotency_key()}), 413, "body_too_large")
    err(a.api.client.post("/api/packs", content=b"product=20h",
                          headers={"Content-Type": "text/plain", "Idempotency-Key": idempotency_key()}), 415,
        "unsupported_media_type")
    err(upload(a.api, "liability", CERT_FROM, CERT_TO, PDF + b"0" * UPLOAD_BODY_LIMIT), 413, "body_too_large")
    assert a.api.get("/api/documents").json()["documents"] == []
    r = httpx.get(f"{app_url}/api/health", headers={"Origin": foreign}, timeout=HTTP_TIMEOUT_S)
    assert r.headers["x-content-type-options"] == "nosniff"
    assert not [h for h in r.headers if h.lower().startswith("access-control-allow")]
    for path in ("/package.json", "/package-lock.json", "/run.json", "/.env", "/tsconfig.json"):
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S).status_code == 404, path


VIEWPORT_IDS = ["phone", "tablet", "desktop"]
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_layout_viewports(browser: Browser, app_url: str, viewport: str) -> None:
    width, height = VIEWPORTS[viewport]
    odile = staff(app_url, ODILE)
    today = local_today(odile, HALSTED).isoformat()
    r = odile.post(f"/api/sites/{HALSTED}/binder-links", {"from": today, "to": today})
    assert r.status_code == 201, r.text
    link = r.json()["link"]
    plan = [(TAMSIN, ["/board", "/tickets", "/pack", "/documents"]), (PRIYA, ["/counter"]), (ODILE, ["/manage"])]
    for email, paths in plan:
        with open_app(browser, f"{app_url}/") as page:
            page.set_viewport_size({"width": width, "height": height})
            sign_in(page, email)
            for path in paths:
                page.goto(f"{app_url}{path}")
                wait_ui(page, page.get_by_role("navigation", name="Main"))
                advance(page, 1000)
                layout(page)
    with open_app(browser, f"{app_url}{link['url']}") as page:
        page.set_viewport_size({"width": width, "height": height})
        wait_ui(page, page.get_by_role("table", name="Compliance binder"))
        layout(page)


def test_wf_cross_cutting_keyboard_dial(browser: Browser, app_url: str) -> None:
    a = new_renter(app_url, cert=False)
    walkin = STATIONS[HALSTED][4]
    day, _ = fresh_day(app_url, stations=[walkin])
    with open_app(browser, f"{app_url}/", reduced_motion="reduce") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        page.mouse.click(1, 1)
        names = tab_order(page, 30)
        station_names = [s[1] for s in STATIONS[HALSTED]]
        hits = [i for i, n in enumerate(names) if n in station_names]
        assert names.index("Site") < min(names.index(n) for n in ("Previous day", "Next day", "Day")) < hits[0]
        assert [names[i] for i in hits[:2 * len(station_names)]] == station_names + station_names
        button = page.get_by_role("button", name=walkin[1]).first
        button.focus()
        button.press("Enter")
        slider = page.get_by_role("slider", name=walkin[1], exact=True)
        assert slider.evaluate("e => e === document.activeElement || e.contains(document.activeElement)")
        assert slider.get_attribute("aria-valuetext") == "No selection"
        sweep(page, HALSTED, walkin[1], 10 * 60, 11 * 60)
        wait_ui(page, page.get_by_role("status", name="Dial status"), pattern=COPY_HELD)
        dialog = wait_ui(page, page.get_by_role("dialog", name="Checkout"))
        assert animations(dialog) == []
        assert animations(page.get_by_role("group", name="Station dial")) == []
        wait_ui(page, page.get_by_role("timer", name="Hold time left"), contains="Held until")
    mine = [s for s in segments(day_view(a.api, HALSTED, day), walkin[0]) if s["state"] == "yours_held"]
    assert len(mine) == 1
    a.api.delete(f"/api/holds/{mine[0]['hold_id']}")


def test_motion_timing(browser: Browser, app_url: str) -> None:
    a = new_renter(app_url)
    day, st = fresh_day(app_url)
    place(a.api, slot_at(HALSTED, st, day, "10:00", "11:00"))
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, a.email, a.password)
        open_board(page, HALSTED, day)
        click(wait_ui(page, page.get_by_role("button", name="Checkout", exact=True)))
        dialog = page.get_by_role("dialog", name="Checkout")
        dialog.wait_for(state="attached")
        path = motion(dialog, MOTION_WINDOW_MS)
        assert len(path) > 1 and settled_at(path) <= DIALOG_IN_MAX_MS
        check(dialog.get_by_role("radio", name="Pay now"))
        click(dialog.get_by_role("button", name="Confirm booking"))
        ticket = page.get_by_role("list", name="Booking tickets").get_by_role("listitem").filter(has_text=day.isoformat())
        ticket.first.wait_for(state="attached")
        slide = motion(ticket.first, MOTION_WINDOW_MS)
        start_x = slide[0].get("x", slide[0].get("left", 0.0))
        end_x = slide[-1].get("x", slide[-1].get("left", 0.0))
        assert start_x > end_x, "a new ticket slides in from the right"
        assert settled_at(slide) <= TICKET_SLIDE_MAX_MS


def test_wf_cross_cutting_sign_in(browser: Browser, app_url: str) -> None:
    landings = [(TAMSIN, "/board", ["Board", "Tickets", "Pack", "Documents"], "Tamsin Okoro"),
                (PRIYA, "/counter", ["Board", "Counter"], "Priya Lindqvist"),
                (ODILE, "/manage", ["Board", "Counter", "Manage"], "Odile Marchetti")]
    for email, landing, links, name in landings:
        with open_app(browser, f"{app_url}/") as page:
            fill(wait_ui(page, page.get_by_role("textbox", name="Email")), email)
            fill(page.get_by_label("Password", exact=True), "not-the-password")
            click(page.get_by_role("button", name="Sign in"))
            wait_ui(page, page.get_by_role("status", name="Sign-in status"), contains="Email or password is wrong.")
            sign_in(page, email)
            poll(lambda: page.url.rstrip("/").endswith(landing), UI_DEADLINE_S, f"{email} lands on {landing}")
            menu = page.get_by_role("navigation", name="Main")
            present = [link for link in ["Board", "Tickets", "Pack", "Documents", "Counter", "Manage"]
                       if menu.get_by_role("link", name=link, exact=True).count()]
            assert present == links
            wait_text(page, name)
            click(page.get_by_role("button", name="Sign out"))
            poll(lambda: page.request.get(f"{app_url}/api/me").status == 401, UI_DEADLINE_S, "session ended")


def shipped_packages() -> dict[tuple[str, str], dict]:
    def tree(cwd: str) -> dict:
        run = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd, capture_output=True,
                             text=True, timeout=600)
        return json.loads(run.stdout or "{}")

    root = tree("/app")
    if not root.get("dependencies") or any(d.get("missing") for d in root["dependencies"].values()):
        root = tree(str(DEPLOYED_APP))
    found: dict[tuple[str, str], dict] = {}

    def walk(node: dict) -> None:
        for name, dep in (node.get("dependencies") or {}).items():
            key = (name, str(dep.get("version")))
            if key not in found:
                found[key] = dep
                walk(dep)

    walk(root)
    return found


def licence_of(dep: dict) -> str:
    value = dep.get("license")
    if not value and dep.get("path"):
        manifest_file = Path(dep["path"]) / "package.json"
        if manifest_file.exists():
            value = json.loads(manifest_file.read_text()).get("license")
    if isinstance(value, dict):
        value = value.get("type")
    return str(value or "")


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in data.values())


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({name for name, _ in shipped_packages() if name not in notices})
    assert not missing, missing
    for item in FONTS_AND_ICONS:
        assert item in notices, item


def test_if_licence_allowlist() -> None:
    bad = []
    for (name, version), dep in shipped_packages().items():
        expr = licence_of(dep)
        ids = [t for t in re.findall(r"[A-Za-z0-9.+\-]+", expr) if t not in ("OR", "AND", "WITH")]
        ok = bool(ids) and (all(i in LICENCES for i in ids) if " AND " in expr else any(i in LICENCES for i in ids))
        if not ok:
            bad.append(f"{name}@{version}: {expr!r}")
    assert not bad, bad


def test_if_no_extra_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "lowdb", "nedb", "pouchdb",
              "lmdb", "@libsql/client", "keyv"}
    assert not sorted({n for n, _ in shipped_packages() if n in banned})
    for root in (Path("/app"), Path(DEPLOYED_APP)):
        files = [p for p in root.rglob("*")
                 if p.suffix in {".sqlite", ".sqlite3", ".db"} and "node_modules" not in p.parts]
        assert not files, files
    ps = subprocess.run(["ps", "-eo", "comm"], capture_output=True, text=True).stdout.split()
    assert not {"redis-server", "mongod"} & set(ps)


def test_if_services_unchanged(killbill: Any, mail: Any, s3: S3) -> None:
    killbill.account_by_key(f"hs-renter-{uuid.uuid4().hex}")
    assert isinstance(mail.messages(0, settle=0), list)
    assert s3.keys("renters/rn-juniper/documents/")


def strip_jsonc(source: str) -> str:
    out: list[str] = []
    i, in_str = 0, False
    while i < len(source):
        ch = source[i]
        if in_str:
            out.append(ch)
            if ch == "\\":
                out.append(source[i + 1])
                i += 1
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
            out.append(ch)
        elif ch == "/" and source[i + 1:i + 2] == "/":
            while i < len(source) and source[i] != "\n":
                i += 1
            continue
        elif source.startswith("/*", i):
            i = source.index("*/", i) + 2
            continue
        else:
            out.append(ch)
        i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def test_if_typescript_strict() -> None:
    configs = [p for p in Path("/app").rglob("tsconfig*.json") if "node_modules" not in p.parts]
    root = json.loads(strip_jsonc(Path("/app/tsconfig.json").read_text()))
    strict = root.get("compilerOptions", {}).get("strict")
    if strict is None and isinstance(root.get("extends"), str):
        base = (Path("/app") / root["extends"]).resolve()
        strict = json.loads(strip_jsonc(base.read_text())).get("compilerOptions", {}).get("strict")
    assert strict is True
    for config in configs:
        assert json.loads(strip_jsonc(config.read_text())).get("compilerOptions", {}).get("strict") is not False, config


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    seen: list[str] = []
    with open_app(browser, f"{app_url}/") as page:
        page.on("request", lambda req: seen.append(req.url))
        page.reload()
        sign_in(page, TAMSIN)
        for path in ("/board", "/pack", "/documents"):
            page.goto(f"{app_url}{path}")
            wait_ui(page, page.get_by_role("navigation", name="Main"))
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert seen and not foreign, foreign
