from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import re
import struct
import threading
import time
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from decimal import ROUND_HALF_UP, Decimal
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

import httpx
import pytest
from playwright.sync_api import expect

from conftest import advance, axe, held, idempotency_key, layout, open_app, same_origin, select, settle, tab_order, unique

try:
    from conftest import Postgres, addresses, mail_from_address
    from conftest import text as mail_text
except ImportError:
    from postgres import Postgres
    from mailpit import addresses, mail_from_address
    from mailpit import text as mail_text


PASSWORD = "deku-demo-pw-2026"
NORTHWIND = "Northwind Labs"
ACME = "Acme Ops"
NW_OWNER = "northwind.owner@example.com"
NW_EDITOR = "northwind.editor@example.com"
NW_VIEWER = "northwind.viewer@example.com"
ACME_OWNER = "acme.owner@example.com"
LAUNCH = "launch_brain"

MAX_BODY = 2_097_152
TITLE_MAX = 200
TEXT_MAX = 20000
ID_MAX = 64
ENTITY_MAX = 80
PREDICATE_MAX = 32
REASON_MAX = 280
FACTS_MAX = 50
SOURCES_MAX = 50
NAME_MAX = 32
KEY_NAME_MAX = 60
KEY_HEX = 40
PREFIX_LEN = 12
SCALE_DBS = 20
SHIP_DBS = 3
SHIP_QUERIES = 20
SCALE_QUERIES = 200
RETRY_MAX = 60
FEEDBACK_LIMIT = 100
FEEDBACK_WINDOW_S = 60
FEEDBACK_MAX = 8000
META_ENTRIES = 20
META_VALUE_MAX = 500
GT_IDS_MAX = 20
CONTACT_MIN = 10
CONTACT_MAX = 4000
CONTACT_LIMIT = 3
AUDIT_LIMIT_MAX = 100
AUDIT_PAGE = 20
SEARCH_MAX = 20
SIGNIN_FAILS = 10
SIGNIN_PAUSE_MAX = 900
RESET_EMAILS = 3
RESET_HEX = 64
TOTP_STEP = 30
RECOVERY_CODES = 10
STORAGE_PER_FACT = 64
SNIPPET = 160
STARS = 13062
GRAPH_BUDGET_MS = 200
SEARCH_BUDGET_MS = 1000
AUDIT_BUDGET_MS = 500
SCALE_SOURCES = 2000
SCALE_EVENTS = 1000
TOAST_MS = 6000
TRANSITION_MAX_MS = 500
EXPORT_MAIL_S = 10
HERO_NODES = 21
HERO_EDGES = 20
TOUCH_MIN = 44
GB = 1_000_000_000
TOKENS_PER_MILLION = 1_000_000
ONTOLOGY_RATE = 500
RATES = {"ship": 50, "scale": 25}
MINIMUMS = {"ship": 2500, "scale": 30000}
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}

HTTP_TIMEOUT = 60
READY_DEADLINE = 30
MAIL_DEADLINE = 30
UI_DEADLINE = 45
UI_TIMEOUT_MS = 30000
POLL_MS = 500
STEP_MS = 250
RACERS = 8

STOPWORDS = set("a an and are as at be by for from in is it of on or that the this to was with".split())
UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
LEAKS = ("Traceback", "psycopg", "sqlalchemy", "asyncpg", "File \"", "/app/", "site-packages")
ABSENT = object()

MESSAGES = {
    "API_VERSION_REQUIRED": "Send the header API-Version: 2",
    "UNSUPPORTED_API_VERSION": "Only API-Version 2 is supported",
    "MALFORMED_JSON": "The request body is not valid JSON",
    "INVALID_CURSOR": "This cursor is not valid",
    "READ_ONLY_QUERY": "Graph queries are read-only",
    "CYPHER_SYNTAX": "The statement does not follow the query grammar",
    "CYPHER_SEMANTIC": "The statement returns a variable it never bound",
    "RESET_TOKEN_INVALID": "This reset link is no longer valid",
    "UNAUTHENTICATED": "Sign in or send an API key",
    "INVALID_API_KEY": "This credential is not valid",
    "BAD_CREDENTIALS": "Email or password is incorrect",
    "TOTP_REQUIRED": "Enter the code from your authenticator app",
    "BAD_TOTP": "That code is not valid",
    "FORBIDDEN_ROLE": "Your role cannot do this",
    "DATABASE_NOT_FOUND": "Database not found",
    "SOURCE_NOT_FOUND": "Source not found",
    "COLLECTION_NOT_FOUND": "Collection not found",
    "REQUEST_NOT_FOUND": "No answered request has this id",
    "MEMBER_NOT_FOUND": "Member not found",
    "KEY_NOT_FOUND": "API key not found",
    "JOB_NOT_FOUND": "Job not found",
    "ROUTE_NOT_FOUND": "No route matches this address",
    "DATABASE_NOT_READY": "This database is still provisioning",
    "DATABASE_ALREADY_EXISTS": "A database with this name already exists",
    "MEMBER_EXISTS": "A member with this email already exists",
    "LAST_OWNER": "An organization needs at least one owner",
    "PLAN_DOWNGRADE_BLOCKED": "Ship allows 3 databases. Delete databases before switching.",
    "KEY_REVOKED": "This API key is revoked",
    "JOB_NOT_FINISHED": "This export is not finished",
    "IDEMPOTENCY_IN_PROGRESS": "A request with this idempotency key is still running",
    "COLLECTION_NOT_EMPTY": "Delete the sources in this collection first",
    "COLLECTION_IS_DEFAULT": "The default collection cannot be deleted",
    "TOTP_ALREADY_ON": "Two-step sign-in is already on",
    "TOTP_NOT_ON": "Two-step sign-in is off",
    "PAYLOAD_TOO_LARGE": "The request body is over 2 MB",
    "IDEMPOTENCY_KEY_REUSED": "This idempotency key was used with a different request",
}

Q_ATLAS = "MATCH (a {name: 'Atlas Launch'})-[:OWNED_BY]->(o) RETURN o.name"
Q_BLOCKER = "MATCH (a {name: 'atlas launch'})-[:BLOCKED_BY]->(b)-[:OWNED_BY]->(o) RETURN b.name, o.name"
Q_MARCO = "MATCH (m {name: 'Marco Silva'})<-[:OWNED_BY]-(w) RETURN w"
Q_STARTS = "MATCH (a)-[:OWNED_BY]->(o) WHERE o.name STARTS WITH 'm' RETURN a.name"
Q_COUNT = "MATCH (a)-[:OWNED_BY]->(o) RETURN count(*)"
SERVED_LINE = "Served from index generation {g} at LSN {l} plus {w} pending write log entries"
FOLDED_LINE = "Folded {n} entries into generation {g}"


def summary_line(entities, relations_):
    return f"{entities} entities, {relations_} relations"


def role_change(old, new):
    return f"{old} -> {new}"


def etag(version):
    return '"' + str(version) + '"'


def call(base, method, path, token=None, body=ABSENT, *, version="2", params=None, headers=None, raw=None):
    sent = {}
    if version is not None:
        sent["API-Version"] = version
    if token:
        sent["Authorization"] = f"Bearer {token}"
    if body is not ABSENT:
        raw = json.dumps(body).encode()
    if raw is not None:
        sent["Content-Type"] = "application/json"
    sent.update(headers or {})
    return httpx.request(method, base + path, headers=sent, params=params, content=raw, timeout=HTTP_TIMEOUT)


def envelope(r):
    assert r.status_code < 500, r.text
    for leak in LEAKS:
        assert leak not in r.text, r.text
    body = r.json()
    assert set(body) == {"success", "data", "error", "meta"}, body
    assert set(body["meta"]) == {"request_id", "latency_ms"}, body["meta"]
    assert UUID4.match(body["meta"]["request_id"]), body["meta"]
    assert isinstance(body["meta"]["latency_ms"], int) and not isinstance(body["meta"]["latency_ms"], bool)
    return body


def ok(r, status=200):
    body = envelope(r)
    assert r.status_code == status, r.text
    assert body["success"] is True and body["error"] is None, body
    return body["data"]


def refused(r, status, code, field=ABSENT, message=None):
    body = envelope(r)
    assert r.status_code == status, r.text
    assert body["success"] is False and body["data"] is None, body
    assert set(body["error"]) == {"code", "message", "field"}, body["error"]
    assert body["error"]["code"] == code, body["error"]
    expected = message or MESSAGES.get(code)
    if expected is not None:
        assert body["error"]["message"] == expected, body["error"]
    if field is not ABSENT:
        assert body["error"]["field"] == field, body["error"]
    return body["error"]


def throttled(r, code):
    seconds = int(r.headers["Retry-After"])
    template = {"RATE_LIMITED": "Too many requests. Try again in {} seconds.",
                "SIGN_IN_THROTTLED": "Too many sign-in attempts. Try again in {} seconds."}[code]
    refused(r, 429, code, message=template.format(seconds))
    return seconds


def login_raw(base, email, password=PASSWORD, **extra):
    return call(base, "POST", "/api/auth/login", body={"email": email, "password": password, **extra}, version=None)


def login(base, email, password=PASSWORD, **extra):
    data = ok(login_raw(base, email, password, **extra))
    assert set(data) == {"token", "member"}
    return data["token"]


def fresh_email(prefix="m"):
    for value in unique(prefix):
        if "@" in value:
            return value.lower()
    local = re.sub(r"[^a-z0-9.]", "", unique(prefix)[0].lower()) or uuid.uuid4().hex
    return f"{local}.{uuid.uuid4().hex[:6]}@example.com"


def fresh_name(prefix="t"):
    return (prefix + uuid.uuid4().hex)[:20]


def fresh_id(prefix="s"):
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def fact(subject, predicate, obj, valid_from, reason=""):
    return {"subject": subject, "predicate": predicate, "object": obj, "valid_from": valid_from, "reason": reason}


def src(sid, title, text, facts=(), **extra):
    body = {"title": title, "text": text, "facts": list(facts)}
    if sid is not None:
        body["id"] = sid
    body.update(extra)
    return body


def ingest(base, token, db, sources, collection=None, key=None):
    body = {"database": db, "sources": sources}
    if collection:
        body["collection"] = collection
    return call(base, "POST", "/api/v2/context/ingest", token, body, headers={"Idempotency-Key": key} if key else None)


def cypher(base, token, db, stmt, as_of=None):
    body = {"database": db, "query_by": "cypher", "cypher": stmt}
    if as_of:
        body["as_of"] = as_of
    return call(base, "POST", "/api/v2/query", token, body)


def answer_rows(base, token, db, stmt, as_of=None):
    return ok(cypher(base, token, db, stmt, as_of))["rows"]


def search(base, token, db, query, collections=None, max_results=None):
    body = {"database": db, "query_by": "text", "query": query}
    if collections is not None:
        body["collections"] = collections
    if max_results is not None:
        body["max_results"] = max_results
    return call(base, "POST", "/api/v2/query", token, body)


def stats(base, token, db):
    return ok(call(base, "GET", "/api/v2/databases/stats", token, params={"database": db}))


def compact(base, token, db):
    return call(base, "POST", "/api/v2/databases/compact", token, {"database": db})


def relations(base, token, db, entity, as_of=None):
    params = {"database": db, "entity": entity}
    if as_of:
        params["as_of"] = as_of
    return ok(call(base, "GET", "/api/v2/context/relations", token, params=params))


def history(base, token, db, entity, predicate):
    return ok(call(base, "GET", "/api/v2/context/history", token,
                   params={"database": db, "entity": entity, "predicate": predicate}))


def graph(base, token, db, as_of=None, predicates=None):
    params = {"database": db}
    if as_of:
        params["as_of"] = as_of
    if predicates:
        params["predicates"] = predicates
    return ok(call(base, "GET", "/api/v2/context/graph", token, params=params))


def delete_source(base, token, db, sid, collection="default"):
    return call(base, "DELETE", "/api/v2/context", token, params={"database": db, "collection": collection, "id": sid})


def restore(base, token, db, sid, collection="default"):
    return call(base, "POST", "/api/v2/context/restore", token, {"database": db, "collection": collection, "id": sid})


def usage(base, token):
    return ok(call(base, "GET", "/api/v2/usage", token))


def audit(base, token, headers=None, **params):
    return call(base, "GET", "/api/v2/audit", token, params=params, headers=headers)


def wait_ready(base, token, db):
    deadline = time.monotonic() + READY_DEADLINE
    while ok(call(base, "GET", "/api/v2/databases/status", token, params={"database": db}))["status"] != "ready":
        assert time.monotonic() < deadline, f"{db} never became ready"


def race(callables):
    barrier = threading.Barrier(len(callables))

    def run(fn):
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(callables)) as pool:
        return list(pool.map(run, callables))


def tokens(value):
    return [t for t in re.split(r"[^a-z0-9]+", unicodedata.normalize("NFC", value).lower()) if t]


def token_count(title, text):
    return len(tokens(title + " " + text))


def terms(title, text):
    return [t for t in tokens(title + " " + text) if t not in STOPWORDS]


def storage_of(sources):
    return sum(len(s["title"].encode()) + len(s["text"].encode()) + STORAGE_PER_FACT * len(s["facts"]) for s in sources)


def half_up(value, places=4):
    return float(Decimal(repr(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def ceil_div(a, b):
    return -(-a // b)


def expected_search(docs, query, max_results=5):
    phrases = [[t for t in tokens(p) if t not in STOPWORDS] for p in re.findall(r'"([^"]*)"', query)]
    excluded, plain = [], []
    for word in re.sub(r'"[^"]*"', " ", query).split():
        (excluded if word.startswith("-") else plain).extend(tokens(word.lstrip("-")))
    for phrase in phrases:
        plain.extend(phrase)
    qterms = list(dict.fromkeys(t for t in plain if t not in STOPWORDS))
    bag = {(d[0], d[1]): terms(d[2], d[3]) for d in docs}
    n_docs = len(docs)
    avgdl = sum(len(v) for v in bag.values()) / n_docs

    def holds(ts, phrase):
        return any(ts[i:i + len(phrase)] == phrase for i in range(len(ts) - len(phrase) + 1))

    found = []
    for sid, coll, title, text in docs:
        ts = bag[(sid, coll)]
        if any(t in ts for t in excluded) or not all(holds(ts, p) for p in phrases):
            continue
        score = 0.0
        for t in qterms:
            f = ts.count(t)
            if f:
                n = sum(1 for v in bag.values() if t in v)
                idf = math.log(1 + (n_docs - n + 0.5) / (n + 0.5))
                score += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * len(ts) / avgdl))
        if score > 0:
            found.append((score, sid, coll, title, text[:SNIPPET]))
    found.sort(key=lambda r: (-r[0], r[1], r[2]))
    return [{"id": s, "collection": c, "title": t, "score": half_up(sc), "snippet": sn}
            for sc, s, c, t, sn in found[:max_results]]


def assert_results(actual, expected):
    assert [(r["id"], r["collection"]) for r in actual] == [(r["id"], r["collection"]) for r in expected]
    for a, e in zip(actual, expected):
        assert set(a) == {"id", "collection", "title", "score", "snippet"}
        assert a["title"] == e["title"] and a["snippet"] == e["snippet"]
        assert math.isclose(a["score"], e["score"], abs_tol=1e-9), (a, e)


def totp(secret, step):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def now_step():
    return int(time.time() // TOTP_STEP)


def mails(mail, to, subject, minimum=1):
    deadline = time.monotonic() + MAIL_DEADLINE
    while True:
        found = [m for m in mail.messages()
                 if to.lower() in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject]
        if len(found) >= minimum or time.monotonic() > deadline:
            return found


def sql(value):
    return "'" + str(value).replace("'", "''") + "'"


def db_id(pg, org, name):
    rows = pg.rows(f"select d.id::text as id from databases d join organizations o on o.id = d.organization_id "
                   f"where o.name = {sql(org)} and d.name = {sql(name)}")
    return rows[0]["id"] if rows else None


def wal(pg, org, name):
    return pg.rows(f"select w.lsn as lsn, w.kind as kind from wal_entries w join databases d on d.id = w.database_id "
                   f"join organizations o on o.id = d.organization_id where o.name = {sql(org)} and d.name = {sql(name)} "
                   f"order by w.lsn")


def tables_holding(pg, needle):
    hits = []
    for table in pg.tables():
        qualified = ".".join(f'"{part}"' for part in table.split("."))
        count = pg.rows(f"select count(*) as n from {qualified} x where x::text like {sql('%' + needle + '%')}")[0]["n"]
        if count:
            hits.append(table)
    return hits


class Org:
    def __init__(self, base, owner_email):
        self.base = base
        self.token = login(base, owner_email)
        self.databases, self.members, self.keys = [], [], []

    def create_db(self, prefix="t", wait=True):
        name = fresh_name(prefix)
        data = ok(call(self.base, "POST", "/api/v2/databases", self.token, {"name": name}), 201)
        assert data["name"] == name and data["status"] == "provisioning"
        self.databases.append(name)
        if wait:
            wait_ready(self.base, self.token, name)
        return name

    def add_member(self, role, prefix="m", password=PASSWORD):
        email = fresh_email(prefix)
        ok(call(self.base, "POST", "/api/v2/members", self.token, {"email": email, "role": role, "password": password}), 201)
        self.members.append(email)
        return email, login(self.base, email, password)

    def add_key(self, role, databases=ABSENT, name=None, token=None):
        body = {"name": name or fresh_id("k"), "role": role}
        if databases is not ABSENT:
            body["databases"] = databases
        data = ok(call(self.base, "POST", "/api/v2/keys", token or self.token, body), 201)
        self.keys.append(data["id"])
        return data

    def close(self):
        for name in self.databases:
            call(self.base, "DELETE", "/api/v2/databases", self.token, params={"database": name})
        for kid in self.keys:
            call(self.base, "DELETE", f"/api/v2/keys/{kid}", self.token)
        for email in self.members:
            call(self.base, "DELETE", f"/api/v2/members/{quote(email, safe='@')}", self.token)


@pytest.fixture
def base(app_url):
    return app_url.rstrip("/")


@pytest.fixture
def acme(base):
    org = Org(base, ACME_OWNER)
    yield org
    org.close()


@pytest.fixture
def northwind(base):
    org = Org(base, NW_OWNER)
    yield org
    org.close()


@pytest.fixture
def pg():
    return Postgres()


def sign_in_form(page, email, password=PASSWORD):
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign in").click()


@contextmanager
def signed_in(browser, base, email, path, password=PASSWORD, viewport=None, **kwargs):
    with open_app(browser, f"{base}/login?next={quote(path, safe='')}", **kwargs) as page:
        page.set_viewport_size(viewport or DESKTOP)
        sign_in_form(page, email, password)
        target = urlparse(path).path
        page.wait_for_url(lambda u: urlparse(u).path == target, timeout=UI_TIMEOUT_MS)
        yield page


def eventually(page, check, seconds=UI_DEADLINE):
    deadline = time.monotonic() + seconds
    while True:
        try:
            check()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, STEP_MS)


def shows(page, locator, text=None):
    if text is None:
        eventually(page, lambda: expect(locator).to_be_visible(timeout=POLL_MS))
    else:
        eventually(page, lambda: expect(locator).to_contain_text(text, timeout=POLL_MS))


def query_of(page):
    return parse_qs(urlparse(page.url).query)


def textbox(page, name):
    return page.get_by_role("textbox", name=name, exact=True)


def fill_ingest(page, sid, title, text, facts):
    if sid is not None:
        textbox(page, "Source id").fill(sid)
    textbox(page, "Title").fill(title)
    textbox(page, "Text").fill(text)
    for _ in range(FACTS_MAX):
        if textbox(page, "Subject").count() >= len(facts):
            break
        page.get_by_role("button", name="Add fact").click()
    for i, f in enumerate(facts):
        textbox(page, "Subject").nth(i).fill(f["subject"])
        textbox(page, "Predicate").nth(i).fill(f["predicate"])
        textbox(page, "Object").nth(i).fill(f["object"])
        textbox(page, "Valid from").nth(i).fill(f["valid_from"])
        textbox(page, "Reason").nth(i).fill(f["reason"])


def busy_ancestor(locator):
    return locator.evaluate("el => { for (let e = el; e; e = e.parentElement) "
                            "if (e.getAttribute('aria-busy') === 'true') return true; return false; }")


def gap(box, rect):
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    dx = max(rect["x"] - cx, 0, cx - (rect["x"] + rect["width"]))
    dy = max(rect["y"] - cy, 0, cy - (rect["y"] + rect["height"]))
    return math.hypot(dx, dy)


def nearer(target, other, box):
    return gap(box, target.bounding_box()) < gap(box, other.bounding_box())


FIELD_MESSAGE = ("els => els.filter(e => !e.closest('[role=status]') && e.getClientRects().length)"
                 ".map(e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; })")


def field_message(page, message):
    boxes = []

    def check():
        found = page.get_by_text(message).evaluate_all(FIELD_MESSAGE)
        assert found, message
        boxes[:] = found

    eventually(page, check)
    return boxes[0]


class Head(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title, self.description, self.links, self._in_title = "", None, [], False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "meta" and a.get("name") == "description":
            self.description = a.get("content")
        if tag == "a":
            self.links.append(a.get("href"))

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def head_of(html):
    parser = Head()
    parser.feed(html)
    return parser


def test_wf_write_log_ui_ingest(browser, base, acme, pg):
    db = acme.create_db("wl")
    editor, editor_token = acme.add_member("editor")
    sid = fresh_id("atlas")
    facts = [fact("Atlas Launch", "OWNED_BY", "Priya Raman", "2026-01-05T09:00:00Z", "Kickoff assignment"),
             fact("Atlas Launch", "OWNED_BY", "Ravi Menon", "2026-05-01T00:00:00Z", "Handover")]
    with signed_in(browser, base, editor, f"/console/db/{db}?tab=sources") as page:
        page.get_by_role("button", name="Ingest source").click()
        fill_ingest(page, sid, "Atlas launch kickoff", "Priya Raman owns the Atlas launch.", facts)
        page.get_by_role("button", name="Ingest", exact=True).dblclick()
        row = page.get_by_role("row").filter(has_text=sid)
        shows(page, row, "In write log")
        assert stats(base, editor_token, db)["last_lsn"] == 1
        assert [w["kind"] for w in wal(pg, ACME, db)] == ["ingest"]
        listed = ok(call(base, "POST", "/api/v2/context/list", editor_token, {"database": db, "collection": "default"}))
        assert [(s["id"], s["version"], s["facts"]) for s in listed["sources"]] == [(sid, 1, 2)]
        before = (answer_rows(base, editor_token, db, Q_ATLAS),
                  answer_rows(base, editor_token, db, Q_ATLAS, "2026-03-11T00:00:00Z"))
        assert before == ([["Ravi Menon"]], [["Priya Raman"]])

        page.get_by_role("tab", name="Graph query").click()
        page.get_by_role("textbox", name="Statement").fill(Q_ATLAS)
        page.get_by_role("button", name="Run").click()
        shows(page, page.get_by_role("cell", name="Ravi Menon"))

        page.get_by_role("tab", name="Stats").click()
        page.get_by_role("button", name="Compact").click()
        shows(page, page.get_by_text(FOLDED_LINE.format(n=1, g=1)).first)
        page.get_by_role("tab", name="Sources").click()
        shows(page, page.get_by_role("row").filter(has_text=sid), "Indexed")
    after = stats(base, editor_token, db)
    assert (after["indexed_lsn"], after["index_generation"], after["wal_pending"]) == (1, 1, 0)
    assert (answer_rows(base, editor_token, db, Q_ATLAS),
            answer_rows(base, editor_token, db, Q_ATLAS, "2026-03-11T00:00:00Z")) == before


def test_wf_write_log_numbering(base, acme, pg):
    db = acme.create_db("wn")
    t = acme.token
    ids = [fresh_id("a"), fresh_id("b"), fresh_id("c")]
    batch = [src(ids[0], "Ledger plan", "The ledger service moves to the platform.",
                 [fact("Ledger Service", "OWNED_BY", "Marco Silva", "2026-02-01T00:00:00Z")]),
             src(ids[1], "Atlas plan", "Atlas launch review notes.",
                 [fact("Atlas Launch", "BLOCKED_BY", "Ledger Service", "2026-02-02T00:00:00Z")]),
             src(ids[2], "Retro", "Ledger retro notes.", [])]
    results = ok(ingest(base, t, db, batch), 201)["results"]
    assert [(r["id"], r["version"], r["lsn"], r["indexing_status"]) for r in results] == \
        [(ids[0], 1, 1, "graph_creation"), (ids[1], 1, 2, "graph_creation"), (ids[2], 1, 3, "graph_creation")]
    v2_title = fresh_id("Ledger")
    second = ok(ingest(base, t, db, [src(ids[0], v2_title, "The ledger service moved.",
                                         [fact("Ledger Service", "OWNED_BY", "Dana Okafor", "2026-03-01T00:00:00Z")])]), 201)
    assert [(r["version"], r["lsn"]) for r in second["results"]] == [(2, 4)]
    assigned = ok(ingest(base, t, db, [src(None, "Anon", "Assigned id source.", [])]), 201)["results"][0]
    assert re.fullmatch(r"src_[0-9a-f]{12}", assigned["id"]) and assigned["lsn"] == 5
    assert [w["lsn"] for w in wal(pg, ACME, db)] == [1, 2, 3, 4, 5]

    r = call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": ids[0]})
    data = ok(r)
    assert r.headers["ETag"] == etag(2) and data["version"] == 2 and data["title"] == v2_title
    assert [f["object"] for f in data["facts"]] == ["Marco Silva", "Dana Okafor"]
    cached = call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": ids[0]},
                  headers={"If-None-Match": etag(2)})
    assert cached.status_code == 304 and cached.content == b""

    def reads():
        return (ok(search(base, t, db, "ledger"))["results"],
                answer_rows(base, t, db, "MATCH (a)-[:OWNED_BY]->(o) RETURN a.name, o.name"),
                relations(base, t, db, "ledger service")["outgoing"],
                history(base, t, db, "Ledger Service", "OWNED_BY")["facts"],
                graph(base, t, db)["edges"])

    pending = reads()
    assert [x["id"] for x in pending[0]] and pending[1] == [["Ledger Service", "Dana Okafor"]]
    folded = ok(compact(base, t, db))
    assert folded == {"generation": 1, "folded_entries": 5, "indexed_lsn": 5}
    assert reads() == pending
    assert ok(compact(base, t, db)) == {"generation": 1, "folded_entries": 0, "indexed_lsn": 5}

    ok(delete_source(base, t, db, ids[0]))
    assert ids[0] not in [x["id"] for x in ok(search(base, t, db, "ledger"))["results"]]
    assert answer_rows(base, t, db, "MATCH (a)-[:OWNED_BY]->(o) RETURN a.name, o.name") == []
    ok(restore(base, t, db, ids[0]))
    assert reads() == pending


def test_wf_time_travel_seed_answers(browser, base):
    v = login(base, NW_VIEWER)
    worked = [(Q_ATLAS, "2026-02-15T00:00:00Z", [["Priya Raman"]]),
              (Q_ATLAS, "2026-03-11T00:00:00Z", [["Dana Okafor"]]),
              (Q_BLOCKER, "2026-03-20T00:00:00Z", [["Billing Migration", "Marco Silva"]]),
              (Q_BLOCKER, "2026-04-03T00:00:00Z", [["Security Review", "Lena Brandt"]]),
              (Q_MARCO, "2026-03-20T00:00:00Z", [["Billing Migration"], ["Ledger Service"]])]
    for stmt, as_of, expected in worked:
        assert answer_rows(base, v, LAUNCH, stmt, as_of) == expected, stmt
    s = stats(base, v, LAUNCH)
    assert (s["sources"], s["facts"], s["entities"], s["last_lsn"], s["indexed_lsn"], s["index_generation"]) == (4, 8, 8, 4, 4, 1)
    g = graph(base, v, LAUNCH, "2026-03-20T00:00:00Z")
    assert g["nodes"] == ["Atlas Launch", "Billing Migration", "Dana Okafor", "Ledger Service", "Marco Silva"]
    assert [(e["subject"], e["predicate"], e["object"]) for e in g["edges"]] == [
        ("Atlas Launch", "BLOCKED_BY", "Billing Migration"), ("Atlas Launch", "OWNED_BY", "Dana Okafor"),
        ("Billing Migration", "DEPENDS_ON", "Ledger Service"), ("Billing Migration", "OWNED_BY", "Marco Silva"),
        ("Ledger Service", "OWNED_BY", "Marco Silva")]
    owned = graph(base, v, LAUNCH, "2026-03-20T00:00:00Z", "OWNED_BY")
    assert [e["subject"] for e in owned["edges"]] == ["Atlas Launch", "Billing Migration", "Ledger Service"]
    rel = relations(base, v, LAUNCH, "  atlas LAUNCH ", "2026-03-20T00:00:00Z")
    assert [(x["predicate"], x["other"], x["valid_from"], x["source_id"]) for x in rel["outgoing"]] == [
        ("BLOCKED_BY", "Billing Migration", "2026-02-01T00:00:00Z", "kickoff-notes"),
        ("OWNED_BY", "Dana Okafor", "2026-03-10T12:00:00Z", "reorg-memo")]
    assert rel["incoming"] == []
    hist = history(base, v, LAUNCH, "ATLAS launch", "OWNED_BY")["facts"]
    assert hist == [
        {"object": "Priya Raman", "valid_from": "2026-01-05T09:00:00Z", "superseded_at": "2026-03-10T12:00:00Z",
         "reason": "Kickoff assignment", "source_id": "kickoff-notes", "lsn": 1},
        {"object": "Dana Okafor", "valid_from": "2026-03-10T12:00:00Z", "superseded_at": None,
         "reason": "Priya moved to the platform team", "source_id": "reorg-memo", "lsn": 2}]
    assert answer_rows(base, v, LAUNCH, "MATCH (a {name: 'Acme Rollout'})-[:OWNED_BY]->(o) RETURN o.name") == []
    acme_graph = graph(base, login(base, ACME_OWNER), LAUNCH, "2026-03-20T00:00:00Z")
    assert acme_graph["nodes"] == ["Acme Rollout", "Jordan Lee"]

    path = f"/console/db/{LAUNCH}?tab=entity&entity=Atlas%20Launch&as_of=2026-03-11T00:00:00Z"
    with signed_in(browser, base, NW_VIEWER, path) as page:
        shows(page, page.get_by_role("link", name="Dana Okafor").first)
        expect(page.get_by_text("current").first).to_be_visible()
        expect(page.get_by_text("Priya Raman").first).to_be_visible()
        page.reload()
        shows(page, page.get_by_role("link", name="Dana Okafor").first)
        assert query_of(page)["entity"] == ["Atlas Launch"]
        page.get_by_role("link", name="Dana Okafor").first.click()
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"entity=Dana"), timeout=POLL_MS))


