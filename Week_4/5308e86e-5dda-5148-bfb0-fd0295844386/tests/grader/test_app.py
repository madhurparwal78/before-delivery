import calendar
import concurrent.futures as cf
import csv
import hashlib
import io
import json
import os
import re
import signal
import socket
import statistics
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
import contextlib
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import axe, changed, decode, difference, focused_name, held, layout, select, style, tab_order, shipped_packages

try:
    from conftest import Postgres
except ImportError:
    from postgres import Postgres

try:
    from conftest import DEPLOYED_APP
except ImportError:
    DEPLOYED_APP = os.environ.get("DEPLOYED_APP", "/app")


PASSWORD = "deku-demo-pw-2026"
OWNER = "owner@example.com"
ADMIN = "admin@example.com"
MEMBER = "member@example.com"
OUTSIDER = "outsider@example.com"
SYSTEM_ACTOR = "system@tallwind.invalid"
CHECKING_SEED = 1842050
SAVINGS_SEED = 6000000
OUTPOST_SEED = 250000
APPROVAL_THRESHOLD = 500000
DUAL_THRESHOLD = 5000000
DUAL_HELD = 5000100
SAVINGS_AVAILABLE_AFTER_HOLD = 999900
HELD_TRANSFER = 1000000
HELD_6000 = 600000
HELD_6400 = 640000
LOAN_PRINCIPAL = 25000000
INVOICES = {"INV-1002": 275000, "INV-1003": 90000, "INV-1004": 61875, "INV-1005": 12500}
SPARK_DAYS = 30
CHECKING_SPARK = [0] * 9 + [1555690] * 8 + [1975690] * 6 + [1850690] * 4 + [1842050] * 3
SAVINGS_SPARK = [0] * 4 + [6000000] * 26
OUTPOST_SPARK = [0] * 19 + [250000] * 11
FEED_PAGE = 50
FEED_ROWS = 160
SHOWN_AFTER_TWO = 150
SHOWN_AFTER_NEW = 153
SEARCH_MAX = 100
SEARCH_CAP = 20
SEARCH_BUDGET_S = 2
NAME_LIMIT = 120
MESSAGE_LIMIT = 5000
BODY_CAP = 32768
INQUIRY_BUDGET_S = 2
INQUIRY_RATE = 5
STREAM_S = 2
STREAM_COUNT = 100
MAX_DB_CONNECTIONS = 10
STREAM_RELEASE_S = 5
REFRESH_MS = 10000
APPROVALS_LIVE_S = 5
SETTLEMENT_UPDATE_S = 5
REVOKE_S = 5
SIGNOUT_WATCH_MS = 12000
CELEBRATION_MS = 3000
MOTION_MAX_MS = 500
POSTING_S = 60
RECOVERY_S = 10
OUTAGE_DEADLINE_S = 12
BOOT_NOW = "2026-12-01T04:59:00Z"
BOOT_GAP_S = 90
SEED_NOW = "2027-07-02T16:00:00Z"
TYPING_PAUSE_MS = 400
ROUTE_LATE_MS = 1500
LOCKOUT_COUNT = 5
FOCUS_MIN_PX = 2
DESKTOP = (1280, 800)
PHONE = (375, 812)
EDGE_WIDTHS = [599, 600, 1023, 1024]
REFLOW_WIDTHS = [320, 375, 768, 1280]
POLL_S = 0.2
SLACK_S = 3
BOOT_S = 180
EDGE_MARGIN_S = 120
OUTAGE_COPY = "Tallwind can't be reached right now. Try again in a moment."
BACK_COPY = "Tallwind is back online."
SERVER_ERROR_COPY = "Something went wrong. Try again."
DOLLAR_COPY = "Enter an amount in dollars and cents, such as 12.50"
AVAILABLE_RE = re.compile(r"^Available \$[\d,]+\.\d{2}$")
RAIL_ONLY = {"Payments", "Recipients", "Approvals", "Invoicing", "Loans", "Cards", "Treasury", "Bill Pay",
             "Profile", "Log out"}
SEARCH_PLACEHOLDER = "Search transactions, recipients, or jump to a payment"
NY = ZoneInfo("America/New_York")
WRONG_TZ = "Pacific/Kiritimati"
WRONG_CLOCK = "2031-03-09T03:00:00Z"
PUBLIC_PAGES = ["/", "/business-banking", "/business-payments", "/credit", "/treasury", "/invoicing",
                "/spend-management", "/payroll", "/books", "/venture-debt", "/working-capital-loans", "/pricing",
                "/contact", "/demo", "/login", "/signup"]
COCKPIT = "/" + "app"
ACCOUNT_PAGE = COCKPIT + "/accounts/"
FILTERED = COCKPIT + "?method=ach&direction=out"
COCKPIT_PAGES = [COCKPIT, "/payments", "/payments/new", "/payments/recipients", "/payments/recipients/new",
                 "/approvals", "/invoices", "/loans", "/cards", "/treasury-account", "/bill-pay"]
AXE_PAGES = ["/", "/business-banking", "/business-payments", "/pricing", "/contact", "/login", "/signup",
             "/credit", "/treasury"]
AXE_COCKPIT = [COCKPIT, "/payments/new", "/approvals", "/payments/recipients", "/payments/recipients/new",
               "/invoices", "/loans"]

STATUS_LOGS = {}

SMALL_CENTS = 1250
TWIN_NAME = "Twin Vendor"
STALE_NAME = "Stale Vendor"
HARBOR_NAME = "Harbor Freight Co"
HARBOR_NUMBER = "000555512345"
AGAIN_NAME = "Northwind Again"
TYPED_NAME = "Typed"
BIDI_NAME = "Northwind\u202Eylppus"
AT_MEMO = "@bookkeeper"
QUOTED_MEMO = 'Net "30", due'
CLIENT_ID = "client-id"
UNKNOWN_ACCOUNT_PATH = "/api/accounts/nope"
LEAK_FLAG = "twLeak"
LATER_NOW = "2027-08-02T16:00:00Z"
CHECKING_LEFT = 2050
CORS_HEADER = "Access-Control-Allow-Origin"
LEAD = {"first": "Ada", "last": "Lovelace", "company": "Analytical Co", "message": "Please call us about treasury."}
DUPLICATE_COPY = "This recipient is already saved as " + "Northwind Supply" + "."


def approve_name(cents, source, verb="Approve"):
    return verb + " " + dollars(cents) + " to Northwind Supply from " + source


def progress(given, required):
    return f"{given} of {required} approvals"


def _pause(seconds):
    threading.Event().wait(seconds)


