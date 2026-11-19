from __future__ import annotations

import concurrent.futures as cf
import contextlib
import hashlib
import json
import math
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP, S3, Postgres, addresses, advance, animations, held, idempotency_key, layout,
    mail_from_address, open_app, same_origin, select, session, tab_order, text, until,
)

PASSWORD = "pilot-light-demo"
ROSA, ADE, THEO, HANA = "rosa@lindqvist.example", "ade@okonjo.example", "theo@mbekismoke.example", "hana@satopatisserie.example"
DANA, LUIS, PRIYA = "dana@copperline.example", "luis@copperline.example", "priya@copperline.example"
INES, MARCO, ROSALIND = "ines@fernhollow.example", "marco@fernhollow.example", "rosalind@parkstreetpies.example"
EAST, HIGH, FERN = "Copperline Eastside", "Copperline Highline", "Fernhollow Commissary"
EAST_TZ = ZoneInfo("America/New_York")
SENDER = "tickets@pilotlight.example"
LEGAL = "Copperline Kitchen Collective, Inc."
STARTER, TRUCK, DANA_NAME = "Starter 10", "Smoke Signal", "Dana Okafor"
COI_LABEL, HANA_BIZ, COI_UNTIL = "Certificate of insurance", "Sato Patisserie", "2027-04-30"
SCAN_NAME = "scan.pdf"
INSPECT_PROBE = "/api/inspect/whatever"
HEALTH_S = 20
MAIL_S = 10
SCAN_S = 30
JSON_LIMIT = 65536
FILE_LIMIT = 5000000
HOLD_TTL_S = 600
DIAL_RELOAD_MS = 15000
SITE_RELOAD_MS = 30000
PACKS_REFRESH_MS = 61000
SENTENCE_MS = 2000
PREVIEW_MS = 100
MOTION_MAX_MS = 500
REDUCED_MAX_MS = 1
NOTICE_SCAN_S = 30
MIN_TARGET = 44
PHONE, TABLET, DESKTOP = (375, 812), (768, 1024), (1280, 800)
EDGES = [639, 640, 1023, 1024]
SHORT_LINK_TTL_S = 20
SHORT_IDLE_S = 20
SHORT_HOLD_TTL_S = 5
HTTP_TIMEOUT_S = 60
WAIT_S = 120
POLL_S = 0.25
COUNTDOWN_STEP_MS = 60000
TICK_MS = 1000
RESPONSE_WAIT_MS = 120000
LINK_TTL_S = 259200


def poll(fetch, done, seconds, what):
    end, pause = time.monotonic() + seconds, threading.Event()
    while True:
        value = fetch()
        if done(value):
            return value
        assert time.monotonic() < end, what() if callable(what) else what
        pause.wait(POLL_S)


def hh(x) -> str:
    return f"{x:.2f}"


def sector(kind: str, a: str, b: str) -> str:
    return f"{kind} {a} to {b}"


def dial_of(station: str) -> str:
    return f"{station} dial"


def refund_sentence(r) -> str:
    return f"Cancelling refunds {hh(r)} pack hours."


def split_sentence(r, f) -> str:
    return f"Cancelling now refunds {hh(r)} pack hours and forfeits {hh(f)} pack hours."


def forfeit_sentence(f) -> str:
    return f"Cancelling now forfeits {hh(f)} pack hours."


def mail_subject(prefix, station, d, a, b) -> str:
    return f"{prefix}: {station}, {d} {a}-{b}"


def plus_days(d: str, n: int) -> str:
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


def weekly(d: str, n: int) -> list[str]:
    return [plus_days(d, 7 * k) for k in range(n)]


def occ_line(d, a, b, hours) -> str:
    return f"{d} {a}–{b} · {hh(hours)} h"


def utc_iso(local_date: str, hhmm: str, tz=EAST_TZ) -> str:
    dt = datetime.fromisoformat(f"{local_date}T{hhmm}").replace(tzinfo=tz).astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
BOOKING_KEYS = {"id", "reference", "site_id", "station_id", "station_name", "member_id", "business_name", "date", "start", "end", "start_at", "end_at", "hours", "status", "hold_expires_at", "series_id", "refunded_hours", "forfeited_hours", "cancelled_by", "cancellation_reason", "checked_in_at", "checked_in_by", "no_show_by", "checked_out_at", "checked_out_by", "late_quarter_hours", "pack_hours_applied", "overage", "created_at"}
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PDF = b"%PDF-1.4\r\n%\x00\xff\r\n1 0 obj<<>>endobj\n\x00\x01\x02 trailer\r\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + bytes(range(256))
JPEG = b"\xff\xd8\xff\xe0" + bytes(range(200))
XSS = "<img src=x onerror=\"document.title='xss'\">"

def _serve_cmd() -> str:
    return json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-4000:]


def _spawn(over: dict) -> tuple[str, subprocess.Popen, str]:
    port = _free_port()
    env = dict(os.environ, APP_PUBLIC_PORT=str(port))
    env.pop("PILOTLIGHT_CLOCK_START", None)
    env.pop("PILOTLIGHT_SEED_SET", None)
    env.update(over)
    path = tempfile.mkstemp(suffix=".log")[1]
    log = open(path, "w")
    p = subprocess.Popen(_serve_cmd(), shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                         stderr=subprocess.STDOUT, start_new_session=True)
    return f"http://127.0.0.1:{port}", p, path


def _stop(p: subprocess.Popen) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(p.pid, signal.SIGTERM)
    try:
        p.wait(10)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)


def _healthy(url: str, p: subprocess.Popen, log: str, deadline: float) -> None:
    def probe():
        assert p.poll() is None, f"app exited:\n{_tail(log)}"
        with contextlib.suppress(httpx.HTTPError):
            return httpx.get(url + "/api/health", timeout=2).status_code
        return None
    poll(probe, lambda s: s == 200, max(deadline - time.monotonic(), 0), lambda: f"not healthy within {HEALTH_S}s:\n{_tail(log)}")


def _psql(sql: str) -> None:
    subprocess.run(["psql", os.environ["DATABASE_URL"], "-qtAc", sql], check=True, capture_output=True, timeout=60)


