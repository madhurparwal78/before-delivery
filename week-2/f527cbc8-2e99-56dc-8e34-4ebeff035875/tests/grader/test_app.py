from __future__ import annotations

import contextlib
import csv
import datetime as dt
import functools
import http.client
import io
import json
import os
import queue
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
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP,
    Postgres,
    S3,
    addresses,
    advance,
    animations,
    capture,
    changed,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    same_origin,
    select,
    shipped_packages,
    style,
    tab_order,
    text,
    unique,
)

FARRIER = "farrier@clinchline.test"
APPRENTICE = "apprentice@clinchline.test"
MANAGER_CEDAR = "manager.cedar@clinchline.test"
MANAGER_LARK = "manager.larkspur@clinchline.test"
ADA = "owner.ada@clinchline.test"
ADA_NAME = "Ada Quill"
PASSWORD = "hoofcare-2026"
CEDAR = "Cedar Hollow Stables"
LARK = "Larkspur Farm"
ZONE = "America/Denver"
CSV_HEADER = "owner_name,owner_email,owner_phone,horse_name,barn_name,stall,cycle_weeks"
EXPORT_HEADER = "date,kind,owner,horse,amount"
APPROVE = "tok_approve_4242"
HARD = "tok_decline_0002"
SOFT = "tok_funds_9995"
HOOF_NAMES = {"LF": "Left fore", "RF": "Right fore", "LH": "Left hind", "RH": "Right hind"}
SERVICE = {"trim": "Trim", "front_reset": "Front shoes, reset", "full_reset": "Full set, reset",
           "front_new": "Front shoes, new", "full_new": "Full set, new"}
FARRIER_ROW_KEYS = {"booking_id", "number", "slot_time", "horse_id", "horse_name", "stall", "status", "owner_name",
                    "owner_email", "owner_phone", "trip_share_cents", "visit_id", "visit_status", "invoice_status",
                    "invoice_total_cents"}
APPRENTICE_ROW_KEYS = {"booking_id", "slot_time", "horse_id", "horse_name", "stall", "status", "visit_id",
                       "visit_status"}
MANAGER_ROW_KEYS = {"slot_time", "horse_name", "stall"}
VET_TOP_KEYS = {"horse", "previous_date", "current_date", "expires_at", "hooves"}
VET_HOOF_KEYS = {"hoof", "previous", "current", "difference", "readout"}
VET_SIDE_KEYS = {"business_date", "photo", "hoof_wall", "pastern", "alignment"}
VET_PHOTO_KEYS = {"hoof", "phase", "content_type", "width", "height", "url", "url_expires_at"}
JUNIPER_LF = ["Hoof wall 51.5° → 54.0° (+2.5°)", "Pastern 56.0° → 55.0° (−1.0°)",
              "Alignment broken-back → aligned"]
JUNIPER_RF = ["Hoof wall 49.6° → 50.8° (+1.2°)", "Pastern 53.0° → 50.8° (−2.2°)",
              "Alignment broken-back → aligned"]
LF84 = ({"x1": 300, "y1": 800, "x2": 700, "y2": 297}, {"x1": 700, "y1": 700, "x2": 1100, "y2": 107})
RF84 = ({"x1": 300, "y1": 800, "x2": 700, "y2": 330}, {"x1": 700, "y1": 700, "x2": 1100, "y2": 170})
LF42 = ({"x1": 300, "y1": 820, "x2": 700, "y2": 269}, {"x1": 700, "y1": 700, "x2": 1100, "y2": 129})
PHOTO_W, PHOTO_H = 1200, 900
DEPOSIT_MAX = 100000
JSON_LIMIT = 65536
PHOTO_LIMIT = 8_000_000
QUOTA = 48_000_000
QUOTA_SESSIONS, QUOTA_WINNERS = 7, 6
THUMB_W = 320
HOLD_DEFAULT_S = 300
HOLD_FAST_S = 15
VET_TTL_FAST_S = 20
HOLD_OFF_S = 20
DELIVERY_S = 45
MAIL_HOLD_OFF_S = 20
MAIL_DELIVERY_S = 45
STREAM_DELIVERY_S = 2
HEARTBEAT_S = 15
SHUTDOWN_GRACE_S = 10
READY_TIMEOUT_MS = 2000
READY_DEPS = ("postgres", "minio", "killbill", "mailpit")
JOB_MAX_ATTEMPTS = 5
JOB_START_S = 2
DUNNING_DAY_FAST_S = 2
DUNNING_OFFSETS = (3, 5, 7)
VET_MISSES = 10
VET_WINDOW_S = 60
SIGN_IN_CAP, SIGN_IN_REFILL = 10, 2
HOLD_CAP, HOLD_REFILL = 60, 12
PAYMENT_CAP, PAYMENT_REFILL = 20, 6
REFRESH_PENDING_MS = 10_000
REFRESH_MS = 30_000
UNDER_HALF_S_MS = 500
DIALOG_MAX_MS = 500
QUARTER_S_MS = 240
ROW_STAGGER_MS = 40
TOAST_MS = 4000
CHIP_LOOP_MS = 2400
TAP_PX = 44
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
SPLIT_4500_7 = [643, 643, 643, 643, 643, 643, 642]
SPLIT_1000_3 = [334, 333, 333]
FEE_4500, FEE_1000 = 4500, 1000
DAYS_PER_WEEK = 7
CYCLE_WEEKS = 6
IMPORT_ROW_LIMIT = 5000
NAME_MAX = 80
EXPORT_PREFIX = "exports"
UPLOAD_PREFIX = "uploads"
LIVE = {"held", "confirmed", "worked", "no_show"}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0",
                    "Unlicense", "OFL-1.1", "LGPL-3.0-only", "LGPL-3.0-or-later"}

TIMEOUT = 30
POLL_S = 0.25
MAIL_WAIT_S = 30
BOOT_S = 180
LATENCY_S = 10
STREAM_SLACK_S = 2
JOB_SLACK_S = 20
REMINDER_PROBE_S = 2
LATE_START = "23:59"
PHONE = "+1 303 555 0100"
CARD_NUMBER = "4242424242424242"
CSV_CT = {"Content-Type": "text/csv"}
OCTET = {"Content-Type": "application/octet-stream"}
KB_DOWN, MAIL_DOWN, PEER, FAST = "APP_KILLBILL_DOWN_URL", "APP_MAILPIT_DOWN_URL", "APP_PEER_URL", "APP_FAST_CLOCK_URL"

BASE = ""
_COOKIES: dict[str, str] = {}
_BARNS: dict[str, str] = {}
_PACE = threading.Event()


@pytest.fixture(autouse=True)
def _base(app_url):
    global BASE
    BASE = app_url.rstrip("/")


def inst(var: str) -> str:
    return os.environ[var].rstrip("/")


def eventually(fn, seconds, every=POLL_S, what=""):
    end = time.monotonic() + seconds
    last = None
    while True:
        try:
            got = fn()
            if got:
                return got
            last = got
        except (AssertionError, httpx.TransportError, queue.Empty) as exc:
            last = exc
        if time.monotonic() > end:
            raise AssertionError(f"{what} not within {seconds}s: {last!r}")
        _PACE.wait(every)


def during(seconds, check_fn, every=POLL_S):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        check_fn()
        _PACE.wait(every)


def together(fns):
    gate = threading.Barrier(len(fns))

    def run(fn):
        gate.wait()
        return fn()

    with ThreadPoolExecutor(len(fns)) as pool:
        return list(pool.map(run, fns))


def cookie_of(resp: httpx.Response) -> str:
    return "; ".join(f"{k}={v}" for k, v in resp.cookies.items())


def sign_in(email, password=PASSWORD, base=None) -> httpx.Response:
    return httpx.post(f"{base or BASE}/api/session", json={"email": email, "password": password}, timeout=TIMEOUT)


class Who:
    def __init__(self, email=None, cookie=None, bearer=None):
        self.email, self.cookie, self.bearer = email, cookie, bearer

    def call(self, method, path, body=None, *, base=None, key=None, headers=None, content=None, files=None,
             data=None, timeout=TIMEOUT):
        h = dict(headers or {})
        if self.cookie:
            h.setdefault("Cookie", self.cookie)
        if self.bearer:
            h.setdefault("Authorization", f"Bearer {self.bearer}")
        if key:
            h["Idempotency-Key"] = key
        kw = {}
        if files is not None:
            kw["files"], kw["data"] = files, data or {}
        elif content is not None:
            kw["content"] = content
        elif body is not None:
            kw["json"] = body
        return httpx.request(method, f"{base or BASE}{path}", headers=h, timeout=timeout, **kw)

    def get(self, path, **kw):
        return self.call("GET", path, **kw)

    def ok(self, method, path, body=None, status=200, **kw):
        if method != "GET" and body is None and "content" not in kw and "files" not in kw:
            body = {}
        r = self.call(method, path, body, **kw)
        assert r.status_code == status, f"{method} {path}: {r.status_code} {r.text[:600]}"
        return r.json() if r.content else None


def as_user(email) -> Who:
    if email not in _COOKIES:
        r = sign_in(email)
        assert r.status_code == 200, r.text
        _COOKIES[email] = cookie_of(r)
    return Who(email, _COOKIES[email])


def farrier() -> Who:
    return as_user(FARRIER)


class Owner(Who):
    def __init__(self, name, email, horses):
        super().__init__(email, as_user(email).cookie)
        self.name, self.horses = name, horses


def person(prefix="owner"):
    a, b = unique(prefix)
    if "@" in a:
        email, name = a, b
    elif "@" in b:
        email, name = b, a
    else:
        email, name = f"{prefix}.{uuid.uuid4().hex[:12]}@clinchline.test", a
    if not name or "@" in name:
        name = f"{prefix.title()} {uuid.uuid4().hex[:8]}"
    return name, email.lower()


def csv_bytes(rows, header=CSV_HEADER, newline="\n", bom=False) -> bytes:
    buf = io.StringIO()
    buf.write(header + newline)
    csv.writer(buf, lineterminator=newline).writerows(rows)
    return (("\ufeff" if bom else "") + buf.getvalue()).encode()


def import_csv(body: bytes, key=None, base=None) -> httpx.Response:
    return farrier().call("POST", "/api/imports", content=body, key=key or idempotency_key(), headers=CSV_CT,
                          base=base)


def new_owners(count=1, horses=1, barn=CEDAR, owner_names=None, horse_names=None):
    rows, plan = [], []
    for i in range(count):
        name, email = person("owner")
        if owner_names:
            name = owner_names[i]
        hs = []
        for j in range(horses):
            tag = uuid.uuid4().hex[:10]
            hname = horse_names[i * horses + j] if horse_names else f"Horse {tag}"
            hs.append({"name": hname, "stall": f"S{tag}"})
            rows.append([name, email, PHONE, hname, barn, hs[-1]["stall"], str(CYCLE_WEEKS)])
        plan.append((name, email, hs))
    r = import_csv(csv_bytes(rows))
    assert r.status_code == 201, r.text
    by_name = {h["name"]: h for h in farrier().ok("GET", "/api/horses")}
    out = []
    for name, email, hs in plan:
        for h in hs:
            h["id"] = by_name[h["name"]]["id"]
        out.append(Owner(name, email, hs))
    return out


def today() -> dt.date:
    return dt.date.fromisoformat(farrier().ok("GET", "/api/practice")["today"])


def barn_id(name) -> str:
    if name not in _BARNS:
        for b in farrier().ok("GET", "/api/barns"):
            _BARNS[b["name"]] = b["id"]
    return _BARNS[name]


def rand_days() -> int:
    return 400 + uuid.uuid4().int % 2500


def new_day(*, days=0, date=None, start=LATE_START, slots=4, minutes=45, fee=None, barn=CEDAR, publish=True):
    d = date or (today() + dt.timedelta(days=days)).isoformat()
    body = {"barn_id": barn_id(barn), "business_date": d, "start_time": start, "slot_count": slots,
            "slot_minutes": minutes}
    if fee is not None:
        body["trip_fee_cents"] = fee
    day = farrier().ok("POST", "/api/barn-days", body, 201)
    if publish:
        day = farrier().ok("POST", f"/api/barn-days/{day['id']}/publish")
    return day


def get_day(who, day, base=None):
    return who.ok("GET", f"/api/barn-days/{day['id']}", base=base)


def hold(owner, day, *, horse=0, slot=None, card=APPROVE, base=None) -> httpx.Response:
    if slot is None:
        slot = next(s["id"] for s in get_day(owner, day)["slots"] if s["state"] == "open")
    return owner.call("POST", f"/api/barn-days/{day['id']}/bookings",
                      {"slot_id": slot, "horse_id": owner.horses[horse]["id"], "card_token": card}, base=base)


def confirmed(owner, day, **kw):
    r = hold(owner, day, **kw)
    assert r.status_code == 201, r.text
    return owner.ok("POST", f"/api/bookings/{r.json()['id']}/confirm")


def start_day(day):
    return farrier().ok("POST", f"/api/barn-days/{day['id']}/start")


def my_bookings(owner, day):
    return [b for b in owner.ok("GET", "/api/my/bookings") if b["barn_day_id"] == day["id"]]


def payment(who, pid, base=None):
    return who.ok("GET", f"/api/payments/{pid}", base=base)


def upload(visit_id, hoof, phase, data, who=None, name="hoof.png", base=None) -> httpx.Response:
    return (who or farrier()).call("POST", f"/api/visits/{visit_id}/photos",
                                   files={"file": (name, data, "application/octet-stream")},
                                   data={"hoof": hoof, "phase": phase}, base=base)


def visit_for(booking, hoof="LF", photo=None):
    v = farrier().ok("POST", f"/api/bookings/{booking['id']}/visit", status=201)
    r = upload(v["id"], hoof, "after", photo or big_png())
    assert r.status_code == 201, r.text
    return v


def save_marks(visit_id, hoof, version, wall, pastern, who=None, base=None) -> httpx.Response:
    return (who or farrier()).call("PUT", f"/api/visits/{visit_id}/hooves/{hoof}/marks",
                                   {"version": version, "hoof_wall": wall, "pastern": pastern}, base=base)


def close_visit(visit_id, work=("trim",), key=None, base=None, note="") -> httpx.Response:
    return farrier().call("POST", f"/api/visits/{visit_id}/close", {"work": list(work), "note": note},
                          key=key or idempotency_key(), base=base)


def invoiced(owner, horse=0, work=("trim", "front_reset")):
    day = new_day(days=0, slots=1)
    b = confirmed(owner, day, horse=horse)
    start_day(day)
    v = visit_for(b)
    r = close_visit(v["id"], work)
    assert r.status_code == 200 and r.json()["status"] == "invoiced", r.text
    return r.json()["invoice"], b, day


def invoice_of(who, invoice_id, base=None):
    return next(i for i in who.ok("GET", "/api/invoices", base=base) if i["id"] == invoice_id)


def price_in_force(date: str):
    lists = [p for p in farrier().ok("GET", "/api/price-lists") if p["effective_from"] <= date]
    return max(lists, key=lambda p: p["effective_from"])


def dollars(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    c = abs(cents)
    return f"{sign}${c // 100:,}.{c % 100:02d}"


def plain_dollars(cents: int) -> str:
    return dollars(cents).replace("$", "").replace(",", "")


def cutoff_copy(ts: str) -> str:
    return f"{ts[:10]} {ts[11:16]} ({ZONE})"


def instant(ts: str) -> dt.datetime:
    return dt.datetime.fromisoformat(ts)


def juniper_id() -> str:
    return next(h for h in as_user(ADA).ok("GET", "/api/horses") if h["name"] == "Juniper")["id"]


def illegal(r, frm, action):
    assert r.status_code == 409, r.text
    body = r.json()
    assert (body["error"], body["from"], body["action"]) == ("illegal_transition", frm, action), body


def err(r, status, code):
    assert r.status_code == status, f"{r.status_code} {r.text[:400]}"
    assert r.json()["error"] == code, r.text


def inbox(mail, to, subject, expect=1, seconds=MAIL_WAIT_S):
    def mine(settle):
        return [m for m in mail.messages(settle=settle)
                if to.lower() in [a.lower() for a in addresses(m.get("To"))]
                and (subject is None or m.get("Subject") == subject)]
    if expect:
        eventually(lambda: len(mine(0.2)) >= expect, seconds, what=f"mail {subject!r}")
    return mine(1.5)


def cents(x) -> int:
    return round(float(x) * 100)


def kb_account(killbill, email):
    return killbill.account(email)


def kb_invoices(killbill, email, invoice_id):
    acct = killbill.account(email)
    if not acct:
        return []
    return [i for i in killbill.invoices(acct["accountId"])
            if any(f"[{invoice_id}]" in (it.get("description") or "") for it in i.get("items") or [])]


def kb_txns(killbill, email):
    acct = killbill.account(email)
    if not acct:
        return []
    return [t for p in killbill.payments(acct["accountId"]) for t in p.get("transactions") or []]


def kb_key(killbill, email, key):
    return [t for t in kb_txns(killbill, email) if t.get("transactionExternalKey") == key]


def pg_contains(value: str) -> list[str]:
    pg, hits = Postgres(), []
    for table in pg.tables():
        quoted = ".".join(f'"{p}"' for p in table.split("."))
        n = pg.rows(f"select count(*) as n from {quoted} t where t::text like '%{value}%'")[0]["n"]
        if int(n):
            hits.append(table)
    return hits


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(width, height, rgb=(184, 115, 51), chunks=()) -> bytes:
    raw = zlib.compress((b"\x00" + bytes(rgb) * width) * height, 9)
    out = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    for kind, data in chunks:
        out += _chunk(kind, data)
    return out + _chunk(b"IDAT", raw) + _chunk(b"IEND", b"")


@functools.lru_cache(maxsize=None)
def big_png() -> bytes:
    return png(PHOTO_W, PHOTO_H)


@functools.lru_cache(maxsize=None)
def distinct_png() -> bytes:
    return png(PHOTO_W, PHOTO_H, (30, 160, 60))


@functools.lru_cache(maxsize=None)
def png_of_size(n: int) -> bytes:
    base = png(64, 48)
    return png(64, 48, chunks=[(b"tEXt", b"Comment\x00" + b"a" * (n - len(base) - 20))])


def png_chunks(data: bytes) -> list[bytes]:
    i, out = 8, []
    while i < len(data):
        ln = struct.unpack(">I", data[i:i + 4])[0]
        out.append(data[i + 4:i + 8])
        i += 12 + ln
    return out


def jpeg_size(b: bytes):
    i = 2
    while i < len(b) - 9:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in (0xD8, 0x01, 0xFF) or 0xD0 <= m <= 0xD7:
            i += 2 if m != 0xFF else 1
            continue
        ln = struct.unpack(">H", b[i + 2:i + 4])[0]
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", b[i + 5:i + 9])
            return w, h
        i += 2 + ln
    return None


def exif_app1(orientation=6) -> bytes:
    entries = struct.pack(">HHII", 0x0112, 3, 1, orientation << 16) + struct.pack(">HHII", 0x8825, 4, 1, 38)
    tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + struct.pack(">H", 2) + entries + struct.pack(">I", 0)
    gps = struct.pack(">H", 1) + struct.pack(">HHI", 1, 2, 2) + b"N\x00\x00\x00" + struct.pack(">I", 0)
    payload = b"Exif\x00\x00" + tiff + gps
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


GIF = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="4" height="4"/></svg>'


@pytest.fixture(scope="module")
def jpeg_exif(browser):
    ctx = browser.new_context()
    pg = ctx.new_page()
    url = pg.evaluate("""() => { const c = document.createElement('canvas'); c.width = 40; c.height = 30;
        const g = c.getContext('2d'); g.fillStyle = '#c86428'; g.fillRect(0, 0, 40, 30);
        return c.toDataURL('image/jpeg', 0.9); }""")
    ctx.close()
    import base64
    raw = base64.b64decode(url.split(",", 1)[1])
    return raw[:2] + exif_app1(6) + raw[2:]


class Stream:
    def __init__(self, url, cookie=None, last_id=None, bearer=None):
        self.events: queue.Queue = queue.Queue()
        self.opened, self.ended = threading.Event(), threading.Event()
        self.status, self.retry, self.ctype = None, None, ""
        h = {"Accept": "text/event-stream"}
        if cookie:
            h["Cookie"] = cookie
        if bearer:
            h["Authorization"] = f"Bearer {bearer}"
        if last_id is not None:
            h["Last-Event-ID"] = str(last_id)
        self._client = httpx.Client(timeout=httpx.Timeout(TIMEOUT, read=None))
        threading.Thread(target=self._run, args=(url, h), daemon=True).start()
        assert self.opened.wait(TIMEOUT)

    def _run(self, url, h):
        try:
            with self._client.stream("GET", url, headers=h) as r:
                self.status, self.ctype = r.status_code, r.headers.get("content-type", "")
                self.opened.set()
                if r.status_code != 200:
                    return
                ev: dict = {}
                for line in r.iter_lines():
                    if line == "":
                        if "event" in ev or "data" in ev:
                            self.events.put(ev)
                        ev = {}
                        continue
                    if line.startswith(":"):
                        continue
                    field, _, value = line.partition(":")
                    value = value[1:] if value.startswith(" ") else value
                    if field == "retry":
                        self.retry = value
                    elif field == "data":
                        ev["data"] = (ev["data"] + "\n" + value) if "data" in ev else value
                    elif field in ("id", "event"):
                        ev[field] = value
        except httpx.HTTPError:
            pass
        finally:
            self.opened.set()
            self.ended.set()

    def ready(self):
        eventually(lambda: self.retry is not None, TIMEOUT, what="stream retry line")
        return self

    def next(self, seconds):
        try:
            ev = self.events.get(timeout=seconds)
        except queue.Empty:
            raise AssertionError(f"no event within {seconds}s")
        ev["json"] = json.loads(ev.get("data") or "{}")
        return ev

    def close(self):
        self._client.close()


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Copy:
    def __init__(self, proc, url, log):
        self.proc, self.url, self.log = proc, url, log

    def tail(self):
        return Path(self.log).read_text(errors="replace")[-4000:]

    def lines(self):
        out = []
        for line in Path(self.log).read_text(errors="replace").splitlines():
            with contextlib.suppress(ValueError):
                obj = json.loads(line)
                if isinstance(obj, dict):
                    out.append(obj)
        return out


@contextlib.contextmanager
def app_copy(env):
    port = free_port()
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("wb", suffix=".log", delete=False)
    proc = subprocess.Popen(["sh", "-c", "exec " + serve], cwd=str(DEPLOYED_APP),
                            env={**os.environ, "APP_PUBLIC_PORT": str(port), **env},
                            stdout=log, stderr=subprocess.STDOUT)
    cp = Copy(proc, f"http://127.0.0.1:{port}", log.name)

    def up():
        if proc.poll() is not None:
            raise RuntimeError(f"copy exited {proc.returncode}: {cp.tail()}")
        return httpx.get(cp.url + "/api/health", timeout=2).status_code == 200

    try:
        eventually(up, BOOT_S, every=0.5, what="copy boot")
        yield cp
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=TIMEOUT)
        log.close()


RECORDER = """(() => {
  window.__anims = []; window.__dataAnim = []; window.__notices = [];
  const roles = (el) => { const out = []; for (let n = el; n && n.getAttribute; n = n.parentElement) {
    const r = n.getAttribute('role') || (n.tagName === 'DIALOG' ? 'dialog' : n.tagName === 'TR' ? 'row' : '');
    if (r) out.push(r); } return out; };
  const rowIndex = (el) => { for (let n = el; n && n.getAttribute; n = n.parentElement) {
    if (n.tagName === 'TR' || n.getAttribute('role') === 'row') return Array.prototype.indexOf.call(n.parentElement.children, n); }
    return -1; };
  const section = (el) => { const s = el.closest && el.closest('thead, tbody, tfoot'); return s ? s.tagName : ''; };
  // started: animationstart fires once the delay is over; transitionrun and animate() fire before it
  const rec = (el, a, started) => { try { const t = a.effect.getComputedTiming(); const now = document.timeline.currentTime;
    const delay = Number(t.delay) || 0; window.__anims.push({roles: roles(el),
    row: rowIndex(el), section: section(el), duration: Number(t.duration) || 0, delay,
    infinite: t.iterations === Infinity, at: now, start: started ? now : now + delay}); } catch (e) {} };
  document.addEventListener('animationstart', (e) => e.target.getAnimations().forEach((a) => rec(e.target, a, true)), true);
  document.addEventListener('transitionrun', (e) => e.target.getAnimations().forEach((a) => rec(e.target, a, false)), true);
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); rec(this, a, false); return a; };
  new MutationObserver((ms) => ms.forEach((m) => { if (m.attributeName === 'data-anim')
    window.__dataAnim.push({name: m.target.getAttribute('data-anim'), at: document.timeline.currentTime}); }))
    .observe(document, {attributes: true, subtree: true, attributeFilter: ['data-anim']});
})();"""

WATCH_NOTICES = """(el) => { window.__notices = [el.textContent.trim()];
  new MutationObserver(() => { const t = el.textContent.trim();
    if (window.__notices[window.__notices.length - 1] !== t) window.__notices.push(t); })
  .observe(el, {childList: true, subtree: true, characterData: true}); }"""


def cookie_list(email, base):
    cookie = as_user(email).cookie
    return [{"name": k, "value": v, "url": base} for k, _, v in (p.partition("=") for p in cookie.split("; "))]


@contextlib.contextmanager
def ui(browser, email, path="/", base=None, init=False, **opts):
    b = base or BASE
    with open_app(browser, b + "/healthz", **opts) as page:
        if email:
            page.context.add_cookies(cookie_list(email, b))
        if init:
            page.context.add_init_script(RECORDER)
        page.goto(b + path)
        yield page


def see(page, assertion, seconds=20, step_ms=250):
    end = time.monotonic() + seconds
    while True:
        try:
            assertion()
            return
        except AssertionError:
            if time.monotonic() > end:
                raise
            advance(page, step_ms)


def visible(loc):
    return lambda: expect(loc).to_be_visible(timeout=300)


def has_text(loc, value):
    return lambda: expect(loc).to_contain_text(value, timeout=300)


def notices(page):
    return page.get_by_role("status", name="Notices")


def book_label(slot_time):
    return f"Book {slot_time}"


def tab_to(page, locator, presses=None):
    if presses is None:
        presses = page.evaluate(FOCUSABLE_COUNT) + 10
    for _ in range(presses):
        if locator.evaluate("e => e === document.activeElement"):
            return
        page.keyboard.press("Tab")
    raise AssertionError("control never received keyboard focus")


def shown(box):
    return box.evaluate("e => (e.selectedOptions ? (e.selectedOptions[0] || {}).textContent || '' : e.textContent).trim()")


def option_text(box):
    got = box.evaluate("""e => e.options ? [...e.options].map(o => o.textContent.trim()).join('|')
        : ((document.getElementById(e.getAttribute('aria-controls') || '') || {}).textContent || '')""")
    if got or box.evaluate("e => !!e.options"):
        return got
    page = box.page
    got = " | ".join(page.get_by_role("option").all_inner_texts())
    if got:
        return got
    before = page.evaluate_handle("() => document.activeElement")
    click(box)
    advance(page, POLL_S * 1000)
    ref = box.evaluate("e => e.getAttribute('aria-controls')")
    listbox = page.locator(f"[id='{ref}']") if ref else page.get_by_role("listbox").first
    got = listbox.inner_text()
    page.keyboard.press("Escape")
    advance(page, POLL_S * 1000)
    before.evaluate("e => e && e.focus && e.focus()")
    return got


def big_enough(page):
    for role in ("button", "radio", "checkbox", "slider"):
        for loc in page.get_by_role(role).all():
            if loc.is_visible():
                box = loc.evaluate(TAP_TARGET)
                assert box["width"] >= TAP_PX and box["height"] >= TAP_PX, (role, loc.get_attribute("aria-label"), box)


DIALOG_STYLE = """d => [d, d.firstElementChild].filter(Boolean)
  .map(x => { const s = getComputedStyle(x); return `${s.transform}|${s.opacity}|${s.scale}`; }).join(' ')"""
ROW_STYLES = """t => [...t.querySelectorAll('tbody tr, [role=rowgroup]:not(:first-of-type) [role=row]')].slice(0, 6)
  .map(r => { const s = getComputedStyle(r); return `${s.opacity}|${s.transform}|${s.clipPath}`; })"""
TAP_TARGET = """e => { const r = e.getBoundingClientRect();
  const lab = e.closest('label') || (e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`) : null);
  const t = lab ? lab.getBoundingClientRect() : r;
  return {width: Math.max(r.width, t.width), height: Math.max(r.height, t.height)}; }"""
CHART_TEXT = """e => { const ids = [...e.querySelectorAll('[aria-labelledby],[aria-describedby]'), e]
    .flatMap(x => `${x.getAttribute('aria-labelledby') || ''} ${x.getAttribute('aria-describedby') || ''}`.split(/\\s+/));
  return [e.innerText, e.getAttribute('aria-label'),
    ...[...e.querySelectorAll('[aria-label]')].map(x => x.getAttribute('aria-label')),
    ...[...e.querySelectorAll('title, desc')].map(x => x.textContent),
    ...ids.filter(Boolean).map(i => document.getElementById(i)?.textContent || '')]
    .filter(Boolean).join(' ').replace(/\\s+/g, ' '); }"""
FOCUSABLE_COUNT = """() => document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length"""
CHOICE_POINT = """e => { const r = e.getBoundingClientRect();
  const lab = e.closest('label') || (e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`) : null);
  const t = (r.width < 2 || r.height < 2) && lab ? lab.getBoundingClientRect() : r;
  return {x: t.x + t.width / 2, y: t.y + t.height / 2}; }"""
