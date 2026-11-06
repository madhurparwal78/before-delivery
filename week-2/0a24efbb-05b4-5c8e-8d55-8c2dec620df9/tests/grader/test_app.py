import calendar
import concurrent.futures as cf
import csv
import hashlib
import io
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
import unicodedata
import uuid
from datetime import date, datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (DEPLOYED_APP, Keycloak, Postgres, animations, axe, held, layout, motion, open_app,
                      post_json, same_origin, select, settle, state_styles, style)

PW = "deku-demo-pw-2026"
LON = ZoneInfo("Europe/London")
TYPES = ["missed_in", "missed_out", "offsite", "whole_day", "night_shift"]
CAP = 10
DEFAULT_CAP = 3
DEFAULT_LOOKBACK = 30
SEEDED_SPAN = 89
ATTENDANCE_ROWS = 1393
PAGE_SIZE = 25
Q_MAX = 100
REASON_MAX = 280
NOTE_MIN = 10
BODY_MAX = 65536
DEPTH_MAX = 8
TOKEN_MIN = 32
LOCK_AT = 5
LOCK_DEFAULT = 900
MINT_WINDOW_MIN = 15
REALM_RETURN_S = 15
FRESH_DAY = "2026-04-14"
FALL_DAY = "2026-10-28"
FRESH_LOCK = 5
IDLE_S, MAX_S = 3, 7
TTL_S = 3
UNKNOWN_ID = 9223372036854775807
APP_S = 180
HTTP_S = 30
NPM_S = 300
POLL_S = 0.25
SLACK_S = 3
CHUNK = 65536
TIERS = {"wide": (1280, 800), "middle": (768, 1024), "narrow": (375, 812)}
TIER_IDS = ["wide", "middle", "narrow"]

PEOPLE = [
    (1, "admin@example.com", "Priya Sahni", "admin", None, True),
    (2, "manager@example.com", "Dara Finch", "manager", 1, True),
    (3, "manager2@example.com", "Omar Vance", "manager", 1, True),
    (4, "manager3@example.com", "Lena Roth", "manager", 1, True),
    (5, "employee@example.com", "Iris Calder", "employee", 2, True),
    (6, "employee2@example.com", "Tomas Berg", "employee", 2, True),
    (7, "employee3@example.com", "Nadia Kerr", "employee", 2, True),
    (8, "employee4@example.com", "Felix Arno", "employee", 2, True),
    (9, "employee5@example.com", "Suri Patel", "employee", 3, True),
    (10, "employee6@example.com", "Jonas Vale", "employee", 3, True),
    (11, "employee7@example.com", "Mira Okoye", "employee", 3, True),
    (12, "employee8@example.com", "Ravi Setu", "employee", 3, True),
    (13, "employee9@example.com", "Clara Mendt", "employee", 4, True),
    (14, "employee10@example.com", "Bo Lindqvist", "employee", 4, True),
    (15, "employee11@example.com", "Ayaan Qureshi", "employee", 4, True),
    (16, "employee12@example.com", "Greta Solis", "employee", 4, False),
]
ADDR = {p[0]: p[1] for p in PEOPLE}
NAME = {p[0]: p[2] for p in PEOPLE}
SEED_REQ = [
    (1, 5, 7, "missed_out", "pending", None, None, "Left through the loading bay after the late delivery and the reader did not register me."),
    (2, 7, 3, "missed_out", "pending", None, None, "The exit reader at the north gate was offline when I left after my shift."),
    (3, 9, 44, "missed_in", "pending", None, None, "Came in early for the stock count and the front door reader was not working."),
    (4, 11, 12, "missed_out", "approved", 3, None, "Walked out with the fire drill group and never passed a reader on the way."),
    (5, 11, 18, "missed_in", "rejected", 3, "The rota shows annual leave on that day.", "My badge was in my other jacket so a colleague let me in that morning."),
    (6, 8, 25, "offsite", "cancelled", None, None, "Spent the whole day at the supplier site checking the returned pallets."),
    (7, 13, "c1", "missed_in", "approved", 4, None, "The reader rejected my new badge on the first morning after it was replaced."),
    (8, 13, "c2", "missed_out", "approved", 4, None, "The replacement badge failed again on the way out at the end of the shift."),
    (9, 13, "c3", "whole_day", "approved", 4, None, "Worked the full day at the depot while the badge office reissued my card."),
]
NOT_FOUND = ("That page does not exist", "The link may be out of date. Go back to the desk.")
SIGNED_OUT = {"error": "Sign in to continue."}
ENDED = {"error": "Your session has ended. Sign in again."}
NO_SUCH_REQ = {"error": "No such request."}
REJECT_NOTE = "The rota shows annual leave on that day."
OFF_DESK = "/" + "/evil.example"

BASE = ""
_TOK: dict = {}
_MADE: list = []
_SHARE: dict = {}
_PG: list = []


@pytest.fixture(autouse=True)
def _env(app_url):
    global BASE
    BASE = app_url.rstrip("/")
    yield
    for base, pid, rid in _MADE:
        try:
            req("POST", f"/api/requests/{rid}/cancel", tok(pid, base), base=base)
        except (AssertionError, httpx.HTTPError):
            pass
    _MADE.clear()


def db():
    if not _PG:
        _PG.append(Postgres())
    return _PG[0]


def q(sql):
    return db().rows(sql)


def utc(col):
    return f"to_char(({col}) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"


def psql(sql, url=None):
    return subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", url or os.environ["DATABASE_URL"], "-c", sql],
                          capture_output=True, text=True, timeout=HTTP_S, env={**os.environ, "PGTZ": "UTC"})


def orows(sql, url):
    r = psql(f"select coalesce(json_agg(t), '[]'::json) from ({sql}) t", url)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def req(method, path, t=None, *, base=None, body=None, headers=None, raw=None, ctype="application/json"):
    h = dict(headers or {})
    if t:
        h["Authorization"] = f"Bearer {t}"
    kw = {}
    if body is not None:
        kw["json"] = body
    if raw is not None:
        kw["content"] = raw
        h["Content-Type"] = ctype
    return httpx.request(method, (base or BASE) + path, headers=h, timeout=HTTP_S, **kw)


def login(who, pw=PW, base=None, **headers):
    r = post_json(base or BASE, "/api/session", {"work_address": ADDR.get(who, who), "password": pw}, **headers)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def tok(pid, base=None):
    k = (pid, base or BASE)
    t = _TOK.get(k)
    if not t or req("GET", "/api/session", t, base=base).status_code != 200:
        t = _TOK[k] = login(pid, base=base)
    return t


def client(pid, base=None):
    c = httpx.Client(base_url=base or BASE, timeout=HTTP_S, follow_redirects=False)
    assert c.post("/api/session", json={"work_address": ADDR[pid], "password": PW}).status_code == 200
    return c


def text_of(html):
    html = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html)
    html = re.sub(r"(?s)<!--.*?-->", "", html)
    text = " ".join(unescape(re.sub(r"<[^>]+>", " ", html)).split())
    return re.sub(r"\s+([,.:;!?])", r"\1", text)


def scripts_of(html, base):
    srcs = re.findall(r'<script[^>]+src="([^"]+)"', html) + re.findall(r'<link[^>]+href="([^"]+\.js)"', html)
    return [httpx.get(base + s, timeout=HTTP_S).text for s in srcs if s.startswith("/") and not urlsplit(s).netloc]


def inst(day, hhmm, fold=0):
    d = date.fromisoformat(str(day))
    h, m = map(int, hhmm.split(":"))
    return datetime(d.year, d.month, d.day, h, m, tzinfo=LON, fold=fold).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def london_date(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(LON).date().isoformat()


def seeded():
    return date.fromisoformat(q("select seeded_on::text as d from employer")[0]["d"])


def month_of(d):
    return d.strftime("%Y-%m")


def ensure_policy(cap=CAP, lookback=DEFAULT_LOOKBACK, types=TYPES, note=False):
    a = tok(1)
    want = {"monthly_cap": cap, "lookback_days": lookback, "enabled_types": [t for t in TYPES if t in types],
            "require_note_on_approve": note}
    for _ in range(LOCK_AT):
        cur = req("GET", "/api/policy", a)
        if all(cur.json()[k] == v for k, v in want.items()):
            return cur.json()["version"]
        r = req("PUT", "/api/policy", a, body=want, headers={"If-Match": cur.headers["ETag"]})
        if r.status_code == 201:
            return r.json()["version"]
    pytest.fail("policy could not be set")


L_ = "at time zone 'Europe/London'"


def free_days(pid, extra=""):
    s = seeded()
    lo = s - timedelta(days=DEFAULT_LOOKBACK)
    sql = f"""with a as (select day::date d, recorded_in i, recorded_out o from attendance_day where person_id = {pid})
    select g::text as day from (select t::date g from generate_series('{lo}'::timestamp, '{s}'::timestamp, interval '1 day') t) x
    where not exists (select 1 from regularisation_request r where r.person_id = {pid} and r.day::date = g and r.state = 'pending')
      and not exists (select 1 from leave_day l where l.person_id = {pid} and l.day::date = g and l.status = 'approved')
      and (select count(*) from regularisation_request r where r.person_id = {pid} and r.state in ('approved', 'pending')
           and date_trunc('month', r.day::date) = date_trunc('month', g)) < {CAP} - 2
      and coalesce((select o from a where a.d = g - 1), '-infinity') <= (g + time '09:00') {L_}
      and coalesce((select i from a where a.d = g + 1), 'infinity') >= (g + 1 + time '07:00') {L_}
      and coalesce((select i from a where a.d = g), '-infinity') < (g + time '18:00') {L_}
      and coalesce((select o from a where a.d = g), 'infinity') > (g + time '09:00') {L_}
      {extra}
    order by g desc"""
    return [date.fromisoformat(r["day"]) for r in q(sql)]


def pick(pid, n=1, extra=""):
    days = free_days(pid, extra)
    assert len(days) >= n, f"no free day for person {pid}"
    return days[:n] if n > 1 else days[0]


def raise_req(pid, day, ctype="missed_out", cin="09:00", cout="18:00", reason=None, key=None, base=None, expect_status=201):
    body = {"day": str(day), "correction_type": ctype, "claimed_in": cin, "claimed_out": cout,
            "reason": reason or f"Badge reader missed me {uuid.uuid4().hex}"}
    r = post_json(base or BASE, "/api/requests", body, key=key, Authorization=f"Bearer {tok(pid, base)}")
    if r.status_code == 201:
        _MADE.append((base or BASE, pid, r.json()["id"]))
    if expect_status:
        assert r.status_code == expect_status, r.text
    return r


def decide(pid, rid, outcome, note=None, base=None):
    return post_json(base or BASE, f"/api/requests/{rid}/decision", {"outcome": outcome, "note": note},
                     Authorization=f"Bearer {tok(pid, base)}")


def stored(rid):
    return q(f"select state::text, decided_by, decision_note, {utc('decided_at')} decided_at from regularisation_request where id = {rid}")[0]


def walk(t, params="", base=None):
    rows, page = [], 1
    while True:
        r = req("GET", f"/api/requests?{params + '&' if params else ''}page={page}", t, base=base).json()
        rows += r["rows"]
        if page >= r["pages"]:
            return rows, r
        page += 1


def shared_token():
    if "t" not in _SHARE:
        m = month_of(seeded().replace(day=1) - timedelta(days=1))
        r = req("POST", "/api/share-links", tok(1), body={"person_id": 6, "month": m})
        assert r.status_code == 201, r.text
        _SHARE["t"] = r.json()["token"]
    return _SHARE["t"]


def ui_login(page, pid, path="/requests", base=None):
    b = base or BASE
    page.context.clear_cookies()
    page.goto(f"{b}/login?next={quote(path, safe='')}")
    page.get_by_role("textbox", name="Work address").fill(ADDR[pid])
    page.get_by_label("Password").fill(PW)
    page.get_by_role("button", name="Sign in").click()
    expect(page).to_have_url(b + path)


def announced(page, role, text):
    expect(page.get_by_role(role).filter(has_text=text).first).to_be_attached()


def row_of(page, rid):
    return page.get_by_role("row").filter(has=page.get_by_role("link", name=f"Open request {rid}"))


def chain_ok(entries):
    prev = "0" * 64
    for e in entries:
        parts = [str(e["seq"]), e["occurred_at"], str(e["actor_id"]), e["verb"], e["subject_type"],
                 "" if e["subject_id"] is None else str(e["subject_id"]), e["note"] or "", e["prev_hash"]]
        if e["prev_hash"] != prev or hashlib.sha256("\x1f".join(parts).encode()).hexdigest() != e["entry_hash"]:
            return e["seq"]
        prev = e["entry_hash"]
    return None


AUDIT_SQL = f"select seq, request_id, actor_id, actor_role::text, verb::text, subject_type::text, subject_id::text, {utc('occurred_at')} occurred_at, note, prev_hash, entry_hash from audit_event order by seq"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Copy:
    def __init__(self, env):
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.env = {**os.environ, **env, "APP_PUBLIC_PORT": str(self.port), "APP_PUBLIC_URL": self.base}
        self.log = Path(tempfile.mkdtemp()) / "serve.log"
        self.codes = set()
        self.proc = None

    def start(self):
        serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
        self.fh = open(self.log, "w")
        self.proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=self.env, stdout=self.fh,
                                     stderr=subprocess.STDOUT, start_new_session=True)
        return self

    def tail(self):
        return self.log.read_text(errors="replace")[-3000:]

    def pace(self):
        try:
            self.proc.wait(timeout=POLL_S)
        except subprocess.TimeoutExpired:
            pass
        assert self.proc.poll() is None, f"copy exited:\n{self.tail()}"

    def health(self):
        try:
            r = httpx.get(self.base + "/api/health", timeout=HTTP_S)
            self.codes.add(r.status_code)
            return r
        except httpx.TransportError:
            return None

    def wait(self, pred, seconds=APP_S):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            r = self.health()
            if r is not None and pred(r):
                return r
            self.pace()
        pytest.fail(f"copy never reached the state:\n{self.tail()}")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=HTTP_S)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
        self.fh.close()


class Relay:
    def __init__(self, target):
        u = urlsplit(target)
        self.target = (u.hostname, u.port or 80)
        self.port = free_port()
        self.sock = None

    def url(self, u):
        s = urlsplit(u)
        return urlunsplit(s._replace(netloc=f"127.0.0.1:{self.port}"))

    def start(self):
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen()
        self.sock = s
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                c, _ = self.sock.accept()
                up = socket.create_connection(self.target, timeout=HTTP_S)
                up.settimeout(None)
            except OSError:
                return
            for a, b in ((c, up), (up, c)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a, b):
        try:
            while data := a.recv(CHUNK):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def stop(self):
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.sock.close()


def fresh_db():
    name = f"rostara_t_{uuid.uuid4().hex[:10]}"
    r = psql(f'CREATE DATABASE "{name}"')
    assert r.returncode == 0, r.stderr
    u = urlsplit(os.environ["DATABASE_URL"])
    return urlunsplit(u._replace(path="/" + name)), name


def drop_db(name):
    psql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


SNAP = {
    "employer": "select id, name, time_zone, seeded_on::text seeded_on from employer order by id",
    "person": "select id, employer_id, name, work_address, role::text role, manager_id, active, phone, private_note from person order by id",
    "attendance_day": f"select person_id, day::text as day, {utc('recorded_in')} i, {utc('recorded_out')} o, source::text source from attendance_day order by person_id, day",
    "leave_day": "select person_id, day::text as day, kind::text kind, status::text status from leave_day order by person_id, day",
    "regularisation_request": f"select id, person_id, day::text as day, correction_type::text ctype, left(claimed_in::text, 5) cin, left(claimed_out::text, 5) cout, reason, state::text state, {utc('raised_at')} raised_at, decided_by, {utc('decided_at')} decided_at, decision_note, idempotency_key from regularisation_request order by id",
    "policy": f"select version, monthly_cap, lookback_days, enabled_types::text et, require_note_on_approve, self_approval_allowed, created_by, {utc('created_at')} created_at from policy order by version",
    "audit_event": AUDIT_SQL,
    "share_link": "select count(*)::int n from share_link",
}