@contextlib.contextmanager
def fresh_app(clock=None, seed=None, copies=(), **env):
    suffix = "t" + uuid.uuid4().hex[:12]
    db = os.environ["DATABASE_URL"] + "_" + suffix
    name = urlparse(db).path.lstrip("/")
    _psql(f'CREATE DATABASE "{name}"')
    base = {"DATABASE_URL": db, **env}
    if clock:
        base["PILOTLIGHT_CLOCK_START"] = clock
    if seed:
        base["PILOTLIGHT_SEED_SET"] = seed
    started = time.monotonic()
    procs = [_spawn(base)] + [_spawn({**base, **c}) for c in copies]
    try:
        for u, p, log in procs:
            _healthy(u, p, log, started + HEALTH_S)
        yield SimpleNamespace(url=procs[0][0], urls=[u for u, _, _ in procs], pg=Postgres("_" + suffix))
    finally:
        for _, p, _ in procs:
            _stop(p)
        subprocess.run(["psql", os.environ["DATABASE_URL"], "-qtAc", f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'], capture_output=True)


class Api:
    def __init__(self, base: str, email: str | None = None, cookies=None):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, cookies=cookies)
        self.me = None
        if email:
            r = self.c.post("/api/session", json={"email": email, "password": PASSWORD}, headers={"Origin": self.base})
            assert r.status_code == 200, r.text
            self.me = r.json()

    def at(self, url: str) -> "Api":
        a = Api(url, cookies=self.c.cookies)
        a.me = self.me
        return a

    def req(self, method, path, body=None, key=None, headers=None, **kw):
        h = {"Origin": self.base}
        tok = self.c.cookies.get("pl_csrf")
        if method != "GET" and tok:
            h["X-CSRF-Token"] = tok
        if key:
            h["Idempotency-Key"] = key
        h.update(headers or {})
        if body is not None:
            kw["json"] = body
        return self.c.request(method, path, headers=h, **kw)

    def get(self, path, **kw):
        return self.req("GET", path, **kw)

    def post(self, path, body=None, key=None, **kw):
        if body is None and "files" not in kw and "content" not in kw:
            body = {}
        return self.req("POST", path, body, key, **kw)

    @property
    def member_id(self):
        return self.me["member"]["id"]


def code(r) -> str:
    return r.json()["error"]["code"]


def site(api, name):
    return next(s for s in api.get("/api/sites").json()["sites"] if s["name"] == name)


def stations(api, site_id, d):
    r = api.get(f"/api/sites/{site_id}/availability", params={"date": d})
    assert r.status_code == 200, r.text
    return {s["name"]: s["id"] for s in r.json()["stations"]}


def hold(api, sid, d, start, end, key=None):
    return api.post("/api/bookings", {"station_id": sid, "date": d, "start": start, "end": end}, key or idempotency_key())


def book(api, sid, d, start, end):
    r = hold(api, sid, d, start, end)
    assert r.status_code == 201, r.text
    c = api.post(f"/api/bookings/{r.json()['booking']['id']}/confirm")
    assert c.status_code == 200, c.text
    return c.json()["booking"]


def by_ref(mgr, site_id, d, ref):
    rows = mgr.get(f"/api/sites/{site_id}/bookings", params={"date": d}).json()["bookings"]
    return next(b for b in rows if b["reference"] == ref)


def ledger(api):
    r = api.get("/api/me/ledger")
    assert r.status_code == 200, r.text
    return r.json()


def check_ledger(api):
    led = ledger(api)
    tot = {"available": 0.0, "committed": 0.0}
    for m in led["movements"]:
        assert len(m["entries"]) == 2 and sum(e["hours"] for e in m["entries"]) == 0
        for e in m["entries"]:
            if e["account"] in tot:
                tot[e["account"]] += e["hours"]
    b = led["balances"]
    assert b["available_hours"] == tot["available"] and b["committed_hours"] == tot["committed"]
    assert sum(lot["hours"] for lot in b["lots"]) == b["available_hours"]
    return led


def moves(api, booking_id):
    return [m for m in ledger(api)["movements"] if m["booking_id"] == booking_id]


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def server_now(api) -> datetime:
    return parsedate_to_datetime(api.c.get("/api/health").headers["Date"])


def wait_server(api, iso_instant: str) -> None:
    target = ts(iso_instant)
    poll(lambda: server_now(api), lambda n: n >= target, WAIT_S, "server clock never reached " + iso_instant)


def together(*calls):
    bar = threading.Barrier(len(calls))

    def run(f):
        bar.wait()
        return f()
    with cf.ThreadPoolExecutor(len(calls)) as ex:
        return list(ex.map(run, calls))


def half_up(x: Decimal) -> int:
    return int(x.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def money(cents: int) -> str:
    return f"{cents // 100:,}.{cents % 100:02d}"


def subject(m) -> str:
    return m.get("Subject", "")


def mails(mail, pred, n=1, wait=None):
    bound = MAIL_S + 5 if wait is None else wait
    poll(lambda: [m for m in mail.messages(0, settle=0) if pred(m)], lambda ms: len(ms) >= n, bound, "expected messages were not delivered")
    return [m for m in mail.messages(0) if pred(m)]


def live_invoices(killbill, account_id):
    return [i for i in killbill.invoices(account_id) if i.get("status") != "VOID"]


def kb_live(killbill, member_id) -> dict:
    acct = killbill.account_by_key(member_id)
    return {i["invoiceId"]: i for i in live_invoices(killbill, acct["accountId"])} if acct else {}


def late_q(bk) -> int:
    return -(-int((ts(bk["checked_out_at"]) - ts(bk["end_at"])).total_seconds() // 60) // 15)


def priced(q, rate, tax) -> tuple[int, int]:
    sub = Decimal(q) * rate / 4
    return half_up(sub), half_up(sub * Decimal(tax) / 100)


def theo_truck(api) -> str:
    return api.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]


COI = {"per_occurrence_limit": "1000000", "names_additional_insured": "true"}


def upload(api, data, ctype, name=SCAN_NAME, t="food_handler_certificate", extra=None):
    return api.post("/api/documents", files={"file": (name, data, ctype)}, data={"type": t, "expiry_date": "2027-05-01", **(extra or {})})


def doc_prefix(api) -> str:
    return f"documents/{api.me['user']['tenant']['id']}/{api.member_id}/"


def pdf_text(data: bytes) -> str:
    chunks = [data]
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        with contextlib.suppress(zlib.error):
            chunks.append(zlib.decompress(m.group(1)))
    out = []
    for c in chunks:
        for arr in re.finditer(rb"\[(.*?)\]\s*TJ|(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f]+>)\s*Tj", c, re.S):
            body = arr.group(1) if arr.group(1) is not None else arr.group(2)
            s = ""
            for part in re.finditer(rb"\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f]+)>", body):
                s += part.group(1).decode("latin-1") if part.group(1) is not None else bytes.fromhex(part.group(2).decode()).decode("latin-1")
            out.append(s)
    return "\n".join(out)


@contextlib.contextmanager
def ui(browser, url, email=None, size=DESKTOP, browser_time=None, **kw):
    with open_app(browser, url, **kw) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if browser_time:
            page.clock.set_system_time(browser_time)
        if email:
            sign_in(page, email)
        yield page


def sign_in(page, email):
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_label("Password", exact=True).fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    expect(page.get_by_role("button", name="Sign out")).to_be_visible(timeout=15000)


def instant(locator):
    for a in animations(locator):
        assert float(a.get("duration") or 0) + float(a.get("delay") or 0) <= REDUCED_MAX_MS


def see(page, s, seconds=30):
    until(page, "s => document.body.innerText.replace(/\\s+/g, ' ').includes(s)", s, seconds)


def status(page, name):
    return page.get_by_role("status", name=name)


def spin(loc) -> str:
    return loc.evaluate("e => e.getAttribute('aria-valuetext') || e.getAttribute('aria-valuenow') || e.value")


def ring(dial, a, b):
    pts = []
    for name, s, e in (a, b):
        bb = dial.get_by_role("img", name=name).bounding_box()
        ang = math.radians((s + e) / 2 * 0.25)
        pts.append(((bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2), (math.sin(ang), -math.cos(ang))))
    (p1, u1), (p2, u2) = pts
    du, dp = (u1[0] - u2[0], u1[1] - u2[1]), (p1[0] - p2[0], p1[1] - p2[1])
    r = (dp[0] * du[0] + dp[1] * du[1]) / (du[0] ** 2 + du[1] ** 2)
    c = (p1[0] - r * u1[0], p1[1] - r * u1[1])
    return lambda m: (c[0] + r * math.sin(math.radians(m * 0.25)), c[1] - r * math.cos(math.radians(m * 0.25)))


def box_size(loc) -> tuple[float, float]:
    return loc.evaluate("""e => { const bs=[e.getBoundingClientRect()];
      for (const l of (e.labels||[])) bs.push(l.getBoundingClientRect());
      for (const id of (e.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean)) { const l=document.getElementById(id); if (l) bs.push(l.getBoundingClientRect()); }
      return [Math.max(...bs.map(b=>b.width)), Math.max(...bs.map(b=>b.height))]; }""")


def controls_ok(page):
    for role in ("button", "link", "textbox", "combobox", "spinbutton", "checkbox", "radio"):
        for loc in page.get_by_role(role).all():
            if loc.is_visible():
                w, h = box_size(loc)
                assert w >= MIN_TARGET and h >= MIN_TARGET, f"{role} {loc.text_content()!r} is {w}x{h}"


def cells_stack(row) -> bool:
    cells = [c.bounding_box() for c in row.get_by_role("cell").all()[:2]]
    return abs(cells[0]["y"] - cells[1]["y"]) > 2


def test_health_and_manifest(app_url):
    r = httpx.get(app_url + "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    with fresh_app() as f:
        assert httpx.get(f.url + "/api/health").json() == {"status": "ok"}
    url, p, log = _spawn({"DATABASE_URL": "postgres://x:y@127.0.0.1:9/none"})
    def probe():
        assert p.poll() is None, _tail(log)
        with contextlib.suppress(httpx.HTTPError):
            return httpx.get(url + "/api/health", timeout=2)
        return None
    try:
        r = poll(probe, lambda x: x is not None, HEALTH_S, lambda: _tail(log))
        assert r.status_code == 503 and r.json() == {"status": "starting"}
    finally:
        _stop(p)


def test_error_precedence(app_url):
    anon = Api(app_url)
    rosa, dana, priya = Api(app_url, ROSA), Api(app_url, DANA), Api(app_url, PRIYA)
    rid = str(uuid.uuid4())
    cases = [
        (anon.req("PUT", "/api/bookings", {}), 405, "method_not_allowed"),
        (anon.get("/api/me"), 401, "unauthenticated"),
        (Api(app_url, cookies={"pl_session": "x" * 40}).get("/api/me"), 401, "session_invalid"),
        (anon.post(INSPECT_PROBE), 405, "read_only"),
        (rosa.get("/api/audit"), 403, "forbidden"),
        (dana.post(f"/api/bookings/{rid}/confirm"), 403, "forbidden"),
        (priya.get(f"/api/documents/{rid}"), 403, "forbidden"),
        (rosa.get(f"/api/bookings/{rid}"), 404, "not_found"),
        (rosa.post("/api/bookings", {"station_id": rid, "date": "2026-12-01", "start": "10:00", "end": "11:00"}), 404, "not_found"),
    ]
    for r, st, c in cases:
        assert r.status_code == st and code(r) == c, (r.request.url, r.text)
        assert list(r.json().keys()) == ["error"] and {"code", "message"} <= set(r.json()["error"])
        assert r.headers["content-type"].replace(" ", "").lower() == "application/json; charset=utf-8".replace(" ", "")
    assert cases[3][0].headers["allow"] == "GET"
    east = site(rosa, EAST)
    st = stations(rosa, east["id"], east["local_date"])["Deck Oven 1"]
    r = rosa.post("/api/bookings", {"station_id": st, "date": east["local_date"], "start": "10:00", "end": "11:00"})
    assert r.status_code == 422 and code(r) == "validation" and "Idempotency-Key" in r.json()["error"]["fields"]


def test_wf_cross_cutting_server_boundary(app_url):
    rosa, priya = Api(app_url, ROSA), Api(app_url, PRIYA)
    east = site(priya, EAST)
    body = {"station_id": str(uuid.uuid4()), "date": "2026-12-01", "start": "10:00", "end": "11:00"}
    r = rosa.req("POST", "/api/bookings", body, idempotency_key(), headers={"Origin": "http://evil.example"})
    assert r.status_code == 403 and code(r) == "cross_origin"
    r = Api(app_url).req("POST", "/api/session", {"email": PRIYA, "password": PASSWORD}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403 and code(r) == "cross_origin"
    before = priya.get(f"/api/sites/{east['id']}/rates").json()
    path = f"/api/sites/{east['id']}/rates"
    r = priya.req("POST", path, content=b'{"effective_from":"2027-01-05"}', headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and code(r) == "unsupported_media_type"
    pad = lambda n: json.dumps({"effective_from": "2027-01-05", "pad": "a" * n}).encode()
    exact = pad(JSON_LIMIT - len(pad(0)))
    assert len(exact) == JSON_LIMIT
    r = priya.req("POST", path, content=exact + b" ", headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and code(r) == "body_too_large"
    r = priya.req("POST", path, content=exact, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert priya.get(path).json() == before
    for p in ["/run.json", "/package.json", "/.env", "/src/server.ts", "/tsconfig.json", "/assets/../../run.json", "/%2e%2e/%2e%2e/etc/passwd"]:
        r = httpx.get(app_url + p)
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", p


def test_csrf_token(app_url):
    rosa, priya = Api(app_url, ROSA), Api(app_url, PRIYA)
    east = site(rosa, EAST)
    st = stations(rosa, east["id"], east["local_date"])["Prep Table A"]
    body = {"station_id": st, "date": east["local_date"], "start": "10:00", "end": "11:00"}

    def send(api, method, path, token, b=None):
        h = {"Origin": api.base, "Idempotency-Key": idempotency_key()}
        if token is not None:
            h["X-CSRF-Token"] = token
        return api.c.request(method, path, json=b, headers=h)
    before = rosa.get("/api/bookings").json()["bookings"]
    for tok in (None, "", "stale-token-value", priya.c.cookies["pl_csrf"]):
        r = send(rosa, "POST", "/api/bookings", tok, body)
        assert r.status_code == 403 and code(r) == "csrf_failed", tok
    assert rosa.get("/api/bookings").json()["bookings"] == before
    r = send(priya, "POST", "/api/bookings", "", body)
    assert r.status_code == 403 and code(r) == "csrf_failed"
    assert code(send(priya, "POST", "/api/bookings", priya.c.cookies["pl_csrf"], body)) == "forbidden"
    r = send(rosa, "DELETE", "/api/session", None)
    assert r.status_code == 403 and code(r) == "csrf_failed"
    assert rosa.get("/api/me").status_code == 200


def test_closed_bodies(app_url):
    rosa, priya = Api(app_url, ROSA), Api(app_url, PRIYA)
    east = site(priya, EAST)
    led = ledger(rosa)
    packs = rosa.get("/api/packs").json()["packs"]
    r = rosa.post("/api/pack-purchases", {"pack_id": packs[0]["id"], "price_cents": 1}, idempotency_key())
    assert r.status_code == 422 and r.json()["error"]["fields"]["price_cents"] == "Unknown field."
    d = rosa.get("/api/sites").json()["sites"]
    date = next(s for s in d if s["name"] == EAST)["local_date"]
    st = stations(rosa, east["id"], date)["Prep Table A"]
    r = rosa.post("/api/bookings", {"station_id": st, "date": "2027-01-07", "start": "10:00", "end": "11:00", "status": "confirmed"}, idempotency_key())
    assert r.status_code == 422 and r.json()["error"]["fields"]["status"] == "Unknown field."
    rates_before = priya.get(f"/api/sites/{east['id']}/rates").json()
    r = priya.post(f"/api/sites/{east['id']}/rates", {"effective_from": "2027-01-05", "hourly_rate_cents": 5000, "tax_rate_percent": "8", "site_id": east["id"]})
    assert r.status_code == 422 and r.json()["error"]["fields"]["site_id"] == "Unknown field."
    assert priya.get(f"/api/sites/{east['id']}/rates").json() == rates_before
    docs = rosa.get("/api/documents").json()["documents"]
    r = rosa.post("/api/documents", files={"file": ("a.pdf", PDF, "application/pdf")},
                  data={"type": "food_handler_certificate", "expiry_date": "2027-05-01", "per_occurrence_limit": "1000000"})
    assert r.status_code == 422 and "per_occurrence_limit" in r.json()["error"]["fields"]
    assert ledger(rosa)["movements"] == led["movements"]
    assert rosa.get("/api/documents").json()["documents"] == docs


INJECTIONS = ["' OR 1=1 --", "'; DROP TABLE bookings;--", "${jndi:ldap://x/y}", '{"$ne":null}', "../../etc/passwd"]


def test_injection_safe(app_url):
    dana, priya = Api(app_url, DANA), Api(app_url, PRIYA)
    east = site(dana, EAST)
    for p in INJECTIONS:
        rs = [(dana.get(f"/api/bookings/{quote(p, safe='')}"), 404, None),
              (dana.get(f"/api/sites/{east['id']}/bookings", params={"date": p}), 422, "date"),
              (priya.get("/api/reports/utilisation", params={"month": p}), 422, "month"),
              (priya.get("/api/audit", params={"since": p}), 422, "since")]
        for r, st, field in rs:
            assert r.status_code == st, (p, r.text)
            if field:
                assert field in r.json()["error"]["fields"]
            assert not re.search(r"SELECT|syntax error|at .*\.(ts|js):\d+|/app/", r.text)
        r = priya.get("/api/members", params={"q": p})
        assert r.status_code == 200 and isinstance(r.json()["members"], list)
    assert priya.get("/api/members", params={"q": "%_"}).json()["members"] == []
    assert priya.get("/api/members", params={"q": "a\\"}).json()["members"] == []
    assert [m["business_name"] for m in priya.get("/api/members", params={"q": "sa"}).json()["members"]][:2] == ["Lindqvist Hearth Bakery", "Sato Patisserie"]


def test_secrets_not_served(app_url):
    secrets = [os.environ.get(k, "") for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    dbpw = urlparse(os.environ["DATABASE_URL"]).password or ""
    secrets = [s for s in secrets + [dbpw] if len(s) >= 12 and not s.isalpha()]
    html = httpx.get(app_url + "/").text
    bodies = [html]
    for ref in re.findall(r'(?:src|href)="(/[^"]+)"', html):
        bodies.append(httpx.get(app_url + ref).text)
    priya, rosa = Api(app_url, PRIYA), Api(app_url, ROSA)
    bodies += [priya.get("/api/audit").text, httpx.get(app_url + "/api/nope").text]
    for b in bodies:
        for s in secrets:
            assert s not in b
    rid = str(uuid.uuid4())
    assert code(priya.post(f"/api/bookings/{rid}/cancel")) == "forbidden"
    assert code(rosa.get(f"/api/sites/{site(rosa, EAST)['id']}/rates")) == "forbidden"
    assert code(Api(app_url, DANA).post("/api/pack-purchases", {"pack_id": rid}, idempotency_key())) == "forbidden"


def test_security_headers_and_inert_text(browser, app_url):
    csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    for p in ["/", "/book", "/api/health", "/api/nope"]:
        r = httpx.get(app_url + p)
        assert r.headers["x-content-type-options"] == "nosniff" and r.headers["referrer-policy"] == "no-referrer"
        if not p.startswith("/api/"):
            assert r.headers["content-security-policy"] == csp
            assert not re.search(r"<script\b[^>]*>\s*[^<\s]", r.text) and not re.search(r"\son\w+\s*=", r.text)
            assert "<style" not in r.text and not re.search(r"\sstyle\s*=", r.text)
    with fresh_app(clock="2026-10-25T12:00:00Z") as f:
        dana = Api(f.url, DANA)
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        v = dana.post(f"/api/trucks/{truck}/visits").json()["visit"]
        assert dana.post(f"/api/visits/{v['id']}/depart", {"services": ["cleaning"], "operator_signature": XSS}).status_code == 200
        link = dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": f"insp-{uuid.uuid4().hex[:6]}@health.example"}).json()["link"]
        with ui(browser, link["url"]) as page:
            title = page.title()
            tbl = page.get_by_role("table", name="Commissary visits")
            expect(tbl.get_by_role("cell", name=XSS, exact=True)).to_have_count(1)
            assert page.title() == title


def test_emails_exactly_once(app_url, mail):
    with fresh_app(clock="2026-10-23T14:00:00Z", copies=[{}]) as f:
        a = Api(f.url, ROSA)
        b = a.at(f.urls[1])
        east = site(a, EAST)
        st = stations(a, east["id"], "2026-10-24")["Deck Oven 1"]
        h = hold(a, st, "2026-10-24", "10:00", "11:00").json()["booking"]
        assert b.post(f"/api/bookings/{h['id']}/confirm").status_code == 200
        r2 = hold(a, st, "2026-10-24", "14:00", "15:00").json()["booking"]
        assert a.post(f"/api/bookings/{r2['id']}/cancel").status_code == 200
        key = idempotency_key()
        pack = next(p for p in a.get("/api/packs").json()["packs"] if p["name"] == "Starter 10")
        p1 = a.post("/api/pack-purchases", {"pack_id": pack["id"]}, key)
        assert p1.status_code == 201
        assert b.post("/api/pack-purchases", {"pack_id": pack["id"]}, key).json() == p1.json()
        conf = mails(mail, lambda m: h["reference"] in text(m))
        assert len(conf) == 1 and subject(conf[0]) == mail_subject("Booking confirmed", "Deck Oven 1", "2026-10-24", "10:00", "11:00")
        assert addresses(conf[0]["To"]) == [ROSA] and addresses(conf[0]["From"]) == [SENDER] == [mail_from_address()]
        rec = mails(mail, lambda m: p1.json()["purchase"]["id"] in text(m))
        assert len(rec) == 1 and subject(rec[0]).startswith("Receipt: Starter 10 (")
        assert not [m for m in mail.messages(0) if r2["reference"] in text(m)]


def test_wf_account_security_sign_in(browser, app_url):
    c = httpx.Client(base_url=app_url)
    r = c.post("/api/session", json={"email": "ROSA@lindqvist.example", "password": PASSWORD}, headers={"Origin": app_url})
    assert r.status_code == 200 and r.json()["user"]["email"] == ROSA and r.json()["user"]["role"] == "member"
    sc = {h.split("=", 1)[0]: h for h in r.headers.get_list("set-cookie")}
    for name in ("pl_session", "pl_csrf"):
        attrs = sc[name].lower()
        assert "path=/" in attrs and "samesite=strict" in attrs and "secure" not in attrs
        assert len(c.cookies[name]) >= 32
    assert "httponly" in sc["pl_session"].lower() and "httponly" not in sc["pl_csrf"].lower()
    d = c.delete("/api/session", headers={"Origin": app_url, "X-CSRF-Token": c.cookies["pl_csrf"]})
    assert d.status_code == 204
    pair = [Api(app_url, ROSA), Api(app_url, HANA)]
    seen = together(*[(lambda a=a: (a, a.get("/api/me"), a.get("/api/me/ledger"))) for a in pair * 10])
    for a, me, led in seen:
        assert me.status_code == 200 and me.json()["user"]["email"] == a.me["user"]["email"]
        assert me.json()["member"]["id"] == a.member_id
        assert led.json()["balances"]["available_hours"] == me.json()["member"]["available_hours"]
    with ui(browser, app_url + "/reports?month=2026-10") as page:
        expect(page.get_by_role("button", name="Sign in")).to_be_visible()
        assert urlparse(page.url).path == "/reports"
        sign_in(page, PRIYA)
        assert page.url.endswith("/reports?month=2026-10")
        nav = page.get_by_role("navigation", name="Main").get_by_role("link")
        expect(nav).to_have_text(["Rates", "Reports"])
        page.get_by_role("button", name="Sign out").click()
        expect(page.get_by_role("button", name="Sign in")).to_be_visible()
        assert urlparse(page.url).path == "/"
    with ui(browser, app_url + "/rates", THEO) as page:
        expect(page).to_have_url(re.compile(r"/book$"))
        expect(page.get_by_role("navigation", name="Main").get_by_role("link")).to_have_text(["Book", "Packs", "Documents", "Truck log"])


def test_wf_account_security_sessions():
    with fresh_app(SESSION_IDLE_SECONDS=str(SHORT_IDLE_S)) as f:
        base = f.url
        first = Api(base, PRIYA)
        old = first.c.cookies["pl_session"]
        rot = httpx.Client(base_url=base)
        rot.cookies.set("pl_session", old, domain=urlparse(base).hostname, path="/")
        r = rot.post("/api/session", json={"email": PRIYA, "password": PASSWORD}, headers={"Origin": base})
        assert r.status_code == 200 and rot.cookies["pl_session"] != old
        assert code(httpx.get(base + "/api/me", cookies={"pl_session": old})) == "session_invalid"
        s = [Api(base, PRIYA) for _ in range(3)]
        assert code(rot.get("/api/me")) == "session_invalid"
        assert all(x.get("/api/me").status_code == 200 for x in s)
        assert s[0].req("DELETE", "/api/session").status_code == 204
        assert s[0].req("DELETE", "/api/session").status_code == 204
        assert code(s[0].get("/api/me")) in ("session_invalid", "unauthenticated")
        assert s[1].get("/api/me").status_code == 200
        idle = s[2]
        clock = Api(base)
        t0 = server_now(clock)
        poll(lambda: server_now(clock), lambda n: (n - t0).total_seconds() > SHORT_IDLE_S + 1, WAIT_S, "server clock stalled")
        r = idle.get("/api/me")
        assert r.status_code == 401 and code(r) == "session_expired"
        assert code(Api(base).get("/api/me")) == "unauthenticated"


def test_wf_account_security_throttle():
    with fresh_app() as f:
        c = httpx.Client(base_url=f.url)
        post = lambda e, p: c.post("/api/session", json={"email": e, "password": p}, headers={"Origin": f.url})
        a = post(f"nobody-{uuid.uuid4().hex[:6]}@copperline.example", "wrong-pass")
        b = post(ADE, "wrong-pass")
        assert a.status_code == b.status_code == 401 and code(a) == "invalid_credentials" and a.content == b.content
        assert {k for k in a.headers if k != "date"} == {k for k in b.headers if k != "date"}
        for _ in range(4):
            assert post(ADE, "wrong-pass").status_code == 401
        r = post(ADE.upper(), PASSWORD)
        assert r.status_code == 429 and code(r) == "too_many_attempts" and int(r.headers["retry-after"]) > 0
        for i in range(14):
            assert post(f"nobody{i}-{uuid.uuid4().hex[:6]}@copperline.example", "x").status_code == 401
        r = post(PRIYA, PASSWORD)
        assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
        rows = f.pg.rows(r"""select coalesce(sum((xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I where %I::text ~ %L', c.table_schema, c.table_name, c.column_name, '^\$(argon2id|2[aby])\$'), false, true, '')))[1]::text::int),0) as hashed,
            coalesce(sum((xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I where %I::text like %L', c.table_schema, c.table_name, c.column_name, '%pilot-light-demo%'), false, true, '')))[1]::text::int),0) as plain
            from information_schema.columns c where c.table_schema not in ('pg_catalog','information_schema') and c.data_type in ('text','character varying')""")
        assert int(rows[0]["hashed"]) > 0 and int(rows[0]["plain"]) == 0


def test_server_hold():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        rosa = Api(f.url, ROSA)
        east = site(rosa, EAST)
        st = stations(rosa, east["id"], "2026-10-24")
        r = hold(rosa, st["Deck Oven 1"], "2026-10-24", "06:00", "08:00")
        assert r.status_code == 201, r.text
        b = r.json()["booking"]
        assert b["status"] == "held" and b["hours"] == 2
        assert r.json()["balances"]["available_hours"] == 10 and r.json()["balances"]["committed_hours"] == 2
        assert abs((ts(b["hold_expires_at"]) - ts(b["created_at"])).total_seconds() - HOLD_TTL_S) < 2
        assert [m["kind"] for m in moves(rosa, b["id"])] == ["booking_debit"]
        for name in ("Convection Oven 2", "Prep Table A"):
            assert hold(rosa, st[name], "2026-10-25", "06:00", "07:00").status_code == 201
        before = ledger(rosa)["movements"]
        r = hold(rosa, st["Blast Chiller"], "2026-10-25", "06:00", "07:00")
        assert r.status_code == 422 and code(r) == "hold_limit"
        assert ledger(rosa)["movements"] == before
        assert len([b for b in rosa.get("/api/bookings").json()["bookings"] if b["status"] == "held"]) == 3
        check_ledger(rosa)


def test_next_day_cutoff():
    with fresh_app(clock="2026-10-26T21:59:15Z") as f:
        ade = Api(f.url, ADE)
        east, high = site(ade, EAST), site(ade, HIGH)
        st = stations(ade, east["id"], "2026-10-27")
        r = hold(ade, st["Deck Oven 1"], "2026-10-26", "20:00", "21:00")
        assert r.status_code == 422 and code(r) == "cutoff"
        assert hold(ade, st["Deck Oven 1"], "2026-10-27", "06:00", "07:00").status_code == 201
        wait_server(ade, "2026-10-26T22:00:00Z")
        r = hold(ade, st["Blast Chiller"], "2026-10-27", "10:00", "11:00")
        assert r.status_code == 422 and code(r) == "cutoff"
        hs = stations(ade, high["id"], "2026-10-27")
        assert hold(ade, hs["Rack Oven"], "2026-10-27", "10:00", "11:00").status_code == 201


def test_availability_sectors():
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        rosa, dana, priya = Api(f.url, ROSA), Api(f.url, DANA), Api(f.url, PRIYA)
        east = site(rosa, EAST)
        av = rosa.get(f"/api/sites/{east['id']}/availability", params={"date": "2026-11-12"})
        st = {s["name"]: s for s in av.json()["stations"]}
        assert list(st) == ["Deck Oven 1", "Convection Oven 2", "Spiral Mixer 60 qt", "Blast Chiller", "Prep Table A"]
        assert st["Blast Chiller"]["kind"] == "blast_chiller"
        assert st["Prep Table A"]["sectors"] == [{"kind": "booked", "start": "10:00", "end": "14:30", "booking_id": None}, {"kind": "buffer", "start": "14:30", "end": "14:45", "booking_id": None}]
        assert st["Blast Chiller"]["sectors"] == [{"kind": "booked", "start": "08:45", "end": "10:30", "booking_id": None}, {"kind": "buffer", "start": "10:30", "end": "11:15", "booking_id": None}]
        own = rosa.get(f"/api/sites/{east['id']}/availability", params={"date": "2026-11-13"}).json()
        d1 = next(s for s in own["stations"] if s["name"] == "Deck Oven 1")["sectors"]
        sd8 = next(b for b in rosa.get("/api/bookings").json()["bookings"] if b["reference"] == "PL-SD0008")
        assert d1 == [{"kind": "own_confirmed", "start": "08:45", "end": "10:30", "booking_id": sd8["id"]}, {"kind": "buffer", "start": "10:30", "end": "11:00", "booking_id": sd8["id"]}]
        late = hold(rosa, st["Blast Chiller"]["id"], "2026-11-12", "23:15", "24:00")
        assert late.status_code == 201
        nxt = rosa.get(f"/api/sites/{east['id']}/availability", params={"date": "2026-11-13"}).json()
        bc = next(s for s in nxt["stations"] if s["name"] == "Blast Chiller")["sectors"]
        assert {"kind": "buffer", "start": "00:00", "end": "00:45", "booking_id": late.json()["booking"]["id"]} in bc
        mgr = dana.get(f"/api/sites/{east['id']}/availability", params={"date": "2026-11-10"}).json()
        mix = next(s for s in mgr["stations"] if s["name"] == "Spiral Mixer 60 qt")["sectors"]
        assert [(s["kind"], s["start"], s["end"]) for s in mix] == [("booked", "08:15", "09:15"), ("buffer", "09:15", "09:45")]
        assert all(s["booking_id"] for s in mix)


def test_role_projections():
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        rosa, dana, priya = Api(f.url, ROSA), Api(f.url, DANA), Api(f.url, PRIYA)
        east = site(rosa, EAST)
        av = rosa.get(f"/api/sites/{east['id']}/availability", params={"date": "2026-11-12"})
        raw = [av.text]
        for s in av.json()["stations"]:
            assert set(s) == {"id", "name", "kind", "sectors"}
            for sec in s["sectors"]:
                assert set(sec) == {"kind", "start", "end", "booking_id"}
        rows = dana.get(f"/api/sites/{east['id']}/bookings", params={"date": "2026-11-10"})
        raw.append(rows.text)
        bs = rows.json()["bookings"]
        assert [b["reference"] for b in bs] == ["PL-SD0003", "PL-SD0004", "PL-SD0002", "PL-SD0001"]
        for b in bs:
            assert set(b) == BOOKING_KEYS
        sd4 = bs[1]
        assert set(sd4["checked_in_by"]) == {"user_id", "name"} and sd4["checked_in_by"]["name"] == "Dana Okafor"
        m = priya.get("/api/members", params={"q": "sm"})
        raw.append(m.text)
        assert [x["business_name"] for x in m.json()["members"]] == ["Mbeki Smoke Truck", "Okonjo Small Batch"]
        for x in m.json()["members"]:
            assert set(x) == {"id", "business_name", "contact_name", "home_site_id", "truck"}
        assert set(m.json()["members"][0]["truck"]) == {"id", "name"}
        led = rosa.get("/api/me/ledger")
        raw.append(led.text)
        for mv in led.json()["movements"]:
            assert set(mv) == {"id", "kind", "booking_id", "purchase_id", "hours", "created_at", "actor", "lots", "entries"}
            assert mv["actor"] is None or set(mv["actor"]) == {"user_id", "name", "role"}
        one = dana.get(f"/api/bookings/{sd4['id']}")
        raw.append(one.text)
        assert set(one.json()["booking"]) == BOOKING_KEYS
        for t in raw:
            assert not EMAIL_RE.search(t)


def test_wf_dial_claim_pointer(browser, mail):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        ade, theo = Api(f.url, ADE), Api(f.url, THEO)
        east = site(ade, EAST)
        st = stations(ade, east["id"], "2026-10-24")["Blast Chiller"]
        book(ade, st, "2026-10-24", "08:00", "09:00")
        book(ade, st, "2026-10-24", "20:00", "21:00")
        with ui(browser, f.url + "/book", ROSA, browser_time=datetime(2026, 10, 27, 3, tzinfo=timezone.utc)) as page:
            page.get_by_role("radio", name="Blast chillers").check()
            dial = page.get_by_role("group", name="Blast Chiller dial")
            expect(dial).to_have_attribute("aria-busy", "false")
            booked = sector("Booked", "08:00", "09:00")
            expect(dial.get_by_role("img", name=booked)).to_be_visible()
            at = ring(dial, (booked, 480, 540), (sector("Booked", "20:00", "21:00"), 1200, 1260))
            page.mouse.move(*at(300))
            page.mouse.down()
            for m in range(315, 375, 15):
                page.mouse.move(*at(m))
            book(theo, st, "2026-10-24", "15:00", "16:00")
            advance(page, DIAL_RELOAD_MS)
            expect(dial.get_by_role("img", name=sector("Booked", "15:00", "16:00"))).to_be_visible()
            for m in range(375, 735, 15):
                page.mouse.move(*at(m))
            a, z, day, station = "05:00", "07:15", "2026-10-24", "Blast Chiller"
            claim = sector("Claim", a, z)
            expect(dial.get_by_role("img", name=claim)).to_be_attached()
            expect(dial).to_contain_text(re.compile(rf"Pack hours after this claim\s*{re.escape(hh(9.75))}"))
            with held(page, "**/api/bookings") as h:
                page.mouse.up()
                expect(status(page, "Booking status")).to_have_text(f"Holding {a}–{z}…")
                expect(dial.get_by_role("img", name=claim)).to_be_attached()
                h.release()
            expect(dial.get_by_role("img", name=sector("Your hold", a, z))).to_be_attached()
            rosa = Api(f.url, ROSA)
            b = next(x for x in rosa.get("/api/bookings").json()["bookings"] if x["start"] == a)
            hhmm = ts(b["hold_expires_at"]).astimezone(EAST_TZ).strftime("%H:%M")
            expect(status(page, "Booking status")).to_have_text(f"Held {station} {a}–{z}. Confirm before {hhmm} site time.")
            expect(dial).to_contain_text(re.compile(r"Held · (10:00|9:[0-5]\d) left"))
            expect(dial.get_by_role("img", name=sector("Claim", "00:00", "00:00"))).to_be_attached()
            tickets = page.get_by_role("list", name="Tickets")
            expect(tickets.get_by_role("listitem").first).to_contain_text("Held")
            page.get_by_role("button", name="Confirm booking").click()
            expect(dial).to_contain_text("Confirmed")
            top = tickets.get_by_role("listitem").first
            expect(top).to_contain_text("Confirmed")
            expect(top).to_contain_text(b["reference"])
            advance(page, MOTION_MAX_MS)
            expect(dial).to_contain_text(re.compile(rf"Pack hours\s+{re.escape(hh(9.75))}"), use_inner_text=True)
            expect(status(page, "Booking status")).to_have_text(f"Confirmed {station} {day} {a}–{z}. {hh(9.75)} pack hours left.")
        assert rosa.get(f"/api/bookings/{b['id']}").json()["booking"]["status"] == "confirmed"
        assert len([x for x in rosa.get("/api/bookings").json()["bookings"] if x["start"] == a]) == 1
        conf = mails(mail, lambda m: b["reference"] in text(m))
        assert len(conf) == 1 and subject(conf[0]) == mail_subject("Booking confirmed", station, day, a, z)


def test_wf_dial_claim_keyboard(browser):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        ade = Api(f.url, ADE)
        east = site(ade, EAST)
        st = stations(ade, east["id"], "2026-10-24")["Deck Oven 1"]
        book(ade, st, "2026-10-24", "08:00", "09:00")
        with ui(browser, f.url + "/book", ROSA) as page:
            page.get_by_role("radio", name="Ovens").check()
            dial = page.get_by_role("group", name=dial_of("Deck Oven 1"))
            expect(dial).to_have_attribute("aria-busy", "false")
            s, e = dial.get_by_role("spinbutton", name="Start time"), dial.get_by_role("spinbutton", name="End time")
            hw = dial.get_by_role("button", name="Hold window")
            assert spin(s) == "00:00"
            expect(hw).to_have_attribute("aria-disabled", "true")
            s.focus()
            for _ in range(7):
                page.keyboard.press("Shift+ArrowUp")
            page.keyboard.press("ArrowUp")
            assert (spin(s), spin(e)) == ("07:15", "07:15")
            page.keyboard.press("ArrowUp")
            assert (spin(s), spin(e)) == ("09:30", "09:30")
            page.keyboard.press("ArrowDown")
            assert (spin(s), spin(e)) == ("07:15", "07:15")
            for _ in range(5):
                page.keyboard.press("ArrowDown")
            e.focus()
            page.keyboard.press("Shift+ArrowUp")
            page.keyboard.press("ArrowUp")
            page.keyboard.press("ArrowUp")
            assert (spin(s), spin(e)) == ("06:00", "07:30")
            expect(hw).to_have_attribute("aria-disabled", "false")
            page.keyboard.press("ArrowUp")
            assert spin(e) == "07:30"
            expect(dial.get_by_role("img", name=sector("Claim", "06:00", "07:30"))).to_be_attached()
            s.focus()
            page.keyboard.press("Shift+ArrowUp")
            assert (spin(s), spin(e)) == ("09:30", "09:30")
            page.keyboard.press("ArrowUp")
            page.keyboard.press("ArrowUp")
            e.focus()
            page.keyboard.press("Shift+ArrowUp")
            assert (spin(s), spin(e)) == ("10:00", "11:00")
            hw.focus()
            with held(page, "**/api/bookings") as h:
                page.keyboard.press("Enter")
                page.keyboard.press("Enter")
                h.release()
            confirm = dial.get_by_role("button", name="Confirm booking")
            expect(confirm).to_be_focused()
            page.keyboard.press("Enter")
            expect(page.get_by_role("list", name="Tickets").get_by_role("listitem").first).to_be_focused()
            expect(page.get_by_role("list", name="Tickets").get_by_role("listitem").first).to_contain_text("Confirmed")
            s.focus()
            for _ in range(12):
                page.keyboard.press("Shift+ArrowUp")
            e.focus()
            page.keyboard.press("Shift+ArrowUp")
            lo, hi = spin(s), spin(e)
            assert hi > lo
            mins = lambda v: int(v[:2]) * 60 + int(v[3:])
            held_hours = (mins(hi) - mins(lo)) / 60
            hw.focus()
            page.keyboard.press("Enter")
            expect(dial.get_by_role("button", name="Confirm booking")).to_be_focused()
            page.keyboard.press("Tab")
            expect(dial.get_by_role("button", name="Release hold")).to_be_focused()
            page.keyboard.press("Enter")
            expect(status(page, "Booking status")).to_have_text(f"Hold released. {hh(held_hours)} pack hours returned.")
            expect(page.get_by_role("list", name="Tickets").get_by_role("listitem").first).to_contain_text("Cancelled")
        rosa = Api(f.url, ROSA)
        mine = rosa.get("/api/bookings").json()["bookings"]
        ten = [b for b in mine if b["start"] == "10:00"]
        assert len(ten) == 1 and ten[0]["status"] == "confirmed"
        assert [b["status"] for b in mine if (b["start"], b["end"]) == (lo, hi)] == ["cancelled"]
        assert len([m for m in moves(rosa, ten[0]["id"]) if m["kind"] == "booking_debit"]) == 1


def test_wf_dial_claim_touch(browser):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        ade = Api(f.url, ADE)
        st = stations(ade, site(ade, EAST)["id"], "2026-10-24")["Blast Chiller"]
        book(ade, st, "2026-10-24", "08:00", "09:00")
        book(ade, st, "2026-10-24", "20:00", "21:00")
        with ui(browser, f.url + "/book", ROSA, size=PHONE) as page:
            page.get_by_role("radio", name="Blast chillers").check()
            dial = page.get_by_role("group", name="Blast Chiller dial")
            expect(dial).to_have_attribute("aria-busy", "false")
            dial.scroll_into_view_if_needed()
            booked = sector("Booked", "08:00", "09:00")
            expect(dial.get_by_role("img", name=booked)).to_be_visible()
            at = ring(dial, (booked, 480, 540), (sector("Booked", "20:00", "21:00"), 1200, 1260))
            cdp = session(page)
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
            y0 = page.evaluate("scrollY")
            x, y = at(300)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
            for m in range(315, 735, 15):
                x, y = at(m)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
            assert page.evaluate("scrollY") == y0
            expect(dial.get_by_role("img", name=sector("Claim", "05:00", "07:15"))).to_be_attached()
            expect(dial).to_contain_text(re.compile(rf"Pack hours after this claim\s*{re.escape(hh(9.75))}"))
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            expect(dial.get_by_role("img", name=sector("Your hold", "05:00", "07:15"))).to_be_attached()
            assert page.evaluate("scrollY") == y0
            layout(page)
            bs = Api(f.url, ROSA).get("/api/bookings").json()["bookings"]
            assert [(b["start"], b["end"], b["status"]) for b in bs] == [("05:00", "07:15", "held")]


def key_window(page, dial, start_h, hours):
    dial.get_by_role("spinbutton", name="Start time").focus()
    for _ in range(start_h):
        page.keyboard.press("Shift+ArrowUp")
    dial.get_by_role("spinbutton", name="End time").focus()
    for _ in range(hours):
        page.keyboard.press("Shift+ArrowUp")


def test_reduced_motion_hold(browser):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        with ui(browser, f.url + "/book", ROSA) as page:
            page.get_by_role("radio", name="Ovens").check()
            dial = page.get_by_role("group", name=dial_of("Deck Oven 1"))
            expect(dial).to_have_attribute("aria-busy", "false")
            key_window(page, dial, 8, 1)
            dial.get_by_role("button", name="Hold window").click()
            expect(dial.get_by_role("img", name=sector("Your hold", "08:00", "09:00"))).to_be_attached()
            for a in animations(page.get_by_role("list", name="Tickets")):
                assert float(a.get("duration") or 0) + float(a.get("delay") or 0) <= MOTION_MAX_MS
        with ui(browser, f.url + "/book", ROSA, reduced_motion="reduce") as page:
            page.get_by_role("radio", name="Ovens").check()
            dial = page.get_by_role("group", name=dial_of("Convection Oven 2"))
            expect(dial).to_have_attribute("aria-busy", "false")
            key_window(page, dial, 10, 1)
            dial.get_by_role("button", name="Hold window").click()
            hold_img = dial.get_by_role("img", name=sector("Your hold", "10:00", "11:00"))
            expect(hold_img).to_be_attached()
            minutes = HOLD_TTL_S // 60
            expect(dial).to_contain_text(re.compile("|".join(
                re.escape(f"Held · {m} min left") for m in (minutes, minutes + 1))))
            instant(hold_img)
            instant(page.get_by_role("list", name="Tickets"))
            dial.get_by_role("button", name="Confirm booking").click()
            expect(dial).to_contain_text("Confirmed")
            instant(dial)
            instant(page.get_by_role("list", name="Tickets"))


def test_hold_countdown_and_rejection(browser):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        with ui(browser, f.url + "/book", ROSA, browser_time=datetime(2026, 10, 27, 3, tzinfo=timezone.utc)) as page:
            page.get_by_role("radio", name="Ovens").check()
            dial = page.get_by_role("group", name=dial_of("Deck Oven 1"))
            expect(dial).to_have_attribute("aria-busy", "false")
            key_window(page, dial, 10, 1)
            dial.get_by_role("button", name="Hold window").click()
            expect(dial.get_by_role("img", name=sector("Your hold", "10:00", "11:00"))).to_be_attached()
            expect(dial).to_contain_text(re.compile(r"Held · (10:00|9:[0-5]\d) left"))
            advance(page, COUNTDOWN_STEP_MS)
            expect(dial).to_contain_text(re.compile(r"Held · (9:[0-5]\d|8:[0-5]\d) left"))
        with ui(browser, f.url + "/book", HANA) as page:
            select(page.get_by_role("combobox", name="Site"), EAST)
            page.get_by_role("radio", name="Ovens").check()
            dial = page.get_by_role("group", name=dial_of("Convection Oven 2"))
            expect(dial).to_have_attribute("aria-busy", "false")
            key_window(page, dial, 10, 1)
            dial.get_by_role("button", name="Hold window").click()
            day = "2026-10-24"
            expect(status(page, "Booking status")).to_have_text(f"Your certificate of insurance doesn't cover {day}. Upload a current one to book.")
            expect(dial.get_by_role("img", name=sector("Claim", "10:00", "10:00"))).to_be_attached()
        assert Api(f.url, HANA).get("/api/bookings").json()["bookings"] == []


def test_book_rail_latest_wins(browser):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        ade = Api(f.url, ADE)
        st = stations(ade, site(ade, EAST)["id"], "2026-10-26")["Blast Chiller"]
        book(ade, st, "2026-10-26", "12:00", "13:00")
        with ui(browser, f.url + "/book", ROSA) as page:
            page.get_by_role("radio", name="Blast chillers").check()
            dial = page.get_by_role("group", name="Blast Chiller dial")
            expect(dial).to_have_attribute("aria-busy", "false")
            with held(page, "**/availability?date=2026-10-25*") as h:
                page.get_by_role("button", name="Next day").click()
                expect(dial).to_have_attribute("aria-busy", "true")
                with held(page, "**/availability?date=2026-10-26*") as h2:
                    page.get_by_role("button", name="Next day").click()
                    expect(dial).to_have_attribute("aria-busy", "true")
                    h2.release()
                expect(dial.get_by_role("img", name=sector("Booked", "12:00", "13:00"))).to_be_attached()
                expect(dial).to_have_attribute("aria-busy", "false")
                with page.expect_response(lambda r: "date=2026-10-25" in r.url):
                    h.release()
            expect(dial.get_by_role("img", name=sector("Booked", "12:00", "13:00"))).to_be_attached()
            expect(page.get_by_label("Date")).to_have_value("2026-10-26")


def test_dial_reload_keeps_state(browser):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        ade, theo = Api(f.url, ADE), Api(f.url, THEO)
        st = stations(ade, site(ade, EAST)["id"], "2026-10-24")["Blast Chiller"]
        with ui(browser, f.url + "/book", ROSA) as page:
            page.get_by_role("radio", name="Blast chillers").check()
            dial = page.get_by_role("group", name="Blast Chiller dial")
            expect(dial).to_have_attribute("aria-busy", "false")
            s, e = dial.get_by_role("spinbutton", name="Start time"), dial.get_by_role("spinbutton", name="End time")
            s.focus()
            for _ in range(10):
                page.keyboard.press("Shift+ArrowUp")
            e.focus()
            page.keyboard.press("Shift+ArrowUp")
            dial.get_by_role("button", name="Repeat weekly").click()
            weeks = page.get_by_role("dialog", name="Repeat weekly").get_by_role("spinbutton", name="Number of weeks")
            expect(weeks).to_be_focused()
            page.keyboard.press("ArrowUp")
            page.keyboard.press("ArrowUp")
            book(theo, st, "2026-10-24", "18:00", "19:00")
            advance(page, DIAL_RELOAD_MS)
            behind = page.get_by_role("group", name="Blast Chiller dial", include_hidden=True)
            expect(behind.get_by_role("img", name=sector("Booked", "18:00", "19:00"), include_hidden=True)).to_be_attached()
            expect(weeks).to_be_focused()
            assert spin(weeks) == "6"
            page.keyboard.press("Escape")
            expect(dial.get_by_role("button", name="Repeat weekly")).to_be_focused()
            assert (spin(s), spin(e)) == ("10:00", "11:00")
            book(ade, st, "2026-10-24", "10:30", "11:00")
            advance(page, DIAL_RELOAD_MS)
            expect(status(page, "Booking status")).to_have_text("Someone else just claimed that window. Your pack hours are unchanged.")
            assert (spin(s), spin(e)) == ("00:00", "00:00")


def test_wf_hold_contention_parallel():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        rosa, ade, theo = Api(f.url, ROSA), Api(f.url, ADE), Api(f.url, THEO)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-24")
        before = {a: len(ledger(a)["movements"]) for a in (rosa, ade)}
        bc = st["Blast Chiller"]
        rs = together(lambda: hold(rosa, bc, "2026-10-24", "08:00", "09:00"),
                      lambda: hold(ade, bc, "2026-10-24", "08:30", "09:30"),
                      lambda: hold(rosa, bc, "2026-10-24", "09:15", "10:00"))
        wins = [r for r in rs if r.status_code == 201]
        assert len(wins) == 1 and all(r.status_code == 409 and code(r) == "slot_taken" for r in rs if r not in wins)
        assert len(ledger(rosa)["movements"]) + len(ledger(ade)["movements"]) == sum(before.values()) + 1
        names = ["Deck Oven 1", "Convection Oven 2", "Spiral Mixer 60 qt", "Blast Chiller", "Prep Table A"]
        rs = together(*[(lambda n=n: hold(theo, st[n], "2026-10-25", "06:00", "07:30")) for n in names])
        assert sorted(r.status_code for r in rs) == [201, 201, 201, 422, 422]
        assert all(code(r) == "hold_limit" for r in rs if r.status_code == 422)
        led = check_ledger(theo)
        assert led["balances"]["available_hours"] == 1.5 and led["balances"]["committed_hours"] == 4.5


def test_wf_hold_contention_lost_race(browser):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        ade = Api(f.url, ADE)
        st = stations(ade, site(ade, EAST)["id"], "2026-10-24")["Blast Chiller"]
        book(ade, st, "2026-10-24", "08:00", "09:00")
        book(ade, st, "2026-10-24", "20:00", "21:00")
        with ui(browser, f.url + "/book", ROSA) as page:
            page.get_by_role("radio", name="Blast chillers").check()
            dial = page.get_by_role("group", name="Blast Chiller dial")
            expect(dial).to_have_attribute("aria-busy", "false")
            booked = sector("Booked", "08:00", "09:00")
            expect(dial.get_by_role("img", name=booked)).to_be_visible()
            at = ring(dial, (booked, 480, 540), (sector("Booked", "20:00", "21:00"), 1200, 1260))
            page.mouse.move(*at(300))
            page.mouse.down()
            for m in range(315, 375, 15):
                page.mouse.move(*at(m))
            with held(page, "**/api/bookings") as h:
                page.mouse.up()
                assert hold(ade, st, "2026-10-24", "05:00", "06:00").status_code == 201
                h.release()
            expect(status(page, "Booking status")).to_have_text("Someone else just claimed that window. Your pack hours are unchanged.")
            advance(page, MOTION_MAX_MS)
            expect(dial.get_by_role("img", name=sector("Claim", "05:00", "05:00"))).to_be_attached()
            expect(dial).to_contain_text(re.compile(r"Pack hours( after this claim)?\s+12\.00"), use_inner_text=True)
        rosa = Api(f.url, ROSA)
        assert [m["kind"] for m in ledger(rosa)["movements"]] == ["opening_balance"]


def test_hold_replay():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        rosa = Api(f.url, ROSA)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-24")
        k1 = idempotency_key()
        body = ("2026-10-24", "06:00", "07:00")
        first = hold(rosa, st["Deck Oven 1"], *body, key=k1)
        assert first.status_code == 201
        rep = hold(rosa, st["Deck Oven 1"], *body, key=k1)
        assert rep.status_code == 201 and rep.json() == first.json() and rep.headers["idempotent-replay"] == "true"
        r = hold(rosa, st["Deck Oven 1"], "2026-10-24", "06:00", "07:15", key=k1)
        assert r.status_code == 409 and code(r) == "idempotency_conflict"
        assert hold(rosa, st["Convection Oven 2"], *body).status_code == 201
        assert hold(rosa, st["Spiral Mixer 60 qt"], *body).status_code == 201
        assert hold(rosa, st["Deck Oven 1"], *body, key=k1).json() == first.json()
        bid = first.json()["booking"]["id"]
        assert rosa.post(f"/api/bookings/{bid}/cancel").status_code == 200
        assert hold(rosa, st["Deck Oven 1"], *body, key=k1).json() == first.json()
        assert len([m for m in moves(rosa, bid) if m["kind"] == "booking_debit"]) == 1
        k2 = idempotency_key()
        rs = together(*[(lambda: hold(rosa, st["Prep Table A"], *body, key=k2)) for _ in range(5)])
        assert all(r.status_code == 201 or (r.status_code == 409 and code(r) == "idempotency_in_progress") for r in rs)
        made = [b for b in rosa.get("/api/bookings").json()["bookings"] if b["station_id"] == st["Prep Table A"]]
        assert len(made) == 1
        check_ledger(rosa)


def test_hold_expiry():
    with fresh_app(clock="2026-10-23T14:00:00Z", HOLD_TTL_SECONDS=str(SHORT_HOLD_TTL_S)) as f:
        rosa, ade = Api(f.url, ROSA), Api(f.url, ADE)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-24")["Prep Table A"]
        r = hold(rosa, st, "2026-10-24", "10:00", "12:00")
        assert r.status_code == 201 and r.json()["balances"]["available_hours"] == 10
        b = r.json()["booking"]
        wait_server(rosa, b["hold_expires_at"])
        c = rosa.post(f"/api/bookings/{b['id']}/confirm")
        assert c.status_code == 409 and code(c) == "hold_expired"
        assert rosa.get(f"/api/bookings/{b['id']}").json()["booking"]["status"] == "expired"
        ms = moves(rosa, b["id"])
        debit = next(m for m in ms if m["kind"] == "booking_debit")
        rel = [m for m in ms if m["kind"] == "hold_release"]
        assert len(rel) == 1 and rel[0]["actor"] is None and rel[0]["hours"] == 2 and rel[0]["lots"] == debit["lots"]
        led = check_ledger(rosa)
        assert (led["balances"]["available_hours"], led["balances"]["committed_hours"]) == (12, 0)
        assert hold(ade, st, "2026-10-24", "10:00", "12:00").status_code == 201
        assert code(rosa.post(f"/api/bookings/{b['id']}/cancel")) == "invalid_transition"


def test_cancel_precedence_ladder():
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        ade, dana, priya = Api(f.url, ADE), Api(f.url, DANA), Api(f.url, PRIYA)
        bad = "not-a-uuid"
        gone = str(uuid.uuid4())
        sd9 = by_ref(dana, site(dana, EAST)["id"], "2026-11-12", "PL-SD0009")
        reason = f"Mixer order fell through {uuid.uuid4().hex[:6]}"
        assert dana.post(f"/api/bookings/{sd9['id']}/cancel", {"reason": reason}).status_code == 200
        r = dana.post(f"/api/bookings/{sd9['id']}/cancel")
        assert r.status_code == 409 and code(r) == "invalid_transition", r.text
        r = ade.post(f"/api/bookings/{sd9['id']}/cancel", {"reason": reason})
        assert r.status_code == 409 and code(r) == "invalid_transition", r.text
        for who in (gone, bad):
            r = dana.post(f"/api/bookings/{who}/cancel")
            assert r.status_code == 404 and code(r) == "not_found", r.text
        r = priya.post(f"/api/bookings/{bad}/cancel", {"reason": ""})
        assert r.status_code == 403 and code(r) == "forbidden", r.text
        assert ade.get(f"/api/bookings/{sd9['id']}").json()["booking"]["cancellation_reason"] == reason
        check_ledger(ade)


def test_purchase_precedence_ladder():
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        rosa, dana = Api(f.url, ROSA), Api(f.url, DANA)
        bad = "not-a-uuid"
        gone = str(uuid.uuid4())
        packs = {p["name"]: p["id"] for p in rosa.get("/api/packs").json()["packs"]}
        key = idempotency_key()
        first = rosa.post("/api/pack-purchases", {"pack_id": packs["Starter 10"]}, key)
        assert first.status_code == 201, first.text
        for pid in (gone, bad):
            r = rosa.post("/api/pack-purchases", {"pack_id": pid}, key)
            assert r.status_code == 404 and code(r) == "not_found", r.text
        r = rosa.post("/api/pack-purchases", {"pack_id": packs["Production 30"]}, key)
        assert r.status_code == 409 and code(r) == "idempotency_conflict", r.text
        r = rosa.post("/api/pack-purchases", {"pack_id": bad})
        assert r.status_code == 404 and code(r) == "not_found", r.text
        r = dana.post("/api/pack-purchases", {"pack_id": bad})
        assert r.status_code == 403 and code(r) == "forbidden", r.text
        assert rosa.post("/api/pack-purchases", {"pack_id": packs["Starter 10"]}, key).json() == first.json()
        check_ledger(rosa)


def test_visit_precedence_ladder():
    with fresh_app(clock="2026-10-24T11:00:01Z") as f:
        dana, ade = Api(f.url, DANA), Api(f.url, ADE)
        bad = "not-a-uuid"
        gone = str(uuid.uuid4())
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        r = dana.post(f"/api/trucks/{truck}/visits")
        assert r.status_code == 201, r.text
        vid = r.json()["visit"]["id"]
        r = dana.post(f"/api/trucks/{truck}/visits", {"operator_signature": "Theo Mbeki"})
        assert r.status_code == 409 and code(r) == "visit_open", r.text
        ok = {"services": ["potable_water", "grease"], "operator_signature": "Theo Mbeki"}
        assert dana.post(f"/api/visits/{vid}/depart", ok).status_code == 200
        r = dana.post(f"/api/visits/{vid}/depart", {"services": [], "operator_signature": "T"})
        assert r.status_code == 409 and code(r) == "invalid_transition", r.text
        for who in (gone, bad):
            r = dana.post(f"/api/visits/{who}/depart", {"services": [], "operator_signature": "T"})
            assert r.status_code == 404 and code(r) == "not_found", r.text
        r = ade.post(f"/api/visits/{bad}/depart", {"services": []})
        assert r.status_code == 403 and code(r) == "forbidden", r.text


def test_rate_precedence_ladder():
    with fresh_app(clock="2026-11-10T06:00:30Z") as f:
        priya, rosa = Api(f.url, PRIYA), Api(f.url, ROSA)
        bad = "not-a-uuid"
        gone = str(uuid.uuid4())
        high = site(priya, HIGH)
        body = {"effective_from": "2026-11-10", "hourly_rate_cents": 5000, "tax_rate_percent": "8"}
        for who in (gone, bad):
            r = priya.post(f"/api/sites/{who}/rates", dict(body, hourly_rate_cents=0))
            assert r.status_code == 404 and code(r) == "not_found", r.text
        assert priya.post(f"/api/sites/{high['id']}/rates", body).status_code == 201
        r = priya.post(f"/api/sites/{high['id']}/rates", dict(body, hourly_rate_cents=0))
        assert r.status_code == 422 and code(r) == "validation", r.text
        assert "hourly_rate_cents" in r.json()["error"]["fields"]
        r = priya.post(f"/api/sites/{high['id']}/rates", body)
        assert r.status_code == 409 and code(r) == "rate_exists", r.text
        r = rosa.post(f"/api/sites/{bad}/rates", dict(body, hourly_rate_cents=0))
        assert r.status_code == 403 and code(r) == "forbidden", r.text


def test_checkout_precedence_ladder():
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        dana, theo = Api(f.url, DANA), Api(f.url, THEO)
        bad = "not-a-uuid"
        gone = str(uuid.uuid4())
        sd4 = by_ref(dana, site(dana, EAST)["id"], "2026-11-10", "PL-SD0004")
        r = dana.req("POST", f"/api/bookings/{sd4['id']}/check-out", None, idempotency_key())
        assert r.status_code == 200, r.text
        r = dana.req("POST", f"/api/bookings/{sd4['id']}/check-out")
        assert r.status_code == 409 and code(r) == "invalid_transition", r.text
        for who in (gone, bad):
            r = dana.req("POST", f"/api/bookings/{who}/check-out")
            assert r.status_code == 404 and code(r) == "not_found", r.text
        r = theo.req("POST", f"/api/bookings/{bad}/check-out")
        assert r.status_code == 403 and code(r) == "forbidden", r.text
        check_ledger(theo)


def test_hold_rule_order_beats_overlap():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        rosa, theo = Api(f.url, ROSA), Api(f.url, THEO)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-24")
        wide, whole = ("2026-10-24", "06:00", "08:00"), ("2026-10-24", "06:00", "11:00")
        assert hold(rosa, st["Deck Oven 1"], *wide).status_code == 201
        assert hold(rosa, st["Prep Table A"], *whole).status_code == 201
        one = hold(theo, st["Blast Chiller"], *whole)
        assert one.status_code == 201, one.text
        short = one.json()["balances"]
        before = ledger(theo)["movements"]
        r = hold(theo, st["Deck Oven 1"], *wide)
        assert r.status_code == 422 and code(r) == "insufficient_hours", r.text
        assert ledger(theo)["movements"] == before
        bid = one.json()["booking"]["id"]
        assert theo.post(f"/api/bookings/{bid}/cancel").status_code == 200
        for name in ("Convection Oven 2", "Spiral Mixer 60 qt", "Blast Chiller"):
            assert hold(theo, st[name], "2026-10-25", "06:00", "07:00").status_code == 201
        spare = ledger(theo)["balances"]
        assert spare["available_hours"] > short["available_hours"]
        before = ledger(theo)["movements"]
        r = hold(theo, st["Deck Oven 1"], *wide)
        assert r.status_code == 422 and code(r) == "hold_limit", r.text
        r = hold(theo, st["Prep Table A"], *whole)
        assert r.status_code == 422 and code(r) == "hold_limit", r.text
        assert ledger(theo)["movements"] == before
        held = [b for b in theo.get("/api/bookings").json()["bookings"] if b["status"] == "held"]
        assert len(held) == 3
        check_ledger(theo)


def test_refused_hold_frees_its_key():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        rosa, theo = Api(f.url, ROSA), Api(f.url, THEO)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-24")
        wide = ("2026-10-24", "06:00", "08:00")
        first = hold(rosa, st["Deck Oven 1"], *wide)
        assert first.status_code == 201, first.text
        k1 = idempotency_key()
        r = hold(theo, st["Deck Oven 1"], *wide, key=k1)
        assert r.status_code == 409 and code(r) == "slot_taken", r.text
        r = hold(theo, st["Convection Oven 2"], *wide, key=k1)
        assert r.status_code == 201, r.text
        assert r.headers.get("idempotent-replay") in (None, "false")
        k2 = idempotency_key()
        r = hold(theo, st["Deck Oven 1"], *wide, key=k2)
        assert r.status_code == 409 and code(r) == "slot_taken", r.text
        bid = first.json()["booking"]["id"]
        assert rosa.post(f"/api/bookings/{bid}/cancel").status_code == 200
        won = hold(theo, st["Deck Oven 1"], *wide, key=k2)
        assert won.status_code == 201, won.text
        assert won.headers.get("idempotent-replay") in (None, "false")
        rep = hold(theo, st["Deck Oven 1"], *wide, key=k2)
        assert rep.status_code == 201 and rep.json() == won.json()
        assert rep.headers["idempotent-replay"] == "true"
        held = [b for b in theo.get("/api/bookings").json()["bookings"] if b["status"] == "held"]
        assert len(held) == 2
        check_ledger(theo)


def test_hold_expiry_instant():
    with fresh_app(clock="2026-10-23T14:00:00Z", copies=[{}], HOLD_TTL_SECONDS=str(SHORT_HOLD_TTL_S)) as f:
        rosa = Api(f.url, ROSA)
        ade = Api(f.urls[1], ADE)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-24")["Blast Chiller"]
        live = hold(rosa, st, "2026-10-25", "10:00", "11:00").json()["booking"]
        assert rosa.post(f"/api/bookings/{live['id']}/confirm").status_code == 200
        b = hold(rosa, st, "2026-10-24", "10:00", "11:00").json()["booking"]
        exp = ts(b["hold_expires_at"])
        assert abs((exp - ts(b["created_at"])).total_seconds() - SHORT_HOLD_TTL_S) < 2
        r = hold(ade, st, "2026-10-24", "10:00", "11:00")
        assert code(r) == "slot_taken"
        end = time.monotonic() + WAIT_S
        while r.status_code != 201:
            assert time.monotonic() < end
            r = hold(ade, st, "2026-10-24", "10:00", "11:00")
            assert r.status_code in (201, 409), r.text
        assert parsedate_to_datetime(r.headers["Date"]) >= exp.replace(microsecond=0)
        c = rosa.post(f"/api/bookings/{b['id']}/confirm")
        assert c.status_code == 409 and code(c) == "hold_expired"
        assert rosa.get(f"/api/bookings/{b['id']}").json()["booking"]["status"] == "expired"
        ms = moves(rosa, b["id"])
        rel = [m for m in ms if m["kind"] == "hold_release"]
        debit = next(m for m in ms if m["kind"] == "booking_debit")
        assert len(rel) == 1 and rel[0]["actor"] is None and sum(x["hours"] for x in rel[0]["lots"]) == debit["hours"]
        check_ledger(rosa)


def test_cancel_concurrent_transitions(mail):
    mail.clear()
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        theo, dana, rosa = Api(f.url, THEO), Api(f.url, DANA), Api(f.url, ROSA)
        east = site(dana, EAST)
        sd5 = by_ref(dana, east["id"], "2026-11-12", "PL-SD0005")
        rs = together(lambda: theo.post(f"/api/bookings/{sd5['id']}/cancel"),
                      lambda: dana.post(f"/api/bookings/{sd5['id']}/cancel", {"reason": "Kitchen closed for repair"}))
        assert sorted(r.status_code for r in rs) == [200, 409]
        assert code(next(r for r in rs if r.status_code == 409)) == "invalid_transition"
        closing = [m for m in moves(theo, sd5["id"]) if m["kind"] in ("cancel_refund", "forfeit")]
        assert sum(m["hours"] for m in closing) == 4.5
        assert len(mails(mail, lambda m: subject(m) == mail_subject("Booking cancelled", "Prep Table A", "2026-11-12", "10:00", "14:30"))) == 1
        r = dana.post(f"/api/bookings/{sd5['id']}/no-show")
        assert r.status_code == 409 and code(r) == "invalid_transition"
        sd1 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0001")
        assert code(rosa.post(f"/api/bookings/{sd1['id']}/confirm")) == "invalid_transition"
        sd3 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0003")
        assert code(dana.post(f"/api/bookings/{sd3['id']}/check-out", key=idempotency_key())) == "invalid_transition"
        st = stations(rosa, east["id"], "2026-11-14")["Deck Oven 1"]
        h = hold(rosa, st, "2026-11-14", "10:00", "11:00").json()["booking"]
        rs = together(lambda: rosa.post(f"/api/bookings/{h['id']}/confirm"), lambda: rosa.post(f"/api/bookings/{h['id']}/confirm"))
        assert sorted(r.status_code for r in rs) == [200, 409]
        assert by_ref(dana, east["id"], "2026-11-10", "PL-SD0001")["status"] == "confirmed"
        check_ledger(theo)
        check_ledger(rosa)


def test_wf_cancel_and_forfeit_split():
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        rosa, ade, dana = Api(f.url, ROSA), Api(f.url, ADE), Api(f.url, DANA)
        east = site(dana, EAST)
        mine = {b["reference"]: b for b in rosa.get("/api/bookings").json()["bookings"]}
        r = rosa.post(f"/api/bookings/{mine['PL-SD0008']['id']}/cancel")
        assert r.status_code == 200 and set(r.json()) == {"booking", "refunded_hours", "forfeited_hours", "balances"}
        assert (r.json()["refunded_hours"], r.json()["forfeited_hours"]) == (1.75, 0)
        bk = r.json()["booking"]
        assert bk["status"] == "cancelled" and bk["cancelled_by"]["name"] == "Rosa Lindqvist" and bk["cancellation_reason"] is None
        assert [m["kind"] for m in moves(rosa, mine["PL-SD0008"]["id"]) if m["kind"] != "booking_debit"] == ["cancel_refund"]
        theirs = {b["reference"]: b for b in ade.get("/api/bookings").json()["bookings"]}
        r = ade.post(f"/api/bookings/{theirs['PL-SD0009']['id']}/cancel")
        assert (r.json()["refunded_hours"], r.json()["forfeited_hours"]) == (0.75, 1.0)
        r = ade.post(f"/api/bookings/{theirs['PL-SD0002']['id']}/cancel")
        assert (r.json()["refunded_hours"], r.json()["forfeited_hours"]) == (0, 1.0)
        assert [m["kind"] for m in moves(ade, theirs["PL-SD0002"]["id"]) if m["kind"] != "booking_debit"] == ["forfeit"]
        st = stations(rosa, east["id"], "2026-11-20")["Deck Oven 1"]
        h = hold(rosa, st, "2026-11-20", "10:00", "11:00").json()["booking"]
        r = rosa.post(f"/api/bookings/{h['id']}/cancel")
        assert (r.json()["refunded_hours"], r.json()["forfeited_hours"]) == (1.0, 0)
        assert {m["kind"] for m in moves(rosa, h["id"])} == {"booking_debit", "hold_release"}
        assert r.json()["balances"]["available_hours"] == 9
        check_ledger(rosa)
        check_ledger(ade)


def test_paired_ledger():
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        ade = Api(f.url, ADE)
        sd9 = next(b for b in ade.get("/api/bookings").json()["bookings"] if b["reference"] == "PL-SD0009")
        assert ade.post(f"/api/bookings/{sd9['id']}/cancel").status_code == 200
        ms = {m["kind"]: m for m in moves(ade, sd9["id"])}
        assert set(ms) == {"booking_debit", "cancel_refund", "forfeit"}
        assert ms["cancel_refund"]["hours"] + ms["forfeit"]["hours"] == sd9["hours"]
        assert sorted((e["account"], e["hours"]) for e in ms["cancel_refund"]["entries"]) == [("available", 0.75), ("committed", -0.75)]
        assert sorted((e["account"], e["hours"]) for e in ms["forfeit"]["entries"]) == [("committed", -1.0), ("forfeited", 1.0)]
        before = check_ledger(ade)["movements"]
        st = stations(ade, site(ade, EAST)["id"], "2026-11-20")["Prep Table A"]
        book(ade, st, "2026-11-20", "10:00", "11:00")
        after = check_ledger(ade)["movements"]
        assert len(after) == len(before) + 1 and after[1:] == before


def test_wf_cancel_and_forfeit_manager(mail):
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        rosa, ade, dana, priya, luis = (Api(f.url, e) for e in (ROSA, ADE, DANA, PRIYA, LUIS))
        east = site(dana, EAST)
        sd9 = by_ref(dana, east["id"], "2026-11-12", "PL-SD0009")
        reason = f"Mixer order fell through {uuid.uuid4().hex[:6]}"
        r = dana.post(f"/api/bookings/{sd9['id']}/cancel", {"reason": reason})
        assert r.status_code == 200 and set(r.json()) == {"booking", "refunded_hours", "forfeited_hours"}
        assert (r.json()["refunded_hours"], r.json()["forfeited_hours"]) == (0.75, 1.0)
        bk = r.json()["booking"]
        assert bk["cancelled_by"]["name"] == "Dana Okafor" and bk["cancellation_reason"] == reason
        ms = {m["kind"]: m for m in moves(ade, sd9["id"])}
        assert ms["cancel_refund"]["hours"] == 0.75 and ms["forfeit"]["hours"] == 1.0
        assert ms["forfeit"]["actor"]["name"] == "Dana Okafor" and ms["forfeit"]["actor"]["role"] == "kitchen_manager"
        assert code(ade.post(f"/api/bookings/{sd9['id']}/cancel")) == "invalid_transition"
        sd8 = next(b for b in rosa.get("/api/bookings").json()["bookings"] if b["reference"] == "PL-SD0008")
        r = rosa.post(f"/api/bookings/{sd8['id']}/cancel", {"reason": "I am sick"})
        assert r.status_code == 422 and "reason" in r.json()["error"]["fields"]
        assert code(priya.post(f"/api/bookings/{sd8['id']}/cancel", {"reason": "abc"})) == "forbidden"
        assert code(luis.post(f"/api/bookings/{sd8['id']}/cancel", {"reason": "abc"})) == "not_found"
        r = dana.post(f"/api/bookings/{sd8['id']}/cancel")
        assert r.status_code == 422 and "reason" in r.json()["error"]["fields"]
        st = stations(rosa, east["id"], "2026-11-21")["Deck Oven 1"]
        h = hold(rosa, st, "2026-11-21", "10:00", "11:00").json()["booking"]
        assert code(dana.post(f"/api/bookings/{h['id']}/cancel", {"reason": "Not allowed"})) == "invalid_transition"
        wait_server(dana, "2026-11-10T13:45:01Z")
        r = dana.post(f"/api/bookings/{sd8['id']}/cancel", {"reason": "Oven out of service"})
        assert (r.json()["refunded_hours"], r.json()["forfeited_hours"]) == (0.75, 1.0)
        assert r.json()["booking"]["cancelled_by"]["name"] == "Dana Okafor"
        assert {m["actor"]["name"] for m in moves(rosa, sd8["id"]) if m["kind"] != "booking_debit"} == {"Dana Okafor"}
        check_ledger(rosa)
        check_ledger(ade)
        m = mails(mail, lambda m: reason in text(m))
        assert len(m) == 1 and subject(m[0]) == mail_subject("Booking cancelled", "Blast Chiller", "2026-11-12", "08:45", "10:30") and addresses(m[0]["To"]) == [ADE]
        body = text(m[0])
        assert f"Cancelled by {EAST} staff. Reason: {reason}" in body
        assert f"Refunded pack hours: {hh(0.75)}" in body and f"Forfeited pack hours: {hh(1)}" in body and DANA not in body


def test_wf_cancel_and_forfeit_member(browser):
    with fresh_app(clock="2026-11-10T13:44:15Z", seed="site-day") as f:
        rosa, dana = Api(f.url, ROSA), Api(f.url, DANA)
        with ui(browser, f.url + "/book", ROSA) as page:
            tickets = page.get_by_role("list", name="Tickets")
            t8 = tickets.get_by_role("listitem").filter(has_text="PL-SD0008")
            t8.get_by_role("button", name="Cancel booking").click()
            ref = "PL-SD0008"
            dlg = page.get_by_role("dialog", name=f"Cancel booking {ref}")
            advance(page, TICK_MS)
            expect(dlg).to_contain_text(refund_sentence(1.75))
            dlg.get_by_role("button", name="Keep booking").focus()
            wait_server(rosa, "2026-11-10T13:45:01Z")
            advance(page, DIAL_RELOAD_MS)
            until(page, "s => document.body.innerText.includes(s)", "Cancelling now refunds 0.75 pack hours and forfeits 1.00 pack hours.", SENTENCE_MS / 1000 + 30)
            expect(dlg.get_by_role("button", name="Keep booking")).to_be_focused()
            dlg.get_by_role("button", name="Confirm cancellation").click()
            expect(status(page, "Booking status")).to_have_text(f"Booking cancelled. {hh(0.75)} pack hours refunded, {hh(1)} forfeited.")
            expect(t8).to_contain_text("Cancelled")
            expect(t8).to_be_focused()
        sd8 = {m["kind"]: m["hours"] for m in moves(rosa, next(b["id"] for b in rosa.get("/api/bookings").json()["bookings"] if b["reference"] == "PL-SD0008"))}
        assert sd8["cancel_refund"] == 0.75 and sd8["forfeit"] == 1.0
        assert ledger(rosa)["balances"]["available_hours"] == 8


def test_ticket_follows_server(browser):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        rosa, dana = Api(f.url, ROSA), Api(f.url, DANA)
        with ui(browser, f.url + "/book", ROSA) as page:
            tickets = page.get_by_role("list", name="Tickets")
            t1 = tickets.get_by_role("listitem").filter(has_text="PL-SD0001")
            t8 = tickets.get_by_role("listitem").filter(has_text="PL-SD0008")
            expect(t1).to_contain_text("Confirmed")
            sd1 = next(b for b in rosa.get("/api/bookings").json()["bookings"] if b["reference"] == "PL-SD0001")
            assert dana.post(f"/api/bookings/{sd1['id']}/cancel", {"reason": "Oven fault"}).status_code == 200
            t1.get_by_role("button", name="Cancel booking").click()
            with held(page, "**/cancel") as h:
                page.get_by_role("dialog", name=f"Cancel booking {sd1['reference']}").get_by_role("button", name="Confirm cancellation").click()
                expect(status(page, "Booking status")).to_have_text("Cancelling…")
                expect(t1).to_contain_text("Confirmed")
                h.release()
            expect(t1).to_contain_text("Cancelled by Dana Okafor")
            expect(status(page, "Booking status")).to_have_text("This booking changed elsewhere. Its ticket now shows the current state.")
            expect(t1).to_be_focused()
            expect(page.get_by_role("dialog", name=f"Cancel booking {sd1['reference']}")).to_have_count(0)
            expect(t8).to_contain_text("Confirmed")
        closing = [m for m in moves(rosa, sd1["id"]) if m["kind"] != "booking_debit"]
        assert closing and {m["actor"]["name"] for m in closing} == {"Dana Okafor"}


def test_wf_weekly_series_dst():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        rosa, ade, theo = Api(f.url, ROSA), Api(f.url, ADE), Api(f.url, THEO)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-25")
        r = rosa.post("/api/recurring-series", {"station_id": st["Deck Oven 1"], "first_date": "2026-10-25", "start": "01:00", "end": "03:00", "weeks": 4})
        assert r.status_code == 201, r.text
        bs = r.json()["bookings"]
        assert [b["date"] for b in bs] == weekly("2026-10-25", 4)
        assert [b["hours"] for b in bs] == [2, 3, 2, 2] and {b["status"] for b in bs} == {"confirmed"}
        assert {(b["start"], b["end"]) for b in bs} == {("01:00", "03:00")}
        assert (bs[1]["start_at"], bs[1]["end_at"]) == (utc_iso("2026-11-01", "01:00"), utc_iso("2026-11-01", "03:00"))
        assert r.json()["balances"]["available_hours"] == 3
        r = ade.post("/api/recurring-series", {"station_id": st["Spiral Mixer 60 qt"], "first_date": "2026-10-27", "start": "05:00", "end": "09:00", "weeks": 2})
        assert [b["start_at"] for b in r.json()["bookings"]] == [utc_iso(d, "05:00") for d in weekly("2026-10-27", 2)]
        assert [b["hours"] for b in r.json()["bookings"]] == [4, 4]
        check_ledger(rosa)


def test_wf_weekly_series_all_or_nothing():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        rosa, ade, theo = Api(f.url, ROSA), Api(f.url, ADE), Api(f.url, THEO)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-27")
        r = rosa.post("/api/recurring-series", {"station_id": st["Deck Oven 1"], "first_date": "2026-10-27", "start": "05:00", "end": "06:30", "weeks": 6})
        assert r.status_code == 201, r.text
        bs = r.json()["bookings"]
        assert len(bs) == 6 and {b["status"] for b in bs} == {"confirmed"} and {b["series_id"] for b in bs} == {r.json()["series"]["id"]}
        assert r.json()["series"]["weeks"] == 6 and r.json()["balances"]["available_hours"] == 3
        assert len([m for m in ledger(rosa)["movements"] if m["kind"] == "booking_debit"]) == 6
        before = len(ledger(theo)["movements"])
        r = theo.post("/api/recurring-series", {"station_id": st["Deck Oven 1"], "first_date": "2026-11-24", "start": "04:00", "end": "05:00", "weeks": 3})
        assert r.status_code == 409 and code(r) == "series_conflict" and r.json()["error"]["dates"] == weekly("2026-11-24", 2)
        assert theo.get("/api/bookings").json()["bookings"] == [] and len(ledger(theo)["movements"]) == before
        r = theo.post("/api/recurring-series", {"station_id": st["Convection Oven 2"], "first_date": "2026-10-25", "start": "10:00", "end": "11:00", "weeks": 12})
        assert code(r) == "insufficient_hours"
        r = theo.post("/api/recurring-series", {"station_id": st["Convection Oven 2"], "first_date": "2027-01-24", "start": "10:00", "end": "11:00", "weeks": 2})
        assert "first_date" in r.json()["error"]["fields"]
        r = theo.post("/api/recurring-series", {"station_id": st["Convection Oven 2"], "first_date": "2027-01-10", "start": "10:00", "end": "11:00", "weeks": 3})
        assert "weeks" in r.json()["error"]["fields"]
        assert theo.get("/api/bookings").json()["bookings"] == []
        body = {"station_id": st["Prep Table A"], "first_date": "2026-10-25", "start": "12:00", "end": "13:00", "weeks": 2}
        rs = together(lambda: ade.post("/api/recurring-series", body), lambda: theo.post("/api/recurring-series", body))
        assert sorted(x.status_code for x in rs) == [201, 409]
        assert code(next(x for x in rs if x.status_code == 409)) == "series_conflict"
        assert len(ade.get("/api/bookings").json()["bookings"]) + len(theo.get("/api/bookings").json()["bookings"]) == 2
        check_ledger(theo)


def test_insurance_edge():
    with fresh_app(clock="2026-11-08T15:00:00Z", seed="pack-expiry") as f:
        ade, hana = Api(f.url, ADE), Api(f.url, HANA)
        east = site(ade, EAST)
        st = stations(ade, east["id"], "2026-11-10")["Deck Oven 1"]
        ok = hold(ade, st, "2026-11-10", "10:00", "11:00")
        assert ok.status_code == 201
        assert ade.post(f"/api/bookings/{ok.json()['booking']['id']}/confirm").status_code == 200
        r = hold(ade, st, "2026-11-11", "10:00", "11:00")
        assert r.status_code == 422 and code(r) == "certificate_expired"
        n = len(ade.get("/api/bookings").json()["bookings"])
        r = ade.post("/api/recurring-series", {"station_id": st, "first_date": "2026-11-10", "start": "12:00", "end": "13:00", "weeks": 2})
        assert r.status_code == 422 and code(r) == "certificate_expired" and r.json()["error"]["dates"] == weekly("2026-11-10", 2)[1:]
        assert len(ade.get("/api/bookings").json()["bookings"]) == n
        high = site(hana, HIGH)
        hs = stations(hana, high["id"], "2026-11-10")["Rack Oven"]
        r = hana.post("/api/recurring-series", {"station_id": hs, "first_date": "2026-11-10", "start": "10:00", "end": "11:00", "weeks": 2})
        assert r.json()["error"]["dates"] == weekly("2026-11-10", 2)


def test_wf_weekly_series_preview(browser):
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        with ui(browser, f.url + "/book", ROSA) as page:
            page.get_by_role("radio", name="Ovens").check()
            page.get_by_role("button", name="Next day").click()
            expect(page.get_by_label("Date")).to_have_value("2026-10-25")
            dial = page.get_by_role("group", name=dial_of("Deck Oven 1"))
            expect(dial).to_have_attribute("aria-busy", "false")
            dial.get_by_role("spinbutton", name="Start time").focus()
            page.keyboard.press("Shift+ArrowUp")
            dial.get_by_role("spinbutton", name="End time").focus()
            page.keyboard.press("Shift+ArrowUp")
            page.keyboard.press("Shift+ArrowUp")
            dial.get_by_role("button", name="Repeat weekly").click()
            dlg = page.get_by_role("dialog", name="Repeat weekly")
            occ, tot = dlg.get_by_role("list", name="Occurrences").get_by_role("listitem"), dlg.get_by_role("status", name="Series total")
            expect(occ).to_have_text([occ_line(d, "01:00", "03:00", n) for d, n in zip(weekly("2026-10-25", 4), [2, 3, 2, 2])])
            advance(page, TICK_MS)
            expect(tot).to_contain_text("Uses 9.00 pack hours")
            expect(tot).to_contain_text("Pack hours after this series 3.00")
            reqs = []
            page.on("request", lambda r: reqs.append(r.url) if "/api/" in r.url else None)
            for key, expected in [("ArrowDown", None), ("ArrowDown", "Uses 5.00 pack hours"), ("ArrowDown", "Uses 5.00 pack hours")]:
                page.keyboard.press(key)
                advance(page, PREVIEW_MS)
            assert occ.all_inner_texts() == ["2026-10-25 01:00–03:00 · 2.00 h", "2026-11-01 01:00–03:00 · 3.00 h"]
            assert "Pack hours after this series 7.00" in tot.inner_text()
            for _ in range(4):
                page.keyboard.press("ArrowUp")
                advance(page, PREVIEW_MS)
            assert "Uses 13.00 pack hours" in tot.inner_text() and "Not enough pack hours for 6 weeks." in tot.inner_text()
            expect(dlg.get_by_role("button", name="Book series")).to_have_attribute("aria-disabled", "true")
            assert reqs == []
            for _ in range(7):
                page.keyboard.press("ArrowUp")
            advance(page, PREVIEW_MS)
            weeks = dlg.get_by_role("spinbutton", name="Number of weeks")
            expect(weeks).to_be_focused()
            assert spin(weeks) == "12" and occ.count() == 12
            most = 12
            assert f"Not enough pack hours for {most} weeks." in tot.inner_text()
            assert reqs == []


def test_wf_weekly_series_book(browser, mail):
    mail.clear()
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        with ui(browser, f.url + "/book", ROSA) as page:
            page.get_by_role("radio", name="Ovens").check()
            page.get_by_role("button", name="Next day").click()
            expect(page.get_by_label("Date")).to_have_value("2026-10-25")
            dial = page.get_by_role("group", name=dial_of("Deck Oven 1"))
            expect(dial).to_have_attribute("aria-busy", "false")
            key_window(page, dial, 1, 2)
            dial.get_by_role("button", name="Repeat weekly").click()
            dlg = page.get_by_role("dialog", name="Repeat weekly")
            weekday, a, z = "Sunday", "01:00", "03:00"
            expect(dlg).to_contain_text(f"Every {weekday} {a}–{z}")
            expect(dlg.get_by_role("spinbutton", name="Number of weeks")).to_be_focused()
            page.keyboard.press("ArrowUp")
            page.keyboard.press("ArrowDown")
            dlg.get_by_role("button", name="Book series").click()
            expect(dlg).to_have_count(0)
            n = 4
            expect(status(page, "Booking status")).to_have_text(f"Booked {n} weekly slots. {hh(3)} pack hours left.")
            expect(dial.get_by_role("button", name="Repeat weekly")).to_be_focused()
            tickets = page.get_by_role("list", name="Tickets").get_by_role("listitem")
            expect(tickets).to_have_count(4)
            expect(tickets.first).to_contain_text("2026-10-25")
        bs = Api(f.url, ROSA).get("/api/bookings").json()["bookings"]
        assert sorted((b["date"], b["hours"]) for b in bs) == list(zip(weekly("2026-10-25", 4), [2, 3, 2, 2]))
        assert {(b["start"], b["end"], b["status"]) for b in bs} == {("01:00", "03:00", "confirmed")}
        m = mails(mail, lambda m: subject(m) == f"Weekly booking confirmed: {'Deck Oven 1'}, {weekday}s {a}-{z}, {n} weeks")
        assert len(m) == 1 and addresses(m[0]["To"]) == [ROSA]


def test_wf_pack_purchase_atomic(killbill, mail):
    with fresh_app(clock="2026-10-30T15:00:00Z", copies=[{"KILLBILL_URL": "http://127.0.0.1:9"}]) as f:
        rosa = Api(f.url, ROSA)
        down = rosa.at(f.urls[1])
        packs = {p["name"]: p for p in rosa.get("/api/packs").json()["packs"]}
        r = down.post("/api/pack-purchases", {"pack_id": packs["Production 30"]["id"]}, idempotency_key())
        assert r.status_code == 503 and code(r) == "billing_unavailable"
        assert [m["kind"] for m in ledger(rosa)["movements"]] == ["opening_balance"]
        key = idempotency_key()
        p = rosa.post("/api/pack-purchases", {"pack_id": packs["Starter 10"]["id"]}, key)
        assert p.status_code == 201, p.text
        pur = p.json()["purchase"]
        vt = plus_days("2026-10-30", 60)
        assert pur["valid_through"] == vt and pur["hours"] == 10 and pur["price_cents"] == 25000
        acct = killbill.account_by_key(rosa.member_id)
        assert acct and acct.get("name") == "Lindqvist Hearth Bakery" and acct.get("currency") == "USD"
        pay = killbill.payment_by_key(pur["id"])
        assert pay and pay["paymentId"] == pur["killbill_payment_id"]
        assert any(t.get("transactionType") == "PURCHASE" and Decimal(str(t["amount"])) == Decimal("250") for t in pay["transactions"])
        credit = [m for m in ledger(rosa)["movements"] if m["kind"] == "pack_purchase"]
        assert len(credit) == 1 and credit[0]["purchase_id"] == pur["id"] and credit[0]["hours"] == 10 and credit[0]["actor"]["name"] == "Rosa Lindqvist"
        rec = mails(mail, lambda m: pur["id"] in text(m))
        assert len(rec) == 1 and f"Valid through {vt}" in text(rec[0]) and f"${money(25000)}" in text(rec[0])
        lots = p.json()["balances"]["lots"]
        assert [(x["pack_name"], x["hours"], x["valid_through"], x["expiring_soon"]) for x in lots] == [("Starter 10", 10, vt, False), ("Opening balance", 12, None, False)]
        check_ledger(rosa)


def test_wf_pack_purchase_replay(killbill):
    with fresh_app(clock="2026-10-30T15:00:00Z", copies=[{"KILLBILL_URL": "http://127.0.0.1:9"}]) as f:
        rosa = Api(f.url, ROSA)
        down = rosa.at(f.urls[1])
        packs = {p["name"]: p for p in rosa.get("/api/packs").json()["packs"]}
        acct = killbill.account_by_key(rosa.member_id)
        before = len(killbill.payments(acct["accountId"])) if acct else 0
        key = idempotency_key()
        p = rosa.post("/api/pack-purchases", {"pack_id": packs["Starter 10"]["id"]}, key)
        assert p.status_code == 201, p.text
        for api in (rosa, down):
            rep = api.post("/api/pack-purchases", {"pack_id": packs["Starter 10"]["id"]}, key)
            assert rep.status_code == 201 and rep.json() == p.json() and rep.headers["idempotent-replay"] == "true"
        r = rosa.post("/api/pack-purchases", {"pack_id": packs["Production 30"]["id"]}, key)
        assert r.status_code == 409 and code(r) == "idempotency_conflict"
        acct = killbill.account_by_key(rosa.member_id)
        assert len(killbill.payments(acct["accountId"])) == before + 1
        assert len([m for m in ledger(rosa)["movements"] if m["kind"] == "pack_purchase"]) == 1
        assert ledger(rosa)["balances"]["available_hours"] == 22


def test_lot_drawing_order():
    with fresh_app(clock="2026-11-08T15:00:00Z", seed="pack-expiry") as f:
        rosa = Api(f.url, ROSA)
        lots = ledger(rosa)["balances"]["lots"]
        starter = lots[0]["purchase_id"]
        assert [(x["pack_name"], x["hours"]) for x in lots] == [("Starter 10", 8), ("Opening balance", 12)] and starter
        st = stations(rosa, site(rosa, EAST)["id"], "2026-11-10")["Deck Oven 1"]
        r = hold(rosa, st, "2026-11-10", "06:00", "16:00")
        assert r.status_code == 201, r.text
        b = r.json()["booking"]
        assert [(x["pack_name"], x["hours"]) for x in r.json()["balances"]["lots"]] == [("Opening balance", 10)]
        debit = next(m for m in moves(rosa, b["id"]) if m["kind"] == "booking_debit")
        assert debit["lots"] == [{"purchase_id": starter, "hours": 8}, {"purchase_id": None, "hours": 2}]
        r = rosa.post(f"/api/bookings/{b['id']}/cancel")
        assert [(x["pack_name"], x["hours"]) for x in r.json()["balances"]["lots"]] == [("Starter 10", 8), ("Opening balance", 12)]
        rel = next(m for m in moves(rosa, b["id"]) if m["kind"] == "hold_release")
        assert rel["lots"] == [{"purchase_id": None, "hours": 2}, {"purchase_id": starter, "hours": 8}]
        check_ledger(rosa)


def test_pack_expiry():
    with fresh_app(clock="2026-11-11T04:59:20Z", seed="pack-expiry", copies=[{}]) as f:
        rosa = Api(f.url, ROSA)
        other = rosa.at(f.urls[1])
        b = ledger(rosa)["balances"]
        assert [(x["pack_name"], x["hours"], x["valid_through"], x["expiring_soon"]) for x in b["lots"]] == [("Starter 10", 8, "2026-11-10", True), ("Opening balance", 12, None, False)]
        assert (b["available_hours"], b["committed_hours"]) == (20, 2)
        wait_server(rosa, "2026-11-11T05:00:01Z")
        la, lb = ledger(other), ledger(rosa)
        for led in (la, lb):
            exp = [m for m in led["movements"] if m["kind"] == "pack_expiry"]
            assert len(exp) == 1 and exp[0]["hours"] == 8 and exp[0]["actor"] is None
            assert led["balances"]["available_hours"] == 12 and [x["pack_name"] for x in led["balances"]["lots"]] == ["Opening balance"]
        pe1 = next(x for x in rosa.get("/api/bookings").json()["bookings"] if x["reference"] == "PL-PE0001")
        r = rosa.post(f"/api/bookings/{pe1['id']}/cancel")
        assert r.json()["refunded_hours"] == 2
        assert (r.json()["balances"]["available_hours"], r.json()["balances"]["committed_hours"]) == (12, 0)
        assert len([m for m in ledger(rosa)["movements"] if m["kind"] == "pack_expiry"]) == 2
        pack = next(p for p in rosa.get("/api/packs").json()["packs"] if p["name"] == "Production 30")
        r = rosa.post("/api/pack-purchases", {"pack_id": pack["id"]}, idempotency_key())
        assert r.json()["balances"]["available_hours"] == 42 and r.json()["purchase"]["valid_through"] == plus_days("2026-11-11", 60)
        check_ledger(rosa)


def test_wf_pack_purchase_ui(browser, killbill):
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        rosa = Api(f.url, ROSA)
        with ui(browser, f.url + "/packs", ROSA) as page:
            see(page, "Available pack hours 12.00")
            page.get_by_role("button", name="Buy Production 30").click()
            dlg = page.get_by_role("dialog", name="Buy Production 30")
            dlg.get_by_role("button", name="Pay and add hours").click()
            vt = plus_days("2026-10-30", 60)
            expect(status(page, "Pack status")).to_have_text(f"Added {hh(30)} pack hours, valid through {vt}. A receipt is on its way to {ROSA}.")
            expect(dlg).to_have_count(0)
            see(page, "Available pack hours 42.00")
            lines = page.get_by_role("list", name="Pack hours by expiry").get_by_role("listitem")
            expect(lines).to_contain_text([f"Production 30: {hh(30)} h, valid through {vt}", f"Opening balance: {hh(12)} h, no expiry"])
            first = page.get_by_role("table", name="Hour ledger").get_by_role("row").nth(1)
            expect(first).to_contain_text("Pack purchase")
            expect(first).to_contain_text("Rosa Lindqvist")
        purchase = next(m for m in ledger(rosa)["movements"] if m["kind"] == "pack_purchase")
        pay_rec = killbill.payment_by_key(purchase["purchase_id"])
        assert pay_rec and any(t.get("transactionType") == "PURCHASE" and Decimal(str(t["amount"])) == Decimal("660") for t in pay_rec["transactions"])


def test_packs_server_expiry(browser):
    with fresh_app(clock="2026-11-11T04:58:30Z", seed="pack-expiry") as f:
        rosa = Api(f.url, ROSA)
        with ui(browser, f.url + "/packs", ROSA, browser_time=datetime(2026, 11, 13, 12, tzinfo=timezone.utc)) as page:
            lines = page.get_by_role("list", name="Pack hours by expiry").get_by_role("listitem")
            starter = lines.filter(has_text="Starter 10: 8.00 h, valid through 2026-11-10")
            opening = lines.filter(has_text=f"Opening balance: {hh(12)} h, no expiry")
            expect(starter.get_by_role("img", name="Expiring soon")).to_have_count(1)
            expect(opening.get_by_role("img", name="Expiring soon")).to_have_count(0)
            see(page, "Available pack hours 20.00")
            with page.expect_response(lambda r: "/api/me/ledger" in r.url, timeout=RESPONSE_WAIT_MS):
                advance(page, PACKS_REFRESH_MS)
            assert server_now(rosa) < ts("2026-11-11T05:00:00.000Z")
            expect(starter).to_have_count(1)
            wait_server(rosa, "2026-11-11T05:00:01Z")
            until(page, "() => !document.body.innerText.includes('Starter 10: 8.00 h')", None, PACKS_REFRESH_MS / 1000 + 30)
            see(page, "Available pack hours 12.00")
            first = page.get_by_role("table", name="Hour ledger").get_by_role("row").nth(1)
            expect(first).to_contain_text("Pack hours expired")
            expect(first).to_contain_text("Pilotlight")
            expect(opening.get_by_role("img", name="Expiring soon")).to_have_count(0)


def test_buy_dialog_survives_refresh(browser, killbill):
    with fresh_app(clock="2026-11-11T04:59:20Z", seed="pack-expiry") as f:
        rosa = Api(f.url, ROSA)
        with ui(browser, f.url + "/packs", ROSA, browser_time=datetime(2026, 11, 13, 12, tzinfo=timezone.utc)) as page:
            lines = page.get_by_role("list", name="Pack hours by expiry").get_by_role("listitem")
            expect(lines.filter(has_text="Starter 10: 8.00 h, valid through 2026-11-10")).to_have_count(1)
            see(page, "Available pack hours 20.00")
            page.get_by_role("button", name="Buy Production 30").click()
            dlg = page.get_by_role("dialog", name="Buy Production 30")
            pay = dlg.get_by_role("button", name="Pay and add hours")
            with held(page, "**/api/pack-purchases") as h:
                pay.click()
                charging = f"Charging ${money(66000)}…"
                expect(status(page, "Pack status")).to_have_text(charging)
                expect(pay).to_have_attribute("aria-disabled", "true")
                expect(pay).to_be_focused()
                wait_server(rosa, "2026-11-11T05:00:01Z")
                until(page, "() => !document.body.innerText.includes('Starter 10: 8.00 h')", None, PACKS_REFRESH_MS / 1000 + 30)
                see(page, "Available pack hours 12.00")
                first = page.get_by_role("table", name="Hour ledger").get_by_role("row").nth(1)
                expect(first).to_contain_text("Pack hours expired")
                expect(first).to_contain_text("Pilotlight")
                expect(dlg).to_be_visible()
                expect(pay).to_be_focused()
                expect(pay).to_have_attribute("aria-disabled", "true")
                expect(status(page, "Pack status")).to_have_text(charging)
                h.release()
            vt = plus_days("2026-11-11", 60)
            expect(status(page, "Pack status")).to_have_text(f"Added {hh(30)} pack hours, valid through {vt}. A receipt is on its way to {ROSA}.")
            see(page, "Available pack hours 42.00")
            expect(lines.filter(has_text=f"Production 30: {hh(30)} h, valid through {vt}")).to_have_count(1)
            expect(page.get_by_role("table", name="Hour ledger").get_by_role("row").nth(1)).to_contain_text("Pack purchase")
        purchases = [m for m in ledger(rosa)["movements"] if m["kind"] == "pack_purchase"]
        assert len(purchases) == 2
        pay_rec = killbill.payment_by_key(next(m for m in purchases if m["hours"] == 30)["purchase_id"])
        assert pay_rec and any(t.get("transactionType") == "PURCHASE" for t in pay_rec["transactions"])


def test_upload_limits():
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        rosa = Api(f.url, ROSA)
        for data, ctype in [(PDF, "application/pdf"), (PNG, "image/png"), (JPEG, "image/jpeg")]:
            r = upload(rosa, data, ctype)
            assert r.status_code == 201 and r.json()["document"]["content_type"] == ctype, r.text
        big = b"%PDF-" + b"\x00" * (FILE_LIMIT - 4)
        assert upload(rosa, big[:FILE_LIMIT], "application/pdf").status_code == 201
        docs = rosa.get("/api/documents").json()["documents"]
        r = upload(rosa, b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml")
        assert r.status_code == 415 and code(r) == "unsupported_type"
        r = upload(rosa, big, "application/pdf")
        assert r.status_code == 413 and code(r) == "file_too_large"
        r = upload(rosa, b"", "application/pdf")
        assert r.status_code == 422 and "file" in r.json()["error"]["fields"]
        r = upload(rosa, PDF, "application/pdf", t="certificate_of_insurance", extra={"per_occurrence_limit": "999999", "names_additional_insured": "true"})
        assert r.status_code == 422 and "per_occurrence_limit" in r.json()["error"]["fields"]
        assert rosa.get("/api/documents").json()["documents"] == docs


def test_verified_upload_content():
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        rosa = Api(f.url, ROSA)
        s3, prefix = S3(), doc_prefix(rosa)
        before = set(s3.keys(prefix))
        svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
        gif = b"GIF89a" + bytes(16)
        for data, ctype in [(PDF, "image/png"), (PNG, "application/pdf"), (JPEG, "image/png"), (svg, "image/png"), (gif, "image/jpeg")]:
            r = upload(rosa, data, ctype)
            assert r.status_code == 415 and code(r) == "unsupported_type", ctype
        assert set(s3.keys(prefix)) == before and rosa.get("/api/documents").json()["documents"] == []
        made = {}
        for name, want in [("../../etc/passwd", "passwd"), ("my scan (1).pdf", "my_scan__1_.pdf"), ("a" * 300, "a" * 120)]:
            d = upload(rosa, PDF, "application/pdf", name).json()["document"]
            assert d["file_name"] == want
            made[d["id"]] = d
        assert set(s3.keys(prefix)) - before == {prefix + i for i in made}
        assert all(s3.get(prefix + i) == PDF for i in made)
        assert not [k for k in s3.keys("documents/") if "passwd" in k or "my_scan" in k]


def test_documents_stored_as_submitted():
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        rosa, dana = Api(f.url, ROSA), Api(f.url, DANA)
        s3, prefix = S3(), doc_prefix(rosa)
        r = upload(rosa, PDF, "application/pdf", t="certificate_of_insurance", extra=COI)
        assert r.status_code == 201, r.text
        d = r.json()["document"]
        assert d["sha256"] == hashlib.sha256(PDF).hexdigest() and d["size_bytes"] == len(PDF) and d["status"] == "pending"
        assert s3.get(prefix + d["id"]) == PDF
        dl = rosa.get(f"/api/documents/{d['id']}/file")
        assert dl.content == PDF and dl.headers["etag"] == f'"{d["sha256"]}"' and int(dl.headers["content-length"]) == len(PDF)
        assert dl.headers["content-type"].startswith("application/pdf") and dl.headers["cache-control"] == "private, no-store"
        assert dl.headers["content-disposition"] == f'attachment; filename="{SCAN_NAME}"'
        assert dana.post(f"/api/documents/{d['id']}/reject", {"reason": "Wrong insured name"}).json()["document"]["status"] == "rejected"
        for api in (rosa, dana):
            again = api.get(f"/api/documents/{d['id']}/file")
            assert again.content == PDF and again.headers["etag"] == f'"{d["sha256"]}"'
        assert rosa.get(f"/api/documents/{d['id']}").json()["document"]["sha256"] == d["sha256"]
        assert s3.get(prefix + d["id"]) == PDF
        p = upload(rosa, PNG, "image/png").json()["document"]
        assert p["sha256"] == hashlib.sha256(PNG).hexdigest() and rosa.get(f"/api/documents/{p['id']}/file").content == PNG


def test_document_and_object_together():
    with fresh_app(clock="2026-10-30T15:00:00Z", copies=[{"S3_ENDPOINT": "http://127.0.0.1:9"}]) as f:
        rosa, dana = Api(f.url, ROSA), Api(f.url, DANA)
        s3, prefix = S3(), doc_prefix(rosa)
        before = set(s3.keys(prefix))
        a = upload(rosa, PDF, "application/pdf").json()["document"]
        b = upload(rosa, PNG, "image/png").json()["document"]
        assert dana.post(f"/api/documents/{a['id']}/verify").status_code == 200
        assert dana.post(f"/api/documents/{b['id']}/reject", {"reason": "Unreadable scan"}).status_code == 200
        c = upload(rosa, JPEG, "image/jpeg").json()["document"]
        assert (s3.get(prefix + a["id"]), s3.get(prefix + b["id"]), s3.get(prefix + c["id"])) == (PDF, PNG, JPEG)
        ids = {x["id"] for x in rosa.get("/api/documents").json()["documents"]}
        assert ids == {a["id"], b["id"], c["id"]} and set(s3.keys(prefix)) - before == {prefix + i for i in ids}
        r = rosa.at(f.urls[1]).post("/api/documents", files={"file": ("x.pdf", PDF, "application/pdf")}, data={"type": "business_licence", "expiry_date": "2027-05-01"})
        assert r.status_code == 503 and code(r) == "storage_unavailable"
        assert {x["id"] for x in rosa.get("/api/documents").json()["documents"]} == ids
        assert set(s3.keys(prefix)) - before == {prefix + i for i in ids}


def test_own_records_only():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        rosa, ade, theo = Api(f.url, ROSA), Api(f.url, ADE), Api(f.url, THEO)
        d = upload(rosa, PDF, "application/pdf").json()["document"]
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-24")["Deck Oven 1"]
        b = hold(rosa, st, "2026-10-24", "10:00", "11:00").json()["booking"]
        truck = theo.me["member"]["truck"]["id"]
        for tpl, own, rid in [("/api/documents/{}", rosa, d["id"]), ("/api/documents/{}/file", rosa, d["id"]), ("/api/bookings/{}", rosa, b["id"]), ("/api/trucks/{}/visits", theo, truck)]:
            assert own.get(tpl.format(rid)).status_code == 200
            r, unknown = ade.get(tpl.format(rid)), ade.get(tpl.format(uuid.uuid4()))
            assert r.status_code == unknown.status_code == 404 and r.json() == unknown.json()
        assert code(ade.post(f"/api/bookings/{b['id']}/cancel")) == "not_found"
        assert d["id"] not in {x["id"] for x in ade.get("/api/documents").json()["documents"]}
        assert b["id"] not in {x["id"] for x in ade.get("/api/bookings").json()["bookings"]}
        assert rosa.get(f"/api/bookings/{b['id']}").json()["booking"]["status"] == "held"


def test_document_review():
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        hana, luis, dana = Api(f.url, HANA), Api(f.url, LUIS), Api(f.url, DANA)
        up = lambda t, exp, extra: hana.post("/api/documents", files={"file": ("c.pdf", PDF, "application/pdf")}, data={"type": t, "expiry_date": exp, **extra})
        coi = {"per_occurrence_limit": "1000000", "names_additional_insured": "true"}
        d = up("certificate_of_insurance", COI_UNTIL, coi).json()["document"]
        q = luis.get("/api/documents", params={"status": "pending"}).json()["documents"]
        assert [x["business_name"] for x in q if x["id"] == d["id"]] == ["Sato Patisserie"]
        assert d["id"] not in {x["id"] for x in dana.get("/api/documents").json()["documents"]}
        assert code(dana.post(f"/api/documents/{d['id']}/verify")) == "not_found"
        hs = stations(hana, site(hana, HIGH)["id"], "2026-11-02")["Rack Oven"]
        assert code(hold(hana, hs, "2026-11-02", "10:00", "11:00")) == "certificate_expired"
        r = luis.post(f"/api/documents/{d['id']}/verify")
        assert r.status_code == 200 and r.json()["valid_through"] == COI_UNTIL and r.json()["document"]["status"] == "verified"
        assert hana.get("/api/me").json()["member"]["valid_through"]["certificate_of_insurance"] == COI_UNTIL
        assert hold(hana, hs, "2026-11-02", "10:00", "11:00").status_code == 201
        assert code(luis.post(f"/api/documents/{d['id']}/verify")) == "invalid_transition"
        assert code(luis.post(f"/api/documents/{d['id']}/reject", {"reason": "x"})) == "invalid_transition"
        old = up("certificate_of_insurance", "2026-10-29", coi).json()["document"]
        assert code(luis.post(f"/api/documents/{old['id']}/verify")) == "document_expired"
        assert "reason" in luis.post(f"/api/documents/{old['id']}/reject", {"reason": "ab"}).json()["error"]["fields"]
        why = "Expired certificate"
        r = luis.post(f"/api/documents/{old['id']}/reject", {"reason": why})
        assert r.json()["document"]["status"] == "rejected" and r.json()["document"]["rejection_reason"] == why
        fh = up("food_handler_certificate", "2026-12-01", {}).json()["document"]
        luis.post(f"/api/documents/{fh['id']}/verify")
        assert hana.get("/api/me").json()["member"]["valid_through"]["food_handler_certificate"] == "2027-03-31"


def test_expiry_notices(mail):
    mail.clear()
    subj = "Certificate of insurance expires 2026-11-10 (3-day notice)"
    with fresh_app(clock="2026-11-08T12:00:00Z", seed="pack-expiry", copies=[{}]):
        found = mails(mail, lambda m: subject(m) == subj, wait=SCAN_S + MAIL_S + 5)
        assert len(found) == 1 and addresses(found[0]["To"]) == [ADE]
        later = [m for m in mail.messages(0, settle=NOTICE_SCAN_S + MAIL_S) if ADE in addresses(m["To"]) and "notice)" in subject(m)]
        assert len(later) == 1


def test_wf_compliance_documents_ui(browser):
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        with ui(browser, f.url + "/documents", HANA) as page:
            select(page.get_by_role("combobox", name="Document type"), "Certificate of insurance")
            page.get_by_label("Expiry date").fill(COI_UNTIL)
            page.get_by_role("textbox", name="Coverage per occurrence (USD)").fill("1000000")
            page.get_by_role("checkbox", name=f"Names {LEGAL} as additional insured").check()
            page.get_by_label("File").set_input_files(files=[{"name": "coi.pdf", "mimeType": "application/pdf", "buffer": PDF}])
            table = page.get_by_role("table", name="Your documents")
            with held(page, "**/api/documents") as h:
                page.get_by_role("button", name="Upload document").click()
                expect(status(page, "Document status")).to_have_text("Uploading…")
                expect(table.get_by_role("row").filter(has_text="Pending review")).to_have_count(0)
                h.release()
            expect(table.get_by_role("row").filter(has_text="Pending review")).to_have_count(1)
            expect(status(page, "Document status")).to_have_text(f"Uploaded {COI_LABEL}. It is waiting for review.")
            with ui(browser, f.url + "/compliance", LUIS) as mgr:
                row = mgr.get_by_role("table", name="Documents awaiting review").get_by_role("row").filter(has_text="Sato Patisserie")
                with mgr.expect_download() as dl:
                    row.get_by_role("link", name="Open file").click()
                assert Path(dl.value.path()).read_bytes() == PDF
                row.get_by_role("button", name="Verify").click()
                expect(status(mgr, "Compliance status")).to_have_text(f"Verified. {HANA_BIZ} is covered through {COI_UNTIL}.")
            page.reload()
            expect(page.get_by_role("list", name="Coverage")).to_contain_text(f"{COI_LABEL}: valid through {COI_UNTIL}")
        assert Api(f.url, HANA).get("/api/me").json()["member"]["valid_through"]["certificate_of_insurance"] == COI_UNTIL


def test_wf_compliance_documents_outage(browser):
    down = os.environ["APP_MINIO_DOWN_URL"]
    rosa = Api(down, ROSA)
    before = rosa.get("/api/documents").json()["documents"]
    prefix = f"documents/{rosa.me['user']['tenant']['id']}/{rosa.member_id}/"
    keys = S3().keys(prefix)
    with ui(browser, down + "/documents", ROSA) as page:
        select(page.get_by_role("combobox", name="Document type"), "Food handler certificate")
        page.get_by_label("Expiry date").fill("2027-04-30")
        page.get_by_label("File").set_input_files(files=[{"name": "fh.pdf", "mimeType": "application/pdf", "buffer": PDF}])
        rows = page.get_by_role("table", name="Your documents").get_by_role("row").count()
        page.get_by_role("button", name="Upload document").click()
        expect(status(page, "Document status")).to_have_text("Document storage is unreachable. Nothing was uploaded; try again shortly.")
        assert page.get_by_role("table", name="Your documents").get_by_role("row").count() == rows
        assert page.get_by_label("File").evaluate("e => e.files.length") == 1
        expect(page.get_by_label("Expiry date")).to_have_value("2027-04-30")
    assert rosa.get("/api/documents").json()["documents"] == before and S3().keys(prefix) == keys


def test_check_in_window():
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        dana, luis, ade, rosa = Api(f.url, DANA), Api(f.url, LUIS), Api(f.url, ADE), Api(f.url, ROSA)
        east, high = site(dana, EAST), site(luis, HIGH)
        b = lambda ref: by_ref(dana, east["id"], "2026-11-10", ref)
        sd7 = by_ref(luis, high["id"], "2026-11-10", "PL-SD0007")
        assert code(dana.post(f"/api/bookings/{b('PL-SD0001')['id']}/check-in")) == "too_early"
        assert code(luis.post(f"/api/bookings/{sd7['id']}/check-in")) == "too_early"
        assert b("PL-SD0001")["status"] == "confirmed"
        wait_server(dana, "2026-11-10T13:45:01Z")
        r = dana.post(f"/api/bookings/{b('PL-SD0001')['id']}/check-in")
        assert r.status_code == 200 and r.json()["booking"]["status"] == "checked_in" and r.json()["booking"]["checked_in_by"]["name"] == "Dana Okafor"
        r = luis.post(f"/api/bookings/{sd7['id']}/check-in")
        assert r.status_code == 422 and code(r) == "certificate_expired"
        assert code(dana.post(f"/api/bookings/{b('PL-SD0003')['id']}/check-in")) == "too_late"
        assert b("PL-SD0003")["status"] == "confirmed" and by_ref(luis, high["id"], "2026-11-10", "PL-SD0007")["status"] == "confirmed"


def test_no_show_marking():
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        dana, ade = Api(f.url, DANA), Api(f.url, ADE)
        east = site(dana, EAST)
        sd2 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0002")
        r = dana.post(f"/api/bookings/{sd2['id']}/no-show")
        assert r.status_code == 409 and code(r) == "too_early"
        assert [m["kind"] for m in moves(ade, sd2["id"])] == ["booking_debit"]
        wait_server(dana, "2026-11-10T13:45:01Z")
        r = dana.post(f"/api/bookings/{sd2['id']}/no-show")
        assert r.status_code == 200 and r.json()["booking"]["status"] == "no_show"
        fm = [m for m in moves(ade, sd2["id"]) if m["kind"] == "forfeit"]
        assert len(fm) == 1 and fm[0]["hours"] == 1
        assert ledger(ade)["balances"]["committed_hours"] == 2.75
        sd3 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0003")
        assert dana.post(f"/api/bookings/{sd3['id']}/no-show").status_code == 200
        assert ledger(ade)["balances"]["committed_hours"] == 1.75
        check_ledger(ade)


def test_attributed_movements():
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        dana, ade, rosa, theo = Api(f.url, DANA), Api(f.url, ADE), Api(f.url, ROSA), Api(f.url, THEO)
        east = site(dana, EAST)
        b = lambda ref, d="2026-11-10": by_ref(dana, east["id"], d, ref)
        assert all(m["actor"] is None for m in ledger(rosa)["movements"] if m["kind"] == "opening_balance")
        wait_server(dana, "2026-11-10T13:45:01Z")
        sd1 = dana.post(f"/api/bookings/{b('PL-SD0001')['id']}/check-in").json()["booking"]
        assert sd1["checked_in_by"]["name"] == "Dana Okafor"
        sd2 = dana.post(f"/api/bookings/{b('PL-SD0002')['id']}/no-show").json()["booking"]
        assert sd2["no_show_by"]["name"] == "Dana Okafor"
        sd5 = theo.post(f"/api/bookings/{b('PL-SD0005', '2026-11-12')['id']}/cancel").json()["booking"]
        assert sd5["cancelled_by"]["name"] == "Theo Mbeki"
        assert {(m["actor"]["name"], m["actor"]["role"]) for m in moves(theo, sd5["id"]) if m["kind"] != "booking_debit"} == {("Theo Mbeki", "member")}
        forfeit = next(m for m in moves(ade, sd2["id"]) if m["kind"] == "forfeit")
        assert (forfeit["actor"]["name"], forfeit["actor"]["role"]) == ("Dana Okafor", "kitchen_manager")
        out = dana.post(f"/api/bookings/{sd1['id']}/check-out", key=idempotency_key()).json()["booking"]
        assert out["checked_out_by"]["name"] == "Dana Okafor" and out["checked_in_by"] == sd1["checked_in_by"]
        assert next(m for m in moves(rosa, sd1["id"]) if m["kind"] == "usage")["actor"]["name"] == "Dana Okafor"
        assert next(m for m in moves(rosa, sd1["id"]) if m["kind"] == "booking_debit")["actor"]["name"] == "Rosa Lindqvist"
        assert b("PL-SD0002")["no_show_by"] == sd2["no_show_by"]
        assert next(m for m in moves(ade, sd2["id"]) if m["kind"] == "forfeit") == forfeit


def test_manager_site_scope():
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        dana, luis = Api(f.url, DANA), Api(f.url, LUIS)
        east = site(dana, EAST)
        assert [s["name"] for s in dana.get("/api/sites").json()["sites"]] == [EAST]
        sd1 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0001")
        unknown = luis.get(f"/api/bookings/{uuid.uuid4()}")
        assert luis.get(f"/api/bookings/{sd1['id']}").json() == unknown.json() and unknown.status_code == 404
        assert code(luis.post(f"/api/bookings/{sd1['id']}/check-in")) == "not_found"
        assert code(luis.get(f"/api/sites/{east['id']}/bookings", params={"date": "2026-11-10"})) == "not_found"
        assert luis.get("/api/members", params={"q": "Lindqvist"}).json()["members"] == []
        assert dana.get("/api/members", params={"q": "Sato"}).json()["members"] == []
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        assert code(luis.get(f"/api/trucks/{truck}/visits")) == "not_found"
        assert code(luis.post(f"/api/trucks/{truck}/visits")) == "not_found"


def test_wf_site_day_operations_board(browser):
    with fresh_app(clock="2026-11-10T13:44:30Z", seed="site-day") as f:
        dana, ade = Api(f.url, DANA), Api(f.url, ADE)
        wait_server(dana, "2026-11-10T13:45:01Z")
        with ui(browser, f.url + "/site", DANA) as page:
            rows = page.get_by_role("table", name="Bookings").get_by_role("row")
            r1, r2 = rows.filter(has_text="Deck Oven 1"), rows.filter(has_text="Spiral Mixer 60 qt")
            expect(r1.get_by_role("button")).to_have_text(["Check in", "Mark no-show", "Cancel booking"])
            expect(rows.filter(has_text="Blast Chiller").get_by_role("button")).to_have_text(["Check out"])
            r1.get_by_role("button", name="Check in").click()
            expect(status(page, "Site day status")).to_have_text("Checked in Lindqvist Hearth Bakery on Deck Oven 1.")
            expect(r1).to_contain_text("Checked in")
            expect(r1.get_by_role("button")).to_have_text(["Check out"])
            advance(page, SITE_RELOAD_MS)
            expect(status(page, "Site day status")).to_have_text("Checked in Lindqvist Hearth Bakery on Deck Oven 1.")
            r2.get_by_role("button", name="Mark no-show").click()
            biz = "Okonjo Small Batch"
            noshow = f"Marked {biz} as a no-show. {hh(1)} pack hours forfeited."
            expect(status(page, "Site day status")).to_have_text(noshow)
            expect(r2).to_contain_text("No-show")
            expect(r2.get_by_role("button")).to_have_count(0)
            advance(page, SITE_RELOAD_MS)
            expect(status(page, "Site day status")).to_have_text(noshow)
            expect(r2.get_by_role("button")).to_have_count(0)
        east = site(dana, EAST)
        assert by_ref(dana, east["id"], "2026-11-10", "PL-SD0001")["status"] == "checked_in"
        sd2 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0002")
        fm = [m for m in moves(ade, sd2["id"]) if m["kind"] == "forfeit"]
        assert sd2["status"] == "no_show" and len(fm) == 1 and fm[0]["actor"]["name"] == "Dana Okafor"


def test_wf_site_day_operations_keyboard(browser):
    with fresh_app(clock="2026-11-10T13:44:30Z", seed="site-day") as f:
        dana = Api(f.url, DANA)
        wait_server(dana, "2026-11-10T13:45:01Z")
        with ui(browser, f.url + "/site", DANA, browser_time=datetime(2026, 11, 12, 23, tzinfo=timezone.utc)) as page:
            expect(page.get_by_label("Date")).to_have_value("2026-11-10")
            table = page.get_by_role("table", name="Bookings")
            rows = table.get_by_role("row")
            expect(rows.filter(has_text="Deck Oven 1")).to_have_count(1)
            assert [s for s in rows.all_inner_texts()[1:]] and ["Prep Table A", "Blast Chiller", "Spiral Mixer 60 qt", "Deck Oven 1"] == [
                next(n for n in ["Prep Table A", "Blast Chiller", "Spiral Mixer 60 qt", "Deck Oven 1"] if n in t) for t in rows.all_inner_texts()[1:]]
            assert not EMAIL_RE.search(table.inner_text()) and "pack hours" not in table.inner_text().lower()
            page.get_by_role("button", name="Sign out").focus()
            seq = [n for n in tab_order(page, 18) if n != "Date"]
            assert seq[:12] == ["Previous day", "Next day", "Check in", "Mark no-show", "Cancel booking", "Check out", "Check in", "Mark no-show", "Cancel booking", "Check in", "Mark no-show", "Cancel booking"]
            r1 = rows.filter(has_text="Deck Oven 1")
            ci = r1.get_by_role("button", name="Check in")
            ci.focus()
            with held(page, "**/check-in") as h:
                page.keyboard.press("Enter")
                expect(ci).to_have_attribute("aria-disabled", "true")
                expect(ci).to_be_focused()
                expect(status(page, "Site day status")).to_have_text("Checking in…")
                expect(r1).to_contain_text("Confirmed")
                h.release()
            expect(status(page, "Site day status")).to_have_text("Checked in Lindqvist Hearth Bakery on Deck Oven 1.")
            expect(r1.get_by_role("button", name="Check out")).to_be_focused()
            r2 = rows.filter(has_text="Spiral Mixer 60 qt")
            r2.get_by_role("button", name="Mark no-show").focus()
            page.keyboard.press("Enter")
            biz = "Okonjo Small Batch"
            expect(status(page, "Site day status")).to_have_text(f"Marked {biz} as a no-show. {hh(1)} pack hours forfeited.")
            expect(r2.get_by_role("cell", name="No-show")).to_be_focused()
            r3 = rows.filter(has_text="Prep Table A")
            b3 = r3.get_by_role("button", name="Check in")
            b3.focus()
            page.keyboard.press("Enter")
            expect(status(page, "Site day status")).to_have_text("This booking has ended and can no longer be checked in.")
            expect(b3).to_be_focused()
        east = site(dana, EAST)
        assert by_ref(dana, east["id"], "2026-11-10", "PL-SD0001")["status"] == "checked_in"
        assert by_ref(dana, east["id"], "2026-11-10", "PL-SD0002")["no_show_by"]["name"] == "Dana Okafor"


def test_wf_site_day_operations_cancel_reload(browser, mail):
    with fresh_app(clock="2026-11-10T13:42:30Z", seed="site-day") as f:
        dana, rosa = Api(f.url, DANA), Api(f.url, ROSA)
        tag = uuid.uuid4().hex[:6]
        typed = f"Mixer order fell {tag}"
        with ui(browser, f.url + "/site", DANA) as page:
            page.get_by_role("button", name="Next day").click()
            page.get_by_role("button", name="Next day").click()
            rows = page.get_by_role("table", name="Bookings").get_by_role("row")
            r9 = rows.filter(has_text="Blast Chiller")
            r9.get_by_role("button", name="Cancel booking").click()
            ref = "PL-SD0009"
            dlg = page.get_by_role("dialog", name=f"Cancel booking {ref}")
            reason = dlg.get_by_role("textbox", name="Reason")
            expect(reason).to_be_focused()
            advance(page, TICK_MS)
            expect(dlg).to_contain_text(split_sentence(0.75, 1))
            page.keyboard.type(typed)
            st = stations(rosa, site(rosa, EAST)["id"], "2026-11-12")["Deck Oven 1"]
            book(rosa, st, "2026-11-12", "12:00", "13:00")
            advance(page, SITE_RELOAD_MS)
            behind = page.get_by_role("table", name="Bookings", include_hidden=True).get_by_role("row", include_hidden=True)
            expect(behind.filter(has_text="Deck Oven 1")).to_have_count(1)
            advance(page, TICK_MS)
            expect(dlg).to_contain_text(split_sentence(0.75, 1))
            expect(reason).to_be_focused()
            expect(reason).to_have_value(typed)
            assert reason.evaluate("e => e.selectionStart") == len(typed)
            page.keyboard.type(" through")
            dlg.get_by_role("button", name="Confirm cancellation").click()
            biz = "Okonjo Small Batch"
            expect(status(page, "Site day status")).to_have_text(f"Cancelled {ref} for {biz}. {hh(0.75)} pack hours refunded, {hh(1)} forfeited.")
            advance(page, MOTION_MAX_MS)
            expect(r9.get_by_role("cell", name="Cancelled")).to_be_focused()
            expect(r9.get_by_role("button")).to_have_count(0)
        assert len(mails(mail, lambda m: f"Reason: {typed} through" in text(m))) == 1


def test_live_cancel_outcome(browser):
    with fresh_app(clock="2026-11-10T13:44:00Z", seed="site-day") as f:
        dana = Api(f.url, DANA)
        typed = "Chiller defrost fault"
        with ui(browser, f.url + "/site", DANA) as page:
            page.get_by_role("button", name="Next day").click()
            page.get_by_role("button", name="Next day").click()
            row = page.get_by_role("table", name="Bookings").get_by_role("row").filter(has_text="Blast Chiller")
            row.get_by_role("button", name="Cancel booking").click()
            ref = "PL-SD0009"
            dlg = page.get_by_role("dialog", name=f"Cancel booking {ref}")
            reason = dlg.get_by_role("textbox", name="Reason")
            expect(reason).to_be_focused()
            advance(page, TICK_MS)
            expect(dlg).to_contain_text(split_sentence(0.75, 1))
            page.keyboard.type(typed)
            wait_server(dana, "2026-11-10T13:45:01Z")
            until(page, "s => document.body.innerText.includes(s)", "Cancelling now forfeits 1.75 pack hours.", SENTENCE_MS / 1000 + 30)
            expect(dlg).to_be_visible()
            expect(dlg).not_to_contain_text("refunds")
            expect(reason).to_be_focused()
            expect(reason).to_have_value(typed)
            assert reason.evaluate("e => e.selectionStart") == len(typed)
        assert by_ref(dana, site(dana, EAST)["id"], "2026-11-12", "PL-SD0009")["status"] == "confirmed"


def test_audit_trail():
    with fresh_app(clock="2026-10-23T14:00:00Z") as f:
        anon = httpx.Client(base_url=f.url)
        anon.post("/api/session", json={"email": PRIYA, "password": "wrong-pass"}, headers={"Origin": f.url})
        rosa = Api(f.url, ROSA)
        st = stations(rosa, site(rosa, EAST)["id"], "2026-10-24")["Deck Oven 1"]
        b = hold(rosa, st, "2026-10-24", "10:00", "11:00").json()["booking"]
        rosa.req("POST", f"/api/bookings/{b['id']}/confirm", {}, headers={"X-CSRF-Token": ""})
        priya, dana = Api(f.url, PRIYA), Api(f.url, DANA)
        assert code(rosa.get("/api/audit")) == "forbidden"
        ev = priya.get("/api/audit").json()["events"]
        assert [e["id"] for e in ev] == sorted((e["id"] for e in ev), reverse=True)
        for e in ev:
            assert set(e) == {"id", "at", "actor", "action", "target_type", "target_id", "outcome", "address_prefix"}
            assert e["address_prefix"] is None or e["address_prefix"].endswith(".0")
        failed = [e for e in ev if e["action"] == "POST /api/session" and e["outcome"] == "refused_session"]
        assert failed and failed[-1]["actor"] is None and failed[-1]["target_type"] == "session"
        made = [e for e in ev if e["action"] == "POST /api/bookings" and e["target_id"] == b["id"]]
        assert len(made) == 1 and made[0]["outcome"] == "allowed" and made[0]["actor"]["name"] == "Rosa Lindqvist" and made[0]["target_type"] == "booking"
        csrf = [e for e in ev if e["action"] == "POST /api/bookings/{id}/confirm" and e["target_id"] == b["id"]]
        assert len(csrf) == 1 and csrf[0]["outcome"] == "refused_csrf"
        assert any(e["action"] == "POST /api/bookings" for e in dana.get("/api/audit").json()["events"])
        assert all(e["actor"] is None or e["actor"]["name"] not in ("Rosa Lindqvist", "Priya Raman") for e in Api(f.url, INES).get("/api/audit").json()["events"])
        bad = priya.req("PATCH", "/api/audit", {})
        assert bad.status_code == 405 and code(bad) == "method_not_allowed" and bad.headers["allow"] == "GET"
        again = {e["id"]: e for e in priya.get("/api/audit").json()["events"]}
        for e in ev:
            assert again[e["id"]] == e


def test_late_checkout_hours(killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        dana, theo, rosa = Api(f.url, DANA), Api(f.url, THEO), Api(f.url, ROSA)
        east = site(dana, EAST)
        sd6 = by_ref(dana, east["id"], "2026-11-08", "PL-SD0006")
        bk = dana.post(f"/api/bookings/{sd6['id']}/check-out", key=idempotency_key()).json()["booking"]
        q = late_q(bk)
        assert bk["late_quarter_hours"] == q and q > 29 and bk["pack_hours_applied"] == 7.25 and bk["overage"]["quarter_hours"] == q - 29
        lc = [m for m in moves(rosa, sd6["id"]) if m["kind"] == "late_checkout"]
        assert len(lc) == 1 and lc[0]["hours"] == 7.25 and lc[0]["lots"] == [{"purchase_id": None, "hours": 7.25}]
        us = [m for m in moves(rosa, sd6["id"]) if m["kind"] == "usage"]
        assert len(us) == 1 and us[0]["hours"] == 1
        assert ledger(rosa)["balances"]["available_hours"] == 0
        sd4 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0004")
        bk = dana.post(f"/api/bookings/{sd4['id']}/check-out", key=idempotency_key()).json()["booking"]
        assert bk["late_quarter_hours"] == late_q(bk) and bk["pack_hours_applied"] == 0 and bk["overage"]["quarter_hours"] == bk["late_quarter_hours"]
        assert not [m for m in moves(theo, sd4["id"]) if m["kind"] == "late_checkout"]
        check_ledger(rosa)


def test_overage_amount(killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        dana, priya = Api(f.url, DANA), Api(f.url, PRIYA)
        east = site(dana, EAST)
        sd4 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0004")
        bk = dana.post(f"/api/bookings/{sd4['id']}/check-out", key=idempotency_key()).json()["booking"]
        ov = bk["overage"]
        sub, tax = priced(bk["late_quarter_hours"], 5000, "10")
        assert (ov["subtotal_cents"], ov["tax_cents"], ov["total_cents"]) == (sub, tax, sub + tax)
        sd6 = by_ref(dana, east["id"], "2026-11-08", "PL-SD0006")
        b6 = dana.post(f"/api/bookings/{sd6['id']}/check-out", key=idempotency_key()).json()["booking"]
        sub6, tax6 = priced(b6["late_quarter_hours"] - 29, 4250, "8.875")
        assert (b6["overage"]["subtotal_cents"], b6["overage"]["tax_cents"], b6["overage"]["total_cents"]) == (sub6, tax6, sub6 + tax6)
        r = priya.post(f"/api/sites/{east['id']}/rates", {"effective_from": "2026-11-20", "hourly_rate_cents": 9000, "tax_rate_percent": "20"})
        assert r.status_code == 201
        assert dana.get(f"/api/bookings/{sd4['id']}").json()["booking"]["overage"] == ov
        assert dana.get(f"/api/bookings/{sd6['id']}").json()["booking"]["overage"] == b6["overage"]


def test_overage_billing_record(killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day", copies=[{"KILLBILL_URL": "http://127.0.0.1:9"}]) as f:
        dana, rosa = Api(f.url, DANA), Api(f.url, ROSA)
        down = dana.at(f.urls[1])
        east = site(dana, EAST)
        sd6 = by_ref(dana, east["id"], "2026-11-08", "PL-SD0006")
        inv_before, before = kb_live(killbill, rosa.member_id), ledger(rosa)["movements"]
        r = down.post(f"/api/bookings/{sd6['id']}/check-out", key=idempotency_key())
        assert r.status_code == 503 and code(r) == "billing_unavailable"
        assert by_ref(dana, east["id"], "2026-11-08", "PL-SD0006")["status"] == "checked_in"
        assert ledger(rosa)["movements"] == before and kb_live(killbill, rosa.member_id) == inv_before
        r = dana.post(f"/api/bookings/{sd6['id']}/check-out", key=idempotency_key())
        assert r.status_code == 200, r.text
        total = r.json()["booking"]["overage"]["total_cents"]
        new = {k: v for k, v in kb_live(killbill, rosa.member_id).items() if k not in inv_before}
        assert len(new) == 1 and Decimal(str(next(iter(new.values()))["amount"])) * 100 == total


def test_rate_at_booking_start(killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        dana, priya = Api(f.url, DANA), Api(f.url, PRIYA)
        east = site(dana, EAST)
        states = {x["effective_from"]: x["state"] for x in priya.get(f"/api/sites/{east['id']}/rates").json()["rates"]}
        assert states["2026-11-09"] == "current"
        sd6 = by_ref(dana, east["id"], "2026-11-08", "PL-SD0006")
        ov = dana.post(f"/api/bookings/{sd6['id']}/check-out", key=idempotency_key()).json()["booking"]["overage"]
        assert (ov["hourly_rate_cents"], ov["tax_rate_percent"]) == (4250, "8.875")


def test_rate_resolved_at_checkout(killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        dana, priya = Api(f.url, DANA), Api(f.url, PRIYA)
        east, high = site(priya, EAST), site(priya, HIGH)
        er = priya.get(f"/api/sites/{east['id']}/rates").json()["rates"]
        assert [(x["effective_from"], x["state"]) for x in er] == [("2026-01-01", "past"), ("2026-11-09", "current"), ("2026-11-11", "upcoming")]
        hr = priya.get(f"/api/sites/{high['id']}/rates").json()["rates"]
        assert [(x["effective_from"], x["hourly_rate_cents"], x["tax_rate_percent"], x["state"]) for x in hr] == [("2026-01-01", 3800, "7.65", "current")]
        sd4 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0004")
        created = next(x for x in er if x["effective_from"] == "2026-11-09")["created_at"]
        assert ts(created) > ts(sd4["created_at"])
        ov = dana.post(f"/api/bookings/{sd4['id']}/check-out", key=idempotency_key()).json()["booking"]["overage"]
        assert (ov["hourly_rate_cents"], ov["tax_rate_percent"]) == (5000, "10")


def test_wf_late_checkout_overage_replay(killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day", copies=[{"KILLBILL_URL": "http://127.0.0.1:9"}]) as f:
        dana, theo = Api(f.url, DANA), Api(f.url, THEO)
        down = dana.at(f.urls[1])
        sd4 = by_ref(dana, site(dana, EAST)["id"], "2026-11-10", "PL-SD0004")
        r = dana.post(f"/api/bookings/{sd4['id']}/check-out")
        assert r.status_code == 422 and "Idempotency-Key" in r.json()["error"]["fields"]
        before = kb_live(killbill, theo.member_id)
        key = idempotency_key()
        r = dana.post(f"/api/bookings/{sd4['id']}/check-out", key=key)
        assert r.status_code == 200, r.text
        for api in (down, dana):
            rep = api.post(f"/api/bookings/{sd4['id']}/check-out", key=key)
            assert rep.status_code == 200 and rep.json() == r.json() and rep.headers["idempotent-replay"] == "true"
        assert code(dana.post(f"/api/bookings/{sd4['id']}/check-out", key=idempotency_key())) == "invalid_transition"
        new = [k for k in kb_live(killbill, theo.member_id) if k not in before]
        assert new == [r.json()["booking"]["overage"]["killbill_invoice_id"]]


def test_committed_overage_invoice(killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day", copies=[{"KILLBILL_URL": "http://127.0.0.1:9"}]) as f:
        dana, theo, rosa = Api(f.url, DANA), Api(f.url, THEO), Api(f.url, ROSA)
        down = dana.at(f.urls[1])
        east = site(dana, EAST)
        sd4 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0004")
        before = kb_live(killbill, theo.member_id)
        ov = dana.post(f"/api/bookings/{sd4['id']}/check-out", key=idempotency_key()).json()["booking"]["overage"]
        new = {k: v for k, v in kb_live(killbill, theo.member_id).items() if k not in before}
        assert list(new) == [ov["killbill_invoice_id"]]
        inv = new[ov["killbill_invoice_id"]]
        assert inv["status"] == "COMMITTED" and Decimal(str(inv["amount"])) * 100 == ov["total_cents"] and len(inv["items"]) == 1
        item = inv["items"][0]
        assert item["itemType"] == "EXTERNAL_CHARGE" and Decimal(str(item["amount"])) * 100 == ov["total_cents"]
        assert item["description"] == f"Overage PL-SD0004: {ov['quarter_hours']} quarter hours at $50.00/h plus 10% tax"
        rb = kb_live(killbill, rosa.member_id)
        sd6 = by_ref(dana, east["id"], "2026-11-08", "PL-SD0006")
        r = down.post(f"/api/bookings/{sd6['id']}/check-out", key=idempotency_key())
        assert r.status_code == 503 and code(r) == "billing_unavailable"
        assert kb_live(killbill, rosa.member_id) == rb


def _removed_late_checkout_api(killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day", copies=[{"KILLBILL_URL": "http://127.0.0.1:9"}]) as f:
        dana, theo, rosa = Api(f.url, DANA), Api(f.url, THEO), Api(f.url, ROSA)
        down = dana.at(f.urls[1])
        east = site(dana, EAST)
        sd4 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0004")
        assert "Idempotency-Key" in dana.post(f"/api/bookings/{sd4['id']}/check-out").json()["error"]["fields"]
        key = idempotency_key()
        r = dana.post(f"/api/bookings/{sd4['id']}/check-out", key=key)
        assert r.status_code == 200, r.text
        bk = r.json()["booking"]
        late = int((ts(bk["checked_out_at"]) - ts(bk["end_at"])).total_seconds() // 60)
        q = -(-late // 15)
        assert bk["late_quarter_hours"] == q and bk["pack_hours_applied"] == 0 and bk["checked_out_by"]["name"] == "Dana Okafor"
        ov = bk["overage"]
        sub, tax = half_up(Decimal(q) * 5000 / 4), half_up(Decimal(q) * 5000 / 4 * Decimal("10") / 100)
        assert (ov["quarter_hours"], ov["hourly_rate_cents"], ov["tax_rate_percent"]) == (q, 5000, "10")
        assert (ov["subtotal_cents"], ov["tax_cents"], ov["total_cents"]) == (sub, tax, sub + tax)
        acct = killbill.account_by_key(theo.me["member"]["id"])
        inv = live_invoices(killbill, acct["accountId"])
        assert len(inv) == 1 and inv[0]["status"] == "COMMITTED" and inv[0]["invoiceId"] == ov["killbill_invoice_id"]
        assert Decimal(str(inv[0]["amount"])) * 100 == sub + tax and len(inv[0]["items"]) == 1
        item = inv[0]["items"][0]
        assert item["itemType"] == "EXTERNAL_CHARGE" and item["description"] == f"Overage PL-SD0004: {q} quarter hours at $50.00/h plus 10% tax"
        rep = down.post(f"/api/bookings/{sd4['id']}/check-out", key=key)
        assert rep.status_code == 200 and rep.json() == r.json() and rep.headers["idempotent-replay"] == "true"
        assert code(dana.post(f"/api/bookings/{sd4['id']}/check-out", key=idempotency_key())) == "invalid_transition"
        assert len(live_invoices(killbill, acct["accountId"])) == 1
        sd6 = by_ref(dana, east["id"], "2026-11-08", "PL-SD0006")
        before = ledger(rosa)["movements"]
        r = down.post(f"/api/bookings/{sd6['id']}/check-out", key=idempotency_key())
        assert r.status_code == 503 and code(r) == "billing_unavailable"
        assert by_ref(dana, east["id"], "2026-11-08", "PL-SD0006")["status"] == "checked_in" and ledger(rosa)["movements"] == before
        racct = killbill.account_by_key(rosa.me["member"]["id"])
        assert racct is None or live_invoices(killbill, racct["accountId"]) == []
        r = dana.post(f"/api/bookings/{sd6['id']}/check-out", key=idempotency_key())
        bk = r.json()["booking"]
        q6 = -(-int((ts(bk["checked_out_at"]) - ts(bk["end_at"])).total_seconds() // 60) // 15)
        assert bk["late_quarter_hours"] == q6 and bk["pack_hours_applied"] == 7.25
        ov = bk["overage"]
        oq = q6 - 29
        sub, tax = half_up(Decimal(oq) * 4250 / 4), half_up(Decimal(oq) * 4250 / 4 * Decimal("8.875") / 100)
        assert (ov["quarter_hours"], ov["hourly_rate_cents"], ov["tax_rate_percent"], ov["total_cents"]) == (oq, 4250, "8.875", sub + tax)
        lc = [m for m in moves(rosa, sd6["id"]) if m["kind"] == "late_checkout"]
        assert len(lc) == 1 and lc[0]["hours"] == 7.25 and lc[0]["actor"]["name"] == "Dana Okafor" and lc[0]["lots"] == [{"purchase_id": None, "hours": 7.25}]
        us = [m for m in moves(rosa, sd6["id"]) if m["kind"] == "usage"]
        assert len(us) == 1 and us[0]["hours"] == 1
        inv = live_invoices(killbill, killbill.account_by_key(rosa.me["member"]["id"])["accountId"])
        assert len(inv) == 1 and inv[0]["status"] == "COMMITTED" and Decimal(str(inv[0]["amount"])) * 100 == sub + tax
        check_ledger(rosa)


def test_wf_late_checkout_overage_ui(browser, killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        dana = Api(f.url, DANA)
        theo_id = Api(f.url, THEO).me["member"]["id"]
        before = set(kb_live(killbill, theo_id))
        with ui(browser, f.url + "/site", DANA) as page:
            row = page.get_by_role("table", name="Bookings").get_by_role("row").filter(has_text="Blast Chiller")
            row.get_by_role("button", name="Check out").click()
            business = "Mbeki Smoke Truck"
            dlg = page.get_by_role("dialog", name=f"Check out {business}")
            expect(dlg).to_contain_text(re.compile(r"Booked until 07:30\. Late by \d+ min\."))
            btn = dlg.get_by_role("button", name="Confirm check-out")
            expect(btn).to_be_focused()
            advance(page, SITE_RELOAD_MS)
            expect(dlg).to_be_visible()
            btn.click()
            btn.click(force=True)
            mgr, sid = Api(f.url, DANA), site(dana, EAST)["id"]
            bk = poll(lambda: by_ref(mgr, sid, "2026-11-10", "PL-SD0004"),
                      lambda b: b.get("late_quarter_hours") is not None, WAIT_S, "check-out never settled")
            expected = f"Late {bk['late_quarter_hours'] * 0.25:.2f} h · {bk['pack_hours_applied']:.2f} pack h · Overage ${money(bk['overage']['total_cents'])} · by {DANA_NAME}"
            expect(row).to_contain_text(expected)
        assert len(set(kb_live(killbill, theo_id)) - before) == 1


def test_truck_visits_api():
    with fresh_app(clock="2026-10-24T10:59:30Z") as f:
        dana, theo, ade = Api(f.url, DANA), Api(f.url, THEO), Api(f.url, ADE)
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        v = dana.get(f"/api/trucks/{truck}/visits").json()
        assert set(v) == {"truck", "visits", "last_departed_at", "overdue"}
        assert set(v["truck"]) == {"id", "name", "permit_number", "member_id", "business_name"}
        assert [(x["gap_hours"], x["gap_flagged"]) for x in v["visits"]] == [(33.5, True), (23.5, False), (None, False)]
        assert v["last_departed_at"] == "2026-10-23T11:00:00.000Z" and v["overdue"] is False
        assert set(v["visits"][0]) == {"id", "truck_id", "site_id", "arrived_at", "departed_at", "services", "operator_signature", "manager_name", "gap_hours", "gap_flagged"}
        assert theo.get(f"/api/trucks/{truck}/visits").status_code == 200
        assert code(ade.get(f"/api/trucks/{truck}/visits")) == "not_found"
        wait_server(dana, "2026-10-24T11:00:01Z")
        assert dana.get(f"/api/trucks/{truck}/visits").json()["overdue"] is True
        r = dana.post(f"/api/trucks/{truck}/visits")
        assert r.status_code == 201 and r.json()["visit"]["departed_at"] is None
        assert code(dana.post(f"/api/trucks/{truck}/visits")) == "visit_open"
        assert dana.get(f"/api/trucks/{truck}/visits").json()["overdue"] is True
        vid = r.json()["visit"]["id"]
        assert "services" in dana.post(f"/api/visits/{vid}/depart", {"services": [], "operator_signature": "Theo Mbeki"}).json()["error"]["fields"]
        assert "operator_signature" in dana.post(f"/api/visits/{vid}/depart", {"services": ["grease"], "operator_signature": "T"}).json()["error"]["fields"]
        d = dana.post(f"/api/visits/{vid}/depart", {"services": ["potable_water", "grease"], "operator_signature": "Theo Mbeki"})
        assert d.status_code == 200
        dv = d.json()["visit"]
        gap = (Decimal((ts(dv["departed_at"]) - ts("2026-10-23T11:00:00.000Z")).total_seconds()) / 3600).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        assert Decimal(str(dv["gap_hours"])) == gap and dv["gap_flagged"] == (gap > 24) and dv["manager_name"] == "Dana Okafor"
        after = dana.get(f"/api/trucks/{truck}/visits").json()
        assert after["overdue"] is False and after["visits"][0]["id"] == vid
        assert code(dana.post(f"/api/visits/{vid}/depart", {"services": ["grease"], "operator_signature": "Theo Mbeki"})) == "invalid_transition"


def test_wf_truck_visits_ui(browser):
    with fresh_app(clock="2026-10-24T11:00:30Z") as f:
        with ui(browser, f.url + "/trucks", DANA) as page:
            page.get_by_role("combobox", name="Find a member").fill("Mbeki")
            see(page, "Mbeki Smoke Truck")
            page.get_by_role("option", name=re.compile("Mbeki Smoke Truck")).click()
            notice = page.get_by_text("Overdue: last return 2026-10-23 07:00")
            expect(notice).to_be_visible()
            log = page.get_by_role("table", name="Visit log")
            expect(log).to_contain_text(f"Gap {hh(33.5)} h — over 24 hours")
            page.get_by_role("button", name="Truck arrived").click()
            expect(status(page, "Visit log status")).to_have_text(re.compile(r"^Truck arrived at \d\d:\d\d\.$"))
            page.get_by_role("button", name="Truck departed").click()
            dlg = page.get_by_role("dialog", name="Record departure")
            dlg.get_by_role("checkbox", name="Potable water").check()
            dlg.get_by_role("checkbox", name="Cleaning").check()
            dlg.get_by_role("textbox", name="Operator signature").fill("Theo Mbeki")
            dlg.get_by_role("button", name="Save departure").click()
            expect(status(page, "Visit log status")).to_have_text(re.compile(r"^Departure recorded at \d\d:\d\d\.$"))
            expect(notice).to_have_count(0)
            dana = Api(f.url, DANA)
            truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
            v = dana.get(f"/api/trucks/{truck}/visits").json()
            top = v["visits"][0]
            gap = f"Gap {top['gap_hours']:.2f} h — over 24 hours" if top["gap_flagged"] else f"{top['gap_hours']:.2f} h"
            expect(log.get_by_role("row").nth(1)).to_contain_text(gap)
            assert v["overdue"] is False and len(v["visits"]) == 4 and top["services"] == ["potable_water", "cleaning"]


def test_wf_truck_visits_overdue_live(browser):
    with fresh_app(clock="2026-10-24T10:59:25Z") as f:
        theo = Api(f.url, THEO)
        with ui(browser, f.url + "/truck", THEO, browser_time=datetime(2026, 10, 27, 2, tzinfo=timezone.utc)) as page:
            log = page.get_by_role("table", name="Visit log")
            expect(log).to_contain_text(f"Gap {hh(33.5)} h — over 24 hours")
            assert server_now(theo) < ts("2026-10-24T11:00:00.000Z")
            expect(page.get_by_text("Overdue: last return 2026-10-23 07:00")).to_have_count(0)
            wait_server(theo, "2026-10-24T11:00:01Z")
            until(page, "s => document.body.innerText.includes(s)", "Overdue: last return 2026-10-23 07:00", PACKS_REFRESH_MS / 1000 + 30)


def test_wf_inspector_link_api(mail):
    with fresh_app(clock="2026-10-25T12:00:00Z", copies=[{"S3_ENDPOINT": "http://127.0.0.1:9"}], INSPECTOR_LINK_TTL_SECONDS=str(SHORT_LINK_TTL_S)) as f:
        dana = Api(f.url, DANA)
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        tenant = dana.me["user"]["tenant"]["id"]
        s3 = S3()
        seen = s3.keys(f"visit-logs/{tenant}/{truck}/")
        email = f"insp-{uuid.uuid4().hex[:8]}@health.example"
        r = dana.at(f.urls[1]).post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email})
        assert r.status_code == 503 and code(r) == "storage_unavailable"
        assert dana.get(f"/api/trucks/{truck}/inspector-links").json()["links"] == [] and s3.keys(f"visit-logs/{tenant}/{truck}/") == seen
        assert "inspector_email" in dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": "bad email@x"}).json()["error"]["fields"]
        link = dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email}).json()["link"]
        token = link["url"].rsplit("/", 1)[1]
        assert link["url"] == f"{f.url}/inspect/{token}" and re.fullmatch(r"[A-Za-z0-9_-]{22,}", token)
        assert (ts(link["expires_at"]) - ts(link["created_at"])).total_seconds() == SHORT_LINK_TTL_S and link["state"] == "live"
        pdf = s3.get(f"visit-logs/{tenant}/{truck}/{link['id']}.pdf")
        assert pdf.startswith(b"%PDF-")
        ptxt = pdf_text(pdf)
        flat = re.sub(r"\s", "", ptxt)
        for want in ("SmokeSignal", "MFU-2291", "MbekiSmokeTruck", "CopperlineEastside", "TheoMbeki", "DanaOkafor"):
            assert want in flat
        assert not EMAIL_RE.search(ptxt) and not UUID_RE.search(ptxt) and "PL-" not in ptxt and "pack hours" not in ptxt.lower() and "Steam Engine" not in ptxt
        m = mails(mail, lambda m: email in addresses(m["To"]))
        assert len(m) == 1 and subject(m[0]) == f"Commissary visit log: {TRUCK}"
        body = text(m[0])
        assert link["url"] in body and "Copperline Eastside" in body
        assert not EMAIL_RE.search(body) and not UUID_RE.search(body) and "pack hours" not in body.lower()
        pub = httpx.Client(base_url=f.url)
        v = pub.get(f"/api/inspect/{token}")
        assert set(v.json()) == {"truck", "operator", "commissary", "expires_at", "overdue", "last_departed_at", "visits"}
        assert v.json()["truck"] == {"name": "Smoke Signal", "permit_number": "MFU-2291"} and v.json()["operator"] == {"business_name": "Mbeki Smoke Truck"}
        assert set(v.json()["commissary"]) == {"site_name", "address", "time_zone"} and v.json()["overdue"] is True
        assert all(set(x) == {"arrived_at", "departed_at", "services", "operator_signature", "manager_name", "gap_hours", "gap_flagged"} for x in v.json()["visits"])
        assert not EMAIL_RE.search(v.text) and not UUID_RE.search(v.text)
        for meth in ("POST", "PUT", "PATCH", "DELETE"):
            for p in (f"/api/inspect/{token}", f"/api/inspect/{token}/log.pdf"):
                x = pub.request(meth, p, headers={"Origin": f.url})
                assert x.status_code == 405 and code(x) == "read_only" and x.headers["allow"] == "GET"
        dl = pub.get(f"/api/inspect/{token}/log.pdf")
        assert dl.content == pdf and dl.headers["content-type"].startswith("application/pdf")
        assert code(pub.get("/api/inspect/AAAAAAAAAAAAAAAAAAAAAA")) == "not_found"
        r = dana.post(f"/api/inspector-links/{link['id']}/revoke")
        assert r.json()["link"]["state"] == "revoked"
        x = pub.get(f"/api/inspect/{token}")
        assert x.status_code == 410 and code(x) == "link_revoked"
        assert code(dana.post(f"/api/inspector-links/{link['id']}/revoke")) == "invalid_transition"
        assert code(dana.post(f"/api/inspector-links/{link['id']}/reissue")) == "invalid_transition"
        l2 = dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email}).json()["link"]
        r = dana.post(f"/api/inspector-links/{l2['id']}/reissue")
        assert r.status_code == 201 and r.json()["replaced"]["state"] == "revoked" and r.json()["link"]["inspector_email"] == email
        new_token = r.json()["link"]["url"].rsplit("/", 1)[1]
        assert code(pub.get(f"/api/inspect/{l2['url'].rsplit('/', 1)[1]}")) == "link_revoked"
        assert pub.get(f"/api/inspect/{new_token}").status_code == 200
        assert len(mails(mail, lambda m: email in addresses(m["To"]), 3)) == 3
        wait_server(dana, r.json()["link"]["expires_at"])
        x = pub.get(f"/api/inspect/{new_token}")
        assert x.status_code == 410 and code(x) == "link_expired"


def test_wf_inspector_link_ui(browser, mail):
    with fresh_app(clock="2026-10-25T12:00:00Z") as f:
        email = f"insp-{uuid.uuid4().hex[:8]}@health.example"
        with ui(browser, f.url + "/trucks", DANA) as mgr:
            mgr.get_by_role("combobox", name="Find a member").fill("Mbeki")
            see(mgr, "Mbeki Smoke Truck")
            mgr.get_by_role("option", name=re.compile("Mbeki Smoke Truck")).click()
            mgr.get_by_role("textbox", name="Inspector email").fill(email)
            mgr.get_by_role("button", name="Issue inspector link").click()
            expect(status(mgr, "Visit log status")).to_have_text(re.compile(rf"^Link sent to {re.escape(email)}\. It works until 2026-10-28 \d\d:\d\d site time\.$"))
            expect(mgr.get_by_role("list", name="Inspector links").get_by_role("listitem").first).to_contain_text("Live")
            url = re.search(r"https?://\S+/inspect/[A-Za-z0-9_-]+", text(mails(mail, lambda m: email in addresses(m["To"]))[0])).group(0)
            with ui(browser, url, size=PHONE) as page:
                paths = []
                page.on("request", lambda r: paths.append(urlparse(r.url).path) if "/api/" in r.url else None)
                page.reload()
                head = page.get_by_role("heading", name=f"{TRUCK} commissary visits")
                expect(head).to_be_visible()
                pdf, table = page.get_by_role("link", name="Download PDF"), page.get_by_role("table", name="Commissary visits")
                notice = page.get_by_text("Overdue: last return 2026-10-23 07:00")
                for w in [PHONE[0], *EDGES, TABLET[0], DESKTOP[0]]:
                    page.set_viewport_size({"width": w, "height": PHONE[1]})
                    layout(page)
                    hb, pb, tb, nb = head.bounding_box(), pdf.bounding_box(), table.bounding_box(), notice.bounding_box()
                    assert pb["width"] >= MIN_TARGET and pb["height"] >= MIN_TARGET
                    row = table.get_by_role("row").nth(1)
                    if w >= DESKTOP[0] - 256:
                        assert pb["x"] >= hb["x"] + hb["width"] and nb["y"] <= hb["y"] + hb["height"] and tb["y"] >= pb["y"] + pb["height"]
                    else:
                        assert hb["y"] + hb["height"] <= nb["y"] <= pb["y"] <= tb["y"]
                    assert cells_stack(row) == (w < EDGES[1])
                    if w < EDGES[1]:
                        assert pb["width"] >= 0.95 * tb["width"]

                with page.expect_download() as dl:
                    pdf.click()
                assert Path(dl.value.path()).read_bytes().startswith(b"%PDF-")
                assert paths and all(p.startswith(f"/api/inspect/{url.rsplit('/', 1)[1]}") for p in paths)
                mgr.get_by_role("list", name="Inspector links").get_by_role("listitem").first.get_by_role("button", name="Revoke").click()
                expect(status(mgr, "Visit log status")).to_have_text("Link revoked. It stops working now.")
                page.reload()
                expect(page.get_by_role("heading", name="This link was revoked")).to_be_visible()
                expect(page.get_by_role("heading", name=f"{TRUCK} commissary visits")).to_have_count(0)


def test_wf_rate_schedule_api():
    with fresh_app(clock="2026-11-10T06:00:30Z") as f:
        priya, rosa, dana = Api(f.url, PRIYA), Api(f.url, ROSA), Api(f.url, DANA)
        east, high = site(priya, EAST), site(priya, HIGH)
        assert (east["local_date"], high["local_date"]) == ("2026-11-10", "2026-11-09")
        post = lambda s, d, c=5000, t="8": priya.post(f"/api/sites/{s['id']}/rates", {"effective_from": d, "hourly_rate_cents": c, "tax_rate_percent": t})
        r = post(east, "2026-11-10")
        assert r.status_code == 422 and "effective_from" in r.json()["error"]["fields"]
        r = post(high, "2026-11-10")
        assert r.status_code == 201 and r.json()["rate"]["state"] == "upcoming"
        assert [(x["effective_from"], x["state"]) for x in r.json()["rates"]] == [("2026-01-01", "current"), ("2026-11-10", "upcoming")]
        r = post(high, "2026-11-10", 6000)
        assert r.status_code == 409 and code(r) == "rate_exists"
        for c, t, field in [(0, "8", "hourly_rate_cents"), (100001, "8", "hourly_rate_cents"), (5000, "25.001", "tax_rate_percent"), (5000, "8.8751", "tax_rate_percent")]:
            assert field in post(east, "2026-11-20", c, t).json()["error"]["fields"]
        before = priya.get(f"/api/sites/{high['id']}/rates").json()
        r = priya.post(f"/api/sites/{high['id']}/rates", {"effective_from": "2026-11-20", "hourly_rate_cents": 5000, "tax_rate_percent": "8", "site_id": high["id"], "state": "current"})
        assert r.status_code == 422 and code(r) == "validation"
        assert r.json()["error"]["fields"]["site_id"] == "Unknown field." and r.json()["error"]["fields"]["state"] == "Unknown field."
        assert priya.get(f"/api/sites/{high['id']}/rates").json() == before
        assert post(east, "2026-11-11", 100000, "25").status_code == 201
        assert [x["effective_from"] for x in priya.get(f"/api/sites/{east['id']}/rates").json()["rates"]] == ["2026-01-01", "2026-11-11"]
        assert code(rosa.post(f"/api/sites/{east['id']}/rates", {"effective_from": "2026-12-01", "hourly_rate_cents": 1, "tax_rate_percent": "0"})) == "forbidden"
        assert code(dana.get(f"/api/sites/{east['id']}/rates")) == "forbidden"


def test_wf_rate_schedule_ui(browser):
    with fresh_app(clock="2026-11-10T06:00:30Z") as f:
        priya = Api(f.url, PRIYA)
        east, high = site(priya, EAST), site(priya, HIGH)
        with ui(browser, f.url + "/rates", PRIYA) as page:
            combo, table = page.get_by_role("combobox", name="Site"), page.get_by_role("table", name="Rate schedule")
            select(combo, HIGH)
            high_rate, high_tax, east_rate = f"${money(3800)}", "7.65", f"${money(4250)}"
            expect(table).to_contain_text(high_rate)
            with held(page, f"**/{east['id']}/rates") as h:
                select(combo, EAST)
                select(combo, HIGH)
                expect(table).to_contain_text(f"{high_tax}%")
                with page.expect_response(lambda r: f"{east['id']}/rates" in r.url):
                    h.release()
            expect(table).to_contain_text(high_rate)
            expect(table).not_to_contain_text(east_rate)
            eff = page.get_by_label("Effective from")
            expect(eff).to_have_value("2026-11-10")
            new_from = "2026-12-01"
            eff.fill(new_from)
            page.get_by_role("textbox", name="Hourly rate (USD)").fill("45.00")
            page.get_by_role("textbox", name="Sales tax (%)").fill("8")
            page.get_by_role("button", name="Schedule rate").click()
            expect(status(page, "Rates status")).to_have_text(f"Rate scheduled from {new_from}.")
            expect(table.get_by_role("row").filter(has_text=new_from)).to_contain_text("Upcoming")
            expect(table.get_by_role("row").filter(has_text="2026-01-01")).to_contain_text("Current")
            select(combo, EAST)
            expect(page.get_by_label("Effective from")).to_have_value("2026-11-11")
        rates = priya.get(f"/api/sites/{high['id']}/rates").json()["rates"]
        assert any(r["effective_from"] == new_from and r["hourly_rate_cents"] == 4500 for r in rates)


def test_wf_network_reports_api():
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        dana, priya, marco, rosa, ade = (Api(f.url, e) for e in (DANA, PRIYA, MARCO, ROSA, ADE))
        east = site(dana, EAST)
        wait_server(dana, "2026-11-10T13:45:01Z")
        dana.post(f"/api/bookings/{by_ref(dana, east['id'], '2026-11-10', 'PL-SD0002')['id']}/no-show")
        co = dana.post(f"/api/bookings/{by_ref(dana, east['id'], '2026-11-10', 'PL-SD0004')['id']}/check-out", key=idempotency_key()).json()["booking"]
        sd8 = next(b for b in rosa.get("/api/bookings").json()["bookings"] if b["reference"] == "PL-SD0008")
        rosa.post(f"/api/bookings/{sd8['id']}/cancel")
        rep = priya.get("/api/reports/utilisation", params={"month": "2026-11"}).json()
        rows = {s["site_name"]: s for s in rep["sites"]}
        assert list(rows) == [EAST, HIGH]
        e = rows[EAST]
        assert (e["scheduled_hours"], e["used_hours"], e["forfeited_hours"], e["overage_cents"]) == (10.25, 1.5, 2.0, co["overage"]["total_cents"])
        assert (rows[HIGH]["scheduled_hours"], rows[HIGH]["overage_cents"]) == (2.0, 0)
        assert rep["totals"]["scheduled_hours"] == e["scheduled_hours"] + rows[HIGH]["scheduled_hours"]
        assert rep["totals"]["overage_cents"] == co["overage"]["total_cents"]
        month = "2026-11"
        csv = priya.get("/api/reports/utilisation.csv", params={"month": month})
        assert csv.headers["content-type"].startswith("text/csv")
        assert csv.headers["content-disposition"] == f'attachment; filename="utilisation-{month}.csv"'
        lines = csv.text.strip().splitlines()
        assert lines[0] == "site_name,month,scheduled_hours,used_hours,forfeited_hours,overage_cents"
        assert lines[1:] == [f"{s['site_name']},2026-11,{s['scheduled_hours']:.2f},{s['used_hours']:.2f},{s['forfeited_hours']:.2f},{s['overage_cents']}" for s in rep["sites"]] + [
            f"TOTAL,2026-11,{rep['totals']['scheduled_hours']:.2f},{rep['totals']['used_hours']:.2f},{rep['totals']['forfeited_hours']:.2f},{rep['totals']['overage_cents']}"]
        mine = priya.get("/api/reports/utilisation", params={"month": "2026-11", "member_id": ade.member_id}).json()
        me = {s["site_name"]: s for s in mine["sites"]}[EAST]
        assert mine["member"]["business_name"] == "Okonjo Small Batch" and (me["scheduled_hours"], me["forfeited_hours"], me["overage_cents"]) == (2.75, 1.0, 0)
        assert code(priya.get("/api/reports/utilisation", params={"month": "2026-13"})) == "validation"
        theirs = marco.get("/api/reports/utilisation", params={"month": "2026-11"}).json()
        assert [s["site_name"] for s in theirs["sites"]] == [FERN] and theirs["totals"]["overage_cents"] == 0
        assert FERN not in priya.get("/api/reports/utilisation.csv", params={"month": "2026-11"}).text
        assert [m["business_name"] for m in priya.get("/api/members", params={"q": "sa"}).json()["members"]] == ["Lindqvist Hearth Bakery", "Sato Patisserie"]
        assert [m["business_name"] for m in priya.get("/api/members", params={"q": "sat"}).json()["members"]] == ["Sato Patisserie"]
        assert all(m["business_name"] not in ("Lindqvist Hearth Bakery", "Sato Patisserie") for m in marco.get("/api/members", params={"q": "sa"}).json()["members"])
        names = {e["actor"]["name"] for e in marco.get("/api/audit").json()["events"] if e["actor"]}
        assert not names & {"Dana Okafor", "Rosa Lindqvist", "Priya Raman"}


def test_tenant_boundary_ids():
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        dana, rosa, ines, marco, rosalind = (Api(f.url, e) for e in (DANA, ROSA, INES, MARCO, ROSALIND))
        east = site(dana, EAST)
        sd1 = by_ref(dana, east["id"], "2026-11-10", "PL-SD0001")
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        visit = dana.get(f"/api/trucks/{truck}/visits").json()["visits"][0]["id"]
        st = stations(rosa, east["id"], "2026-11-14")["Deck Oven 1"]
        pack = next(p for p in rosa.get("/api/packs").json()["packs"] if p["name"] == "Production 30")
        checks = [
            ines.get(f"/api/sites/{east['id']}/availability", params={"date": "2026-11-14"}),
            ines.get(f"/api/bookings/{sd1['id']}"),
            ines.post(f"/api/bookings/{sd1['id']}/check-in"),
            ines.get(f"/api/trucks/{truck}/visits"),
            ines.post(f"/api/visits/{visit}/depart", {"services": ["grease"], "operator_signature": "Theo Mbeki"}),
            marco.get(f"/api/sites/{east['id']}/rates"),
            marco.get("/api/reports/utilisation", params={"month": "2026-11", "member_id": rosa.member_id}),
            rosalind.post("/api/pack-purchases", {"pack_id": pack["id"]}, idempotency_key()),
            hold(rosalind, st, "2026-11-14", "10:00", "11:00"),
        ]
        for r in checks:
            assert r.status_code == 404 and code(r) == "not_found", (r.request.url, r.text)


def test_wf_network_reports_ui(browser):
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        dana, ade = Api(f.url, DANA), Api(f.url, ADE)
        wait_server(dana, "2026-11-10T13:45:01Z")
        dana.post(f"/api/bookings/{by_ref(dana, site(dana, EAST)['id'], '2026-11-10', 'PL-SD0002')['id']}/no-show")
        priya = Api(f.url, PRIYA)
        with ui(browser, f.url + "/reports?month=2026-11", PRIYA, size=PHONE) as page:
            menu = page.get_by_role("button", name="Menu")
            expect(menu).to_have_attribute("aria-expanded", "false")
            shown = "2026-11"
            expect(status(page, "Report status")).to_have_text(f"Showing {shown}.")
            expect(page.get_by_role("link", name="Reports")).to_have_count(0)
            expect(page.get_by_role("link", name="Rates")).to_have_count(0)
            page.get_by_role("button", name="Sign out").focus()
            assert not {"Rates", "Reports"} & set(tab_order(page, 8))
            layout(page)
        with ui(browser, f.url + "/reports", PRIYA) as page:
            stale = []
            page.route("**/api/members*", lambda route: stale.append(route) if parse_qs(urlparse(route.request.url).query).get("q") == ["sa"] else route.continue_())
            member = page.get_by_role("combobox", name="Member")
            member.fill("sa")
            member.fill("sat")
            advance(page, TICK_MS)
            lb = page.get_by_role("listbox")
            expect(lb.get_by_role("option")).to_have_count(1)
            for r in stale:
                r.continue_()
            expect(lb.get_by_role("option")).to_have_text([re.compile("Sato Patisserie")])
            page.unroute("**/api/members*")
            page.get_by_role("textbox", name="Month").fill("2026-11")
            member.fill("Okonjo")
            see(page, "Okonjo Small Batch")
            page.get_by_role("option", name=re.compile("Okonjo Small Batch")).click()
            page.get_by_role("button", name="Show report").click()
            expect(page).to_have_url(re.compile(rf"/reports\?month=2026-11&member={ade.member_id}$"))
            month = "2026-11"
            expect(status(page, "Report status")).to_have_text(f"Showing {month}.")
            table = page.get_by_role("table", name="Utilisation by site")
            expect(table.get_by_role("row").filter(has_text=EAST)).to_contain_text("1.00")
            csv_link = page.get_by_role("link", name="Download CSV")
            expect(csv_link).to_have_attribute("href", re.compile(rf"/api/reports/utilisation\.csv\?month=2026-11&member_id={ade.member_id}$"))
            href = csv_link.get_attribute("href")
            data = priya.get(urlparse(href).path + "?" + urlparse(href).query)
            assert data.status_code == 200 and "1.00" in data.text
            member.fill("")
            page.get_by_role("button", name="Show report").click()
            expect(page).to_have_url(re.compile(r"/reports\?month=2026-11$"))
            page.go_back()
            expect(member).to_have_value("Okonjo Small Batch")
            expect(csv_link).to_have_attribute("href", re.compile(f"member_id={ade.member_id}"))
            page.go_back()
            page.go_forward()
            page.go_forward()
            expect(page).to_have_url(re.compile(r"/reports\?month=2026-11$"))
            expect(member).to_have_value("")
            expect(csv_link).to_have_attribute("href", re.compile(r"utilisation\.csv\?month=2026-11$"))
        with ui(browser, f"{f.url}/reports?month=2026-11&member={ade.member_id}") as page:
            sign_in(page, PRIYA)
            expect(page).to_have_url(re.compile(rf"/reports\?month=2026-11&member={ade.member_id}$"))
            expect(page.get_by_role("combobox", name="Member")).to_have_value("Okonjo Small Batch")
            expect(page.get_by_role("table", name="Utilisation by site").get_by_role("row").filter(has_text=EAST)).to_contain_text("1.00")
        with ui(browser, f.url + "/reports?month=2026-13", PRIYA) as page:
            expect(status(page, "Report status")).to_have_text("Enter a month as YYYY-MM.")
            expect(page.get_by_role("table", name="Utilisation by site")).to_have_count(0)


def test_wf_cross_cutting_layout_bands(browser, app_url):
    for w in [PHONE[0], *EDGES, TABLET[0], DESKTOP[0]]:
        with ui(browser, app_url + "/book", ROSA, size=(w, PHONE[1])) as page:
            page.get_by_role("radio", name="Ovens").check()
            oven = page.get_by_role("group", name=dial_of("Deck Oven 1"))
            expect(oven).to_be_visible()
            layout(page)
            assert (page.get_by_role("button", name="Menu").count() == 1) == (w < EDGES[1])
            dial = oven.bounding_box()
            tickets = page.get_by_role("list", name="Tickets")
            spike = tickets.bounding_box() if tickets.count() else None
            if spike is None:
                pass
            elif w >= EDGES[3]:
                assert spike["x"] >= dial["x"] + dial["width"] - 1
            else:
                assert spike["y"] >= dial["y"] + dial["height"] - 1
            if w in (PHONE[0], TABLET[0], DESKTOP[0]):
                controls_ok(page)
            page.goto(app_url + "/packs")
            a, b = page.get_by_role("button", name=f"Buy {STARTER}"), page.get_by_role("button", name="Buy Production 30")
            expect(b).to_be_visible()
            layout(page)
            same_row = abs(a.bounding_box()["y"] - b.bounding_box()["y"]) < 2
            assert same_row == (EDGES[1] <= w <= EDGES[2])
            row = page.get_by_role("table", name="Hour ledger").get_by_role("row").nth(1)
            assert cells_stack(row) == (w < EDGES[1])
            if w in (PHONE[0], TABLET[0], DESKTOP[0]):
                controls_ok(page)


def test_phone_navigation_collapsed(browser, app_url):
    with ui(browser, app_url + "/rates", PRIYA, size=PHONE) as page:
        menu = page.get_by_role("button", name="Menu")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("link", name="Rates")).to_have_count(0)
        for name in ("Rates", "Reports"):
            hidden = page.get_by_role("link", name=name, include_hidden=True)
            if hidden.count():
                assert hidden.evaluate("e => { e.focus(); const r=e.getBoundingClientRect(); return document.activeElement !== e && r.width * r.height === 0 }")
        page.get_by_role("button", name="Sign out").focus()
        assert not {"Rates", "Reports"} & set(tab_order(page, 8))
        menu.click()
        expect(menu).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_role("link", name="Rates")).to_be_focused()
        page.keyboard.press("Escape")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(menu).to_be_focused()
        menu.click()
        page.get_by_role("link", name="Reports").click()
        expect(page).to_have_url(re.compile(r"/reports"))
        expect(menu).to_have_attribute("aria-expanded", "false")
        page.set_viewport_size({"width": TABLET[0], "height": TABLET[1]})
        expect(page.get_by_role("button", name="Menu")).to_have_count(0)
        expect(page.get_by_role("link", name="Rates")).to_be_visible()
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        expect(page.get_by_role("button", name="Menu")).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("link", name="Rates")).to_have_count(0)


def test_dialog_focus_and_escape(browser, app_url):
    with ui(browser, app_url + "/packs", ROSA) as page:
        opener = page.get_by_role("button", name=f"Buy {STARTER}")
        opener.click()
        dlg = page.get_by_role("dialog", name=f"Buy {STARTER}")
        pay, close = dlg.get_by_role("button", name="Pay and add hours"), dlg.get_by_role("button", name="Close")
        expect(pay).to_be_focused()
        assert tab_order(page, 3) == ["Close", "Pay and add hours", "Close"]
        page.keyboard.press("Shift+Tab")
        expect(pay).to_be_focused()
        page.keyboard.press("Shift+Tab")
        expect(close).to_be_focused()
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(opener).to_be_focused()


def test_wf_compliance_documents_field_error(browser):
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        copy = "Coverage must be at least $1,000,000 per occurrence."
        with ui(browser, f.url + "/documents", HANA) as page:
            select(page.get_by_role("combobox", name="Document type"), COI_LABEL)
            page.get_by_label("Expiry date").fill(COI_UNTIL)
            coverage = page.get_by_role("textbox", name="Coverage per occurrence (USD)")
            coverage.fill("999999")
            page.get_by_role("checkbox", name=f"Names {LEGAL} as additional insured").check()
            page.get_by_label("File").set_input_files(files=[{"name": "coi.pdf", "mimeType": "application/pdf", "buffer": PDF}])
            page.get_by_role("button", name="Upload document").click()
            expect(status(page, "Document status")).to_have_text(copy)
            expect(coverage).to_have_attribute("aria-invalid", "true")
            linked = coverage.evaluate("""e => { const ids = (e.getAttribute('aria-describedby') || '').split(/\\s+/);
              const n = e.nextElementSibling; return n && n.id && ids.includes(n.id) ? n.textContent.trim() : null; }""")
            assert linked == copy
            expect(page.get_by_role("table", name="Your documents").get_by_role("row").filter(has_text="Pending review")).to_have_count(0)
            coverage.fill("1000000")
            expect(coverage).not_to_have_attribute("aria-invalid", "true")
            assert coverage.evaluate("(e, c) => !(e.nextElementSibling && e.nextElementSibling.textContent.trim() === c)", copy)
            expect(status(page, "Document status")).to_have_text(copy)
        assert Api(f.url, HANA).get("/api/documents").json()["documents"] == []


def test_wf_pack_purchase_session_resume(browser, killbill):
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        sent, sign_ins = [], []
        was = killbill.account_by_key(Api(f.url, ROSA).member_id)
        before = len(killbill.payments(was["accountId"])) if was else 0
        with ui(browser, f.url + "/packs", ROSA) as page:
            def purchase(route):
                sent.append(dict(route.request.headers))
                if len(sent) == 1:
                    route.fulfill(status=401, content_type="application/json; charset=utf-8",
                                  body=json.dumps({"error": {"code": "session_expired", "message": "Session ended."}}))
                else:
                    route.continue_()
            page.route("**/api/pack-purchases", purchase)
            page.on("request", lambda r: sign_ins.append(r.url) if r.method == "POST" and urlparse(r.url).path == "/api/session" else None)
            page.get_by_role("button", name="Buy Production 30").click()
            page.get_by_role("dialog", name="Buy Production 30").get_by_role("button", name="Pay and add hours").click()
            again = page.get_by_role("dialog", name="Sign in again")
            expect(again).to_be_visible()
            expect(again).to_contain_text(f"Signed in as {ROSA}")
            advance(page, TICK_MS)
            expect(again.get_by_role("status", name="Sign-in status")).to_have_text("Your session has ended. Sign in again.")
            pw = again.get_by_label("Password", exact=True)
            expect(pw).to_be_focused()
            expect(page.get_by_role("dialog", name="Buy Production 30", include_hidden=True)).to_have_count(1)
            pw.fill(PASSWORD)
            again.get_by_role("button", name="Sign in and continue").click()
            vt = plus_days("2026-10-30", 60)
            expect(status(page, "Pack status")).to_have_text(f"Added {hh(30)} pack hours, valid through {vt}. A receipt is on its way to {ROSA}.")
            advance(page, MOTION_MAX_MS)
            expect(again).to_have_count(0)
            csrf = next(c["value"] for c in page.context.cookies() if c["name"] == "pl_csrf")
        assert len(sign_ins) == 1 and len(sent) == 2
        assert sent[0]["idempotency-key"] == sent[1]["idempotency-key"]
        assert sent[1]["x-csrf-token"] == csrf and sent[1]["x-csrf-token"] != sent[0]["x-csrf-token"]
        rosa = Api(f.url, ROSA)
        buys = [m for m in ledger(rosa)["movements"] if m["kind"] == "pack_purchase"]
        assert len(buys) == 1
        acct = killbill.account_by_key(rosa.member_id)
        assert acct and len(killbill.payments(acct["accountId"])) - before == 1
        assert killbill.payment_by_key(buys[0]["purchase_id"])


def test_if_run_manifest():
    m = json.loads(Path("/app/run.json").read_text())
    assert set(m) == {"_schema", "install", "build", "serve"} and m["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in m.values())


def _shipped() -> dict[str, dict]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd="/app", capture_output=True, text=True, timeout=300)
    found: dict[str, dict] = {}

    def walk(deps):
        for name, d in (deps or {}).items():
            if d.get("version") and not d.get("missing"):
                found.setdefault(name, d)
                walk(d.get("dependencies"))
    walk(json.loads(out.stdout).get("dependencies"))
    return found


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n in _shipped() if n not in notices]
    assert not missing, missing
    for font in ("Archivo", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices


ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}


def test_if_licences():
    bad = {}
    for name, d in _shipped().items():
        lic = d.get("license")
        lic = lic.get("type") if isinstance(lic, dict) else lic
        parts = {p.strip("() ") for p in re.split(r"\s+OR\s+", str(lic))}
        if not parts & ALLOWED:
            bad[name] = lic
    assert not bad, bad
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores():
    pkg = json.loads(Path("/app/package.json").read_text())
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    assert not {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level"} & set(deps)
    for root, dirs, files in os.walk("/app"):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        for fn in files:
            assert not re.search(r"\.(sqlite3?|db)$", fn), os.path.join(root, fn)
    with fresh_app() as f:
        assert len(f.pg.tables()) > 0


def test_if_service_config(killbill, mail):
    assert killbill.account_by_key(str(uuid.uuid4())) is None
    assert isinstance(S3().keys("nothing-here/"), list)
    assert isinstance(mail.messages(0, settle=0), list)


def test_if_no_third_party_hosts(browser, app_url):
    with ui(browser, app_url + "/") as page:
        seen = []
        page.on("request", lambda r: seen.append((r.url, r.resource_type)))
        page.reload()
        sign_in(page, ROSA)
        expect(page.get_by_role("radiogroup", name="Station type")).to_be_visible()
        page.goto(app_url + "/packs")
        expect(page.get_by_role("table", name="Hour ledger")).to_be_visible()
    assert seen and all(same_origin(u, app_url) or u.startswith("data:") for u, _ in seen)
    assert any(t == "font" for _, t in seen)


def test_if_typescript_only():
    ts_count, stray = 0, []
    for root, dirs, files in os.walk("/app"):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist", "build", ".next", "out", "coverage")]
        for fn in files:
            if fn.endswith((".ts", ".tsx")):
                ts_count += 1
            elif fn.endswith((".js", ".jsx", ".mjs", ".cjs")) and "config" not in fn and not fn.startswith("."):
                stray.append(os.path.join(root, fn))
    assert ts_count > 0 and not stray, stray
def test_truck_visit_recording():
    with fresh_app(clock="2026-10-24T11:00:01Z") as f:
        dana, ade = Api(f.url, DANA), Api(f.url, ADE)
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        assert code(ade.post(f"/api/trucks/{truck}/visits")) == "forbidden"
        r = dana.post(f"/api/trucks/{truck}/visits")
        assert r.status_code == 201 and r.json()["visit"]["departed_at"] is None
        assert code(dana.post(f"/api/trucks/{truck}/visits")) == "visit_open"
        vid = r.json()["visit"]["id"]
        assert "services" in dana.post(f"/api/visits/{vid}/depart", {"services": [], "operator_signature": "Theo Mbeki"}).json()["error"]["fields"]
        assert "operator_signature" in dana.post(f"/api/visits/{vid}/depart", {"services": ["grease"], "operator_signature": "T"}).json()["error"]["fields"]
        d = dana.post(f"/api/visits/{vid}/depart", {"services": ["potable_water", "grease"], "operator_signature": "Theo Mbeki"})
        assert d.status_code == 200
        dv = d.json()["visit"]
        assert dv["services"] == ["potable_water", "grease"] and dv["operator_signature"] == "Theo Mbeki"
        assert dv["manager_name"] == "Dana Okafor" and dv["departed_at"] is not None
        assert code(dana.post(f"/api/visits/{vid}/depart", {"services": ["grease"], "operator_signature": "Theo Mbeki"})) == "invalid_transition"


def test_inspector_link_issue(mail):
    with fresh_app(clock="2026-10-25T12:00:00Z", copies=[{"S3_ENDPOINT": "http://127.0.0.1:9"}], INSPECTOR_LINK_TTL_SECONDS=str(SHORT_LINK_TTL_S)) as f:
        dana = Api(f.url, DANA)
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        tenant = dana.me["user"]["tenant"]["id"]
        s3 = S3()
        seen = s3.keys(f"visit-logs/{tenant}/{truck}/")
        email = f"insp-{uuid.uuid4().hex[:8]}@health.example"
        r = dana.at(f.urls[1]).post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email})
        assert r.status_code == 503 and code(r) == "storage_unavailable"
        assert dana.get(f"/api/trucks/{truck}/inspector-links").json()["links"] == []
        assert s3.keys(f"visit-logs/{tenant}/{truck}/") == seen
        assert "inspector_email" in dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": "bad email@x"}).json()["error"]["fields"]
        link = dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email}).json()["link"]
        token = link["url"].rsplit("/", 1)[1]
        assert link["url"] == f"{f.url}/inspect/{token}" and re.fullmatch(r"[A-Za-z0-9_-]{22,}", token)
        assert (ts(link["expires_at"]) - ts(link["created_at"])).total_seconds() == SHORT_LINK_TTL_S
        assert link["state"] == "live"
        pdf = s3.get(f"visit-logs/{tenant}/{truck}/{link['id']}.pdf")
        assert pdf.startswith(b"%PDF-")
        m = mails(mail, lambda m: email in addresses(m["To"]))
        assert len(m) == 1 and subject(m[0]) == f"Commissary visit log: {TRUCK}"
        assert link["url"] in text(m[0])


def test_inspector_revoke_reissue():
    with fresh_app(clock="2026-10-25T12:00:00Z", INSPECTOR_LINK_TTL_SECONDS=str(SHORT_LINK_TTL_S)) as f:
        dana = Api(f.url, DANA)
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        email = f"insp-{uuid.uuid4().hex[:8]}@health.example"
        link = dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email}).json()["link"]
        token = link["url"].rsplit("/", 1)[1]
        pub = httpx.Client(base_url=f.url)
        assert pub.get(f"/api/inspect/{token}").status_code == 200
        assert dana.post(f"/api/inspector-links/{link['id']}/revoke").json()["link"]["state"] == "revoked"
        x = pub.get(f"/api/inspect/{token}")
        assert x.status_code == 410 and code(x) == "link_revoked"
        assert code(dana.post(f"/api/inspector-links/{link['id']}/revoke")) == "invalid_transition"
        assert code(dana.post(f"/api/inspector-links/{link['id']}/reissue")) == "invalid_transition"
        l2 = dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email}).json()["link"]
        r = dana.post(f"/api/inspector-links/{l2['id']}/reissue")
        assert r.status_code == 201 and r.json()["replaced"]["state"] == "revoked"
        assert r.json()["link"]["inspector_email"] == email
        new_token = r.json()["link"]["url"].rsplit("/", 1)[1]
        assert code(pub.get(f"/api/inspect/{l2['url'].rsplit('/', 1)[1]}")) == "link_revoked"
        assert pub.get(f"/api/inspect/{new_token}").status_code == 200
        wait_server(dana, r.json()["link"]["expires_at"])
        x = pub.get(f"/api/inspect/{new_token}")
        assert x.status_code == 410 and code(x) == "link_expired"


def test_inspector_copies_private(mail):
    with fresh_app(clock="2026-10-25T12:00:00Z") as f:
        dana = Api(f.url, DANA)
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        tenant = dana.me["user"]["tenant"]["id"]
        s3 = S3()
        email = f"insp-{uuid.uuid4().hex[:8]}@health.example"
        link = dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email}).json()["link"]
        token = link["url"].rsplit("/", 1)[1]
        ptxt = pdf_text(s3.get(f"visit-logs/{tenant}/{truck}/{link['id']}.pdf"))
        flat = re.sub(r"\s", "", ptxt)
        for want in ("SmokeSignal", "MFU-2291", "MbekiSmokeTruck", "CopperlineEastside", "TheoMbeki", "DanaOkafor"):
            assert want in flat
        assert not EMAIL_RE.search(ptxt) and not UUID_RE.search(ptxt)
        assert "PL-" not in ptxt and "pack hours" not in ptxt.lower() and "Steam Engine" not in ptxt
        body = text(mails(mail, lambda m: email in addresses(m["To"]))[0])
        assert link["url"] in body and "Copperline Eastside" in body
        assert not EMAIL_RE.search(body) and not UUID_RE.search(body) and "pack hours" not in body.lower()
        pub = httpx.Client(base_url=f.url)
        v = pub.get(f"/api/inspect/{token}")
        assert set(v.json()) == {"truck", "operator", "commissary", "expires_at", "overdue", "last_departed_at", "visits"}
        assert v.json()["truck"] == {"name": "Smoke Signal", "permit_number": "MFU-2291"}
        assert v.json()["operator"] == {"business_name": "Mbeki Smoke Truck"}
        assert set(v.json()["commissary"]) == {"site_name", "address", "time_zone"}
        assert all(set(x) == {"arrived_at", "departed_at", "services", "operator_signature", "manager_name", "gap_hours", "gap_flagged"} for x in v.json()["visits"])
        assert not EMAIL_RE.search(v.text) and not UUID_RE.search(v.text)


def test_inspector_view_layout_bands(browser, mail):
    with fresh_app(clock="2026-10-25T12:00:00Z") as f:
        dana = Api(f.url, DANA)
        truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
        email = f"insp-{uuid.uuid4().hex[:8]}@health.example"
        link = dana.post(f"/api/trucks/{truck}/inspector-links", {"inspector_email": email}).json()["link"]
        with ui(browser, link["url"], size=PHONE) as page:
            head = page.get_by_role("heading", name=f"{TRUCK} commissary visits")
            expect(head).to_be_visible()
            pdf = page.get_by_role("link", name="Download PDF")
            table = page.get_by_role("table", name="Commissary visits")
            notice = page.get_by_text("Overdue: last return 2026-10-23 07:00")
            for w in [PHONE[0], *EDGES, TABLET[0], DESKTOP[0]]:
                page.set_viewport_size({"width": w, "height": PHONE[1]})
                layout(page)
                hb, pb, tb, nb = head.bounding_box(), pdf.bounding_box(), table.bounding_box(), notice.bounding_box()
                assert pb["width"] >= MIN_TARGET and pb["height"] >= MIN_TARGET
                row = table.get_by_role("row").nth(1)
                if w >= DESKTOP[0] - 256:
                    assert pb["x"] >= hb["x"] + hb["width"]
                    assert nb["y"] <= hb["y"] + hb["height"] and tb["y"] >= pb["y"] + pb["height"]
                else:
                    assert hb["y"] + hb["height"] <= nb["y"] <= pb["y"] <= tb["y"]
                assert cells_stack(row) == (w < EDGES[1])
                if w < EDGES[1]:
                    assert pb["width"] >= 0.95 * tb["width"]


def test_rate_schedule_journey(browser):
    with fresh_app(clock="2026-11-10T06:00:30Z") as f:
        priya = Api(f.url, PRIYA)
        high = site(priya, HIGH)
        with ui(browser, f.url + "/rates", PRIYA) as page:
            combo = page.get_by_role("combobox", name="Site")
            table = page.get_by_role("table", name="Rate schedule")
            select(combo, HIGH)
            expect(table).to_contain_text(f"${money(3800)}")
            eff = page.get_by_label("Effective from")
            expect(eff).to_have_value("2026-11-10")
            new_from = "2026-12-01"
            eff.fill(new_from)
            page.get_by_role("textbox", name="Hourly rate (USD)").fill("45.00")
            page.get_by_role("textbox", name="Sales tax (%)").fill("8")
            page.get_by_role("button", name="Schedule rate").click()
            expect(status(page, "Rates status")).to_have_text(f"Rate scheduled from {new_from}.")
            expect(table.get_by_role("row").filter(has_text=new_from)).to_contain_text("Upcoming")
            expect(table.get_by_role("row").filter(has_text="2026-01-01")).to_contain_text("Current")
            select(combo, EAST)
            expect(page.get_by_label("Effective from")).to_have_value("2026-11-11")
        rates = priya.get(f"/api/sites/{high['id']}/rates").json()["rates"]
        assert any(r["effective_from"] == new_from and r["hourly_rate_cents"] == 4500 for r in rates)


def test_tenant_scoped_search_and_totals():
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        priya, marco = Api(f.url, PRIYA), Api(f.url, MARCO)
        mine = priya.get("/api/reports/utilisation", params={"month": "2026-11"}).json()
        assert [s["site_name"] for s in mine["sites"]] == [EAST, HIGH]
        theirs = marco.get("/api/reports/utilisation", params={"month": "2026-11"}).json()
        assert [s["site_name"] for s in theirs["sites"]] == [FERN] and theirs["totals"]["overage_cents"] == 0
        assert FERN not in priya.get("/api/reports/utilisation.csv", params={"month": "2026-11"}).text
        assert [m["business_name"] for m in priya.get("/api/members", params={"q": "sa"}).json()["members"]] == ["Lindqvist Hearth Bakery", "Sato Patisserie"]
        assert [m["business_name"] for m in priya.get("/api/members", params={"q": "sat"}).json()["members"]] == ["Sato Patisserie"]
        assert all(m["business_name"] not in ("Lindqvist Hearth Bakery", "Sato Patisserie")
                   for m in marco.get("/api/members", params={"q": "sa"}).json()["members"])
        names = {e["actor"]["name"] for e in marco.get("/api/audit").json()["events"] if e["actor"]}
        assert not names & {"Dana Okafor", "Rosa Lindqvist", "Priya Raman"}


def test_reports_journey(browser):
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        dana, ade, priya = Api(f.url, DANA), Api(f.url, ADE), Api(f.url, PRIYA)
        wait_server(dana, "2026-11-10T13:45:01Z")
        dana.post(f"/api/bookings/{by_ref(dana, site(dana, EAST)['id'], '2026-11-10', 'PL-SD0002')['id']}/no-show")
        with ui(browser, f.url + "/reports", PRIYA) as page:
            page.get_by_role("textbox", name="Month").fill("2026-11")
            member = page.get_by_role("combobox", name="Member")
            member.fill("Okonjo")
            see(page, "Okonjo Small Batch")
            page.get_by_role("option", name=re.compile("Okonjo Small Batch")).click()
            page.get_by_role("button", name="Show report").click()
            month = "2026-11"
            expect(status(page, "Report status")).to_have_text(f"Showing {month}.")
            table = page.get_by_role("table", name="Utilisation by site")
            expect(table.get_by_role("row").filter(has_text=EAST)).to_contain_text("1.00")
            csv_link = page.get_by_role("link", name="Download CSV")
            expect(csv_link).to_have_attribute("href", re.compile(rf"/api/reports/utilisation\.csv\?month=2026-11&member_id={ade.member_id}$"))
            href = csv_link.get_attribute("href")
            data = priya.get(urlparse(href).path + "?" + urlparse(href).query)
            assert data.status_code == 200 and "1.00" in data.text


def test_report_url_is_state(browser):
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        dana, ade = Api(f.url, DANA), Api(f.url, ADE)
        wait_server(dana, "2026-11-10T13:45:01Z")
        dana.post(f"/api/bookings/{by_ref(dana, site(dana, EAST)['id'], '2026-11-10', 'PL-SD0002')['id']}/no-show")
        with ui(browser, f.url + "/reports", PRIYA) as page:
            page.get_by_role("textbox", name="Month").fill("2026-11")
            member = page.get_by_role("combobox", name="Member")
            member.fill("Okonjo")
            see(page, "Okonjo Small Batch")
            page.get_by_role("option", name=re.compile("Okonjo Small Batch")).click()
            page.get_by_role("button", name="Show report").click()
            expect(page).to_have_url(re.compile(rf"/reports\?month=2026-11&member={ade.member_id}$"))
            csv_link = page.get_by_role("link", name="Download CSV")
            member.fill("")
            page.get_by_role("button", name="Show report").click()
            expect(page).to_have_url(re.compile(r"/reports\?month=2026-11$"))
            page.go_back()
            expect(member).to_have_value("Okonjo Small Batch")
            expect(csv_link).to_have_attribute("href", re.compile(f"member_id={ade.member_id}"))
            page.go_back()
            page.go_forward()
            page.go_forward()
            expect(page).to_have_url(re.compile(r"/reports\?month=2026-11$"))
            expect(member).to_have_value("")
            expect(csv_link).to_have_attribute("href", re.compile(r"utilisation\.csv\?month=2026-11$"))
        with ui(browser, f"{f.url}/reports?month=2026-11&member={ade.member_id}") as page:
            sign_in(page, PRIYA)
            expect(page).to_have_url(re.compile(rf"/reports\?month=2026-11&member={ade.member_id}$"))
            expect(page.get_by_role("combobox", name="Member")).to_have_value("Okonjo Small Batch")
            expect(page.get_by_role("table", name="Utilisation by site").get_by_role("row").filter(has_text=EAST)).to_contain_text("1.00")
        with ui(browser, f.url + "/reports?month=2026-13", PRIYA) as page:
            expect(status(page, "Report status")).to_have_text("Enter a month as YYYY-MM.")
            expect(page.get_by_role("table", name="Utilisation by site")).to_have_count(0)


def test_layout_band_edges(browser, app_url):
    for w in EDGES:
        with ui(browser, app_url + "/book", ROSA, size=(w, PHONE[1])) as page:
            page.get_by_role("radio", name="Ovens").check()
            oven = page.get_by_role("group", name=dial_of("Deck Oven 1"))
            expect(oven).to_be_visible()
            layout(page)
            assert (page.get_by_role("button", name="Menu").count() == 1) == (w < EDGES[1])
            dial = oven.bounding_box()
            tickets = page.get_by_role("list", name="Tickets")
            spike = tickets.bounding_box() if tickets.count() else None
            if spike is None:
                pass
            elif w >= EDGES[3]:
                assert spike["x"] >= dial["x"] + dial["width"] - 1
            else:
                assert spike["y"] >= dial["y"] + dial["height"] - 1
            page.goto(app_url + "/packs")
            a = page.get_by_role("button", name=f"Buy {STARTER}")
            b = page.get_by_role("button", name="Buy Production 30")
            expect(b).to_be_visible()
            layout(page)
            same_row = abs(a.bounding_box()["y"] - b.bounding_box()["y"]) < 2
            assert same_row == (EDGES[1] <= w <= EDGES[2])
            row = page.get_by_role("table", name="Hour ledger").get_by_role("row").nth(1)
            assert cells_stack(row) == (w < EDGES[1])
def test_bounded_work(app_url):
    dana, priya = Api(app_url, DANA), Api(app_url, PRIYA)
    assert dana.get("/api/members", params={"q": "a" * 100}).status_code == 200
    r = dana.get("/api/members", params={"q": "a" * (100 + 1)})
    assert r.status_code == 422 and "q" in r.json()["error"]["fields"]
    for month in ("2000-01", "2099-12"):
        assert priya.get("/api/reports/utilisation", params={"month": month}).status_code == 200
    rosa = Api(app_url, ROSA)
    pack = next(p for p in rosa.get("/api/packs").json()["packs"] if p["name"] == STARTER)
    before = ledger(rosa)["movements"]
    body = {"pack_id": pack["id"]}
    node = body
    for _ in range(20 + 1):
        node["nested"] = {}
        node = node["nested"]
    r = rosa.post("/api/pack-purchases", body, key=idempotency_key())
    assert r.status_code == 422 and "body" in r.json()["error"]["fields"]
    assert ledger(rosa)["movements"] == before


def test_published_surface_only(app_url):
    anon, dana = Api(app_url), Api(app_url, DANA)
    for path in ("/api/metrics", "/api/debug", "/api/.env", "/api/status", "/api/__debug__"):
        for api in (anon, dana):
            r = api.get(path)
            assert r.status_code == 404 and code(r) == "not_found"
    r = dana.req("PUT", "/api/health")
    assert r.status_code == 405 and code(r) == "method_not_allowed" and r.headers["allow"] == "GET"
    r = dana.req("DELETE", "/api/me")
    assert r.status_code == 405 and code(r) == "method_not_allowed" and r.headers["allow"] == "GET"


def test_audit_since_bounds(app_url):
    dana = Api(app_url, DANA)
    assert dana.get("/api/audit", params={"since": 2147483647}).status_code == 200
    r = dana.get("/api/audit", params={"since": 2147483647 + 1})
    assert r.status_code == 422 and "since" in r.json()["error"]["fields"]
    r = dana.req("POST", "/api/audit", {})
    assert r.status_code == 405 and code(r) == "method_not_allowed" and r.headers["allow"] == "GET"


def test_rates_body_depth(app_url):
    priya = Api(app_url, PRIYA)
    east = site(priya, EAST)
    before = priya.get(f"/api/sites/{east['id']}/rates").json()["rates"]
    body = {"effective_from": "2026-12-01", "hourly_rate_cents": 4500, "tax_rate_percent": "8"}
    node = body
    for _ in range(20 + 1):
        node["nested"] = {}
        node = node["nested"]
    r = priya.post(f"/api/sites/{east['id']}/rates", body)
    assert r.status_code == 422 and "body" in r.json()["error"]["fields"]
    assert priya.get(f"/api/sites/{east['id']}/rates").json()["rates"] == before


def test_inspector_link_body_depth(app_url):
    dana = Api(app_url, DANA)
    truck = dana.get("/api/members", params={"q": "Mbeki"}).json()["members"][0]["truck"]["id"]
    before = len(dana.get(f"/api/trucks/{truck}/inspector-links").json()["links"])
    body = {"inspector_email": f"insp-{uuid.uuid4().hex[:8]}@health.example"}
    node = body
    for _ in range(20 + 1):
        node["nested"] = {}
        node = node["nested"]
    r = dana.post(f"/api/trucks/{truck}/inspector-links", body)
    assert r.status_code == 422 and "body" in r.json()["error"]["fields"]
    assert len(dana.get(f"/api/trucks/{truck}/inspector-links").json()["links"]) == before


def test_notice_header_safety(mail):
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        dana = Api(f.url, DANA)
        east = site(dana, EAST)
        sd9 = by_ref(dana, east["id"], "2026-11-12", "PL-SD0009")
        tag = uuid.uuid4().hex[:6]
        reason = f"Mixer down {tag}\r\nSubject: hijacked {tag}\nBcc: nobody@health.example"
        r = dana.post(f"/api/bookings/{sd9['id']}/cancel", {"reason": reason})
        assert r.status_code == 200 and r.json()["booking"]["cancellation_reason"] == reason
        found = mails(mail, lambda m: tag in text(m))
        assert len(found) == 1
        m = found[0]
        assert subject(m) == mail_subject("Booking cancelled", "Blast Chiller", "2026-11-12", "08:45", "10:30")
        assert addresses(m["To"]) == [ADE]
        for field in ("Cc", "Bcc"):
            assert not addresses(m.get(field) or [])
        assert "nobody@health.example" not in addresses(m["To"])
        assert tag in text(m)
def test_forfeit_notice_is_elapsed_time():
    with fresh_app(clock="2026-10-30T14:30:00Z") as f:
        rosa = Api(f.url, ROSA)
        east = site(rosa, EAST)
        st = stations(rosa, east["id"], "2026-11-02")["Deck Oven 1"]
        bk = book(rosa, st, "2026-11-02", "10:00", "11:00")
        assert bk["status"] == "confirmed"
        r = rosa.post(f"/api/bookings/{bk['id']}/cancel")
        assert r.status_code == 200
        assert (r.json()["refunded_hours"], r.json()["forfeited_hours"]) == (1.0, 0)
        assert [m["kind"] for m in moves(rosa, bk["id"]) if m["kind"] != "booking_debit"] == ["cancel_refund"]
        check_ledger(rosa)
def test_rates_pending_button(browser):
    with fresh_app(clock="2026-11-10T06:00:30Z") as f:
        priya = Api(f.url, PRIYA)
        east = site(priya, EAST)
        with ui(browser, f.url + "/rates", PRIYA) as page:
            select(page.get_by_role("combobox", name="Site"), EAST)
            eff = page.get_by_label("Effective from")
            expect(eff).to_have_value(plus_days(east["local_date"], 1))
            new_from = "2026-12-01"
            eff.fill(new_from)
            page.get_by_role("textbox", name="Hourly rate (USD)").fill("45.00")
            page.get_by_role("textbox", name="Sales tax (%)").fill("8")
            btn = page.get_by_role("button", name="Schedule rate")
            posts = []

            def on_rates(route):
                if route.request.method == "POST":
                    posts.append(route)
                else:
                    route.continue_()

            page.route(f"**/api/sites/{east['id']}/rates", on_rates)
            btn.click()
            expect(status(page, "Rates status")).to_have_text("Saving…")
            expect(btn).to_have_attribute("aria-disabled", "true")
            expect(btn).to_be_focused()
            assert btn.get_attribute("disabled") is None
            btn.click(force=True)
            expect(btn).to_be_focused()
            assert len(posts) == 1
            posts[0].continue_()
            expect(status(page, "Rates status")).to_have_text(f"Rate scheduled from {new_from}.")
            assert btn.get_attribute("aria-disabled") in (None, "false")


def test_reports_pending_button(browser):
    with fresh_app(clock="2026-11-10T13:44:20Z", seed="site-day") as f:
        with ui(browser, f.url + "/reports", PRIYA) as page:
            month = "2026-11"
            page.get_by_role("textbox", name="Month").fill(month)
            btn = page.get_by_role("button", name="Show report")
            loads = []
            page.route("**/api/reports/utilisation?*", lambda route: loads.append(route))
            btn.click()
            expect(status(page, "Report status")).to_have_text("Loading report…")
            expect(btn).to_have_attribute("aria-disabled", "true")
            expect(btn).to_be_focused()
            assert btn.get_attribute("disabled") is None
            btn.click(force=True)
            expect(btn).to_be_focused()
            assert len(loads) == 1
            loads[0].continue_()
            expect(status(page, "Report status")).to_have_text(f"Showing {month}.")
            assert btn.get_attribute("aria-disabled") in (None, "false")


def test_visits_pending_button(browser):
    with fresh_app(clock="2026-10-24T11:00:30Z") as f:
        with ui(browser, f.url + "/trucks", DANA) as page:
            page.get_by_role("combobox", name="Find a member").fill("Mbeki")
            advance(page, TICK_MS)
            see(page, "Mbeki Smoke Truck")
            page.get_by_role("option", name=re.compile("Mbeki Smoke Truck")).click()
            page.get_by_role("button", name="Truck arrived").click()
            expect(status(page, "Visit log status")).to_have_text(re.compile(r"^Truck arrived at \d\d:\d\d\.$"))
            page.get_by_role("button", name="Truck departed").click()
            dlg = page.get_by_role("dialog", name="Record departure")
            dlg.get_by_role("checkbox", name="Cleaning").check()
            dlg.get_by_role("textbox", name="Operator signature").fill("Theo Mbeki")
            btn = dlg.get_by_role("button", name="Save departure")
            posts = []
            page.route("**/depart", lambda route: posts.append(route))
            btn.click()
            expect(status(page, "Visit log status")).to_have_text("Saving…")
            expect(btn).to_have_attribute("aria-disabled", "true")
            expect(btn).to_be_focused()
            assert btn.get_attribute("disabled") is None
            btn.click(force=True)
            expect(btn).to_be_focused()
            assert len(posts) == 1
            posts[0].continue_()
            expect(status(page, "Visit log status")).to_have_text(re.compile(r"^Departure recorded at \d\d:\d\d\.$"))
def test_signin_pending_button(browser, app_url):
    with ui(browser, app_url) as page:
        page.get_by_role("textbox", name="Email").fill(PRIYA)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        btn = page.get_by_role("button", name="Sign in")
        posts = []
        page.route("**/api/session", lambda route: posts.append(route))
        btn.click()
        expect(status(page, "Sign-in status")).to_have_text("Signing in…")
        expect(btn).to_have_attribute("aria-disabled", "true")
        expect(btn).to_be_focused()
        assert btn.get_attribute("disabled") is None
        btn.click(force=True)
        expect(btn).to_be_focused()
        assert len(posts) == 1
        posts[0].continue_()
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
def test_latest_balances_win(browser, killbill):
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        with ui(browser, f.url + "/packs", ROSA) as page:
            see(page, "Available pack hours 12.00")
            stale = []

            def hold_ledger(route):
                if route.request.method == "GET":
                    stale.append(route)
                else:
                    route.continue_()

            page.route("**/api/me/ledger*", hold_ledger)
            with page.expect_request(lambda r: "/api/me/ledger" in r.url and r.method == "GET", timeout=RESPONSE_WAIT_MS):
                advance(page, PACKS_REFRESH_MS)
            poll(lambda: page.evaluate("1") and len(stale), lambda n: n > 0, WAIT_S, "ledger refresh never reached the route")
            page.get_by_role("button", name="Buy Production 30").click()
            dlg = page.get_by_role("dialog", name="Buy Production 30")
            dlg.get_by_role("button", name="Pay and add hours").click()
            see(page, "Available pack hours 42.00")
            for route in stale:
                route.continue_()
            advance(page, TICK_MS)
            see(page, "Available pack hours 42.00")
            expect(page.get_by_role("table", name="Hour ledger").get_by_role("row").nth(1)).to_contain_text("Pack purchase")


def test_departure_dialog_focus_trap(browser):
    with fresh_app(clock="2026-10-24T11:00:30Z") as f:
        with ui(browser, f.url + "/trucks", DANA) as page:
            page.get_by_role("combobox", name="Find a member").fill("Mbeki")
            advance(page, TICK_MS)
            see(page, "Mbeki Smoke Truck")
            page.get_by_role("option", name=re.compile("Mbeki Smoke Truck")).click()
            page.get_by_role("button", name="Truck arrived").click()
            expect(status(page, "Visit log status")).to_have_text(re.compile(r"^Truck arrived at \d\d:\d\d\.$"))
            opener = page.get_by_role("button", name="Truck departed")
            opener.click()
            dlg = page.get_by_role("dialog", name="Record departure")
            first = dlg.get_by_role("checkbox", name="Potable water")
            close = dlg.get_by_role("button", name="Close")
            expect(first).to_be_focused()
            page.keyboard.press("Shift+Tab")
            expect(close).to_be_focused()
            page.keyboard.press("Tab")
            expect(first).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, MOTION_MAX_MS)
            expect(dlg).to_have_count(0)
            expect(opener).to_be_focused()


def test_reject_dialog_focus_trap(browser):
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        assert upload(Api(f.url, HANA), PDF, "application/pdf").status_code == 201
        with ui(browser, f.url + "/compliance", LUIS) as page:
            row = page.get_by_role("table", name="Documents awaiting review").get_by_role("row").filter(has_text=HANA_BIZ)
            opener = row.get_by_role("button", name="Reject")
            opener.click()
            dlg = page.get_by_role("dialog", name="Reject document")
            reason = dlg.get_by_role("textbox", name="Reason")
            close = dlg.get_by_role("button", name="Close")
            expect(reason).to_be_focused()
            page.keyboard.press("Shift+Tab")
            expect(close).to_be_focused()
            page.keyboard.press("Tab")
            expect(reason).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, MOTION_MAX_MS)
            expect(dlg).to_have_count(0)
            expect(opener).to_be_focused()


def test_member_cancel_dialog_focus_trap(browser):
    with fresh_app(clock="2026-11-10T13:44:15Z", seed="site-day") as f:
        with ui(browser, f.url + "/book", ROSA) as page:
            t8 = page.get_by_role("list", name="Tickets").get_by_role("listitem").filter(has_text="PL-SD0008")
            opener = t8.get_by_role("button", name="Cancel booking")
            opener.click()
            ref = "PL-SD0008"
            dlg = page.get_by_role("dialog", name=f"Cancel booking {ref}")
            confirm = dlg.get_by_role("button", name="Confirm cancellation")
            keep = dlg.get_by_role("button", name="Keep booking")
            expect(confirm).to_be_focused()
            page.keyboard.press("Shift+Tab")
            expect(keep).to_be_focused()
            page.keyboard.press("Tab")
            expect(confirm).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, MOTION_MAX_MS)
            expect(dlg).to_have_count(0)
            expect(opener).to_be_focused()


def test_manager_cancel_dialog_focus_trap(browser):
    with fresh_app(clock="2026-11-10T13:42:30Z", seed="site-day") as f:
        with ui(browser, f.url + "/site", DANA) as page:
            page.get_by_role("button", name="Next day").click()
            page.get_by_role("button", name="Next day").click()
            row = page.get_by_role("table", name="Bookings").get_by_role("row").filter(has_text="Blast Chiller")
            opener = row.get_by_role("button", name="Cancel booking")
            opener.click()
            ref = "PL-SD0009"
            dlg = page.get_by_role("dialog", name=f"Cancel booking {ref}")
            reason = dlg.get_by_role("textbox", name="Reason")
            keep = dlg.get_by_role("button", name="Keep booking")
            expect(reason).to_be_focused()
            page.keyboard.press("Shift+Tab")
            expect(keep).to_be_focused()
            page.keyboard.press("Tab")
            expect(reason).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, MOTION_MAX_MS)
            expect(dlg).to_have_count(0)
            expect(opener).to_be_focused()