def test_wf_time_travel_explore(browser, base):
    path = f"/console/db/{LAUNCH}?tab=explore&as_of=2026-03-20T00:00:00Z"
    with signed_in(browser, base, NW_VIEWER, path) as page:
        shows(page, page.get_by_text(summary_line(5, 5)))
        slider = page.get_by_role("slider", name="As of moment")
        expect(slider).to_have_attribute("aria-valuetext", "2026-03-14T10:00:00Z")
        slider.focus()
        page.keyboard.press("End")
        eventually(page, lambda: expect(slider).to_have_attribute("aria-valuetext", "now", timeout=POLL_MS))
        shows(page, page.get_by_text(summary_line(7, 6)))
        page.keyboard.press("Home")
        eventually(page, lambda: expect(slider).to_have_attribute("aria-valuetext", "2026-01-05T09:00:00Z", timeout=POLL_MS))
        shows(page, page.get_by_text(summary_line(4, 2)))
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: expect(slider).to_have_attribute("aria-valuetext", "2026-03-10T12:00:00Z", timeout=POLL_MS))
        shows(page, page.get_by_text(summary_line(4, 3)))
        assert query_of(page)["as_of"] == ["2026-03-10T12:00:00Z"]

        page.get_by_role("textbox", name="Find entity").fill("silva")
        shows(page, page.get_by_text("1 matching entity"))
        atlas = page.get_by_role("button", name="Atlas Launch", exact=True)
        atlas.focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("button", name="Billing Migration", exact=True)).to_be_focused()
        atlas.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(atlas).to_have_attribute("aria-pressed", "true", timeout=POLL_MS))
        region = page.get_by_role("region", name=" ".join(("Inspect", "Atlas Launch")))
        shows(page, region, " ".join(("BLOCKED_BY", "Billing Migration")))
        expect(region).to_contain_text(" ".join(("OWNED_BY", "Dana Okafor")))
        expect(region).to_contain_text("Outgoing")
        expect(region).to_contain_text("Incoming")

        page.get_by_role("group", name="Predicate").get_by_role("checkbox", name="OWNED_BY").uncheck()
        eventually(page, lambda: expect(page.get_by_role("button", name="Dana Okafor", exact=True)).to_have_count(0, timeout=POLL_MS))
        expect(page.get_by_role("button", name="Billing Migration", exact=True)).to_be_visible()
        state = query_of(page)
        assert state["node"] == ["Atlas Launch"] and state["as_of"] == ["2026-03-10T12:00:00Z"]
        page.reload()
        shows(page, page.get_by_role("region", name=" ".join(("Inspect", "Atlas Launch"))))
        expect(page.get_by_role("button", name="Dana Okafor", exact=True)).to_have_count(0)


def test_wf_time_travel_restore_ties(base, acme):
    db = acme.create_db("tt")
    t = acme.token
    a, b, c = fresh_id("a"), fresh_id("b"), fresh_id("c")
    ok(ingest(base, t, db, [src(a, "A", "Source a.", [fact("X", "OWNED_BY", "Ann", "2026-02-01T00:00:00Z", "first")])]), 201)
    ok(ingest(base, t, db, [src(b, "B", "Source b.", [fact("x", "OWNED_BY", "Dana Okafor", "2026-02-01T00:00:00Z", "second")])]), 201)
    ok(ingest(base, t, db, [src(c, "C", "Source c.", [fact(" X ", "OWNED_BY", "Cid", "2026-01-01T00:00:00Z", "older")])]), 201)
    q = "MATCH (x {name: 'x'})-[:OWNED_BY]->(o) RETURN o"
    assert answer_rows(base, t, db, q) == [["Dana Okafor"]]
    assert answer_rows(base, t, db, q, "2026-01-15T00:00:00Z") == [["Cid"]]
    before = history(base, t, db, "x", "OWNED_BY")["facts"]
    assert [(f["object"], f["lsn"], f["superseded_at"]) for f in before] == [
        ("Cid", 3, "2026-02-01T00:00:00Z"), ("Ann", 1, "2026-02-01T00:00:00Z"), ("Dana Okafor", 2, None)]
    assert relations(base, t, db, "X")["outgoing"][0]["other"] == "Dana Okafor"
    ok(delete_source(base, t, db, a))
    restored = ok(restore(base, t, db, a))
    assert (restored["version"], restored["lsn"], restored["indexing_status"]) == (1, 5, "graph_creation")
    assert answer_rows(base, t, db, q) == [["Dana Okafor"]]
    assert history(base, t, db, "x", "OWNED_BY")["facts"] == before


def test_wf_graph_language_statements(base):
    v = login(base, NW_VIEWER)
    at = "2026-03-20T00:00:00Z"
    answer = ok(cypher(base, v, LAUNCH, Q_STARTS, at))
    assert set(answer) == {"columns", "rows", "as_of", "served_from"}
    assert answer["columns"] == ["a.name"] and answer["rows"] == [["Billing Migration"], ["Ledger Service"]]
    assert answer["as_of"] == at
    assert answer["served_from"] == {"index_generation": 1, "indexed_lsn": 4, "wal_entries_applied": 0}
    counted = ok(cypher(base, v, LAUNCH, Q_COUNT, at))
    assert counted["columns"] == ["count(*)"] and counted["rows"] == [[3]]
    expectations = {
        "match (a)-[:OWNED_BY]->(o) where o.name starts with 'm' return a.name": [["Billing Migration"], ["Ledger Service"]],
        "MATCH (a)-[:OWNED_BY]->(o) RETURN a.name, o.name": [["Atlas Launch", "Dana Okafor"], ["Billing Migration", "Marco Silva"], ["Ledger Service", "Marco Silva"]],
        "MATCH (a)-[:OWNED_BY]->(o) RETURN DISTINCT o.name ORDER BY o.name DESC": [["Marco Silva"], ["Dana Okafor"]],
        "MATCH (a)-[:OWNED_BY]->(o) RETURN a.name ORDER BY a.name DESC LIMIT 2": [["Ledger Service"], ["Billing Migration"]],
        "MATCH (a)-[:OWNED_BY]->(o) WHERE NOT o.name = 'MARCO SILVA' RETURN a.name": [["Atlas Launch"]],
        "MATCH (a)-[:OWNED_BY]->(o) WHERE a.name CONTAINS 'i' AND o.name ENDS WITH 'silva' RETURN a": [["Billing Migration"], ["Ledger Service"]],
        "MATCH (x)-[:DEPENDS_ON*1..3]->(y) RETURN x, y": [["Billing Migration", "Ledger Service"]],
        "MATCH (a)-[:OWNED_BY]->(o) RETURN o.name": [["Dana Okafor"], ["Marco Silva"], ["Marco Silva"]],
        "MATCH (a {name: 'O\\'Hara'}) RETURN a": [],
        "MATCH (a {name: 'CREATE'}) RETURN a": [],
        "MATCH (a)-[:OWNED_BY]->(o) WHERE o.name = 'marco silva' RETURN count(*)": [[2]],
    }
    for stmt, expected in expectations.items():
        assert answer_rows(base, v, LAUNCH, stmt, at) == expected, stmt
    refusals = [("CREATE (a)", "READ_ONLY_QUERY"), ("MATCH (a) DETACH DELETE a", "READ_ONLY_QUERY"),
                ("MATCH (a) SET a.name = 'x' RETURN a", "READ_ONLY_QUERY"), ("MATCH (a RETURN b", "CYPHER_SYNTAX"),
                ("MATCH (a) RETURN a LIMIT 0", "CYPHER_SYNTAX"), ("MATCH (a) RETURN a LIMIT 1001", "CYPHER_SYNTAX"),
                ("MATCH (a)-[:OWNED_BY*0..2]->(b) RETURN b", "CYPHER_SYNTAX"),
                ("MATCH (a) RETURN b", "CYPHER_SEMANTIC"), ("MATCH (a) WHERE b.name = 'x' RETURN a", "CYPHER_SEMANTIC"),
                ("MATCH (a) RETURN count(*), a", "CYPHER_SEMANTIC"), ("MATCH (a) RETURN DISTINCT count(*)", "CYPHER_SEMANTIC"),
                ("MATCH (a) RETURN count(*), count(*)", "CYPHER_SEMANTIC"), ("MATCH (a) CALL x RETURN b", "READ_ONLY_QUERY")]
    for stmt, code in refusals:
        refused(cypher(base, v, LAUNCH, stmt, at), 400, code, field="cypher")
    deep = "MATCH (a)-[:OWNED_BY*1..5]->(b)<-[:OWNED_BY*1..5]-(c)-[:BLOCKED_BY*1..5]->(d) RETURN a, b, c, d"
    timings = []
    for _ in range(3):
        started = time.monotonic()
        ok(cypher(base, v, LAUNCH, deep, at))
        timings.append((time.monotonic() - started) * 1000)
    assert min(timings) < GRAPH_BUDGET_MS, timings


def test_wf_graph_language_query_tab(browser, base):
    with signed_in(browser, base, NW_VIEWER, f"/console/db/{LAUNCH}?tab=graph") as page:
        statement = page.get_by_role("textbox", name="Statement")
        statement.fill(Q_ATLAS)
        page.get_by_role("textbox", name="As of").fill("2026-03-11T00:00:00Z")
        statement.press("Control+Enter")
        shows(page, page.get_by_role("cell", name="Dana Okafor"))
        expect(page.get_by_role("columnheader", name="o.name")).to_be_visible()
        expect(page.get_by_text(SERVED_LINE.format(g=1, l=4, w=0))).to_be_visible()
        state = query_of(page)
        assert state["statement"] == [Q_ATLAS] and state["as_of"] == ["2026-03-11T00:00:00Z"] and state["tab"] == ["graph"]
        page.reload()
        shows(page, page.get_by_role("cell", name="Dana Okafor"))
        page.get_by_role("textbox", name="Statement").fill("MATCH (a RETURN a")
        page.get_by_role("button", name="Run").click()
        shows(page, page.get_by_text("CYPHER_SYNTAX").first)
        expect(page.get_by_role("cell", name="Dana Okafor")).to_be_visible()
    for method in ("GET", "PUT", "DELETE"):
        r = call(base, method, "/api/v2/query", version=None)
        refused(r, 405, "METHOD_NOT_ALLOWED", message=f"This address does not accept {method}")
        assert r.headers["Allow"] == "POST"


def test_wf_ingest_validation_boundaries(base, acme, pg):
    db = acme.create_db("iv")
    t = acme.token
    decomposed = "e\u0301"
    good = fact("Atlas Launch", "OWNED_BY", "Priya Raman", "2026-01-05T09:00:00Z")

    def one(**over):
        s = src(fresh_id("v"), "Title", "Body text.", [dict(good)])
        for k, val in over.items():
            if k.startswith("f_"):
                s["facts"][0][k[2:]] = val
            else:
                s[k] = val
        return s

    accepted = [one(title=decomposed * TITLE_MAX), one(text="x" * TEXT_MAX), one(id="a" * ID_MAX),
                one(facts=[dict(good)] * FACTS_MAX), one(facts=[]), one(f_subject="  " + "s" * ENTITY_MAX + "  "),
                one(f_predicate="A" + "B" * (PREDICATE_MAX - 1)), one(f_reason="r" * REASON_MAX),
                one(text="tab\there\nline\rreturn")]
    lsn = 0
    for s in accepted:
        lsn += 1
        assert ok(ingest(base, t, db, [s]), 201)["results"][0]["lsn"] == lsn
    lsn += SOURCES_MAX
    many = [src(fresh_id("m"), "T", "y" * TEXT_MAX, []) for _ in range(SOURCES_MAX)]
    assert ok(ingest(base, t, db, many), 201)["results"][-1]["lsn"] == lsn
    stored = ok(call(base, "GET", "/api/v2/context/source", t,
                     params={"database": db, "collection": "default", "id": accepted[0]["id"]}))
    assert stored["title"] == decomposed * TITLE_MAX

    refusals = [
        ([one(title=decomposed * (TITLE_MAX + 1))], "sources.0.title"), ([one(title="")], "sources.0.title"),
        ([one(text="x" * (TEXT_MAX + 1))], "sources.0.text"), ([one(id="a" * (ID_MAX + 1))], "sources.0.id"),
        ([one(id="bad id")], "sources.0.id"), ([one(facts=[dict(good)] * (FACTS_MAX + 1))], "sources.0.facts"),
        ([one(f_subject="s" * (ENTITY_MAX + 1))], "sources.0.facts.0.subject"), ([one(f_subject="   ")], "sources.0.facts.0.subject"),
        ([one(f_object="o" * (ENTITY_MAX + 1))], "sources.0.facts.0.object"),
        ([one(f_predicate="owned_by")], "sources.0.facts.0.predicate"), ([one(f_predicate="O")], "sources.0.facts.0.predicate"),
        ([one(f_predicate="A" + "B" * PREDICATE_MAX)], "sources.0.facts.0.predicate"),
        ([one(f_reason="r" * (REASON_MAX + 1))], "sources.0.facts.0.reason"),
        ([one(f_valid_from="2026-01-05T09:00:00.000Z")], "sources.0.facts.0.valid_from"),
        ([one(f_valid_from="2026-01-05T09:00:00+00:00")], "sources.0.facts.0.valid_from"),
        ([one(f_valid_from="2026-01-05 09:00:00")], "sources.0.facts.0.valid_from"),
        ([one(text="nul\x00here")], "sources.0.text"), ([one(f_reason="bell\x07")], "sources.0.facts.0.reason"),
        ([one(title="esc\x1b")], "sources.0.title"), ([one(f_subject="lone\ud800")], "sources.0.facts.0.subject"),
        ([one(), one(title="")], "sources.1.title"), ([one(), one(if_version=1, id=None)], "sources.1.if_version"),
        ([], "sources"), ([one() for _ in range(SOURCES_MAX + 1)], "sources"),
    ]
    for sources, field in refusals:
        for s in sources:
            if s.get("id") is None:
                s.pop("id", None)
        refused(ingest(base, t, db, sources), 400, "VALIDATION_ERROR", field=field)
    unknown = one()
    unknown["facts"][0]["extra"] = "x"
    refused(ingest(base, t, db, [unknown]), 400, "UNKNOWN_FIELD", field="sources.0.facts.0.extra",
            message="Unknown field sources.0.facts.0.extra")
    assert stats(base, t, db)["last_lsn"] == lsn
    assert len(wal(pg, ACME, db)) == lsn

    padded = json.dumps({"database": db, "sources": [one()]}).encode()
    exact = padded + b" " * (MAX_BODY - len(padded))
    assert len(exact) == MAX_BODY
    ok(call(base, "POST", "/api/v2/context/ingest", t, raw=exact), 201)
    refused(call(base, "POST", "/api/v2/context/ingest", t, raw=exact + b" "), 413, "PAYLOAD_TOO_LARGE")
    assert stats(base, t, db)["last_lsn"] == lsn + 1


def test_wf_ingest_validation_ui_errors(browser, base, acme):
    db = acme.create_db("ie")
    editor, editor_token = acme.add_member("editor")
    sid = fresh_id("ui")
    clean = fresh_id("notes")
    stray = clean + chr(1)
    lowered = "OWNED_BY".lower()
    facts = [fact("Atlas Launch", "OWNED_BY", "Priya Raman", "2026-01-05T09:00:00Z", "one"),
             fact("Atlas Launch", lowered, "Ravi Menon", "2026-05-01T00:00:00Z", "two")]
    mirror = refused(ingest(base, editor_token, db, [src(sid, "Pasted notes", clean, facts)]),
                     400, "VALIDATION_ERROR", field="sources.0.facts.1.predicate")
    control = refused(ingest(base, editor_token, db, [src(sid, "Pasted notes", stray, facts[:1])]),
                      400, "VALIDATION_ERROR", field="sources.0.text")
    with signed_in(browser, base, editor, f"/console/db/{db}?tab=sources") as page:
        page.get_by_role("button", name="Ingest source").click()
        fill_ingest(page, sid, "Pasted notes", clean, facts)
        page.get_by_role("button", name="Ingest", exact=True).click()
        box = field_message(page, mirror["message"])
        assert nearer(textbox(page, "Predicate").nth(1), textbox(page, "Predicate").nth(0), box)
        expect(textbox(page, "Predicate").nth(1)).to_have_value(lowered)
        expect(textbox(page, "Object").nth(1)).to_have_value("Ravi Menon")
        expect(textbox(page, "Title")).to_have_value("Pasted notes")
        page.get_by_role("button", name="Remove").nth(1).click()
        textbox(page, "Text").fill(stray)
        page.get_by_role("button", name="Ingest", exact=True).click()
        shows(page, page.get_by_text(control["message"]).first)
        expect(textbox(page, "Text")).to_have_value(stray)
        assert stats(base, editor_token, db)["last_lsn"] == 0
        textbox(page, "Text").fill(clean)
        page.get_by_role("button", name="Ingest", exact=True).click()
        shows(page, page.get_by_role("status").filter(has_text="Source ingested").first)
    assert stats(base, editor_token, db)["last_lsn"] == 1
    odd = [{"database": db, "sources": "x"}, {"database": db, "sources": [1]}, {"database": 5, "sources": []},
           {"database": db, "sources": [{"title": "t", "text": "x", "facts": {}}]},
           {"database": db, "sources": [{"title": "t", "text": "x", "facts": [], "if_version": 10 ** 30, "id": "a"}]},
           {"database": db, "sources": [{"title": ["t"], "text": "x", "facts": []}]}]
    for body in odd:
        r = call(base, "POST", "/api/v2/context/ingest", editor_token, body)
        assert r.status_code in (400, 409)
        assert envelope(r)["success"] is False
    for raw in (b"", b"{", b"\xff\xfe", b'{"database": "x"'):
        refused(call(base, "POST", "/api/v2/context/ingest", editor_token, raw=raw), 400, "MALFORMED_JSON", field=None)
    for raw in (b"[]", b"\"x\"", b"null", b"3"):
        refused(call(base, "POST", "/api/v2/context/ingest", editor_token, raw=raw), 400, "VALIDATION_ERROR", field=None)


def test_wf_ingest_validation_unicode_keys(base, acme):
    db = acme.create_db("uk")
    t = acme.token
    first = src(fresh_id("u"), "Caf\u00e9 notes", "Cafe\u0301 opens.",
                [fact("Caf\u00e9", "OWNED_BY", "Ana", "2026-01-01T00:00:00Z"),
                 fact("CAF\u00c9", "BLOCKED_BY", "Bo", "2026-01-01T00:00:00Z")])
    second = src(fresh_id("u"), "Second", "More.",
                 [fact("Cafe\u0301", "DEPENDS_ON", "Cy", "2026-01-01T00:00:00Z"),
                  fact("Cafe", "OWNED_BY", "Dee", "2026-01-01T00:00:00Z")])
    ok(ingest(base, t, db, [first, second]), 201)
    s = stats(base, t, db)
    assert s["entities"] == 6 and s["facts"] == 4
    assert s["storage_bytes"] == storage_of([first, second])
    assert s["tokens_ingested"] == token_count(first["title"], first["text"]) + token_count(second["title"], second["text"])
    out = relations(base, t, db, "cafe\u0301")["outgoing"]
    assert [(x["predicate"], x["other"]) for x in out] == [("BLOCKED_BY", "Bo"), ("DEPENDS_ON", "Cy"), ("OWNED_BY", "Ana")]
    assert [(x["predicate"], x["other"]) for x in relations(base, t, db, "CAFE")["outgoing"]] == [("OWNED_BY", "Dee")]
    nodes = graph(base, t, db)["nodes"]
    assert sorted(nodes) == sorted(["Ana", "Bo", "Cafe", "Caf\u00e9", "Cy", "Dee"])