def snapshot(url):
    s = {k: orows(v, url) for k, v in SNAP.items()}
    s["sign_in_attempt"] = orows("select count(*)::int n from sign_in_attempt", url)
    return s


@pytest.fixture(scope="module")
def realm_down():
    relay = Relay(os.environ["KEYCLOAK_URL"])
    copy = Copy({"KEYCLOAK_URL": relay.url(os.environ["KEYCLOAK_URL"]),
                 "AUTH_ISSUER_URL": relay.url(os.environ["AUTH_ISSUER_URL"])})
    try:
        copy.start()
        copy.wait(lambda r: r.status_code == 503 and r.json().get("seeded") is True)
        yield copy.base
    finally:
        copy.stop()
        relay.stop()


@pytest.fixture(scope="module")
def fresh():
    url, name = fresh_db()
    relay = Relay(os.environ["KEYCLOAK_URL"])
    env = {"DATABASE_URL": url, "EMPLOYER_SEEDED_ON": FRESH_DAY, "SIGN_IN_LOCKOUT_SECONDS": str(FRESH_LOCK),
           "KEYCLOAK_URL": relay.url(os.environ["KEYCLOAK_URL"]), "AUTH_ISSUER_URL": relay.url(os.environ["AUTH_ISSUER_URL"])}
    copies = [Copy(env), Copy(env)]
    st = SimpleNamespace(url=url, env=env, copies=copies, relay=relay)
    try:
        for c in copies:
            c.start()
        for c in copies:
            c.wait(lambda r: r.status_code == 503 and r.json().get("seeded") is True)
        st.down_health = copies[0].health().json()
        st.first = snapshot(url)
        st.down_login = httpx.get(copies[0].base + "/login", timeout=HTTP_S)
        st.down_signin = post_json(copies[0].base, "/api/session", {"work_address": ADDR[1], "password": PW})
        relay.start()
        t0 = time.monotonic()
        for c in copies:
            c.wait(lambda r: r.status_code == 200)
        st.ready_s = time.monotonic() - t0
        while True:
            r = post_json(copies[1].base, "/api/session", {"work_address": ADDR[1], "password": PW})
            if r.status_code == 200 or time.monotonic() - t0 > APP_S:
                break
            copies[1].pace()
        st.signin_s, st.signin_status = time.monotonic() - t0, r.status_code
        yield st
    finally:
        for c in st.copies:
            c.stop()
        relay.stop()
        drop_db(name)


@pytest.fixture(scope="module")
def fall():
    url, name = fresh_db()
    c = Copy({"DATABASE_URL": url, "EMPLOYER_SEEDED_ON": FALL_DAY})
    try:
        c.start().wait(lambda r: r.status_code == 200)
        yield SimpleNamespace(url=url, copy=c, base=c.base)
    finally:
        c.stop()
        drop_db(name)


def seed_days(s):
    off = lambda k: s - timedelta(days=k)
    c1 = off(29).replace(day=1)
    pos = {"c1": c1, "c2": c1 + timedelta(days=1), "c3": c1 + timedelta(days=2)}
    return {r[0]: (pos[r[2]] if isinstance(r[2], str) else off(r[2])) for r in SEED_REQ}


def test_health_ready(app_url, realm_down):
    r = httpx.get(BASE + "/api/health", timeout=HTTP_S)
    assert r.status_code == 200 and r.json() == {"status": "ok", "schema": True, "seeded": True, "realm": True}
    r = httpx.get(realm_down.rstrip("/") + "/api/health", timeout=HTTP_S)
    assert r.status_code == 503
    assert r.json() == {"status": "starting", "schema": True, "seeded": True, "realm": False}


def test_one_origin(app_url):
    c = client(5)
    page = c.get("/requests")
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    api = c.get("/api/requests")
    assert api.status_code == 200 and api.headers["content-type"].startswith("application/json")
    assert {"rows", "matched", "total", "page", "pages"} <= set(api.json())


def test_production_build(app_url):
    c = client(1)
    qd = req("GET", "/api/requests", tok(1)).json()
    html = text_of(c.get("/requests").text)
    assert f"{qd['matched']} of {qd['total']} requests" in html and "Regularisation requests" in html
    v = req("GET", "/api/policy", tok(1)).json()["version"]
    assert f"Rostara attendance desk. Policy version {v}." in html
    assert "Correction policy" in text_of(c.get("/policy").text)
    assert "Team calendar" in text_of(c.get("/calendar").text)
    assert "Sign in to Rostara" in text_of(httpx.get(BASE + "/login", timeout=HTTP_S).text)


HEADER_CASES = ["login", "api_health", "api_unknown", "api_405", "redirect", "not_found", "share_unknown"]


@pytest.mark.parametrize("case", HEADER_CASES, ids=HEADER_CASES)
def test_security_headers(app_url, case):
    path, method = {"login": ("/login", "GET"), "api_health": ("/api/health", "GET"), "api_unknown": ("/api/nope", "GET"),
                    "api_405": ("/api/health", "DELETE"), "redirect": ("/requests", "GET"),
                    "not_found": ("/no-such-page", "GET"), "share_unknown": ("/share/notatoken", "GET")}[case]
    r = req(method, path)
    h = r.headers
    assert h.get("x-content-type-options") == "nosniff"
    assert h.get("x-frame-options", "").upper() == "DENY" or "frame-ancestors 'none'" in h.get("content-security-policy", "")
    allowed = {"strict-origin-when-cross-origin"} | ({"no-referrer"} if case == "share_unknown" else set())
    assert h.get("referrer-policy") in allowed
    assert "X-Powered-By" not in h


def test_real_backing_services(app_url):
    reason = f"Gate reader stayed dark all morning {uuid.uuid4().hex}"
    rid = raise_req(6, pick(6), reason=reason).json()["id"]
    rows = q(f"select person_id, state::text state, reason from regularisation_request where id = {rid}")
    assert rows == [{"person_id": 6, "state": "pending", "reason": reason}]
    assert ADDR[6] in {u.get("username", "").lower() for u in Keycloak().users()}
    r = post_json(BASE, "/api/session", {"work_address": ADDR[6], "password": "not-" + PW})
    assert r.status_code == 401


def test_no_credentials_in_pages(app_url):
    bad = ["DATABASE_URL", "AUTH_CLIENT_SECRET", "client_secret"]
    for k in ("AUTH_CLIENT_SECRET", "DATABASE_URL"):
        if os.environ.get(k):
            bad.append(os.environ[k])
    pw = urlsplit(os.environ.get("DATABASE_URL", "")).password
    if pw:
        bad.append(pw)
    c = client(1)
    bodies = [httpx.get(BASE + "/login", timeout=HTTP_S).text] + [c.get(p).text for p in ("/requests", "/policy", "/calendar")]
    for html in list(bodies):
        bodies += scripts_of(html, BASE)
    for b in bodies:
        for s in bad:
            assert s not in b


def test_api_surface(app_url):
    for p in ("/api/nope", "/api", "/api/", "/api/requests/", "/api/debug/seed"):
        r = req("GET", p)
        assert r.status_code == 404 and r.json() == {"error": "No such endpoint."}
    for method, path, allow in [("PATCH", "/api/requests", {"GET", "POST", "HEAD"}), ("DELETE", "/api/policy", {"GET", "PUT", "HEAD"}),
                                ("GET", "/api/share-links", {"POST"}), ("PUT", "/api/session", {"GET", "POST", "DELETE", "HEAD"}),
                                ("GET", "/api/requests/1/decision", {"POST"})]:
        r = req(method, path, tok(1))
        assert r.status_code == 405 and r.json() == {"error": "Method not allowed."}
        assert {m.strip().upper() for m in r.headers["allow"].split(",")} == allow
    r = req("HEAD", "/api/health")
    assert r.status_code == 200 and r.content == b""


def test_wf_platform_server_rendered_queue(page, app_url):
    ui_login(page, 1)
    expect(page.get_by_role("heading", name="Regularisation requests", level=1)).to_be_visible()
    expect(page.get_by_role("banner")).to_contain_text("People operations")
    r = page.request.get(BASE + "/api/session")
    assert r.status == 200 and r.json()["role"] == "admin"


def test_wf_platform_realm_down_login(browser, realm_down):
    down = realm_down.rstrip("/")
    with open_app(browser, down + "/login") as page:
        expect(page.get_by_role("heading", name="Sign in to Rostara", level=1)).to_be_visible()
        page.get_by_role("textbox", name="Work address").fill(ADDR[5])
        page.get_by_label("Password").fill(PW)
        page.get_by_role("button", name="Sign in").click()
        announced(page, "alert", "Sign-in is unavailable right now. Try again shortly.")
        expect(page.get_by_role("textbox", name="Work address")).to_have_value(ADDR[5])
        expect(page.get_by_label("Password")).to_have_value("")
    assert httpx.get(down + "/api/health", timeout=HTTP_S).status_code == 503


def test_seeded_people(fresh):
    s = fresh.first
    assert s["employer"] == [{"id": 1, "name": "Kestrel Works", "time_zone": "Europe/London", "seeded_on": FRESH_DAY}]
    want = [{"id": i, "employer_id": 1, "name": n, "work_address": a, "role": r, "manager_id": m, "active": act,
             "phone": f"07700 9001{i:02d}", "private_note": f"Emergency contact held on paper file KW-{i:04d}."}
            for i, a, n, r, m, act in PEOPLE]
    assert s["person"] == want
    folded = {unicodedata.normalize("NFKC", r["work_address"]).lower() for r in q("select work_address from person")}
    assert len(folded) == len(PEOPLE)


def test_seeded_attendance_and_leave(fresh):
    s = date.fromisoformat(FRESH_DAY)
    att = {}
    for pid in ADDR:
        cin, cout = ("09:00", "18:00") if pid % 2 else ("10:00", "19:00")
        for k in range(SEEDED_SPAN + 1):
            if k in (44, 60, 75):
                continue
            d = s - timedelta(days=k)
            att[(pid, d.isoformat())] = (None if k in (18, 25, 31) else inst(d, cin), None if k in (3, 7, 12) else inst(d, cout), "clock")
    days = seed_days(s)
    for rid in (4, 7, 8, 9):
        d = days[rid]
        att[(SEED_REQ[rid - 1][1], d.isoformat())] = (inst(d, "09:00"), inst(d, "18:00"), "regularisation")
    got = {(r["person_id"], r["day"]): (r["i"], r["o"], r["source"]) for r in fresh.first["attendance_day"]}
    assert len(fresh.first["attendance_day"]) == ATTENDANCE_ROWS == len(got)
    assert got == att
    leave = sorted([(p, (s - timedelta(days=k)).isoformat(), kind, st) for k, st, kind, ps in
                    [(5, "approved", "annual", (5, 9, 13)), (19, "approved", "sickness", (5, 9, 13)), (9, "pending", "sickness", (6, 10, 14))]
                    for p in ps])
    assert sorted((r["person_id"], r["day"], r["kind"], r["status"]) for r in fresh.first["leave_day"]) == leave


def test_seeded_corrections_and_policy(fresh):
    s = date.fromisoformat(FRESH_DAY)
    days = seed_days(s)
    got = fresh.first["regularisation_request"]
    assert isinstance(got, list) and all(isinstance(r, dict) for r in got), \
        f"snapshot shape: {type(got).__name__} {repr(got)[:400]}"
    assert [r["id"] for r in got] == list(range(1, 10))
    for (rid, pid, _, t, state, decider, note, reason), r in zip(SEED_REQ, got):
        d = days[rid]
        assert (r["person_id"], r["day"], r["ctype"], r["cin"], r["cout"], r["reason"], r["state"]) == (pid, d.isoformat(), t, "09:00", "18:00", reason, state)
        assert r["raised_at"] == inst(d, "20:00") and r["decided_by"] == decider and r["decision_note"] == note
        assert r["decided_at"] == (inst(d + timedelta(days=1), "11:00") if decider else None) and r["idempotency_key"] is None
    assert got[3]["raised_at"] == "2026-04-02T19:00:00Z" and got[3]["decided_at"] == "2026-04-03T10:00:00Z"
    assert got[6]["day"] == "2026-03-01" and got[6]["decided_at"] == "2026-03-02T11:00:00Z"
    [p] = fresh.first["policy"]
    assert (p["version"], p["monthly_cap"], p["lookback_days"], p["require_note_on_approve"], p["self_approval_allowed"],
            p["created_by"], p["created_at"]) == (1, DEFAULT_CAP, DEFAULT_LOOKBACK, False, False, 1, "2026-04-13T23:00:00Z")
    assert all(t in p["et"] for t in TYPES)


def test_seeding_runs_once(fresh):
    before = {k: v for k, v in snapshot(fresh.url).items() if k != "sign_in_attempt"}
    c = Copy(fresh.env).start()
    try:
        c.wait(lambda r: r.status_code == 200)
        after = {k: v for k, v in snapshot(fresh.url).items() if k != "sign_in_attempt"}
    finally:
        c.stop()
    assert after == before
    assert after["regularisation_request"] == fresh.first["regularisation_request"]


def test_store_invariants(app_url):
    assert q("select person_id, day from regularisation_request where state = 'pending' group by person_id, day having count(*) > 1") == []
    assert q("select id from regularisation_request where state in ('approved', 'rejected') and (decided_by is null or decided_at is null)") == []
    assert q("select id from regularisation_request where state in ('pending', 'cancelled') and (decided_by is not null or decided_at is not null)") == []
    assert q("select id from regularisation_request where state = 'rejected' and (decision_note is null or decision_note = '')") == []
    assert q("select id from regularisation_request where decided_by = person_id") == []


def test_exact_first_state(fresh):
    s = fresh.first
    assert len(s["person"]) == len(PEOPLE) and len(s["regularisation_request"]) == len(SEED_REQ)
    assert len(s["attendance_day"]) == ATTENDANCE_ROWS and len(s["leave_day"]) == len(SEED_REQ)
    assert len(s["policy"]) == 1 and s["share_link"] == [{"n": 0}] and s["sign_in_attempt"] == [{"n": 0}]
    days = seed_days(date.fromisoformat(FRESH_DAY))
    want = [(1, 4, 3, "manager", "approved", "request", "4", None), (2, 5, 3, "manager", "rejected", "request", "5", "The rota shows annual leave on that day."),
            (3, 7, 4, "manager", "approved", "request", "7", None), (4, 8, 4, "manager", "approved", "request", "8", None),
            (5, 9, 4, "manager", "approved", "request", "9", None), (6, None, 1, "admin", "policy_saved", "policy", "1", "Version 1.")]
    a = s["audit_event"]
    assert [(e["seq"], e["request_id"], e["actor_id"], e["actor_role"], e["verb"], e["subject_type"], e["subject_id"], e["note"]) for e in a] == want
    for e in a[:5]:
        assert e["occurred_at"] == inst(days[e["request_id"]] + timedelta(days=1), "11:00")
    assert a[5]["occurred_at"] == "2026-04-13T23:00:00Z" and a[0]["prev_hash"] == "0" * 64 and chain_ok(a) is None
    users = {u.get("username", "").lower(): u for u in Keycloak().users()}
    assert set(users) == set(ADDR.values())
    for i, addr, name, *_ in PEOPLE:
        first, last = name.split(" ", 1)
        assert (users[addr].get("firstName"), users[addr].get("lastName"), users[addr].get("email", "").lower()) == (first, last, addr)


def test_business_time_api(fresh):
    b = fresh.copies[1].base
    a = tok(1, b)
    d4 = req("GET", "/api/requests/4", a, base=b).json()
    assert d4["request"]["day"] == "2026-04-02" and d4["request"]["raised_at"] == "2026-04-02T19:00:00Z"
    assert d4["request"]["decided_at"] == "2026-04-03T10:00:00Z" and d4["evidence"]["recorded_in"] == inst("2026-04-02", "09:00")
    d7 = req("GET", "/api/requests/7", a, base=b).json()
    assert d7["request"]["decided_at"] == "2026-03-02T11:00:00Z" and d7["evidence"]["recorded_in"] == inst("2026-03-01", "09:00")
    days = seed_days(date.fromisoformat(FRESH_DAY))
    rows, _ = walk(a, "month=2026-03", base=b)
    assert {r["id"] for r in rows} == {i for i, d in days.items() if month_of(d) == "2026-03"}
    cal = req("GET", "/api/calendar?month=2026-03", a, base=b).json()
    assert {x["day"]: x["counts"]["waiting"] for x in cal["days"]}["2026-03-01"] == 1