def test_checkout_dialog_focus_trap(browser, killbill):
    with fresh_app(clock="2026-11-10T13:43:30Z", seed="site-day") as f:
        with ui(browser, f.url + "/site", DANA) as page:
            row = page.get_by_role("table", name="Bookings").get_by_role("row").filter(has_text="Blast Chiller")
            opener = row.get_by_role("button", name="Check out")
            opener.click()
            business = "Mbeki Smoke Truck"
            dlg = page.get_by_role("dialog", name=f"Check out {business}")
            confirm = dlg.get_by_role("button", name="Confirm check-out")
            keep = dlg.get_by_role("button", name="Keep checked in")
            expect(confirm).to_be_focused()
            page.keyboard.press("Shift+Tab")
            expect(keep).to_be_focused()
            page.keyboard.press("Tab")
            expect(confirm).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, MOTION_MAX_MS)
            expect(dlg).to_have_count(0)
            expect(opener).to_be_focused()


def test_signin_again_dialog_focus_trap(browser):
    with fresh_app(clock="2026-10-30T15:00:00Z") as f:
        with ui(browser, f.url + "/packs", ROSA) as page:
            sent = []

            def purchase(route):
                sent.append(1)
                route.fulfill(status=401, content_type="application/json; charset=utf-8",
                              body=json.dumps({"error": {"code": "session_expired",
                                                         "message": "Session ended."}}))

            page.route("**/api/pack-purchases", purchase)
            page.get_by_role("button", name="Buy Production 30").click()
            dlg = page.get_by_role("dialog", name="Buy Production 30")
            dlg.get_by_role("button", name="Pay and add hours").click()
            again = page.get_by_role("dialog", name="Sign in again")
            pw = again.get_by_label("Password", exact=True)
            cont = again.get_by_role("button", name="Sign in and continue")
            out = again.get_by_role("button", name="Sign out")
            expect(pw).to_be_focused()
            page.keyboard.press("Shift+Tab")
            expect(out).to_be_focused()
            page.keyboard.press("Tab")
            expect(pw).to_be_focused()
            page.keyboard.press("Tab")
            expect(cont).to_be_focused()
            assert len(sent) == 1