def poll(fn, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() <= deadline:
        try:
            if fn():
                return
        except httpx.TransportError:
            pass
        _pause(POLL_S)
    raise AssertionError(f"timed out after {seconds}s: {message}")


TRY_MS = 100  # one short expect() try inside eventually() / ready()
EXPECT_MS = 5000  # Playwright's default expect() timeout: this bundle never changes it
ACTION_MS = 30000  # Playwright's default action timeout: ui() never changes it
CLOCK_STEP_MS = 50
PAUSED_PAGES = set()  # id() of pages whose clock ui(paused=True) paused; every other ui() clock runs in real time


def eventually(page, check, timeout_ms=EXPECT_MS):
    """Retry check() until it raises no AssertionError and return its value; re-raise its last AssertionError once
    timeout_ms of real time has passed (never sooner than the plain expect() it replaces). On a page whose clock
    ui(paused=True) paused, the page clock moves CLOCK_STEP_MS between tries; other pages' clocks already run."""
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        try:
            return check()
        except AssertionError:
            if time.monotonic() >= deadline:
                raise
        if id(page) in PAUSED_PAGES:
            page.clock.run_for(CLOCK_STEP_MS)


READY_CHECKS = {"attached": lambda loc: expect(loc).to_be_attached(timeout=TRY_MS),
                "visible": lambda loc: expect(loc).to_be_visible(timeout=TRY_MS),
                "enabled": lambda loc: expect(loc).to_be_enabled(timeout=TRY_MS)}


def ready(locator, *needs, timeout_ms=ACTION_MS):
    """The locator once Playwright's own actionability checks for the coming action hold (default visible and enabled,
    as for click/fill; "visible" for hover; "attached" for focus/press_sequentially), waited for through eventually()
    for as long as the action itself would wait: `ready(x).click()` then performs the very same action."""
    eventually(locator.page, lambda: [READY_CHECKS[n](locator) for n in needs or ("visible", "enabled")], timeout_ms)
    return locator


def together(*fns):
    barrier = threading.Barrier(len(fns))

    def run(fn):
        barrier.wait()
        return fn()

    with cf.ThreadPoolExecutor(len(fns)) as pool:
        return list(pool.map(run, fns))


def lit(value):
    return "'" + str(value).replace("'", "''") + "'"


def identity(prefix="visitor"):
    tag = uuid.uuid4().hex[:12]
    return f"{prefix}-{tag}@example.com", f"{prefix.title()} {tag[:6]}"


def account_number():
    return str(uuid.uuid4().int)[:12]


def idem():
    return uuid.uuid4().hex


def dollars(cents):
    return f"${cents // 100:,}.{cents % 100:02d}"


def csv_money(cents):
    return f"{'-' if cents < 0 else ''}{abs(cents) // 100}.{abs(cents) % 100:02d}"


def csv_cents(text):
    return int(Decimal(text) * 100)


def parse_ts(value):
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def ny_noon(day):
    return datetime(day.year, day.month, day.day, 12, tzinfo=NY).astimezone(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _headers(token=None, key=None, extra=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if key:
        h["Idempotency-Key"] = key
    if extra:
        h.update(extra)
    return h


def get(base, path, token=None, params=None):
    return httpx.get(base + path, headers=_headers(token), params=params, timeout=30)


def send(base, method, path, token=None, body=None, key=None, headers=None, content=None):
    h = _headers(token, key, headers)
    if content is None and body is not None:
        content = json.dumps(body, ensure_ascii=False).encode("utf-8")
    if content is not None and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    return httpx.request(method, base + path, headers=h, content=content, timeout=30)


def post(base, path, token=None, body=None, key=None):
    return send(base, "POST", path, token, body, key)


def raw_post(base, path, token, body):
    return send(base, "POST", path, token, content=json.dumps(body, ensure_ascii=True).encode("ascii"))


def error_of(r):
    try:
        return r.json().get("error")
    except ValueError:
        return None


def assert_validation(r, field):
    assert r.status_code == 400, (r.status_code, r.text)
    body = r.json()
    assert body["error"] == "validation" and field in body["fields"], body


def login(base, email, password=PASSWORD):
    r = post(base, "/api/auth/login", None, {"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def signup(base, prefix="owner"):
    email, name = identity(prefix)
    r = post(base, "/api/auth/signup", None, {"email": email, "name": name, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return r.json()["token"], email, name


def me(base, token):
    r = get(base, "/api/me", token)
    assert r.status_code == 200, r.text
    return r.json()


def snapshot(base, token):
    r = get(base, "/api/snapshot", token)
    assert r.status_code == 200, r.text
    return r.json()


def account_entry(base, token, account_id):
    return next(e for e in snapshot(base, token)["per_account"] if e["account_id"] == account_id)


def newest_tx(base, token, account_id):
    return get(base, "/api/transactions", token, {"account_id": account_id, "limit": 1}).json()["transactions"][0]


def pay(base, token, source, recipient, amount, method="ach", memo=None, scheduled_for=None, key=None,
        fx_quote_id=None, extra=None):
    body = {"source_account_id": source, "recipient_id": recipient, "method": method, "amount_cents": amount}
    if memo is not None:
        body["memo"] = memo
    if scheduled_for is not None:
        body["scheduled_for"] = scheduled_for
    if fx_quote_id is not None:
        body["fx_quote_id"] = fx_quote_id
    if extra:
        body.update(extra)
    return post(base, "/api/payments", token, body, key)


def transfer(base, token, frm, to, amount, memo=None, key=None):
    return post(base, "/api/transfers", token,
                {"from_account_id": frm, "to_account_id": to, "amount_cents": amount, "memo": memo}, key)


def add_recipient(base, token, name, number=None):
    return post(base, "/api/recipients", token, {
        "display_name": name, "kind": "business", "method": "ach",
        "account_number": number or account_number(), "routing_number": "021000021"})


def new_account(base, token, name):
    r = post(base, "/api/accounts", token, {"name": name, "kind": "checking"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def wait_business(base, token, instant, seconds):
    target = parse_ts(instant)
    poll(lambda: parse_ts(me(base, token)["business_now"]) >= target, seconds, f"business clock reaches {instant}")


def later(app, token):
    return me(app.url, token)["business_now"]


def balance(pg, account_id):
    return int(pg.rows(f"SELECT balance_cents FROM accounts WHERE id::text = {lit(account_id)}")[0]["balance_cents"])


def ledger_net(pg, account_id):
    row = pg.rows("SELECT coalesce(sum(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)"
                  f"::bigint AS n FROM transactions WHERE account_id::text = {lit(account_id)}")[0]
    return int(row["n"])


def count(pg, sql):
    return int(pg.rows(sql)[0]["n"])


def audit_rows(pg, company_id):
    return pg.rows(f"SELECT seq, action, payment_id::text AS payment_id, amount_cents, actor_email, prev_hash, hash "
                   f"FROM audit_events WHERE company_id::text = {lit(company_id)} ORDER BY seq")


def check_chain(events):
    prev = "0" * 64
    for i, e in enumerate(events, 1):
        assert int(e["seq"]) == i, events
        assert e["prev_hash"] == prev
        payload = f"{prev}|{e['seq']}|{e['action']}|{e['payment_id'] or ''}|{e['amount_cents']}|{e['actor_email']}"
        assert e["hash"] == hashlib.sha256(payload.encode()).hexdigest()
        prev = e["hash"]


def invoice_ids(base, token):
    return {i["number"]: i["id"] for i in get(base, "/api/invoices", token).json()["invoices"]}


def loan(base, token):
    return get(base, "/api/loans", token).json()["loans"][0]


def inquiry(email, **over):
    body = {"email": email, "first_name": "Ada", "last_name": "Lovelace", "company": "Analytical Co",
            "message": "We would like a demo.", "source": "contact"}
    body.update(over)
    return body


class Relay:
    def __init__(self, host, port):
        self.target = (host, port)
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        self.port = probe.getsockname()[1]
        probe.close()
        self.listener = None
        self.conns = []
        self.lock = threading.Lock()

    def restore(self):
        if self.listener:
            return
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(128)
        self.listener = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def _accept(self, s):
        while True:
            try:
                client, _ = s.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=10)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.conns += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a, b):
        try:
            while True:
                data = a.recv(65536)
                if not data:
                    break
                b.sendall(data)
        except OSError:
            pass
        finally:
            for x in (a, b):
                try:
                    x.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                x.close()

    def cut(self):
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


class AppCopy:
    def __init__(self, now=None, env=None):
        self.base_url = os.environ["DATABASE_URL"]
        parts = urllib.parse.urlsplit(self.base_url)
        self.suffix = "_tw" + uuid.uuid4().hex[:10]
        self.dbname = parts.path.lstrip("/") + self.suffix
        subprocess.run(["psql", self.base_url, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{self.dbname}"'],
                       check=True, capture_output=True, timeout=60)
        self.relay = Relay(parts.hostname or "127.0.0.1", parts.port or 5432)
        userinfo = parts.netloc.rpartition("@")[0]
        netloc = (userinfo + "@" if userinfo else "") + f"127.0.0.1:{self.relay.port}"
        self.database_url = urllib.parse.urlunsplit((parts.scheme, netloc, "/" + self.dbname, parts.query, ""))
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        self.port = probe.getsockname()[1]
        probe.close()
        self.url = f"http://127.0.0.1:{self.port}"
        self.now = now
        self.extra = env or {}
        self.proc = None
        self.log_path = Path(tempfile.mkstemp(prefix="tallwind-copy-", suffix=".log")[1])

    def _launch(self):
        serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
        env = dict(os.environ, DATABASE_URL=self.database_url, APP_PUBLIC_PORT=str(self.port),
                   APP_PUBLIC_URL=self.url, APP_NOW=self.now or "", **self.extra)
        log = open(self.log_path, "ab")
        self.proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)

    def tail(self):
        return self.log_path.read_text(errors="replace")[-3000:]

    def wait_healthy(self, seconds=BOOT_S):
        def ok():
            if self.proc.poll() is not None:
                raise AssertionError(f"serve copy exited: {self.tail()}")
            return httpx.get(self.url + "/api/health", timeout=5).status_code == 200
        poll(ok, seconds, f"copy healthy; log: {self.tail()}")

    def wait_listening(self):
        def ok():
            if self.proc.poll() is not None:
                raise AssertionError(f"serve copy exited: {self.tail()}")
            httpx.get(self.url + "/api/health", timeout=5)
            return True
        poll(ok, BOOT_S, "copy listening")

    def _kill(self):
        if self.proc and self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(15)
            except (subprocess.TimeoutExpired, ProcessLookupError):
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.proc.wait(15)

    def start(self, db_up=True):
        if db_up:
            self.relay.restore()
        self._launch()
        if db_up:
            self.wait_healthy()
        else:
            self.wait_listening()

    def restart(self, now=None):
        self._kill()
        if now is not None:
            self.now = now
        self._launch()
        self.wait_healthy()

    def pg(self):
        return Postgres(self.suffix)

    def stop(self):
        self._kill()
        self.relay.cut()
        subprocess.run(["psql", self.base_url, "-c", f'DROP DATABASE IF EXISTS "{self.dbname}" WITH (FORCE)'],
                       capture_output=True, timeout=60)


@contextmanager
def copy_app(now=None, db_up=True, env=None):
    app = AppCopy(now, env)
    try:
        app.start(db_up)
        yield app
    finally:
        app.stop()


class Lark:
    def __init__(self, base):
        self.owner = login(base, OWNER)
        self.admin = login(base, ADMIN)
        self.member = login(base, MEMBER)
        self.outsider = login(base, OUTSIDER)
        accounts = {a["name"]: a["id"] for a in get(base, "/api/accounts", self.owner).json()["accounts"]}
        self.checking, self.savings = accounts["Checking"], accounts["Savings"]
        self.outpost = get(base, "/api/accounts", self.outsider).json()["accounts"][0]["id"]
        self.northwind = next(r["id"] for r in get(base, "/api/recipients", self.owner).json()["recipients"]
                              if r["display_name"] == "Northwind Supply")
        self.cedar = next(r["id"] for r in get(base, "/api/recipients", self.outsider).json()["recipients"]
                          if r["display_name"] == "Cedar Freight")
        self.company = me(base, self.owner)["user"]["company_id"]
        self.outpost_company = me(base, self.outsider)["user"]["company_id"]


class Stream:
    def __init__(self, base, token, last_event_id=None, header_last_id=None):
        params = {"token": token}
        if last_event_id:
            params["last_event_id"] = last_event_id
        self.headers_out = {"Last-Event-ID": header_last_id} if header_last_id else {}
        self.url, self.params = base + "/api/stream", params
        self.client = httpx.Client(timeout=httpx.Timeout(10, read=None))
        self.events, self.status, self.headers, self.ended, self.response = [], None, {}, None, None
        self._ready = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()
        self._ready.wait(15)

    def _run(self):
        try:
            with self.client.stream("GET", self.url, params=self.params, headers=self.headers_out) as r:
                self.status, self.headers, self.response = r.status_code, r.headers, r
                self._ready.set()
                if r.status_code != 200:
                    r.read()
                    return
                event = {}
                for line in r.iter_lines():
                    if line == "":
                        if event.get("event") == "transaction" and "data" in event:
                            self.events.append((event.get("id"), json.loads(event["data"]), time.monotonic()))
                        event = {}
                    elif line.startswith(":"):
                        continue
                    else:
                        k, _, v = line.partition(":")
                        v = v[1:] if v.startswith(" ") else v
                        event[k] = event.get(k, "") + ("\n" if k == "data" and k in event else "") + v
        except Exception:
            pass
        finally:
            self.ended = time.monotonic()
            self._ready.set()

    def transactions(self):
        return list(self.events)

    def tx_ids(self):
        return [e[1]["id"] for e in self.events]

    def close(self):
        try:
            if self.response is not None:
                self.response.close()
        except Exception:
            pass
        try:
            self.client.close()
        except Exception:
            pass


STATUS_JS = """(() => {
  const push = (t) => { try { if (window.__twStatusLog) window.__twStatusLog(t); } catch (e) {} };
  const region = (n) => { const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return el && el.closest ? el.closest('[role="status"], output') : null; };
  new MutationObserver((records) => {
    for (const r of records) {
      const reg = region(r.target); if (!reg) continue;
      if (r.type === 'characterData') { push(reg.textContent); continue; }
      if (r.addedNodes.length) push([...r.addedNodes].map(n => n.textContent).join(''));
      else if (r.removedNodes.length && !reg.textContent.trim()) push('');
    }
  }).observe(document, {subtree: true, childList: true, characterData: true});
})();"""


@contextmanager
def ui(browser, width=DESKTOP[0], height=DESKTOP[1], scripts=(), timezone=None, clock_time=None, reduced=False,
       paused=False):
    kwargs = {"viewport": {"width": width, "height": height}, "accept_downloads": True,
              "reduced_motion": "reduce" if reduced else "no-preference"}
    if timezone:
        kwargs["timezone_id"] = timezone
    context = browser.new_context(**kwargs)
    context.add_init_script(STATUS_JS)
    for script in scripts:
        context.add_init_script(script)
    page = context.new_page()
    log = []
    STATUS_LOGS[id(page)] = log
    page.expose_function("__twStatusLog", lambda t: log.append((t or "").strip()))
    start = clock_time or datetime.now(timezone.utc if False else None).astimezone().isoformat()
    page.clock.install(time=start)
    if paused:
        page.clock.pause_at(parse_ts(start) + timedelta(seconds=1))
        PAUSED_PAGES.add(id(page))
    try:
        yield page
    finally:
        PAUSED_PAGES.discard(id(page))
        STATUS_LOGS.pop(id(page), None)
        context.close()


def status_log(page):
    with contextlib.suppress(Exception):
        page.evaluate("0")
    return list(STATUS_LOGS.get(id(page), []))


def wait_status(page, text, seconds=10):
    poll(lambda: any(text in t for t in status_log(page)), seconds, f"status announced {text!r}")


VISIBLE_TEXT_JS = """t => [...document.body.querySelectorAll('*')].some(e => {
  if (!e.textContent.includes(t) || [...e.children].some(c => c.textContent.includes(t))) return false;
  if (e.tagName === 'OPTION') { const s = e.closest('select'); return e.selected && !!s && s.checkVisibility(); }
  return e.checkVisibility() && e.getBoundingClientRect().width > 1; })"""


def wait_text(page, text, seconds=10):
    deadline = time.monotonic() + seconds
    while not page.evaluate(VISIBLE_TEXT_JS, text):
        assert time.monotonic() < deadline, f"{text!r} never visible"
        _pause(POLL_S)


AS_WRITTEN_JS = """e => { if (!e) return ''; const s = document.createElement('style');
  s.textContent = '* { text-transform: none !important; }'; document.head.append(s);
  try { return e.innerText; } finally { s.remove(); } }"""


def body_text(page):
    return page.evaluate(f"() => ({AS_WRITTEN_JS})(document.body)")


def written(locator):
    return locator.evaluate(AS_WRITTEN_JS)


def ui_login(page, base, email, password=PASSWORD, path="/login"):
    page.goto(base + path)
    ready(page.get_by_label("Email", exact=True)).fill(email)
    ready(page.get_by_label("Password", exact=True)).fill(password)
    ready(page.get_by_role("button", name="Log in", exact=True)).click()
    page.wait_for_url(lambda u: "/login" not in u, timeout=15000)


def named(page, name):
    return (page.get_by_role("menuitem", name=name, exact=True)
            .or_(page.get_by_role("link", name=name, exact=True))
            .or_(page.get_by_role("button", name=name, exact=True)))


def ui_logout(page):
    ready(page.get_by_role("button", name="Account menu")).click()
    ready(named(page, "Log out").first).click()
    page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == "/", timeout=15000)


def feed(page):
    named = re.compile("transaction", re.I)
    in_main = page.get_by_role("main").get_by_role("list", name=named)
    return in_main if in_main.count() else page.get_by_role("list", name=named)


def feed_count(page):
    return feed(page).first.get_by_role("listitem").count()


def history_len(page):
    return page.evaluate("() => history.length")


def selected_label(locator):
    return locator.evaluate("el => el.options ? (el.options[el.selectedIndex] || {textContent: ''}).textContent.trim()"
                            " : (el.value || el.textContent || '').trim()")


def option_labels(locator):
    return locator.evaluate("el => Array.from(el.options || []).map(o => o.textContent.trim())")


def choose(locator, prefix):
    label = next(l for l in option_labels(locator) if l.startswith(prefix))
    select(locator, label)
    return label


def storage_dump(page):
    return page.evaluate("() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])")


def assert_round(locator):
    box = locator.bounding_box()
    radius = style(locator, "border-top-left-radius")["border-top-left-radius"]
    if radius.endswith("%"):
        assert float(radius[:-1]) >= 50, radius
    else:
        assert float(radius.split("px")[0]) >= box["height"] / 2 - 0.5, (radius, box)


def card_rows(page):
    tops = sorted(round(b["y"]) for b in (el.bounding_box() for el in page.get_by_text(AVAILABLE_RE).all()) if b)
    rows = []
    for top in tops:
        if not rows or top - rows[-1] > 8:
            rows.append(top)
    return len(rows)


def query_list(url):
    return urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query, keep_blank_values=True)


def live_url(page):
    """The document's own address. page.url can miss the last history.replaceState of a burst."""
    return page.evaluate("() => location.href")


class Net:
    def __init__(self, page):
        self.reqs = []
        page.on("request", self._on)

    def _on(self, req):
        if "/api/" not in req.url:
            return
        auth = req.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else \
            urllib.parse.parse_qs(urllib.parse.urlsplit(req.url).query).get("token", [None])[0]
        try:
            body = req.post_data or ""
        except Exception:
            body = ""
        self.reqs.append({"url": req.url, "t": time.monotonic(), "token": token, "body": body,
                          "method": req.method, "headers": dict(req.headers)})

    def token(self):
        return next((r["token"] for r in reversed(self.reqs) if r["token"]), None)

    def api(self, path, method=None):
        return [r for r in self.reqs if path in r["url"] and (method is None or r["method"] == method)]


def draft_url(base, **params):
    order = ["source", "recipient", "method", "amount", "memo", "send_on", "step"]
    q = [(k, params[k]) for k in order if params.get(k) is not None]
    return base + "/payments/new" + ("?" + urllib.parse.urlencode(q) if q else "")


def test_snapshot_seeded_state():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        snap = snapshot(app.url, lk.owner)
        order = [a["id"] for a in get(app.url, "/api/accounts", lk.owner).json()["accounts"]]
        assert [e["account_id"] for e in snap["per_account"]] == order == [lk.checking, lk.savings]
        by_id = {e["account_id"]: e for e in snap["per_account"]}
        assert by_id[lk.checking]["sparkline"] == CHECKING_SPARK
        assert by_id[lk.savings]["sparkline"] == SAVINGS_SPARK
        for e in snap["per_account"]:
            assert isinstance(e["balance_cents"], int) and e["available_cents"] == e["balance_cents"]
            assert len(e["sparkline"]) == SPARK_DAYS and all(isinstance(v, int) for v in e["sparkline"])
            assert e["sparkline"][-1] == e["balance_cents"]
        assert snap["total_cash_cents"] == CHECKING_SEED + SAVINGS_SEED == sum(e["balance_cents"] for e in snap["per_account"])
        assert snap["total_available_cents"] == sum(e["available_cents"] for e in snap["per_account"])
        out = snapshot(app.url, lk.outsider)
        assert [e["sparkline"] for e in out["per_account"]] == [OUTPOST_SPARK]
        assert out["total_cash_cents"] == OUTPOST_SEED
        pg = app.pg()
        assert balance(pg, lk.checking) == CHECKING_SEED == ledger_net(pg, lk.checking)
        seeded = pg.rows(f"SELECT memo, transfer_id FROM transactions WHERE account_id::text = {lit(lk.checking)}")
        assert all(r["memo"] is None and r["transfer_id"] is None for r in seeded)
        assert pay(app.url, lk.owner, lk.checking, lk.northwind, 1250).status_code == 201
        after = {e["account_id"]: e for e in snapshot(app.url, lk.owner)["per_account"]}[lk.checking]
        assert after["balance_cents"] == CHECKING_SEED - 1250 == after["sparkline"][-1]
        assert after["sparkline"][:-1] == CHECKING_SPARK[:-1]


TABLES = ["users", "companies", "memberships", "accounts", "transactions", "recipients", "payments", "invoices",
          "loans", "plans", "inquiries", "audit_events", "fx_quotes"]


def _fingerprint(pg):
    out = {}
    for table in TABLES:
        row = pg.rows(f"SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h "
                      f"FROM {table} x")[0]
        out[table] = (row["n"], row["h"])
    return out


def test_signup_company_empty_and_restart_stable():
    with copy_app() as app:
        token, email, name = signup(app.url)
        accounts = get(app.url, "/api/accounts", token).json()["accounts"]
        assert [(a["name"], a["kind"], a["balance_cents"]) for a in accounts] == [("Checking", "checking", 0)]
        snap = snapshot(app.url, token)
        assert snap["total_cash_cents"] == 0 and snap["per_account"][0]["sparkline"] == [0] * SPARK_DAYS
        for path, key in (("/api/recipients", "recipients"), ("/api/payments", "payments"),
                          ("/api/invoices", "invoices"), ("/api/loans", "loans"), ("/api/audit", "events"),
                          ("/api/transactions", "transactions")):
            assert get(app.url, path, token).json()[key] == [], path
        user = me(app.url, token)["user"]
        assert user["role"] == "owner"
        pg = app.pg()
        before = _fingerprint(pg)
        app.restart()
        assert _fingerprint(pg) == before


def test_wf_cockpit_snapshot_signin(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        ui_login(page, app.url, OWNER)
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
        snap = snapshot(app.url, lk.owner)
        eventually(page, lambda: expect(page.get_by_text("Total cash", exact=True).first).to_be_visible(timeout=TRY_MS))
        eventually(page, lambda:
            expect(page.get_by_text(f"Available {dollars(snap['total_available_cents'])}", exact=True)).to_be_visible(timeout=TRY_MS))
        for entry in snap["per_account"]:
            eventually(page, lambda entry=entry:
                expect(page.get_by_text(f"Available {dollars(entry['available_cents'])}", exact=True).first).to_be_visible(timeout=TRY_MS))
        pill = (page.get_by_role("link", name="Send payment", exact=True)
                .or_(page.get_by_role("button", name="Send payment", exact=True))).first
        eventually(page, lambda: expect(pill).to_be_visible(timeout=TRY_MS))
        assert_round(pill)
        page.goto(app.url + "/login")
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))


def test_cockpit_rail_and_top_bar(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        ui_login(page, app.url, OWNER)
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))

        def checking_is_current():
            links = page.get_by_role("link", name=re.compile(r"^Checking")).all()
            assert "page" in [l.get_attribute("aria-current") for l in links]
            return links

        # The rail is painted once /api/accounts answers, after the address changes: wait for it.
        checking_links = eventually(page, checking_is_current)
        assert any((l.get_attribute("href") or "").endswith(ACCOUNT_PAGE + lk.checking) for l in checking_links)
        assert "page" not in [l.get_attribute("aria-current")
                              for l in page.get_by_role("link", name=re.compile(r"^Savings")).all()]
        eventually(page, lambda:
            expect(page.get_by_role("link", name="Tallwind home")).to_have_attribute("href", re.compile(re.escape(COCKPIT) + "$"), timeout=TRY_MS))
        eventually(page, lambda: expect(page.get_by_placeholder(SEARCH_PLACEHOLDER)).to_be_visible(timeout=TRY_MS))
        avatar = page.get_by_role("button", name="Account menu")
        eventually(page, lambda: expect(avatar).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        assert_round(avatar)
        eventually(page, lambda: expect(named(page, "Profile")).to_have_count(0, timeout=TRY_MS))
        ready(avatar).click()
        eventually(page, lambda: expect(avatar).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        eventually(page, lambda: expect(named(page, "Profile").first).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(avatar).to_be_focused(timeout=TRY_MS))
        eventually(page, lambda: expect(named(page, "Profile")).to_have_count(0, timeout=TRY_MS))


SPEECH_SPY = """(() => { window.__utterances = []; try { if (window.speechSynthesis) {
  window.speechSynthesis.speak = (u) => { window.__utterances.push(String(u && u.text)); }; } } catch (e) {} })();"""
def test_cockpit_mark_at_every_width(browser):
    """DP-03: the Tallwind mark heads the cockpit at the top left and links to /app on every cockpit page, so the link
    "Tallwind home" stays on the page at narrow widths while the accounts drawer is closed, not only inside it."""
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        for width, path in ((1023, COCKPIT), (PHONE[0], COCKPIT), (PHONE[0], ACCOUNT_PAGE + lk.savings)):
            with ui(browser, width=width, height=PHONE[1]) as page:
                ui_login(page, app.url, OWNER)
                eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
                page.goto(app.url + path)
                menu = page.get_by_role("button", name="Accounts menu")
                eventually(page, lambda: expect(menu).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
                mark = page.get_by_role("link", name="Tallwind home")
                eventually(page, lambda: expect(mark).to_be_visible(timeout=TRY_MS))
                eventually(page, lambda:
                    expect(mark).to_have_attribute("href", re.compile(re.escape(COCKPIT) + "$"), timeout=TRY_MS))


NO_SPEECH = """(() => { try { delete Window.prototype.speechSynthesis; } catch (e) {}
  try { delete window.speechSynthesis; } catch (e) {} try { delete window.SpeechSynthesisUtterance; } catch (e) {} })();"""


def test_read_balances_aloud(browser, app_url):
    _, email, _ = signup(app_url)
    with ui(browser, scripts=[SPEECH_SPY]) as page:
        ui_login(page, app_url, email)
        eventually(page, lambda: expect(page).to_have_url(app_url + COCKPIT, timeout=TRY_MS))
        button = page.get_by_role("button", name="Read balances aloud")
        eventually(page, lambda: expect(button).to_be_enabled(timeout=TRY_MS))
        ready(button).click()
        poll(lambda: page.evaluate("() => window.__utterances.length") > 0, 5, "utterance spoken")
        spoken = page.evaluate("() => window.__utterances")
        assert spoken[0].startswith("Total cash is $0.00"), spoken
        assert "Checking" in " ".join(spoken)
    with ui(browser, scripts=[NO_SPEECH]) as page:
        ui_login(page, app_url, email)
        eventually(page, lambda:
            expect(page.get_by_role("button", name="Read balances aloud")).to_be_disabled(timeout=TRY_MS))


def test_wf_cockpit_snapshot_held_available(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        ui_login(page, app.url, OWNER)
        eventually(page, lambda:
            expect(page.get_by_text(f"Available {dollars(SAVINGS_SEED)}", exact=True).first).to_be_visible(timeout=TRY_MS))
        held_pay = pay(app.url, lk.member, lk.savings, lk.northwind, DUAL_HELD)
        assert held_pay.status_code == 201 and held_pay.json()["status"] == "pending_approval"
        page.clock.fast_forward(REFRESH_MS)
        wait_text(page, f"Available {dollars(SAVINGS_AVAILABLE_AFTER_HOLD)}")
        wait_text(page, dollars(CHECKING_SEED + SAVINGS_SEED))
        expect(page.get_by_role("link", name="Approvals, 1 waiting").first).to_be_visible()
        entry = account_entry(app.url, lk.owner, lk.savings)
        assert (entry["balance_cents"], entry["available_cents"]) == (SAVINGS_SEED, SAVINGS_AVAILABLE_AFTER_HOLD)
        snap = snapshot(app.url, lk.owner)
        assert snap["total_cash_cents"] == CHECKING_SEED + SAVINGS_SEED
        refused = transfer(app.url, lk.owner, lk.savings, lk.checking, HELD_TRANSFER)
        assert refused.status_code == 400 and error_of(refused) == "insufficient_funds"
        assert balance(app.pg(), lk.savings) == SAVINGS_SEED
        assert post(app.url, f"/api/payments/{held_pay.json()['id']}/reject", lk.admin).status_code == 200
        assert account_entry(app.url, lk.owner, lk.savings)["available_cents"] == SAVINGS_SEED


def test_wf_cockpit_snapshot_outage(browser):
    with copy_app(BOOT_NOW, db_up=False) as app:
        started = time.monotonic()

        def still_down():
            r = httpx.get(app.url + "/api/health", timeout=10)
            assert r.status_code == 503 and r.json() == {"status": "unavailable"}, r.text
            api = httpx.get(app.url + "/api/accounts", timeout=10)
            assert api.status_code == 503 and error_of(api) == "service_unavailable"
            return time.monotonic() - started >= BOOT_GAP_S

        poll(still_down, BOOT_GAP_S + 30, "database kept unreachable")
        app.relay.restore()
        restored = time.monotonic()
        app.wait_healthy(RECOVERY_S + 2)
        assert time.monotonic() - restored <= RECOVERY_S + 1
        lk = Lark(app.url)
        pg = app.pg()
        card = pg.rows("SELECT created_at FROM transactions WHERE counterparty = 'Corner Print Shop'")
        assert parse_ts(card[0]["created_at"]) == ny_noon(date(2026, 11, 29))
        by_id = {e["account_id"]: e["sparkline"] for e in snapshot(app.url, lk.owner)["per_account"]}
        assert by_id[lk.checking] == CHECKING_SPARK and by_id[lk.savings] == SAVINGS_SPARK
        with ui(browser) as page:
            ui_login(page, app.url, OWNER)
            eventually(page, lambda:
                expect(page.get_by_text(f"Available {dollars(CHECKING_SEED)}", exact=True).first).to_be_visible(timeout=TRY_MS))
            app.relay.cut()
            page.clock.fast_forward(REFRESH_MS)
            wait_status(page, OUTAGE_COPY, 20)
            page.clock.fast_forward(REFRESH_MS)
            assert status_log(page).count(OUTAGE_COPY) == 1
            expect(page.get_by_text(f"Available {dollars(CHECKING_SEED)}", exact=True).first).to_be_visible()
            down = pay(app.url, lk.owner, lk.checking, lk.northwind, 1250)
            assert down.status_code == 503
            app.relay.restore()
            app.wait_healthy(RECOVERY_S + 2)
            assert pay(app.url, lk.owner, lk.checking, lk.northwind, 1250).status_code == 201
            deadline = time.monotonic() + OUTAGE_DEADLINE_S + 5
            while time.monotonic() < deadline and BACK_COPY not in status_log(page):
                page.clock.fast_forward(1000)
                _pause(POLL_S)
            wait_status(page, BACK_COPY, 2)
            assert status_log(page).count(BACK_COPY) == 1
            wait_text(page, f"Available {dollars(CHECKING_SEED - 1250)}", 5)


def test_wf_cockpit_snapshot_breakpoints(browser, app_url):
    token, email, _ = signup(app_url)
    new_account(app_url, token, "Ops Reserve")
    new_account(app_url, token, "Tax Reserve")
    with ui(browser, width=1024) as page:
        ui_login(page, app_url, email)
        eventually(page, lambda: expect(page).to_have_url(app_url + COCKPIT, timeout=TRY_MS))
        eventually(page, lambda: expect(page.get_by_text(AVAILABLE_RE)).to_have_count(4, timeout=TRY_MS))
        expected_rows = {599: 4, 600: 2, 1023: 2, 1024: 1}
        for width in EDGE_WIDTHS:
            page.set_viewport_size({"width": width, "height": DESKTOP[1]})
            poll(lambda: card_rows(page) == expected_rows[width], 5, f"card rows at {width}")
            menu = page.get_by_role("button", name="Accounts menu")
            eventually(page, lambda width=width: expect(menu).to_have_count(0 if width >= 1024 else 1, timeout=TRY_MS))


def test_wf_cockpit_snapshot_drawer(browser, app_url):
    _, email, _ = signup(app_url)
    with ui(browser, width=1023) as page:
        ui_login(page, app_url, email)
        eventually(page, lambda: expect(page).to_have_url(app_url + COCKPIT, timeout=TRY_MS))
        menu = page.get_by_role("button", name="Accounts menu")
        eventually(page, lambda: expect(menu).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        eventually(page, lambda:
            expect(page.get_by_role("link", name="Payments", exact=True)).to_have_count(0, timeout=TRY_MS))
        eventually(page, lambda: expect(named(page, "Profile")).to_have_count(0, timeout=TRY_MS))
        eventually(page, lambda:
            expect(page.get_by_role("region", name="Search results")).to_have_count(0, timeout=TRY_MS))
        eventually(page, lambda:
            expect(page.get_by_role("dialog", name="Command palette")).to_have_count(0, timeout=TRY_MS))
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        assert not set(tab_order(page, 40)) & RAIL_ONLY
        ready(menu, "attached").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(menu).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        poll(lambda: page.evaluate("() => document.activeElement.getAttribute('aria-current')") == "page", 5,
             "drawer focuses the active account")
        first = focused_name(page)
        cycle = tab_order(page, 30)
        assert "Accounts menu" not in cycle and {"Payments", "Recipients"} <= set(cycle)
        assert first in cycle
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(menu).to_be_focused(timeout=TRY_MS))
        eventually(page, lambda: expect(menu).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        page.keyboard.press("Enter")
        poll(lambda: page.evaluate("() => document.activeElement.getAttribute('aria-current')") == "page", 5, "reopen")
        page.set_viewport_size({"width": 1024, "height": DESKTOP[1]})
        eventually(page, lambda:
            expect(page.get_by_role("button", name="Accounts menu")).to_have_count(0, timeout=TRY_MS))
        poll(lambda: page.evaluate("() => { const el = document.activeElement; const r = el.getBoundingClientRect(); "
                                   "return el.getAttribute('aria-current') === 'page' && r.left >= 0 && r.width > 0; }"),
             5, "focus on the inline active account")


def test_request_scoped_state(browser):
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        own = {lk.owner: [lk.outpost, lk.outpost_company, "Outpost", "Cedar Freight", "Sasha Reyes"],
               lk.outsider: [lk.checking, lk.savings, lk.company, "Larkspur", "Northwind", "Rowan Pike"]}
        paths = [("/api/snapshot", None), ("/api/accounts", None), ("/api/approvals", None),
                 ("/api/search", {"q": "ar"}), ("/api/me", None)]
        calls = [(tok, paths[i % len(paths)]) for i in range(STREAM_COUNT // 2) for tok in (lk.owner, lk.outsider)]
        with cf.ThreadPoolExecutor(20) as pool:
            results = list(pool.map(lambda c: (c[0], get(app.url, c[1][0], c[0], c[1][1])), calls))
        for tok, r in results:
            assert r.status_code == 200 and "no-store" in r.headers.get("cache-control", "")
            for leak in own[tok]:
                assert leak not in r.text, (leak, r.text[:300])
        for r in (get(app.url, "/api/accounts"), get(app.url, UNKNOWN_ACCOUNT_PATH, lk.owner)):
            assert "no-store" in r.headers.get("cache-control", "")
        forbidden = ["Larkspur", "Northwind", "18,420.50", "60,000.00", "Approvals, "]
        watch = ("(() => { const bad = %s; const flag = %s; const state = () => { try { return JSON.parse(window.name || '{}'); } "
                 "catch (e) { return {}; } }; const check = () => { const s = state(); if (!s.twWatch || location.pathname === '/') return; "
                 "const t = (document.body ? document.body.innerText : '') + document.title; "
                 "for (const f of bad) if (t.includes(f)) { s[flag] = f; window.name = JSON.stringify(s); } }; "
                 "new MutationObserver(check).observe(document, {subtree: true, childList: true, characterData: true}); "
                 "})();") % (json.dumps(forbidden), json.dumps(LEAK_FLAG))
        with ui(browser, scripts=[watch]) as page:
            net = Net(page)
            ui_login(page, app.url, OWNER)
            page.goto(app.url + ACCOUNT_PAGE + lk.savings)
            wait_text(page, dollars(SAVINGS_SEED))
            old = net.token()
            ui_logout(page)
            eventually(page, lambda: expect(page).to_have_url(app.url + "/", timeout=TRY_MS))
            page.evaluate("() => { window.name = JSON.stringify({twWatch: true}); }")
            mark = time.monotonic()
            ui_login(page, app.url, OUTSIDER)
            eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
            wait_text(page, "Outpost Checking")
            later_reqs = [r for r in net.reqs if r["t"] > mark and "/api/" in r["url"]]
            for r in later_reqs:
                assert r["token"] != old
                assert lk.checking not in r["url"] + r["body"] and lk.savings not in r["url"] + r["body"]
            assert LEAK_FLAG not in json.loads(page.evaluate("() => window.name") or "{}")
            ui_logout(page)
            page.goto(app.url + "/signup")
            email, name = identity("tab")
            ready(page.get_by_label("Name", exact=True)).fill(name)
            ready(page.get_by_label("Email", exact=True)).fill(email)
            ready(page.get_by_label("Password", exact=True)).fill(PASSWORD)
            ready(page.get_by_role("button", name="Open account", exact=True).last).click()
            eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
            wait_text(page, "$0.00")
            assert "Outpost" not in body_text(page)


def test_snapshot_consistent_under_commits():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        held_ids = []
        for _ in range(4):
            r = pay(app.url, lk.owner, lk.savings, lk.northwind, HELD_6000)
            assert r.status_code == 201 and r.json()["status"] == "pending_approval"
            held_ids.append(r.json()["id"])
        constant = SAVINGS_SEED - 4 * HELD_6000
        problems, stop = [], threading.Event()
        expect_total = [None]

        def reader():
            while not stop.is_set():
                want = expect_total[0]
                s = snapshot(app.url, lk.owner)
                quiet = want is None and expect_total[0] is None
                per = s["per_account"]
                if s["total_cash_cents"] != sum(e["balance_cents"] for e in per):
                    problems.append(("cash", s))
                if s["total_available_cents"] != sum(e["available_cents"] for e in per):
                    problems.append(("available", s))
                sav = next(e for e in per if e["account_id"] == lk.savings)
                if quiet and sav["available_cents"] != constant:
                    problems.append(("held", sav))
                if want is not None and s["total_cash_cents"] != want:
                    problems.append(("transfer", s))
                before = expect_total[0]
                acc = next(a for a in get(app.url, "/api/accounts", lk.owner).json()["accounts"] if a["id"] == lk.savings)
                if before is None and expect_total[0] is None and acc["available_cents"] != constant:
                    problems.append(("accounts", acc))

        threads = [threading.Thread(target=reader, daemon=True) for _ in range(3)]
        for t in threads:
            t.start()
        for pid in held_ids:
            assert post(app.url, f"/api/payments/{pid}/approve", lk.admin).json()["status"] == "posted"
        expect_total[0] = CHECKING_SEED + constant
        moves = [lambda: transfer(app.url, lk.owner, lk.checking, lk.savings, 1000)] * 6 + \
                [lambda: transfer(app.url, lk.admin, lk.savings, lk.checking, 1000)] * 6
        assert all(r.status_code == 201 for r in together(*moves))
        stop.set()
        for t in threads:
            t.join(30)
        assert problems == [], problems[:3]


def test_stream_delivers_transactions():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        stream = Stream(app.url, lk.owner)
        try:
            assert stream.status == 200 and stream.headers.get("content-type", "").startswith("text/event-stream")
            r = pay(app.url, lk.member, lk.checking, lk.northwind, 1250)
            sent = time.monotonic()
            assert r.status_code == 201
            tx = newest_tx(app.url, lk.owner, lk.checking)
            poll(lambda: tx["id"] in stream.tx_ids(), STREAM_S + 1, "event delivered")
            event_id, data, at = next(t for t in stream.transactions() if t[1]["id"] == tx["id"])
            assert event_id and at - sent <= STREAM_S
            assert (data["account_id"], data["direction"], data["amount_cents"], data["method"], data["counterparty"]) == \
                (lk.checking, "debit", 1250, "ach", "Northwind Supply")
            tr = transfer(app.url, lk.owner, lk.checking, lk.savings, 300)
            poll(lambda: sum(1 for t in stream.transactions() if t[1].get("transfer_id") == tr.json()["id"]) == 2,
                 STREAM_S + 1, "both transfer legs streamed")
        finally:
            stream.close()


def test_feed_order_and_filters():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        transfer(app.url, lk.owner, lk.savings, lk.checking, 100, "feed filter")
        pay(app.url, lk.owner, lk.checking, lk.northwind, 200)
        pay(app.url, lk.owner, lk.checking, lk.northwind, 300, method="wire")
        rows = get(app.url, "/api/transactions", lk.owner, {"limit": 100}).json()["transactions"]
        keys = [(parse_ts(r["created_at"]), r["id"]) for r in rows]
        assert [k[0] for k in keys] == sorted([k[0] for k in keys], reverse=True)
        for params, check in (({"account_id": lk.savings}, lambda r: r["account_id"] == lk.savings),
                              ({"method": "wire"}, lambda r: r["method"] == "wire"),
                              ({"direction": "credit"}, lambda r: r["direction"] == "credit"),
                              ({"account_id": lk.checking, "method": "ach", "direction": "debit"},
                               lambda r: r["account_id"] == lk.checking and r["method"] == "ach" and r["direction"] == "debit")):
            got = get(app.url, "/api/transactions", lk.owner, {**params, "limit": 100}).json()["transactions"]
            assert got and all(check(r) for r in got), params
            assert len(got) == sum(1 for r in rows if check(r))
        for params, field in (({"method": "WIRE"}, "method"), ({"direction": "in"}, "direction"),
                              ({"limit": 0}, "limit"), ({"limit": 101}, "limit"), ({"limit": "x"}, "limit")):
            assert_validation(get(app.url, "/api/transactions", lk.owner, params), field)


def test_feed_paging_and_statement_csv():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        for _ in range(60):
            assert transfer(app.url, lk.owner, lk.checking, lk.savings, 1).status_code == 201
        full = get(app.url, "/api/transactions", lk.owner, {"account_id": lk.checking, "limit": 100}).json()
        first = get(app.url, "/api/transactions", lk.owner, {"account_id": lk.checking}).json()
        assert len(first["transactions"]) == FEED_PAGE and first["next_cursor"]
        for _ in range(3):
            pay(app.url, lk.owner, lk.checking, lk.northwind, 100)
        second = get(app.url, "/api/transactions", lk.owner,
                     {"account_id": lk.checking, "cursor": first["next_cursor"], "limit": 100}).json()
        ids = [r["id"] for r in first["transactions"] + second["transactions"]]
        assert ids == [r["id"] for r in full["transactions"]] and second["next_cursor"] is None
        assert_validation(get(app.url, "/api/transactions", lk.owner,
                              {"account_id": lk.checking, "method": "ach", "cursor": first["next_cursor"]}), "cursor")
        assert_validation(get(app.url, "/api/transactions", lk.owner, {"cursor": "not-a-cursor"}), "cursor")
        formula = add_recipient(app.url, lk.owner, "=SUM(A1:A9)").json()["id"]
        pay(app.url, lk.owner, lk.checking, formula, SMALL_CENTS, memo=AT_MEMO)
        pay(app.url, lk.owner, lk.checking, lk.northwind, 500, memo=QUOTED_MEMO)
        r = get(app.url, f"/api/accounts/{lk.checking}/statement.csv", lk.owner)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        assert "filename*=UTF-8''" + "Checking" + "-statement-all.csv" in r.headers["content-disposition"]
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0] == ["date", "counterparty", "memo", "direction", "amount", "balance"]
        running = 0
        for row in rows[1:]:
            assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", row[0])
            assert re.fullmatch(r"-?\d+\.\d{2}", row[4]) and re.fullmatch(r"-?\d+\.\d{2}", row[5])
            running += csv_cents(row[4])
            assert csv_cents(row[5]) == running
        assert running == balance(app.pg(), lk.checking)
        hit = next(row for row in rows[1:] if row[1] == "'=SUM(A1:A9)")
        assert hit[2] == "'" + AT_MEMO and hit[3] == "debit" and hit[4] == csv_money(-SMALL_CENTS)
        assert any(row[2] == QUOTED_MEMO for row in rows[1:])


def test_monthly_statement():
    start = "2026-11-01T03:57:00Z"
    with copy_app(start) as app:
        lk = Lark(app.url)
        assert parse_ts(me(app.url, lk.owner)["business_now"]) < parse_ts("2026-11-01T03:59:50Z"), "boot too slow"
        assert pay(app.url, lk.owner, lk.checking, lk.northwind, 1250).status_code == 201
        wait_business(app.url, lk.owner, "2026-11-01T04:00:05Z", EDGE_MARGIN_S + BOOT_S)
        assert pay(app.url, lk.owner, lk.checking, lk.northwind, 1250).status_code == 201
        october = list(csv.reader(io.StringIO(
            get(app.url, f"/api/accounts/{lk.checking}/statement.csv", lk.owner, {"month": "2026-10"}).text)))
        assert all(row[0].startswith("2026-10") for row in october[1:])
        oct_vendor = [row for row in october[1:] if row[1] == "Northwind Supply" and row[0] == "2026-10-31"]
        assert any(row[4] == csv_money(-SMALL_CENTS) for row in oct_vendor)
        assert october[-1][5] == csv_money(CHECKING_SEED - 1250)
        november = list(csv.reader(io.StringIO(
            get(app.url, f"/api/accounts/{lk.checking}/statement.csv", lk.owner, {"month": "2026-11"}).text)))
        assert november[0] == ["date", "counterparty", "memo", "direction", "amount", "balance"]
        assert [r[0] for r in november[1:]] == ["2026-11-01"]
        assert november[1][5] == csv_money(CHECKING_SEED - 2500)
        for bad in ("2026-12", "2026-13", "2026-1", "november"):
            assert_validation(get(app.url, f"/api/accounts/{lk.checking}/statement.csv", lk.owner, {"month": bad}), "month")
        reserve = new_account(app.url, lk.owner, "Réserve ☕")
        cd = get(app.url, f"/api/accounts/{reserve}/statement.csv", lk.owner, {"month": "2026-11"}).headers["content-disposition"]
        assert 'filename="' + "R_serve _-statement-2026-11.csv" + '"' in cd
        encoded = re.search(r"filename\*=UTF-8''([^;\s]+)", cd).group(1)
        assert urllib.parse.unquote(encoded) == "Réserve ☕-statement-2026-11.csv"


def test_stream_resume_and_outage():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        s1 = Stream(app.url, lk.owner)
        pay(app.url, lk.owner, lk.checking, lk.northwind, 101)
        poll(lambda: s1.transactions(), STREAM_S + 1, "first event")
        last_id = s1.transactions()[-1][0]
        s1.close()
        pay(app.url, lk.owner, lk.checking, lk.northwind, 102)
        transfer(app.url, lk.owner, lk.checking, lk.savings, 103)
        app.restart(later(app, lk.owner))
        pay(app.url, lk.owner, lk.checking, lk.northwind, 104)
        expected = [r["id"] for r in reversed(get(app.url, "/api/transactions", lk.owner, {"limit": 4}).json()["transactions"])]
        for kwargs in ({"last_event_id": last_id}, {"header_last_id": last_id}):
            s2 = Stream(app.url, lk.owner, **kwargs)
            try:
                poll(lambda: len(s2.tx_ids()) >= len(expected), 5, "replay")
                assert s2.tx_ids()[:len(expected)] == expected
                pay(app.url, lk.owner, lk.checking, lk.northwind, 105)
                live = newest_tx(app.url, lk.owner, lk.checking)["id"]
                poll(lambda: live in s2.tx_ids(), STREAM_S + 1, "live after replay")
                assert len(s2.tx_ids()) == len(set(s2.tx_ids()))
            finally:
                s2.close()
            expected = expected + [live]
        s3 = Stream(app.url, lk.owner, last_event_id="unknown-event")
        _pause(1)
        assert s3.tx_ids() == []
        s3.close()
        s4 = Stream(app.url, lk.owner)
        pay(app.url, lk.owner, lk.checking, lk.northwind, 106)
        poll(lambda: s4.transactions(), STREAM_S + 1, "pre-outage event")
        before_outage = s4.transactions()[-1][0]
        pid = app.proc.pid
        app.relay.cut()
        poll(lambda: httpx.get(app.url + "/api/health", timeout=10).status_code == 503, 10, "health 503")
        api = get(app.url, "/api/accounts", lk.owner)
        assert api.status_code == 503 and error_of(api) == "service_unavailable"
        app.relay.restore()
        app.wait_healthy(RECOVERY_S + 2)
        assert app.proc.pid == pid and app.proc.poll() is None
        assert pay(app.url, lk.owner, lk.checking, lk.northwind, 107).status_code == 201
        after = newest_tx(app.url, lk.owner, lk.checking)["id"]
        s5 = Stream(app.url, lk.owner, last_event_id=before_outage)
        try:
            poll(lambda: after in s5.tx_ids(), 5, "post-outage row replayed")
        finally:
            s5.close()
            s4.close()


def test_search_literal_bounded():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        for memo in ("50% deposit", "500 deposit", "net_30", "net30"):
            transfer(app.url, lk.owner, lk.checking, lk.savings, 1, memo)

        def memos(q):
            r = get(app.url, "/api/search", lk.owner, {"q": q})
            assert r.status_code == 200, r.text
            return {t["memo"] for t in r.json()["transactions"]}

        assert memos("0%") == {"50% deposit"}
        assert memos("t_3") == {"net_30"}
        assert memos("%%") == set()
        for q in ("net\\", "\\\\", "*" * SEARCH_MAX, "\U0001F4B8" * SEARCH_MAX):
            t0 = time.monotonic()
            assert get(app.url, "/api/search", lk.owner, {"q": q}).status_code == 200
            assert time.monotonic() - t0 <= SEARCH_BUDGET_S
        for q in ("a", "  a  ", "x" * (SEARCH_MAX + 1)):
            assert_validation(get(app.url, "/api/search", lk.owner, {"q": q}), "q")
        timed = together(*[lambda: (time.monotonic(), get(app.url, "/api/search", lk.owner, {"q": "de\\"}),
                                    time.monotonic())] * 10)
        assert all(r.status_code == 200 and end - begin <= SEARCH_BUDGET_S for begin, r, end in timed)
        for i in range(25):
            transfer(app.url, lk.owner, lk.checking, lk.savings, 1, "capcheck")
            if i < 22:
                add_recipient(app.url, lk.owner, f"Capcheck Vendor {i}")
        capped = get(app.url, "/api/search", lk.owner, {"q": "CAPCHECK"}).json()
        assert len(capped["recipients"]) == SEARCH_CAP and len(capped["transactions"]) == SEARCH_CAP
        times = [parse_ts(t["created_at"]) for t in capped["transactions"]]
        assert times == sorted(times, reverse=True)
        assert [r["display_name"] for r in get(app.url, "/api/search", lk.owner, {"q": "NORTHWIND"}).json()["recipients"]] \
            == ["Northwind Supply"]
        foreign = get(app.url, "/api/search", lk.outsider, {"q": "Northwind"}).json()
        assert foreign == {"recipients": [], "transactions": []}


MARK_JS = ("list => { const items = [...list.querySelectorAll('[role=listitem], li')]"
           ".filter(el => !el.parentElement.closest('[role=listitem], li') || !list.contains(el.parentElement.closest('[role=listitem], li'))); "
           "items.forEach((el, i) => { el.__twMark = i; }); return items.length; }")
READ_MARKS_JS = ("list => [...list.querySelectorAll('[role=listitem], li')]"
                 ".filter(el => !el.parentElement.closest('[role=listitem], li') || !list.contains(el.parentElement.closest('[role=listitem], li')))"
                 ".map(el => el.__twMark === undefined ? -1 : el.__twMark)")


ANNOUNCE_SETTLE_STEPS = 10
ANNOUNCE_SETTLE_STEP_MS = 50


def test_wf_transaction_feed_refresh(browser):
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        for i in range(FEED_ROWS - 4):
            assert transfer(app.url, lk.owner, lk.savings, lk.checking, 1, f"net {i}").status_code == 201
        with ui(browser) as page:
            ui_login(page, app.url, OWNER)
            page.goto(app.url + COCKPIT + "?account=" + lk.checking)
            poll(lambda: feed_count(page) == FEED_PAGE, 15, "first page")
            search = page.get_by_placeholder(SEARCH_PLACEHOLDER)
            ready(search).fill("net")
            page.clock.fast_forward(TYPING_PAUSE_MS)
            expect(page.get_by_role("region", name="Search results")).to_be_visible()
            more = page.get_by_role("button", name="Show more transactions")
            more.click()
            poll(lambda: feed_count(page) == 2 * FEED_PAGE, 15, "second page")
            ready(more).click()
            poll(lambda: feed_count(page) == SHOWN_AFTER_TWO, 15, "third page")
            eventually(page, lambda: expect(more).to_be_focused(timeout=TRY_MS))
            assert feed(page).first.evaluate(MARK_JS) == SHOWN_AFTER_TWO
            for _ in range(ANNOUNCE_SETTLE_STEPS):
                page.clock.run_for(ANNOUNCE_SETTLE_STEP_MS)
            announced = sum("transactions shown" in t for t in status_log(page))
            for _ in range(3):
                assert pay(app.url, lk.admin, lk.checking, lk.northwind, 100).status_code == 201
            page.clock.fast_forward(REFRESH_MS)
            page.clock.fast_forward(REFRESH_MS)
            poll(lambda: feed_count(page) == SHOWN_AFTER_NEW, 15, "three new rows on top")
            marks = feed(page).first.evaluate(READ_MARKS_JS)
            assert marks == [-1, -1, -1] + list(range(SHOWN_AFTER_TWO))
            top = feed(page).first.get_by_role("listitem")
            for i in range(3):
                expect(top.nth(i)).to_contain_text("Northwind Supply")
            eventually(page, lambda: expect(more).to_be_focused(timeout=TRY_MS))
            assert search.input_value() == "net"
            eventually(page, lambda:
                expect(page.get_by_role("region", name="Search results")).to_be_visible(timeout=TRY_MS))
            assert sum("transactions shown" in t for t in status_log(page)) == announced
            ready(more).click()
            poll(lambda: feed_count(page) == FEED_ROWS + 3, 15, "last page without repeats")


def test_streams_bounded_connections():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        sql = ("SELECT count(*)::int AS n, count(*) FILTER (WHERE state IN ('active', 'idle in transaction'))::int AS busy "
               "FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user "
               "AND backend_type = 'client backend'")
        peak, stop = [0], threading.Event()

        def monitor():
            while not stop.is_set():
                peak[0] = max(peak[0], int(pg.rows(sql)[0]["n"]))
                _pause(POLL_S)

        watcher = threading.Thread(target=monitor, daemon=True)
        watcher.start()
        owners = [Stream(app.url, lk.owner) for _ in range(STREAM_COUNT // 2)]
        outsiders = [Stream(app.url, lk.outsider) for _ in range(STREAM_COUNT // 2)]
        try:
            assert all(s.status == 200 for s in owners + outsiders)
            t0 = time.monotonic()
            r = get(app.url, "/api/accounts", lk.owner)
            assert r.status_code == 200 and time.monotonic() - t0 <= STREAM_S
            pay(app.url, lk.admin, lk.checking, lk.northwind, 100)
            sent = time.monotonic()
            larkspur = newest_tx(app.url, lk.owner, lk.checking)["id"]
            poll(lambda: all(larkspur in s.tx_ids() for s in owners), STREAM_S + 1, "owner streams")
            assert all(next(t[2] for t in s.transactions() if t[1]["id"] == larkspur) - sent <= STREAM_S for s in owners)
            pay(app.url, lk.outsider, lk.outpost, lk.cedar, 100)
            outpost = newest_tx(app.url, lk.outsider, lk.outpost)["id"]
            poll(lambda: all(outpost in s.tx_ids() for s in outsiders), STREAM_S + 1, "outsider streams")
            assert all(outpost not in s.tx_ids() for s in owners)
            assert all(larkspur not in s.tx_ids() for s in outsiders)
        finally:
            for s in owners + outsiders:
                s.close()
        poll(lambda: (lambda row: row["busy"] == 0 and row["n"] <= MAX_DB_CONNECTIONS)(pg.rows(sql)[0]),
             STREAM_RELEASE_S + 1, "connections released")
        stop.set()
        watcher.join(10)
        assert peak[0] <= MAX_DB_CONNECTIONS, peak
        assert httpx.get(app.url + "/api/health", timeout=10).status_code == 200
        fresh = Stream(app.url, lk.owner)
        try:
            pay(app.url, lk.admin, lk.checking, lk.northwind, 100)
            newest = newest_tx(app.url, lk.owner, lk.checking)["id"]
            poll(lambda: newest in fresh.tx_ids(), STREAM_S + 1, "new stream after churn")
        finally:
            fresh.close()


def test_wf_transaction_feed_rows(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        ui_login(page, app.url, OWNER)
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
        items = feed(page).first.get_by_role("listitem")
        eventually(page, lambda: expect(items.first).to_be_visible(timeout=TRY_MS))
        for i in range(items.count()):
            text = written(items.nth(i))
            assert ("Money in" in text) != ("Money out" in text)
            assert re.search(r"[+\u2212-]\$[\d,]+\.\d{2}", text), text
        amount = items.first.get_by_text(re.compile(r"[+\u2212-]\$[\d,]+\.\d{2}")).first
        assert "mono" in style(amount, "font-family")["font-family"].lower()
        select(page.get_by_label("Filter by direction"), "Money in")
        expected = len(get(app.url, "/api/transactions", lk.owner, {"direction": "credit", "limit": 100})
                       .json()["transactions"])
        poll(lambda: feed_count(page) == expected, 10, "credit rows")
        wait_status(page, f"{expected} transactions shown")
        for i in range(expected):
            assert "Money in" in written(items.nth(i))


def test_wf_transaction_feed_filters(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        ui_login(page, app.url, OWNER)
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
        items = feed(page).first.get_by_role("listitem")
        eventually(page, lambda: expect(items.first).to_be_visible(timeout=TRY_MS))
        start = history_len(page)
        select(page.get_by_label("Filter by method"), "ACH")
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT + "?method=ach", timeout=TRY_MS))
        select(page.get_by_label("Filter by direction"), "Money out")
        eventually(page, lambda: expect(page).to_have_url(app.url + FILTERED, timeout=TRY_MS))
        assert history_len(page) == start + 2
        expected = len(get(app.url, "/api/transactions", lk.owner, {"method": "ach", "direction": "debit", "limit": 100})
                       .json()["transactions"])
        poll(lambda: feed_count(page) == expected, 10, "filtered rows")
        wait_status(page, f"{expected} transactions shown")
        for i in range(expected):
            assert "Money out" in written(items.nth(i))
        page.reload()
        assert selected_label(page.get_by_label("Filter by method")) == "ACH"
        assert selected_label(page.get_by_label("Filter by direction")) == "Money out"
        page.go_back()
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT + "?method=ach", timeout=TRY_MS))
        poll(lambda: selected_label(page.get_by_label("Filter by direction")) == "In and out", 5, "Back restores")
        assert "ach" not in storage_dump(page).lower().replace("checking", "")
        page.goto(app.url + COCKPIT)
        before = history_len(page)
        page.goto(app.url + COCKPIT + "?account=" + lk.outpost + "&method=bogus")
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
        assert history_len(page) == before + 1
        assert selected_label(page.get_by_label("Filter by account")) == "All accounts"
        assert "Outpost" not in body_text(page)
        page.goto(app.url + ACCOUNT_PAGE + lk.savings + "?" +
                  urllib.parse.urlencode([("account", lk.checking), ("direction", "in")]))
        eventually(page, lambda:
            expect(page).to_have_url(app.url + ACCOUNT_PAGE + lk.savings + "?" + urllib.parse.urlencode([("direction", "in")]), timeout=TRY_MS))


def test_wf_transaction_feed_statement(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        business = date.fromisoformat(me(app.url, lk.owner)["business_date"])
        ui_login(page, app.url, OWNER)
        page.goto(app.url + ACCOUNT_PAGE + lk.checking)
        month = page.get_by_label("Statement month")
        labels = option_labels(month)
        assert len(labels) == 12 and labels[0] == f"{calendar.month_name[business.month]} {business.year}"
        assert selected_label(month) == labels[0]
        with page.expect_download() as info:
            ready(page.get_by_role("button", name="Download statement")).click()
        download = info.value
        tag = f"{business.year}-{business.month:02d}"
        assert download.suggested_filename == f"Checking-statement-{tag}.csv"
        rows = list(csv.reader(io.StringIO(Path(download.path()).read_text())))
        assert rows[0] == ["date", "counterparty", "memo", "direction", "amount", "balance"]
        api_rows = list(csv.reader(io.StringIO(get(app.url, f"/api/accounts/{lk.checking}/statement.csv", lk.owner,
                                                   {"month": tag}).text)))
        assert rows == api_rows
        wait_status(page, "Statement downloaded")


def test_recipient_last4_and_invite(app_url):
    token, _, _ = signup(app_url)
    r = add_recipient(app_url, token, "  Acme Freight  ", "000123456612")
    assert r.status_code == 201
    body = r.json()
    assert (body["display_name"], body["account_last4"], body["status"]) == ("Acme Freight", "6612", "active")
    for text in (r.text, get(app_url, f"/api/recipients/{body['id']}", token).text,
                 get(app_url, "/api/recipients", token).text):
        assert "000123456612" not in text and "021000021" not in text
    stored = Postgres().rows(f"SELECT row_to_json(r)::text AS j FROM recipients r WHERE id::text = {lit(body['id'])}")
    assert "000123456612" not in stored[0]["j"]
    email, _ = identity("invitee")
    inv = post(app_url, "/api/recipients/invite", token, {"email": f"  {email.upper()} "})
    assert inv.status_code == 201
    rec = inv.json()["recipient"]
    assert inv.json()["invite_id"] and rec["status"] == "pending" and rec["display_name"] == email
    assert rec["kind"] is None and rec["method"] is None


RECIPIENT_CASES = {
    "name_121_code_points": "display_name",
    "name_nul": "display_name",
    "name_lone_surrogate": "display_name",
    "name_bidi_override": "display_name",
    "name_control_char": "display_name",
    "account_fullwidth_digits": "account_number",
    "routing_arabic_indic_digits": "routing_number",
    "invite_email_bidi": "email",
    "inquiry_message_nul": "message",
    "signup_password_lone_surrogate": "password",
    "name_120_emoji_ok": None,
    "name_arabic_ok": None,
}
RECIPIENT_INPUTS = {

    "name_121_code_points": ("/api/recipients", {"display_name": "\U0001F4B8" * (NAME_LIMIT + 1)}),
    "name_nul": ("/api/recipients", {"display_name": "North\u0000wind"}),
    "name_lone_surrogate": ("/api/recipients", {"display_name": "North\ud83dwind"}),
    "name_bidi_override": ("/api/recipients", {"display_name": "Northwind\u202Eylppus"}),
    "name_control_char": ("/api/recipients", {"display_name": "North\u0007wind"}),
    "account_fullwidth_digits": ("/api/recipients", {"account_number": "１２３４"}),
    "routing_arabic_indic_digits": ("/api/recipients", {"routing_number": "٠٢١٠٠٠٠٢١"}),

    "invite_email_bidi": ("/api/recipients/invite", {"email": "north\u202ewind@example.com"}),
    "inquiry_message_nul": ("/api/inquiries", {"message": "Hello\u0000there"}),
    "signup_password_lone_surrogate": ("/api/auth/signup", {"password": "longpass\udc00word"}),
    "name_120_emoji_ok": ("/api/recipients", {"display_name": "\U0001F4B8" * NAME_LIMIT}),
    "name_arabic_ok": ("/api/recipients", {"display_name": "مؤسسة النور"}),
}


@pytest.mark.parametrize("case_id", list(RECIPIENT_CASES), ids=list(RECIPIENT_CASES))
def test_recipient_validation(app_url, case_id):
    field = RECIPIENT_CASES[case_id]
    path, overrides = RECIPIENT_INPUTS[case_id]
    email, name = identity("val")
    token = None
    if path == "/api/auth/signup":
        body = {"email": email, "name": name, "password": PASSWORD}
    elif path == "/api/inquiries":
        body = inquiry(email)
    else:
        token, _, _ = signup(app_url)
        body = {"email": email} if path.endswith("invite") else {
            "display_name": "Valid Vendor", "kind": "business", "method": "ach",
            "account_number": "000123456612", "routing_number": "021000021"}
    body.update(overrides)
    r = raw_post(app_url, path, token, body)
    pg = Postgres()
    if field is None:
        assert r.status_code == 201, r.text
        assert r.json()["display_name"] == overrides["display_name"]
        assert get(app_url, f"/api/recipients/{r.json()['id']}", token).json()["display_name"] == overrides["display_name"]
        return
    assert_validation(r, field)
    if path == "/api/auth/signup":
        assert count(pg, f"SELECT count(*)::int AS n FROM users WHERE email = {lit(email)}") == 0
    elif path == "/api/inquiries":
        assert count(pg, f"SELECT count(*)::int AS n FROM inquiries WHERE email = {lit(email)}") == 0
    else:
        assert get(app_url, "/api/recipients", token).json()["recipients"] == []


RECIPIENT_FIELD_CASES = [
    ({"display_name": "   "}, "display_name"),
    ({"display_name": "N" * (NAME_LIMIT + 1)}, "display_name"),
    ({"account_number": 123456612}, "account_number"),
    ({"account_number": "123"}, "account_number"),
    ({"account_number": "1" * 18}, "account_number"),
    ({"routing_number": 21000021}, "routing_number"),
    ({"routing_number": "123456789"}, "routing_number"),
]


def test_recipient_field_validation(app_url):
    token, _, _ = signup(app_url)
    for overrides, field in RECIPIENT_FIELD_CASES:
        body = {"display_name": "Valid Vendor", "kind": "business", "method": "ach",
                "account_number": "000123456612", "routing_number": "021000021"}
        body.update(overrides)
        r = raw_post(app_url, "/api/recipients", token, body)
        assert_validation(r, field)
        assert set(r.json()["fields"]) == {field}, (overrides, r.json())
    several = raw_post(app_url, "/api/recipients", token, {
        "display_name": "", "kind": "business", "method": "ach", "account_number": "12",
        "routing_number": "123456789"})
    assert_validation(several, "display_name")
    assert {"display_name", "account_number", "routing_number"} <= set(several.json()["fields"])
    assert get(app_url, "/api/recipients", token).json()["recipients"] == []
    for number in ("1234", "1" * 17):
        r = add_recipient(app_url, token, "Edge Vendor", number)
        assert r.status_code == 201 and r.json()["account_last4"] == number[-4:]


def test_duplicate_recipient_concurrent(app_url):
    token, _, _ = signup(app_url)
    body = {"display_name": TWIN_NAME, "kind": "business", "method": "ach",
            "account_number": "000123456612", "routing_number": "021000021"}
    answers = together(*[lambda: post(app_url, "/api/recipients", token, body)] * 6)
    won = [r for r in answers if r.status_code == 201]
    assert len(won) == 1
    for r in answers:
        if r.status_code != 201:
            assert r.status_code == 409 and r.json()["error"] == "duplicate_recipient"
            assert r.json()["recipient_id"] == won[0].json()["id"] and r.json()["display_name"] == TWIN_NAME
    assert len(get(app_url, "/api/recipients", token).json()["recipients"]) == 1
    assert add_recipient(app_url, token, "Last Four Twin", "999123456612").status_code == 201
    other, _, _ = signup(app_url)
    assert post(app_url, "/api/recipients", other, body).status_code == 201
    email, _ = identity("dupinvite")
    variants = [email, email.upper(), f"  {email} ", email, f"{email} "]
    invites = together(*[lambda e=e: post(app_url, "/api/recipients/invite", token, {"email": e}) for e in variants])
    ok = [r for r in invites if r.status_code == 201]
    assert len(ok) == 1
    pending_id = ok[0].json()["recipient"]["id"]
    assert all(r.status_code == 409 and r.json()["recipient_id"] == pending_id for r in invites if r.status_code != 201)


def test_wf_recipients_add_duplicate_remove(browser, app_url):
    token, email, _ = signup(app_url)
    add_recipient(app_url, token, "Northwind Supply", "000123456612")
    with ui(browser) as page:
        ui_login(page, app_url, email)
        page.goto(app_url + "/payments/recipients")
        ready((page.get_by_role("link", name="Add recipient").or_(page.get_by_role("button", name="Add recipient"))).first).click()
        eventually(page, lambda: expect(page).to_have_url(app_url + "/payments/recipients/new", timeout=TRY_MS))
        ready(page.get_by_label("Display name")).fill(HARBOR_NAME)
        select(page.get_by_label("Kind"), "Business")
        select(page.get_by_label("Method"), "ACH")
        ready(page.get_by_label("Account number")).fill(HARBOR_NUMBER)
        ready(page.get_by_label("Routing number")).fill("021000021")
        ready(page.get_by_role("button", name="Save recipient")).click()
        eventually(page, lambda: expect(page).to_have_url(app_url + "/payments/recipients", timeout=TRY_MS))
        wait_status(page, "Recipient saved")
        wait_text(page, HARBOR_NAME)
        assert HARBOR_NUMBER[-4:] in body_text(page) and HARBOR_NUMBER not in body_text(page)
        page.goto(app_url + "/payments/recipients/new")
        ready(page.get_by_label("Display name")).fill(AGAIN_NAME)
        ready(page.get_by_label("Account number")).fill("000123456612")
        ready(page.get_by_label("Routing number")).fill("021000021")
        ready(page.get_by_role("button", name="Save recipient")).click()
        eventually(page, lambda: expect(page.get_by_text(DUPLICATE_COPY).first).to_be_visible(timeout=TRY_MS))
        eventually(page, lambda: expect(page.get_by_label("Account number")).to_be_focused(timeout=TRY_MS))
        assert page.get_by_label("Display name").input_value() == AGAIN_NAME
        wait_status(page, DUPLICATE_COPY)
        names = [r["display_name"] for r in get(app_url, "/api/recipients", token).json()["recipients"]]
        assert names.count("Northwind Supply") == 1 and AGAIN_NAME not in names
        page.goto(app_url + "/payments/recipients")
        ready(page.get_by_role("button", name="Remove " + HARBOR_NAME)).click()
        dialog = page.get_by_role("dialog", name="Remove recipient")
        eventually(page, lambda: expect(dialog).to_contain_text(HARBOR_NAME + " will no longer appear in Recipients or Send payment. "
                                       "Past payments keep its name.", timeout=TRY_MS))
        eventually(page, lambda: expect(dialog.get_by_role("button", name="Keep")).to_be_focused(timeout=TRY_MS))
        ready(dialog.get_by_role("button", name="Remove", exact=True)).click()
        wait_status(page, "Recipient removed")
        eventually(page, lambda:
            expect(page.get_by_role("button", name="Remove " + HARBOR_NAME)).to_have_count(0, timeout=TRY_MS))
        eventually(page, lambda:
            expect((page.get_by_role("link", name="Add recipient").or_(page.get_by_role("button", name="Add recipient"))).first).to_be_focused(timeout=TRY_MS))
        assert HARBOR_NAME not in [r["display_name"] for r in get(app_url, "/api/recipients", token).json()["recipients"]]
    with ui(browser) as page:
        ui_login(page, app_url, MEMBER)
        page.goto(app_url + "/payments/recipients")
        wait_text(page, "Northwind Supply")
        eventually(page, lambda:
            expect(page.get_by_role("button", name=re.compile(r"^Remove "))).to_have_count(0, timeout=TRY_MS))


def test_wf_recipients_keyboard(browser, app_url):
    token, email, _ = signup(app_url)
    with ui(browser) as page:
        ui_login(page, app_url, email)
        page.goto(app_url + "/payments/recipients/new")
        name = page.get_by_label("Display name")
        ready(name).fill(TYPED_NAME)
        for target in (name, page.get_by_label("Kind"), page.get_by_role("button", name="Save recipient")):
            ready(target, "attached").focus()
            page.keyboard.press("Control+K")
            palette = page.get_by_role("dialog", name="Command palette")
            eventually(page, lambda: expect(palette).to_be_visible(timeout=TRY_MS))
            eventually(page, lambda:
                expect(palette.get_by_role("textbox", name="Search commands")).to_be_focused(timeout=TRY_MS))
            page.keyboard.press("Escape")
            eventually(page, lambda: expect(palette).to_have_count(0, timeout=TRY_MS))
            eventually(page, lambda target=target: expect(target).to_be_focused(timeout=TRY_MS))
        assert name.input_value() == TYPED_NAME
        ready(name).fill(BIDI_NAME)
        ready(page.get_by_label("Account number")).fill("１２３４")
        ready(page.get_by_label("Routing number")).fill("021000021")
        page.get_by_label("Routing number").press("Enter")
        eventually(page, lambda: expect(name).to_be_focused(timeout=TRY_MS))
        for field, message in ((name, "Remove control or direction characters from this name"),
                               (page.get_by_label("Account number"), "Enter 4 to 17 digits")):
            eventually(page, lambda field=field:
                expect(field).to_have_attribute("aria-invalid", "true", timeout=TRY_MS))
            described = field.get_attribute("aria-describedby")
            assert described and message in page.evaluate(
                "ids => ids.split(' ').map(id => (document.getElementById(id) || {}).textContent || '').join(' ')", described)
        assert get(app_url, "/api/recipients", token).json()["recipients"] == []
        emoji = "\U0001F4B8" * NAME_LIMIT
        ready(name).fill(emoji)
        ready(page.get_by_label("Account number")).fill(account_number())
        name.press("Enter")
        eventually(page, lambda: expect(page).to_have_url(app_url + "/payments/recipients", timeout=TRY_MS))
        eventually(page, lambda: expect(page.get_by_text(emoji, exact=True).first).to_be_visible(timeout=TRY_MS))
        assert [r["display_name"] for r in get(app_url, "/api/recipients", token).json()["recipients"]] == [emoji]
        remove = page.get_by_role("button", name=f"Remove {emoji}")
        ready(remove, "attached").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Remove recipient")
        keep, confirm = dialog.get_by_role("button", name="Keep"), dialog.get_by_role("button", name="Remove", exact=True)
        eventually(page, lambda: expect(keep).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("Tab")
        eventually(page, lambda: expect(confirm).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("Tab")
        eventually(page, lambda: expect(keep).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("Shift+Tab")
        eventually(page, lambda: expect(confirm).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("Control+K")
        eventually(page, lambda:
            expect(page.get_by_role("dialog", name="Command palette")).to_have_count(0, timeout=TRY_MS))
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_have_count(0, timeout=TRY_MS))
        eventually(page, lambda: expect(remove).to_be_focused(timeout=TRY_MS))


def test_command_palette(browser, app_url):
    token, email, _ = signup(app_url)
    north = add_recipient(app_url, token, "Northwind Supply").json()["id"]
    gone = add_recipient(app_url, token, "Northern Removed").json()["id"]
    assert send(app_url, "DELETE", f"/api/recipients/{gone}", token).status_code == 204
    invite_email, _ = identity("northpending")
    post(app_url, "/api/recipients/invite", token, {"email": invite_email})
    with ui(browser) as page:
        net = Net(page)
        ui_login(page, app_url, email)
        eventually(page, lambda: expect(page).to_have_url(app_url + COCKPIT, timeout=TRY_MS))
        ready(page.get_by_role("button", name="Read balances aloud"), "attached").focus()
        page.keyboard.press("Control+K")
        palette = page.get_by_role("dialog", name="Command palette")
        box = palette.get_by_role("textbox", name="Search commands")
        eventually(page, lambda: expect(box).to_be_focused(timeout=TRY_MS))
        ready(box, "attached").press_sequentially("n")
        page.clock.fast_forward(TYPING_PAUSE_MS)
        assert net.api("/api/search") == []
        box.fill("Appr")
        eventually(page, lambda:
            expect(palette.get_by_role("option", name=re.compile("Approvals"))).to_be_visible(timeout=TRY_MS))
        ready(box).fill("nort")
        page.clock.fast_forward(TYPING_PAUSE_MS)
        option = palette.get_by_role("option", name=re.compile("Northwind Supply"))
        expect(option).to_be_visible()
        expect(palette.get_by_role("option")).to_have_count(1)
        page.keyboard.press("Enter")
        eventually(page, lambda:
            expect(page).to_have_url(re.compile(re.escape(app_url + "/payments/new?") + r".*recipient=" + re.escape(north)), timeout=TRY_MS))
        poll(lambda: selected_label(page.get_by_label("Recipient", exact=True)) == "Northwind Supply", 5, "recipient chosen")


LATE_SETTLE_ROUNDS = 10


def test_latest_search_answer_wins(browser, app_url):
    token, email, _ = signup(app_url)
    add_recipient(app_url, token, "Snow Peak Supply")
    add_recipient(app_url, token, "Northwind Supply")
    flag = ("(() => { window.__twStale = false; const check = () => { if (document.body && "
            "document.body.innerText.includes('Snow Peak Supply')) window.__twStale = true; }; "
            "new MutationObserver(check).observe(document, {subtree: true, childList: true, characterData: true}); })();")
    with ui(browser, scripts=[flag]) as page:
        ui_login(page, app_url, email)
        eventually(page, lambda: expect(page).to_have_url(app_url + COCKPIT, timeout=TRY_MS))
        wait_text(page, "Total cash")
        parked = []

        def handler(route):
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(route.request.url).query).get("q", [""])[0].strip().lower()
            if q == "no":
                parked.append(route)
            else:
                route.continue_()

        page.route("**/api/search*", handler)
        for opener, results in ((lambda: page.keyboard.press("Control+K"), "palette"),
                                (lambda: ready(page.get_by_placeholder(SEARCH_PLACEHOLDER), "attached").focus(), "top")):
            opener()
            box = (page.get_by_role("dialog", name="Command palette").get_by_role("textbox", name="Search commands")
                   if results == "palette" else page.get_by_placeholder(SEARCH_PLACEHOLDER))
            ready(box, "attached").press_sequentially("no")
            page.clock.fast_forward(TYPING_PAUSE_MS)
            box.press_sequentially("rt")
            page.clock.fast_forward(TYPING_PAUSE_MS)
            scope = (page.get_by_role("dialog", name="Command palette") if results == "palette"
                     else page.get_by_role("region", name="Search results"))
            expect(scope.get_by_text("Northwind Supply").first).to_be_visible()
            page.evaluate("() => { window.__twStale = false; }")
            while parked:
                late = parked.pop()
                with contextlib.suppress(Exception):
                    late.continue_()
            page.clock.fast_forward(ROUTE_LATE_MS)
            for _ in range(LATE_SETTLE_ROUNDS):
                page.clock.run_for(FRAME_MS)
                _pause(POLL_S / 5)
            eventually(page, lambda: expect(scope.get_by_text("Northwind Supply").first).to_be_visible(timeout=TRY_MS))
            assert page.evaluate("() => window.__twStale") is False
            page.keyboard.press("Escape")


def test_remove_recipient():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        number = account_number()
        rid = add_recipient(app.url, lk.owner, STALE_NAME, number).json()["id"]
        posted = pay(app.url, lk.owner, lk.checking, rid, 1250).json()
        scheduled = pay(app.url, lk.owner, lk.checking, rid, 100, scheduled_for="2027-07-03").json()
        held_pay = pay(app.url, lk.member, lk.savings, rid, HELD_6000).json()
        assert send(app.url, "DELETE", f"/api/recipients/{rid}", lk.member).status_code == 403
        blocked = send(app.url, "DELETE", f"/api/recipients/{rid}", lk.admin)
        assert blocked.status_code == 409 and error_of(blocked) == "recipient_has_pending_payments"
        assert get(app.url, f"/api/payments/{scheduled['id']}", lk.owner).json()["status"] == "scheduled"
        assert post(app.url, f"/api/payments/{held_pay['id']}/reject", lk.admin).status_code == 200
        audit_before = len(audit_rows(pg, lk.company))
        assert send(app.url, "DELETE", f"/api/recipients/{rid}", lk.admin).status_code == 204
        assert get(app.url, f"/api/recipients/{rid}", lk.owner).status_code == 404
        assert rid not in [r["id"] for r in get(app.url, "/api/recipients", lk.owner).json()["recipients"]]
        assert get(app.url, "/api/search", lk.owner, {"q": STALE_NAME}).json()["recipients"] == []
        assert get(app.url, f"/api/payments/{scheduled['id']}", lk.owner).json()["status"] == "cancelled"
        new_events = audit_rows(pg, lk.company)[audit_before:]
        assert [(e["action"], e["payment_id"], e["actor_email"]) for e in new_events] == \
            [("payment.cancelled", scheduled["id"], ADMIN)]
        assert get(app.url, f"/api/payments/{posted['id']}", lk.owner).json()["recipient_name"] == STALE_NAME
        assert any(t["counterparty"] == STALE_NAME for t in
                   get(app.url, "/api/transactions", lk.owner, {"account_id": lk.checking}).json()["transactions"])
        assert pay(app.url, lk.owner, lk.checking, rid, 100).status_code == 404
        again = add_recipient(app.url, lk.owner, STALE_NAME, number)
        assert again.status_code == 201 and again.json()["id"] != rid
        email, _ = identity("reinvite")
        inv = post(app.url, "/api/recipients/invite", lk.owner, {"email": email}).json()["recipient"]["id"]
        assert send(app.url, "DELETE", f"/api/recipients/{inv}", lk.owner).status_code == 204
        assert post(app.url, "/api/recipients/invite", lk.owner, {"email": email}).status_code == 201


def test_recipient_removal_ids_before_role():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        for bad in [*BAD_IDS, lk.cedar]:
            r = send(app.url, "DELETE", "/api/recipients/" + urllib.parse.quote(bad, safe=""), lk.member)
            assert r.status_code == 404 and r.json() == {"error": "not_found"}, (bad[:20], r.status_code, r.text[:200])
        r = send(app.url, "DELETE", f"/api/recipients/{lk.northwind}", lk.member)
        assert r.status_code == 403
        assert lk.northwind in [x["id"] for x in get(app.url, "/api/recipients", lk.owner).json()["recipients"]]


def test_removal_races_send():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        kinds = {"held": (lk.savings, APPROVAL_THRESHOLD + 100, {}),
                 "scheduled": (lk.checking, 100, {"scheduled_for": "2027-07-03"}),
                 "direct": (lk.checking, 100, {})}
        removed = []
        for kind, (source, amount, extra) in kinds.items():
            for _ in range(3):
                rid = add_recipient(app.url, lk.owner, f"Race {kind}").json()["id"]
                sent, gone = together(lambda: pay(app.url, lk.member, source, rid, amount, **extra),
                                      lambda: send(app.url, "DELETE", f"/api/recipients/{rid}", lk.admin))
                outcome = (sent.status_code, gone.status_code)
                if kind == "held":
                    assert outcome in ((201, 409), (404, 204)), outcome
                    if outcome == (201, 409):
                        assert get(app.url, f"/api/recipients/{rid}", lk.owner).status_code == 200
                        assert error_of(gone) == "recipient_has_pending_payments"
                        assert post(app.url, f"/api/payments/{sent.json()['id']}/reject", lk.admin).status_code == 200
                else:
                    assert outcome in ((201, 204), (404, 204)), outcome
                if sent.status_code == 404:
                    assert count(pg, f"SELECT count(*)::int AS n FROM payments WHERE recipient_id::text = {lit(rid)}") == 0
                if gone.status_code == 204:
                    removed.append(rid)
                    if kind == "scheduled" and sent.status_code == 201:
                        assert get(app.url, f"/api/payments/{sent.json()['id']}", lk.owner).json()["status"] == "cancelled"
        for rid in removed:
            assert count(pg, f"SELECT count(*)::int AS n FROM payments WHERE recipient_id::text = {lit(rid)} "
                             "AND status IN ('pending_approval', 'scheduled')") == 0


def test_direct_send_posts_atomically():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        r = pay(app.url, lk.owner, lk.checking, lk.northwind, APPROVAL_THRESHOLD, memo="Order 77")
        assert r.status_code == 201
        p = r.json()
        assert (p["status"], p["effective_date"], p["approvals_required"], p["total_debit_cents"]) == \
            ("posted", "2027-07-02", 0, APPROVAL_THRESHOLD)
        assert balance(pg, lk.checking) == CHECKING_SEED - APPROVAL_THRESHOLD == ledger_net(pg, lk.checking)
        top = newest_tx(app.url, lk.owner, lk.checking)
        assert (top["direction"], top["amount_cents"], top["counterparty"], top["method"], top["memo"]) == \
            ("debit", APPROVAL_THRESHOLD, "Northwind Supply", "ach", "Order 77")
        stored = pg.rows(f"SELECT status, effective_date::text AS d FROM payments WHERE id::text = {lit(p['id'])}")[0]
        assert (stored["status"], stored["d"]) == ("posted", "2027-07-02")
        actions = [e["action"] for e in audit_rows(pg, lk.company)]
        assert actions == ["payment.created", "payment.posted"]


def test_payment_refusals():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        email, _ = identity("pendinginv")
        pending = post(app.url, "/api/recipients/invite", lk.owner, {"email": email}).json()["recipient"]["id"]
        removed = add_recipient(app.url, lk.owner, "Gone Vendor").json()["id"]
        send(app.url, "DELETE", f"/api/recipients/{removed}", lk.owner)
        before = count(pg, f"SELECT count(*)::int AS n FROM payments WHERE company_id::text = {lit(lk.company)}")
        over = pay(app.url, lk.owner, lk.checking, lk.northwind, CHECKING_SEED + 1)
        assert over.status_code == 400 and error_of(over) == "insufficient_funds"
        for amount in (0, -500):
            assert_validation(pay(app.url, lk.owner, lk.checking, lk.northwind, amount), "amount_cents")
        assert_validation(pay(app.url, lk.owner, lk.checking, pending, 100), "recipient_id")
        assert pay(app.url, lk.owner, lk.checking, removed, 100).status_code == 404
        for day in ("2027-07-02", "2027-07-01"):
            assert_validation(pay(app.url, lk.owner, lk.checking, lk.northwind, 100, scheduled_for=day), "scheduled_for")
        unknown = get(app.url, f"/api/payments/{uuid.uuid4()}", lk.owner)
        assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
        assert balance(pg, lk.checking) == CHECKING_SEED
        assert count(pg, f"SELECT count(*)::int AS n FROM payments WHERE company_id::text = {lit(lk.company)}") == before
        assert audit_rows(pg, lk.company) == []


def test_idempotent_race_safe_sends():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        key = idem()
        first = pay(app.url, lk.owner, lk.checking, lk.northwind, 1250, key=key)
        again = pay(app.url, lk.owner, lk.checking, lk.northwind, 1250, key=key)
        assert first.status_code == again.status_code == 201 and first.content == again.content
        assert balance(pg, lk.checking) == CHECKING_SEED - 1250
        reused = pay(app.url, lk.owner, lk.checking, lk.northwind, 1251, key=key)
        assert reused.status_code == 422 and error_of(reused) == "idempotency_key_reused"
        burst_key = idem()
        burst = together(*[lambda: pay(app.url, lk.owner, lk.checking, lk.northwind, 700, key=burst_key)] * 5)
        assert {r.status_code for r in burst} == {201} and len({r.json()["id"] for r in burst}) == 1
        assert balance(pg, lk.checking) == CHECKING_SEED - 1950
        racers = together(*[lambda: pay(app.url, lk.admin, lk.checking, lk.northwind, APPROVAL_THRESHOLD)] * 4)
        won = [r for r in racers if r.status_code == 201]
        lost = [r for r in racers if r.status_code != 201]
        assert len(won) == 3 and all(r.status_code == 400 and error_of(r) == "insufficient_funds" for r in lost)
        entry = account_entry(app.url, lk.owner, lk.checking)
        assert entry["available_cents"] >= 0 and entry["balance_cents"] == CHECKING_SEED - 1950 - 3 * APPROVAL_THRESHOLD


SCHEDULE_NOW = "2026-12-01T17:00:00Z"
SCHEDULE_TABLE = {"2027-07-03": "2027-07-06", "2027-07-04": "2027-07-06", "2027-06-18": "2027-06-18",
                  "2027-12-24": "2027-12-24", "2027-12-25": "2027-12-27", "2027-11-25": "2027-11-26",
                  "2027-01-01": "2027-01-04", "2027-01-16": "2027-01-19", "2027-12-31": "2027-12-31"}


def test_scheduled_business_days():
    with copy_app(SCHEDULE_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        ids = []
        for chosen, effective in SCHEDULE_TABLE.items():
            for method in ("ach", "wire", "check", "rtp"):
                r = pay(app.url, lk.owner, lk.checking, lk.northwind, 100, method=method, scheduled_for=chosen)
                assert r.status_code == 201 and r.json()["status"] == "scheduled", r.text
                want = chosen if method == "rtp" else effective
                assert (r.json()["scheduled_for"], r.json()["effective_date"]) == (chosen, want), (method, chosen)
                ids.append(r.json()["id"])
        assert balance(pg, lk.checking) == CHECKING_SEED
        assert_validation(pay(app.url, lk.owner, lk.checking, lk.northwind, APPROVAL_THRESHOLD + 1,
                              scheduled_for="2027-07-06"), "amount_cents")
        cancelled = post(app.url, f"/api/payments/{ids[0]}/cancel", lk.owner)
        assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
        twice = post(app.url, f"/api/payments/{ids[0]}/cancel", lk.owner)
        assert twice.status_code == 409 and error_of(twice) == "payment_not_scheduled"
        rtp = post(app.url, f"/api/payments/{ids[3]}/cancel", lk.owner)
        assert rtp.status_code == 200 and rtp.json()["status"] == "cancelled"


QUOTE_TABLE = [("GBP", 12350, 9757, 124, 12474), ("GBP", 250, 198, 3, 253), ("EUR", 150, 138, 2, 152),
               ("CAD", 350, 476, 4, 354)]


def test_currency_quotes():
    with copy_app(SEED_NOW, env={"FX_QUOTE_TTL_SECONDS": "5"}) as app:
        lk = Lark(app.url)
        pg = app.pg()
        for currency, amount, foreign, fee, total in QUOTE_TABLE:
            q = post(app.url, "/api/fx/quotes", lk.owner, {"currency": currency, "amount_cents": amount})
            assert q.status_code == 201
            assert (q.json()["foreign_amount_minor"], q.json()["fee_cents"], q.json()["total_debit_cents"]) == \
                (foreign, fee, total)
        for bad in ("gbp", "JPY"):
            assert_validation(post(app.url, "/api/fx/quotes", lk.owner, {"currency": bad, "amount_cents": 100}), "currency")
        q = post(app.url, "/api/fx/quotes", lk.owner, {"currency": "GBP", "amount_cents": 12350}).json()
        assert_validation(pay(app.url, lk.owner, lk.checking, lk.northwind, 12350, fx_quote_id=q["id"]), "fx_quote_id")
        assert_validation(pay(app.url, lk.owner, lk.checking, lk.northwind, 12351, method="wire", fx_quote_id=q["id"]),
                          "fx_quote_id")
        used = pay(app.url, lk.owner, lk.checking, lk.northwind, 12350, method="wire", fx_quote_id=q["id"])
        assert used.status_code == 201 and used.json()["total_debit_cents"] == 12474
        assert balance(pg, lk.checking) == CHECKING_SEED - 12474
        again = pay(app.url, lk.owner, lk.checking, lk.northwind, 12350, method="wire", fx_quote_id=q["id"])
        assert again.status_code == 409 and error_of(again) == "quote_used"
        q2 = post(app.url, "/api/fx/quotes", lk.owner, {"currency": "EUR", "amount_cents": 150}).json()
        race = together(*[lambda: pay(app.url, lk.owner, lk.checking, lk.northwind, 150, method="wire",
                                      fx_quote_id=q2["id"])] * 3)
        assert sorted(r.status_code for r in race) == [201, 409, 409]
        q3 = post(app.url, "/api/fx/quotes", lk.owner, {"currency": "CAD", "amount_cents": 350}).json()
        wait_business(app.url, lk.owner, q3["expires_at"], 30)
        late = pay(app.url, lk.owner, lk.checking, lk.northwind, 350, method="wire", fx_quote_id=q3["id"])
        assert late.status_code == 409 and error_of(late) == "quote_expired"
        assert balance(pg, lk.checking) == CHECKING_SEED - 12474 - 152


def test_scheduled_posting_new_york_midnight():
    with copy_app("2027-03-12T15:00:00Z") as app:
        lk = Lark(app.url)
        pg = app.pg()
        empty = new_account(app.url, lk.owner, "Empty Ops")

        def sched(source, method, day):
            r = pay(app.url, lk.owner, source, lk.northwind, 100, method=method, scheduled_for=day)
            assert r.status_code == 201 and r.json()["status"] == "scheduled", r.text
            return r.json()["id"]

        a = sched(lk.checking, "ach", "2027-03-15")
        r1 = sched(lk.checking, "rtp", "2027-03-14")
        c = sched(lk.checking, "ach", "2027-03-16")
        f = sched(empty, "ach", "2027-03-16")
        r2 = sched(lk.checking, "rtp", "2027-11-07")
        b = sched(lk.checking, "ach", "2027-11-08")

        def status(pid):
            return get(app.url, f"/api/payments/{pid}", lk.owner).json()["status"]

        def edge(still, midnight, posting, waiting):
            app.restart(iso(parse_ts(midnight) - timedelta(seconds=EDGE_MARGIN_S)))
            assert parse_ts(me(app.url, lk.owner)["business_now"]) < parse_ts(still), "boot too slow"
            wait_business(app.url, lk.owner, still, EDGE_MARGIN_S + SLACK_S)
            assert status(posting) == "scheduled"
            wait_business(app.url, lk.owner, midnight, EDGE_MARGIN_S + SLACK_S)
            poll(lambda: status(posting) == "posted", POSTING_S + SLACK_S, f"{posting} posted after {midnight}")
            if waiting:
                assert status(waiting) == "scheduled"

        edge("2027-03-14T04:59:50Z", "2027-03-14T05:00:00Z", r1, a)
        edge("2027-03-15T03:59:50Z", "2027-03-15T04:00:00Z", a, c)
        posted = get(app.url, f"/api/payments/{a}", lk.owner).json()
        assert posted["effective_date"] == "2027-03-15"
        app.restart("2027-03-16T12:00:00Z")
        poll(lambda: status(c) == "posted" and status(f) == "failed", POSTING_S + SLACK_S, "catch-up")
        assert balance(pg, empty) == 0
        edge("2027-11-07T03:59:50Z", "2027-11-07T04:00:00Z", r2, b)
        edge("2027-11-08T04:59:50Z", "2027-11-08T05:00:00Z", b, None)
        assert balance(pg, lk.checking) == CHECKING_SEED - 500 == ledger_net(pg, lk.checking)
        events = audit_rows(pg, lk.company)
        system = [(e["action"], e["payment_id"]) for e in events if e["actor_email"] == SYSTEM_ACTOR]
        assert sorted(system) == sorted([("payment.posted", p) for p in (r1, a, c, r2, b)] + [("payment.failed", f)])


def test_same_day_cutoffs():
    with copy_app("2027-03-12T20:30:00Z") as app:
        lk = Lark(app.url)

        def eff(method, token=None):
            r = pay(app.url, token or lk.owner, lk.checking, lk.northwind, 100, method=method)
            assert r.status_code == 201 and r.json()["status"] == "posted", r.text
            return r.json()["effective_date"]

        assert eff("ach") == "2027-03-12"
        app.restart("2027-03-15T20:30:00Z")
        assert eff("ach") == "2027-03-16"
        app.restart("2027-07-02T19:58:30Z")
        assert parse_ts(me(app.url, lk.owner)["business_now"]) < parse_ts("2027-07-02T19:59:45Z"), "boot too slow"
        assert (eff("ach"), eff("wire"), eff("rtp"), eff("check")) == ("2027-07-02", "2027-07-02", "2027-07-02", "2027-07-06")
        held_pay = pay(app.url, lk.member, lk.checking, lk.northwind, HELD_6000).json()
        assert held_pay["effective_date"] is None
        wait_business(app.url, lk.owner, "2027-07-02T20:00:01Z", 120)
        assert (eff("ach"), eff("wire")) == ("2027-07-06", "2027-07-02")
        approved = post(app.url, f"/api/payments/{held_pay['id']}/approve", lk.owner).json()
        assert (approved["status"], approved["effective_date"]) == ("posted", "2027-07-06")
        app.restart("2027-07-03T15:00:00Z")
        assert (eff("rtp"), eff("ach")) == ("2027-07-03", "2027-07-06")
        app.restart("2027-11-08T21:30:00Z")
        assert eff("wire") == "2027-11-08"


PREVIEW_ROWS = [("2027-03-13T23:00:00Z", {"ach": "2027-03-15", "wire": "2027-03-15", "rtp": "2027-03-13",
                                          "check": "2027-03-15"}, "2027-03-14T05:00:00Z"),
                ("2027-11-06T23:00:00Z", {"ach": "2027-11-08", "wire": "2027-11-08", "rtp": "2027-11-06",
                                          "check": "2027-11-08"}, "2027-11-07T04:00:00Z")]


def test_settlement_preview(browser):
    with copy_app(PREVIEW_ROWS[0][0]) as app:
        lk = Lark(app.url)
        for i, (now, dates, change) in enumerate(PREVIEW_ROWS):
            if i:
                app.restart(now)
            m = me(app.url, lk.owner)
            assert m["settlement_dates"] == dates and parse_ts(m["settlement_dates_change_at"]) == parse_ts(change)
        app.restart("2027-07-02T19:58:00Z")
        m = me(app.url, lk.owner)
        assert m["settlement_dates"] == {"ach": "2027-07-02", "wire": "2027-07-02", "rtp": "2027-07-02",
                                         "check": "2027-07-06"}
        assert parse_ts(m["settlement_dates_change_at"]) == parse_ts("2027-07-02T20:00:00Z")
        with ui(browser, timezone=WRONG_TZ, clock_time=WRONG_CLOCK) as page:
            ui_login(page, app.url, OWNER)
            page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount="1,234.56"))
            wait_text(page, "Settles Fri, Jul 2, 2027")
            ready(page.get_by_role("button", name="Review payment")).click()
            wait_text(page, "$1,234.56")
            wait_text(page, "Settles Fri, Jul 2, 2027")
            review_url = page.url
            remaining = (parse_ts("2027-07-02T20:00:00Z") - parse_ts(me(app.url, lk.owner)["business_now"])).total_seconds()
            wait_text(page, "Settles Tue, Jul 6, 2027", max(remaining, 0) + SETTLEMENT_UPDATE_S + SLACK_S)
            assert page.url == review_url
            eventually(page, lambda:
                expect(page.get_by_role("button", name="Confirm and send")).to_be_visible(timeout=TRY_MS))
            wait_text(page, "$1,234.56")


def test_wf_send_payment_review(browser):
    with copy_app(SEED_NOW) as app, ui(browser, timezone=WRONG_TZ, clock_time=WRONG_CLOCK) as page:
        lk = Lark(app.url)
        net = Net(page)
        ui_login(page, app.url, OWNER)
        page.goto(app.url + "/payments/new")
        source = page.get_by_label("Source account")
        label = choose(source, "Checking")
        assert dollars(CHECKING_SEED) + " available" in label
        assert any("Savings" in l and dollars(SAVINGS_SEED) + " available" in l for l in option_labels(source))
        choose(page.get_by_label("Recipient", exact=True), "Northwind Supply")
        assert selected_label(page.get_by_label("Method")) == "ACH"
        wait_text(page, "Settles Fri, Jul 2, 2027")
        over = dollars(CHECKING_SEED + 1)[1:]
        ready(page.get_by_label("Amount")).fill(over)
        ready(page.get_by_label("Memo")).fill("Invoice 7/2")
        ready(page.get_by_role("button", name="Review payment")).click()
        wait_text(page, "You don't have enough in this account")
        assert page.get_by_label("Amount").input_value() == over
        assert page.get_by_label("Memo").input_value() == "Invoice 7/2"
        assert net.api("/api/payments", "POST") == []
        ready(page.get_by_label("Amount")).fill("1,234.56")
        ready(page.get_by_role("button", name="Review payment")).click()
        for text in ("$1,234.56", "Northwind Supply", "Checking", "Settles Fri, Jul 2, 2027"):
            wait_text(page, text)
        ready(page.get_by_role("button", name="Confirm and send")).click()
        wait_status(page, "Payment sent")
        eventually(page, lambda: expect(page).to_have_url(app.url + "/payments/new", timeout=TRY_MS))
        rows = app.pg().rows(f"SELECT amount_cents, memo, status FROM payments WHERE company_id::text = {lit(lk.company)}")
        assert [(int(r["amount_cents"]), r["memo"], r["status"]) for r in rows] == [(123456, "Invoice 7/2", "posted")]
        assert balance(app.pg(), lk.checking) == CHECKING_SEED - 123456
        page.goto(app.url + COCKPIT)
        eventually(page, lambda:
            expect(feed(page).first.get_by_role("listitem").first).to_contain_text("Northwind Supply", timeout=TRY_MS))


def test_wf_send_payment_scheduled(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        ui_login(page, app.url, OWNER)
        page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount=dollars(SMALL_CENTS)[1:]))
        wait_text(page, "Settles Fri, Jul 2, 2027")
        ready(page.get_by_label("Send on")).fill("2027-07-02")
        eventually(page, lambda: expect(page.get_by_text(re.compile(r"^Settles "))).to_have_count(0, timeout=TRY_MS))
        ready(page.get_by_role("button", name="Review payment")).click()
        wait_text(page, "Choose a date after today")
        ready(page.get_by_label("Send on")).fill("2027-07-03")
        ready(page.get_by_role("button", name="Review payment")).click()
        ready(page.get_by_role("button", name="Confirm and send")).click()
        wait_status(page, "Payment scheduled Scheduled for Tue, Jul 6, 2027")
        p = get(app.url, "/api/payments", lk.owner).json()["payments"][0]
        assert (p["status"], p["effective_date"], p["amount_cents"]) == ("scheduled", "2027-07-06", SMALL_CENTS)
        assert balance(app.pg(), lk.checking) == CHECKING_SEED
        page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount="5,000.01"))
        wait_text(page, "Settles once approved")
        ready(page.get_by_role("button", name="Review payment")).click()
        ready(page.get_by_role("button", name="Confirm and send")).click()
        wait_status(page, "Payment awaiting approval")
        assert get(app.url, "/api/approvals", lk.owner).json()["approvals"][0]["amount_cents"] == 500001


def test_wf_send_payment_scheduled_cap(browser):
    """DP-19: "Review payment" checks only the dollar format, zero, the available balance and the "Send on" date, so a
    scheduled amount over the approval threshold opens the review step. "Confirm and send" then shows the server's
    refusal "Scheduled payments can be at most $5,000.00", and nothing is stored or moved."""
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        ui_login(page, app.url, OWNER)
        page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount="6,000.00"))
        wait_text(page, "Settles once approved")
        ready(page.get_by_label("Send on")).fill("2027-07-06")
        ready(page.get_by_role("button", name="Review payment")).click()
        ready(page.get_by_role("button", name="Confirm and send")).click()
        wait_text(page, "Scheduled payments can be at most $5,000.00")
        payments = get(app.url, "/api/payments", lk.owner).json()["payments"]
        assert [p for p in payments if p["amount_cents"] == 600000] == []
        assert [a for a in get(app.url, "/api/approvals", lk.owner).json()["approvals"] if a["amount_cents"] == 600000] == []
        assert balance(app.pg(), lk.checking) == CHECKING_SEED


def test_wf_send_payment_resume(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        net = Net(page)
        ui_login(page, app.url, OWNER)
        draft = draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount="1,234.56", memo="Invoice 7/2",
                          step="review")
        page.goto(draft)
        eventually(page, lambda:
            expect(page.get_by_role("button", name="Confirm and send")).to_be_visible(timeout=TRY_MS))
        draft_path = live_url(page)[len(app.url):]
        assert dict(query_list(live_url(page))).get("step") == "review"
        depth = history_len(page)
        assert post(app.url, "/api/auth/logout", net.token()).status_code == 204
        deadline = time.monotonic() + REVOKE_S + SLACK_S
        while time.monotonic() < deadline and "/login" not in page.url:
            page.clock.fast_forward(1000)
            _pause(POLL_S)
        if "/login" not in page.url:
            ready(page.get_by_role("button", name="Confirm and send")).click()
        page.wait_for_url(re.compile(r"/login\?next="), timeout=10000)
        assert dict(query_list(page.url))["next"] == draft_path
        assert history_len(page) == depth
        pg = app.pg()
        assert count(pg, f"SELECT count(*)::int AS n FROM payments WHERE company_id::text = {lit(lk.company)}") == 0
        ready(page.get_by_label("Email", exact=True)).fill(OWNER)
        ready(page.get_by_label("Password", exact=True)).fill(PASSWORD)
        ready(page.get_by_role("button", name="Log in", exact=True)).click()
        eventually(page, lambda: expect(page).to_have_url(app.url + draft_path, timeout=TRY_MS))
        wait_text(page, "$1,234.56")
        wait_text(page, "Northwind Supply")
        wait_text(page, "Settles Fri, Jul 2, 2027")
        ready(page.get_by_role("button", name="Confirm and send")).click()
        wait_status(page, "Payment sent")
        rows = pg.rows(f"SELECT amount_cents, memo FROM payments WHERE company_id::text = {lit(lk.company)}")
        assert [(int(r["amount_cents"]), r["memo"]) for r in rows] == [(123456, "Invoice 7/2")]


def test_send_draft_address(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        gone = add_recipient(app.url, lk.owner, "Draft Gone").json()["id"]
        send(app.url, "DELETE", f"/api/recipients/{gone}", lk.owner)
        ui_login(page, app.url, OWNER)
        page.goto(app.url + "/payments/new")
        h0 = history_len(page)
        choose(page.get_by_label("Source account"), "Checking")
        choose(page.get_by_label("Recipient", exact=True), "Northwind Supply")
        select(page.get_by_label("Method"), "Wire")
        ready(page.get_by_label("Amount")).fill("1,234.56")
        ready(page.get_by_label("Memo")).fill("Invoice 7/2")
        poll(lambda: [k for k, _ in query_list(live_url(page))] == ["source", "recipient", "method", "amount", "memo"], 5,
             "draft order")
        assert query_list(live_url(page)) == [("source", lk.checking), ("recipient", lk.northwind), ("method", "wire"),
                                        ("amount", "1,234.56"), ("memo", "Invoice 7/2")]
        assert "amount=1%2C234.56" in live_url(page)
        assert history_len(page) == h0
        ready(page.get_by_role("button", name="Review payment")).click()
        poll(lambda: query_list(live_url(page))[-1] == ("step", "review"), 5, "review in address")
        assert history_len(page) == h0 + 1
        ready(page.get_by_role("button", name="Back", exact=True)).click()
        poll(lambda: "step" not in dict(query_list(live_url(page))), 5, "form again")
        assert page.get_by_label("Amount").input_value() == "1,234.56"
        page.go_forward()
        eventually(page, lambda:
            expect(page.get_by_role("button", name="Confirm and send")).to_be_visible(timeout=TRY_MS))
        assert "Invoice" not in storage_dump(page)
        ready(page.get_by_role("button", name="Confirm and send")).click()
        wait_status(page, "Payment sent")
        poll(lambda: live_url(page) == app.url + "/payments/new", 5, "draft cleared from address")
        page.go_back()
        eventually(page, lambda:
            expect(page.get_by_role("button", name="Confirm and send")).to_have_count(0, timeout=TRY_MS))
        page.goto(app.url + "/payments/new")
        before = history_len(page)
        page.goto(app.url + f"/payments/new?source={lk.outpost}&recipient={gone}&method=bogus&amount=7")
        poll(lambda: live_url(page) == app.url + "/payments/new?amount=7", 5, "foreign values removed in place")
        assert history_len(page) == before + 1
        assert page.get_by_label("Amount").input_value() == "7"
        page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount="12.345", step="review"))
        wait_text(page, DOLLAR_COPY)
        assert "step" not in dict(query_list(live_url(page)))


DOLLAR_TABLE = [("1,234.56", 123456), ("$0.29", 29), ("4.35", 435), ("12.5", 1250), ("5,000.00", 500000),
                ("5,000.01", 500001)]
DOLLAR_REFUSED = ["12.345", "1,23", "-5", "1e3", "12.", "abc"]


def test_dollar_entry(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        net = Net(page)
        pg = app.pg()
        ui_login(page, app.url, OWNER)
        for typed, cents in DOLLAR_TABLE:
            page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount=typed, step="review"))
            wait_text(page, dollars(cents))
            ready(page.get_by_role("button", name="Confirm and send")).click()
            eventually(page, lambda: expect(page).to_have_url(app.url + "/payments/new", timeout=TRY_MS))
            newest = pg.rows(f"SELECT amount_cents FROM payments WHERE company_id::text = {lit(lk.company)} "
                             "ORDER BY created_at DESC LIMIT 1")[0]
            assert int(newest["amount_cents"]) == cents, typed
        sends = len(net.api("/api/payments", "POST"))
        for typed in DOLLAR_REFUSED:
            page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount=typed, step="review"))
            wait_text(page, DOLLAR_COPY)
            assert page.get_by_label("Amount").input_value() == typed
        page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount="0.00", step="review"))
        wait_text(page, "Enter an amount greater than $0.00")
        assert len(net.api("/api/payments", "POST")) == sends


def go_home_in_app(page):
    link = page.evaluate_handle("p => [...document.querySelectorAll('a')].find(a => a.offsetParent !== null "
                                "&& new URL(a.href, location.href).pathname === p)", COCKPIT).as_element()
    assert link is not None, "no visible link to the cockpit home"
    link.click()  # static: ElementHandle just resolved as a visible link; Playwright's own actionability wait
    eventually(page, lambda: expect(page).to_have_url(re.compile(re.escape(COCKPIT) + "$"), timeout=TRY_MS))


SHOWER_NOTES_JS = """() => { const c = document.querySelector('[data-celebration]'); if (!c) return null;
  const op = n => { let o = 1; for (; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const canvas = c.querySelector('canvas');
  let pixels = '';
  if (canvas) { try { pixels = canvas.toDataURL().slice(-200); } catch (e) { pixels = String(Math.random()); } }
  const notes = [...c.querySelectorAll('*')].filter(e => !e.children.length && e.tagName !== 'CANVAS').slice(0, 40)
    .map(e => [e.getBoundingClientRect().top, op(e)]);
  return {vh: innerHeight, canvas: !!canvas, pixels, notes}; }"""
NOTE_FADED = 0.5
CELEBRATION_ON_SEND_S = 3
CELEBRATION_SPY = """(() => { window.__twCelebrated = false; new MutationObserver(() => {
  if (document.querySelector('[data-celebration]')) window.__twCelebrated = true; })
  .observe(document, {subtree: true, childList: true, attributes: true}); })();"""


def test_send_celebration(browser):
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        with ui(browser) as page:
            ui_login(page, app.url, OWNER)
            page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount="12.50", step="review"))
            ready(page.get_by_role("button", name="Confirm and send")).click()

            def shower_count():
                return page.evaluate("() => document.querySelectorAll('[data-celebration]').length")

            wait_status(page, "Payment sent")
            try:
                poll(lambda: shower_count() == 1, CELEBRATION_ON_SEND_S, "celebration on the send page")
            except AssertionError:
                go_home_in_app(page)
                poll(lambda: shower_count() == 1, 10, "celebration on the cockpit home")
            assert page.evaluate("() => document.querySelector('[data-celebration]').getAttribute('aria-hidden')") == "true"
            hit = page.evaluate("() => { const c = document.querySelector('[data-celebration]'); "
                                "const r = c.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; "
                                "const top = document.elementFromPoint(x, y); return !!top && !c.contains(top); }")
            assert hit
            samples, started = [], time.monotonic()
            while time.monotonic() - started < CELEBRATION_MS / 1000:
                got = page.evaluate(SHOWER_NOTES_JS)
                if got is None:
                    break
                samples.append(got)
                _pause(POLL_S / 5)
            assert samples, "the celebration left before it could be seen"
            if samples[0]["canvas"]:
                assert len({x["pixels"] for x in samples}) > 1, "the drawn shower never changed"
            else:
                count = min(len(x["notes"]) for x in samples)
                assert count >= 2, "the shower holds no notes"
                tops = [[x["notes"][i][0] for x in samples] for i in range(count)]
                fades = [[x["notes"][i][1] for x in samples] for i in range(count)]
                assert max(max(t) - min(t) for t in tops) > samples[0]["vh"] / 2, "no note falls half the window"
                assert any(min(f[f.index(max(f)):]) <= NOTE_FADED * max(f) for f in fades if max(f) > 0), "no note fades"
            page.clock.fast_forward(CELEBRATION_MS)
            poll(lambda: shower_count() == 0, 2, "celebration removed")
        with ui(browser, reduced=True, scripts=[CELEBRATION_SPY]) as page:
            ui_login(page, app.url, OWNER)
            page.goto(draft_url(app.url, source=lk.checking, recipient=lk.northwind, amount="12.50", step="review"))
            ready(page.get_by_role("button", name="Confirm and send")).click()
            wait_status(page, "Payment sent")
            assert page.evaluate("() => window.__twCelebrated") is False
            go_home_in_app(page)
            wait_text(page, "Total cash")
            page.clock.fast_forward(CELEBRATION_MS)
            assert page.evaluate("() => window.__twCelebrated") is False