def test_one_seeder(fresh):
    assert all(500 not in c.codes and c.proc.poll() is None for c in fresh.copies), fresh.copies[0].tail()
    assert orows("select seeded_on::text d from employer", fresh.url) == [{"d": FRESH_DAY}]
    assert orows("select count(*)::int n from regularisation_request", fresh.url) == [{"n": len(SEED_REQ)}]
    assert orows("select count(*)::int n from audit_event", fresh.url) == [{"n": 6}]
    for c in fresh.copies:
        assert c.health().status_code == 200


def test_late_realm(fresh, app_url, realm_down):
    down = realm_down.rstrip("/")
    r = httpx.get(down + "/login", timeout=HTTP_S)
    assert r.status_code == 200 and "Sign in to Rostara" in text_of(r.text)
    assert "Sign-in is unavailable right now. Try again shortly." in text_of(r.text)
    r = post_json(down, "/api/session", {"work_address": ADDR[5], "password": PW})
    assert r.status_code == 503 and r.json() == {"error": "Sign-in is unavailable right now. Try again shortly."}
    assert fresh.down_health == {"status": "starting", "schema": True, "seeded": True, "realm": False}
    assert fresh.down_login.status_code == 200 and "Sign in to Rostara" in text_of(fresh.down_login.text)
    assert fresh.down_signin.status_code == 503
    assert fresh.signin_status == 200 and fresh.signin_s <= REALM_RETURN_S + SLACK_S and fresh.ready_s <= REALM_RETURN_S + SLACK_S


def test_private_fields(app_url):
    tag = uuid.uuid4().hex
    rid = raise_req(5, pick(5), reason=f"Reader at the side door failed {tag}").json()["id"]
    phone, note = "07700 900105", "Emergency contact held on paper file KW-0005."
    a = req("GET", f"/api/requests/{rid}", tok(1)).json()
    assert a["contact"] == {"phone": phone, "private_note": note}
    assert "Contact on file" in text_of(client(1).get(f"/requests/{rid}").text)
    leaks = [req("GET", f"/api/requests/{rid}", tok(2)), req("GET", f"/api/requests/{rid}", tok(5)),
             req("GET", f"/api/requests?q={tag}", tok(1)), req("GET", f"/api/requests?q={tag}", tok(2)),
             req("GET", "/api/calendar", tok(1)), req("GET", "/api/trail.csv", tok(1)),
             httpx.get(f"{BASE}/share/{shared_token()}", timeout=HTTP_S)]
    assert "contact" not in leaks[0].json() and "contact" not in leaks[1].json()
    pages = [client(2).get(f"/requests/{rid}"), client(5).get(f"/requests/{rid}")]
    for r in leaks + pages:
        assert r.status_code == 200
        assert "07700 9001" not in r.text and "Emergency contact held on paper file" not in r.text
    assert "@example.com" not in leaks[5].text and "@example.com" not in leaks[6].text


def test_reason_and_body_limits(app_url):
    d1, d2, d3 = pick(6, n=3)
    flags = "\U0001F1EC\U0001F1E7"
    r = raise_req(6, d1, reason=flags * REASON_MAX)
    assert q(f"select reason from regularisation_request where id = {r.json()['id']}")[0]["reason"] == flags * REASON_MAX
    r = raise_req(6, d2, reason="\U0001F469\u200d\U0001F4BB" * (REASON_MAX + 1), expect_status=422)
    assert r.json() == {"error": "A reason is limited to 280 characters.", "field": "reason"}
    body = {"day": str(d2), "correction_type": "missed_out", "claimed_in": None, "claimed_out": "18:00", "reason": "Exact size body reason "}
    body["reason"] += " " * (BODY_MAX - len(json.dumps(body).encode()))
    raw = json.dumps(body).encode()
    assert len(raw) == BODY_MAX
    r = req("POST", "/api/requests", tok(6), raw=raw)
    assert r.status_code == 201, r.text
    _MADE.append((BASE, 6, r.json()["id"]))
    body["day"], body["reason"] = str(d3), body["reason"] + " "
    r = req("POST", "/api/requests", tok(6), raw=json.dumps(body).encode())
    assert r.status_code == 413 and r.json() == {"error": "Request body is too large."}
    assert q(f"select count(*)::int n from regularisation_request where person_id = 6 and day::date = '{d3}' and state = 'pending'")[0]["n"] == 0


def test_wf_seed_data_admin_reads_seeded_request(fresh, browser):
    b = fresh.copies[1].base
    day = seed_days(date.fromisoformat(FRESH_DAY))[1].isoformat()
    with open_app(browser, b + "/login") as page:
        ui_login(page, 1, "/requests/1", base=b)
        expect(page.get_by_role("heading", name=f"Correction for {day}", level=1)).to_be_visible()
        expect(page.get_by_text("Not recorded").first).to_be_visible()
        expect(page.get_by_role("heading", name="Contact on file")).to_be_visible()
        phone = "07700 900105"
        expect(page.get_by_text(f"Phone {phone}")).to_be_visible()
    d = req("GET", "/api/requests/1", tok(1, b), base=b).json()
    assert d["request"]["day"] == day and d["evidence"]["recorded_out"] is None


def test_wf_seed_data_manager_sees_no_contact(fresh, browser):
    b = fresh.copies[1].base
    with open_app(browser, b + "/login") as page:
        ui_login(page, 2, "/requests/1", base=b)
        expect(page.get_by_role("heading", name="What the clock recorded")).to_be_visible()
        expect(page.get_by_role("heading", name="Contact on file")).to_have_count(0)
        assert "07700 900105" not in page.content()
    assert "contact" not in req("GET", "/api/requests/1", tok(2, b), base=b).json()


def test_one_refusal(fall):
    uid = uuid.uuid4().hex[:8]
    cases = [(f"nobody-{uid}@example.com", PW), (ADDR[4], f"wrong-{uid}"), (ADDR[16], PW)]
    rs = [post_json(fall.base, "/api/session", {"work_address": a, "password": p}) for a, p in cases]
    for r in rs:
        assert r.status_code == 401 and r.json() == {"error": "Those details do not match an account"}
    hs = [{k: v for k, v in r.headers.items() if k.lower() != "date"} for r in rs]
    assert hs[0] == hs[1] == hs[2]


def test_sign_out(app_url):
    t = login(7)
    assert req("DELETE", "/api/session", t).status_code == 204
    r = req("GET", "/api/requests", t)
    assert r.status_code == 401 and r.json() == SIGNED_OUT
    c = client(7)
    assert c.delete("/api/session").status_code == 204
    r = c.get("/api/session")
    assert r.status_code == 401 and r.json() == SIGNED_OUT


def test_identity_realm_only(app_url):
    body = {"work_address": f"new-{uuid.uuid4().hex[:6]}@example.com", "password": PW}
    for p in ("/api/people", "/api/users", "/api/signup", "/api/register", "/api/accounts"):
        r = req("POST", p, tok(1), body=body)
        assert r.status_code == 404 and r.json() == {"error": "No such endpoint."}
    for p in ("/signup", "/register"):
        assert req("GET", p).status_code == 404
    assert {u.get("username", "").lower() for u in Keycloak().users()} == set(ADDR.values())


def test_signed_out_redirect(app_url):
    r = req("GET", "/")
    assert r.status_code == 303 and r.headers["location"].removeprefix(BASE) == "/login"
    for p in ("/requests", "/requests/new", f"/requests/{UNKNOWN_ID}", "/calendar", "/policy", "/requests/7?state=pending&q=a%25"):
        r = req("GET", p)
        assert r.status_code == 303 and r.headers["location"].removeprefix(BASE) == "/login?next=" + quote(p, safe="")
        assert not any(n in r.text for n in NAME.values())
    r = req("GET", "/requests/7?state=pending&q=a%25")
    assert r.headers["location"].removeprefix(BASE) == "/login?next=%2Frequests%2F7%3Fstate%3Dpending%26q%3Da%2525"
    for p in ("/pricing", "/about", "/package.json", "/.env", "/run.json"):
        r = req("GET", p)
        assert r.status_code == 404 and NOT_FOUND[0] in text_of(r.text)


def test_signin_lockout(fresh, app_url):
    b = fresh.copies[0].base
    uid = uuid.uuid4().hex[:8]
    bodies = []
    for base, addr, lock in [(BASE, f"lock-{uid}@example.com", int(os.environ.get("SIGN_IN_LOCKOUT_SECONDS", LOCK_DEFAULT))),
                             (b, ADDR[13], FRESH_LOCK), (b, ADDR[16], FRESH_LOCK)]:
        for i in range(LOCK_AT):
            r = post_json(base, "/api/session", {"work_address": addr.upper() if i % 2 else addr, "password": "wrong-pw"})
            assert r.status_code == 401
        r = post_json(base, "/api/session", {"work_address": addr, "password": PW})
        assert r.status_code == 429 and 1 <= int(r.headers["retry-after"]) <= lock
        bodies.append(r.json())
    assert bodies[0] == bodies[1] == bodies[2] == {"error": "Too many attempts for this address. Try again later."}
    end = time.monotonic() + FRESH_LOCK + SLACK_S
    while True:
        r = post_json(b, "/api/session", {"work_address": ADDR[13], "password": PW})
        if r.status_code == 200:
            break
        assert r.status_code == 429 and time.monotonic() < end
        fresh.copies[0].pace()


def test_safe_next(app_url):
    c = client(5)
    target = "/requests/3?state=pending&q=a%25"
    r = c.get("/login?next=" + quote(target, safe=""))
    assert r.status_code == 303 and r.headers["location"].removeprefix(BASE) == target
    for bad in [OFF_DESK, "https://evil.example", "/\\evil.example", "/api/audit", "/package.json"]:
        r = c.get("/login?next=" + quote(bad, safe=""))
        assert r.status_code == 303 and r.headers["location"].removeprefix(BASE) == "/requests"
    page = httpx.get(BASE + "/login?next=" + quote(OFF_DESK, safe=""), timeout=HTTP_S)
    assert page.status_code == 200 and "evil.example" not in page.text


def test_session_expiry(app_url):
    c = Copy({"SESSION_IDLE_SECONDS": str(IDLE_S), "SESSION_MAX_SECONDS": str(MAX_S)}).start()
    try:
        c.wait(lambda r: r.status_code == 200)
        a = client(6, c.base)
        a_used = time.monotonic()
        b_start = time.monotonic()
        b = login(7, base=c.base)
        b_end = time.monotonic()
        while time.monotonic() - a_used < IDLE_S:
            assert req("GET", "/api/session", b, base=c.base).status_code == 200
            c.pace()
        stale = dict(a.cookies)
        r = httpx.get(c.base + "/api/requests", cookies=stale, timeout=HTTP_S)
        assert r.status_code == 401 and r.json() == ENDED
        asked = "/requests?state=pending"
        with httpx.Client(base_url=c.base, cookies=stale, timeout=HTTP_S, follow_redirects=False) as br:
            r = br.get(asked)
            loc = r.headers["location"].removeprefix(c.base)
            assert r.status_code == 303 and loc == "/login?next=" + quote(asked, safe="")
            assert "Your session has ended. Sign in again." in text_of(br.get(loc).text)
        while True:
            r = req("GET", "/api/session", b, base=c.base)
            if r.status_code != 200:
                break
            assert time.monotonic() < b_end + MAX_S + SLACK_S
            c.pace()
        assert r.status_code == 401 and r.json() == ENDED and time.monotonic() >= b_start + MAX_S
    finally:
        c.stop()


def test_share_link_lifecycle(app_url):
    m = tok(2)
    month = month_of(seeded())
    r1 = req("POST", "/api/share-links", m, body={"person_id": 5, "month": month})
    assert r1.status_code == 201 and set(r1.json()) == {"id", "token", "person_id", "month", "expires_at"}
    t1 = r1.json()["token"]
    assert len(t1) >= TOKEN_MIN and re.fullmatch(r"[A-Za-z0-9._~-]+", t1)
    g = httpx.get(f"{BASE}/share/{t1}", timeout=HTTP_S)
    head = f"Iris Calder, {seeded().strftime('%B %Y')}"
    assert g.status_code == 200 and head in text_of(g.text) and "Rostara attendance desk. Shared read-only." in text_of(g.text)
    assert g.headers.get("referrer-policy") == "no-referrer"
    for s in (ADDR[5], "07700 900105", "Emergency contact"):
        assert s not in g.text
    w = httpx.post(f"{BASE}/share/{t1}", timeout=HTTP_S)
    assert w.status_code == 403 and w.json() == {"error": "A shared link is read-only."}
    reason = f"Should never be stored {uuid.uuid4().hex}"
    w = post_json(BASE, "/api/requests?" + urlencode({"share": t1}), {"day": str(seeded()), "correction_type": "missed_out", "claimed_in": None,
                                                       "claimed_out": "18:00", "reason": reason}, Authorization=f"Bearer {tok(5)}")
    assert w.status_code == 403 and q(f"select count(*)::int n from regularisation_request where reason = '{reason}'")[0]["n"] == 0
    r2 = req("POST", "/api/share-links", m, body={"person_id": 5, "month": month})
    assert r2.status_code == 201
    dead = httpx.get(f"{BASE}/share/{t1}", timeout=HTTP_S)
    assert dead.status_code == 410 and "This shared month is no longer available" in text_of(dead.text) and "Iris" not in dead.text
    assert httpx.get(f"{BASE}/share/{r2.json()['token']}", timeout=HTTP_S).status_code == 200
    assert req("DELETE", f"/api/share-links/{r2.json()['id']}", m).status_code == 204
    assert httpx.get(f"{BASE}/share/{r2.json()['token']}", timeout=HTTP_S).status_code == 410
    r = req("DELETE", f"/api/share-links/{r2.json()['id']}", m)
    assert r.status_code == 409 and r.json() == {"error": "That link no longer works."}
    assert NOT_FOUND[0] in text_of(httpx.get(f"{BASE}/share/{'x' * TOKEN_MIN}", timeout=HTTP_S).text)
    assert httpx.get(f"{BASE}/share/{'x' * TOKEN_MIN}", timeout=HTTP_S).status_code == 404
    r = req("POST", "/api/share-links", tok(5), body={"person_id": 5, "month": month})
    assert r.status_code == 403 and r.json() == {"error": "Only managers and people operations share a month."}
    for t, pid in ((m, 9), (tok(1), 16)):
        r = req("POST", "/api/share-links", t, body={"person_id": pid, "month": month})
        assert r.status_code == 404 and r.json() == {"error": "No such person."}


def test_share_link_expiry_and_throttle(app_url):
    recent = lambda pid: q(f"select count(*)::int n from share_link where minted_by = {pid} and minted_at > now() - interval '{MINT_WINDOW_MIN} minutes'")[0]["n"]
    quota = max(recent(4), recent(3)) + 2
    c = Copy({"SHARE_LINK_TTL_SECONDS": str(TTL_S), "SHARE_LINK_MINTS": str(quota)}).start()
    month = month_of(seeded())
    try:
        c.wait(lambda r: r.status_code == 200)
        lena, last = tok(4, c.base), None
        for _ in range(quota - recent(4)):
            r = req("POST", "/api/share-links", lena, base=c.base, body={"person_id": 13, "month": month})
            assert r.status_code == 201, r.text
            last = r.json()["token"]
        r = req("POST", "/api/share-links", lena, base=c.base, body={"person_id": 13, "month": month})
        assert r.status_code == 429 and r.json() == {"error": "Too many shared links for now. Try again later."}
        assert int(r.headers["retry-after"]) >= 1
        r = req("POST", "/api/share-links", tok(3, c.base), base=c.base, body={"person_id": 9, "month": month})
        assert r.status_code == 201
        t9 = r.json()["token"]
        assert httpx.get(f"{c.base}/share/{t9}", timeout=HTTP_S).status_code == 200
        end = time.monotonic() + TTL_S + SLACK_S
        while (s := httpx.get(f"{c.base}/share/{t9}", timeout=HTTP_S).status_code) == 200:
            assert time.monotonic() < end
            c.pace()
        assert s == 410
        assert psql("update person set manager_id = 2 where id = 13").returncode == 0
        try:
            if last:
                assert httpx.get(f"{BASE}/share/{last}", timeout=HTTP_S).status_code == 410
        finally:
            psql("update person set manager_id = 4 where id = 13")
    finally:
        c.stop()