DIVIDER_VALUE = "e => e.getAttribute('aria-valuenow') ?? (e.matches('input') ? e.value : null)"


def click_choice(loc):
    point = loc.evaluate(CHOICE_POINT)
    loc.page.mouse.click(point["x"], point["y"])


def divider_is(slider, value, timeout=5000):
    end = time.monotonic() + timeout / 1000
    while True:
        got = slider.evaluate(DIVIDER_VALUE)
        if got is not None and float(got) == float(value):
            return
        if time.monotonic() > end:
            raise AssertionError(f"divider is {got!r}, expected {value!r}")
        _PACE.wait(POLL_S)


def test_sign_in_roles():
    (owner,) = new_owners(1)
    for email, role in [(FARRIER, "farrier"), (APPRENTICE, "apprentice"), (MANAGER_CEDAR, "barn_manager"),
                        (owner.email, "owner")]:
        r = sign_in(email)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == role and r.json()["user"]["email"] == email
        sc = r.headers.get("set-cookie", "").lower()
        assert "HttpOnly".lower() in sc and "SameSite=Lax".lower() in sc
        me = Who(email, cookie_of(r)).get("/api/me")
        assert me.status_code == 200 and me.json()["role"] == role
    err(sign_in(owner.email, "wrong-password-probe"), 401, "invalid_credentials")
    err(httpx.get(f"{BASE}/api/me", timeout=TIMEOUT), 401, "unauthenticated")
    err(httpx.get(f"{BASE}/api/horses", timeout=TIMEOUT), 401, "unauthenticated")
    fresh = Who(owner.email, cookie_of(sign_in(owner.email)))
    assert fresh.call("DELETE", "/api/session").status_code == 204
    err(fresh.get("/api/me"), 401, "unauthenticated")


def test_price_lists_effective():
    f = farrier()
    d1 = dt.date(2200 + uuid.uuid4().int % 6000, 1, 1) + dt.timedelta(days=uuid.uuid4().int % 300)
    d2 = d1 + dt.timedelta(days=30)
    dep1, dep2 = 1000 + uuid.uuid4().int % 900, 2000 + uuid.uuid4().int % 900
    prices = {"trim": 5100, "front_reset": 11000, "full_reset": 18000, "front_new": 14000, "full_new": 23000}
    l1 = f.ok("POST", "/api/price-lists", {"effective_from": d1.isoformat(), "deposit_cents": dep1, "prices": prices}, 201)
    assert (l1["effective_from"], l1["deposit_cents"], l1["prices"]) == (d1.isoformat(), dep1, prices)
    l2 = f.ok("POST", "/api/price-lists", {"effective_from": d2.isoformat(), "deposit_cents": dep2, "prices": prices}, 201)
    err(f.call("POST", "/api/price-lists", {"effective_from": d1.isoformat(), "deposit_cents": 1, "prices": prices}),
        409, "price_list_exists")
    bad = f.call("POST", "/api/price-lists", {"effective_from": (d2 + dt.timedelta(days=1)).isoformat(),
                                               "deposit_cents": DEPOSIT_MAX + 1, "prices": prices})
    assert bad.status_code == 422 and "deposit_cents" in bad.json()["errors"]
    err(as_user(APPRENTICE).call("POST", "/api/price-lists", {"effective_from": d1.isoformat(), "deposit_cents": 1,
                                                               "prices": prices}), 403, "forbidden")
    ids = [p["id"] for p in f.ok("GET", "/api/price-lists")]
    assert ids.index(l2["id"]) < ids.index(l1["id"])
    (o,) = new_owners(1, horses=3)
    for horse, date, dep in [(0, d1 + dt.timedelta(days=10), dep1), (1, d2, dep2),
                             (2, d1 - dt.timedelta(days=1), price_in_force((d1 - dt.timedelta(days=1)).isoformat())["deposit_cents"])]:
        day = new_day(date=date.isoformat(), start="07:30", slots=1)
        r = hold(o, day, horse=horse)
        assert r.status_code == 201, r.text
        assert r.json()["deposit_cents"] == dep
        assert payment(o, r.json()["payment_id"])["amount_cents"] == dep
        o.call("DELETE", f"/api/bookings/{r.json()['id']}")


DST_CASES = {
    "spring_forward": ("2027-03-14", "07:30", "2027-03-14T07:30:00-06:00", "2027-03-13T06:30:00-07:00"),
    "fall_back_repeated": ("2027-11-07", "01:30", "2027-11-07T01:30:00-06:00", "2027-11-06T01:30:00-06:00"),
    "fall_back_after": ("2027-11-07", "07:30", "2027-11-07T07:30:00-07:00", "2027-11-06T08:30:00-06:00"),
    "nonexistent": ("2027-03-14", "02:30", None, None),
}


@pytest.mark.parametrize("case", list(DST_CASES), ids=list(DST_CASES))
def test_wf_practice_setup_dst(case):
    date, start, starts_at, cutoff = DST_CASES[case]
    f = farrier()
    body = {"barn_id": barn_id(CEDAR), "business_date": date, "start_time": start, "slot_count": 1, "slot_minutes": 60}
    r = f.call("POST", "/api/barn-days", body)
    if starts_at is None:
        assert r.status_code == 422, r.text
        assert r.json()["errors"]["start_time"] == f"That time does not exist on that date in {ZONE}."
        draft = f.ok("POST", "/api/barn-days", {**body, "start_time": "07:30"}, 201)
        p = f.call("PATCH", f"/api/barn-days/{draft['id']}", {**body, "start_time": start})
        assert p.status_code == 422 and "start_time" in p.json()["errors"]
        return
    assert r.status_code == 201, r.text
    day = r.json()
    assert (day["starts_at"], day["cancellation_cutoff_at"], day["time_zone"]) == (starts_at, cutoff, ZONE)
    assert instant(starts_at) - instant(cutoff) == dt.timedelta(hours=24)
    assert f.ok("GET", f"/api/barn-days/{day['id']}")["cancellation_cutoff_at"] == cutoff
    assert f.ok("GET", "/api/practice")["time_zone"] == ZONE


def test_barn_day_business_time():
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(ZONE)
    for days in (rand_days(), rand_days()):
        date = today() + dt.timedelta(days=days)
        day = new_day(date=date.isoformat(), start="07:30", slots=1, publish=False)
        local = dt.datetime.combine(date, dt.time(7, 30), tzinfo=tz)
        cut = (local.astimezone(dt.timezone.utc) - dt.timedelta(hours=24)).astimezone(tz)
        assert day["starts_at"] == local.isoformat(timespec="seconds")
        assert day["cancellation_cutoff_at"] == cut.isoformat(timespec="seconds")
        assert (day["business_date"], day["start_time"], day["time_zone"]) == (date.isoformat(), "07:30", ZONE)
        assert farrier().ok("GET", f"/api/barn-days/{day['id']}")["starts_at"] == day["starts_at"]
    assert farrier().ok("GET", "/api/practice")["time_zone"] == ZONE


def test_wf_practice_setup_state_machine(mail):
    f = farrier()
    o1, o2 = new_owners(2)
    day = new_day(days=3, publish=False, slots=1)
    path = f"/api/barn-days/{day['id']}"
    illegal(f.call("POST", path + "/start", {}), "draft", "start")
    illegal(f.call("POST", path + "/close", {}), "draft", "close")
    assert f.ok("PATCH", path, {"barn_id": barn_id(CEDAR), "business_date": day["business_date"],
                                 "start_time": "07:30", "slot_count": 2, "slot_minutes": 45})["slot_count"] == 2
    assert f.ok("POST", path + "/publish")["status"] == "published"
    illegal(f.call("POST", path + "/publish", {}), "published", "publish")
    illegal(f.call("PATCH", path, {"slot_count": 3}), "published", "edit")
    err(f.call("POST", path + "/start", {}), 409, "too_early")
    b1 = confirmed(o1, day)
    h2 = hold(o2, day)
    assert h2.status_code == 201
    d = f.ok("GET", path)
    assert (d["status"], d["booked_count"]) == ("full", 2)
    illegal(f.call("POST", path + "/publish", {}), "full", "publish")
    assert o2.call("DELETE", f"/api/bookings/{h2.json()['id']}").status_code == 204
    assert f.ok("GET", path)["status"] == "published"
    h3 = hold(o2, day)
    assert f.ok("POST", path + "/cancel")["status"] == "cancelled"
    illegal(f.call("POST", path + "/cancel", {}), "cancelled", "cancel")
    illegal(f.call("POST", path + "/start", {}), "cancelled", "start")
    err(o2.call("POST", f"/api/bookings/{h3.json()['id']}/confirm", {}), 409, "hold_expired")
    assert payment(o2, h3.json()["payment_id"])["status"] == "voided"
    mine = [b for b in o1.ok("GET", "/api/my/bookings") if b["id"] == b1["id"]][0]
    assert mine["status"] == "cancelled_in_time"
    assert payment(o1, b1["payment_id"])["status"] == "refunded"
    h = o1.horses[0]["name"]
    msgs = inbox(mail, o1.email, f"Cancelled: {h} at {CEDAR} on {day['business_date']}")
    assert len(msgs) == 1 and "No trip share applies." in text(msgs[0])


def test_wf_practice_setup_import():
    f, t = farrier(), uuid.uuid4().hex[:8]
    a_name, a_email = person("importa")
    b_name, b_email = person("importb")
    c_name, c_email = person("importc")
    rows = [
        ([a_name, a_email, PHONE, f"Horse {t}a", CEDAR, f"S{t}a", "6"], None),
        ([f"{b_name}\nline", b_email, PHONE, f"Horse {t}b", CEDAR, f"S{t}b", "6"], None),
        ([c_name, "not-an-email", PHONE, f"Horse {t}c", CEDAR, f"S{t}c", "6"], ("owner_email", "invalid_email")),
        ([c_name, c_email, PHONE, f"Horse {t}d", "Nowhere Barn Probe", f"S{t}d", "6"], ("barn_name", "unknown_barn")),
        ([c_name, c_email, PHONE, f"Horse {t}e", CEDAR, f"S{t}e", "4"], ("cycle_weeks", "cycle_out_of_range")),
        ([c_name, c_email, "", f"Horse {t}f", CEDAR, f"S{t}f", "6"], ("owner_phone", "missing_value")),
        ([a_name, a_email, PHONE, f"Horse {t}a", CEDAR, f"S{t}g", "6"], ("horse_name", "duplicate_row")),
        ([c_name, c_email, PHONE, f"Horse {t}h", CEDAR, f"S{t}a", "6"], ("stall", "stall_taken")),
        ([c_name, c_email, PHONE, f"Horse {t}i", CEDAR, "4", "6"], ("stall", "stall_taken")),
        ([f"Other {t}", a_email, PHONE, f"Horse {t}j", CEDAR, f"S{t}j", "6"], ("owner_name", "owner_name_mismatch")),
    ]
    expected, line = [], 2
    for cells, bad in rows:
        if bad:
            expected.append({"line": line, "column": bad[0], "code": bad[1]})
        line += 1 + sum(c.count("\n") for c in cells)
    r = import_csv(csv_bytes([c for c, _ in rows]))
    assert r.status_code == 422 and r.json()["error"] == "import_invalid", r.text
    assert [{k: e[k] for k in ("line", "column", "code")} for e in r.json()["errors"]] == expected
    names = {h["name"] for h in f.ok("GET", "/api/horses")}
    assert f"Horse {t}a" not in names and f"Horse {t}b" not in names
    assert sign_in(b_email).status_code == 401
    hdr = import_csv(b"owner,email\nx,y\n")
    assert hdr.status_code == 422 and hdr.json()["errors"] == [{"line": 1, "column": "header", "code": "bad_header"}]
    many = import_csv(csv_bytes([["x", "y", "z", "w", "v", "u", "6"]] * (IMPORT_ROW_LIMIT + 1)))
    assert many.status_code == 422
    assert many.json()["errors"] == [{"line": 1, "column": "header", "code": "too_many_rows"}]


def test_import_matching():
    f, t = farrier(), uuid.uuid4().hex[:8]
    d_name, d_email = person("importd")
    e_name, e_email = person("importe")
    good = [[d_name, d_email, PHONE, f"Horse {t}k", CEDAR, f"S{t}k", "6"],
            [e_name, e_email, PHONE, f"Horse {t}l", CEDAR, f"S{t}l", "6"]]
    body, key = csv_bytes(good, newline="\r\n", bom=True), idempotency_key()
    r1 = import_csv(body, key)
    assert r1.status_code == 201, r1.text
    c = r1.json()
    assert (c["created_owners"], c["matched_owners"], c["created_horses"], c["updated_horses"]) == (2, 0, 2, 0)
    replay = import_csv(body, key)
    assert replay.status_code == 201 and replay.json() == c
    err(import_csv(csv_bytes(good[:1]), key), 409, "idempotency_conflict")
    again = import_csv(body).json()
    assert (again["created_owners"], again["matched_owners"], again["created_horses"], again["updated_horses"]) == (0, 2, 0, 0)
    upd = import_csv(csv_bytes([[d_name, d_email, PHONE, f"Horse {t}k", CEDAR, f"S{t}k", "8"]])).json()
    assert (upd["created_horses"], upd["updated_horses"]) == (0, 1)
    horses = [h for h in f.ok("GET", "/api/horses") if h["name"] == f"Horse {t}k"]
    assert len(horses) == 1 and horses[0]["cycle_weeks"] == 8 and horses[0]["owner"]["name"] == d_name
    assert sign_in(d_email).status_code == 200
    g_name, g_email = person("importg")
    race = csv_bytes([[g_name, g_email, PHONE, f"Horse {t}m", CEDAR, f"S{t}m", "6"]])
    res = together([lambda: import_csv(race), lambda: import_csv(race, base=inst(PEER))])
    assert [x.status_code for x in res] == [201, 201], [x.text for x in res]
    assert sorted(x.json()["created_horses"] for x in res) == [0, 1]
    assert sorted(x.json()["created_owners"] for x in res) == [0, 1]
    assert len([h for h in f.ok("GET", "/api/horses") if h["name"] == f"Horse {t}m"]) == 1


def test_wf_practice_setup_new_day_ui(browser):
    date = (today() + dt.timedelta(days=rand_days())).isoformat()
    with ui(browser, FARRIER, "/") as page:
        see(page, visible(page.get_by_role("button", name="New barn day")))
        click(page.get_by_role("button", name="New barn day"))
        dlg = page.get_by_role("dialog", name="New barn day")
        see(page, visible(dlg))
        select(dlg.get_by_role("combobox", name="Barn"), CEDAR)
        fill(dlg.get_by_role("textbox", name="Date"), "2027-03-14")
        fill(dlg.get_by_role("textbox", name="Start time"), "02:30")
        fill(dlg.get_by_role("spinbutton", name="Slots"), "3")
        fill(dlg.get_by_role("spinbutton", name="Minutes per slot"), "45")
        fill(dlg.get_by_role("textbox", name="Trip fee"), "45.00")
        click(dlg.get_by_role("button", name="Save draft"))
        start_box = dlg.get_by_role("textbox", name="Start time")
        see(page, lambda: expect(start_box).to_have_accessible_description(
            re.compile(re.escape(f"That time does not exist on that date in {ZONE}.")), timeout=300))
        fill(dlg.get_by_role("textbox", name="Date"), date)
        fill(start_box, "07:30")
        click(dlg.get_by_role("button", name="Save draft"))
        see(page, has_text(notices(page), "Draft saved."))
        link = page.get_by_role("navigation", name="Barn days").get_by_role("link", name=f"{date} {CEDAR} 0/3")
        see(page, visible(link))
        click(link)
        see(page, visible(page.get_by_role("button", name="Publish day")))
        day = next(d for d in farrier().ok("GET", "/api/barn-days")
                   if d["business_date"] == date and d["barn"]["name"] == CEDAR and d["slot_count"] == 3)
        assert urlparse(page.url).path == f"/days/{day['id']}"
        assert day["status"] == "draft"
        click(page.get_by_role("button", name="Publish day"))
        see(page, has_text(notices(page), "Day published."))
        see(page, has_text(page.get_by_role("main"), f"Cancel by {cutoff_copy(day['cancellation_cutoff_at'])}"))
        expect(link).to_have_attribute("aria-current", "page")
    d = farrier().ok("GET", f"/api/barn-days/{day['id']}")
    assert (d["status"], d["booked_count"], d["slot_count"], d["trip_fee_cents"]) == ("published", 0, 3, FEE_4500)


def test_owner_day_visibility():
    mine, other = new_owners(2)
    (lark,) = new_owners(1, barn=LARK)
    pub = new_day(days=7, start="07:30", slots=2)
    draft = new_day(days=7, publish=False)
    gone = new_day(days=7)
    farrier().ok("POST", f"/api/barn-days/{gone['id']}/cancel")
    b = confirmed(other, pub, slot=pub["slots"][0]["id"])
    r = mine.call("GET", f"/api/barn-days/{pub['id']}")
    assert r.status_code == 200
    slots = r.json()["slots"]
    assert (slots[0]["state"], slots[0]["my_booking_id"], slots[1]["state"]) == ("taken", None, "open")
    for leak in (other.horses[0]["name"], other.email, other.name):
        assert leak not in r.text
    assert get_day(other, pub)["slots"][0]["my_booking_id"] == b["id"]
    listed = {d["id"] for d in mine.ok("GET", "/api/barn-days")}
    assert pub["id"] in listed and draft["id"] not in listed and gone["id"] not in listed
    assert pub["id"] not in {d["id"] for d in lark.ok("GET", "/api/barn-days")}
    for who, day in [(mine, draft), (mine, gone), (lark, pub)]:
        err(who.call("GET", f"/api/barn-days/{day['id']}"), 404, "not_found")
    err(mine.call("GET", f"/api/barn-days/{pub['id']}/bookings"), 403, "forbidden")


def test_wf_owner_booking_hold_confirm(mail):
    o1, o2 = new_owners(2)
    day = new_day(days=4, start="07:30", slots=4)
    dep = price_in_force(day["business_date"])["deposit_cents"]
    s0, s1 = day["slots"][0]["id"], day["slots"][1]["id"]
    res = together([lambda: hold(o1, day, slot=s0), lambda: hold(o2, day, slot=s0, base=inst(PEER))])
    assert sorted(r.status_code for r in res) == [201, 409], [r.text for r in res]
    win_i = 0 if res[0].status_code == 201 else 1
    w, l = (o1, o2) if win_i == 0 else (o2, o1)
    assert res[1 - win_i].json()["error"] == "slot_taken"
    assert w.horses[0]["name"] not in res[1 - win_i].text
    b = res[win_i].json()
    assert (b["status"], b["deposit_cents"]) == ("held", dep) and b["hold_expires_at"]
    p = payment(w, b["payment_id"])
    assert (p["kind"], p["status"], p["amount_cents"]) == ("deposit", "authorized", dep)
    d = get_day(w, day)
    assert d["booked_count"] == 1 and d["slots"][0]["state"] == "taken" and d["slots"][0]["my_booking_id"] == b["id"]
    c = w.ok("POST", f"/api/bookings/{b['id']}/confirm")
    assert c["status"] == "confirmed" and c["hold_expires_at"] is None
    p = payment(w, b["payment_id"])
    assert (p["status"], p["disposition"]) == ("captured", "held")
    r = hold(l, day, slot=s1)
    assert r.status_code == 201
    assert l.call("DELETE", f"/api/bookings/{r.json()['id']}").status_code == 204
    assert get_day(l, day)["slots"][1]["state"] == "open"
    assert payment(l, r.json()["payment_id"])["status"] == "voided"
    err(l.call("DELETE", f"/api/bookings/{r.json()['id']}"), 404, "not_found")


def test_booking_confirmation_email(mail):
    o, l = new_owners(2)
    day = new_day(days=4, start="07:30", slots=2)
    r = hold(o, day, slot=day["slots"][0]["id"])
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    subject = f"Booked: {o.horses[0]['name']} at {CEDAR} on {day['business_date']}"
    assert inbox(mail, o.email, subject, expect=0) == []
    assert o.ok("POST", f"/api/bookings/{bid}/confirm")["status"] == "confirmed"
    assert o.ok("POST", f"/api/bookings/{bid}/confirm")["status"] == "confirmed"
    msgs = inbox(mail, o.email, subject)
    assert len(msgs) == 1
    body = text(msgs[0])
    assert "07:30" in body and f"Cancel by {cutoff_copy(day['cancellation_cutoff_at'])}" in body
    r2 = hold(l, day, slot=day["slots"][1]["id"])
    assert r2.status_code == 201
    assert l.call("DELETE", f"/api/bookings/{r2.json()['id']}").status_code == 204
    assert inbox(mail, l.email, f"Booked: {l.horses[0]['name']} at {CEDAR} on {day['business_date']}", expect=0) == []


def test_wf_owner_booking_keyboard_ui(browser):
    (o,) = new_owners(1)
    (other,) = new_owners(1)
    day = new_day(days=6, start="07:30", slots=3)
    confirmed(other, day, slot=day["slots"][1]["id"])
    h = o.horses[0]["name"]
    with ui(browser, o.email, f"/days/{day['id']}") as page:
        page.clock.set_system_time(dt.datetime.combine(today() + dt.timedelta(days=40), dt.time(12)))
        table = page.get_by_role("table", name="Slots")
        see(page, has_text(table, "Taken"))
        assert other.horses[0]["name"] not in page.content()
        book = page.get_by_role("button", name=book_label("07:30"))
        tab_to(page, book)
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Confirm booking")
        see(page, visible(dlg))
        confirm = dlg.get_by_role("button", name="Confirm booking")
        expect(confirm).to_be_focused()
        held_b = next(b for b in my_bookings(o, day) if b["status"] == "held")
        dep = held_b["deposit_cents"]
        body = (f"Hold 07:30 on {day['business_date']} at {CEDAR} for {h}. "
                + (f"Deposit {dollars(dep)}. " if dep else "")
                + f"Cancel by {cutoff_copy(day['cancellation_cutoff_at'])} or the trip share still applies. "
                + f"Hold ends at {held_b['hold_expires_at'][11:19]} ({ZONE}).")
        expect(dlg).to_contain_text(body)
        for key in ["Tab"] * 5 + ["Shift+Tab"] * 5:
            page.keyboard.press(key)
            assert dlg.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        see(page, lambda: expect(dlg).to_be_hidden(timeout=300))
        expect(book).to_be_focused()
        eventually(lambda: not [b for b in my_bookings(o, day) if b["status"] == "held"], TIMEOUT)
        page.keyboard.press("Enter")
        see(page, visible(dlg))
        expect(confirm).to_be_focused()
        page.keyboard.press("Enter")
        cancel_btn = page.get_by_role("button", name=f"Cancel booking for {h}")
        see(page, lambda: expect(cancel_btn).to_be_focused(timeout=300))
        see(page, has_text(notices(page), f"Booked {h} for 07:30 on {day['business_date']}. A confirmation email is on its way."))
    assert [b["status"] for b in my_bookings(o, day)] == ["confirmed"]


def test_wf_owner_booking_lapse():
    a, b, c, d = new_owners(4)
    lapse_day = new_day(days=5, start="07:30", slots=1)
    r = hold(a, lapse_day, base=inst(FAST))
    assert r.status_code == 201, r.text
    hb = r.json()
    assert get_day(farrier(), lapse_day)["status"] == "full"
    eventually(lambda: get_day(farrier(), lapse_day)["slots"][0]["state"] == "open", HOLD_FAST_S + JOB_SLACK_S)
    dd = get_day(farrier(), lapse_day)
    assert (dd["status"], dd["booked_count"]) == ("published", 0)
    err(a.call("POST", f"/api/bookings/{hb['id']}/confirm", {}), 409, "hold_expired")
    assert payment(a, hb["payment_id"])["status"] == "voided"
    assert my_bookings(a, lapse_day) == []
    assert hold(d, lapse_day).status_code == 201


def test_waitlist_offer(mail):
    a, b, c, d = new_owners(4)
    wday = new_day(days=5, start="07:30", slots=1)
    assert hold(a, wday, base=inst(FAST)).status_code == 201
    err(hold(b, wday, slot=wday["slots"][0]["id"]), 409, "day_full")
    jb = b.ok("POST", f"/api/barn-days/{wday['id']}/waitlist", {"horse_id": b.horses[0]["id"], "card_token": HARD}, 201)
    jc = c.ok("POST", f"/api/barn-days/{wday['id']}/waitlist", {"horse_id": c.horses[0]["id"], "card_token": APPROVE}, 201)
    assert (jb["position"], jc["position"]) == (1, 2)
    err(c.call("POST", f"/api/barn-days/{wday['id']}/waitlist", {"horse_id": c.horses[0]["id"], "card_token": APPROVE}),
        409, "already_on_waitlist")
    stranger = []

    def offered():
        r2 = hold(d, wday, slot=wday["slots"][0]["id"])
        stranger.append(r2)
        assert r2.status_code == 409 and r2.json()["error"] in ("day_full", "slot_taken"), r2.text
        return [x for x in my_bookings(c, wday) if x["status"] == "held" and x["offer"]]

    offers = eventually(offered, HOLD_FAST_S + JOB_SLACK_S, every=1)
    assert all(x.status_code == 409 for x in stranger)
    offer = offers[0]
    assert c.ok("POST", f"/api/bookings/{offer['id']}/confirm")["status"] == "confirmed"
    assert farrier().ok("GET", f"/api/barn-days/{wday['id']}/waitlist") == []
    assert my_bookings(b, wday) == []
    msg = inbox(mail, c.email, f"Slot offered: {c.horses[0]['name']} at {CEDAR} on {wday['business_date']}")
    assert len(msg) == 1 and f"Hold ends at {offer['hold_expires_at'][11:19]} ({ZONE})." in text(msg[0])
    assert len(inbox(mail, b.email, f"Slot offer lapsed: {b.horses[0]['name']} at {CEDAR} on {wday['business_date']}")) == 1


def test_wf_owner_booking_hold_allowance():
    (o,) = new_owners(1)
    day = new_day(days=4, slots=1)
    body = {"slot_id": "probe-unknown-slot", "horse_id": o.horses[0]["id"], "card_token": APPROVE}
    t0, first = time.monotonic(), None
    for i in range(HOLD_CAP + 10):
        r = o.call("POST", f"/api/barn-days/{day['id']}/bookings", body, base=inst(PEER) if i % 2 else None)
        if r.status_code == 429:
            first = (i, r)
            break
        assert r.status_code == 404 and r.headers.get("RateLimit-Limit"), r.text
    assert first, "no 429"
    i, r = first
    refill = int((time.monotonic() - t0) * HOLD_REFILL / 60) + 1
    assert HOLD_CAP <= i <= HOLD_CAP + refill
    assert r.json() == {"error": "rate_limited", "bucket": "hold", "scope": "user"}
    assert int(r.headers["Retry-After"]) >= 1
    assert r.headers["RateLimit-Limit"] == str(HOLD_CAP) and r.headers["RateLimit-Remaining"] == "0"
    assert int(r.headers["RateLimit-Reset"]) >= 1
    assert my_bookings(o, day) == []
    assert get_day(farrier(), day)["booked_count"] == 0


def test_wf_last_slot_race_one_winner():
    owners = new_owners(6)
    day = new_day(days=8, slots=2)
    confirmed(owners[0], day, slot=day["slots"][0]["id"])
    last = day["slots"][1]["id"]
    rest = owners[1:]
    res = together([lambda o=o, i=i: hold(o, day, slot=last, base=inst(PEER) if i % 2 else None)
                    for i, o in enumerate(rest)])
    assert [r.status_code for r in res].count(201) == 1, [r.text for r in res]
    winner = rest[[r.status_code for r in res].index(201)]
    losers = [o for o, r in zip(rest, res) if r.status_code != 201]
    for o, r in zip(rest, res):
        if r.status_code != 201:
            err(r, 409, "day_full")
            assert winner.horses[0]["name"] not in r.text and winner.email not in r.text
            assert winner.horses[0]["name"] not in o.get(f"/api/barn-days/{day['id']}").text
            assert my_bookings(o, day) == []
    joins = together([lambda o=o: o.call("POST", f"/api/barn-days/{day['id']}/waitlist",
                                         {"horse_id": o.horses[0]["id"], "card_token": APPROVE}) for o in losers])
    assert all(j.status_code == 201 for j in joins), [j.text for j in joins]
    assert sorted(j.json()["position"] for j in joins) == list(range(1, len(losers) + 1))
    wl = farrier().ok("GET", f"/api/barn-days/{day['id']}/waitlist")
    assert [w["position"] for w in wl] == list(range(1, len(losers) + 1))
    assert {w["horse"]["id"] for w in wl} == {o.horses[0]["id"] for o in losers}


