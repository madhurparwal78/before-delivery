from __future__ import annotations

import calendar
import contextlib
import csv
import datetime as dt
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
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from PIL import Image
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    KillBill,
    Mailpit,
    Postgres,
    addresses,
    advance,
    axe,
    capture,
    center,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    scene_frames,
    select,
    session,
    state_styles,
    tab_order,
    text,
)

STORE_TZ = ZoneInfo("America/Chicago")
UTC = dt.timezone.utc
HOLD_DEFAULT_S = 172800
LINK_TTL_DEFAULT_S = 86400
FIRST_CONTRACT_NO = 1004
CUTOFF_HOUR = 17
PHOTO_MAX_BYTES = 5_000_000
PHOTO_MAX_SIDE = 8000
PHOTO_MAX_COUNT = 6
NOTES_MAX = 1000
JSON_LIMIT = 100_000
MULTIPART_LIMIT = 31_000_000
QUICK_MS = (150, 250)
MEDIUM_MS = (350, 500)
LONG_MS = (600, 800)
DIALOG_OFFSET_PX = 12
OVERSHOOT_PX = (2, 8)
NOTCH_TOL_PX = 1
HEADER_EDGE_PX = 2
FIGURE_MAX_MS = 500
FIGURE_START_MAX_MS = 200
TAP_MIN_PX = 44
DRAG_PX = 100
TURN_MIN_DEG, TURN_MAX_DEG = 15, 180
TURN_STEP_DEG = 15
LIVE_SIZE_S = 6
CUTOFF_SWITCH_S = 2
REPOLL_S = 60
MAIL_S = 10
MODEL_MIN_HEIGHT = 0.60
MODEL_CENTRE_TOL = 0.10
BAND_TOL = 0.02
GAUGE_TOL_PX = 1
FOCUS_RING_PX = 2
PAGE_STEP_MONTHS = 12
VIEWPORTS = {"narrow": (375, 812), "medium": (768, 1024), "wide": (1280, 800)}
BANDS = [(0, 639, "narrow"), (640, 1023, "medium"), (1024, 100000, "wide")]
CELLO_SIZES = ["1/4", "1/2", "3/4", "4/4"]
OPEN = {"reserved", "agreement_sent", "signed", "active"}
ROSTER_KEYS = {"student_id", "student_name", "grade", "instrument_type", "size", "serial", "delivery_date", "delivery_status"}
COUNT_KEYS = ["no_instrument", "awaiting_agreement", "scheduled", "delivered", "owned"]
STATUS_WORDS = {"no_instrument": "No instrument", "awaiting_agreement": "Awaiting agreement", "scheduled": "Scheduled for delivery", "delivered": "Delivered", "owned": "Owned"}
CSV_HEADER = ["Student", "Grade", "Instrument", "Size", "Serial", "Delivery date", "Delivery status"]
FORMULA_CHARS = ("=", "+", "-", "@")
MAIL_FROM_ADDRESS = "rentals@keelandbell.example"
FOREIGN_ORIGIN = "http://evil.example"
SEED_SERIALS = ["KB-FL-0101", "KB-FL-0102", "KB-CL-0201", "KB-CL-0202", "KB-TR-0301", "KB-TR-0302", "KB-VN-0401", "KB-VN-0402", "KB-VN-0403", "KB-VN-0404", "KB-VN-0405", "KB-CE-0501", "KB-CE-0502", "KB-CE-0503", "KB-CE-0504", "KB-CE-0505"]
SEED_OPENING = {"C-1001": 16200, "C-1002": 7800, "C-1003": 67500}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}
FONTS = ["Fraunces", "IBM Plex Sans", "IBM Plex Sans Condensed", "IBM Plex Mono"]

HTTP_S = 60
POLL_S = 0.25
SETTLE_MS = 1000
WAIT_S = 90
COPY_START_S = 120
STOP_S = 20
SEARCH_SPAN = 60
RACE_EXTRA = 3
TAB_PRESSES = 8
FUTURE_DAYS = 400
ADOPT_CENTS = 2500
EXIF_MAKE_TAG = 0x010F
EXIF_ORIENTATION_TAG = 0x0112
SEED_C1, SEED_C2, SEED_C3 = "C-1001", "C-1002", "C-1003"
LARK, FERN = "larkspur", "ferncliff"
SEED_PRICE_LIST = "PL-2024-01"
UNKNOWN_CONTRACT = "C-999999"
UNKNOWN_PAYMENT = "P-NOPE"
SOURCE_PROBES = ["/.env", "/package.json", "/package-lock.json", "/run.json", "/tsconfig.json", "/src/main.ts", "/src/index.ts", "/src/server.ts"]
BRASS_TOL = 24
PAPER_TOL = 12
WRONG_DEVICE_TIME = dt.datetime(2031, 6, 1, 12, 0, tzinfo=dt.timezone.utc)
STALE_DEVICE_TIME = dt.datetime(2020, 1, 1, 12, 0, tzinfo=dt.timezone.utc)
DST_SAT_USABLE_BEFORE = "2026-11-02T22:00:00Z"
DST_SAT_BILLING_BEFORE = "2026-11-03T06:00:00Z"
DST_MON_USABLE_BEFORE = "2026-11-02T22:58:00Z"
MONTH_END_USABLE_BEFORE = "2027-02-01T06:00:00Z"
CUTOFF_LEAD_S = 8
CUTOFF_UI_LEAD_S = 20
MIDNIGHT_LEAD_S = 10
COPY_LEAD_S = 60

URL_ENV = {
    "killbill-down": "APP_KILLBILL_DOWN_URL",
    "minio-down": "APP_MINIO_DOWN_URL",
    "clock-hold": "APP_CLOCK_HOLD_URL",
    "clock-dst-sat": "APP_CLOCK_DST_SAT_URL",
    "clock-dst-mon": "APP_CLOCK_DST_MON_URL",
    "clock-midnight": "APP_CLOCK_MIDNIGHT_URL",
    "clock-cutoff": "APP_CLOCK_CUTOFF_URL",
    "clock-month-end": "APP_CLOCK_MONTH_END_URL",
    "clock-cutoff-ui": "APP_CLOCK_CUTOFF_UI_URL",
}
COPY_ENV = {
    "clock-dst-sat": {"BELLROLL_CLOCK_START": "2026-10-31T21:30:00Z", "DATABASE_URL": "${DATABASE_URL}_dst_sat", "S3_BUCKET": "${S3_BUCKET}-dst-sat", "KILLBILL_API_KEY": "bellroll-dst-sat-8a41", "KILLBILL_API_SECRET": "bellroll-dst-sat-secret-2c77"},
    "clock-dst-mon": {"BELLROLL_CLOCK_START": "2026-11-02T22:30:00Z", "DATABASE_URL": "${DATABASE_URL}_dst_mon", "S3_BUCKET": "${S3_BUCKET}-dst-mon", "KILLBILL_API_KEY": "bellroll-dst-mon-51c9", "KILLBILL_API_SECRET": "bellroll-dst-mon-secret-9e03"},
    "clock-midnight": {"BELLROLL_CLOCK_START": "2026-11-01T04:59:30Z", "DATABASE_URL": "${DATABASE_URL}_midnight", "S3_BUCKET": "${S3_BUCKET}-midnight", "KILLBILL_API_KEY": "bellroll-midnight-7d2e", "KILLBILL_API_SECRET": "bellroll-midnight-secret-40ab"},
    "clock-cutoff": {"BELLROLL_CLOCK_START": "2026-11-04T22:59:40Z", "DATABASE_URL": "${DATABASE_URL}_cutoff", "S3_BUCKET": "${S3_BUCKET}-cutoff", "KILLBILL_API_KEY": "bellroll-cutoff-a6f1", "KILLBILL_API_SECRET": "bellroll-cutoff-secret-13d8"},
    "clock-month-end": {"BELLROLL_CLOCK_START": "2027-01-31T18:00:00Z", "DATABASE_URL": "${DATABASE_URL}_month_end", "S3_BUCKET": "${S3_BUCKET}-month-end", "KILLBILL_API_KEY": "bellroll-month-end-c3b7", "KILLBILL_API_SECRET": "bellroll-month-end-secret-6f52"},
    "clock-cutoff-ui": {"BELLROLL_CLOCK_START": "2026-11-04T22:59:10Z", "DATABASE_URL": "${DATABASE_URL}_cutoff_ui", "S3_BUCKET": "${S3_BUCKET}-cutoff-ui", "KILLBILL_API_KEY": "bellroll-cutoff-ui-3d17", "KILLBILL_API_SECRET": "bellroll-cutoff-ui-secret-5e90"},
}

USERS = {
    "owner": ("owner@keelandbell.example", "brass-owner-2026"),
    "tech": ("tech@keelandbell.example", "brass-tech-2026"),
    "dir_l": ("cmarrow@larkspur.example", "baton-larkspur-2026"),
    "dir_f": ("tibarra@ferncliff.example", "baton-ferncliff-2026"),
    "F-01": ("robin.alder@example.com", "family-alder-2026"),
    "F-02": ("sam.brandt@example.com", "family-brandt-2026"),
    "F-03": ("lee.castellanos@example.com", "family-castellanos-2026"),
    "F-04": ("avery.dunmore@example.com", "family-dunmore-2026"),
}
NAMES = {"owner": "Dana Whitlock", "tech": "Ira Penhallow", "dir_l": "Celia Marrow", "dir_f": "Tomás Ibarra",
         "F-01": "Robin Alder", "F-02": "Sam Brandt", "F-03": "Lee Castellanos", "F-04": "Avery Dunmore"}
ROLES = {"owner": "owner", "tech": "tech", "dir_l": "director", "dir_f": "director",
         "F-01": "parent", "F-02": "parent", "F-03": "parent", "F-04": "parent"}
SCHOOL_NAMES = {"larkspur": "Larkspur Middle School", "ferncliff": "Ferncliff Elementary"}


def ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(t: dt.datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def day(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def store_date(t: dt.datetime) -> dt.date:
    return t.astimezone(STORE_TZ).date()


def fmt_date(d: dt.date) -> str:
    return f"{d:%B} {d.day}, {d.year}"


def fmt_dt(t: dt.datetime) -> str:
    loc = t.astimezone(STORE_TZ)
    hour = loc.hour % 12 or 12
    return f"{fmt_date(loc.date())}, {hour}:{loc.minute:02d} {'AM' if loc.hour < 12 else 'PM'} {loc.tzname()}"


def money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}${cents // 100:,}.{cents % 100:02d}"


def pct(bp: int) -> str:
    return f"{bp // 100}.{bp % 100:02d}%"


def rdiv(n: int, d: int) -> int:
    return (2 * n + d) // (2 * d)


def cutoff_for(d: dt.date) -> str:
    return iso(dt.datetime.combine(d - dt.timedelta(days=1), dt.time(CUTOFF_HOUR), tzinfo=STORE_TZ))


def add_months(anchor: dt.date, k: int) -> dt.date:
    y, m = divmod(anchor.month - 1 + k, 12)
    y, m = anchor.year + y, m + 1
    return dt.date(y, m, min(anchor.day, calendar.monthrange(y, m)[1]))


def split(amount: int, base: int, waiver: int, bp: int) -> tuple[int, int, int]:
    t = rdiv((base + waiver) * bp, 10000)
    total = base + waiver + t
    tax, wv = rdiv(amount * t, total), rdiv(amount * waiver, total)
    return amount - tax - wv, wv, tax


def contract_split(c: dict, amount: int) -> tuple[int, int, int]:
    t = c["terms"]
    return split(amount, t["base_rent_cents"], t["waiver_cents"] if c["waiver"] else 0, t["tax_rate_bp"])


def amount_for_base(c: dict, target: int) -> int:
    t = c["terms"]
    b, w = t["base_rent_cents"], (t["waiver_cents"] if c["waiver"] else 0)
    guess = target * (b + w + rdiv((b + w) * t["tax_rate_bp"], 10000)) // b
    for a in range(max(1, guess - SEARCH_SPAN), guess + SEARCH_SPAN):
        if contract_split(c, a)[0] == target:
            return a
    raise AssertionError(f"no amount gives base part {target}")


def label_of(itype: str, size: str) -> str:
    return itype.capitalize() if size == "full" else f"{size} {itype.capitalize()}"


def band_of(width: int) -> str:
    return next(name for lo, hi, name in BANDS if lo <= width <= hi)


def unescape_pdf(raw: bytes) -> str:
    return raw.decode("latin-1").replace("\\(", "(").replace("\\)", ")").replace("\\\\", "\\")


def eventually(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    end = time.monotonic() + seconds
    while True:
        got = fn()
        if got:
            return got
        assert time.monotonic() < end, f"timed out after {seconds}s waiting for {what}"
        threading.Event().wait(POLL_S)


def login(base: str, who: str) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=HTTP_S)
    email, password = USERS[who]
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, (who, r.status_code, r.text)
    return c


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, (r.status_code, r.text)
    body = r.json()
    extra = set(body) - {"error"}
    assert "error" in body and extra <= {"fields", "alternatives", "quote", "photo_index"}, body
    e = {**body["error"], **{k: body[k] for k in extra}}
    assert e["code"] == code and isinstance(e["message"], str) and e["message"], body
    return e


def keyed(key: str | None = None) -> dict:
    return {"Idempotency-Key": key or idempotency_key()}


def route(path: str) -> str:
    return "**" + path


def get_contract(c: httpx.Client, cid: str) -> dict:
    r = c.get(f"/api/contracts/{cid}")
    assert r.status_code == 200, r.text
    return r.json()["contract"]


def ledger(c: httpx.Client, cid: str) -> dict:
    r = c.get(f"/api/contracts/{cid}/equity")
    assert r.status_code == 200, r.text
    return r.json()


def instruments(owner: httpx.Client) -> dict[str, dict]:
    return {i["serial"]: i for i in owner.get("/api/instruments").json()["instruments"]}


def available(c: httpx.Client, itype: str, size: str) -> int:
    return next(i["available"] for i in c.get("/api/availability").json()["items"]
                if (i["instrument_type"], i["size"]) == (itype, size))


def schools(c: httpx.Client) -> dict:
    return c.get("/api/schools").json()


def school(body: dict, sid: str) -> dict:
    return next(s for s in body["schools"] if s["id"] == sid)


def server_now(c: httpx.Client) -> dt.datetime:
    return ts(schools(c)["server_now"])


def wait_server(c: httpx.Client, instant: dt.datetime) -> None:
    eventually(lambda: server_now(c) >= instant, WAIT_S, f"server clock to reach {iso(instant)}")


def family(c: httpx.Client) -> dict:
    return c.get("/api/family").json()


def reserve(c: httpx.Client, sid: str, itype: str, size: str, waiver: bool = False) -> httpx.Response:
    return c.post("/api/reservations", json={"student_id": sid, "instrument_type": itype, "size": size, "waiver": waiver})


def pay(c: httpx.Client, cid: str, amount: Any, key: str | None = None) -> httpx.Response:
    return c.post(f"/api/contracts/{cid}/payments", json={"amount_cents": amount}, headers=keyed(key))


def reverse(c: httpx.Client, cid: str, pid: str, reason: str = "returned_check", key: str | None = None) -> httpx.Response:
    return c.post(f"/api/contracts/{cid}/payments/{pid}/reversal", json={"reason": reason}, headers=keyed(key))


def exchange(c: httpx.Client, cid: str, size: str, key: str | None = None) -> httpx.Response:
    return c.post(f"/api/contracts/{cid}/exchange", json={"size": size}, headers=keyed(key))


def buyout(c: httpx.Client, cid: str, expected: Any, key: str | None = None) -> httpx.Response:
    return c.post(f"/api/contracts/{cid}/buyout", json={"expected_payoff_cents": expected}, headers=keyed(key))


def quote_now(c: httpx.Client, cid: str) -> dict:
    m = get_contract(c, cid)["contract_month"]
    r = c.get(f"/api/contracts/{cid}/quote", params={"month": m})
    assert r.status_code == 200, r.text
    return r.json()["quote"]


def quotes(c: httpx.Client, cid: str) -> list[dict]:
    r = c.get(f"/api/contracts/{cid}/quotes")
    assert r.status_code == 200, r.text
    return r.json()["quotes"]


def new_serial() -> str:
    return "T-" + uuid.uuid4().hex[:12].upper()


def add_instrument(owner: httpx.Client, itype: str, size: str) -> str:
    serial = new_serial()
    r = owner.post("/api/instruments", json={"serial": serial, "instrument_type": itype, "size": size, "model": "Probe model"})
    assert r.status_code == 201, r.text
    return serial


def add_student(owner: httpx.Client, fam: str, sid: str, name: str | None = None, grade: int = 6) -> dict:
    name = name or f"Probe {uuid.uuid4().hex[:10]}"
    r = owner.post("/api/students", json={"family_id": fam, "school_id": sid, "name": name, "grade": grade})
    assert r.status_code == 201, r.text
    return r.json()["student"]


def student_contracts(parent: httpx.Client, sid: str) -> list[dict]:
    return next(s["contracts"] for s in family(parent)["students"] if s["id"] == sid)


def upload(c: httpx.Client, cid: str, photos: list[tuple[str, bytes, str]], kind: str = "checkout", notes: str | None = "Probe notes") -> httpx.Response:
    parts: list[Any] = [("kind", (None, kind))]
    if notes is not None:
        parts.append(("notes", (None, notes)))
    parts += [("photos", (name, content, ctype)) for name, content, ctype in photos]
    return c.post(f"/api/contracts/{cid}/condition-events", files=parts)


def kb_txs(killbill: KillBill, external_key: str, kind: str) -> list[dict]:
    p = killbill.payment_by_key(external_key)
    if not p:
        return []
    return [t for t in p.get("transactions", []) if t.get("transactionType") == kind and t.get("status") == "SUCCESS"]


def kb_amount(t: dict) -> Decimal:
    return Decimal(str(t["amount"]))


def dollars(cents: int) -> Decimal:
    return Decimal(cents) / 100


def kb_subscription_states(killbill: KillBill, cid: str) -> list[str]:
    acc = killbill.account_by_key(cid)
    return [s["state"] for s in killbill.subscriptions(acc["accountId"])] if acc else []


def subject(m: dict) -> str:
    return m.get("Subject", "")


def mails(mail: Mailpit, pred: Callable[[dict], bool], count: int = 1, seconds: float = MAIL_S) -> list[dict]:
    def found() -> list[dict] | None:
        hits = [m for m in mail.messages() if pred(m)]
        return hits if len(hits) >= count else None
    eventually(found, seconds, "email")
    return [m for m in mail.messages() if pred(m)]


TOKEN_RE = re.compile(r"/sign/([A-Za-z0-9_\-.~]+)")


def signing_tokens(mail: Mailpit, student_name: str, count: int = 1) -> list[str]:
    ms = mails(mail, lambda m: subject(m).startswith("Sign your rental agreement — ") and student_name in subject(m), count)
    return [TOKEN_RE.search(text(m)).group(1) for m in ms]


def make_contract(base: str, mail: Mailpit, *, family_id: str = "F-01", school_id: str = "larkspur", itype: str = "violin",
                  size: str = "1/4", waiver: bool = True, stage: str = "active", full_name: str | None = None) -> SimpleNamespace:
    owner, parent = login(base, "owner"), login(base, family_id)
    add_instrument(owner, itype, size)
    student = add_student(owner, family_id, school_id)
    r = reserve(parent, student["id"], itype, size, waiver)
    assert r.status_code == 201, r.text
    cid = r.json()["contract"]["id"]
    deal = SimpleNamespace(base=base, owner=owner, parent=parent, family=family_id, student=student, id=cid, token=None)
    if stage != "reserved":
        r = owner.post(f"/api/contracts/{cid}/signing-link", json={})
        assert r.status_code == 201, r.text
        deal.token = signing_tokens(mail, student["name"])[0]
    if stage in ("signed", "active"):
        r = httpx.post(f"{base}/api/signing/{deal.token}", json={"full_name": full_name or NAMES[family_id], "agree": True}, timeout=HTTP_S)
        assert r.status_code == 200, r.text
    if stage == "active":
        r = owner.post(f"/api/contracts/{cid}/activate", json={})
        assert r.status_code == 200, r.text
    deal.contract = get_contract(owner, cid)
    return deal


def outage_url(oid: str) -> str:
    return os.environ[URL_ENV[oid]].rstrip("/")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    env = dict(os.environ)
    for k, v in overrides.items():
        env[k] = re.sub(r"\$\{(\w+)\}", lambda m: os.environ[m.group(1)], v)
    port = free_port()
    env["APP_PUBLIC_PORT"] = str(port)
    env.pop("APP_PUBLIC_URL", None)
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile(prefix="bellroll-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=str(DEPLOYED_APP), env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    def healthy() -> bool:
        assert proc.poll() is None, f"app copy exited:\n{tail()}"
        try:
            return httpx.get(base + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        eventually(healthy, COPY_START_S, f"app copy health; log:\n{tail()}")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=STOP_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        log.close()


@contextlib.contextmanager
def clock_instance(oid: str, usable_before: dt.datetime, copy_start: dt.datetime | None = None) -> Iterator[str]:
    base = outage_url(oid)
    if server_now(login(base, "owner")) < usable_before:
        yield base
        return
    env = dict(COPY_ENV[oid])
    if copy_start is not None:
        env["BELLROLL_CLOCK_START"] = iso(copy_start)
    with app_copy(env) as copy:
        yield copy


def browser_login(page: Page, base: str, who: str) -> None:
    email, password = USERS[who]
    r = page.request.post(f"{base}/api/session", data={"email": email, "password": password})
    assert r.status == 200, r.text()


@contextlib.contextmanager
def signed_in(browser: Browser, base: str, who: str | None, path: str, *, size: Any = "wide", reduced: bool = False,
              no_webgl: bool = False, device_time: dt.datetime | None = None, init_script: str | None = None) -> Iterator[Page]:
    with open_app(browser, f"{base}/", reduced_motion="reduce" if reduced else "no-preference", no_webgl=no_webgl) as page:
        w, h = VIEWPORTS[size] if isinstance(size, str) else size
        page.set_viewport_size({"width": w, "height": h})
        if device_time:
            page.clock.set_system_time(device_time)
        if init_script:
            page.add_init_script(init_script)
        if who:
            browser_login(page, base, who)
        page.goto(f"{base}{path}")
        yield page


def sheet(page: Page) -> None:
    expect(page.get_by_role("group", name="Contract header")).to_be_visible()
    advance(page, SETTLE_MS)


def ui_sign_in(page: Page, who: str) -> None:
    email, password = USERS[who]
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), password)
    click(page.get_by_role("button", name="Sign in"))


def assert_focus_ring(locator: Any) -> None:
    rest, focus = state_styles(locator, "outline-style", "outline-width", "box-shadow", state="focus")
    width = float(re.sub(r"[^0-9.]", "", focus.get("outline-width", "0")) or 0)
    outline = focus.get("outline-style") not in (None, "", "none") and width >= FOCUS_RING_PX
    shadow = focus.get("box-shadow") not in (None, "", "none", rest.get("box-shadow"))
    assert outline or shadow, (rest, focus)


def angle_of(model: Any) -> int:
    desc = model.evaluate("el => { const ids = (el.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean); return ids.map(i => document.getElementById(i)?.textContent || '').join(' ') || el.getAttribute('aria-description') || ''; }")
    m = re.search(r"Turned (\d+) degrees\. Left and Right arrow keys turn it\.", desc)
    assert m, desc
    return int(m.group(1))


def wait_successor(page: Page, old_id: str) -> str:
    page.wait_for_url(lambda u: urlparse(u).path.startswith("/contracts/") and urlparse(u).path != f"/contracts/{old_id}")
    return urlparse(page.url).path.rsplit("/", 1)[1]


TRACK_JS = """(e, t) => {
  const seen = window.__gfTrack || (window.__gfTrack = new Map());
  for (const a of document.getAnimations()) {
    if (!seen.has(a)) { seen.set(a, a.currentTime ?? 0); a.pause(); }
    a.currentTime = seen.get(a) + t;
  }
  const r = e.getBoundingClientRect();
  let opacity = 1;
  for (let n = e; n && n.nodeType === 1; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
  return {t, x: r.x, y: r.y, width: r.width, height: r.height, opacity};
}"""


def track(page: Page, locator: Locator, duration_ms: float, samples: int) -> list[dict]:
    handle, step = locator.element_handle(), duration_ms / samples
    out = [handle.evaluate(TRACK_JS, 0)]
    for i in range(1, samples + 1):
        advance(page, step)
        out.append(handle.evaluate(TRACK_JS, step * i))
    page.evaluate("() => { for (const a of (window.__gfTrack || new Map()).keys()) { try { a.finish(); } catch (_) {} }"
                  " window.__gfTrack = null; }")
    return out


def _box(s: dict) -> tuple[float, float, float, float]:
    return s.get("x", s.get("left")), s.get("y", s.get("top")), s.get("width"), s.get("height")


def _t(s: dict) -> float:
    return s.get("t", s.get("time", 0.0))


def png_rgb(payload: bytes) -> Image.Image:
    return Image.open(io.BytesIO(payload)).convert("RGB")


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png_bytes(w: int, h: int, total: int | None = None) -> bytes:
    raw = b"".join(b"\x00" + os.urandom(3 * w) for _ in range(h))
    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    body = chunk(b"IDAT", zlib.compress(raw, 0 if total else 9)) + chunk(b"IEND", b"")
    if total is None:
        return head + body
    pad = total - len(head) - len(body) - 12
    assert pad > 8
    return head + chunk(b"tEXt", b"Comment\x00" + b"x" * (pad - 8)) + body


def pil_bytes(fmt: str, w: int, h: int, exif: bool = False) -> bytes:
    im = Image.new("RGB", (w, h), (120, 80, 40))
    buf = io.BytesIO()
    if exif:
        e = Image.Exif()
        e[EXIF_MAKE_TAG] = "ProbeCam"
        e[EXIF_ORIENTATION_TAG] = 6
        im.save(buf, fmt, exif=e.tobytes())
    else:
        im.save(buf, fmt)
    return buf.getvalue()


SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def good_photos() -> list[tuple[str, bytes, str]]:
    return [("front.jpg", pil_bytes("JPEG", 64, 48), "image/jpeg"), ("side.png", png_bytes(40, 30), "image/png"),
            ("back.webp", pil_bytes("WEBP", 32, 24), "image/webp")]


def condition_keys(cid: str, bucket: S3 | None = None) -> set[str]:
    return set((bucket or S3()).keys(f"contracts/{cid}/condition/"))


def test_reserve_assigns_first_serial(app_url):
    owner, parent = login(app_url, "owner"), login(app_url, "F-04")
    add_instrument(owner, "trumpet", "full")
    student = add_student(owner, "F-04", "larkspur")
    before = available(parent, "trumpet", "full")
    expected = min(s for s, i in instruments(owner).items() if i["instrument_type"] == "trumpet" and i["status"] == "available")
    r = reserve(parent, student["id"], "trumpet", "full")
    assert r.status_code == 201, r.text
    c = r.json()["contract"]
    assert c["status"] == "reserved" and c["student"]["id"] == student["id"]
    assert c["instrument"]["serial"] == expected and c["instrument"]["label"] == "Trumpet"
    assert re.fullmatch(r"C-\d+", c["id"]) and int(c["id"][2:]) >= FIRST_CONTRACT_NO
    assert ts(c["hold_expires_at"]) - ts(c["history"][0]["at"]) == dt.timedelta(seconds=HOLD_DEFAULT_S)
    today = parent.get("/api/price-lists/current").json()["price_list"]
    item = next(i for i in today["items"] if i["instrument_type"] == "trumpet")
    assert c["terms"]["bound"] is False and c["terms"]["price_list_id"] == today["id"]
    assert c["terms"]["base_rent_cents"] == item["base_rent_cents"]
    assert available(parent, "trumpet", "full") == before - 1
    inst = instruments(owner)[expected]
    assert inst["status"] == "on_contract" and inst["contract_id"] == c["id"]
    stranger = add_student(owner, "F-03", "larkspur")
    err(reserve(parent, stranger["id"], "trumpet", "full"), 404, "not_found")
    err(reserve(parent, student["id"], "trumpet", "1/2"), 409, "student_has_instrument")
    fresh = add_student(owner, "F-04", "larkspur")
    err(reserve(parent, fresh["id"], "trumpet", "3/4"), 422, "validation_failed")
    assert student_contracts(parent, fresh["id"]) == []
    assert student_contracts(login(app_url, "F-03"), stranger["id"]) == []


def test_last_unit_race(app_url):
    owner, parent = login(app_url, "owner"), login(app_url, "F-02")
    add_instrument(owner, "cello", "3/4")
    add_instrument(owner, "cello", "4/4")
    left = available(parent, "cello", "3/4")
    racers = [add_student(owner, "F-02", "ferncliff") for _ in range(left + RACE_EXTRA)]
    with ThreadPoolExecutor(len(racers)) as pool:
        results = list(pool.map(lambda s: reserve(parent, s["id"], "cello", "3/4"), racers))
    wins = [r for r in results if r.status_code == 201]
    losses = [r for r in results if r.status_code != 201]
    assert len(wins) == left and len(losses) == RACE_EXTRA, [r.status_code for r in results]
    for r in losses:
        err(r, 409, "unavailable")
        alts = (lambda b: b["error"].get("alternatives", b.get("alternatives")))(r.json())
        sizes = [a["size"] for a in alts]
        assert all(a["instrument_type"] == "cello" and a["available"] >= 1 for a in alts), alts
        assert "3/4" not in sizes and "4/4" in sizes and sizes == [s for s in CELLO_SIZES if s in sizes]
    serials = [r.json()["contract"]["instrument"]["serial"] for r in wins]
    assert len(set(serials)) == len(serials)
    fleet = instruments(owner)
    for r in wins:
        c = r.json()["contract"]
        assert fleet[c["instrument"]["serial"]]["contract_id"] == c["id"]
    summaries = owner.get("/api/contracts").json()["contracts"]
    for s in serials:
        assert sum(1 for c in summaries if c["serial"] == s and c["status"] in OPEN) == 1
    assert available(parent, "cello", "3/4") == 0


def test_reservation_delivery_day(mail):
    with clock_instance("clock-dst-mon", ts(DST_MON_USABLE_BEFORE)) as base:
        owner, parent = login(base, "owner"), login(base, "F-04")
        add_instrument(owner, "flute", "full")
        s = add_student(owner, "F-04", LARK)
        r = reserve(parent, s["id"], "flute", "full")
        assert r.status_code == 201, r.text
        assert r.json()["contract"]["delivery_date"] == "2026-11-03"
    cutoff = ts("2026-11-04T23:00:00Z")
    with clock_instance("clock-cutoff", cutoff - dt.timedelta(seconds=CUTOFF_LEAD_S), cutoff - dt.timedelta(seconds=COPY_LEAD_S)) as base:
        owner, parent = login(base, "owner"), login(base, "F-04")
        add_instrument(owner, "violin", "1/2")
        add_instrument(owner, "violin", "1/2")
        s1, s2 = add_student(owner, "F-04", FERN), add_student(owner, "F-04", FERN)
        assert server_now(parent) < cutoff
        r1 = reserve(parent, s1["id"], "violin", "1/2")
        assert r1.status_code == 201 and r1.json()["contract"]["delivery_date"] == "2026-11-05"
        wait_server(owner, cutoff)
        r2 = reserve(parent, s2["id"], "violin", "1/2")
        assert r2.status_code == 201 and r2.json()["contract"]["delivery_date"] == "2026-11-12"
        assert get_contract(owner, r1.json()["contract"]["id"])["delivery_date"] == "2026-11-05"


def test_delivery_notice_delivery_day(mail):
    cutoff = ts("2026-11-04T23:00:00Z")
    with clock_instance("clock-cutoff", cutoff - dt.timedelta(seconds=CUTOFF_LEAD_S), cutoff - dt.timedelta(seconds=COPY_LEAD_S)) as base:
        owner = login(base, "owner")
        listing = schools(owner)
        assert ts(listing["server_now"]) < cutoff
        fern = school(listing, FERN)
        assert fern["next_delivery_date"] == "2026-11-05" and fern["cutoff_at"] == "2026-11-04T23:00:00Z"
        wait_server(owner, cutoff)
        fern = school(schools(owner), FERN)
        days = [day(d["date"]) for d in fern["upcoming_delivery_days"]]
        assert fern["next_delivery_date"] == "2026-11-12" and fern["upcoming_delivery_days"][0]["date"] == "2026-11-12"
        assert days == [days[0] + dt.timedelta(weeks=i) for i in range(4)]
        assert all(d["cutoff_at"] == cutoff_for(day(d["date"])) for d in fern["upcoming_delivery_days"])


def test_delivery_notice_after_cutoff(mail):
    cutoff = ts("2026-11-04T23:00:00Z")
    with clock_instance("clock-cutoff", cutoff - dt.timedelta(seconds=CUTOFF_LEAD_S), cutoff - dt.timedelta(seconds=COPY_LEAD_S)) as base:
        owner = login(base, "owner")
        notice = lambda: owner.post(f"/api/schools/{FERN}/delivery-notice", json={"delivery_date": "2026-11-05"})
        assert server_now(owner) < cutoff
        r = notice()
        assert r.status_code == 202, r.text
        assert r.json()["recipient"] == USERS["dir_f"][0] and r.json()["delivery_date"] == "2026-11-05"
        wait_server(owner, cutoff)
        e = err(notice(), 422, "validation_failed")
        assert "delivery_date" in e["fields"]


def test_delivery_days_across_dst():
    with clock_instance("clock-dst-sat", ts(DST_SAT_USABLE_BEFORE)) as base:
        body = schools(login(base, "dir_l"))
        assert [s["id"] for s in body["schools"]] == ["larkspur", "ferncliff"]
        lark, fern = school(body, "larkspur"), school(body, "ferncliff")
        assert [d["date"] for d in lark["upcoming_delivery_days"]] == ["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]
        assert lark["next_delivery_date"] == "2026-11-03" and lark["cutoff_at"] == "2026-11-02T23:00:00Z"
        assert fern["next_delivery_date"] == "2026-11-05" and fern["cutoff_at"] == "2026-11-04T23:00:00Z"
        assert len(fern["upcoming_delivery_days"]) == 4
        for d in lark["upcoming_delivery_days"] + fern["upcoming_delivery_days"]:
            assert d["cutoff_at"] == cutoff_for(day(d["date"])) and d["cutoff_at"].endswith("T23:00:00Z"), d


def test_delivery_notice_manifest(app_url, mail):
    owner = login(app_url, "owner")
    d = make_contract(app_url, mail, family_id="F-04", school_id="ferncliff", itype="clarinet", size="full", stage="reserved")
    c = d.contract
    when = day(c["delivery_date"])
    idle = add_student(owner, "F-04", "ferncliff")
    roster = owner.get(f"/api/schools/{FERN}/roster").json()
    manifest = [r for r in roster["students"] if r["delivery_date"] == c["delivery_date"]
                and r["delivery_status"] in ("awaiting_agreement", "scheduled", "delivered")]
    r = owner.post(f"/api/schools/{FERN}/delivery-notice", json={"delivery_date": c["delivery_date"]})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["recipient"] == USERS["dir_f"][0] and body["delivery_date"] == c["delivery_date"]
    assert body["student_count"] == len(manifest)
    m = mails(mail, lambda m: subject(m) == f"Delivery day {fmt_date(when)} — Ferncliff Elementary" and d.student["name"] in text(m))[0]
    content = text(m)
    assert addresses(m["To"]) == [USERS["dir_f"][0]]
    assert f"{d.student['name']} — {c['instrument']['label']} — {c['instrument']['serial']}" in content
    for leak in (idle["name"], NAMES["F-04"], USERS["F-04"][0], "555-0104", "3 Tannery Court", "$"):
        assert leak not in content, leak
    lines = [ln for ln in content.splitlines() if re.fullmatch(r".+ — .+ — .+", ln.strip())]
    assert len(lines) == body["student_count"]
    for bad in (when + dt.timedelta(days=1), when + dt.timedelta(days=28)):
        e = err(owner.post(f"/api/schools/{FERN}/delivery-notice", json={"delivery_date": bad.isoformat()}), 422, "validation_failed")
        assert "delivery_date" in e["fields"]
    err(login(app_url, "tech").post(f"/api/schools/{FERN}/delivery-notice", json={"delivery_date": c["delivery_date"]}), 403, "forbidden")


def test_send_signing_link(app_url, mail):
    d = make_contract(app_url, mail, stage="reserved", itype="flute", size="full")
    r = d.owner.post(f"/api/contracts/{d.id}/signing-link", json={})
    assert r.status_code == 201, r.text
    c = r.json()["contract"]
    assert c["status"] == "agreement_sent" and c["signing_link"]["status"] == "live"
    sent = ts(c["history"][-1]["at"])
    assert ts(c["signing_link"]["expires_at"]) == min(sent + dt.timedelta(seconds=LINK_TTL_DEFAULT_S), ts(c["hold_expires_at"]))
    label = c["instrument"]["label"]
    m = mails(mail, lambda m: subject(m) == f"Sign your rental agreement — {d.student['name']}, {label}")[0]
    assert addresses(m["To"]) == [USERS["F-01"][0]] and addresses(m["From"]) == [MAIL_FROM_ADDRESS]
    assert fmt_dt(ts(c["signing_link"]["expires_at"])) in text(m)
    first = TOKEN_RE.search(text(m)).group(1)
    g = httpx.get(f"{app_url}/api/signing/{first}", timeout=HTTP_S)
    assert g.status_code == 200 and g.json()["agreement"]["contract_id"] == d.id
    assert d.owner.post(f"/api/contracts/{d.id}/signing-link", json={}).status_code == 201
    tokens = set(signing_tokens(mail, d.student["name"], 2))
    second = (tokens - {first}).pop()
    err(httpx.get(f"{app_url}/api/signing/{first}", timeout=HTTP_S), 404, "link_not_found")
    assert httpx.get(f"{app_url}/api/signing/{second}", timeout=HTTP_S).status_code == 200
    h = get_contract(d.owner, d.id)["history"]
    assert [(e["from"], e["to"], e["actor"], e["actor_name"]) for e in h] == [
        (None, "reserved", "parent", NAMES["F-01"]), ("reserved", "agreement_sent", "owner", NAMES["owner"]),
        ("agreement_sent", "agreement_sent", "owner", NAMES["owner"])]
    before = get_contract(d.owner, SEED_C1)["history"]
    err(d.owner.post(f"/api/contracts/{SEED_C1}/signing-link", json={}), 409, "invalid_transition")
    assert get_contract(d.owner, SEED_C1)["history"] == before


def test_signing_link_limits(app_url, mail):
    a = make_contract(app_url, mail, stage="sent", itype="flute", size="full")
    b = make_contract(app_url, mail, stage="sent", itype="clarinet", size="full")
    g = httpx.get(f"{app_url}/api/signing/{a.token}", timeout=HTTP_S).json()["agreement"]
    assert g["contract_id"] == a.id and b.id not in json.dumps(g)
    r = b.owner.post(f"/api/contracts/{b.id}/signing-link/revoke", json={})
    assert r.status_code == 200 and r.json()["contract"]["status"] == "agreement_sent"
    assert r.json()["contract"]["signing_link"]["status"] == "revoked"
    err(httpx.get(f"{app_url}/api/signing/{b.token}", timeout=HTTP_S), 404, "link_not_found")
    err(b.owner.post(f"/api/contracts/{b.id}/signing-link/revoke", json={}), 409, "no_live_link")
    assert b.owner.post(f"/api/contracts/{b.id}/signing-link", json={}).status_code == 201
    fresh = (set(signing_tokens(mail, b.student["name"], 2)) - {b.token}).pop()
    assert httpx.get(f"{app_url}/api/signing/{fresh}", timeout=HTTP_S).status_code == 200
    r = httpx.post(f"{app_url}/api/signing/{a.token}", json={"full_name": NAMES["F-01"], "agree": True}, timeout=HTTP_S)
    assert r.status_code == 200 and r.json()["agreement"]["contract_id"] == a.id
    assert get_contract(a.owner, b.id)["status"] == "agreement_sent"
    err(httpx.get(f"{app_url}/api/signing/{a.token}", timeout=HTTP_S), 410, "link_used")
    err(httpx.post(f"{app_url}/api/signing/{a.token}", json={"full_name": NAMES["F-01"], "agree": True}, timeout=HTTP_S), 410, "link_used")


def test_signing_link_expiry(mail):
    base = outage_url("clock-hold")
    owner = login(base, "owner")
    d = make_contract(base, mail, family_id="F-03", stage="sent", itype="flute", size="full")
    c = get_contract(owner, d.id)
    sent, link_exp, hold = ts(c["history"][-1]["at"]), ts(c["signing_link"]["expires_at"]), ts(c["hold_expires_at"])
    assert sent < link_exp <= hold
    ttl = link_exp - sent
    wait_server(owner, link_exp)
    err(httpx.get(f"{base}/api/signing/{d.token}", timeout=HTTP_S), 410, "link_expired")
    err(httpx.post(f"{base}/api/signing/{d.token}", json={"full_name": NAMES["F-03"], "agree": True}, timeout=HTTP_S), 410, "link_expired")
    assert get_contract(owner, d.id)["status"] in ("agreement_sent", "expired")
    d2 = make_contract(base, mail, family_id="F-03", stage="reserved", itype="flute", size="full")
    hold2 = ts(d2.contract["hold_expires_at"])
    eventually(lambda: hold2 - server_now(owner) < ttl, WAIT_S, "hold deadline inside one link lifetime")
    r = owner.post(f"/api/contracts/{d2.id}/signing-link", json={})
    assert r.status_code == 201, r.text
    assert r.json()["contract"]["signing_link"]["expires_at"] == r.json()["contract"]["hold_expires_at"]
    token = signing_tokens(mail, d2.student["name"])[0]
    wait_server(owner, hold2)
    err(httpx.get(f"{base}/api/signing/{token}", timeout=HTTP_S), 410, "link_expired")
    assert get_contract(owner, d2.id)["status"] == "expired"


def test_sign_and_store_agreement(app_url, mail):
    bucket = S3()
    d = make_contract(app_url, mail, stage="sent", itype="cello", size="1/2", waiver=True)
    key = f"contracts/{d.id}/agreement-signed.pdf"
    r = httpx.post(f"{outage_url('minio-down')}/api/signing/{d.token}", json={"full_name": "Robin Q Alder", "agree": True}, timeout=HTTP_S)
    err(r, 503, "storage_unavailable")
    c = get_contract(d.owner, d.id)
    assert c["status"] == "agreement_sent" and c["agreement_stored"] is False and c["terms"]["bound"] is False
    assert httpx.get(f"{app_url}/api/signing/{d.token}", timeout=HTTP_S).status_code == 200
    assert key not in bucket.keys(f"contracts/{d.id}/")
    sign = lambda body: httpx.post(f"{app_url}/api/signing/{d.token}", json=body, timeout=HTTP_S)
    assert "full_name" in err(sign({"full_name": " R ", "agree": True}), 422, "validation_failed")["fields"]
    assert "agree" in err(sign({"full_name": "Robin Q Alder", "agree": False}), 422, "validation_failed")["fields"]
    r = sign({"full_name": "  Robin Q Alder  ", "agree": True})
    assert r.status_code == 200 and r.json()["agreement"]["status"] == "signed"
    c = get_contract(d.owner, d.id)
    today_list = d.owner.get("/api/price-lists/current").json()["price_list"]
    assert c["status"] == "signed" and c["terms"]["bound"] is True and c["terms"]["price_list_id"] == today_list["id"]
    assert c["agreement_stored"] is True and c["signed_at"] == r.json()["agreement"]["signed_at"]
    raw = bucket.get(key)
    assert raw.startswith(b"%PDF-")
    pdf, t = unescape_pdf(raw), c["terms"]
    wanted = [d.id, d.student["name"], c["instrument"]["serial"], c["instrument"]["label"], t["price_list_id"],
              money(t["base_rent_cents"]), money(t["waiver_cents"]), money(t["purchase_price_cents"]),
              f"Sales tax at {pct(t['tax_rate_bp'])} (the rate in force when billed applies).", f"{t['term_months']} months",
              "Robin Q Alder", fmt_dt(ts(c["signed_at"]))] + [tier["label"] for tier in t["tiers"]]
    for w in wanted:
        assert w in pdf, w


def test_activate_exactly_once(app_url, mail, killbill):
    d = make_contract(app_url, mail, stage="signed", itype="trumpet", size="full", waiver=False)
    r_ = make_contract(app_url, mail, stage="reserved", itype="flute", size="full")
    err(d.owner.post(f"/api/contracts/{r_.id}/activate", json={}), 409, "invalid_transition")
    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(lambda _: d.owner.post(f"/api/contracts/{d.id}/activate", json={}), range(5)))
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409, 409]
    for r in results:
        if r.status_code == 409:
            err(r, 409, "invalid_transition")
    c = get_contract(d.owner, d.id)
    assert c["status"] == "active" and c["subscription_state"] == "active"
    assert c["billing_anchor_date"] == store_date(ts(c["activated_at"])).isoformat()
    moves = [e for e in c["history"] if e["to"] == "active"]
    assert len(moves) == 1 and moves[0]["from"] == "signed" and moves[0]["actor"] == "owner" and moves[0]["actor_name"] == NAMES["owner"]
    assert moves[0]["at"] == c["activated_at"]
    acc = killbill.account_by_key(d.id)
    assert acc and acc["currency"] == "USD"
    subs = killbill.subscriptions(acc["accountId"])
    assert len(subs) == 1 and subs[0]["externalKey"] == f"{d.id}-rental" and subs[0]["state"] != "CANCELLED"
    assert subs[0].get("planName") == "bellroll-rental-monthly"


def test_invoice_lines_exact(app_url, mail):
    d = make_contract(app_url, mail, itype="cello", size="1/2", waiver=True)
    c = d.contract
    inv = d.owner.get(f"/api/contracts/{d.id}/invoice").json()["invoice"]
    assert inv["billing_date"] == c["next_billing_date"]
    anchor = day(c["billing_anchor_date"])
    later = [add_months(anchor, k) for k in range(1, 30) if add_months(anchor, k) >= day(inv["billing_date"])][:4]
    assert inv["upcoming_billing_dates"] == [x.isoformat() for x in later]
    bp = d.owner.get("/api/price-lists/current", params={"on": inv["billing_date"]}).json()["price_list"]["tax_rate_bp"]
    b, w = c["terms"]["base_rent_cents"], c["terms"]["waiver_cents"]
    assert inv["tax_rate_bp"] == bp
    assert [(ln["code"], ln["amount_cents"]) for ln in inv["lines"]] == [("base_rent", b), ("waiver", w), ("sales_tax", rdiv((b + w) * bp, 10000))]
    assert inv["total_cents"] == sum(ln["amount_cents"] for ln in inv["lines"])
    r_ = make_contract(app_url, mail, stage="reserved", itype="trumpet", size="full", waiver=False)
    inv = r_.owner.get(f"/api/contracts/{r_.id}/invoice").json()["invoice"]
    assert inv["billing_date"] is None and inv["upcoming_billing_dates"] == []
    assert [ln["code"] for ln in inv["lines"]] == ["base_rent", "sales_tax"]


def price_body(c: httpx.Client, effective: str, bp: int, rent_bump: int = 0) -> dict:
    cur = c.get("/api/price-lists/current").json()["price_list"]
    return {"effective_date": effective, "tax_rate_bp": bp,
            "items": [{"instrument_type": i["instrument_type"], "base_rent_cents": i["base_rent_cents"] + rent_bump,
                       "waiver_cents": i["waiver_cents"], "purchase_price_cents": i["purchase_price_cents"]} for i in cur["items"]],
            "tiers": [{"from_month": t["from_month"], "to_month": t["to_month"], "percent": t["percent"], "name": t["name"]} for t in cur["tiers"]]}


def test_scheduled_tax_change_and_withdrawal(mail):
    with clock_instance("clock-dst-sat", ts(DST_SAT_USABLE_BEFORE)) as base:
        owner = login(base, "owner")
        inv = lambda cid: owner.get(f"/api/contracts/{cid}/invoice")
        i1 = inv(SEED_C1).json()["invoice"]
        assert [money(ln["amount_cents"]) for ln in i1["lines"]] == ["$18.00", "$4.00", "$1.82"] and money(i1["total_cents"]) == "$23.82"
        assert i1["billing_date"] == "2026-11-04"
        assert money(inv(SEED_C2).json()["invoice"]["total_cents"]) == "$28.15"
        assert [ln["code"] for ln in inv(SEED_C2).json()["invoice"]["lines"]] == ["base_rent", "sales_tax"]
        assert money(inv(SEED_C3).json()["invoice"]["total_cents"]) == "$58.46"
        r_ = make_contract(base, mail, family_id="F-04", stage="reserved", itype="flute", size="full")
        on_raw = owner.get("/api/price-lists/current", params={"on": "2026-11-03"}).content
        c1003_raw, c1002_raw = inv("C-1003").content, inv("C-1002").content
        terms_before = get_contract(owner, r_.id)["terms"]
        r = owner.post("/api/price-lists", json=price_body(owner, "2026-11-03", 900))
        assert r.status_code == 201, r.text
        pid = r.json()["price_list"]["id"]
        assert owner.get("/api/price-lists/current", params={"on": "2026-11-03"}).json()["price_list"]["id"] == pid
        new = inv("C-1003").json()["invoice"]
        assert [money(ln["amount_cents"]) for ln in new["lines"]] == ["$45.00", "$9.00", "$4.86"] and money(new["total_cents"]) == "$58.86" and new["tax_rate_bp"] == 900
        assert inv("C-1002").content == c1002_raw
        assert get_contract(owner, r_.id)["terms"] == terms_before
        w = owner.post(f"/api/price-lists/{pid}/withdraw", json={})
        assert w.status_code == 200 and w.json()["price_list"]["withdrawn_at"]
        err(owner.post(f"/api/price-lists/{pid}/withdraw", json={}), 409, "price_list_withdrawn")
        assert owner.get("/api/price-lists/current", params={"on": "2026-11-03"}).content == on_raw
        assert inv("C-1003").content == c1003_raw
        assert get_contract(owner, r_.id)["terms"] == terms_before
        err(owner.post(f"/api/price-lists/{SEED_PRICE_LIST}/withdraw", json={}), 409, "price_list_in_force")


def test_price_lists_at_store_midnight():
    midnight = ts("2026-11-01T05:00:00Z")
    with clock_instance("clock-midnight", midnight - dt.timedelta(seconds=MIDNIGHT_LEAD_S)) as base:
        owner = login(base, "owner")
        assert server_now(owner) < midnight
        assert owner.get(f"/api/contracts/{SEED_C1}/quote", params={"month": 0}).json()["quote"]["valid_until"] == "2026-11-07"
        p1 = owner.post("/api/price-lists", json=price_body(owner, "2026-11-01", 825)).json()["price_list"]["id"]
        p2r = owner.post("/api/price-lists", json=price_body(owner, "2026-11-01", 900))
        assert p2r.status_code == 201
        p2 = p2r.json()["price_list"]["id"]
        assert owner.get("/api/price-lists/current").json()["price_list"]["id"] not in (p1, p2)
        assert owner.post(f"/api/price-lists/{p1}/withdraw", json={}).status_code == 200
        e = err(owner.post("/api/price-lists", json=price_body(owner, "2026-10-30", 825)), 422, "validation_failed")
        assert e["fields"]["effective_date"] == "Use a date from today on, as YYYY-MM-DD."
        wait_server(owner, midnight)
        assert owner.get("/api/price-lists/current").json()["price_list"]["id"] == p2
        assert owner.get("/api/price-lists/current", params={"on": "2026-11-01"}).json()["price_list"]["id"] == p2
        err(owner.post(f"/api/price-lists/{p2}/withdraw", json={}), 409, "price_list_in_force")
        assert owner.get(f"/api/contracts/{SEED_C1}/quote", params={"month": 0}).json()["quote"]["valid_until"] == "2026-11-08"
        e = err(owner.post("/api/price-lists", json=price_body(owner, "2026-10-31", 825)), 422, "validation_failed")
        assert "effective_date" in e["fields"]


def test_price_list_validation(app_url):
    owner = login(app_url, "owner")
    before = {p["id"] for p in owner.get("/api/price-lists").json()["price_lists"]}
    body = price_body(owner, "2020-01-01", 2001)
    for it in body["items"]:
        if it["instrument_type"] == "cello":
            it["base_rent_cents"] = 50
        if it["instrument_type"] == "violin":
            it["waiver_cents"] = 10001
        if it["instrument_type"] == "trumpet":
            it["purchase_price_cents"] = 500
    body["tiers"] = [{"from_month": 0, "to_month": 3, "percent": 95, "name": "Term 1"}, {"from_month": 5, "to_month": None, "percent": 30, "name": ""}]
    f = err(owner.post("/api/price-lists", json=body), 422, "validation_failed")["fields"]
    assert f == {
        "effective_date": "Use a date from today on, as YYYY-MM-DD.",
        "tax_rate_bp": "Enter a rate from 0.00% to 20.00%.",
        "items.cello.base_rent_cents": "Enter a monthly rent from $1.00 to $1,000.00.",
        "items.violin.waiver_cents": "Enter a waiver from $0.00 to $100.00.",
        "items.trumpet.purchase_price_cents": "Enter a purchase price from $10.00 to $10,000.00, at least the monthly rent.",
        "tiers.0.percent": "Enter a whole percent from 0 to 90.",
        "tiers.1.from_month": "Start this tier the month after the previous tier ends.",
        "tiers.1.name": "Name this tier in 1 to 30 characters.",
    }
    body = price_body(owner, (store_date(server_now(owner)) + dt.timedelta(days=FUTURE_DAYS)).isoformat(), 825)
    body["items"] = body["items"][:4]
    body["tiers"] = []
    f = err(owner.post("/api/price-lists", json=body), 422, "validation_failed")["fields"]
    assert f["items"] == "Give one price for each of the five instruments." and f["tiers"] == "Add between 1 and 6 tiers."
    body = price_body(owner, (store_date(server_now(owner)) + dt.timedelta(days=FUTURE_DAYS)).isoformat(), 825)
    body["tiers"] = [{"from_month": 1, "to_month": None, "percent": 10, "name": "A"}, {"from_month": 2, "to_month": 1, "percent": 10, "name": "B"}]
    f = err(owner.post("/api/price-lists", json=body), 422, "validation_failed")["fields"]
    assert f["tiers.0.from_month"] == "The first tier starts at month 0."
    assert f["tiers.0.to_month"] == "End this tier at or after its start; only the last tier is open-ended."
    assert {p["id"] for p in owner.get("/api/price-lists").json()["price_lists"]} == before


def test_contracts_keep_signed_terms(mail):
    with clock_instance("clock-dst-mon", ts(DST_MON_USABLE_BEFORE)) as base:
        owner = login(base, "owner")
        today = store_date(server_now(owner)).isoformat()
        r = owner.post("/api/price-lists", json=price_body(owner, today, 900, rent_bump=100))
        assert r.status_code == 201, r.text
        new = r.json()["price_list"]
        c3 = get_contract(owner, "C-1003")
        t = c3["terms"]
        assert (t["price_list_id"], t["base_rent_cents"], t["purchase_price_cents"], t["term_months"]) == ("PL-2024-01", 4500, 180000, 40)
        assert [x["label"] for x in t["tiers"]] == ["Term 1, 40% off remaining", "Year 1, 30% off remaining", "After, 20% off remaining"]
        assert t["tax_rate_bp"] == 900
        inv = owner.get(f"/api/contracts/{SEED_C3}/invoice").json()["invoice"]
        assert [money(ln["amount_cents"]) for ln in inv["lines"]] == ["$45.00", "$9.00", "$4.86"] and money(inv["total_cents"]) == "$58.86"
        inv1 = owner.get(f"/api/contracts/{SEED_C1}/invoice").json()["invoice"]
        assert money(inv1["lines"][0]["amount_cents"]) == "$18.00" and money(inv1["lines"][-1]["amount_cents"]) == "$1.98"
        q = owner.get(f"/api/contracts/{SEED_C3}/quote", params={"month": 15}).json()["quote"]
        assert money(q["payoff_cents"]) == "$900.00" and q["tax_cents"] == rdiv(q["payoff_cents"] * 900, 10000)
        d = make_contract(base, mail, family_id="F-04", stage="reserved", itype="cello", size="3/4", waiver=False)
        cello = next(i for i in new["items"] if i["instrument_type"] == "cello")
        assert d.contract["terms"]["price_list_id"] == new["id"] and d.contract["terms"]["base_rent_cents"] == cello["base_rent_cents"]
        assert d.owner.post(f"/api/contracts/{d.id}/signing-link", json={}).status_code == 201
        tok = signing_tokens(mail, d.student["name"])[0]
        assert httpx.post(f"{base}/api/signing/{tok}", json={"full_name": NAMES["F-04"], "agree": True}, timeout=HTTP_S).status_code == 200
        t = get_contract(owner, d.id)["terms"]
        assert t["bound"] is True and t["price_list_id"] == new["id"] and t["base_rent_cents"] == cello["base_rent_cents"] and t["tax_rate_bp"] == 900


def test_payment_reaches_killbill_first(app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="cello", size="1/2", waiver=True)
    down_key = idempotency_key()
    err(pay(login(outage_url("killbill-down"), "owner"), d.id, 10000, down_key), 503, "billing_unavailable")
    assert ledger(d.owner, d.id)["entries"] == ledger(d.owner, d.id)["entries"] and not killbill.payment_by_key(f"{d.id}-pay-{down_key}")
    assert [e["kind"] for e in ledger(d.owner, d.id)["entries"]] == []
    key = idempotency_key()
    r = pay(d.owner, d.id, 10000, key)
    assert r.status_code == 201, r.text
    p = r.json()["payment"]
    kb = killbill.payment_by_key(f"{d.id}-pay-{key}")
    assert kb and kb["paymentId"] == p["killbill_payment_id"] and kb["accountId"] == killbill.account_by_key(d.id)["accountId"]
    tx = kb_txs(killbill, f"{d.id}-pay-{key}", "PURCHASE")
    assert len(tx) == 1 and kb_amount(tx[0]) == dollars(10000)
    eq = ledger(d.owner, d.id)
    entry = next(e for e in eq["entries"] if e["payment_id"] == p["id"])
    assert entry["kind"] == "payment" and entry["amount_cents"] == p["base_rent_cents"] and entry["reversed"] is False
    assert eq["equity_cents"] == sum(e["amount_cents"] for e in eq["entries"])
    c = get_contract(d.owner, d.id)
    msgs = mails(mail, lambda m: subject(m) == f"Payment received — {d.id}")
    assert len(msgs) == 1 and addresses(msgs[0]["To"]) == [USERS["F-01"][0]]
    body = text(msgs[0])
    for s in (money(10000), money(p["base_rent_cents"]), money(p["waiver_cents"]), money(p["tax_cents"]),
              pct(c["terms"]["tax_rate_bp"]), money(c["equity_cents"]), f"/contracts/{d.id}?month={c['contract_month']}"):
        assert s in body, s


def test_payment_split_exact(app_url, mail):
    assert split(10000, 4500, 900, 825) == (7697, 1540, 763)
    for itype, size, waiver in (("cello", "1/2", True), ("trumpet", "full", False)):
        d = make_contract(app_url, mail, itype=itype, size=size, waiver=waiver)
        for amount in (1, 2333, 10000, 5846):
            c = get_contract(d.owner, d.id)
            r = pay(d.owner, d.id, amount)
            assert r.status_code == 201, r.text
            p = r.json()["payment"]
            parts = (p["base_rent_cents"], p["waiver_cents"], p["tax_cents"])
            assert parts == contract_split(c, amount) and sum(parts) == amount == p["amount_cents"]
            assert get_contract(d.owner, d.id)["equity_cents"] == c["equity_cents"] + parts[0]
            if not waiver:
                assert p["waiver_cents"] == 0


def test_payment_retries_safe(app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="trumpet", size="full", waiver=False)
    key = idempotency_key()
    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(lambda _: pay(d.owner, d.id, 1234, key), range(5)))
    assert {r.status_code for r in results} == {201} and len({r.content for r in results}) == 1
    assert pay(d.owner, d.id, 1234, key).content == results[0].content
    assert len(kb_txs(killbill, f"{d.id}-pay-{key}", "PURCHASE")) == 1
    assert [e["kind"] for e in ledger(d.owner, d.id)["entries"]] == ["payment"]
    assert len(mails(mail, lambda m: subject(m) == f"Payment received — {d.id}")) == 1
    err(pay(d.owner, d.id, 999, key), 409, "idempotency_conflict")
    r = d.owner.post(f"/api/contracts/{d.id}/payments", json={"amount_cents": 500})
    assert "idempotency_key" in err(r, 422, "validation_failed")["fields"]
    assert len(ledger(d.owner, d.id)["entries"]) == 1 and len(kb_txs(killbill, f"{d.id}-pay-{key}", "PURCHASE")) == 1