def test_session_rotation_and_folding(app_url):
    t1 = login(6)
    r = post_json(BASE, "/api/session", {"work_address": ADDR[6], "password": PW}, Authorization=f"Bearer {t1}")
    assert r.status_code == 200 and r.json()["token"] != t1
    old = req("GET", "/api/session", t1)
    assert old.status_code == 401 and old.json() == ENDED
    assert req("GET", "/api/session", r.json()["token"]).status_code == 200
    wide = "".join(chr(ord(ch) + 0xFEE0) if "!" <= ch <= "~" else ch for ch in ADDR[6])
    for spell in (ADDR[6].upper(), wide):
        r = post_json(BASE, "/api/session", {"work_address": spell, "password": PW})
        assert r.status_code == 200 and r.json()["person"]["work_address"] == ADDR[6]
    r = post_json(BASE, "/api/session", {"work_address": "adm\u0456n@example.com", "password": PW})
    assert r.status_code == 401 and r.json() == {"error": "Those details do not match an account"}


def test_wf_sign_in_deep_link(page, app_url):
    page.context.clear_cookies()
    asked = "/requests?state=pending"
    page.goto(BASE + asked)
    expect(page).to_have_url(BASE + "/login?next=" + quote(asked, safe=""))
    assert not any(n in page.content() for n in NAME.values())
    page.get_by_role("textbox", name="Work address").fill(ADDR[2].upper())
    page.get_by_label("Password").fill(PW)
    page.get_by_role("button", name="Sign in").click()
    expect(page).to_have_url(BASE + "/requests?state=pending")
    expect(page.get_by_role("banner")).to_contain_text("Manager")
    r = page.request.get(BASE + "/api/session")
    assert r.status == 200 and r.json()["role"] == "manager"


def test_wf_sign_in_unsafe_next(page, app_url):
    page.context.clear_cookies()
    page.goto(BASE + "/login?next=" + quote(OFF_DESK, safe=""))
    page.get_by_role("textbox", name="Work address").fill(ADDR[5])
    page.get_by_label("Password").fill(PW)
    page.get_by_role("button", name="Sign in").click()
    expect(page).to_have_url(BASE + "/requests")
    expect(page.get_by_role("banner")).to_contain_text("Employee")
    assert page.request.get(BASE + "/api/session").json()["role"] == "employee"


def test_wf_sign_in_sign_out(page, app_url):
    ui_login(page, 8)
    page.get_by_role("button", name="Sign out").click()
    expect(page).to_have_url(re.compile(re.escape(BASE + "/login")))
    announced(page, "status", "You are signed out.")
    assert page.request.get(BASE + "/api/session").status == 401


def test_employee_refusals(app_url):
    rid = raise_req(5, pick(5)).json()["id"]
    t = tok(6)
    for r in (req("GET", f"/api/requests/{rid}", t), decide(6, rid, "approve"), req("POST", f"/api/requests/{rid}/cancel", t)):
        assert r.status_code == 404 and r.json() == NO_SUCH_REQ
    v = req("GET", "/api/policy", t).json()["version"]
    r = req("PUT", "/api/policy", t, body={"monthly_cap": 1}, headers={"If-Match": f'"{v}"'})
    assert r.status_code == 403 and r.json() == {"error": "Only people operations changes the policy."}
    assert stored(rid)["state"] == "pending" and stored(rid)["decided_by"] is None
    assert q("select max(version)::int v from policy")[0]["v"] == v


def test_manager_limits(app_url):
    rid = raise_req(9, pick(9)).json()["id"]
    m = tok(2)
    for r in (req("GET", f"/api/requests/{rid}", m), decide(2, rid, "approve"), req("POST", f"/api/requests/{rid}/cancel", m)):
        assert r.status_code == 404 and r.json() == NO_SUCH_REQ
    assert req("GET", f"/api/requests/{rid}", tok(3)).status_code == 200
    v = req("GET", "/api/policy", m).json()["version"]
    assert req("PUT", "/api/policy", m, body={"monthly_cap": 1}, headers={"If-Match": f'"{v}"'}).status_code == 403
    assert stored(rid)["state"] == "pending"


def test_no_self_decision(app_url):
    for pid in (2, 5):
        rid = raise_req(pid, pick(pid)).json()["id"]
        for outcome in ("approve", "reject"):
            r = decide(pid, rid, outcome, "Deciding my own request")
            assert r.status_code == 403 and r.json() == {"error": "You cannot decide a request you raised."}
        assert stored(rid)["state"] == "pending"


def test_admin_never_decides(page, app_url):
    rid = raise_req(5, pick(5)).json()["id"]
    for outcome in ("approve", "reject"):
        r = decide(1, rid, outcome, "People operations decision")
        assert r.status_code == 403 and r.json() == {"error": "People operations does not decide requests."}
    assert stored(rid)["state"] == "pending"
    ui_login(page, 1, f"/requests/{rid}")
    expect(page.get_by_role("heading", name="What the clock recorded")).to_be_visible()
    expect(page.get_by_role("button", name="Approve")).to_have_count(0)
    expect(page.get_by_role("button", name="Reject")).to_have_count(0)


def test_unauthenticated_calls(app_url):
    eps = [("GET", "/api/session"), ("DELETE", "/api/session"), ("GET", "/api/requests"), ("POST", "/api/requests"),
           ("GET", "/api/requests/1"), ("POST", "/api/requests/1/decision"), ("POST", "/api/requests/1/cancel"),
           ("GET", "/api/policy"), ("PUT", "/api/policy"), ("GET", "/api/policy/history"), ("GET", "/api/audit"),
           ("GET", "/api/trail.csv"), ("GET", "/api/trail/verify"), ("GET", "/api/calendar"), ("POST", "/api/share-links"),
           ("DELETE", "/api/share-links/1")]
    for method, path in eps:
        for t in (None, "forged-" + uuid.uuid4().hex):
            r = req(method, path, t, body={} if method in ("POST", "PUT") else None)
            assert r.status_code == 401 and r.json() == SIGNED_OUT, (method, path)


def test_wrong_role_page(app_url):
    for pid, path in ((5, "/calendar"), (5, "/policy"), (2, "/policy"), (1, "/requests/new")):
        r = client(pid).get(path)
        assert r.status_code == 403 and "Your role does not have access to this page." in text_of(r.text)


def test_scope_by_relationship(app_url):
    cnt = lambda w: q(f"select count(*)::int n from regularisation_request where {w}")[0]["n"]
    rows, r = walk(tok(5))
    assert r["total"] == cnt("person_id = 5") and {x["person"] for x in rows} <= {"Iris Calder"}
    rows, r = walk(tok(2))
    assert r["total"] == cnt("person_id = 2 or person_id in (select id from person where manager_id = 2)")
    assert {x["person"] for x in rows} <= {NAME[i] for i in (2, 5, 6, 7, 8)}
    assert req("GET", "/api/requests", tok(1)).json()["total"] == cnt("true")


def test_status_ladder(app_url):
    r = req("POST", "/api/nope?share=abc")
    assert r.status_code == 403 and r.json() == {"error": "A shared link is read-only."}
    r = req("POST", "/api/requests", raw=b"{broken")
    assert r.status_code == 401
    r = req("POST", "/api/requests", tok(1), body={"day": "bad", "person_id": 3})
    assert r.status_code == 403 and r.json() == {"error": "People operations does not raise corrections."}
    assert req("PUT", "/api/policy", tok(5), body={"monthly_cap": "x"}).status_code == 403
    r = req("PUT", "/api/policy", tok(1), body={"monthly_cap": "x"})
    assert r.status_code == 428 and r.json() == {"error": "Send If-Match with the policy version you are changing."}
    rid = raise_req(5, pick(5)).json()["id"]
    assert req("POST", f"/api/requests/{rid}/cancel", tok(5)).status_code == 200
    r = decide(2, rid, "maybe")
    assert r.status_code == 409 and r.json() == {"error": "This request was withdrawn and can no longer be decided."}
    far = seeded() - timedelta(days=DEFAULT_LOOKBACK + 5)
    r = raise_req(5, far, ctype="teleport", expect_status=400)
    assert r.json() == {"error": "Unknown correction type: teleport.", "field": "correction_type"}
    r = raise_req(5, far, expect_status=422)
    assert set(r.json()) == {"error"} and isinstance(r.json()["error"], str)


def test_published_fields_only(app_url):
    d = pick(5)
    reason = f"Mass assignment probe {uuid.uuid4().hex}"
    r = post_json(BASE, "/api/requests", {"day": str(d), "correction_type": "missed_out", "claimed_out": "18:00", "reason": reason,
                                          "person_id": 6}, Authorization=f"Bearer {tok(5)}")
    assert r.status_code == 400 and r.json() == {"error": "person_id cannot be set here.", "field": "person_id"}
    assert q(f"select count(*)::int n from regularisation_request where reason = '{reason}'")[0]["n"] == 0
    rid = raise_req(5, d).json()["id"]
    r = post_json(BASE, f"/api/requests/{rid}/decision", {"outcome": "approve", "state": "approved"}, Authorization=f"Bearer {tok(2)}")
    assert r.status_code == 400 and r.json() == {"error": "state cannot be set here.", "field": "state"}
    assert stored(rid)["state"] == "pending"
    cur = req("GET", "/api/policy", tok(1))
    body = {k: cur.json()[k] for k in ("monthly_cap", "lookback_days", "enabled_types", "require_note_on_approve")}
    r = req("PUT", "/api/policy", tok(1), body={**body, "version": 99}, headers={"If-Match": cur.headers["ETag"]})
    assert r.status_code == 400 and r.json() == {"error": "version cannot be set here.", "field": "version"}
    assert q("select max(version)::int v from policy")[0]["v"] == cur.json()["version"]
    n = q("select count(*)::int n from share_link")[0]["n"]
    r = req("POST", "/api/share-links", tok(2), body={"person_id": 5, "month": month_of(seeded()), "expires_at": "2099-01-01T00:00:00Z"})
    assert r.status_code == 400 and r.json() == {"error": "expires_at cannot be set here.", "field": "expires_at"}
    assert q("select count(*)::int n from share_link")[0]["n"] == n
    r = post_json(BASE, "/api/session", {"work_address": ADDR[5], "password": PW, "role": "admin"})
    assert r.status_code == 400 and r.json() == {"error": "role cannot be set here.", "field": "role"}


LEAK = re.compile(r"(?i)(\bat\s+\S+\.(js|mjs|ts):\d+|select\s.+\sfrom|insert\s+into|syntax error|node_modules|violates|ECONN|duplicate key)")


def test_hostile_values(app_url):
    seen = []
    for x in ("0", "-1", "01", "1.0", "1e3", "9223372036854775808", "abc"):
        r = req("GET", f"/api/requests/{x}", tok(1))
        seen.append(r)
        assert r.status_code == 404 and r.json() == NO_SUCH_REQ
        assert client(1).get(f"/requests/{x}").status_code == 404
    d = pick(5)
    base = {"day": str(d), "correction_type": "missed_out", "claimed_in": None, "claimed_out": "18:00"}
    r = post_json(BASE, "/api/requests", {**base, "reason": "Reader \u0000 failed at the gate"}, Authorization=f"Bearer {tok(5)}")
    assert r.status_code == 400 and r.json() == {"error": "reason cannot contain a NUL character.", "field": "reason"}
    seen.append(r)
    nest = lambda n: [] if n == 0 else [nest(n - 1)]
    for raw in (b"{broken", b"[1]", json.dumps({**base, "reason": nest(DEPTH_MAX)}).encode()):
        r = req("POST", "/api/requests", tok(5), raw=raw)
        seen.append(r)
        assert r.status_code == 400 and r.json() == {"error": "The body must be a JSON object."}
    r = req("POST", "/api/requests", tok(5), raw=json.dumps({**base, "reason": nest(DEPTH_MAX - 2)}).encode())
    assert r.status_code == 400 and r.json() == {"error": "reason must be text.", "field": "reason"}
    r = req("POST", "/api/requests", tok(5), raw=b"{}", ctype="text/plain")
    assert r.status_code == 400 and r.json() == {"error": "Send the body as application/json."}
    r = req("GET", "/api/requests?state=%00", tok(5))
    assert r.status_code == 400 and r.json() == {"error": "state cannot contain a NUL character.", "field": "state"}
    for r in seen + [r]:
        assert not LEAK.search(r.text)


def test_sickness_as_absence(app_url):
    d = seeded() - timedelta(days=9)
    row = q(f"select id from regularisation_request where person_id = 6 and day::date = '{d}' and state = 'pending'")
    rid = row[0]["id"] if row else raise_req(6, d).json()["id"]
    r = req("GET", f"/api/requests/{rid}", tok(2))
    assert r.json()["leave"] == {"kind": "absence", "status": "pending"} and "sickness" not in r.text.lower()
    assert "sickness" not in req("GET", "/api/requests", tok(2)).text.lower()
    html = client(2).get(f"/requests/{rid}").text
    assert "sickness" not in html.lower() and "Absence" + ", pending" in text_of(html)
    for s in scripts_of(html, BASE):
        assert "sickness" not in s.lower()
    for pid in (6, 1):
        assert req("GET", f"/api/requests/{rid}", tok(pid)).json()["leave"] == {"kind": "sickness", "status": "pending"}
    assert "Sickness" + ", pending" in text_of(client(6).get(f"/requests/{rid}").text)


def test_wf_authorization_manager_scope(page, app_url):
    rid = raise_req(9, pick(9)).json()["id"]
    ui_login(page, 2)
    qd = req("GET", "/api/requests", tok(2)).json()
    expect(page.get_by_role("table", name=f"{qd['matched']} of {qd['total']} requests")).to_be_visible()
    page.goto(f"{BASE}/requests/{rid}")
    expect(page.get_by_role("heading", name=NOT_FOUND[0])).to_be_visible()
    assert "Suri Patel" not in page.content()
    assert req("GET", f"/api/requests/{rid}", tok(2)).status_code == 404


def test_wf_authorization_employee_wrong_role(page, app_url):
    ui_login(page, 5)
    expect(page.get_by_role("button", name="Share this month")).to_have_count(0)
    page.goto(BASE + "/calendar")
    expect(page.get_by_text("Your role does not have access to this page.")).to_be_visible()
    r = req("GET", "/api/calendar", tok(5))
    assert r.status_code == 403 and r.json() == {"error": "Only managers and people operations read the calendar."}


def test_scope_before_filters(app_url):
    m = tok(2)
    total = req("GET", "/api/requests", m).json()["total"]
    r = req("GET", f"/api/requests?person={ADDR[9]}", m).json()
    assert r["rows"] == [] and r["matched"] == 0 and r["total"] == total
    rows, r = walk(m, f"person={ADDR[6].upper()}")
    assert {x["person"] for x in rows} <= {"Tomas Berg"}
    assert r["matched"] == q("select count(*)::int n from regularisation_request where person_id = 6")[0]["n"]


def test_queue_counts(app_url):
    a = tok(1)
    r = req("GET", "/api/requests", a).json()
    assert {"rows", "matched", "total", "page", "pages"} <= set(r) and len(r["rows"]) <= PAGE_SIZE
    assert r["pages"] == max(1, math.ceil(r["matched"] / PAGE_SIZE)) and r["page"] == 1
    last = req("GET", f"/api/requests?page={r['pages']}", a).json()
    beyond = req("GET", f"/api/requests?page={r['pages'] + 1}", a).json()
    assert beyond["page"] == r["pages"] and [x["id"] for x in beyond["rows"]] == [x["id"] for x in last["rows"]]
    assert len(last["rows"]) == r["matched"] - PAGE_SIZE * (r["pages"] - 1)