def test_wf_last_slot_race_counts(browser):
    owners = new_owners(7)
    day = new_day(days=rand_days(), slots=3)
    slots = [s["id"] for s in day["slots"]]
    first = together([lambda i=i: hold(owners[i], day, slot=slots[i]) for i in range(3)])
    assert [r.status_code for r in first] == [201, 201, 201]
    ids = [r.json()["id"] for r in first]
    ops = [lambda: owners[0].call("POST", f"/api/bookings/{ids[0]}/confirm", {}),
           lambda: owners[1].call("DELETE", f"/api/bookings/{ids[1]}"),
           lambda: owners[2].call("POST", f"/api/bookings/{ids[2]}/confirm", {}, base=inst(PEER))]
    ops += [lambda o=o: o.call("POST", f"/api/barn-days/{day['id']}/waitlist",
                               {"horse_id": o.horses[0]["id"], "card_token": APPROVE}) for o in owners[3:]]
    together(ops)
    d = get_day(farrier(), day)
    taken = sum(s["state"] == "taken" for s in d["slots"])
    assert d["booked_count"] == taken
    assert (d["status"] == "full") == (taken == 3)
    wl = farrier().ok("GET", f"/api/barn-days/{day['id']}/waitlist")
    assert [w["position"] for w in wl] == list(range(1, len(wl) + 1))
    live = [b for o in owners for b in my_bookings(o, day) if b["status"] in LIVE]
    assert len(live) == taken
    assert not {b["horse"]["id"] for b in live} & {w["horse"]["id"] for w in wl}
    assert next(x for x in farrier().ok("GET", "/api/barn-days") if x["id"] == day["id"])["booked_count"] == taken
    with ui(browser, FARRIER, f"/days/{day['id']}") as page:
        rail = page.get_by_role("navigation", name="Barn days")
        see(page, visible(rail.get_by_role("link", name=f"{day['business_date']} {CEDAR} {taken}/3")))


def test_wf_barn_manager_list_projection():
    o1, o2, o3 = new_owners(3)
    day = new_day(days=rand_days(), start="07:30", slots=4)
    b1 = confirmed(o1, day)
    b2 = hold(o2, day).json()
    b3 = confirmed(o3, day)
    o3.ok("POST", f"/api/bookings/{b3['id']}/cancel")
    path = f"/api/barn-days/{day['id']}/bookings"
    frows = farrier().ok("GET", path)
    assert all(set(r) == FARRIER_ROW_KEYS for r in frows)
    assert {r["booking_id"] for r in frows} == {b1["id"], b3["id"]} and b2["id"] not in str(frows)
    arows = as_user(APPRENTICE).ok("GET", path)
    assert all(set(r) == APPRENTICE_ROW_KEYS for r in arows) and len(arows) == 2
    m = as_user(MANAGER_CEDAR)
    r = m.call("GET", path)
    assert r.status_code == 200 and all(set(x) == MANAGER_ROW_KEYS for x in r.json())
    assert [x["horse_name"] for x in r.json()] == [o1.horses[0]["name"]]
    assert r.json()[0]["stall"] == o1.horses[0]["stall"]
    for leak in (o1.email, o1.name, PHONE):
        assert leak not in r.text
    md = m.ok("GET", f"/api/barn-days/{day['id']}")
    assert "trip_fee_cents" not in md and all("my_booking_id" not in s for s in md["slots"])
    err(as_user(MANAGER_LARK).call("GET", path), 404, "not_found")
    err(as_user(MANAGER_LARK).call("GET", f"/api/barn-days/{day['id']}"), 404, "not_found")
    err(o1.call("GET", path), 403, "forbidden")


def test_wf_barn_manager_list_ready_sheet_ui(browser):
    o1, o2 = new_owners(2)
    day = new_day(days=rand_days(), start="07:30", slots=3)
    confirmed(o1, day, slot=day["slots"][0]["id"])
    lark = new_day(days=rand_days(), barn=LARK, slots=1)
    with open_app(browser, f"{BASE}/days/{day['id']}") as page:
        form = page.get_by_role("form", name="Sign in")
        see(page, visible(form))
        fill(form.get_by_role("textbox", name="Email"), MANAGER_CEDAR)
        fill(form.get_by_label("Password"), PASSWORD)
        click(form.get_by_role("button", name="Sign in"))
        sheet = page.get_by_role("table", name="Ready sheet")
        see(page, has_text(sheet, o1.horses[0]["name"]))
        assert urlparse(page.url).path == f"/days/{day['id']}"
        expect(sheet).to_contain_text(o1.horses[0]["stall"])
        expect(sheet).not_to_contain_text(o1.email)
        page.reload()
        see(page, has_text(page.get_by_role("table", name="Ready sheet"), o1.horses[0]["name"]))
        rail = page.get_by_role("navigation", name="Barn days")
        expect(rail.get_by_role("link", name=re.compile(re.escape(LARK)))).to_have_count(0)
        page.evaluate("window.__noReload = 1")
        b2 = confirmed(o2, day, slot=day["slots"][1]["id"], base=inst(PEER))
        see(page, has_text(sheet, o2.horses[0]["name"]), seconds=30)
        o2.ok("POST", f"/api/bookings/{b2['id']}/cancel")
        see(page, lambda: expect(sheet).not_to_contain_text(o2.horses[0]["name"], timeout=300), seconds=30)
        assert page.evaluate("window.__noReload") == 1
        page.goto(f"{BASE}/days/{lark['id']}")
        see(page, has_text(page.get_by_role("main"), "This barn day isn't available."))
        expect(page.get_by_role("table", name="Ready sheet")).to_have_count(0)


def test_wf_barn_manager_list_stream():
    o1, o2 = new_owners(2)
    day = new_day(days=rand_days(), start="07:30", slots=3)
    path = f"/api/barn-days/{day['id']}/events"
    mcookie = cookie_of(sign_in(MANAGER_CEDAR))
    ms = Stream(BASE + path, mcookie).ready()
    fs = Stream(inst(PEER) + path, farrier().cookie).ready()
    assert ms.status == 200 and ms.ctype.startswith("text/event-stream") and ms.retry == "2000"
    confirmed(o1, day, base=inst(PEER))
    ev = ms.next(STREAM_DELIVERY_S)
    assert ev["event"] == "booking_added" and set(ev["json"]) == MANAGER_ROW_KEYS
    assert ev["json"]["horse_name"] == o1.horses[0]["name"]
    fev = fs.next(STREAM_DELIVERY_S)
    assert fev["event"] == "booking_added" and set(fev["json"]) == FARRIER_ROW_KEYS
    first = int(ev["id"])
    b2 = confirmed(o2, day)
    assert int(ms.next(STREAM_DELIVERY_S)["id"]) == first + 1
    o2.ok("POST", f"/api/bookings/{b2['id']}/cancel")
    gone = ms.next(STREAM_DELIVERY_S)
    assert gone["event"] == "booking_removed" and int(gone["id"]) == first + 2
    assert Stream(BASE + path, o1.cookie).status == 403
    assert Who(MANAGER_CEDAR, mcookie).call("DELETE", "/api/session", base=inst(PEER)).status_code == 204
    assert ms.ended.wait(HEARTBEAT_S + STREAM_SLACK_S)
    for s in (ms, fs):
        s.close()


def test_barn_day_stream_resume():
    o1, o2, o3 = new_owners(3)
    day = new_day(days=rand_days(), start="07:30", slots=4)
    path = f"/api/barn-days/{day['id']}/events"
    live = Stream(BASE + path, farrier().cookie).ready()
    confirmed(o1, day)
    confirmed(o2, day)
    ids = [int(live.next(STREAM_DELIVERY_S)["id"]) for _ in range(2)]
    assert ids[1] == ids[0] + 1
    resumed = Stream(inst(PEER) + path, farrier().cookie, last_id=ids[0] - 1)
    replay = [resumed.next(STREAM_DELIVERY_S) for _ in range(2)]
    assert [int(e["id"]) for e in replay] == ids
    assert [e["json"]["horse_name"] for e in replay] == [o1.horses[0]["name"], o2.horses[0]["name"]]
    confirmed(o3, day, base=inst(PEER))
    nxt = resumed.next(STREAM_DELIVERY_S)
    assert int(nxt["id"]) == ids[1] + 1 and nxt["json"]["horse_name"] == o3.horses[0]["name"]
    assert int(live.next(STREAM_DELIVERY_S)["id"]) == ids[1] + 1
    ahead = Stream(BASE + path, farrier().cookie, last_id=ids[1] + 1000)
    assert ahead.next(STREAM_DELIVERY_S)["event"] == "reset"
    for s in (live, resumed, ahead):
        s.close()


def test_wf_owner_cancellation_api(mail):
    (o,) = new_owners(1, horses=3)
    fut = new_day(days=5, start="07:30", slots=1)
    tod = new_day(days=0, slots=1)
    dst = new_day(date="2027-11-07", start="07:30", slots=1)
    b_in, b_late, b_dst = confirmed(o, fut, horse=0), confirmed(o, tod, horse=1), confirmed(o, dst, horse=2)
    p = o.ok("GET", f"/api/bookings/{b_in['id']}/cancellation-preview")
    assert (p["late"], p["cutoff_at"], p["deposit_outcome"]) == (False, fut["cancellation_cutoff_at"], "refund")
    assert p["deposit_cents"] == b_in["deposit_cents"]
    assert o.ok("GET", f"/api/bookings/{b_late['id']}/cancellation-preview")["late"] is True
    pd = o.ok("GET", f"/api/bookings/{b_dst['id']}/cancellation-preview")
    assert (pd["late"], pd["cutoff_at"]) == (False, "2027-11-06T08:30:00-06:00")
    r = o.ok("POST", f"/api/bookings/{b_in['id']}/cancel")
    assert (r["booking"]["status"], r["trip_share_applies"]) == ("cancelled_in_time", False)
    pay = payment(o, b_in["payment_id"])
    assert (pay["status"], pay["disposition"]) == ("refunded", None)
    r = o.ok("POST", f"/api/bookings/{b_late['id']}/cancel")
    assert (r["booking"]["status"], r["trip_share_applies"]) == ("cancelled_late", True)
    pay = payment(o, b_late["payment_id"])
    assert (pay["status"], pay["disposition"]) == ("captured", "forfeited")
    illegal(o.call("POST", f"/api/bookings/{b_in['id']}/cancel", {}), "cancelled_in_time", "cancel")
    assert farrier().ok("POST", f"/api/bookings/{b_dst['id']}/cancel")["booking"]["status"] == "cancelled_in_time"


def test_cancellation_email(mail):
    (o,) = new_owners(1, horses=3)
    fut, tod = new_day(days=5, start="07:30", slots=1), new_day(days=0, slots=1)
    gone = new_day(days=6, start="07:30", slots=1)
    b_in, b_late = confirmed(o, fut, horse=0), confirmed(o, tod, horse=1)
    confirmed(o, gone, horse=2)
    assert o.ok("POST", f"/api/bookings/{b_in['id']}/cancel")["trip_share_applies"] is False
    assert farrier().ok("POST", f"/api/bookings/{b_late['id']}/cancel")["trip_share_applies"] is True
    farrier().ok("POST", f"/api/barn-days/{gone['id']}/cancel")
    for idx, day, keep in [(0, fut, False), (1, tod, True), (2, gone, False)]:
        h = o.horses[idx]["name"]
        msgs = inbox(mail, o.email, f"Cancelled: {h} at {CEDAR} on {day['business_date']}")
        assert len(msgs) == 1
        body = text(msgs[0])
        dep = dollars(b_in["deposit_cents"])
        if keep:
            assert "A trip share still applies." in body and "No trip share applies." not in body
            assert f"Your {dep} deposit is kept and set against the trip share." in body
        else:
            assert "No trip share applies." in body and "A trip share still applies." not in body
            assert f"Your {dep} deposit will be refunded." in body


def test_wf_owner_cancellation_dialog_ui(browser):
    (o,) = new_owners(1, horses=2)
    fut, tod = new_day(days=5, start="07:30", slots=1), new_day(days=0, slots=1)
    b1, b2 = confirmed(o, fut, horse=0), confirmed(o, tod, horse=1)
    h0, h1 = o.horses[0]["name"], o.horses[1]["name"]
    dep = dollars(b1["deposit_cents"])
    with ui(browser, o.email, f"/days/{fut['id']}") as page:
        page.clock.set_system_time(dt.datetime.combine(today() + dt.timedelta(days=40), dt.time(12)))
        opener = page.get_by_role("button", name=f"Cancel booking for {h0}")
        see(page, visible(opener))
        click(opener)
        dlg = page.get_by_role("dialog", name="Cancel booking")
        see(page, has_text(dlg, f"Cancelling now is before the cutoff. No trip share applies. Your {dep} deposit will be refunded."))
        expect(dlg.get_by_role("button", name="Keep booking")).to_be_focused()
        page.keyboard.press("Escape")
        see(page, lambda: expect(opener).to_be_focused(timeout=300))
        assert my_bookings(o, fut)[0]["status"] == "confirmed"
        click(opener)
        see(page, visible(dlg))
        click(dlg.get_by_role("button", name="Confirm cancellation"))
        see(page, has_text(notices(page), "Booking cancelled. No trip share applies."))
        see(page, lambda: expect(page.get_by_role("button", name=book_label("07:30"))).to_be_focused(timeout=300))
        assert my_bookings(o, fut)[0]["status"] == "cancelled_in_time"
        page.clock.set_system_time(dt.datetime.combine(today() - dt.timedelta(days=40), dt.time(12)))
        page.goto(f"{BASE}/days/{tod['id']}")
        opener = page.get_by_role("button", name=f"Cancel booking for {h1}")
        see(page, visible(opener))
        click(opener)
        dlg = page.get_by_role("dialog", name="Cancel booking")
        see(page, has_text(dlg, f"The cutoff passed at {cutoff_copy(tod['cancellation_cutoff_at'])}. {h1} will still carry a trip share. "
                                f"Your {dep} deposit is kept and set against the trip share."))
        click(dlg.get_by_role("button", name="Confirm cancellation"))
        see(page, has_text(notices(page), f"Booking cancelled. {h1} still carries a trip share for this day."))
    assert my_bookings(o, tod)[0]["status"] == "cancelled_late" and b2["id"] == my_bookings(o, tod)[0]["id"]


def test_wf_day_start_allocation_split():
    owners = new_owners(7)
    day = new_day(days=0, slots=7, fee=FEE_4500)
    books = [confirmed(o, day) for o in owners[:7]]
    for o, b in zip(owners[5:7], books[5:7]):
        assert o.ok("POST", f"/api/bookings/{b['id']}/cancel")["booking"]["status"] == "cancelled_late"
    path = f"/api/barn-days/{day['id']}/allocation"
    err(farrier().call("GET", path), 409, "not_started")
    err(as_user(APPRENTICE).call("GET", path), 403, "forbidden")
    assert start_day(day)["status"] == "in_progress"
    illegal(farrier().call("POST", f"/api/barn-days/{day['id']}/start", {}), "in_progress", "start")
    alloc = farrier().ok("GET", path)
    assert alloc["trip_fee_cents"] == FEE_4500
    assert [s["number"] for s in alloc["shares"]] == sorted(b["number"] for b in books)
    assert {s["booking_id"] for s in alloc["shares"]} == {b["id"] for b in books}
    assert [s["share_cents"] for s in alloc["shares"]] == SPLIT_4500_7
    rows = {r["booking_id"]: r["trip_share_cents"] for r in farrier().ok("GET", f"/api/barn-days/{day['id']}/bookings")}
    assert {s["booking_id"]: s["share_cents"] for s in alloc["shares"]} == rows
    tomorrow = new_day(days=1, slots=1)
    err(farrier().call("POST", f"/api/barn-days/{tomorrow['id']}/start", {}), 409, "too_early")


def test_day_start_counting_horses():
    owners = new_owners(3)
    day = new_day(days=0, slots=4, fee=FEE_1000)
    keep, late = confirmed(owners[0], day), confirmed(owners[1], day)
    assert owners[1].ok("POST", f"/api/bookings/{late['id']}/cancel")["booking"]["status"] == "cancelled_late"
    h = hold(owners[2], day).json()
    assert payment(owners[2], h["payment_id"])["status"] == "authorized"
    start_day(day)
    err(owners[2].call("POST", f"/api/bookings/{h['id']}/confirm", {}), 409, "hold_expired")
    assert payment(owners[2], h["payment_id"])["status"] == "voided"
    assert my_bookings(owners[2], day) == []
    path = f"/api/barn-days/{day['id']}/allocation"
    alloc = farrier().ok("GET", path)
    assert {s["booking_id"]: s["status"] for s in alloc["shares"]} == {keep["id"]: "confirmed", late["id"]: "cancelled_late"}
    assert sum(s["share_cents"] for s in alloc["shares"]) == FEE_1000
    rows = {r["booking_id"]: r["trip_share_cents"] for r in farrier().ok("GET", f"/api/barn-days/{day['id']}/bookings")}
    assert rows == {s["booking_id"]: s["share_cents"] for s in alloc["shares"]}
    assert my_bookings(owners[0], day)[0]["trip_share_cents"] == rows[keep["id"]]
    farrier().ok("POST", f"/api/bookings/{keep['id']}/visit", status=201)
    after = farrier().ok("GET", path)
    assert {s["booking_id"]: s["share_cents"] for s in after["shares"]} == {s["booking_id"]: s["share_cents"] for s in alloc["shares"]}


def test_wf_day_start_allocation_race(mail):
    owners = new_owners(4)
    day = new_day(days=0, slots=4, fee=FEE_1000)
    books = [confirmed(o, day) for o in owners[:3]]
    p = f"/api/barn-days/{day['id']}/start"
    fns = [lambda i=i: farrier().call("POST", p, {}, base=inst(PEER) if i % 2 else None) for i in range(4)]
    fns.append(lambda: owners[0].call("POST", f"/api/bookings/{books[0]['id']}/cancel", {}))
    fns.append(lambda: hold(owners[3], day, slot=day["slots"][3]["id"]))
    res = together(fns)
    starts, cancel, hl = res[:4], res[4], res[5]
    assert [r.status_code for r in starts].count(200) == 1
    for r in starts:
        if r.status_code != 200:
            illegal(r, "in_progress", "start")
    if cancel.status_code == 200:
        assert cancel.json()["booking"]["status"] == "cancelled_late"
    else:
        err(cancel, 409, "day_started")
        assert my_bookings(owners[0], day)[0]["status"] == "confirmed"
    if hl.status_code == 201:
        assert payment(owners[3], hl.json()["payment_id"])["status"] == "voided"
    else:
        err(hl, 409, "not_open_for_booking")
    assert my_bookings(owners[3], day) == []
    alloc = farrier().ok("GET", f"/api/barn-days/{day['id']}/allocation")
    assert {s["booking_id"] for s in alloc["shares"]} == {b["id"] for b in books}
    assert [s["share_cents"] for s in alloc["shares"]] == SPLIT_1000_3
    subj = f"Cancelled: {owners[0].horses[0]['name']} at {CEDAR} on {day['business_date']}"
    assert len(inbox(mail, owners[0].email, subj, expect=1 if cancel.status_code == 200 else 0)) == (
        1 if cancel.status_code == 200 else 0)


def worked_visit():
    (o,) = new_owners(1)
    day = new_day(days=0, slots=1)
    b = confirmed(o, day)
    start_day(day)
    v = farrier().ok("POST", f"/api/bookings/{b['id']}/visit", status=201)
    return o, day, b, v


def test_wf_visit_photos_safe_upload(jpeg_exif):
    o, day, b, v = worked_visit()
    s3, vid = S3(), v["id"]
    meta_png = png(64, 48, chunks=[(b"tEXt", b"Comment\x00probe"), (b"eXIf", b"MM\x00*\x00\x00\x00\x08\x00\x00")])
    r = upload(vid, "LF", "after", meta_png, name="hoof.jpg")
    assert r.status_code == 201, r.text
    ph = r.json()
    assert (ph["content_type"], ph["width"], ph["height"]) == ("image/png", 64, 48)
    key = f"visits/{vid}/LF/after/{ph['id']}.png"
    assert key in s3.keys(f"visits/{vid}/")
    stored = s3.get(key)
    assert not {b"tEXt", b"eXIf", b"iTXt", b"zTXt"} & set(png_chunks(stored))
    got = httpx.get(BASE + ph["url"], timeout=TIMEOUT)
    assert got.status_code == 200 and got.headers["content-type"].startswith("image/png") and got.content == stored
    r = upload(vid, "RF", "after", jpeg_exif, name="hoof.png")
    assert r.status_code == 201, r.text
    jp = r.json()
    assert (jp["content_type"], jp["width"], jp["height"]) == ("image/jpeg", 30, 40)
    jstored = s3.get(f"visits/{vid}/RF/after/{jp['id']}.jpg")
    assert b"Exif\x00\x00" not in jstored and jpeg_size(jstored) == (30, 40)
    err(upload(vid, "LF", "after", meta_png), 409, "photo_exists")
    for bad in (GIF, SVG, jpeg_exif[:200]):
        err(upload(vid, "LH", "before", bad), 415, "unsupported_image")
    err(upload(vid, "LH", "before", png_of_size(PHOTO_LIMIT + 1)), 413, "photo_too_large")
    assert not s3.keys(f"visits/{vid}/LH/before/")
    assert upload(vid, "LH", "before", png_of_size(PHOTO_LIMIT)).status_code == 201
    bad_hoof = upload(vid, "XX", "after", meta_png)
    assert bad_hoof.status_code == 422


def test_wf_visit_photos_ui(browser):
    (o,) = new_owners(1)
    day = new_day(days=0, slots=1)
    b = confirmed(o, day)
    start_day(day)
    fut = new_day(days=3, slots=1)
    fb = confirmed(o, fut)
    err(farrier().call("POST", f"/api/bookings/{fb['id']}/visit", {}), 409, "day_not_in_progress")
    h = o.horses[0]
    with ui(browser, FARRIER, f"/days/{day['id']}") as page:
        btn = page.get_by_role("button", name=f"Open visit for {h['name']}")
        see(page, visible(btn))
        click(btn)
        row = eventually(lambda: [r for r in farrier().ok("GET", f"/api/barn-days/{day['id']}/bookings")
                                  if r["booking_id"] == b["id"] and r["visit_id"]], TIMEOUT)[0]
    assert (row["status"], row["visit_status"]) == ("worked", "open")
    with ui(browser, APPRENTICE, f"/horses/{h['id']}?hoof=LF") as page:
        hoof = page.get_by_role("combobox", name="Hoof")
        see(page, visible(hoof))
        select(hoof, "Left fore")
        check(page.get_by_role("radio", name="After"))
        page.get_by_label("Photo file").set_input_files({"name": "hoof.png", "mimeType": "image/png", "buffer": big_png()})
        click(page.get_by_role("button", name="Upload photo"))
        see(page, has_text(notices(page), "Photo saved for Left fore (after)."), seconds=60)
    assert S3().keys(f"visits/{row['visit_id']}/LF/after/")


def test_wf_visit_photos_apprentice():
    o, day, b, v = worked_visit()
    ap = as_user(APPRENTICE)
    assert all(set(r) == APPRENTICE_ROW_KEYS for r in ap.ok("GET", f"/api/barn-days/{day['id']}/bookings"))
    assert upload(v["id"], "LF", "after", big_png(), who=ap).status_code == 201
    assert save_marks(v["id"], "LF", None, *LF84, who=ap).status_code == 200
    hid, d = o.horses[0]["id"], day["id"]
    forbidden = [("GET", "/api/price-lists", None), ("POST", "/api/price-lists", {}),
                 *[("POST", f"/api/barn-days/{d}/{a}", {}) for a in ("publish", "start", "close", "cancel")],
                 ("POST", "/api/barn-days/probe-unknown/start", {}),
                 ("POST", f"/api/visits/{v['id']}/close", {"work": ["trim"], "note": ""}),
                 ("GET", f"/api/barn-days/{d}/allocation", None), ("GET", "/api/invoices", None),
                 ("GET", "/api/payments", None), ("POST", f"/api/horses/{hid}/vet-links", {"vet_name": "x", "vet_email": "x@clinchline.test"}),
                 ("GET", f"/api/horses/{hid}/vet-links", None),
                 ("POST", f"/api/payments/{b['payment_id']}/refund", {"amount_cents": 1})]
    for method, path, body in forbidden:
        err(ap.call(method, path, body, key=idempotency_key()), 403, "forbidden")
    assert ap.ok("GET", f"/api/visits/{v['id']}")["invoice"] is None
    err(o.call("GET", f"/api/visits/{v['id']}"), 404, "not_found")


def test_wf_visit_photos_resumable():
    o, day, b, v = worked_visit()
    data = png_of_size(2_500_000)
    s = farrier().ok("POST", f"/api/visits/{v['id']}/uploads", {"hoof": "LF", "phase": "after", "size_bytes": len(data)}, 201)
    cb, sid = s["chunk_bytes"], s["id"]
    assert s["offset"] == 0 and s["expires_at"]

    def patch(offset, chunk, base=None):
        return farrier().call("PATCH", f"/api/uploads/{sid}", content=chunk, base=base,
                              headers={**OCTET, "Upload-Offset": str(offset)})

    r = patch(0, data[:cb])
    assert r.status_code == 200 and r.json() == {"offset": cb}
    assert farrier().ok("GET", f"/api/uploads/{sid}", base=inst(PEER))["offset"] == cb
    r = patch(0, data[:cb])
    assert r.status_code == 409 and r.json() == {"error": "offset_mismatch", "offset": cb}
    r = patch(cb, data[cb:cb + 10])
    assert r.status_code == 422 and r.json()["errors"]["chunk"] == f"Send exactly {cb} bytes, or the rest of the file."
    res = together([lambda: patch(cb, data[cb:2 * cb]), lambda: patch(cb, data[cb:2 * cb], base=inst(PEER))])
    assert sorted(x.status_code for x in res) == [200, 409]
    assert next(x for x in res if x.status_code == 409).json()["error"] == "offset_mismatch"
    final = patch(2 * cb, data[2 * cb:], base=inst(PEER))
    assert final.status_code == 201 and final.json()["hoof"] == "LF", final.text
    assert S3().keys(f"{UPLOAD_PREFIX}/{sid}/") == []
    assert S3().keys(f"visits/{v['id']}/LF/after/")


def test_photo_quota():
    o2, day2, b2, v2 = worked_visit()
    combos = [(h, p) for h in HOOF_NAMES for p in ("before", "after")][:QUOTA_SESSIONS]
    res = together([lambda c=c: farrier().call("POST", f"/api/visits/{v2['id']}/uploads",
                                               {"hoof": c[0], "phase": c[1], "size_bytes": PHOTO_LIMIT}) for c in combos])
    assert [x.status_code for x in res].count(201) == QUOTA_WINNERS
    loser = next(x for x in res if x.status_code != 201)
    assert loser.status_code == 409 and loser.json() == {"error": "visit_quota_exceeded",
                                                         "remaining_bytes": QUOTA - QUOTA_WINNERS * PHOTO_LIMIT}
    first = next(x for x in res if x.status_code == 201).json()
    assert farrier().call("DELETE", f"/api/uploads/{first['id']}").status_code == 204
    lost = combos[[x.status_code for x in res].index(409)]
    assert farrier().call("POST", f"/api/visits/{v2['id']}/uploads",
                          {"hoof": lost[0], "phase": lost[1], "size_bytes": PHOTO_LIMIT}).status_code == 201


def test_photo_thumbnails():
    o, day, b, v = worked_visit()
    ph = upload(v["id"], "LF", "after", big_png()).json()
    original = S3().get(f"visits/{v['id']}/LF/after/{ph['id']}.png")
    ready = eventually(lambda: (lambda p: p if p["thumbnail_status"] == "ready" else None)(
        farrier().ok("GET", f"/api/photos/{ph['id']}")), JOB_SLACK_S + JOB_START_S)
    thumb = S3().get(f"visits/{v['id']}/LF/after/{ph['id']}.thumb.jpg")
    assert jpeg_size(thumb)[0] == THUMB_W and b"Exif\x00\x00" not in thumb
    got = httpx.get(BASE + ready["thumbnail_url"], timeout=TIMEOUT)
    assert got.status_code == 200 and got.headers["content-type"].startswith("image/jpeg")
    assert S3().get(f"visits/{v['id']}/LF/after/{ph['id']}.png") == original
    jobs = farrier().ok("GET", "/api/jobs?status=succeeded")
    assert any(j["kind"] == "thumbnail" and j["result"] == {"photo_id": ph["id"]} for j in jobs)


def test_wf_angle_marks_compute():
    o, day, b, v = worked_visit()
    vid = v["id"]
    err(upload(vid, "RF", "after", SVG), 415, "unsupported_image")
    err(save_marks(vid, "RF", None, *LF84), 409, "photo_required")
    assert upload(vid, "LF", "after", big_png()).status_code == 201
    vertical = {"x1": 600, "y1": 100, "x2": 600, "y2": 800}
    cases = [(LF84, 51.5, 56.0, "broken-back"), (LF42, 54.0, 55.0, "aligned"),
             ((LF84[1], LF84[0]), 56.0, 51.5, "broken-forward"), ((vertical, LF42[1]), 90.0, 55.0, "broken-forward")]
    version = None
    for (wall, pastern), a, p, label in cases:
        r = save_marks(vid, "LF", version, wall, pastern)
        assert r.status_code == 200, r.text
        m = r.json()
        assert (m["hoof_wall"]["angle"], m["pastern"]["angle"], m["alignment"]) == (a, p, label)
        assert m["version"] == (version or 0) + 1 and m["saved_by"]["role"] == "farrier"
        version = m["version"]
    for wall in ({"x1": PHOTO_W + 1, "y1": 0, "x2": 10, "y2": 10}, {"x1": 5, "y1": 5, "x2": 5, "y2": 5}):
        r = save_marks(vid, "LF", version, wall, LF42[1])
        assert r.status_code == 422
        assert "Keep both points inside the photo and apart from each other." in r.json()["errors"].values()
    stored = next(m for m in farrier().ok("GET", f"/api/visits/{vid}")["marks"] if m["hoof"] == "LF")
    assert (stored["version"], stored["hoof_wall"]["angle"]) == (version, 90.0)