def test_approval_threshold():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        at = pay(app.url, lk.member, lk.checking, lk.northwind, APPROVAL_THRESHOLD).json()
        assert (at["status"], at["approvals_required"]) == ("posted", 0)
        over = pay(app.url, lk.member, lk.checking, lk.northwind, APPROVAL_THRESHOLD + 1).json()
        assert (over["status"], over["approvals_required"], over["effective_date"]) == ("pending_approval", 1, None)
        assert over["expires_at"] and over["approve_by"]
        assert balance(pg, lk.checking) == CHECKING_SEED - APPROVAL_THRESHOLD
        done = post(app.url, f"/api/payments/{over['id']}/approve", lk.admin).json()
        assert done["status"] == "posted" and done["effective_date"] == "2027-07-02"
        assert balance(pg, lk.checking) == CHECKING_SEED - 2 * APPROVAL_THRESHOLD - 1
        for action, token in (("approve", lk.owner), ("reject", lk.owner)):
            r = post(app.url, f"/api/payments/{over['id']}/{action}", token)
            assert r.status_code == 409 and error_of(r) == "payment_not_pending"


def test_who_may_approve():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        mine = pay(app.url, lk.owner, lk.savings, lk.northwind, HELD_6000).json()
        assert post(app.url, f"/api/payments/{mine['id']}/approve", lk.owner).status_code == 403
        for action in ("approve", "reject"):
            assert post(app.url, f"/api/payments/{mine['id']}/{action}", lk.member).status_code == 403
        rejected = post(app.url, f"/api/payments/{mine['id']}/reject", lk.owner)
        assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
        assert balance(pg, lk.savings) == SAVINGS_SEED
        assert account_entry(app.url, lk.owner, lk.savings)["available_cents"] == SAVINGS_SEED
        other = pay(app.url, lk.member, lk.savings, lk.northwind, HELD_6000).json()
        assert post(app.url, f"/api/payments/{other['id']}/approve", lk.admin).json()["status"] == "posted"
        assert balance(pg, lk.savings) == SAVINGS_SEED - HELD_6000