def test_simultaneous_payments_never_overshoot(app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="violin", size="1/4", waiver=False)
    c = d.contract
    price = c["terms"]["purchase_price_cents"]
    remaining = price - c["equity_cents"]
    amount = amount_for_base(c, remaining * 3 // 5 + 1)
    keys = [idempotency_key(), idempotency_key()]
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda k: pay(d.owner, d.id, amount, k), keys))
    assert sorted(r.status_code for r in results) == [201, 422]
    loser = next(i for i, r in enumerate(results) if r.status_code == 422)
    assert err(results[loser], 422, "validation_failed")["fields"]["amount_cents"] == "exceeds_remaining"
    assert killbill.payment_by_key(f"{d.id}-pay-{keys[loser]}") is None
    assert len(kb_txs(killbill, f"{d.id}-pay-{keys[1 - loser]}", "PURCHASE")) == 1
    eq = ledger(d.owner, d.id)
    assert eq["equity_cents"] <= price and eq["equity_cents"] == sum(e["amount_cents"] for e in eq["entries"])
    c = get_contract(d.owner, d.id)
    over_key = idempotency_key()
    r = pay(d.owner, d.id, amount_for_base(c, price - c["equity_cents"] + 1), over_key)
    assert err(r, 422, "validation_failed")["fields"]["amount_cents"] == "exceeds_remaining"
    assert killbill.payment_by_key(f"{d.id}-pay-{over_key}") is None and ledger(d.owner, d.id) == eq


def test_payment_reversal(app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="cello", size="1/2", waiver=True)
    pkey = idempotency_key()
    p = pay(d.owner, d.id, 10000, pkey).json()["payment"]
    eq_before = ledger(d.owner, d.id)["equity_cents"] - p["base_rent_cents"]
    hist = get_contract(d.owner, d.id)["history"]
    err(reverse(d.owner, d.id, UNKNOWN_PAYMENT), 404, "not_found")
    rkey = idempotency_key()
    r = reverse(d.owner, d.id, p["id"], "returned_check", rkey)
    assert r.status_code == 201, r.text
    rv = r.json()["reversal"]
    assert (rv["payment_id"], rv["reason"], rv["amount_cents"], rv["base_rent_cents"], rv["waiver_cents"], rv["tax_cents"]) == (
        p["id"], "returned_check", p["amount_cents"], p["base_rent_cents"], p["waiver_cents"], p["tax_cents"])
    purchases, refunds = kb_txs(killbill, f"{d.id}-pay-{pkey}", "PURCHASE"), kb_txs(killbill, f"{d.id}-pay-{pkey}", "REFUND")
    assert len(purchases) == 1 and len(refunds) == 1 and kb_amount(refunds[0]) == kb_amount(purchases[0]) == dollars(10000)
    assert refunds[0]["transactionExternalKey"] == f"{d.id}-reversal-{p['id']}"
    eq = ledger(d.owner, d.id)
    pe = next(e for e in eq["entries"] if e["kind"] == "payment")
    re_ = next(e for e in eq["entries"] if e["kind"] == "reversal")
    assert pe["reversed"] is True and re_["payment_id"] == p["id"] and re_["amount_cents"] == -p["base_rent_cents"] and re_["reversed"] is None
    assert eq["equity_cents"] == eq_before
    assert reverse(d.owner, d.id, p["id"], "returned_check", rkey).content == r.content
    err(reverse(d.owner, d.id, p["id"], "chargeback", rkey), 409, "idempotency_conflict")
    err(reverse(d.owner, d.id, p["id"], "chargeback"), 409, "payment_reversed")
    p2 = pay(d.owner, d.id, 3000).json()["payment"]
    assert "reason" in err(reverse(d.owner, d.id, p2["id"], "bogus"), 422, "validation_failed")["fields"]
    assert len(kb_txs(killbill, f"{d.id}-pay-{pkey}", "REFUND")) == 1
    assert get_contract(d.owner, d.id)["history"] == hist
    m = mails(mail, lambda m: subject(m) == f"Payment reversed — {d.id}")
    assert len(m) == 1 and addresses(m[0]["To"]) == [USERS["F-01"][0]]
    for s in (p["id"], "Returned check", money(10000), money(p["base_rent_cents"]), money(p["waiver_cents"]), money(p["tax_cents"])):
        assert s in text(m[0]), s


def test_adopts_interrupted_killbill_charge(app_url, killbill):
    owner = login(app_url, "owner")
    assert get_contract(owner, "C-1001")["status"] == "active"
    key, other = idempotency_key(), idempotency_key()
    with app_copy({"DATABASE_URL": "${DATABASE_URL}_month_end", "S3_BUCKET": "${S3_BUCKET}-month-end"}) as twin:
        towner = login(twin, "owner")
        assert pay(towner, "C-1001", ADOPT_CENTS, key).status_code == 201
        assert pay(towner, "C-1001", ADOPT_CENTS, other).status_code == 201
    ext = f"C-1001-pay-{key}"
    assert len(kb_txs(killbill, ext, "PURCHASE")) == 1
    before = ledger(owner, "C-1001")
    r = pay(owner, "C-1001", ADOPT_CENTS, key)
    assert r.status_code == 201, r.text
    p = r.json()["payment"]
    assert len(kb_txs(killbill, ext, "PURCHASE")) == 1 and p["killbill_payment_id"] == killbill.payment_by_key(ext)["paymentId"]
    after = ledger(owner, "C-1001")
    assert len(after["entries"]) == len(before["entries"]) + 1 and after["equity_cents"] == before["equity_cents"] + p["base_rent_cents"]
    err(pay(owner, "C-1001", ADOPT_CENTS + 1, other), 409, "idempotency_conflict")
    assert ledger(owner, "C-1001") == after
    tx = kb_txs(killbill, f"C-1001-pay-{other}", "PURCHASE")
    assert len(tx) == 1 and kb_amount(tx[0]) == dollars(ADOPT_CENTS)