def test_wf_angle_marks_versions():
    o, day, b, v = worked_visit()
    vid = v["id"]
    assert upload(vid, "LF", "after", big_png()).status_code == 201
    res = together([lambda: save_marks(vid, "LF", None, *LF84),
                    lambda: save_marks(vid, "LF", None, *LF42, who=as_user(APPRENTICE), base=inst(PEER))])
    assert sorted(r.status_code for r in res) == [200, 412]
    win, lose = sorted(res, key=lambda r: r.status_code)
    assert lose.json()["error"] == "stale_marks" and lose.json()["current"] == win.json()
    assert win.json()["version"] == 1
    for bad in (None, 5):
        r = save_marks(vid, "LF", bad, *LF84)
        assert r.status_code == 412 and r.json()["current"]["version"] == 1
    assert save_marks(vid, "LF", 1, *LF84).json()["version"] == 2
    err(save_marks(vid, "LF", 2, *LF84, who=o), 403, "forbidden")
    err(o.call("GET", f"/api/visits/{vid}"), 404, "not_found")


def test_wf_angle_marks_history_restore():
    o, day, b, v = worked_visit()
    vid = v["id"]
    ph = upload(vid, "LF", "after", big_png()).json()
    v1 = save_marks(vid, "LF", None, *LF84).json()
    save_marks(vid, "LF", 1, *LF42, who=as_user(APPRENTICE))
    base = f"/api/visits/{vid}/hooves/LF/marks"
    hist = farrier().ok("GET", base + "/history")
    assert [h["version"] for h in hist] == [1, 2]
    assert [h["saved_by"]["role"] for h in hist] == ["farrier", "apprentice"]
    r = farrier().ok("POST", base + "/restore", {"version": 2, "restore_version": 1})
    assert (r["version"], r["restored_from"], r["saved_by"]["role"]) == (3, 1, "farrier")
    for k in ("hoof_wall", "pastern", "alignment"):
        assert r[k] == v1[k]
    stale = farrier().call("POST", base + "/restore", {"version": 2, "restore_version": 1})
    assert stale.status_code == 412 and stale.json()["current"]["version"] == 3
    bad = farrier().call("POST", base + "/restore", {"version": 3, "restore_version": 99})
    assert bad.status_code == 422
    assert bad.json()["errors"]["restore_version"] == "That version is not in this hoof's history."
    err(o.call("GET", base + "/history"), 403, "forbidden")
    assert farrier().call("DELETE", f"/api/photos/{ph['id']}").status_code == 204
    assert upload(vid, "LF", "after", big_png()).status_code == 201
    assert save_marks(vid, "LF", None, *LF84).json()["version"] == 1
    assert len(farrier().ok("GET", base + "/history")) == 1


def test_wf_angle_marks_ui(browser):
    o, day, b, v = worked_visit()
    assert upload(v["id"], "LF", "after", big_png()).status_code == 201
    names = ("Start x", "Start y", "End x", "End y")
    with ui(browser, FARRIER, f"/horses/{o.horses[0]['id']}?hoof=LF") as page:
        see(page, visible(page.get_by_role("button", name="Save marks")))
        select(page.get_by_role("combobox", name="Hoof"), "Left fore")
        wall, pastern = page.get_by_role("group", name="Hoof wall line"), page.get_by_role("group", name="Pastern line")
        for grp, line in ((wall, LF84[0]), (pastern, LF84[1])):
            for n, k in zip(names, ("x1", "y1", "x2", "y2")):
                fill(grp.get_by_role("spinbutton", name=n), str(line[k]))
        click(page.get_by_role("button", name="Save marks"))
        see(page, has_text(notices(page), "Marks saved: hoof wall 51.5°, pastern 56.0°, broken-back."))
        assert save_marks(v["id"], "LF", 1, *LF42, who=as_user(APPRENTICE)).json()["version"] == 2
        fill(wall.get_by_role("spinbutton", name="Start x"), "310")
        click(page.get_by_role("button", name="Save marks"))
        see(page, has_text(notices(page), "Someone else saved marks for Left fore first. Their lines are now shown; check them and save again."))
        expect(wall.get_by_role("spinbutton", name="Start y")).to_have_value(str(LF42[0]["y1"]))
        expect(wall.get_by_role("spinbutton", name="Start x")).to_be_focused()
        click(page.get_by_role("button", name="Save marks"))
        see(page, has_text(notices(page), "Marks saved: hoof wall 54.0°, pastern 55.0°, aligned."))
    m = next(x for x in farrier().ok("GET", f"/api/visits/{v['id']}")["marks"] if x["hoof"] == "LF")
    assert (m["version"], m["hoof_wall"]["angle"]) == (3, 54.0)


def close_setup():
    (o,) = new_owners(1, horses=2)
    (other,) = new_owners(1)
    day = new_day(days=0, slots=3, fee=FEE_4500)
    b1, b2 = confirmed(o, day, horse=0), confirmed(o, day, horse=1)
    confirmed(other, day)
    start_day(day)
    share = {s["booking_id"]: s["share_cents"] for s in farrier().ok("GET", f"/api/barn-days/{day['id']}/allocation")["shares"]}
    return o, other, day, b1, b2, share


def expected_items(o, horse, booking, day, share, work):
    date, name = day["business_date"], o.horses[horse]["name"]
    pl = price_in_force(date)
    items = [(f"{SERVICE[w]} — {name}", pl["prices"][w]) for w in work]
    items.append((f"Trip share — {CEDAR} {date}", share[booking["id"]]))
    credit = min(booking["deposit_cents"], sum(a for _, a in items))
    if credit:
        items.append((f"Deposit credit — {name} {date}", -credit))
    return sorted(items)


def test_wf_visit_close_invoice_happy():
    o, other, day, b1, b2, share = close_setup()
    v1 = visit_for(b1)
    r = close_visit(v1["id"], ["trim", "front_reset"])
    assert r.status_code == 200 and r.json()["status"] == "invoiced", r.text
    inv = r.json()["invoice"]
    want = expected_items(o, 0, b1, day, share, ("trim", "front_reset"))
    assert sorted((i["description"], i["amount_cents"]) for i in inv["items"]) == want
    assert inv["kind"] == "visit" and inv["total_cents"] == sum(a for _, a in want) == inv["balance_cents"]
    assert farrier().ok("GET", f"/api/visits/{v1['id']}")["invoice"]["items"] == inv["items"]


def test_visit_close_one_killbill_invoice(killbill):
    o, other, day, b1, b2, share = close_setup()
    v1 = visit_for(b1)
    key = idempotency_key()
    r = close_visit(v1["id"], ["trim"], key=key)
    assert r.status_code == 200 and r.json()["status"] == "invoiced", r.text
    inv = r.json()["invoice"]
    for _ in range(2):
        replay = close_visit(v1["id"], ["trim"], key=key)
        assert replay.status_code == 200 and replay.json() == r.json()
    err(close_visit(v1["id"], ["front_new"], key=key), 409, "idempotency_conflict")
    illegal(close_visit(v1["id"], ["trim"]), "invoiced", "close")
    acct = killbill.account(o.email)
    assert (acct["externalKey"], acct["name"], acct["currency"]) == (o.email, o.name, "USD")
    kb = kb_invoices(killbill, o.email, inv["id"])
    assert len(kb) == 1
    assert sorted((i["description"], cents(i["amount"])) for i in kb[0]["items"]) == sorted(
        (i["description"] + f" [{inv['id']}]", i["amount_cents"]) for i in inv["items"] if i["amount_cents"] > 0)
    assert kb_invoices(killbill, other.email, inv["id"]) == []


def test_visit_summary_email(mail):
    o, other, day, b1, b2, share = close_setup()
    v1 = visit_for(b1)
    key = idempotency_key()
    inv = close_visit(v1["id"], ["trim", "front_reset"], key=key).json()["invoice"]
    assert close_visit(v1["id"], ["trim", "front_reset"], key=key).status_code == 200
    date = day["business_date"]
    msgs = inbox(mail, o.email, f"Visit summary: {o.horses[0]['name']} on {date}")
    assert len(msgs) == 1
    body = text(msgs[0])
    for item in inv["items"]:
        assert dollars(abs(item["amount_cents"])) in body
    assert any(i["description"].startswith("Deposit credit") for i in inv["items"])
    assert f"Invoice total {dollars(inv['total_cents'])}" in body
    assert f"Next due {(dt.date.fromisoformat(date) + dt.timedelta(days=DAYS_PER_WEEK * CYCLE_WEEKS)).isoformat()}" in body
    assert other.name not in body and other.horses[0]["name"] not in body and other.email not in body


def test_deposit_credit_on_invoice(killbill):
    o, other, day, b1, b2, share = close_setup()
    v1, v2 = visit_for(b1), visit_for(b2)
    inv1 = close_visit(v1["id"], ["trim", "front_reset"]).json()["invoice"]
    inv2 = close_visit(v2["id"], ["trim"]).json()["invoice"]
    for inv, b, idx in ((inv1, b1, 0), (inv2, b2, 1)):
        credits = [i for i in inv["items"] if i["description"].startswith("Deposit credit")]
        assert [c["description"] for c in credits] == [f"Deposit credit — {o.horses[idx]['name']} {day['business_date']}"]
        gross = sum(i["amount_cents"] for i in inv["items"] if i["amount_cents"] > 0)
        credit = min(b["deposit_cents"], gross)
        assert credits[0]["amount_cents"] == -credit
        kb = kb_invoices(killbill, o.email, inv["id"])
        assert len(kb) == 1 and cents(kb[0]["balance"]) == inv["balance_cents"] == gross - credit
        out = kb_key(killbill, o.email, f"{inv['id']}:deposit-out")
        into = kb_key(killbill, o.email, f"{inv['id']}:deposit-in")
        assert len(out) == 1 and len(into) == 1
        assert abs(cents(out[0]["amount"])) == abs(cents(into[0]["amount"])) == credit
        dp = payment(o, b["payment_id"])
        assert (dp["applied_cents"], dp["disposition"]) == (credit, "applied")


def test_wf_visit_close_invoice_concurrent(mail, killbill):
    o, day, b, v = worked_visit()
    assert upload(v["id"], "LF", "after", big_png()).status_code == 201
    key = idempotency_key()
    fns = [lambda i=i: close_visit(v["id"], ["trim"], key=key, base=inst(PEER) if i % 2 else None) for i in range(3)]
    fns += [lambda i=i: close_visit(v["id"], ["trim"], base=inst(PEER) if i % 2 else None) for i in range(3)]
    res = together(fns)
    same, diff = res[:3], res[3:]
    oks = [r for r in res if r.status_code == 200]
    assert oks and all(r.json() == oks[0].json() for r in oks)
    assert sum(r.status_code == 200 for r in diff) + (1 if any(r.status_code == 200 for r in same) else 0) == 1
    for r in res:
        if r.status_code != 200:
            assert r.status_code == 409 and r.json()["error"] in ("idempotency_in_progress", "illegal_transition"), r.text
            if r.json()["error"] == "illegal_transition":
                assert r.json()["action"] == "close"
    inv = farrier().ok("GET", f"/api/visits/{v['id']}")["invoice"]
    assert len(kb_invoices(killbill, o.email, inv["id"])) == 1
    assert len(inbox(mail, o.email, f"Visit summary: {o.horses[0]['name']} on {day['business_date']}")) == 1


def _quiet(fn):
    try:
        return fn()
    except httpx.HTTPError as exc:
        return exc


def test_wf_visit_close_invoice_crash(mail, killbill):
    (o,) = new_owners(1)
    day = new_day(days=0, slots=1)
    b = confirmed(o, day)
    start_day(day)
    v = visit_for(b)
    key, box = idempotency_key(), {}
    with app_copy({"IDEMPOTENCY_LEASE_SECONDS": "3", "JOB_LEASE_SECONDS": "3", "INSTANCE_LABEL": "crash-probe"}) as cp:
        t = threading.Thread(target=lambda: box.setdefault("r", _quiet(lambda: close_visit(v["id"], ["trim"], key=key, base=cp.url))))
        t.start()
        eventually(lambda: "r" in box or farrier().ok("GET", f"/api/visits/{v['id']}")["status"] != "open", TIMEOUT, every=0.02)
        cp.proc.kill()
        t.join(TIMEOUT)

    def retried():
        r = close_visit(v["id"], ["trim"], key=key)
        return r if r.status_code == 200 else None

    r = eventually(retried, TIMEOUT + JOB_SLACK_S, every=1)
    assert r.json()["status"] == "invoiced"
    inv = r.json()["invoice"]
    assert len(kb_invoices(killbill, o.email, inv["id"])) == 1
    assert len(kb_key(killbill, o.email, f"{inv['id']}:deposit-out")) == 1
    assert len(kb_key(killbill, o.email, f"{inv['id']}:deposit-in")) == 1
    assert len(inbox(mail, o.email, f"Visit summary: {o.horses[0]['name']} on {day['business_date']}")) == 1


def test_next_due_status(browser):
    o, day, b, v = worked_visit()
    h = o.ok("GET", f"/api/horses/{o.horses[0]['id']}")
    assert (h["due_status"], h["next_due_date"], h["last_worked_date"]) == ("unknown", None, None)
    assert upload(v["id"], "LF", "after", big_png()).status_code == 201
    assert close_visit(v["id"], ["trim"]).status_code == 200
    h = o.ok("GET", f"/api/horses/{o.horses[0]['id']}")
    nxt = dt.date.fromisoformat(day["business_date"]) + dt.timedelta(days=DAYS_PER_WEEK * CYCLE_WEEKS)
    assert (h["last_worked_date"], h["next_due_date"], h["due_status"]) == (day["business_date"], nxt.isoformat(), "current")
    now = today()
    for horse in farrier().ok("GET", "/api/horses"):
        if horse["name"] not in ("Juniper", "Pilot", "Saffron", "Quarry"):
            continue
        done = [x["business_date"] for x in farrier().ok("GET", f"/api/horses/{horse['id']}/visits") if x["status"] != "open"]
        if not done:
            assert (horse["due_status"], horse["next_due_date"]) == ("unknown", None)
            continue
        due = dt.date.fromisoformat(max(done)) + dt.timedelta(days=DAYS_PER_WEEK * horse["cycle_weeks"])
        assert horse["next_due_date"] == due.isoformat()
        want = "current" if now < due - dt.timedelta(days=DAYS_PER_WEEK) else "due" if now <= due else "overdue"
        assert horse["due_status"] == want
    with ui(browser, o.email, f"/horses/{o.horses[0]['id']}?hoof=LF") as page:
        see(page, has_text(page.get_by_role("main"), f"Next due {nxt.isoformat()}"))


def test_wf_billing_outage_pending_then_invoiced(mail, killbill):
    o, other = new_owners(2)
    day = new_day(days=0, slots=2, fee=FEE_4500)
    b = confirmed(o, day)
    confirmed(other, day)
    start_day(day)
    v = visit_for(b)
    r = close_visit(v["id"], ["trim"], base=inst(KB_DOWN))
    t0 = time.monotonic()
    assert r.status_code == 200 and r.json()["status"] == "invoice_pending", r.text
    inv = r.json()["invoice"]
    assert (inv["status"], inv["killbill_invoice_id"]) == ("pending", None)
    share = next(s["share_cents"] for s in farrier().ok("GET", f"/api/barn-days/{day['id']}/allocation")["shares"]
                 if s["booking_id"] == b["id"])
    assert next(i for i in inv["items"] if i["description"].startswith("Trip share"))["amount_cents"] == share
    subject = f"Visit summary: {o.horses[0]['name']} on {day['business_date']}"
    err(o.call("POST", f"/api/invoices/{inv['id']}/payments", {"card_token": APPROVE}, key=idempotency_key()), 409, "invoice_pending")

    def still_pending():
        vv = farrier().ok("GET", f"/api/visits/{v['id']}")
        assert vv["status"] == "invoice_pending" and vv["invoice"]["status"] == "pending"
        assert vv["invoice"]["killbill_invoice_id"] is None

    during(HOLD_OFF_S / 2, still_pending)
    assert kb_invoices(killbill, o.email, inv["id"]) == []
    during(HOLD_OFF_S - 1 - (time.monotonic() - t0), still_pending)
    assert kb_invoices(killbill, o.email, inv["id"]) == []
    assert inbox(mail, o.email, subject, expect=0) == []
    eventually(lambda: farrier().ok("GET", f"/api/visits/{v['id']}")["status"] == "invoiced", DELIVERY_S - (time.monotonic() - t0))
    assert invoice_of(o, inv["id"])["status"] in ("unpaid", "paid")
    assert len(kb_invoices(killbill, o.email, inv["id"])) == 1
    assert len(inbox(mail, o.email, subject)) == 1


def test_invoice_pending_close_ui(browser, killbill):
    o, day, b, v = worked_visit()
    assert upload(v["id"], "LF", "after", big_png()).status_code == 201
    with ui(browser, FARRIER, f"/horses/{o.horses[0]['id']}?hoof=LF", base=inst(KB_DOWN)) as page:
        close = page.get_by_role("button", name="Close visit")
        see(page, visible(close))
        check(page.get_by_role("group", name="Work done").get_by_role("checkbox", name="Trim"))
        click(close)
        see(page, has_text(notices(page), "Visit closed — invoice pending. It will be invoiced when billing is back."))
        see(page, has_text(page.get_by_role("main"), "Invoice pending"))
    vv = farrier().ok("GET", f"/api/visits/{v['id']}")
    assert vv["status"] == "invoice_pending" and vv["invoice"]["status"] == "pending"
    assert vv["invoice"]["killbill_invoice_id"] is None
    assert kb_invoices(killbill, o.email, vv["invoice"]["id"]) == []
    err(o.call("POST", f"/api/invoices/{vv['invoice']['id']}/payments", {"card_token": APPROVE}, key=idempotency_key()),
        409, "invoice_pending")


def test_wf_billing_outage_ui_announce(browser):
    o, day, b, v = worked_visit()
    assert upload(v["id"], "LF", "after", big_png()).status_code == 201
    r = close_visit(v["id"], ["trim"], base=inst(KB_DOWN))
    assert r.json()["status"] == "invoice_pending"
    h = o.horses[0]["name"]
    with ui(browser, FARRIER, f"/days/{day['id']}") as page:
        row = page.get_by_role("row").filter(has_text=h)
        see(page, has_text(row, "Invoice pending"))
        chip = row.get_by_text("Invoice pending")
        loops = chip.evaluate("""el => { const out = []; for (let n = el; n && n.getAnimations; n = n.parentElement) {
            n.getAnimations({subtree: true}).forEach(a => { const t = a.effect.getComputedTiming();
              if (t.iterations === Infinity) out.push(Number(t.duration)); }); if (n.getAttribute('role') === 'row') break; }
            return out; }""")
        assert CHIP_LOOP_MS in [round(x) for x in loops], loops
        notices(page).evaluate(WATCH_NOTICES)
        total = eventually(lambda: (lambda x: x["invoice"]["total_cents"] if x["status"] == "invoiced" else None)(
            farrier().ok("GET", f"/api/visits/{v['id']}")), DELIVERY_S)
        advance(page, REFRESH_PENDING_MS)
        see(page, has_text(row, "Invoiced"))
        copy = f"Invoice for {h} is now in billing: {dollars(total)}."
        see(page, has_text(notices(page), copy))
        for _ in range(3):
            advance(page, REFRESH_MS)
        assert page.evaluate("window.__notices").count(copy) == 1


def test_wf_day_close_outage(killbill):
    a, bo, c = new_owners(3)
    trip_fee = 2 * FEE_4500
    day = new_day(days=0, slots=3, fee=trip_fee)
    ba, bb, bc = confirmed(a, day), confirmed(bo, day), confirmed(c, day)
    c.ok("POST", f"/api/bookings/{bc['id']}/cancel")
    start_day(day)
    path = f"/api/barn-days/{day['id']}"
    err(farrier().call("POST", path + "/close", {}), 409, "unresolved_bookings")
    va = visit_for(ba)
    assert farrier().ok("POST", f"/api/bookings/{bb['id']}/no-show")["status"] == "no_show"
    err(farrier().call("POST", path + "/close", {}), 409, "unresolved_bookings")
    illegal(farrier().call("POST", f"/api/bookings/{ba['id']}/no-show", {}), "worked", "no_show")
    assert close_visit(va["id"], ["trim"]).status_code == 200
    assert farrier().ok("POST", path + "/close", base=inst(KB_DOWN))["status"] == "closed"
    illegal(farrier().call("POST", path + "/close", {}), "closed", "close")
    shares = {s["booking_id"]: s["share_cents"] for s in farrier().ok("GET", path + "/allocation")["shares"]}
    assert sum(shares.values()) == trip_fee
    for owner, bk, tag in [(bo, bb, "no-show"), (c, bc, "cancelled late")]:
        h = owner.horses[0]["name"]
        inv = next(i for i in owner.ok("GET", "/api/invoices") if i["kind"] == "trip")
        assert inv["items"][0] == {"description": f"Trip share — {CEDAR} {day['business_date']} ({h}, {tag})",
                                   "amount_cents": shares[bk["id"]]}
        credit = min(bk["deposit_cents"], shares[bk["id"]])
        assert inv["items"][1]["amount_cents"] == -credit
        eventually(lambda o=owner, i=inv: invoice_of(o, i["id"])["status"] in ("unpaid", "paid"), DELIVERY_S)
        assert len(kb_invoices(killbill, owner.email, inv["id"])) == 1
        p = payment(owner, bk["payment_id"])
        assert (p["applied_cents"], p["disposition"], p["status"]) == (credit, "forfeited", "captured")


def test_wf_day_close_ui(browser, killbill):
    a, bo = new_owners(2)
    day = new_day(days=0, slots=2, fee=FEE_4500)
    ba, bb = confirmed(a, day), confirmed(bo, day)
    start_day(day)
    va = visit_for(ba)
    assert close_visit(va["id"], ["trim"]).status_code == 200
    h = bo.horses[0]["name"]
    with ui(browser, FARRIER, f"/days/{day['id']}") as page:
        btn = page.get_by_role("button", name=f"Mark {h} no-show")
        see(page, visible(btn))
        click(btn)
        eventually(lambda: my_bookings(bo, day)[0]["status"] == "no_show", TIMEOUT)
        close = page.get_by_role("button", name="Close day")
        see(page, visible(close))
        click(close)
        see(page, has_text(notices(page), "Day closed."))
        row = page.get_by_role("row").filter(has_text=h)
        see(page, has_text(row, "Invoiced"), seconds=DELIVERY_S)
    assert farrier().ok("GET", f"/api/barn-days/{day['id']}")["status"] == "closed"
    trips = [i for i in bo.ok("GET", "/api/invoices") if i["kind"] == "trip"]
    assert len(trips) == 1 and trips[0]["items"][0]["description"].endswith(f"({h}, no-show)")
    assert len(kb_invoices(killbill, bo.email, trips[0]["id"])) == 1
    assert [i for i in a.ok("GET", "/api/invoices") if i["kind"] == "trip"] == []


def test_wf_owner_comparison_data():
    ada, jun = as_user(ADA), juniper_id()
    c = ada.ok("GET", f"/api/horses/{jun}/comparison?hoof=LF")
    assert c["readout"] == JUNIPER_LF and c["hoof"] == "LF"
    assert c["difference"] == {"hoof_wall": 2.5, "pastern": -1.0}
    assert {k: c["previous"]["hoof_wall"][k] for k in ("x1", "y1", "x2", "y2")} == LF84[0]
    assert (c["previous"]["hoof_wall"]["angle"], c["current"]["pastern"]["angle"]) == (51.5, 55.0)
    assert (c["previous"]["alignment"], c["current"]["alignment"]) == ("broken-back", "aligned")
    assert c["previous"]["business_date"] < c["current"]["business_date"] and len(c["marked_visits"]) == 2
    assert httpx.get(BASE + c["current"]["photo"]["url"], timeout=TIMEOUT).status_code == 200
    assert ada.ok("GET", f"/api/horses/{jun}/comparison?hoof=RF")["readout"] == JUNIPER_RF
    err(ada.call("GET", f"/api/horses/{jun}/comparison?hoof=LH"), 409, "not_enough_marked_visits")
    rev = ada.call("GET", f"/api/horses/{jun}/comparison?hoof=LF&previous={c['current']['visit_id']}&current={c['previous']['visit_id']}")
    assert rev.status_code == 422


def test_owner_record_isolation():
    jun = juniper_id()
    c = as_user(ADA).ok("GET", f"/api/horses/{jun}/comparison?hoof=LF")
    (o,) = new_owners(1)
    (stranger,) = new_owners(1)
    inv, b, day = invoiced(o)
    for path in (f"/api/horses/{jun}", f"/api/horses/{jun}/visits", f"/api/horses/{jun}/comparison?hoof=LF",
                 f"/api/visits/{c['current']['visit_id']}", f"/api/photos/{c['current']['photo']['id']}",
                 f"/api/horses/{o.horses[0]['id']}", f"/api/payments/{b['payment_id']}"):
        err(stranger.call("GET", path), 404, "not_found")
    err(stranger.call("POST", f"/api/invoices/{inv['id']}/payments", {"card_token": APPROVE}, key=idempotency_key()),
        404, "not_found")
    assert inv["id"] not in {i["id"] for i in stranger.ok("GET", "/api/invoices")}
    assert b["payment_id"] not in {p["id"] for p in stranger.ok("GET", "/api/payments")}
    assert o.horses[0]["id"] not in {h["id"] for h in stranger.ok("GET", "/api/horses")}
    assert invoice_of(o, inv["id"])["status"] == "unpaid"