def test_dual_approval():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        p = pay(app.url, lk.member, lk.savings, lk.northwind, DUAL_HELD).json()
        assert p["approvals_required"] == 2
        first = post(app.url, f"/api/payments/{p['id']}/approve", lk.admin).json()
        assert first["status"] == "pending_approval" and [a["name"] for a in first["approvals"]] == ["Imani Cole"]
        assert balance(pg, lk.savings) == SAVINGS_SEED
        repeat = post(app.url, f"/api/payments/{p['id']}/approve", lk.admin)
        assert repeat.status_code == 409 and error_of(repeat) == "already_approved"
        final = post(app.url, f"/api/payments/{p['id']}/approve", lk.owner).json()
        assert final["status"] == "posted" and len(final["approvals"]) == 2
        assert balance(pg, lk.savings) == SAVINGS_SEED - DUAL_HELD


def test_audit_chain():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        direct = pay(app.url, lk.owner, lk.checking, lk.northwind, 1250).json()
        heldp = pay(app.url, lk.member, lk.checking, lk.northwind, HELD_6000).json()
        post(app.url, f"/api/payments/{heldp['id']}/approve", lk.admin)
        rej = pay(app.url, lk.member, lk.checking, lk.northwind, HELD_6000).json()
        post(app.url, f"/api/payments/{rej['id']}/reject", lk.owner)
        transfer(app.url, lk.owner, lk.savings, lk.checking, 300)
        post(app.url, f"/api/invoices/{invoice_ids(app.url, lk.owner)['INV-1004']}/mark-paid", lk.owner,
             {"account_id": lk.checking})
        post(app.url, f"/api/loans/{loan(app.url, lk.owner)['id']}/draw", lk.owner, {"amount_cents": 29})
        events = get(app.url, "/api/audit", lk.owner).json()["events"]
        refused = pay(app.url, lk.owner, lk.checking, lk.northwind, CHECKING_SEED * 10)
        assert refused.status_code == 400
        assert post(app.url, f"/api/payments/{rej['id']}/approve", lk.admin).status_code == 409
        assert get(app.url, "/api/audit", lk.owner).json()["events"] == events
        got = [(e["action"], e["payment_id"], e["amount_cents"], e["actor_email"]) for e in events]
        assert got == [("payment.created", direct["id"], 1250, OWNER), ("payment.posted", direct["id"], 1250, OWNER),
                       ("payment.created", heldp["id"], HELD_6000, MEMBER),
                       ("payment.approved", heldp["id"], HELD_6000, ADMIN),
                       ("payment.posted", heldp["id"], HELD_6000, ADMIN),
                       ("payment.created", rej["id"], HELD_6000, MEMBER),
                       ("payment.rejected", rej["id"], HELD_6000, OWNER),
                       ("transfer.posted", None, 300, OWNER), ("invoice.paid", None, INVOICES["INV-1004"], OWNER),
                       ("loan.drawn", None, 29, OWNER)]
        check_chain(events)
        assert get(app.url, "/api/audit", lk.member).status_code == 403