def test_queue_order(app_url):
    a = tok(1)
    keys = {"": lambda x: (x["state"] != "pending", x["raised_at"], x["id"]),
            "sort=day": lambda x: (-date.fromisoformat(x["day"]).toordinal(), x["id"]),
            "sort=raised": lambda x: (x["raised_at"], x["id"]),
            "sort=person": lambda x: (x["person"].lower(), x["id"])}
    for params, key in keys.items():
        rows, _ = walk(a, params)
        ks = [key(x) for x in rows]
        assert ks == sorted(ks), params


def test_filters_and_search(app_url):
    tag = uuid.uuid4().hex[:10]
    d1, d2 = pick(7, n=2)
    id1 = raise_req(7, d1, reason=f"Reader was 100% wrong today {tag}").json()["id"]
    id2 = raise_req(7, d2, reason=f"Reader showed snake_case today {tag}").json()["id"]
    t = tok(7)
    rows, _ = walk(t, "q=%25")
    assert all("%" in x["reason"] for x in rows) and id1 in {x["id"] for x in rows} and id2 not in {x["id"] for x in rows}
    rows, _ = walk(t, "q=_")
    assert all("_" in x["reason"] for x in rows) and id2 in {x["id"] for x in rows}
    rows, _ = walk(t, f"q={tag.upper()}")
    assert {x["id"] for x in rows} == {id1, id2}
    rows, _ = walk(t, f"state=pending&type=missed_out&month={month_of(d1)}")
    assert id1 in {x["id"] for x in rows}
    assert all(x["state"] == "pending" and x["correction_type"] == "missed_out" and x["day"][:7] == month_of(d1) for x in rows)
    for param, v in (("state", "open"), ("type", "bogus"), ("month", "2026-13"), ("sort", "name")):
        r = req("GET", f"/api/requests?{param}={v}", t)
        assert r.status_code == 400 and r.json() == {"error": f"Unknown {param} value: {v}.", "field": param}
    auth = {"Authorization": f"Bearer {t}"}
    r = httpx.get(BASE + "/api/requests", params={"q": "x" * (Q_MAX + 1)}, headers=auth, timeout=HTTP_S)
    assert r.status_code == 400 and r.json() == {"error": "Search is limited to 100 characters.", "field": "q"}
    for v in ("x" * Q_MAX, " " + "x" * Q_MAX + " "):
        assert httpx.get(BASE + "/api/requests", params={"q": v}, headers=auth, timeout=HTTP_S).status_code == 200


def test_stable_paging(app_url):
    a = tok(1)
    for params in ("", "sort=day", "sort=raised", "sort=person", "state=pending"):
        rows, r = walk(a, params)
        ids = [x["id"] for x in rows]
        assert len(ids) == len(set(ids)) == r["matched"], params
    for v in ("0", "-1", "+2", "02", "2.0", " 2", "\uff12"):
        r = httpx.get(BASE + "/api/requests", params={"page": v}, headers={"Authorization": f"Bearer {a}"}, timeout=HTTP_S)
        assert r.status_code == 400 and r.json() == {"error": f"Unknown page value: {v}.", "field": "page"}


def test_live_reporting_lines(app_url):
    rid = raise_req(7, pick(7)).json()["id"]
    dara, omar, lena_c = tok(2), tok(3), client(4)
    tomas = login(6)
    month = month_of(seeded())
    before = req("GET", "/api/requests", dara).json()["total"]
    nadia_n = q("select count(*)::int n from regularisation_request where person_id = 7")[0]["n"]
    try:
        assert psql("update person set manager_id = 3 where id = 7").returncode == 0
        rows, r = walk(dara)
        assert "Nadia Kerr" not in {x["person"] for x in rows} and r["total"] == before - nadia_n
        assert req("GET", f"/api/requests/{rid}", dara).status_code == 404
        assert "Nadia Kerr" not in {p["name"] for p in req("GET", f"/api/calendar?month={month}", dara).json()["people"]}
        assert req("GET", f"/api/requests/{rid}", omar).status_code == 200
        assert "Nadia Kerr" in {p["name"] for p in req("GET", f"/api/calendar?month={month}", omar).json()["people"]}
        assert psql("update person set role = 'employee' where id = 4").returncode == 0
        assert lena_c.get("/api/calendar").status_code == 403 and lena_c.get("/calendar").status_code == 403
        assert psql("update person set active = false where id = 6").returncode == 0
        r = req("GET", "/api/requests", tomas)
        assert r.status_code == 401 and r.json() == ENDED
    finally:
        psql("update person set manager_id = 2 where id = 7")
        psql("update person set role = 'manager' where id = 4")
        psql("update person set active = true where id = 6")


def test_wf_queue_api_percent_search(page, app_url):
    raise_req(8, pick(8), reason=f"Reader was 50% asleep {uuid.uuid4().hex}")
    ui_login(page, 1)
    box = page.get_by_role("searchbox", name="Search reasons")
    box.fill("%")
    box.press("Enter")
    expect(page).to_have_url(BASE + "/requests?q=%25")
    r = req("GET", "/api/requests?q=%25", tok(1)).json()
    expect(page.get_by_role("table", name=f"{r['matched']} of {r['total']} requests")).to_be_visible()
    rows, _ = walk(tok(1), "q=%25")
    assert rows and all("%" in x["reason"] for x in rows)


def test_wf_queue_api_filter_sheet(page, app_url):
    ui_login(page, 2)
    page.get_by_role("button", name="Filters").click()
    sheet = page.get_by_role("dialog", name="Narrow the queue")
    select(sheet.get_by_role("combobox", name="Correction"), "Night shift recorded against the wrong day")
    sheet.get_by_role("button", name="Apply filters").click()
    expect(page).to_have_url(BASE + "/requests?type=night_shift")
    r = req("GET", "/api/requests?type=night_shift", tok(2)).json()
    expect(page.get_by_role("table", name=f"{r['matched']} of {r['total']} requests")).to_be_visible()


def test_breadcrumb(page, app_url):
    d = pick(5)
    rid = raise_req(5, d).json()["id"]
    for pid, path, last in ((5, "/requests", "Regularisation requests"), (5, "/requests/new", "Raise a correction"),
                            (5, f"/requests/{rid}", f"Correction for {d}"), (1, "/calendar", "Team calendar"),
                            (1, "/policy", "Correction policy")):
        ui_login(page, pid, path)
        nav = page.get_by_role("navigation", name="Breadcrumb")
        expect(nav.get_by_role("link", name="Desk")).to_be_visible()
        expect(nav).to_contain_text(last)


def test_queue_table(page, app_url):
    ui_login(page, 1)
    r = req("GET", "/api/requests", tok(1)).json()
    table = page.get_by_role("table", name=f"{r['matched']} of {r['total']} requests")
    expect(table).to_be_visible()
    heads = [h.strip() for h in table.get_by_role("columnheader").all_inner_texts()]
    assert heads == ["State", "Person", "Day", "Correction", "Claimed", "Recorded", "Raised", "Action"]
    widths = table.get_by_role("cell").first.evaluate(
        "e => ['1', '0'].map(d => { const s = document.createElement('span'); s.textContent = d.repeat(8);"
        " e.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; })")
    assert abs(widths[0] - widths[1]) < 1


def test_empty_situations(page, fresh, browser, app_url):
    ui_login(page, 1, f"/requests?q={uuid.uuid4().hex}")
    expect(page.get_by_text("No requests match these filters. Clear them to see the full queue.")).to_be_visible()
    expect(page.get_by_role("link", name="Clear filters")).to_be_visible()
    with held(page, "**/api/requests*") as h:
        page.goto(BASE + "/requests")
        announced(page, "status", "Loading requests")
        h.release()
    page.route("**/api/requests*", lambda route: route.abort())
    page.goto(BASE + "/requests")
    expect(page.get_by_text("The queue could not be loaded. Try again.")).to_be_visible()
    expect(page.get_by_role("button", name="Try again")).to_be_visible()
    b = fresh.copies[1].base
    with open_app(browser, b + "/login") as p2:
        ui_login(p2, 15, base=b)
        expect(p2.get_by_text("You have not raised a correction yet.")).to_be_visible()


def test_not_found_page(app_url):
    rid = raise_req(9, pick(9)).json()["id"]
    c = client(2)
    a, b = c.get(f"/requests/{UNKNOWN_ID}"), c.get(f"/requests/{rid}")
    assert a.status_code == b.status_code == 404 and text_of(a.text) == text_of(b.text)
    assert "Suri Patel" not in b.text
    for r in (a, httpx.get(f"{BASE}/share/{'z' * TOKEN_MIN}", timeout=HTTP_S), httpx.get(BASE + "/no-such-route", timeout=HTTP_S)):
        assert r.status_code == 404 and all(s in text_of(r.text) for s in NOT_FOUND)


def test_queue_state_in_url(page, app_url):
    tag = uuid.uuid4().hex[:10]
    rid = raise_req(8, pick(8), reason=f"Side door reader skipped {tag}").json()["id"]
    qs = f"state=pending&q={tag}&sort=person"
    ui_login(page, 1, f"/requests?{qs}")
    page.get_by_role("link", name=f"Open request {rid}").click()
    expect(page).to_have_url(f"{BASE}/requests/{rid}?{qs}")
    desk = page.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name="Desk")
    expect(desk).to_have_attribute("href", f"/requests?{qs}")
    page.reload()
    expect(page.get_by_role("searchbox", name="Search reasons")).to_have_value(tag)
    expect(page.get_by_role("radio", name="Pending")).to_be_checked()
    page.go_back()
    expect(page).to_have_url(f"{BASE}/requests?{qs}")
    expect(page.get_by_role("table", name=re.compile(r"^1 of \d+ requests$"))).to_be_visible()
    page.get_by_role("radio", name="Approved").click()
    expect(page).to_have_url(f"{BASE}/requests?state=approved&q={tag}&sort=person")


def test_focus_round_trip(page, app_url):
    tag = uuid.uuid4().hex[:10]
    d = pick(8)
    rid = raise_req(8, d, reason=f"Front reader skipped {tag}").json()["id"]
    ui_login(page, 1, f"/requests?q={tag}")
    page.get_by_role("radio", name="All").focus()
    for key, name in (("ArrowRight", "Pending"), ("End", "Cancelled"), ("Home", "All"), ("ArrowLeft", "Cancelled"), ("ArrowDown", "All")):
        page.keyboard.press(key)
        expect(page.get_by_role("radio", name=name)).to_be_focused()
    expect(page).to_have_url(f"{BASE}/requests?q={tag}")
    page.get_by_role("link", name=f"Open request {rid}").click()
    expect(page.get_by_role("heading", name=f"Correction for {d}")).to_be_focused()
    page.go_back()
    expect(page.get_by_role("link", name=f"Open request {rid}")).to_be_focused()


def test_conflict_settles_on_winner(page, app_url):
    tag = uuid.uuid4().hex[:10]
    rid = raise_req(5, pick(5), reason=f"Loading bay reader skipped {tag}").json()["id"]
    ui_login(page, 2, f"/requests/{rid}?q={tag}")
    page.evaluate("window.__noReload = 1")
    row = row_of(page, rid)
    with held(page, "**/decision") as h:
        page.get_by_role("button", name="Approve").click()
        expect(row).to_contain_text(re.compile("pending", re.I))
        expect(page.get_by_role("button", name="Approve")).to_be_disabled()
        win = decide(2, rid, "reject", REJECT_NOTE)
        assert win.status_code == 200
        h.release()
    when = london_date(win.json()["decided_at"])
    announced(page, "alert", f"Dara Finch already decided this on {when}.")
    expect(row).to_contain_text(re.compile("rejected", re.I))
    expect(page.get_by_role("button", name="Approve")).to_have_count(0)
    expect(page.get_by_role("button", name="Withdraw")).to_have_count(0)
    assert page.evaluate("window.__noReload") == 1 and stored(rid)["state"] == "rejected"


def test_wf_queue_surface_queue_beside_detail(page, app_url):
    tag = uuid.uuid4().hex[:10]
    d = pick(5)
    rid = raise_req(5, d, reason=f"North gate reader skipped {tag}").json()["id"]
    page.set_viewport_size({"width": TIERS["wide"][0], "height": TIERS["wide"][1]})
    for pid in (5, 2, 1):
        ui_login(page, pid, f"/requests?q={tag}")
        page.get_by_role("link", name=f"Open request {rid}").click()
        head = page.get_by_role("heading", name=f"Correction for {d}")
        table = page.get_by_role("table", name=re.compile(r"of \d+ requests"))
        expect(head).to_be_visible()
        expect(table).to_be_visible()
        assert head.bounding_box()["x"] > table.bounding_box()["x"]
        assert req("GET", f"/api/requests/{rid}", tok(pid)).json()["request"]["id"] == rid


def test_wf_queue_surface_unknown_request(page, app_url):
    ui_login(page, 5)
    page.goto(f"{BASE}/requests/{UNKNOWN_ID}")
    expect(page.get_by_role("heading", name=NOT_FOUND[0])).to_be_visible()
    page.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name="Desk").click()
    expect(page).to_have_url(BASE + "/requests")
    assert req("GET", f"/api/requests/{UNKNOWN_ID}", tok(5)).status_code == 404


TYPE_CASES = {"missed_in": (9, "09:00", None), "missed_out": (10, None, "18:00"), "offsite": (11, "09:00", "18:00"),
              "whole_day": (12, "09:00", "18:00"), "night_shift": (13, "22:00", "06:00")}


@pytest.mark.parametrize("ctype", list(TYPE_CASES), ids=list(TYPE_CASES))
def test_five_corrections(app_url, ctype):
    ensure_policy()
    pid, cin, cout = TYPE_CASES[ctype]
    d = pick(pid)
    r = raise_req(pid, d, ctype=ctype, cin=cin, cout=cout).json()
    assert (r["state"], r["day"], r["correction_type"], r["claimed_in"], r["claimed_out"]) == ("pending", str(d), ctype, cin, cout)
    s = q(f"select state::text, left(claimed_in::text, 5) ci, left(claimed_out::text, 5) co from regularisation_request where id = {r['id']}")[0]
    assert s == {"state": "pending", "ci": cin, "co": cout}


def test_raise_checks(app_url):
    ensure_policy()
    extra = (f"and (select i from a where a.d = g) > (g + time '05:00') {L_} and (select o from a where a.d = g) < (g + time '20:00') {L_}"
             f" and (select i from a where a.d = g + 1) < (g + 1 + time '11:00') {L_}")
    d = pick(11, extra=extra)
    nd = d + timedelta(days=1)
    tag = uuid.uuid4().hex
    R = lambda **kw: raise_req(11, kw.pop("day", d), reason=kw.pop("reason", f"Reader fault on the gate {tag}"), expect_status=None, **kw)
    cases = [(dict(day="2026-02-30"), 400, {"error": "day must read YYYY-MM-DD.", "field": "day"}),
             (dict(ctype="teleport"), 400, {"error": "Unknown correction type: teleport.", "field": "correction_type"}),
             (dict(cin="9am"), 400, {"error": "claimed_in must read HH:MM.", "field": "claimed_in"}),
             (dict(reason="Too short"), 400, {"error": "A reason needs at least twenty characters.", "field": "reason"}),
             (dict(ctype="offsite", cin="18:00", cout="09:00"), 400, {"error": "The sign-out must come after the sign-in.", "field": "claimed_out"}),
             (dict(ctype="night_shift", cin="06:00", cout="22:00"), 400, {"error": "A night shift must end on the following day.", "field": "claimed_out"}),
             (dict(day=seeded() - timedelta(days=DEFAULT_LOOKBACK + 1)), 422, {"error": "That day is outside the 30 day correction window."}),
             (dict(day=seeded() + timedelta(days=1)), 422, {"error": "That day is outside the 30 day correction window."}),
             (dict(ctype="missed_in", cin="20:00", cout=None), 422, {"error": "The claimed sign-in must come before the recorded sign-out.", "field": "claimed_in"}),
             (dict(cin=None, cout="05:00"), 422, {"error": "The claimed sign-out must come after the recorded sign-in.", "field": "claimed_out"}),
             (dict(ctype="night_shift", cin="22:00", cout="11:00"), 422, {"error": f"A night shift cannot end after the sign-in recorded on {nd}.", "field": "claimed_out"})]
    for kw, status, body in cases:
        r = R(**kw)
        assert (r.status_code, r.json()) == (status, body), kw
    r = post_json(BASE, "/api/requests", {"day": str(d), "correction_type": "missed_out", "claimed_out": "18:00"}, Authorization=f"Bearer {tok(11)}")
    assert r.status_code == 400 and r.json() == {"error": "reason is required.", "field": "reason"}
    ensure_policy(types=[t for t in TYPES if t != "offsite"])
    try:
        r = R(ctype="offsite")
        assert r.status_code == 422 and r.json() == {"error": "That correction type is not currently accepted."}
    finally:
        ensure_policy()
    assert R().status_code == 201
    r = R()
    assert r.status_code == 409 and r.json() == {"error": f"You already have a correction waiting on {d}."}
    assert q(f"select count(*)::int n from regularisation_request where person_id = 11 and reason like '%{tag}'")[0]["n"] == 1