def test_wf_owner_comparison_keyboard(browser):
    jun = juniper_id()
    with ui(browser, ADA, f"/horses/{jun}?hoof=LF") as page:
        slider = page.get_by_role("slider", name="Comparison divider")
        see(page, lambda: divider_is(slider, "50", timeout=300))
        expect(slider).to_have_attribute("aria-valuetext", "50% current")
        readout = page.get_by_role("status", name="Angle readout")
        for line in JUNIPER_LF:
            expect(readout).to_contain_text(line)
        tab_to(page, slider)
        for key, want in [("ArrowRight", 51), ("ArrowUp", 52), ("ArrowLeft", 51), ("ArrowDown", 50), ("PageUp", 60),
                          ("PageDown", 50), ("Home", 0), ("ArrowLeft", 0), ("End", 100), ("ArrowUp", 100)]:
            page.keyboard.press(key)
            advance(page, UNDER_HALF_S_MS)
            divider_is(slider, str(want))
        click_choice(page.get_by_role("radio", name="Right fore"))
        for line in JUNIPER_RF:
            expect(readout).to_contain_text(line)
        stage = page.get_by_role("region", name="Hoof comparison")
        if not animations(stage):
            first = decode(capture(stage))
            advance(page, UNDER_HALF_S_MS // 4)
            changed(first, decode(capture(stage)))
        advance(page, UNDER_HALF_S_MS)
        divider_is(slider, "50")


def test_comparison_urls(browser):
    jun = juniper_id()
    pilot = next(h for h in as_user(ADA).ok("GET", "/api/horses") if h["name"] == "Pilot")["id"]
    with ui(browser, ADA, f"/horses/{jun}?hoof=LF") as page:
        right = page.get_by_role("radio", name="Right fore")
        see(page, visible(right))
        length = page.evaluate("history.length")
        click(right)
        see(page, lambda: expect(page).to_have_url(re.compile(r"[?&]hoof=RF"), timeout=300))
        assert parse_qs(urlparse(page.url).query)["hoof"] == ["RF"] and page.evaluate("history.length") == length
        page.reload()
        see(page, lambda: expect(page.get_by_role("radio", name="Right fore")).to_be_checked(timeout=300))
        page.goto(f"{BASE}/horses/{pilot}?hoof=LF")
        see(page, has_text(page.get_by_role("main"), "Pilot"))
        page.go_back()
        see(page, lambda: expect(page.get_by_role("radio", name="Right fore")).to_be_checked(timeout=300))
        assert urlparse(page.url).path == f"/horses/{jun}"
        page.go_forward()
        see(page, lambda: expect(page).to_have_url(re.compile(re.escape(f"/horses/{pilot}")), timeout=300))
        page.goto(f"{BASE}/horses/{jun}?hoof=XX")
        see(page, lambda: expect(page.get_by_role("radio", name="Left fore")).to_be_checked(timeout=300))
    (stranger,) = new_owners(1)
    with ui(browser, stranger.email, f"/horses/{jun}?hoof=LF") as page:
        see(page, has_text(page.get_by_role("main"), "This horse isn't available."))
        expect(page.get_by_role("region", name="Hoof comparison")).to_have_count(0)
        expect(page.get_by_role("main")).not_to_contain_text("Juniper")


def test_wf_owner_comparison_reduced_motion(browser):
    jun = juniper_id()
    with ui(browser, ADA, f"/horses/{jun}?hoof=LF") as page:
        see(page, visible(page.get_by_role("slider", name="Comparison divider")))
        expect(page.get_by_role("radiogroup", name="Divider position")).to_have_count(0)
    with ui(browser, ADA, f"/horses/{jun}?hoof=LF", reduced_motion="reduce") as page:
        slider = page.get_by_role("slider", name="Comparison divider")
        group = page.get_by_role("radiogroup", name="Divider position")
        see(page, visible(group))
        for name, value in [("Previous", "0"), ("Current", "100"), ("Split", "50")]:
            click_choice(group.get_by_role("radio", name=name))
            divider_is(slider, value)
            expect(group.get_by_role("radio", name=name)).to_be_checked()
        tab_to(page, slider)
        page.keyboard.press("Home")
        divider_is(slider, "0")
        expect(group.get_by_role("radio", name="Previous")).to_be_checked()
        click_choice(page.get_by_role("radio", name="Right fore"))
        divider_is(slider, "50")
        for line in JUNIPER_RF:
            expect(page.get_by_role("status", name="Angle readout")).to_contain_text(line)
        assert animations(page.get_by_role("region", name="Hoof comparison")) == []


def test_wf_owner_comparison_live(browser):
    f, jun = farrier(), juniper_id()
    ada = Owner(ADA_NAME, ADA, [{"id": jun, "name": "Juniper"}])
    prev_id = f.ok("GET", f"/api/horses/{jun}/comparison?hoof=LF")["previous"]["visit_id"]
    photo = None
    with ui(browser, FARRIER, f"/horses/{jun}?hoof=LF") as page:
        slider = page.get_by_role("slider", name="Comparison divider")
        readout = page.get_by_role("status", name="Angle readout")
        stage = page.get_by_role("region", name="Hoof comparison")
        see(page, lambda: divider_is(slider, "50", timeout=300))
        tab_to(page, slider)
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        advance(page, UNDER_HALF_S_MS)
        prev_box, cur_box = page.get_by_role("combobox", name="Previous visit"), page.get_by_role("combobox", name="Current visit")
        before, before_text = (shown(prev_box), shown(cur_box)), readout.inner_text()
        day = new_day(days=0, slots=1)
        b = confirmed(ada, day)
        start_day(day)
        v = f.ok("POST", f"/api/bookings/{b['id']}/visit", status=201)

        def new_option_listed():
            assert day["business_date"] in option_text(cur_box)

        try:
            r = upload(v["id"], "LF", "after", distinct_png())
            assert r.status_code == 201
            photo = r.json()
            assert save_marks(v["id"], "LF", None, *LF42).status_code == 200
            see(page, new_option_listed, seconds=30)
            divider_is(slider, "53")
            expect(slider).to_be_focused()
            assert (shown(prev_box), shown(cur_box)) == before and readout.inner_text() == before_text
            select(cur_box, day["business_date"])
            see(page, has_text(readout, JUNIPER_LF[0]))
            advance(page, UNDER_HALF_S_MS)
            divider_is(slider, "50")
            tab_to(page, slider)
            assert save_marks(v["id"], "LF", 1, *RF84, who=as_user(APPRENTICE)).status_code == 200
            api = f.ok("GET", f"/api/horses/{jun}/comparison?hoof=LF&previous={prev_id}&current={v['id']}")
            for line in api["readout"]:
                see(page, has_text(readout, line), seconds=30)
            divider_is(slider, "50")
            expect(slider).to_be_focused()
        finally:
            if photo:
                f.call("DELETE", f"/api/photos/{photo['id']}")


def test_comparison_wipe(browser):
    f, jun = farrier(), juniper_id()
    ada = Owner(ADA_NAME, ADA, [{"id": jun, "name": "Juniper"}])
    day = new_day(days=0, slots=1)
    b = confirmed(ada, day)
    start_day(day)
    v = f.ok("POST", f"/api/bookings/{b['id']}/visit", status=201)
    r = upload(v["id"], "LF", "after", distinct_png())
    assert r.status_code == 201, r.text
    photo = r.json()
    try:
        assert save_marks(v["id"], "LF", None, *LF42).status_code == 200
        with ui(browser, FARRIER, f"/horses/{jun}?hoof=LF") as page:
            slider = page.get_by_role("slider", name="Comparison divider")
            stage = page.get_by_role("region", name="Hoof comparison")
            cur_box = page.get_by_role("combobox", name="Current visit")
            see(page, lambda: divider_is(slider, "50", timeout=300))

            def current_is_new():
                assert day["business_date"] in shown(cur_box)

            see(page, current_is_new)
            tab_to(page, slider)
            frames = {}
            for key, value in (("Home", "0"), ("End", "100")):
                page.keyboard.press(key)
                advance(page, UNDER_HALF_S_MS)
                divider_is(slider, value)
                frames[value] = decode(capture(stage))
            for _ in range(5):
                page.keyboard.press("PageDown")
            advance(page, UNDER_HALF_S_MS)
            divider_is(slider, "50")
            frames["50"] = decode(capture(stage))
            changed(frames["0"], frames["100"])
            assert difference(frames["0"], frames["50"]) > 0 and difference(frames["50"], frames["100"]) > 0
    finally:
        f.call("DELETE", f"/api/photos/{photo['id']}")


def vet_get(token, base=None, path="", headers=None):
    def attempt():
        r = httpx.get(f"{base or BASE}/api/vet/{token}{path}", headers=headers, timeout=TIMEOUT)
        return [r] if r.status_code != 429 else None
    return eventually(attempt, VET_WINDOW_S + JOB_SLACK_S, every=3, what="vet read outside the guess window")[0]


def issue_link(base=None):
    name, email = person("vet")
    r = farrier().ok("POST", f"/api/horses/{juniper_id()}/vet-links", {"vet_name": name, "vet_email": email}, 201, base=base)
    return r, r["url"].rstrip("/").rsplit("/", 1)[1], email


def test_wf_vet_link_scope_revoke():
    f, jun = farrier(), juniper_id()
    link, token, vemail = issue_link()
    assert urlparse(link["url"]).path == f"/vet/{token}"
    closed = sorted((x for x in f.ok("GET", f"/api/horses/{jun}/visits") if x["status"] != "open"),
                    key=lambda x: x["business_date"])[-2:]
    assert (link["previous_visit_id"], link["current_visit_id"]) == (closed[0]["id"], closed[1]["id"])
    r = vet_get(token)
    assert r.status_code == 200 and set(r.json()) == VET_TOP_KEYS
    body = r.json()
    assert body["horse"] == {"name": "Juniper"}
    lf = body["hooves"]["LF"]
    assert set(lf) == VET_HOOF_KEYS and set(lf["previous"]) == VET_SIDE_KEYS and set(lf["previous"]["photo"]) == VET_PHOTO_KEYS
    assert lf["readout"] == JUNIPER_LF and body["hooves"]["LH"] is None
    for leak in (ADA_NAME, ADA, jun, "visit_id", "marked_visits", '"version"'):
        assert leak not in r.text
    photo_url = BASE + lf["current"]["photo"]["url"]
    assert httpx.get(photo_url, timeout=TIMEOUT).status_code == 200
    for method in ("POST", "PUT", "DELETE"):
        err(httpx.request(method, f"{BASE}/api/vet/{token}", json={}, timeout=TIMEOUT), 405, "read_only")
    err(Who(bearer=token).call("GET", "/api/horses"), 401, "unauthenticated")
    assert f.ok("POST", f"/api/vet-links/{link['id']}/revoke")["status"] == "revoked"
    err(vet_get(token), 404, "not_found")
    l2, t2, _ = issue_link()
    regen = f.ok("POST", f"/api/vet-links/{l2['id']}/regenerate")
    new_token = regen["url"].rstrip("/").rsplit("/", 1)[1]
    assert new_token != t2 and vet_get(new_token).status_code == 200
    err(vet_get(t2), 404, "not_found")
    listing = f.call("GET", f"/api/horses/{jun}/vet-links")
    assert token not in listing.text and new_token not in listing.text
    l3, t3, _ = issue_link(base=inst(KB_DOWN))
    assert vet_get(t3).status_code == 200
    eventually(lambda: vet_get(t3).status_code == 404, VET_TTL_FAST_S + JOB_SLACK_S, every=2)
    assert next(x for x in f.ok("GET", f"/api/horses/{jun}/vet-links") if x["id"] == l3["id"])["status"] == "expired"


def test_vet_revoke_immediate():
    link, token, _ = issue_link()
    lf = vet_get(token, base=inst(PEER)).json()["hooves"]["LF"]
    photos = [lf[side]["photo"]["url"] for side in ("previous", "current")]
    for p in photos:
        assert httpx.get(BASE + p, timeout=TIMEOUT).status_code == 200
    farrier().ok("POST", f"/api/vet-links/{link['id']}/revoke", base=inst(PEER))
    for base in (BASE, inst(PEER)):
        err(vet_get(token, base=base), 404, "not_found")
        for p in photos:
            err(httpx.get(base + p, timeout=TIMEOUT), 403, "url_invalid")


def test_vet_link_views():
    link, token, _ = issue_link()
    agent = {"User-Agent": f"probe-agent-{uuid.uuid4().hex[:8]}"}
    assert vet_get(token, headers=agent).status_code == 200
    farrier().ok("POST", f"/api/vet-links/{link['id']}/revoke")
    err(vet_get(token, base=inst(PEER), headers=agent), 404, "not_found")
    views = farrier().ok("GET", f"/api/vet-links/{link['id']}/views")
    assert [v["outcome"] for v in views] == ["revoked", "viewed"]
    assert all(v["user_agent"] == agent["User-Agent"] and v["address"] and v["at"] for v in views)
    assert views[0]["at"] >= views[1]["at"]


def test_wf_vet_link_guess_limit():
    link, token, _ = issue_link()
    assert vet_get(token).status_code == 200
    for i in range(VET_MISSES):
        r = httpx.get(f"{inst(PEER) if i % 2 else BASE}/api/vet/probe-miss-{uuid.uuid4().hex}", timeout=TIMEOUT)
        assert r.status_code in (404, 429)
    views_before = len(farrier().ok("GET", f"/api/vet-links/{link['id']}/views"))
    for base in (inst(PEER), BASE):
        r = httpx.get(f"{base}/api/vet/{token}", timeout=TIMEOUT)
        assert r.status_code == 429 and r.json() == {"error": "rate_limited"}
        assert 1 <= int(r.headers["Retry-After"]) <= VET_WINDOW_S
    assert len(farrier().ok("GET", f"/api/vet-links/{link['id']}/views")) == views_before
    assert vet_get(token).status_code == 200


def test_wf_vet_link_ui(browser, mail):
    jun = juniper_id()
    vname, vemail = person("vet")
    with ui(browser, FARRIER, f"/horses/{jun}?hoof=LF") as page:
        see(page, visible(page.get_by_role("button", name="Send vet link")))
        click(page.get_by_role("button", name="Send vet link"))
        dlg = page.get_by_role("dialog", name="Send vet link")
        fill(dlg.get_by_role("textbox", name="Vet name"), vname)
        fill(dlg.get_by_role("textbox", name="Vet email"), vemail)
        click(dlg.get_by_role("button", name="Send link"))
        see(page, has_text(notices(page), f"Comparison link sent to {vemail}."))
    msgs = inbox(mail, vemail, "Hoof comparison for Juniper")
    assert len(msgs) == 1
    body = text(msgs[0])
    path = re.search(r"/vet/[A-Za-z0-9_-]+", body).group(0)
    entry = next(x for x in farrier().ok("GET", f"/api/horses/{jun}/vet-links") if x["vet_email"] == vemail)
    assert f"This link works until {entry['expires_at'][:10]} {entry['expires_at'][11:16]} ({ZONE})." in body
    assert vet_get(path.rsplit("/", 1)[1]).status_code == 200


def test_wf_vet_link_page(browser):
    jun = juniper_id()
    link, token, vemail = issue_link()
    path = f"/vet/{token}"
    data = vet_get(token).json()
    with open_app(browser, BASE + path) as page:
        main = page.get_by_role("region", name="Hoof comparison")
        see(page, visible(main))
        for t in ("Juniper", data["previous_date"], data["current_date"]):
            expect(page.locator("body")).to_contain_text(t)
        expect(page.get_by_role("slider", name="Comparison divider")).to_be_visible()
        expect(page.get_by_role("radiogroup", name="Hoof")).to_be_visible()
        expect(page.get_by_role("navigation", name="Barn days")).to_have_count(0)
        expect(page.get_by_role("textbox")).to_have_count(0)
        content = page.locator("body").inner_text()
        assert ADA_NAME not in content and ADA not in content and "$" not in content
    assert next(x for x in farrier().ok("GET", f"/api/horses/{jun}/vet-links") if x["vet_email"] == vemail)["view_count"] >= 1


def test_wf_owner_invoices_pay(killbill):
    (o,) = new_owners(1)
    (stranger,) = new_owners(1)
    inv, b, day = invoiced(o)
    assert inv["id"] in {i["id"] for i in o.ok("GET", "/api/invoices")}
    path = f"/api/invoices/{inv['id']}/payments"
    err(stranger.call("POST", path, {"card_token": APPROVE}, key=idempotency_key()), 404, "not_found")
    assert inv["id"] not in {i["id"] for i in stranger.ok("GET", "/api/invoices")}
    assert invoice_of(o, inv["id"])["status"] == "unpaid"
    assert [p for p in o.ok("GET", f"/api/payments?invoice_id={inv['id']}") if p["kind"] == "invoice"] == []
    err(o.call("POST", path, {"card_token": APPROVE}), 400, "idempotency_key_required")
    key = idempotency_key()
    r = o.call("POST", path, {"card_token": APPROVE}, key=key)
    assert r.status_code == 201 and (r.json()["status"], r.json()["balance_cents"]) == ("paid", 0), r.text
    replay = o.call("POST", path, {"card_token": APPROVE}, key=key)
    assert replay.status_code == 201 and replay.json() == r.json()
    err(o.call("POST", path, {"card_token": APPROVE}, key=idempotency_key()), 409, "already_paid")
    pays = [p for p in o.ok("GET", f"/api/payments?invoice_id={inv['id']}") if p["status"] == "captured"]
    assert len(pays) == 1 and pays[0]["kind"] == "invoice" and pays[0]["amount_cents"] == inv["balance_cents"]
    assert pays[0]["killbill_status"] == "recorded"
    tx = kb_key(killbill, o.email, f"{pays[0]['id']}:capture")
    assert len(tx) == 1 and cents(tx[0]["amount"]) == inv["balance_cents"]
    assert cents(kb_invoices(killbill, o.email, inv["id"])[0]["balance"]) == 0


def test_invoice_readback(killbill):
    (o,) = new_owners(1, horses=2)
    inv, b, day = invoiced(o)
    path = f"/api/invoices/{inv['id']}/reconciliation"
    rec = farrier().ok("GET", path)
    assert rec["status"] == "matched" and rec["app"] == rec["killbill"] and rec["differences"] == []
    kb = kb_invoices(killbill, o.email, inv["id"])[0]
    assert rec["killbill"]["balance"] == cents(kb["balance"]) == inv["balance_cents"]
    assert invoice_of(farrier(), inv["id"])["reconciliation"] == "matched"
    assert o.call("POST", f"/api/invoices/{inv['id']}/payments", {"card_token": APPROVE}, key=idempotency_key()).status_code == 201
    paid = farrier().ok("GET", path)
    assert paid["status"] == "matched" and paid["killbill"]["balance"] == 0 and paid["app"] == paid["killbill"]
    card = next(p for p in o.ok("GET", f"/api/payments?invoice_id={inv['id']}") if p["status"] == "captured")
    prec = farrier().ok("GET", f"/api/payments/{card['id']}/reconciliation")
    assert prec["status"] == "matched" and prec["app"]["paid"] == card["captured_cents"]
    down = farrier().ok("GET", path, base=inst(KB_DOWN))
    assert (down["status"], down["killbill"], down["differences"]) == ("unavailable", None, [])
    day2 = new_day(days=0, slots=1)
    b2 = confirmed(o, day2, horse=1)
    start_day(day2)
    v2 = visit_for(b2)
    pend = close_visit(v2["id"], ["trim"], base=inst(KB_DOWN)).json()["invoice"]
    early = farrier().ok("GET", f"/api/invoices/{pend['id']}/reconciliation")
    assert (early["status"], early["killbill"], early["differences"]) == ("unavailable", None, [])


def test_wf_owner_invoices_concurrent_outage(killbill):
    (o,) = new_owners(1, horses=2)
    inv1, _, _ = invoiced(o, horse=0)
    inv2, _, _ = invoiced(o, horse=1)
    res = together([lambda i=i: o.call("POST", f"/api/invoices/{inv1['id']}/payments", {"card_token": APPROVE},
                                       key=idempotency_key(), base=inst(PEER) if i % 2 else None) for i in range(5)])
    assert [r.status_code for r in res].count(201) == 1
    for r in res:
        if r.status_code != 201:
            err(r, 409, "already_paid")
    pids = [p["id"] for p in o.ok("GET", f"/api/payments?invoice_id={inv1['id']}") if p["status"] == "captured"]
    assert len(pids) == 1
    assert sum(len(kb_key(killbill, o.email, f"{p['id']}:capture"))
               for p in o.ok("GET", f"/api/payments?invoice_id={inv1['id']}")) == 1
    err(o.call("POST", f"/api/invoices/{inv2['id']}/payments", {"card_token": APPROVE}, key=idempotency_key(),
               base=inst(KB_DOWN)), 503, "billing_unavailable")
    after = invoice_of(o, inv2["id"])
    assert (after["status"], after["balance_cents"]) == ("unpaid", inv2["balance_cents"])
    ps = o.ok("GET", f"/api/payments?invoice_id={inv2['id']}")
    assert [p["status"] for p in ps] == ["voided"]
    assert kb_key(killbill, o.email, f"{ps[0]['id']}:capture") == []
    assert o.call("POST", f"/api/invoices/{inv2['id']}/payments", {"card_token": APPROVE}, key=idempotency_key()).status_code == 201


def test_wf_owner_invoices_ui(browser, killbill):
    (o,) = new_owners(1)
    inv, b, day = invoiced(o)
    name = f"Pay {o.horses[0]['name']} {day['business_date']}"
    with ui(browser, o.email, "/invoices", base=inst(KB_DOWN)) as page:
        btn = page.get_by_role("button", name=name)
        see(page, visible(btn))
        click(btn)
        see(page, has_text(notices(page), "Billing is unreachable. Your payment was not recorded; try again shortly."))
        expect(page.get_by_role("row").filter(has=btn)).to_contain_text("Unpaid")
        expect(btn).to_be_enabled()
        expect(btn).to_be_focused()
    with ui(browser, o.email, "/invoices") as page:
        btn = page.get_by_role("button", name=name)
        row = page.get_by_role("row").filter(has=btn)
        see(page, visible(btn))
        with held(page, "**/api/invoices/*/payments") as gate:
            click(btn)
            see(page, has_text(notices(page), "Recording payment…"))
            expect(btn).to_be_disabled()
            expect(row).to_contain_text("Unpaid")
            gate.release()
        see(page, has_text(page.get_by_role("table", name="Invoices"), "Paid"))
        see(page, has_text(notices(page), f"Payment of {dollars(inv['balance_cents'])} recorded."))
    pays = [p for p in o.ok("GET", f"/api/payments?invoice_id={inv['id']}") if p["status"] == "captured"]
    assert len(pays) == 1 and len(kb_key(killbill, o.email, f"{pays[0]['id']}:capture")) == 1


def test_wf_rate_limiting_sign_in():
    _, email = person("limit")
    for i in range(SIGN_IN_CAP):
        r = sign_in(email, "wrong-probe", base=inst(PEER) if i % 2 else None)
        assert r.status_code == 401, r.text
        assert r.headers["RateLimit-Limit"] == str(SIGN_IN_CAP)
        assert SIGN_IN_CAP - i - 1 <= int(r.headers["RateLimit-Remaining"]) <= SIGN_IN_CAP - i
    r = sign_in(email.upper(), "wrong-probe")
    assert r.status_code == 429 and r.json() == {"error": "rate_limited", "bucket": "sign_in", "scope": "user"}
    assert int(r.headers["Retry-After"]) >= 1 and r.headers["RateLimit-Remaining"] == "0"
    assert r.headers["RateLimit-Limit"] == str(SIGN_IN_CAP)


def test_wf_rate_limiting_payment():
    (o,) = new_owners(1)
    t0, first = time.monotonic(), None
    for i in range(PAYMENT_CAP + 10):
        r = o.call("PUT", "/api/my/card", {"card_token": APPROVE}, base=inst(PEER) if i % 2 else None)
        if r.status_code == 429:
            first = (i, r)
            break
        assert r.status_code == 200 and r.json() == {"last4": "4242"}
    assert first
    i, r = first
    assert PAYMENT_CAP <= i <= PAYMENT_CAP + int((time.monotonic() - t0) * PAYMENT_REFILL / 60) + 1
    assert r.json() == {"error": "rate_limited", "bucket": "payment", "scope": "user"}
    assert int(r.headers["Retry-After"]) >= 1 and r.headers["RateLimit-Limit"] == str(PAYMENT_CAP)


def test_wf_horizontal_scale_shared_state():
    (o,) = new_owners(1, horses=2)
    s = Who(o.email, cookie_of(sign_in(o.email, base=inst(PEER))))
    assert s.get("/api/me").status_code == 200
    day = new_day(days=rand_days(), slots=3)
    p = hold(o, day, horse=0).json()
    q = hold(o, day, horse=1, base=inst(FAST)).json()
    diff = (instant(p["hold_expires_at"]) - instant(q["hold_expires_at"])).total_seconds()
    expected = HOLD_DEFAULT_S - HOLD_FAST_S
    assert expected - LATENCY_S <= diff <= expected + 1
    assert next(b for b in my_bookings(o, day) if b["id"] == q["id"])["hold_expires_at"] == q["hold_expires_at"]
    body, key = csv_bytes([[*person("scale"), PHONE, f"Horse {uuid.uuid4().hex[:8]}", CEDAR, f"S{uuid.uuid4().hex[:8]}", "6"]]), idempotency_key()
    first = import_csv(body, key)
    again = import_csv(body, key, base=inst(PEER))
    assert first.status_code == again.status_code == 201 and first.json() == again.json()
    st = Stream(inst(PEER) + f"/api/barn-days/{day['id']}/events", farrier().cookie).ready()
    o.ok("POST", f"/api/bookings/{p['id']}/confirm")
    assert st.next(STREAM_DELIVERY_S)["event"] == "booking_added"
    st.close()
    assert s.call("DELETE", "/api/session", base=inst(PEER)).status_code == 204
    err(s.get("/api/me"), 401, "unauthenticated")


def test_wf_horizontal_scale_clock_offset():
    (o,) = new_owners(1, horses=2)
    day = new_day(days=rand_days(), slots=2)
    with app_copy({"CLOCK_OFFSET_SECONDS": "172800", "INSTANCE_LABEL": "clock-probe"}) as cp:
        shifted = dt.date.fromisoformat(farrier().ok("GET", "/api/practice", base=cp.url)["today"])
        assert shifted - today() == dt.timedelta(days=2)
        p = hold(o, day, horse=0).json()
        q = hold(o, day, horse=1, base=cp.url).json()
    diff = (instant(q["hold_expires_at"]) - instant(p["hold_expires_at"])).total_seconds()
    assert 172800 - LATENCY_S <= diff <= 172800 + LATENCY_S
    assert next(b for b in my_bookings(o, day) if b["id"] == q["id"])["status"] == "held"


def test_wf_deposit_gateway_lifecycle(killbill):
    (o,) = new_owners(1, horses=4)
    fut, tod = new_day(days=4, start="07:30", slots=4), new_day(days=0, slots=1)
    b1 = confirmed(o, fut, horse=0)
    p1 = payment(o, b1["payment_id"])
    assert (p1["status"], p1["disposition"], p1["captured_cents"]) == ("captured", "held", b1["deposit_cents"])
    eventually(lambda: payment(o, b1["payment_id"])["killbill_status"] == "recorded", DELIVERY_S)
    cap = kb_key(killbill, o.email, f"{b1['payment_id']}:capture")
    assert len(cap) == 1 and cents(cap[0]["amount"]) == b1["deposit_cents"]
    acct = killbill.account(o.email)
    descs = [it.get("description") for i in killbill.invoices(acct["accountId"]) for it in i.get("items") or []]
    assert f"Booking deposit — {o.horses[0]['name']} {fut['business_date']} [{b1['payment_id']}]" in descs
    o.ok("POST", f"/api/bookings/{b1['id']}/cancel")
    p1 = payment(o, b1["payment_id"])
    assert (p1["status"], p1["disposition"], p1["refunded_cents"]) == ("refunded", None, b1["deposit_cents"])

    def refunded_in_kb():
        return sum(cents(t["amount"]) for t in kb_txns(killbill, o.email)
                   if (t.get("transactionType") or "").upper().startswith(("REFUND", "CREDIT"))) == b1["deposit_cents"]

    eventually(refunded_in_kb, DELIVERY_S)
    h2 = hold(o, fut, horse=1).json()
    o.call("DELETE", f"/api/bookings/{h2['id']}")
    assert payment(o, h2["payment_id"])["status"] == "voided"
    assert kb_key(killbill, o.email, f"{h2['payment_id']}:capture") == []
    for card, code, last4 in [(HARD, "do_not_honor", "0002"), (SOFT, "insufficient_funds", "9995")]:
        r = hold(o, fut, horse=2, card=card)
        assert r.status_code == 402 and r.json() == {"error": "card_declined", "decline_code": code}
        assert all(b["horse"]["id"] != o.horses[2]["id"] for b in my_bookings(o, fut))
        assert any(p["status"] == "declined" and p["card_last4"] == last4 for p in o.ok("GET", "/api/payments"))
    b4 = confirmed(o, tod, horse=3)
    o.ok("POST", f"/api/bookings/{b4['id']}/cancel")
    p4 = payment(o, b4["payment_id"])
    assert (p4["status"], p4["disposition"]) == ("captured", "forfeited")


def test_wf_deposit_gateway_state_machine(killbill):
    (o,) = new_owners(1, horses=2)
    day = new_day(days=4, slots=2)
    f = farrier()
    h1 = hold(o, day, horse=0).json()
    pid, dep = h1["payment_id"], h1["deposit_cents"]
    err(f.call("POST", f"/api/payments/{pid}/capture", {}), 400, "idempotency_key_required")
    key = idempotency_key()
    cap = f.ok("POST", f"/api/payments/{pid}/capture", key=key)
    assert cap["status"] == "captured"
    assert f.ok("POST", f"/api/payments/{pid}/capture", key=key) == cap
    assert my_bookings(o, day)[0]["status"] == "held"
    assert o.ok("POST", f"/api/bookings/{h1['id']}/confirm")["status"] == "confirmed"
    assert payment(o, pid)["captured_cents"] == dep
    eventually(lambda: len(kb_key(killbill, o.email, f"{pid}:capture")) == 1, DELIVERY_S)
    illegal(f.call("POST", f"/api/payments/{pid}/capture", {}, key=idempotency_key()), "captured", "capture")
    illegal(f.call("POST", f"/api/payments/{pid}/void", {}, key=idempotency_key()), "captured", "void")
    part = dep // 4
    r = f.ok("POST", f"/api/payments/{pid}/refund", {"amount_cents": part}, key=idempotency_key())
    assert (r["status"], r["refunded_cents"]) == ("partially_refunded", part)
    over = f.call("POST", f"/api/payments/{pid}/refund", {"amount_cents": dep}, key=idempotency_key())
    assert over.status_code == 409 and over.json() == {"error": "refund_exceeds_captured", "refundable_cents": dep - part}
    chunk = (dep - part) // 2 + 1
    res = together([lambda: f.call("POST", f"/api/payments/{pid}/refund", {"amount_cents": chunk}, key=idempotency_key())
                    for _ in range(4)])
    assert [x.status_code for x in res].count(200) == 1
    assert all(x.json()["error"] == "refund_exceeds_captured" for x in res if x.status_code != 200)
    rest = dep - part - chunk
    assert f.ok("POST", f"/api/payments/{pid}/refund", {"amount_cents": rest}, key=idempotency_key())["status"] == "refunded"
    illegal(f.call("POST", f"/api/payments/{pid}/refund", {"amount_cents": 1}, key=idempotency_key()), "refunded", "refund")
    h2 = hold(o, day, horse=1).json()
    assert f.ok("POST", f"/api/payments/{h2['payment_id']}/void", key=idempotency_key())["status"] == "voided"
    err(o.call("POST", f"/api/bookings/{h2['id']}/confirm", {}), 404, "not_found")
    assert sum(s["state"] == "open" for s in get_day(o, day)["slots"]) == 1


def test_wf_deposit_gateway_cards():
    (o,) = new_owners(1)
    day = new_day(days=4, slots=1)
    r = hold(o, day, card=CARD_NUMBER)
    assert r.status_code == 422 and r.json()["errors"]["card_token"] == "Enter a test card token, never a card number."
    r = hold(o, day, card="tok_unknown_probe")
    assert r.status_code == 422 and r.json()["errors"]["card_token"] == "Choose one of the test cards."
    assert o.call("PUT", "/api/my/card", {"card_token": CARD_NUMBER}).status_code == 422
    for token, last4 in [(APPROVE, "4242"), (SOFT, "9995"), (HARD, "0002")]:
        assert o.ok("PUT", "/api/my/card", {"card_token": token}) == {"last4": last4}
    r = hold(o, day)
    assert r.status_code == 201 and payment(o, r.json()["payment_id"])["card_last4"] == "4242"
    assert pg_contains(CARD_NUMBER) == []


def test_wf_dunning_soft_schedule(mail, killbill):
    (o,) = new_owners(1, horses=2)
    (filler,) = new_owners(1)
    inv, b, day = invoiced(o)
    h, date = o.horses[0]["name"], day["business_date"]
    r = o.call("POST", f"/api/invoices/{inv['id']}/payments", {"card_token": SOFT}, key=idempotency_key(), base=inst(FAST))
    assert r.status_code == 402 and r.json() == {"error": "card_declined", "decline_code": "insufficient_funds"}
    assert invoice_of(o, inv["id"])["dunning_state"] == "past_due"
    seen = []

    def blocked():
        s = invoice_of(o, inv["id"])["dunning_state"]
        if not seen or seen[-1] != s:
            seen.append(s)
        return s == "blocked"

    eventually(blocked, DUNNING_OFFSETS[-1] * DUNNING_DAY_FAST_S + JOB_START_S + JOB_SLACK_S)
    order = ["past_due", "retry_1", "retry_2", "blocked"]
    assert [order.index(s) for s in seen] == sorted(order.index(s) for s in seen)
    nexts = (today().isoformat(), (today() + dt.timedelta(days=1)).isoformat())
    for subject in (f"Payment failed: {h} on {date}", f"Second payment attempt failed: {h} on {date}",
                    f"Third payment attempt failed: {h} on {date}"):
        msgs = inbox(mail, o.email, subject)
        assert len(msgs) == 1 and any(f"We will try again on {d}." in text(msgs[0]) for d in nexts)
    blk = inbox(mail, o.email, f"Account on hold: {h} on {date}")
    assert len(blk) == 1 and "New bookings are on hold until this invoice is paid." in text(blk[0])
    fut = new_day(days=4, slots=1)
    err(hold(o, fut, horse=1), 409, "account_blocked")
    confirmed(filler, fut)
    err(o.call("POST", f"/api/barn-days/{fut['id']}/waitlist", {"horse_id": o.horses[1]["id"], "card_token": APPROVE}),
        409, "account_blocked")
    assert o.call("POST", f"/api/invoices/{inv['id']}/payments", {"card_token": APPROVE}, key=idempotency_key()).status_code == 201
    after = invoice_of(o, inv["id"])
    assert (after["status"], after["dunning_state"]) == ("paid", "cleared")
    assert len(inbox(mail, o.email, f"Payment received: {h} on {date}")) == 1
    assert hold(o, new_day(days=4, slots=1), horse=1).status_code == 201


def test_wf_dunning_hard_block(mail):
    (o,) = new_owners(1, horses=2)
    inv, b, day = invoiced(o)
    h, date = o.horses[0]["name"], day["business_date"]
    path = f"/api/invoices/{inv['id']}/payments"
    r = o.call("POST", path, {"card_token": HARD}, key=idempotency_key())
    assert r.status_code == 402 and r.json()["decline_code"] == "do_not_honor"
    assert invoice_of(o, inv["id"])["dunning_state"] == "blocked"
    assert len(inbox(mail, o.email, f"Account on hold: {h} on {date}")) == 1
    assert inbox(mail, o.email, f"Payment failed: {h} on {date}", expect=0) == []
    assert o.call("POST", path, {"card_token": SOFT}, key=idempotency_key()).status_code == 402
    assert invoice_of(o, inv["id"])["dunning_state"] == "blocked"
    err(hold(o, new_day(days=4, slots=1), horse=1), 409, "account_blocked")
    assert o.call("POST", path, {"card_token": APPROVE}, key=idempotency_key()).status_code == 201
    assert invoice_of(o, inv["id"])["dunning_state"] == "cleared"
    assert len(inbox(mail, o.email, f"Payment received: {h} on {date}")) == 1


def test_wf_job_queue_export_job():
    month = today().isoformat()[:7]
    job_id = farrier().ok("POST", "/api/dashboard/exports", {"month": month}, 202, base=inst(KB_DOWN))["job_id"]
    job = eventually(lambda: (lambda j: j if j["status"] == "succeeded" else None)(
        farrier().ok("GET", f"/api/jobs/{job_id}")), JOB_SLACK_S + JOB_START_S)
    assert job["kind"] == "csv_export" and job["max_attempts"] == JOB_MAX_ATTEMPTS and job["attempts"] >= 1
    key = f"{EXPORT_PREFIX}/{month}/{job_id}.csv"
    assert job["result"]["key"] == key and job["result"]["url"] and job["result"]["url_expires_at"]
    assert [k for k in S3().keys(f"{EXPORT_PREFIX}/{month}/") if k.endswith(f"{job_id}.csv")] == [key]
    illegal(farrier().call("POST", f"/api/jobs/{job_id}/retry", {}), "succeeded", "retry")
    assert job_id in [j["id"] for j in farrier().ok("GET", "/api/jobs?status=succeeded")]
    err(as_user(APPRENTICE).call("GET", f"/api/jobs/{job_id}"), 403, "forbidden")


def test_wf_job_queue_due_reminders(mail):
    horses = farrier().ok("GET", "/api/horses")

    def reminders(h):
        return [j for j in farrier().ok("GET", "/api/jobs?kind=due_reminder")
                if j["result"] == {"horse_id": h["id"], "next_due_date": h["next_due_date"]}]

    for h in [h for h in horses if h["due_status"] == "due" and h["name"] == "Juniper"]:
        assert len(eventually(lambda: reminders(h), JOB_SLACK_S + JOB_START_S)) == 1
    cur = min((h for h in horses if h["due_status"] == "current" and h["next_due_date"]),
              key=lambda h: h["next_due_date"])
    shift = (dt.date.fromisoformat(cur["next_due_date"]) - dt.timedelta(days=6) - today()).days
    env = {"CLOCK_OFFSET_SECONDS": str(shift * 86400), "REMINDER_SCAN_SECONDS": str(REMINDER_PROBE_S)}
    subject = f"Due soon: {cur['name']} by {cur['next_due_date']}"
    with app_copy({**env, "INSTANCE_LABEL": "remind-a"}), app_copy({**env, "INSTANCE_LABEL": "remind-b"}):
        assert len(inbox(mail, cur["owner"]["email"], subject, seconds=JOB_SLACK_S + MAIL_WAIT_S)) == 1

        def one_only():
            assert len(inbox(mail, cur["owner"]["email"], subject, expect=0)) == 1
            assert len(reminders(cur)) == 1
        during(REMINDER_PROBE_S * 4, one_only, every=REMINDER_PROBE_S)
    for j in farrier().ok("GET", "/api/jobs?status=dead")[:1]:
        r = farrier().ok("POST", f"/api/jobs/{j['id']}/retry")
        assert (r["status"], r["attempts"]) == ("queued", 0)
    assert farrier().ok("GET", "/api/horses") and len(farrier().ok("GET", "/api/jobs")) <= 200


def dashboard(month):
    return farrier().ok("GET", f"/api/dashboard?month={month}")


def test_wf_practice_dashboard_figures(killbill):
    month = today().isoformat()[:7]
    d0 = dashboard(month)
    for k in ("billed_cents", "collected_cents", "refunded_cents"):
        assert d0[k] == sum(r[k] for r in d0["rows"])
    (o,) = new_owners(1)
    inv, b, day = invoiced(o, work=("trim",))
    gross = sum(i["amount_cents"] for i in inv["items"] if i["amount_cents"] > 0)
    assert o.call("POST", f"/api/invoices/{inv['id']}/payments", {"card_token": APPROVE}, key=idempotency_key()).status_code == 201
    dep, card = b["deposit_cents"], inv["balance_cents"]

    def moved():
        d1 = dashboard(month)
        return ((d1["billed_cents"] - d0["billed_cents"], d1["collected_cents"] - d0["collected_cents"],
                 d1["refunded_cents"] - d0["refunded_cents"]) == (gross, dep + card, 0))

    eventually(moved, DELIVERY_S)
    net = sum(cents(t["amount"]) * (-1 if (t.get("transactionType") or "").upper().startswith(("REFUND", "CREDIT")) else 1)
              for t in kb_txns(killbill, o.email))
    assert net == dep + card
    assert farrier().call("GET", "/api/dashboard?month=not-a-month").status_code == 422


def test_wf_practice_dashboard_export():
    tag = uuid.uuid4().hex[:8]
    (o,) = new_owners(1, owner_names=[f"=SUM probe {tag}"], horse_names=[f"-Horse {tag}"])
    b = confirmed(o, new_day(days=4, slots=1))
    month = today().isoformat()[:7]
    eventually(lambda: payment(o, b["payment_id"])["killbill_status"] == "recorded", DELIVERY_S)
    job_id = farrier().ok("POST", "/api/dashboard/exports", {"month": month}, 202)["job_id"]
    job = eventually(lambda: (lambda j: j if j["status"] == "succeeded" else None)(
        farrier().ok("GET", f"/api/jobs/{job_id}")), JOB_SLACK_S + JOB_START_S)
    body = S3().get(job["result"]["key"]).decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(body)))
    assert ",".join(rows[0]) == EXPORT_HEADER
    mine = [r for r in rows[1:] if tag in r[2]]
    assert mine and all(r[2] == f"'=SUM probe {tag}" and r[3] == f"'-Horse {tag}" for r in mine)
    cap = [r for r in mine if r[1] == "deposit_captured"]
    assert len(cap) == 1 and cap[0][4] == plain_dollars(b["deposit_cents"]) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", cap[0][0])


