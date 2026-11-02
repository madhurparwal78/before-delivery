from __future__ import annotations

import concurrent.futures as cf
import hashlib
import json
import os
import queue
import re
import string
import subprocess
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest

from conftest import (
    Postgres,
    S3,
    addresses,
    advance,
    check,
    click,
    fill,
    layout,
    mail_from_address,
    open_app,
    select,
    session,
    tab_order,
    tap,
    unique,
)
from conftest import text as mail_text

HTTP_TIMEOUT_S = 60
INFRA_SLACK_S = 2
NPM_TIMEOUT_S = 300
STREAM_READ_S = 30
LIVE_S = 3
SESSION_END_S = 5
FANOUT_S = 2
RELEASE_S = 5
NOTICE_S = 10
BANNER_S = 10
POLL_MS = 5000
KEEPALIVE_S = 15
SEARCH_BUDGET_S = 1
LINEAGE_BUDGET_S = 2
WRITE_BUDGET_S = 2
CHAIN_BUDGET_S = 2
HEALTH_BUDGET_S = 1
DEBOUNCE_MS = 300
STEP_MAX_MS = 140
STEP_BUDGET_MS = 1580
SWEEP_MAX_MS = 1800
BANNER_503_MS = 500
TRANSITION_MS = 250
TARGET_PX = 44
HOLD_PX = 2
INSET_PX = 16
PAN_TOL_PX = 1
ZOOM_MAX = 2.0
MAX_HOPS = 12
MAX_COLUMNS = 500
MAX_CONNECTIONS = 12
AUDIT_PAGE = 50
JSON_LIMIT = 1_000_000
MULTIPART_LIMIT = 6_000_000
EVIDENCE_MAX = 5_000_000
FILENAME_MAX = 200
NOTE_MAX = 500
Q_MAX = 200
DESC_MAX = 500
SAMPLE_MAX = 200
COLUMN_NAME_MAX = 60
TERM_NAME_MAX = 80
ASSET_ID_MAX = 120
EDGE_BATCH_MAX = 1000
DEPTH_OK = 20
STREAM_COUNT = 30
ABORT_ROUNDS = 10
PARALLEL = 5
FILLER_ROWS = 40

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}

SEED_PW = "strata-seed-2026"
MORGAN = "morgan.ellery@lakeshore-health.test"
DANA = "dana.okafor@lakeshore-health.test"
RUI = "rui.takahashi@lakeshore-health.test"
LENA = "lena.marsh@lakeshore-health.test"
OMAR = "omar.haddad@lakeshore-health.test"
SAM = "sam.whitlock@lakeshore-health.test"
MASKED = "[masked]"
REASON = "Retired after the claims migration."
ZOOM_STEP = 0.25
OUTAGE_NOTE = "Outage note."
SIGNED_NOTE = "Signed by privacy."
EVIDENCE_NAME = "privacy-signoff.pdf"
SECRET_SAMPLE = "secret-sample"
RAW_PII = "111-22-3333"
RAW_INHERITED = "111-22-4444"
RAW_UPSTREAM = "901-55-7777"
RAW_DOWNSTREAM = "901-55-8888"
RAW_FIRST = "905-00-1111"
RAW_SECOND = "905-00-2222"
RAW_REFRESH = "902-11-0000"
ZERO_HASH = "0" * 64
PASS_THROUGH = {"copy", "rename", "cast", "filter", "join", "concat"}

ERR_401 = {"error": {"code": "unauthenticated", "message": "Sign in to continue."}}
ERR_403 = {"error": {"code": "forbidden", "message": "You don't have permission to do that."}}
ERR_404 = {"error": {"code": "not_found", "message": "Not found."}}
ERR_405 = {"error": {"code": "method_not_allowed", "message": "This action isn't allowed."}}
ERR_413 = {"error": {"code": "payload_too_large", "message": "Request body is too large."}}
EVIDENCE_503 = {"error": {"code": "evidence_unavailable", "message": "Evidence storage is unreachable. The asset stays in draft; try again shortly."}}

ASSET_SUMMARY_KEYS = {"id", "kind", "description", "owner", "state", "terms", "tagged_column_count",
                      "pii_column_count", "confidential_column_count", "deprecated_upstream"}
ASSET_DETAIL_KEYS = ASSET_SUMMARY_KEYS | {"verified_at", "evidence", "deprecation", "columns"}
EVIDENCE_KEYS = {"filename", "content_type", "size_bytes", "sha256", "uploaded_at", "uploaded_by"}
COLUMN_KEYS = {"id", "name", "data_type", "direct_tags", "effective_tags", "suppressed_tags", "tag_sources",
               "samples", "masked"}
GRAPH_COLUMN_KEYS = {"id", "asset", "direct_tags", "effective_tags", "suppressed_tags", "tag_sources"}
LINEAGE_KEYS = {"focus", "direction", "focus_tags", "focus_tag_sources", "reached", "edges", "cycles", "assets",
                "totals", "truncated", "limits", "summary"}
REACHED_KEYS = {"column", "asset", "hop", "carried_tags", "sealed_tags", "tag_sources"}
AUDIT_KEYS = {"id", "seq", "at", "actor", "actor_role", "action", "target", "before", "after", "prev_hash", "hash"}
AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

APP_EVIDENCE_DOWN = os.environ.get("APP_EVIDENCE_DOWN_URL", "")
APP_MAIL_DOWN = os.environ.get("APP_MAIL_DOWN_URL", "")
APP_BOTH_DOWN = os.environ.get("APP_BOTH_DOWN_URL", "")
APP_ISOLATED = os.environ.get("APP_ISOLATED_MAIL_DOWN_URL", "")


def enc(value: str) -> str:
    return quote(value, safe="")