def test_audit_append_only():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        loan_id = loan(app.url, lk.owner)["id"]
        helds = [pay(app.url, lk.member, lk.savings, lk.northwind, HELD_6000).json()["id"] for _ in range(3)]
        work = [lambda: transfer(app.url, lk.owner, lk.checking, lk.savings, 100)] * 4 + \
               [lambda: post(app.url, f"/api/loans/{loan_id}/draw", lk.owner, {"amount_cents": 100})] * 4 + \
               [lambda p=p: post(app.url, f"/api/payments/{p}/approve", lk.admin) for p in helds]
        assert all(r.status_code in (200, 201) for r in together(*work))
        pg = app.pg()
        before = audit_rows(pg, lk.company)
        check_chain(before)
        for sql in ("UPDATE audit_events SET amount_cents = 1", "DELETE FROM audit_events",
                    "TRUNCATE audit_events"):
            out = subprocess.run(["psql", app.database_url, "-v", "ON_ERROR_STOP=1", "-c", sql],
                                 capture_output=True, text=True, timeout=60)
            assert out.returncode != 0, (sql, out.stdout)
        assert audit_rows(pg, lk.company) == before


def test_wf_approvals_keyboard(browser):
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        p = pay(app.url, lk.member, lk.savings, lk.northwind, DUAL_HELD).json()
        assert p["approve_by"] == "2027-07-11"
        name = "Approve $50,001.00 to Northwind Supply from Savings"
        with ui(browser, timezone=WRONG_TZ, clock_time=WRONG_CLOCK) as page:
            ui_login(page, app.url, ADMIN)
            page.goto(app.url + "/approvals")
            eventually(page, lambda:
                expect(page.get_by_role("heading", level=1, name="Approvals")).to_be_visible(timeout=TRY_MS))
            approve = page.get_by_role("button", name=name)
            reject = page.get_by_role("button", name="Reject $50,001.00 to Northwind Supply from Savings")
            for text in ("Theo Marsh", "Northwind Supply", "ACH", "Savings", "$50,001.00", progress(0, 2),
                         "Approve by Sun, Jul 11, 2027"):
                wait_text(page, text)
            ready(approve, "attached").focus()
            page.keyboard.press("Enter")
            wait_status(page, "Approval recorded")
            wait_text(page, progress(1, 2))
            wait_text(page, "Approved by " + "Imani Cole")
            eventually(page, lambda: expect(reject).to_be_focused(timeout=TRY_MS))
            assert balance(pg, lk.savings) == SAVINGS_SEED
            ready(approve, "attached").focus()
            page.keyboard.press("Enter")
            wait_status(page, "You've already approved this payment.")
        with ui(browser) as page:
            ui_login(page, app.url, OWNER)
            page.goto(app.url + "/approvals")
            eventually(page, lambda:
                expect(page.get_by_role("link", name="Approvals, 1 waiting").first).to_be_visible(timeout=TRY_MS))
            ready(page.get_by_role("button", name=name), "attached").focus()
            page.keyboard.press("Space")
            wait_status(page, "Payment approved and sent")
            eventually(page, lambda: expect(page.get_by_role("button", name=name)).to_have_count(0, timeout=TRY_MS))
            eventually(page, lambda:
                expect(page.get_by_role("heading", level=1, name="Approvals")).to_be_focused(timeout=TRY_MS))
        assert balance(pg, lk.savings) == SAVINGS_SEED - DUAL_HELD


def test_wf_approvals_live(browser):
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        ids = [pay(app.url, lk.member, lk.checking, lk.northwind, amt).json()["id"]
               for amt in (HELD_6000, HELD_6000, HELD_6400)]
        assert account_entry(app.url, lk.owner, lk.checking)["available_cents"] == CHECKING_LEFT
        base = "Approve $6,000.00 to Northwind Supply from Checking"
        with ui(browser) as page:
            ui_login(page, app.url, ADMIN)
            page.goto(app.url + "/approvals")
            second = page.get_by_role("button", name=f"{base} (payment 2 of 2)")
            eventually(page, lambda:
                expect(page.get_by_role("button", name=f"{base} (payment 1 of 2)")).to_be_visible(timeout=TRY_MS))
            ready(second, "attached").focus()
            handle = second.element_handle()
            assert post(app.url, f"/api/payments/{ids[0]}/reject", lk.owner).status_code == 200
            live = APPROVALS_LIVE_S + SLACK_S
            eventually(page, lambda:
                expect(page.get_by_role("button", name=base, exact=True)).to_be_focused(timeout=TRY_MS), live * 1000)
            assert page.evaluate("el => el === document.activeElement", handle)
            wait_status(page, "Payments waiting for approval: 2", live)
            eventually(page, lambda:
                expect(page.get_by_role("link", name="Approvals, 2 waiting").first).to_be_visible(timeout=TRY_MS), live * 1000)
            assert post(app.url, f"/api/payments/{ids[1]}/reject", lk.owner).status_code == 200
            eventually(page, lambda: expect(page.get_by_role("button", name=approve_name(HELD_6400, "Checking"))) \
                .to_be_focused(timeout=TRY_MS), live * 1000)
            assert post(app.url, f"/api/payments/{ids[2]}/reject", lk.owner).status_code == 200
            eventually(page, lambda:
                expect(page.get_by_role("heading", level=1, name="Approvals")).to_be_focused(timeout=TRY_MS), live * 1000)
            eventually(page, lambda:
                expect(page.get_by_role("link", name="Approvals", exact=True).first).to_be_visible(timeout=TRY_MS), live * 1000)


def test_wf_approvals_names(browser):
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        for amount in (HELD_6000, HELD_6000, HELD_6400):
            r = pay(app.url, lk.member, lk.checking, lk.northwind, amount)
            assert r.status_code == 201 and r.json()["status"] == "pending_approval"
        twin = "$6,000.00 to Northwind Supply from Checking"
        single = dollars(HELD_6400) + " to Northwind Supply from Checking"
        with ui(browser) as page:
            ui_login(page, app.url, ADMIN)
            page.goto(app.url + "/approvals")
            for verb in ("Approve", "Reject"):
                for k in (1, 2):
                    eventually(page, lambda k=k, verb=verb: expect(page.get_by_role("button", name=f"{verb} {twin} (payment {k} of 2)", exact=True)) \
                        .to_have_count(1, timeout=TRY_MS))
                eventually(page, lambda verb=verb:
                    expect(page.get_by_role("button", name=f"{verb} {twin}", exact=True)).to_have_count(0, timeout=TRY_MS))
                eventually(page, lambda verb=verb:
                    expect(page.get_by_role("button", name=f"{verb} {single}", exact=True)).to_have_count(1, timeout=TRY_MS))
            ready(page.get_by_role("button", name=f"Reject {twin} (payment 2 of 2)", exact=True)).click()
            eventually(page, lambda:
                expect(page.get_by_role("button", name=f"Approve {single}", exact=True)).to_be_focused(timeout=TRY_MS), 10000)
            ready(page.get_by_role("button", name=f"Reject {single}", exact=True)).click()
            eventually(page, lambda:
                expect(page.get_by_role("button", name=f"Approve {twin}", exact=True)).to_be_focused(timeout=TRY_MS), 10000)
            ready(page.get_by_role("button", name=f"Reject {twin}", exact=True)).click()
            eventually(page, lambda:
                expect(page.get_by_role("heading", level=1, name="Approvals")).to_be_focused(timeout=TRY_MS), 10000)
        assert get(app.url, "/api/approvals", lk.owner).json()["approvals"] == []