def test_wf_practice_dashboard_layout_ui(browser):
    month = today().isoformat()[:7]
    for w, h in VIEWPORTS:
        with ui(browser, FARRIER, "/dashboard") as page:
            page.set_viewport_size({"width": w, "height": h})
            fig = page.get_by_role("figure", name="Billed and collected")
            see(page, visible(fig))
            advance(page, 1000)
            layout(page)
            m = page.get_by_role("combobox", name="Month").bounding_box()
            e = page.get_by_role("button", name="Export CSV").bounding_box()
            t = page.get_by_role("table", name="Month totals").bounding_box()
            d = page.get_by_role("table", name="Daily figures").bounding_box()
            c = fig.bounding_box()
            if w == 1280:
                assert abs(m["y"] - e["y"]) < m["height"] and t["x"] < c["x"]
                assert d["y"] >= max(t["y"] + t["height"], c["y"] + c["height"]) - 1
            elif w == 768:
                assert c["y"] < t["y"] < d["y"]
            else:
                assert m["y"] < e["y"] <= c["y"] < t["y"] < d["y"]
            if w == 1280:
                data = dashboard(month)
                alt = fig.evaluate(CHART_TEXT)
                assert f"Billed {dollars(data['billed_cents'])}, collected {dollars(data['collected_cents'])} in {month}." in alt, alt
                click(page.get_by_role("button", name="Export CSV"))
                see(page, has_text(notices(page), "Export ready."), seconds=60)
                link = page.get_by_role("link", name="Download export")
                expect(link).to_be_visible()
                assert same_origin(link.evaluate("a => a.href"), BASE)


def test_outstanding_alert(mail):
    eventually(lambda: not [i for i in farrier().ok("GET", "/api/invoices") if i["status"] == "pending"],
               HOLD_OFF_S + JOB_SLACK_S * 3, every=1)
    unpaid = sum(i["balance_cents"] for i in farrier().ok("GET", "/api/invoices") if i["status"] == "unpaid")
    threshold = unpaid + 100
    subject = f"Outstanding balance over {dollars(threshold)}"
    (o,) = new_owners(1, horses=3)
    day = new_day(days=0, slots=3)
    b1, b2, b3 = confirmed(o, day, horse=0), confirmed(o, day, horse=1), confirmed(o, day, horse=2)
    start_day(day)
    v1, v2, v3 = visit_for(b1), visit_for(b2), visit_for(b3)
    with app_copy({"ALERT_OUTSTANDING_CENTS": str(threshold), "INSTANCE_LABEL": "alert-probe"}) as cp:
        inv1 = close_visit(v1["id"], ["trim", "full_new"], base=cp.url).json()["invoice"]
        assert len(inbox(mail, FARRIER, subject)) == 1
        inv3 = close_visit(v3["id"], ["trim"], base=cp.url).json()["invoice"]
        assert len(inbox(mail, FARRIER, subject)) == 1
        assert o.call("POST", f"/api/invoices/{inv3['id']}/payments", {"card_token": APPROVE},
                      key=idempotency_key(), base=cp.url).status_code == 201
        assert o.call("POST", f"/api/invoices/{inv1['id']}/payments", {"card_token": APPROVE},
                      key=idempotency_key(), base=cp.url).status_code == 201
        close_visit(v2["id"], ["trim", "full_new"], base=cp.url)
        assert len(inbox(mail, FARRIER, subject, expect=2)) == 2


def test_wf_api_tokens_scopes():
    f = farrier()
    ro = f.ok("POST", "/api/tokens", {"name": f"ro {uuid.uuid4().hex[:6]}", "scope": "read_only"}, 201)
    bi = f.ok("POST", "/api/tokens", {"name": f"bi {uuid.uuid4().hex[:6]}", "scope": "billing"}, 201)
    for t in (ro, bi):
        assert re.fullmatch(r"cl_[A-Za-z0-9_-]{43,}", t["token"])
    listing = f.call("GET", "/api/tokens")
    assert all("token" not in x for x in listing.json()) and ro["token"] not in listing.text
    assert pg_contains(ro["token"]) == [] and pg_contains(bi["token"]) == []
    rw, bw = Who(bearer=ro["token"]), Who(bearer=bi["token"])
    assert rw.get("/api/horses").status_code == 200
    for method, path in [("GET", "/api/invoices"), ("GET", "/api/tokens"), ("GET", "/api/audit"), ("POST", "/api/barn-days")]:
        err(rw.call(method, path, {} if method == "POST" else None), 403, "insufficient_scope")
    assert Stream(f"{BASE}/api/barn-days/{new_day(days=4)['id']}/events", bearer=ro["token"]).status in (401, 403)
    assert bw.get("/api/invoices").status_code == 200 and bw.get("/api/payments").status_code == 200
    err(bw.call("POST", "/api/barn-days", {}), 403, "insufficient_scope")
    (o,) = new_owners(1)
    b = confirmed(o, new_day(days=4, slots=1))
    r = bw.ok("POST", f"/api/payments/{b['payment_id']}/refund", {"amount_cents": 1}, key=idempotency_key())
    assert r["status"] == "partially_refunded"
    audit = f.ok("GET", f"/api/audit?entity_type=payment&entity_id={b['payment_id']}")
    assert {"type": "token", "id": bi["id"]} in [a["actor"] for a in audit]
    assert f.call("POST", "/api/tokens", {"name": "x" * (NAME_MAX + 1), "scope": "read_only"}).status_code == 422
    assert f.call("DELETE", f"/api/tokens/{ro['id']}").status_code == 204
    for base in (BASE, inst(PEER)):
        err(rw.call("GET", "/api/horses", base=base), 401, "unauthenticated")


def test_wf_api_tokens_ui(browser):
    name = f"ui {uuid.uuid4().hex[:8]}"
    with ui(browser, FARRIER, "/prices") as page:
        see(page, visible(page.get_by_role("button", name="New API token")))
        click(page.get_by_role("button", name="New API token"))
        dlg = page.get_by_role("dialog", name="New API token")
        fill(dlg.get_by_role("textbox", name="Name"), name)
        select(dlg.get_by_role("combobox", name="Scope"), "Read only")
        click(dlg.get_by_role("button", name="Create token"))
        see(page, has_text(dlg, "Copy this token now. It won't be shown again."))
        token = re.search(r"cl_[A-Za-z0-9_-]{43,}", dlg.inner_text()).group(0)
        assert Who(bearer=token).get("/api/horses").status_code == 200
        page.keyboard.press("Escape")
        revoke = page.get_by_role("button", name=f"Revoke token {name}")
        see(page, visible(revoke))
        click(revoke)
        see(page, has_text(notices(page), "Token revoked."))
    err(Who(bearer=token).get("/api/horses"), 401, "unauthenticated")


def test_wf_ops_lifecycle_readiness():
    for var in (None, KB_DOWN, MAIL_DOWN):
        base = inst(var) if var else BASE
        for path in ("/api/health", "/healthz"):
            r = httpx.get(base + path, timeout=TIMEOUT)
            assert r.status_code == 200 and r.json() == {"status": "ok"}
    r = httpx.get(BASE + "/readyz", timeout=TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ready", "dependencies": {d: "up" for d in READY_DEPS}}
    for var, name in ((KB_DOWN, "killbill"), (MAIL_DOWN, "mailpit")):
        t0 = time.monotonic()
        r = httpx.get(inst(var) + "/readyz", timeout=TIMEOUT)
        assert time.monotonic() - t0 < len(READY_DEPS) * READY_TIMEOUT_MS / 1000
        body = r.json()
        assert r.status_code == 503 and body["status"] == "not_ready" and body["down"] == [name]
        assert body["dependencies"][name] == "down"


@contextlib.contextmanager
def app_copies(*envs):
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    copies = []
    try:
        for env in envs:
            port = free_port()
            log = tempfile.NamedTemporaryFile("wb", suffix=".log", delete=False)
            proc = subprocess.Popen(["sh", "-c", "exec " + serve], cwd=str(DEPLOYED_APP),
                                    env={**os.environ, "APP_PUBLIC_PORT": str(port), **env},
                                    stdout=log, stderr=subprocess.STDOUT)
            copies.append((Copy(proc, f"http://127.0.0.1:{port}", log.name), log))
        for cp, _ in copies:
            def up(cp=cp):
                if cp.proc.poll() is not None:
                    raise RuntimeError(f"copy exited {cp.proc.returncode}: {cp.tail()}")
                return httpx.get(cp.url + "/api/health", timeout=2).status_code == 200
            eventually(up, BOOT_S, every=0.5, what="copy boot")
        yield [cp for cp, _ in copies]
    finally:
        for cp, log in copies:
            if cp.proc.poll() is None:
                cp.proc.kill()
                cp.proc.wait(timeout=TIMEOUT)
            log.close()


def test_wf_ops_lifecycle_migrations():
    label = f"boot-{uuid.uuid4().hex[:6]}"
    with app_copies({"INSTANCE_LABEL": label}, {"INSTANCE_LABEL": label + "-b"}) as (one, two):
        pg = Postgres()
        assert pg.rows("select version, count(*) as n from schema_migrations group by version having count(*) > 1") == []
        assert int(pg.rows("select count(*) as n from schema_migrations")[0]["n"]) >= 1
        for cp in (one, two):
            names = [b["name"] for b in farrier().ok("GET", "/api/barns", base=cp.url)]
            assert names.count(CEDAR) == 1 and names.count(LARK) == 1
        assert [h["owner"]["email"] for h in farrier().ok("GET", "/api/horses") if h["name"] == "Juniper"] == [ADA]
        assert len([p for p in farrier().ok("GET", "/api/price-lists") if p["effective_from"] == "2026-01-01"]) == 1


def test_structured_logs():
    label = f"logs-{uuid.uuid4().hex[:6]}"
    with app_copy({"INSTANCE_LABEL": label}) as cp:
        rid = f"probe-{uuid.uuid4().hex[:16]}"
        r = farrier().call("GET", "/api/practice", base=cp.url, headers={"X-Request-Id": rid})
        assert r.headers["X-Request-Id"] == rid
        r = farrier().call("GET", "/api/practice", base=cp.url, headers={"X-Request-Id": "bad id!"})
        assert re.fullmatch(r"[0-9a-fA-F-]{36}", r.headers["X-Request-Id"])
        (o,) = new_owners(1)
        fresh = sign_in(o.email, base=cp.url)
        hold(o, new_day(days=4, slots=1), base=cp.url)
        vet_tok = f"probevet{uuid.uuid4().hex}"
        httpx.get(f"{cp.url}/api/vet/{vet_tok}", timeout=TIMEOUT)
        bearer = f"cl_{uuid.uuid4().hex}{uuid.uuid4().hex}"
        Who(bearer=bearer).call("GET", "/api/horses", base=cp.url)
        cp.proc.send_signal(signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            cp.proc.wait(timeout=SHUTDOWN_GRACE_S + STREAM_SLACK_S)
        lines = cp.lines()
        mine = [x for x in lines if x.get("request_id") == rid]
        assert mine, cp.tail()
        for k in ("ts", "level", "msg", "request_id", "instance", "method", "path", "status", "duration_ms"):
            assert k in mine[0]
        assert (mine[0]["instance"], mine[0]["method"], mine[0]["status"]) == (label, "GET", 200)
        raw = Path(cp.log).read_text(errors="replace")
        assert any(x.get("path", "").endswith("/api/vet/[token]") for x in lines)
        for secret in (PASSWORD, vet_tok, bearer, APPROVE, cookie_of(fresh).split("=", 1)[-1]):
            assert secret not in raw


def test_wf_ops_lifecycle_shutdown():
    with app_copy({"INSTANCE_LABEL": f"term-{uuid.uuid4().hex[:6]}"}) as cp:
        stream = Stream(f"{cp.url}/api/barn-days/{new_day(days=4)['id']}/events", farrier().cookie).ready()
        cp.proc.send_signal(signal.SIGTERM)
        with contextlib.suppress(httpx.TransportError):
            ready = httpx.get(cp.url + "/readyz", timeout=TIMEOUT)
            assert ready.status_code == 503 and ready.json().get("draining") is True
        with contextlib.suppress(httpx.TransportError):
            late = httpx.get(cp.url + "/api/practice", timeout=TIMEOUT)
            assert late.status_code == 503 and late.json() == {"error": "shutting_down"}
        assert stream.ended.wait(SHUTDOWN_GRACE_S)
        assert cp.proc.wait(timeout=SHUTDOWN_GRACE_S + STREAM_SLACK_S) == 0, cp.tail()
        stream.close()


def test_wf_ops_lifecycle_audit():
    f = farrier()
    me = f.ok("GET", "/api/me")
    rid_pub, rid_cancel = f"pub-{uuid.uuid4().hex[:12]}", f"cancel-{uuid.uuid4().hex[:12]}"
    day = new_day(days=4, slots=1, publish=False)
    f.ok("POST", f"/api/barn-days/{day['id']}/publish", headers={"X-Request-Id": rid_pub})
    (o,) = new_owners(1)
    b = confirmed(o, day)
    f.ok("POST", f"/api/barn-days/{day['id']}/cancel", headers={"X-Request-Id": rid_cancel})
    log = f.ok("GET", f"/api/audit?entity_type=barn_day&entity_id={day['id']}")
    pub = [a for a in log if (a["from"], a["to"]) == ("draft", "published")]
    can = [a for a in log if a["to"] == "cancelled"]
    assert len(pub) == 1 and len(can) == 1
    assert pub[0]["request_id"] == rid_pub and can[0]["request_id"] == rid_cancel
    assert pub[0]["actor"] == {"type": "user", "id": me["id"]}
    assert log == sorted(log, key=lambda a: a["at"], reverse=True)
    blog = f.ok("GET", f"/api/audit?entity_type=booking&entity_id={b['id']}")
    assert len([a for a in blog if (a["from"], a["to"]) == ("held", "confirmed")]) == 1
    defs = " ".join(r["def"] for r in Postgres().rows(
        "select pg_get_triggerdef(t.oid) as def from pg_trigger t where t.tgrelid = 'audit_log'::regclass and not t.tgisinternal"))
    assert "UPDATE" in defs and "DELETE" in defs


def test_wf_live_motion_choreography(browser):
    owners = new_owners(3)
    day = new_day(days=rand_days(), start="07:30", slots=3)
    for o in owners:
        confirmed(o, day)
    with ui(browser, FARRIER, f"/days/{day['id']}", init=True) as page:
        see(page, has_text(page.get_by_role("table", name="Day sheet"), owners[2].horses[0]["name"]))
        def staggered():
            rows = [a for a in page.evaluate("window.__anims") if "row" in a["roles"] and a["row"] >= 0
                    and a["section"] != "THEAD" and not a["infinite"]]
            starts = {}
            for a in rows:
                key = (a["section"], a["row"])
                starts[key] = min(starts.get(key, a["start"]), a["start"])
            seq = [starts[k] for k in sorted(starts)][:6]
            return seq if len(seq) >= 3 else None
        def stagger_from_styles():
            table = page.get_by_role("table", name="Day sheet")
            first = table.evaluate(ROW_STYLES)
            begun = [None] * len(first)
            for step in range(1, 125):
                advance(page, 16)
                for i, (a, b) in enumerate(zip(first, table.evaluate(ROW_STYLES))):
                    if begun[i] is None and a != b:
                        begun[i] = step * 16
            seq = [t for t in begun if t is not None]
            return seq if len(seq) >= 3 else None
        try:
            seq = eventually(staggered, 3)
        except AssertionError:
            seq = stagger_from_styles()
        assert seq, "no row stagger seen"
        assert all(0 < b - a <= QUARTER_S_MS for a, b in zip(seq, seq[1:])), seq
        page.evaluate("window.__anims = []")
        click(page.get_by_role("button", name="New barn day"))
        dlg = page.get_by_role("dialog", name="New barn day")

        def focus_in_dialog():
            assert dlg.evaluate("d => d.contains(document.activeElement)")
        see(page, focus_in_dialog, step_ms=16)
        page.keyboard.press("Tab")
        assert dlg.evaluate("d => d.contains(document.activeElement)")
        opened = [a for a in page.evaluate("window.__anims") if "dialog" in a["roles"]]
        if opened:
            assert all(0 < a["duration"] + a["delay"] <= DIALOG_MAX_MS for a in opened)
        else:
            frames, last, settled = set(), None, 0
            for step in range(1, 63):
                advance(page, 16)
                now = dlg.evaluate(DIALOG_STYLE)
                frames.add(now)
                if now != last:
                    last, settled = now, step * 16
            assert len(frames) > 1 and settled <= DIALOG_MAX_MS, (len(frames), settled)
        page.evaluate("window.__anims = []")
        page.keyboard.press("Escape")
        closing = [a for a in page.evaluate("window.__anims") if "dialog" in a["roles"]]
        assert all(a["duration"] + a["delay"] <= DIALOG_MAX_MS for a in closing)
    with ui(browser, ADA, f"/horses/{juniper_id()}?hoof=LF", init=True) as page:
        slider = page.get_by_role("slider", name="Comparison divider")
        see(page, visible(slider))
        tab_to(page, slider)
        page.evaluate("window.__anims = []")
        page.keyboard.press("ArrowRight")
        divider_is(slider, "51")
        steps = page.evaluate("window.__anims")
        assert all(a["duration"] + a["delay"] <= UNDER_HALF_S_MS for a in steps if not a["infinite"])


def test_wf_live_motion_gradients(browser):
    def gradient_near(loc):
        return loc.evaluate("""el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement)
            if (getComputedStyle(n).backgroundImage.includes('gradient')) return true;
            return [...el.querySelectorAll('*')].some(n => getComputedStyle(n).backgroundImage.includes('gradient')); }""")

    with open_app(browser, BASE + "/sign-in") as page:
        btn = page.get_by_role("button", name="Sign in")
        see(page, visible(btn))
        assert "gradient" in style(btn, "background-image")["background-image"]
    with ui(browser, FARRIER, "/") as page:
        rail = page.get_by_role("navigation", name="Barn days")
        see(page, visible(rail))
        assert gradient_near(rail)
    with ui(browser, ADA, f"/horses/{juniper_id()}?hoof=LF", reduced_motion="reduce") as page:
        stage = page.get_by_role("region", name="Hoof comparison")
        see(page, visible(stage))
        assert gradient_near(stage)
        assert page.evaluate("document.getAnimations().filter(a => a.effect.getComputedTiming().iterations === Infinity).length") == 0


def test_wf_live_motion_sequences(browser):
    (o,) = new_owners(1)
    day = new_day(days=rand_days(), start="07:30", slots=1)
    h = o.horses[0]["name"]
    copy = f"Booked {h} for 07:30 on {day['business_date']}. A confirmation email is on its way."
    with ui(browser, o.email, f"/days/{day['id']}", init=True) as page:
        book = page.get_by_role("button", name=book_label("07:30"))
        see(page, visible(book))
        notices(page).evaluate(WATCH_NOTICES)
        click(book)
        dlg = page.get_by_role("dialog", name="Confirm booking")
        see(page, visible(dlg))
        click(dlg.get_by_role("button", name="Confirm booking"))
        see(page, has_text(notices(page), copy))
        assert "slot-won" in [x["name"] for x in page.evaluate("window.__dataAnim")]
        assert any(t.evaluate("""el => { for (let n = el; n && n.getAttribute; n = n.parentElement)
            if (n.getAttribute('aria-hidden') === 'true') return true; return false; }""") for t in page.get_by_text(copy).all())
        expect(page.get_by_role("button", name="Dismiss notice")).to_be_visible()
        advance(page, TOAST_MS + UNDER_HALF_S_MS)
        see(page, lambda: expect(page.get_by_role("button", name="Dismiss notice")).to_have_count(0, timeout=300))
        assert page.evaluate("window.__dataAnim")[-1]["name"] is None
        assert page.evaluate("window.__notices").count(copy) == 1
    assert my_bookings(o, day)[0]["status"] == "confirmed"


def test_wf_live_motion_parity(browser):
    (o,) = new_owners(1)
    day = new_day(days=rand_days(), start="07:30", slots=1)
    h = o.horses[0]["name"]
    with ui(browser, o.email, f"/days/{day['id']}", reduced_motion="reduce") as page:
        book = page.get_by_role("button", name=book_label("07:30"))
        see(page, visible(book))
        tab_to(page, book)
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Confirm booking")
        see(page, visible(dlg))
        page.keyboard.press("Enter")
        see(page, lambda: expect(page.get_by_role("button", name=f"Cancel booking for {h}")).to_be_focused(timeout=300))
        expect(notices(page)).to_contain_text(f"Booked {h} for 07:30 on {day['business_date']}. A confirmation email is on its way.")
        assert page.evaluate("""() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            for (let n = w.currentNode; n; n = w.nextNode()) if (n.getAttribute && n.getAttribute('data-anim')) return true;
            return false; }""") is False
        dismiss = page.get_by_role("button", name="Dismiss notice")
        if dismiss.count():
            click(dismiss)
            assert "Dismiss notice" not in tab_order(page, 30)
    with ui(browser, FARRIER, "/") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        toggle = page.get_by_role("button", name="Barn days")
        see(page, visible(toggle))
        expect(toggle).to_have_attribute("aria-expanded", "false")
        date_link = re.compile(r"^\d{4}-\d{2}-\d{2} ")
        assert not [n for n in tab_order(page, 15) if n and date_link.match(n)]
        click(toggle)
        expect(toggle).to_have_attribute("aria-expanded", "true")
        see(page, visible(page.get_by_role("navigation", name="Barn days").get_by_role("link").first))
        click(toggle)
        expect(toggle).to_have_attribute("aria-expanded", "false")
        advance(page, UNDER_HALF_S_MS)
        layout(page)
        assert not [n for n in tab_order(page, 15) if n and date_link.match(n)]


def test_wf_cross_cutting_health():
    for var in (None, PEER, KB_DOWN, MAIL_DOWN):
        r = httpx.get((inst(var) if var else BASE) + "/api/health", timeout=TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
    page = httpx.get(BASE + "/", timeout=TIMEOUT)
    assert page.status_code == 200 and page.text.strip()


def raw_get(path):
    u = urlparse(BASE)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=TIMEOUT)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return resp.status, body


def test_wf_cross_cutting_boundary():
    r = farrier().call("POST", "/api/price-lists", {}, headers={"Origin": "http://evil.example"})
    err(r, 403, "cross_origin")

    def pad(n):
        return b'{"pad":"' + b"a" * (n - 10) + b'"}'

    assert len(pad(JSON_LIMIT)) == JSON_LIMIT
    exact = httpx.post(BASE + "/api/barn-days", content=pad(JSON_LIMIT), headers={"Content-Type": "application/json"}, timeout=TIMEOUT)
    assert exact.status_code == 401
    err(httpx.post(BASE + "/api/barn-days", content=pad(JSON_LIMIT + 1), headers={"Content-Type": "application/json"},
                   timeout=TIMEOUT), 413, "payload_too_large")
    err(httpx.post(BASE + "/api/session", content=b"email=x", headers={"Content-Type": "text/plain"}, timeout=TIMEOUT),
        415, "unsupported_media_type")
    for path in ("/package.json", "/run.json", "/package-lock.json", "/.env", "/assets/../package.json", "/..%2fpackage.json"):
        status, body = raw_get(path)
        assert status == 404 and b'"dependencies"' not in body, path
    html = httpx.get(BASE + "/", timeout=TIMEOUT).text
    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET")
               if len(os.environ.get(k, "")) >= 12]
    for asset in set(re.findall(r'(?:src|href)="(/[^"]+)"', html)):
        content = httpx.get(BASE + asset, timeout=TIMEOUT).text
        for s in secrets:
            assert s not in content and s not in html


def test_wf_cross_cutting_outages(mail):
    for var in (KB_DOWN, MAIL_DOWN):
        assert farrier().call("GET", "/api/practice", base=inst(var)).status_code == 200
    (o,) = new_owners(1)
    day = new_day(days=4, slots=1)
    r = hold(o, day, base=inst(MAIL_DOWN))
    assert r.status_code == 201
    c = o.call("POST", f"/api/bookings/{r.json()['id']}/confirm", {}, base=inst(MAIL_DOWN))
    t0 = time.monotonic()
    assert c.status_code == 200 and c.json()["status"] == "confirmed"
    subject = f"Booked: {o.horses[0]['name']} at {CEDAR} on {day['business_date']}"

    def nothing_yet():
        assert inbox(mail, o.email, subject, expect=0) == [], "sent during hold-off"

    during(MAIL_HOLD_OFF_S - 2, nothing_yet, every=4)
    msgs = inbox(mail, o.email, subject, seconds=MAIL_DELIVERY_S - (time.monotonic() - t0))
    assert len(msgs) == 1


def test_wf_cross_cutting_responsive(browser):
    (o,) = new_owners(1)
    day = new_day(days=rand_days(), start="07:30", slots=2)
    confirmed(o, day)
    hid = o.horses[0]["id"]
    screens = [(FARRIER, ["/", f"/days/{day['id']}", "/horses", f"/horses/{hid}?hoof=LF", "/invoices", "/prices", "/dashboard"]),
               (o.email, [f"/days/{day['id']}", "/invoices", f"/horses/{hid}?hoof=LF"])]
    for w, h in VIEWPORTS:
        for email, paths in screens:
            with ui(browser, email, paths[0]) as page:
                page.set_viewport_size({"width": w, "height": h})
                for path in paths:
                    page.goto(BASE + path)
                    see(page, visible(page.get_by_role("button", name="Sign out")))
                    advance(page, 1000)
                    layout(page)
                    big_enough(page)
                    if w == VIEWPORTS[0][0]:
                        expect(page.get_by_role("button", name="Barn days")).to_be_visible()


def test_if_run_manifest():
    data = json.loads(Path("/app/run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in data.values())


def test_if_third_party_notices():
    notices_text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted(f"{p.name}@{p.version}" for p in shipped_packages()
                     if p.name not in notices_text or p.version not in notices_text)
    assert missing == []


def test_if_licences():
    bad = []
    for p in shipped_packages():
        options = [o.strip() for o in p.licence.replace("(", "").replace(")", "").split(" OR ")]
        if not any(all(x.strip() in ALLOWED_LICENCES for x in o.split(" AND ")) for o in options):
            bad.append((p.name, p.version, p.licence))
    assert bad == []


def test_if_storage_only_postgres_minio():
    pkg = json.loads(Path("/app/package.json").read_text())
    names = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    banned = [b.lower() for b in ("SQLite", "Redis")]
    assert [n for n in names if any(b in n.lower() for b in banned)] == []


def test_if_service_config_unchanged():
    files = [p for p in Path("/app").rglob("*compose*") if p.is_file() and "node_modules" not in p.parts]
    if not Path("/app/.git").exists():
        return
    for p in files:
        rel = str(p.relative_to("/app"))
        dirty = subprocess.run(["git", "-C", "/app", "status", "--porcelain", "--", rel], capture_output=True, text=True).stdout
        commits = subprocess.run(["git", "-C", "/app", "log", "--format=%H", "--", rel], capture_output=True, text=True).stdout.split()
        assert dirty == "" and len(commits) <= 1, rel


def test_if_package_lock():
    pkg = json.loads(Path("/app/package.json").read_text())
    lock = json.loads(Path("/app/package-lock.json").read_text())
    root = lock["packages"][""]
    assert root.get("dependencies", {}) == pkg.get("dependencies", {})
    assert root.get("devDependencies", {}) == pkg.get("devDependencies", {})
    if Path("/app/.git").exists():
        assert subprocess.run(["git", "-C", "/app", "ls-files", "--error-unmatch", "package-lock.json"],
                              capture_output=True).returncode == 0


def test_if_no_third_party_assets(browser):
    seen: list[str] = []
    for email, path in [(None, "/sign-in"), (FARRIER, "/"), (FARRIER, "/dashboard"), (ADA, f"/horses/{juniper_id()}?hoof=LF")]:
        with ui(browser, email, path) as page:
            page.on("request", lambda req: seen.append(req.url))
            page.reload()
            advance(page, 2000)
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, BASE)]
    assert foreign == []


import math
import random
import shlex
from contextlib import contextmanager
from types import SimpleNamespace as NS
from zoneinfo import ZoneInfo
from PIL import Image


"""Verifier for Rasp & Rein Clinchline (black-box: HTTP, browser, provider observers)."""


PW = "hoofcare-2026"


r3_FARRIER = "farrier@clinchline.test"


r3_APPRENTICE = "apprentice@clinchline.test"


CEDAR_MGR = "manager.cedar@clinchline.test"


LARK_MGR = "manager.larkspur@clinchline.test"


r3_ADA = "owner.ada@clinchline.test"


BRAM = "owner.bram@clinchline.test"


r3_CEDAR = "Cedar Hollow Stables"


r3_LARK = "Larkspur Farm"


r3_APPROVE, DECLINE, FUNDS = "tok_approve_4242", "tok_decline_0002", "tok_funds_9995"


CARD_OK = "Test card 4242 (approves)"


CARD_FUNDS = "Test card 9995 (insufficient funds)"


HEADER = "owner_name,owner_email,owner_phone,horse_name,barn_name,stall,cycle_weeks"


FARRIER_KEYS = {"booking_id", "number", "slot_time", "horse_id", "horse_name", "stall", "status", "owner_name",
                "owner_email", "owner_phone", "trip_share_cents", "visit_id", "visit_status", "invoice_status",
                "invoice_total_cents"}


APPRENTICE_KEYS = {"booking_id", "slot_time", "horse_id", "horse_name", "stall", "status", "visit_id", "visit_status"}


MANAGER_KEYS = {"slot_time", "horse_name", "stall"}


DEPOSIT = 2500


TRIM = 5500


FRONT_RESET = 12000


CEDAR_FEE = 4500


r3_HOLD_FAST_S = 15


OFFER_FAST_S = 6


HOLDOFF_S = 20


DELIVER_S = 45


STREAM_S = 2


r3_HEARTBEAT_S = 15


VET_TTL_S = 20


MISS_LIMIT = 10


MISS_WINDOW_S = 60


PHOTO_MAX = 8_000_000


r3_QUOTA = 48_000_000


CHUNK = 1_000_000


JSON_MAX = 65_536


GRACE_S = 10


r3_THUMB_W = 320


CLOSE_CHUNKS_S = 10


DELETE_GONE_S = 10


r3_REFRESH_MS = 10_000


GLIDE_MS = 440


r3_UNDER_HALF_S_MS = 500


DIALOG_MS = 320


SETTLE_MS = 240


r3_CHIP_LOOP_MS = 2400


r3_TAP_PX = 44


READY_CHECK_MS = 2000


r3_SIGN_IN_CAP = 10


r3_PAYMENT_CAP = 20


CYCLE_DAYS = 42


HTTP_TIMEOUT = 30


r3_BOOT_S = 180


WAIT_S = 60


r3_POLL_S = 0.25


SKEW_S = 1


r3_VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}


ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0",
           "Unlicense", "OFL-1.1", "LGPL-3.0-only", "LGPL-3.0-or-later"}