def test_wf_keyword_search_scoring(base, acme):
    db = acme.create_db("ks")
    t = acme.token
    default = [("alpha-plan", "Billing migration plan", "The billing migration moves invoices to the ledger."),
               ("beta-notes", "Ledger notes", "Ledger service owns billing data. Billing billing."),
               ("gamma-retro", "Retro", "Migration of billing finished early."),
               ("epsilon", "Billing migration", "billing migration status"),
               ("tie-a", "Quarterly roadmap review", "Roadmap items for the quarter."),
               ("tie-b", "Quarterly roadmap review", "Roadmap items for the quarter."),
               ("literal", "<script>alert(1)</script>", "'; DROP TABLE sources; -- 100% of_us {\"$ne\": null}")]
    notes = [("tie-a", "Quarterly roadmap review", "Roadmap items for the quarter."),
             ("delta", "Billing migration notes", "Billing migration in the notes collection.")]
    ok(ingest(base, t, db, [src(i, ti, tx, []) for i, ti, tx in default]), 201)
    ok(ingest(base, t, db, [src(i, ti, tx, []) for i, ti, tx in notes], collection="notes"), 201)
    docs_default = [(i, "default", ti, tx) for i, ti, tx in default]
    docs_notes = [(i, "notes", ti, tx) for i, ti, tx in notes]
    assert_results(ok(search(base, t, db, "billing migration"))["results"], expected_search(docs_default, "billing migration"))
    assert_results(ok(search(base, t, db, "billing migration", max_results=2))["results"],
                   expected_search(docs_default, "billing migration", 2))
    phrase = ok(search(base, t, db, '"billing migration" -ledger'))["results"]
    assert [r["id"] for r in phrase] == ["epsilon"]
    assert_results(phrase, expected_search(docs_default, '"billing migration" -ledger'))
    both = ok(search(base, t, db, "roadmap", ["default", "notes"], SEARCH_MAX))["results"]
    assert [(r["id"], r["collection"]) for r in both] == [("tie-a", "default"), ("tie-a", "notes"), ("tie-b", "default")]
    assert_results(both, expected_search(docs_default + docs_notes, "roadmap", SEARCH_MAX))
    only_notes = ok(search(base, t, db, "billing", ["notes"]))["results"]
    assert [r["id"] for r in only_notes] == ["delta"]
    literal = ok(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": "literal"}))
    assert (literal["title"], literal["text"]) == (default[-1][1], default[-1][2])
    assert [r["id"] for r in ok(search(base, t, db, "script"))["results"]] == ["literal"]
    refused(search(base, t, db, "% the and"), 400, "VALIDATION_ERROR", field="query")

    v = login(base, NW_VIEWER)
    seed = [("kickoff-notes", "default", "Atlas launch kickoff", "Priya Raman owns the Atlas launch. The launch is blocked by the billing migration, which Marco Silva owns."),
            ("reorg-memo", "default", "Platform reorg memo", "Priya Raman moved to the platform team. Dana Okafor now owns the Atlas launch."),
            ("billing-standup", "default", "Billing standup notes", "The billing migration depends on the ledger service. Marco Silva owns the ledger service too."),
            ("launch-retro", "default", "Atlas launch retro", "The billing migration shipped. The Atlas launch is now blocked by the security review, owned by Lena Brandt.")]
    seeded = ok(search(base, v, LAUNCH, '"billing migration" -ledger'))["results"]
    assert sorted(r["id"] for r in seeded) == ["kickoff-notes", "launch-retro"]
    assert_results(seeded, expected_search(seed, '"billing migration" -ledger'))
    acme_hits = ok(search(base, t, LAUNCH, "billing migration"))["results"]
    assert not {r["id"] for r in acme_hits} & {"kickoff-notes", "launch-retro", "billing-standup"}


def test_wf_keyword_search_tab_feedback(browser, base, acme, pg):
    db = acme.create_db("sf")
    viewer, viewer_token = acme.add_member("viewer")
    first, later, markup = fresh_id("f"), fresh_id("g"), fresh_id("h")
    markup_title = "<script>alert(1)</script>" + "%" + "_"
    ok(ingest(base, acme.token, db, [src(first, "Billing migration kickoff", "The billing migration starts now.", []),
                                     src(markup, markup_title, "billing markup check", [])]), 201)
    comment = f"Not about billing {uuid.uuid4().hex[:8]}"
    with signed_in(browser, base, viewer, f"/console/db/{db}?tab=search") as page:
        page.get_by_role("textbox", name="Words").fill("billing migration")
        page.get_by_role("button", name="Search").click()
        expected = expected_search([(first, "default", "Billing migration kickoff", "The billing migration starts now."),
                                    (markup, "default", markup_title, "billing markup check")], "billing migration")
        shows(page, page.get_by_role("row").filter(has_text=first))
        expect(page.get_by_text(f"{expected[0]['score']:.4f}").first).to_be_visible()
        shows(page, page.get_by_role("status", name="Console announcements"), f"Search found {len(expected)} sources")
        expect(page.get_by_text(markup_title).first).to_be_visible()
        assert query_of(page)["words"] == ["billing migration"]
        ok(ingest(base, acme.token, db, [src(later, "Billing migration follow-up", "billing migration second note", [])]), 201)
        page.get_by_role("button", name="Search").click()
        shows(page, page.get_by_role("row").filter(has_text=later))
        page.get_by_role("row").filter(has_text=first).get_by_role("button", name="Not useful").click()
        select(page.get_by_label("Rating"), "negative")
        page.get_by_role("textbox", name="Comment").fill(comment)
        page.get_by_role("button", name="Send feedback").click()
        shows(page, page.get_by_role("status").filter(has_text="Feedback sent").first)
        page.get_by_role("tab", name="Sources").click()
        page.get_by_role("textbox", name="Filter sources").fill("%_")
        shows(page, page.get_by_role("row").filter(has_text=markup))
        expect(page.get_by_role("row").filter(has_text=first)).to_have_count(0)
    assert pg.rows(f"select count(*) as n from feedback where feedback = {sql(comment)}")[0]["n"] == 1
    long_ok = call(base, "POST", "/api/v2/feedback", viewer_token,
                   {"request_id": ok_request(base, viewer_token, db), "feedback": "\U0001F600" * FEEDBACK_MAX})
    assert ok(long_ok, 201)["received"] is True


def ok_request(base, token, db):
    r = search(base, token, db, "billing")
    ok(r)
    return r.json()["meta"]["request_id"]


def test_wf_concurrency_racing_writes(base, acme, pg):
    db = acme.create_db("cr")
    t = acme.token
    target, guarded = fresh_id("d"), fresh_id("g")
    ok(ingest(base, t, db, [src(target, "Doomed", "to be deleted", []), src(guarded, "Guarded", "v1", [])]), 201)
    deletes = race([lambda: delete_source(base, t, db, target) for _ in range(RACERS)])
    wins = [r for r in deletes if r.status_code == 200]
    assert len(wins) == 1 and set(ok(wins[0])) == {"deleted", "lsn"}
    for r in deletes:
        if r.status_code != 200:
            refused(r, 404, "SOURCE_NOT_FOUND")
    assert [w["kind"] for w in wal(pg, ACME, db)].count("delete") == 1

    guards = race([lambda: ingest(base, t, db, [src(guarded, "Guarded", "v2", [], if_version=1)]) for _ in range(RACERS)])
    accepted = [r for r in guards if r.status_code == 201]
    assert len(accepted) == 1 and ok(accepted[0], 201)["results"][0]["version"] == 2
    for r in guards:
        if r.status_code != 201:
            refused(r, 409, "VERSION_CONFLICT", field="sources.0.if_version", message=f"Source {guarded} is at version 2")
    refused(ingest(base, t, db, [src(guarded, "Stale", "v?", [], if_version=0)]), 409, "VERSION_CONFLICT",
            message=f"Source {guarded} is at version 2")
    fresh = fresh_id("n")
    refused(ingest(base, t, db, [src(fresh, "New", "x", [], if_version=0), src(guarded, "Stale", "x", [], if_version=1)]),
            409, "VERSION_CONFLICT", field="sources.1.if_version", message=f"Source {guarded} is at version 2")
    assert ok(call(base, "GET", "/api/v2/context/status", t, params={"database": db, "collection": "default", "ids": fresh}))[
        "statuses"][0]["indexing_status"] == "errored"
    ok(ingest(base, t, db, [src(fresh, "New", "x", [], if_version=0)]), 201)

    before = stats(base, t, db)["last_lsn"]
    plain = race([lambda i=i: ingest(base, t, db, [src(fresh_id("p"), f"P{i}", "parallel", [])]) for i in range(RACERS)])
    lsns = sorted(ok(r, 201)["results"][0]["lsn"] for r in plain)
    assert lsns == list(range(before + 1, before + RACERS + 1))
    log = [w["lsn"] for w in wal(pg, ACME, db)]
    assert log == list(range(1, before + RACERS + 1))

    generation = stats(base, t, db)["index_generation"]
    folds = race([lambda: compact(base, t, db) for _ in range(2)])
    data = [ok(r) for r in folds]
    assert {d["generation"] for d in data} == {generation + 1}
    assert sorted(d["folded_entries"] for d in data)[0] == 0 and max(d["folded_entries"] for d in data) > 0
    assert stats(base, t, db)["index_generation"] == generation + 1


def test_wf_concurrency_retries_and_conflict(browser, base, acme, pg):
    db = acme.create_db("cy")
    t = acme.token
    key = idempotency_key()
    body_source = [src(fresh_id("i"), "Keyed", "idempotent ingest", [])]
    first = ingest(base, t, db, body_source, key=key)
    data = ok(first, 201)
    assert "Idempotent-Replayed" not in first.headers
    replay = ingest(base, t, db, body_source, key=key)
    assert ok(replay, 201) == data and replay.headers["Idempotent-Replayed"] == "true"
    assert replay.json()["meta"]["request_id"] != first.json()["meta"]["request_id"]
    refused(ingest(base, t, db, [src(fresh_id("i"), "Other", "different", [])], key=key), 422, "IDEMPOTENCY_KEY_REUSED")
    refused(ingest(base, t, db, body_source, key="bad key!"), 400, "VALIDATION_ERROR", field="Idempotency-Key")
    assert stats(base, t, db)["last_lsn"] == 1

    racing_key = idempotency_key()
    racing_body = [src(fresh_id("r"), "Raced", "one write only", [])]
    answers = race([lambda: ingest(base, t, db, racing_body, key=racing_key) for _ in range(RACERS)])
    originals = [r for r in answers if r.status_code == 201 and "Idempotent-Replayed" not in r.headers]
    assert len(originals) == 1
    for r in answers:
        if r.status_code == 409:
            refused(r, 409, "IDEMPOTENCY_IN_PROGRESS")
        else:
            assert r.status_code == 201
    assert stats(base, t, db)["last_lsn"] == 2 and len(wal(pg, ACME, db)) == 2

    editor, editor_token = acme.add_member("editor")
    sid = fresh_id("e")
    original_title, teammate_title, my_title = fresh_id("orig"), fresh_id("mate"), fresh_id("mine")
    ok(ingest(base, t, db, [src(sid, original_title, "original text", [fact("Atlas Launch", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z")])]), 201)
    with signed_in(browser, base, editor, f"/console/db/{db}?tab=sources") as page:
        shows(page, page.get_by_role("row").filter(has_text=sid))
        page.get_by_role("row").filter(has_text=sid).get_by_role("button", name="Edit").click()
        expect(textbox(page, "Title")).to_have_value(original_title)
        ok(ingest(base, t, db, [src(sid, teammate_title, "newer", [])]), 201)
        textbox(page, "Title").fill(my_title)
        page.get_by_role("button", name="Ingest", exact=True).click()
        box = field_message(page, f"Source {sid} is at version 2")
        expect(textbox(page, "Title")).to_have_value(my_title)
        assert nearer(textbox(page, "Title"), textbox(page, "Text"), box)
    live = ok(call(base, "GET", "/api/v2/context/source", editor_token, params={"database": db, "collection": "default", "id": sid}))
    assert (live["version"], live["title"]) == (2, teammate_title)


def test_wf_provisioning_inline_create(browser, base, acme, pg):
    name = fresh_name("pv")
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        textbox(page, "Name").fill(name)
        page.get_by_role("button", name="Create", exact=True).dblclick()
        acme.databases.append(name)
        shows(page, page.get_by_role("status").filter(has_text="Database created").first)
        row = page.get_by_role("row").filter(has_text=name)
        shows(page, row, "ready")
        expect(page.get_by_role("link", name=name)).to_have_attribute("href", f"/console/db/{name}")
    count = pg.rows(f"select count(*) as n from databases d join organizations o on o.id = d.organization_id "
                    f"where o.name = {sql(ACME)} and d.name = {sql(name)}")[0]["n"]
    assert count == 1

    t = acme.token
    other = fresh_name("pv")
    started = time.monotonic()
    ok(call(base, "POST", "/api/v2/databases", t, {"name": other}), 201)
    acme.databases.append(other)
    status = ok(call(base, "GET", "/api/v2/databases/status", t, params={"database": other}))
    assert set(status) == {"database", "status", "infra"} and set(status["infra"]) == {"ready_for_ingestion", "graph_status"}
    if time.monotonic() - started < 2:
        assert status["status"] == "provisioning" and status["infra"] == {"ready_for_ingestion": False, "graph_status": "provisioning"}
        early = ingest(base, t, other, [src(fresh_id("x"), "T", "x", [])])
        if time.monotonic() - started < 2:
            refused(early, 409, "DATABASE_NOT_READY")
        early_compact = compact(base, t, other)
        if time.monotonic() - started < 2:
            refused(early_compact, 409, "DATABASE_NOT_READY")
        assert stats(base, t, other)["sources"] == 0
    while ok(call(base, "GET", "/api/v2/databases/status", t, params={"database": other}))["status"] != "ready":
        assert time.monotonic() - started < READY_DEADLINE
    assert time.monotonic() - started >= 2
    ready = ok(call(base, "GET", "/api/v2/databases/status", t, params={"database": other}))
    assert ready["infra"] == {"ready_for_ingestion": True, "graph_status": "ready"}
    ok(ingest(base, t, other, [src(fresh_id("x"), "T", "x", [])]), 201)
    for bad in ("ab", "Abc", "1abc", "a-bc", "a" * (NAME_MAX + 1)):
        refused(call(base, "POST", "/api/v2/databases", t, {"name": bad}), 400, "VALIDATION_ERROR", field="name")
    longest = ("z" + uuid.uuid4().hex * 2)[:NAME_MAX]
    ok(call(base, "POST", "/api/v2/databases", t, {"name": longest}), 201)
    acme.databases.append(longest)
    refused(call(base, "POST", "/api/v2/databases", t, {"name": longest}), 409, "DATABASE_ALREADY_EXISTS")


def test_wf_provisioning_plan_race(base, northwind, acme, mail):
    t = northwind.token
    owner_email, _ = northwind.add_member("owner")

    def plan(value):
        return call(base, "PUT", "/api/v2/org/plan", t, {"plan": value})

    def count():
        return len(ok(call(base, "GET", "/api/v2/databases", t))["databases"])

    def plan_changes():
        return len(ok(audit(base, t, action="plan.change", limit=AUDIT_LIMIT_MAX))["events"])

    try:
        changes = plan_changes()
        assert ok(plan("ship")) == {"plan": "ship"}
        assert mails(mail, owner_email, "Plan changed to Ship", minimum=0) == []
        while count() < SHIP_DBS:
            northwind.create_db("pl", wait=False)
        refused(call(base, "POST", "/api/v2/databases", t, {"name": fresh_name("pl")}), 403, "PLAN_LIMIT",
                message="Your plan allows 3 databases")
        assert ok(plan("scale")) == {"plan": "scale"}
        scale_mail = mails(mail, owner_email, "Plan changed to Scale")
        assert len(scale_mail) == 1 and "$300.00" in mail_text(scale_mail[0]) and NORTHWIND in mail_text(scale_mail[0])
        northwind.create_db("pl", wait=False)
        refused(plan("ship"), 409, "PLAN_DOWNGRADE_BLOCKED")
        call(base, "DELETE", "/api/v2/databases", t, params={"database": northwind.databases.pop()})
        assert count() == SHIP_DBS
        racer = fresh_name("pl")
        switch, create = race([lambda: plan("ship"), lambda: call(base, "POST", "/api/v2/databases", t, {"name": racer})])
        if create.status_code == 201:
            northwind.databases.append(racer)
            refused(switch, 409, "PLAN_DOWNGRADE_BLOCKED")
        else:
            assert ok(switch) == {"plan": "ship"}
            refused(create, 403, "PLAN_LIMIT", message="Your plan allows 3 databases")
            ship_mail = mails(mail, owner_email, "Plan changed to Ship")
            assert len(ship_mail) == 1 and "$25.00" in mail_text(ship_mail[0])
        current = ok(call(base, "GET", "/api/me", t, version=None))["organization"]["plan"]
        if current == "ship":
            assert count() <= SHIP_DBS
        assert plan_changes() - changes == (2 if switch.status_code == 200 else 1)
    finally:
        northwind.close()
        northwind.databases = []
        plan("ship")

    a = acme.token
    while len(ok(call(base, "GET", "/api/v2/databases", a))["databases"]) < SCALE_DBS:
        acme.create_db("sc", wait=False)
    refused(call(base, "POST", "/api/v2/databases", a, {"name": fresh_name("sc")}), 403, "PLAN_LIMIT",
            message="Your plan allows 20 databases")


def gated_routes(db, email):
    viewer = [("GET", "/api/v2/databases", None, ABSENT), ("GET", "/api/v2/databases/status", {"database": db}, ABSENT),
              ("GET", "/api/v2/databases/collections", {"database": db}, ABSENT), ("GET", "/api/v2/databases/stats", {"database": db}, ABSENT),
              ("GET", "/api/v2/context/status", {"database": db, "collection": "default", "ids": "a"}, ABSENT),
              ("POST", "/api/v2/context/list", None, {"database": db, "collection": "default"}),
              ("GET", "/api/v2/context/source", {"database": db, "collection": "default", "id": "a"}, ABSENT),
              ("GET", "/api/v2/context/relations", {"database": db, "entity": "x"}, ABSENT),
              ("GET", "/api/v2/context/history", {"database": db, "entity": "x", "predicate": "OWNED_BY"}, ABSENT),
              ("GET", "/api/v2/context/graph", {"database": db}, ABSENT),
              ("POST", "/api/v2/query", None, {"database": db, "query_by": "text", "query": "x"}),
              ("POST", "/api/v2/feedback", None, {"request_id": str(uuid.uuid4()), "feedback": "x"}),
              ("GET", "/api/v2/members", None, ABSENT)]
    editor = [("POST", "/api/v2/context/ingest", None, {"database": db, "sources": [src("a", "t", "x", [])]}),
              ("DELETE", "/api/v2/context", {"database": db, "collection": "default", "id": "a"}, ABSENT),
              ("POST", "/api/v2/context/restore", None, {"database": db, "collection": "default", "id": "a"}),
              ("POST", "/api/v2/databases/compact", None, {"database": db}),
              ("DELETE", "/api/v2/databases/collections", {"database": db, "name": "default"}, ABSENT)]
    owner = [("POST", "/api/v2/databases", None, {"name": fresh_name("rg")}), ("DELETE", "/api/v2/databases", {"database": db}, ABSENT),
             ("POST", "/api/v2/databases/export", None, {"database": db}),
             ("POST", "/api/v2/databases/import", None, {"name": fresh_name("rg"), "document": {"collections": []}}),
             ("POST", "/api/v2/members", None, {"email": fresh_email("rg"), "role": "viewer", "password": PASSWORD}),
             ("PATCH", f"/api/v2/members/{quote(email, safe='@')}", None, {"role": "viewer"}),
             ("DELETE", f"/api/v2/members/{quote(email, safe='@')}", None, ABSENT),
             ("GET", "/api/v2/keys", None, ABSENT), ("POST", "/api/v2/keys", None, {"name": "k", "role": "viewer"}),
             ("GET", "/api/v2/keys/1", None, ABSENT), ("DELETE", "/api/v2/keys/1", None, ABSENT),
             ("POST", "/api/v2/keys/1/rotate", None, ABSENT), ("PUT", "/api/v2/org/plan", None, {"plan": "scale"}),
             ("GET", "/api/v2/usage", None, ABSENT), ("GET", "/api/v2/usage/daily", None, ABSENT), ("GET", "/api/v2/audit", None, ABSENT),
             ("GET", "/api/v2/jobs/1", None, ABSENT), ("GET", "/api/v2/jobs/1/download", None, ABSENT)]
    session = [("POST", "/api/auth/logout", None, ABSENT), ("POST", "/api/auth/logout-all", None, ABSENT),
               ("POST", "/api/auth/password", None, {"current_password": PASSWORD, "new_password": PASSWORD + "x"}),
               ("POST", "/api/auth/totp/setup", None, ABSENT), ("POST", "/api/auth/totp/enable", None, {"code": "000000"}),
               ("POST", "/api/auth/totp/disable", None, {"code": "000000"}), ("GET", "/api/me", None, ABSENT)]
    return viewer, editor, owner, session


def test_wf_role_gating_matrix(base, acme, northwind, pg):
    db = acme.create_db("rg")
    ok(ingest(base, acme.token, db, [src("a", "Kept", "kept text", [])]), 201)
    viewer_email, viewer = acme.add_member("viewer")
    editor_email, editor = acme.add_member("editor")
    editor_key = acme.add_key("editor")["secret"]
    viewer_key = acme.add_key("viewer")["secret"]
    foreign = northwind.create_db("fx", wait=False)
    members_before = ok(call(base, "GET", "/api/v2/members", acme.token))
    wal_before = wal(pg, ACME, db)
    v_routes, e_routes, o_routes, s_routes = gated_routes(db, viewer_email)
    for method, path, params, body in v_routes + e_routes + o_routes:
        refused(call(base, method, path, None, body, params=params), 401, "UNAUTHENTICATED")
        refused(call(base, method, path, acme.token, body, params=params, version=None), 400, "API_VERSION_REQUIRED")
        refused(call(base, method, path, None, body, params=params, version="3"), 400, "UNSUPPORTED_API_VERSION")
        refused(call(base, method, path, "not-a-live-token", body, params=params), 401, "INVALID_API_KEY")
    for method, path, params, body in s_routes:
        refused(call(base, method, path, None, body, params=params, version=None), 401, "UNAUTHENTICATED")
        refused(call(base, method, path, editor_key, body, params=params, version=None), 403, "FORBIDDEN_ROLE")
    for method, path, params, body in e_routes + o_routes:
        refused(call(base, method, path, viewer, body, params=params), 403, "FORBIDDEN_ROLE")
        refused(call(base, method, path, viewer_key, body, params=params), 403, "FORBIDDEN_ROLE")
    for method, path, params, body in o_routes:
        refused(call(base, method, path, editor, body, params=params), 403, "FORBIDDEN_ROLE")
        refused(call(base, method, path, editor_key, body, params=params), 403, "FORBIDDEN_ROLE")
    refused(call(base, "DELETE", "/api/v2/databases", editor_key, params={"database": foreign}), 403, "FORBIDDEN_ROLE")
    refused(call(base, "DELETE", "/api/v2/databases", viewer, params={"database": fresh_name("unknown")}), 403, "FORBIDDEN_ROLE")
    for method, path, params, body in v_routes[:-2]:
        envelope(call(base, method, path, viewer, body, params=params))
    assert wal(pg, ACME, db) == wal_before
    assert ok(call(base, "GET", "/api/v2/members", acme.token)) == members_before
    assert ok(call(base, "GET", "/api/v2/databases/status", northwind.token, params={"database": foreign}))["database"] == foreign

    probes = [("PUT", "/api/v2/databases", "DELETE, GET, POST"), ("POST", "/api/v2/audit", "GET"), ("DELETE", "/api/v2/audit", "GET"),
              ("GET", f"/api/v2/members/{quote(editor_email, safe='@')}", "DELETE, PATCH"), ("PATCH", "/api/v2/keys/1", "DELETE, GET"),
              ("OPTIONS", "/api/health", "GET"), ("GET", "/api/auth/login", "POST"), ("PUT", "/api/v2/query", "POST")]
    for method, path, allow in probes:
        r = call(base, method, path, None, version=None)
        refused(r, 405, "METHOD_NOT_ALLOWED", message=f"This address does not accept {method}")
        assert r.headers["Allow"] == allow
    head = httpx.request("HEAD", base + "/api/v2/databases", timeout=HTTP_TIMEOUT)
    assert head.status_code == 405 and head.headers["Allow"] == "DELETE, GET, POST" and head.content == b""


def test_wf_role_gating_access_pages(browser, base, acme):
    db = acme.create_db("ap")
    viewer, _ = acme.add_member("viewer")
    with signed_in(browser, base, viewer, "/console") as page:
        for panel in ("keys", "billing", "audit"):
            page.goto(f"{base}/console/settings/{panel}")
            expect(page.get_by_text("You do not have access to this page")).to_be_visible()
            expect(page.get_by_role("button", name="Create key")).to_have_count(0)
            expect(page.get_by_role("button", name="Switch to Ship")).to_have_count(0)
        page.goto(f"{base}/console")
        expect(page.get_by_role("button", name="Create", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Import database")).to_have_count(0)
        page.goto(f"{base}/console/db/{db}?tab=sources")
        shows(page, page.get_by_text("No sources in this collection"))
        expect(page.get_by_role("button", name="Ingest source")).to_have_count(0)
        page.goto(f"{base}/console/db/{db}?tab=stats")
        expect(page.get_by_role("button", name="Compact")).to_have_count(0)
        page.goto(f"{base}/console/db/{db}?tab=search&words=nothing%20here")
        shows(page, page.get_by_text("No sources match these words"))
        page.goto(f"{base}/console/db/{db}?tab=entity&entity=Nobody")
        shows(page, page.get_by_text("No facts mention this entity"))
        page.goto(f"{base}/console/db/{fresh_name('nf')}")
        expect(page.get_by_text("Database not found")).to_be_visible()


def test_wf_role_gating_demotion(browser, base, acme):
    db = acme.create_db("dm")
    editor, token = acme.add_member("editor")
    with signed_in(browser, base, editor, f"/console/db/{db}?tab=sources") as page:
        shows(page, page.get_by_role("button", name="Ingest source"))
        ok(call(base, "PATCH", f"/api/v2/members/{quote(editor, safe='@')}", acme.token, {"role": "viewer"}))
        refused(ingest(base, token, db, [src(fresh_id("d"), "T", "x", [])]), 403, "FORBIDDEN_ROLE")
        page.reload()
        shows(page, page.get_by_text("viewer").first)
        expect(page.get_by_role("button", name="Ingest source")).to_have_count(0)
        ok(call(base, "PATCH", f"/api/v2/members/{quote(editor, safe='@')}", acme.token, {"role": "owner"}))
        ok(call(base, "GET", "/api/v2/usage", token))
        page.goto(f"{base}/console")
        shows(page, page.get_by_role("button", name="Create", exact=True))
    assert stats(base, token, db)["last_lsn"] == 0


def test_wf_api_keys_scope(browser, base, acme, pg):
    name = fresh_id("uikey")
    with signed_in(browser, base, ACME_OWNER, "/console/settings/keys") as page:
        textbox(page, "Key name").fill(name)
        select(page.get_by_label("Key role"), "editor")
        page.get_by_role("button", name="Create key").click()
        shows(page, page.get_by_text("Copy this key now. It will not be shown again.").first)
        found = re.search(r"tsl_[0-9a-f]{40}", page.content())
        assert found
        secret = found.group(0)
        page.reload()
        shows(page, page.get_by_role("row").filter(has_text=name))
        assert secret not in page.content()
    listed = [k for k in ok(call(base, "GET", "/api/v2/keys", acme.token))["keys"] if k["name"] == name]
    assert len(listed) == 1 and listed[0]["prefix"] == secret[:PREFIX_LEN] and listed[0]["role"] == "editor"
    acme.keys.append(listed[0]["id"])
    assert tables_holding(pg, secret) == []
    refused(call(base, "POST", "/api/v2/databases", secret, {"name": fresh_name("k")}), 403, "FORBIDDEN_ROLE")
    refused(call(base, "GET", "/api/v2/keys", secret), 403, "FORBIDDEN_ROLE")

    a, b = acme.create_db("ka"), acme.create_db("kb")
    t = acme.token
    refused(call(base, "POST", "/api/v2/keys", t, {"name": "k", "role": "owner"}), 400, "VALIDATION_ERROR", field="role")
    refused(call(base, "POST", "/api/v2/keys", t, {"name": "k" * (KEY_NAME_MAX + 1), "role": "viewer"}), 400, "VALIDATION_ERROR", field="name")
    refused(call(base, "POST", "/api/v2/keys", t, {"name": "k", "role": "viewer", "databases": [fresh_name("no")]}), 400, "VALIDATION_ERROR", field="databases.0")
    refused(call(base, "POST", "/api/v2/keys", t, {"name": "k", "role": "viewer", "databases": [a, a]}), 400, "VALIDATION_ERROR", field="databases.1")
    key = acme.add_key("editor", [b, a])
    assert re.fullmatch(r"tsl_[0-9a-f]{40}", key["secret"]) and key["prefix"] == key["secret"][:PREFIX_LEN]
    s = key["secret"]
    detail = ok(call(base, "GET", f"/api/v2/keys/{key['id']}", t))
    assert set(detail) == {"id", "name", "role", "prefix", "databases", "created_at", "last_used_at", "rotated_at", "revoked_at"}
    assert detail["databases"] == sorted([a, b]) and detail["last_used_at"] is None
    assert sorted(d["name"] for d in ok(call(base, "GET", "/api/v2/databases", s))["databases"]) == sorted([a, b])
    refused(call(base, "GET", "/api/v2/databases/stats", s, params={"database": LAUNCH}), 404, "DATABASE_NOT_FOUND")
    ok(ingest(base, s, a, [src(fresh_id("k"), "T", "scoped write", [])]), 201)
    call(base, "DELETE", "/api/v2/databases", t, params={"database": a})
    assert ok(call(base, "GET", f"/api/v2/keys/{key['id']}", t))["databases"] == [b]
    call(base, "DELETE", "/api/v2/databases", t, params={"database": b})
    assert ok(call(base, "GET", f"/api/v2/keys/{key['id']}", t))["databases"] == []
    assert ok(call(base, "GET", "/api/v2/databases", s)) == {"databases": []}
    refused(call(base, "GET", "/api/v2/databases/stats", s, params={"database": LAUNCH}), 404, "DATABASE_NOT_FOUND")
    ok(call(base, "POST", "/api/v2/databases", t, {"name": a}), 201)
    refused(call(base, "GET", "/api/v2/databases/status", s, params={"database": a}), 404, "DATABASE_NOT_FOUND")
    after = ok(call(base, "GET", f"/api/v2/keys/{key['id']}", t))
    assert after["databases"] == [] and after["last_used_at"] is not None
    unscoped = acme.add_key("viewer")
    assert ok(call(base, "GET", f"/api/v2/keys/{unscoped['id']}", t))["databases"] is None
    assert LAUNCH in [d["name"] for d in ok(call(base, "GET", "/api/v2/databases", unscoped["secret"]))["databases"]]


def test_wf_api_keys_rotation_limits(base, acme, northwind, mail):
    owner_email, _ = acme.add_member("owner")
    t = acme.token
    key = acme.add_key("viewer")
    assert mails(mail, owner_email, f"API key rotated: {key['name']}", minimum=0) == []
    rotated = ok(call(base, "POST", f"/api/v2/keys/{key['id']}/rotate", t))
    assert set(rotated) == {"id", "prefix", "secret"} and rotated["secret"] != key["secret"]
    refused(call(base, "GET", "/api/v2/databases", key["secret"]), 401, "INVALID_API_KEY")
    ok(call(base, "GET", "/api/v2/databases", rotated["secret"]))
    assert ok(call(base, "GET", f"/api/v2/keys/{key['id']}", t))["rotated_at"] is not None
    assert len(mails(mail, owner_email, f"API key rotated: {key['name']}")) == 1
    assert ok(call(base, "DELETE", f"/api/v2/keys/{key['id']}", t)) == {"revoked": True}
    refused(call(base, "GET", "/api/v2/databases", rotated["secret"]), 401, "INVALID_API_KEY")
    refused(call(base, "DELETE", f"/api/v2/keys/{key['id']}", t), 409, "KEY_REVOKED")
    refused(call(base, "POST", f"/api/v2/keys/{key['id']}/rotate", t), 409, "KEY_REVOKED")
    assert len(mails(mail, owner_email, f"API key revoked: {key['name']}")) == 1
    assert ok(call(base, "GET", f"/api/v2/keys/{key['id']}", t))["revoked_at"] is not None

    nw_key = northwind.add_key("viewer")
    refused(call(base, "GET", f"/api/v2/keys/{nw_key['id']}", t), 404, "KEY_NOT_FOUND")
    refused(call(base, "DELETE", f"/api/v2/keys/{nw_key['id']}", t), 404, "KEY_NOT_FOUND")
    assert stats(base, nw_key["secret"], LAUNCH)["sources"] == 4
    remaining = []
    for i in range(SHIP_QUERIES):
        r = search(base, nw_key["secret"], LAUNCH, "atlas") if i else cypher(base, nw_key["secret"], LAUNCH, "MATCH (a RETURN a")
        assert r.headers["RateLimit-Limit"] == str(SHIP_QUERIES)
        remaining.append(int(r.headers["RateLimit-Remaining"]))
    assert remaining == list(range(SHIP_QUERIES - 1, -1, -1))
    limited = search(base, nw_key["secret"], LAUNCH, "atlas")
    assert 1 <= throttled(limited, "RATE_LIMITED") <= RETRY_MAX
    assert limited.headers["RateLimit-Remaining"] == "0"
    session = search(base, northwind.token, LAUNCH, "atlas")
    ok(session)
    assert "RateLimit-Limit" not in session.headers and "RateLimit-Remaining" not in session.headers
    scale_key = acme.add_key("viewer")
    assert search(base, scale_key["secret"], LAUNCH, "rollout").headers["RateLimit-Limit"] == str(SCALE_QUERIES)


def test_wf_org_isolation_shared_names(browser, base, acme, northwind):
    nw, a = northwind.token, acme.token
    names = {m["email"] for m in ok(call(base, "GET", "/api/v2/members", nw))["members"]}
    assert ACME_OWNER not in names and NW_OWNER in names
    refused(call(base, "PATCH", f"/api/v2/members/{quote(ACME_OWNER, safe='@')}", nw, {"role": "viewer"}), 404, "MEMBER_NOT_FOUND")
    refused(call(base, "DELETE", f"/api/v2/members/{quote(ACME_OWNER, safe='@')}", nw), 404, "MEMBER_NOT_FOUND")
    assert ok(audit(base, nw, actor=ACME_OWNER)) == {"events": [], "next_cursor": None}
    csv = audit(base, nw, actor=ACME_OWNER, format="csv")
    assert csv.status_code == 200 and csv.text == "id,at,actor,action,target,detail" + "\n"
    job = ok(call(base, "POST", "/api/v2/databases/export", a, {"database": LAUNCH}), 202)
    refused(call(base, "GET", f"/api/v2/jobs/{job['job_id']}", nw), 404, "JOB_NOT_FOUND")
    refused(call(base, "GET", f"/api/v2/jobs/{job['job_id']}/download", nw), 404, "JOB_NOT_FOUND")
    rid = ok_request(base, a, LAUNCH)
    refused(call(base, "POST", "/api/v2/feedback", nw, {"request_id": rid, "feedback": "cross"}), 404, "REQUEST_NOT_FOUND")

    shared = idempotency_key()
    name = fresh_name("iso")
    nw_usage = usage(base, nw)["month_tokens"]
    first = call(base, "POST", "/api/v2/databases", a, {"name": name}, headers={"Idempotency-Key": shared})
    ok(first, 201)
    acme.databases.append(name)
    second = call(base, "POST", "/api/v2/databases", nw, {"name": name}, headers={"Idempotency-Key": shared})
    ok(second, 201)
    northwind.databases.append(name)
    assert "Idempotent-Replayed" not in second.headers
    wait_ready(base, a, name)
    ok(ingest(base, a, name, [src(fresh_id("i"), "Acme only", "acme private words", [fact("Acme Thing", "OWNED_BY", "Jordan Lee", "2026-01-01T00:00:00Z")])]), 201)
    assert usage(base, nw)["month_tokens"] == nw_usage
    wait_ready(base, nw, name)
    assert stats(base, nw, name)["sources"] == 0
    assert ok(search(base, nw, name, "acme private"))["results"] == []
    with signed_in(browser, base, NW_VIEWER, f"/console/db/{name}?tab=sources") as page:
        shows(page, page.get_by_text("No sources in this collection"))
        page.goto(f"{base}/console/db/{acme.create_db('only', wait=False)}")
        expect(page.get_by_text("Database not found")).to_be_visible()


def test_wf_org_isolation_deleted_name(base, acme, northwind):
    name = fresh_name("dn")
    for org in (acme, northwind):
        ok(call(base, "POST", "/api/v2/databases", org.token, {"name": name}), 201)
        org.databases.append(name)
        wait_ready(base, org.token, name)
        ok(ingest(base, org.token, name, [src("same", "Same id", f"{org.token[:4]} text", [fact("Shared", "OWNED_BY", "Owner", "2026-01-01T00:00:00Z")])]), 201)
    nw_before = stats(base, northwind.token, name)
    assert ok(call(base, "DELETE", "/api/v2/databases", acme.token, params={"database": name})) == {"deleted": True}
    refused(call(base, "GET", "/api/v2/databases/stats", acme.token, params={"database": name}), 404, "DATABASE_NOT_FOUND")
    refused(call(base, "DELETE", "/api/v2/databases", acme.token, params={"database": name}), 404, "DATABASE_NOT_FOUND")
    assert stats(base, northwind.token, name) == nw_before
    assert answer_rows(base, northwind.token, name, "MATCH (s {name: 'shared'})-[:OWNED_BY]->(o) RETURN o") == [["Owner"]]
    ok(call(base, "POST", "/api/v2/databases", acme.token, {"name": name}), 201)
    assert ok(call(base, "GET", "/api/v2/databases/status", acme.token, params={"database": name}))["status"] == "provisioning"
    fresh = stats(base, acme.token, name)
    assert (fresh["sources"], fresh["last_lsn"], fresh["indexed_lsn"], fresh["index_generation"], fresh["tokens_ingested"]) == (0, 0, 0, 0, 0)
    assert ok(call(base, "GET", "/api/v2/databases/collections", acme.token, params={"database": name})) == {"collections": ["default"]}


def test_wf_authentication_identical_refusals(browser, base, acme):
    for email, role, org, plan in ((NW_OWNER, "owner", NORTHWIND, "ship"), (NW_EDITOR, "editor", NORTHWIND, "ship"),
                                   (NW_VIEWER, "viewer", NORTHWIND, "ship"), (ACME_OWNER, "owner", ACME, "scale")):
        data = ok(login_raw(base, email))
        assert data["member"] == {"email": email, "role": role, "organization": {"name": org, "plan": plan}}
        assert len(data["token"]) >= 32
    removed, _ = acme.add_member("viewer")
    ok(call(base, "DELETE", f"/api/v2/members/{quote(removed, safe='@')}", acme.token))
    member, member_token = acme.add_member("viewer")
    unknown = fresh_email("ghost")
    answers = [login_raw(base, unknown), login_raw(base, removed), login_raw(base, member, PASSWORD + "x")]
    for r in answers:
        refused(r, 401, "BAD_CREDENTIALS", field=None)
    assert len({tuple(sorted(r.json())) for r in answers}) == 1
    header_sets = [frozenset(h.lower() for h in r.headers) for r in answers]
    assert header_sets[0] == header_sets[1] == header_sets[2]

    victim, _ = acme.add_member("viewer")
    ghost = fresh_email("ghost")
    for i in range(SIGNIN_FAILS):
        refused(login_raw(base, victim.upper() if i % 2 else victim, "wrong-password-0"), 401, "BAD_CREDENTIALS")
        refused(login_raw(base, ghost, "wrong-password-0"), 401, "BAD_CREDENTIALS")
    paused_member = login_raw(base, victim)
    paused_ghost = login_raw(base, ghost)
    assert 1 <= throttled(paused_member, "SIGN_IN_THROTTLED") <= SIGNIN_PAUSE_MAX
    assert 1 <= throttled(paused_ghost, "SIGN_IN_THROTTLED") <= SIGNIN_PAUSE_MAX
    assert {h.lower() for h in paused_member.headers} == {h.lower() for h in paused_ghost.headers}
    ok(login_raw(base, member))

    assert ok(call(base, "POST", "/api/auth/logout", member_token, version=None)) == {}
    refused(call(base, "GET", "/api/me", member_token, version=None), 401, "INVALID_API_KEY")
    with open_app(browser, f"{base}/login") as page:
        sign_in_form(page, member, "not-the-password-0")
        shows(page, page.get_by_text("Email or password is incorrect"))
        assert urlparse(page.url).path == "/login"


def test_wf_authentication_two_step(browser, base, acme, pg):
    email, token = acme.add_member("viewer")
    setup = ok(call(base, "POST", "/api/auth/totp/setup", token, version=None))
    secret = setup["secret"]
    assert re.fullmatch(r"[A-Z2-7]{32}", secret)
    uri = urlparse(setup["otpauth_uri"])
    assert uri.scheme == "otpauth" and uri.netloc == "totp" and parse_qs(uri.query) == {"secret": [secret], "issuer": ["Tessel"]}
    assert "Tessel:" + email in quote(uri.path, safe="@:/").replace("%3A", ":") or f"Tessel:{email}" in uri.path
    refused(call(base, "POST", "/api/auth/totp/enable", token, {"code": "000000"}, version=None), 401, "BAD_TOTP")
    step = now_step()
    enabled = ok(call(base, "POST", "/api/auth/totp/enable", token, {"code": totp(secret, step)}, version=None))
    codes = enabled["recovery_codes"]
    assert enabled["enabled"] is True and len(codes) == RECOVERY_CODES and all(re.fullmatch(r"[0-9a-f]{4}-[0-9a-f]{4}", c) for c in codes)
    refused(call(base, "POST", "/api/auth/totp/setup", token, version=None), 409, "TOTP_ALREADY_ON")
    refused(login_raw(base, email), 401, "TOTP_REQUIRED")
    refused(login_raw(base, email, PASSWORD + "x"), 401, "BAD_CREDENTIALS")
    refused(login_raw(base, email, PASSWORD + "x", totp=totp(secret, step + 1)), 401, "BAD_CREDENTIALS")
    refused(login_raw(base, email, totp=totp(secret, step)), 401, "BAD_TOTP")
    ok(login_raw(base, email, totp=totp(secret, step + 1)))
    refused(login_raw(base, email, totp=totp(secret, step + 1)), 401, "BAD_TOTP")
    for code in codes:
        assert tables_holding(pg, code) == []

    with open_app(browser, f"{base}/login?next={quote('/console/settings', safe='')}") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_form(page, email)
        shows(page, page.get_by_role("textbox", name="Authentication code"))
        page.get_by_role("link", name="Use a recovery code").click()
        page.get_by_role("textbox", name="Recovery code").fill(codes[0])
        page.get_by_role("button", name="Verify").click()
        page.wait_for_url(lambda u: urlparse(u).path == "/console/settings", timeout=UI_TIMEOUT_MS)
    refused(login_raw(base, email, recovery_code=codes[0]), 401, "BAD_TOTP")
    ok(login_raw(base, email, recovery_code=codes[1]))
    with open_app(browser, f"{base}/login?next={quote(BAD_NEXT[1], safe='')}") as page:
        sign_in_form(page, email)
        page.get_by_role("textbox", name="Authentication code").fill("000000")
        page.get_by_role("button", name="Verify").click()
        shows(page, page.get_by_text("That code is not valid"))
        page.get_by_role("link", name="Use a recovery code").click()
        page.get_by_role("textbox", name="Recovery code").fill(codes[2])
        page.get_by_role("button", name="Verify").click()
        page.wait_for_url(lambda u: urlparse(u).path == "/console", timeout=UI_TIMEOUT_MS)
    assert ok(call(base, "POST", "/api/auth/totp/disable", token, {"code": codes[3]}, version=None)) == {"enabled": False}
    refused(call(base, "POST", "/api/auth/totp/disable", token, {"code": codes[4]}, version=None), 409, "TOTP_NOT_ON")
    ok(login_raw(base, email, totp="123456"))
    assert tables_holding(pg, secret) == []


def test_wf_members_audit_attribution(browser, base, acme, mail):
    o1, t1 = acme.add_member("owner")
    m = fresh_email("added")
    ok(call(base, "POST", "/api/v2/members", t1, {"email": m, "role": "viewer", "password": PASSWORD}), 201)
    acme.members.append(m)
    refused(call(base, "POST", "/api/v2/members", t1, {"email": m.upper(), "role": "viewer", "password": PASSWORD}), 409, "MEMBER_EXISTS")
    refused(call(base, "POST", "/api/v2/members", t1, {"email": fresh_email("s"), "role": "viewer", "password": "short"}), 400, "VALIDATION_ERROR", field="password")
    added = mails(mail, m, "You have been added to Acme Ops on Tessel")
    assert len(added) == 1 and "viewer" in mail_text(added[0]) and "/login" in mail_text(added[0])
    path = f"/api/v2/members/{quote(m, safe='@')}"
    assert ok(call(base, "PATCH", path, t1, {"role": "owner"})) == {"email": m, "role": "owner"}
    ok(call(base, "PATCH", path, t1, {"role": "owner"}))
    tm = login(base, m)
    key = acme.add_key("viewer", token=tm)
    ok(call(base, "DELETE", path, t1))
    refused(call(base, "DELETE", path, t1), 404, "MEMBER_NOT_FOUND")
    events = ok(audit(base, t1, actor=o1.upper()))["events"]
    assert [(e["action"], e["target"], e["detail"]) for e in events] == [
        ("member.remove", m, ""), ("member.role", m, "viewer -> owner"), ("member.add", m, "viewer")]
    mine = ok(audit(base, acme.token, actor=m))["events"]
    assert [(e["action"], e["target"], e["detail"], e["actor"]) for e in mine] == [("key.create", key["name"], "viewer", m)]

    viewer, _ = acme.add_member("viewer")
    vpath = f"/api/v2/members/{quote(viewer, safe='@')}"
    for i in range(AUDIT_PAGE + 1):
        ok(call(base, "PATCH", vpath, t1, {"role": "editor" if i % 2 == 0 else "viewer"}))
    query = f"/console/settings/audit?action=member.role&actor={quote(o1, safe='@')}"
    with signed_in(browser, base, o1, query) as page:
        rows = page.get_by_role("row").filter(has_text="member.role")
        eventually(page, lambda: expect(rows).to_have_count(AUDIT_PAGE, timeout=POLL_MS))
        page.get_by_role("button", name="Load more").click()
        eventually(page, lambda: expect(rows).to_have_count(AUDIT_PAGE + 2, timeout=POLL_MS))
        state = query_of(page)
        assert state["action"] == ["member.role"] and state["actor"] == [o1]
        page.reload()
        eventually(page, lambda: expect(rows).to_have_count(AUDIT_PAGE, timeout=POLL_MS))
        page.goto(f"{base}/console/settings/audit?actor={quote(m, safe='@')}")
        shows(page, page.get_by_role("row").filter(has_text="key.create"), m)
        page.goto(f"{base}/console/settings/audit?action=export.request&actor={quote(viewer, safe='@')}")
        shows(page, page.get_by_text("No audit events match these filters"))

    owner_path = f"/api/v2/members/{quote(ACME_OWNER, safe='@')}"
    own_path = f"/api/v2/members/{quote(o1, safe='@')}"
    try:
        answers = race([lambda: call(base, "PATCH", owner_path, t1, {"role": "viewer"}),
                        lambda: call(base, "PATCH", own_path, acme.token, {"role": "viewer"})])
        for r in answers:
            if r.status_code != 200:
                assert r.json()["error"]["code"] in ("LAST_OWNER", "FORBIDDEN_ROLE")
        roles = [x["role"] for x in ok(call(base, "GET", "/api/v2/members", t1 if answers[0].status_code != 200 else acme.token))["members"]]
        assert "owner" in roles
    finally:
        call(base, "PATCH", owner_path, t1, {"role": "owner"})


def test_wf_members_audit_csv_paging(base, acme):
    o1, t1 = acme.add_member("owner")
    formula = '=HYPERLINK("http://x","y")'
    k1 = acme.add_key("viewer", name=formula, token=t1)
    k2 = acme.add_key("viewer", name="-k", token=t1)
    for _ in range(3):
        acme.add_key("viewer", token=t1)
    pages, seen = [], []
    first = ok(audit(base, t1, actor=o1, limit=2))
    assert set(first) == {"events", "next_cursor"} and len(first["events"]) == 2
    acme.add_key("viewer", token=t1, name=fresh_id("late"))
    pages.append(first)
    cursor = first["next_cursor"]
    while cursor:
        page = ok(audit(base, t1, actor=o1, limit=2, cursor=cursor))
        pages.append(page)
        cursor = page["next_cursor"]
    for p in pages:
        seen.extend(p["events"])
    ids = [e["id"] for e in seen]
    assert len(ids) == len(set(ids)) == 5
    assert all(set(e) == {"id", "at", "actor", "action", "target", "detail"} for e in seen)
    assert [e["at"] for e in seen] == sorted([e["at"] for e in seen], reverse=True)
    assert {e["target"] for e in seen} >= {formula, "-k"}
    late = ok(audit(base, t1, actor=o1, limit=1))["events"][0]
    assert late["id"] not in ids and late["target"].startswith("late")

    csv = audit(base, t1, actor=o1, format="csv")
    assert csv.status_code == 200 and csv.headers["Content-Type"] == "text/csv; charset=utf-8"
    assert csv.text.endswith("\n")
    lines = csv.text.split("\n")[:-1]
    assert lines[0] == "id,at,actor,action,target,detail"
    assert [line.split(",")[0] for line in lines[1:]] == [str(late["id"])] + [str(i) for i in ids]
    assert '"\'=HYPERLINK(""http://x"",""y"")"' in csv.text and "," + "'" + "-k" + "," in csv.text
    accepted = audit(base, t1, actor=o1, headers={"Accept": "text/csv"})
    assert accepted.text == csv.text
    events = {e["target"]: e for e in ok(audit(base, t1, actor=o1, limit=AUDIT_LIMIT_MAX))["events"]}
    assert events[formula]["action"] == "key.create" and events["-k"]["detail"] == "viewer"
    assert k1["name"] == formula and k2["name"] == "-k"
    for bad in ("0", str(AUDIT_LIMIT_MAX + 1), "x"):
        refused(audit(base, t1, limit=bad), 400, "VALIDATION_ERROR", field="limit")
    refused(audit(base, t1, action="key.explode"), 400, "VALIDATION_ERROR", field="action")
    refused(audit(base, t1, cursor="not-a-cursor"), 400, "INVALID_CURSOR")
    refused(audit(base, t1, actor=o1, action="key.create", limit=2, cursor=first["next_cursor"]), 400, "INVALID_CURSOR")
    refused(audit(base, login(base, NW_OWNER), actor=o1, limit=2, cursor=first["next_cursor"]), 400, "INVALID_CURSOR")


BAD_NEXT = ["/consoleevil", "//evil.example/console", "/\\evil.example", "/console/../login", "/%09/evil.example",
            "https://evil.example/console", "%2F%2Fevil.example"]


def test_wf_sessions_return_paths(browser, base, acme):
    db = acme.create_db("rp")
    viewer, viewer_token = acme.add_member("viewer")
    context = browser.new_context(java_script_enabled=False)
    try:
        page = context.new_page()
        for value in BAD_NEXT + ["/console/db/launch_brain?tab=graph"]:
            page.goto(f"{base}/login?next={quote(value, safe='')}")
            sign_in_form(page, NW_VIEWER)
            page.wait_for_load_state()
            landed = urlparse(page.url)
            if value.startswith("/console/db"):
                assert (landed.path, landed.query) == ("/console/db/launch_brain", "tab=graph")
            else:
                assert landed.path == "/console", value
        page.close()
    finally:
        context.close()

    path = f"/console/db/{db}?tab=search"
    with open_app(browser, f"{base}/console/settings") as page:
        page.set_viewport_size(DESKTOP)
        page.wait_for_url(lambda u: urlparse(u).path == "/login", timeout=UI_TIMEOUT_MS)
        assert query_of(page)["next"] == ["/console/settings"]
        sign_in_form(page, viewer)
        page.wait_for_url(lambda u: urlparse(u).path == "/console/settings", timeout=UI_TIMEOUT_MS)
        page.reload()
        assert urlparse(page.url).path == "/console/settings"
        page.goto(base + path)
        ok(call(base, "POST", "/api/auth/logout-all", viewer_token, version=None))
        page.get_by_role("textbox", name="Words").fill("anything")
        page.get_by_role("button", name="Search").click()
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/login\?next="), timeout=POLL_MS))
        assert query_of(page)["next"][0].startswith(f"/console/db/{db}")
        expect(page.get_by_text("Your session has ended. Sign in again.")).to_be_visible()
        sign_in_form(page, viewer)
        page.wait_for_url(lambda u: urlparse(u).path == f"/console/db/{db}", timeout=UI_TIMEOUT_MS)
        page.get_by_role("button", name="Sign out", exact=True).click()
        page.wait_for_url(lambda u: urlparse(u).path == "/", timeout=UI_TIMEOUT_MS)
        page.goto(f"{base}/console")
        page.wait_for_url(lambda u: urlparse(u).path == "/login", timeout=UI_TIMEOUT_MS)


def test_wf_sessions_password_reset(browser, base, acme, mail):
    email, token = acme.add_member("viewer")
    stranger = fresh_email("nobody")
    known = call(base, "POST", "/api/auth/forgot", body={"email": email}, version=None)
    unknown = call(base, "POST", "/api/auth/forgot", body={"email": stranger}, version=None)
    assert ok(known) == ok(unknown) == {"sent": True}
    refused(call(base, "POST", "/api/auth/forgot", body={"email": "not-an-email"}, version=None), 400, "VALIDATION_ERROR", field="email")
    assert mails(mail, stranger, "Reset your Tessel password", minimum=0) == []

    def link_token(message):
        first = next(line for line in mail_text(message).splitlines() if line.strip())
        found = re.search(r"/reset\?token=([0-9a-f]{64})$", first.strip())
        assert found, first
        return found.group(1)

    reset_token = link_token(mails(mail, email, "Reset your Tessel password")[0])
    new_password = "fresh-password-" + uuid.uuid4().hex[:8]
    with open_app(browser, f"{base}/forgot") as page:
        page.get_by_role("textbox", name="Email").fill(stranger)
        page.get_by_role("button", name="Send reset link").click()
        shows(page, page.get_by_text("If that email belongs to a member, a reset link is on its way."))
        page.goto(f"{base}/reset?token={reset_token}")
        page.get_by_label("New password", exact=True).fill(new_password)
        page.get_by_label("Confirm new password").fill(new_password + "x")
        page.get_by_role("button", name="Set password").click()
        shows(page, page.get_by_text("The passwords do not match"))
        page.get_by_label("Confirm new password").fill(new_password)
        page.get_by_role("button", name="Set password").click()
        page.wait_for_url(lambda u: urlparse(u).path == "/login", timeout=UI_TIMEOUT_MS)
        expect(page.get_by_text("Your password was reset. Sign in with the new one.")).to_be_visible()
        page.goto(f"{base}/reset?token={reset_token}")
        expect(page.get_by_text("This reset link is no longer valid")).to_be_visible()
        expect(page.get_by_role("link", name="Request a new link")).to_have_attribute("href", "/forgot")
        expect(page.get_by_role("button", name="Set password")).to_have_count(0)
    refused(call(base, "GET", "/api/me", token, version=None), 401, "INVALID_API_KEY")
    assert len(mails(mail, email, "Your Tessel password was reset")) == 1
    refused(login_raw(base, email), 401, "BAD_CREDENTIALS")
    ok(login_raw(base, email, new_password))
    refused(call(base, "POST", "/api/auth/reset", body={"token": reset_token, "password": new_password + "y"}, version=None),
            400, "RESET_TOKEN_INVALID")
    for _ in range(RESET_EMAILS):
        ok(call(base, "POST", "/api/auth/forgot", body={"email": email}, version=None))
    sent = mails(mail, email, "Reset your Tessel password", minimum=RESET_EMAILS)
    assert len(sent) == RESET_EMAILS
    tokens_sent = [link_token(m) for m in sent]
    fresh_tokens = [t for t in tokens_sent if t != reset_token]
    assert len(fresh_tokens) == RESET_EMAILS - 1
    answers = [call(base, "POST", "/api/auth/reset", body={"token": t, "password": new_password + "z"}, version=None)
               for t in fresh_tokens]
    assert sum(r.status_code == 200 for r in answers) == 1
    for r in answers:
        if r.status_code == 200:
            assert ok(r) == {"reset": True}
        else:
            refused(r, 400, "RESET_TOKEN_INVALID")
    live = fresh_tokens[[r.status_code for r in answers].index(200)]
    refused(call(base, "POST", "/api/auth/reset", body={"token": live, "password": new_password + "w"}, version=None),
            400, "RESET_TOKEN_INVALID")
    ok(login_raw(base, email, new_password + "z"))


def test_wf_sessions_end_sessions(browser, base, acme):
    email, first = acme.add_member("editor")
    second = login(base, email)
    with signed_in(browser, base, email, "/console/settings") as page:
        for name in ("Sign out everywhere", "Change password", "Set up two-step sign-in"):
            expect(page.get_by_role("button", name=name)).to_be_visible()
        expect(page.get_by_text("Off").first).to_be_visible()
        hrefs = page.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href'))")
        assert not {"/console/settings/keys", "/console/settings/billing", "/console/settings/audit"} & set(hrefs)
        expect(page.get_by_role("button", name="Add member")).to_have_count(0)
        page.get_by_label("Current password").fill(PASSWORD)
        page.get_by_label("New password", exact=True).fill(PASSWORD + "-next")
        page.get_by_label("Confirm new password").fill(PASSWORD + "-nope")
        page.get_by_role("button", name="Change password").click()
        shows(page, page.get_by_text("The passwords do not match"))
        page.get_by_label("Confirm new password").fill(PASSWORD + "-next")
        page.get_by_role("button", name="Change password").click()
        shows(page, page.get_by_role("status").filter(has_text="Password changed").first)
        refused(call(base, "GET", "/api/me", first, version=None), 401, "INVALID_API_KEY")
        refused(call(base, "GET", "/api/me", second, version=None), 401, "INVALID_API_KEY")
        page.reload()
        assert urlparse(page.url).path == "/console/settings"
    current = login(base, email, PASSWORD + "-next")
    refused(call(base, "POST", "/api/auth/password", current, {"current_password": "wrong-password-0", "new_password": PASSWORD + "-x"}, version=None),
            401, "BAD_CREDENTIALS")
    refused(call(base, "POST", "/api/auth/password", current, {"current_password": PASSWORD + "-next", "new_password": "short"}, version=None),
            400, "VALIDATION_ERROR", field="new_password")
    refused(call(base, "POST", "/api/auth/password", current, {"current_password": PASSWORD + "-next", "new_password": PASSWORD + "-next"}, version=None),
            400, "VALIDATION_ERROR", field="new_password")
    other = login(base, email, PASSWORD + "-next")
    changed = ok(call(base, "POST", "/api/auth/password", current, {"current_password": PASSWORD + "-next", "new_password": PASSWORD + "-last"}, version=None))
    assert changed == {"changed": True, "revoked_sessions": 2}
    refused(call(base, "GET", "/api/me", other, version=None), 401, "INVALID_API_KEY")
    ok(call(base, "GET", "/api/me", current, version=None))
    extra = login(base, email, PASSWORD + "-last")
    assert ok(call(base, "POST", "/api/auth/logout-all", current, version=None)) == {"revoked_sessions": 2}
    for t in (current, extra):
        refused(call(base, "GET", "/api/me", t, version=None), 401, "INVALID_API_KEY")
    with signed_in(browser, base, ACME_OWNER, "/console/settings") as page:
        hrefs = page.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href'))")
        assert {"/console/settings/keys", "/console/settings/billing", "/console/settings/audit"} <= set(hrefs)


def test_wf_feedback_limits_bounded_bodies(base, acme, pg):
    t = acme.token
    rid = ok_request(base, t, LAUNCH)
    foreign = ok_request(base, login(base, NW_VIEWER), LAUNCH)

    def send(body):
        return call(base, "POST", "/api/v2/feedback", t, {"request_id": rid, **body})

    bad = [({}, 400, "VALIDATION_ERROR", "feedback"), ({"feedback": "x" * (FEEDBACK_MAX + 1)}, 400, "VALIDATION_ERROR", "feedback"),
           ({"feedback": "x", "metadata": {f"k{i}": "v" for i in range(META_ENTRIES + 1)}}, 400, "VALIDATION_ERROR", "metadata"),
           ({"feedback": "x", "metadata": {"bad key": "v"}}, 400, "VALIDATION_ERROR", "metadata.bad key"),
           ({"feedback": "x", "metadata": {"k": "v" * (META_VALUE_MAX + 1)}}, 400, "VALIDATION_ERROR", "metadata.k"),
           ({"feedback": "x", "metadata": {"k": {"n": "1"}}}, 400, "VALIDATION_ERROR", "metadata.k"),
           ({"feedback": "x", "metadata": {"k": ["a"]}}, 400, "VALIDATION_ERROR", "metadata.k"),
           ({"ground_truth": {"answer": "", "source_ids": ["a"]}}, 400, "VALIDATION_ERROR", "ground_truth.answer"),
           ({"ground_truth": {"answer": "x", "source_ids": []}}, 400, "VALIDATION_ERROR", "ground_truth.source_ids"),
           ({"ground_truth": {"answer": "x", "source_ids": [f"s{i}" for i in range(GT_IDS_MAX + 1)]}}, 400, "VALIDATION_ERROR", "ground_truth.source_ids"),
           ({"ground_truth": {"answer": "x", "source_ids": ["a", "a"]}}, 400, "VALIDATION_ERROR", "ground_truth.source_ids.1"),
           ({"ground_truth": {"answer": "x", "source_ids": ["bad id"]}}, 400, "VALIDATION_ERROR", "ground_truth.source_ids.0"),
           ({"ground_truth": {"answer": "x", "source_ids": ["a"], "extra": "1"}}, 400, "UNKNOWN_FIELD", "ground_truth.extra"),
           ({"feedback": "x", "rating": "meh"}, 400, "VALIDATION_ERROR", "rating"),
           ({"feedback": "x", "source": "robot"}, 400, "VALIDATION_ERROR", "source"),
           ({"feedback": "x", "request_id": str(uuid.uuid4())}, 404, "REQUEST_NOT_FOUND", None),
           ({"feedback": "x", "request_id": foreign}, 404, "REQUEST_NOT_FOUND", None)]
    for _ in range(7):
        for body, status, code, field in bad:
            refused(send(body), status, code, **({} if field is None else {"field": field}))
    boundary = [{"feedback": "x", "metadata": {("k" * ID_MAX if i == 0 else f"k{i}"): "v" * META_VALUE_MAX for i in range(META_ENTRIES)}},
                {"feedback": "\U0001F600" * FEEDBACK_MAX, "rating": "negative", "source": "agent"},
                {"ground_truth": {"answer": "x", "source_ids": [f"s{i}" for i in range(GT_IDS_MAX)]}}]
    for body in boundary:
        assert ok(send(body), 201) == {"request_id": rid, "received": True}
    org = pg.rows(f"select id::text as id from organizations where name = {sql(ACME)}")[0]["id"]
    prior = pg.rows(f"select count(*) as n from feedback f join query_records q on q.request_id::text = f.request_id::text "
                    f"where q.organization_id::text = {sql(org)} and f.created_at > now() - interval '{FEEDBACK_WINDOW_S} seconds'")[0]["n"]
    accepted = 0
    while True:
        r = send({"feedback": "quota"})
        if r.status_code == 429:
            assert 1 <= throttled(r, "RATE_LIMITED") <= FEEDBACK_WINDOW_S
            break
        ok(r, 201)
        accepted += 1
        assert accepted <= FEEDBACK_LIMIT
    assert accepted >= FEEDBACK_LIMIT - prior


def test_wf_feedback_limits_list_ranges(base, acme):
    t = acme.token
    for good in ("1", str(AUDIT_LIMIT_MAX)):
        assert len(ok(audit(base, t, limit=good))["events"]) <= int(good)
    assert len(ok(audit(base, t))["events"]) <= AUDIT_PAGE
    for bad in ("0", str(AUDIT_LIMIT_MAX + 1), "-1", "1.5", "ten"):
        refused(audit(base, t, limit=bad), 400, "VALIDATION_ERROR", field="limit")
    db = acme.create_db("lr")
    ok(ingest(base, t, db, [src(fresh_id("r"), f"Range {i}", "range words here", []) for i in range(SEARCH_MAX + 1)]), 201)
    assert len(ok(search(base, t, db, "range"))["results"]) == 5
    for good in (1, SEARCH_MAX):
        assert len(ok(search(base, t, db, "range", max_results=good))["results"]) == good
    for bad in (0, SEARCH_MAX + 1, -1, "5", 2.5):
        refused(search(base, t, db, "range", max_results=bad), 400, "VALIDATION_ERROR", field="max_results")
    v = login(base, NW_VIEWER)
    assert len(graph(base, v, LAUNCH, "2026-03-20T00:00:00Z", "OWNED_BY,BLOCKED_BY")["edges"]) == 4
    for bad in ("owned_by", "OWNED-BY", "X", "OWNED_BY,"):
        refused(call(base, "GET", "/api/v2/context/graph", v, params={"database": LAUNCH, "predicates": bad}),
                400, "VALIDATION_ERROR", field="predicates")


def check_bill(u, days):
    rate, minimum = RATES[u["plan"]], MINIMUMS[u["plan"]]
    assert set(u) == {"month", "plan", "month_tokens", "storage_bytes", "ontology_cents", "storage_cents",
                      "usage_cents", "minimum_cents", "billed_cents", "minimum_applied"}
    assert u["ontology_cents"] == ceil_div(u["month_tokens"] * ONTOLOGY_RATE, TOKENS_PER_MILLION)
    assert u["storage_cents"] == ceil_div(u["storage_bytes"] * rate, GB)
    assert u["usage_cents"] == u["ontology_cents"] + u["storage_cents"]
    assert u["minimum_cents"] == minimum and u["billed_cents"] == max(u["usage_cents"], minimum)
    assert u["minimum_applied"] is (u["usage_cents"] < minimum)
    assert days["month"] == u["month"] and days["days"][0]["day"] == u["month"] + "-01"
    assert [int(d["day"][-2:]) for d in days["days"]] == list(range(1, len(days["days"]) + 1))
    assert sum(d["tokens"] for d in days["days"]) == u["month_tokens"]


def bill(base, t):
    u, d = usage(base, t), ok(call(base, "GET", "/api/v2/usage/daily", t))
    check_bill(u, d)
    return u, d


def test_wf_billing_incurred_usage(browser, base, acme):
    t = acme.token
    db = acme.create_db("bl")
    u0, d0 = bill(base, t)
    s1 = src(fresh_id("b"), "Billing source one", "Tokens are billed when ingested.", [fact("Bill", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z")])
    s2 = src(fresh_id("b"), "Billing source two", "Storage follows what exists now.", [])
    key = idempotency_key()
    ok(ingest(base, t, db, [s1, s2], key=key), 201)
    added = token_count(s1["title"], s1["text"]) + token_count(s2["title"], s2["text"])
    u1, d1 = bill(base, t)
    assert u1["month_tokens"] == u0["month_tokens"] + added
    assert u1["storage_bytes"] == u0["storage_bytes"] + storage_of([s1, s2])
    assert d1["days"][-1]["tokens"] - d0["days"][-1]["tokens"] == added
    st = stats(base, t, db)
    assert (st["tokens_ingested"], st["storage_bytes"]) == (added, storage_of([s1, s2]))
    ok(ingest(base, t, db, [s1, s2], key=key), 201)
    refused(ingest(base, t, db, [src(fresh_id("b"), "", "refused", [])]), 400, "VALIDATION_ERROR")
    assert bill(base, t)[0] == u1
    ok(delete_source(base, t, db, s1["id"]))
    u2, _ = bill(base, t)
    assert u2["month_tokens"] == u1["month_tokens"] and u2["storage_bytes"] == u1["storage_bytes"] - storage_of([s1])
    assert stats(base, t, db)["tokens_ingested"] == added
    ok(restore(base, t, db, s1["id"]))
    u3, d3 = bill(base, t)
    assert u3 == u1
    with signed_in(browser, base, ACME_OWNER, "/console/settings/billing") as page:
        shows(page, page.get_by_text(f"{u3['month_tokens']:,} tokens this month"))
        expect(page.get_by_text(f"${u3['billed_cents'] // 100:,}.{u3['billed_cents'] % 100:02d}").first).to_be_visible()
        expect(page.get_by_role("columnheader", name="Day")).to_be_visible()
        expect(page.get_by_role("row").filter(has_text=d3["days"][-1]["day"])).to_contain_text(f"{d3['days'][-1]['tokens']:,}")
        expect(page.get_by_text("Tokens ingested by day")).to_be_visible()
        page.goto(f"{base}/console/db/{db}?tab=stats")
        shows(page, page.get_by_text("Tokens ingested").first)
        expect(page.get_by_text(f"{added:,}", exact=True).first).to_be_visible()


def test_wf_billing_deleted_database(browser, base, acme, pg):
    t = acme.token
    name = fresh_name("bd")
    doc = {"collections": [{"name": "default", "sources": [
        {"id": "imp-1", "version": 3, "title": "Imported one", "text": "Imported text counts tokens.",
         "facts": [fact("Imp", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z")]},
        {"id": "imp-2", "version": 1, "title": "Imported two", "text": "More imported words.", "facts": []}]}]}
    u0, _ = bill(base, t)
    created = ok(call(base, "POST", "/api/v2/databases/import", t, {"name": name, "document": doc}), 201)
    acme.databases.append(name)
    assert (created["sources"], created["facts"], created["status"]) == (2, 1, "provisioning")
    sources = doc["collections"][0]["sources"]
    tokens_in = sum(token_count(s["title"], s["text"]) for s in sources)
    u1, _ = bill(base, t)
    assert u1["month_tokens"] == u0["month_tokens"] + tokens_in and u1["storage_bytes"] == u0["storage_bytes"] + storage_of(sources)
    org = pg.rows(f"select id::text as id from organizations where name = {sql(ACME)}")[0]["id"]
    total = f"select coalesce(sum(token_count), 0) as n from source_versions where organization_id::text = {sql(org)}"
    kept = pg.rows(total)[0]["n"]
    gone_id = db_id(pg, ACME, name)
    wait_ready(base, t, name)
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        page.get_by_role("row").filter(has_text=name).get_by_role("button", name="Delete").click()
        page.get_by_role("textbox", name="Type the database name to confirm").fill(name)
        page.get_by_role("button", name="Delete database").click()
        eventually(page, lambda: expect(page.get_by_role("link", name=name)).to_have_count(0, timeout=POLL_MS))
    u2, _ = bill(base, t)
    assert u2["month_tokens"] == u1["month_tokens"] and u2["storage_bytes"] == u1["storage_bytes"] - storage_of(sources)
    assert pg.rows(total)[0]["n"] == kept
    assert pg.rows(f"select count(*) as n from source_versions where database_id::text = {sql(gone_id)}")[0]["n"] == 0


def test_wf_landing_page_calculator(browser, base):
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        storage, tokens_field = page.get_by_label("Storage (GB)"), page.get_by_label("Tokens ingested per month (millions)")
        cases = [("3.2", "2.4", ["$25.00", "$300.00"], True), ("100000", "100000", ["$550,000.00", "$525,000.00"], False),
                 ("1000", "100", ["$1,000.00", "$750.00"], False), ("0.1", "0", ["$25.00"], True)]
        for gb, millions, figures, minimum in cases:
            storage.fill(gb)
            tokens_field.fill(millions)
            for figure in figures:
                shows(page, page.get_by_text(figure).first)
            if minimum:
                expect(page.get_by_text("minimum applies").first).to_be_visible()
        expect(page.get_by_text("Custom").first).to_be_visible()
        storage.fill("100000")
        tokens_field.fill("100000")
        shows(page, page.get_by_text("$550,000.00").first)
        error = "Enter a number from 0 to 100000 with at most one decimal"
        for bad in ("1e3", "+5", "1,5", "12.", "100000.1", "1.25", "-1"):
            storage.fill(bad)
            shows(page, page.get_by_text(error).first)
            expect(page.get_by_text("$550,000.00").first).to_be_visible()
            expect(storage).to_have_value(bad)
        storage.fill("0")
        eventually(page, lambda: expect(page.get_by_text(error)).to_have_count(0, timeout=POLL_MS))


def test_wf_landing_page_content(browser, base):
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        heading = page.get_by_role("heading", level=1, name="Give agents ability to retrieve the most accurate context")
        expect(heading).to_be_visible()
        for copy in ("Tessel is open source", "Trusted by teams building world-class agents", "The GraphDB purpose-built for agents",
                     "94%", "< 200ms", "Built on object storage, with separate compute for writes, indexing, and reads.",
                     "Writer node", "namespace/manifest.json", "What do you use graphs for?", "SOTA for agent applications",
                     "90.79%", "LONGMEMEVAL-S", "90.73", "CODEWIKI-BENCH", "88.7", "ENTERPRISE RAG BENCH", "82%", "BEAM 1M",
                     "91.4%", "FINANCEBENCH", "Accuracy vs context length", "Similarity isn't relevance", "$25/mo min usage",
                     "$300/mo min usage", "Self host", "Our mission is to make AI stateful", "(c) 2026 Tessel Labs, Inc",
                     "Tessel vs Neo4j", "SOC 2", "HIPAA"):
            expect(page.get_by_text(copy).first).to_be_attached()
        expect(page.get_by_role("link", name="View on code host")).to_be_visible()
        banner = page.get_by_role("banner")
        for name, anchor in (("Architecture", "architecture"), ("Benchmarks", "benchmarks"), ("Pricing", "pricing")):
            expect(banner.get_by_role("link", name=name)).to_have_attribute("href", re.compile(f"#{anchor}$"))
        first_q = page.get_by_role("button", name="What makes Tessel different?")
        second_q = page.get_by_role("button", name="Who is Tessel for?")
        first_q.click()
        second_q.click()
        expect(first_q).to_have_attribute("aria-expanded", "true")
        expect(second_q).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_role("link", name="Talk to us").first).to_have_attribute("href", "/contact")
    with open_app(browser, base + "/contact") as page:
        page.set_viewport_size(DESKTOP)
        expect(page.get_by_role("heading", name="Contact sales")).to_be_visible()
        for copy in ("A complete graph of context for your agents.", "Agent benchmarks", "EnterpriseRAG", "LongMemEval", "FinanceBench",
                     "tessel-labs/tessel", "Included with Enterprise", "99% SLA", "Dedicated cloud or BYOC", "HIPAA BAA",
                     "Private Slack, dedicated FDE"):
            expect(page.get_by_text(copy).first).to_be_visible()
        expect(page.get_by_role("link", name="Book a call")).to_be_visible()


def test_wf_landing_page_layouts(browser, base, acme):
    acme.create_db("ly", wait=False)
    plans = ("Open Source", "Ship", "Scale", "Enterprise")
    for size in (PHONE, TABLET, DESKTOP):
        with open_app(browser, base + "/") as page:
            page.set_viewport_size(size)
            layout(page)
            boxes = [page.get_by_role("heading", name=p, exact=True).first.bounding_box() for p in plans]
            orch = page.get_by_text("Retrieval orchestrator").first.bounding_box()
            writer = page.get_by_text("Writer node").first.bounding_box()
            if size is PHONE:
                assert all(boxes[i + 1]["y"] > boxes[i]["y"] for i in range(3))
                assert abs(boxes[0]["x"] - boxes[3]["x"]) < boxes[0]["width"]
            if size is DESKTOP:
                assert max(b["y"] for b in boxes) - min(b["y"] for b in boxes) < boxes[0]["height"] + 1
                assert writer["x"] > orch["x"] + orch["width"]
            if size is TABLET:
                assert writer["y"] > orch["y"] + orch["height"]
            page.goto(base + "/contact")
            layout(page)
    with signed_in(browser, base, ACME_OWNER, "/console", viewport=PHONE) as page:
        layout(page)
        link = page.get_by_role("link", name=LAUNCH)
        status = page.get_by_text("ready").first
        assert link.bounding_box()["y"] < status.bounding_box()["y"]


def test_wf_accessibility_motion_busy_states(browser, base, acme, pg):
    name = fresh_name("bs")
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        nav = page.get_by_role("navigation")
        expect(nav.get_by_role("link", name="Databases")).to_have_attribute("aria-current", "page")
        expect(nav.get_by_role("link", name="Settings")).to_be_visible()
        for copy in (ACME, ACME_OWNER, "owner"):
            expect(page.get_by_text(copy).first).to_be_visible()
        expect(page.get_by_role("table")).to_be_visible()
        textbox(page, "Name").fill(name)
        with held(page, "**/api/v2/databases") as gate:
            page.get_by_role("button", name="Create", exact=True).click()
            waiting = page.get_by_role("button", name="Creating...")
            expect(waiting).to_be_visible()
            assert busy_ancestor(waiting)
            waiting.dispatch_event("click")
            gate.release()
        acme.databases.append(name)
        toasts = page.get_by_role("status").filter(has=page.get_by_role("button", name="Close"))
        toast = toasts.filter(has_text="Database created")
        shows(page, toast.first)
        expect(page.get_by_role("status", name="Console announcements")).to_contain_text("Database created")
        assert toast.count() == 1
        advance(page, TOAST_MS - 1000)
        expect(toast.first).to_be_visible()
        advance(page, 2000)
        eventually(page, lambda: expect(toast).to_have_count(0, timeout=POLL_MS))
        bad_name = name.upper()
        message = refused(call(base, "POST", "/api/v2/databases", acme.token, {"name": bad_name}), 400, "VALIDATION_ERROR")["message"]
        for _ in range(4):
            textbox(page, "Name").fill(bad_name)
            page.get_by_role("button", name="Create", exact=True).click()
            shows(page, toasts.filter(has_text=message).first)
        assert toasts.count() <= 3
        expect(textbox(page, "Name")).to_have_value(bad_name)
        toasts.filter(has_text=message).first.get_by_role("button", name="Close").click()
    count = pg.rows(f"select count(*) as n from databases where name = {sql(name)}")[0]["n"]
    assert count == 1
    with signed_in(browser, base, NW_VIEWER, f"/console/db/{LAUNCH}?tab=graph") as page:
        page.get_by_role("textbox", name="Statement").fill(Q_ATLAS)
        page.get_by_role("textbox", name="As of").fill("2026-03-11T00:00:00Z")
        with held(page, "**/api/v2/query") as gate:
            page.get_by_role("button", name="Run").click()
            running = page.get_by_role("button", name="Running...")
            expect(running).to_be_visible()
            assert busy_ancestor(running)
            gate.release()
        shows(page, page.get_by_role("cell", name="Dana Okafor"))
        shows(page, page.get_by_role("status", name="Console announcements"), "Query answered: 1 rows")
        page.route("**/api/v2/query", lambda route: route.abort())
        page.get_by_role("button", name="Run").click()
        shows(page, page.get_by_text("Something went wrong. Try again."))
        expect(page.get_by_role("cell", name="Dana Okafor")).to_be_visible()
        expect(page.get_by_role("textbox", name="Statement")).to_have_value(Q_ATLAS)


def test_wf_accessibility_motion_delete_dialog(browser, base, acme):
    db = acme.create_db("dd", wait=False)
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        axe(page)
        row_delete = page.get_by_role("row").filter(has_text=db).get_by_role("button", name="Delete")
        row_delete.click()
        dialog = page.get_by_role("dialog", name=f"Delete database {db}")
        expect(dialog).to_be_visible()
        inside = "d => d.contains(document.activeElement)"
        assert dialog.evaluate(inside)
        for key in ["Tab"] * 5 + ["Shift+Tab"] * 5:
            page.keyboard.press(key)
            assert dialog.evaluate(inside)
        confirm = dialog.get_by_role("button", name="Delete database")
        expect(confirm).to_be_disabled()
        dialog.get_by_role("textbox", name="Type the database name to confirm").fill(db[:-1])
        expect(confirm).to_be_disabled()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(row_delete).to_be_focused()
        row_delete.click()
        dialog.get_by_role("button", name="Cancel").click()
        expect(row_delete).to_be_focused()
        row_delete.click()
        dialog.get_by_role("textbox", name="Type the database name to confirm").fill(db)
        expect(confirm).to_be_enabled()
        confirm.click()
        eventually(page, lambda: expect(page.get_by_role("link", name=db)).to_have_count(0, timeout=POLL_MS))
    refused(call(base, "GET", "/api/v2/databases/status", acme.token, params={"database": db}), 404, "DATABASE_NOT_FOUND")
    for path in ("/", "/contact", "/login"):
        with open_app(browser, base + path) as page:
            page.set_viewport_size(DESKTOP)
            axe(page)
            assert tab_order(page, 1)[0] == "Skip to main content"
            focused = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
            assert focused != "none"
            page.get_by_role("button").first.click()
            clicked = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
            assert clicked == "none"
            page.set_viewport_size(PHONE)
            layout(page)
            sizes = page.get_by_role("button").evaluate_all(
                "els => els.filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; })")
            assert all(w >= TOUCH_MIN - 0.5 and h >= TOUCH_MIN - 0.5 for w, h in sizes), sizes


ANIMS_UP = """el => { const out = []; for (let e = el; e; e = e.parentElement) for (const a of e.getAnimations())
  { const t = a.effect.getComputedTiming(); out.push({d: t.duration, it: t.iterations, delay: t.delay,
    props: a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(p => !['offset','easing','composite','computedOffset'].includes(p))}); }
  return out; }"""


def test_wf_accessibility_motion_motion(browser, base):
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        loops = page.get_by_text("toptal").first.evaluate(ANIMS_UP)
        infinite = [a for a in loops if a["it"] is None or a["it"] == float("inf") or str(a["it"]) == "Infinity"]
        assert infinite, loops
        assert all(set(a["props"]) <= {"transform", "translate", "left", "marginLeft", "insetInlineStart"} for a in infinite)
        page.evaluate("window.__seen = new Set(document.getAnimations())")
        page.get_by_role("banner").get_by_role("button", name="Resources").click()
        fresh = page.evaluate("document.getAnimations().filter(a => !window.__seen.has(a)).map(a => a.effect.getComputedTiming().duration)")
        assert fresh and all(0 < d < TRANSITION_MAX_MS for d in fresh), fresh
        page.keyboard.press("Escape")
        page.evaluate("window.__seen = new Set(document.getAnimations())")
        page.get_by_role("radio", name="Graph").click()
        drawn = page.evaluate("document.getAnimations().filter(a => !window.__seen.has(a)).map(a => a.effect.getComputedTiming().delay)")
        assert len(drawn) >= HERO_EDGES and len(set(drawn)) > 1
    with open_app(browser, base + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        running = "document.getAnimations().filter(a => a.playState === 'running').length"
        assert page.evaluate(running) == 0
        page.get_by_role("banner").get_by_role("button", name="Resources").click()
        expect(page.get_by_text("Common questions")).to_be_visible()
        assert page.evaluate(running) == 0
        page.keyboard.press("Escape")
        page.get_by_role("radio", name="Graph").click()
        expect(page.get_by_text("with assisted graph creation", exact=True).first).to_be_attached()
        assert page.evaluate(running) == 0


def test_wf_contact_and_twins_scriptless(browser, base, pg):
    email = fresh_email("contact")
    message = "Please call me about pricing " + uuid.uuid4().hex[:8]
    context = browser.new_context(java_script_enabled=False)
    try:
        page = context.new_page()
        page.goto(base + "/contact")
        page.get_by_role("textbox", name="Work email").fill("not-an-email")
        page.get_by_role("textbox", name="Message").fill(message)
        with page.expect_response(lambda r: r.request.method == "POST") as info:
            page.get_by_role("button", name="Send message").click()
        assert info.value.status == 400
        expect(page.get_by_text("Enter a valid email address")).to_be_visible()
        expect(page.get_by_role("textbox", name="Message")).to_have_value(message)
        page.get_by_role("textbox", name="Work email").fill(email)
        page.get_by_role("textbox", name="Message").fill("short")
        with page.expect_response(lambda r: r.request.method == "POST") as info:
            page.get_by_role("button", name="Send message").click()
        assert info.value.status == 400
        expect(page.get_by_text("Write between 10 and 4000 characters")).to_be_visible()
        page.get_by_role("textbox", name="Message").fill(message)
        with page.expect_response(lambda r: r.request.method == "POST") as info:
            page.get_by_role("button", name="Send message").click()
        assert info.value.status == 200
        expect(page.get_by_text("Thanks. We will reply within one business day.")).to_be_visible()
    finally:
        context.close()
    assert pg.rows(f"select count(*) as n from contact_messages where email = {sql(email)} and message = {sql(message)}")[0]["n"] == 1
    robot = fresh_email("robot")
    trapped = httpx.post(base + "/contact", data={"email": robot, "message": message, "website": "http://spam.example"}, timeout=HTTP_TIMEOUT)
    assert trapped.status_code == 200 and "Thanks. We will reply within one business day." in trapped.text
    assert ok(call(base, "POST", "/api/contact", body={"email": robot, "message": message, "website": "x"}, version=None), 201) == {"received": True}
    assert pg.rows(f"select count(*) as n from contact_messages where email = {sql(robot)}")[0]["n"] == 0
    for raw in (b"", b"{", b"\xff\xfe\xfd", b'{"email": "a@example.com"'):
        refused(call(base, "POST", "/api/contact", raw=raw, version=None), 400, "MALFORMED_JSON", field=None)
    for raw in (b"[]", b"null", b"\"x\"", b"true"):
        refused(call(base, "POST", "/api/contact", raw=raw, version=None), 400, "VALIDATION_ERROR", field=None)
    refused(call(base, "POST", "/api/contact", body={"email": robot, "message": message, "website": "", "extra": "1"}, version=None),
            400, "UNKNOWN_FIELD", field="extra", message="Unknown field extra")


def test_wf_contact_and_twins_limits(browser, base, pg):
    email = fresh_email("limit")

    def send(message, website=""):
        return call(base, "POST", "/api/contact", body={"email": email, "message": message, "website": website}, version=None)

    refused(send("e\u0301" * (CONTACT_MIN - 1)), 400, "VALIDATION_ERROR", field="message")
    refused(send("\U0001F600" * (CONTACT_MAX + 1)), 400, "VALIDATION_ERROR", field="message")
    ok(send("trap message here", website="x"), 201)
    refused(call(base, "POST", "/api/contact", raw=b'{"email":"' + email.encode() + b'","message":"' + b"m" * MAX_BODY + b'","website":""}',
                 version=None), 413, "PAYLOAD_TOO_LARGE")
    ok(send("e\u0301" * CONTACT_MIN), 201)
    ok(send("\U0001F600" * CONTACT_MAX), 201)
    with open_app(browser, base + "/contact") as page:
        page.get_by_role("textbox", name="Work email").fill(email)
        page.get_by_role("textbox", name="Message").fill("Third message via the page")
        page.get_by_role("button", name="Send message").click()
        shows(page, page.get_by_text("Thanks. We will reply within one business day."))
    over = send("Fourth message is over the limit")
    assert throttled(over, "RATE_LIMITED") >= 1
    assert pg.rows(f"select count(*) as n from contact_messages where email = {sql(email)}")[0]["n"] == CONTACT_LIMIT


def test_wf_contact_and_twins_markdown(browser, base):
    tail = ["---", "## Navigation", "- [Architecture](/#architecture)", "- [Benchmarks](/#benchmarks)", "- [Pricing](/#pricing)",
            "- [FAQs Common questions](/#faq)", "- [Contact](/contact)"]
    twins = {}
    for path, heading in (("/", "# Give agents ability to retrieve the most accurate context"), ("/contact", "# Contact sales")):
        html = httpx.get(base + path, timeout=HTTP_TIMEOUT)
        meta = head_of(html.text)
        for variant in (httpx.get(base + path + "?md", timeout=HTTP_TIMEOUT),
                        httpx.get(base + path, headers={"Accept": "text/markdown"}, timeout=HTTP_TIMEOUT)):
            assert variant.status_code == 200
            assert variant.headers["Content-Type"] == "text/markdown; charset=utf-8"
            assert "accept" in variant.headers["Vary"].lower()
            body = variant.text
            assert body.startswith(f'---\ntitle: "{meta.title.strip()}"\ndescription: {meta.description}\n---\n\n')
            assert heading in body.splitlines()
            assert "\n".join(("---", "", "## Navigation")) in body
            assert [l for l in body.splitlines() if l.strip()][-len(tail):] == tail
        twins[path] = httpx.get(base + path + "?md", timeout=HTTP_TIMEOUT).content
    assert "## SOTA for agent applications" in twins["/"].decode().splitlines()

    def size_line(raw):
        kb = Decimal(len(raw)) / Decimal(1024)
        chars = len(raw.decode()) // 4
        tokens_text = str(chars) if chars < 1000 else f"{chars // 100 / 10:.1f}k"
        return f"{kb.quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)} KB \u00b7 ~{tokens_text} tokens"

    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        group = page.get_by_role("radiogroup", name="View this page as")
        expect(group.get_by_role("radio", name="Human")).to_be_checked()
        group.get_by_role("radio", name="AI").click()
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"view=ai"), timeout=POLL_MS))
        shows(page, page.get_by_text("GET /", exact=True).first)
        expect(page.get_by_text("Accept: text/markdown").first).to_be_visible()
        shows(page, page.get_by_text(size_line(twins["/"])).first)
        expect(page.get_by_role("button", name="Copy")).to_be_visible()
        expect(page.get_by_role("link", name="Raw")).to_have_attribute("href", "/?md")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(group.get_by_role("radio", name="Human")).to_be_checked(timeout=POLL_MS))
        assert "view" not in query_of(page)
    with open_app(browser, base + "/contact?view=ai") as page:
        shows(page, page.get_by_text("GET /contact", exact=True).first)
        shows(page, page.get_by_text(size_line(twins["/contact"])).first)
        expect(page.get_by_role("link", name="Raw")).to_have_attribute("href", "/contact?md")


def test_wf_deployment_storage_delete_scrub(browser, base, acme, pg):
    t = acme.token
    marker = "scrub" + uuid.uuid4().hex[:10]
    key = idempotency_key()
    name = fresh_name("ds")
    ok(call(base, "POST", "/api/v2/databases", t, {"name": name}, headers={"Idempotency-Key": key}), 201)
    acme.databases.append(name)
    wait_ready(base, t, name)
    ok(ingest(base, t, name, [src(fresh_id("x"), f"Title {marker}", f"Text {marker}",
                                  [fact(f"Subj{marker}", "OWNED_BY", f"Obj{marker}", "2026-01-01T00:00:00Z", f"why{marker}")])]), 201)
    rid = ok_request(base, t, name)
    pre = call(base, "POST", "/api/v2/feedback", t, {"request_id": rid, "feedback": "pre-delete"})
    if pre.status_code == 429:
        deadline = time.monotonic() + int(pre.headers.get("Retry-After", "60")) + 5
        while pre.status_code == 429 and time.monotonic() < deadline:
            pre = call(base, "POST", "/api/v2/feedback", t, {"request_id": rid, "feedback": "pre-delete"})
    ok(pre, 201)
    job = ok(call(base, "POST", "/api/v2/databases/export", t, {"database": name}), 202)
    gone_id = db_id(pg, ACME, name)
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        page.get_by_role("row").filter(has_text=name).get_by_role("button", name="Delete").click()
        page.get_by_role("textbox", name="Type the database name to confirm").fill(name)
        page.get_by_role("button", name="Delete database").click()
        eventually(page, lambda: expect(page.get_by_role("link", name=name)).to_have_count(0, timeout=POLL_MS))
    assert tables_holding(pg, marker) == []
    assert tables_holding(pg, rid) == []
    assert tables_holding(pg, key) == []
    for table in ("sources", "facts", "collections", "wal_entries", "query_records", "export_jobs"):
        assert pg.rows(f"select count(*) as n from {table} where database_id::text = {sql(gone_id)}")[0]["n"] == 0
    assert pg.rows(f"select count(*) as n from source_versions where database_id::text = {sql(gone_id)}")[0]["n"] == 0
    refused(call(base, "GET", f"/api/v2/jobs/{job['job_id']}", t), 404, "JOB_NOT_FOUND")
    refused(call(base, "POST", "/api/v2/feedback", t, {"request_id": rid, "feedback": "after"}), 404, "REQUEST_NOT_FOUND")
    actions = [e["action"] for e in ok(audit(base, t, actor=ACME_OWNER, limit=AUDIT_LIMIT_MAX))["events"] if e["target"] == name]
    assert "database.delete" in actions and "database.create" in actions
    again = call(base, "POST", "/api/v2/databases", t, {"name": name}, headers={"Idempotency-Key": key})
    assert ok(again, 201)["status"] == "provisioning" and "Idempotent-Replayed" not in again.headers
    racer = fresh_name("ds")
    answers = race([lambda: call(base, "POST", "/api/v2/databases", t, {"name": racer}) for _ in range(RACERS)])
    acme.databases.append(racer)
    assert sum(r.status_code == 201 for r in answers) == 1
    for r in answers:
        if r.status_code != 201:
            refused(r, 409, "DATABASE_ALREADY_EXISTS")


def test_wf_deployment_storage_store_rules(browser, base, acme, pg, mail):
    health = call(base, "GET", "/api/health", version=None)
    assert ok(health) == {"status": "ok"}
    assert ok(call(base, "GET", "/api/code-host/repo", version=None)) == {"full_name": "tessel-labs/tessel", "stargazers_count": STARS}
    pinned = {"organizations", "members", "sessions", "api_keys", "databases", "collections", "sources", "source_versions", "facts",
              "wal_entries", "query_records", "feedback", "contact_messages", "audit_events", "export_jobs"}
    assert pinned <= {t.split(".")[-1] for t in pg.tables()}
    t = acme.token
    db = acme.create_db("sr")
    a, b = fresh_id("a"), fresh_id("b")
    sa = src(a, "Alpha", "alpha text", [fact("Node One", "LINKS", "Node Two", "2026-01-01T00:00:00Z")])
    sb = src(b, "Beta", "beta text", [fact("Node Two", "LINKS", "Node Three", "2026-01-01T00:00:00Z")])
    ok(ingest(base, t, db, [sa, sb]), 201)
    ok(compact(base, t, db))
    sa2 = src(a, "Alpha two", "alpha text again", [fact("Node One", "LINKS", "Node Four", "2026-02-01T00:00:00Z")])
    ok(ingest(base, t, db, [sa2]), 201)
    ok(delete_source(base, t, db, b))
    ok(restore(base, t, db, b))
    ok(delete_source(base, t, db, b))
    s = stats(base, t, db)
    log = wal(pg, ACME, db)
    assert s["last_lsn"] == len(log) == log[-1]["lsn"] and [w["lsn"] for w in log] == list(range(1, len(log) + 1))
    assert [w["kind"] for w in log] == ["ingest", "ingest", "ingest", "delete", "restore", "delete"]
    assert s["indexed_lsn"] <= s["last_lsn"] and s["wal_pending"] == s["last_lsn"] - s["indexed_lsn"]
    assert (s["sources"], s["facts"], s["entities"]) == (1, 2, 3)
    assert s["storage_bytes"] == len("Alpha two".encode()) + len("alpha text again".encode()) + 2 * STORAGE_PER_FACT
    did = db_id(pg, ACME, db)
    assert s["tokens_ingested"] == pg.rows(f"select coalesce(sum(token_count), 0) as n from source_versions where database_id::text = {sql(did)}")[0]["n"]
    secret_pw = "store-rules-" + uuid.uuid4().hex[:10]
    email, token = acme.add_member("viewer", password=secret_pw)
    key = acme.add_key("viewer")
    for secret in (token, key["secret"], secret_pw):
        assert tables_holding(pg, secret) == []
    welcome = mails(mail, email, "You have been added to Acme Ops on Tessel")
    assert len(welcome) == 1 and mail_from_address().lower() in [x.lower() for x in addresses(welcome[0].get("From"))]
    seen = []
    with signed_in(browser, base, email, "/console", password=secret_pw) as page:
        page.on("request", lambda r: seen.append(r.url))
        page.goto(base + "/")
        page.goto(base + "/contact")
        page.goto(f"{base}/console/db/{LAUNCH}?tab=explore")
    outbound = [u for u in seen if urlparse(u).scheme in ("http", "https", "ws", "wss")]
    assert outbound and all(same_origin(u, base) for u in outbound), outbound


def test_wf_deployment_storage_performance(base, acme):
    t = acme.token
    db = acme.create_db("pf")
    for batch in range(SCALE_SOURCES // SOURCES_MAX):
        ok(ingest(base, t, db, [src(f"p{batch}-{i}", f"Perf {batch} {i}", f"ledger migration note {batch} {i}", [])
                                for i in range(SOURCES_MAX)]), 201)
    assert stats(base, t, db)["sources"] == SCALE_SOURCES

    def best(fn):
        timings = []
        for _ in range(3):
            started = time.monotonic()
            fn()
            timings.append((time.monotonic() - started) * 1000)
        return min(timings)

    assert best(lambda: ok(search(base, t, db, "ledger migration"))) < SEARCH_BUDGET_MS
    assert best(lambda: ok(call(base, "POST", "/api/v2/context/list", t, {"database": db, "collection": "default"}))) < SEARCH_BUDGET_MS
    member, _ = acme.add_member("viewer")
    path = f"/api/v2/members/{quote(member, safe='@')}"
    for i in range(SCALE_EVENTS):
        ok(call(base, "PATCH", path, t, {"role": "editor" if i % 2 == 0 else "viewer"}))
    first = ok(audit(base, t))
    assert best(lambda: ok(audit(base, t))) < AUDIT_BUDGET_MS
    assert best(lambda: ok(audit(base, t, cursor=first["next_cursor"]))) < AUDIT_BUDGET_MS


def test_wf_issued_tokens_removed_member(browser, base, acme):
    email, first = acme.add_member("editor")
    second = login(base, email)
    with signed_in(browser, base, email, "/console") as page:
        ok(call(base, "GET", "/api/me", first, version=None))
        ok(call(base, "DELETE", f"/api/v2/members/{quote(email, safe='@')}", acme.token))
        for token in (first, second):
            refused(call(base, "GET", "/api/v2/databases", token), 401, "INVALID_API_KEY")
        page.reload()
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/login"), timeout=POLL_MS))
    refused(login_raw(base, email), 401, "BAD_CREDENTIALS")
    owner, owner_token = acme.add_member("owner")
    with signed_in(browser, base, owner, "/console/settings") as page:
        expect(page.get_by_role("button", name="Add member")).to_be_visible()
        ok(call(base, "PATCH", f"/api/v2/members/{quote(owner, safe='@')}", acme.token, {"role": "editor"}))
        refused(call(base, "GET", "/api/v2/usage", owner_token), 403, "FORBIDDEN_ROLE")
        page.reload()
        expect(page.get_by_role("button", name="Add member")).to_have_count(0)


def test_wf_issued_tokens_audit_immutable(browser, base, acme, pg):
    owner, token = acme.add_member("owner")
    acme.add_key("viewer", token=token)
    before = ok(audit(base, acme.token, actor=owner))["events"]
    assert before and all(e["actor"] == owner for e in before)
    path = f"/api/v2/members/{quote(owner, safe='@')}"
    ok(call(base, "PATCH", path, acme.token, {"role": "viewer"}))
    ok(call(base, "DELETE", path, acme.token))
    ok(call(base, "POST", "/api/v2/members", acme.token, {"email": owner, "role": "owner", "password": PASSWORD}), 201)
    assert ok(audit(base, acme.token, actor=owner))["events"] == before
    stored = pg.rows(f"select id::text as id, actor, detail from audit_events where actor = {sql(owner)} order by id")
    assert {r["id"] for r in stored} == {str(e["id"]) for e in before}
    for method in ("PUT", "PATCH", "DELETE", "POST"):
        r = call(base, method, "/api/v2/audit", acme.token, {"actor": "x"})
        refused(r, 405, "METHOD_NOT_ALLOWED", message=f"This address does not accept {method}")
        assert r.headers["Allow"] == "GET"
    assert ok(audit(base, acme.token, actor=owner))["events"] == before
    with signed_in(browser, base, ACME_OWNER, f"/console/settings/audit?actor={quote(owner, safe='@')}") as page:
        shows(page, page.get_by_role("row").filter(has_text="key.create"), owner)


def test_wf_scope_and_restore_undo(browser, base, acme):
    db = acme.create_db("un")
    editor, token = acme.add_member("editor")
    a, b = fresh_id("a"), fresh_id("b")
    ok(ingest(base, token, db, [src(a, "Alpha", "first claim", [fact("X", "OWNED_BY", "Ann", "2026-02-01T00:00:00Z")])]), 201)
    ok(ingest(base, token, db, [src(b, "Beta", "second claim", [fact("X", "OWNED_BY", "Dana Okafor", "2026-02-01T00:00:00Z")])]), 201)
    q = "MATCH (x {name: 'X'})-[:OWNED_BY]->(o) RETURN o"
    snapshot = (answer_rows(base, token, db, q), history(base, token, db, "X", "OWNED_BY")["facts"], graph(base, token, db)["edges"])
    with signed_in(browser, base, editor, f"/console/db/{db}?tab=sources") as page:
        page.get_by_role("row").filter(has_text=a).get_by_role("button", name="Delete").click()
        toast = page.get_by_role("status").filter(has_text="Source deleted")
        shows(page, toast.first)
        eventually(page, lambda: expect(page.get_by_role("row").filter(has_text=a)).to_have_count(0, timeout=POLL_MS))
        toast.first.get_by_role("button", name="Undo").click()
        shows(page, page.get_by_role("status").filter(has_text="Source restored").first)
        shows(page, page.get_by_role("row").filter(has_text=a))
    assert (answer_rows(base, token, db, q), history(base, token, db, "X", "OWNED_BY")["facts"], graph(base, token, db)["edges"]) == snapshot
    assert snapshot[0] == [["Dana Okafor"]] and [f["lsn"] for f in snapshot[1]] == [1, 2]
    source = ok(call(base, "GET", "/api/v2/context/source", token, params={"database": db, "collection": "default", "id": a}))
    assert (source["version"], source["lsn"], source["indexing_status"]) == (1, 4, "graph_creation")
    refused(restore(base, token, db, a), 409, "SOURCE_IS_LIVE", message=f"Source {a} is not deleted")


def test_wf_scope_and_restore_collections(base, acme, pg):
    db = acme.create_db("co")
    t = acme.token
    sid = fresh_id("s")
    v1 = src(sid, "First version", "zebra alpha words", [fact("Zed", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z")])
    v2 = src(sid, "Second version", "zebra beta words", [fact("Zed", "OWNED_BY", "Dana Okafor", "2026-02-01T00:00:00Z")])
    ok(ingest(base, t, db, [v1]), 201)
    ok(ingest(base, t, db, [v2]), 201)
    other_title = fresh_id("Other")
    ok(ingest(base, t, db, [src(sid, other_title, "elsewhere", [])], collection="side"), 201)
    refused(delete_source(base, t, db, sid, "nowhere"), 404, "SOURCE_NOT_FOUND")
    assert ok(delete_source(base, t, db, sid))["deleted"] is True
    assert ok(search(base, t, db, "zebra"))["results"] == []
    assert history(base, t, db, "Zed", "OWNED_BY")["facts"] == []
    s = stats(base, t, db)
    assert (s["sources"], s["facts"], s["entities"], s["last_lsn"], s["wal_pending"]) == (1, 0, 0, 4, 4)
    assert s["tokens_ingested"] == token_count(v1["title"], v1["text"]) + token_count(v2["title"], v2["text"]) + token_count(other_title, "elsewhere")
    assert [w["kind"] for w in wal(pg, ACME, db)] == ["ingest", "ingest", "ingest", "delete"]
    statuses = ok(call(base, "GET", "/api/v2/context/status", t, params={"database": db, "collection": "default", "ids": f"{sid},nope-1"}))["statuses"]
    assert statuses[0] == {"id": sid, "indexing_status": "graph_creation", "version": 2}
    assert statuses[1] == {"id": "nope-1", "indexing_status": "errored", "version": None, "error_code": "FILE_NOT_FOUND",
                           "error_message": "No source with this id in this scope"}
    refused(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": sid}), 404, "SOURCE_NOT_FOUND")
    assert ok(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "side", "id": sid}))["title"] == other_title
    answers = race([lambda: restore(base, t, db, sid) for _ in range(2)])
    wins = [r for r in answers if r.status_code == 200]
    assert len(wins) == 1 and (ok(wins[0])["version"], ok(wins[0])["lsn"]) == (2, 5)
    refused([r for r in answers if r.status_code != 200][0], 409, "SOURCE_IS_LIVE")
    assert [w["kind"] for w in wal(pg, ACME, db)].count("restore") == 1
    back = ok(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": sid}))
    assert [f["object"] for f in back["facts"]] == ["Ann", "Dana Okafor"] and stats(base, t, db)["tokens_ingested"] == s["tokens_ingested"]
    refused(restore(base, t, db, "never-seen"), 404, "SOURCE_NOT_FOUND")

    editor, et = acme.add_member("editor")
    gone = fresh_id("g")
    spare, unknown_coll = fresh_name("c"), fresh_name("u")
    ok(ingest(base, et, db, [src(gone, "Temp", "temporary", [])], collection=spare), 201)
    refused(call(base, "DELETE", "/api/v2/databases/collections", et, params={"database": db, "name": spare}), 409, "COLLECTION_NOT_EMPTY")
    ok(delete_source(base, et, db, gone, spare))
    refused(call(base, "DELETE", "/api/v2/databases/collections", et, params={"database": db, "name": "default"}), 409, "COLLECTION_IS_DEFAULT")
    refused(call(base, "DELETE", "/api/v2/databases/collections", et, params={"database": db, "name": unknown_coll}), 404, "COLLECTION_NOT_FOUND")
    assert ok(call(base, "DELETE", "/api/v2/databases/collections", et, params={"database": db, "name": spare})) == {"deleted": True}
    assert spare not in ok(call(base, "GET", "/api/v2/databases/collections", et, params={"database": db}))["collections"]
    refused(restore(base, et, db, gone, spare), 404, "SOURCE_NOT_FOUND")


def equivalence(base, t, db, as_of):
    return {
        "search": ok(search(base, t, db, "launch owner", ["default", "archive"], SEARCH_MAX))["results"],
        "rows": ok(cypher(base, t, db, "MATCH (a)-[:OWNED_BY]->(o) RETURN a, o", as_of))["rows"],
        "relations": {k: v for k, v in relations(base, t, db, "Atlas Launch", as_of).items() if k in ("outgoing", "incoming")},
        "history": [{k: v for k, v in f.items() if k != "lsn"} for f in history(base, t, db, "Atlas Launch", "OWNED_BY")["facts"]],
        "graph": {k: v for k, v in graph(base, t, db, as_of).items() if k in ("nodes", "edges")},
    }


def test_wf_export_import_roundtrip(browser, base, acme, mail):
    owner, ot = acme.add_member("owner")
    db = acme.create_db("ex")
    ok(ingest(base, ot, db, [
        src("kick", "Atlas launch kickoff", "Priya owns the launch.", [fact("Atlas Launch", "OWNED_BY", "Priya Raman", "2026-01-05T09:00:00Z", "Kickoff")]),
        src("memo", "Reorg memo", "Dana owns the launch now.", [fact("Atlas Launch", "OWNED_BY", "Dana Okafor", "2026-03-10T12:00:00Z", "Reorg")])]), 201)
    ok(ingest(base, ot, db, [src("kick", "Atlas launch kickoff v2", "Priya still owns the launch.", [])]), 201)
    ok(ingest(base, ot, db, [src("old", "Archived owner note", "launch owner archive", [fact("Ledger Service", "OWNED_BY", "Marco Silva", "2026-02-01T00:00:00Z")])], collection="archive"), 201)
    as_of = "2026-06-01T00:00:00Z"
    original = equivalence(base, ot, db, as_of)

    started = time.monotonic()
    queued = ok(call(base, "POST", "/api/v2/databases/export", ot, {"database": db}), 202)
    assert set(queued) == {"job_id", "status", "database", "lsn"} and (queued["status"], queued["database"], queued["lsn"]) == ("queued", db, 4)
    early = call(base, "GET", f"/api/v2/jobs/{queued['job_id']}/download", ot)
    if time.monotonic() - started < 2:
        refused(early, 409, "JOB_NOT_FINISHED")
    ok(ingest(base, ot, db, [src("late", "Late", "written after the export", [])]), 201)
    order = {"queued": 0, "running": 1, "succeeded": 2}
    last = 0
    while True:
        job = ok(call(base, "GET", f"/api/v2/jobs/{queued['job_id']}", ot))
        elapsed = time.monotonic() - started
        assert set(job) == {"job_id", "kind", "database", "status", "lsn", "requested_at", "finished_at", "result"} and job["kind"] == "export"
        assert order[job["status"]] >= last
        last = order[job["status"]]
        if elapsed < 1:
            assert job["status"] == "queued"
        if elapsed < 2:
            assert job["status"] != "succeeded" and job["finished_at"] is None and job["result"] is None
        if job["status"] == "succeeded":
            break
        assert elapsed < READY_DEADLINE
    finished = time.strptime(job["finished_at"], "%Y-%m-%dT%H:%M:%SZ")
    requested = time.strptime(job["requested_at"], "%Y-%m-%dT%H:%M:%SZ")
    assert time.mktime(finished) - time.mktime(requested) == 2
    download = call(base, "GET", f"/api/v2/jobs/{queued['job_id']}/download", ot)
    document = ok(download)
    digest = hashlib.sha256(json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    assert job["result"]["sha256"] == digest and download.headers["ETag"] == f'"{digest}"'
    assert call(base, "GET", f"/api/v2/jobs/{queued['job_id']}/download", ot, headers={"If-None-Match": f'"{digest}"'}).status_code == 304
    assert (job["result"]["collections"], job["result"]["sources"], job["result"]["facts"]) == (2, 3, 3)
    assert [c["name"] for c in document["collections"]] == ["archive", "default"]
    default = next(c for c in document["collections"] if c["name"] == "default")
    assert [(s["id"], s["version"]) for s in default["sources"]] == [("kick", 2), ("memo", 1)]
    assert "late" not in json.dumps(document)
    sent = mails(mail, owner, f"Export ready: {db}")
    assert len(sent) == 1 and queued["job_id"] in mail_text(sent[0]) and f"/api/v2/jobs/{queued['job_id']}/download" in mail_text(sent[0])

    copy = fresh_name("im")
    created = ok(call(base, "POST", "/api/v2/databases/import", ot, {"name": copy, "document": document}), 201)
    acme.databases.append(copy)
    assert set(created) == {"name", "status", "created_at", "sources", "facts"} and (created["sources"], created["facts"]) == (3, 3)
    refused(call(base, "POST", "/api/v2/databases/import", ot, {"name": copy, "document": document}), 409, "DATABASE_ALREADY_EXISTS")
    wait_ready(base, ot, copy)
    s = stats(base, ot, copy)
    assert (s["last_lsn"], s["indexed_lsn"], s["index_generation"]) == (3, 0, 0)
    assert equivalence(base, ot, copy, as_of) == original
    with signed_in(browser, base, owner, f"/console/db/{copy}?tab=stats") as page:
        page.get_by_role("button", name="Export").click()
        shows(page, page.get_by_text("Export queued").first)
        shows(page, page.get_by_text("Export running").first)
        shows(page, page.get_by_text("Export ready").first)
        expect(page.get_by_role("link", name="Download")).to_be_visible()
    jobs = [e for e in ok(audit(base, ot, actor=owner, action="export.request"))["events"] if e["target"] == copy]
    assert len(jobs) == 1
    second = ok(call(base, "POST", "/api/v2/databases/export", ot, {"database": copy}), 202)
    while ok(call(base, "GET", f"/api/v2/jobs/{second['job_id']}", ot))["status"] != "succeeded":
        assert time.monotonic() - started < READY_DEADLINE * 3
    reexport = ok(call(base, "GET", f"/api/v2/jobs/{second['job_id']}/download", ot))
    for c in document["collections"]:
        for s_ in c["sources"]:
            s_["version"] = 1
    assert reexport["collections"] == document["collections"]


def test_wf_export_import_document_faults(browser, base, acme):
    t = acme.token

    def doc():
        return {"database": "x", "lsn": 1, "collections": [
            {"name": "default", "sources": [{"id": "a", "version": 1, "title": "A", "text": "alpha", "facts": []},
                                            {"id": "b", "version": 1, "title": "B", "text": "beta", "facts": []}]},
            {"name": "other", "sources": [{"id": "a", "version": 1, "title": "A2", "text": "alpha two", "facts": []}]}]}

    faults = []
    d = doc(); d["collections"][0]["sources"][1]["id"] = "a"; faults.append((d, "VALIDATION_ERROR", "document.collections.0.sources.1.id"))
    d = doc(); d["collections"][1]["name"] = "default"; faults.append((d, "VALIDATION_ERROR", "document.collections.1.name"))
    d = doc(); d["collections"][0]["sources"][0]["extra"] = 1; faults.append((d, "UNKNOWN_FIELD", "document.collections.0.sources.0.extra"))
    d = doc(); d["collections"][0]["sources"][0]["version"] = 0; faults.append((d, "VALIDATION_ERROR", "document.collections.0.sources.0.version"))
    d = doc(); d["collections"][0]["sources"][0]["version"] = "1"; faults.append((d, "VALIDATION_ERROR", "document.collections.0.sources.0.version"))
    d = doc(); d["collections"][0]["sources"][1]["title"] = ""; faults.append((d, "VALIDATION_ERROR", "document.collections.0.sources.1.title"))
    d = doc(); d["collections"][0]["name"] = fresh_name("c").upper(); faults.append((d, "VALIDATION_ERROR", "document.collections.0.name"))
    d = doc(); d["extra"] = 1; faults.append((d, "UNKNOWN_FIELD", "document.extra"))
    d = doc(); d["collections"] = []; faults.append((d, "VALIDATION_ERROR", "document.collections"))
    d = doc(); d["collections"] = [{"name": f"c{i:03d}", "sources": []} for i in range(SCALE_DBS + 1)]; faults.append((d, "VALIDATION_ERROR", "document.collections"))
    name = fresh_name("bad")
    key = idempotency_key()
    for document, code, field in faults:
        refused(call(base, "POST", "/api/v2/databases/import", t, {"name": name, "document": document}, headers={"Idempotency-Key": key}),
                400, code, field=field)
    too_many = doc()
    too_many["collections"][0]["sources"] = [{"id": f"s{i}", "version": 1, "title": "T", "text": "x", "facts": []} for i in range(SOURCES_MAX + 1)]
    refused(call(base, "POST", "/api/v2/databases/import", t, {"name": name, "document": too_many}), 400, "VALIDATION_ERROR")
    refused(call(base, "GET", "/api/v2/databases/status", t, params={"database": name}), 404, "DATABASE_NOT_FOUND")
    assert [e for e in ok(audit(base, t, action="database.import", limit=AUDIT_LIMIT_MAX))["events"] if e["target"] == name] == []
    message = refused(call(base, "POST", "/api/v2/databases/import", t, {"name": name, "document": faults[0][0]}), 400, "VALIDATION_ERROR")["message"]
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        page.get_by_role("button", name="Import database").click()
        page.get_by_role("textbox", name="Export document").fill(json.dumps(faults[0][0]))
        page.get_by_role("textbox", name="New name").fill(name)
        page.get_by_role("button", name="Import", exact=True).click()
        shows(page, page.get_by_text(message).first)
        expect(page.get_by_role("link", name=name)).to_have_count(0)
        page.get_by_role("textbox", name="Export document").fill(json.dumps(doc()))
        page.get_by_role("button", name="Import", exact=True).click()
        acme.databases.append(name)
        shows(page, page.get_by_role("row").filter(has_text=name), "ready")
    events = [e for e in ok(audit(base, t, action="database.import", limit=AUDIT_LIMIT_MAX))["events"] if e["target"] == name]
    assert len(events) == 1 and events[0]["detail"] == "3"
    assert ok(call(base, "GET", "/api/v2/databases/collections", t, params={"database": name})) == {"collections": ["default", "other"]}


def test_wf_exact_contract_envelope(base, acme):
    t = acme.token
    refused(call(base, "GET", "/api/v2/databases", None, version=None), 400, "API_VERSION_REQUIRED", field=None)
    refused(call(base, "GET", "/api/v2/databases", "junk-token", version="1"), 400, "UNSUPPORTED_API_VERSION")
    refused(call(base, "GET", "/api/v2/databases"), 401, "UNAUTHENTICATED")
    for path in ("/api/v2/no-such-route", "/api/nothing-here", "/api/v2/databases/extra/deep"):
        refused(call(base, "GET", path, version=None), 404, "ROUTE_NOT_FOUND", field=None)
    ids = {call(base, "GET", "/api/health", version=None).json()["meta"]["request_id"] for _ in range(3)}
    assert len(ids) == 3
    refused(call(base, "POST", "/api/contact", raw=b'{"email":"' + b"a" * MAX_BODY + b'"}', version=None), 413, "PAYLOAD_TOO_LARGE")
    db = acme.create_db("ec")
    ok(ingest(base, t, db, [src("one", "One", "shape check words", [fact("Shape", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z", "r")])]), 201)
    me = ok(call(base, "GET", "/api/me", t, version=None))
    assert set(me) == {"email", "role", "organization"} and set(me["organization"]) == {"name", "plan"}
    listing = ok(call(base, "GET", "/api/v2/databases", t))
    assert set(listing) == {"databases"}
    assert all(set(d) == {"name", "status", "last_lsn", "indexed_lsn", "index_generation", "created_at"} for d in listing["databases"])
    assert [d["name"] for d in listing["databases"]] == sorted(d["name"] for d in listing["databases"])
    assert set(stats(base, t, db)) == {"sources", "facts", "entities", "last_lsn", "indexed_lsn", "wal_pending", "index_generation", "tokens_ingested", "storage_bytes"}
    listed = ok(call(base, "POST", "/api/v2/context/list", t, {"database": db, "collection": "default"}))
    assert set(listed["sources"][0]) == {"id", "title", "version", "token_count", "facts", "indexing_status", "ingested_at"}
    one = ok(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": "one"}))
    assert set(one) == {"id", "collection", "version", "title", "text", "token_count", "lsn", "indexing_status", "ingested_at", "facts"}
    assert set(one["facts"][0]) == {"subject", "predicate", "object", "valid_from", "reason"}
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", one["ingested_at"])
    rel = relations(base, t, db, "Shape")
    assert set(rel) == {"entity", "as_of", "outgoing", "incoming"} and set(rel["outgoing"][0]) == {"predicate", "other", "valid_from", "reason", "source_id"}
    g = graph(base, t, db)
    assert set(g) == {"as_of", "nodes", "edges"} and set(g["edges"][0]) == {"subject", "predicate", "object", "valid_from", "source_id"}
    assert set(ok(call(base, "GET", "/api/v2/members", t))["members"][0]) == {"email", "role"}
    assert all(set(k) == {"id", "name", "role", "prefix", "created_at", "revoked_at"} for k in ok(call(base, "GET", "/api/v2/keys", t))["keys"])
    assert set(ok(call(base, "GET", "/api/v2/usage/daily", t))) == {"month", "days"}
    assert set(ok(compact(base, t, db))) == {"generation", "folded_entries", "indexed_lsn"}
    refused(call(base, "GET", "/api/v2/databases/stats", t, params={"database": fresh_name("nf")}), 404, "DATABASE_NOT_FOUND")
    refused(call(base, "GET", "/api/v2/jobs/999999999", t), 404, "JOB_NOT_FOUND")
    refused(call(base, "GET", "/api/v2/keys/999999999", t), 404, "KEY_NOT_FOUND")
    refused(call(base, "POST", "/api/v2/databases", t, {"name": db, "extra": 1}), 400, "UNKNOWN_FIELD", field="extra", message="Unknown field extra")
    refused(call(base, "POST", "/api/v2/databases", t, {"name": db}), 409, "DATABASE_ALREADY_EXISTS", field=None)


def test_wf_exact_contract_headers(base, acme):
    for path in ("/", "/contact", "/login", "/forgot", "/no-such-page-xyz"):
        r = httpx.get(base + path, timeout=HTTP_TIMEOUT)
        assert r.headers["X-Content-Type-Options"] == "nosniff"
        assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert r.headers["X-Frame-Options"] == "DENY"
    assert "no-store" in call(base, "GET", "/api/v2/databases", acme.token).headers["Cache-Control"]
    assert "no-store" in login_raw(base, ACME_OWNER).headers["Cache-Control"]
    key = acme.add_key("viewer")
    token = acme.token
    for path in ("/console", "/console/settings", "/console/settings/keys", f"/console/db/{LAUNCH}?tab=stats"):
        page = httpx.get(base + path, cookies={"tessel_session": token}, timeout=HTTP_TIMEOUT)
        assert page.status_code == 200
        assert "no-store" in page.headers["Cache-Control"]
        assert page.headers["X-Frame-Options"] == "DENY"
        assert key["secret"] not in page.text and PASSWORD not in page.text


EDGE_CAP = 1000
EDGE_SOURCES = EDGE_CAP // FACTS_MAX + 1
HEADING_LINES = ("el => { const r = document.createRange(); r.selectNodeContents(el);"
                 " const tops = [...r.getClientRects()].map(x => x.top).sort((a, b) => a - b);"
                 " const half = parseFloat(getComputedStyle(el).fontSize) / 2; let n = 0, last = -1e9;"
                 " for (const t of tops) { if (t - last > half) { n++; last = t; } } return n; }")
HERO_LABELS = ["Tessel", "stores", "decisions", "facts", "docs", "relationships", "knowledge", "how it all evolves", "including",
               "what changed", "when", "why", "so", "agents", "can understand and act on", "the right context", "built on",
               "object storage", "for", "10-100x lower costs", "with assisted graph creation"]
RUNNING = "document.getAnimations().filter(a => a.playState === 'running').length"


def reader_size_line(raw):
    kb = (Decimal(len(raw)) / Decimal(1024)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    chars = len(raw.decode()) // 4
    estimate = str(chars) if chars < 1000 else f"{chars // 100 / 10:.1f}k"
    return f"{kb} KB \u00b7 ~{estimate} tokens"


def test_reads_see_pending_writes(base, acme):
    db = acme.create_db("pw")
    t = acme.token
    sid = fresh_id("p")
    ok(ingest(base, t, db, [src(sid, "Pending ledger", "ledger pending words",
                                [fact("Pend Node", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z")])]), 201)
    assert stats(base, t, db)["wal_pending"] == 1

    def reads():
        return (ok(search(base, t, db, "ledger"))["results"],
                answer_rows(base, t, db, "MATCH (a)-[:OWNED_BY]->(o) RETURN a, o"),
                relations(base, t, db, "pend node")["outgoing"],
                history(base, t, db, "Pend Node", "OWNED_BY")["facts"])

    pending = reads()
    assert [r["id"] for r in pending[0]] == [sid] and pending[1] == [["Pend Node", "Ann"]]
    assert [x["other"] for x in pending[2]] == ["Ann"] and [f["object"] for f in pending[3]] == ["Ann"]
    assert ok(compact(base, t, db))["folded_entries"] == 1
    assert reads() == pending


def test_source_etag(base, acme):
    db = acme.create_db("et")
    t = acme.token
    sid = fresh_id("e")
    params = {"database": db, "collection": "default", "id": sid}
    second_title = fresh_id("Two")
    ok(ingest(base, t, db, [src(sid, "One", "first", [])]), 201)
    first = call(base, "GET", "/api/v2/context/source", t, params=params)
    assert first.headers["ETag"] == etag(1) and ok(first)["version"] == 1
    ok(ingest(base, t, db, [src(sid, second_title, "second", [])]), 201)
    stale = call(base, "GET", "/api/v2/context/source", t, params=params, headers={"If-None-Match": etag(1)})
    assert ok(stale)["title"] == second_title and stale.headers["ETag"] == etag(2)
    fresh = call(base, "GET", "/api/v2/context/source", t, params=params, headers={"If-None-Match": etag(2)})
    assert fresh.status_code == 304 and fresh.content == b""
    ok(delete_source(base, t, db, sid))
    refused(call(base, "GET", "/api/v2/context/source", t, params=params), 404, "SOURCE_NOT_FOUND")


def test_graph_route(base, acme):
    v = login(base, NW_VIEWER)
    g = graph(base, v, LAUNCH, "2026-04-03T00:00:00Z", "BLOCKED_BY")
    assert g["as_of"] == "2026-04-03T00:00:00Z" and g["nodes"] == ["Atlas Launch", "Security Review"]
    assert [(e["subject"], e["predicate"], e["object"], e["valid_from"], e["source_id"]) for e in g["edges"]] == [
        ("Atlas Launch", "BLOCKED_BY", "Security Review", "2026-04-02T15:30:00Z", "launch-retro")]
    assert graph(base, v, LAUNCH, "2026-01-01T00:00:00Z")["edges"] == []
    db = acme.create_db("gc")
    t = acme.token
    sources = [src(f"g{i}", f"Graph {i}", "edge cap",
                   [fact(f"N{i:02d}x{j:02d}", "LINKS", "Hub", "2026-01-01T00:00:00Z") for j in range(FACTS_MAX)])
               for i in range(EDGE_SOURCES)]
    ok(ingest(base, t, db, sources), 201)
    capped = graph(base, t, db)
    assert len(capped["edges"]) == EDGE_CAP
    keys = [e["subject"].lower() for e in capped["edges"]]
    assert keys == sorted(keys)


def test_entity_tab(browser, base):
    with signed_in(browser, base, NW_VIEWER, f"/console/db/{LAUNCH}?tab=entity") as page:
        page.get_by_role("textbox", name="Entity name").fill("atlas launch")
        page.get_by_role("textbox", name="As of").fill("2026-03-11T00:00:00Z")
        page.get_by_role("button", name="Look up").click()
        shows(page, page.get_by_role("link", name="Dana Okafor").first)
        for copy in ("current", "Kickoff assignment", "2026-03-10T12:00:00Z", "kickoff-notes", "Priya Raman"):
            expect(page.get_by_text(copy).first).to_be_visible()
        page.get_by_role("link", name="Billing Migration").first.click()
        shows(page, page.get_by_role("link", name="Atlas Launch").first)
        assert query_of(page)["entity"][0].lower() == "billing migration"


def test_addresses_carry_state(browser, base):
    path = f"/console/db/{LAUNCH}?tab=search&words=billing%20migration"
    with signed_in(browser, base, NW_VIEWER, path) as page:
        shows(page, page.get_by_role("row").filter(has_text="kickoff-notes"))
        page.evaluate("window.__same_document = true")
        page.get_by_role("tab", name="Graph query").click()
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"tab=graph"), timeout=POLL_MS))
        page.get_by_role("textbox", name="Statement").fill(Q_MARCO)
        page.get_by_role("textbox", name="As of").fill("2026-03-20T00:00:00Z")
        page.get_by_role("button", name="Run").click()
        shows(page, page.get_by_role("cell", name="Ledger Service"))
        assert page.evaluate("window.__same_document === true")
        state = query_of(page)
        assert state["statement"] == [Q_MARCO] and state["as_of"] == ["2026-03-20T00:00:00Z"]
        page.reload()
        shows(page, page.get_by_role("cell", name="Ledger Service"))
        page.get_by_role("tab", name="Sources").click()
        page.get_by_role("button", name="Tokens").click()
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"sort=-?token_count"), timeout=POLL_MS))


def test_where_and_count(base):
    v = login(base, NW_VIEWER)
    at = "2026-03-20T00:00:00Z"
    stmt = "MATCH (a)-[:OWNED_BY]->(o) WHERE a.name STARTS WITH 'l' AND NOT o.name = 'dana okafor' RETURN count(*)"
    assert answer_rows(base, v, LAUNCH, stmt, at) == [[1]]
    assert answer_rows(base, v, LAUNCH, "MATCH (a)-[:OWNED_BY]->(o) WHERE NOT o.name CONTAINS 'silva' RETURN a.name", at) == [["Atlas Launch"]]
    assert answer_rows(base, v, LAUNCH, "MATCH (a)-[:OWNED_BY]->(o) WHERE o.name = 'nobody' RETURN count(*)", at) == [[0]]
    refused(cypher(base, v, LAUNCH, "MATCH (a)-[:OWNED_BY]->(o) RETURN a.name, count(*)", at), 400, "CYPHER_SEMANTIC")


def test_search_operators(base, acme):
    db = acme.create_db("so")
    t = acme.token
    ok(ingest(base, t, db, [src("x1", "Plain", "alpha beta gamma", []), src("x2", "Plain", "beta alpha gamma", []),
                            src("x3", "Plain", "alpha beta delta", [])]), 201)
    ok(ingest(base, t, db, [src("x1", "Plain", "alpha beta gamma", [])], collection="notes"), 201)
    assert [r["id"] for r in ok(search(base, t, db, '"alpha beta" -delta'))["results"]] == ["x1"]
    assert [r["id"] for r in ok(search(base, t, db, "alpha -gamma"))["results"]] == ["x3"]
    ties = ok(search(base, t, db, "gamma", ["default", "notes"]))["results"]
    assert [(r["id"], r["collection"]) for r in ties] == [("x1", "default"), ("x1", "notes"), ("x2", "default")]
    assert len({r["score"] for r in ties}) == 1


def test_literal_text(browser, base, acme):
    db = acme.create_db("lt")
    t = acme.token
    title = "<script>alert(1)</script>"
    text_ = "'; DROP TABLE sources; -- {\"$ne\": null}"
    lit, plain = fresh_id("l"), fresh_id("p")
    ok(ingest(base, t, db, [src(lit, title, text_, [fact("100%_x", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z")]),
                            src(plain, "Ordinary", "ordinary words", [fact("100ab_x", "OWNED_BY", "Dana Okafor", "2026-01-01T00:00:00Z")])]), 201)
    stored = ok(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": lit}))
    assert (stored["title"], stored["text"]) == (title, text_)
    assert answer_rows(base, t, db, "MATCH (a)-[:OWNED_BY]->(o) WHERE a.name CONTAINS '%_' RETURN o") == [["Ann"]]
    with signed_in(browser, base, ACME_OWNER, f"/console/db/{db}?tab=sources") as page:
        page.get_by_role("textbox", name="Filter sources").fill("<script>")
        shows(page, page.get_by_role("row").filter(has_text=lit))
        expect(page.get_by_role("row").filter(has_text=plain)).to_have_count(0)
        expect(page.get_by_text(title).first).to_be_visible()


def test_stale_if_version(base, acme):
    db = acme.create_db("sv")
    t = acme.token
    sid, new, ghost = fresh_id("v"), fresh_id("n"), fresh_id("z")
    ok(ingest(base, t, db, [src(sid, "First", "v1", [])]), 201)
    refused(ingest(base, t, db, [src(sid, "Stale", "x", [], if_version=0)]), 409, "VERSION_CONFLICT",
            field="sources.0.if_version", message=f"Source {sid} is at version 1")
    refused(ingest(base, t, db, [src(new, "New", "x", [], if_version=0), src(sid, "Stale", "x", [], if_version=2)]),
            409, "VERSION_CONFLICT", field="sources.1.if_version", message=f"Source {sid} is at version 1")
    refused(ingest(base, t, db, [src(ghost, "Ghost", "x", [], if_version=3)]), 409, "VERSION_CONFLICT",
            message=f"Source {ghost} is at version 0")
    assert stats(base, t, db)["last_lsn"] == 1
    assert ok(ingest(base, t, db, [src(sid, "Second", "v2", [], if_version=1)]), 201)["results"][0]["version"] == 2
    refused(ingest(base, t, db, [{"title": "T", "text": "x", "facts": [], "if_version": 1}]), 400, "VALIDATION_ERROR",
            field="sources.0.if_version")
    refused(ingest(base, t, db, [src(sid, "Neg", "x", [], if_version=-1)]), 400, "VALIDATION_ERROR", field="sources.0.if_version")


def test_concurrent_writes_hold(base, acme, pg):
    db = acme.create_db("cw")
    t = acme.token
    answers = race([lambda i=i: ingest(base, t, db, [src(fresh_id("p"), f"P{i}", "parallel", [])]) for i in range(RACERS)])
    assert sorted(ok(r, 201)["results"][0]["lsn"] for r in answers) == list(range(1, RACERS + 1))
    assert [w["lsn"] for w in wal(pg, ACME, db)] == list(range(1, RACERS + 1))
    folds = [ok(r) for r in race([lambda: compact(base, t, db) for _ in range(2)])]
    assert sorted(d["folded_entries"] for d in folds) == [0, RACERS] and {d["generation"] for d in folds} == {1}
    key = idempotency_key()
    body = [src(fresh_id("k"), "Keyed", "once", [])]
    keyed = race([lambda: ingest(base, t, db, body, key=key) for _ in range(RACERS)])
    assert all(r.status_code in (201, 409) for r in keyed)
    assert stats(base, t, db)["last_lsn"] == RACERS + 1


def test_provisioning_lifecycle(base, acme):
    t = acme.token
    name = fresh_name("pl")
    started = time.monotonic()
    ok(call(base, "POST", "/api/v2/databases", t, {"name": name}), 201)
    acme.databases.append(name)
    status = ok(call(base, "GET", "/api/v2/databases/status", t, params={"database": name}))
    early = ingest(base, t, name, [src(fresh_id("x"), "T", "x", [])])
    early_compact = compact(base, t, name)
    if time.monotonic() - started < 2:
        assert status["infra"] == {"ready_for_ingestion": False, "graph_status": "provisioning"}
        refused(early, 409, "DATABASE_NOT_READY")
        refused(early_compact, 409, "DATABASE_NOT_READY")
    wait_ready(base, t, name)
    assert time.monotonic() - started >= 2
    ready = ok(call(base, "GET", "/api/v2/databases/status", t, params={"database": name}))
    assert ready == {"database": name, "status": "ready", "infra": {"ready_for_ingestion": True, "graph_status": "ready"}}
    ok(ingest(base, t, name, [src(fresh_id("x"), "T", "x", [])]), 201)
    for bad in ("ab", "Abc", "1abc", "a-bc", "a" * (NAME_MAX + 1)):
        refused(call(base, "POST", "/api/v2/databases", t, {"name": bad}), 400, "VALIDATION_ERROR", field="name")
    refused(call(base, "POST", "/api/v2/databases", t, {"name": name}), 409, "DATABASE_ALREADY_EXISTS")


def test_plan_limits(base, northwind):
    t = northwind.token

    def plan(value):
        return call(base, "PUT", "/api/v2/org/plan", t, {"plan": value})

    try:
        ok(plan("ship"))
        while len(ok(call(base, "GET", "/api/v2/databases", t))["databases"]) < SHIP_DBS:
            northwind.create_db("pl", wait=False)
        refused(call(base, "POST", "/api/v2/databases", t, {"name": fresh_name("pl")}), 403, "PLAN_LIMIT",
                message="Your plan allows 3 databases")
        ok(plan("scale"))
        northwind.create_db("pl", wait=False)
        refused(plan("ship"), 409, "PLAN_DOWNGRADE_BLOCKED")
    finally:
        northwind.close()
        northwind.databases = []
        plan("ship")


def test_plan_switch_notices(base, northwind, mail):
    owner_email, _ = northwind.add_member("owner")
    t = northwind.token

    def plan(value):
        return call(base, "PUT", "/api/v2/org/plan", t, {"plan": value})

    def events():
        return ok(audit(base, t, action="plan.change", limit=AUDIT_LIMIT_MAX))["events"]

    try:
        ok(plan("ship"))
        before = events()
        mark = before[0]["id"] if before else None
        assert ok(plan("scale")) == {"plan": "scale"}
        assert ok(call(base, "GET", "/api/me", t, version=None))["organization"]["plan"] == "scale"
        assert ok(plan("scale")) == {"plan": "scale"}
        scale = mails(mail, owner_email, "Plan changed to Scale")
        assert len(scale) == 1 and "$300.00" in mail_text(scale[0]) and NORTHWIND in mail_text(scale[0])
        ok(plan("ship"))
        ship = mails(mail, owner_email, "Plan changed to Ship")
        assert len(ship) == 1 and "$25.00" in mail_text(ship[0])
        fresh = []
        for e in events():
            if e["id"] == mark:
                break
            fresh.append(e["detail"])
        assert fresh == [role_change("scale", "ship"), role_change("ship", "scale")]
    finally:
        plan("ship")


def test_empty_collections(base, acme):
    db = acme.create_db("ec")
    _, et = acme.add_member("editor")
    gone = fresh_id("g")
    spare, unknown_coll = fresh_name("c"), fresh_name("u")
    ok(ingest(base, et, db, [src(gone, "Temp", "temporary", [])], collection=spare), 201)
    refused(call(base, "DELETE", "/api/v2/databases/collections", et, params={"database": db, "name": spare}), 409, "COLLECTION_NOT_EMPTY")
    ok(delete_source(base, et, db, gone, spare))
    refused(call(base, "DELETE", "/api/v2/databases/collections", et, params={"database": db, "name": "default"}), 409, "COLLECTION_IS_DEFAULT")
    refused(call(base, "DELETE", "/api/v2/databases/collections", et, params={"database": db, "name": unknown_coll}), 404, "COLLECTION_NOT_FOUND")
    assert ok(call(base, "DELETE", "/api/v2/databases/collections", et, params={"database": db, "name": spare})) == {"deleted": True}
    assert ok(call(base, "GET", "/api/v2/databases/collections", et, params={"database": db})) == {"collections": ["default"]}
    refused(restore(base, et, db, gone, spare), 404, "SOURCE_NOT_FOUND")


def test_key_never_owner(base, acme, pg):
    t = acme.token
    key = acme.add_key("editor")
    assert re.fullmatch(r"tsl_[0-9a-f]{40}", key["secret"]) and key["prefix"] == key["secret"][:PREFIX_LEN]
    for method, path, body in (("POST", "/api/v2/databases", {"name": fresh_name("k")}), ("GET", "/api/v2/usage", ABSENT),
                               ("PUT", "/api/v2/org/plan", {"plan": "scale"}), ("POST", "/api/v2/keys", {"name": "k", "role": "viewer"})):
        refused(call(base, method, path, key["secret"], body), 403, "FORBIDDEN_ROLE")
    refused(call(base, "POST", "/api/v2/keys", t, {"name": "k", "role": "owner"}), 400, "VALIDATION_ERROR", field="role")
    listed = [k for k in ok(call(base, "GET", "/api/v2/keys", t))["keys"] if k["id"] == key["id"]]
    assert len(listed) == 1 and "secret" not in listed[0]
    assert tables_holding(pg, key["secret"]) == []
    db = acme.create_db("kn")
    ok(ingest(base, key["secret"], db, [src(fresh_id("k"), "Key write", "editor key", [])]), 201)
    ok(call(base, "DELETE", f"/api/v2/keys/{key['id']}", t))
    refused(call(base, "GET", "/api/v2/databases", key["secret"]), 401, "INVALID_API_KEY")


def test_key_rotation_detail(base, acme):
    t = acme.token
    a = acme.create_db("ra")
    key = acme.add_key("viewer", [a])
    detail = ok(call(base, "GET", f"/api/v2/keys/{key['id']}", t))
    assert (detail["databases"], detail["last_used_at"], detail["rotated_at"]) == ([a], None, None)
    stats(base, key["secret"], a)
    refused(call(base, "GET", "/api/v2/databases/stats", key["secret"], params={"database": LAUNCH}), 404, "DATABASE_NOT_FOUND")
    rotated = ok(call(base, "POST", f"/api/v2/keys/{key['id']}/rotate", t))
    refused(call(base, "GET", "/api/v2/databases", key["secret"]), 401, "INVALID_API_KEY")
    stats(base, rotated["secret"], a)
    refused(call(base, "GET", "/api/v2/databases/stats", rotated["secret"], params={"database": LAUNCH}), 404, "DATABASE_NOT_FOUND")
    after = ok(call(base, "GET", f"/api/v2/keys/{key['id']}", t))
    assert after["rotated_at"] is not None and after["last_used_at"] is not None
    assert (after["databases"], after["role"], after["name"], after["prefix"]) == ([a], "viewer", key["name"], rotated["secret"][:PREFIX_LEN])


def test_version_before_credential(base):
    for path in ("/api/v2/databases", "/api/v2/usage", "/api/v2/audit"):
        refused(call(base, "GET", path, "junk-token-value", version=None), 400, "API_VERSION_REQUIRED", field=None)
        refused(call(base, "GET", path, None, version="1"), 400, "UNSUPPORTED_API_VERSION")
        refused(call(base, "GET", path, None), 401, "UNAUTHENTICATED")
    ids = [envelope(call(base, "GET", "/api/v2/databases", None, version=None))["meta"]["request_id"] for _ in range(3)]
    assert len(set(ids)) == 3


def test_sign_in_bearer_tokens(base, acme):
    for email, role in ((NW_OWNER, "owner"), (NW_EDITOR, "editor"), (NW_VIEWER, "viewer"), (ACME_OWNER, "owner")):
        data = ok(login_raw(base, email))
        assert data["member"]["role"] == role and len(data["token"]) >= 32
        assert ok(call(base, "GET", "/api/me", data["token"], version=None))["email"] == email
    email, token = acme.add_member("viewer")
    other, _ = acme.add_member("viewer")
    assert ok(call(base, "POST", "/api/auth/logout", token, version=None)) == {}
    refused(call(base, "GET", "/api/me", token, version=None), 401, "INVALID_API_KEY")
    for _ in range(SIGNIN_FAILS):
        refused(login_raw(base, email, "wrong-password-0"), 401, "BAD_CREDENTIALS")
    assert 1 <= throttled(login_raw(base, email), "SIGN_IN_THROTTLED") <= SIGNIN_PAUSE_MAX
    ok(login_raw(base, other))


def test_audit_one_event_per_action(base, acme):
    o1, t1 = acme.add_member("owner")
    viewer, _ = acme.add_member("viewer")
    key = acme.add_key("viewer", token=t1)
    refused(call(base, "POST", "/api/v2/keys", t1, {"name": "k", "role": "owner"}), 400, "VALIDATION_ERROR")
    name = fresh_name("ae")
    k = idempotency_key()
    for _ in range(2):
        ok(call(base, "POST", "/api/v2/databases", t1, {"name": name}, headers={"Idempotency-Key": k}), 201)
    acme.databases.append(name)
    path = f"/api/v2/members/{quote(viewer, safe='@')}"
    ok(call(base, "PATCH", path, t1, {"role": "viewer"}))
    ok(call(base, "PATCH", path, t1, {"role": "editor"}))
    events = ok(audit(base, t1, actor=o1))["events"]
    assert sorted((e["action"], e["target"]) for e in events) == sorted(
        [("key.create", key["name"]), ("database.create", name), ("member.role", viewer)])


def test_settings_controls(browser, base, acme):
    editor, _ = acme.add_member("editor")
    panels = {"/console/settings/keys", "/console/settings/billing", "/console/settings/audit"}
    with signed_in(browser, base, editor, "/console/settings") as page:
        for name in ("Sign out everywhere", "Change password", "Set up two-step sign-in"):
            expect(page.get_by_role("button", name=name)).to_be_visible()
        assert not panels & set(page.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href'))"))
        page.get_by_role("button", name="Set up two-step sign-in").click()
        shows(page, page.get_by_role("textbox", name="Code from your app"))
        expect(page.get_by_role("button", name="Turn on")).to_be_visible()
        expect(page.get_by_text(re.compile(r"[A-Z2-7]{4}( [A-Z2-7]{4}){7}")).first).to_be_visible()
        expect(page.get_by_text(re.compile(r"otpauth://totp/")).first).to_be_visible()
    with signed_in(browser, base, ACME_OWNER, "/console/settings") as page:
        assert panels <= set(page.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href'))"))


def test_feedback_lookup(base, acme, pg):
    v = login(base, NW_VIEWER)
    rid = ok_request(base, v, LAUNCH)
    foreign = ok_request(base, acme.token, LAUNCH)
    failed = cypher(base, v, LAUNCH, "MATCH (a RETURN a").json()["meta"]["request_id"]
    for other in (foreign, str(uuid.uuid4()), failed):
        refused(call(base, "POST", "/api/v2/feedback", v, {"request_id": other, "feedback": "x"}), 404, "REQUEST_NOT_FOUND")
    comment = "lookup " + uuid.uuid4().hex[:8]
    assert ok(call(base, "POST", "/api/v2/feedback", v, {"request_id": rid, "feedback": comment}), 201) == {"request_id": rid, "received": True}
    assert pg.rows(f"select count(*) as n from feedback where feedback = {sql(comment)}")[0]["n"] == 1
    assert pg.rows(f"select count(*) as n from feedback where request_id::text = {sql(foreign)}")[0]["n"] == 0


def test_sign_in_and_out(browser, base, acme):
    viewer, _ = acme.add_member("viewer")
    with open_app(browser, f"{base}/console/settings") as page:
        page.set_viewport_size(DESKTOP)
        page.wait_for_url(lambda u: urlparse(u).path == "/login", timeout=UI_TIMEOUT_MS)
        assert query_of(page)["next"] == ["/console/settings"]
        sign_in_form(page, viewer)
        page.wait_for_url(lambda u: urlparse(u).path == "/console/settings", timeout=UI_TIMEOUT_MS)
        page.reload()
        assert urlparse(page.url).path == "/console/settings"
        page.get_by_role("button", name="Sign out", exact=True).click()
        page.wait_for_url(lambda u: urlparse(u).path == "/", timeout=UI_TIMEOUT_MS)
        page.goto(f"{base}/console")
        page.wait_for_url(lambda u: urlparse(u).path == "/login", timeout=UI_TIMEOUT_MS)


def test_console_surfaces(browser, base, acme):
    db = acme.create_db("cs")
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        nav = page.get_by_role("navigation")
        expect(nav.get_by_role("link", name="Databases")).to_have_attribute("aria-current", "page")
        for copy in (ACME, ACME_OWNER, "owner"):
            expect(page.get_by_text(copy).first).to_be_visible()
        expect(page.get_by_role("link", name=db)).to_have_attribute("href", f"/console/db/{db}")
        nav.get_by_role("link", name="Settings").click()
        page.wait_for_url(lambda u: urlparse(u).path == "/console/settings", timeout=UI_TIMEOUT_MS)
        expect(page.get_by_role("navigation").get_by_role("link", name="Settings")).to_have_attribute("aria-current", "page")
        page.goto(f"{base}/console/db/{db}?tab=sources")
        page.get_by_role("button", name="Ingest source").click()
        fill_ingest(page, None, "Toast title", "toast text", [fact("Toast", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z", "r")])
        page.get_by_role("button", name="Ingest", exact=True).click()
        shows(page, page.get_by_role("status").filter(has_text="Source ingested").first)
    assert stats(base, acme.token, db)["sources"] == 1


def test_hero_views(browser, base):
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        heading = page.get_by_role("heading", level=1, name="Give agents ability to retrieve the most accurate context")
        settle(heading)
        assert 1 <= heading.evaluate(HEADING_LINES) <= 2
        text_view = page.get_by_role("radio", name="Text")
        expect(text_view).to_be_checked()
        text_view.focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("radio", name="Graph")).to_be_checked()
        assert len(HERO_LABELS) == HERO_NODES
        for node in HERO_LABELS:
            expect(page.get_by_text(node, exact=True).first).to_be_attached()
        page.keyboard.press("ArrowLeft")
        expect(text_view).to_be_checked()


def test_header_menu_star(browser, base):
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        banner = page.get_by_role("banner")
        shows(page, banner.get_by_text("13,062").first)
        stored = page.evaluate("localStorage.getItem('tessel-stars')")
        assert stored and str(STARS) in stored
        resources = banner.get_by_role("button", name="Resources")
        resources.click()
        shows(page, page.get_by_text("Common questions"))
        resources.click()
        expect(page.get_by_text("Common questions")).to_be_hidden()
        resources.focus()
        page.keyboard.press("Space")
        shows(page, page.get_by_text("Common questions"))
        page.keyboard.press("Escape")
        expect(resources).to_be_focused()
        for name, anchor in (("Architecture", "architecture"), ("Benchmarks", "benchmarks"), ("Pricing", "pricing")):
            expect(banner.get_by_role("link", name=name)).to_have_attribute("href", re.compile(f"#{anchor}$"))
        page.evaluate("window.scrollTo(0, document.getElementById('benchmarks').getBoundingClientRect().top + window.scrollY)")
        eventually(page, lambda: expect(banner.get_by_role("link", name="Benchmarks")).to_have_attribute("aria-current", "true", timeout=POLL_MS))
        assert banner.get_by_role("link").evaluate_all("els => els.filter(e => e.getAttribute('aria-current') === 'true').length") == 1
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(PHONE)
        expect(page.get_by_text("13.1k").first).to_be_visible()


def test_view_page_as(browser, base):
    raw = httpx.get(base + "/contact?md", timeout=HTTP_TIMEOUT).content
    with open_app(browser, base + "/contact") as page:
        page.set_viewport_size(DESKTOP)
        group = page.get_by_role("radiogroup", name="View this page as")
        human = group.get_by_role("radio", name="Human")
        expect(human).to_be_checked()
        human.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"view=ai"), timeout=POLL_MS))
        shows(page, page.get_by_text("GET /contact", exact=True).first)
        expect(page.get_by_text("Accept: text/markdown").first).to_be_visible()
        shows(page, page.get_by_text(reader_size_line(raw)).first)
        expect(page.get_by_role("link", name="Raw")).to_have_attribute("href", "/contact?md")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(page).not_to_have_url(re.compile(r"view=ai"), timeout=POLL_MS))


def test_accessibility_contract(browser, base):
    for path in ("/", "/contact", "/login"):
        for size in (PHONE, TABLET, DESKTOP):
            with open_app(browser, base + path) as page:
                page.set_viewport_size(size)
                layout(page)
                if size is DESKTOP:
                    axe(page)
                    assert tab_order(page, 1)[0] == "Skip to main content"
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        axe(page)
        assert tab_order(page, 1)[0] == "Skip to main content"


def test_reduced_motion(browser, base):
    with open_app(browser, base + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        assert page.evaluate(RUNNING) == 0
        page.get_by_role("banner").get_by_role("button", name="Resources").click()
        expect(page.get_by_text("Common questions")).to_be_visible()
        assert page.evaluate(RUNNING) == 0
        page.keyboard.press("Escape")
        page.get_by_role("radio", name="Graph").click()
        expect(page.get_by_text("with assisted graph creation", exact=True).first).to_be_attached()
        assert page.evaluate(RUNNING) == 0
        expect(page.get_by_text("toptal").first).to_be_attached()


def test_not_found_answers(base):
    missing = httpx.get(base + "/no-such-page-" + uuid.uuid4().hex[:6], timeout=HTTP_TIMEOUT)
    assert missing.status_code == 404 and "/" in head_of(missing.text).links
    for leak in LEAKS:
        assert leak not in missing.text
    for path in ("/api/v2/no-such-route", "/api/nothing-here"):
        refused(call(base, "GET", path, version=None), 404, "ROUTE_NOT_FOUND", field=None)
    head, tail = b'{"email":"a@example.com","message":"', b'","website":""}'
    exact = head + b"m" * (MAX_BODY - len(head) - len(tail)) + tail
    refused(call(base, "POST", "/api/contact", raw=exact, version=None), 400, "VALIDATION_ERROR", field="message")
    refused(call(base, "POST", "/api/contact", raw=exact + b" ", version=None), 413, "PAYLOAD_TOO_LARGE")


def test_health_and_origin(browser, base):
    assert ok(call(base, "GET", "/api/health", version=None)) == {"status": "ok"}
    seen = []
    with open_app(browser, base + "/") as page:
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        page.goto(base + "/contact")
        page.goto(base + "/login")
    outbound = [u for u in seen if urlparse(u).scheme in ("http", "https", "ws", "wss")]
    assert outbound and all(same_origin(u, base) for u in outbound), outbound


def test_code_host_mock(base):
    first = ok(call(base, "GET", "/api/code-host/repo", version=None))
    assert first == {"full_name": "tessel-labs/tessel", "stargazers_count": STARS}
    assert ok(call(base, "GET", "/api/code-host/repo", version=None)) == first


def test_mail_through_mailpit(base, acme, mail):
    email, _ = acme.add_member("viewer")
    got = mails(mail, email, "You have been added to Acme Ops on Tessel")
    assert len(got) == 1
    message = got[0]
    assert mail_from_address().lower() in [a.lower() for a in addresses(message.get("From"))]
    assert [a.lower() for a in addresses(message.get("To"))] == [email]
    assert not addresses(message.get("Cc") or []) and not addresses(message.get("Bcc") or [])


def test_key_notices(base, acme, mail):
    owner_email, _ = acme.add_member("owner")
    key = acme.add_key("viewer")
    assert mails(mail, owner_email, f"API key rotated: {key['name']}", minimum=0) == []
    ok(call(base, "POST", f"/api/v2/keys/{key['id']}/rotate", acme.token))
    ok(call(base, "DELETE", f"/api/v2/keys/{key['id']}", acme.token))
    for owner in (owner_email, ACME_OWNER):
        assert len(mails(mail, owner, f"API key rotated: {key['name']}")) == 1
        assert len(mails(mail, owner, f"API key revoked: {key['name']}")) == 1


def test_recovery_codes(base, acme, pg):
    email, token = acme.add_member("viewer")
    secret = ok(call(base, "POST", "/api/auth/totp/setup", token, version=None))["secret"]
    codes = ok(call(base, "POST", "/api/auth/totp/enable", token, {"code": totp(secret, now_step())}, version=None))["recovery_codes"]
    refused(login_raw(base, email, PASSWORD + "x", recovery_code=codes[0]), 401, "BAD_CREDENTIALS")
    ok(login_raw(base, email, recovery_code=codes[0]))
    refused(login_raw(base, email, recovery_code=codes[0]), 401, "BAD_TOTP")
    refused(login_raw(base, email, recovery_code="ffff-ffff"), 401, "BAD_TOTP")
    ok(login_raw(base, email, recovery_code=codes[1]))
    for code in codes:
        assert tables_holding(pg, code) == []


def test_audit_page(browser, base, acme):
    o1, t1 = acme.add_member("owner")
    viewer, _ = acme.add_member("viewer")
    path = f"/api/v2/members/{quote(viewer, safe='@')}"
    for i in range(AUDIT_PAGE + 1):
        ok(call(base, "PATCH", path, t1, {"role": "editor" if i % 2 == 0 else "viewer"}))
    query = f"/console/settings/audit?action=member.role&actor={quote(o1, safe='@')}"
    with signed_in(browser, base, o1, query) as page:
        rows = page.get_by_role("row").filter(has_text="member.role")
        eventually(page, lambda: expect(rows).to_have_count(AUDIT_PAGE, timeout=POLL_MS))
        expect(rows.first).to_contain_text(role_change("viewer", "editor"))
        page.get_by_role("button", name="Load more").click()
        eventually(page, lambda: expect(rows).to_have_count(AUDIT_PAGE + 1, timeout=POLL_MS))
        state = query_of(page)
        assert state["action"] == ["member.role"] and state["actor"] == [o1]
        page.reload()
        eventually(page, lambda: expect(rows).to_have_count(AUDIT_PAGE, timeout=POLL_MS))
        page.goto(f"{base}/console/settings/audit?action=export.request&actor={quote(viewer, safe='@')}")
        shows(page, page.get_by_text("No audit events match these filters"))


def test_delete_database_frees_name(base, acme):
    t = acme.token
    name = fresh_name("fn")
    answers = race([lambda: call(base, "POST", "/api/v2/databases", t, {"name": name}) for _ in range(RACERS)])
    acme.databases.append(name)
    assert sum(r.status_code == 201 for r in answers) == 1
    for r in answers:
        if r.status_code != 201:
            refused(r, 409, "DATABASE_ALREADY_EXISTS")
    wait_ready(base, t, name)
    ok(ingest(base, t, name, [src(fresh_id("x"), "Gone soon", "deleted text", [])], collection="extra"), 201)
    assert ok(call(base, "DELETE", "/api/v2/databases", t, params={"database": name})) == {"deleted": True}
    refused(call(base, "GET", "/api/v2/databases/stats", t, params={"database": name}), 404, "DATABASE_NOT_FOUND")
    ok(call(base, "POST", "/api/v2/databases", t, {"name": name}), 201)
    fresh = stats(base, t, name)
    assert (fresh["sources"], fresh["last_lsn"], fresh["tokens_ingested"]) == (0, 0, 0)
    assert ok(call(base, "GET", "/api/v2/databases/collections", t, params={"database": name})) == {"collections": ["default"]}


def test_source_scope(base, acme):
    db = acme.create_db("sc")
    t = acme.token
    sid, only = fresh_id("s"), fresh_id("o")
    default_title = fresh_id("Default")
    ok(ingest(base, t, db, [src(sid, default_title, "default words", [])]), 201)
    ok(ingest(base, t, db, [src(sid, "Side copy", "side words", []), src(only, "Side only", "side words", [])], collection="side"), 201)
    status = ok(call(base, "GET", "/api/v2/context/status", t, params={"database": db, "collection": "default", "ids": only}))["statuses"]
    assert status[0]["indexing_status"] == "errored"
    refused(delete_source(base, t, db, only), 404, "SOURCE_NOT_FOUND")
    ok(delete_source(base, t, db, sid, "side"))
    kept = ok(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": sid}))
    assert kept["title"] == default_title
    assert [(r["id"], r["collection"]) for r in ok(search(base, t, db, "words"))["results"]] == [(sid, "default")]
    refused(delete_source(base, t, db, sid, "side"), 404, "SOURCE_NOT_FOUND")


def test_import_equivalence(base, acme):
    t = acme.token
    orig = acme.create_db("eq")
    rows = [("default", "kick", "Atlas launch kickoff", "Priya owns the launch.",
             [fact("Atlas Launch", "OWNED_BY", "Priya Raman", "2026-01-05T09:00:00Z", "Kickoff")]),
            ("default", "memo", "Reorg memo", "Dana owns the launch now.",
             [fact("Atlas Launch", "OWNED_BY", "Dana Okafor", "2026-03-10T12:00:00Z", "Reorg")]),
            ("archive", "old", "Archived owner note", "launch owner archive",
             [fact("Ledger Service", "OWNED_BY", "Marco Silva", "2026-02-01T00:00:00Z")])]
    for coll in ("default", "archive"):
        ok(ingest(base, t, orig, [src(i, ti, tx, f) for c, i, ti, tx, f in rows if c == coll],
                  collection=None if coll == "default" else coll), 201)
    document = {"collections": [{"name": coll, "sources": [{"id": i, "version": 5, "title": ti, "text": tx, "facts": f}
                                                         for c, i, ti, tx, f in rows if c == coll]}
                                for coll in ("archive", "default")]}
    copy = fresh_name("eq")
    created = ok(call(base, "POST", "/api/v2/databases/import", t, {"name": copy, "document": document}), 201)
    acme.databases.append(copy)
    assert (created["name"], created["status"], created["sources"], created["facts"]) == (copy, "provisioning", 3, 3)
    wait_ready(base, t, copy)
    as_of = "2026-06-01T00:00:00Z"
    assert equivalence(base, t, copy, as_of) == equivalence(base, t, orig, as_of)
    for coll, sid, *_ in rows:
        assert ok(call(base, "GET", "/api/v2/context/source", t, params={"database": copy, "collection": coll, "id": sid}))["version"] == 1
    s = stats(base, t, copy)
    assert (s["last_lsn"], s["indexed_lsn"], s["index_generation"]) == (3, 0, 0)
    assert s["tokens_ingested"] == stats(base, t, orig)["tokens_ingested"]


def test_live_region_toasts(browser, base, acme):
    name = fresh_name("lr")
    dup = acme.create_db("lr", wait=False)
    duplicate = MESSAGES["DATABASE_ALREADY_EXISTS"]
    with signed_in(browser, base, ACME_OWNER, "/console") as page:
        live = page.get_by_role("status", name="Console announcements")
        textbox(page, "Name").fill(name)
        page.get_by_role("button", name="Create", exact=True).click()
        acme.databases.append(name)
        shows(page, live, "Database created")
        for value in (name.upper(), dup, name.upper(), dup):
            textbox(page, "Name").fill(value)
            page.get_by_role("button", name="Create", exact=True).click()
            if value == dup:
                shows(page, page.get_by_role("status").filter(has_text=duplicate).first)
        toasts = page.get_by_role("status").filter(has=page.get_by_role("button", name="Close"))
        assert 1 <= toasts.count() <= 3
        tops = toasts.evaluate_all("els => els.map(e => [e.getBoundingClientRect().top, e.textContent])")
        assert duplicate in min(tops)[1]
        advance(page, TOAST_MS + 1000)
        eventually(page, lambda: expect(toasts).to_have_count(0, timeout=POLL_MS))


def test_exact_shapes(base, acme):
    t = acme.token
    db = acme.create_db("xs")
    ok(ingest(base, t, db, [src("one", "One", "shape check words", [fact("Shape", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z", "r")])]), 201)
    me = ok(call(base, "GET", "/api/me", t, version=None))
    assert set(me) == {"email", "role", "organization"} and set(me["organization"]) == {"name", "plan"}
    assert all(set(d) == {"name", "status", "last_lsn", "indexed_lsn", "index_generation", "created_at"}
               for d in ok(call(base, "GET", "/api/v2/databases", t))["databases"])
    assert set(stats(base, t, db)) == {"sources", "facts", "entities", "last_lsn", "indexed_lsn", "wal_pending", "index_generation",
                                       "tokens_ingested", "storage_bytes"}
    listed = ok(call(base, "POST", "/api/v2/context/list", t, {"database": db, "collection": "default"}))
    assert set(listed["sources"][0]) == {"id", "title", "version", "token_count", "facts", "indexing_status", "ingested_at"}
    one = ok(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": "one"}))
    assert set(one) == {"id", "collection", "version", "title", "text", "token_count", "lsn", "indexing_status", "ingested_at", "facts"}
    assert set(one["facts"][0]) == {"subject", "predicate", "object", "valid_from", "reason"}
    rel = relations(base, t, db, "Shape")
    assert set(rel) == {"entity", "as_of", "outgoing", "incoming"}
    assert set(rel["outgoing"][0]) == {"predicate", "other", "valid_from", "reason", "source_id"}
    hist = history(base, t, db, "Shape", "OWNED_BY")
    assert set(hist) == {"entity", "predicate", "facts"}
    assert set(hist["facts"][0]) == {"object", "valid_from", "superseded_at", "reason", "source_id", "lsn"}
    g = graph(base, t, db)
    assert set(g) == {"as_of", "nodes", "edges"} and set(g["edges"][0]) == {"subject", "predicate", "object", "valid_from", "source_id"}
    assert set(ok(call(base, "GET", "/api/v2/members", t))["members"][0]) == {"email", "role"}
    assert set(ok(call(base, "GET", "/api/v2/usage/daily", t))) == {"month", "days"}
    assert set(ok(compact(base, t, db))) == {"generation", "folded_entries", "indexed_lsn"}


def test_unstorable_and_nfc(base, acme):
    db = acme.create_db("un")
    t = acme.token

    def one(**over):
        s = src(fresh_id("u"), "Title", "Body.", [fact("Node", "OWNED_BY", "Ann", "2026-01-01T00:00:00Z")])
        s.update(over)
        return s

    decomposed = one(title="e\u0301" * TITLE_MAX)
    emoji = one(title="\U0001F600" * TITLE_MAX, text="tab\tline\ncr\r")
    ok(ingest(base, t, db, [decomposed, emoji]), 201)
    stored = ok(call(base, "GET", "/api/v2/context/source", t, params={"database": db, "collection": "default", "id": decomposed["id"]}))
    assert stored["title"] == "e\u0301" * TITLE_MAX
    refused(ingest(base, t, db, [one(title="e\u0301" * (TITLE_MAX + 1))]), 400, "VALIDATION_ERROR", field="sources.0.title")
    for value in ("nul\x00", "esc\x1b", "bell\x07", "lone\ud800"):
        refused(ingest(base, t, db, [one(), one(text=value)]), 400, "VALIDATION_ERROR", field="sources.1.text")
    bad_reason = one()
    bad_reason["facts"][0]["reason"] = "low\udc00"
    refused(ingest(base, t, db, [bad_reason]), 400, "VALIDATION_ERROR", field="sources.0.facts.0.reason")
    assert stats(base, t, db)["last_lsn"] == 2


def test_unpublished_methods(base):
    probes = [("PUT", "/api/v2/databases", "DELETE, GET, POST"), ("POST", "/api/v2/audit", "GET"),
              ("GET", "/api/v2/members/someone@example.com", "DELETE, PATCH"), ("PATCH", "/api/v2/keys/1", "DELETE, GET"),
              ("OPTIONS", "/api/health", "GET"), ("GET", "/api/auth/login", "POST"), ("DELETE", "/api/v2/query", "POST")]
    for method, path, allow in probes:
        r = call(base, method, path, "junk-token-value", version=None)
        refused(r, 405, "METHOD_NOT_ALLOWED", message=f"This address does not accept {method}")
        assert r.headers["Allow"] == allow
    head = httpx.request("HEAD", base + "/api/v2/databases", timeout=HTTP_TIMEOUT)
    assert head.status_code == 405 and head.headers["Allow"] == "DELETE, GET, POST" and head.content == b""


def test_restore_keeps_lsn(base, acme, pg):
    db = acme.create_db("rk")
    t = acme.token
    a, b = fresh_id("a"), fresh_id("b")
    ok(ingest(base, t, db, [src(a, "A", "first", [fact("X", "OWNED_BY", "Ann", "2026-02-01T00:00:00Z")])]), 201)
    ok(ingest(base, t, db, [src(b, "B", "second", [fact("X", "OWNED_BY", "Dana Okafor", "2026-02-01T00:00:00Z")])]), 201)
    ok(delete_source(base, t, db, a))
    assert ok(restore(base, t, db, a))["lsn"] == 4
    assert [(f["object"], f["lsn"]) for f in history(base, t, db, "X", "OWNED_BY")["facts"]] == [("Ann", 1), ("Dana Okafor", 2)]
    assert answer_rows(base, t, db, "MATCH (x {name: 'X'})-[:OWNED_BY]->(o) RETURN o") == [["Dana Okafor"]]
    assert [w["kind"] for w in wal(pg, ACME, db)] == ["ingest", "ingest", "delete", "restore"]


def test_audit_csv_formulas(base, acme):
    o1, t1 = acme.add_member("owner")
    formula = '=HYPERLINK("http://x","y")'
    names = [formula, "-k", "+k", "@k"]
    for name in names:
        acme.add_key("viewer", name=name, token=t1)
    csv = audit(base, t1, actor=o1, format="csv").text
    assert '"\'=HYPERLINK(""http://x"",""y"")"' in csv
    for name in ("-k", "+k", "@k"):
        assert f",'{name},viewer\n" in csv
    targets = {e["target"] for e in ok(audit(base, t1, actor=o1))["events"]}
    assert set(names) <= targets


def test_malformed_json(base, acme):
    t = acme.token
    for path, token in (("/api/v2/databases", t), ("/api/v2/context/ingest", t), ("/api/auth/login", None), ("/api/contact", None)):
        version = "2" if path.startswith("/api/v2") else None
        for raw in (b"", b"{", b"\xff\xfe", b'{"name": "x"'):
            refused(call(base, "POST", path, token, raw=raw, version=version), 400, "MALFORMED_JSON", field=None)
        for raw in (b"[]", b"null", b"3"):
            refused(call(base, "POST", path, token, raw=raw, version=version), 400, "VALIDATION_ERROR", field=None)
    message = "Scriptless message " + uuid.uuid4().hex[:8]
    posted = httpx.post(base + "/contact", data={"email": "not-an-email", "message": message, "website": ""}, timeout=HTTP_TIMEOUT)
    assert posted.status_code == 400 and "Enter a valid email address" in posted.text and message in posted.text


APP = Path("/app")


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for step in ("install", "build", "serve"):
        assert isinstance(manifest[step], str) and manifest[step].strip()
        assert "/app/" not in manifest[step]
    assert not re.search(r"--reload|runserver|flask run|--debug|npm run dev|watchmedo", manifest["serve"])
    assert not (APP / "Dockerfile").exists()
    for compose in list(APP.glob("docker-compose*.y*ml")) + list(APP.glob("compose*.y*ml")):
        text_ = compose.read_text()
        assert not re.search(r"^\s*(volumes|container_name|networks)\s*:", text_, re.M)


def test_if_user_readme():
    readme = (APP / "USER_README.md").read_text()
    for email in (NW_OWNER, NW_EDITOR, NW_VIEWER, ACME_OWNER):
        assert email in readme
    assert PASSWORD in readme
    for folder in (".browser_screenshots", ".downloads"):
        assert (APP / folder).is_dir() and not any((APP / folder).iterdir())


def test_if_code_host_fixture(base):
    saved = json.loads((APP / "fixtures" / "code-host-repo.json").read_text())
    assert saved["full_name"] == "tessel-labs/tessel" and saved["stargazers_count"] == STARS
    assert ok(call(base, "GET", "/api/code-host/repo", version=None)) == {"full_name": saved["full_name"], "stargazers_count": saved["stargazers_count"]}


def pinned_requirements():
    pins = {}
    for line in (APP / "requirements.txt").read_text().splitlines():
        line = line.split("#")[0].strip()
        found = re.match(r"^([A-Za-z0-9_.\-\[\]]+)\s*==\s*([^\s;]+)", line)
        if found:
            pins[re.sub(r"\[.*\]", "", found.group(1)).lower().replace("_", "-")] = found.group(2)
    assert pins, "requirements.txt pins nothing"
    return pins


def notice_window(name):
    lines = (APP / "THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for i, line in enumerate(lines):
        if name in line.lower().replace("_", "-"):
            return "\n".join(lines[i:i + 4])
    return None


def test_if_third_party_notices():
    for name, version in pinned_requirements().items():
        window = notice_window(name)
        assert window is not None, name
        assert version in window, (name, version)


def test_if_licences():
    allowed = re.compile(r"MIT|BSD|Apache|ISC|PSF|Python Software Foundation|MPL[- ]?2\.0|Mozilla Public License 2\.0")
    for name in pinned_requirements():
        window = notice_window(name)
        assert window is not None and allowed.search(window), name
        assert not re.search(r"\b(A?GPL|SSPL|BUSL)\b", window), name


def test_if_no_other_datastore():
    for pattern in ("*.sqlite", "*.sqlite3", "*.db", "*.lmdb", "*.ldb", "*.rdb"):
        stray = [p for p in APP.rglob(pattern) if ".venv" not in p.parts]
        assert stray == [], stray
    pins = pinned_requirements()
    assert not {"redis", "pymongo", "lmdb", "plyvel", "tinydb", "sqlitedict", "boto3", "pika", "celery"} & set(pins)