def test_simultaneous_approval_decisions():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        lid = loan(app.url, lk.owner)["id"]

        def fund(cents):
            r = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": cents})
            assert r.status_code == 200, r.text

        for _ in range(3):
            fund(DUAL_THRESHOLD)
            created = pay(app.url, lk.member, lk.checking, lk.northwind, DUAL_HELD)
            assert created.status_code == 201 and created.json()["status"] == "pending_approval", created.text
            p = created.json()
            before = balance(pg, lk.checking)
            a, b = together(lambda: post(app.url, f"/api/payments/{p['id']}/approve", lk.admin),
                            lambda: post(app.url, f"/api/payments/{p['id']}/approve", lk.owner))
            assert {a.status_code, b.status_code} == {200}
            assert sorted([a.json()["status"], b.json()["status"]]) == ["pending_approval", "posted"]
            assert balance(pg, lk.checking) == before - DUAL_HELD
            mine = [e["action"] for e in audit_rows(pg, lk.company) if e["payment_id"] == p["id"]]
            assert mine == ["payment.created", "payment.approved", "payment.approved", "payment.posted"]
        fund(4 * HELD_6000)
        for _ in range(3):
            q = pay(app.url, lk.member, lk.checking, lk.northwind, HELD_6000).json()
            before = balance(pg, lk.checking)
            ap, rj = together(lambda: post(app.url, f"/api/payments/{q['id']}/approve", lk.admin),
                              lambda: post(app.url, f"/api/payments/{q['id']}/reject", lk.owner))
            assert sorted([ap.status_code, rj.status_code]) == [200, 409]
            loser = ap if ap.status_code == 409 else rj
            assert error_of(loser) == "payment_not_pending"
            status = get(app.url, f"/api/payments/{q['id']}", lk.owner).json()["status"]
            assert status == ("posted" if ap.status_code == 200 else "rejected")
            assert balance(pg, lk.checking) == before - (HELD_6000 if status == "posted" else 0)
            posted_events = [e for e in audit_rows(pg, lk.company)
                             if e["payment_id"] == q["id"] and e["action"] == "payment.posted"]
            assert len(posted_events) == (1 if status == "posted" else 0)
        q = pay(app.url, lk.member, lk.checking, lk.northwind, HELD_6000).json()
        before = balance(pg, lk.checking)
        both = together(lambda: post(app.url, f"/api/payments/{q['id']}/approve", lk.admin),
                        lambda: post(app.url, f"/api/payments/{q['id']}/approve", lk.owner))
        assert sorted(r.status_code for r in both) == [200, 409]
        assert balance(pg, lk.checking) == before - HELD_6000


def test_holds_release_exactly_once():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        racing = together(*[lambda: pay(app.url, lk.member, lk.checking, lk.northwind, HELD_TRANSFER)] * 2)
        assert sorted(r.status_code for r in racing) == [201, 400]
        assert error_of(next(r for r in racing if r.status_code == 400)) == "insufficient_funds"
        ids = [pay(app.url, lk.member, lk.savings, lk.northwind, HELD_6000).json()["id"] for _ in range(4)]
        a, b, c, d = ids
        together(lambda: post(app.url, f"/api/payments/{a}/approve", lk.admin),
                 lambda: post(app.url, f"/api/payments/{a}/reject", lk.owner),
                 lambda: post(app.url, f"/api/payments/{b}/approve", lk.owner),
                 lambda: post(app.url, f"/api/payments/{b}/reject", lk.admin),
                 lambda: post(app.url, f"/api/payments/{c}/reject", lk.owner),
                 lambda: post(app.url, f"/api/payments/{c}/reject", lk.admin),
                 lambda: post(app.url, f"/api/payments/{d}/approve", lk.admin),
                 lambda: post(app.url, f"/api/payments/{d}/approve", lk.owner))
        statuses = {p: get(app.url, f"/api/payments/{p}", lk.owner).json()["status"] for p in ids}
        assert statuses[c] == "rejected" and statuses[d] == "posted"
        posted = sum(1 for s in statuses.values() if s == "posted")
        assert balance(pg, lk.savings) == SAVINGS_SEED - posted * HELD_6000
        waiting = {p["id"]: p for p in get(app.url, "/api/approvals", lk.owner).json()["approvals"]}
        stored = pg.rows(f"SELECT id::text AS id FROM payments WHERE company_id::text = {lit(lk.company)} "
                         "AND status = 'pending_approval'")
        assert set(waiting) == {r["id"] for r in stored}
        snap = snapshot(app.url, lk.owner)
        for entry in snap["per_account"]:
            holds = sum(p["total_debit_cents"] for p in waiting.values() if p["source_account_id"] == entry["account_id"])
            assert entry["available_cents"] == entry["balance_cents"] - holds
        assert snap["total_available_cents"] == sum(e["available_cents"] for e in snap["per_account"])


def test_held_payment_expiry():
    with copy_app("2027-03-08T15:00:00Z") as app:
        lk = Lark(app.url)
        pg = app.pg()

        def held_pay(amount=HELD_6000):
            r = pay(app.url, lk.member, lk.savings, lk.northwind, amount)
            assert r.status_code == 201 and r.json()["status"] == "pending_approval"
            return r.json()

        def status(pid):
            return get(app.url, f"/api/payments/{pid}", lk.owner).json()["status"]

        m = held_pay()
        assert (parse_ts(m["expires_at"]), m["approve_by"]) == (parse_ts("2027-03-15T04:00:00Z"), "2027-03-14")
        app.restart("2027-07-02T03:30:00Z")
        poll(lambda: status(m["id"]) == "expired", POSTING_S + SLACK_S, "catch-up expiry")
        x = held_pay()
        assert (parse_ts(x["expires_at"]), x["approve_by"]) == (parse_ts("2027-07-09T04:00:00Z"), "2027-07-08")
        app.restart("2027-07-02T19:00:00Z")
        p1, p2 = held_pay(HELD_6000), held_pay(HELD_6000 + 10000)
        assert (parse_ts(p1["expires_at"]), p1["approve_by"]) == (parse_ts("2027-07-12T04:00:00Z"), "2027-07-11")
        app.restart("2027-07-12T03:58:00Z")
        wait_business(app.url, lk.owner, "2027-07-12T04:00:00Z", EDGE_MARGIN_S + BOOT_S)
        late = post(app.url, f"/api/payments/{p1['id']}/approve", lk.admin)
        assert late.status_code == 409 and error_of(late) == "payment_not_pending"
        poll(lambda: status(p2["id"]) == "expired", POSTING_S + SLACK_S, "expiry processed")
        assert status(x["id"]) == "expired" and status(p1["id"]) == "expired"
        refused = post(app.url, f"/api/payments/{p2['id']}/reject", lk.owner)
        assert refused.status_code == 409 and error_of(refused) == "payment_not_pending"
        assert balance(pg, lk.savings) == SAVINGS_SEED
        assert account_entry(app.url, lk.owner, lk.savings)["available_cents"] == SAVINGS_SEED
        expired = [e for e in audit_rows(pg, lk.company) if e["action"] == "payment.expired"]
        assert sorted(e["payment_id"] for e in expired) == sorted(p["id"] for p in (m, x, p1, p2))
        assert all(e["actor_email"] == SYSTEM_ACTOR for e in expired)
        check_chain(get(app.url, "/api/audit", lk.owner).json()["events"])
        app.restart("2027-11-01T14:00:00Z")
        n1 = held_pay()
        assert (parse_ts(n1["expires_at"]), n1["approve_by"]) == (parse_ts("2027-11-08T05:00:00Z"), "2027-11-07")
        app.restart("2027-11-05T15:00:00Z")
        n2 = held_pay()
        assert (parse_ts(n2["expires_at"]), n2["approve_by"]) == (parse_ts("2027-11-15T05:00:00Z"), "2027-11-14")


def test_wf_approvals_deadline(browser):
    with copy_app("2027-07-02T19:00:00Z") as app:
        lk = Lark(app.url)
        p = pay(app.url, lk.member, lk.savings, lk.northwind, HELD_6000).json()
        expires = parse_ts("2027-07-12T04:00:00Z")
        assert (parse_ts(p["expires_at"]), p["approve_by"]) == (expires, "2027-07-11")
        listed = next(a for a in get(app.url, "/api/approvals", lk.owner).json()["approvals"] if a["id"] == p["id"])
        assert (parse_ts(listed["expires_at"]), listed["approve_by"]) == (expires, "2027-07-11")
        name = approve_name(HELD_6000, "Savings")
        with ui(browser, timezone=WRONG_TZ, clock_time=WRONG_CLOCK) as page:
            ui_login(page, app.url, ADMIN)
            page.goto(app.url + "/approvals")
            eventually(page, lambda:
                expect(page.get_by_role("button", name=name, exact=True)).to_be_visible(timeout=TRY_MS))
            wait_text(page, "Approve by Sun, Jul 11, 2027")
        app.restart("2027-07-12T03:58:00Z")
        with ui(browser, timezone=WRONG_TZ, clock_time=WRONG_CLOCK) as page:
            ui_login(page, app.url, ADMIN)
            page.goto(app.url + "/approvals")
            row = page.get_by_role("button", name=name, exact=True)
            if parse_ts(me(app.url, lk.owner)["business_now"]) < expires - timedelta(seconds=SLACK_S * 3):
                eventually(page, lambda: expect(row).to_be_visible(timeout=TRY_MS))
                wait_text(page, "Approve by Sun, Jul 11, 2027")
            wait_business(app.url, lk.owner, "2027-07-12T04:00:00Z", BOOT_S)
            poll(lambda: get(app.url, f"/api/payments/{p['id']}", lk.owner).json()["status"] == "expired",
                 POSTING_S + SLACK_S, "expiry processed")
            eventually(page, lambda: expect(row).to_have_count(0, timeout=TRY_MS), (APPROVALS_LIVE_S + SLACK_S) * 1000)


def test_invoices_settle_once():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        inv = invoice_ids(app.url, lk.owner)
        answers = together(*[lambda: post(app.url, f"/api/invoices/{inv['INV-1002']}/mark-paid", lk.owner,
                                          {"account_id": lk.checking})] * 5)
        assert sorted(r.status_code for r in answers) == [200, 409, 409, 409, 409]
        assert all(error_of(r) == "invoice_already_paid" for r in answers if r.status_code == 409)
        paid = next(r for r in answers if r.status_code == 200).json()
        assert (paid["status"], paid["paid_into_account_id"]) == ("paid", lk.checking)
        credits = pg.rows(f"SELECT amount_cents, method FROM transactions WHERE account_id::text = {lit(lk.checking)} "
                          f"AND direction = 'credit' AND amount_cents = {INVOICES['INV-1002']}")
        assert [(int(r["amount_cents"]), r["method"]) for r in credits] == [(INVOICES["INV-1002"], "ach")]
        assert balance(pg, lk.checking) == CHECKING_SEED + INVOICES["INV-1002"]
        draft = post(app.url, f"/api/invoices/{inv['INV-1003']}/mark-paid", lk.owner, {"account_id": lk.checking})
        assert draft.status_code == 409 and error_of(draft) == "invoice_not_sent"
        assert balance(pg, lk.checking) == CHECKING_SEED + INVOICES["INV-1002"]
        sent = post(app.url, f"/api/invoices/{inv['INV-1003']}/send", lk.admin)
        assert sent.status_code == 200 and sent.json()["status"] == "sent"
        again = post(app.url, f"/api/invoices/{inv['INV-1003']}/send", lk.admin)
        assert again.status_code == 409 and error_of(again) == "invoice_not_draft"


def test_loan_draws():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        lid = loan(app.url, lk.owner)["id"]
        key = idem()
        r = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 29}, key)
        assert r.status_code == 200
        assert (r.json()["drawn_cents"], r.json()["remaining_cents"]) == (29, LOAN_PRINCIPAL - 29)
        assert r.json()["funding_account_id"] == lk.checking
        replay = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 29}, key)
        assert replay.content == r.content
        top = newest_tx(app.url, lk.owner, lk.checking)
        assert (top["direction"], top["amount_cents"], top["counterparty"], top["method"]) == \
            ("credit", 29, "Larkspur Venture Line", "wire")
        assert balance(pg, lk.checking) == CHECKING_SEED + 29
        over = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": LOAN_PRINCIPAL})
        assert over.status_code == 400 and error_of(over) == "exceeds_available_credit"
        assert int(pg.rows(f"SELECT drawn_cents FROM loans WHERE id::text = {lit(lid)}")[0]["drawn_cents"]) == 29


def test_money_in_strict_ids_and_amounts():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        lid = loan(app.url, lk.owner)["id"]
        for raw in (b'{"amount_cents":1.0}', b'{"amount_cents":29.0}'):
            assert_validation(send(app.url, "POST", f"/api/loans/{lid}/draw", lk.owner, content=raw), "amount_cents")
        assert int(pg.rows(f"SELECT drawn_cents FROM loans WHERE id::text = {lit(lid)}")[0]["drawn_cents"]) == 0
        invoice = next(i for i in get(app.url, "/api/invoices", lk.owner).json()["invoices"] if i["status"] == "sent")
        r = post(app.url, f"/api/invoices/{invoice['id']}/mark-paid", lk.owner, {"account_id": None})
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, (r.status_code, r.text[:200])
        after = next(i for i in get(app.url, "/api/invoices", lk.owner).json()["invoices"] if i["id"] == invoice["id"])
        assert after["status"] == "sent"
        assert balance(pg, lk.checking) == CHECKING_SEED


def test_transfers_between_accounts():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        r = transfer(app.url, lk.owner, lk.checking, lk.savings, 4321, "Move to reserve")
        assert r.status_code == 201
        legs = pg.rows(f"SELECT account_id::text AS a, direction, amount_cents, method, counterparty, memo "
                       f"FROM transactions WHERE transfer_id::text = {lit(r.json()['id'])} ORDER BY direction")
        assert [(l["a"], l["direction"], int(l["amount_cents"]), l["method"], l["counterparty"], l["memo"]) for l in legs] == \
            [(lk.savings, "credit", 4321, "transfer", "Checking", "Move to reserve"),
             (lk.checking, "debit", 4321, "transfer", "Savings", "Move to reserve")]
        assert balance(pg, lk.checking) == CHECKING_SEED - 4321 and balance(pg, lk.savings) == SAVINGS_SEED + 4321
        assert_validation(transfer(app.url, lk.owner, lk.checking, lk.checking, 100), "to_account_id")
        over = transfer(app.url, lk.member, lk.checking, lk.savings, CHECKING_SEED)
        assert over.status_code == 400 and error_of(over) == "insufficient_funds"
        assert balance(pg, lk.checking) == CHECKING_SEED - 4321


def test_opposite_transfers():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        moves = [lambda: transfer(app.url, lk.admin, lk.checking, lk.savings, 700000)] * 6 + \
                [lambda: transfer(app.url, lk.owner, lk.savings, lk.checking, 700000)] * 6
        answers = together(*moves)
        assert all(r.status_code in (201, 400) for r in answers), [r.status_code for r in answers]
        assert all(error_of(r) == "insufficient_funds" for r in answers if r.status_code == 400)
        for r in (r for r in answers if r.status_code == 201):
            legs = pg.rows(f"SELECT created_at::text AS t, direction FROM transactions "
                           f"WHERE transfer_id::text = {lit(r.json()['id'])}")
            assert sorted(l["direction"] for l in legs) == ["credit", "debit"] and len({l["t"] for l in legs}) == 1
        assert balance(pg, lk.checking) + balance(pg, lk.savings) == CHECKING_SEED + SAVINGS_SEED
        assert balance(pg, lk.checking) == ledger_net(pg, lk.checking)
        assert balance(pg, lk.savings) == ledger_net(pg, lk.savings)


def test_idempotency_durable_scoped():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        lid = loan(app.url, lk.owner)["id"]
        key = idem()
        first = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 29}, key)
        stamped = parse_ts(me(app.url, lk.owner)["business_now"])
        assert first.status_code == 200
        assert post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 29}).status_code == 200
        replay = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 29}, key)
        assert replay.status_code == 200 and replay.content == first.content
        reused = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 30}, key)
        assert reused.status_code == 422 and error_of(reused) == "idempotency_key_reused"
        assert transfer(app.url, lk.owner, lk.checking, lk.savings, 100, "a", key).status_code == 201
        memo_changed = transfer(app.url, lk.owner, lk.checking, lk.savings, 100, "b", key)
        assert memo_changed.status_code == 422
        drawn = lambda: int(pg.rows(f"SELECT drawn_cents FROM loans WHERE id::text = {lit(lid)}")[0]["drawn_cents"])
        assert drawn() == 58
        app.restart(iso(stamped + timedelta(hours=23, minutes=59)))
        again = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 29}, key)
        assert again.status_code == 200 and again.content == first.content and drawn() == 58
        app.restart(iso(stamped + timedelta(hours=24, seconds=5)))
        fresh = post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 29}, key)
        assert fresh.status_code == 200 and fresh.content != first.content and drawn() == 87


def test_no_lost_updates_money_in():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        inv = invoice_ids(app.url, lk.owner)
        lid = loan(app.url, lk.owner)["id"]
        answers = together(
            *[lambda n=n: post(app.url, f"/api/invoices/{inv[n]}/mark-paid", lk.owner, {"account_id": lk.checking})
              for n in ("INV-1002", "INV-1004", "INV-1005")],
            lambda: post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": 10000}),
            lambda: pay(app.url, lk.admin, lk.checking, lk.northwind, 20000),
            lambda: transfer(app.url, lk.admin, lk.savings, lk.checking, 30000))
        assert all(r.status_code in (200, 201) for r in answers), [r.status_code for r in answers]
        expected = CHECKING_SEED + INVOICES["INV-1002"] + INVOICES["INV-1004"] + INVOICES["INV-1005"] + 10000 - 20000 + 30000
        assert balance(pg, lk.checking) == expected == ledger_net(pg, lk.checking)
        check_chain(get(app.url, "/api/audit", lk.owner).json()["events"])
        remaining = loan(app.url, lk.owner)["remaining_cents"]
        half = remaining // 2 + 1
        draws = together(*[lambda: post(app.url, f"/api/loans/{lid}/draw", lk.owner, {"amount_cents": half})] * 2)
        assert sorted(r.status_code for r in draws) == [200, 400]
        assert loan(app.url, lk.owner)["drawn_cents"] <= LOAN_PRINCIPAL
        s, m = together(lambda: post(app.url, f"/api/invoices/{inv['INV-1003']}/send", lk.owner),
                        lambda: post(app.url, f"/api/invoices/{inv['INV-1003']}/mark-paid", lk.owner,
                                     {"account_id": lk.checking}))
        status = next(i for i in get(app.url, "/api/invoices", lk.owner).json()["invoices"] if i["number"] == "INV-1003")["status"]
        credited = count(pg, f"SELECT count(*)::int AS n FROM transactions WHERE account_id::text = {lit(lk.checking)} "
                             f"AND amount_cents = {INVOICES['INV-1003']} AND direction = 'credit'")
        assert (status, credited) in (("sent", 0), ("paid", 1))
        assert m.status_code == 200 or error_of(m) == "invoice_not_sent"