class Api:
    def __init__(self, base: str, email: str | None = None, password: str = SEED_PW):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, headers={"Origin": self.base})
        self.user: dict = {}
        if email:
            self.signin(email, password)

    def signin(self, email: str, password: str = SEED_PW) -> httpx.Response:
        r = self.c.post("/api/session", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        self.user = r.json()["user"]
        return r

    @property
    def token(self) -> str:
        return self.c.cookies.get("strata_session") or ""

    def clone(self) -> "Api":
        other = Api(self.base)
        other.c.cookies.set("strata_session", self.token)
        other.user = self.user
        return other

    def get(self, path, **kw):
        return self.c.get(path, **kw)

    def post(self, path, json=None, key=None, **kw):
        headers = kw.pop("headers", {})
        if key:
            headers["Idempotency-Key"] = key
        return self.c.post(path, json=json, headers=headers, **kw)

    def patch(self, path, json=None):
        return self.c.patch(path, json=json)

    def delete(self, path):
        return self.c.delete(path)


_admins: dict[str, Api] = {}


def admin(base: str) -> Api:
    if base not in _admins:
        _admins[base] = Api(base, MORGAN)
    return _admins[base]


def fresh_identity(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    return (b, a) if "@" in a else (a, b)


def make_user(base: str, role: str, name: str | None = None) -> Api:
    nm, email = fresh_identity(role.lower())
    password = "probe-pass-" + uuid.uuid4().hex
    r = admin(base).post("/api/users", json={"name": name or nm, "email": email, "role": role, "password": password})
    assert r.status_code == 201, r.text
    api = Api(base, email, password)
    api.password = password
    return api


def register(api: Api, cols, owner: str | None = None, kind: str = "table", desc: str | None = None,
             aid: str | None = None) -> str:
    aid = aid or f"src.t{uuid.uuid4().hex[:12]}"
    columns = []
    for c in cols:
        name, samples = (c, [f"{c}-sample-1", f"{c}-sample-2", f"{c}-sample-3"]) if isinstance(c, str) else c
        columns.append({"name": name, "data_type": "text", "samples": samples})
    r = api.post("/api/assets", json={"id": aid, "kind": kind, "description": desc or f"Probe asset {aid}",
                                      "owner_id": owner or api.user["id"], "columns": columns})
    assert r.status_code == 201, r.text
    return aid


def link(api: Api, edges) -> dict:
    r = api.post("/api/lineage/edges", json={"edges": [{"from": f, "to": t, "transform": tr} for f, t, tr in edges]})
    assert r.status_code == 201, r.text
    return r.json()


def tag(api: Api, column: str, t: str) -> httpx.Response:
    return api.post(f"/api/columns/{enc(column)}/tags", json={"tag": t})


def untag(api: Api, column: str, t: str) -> httpx.Response:
    return api.delete(f"/api/columns/{enc(column)}/tags/{t}")


def suppress(api: Api, column: str, t: str, why: str = "Values are tokenised before this column.") -> httpx.Response:
    return api.post(f"/api/columns/{enc(column)}/suppressions", json={"tag": t, "justification": why})


def column(api: Api, cid: str, **params) -> dict:
    r = api.get(f"/api/columns/{enc(cid)}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def asset(api: Api, aid: str) -> dict:
    r = api.get(f"/api/assets/{enc(aid)}")
    assert r.status_code == 200, r.text
    return r.json()


def lineage(api: Api, cid: str, direction: str = "downstream", **params) -> httpx.Response:
    return api.get(f"/api/columns/{enc(cid)}/lineage", params={"direction": direction, **params})


def search(api: Api, **params) -> httpx.Response:
    return api.get("/api/search", params=params)


def multipart(filename: str, data: bytes, note: str | None = None) -> tuple[bytes, str]:
    boundary = "probe" + uuid.uuid4().hex
    parts = []
    if note is not None:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\n'.encode() + note.encode() + b"\r\n")
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="evidence"; filename="{filename}"\r\n'
                 f'Content-Type: application/octet-stream\r\n\r\n'.encode() + data + b"\r\n")
    return b"".join(parts) + f"--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def verify(api: Api, aid: str, filename: str, data: bytes, note: str | None = None, key: str | None = None) -> httpx.Response:
    body, ctype = multipart(filename, data, note)
    headers = {"Content-Type": ctype}
    if key:
        headers["Idempotency-Key"] = key
    return api.c.post(f"/api/assets/{enc(aid)}/verify", content=body, headers=headers)


def pdf_bytes(size: int = 4096) -> bytes:
    head = b"%PDF-1.4\n"
    return head + os.urandom(size - len(head))


def ikey() -> str:
    return "k" + uuid.uuid4().hex


def poll(fn, seconds: float, what: str):
    end = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() > end:
            raise AssertionError(f"timed out after {seconds}s: {what}")


def parallel(fns):
    barrier = threading.Barrier(len(fns))

    def run(fn):
        barrier.wait()
        return fn()

    with cf.ThreadPoolExecutor(len(fns)) as ex:
        return list(ex.map(run, fns))


def audit_rows(pg: Postgres, target_id: str, action: str | None = None) -> list[dict]:
    extra = f" and action = '{action}'" if action else ""
    return pg.rows(f"select seq, at, actor_id, actor_role, action, target_type, target_id, before, after, prev_hash, hash "
                   f"from audit_log where target_id = '{target_id}'{extra} order by seq")


def max_seq(pg: Postgres) -> int:
    return int(pg.rows("select coalesce(max(seq), 0) as s from audit_log")[0]["s"])


def recompute(cols, edges, direct, suppressed):
    out = {c: {} for c in cols}
    adj: dict[str, list[str]] = {}
    for f, t, tr in edges:
        if tr in PASS_THROUGH:
            adj.setdefault(f, []).append(t)
    for u, tags in direct.items():
        for t in tags:
            out[u].setdefault(t, set()).add(u)
            seen, stack = {u}, [u]
            while stack:
                x = stack.pop()
                for v in adj.get(x, []):
                    if v in seen or t in suppressed.get(v, set()):
                        continue
                    seen.add(v)
                    out[v].setdefault(t, set()).add(u)
                    stack.append(v)
    return {c: {t: sorted(s) for t, s in sorted(m.items())} for c, m in out.items()}


def canon(value) -> str:
    if isinstance(value, dict):
        keys = sorted(value, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(value[k]) for k in keys) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canon(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False)


def row_hash(row: dict) -> str:
    payload = {"seq": row["seq"], "at": row["at"], "actor_id": row["actor"]["id"], "actor_role": row["actor_role"],
               "action": row["action"], "target_type": row["target"]["type"], "target_id": row["target"]["id"],
               "before": row["before"], "after": row["after"]}
    return hashlib.sha256((row["prev_hash"] + "\n" + canon(payload)).encode()).hexdigest()


ATTR_CHARS = set(string.ascii_letters + string.digits + "!#$&+-.^_`|~")


def disposition(name: str) -> str:
    fallback = "".join("_" if (ord(c) > 127 or c in '"\\') else c for c in name)
    encoded = "".join(chr(b) if chr(b) in ATTR_CHARS else f"%{b:02X}" for b in name.encode())
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def viewer_time(at: str, zone: str) -> str:
    d = datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(ZoneInfo(zone))
    off = int(d.utcoffset().total_seconds() // 60)
    sign = "+" if off >= 0 else "-"
    return f"{d:%Y-%m-%d %H:%M:%S}.{d.microsecond // 1000:03d} UTC{sign}{abs(off) // 60:02d}:{abs(off) % 60:02d}"


class Stream:
    def __init__(self, base: str, token: str, after_seq=None, last_id=None):
        params = {} if after_seq is None else {"after_seq": str(after_seq)}
        headers = {"Accept": "text/event-stream"}
        if last_id is not None:
            headers["Last-Event-ID"] = str(last_id)
        self.client = httpx.Client(timeout=httpx.Timeout(STREAM_READ_S, connect=10), cookies={"strata_session": token})
        self.cm = self.client.stream("GET", base.rstrip("/") + "/api/events", params=params, headers=headers)
        self.resp = self.cm.__enter__()
        self.status = self.resp.status_code
        self.q: queue.Queue = queue.Queue()
        self.events: list[dict] = []
        self.comments: list[str] = []
        self.closed = threading.Event()
        self._cur: dict = {}
        if self.status == 200:
            threading.Thread(target=self._read, daemon=True).start()
        else:
            self.body = self.resp.read()

    def _read(self):
        try:
            for line in self.resp.iter_lines():
                self.q.put(line)
        except Exception:
            pass
        finally:
            self.closed.set()
            self.q.put(None)

    def _feed(self, line: str):
        if line == "":
            if self._cur:
                self.events.append(self._cur)
            self._cur = {}
        elif line.startswith(":"):
            self.comments.append(line)
        else:
            k, _, v = line.partition(":")
            self._cur[k] = v[1:] if v.startswith(" ") else v

    def collect(self, pred, seconds: float):
        end = time.monotonic() + seconds
        while not pred(self):
            left = end - time.monotonic()
            if left <= 0:
                break
            try:
                line = self.q.get(timeout=left)
            except queue.Empty:
                break
            if line is None:
                break
            self._feed(line)
        return self

    def seqs(self) -> list[int]:
        return [json.loads(e["data"])["seq"] for e in self.events if "data" in e]

    def close(self):
        try:
            self.cm.__exit__(None, None, None)
        finally:
            self.client.close()


def text_columns_contain(pg: Postgres, needle: str) -> bool:
    cols = pg.rows("select table_schema as s, table_name as t, column_name as c from information_schema.columns "
                   "where table_schema not in ('pg_catalog','information_schema') "
                   "and data_type in ('text','character varying','json','jsonb')")
    by_table: dict[tuple, list[str]] = {}
    for c in cols:
        by_table.setdefault((c["s"], c["t"]), []).append(c["c"])
    lit = needle.replace("'", "''")
    for (s, t), names in by_table.items():
        cond = " or ".join(f"strpos(\"{n}\"::text, '{lit}') > 0" for n in names)
        if pg.rows(f'select count(*) as n from "{s}"."{t}" where {cond}')[0]["n"]:
            return True
    return False


@contextmanager
def ui(browser, base: str, api: Api, path: str = "/catalog", viewport=DESKTOP, reduced: bool = False):
    with open_app(browser, base + "/signin", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(viewport)
        page.context.add_cookies([{"name": "strata_session", "value": api.token, "url": base}])
        page.goto(base + path)
        wait_ui(page, lambda: page.get_by_role("main").count() == 1, 20, "workspace main")
        yield page


def wait_ui(pages, cond, seconds: float = LIVE_S + INFRA_SLACK_S, what: str = "", step: int = 100):
    pages = pages if isinstance(pages, list) else [pages]
    end = time.monotonic() + seconds
    while True:
        try:
            if cond():
                return
        except Exception:
            pass
        if time.monotonic() > end:
            raise AssertionError(f"UI did not reach state within {seconds}s: {what}")
        for p in pages:
            advance(p, step)


def spin(page, cond, seconds: float = 15, what: str = ""):
    end = time.monotonic() + seconds
    while True:
        try:
            if cond():
                return
        except Exception:
            pass
        if time.monotonic() > end:
            raise AssertionError(f"UI did not reach state: {what}")
        page.evaluate("0")


def record(locator):
    locator.evaluate("""el => { el.__log = [el.textContent.trim()];
      new MutationObserver(() => { const t = el.textContent.trim();
        if (el.__log[el.__log.length - 1] !== t) el.__log.push(t); })
      .observe(el, {subtree: true, childList: true, characterData: true}); }""")


def said(locator) -> list[str]:
    return locator.evaluate("el => el.__log || [el.textContent.trim()]")


def has_focus(locator) -> bool:
    return locator.evaluate("el => el === document.activeElement")


def described(locator) -> str:
    return locator.evaluate("""el => (el.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)
      .map(id => (document.getElementById(id) || {textContent: ''}).textContent.trim()).join(' ')""")


HIT_JS = """el => { const r = el.getBoundingClientRect();
  const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!t && (t === el || el.contains(t)); }"""


def inside(inner: dict, outer: dict, tol: float = 1) -> bool:
    return (inner["x"] >= outer["x"] - tol and inner["y"] >= outer["y"] - tol
            and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + tol
            and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + tol)


def node(page, cid: str):
    return page.get_by_role("button", name=cid, exact=True)


def canvas(page):
    return page.get_by_role("group", name="Lineage canvas")


def status(page, name: str):
    return page.get_by_role("status", name=name, exact=True)


def focus_column(page) -> str | None:
    return page.evaluate("document.activeElement && document.activeElement.getAttribute('data-column')")


def page_text_absent(page, needle: str) -> bool:
    return needle not in page.evaluate("document.body.innerText")


def matching(n: int) -> str:
    return f"Matching assets: {n}"


def url_param(page, key: str) -> list[str]:
    return parse_qs(urlparse(page.url).query).get(key, [])


def json_keys(value) -> set:
    if isinstance(value, dict):
        return set(value).union(*(json_keys(v) for v in value.values()))
    if isinstance(value, list):
        return set().union(*(json_keys(v) for v in value))
    return set()


MARKS_JS = """(el, name) => [el, ...el.querySelectorAll('[' + name + ']')].filter(e => e.hasAttribute(name)).map(e => {
  const r = e.getBoundingClientRect();
  return {value: e.getAttribute(name), text: e.textContent.trim(), tabbable: e.tabIndex >= 0,
          box: {x: r.x, y: r.y, width: r.width, height: r.height}}; })"""


def marks(locator, name: str, value: str | None = None) -> list[dict]:
    found = locator.evaluate(MARKS_JS, name)
    return [m for m in found if value is None or m["value"] == value]


def mark_text(locator, name: str) -> str:
    found = marks(locator, name)
    assert len(found) == 1, (name, found)
    return found[0]["text"]


def glyphs(locator, tag_name: str) -> list[str]:
    return [m["text"] for m in marks(locator, "data-tag-glyph", tag_name)]


EDGES_JS = """el => [...el.querySelectorAll('[data-edge]')].map(e => ({from: e.getAttribute('data-from'),
  to: e.getAttribute('data-to'), kind: e.getAttribute('data-kind'), drawn: e.getAttribute('data-drawn'),
  state: e.getAttribute('data-edge-state')}))"""


def edges_of(locator) -> dict:
    found = locator.evaluate(EDGES_JS)
    pairs = {(e["from"], e["to"]): e for e in found}
    assert len(pairs) == len(found), "an edge is drawn twice"
    return pairs


def test_session_signin_and_storage(app_url):
    a = Api(app_url)
    r = a.signin(DANA)
    assert r.json()["user"] == {"id": "u-dana", "name": "Dana Okafor", "email": DANA, "role": "Steward"}
    cookie = r.headers.get("set-cookie", "").lower()
    assert "strata_session" in r.cookies
    for attribute in ("HttpOnly", "SameSite=Lax", "Path=/"):
        assert attribute.lower() in cookie
    old = a.token
    a.signin(DANA)
    assert a.token and a.token != old
    assert httpx.get(app_url + "/api/session", cookies={"strata_session": old}).json() == ERR_401
    assert a.get("/api/session").json()["user"]["email"] == DANA
    for email, pw in ((DANA, "wrong-password-probe"), ("nobody@example.test", SEED_PW)):
        bad = httpx.post(app_url + "/api/session", json={"email": email, "password": pw}, headers={"Origin": app_url})
        assert bad.status_code == 401
        assert bad.json() == {"error": {"code": "invalid_credentials", "message": "Email or password is incorrect."}}
    pg = Postgres()
    assert not text_columns_contain(pg, a.token), "session token stored in readable form"
    assert not text_columns_contain(pg, SEED_PW), "password stored in readable form"


def test_server_enforced_roles(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    c1 = f"{aid}.c1"
    pg = Postgres()
    before = len(audit_rows(pg, aid)) + len(audit_rows(pg, c1))
    key = ikey()
    for role in ("Analyst", "Viewer"):
        low = make_user(app_url, role)
        calls = [
            tag(low, c1, "PII"),
            suppress(low, c1, "PII"),
            verify(low, aid, "signoff.pdf", pdf_bytes(), key=key),
            low.post(f"/api/assets/{enc(aid)}/deprecate", json={"reason": "probe"}, key=ikey()),
            low.post(f"/api/assets/{enc(aid)}/reinstate", json={}),
            low.post("/api/assets", json={"id": f"src.t{uuid.uuid4().hex[:10]}", "kind": "table", "description": "x",
                                          "owner_id": low.user["id"], "columns": [{"name": "a", "data_type": "t", "samples": []}]}),
            low.post("/api/lineage/edges", json={"edges": [{"from": c1, "to": c1, "transform": "copy"}]}),
            low.post("/api/terms", json={"name": "probe " + uuid.uuid4().hex, "definition": "d"}),
            low.post(f"/api/assets/{enc(aid)}/tags/bulk", json={"tag": "PII", "columns": [c1]}),
            low.get("/api/users"),
            low.post("/api/users", json={"name": "x", "email": "x@example.test", "role": "Admin", "password": "x" * 12}),
            low.get("/api/audit"),
            low.get("/api/audit/chain"),
        ]
        for resp in calls:
            assert resp.status_code == 403, resp.text
            assert resp.json() == ERR_403
        assert lineage(low, c1).status_code == 200
    detail = asset(admin(app_url), aid)
    assert detail["state"] == "draft" and detail["columns"][0]["direct_tags"] == []
    assert S3().keys(f"evidence/{aid}/") == []
    assert len(audit_rows(pg, aid)) + len(audit_rows(pg, c1)) == before
    assert make_user(app_url, "Steward").get("/api/users").status_code == 403


def test_user_and_role_administration(app_url):
    adm = admin(app_url)
    target = make_user(app_url, "Analyst")
    aid = register(make_user(app_url, "Steward"), ["c1"])
    users = adm.get("/api/users").json()["users"]
    assert any(u["id"] == target.user["id"] and u["role"] == "Analyst" for u in users)
    keys = [(u["name"].casefold(), u["id"]) for u in users]
    assert keys == sorted(keys)
    assert set(users[0]) == {"id", "name", "email", "role"}
    assert tag(target, f"{aid}.c1", "PII").status_code == 403
    r = adm.patch(f"/api/users/{target.user['id']}", {"role": "Steward"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "Steward"
    assert tag(target, f"{aid}.c1", "PII").status_code == 201
    rows = audit_rows(Postgres(), target.user["id"], "user.role_change")
    assert rows[-1]["before"] == {"role": "Analyst"} and rows[-1]["after"] == {"role": "Steward"}
    own = adm.patch(f"/api/users/{adm.user['id']}", {"role": "Viewer"})
    assert own.status_code == 409 and own.json() == {"error": {"code": "own_role", "message": "You can't change your own role."}}
    own = adm.patch(f"/api/users/{adm.user['id']}", {"password": "eightchr"})
    assert own.status_code == 409 and own.json() == {"error": {"code": "own_password", "message": "You can't reset your own password here."}}
    assert adm.get("/api/session").json()["user"]["role"] == "Admin"
    both = adm.patch(f"/api/users/{target.user['id']}", {"role": "Viewer", "password": "x" * 12})
    assert both.status_code == 422 and both.json()["error"]["fields"]["role"] == "Send either a role or a password."
    bad = adm.patch(f"/api/users/{target.user['id']}", {"role": "Owner"})
    assert bad.json()["error"]["fields"]["role"] == "Role must be Admin, Steward, Analyst or Viewer."
    name, email = fresh_identity("dup")
    for body, field, msg in (
        ({"name": name, "email": email, "role": "Viewer", "password": "short"}, "password", "Use at least 12 characters."),
        ({"name": name, "email": "not-an-email", "role": "Viewer", "password": "x" * 12}, "email", "Enter a valid email address."),
    ):
        r = adm.post("/api/users", json=body)
        assert r.status_code == 422 and r.json()["error"]["fields"][field] == msg
    dup = adm.post("/api/users", json={"name": name, "email": target.user["email"], "role": "Viewer", "password": "x" * 12})
    assert dup.status_code == 409 and dup.json() == {"error": {"code": "email_exists", "message": "That email is already in use."}}


def test_password_reset_ends_every_session(app_url):
    user = make_user(app_url, "Steward")
    second = Api(app_url, user.user["email"], user.password)
    aid = register(user, ["c1"])
    key = ikey()
    first = user.post(f"/api/assets/{enc(aid)}/deprecate", json={"reason": "Replay probe."}, key=key)
    assert first.status_code == 200
    stream = Stream(app_url, second.token)
    try:
        r = admin(app_url).patch(f"/api/users/{user.user['id']}", {"password": "new-probe-pass-123"})
        assert r.status_code == 200 and r.json()["sessions_ended"] == 2
        for api in (user, second):
            assert api.get("/api/session").json() == ERR_401
        replay = user.post(f"/api/assets/{enc(aid)}/deprecate", json={"reason": "Replay probe."}, key=key)
        assert replay.status_code == 401 and replay.json() == ERR_401
        stream.collect(lambda s: s.closed.is_set(), SESSION_END_S + INFRA_SLACK_S)
        assert stream.closed.is_set(), "activity stream still open after the reset"
    finally:
        stream.close()
    old = httpx.post(app_url + "/api/session", json={"email": user.user["email"], "password": user.password}, headers={"Origin": app_url})
    assert old.status_code == 401
    Api(app_url, user.user["email"], "new-probe-pass-123")
    row = audit_rows(Postgres(), user.user["id"], "user.password_reset")[-1]
    assert row["after"] == {"sessions_ended": 2} and row["before"] is None


def test_authority_rechecked_at_commit(app_url):
    for mode in ("demote", "signout"):
        steward = make_user(app_url, "Steward")
        aid = register(steward, ["c1"])
        body, ctype = multipart("signoff.pdf", pdf_bytes(200_000))
        started, gate = threading.Event(), threading.Event()

        def gen():
            yield body[:1024]
            started.set()
            gate.wait(30)
            yield body[1024:]

        with cf.ThreadPoolExecutor(1) as ex:
            fut = ex.submit(lambda: steward.c.post(f"/api/assets/{enc(aid)}/verify", content=gen(),
                                                   headers={"Content-Type": ctype, "Content-Length": str(len(body))}))
            assert started.wait(30)
            if mode == "demote":
                assert admin(app_url).patch(f"/api/users/{steward.user['id']}", {"role": "Analyst"}).status_code == 200
            else:
                assert steward.clone().delete("/api/session").status_code == 204
            gate.set()
            r = fut.result()
        assert r.status_code == (403 if mode == "demote" else 401), r.text
        assert r.json() == (ERR_403 if mode == "demote" else ERR_401)
        detail = asset(admin(app_url), aid)
        assert detail["state"] == "draft" and detail["evidence"] is None
        poll(lambda: S3().keys(f"evidence/{aid}/") == [], RELEASE_S, "object deleted")
        assert audit_rows(Postgres(), aid, "certification.verify") == []


def test_attributed_audit_rows(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1", "c2"])
    c1 = f"{aid}.c1"
    pg = Postgres()
    assert tag(steward, c1, "PII").status_code == 201
    rows = audit_rows(pg, c1)
    assert len(rows) == 1
    row = rows[0]
    assert (row["actor_id"], row["actor_role"], row["action"], row["target_type"]) == (steward.user["id"], "Steward", "tag.add", "column")
    assert row["before"] == {"direct_tags": []} and row["after"] == {"direct_tags": ["PII"]}
    assert AT_RE.match(row["at"])
    assert tag(steward, c1, "PII").status_code == 409
    key = ikey()
    body = {"tag": "Confidential", "columns": [f"{aid}.c2"]}
    assert steward.post(f"/api/assets/{enc(aid)}/tags/bulk", json=body, key=key).status_code == 200
    assert steward.post(f"/api/assets/{enc(aid)}/tags/bulk", json=body, key=key).status_code == 200
    assert len(audit_rows(pg, c1)) == 1
    assert len(audit_rows(pg, aid, "tag.bulk_add")) == 1
    api_row = next(r for r in admin(app_url).get("/api/audit", params={"limit": 500}).json()["rows"] if r["seq"] == row["seq"])
    assert set(api_row) == AUDIT_KEYS
    assert api_row["actor"] == {"id": steward.user["id"], "name": steward.user["name"]}
    assert api_row["target"] == {"type": "column", "id": c1}


def test_audit_log_cannot_change(app_url):
    adm = admin(app_url)
    seq = adm.get("/api/audit", params={"limit": 1}).json()["rows"]
    rid = seq[0]["id"] if seq else "1"
    for api in (adm, make_user(app_url, "Analyst")):
        for method, path in (("PUT", "/api/audit"), ("PATCH", "/api/audit"), ("DELETE", "/api/audit"), ("POST", "/api/audit"),
                             ("PUT", "/api/audit/chain"), ("PATCH", "/api/audit/chain"), ("DELETE", "/api/audit/chain"),
                             ("POST", "/api/audit/chain"), ("PUT", f"/api/audit/{rid}"), ("PATCH", f"/api/audit/{rid}"),
                             ("DELETE", f"/api/audit/{rid}")):
            r = api.c.request(method, path, json={})
            assert r.status_code == 405, (method, path, r.status_code)
            assert r.json() == ERR_405
    pg = Postgres()
    guards = pg.rows("select (select count(*) from pg_trigger where tgrelid = 'audit_log'::regclass and not tgisinternal) "
                     "+ (select count(*) from pg_rules where tablename = 'audit_log') as n")
    assert guards[0]["n"] >= 1


TAMPER_HASH = "f" * 64


def owner_sql(url: str, sql: str) -> None:
    out = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], capture_output=True, text=True,
                         timeout=HTTP_TIMEOUT_S)
    assert out.returncode == 0, out.stderr[-2000:]


def set_audit_hash(url: str, rules: list[str], seq: int, value: str) -> None:
    lift = "".join(f'ALTER TABLE audit_log DISABLE RULE "{r}"; ' for r in rules)
    restore = "".join(f'ALTER TABLE audit_log ENABLE RULE "{r}"; ' for r in rules)
    owner_sql(url, f"BEGIN; ALTER TABLE audit_log DISABLE TRIGGER USER; {lift}"
                   f"UPDATE audit_log SET hash = '{value}' WHERE seq = {seq}; "
                   f"ALTER TABLE audit_log ENABLE TRIGGER USER; {restore}COMMIT;")


def test_audit_chain_recomputes(browser, app_url):
    iso = Api(APP_ISOLATED, MORGAN)
    iso_aid = register(iso, ["v"])
    tag(iso, f"{iso_aid}.v", "PII")
    tag(iso, f"{iso_aid}.v", "Confidential")
    iso_pg = Postgres("_isolated")
    k = audit_rows(iso_pg, f"{iso_aid}.v", "tag.add")[0]["seq"]
    original = iso_pg.rows(f"select hash from audit_log where seq = {k}")[0]["hash"]
    rules = [r["rulename"] for r in iso_pg.rows("select rulename from pg_rules where tablename = 'audit_log'")]
    db_url = os.environ.get("DATABASE_URL", "") + "_isolated"
    assert iso.get("/api/audit/chain").json()["intact"] is True
    set_audit_hash(db_url, rules, k, TAMPER_HASH)
    try:
        assert iso_pg.rows(f"select hash from audit_log where seq = {k}")[0]["hash"] == TAMPER_HASH
        broken = iso.get("/api/audit/chain").json()
        assert broken == {"intact": False, "checked_through": k - 1, "first_broken_seq": k}
        with ui(browser, APP_ISOLATED, iso, "/admin") as page:
            button = page.get_by_role("button", name="Check audit chain", exact=True)
            wait_ui(page, lambda: button.is_visible(), 15, "chain button")
            click(button)
            wait_ui(page, lambda: status(page, "Chain check").inner_text().strip() == f"Audit chain broken at seq {k}.",
                    what="broken words")
    finally:
        set_audit_hash(db_url, rules, k, original)
    assert iso.get("/api/audit/chain").json()["intact"] is True
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    tag(steward, f"{aid}.c1", "PII")
    rows = admin(app_url).get("/api/audit", params={"limit": 200}).json()["rows"]
    for newer, older in zip(rows, rows[1:]):
        assert newer["seq"] == older["seq"] + 1
        assert newer["prev_hash"] == older["hash"]
    for row in rows:
        assert re.fullmatch(r"[0-9a-f]{64}", row["hash"])
        assert row_hash(row) == row["hash"], row["seq"]
    if rows[-1]["seq"] == 1:
        assert rows[-1]["prev_hash"] == ZERO_HASH
    started = time.monotonic()
    chain = admin(app_url).get("/api/audit/chain")
    assert time.monotonic() - started < CHAIN_BUDGET_S
    body = chain.json()
    assert body["intact"] is True and body["first_broken_seq"] is None and body["checked_through"] >= rows[0]["seq"]
    with ui(browser, app_url, admin(app_url), "/admin") as page:
        button = page.get_by_role("button", name="Check audit chain", exact=True)
        wait_ui(page, lambda: button.is_visible(), 15, "chain button")
        click(button)
        wait_ui(page, lambda: re.fullmatch(r"Audit chain intact through seq \d+\.",
                                           status(page, "Chain check").inner_text().strip()), what="intact words")


def test_audit_paging_is_stable(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    for t in ("PII", "Confidential"):
        tag(steward, f"{aid}.c1", t)
    adm = admin(app_url)
    first = adm.get("/api/audit", params={"limit": 3}).json()
    seqs = [r["seq"] for r in first["rows"]]
    assert seqs == list(range(seqs[0], seqs[0] - 3, -1)) and first["next_before_seq"] == seqs[-1]
    untag(steward, f"{aid}.c1", "PII")
    untag(steward, f"{aid}.c1", "Confidential")
    second = adm.get("/api/audit", params={"limit": 3, "before_seq": first["next_before_seq"]}).json()
    assert [r["seq"] for r in second["rows"]] == list(range(seqs[-1] - 1, seqs[-1] - 4, -1))
    assert second["total"] >= first["total"] + 2
    last = adm.get("/api/audit", params={"limit": 1, "before_seq": 2}).json()
    assert [r["seq"] for r in last["rows"]] == [1] and last["next_before_seq"] is None
    for params, field, msg in (({"limit": 0}, "limit", "Use a whole number from 1 to 500."),
                               ({"limit": 501}, "limit", "Use a whole number from 1 to 500."),
                               ({"before_seq": 0}, "before_seq", "Use a positive whole number.")):
        r = adm.get("/api/audit", params=params)
        assert r.status_code == 422 and r.json()["error"]["fields"][field] == msg


def test_wf_access_admin_role_change_live(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["ssn"])
    cid = f"{aid}.ssn"
    tag(steward, cid, "PII")
    with ui(browser, app_url, admin(app_url), "/admin") as apage, \
            ui(browser, app_url, steward, f"/catalog?asset={aid}&column={enc(cid)}") as spage:
        wait_ui(spage, lambda: spage.get_by_role("button", name="Withdraw PII", exact=True).is_visible(), what="steward controls")
        spage.get_by_role("button", name="Withdraw PII", exact=True).focus()
        record(status(spage, "Activity"))
        record(status(apage, "Activity"))
        picker = apage.get_by_role("combobox", name=f"Role for {steward.user['name']}", exact=True)
        select(picker, "Analyst")
        expected_admin = f"Role updated: {steward.user['name']} is now Analyst."
        wait_ui([apage, spage], lambda: said(status(apage, "Activity")).count(expected_admin) == 1, what="admin copy")
        wait_ui([apage, spage], lambda: said(status(spage, "Activity")).count("Your role changed to Analyst.") == 1,
                what="role-change copy")
        detail = spage.get_by_role("region", name="Column detail")
        wait_ui(spage, lambda: MASKED in detail.inner_text() and "ssn-sample-1" not in detail.inner_text(), what="masked")
        assert spage.get_by_role("button", name="Withdraw PII", exact=True).count() == 0
        assert spage.get_by_role("checkbox", name=f"Select {cid.rsplit('.', 1)[1]}", exact=True).count() == 0
        assert spage.evaluate("document.activeElement !== document.body")
        advance(spage, LIVE_S * 1000)
        assert said(status(spage, "Activity")).count("Your role changed to Analyst.") == 1
        assert said(status(apage, "Activity")).count(expected_admin) == 1
    assert tag(steward, cid, "Confidential").status_code == 403


def test_wf_access_admin_console(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["v"])
    with ui(browser, app_url, steward, "/catalog") as spage:
        nav = spage.get_by_role("navigation", name="Main")
        wait_ui(spage, lambda: nav.get_by_role("link", name="Catalog", exact=True).count() == 1, 15, "nav")
        assert nav.get_by_role("link", name="Admin", exact=True).count() == 0
    with ui(browser, app_url, admin(app_url), "/catalog") as apage:
        nav = apage.get_by_role("navigation", name="Main")
        admin_link = nav.get_by_role("link", name="Admin", exact=True)
        wait_ui(apage, lambda: admin_link.count() == 1, 15, "Admin link")
        click(admin_link)
        wait_ui(apage, lambda: "/admin" in apage.url and apage.get_by_role("heading", name="Admin", exact=True).count() == 1,
                15, "Admin screen")
        users = apage.get_by_role("table", name="Users")
        wait_ui(apage, lambda: users.get_by_role("combobox", name=f"Role for {steward.user['name']}", exact=True).count() == 1,
                what="role picker")
        assert apage.get_by_role("button", name=f"Reset password for {steward.user['name']}", exact=True).count() == 1
        table = apage.get_by_role("table", name="Audit log")
        wait_ui(apage, lambda: table.get_by_role("link").count() >= 1, 15, "audit rows")
        tag(steward, f"{aid}.v", "PII")
        seq = audit_rows(Postgres(), f"{aid}.v", "tag.add")[0]["seq"]
        wait_ui(apage, lambda: table.get_by_role("link", name=str(seq), exact=True).count() == 1, what="audit row live")
        seqs = [int(x.inner_text()) for x in table.get_by_role("link").all()]
        assert seqs == list(range(seqs[0], seqs[0] - len(seqs), -1))


def test_wf_access_admin_password_reset(browser, app_url):
    user = make_user(app_url, "Analyst")
    with ui(browser, app_url, admin(app_url), "/admin") as apage, ui(browser, app_url, user, "/catalog") as upage:
        record(status(apage, "Activity"))
        opener = apage.get_by_role("button", name=f"Reset password for {user.user['name']}", exact=True)
        click(opener)
        dialog = apage.get_by_role("dialog", name="Reset password")
        fill(dialog.get_by_label("New password", exact=True), "reset-probe-pass-1")
        click(dialog.get_by_role("button", name="Reset password", exact=True))
        pattern = re.compile(rf"^Password reset: {re.escape(user.user['name'])} was signed out of \d+ sessions\.$")
        wait_ui([apage, upage], lambda: any(pattern.match(t) for t in said(status(apage, "Activity"))), what="reset copy")
        wait_ui([apage, upage], lambda: "/signin" in upage.url and upage.get_by_role("alert").filter(
            has_text="Your session ended. Sign in again.").count() == 1, SESSION_END_S + INFRA_SLACK_S, "signin redirect")
        assert has_focus(opener)
    assert user.get("/api/session").status_code == 401
    Api(app_url, user.user["email"], "reset-probe-pass-1")


def test_wf_access_admin_demote_during_trace(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["ssn"])
    down = register(steward, ["ssn"])
    cid = f"{aid}.ssn"
    link(steward, [(cid, f"{down}.ssn", "copy")])
    tag(steward, cid, "PII")
    with ui(browser, app_url, steward, f"/catalog?asset={aid}&column={enc(cid)}", PHONE) as page:
        click(page.get_by_role("button", name="Lineage", exact=True))
        rail = page.get_by_role("complementary", name="Lineage")
        wait_ui(page, lambda: node(page, f"{down}.ssn").count() == 1, what="hop list")
        record(status(page, "Activity"))
        record(status(page, "Trace summary"))
        held_routes = []

        def hold_trace(route):
            if not held_routes:
                held_routes.append(route)
            else:
                route.continue_()

        page.route("**/lineage?*direction=downstream*", hold_trace)
        click(rail.get_by_role("button", name="Trace impact", exact=True))
        spin(page, lambda: len(held_routes) == 1, what="trace request held")
        assert admin(app_url).patch(f"/api/users/{steward.user['id']}", {"role": "Analyst"}).status_code == 200
        wait_ui(page, lambda: rail.get_by_role("button", name="Trace impact", exact=True).count() == 0, what="trace gone")
        for route in held_routes:
            route.continue_()
        wait_ui(page, lambda: said(status(page, "Activity")).count("Your role changed to Analyst.") == 1, what="copy")
        advance(page, SWEEP_MAX_MS)
        assert rail.get_attribute("data-sweep") == "idle"
        assert node(page, f"{down}.ssn").get_attribute("data-lit") == "false"
        assert has_focus(rail.get_by_role("button", name="Close lineage", exact=True))
        assert all(t in ("", "Tracing...") for t in said(status(page, "Trace summary")))
        assert MASKED in page.get_by_role("region", name="Column detail").inner_text()


def test_search_matches_literally_and_filters(app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    a1 = register(steward, ["p1"], desc=f"{tok} alpha 100%_match")
    a2 = register(steward, [f"col{tok}"], desc=f"Second {tok}")
    a3 = register(steward, ["c3"], desc=f"Third {tok}")
    term = steward.post("/api/terms", json={"name": f"Term {tok}", "definition": "Probe term."}).json()["term"]
    assert steward.post(f"/api/assets/{enc(a3)}/terms", json={"term_id": term["id"]}).status_code == 200
    tag(steward, f"{a1}.p1", "PII")
    steward.post(f"/api/assets/{enc(a2)}/deprecate", json={"reason": "Probe."}, key=ikey())
    ids = lambda **p: [r["id"] for r in search(steward, **p).json()["results"]]
    assert ids(q=tok) == sorted([a1, a2, a3])
    assert search(steward, q=tok).json()["total"] == 3
    assert ids(q=f"{tok} alpha 100%") == [a1]
    assert ids(q=f"{tok} alpha 1%0") == []
    assert ids(q=f"{tok} alpha 100__match") == []
    assert ids(q=f"COL{tok}") == [a2]
    assert ids(q=f"term {tok.upper()}") == [a3]
    assert ids(q=tok, tag="PII") == [a1]
    assert ids(q=tok, state="deprecated") == [a2]
    assert ids(q=tok, term=term["id"]) == [a3]
    assert ids(q=tok, owner=steward.user["id"], state="draft") == sorted([a1, a3])
    assert ids(q=tok, tag="PII", state="deprecated") == []
    assert ids(q=tok, owner="u-nobody-" + tok) == []
    for params, field, msg in (({"tag": "Secret"}, "tag", "Tag must be PII or Confidential."),
                               ({"state": "retired"}, "state", "State must be draft, verified or deprecated.")):
        r = search(steward, **params)
        assert r.status_code == 422 and r.json()["error"]["fields"][field] == msg


def test_facet_counts_exclude_own_group(app_url):
    owner_a = make_user(app_url, "Steward")
    owner_b = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    a1 = register(owner_a, ["p"], desc=f"{tok} one")
    a2 = register(owner_a, ["c"], desc=f"{tok} two")
    a3 = register(owner_b, ["p", "c"], desc=f"{tok} three")
    a4 = register(owner_b, ["p"], desc=f"{tok} four")
    link(owner_a, [(f"{a1}.p", f"{a4}.p", "copy")])
    tag(owner_a, f"{a1}.p", "PII")
    tag(owner_a, f"{a2}.c", "Confidential")
    tag(owner_a, f"{a3}.p", "PII")
    tag(owner_a, f"{a3}.c", "Confidential")
    body = search(owner_a, q=tok, tag="PII").json()
    assert [r["id"] for r in body["results"]] == sorted([a1, a3, a4])
    f = {g: {e["value"]: e["count"] for e in body["facets"][g]} for g in body["facets"]}
    assert [e["value"] for e in body["facets"]["tag"]] == ["PII", "Confidential"]
    assert f["tag"] == {"PII": 3, "Confidential": 2}
    assert [e["value"] for e in body["facets"]["state"]] == ["draft", "verified", "deprecated"]
    assert f["state"] == {"draft": 3, "verified": 0, "deprecated": 0}
    assert f["owner"] == {owner_a.user["id"]: 1, owner_b.user["id"]: 2}
    labels = [e["label"] for e in body["facets"]["owner"]]
    assert labels == sorted(labels, key=str.casefold)
    narrowed = search(owner_a, q=tok, tag="PII", owner=owner_b.user["id"]).json()
    nf = {g: {e["value"]: e["count"] for e in narrowed["facets"][g]} for g in narrowed["facets"]}
    assert nf["tag"] == {"PII": 2, "Confidential": 1}
    assert nf["owner"] == {owner_a.user["id"]: 1, owner_b.user["id"]: 2}
    untag(owner_a, f"{a1}.p", "PII")
    after = search(owner_a, q=tok).json()
    assert {e["value"]: e["count"] for e in after["facets"]["tag"]} == {"PII": 1, "Confidential": 2}


def test_search_bounds_in_code_points(app_url):
    api = make_user(app_url, "Analyst")
    for q in ("🧾" * Q_MAX, "é" * Q_MAX):
        started = time.monotonic()
        r = search(api, q=q)
        assert r.status_code == 200 and time.monotonic() - started < SEARCH_BUDGET_S
    for q in ("🧾" * (Q_MAX + 1), "e\u0301" * Q_MAX):
        r = search(api, q=q)
        assert r.status_code == 422
        assert r.json()["error"]["fields"]["q"] == "Search text must be 200 characters or fewer."


def test_wf_analyst_search_type_and_facets(browser, app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    a1 = register(steward, ["p"], desc=f"{tok} one")
    register(steward, ["c"], desc=f"{tok} two")
    tag(steward, f"{a1}.p", "PII")
    analyst = make_user(app_url, "Analyst")
    with ui(browser, app_url, analyst, "/catalog") as page:
        page.evaluate("window.__probe_no_reload = 1")
        box = page.get_by_role("searchbox", name="Search catalog")
        record(status(page, "Search status"))
        fill(box, tok)
        advance(page, DEBOUNCE_MS)
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link").count() == 2, what="two results")
        assert has_focus(box)
        assert said(status(page, "Search status")).count(matching(2)) == 1
        pii = page.get_by_role("radiogroup", name="Tag").get_by_role("radio", name="PII", exact=True)
        click(pii)
        wait_ui(page, lambda: results.get_by_role("link").count() == 1, what="filtered")
        assert results.get_by_role("link", name=a1, exact=True).count() == 1
        assert has_focus(pii)
        assert said(status(page, "Search status")).count(matching(1)) == 1
        assert page.evaluate("window.__probe_no_reload") == 1
    assert [r["id"] for r in search(analyst, q=tok, tag="PII").json()["results"]] == [a1]


def test_wf_analyst_search_url_state(browser, app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    a1 = register(steward, ["p"], desc=f"{tok} one")
    register(steward, ["c"], desc=f"{tok} two")
    tag(steward, f"{a1}.p", "PII")
    analyst = make_user(app_url, "Analyst")
    with ui(browser, app_url, analyst, f"/catalog?q={tok}") as page:
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link").count() == 2, 15, "two results")
        group = page.get_by_role("radiogroup", name="Tag")
        click(group.get_by_role("radio", name="PII", exact=True))
        wait_ui(page, lambda: results.get_by_role("link").count() == 1, what="filtered")
        query = parse_qs(urlparse(page.url).query)
        assert query.get("tag") == ["PII"] and query.get("q") == [tok]
        url = page.url
        page.go_back()
        wait_ui(page, lambda: results.get_by_role("link").count() == 2, what="back restores")
        assert group.get_by_role("radio", name="Any", exact=True).is_checked()
        page.go_forward()
        wait_ui(page, lambda: results.get_by_role("link").count() == 1, what="forward restores")
        assert group.get_by_role("radio", name="PII", exact=True).is_checked()
    with ui(browser, app_url, make_user(app_url, "Analyst"), urlparse(url).path + "?" + urlparse(url).query) as page:
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link", name=a1, exact=True).count() == 1, 15, "shared URL")
        assert results.get_by_role("link").count() == 1
        assert page.get_by_role("radiogroup", name="Tag").get_by_role("radio", name="PII", exact=True).is_checked()


def test_wf_analyst_search_latest_wins(browser, app_url):
    steward = make_user(app_url, "Steward")
    tok_a, tok_b = uuid.uuid4().hex[:10], uuid.uuid4().hex[:10]
    a_only = register(steward, ["c"], desc=f"{tok_a} only")
    b1 = register(steward, ["c"], desc=f"{tok_b} one")
    b2 = register(steward, ["c"], desc=f"{tok_b} two")
    with ui(browser, app_url, make_user(app_url, "Analyst"), "/catalog") as page:
        held_routes = []

        def handler(route):
            if tok_a in route.request.url and not held_routes:
                held_routes.append(route)
            else:
                route.continue_()

        page.route("**/api/search*", handler)
        record(status(page, "Search status"))
        box = page.get_by_role("searchbox", name="Search catalog")
        fill(box, tok_a)
        advance(page, DEBOUNCE_MS)
        spin(page, lambda: len(held_routes) == 1, what="first search held")
        fill(box, tok_b)
        advance(page, DEBOUNCE_MS)
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link").count() == 2, what="newer results")
        held_routes[0].continue_()
        advance(page, 1000)
        assert results.get_by_role("link", name=a_only, exact=True).count() == 0
        assert matching(1) not in said(status(page, "Search status"))
        asset_routes = []

        def hold_asset(route):
            if enc(b1) in route.request.url and not asset_routes:
                asset_routes.append(route)
            else:
                route.continue_()

        page.route("**/api/assets/*", hold_asset)
        click(results.get_by_role("link", name=b1, exact=True))
        spin(page, lambda: len(asset_routes) == 1, what="asset read held")
        click(results.get_by_role("link", name=b2, exact=True))
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("heading", name=b2, exact=True).count() == 1, what="second asset")
        asset_routes[0].continue_()
        advance(page, 1000)
        assert detail.get_by_role("heading", name=b1, exact=True).count() == 0
        assert f"asset={b2}" in page.url


FACET_COUNT_JS = """el => { let n = el;
  while (n && n.querySelectorAll('[data-facet-count]').length === 0) n = n.parentElement;
  if (!n) return null;
  const counts = [...n.querySelectorAll('[data-facet-count]')];
  if (counts.length === 1) return counts[0].textContent.trim();
  let box = el.getBoundingClientRect();
  if (!box.width || !box.height) {
    const owner = (el.labels && el.labels[0]) || el.parentElement;
    box = owner.getBoundingClientRect(); }
  const cy = box.top + box.height / 2;
  let best = null, bestD = Infinity;
  for (const c of counts) { const r = c.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - cy);
    if (d < bestD) { bestD = d; best = c; } }
  return best ? best.textContent.trim() : null; }"""


def test_wf_analyst_search_filters_sheet(browser, app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    a1 = register(steward, ["p"], desc=f"{tok} one")
    a2 = register(steward, ["p"], desc=f"{tok} two")
    tag(steward, f"{a1}.p", "PII")
    tag(steward, f"{a2}.p", "Confidential")
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?q={tok}&tag=PII", PHONE) as page:
        opener = page.get_by_role("button", name="Filters", exact=True)
        wait_ui(page, lambda: opener.is_visible(), what="filters button")
        assert opener.evaluate("el => el.querySelector('[data-active-filters]').textContent.trim()") == "1"
        assert page.get_by_role("radiogroup", name="Tag").count() == 0
        closed_names = tab_order(page, 15)
        assert "Close filters" not in closed_names and "PII" not in closed_names
        click(opener)
        sheet = page.get_by_role("dialog", name="Filters")
        wait_ui(page, lambda: sheet.get_attribute("data-transition") == "open", what="sheet open")
        group = sheet.get_by_role("radiogroup", name="Tag")
        pii = group.get_by_role("radio", name="PII", exact=True)
        assert has_focus(pii)
        page.keyboard.press("ArrowDown")
        wait_ui(page, lambda: url_param(page, "tag") == ["Confidential"], what="arrow chooses")
        assert has_focus(group.get_by_role("radio", name="Confidential", exact=True)) and sheet.is_visible()
        page.keyboard.press("ArrowUp")
        wait_ui(page, lambda: "tag=PII" in page.url and has_focus(pii), what="back to PII")
        for _ in range(12):
            page.keyboard.press("Tab")
            assert sheet.evaluate("el => el.contains(document.activeElement)")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: has_focus(opener), what="focus back on Filters")
        wait_ui(page, lambda: sheet.count() == 0, what="sheet closed and hidden")
        assert page.get_by_role("radiogroup", name="Tag").count() == 0
        assert opener.evaluate("el => el.querySelector('[data-active-filters]').textContent.trim()") == "1"
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link", name=a1, exact=True).count() == 1, what="PII results")


def test_wf_analyst_search_live_sheet(browser, app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    a1 = register(steward, ["p"], desc=f"{tok} one")
    a2 = register(steward, ["p"], desc=f"{tok} two")
    tag(steward, f"{a1}.p", "PII")
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?q={tok}&tag=PII", PHONE) as page:
        opener = page.get_by_role("button", name="Filters", exact=True)
        wait_ui(page, lambda: opener.is_visible(), what="filters button")
        click(opener)
        sheet = page.get_by_role("dialog", name="Filters")
        wait_ui(page, lambda: sheet.get_attribute("data-transition") == "open", what="sheet open")
        pii = sheet.get_by_role("radiogroup", name="Tag").get_by_role("radio", name="PII", exact=True)
        assert has_focus(pii)
        record(sheet.get_by_role("status", name="Search status"))
        assert pii.evaluate(FACET_COUNT_JS) == "1"
        url = page.url
        assert tag(steward, f"{a2}.p", "PII").status_code == 201
        wait_ui(page, lambda: pii.evaluate(FACET_COUNT_JS) == "2", what="count")
        wait_ui(page, lambda: said(sheet.get_by_role("status", name="Search status")).count(matching(2)) == 1,
                what="announced")
        assert has_focus(pii) and pii.is_checked() and sheet.is_visible() and page.url == url
        assert opener.evaluate("el => el.querySelector('[data-active-filters]').textContent.trim()") == "1"
        page.keyboard.press("Escape")
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link").count() == 2, what="results repainted")
    assert search(steward, q=tok, tag="PII").json()["total"] == 2


def test_published_response_fields(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    down = register(steward, ["c1"])
    link(steward, [(f"{aid}.c1", f"{down}.c1", "copy")])
    assert verify(steward, aid, "signoff.pdf", pdf_bytes()).status_code == 200
    keys = S3().keys(f"evidence/{aid}/")
    assert len(keys) == 1
    for api in (admin(app_url), steward, make_user(app_url, "Analyst"), make_user(app_url, "Viewer")):
        detail = asset(api, aid)
        assert set(detail) == ASSET_DETAIL_KEYS and set(detail["evidence"]) == EVIDENCE_KEYS
        assert set(detail["owner"]) == {"id", "name"} and set(detail["columns"][0]) == COLUMN_KEYS
        col = column(api, f"{aid}.c1")
        assert set(col) == COLUMN_KEYS | {"asset"} and set(col["asset"]) == {"id", "state"}
        graph = api.get("/api/graph").json()
        assert set(graph) == {"columns", "edges"} and set(graph["columns"][0]) == GRAPH_COLUMN_KEYS
        assert set(graph["edges"][0]) == {"id", "from", "to", "transform"}
        lin = lineage(api, f"{aid}.c1").json()
        assert set(lin) == LINEAGE_KEYS and set(lin["reached"][0]) == REACHED_KEYS
        assert set(lin["edges"][0]) == {"from", "to", "transform", "kind"}
        summary = search(api, q=aid).json()["results"][0]
        assert set(summary) == ASSET_SUMMARY_KEYS
        blob = json.dumps([detail, col, lin, summary])
        assert keys[0] not in blob and steward.user["email"] not in blob


def test_masked_samples_by_role(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, [("p", [RAW_PII]), ("c", ["conf-raw-1"]), ("n", ["plain-1"])])
    down = register(steward, [("ip", [RAW_INHERITED])])
    link(steward, [(f"{aid}.p", f"{down}.ip", "copy")])
    tag(steward, f"{aid}.p", "PII")
    tag(steward, f"{aid}.c", "Confidential")
    pg = Postgres()
    before_suppress = max_seq(pg)
    roles = {"Admin": admin(app_url), "Steward": steward, "Analyst": make_user(app_url, "Analyst"),
             "Viewer": make_user(app_url, "Viewer")}
    expect_raw = {"Admin": {"p", "c", "n", "ip"}, "Steward": {"p", "c", "n", "ip"}, "Analyst": {"c", "n"}, "Viewer": {"n"}}
    for role, api in roles.items():
        for col in asset(api, aid)["columns"] + asset(api, down)["columns"]:
            raw = col["name"] in expect_raw[role]
            assert (col["samples"] == [MASKED]) != raw, (role, col["name"])
            assert col["masked"] is (not raw)
    analyst = roles["Analyst"]

    def read(api):
        return api, column(api, f"{down}.ip")["samples"]

    outcomes = list(cf.ThreadPoolExecutor(8).map(read, [analyst, roles["Admin"]] * 10))
    for api, samples in outcomes:
        assert samples == ([MASKED] if api is analyst else [RAW_INHERITED])
    assert suppress(steward, f"{down}.ip", "PII").status_code == 201
    assert column(analyst, f"{down}.ip")["samples"] == [RAW_INHERITED]
    past = column(analyst, f"{down}.ip", as_of_seq=before_suppress)
    assert past["column"]["samples"] == [MASKED]
    for response in (analyst.get("/api/graph"), lineage(analyst, f"{aid}.p")):
        assert RAW_PII not in response.text and "samples" not in json_keys(response.json())


def test_wf_asset_detail_latest_open(browser, app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    first = register(steward, [("ssn", [RAW_FIRST])], desc=f"{tok} first")
    second = register(steward, [("ssn", [RAW_SECOND])], desc=f"{tok} second")
    tag(steward, f"{first}.ssn", "PII")
    tag(steward, f"{second}.ssn", "PII")
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?q={tok}") as page:
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link").count() == 2, 15, "two results")
        held_routes = []

        def hold(route):
            if enc(first) in route.request.url and not held_routes:
                held_routes.append(route)
            else:
                route.continue_()

        page.route("**/api/assets/*", hold)
        click(results.get_by_role("link", name=first, exact=True))
        spin(page, lambda: len(held_routes) == 1, what="first asset read held")
        click(results.get_by_role("link", name=second, exact=True))
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("heading", name=second, exact=True).count() == 1, what="second asset")
        wait_ui(page, lambda: MASKED in detail.inner_text(), what="masked samples")
        held_routes[0].continue_()
        advance(page, 1000)
        assert detail.get_by_role("heading", name=first, exact=True).count() == 0
        assert detail.get_by_role("heading", name=second, exact=True).count() == 1
        assert page_text_absent(page, RAW_SECOND) and page_text_absent(page, RAW_FIRST)
        assert f"asset={second}" in page.url


def test_wf_asset_detail_glyphs(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["ssn", "plain"])
    cid = f"{aid}.ssn"
    tag(steward, cid, "PII")
    with ui(browser, app_url, steward, f"/catalog?q={aid}&asset={aid}&column={enc(cid)}") as page:
        table = page.get_by_role("region", name="Asset detail").get_by_role("table", name="Columns")
        wait_ui(page, lambda: table.get_by_role("button", name="ssn", exact=True).count() == 1, 15, "columns")
        row = table.get_by_role("row").filter(has=page.get_by_role("button", name="ssn", exact=True))
        assert glyphs(row, "PII") == ["P"]
        plain = table.get_by_role("row").filter(has=page.get_by_role("button", name="plain", exact=True))
        assert marks(plain, "data-tag-glyph") == []
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link", name=aid, exact=True).count() == 1, what="result row")
        result = results.get_by_role("listitem").first
        assert glyphs(result, "PII") == ["P"] and glyphs(result, "Confidential") == ["C"]
        counts = {m["value"]: m["text"] for m in marks(result, "data-tag-count")}
        assert counts == {"PII": "1", "Confidential": "0"}
        wait_ui(page, lambda: node(page, cid).count() == 1, what="canvas node")
        assert glyphs(node(page, cid), "PII") == ["P"]


def test_wf_asset_detail_inert_text(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, [("v", ["<em>probe</em>"])], desc='Totals <net> & "gross"')
    with ui(browser, app_url, steward, f"/catalog?asset={aid}&column={enc(aid + '.v')}") as page:
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: 'Totals <net> & "gross"' in detail.inner_text(), 15, "literal description")
        wait_ui(page, lambda: "<em>probe</em>" in page.evaluate("document.body.innerText"), what="literal sample")
        assert page.evaluate("document.getElementsByTagName('net').length") == 0
        assert page.evaluate("[...document.getElementsByTagName('em')].filter(e => e.textContent === 'probe').length") == 0


def test_wf_asset_detail_cards(browser, app_url):
    steward = make_user(app_url, "Steward")
    long_id = "s.t" + uuid.uuid4().hex[:12] + "x" * (ASSET_ID_MAX - 15)
    name = ("नाम_सदस्य_" * 7)[:COLUMN_NAME_MAX]
    desc = "y" * DESC_MAX
    aid = register(steward, [(name, ["Q" * SAMPLE_MAX]), ("ssn", ["900-00-0000"])], desc=desc, aid=long_id)
    with ui(browser, app_url, steward, f"/catalog?q={aid}&asset={aid}") as page:
        detail = page.get_by_role("region", name="Asset detail")
        table = detail.get_by_role("table", name="Columns")
        wait_ui(page, lambda: table.get_by_role("button", name=name, exact=True).count() == 1, what="columns")
        for viewport in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(viewport)
            advance(page, 500)
            layout(page)
            pane = detail.bounding_box()
            for cell in table.get_by_role("cell").all():
                assert inside(cell.bounding_box(), pane), viewport
        page.set_viewport_size(PHONE)
        advance(page, 500)
        card = table.get_by_role("row").filter(has=page.get_by_role("button", name=name, exact=True))
        card_text = card.evaluate(SHOWN_TEXT_JS)
        for label in ("Select", "Name", "Type", "Tags", "Samples"):
            assert label in card_text
        assert "Q" * SAMPLE_MAX in card_text.replace("\n", "")


SHOWN_TEXT_JS = """el => {
  const parts = [];
  const generated = (n, pseudo) => {
    const c = getComputedStyle(n, pseudo).content;
    if (!c || c === 'none' || c === 'normal') return;
    const attr = c.match(/^attr\\(([^)]+)\\)$/);
    parts.push(attr ? (n.getAttribute(attr[1].trim()) || '') : c.replace(/^["']|["']$/g, ''));
  };
  const walk = n => {
    if (n.nodeType === 3) { parts.push(n.textContent); return; }
    if (n.nodeType !== 1) return;
    generated(n, '::before');
    n.childNodes.forEach(walk);
    generated(n, '::after');
  };
  walk(el);
  return parts.join(' ');
}"""


def test_wf_asset_detail_masked_view(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, [("ssn", [RAW_UPSTREAM])])
    down = register(steward, [("ssn", [RAW_DOWNSTREAM])])
    link(steward, [(f"{aid}.ssn", f"{down}.ssn", "copy")])
    tag(steward, f"{aid}.ssn", "PII")
    analyst = make_user(app_url, "Analyst")
    bodies: list[str] = []
    with open_app(browser, app_url + "/signin") as page:
        page.on("response", lambda r: bodies.append(r.text()) if "/api/" in r.url and "/api/events" not in r.url else None)
        page.context.add_cookies([{"name": "strata_session", "value": analyst.token, "url": app_url}])
        page.goto(f"{app_url}/catalog?asset={down}&column={enc(down + '.ssn')}")
        detail = page.get_by_role("region", name="Column detail")
        wait_ui(page, lambda: MASKED in detail.inner_text(), 15, "masked samples")
        assert page_text_absent(page, RAW_DOWNSTREAM)
        assert detail.get_by_role("list", name="Tag sources").get_by_role("listitem").count() == 1
        assert f"PII inherited from {aid}.ssn" in detail.inner_text()
    assert bodies and all(RAW_DOWNSTREAM not in b and RAW_UPSTREAM not in b for b in bodies)


def test_direct_tag_changes(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["a", "b"])
    down = register(steward, ["a"])
    a, b, d = f"{aid}.a", f"{aid}.b", f"{down}.a"
    link(steward, [(a, d, "copy")])
    results = parallel([lambda: tag(steward, a, "PII")] * PARALLEL)
    assert sorted(r.status_code for r in results) == [201] + [409] * (PARALLEL - 1)
    assert [r.json() for r in results if r.status_code == 409][0] == {
        "error": {"code": "tag_exists", "message": f"{a} already carries PII directly."}}
    ok = next(r for r in results if r.status_code == 201).json()
    assert ok["column"]["direct_tags"] == ["PII"] and ok["changed_columns"] == sorted([a, d])
    inh = untag(steward, d, "PII")
    assert inh.status_code == 409 and inh.json() == {"error": {"code": "tag_inherited", "message": f"PII on {d} is inherited; withdraw it at its source."}}
    absent = untag(steward, b, "Confidential")
    assert absent.status_code == 409 and absent.json() == {"error": {"code": "tag_absent", "message": f"{b} does not carry Confidential."}}
    assert suppress(steward, d, "PII").status_code == 201
    sup = tag(steward, d, "PII")
    assert sup.status_code == 409 and sup.json() == {"error": {"code": "tag_suppressed", "message": f"PII is suppressed on {d}; lift the suppression first."}}
    bad = tag(steward, b, "Secret")
    assert bad.status_code == 422 and bad.json()["error"]["fields"]["tag"] == "Tag must be PII or Confidential."
    w = parallel([lambda: untag(steward, a, "PII")] * 3)
    assert sorted(r.status_code for r in w) == [200, 409, 409]
    assert column(steward, a)["direct_tags"] == []


def test_effective_tag_propagation(app_url):
    steward = make_user(app_url, "Steward")
    src = register(steward, ["s"])
    names = sorted(PASS_THROUGH) + ["hash", "aggregate"]
    dst = register(steward, names)
    link(steward, [(f"{src}.s", f"{dst}.{n}", n) for n in names])
    hop2 = register(steward, ["after_hash", "after_copy"])
    link(steward, [(f"{dst}.hash", f"{hop2}.after_hash", "copy"), (f"{dst}.copy", f"{hop2}.after_copy", "copy")])
    tag(steward, f"{src}.s", "Confidential")
    for col in asset(steward, dst)["columns"]:
        assert col["effective_tags"] == (["Confidential"] if col["name"] in PASS_THROUGH else []), col["name"]
    tail = {c["name"]: c["effective_tags"] for c in asset(steward, hop2)["columns"]}
    assert tail == {"after_hash": [], "after_copy": ["Confidential"]}


def test_withdrawal_respects_other_paths(app_url):
    finals = []
    for order in ((0, 1), (1, 0)):
        steward = make_user(app_url, "Steward")
        s1, s2, m, d = (register(steward, ["v"]) for _ in range(4))
        cols = [f"{x}.v" for x in (s1, s2, m, d)]
        link(steward, [(cols[0], cols[2], "copy"), (cols[1], cols[2], "join"), (cols[2], cols[3], "copy")])
        tag(steward, cols[0], "PII")
        tag(steward, cols[1], "PII")
        first = untag(steward, cols[order[0]], "PII").json()
        assert first["still_reaching"] == 2
        assert first["changed_columns"] == sorted([cols[order[0]], cols[2], cols[3]])
        assert column(steward, cols[3])["tag_sources"] == {"PII": [cols[order[1]]]}
        second = untag(steward, cols[order[1]], "PII").json()
        assert second["still_reaching"] == 0
        finals.append([column(steward, c)["effective_tags"] for c in cols])
    assert finals[0] == finals[1] == [[], [], [], []]
    steward = make_user(app_url, "Steward")
    x, y = register(steward, ["v"]), register(steward, ["v"])
    link(steward, [(f"{x}.v", f"{y}.v", "copy"), (f"{y}.v", f"{x}.v", "copy")])
    tag(steward, f"{x}.v", "Confidential")
    assert column(steward, f"{y}.v")["effective_tags"] == ["Confidential"]
    gone = untag(steward, f"{x}.v", "Confidential").json()
    assert gone["still_reaching"] == 0 and column(steward, f"{y}.v")["effective_tags"] == []


def test_tagged_column_counts_match_recompute(app_url):
    steward = make_user(app_url, "Steward")
    a = register(steward, ["p", "c", "n"])
    b = register(steward, ["p", "c"])

    def counts(aid):
        d = asset(steward, aid)
        cols = d["columns"]
        expect = (sum(bool(c["effective_tags"]) for c in cols), sum("PII" in c["effective_tags"] for c in cols),
                  sum("Confidential" in c["effective_tags"] for c in cols))
        got = (d["tagged_column_count"], d["pii_column_count"], d["confidential_column_count"])
        assert got == expect
        return got

    tag(steward, f"{a}.p", "PII")
    tag(steward, f"{a}.c", "Confidential")
    tag(steward, f"{a}.c", "PII")
    assert counts(a) == (2, 2, 1)
    link(steward, [(f"{a}.p", f"{b}.p", "copy"), (f"{a}.c", f"{b}.c", "copy")])
    assert counts(b) == (2, 2, 1)
    suppress(steward, f"{b}.c", "PII")
    assert counts(b) == (2, 1, 1)
    edge = next(e for e in steward.get("/api/graph").json()["edges"] if e["from"] == f"{a}.p" and e["to"] == f"{b}.p")
    assert steward.delete(f"/api/lineage/edges/{edge['id']}").status_code == 200
    assert counts(b) == (1, 0, 1)


def test_tag_suppression_lifecycle(app_url):
    steward = make_user(app_url, "Steward")
    s, m, d = (register(steward, ["v"]) for _ in range(3))
    S, M, D = f"{s}.v", f"{m}.v", f"{d}.v"
    link(steward, [(S, M, "copy"), (M, D, "copy")])
    absent = suppress(steward, M, "PII")
    assert absent.status_code == 409 and absent.json()["error"]["code"] == "tag_absent"
    tag(steward, S, "PII")
    short = suppress(steward, M, "PII", "  too short ")
    assert short.status_code == 422
    assert short.json()["error"]["fields"]["justification"] == "Give a justification of 10 to 500 characters."
    direct = suppress(steward, S, "PII")
    assert direct.json() == {"error": {"code": "tag_not_inherited", "message": f"PII on {S} is not inherited; withdraw it instead."}}
    ok = suppress(steward, M, "PII", "Tokenised upstream of this column.")
    assert ok.status_code == 201 and ok.json()["changed_columns"] == sorted([M, D])
    assert column(steward, M)["effective_tags"] == [] and column(steward, D)["effective_tags"] == []
    assert column(steward, M)["suppressed_tags"] == ["PII"]
    again = suppress(steward, M, "PII")
    assert again.json() == {"error": {"code": "suppression_exists", "message": f"PII is already suppressed on {M}."}}
    untag(steward, S, "PII")
    assert column(steward, M)["suppressed_tags"] == ["PII"]
    tag(steward, S, "PII")
    assert column(steward, D)["effective_tags"] == []
    row = audit_rows(Postgres(), M, "tag.suppress")[-1]
    assert row["after"] == {"suppressed_tags": ["PII"], "justification": "Tokenised upstream of this column."}
    lift = steward.delete(f"/api/columns/{enc(M)}/suppressions/PII")
    assert lift.status_code == 200 and column(steward, D)["effective_tags"] == ["PII"]
    assert steward.delete(f"/api/columns/{enc(M)}/suppressions/PII").json() == ERR_404


def test_tag_provenance_sorted(app_url):
    steward = make_user(app_url, "Steward")
    x, y, z = (register(steward, ["v"]) for _ in range(3))
    X, Y, Z = f"{x}.v", f"{y}.v", f"{z}.v"
    link(steward, [(X, Z, "copy"), (Y, Z, "concat"), (Z, X, "copy")])
    tag(steward, Y, "PII")
    tag(steward, X, "PII")
    tag(steward, X, "Confidential")
    col = column(steward, Z)
    assert list(col["tag_sources"]) == ["Confidential", "PII"]
    assert col["tag_sources"] == {"Confidential": [X], "PII": sorted([X, Y])}
    assert column(steward, X)["tag_sources"]["PII"] == sorted([X, Y])


def test_graph_writes_serialised(app_url):
    steward = make_user(app_url, "Steward")
    other = make_user(app_url, "Steward")
    s1, s2, m, d, e = (register(steward, ["v"]) for _ in range(5))
    S1, S2, M, D, E = (f"{x}.v" for x in (s1, s2, m, d, e))
    edges = [(S1, M, "copy"), (S2, M, "copy"), (M, D, "copy")]
    link(steward, edges)
    tag(steward, S1, "PII")
    tag(steward, S2, "PII")
    r1, r2, r3 = parallel([lambda: untag(steward, S1, "PII"), lambda: untag(other, S2, "PII"),
                           lambda: other.post("/api/lineage/edges", json={"edges": [{"from": D, "to": E, "transform": "copy"}]})])
    assert (r1.status_code, r2.status_code, r3.status_code) == (200, 200, 201)
    pg = Postgres()
    w1 = audit_rows(pg, S1, "tag.withdraw")[-1]["seq"]
    w2 = audit_rows(pg, S2, "tag.withdraw")[-1]["seq"]
    edge_seq = audit_rows(pg, r3.json()["edges"][0]["id"], "lineage.add")[0]["seq"]
    first, second = (r1, r2) if w1 < w2 else (r2, r1)
    reach_first = 3 if edge_seq < min(w1, w2) else 2
    assert first.json()["still_reaching"] == reach_first
    assert second.json()["still_reaching"] == 0
    for r, own in ((r1, S1), (r2, S2)):
        assert own in r.json()["changed_columns"] and M in r.json()["changed_columns"]
    expected = recompute({S1, S2, M, D, E}, edges + [(D, E, "copy")], {}, {})
    for c in (S1, S2, M, D, E):
        got = column(steward, c)
        assert got["tag_sources"] == expected[c] and got["effective_tags"] == sorted(expected[c])
    adds = parallel([lambda: tag(steward, S1, "Confidential"), lambda: tag(other, S2, "Confidential")])
    assert [r.status_code for r in adds] == [201, 201]
    expected = recompute({S1, S2, M, D, E}, edges + [(D, E, "copy")], {S1: {"Confidential"}, S2: {"Confidential"}}, {})
    for c in (M, D, E):
        assert column(steward, c)["tag_sources"] == expected[c]
    assert asset(steward, e)["confidential_column_count"] == 1


def test_bulk_apply_and_undo(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["a", "b", "c", "d"])
    up = register(steward, ["d"])
    A, B, C, Dd = (f"{aid}.{n}" for n in "abcd")
    link(steward, [(f"{up}.d", Dd, "copy")])
    tag(steward, B, "Confidential")
    tag(steward, f"{up}.d", "Confidential")
    suppress(steward, Dd, "Confidential")
    path = f"/api/assets/{enc(aid)}/tags/bulk"
    key = ikey()
    body = {"tag": "Confidential", "columns": [A, B, C, Dd]}
    r = steward.post(path, json=body, key=key)
    assert r.status_code == 200
    j = r.json()
    assert [x["outcome"] for x in j["results"]] == ["applied", "already_present", "applied", "refused"]
    assert j["results"][3]["error"] == {"code": "tag_suppressed", "message": f"Confidential is suppressed on {Dd}; lift the suppression first."}
    assert j["results"][0]["error"] is None
    assert (j["requested"], j["applied"]) == (4, 2) and re.fullmatch(r"[0-9a-f-]{36}", j["batch_id"])
    assert [c["id"] for c in j["columns"]] == [A, B, C, Dd]
    pg = Postgres()
    assert steward.post(path, json=body, key=key).json() == j
    assert len(audit_rows(pg, aid, "tag.bulk_add")) == 1
    conflict = steward.post(path, json={"tag": "Confidential", "columns": [A]}, key=key)
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "idempotency_conflict"
    for bad, field, msg in (({"tag": "PII", "columns": []}, "columns", "Select 1 to 200 columns of this asset."),
                            ({"tag": "PII", "columns": [A, A]}, "columns", "Select 1 to 200 columns of this asset."),
                            ({"tag": "PII", "columns": [A, f"{up}.d"]}, "columns[1]", "Unknown column of this asset.")):
        resp = steward.post(path, json=bad)
        assert resp.status_code == 422 and resp.json()["error"]["fields"][field] == msg
    none = steward.post(path, json={"tag": "Confidential", "columns": [B]}).json()
    assert none["applied"] == 0 and none["batch_id"] is None
    assert len(audit_rows(pg, aid, "tag.bulk_add")) == 1
    undo = steward.post(f"/api/tag-batches/{j['batch_id']}/undo", json={})
    assert undo.status_code == 200 and undo.json()["restored"] == 2
    assert [column(steward, x)["direct_tags"] for x in (A, B, C)] == [[], ["Confidential"], []]
    assert len(audit_rows(pg, aid, "tag.bulk_undo")) == 1
    twice = steward.post(f"/api/tag-batches/{j['batch_id']}/undo", json={})
    assert twice.json() == {"error": {"code": "batch_undone", "message": "This bulk tag apply was already undone."}}
    second = steward.post(path, json={"tag": "PII", "columns": [C, A]}).json()
    tag(steward, C, "Confidential")
    changed = steward.post(f"/api/tag-batches/{second['batch_id']}/undo", json={})
    assert changed.json() == {"error": {"code": "batch_changed", "message": f"Undo refused: {C} changed after the bulk apply."}}
    assert steward.post(f"/api/tag-batches/{uuid.uuid4()}/undo", json={}).status_code == 404


def test_wf_tag_propagation_column_controls(browser, app_url):
    steward = make_user(app_url, "Steward")
    s, m, d = (register(steward, ["zip"]) for _ in range(3))
    S, M, D = f"{s}.zip", f"{m}.zip", f"{d}.zip"
    link(steward, [(S, M, "copy"), (M, D, "copy")])
    tag(steward, S, "Confidential")
    watcher = make_user(app_url, "Analyst")
    with ui(browser, app_url, steward, f"/catalog?asset={m}&column={enc(M)}", PHONE) as page, \
            ui(browser, app_url, watcher, f"/catalog?asset={d}&column={enc(D)}", DESKTOP, reduced=True) as wpage:
        detail = page.get_by_role("region", name="Column detail")
        sup = detail.get_by_role("button", name="Suppress Confidential", exact=True)
        wait_ui([page, wpage], lambda: sup.is_visible(), what="suppress control")
        for control in (sup, detail.get_by_role("button", name="Tag PII", exact=True)):
            b = control.bounding_box()
            assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX
        record(status(page, "Activity"))
        tap(sup)
        dialog = page.get_by_role("dialog", name="Suppress tag")
        wait_ui(page, lambda: dialog.is_visible(), what="dialog")
        for name in ("Suppress tag", "Cancel"):
            b = dialog.get_by_role("button", name=name, exact=True).bounding_box()
            assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX
        fill(dialog.get_by_role("textbox", name="Justification"), "Truncated to the 3-digit ZIP prefix under HIPAA Safe Harbor.")
        tap(dialog.get_by_role("button", name="Suppress tag", exact=True))
        wait_ui([page, wpage], lambda: said(status(page, "Activity")).count(f"Confidential suppressed on {M}.") == 1, what="copy")
        wnode = node(wpage, M)
        wait_ui([page, wpage], lambda: wnode.get_attribute("data-tags") == "" and
                len(marks(wnode, "data-seal", "suppression")) == 1, what="watcher seal")
        assert wpage.evaluate("document.getAnimations().length") == 0
        assert glyphs(detail, "Confidential") == []
        lift = detail.get_by_role("button", name="Lift Confidential suppression", exact=True)
        wait_ui(page, lambda: lift.is_visible(), what="lift control")
        b = lift.bounding_box()
        assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX
        tap(lift)
        wait_ui(page, lambda: said(status(page, "Activity")).count(f"Confidential suppression lifted on {M}.") == 1, what="lift copy")
        tap(detail.get_by_role("button", name="Tag PII", exact=True))
        wait_ui(page, lambda: said(status(page, "Activity")).count(f"PII tag added to {M}.") == 1, what="tag copy")
    col = column(steward, M)
    assert col["direct_tags"] == ["PII"] and col["suppressed_tags"] == [] and col["effective_tags"] == ["Confidential", "PII"]
    assert asset(steward, m)["pii_column_count"] == 1


def test_wf_tag_propagation_focus_follows(browser, app_url):
    steward = make_user(app_url, "Steward")
    s, m = register(steward, ["zip"]), register(steward, ["zip"])
    S, M = f"{s}.zip", f"{m}.zip"
    link(steward, [(S, M, "copy")])
    tag(steward, S, "Confidential")
    with ui(browser, app_url, steward, f"/catalog?asset={m}&column={enc(M)}") as page:
        detail = page.get_by_role("region", name="Column detail")
        sup = detail.get_by_role("button", name="Suppress Confidential", exact=True)
        wait_ui(page, lambda: sup.is_visible(), 15, "suppress control")
        sup.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Suppress tag")
        just = dialog.get_by_role("textbox", name="Justification")
        wait_ui(page, lambda: has_focus(just), what="justification focus")
        click(dialog.get_by_role("button", name="Cancel", exact=True))
        wait_ui(page, lambda: has_focus(sup), what="Cancel back to Suppress")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: has_focus(just), what="reopened")
        page.keyboard.type("Truncated to the 3-digit ZIP prefix under HIPAA Safe Harbor.")
        dialog.get_by_role("button", name="Suppress tag", exact=True).focus()
        page.keyboard.press("Enter")
        lift = detail.get_by_role("button", name="Lift Confidential suppression", exact=True)
        wait_ui(page, lambda: has_focus(lift), what="focus on Lift")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: has_focus(detail.get_by_role("button", name="Suppress Confidential", exact=True)), what="focus Suppress")
        detail.get_by_role("button", name="Tag PII", exact=True).focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: has_focus(detail.get_by_role("button", name="Withdraw PII", exact=True)), what="focus Withdraw")
        assert page.evaluate("document.activeElement !== document.body")
    assert column(steward, M)["direct_tags"] == ["PII"]


def test_wf_tag_propagation_refused_resync(browser, app_url):
    steward = make_user(app_url, "Steward")
    other = make_user(app_url, "Steward")
    aid = register(steward, ["member_id"])
    cid = f"{aid}.member_id"
    with open_app(browser, app_url + "/signin") as page:
        page.set_viewport_size(DESKTOP)
        page.route("**/api/events*", lambda route: None)
        page.context.add_cookies([{"name": "strata_session", "value": steward.token, "url": app_url}])
        page.goto(f"{app_url}/catalog?asset={aid}&column={enc(cid)}")
        detail = page.get_by_role("region", name="Column detail")
        press = detail.get_by_role("button", name="Tag PII", exact=True)
        wait_ui(page, lambda: press.is_visible(), 15, "tag control")
        assert tag(other, cid, "PII").status_code == 201
        record(status(page, "Activity"))
        press.focus()
        page.keyboard.press("Enter")
        withdraw = detail.get_by_role("button", name="Withdraw PII", exact=True)
        wait_ui(page, lambda: has_focus(withdraw), what="focus on Withdraw PII")
        assert said(status(page, "Activity")).count(f"{cid} already carries PII directly.") == 1
        assert glyphs(detail, "PII")
    assert len(audit_rows(Postgres(), cid, "tag.add")) == 1


def test_wf_tag_propagation_bulk_undo(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["claim_id", "diagnosis_code", "service_date"])
    tag(steward, f"{aid}.diagnosis_code", "Confidential")
    with ui(browser, app_url, steward, f"/catalog?asset={aid}") as page:
        table = page.get_by_role("table", name="Columns")
        wait_ui(page, lambda: table.get_by_role("checkbox").count() == 3, what="checkboxes")
        for n in ("claim_id", "diagnosis_code", "service_date"):
            check(page.get_by_role("checkbox", name=f"Select {n}", exact=True))
        select(page.get_by_role("combobox", name="Tag to apply"), "Confidential")
        record(status(page, "Activity"))
        apply = page.get_by_role("button", name="Apply tag to selected", exact=True)
        click(apply)
        wait_ui(page, lambda: said(status(page, "Activity")).count("Confidential applied to 2 of 3 columns.") == 1, what="bulk copy")
        assert has_focus(apply)
        assert not any(c.is_checked() for c in table.get_by_role("checkbox").all())
        undo = page.get_by_role("button", name="Undo", exact=True)
        click(undo)
        wait_ui(page, lambda: said(status(page, "Activity")).count("Bulk tag undone on 2 columns.") == 1, what="undo copy")
        assert undo.count() == 0 and has_focus(apply)
    assert column(steward, f"{aid}.claim_id")["direct_tags"] == [] and column(steward, f"{aid}.service_date")["direct_tags"] == []
    assert len(audit_rows(Postgres(), aid, "tag.bulk_undo")) == 1


def test_wf_tag_withdrawal_live_canvas(browser, app_url):
    rui = make_user(app_url, "Steward")
    dana = make_user(app_url, "Steward")
    s1, s2, m, d = (register(rui, ["ssn"]) for _ in range(4))
    S1, S2, M, D = (f"{x}.ssn" for x in (s1, s2, m, d))
    link(rui, [(S1, M, "join"), (S2, M, "copy"), (M, D, "copy")])
    tag(rui, S1, "PII")
    tag(rui, S2, "PII")
    with ui(browser, app_url, rui, f"/catalog?asset={m}&column={enc(M)}", PHONE) as rpage, \
            ui(browser, app_url, dana, f"/catalog?asset={s1}&column={enc(S1)}") as dpage:
        click(rpage.get_by_role("button", name="Lineage", exact=True))
        rail = rpage.get_by_role("complementary", name="Lineage")
        wait_ui(rpage, lambda: node(rpage, D).count() == 1, what="hop list")
        click(rail.get_by_role("button", name="Trace impact", exact=True))
        wait_ui(rpage, lambda: rail.get_attribute("data-sweep") == "done", what="sweep done")
        counter = mark_text(rail, "data-sweep-count")
        summary = status(rpage, "Trace summary").inner_text()
        node(rpage, D).focus()
        scroll = rail.evaluate("el => el.scrollTop")
        record(status(dpage, "Activity"))
        click(dpage.get_by_role("region", name="Column detail").get_by_role("button", name="Withdraw PII", exact=True))
        wait_ui([rpage, dpage], lambda: node(rpage, S1).get_attribute("data-tags") == "", what="glyph dropped")
        wait_ui([rpage, dpage], lambda: [m["text"] for m in marks(node(rpage, M), "data-source-line", "PII")] == [f"PII from {S2}"],
                what="source line")
        assert node(rpage, M).get_attribute("data-tags") == "PII" and node(rpage, D).get_attribute("data-tags") == "PII"
        assert node(rpage, D).get_attribute("data-lit") == "true"
        assert rail.get_attribute("data-sweep") == "done" and mark_text(rail, "data-sweep-count") == counter
        assert status(rpage, "Trace summary").inner_text() == summary
        assert abs(rail.evaluate("el => el.scrollTop") - scroll) <= HOLD_PX and has_focus(node(rpage, D))
        assert said(status(dpage, "Activity")).count(f"PII tag withdrawn from {S1}. Still reaches 2 columns through other paths.") == 1
        layout(rpage)
    assert column(rui, D)["tag_sources"] == {"PII": [S2]}


def test_wf_tag_withdrawal_live_refresh(browser, app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    aid = register(steward, [("ssn", [RAW_REFRESH])], desc=f"{tok} pii")
    other = register(steward, ["p", "c"], desc=f"{tok} also")
    cid = f"{aid}.ssn"
    tag(steward, cid, "PII")
    tag(steward, f"{other}.p", "PII")
    tag(steward, f"{other}.c", "Confidential")
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?q={tok}&tag=PII&asset={aid}&column={enc(cid)}") as page:
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link").count() == 2, what="two results")
        record(status(page, "Search status"))
        box = page.get_by_role("searchbox", name="Search catalog")
        box.focus()
        assert untag(steward, cid, "PII").status_code == 200
        seq = audit_rows(Postgres(), cid, "tag.withdraw")[-1]["seq"]
        wait_ui(page, lambda: results.get_by_role("link").count() == 1, what="result dropped")
        detail = page.get_by_role("region", name="Column detail")
        wait_ui(page, lambda: RAW_REFRESH in detail.inner_text(), what="unmasked")
        wait_ui(page, lambda: int(page.get_by_role("main").get_attribute("data-synced-seq") or 0) >= seq, what="synced seq")
        assert said(status(page, "Search status")).count(matching(1)) == 1
        assert "Searching..." not in said(status(page, "Search status"))
        assert has_focus(box)
        held_routes = []

        def hold(route):
            if "tag=PII" in route.request.url and not held_routes:
                held_routes.append(route)
            else:
                route.continue_()

        page.route("**/api/search*", hold)
        assert untag(steward, f"{other}.p", "PII").status_code == 200
        wait_ui(page, lambda: len(held_routes) == 1, what="event refresh held")
        click(page.get_by_role("radiogroup", name="Tag").get_by_role("radio", name="Confidential", exact=True))
        wait_ui(page, lambda: url_param(page, "tag") == ["Confidential"] and
                results.get_by_role("link", name=other, exact=True).count() == 1, what="newer filter painted")
        held_routes[0].continue_()
        advance(page, 1000)
        assert results.get_by_role("link").count() == 1
        assert results.get_by_role("link", name=other, exact=True).count() == 1
        assert matching(0) not in said(status(page, "Search status"))


def test_impact_analysis_and_cycles(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["f", "x", "h", "z", "s"])
    F, X, H, Z, S = (f"{aid}.{n}" for n in "fxhzs")
    link(steward, [(F, X, "copy"), (F, H, "hash"), (X, Z, "copy"), (X, S, "copy"), (Z, X, "copy")])
    tag(steward, F, "PII")
    suppress(steward, S, "PII")
    started = time.monotonic()
    body = lineage(steward, F).json()
    assert time.monotonic() - started < LINEAGE_BUDGET_S
    assert body["focus_tags"] == ["PII"] and body["focus_tag_sources"] == {"PII": [F]}
    assert [(r["column"], r["hop"]) for r in body["reached"]] == [(H, 1), (X, 1), (S, 2), (Z, 2)]
    by = {r["column"]: r for r in body["reached"]}
    assert by[X]["carried_tags"] == ["PII"] and by[X]["tag_sources"] == {"PII": [F]} and by[X]["asset"] == aid
    assert by[H]["carried_tags"] == [] and by[H]["tag_sources"] == {}
    assert by[S]["carried_tags"] == [] and by[S]["sealed_tags"] == ["PII"]
    kinds = {(e["from"], e["to"]): e["kind"] for e in body["edges"]}
    assert kinds == {(F, X): "flow", (F, H): "seal", (X, Z): "flow", (X, S): "flow", (Z, X): "cycle"}
    assert body["cycles"] == [{"from": Z, "to": X}]
    assert body["totals"] == {"columns": 4, "hops": 2, "cycles": 1} and body["truncated"] is False
    assert body["summary"] == f"Trace complete. Columns reached: {4}. Hops: {2}. Cycles: {1}."
    assert body["assets"] == {aid: {"state": "draft", "deprecated_upstream": None}}
    up = lineage(steward, Z, "upstream").json()
    assert [(r["column"], r["hop"]) for r in up["reached"]] == [(X, 1), (F, 2)]
    assert {(e["from"], e["to"]): e["kind"] for e in up["edges"]}[(Z, X)] == "cycle"
    bad = lineage(steward, F, "sideways")
    assert bad.status_code == 422 and bad.json()["error"]["fields"]["direction"] == "Direction must be downstream or upstream."


def test_traversal_bounds(app_url):
    steward = make_user(app_url, "Steward")
    chain = register(steward, [f"c{i}" for i in range(MAX_HOPS + 2)])
    link(steward, [(f"{chain}.c{i}", f"{chain}.c{i + 1}", "copy") for i in range(MAX_HOPS + 1)])
    started = time.monotonic()
    body = lineage(steward, f"{chain}.c0").json()
    assert time.monotonic() - started < LINEAGE_BUDGET_S
    assert max(r["hop"] for r in body["reached"]) == MAX_HOPS and len(body["reached"]) == MAX_HOPS
    assert body["truncated"] is True and body["limits"] == {"max_hops": MAX_HOPS, "max_columns": MAX_COLUMNS}
    assert body["summary"].endswith(" Truncated at the 12-hop or 500-column limit.")
    src = register(steward, ["s"])
    targets = []
    for _ in range(3):
        t = register(steward, [f"v{i:03d}" for i in range(167)])
        targets += [f"{t}.v{i:03d}" for i in range(167)]
    link(steward, [(f"{src}.s", t, "copy") for t in targets])
    started = time.monotonic()
    fan = lineage(steward, f"{src}.s").json()
    assert time.monotonic() - started < LINEAGE_BUDGET_S
    assert len(fan["reached"]) == MAX_COLUMNS and fan["truncated"] is True
    assert [r["column"] for r in fan["reached"]] == sorted(targets)[:MAX_COLUMNS]


SEED_FOCUS = "src.claims_legacy.paid_amount"


REST_FOCUS = "mart.claims_by_region.total_paid"


def test_wf_impact_sweep_canvas_rest(browser, app_url):
    lena = Api(app_url, LENA)
    up = lineage(lena, REST_FOCUS, "upstream").json()
    down = lineage(lena, REST_FOCUS).json()
    with ui(browser, app_url, lena, f"/catalog?asset=mart.claims_by_region&column={REST_FOCUS}") as page:
        cv = canvas(page)
        wait_ui(page, lambda: node(page, "src.claims_legacy.paid_amount").count() == 1, 15, "canvas drawn")
        focus = node(page, REST_FOCUS)
        assert focus.get_attribute("data-hop") == "0" and focus.get_attribute("data-lit") == "true"
        xs = {0: focus.bounding_box()["x"]}
        tops = {}
        for r in up["reached"]:
            n = node(page, r["column"])
            assert n.get_attribute("data-hop") == str(-r["hop"])
            xs[-r["hop"]] = n.bounding_box()["x"]
            tops[-r["hop"]] = n.bounding_box()["y"]
        for r in down["reached"]:
            n = node(page, r["column"])
            assert n.get_attribute("data-hop") == str(r["hop"]) and n.get_attribute("data-lit") == "false"
            xs[r["hop"]] = n.bounding_box()["x"]
            tops[r["hop"]] = n.bounding_box()["y"]
        hops = sorted(xs)
        assert min(hops) < 0 < max(hops)
        assert all(xs[a] < xs[b] for a, b in zip(hops, hops[1:]))
        for h in tops:
            label = marks(cv, "data-hop-label", str(h))
            assert len(label) == 1 and label[0]["text"] == str(abs(h))
            assert label[0]["box"]["y"] < tops[h]


def test_wf_impact_sweep_schedule(browser, app_url):
    lin = lineage(Api(app_url, DANA), SEED_FOCUS).json()
    with ui(browser, app_url, Api(app_url, DANA), f"/catalog?asset=src.claims_legacy&column={SEED_FOCUS}") as page:
        cv = canvas(page)
        wait_ui(page, lambda: node(page, "dash.risk_outreach.risk_score").count() == 1, 15, "canvas drawn")
        assert cv.get_attribute("data-sweep") == "idle"
        bands: dict[int, list[str]] = {}
        for r in lin["reached"]:
            bands.setdefault(r["hop"], []).append(r["column"])
        record(status(page, "Trace summary"))
        click(cv.get_by_role("button", name="Trace impact", exact=True))
        spin(page, lambda: cv.get_attribute("data-sweep") == "running", what="time zero")
        step = min(STEP_MAX_MS, STEP_BUDGET_MS / lin["totals"]["hops"])
        advance(page, step * 0.5)
        assert all(node(page, c).get_attribute("data-lit") == "false" for c in bands[1])
        elapsed = step * 0.5
        for k in range(1, lin["totals"]["hops"] + 1):
            advance(page, step * (k + 0.5) - elapsed)
            elapsed = step * (k + 0.5)
            for h, cols in bands.items():
                for c in cols:
                    assert node(page, c).get_attribute("data-lit") == ("true" if h <= k else "false"), (k, c)
        advance(page, SWEEP_MAX_MS - elapsed)
        assert cv.get_attribute("data-sweep") == "done"
        assert mark_text(cv, "data-sweep-count") == str(lin["totals"]["columns"])
        for r in lin["reached"]:
            assert node(page, r["column"]).get_attribute("data-tags") == " ".join(r["carried_tags"])
        assert len(marks(cv, "data-seal", "transform")) == sum(e["kind"] == "seal" for e in lin["edges"])
        arc = marks(cv, "data-cycle")
        assert len(arc) == 1 and "cycle" in arc[0]["text"]
        assert said(status(page, "Trace summary")).count(lin["summary"]) == 1


def test_wf_impact_sweep_edge_state(browser, app_url):
    lin = lineage(Api(app_url, DANA), SEED_FOCUS).json()
    with ui(browser, app_url, Api(app_url, DANA), f"/catalog?asset=src.claims_legacy&column={SEED_FOCUS}") as page:
        cv = canvas(page)
        wait_ui(page, lambda: node(page, "dash.risk_outreach.risk_score").count() == 1, 15, "canvas drawn")

        drawn = edges_of(cv)
        for e in lin["edges"]:
            el = drawn[(e["from"], e["to"])]
            assert (el["kind"], el["drawn"], el["state"]) == (e["kind"], "false", "current")
        click(cv.get_by_role("button", name="Trace impact", exact=True))
        spin(page, lambda: cv.get_attribute("data-sweep") == "running", what="time zero")
        step = min(STEP_MAX_MS, STEP_BUDGET_MS / lin["totals"]["hops"])
        target_hop = {r["column"]: r["hop"] for r in lin["reached"]}
        elapsed = 0.0
        for k in range(0, lin["totals"]["hops"] + 1):
            advance(page, step * (k + 0.5) - elapsed)
            elapsed = step * (k + 0.5)
            drawn = edges_of(cv)
            for e in lin["edges"]:
                expected = (target_hop.get(e["from"], 0) if e["kind"] == "cycle" else target_hop[e["to"]]) <= k and k >= 1
                assert drawn[(e["from"], e["to"])]["drawn"] == ("true" if expected else "false"), (k, e)
        advance(page, SWEEP_MAX_MS - elapsed)
        drawn = edges_of(cv)
        assert all(drawn[(e["from"], e["to"])]["drawn"] == "true" and drawn[(e["from"], e["to"])]["state"] == "current"
                   for e in lin["edges"])


def test_wf_impact_sweep_interrupt(browser, app_url):
    dana = Api(app_url, DANA)
    ssn = "src.claims_legacy.member_ssn"
    lin = lineage(dana, ssn).json()
    with ui(browser, app_url, dana, f"/catalog?asset=src.claims_legacy&column={SEED_FOCUS}") as page:
        cv = canvas(page)
        wait_ui(page, lambda: node(page, "dash.risk_outreach.risk_score").count() == 1, 15, "canvas")
        record(status(page, "Trace summary"))
        click(cv.get_by_role("button", name="Trace impact", exact=True))
        spin(page, lambda: cv.get_attribute("data-sweep") == "running", what="running")
        advance(page, STEP_MAX_MS * 1.5)
        click(page.get_by_role("table", name="Columns").get_by_role("button", name="member_ssn", exact=True))
        wait_ui(page, lambda: node(page, "mart.member_risk.member_key").count() == 1, what="refocused")
        advance(page, SWEEP_MAX_MS)
        assert all(node(page, r["column"]).get_attribute("data-lit") == "false" for r in lin["reached"])
        old = lineage(dana, SEED_FOCUS).json()["summary"]
        assert old not in said(status(page, "Trace summary"))
        click(cv.get_by_role("button", name="Trace impact", exact=True))
        spin(page, lambda: cv.get_attribute("data-sweep") == "running", what="second sweep")
        step = min(STEP_MAX_MS, STEP_BUDGET_MS / lin["totals"]["hops"])
        advance(page, step * 1.5)
        page.set_viewport_size(PHONE)
        advance(page, step * 0.5)
        click(page.get_by_role("button", name="Lineage", exact=True))
        advance(page, step * 0.25)
        rail = page.get_by_role("complementary", name="Lineage")
        hop1 = [r["column"] for r in lin["reached"] if r["hop"] == 1]
        hop3 = [r["column"] for r in lin["reached"] if r["hop"] == 3]
        spin(page, lambda: node(page, hop1[0]).count() == 1, what="hop list rebuilt")
        assert node(page, hop1[0]).get_attribute("data-lit") == "true"
        assert node(page, hop3[0]).get_attribute("data-lit") == "false"
        advance(page, SWEEP_MAX_MS)
        assert rail.get_attribute("data-sweep") == "done"
        assert said(status(page, "Trace summary")).count(lin["summary"]) == 1


def test_wf_impact_sweep_keyboard(browser, app_url):
    with ui(browser, app_url, Api(app_url, DANA), f"/catalog?asset=src.claims_legacy&column={SEED_FOCUS}") as page:
        cv = canvas(page)
        wait_ui(page, lambda: node(page, "dash.risk_outreach.risk_score").count() == 1, 15, "canvas")
        node(page, SEED_FOCUS).focus()
        for key, expected in (("ArrowRight", "stg.member_claims.paid_amount"), ("ArrowRight", "mart.claims_by_region.total_paid"),
                              ("ArrowDown", "scr.risk_scores.risk_score"), ("ArrowRight", "mart.member_risk.risk_score"),
                              ("ArrowUp", "dash.claims_overview.total_paid"), ("ArrowRight", "dash.risk_outreach.risk_score"),
                              ("Home", SEED_FOCUS), ("End", "dash.risk_outreach.risk_score"), ("Home", SEED_FOCUS)):
            page.keyboard.press(key)
            advance(page, 50)
            assert focus_column(page) == expected, key
        assert sum(m["tabbable"] for m in marks(cv, "data-column")) == 1
        page.keyboard.press("ArrowRight")
        advance(page, 50)
        target = "stg.member_claims.paid_amount"
        page.keyboard.press("Enter")
        heading = page.get_by_role("region", name="Column detail").get_by_role("heading", name=target, exact=True)
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("column") == [target] and has_focus(heading), what="Enter opens")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: focus_column(page) == target, what="Escape back to node")
        assert node(page, target).get_attribute("data-selected") == "true"
        assert page.evaluate("document.activeElement !== document.body")


def test_wf_impact_sweep_zoom_keys(browser, app_url):
    with ui(browser, app_url, Api(app_url, DANA), f"/catalog?asset=src.claims_legacy&column={SEED_FOCUS}", TABLET) as page:
        cv = canvas(page)
        wait_ui(page, lambda: node(page, "dash.risk_outreach.risk_score").count() == 1, 15, "canvas")
        node(page, SEED_FOCUS).focus()
        page.keyboard.press("0")
        advance(page, 50)
        assert (cv.get_attribute("data-zoom"), cv.get_attribute("data-pan-x"), cv.get_attribute("data-pan-y")) == ("1.00", "0", "0")
        content = marks(cv, "data-canvas-content")[0]["box"]
        page.keyboard.press("+")
        page.keyboard.press("=")
        advance(page, 50)
        assert cv.get_attribute("data-zoom") == "1.50"
        assert abs(int(cv.get_attribute("data-pan-x")) + content["width"] / 4) <= PAN_TOL_PX + 0.5
        assert abs(int(cv.get_attribute("data-pan-y")) + content["height"] / 4) <= PAN_TOL_PX + 0.5
        page.keyboard.press("-")
        advance(page, 50)
        stepped = f"{1 + ZOOM_STEP:.2f}"
        assert cv.get_attribute("data-zoom") == stepped
        assert abs(int(cv.get_attribute("data-pan-x")) + content["width"] / 8) <= PAN_TOL_PX + 0.5
        page.keyboard.press("End")
        advance(page, 50)
        box = node(page, "dash.risk_outreach.risk_score").bounding_box()
        inset = {"x": content["x"] + INSET_PX, "y": content["y"] + INSET_PX,
                 "width": content["width"] - 2 * INSET_PX, "height": content["height"] - 2 * INSET_PX}
        assert inside(box, inset, PAN_TOL_PX) and cv.get_attribute("data-zoom") == stepped
        assert page.evaluate("document.activeElement !== document.body")


def test_wf_impact_sweep_touch(browser, app_url):
    with ui(browser, app_url, Api(app_url, LENA), f"/catalog?asset=src.claims_legacy&column={SEED_FOCUS}", TABLET) as page:
        cv = canvas(page)
        wait_ui(page, lambda: node(page, "dash.risk_outreach.risk_score").count() == 1, 15, "canvas")
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 2})

        def touch(kind, points):
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})
            advance(page, 16)

        strip = marks(cv, "data-canvas-strip")[0]["box"]
        sx, sy = strip["x"] + strip["width"] / 2, strip["y"] + strip["height"] / 2
        touch("touchStart", [(sx, sy)])
        for i in range(1, 5):
            touch("touchMove", [(sx + 10 * i, sy - 7.5 * i)])
        touch("touchEnd", [])
        assert abs(int(cv.get_attribute("data-pan-x")) - 40) <= PAN_TOL_PX
        assert abs(int(cv.get_attribute("data-pan-y")) + 30) <= PAN_TOL_PX
        click(cv.get_by_role("button", name="Reset view", exact=True))
        zb = cv.get_by_role("button", name="Zoom in", exact=True).bounding_box()
        hx, hy = zb["x"] + zb["width"] / 2, zb["y"] + zb["height"] / 2
        touch("touchStart", [(hx, hy)])
        touch("touchMove", [(hx + 30, hy + 30)])
        touch("touchEnd", [])
        assert (cv.get_attribute("data-pan-x"), cv.get_attribute("data-pan-y")) == ("0", "0")
        content = marks(cv, "data-canvas-content")[0]["box"]
        mx, my = content["x"] + content["width"] * 0.6, content["y"] + content["height"] * 0.5
        touch("touchStart", [(mx - 20, my), (mx + 20, my)])
        for d in (60, 120, 200, 300):
            touch("touchMove", [(mx - d, my), (mx + d, my)])
        touch("touchEnd", [])
        assert cv.get_attribute("data-zoom") == "2.00"
        assert abs(int(cv.get_attribute("data-pan-x")) + (mx - content["x"])) <= PAN_TOL_PX + 0.5
        assert abs(int(cv.get_attribute("data-pan-y")) + (my - content["y"])) <= PAN_TOL_PX + 0.5


def test_wf_impact_sweep_reduced_motion(browser, app_url):
    lin = lineage(Api(app_url, DANA), SEED_FOCUS).json()
    with ui(browser, app_url, Api(app_url, DANA), f"/catalog?asset=src.claims_legacy&column={SEED_FOCUS}", reduced=True) as page:
        main = page.get_by_role("main")
        cv = canvas(page)
        wait_ui(page, lambda: node(page, "dash.risk_outreach.risk_score").count() == 1, 15, "canvas")
        assert main.get_attribute("data-motion") == "reduced"
        record(status(page, "Trace summary"))
        click(cv.get_by_role("button", name="Trace impact", exact=True))
        spin(page, lambda: cv.get_attribute("data-sweep") == "done", what="done at once")
        assert mark_text(cv, "data-sweep-count") == str(lin["totals"]["columns"])
        for r in lin["reached"]:
            n = node(page, r["column"])
            assert n.get_attribute("data-lit") == "true" and mark_text(n, "data-hop-badge") == str(r["hop"])
        assert marks(node(page, SEED_FOCUS), "data-hop-badge") == []
        assert len(marks(cv, "data-cycle")) == 1
        assert page.evaluate("document.getAnimations().length") == 0
        spin(page, lambda: said(status(page, "Trace summary")).count(lin["summary"]) == 1, what="summary once")
        page.emulate_media(reduced_motion="no-preference")
        spin(page, lambda: main.get_attribute("data-motion") == "full", what="followed live")
        page.emulate_media(reduced_motion="reduce")
        spin(page, lambda: main.get_attribute("data-motion") == "reduced", what="followed live back")


def test_verify_with_evidence_acceptance(app_url):
    steward = make_user(app_url, "Steward")
    cases = [
        ("", b"", None, "evidence", "Attach a PDF or text sign-off."),
        ("big.pdf", pdf_bytes(EVIDENCE_MAX + 1), None, "evidence", "Evidence must be 5,000,000 bytes or smaller."),
        ("n" * (FILENAME_MAX - 3) + ".pdf", pdf_bytes(), None, "evidence", "Evidence filename must be 200 characters or fewer."),
        ("a/b.pdf", pdf_bytes(), None, "evidence", "Evidence filename cannot contain / or \\."),
        ("sign\toff.pdf", pdf_bytes(), None, "evidence", "Evidence filename cannot contain control characters."),
        ("signoff.docx", pdf_bytes(), None, "evidence", "Evidence must be a .pdf or .txt file."),
        ("signoff.pdf", pdf_bytes(), "n" * (NOTE_MAX + 1), "note", "Note must be 500 characters or fewer."),
    ]
    aid = register(steward, ["c1"])
    for name, data, note, field, msg in cases:
        r = verify(steward, aid, name, data, note)
        assert r.status_code == 422, name
        assert r.json()["error"]["fields"][field] == msg
    assert asset(steward, aid)["state"] == "draft" and S3().keys(f"evidence/{aid}/") == []
    for name, data, ctype in (("📄" * (FILENAME_MAX - 4) + ".PDF", pdf_bytes(EVIDENCE_MAX), "application/pdf"),
                              ("signoff.txt", "\ufeffSigned off by the privacy officer.".encode(), "text/plain; charset=utf-8")):
        target = register(steward, ["c1"])
        r = verify(steward, target, name, data, "📝" * NOTE_MAX)
        assert r.status_code == 200, r.text
        detail = r.json()
        assert detail["state"] == "verified" and detail["evidence"]["filename"] == name
        assert detail["evidence"]["content_type"] == ctype and detail["evidence"]["size_bytes"] == len(data)
        assert detail["verified_at"] == detail["evidence"]["uploaded_at"]
        assert detail["evidence"]["uploaded_by"] == {"id": steward.user["id"], "name": steward.user["name"]}


def test_evidence_stored_as_submitted(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    data = pdf_bytes(123_457)
    r = verify(steward, aid, "Sign-off – Privacy Officer №3.pdf", data, "Signed.")
    assert r.status_code == 200
    keys = S3().keys(f"evidence/{aid}/")
    assert len(keys) == 1 and re.fullmatch(rf"evidence/{re.escape(aid)}/[0-9a-f-]{{36}}", keys[0])
    assert S3().get(keys[0]) == data
    assert r.json()["evidence"]["sha256"] == hashlib.sha256(data).hexdigest()
    row = audit_rows(Postgres(), aid, "certification.verify")[0]
    assert row["after"] == {"state": "verified", "evidence_sha256": hashlib.sha256(data).hexdigest(),
                            "filename": "Sign-off – Privacy Officer №3.pdf", "content_type": "application/pdf", "size_bytes": len(data)}
    assert row["before"] == {"state": "draft"}
    other = register(steward, ["c1"])
    body, ctype = multipart("signoff.pdf", pdf_bytes(400_000))

    def broken():
        yield body[:200_000]
        raise RuntimeError("client dropped")

    with pytest.raises(Exception):
        steward.c.post(f"/api/assets/{enc(other)}/verify", content=broken(),
                       headers={"Content-Type": ctype, "Content-Length": str(len(body))})
    poll(lambda: S3().keys(f"evidence/{other}/") == [] and asset(steward, other)["state"] == "draft", RELEASE_S, "nothing kept")
    assert audit_rows(Postgres(), other) == [audit_rows(Postgres(), other)[0]] and audit_rows(Postgres(), other)[0]["action"] == "asset.register"


@pytest.fixture
def evidence_asset(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    data = bytes(range(256)) * 19 + b"%PDF-tail"
    name = "Sign-off – Privacy Officer №3.pdf"
    assert verify(steward, aid, name, data).status_code == 200
    return steward, aid, data, name


def test_evidence_download_headers(app_url, evidence_asset):
    _, aid, data, name = evidence_asset
    sha = hashlib.sha256(data).hexdigest()
    analyst = make_user(app_url, "Analyst")
    path = f"/api/assets/{enc(aid)}/evidence"
    r = analyst.get(path)
    assert r.status_code == 200 and r.content == data
    h = r.headers
    assert h["cache-control"] == "private, no-store" and h["accept-ranges"] == "bytes" and h["etag"] == f'"{sha}"'
    assert h["content-disposition"] == disposition(name)
    assert h["content-type"] == "application/pdf" and int(h["content-length"]) == len(data)
    head = analyst.c.head(path)
    assert head.status_code == 200 and head.content == b"" and head.headers["etag"] == h["etag"]
    for inm in (f'"{sha}"', f'W/"{sha}"', "*", f'"other", "{sha}"'):
        nm = analyst.get(path, headers={"If-None-Match": inm})
        assert nm.status_code == 304 and nm.content == b"" and nm.headers["etag"] == f'"{sha}"'
    one = analyst.get(path, headers={"Range": "bytes=10-19"})
    assert one.status_code == 206 and one.content == data[10:20]
    assert one.headers["content-range"] == f"bytes 10-19/{len(data)}"
    tail = analyst.get(path, headers={"Range": f"bytes=-{len(data) * 2}"})
    assert tail.status_code == 206 and tail.content == data
    assert analyst.get(path, headers={"Range": "bytes=5-", "If-Range": f'"{sha}"'}).content == data[5:]
    for ir in (f'W/"{sha}"', "Wed, 21 Oct 2015 07:28:00 GMT", '"other"'):
        ignored = analyst.get(path, headers={"Range": "bytes=5-", "If-Range": ir})
        assert ignored.status_code == 200 and ignored.content == data
    for rng in ("bytes=9-3", "items=0-1", "bytes=" + ",".join(["0-0"] * 11)):
        assert analyst.get(path, headers={"Range": rng}).status_code == 200
    bad = analyst.get(path, headers={"Range": f"bytes={len(data)}-"})
    assert bad.status_code == 416 and bad.headers["content-range"] == f"bytes */{len(data)}"
    assert bad.json() == {"error": {"code": "range_not_satisfiable", "message": "Requested range is outside the evidence file."}}
    viewer = make_user(app_url, "Viewer").get(path)
    assert viewer.status_code == 403 and viewer.json() == ERR_403
    key = S3().keys(f"evidence/{aid}/")[0]
    assert key not in r.headers.get("location", "") and all(key not in v for v in r.headers.values())


def test_evidence_multiple_ranges(app_url, evidence_asset):
    _, aid, data, _ = evidence_asset
    size = len(data)
    api = make_user(app_url, "Analyst")
    path = f"/api/assets/{enc(aid)}/evidence"
    single = api.get(path, headers={"Range": "BYTES=0-0,0-0"})
    assert single.status_code == 206 and single.content == data[:1] and single.headers["content-range"] == f"bytes 0-0/{size}"
    abut = api.get(path, headers={"Range": "bytes=0-9, 10-19"})
    assert abut.status_code == 206 and abut.content == data[:20]
    r = api.get(path, headers={"Range": "bytes=300-, 0-99,50-149, -5"})
    assert r.status_code == 206
    m = re.fullmatch(r"multipart/byteranges; boundary=([A-Za-z0-9]{16,70})", r.headers["content-type"])
    assert m
    b = m.group(1).encode()
    expected = b"".join(b"--" + b + b"\r\nContent-Type: application/pdf\r\nContent-Range: bytes " + f"{a}-{z}/{size}".encode()
                        + b"\r\n\r\n" + data[a:z + 1] + b"\r\n" for a, z in ((0, 149), (300, size - 1))) + b"--" + b + b"--\r\n"
    assert r.content == expected and int(r.headers["content-length"]) == len(expected)
    rows = audit_rows(Postgres(), aid, "evidence.download")
    assert rows[-1]["after"]["range"] == f"0-149,300-{size - 1}"


BIG_EVIDENCE = 4_900_000


def test_evidence_access_logging(app_url, evidence_asset):
    steward, aid, data, _ = evidence_asset
    sha = hashlib.sha256(data).hexdigest()
    api = make_user(app_url, "Analyst")
    path = f"/api/assets/{enc(aid)}/evidence"
    pg = Postgres()
    count = lambda: len(audit_rows(pg, aid, "evidence.download"))
    base = count()
    api.get(path)
    api.get(path, headers={"Range": "bytes=1024-"})
    rows = audit_rows(pg, aid, "evidence.download")[-2:]
    assert [r["after"] for r in rows] == [{"evidence_sha256": sha, "range": None},
                                          {"evidence_sha256": sha, "range": f"1024-{len(data) - 1}"}]
    assert rows[0]["actor_role"] == "Analyst" and rows[0]["before"] is None
    api.c.head(path)
    api.get(path, headers={"If-None-Match": f'"{sha}"'})
    api.get(path, headers={"Range": f"bytes={len(data) + 5}-"})
    make_user(app_url, "Viewer").get(path)
    assert count() == base + 2
    big = register(steward, ["v"])
    assert verify(steward, big, "big-signoff.pdf", pdf_bytes(BIG_EVIDENCE)).status_code == 200
    big_path = f"/api/assets/{enc(big)}/evidence"
    big_count = lambda: len(audit_rows(pg, big, "evidence.download"))
    for i in range(ABORT_ROUNDS):
        with api.c.stream("GET", big_path) as resp:
            assert resp.status_code == 200
            assert big_count() == i + 1, "download row not committed before the body"
    assert big_count() == ABORT_ROUNDS
    assert count() == base + 2
    poll(lambda: pg.rows("select count(*) as n from pg_stat_activity where datname = current_database() and usename <> current_user "
                         "and (state like 'idle in transaction%' or (state = 'active' and now() - query_start > interval '5 seconds'))")[0]["n"] == 0,
         RELEASE_S + INFRA_SLACK_S, "no app session left in a transaction")
    started = time.monotonic()
    assert httpx.get(app_url + "/api/health").status_code == 200 and time.monotonic() - started < HEALTH_BUDGET_S


def test_idempotency_keys(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    key = ikey()
    data = pdf_bytes()
    first = verify(steward, aid, "signoff.pdf", data, "n", key)
    again = verify(steward, aid, "signoff.pdf", data, "n", key)
    assert first.status_code == again.status_code == 200 and again.json() == first.json()
    assert len(S3().keys(f"evidence/{aid}/")) == 1
    assert len(audit_rows(Postgres(), aid, "certification.verify")) == 1
    diff = verify(steward, aid, "signoff.pdf", data, "changed", key)
    assert diff.status_code == 409 and diff.json() == {"error": {"code": "idempotency_conflict", "message": "This Idempotency-Key was already used with a different request."}}
    bad = verify(steward, aid, "signoff.pdf", data, None, "bad key!")
    assert bad.status_code == 422 and bad.json()["error"]["fields"]["idempotency_key"] == "Use 1 to 100 letters, digits, hyphens or underscores."
    slow = register(steward, ["c1"])
    k2 = ikey()
    body, ctype = multipart("signoff.pdf", pdf_bytes(300_000))
    started, gate = threading.Event(), threading.Event()

    def gen():
        yield body[:1024]
        started.set()
        gate.wait(30)
        yield body[1024:]

    with cf.ThreadPoolExecutor(1) as ex:
        fut = ex.submit(lambda: steward.clone().c.post(f"/api/assets/{enc(slow)}/verify", content=gen(),
                                                       headers={"Content-Type": ctype, "Content-Length": str(len(body)), "Idempotency-Key": k2}))
        assert started.wait(30)
        busy = poll(lambda: (lambda r: r if r.status_code == 409 else None)(
            verify(steward, slow, "signoff.pdf", pdf_bytes(300_000), None, k2)), 10, "in-progress refusal")
        assert busy.json() == {"error": {"code": "idempotency_in_progress", "message": "A request with this Idempotency-Key is still in progress. Retry shortly."}}
        gate.set()
        assert fut.result().status_code == 200
    assert len(S3().keys(f"evidence/{slow}/")) == 1
    dep = register(steward, ["c1"])
    dk = ikey()
    d1 = steward.post(f"/api/assets/{enc(dep)}/deprecate", json={"reason": "Retired."}, key=dk)
    assert admin(app_url).patch(f"/api/users/{steward.user['id']}", {"role": "Analyst"}).status_code == 200
    d2 = steward.post(f"/api/assets/{enc(dep)}/deprecate", json={"reason": "Retired."}, key=dk)
    assert d2.status_code == 200 and d2.json() == d1.json()
    assert steward.post(f"/api/assets/{enc(dep)}/deprecate", json={"reason": "Other."}, key=dk).json() == ERR_403
    assert len(audit_rows(Postgres(), dep, "certification.deprecate")) == 1


def test_wf_verify_evidence_dialog(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    data = pdf_bytes(2048)
    with ui(browser, app_url, steward, f"/catalog?asset={aid}") as page:
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("button", name="Verify", exact=True).is_visible(), what="Verify")
        click(detail.get_by_role("button", name="Verify", exact=True))
        dialog = page.get_by_role("dialog", name="Verify asset")
        field = dialog.get_by_label("Evidence file", exact=True)
        wait_ui(page, lambda: has_focus(field), what="focus on first field")
        record(status(page, "Activity"))
        for _ in range(6):
            page.keyboard.press("Tab")
            assert dialog.evaluate("el => el.contains(document.activeElement)")
        field.set_input_files(files=[{"name": "privacy-signoff.pdf", "mimeType": "application/pdf", "buffer": data}])
        fill(dialog.get_by_role("textbox", name="Note"), "Signed by the privacy officer.")
        click(dialog.get_by_role("button", name="Verify asset", exact=True))
        wait_ui(page, lambda: said(status(page, "Activity")).count(f"Verified. Evidence stored as {EVIDENCE_NAME}.") == 1,
                what="verify copy")
        wait_ui(page, lambda: dialog.count() == 0, what="dialog closed")
        assert detail.get_by_role("link", name="Download evidence").inner_text().strip() == EVIDENCE_NAME
        assert "verified" in detail.inner_text()
        click(detail.get_by_role("button", name="Deprecate", exact=True))
        ddialog = page.get_by_role("dialog", name="Deprecate asset")
        reason = ddialog.get_by_role("textbox", name="Reason")
        wait_ui(page, lambda: has_focus(reason), what="reason focus")
        for _ in range(5):
            page.keyboard.press("Tab")
            assert ddialog.evaluate("el => el.contains(document.activeElement)")
        fill(reason, "Retired after the claims migration.")
        click(ddialog.get_by_role("button", name="Deprecate asset", exact=True))
        wait_ui(page, lambda: said(status(page, "Activity")).count(f"Deprecated. Downstream owner notices queued: {0}.") == 1,
                what="deprecate copy")
        assert "deprecated" in detail.inner_text()
    keys = S3().keys(f"evidence/{aid}/")
    assert len(keys) == 1 and S3().get(keys[0]) == data and asset(steward, aid)["state"] == "deprecated"


def test_wf_verify_evidence_field_errors(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["c1"])
    data = pdf_bytes(2048)
    with ui(browser, app_url, steward, f"/catalog?asset={aid}") as page:
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("button", name="Verify", exact=True).is_visible(), what="Verify")
        click(detail.get_by_role("button", name="Verify", exact=True))
        dialog = page.get_by_role("dialog", name="Verify asset")
        field = dialog.get_by_label("Evidence file", exact=True)
        note = dialog.get_by_role("textbox", name="Note")
        record(dialog.get_by_role("status", name="Dialog status"))
        field.set_input_files(files=[{"name": "signoff.docx", "mimeType": "application/octet-stream", "buffer": data}])
        fill(note, "n" * (NOTE_MAX + 1))
        click(dialog.get_by_role("button", name="Verify asset", exact=True))
        msg = "Evidence must be a .pdf or .txt file."
        wait_ui(page, lambda: field.get_attribute("aria-invalid") == "true", what="field marked")
        assert described(field) == msg and has_focus(field)
        assert note.get_attribute("aria-invalid") == "true" and described(note) == "Note must be 500 characters or fewer."
        assert said(dialog.get_by_role("status", name="Dialog status")).count(msg) == 1
        field.set_input_files(files=[{"name": "privacy-signoff.pdf", "mimeType": "application/pdf", "buffer": data}])
        assert field.get_attribute("aria-invalid") == "true"
        fill(note, "Signed.")
        click(dialog.get_by_role("button", name="Verify asset", exact=True))
        wait_ui(page, lambda: dialog.count() == 0, what="dialog closed")
    assert asset(steward, aid)["state"] == "verified"


def test_wf_verify_evidence_download(browser, app_url, evidence_asset):
    _, aid, data, name = evidence_asset
    pg = Postgres()
    before = len(audit_rows(pg, aid, "evidence.download"))
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?asset={aid}") as page:
        link_el = page.get_by_role("link", name="Download evidence")
        wait_ui(page, lambda: link_el.is_visible(), 15, "evidence link")
        assert link_el.inner_text().strip() == name
        href = link_el.get_attribute("href")
        assert urlparse(page.url).netloc == (urlparse(href).netloc or urlparse(page.url).netloc)
        with page.expect_download() as info:
            click(link_el)
        download = info.value
        assert download.suggested_filename == name and Path(download.path()).read_bytes() == data
    with ui(browser, app_url, make_user(app_url, "Viewer"), f"/catalog?asset={aid}") as page:
        wait_ui(page, lambda: page.get_by_role("region", name="Asset detail").get_by_role("heading", name=aid).count() == 1, 15, "detail")
        assert page.get_by_role("link", name="Download evidence").count() == 0
    assert len(audit_rows(pg, aid, "evidence.download")) == before + 1


def test_verification_blocked_by_deprecated_upstream(app_url):
    steward = make_user(app_url, "Steward")
    a, b, c = (register(steward, ["v"]) for _ in range(3))
    link(steward, [(f"{a}.v", f"{b}.v", "copy"), (f"{b}.v", f"{c}.v", "copy")])
    steward.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired."}, key=ikey())
    r = verify(steward, c, "signoff.pdf", pdf_bytes())
    assert r.status_code == 409 and r.json() == {"error": {"code": "upstream_deprecated", "message": f"Verification blocked: upstream {a} is deprecated."}}
    assert S3().keys(f"evidence/{c}/") == [] and audit_rows(Postgres(), c, "certification.verify") == []
    pg = Postgres()
    for _ in range(3):
        up, down = register(steward, ["v"]), register(steward, ["v"])
        link(steward, [(f"{up}.v", f"{down}.v", "copy")])
        v, d = parallel([lambda: verify(steward, down, "signoff.pdf", pdf_bytes()),
                         lambda: steward.post(f"/api/assets/{enc(up)}/deprecate", json={"reason": "Race."}, key=ikey())])
        assert d.status_code == 200
        if v.status_code == 200:
            vs = audit_rows(pg, down, "certification.verify")[0]["seq"]
            ds = audit_rows(pg, up, "certification.deprecate")[0]["seq"]
            assert vs < ds and asset(steward, down)["state"] == "verified"
        else:
            assert v.status_code == 409 and v.json()["error"]["code"] == "upstream_deprecated"
            poll(lambda: S3().keys(f"evidence/{down}/") == [], RELEASE_S, "object removed")
            assert audit_rows(pg, down, "certification.verify") == []


def test_deprecated_upstream_warning_nearest(app_url):
    steward = make_user(app_url, "Steward")
    ids = sorted(register(steward, ["v"]) for _ in range(4))
    far, near_lo, near_hi, leaf = ids[0], ids[1], ids[2], ids[3]
    link(steward, [(f"{far}.v", f"{near_hi}.v", "copy"), (f"{near_hi}.v", f"{leaf}.v", "copy"),
                   (f"{near_lo}.v", f"{leaf}.v", "copy"), (f"{leaf}.v", f"{far}.v", "copy")])
    for x in (far, near_lo, near_hi):
        assert steward.post(f"/api/assets/{enc(x)}/deprecate", json={"reason": "Retired."}, key=ikey()).status_code == 200
    assert asset(steward, leaf)["deprecated_upstream"] == near_lo
    assert asset(steward, far)["deprecated_upstream"] == near_lo
    assert asset(steward, near_lo)["deprecated_upstream"] is None
    assert [r for r in search(steward, q=leaf).json()["results"]][0]["deprecated_upstream"] == near_lo


def test_certification_transitions(app_url):
    steward = make_user(app_url, "Steward")
    a, b = register(steward, ["v"]), register(steward, ["v"])
    link(steward, [(f"{a}.v", f"{b}.v", "copy")])
    assert verify(steward, a, "signoff.pdf", pdf_bytes()).status_code == 200
    again = verify(steward, a, "signoff.pdf", pdf_bytes())
    assert again.status_code == 409 and again.json()["error"]["code"] == "invalid_transition"
    assert again.json()["error"]["message"].startswith(f"Cannot move {a} from verified to ")
    re_draft = admin(app_url).post(f"/api/assets/{enc(a)}/reinstate", json={})
    assert re_draft.status_code == 409 and re_draft.json()["error"]["message"].startswith(f"Cannot move {a} from verified to ")
    assert steward.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired."}).status_code == 200
    assert asset(steward, b)["deprecated_upstream"] == a
    twice = steward.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired."})
    assert twice.status_code == 409 and twice.json()["error"]["message"].startswith(f"Cannot move {a} from deprecated to ")
    assert steward.post(f"/api/assets/{enc(a)}/reinstate", json={}).json() == ERR_403
    r = admin(app_url).post(f"/api/assets/{enc(a)}/reinstate", json={})
    assert r.status_code == 200
    body = r.json()["asset"]
    assert (body["state"], body["evidence"], body["verified_at"], body["deprecation"]) == ("draft", None, None, None)
    assert asset(steward, b)["deprecated_upstream"] is None
    assert verify(steward, b, "signoff.pdf", pdf_bytes()).status_code == 200
    assert len(S3().keys(f"evidence/{a}/")) == 1


def test_wf_verify_blocked_open_dialog(browser, app_url):
    rui = make_user(app_url, "Steward")
    dana = make_user(app_url, "Steward")
    a, b = register(rui, ["v"]), register(rui, ["v"])
    link(rui, [(f"{a}.v", f"{b}.v", "copy")])
    keys_sent: list[str] = []
    with ui(browser, app_url, dana, f"/catalog?asset={b}") as page:
        page.on("request", lambda r: keys_sent.append(r.headers.get("idempotency-key", "")) if r.method == "POST" and r.url.endswith("/verify") else None)
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("button", name="Verify", exact=True).is_visible(), what="Verify")
        click(detail.get_by_role("button", name="Verify", exact=True))
        dialog = page.get_by_role("dialog", name="Verify asset")
        field = dialog.get_by_label("Evidence file", exact=True)
        note_box = dialog.get_by_role("textbox", name="Note")
        field.set_input_files(files=[{"name": "signoff.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()}])
        fill(note_box, "Signed by privacy.")
        note_box.focus()
        rui.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired."}, key=ikey())
        note = page.get_by_role("note", name="Deprecated upstream")
        wait_ui(page, lambda: note.count() == 1, what="warning behind dialog")
        assert f"Upstream {a} is deprecated. Values here may stop updating." in note.inner_text()
        assert dialog.is_visible() and field.evaluate("el => el.files.length") == 1
        assert note_box.input_value() == SIGNED_NOTE and has_focus(note_box)
        submit = dialog.get_by_role("button", name="Verify asset", exact=True)
        click(submit)
        status_box = dialog.get_by_role("status", name="Dialog status")
        wait_ui(page, lambda: status_box.inner_text().strip() == f"Verification blocked: upstream {a} is deprecated.", what="refusal")
        note_box.focus()
        admin(app_url).post(f"/api/assets/{enc(a)}/reinstate", json={})
        wait_ui(page, lambda: note.count() == 0, what="warning cleared")
        assert dialog.is_visible() and field.evaluate("el => el.files.length") == 1
        assert note_box.input_value() == SIGNED_NOTE and has_focus(note_box)
        click(submit)
        wait_ui(page, lambda: dialog.count() == 0, what="verified")
    assert len(keys_sent) == 2 and keys_sent[0] and keys_sent[0] == keys_sent[1]
    assert asset(dana, b)["state"] == "verified"


def test_wf_verify_blocked_keyboard(browser, app_url):
    rui = make_user(app_url, "Steward")
    dana = make_user(app_url, "Steward")
    a, b = register(rui, ["v"]), register(rui, ["v"])
    link(rui, [(f"{a}.v", f"{b}.v", "copy")])
    rui.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired."}, key=ikey())
    with ui(browser, app_url, dana, f"/catalog?asset={b}") as page:
        detail = page.get_by_role("region", name="Asset detail")
        verify_btn = detail.get_by_role("button", name="Verify", exact=True)
        note = page.get_by_role("note", name="Deprecated upstream")
        wait_ui(page, lambda: verify_btn.is_visible() and note.count() == 1, 15, "Verify and warning")
        verify_btn.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Verify asset")
        field = dialog.get_by_label("Evidence file", exact=True)
        wait_ui(page, lambda: has_focus(field), what="dialog focus")
        field.set_input_files(files=[{"name": "signoff.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()}])
        fill(dialog.get_by_role("textbox", name="Note"), "Signed by privacy.")
        submit = dialog.get_by_role("button", name="Verify asset", exact=True)
        submit.focus()
        page.keyboard.press("Enter")
        status_box = dialog.get_by_role("status", name="Dialog status")
        wait_ui(page, lambda: status_box.inner_text().strip() == f"Verification blocked: upstream {a} is deprecated.", what="refusal")
        assert has_focus(submit) and field.evaluate("el => el.files.length") == 1
        assert dialog.get_by_role("textbox", name="Note").input_value() == SIGNED_NOTE
        page.keyboard.press("Escape")
        wait_ui(page, lambda: has_focus(verify_btn), what="Escape back to Verify")
        admin(app_url).post(f"/api/assets/{enc(a)}/reinstate", json={})
        wait_ui(page, lambda: note.count() == 0, what="warning cleared")
        verify_btn.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: has_focus(field), what="reopened")
        field.set_input_files(files=[{"name": "signoff.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()}])
        submit.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: has_focus(detail.get_by_role("button", name="Deprecate", exact=True)), what="focus Deprecate")
        rui.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired again."}, key=ikey())
        wait_ui(page, lambda: note.count() == 1, what="warning back")
        note.get_by_role("link", name=a, exact=True).focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: f"asset={a}" in page.url and has_focus(page.get_by_role("region", name="Asset detail").get_by_role("heading", name=a, exact=True)),
                what="followed upstream link")
    assert asset(dana, b)["state"] == "verified"


def test_wf_verify_blocked_reaches_other_viewers(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["v"])
    name = "Privacy_officer_signoff_" + "x" * (FILENAME_MAX - 28) + ".pdf"
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?asset={aid}", PHONE) as page:
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("heading", name=aid).count() == 1, 15, "detail")
        assert verify(steward, aid, name, pdf_bytes()).status_code == 200
        link_el = detail.get_by_role("link", name="Download evidence")
        wait_ui(page, lambda: link_el.count() == 1 and "verified" in detail.inner_text(), what="verified live")
        for viewport in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(viewport)
            advance(page, 300)
            layout(page)
            assert inside(link_el.bounding_box(), detail.bounding_box())
        assert link_el.inner_text().strip() == name


def test_deprecate_with_reason_single_winner(app_url):
    steward = make_user(app_url, "Steward")
    owner = make_user(app_url, "Analyst")
    a = register(steward, ["v"])
    b = register(steward, ["v"], owner=owner.user["id"])
    link(steward, [(f"{a}.v", f"{b}.v", "copy")])
    empty = steward.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "   "})
    assert empty.status_code == 422 and empty.json()["error"]["fields"]["reason"] == "Give a reason of 1 to 500 characters."
    assert steward.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "r" * (NOTE_MAX + 1)}).status_code == 422
    extra = register(steward, ["v"])
    assert steward.post(f"/api/assets/{enc(extra)}/deprecate", json={"reason": "📝" * NOTE_MAX}).status_code == 200
    results = parallel([lambda: steward.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": REASON})] * PARALLEL)
    assert sorted(r.status_code for r in results) == [200] + [409] * (PARALLEL - 1)
    win = next(r for r in results if r.status_code == 200).json()
    assert win["notices_queued"] == 1 and isinstance(win["queued_notices"], int)
    assert win["asset"]["deprecation"]["reason"] == REASON and win["asset"]["state"] == "deprecated"
    assert len(audit_rows(Postgres(), a, "certification.deprecate")) == 1


def mails_for(mail, email: str, minimum: int = 1, seconds: float = NOTICE_S + INFRA_SLACK_S):
    def found():
        got = [m for m in mail.messages(settle=0) if any(email in a for a in addresses(m.get("To")))]
        return got if len(got) >= minimum else None

    poll(found, seconds, f"mail to {email}")
    return [m for m in mail.messages(settle=3) if any(email in a for a in addresses(m.get("To")))]


def test_notice_recipient_and_headers(app_url, mail):
    steward = make_user(app_url, "Steward")
    zee = make_user(app_url, "Analyst", name='O\'Brien, Ngozi "Zee" Ångström')
    a = register(steward, ["a1"])
    b = register(steward, ["b1"], owner=zee.user["id"])
    link(steward, [(f"{a}.a1", f"{b}.b1", "copy")])
    r = steward.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired after the claims migration."})
    assert r.json()["notices_queued"] == 1
    msgs = mails_for(mail, zee.user["email"])
    assert len(msgs) == 1
    m = msgs[0]
    assert len(m["To"]) == 1 and m["To"][0]["Name"] == 'O\'Brien, Ngozi "Zee" Ångström' and m["To"][0]["Address"] == zee.user["email"]
    assert m["Subject"] == f"Strata: {a} was deprecated"
    assert re.fullmatch(r"<?notice-[0-9a-f-]{36}@strata\.quarrystone\.test>?", m.get("MessageID", ""))
    assert mail_from_address() in json.dumps(m.get("From"))
    lines = mail_text(m).replace("\r\n", "\n").strip().split("\n")
    assert lines[:2] == [f"{a} was deprecated by {steward.user['name']}.", "Reason: Retired after the claims migration."]
    bad = admin(app_url).post("/api/users", json={"name": "Bad\u0007Name", "email": fresh_identity("ctl")[1], "role": "Viewer", "password": "x" * 12})
    assert bad.status_code == 422 and bad.json()["error"]["fields"]["name"] == "Use 1 to 80 characters without control characters."


def test_downstream_owner_notices(app_url, mail):
    steward = make_user(app_url, "Steward")
    zee = make_user(app_url, "Analyst")
    plain = make_user(app_url, "Analyst")
    a = register(steward, [("a1", ["secret-sample-a1"]), ("a2", ["secret-sample-a2"])])
    b = register(steward, [("b1", ["secret-sample-b1"]), ("b2", ["x"])], owner=zee.user["id"])
    c = register(steward, [("c1", ["secret-sample-c1"])], owner=zee.user["id"])
    d = register(steward, [("d1", ["secret-sample-d1"])], owner=plain.user["id"])
    link(steward, [(f"{a}.a1", f"{b}.b1", "copy"), (f"{b}.b1", f"{c}.c1", "copy"), (f"{a}.a2", f"{d}.d1", "hash")])
    dkey = ikey()
    dbody = {"reason": "Retired after the claims migration.\nUse stg.claims_2026 instead."}
    r = steward.post(f"/api/assets/{enc(a)}/deprecate", json=dbody, key=dkey)
    assert r.json()["notices_queued"] == 2
    replay = steward.post(f"/api/assets/{enc(a)}/deprecate", json=dbody, key=dkey)
    assert replay.status_code == 200 and replay.json() == r.json()
    assert len(audit_rows(Postgres(), a, "certification.deprecate")) == 1
    msgs = mails_for(mail, zee.user["email"])
    assert len(msgs) == 1
    m = msgs[0]
    lines = mail_text(m).replace("\r\n", "\n").strip().split("\n")
    expected = [f"{a} was deprecated by {steward.user['name']}.",
                "Reason: Retired after the claims migration. Use stg.claims_2026 instead.", "", "Your affected assets:"]
    for aid, col in sorted([(b, "b1"), (c, "c1")]):
        expected += [f"- {aid} - nearest deprecated upstream: {a}", f"  Columns: {col}"]
    assert lines == expected
    other = mails_for(mail, plain.user["email"])
    hashed_column = "d1"
    assert len(other) == 1 and f"  Columns: {hashed_column}" in mail_text(other[0])
    for msg in msgs + other:
        assert SECRET_SAMPLE not in json.dumps(msg) and "evidence/" not in mail_text(msg)


def test_cancelled_notices_never_sent(mail):
    base = APP_ISOLATED
    adm = Api(base, MORGAN)
    owner_name, owner_email = fresh_identity("owner")
    r = adm.post("/api/users", json={"name": owner_name, "email": owner_email, "role": "Analyst", "password": "isolated-pass-1"})
    assert r.status_code == 201
    a = register(adm, ["v"])
    b = register(adm, ["v"], owner=r.json()["user"]["id"])
    link(adm, [(f"{a}.v", f"{b}.v", "copy")])
    dep = adm.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired."}).json()
    assert dep["notices_queued"] == 1
    re_ = adm.post(f"/api/assets/{enc(a)}/reinstate", json={}).json()
    assert re_["notices_cancelled"] == 1 and re_["queued_notices"] == dep["queued_notices"] - 1
    row = Postgres("_isolated").rows(f"select after from audit_log where target_id = '{a}' and action = 'certification.reinstate'")
    assert row[0]["after"] == {"state": "draft", "notices_cancelled": 1}
    assert not [m for m in mail.messages(settle=NOTICE_S) if any(owner_email in x for x in addresses(m.get("To")))]
    assert adm.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Again."}).json()["notices_queued"] == 1


def test_wf_deprecate_notify_dialog(browser, app_url, mail):
    steward = make_user(app_url, "Steward")
    owner = make_user(app_url, "Analyst")
    a = register(steward, ["v"])
    b = register(steward, ["v"], owner=owner.user["id"])
    link(steward, [(f"{a}.v", f"{b}.v", "copy")])
    with ui(browser, app_url, steward, f"/catalog?asset={a}") as page:
        detail = page.get_by_role("region", name="Asset detail")
        opener = detail.get_by_role("button", name="Deprecate", exact=True)
        wait_ui(page, lambda: opener.is_visible(), what="Deprecate")
        click(opener)
        dialog = page.get_by_role("dialog", name="Deprecate asset")
        advance(page, TRANSITION_MS * 2)
        page.keyboard.press("Escape")
        advance(page, 1)
        click(opener)
        advance(page, TRANSITION_MS * 4)
        assert dialog.is_visible() and dialog.get_attribute("data-transition") == "open"
        assert has_focus(dialog.get_by_role("textbox", name="Reason"))
        record(status(page, "Activity"))
        fill(dialog.get_by_role("textbox", name="Reason"), "Retired after the claims migration.")
        click(dialog.get_by_role("button", name="Deprecate asset", exact=True))
        copy = "Deprecated. Downstream owner notices queued: 1."
        wait_ui(page, lambda: said(status(page, "Activity")).count(copy) == 1, what="success copy")
        wait_ui(page, lambda: has_focus(detail.get_by_role("heading", name=a, exact=True)), what="focus heading")
        advance(page, POLL_MS * 3)
        assert status(page, "Activity").inner_text().strip() == copy
    assert len(mails_for(mail, owner.user["email"])) == 1
    assert asset(steward, a)["state"] == "deprecated"


def test_wf_deprecate_notify_canvas_marks(browser, app_url):
    steward = make_user(app_url, "Steward")
    a, b, c = (register(steward, ["v"]) for _ in range(3))
    A, B, C = f"{a}.v", f"{b}.v", f"{c}.v"
    link(steward, [(A, B, "copy"), (B, C, "copy")])
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?asset={b}&column={enc(B)}") as page:
        wait_ui(page, lambda: node(page, C).count() == 1, 15, "canvas")
        sweep = canvas(page).get_attribute("data-sweep")
        steward.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired."}, key=ikey())
        wait_ui(page, lambda: node(page, A).get_attribute("data-deprecated") == "true", what="deprecated mark")
        wait_ui(page, lambda: all(node(page, x).get_attribute("data-deprecated-upstream") == a for x in (B, C)), what="downstream marks")
        assert mark_text(node(page, A), "data-deprecation-flag") == "D"
        assert mark_text(node(page, C), "data-deprecation-flag") == "D"
        assert canvas(page).get_attribute("data-sweep") == sweep
        admin(app_url).post(f"/api/assets/{enc(a)}/reinstate", json={})
        wait_ui(page, lambda: node(page, A).get_attribute("data-deprecated") == "false" and all(
            node(page, x).get_attribute("data-deprecated-upstream") == "" for x in (B, C)), what="marks cleared")
        assert marks(node(page, C), "data-deprecation-flag") == []


def test_service_status_reports(app_url):
    expected = {app_url: ("up", "up"), APP_EVIDENCE_DOWN: ("down", "up"), APP_MAIL_DOWN: ("up", "down"), APP_BOTH_DOWN: ("down", "down")}
    for base, (ev, ml) in expected.items():
        api = Api(base, LENA)
        body = poll(lambda: (lambda b: b if (b["evidence"], b["mail"]) == (ev, ml) else None)(api.get("/api/status").json()),
                    BANNER_S + INFRA_SLACK_S, f"status on {base}")
        assert set(body) == {"evidence", "mail", "queued_notices"} and isinstance(body["queued_notices"], int)


def test_evidence_outage_keeps_draft(app_url):
    steward = make_user(app_url, "Steward")
    down = Api(APP_EVIDENCE_DOWN, steward.user["email"], steward.password)
    aid = register(down, ["v"])
    r = verify(down, aid, "signoff.pdf", pdf_bytes())
    assert r.status_code == 503 and r.json() == EVIDENCE_503
    assert asset(down, aid)["state"] == "draft" and S3().keys(f"evidence/{aid}/") == []
    assert search(down, q=aid).json()["total"] == 1
    assert tag(down, f"{aid}.v", "PII").status_code == 201
    assert audit_rows(Postgres(), aid, "certification.verify") == []


def test_queued_notices_delivered_once(app_url, mail):
    steward = make_user(app_url, "Steward")
    owner = make_user(app_url, "Analyst")
    replica = Api(APP_MAIL_DOWN, steward.user["email"], steward.password)
    a = register(replica, ["v"])
    b = register(replica, ["v"], owner=owner.user["id"])
    link(replica, [(f"{a}.v", f"{b}.v", "copy")])
    r = replica.post(f"/api/assets/{enc(a)}/deprecate", json={"reason": "Retired."})
    assert r.status_code == 200 and r.json()["notices_queued"] == 1 and r.json()["queued_notices"] >= 1
    msgs = mails_for(mail, owner.user["email"], 1, NOTICE_S * 2)
    assert len(msgs) == 1
    assert re.fullmatch(r"<?notice-[0-9a-f-]{36}@strata\.quarrystone\.test>?", msgs[0].get("MessageID", ""))
    assert len([m for m in mail.messages(settle=NOTICE_S) if any(owner.user["email"] in x for x in addresses(m.get("To")))]) == 1


@contextmanager
def verify_503(browser, app_url):
    steward = make_user(app_url, "Steward")
    down = Api(APP_EVIDENCE_DOWN, steward.user["email"], steward.password)
    aid = register(down, ["v"])
    keys_sent: list[str] = []
    with ui(browser, APP_EVIDENCE_DOWN, down, f"/catalog?asset={aid}") as page:
        page.on("request", lambda r: keys_sent.append(r.headers.get("idempotency-key", "")) if r.method == "POST" and r.url.endswith("/verify") else None)
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("button", name="Verify", exact=True).is_visible(), 15, "Verify")
        record(detail)
        click(detail.get_by_role("button", name="Verify", exact=True))
        dialog = page.get_by_role("dialog", name="Verify asset")
        field = dialog.get_by_label("Evidence file", exact=True)
        field.set_input_files(files=[{"name": "signoff.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()}])
        fill(dialog.get_by_role("textbox", name="Note"), OUTAGE_NOTE)
        submit = dialog.get_by_role("button", name="Verify asset", exact=True)
        click(submit)
        status_box = dialog.get_by_role("status", name="Dialog status")
        spin(page, lambda: status_box.inner_text().strip() == EVIDENCE_503["error"]["message"], what="503 copy")
        yield {"page": page, "detail": detail, "dialog": dialog, "field": field, "submit": submit,
               "status": status_box, "keys": keys_sent, "aid": aid, "api": steward}


def test_wf_outage_recovery_verify_503(browser, app_url):
    with verify_503(browser, app_url) as v:
        page = v["page"]
        advance(page, BANNER_503_MS)
        banner = page.get_by_role("alert", name="Evidence storage outage")
        assert banner.count() == 1 and "Evidence storage is unreachable. Verification is paused; everything else works." in banner.inner_text()
        assert not any("verified" in t for t in said(v["detail"]))
        assert page.get_by_role("link", name="Download evidence").count() == 0
        aid, api = v["aid"], v["api"]
    assert asset(api, aid)["state"] == "draft" and S3().keys(f"evidence/{aid}/") == []


def test_wf_outage_recovery_503_holds(browser, app_url):
    with verify_503(browser, app_url) as v:
        page, dialog = v["page"], v["dialog"]
        advance(page, POLL_MS * 3)
        assert v["status"].inner_text().strip() == EVIDENCE_503["error"]["message"]
        assert v["field"].evaluate("el => el.files.length") == 1
        assert dialog.get_by_role("textbox", name="Note").input_value() == OUTAGE_NOTE
        assert page.get_by_role("alert", name="Evidence storage outage").count() == 1
        click(v["submit"])
        spin(page, lambda: len(v["keys"]) == 2, what="resubmit sent")
        keys, aid, api = v["keys"], v["aid"], v["api"]
    assert keys[0] and keys[0] == keys[1]
    assert asset(api, aid)["state"] == "draft"


def test_wf_outage_recovery_503_keyboard(browser, app_url):
    with verify_503(browser, app_url) as v:
        page, submit = v["page"], v["submit"]
        assert has_focus(submit)
        banner = page.get_by_role("alert", name="Evidence storage outage")
        wait_ui(page, lambda: banner.count() == 1, what="banner")
        assert banner.evaluate("el => [...el.querySelectorAll('*')].filter(n => n.tabIndex >= 0).length") == 0
        assert has_focus(submit)
        names = tab_order(page, 8)
        assert set(names) == {"Evidence file", "Note", "Verify asset", "Cancel"}
        submit.focus()
        advance(page, POLL_MS * 3)
        assert has_focus(submit)


def test_wf_outage_recovery_banners_mobile(browser, app_url):
    api = Api(APP_BOTH_DOWN, DANA)
    with ui(browser, APP_BOTH_DOWN, api, "/catalog", PHONE) as page:
        ev = page.get_by_role("alert", name="Evidence storage outage")
        ml = page.get_by_role("alert", name="Mail relay outage")
        wait_ui(page, lambda: ev.count() == 1 and ml.count() == 1, BANNER_S + INFRA_SLACK_S, "both banners", step=500)
        assert "The mail relay is unreachable. Deprecation notices are queued and will send when it returns." in ml.inner_text()
        count = mark_text(ml, "data-queued-notices")
        assert count.isdigit() and f"Queued notices: {count}" in ml.inner_text()
        nav = page.get_by_role("navigation", name="Main").bounding_box()
        e, m = ev.bounding_box(), ml.bounding_box()
        f = page.get_by_role("button", name="Filters", exact=True).bounding_box()
        assert nav["y"] + nav["height"] <= e["y"] + 1 and e["y"] + e["height"] <= m["y"] + 1 and m["y"] + m["height"] <= f["y"] + 1
        layout(page)
    assert api.get("/api/status").json()["mail"] == "down"


def test_wf_outage_recovery_queued_mail(browser, app_url, mail):
    steward = make_user(app_url, "Steward")
    owner = make_user(app_url, "Analyst")
    replica = Api(APP_MAIL_DOWN, steward.user["email"], steward.password)
    a = register(replica, ["v"])
    b = register(replica, ["v"], owner=owner.user["id"])
    link(replica, [(f"{a}.v", f"{b}.v", "copy")])
    replies: list[dict] = []
    with ui(browser, APP_MAIL_DOWN, replica, f"/catalog?asset={a}") as page:
        page.on("response", lambda r: replies.append(r.json()) if r.url.endswith("/deprecate") and r.status == 200 else None)
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("button", name="Deprecate", exact=True).is_visible(), 15, "Deprecate")
        click(detail.get_by_role("button", name="Deprecate", exact=True))
        dialog = page.get_by_role("dialog", name="Deprecate asset")
        fill(dialog.get_by_role("textbox", name="Reason"), REASON)
        click(dialog.get_by_role("button", name="Deprecate asset", exact=True))
        spin(page, lambda: len(replies) == 1, what="deprecation reply")
        banner = page.get_by_role("alert", name="Mail relay outage")
        wait_ui(page, lambda: banner.count() == 1, BANNER_S + INFRA_SLACK_S, "mail banner", step=500)
        assert mark_text(banner, "data-queued-notices").isdigit()
        assert replies[0]["notices_queued"] == 1
        queued = replies[0]["notices_queued"]
        assert status(page, "Activity").inner_text().strip() == f"Deprecated. Downstream owner notices queued: {queued}."
    assert len(mails_for(mail, owner.user["email"], 1, NOTICE_S * 2)) == 1


def test_glossary_terms_and_revisions(app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:8]
    t = steward.post("/api/terms", json={"name": f"  Span   {tok} ", "definition": "Coverage span."})
    assert t.status_code == 201
    term = t.json()["term"]
    assert term["name"] == f"Span {tok}" and term["revision"] == 1
    dup = steward.post("/api/terms", json={"name": f"span {tok.upper()}", "definition": "x"})
    assert dup.status_code == 409 and dup.json() == {"error": {"code": "term_exists", "message": f"A term named Span {tok} already exists."}}
    for body, field, msg in (({"name": "", "definition": "x"}, "name", "Use 1 to 80 characters."),
                             ({"name": "n" * (TERM_NAME_MAX + 1), "definition": "x"}, "name", "Use 1 to 80 characters."),
                             ({"name": "ok " + tok, "definition": ""}, "definition", "Use 1 to 1,000 characters.")):
        r = steward.post("/api/terms", json=body)
        assert r.status_code == 422 and r.json()["error"]["fields"][field] == msg
    aid = register(steward, ["v"])
    steward.post(f"/api/assets/{enc(aid)}/terms", json={"term_id": term["id"]})
    pg = Postgres()
    before = max_seq(pg)
    races = parallel([lambda: steward.patch(f"/api/terms/{term['id']}", {"revision": 1, "name": f"Coverage {tok}"}),
                      lambda: steward.patch(f"/api/terms/{term['id']}", {"revision": 1, "name": f"Period {tok}"})])
    assert sorted(r.status_code for r in races) == [200, 409]
    loser = next(r for r in races if r.status_code == 409)
    assert loser.json() == {"error": {"code": "term_stale", "message": "This term changed since you opened it. Reload and try again."}}
    new = next(r for r in races if r.status_code == 200).json()["term"]
    assert new["revision"] == 2 and new["assets"] == [{"id": aid}]
    assert asset(steward, aid)["terms"] == [{"id": term["id"], "name": new["name"]}]
    assert [r["id"] for r in search(steward, q=new["name"]).json()["results"]] == [aid]
    assert search(steward, q=f"Span {tok}").json()["total"] == 0
    facet = search(steward, q=aid).json()["facets"]["term"]
    assert {"value": term["id"], "label": new["name"], "count": 1} in facet
    assert search(steward, q=aid, as_of_seq=before).json()["facets"]["term"][0]["label"] == f"Span {tok}"
    stale = steward.patch(f"/api/terms/{term['id']}", {"revision": 1, "name": ""})
    assert stale.json()["error"]["code"] == "term_stale"
    nrev = steward.patch(f"/api/terms/{term['id']}", {"name": "x"})
    assert nrev.status_code == 422 and nrev.json()["error"]["fields"]["revision"] == "Send the revision you edited."
    row = pg.rows(f"select before, after from audit_log where target_id = '{term['id']}' and action = 'term.update'")[0]
    assert row["before"] == {"name": f"Span {tok}", "revision": 1} and row["after"] == {"name": new["name"], "revision": 2}
    terms = steward.get("/api/terms").json()["terms"]
    keys = [(x["name"].casefold(), x["id"]) for x in terms]
    assert keys == sorted(keys)


def test_term_links(app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:8]
    term = steward.post("/api/terms", json={"name": f"Link {tok}", "definition": "d"}).json()["term"]
    aid = register(steward, ["v"])
    path = f"/api/assets/{enc(aid)}/terms"
    assert steward.post(path, json={"term_id": "t-unknown-" + tok}).json()["error"]["fields"]["term_id"] == "Unknown term."
    link_r, rename_r = parallel([lambda: steward.post(path, json={"term_id": term["id"]}),
                                 lambda: steward.patch(f"/api/terms/{term['id']}", {"revision": 1, "name": f"Renamed {tok}"})])
    assert link_r.status_code == 200 and rename_r.status_code == 200
    assert link_r.json()["terms"][0]["name"] in (f"Link {tok}", f"Renamed {tok}")
    assert asset(steward, aid)["terms"] == [{"id": term["id"], "name": f"Renamed {tok}"}]
    assert search(steward, q=f"renamed {tok}").json()["total"] == 1
    again = steward.post(path, json={"term_id": term["id"]})
    assert again.json() == {"error": {"code": "term_linked", "message": f"Renamed {tok} is already linked."}}
    assert steward.delete(f"{path}/{term['id']}").status_code == 200
    assert asset(steward, aid)["terms"] == [] and search(steward, q=f"renamed {tok}").json()["total"] == 0
    assert steward.delete(f"{path}/{term['id']}").json() == ERR_404


def test_wf_glossary_live_rename(browser, app_url):
    steward = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:8]
    term = steward.post("/api/terms", json={"name": f"Aaa probe {tok}", "definition": "Probe."}).json()["term"]
    aid = register(steward, ["v"])
    steward.post(f"/api/assets/{enc(aid)}/terms", json={"term_id": term["id"]})
    with ui(browser, app_url, make_user(app_url, "Viewer"), "/glossary", DESKTOP) as page:
        terms = page.get_by_role("list", name="Terms")
        wait_ui(page, lambda: terms.get_by_role("listitem").count() >= 4, 15, "cards")
        assert page.get_by_role("button", name="New term").count() == 0
        for viewport, cols in ((DESKTOP, 3), (TABLET, 2), (PHONE, 1)):
            page.set_viewport_size(viewport)
            advance(page, 300)
            boxes = [i.bounding_box() for i in terms.get_by_role("listitem").all()[:4]]
            first_row = [b for b in boxes if abs(b["y"] - boxes[0]["y"]) < 2]
            assert len(first_row) == min(cols, 4) and boxes[cols % 4 if cols < 4 else 0]["x"] <= boxes[0]["x"] + 1
            layout(page)
        order = [i.get_attribute("data-term-id") for i in terms.get_by_role("listitem").all()]
        assert order == [t["id"] for t in steward.get("/api/terms").json()["terms"]]
        card = terms.get_by_role("listitem").filter(has=page.get_by_role("link", name=aid, exact=True)).first
        target = card.get_by_role("link", name=aid, exact=True)
        target.focus()
        record(status(page, "Glossary updates"))
        new_name = f"Zzz contracted provider for claims adjudication {tok}"
        steward.patch(f"/api/terms/{term['id']}", {"revision": 1, "name": new_name})
        wait_ui(page, lambda: card.get_attribute("data-revision") == "2", what="card repainted")
        assert new_name in card.inner_text() and has_focus(card.get_by_role("link", name=aid, exact=True))
        assert said(status(page, "Glossary updates")).count(f"Term renamed: Aaa probe {tok} is now {new_name}.") == 1
        order = [i.get_attribute("data-term-id") for i in terms.get_by_role("listitem").all()]
        assert order == [t["id"] for t in steward.get("/api/terms").json()["terms"]]
        layout(page)


def test_wf_glossary_stale_edit(browser, app_url):
    rui = make_user(app_url, "Steward")
    dana = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:8]
    term = rui.post("/api/terms", json={"name": f"Eligibility span {tok}", "definition": "Probe."}).json()["term"]
    with ui(browser, app_url, rui, "/glossary") as page:
        terms = page.get_by_role("list", name="Terms")
        opener = terms.get_by_role("button", name=f"Edit Eligibility span {tok}", exact=True)
        wait_ui(page, lambda: opener.count() == 1, 15, "card")
        record(terms)
        click(opener)
        dialog = page.get_by_role("dialog", name="Edit term")
        name_box = dialog.get_by_role("textbox", name="Term name")
        fill(name_box, f"Rui name {tok}")
        dana.patch(f"/api/terms/{term['id']}", {"revision": 1, "name": f"Coverage period {tok}"})
        wait_ui(page, lambda: f"Coverage period {tok}" in terms.inner_text(), what="card follows Dana")
        assert name_box.input_value() == f"Rui name {tok}"
        click(dialog.get_by_role("button", name="Save term", exact=True))
        dialog_status = dialog.get_by_role("status", name="Dialog status")
        wait_ui(page, lambda: dialog_status.inner_text().strip() == "This term changed since you opened it. Reload and try again.", what="stale copy")
        assert name_box.input_value() == f"Rui name {tok}" and has_focus(dialog.get_by_role("button", name="Save term", exact=True))
        assert not any(f"Rui name {tok}" in t for t in said(terms))
    final = next(t for t in rui.get("/api/terms").json()["terms"] if t["id"] == term["id"])
    assert final["name"] == f"Coverage period {tok}" and final["revision"] == 2


def test_asset_registration_rules(app_url):
    steward = make_user(app_url, "Steward")
    aid = f"mart.t{uuid.uuid4().hex[:10]}"
    good = ["member_ssn", "адрес_улица", "नाम_सदस्य"]
    r = steward.post("/api/assets", json={"id": aid, "kind": "view", "description": "Probe.", "owner_id": steward.user["id"],
                                          "columns": [{"name": n, "data_type": "text", "samples": ["a"]} for n in good]})
    assert r.status_code == 201
    d = r.json()
    assert d["state"] == "draft" and d["kind"] == "view" and [c["id"] for c in d["columns"]] == [f"{aid}.{n}" for n in good]
    assert all(c["direct_tags"] == c["effective_tags"] == c["suppressed_tags"] == [] for c in d["columns"]) and d["terms"] == []
    row = audit_rows(Postgres(), aid, "asset.register")[0]
    assert row["after"] == {"kind": "view", "owner_id": steward.user["id"], "columns": good}
    exists = steward.post("/api/assets", json={"id": aid, "kind": "view", "description": "x", "owner_id": steward.user["id"],
                                               "columns": [{"name": "a", "data_type": "t", "samples": []}]})
    assert exists.json() == {"error": {"code": "asset_exists", "message": f"{aid} is already registered."}}
    base = {"id": f"src.t{uuid.uuid4().hex[:10]}", "kind": "table", "description": "x", "owner_id": steward.user["id"],
            "columns": [{"name": "a", "data_type": "t", "samples": []}]}
    for patch, field, msg in (({"id": "Src.Bad"}, "id", "Use schema.table in lowercase letters, digits and underscores."),
                              ({"kind": "cube"}, "kind", "Kind must be table, view or dashboard."),
                              ({"owner_id": "u-nobody"}, "owner_id", "Unknown user."),
                              ({"columns": [{"name": "a", "data_type": "t", "samples": []}] * 2}, "columns", "Give 1 to 200 columns with unique names."),
                              ({"columns": [{"name": "Member", "data_type": "t", "samples": []}]}, "columns[0]", "Check this column's name, type and samples."),
                              ({"columns": [{"name": "2nd_line", "data_type": "t", "samples": []}]}, "columns[0]", "Check this column's name, type and samples.")):
        r = steward.post("/api/assets", json={**base, **patch})
        assert r.status_code == 422 and r.json()["error"]["fields"][field] == msg, patch


def test_lineage_edge_recording(app_url):
    steward = make_user(app_url, "Steward")
    a = register(steward, ["x", "y", "z"])
    X, Y, Z = f"{a}.x", f"{a}.y", f"{a}.z"
    tag(steward, X, "PII")
    started = time.monotonic()
    r = link(steward, [(X, Y, "copy"), (Y, X, "filter")])
    assert time.monotonic() - started < WRITE_BUDGET_S
    assert [(e["from"], e["to"], e["transform"]) for e in r["edges"]] == [(X, Y, "copy"), (Y, X, "filter")]
    assert r["changed_columns"] == [Y] and column(steward, Y)["effective_tags"] == ["PII"]
    row = audit_rows(Postgres(), r["edges"][0]["id"], "lineage.add")[0]
    assert row["after"] == {"edges": r["edges"]}
    bad = steward.post("/api/lineage/edges", json={"edges": [{"from": X, "to": X, "transform": "copy"},
                                                            {"from": X + "q", "to": Y + "q", "transform": "copy"},
                                                            {"from": X, "to": Z, "transform": "pivot"}]})
    f = bad.json()["error"]["fields"]
    assert bad.status_code == 422 and f["edges[0].to"] == "An edge cannot point to its own column."
    assert f["edges[1].from"] == f["edges[1].to"] == "Unknown column."
    assert f["edges[2].transform"] == "Transform must be one of copy, rename, cast, filter, join, concat, hash, aggregate."
    assert steward.post("/api/lineage/edges", json={"edges": []}).json()["error"]["fields"]["edges"] == "Send 1 to 1,000 edges."
    dup = steward.post("/api/lineage/edges", json={"edges": [{"from": X, "to": Y, "transform": "copy"}]})
    assert dup.json() == {"error": {"code": "edge_exists", "message": f"An edge from {X} to {Y} already exists."}}
    removed = steward.delete(f"/api/lineage/edges/{r['edges'][0]['id']}")
    assert removed.status_code == 200 and removed.json()["changed_columns"] == [Y]
    assert column(steward, Y)["effective_tags"] == []
    big_src = register(steward, [f"s{i:03d}" for i in range(EDGE_BATCH_MAX // 5)])
    big_dst = [register(steward, [f"d{i:03d}" for i in range(EDGE_BATCH_MAX // 5)]) for _ in range(5)]
    edges = [(f"{big_src}.s{i:03d}", f"{d}.d{i:03d}", "copy") for d in big_dst for i in range(EDGE_BATCH_MAX // 5)]
    tag(steward, f"{big_src}.s000", "Confidential")
    started = time.monotonic()
    resp = steward.post("/api/lineage/edges", json={"edges": [{"from": f, "to": t, "transform": tr} for f, t, tr in edges]})
    assert resp.status_code == 201 and time.monotonic() - started < WRITE_BUDGET_S
    assert len(resp.json()["edges"]) == EDGE_BATCH_MAX
    assert sorted(resp.json()["changed_columns"]) == sorted(f"{d}.d000" for d in big_dst)


def test_single_winner_for_ingestion(app_url):
    steward = make_user(app_url, "Steward")
    other = make_user(app_url, "Steward")
    aid = f"stg.t{uuid.uuid4().hex[:10]}"
    body = {"id": aid, "kind": "table", "description": "Nightly.", "owner_id": steward.user["id"],
            "columns": [{"name": "a", "data_type": "t", "samples": []}, {"name": "b", "data_type": "t", "samples": []},
                        {"name": "c", "data_type": "t", "samples": []}]}
    results = parallel([lambda: steward.post("/api/assets", json=body)] * PARALLEL)
    assert sorted(r.status_code for r in results) == [201] + [409] * (PARALLEL - 1)
    assert len(audit_rows(Postgres(), aid, "asset.register")) == 1
    A, B, C = (f"{aid}.{n}" for n in "abc")
    b1 = {"edges": [{"from": A, "to": B, "transform": "copy"}, {"from": B, "to": C, "transform": "copy"}]}
    b2 = {"edges": [{"from": A, "to": C, "transform": "copy"}, {"from": B, "to": C, "transform": "copy"}]}
    r1, r2 = parallel([lambda: steward.post("/api/lineage/edges", json=b1), lambda: other.post("/api/lineage/edges", json=b2)])
    assert sorted([r1.status_code, r2.status_code]) == [201, 409]
    loser = r1 if r1.status_code == 409 else r2
    assert loser.json() == {"error": {"code": "edge_exists", "message": f"An edge from {B} to {C} already exists."}}
    pairs = [(e["from"], e["to"]) for e in steward.get("/api/graph").json()["edges"] if e["from"].startswith(aid)]
    winner = b1 if r1.status_code == 201 else b2
    assert sorted(pairs) == sorted((e["from"], e["to"]) for e in winner["edges"])


def test_limits_count_code_points(app_url):
    steward = make_user(app_url, "Steward")

    def reg(desc, sample, name="v"):
        return steward.post("/api/assets", json={"id": f"src.t{uuid.uuid4().hex[:10]}", "kind": "table", "description": desc,
                                                 "owner_id": steward.user["id"], "columns": [{"name": name, "data_type": "t", "samples": [sample]}]})

    ok = reg("𝔸" * DESC_MAX, "🧾" * SAMPLE_MAX, "й" * COLUMN_NAME_MAX)
    assert ok.status_code == 201 and ok.json()["columns"][0]["samples"] == ["🧾" * SAMPLE_MAX]
    assert reg("𝔸" * (DESC_MAX + 1), "a").json()["error"]["fields"]["description"] == "Use 1 to 500 characters."
    column_key = f"columns[{0}]"
    assert column_key in reg("d", "🧾" * (SAMPLE_MAX + 1)).json()["error"]["fields"]
    assert column_key in reg("d", "a", "й" * (COLUMN_NAME_MAX + 1)).json()["error"]["fields"]
    assert steward.post("/api/terms", json={"name": "Ж" * (TERM_NAME_MAX - 8) + uuid.uuid4().hex[:8], "definition": "d"}).status_code == 201

    def sized(n):
        base = {"name": "Size probe " + uuid.uuid4().hex, "definition": "d", "pad": ""}
        raw = json.dumps(base, separators=(",", ":"))
        base["pad"] = "p" * (n - len(raw.encode()))
        out = json.dumps(base, separators=(",", ":")).encode()
        assert len(out) == n
        return out

    assert steward.c.post("/api/terms", content=sized(JSON_LIMIT), headers={"Content-Type": "application/json"}).status_code == 201
    big = steward.c.post("/api/terms", content=sized(JSON_LIMIT + 1), headers={"Content-Type": "application/json"})
    assert big.status_code == 413 and big.json() == ERR_413
    aid = register(steward, ["v"])
    probe, _ = multipart("signoff.pdf", b"", None)
    overhead = len(probe)
    for total, status_code in ((MULTIPART_LIMIT, 422), (MULTIPART_LIMIT + 1, 413)):
        body, ctype = multipart("signoff.pdf", b"%" + b"P" * 0, None)
        boundary = ctype.split("=", 1)[1]
        data = b"%PDF" + b"x" * (total - overhead - 4 - (len(boundary) - len(ctype.split('=', 1)[1])))
        body, ctype2 = multipart("signoff.pdf", data, None)
        data = data[: len(data) - (len(body) - total)]
        body, ctype2 = multipart("signoff.pdf", data, None)
        if len(body) != total:
            data = data + b"x" * (total - len(body))
            body, ctype2 = multipart("signoff.pdf", data, None)
        assert len(body) == total
        r = steward.c.post(f"/api/assets/{enc(aid)}/verify", content=body, headers={"Content-Type": ctype2})
        assert r.status_code == status_code, (total, r.text)
    assert asset(steward, aid)["state"] == "draft"


def test_wf_lineage_ingest_live_edge(browser, app_url):
    dana = make_user(app_url, "Steward")
    rui = make_user(app_url, "Steward")
    a, b = register(dana, ["ssn"]), register(dana, ["ssn"])
    A, B = f"{a}.ssn", f"{b}.ssn"
    link(dana, [(A, B, "copy")])
    with ui(browser, app_url, dana, f"/catalog?asset={a}&column={enc(A)}") as page:
        cv = canvas(page)
        wait_ui(page, lambda: node(page, B).count() == 1, 15, "canvas")
        click(cv.get_by_role("button", name="Trace impact", exact=True))
        wait_ui(page, lambda: cv.get_attribute("data-sweep") == "done", what="trace done")
        counter = mark_text(cv, "data-sweep-count")
        summary = status(page, "Trace summary").inner_text()
        record(status(page, "Lineage status"))
        click(node(page, B))
        advance(page, 50)
        assert node(page, B).get_attribute("data-selected") == "true"
        assert said(status(page, "Lineage status")).count(f"{B}, hop 1") == 1
        c = register(rui, [("ssn", ["x"]), ("名前_氏名テスト", ["y"])])
        C = f"{c}.ssn"
        link(rui, [(B, C, "copy")])
        wait_ui(page, lambda: (B, C) in edges_of(cv), what="new edge")
        edge = edges_of(cv)[(B, C)]
        assert (edge["kind"], edge["drawn"], edge["state"]) == ("flow", "true", "new")
        assert node(page, C).get_attribute("data-hop") == "2" and node(page, C).get_attribute("data-lit") == "false"
        assert node(page, B).get_attribute("data-lit") == "true" and node(page, B).get_attribute("data-selected") == "true"
        assert mark_text(cv, "data-sweep-count") == counter and status(page, "Trace summary").inner_text() == summary
        wait_ui(page, lambda: said(status(page, "Lineage status")).count("Lineage changed since this trace. Trace again to include it.") == 1,
                what="lineage-changed copy")
        node(page, B).focus()
        page.set_viewport_size(PHONE)
        advance(page, 300)
        assert has_focus(page.get_by_role("button", name="Lineage", exact=True))
        layout(page)
        click(page.get_by_role("button", name="Lineage", exact=True))
        wait_ui(page, lambda: has_focus(node(page, B)), what="hop list focus")
        assert node(page, B).get_attribute("data-selected") == "true"
    assert lineage(dana, A).json()["totals"]["columns"] == 2


def test_wf_lineage_ingest_search_join(browser, app_url):
    rui = make_user(app_url, "Steward")
    tok = uuid.uuid4().hex[:10]
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?q={tok}") as page:
        results_area = page.get_by_role("button", name="Clear filters", exact=True)
        wait_ui(page, lambda: results_area.count() == 1, 15, "results area")
        record(status(page, "Search status"))
        aid = register(rui, ["v"], desc=f"Nightly {tok}")
        wait_ui(page, lambda: page.get_by_role("link", name=aid, exact=True).count() == 1, what="joined results")
        assert said(status(page, "Search status")).count(matching(1)) == 1
    assert search(rui, q=tok).json()["total"] == 1


def test_activity_stream_format(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["v"])
    pg = Postgres()
    start = max_seq(pg)
    stream = Stream(app_url, make_user(app_url, "Analyst").token, after_seq=start)
    try:
        tag(steward, f"{aid}.v", "PII")
        seq = audit_rows(pg, f"{aid}.v", "tag.add")[0]["seq"]
        stream.collect(lambda s: seq in s.seqs(), FANOUT_S + INFRA_SLACK_S)
        event = next(e for e in stream.events if json.loads(e["data"])["seq"] == seq)
        assert event["id"] == str(seq) and event["event"] == "change"
        assert json.loads(event["data"]) == {"seq": seq, "action": "tag.add", "target": {"type": "column", "id": f"{aid}.v"}}
        assert stream.resp.headers["content-type"] == "text/event-stream; charset=utf-8"
        assert stream.resp.headers["cache-control"] == "no-store"
        stream.collect(lambda s: any("keep-alive" in c for c in s.comments), KEEPALIVE_S + INFRA_SLACK_S)
        assert ": keep-alive" in stream.comments
    finally:
        stream.close()
    for cursor in ({"after_seq": "-1"}, {"last_id": "abc"}):
        bad = Stream(app_url, steward.token, **cursor)
        assert bad.status == 422 and json.loads(bad.body)["error"]["fields"]["after_seq"] == "Use a non-negative whole number."
        bad.close()


def test_stream_resume_and_fanout(app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["v"])
    pg = Postgres()
    start = max_seq(pg)
    for t in ("PII", "Confidential"):
        tag(steward, f"{aid}.v", t)
    mine = {r["seq"] for r in audit_rows(pg, f"{aid}.v")}
    resumed = Stream(app_url, steward.token, after_seq=0, last_id=start)
    try:
        resumed.collect(lambda s: mine <= set(s.seqs()), FANOUT_S + INFRA_SLACK_S)
        seqs = resumed.seqs()
        assert seqs == sorted(set(seqs)) and seqs[0] > start and mine <= set(seqs)
        remote = Api(APP_MAIL_DOWN, steward.user["email"], steward.password)
        sent = time.monotonic()
        untag(remote, f"{aid}.v", "PII")
        seq = audit_rows(pg, f"{aid}.v", "tag.withdraw")[0]["seq"]
        resumed.collect(lambda s: seq in s.seqs(), FANOUT_S + INFRA_SLACK_S)
        assert seq in resumed.seqs() and time.monotonic() - sent <= FANOUT_S + INFRA_SLACK_S
    finally:
        resumed.close()
    live = Stream(app_url, steward.token)
    try:
        steward.clone().delete("/api/session")
        live.collect(lambda s: s.closed.is_set(), SESSION_END_S + INFRA_SLACK_S)
        assert live.closed.is_set()
    finally:
        live.close()


def test_streams_release_resources():
    pg = Postgres("_isolated")
    count = lambda cond="": pg.rows(f"select count(*) as n from pg_stat_activity where datname = current_database() and usename <> current_user {cond}")[0]["n"]
    adm = Api(APP_ISOLATED, MORGAN)
    streams = [Stream(APP_ISOLATED, adm.token) for _ in range(STREAM_COUNT)]
    try:
        assert all(s.status == 200 for s in streams)
        assert count() <= MAX_CONNECTIONS
    finally:
        for s in streams:
            s.close()
    for _ in range(ABORT_ROUNDS):
        Stream(APP_ISOLATED, adm.token).close()
    poll(lambda: count("and (state like 'idle in transaction%' or (state = 'active' and now() - query_start > interval '5 seconds'))") == 0,
         RELEASE_S + INFRA_SLACK_S, "no lingering sessions")
    assert count() <= MAX_CONNECTIONS
    started = time.monotonic()
    assert httpx.get(APP_ISOLATED + "/api/health").status_code == 200 and time.monotonic() - started < HEALTH_BUDGET_S


def test_stream_visibility_from_role_history(app_url):
    omar = make_user(app_url, "Analyst")
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["v"])
    pg = Postgres()
    live = Stream(app_url, omar.token, after_seq=max_seq(pg))
    adm = admin(app_url)
    try:
        adm.patch(f"/api/users/{omar.user['id']}", {"role": "Admin"})
        c1 = fresh_identity("c1")
        u1 = adm.post("/api/users", json={"name": c1[0], "email": c1[1], "role": "Viewer", "password": "x" * 12}).json()["user"]
        adm.patch(f"/api/users/{omar.user['id']}", {"role": "Analyst"})
        c2 = fresh_identity("c2")
        u2 = adm.post("/api/users", json={"name": c2[0], "email": c2[1], "role": "Viewer", "password": "x" * 12}).json()["user"]
        tag(steward, f"{aid}.v", "PII")
        roles = audit_rows(pg, omar.user["id"], "user.role_change")
        p, d = roles[0]["seq"], roles[1]["seq"]
        s1, s2 = audit_rows(pg, u1["id"])[0]["seq"], audit_rows(pg, u2["id"])[0]["seq"]
        t = audit_rows(pg, f"{aid}.v")[0]["seq"]
        ours = {p, s1, d, s2, t}
        live.collect(lambda s: t in s.seqs(), FANOUT_S + INFRA_SLACK_S)
        assert [x for x in live.seqs() if x in ours] == [p, s1, d, t]
    finally:
        live.close()
    resumed = Stream(app_url, omar.token, after_seq=p - 1)
    try:
        resumed.collect(lambda s: t in s.seqs(), FANOUT_S + INFRA_SLACK_S)
        assert [x for x in resumed.seqs() if x in ours] == [p, s1, d, t]
    finally:
        resumed.close()


def held_rows_journey(browser, app_url, viewport):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["v"])
    for i in range(FILLER_ROWS // 2):
        tag(steward, f"{aid}.v", "PII")
        untag(steward, f"{aid}.v", "PII")
    with ui(browser, app_url, admin(app_url), "/admin", viewport) as page:
        table = page.get_by_role("table", name="Audit log")
        wait_ui(page, lambda: table.get_by_role("link").count() >= AUDIT_PAGE // 2, 15, "audit rows")
        anchor = table.get_by_role("link").nth(AUDIT_PAGE // 2)
        anchor.scroll_into_view_if_needed()
        advance(page, 100)
        assert table.get_by_role("link").first.bounding_box()["y"] < 0
        y0 = anchor.bounding_box()["y"]
        updates = status(page, "Audit log updates")
        record(updates)
        for t in ("PII", "Confidential", "PII"):
            remote = Api(APP_MAIL_DOWN, steward.user["email"], steward.password) if t == "Confidential" else steward
            tag(remote, f"{aid}.v", t) if t != "PII" or not column(steward, f"{aid}.v")["direct_tags"].count("PII") else untag(steward, f"{aid}.v", t)
        button = page.get_by_role("button", name=re.compile(r"^Show \d+ new audit rows$"))
        wait_ui(page, lambda: button.count() == 1 and int(re.search(r"\d+", button.inner_text()).group()) >= 3, what="held count")
        assert abs(anchor.bounding_box()["y"] - y0) <= HOLD_PX
        assert len([t for t in said(updates) if re.fullmatch(r"\d+ new audit rows\.", t)]) == 1
        button.focus()
        page.keyboard.press("Enter")
        advance(page, 200)
        seqs = [int(l.inner_text()) for l in table.get_by_role("link").all()]
        assert seqs == list(range(seqs[0], seqs[0] - len(seqs), -1))
        assert seqs[0] == max_seq(Postgres()) and has_focus(table.get_by_role("link").first)
        assert button.count() == 0
        layout(page)


def test_wf_live_activity_held_rows(browser, app_url):
    held_rows_journey(browser, app_url, DESKTOP)


def test_wf_live_activity_held_rows_phone(browser, app_url):
    held_rows_journey(browser, app_url, PHONE)


def test_point_in_time_reads(app_url):
    steward = make_user(app_url, "Steward")
    analyst = make_user(app_url, "Analyst")
    aid = register(steward, [("v", ["903-00-1111"])])
    V = f"{aid}.v"
    pg = Postgres()
    reg_seq = audit_rows(pg, aid, "asset.register")[0]["seq"]
    ttok = uuid.uuid4().hex[:8]
    pit_term = steward.post("/api/terms", json={"name": f"Pit old {ttok}", "definition": "Probe."}).json()["term"]
    assert steward.post(f"/api/assets/{enc(aid)}/terms", json={"term_id": pit_term["id"]}).status_code == 200
    tag(steward, V, "PII")
    tagged = audit_rows(pg, V, "tag.add")[0]
    untag(steward, V, "PII")
    later = register(steward, ["w"])
    assert steward.patch(f"/api/terms/{pit_term['id']}", {"revision": 1, "name": f"Pit new {ttok}"}).status_code == 200
    col = analyst.get(f"/api/columns/{enc(V)}", params={"as_of_seq": tagged["seq"]}).json()
    assert col["as_of_seq"] == tagged["seq"] and col["as_of_at"] == tagged["at"]
    assert col["column"]["effective_tags"] == ["PII"] and col["column"]["samples"] == [MASKED]
    by_time = analyst.get(f"/api/columns/{enc(V)}", params={"as_of_time": tagged["at"]}).json()
    assert by_time["as_of_seq"] == tagged["seq"]
    shifted = datetime.fromisoformat(tagged["at"].replace("Z", "+00:00")).astimezone(ZoneInfo("America/Chicago")).isoformat(timespec="milliseconds")
    assert analyst.get(f"/api/columns/{enc(V)}", params={"as_of_time": shifted}).json()["as_of_seq"] == tagged["seq"]
    a = analyst.get(f"/api/assets/{enc(aid)}", params={"as_of_seq": tagged["seq"]}).json()
    assert set(a) == {"as_of_seq", "as_of_at", "asset"} and a["asset"]["pii_column_count"] == 1
    assert a["asset"]["terms"] == [{"id": pit_term["id"], "name": f"Pit old {ttok}"}]
    assert asset(analyst, aid)["terms"] == [{"id": pit_term["id"], "name": f"Pit new {ttok}"}]
    s = search(analyst, q=aid, as_of_seq=reg_seq).json()
    assert s["as_of_seq"] == reg_seq and s["results"][0]["pii_column_count"] == 0
    assert analyst.get(f"/api/assets/{enc(later)}", params={"as_of_seq": tagged["seq"]}).json() == ERR_404
    assert search(analyst, q=later, as_of_seq=tagged["seq"]).json()["total"] == 0
    lin = lineage(analyst, V, as_of_seq=tagged["seq"]).json()
    assert lin["as_of_seq"] == tagged["seq"] and lin["focus_tags"] == ["PII"]
    g = analyst.get("/api/graph", params={"as_of_seq": tagged["seq"]}).json()
    assert g["as_of_seq"] == tagged["seq"] and next(c for c in g["columns"] if c["id"] == V)["effective_tags"] == ["PII"]
    seed = search(analyst, as_of_seq=0, q="src.members").json()
    assert seed["as_of_at"] is None and seed["results"][0]["pii_column_count"] == 3
    for params, field, msg in (({"as_of_seq": "-1"}, "as_of_seq", "Use an audit seq from 0 to the latest seq."),
                               ({"as_of_seq": str(max_seq(pg) + 1000)}, "as_of_seq", "Use an audit seq from 0 to the latest seq."),
                               ({"as_of_time": "2026-09-30T23:59:59"}, "as_of_time", "Use an RFC 3339 time with an offset."),
                               ({"as_of_seq": "1", "as_of_time": "2026-09-30T23:59:59Z"}, "as_of_time", "Send as_of_seq or as_of_time, not both.")):
        r = search(analyst, **params)
        assert r.status_code == 422 and r.json()["error"]["fields"][field] == msg
    assert analyst.get(f"/api/columns/{enc(V)}x", params={"as_of_seq": "-1"}).json() == ERR_404


def test_wf_point_in_time_seq_link(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, [("v", ["904-00-2222"])])
    V = f"{aid}.v"
    tag(steward, V, "PII")
    pg = Postgres()
    k = audit_rows(pg, V, "tag.add")[0]["seq"]
    with ui(browser, app_url, admin(app_url), "/admin") as page:
        table = page.get_by_role("table", name="Audit log")
        seq_link = table.get_by_role("link", name=str(k), exact=True)
        wait_ui(page, lambda: seq_link.count() == 1, 15, "seq link")
        click(seq_link)
        wait_ui(page, lambda: f"as_of={k}" in page.url, what="opened point in time")
        note = page.get_by_role("note", name="Point in time")
        wait_ui(page, lambda: f"Catalog as of audit seq {k}. Later changes are not shown." in note.inner_text(), what="note")
        assert mark_text(note, "data-recorded-at").startswith(f"Seq {k} was recorded at ")
        assert page.get_by_role("main").get_attribute("data-synced-seq") == str(k)
        page.go_back()
        wait_ui(page, lambda: "/admin" in page.url and has_focus(table.get_by_role("link", name=str(k), exact=True)), what="back to row")
        page.goto(f"{app_url}/catalog?as_of={k}&asset={aid}&column={enc(V)}")
        detail = page.get_by_role("region", name="Column detail")
        wait_ui(page, lambda: len(glyphs(detail, "PII")) >= 1, 15, "past tags")
        for name in ("Withdraw PII", "Tag Confidential", "Deprecate", "Verify", "Apply tag to selected"):
            assert page.get_by_role("button", name=name, exact=True).count() == 0
        record(status(page, "Activity"))
        untag(steward, V, "PII")
        wait_ui(page, lambda: re.fullmatch(rf"\d+ newer changes since seq {k}\.", mark_text(note, "data-newer-changes")),
                what="newer line")
        advance(page, LIVE_S * 1000)
        assert glyphs(detail, "PII")
        assert page.get_by_role("main").get_attribute("data-synced-seq") == str(k)
        assert len([t for t in said(status(page, "Activity")) if t.endswith(f"newer changes since seq {k}.")]) == 1
        page.reload()
        wait_ui(page, lambda: len(glyphs(detail, "PII")) >= 1, 15, "reload reproduces")
    with ui(browser, app_url, make_user(app_url, "Analyst"), f"/catalog?as_of={k}&asset={aid}") as page:
        wait_ui(page, lambda: "as_of" not in page.url, 15, "as_of removed")
        assert page.get_by_role("note", name="Point in time").count() == 0
    assert column(steward, V)["effective_tags"] == []


BUSINESS_TIMES = {
    "2026-09-30T23:59:59": "2026-09-30T23:59:59-05:00",
    "2026-12-31T23:59:59": "2026-12-31T23:59:59-06:00",
    "2026-11-01T01:30:00": "2026-11-01T01:30:00-05:00",
    "2026-03-08T02:30:00": "2026-03-08T03:30:00-05:00",
}


def test_wf_point_in_time_business_time(browser, app_url):
    sent: list[str] = []
    with ui(browser, app_url, admin(app_url), "/admin") as page:
        page.on("request", lambda r: sent.append(r.url) if "as_of_time" in r.url else None)
        group = page.get_by_role("group", name="Catalog as of")
        for wall, expected in BUSINESS_TIMES.items():
            page.goto(app_url + "/admin")
            box = group.get_by_role("textbox", name="Business time")
            wait_ui(page, lambda: box.is_visible(), 15, "form")
            fill(box, wall)
            page.keyboard.press("Enter")
            wait_ui(page, lambda: "as_of=" in page.url, what=f"opened {wall}")
            assert parse_qs(urlparse(sent[-1]).query)["as_of_time"] == [expected]
            resolved = search(admin(app_url), as_of_time=expected).json()["as_of_seq"]
            assert parse_qs(urlparse(page.url).query)["as_of"] == [str(resolved)]
        page.goto(app_url + "/admin")
        before = len(sent)
        not_a_date = "2026-02-30T10:00:00"
        fill(group.get_by_role("textbox", name="Business time"), not_a_date)
        click(group.get_by_role("button", name="Open catalog as of", exact=True))
        wait_ui(page, lambda: group.get_by_role("status", name="Point in time status").inner_text().strip()
                == "Use YYYY-MM-DDTHH:mm:ss in America/Chicago time.", what="malformed copy")
        assert len(sent) == before


def test_wf_point_in_time_viewer_zone(browser, app_url):
    adm = admin(app_url)
    rows = adm.get("/api/audit", params={"limit": 5}).json()["rows"]
    assert rows
    for zone in ("Europe/London", "America/Chicago"):
        context = browser.new_context(timezone_id=zone, viewport=DESKTOP)
        try:
            context.add_cookies([{"name": "strata_session", "value": adm.token, "url": app_url}])
            page = context.new_page()
            page.goto(app_url + "/admin")
            table = page.get_by_role("table", name="Audit log")
            table.wait_for(timeout=15000)
            poll(lambda: len(marks(table, "data-at")) >= len(rows), 15, "When cells")
            for cell in marks(table, "data-at")[:len(rows)]:
                assert AT_RE.match(cell["value"])
                assert cell["text"] == viewer_time(cell["value"], zone), zone
        finally:
            context.close()


def test_wf_cross_cutting_breakpoints(browser, app_url):
    steward = make_user(app_url, "Steward")
    aid = register(steward, ["v"])
    with ui(browser, app_url, steward, f"/catalog?asset={aid}&column={enc(aid + '.v')}") as page:
        detail = page.get_by_role("region", name="Asset detail")
        wait_ui(page, lambda: detail.get_by_role("heading", name=aid, exact=True).count() == 1, 15, "detail")
        for viewport in (DESKTOP, TABLET, PHONE):
            page.set_viewport_size(viewport)
            advance(page, 400)
            layout(page)
            box = page.get_by_role("searchbox", name="Search catalog").bounding_box()
            if viewport is PHONE:
                assert not canvas(page).is_visible()
                assert page.get_by_role("button", name="Filters", exact=True).is_visible()
                assert page.get_by_role("button", name="Lineage", exact=True).is_visible()
            else:
                cv, dt = canvas(page).bounding_box(), detail.bounding_box()
                assert page.get_by_role("button", name="Filters", exact=True).count() == 0 or not page.get_by_role("button", name="Filters", exact=True).is_visible()
                assert box["x"] + box["width"] <= cv["x"] + 1
                if viewport is DESKTOP:
                    assert cv["x"] + cv["width"] <= dt["x"] + 1
                else:
                    assert cv["y"] + cv["height"] <= dt["y"] + 1
            click(detail.get_by_role("button", name="Verify", exact=True))
            dialog = page.get_by_role("dialog", name="Verify asset")
            advance(page, TRANSITION_MS * 2)
            d = dialog.bounding_box()
            assert inside(d, {"x": 0, "y": 0, **viewport})
            for name in ("Verify asset", "Cancel"):
                assert dialog.get_by_role("button", name=name, exact=True).evaluate(HIT_JS)
            assert not page.get_by_role("searchbox", name="Search catalog").evaluate(HIT_JS)
            y = page.evaluate("window.scrollY")
            page.mouse.wheel(0, 400)
            advance(page, 100)
            assert page.evaluate("window.scrollY") == y
            page.keyboard.press("Escape")
            advance(page, TRANSITION_MS * 2)


def test_wf_cross_cutting_closed_panels(browser, app_url):
    analyst = make_user(app_url, "Analyst")
    for reduced in (False, True):
        with ui(browser, app_url, analyst, "/catalog?asset=src.members&column=src.members.ssn", PHONE, reduced=reduced) as page:
            wait_ui(page, lambda: page.get_by_role("button", name="Filters", exact=True).is_visible(), 15, "phone layout")
            assert page.get_by_role("radiogroup", name="Tag").count() == 0
            assert page.get_by_role("complementary", name="Lineage").count() == 0
            names = tab_order(page, 25)
            assert "Close filters" not in names and "Close lineage" not in names and "Any" not in names
            layout(page)
            for opener, panel in (("Filters", page.get_by_role("dialog", name="Filters")),
                                  ("Lineage", page.get_by_role("complementary", name="Lineage"))):
                click(page.get_by_role("button", name=opener, exact=True))
                if reduced:
                    spin(page, lambda: panel.get_attribute("data-transition") == "open", what="open at once")
                    assert page.evaluate("document.getAnimations().length") == 0
                else:
                    wait_ui(page, lambda: panel.get_attribute("data-transition") == "open", what="settled open")
                assert inside(panel.bounding_box(), {"x": 0, "y": 0, **PHONE})
                page.keyboard.press("Escape")
                wait_ui(page, lambda: panel.count() == 0, what="closed")
                assert has_focus(page.get_by_role("button", name=opener, exact=True))


def test_run_manifest_and_health(app_url):
    for base in (app_url, APP_EVIDENCE_DOWN, APP_MAIL_DOWN, APP_BOTH_DOWN, APP_ISOLATED):
        r = httpx.get(base.rstrip("/") + "/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}, base
    assert urlparse(app_url).port in (4173, int(os.environ.get("APP_PUBLIC_PORT", "4173")))


SEED_COUNTS = {"src.members": (4, 3, 1), "src.claims_legacy": (2, 1, 1), "stg.member_claims": (4, 1, 3),
               "scr.risk_scores": (1, 0, 1), "mart.claims_by_region": (1, 0, 1), "mart.member_risk": (2, 1, 1),
               "dash.claims_overview": (1, 0, 1), "dash.risk_outreach": (2, 1, 1), "src.eligibility_2019": (0, 0, 0),
               "stg.eligibility_spans": (0, 0, 0), "ref.providers": (0, 0, 0)}
SEED_EDGES = {
    ("src.claims_legacy.claim_id", "stg.member_claims.claim_id", "copy"), ("src.members.ssn", "stg.member_claims.member_ssn", "join"),
    ("src.claims_legacy.member_ssn", "stg.member_claims.member_ssn", "copy"), ("src.claims_legacy.diagnosis_code", "stg.member_claims.diagnosis_code", "copy"),
    ("src.claims_legacy.paid_amount", "stg.member_claims.paid_amount", "cast"), ("src.members.zip_code", "stg.member_claims.zip_code", "join"),
    ("scr.risk_scores.risk_score", "stg.member_claims.risk_score", "copy"), ("stg.member_claims.member_ssn", "scr.risk_scores.member_key", "hash"),
    ("stg.member_claims.paid_amount", "scr.risk_scores.risk_score", "aggregate"), ("stg.member_claims.risk_score", "scr.risk_scores.risk_score", "copy"),
    ("stg.member_claims.zip_code", "mart.claims_by_region.region_zip", "cast"), ("stg.member_claims.paid_amount", "mart.claims_by_region.total_paid", "aggregate"),
    ("stg.member_claims.claim_id", "mart.claims_by_region.claim_count", "aggregate"), ("scr.risk_scores.member_key", "mart.member_risk.member_key", "copy"),
    ("stg.member_claims.member_ssn", "mart.member_risk.member_ssn", "copy"), ("scr.risk_scores.risk_score", "mart.member_risk.risk_score", "copy"),
    ("mart.claims_by_region.region_zip", "dash.claims_overview.region", "rename"), ("mart.claims_by_region.total_paid", "dash.claims_overview.total_paid", "copy"),
    ("mart.member_risk.member_ssn", "dash.risk_outreach.member_ssn", "copy"), ("mart.member_risk.risk_score", "dash.risk_outreach.risk_score", "copy"),
    ("src.eligibility_2019.member_id", "stg.eligibility_spans.member_id", "copy"), ("src.eligibility_2019.plan_code", "stg.eligibility_spans.plan", "rename"),
    ("src.eligibility_2019.coverage_start", "stg.eligibility_spans.coverage_start", "cast"),
}


def test_seeded_first_run_state(app_url):
    adm = admin(app_url)
    users = {u["id"]: (u["name"], u["role"]) for u in adm.get("/api/users").json()["users"]}
    for uid, name, role in (("u-morgan", "Morgan Ellery", "Admin"), ("u-dana", "Dana Okafor", "Steward"), ("u-rui", "Rui Takahashi", "Steward"),
                            ("u-lena", "Lena Marsh", "Analyst"), ("u-omar", "Omar Haddad", "Analyst"), ("u-sam", "Sam Whitlock", "Viewer")):
        assert users[uid] == (name, role)
    terms = {t["id"]: t for t in adm.get("/api/terms").json()["terms"]}
    assert terms["t-claim"]["definition"] == "A request for payment for a covered service."
    assert terms["t-risk-score"]["name"] == "Risk score"
    seed = search(adm, as_of_seq=0).json()
    assert seed["as_of_at"] is None
    got = {r["id"]: r for r in seed["results"]}
    assert set(got) == set(SEED_COUNTS) and seed["total"] == len(SEED_COUNTS)
    for aid, counts in SEED_COUNTS.items():
        r = got[aid]
        assert (r["tagged_column_count"], r["pii_column_count"], r["confidential_column_count"]) == counts
        assert r["state"] == ("deprecated" if aid == "src.eligibility_2019" else "draft")
    assert {(e["from"], e["to"], e["transform"]) for e in adm.get("/api/graph", params={"as_of_seq": 0}).json()["edges"]} == SEED_EDGES
    col = adm.get(f"/api/columns/{enc('src.members.ssn')}", params={"as_of_seq": 0}).json()["column"]
    assert col["samples"] == ["900-11-2041", "900-11-3378", "900-11-4402"] and col["direct_tags"] == ["PII"]
    dep = adm.get(f"/api/assets/{enc('src.eligibility_2019')}", params={"as_of_seq": 0}).json()["asset"]
    assert dep["deprecation"]["reason"] == "Replaced by the 2024 eligibility feed." and dep["deprecation"]["by"]["id"] == "u-morgan"
    first = Postgres().rows("select seq, prev_hash from audit_log order by seq limit 1")
    if first:
        assert first[0]["seq"] == 1 and first[0]["prev_hash"] == ZERO_HASH


def test_server_boundary(app_url):
    steward = make_user(app_url, "Steward")

    def nested(depth):
        value: list = []
        for _ in range(depth - 2):
            value = [value]
        return {"name": "Depth probe " + uuid.uuid4().hex, "definition": "d", "x": value}

    assert steward.post("/api/terms", json=nested(DEPTH_OK)).status_code == 201
    deep = steward.post("/api/terms", json=nested(DEPTH_OK + 1))
    assert deep.status_code == 422
    assert deep.json() == {"error": {"code": "validation", "message": "Request body is nested too deeply.", "fields": {}}}
    term = steward.post("/api/terms", json={"name": "Prec " + uuid.uuid4().hex, "definition": "d"}).json()["term"]
    steward.patch(f"/api/terms/{term['id']}", {"revision": 1, "definition": "d2"})
    assert steward.patch(f"/api/terms/{term['id']}", {"revision": 1, "name": ""}).json()["error"]["code"] == "term_stale"
    assert make_user(app_url, "Analyst").patch("/api/terms/t-unknown-" + uuid.uuid4().hex, {"revision": 1}).json() == ERR_404
    anon = httpx.post(app_url + "/api/terms", content=b'{"pad":"' + b"p" * JSON_LIMIT + b'"}',
                      headers={"Content-Type": "application/json", "Origin": app_url})
    assert anon.status_code == 413 and anon.json() == ERR_413
    for path in ("/.env", "/run.json", "/package.json", "/package-lock.json"):
        assert httpx.get(app_url + path).status_code == 404, path
    secrets = [os.environ[k] for k in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "S3_BUCKET")
               if len(os.environ.get(k, "")) >= 6]
    html = httpx.get(app_url + "/signin").text
    bodies = [html] + [httpx.get(app_url + src if src.startswith("/") else src).text
                       for src in re.findall(r'src="([^"]+\.js)"', html) if same_origin_path(src)]
    for body in bodies:
        for secret in secrets:
            assert secret not in body


def same_origin_path(src: str) -> bool:
    return src[:1] == "/" and src[1:2] != "/"


def shipped_packages() -> dict[str, str]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json"], cwd="/app", capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    tree = json.loads(out.stdout or "{}")
    found: dict[str, str] = {}

    def walk(deps):
        for name, info in (deps or {}).items():
            if info.get("version") and not info.get("missing"):
                found[name] = info["version"]
            walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return found


def licence_of(name: str) -> str:
    for pj in [Path("/app/node_modules") / name / "package.json"] + list(Path("/app/node_modules").glob(f"**/node_modules/{name}/package.json")):
        if pj.exists():
            meta = json.loads(pj.read_text())
            lic = meta.get("license") or (meta.get("licenses") or [{}])[0]
            return lic.get("type", "") if isinstance(lic, dict) else str(lic)
    return ""


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for name in shipped_packages():
        assert name in notices, name
    for item in ("Fraunces", "IBM Plex Sans", "IBM Plex Mono", "Lucide"):
        assert item in notices


def test_if_licences_allowed():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
    for name in shipped_packages():
        parts = re.split(r"\s+OR\s+", licence_of(name).strip("()"))
        assert any(p.strip("() ") in allowed for p in parts), (name, licence_of(name))
    assert "SIL Open Font License" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level", "lmdb", "@redis/client", "mongodb"}
    assert not banned & set(shipped_packages())


def test_if_seed_credentials_unmodified(app_url):
    for email in (MORGAN, DANA, RUI, LENA, OMAR, SAM):
        Api(app_url, email)


def test_if_no_third_party_requests(browser, app_url):
    urls: list[str] = []
    with open_app(browser, app_url + "/signin") as page:
        page.on("request", lambda r: urls.append(r.url))
        page.reload()
        page.context.add_cookies([{"name": "strata_session", "value": Api(app_url, LENA).token, "url": app_url}])
        page.goto(app_url + "/catalog")
        advance(page, 1000)
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    assert urls and all(u.startswith(origin) or u.startswith("data:") or u.startswith("blob:") for u in urls)


def test_if_lockfile_matches():
    pkg = json.loads(Path("/app/package.json").read_text())
    lock = json.loads(Path("/app/package-lock.json").read_text())
    root = lock["packages"][""]
    assert root.get("dependencies", {}) == pkg.get("dependencies", {})
    assert root.get("devDependencies", {}) == pkg.get("devDependencies", {})