BASE = ""


r3_PEER = os.environ.get("APP_PEER_URL", "").rstrip("/")


r3_KB_DOWN = os.environ.get("APP_KILLBILL_DOWN_URL", "").rstrip("/")


r3_MAIL_DOWN = os.environ.get("APP_MAILPIT_DOWN_URL", "").rstrip("/")


r3_FAST = os.environ.get("APP_FAST_CLOCK_URL", "").rstrip("/")


def wait(fn, seconds=WAIT_S, msg="condition"):
    end = time.monotonic() + seconds
    while True:
        v = fn()
        if v:
            return v
        assert time.monotonic() < end, f"timed out waiting for {msg}"
        threading.Event().wait(r3_POLL_S)


def r3_during(seconds, fn):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        fn()
        threading.Event().wait(r3_POLL_S)


def ok(r, code=200):
    assert r.status_code == code, (r.request.method, r.request.url, r.status_code, r.text[:500])
    return r.json() if r.content else None


def r3_err(r, code, error):
    assert r.status_code == code, (r.request.url, r.status_code, r.text[:500])
    assert r.json()["error"] == error, r.text
    return r.json()


class Api:
    def __init__(self, base, email=None, password=PW, cookies=None, token=None):
        self.base = base.rstrip("/")
        hdr = {"Authorization": f"Bearer {token}"} if token else {}
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, cookies=cookies, headers=hdr)
        self.user = None
        if email:
            r = self.c.post("/api/session", json={"email": email, "password": password})
            assert r.status_code == 200, r.text
            self.user = r.json()["user"]

    def cookies(self):
        return {c.name: c.value for c in self.c.cookies.jar}

    def on(self, base):
        a = Api(base, cookies=self.cookies())
        a.user = self.user
        return a

    def req(self, method, path, body=None, key=None, raw=None, ctype=None, hdr=None):
        h = dict(hdr or {})
        if key:
            h["Idempotency-Key"] = key
        if raw is not None:
            h["Content-Type"] = ctype
            return self.c.request(method, path, content=raw, headers=h)
        if method in ("GET", "DELETE") and body is None:
            return self.c.request(method, path, headers=h)
        return self.c.request(method, path, json={} if body is None else body, headers=h)

    def get(self, p, **kw):
        return self.req("GET", p, **kw)

    def post(self, p, body=None, key=None, **kw):
        return self.req("POST", p, body, key, **kw)

    def put(self, p, body=None, **kw):
        return self.req("PUT", p, body, **kw)

    def patch(self, p, body=None, **kw):
        return self.req("PATCH", p, body, **kw)

    def delete(self, p, **kw):
        return self.req("DELETE", p, **kw)


_SESS = {}


def as_(email, base=None):
    if email not in _SESS:
        _SESS[email] = Api(BASE, email)
    return _SESS[email] if base is None else _SESS[email].on(base)


def r3_farrier(base=None):
    return as_(r3_FARRIER, base)


def practice():
    return ok(r3_farrier().get("/api/practice"))


def r3_today():
    return dt.date.fromisoformat(practice()["today"])


def barn(name):
    return next(b for b in ok(r3_farrier().get("/api/barns")) if b["name"] == name)


def usd(c):
    return f"${c / 100:,.2f}"


def csv_text(rows, header=HEADER, nl="\n", bom=False):
    def cell(v):
        v = str(v)
        return '"' + v.replace('"', '""') + '"' if any(ch in v for ch in ',"\n') else v
    body = nl.join([header] + [",".join(cell(v) for v in r) for r in rows]) + nl
    return (("\ufeff" if bom else "") + body).encode()


def r3_import_csv(rows=None, raw=None, key=None, base=None):
    return r3_farrier(base).post("/api/imports", key=key or idempotency_key(),
                              raw=raw if raw is not None else csv_text(rows), ctype="text/csv")


def owner_rows(n, horses=1, barn_name=r3_CEDAR, cycle="6", name="Owner"):
    t = uuid.uuid4().hex[:8]
    return [(f"{name} {t}{i}", f"o{t}{i}@clinch.example", "+1 303 555 0100", f"H{t}{i}{j}", barn_name,
             f"{t}{i}{j}", cycle) for i in range(n) for j in range(horses)]


def owners(n=1, horses=1, name="Owner", barn_name=r3_CEDAR):
    rows = owner_rows(n, horses, barn_name, name=name)
    ok(r3_import_csv(rows), 201)
    out = []
    for em in dict.fromkeys(r[1] for r in rows):
        a = Api(BASE, em, PW)
        hs = sorted(ok(a.get("/api/horses")), key=lambda h: h["name"])
        out.append(NS(api=a, email=em, name=next(r[0] for r in rows if r[1] == em), horses=hs, horse=hs[0],
                      rows=[r for r in rows if r[1] == em]))
    return out


def day(date=None, start="23:59", slots=2, minutes=45, fee=None, barn_name=r3_CEDAR, publish=True):
    date = date or r3_today() + dt.timedelta(days=random.randint(400, 3000))
    body = {"barn_id": barn(barn_name)["id"], "business_date": str(date), "start_time": start,
            "slot_count": slots, "slot_minutes": minutes}
    if fee is not None:
        body["trip_fee_cents"] = fee
    bd = ok(r3_farrier().post("/api/barn-days", body), 201)
    if publish:
        bd = ok(r3_farrier().post(f"/api/barn-days/{bd['id']}/publish"))
    return bd


def r3_get_day(bd, api=None):
    return ok((api or r3_farrier()).get(f"/api/barn-days/{bd['id']}"))


def r3_hold(o, bd, slot, horse=None, card=r3_APPROVE, base=None):
    a = o.api if base is None else o.api.on(base)
    return a.post(f"/api/barn-days/{bd['id']}/bookings",
                  {"slot_id": slot["id"], "horse_id": (horse or o.horse)["id"], "card_token": card})


def book(o, bd, i, horse=None, base=None):
    b = ok(r3_hold(o, bd, bd["slots"][i], horse=horse, base=base), 201)
    return ok((o.api if base is None else o.api.on(base)).post(f"/api/bookings/{b['id']}/confirm"))


def r3_my_bookings(o, base=None):
    return ok((o.api if base is None else o.api.on(base)).get("/api/my/bookings"))


def r3_payment(api, pid):
    return ok(api.get(f"/api/payments/{pid}"))


def visit(o=None, fee=None, horses=None):
    o = o or owners(1)[0]
    hs = horses or [o.horse]
    bd = day(date=r3_today(), slots=len(hs), fee=fee)
    bs = [book(o, bd, i, horse=h) for i, h in enumerate(hs)]
    ok(r3_farrier().post(f"/api/barn-days/{bd['id']}/start"))
    vs = [ok(r3_farrier().post(f"/api/bookings/{b['id']}/visit"), 201) for b in bs]
    return NS(o=o, bd=bd, b=bs[0], v=vs[0], bs=bs, vs=vs)


def jpeg(w=1200, h=900, color=(150, 110, 70), exif=False, orientation=None, noise=False):
    im = Image.effect_noise((w, h), 80).convert("RGB") if noise else Image.new("RGB", (w, h), color)
    kw = {}
    if exif or orientation:
        e = Image.Exif()
        if orientation:
            e[0x0112] = orientation
        if exif:
            e[0x010F] = "ProbeCam"
            e.get_ifd(0x8825).update({1: "N", 2: (40.0, 1.0, 1.0)})
        kw["exif"] = e.tobytes()
    b = io.BytesIO()
    im.save(b, "JPEG", quality=95, **kw)
    return b.getvalue()


def pad_jpeg(data, size):
    need, segs = size - len(data), b""
    while need > 0:
        t = min(need, 65537)
        if 0 < need - t < 4:
            t = need - 4
        segs += b"\xff\xfe" + (t - 2).to_bytes(2, "big") + b"\x00" * (t - 4)
        need -= t
    return data[:2] + segs + data[2:]


def r3_upload(vid, data, hoof="LF", phase="after", who=None, name="p.jpg", ctype="image/jpeg"):
    return (who or r3_farrier()).c.post(f"/api/visits/{vid}/photos", data={"hoof": hoof, "phase": phase},
                                     files={"file": (name, data, ctype)})


def line(p):
    return dict(zip(("x1", "y1", "x2", "y2"), p))


def put_marks(vid, hoof, version, hw, ps, who=None):
    return (who or r3_farrier()).put(f"/api/visits/{vid}/hooves/{hoof}/marks",
                                  {"version": version, "hoof_wall": line(hw), "pastern": line(ps)})


def close(vid, work=("trim",), key=None, base=None):
    return r3_farrier(base).post(f"/api/visits/{vid}/close", {"work": list(work), "note": ""}, key=key or idempotency_key())


def angle(p):
    x1, y1, x2, y2 = p
    a = math.degrees(math.atan2(abs(y2 - y1), abs(x2 - x1)))
    return math.floor(a * 10 + 0.5) / 10


SEED_LF = [((300, 800, 700, 297), (700, 700, 1100, 107)), ((300, 820, 700, 269), (700, 700, 1100, 129)),
           ((300, 800, 700, 330), (700, 700, 1100, 170))]


def chain(o, days_ahead):
    out = []
    for i, ahead in enumerate(days_ahead):
        bd = day(date=r3_today() + dt.timedelta(days=ahead), slots=1)
        b = book(o, bd, 0)
        with (serve_copy(CLOCK_OFFSET_SECONDS=ahead * 86400) if ahead else contextlib.nullcontext(NS(base=None))) as cp:
            ok(r3_farrier(cp.base).post(f"/api/barn-days/{bd['id']}/start"))
        v = ok(r3_farrier().post(f"/api/bookings/{b['id']}/visit"), 201)
        ok(r3_upload(v["id"], jpeg(color=[(200, 40, 40), (40, 40, 200), (40, 180, 40)][i % 3])), 201)
        ok(put_marks(v["id"], "LF", None, *SEED_LF[i % 3]))
        ok(close(v["id"]))
        out.append(NS(o=o, bd=bd, b=b, v=v))
    return out


def r3_inbox(mail, to, subject, n=1, seconds=WAIT_S):
    def pick(ms):
        return [m for m in ms if to.lower() in [a.lower() for a in addresses(m.get("To"))]
                and m.get("Subject", "").startswith(subject)]
    wait(lambda: len(pick(mail.messages(settle=0))) >= n, seconds, f"mail {subject} to {to}")
    return pick(mail.messages())


def mail_count(mail, to, subject=""):
    return len([m for m in mail.messages() if to.lower() in [a.lower() for a in addresses(m.get("To"))]
                and m.get("Subject", "").startswith(subject)])


def kb_txs(kb, email):
    a = kb.account(email)
    return [t for p in (kb.payments(a["accountId"]) if a else []) for t in p.get("transactions", [])]


def kb_tx(kb, email, key):
    return [t for t in kb_txs(kb, email) if t.get("transactionExternalKey") == key]


def kb_inv(kb, email, inv_id):
    a = kb.account(email)
    return [i for i in (kb.invoices(a["accountId"]) if a else [])
            if any(f"[{inv_id}]" in (it.get("description") or "") for it in i.get("items", []))]


def r3_cents(x):
    return round(float(x) * 100)


def race(fns):
    bar = threading.Barrier(len(fns))

    def run(f):
        bar.wait()
        return f()
    with ThreadPoolExecutor(len(fns)) as ex:
        return list(ex.map(run, fns))


def consistent(bd, api=None):
    d = r3_get_day(bd, api)
    taken = sum(s["state"] == "taken" for s in d["slots"])
    assert d["booked_count"] == taken
    assert (d["status"] == "full") == (taken == d["slot_count"])
    w = ok(r3_farrier().get(f"/api/barn-days/{bd['id']}/waitlist"))
    assert [e["position"] for e in w] == list(range(1, len(w) + 1))
    return d, w


def parse(ts):
    return dt.datetime.fromisoformat(ts)


def now():
    return dt.datetime.now(dt.timezone.utc)


def cutoff_text(ts):
    return f"{parse(ts):%Y-%m-%d %H:%M} ({practice()['time_zone']})"


def r3_notices(p):
    return p.get_by_role("status", name="Notices")


def show(page, api, path):
    page.context.add_cookies([{"name": k, "value": v, "url": api.base} for k, v in api.cookies().items()])
    page.goto(api.base + path)


def slider_value(s):
    return s.evaluate("e => e.getAttribute('aria-valuenow') ?? e.value")


class r3_Stream:
    def __init__(self, api, path, last=None):
        self.events, self.status, self.done = [], None, threading.Event()
        h = {"Accept": "text/event-stream"}
        if last is not None:
            h["Last-Event-ID"] = str(last)
        threading.Thread(target=self._run, args=(api, path, h), daemon=True).start()
        wait(lambda: self.status is not None or self.done.is_set(), HTTP_TIMEOUT, "stream open")

    def _run(self, api, path, h):
        ev = {}
        try:
            with httpx.Client(base_url=api.base, cookies=api.cookies(),
                              timeout=httpx.Timeout(HTTP_TIMEOUT, read=None)) as c, c.stream("GET", path, headers=h) as r:
                self.status = r.status_code
                for ln in r.iter_lines():
                    if ln == "":
                        if "data" in ev:
                            self.events.append(dict(ev, data=json.loads(ev["data"])))
                        ev = {}
                        continue
                    k, _, v = ln.partition(":")
                    if k in ("id", "event", "data"):
                        ev[k] = v[1:] if v.startswith(" ") else v
        except httpx.HTTPError:
            pass
        self.done.set()

    def of(self, name):
        return [e for e in self.events if e.get("event") == name]