def test_monthly_cap(app_url):
    ensure_policy()
    days = free_days(12)
    by_month = {}
    for d in days:
        by_month.setdefault(month_of(d), []).append(d)
    month, (d1, d2) = next((m, ds[:2]) for m, ds in by_month.items() if len(ds) >= 2)
    used = q(f"select count(*)::int n from regularisation_request where person_id = 12 and state in ('approved', 'pending') and to_char(day::date, 'YYYY-MM') = '{month}'")[0]["n"]
    try:
        ensure_policy(cap=used + 1)
        raise_req(12, d1)
        r = raise_req(12, d2, expect_status=422)
        assert r.json() == {"error": f"You have {used + 1} of {used + 1} corrections approved or waiting in {month}."}
        assert q(f"select count(*)::int n from regularisation_request where person_id = 12 and day::date = '{d2}' and state = 'pending'")[0]["n"] == 0
    finally:
        ensure_policy()


def test_withdraw(app_url):
    ensure_policy()
    d = pick(14)
    rid = raise_req(14, d).json()["id"]
    r = req("POST", f"/api/requests/{rid}/cancel", tok(4))
    assert r.status_code == 403 and r.json() == {"error": "Only the person who raised a request can withdraw it."}
    assert req("POST", f"/api/requests/{rid}/cancel", tok(5)).status_code == 404
    r = req("POST", f"/api/requests/{rid}/cancel", tok(14))
    assert r.status_code == 200 and r.json()["state"] == "cancelled" and stored(rid)["state"] == "cancelled"
    r = req("POST", f"/api/requests/{rid}/cancel", tok(14))
    assert r.status_code == 409 and r.json() == {"error": "This request is already cancelled and can no longer be withdrawn."}
    raise_req(14, d)


def test_one_raise_per_send(app_url):
    ensure_policy()
    d1, d2 = pick(15, n=2)
    key = uuid.uuid4().hex
    reason = f"Reader at the depot skipped me {key}"
    first = raise_req(15, d1, reason=reason, key=key)
    again = raise_req(15, d1, reason=reason, key=key, expect_status=200)
    assert again.headers.get("idempotent-replayed") == "true" and again.json()["id"] == first.json()["id"]
    assert q(f"select count(*)::int n from regularisation_request where reason = '{reason}'")[0]["n"] == 1
    r = raise_req(15, d1, reason=reason + " changed", key=key, expect_status=422)
    assert r.json() == {"error": "That idempotency key was already used for a different correction."}
    r = raise_req(15, d1, reason=reason, key="k" * 65, expect_status=400)
    assert r.json() == {"error": "Idempotency-Key must be 1 to 64 visible characters.", "field": "Idempotency-Key"}
    req("POST", f"/api/requests/{first.json()['id']}/cancel", tok(15))
    again = raise_req(15, d1, reason=reason, key=key, expect_status=200)
    assert again.json()["state"] == "cancelled"
    with cf.ThreadPoolExecutor(6) as ex:
        rs = list(ex.map(lambda i: raise_req(15, d2, key=uuid.uuid4().hex, expect_status=None), range(6)))
    codes = sorted(r.status_code for r in rs)
    assert codes == [201] + [409] * 5
    assert q(f"select count(*)::int n from regularisation_request where person_id = 15 and day::date = '{d2}' and state = 'pending'")[0]["n"] == 1


def test_daylight_saving_claims(fresh, fall):
    b = fresh.copies[1].base
    r = raise_req(6, "2026-03-29", ctype="missed_in", cin="01:30", cout=None, base=b, expect_status=422)
    assert r.json() == {"error": "01:30 does not occur on 2026-03-29 in Kestrel Works time.", "field": "claimed_in"}
    r = raise_req(6, "2026-03-28", ctype="night_shift", cin="22:00", cout="01:30", base=b, expect_status=422)
    assert r.json() == {"error": "01:30 does not occur on 2026-03-29 in Kestrel Works time.", "field": "claimed_out"}
    rid = raise_req(5, "2026-10-25", ctype="missed_in", cin="01:30", cout=None, base=fall.base).json()["id"]
    assert decide(2, rid, "approve", base=fall.base).status_code == 200
    got = orows(f"select {utc('recorded_in')} i from attendance_day where person_id = 5 and day::date = '2026-10-25'", fall.url)
    assert got == [{"i": "2026-10-25T00:30:00Z"}]


def test_leave_blocks_raise(app_url):
    ensure_policy()
    d = seeded() - timedelta(days=5)
    r = raise_req(5, d, expect_status=422)
    assert r.json() == {"error": f"You were on approved leave on {d}."}
    assert "annual" not in r.text.lower()
    j = seeded() - timedelta(days=9)
    for row in q(f"select id from regularisation_request where person_id = 10 and day::date = '{j}' and state = 'pending'"):
        req("POST", f"/api/requests/{row['id']}/cancel", tok(10))
    raise_req(10, j)


def test_wf_raise_draft_row(page, app_url):
    ensure_policy()
    d = pick(8)
    reason = f"The side door reader missed my exit {uuid.uuid4().hex[:8]}"
    ui_login(page, 8)
    page.get_by_role("link", name="Raise a correction").click()
    expect(page).to_have_url(BASE + "/requests/new")
    expect(page.get_by_role("heading", name="Raise a correction", level=1)).to_be_visible()
    page.get_by_label("Day to correct").fill(str(d))
    select(page.get_by_role("combobox", name="Correction type"), "Sign out was not recorded")
    page.get_by_label("Claimed sign out").fill("18:00")
    page.get_by_role("textbox", name="Reason").fill(reason)
    page.get_by_role("button", name="Send for approval").dblclick()
    announced(page, "alert", f"Correction for {d} is waiting for a decision.")
    rows = q(f"select id from regularisation_request where person_id = 8 and reason = '{reason}' and state = 'pending'")
    assert len(rows) == 1
    _MADE.append((BASE, 8, rows[0]["id"]))
    expect(page.get_by_role("link", name=f"Open request {rows[0]['id']}")).to_be_visible()


def test_wf_raise_refusal_keeps_draft(page, app_url):
    ensure_policy()
    d = seeded() - timedelta(days=DEFAULT_LOOKBACK + 5)
    reason = f"An old badge fault I only just noticed {uuid.uuid4().hex[:8]}"
    ui_login(page, 8, "/requests/new")
    page.get_by_label("Day to correct").fill(str(d))
    select(page.get_by_role("combobox", name="Correction type"), "Sign out was not recorded")
    page.get_by_label("Claimed sign out").fill("18:00")
    page.get_by_role("textbox", name="Reason").fill(reason)
    page.get_by_role("button", name="Send for approval").click()
    announced(page, "alert", "That day is outside the 30 day correction window.")
    expect(page.get_by_role("textbox", name="Reason")).to_have_value(reason)
    assert q(f"select count(*)::int n from regularisation_request where reason = '{reason}'")[0]["n"] == 0


def test_approval_writes_attendance(app_url):
    ensure_policy()
    d = pick(9)
    rid = raise_req(9, d, ctype="night_shift", cin="22:00", cout="06:00").json()["id"]
    assert decide(3, rid, "approve").status_code == 200
    row = q(f"select {utc('recorded_in')} i, {utc('recorded_out')} o, source::text s from attendance_day where person_id = 9 and day::date = '{d}'")
    assert row == [{"i": inst(d, "22:00"), "o": inst(d + timedelta(days=1), "06:00"), "s": "regularisation"}]
    gaps = free_days(10, extra="and (select o from a where a.d = g) is null and (select i from a where a.d = g) is not null")
    d2 = gaps[0] if gaps else pick(10)
    before = q(f"select {utc('recorded_in')} i from attendance_day where person_id = 10 and day::date = '{d2}'")
    rid = raise_req(10, d2, cin=None, cout="18:00").json()["id"]
    assert decide(3, rid, "approve").status_code == 200
    row = q(f"select {utc('recorded_in')} i, {utc('recorded_out')} o, source::text s from attendance_day where person_id = 10 and day::date = '{d2}'")
    assert row == [{"i": before[0]["i"] if before else None, "o": inst(d2, "18:00"), "s": "regularisation"}]


def test_rejection_note(app_url):
    ensure_policy()
    rid = raise_req(11, pick(11)).json()["id"]
    for note in (None, "too short"):
        r = decide(3, rid, "reject", note)
        assert r.status_code == 400 and r.json() == {"error": "A rejection needs a note of at least ten characters.", "field": "note"}
    assert stored(rid)["state"] == "pending"
    note = "\U0001F469\u200d\U0001F4BB" * NOTE_MIN
    r = decide(3, rid, "reject", note)
    assert r.status_code == 200 and r.json()["state"] == "rejected" and r.json()["decision_note"] == note
    assert stored(rid)["state"] == "rejected" and stored(rid)["decision_note"] == note


def test_decision_reply(app_url):
    ensure_policy()
    d1, d2 = pick(12, n=2)
    rid = raise_req(12, d1).json()["id"]
    r = decide(3, rid, "approve")
    assert r.status_code == 200
    b = r.json()
    assert b["id"] == rid and b["state"] == "approved" and b["decided_by"] == "Omar Vance" and b["decision_note"] is None
    assert b["decided_at"] == stored(rid)["decided_at"] and stored(rid)["decided_by"] == 3
    try:
        ensure_policy(note=True)
        rid2 = raise_req(12, d2).json()["id"]
        r = decide(3, rid2, "approve")
        assert r.status_code == 400 and r.json() == {"error": "This policy requires a note when approving.", "field": "note"}
        assert decide(3, rid2, "approve", "Checked against the rota").status_code == 200
    finally:
        ensure_policy()


def test_rechecks_at_approval(app_url):
    ensure_policy()
    days = free_days(14)
    by_month = {}
    for d in days:
        by_month.setdefault(month_of(d), []).append(d)
    month, (d1, d2) = next((m, ds[:2]) for m, ds in by_month.items() if len(ds) >= 2)
    rest = [d for d in days if d not in (d1, d2)]
    night_ok = free_days(14, extra=f"and coalesce((select o from a where a.d = g), '-infinity') < (g + time '23:00') {L_}")
    D = next(d for d in night_ok if d + timedelta(days=1) in rest and d in rest)
    w = next(d for d in rest if d not in (D, D + timedelta(days=1)) and (seeded() - d).days >= 2)
    r1, r2 = raise_req(14, d1).json()["id"], raise_req(14, d2).json()["id"]
    rw = raise_req(14, w).json()["id"]
    ns = raise_req(14, D, ctype="night_shift", cin="22:00", cout="06:00").json()["id"]
    mi = raise_req(14, D + timedelta(days=1), ctype="missed_in", cin="05:00", cout=None).json()["id"]
    approved = q(f"select count(*)::int n from regularisation_request where person_id = 14 and state = 'approved' and to_char(day::date, 'YYYY-MM') = '{month}'")[0]["n"]
    try:
        ensure_policy(cap=approved + 1)
        with cf.ThreadPoolExecutor(2) as ex:
            rs = list(ex.map(lambda i: decide(4, i, "approve"), (r1, r2)))
        assert sorted(r.status_code for r in rs) == [200, 422]
        assert [r.json() for r in rs if r.status_code == 422] == [{"error": f"Bo Lindqvist has used {approved + 1} of {approved + 1} corrections in {month}."}]
        ensure_policy(lookback=(seeded() - w).days - 1)
        r = decide(4, rw, "approve")
        assert r.status_code == 422 and r.json() == {"error": f"That day is outside the {(seeded() - w).days - 1} day correction window."}
        assert stored(rw)["state"] == "pending"
        ensure_policy()
        with cf.ThreadPoolExecutor(2) as ex:
            rs = list(ex.map(lambda i: decide(4, i, "approve"), (ns, mi)))
        assert sorted(r.status_code for r in rs) == [200, 422]
        o = q(f"select recorded_out o from attendance_day where person_id = 14 and day::date = '{D}'")[0]["o"]
        i = q(f"select recorded_in i from attendance_day where person_id = 14 and day::date = '{D + timedelta(days=1)}'")[0]["i"]
        if o is not None and i is not None:
            assert q(f"select ('{o}'::timestamptz <= '{i}'::timestamptz) ok")[0]["ok"] is True
    finally:
        ensure_policy()


def test_already_decided(app_url):
    ensure_policy()
    rid = raise_req(15, pick(15)).json()["id"]
    calls = [("approve", None), ("reject", "Rota shows a rest day"), ("approve", None), ("reject", "Rota shows a rest day")]
    with cf.ThreadPoolExecutor(4) as ex:
        rs = list(ex.map(lambda c: decide(4, rid, *c), calls))
    wins = [r for r in rs if r.status_code == 200]
    assert len(wins) == 1 and all(r.status_code == 409 for r in rs if r not in wins)
    at = wins[0].json()["decided_at"]
    want = {"error": f"Lena Roth already decided this on {london_date(at)}.", "decided_by": "Lena Roth", "decided_at": at}
    assert all(r.json() == want for r in rs if r not in wins)
    assert decide(4, rid, "approve").json() == want


def test_detail_evidence(app_url):
    ensure_policy()
    d = pick(9)
    rid = raise_req(9, d).json()["id"]
    b = req("GET", f"/api/requests/{rid}", tok(3)).json()
    assert {"request", "evidence", "leave", "audit"} <= set(b) and b["request"]["id"] == rid and b["leave"] is None
    row = q(f"select {utc('recorded_in')} i, {utc('recorded_out')} o, source::text s from attendance_day where person_id = 9 and day::date = '{d}'")
    ev = row[0] if row else {"i": None, "o": None, "s": None}
    assert b["evidence"] == {"recorded_in": ev["i"], "recorded_out": ev["o"], "source": ev["s"]}
    assert decide(3, rid, "approve").status_code == 200
    audit = req("GET", f"/api/requests/{rid}", tok(3)).json()["audit"]
    assert [(e["actor"], e["verb"], e["subject_type"], str(e["subject_id"])) for e in audit] == [("Omar Vance", "approved", "request", str(rid))]


def test_wf_decide_approve(page, app_url):
    ensure_policy()
    tag = uuid.uuid4().hex[:10]
    d = pick(5)
    rid = raise_req(5, d, cin=None, reason=f"Exit reader skipped me {tag}").json()["id"]
    r = decide(1, rid, "approve")
    assert r.status_code == 403 and r.json() == {"error": "People operations does not decide requests."}
    assert stored(rid)["state"] == "pending"
    ui_login(page, 2, f"/requests/{rid}?q={tag}")
    expect(row_of(page, rid)).to_contain_text(re.compile("pending", re.I))
    page.evaluate("window.__noReload = 1")
    page.get_by_role("button", name="Approve").click()
    announced(page, "alert", f"Correction approved. The attendance record for {d} now reads the claimed times.")
    expect(row_of(page, rid)).to_contain_text(re.compile("approved", re.I))
    assert page.evaluate("window.__noReload") == 1 and stored(rid)["state"] == "approved"
    o = q(f"select {utc('recorded_out')} o from attendance_day where person_id = 5 and day::date = '{d}'")
    assert o == [{"o": inst(d, "18:00")}]