def test_size_exchange_pairs_equity(app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="violin", size="1/4", waiver=True)
    add_instrument(d.owner, "violin", "1/2")
    pay(d.owner, d.id, 5000)
    old = get_contract(d.owner, d.id)
    e_old = old["equity_cents"]
    totals_before = family(d.parent)["totals"]
    key = idempotency_key()
    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(lambda _: exchange(d.owner, d.id, "1/2", key), range(5)))
    assert family(d.parent)["totals"] == totals_before
    assert {r.status_code for r in results} == {201} and len({r.content for r in results}) == 1
    body = results[0].json()
    o, n = body["old_contract"], body["new_contract"]
    assert o["status"] == "exchanged" and o["successor_id"] == n["id"] and n["predecessor_id"] == d.id and n["status"] == "active"
    assert n["instrument"]["size"] == "1/2" and n["student"]["id"] == old["student"]["id"] and n["waiver"] == old["waiver"]
    for k in ("price_list_id", "base_rent_cents", "waiver_cents", "purchase_price_cents", "term_months", "tiers"):
        assert n["terms"][k] == old["terms"][k], k
    assert n["billing_anchor_date"] == old["billing_anchor_date"] and n["signed_at"] == old["signed_at"]
    lo, ln = ledger(d.owner, d.id), ledger(d.owner, n["id"])
    out = [e for e in lo["entries"] if e["kind"] == "exchange_out"]
    inn = [e for e in ln["entries"] if e["kind"] == "exchange_in"]
    assert len(out) == len(inn) == 1 and out[0]["amount_cents"] == -e_old and inn[0]["amount_cents"] == e_old
    assert out[0]["transfer_id"] == inn[0]["transfer_id"] == body["transfer_id"]
    assert lo["equity_cents"] + ln["equity_cents"] == e_old and lo["closed"] is True
    assert [h["to"] for h in get_contract(d.owner, d.id)["history"]].count("exchanged") == 1
    assert [(h["from"], h["to"], h["actor"]) for h in n["history"]] == [(None, "active", "owner")]
    assert set(kb_subscription_states(killbill, d.id)) == {"CANCELLED"}
    assert kb_subscription_states(killbill, n["id"]) == ["ACTIVE"]
    bucket = S3()
    assert bucket.get(f"contracts/{n['id']}/agreement-signed.pdf") == bucket.get(f"contracts/{d.id}/agreement-signed.pdf")
    fleet = instruments(d.owner)
    assert fleet[old["instrument"]["serial"]]["status"] == "available" and fleet[n["instrument"]["serial"]]["contract_id"] == n["id"]
    err(exchange(d.owner, d.id, "3/4"), 409, "invalid_transition")
    assert "size" in err(exchange(d.owner, n["id"], "1/4"), 422, "validation_failed")["fields"]
    assert get_contract(d.parent, d.id)["successor_id"] == n["id"]