def r3_free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@contextmanager
def serve_copy(**env):
    run = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = r3_free_port()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    p = subprocess.Popen(shlex.split(run["serve"]), cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT,
                         env={**os.environ, "APP_PUBLIC_PORT": str(port), **{k: str(v) for k, v in env.items()}},
                         start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    tail = lambda: Path(log.name).read_text()[-3000:]

    def up():
        assert p.poll() is None, tail()
        try:
            return httpx.get(base + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False
    wait(up, r3_BOOT_S, "copy boot")
    try:
        yield NS(base=base, proc=p, log=log.name, tail=tail)
    finally:
        if p.poll() is None:
            os.killpg(p.pid, signal.SIGKILL)
            p.wait()


def scan_tables(needle):
    pg = Postgres()
    hits = []
    for t in pg.tables():
        n = pg.rows(f"select count(*) as n from \"{t}\" x where x::text like '%{needle}%'")[0]["n"]
        if n:
            hits.append(t)
    return hits


def assert_none(mail, to, subj):
    assert mail_count(mail, to, subj) == 0


def dst_days(tz):
    z, d = ZoneInfo(tz), r3_today()
    spring = fall = None
    for i in range(1, 400):
        x = d + dt.timedelta(days=i)
        a = dt.datetime.combine(x, dt.time(0), z).utcoffset()
        b = dt.datetime.combine(x, dt.time(23), z).utcoffset()
        spring = spring or (x if b > a else None)
        fall = fall or (x if b < a else None)
    return spring, fall


def gap_time(x, z):
    for hh in range(24):
        t = dt.datetime.combine(x, dt.time(hh, 30), z)
        if t.astimezone(dt.timezone.utc).astimezone(z).replace(tzinfo=None) != t.replace(tzinfo=None):
            return f"{hh:02}:30"


def fold_time(x, z):
    for hh in range(24):
        t = dt.datetime.combine(x, dt.time(hh, 30), z)
        if t.utcoffset() != t.replace(fold=1).utcoffset():
            return f"{hh:02}:30"


def expected_times(x, hhmm, z):
    t = dt.datetime.combine(x, dt.time.fromisoformat(hhmm), z)
    c = (t.astimezone(dt.timezone.utc) - dt.timedelta(hours=24)).astimezone(z)
    return t.isoformat(), c.isoformat()


def test_wf_last_slot_race_claims(page, mail, killbill):
    first, *racers = owners(6)
    bd = day(slots=2)
    book(first, bd, 0)
    rs = race([lambda o=o, b=b: r3_hold(o, bd, bd["slots"][1], base=b) for o, b in zip(racers, [BASE, r3_PEER] * 3)])
    wins = [i for i, r in enumerate(rs) if r.status_code == 201]
    assert len(wins) == 1
    winner, losers = racers[wins[0]], [o for i, o in enumerate(racers) if i != wins[0]]
    for i, r in enumerate(rs):
        if i != wins[0]:
            assert r.status_code == 409 and r.json() == {"error": "day_full"}
    d, _ = consistent(bd)
    assert d["status"] == "full" and d["booked_count"] == 2
    wb = ok(winner.api.post(f"/api/bookings/{rs[wins[0]].json()['id']}/confirm"))
    r3_inbox(mail, winner.email, "Booked:")
    for o in losers:
        assert ok(o.api.get("/api/payments")) == [] and r3_my_bookings(o) == []
        assert mail_count(mail, o.email) == 0
        acc = killbill.account(o.email)
        assert acc is None or killbill.payments(acc["accountId"]) == []
    probe = ok(r3_hold(losers[0], (bdx := day(slots=1)), bdx["slots"][0]), 201)
    assert probe["number"] == wb["number"] + 1
    assert losers[0].api.delete(f"/api/bookings/{probe['id']}").status_code == 204
    js = race([lambda o=o, b=b: o.api.on(b).post(f"/api/barn-days/{bd['id']}/waitlist",
                                                 {"horse_id": o.horse["id"], "card_token": r3_APPROVE})
               for o, b in zip(losers, [BASE, r3_PEER] * 2)])
    assert sorted(ok(r, 201)["position"] for r in js) == [1, 2, 3, 4]
    _, w = consistent(bd)
    ok(winner.api.post(f"/api/bookings/{wb['id']}/cancel"))
    d, w2 = consistent(bd)
    assert d["status"] == "full" and len(w2) == 3
    nxt = next(o for o in losers if o.horse["id"] == w[0]["horse"]["id"])
    off = next(b for b in r3_my_bookings(nxt) if b["barn_day_id"] == bd["id"])
    assert off["offer"] and off["status"] == "held"
    assert nxt.api.delete(f"/api/bookings/{off['id']}").status_code == 204
    d, w3 = consistent(bd)
    assert len(w3) == 2 and d["status"] == "full"
    show(page, r3_farrier(), f"/days/{bd['id']}")
    expect(page.get_by_role("navigation", name="Barn days").get_by_role(
        "link", name=f"{bd['business_date']} {r3_CEDAR} {d['booked_count']}/2")).to_be_visible()


def test_wf_last_slot_race_cancel_refund(killbill):
    a, w = owners(2)
    bd = day(slots=1)
    b = book(a, bd, 0)
    wait(lambda: kb_tx(killbill, a.email, f"{b['payment_id']}:capture"), DELIVER_S)
    month = practice()["today"][:7]
    before = ok(r3_farrier().get(f"/api/dashboard?month={month}"))
    ok(w.api.post(f"/api/barn-days/{bd['id']}/waitlist", {"horse_id": w.horse["id"], "card_token": r3_APPROVE}), 201)
    r = ok(a.api.post(f"/api/bookings/{b['id']}/cancel"))
    assert (r["booking"]["status"], r["deposit_outcome"], r["refunded_cents"], r["trip_share_applies"]) == (
        "cancelled_in_time", "refund", DEPOSIT, False)
    p = r3_payment(a.api, b["payment_id"])
    assert (p["status"], p["refunded_cents"], p["killbill_status"]) == ("refunded", DEPOSIT, "recorded")
    credits = [t for t in kb_txs(killbill, a.email) if t.get("transactionType") == "CREDIT"]
    assert len(credits) == 1 and r3_cents(credits[0]["amount"]) == DEPOSIT
    off = [x for x in r3_my_bookings(w) if x["barn_day_id"] == bd["id"]]
    assert off and off[0]["status"] == "held" and off[0]["offer"]
    after = ok(r3_farrier().get(f"/api/dashboard?month={month}"))
    assert after["refunded_cents"] - before["refunded_cents"] == DEPOSIT
    assert after["collected_cents"] == before["collected_cents"]


def test_wf_barn_manager_list_stall_stream(page):
    o1, o2 = owners(2)
    bd = day(slots=3)
    p = f"/api/barn-days/{bd['id']}/events"
    sf, sm = r3_Stream(r3_farrier(), p), r3_Stream(as_(CEDAR_MGR, r3_PEER), p)
    app = Api(BASE, r3_APPRENTICE)
    sa = r3_Stream(app, p)
    assert (sf.status, sm.status, sa.status) == (200, 200, 200)
    assert o1.api.get(p).status_code == 403
    book(o1, bd, 0, base=r3_PEER)
    t0 = time.monotonic()
    for s, keys in ((sf, FARRIER_KEYS), (sm, MANAGER_KEYS), (sa, APPRENTICE_KEYS)):
        wait(lambda s=s: s.of("booking_added"), STREAM_S, "booking_added")
        assert set(s.of("booking_added")[0]["data"]) == keys
    assert time.monotonic() - t0 <= STREAM_S
    row = list(o1.rows[0])
    row[5] = row[5] + "x"
    ok(r3_import_csv([row]), 201)
    for s in (sf, sm, sa):
        mv = wait(lambda s=s: s.of("booking_moved"), STREAM_S, "booking_moved")
        assert len(mv) == 1 and mv[0]["data"]["stall"] == row[5]
    ok(r3_import_csv([row]), 201)
    show(page, as_(CEDAR_MGR), f"/days/{bd['id']}")
    tbl = page.get_by_role("table", name="Ready sheet")
    expect(tbl).to_contain_text(row[5])
    book(o2, bd, 1, base=r3_PEER)
    expect(tbl).to_contain_text(o2.horse["name"], timeout=STREAM_S * 1000)
    wait(lambda: len(sf.of("booking_added")) == 2, STREAM_S)
    ids = [int(e["id"]) for e in sf.events]
    assert ids == list(range(ids[0], ids[0] + len(ids)))
    assert len(sm.of("booking_moved")) == 1
    rs = r3_Stream(r3_farrier(r3_PEER), p, last=ids[0] - 1)
    wait(lambda: len(rs.events) >= len(ids), STREAM_S)
    assert [int(e["id"]) for e in rs.events] == ids
    assert app.on(r3_PEER).delete("/api/session").status_code == 204
    assert sa.done.wait(r3_HEARTBEAT_S + STREAM_S), "stream outlived its session"


def test_wf_owner_cancellation_one_instant(page, mail):
    o = owners(1)[0]
    bd = day(date=r3_today(), slots=1)
    b = book(o, bd, 0)
    assert ok(o.api.get(f"/api/bookings/{b['id']}/cancellation-preview"))["late"] is True
    show(page, o.api, f"/days/{bd['id']}")
    page.get_by_role("button", name=f"Cancel booking for {o.horse['name']}").click()
    dlg = page.get_by_role("dialog", name="Cancel booking")
    expect(dlg).to_contain_text(f"The cutoff passed at {cutoff_text(bd['cancellation_cutoff_at'])}. {o.horse['name']} will still carry a trip share. "
                                f"Your {usd(DEPOSIT)} deposit is kept and set against the trip share.")
    dlg.get_by_role("button", name="Confirm cancellation").click()
    expect(r3_notices(page)).to_have_text(f"Booking cancelled. {o.horse['name']} still carries a trip share for this day.")
    p = r3_payment(o.api, b["payment_id"])
    assert (p["status"], p["disposition"]) == ("captured", "forfeited")
    body = text(r3_inbox(mail, o.email, f"Cancelled: {o.horse['name']}")[0])
    assert "A trip share still applies." in body and f"Your {usd(DEPOSIT)} deposit is kept and set against the trip share." in body
    fut = day(slots=1)
    b2 = book(o, fut, 0)
    lead = (parse(fut["cancellation_cutoff_at"]) - now()).total_seconds() + 60
    with serve_copy(CLOCK_OFFSET_SECONDS=int(lead), TZ="Asia/Tokyo") as cp:
        r = ok(o.api.on(cp.base).post(f"/api/bookings/{b2['id']}/cancel"))
    assert r["booking"]["status"] == "cancelled_late" and r["trip_share_applies"] is True
    assert (r["deposit_outcome"], r["refunded_cents"]) == ("keep", 0)
    assert parse(r["decided_at"]) >= parse(fut["cancellation_cutoff_at"])


def test_wf_day_start_allocation_excuse(page, mail, killbill):
    os_ = owners(7)
    bd = day(date=r3_today(), slots=7, fee=CEDAR_FEE)
    bs = [book(o, bd, i) for i, o in enumerate(os_)]
    ok(r3_farrier().post(f"/api/barn-days/{bd['id']}/start"))
    v1 = ok(r3_farrier().post(f"/api/bookings/{bs[0]['id']}/visit"), 201)
    ok(r3_upload(v1["id"], jpeg()), 201)
    ok(close(v1["id"]))
    assert as_(r3_APPRENTICE).post(f"/api/bookings/{bs[1]['id']}/excuse").status_code == 403
    h2 = os_[1].horse["name"]
    show(page, r3_farrier(), f"/days/{bd['id']}")
    opener = page.get_by_role("button", name=f"Excuse {h2}")
    opener.click()
    dlg = page.get_by_role("dialog", name="Excuse horse")
    expect(dlg.get_by_role("button", name="Keep horse")).to_be_focused()
    expect(dlg).to_contain_text(f"Excuse {h2} from this day. Its trip share of $6.43 moves to the horses not yet invoiced. Its {usd(DEPOSIT)} deposit will be refunded.")
    dlg.get_by_role("button", name="Excuse horse").click()
    expect(r3_notices(page)).to_have_text(f"{h2} excused. Trip shares adjusted for 5 horses.")
    expect(page.get_by_role("link", name=h2)).to_be_focused()
    expect(page.get_by_role("table", name="Trip share adjustments")).to_contain_text(f"−{usd(643)}")
    e = r3_err(r3_farrier().post(f"/api/bookings/{bs[1]['id']}/excuse"), 409, "illegal_transition")
    assert (e["from"], e["action"]) == ("excused", "excuse")
    p = r3_payment(os_[1].api, bs[1]["payment_id"])
    assert p["status"] == "refunded"
    assert [t for t in kb_txs(killbill, os_[1].email) if t.get("transactionType") == "CREDIT" and r3_cents(t["amount"]) == DEPOSIT]
    body = text(r3_inbox(mail, os_[1].email, f"Excused: {h2} at {r3_CEDAR} on {bd['business_date']}")[0])
    assert "No trip share applies." in body and f"Your {usd(DEPOSIT)} deposit will be refunded." in body
    other = owners(1)[0]
    fb = book(other, day(slots=1), 0)
    r3_err(r3_farrier().post(f"/api/bookings/{fb['id']}/excuse"), 409, "day_not_in_progress")


def test_wf_day_start_allocation_adjustments():
    os_ = owners(7)
    bd = day(date=r3_today(), slots=7, fee=CEDAR_FEE)
    bs = [book(o, bd, i) for i, o in enumerate(os_)]
    ok(r3_farrier().post(f"/api/barn-days/{bd['id']}/start"))
    v1 = ok(r3_farrier().post(f"/api/bookings/{bs[0]['id']}/visit"), 201)
    ok(r3_upload(v1["id"], jpeg()), 201)
    ok(close(v1["id"]))
    ok(r3_farrier().post(f"/api/bookings/{bs[1]['id']}/excuse"))
    al = ok(r3_farrier().get(f"/api/barn-days/{bd['id']}/allocation"))
    assert [a["delta_cents"] for a in al["adjustments"]] == [-643, 129, 129, 128, 128, 129]
    assert [a["seq"] for a in al["adjustments"]] == [1, 2, 3, 4, 5, 6]
    v3 = ok(r3_farrier().post(f"/api/bookings/{bs[2]['id']}/visit"), 201)
    ok(r3_upload(v3["id"], jpeg()), 201)
    inv3 = ok(close(v3["id"]))["invoice"]
    assert {"description": f"Trip share — {r3_CEDAR} {bd['business_date']}", "amount_cents": 772} in inv3["items"]
    r = ok(r3_farrier().post(f"/api/bookings/{bs[4]['id']}/excuse"))
    al = r["allocation"]
    assert [a["delta_cents"] for a in al["adjustments"][6:]] == [257, -771, 257, 257]
    assert [s["share_cents"] for s in al["shares"]] == [643, 0, 772, 1029, 0, 1028, 1028]
    assert all(s["share_cents"] == s["initial_cents"] + sum(a["delta_cents"] for a in al["adjustments"] if a["booking_id"] == s["booking_id"]) for s in al["shares"])
    assert sum(s["share_cents"] for s in al["shares"]) == CEDAR_FEE


def test_wf_visit_photos_close_ends_sessions(killbill):
    x = visit()
    vid, s3 = x.v["id"], S3()
    data = jpeg(2400, 1800, noise=True)
    assert len(data) > 2 * CHUNK
    up = ok(r3_farrier().post(f"/api/visits/{vid}/uploads", {"hoof": "LF", "phase": "after", "size_bytes": len(data)}), 201)
    assert (up["chunk_bytes"], up["offset"]) == (CHUNK, 0)
    u = f"/api/uploads/{up['id']}"
    send = lambda off, body, base=None: r3_farrier(base).patch(u, raw=body, ctype="application/octet-stream", hdr={"Upload-Offset": str(off)})
    assert "chunk" in r3_err(send(0, data[:10]), 422, "validation")["errors"]
    rs = race([lambda: send(0, data[:CHUNK]), lambda: send(0, data[:CHUNK], r3_PEER)])
    assert sorted(r.status_code for r in rs) == [200, 409]
    assert ok(r3_farrier(r3_PEER).get(u))["offset"] == CHUNK
    assert r3_err(send(0, data[:CHUNK]), 409, "offset_mismatch")["offset"] == CHUNK
    off = CHUNK
    while off + CHUNK < len(data):
        assert ok(send(off, data[off:off + CHUNK], r3_PEER))["offset"] == off + CHUNK
        off += CHUNK
    photo = ok(send(off, data[off:]), 201)
    assert photo["hoof"] == "LF" and photo["width"] == 2400
    wait(lambda: not s3.keys(f"uploads/{up['id']}/"), CLOSE_CHUNKS_S)
    y = visit()
    yv = y.v["id"]
    mk = lambda: r3_farrier().post(f"/api/visits/{yv}/uploads", {"hoof": "RH", "phase": "before", "size_bytes": PHOTO_MAX})
    rs = race([mk] * 7)
    assert sorted(r.status_code for r in rs) == [201] * 6 + [409]
    assert next(r for r in rs if r.status_code == 409).json() == {"error": "visit_quota_exceeded", "remaining_bytes": 0}
    sess = [r.json() for r in rs if r.status_code == 201]
    assert r3_farrier().delete(f"/api/uploads/{sess[0]['id']}").status_code == 204
    ok(r3_upload(yv, jpeg()), 201)
    live = sess[1]
    ok(r3_farrier().patch(f"/api/uploads/{live['id']}", raw=b"\xff\xd8" + b"\x00" * (CHUNK - 2), ctype="application/octet-stream",
                       hdr={"Upload-Offset": "0"}))
    assert s3.keys(f"uploads/{live['id']}/")
    ok(close(yv))
    assert ok(r3_farrier().get(f"/api/visits/{yv}/uploads")) == []
    r3_err(r3_farrier().get(f"/api/uploads/{live['id']}"), 409, "visit_closed")
    wait(lambda: not s3.keys(f"uploads/{live['id']}/"), CLOSE_CHUNKS_S, "chunks removed")
    assert s3.keys(f"visits/{yv}/")


def test_wf_visit_photos_delete(page):
    x = visit()
    vid, s3 = x.v["id"], S3()
    p = ok(r3_upload(vid, jpeg(), who=as_(r3_APPRENTICE)), 201)
    url = p["url"]
    assert httpx.get(BASE + url).status_code == 200
    bad = re.sub(r"sig=([0-9a-f])", lambda m: "sig=" + ("0" if m.group(1) != "0" else "1"), url)
    r3_err(httpx.get(BASE + bad), 403, "url_invalid")
    r3_err(httpx.get(BASE + re.sub(r"k=[^&]+", "k=nokey", url)), 403, "url_invalid")
    show(page, r3_farrier(), f"/horses/{x.o.horse['id']}?hoof=LF")
    hoof_name, phase = "Left fore", "after"
    page.get_by_role("button", name=f"Delete {hoof_name} {phase} photo").click()
    expect(r3_notices(page)).to_have_text(f"Photo deleted for {hoof_name} ({phase}).")
    expect(page.get_by_label("Photo file")).to_be_focused()
    r3_err(r3_farrier().get(f"/api/photos/{p['id']}"), 404, "not_found")
    r3_err(httpx.get(BASE + url), 404, "not_found")
    wait(lambda: not [k for k in s3.keys(f"visits/{vid}/LF/after/") if p["id"] in k], DELETE_GONE_S, "objects gone")


def test_wf_visit_photos_key_rotation():
    x = visit()
    vid = x.v["id"]
    ok(r3_upload(vid, jpeg()), 201)
    with serve_copy(PHOTO_URL_KEY_ROTATE_SECONDS=1, PHOTO_URL_TTL_SECONDS=4) as cp:
        q = next(ph for ph in ok(r3_farrier(cp.base).get(f"/api/visits/{vid}"))["photos"])
        u1 = ok(r3_farrier(cp.base).get(f"/api/photos/{q['id']}"))
        k1 = re.search(r"k=([^&]+)", u1["url"]).group(1)
        u2 = wait(lambda: (r := ok(r3_farrier(cp.base).get(f"/api/photos/{q['id']}")))["url"].split("k=")[1].split("&")[0] != k1 and r, WAIT_S, "rotation")
        assert httpx.get(BASE + u1["url"]).status_code == 200 and httpx.get(BASE + u2["url"]).status_code == 200
        exp = int(re.search(r"exp=(\d+)", u1["url"]).group(1))
        wait(lambda: time.time() >= exp + SKEW_S, WAIT_S, "path expiry")
        r3_err(httpx.get(BASE + u1["url"]), 403, "url_invalid")


def test_wf_angle_marks_upright_bounds(page):
    x = visit()
    vid = x.v["id"]
    p = ok(r3_upload(vid, jpeg(orientation=6)), 201)
    assert (p["width"], p["height"]) == (900, 1200)
    r = r3_err(put_marks(vid, "LF", None, (100, 1100, 1100, 300), (100, 1150, 700, 350)), 422, "validation")
    assert "Keep both points inside the photo and apart from each other." in r["errors"].values()
    r3_err(put_marks(vid, "LF", None, (5, 5, 5, 5), (100, 1150, 700, 350)), 422, "validation")
    show(page, r3_farrier(), f"/horses/{x.o.horse['id']}?hoof=LF")
    for grp, pts in (("Hoof wall line", (100, 1100, 800, 300)), ("Pastern line", (100, 1150, 700, 350))):
        g = page.get_by_role("group", name=grp)
        for nm, v in zip(("Start x", "Start y", "End x", "End y"), pts):
            g.get_by_role("spinbutton", name=nm).fill(str(v))
    page.get_by_role("button", name="Save marks").click()
    wall, pastern, label = angle((100, 1100, 800, 300)), angle((100, 1150, 700, 350)), "broken-back"
    expect(r3_notices(page)).to_have_text(f"Marks saved: hoof wall {wall}°, pastern {pastern}°, {label}.")
    m = next(k for k in ok(r3_farrier().get(f"/api/visits/{vid}"))["marks"] if k["hoof"] == "LF")
    assert (m["hoof_wall"]["angle"], m["pastern"]["angle"], m["alignment"], m["version"]) == (wall, pastern, label, 1)
    assert m["saved_by"]["role"] == "farrier"
    for _ in range(3):
        hw = (random.randint(0, 899), random.randint(0, 1199), random.randint(0, 899), random.randint(0, 1199))
        ps = (random.randint(0, 899), random.randint(0, 1199), random.randint(0, 899), random.randint(0, 1199))
        if hw[:2] == hw[2:] or ps[:2] == ps[2:] or hw[0] == hw[2] or ps[0] == ps[2]:
            continue
        cur = next(k for k in ok(r3_farrier().get(f"/api/visits/{vid}"))["marks"] if k["hoof"] == "LF")["version"]
        s = ok(put_marks(vid, "LF", cur, hw, ps, who=as_(r3_APPRENTICE)))
        d = round(angle(hw) - angle(ps), 1)
        assert (s["hoof_wall"]["angle"], s["pastern"]["angle"]) == (angle(hw), angle(ps))
        assert s["alignment"] == ("aligned" if abs(d) <= 3.0 else "broken-back" if d < 0 else "broken-forward")
    v = ok(put_marks(vid, "LF", s["version"] if "s" in dir() else 1, (10, 10, 10, 500), (10, 10, 10, 400)))
    assert (v["hoof_wall"]["angle"], v["alignment"]) == (90.0, "aligned")


def test_wf_angle_marks_restore_close_order(page):
    x = visit()
    vid, app = x.v["id"], as_(r3_APPRENTICE)
    ok(r3_upload(vid, jpeg()), 201)
    r3_err(put_marks(vid, "RF", None, *SEED_LF[0]), 409, "photo_required")
    rs = race([lambda: put_marks(vid, "LF", None, *SEED_LF[0]), lambda: put_marks(vid, "LF", None, *SEED_LF[1], who=app)])
    assert sorted(r.status_code for r in rs) == [200, 412]
    win, lose = (rs[0], rs[1]) if rs[0].status_code == 200 else (rs[1], rs[0])
    assert lose.json()["error"] == "stale_marks" and lose.json()["current"] == win.json()
    v1 = win.json()
    v2 = ok(put_marks(vid, "LF", 1, *SEED_LF[2], who=app))
    assert v2["version"] == 2
    assert r3_err(put_marks(vid, "LF", 1, *SEED_LF[0]), 412, "stale_marks")["current"]["version"] == 2
    hist = ok(r3_farrier().get(f"/api/visits/{vid}/hooves/LF/marks/history"))
    assert [h["version"] for h in hist] == [1, 2] and hist[1]["saved_by"]["role"] == "apprentice"
    rp = f"/api/visits/{vid}/hooves/LF/marks/restore"
    v3 = ok(r3_farrier().post(rp, {"version": 2, "restore_version": 1}))
    assert (v3["version"], v3["restored_from"]) == (3, 1)
    assert (v3["hoof_wall"], v3["pastern"], v3["alignment"]) == (v1["hoof_wall"], v1["pastern"], v1["alignment"])
    assert r3_err(r3_farrier().post(rp, {"version": 3, "restore_version": 9}), 422, "validation")["errors"]["restore_version"] == "That version is not in this hoof's history."
    r3_err(r3_farrier().post(rp, {"version": 2, "restore_version": 1}), 412, "stale_marks")
    assert x.o.api.get(f"/api/visits/{vid}/hooves/LF/marks/history").status_code == 403
    assert as_(BRAM).get(f"/api/visits/{vid}").status_code == 404
    show(page, r3_farrier(), f"/horses/{x.o.horse['id']}?hoof=LF")
    page.get_by_role("group", name="Hoof wall line").get_by_role("spinbutton", name="Start x").wait_for()
    page.get_by_role("group", name="Hoof wall line").get_by_role("spinbutton", name="Start x").fill("101")
    v4 = ok(put_marks(vid, "LF", 3, (100, 100, 400, 500), (200, 200, 500, 700), who=app))
    page.get_by_role("button", name="Save marks").click()
    hoof_name = "Left fore"
    expect(r3_notices(page)).to_have_text(f"Someone else saved marks for {hoof_name} first. Their lines are now shown; check them and save again.")
    sx = page.get_by_role("group", name="Hoof wall line").get_by_role("spinbutton", name="Start x")
    expect(sx).to_be_focused()
    expect(sx).to_have_value("100")
    rs = race([lambda: close(vid), lambda: put_marks(vid, "LF", 4, *SEED_LF[0], who=app)])
    cv = ok(rs[0])
    assert rs[1].status_code == 200 or rs[1].json()["error"] == "visit_closed"
    final = next(m for m in cv["marks"] if m["hoof"] == "LF")["version"]
    assert final == (5 if rs[1].status_code == 200 else v4["version"])
    assert next(m for m in ok(x.o.api.get(f"/api/visits/{vid}"))["marks"] if m["hoof"] == "LF")["version"] == final


def _swallow(fn):
    try:
        fn()
    except httpx.HTTPError:
        pass


r3_JUNIPER_LF = ["Hoof wall 51.5° → 54.0° (+2.5°)", "Pastern 56.0° → 55.0° (−1.0°)", "Alignment broken-back → aligned"]


r3_JUNIPER_RF = ["Hoof wall 49.6° → 50.8° (+1.2°)", "Pastern 53.0° → 50.8° (−2.2°)", "Alignment broken-back → aligned"]


def test_wf_vet_link_live_pair():
    o = owners(1)[0]
    vs = chain(o, [0, 1])
    lk = ok(r3_farrier().post(f"/api/horses/{o.horse['id']}/vet-links", {"vet_name": "x", "vet_email": "p@clinch.example"}), 201)
    assert (lk["previous_visit_id"], lk["current_visit_id"]) == (vs[0].v["id"], vs[1].v["id"])
    tok = lk["url"].rsplit("/", 1)[1]
    r1 = ok(httpx.get(f"{BASE}/api/vet/{tok}"))
    cmp = lambda p, c: ok(r3_farrier().get(f"/api/horses/{o.horse['id']}/comparison?hoof=LF&previous={p}&current={c}"))["readout"]
    assert r1["hooves"]["LF"]["readout"] == cmp(vs[0].v["id"], vs[1].v["id"])
    old_prev = r1["hooves"]["LF"]["previous"]["photo"]["url"]
    old_cur = r1["hooves"]["LF"]["current"]["photo"]["url"]
    v3 = chain(o, [2])[0]
    r2 = ok(httpx.get(f"{r3_PEER}/api/vet/{tok}"))
    assert r2["hooves"]["LF"]["readout"] == cmp(vs[1].v["id"], v3.v["id"])
    r3_err(httpx.get(BASE + old_prev), 403, "url_invalid")
    assert httpx.get(BASE + old_cur).status_code == 200
    views = ok(r3_farrier().get(f"/api/vet-links/{lk['id']}/views"))
    assert [v["outcome"] for v in views[:2]] == ["viewed", "viewed"] and all(v["current_date"] for v in views[:2])


def _unpaid(horses=1):
    o = owners(1, horses=horses)[0]
    x = visit(o, horses=o.horses)
    invs = []
    for v in x.vs:
        ok(r3_upload(v["id"], jpeg()), 201)
        invs.append(ok(close(v["id"]))["invoice"])
    return o, x, invs


def test_wf_rate_limiting_clocks():
    o = owners(1)[0]
    env = {"RATE_HOLD_USER_CAPACITY": 2, "RATE_HOLD_USER_REFILL_PER_MINUTE": 1}
    one_token_s = 60
    slack_s = 3
    boot_s = 45
    bd = day(slots=1)
    bogus = {"id": "missing-slot"}
    r3_hold(o, bd, bogus)
    with serve_copy(**env) as cp:
        rem = [r3_hold(o, bd, bogus, base=cp.base).headers["RateLimit-Remaining"] for _ in range(2)]
        assert rem == ["1", "0"]
        r = r3_hold(o, bd, bogus, base=cp.base)
        assert r.status_code == 429 and r.json()["bucket"] == "hold" and r.headers["RateLimit-Limit"] == "2"
        assert one_token_s - slack_s <= int(r.headers["Retry-After"]) <= one_token_s
    with serve_copy(**env) as cp:
        assert r3_hold(o, bd, bogus, base=cp.base).status_code == 429
    lead = 120
    with serve_copy(CLOCK_OFFSET_SECONDS=lead, **env) as ahead:
        rem = [r3_hold(o, bd, bogus, base=ahead.base).headers["RateLimit-Remaining"] for _ in range(2)]
        assert rem == ["1", "0"]
        r = r3_hold(o, bd, bogus, base=ahead.base)
        assert r.status_code == 429 and one_token_s - slack_s <= int(r.headers["Retry-After"]) <= one_token_s
    with serve_copy(**env) as cp:
        r = r3_hold(o, bd, bogus, base=cp.base)
        assert r.status_code == 429
        assert one_token_s + lead - boot_s <= int(r.headers["Retry-After"]) <= one_token_s + lead


def test_wf_horizontal_scale_identity():
    tok = ok(r3_farrier().post("/api/tokens", {"name": f"t{uuid.uuid4().hex[:6]}", "scope": "read_only"}), 201)["token"]
    tk = Api(BASE, token=tok)
    calls = [(as_(r3_ADA), {"Juniper", "Pilot"}, False), (as_(BRAM), {"Saffron", "Quarry"}, False), (tk, None, True), (r3_farrier(), None, True)] * 10
    random.shuffle(calls)
    with ThreadPoolExecutor(len(calls)) as ex:
        res = list(ex.map(lambda c: (c, c[0].get("/api/horses"), c[0].get("/api/me")), calls))
    for (api, names, staff), hs, me in res:
        hs = ok(hs)
        if staff:
            assert all("owner" in h for h in hs) and ok(me)["role"] == "farrier"
        else:
            assert {h["name"] for h in hs} == names and all("owner" not in h for h in hs)
            assert ok(me)["id"] == api.user["id"]


def test_wf_dunning_unblock_offer(mail):
    o, x, (inv,) = _unpaid()
    bd = day(slots=1)
    holder = owners(1)[0]
    b = book(holder, bd, 0)
    ok(o.api.post(f"/api/barn-days/{bd['id']}/waitlist", {"horse_id": o.horse["id"], "card_token": r3_APPROVE}), 201)
    r3_err(o.api.post(f"/api/invoices/{inv['id']}/payments", {"card_token": DECLINE}, key=idempotency_key()), 402, "card_declined")
    assert next(i for i in ok(o.api.get("/api/invoices")) if i["id"] == inv["id"])["dunning_state"] == "blocked"
    assert len(r3_inbox(mail, o.email, f"Account on hold: {o.horse['name']}")) == 1
    assert mail_count(mail, o.email, "Payment failed") == 0
    ok(holder.api.post(f"/api/bookings/{b['id']}/cancel"))
    d, w = consistent(bd)
    assert d["booked_count"] == 0 and [e["horse"]["id"] for e in w] == [o.horse["id"]] and w[0]["position"] == 1
    assert not [x for x in r3_my_bookings(o) if x["barn_day_id"] == bd["id"]]
    ok(o.api.post(f"/api/invoices/{inv['id']}/payments", {"card_token": r3_APPROVE}, key=idempotency_key()), 201)
    off = [x for x in r3_my_bookings(o) if x["barn_day_id"] == bd["id"]]
    assert off and off[0]["status"] == "held" and off[0]["offer"] is True
    assert parse(off[0]["hold_expires_at"]) > now()


def test_wf_ops_lifecycle_sigterm(page, mail, killbill):
    os_ = owners(4)
    bd = day(slots=4)
    hs = [ok(r3_hold(o, bd, bd["slots"][i]), 201) for i, o in enumerate(os_[:3])]
    with serve_copy(INSTANCE_LABEL="drain") as cp:
        st = r3_Stream(r3_farrier(cp.base), f"/api/barn-days/{bd['id']}/events")
        res = {}

        def confirm(i):
            try:
                res[i] = os_[i].api.on(cp.base).post(f"/api/bookings/{hs[i]['id']}/confirm")
            except httpx.HTTPError:
                res[i] = None
        ts = [threading.Thread(target=confirm, args=(i,)) for i in range(3)]
        for t in ts:
            t.start()
        cp.proc.send_signal(signal.SIGTERM)
        try:
            late = r3_hold(os_[3], bd, bd["slots"][3], base=cp.base)
            assert late.status_code == 503 and late.json() == {"error": "shutting_down"}
        except httpx.HTTPError:
            pass
        rc = cp.proc.wait(GRACE_S + SKEW_S)
        assert rc == 0, cp.tail()
        for t in ts:
            t.join(HTTP_TIMEOUT)
        assert st.done.wait(GRACE_S)
    assert r3_my_bookings(os_[3]) == [] and ok(os_[3].api.get("/api/payments")) == []
    for i in range(3):
        b = next(x for x in r3_my_bookings(os_[i]) if x["id"] == hs[i]["id"])
        p = r3_payment(os_[i].api, hs[i]["payment_id"])
        if res[i] is not None and res[i].status_code == 200:
            assert b["status"] == "confirmed" and p["status"] == "captured"
            wait(lambda i=i: kb_tx(killbill, os_[i].email, f"{hs[i]['payment_id']}:capture"), DELIVER_S)
            assert len(r3_inbox(mail, os_[i].email, "Booked:")) == 1
        else:
            assert b["status"] == "held" and p["status"] == "authorized"
            assert mail_count(mail, os_[i].email, "Booked:") == 0
    page.goto(BASE + "/sign-in")
    expect(page.get_by_role("form", name="Sign in")).to_be_visible()