def test_wf_decide_refused_note(page, app_url):
    ensure_policy()
    tag = uuid.uuid4().hex[:10]
    rid = raise_req(5, pick(5), reason=f"Gate reader skipped me {tag}").json()["id"]
    ui_login(page, 2, f"/requests/{rid}?q={tag}")
    note = page.get_by_role("textbox", name="Note")
    note.fill("short")
    page.get_by_role("button", name="Reject").click()
    announced(page, "alert", "A rejection needs a note of at least ten characters.")
    expect(row_of(page, rid)).to_contain_text(re.compile("pending", re.I))
    expect(note).to_have_value("short")
    assert stored(rid)["state"] == "pending"
    note.fill(REJECT_NOTE)
    page.get_by_role("button", name="Reject").click()
    announced(page, "alert", "Correction rejected.")
    assert stored(rid)["state"] == "rejected" and stored(rid)["decision_note"] == REJECT_NOTE


def policy_body(**over):
    cur = req("GET", "/api/policy", tok(1))
    body = {k: cur.json()[k] for k in ("monthly_cap", "lookback_days", "enabled_types", "require_note_on_approve")}
    return {**body, **over}, cur.headers["ETag"], cur.json()["version"]


def test_one_type_stays_enabled(app_url):
    body, etag, v = policy_body(enabled_types=[])
    r = req("PUT", "/api/policy", tok(1), body=body, headers={"If-Match": etag})
    assert r.status_code == 400 and r.json() == {"error": "At least one correction type must stay available.", "field": "enabled_types"}
    assert q("select max(version)::int v from policy")[0]["v"] == v


def test_self_approval_refused(app_url):
    body, etag, v = policy_body(self_approval_allowed=True)
    r = req("PUT", "/api/policy", tok(1), body=body, headers={"If-Match": etag})
    assert r.status_code == 400 and r.json() == {"error": "Not available. Self approval is refused by this product.", "field": "self_approval_allowed"}
    assert q("select max(version)::int v from policy")[0]["v"] == v
    assert q("select count(*)::int n from policy where self_approval_allowed")[0]["n"] == 0


def test_pending_survives_tightening(app_url):
    ensure_policy()
    rid = raise_req(5, pick(5)).json()["id"]
    try:
        ensure_policy(cap=0, lookback=1)
        assert stored(rid)["state"] == "pending"
        assert req("GET", f"/api/requests/{rid}", tok(5)).json()["request"]["state"] == "pending"
    finally:
        ensure_policy()


def test_append_only_trail(app_url):
    ensure_policy()
    top = lambda: q("select coalesce(max(seq), 0)::int s from audit_event")[0]["s"]
    s0 = top()
    rid = raise_req(5, pick(5)).json()["id"]
    assert decide(2, rid, "reject", REJECT_NOTE).status_code == 200
    v = ensure_policy(cap=CAP - 1)
    ensure_policy()
    month = month_of(seeded())
    link = req("POST", "/api/share-links", tok(1), body={"person_id": 6, "month": month}).json()
    assert req("DELETE", f"/api/share-links/{link['id']}", tok(1)).status_code == 204
    rid2 = raise_req(5, pick(5)).json()["id"]
    n = top()
    req("POST", f"/api/requests/{rid2}/cancel", tok(5))
    assert top() == n
    new = q(f"select seq, request_id, actor_id, actor_role::text r, verb::text v, subject_type::text st, subject_id::text sid, note from audit_event where seq > {s0} order by seq")
    got = [(e["actor_id"], e["r"], e["v"], e["st"]) for e in new]
    assert got == [(2, "manager", "rejected", "request"), (1, "admin", "policy_saved", "policy"), (1, "admin", "policy_saved", "policy"),
                   (1, "admin", "share_mint", "share_link"), (1, "admin", "share_revoke", "share_link")]
    assert new[0]["request_id"] == rid and new[0]["sid"] == str(rid) and new[0]["note"] == REJECT_NOTE
    assert new[1]["note"] == f"Version {v}." and new[1]["request_id"] is None
    assert new[3]["note"] == new[4]["note"] == f"Month {month} for Tomas Berg." and new[3]["sid"] == str(link["id"])
    entries = req("GET", "/api/audit", tok(1)).json()["entries"]
    seqs = [e["seq"] for e in entries]
    assert seqs == sorted(seqs, reverse=True) and {e["seq"] for e in new} <= set(seqs)
    r = req("GET", "/api/audit", tok(5))
    assert r.status_code == 403 and r.json() == {"error": "Only people operations reads the whole trail."}
    for stmt in ("UPDATE audit_event SET note = note WHERE seq = 1", "DELETE FROM audit_event WHERE seq = 1", "TRUNCATE audit_event"):
        assert psql(f"BEGIN; {stmt}; ROLLBACK;").returncode != 0, stmt
    assert top() == n


def test_policy_precondition(app_url):
    ensure_policy()
    body, etag, v = policy_body()
    r = req("PUT", "/api/policy", tok(1), body=body)
    assert r.status_code == 428 and r.json() == {"error": "Send If-Match with the policy version you are changing."}
    for stale in ("*", f'"{v - 1}"', f'W/"{v}"'):
        r = req("PUT", "/api/policy", tok(1), body=body, headers={"If-Match": stale})
        assert r.status_code == 412 and r.json() == {"error": f"Version {v} was saved after the one you are changing. Reload to see it."}
        assert r.headers["etag"] == f'"{v}"'
    body["monthly_cap"] = CAP - 1
    with cf.ThreadPoolExecutor(5) as ex:
        rs = list(ex.map(lambda i: req("PUT", "/api/policy", tok(1), body=body, headers={"If-Match": etag}), range(5)))
    assert sorted(r.status_code for r in rs) == [201, 412, 412, 412, 412]
    assert [r.headers["etag"] for r in rs if r.status_code == 201] == [f'"{v + 1}"']
    m = q("select max(version)::int v, count(*)::int n from policy")[0]
    assert m["v"] == m["n"] == v + 1
    ensure_policy()


def test_policy_announcements(page, app_url):
    v = ensure_policy()
    ui_login(page, 1, "/policy")
    page.evaluate("window.__noReload = 1")
    page.get_by_role("spinbutton", name="Corrections allowed per person each month").fill("4")
    page.get_by_role("button", name="Save new version").click()
    dialog = page.get_by_role("dialog", name="Save this policy?")
    expect(dialog).to_contain_text(f"This appends version {v + 1}.")
    with held(page, "**/api/policy*") as h:
        dialog.get_by_role("button", name="Save").click()
        announced(page, "status", "Saving policy")
        h.release()
    announced(page, "alert", f"Policy version {v + 1} is now in force.")
    expect(page.get_by_role("contentinfo")).to_contain_text(f"Rostara attendance desk. Policy version {v + 1}.")
    assert q(f"select monthly_cap from policy where version = {v + 1}") == [{"monthly_cap": 4}]
    look = page.get_by_role("spinbutton", name="How many days back a correction may reach")
    look.fill("0")
    page.get_by_role("button", name="Save new version").click()
    page.get_by_role("dialog", name="Save this policy?").get_by_role("button", name="Save").click()
    wording = "lookback_days must be a whole number from 1 to 90."
    announced(page, "alert", wording)
    expect(look).to_have_attribute("aria-invalid", "true")
    expect(look).to_be_focused()
    described = look.evaluate("e => (e.getAttribute('aria-describedby') || '').split(' ').map(i => (document.getElementById(i) || {}).textContent || '').join(' ')")
    assert wording in described and page.evaluate("window.__noReload") == 1
    ensure_policy()


def test_policy_save_after_colleague(page, app_url):
    v = ensure_policy()
    ui_login(page, 1, "/policy")
    cap = page.get_by_role("spinbutton", name="Corrections allowed per person each month")
    cap.fill("2")
    body, etag, _ = policy_body(lookback_days=DEFAULT_LOOKBACK - 1)
    assert req("PUT", "/api/policy", tok(1), body=body, headers={"If-Match": etag}).status_code == 201
    page.get_by_role("button", name="Save new version").click()
    dialog = page.get_by_role("dialog", name="Save this policy?")
    expect(dialog).to_contain_text(f"This appends version {v + 1}.")
    dialog.get_by_role("button", name="Save").click()
    announced(page, "alert", f"Version {v + 1} was saved after the one you are changing. Reload to see it.")
    expect(page.get_by_text(f"Version {v + 1} was saved by Priya Sahni. Your changes are still in the form.")).to_be_visible()
    expect(cap).to_have_value("2")
    page.get_by_role("button", name="Save new version").click()
    expect(dialog).to_contain_text(f"This appends version {v + 2}.")
    dialog.get_by_role("button", name="Save").click()
    announced(page, "alert", f"Policy version {v + 2} is now in force.")
    assert q(f"select monthly_cap from policy where version = {v + 2}") == [{"monthly_cap": 2}]
    ensure_policy()


TRAIL_HEADER = "seq,at,actor,actor_role,action,subject_type,subject_id,reason,detail,prev_hash,entry_hash"


def test_trail_export_and_chain(fall, app_url):
    ensure_policy()
    tag = uuid.uuid4().hex[:8]
    reason = f'=HYPERLINK("http://x","c") badge reader again {tag}'
    rid = raise_req(5, pick(5), reason=reason).json()["id"]
    assert decide(2, rid, "reject", f"-minus note {tag} checked").status_code == 200
    r = req("GET", "/api/trail.csv", tok(1))
    assert r.status_code == 200 and r.headers["content-type"].replace(" ", "").lower() == "text/csv; charset=utf-8".replace(" ", "")
    assert r.headers["content-disposition"] == 'attachment; filename="trail.csv"'
    raw = r.content
    assert not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\r\n") and raw.count(b"\n") == raw.count(b"\r\n")
    body = raw.decode("utf-8")
    assert body.split("\r\n")[0] == TRAIL_HEADER
    assert f'"\'=HYPERLINK(""http://x"",""c"") badge reader again {tag}"' in body and f"'-minus note {tag} checked" in body
    rows = list(csv.reader(io.StringIO(body)))[1:]
    entries = q(AUDIT_SQL)
    assert [int(x[0]) for x in rows] == [e["seq"] for e in entries]
    assert "@example.com" not in body and "07700 9001" not in body and "Emergency contact" not in body
    assert chain_ok(entries) is None and all(x[10] == e["entry_hash"] and x[9] == e["prev_hash"] for x, e in zip(rows, entries))
    v = req("GET", "/api/trail/verify", tok(1)).json()
    assert v == {"intact": True, "entries": len(entries), "checked_through": entries[-1]["seq"]}
    r = req("GET", "/api/trail.csv", tok(5))
    assert r.status_code == 403 and r.json() == {"error": "Only people operations exports the trail."}
    tamper = """DO $$ DECLARE r record; BEGIN
      EXECUTE 'ALTER TABLE audit_event DISABLE TRIGGER USER';
      EXECUTE 'ALTER TABLE audit_event NO FORCE ROW LEVEL SECURITY';
      EXECUTE 'GRANT ALL ON audit_event TO ' || quote_ident(current_user);
      FOR r IN SELECT rulename FROM pg_rules WHERE tablename = 'audit_event' LOOP EXECUTE format('DROP RULE %I ON audit_event', r.rulename); END LOOP;
      UPDATE audit_event SET note = 'tampered' WHERE seq = 3; END $$;"""
    assert psql(tamper, fall.url).returncode == 0
    v = req("GET", "/api/trail/verify", tok(1, fall.base), base=fall.base).json()
    assert v["intact"] is False and v["first_broken_seq"] == 3


def test_wf_policy_audit_save_version(page, app_url):
    v = ensure_policy()
    ui_login(page, 1, "/policy")
    page.get_by_role("spinbutton", name="Corrections allowed per person each month").fill("5")
    page.get_by_role("button", name="Save new version").click()
    dialog = page.get_by_role("dialog", name="Save this policy?")
    expect(dialog).to_contain_text(f"This appends version {v + 1}. Requests already waiting stay waiting.")
    dialog.get_by_role("button", name="Save").click()
    announced(page, "alert", f"Policy version {v + 1} is now in force.")
    expect(page.get_by_role("heading", name="Previous versions")).to_be_visible()
    h = req("GET", "/api/policy/history", tok(1))
    assert h.headers["etag"] == f'"{v + 1}"'
    vs = h.json()["versions"]
    assert [x["version"] for x in vs] == list(range(v + 1, 0, -1)) and vs[0]["monthly_cap"] == 5
    r = req("GET", "/api/policy/history", tok(2))
    assert r.status_code == 403 and r.json() == {"error": "Only people operations reads the policy history."}
    ensure_policy()


def test_wf_policy_audit_download_trail(page, app_url):
    ui_login(page, 1, "/policy")
    link = page.get_by_role("link", name="Download trail")
    expect(link).to_have_attribute("href", "/api/trail.csv")
    with page.expect_download() as dl:
        link.click()
    data = Path(dl.value.path()).read_bytes().decode("utf-8")
    assert data.split("\r\n")[0] == TRAIL_HEADER
    assert len(data.split("\r\n")) - 2 == q("select count(*)::int n from audit_event")[0]["n"]


def expected_counts(ids, month):
    s = seeded()
    ids_sql = ",".join(map(str, ids)) or "0"
    att = q(f"select person_id, day::text d, (recorded_in is not null and recorded_out is not null) complete from attendance_day where person_id in ({ids_sql}) and to_char(day::date, 'YYYY-MM') = '{month}'")
    lv = q(f"select day::text d, status::text st from leave_day where person_id in ({ids_sql}) and to_char(day::date, 'YYYY-MM') = '{month}'")
    wt = q(f"select day::text d from regularisation_request where state = 'pending' and person_id in ({ids_sql}) and to_char(day::date, 'YYYY-MM') = '{month}'")
    y, m = map(int, month.split("-"))
    out = []
    for k in range(1, calendar.monthrange(y, m)[1] + 1):
        d = date(y, m, k)
        ds = d.isoformat()
        rows = {a["person_id"]: a["complete"] for a in att if a["d"] == ds}
        span = 0 <= (s - d).days <= SEEDED_SPAN
        out.append({"day": ds, "counts": {"recorded": sum(1 for v in rows.values() if v),
                                          "incomplete": sum(1 for p in ids if not rows.get(p)) if span else 0,
                                          "leave_approved": sum(1 for x in lv if x["d"] == ds and x["st"] == "approved"),
                                          "leave_pending": sum(1 for x in lv if x["d"] == ds and x["st"] == "pending"),
                                          "waiting": sum(1 for x in wt if x["d"] == ds)}})
    return out


def test_calendar_api(app_url):
    m = tok(2)
    month = month_of(seeded())
    reports = q("select id, name, work_address from person where manager_id = 2")
    ids = [p["id"] for p in reports]
    r = req("GET", "/api/calendar", m).json()
    assert r["month"] == month
    assert r["people"] == sorted([{"name": p["name"], "work_address": p["work_address"]} for p in reports], key=lambda p: p["name"])
    assert r["days"] == expected_counts(ids, month)
    one = req("GET", f"/api/calendar?month={month}&person={ADDR[5].upper()}", m).json()
    assert one["days"] == expected_counts([5], month) and one["people"] == r["people"]
    out = req("GET", f"/api/calendar?month={month}&person={ADDR[9]}", m).json()
    assert all(not any(x["counts"].values()) for x in out["days"]) and out["people"] == r["people"]
    r = req("GET", "/api/calendar?month=2026-13", m)
    assert r.status_code == 400 and r.json() == {"error": "month must read YYYY-MM.", "field": "month"}
    assert req("GET", "/api/calendar", tok(5)).status_code == 403


def test_live_calendar_counts(app_url):
    ensure_policy()
    m = tok(2)
    cal = lambda d, pid: {x["day"]: x["counts"] for x in req("GET", f"/api/calendar?month={month_of(d)}&person={ADDR[pid]}", m).json()["days"]}[str(d)]
    d = pick(5)
    w0 = cal(d, 5)["waiting"]
    rid = raise_req(5, d).json()["id"]
    assert cal(d, 5)["waiting"] == w0 + 1
    req("POST", f"/api/requests/{rid}/cancel", tok(5))
    assert cal(d, 5)["waiting"] == w0
    gap = "and exists (select 1 from a where a.d = g) and ((select o from a where a.d = g) is null or (select i from a where a.d = g) is null)"
    pid, gd = next((p, free_days(p, gap)[0]) for p in (5, 6, 7, 8) if free_days(p, gap))
    before = cal(gd, pid)
    no_out = q(f"select recorded_out is null x from attendance_day where person_id = {pid} and day::date = '{gd}'")[0]["x"]
    rid = raise_req(pid, gd, cin=None if no_out else "09:00", cout="18:00" if no_out else None, ctype="missed_out" if no_out else "missed_in").json()["id"]
    assert decide(2, rid, "approve").status_code == 200
    after = cal(gd, pid)
    assert (after["recorded"], after["incomplete"]) == (before["recorded"] + 1, before["incomplete"] - 1)
    month = month_of(seeded())
    for p in req("GET", f"/api/calendar?month={month}", m).json()["people"]:
        days = req("GET", f"/api/calendar?month={month}&person={p['work_address']}", m).json()["days"]
        matched = req("GET", f"/api/requests?state=pending&month={month}&person={p['work_address']}", m).json()["matched"]
        assert sum(x["counts"]["waiting"] for x in days) == matched