def test_payoff_quotes(app_url, mail):
    with clock_instance("clock-dst-sat", ts(DST_SAT_BILLING_BEFORE)) as base:
        owner = login(base, "owner")
        q = lambda cid, m: owner.get(f"/api/contracts/{cid}/quote", params={"month": m}).json()["quote"]
        q9 = q(SEED_C1, 9)
        assert (money(q9["payoff_cents"]), money(q9["tax_cents"]), money(q9["total_cents"])) == ("$264.60", "$21.83", "$286.43")
        assert q9["equity_cents"] == 16200
        assert q9["tier"] == {"label": "Year 1, 30% off remaining", "percent": 30} and q9["paid"] is True
        assert q9["valid_until"] == (store_date(server_now(owner)) + dt.timedelta(days=7)).isoformat()
        assert money(q(SEED_C1, 12)["payoff_cents"]) == "$226.80"
        q13 = q(SEED_C1, 13)
        assert money(q13["payoff_cents"]) == "$244.80" and q13["tier"]["percent"] == 20 and q13["paid"] is False
        assert q(SEED_C1, 3)["equity_cents"] == 3 * 1800
        assert money(q(SEED_C2, 3)["payoff_cents"]) == "$452.40"
        q15 = q(SEED_C3, 15)
        assert (money(q15["payoff_cents"]), money(q15["tax_cents"]), money(q15["total_cents"])) == ("$900.00", "$74.25", "$974.25")
        table = quotes(owner, "C-1001")
        term = -(-54000 // 1800)
        assert [x["month"] for x in table] == list(range(term + 1)) and table[9] == q9
        for bad in (term + 1, -1, "x"):
            assert "month" in err(owner.get(f"/api/contracts/{SEED_C1}/quote", params={"month": bad}), 422, "validation_failed")["fields"]
    r_ = make_contract(app_url, mail, stage="reserved", itype="flute", size="full")
    err(r_.owner.get(f"/api/contracts/{r_.id}/quote", params={"month": 0}), 409, "no_quote")
    err(r_.owner.get(f"/api/contracts/{r_.id}/quotes"), 409, "no_quote")


def test_all_or_nothing_buyout(app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="violin", size="1/4", waiver=True)
    pay(d.owner, d.id, 3000)
    c = get_contract(d.parent, d.id)
    q = quote_now(d.parent, d.id)
    tier = next(t for t in c["terms"]["tiers"] if t["from_month"] <= q["month"] and (t["to_month"] is None or q["month"] <= t["to_month"]))
    assert q["discount_cents"] == rdiv(q["remaining_cents"] * tier["percent"], 100)
    assert q["tax_cents"] == rdiv(q["payoff_cents"] * c["terms"]["tax_rate_bp"], 10000) and q["total_cents"] == q["payoff_cents"] + q["tax_cents"]
    stale = err(buyout(d.parent, d.id, q["payoff_cents"] + 1), 409, "quote_changed")
    assert stale["quote"]["payoff_cents"] == q["payoff_cents"]
    assert get_contract(d.owner, d.id)["status"] == "active" and not killbill.payment_by_key(f"{d.id}-buyout")
    key = idempotency_key()
    r = buyout(d.parent, d.id, q["payoff_cents"], key)
    assert r.status_code == 200, r.text
    b = r.json()["buyout"]
    assert (b["payoff_cents"], b["tax_cents"], b["total_cents"], b["remaining_cents"]) == (q["payoff_cents"], q["tax_cents"], q["total_cents"], q["remaining_cents"])
    c = get_contract(d.owner, d.id)
    assert c["status"] == "paid_off" and c["closed_at"] and c["equity_cents"] == c["terms"]["purchase_price_cents"]
    eq = ledger(d.owner, d.id)
    assert eq["closed"] is True and eq["entries"][-1]["kind"] == "buyout" and eq["entries"][-1]["amount_cents"] == q["remaining_cents"]
    last = c["history"][-1]
    assert (last["from"], last["to"], last["actor"], last["actor_name"]) == ("active", "paid_off", "parent", NAMES["F-01"])
    tx = kb_txs(killbill, f"{d.id}-buyout", "PURCHASE")
    assert len(tx) == 1 and kb_amount(tx[0]) == dollars(q["total_cents"])
    assert set(kb_subscription_states(killbill, d.id)) == {"CANCELLED"}
    assert instruments(d.owner)[c["instrument"]["serial"]]["status"] == "sold"
    m = mails(mail, lambda m: subject(m) == f"You own it — {c['instrument']['label']} {c['instrument']['serial']}")
    assert len(m) == 1 and money(q["total_cents"]) in text(m[0]) and f"/api/contracts/{d.id}/bill-of-sale.pdf" in text(m[0])
    assert buyout(d.parent, d.id, q["payoff_cents"], key).content == r.content
    err(buyout(d.parent, d.id, q["payoff_cents"]), 409, "invalid_transition")
    err(pay(d.owner, d.id, 100), 409, "invalid_transition")
    assert len(kb_txs(killbill, f"{d.id}-buyout", "PURCHASE")) == 1


def test_bill_of_sale_at_payoff(app_url, mail, killbill):
    bucket = S3()
    a = make_contract(app_url, mail, itype="violin", size="1/4", waiver=False)
    key = f"contracts/{a.id}/bill-of-sale.pdf"
    err(a.owner.get(f"/api/contracts/{a.id}/bill-of-sale.pdf"), 404, "bill_of_sale_not_stored")
    q = quote_now(a.owner, a.id)
    err(buyout(login(outage_url("minio-down"), "owner"), a.id, q["payoff_cents"]), 503, "storage_unavailable")
    err(buyout(login(outage_url("killbill-down"), "owner"), a.id, q["payoff_cents"]), 503, "billing_unavailable")
    assert key not in bucket.keys(f"contracts/{a.id}/") and not killbill.payment_by_key(f"{a.id}-buyout")
    assert get_contract(a.owner, a.id)["status"] == "active"
    c = get_contract(a.owner, a.id)
    amount = amount_for_base(c, c["terms"]["purchase_price_cents"] - c["equity_cents"])
    r = pay(a.owner, a.id, amount)
    assert r.status_code == 201, r.text
    c = get_contract(a.owner, a.id)
    assert c["status"] == "paid_off" and c["bill_of_sale_stored"] is True
    assert (c["history"][-1]["to"], c["history"][-1]["actor"]) == ("paid_off", "owner")
    assert set(kb_subscription_states(killbill, a.id)) == {"CANCELLED"}
    dl = a.owner.get(f"/api/contracts/{a.id}/bill-of-sale.pdf")
    assert dl.status_code == 200 and dl.headers["content-type"].startswith("application/pdf")
    assert a.parent.get(f"/api/contracts/{a.id}/bill-of-sale.pdf").content == dl.content == bucket.get(key)
    pdf = unescape_pdf(dl.content)
    assert dl.content.startswith(b"%PDF-")
    for s in (a.id, NAMES["F-01"], a.student["name"], c["instrument"]["label"], c["instrument"]["serial"], "Paid in full",
              money(amount), fmt_dt(ts(c["closed_at"]))):
        assert s in pdf, s
    m = mails(mail, lambda m: subject(m) == f"You own it — {c['instrument']['label']} {c['instrument']['serial']}")
    assert money(amount) in text(m[0]) and money(c["terms"]["purchase_price_cents"]) in text(m[0])


def test_fleet_and_student_intake(app_url):
    owner, tech = login(app_url, "owner"), login(app_url, "tech")
    serial = new_serial()
    r = owner.post("/api/instruments", json={"serial": serial, "instrument_type": "violin", "size": "3/4", "model": "Ostwald VN-10"})
    assert r.status_code == 201, r.text
    inst = r.json()["instrument"]
    assert (inst["serial"], inst["label"], inst["status"], inst["contract_id"]) == (serial, label_of("violin", "3/4"), "available", None)
    fleet = tech.get("/api/instruments").json()["instruments"]
    assert [i["index"] for i in fleet] == list(range(1, len(fleet) + 1))
    mine = next(i for i in fleet if i["serial"] == serial)
    assert mine["status"] == "available" and mine["model"] == "Ostwald VN-10"
    byserial = {i["serial"]: i for i in fleet}
    assert byserial["KB-CE-0505"]["status"] == "retired"
    err(owner.post("/api/instruments", json={"serial": serial, "instrument_type": "violin", "size": "3/4", "model": "x"}), 409, "serial_taken")
    f = err(owner.post("/api/instruments", json={"serial": "ab", "instrument_type": "tuba", "size": "9/8", "model": ""}), 422, "validation_failed")["fields"]
    assert {"serial", "instrument_type", "size", "model"} <= set(f)
    f = err(owner.post("/api/instruments", json={"serial": new_serial(), "instrument_type": "flute", "size": "1/2", "model": "x"}), 422, "validation_failed")["fields"]
    assert set(f) == {"size"}
    err(tech.post("/api/instruments", json={"serial": new_serial(), "instrument_type": "flute", "size": "full", "model": "x"}), 403, "forbidden")
    s = add_student(owner, "F-04", "ferncliff", grade=0)
    assert s["family_id"] == "F-04" and s["school_id"] == "ferncliff" and s["grade"] == 0
    fam = next(x for x in owner.get("/api/families").json()["families"] if x["id"] == "F-04")
    assert any(x["id"] == s["id"] for x in fam["students"])
    f = err(owner.post("/api/students", json={"family_id": "F-99", "school_id": "nowhere", "name": "", "grade": 13}), 422, "validation_failed")["fields"]
    assert set(f) == {"family_id", "school_id", "name", "grade"}


def tally(body: dict) -> dict:
    return {k: sum(1 for r in body["students"] if r["delivery_status"] == k) for k in COUNT_KEYS}


def test_director_roster_fields(app_url, mail):
    owner, dl = login(app_url, "owner"), login(app_url, "dir_l")
    d = make_contract(app_url, mail, family_id="F-04", stage="reserved", itype="flute", size="full")
    idle = add_student(owner, "F-04", "larkspur")
    r = dl.get(f"/api/schools/{LARK}/roster")
    assert r.status_code == 200
    body = r.json()
    assert body["school"]["id"] == "larkspur" and set(body["counts"]) == set(COUNT_KEYS)
    assert all(set(row) == ROSTER_KEYS for row in body["students"])
    row = next(x for x in body["students"] if x["student_id"] == d.student["id"])
    assert (row["delivery_status"], row["serial"], row["instrument_type"], row["size"], row["delivery_date"]) == (
        "awaiting_agreement", d.contract["instrument"]["serial"], "flute", "full", d.contract["delivery_date"])
    row = next(x for x in body["students"] if x["student_id"] == idle["id"])
    assert row["delivery_status"] == "no_instrument" and (row["instrument_type"], row["size"], row["serial"], row["delivery_date"]) == (None, None, None, None)
    for leak in (USERS["F-04"][0], NAMES["F-04"], "555-0104", "3 Tannery Court", "_cents"):
        assert leak not in r.text, leak
    err(dl.get(f"/api/schools/{FERN}/roster"), 404, "not_found")
    err(dl.get(f"/api/schools/{FERN}/roster.csv"), 404, "not_found")
    for path in (f"/api/contracts/{SEED_C1}", f"/api/contracts/{SEED_C1}/quotes", "/api/families", "/api/instruments"):
        err(dl.get(path), 403, "forbidden")


def test_roster_counts_equal_rows(app_url, mail):
    owner = login(app_url, "owner")

    def roster() -> dict:
        body = owner.get(f"/api/schools/{LARK}/roster").json()
        assert body["counts"] == tally(body)
        return body

    row = lambda body, sid: next(x for x in body["students"] if x["student_id"] == sid)
    d = make_contract(app_url, mail, family_id="F-03", itype="violin", size="1/4", waiver=False)
    add_instrument(owner, "violin", "1/2")
    assert row(roster(), d.student["id"])["delivery_status"] == "delivered"
    new = exchange(owner, d.id, "1/2").json()["new_contract"]
    x = row(roster(), d.student["id"])
    assert (x["delivery_status"], x["size"], x["serial"]) == ("delivered", "1/2", new["instrument"]["serial"])
    hb = outage_url("clock-hold")
    ho, hp = login(hb, "owner"), login(hb, "F-03")
    add_instrument(ho, "flute", "full")
    s = add_student(ho, "F-03", "larkspur")
    c = reserve(hp, s["id"], "flute", "full").json()["contract"]
    wait_server(ho, ts(c["hold_expires_at"]))
    x = row(roster(), s["id"])
    assert x["delivery_status"] == "no_instrument" and x["serial"] is None


def test_roster_csv_export(app_url, mail):
    owner = login(app_url, "owner")
    tag = uuid.uuid4().hex[:8]
    names = [f"{ch}Probe{tag}" for ch in FORMULA_CHARS]
    for n in names:
        add_student(owner, "F-04", "larkspur", name=n, grade=5)
    d = make_contract(app_url, mail, family_id="F-04", stage="reserved", itype="clarinet", size="full")
    r = owner.get(f"/api/schools/{LARK}/roster.csv")
    ctype = r.headers["content-type"].lower()
    assert r.status_code == 200 and ctype.startswith("text/csv") and "charset=utf-8" in ctype
    assert r.headers["content-disposition"] == f'attachment; filename="roster-{LARK}.csv"'
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    roster = owner.get(f"/api/schools/{LARK}/roster").json()["students"]
    assert rows[0] == CSV_HEADER and len(rows) - 1 == len(roster)
    neutral = lambda v: "'" + v if v[:1] in FORMULA_CHARS or v[:1] in ("\t", "\r") else v
    assert [x[0] for x in rows[1:]] == [neutral(x["student_name"]) for x in roster]
    for n in names:
        line = next(x for x in rows[1:] if x[0] == "'" + n)
        assert line[1:] == ["5", "", "", "", "", "No instrument"]
    line = next(x for x in rows[1:] if x[0] == d.student["name"])
    assert line[2:] == ["Clarinet", "full", d.contract["instrument"]["serial"], d.contract["delivery_date"], "Awaiting agreement"]
    assert login(app_url, "dir_l").get(f"/api/schools/{LARK}/roster.csv").status_code == 200


def test_condition_photos_judged_by_content(app_url, mail):
    d = make_contract(app_url, mail, stage="signed", itype="flute", size="full")
    tech, bucket = login(app_url, "tech"), S3()
    photos = [("../../evil name.jpg", pil_bytes("JPEG", 64, 48, exif=True), "image/jpeg"), ("IMG_1.png", png_bytes(40, 30), "image/png"),
              ("w.webp", pil_bytes("WEBP", 32, 24), "image/webp")]
    r = upload(tech, d.id, photos)
    assert r.status_code == 201, r.text
    ev = r.json()["event"]
    assert ev["kind"] == "checkout" and len(ev["photos"]) == 3
    keys = set(bucket.keys(f"contracts/{d.id}/condition/{ev['id']}/"))
    assert keys == {f"contracts/{d.id}/condition/{ev['id']}/{p['id']}.jpg" for p in ev["photos"]}
    for p, (name, _, _), size in zip(ev["photos"], photos, [(64, 48), (40, 30), (32, 24)]):
        assert p["url"] == f"/api/condition-photos/{p['id']}" and "evil" not in p["url"]
        stored = bucket.get(f"contracts/{d.id}/condition/{ev['id']}/{p['id']}.jpg")
        assert stored.startswith(b"\xff\xd8") and b"Exif" not in stored and b"ProbeCam" not in stored
        assert Image.open(io.BytesIO(stored)).size == size
        got = tech.get(p["url"])
        assert got.status_code == 200 and got.headers["content-type"].startswith("image/jpeg") and got.content == stored
    assert "evil" not in r.text
    small = ("ok.png", png_bytes(8, 8), "image/png")
    cases = [
        ([small, ("x.png", SVG, "image/png")], 415, "unsupported_image", 1),
        ([("a.gif", pil_bytes("GIF", 4, 4), "image/gif")], 415, "unsupported_image", 0),
        ([("t.jpg", b"not an image at all", "image/jpeg")], 415, "unsupported_image", 0),
        ([("big.png", png_bytes(1000, 1600, PHOTO_MAX_BYTES + 1), "image/png"), ("x.svg", SVG, "image/svg+xml")], 413, "photo_too_large", 0),
        ([small, ("wide.png", png_bytes(PHOTO_MAX_SIDE + 1, 1), "image/png")], 422, "validation_failed", 1),
    ]
    for files, status, code, index in cases:
        e = err(upload(tech, d.id, files), status, code)
        assert e["photo_index"] == index, e
        if status == 422:
            assert e["fields"]["photos"] == "dimensions"
    assert err(upload(tech, d.id, []), 422, "validation_failed")["fields"]["photos"] == "count"
    assert err(upload(tech, d.id, [small] * (PHOTO_MAX_COUNT + 1)), 422, "validation_failed")["fields"]["photos"] == "count"
    assert "kind" in err(upload(tech, d.id, [small], kind="bogus"), 422, "validation_failed")["fields"]
    assert "notes" in err(upload(tech, d.id, [small], notes="n" * (NOTES_MAX + 1)), 422, "validation_failed")["fields"]
    r = upload(tech, d.id, [("edge.png", png_bytes(1000, 1600, PHOTO_MAX_BYTES), "image/png"), ("long.png", png_bytes(PHOTO_MAX_SIDE, 1), "image/png")])
    assert r.status_code == 201, r.text


def test_condition_upload_all_or_nothing(app_url, mail):
    d = make_contract(app_url, mail, stage="signed", itype="clarinet", size="full")
    tech = login(app_url, "tech")
    bad = good_photos()[:2] + [("bad.png", pil_bytes("GIF", 4, 4), "image/png")]
    assert err(upload(tech, d.id, bad), 415, "unsupported_image")["photo_index"] == 2
    assert condition_keys(d.id) == set() and tech.get(f"/api/contracts/{d.id}/condition-events").json()["events"] == []
    err(upload(login(outage_url("minio-down"), "tech"), d.id, good_photos()), 503, "storage_unavailable")
    assert condition_keys(d.id) == set() and tech.get(f"/api/contracts/{d.id}/condition-events").json()["events"] == []
    r_ = make_contract(app_url, mail, stage="reserved", itype="flute", size="full")
    err(upload(tech, r_.id, [], kind="bogus"), 409, "contract_not_open")
    assert upload(tech, d.id, good_photos()[:2]).status_code == 201
    assert upload(tech, d.id, good_photos()[2:], kind="return").status_code == 201
    events = tech.get(f"/api/contracts/{d.id}/condition-events").json()["events"]
    assert [e["kind"] for e in events] == ["return", "checkout"]
    assert condition_keys(d.id) == {f"contracts/{d.id}/condition/{e['id']}/{p['id']}.jpg" for e in events for p in e["photos"]}


def test_parent_reaches_only_own_contracts(app_url, mail):
    tech = login(app_url, "tech")
    d = make_contract(app_url, mail, stage="signed", itype="flute", size="full")
    photo = upload(tech, d.id, [("p.png", png_bytes(8, 8), "image/png")]).json()["event"]["photos"][0]["url"]
    mine, other = login(app_url, "F-01"), login(app_url, "F-02")
    for path in (f"/api/contracts/{d.id}", f"/api/contracts/{d.id}/quotes", f"/api/contracts/{d.id}/agreement.pdf", photo, f"/api/contracts/{SEED_C1}"):
        assert mine.get(path).status_code == 200, path
    for path in (f"/api/contracts/{d.id}", f"/api/contracts/{d.id}/invoice", f"/api/contracts/{d.id}/equity", f"/api/contracts/{d.id}/quote?month=0",
                 f"/api/contracts/{d.id}/quotes", f"/api/contracts/{d.id}/condition-events", photo, f"/api/contracts/{SEED_C1}", f"/api/contracts/{UNKNOWN_CONTRACT}"):
        err(other.get(path), 404, "not_found")
    for path in (f"/api/contracts/{d.id}/agreement.pdf", f"/api/contracts/{d.id}/bill-of-sale.pdf"):
        r = other.get(path)
        assert r.status_code == 404 and r.json()["error"]["code"] in ("not_found", "agreement_not_stored", "bill_of_sale_not_stored")
    err(buyout(other, "C-1001", 1), 404, "not_found")
    ids = {c["id"] for c in other.get("/api/contracts").json()["contracts"]}
    assert d.id not in ids and "C-1001" not in ids and "C-1002" in ids
    assert {d.id, "C-1001"} <= {c["id"] for c in mine.get("/api/contracts").json()["contracts"]}


def test_family_totals_stay_with_family(app_url, mail):
    p2 = login(app_url, "F-02")

    def totals() -> dict:
        f = family(p2)
        cs = [c for s in f["students"] for c in s["contracts"]]
        open_ = [c for c in cs if c["status"] in OPEN]
        t = f["totals"]
        assert t["open_contracts"] == len(open_) and t["equity_cents"] == sum(c["equity_cents"] for c in open_)
        assert t["owned"] == sum(1 for c in cs if c["status"] == "paid_off")
        return t

    t0 = totals()
    d = make_contract(app_url, mail, family_id="F-02", itype="violin", size="1/4", waiver=True)
    assert totals() == {**t0, "open_contracts": t0["open_contracts"] + 1}
    p = pay(d.owner, d.id, 5000).json()["payment"]
    t2 = totals()
    assert t2["equity_cents"] == t0["equity_cents"] + p["base_rent_cents"]
    o = make_contract(app_url, mail, family_id="F-01", itype="trumpet", size="full", waiver=False)
    assert pay(o.owner, o.id, 5000).status_code == 201
    assert totals() == t2
    add_instrument(d.owner, "violin", "1/2")
    new = exchange(d.owner, d.id, "1/2").json()["new_contract"]["id"]
    assert totals() == t2
    p3 = pay(d.owner, new, 4000).json()["payment"]
    assert totals()["equity_cents"] == t2["equity_cents"] + p3["base_rent_cents"]
    assert reverse(d.owner, new, p3["id"]).status_code == 201
    assert totals() == t2
    eq_new = get_contract(d.owner, new)["equity_cents"]
    assert buyout(d.owner, new, quote_now(d.owner, new)["payoff_cents"]).status_code == 200
    t4 = totals()
    assert t4 == {"open_contracts": t2["open_contracts"] - 1, "equity_cents": t2["equity_cents"] - eq_new, "owned": t2["owned"] + 1}
    hb = outage_url("clock-hold")
    ho, hp = login(hb, "owner"), login(hb, "F-02")
    add_instrument(ho, "flute", "full")
    s = add_student(ho, "F-02", "larkspur")
    c = reserve(hp, s["id"], "flute", "full").json()["contract"]
    wait_server(ho, ts(c["hold_expires_at"]))
    assert totals() == t4


def test_equity_equals_ledger(app_url, mail):
    owner = login(app_url, "owner")
    seed = ledger(owner, "C-1002")
    assert [e["kind"] for e in seed["entries"]] == ["opening"] and seed["entries"][0]["amount_cents"] == SEED_OPENING["C-1002"]
    d = make_contract(app_url, mail, itype="trumpet", size="full", waiver=False)
    p1 = pay(owner, d.id, 6000).json()["payment"]
    p2 = pay(owner, d.id, 3000).json()["payment"]
    snap = ledger(owner, d.id)["entries"]
    assert reverse(owner, d.id, p1["id"], "entered_in_error").status_code == 201
    eq = ledger(owner, d.id)
    for old, now in zip(snap, eq["entries"]):
        assert {k: v for k, v in old.items() if k != "reversed"} == {k: v for k, v in now.items() if k != "reversed"}
    assert eq["equity_cents"] == sum(e["amount_cents"] for e in eq["entries"]) == p2["base_rent_cents"]
    flags = {e["payment_id"]: e["reversed"] for e in eq["entries"] if e["kind"] == "payment"}
    assert flags == {p1["id"]: True, p2["id"]: False}
    assert eq["entries"][-1]["kind"] == "reversal" and eq["entries"][-1]["amount_cents"] == -p1["base_rent_cents"]


def test_contract_state_machine(app_url, mail, killbill):
    owner = login(app_url, "owner")
    r_ = make_contract(app_url, mail, stage="reserved", itype="flute", size="full")
    s_ = make_contract(app_url, mail, stage="signed", itype="clarinet", size="full")
    for d, moves in ((r_, ["activate", "return", "write-off", "buyout", "payments", "exchange"]), (s_, ["signing-link", "payments", "return"])):
        before = (get_contract(owner, d.id), ledger(owner, d.id) if d is s_ else None, instruments(owner)[d.contract["instrument"]["serial"]])
        for mv in moves:
            body = {"size": "1/2"} if mv == "exchange" else {"amount_cents": 100} if mv == "payments" else {"expected_payoff_cents": 0} if mv == "buyout" else {}
            err(owner.post(f"/api/contracts/{d.id}/{mv}", json=body, headers=keyed()), 409, "invalid_transition")
        after = (get_contract(owner, d.id), ledger(owner, d.id) if d is s_ else None, instruments(owner)[d.contract["instrument"]["serial"]])
        assert after == before
    stranger = login(app_url, "F-02")
    before = get_contract(owner, r_.id)
    err(buyout(stranger, r_.id, 0), 404, "not_found")
    assert get_contract(owner, r_.id) == before
    a = make_contract(app_url, mail, itype="violin", size="1/4", waiver=False)
    err(owner.post(f"/api/contracts/{a.id}/activate", json={}), 409, "invalid_transition")
    assert owner.post(f"/api/contracts/{a.id}/return", json={}).json()["contract"]["status"] == "returned"
    hist = get_contract(owner, a.id)["history"]
    for mv in ("return", "write-off", "activate"):
        err(owner.post(f"/api/contracts/{a.id}/{mv}", json={}), 409, "invalid_transition")
    assert get_contract(owner, a.id)["history"] == hist
    assert instruments(owner)[a.contract["instrument"]["serial"]]["status"] == "available"


def test_unsigned_holds_expire(mail):
    hb = outage_url("clock-hold")
    owner, parent = login(hb, "owner"), login(hb, "F-03")
    add_instrument(owner, "flute", "full")
    s = add_student(owner, "F-03", "ferncliff")
    c = reserve(parent, s["id"], "flute", "full").json()["contract"]
    held_count = available(owner, "flute", "full")
    deadline = ts(c["hold_expires_at"])
    wait_server(owner, deadline)
    assert available(owner, "flute", "full") == held_count + 1
    assert instruments(owner)[c["instrument"]["serial"]]["status"] == "available"
    for client in (owner, parent, owner):
        got = get_contract(client, c["id"])
        assert got["status"] == "expired"
        exp = [h for h in got["history"] if h["to"] == "expired"]
        assert len(exp) == 1 and (exp[0]["from"], exp[0]["actor"], exp[0]["actor_name"], exp[0]["at"]) == ("reserved", "system", None, c["hold_expires_at"])
    assert reserve(parent, s["id"], "flute", "full").status_code == 201


def test_attributed_history(app_url, mail):
    d = make_contract(app_url, mail, itype="trumpet", size="full", waiver=False, full_name="  Robin Q Alder  ")
    c = get_contract(d.owner, d.id)
    assert [(h["from"], h["to"], h["actor"], h["actor_name"]) for h in c["history"]] == [
        (None, "reserved", "parent", NAMES["F-01"]), ("reserved", "agreement_sent", "owner", NAMES["owner"]),
        ("agreement_sent", "signed", "parent", "Robin Q Alder"), ("signed", "active", "owner", NAMES["owner"])]
    ats = [h["at"] for h in c["history"]]
    assert all(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", a) for a in ats) and ats == sorted(ats)
    assert ats[2] == c["signed_at"] and ats[3] == c["activated_at"]
    err(d.owner.post(f"/api/contracts/{d.id}/activate", json={}), 409, "invalid_transition")
    err(d.owner.post(f"/api/contracts/{d.id}/signing-link/revoke", json={}), 409, "no_live_link")
    assert pay(d.owner, d.id, 1000).status_code == 201
    assert get_contract(d.owner, d.id)["history"] == c["history"]
    assert d.owner.post(f"/api/contracts/{d.id}/write-off", json={}).status_code == 200
    h = get_contract(d.owner, d.id)["history"]
    assert len(h) == 5 and (h[-1]["from"], h[-1]["to"], h[-1]["actor"], h[-1]["actor_name"]) == ("active", "written_off", "owner", NAMES["owner"])


def test_closing_confirmed_by_killbill(app_url, mail, killbill):
    a = make_contract(app_url, mail, itype="violin", size="1/4", waiver=False)
    hist = get_contract(a.owner, a.id)["history"]
    err(login(outage_url("killbill-down"), "owner").post(f"/api/contracts/{a.id}/return", json={}), 503, "billing_unavailable")
    assert get_contract(a.owner, a.id)["history"] == hist and kb_subscription_states(killbill, a.id) == ["ACTIVE"]
    r = a.owner.post(f"/api/contracts/{a.id}/return", json={})
    assert r.status_code == 200 and r.json()["contract"]["status"] == "returned" and r.json()["contract"]["subscription_state"] == "cancelled"
    assert set(kb_subscription_states(killbill, a.id)) == {"CANCELLED"}
    b = make_contract(app_url, mail, itype="clarinet", size="full", waiver=False)
    assert b.owner.post(f"/api/contracts/{b.id}/write-off", json={}).json()["contract"]["status"] == "written_off"
    assert set(kb_subscription_states(killbill, b.id)) == {"CANCELLED"}
    assert instruments(b.owner)[b.contract["instrument"]["serial"]]["status"] == "retired"


def test_sign_in_and_roles(app_url):
    for who, (email, _) in USERS.items():
        c = login(app_url, who)
        u = c.get("/api/me").json()["user"]
        assert u["email"] == email and u["role"] == ROLES[who] and u["name"] == NAMES[who]
    r = httpx.post(f"{app_url}/api/session", json={"email": USERS["owner"][0], "password": "wrong-password"}, timeout=HTTP_S)
    err(r, 401, "invalid_credentials")
    r = httpx.post(f"{app_url}/api/session", json={"email": USERS["owner"][0], "password": USERS["owner"][1]}, timeout=HTTP_S)
    cookie = r.headers["set-cookie"].lower()
    assert all(part.lower() in cookie for part in ("bellroll_session", "HttpOnly", "SameSite=Lax", "Path=/"))
    err(httpx.get(f"{app_url}/api/me", timeout=HTTP_S), 401, "unauthenticated")
    c1 = f"/api/contracts/{SEED_C1}"
    matrix = [("tech", "/api/price-lists", 403), ("tech", f"{c1}/invoice", 403), ("tech", f"{c1}/equity", 403),
              ("tech", f"{c1}/quotes", 403), ("tech", f"{c1}/agreement.pdf", 403), ("tech", "/api/families", 403),
              ("tech", c1, 200), ("tech", "/api/instruments", 200), ("F-01", "/api/instruments", 403),
              ("F-01", "/api/price-lists", 403), ("F-01", "/api/families", 403), ("F-01", "/api/family", 200),
              ("F-01", f"/api/schools/{LARK}/roster", 403), ("dir_l", "/api/contracts", 403), ("dir_l", "/api/family", 403),
              ("dir_l", "/api/schools", 200), ("owner", "/api/family", 403), ("owner", f"/api/schools/{FERN}/roster", 200)]
    clients = {who: login(app_url, who) for who in {m[0] for m in matrix}}
    for who, path, status in matrix:
        r = clients[who].get(path)
        if status == 403:
            err(r, 403, "forbidden")
        else:
            assert r.status_code == 200, (who, path, r.status_code)
    err(clients["tech"].post("/api/instruments", json={}), 403, "forbidden")
    err(clients["F-01"].post(f"/api/contracts/{SEED_C1}/signing-link", json={}), 403, "forbidden")
    err(clients["dir_l"].post("/api/reservations", json={}), 403, "forbidden")
    c = login(app_url, "F-01")
    assert c.delete("/api/session").status_code == 204
    err(c.get("/api/me"), 401, "unauthenticated")


def test_error_order_and_shape(app_url, mail):
    anon = httpx.Client(base_url=app_url, timeout=HTTP_S)
    seed_pay, unknown_pay = f"/api/contracts/{SEED_C1}/payments", f"/api/contracts/{UNKNOWN_CONTRACT}/payments"
    err(anon.post(seed_pay, json={"amount_cents": 100}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    err(anon.post(seed_pay, json={"amount_cents": 100}), 401, "unauthenticated")
    err(login(app_url, "F-01").post(unknown_pay, json={}), 403, "forbidden")
    owner = login(app_url, "owner")
    err(owner.post(unknown_pay, json={"amount_cents": -5}), 404, "not_found")
    r_ = make_contract(app_url, mail, stage="reserved", itype="flute", size="full")
    err(owner.post(f"/api/contracts/{r_.id}/payments", json={"amount_cents": -5}), 409, "invalid_transition")
    t = make_contract(app_url, mail, itype="trumpet", size="full", waiver=False)
    err(owner.post(f"/api/contracts/{t.id}/exchange", json={"size": "giant"}), 409, "not_exchangeable")
    assert "expected_payoff_cents" in err(buyout(owner, t.id, "abc"), 422, "validation_failed")["fields"]
    err(buyout(owner, t.id, quote_now(owner, t.id)["payoff_cents"] + 1), 409, "quote_changed")
    err(owner.post(f"/api/contracts/{t.id}/payments/{UNKNOWN_PAYMENT}/reversal", json={}), 404, "not_found")
    f = err(owner.post("/api/price-lists", json={}), 422, "validation_failed")["fields"]
    assert {"effective_date", "tax_rate_bp", "items", "tiers"} <= set(f)


def test_billing_and_storage_outages(app_url, mail, killbill):
    kb_down, s3_down = outage_url("killbill-down"), outage_url("minio-down")
    for base in (kb_down, s3_down):
        r = httpx.get(f"{base}/api/health", timeout=HTTP_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
    signed = make_contract(app_url, mail, stage="signed", itype="flute", size="full")
    for base, code, msg in ((kb_down, "billing_unavailable", "Billing is unreachable. Nothing was changed."),
                            (s3_down, "storage_unavailable", "File storage is unreachable. Nothing was changed.")):
        assert err(login(base, "owner").post(f"/api/contracts/{signed.id}/activate", json={}), 503, code)["message"] == msg
    assert get_contract(signed.owner, signed.id)["status"] == "signed" and killbill.account_by_key(signed.id) is None
    a = make_contract(app_url, mail, itype="violin", size="1/4", waiver=False)
    add_instrument(a.owner, "violin", "1/2")
    p = pay(a.owner, a.id, 4000).json()["payment"]
    snap = (get_contract(a.owner, a.id), ledger(a.owner, a.id))
    ko = login(kb_down, "owner")
    q = quote_now(a.owner, a.id)
    for path, body in (("return", {}), ("write-off", {}), ("exchange", {"size": "1/2"}), (f"payments/{p['id']}/reversal", {"reason": "chargeback"}),
                       ("buyout", {"expected_payoff_cents": q["payoff_cents"]}), ("payments", {"amount_cents": 500})):
        err(ko.post(f"/api/contracts/{a.id}/{path}", json=body, headers=keyed()), 503, "billing_unavailable")
    assert (get_contract(a.owner, a.id), ledger(a.owner, a.id)) == snap
    assert kb_subscription_states(killbill, a.id) == ["ACTIVE"] and not killbill.payment_by_key(f"{a.id}-buyout")
    assert f"contracts/{a.id}/bill-of-sale.pdf" not in S3().keys(f"contracts/{a.id}/")
    so = login(s3_down, "owner")
    err(so.post(f"/api/contracts/{a.id}/exchange", json={"size": "1/2"}, headers=keyed()), 503, "storage_unavailable")
    err(so.get(f"/api/contracts/{a.id}/agreement.pdf"), 503, "storage_unavailable")
    err(upload(so, a.id, good_photos()[:1]), 503, "storage_unavailable")
    assert kb_subscription_states(killbill, a.id) == ["ACTIVE"]
    p2 = pay(so, a.id, 1000)
    assert p2.status_code == 201
    assert reverse(so, a.id, p2.json()["payment"]["id"]).status_code == 201


def test_controlled_clock():
    with clock_instance("clock-dst-sat", ts(DST_SAT_USABLE_BEFORE)) as base:
        owner, parent = login(base, "owner"), login(base, "F-04")
        s1, m1 = server_now(owner), time.monotonic()
        assert s1 >= ts("2026-10-31T21:30:00Z")
        eventually(lambda: time.monotonic() - m1 >= 2, WAIT_S, "two real seconds")
        s2, m2 = server_now(owner), time.monotonic()
        assert abs((s2 - s1).total_seconds() - (m2 - m1)) < 1.5
        add_instrument(owner, "trumpet", "full")
        s = add_student(owner, "F-04", "larkspur")
        before = server_now(owner).replace(microsecond=0)
        c = reserve(parent, s["id"], "trumpet", "full").json()["contract"]
        after = server_now(owner)
        at = ts(c["history"][0]["at"])
        assert before <= at <= after
        assert ts(c["hold_expires_at"]) - at == dt.timedelta(seconds=HOLD_DEFAULT_S)
        assert c["delivery_date"] == "2026-11-03"


def test_health(app_url):
    for base in [app_url] + [outage_url(o) for o in URL_ENV]:
        r = httpx.get(f"{base.rstrip('/')}/api/health", timeout=HTTP_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, base


def test_server_boundary(app_url):
    host = urlparse(app_url)
    own = f"{host.scheme}://{host.netloc}"
    creds = {"email": USERS["owner"][0], "password": USERS["owner"][1]}
    for origin in (FOREIGN_ORIGIN, "null"):
        err(httpx.post(f"{app_url}/api/session", json=creds, headers={"Origin": origin}, timeout=HTTP_S), 403, "cross_origin")
    assert httpx.post(f"{app_url}/api/session", json=creds, headers={"Origin": own}, timeout=HTTP_S).status_code == 200
    assert httpx.get(f"{app_url}/api/health", headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_S).status_code == 200
    filler = lambda n: json.dumps({"email": "x@example.com", "password": "p" * n}).encode()
    body = filler(JSON_LIMIT - len(filler(0)))
    assert len(body) == JSON_LIMIT
    jh = {"Content-Type": "application/json; charset=utf-8"}
    err(httpx.post(f"{app_url}/api/session", content=body, headers=jh, timeout=HTTP_S), 401, "invalid_credentials")
    err(httpx.post(f"{app_url}/api/session", content=filler(JSON_LIMIT - len(filler(0)) + 1), headers=jh, timeout=HTTP_S), 413, "payload_too_large")
    err(httpx.post(f"{app_url}/api/session", content=b"hello", headers={"Content-Type": "text/plain"}, timeout=HTTP_S), 415, "unsupported_media_type")
    mh = {"Content-Type": "multipart/form-data; boundary=probe"}
    upload_url = f"{app_url}/api/contracts/{SEED_C1}/condition-events"
    err(httpx.post(upload_url, content=b"x" * (MULTIPART_LIMIT + 1), headers=mh, timeout=HTTP_S), 413, "payload_too_large")
    err(httpx.post(upload_url, content=b"x" * MULTIPART_LIMIT, headers=mh, timeout=HTTP_S), 401, "unauthenticated")
    for path in SOURCE_PROBES:
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_S).status_code == 404, path
    secrets = [os.environ[k] for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "KILLBILL_URL", "S3_ENDPOINT")
               if len(os.environ.get(k, "")) >= 8 and not re.fullmatch(r"[A-Za-z]+", os.environ[k])]
    seen, queue = set(), ["/"]
    while queue and len(seen) < 60:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        r = httpx.get(f"{app_url}{path}", timeout=HTTP_S)
        body = r.text
        for s in secrets:
            assert s not in body, path
        for ref in re.findall(r"""["'(](/[A-Za-z0-9_\-./]+\.(?:js|mjs|css))""", body):
            queue.append(ref)
        if path.endswith((".js", ".mjs")):
            assert httpx.get(f"{app_url}{path}.map", timeout=HTTP_S).status_code == 404, path
    me = login(app_url, "owner").get(f"/api/contracts/{SEED_C1}").text
    assert not any(s in me for s in secrets)


def test_exact_starting_state(app_url):
    owner = login(app_url, "owner")
    for base in (app_url, outage_url("clock-dst-sat")):
        o = login(base, "owner")
        serials = [i["serial"] for i in o.get("/api/instruments").json()["instruments"]]
        assert all(serials.count(s) == 1 for s in SEED_SERIALS)
        for cid, opening in SEED_OPENING.items():
            c = get_contract(o, cid)
            assert len(c["history"]) == 1 and c["history"][0] == {"from": None, "to": "active", "at": c["activated_at"], "actor": "owner", "actor_name": None}
            assert [e["amount_cents"] for e in ledger(o, cid)["entries"] if e["kind"] == "opening"] == [opening]
        lists = o.get("/api/price-lists").json()["price_lists"]
        pl = [p for p in lists if p["id"] == "PL-2024-01"]
        assert len(pl) == 1 and pl[0]["effective_date"] == "2024-01-01" and pl[0]["tax_rate_bp"] == 825
    twin = outage_url("killbill-down")
    for _ in range(6):
        add_instrument(owner, "flute", "full")
    students = [add_student(owner, "F-04", "larkspur") for _ in range(6)]
    clients = [login(app_url, "F-04"), login(twin, "F-04")]
    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(lambda i: reserve(clients[i % 2], students[i]["id"], "flute", "full"), range(6)))
    ids = [r.json()["contract"]["id"] for r in results if r.status_code == 201]
    assert len(ids) == 6 and len(set(ids)) == 6
    assert all(re.fullmatch(r"C-\d+", i) and int(i[2:]) >= FIRST_CONTRACT_NO for i in ids)


def test_billing_anniversary_dates(mail):
    with clock_instance("clock-month-end", ts(MONTH_END_USABLE_BEFORE)) as base:
        d = make_contract(base, mail, family_id="F-04", itype="clarinet", size="full", waiver=False)
        assert d.contract["billing_anchor_date"] == "2027-01-31" and d.contract["next_billing_date"] == "2027-02-28"
        inv = d.owner.get(f"/api/contracts/{d.id}/invoice").json()["invoice"]
        assert inv["billing_date"] == "2027-02-28"
        assert inv["upcoming_billing_dates"] == ["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]
    with clock_instance("clock-dst-sat", ts(DST_SAT_BILLING_BEFORE)) as base:
        owner = login(base, "owner")
        for cid, anchor, nxt in (("C-1001", "2025-09-04", "2026-11-04"), ("C-1002", "2025-09-02", "2026-11-02"), ("C-1003", "2024-09-03", "2026-11-03")):
            c = get_contract(owner, cid)
            assert (c["billing_anchor_date"], c["next_billing_date"]) == (anchor, nxt)


def test_wf_reservation_happy(browser, app_url):
    owner = login(app_url, "owner")
    add_instrument(owner, "violin", "3/4")
    student = add_student(owner, "F-04", "larkspur")
    with signed_in(browser, app_url, "F-04", "/reserve", device_time=WRONG_DEVICE_TIME) as page:
        sr = page.get_by_role("radiogroup", name="Student").get_by_role("radio", name=student["name"])
        sr.focus()
        page.keyboard.press("Space")
        expect(sr).to_be_checked()
        v = page.get_by_role("radiogroup", name="Instrument").get_by_role("radio", name="Violin")
        v.focus()
        page.keyboard.press("Space")
        expect(v).to_be_checked()
        size = page.get_by_role("radiogroup", name="Size").get_by_role("radio", name=f"3/4, {available(owner, 'violin', '3/4')} available")
        size.focus()
        page.keyboard.press("Space")
        expect(size).to_be_checked()
        w = page.get_by_role("checkbox", name="Add maintenance and damage waiver")
        w.focus()
        page.keyboard.press("Space")
        expect(w).to_be_checked()
        lark = school(schools(owner), "larkspur")
        expect(page.get_by_text(f"Reserve before {fmt_dt(ts(lark['cutoff_at']))} for delivery day {fmt_date(day(lark['next_delivery_date']))}.")).to_be_visible()
        button, status = page.get_by_role("button", name="Reserve instrument"), page.get_by_role("status", name="Reservation status")
        button.focus()
        with held(page, route("/api/reservations")) as gate:
            page.keyboard.press("Enter")
            expect(status).to_have_text("Reserving…")
            expect(button).to_be_disabled()
            gate.release()
        expect(status).not_to_have_text("Reserving…")
        c = get_contract(owner, student_contracts(login(app_url, "F-04"), student["id"])[0]["id"])
        assert c["instrument"]["size"] == "3/4" and c["waiver"] is True and c["status"] == "reserved"
        expect(status).to_have_text(f"Reserved 3/4 Violin {c['instrument']['serial']} for {student['name']}. Hold until {fmt_dt(ts(c['hold_expires_at']))}. "
                                    f"Delivery day {fmt_date(day(c['delivery_date']))}.")


def test_wf_reservation_unavailable(browser, app_url):
    owner, other = login(app_url, "owner"), login(app_url, "F-02")
    add_instrument(owner, "cello", "3/4")
    add_instrument(owner, "cello", "4/4")
    student = add_student(owner, "F-04", "larkspur")
    k = available(owner, "cello", "3/4")
    takers = [add_student(owner, "F-02", "larkspur") for _ in range(k)]
    with signed_in(browser, app_url, "F-04", f"/reserve?student={student['id']}") as page:
        size = CELLO_SIZES[2]
        choose(page.get_by_role("radiogroup", name="Instrument").get_by_role("radio", name="Cello"))
        choose(page.get_by_role("radiogroup", name="Size").get_by_role("radio", name=f"{size}, {k} available"))
        for s in takers:
            assert reserve(other, s["id"], "cello", "3/4").status_code == 201
        avail = {i["size"]: i["available"] for i in owner.get("/api/availability").json()["items"] if i["instrument_type"] == "cello"}
        first = next(s for s in CELLO_SIZES if avail[s] > 0)
        click(page.get_by_role("button", name="Reserve instrument"))
        status = page.get_by_role("status", name="Reservation status")
        expect(status).to_have_text(f"That {size} Cello is no longer available.")
        alt = page.get_by_role("list", name="Available instead").get_by_role("button", name=f"Reserve {first} Cello")
        expect(alt).to_be_focused()
        page.keyboard.press("Enter")
        expect(status).to_contain_text(f"Reserved {first} Cello ")
    cs = student_contracts(login(app_url, "F-04"), student["id"])
    assert len(cs) == 1 and cs[0]["instrument_label"] == f"{first} Cello"


def test_live_size_availability(browser, app_url):
    owner, other = login(app_url, "owner"), login(app_url, "F-02")
    add_instrument(owner, "cello", "1/4")
    add_instrument(owner, "cello", "1/2")
    student = add_student(owner, "F-04", "larkspur")
    k = available(owner, "cello", "1/4")
    takers = [add_student(owner, "F-02", "larkspur") for _ in range(k)]
    with signed_in(browser, app_url, "F-04", f"/reserve?student={student['id']}") as page:
        cello = page.get_by_role("radiogroup", name="Instrument").get_by_role("radio", name="Cello")
        choose(cello)
        sizes = page.get_by_role("radiogroup", name="Size")
        quarter = sizes.get_by_role("radio", name=f"1/4, {k} available")
        choose(quarter)
        expect(quarter).to_be_checked()
        waiver = page.get_by_role("checkbox", name="Add maintenance and damage waiver")
        choose(waiver)
        quarter.focus()
        page.evaluate("window.__bellrollProbe = 1")
        for s in takers:
            assert reserve(other, s["id"], "cello", "1/4").status_code == 201
        avail = {i["size"]: i["available"] for i in owner.get("/api/availability").json()["items"] if i["instrument_type"] == "cello"}
        nxt = next(s for s in CELLO_SIZES if avail[s] > 0)
        advance(page, LIVE_SIZE_S * 1000)
        gone = sizes.get_by_role("radio", name=f"{CELLO_SIZES[0]}, none available")
        expect(gone).to_be_disabled()
        expect(gone).not_to_be_checked()
        chosen = sizes.get_by_role("radio", name=re.compile(rf"^{re.escape(nxt).replace('/', chr(92) + '/')}, \d+ available$"))
        expect(chosen).to_be_checked()
        expect(chosen).to_be_focused()
        expect(page.get_by_role("status", name="Reservation status")).to_have_text(f"The last {CELLO_SIZES[0]} Cello was just reserved. {nxt} Cello is selected instead.")
        expect(page.get_by_role("radiogroup", name="Student").get_by_role("radio", name=student["name"])).to_be_checked()
        expect(cello).to_be_checked()
        expect(waiver).to_be_checked()
        assert page.evaluate("window.__bellrollProbe") == 1
        click(page.get_by_role("button", name="Reserve instrument"))
        expect(page.get_by_role("status", name="Reservation status")).to_contain_text(f"Reserved {nxt} Cello ")
    assert student_contracts(login(app_url, "F-04"), student["id"])[0]["instrument_label"] == f"{nxt} Cello"


def test_delivery_line_follows_server_cutoff(browser):
    cutoff = ts("2026-11-04T23:00:00Z")
    with clock_instance("clock-cutoff-ui", cutoff - dt.timedelta(seconds=CUTOFF_UI_LEAD_S)) as base:
        owner = login(base, "owner")
        student = add_student(owner, "F-04", "ferncliff")
        with signed_in(browser, base, "F-04", "/", device_time=WRONG_DEVICE_TIME) as page:
            s0 = server_now(owner)
            page.goto(f"{base}/reserve?student={student['id']}")
            expect(page.get_by_text("Reserve before November 4, 2026, 5:00 PM CST for delivery day November 5, 2026.")).to_be_visible()
            page.evaluate("window.__bellrollProbe = 1")
            wait_server(owner, cutoff)
            advance(page, ((cutoff - s0).total_seconds() + CUTOFF_SWITCH_S) * 1000)
            expect(page.get_by_text("Reserve before November 11, 2026, 5:00 PM CST for delivery day November 12, 2026.")).to_be_visible()
            assert page.evaluate("window.__bellrollProbe") == 1


def test_wf_signing_keyboard(browser, app_url, mail):
    d = make_contract(app_url, mail, stage="reserved", itype="clarinet", size="full")
    with signed_in(browser, app_url, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        click(page.get_by_role("button", name="Send signing link"))
        exp = ts(eventually(lambda: get_contract(d.owner, d.id)["signing_link"]["expires_at"], WAIT_S, "link"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text(f"Signing link queued for {USERS['F-01'][0]}. It works until {fmt_dt(exp)}.")
    token = signing_tokens(mail, d.student["name"])[0]
    with open_app(browser, f"{app_url}/sign/{token}") as page:
        expect(page.get_by_role("heading", name="Rental agreement")).to_be_visible()
        region = page.get_by_role("region", name="Agreement text")
        expect(region).to_contain_text(d.contract["instrument"]["serial"])
        expect(page.get_by_text(f"This link works until {fmt_dt(exp)}.")).to_be_visible()
        region.focus()
        page.keyboard.press("Tab")
        name = page.get_by_role("textbox", name="Full legal name")
        expect(name).to_be_focused()
        assert_focus_ring(name)
        page.keyboard.type("Robin Alder")
        page.keyboard.press("Tab")
        box = page.get_by_role("checkbox", name="I have read and agree to this rental agreement")
        expect(box).to_be_focused()
        page.keyboard.press("Space")
        expect(box).to_be_checked()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Sign agreement")).to_be_focused()
        status = page.get_by_role("status", name="Signing status")
        with held(page, route(f"/api/signing/{token}")) as gate:
            page.keyboard.press("Enter")
            expect(status).to_have_text("Signing…")
            gate.release()
        expect(status).to_have_text("Agreement signed. Keel & Bell will confirm delivery.")
        expect(status).to_be_focused()
        expect(name).to_have_count(0)
    c = get_contract(d.owner, d.id)
    assert c["status"] == "signed" and f"contracts/{d.id}/agreement-signed.pdf" in S3().keys(f"contracts/{d.id}/")


def test_wf_signing_expires_in_place(browser, mail):
    base = outage_url("clock-hold")
    owner = login(base, "owner")
    d = make_contract(base, mail, family_id="F-03", stage="sent", itype="flute", size="full")
    exp = ts(get_contract(owner, d.id)["signing_link"]["expires_at"])
    with open_app(browser, f"{base}/") as page:
        page.clock.set_system_time(STALE_DEVICE_TIME)
        s0 = server_now(owner)
        page.goto(f"{base}/sign/{d.token}")
        expect(page.get_by_text(f"This link works until {fmt_dt(exp)}.")).to_be_visible()
        name = page.get_by_role("textbox", name="Full legal name")
        name.focus()
        wait_server(owner, exp)
        advance(page, ((exp - s0).total_seconds() + CUTOFF_SWITCH_S) * 1000)
        status = page.get_by_role("status", name="Signing status")
        expect(status).to_have_text("This signing link has expired. Ask Keel & Bell for a new one.")
        for loc in (name, page.get_by_role("checkbox", name="I have read and agree to this rental agreement"), page.get_by_role("button", name="Sign agreement")):
            expect(loc).to_have_count(0)
        expect(status).to_be_focused()
    err(httpx.get(f"{base}/api/signing/{d.token}", timeout=HTTP_S), 410, "link_expired")


def test_wf_activation_double_press(browser, app_url, mail, killbill):
    d = make_contract(app_url, mail, stage="signed", itype="trumpet", size="full", waiver=False)
    with signed_in(browser, app_url, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        button = page.get_by_role("button", name="Activate contract")
        x, y = center(button)
        page.mouse.click(x, y)
        page.mouse.click(x, y)
        expect(page.get_by_role("status", name="Contract status")).to_have_text("Contract active. Monthly billing is set up.")
    c = get_contract(d.owner, d.id)
    assert c["status"] == "active" and [h["to"] for h in c["history"]].count("active") == 1
    acc = killbill.account_by_key(d.id)
    assert acc and len(killbill.subscriptions(acc["accountId"])) == 1


def test_wf_activation_billing_outage(browser, mail, app_url, killbill):
    d = make_contract(app_url, mail, stage="signed", itype="flute", size="full")
    base = outage_url("killbill-down")
    with signed_in(browser, base, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        click(page.get_by_role("button", name="Activate contract"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text("Billing is unreachable. The contract is still signed; try again in a moment.")
    assert get_contract(d.owner, d.id)["status"] == "signed" and killbill.account_by_key(d.id) is None


def test_wf_monthly_payment_record(browser, app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="cello", size="1/2", waiver=True)
    a, w, t = contract_split(d.contract, 10000)
    with signed_in(browser, app_url, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        click(page.get_by_role("button", name="Record payment"))
        dialog = page.get_by_role("dialog", name="Record payment")
        fill(dialog.get_by_role("textbox", name="Amount"), "100.00")
        click(dialog.get_by_role("button", name="Save payment"))
        status = page.get_by_role("status", name="Contract status")
        expect(status).to_have_text(f"Payment of $100.00 recorded: {money(a)} rent toward ownership, {money(w)} waiver, {money(t)} tax. Receipt queued for {USERS['F-01'][0]}.")
        advance(page, SETTLE_MS)
        pid = next(e["payment_id"] for e in ledger(d.owner, d.id)["entries"] if e["kind"] == "payment")
        row = page.get_by_role("table", name="Equity ledger").get_by_role("row").filter(has_text=f"Payment {pid}")
        expect(row).to_contain_text(money(a))
        expect(page.get_by_role("region", name="Buyout rail")).to_contain_text(label_amount("Equity", money(a)))
    acc = killbill.account_by_key(d.id)
    assert len(killbill.payments(acc["accountId"])) == 1
    assert len(mails(mail, lambda m: subject(m) == f"Payment received — {d.id}")) == 1


def test_wf_monthly_payment_reverse(browser, app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="cello", size="1/2", waiver=True)
    key = idempotency_key()
    p = pay(d.owner, d.id, 10000, key).json()["payment"]
    with signed_in(browser, app_url, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        click(page.get_by_role("button", name=f"Reverse {p['id']}"))
        dialog = page.get_by_role("dialog", name="Reverse payment")
        expect(dialog).to_contain_text(f"Refund $100.00 and remove {money(p['base_rent_cents'])} of equity from {d.id}?")
        choose(dialog.get_by_role("radiogroup", name="Reason").get_by_role("radio", name="Returned check"))
        click(dialog.get_by_role("button", name="Confirm reversal"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text(f"Payment {p['id']} reversed: $100.00 refunded, {money(p['base_rent_cents'])} equity removed.")
        advance(page, SETTLE_MS)
        expect(page.get_by_role("button", name=f"Reverse {p['id']}")).to_have_count(0)
        table = page.get_by_role("table", name="Equity ledger")
        expect(table).to_contain_text(f"Payment {p['id']} (reversed)")
        expect(table).to_contain_text(f"Reversal of {p['id']}")
        expect(page.get_by_role("region", name="Buyout rail")).to_contain_text(label_amount("Equity", money(0)))
    assert len(kb_txs(killbill, f"{d.id}-pay-{key}", "REFUND")) == 1 and get_contract(d.owner, d.id)["equity_cents"] == 0


def test_wf_monthly_payment_outage(browser, app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="trumpet", size="full", waiver=False)
    acc = killbill.account_by_key(d.id)
    with signed_in(browser, outage_url("killbill-down"), "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        click(page.get_by_role("button", name="Record payment"))
        dialog = page.get_by_role("dialog", name="Record payment")
        fill(dialog.get_by_role("textbox", name="Amount"), "58.46")
        click(dialog.get_by_role("button", name="Save payment"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text("Billing is unreachable. Nothing was recorded; try again in a moment.")
    assert ledger(d.owner, d.id)["entries"] == [] and killbill.payments(acc["accountId"]) == []


def test_wf_exchange_size(browser, app_url, mail):
    d = make_contract(app_url, mail, itype="violin", size="1/4", waiver=True)
    add_instrument(d.owner, "violin", "1/2")
    pay(d.owner, d.id, 5000)
    e = get_contract(d.owner, d.id)["equity_cents"]
    with signed_in(browser, app_url, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        click(page.get_by_role("button", name="Exchange size"))
        dialog = page.get_by_role("dialog", name="Exchange size")
        choose(dialog.get_by_role("radiogroup", name="New size").get_by_role("radio", name=re.compile(r"^1\/2, \d+ available$")))
        click(dialog.get_by_role("button", name="Confirm exchange"))
        new_id = wait_successor(page, d.id)
        new = get_contract(d.owner, new_id)
        expect(page.get_by_role("status", name="Contract status")).to_have_text(f"Exchanged to 1/2 Violin {new['instrument']['serial']}. {money(e)} equity moved from {d.id}.")
    assert new["predecessor_id"] == d.id and new["equity_cents"] == e and get_contract(d.owner, d.id)["status"] == "exchanged"


def test_wf_exchange_keyboard(browser, app_url, mail):
    d = make_contract(app_url, mail, itype="cello", size="1/2", waiver=False)
    add_instrument(d.owner, "cello", "3/4")
    with signed_in(browser, app_url, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        opener = page.get_by_role("button", name="Exchange size")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Exchange size")
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        assert get_contract(d.owner, d.id)["status"] == "active"
        page.keyboard.press("Enter")
        radio = dialog.get_by_role("radiogroup", name="New size").get_by_role("radio", name=re.compile(r"^3\/4, \d+ available$"))
        radio.focus()
        page.keyboard.press("Space")
        dialog.get_by_role("button", name="Confirm exchange").focus()
        page.keyboard.press("Enter")
        new_id = wait_successor(page, d.id)
    old = get_contract(d.owner, d.id)
    assert old["status"] == "exchanged" and old["successor_id"] == new_id


def rail_contract(app_url: str, mail: Mailpit) -> SimpleNamespace:
    d = make_contract(app_url, mail, itype="violin", size="1/4", waiver=True)
    assert pay(d.owner, d.id, 20000).status_code == 201
    d.contract = get_contract(d.owner, d.id)
    d.quotes = quotes(d.parent, d.id)
    return d


def valuetext(q: dict, term: int) -> str:
    return f"Month {q['month']} of {term}: equity {money(q['equity_cents'])}, {q['tier']['label']}, payoff {money(q['payoff_cents'])}"


def test_buyout_rail_keys_and_pointer(browser, app_url, mail):
    d = rail_contract(app_url, mail)
    c, qs = d.contract, d.quotes
    term, m, price = c["terms"]["term_months"], c["contract_month"], c["terms"]["purchase_price_cents"]
    with signed_in(browser, app_url, "F-01", f"/contracts/{d.id}") as page:
        sheet(page)
        rail = page.get_by_role("region", name="Buyout rail")
        slider = rail.get_by_role("slider", name="Buyout month")
        expect(slider).to_have_attribute("aria-valuemin", "0")
        expect(slider).to_have_attribute("aria-valuemax", str(term))
        expect(slider).to_have_attribute("aria-valuenow", str(m))
        expect(slider).to_have_attribute("aria-valuetext", valuetext(qs[m], term))
        hist = page.evaluate("history.length")
        slider.focus()
        steps = [("ArrowRight", m + 1), ("ArrowUp", m + 2), ("ArrowLeft", m + 1), ("ArrowDown", m), ("End", term),
                 ("PageDown", term - PAGE_STEP_MONTHS), ("Home", 0), ("PageUp", PAGE_STEP_MONTHS)]
        for key, n in steps:
            page.keyboard.press(key)
            q = qs[n]
            expect(slider).to_have_attribute("aria-valuenow", str(n))
            expect(slider).to_have_attribute("aria-valuetext", valuetext(q, term))
            advance(page, SETTLE_MS)
            expect(page.get_by_role("status", name="Payoff quote")).to_have_text(f"Month {n} payoff {money(q['payoff_cents'])}. Quote valid until {fmt_date(day(q['valid_until']))}.")
            assert parse_qs(urlparse(page.url).query)["month"] == [str(n)]
            for s in (q["tier"]["label"], f"Equity {money(q['equity_cents'])}", f"Payoff {money(q['payoff_cents'])}"):
                expect(rail).to_contain_text(s)
            expect(page.get_by_role("img", name=f"Equity fill, {q['equity_cents'] * 100 // price}% owned")).to_be_visible()
        assert page.evaluate("history.length") == hist
        page.keyboard.press("Home")
        advance(page, SETTLE_MS)
        x0, y = center(slider)
        page.keyboard.press("End")
        advance(page, SETTLE_MS)
        xt, _ = center(slider)
        k = term // 3
        page.mouse.click(x0 + (xt - x0) * k / term, y)
        advance(page, SETTLE_MS)
        expect(slider).to_have_attribute("aria-valuenow", str(k))
        for query, start in (("?month=5", 5), (f"?month={term + 1}", m), ("?month=abc", m)):
            page.goto(f"{app_url}/contracts/{d.id}{query}")
            sheet(page)
            expect(page.get_by_role("slider", name="Buyout month")).to_have_attribute("aria-valuenow", str(start))


def test_buyout_rail_reduced_motion(browser, app_url, mail):
    d = rail_contract(app_url, mail)
    c, qs = d.contract, d.quotes
    term, m = c["terms"]["term_months"], c["contract_month"]
    with signed_in(browser, app_url, "F-01", f"/contracts/{d.id}", reduced=True) as page:
        sheet(page)
        slider = page.get_by_role("slider", name="Buyout month")
        assert slider.evaluate("el => el instanceof HTMLInputElement") is True
        assert slider.evaluate("el => el.type") == "range"
        box = slider.bounding_box()
        assert box["width"] >= TAP_MIN_PX and box["height"] >= TAP_MIN_PX
        table = page.get_by_role("table", name="Buyout schedule")
        expect(table.get_by_role("columnheader")).to_have_text(["Month", "Equity", "Tier", "Payoff"])
        expect(table.get_by_role("row")).to_have_count(term + 2)
        now = table.get_by_role("row").filter(has_text="(now)")
        expect(now).to_have_count(1)
        expect(now).to_contain_text(money(qs[m]["payoff_cents"]))
        slider.focus()
        page.keyboard.press("ArrowRight")
        q = qs[m + 1]
        rail = page.get_by_role("region", name="Buyout rail")
        expect(rail).to_contain_text(label_amount("Equity", money(q['equity_cents'])))
        expect(rail).to_contain_text(label_amount("Payoff", money(q['payoff_cents'])))
        expect(page.get_by_role("img", name=f"Equity fill, {q['equity_cents'] * 100 // c['terms']['purchase_price_cents']}% owned")).to_be_visible()
        assert page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length") == 0


def test_buyout_rail_touch(browser, app_url, mail):
    d = rail_contract(app_url, mail)
    term = d.contract["terms"]["term_months"]
    with signed_in(browser, app_url, "F-01", f"/contracts/{d.id}", size="narrow") as page:
        sheet(page)
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        slider = page.get_by_role("slider", name="Buyout month")
        slider.scroll_into_view_if_needed()
        box = slider.bounding_box()
        assert box["width"] >= TAP_MIN_PX and box["height"] >= TAP_MIN_PX
        slider.focus()
        page.keyboard.press("End")
        advance(page, SETTLE_MS)
        xt, _ = center(slider)
        page.keyboard.press("Home")
        advance(page, SETTLE_MS)
        x0, y = center(slider)
        notch = (xt - x0) / term

        def touch(kind: str, x: float = 0, yy: float = 0) -> None:
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": x, "y": yy}]})

        touch("touchStart", x0, y)
        for i in range(1, 9):
            touch("touchMove", x0 + notch * 3 * i / 8, y)
        touch("touchEnd")
        advance(page, SETTLE_MS)
        expect(slider).to_have_attribute("aria-valuenow", "3")
        touch("touchStart", x0 + notch * 6, y)
        touch("touchEnd")
        advance(page, SETTLE_MS)
        expect(slider).to_have_attribute("aria-valuenow", "6")
        x6, y6 = center(slider)
        before = page.evaluate("window.scrollY")
        room = page.evaluate("document.documentElement.scrollHeight - innerHeight - scrollY")
        dy = -200 if room > 100 else 200
        touch("touchStart", x6, y6)
        for i in range(1, 11):
            touch("touchMove", x6, y6 + dy * i / 10)
        touch("touchEnd")
        eventually(lambda: page.evaluate("window.scrollY") != before, WAIT_S, "page scroll from a vertical swipe")
        advance(page, SETTLE_MS)
        expect(slider).to_have_attribute("aria-valuenow", "6")


def test_wf_buyout_from_receipt_link(browser, app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="violin", size="1/4", waiver=True)
    pay(d.owner, d.id, 4000)
    receipt = mails(mail, lambda m: subject(m) == f"Payment received — {d.id}")[0]
    path = re.search(rf"/contracts/{d.id}\?month=\d+", text(receipt)).group(0)
    month = int(path.rsplit("=", 1)[1])
    c = get_contract(d.owner, d.id)
    q = quote_now(d.parent, d.id)
    with open_app(browser, f"{app_url}{path}") as page:
        page.set_viewport_size({"width": VIEWPORTS["wide"][0], "height": VIEWPORTS["wide"][1]})
        expect(page).to_have_url(f"{app_url}/?next={quote(path, safe='')}")
        ui_sign_in(page, "F-01")
        expect(page).to_have_url(f"{app_url}{path}")
        sheet(page)
        expect(page.get_by_role("slider", name="Buyout month")).to_have_attribute("aria-valuenow", str(month))
        click(page.get_by_role("button", name=f"Buy out for {money(q['total_cents'])}"))
        dialog = page.get_by_role("dialog", name="Confirm buyout")
        expect(dialog).to_contain_text(f"Pay {money(q['total_cents'])} now ({money(q['payoff_cents'])} plus {money(q['tax_cents'])} tax) and own {c['instrument']['serial']}. {q['tier']['label']} applies.")
        click(dialog.get_by_role("button", name="Confirm buyout"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text(
            f"Bought out for {money(q['total_cents'])}. {d.student['name']} owns {c['instrument']['serial']}. Ownership letter queued for {USERS['F-01'][0]}.")
        advance(page, SETTLE_MS)
        expect(page.get_by_text("Owned", exact=True).first).to_be_visible()
        expect(page.get_by_role("link", name="Bill of sale (PDF)")).to_be_visible()
        expect(page.get_by_role("slider", name="Buyout month")).to_have_count(0)
    assert get_contract(d.owner, d.id)["status"] == "paid_off"
    tx = kb_txs(killbill, f"{d.id}-buyout", "PURCHASE")
    assert len(tx) == 1 and kb_amount(tx[0]) == dollars(q["total_cents"])


def test_wf_buyout_quote_changed(browser, app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="violin", size="1/4", waiver=False)
    q0 = quote_now(d.parent, d.id)
    with signed_in(browser, app_url, "F-01", f"/contracts/{d.id}") as page:
        sheet(page)
        old = page.get_by_role("button", name=f"Buy out for {money(q0['total_cents'])}")
        expect(old).to_be_visible()
        assert pay(d.owner, d.id, 5000).status_code == 201
        q1 = quote_now(d.parent, d.id)
        click(old)
        click(page.get_by_role("dialog", name="Confirm buyout").get_by_role("button", name="Confirm buyout"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text(f"The payoff is now {money(q1['total_cents'])} with tax. Review and confirm again.")
        advance(page, SETTLE_MS)
        if page.get_by_role("dialog", name="Confirm buyout").count():
            page.keyboard.press("Escape")
            advance(page, SETTLE_MS)
        click(page.get_by_role("button", name=f"Buy out for {money(q1['total_cents'])}"))
        click(page.get_by_role("dialog", name="Confirm buyout").get_by_role("button", name="Confirm buyout"))
        expect(page.get_by_role("status", name="Contract status")).to_contain_text(f"Bought out for {money(q1['total_cents'])}.")
    tx = kb_txs(killbill, f"{d.id}-buyout", "PURCHASE")
    assert len(tx) == 1 and kb_amount(tx[0]) == dollars(q1["total_cents"])


def test_instrument_model(browser, app_url, mail):
    d = rail_contract(app_url, mail)
    c = d.contract
    label, price, eq = c["instrument"]["label"], c["terms"]["purchase_price_cents"], c["equity_cents"]
    with signed_in(browser, app_url, "F-01", f"/contracts/{d.id}") as page:
        sheet(page)
        group = page.get_by_role("group", name=f"{label} drawing")
        model = group.get_by_role("img", name=f"{label} model")
        expect(model).to_be_visible()
        assert angle_of(model) == 0
        model.focus()
        assert_focus_ring(model)
        page.keyboard.press("ArrowRight")
        assert angle_of(model) == TURN_STEP_DEG
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        assert angle_of(model) == 360 - TURN_STEP_DEG
        advance(page, SETTLE_MS)
        frames = scene_frames(model, steps=4, step_ms=500)
        for a, b in zip(frames, frames[1:]):
            assert difference(decode(a["png"]), decode(b["png"])) == 0
        gauge = group.get_by_role("img", name=f"Equity fill, {eq * 100 // price}% owned")
        gb, grp = gauge.bounding_box(), group.bounding_box()
        assert abs((gb["y"] + gb["height"]) - (grp["y"] + grp["height"])) <= GAUGE_TOL_PX
        assert abs(gb["height"] - grp["height"] * eq / price) <= GAUGE_TOL_PX
        brass = png_rgb(capture(gauge)).getpixel((max(0, int(gb["width"] // 2)), max(0, int(gb["height"]) - 2)))

        def measure() -> None:
            im = png_rgb(capture(model))
            w, h = im.size
            px = im.load()
            paper = px[0, 0]
            far = lambda p, q, tol: max(abs(p[i] - q[i]) for i in range(3)) > tol
            rows = [y for y in range(h) if any(far(px[x, y], paper, PAPER_TOL) for x in range(w))]
            cols = [x for x in range(w) if any(far(px[x, y], paper, PAPER_TOL) for y in range(0, h, 2))]
            band = [y for y in range(h) if any(not far(px[x, y], brass, BRASS_TOL) for x in range(w))]
            top, bottom = min(rows), max(rows)
            assert bottom - top + 1 >= MODEL_MIN_HEIGHT * h
            assert abs((min(cols) + max(cols)) / 2 - w / 2) <= MODEL_CENTRE_TOL * w
            assert band, "no brass band"
            assert abs((bottom - min(band)) - (bottom - top) * eq / price) <= BAND_TOL * h

        measure()
        before = capture(model)
        start = angle_of(model)
        x, y = center(model)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + DRAG_PX, y, steps=10)
        page.mouse.up()
        advance(page, SETTLE_MS)
        turned = (angle_of(model) - start) % 360
        assert TURN_MIN_DEG <= turned <= TURN_MAX_DEG and angle_of(model) % TURN_STEP_DEG == 0
        assert difference(decode(before), decode(capture(model))) > 0
        measure()
    with signed_in(browser, app_url, "F-01", f"/contracts/{d.id}", no_webgl=True) as page:
        sheet(page)
        group = page.get_by_role("group", name=f"{label} drawing")
        expect(group).to_be_visible()
        expect(group.get_by_role("img", name=f"{label} model")).to_have_count(0)
        expect(group.get_by_role("img", name=f"Equity fill, {eq * 100 // price}% owned")).to_be_visible()


RECORD_ANIMATIONS = """(() => { const orig = Element.prototype.animate; window.__bellrollAnims = [];
Element.prototype.animate = function (k, o) { const a = orig.call(this, k, o);
try { const t = a.effect.getComputedTiming(); window.__bellrollAnims.push({d: Number(t.duration), it: Number(t.iterations)}); } catch (e) {}
return a; }; })();"""


def test_motion_vocabulary(browser, app_url, mail):
    d = rail_contract(app_url, mail)
    in_range = lambda ms: any(lo <= ms <= hi for lo, hi in (QUICK_MS, MEDIUM_MS, LONG_MS))
    for reduced in (False, True):
        with signed_in(browser, app_url, "owner", f"/contracts/{d.id}", reduced=reduced, init_script=RECORD_ANIMATIONS) as page:
            sheet(page)
            click(page.get_by_role("button", name="Record payment"))
            advance(page, SETTLE_MS)
            page.keyboard.press("Escape")
            advance(page, SETTLE_MS)
            page.get_by_role("slider", name="Buyout month").focus()
            page.keyboard.press("ArrowRight")
            if reduced:
                assert page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length") == 0
            advance(page, SETTLE_MS)
            records = page.evaluate("window.__bellrollAnims")
            assert all(r["it"] != float("inf") for r in records), records
            if reduced:
                assert all(r["d"] == 0 for r in records), records
            else:
                assert all(r["d"] == 0 or in_range(r["d"]) for r in records), records
            advance(page, SETTLE_MS * 2)
            running = page.evaluate("document.getAnimations().filter(a => a.playState === 'running').map(a => a.effect.getComputedTiming().iterations)")
            assert running == [], running


def test_motion_choreography(browser, app_url, mail):
    d = rail_contract(app_url, mail)
    term, qs, m = d.contract["terms"]["term_months"], d.quotes, d.contract["contract_month"]
    serial = d.contract["instrument"]["serial"]
    with signed_in(browser, app_url, "owner", "/register") as page:
        link = page.get_by_role("link", name=serial, exact=True)
        link.scroll_into_view_if_needed()
        rb = page.get_by_role("row").filter(has=link).bounding_box()
        click(link)
        header = page.get_by_role("group", name="Contract header")
        expect(header).to_be_attached()
        path = track(page, header, MEDIUM_MS[1] + 200, 28)
        step = (MEDIUM_MS[1] + 200) / 28
        x, y, w, h = _box(path[0])
        for a, b in ((x, rb["x"]), (y, rb["y"]), (x + w, rb["x"] + rb["width"]), (y + h, rb["y"] + rb["height"])):
            assert abs(a - b) <= HEADER_EDGE_PX, (path[0], rb)
        final = _box(path[-1])
        rest = next(_t(s) for i, s in enumerate(path) if all(max(abs(p - q) for p, q in zip(_box(z), final)) <= 0.5 for z in path[i:]))
        assert MEDIUM_MS[0] - step <= rest <= MEDIUM_MS[1]
        sheet(page)
        opener = page.get_by_role("button", name="Record payment")
        click(opener)
        dialog = page.get_by_role("dialog", name="Record payment")
        path = track(page, dialog, MEDIUM_MS[1] + 200, 30)
        step = (MEDIUM_MS[1] + 200) / 30
        y0, yf = _box(path[0])[1], _box(path[-1])[1]
        assert abs((y0 - yf) - DIALOG_OFFSET_PX) <= 1 and path[0]["opacity"] <= 0.05
        rest = next(_t(s) for i, s in enumerate(path) if all(abs(_box(z)[1] - yf) <= 0.5 and z["opacity"] >= 0.99 for z in path[i:]))
        assert MEDIUM_MS[0] - step <= rest <= MEDIUM_MS[1]
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        advance(page, QUICK_MS[1])
        expect(dialog).to_have_count(0)
        click(opener)
        advance(page, SETTLE_MS)
        page.keyboard.press("Escape")
        advance(page, QUICK_MS[0] // 3)
        opener.focus()
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        advance(page, SETTLE_MS)
        slider = page.get_by_role("slider", name="Buyout month")
        slider.focus()
        page.keyboard.press("End")
        advance(page, SETTLE_MS)
        xt = center(slider)[0]
        page.keyboard.press("Home")
        advance(page, SETTLE_MS)
        x0 = center(slider)[0]
        page.keyboard.press("ArrowRight")
        expect(slider).to_have_attribute("aria-valuetext", valuetext(qs[1], term))
        path = track(page, slider, LONG_MS[1] + 200, 50)
        step = (LONG_MS[1] + 200) / 50
        cx = [_box(s)[0] + _box(s)[2] / 2 for s in path]
        assert cx[-1] > cx[0]
        assert OVERSHOOT_PX[0] <= max(cx) - cx[-1] <= OVERSHOOT_PX[1]
        moves = [_t(path[i]) for i in range(1, len(cx)) if abs(cx[i] - cx[i - 1]) > 0.1]
        assert LONG_MS[0] - step <= max(moves) <= LONG_MS[1]
        assert abs(cx[-1] - (x0 + (xt - x0) / term)) <= NOTCH_TOL_PX
        page.keyboard.press("ArrowRight")
        advance(page, FIGURE_START_MAX_MS + FIGURE_MAX_MS)
        rail = page.get_by_role("region", name="Buyout rail")
        expect(rail).to_contain_text(label_amount("Equity", money(qs[2]['equity_cents'])))
        expect(rail).to_contain_text(label_amount("Payoff", money(qs[2]['payoff_cents'])))


def test_wf_price_list_change_publish_withdraw(browser, app_url):
    owner = login(app_url, "owner")
    current = owner.get("/api/price-lists/current").json()["price_list"]
    eff = store_date(server_now(owner)) + dt.timedelta(days=FUTURE_DAYS)
    with signed_in(browser, app_url, "owner", "/price-lists") as page:
        table = page.get_by_role("table", name="Price lists")
        expect(table.get_by_role("row").filter(has_text=current["id"])).to_contain_text("In force")
        form = page.get_by_role("form", name="New price list")
        expect(form.get_by_role("textbox", name="Effective date")).to_have_value("")
        fill(form.get_by_role("textbox", name="Effective date"), eff.isoformat())
        click(form.get_by_role("button", name="Publish price list"))
        status = page.get_by_role("status", name="Price list status")
        expect(status).to_have_text(re.compile(rf"^Price list \S+ takes effect {re.escape(fmt_date(eff))}\. Contracts signed before then keep their terms\.$"))
        pid = re.match(r"Price list (\S+) ", status.text_content()).group(1)
        expect(table.get_by_role("row").filter(has_text=pid)).to_contain_text("Scheduled")
        click(page.get_by_role("button", name=f"Withdraw {pid}"))
        dialog = page.get_by_role("dialog", name="Confirm withdrawal")
        expect(dialog).to_contain_text(f"Withdraw {pid} before it takes effect on {fmt_date(eff)}? Contracts and reservations keep the terms in force without it.")
        click(dialog.get_by_role("button", name="Withdraw price list"))
        expect(status).to_have_text(f"Price list {pid} withdrawn before it took effect.")
        expect(table.get_by_role("row").filter(has_text=pid)).to_contain_text("Withdrawn")
        expect(page.get_by_role("button", name=f"Withdraw {pid}")).to_have_count(0)
    pl = next(p for p in owner.get("/api/price-lists").json()["price_lists"] if p["id"] == pid)
    assert pl["withdrawn_at"] and pl["effective_date"] == eff.isoformat() and pl["tax_rate_bp"] == current["tax_rate_bp"]
    assert owner.get("/api/price-lists/current").json()["price_list"]["id"] == current["id"]


def test_wf_price_list_change_refused_first(browser, app_url):
    owner = login(app_url, "owner")
    ids = {p["id"] for p in owner.get("/api/price-lists").json()["price_lists"]}
    eff = (store_date(server_now(owner)) + dt.timedelta(days=FUTURE_DAYS)).isoformat()
    with signed_in(browser, app_url, "owner", "/price-lists") as page:
        form = page.get_by_role("form", name="New price list")
        effective, tax, tier2 = (form.get_by_role("textbox", name=n) for n in ("Effective date", "Sales tax rate", "Tier 2 from month"))
        fill(effective, eff)
        fill(tax, "25")
        fill(tier2, "5")
        click(form.get_by_role("button", name="Publish price list"))
        expect(page.get_by_role("status", name="Price list status")).to_have_text("Check the highlighted fields.")
        expect(tax).to_have_attribute("aria-invalid", "true")
        expect(tax).to_have_accessible_description("Enter a rate from 0.00% to 20.00%.")
        expect(tier2).to_have_attribute("aria-invalid", "true")
        expect(tier2).to_have_accessible_description("Start this tier the month after the previous tier ends.")
        expect(tax).to_be_focused()
        expect(effective).not_to_have_attribute("aria-invalid", "true")
        assert {p["id"] for p in owner.get("/api/price-lists").json()["price_lists"]} == ids
        fill(tax, "8.25")
        fill(tier2, "4")
        click(form.get_by_role("button", name="Publish price list"))
        expect(page.get_by_role("status", name="Price list status")).to_contain_text(" takes effect ")
        expect(tax).not_to_have_attribute("aria-invalid", "true")
    for p in owner.get("/api/price-lists").json()["price_lists"]:
        if p["id"] not in ids:
            owner.post(f"/api/price-lists/{p['id']}/withdraw", json={})
    with signed_in(browser, app_url, "owner", "/register") as page:
        click(page.get_by_role("button", name="Add instrument"))
        dialog = page.get_by_role("dialog", name="Add instrument")
        serial, model = dialog.get_by_role("textbox", name="Serial"), dialog.get_by_role("textbox", name="Model")
        fill(serial, "ab")
        click(dialog.get_by_role("button", name="Save instrument"))
        expect(page.get_by_role("status", name="Register status")).to_contain_text("Check the highlighted fields.")
        for f in (serial, model):
            expect(f).to_have_attribute("aria-invalid", "true")
            expect(f).not_to_have_accessible_description("")
        expect(serial).to_be_focused()
        click(dialog.get_by_role("button", name="Cancel"))
        advance(page, SETTLE_MS)
        click(page.get_by_role("button", name="Add student"))
        dialog = page.get_by_role("dialog", name="Add student")
        fill(dialog.get_by_role("textbox", name="Grade"), "13")
        click(dialog.get_by_role("button", name="Save student"))
        fields = [dialog.get_by_role("combobox", name="Family"), dialog.get_by_role("combobox", name="School"),
                  dialog.get_by_role("textbox", name="Student name"), dialog.get_by_role("textbox", name="Grade")]
        expect(fields[3]).to_have_attribute("aria-invalid", "true")
        expect(fields[2]).to_have_attribute("aria-invalid", "true")
        first = next(f for f in fields if f.get_attribute("aria-invalid") == "true")
        expect(first).to_be_focused()


def test_wf_roster_and_export_director_phone(browser, app_url, mail):
    make_contract(app_url, mail, family_id="F-04", stage="reserved", itype="flute", size="full")
    api = login(app_url, "dir_l").get(f"/api/schools/{LARK}/roster").json()
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        ui_sign_in(page, "dir_l")
        expect(page).to_have_url(f"{app_url}/roster")
        expect(page.get_by_role("heading", name=f"{SCHOOL_NAMES[LARK]} roster")).to_be_visible()
        k = api["counts"]["scheduled"] + api["counts"]["delivered"] + api["counts"]["owned"]
        expect(page.get_by_text(f"{k} of {len(api['students'])} students have an instrument")).to_be_visible()
        items = page.get_by_role("list", name="Roster summary").get_by_role("listitem")
        expect(items).to_have_text([f"{STATUS_WORDS[s]}: {api['counts'][s]}" for s in COUNT_KEYS])
        icons = [items.nth(i).evaluate("el => { const s = el.querySelector('svg'); return s && s.getAttribute('aria-hidden') === 'true' ? s.innerHTML : null; }") for i in range(len(COUNT_KEYS))]
        assert all(icons) and len(set(icons)) == len(COUNT_KEYS)
        expect(page.get_by_role("button", name="Menu")).to_have_attribute("aria-expanded", "false")
        body = page.get_by_role("table", name="Roster").inner_text()
        assert NAMES["F-04"] not in body and "$" not in body
        axe(page)
        with page.expect_download() as dl:
            click(page.get_by_role("link", name="Download roster CSV"))
        got = Path(dl.value.path()).read_bytes()
    assert got == login(app_url, "dir_l").get(f"/api/schools/{LARK}/roster.csv").content


def test_wf_roster_and_export_owner_view(browser, app_url):
    with signed_in(browser, app_url, "owner", "/schools") as page:
        click(page.get_by_role("region", name="Ferncliff Elementary").get_by_role("link", name="View roster"))
        expect(page).to_have_url(f"{app_url}/roster?school=ferncliff")
        expect(page.get_by_role("heading", name=f"{SCHOOL_NAMES[FERN]} roster")).to_be_visible()
        with page.expect_download() as dl:
            click(page.get_by_role("link", name="Download roster CSV"))
        got = Path(dl.value.path()).read_bytes()
    assert got == login(app_url, "owner").get(f"/api/schools/{FERN}/roster.csv").content


def test_wf_delivery_notice_send(browser, app_url, mail):
    d = make_contract(app_url, mail, family_id="F-04", school_id="ferncliff", stage="reserved", itype="clarinet", size="full")
    when = day(d.contract["delivery_date"])
    with signed_in(browser, app_url, "owner", "/schools") as page:
        region = page.get_by_role("region", name="Ferncliff Elementary")
        select(region.get_by_role("combobox", name="Delivery date"), f"{fmt_date(when)} (cutoff {fmt_dt(ts(cutoff_for(when)))})")
        click(region.get_by_role("button", name="Send delivery notice"))
        expect(region.get_by_role("status", name="Delivery notice status")).to_have_text(
            re.compile(rf"^Delivery notice queued for {re.escape(USERS['dir_f'][0])} \(\d+ students\)\.$"))
    m = mails(mail, lambda m: subject(m) == f"Delivery day {fmt_date(when)} — Ferncliff Elementary" and d.student["name"] in text(m))
    assert f"{d.student['name']} — {d.contract['instrument']['label']} — {d.contract['instrument']['serial']}" in text(m[-1])


def test_wf_delivery_notice_cutoff_passes(browser):
    cutoff = ts("2026-11-04T23:00:00Z")
    opt = lambda s: f"{fmt_date(day(s))} (cutoff {fmt_dt(ts(cutoff_for(day(s))))})"
    passed = f"Delivery day {fmt_date(day('2026-11-05'))} passed its cutoff. Pick another delivery day."
    with clock_instance("clock-cutoff-ui", cutoff - dt.timedelta(seconds=CUTOFF_UI_LEAD_S)) as base:
        owner = login(base, "owner")
        with signed_in(browser, base, "owner", "/", device_time=WRONG_DEVICE_TIME) as page:
            s0 = server_now(owner)
            page.goto(f"{base}/schools")
            fern, lark = page.get_by_role("region", name="Ferncliff Elementary"), page.get_by_role("region", name="Larkspur Middle School")
            fbox, lbox = fern.get_by_role("combobox", name="Delivery date"), lark.get_by_role("combobox", name="Delivery date")
            expect(fbox.get_by_role("option", name=opt("2026-11-05"), selected=True)).to_have_count(1)
            select(lbox, opt("2026-11-17"))
            lbox.focus()
            wait_server(owner, cutoff)
            advance(page, ((cutoff - s0).total_seconds() + CUTOFF_SWITCH_S) * 1000)
            expect(fbox.get_by_role("option")).to_have_text(["Pick a delivery day"] + [opt(x) for x in ("2026-11-12", "2026-11-19", "2026-11-26", "2026-12-03")])
            fstatus = fern.get_by_role("status", name="Delivery notice status")
            expect(fstatus).to_have_text(passed)
            expect(fbox.get_by_role("option", name="Pick a delivery day", selected=True)).to_have_count(1)
            expect(fern.get_by_role("button", name="Send delivery notice")).to_be_disabled()
            expect(lbox.get_by_role("option")).to_have_text(["Pick a delivery day"] + [opt(x) for x in ("2026-11-10", "2026-11-17", "2026-11-24", "2026-12-01")])
            expect(lbox.get_by_role("option", name=opt("2026-11-17"), selected=True)).to_have_count(1)
            expect(lbox).to_be_focused()
            expect(lark.get_by_role("status", name="Delivery notice status")).not_to_contain_text("passed its cutoff")
            advance(page, (REPOLL_S + 1) * 1000)
            expect(fstatus).to_have_text(passed)


def test_collapsed_menu(browser, app_url):
    links = ["Register", "Price lists", "Schools"]
    with signed_in(browser, app_url, "owner", "/register", size="narrow") as page:
        menu = page.get_by_role("button", name="Menu")
        expect(menu).to_have_attribute("aria-expanded", "false")
        for n in links:
            expect(page.get_by_role("link", name=n, exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Sign out")).to_have_count(0)
        assert not set(tab_order(page, TAB_PRESSES)) & set(links + ["Sign out"])
        menu.focus()
        page.keyboard.press("Enter")
        expect(menu).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_role("link", name="Register", exact=True)).to_be_focused()
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
        page.keyboard.press("Escape")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(menu).to_be_focused()
        expect(page.get_by_role("link", name="Schools", exact=True)).to_have_count(0)
        layout(page)
        page.set_viewport_size({"width": VIEWPORTS["medium"][0], "height": VIEWPORTS["medium"][1]})
        expect(page.get_by_role("button", name="Menu")).to_have_count(0)
        for n in links:
            expect(page.get_by_role("navigation", name="Main").get_by_role("link", name=n, exact=True)).to_be_visible()


WIDTH_CASES = {"w375": 375, "w639": 639, "w640": 640, "w768": 768, "w1023": 1023, "w1024": 1024, "w1280": 1280}
ROSTER_COLUMNS = {"narrow": ["Student", "Instrument", "Serial", "Status"],
                  "medium": ["Student", "Instrument", "Size", "Serial", "Delivery day", "Status"],
                  "wide": ["Student", "Grade", "Instrument", "Size", "Serial", "Delivery day", "Status"]}
REGISTER_COLUMNS = {"medium": ["No.", "Serial", "Instrument", "Size", "School", "Status"],
                    "wide": ["No.", "Serial", "Instrument", "Size", "Model", "School", "Status"]}


@pytest.mark.parametrize("width", list(WIDTH_CASES.values()), ids=list(WIDTH_CASES))
def test_width_bands(browser, app_url, mail, width):
    band = band_of(width)
    d = make_contract(app_url, mail, family_id="F-04", stage="reserved", itype="flute", size="full")
    with signed_in(browser, app_url, "owner", f"/roster?school={LARK}", size=(width, 900)) as page:
        table = page.get_by_role("table", name="Roster")
        expect(table).to_be_visible()
        heads = [h.text_content().strip() for h in table.get_by_role("columnheader").all()]
        assert heads == ROSTER_COLUMNS[band], heads
        for hidden in set(ROSTER_COLUMNS["wide"]) - set(ROSTER_COLUMNS[band]):
            expect(table.get_by_role("columnheader", name=hidden, exact=True)).to_have_count(0)
        row = table.get_by_role("row").filter(has_text=d.student["name"])
        assert row.get_by_role("cell").count() + row.get_by_role("rowheader").count() == len(ROSTER_COLUMNS[band])
        expect(page.get_by_role("button", name="Menu")).to_have_count(1 if band == "narrow" else 0)
        page.goto(f"{app_url}/register")
        if band == "narrow":
            expect(page.get_by_role("list", name="Fleet register")).to_be_visible()
            expect(page.get_by_role("table", name="Fleet register")).to_have_count(0)
        else:
            reg = page.get_by_role("table", name="Fleet register")
            expect(reg).to_be_visible()
            assert [h.text_content().strip() for h in reg.get_by_role("columnheader").all()] == REGISTER_COLUMNS[band] or (
                band == "wide" and sorted(h.text_content().strip() for h in reg.get_by_role("columnheader").all()) == sorted(REGISTER_COLUMNS["wide"]))
            if band == "medium":
                expect(reg.get_by_role("columnheader", name="Model", exact=True)).to_have_count(0)
        layout(page)


LAYOUT_CASES = ["narrow", "medium", "wide"]
SCREENS = {
    "owner": ["/register", "/price-lists", "/schools", "/roster?school=larkspur", "/contracts/C-1002"],
    "F-01": ["/family", "/reserve", "/contracts/C-1001"],
    "dir_l": ["/roster"],
    "tech": ["/contracts/C-1003"],
}


def ready(page: Page, path: str) -> None:
    marks = {"/register": page.get_by_role("table", name="Fleet register").or_(page.get_by_role("list", name="Fleet register")),
             "/price-lists": page.get_by_role("table", name="Price lists"), "/schools": page.get_by_role("region", name="Larkspur Middle School"),
             "/roster": page.get_by_role("table", name="Roster"), "/contracts": page.get_by_role("group", name="Contract header"),
             "/family": page.get_by_role("heading", name="My family"), "/reserve": page.get_by_role("radiogroup", name="Student"),
             "/": page.get_by_role("heading", name="Keel & Bell rentals")}
    key = next(k for k in sorted(marks, key=len, reverse=True) if path.split("?")[0].startswith(k))
    expect(marks[key]).to_be_visible()
    advance(page, SETTLE_MS)


@pytest.mark.parametrize("band", LAYOUT_CASES, ids=LAYOUT_CASES)
def test_layout_three_viewports(browser, app_url, band):
    with signed_in(browser, app_url, None, "/", size=band) as page:
        ready(page, "/")
        layout(page)
    for who, paths in SCREENS.items():
        with signed_in(browser, app_url, who, paths[0], size=band) as page:
            for path in paths:
                page.goto(f"{app_url}{path}")
                ready(page, path)
                layout(page)
                for b in page.get_by_role("button").all():
                    if b.is_visible():
                        box = b.bounding_box()
                        assert box["width"] >= TAP_MIN_PX and box["height"] >= TAP_MIN_PX, (path, b.text_content(), box)


def test_wf_condition_photos_checkout(browser, app_url, mail):
    d = make_contract(app_url, mail, stage="signed", itype="flute", size="full")
    files = good_photos()
    with signed_in(browser, app_url, "tech", f"/contracts/{d.id}") as page:
        sheet(page)
        for loc in (page.get_by_role("region", name="Terms"), page.get_by_role("table", name="Monthly invoice"), page.get_by_role("table", name="Equity ledger"),
                    page.get_by_role("list", name="Contract history"), page.get_by_role("region", name="Buyout rail"), page.get_by_role("link", name="Signed agreement (PDF)")):
            expect(loc).to_have_count(0)
        history = page.get_by_role("list", name="Condition history")
        click(page.get_by_role("button", name="Record condition"))
        dialog = page.get_by_role("dialog", name="Record condition")
        choose(dialog.get_by_role("radiogroup", name="Condition check").get_by_role("radio", name="Check-out"))
        fill(dialog.get_by_role("textbox", name="Notes"), "Scratch on lid")
        dialog.get_by_label("Photos").set_input_files([{"name": n, "mimeType": t, "buffer": b} for n, b, t in files])
        for n, _, _ in files:
            expect(dialog.get_by_role("button", name=f"Remove {n}")).to_be_visible()
        click(dialog.get_by_role("button", name="Save condition"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text(f"Condition recorded with {len(files)} photos.")
        items = history.get_by_role("listitem")
        expect(items.first).to_be_visible()
        assert items.evaluate_all("es => es.filter(e => !es.some(o => o !== e && o.contains(e))).length") == 1
    events = login(app_url, "tech").get(f"/api/contracts/{d.id}/condition-events").json()["events"]
    assert len(events) == 1 and events[0]["kind"] == "checkout" and len(events[0]["photos"]) == 3
    assert len(condition_keys(d.id)) == 3
    url = events[0]["photos"][0]["url"]
    assert login(app_url, "F-01").get(url).status_code == 200
    err(login(app_url, "F-02").get(url), 404, "not_found")


def test_wf_condition_photos_refused_batch(browser, app_url, mail):
    d = make_contract(app_url, mail, stage="signed", itype="clarinet", size="full")
    bad_name = "bad.png"
    files = good_photos()[:2] + [(bad_name, pil_bytes("GIF", 4, 4), "image/png")]
    tech = login(app_url, "tech")
    with signed_in(browser, app_url, "tech", f"/contracts/{d.id}") as page:
        sheet(page)
        click(page.get_by_role("button", name="Record condition"))
        dialog = page.get_by_role("dialog", name="Record condition")
        choose(dialog.get_by_role("radiogroup", name="Condition check").get_by_role("radio", name="Check-out"))
        dialog.get_by_label("Photos").set_input_files([{"name": n, "mimeType": t, "buffer": b} for n, b, t in files])
        click(dialog.get_by_role("button", name="Save condition"))
        expect(dialog.get_by_role("status", name="Condition status")).to_have_text(f"{bad_name} isn't a JPEG, PNG or WebP photo. Nothing was saved.")
        remove = dialog.get_by_role("button", name=f"Remove {bad_name}")
        expect(remove).to_be_focused()
        for n, _, _ in files:
            expect(dialog.get_by_role("button", name=f"Remove {n}")).to_be_visible()
        expect(dialog.get_by_text("Not saved")).to_be_visible()
        assert condition_keys(d.id) == set() and tech.get(f"/api/contracts/{d.id}/condition-events").json()["events"] == []
        page.keyboard.press("Enter")
        expect(remove).to_have_count(0)
        click(dialog.get_by_role("button", name="Save condition"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text(f"Condition recorded with {len(files) - 1} photos.")
    assert len(condition_keys(d.id)) == 2


def test_wf_family_view_overview(browser, app_url):
    owner, parent = login(app_url, "owner"), login(app_url, "F-01")
    kid = add_student(owner, "F-01", "ferncliff")
    totals = family(parent)["totals"]
    with signed_in(browser, app_url, "F-01", "/family") as page:
        expect(page.get_by_role("heading", name="My family")).to_be_visible()
        region = page.get_by_role("region", name="Family totals")
        expect(region).to_contain_text(f"Equity across open contracts {money(totals['equity_cents'])}")
        expect(region).to_contain_text(f"{totals['owned']} owned")
        child = page.get_by_role("region", name=kid["name"])
        expect(child).to_contain_text("Ferncliff Elementary")
        click(child.get_by_role("link", name="Reserve an instrument"))
        page.wait_for_url(lambda u: urlparse(u).path == "/reserve")
        expect(page.get_by_role("radiogroup", name="Student")).to_be_visible()
        page.goto(f"{app_url}/family")
        click(page.get_by_role("region", name="Theo Alder").get_by_role("link", name="C-1001"))
        expect(page).to_have_url(f"{app_url}/contracts/C-1001")
        expect(page.get_by_role("group", name="Contract header").get_by_role("heading", level=1)).to_have_text(f"{SEED_C1} · {label_of('violin', '1/4')} KB-VN-0401")


RETURN_CASES = {
    "own-contract": ("F-01", "/contracts/C-1001?month=9", "/contracts/C-1001?month=9"),
    "protocol-relative": ("F-01", "//evil.example/x", "/family"),
    "other-role": ("F-01", "/register", "/family"),
    "signing-page": ("F-01", "/sign/abc", "/family"),
    "unknown-route": ("owner", "/nowhere", "/register"),
    "director-roster": ("dir_l", "/roster", "/roster"),
    "owner-roster-query": ("owner", "/roster?school=ferncliff", "/roster?school=ferncliff"),
}
SIGNED_IN_ROUTES = ("/register", "/contracts/", "/family", "/reserve", "/price-lists", "/schools", "/roster")


@pytest.mark.parametrize("case", list(RETURN_CASES), ids=list(RETURN_CASES))
def test_wf_family_view_return_after_sign_in(browser, app_url, case):
    who, path, landing = RETURN_CASES[case]
    nxt = f"/?next={quote(path, safe='')}"
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size({"width": VIEWPORTS["wide"][0], "height": VIEWPORTS["wide"][1]})
        if path.startswith(SIGNED_IN_ROUTES):
            page.goto(f"{app_url}{path}")
            expect(page).to_have_url(f"{app_url}{nxt}")
        else:
            page.goto(f"{app_url}{nxt}")
        ui_sign_in(page, who)
        expect(page).to_have_url(f"{app_url}{landing}")
        ready(page, landing)
        page.reload()
        expect(page).to_have_url(f"{app_url}{landing}")
        ready(page, landing)
        if case == "own-contract":
            expect(page.get_by_role("slider", name="Buyout month")).to_have_attribute("aria-valuenow", "9")
        page.goto(f"{app_url}{nxt}")
        expect(page).to_have_url(f"{app_url}{landing}")


def test_wf_contract_lifecycle_intake(browser, app_url):
    serial = new_serial()
    with signed_in(browser, app_url, "owner", "/register") as page:
        click(page.get_by_role("button", name="Add instrument"))
        dialog = page.get_by_role("dialog", name="Add instrument")
        fill(dialog.get_by_role("textbox", name="Serial"), serial)
        select(dialog.get_by_role("combobox", name="Instrument"), "Cello")
        select(dialog.get_by_role("combobox", name="Size"), "1/2")
        fill(dialog.get_by_role("textbox", name="Model"), "Ostwald CE-20")
        click(dialog.get_by_role("button", name="Save instrument"))
        expect(page.get_by_role("status", name="Register status")).to_have_text(f"Added {serial}.")
        expect(page.get_by_role("table", name="Fleet register")).to_contain_text(serial)
    inst = instruments(login(app_url, "owner"))[serial]
    assert (inst["label"], inst["status"], inst["model"]) == ("1/2 Cello", "available", "Ostwald CE-20")


def test_wf_contract_lifecycle_return(browser, app_url, mail, killbill):
    d = make_contract(app_url, mail, itype="trumpet", size="full", waiver=False)
    with signed_in(browser, app_url, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        click(page.get_by_role("button", name="Mark returned"))
        click(page.get_by_role("dialog", name="Confirm return").get_by_role("button", name="Confirm"))
        expect(page.get_by_role("status", name="Contract status")).to_have_text("Contract marked returned.")
        advance(page, SETTLE_MS)
        expect(page.get_by_role("button", name="Mark returned")).to_have_count(0)
    assert get_contract(d.owner, d.id)["status"] == "returned"
    assert set(kb_subscription_states(killbill, d.id)) == {"CANCELLED"}
    assert instruments(d.owner)[d.contract["instrument"]["serial"]]["status"] == "available"


def test_wf_cross_cutting_sign_in(browser, app_url):
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size({"width": VIEWPORTS["wide"][0], "height": VIEWPORTS["wide"][1]})
        expect(page.get_by_role("heading", name="Keel & Bell rentals")).to_be_visible()
        fill(page.get_by_role("textbox", name="Email"), USERS["owner"][0])
        fill(page.get_by_label("Password", exact=True), "wrong-password")
        click(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("status", name="Sign-in status")).to_have_text("Email or password is wrong.")
        ui_sign_in(page, "owner")
        expect(page).to_have_url(f"{app_url}/register")
        nav = page.get_by_role("navigation", name="Main")
        for n in ("Register", "Price lists", "Schools"):
            expect(nav.get_by_role("link", name=n, exact=True)).to_be_visible()
        click(page.get_by_role("button", name="Sign out"))
        eventually(lambda: page.request.get(f"{app_url}/api/me").status == 401, WAIT_S, "session ended")


def test_wf_cross_cutting_keyboard_dialogs(browser, app_url, mail):
    d = make_contract(app_url, mail, itype="trumpet", size="full", waiver=False)
    with signed_in(browser, app_url, "owner", f"/contracts/{d.id}") as page:
        sheet(page)
        opener = page.get_by_role("button", name="Record payment")
        opener.focus()
        assert_focus_ring(opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Record payment")
        amount = dialog.get_by_role("textbox", name="Amount")
        expect(amount).to_be_focused()
        advance(page, SETTLE_MS)
        inside = lambda: dialog.evaluate("el => el.contains(document.activeElement)")
        on = lambda loc: loc.evaluate("el => el === document.activeElement")
        save, cancel = dialog.get_by_role("button", name="Save payment"), dialog.get_by_role("button", name="Cancel")
        seen_save = seen_cancel = wrapped = False
        for _ in range(TAB_PRESSES):
            page.keyboard.press("Tab")
            assert inside(), "Tab left the open dialog"
            if on(amount):
                wrapped = True
                break
            seen_save = seen_save or on(save)
            seen_cancel = seen_cancel or on(cancel)
        assert wrapped and seen_save and seen_cancel, (wrapped, seen_save, seen_cancel)
        page.keyboard.press("Shift+Tab")
        assert inside() and not on(amount), "Shift+Tab from the first control did not reach the last"
        page.keyboard.press("Tab")
        expect(amount).to_be_focused()
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        advance(page, SETTLE_MS)
        page.keyboard.press("Space")
        expect(amount).to_be_focused()
        page.keyboard.type("58.46")
        page.keyboard.press("Enter")
        status = page.get_by_role("status", name="Contract status")
        expect(status).to_contain_text(f"Payment of {money(5846)} recorded:")
        expect(status).to_be_focused()
    assert [e["amount_cents"] for e in ledger(d.owner, d.id)["entries"]] == [contract_split(d.contract, 5846)[0]]


def label_amount(label: str, amount: str) -> re.Pattern[str]:
    return re.compile(re.escape(label) + r"\s*" + re.escape(amount))


def choose(locator: Locator) -> None:
    locator.check()
    expect(locator).to_be_checked()


def npm_tree() -> dict[str, dict]:
    deployed = Path(DEPLOYED_APP)
    installed = deployed if (deployed / "node_modules").is_dir() else Path("/app")
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=installed, capture_output=True, text=True, check=False).stdout
    found: dict[str, dict] = {}

    def walk(deps: dict) -> None:
        for name, info in (deps or {}).items():
            if info.get("version") and not info.get("missing"):
                found[name] = info
                walk(info.get("dependencies", {}))
    walk(json.loads(out or "{}").get("dependencies", {}))
    return found


def licence_ok(expr: Any) -> bool:
    if isinstance(expr, dict):
        expr = expr.get("type", "")
    expr = str(expr or "").strip()
    if expr.startswith("(") and expr.endswith(")"):
        expr = expr[1:-1]
    if " OR " in expr:
        return any(licence_ok(p) for p in expr.split(" OR "))
    if " AND " in expr:
        return all(licence_ok(p) for p in expr.split(" AND "))
    return expr.strip("() ") in ALLOWED_LICENCES


def test_if_run_manifest():
    m = json.loads(Path("/app/run.json").read_text())
    assert set(m) == {"_schema", "install", "build", "serve"} and m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n in npm_tree() if n not in notes]
    assert not missing, missing
    assert all(f in notes for f in FONTS)


def test_if_licences():
    bad = {}
    for name, info in npm_tree().items():
        lic = info.get("license")
        if lic is None and info.get("path"):
            lic = json.loads((Path(info["path"]) / "package.json").read_text()).get("license")
        if not licence_ok(lic):
            bad[name] = lic
    assert not bad, bad
    assert "OFL" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "level", "lowdb", "nedb", "lokijs", "@libsql/client", "@electric-sql/pglite", "pouchdb"}
    assert not banned & set(npm_tree())
    assert Postgres().tables()


def test_if_service_config_untouched(killbill, mail):
    killbill.account_by_key("C-1001")
    S3().keys("contracts/")
    mail.messages()
    assert Postgres().tables()


def test_if_typescript_source():
    skip = {"node_modules", ".git", "dist", "build", ".output", ".svelte-kit", ".next", "coverage"}
    js = [p for p in Path("/app").rglob("*") if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and not skip & set(p.parts)
          and not re.search(r"(\.config|rc)\.(c|m)?js$", p.name)]
    assert not js, js


def test_if_same_origin_assets(browser, app_url):
    host = urlparse(app_url).netloc
    seen: list[str] = []
    with open_app(browser, f"{app_url}/") as page:
        page.on("request", lambda r: seen.append(r.url))
        browser_login(page, app_url, "owner")
        for path in ("/register", f"/contracts/{SEED_C2}", "/price-lists"):
            page.goto(f"{app_url}{path}")
            ready(page, path)
    foreign = [u for u in seen if urlparse(u).scheme in ("http", "https") and urlparse(u).netloc != host]
    assert not foreign, foreign