def test_wf_money_in_loans(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        net = Net(page)
        pg = app.pg()
        ui_login(page, app.url, OWNER)
        with held(page, "**/api/loans*") as gate:
            page.goto(app.url + "/loans", wait_until="domcontentloaded")
            status = page.get_by_role("status")
            eventually(page, lambda: expect(status).to_have_count(1, timeout=TRY_MS))
            eventually(page, lambda: expect(status).to_have_text("", timeout=TRY_MS))
            gate.release()
        wait_text(page, "Larkspur Venture Line")
        field = page.get_by_label("Withdrawal amount")
        button = page.get_by_role("button", name="Request withdrawal")
        for _ in range(2):
            ready(field).fill("$0.29")
            ready(button).click()
            poll(lambda: status_log(page).count("$0.29 credited to Checking") >= 1 + _, 10, "withdrawal announced")
        log = status_log(page)
        seq = ["$0.29 credited to Checking", "", "$0.29 credited to Checking"]
        it = iter(log)
        assert all(any(x == want for x in it) for want in seq), log
        wait_text(page, dollars(LOAN_PRINCIPAL - 58))
        assert balance(pg, lk.checking) == CHECKING_SEED + 58
        for n in (1, 2):
            ready(field).fill("$300,000.00")
            ready(button).click()
            poll(lambda: status_log(page).count("That's more than the remaining credit") >= n, 10, "refusal announced")
        poll(lambda: status_log(page).count("That's more than the remaining credit") == 2, 10, "refusal twice")
        draws = len(net.api("/draw", "POST"))
        ready(field).fill("$0.29")
        ready(button).dblclick()
        poll(lambda: status_log(page).count("$0.29 credited to Checking") == 3, 10, "double click announced once")
        assert len(net.api("/draw", "POST")) == draws + 1
        assert int(pg.rows(f"SELECT drawn_cents FROM loans WHERE company_id::text = {lit(lk.company)}")[0]["drawn_cents"]) == 87


def test_wf_money_in_invoices(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        net = Net(page)
        pg = app.pg()
        ui_login(page, app.url, OWNER)
        page.goto(app.url + "/invoices")
        row = page.get_by_role("row", name=re.compile("INV-1004"))
        eventually(page, lambda: expect(row).to_contain_text("Fieldstone", timeout=TRY_MS))
        choose(row.get_by_label("Deposit to"), "Savings")
        ready(row.get_by_role("button", name="Mark paid")).dblclick()
        wait_status(page, "INV-1004 marked paid")
        poll(lambda: "Paid" in written(page.get_by_role("row", name=re.compile("INV-1004"))), 10, "row shows Paid")
        assert len(net.api("/mark-paid", "POST")) == 1
        assert status_log(page).count("INV-1004 marked paid") == 1
        assert balance(pg, lk.savings) == SAVINGS_SEED + INVOICES["INV-1004"] and balance(pg, lk.checking) == CHECKING_SEED
        draft = page.get_by_role("row", name=re.compile("INV-1003"))
        eventually(page, lambda: expect(draft.get_by_role("button", name="Mark paid")).to_have_count(0, timeout=TRY_MS))
        ready(draft.get_by_role("button", name="Send invoice")).click()
        wait_status(page, "INV-1003" + " sent")
        eventually(page, lambda:
            expect(page.get_by_role("row", name=re.compile("INV-1003")).get_by_role("button", name="Mark paid")).to_be_visible(timeout=TRY_MS))


def test_wf_money_in_lost_answer(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        pg = app.pg()
        drawn = lambda: int(pg.rows(f"SELECT drawn_cents FROM loans WHERE company_id::text = {lit(lk.company)}")[0]["drawn_cents"])
        keys, mode = [], ["drop"]

        def handler(route):
            keys.append(route.request.headers.get("idempotency-key"))
            if mode[0] == "drop":
                route.fetch()
                route.abort("connectionreset")
            elif mode[0] == "500":
                route.fulfill(status=500, content_type="application/json", body='{"error":"internal"}')
            else:
                route.continue_()

        ui_login(page, app.url, OWNER)
        page.goto(app.url + "/loans")
        wait_text(page, dollars(LOAN_PRINCIPAL))
        page.route("**/api/loans/*/draw", handler)
        field, button = page.get_by_label("Withdrawal amount"), page.get_by_role("button", name="Request withdrawal")
        ready(field).fill("$0.29")
        ready(button).click()
        wait_status(page, OUTAGE_COPY)
        assert drawn() == 29
        wait_text(page, dollars(LOAN_PRINCIPAL))
        mode[0] = "pass"
        ready(button).click()
        wait_status(page, "$0.29 credited to Checking")
        assert keys[0] and keys[1] == keys[0] and drawn() == 29
        wait_text(page, dollars(LOAN_PRINCIPAL - 29))
        ready(button).click()
        poll(lambda: drawn() == 58, 10, "third press draws again")
        assert keys[2] != keys[0]
        mode[0] = "500"
        ready(button).click()
        wait_status(page, SERVER_ERROR_COPY)
        mode[0] = "pass"
        ready(button).click()
        poll(lambda: drawn() == 87, 10, "retry after 500")
        assert keys[4] == keys[3] != keys[2]


def test_company_money_private():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pay_id = pay(app.url, lk.owner, lk.checking, lk.northwind, 100).json()["id"]
        inv = invoice_ids(app.url, lk.owner)["INV-1002"]
        lid = loan(app.url, lk.owner)["id"]
        for path in ("/api/accounts", "/api/snapshot", "/api/transactions", "/api/recipients", "/api/payments",
                     "/api/approvals", "/api/invoices", "/api/loans", "/api/audit", "/api/me", "/api/stream"):
            r = get(app.url, path)
            assert r.status_code == 401 and r.json() == {"error": "unauthorized"}, path
        assert post(app.url, "/api/payments", None, {}).status_code == 401
        for path in (f"/api/accounts/{lk.checking}", f"/api/payments/{pay_id}", f"/api/recipients/{lk.northwind}"):
            r = get(app.url, path, lk.outsider)
            assert r.status_code == 404 and r.json() == {"error": "not_found"}
        assert post(app.url, f"/api/invoices/{inv}/mark-paid", lk.outsider, {"account_id": lk.outpost}).status_code == 404
        assert post(app.url, f"/api/loans/{lid}/draw", lk.outsider, {"amount_cents": 1}).status_code == 404
        for path, key in (("/api/accounts", "accounts"), ("/api/payments", "payments"), ("/api/recipients", "recipients"),
                          ("/api/invoices", "invoices"), ("/api/loans", "loans")):
            text = get(app.url, path, lk.outsider).text
            assert lk.checking not in text and "Larkspur" not in text and "Northwind" not in text, path
        assert get(app.url, "/api/search", lk.outsider, {"q": "Northwind"}).json() == {"recipients": [], "transactions": []}
        assert get(app.url, "/api/audit", lk.member).status_code == 403
        assert balance(app.pg(), lk.outpost) == OUTPOST_SEED


def test_derived_surfaces_stay_inside():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        mine, theirs = Stream(app.url, lk.owner), Stream(app.url, lk.outsider)
        try:
            pay(app.url, lk.owner, lk.checking, lk.northwind, 100)
            tx = newest_tx(app.url, lk.owner, lk.checking)["id"]
            poll(lambda: tx in mine.tx_ids(), STREAM_S + 1, "owner stream")
            assert tx not in theirs.tx_ids()
        finally:
            mine.close()
            theirs.close()
        assert get(app.url, f"/api/accounts/{lk.checking}/statement.csv", lk.outsider).status_code == 404
        quote = post(app.url, "/api/fx/quotes", lk.owner, {"currency": "EUR", "amount_cents": 150}).json()["id"]
        outpost_audit = len(audit_rows(pg, lk.outpost_company))
        assert pay(app.url, lk.outsider, lk.outpost, lk.cedar, 150, method="wire", fx_quote_id=quote).status_code == 404
        assert pay(app.url, lk.outsider, lk.checking, lk.cedar, 100).status_code == 404
        assert pay(app.url, lk.outsider, lk.outpost, lk.northwind, 100).status_code == 404
        assert transfer(app.url, lk.outsider, lk.outpost, lk.checking, 100).status_code == 404
        inv = invoice_ids(app.url, lk.owner)["INV-1004"]
        assert post(app.url, f"/api/invoices/{inv}/mark-paid", lk.owner, {"account_id": lk.outpost}).status_code == 404
        assert len(audit_rows(pg, lk.outpost_company)) == outpost_audit
        assert balance(pg, lk.outpost) == OUTPOST_SEED and balance(pg, lk.checking) == CHECKING_SEED - 100
        key = idem()
        ours = pay(app.url, lk.owner, lk.checking, lk.northwind, 100, key=key)
        other = pay(app.url, lk.outsider, lk.outpost, lk.cedar, 100, key=key)
        assert ours.status_code == other.status_code == 201 and ours.json()["id"] != other.json()["id"]
        assert balance(pg, lk.outpost) == OUTPOST_SEED - 100


def test_server_owned_fields(app_url):
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        admin_id = me(app.url, lk.admin)["user"]["id"]
        member_id = me(app.url, lk.member)["user"]["id"]
        p = pay(app.url, lk.member, lk.savings, lk.northwind, DUAL_HELD,
                extra={"status": "posted", "approvals_required": 0, "created_by": admin_id,
                       "expires_at": "2099-01-01T00:00:00Z"}).json()
        assert (p["status"], p["approvals_required"], p["created_by"]) == ("pending_approval", 2, member_id)
        assert parse_ts(p["expires_at"]) == parse_ts("2027-07-12T04:00:00Z")
        assert post(app.url, f"/api/payments/{p['id']}/approve", lk.admin).status_code == 200
        before = count(pg, f"SELECT count(*)::int AS n FROM memberships WHERE company_id::text = {lit(lk.company)}")
        email, name = identity("hijack")
        r = post(app.url, "/api/auth/signup", None, {"email": email, "name": name, "password": PASSWORD,
                                                       "company_id": lk.company, "role": "admin"})
        assert r.status_code == 201
        user = me(app.url, r.json()["token"])["user"]
        assert user["company_id"] != lk.company and user["role"] == "owner"
        assert count(pg, f"SELECT count(*)::int AS n FROM memberships WHERE company_id::text = {lit(lk.company)}") == before
        acc = post(app.url, "/api/accounts", lk.owner, {"name": "Side Pot", "kind": "savings", "balance_cents": 999})
        assert acc.status_code == 201 and acc.json()["balance_cents"] == 0
        rec = post(app.url, "/api/recipients", lk.owner, {
            "display_name": "Owned Vendor", "kind": "business", "method": "ach", "account_number": "000111222333",
            "routing_number": "021000021", "status": "pending", "account_last4": "9999",
            "company_id": lk.outpost_company}).json()
        assert (rec["status"], rec["account_last4"]) == ("active", "2333")
        assert get(app.url, f"/api/recipients/{rec['id']}", lk.owner).status_code == 200
        inv = invoice_ids(app.url, lk.owner)["INV-1005"]
        post(app.url, f"/api/invoices/{inv}/mark-paid", lk.owner, {"account_id": lk.checking, "total_cents": 1})
        assert newest_tx(app.url, lk.owner, lk.checking)["amount_cents"] == INVOICES["INV-1005"]
        drawn = post(app.url, f"/api/loans/{loan(app.url, lk.owner)['id']}/draw", lk.owner,
                     {"amount_cents": 29, "funding_account_id": lk.savings}).json()
        assert drawn["funding_account_id"] == lk.checking
        assert newest_tx(app.url, lk.owner, lk.checking)["amount_cents"] == 29


METHOD_PROBES = ["PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"]
GUESSED_PATHS = ["/api/reset", "/api/seed", "/api/debug", "/api/test", "/api/admin", "/api/users"]


def test_only_published_api(app_url):
    token, _, _ = signup(app_url)
    account_id = get(app_url, "/api/accounts", token).json()["accounts"][0]["id"]
    rid = add_recipient(app_url, token, "Allow Probe").json()["id"]
    for path, allowed in ((f"/api/accounts/{account_id}", {"GET"}), (f"/api/recipients/{rid}", {"GET", "DELETE"}),
                          ("/api/accounts", {"GET", "POST"}), ("/api/snapshot", {"GET"})):
        for method in METHOD_PROBES:
            if method in allowed:
                continue
            r = send(app_url, method, path, token)
            assert r.status_code == 405, (method, path)
            assert {m.strip() for m in r.headers["allow"].split(",")} == allowed
            assert CORS_HEADER not in r.headers
            if method != "HEAD":
                assert r.json() == {"error": "method_not_allowed"}
    for path in GUESSED_PATHS:
        r = get(app_url, path, token)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
    html = httpx.get(app_url + "/", timeout=30).text
    scripts = re.findall(r'src="(/[^"]+\.js)"', html)
    for src in scripts:
        assert httpx.get(app_url + src + ".map", timeout=30).status_code == 404
    for path in ("/run.json", "/.env", "/package.json", "/package-lock.json"):
        assert httpx.get(app_url + path, timeout=30).status_code == 404, path


FORBIDDEN_LEAKS = re.compile(r"postgres|select\s.+\sfrom|traceback|node_modules|\.ts:\d|\.js:\d|at \w+ \(", re.I | re.S)
BAD_IDS = ["abc", "1 OR 1=1", "x" * 5000, "..%2F", "a\u0000b"]
BAD_AMOUNTS = ['0', '-5', '1.5', '"100"', 'true', 'null', '1e30', '-0', '9007199254740992']


def test_opaque_errors(app_url):
    token, _, _ = signup(app_url)
    account = get(app_url, "/api/accounts", token).json()["accounts"][0]["id"]
    rid = add_recipient(app_url, token, "Opaque Vendor").json()["id"]
    answers = []
    for bad in BAD_IDS:
        r = get(app_url, "/api/payments/" + urllib.parse.quote(bad, safe=""), token)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, bad
        answers.append(r)
    for bad in (5, None, {"id": 1}, "../"):
        r = post(app_url, "/api/payments", token, {"source_account_id": bad, "recipient_id": rid, "method": "ach",
                                                    "amount_cents": 100})
        assert r.status_code == 404, bad
        answers.append(r)
    for raw in BAD_AMOUNTS:
        content = ('{"source_account_id":%s,"recipient_id":%s,"method":"ach","amount_cents":%s}'
                   % (json.dumps(account), json.dumps(rid), raw)).encode()
        r = send(app_url, "POST", "/api/payments", token, content=content)
        assert_validation(r, "amount_cents")
        answers.append(r)
    plain = send(app_url, "POST", "/api/transfers", token, content=b"amount=1", headers={"Content-Type": "text/plain"})
    assert plain.status_code == 415 and plain.json() == {"error": "unsupported_media_type"}
    none_type = httpx.post(app_url + "/api/transfers", headers=_headers(token), content=b"{}", timeout=30)
    assert none_type.status_code == 415
    upper = send(app_url, "POST", "/api/recipients/invite", token, {"email": "bad"},
                 headers={"Content-Type": "APPLICATION/JSON; charset=utf-8"})
    assert_validation(upper, "email")
    broken = send(app_url, "POST", "/api/transfers", token, content=b"{not json")
    assert broken.status_code == 400 and error_of(broken) == "invalid_json"
    latin = send(app_url, "POST", "/api/transfers", token, content=b'{"memo":"\xff"}')
    assert latin.status_code == 400 and error_of(latin) == "invalid_json"
    big = send(app_url, "POST", "/api/inquiries", None, content=b'{"message":"' + b"a" * BODY_CAP + b'"}')
    assert big.status_code == 413 and big.json() == {"error": "payload_too_large"}
    answers += [plain, none_type, broken, latin, big]
    for r in answers:
        assert r.status_code < 500
        assert not FORBIDDEN_LEAKS.search(r.text + json.dumps(dict(r.headers))), r.text[:300]


def test_role_checks_before_state():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        pg = app.pg()
        sched = pay(app.url, lk.owner, lk.checking, lk.northwind, 100, scheduled_for="2027-07-06").json()["id"]
        posted = pay(app.url, lk.owner, lk.checking, lk.northwind, 100).json()["id"]
        own_posted = pay(app.url, lk.member, lk.checking, lk.northwind, 100).json()["id"]
        decided = pay(app.url, lk.owner, lk.savings, lk.northwind, HELD_6000).json()["id"]
        post(app.url, f"/api/payments/{decided}/reject", lk.admin)
        inv = invoice_ids(app.url, lk.owner)["INV-1004"]
        paid_inv = invoice_ids(app.url, lk.owner)["INV-1005"]
        assert post(app.url, f"/api/invoices/{paid_inv}/mark-paid", lk.owner,
                    {"account_id": lk.savings}).status_code == 200
        lid = loan(app.url, lk.owner)["id"]
        events = len(audit_rows(pg, lk.company))
        for pid in (sched, posted):
            r = post(app.url, f"/api/payments/{pid}/cancel", lk.member)
            assert r.status_code == 403 and r.json() == {"error": "forbidden"}
        own = post(app.url, f"/api/payments/{own_posted}/cancel", lk.member)
        assert own.status_code == 409 and error_of(own) == "payment_not_scheduled"
        for action in ("approve", "reject"):
            assert post(app.url, f"/api/payments/{decided}/{action}", lk.member).status_code == 403
        assert post(app.url, f"/api/payments/{decided}/approve", lk.owner).status_code == 403
        bad_json = send(app.url, "POST", f"/api/invoices/{inv}/mark-paid", lk.member, content=b"{oops")
        assert bad_json.status_code == 403
        assert post(app.url, f"/api/invoices/{paid_inv}/mark-paid", lk.member,
                    {"account_id": lk.checking}).status_code == 403
        assert post(app.url, f"/api/loans/{lid}/draw", lk.admin, {"amount_cents": "x"}).status_code == 403
        assert post(app.url, f"/api/loans/{lid}/draw", lk.member, {"amount_cents": 1}).status_code == 403
        assert post(app.url, "/api/accounts", lk.member, {"name": "Nope", "kind": "checking"}).status_code == 403
        for path in (f"/api/payments/{sched}/cancel", f"/api/payments/{decided}/approve", f"/api/invoices/{inv}/mark-paid",
                     f"/api/loans/{lid}/draw"):
            assert post(app.url, path, lk.outsider, {"account_id": lk.outpost, "amount_cents": 1}).status_code == 404
        assert len(audit_rows(pg, lk.company)) == events
        assert get(app.url, f"/api/payments/{sched}", lk.owner).json()["status"] == "scheduled"
        assert balance(pg, lk.checking) == CHECKING_SEED - 200


def test_wf_access_control_outsider(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        net = Net(page)
        ui_login(page, app.url, OUTSIDER)
        page.goto(app.url + COCKPIT + "?account=" + lk.checking)
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
        wait_text(page, "Outpost Goods")
        assert selected_label(page.get_by_label("Filter by account")) == "All accounts"
        ready(page.get_by_placeholder(SEARCH_PLACEHOLDER)).fill("Northwind")
        page.clock.fast_forward(TYPING_PAUSE_MS)
        poll(lambda: net.api("/api/search"), 5, "search sent")
        text = body_text(page)
        for leak in ("Larkspur", "Northwind Supply", "18,420.50", "Rowan Pike"):
            assert leak not in text
        assert get(app.url, f"/api/accounts/{lk.checking}", lk.outsider).status_code == 404


def test_wf_access_control_member(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        lk = Lark(app.url)
        sched = pay(app.url, lk.owner, lk.checking, lk.northwind, 100, scheduled_for="2027-07-06").json()["id"]
        pay(app.url, lk.admin, lk.savings, lk.northwind, HELD_6000)
        ui_login(page, app.url, MEMBER)
        page.goto(app.url + "/approvals")
        wait_text(page, "$6,000.00")
        eventually(page, lambda:
            expect(page.get_by_role("button", name=re.compile(r"^(Approve|Reject) "))).to_have_count(0, timeout=TRY_MS))
        page.goto(app.url + "/payments")
        ready(page.get_by_role("button", name="Cancel payment").first).click()
        wait_status(page, "You can only cancel payments you created.")
        assert get(app.url, f"/api/payments/{sched}", lk.owner).json()["status"] == "scheduled"


def test_sessions_and_signup(app_url):
    token, email, _ = signup(app_url)
    assert me(app_url, token)["user"]["email"] == email
    for variant in (email, email.upper(), f"  {email} "):
        r = post(app_url, "/api/auth/signup", None, {"email": variant, "name": "Again", "password": PASSWORD})
        assert r.status_code == 409 and r.json() == {"error": "email_taken"}
    second = login(app_url, email)
    assert post(app_url, "/api/auth/logout", token).status_code == 204
    assert get(app_url, "/api/me", token).status_code == 401
    assert get(app_url, "/api/me", second).status_code == 200
    wrong = post(app_url, "/api/auth/login", None, {"email": email, "password": "not-the-password"})
    assert wrong.status_code == 401 and wrong.json() == {"error": "invalid_credentials"}


def test_enumeration_safe_lockout():
    with copy_app() as app:
        def attempt(email, password="wrong-password-x"):
            t0 = time.monotonic()
            r = post(app.url, "/api/auth/login", None, {"email": email, "password": password})
            return r, time.monotonic() - t0

        known = [signup(app.url, "lock")[1] for _ in range(10)]
        wrong = [attempt(e) for e in known]
        unknown = [attempt(identity("ghost")[0]) for _ in range(10)]
        a, b = wrong[0][0], unknown[0][0]
        assert a.status_code == b.status_code == 401 and a.content == b.content
        strip = lambda r: {k: v for k, v in r.headers.items() if k.lower() != "date"}
        assert strip(a) == strip(b)
        assert statistics.median(t for _, t in unknown) >= statistics.median(t for _, t in wrong) / 2
        target = signup(app.url, "burst")[1]
        burst = together(*[lambda: attempt(target)[0] for _ in range(10)]) if False else \
            together(*[lambda: attempt(target)[0]] * 10)
        assert sorted(r.status_code for r in burst) == [401] * 5 + [429] * 5
        assert all(r.json() == {"error": "too_many_attempts"} for r in burst if r.status_code == 429)
        assert attempt(target, PASSWORD)[0].status_code == 429
        ghost = identity("ghostlock")[0]
        for _ in range(LOCKOUT_COUNT):
            assert attempt(ghost)[0].status_code == 401
        assert attempt(ghost)[0].status_code == 429
        cleared = signup(app.url, "clear")[1]
        for _ in range(LOCKOUT_COUNT - 1):
            attempt(cleared)
        assert attempt(cleared, PASSWORD)[0].status_code == 200
        for _ in range(LOCKOUT_COUNT - 1):
            assert attempt(cleared)[0].status_code == 401
        durable = signup(app.url, "durable")[1]
        for _ in range(LOCKOUT_COUNT):
            attempt(durable)
        app.restart()
        assert attempt(durable, PASSWORD)[0].status_code == 429


def test_signout_revokes_streams():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        first, second = login(app.url, OWNER), login(app.url, OWNER)
        a, b = Stream(app.url, first), Stream(app.url, second)
        try:
            assert a.status == b.status == 200
            assert post(app.url, "/api/auth/logout", first).status_code == 204
            out = time.monotonic()
            poll(lambda: a.ended is not None, STREAM_S + 1, "revoked stream closed")
            assert a.ended - out <= STREAM_S + 0.5
            seen = len(a.tx_ids())
            pay(app.url, lk.owner, lk.checking, lk.northwind, 100)
            tx = newest_tx(app.url, lk.owner, lk.checking)["id"]
            poll(lambda: tx in b.tx_ids(), STREAM_S + 1, "other session streams")
            assert len(a.tx_ids()) == seen and tx not in a.tx_ids()
            again = Stream(app.url, first)
            assert again.status == 401
            again.close()
        finally:
            a.close()
            b.close()


UNSAFE_NEXT = ["//evil.example", "/\\evil.example", COCKPIT + "x", COCKPIT + ".evil.example",
               "https://evil.example" + COCKPIT, COCKPIT + "/../login", COCKPIT + "/..//evil.example",
               "/payments/..%2F", "/payments/./x"]


def test_wf_sessions_landing(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        page.goto(app.url + "/signup")
        ready(page.get_by_role("button", name="Open account", exact=True).last).click()
        for text in ("Enter your name", "Enter a valid email", "Password must be at least 8 characters"):
            wait_text(page, text)
        ready(page.get_by_label("Name", exact=True)).fill("Taken Person")
        ready(page.get_by_label("Email", exact=True)).fill(OWNER)
        ready(page.get_by_label("Password", exact=True)).fill(PASSWORD)
        ready(page.get_by_role("button", name="Open account", exact=True).last).click()
        wait_text(page, "An account with this email already exists")
        page.goto(app.url + "/login")
        ready(page.get_by_label("Email", exact=True)).fill(identity("nobody")[0])
        ready(page.get_by_label("Password", exact=True)).fill("wrong-password-x")
        ready(page.get_by_role("button", name="Log in", exact=True)).click()
        wait_text(page, "Email or password is incorrect.")
        ui_login(page, app.url, OWNER, path="/login?next=" + urllib.parse.quote(FILTERED, safe=""))
        eventually(page, lambda: expect(page).to_have_url(app.url + FILTERED, timeout=TRY_MS))
        for bad in UNSAFE_NEXT:
            page.goto(app.url + "/login?next=" + urllib.parse.quote(bad, safe=""))
            eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
        memo_draft = "/payments?memo=" + urllib.parse.quote("Invoice 7/2", safe="")
        page.goto(app.url + "/login?next=" + urllib.parse.quote(memo_draft, safe=""))
        eventually(page, lambda: expect(page).to_have_url(app.url + memo_draft, timeout=TRY_MS))
        page.goto(app.url + "/signup")
        eventually(page, lambda: expect(page).to_have_url(app.url + COCKPIT, timeout=TRY_MS))
        wait_text(page, "18,420.50")
        ui_logout(page)
        eventually(page, lambda: expect(page).to_have_url(app.url + "/", timeout=TRY_MS))
        page.go_back()
        page.wait_for_url(re.compile(r"/login"), timeout=10000)
        eventually(page, lambda:
            expect(page.get_by_role("button", name="Log in", exact=True)).to_be_visible(timeout=TRY_MS))
        assert "18,420.50" not in body_text(page)
        page.goto(app.url + "/approvals")
        eventually(page, lambda: expect(page).to_have_url(app.url + "/login?next=%2Fapprovals", timeout=TRY_MS))


def test_wf_sessions_revoked(browser):
    with copy_app(SEED_NOW) as app, ui(browser) as page:
        net = Net(page)
        ui_login(page, app.url, OWNER)
        page.goto(app.url + FILTERED)
        wait_status(page, "transactions shown")
        depth = history_len(page)
        token = net.token()
        assert post(app.url, "/api/auth/logout", token).status_code == 204
        deadline = time.monotonic() + REVOKE_S + SLACK_S
        while time.monotonic() < deadline and "/login" not in page.url:
            page.clock.fast_forward(1000)
            _pause(POLL_S)
        eventually(page, lambda:
            expect(page).to_have_url(app.url + "/login?next=%2Fapp%3Fmethod%3Dach%26direction%3Dout", timeout=TRY_MS))
        assert history_len(page) == depth
        assert token not in storage_dump(page)
        ready(page.get_by_label("Email", exact=True)).fill(OWNER)
        ready(page.get_by_label("Password", exact=True)).fill(PASSWORD)
        ready(page.get_by_role("button", name="Log in", exact=True)).click()
        eventually(page, lambda: expect(page).to_have_url(app.url + FILTERED, timeout=TRY_MS))
        assert selected_label(page.get_by_label("Filter by method")) == "ACH"


def test_signout_stops_everything(browser):
    with copy_app(SEED_NOW) as app:
        with ui(browser) as page:
            net = Net(page)
            ui_login(page, app.url, OWNER)
            wait_text(page, "18,420.50")
            old = net.token()
            with held(page, "**/api/snapshot*") as gate:
                page.clock.fast_forward(REFRESH_MS)
                poll(lambda: net.api("/api/snapshot"), 5, "refresh in flight")
                ui_logout(page)
                logged_out = max(r["t"] for r in net.api("/api/auth/logout"))
                gate.release()
            for _ in range(SIGNOUT_WATCH_MS // 1000):
                page.clock.fast_forward(1000)
                _pause(POLL_S)
            eventually(page, lambda: expect(page).to_have_url(app.url + "/", timeout=TRY_MS))
            late = [r for r in net.reqs if r["t"] > logged_out and r["token"] == old and "/api/auth/logout" not in r["url"]]
            assert late == [], late
            assert OUTAGE_COPY not in status_log(page)
        with ui(browser) as page:
            net = Net(page)
            ui_login(page, app.url, OWNER)
            page.goto(app.url + "/approvals")
            eventually(page, lambda:
                expect(page.get_by_role("heading", level=1, name="Approvals")).to_be_visible(timeout=TRY_MS))
            replaced = []
            page.on("framenavigated", lambda f: replaced.append(f.url) if "/login" in f.url else None)
            depth = history_len(page)
            assert post(app.url, "/api/auth/logout", net.token()).status_code == 204
            for _ in range(2 * APPROVALS_LIVE_S):
                page.clock.fast_forward(1000)
                _pause(POLL_S)
            eventually(page, lambda: expect(page).to_have_url(app.url + "/login?next=%2Fapprovals", timeout=TRY_MS))
            assert len(replaced) == 1 and history_len(page) == depth


def test_inquiry_stored_and_honeypot():
    with copy_app(SEED_NOW) as app:
        pg = app.pg()
        email, _ = identity("lead")
        r = post(app.url, "/api/inquiries", None, inquiry(f"  {email.upper()} ", first_name="  Ada ", source="sales",
                                                           id=CLIENT_ID, created_at="2000-01-01T00:00:00Z"))
        assert r.status_code == 201 and r.json()["id"] != CLIENT_ID
        assert parse_ts(r.json()["created_at"]).date() == date(2027, 7, 2)
        row = pg.rows(f"SELECT id::text AS id, email, first_name, source, created_at FROM inquiries WHERE email = {lit(email)}")
        assert [(x["id"], x["first_name"], x["source"]) for x in row] == [(r.json()["id"], "Ada", "sales")]
        assert parse_ts(row[0]["created_at"]).year == 2027
        bad = post(app.url, "/api/inquiries", None, inquiry("nope", first_name=" ", last_name="", company="",
                                                             message="", source="Contact"))
        assert_validation(bad, "email")
        assert set(bad.json()["fields"]) == {"email", "first_name", "last_name", "company", "message", "source"}
        for honey in ("x", 0, ["bot"]):
            h_email, _ = identity("honey")
            hp = post(app.url, "/api/inquiries", None, inquiry(h_email, website=honey))
            assert hp.status_code == 201 and hp.json()["id"]
            assert count(pg, f"SELECT count(*)::int AS n FROM inquiries WHERE email = {lit(h_email)}") == 0


def test_inquiry_limits(app_url):
    pg = Postgres()
    email, _ = identity("limits")
    assert post(app_url, "/api/inquiries", None, inquiry(email, message="e\u0301" * MESSAGE_LIMIT)).status_code == 201
    assert_validation(post(app_url, "/api/inquiries", None, inquiry(identity("lim")[0], message="a" * (MESSAGE_LIMIT + 1))),
                      "message")
    assert post(app_url, "/api/inquiries", None, inquiry(identity("lim")[0],
                                                          company="\U0001F4B8" * NAME_LIMIT)).status_code == 201
    assert_validation(post(app_url, "/api/inquiries", None, inquiry(identity("lim")[0],
                                                                     company="\U0001F4B8" * (NAME_LIMIT + 1))), "company")
    cap_email, _ = identity("cap")
    body = inquiry(cap_email, pad="")
    base_len = len(json.dumps(body, ensure_ascii=False).encode())
    body["pad"] = "x" * (BODY_CAP - base_len)
    exact = json.dumps(body, ensure_ascii=False).encode()
    assert len(exact) == BODY_CAP
    assert send(app_url, "POST", "/api/inquiries", None, content=exact).status_code != 413
    over_email, _ = identity("over")
    body = inquiry(over_email, pad="")
    body["pad"] = "x" * (BODY_CAP - len(json.dumps(body).encode()) + 1)
    r = send(app_url, "POST", "/api/inquiries", None, content=json.dumps(body).encode())
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    assert count(pg, f"SELECT count(*)::int AS n FROM inquiries WHERE email = {lit(over_email)}") == 0
    rate_email, _ = identity("rate")
    variants = [rate_email, rate_email.upper(), f"  {rate_email} ", rate_email.title(), rate_email] * 2
    answers = together(*[lambda v=v: post(app_url, "/api/inquiries", None, inquiry(v)) for v in variants])
    assert sorted(r.status_code for r in answers) == [201] * INQUIRY_RATE + [429] * INQUIRY_RATE
    assert all(r.json() == {"error": "rate_limited"} for r in answers if r.status_code == 429)
    assert count(pg, f"SELECT count(*)::int AS n FROM inquiries WHERE email = {lit(rate_email)}") == INQUIRY_RATE
    back_email, _ = identity("backdate")
    for _ in range(INQUIRY_RATE):
        assert post(app_url, "/api/inquiries", None,
                    inquiry(back_email, created_at="2000-01-01T00:00:00Z")).status_code == 201
    sixth = post(app_url, "/api/inquiries", None, inquiry(back_email))
    assert sixth.status_code == 429 and error_of(sixth) == "rate_limited"


INQUIRY_FIELDS = ["email", "first_name", "last_name", "company", "message", "source"]
NON_STRINGS = [5, ["a"], {"a": 1}, True, None]


def test_inquiry_typed_and_bounded(app_url):
    pg = Postgres()
    for field in INQUIRY_FIELDS:
        for value in NON_STRINGS:
            email, _ = identity("typed")
            body = inquiry(email)
            body[field] = value
            assert_validation(raw_post(app_url, "/api/inquiries", None, body), field)
            assert count(pg, f"SELECT count(*)::int AS n FROM inquiries WHERE email = {lit(email)}") == 0
    assert_validation(post(app_url, "/api/inquiries", None, inquiry(identity("nfc")[0], message="\u0958" * 2600)),
                      "message")
    slow = [inquiry("a." * 250), inquiry(identity("marks")[0], message="\u0301" * MESSAGE_LIMIT)]
    for body in slow:
        t0 = time.monotonic()
        r = post(app_url, "/api/inquiries", None, body)
        assert r.status_code in (201, 400) and time.monotonic() - t0 <= INQUIRY_BUDGET_S
    timed = together(*[lambda b=b: (time.monotonic(), post(app_url, "/api/inquiries", None, b), time.monotonic())
                       for b in [inquiry("a." * 250)] * 10])
    assert all(r.status_code == 400 and end - start <= INQUIRY_BUDGET_S for start, r, end in timed)
    email, _ = identity("slots")
    for _ in range(INQUIRY_RATE + 1):
        assert_validation(post(app_url, "/api/inquiries", None, inquiry(email, message="  ")), "message")
    assert post(app_url, "/api/inquiries", None, inquiry(email, website="filled")).status_code == 201
    for _ in range(INQUIRY_RATE):
        assert post(app_url, "/api/inquiries", None, inquiry(email)).status_code == 201
    assert post(app_url, "/api/inquiries", None, inquiry(email)).status_code == 429


CONTACT_LABELS = ["Email (Required)", "First name (Required)", "Last name (Required)", "Company (Required)",
                  "Message (Required)"]


def test_wf_sales_inquiry_contact(browser, app_url):
    email, _ = identity("contact")
    with ui(browser) as page:
        net = Net(page)
        page.goto(app_url + "/contact")
        for label in CONTACT_LABELS:
            eventually(page, lambda label=label:
                expect(page.get_by_label(label, exact=True)).to_be_visible(timeout=TRY_MS))
        message = page.get_by_label("Message (Required)", exact=True)
        ready(message).fill("\U0001F4B8e\u0301")
        wait_text(page, str(2) + " / 5000")
        ready(page.get_by_label("Email (Required)", exact=True)).fill(email)
        ready(page.get_by_label("First name (Required)", exact=True)).fill(LEAD["first"])
        ready(page.get_by_label("Last name (Required)", exact=True)).fill(LEAD["last"])
        ready(page.get_by_label("Company (Required)", exact=True)).fill(LEAD["company"])
        ready(message).fill(LEAD["message"])
        ready(page.get_by_role("button", name="Send inquiry")).dblclick()
        wait_status(page, "Thanks for reaching out, our team will get back to you shortly.")
        assert len(net.api("/api/inquiries", "POST")) == 1
    rows = Postgres().rows(f"SELECT first_name, message FROM inquiries WHERE email = {lit(email)}")
    assert [(r["first_name"], r["message"]) for r in rows] == [(LEAD["first"], LEAD["message"])]


def test_wf_sales_inquiry_errors(browser, app_url):
    email, _ = identity("contacterr")
    with ui(browser) as page:
        page.goto(app_url + "/contact")
        ready(page.get_by_role("button", name="Send inquiry")).click()
        for text in ("Enter a valid email", "Enter your first name", "Enter your last name", "Enter your company",
                     "Enter a message"):
            wait_text(page, text)
        ready(page.get_by_label("Email (Required)", exact=True)).fill(email)
        ready(page.get_by_label("First name (Required)", exact=True)).fill("A" * (NAME_LIMIT + 1))
        ready(page.get_by_label("Last name (Required)", exact=True)).fill(LEAD["last"])
        ready(page.get_by_label("Company (Required)", exact=True)).fill(LEAD["company"])
        ready(page.get_by_label("Message (Required)", exact=True)).fill(LEAD["message"])
        ready(page.get_by_role("button", name="Send inquiry")).click()
        wait_text(page, "Keep this to 120 characters or fewer")
        assert page.get_by_label("Last name (Required)", exact=True).input_value() == LEAD["last"]
    assert count(Postgres(), f"SELECT count(*)::int AS n FROM inquiries WHERE email = {lit(email)}") == 0


TOUR_CUES = ["Watch every account in one calm view.", "Send a payment and see the balance move at once.",
             "Large payments wait for a second approver."]


def test_wf_marketing_site_home(browser, app_url):
    vtt = httpx.get(app_url + "/media/tour.vtt", timeout=30)
    assert vtt.status_code == 200 and vtt.headers["content-type"].startswith("text/vtt")
    assert vtt.text.startswith("WEBVTT")
    positions = [vtt.text.index(cue) for cue in TOUR_CUES]
    assert positions == sorted(positions)
    with ui(browser) as page:
        net = Net(page)
        page.goto(app_url + "/")
        eventually(page, lambda:
            expect(page.get_by_role("heading", level=1, name="Calm banking for companies on the move")).to_be_visible(timeout=TRY_MS))
        eventually(page, lambda:
            expect(page.get_by_role("textbox", name="Enter your email")).to_be_visible(timeout=TRY_MS))
        eventually(page, lambda:
            expect((page.get_by_role("link", name="Open account").or_(page.get_by_role("button", name="Open account"))).first).to_be_visible(timeout=TRY_MS))
        tracks = page.evaluate("() => [...document.querySelectorAll('video track')].map(t => "
                               "({kind: t.kind, label: t.label, src: t.getAttribute('src'), lang: t.srclang}))")
        assert any(t["kind"] == "captions" and t["label"] == "English" and t["src"].endswith("/media/tour.vtt")
                   for t in tracks), tracks
        ready(page.get_by_role("button", name="Show transcript")).click()
        for cue in TOUR_CUES:
            eventually(page, lambda cue=cue: expect(page.get_by_text(cue).first).to_be_visible(timeout=TRY_MS))
        demo = page.get_by_role("link", name="Launch demo")
        eventually(page, lambda: expect(demo).to_have_attribute("href", re.compile(r"/demo$"), timeout=TRY_MS))
        ready(demo).click()
        eventually(page, lambda: expect(page).to_have_url(app_url + "/demo", timeout=TRY_MS))
        wait_text(page, "This is a demo with sample data")
        eventually(page, lambda:
            expect(page.get_by_role("link", name="Open account").first).to_be_visible(timeout=TRY_MS))
        cockpit = ("/api/accounts", "/api/snapshot", "/api/transactions", "/api/stream", "/api/me", "/api/approvals")
        assert not [r for r in net.reqs if any(p in r["url"] for p in cockpit)]


PRICES = {"monthly": ["$23.90", "$349.90"], "annual": ["$295.90", "$2,399.90"]}


def test_wf_marketing_site_pricing(browser, app_url):
    with ui(browser, paused=True) as page:
        page.goto(app_url + "/pricing")
        page.get_by_text("Tallwind Pro").first.scroll_into_view_if_needed()
        seen, deadline = [], time.monotonic() + COUNT_DEADLINE_S
        while len(seen) < COUNT_WINDOW_STEPS or not all(price in seen[-1] for price in PRICES["monthly"]):
            assert time.monotonic() < deadline, seen[-1:]
            page.clock.run_for(COUNT_STEP_MS)
            seen.append(body_text(page))
            _pause(POLL_S / 5)
        figure = r"\$[\d,]+(?:\.\d+)?"
        passing = {m for text in seen for m in re.findall(figure, text)} - set(re.findall(figure, seen[-1])) - {"$0.00", "$0"}
        assert passing, "no intermediate figure: the prices did not count up"
        eventually(page, lambda:
            expect(page.get_by_role("navigation", name="Jump to section")).to_be_visible(timeout=TRY_MS))
    with ui(browser) as page:
        page.goto(app_url + "/business-payments")
        eventually(page, lambda: expect(page.get_by_role("table").first).to_be_visible(timeout=TRY_MS))
        for text in ("Real-time payments", "Instant", "Mailed checks", "7 to 14 business days"):
            wait_text(page, text)
        page.goto(app_url + "/treasury")
        eventually(page, lambda: expect(page.get_by_role("table").first).to_be_visible(timeout=TRY_MS))
        for text in ("$250K to $2M", "$20M to $50M"):
            wait_text(page, text)
        page.goto(app_url + "/spend-management")
        for text in ("Work meals", "Office equipment", "Wellness", "Business travel"):
            wait_text(page, text)


MENUS = {"Products": ["Business banking", "Payments", "Credit card", "Treasury", "Invoicing", "Spend management",
                      "Payroll", "Books"], "Solutions": ["Venture debt", "Working capital loans"],
         "Resources": ["Demo", "Plans and pricing"], "About": ["Contact sales", "Open an account"]}


def test_marketing_chrome(browser, app_url):
    with ui(browser) as page:
        page.goto(app_url + "/")
        banner = page.get_by_role("banner")
        computed = banner.evaluate("el => { const s = getComputedStyle(el); return [s.position, s.backdropFilter || s.webkitBackdropFilter || ''] }")
        assert computed[0] in ("fixed", "sticky") and "blur" in computed[1], computed
        for menu in MENUS:
            trigger = banner.get_by_role("button", name=menu, exact=True)
            eventually(page, lambda: expect(trigger).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
            assert trigger.get_attribute("aria-controls")
        for link in ("Pricing", "Dashboard", "Log in"):
            eventually(page, lambda link=link:
                expect(banner.get_by_role("link", name=link, exact=True)).to_be_visible(timeout=TRY_MS))
        footer = page.get_by_role("contentinfo")
        eventually(page, lambda: expect(footer).to_contain_text("Tallwind Labs builds the software. Your deposits are held by our partner banks, "
                                       "Harbor Financial and Keystone N.A., each a Member FDIC.", timeout=TRY_MS))
        for group in ("Banking", "Platform", "Resources", "Finance Ops"):
            eventually(page, lambda group=group: expect(footer).to_contain_text(group, timeout=TRY_MS))
        page.set_viewport_size({"width": 768, "height": 1024})
        toggle = page.get_by_role("button", name="Open Menu")
        eventually(page, lambda: expect(toggle).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        eventually(page, lambda:
            expect(page.get_by_role("link", name="Business banking", exact=True)).to_have_count(0, timeout=TRY_MS))
        ready(toggle).click()
        eventually(page, lambda: expect(toggle).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        group = page.get_by_role("button", name="Products", exact=True).last
        ready(group).click()
        eventually(page, lambda: expect(group).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        eventually(page, lambda:
            expect(page.get_by_role("link", name="Business banking", exact=True).first).to_be_visible(timeout=TRY_MS))
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(toggle).to_be_focused(timeout=TRY_MS))


def test_header_menus_keyboard(browser, app_url):
    with ui(browser) as page:
        page.goto(app_url + "/")
        banner = page.get_by_role("banner")
        products = banner.get_by_role("button", name="Products", exact=True)
        link = lambda n: banner.get_by_role("link", name=n, exact=True)
        assert not set(tab_order(page, 15)) & set(MENUS["Products"])
        ready(products, "attached").focus()
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: expect(products).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        eventually(page, lambda: expect(link("Business banking")).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: expect(link("Books")).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: expect(link("Business banking")).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("End")
        eventually(page, lambda: expect(link("Books")).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("Home")
        eventually(page, lambda: expect(link("Business banking")).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("Shift+Tab")
        eventually(page, lambda: expect(products).to_be_focused(timeout=TRY_MS))
        eventually(page, lambda: expect(products).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(products).to_be_focused(timeout=TRY_MS))
        eventually(page, lambda: expect(products).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        eventually(page, lambda: expect(link("Business banking")).to_have_count(0, timeout=TRY_MS))
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(products).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        eventually(page, lambda: expect(products).to_be_focused(timeout=TRY_MS))
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(products).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        page.keyboard.press("Space")
        eventually(page, lambda: expect(products).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("End")
        page.keyboard.press("Tab")
        eventually(page, lambda: expect(products).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        eventually(page, lambda:
            expect(banner.get_by_role("button", name="Solutions", exact=True)).to_be_focused(timeout=TRY_MS))
        ready(products).click()
        solutions = banner.get_by_role("button", name="Solutions", exact=True)
        ready(solutions).click()
        eventually(page, lambda: expect(products).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        eventually(page, lambda: expect(solutions).to_have_attribute("aria-expanded", "true", timeout=TRY_MS))
        ready(page.get_by_role("heading", level=1)).click()
        eventually(page, lambda: expect(solutions).to_have_attribute("aria-expanded", "false", timeout=TRY_MS))
        eventually(page, lambda: expect(link("Venture debt")).to_have_count(0, timeout=TRY_MS))


def counted_to(page, price, seconds=10):
    deadline = time.monotonic() + seconds
    while not page.evaluate(VISIBLE_TEXT_JS, price):
        assert time.monotonic() < deadline, f"count-up never reached {price}"
        page.clock.run_for(COUNT_STEP_MS)
        _pause(POLL_S / 5)


COUNT_STEP_MS = 100
COUNT_DEADLINE_S = 15
COUNT_WINDOW_STEPS = 20
INSTANT_MS = 10


def test_pricing_address(browser, app_url):
    with ui(browser) as page:
        page.goto(app_url + "/pricing")
        toggle = page.get_by_role("switch", name="Annual Pricing (15% off)").or_(
            page.get_by_role("checkbox", name="Annual Pricing (15% off)")).first
        depth = history_len(page)
        ready(toggle, "attached").focus()
        page.keyboard.press("Space")
        eventually(page, lambda: expect(page).to_have_url(app_url + "/pricing?billing=annual", timeout=TRY_MS))
        assert history_len(page) == depth + 1
        wait_status(page, "Showing annual prices")
        eventually(page, lambda: expect(toggle).to_be_checked(timeout=TRY_MS))
        page.get_by_text("Tallwind Pro").first.scroll_into_view_if_needed()
        for price in PRICES["annual"]:
            counted_to(page, price)
        hrefs = page.get_by_role("navigation", name="Jump to section").get_by_role("link").evaluate_all(
            "els => els.map(e => e.getAttribute('href'))")
        assert hrefs and all("billing=annual" in h for h in hrefs)
        assert "annual" not in storage_dump(page)
        page.go_back()
        eventually(page, lambda: expect(page).to_have_url(app_url + "/pricing", timeout=TRY_MS))
        wait_status(page, "Showing monthly prices")
        eventually(page, lambda: expect(toggle).not_to_be_checked(timeout=TRY_MS))
        page.clock.fast_forward(2000)
        wait_text(page, PRICES["monthly"][0])
    with ui(browser) as page:
        page.goto(app_url + "/pricing?billing=annual")
        page.get_by_text("Tallwind Pro").first.scroll_into_view_if_needed()
        counted_to(page, PRICES["annual"][1])
        eventually(page, lambda: expect(page.get_by_role("switch", name="Annual Pricing (15% off)").or_(
            page.get_by_role("checkbox", name="Annual Pricing (15% off)")).first).to_be_checked(timeout=TRY_MS))
        wait_text(page, PRICES["annual"][1])
        depth = history_len(page)
        page.goto(app_url + "/pricing?billing=monthly")
        eventually(page, lambda: expect(page).to_have_url(app_url + "/pricing", timeout=TRY_MS))
        assert history_len(page) == depth + 1


def test_wf_cross_cutting_health(browser, app_url):
    ok = httpx.get(app_url + "/api/health", timeout=30)
    assert ok.status_code == 200 and ok.json() == {"status": "ok"}
    down = os.environ["APP_POSTGRES_DOWN_URL"]
    bad = httpx.get(down + "/api/health", timeout=30)
    assert bad.status_code == 503 and bad.json() == {"status": "unavailable"}
    api = httpx.get(down + "/api/accounts", headers={"Authorization": "Bearer x"}, timeout=30)
    assert api.status_code == 503 and error_of(api) == "service_unavailable"
    with ui(browser) as page:
        response = page.goto(app_url + "/no-such-page-here")
        assert response.status == 404
        eventually(page, lambda:
            expect(page.locator('a[href="/"], a[href="%s/"]' % app_url).first).to_be_attached(timeout=TRY_MS))
        links = page.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href'))")
        assert "/" in links or app_url + "/" in links


def test_wf_cross_cutting_phone(browser, app_url):
    for width in REFLOW_WIDTHS:
        with ui(browser, width=width, height=PHONE[1]) as page:
            for path in PUBLIC_PAGES:
                page.goto(app_url + path)
                layout(page)
            ui_login(page, app_url, OWNER)
            for path in COCKPIT_PAGES:
                page.goto(app_url + path)
                layout(page)
    with ui(browser, width=PHONE[0], height=PHONE[1]) as page:
        page.goto(app_url + "/")
        field = page.get_by_role("textbox", name="Enter your email").bounding_box()
        cta = (page.get_by_role("button", name="Open account").or_(page.get_by_role("link", name="Open account")))
        boxes = [b for b in (el.bounding_box() for el in cta.all()) if b and b["y"] > field["y"] - field["height"]]
        assert any(abs(b["width"] - field["width"]) <= 2 and b["width"] > PHONE[0] / 2 for b in boxes)


def test_wcag_pages(browser, app_url):
    with ui(browser) as page:
        for path in AXE_PAGES:
            page.goto(app_url + path)
            axe(page)
        ui_login(page, app_url, OWNER)
        for path in AXE_COCKPIT:
            page.goto(app_url + path)
            axe(page)


FOCUS_JS = """() => { const a = document.activeElement; if (!a || a === document.body) return null;
  const seen = [a, ...(a.labels || []), a.parentElement, a.nextElementSibling].filter(Boolean);
  let best = ['none', 0];
  for (const e of seen) {
    for (const x of e.getAnimations()) if (Number.isFinite(x.effect.getComputedTiming().endTime)) x.finish();  // a ring that transitions in reads at its end
    const s = getComputedStyle(e); let ring = 0;
    for (const m of (s.boxShadow || '').matchAll(/(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px/g)) ring = Math.max(ring, parseFloat(m[4]));
    const outline = s.outlineStyle !== 'none' ? (parseFloat(s.outlineWidth) || 0) : 0;
    if (Math.max(outline, ring) > best[1]) best = [outline >= ring ? s.outlineStyle : 'ring', Math.max(outline, ring)]; }
  return best; }"""


def test_visible_focus(browser, app_url):
    with ui(browser) as page:
        for path in ("/", "/login", "/pricing"):
            page.goto(app_url + path)
            for _ in range(12):
                page.keyboard.press("Tab")
                got = page.evaluate(FOCUS_JS)
                if got:
                    assert got[0] != "none" and got[1] >= FOCUS_MIN_PX, (path, got)
        ui_login(page, app_url, OWNER)
        for _ in range(12):
            page.keyboard.press("Tab")
            got = page.evaluate(FOCUS_JS)
            if got:
                assert got[0] != "none" and got[1] >= FOCUS_MIN_PX, got


# Frames are stamped with document.timeline.currentTime: CSS animations and transitions run on that timeline in real
# time, while the paused page clock fakes performance.now() and only advances it by FRAME_MS per run_for().
ENTRANCE_FRAMES_INIT = """(() => { window.__frames = [];
  const layoutTop = n => { let y = 0; for (; n; n = n.offsetParent) y += n.offsetTop + n.clientTop; return y; };
  const opacity = n => { let o = 1; for (; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const tick = () => { if (window.__frames.length < 600 && document.body) {
      const e = [...document.body.querySelectorAll('*')].find(x => x.children.length === 0 && x.textContent.trim() === 'Total cash');
      if (e) window.__frames.push([document.timeline.currentTime, opacity(e), e.getBoundingClientRect().top + scrollY - layoutTop(e)]); }
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick); })();"""
ENTRANCE_FRAMES = 64
FRAME_MS = 16
ANIM_JS = """(() => { window.__twAnims = [];
 const rec = (el, end, frames) => { try { const inside = !!(el.closest && el.closest('[role=listitem], li')) ||
   /Available|Total cash/.test(el.textContent || ''); window.__twAnims.push({inside, end, frames: JSON.stringify(frames || [])}); } catch (e) {} };
 document.addEventListener('animationstart', (e) => { const a = e.target.getAnimations().find(x => x.animationName === e.animationName);
   if (a) rec(e.target, a.effect.getComputedTiming().endTime, a.effect.getKeyframes()); }, true);
 document.addEventListener('transitionrun', (e) => { const a = e.target.getAnimations().find(x => x.transitionProperty === e.propertyName);
   if (a) rec(e.target, a.effect.getComputedTiming().endTime, a.effect.getKeyframes()); }, true);
 const orig = Element.prototype.animate; Element.prototype.animate = function (k, o) { const a = orig.call(this, k, o);
   rec(this, a.effect.getComputedTiming().endTime, a.effect.getKeyframes()); return a; };
})();"""
STILL_JS = """h => { let s = h; while (s.parentElement && s.getBoundingClientRect().height < innerHeight * 0.6) s = s.parentElement;
 let best = null, area = 0; for (const el of s.querySelectorAll('img, svg, canvas, picture, div')) {
 const r = el.getBoundingClientRect(); const a = r.width * r.height; if (a > area && !el.contains(h)) { area = a; best = el; } }
 return best.getBoundingClientRect().top + scrollY; }"""


def _shot(page, y):
    page.evaluate(f"() => window.scrollTo({{top: {y}, behavior: 'instant'}})")
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    return decode(page.screenshot())


def test_quiet_motion(browser, app_url):
    def entrances(reduced):
        with ui(browser, scripts=[ANIM_JS, ENTRANCE_FRAMES_INIT], reduced=reduced) as page:
            ui_login(page, app_url, OWNER)
            wait_text(page, "Total cash")
            for _ in range(ENTRANCE_FRAMES):
                page.clock.run_for(FRAME_MS)
            recorded = [a for a in page.evaluate("() => window.__twAnims")
                        if a["inside"] and ("opacity" in a["frames"] or "transform" in a["frames"])]
            frames = page.evaluate("() => window.__frames")
        if not frames:
            return recorded, False, 0.0, False
        _, first_o, first_y = frames[0]
        _, last_o, last_y = frames[-1]
        moving = [t for t, o, y in frames if o < 0.99 * last_o or abs(y - last_y) > 0.5]
        framed = bool(moving) and (max(y - last_y for _, _, y in frames) > 0.5 or min(o for _, o, _ in frames) < 0.99 * last_o)
        # Movement is a frame caught part-way between the first state and the settled one; a card that goes from
        # hidden or offset straight to its final place in one frame appears instantly, as reduced motion asks.
        lo_o, hi_o = sorted((first_o, last_o))
        lo_y, hi_y = sorted((first_y, last_y))
        tween = any(lo_o + 0.01 < o < hi_o - 0.01 or lo_y + 0.5 < y < hi_y - 0.5 for _, o, y in frames)
        return recorded, framed, (moving[-1] - frames[0][0]) if moving else 0.0, tween

    recorded, framed, settle, _ = entrances(False)
    assert recorded or framed, "no entrance motion on the cockpit cards"
    assert all(a["end"] <= MOTION_MAX_MS for a in recorded), recorded[:3]
    assert settle <= MOTION_MAX_MS, settle
    recorded, _, _, tween = entrances(True)
    assert [a for a in recorded if a["end"] > INSTANT_MS] == [] and not tween
    shots = {}
    for reduced in (False, True):
        with ui(browser, reduced=reduced) as page:
            page.goto(app_url + "/")
            heading = page.get_by_role("heading", name="One ledger for the whole company.")
            top = heading.evaluate(STILL_JS)
            height = page.evaluate("() => innerHeight")
            start, end = top - height, top - height / 2
            mid = (start + end) / 2
            shots[reduced] = {"mid": _shot(page, mid), "after": _shot(page, end + 40)}
            shots[reduced]["back"] = _shot(page, mid)
    normal, still = shots[False], shots[True]
    changed(still["mid"], normal["mid"])
    assert difference(normal["after"], still["after"]) < difference(normal["mid"], still["mid"])
    assert difference(normal["mid"], normal["back"]) < difference(normal["mid"], still["mid"])
    assert difference(still["mid"], still["back"]) < difference(normal["mid"], still["mid"])


def test_business_clock():
    with copy_app(SEED_NOW) as app:
        lk = Lark(app.url)
        start = parse_ts(SEED_NOW)
        t0 = time.monotonic()
        first = parse_ts(me(app.url, lk.owner)["business_now"])
        assert start <= first <= start + timedelta(seconds=BOOT_S + time.monotonic() - t0)
        p = pay(app.url, lk.owner, lk.checking, lk.northwind, 100).json()
        created = parse_ts(p["created_at"])
        stored = parse_ts(app.pg().rows(f"SELECT created_at FROM payments WHERE id::text = {lit(p['id'])}")[0]["created_at"])
        assert created == stored and created.date() == date(2027, 7, 2)
        poll(lambda: parse_ts(me(app.url, lk.owner)["business_now"]) >= first + timedelta(seconds=2), 10, "clock advances")
        assert me(app.url, lk.owner)["business_date"] == "2027-07-02"
        app.restart(LATER_NOW)
        assert me(app.url, lk.owner)["business_date"] == LATER_NOW[:10]
        tx = pay(app.url, lk.owner, lk.checking, lk.northwind, 100).json()
        assert parse_ts(tx["created_at"]).date() == date.fromisoformat(LATER_NOW[:10])


APP_ROOT = Path("/app")
ALLOWED_LICENSES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}


def test_if_user_readme():
    text = (APP_ROOT / "USER_README.md").read_text()
    for value in (OWNER, ADMIN, MEMBER, OUTSIDER, PASSWORD):
        assert value in text


def test_if_artifact_dirs():
    for name in (".browser_screenshots", ".downloads"):
        assert (APP_ROOT / name).is_dir()


def test_if_run_manifest():
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) for k in ("install", "build", "serve"))


def _shipped():
    return sorted((pkg.name, pkg.version, pkg.licence) for pkg in shipped_packages())


def test_if_third_party_notices():
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name, _, _ in _shipped() if name not in notices]
    assert missing == [], missing


def test_if_licences_allowed():
    bad = []
    for name, _, lic in _shipped():
        options = {p.strip("() ") for p in re.split(r"\s+OR\s+", lic)}
        if not options & ALLOWED_LICENSES:
            bad.append((name, lic))
    assert bad == [], bad


def test_if_postgres_only():
    assert set(TABLES) <= {t.split(".", 1)[-1] for t in Postgres().tables()}
    stray = [p for p in APP_ROOT.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db")
             and "node_modules" not in p.parts and ".venv" not in p.parts]
    assert stray == [], stray
    procs = []
    for comm in Path("/proc").glob("[0-9]*/comm"):
        try:
            procs.append(comm.read_text().strip())
        except OSError:
            continue
    assert not {"redis-server", "mongod"} & set(procs)


def test_if_no_backing_service_installed():
    commands = [c for f in Path("/logs/agent").rglob("*.json*") for doc in agent_docs(f) for c in ran_commands(doc)]
    start = r"(^|[;&|(]\s*|\bsudo\s+|\bexec\s+)"
    bad = re.compile(rf"{start}(apt(-get)?|apk|yum|dnf|brew)\s+(install|add)\b[^;&|\n]*\b(postgresql(@?[\d.]+)?(-\d+)?|redis(-server)?|mongodb)(?![-\w])|"
                     rf"{start}initdb\b|{start}pg_ctl(cluster)?\b[^;&|\n]*\bstart\b|{start}docker\s+run\b[^;&|\n]*\b(postgres|redis|mongo)\b|"
                     rf"{start}(redis-server|mongod)\b", re.I)
    for command in commands:
        for line in command.splitlines():
            assert not bad.search(line.strip()), line


def agent_docs(path):
    text = path.read_text(errors="replace")
    try:
        return [json.loads(text)] if text.strip() else []
    except ValueError:
        docs = []
        for line in text.splitlines():
            with contextlib.suppress(ValueError):
                docs.append(json.loads(line))
        return docs


def ran_commands(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("command", "cmd") and isinstance(value, str):
                yield value
            else:
                yield from ran_commands(value)
    elif isinstance(node, list):
        for value in node:
            yield from ran_commands(value)