def test_forced_colours(browser, app_url):
    with open_app(browser, BASE + "/login") as page:
        page.set_viewport_size({"width": TIERS["wide"][0], "height": TIERS["wide"][1]})
        page.emulate_media(forced_colors="active")
        ui_login(page, 2, "/calendar")
        expect(page.get_by_role("heading", name="What the marks mean")).to_be_visible()
        for mark in ("Attendance recorded", "Attendance incomplete", "Leave approved", "Leave pending", "Correction waiting"):
            expect(page.get_by_text(mark).first).to_be_visible()
        expect(page.get_by_text(re.compile(r"^(Attendance recorded|Attendance incomplete): \d+$")).first).to_be_visible()
        mons = "|".join(calendar.month_abbr[1:])
        expect(page.get_by_text(re.compile(rf"^\d{{1,2}} ({mons})$")).first).to_be_visible()
        _, focus = state_styles(page.get_by_role("button", name="Show"), "outline-style", "outline-width", state="focus")
        assert focus["outline-style"] != "none" and float(focus["outline-width"].rstrip("px")) >= 2
        ui_login(page, 2)
        for word in ("All", "Pending", "Approved", "Rejected", "Cancelled"):
            expect(page.get_by_role("radio", name=word)).to_be_visible()


def test_wf_calendar_month_grid(page, app_url):
    s = seeded()
    ui_login(page, 2, "/calendar")
    expect(page.get_by_role("heading", name="Team calendar")).to_be_visible()
    expect(page.get_by_role("table", name=s.strftime("%B %Y"))).to_be_visible()
    expect(page.get_by_role("heading", name="What the marks mean")).to_be_visible()
    expect(page.get_by_role("button", name="Share this month")).to_have_count(0)
    select(page.get_by_role("combobox", name="Person"), "Iris Calder")
    page.get_by_role("button", name="Show").click()
    expect(page.get_by_role("button", name="Share this month")).to_be_visible()
    days = req("GET", f"/api/calendar?month={month_of(s)}&person={ADDR[5]}", tok(2)).json()["days"]
    most = max(x["counts"]["recorded"] for x in days)
    assert most <= 1
    mark = "Attendance recorded"
    if most:
        expect(page.get_by_text(f"{mark}: {most}").first).to_be_visible()


def test_wf_calendar_share_month(page, app_url):
    ui_login(page, 3, "/calendar")
    select(page.get_by_role("combobox", name="Person"), "Suri Patel")
    page.get_by_role("button", name="Show").click()
    page.get_by_role("button", name="Share this month").click()
    announced(page, "alert", "Shared link created. It works until ")
    field = page.get_by_role("textbox", name="Shared link")
    expect(field).to_be_focused()
    url = field.input_value()
    assert re.fullmatch(rf"{re.escape(BASE)}/share/[A-Za-z0-9._~-]{{{TOKEN_MIN},}}", url)
    g = httpx.get(url, timeout=HTTP_S)
    assert g.status_code == 200 and "Suri Patel, " in text_of(g.text)
    live = q("select count(*)::int n from share_link where person_id = 9 and minted_by = 3 and revoked_at is null and replaced_at is null and expires_at > now()")
    assert live[0]["n"] >= 1
    page.get_by_role("button", name="Revoke link").click()
    announced(page, "alert", "Shared link revoked.")
    expect(page.get_by_role("button", name="Share this month")).to_be_focused()
    assert httpx.get(url, timeout=HTTP_S).status_code == 410


def inside(locator):
    return locator.evaluate("d => d.contains(document.activeElement)")


def test_dialogs_trap_focus(page, app_url):
    ui_login(page, 1)
    page.get_by_role("button", name="Filters").click()
    sheet = page.get_by_role("dialog", name="Narrow the queue")
    expect(sheet).to_be_visible()
    assert inside(sheet)
    for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
        page.keyboard.press(key)
        assert inside(sheet), key
    page.keyboard.press("Escape")
    expect(sheet).to_be_hidden()
    expect(page.get_by_role("button", name="Filters")).to_be_focused()
    v = req("GET", "/api/policy", tok(1)).json()["version"]
    page.goto(BASE + "/policy")
    page.get_by_role("button", name="Save new version").click()
    dlg = page.get_by_role("dialog", name="Save this policy?")
    for key in ["Tab"] * 8:
        page.keyboard.press(key)
        assert inside(dlg)
    page.keyboard.press("Escape")
    expect(dlg).to_be_hidden()
    expect(page.get_by_role("button", name="Save new version")).to_be_focused()
    assert req("GET", "/api/policy", tok(1)).json()["version"] == v


def test_announcements(page, app_url):
    ensure_policy()
    d = pick(8)
    ui_login(page, 8, "/requests/new")
    page.get_by_label("Day to correct").fill(str(d))
    select(page.get_by_role("combobox", name="Correction type"), "Sign out was not recorded")
    page.get_by_label("Claimed sign out").fill("18:00")
    page.get_by_role("textbox", name="Reason").fill(f"The exit reader stayed dark {uuid.uuid4().hex[:8]}")
    with held(page, "**/api/requests") as h:
        page.get_by_role("button", name="Send for approval").click()
        announced(page, "status", "Sending for approval")
        h.release()
    announced(page, "alert", f"Correction for {d} is waiting for a decision.")
    for row in q(f"select id from regularisation_request where person_id = 8 and day::date = '{d}' and state = 'pending'"):
        _MADE.append((BASE, 8, row["id"]))


def tier_pages(browser, w, h, check):
    rid = raise_req(5, pick(5)).json()["id"]
    seq = [(None, "/login"), (5, "/requests"), (5, "/requests/new"), (2, f"/requests/{rid}"), (2, "/calendar"),
           (1, "/policy"), (None, f"/share/{shared_token()}")]
    with open_app(browser, BASE + "/login") as page:
        page.set_viewport_size({"width": w, "height": h})
        for pid, path in seq:
            if pid:
                ui_login(page, pid, path)
            else:
                page.context.clear_cookies()
                page.goto(BASE + path)
            check(page, pid, path)


def test_landmarks_and_headings(browser, app_url):
    def check(page, pid, path):
        for role in ("banner", "main", "contentinfo") + (("navigation",) if pid else ()):
            assert page.get_by_role(role).count() >= 1, (path, role)
        expect(page.get_by_role("heading", level=1)).to_have_count(1)
        levels = [h.evaluate("e => +(e.getAttribute('aria-level') || e.tagName.slice(1))") for h in page.get_by_role("heading").all()]
        top = 0
        for lv in levels:
            assert lv <= top + 1, (path, levels)
            top = max(top, lv)
    tier_pages(browser, *TIERS["wide"], check)


@pytest.mark.parametrize("tier", TIER_IDS, ids=TIER_IDS)
def test_accessibility_audit(browser, app_url, tier):
    tier_pages(browser, *TIERS[tier], lambda page, pid, path: axe(page))


@pytest.mark.parametrize("tier", TIER_IDS, ids=TIER_IDS)
def test_narrow_reflow(browser, app_url, tier):
    tier_pages(browser, *TIERS[tier], lambda page, pid, path: layout(page))


def test_own_assets(page, app_url):
    seen = []
    page.on("request", lambda r: seen.append((r.url, r.resource_type)))
    ui_login(page, 5)
    page.reload()
    assert seen and all(same_origin(u, BASE) for u, _ in seen)
    assert not [u for u, t in seen if t == "image"]
    fonts = {Path(urlsplit(u).path).name for u, t in seen if t == "font"}
    stems = ("open-sans-latin-wght-normal", "poppins-latin-600-normal")
    assert fonts and all(f.endswith(".woff2") and f.startswith(stems) for f in fonts)
    assert {s for s in stems if any(f.startswith(s) for f in fonts)} == set(stems)
    assert "Open Sans" in style(page.get_by_role("main"), "font-family")["font-family"]
    assert "Poppins" in style(page.get_by_role("heading", level=1), "font-family")["font-family"]


def test_focus_ring(page, app_url):
    ui_login(page, 5)
    rings = []
    for loc in (page.get_by_role("button", name="Sign out"), page.get_by_role("button", name="Filters"),
                page.get_by_role("link", name="Raise a correction"), page.get_by_role("searchbox", name="Search reasons"),
                page.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name="Desk")):
        _, f = state_styles(loc, "outline-style", "outline-width", "outline-color", state="focus")
        assert f["outline-style"] != "none" and float(f["outline-width"].rstrip("px")) >= 2
        rings.append((f["outline-width"], f["outline-color"]))
    assert len(set(rings)) == 1


def test_no_idle_loops(page, app_url):
    ui_login(page, 1)
    for role in ("banner", "main", "contentinfo"):
        loc = page.get_by_role(role).first
        settle(loc)
        assert animations(loc) == [], role


def test_reduced_motion(browser, app_url):
    with open_app(browser, BASE + "/login", reduced_motion="reduce") as page:
        ui_login(page, 1)
        page.get_by_role("button", name="Filters").click()
        path = motion(page.get_by_role("dialog", name="Narrow the queue"), 250)
        still = lambda s: {k: v for k, v in s.items() if k != "t"}
        assert path and all(still(p) == still(path[-1]) for p in path)


def test_narrow_tier(browser, app_url):
    tag = uuid.uuid4().hex[:10]
    rid = raise_req(5, pick(5), reason=f"Gate reader skipped me {tag}").json()["id"]
    w, h = TIERS["narrow"]
    with open_app(browser, BASE + "/login") as page:
        page.set_viewport_size({"width": w, "height": h})
        ui_login(page, 2, f"/requests?q={tag}")
        page.get_by_role("link", name=f"Open request {rid}").click()
        expect(page).to_have_url(re.compile(rf"/requests/{rid}"))
        expect(page.get_by_role("table", name=re.compile(r"of \d+ requests"))).to_be_hidden()
        for y in ("0", "document.body.scrollHeight"):
            page.evaluate(f"window.scrollTo(0, {y})")
            a, r = page.get_by_role("button", name="Approve").bounding_box(), page.get_by_role("button", name="Reject").bounding_box()
            assert a["y"] < r["y"] and abs(a["x"] - r["x"]) < 1 and abs(a["width"] - r["width"]) < 1 and a["width"] * 2 > w
            assert 0 <= a["y"] and r["y"] + r["height"] <= h


@pytest.mark.parametrize("tier", TIER_IDS, ids=TIER_IDS)
def test_every_tier_capabilities(browser, app_url, tier):
    rid = raise_req(5, pick(5)).json()["id"]
    with open_app(browser, BASE + "/login") as page:
        page.set_viewport_size({"width": TIERS[tier][0], "height": TIERS[tier][1]})
        ui_login(page, 5)
        expect(page.get_by_role("link", name="Raise a correction")).to_be_visible()
        page.get_by_role("button", name="Filters").click()
        expect(page.get_by_role("dialog", name="Narrow the queue")).to_be_visible()
        ui_login(page, 2, f"/requests/{rid}")
        expect(page.get_by_role("button", name="Approve")).to_be_visible()
        ui_login(page, 2, "/calendar")
        select(page.get_by_role("combobox", name="Person"), "Iris Calder")
        page.get_by_role("button", name="Show").click()
        expect(page.get_by_role("button", name="Share this month")).to_be_visible()


def test_wf_cross_cutting_narrow_decide(browser, app_url):
    ensure_policy()
    rid = raise_req(5, pick(5)).json()["id"]
    with open_app(browser, BASE + "/login") as page:
        page.set_viewport_size({"width": TIERS["narrow"][0], "height": TIERS["narrow"][1]})
        ui_login(page, 2, f"/requests/{rid}")
        page.get_by_role("button", name="Approve").click()
        announced(page, "alert", "Correction approved.")
    assert stored(rid)["state"] == "approved"


def test_wf_cross_cutting_keyboard_filters(page, app_url):
    ui_login(page, 2)
    page.get_by_role("radio", name="All").focus()
    page.keyboard.press("ArrowRight")
    page.keyboard.press("Space")
    expect(page).to_have_url(BASE + "/requests?state=pending")
    r = req("GET", "/api/requests?state=pending", tok(2)).json()
    expect(page.get_by_role("table", name=f"{r['matched']} of {r['total']} requests")).to_be_visible()
    page.get_by_role("button", name="Filters").focus()
    page.keyboard.press("Enter")
    sheet = page.get_by_role("dialog", name="Narrow the queue")
    expect(sheet).to_be_visible()
    assert inside(sheet)
    page.keyboard.press("Escape")
    expect(page.get_by_role("button", name="Filters")).to_be_focused()


APP_DIR = Path("/app")
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


NODE_ROOTS = ("/srv/app", "/app")


def node_root():
    return next((p for p in NODE_ROOTS if os.path.isdir(os.path.join(p, "node_modules"))), NODE_ROOTS[0])


def shipped():
    r = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=node_root(), capture_output=True, text=True, timeout=NPM_S)
    tree, out = json.loads(r.stdout or "{}"), {}

    def visit(deps):
        for name, d in (deps or {}).items():
            k = (name, d.get("version"))
            if k in out:
                continue
            lic = d.get("license")
            if lic is None and d.get("path") and (Path(d["path"]) / "package.json").exists():
                lic = json.loads((Path(d["path"]) / "package.json").read_text()).get("license")
            out[k] = lic.get("type") if isinstance(lic, dict) else lic
            visit(d.get("dependencies"))
    visit(tree.get("dependencies"))
    return out


def test_if_run_manifest():
    m = json.loads((APP_DIR / "run.json").read_text())
    assert isinstance(m, dict) and m.get("_schema") == "run-manifest-v1"
    assert all(isinstance(m.get(k), str) and m[k] for k in ("install", "build", "serve"))


def test_if_user_readme():
    t = (APP_DIR / "USER_README.md").read_text()
    assert PW in t and all(a in t for a in ADDR.values())


def test_if_reserved_dirs_empty():
    for d in (".browser_screenshots", ".downloads"):
        assert (APP_DIR / d).is_dir() and not any((APP_DIR / d).iterdir())


def test_if_third_party_notices():
    t = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    pkgs = shipped()
    assert pkgs
    for name, version in pkgs:
        assert name in t and (version or "") in t, name
    assert "@fontsource-variable/open-sans" in t and "@fontsource/poppins" in t


def test_if_licences():
    for (name, _), lic in shipped().items():
        assert isinstance(lic, str), name
        terms = re.split(r"\s+(?:OR|AND)\s+", lic.strip("()"))
        ok = any if " OR " in lic else all
        assert ok(t.strip("() ") in ALLOWED for t in terms), (name, lic)


def test_if_one_postgres_driver():
    names = {n for n, _ in shipped()}
    drivers = names & {"pg", "postgres", "pg-native", "@neondatabase/serverless", "@vercel/postgres"}
    assert len(drivers) == 1
    banned = {"mysql", "mysql2", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "redis", "ioredis", "nodemailer",
              "amqplib", "bullmq", "kafkajs", "memcached", "level", "lowdb", "nedb"}
    assert not names & banned


def test_if_no_local_services():
    p = Path("/logs/agent/trajectory.json")
    text = p.read_text(errors="replace") if p.exists() else ""
    for pat in (r"apt(-get)?\s+install[^\n\"]*postgres", r"docker\s+run[^\n\"]*(postgres|keycloak)", r"kc\.sh\s+start",
                r"\binitdb\b", r"pg_ctl\s+start", r"brew\s+install[^\n\"]*(postgres|keycloak)"):
        assert not re.search(pat, text, re.I), pat
