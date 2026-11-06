from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
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
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, quote, urljoin, urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import expect

import conftest
from conftest import (
    Postgres,
    advance,
    animations,
    axe,
    click,
    fill,
    held,
    idempotency_key,
    open_app,
    post_json,
    same_origin,
    select,
    state_styles,
    style,
    tab_order,
    unique,
    until,
)


API = "/api/v1"
HTTP_TIMEOUT = 30
EXPECT_MS = 15000
POLL_S = 30
BOOT_S = 120
COPY_STOP_S = 20
WINDOW_WAIT_S = 120

expect.set_options(timeout=EXPECT_MS)

PASSWORD = "deku-demo-pw-2026"
NW_APP = "app_nw7k2m9q4x1z"
ACME_APP = "app_ac3p8r5t6v2w"
OWNER = "nw.owner@example.com"
OPERATOR = "nw.operator@example.com"
APPROVER1 = "nw.approver1@example.com"
APPROVER2 = "nw.approver2@example.com"
AUDITOR = "nw.auditor@example.com"
ACME_OWNER = "acme.owner@example.com"

SEED_MEMBERS = [
    ("mem_nw_owner", "Nadia Owens", OWNER, "owner", "org_northwind"),
    ("mem_nw_operator", "Omar Patel", OPERATOR, "operator", "org_northwind"),
    ("mem_nw_approver1", "Ada Byrne", APPROVER1, "approver", "org_northwind"),
    ("mem_nw_approver2", "Ben Okoro", APPROVER2, "approver", "org_northwind"),
    ("mem_nw_auditor", "Uma Diaz", AUDITOR, "auditor", "org_northwind"),
    ("mem_acme_owner", "Jordan Lee", ACME_OWNER, "owner", "org_acme"),
]

VENDOR1 = "0x1111111111111111111111111111111111111111"
VENDOR2 = "0x2222222222222222222222222222222222222222"
VENDOR3 = "0x3333333333333333333333333333333333333333"
LINE_A = "0x4444444444444444444444444444444444444444"
LINE_B = "0x5555555555555555555555555555555555555555"
BURN = "0x000000000000000000000000000000000000dead"
CHECKSUM_OK = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
CHECKSUM_BAD = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
ZERO_HASH = "0" * 64

DECIMALS = {"usdc": 6, "eth": 18}
SEED_EXPIRY = 604800
DAY_S = 86400
MIN_WINDOW_S = 60
EXPIRY_S = 60
SWEEP_S = 5
PAGE_SIZE = 20
MAX_LIMIT = 100
MAX_BODY = 1_000_000
PERF_MS = 500
MAX_RULES = 50
MAX_LINES = 100
MEMO_MAX = 140
REASON_MAX = 280
WALLET_NAME_MAX = 60
NAME_MAX = 80
REFERENCE_MAX = 64
KEY_MAX = 128
CONTACT_NAME_MAX = 80
CONTACT_COMPANY_MAX = 120
CONTACT_MESSAGE_MIN = 10
MAX_WHOLE = "1000000000"
HERO_STEP_PX = 200
HERO_END_PX = 400
PHONE_W, PHONE_H = 375, 812
TABLET_W, TABLET_H = 768, 1024
DESK_W, DESK_H = 1280, 800
QUORUM_CAP = 10

RACERS = 8
RETENTION_S = 5
SEED_PAID = "int_seed_paid"
SEED_PENDING = "int_seed_pending"
POL_OPERATING = "pol_operating"
AGG_DAILY = "agg_daily_outflow"
NW_OWNER_ID = "mem_nw_owner"
ACME_OWNER_ID = "mem_acme_owner"
REJECT_REASON = "Q4 logistics invoice"
KEPT_TEXT = "October hardware"
CONTACT_NAME = "Ada Byrne"
CONTACT_COMPANY = "Northwind Treasury"
CONTACT_MESSAGE = "Talk to our team about building with Corvo"
OTHER_STORES = ("SQLite", "Redis")
FOREIGN_NEXT = "https://example.com/console"
PRIVATE_PATHS = ("/run.json", "/package.json", "/package-lock.json", "/.env",
                 "/node_modules/.package-lock.json")
SETTLE_MS = 1000
UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
MEMBER_KEYS = {"id", "name", "email", "role", "created_at"}
KEY_KEYS = {"id", "name", "role", "prefix", "created_by", "created_at", "revoked_at"}
INTENT_KEYS = {
    "id", "wallet_id", "kind", "destination_address", "amount", "raw_amount", "memo", "status", "created_by",
    "required_approvals", "quorum_member_ids", "approvals", "policy_decision", "created_at", "expires_at",
    "decided_at", "executed_at", "tx_hash", "rejection_reason", "items",
}
WALLET_KEYS = {
    "id", "name", "chain", "asset", "address", "balance", "balance_raw", "reserved", "reserved_raw", "available",
    "available_raw", "policy_id", "quorum_id", "approval_floor", "approval_floor_raw", "status", "created_at",
}
TABLES = [
    "organizations", "members", "sessions", "api_keys", "wallets", "policies", "policy_revisions", "aggregations",
    "key_quorums", "intents", "intent_items", "approvals", "deposits", "ledger_entries", "idempotency_records",
    "audit_events", "webhook_events", "contact_requests",
]
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
APP_ROOT = Path("/app")
NOBODY = object()


def tag() -> str:
    return uuid.uuid4().hex[:10]


def person(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    name, email = (a, b) if "@" in b else (b, a)
    return name.strip()[:NAME_MAX], email.strip().lower()


_DB = None


def db() -> Postgres:
    global _DB
    if _DB is None:
        _DB = Postgres()
    return _DB


def lit(value) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def count(table: str, where: str) -> int:
    return db().rows(f"SELECT count(*)::int AS n FROM {table} WHERE {where}")[0]["n"]


def db_now() -> int:
    return int(db().rows("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS t")[0]["t"])


def poll(fn, seconds: float, what: str):
    end = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < end, what


def wait_server_second(target: int, seconds: float = WINDOW_WAIT_S) -> None:
    poll(lambda: db_now() >= target, seconds, f"server clock never reached {target}")


def next_second() -> None:
    start = db_now()
    poll(lambda: db_now() > start, POLL_S, "server clock did not advance")


def ts(stamp: str) -> int:
    return int(datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def raw(amount: str, asset: str = "usdc") -> int:
    whole, _, frac = amount.partition(".")
    places = DECIMALS[asset]
    return int(whole) * 10 ** places + int((frac + "0" * places)[:places] or "0")


def address_of(wallet_id: str) -> str:
    return "0x" + hashlib.sha256(("corvo:" + wallet_id).encode()).hexdigest()[:40]


def display(raw_value: int, asset: str = "usdc") -> str:
    places = DECIMALS[asset]
    whole, frac = divmod(raw_value, 10 ** places)
    digits = str(frac).rjust(places, "0").rstrip("0")
    return f"{whole}.{digits}" if digits else str(whole)


def evaluate_path(policy_id: str) -> str:
    return f"/policies/{policy_id}/evaluate"


def tx_of(intent_id: str) -> str:
    return "0x" + hashlib.sha256(("corvo-tx:" + intent_id).encode()).hexdigest()


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def chain_hash(prev_hash: str, event: dict) -> str:
    obj = {k: event[k] for k in ("seq", "type", "actor", "subject_id", "at", "data")}
    return hashlib.sha256(prev_hash.encode("utf-8") + canonical(obj)).hexdigest()


def signature(secret: str, event: dict) -> str:
    message = f"{event['id']}.{event['timestamp']}.{event['body']}".encode("utf-8")
    return "v1," + base64.b64encode(hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()).decode()


class Api:
    def __init__(self, base: str, token: str | None = None, app_id: str | None = None, member: dict | None = None):
        self.base, self.token, self.app_id, self.member = base.rstrip("/"), token, app_id, member
        self.http = httpx.Client(timeout=HTTP_TIMEOUT)

    def clone(self) -> "Api":
        return Api(self.base, self.token, self.app_id, self.member)

    def call(self, method, path, body=NOBODY, key=None, headers=None, params=None, raw_body=None):
        h = {}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if self.app_id:
            h["X-Corvo-Org"] = self.app_id
        if key is not None:
            h["Idempotency-Key"] = key
        content = None
        if raw_body is not None:
            content = raw_body
            h["Content-Type"] = "application/json"
        elif body is not NOBODY:
            content = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        return self.http.request(method, self.base + API + path, content=content, headers=h, params=params)

    def get(self, path, **kw):
        return self.call("GET", path, **kw)

    def post(self, path, body=NOBODY, **kw):
        return self.call("POST", path, body, **kw)

    def patch(self, path, body=NOBODY, **kw):
        return self.call("PATCH", path, body, **kw)

    def delete(self, path, **kw):
        return self.call("DELETE", path, **kw)


def envelope(r: httpx.Response) -> dict:
    body = r.json()
    assert {"success", "data", "error", "meta"} <= set(body), body
    assert UUID4.match(body["meta"]["request_id"]), body["meta"]
    return body


def ok(r: httpx.Response, status: int = 200):
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    body = envelope(r)
    assert body["success"] is True and body["error"] is None, body
    return body["data"]


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    body = envelope(r)
    assert body["success"] is False and body["data"] is None, body
    error = body["error"]
    assert error["code"] == code, error
    assert isinstance(error["message"], str) and error["message"].strip()
    assert isinstance(error["details"], dict)
    return error


def field_err(r, code, field, status=422):
    e = err(r, status, code)
    assert e["details"].get("field") == field, e
    return e


def login(base: str, email: str, password: str = PASSWORD) -> Api:
    r = httpx.post(base + API + "/auth/login", json={"email": email, "password": password}, timeout=HTTP_TIMEOUT)
    data = ok(r)
    return Api(base, data["token"], data["organization"]["app_id"], data["member"])


def add_member(owner: Api, role: str):
    name, email = person(role)
    member = ok(owner.post("/members", {"name": name, "email": email, "role": role, "password": PASSWORD}), 201)
    return member, login(owner.base, email)


def rule(name, method="transfer", action="ALLOW", conditions=()):
    return {"name": name, "method": method, "conditions": list(conditions), "action": action}


def cond(field, operator, value, source="request_body"):
    return {"field_source": source, "field": field, "operator": operator, "value": value}


def new_policy(owner: Api, rules, name=None) -> dict:
    body = {"version": "1.0", "name": name or f"Policy {tag()}", "chain_type": "ethereum", "rules": rules}
    return ok(owner.post("/policies", body), 201)


def new_quorum(owner: Api, member_ids, threshold, expiry=SEED_EXPIRY) -> dict:
    body = {"name": f"Quorum {tag()}", "member_ids": list(member_ids), "authorization_threshold": threshold,
            "expiry_seconds": expiry}
    return ok(owner.post("/quorums", body), 201)


def new_aggregation(owner: Api, metric="sum_amount", window=DAY_S, asset="usdc", group_by="wallet") -> dict:
    body = {"name": f"Agg {tag()}", "metric": metric, "window_seconds": window, "asset": asset, "group_by": group_by}
    return ok(owner.post("/aggregations", body), 201)


def wallet(c: Api, wid: str) -> dict:
    return ok(c.get(f"/wallets/{wid}"))


def new_wallet(owner: Api, funds=None, asset="usdc", chain="base", policy_id=None, quorum_id=None, floor=None,
               name=None) -> dict:
    body = {"name": name or f"Wallet {tag()}", "chain": chain, "asset": asset}
    if policy_id:
        body["policy_id"] = policy_id
    if quorum_id:
        body["quorum_id"] = quorum_id
    if floor is not None:
        body["approval_floor"] = floor
    w = ok(owner.post("/wallets", body), 201)
    if funds:
        ok(deposit(owner, w["id"], funds), 201)
    return wallet(owner, w["id"])


def transfer(c, wid, dest, amount, memo=None, key=None):
    body = {"destination_address": dest, "amount": amount}
    if memo is not None:
        body["memo"] = memo
    return c.post(f"/wallets/{wid}/transfers", body, key=key)


def batch(c, wid, lines, key=None):
    items = [{"destination_address": d, "amount": a, "memo": m} for d, a, m in lines]
    return c.post(f"/wallets/{wid}/batches", {"items": items}, key=key)


def deposit(c, wid, amount, reference=None, key=None):
    return c.post(f"/wallets/{wid}/deposits", {"amount": amount, "reference": reference or f"ref-{tag()}"}, key=key)


def approve(c, iid):
    return c.post(f"/intents/{iid}/approve")


def reject(c, iid, reason):
    return c.post(f"/intents/{iid}/reject", {"reason": reason})


def cancel(c, iid):
    return c.post(f"/intents/{iid}/cancel")


class Team:
    pass


def team(base: str, approvers: int = 2, threshold: int = 2, expiry: int = SEED_EXPIRY) -> Team:
    t = Team()
    t.owner = login(base, OWNER)
    t.op_m, t.op = add_member(t.owner, "operator")
    t.apprs = [add_member(t.owner, "approver") for _ in range(approvers)]
    t.quorum = new_quorum(t.owner, [m["id"] for m, _ in t.apprs], threshold, expiry)
    return t


def race(*fns):
    barrier = threading.Barrier(len(fns))

    def go(fn):
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(fns)) as pool:
        return list(pool.map(go, fns))


def ledger(intent_id: str) -> list[dict]:
    return db().rows(
        "SELECT movement_id, account, raw_amount::text AS amount, kind FROM ledger_entries "
        "WHERE movement_id IN (SELECT movement_id FROM ledger_entries "
        f"WHERE intent_id = {lit(intent_id)}) ORDER BY id")


def assert_pairs(rows: list[dict]) -> dict:
    movements: dict = {}
    for r in rows:
        movements.setdefault(r["movement_id"], []).append(int(r["amount"]))
    for amounts in movements.values():
        assert len(amounts) == 2 and sum(amounts) == 0, movements
    return movements


def assert_balanced(*wallet_ids: str) -> None:
    for wid in wallet_ids:
        r = db().rows(
            "SELECT w.balance_raw::text AS bal, (SELECT COALESCE(sum(e.raw_amount), 0) FROM ledger_entries e "
            f"WHERE e.account = w.id)::text AS total FROM wallets w WHERE w.id = {lit(wid)}")[0]
        assert int(r["bal"]) == int(r["total"]) and int(r["bal"]) >= 0, (wid, r)


def assert_reservations(*wallet_ids: str) -> None:
    for wid in wallet_ids:
        r = db().rows(
            "SELECT w.balance_raw::text AS bal, (SELECT COALESCE(sum(i.raw_amount), 0) FROM intents i "
            f"WHERE i.wallet_id = w.id AND i.status = 'pending_approval')::text AS reserved FROM wallets w "
            f"WHERE w.id = {lit(wid)}")[0]
        bal, reserved = int(r["bal"]), int(r["reserved"])
        assert bal >= 0 and bal - reserved >= 0, (wid, r)


def audit_rows(subject: str) -> list[dict]:
    return db().rows("SELECT seq, type, actor, data::jsonb AS data FROM audit_events "
                     f"WHERE subject_id = {lit(subject)} ORDER BY seq")


def wallet_audit_count(wid: str) -> int:
    return count("audit_events", f"subject_id = {lit(wid)} OR data->>'wallet_id' = {lit(wid)}")


def page_text(page) -> str:
    return page.evaluate(
        "() => [document.body.innerText, ...Array.from(document.querySelectorAll('input,textarea'))"
        ".map(e => e.value)].join('\\n')")


def control_text(locator) -> str:
    return locator.evaluate(
        """root => {
            const parts = [];
            const visit = node => {
                if (node.nodeType === Node.TEXT_NODE) { parts.push(node.data); return; }
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                const tag = node.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE') return;
                if (tag === 'INPUT' || tag === 'TEXTAREA') { parts.push(' ' + node.value + ' '); return; }
                if (tag === 'SELECT') {
                    parts.push(' ' + Array.from(node.selectedOptions).map(o => o.text + ' ' + o.value).join(' ') + ' ');
                    return;
                }
                node.childNodes.forEach(visit);
            };
            visit(root);
            return parts.join(' ');
        }""")


def notifications(page):
    return page.get_by_role("status", name="Notifications")


def sign_in(page, email: str, password: str = PASSWORD) -> None:
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password"), password)
    click(page.get_by_role("button", name="Sign in"))


@contextmanager
def console(browser, app_url: str, email: str, path: str = "/console", **options):
    with open_app(browser, f"{app_url}/login?next={quote(path, safe='/')}", **options) as page:
        sign_in(page, email)
        page.wait_for_url(lambda u: urlsplit(u).path == path, timeout=EXPECT_MS)
        yield page


def pending_ids(wid: str) -> list[str]:
    rows = db().rows(f"SELECT id FROM intents WHERE wallet_id = {lit(wid)} AND status = 'pending_approval'")
    return [r["id"] for r in rows]


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Copy:
    def __init__(self, proc, base, log):
        self.proc, self.base, self.log = proc, base, log

    def tail(self) -> str:
        return Path(self.log).read_text(errors="replace")[-4000:]


@contextmanager
def app_copy(database_url: str, **extra_env):
    root = getattr(conftest, "DEPLOYED_APP", None)
    assert root, "conftest.DEPLOYED_APP must name the installed and built copy of the app"
    manifest = json.loads(Path(root, "run.json").read_text())
    port = free_port()
    log = tempfile.NamedTemporaryFile(prefix="corvo-copy-", suffix=".log", delete=False)
    env = {**os.environ, "DATABASE_URL": database_url, "APP_PUBLIC_PORT": str(port),
           "APP_PUBLIC_URL": f"http://127.0.0.1:{port}", **extra_env}
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    copy = Copy(proc, f"http://127.0.0.1:{port}", log.name)
    try:
        yield copy
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=COPY_STOP_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        log.close()


def wait_health(copy: Copy, predicate, what: str, seconds: float = BOOT_S) -> httpx.Response:
    end = time.monotonic() + seconds
    while True:
        assert copy.proc.poll() is None, f"copy exited while waiting for {what}:\n{copy.tail()}"
        try:
            r = httpx.get(copy.base + "/api/health", timeout=5)
        except httpx.HTTPError:
            r = None
        if r is not None and predicate(r):
            return r
        assert time.monotonic() < end, f"{what} never happened:\n{copy.tail()}"


class Relay:

    def __init__(self, host: str, port: int):
        self.target, self.enabled, self.alive = (host, port), False, True
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self.accept_loop, daemon=True).start()

    def accept_loop(self):
        while self.alive:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            if not self.enabled:
                client.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=5)
            except OSError:
                client.close()
                continue
            upstream.settimeout(None)
            with self.lock:
                self.conns += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self.pump, args=(a, b), daemon=True).start()

    @staticmethod
    def pump(a, b):
        try:
            while True:
                data = a.recv(65536)
                if not data:
                    break
                b.sendall(data)
        except OSError:
            pass
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def set(self, enabled: bool):
        self.enabled = enabled
        if not enabled:
            with self.lock:
                conns, self.conns = self.conns, []
            for s in conns:
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                s.close()

    def stop(self):
        self.alive = False
        self.set(False)
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def via_relay(database_url: str, port: int) -> str:
    parts = urlsplit(database_url)
    userinfo = parts.netloc.rpartition("@")[0]
    netloc = (userinfo + "@" if userinfo else "") + f"127.0.0.1:{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def test_wf_payout_quorum_console_send_approve(browser, app_url):
    t = team(app_url, approvers=2, threshold=2)
    src = new_wallet(t.owner, funds="250000", quorum_id=t.quorum["id"], floor="10000")
    dst = new_wallet(t.owner)
    with console(browser, app_url, t.op_m["email"], f"/console/wallets/{src['id']}") as page:
        send = page.get_by_role("form", name="Send")
        fill(send.get_by_role("textbox", name="Destination address"), dst["address"])
        fill(send.get_by_role("textbox", name="Amount"), "15000")
        fill(send.get_by_role("textbox", name="Memo"), "October hardware")
        click(send.get_by_role("button", name="Send"))
        threshold = t.quorum["authorization_threshold"]
        expect(page.get_by_text(f"Waiting for approval: 0 of {threshold} approvals").first).to_be_visible()
        ids = pending_ids(src["id"])
        assert len(ids) == 1
        iid = ids[0]
        after = wallet(t.owner, src["id"])
        balance, reserved = raw("250000"), raw("15000")
        assert (after["balance"], after["reserved"], after["available"]) == (
            display(balance), display(reserved), display(balance - reserved))
        page.reload()
        expect(page.get_by_text(f"{display(balance - reserved)} USDC").first).to_be_visible()
        expect(page.get_by_text(f"{display(balance)} USDC").first).to_be_visible()
        page.goto(f"{app_url}/console/approvals")
        expect(page.get_by_role("button", name="Approve")).to_have_count(0)
        page.goto(f"{app_url}/console/intents")
        expect(page.get_by_role("button", name=f"Details for {iid}")).to_be_visible()
        expect(page.get_by_role("button", name="Approve")).to_have_count(0)
    for k, (member, _) in enumerate(t.apprs):
        with console(browser, app_url, member["email"], "/console/approvals") as page:
            row = page.get_by_role("group", name=f"Intent {iid}", exact=True)
            expect(row).to_contain_text(f"{k} of 2 approvals")
            expect(row).to_contain_text(f"{display(reserved)} USDC")
            expect(row).to_contain_text("October hardware")
            click(row.get_by_role("button", name="Approve"))
            expect(notifications(page)).to_contain_text(
                f"Approved: {1} of {threshold} approvals" if k == 0 else "Transfer executed")
            poll(lambda: advance(page, SETTLE_MS) or row.count() == 0, POLL_S, f"Intent {iid}")
    intent = ok(t.owner.get(f"/intents/{iid}"))
    assert intent["status"] == "executed" and intent["tx_hash"] == tx_of(iid)
    assert wallet(t.owner, src["id"])["balance"] == display(balance - reserved)
    assert wallet(t.owner, dst["id"])["balance"] == "15000"
    rows = ledger(iid)
    movements = assert_pairs(rows)
    assert len(movements) == 1
    assert {r["account"]: int(r["amount"]) for r in rows} == {src["id"]: -raw("15000"), dst["id"]: raw("15000")}
    assert all(r["kind"] == "transfer" for r in rows)
    assert_balanced(src["id"], dst["id"])


def test_wf_payout_quorum_reservation_snapshot(app_url):
    t = team(app_url, approvers=3, threshold=2)
    allow_name = f"Allow all {tag()}"
    policy = new_policy(t.owner, [rule(allow_name, "*")])
    w = new_wallet(t.owner, funds="1000", policy_id=policy["id"], quorum_id=t.quorum["id"], floor="100")
    small = ok(transfer(t.op, w["id"], VENDOR1, "99.999999"), 201)
    assert small["status"] == "executed"
    i = ok(transfer(t.op, w["id"], VENDOR2, "100", memo="Floor payout"), 201)
    assert INTENT_KEYS <= set(i)
    assert i["status"] == "pending_approval" and i["required_approvals"] == 2
    members = sorted(m["id"] for m, _ in t.apprs)
    assert sorted(i["quorum_member_ids"]) == members
    assert ts(i["expires_at"]) - ts(i["created_at"]) == SEED_EXPIRY
    assert i["policy_decision"] == {"action": "ALLOW", "rule": allow_name, "reason": "matched_rule",
                                    "policy_id": policy["id"], "policy_revision": 1}
    assert i["tx_hash"] is None and i["executed_at"] is None and i["approvals"] == []
    after = wallet(t.owner, w["id"])
    balance, reserved = raw("1000") - raw("99.999999"), raw("100")
    assert (after["balance"], after["reserved"], after["available"]) == (
        display(balance), display(reserved), display(balance - reserved))
    assert (after["balance_raw"], after["reserved_raw"], after["available_raw"]) == (
        str(balance), str(reserved), str(balance - reserved))
    assert_reservations(w["id"])
    assert count("ledger_entries", f"intent_id = {lit(i['id'])}") == 0


def test_quorum_snapshot(app_url):
    t = team(app_url, approvers=3, threshold=2)
    allow_name = f"Allow all {tag()}"
    policy = new_policy(t.owner, [rule(allow_name, "*")])
    w = new_wallet(t.owner, funds="1000", policy_id=policy["id"], quorum_id=t.quorum["id"], floor="100")
    i = ok(transfer(t.op, w["id"], VENDOR2, "100", memo="Floor payout"), 201)
    assert i["status"] == "pending_approval"
    members = sorted(m["id"] for m, _ in t.apprs)
    ok(t.owner.patch(f"/quorums/{t.quorum['id']}", {"member_ids": [t.apprs[0][0]["id"]],
                                                    "authorization_threshold": 1, "expiry_seconds": DAY_S}))
    revised = ok(t.owner.patch(f"/policies/{policy['id']}", {"rules": [rule(allow_name, "*"), rule("Second", "*")]}))
    assert revised["revision"] == 2
    again = ok(t.owner.get(f"/intents/{i['id']}"))
    assert again["required_approvals"] == 2 and sorted(again["quorum_member_ids"]) == members
    assert again["expires_at"] == i["expires_at"] and again["policy_decision"]["policy_revision"] == 1
    removed_member_api = t.apprs[2][1]
    still = ok(approve(removed_member_api, i["id"]))
    assert still["status"] == "pending_approval" and len(still["approvals"]) == 1
    fresh = ok(transfer(t.op, w["id"], VENDOR2, "100"), 201)
    assert fresh["required_approvals"] == 1 and fresh["quorum_member_ids"] == [t.apprs[0][0]["id"]]
    assert ts(fresh["expires_at"]) - ts(fresh["created_at"]) == DAY_S
    assert fresh["policy_decision"]["policy_revision"] == 2


def test_paired_ledger(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    src = new_wallet(owner, funds="100")
    dst = new_wallet(owner)
    d = ok(deposit(op, src["id"], "5"), 201)
    dep = db().rows("SELECT movement_id, account, raw_amount::text AS amount, kind FROM ledger_entries "
                    "WHERE movement_id IN (SELECT movement_id FROM ledger_entries "
                    f"WHERE deposit_id = {lit(d['id'])})")
    assert len(assert_pairs(dep)) == 1 and all(r["kind"] == "deposit" for r in dep)
    assert {r["account"]: int(r["amount"]) for r in dep} == {src["id"]: raw("5"), "external": -raw("5")}
    assert_balanced(src["id"], dst["id"])
    i = ok(transfer(op, src["id"], dst["address"], "30"), 201)
    rows = ledger(i["id"])
    assert len(assert_pairs(rows)) == 1 and all(r["kind"] == "transfer" for r in rows)
    assert {r["account"]: int(r["amount"]) for r in rows} == {src["id"]: -raw("30"), dst["id"]: raw("30")}
    assert_balanced(src["id"], dst["id"])
    b = ok(batch(op, src["id"], [(LINE_A, "10", ""), (dst["address"], "20", "")]), 201)
    rows = ledger(b["id"])
    assert len(assert_pairs(rows)) == 2 and all(r["kind"] == "batch_line" for r in rows)
    assert sorted((r["account"], int(r["amount"])) for r in rows) == sorted([
        (src["id"], -raw("10")), ("external", raw("10")), (src["id"], -raw("20")), (dst["id"], raw("20"))])
    assert wallet(owner, src["id"])["balance"] == "45" and wallet(owner, dst["id"])["balance"] == "50"
    assert_balanced(src["id"], dst["id"])


def test_wf_payout_quorum_decision_rules(app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner_m, owner2 = add_member(t.owner, "owner")
    q2 = new_quorum(t.owner, [owner_m["id"], t.apprs[0][0]["id"], t.apprs[1][0]["id"]], 2)
    policy = new_policy(t.owner, [rule(f"Allow all {tag()}", "*")])
    w = new_wallet(t.owner, funds="1000", policy_id=policy["id"], quorum_id=t.quorum["id"], floor="0")
    i = ok(transfer(t.op, w["id"], VENDOR1, "10"), 201)
    missing = "int_" + "0" * 20
    _, auditor = add_member(t.owner, "auditor")
    err(approve(auditor, missing), 404, "INTENT_NOT_FOUND")
    err(approve(auditor, i["id"]), 403, "NOT_IN_QUORUM")
    err(approve(t.op, i["id"]), 403, "NOT_IN_QUORUM")
    err(approve(t.owner, i["id"]), 403, "NOT_IN_QUORUM")
    for role in ("operator", "auditor"):
        created = ok(t.owner.post("/api-keys", {"name": f"Key {tag()}", "role": role}), 201)
        key = Api(app_url, created["secret"], NW_APP)
        err(approve(key, missing), 404, "INTENT_NOT_FOUND")
        err(approve(key, i["id"]), 403, "FORBIDDEN_ROLE")
        err(reject(key, i["id"], "No"), 403, "FORBIDDEN_ROLE")
    a0, a1 = t.apprs[0][1], t.apprs[1][1]
    field_err(a0.post(f"/intents/{i['id']}/approve", {"note": "x"}), "UNKNOWN_FIELD", "note")
    first = ok(approve(a0, i["id"]))
    assert first["status"] == "pending_approval"
    assert [a["member_id"] for a in first["approvals"]] == [t.apprs[0][0]["id"]]
    assert STAMP.match(first["approvals"][0]["created_at"])
    err(approve(a0, i["id"]), 409, "ALREADY_DECIDED")
    err(reject(a0, i["id"], "Changed my mind"), 409, "ALREADY_DECIDED")
    field_err(reject(a1, i["id"], "   "), "VALIDATION_ERROR", "reason")
    field_err(a1.post(f"/intents/{i['id']}/reject", {}), "VALIDATION_ERROR", "reason")
    ok(t.owner.patch(f"/policies/{policy['id']}", {"rules": [rule("Deny all", "*", "DENY")]}))
    done = ok(approve(a1, i["id"]))
    assert done["status"] == "executed" and done["tx_hash"] == tx_of(i["id"])
    assert done["executed_at"] == done["decided_at"] and STAMP.match(done["executed_at"])
    assert len(done["approvals"]) == 2
    err(approve(a1, i["id"]), 409, "INTENT_NOT_PENDING")
    events = audit_rows(i["id"])
    assert [e["type"] for e in events] == ["intent.created", "intent.approved", "intent.approved", "intent.executed"]
    assert events[3]["seq"] == events[2]["seq"] + 1
    after = wallet(t.owner, w["id"])
    assert (after["balance"], after["reserved"]) == (display(raw("1000") - raw("10")), "0")
    w2 = new_wallet(t.owner, funds="100", quorum_id=q2["id"], floor="0")
    j = ok(transfer(owner2, w2["id"], VENDOR1, "5"), 201)
    err(approve(owner2, j["id"]), 403, "SELF_APPROVAL")
    rejected = ok(reject(a0, j["id"], REJECT_REASON))
    assert rejected["status"] == "rejected" and rejected["rejection_reason"] == REJECT_REASON
    assert STAMP.match(rejected["decided_at"])
    err(approve(a1, j["id"]), 409, "INTENT_NOT_PENDING")
    w2_after = wallet(t.owner, w2["id"])
    assert (w2_after["balance"], w2_after["reserved"]) == ("100", "0")


def test_wf_payout_quorum_immediate_exact(app_url):
    t = team(app_url, approvers=2, threshold=2)
    w = new_wallet(t.owner, funds="500", quorum_id=t.quorum["id"], floor="100")
    i = ok(transfer(t.op, w["id"], VENDOR1, "1.5"), 201)
    assert i["status"] == "executed" and i["tx_hash"] == tx_of(i["id"])
    assert i["required_approvals"] == 0 and i["quorum_member_ids"] == [] and i["expires_at"] is None
    assert (i["amount"], i["raw_amount"]) == ("1.5", "1500000") and STAMP.match(i["executed_at"])
    events = audit_rows(i["id"])
    assert [e["type"] for e in events] == ["intent.created", "intent.executed"]
    assert events[1]["seq"] == events[0]["seq"] + 1
    for e in events:
        assert set(e["data"]) == {"intent_id", "wallet_id", "kind", "raw_amount", "status"}
        assert e["data"]["intent_id"] == i["id"] and e["data"]["wallet_id"] == w["id"]
        assert str(e["data"]["raw_amount"]) == "1500000"
    assert wallet(t.owner, w["id"])["balance"] == display(raw("500") - raw("1.5"))
    rows = ledger(i["id"])
    assert len(assert_pairs(rows)) == 1
    assert {r["account"]: int(r["amount"]) for r in rows} == {w["id"]: -raw("1.5"), "external": raw("1.5")}
    gas = new_wallet(t.owner, funds="12.5", asset="eth", chain="ethereum")
    e = ok(transfer(t.op, gas["id"], VENDOR1, "1.250000000000000001"), 201)
    assert e["status"] == "executed" and e["raw_amount"] == "1250000000000000001"
    assert e["amount"] == "1.250000000000000001"
    after = wallet(t.owner, gas["id"])
    gas_left = raw("12.5", "eth") - raw("1.250000000000000001", "eth")
    assert (after["balance"], after["balance_raw"]) == (display(gas_left, "eth"), str(gas_left))
    dep_rows = db().rows(
        "SELECT movement_id, account, raw_amount::text AS amount, kind FROM ledger_entries "
        "WHERE movement_id IN (SELECT movement_id FROM ledger_entries "
        f"WHERE account = {lit(gas['id'])} OR (deposit_id IN (SELECT id FROM deposits WHERE wallet_id = {lit(gas['id'])})))")
    assert_pairs([r for r in dep_rows if r["kind"] == "deposit"])
    assert_balanced(w["id"], gas["id"])


def test_wf_race_safety_console_double_approve(browser, app_url):
    t = team(app_url, approvers=3, threshold=2)
    w = new_wallet(t.owner, funds="20000", quorum_id=t.quorum["id"], floor="10000")
    dst = new_wallet(t.owner)
    i = ok(transfer(t.op, w["id"], dst["address"], "15000"), 201)
    ok(approve(t.apprs[0][1], i["id"]))
    with console(browser, app_url, t.apprs[1][0]["email"], "/console/approvals") as p1, \
            console(browser, app_url, t.apprs[2][0]["email"], "/console/approvals") as p2:
        rows = [p.get_by_role("group", name=f"Intent {i['id']}", exact=True) for p in (p1, p2)]
        for row in rows:
            expect(row).to_contain_text("1 of 2 approvals")
        rows[0].get_by_role("button", name="Approve").click(no_wait_after=True)
        rows[1].get_by_role("button", name="Approve").click(no_wait_after=True)
        final = poll(lambda: ok(t.owner.get(f"/intents/{i['id']}")) if len(
            ok(t.owner.get(f"/intents/{i['id']}"))["approvals"]) == 2 else None, POLL_S, "no approval landed")
        winner_id = next(a["member_id"] for a in final["approvals"] if a["member_id"] != t.apprs[0][0]["id"])
        win = 0 if winner_id == t.apprs[1][0]["id"] else 1
        loser_api = t.apprs[2 - win][1]
        message = err(approve(loser_api, i["id"]), 409, "INTENT_NOT_PENDING")["message"]
        expect(notifications((p1, p2)[win])).to_contain_text("Transfer executed")
        expect(rows[1 - win]).to_contain_text(message)
        expect(notifications((p1, p2)[1 - win])).not_to_contain_text("Transfer executed")
    assert final["status"] == "executed"
    assert len(assert_pairs(ledger(i["id"]))) == 1
    assert wallet(t.owner, w["id"])["balance"] == "5000"
    assert wallet(t.owner, dst["id"])["balance"] == "15000"


def test_wf_race_safety_decision_races(app_url):
    t = team(app_url, approvers=4, threshold=2)
    w = new_wallet(t.owner, funds="1000", quorum_id=t.quorum["id"], floor="0")
    a = [api for _, api in t.apprs]

    def pending(amount):
        iid = ok(transfer(t.op, w["id"], VENDOR1, amount), 201)["id"]
        ok(approve(a[0], iid))
        return iid

    i1 = pending("10")
    results = race(*[lambda c=c: approve(c.clone(), i1) for c in a[1:]])
    wins = [r for r in results if r.status_code == 200]
    assert len(wins) == 1 and wins[0].json()["data"]["status"] == "executed"
    for r in results:
        if r is not wins[0]:
            err(r, 409, "INTENT_NOT_PENDING")
    assert len(ledger(i1)) == 2
    spent = raw("10")
    for loser_call, final_state in (
            (lambda iid: cancel(t.op.clone(), iid), "cancelled"),
            (lambda iid: reject(a[2].clone(), iid, "Not this one"), "rejected")):
        iid = pending("20")
        ra, rb = race(lambda: approve(a[1].clone(), iid), lambda: loser_call(iid))
        assert sorted([ra.status_code, rb.status_code]) == [200, 409]
        loser = ra if ra.status_code == 409 else rb
        err(loser, 409, "INTENT_NOT_PENDING")
        status = ok(t.owner.get(f"/intents/{iid}"))["status"]
        if ra.status_code == 200:
            assert status == "executed" and len(ledger(iid)) == 2
            spent += raw("20")
        else:
            assert status == final_state and ledger(iid) == []
    i4 = pending("40")
    ra, rf = race(lambda: approve(a[1].clone(), i4), lambda: t.owner.clone().post(f"/wallets/{w['id']}/freeze"))
    assert ok(rf)["status"] == "frozen"
    if ra.status_code == 200:
        assert ra.json()["data"]["status"] == "executed" and len(ledger(i4)) == 2
        spent += raw("40")
    else:
        err(ra, 409, "WALLET_FROZEN")
        assert ok(t.owner.get(f"/intents/{i4}"))["status"] == "pending_approval"
        assert count("approvals", f"intent_id = {lit(i4)}") == 1
    ok(t.owner.post(f"/wallets/{w['id']}/unfreeze"))
    assert int(wallet(t.owner, w["id"])["balance_raw"]) == raw("1000") - spent
    assert_balanced(w["id"])
    assert_reservations(w["id"])


def test_wf_race_safety_no_overdraw(app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    a = new_wallet(owner, funds="100")
    results = race(*[lambda: transfer(op.clone(), a["id"], VENDOR1, "30") for _ in range(RACERS)])
    assert sum(r.status_code == 201 for r in results) == 3
    for r in results:
        if r.status_code != 201:
            assert err(r, 409, "INSUFFICIENT_FUNDS")["details"] == {}
    assert (wallet(owner, a["id"])["balance"], wallet(owner, a["id"])["available"]) == ("10", "10")
    b = new_wallet(owner, funds="100", quorum_id=t.quorum["id"], floor="0")
    results = race(*[lambda: transfer(op.clone(), b["id"], VENDOR1, "40") for _ in range(RACERS)])
    assert sum(r.status_code == 201 for r in results) == 2
    for r in results:
        if r.status_code != 201:
            err(r, 409, "INSUFFICIENT_FUNDS")
    bw = wallet(owner, b["id"])
    assert (bw["balance"], bw["reserved"], bw["available"]) == ("100", "80", "20")
    c = new_wallet(owner, funds="100")
    half = RACERS // 2
    calls = [lambda: batch(op.clone(), c["id"], [(LINE_A, "15", ""), (LINE_B, "15", "")]) for _ in range(half)]
    calls += [lambda: transfer(op.clone(), c["id"], VENDOR1, "30") for _ in range(half)]
    results = race(*calls)
    assert sum(r.status_code == 201 for r in results) == 3
    for r in results:
        if r.status_code != 201:
            err(r, 409, "INSUFFICIENT_FUNDS")
    assert wallet(owner, c["id"])["balance"] == "10"
    d = new_wallet(owner, funds="30")
    calls = [lambda: deposit(op.clone(), d["id"], "10") for _ in range(half)]
    calls += [lambda: transfer(op.clone(), d["id"], VENDOR1, "30") for _ in range(half)]
    results = race(*calls)
    assert all(r.status_code == 201 for r in results[:half])
    sent = sum(r.status_code == 201 for r in results[half:])
    for r in results[half:]:
        if r.status_code != 201:
            err(r, 409, "INSUFFICIENT_FUNDS")
    assert int(wallet(owner, d["id"])["balance_raw"]) == raw("30") + half * raw("10") - sent * raw("30") >= 0
    for wid in (a["id"], b["id"], c["id"], d["id"]):
        view = wallet(owner, wid)
        assert int(view["available_raw"]) == int(view["balance_raw"]) - int(view["reserved_raw"]) >= 0
    assert_balanced(a["id"], b["id"], c["id"], d["id"])
    assert_reservations(a["id"], b["id"], c["id"], d["id"])


def test_wf_race_safety_idempotent_retry(app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    w = new_wallet(owner, funds="1000")
    body = {"destination_address": VENDOR1, "amount": "12.5", "memo": f"Retry {tag()}"}
    key = idempotency_key()
    path = f"/wallets/{w['id']}/transfers"
    first = op.post(path, body, key=key)
    ok(first, 201)
    replay = op.post(path, body, key=key)
    assert replay.status_code == 201 and replay.headers.get("Idempotent-Replayed") == "true"
    one, two = first.json(), replay.json()
    assert {k: two[k] for k in ("success", "data", "error")} == {k: one[k] for k in ("success", "data", "error")}
    assert two["meta"]["request_id"] != one["meta"]["request_id"] and UUID4.match(two["meta"]["request_id"])
    assert count("intents", f"memo = {lit(body['memo'])}") == 1
    assert wallet(owner, w["id"])["balance"] == display(raw("1000") - raw("12.5"))
    err(op.post(path, {**body, "amount": "13"}, key=key), 422, "IDEMPOTENCY_KEY_REUSED")
    err(op.call("POST", path, raw_body=json.dumps(body, indent=1).encode(), key=key), 422, "IDEMPOTENCY_KEY_REUSED")
    err(deposit(op, w["id"], "1", key=key), 422, "IDEMPOTENCY_KEY_REUSED")
    other = new_wallet(owner, funds="100")
    err(op.post(f"/wallets/{other['id']}/transfers", body, key=key), 422, "IDEMPOTENCY_KEY_REUSED")
    assert count("intents", f"memo = {lit(body['memo'])}") == 1
    acme = login(app_url, ACME_OWNER)
    acme_wallet = new_wallet(acme, funds="100")
    fresh = acme.post(f"/wallets/{acme_wallet['id']}/transfers", body, key=key)
    ok(fresh, 201)
    assert fresh.headers.get("Idempotent-Replayed") is None
    q = new_wallet(owner, funds="100", quorum_id=t.quorum["id"], floor="0")
    k2 = idempotency_key()
    pend_body = {"destination_address": VENDOR2, "amount": "5"}
    pend = ok(op.post(f"/wallets/{q['id']}/transfers", pend_body, key=k2), 201)
    for _, api in t.apprs:
        ok(approve(api, pend["id"]))
    later = op.post(f"/wallets/{q['id']}/transfers", pend_body, key=k2)
    assert later.status_code == 201 and later.json()["data"]["status"] == "pending_approval"
    pol = new_policy(owner, [rule(f"Block burn {tag()}", "transfer", "DENY", [cond("destination.address", "in", [BURN])])])
    dw = new_wallet(owner, funds="100", policy_id=pol["id"])
    k3 = idempotency_key()
    denied = op.post(f"/wallets/{dw['id']}/transfers", {"destination_address": BURN, "amount": "1"}, key=k3)
    err(denied, 403, "POLICY_DENIED")
    again = op.post(f"/wallets/{dw['id']}/transfers", {"destination_address": BURN, "amount": "1"}, key=k3)
    err(again, 403, "POLICY_DENIED")
    assert again.headers.get("Idempotent-Replayed") == "true"
    assert again.json()["error"] == denied.json()["error"]
    assert count("audit_events", f"type = 'transfer.denied' AND subject_id = {lit(dw['id'])}") == 1
    k4 = idempotency_key()
    big = {"destination_address": VENDOR1, "amount": "5000"}
    err(op.post(path, big, key=k4), 409, "INSUFFICIENT_FUNDS")
    ok(deposit(owner, w["id"], "5000"), 201)
    retried = op.post(path, big, key=k4)
    ok(retried, 201)
    assert retried.headers.get("Idempotent-Replayed") is None
    field_err(op.post(path, body, key=""), "VALIDATION_ERROR", "Idempotency-Key")
    field_err(op.post(path, body, key="k" * (KEY_MAX + 1)), "VALIDATION_ERROR", "Idempotency-Key")
    ref = f"ref-{tag()}"
    kd = idempotency_key()
    d1 = ok(deposit(op, w["id"], "7", ref, key=kd), 201)
    d2 = deposit(op, w["id"], "7", ref, key=kd)
    assert ok(d2, 201)["id"] == d1["id"] and d2.headers.get("Idempotent-Replayed") == "true"
    assert count("deposits", f"wallet_id = {lit(w['id'])} AND reference = {lit(ref)}") == 1
    kb = idempotency_key()
    lines = [(LINE_A, "1", f"line {tag()}")]
    b1 = ok(batch(op, w["id"], lines, key=kb), 201)
    b2 = batch(op, w["id"], lines, key=kb)
    assert ok(b2, 201)["id"] == b1["id"] and b2.headers.get("Idempotent-Replayed") == "true"
    assert count("intents", f"wallet_id = {lit(w['id'])} AND kind = 'batch'") == 1
    k5 = idempotency_key()
    memo = f"Concurrent {tag()}"
    results = race(*[lambda: transfer(op.clone(), w["id"], VENDOR2, "1", memo=memo, key=k5) for _ in range(RACERS)])
    created = set()
    for r in results:
        assert r.status_code < 500, r.text
        if r.status_code == 201:
            created.add(r.json()["data"]["id"])
        else:
            err(r, 409, "IDEMPOTENCY_KEY_IN_PROGRESS")
    assert len(created) == 1
    assert count("intents", f"memo = {lit(memo)}") == 1


def test_idempotency_retention(app_url):
    with app_copy(os.environ["DATABASE_URL"], CORVO_IDEMPOTENCY_RETENTION_SECONDS=str(RETENTION_S)) as copy:
        wait_health(copy, lambda r: r.status_code == 200, "copy healthy")
        owner = login(copy.base, OWNER)
        w = new_wallet(owner, funds="100")
        key = idempotency_key()
        memo = f"Retention {tag()}"
        first = ok(transfer(owner, w["id"], VENDOR1, "1", memo=memo, key=key), 201)
        replay = transfer(owner, w["id"], VENDOR1, "1", memo=memo, key=key)
        assert replay.headers.get("Idempotent-Replayed") == "true" and ok(replay, 201)["id"] == first["id"]
        wait_server_second(db_now() + RETENTION_S + 2)
        fresh = transfer(owner, w["id"], VENDOR1, "1", memo=memo, key=key)
        assert fresh.headers.get("Idempotent-Replayed") is None, copy.tail()
        assert ok(fresh, 201)["id"] != first["id"]
        assert count("intents", f"memo = {lit(memo)}") == 2
        again = transfer(owner, w["id"], VENDOR1, "1", memo=memo, key=key)
        assert again.headers.get("Idempotent-Replayed") == "true" and ok(again, 201)["id"] == ok(fresh, 201)["id"]


def test_wf_policy_decisions_send_outcomes(browser, app_url):
    owner = login(app_url, OWNER)
    op_m, op = add_member(owner, "operator")
    w = new_wallet(owner, funds="1000", policy_id="pol_operating")
    with console(browser, app_url, op_m["email"], f"/console/wallets/{w['id']}") as page:
        send = page.get_by_role("form", name="Send")
        dest, amount, memo = (send.get_by_role("textbox", name=n) for n in ("Destination address", "Amount", "Memo"))
        for to, value, text in (
                (BURN, "100", "Blocked by policy rule Block burn address"),
                (LINE_A, "10", "Blocked by policy: no rule allowed this transfer"),
                (address_of("wal_payroll"), "5000", "Not enough available balance")):
            fill(dest, to)
            fill(amount, value)
            fill(memo, KEPT_TEXT)
            click(send.get_by_role("button", name="Send"))
            expect(page.get_by_text(text).first).to_be_visible()
            expect(dest).to_have_value(to)
            expect(amount).to_have_value(value)
            expect(memo).to_have_value(KEPT_TEXT)
        fill(dest, VENDOR1)
        fill(amount, "10")
        click(send.get_by_role("button", name="Send"))
        expect(page.get_by_text("Transfer executed").first).to_be_visible()
    rows = db().rows(f"SELECT status, destination_address FROM intents WHERE wallet_id = {lit(w['id'])}")
    assert rows == [{"status": "executed", "destination_address": VENDOR1}]
    assert wallet(owner, w["id"])["balance"] == display(raw("1000") - raw("10"))
    assert wallet(owner, "wal_payroll")["balance"] == "40000"


def test_wf_policy_decisions_evaluation_trace(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    never, big, allow_vendor, deny_vendor, allow_batch, allow_small = (f"Rule {k}" for k in range(1, 7))
    rules = [
        rule(never, "transfer", "DENY", [cond("current_unix_timestamp", "lt", 1, "system")]),
        rule(big, "transfer", "DENY", [cond("source.amount", "gt", "500000000")]),
        rule(allow_vendor, "transfer", "ALLOW", [cond("destination.address", "eq", VENDOR1)]),
        rule(deny_vendor, "*", "DENY", [cond("destination.address", "in", [VENDOR1])]),
        rule(allow_batch, "batch_payout", "ALLOW"),
        rule(allow_small, "transfer", "ALLOW", [cond("source.amount", "lte", 100000000),
                                                cond("source.asset", "eq", "usdc")]),
    ]
    p = new_policy(owner, rules)
    w = new_wallet(owner, funds="1000")
    before = (wallet_audit_count(w["id"]), count("intents", f"wallet_id = {lit(w['id'])}"))

    def evaluate(method, dest, amount):
        return ok(owner.post(f"/policies/{p['id']}/evaluate", {"method": method, "wallet_id": w["id"],
                                                               "destination_address": dest, "amount": amount}))

    r = evaluate("transfer", VENDOR2, "10")
    assert {k: r[k] for k in ("action", "rule", "reason", "policy_id", "policy_revision")} == {
        "action": "ALLOW", "rule": allow_small, "reason": "matched_rule", "policy_id": p["id"], "policy_revision": 1}
    assert r["aggregations"] == {}
    assert [(x["rule"], x["considered"], x["matched"], x["conditions"]) for x in r["trace"]] == [
        (never, True, False, [False]), (big, True, False, [False]),
        (allow_vendor, True, False, [False]), (deny_vendor, True, False, [False]),
        (allow_batch, False, False, []), (allow_small, True, True, [True, True])]
    r = evaluate("transfer", VENDOR1, "10")
    assert (r["action"], r["rule"], r["reason"]) == ("DENY", deny_vendor, "matched_rule")
    assert [x["matched"] for x in r["trace"]] == [False, False, True, True, False, True]
    r = evaluate("transfer", VENDOR2, "600")
    assert (r["action"], r["rule"]) == ("DENY", big)
    r = evaluate("transfer", VENDOR2, "200")
    assert (r["action"], r["rule"], r["reason"], r["policy_revision"]) == ("DENY", None, "default_deny", 1)
    r = evaluate("batch_payout", VENDOR2, "600")
    assert (r["action"], r["rule"]) == ("ALLOW", allow_batch)
    assert [x["considered"] for x in r["trace"]] == [False, False, False, True, True, False]
    assert (wallet_audit_count(w["id"]), count("intents", f"wallet_id = {lit(w['id'])}")) == before
    updated = ok(owner.patch(f"/policies/{p['id']}", {"rules": rules[:5]}))
    assert updated["revision"] == 2
    r = evaluate("transfer", VENDOR2, "10")
    assert (r["action"], r["reason"], r["policy_revision"]) == ("DENY", "default_deny", 2)
    ok(owner.patch(f"/wallets/{w['id']}", {"policy_id": p["id"]}))
    e = err(transfer(op, w["id"], VENDOR2, "10"), 403, "POLICY_DENIED")
    assert e["details"] == {"rule": None, "reason": "default_deny", "policy_revision": 2}
    b = ok(batch(op, w["id"], [(VENDOR2, "10", "")]), 201)
    assert b["status"] == "executed"
    plain = new_wallet(owner, funds="10")
    i = ok(transfer(op, plain["id"], VENDOR2, "1"), 201)
    assert i["policy_decision"] == {"action": "ALLOW", "rule": None, "reason": "no_policy", "policy_id": None,
                                    "policy_revision": None}


def test_wf_policy_decisions_seeded_policy(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    revision = ok(owner.get(f"/policies/{POL_OPERATING}"))["revision"]
    seed = ok(owner.post(evaluate_path(POL_OPERATING), {"method": "transfer", "wallet_id": "wal_operating",
                                                              "destination_address": VENDOR2, "amount": "60000"}))
    assert (seed["action"], seed["rule"], seed["reason"]) == ("DENY", None, "default_deny")
    assert seed["aggregations"] == {"agg_daily_outflow": "72000000000"}
    assert [(x["rule"], x["considered"], x["matched"], x["conditions"]) for x in seed["trace"]] == [
        ("Block burn address", True, False, [False]), ("Vendors under daily cap", True, False, [True, False]),
        ("Sweep to payroll", True, False, [False]), ("Payroll lines under 5000", False, False, [])]
    w = new_wallet(owner, funds="100000", policy_id="pol_operating")

    def evaluate(method, dest, amount):
        r = ok(owner.post(evaluate_path(POL_OPERATING), {"method": method, "wallet_id": w["id"],
                                                               "destination_address": dest, "amount": amount}))
        assert r["policy_revision"] == revision and r["policy_id"] == "pol_operating"
        return r["action"], r["rule"], r["reason"]

    assert evaluate("transfer", BURN, "100") == ("DENY", "Block burn address", "matched_rule")
    assert evaluate("transfer", VENDOR3, "40000") == ("ALLOW", "Vendors under daily cap", "matched_rule")
    assert evaluate("transfer", VENDOR3, "50000") == ("ALLOW", "Vendors under daily cap", "matched_rule")
    assert evaluate("transfer", VENDOR3, "50000.000001") == ("DENY", None, "default_deny")
    assert evaluate("transfer", address_of("wal_payroll"), "100") == ("ALLOW", "Sweep to payroll", "matched_rule")
    assert evaluate("batch_payout", LINE_A, "5000") == ("ALLOW", "Payroll lines under 5000", "matched_rule")
    assert evaluate("batch_payout", LINE_A, "5000.000001") == ("DENY", None, "default_deny")
    assert evaluate("transfer", LINE_A, "1") == ("DENY", None, "default_deny")
    ok(transfer(op, w["id"], VENDOR1, "30000"), 201)
    r = ok(owner.post(evaluate_path(POL_OPERATING), {"method": "transfer", "wallet_id": w["id"],
                                                           "destination_address": VENDOR2, "amount": "30000"}))
    assert r["aggregations"] == {AGG_DAILY: str(raw("30000") + raw("30000"))} and r["action"] == "DENY"
    e = err(transfer(op, w["id"], VENDOR2, "30000"), 403, "POLICY_DENIED")
    assert e["details"] == {"rule": None, "reason": "default_deny", "policy_revision": revision}
    ok(transfer(op, w["id"], VENDOR2, "20000"), 201)


def test_wf_policy_decisions_denial_records(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    revision = ok(owner.get(f"/policies/{POL_OPERATING}"))["revision"]
    secret = ok(owner.get("/webhooks/secret"))["secret"]
    w = new_wallet(owner, funds="1000", policy_id="pol_operating")
    e = err(transfer(op, w["id"], BURN, "100"), 403, "POLICY_DENIED")
    assert e["details"] == {"rule": "Block burn address", "reason": "matched_rule", "policy_revision": revision}
    assert count("intents", f"wallet_id = {lit(w['id'])}") == 0
    after = wallet(owner, w["id"])
    assert (after["balance"], after["reserved"], after["available"]) == ("1000", "0", "1000")
    events = [x for x in audit_rows(w["id"]) if x["type"] == "transfer.denied"]
    assert len(events) == 1
    data = events[0]["data"]
    assert {k: str(v) for k, v in data.items()} == {"wallet_id": w["id"], "raw_amount": "100000000",
                                                    "rule": "Block burn address", "reason": "matched_rule",
                                                    "policy_revision": str(revision)}
    signed = db().rows(
        "SELECT id, type, timestamp, body::text AS body, signature FROM webhook_events WHERE type = 'transfer.denied' "
        f"AND body::text LIKE {lit('%' + w['id'] + '%')}")
    assert len(signed) == 1
    body = json.loads(signed[0]["body"])
    assert body["data"] == data and body["type"] == "transfer.denied"
    event = {"id": signed[0]["id"], "timestamp": int(signed[0]["timestamp"]), "body": signed[0]["body"]}
    assert signed[0]["signature"] == signature(secret, event)


def test_transfer_check_order(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    _, auditor = add_member(owner, "auditor")
    missing = "wal_" + "0" * 20
    bad = {"destination_address": "nope", "amount": 5}
    err(auditor.post(f"/wallets/{missing}/transfers", bad), 403, "FORBIDDEN_ROLE")
    field_err(op.post(f"/wallets/{missing}/transfers", bad, key=""), "VALIDATION_ERROR", "Idempotency-Key")
    err(op.post(f"/wallets/{missing}/transfers", bad), 404, "WALLET_NOT_FOUND")
    w = new_wallet(owner, funds="10", policy_id="pol_operating")
    path = f"/wallets/{w['id']}/transfers"
    field_err(op.post(path, {"extra": 1, "amount": "x"}), "UNKNOWN_FIELD", "extra")
    field_err(op.post(path, {"destination_address": "nope", "amount": "x"}), "INVALID_AMOUNT", "amount")
    field_err(op.post(path, {"memo": "a\nb", "destination_address": "nope", "amount": "1"}), "INVALID_ADDRESS",
              "destination_address")
    field_err(op.post(path, {"memo": "a\nb", "destination_address": w["address"], "amount": "1"}), "SELF_TRANSFER",
              "destination_address")
    field_err(op.post(path, {"memo": "a\nb", "destination_address": VENDOR1, "amount": "1"}), "VALIDATION_ERROR",
              "memo")
    ok(owner.post(f"/wallets/{w['id']}/freeze"))
    field_err(op.post(path, {"memo": "a\nb", "destination_address": VENDOR1, "amount": "1"}), "VALIDATION_ERROR",
              "memo")
    err(transfer(op, w["id"], BURN, "5000"), 409, "WALLET_FROZEN")
    ok(owner.post(f"/wallets/{w['id']}/unfreeze"))
    err(transfer(op, w["id"], BURN, "5000"), 403, "POLICY_DENIED")
    assert err(transfer(op, w["id"], VENDOR1, "5000"), 409, "INSUFFICIENT_FUNDS")["details"] == {}
    assert count("intents", f"wallet_id = {lit(w['id'])}") == 0
    assert ok(transfer(op, w["id"], VENDOR1, "5"), 201)["status"] == "executed"
    acme = login(app_url, ACME_OWNER)
    body = {"destination_address": VENDOR1, "amount": "1"}
    same_as_missing(acme.post(path, body), acme.post(f"/wallets/{missing}/transfers", body))
    ev = {"method": "transfer", "wallet_id": "wal_acme_ops", "destination_address": VENDOR1, "amount": "1"}
    same_as_missing(acme.post(evaluate_path(POL_OPERATING), ev),
                    acme.post("/policies/pol_" + "0" * 20 + "/evaluate", ev))
    assert wallet(owner, w["id"])["balance"] == "5"
    assert count("intents", f"wallet_id = {lit(w['id'])}") == 1


def test_wf_policy_editor_simulate(browser, app_url):
    owner = login(app_url, OWNER)
    agg = new_aggregation(owner)
    rules = [
        rule("Block burn address", "transfer", "DENY", [cond("destination.address", "in", [BURN])]),
        rule("Vendors under daily cap", "transfer", "ALLOW", [
            cond("destination.address", "in", [VENDOR1]),
            cond(f"aggregation.{agg['id']}", "lte", "50000000000", "reference")]),
        rule("Payroll lines under 5000", "batch_payout", "ALLOW"),
    ]
    names = [r["name"] for r in rules]
    p = new_policy(owner, rules)
    w = new_wallet(owner, funds="100")
    before = (wallet_audit_count(w["id"]), count("intents", f"wallet_id = {lit(w['id'])}"))
    with console(browser, app_url, OWNER, f"/console/policies/{p['id']}") as page:
        table = page.get_by_role("table", name="Rules")
        expect(table).to_be_visible()
        text = control_text(table)
        positions = [text.index(r["name"]) for r in rules]
        assert positions == sorted(positions)
        form = page.get_by_role("form", name="Simulate")
        result = page.get_by_role("status", name="Simulation result")
        select(form.get_by_role("combobox", name="Method"), "transfer")
        select(form.get_by_role("combobox", name="Wallet"), w["name"])
        fill(form.get_by_role("textbox", name="Destination address"), VENDOR2)
        fill(form.get_by_role("textbox", name="Amount"), "60000")
        click(form.get_by_role("button", name="Simulate"))
        for line in ("DENY", "no rule matched", f"Evaluated against revision {p['revision']}",
                     f"{agg['name']}: {display(raw('60000'))}", f"{names[0]}: not matched",
                     f"{names[1]}: not matched", f"{names[2]}: skipped (method)"):
            expect(result).to_contain_text(line)
        fill(form.get_by_role("textbox", name="Destination address"), BURN)
        fill(form.get_by_role("textbox", name="Amount"), "1")
        click(form.get_by_role("button", name="Simulate"))
        expect(result).to_contain_text(f"{names[0]}: matched")
        expect(result).not_to_contain_text("no rule matched")
    assert (wallet_audit_count(w["id"]), count("intents", f"wallet_id = {lit(w['id'])}")) == before


def test_wf_policy_editor_grammar_revisions(app_url):
    owner = login(app_url, OWNER)

    def base():
        return {"version": "1.0", "name": f"Grammar {tag()}", "chain_type": "ethereum",
                "rules": [rule("First"), rule("Second", "batch_payout", "DENY", [cond("source.amount", "gte", "1")])]}

    cases = [
        (lambda b: b.update(version=1.0), "INVALID_POLICY", "path", "version"),
        (lambda b: b.pop("version"), "INVALID_POLICY", "path", "version"),
        (lambda b: b.update(name=""), "VALIDATION_ERROR", "field", "name"),
        (lambda b: b.update(chain_type="base"), "INVALID_POLICY", "path", "chain_type"),
        (lambda b: b.update(rules=[]), "INVALID_POLICY", "path", "rules"),
        (lambda b: b.update(rules=[rule(f"R{n}") for n in range(MAX_RULES + 1)]), "INVALID_POLICY", "path", "rules"),
        (lambda b: b["rules"][0].update(method="send"), "INVALID_POLICY", "path", "rules[0].method"),
        (lambda b: b["rules"][0].update(action="allow"), "INVALID_POLICY", "path", "rules[0].action"),
        (lambda b: b["rules"][1].update(name="First"), "INVALID_POLICY", "path", "rules[1].name"),
        (lambda b: b["rules"][1]["conditions"][0].update(operator="between"), "INVALID_POLICY", "path",
         "rules[1].conditions[0].operator"),
        (lambda b: b["rules"][1]["conditions"].append(cond("destination.address", "eq", CHECKSUM_BAD)),
         "INVALID_POLICY", "path", "rules[1].conditions[1].value"),
        (lambda b: b["rules"][1]["conditions"].append(cond("destination.address", "in", [])), "INVALID_POLICY",
         "path", "rules[1].conditions[1].value"),
        (lambda b: b["rules"][0].update(extra=1) or b.update(version=2), "UNKNOWN_FIELD", "field", "rules.0.extra"),
        (lambda b: b.update(version=1.0, name=""), "INVALID_POLICY", "path", "version"),
    ]
    for mutate, code, key, where in cases:
        body = base()
        mutate(body)
        e = err(owner.post("/policies", body), 422, code)
        assert e["details"].get(key) == where, (where, e)
        if "name" in body and body["name"]:
            assert count("policies", f"name = {lit(body['name'])}") == 0
    emoji = "\U0001F4B8"
    ok(owner.post("/policies", {**base(), "name": emoji * NAME_MAX}), 201)
    field_err(owner.post("/policies", {**base(), "name": emoji * (NAME_MAX + 1)}), "VALIDATION_ERROR", "name")
    one, extra_rule = "Sweep to payroll", "Block burn address"
    p = new_policy(owner, [rule(one)])
    assert p["revision"] == 1 and p["version"] == "1.0" and p["chain_type"] == "ethereum"
    renamed = f"Renamed {tag()}"
    assert ok(owner.patch(f"/policies/{p['id']}", {"name": renamed}))["revision"] == 2
    third_rules = [rule(one), rule(extra_rule, "*", "DENY")]
    assert ok(owner.patch(f"/policies/{p['id']}", {"rules": third_rules}))["revision"] == 3
    e = err(owner.patch(f"/policies/{p['id']}", {"rules": []}), 422, "INVALID_POLICY")
    assert e["details"]["path"] == "rules"
    live = ok(owner.get(f"/policies/{p['id']}"))
    assert live["revision"] == 3 and [r["name"] for r in live["rules"]] == [one, extra_rule]
    revisions = ok(owner.get(f"/policies/{p['id']}/revisions"))["revisions"]
    assert [r["revision"] for r in revisions] == [1, 2, 3]
    assert [r["name"] for r in revisions] == [p["name"], renamed, renamed]
    assert [[x["name"] for x in r["rules"]] for r in revisions] == [[one], [one], [one, extra_rule]]
    assert all(STAMP.match(r["created_at"]) for r in revisions)
    acme = login(app_url, ACME_OWNER)
    nowhere = "pol_" + "0" * 20
    for method, suffix, body in (("GET", "", NOBODY), ("GET", "/revisions", NOBODY),
                                 ("PATCH", "", {"name": "Hijack"}), ("DELETE", "", NOBODY)):
        same_as_missing(acme.call(method, f"/policies/{p['id']}{suffix}", body),
                        acme.call(method, f"/policies/{nowhere}{suffix}", body))
    still = ok(owner.get(f"/policies/{p['id']}"))
    assert still["revision"] == 3 and still["name"] == renamed
    w = new_wallet(owner, policy_id=p["id"])
    err(owner.delete(f"/policies/{p['id']}"), 409, "POLICY_IN_USE")
    ok(owner.patch(f"/wallets/{w['id']}", {"policy_id": None}))
    assert ok(owner.delete(f"/policies/{p['id']}")) == {"deleted": True}
    err(owner.get(f"/policies/{p['id']}"), 404, "POLICY_NOT_FOUND")


def test_wf_rolling_window_aggregation_values(app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    field_err(owner.post("/aggregations", {"name": "Bad", "metric": "avg", "window_seconds": DAY_S, "asset": "usdc"}),
              "VALIDATION_ERROR", "metric")
    field_err(owner.post("/aggregations", {"name": "Bad", "metric": "count", "window_seconds": MIN_WINDOW_S - 1,
                                           "asset": "usdc"}), "VALIDATION_ERROR", "window_seconds")
    default = ok(owner.post("/aggregations", {"name": f"Agg {tag()}", "metric": "count", "window_seconds": DAY_S,
                                              "asset": "usdc"}), 201)
    assert default["group_by"] == "wallet"
    aggs = {"sum_w": new_aggregation(owner), "count_w": new_aggregation(owner, metric="count"),
            "sum_d": new_aggregation(owner, group_by="destination"),
            "count_d": new_aggregation(owner, metric="count", group_by="destination"),
            "eth": new_aggregation(owner, asset="eth")}
    probe = new_policy(owner, [rule("Probe", "transfer", "ALLOW",
                                    [cond(f"aggregation.{a['id']}", "gte", 0, "reference") for a in aggs.values()])])
    w = new_wallet(owner, funds="1000", quorum_id=t.quorum["id"], floor="50")
    ok(transfer(op, w["id"], VENDOR1, "10"), 201)
    ok(transfer(op, w["id"], VENDOR2, "60"), 201)
    r_id = ok(transfer(op, w["id"], VENDOR1, "70"), 201)["id"]
    ok(reject(t.apprs[0][1], r_id, "No"))
    c_id = ok(transfer(op, w["id"], VENDOR1, "80"), 201)["id"]
    ok(cancel(op, c_id))
    ok(batch(op, w["id"], [(VENDOR1, "5", ""), (VENDOR2, "6", "")]), 201)
    ok(deposit(owner, w["id"], "500"), 201)

    def values():
        r = ok(owner.post(f"/policies/{probe['id']}/evaluate", {"method": "transfer", "wallet_id": w["id"],
                                                                "destination_address": VENDOR1, "amount": "1"}))
        return {name: str(r["aggregations"][a["id"]]) for name, a in aggs.items()}

    expected = {"sum_w": str(raw("10") + raw("60") + raw("5") + raw("6") + raw("1")), "count_w": "4",
                "sum_d": str(raw("10") + raw("5") + raw("1")), "count_d": "3", "eth": "0"}
    assert values() == expected
    cap = new_policy(owner, [rule("Batch cap", "batch_payout", "ALLOW",
                                  [cond(f"aggregation.{aggs['sum_w']['id']}", "lte", "103000000", "reference")])])
    ok(owner.patch(f"/wallets/{w['id']}", {"policy_id": cap["id"]}))
    intents_before = count("intents", f"wallet_id = {lit(w['id'])}")
    e = err(batch(op, w["id"], [(LINE_A, "10", ""), (LINE_B, "12", ""), (LINE_A, "1", "")]), 403, "POLICY_DENIED")
    assert e["details"] == {"index": 2, "rule": None, "reason": "default_deny", "policy_revision": 1}
    assert count("intents", f"wallet_id = {lit(w['id'])}") == intents_before
    assert values() == expected
    ok(batch(op, w["id"], [(LINE_A, "10", ""), (LINE_B, "12", "")]), 201)


def test_wf_rolling_window_window_edge(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    agg = new_aggregation(owner, window=MIN_WINDOW_S)
    p = new_policy(owner, [rule("Probe", "transfer", "ALLOW", [cond(f"aggregation.{agg['id']}", "gte", 0, "reference")])])
    w = new_wallet(owner, funds="10")
    sent = ok(transfer(op, w["id"], VENDOR1, "2"), 201)

    def value():
        r = ok(owner.post(f"/policies/{p['id']}/evaluate", {"method": "transfer", "wallet_id": w["id"],
                                                            "destination_address": VENDOR1, "amount": "1"}))
        return str(r["aggregations"][agg["id"]])

    assert value() == str(raw("2") + raw("1"))
    wait_server_second(ts(sent["created_at"]) + MIN_WINDOW_S + 2)
    assert value() == str(raw("1"))


def test_wf_rolling_window_expiry(app_url):
    t = team(app_url, approvers=2, threshold=2, expiry=EXPIRY_S)
    owner, op = t.owner, t.op
    secret = ok(owner.get("/webhooks/secret"))["secret"]
    w = new_wallet(owner, funds="100", quorum_id=t.quorum["id"], floor="0")
    wf = new_wallet(owner, funds="100", quorum_id=t.quorum["id"], floor="0")
    decided = ok(transfer(op, w["id"], VENDOR1, "10"), 201)
    raced = ok(transfer(op, w["id"], VENDOR1, "20"), 201)
    swept = ok(transfer(op, wf["id"], VENDOR1, "30"), 201)
    for i in (decided, raced, swept):
        assert ts(i["expires_at"]) - ts(i["created_at"]) == EXPIRY_S
    ok(approve(t.apprs[0][1], decided["id"]))
    ok(owner.post(f"/wallets/{wf['id']}/freeze"))
    a0, a1 = t.apprs[0][1], t.apprs[1][1]
    wait_server_second(max(ts(decided["expires_at"]), ts(raced["expires_at"])))
    results = race(lambda: approve(a1.clone(), decided["id"]), lambda: approve(a0.clone(), raced["id"]),
                   lambda: approve(a1.clone(), raced["id"]), lambda: owner.clone().get(f"/intents/{raced['id']}"),
                   lambda: owner.clone().get(f"/intents/{decided['id']}"))
    for r in results[:3]:
        err(r, 409, "INTENT_NOT_PENDING")
    deadline = ts(swept["expires_at"]) + SWEEP_S + 1
    poll(lambda: db().rows(f"SELECT status FROM intents WHERE id = {lit(swept['id'])}")[0]["status"] == "expired"
         or db_now() > deadline, WINDOW_WAIT_S, "sweep wait")
    assert db().rows(f"SELECT status FROM intents WHERE id = {lit(swept['id'])}")[0]["status"] == "expired", \
        "sweep did not expire the untouched intent within 5 seconds"
    for i in (decided, raced, swept):
        view = ok(owner.get(f"/intents/{i['id']}"))
        assert view["status"] == "expired" and view["decided_at"] == i["expires_at"]
        rows = db().rows(
            "SELECT actor, data::jsonb AS data, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS at "
            f"FROM audit_events WHERE type = 'intent.expired' AND subject_id = {lit(i['id'])}")
        assert len(rows) == 1 and rows[0]["actor"] == "system" and rows[0]["at"] == i["expires_at"]
        assert {k: str(v) for k, v in rows[0]["data"].items()} == {
            "intent_id": i["id"], "wallet_id": i["wallet_id"], "kind": "transfer", "raw_amount": i["raw_amount"],
            "status": "expired"}
        signed = db().rows(
            "SELECT id, timestamp, body::text AS body, signature FROM webhook_events WHERE type = 'intent.expired' "
            f"AND body::text LIKE {lit('%' + i['id'] + '%')}")
        assert len(signed) == 1
        body = json.loads(signed[0]["body"])
        assert body["created_at"] == i["expires_at"] and body["data"] == rows[0]["data"]
        assert signed[0]["signature"] == signature(secret, {"id": signed[0]["id"],
                                                            "timestamp": int(signed[0]["timestamp"]),
                                                            "body": signed[0]["body"]})
        assert ledger(i["id"]) == []
    for wid in (w["id"], wf["id"]):
        view = wallet(owner, wid)
        assert (view["balance"], view["reserved"], view["available"]) == ("100", "0", "100")
    assert wallet(owner, wf["id"])["status"] == "frozen"
    agg = new_aggregation(owner)
    p = new_policy(owner, [rule("Probe", "transfer", "ALLOW", [cond(f"aggregation.{agg['id']}", "gte", 0, "reference")])])
    r = ok(owner.post(f"/policies/{p['id']}/evaluate", {"method": "transfer", "wallet_id": w["id"],
                                                        "destination_address": VENDOR1, "amount": "1"}))
    assert str(r["aggregations"][agg["id"]]) == str(raw("1"))


def test_wf_amounts_addresses_amounts(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    w = new_wallet(owner, funds="1000")
    before = count("intents", f"wallet_id = {lit(w['id'])}")
    for value, code in [(5, "INVALID_AMOUNT"), ("01", "INVALID_AMOUNT"), ("1.", "INVALID_AMOUNT"),
                        (".5", "INVALID_AMOUNT"), ("-1", "INVALID_AMOUNT"), ("1e3", "INVALID_AMOUNT"),
                        (" 1", "INVALID_AMOUNT"), (None, "INVALID_AMOUNT"), ("0.0000001", "AMOUNT_PRECISION"),
                        ("0", "AMOUNT_NOT_POSITIVE"), ("0.000000", "AMOUNT_NOT_POSITIVE"),
                        ("1000000001", "AMOUNT_TOO_LARGE")]:
        field_err(op.post(f"/wallets/{w['id']}/transfers", {"destination_address": VENDOR1, "amount": value}), code,
                  "amount")
    err(transfer(op, w["id"], VENDOR1, MAX_WHOLE), 409, "INSUFFICIENT_FUNDS")
    assert count("intents", f"wallet_id = {lit(w['id'])}") == before
    big = new_wallet(owner)
    assert ok(deposit(op, big["id"], MAX_WHOLE), 201)["raw_amount"] == MAX_WHOLE + "000000"
    field_err(deposit(op, big["id"], "1000000001"), "AMOUNT_TOO_LARGE", "amount")
    d = ok(deposit(op, w["id"], "1.50"), 201)
    assert (d["amount"], d["raw_amount"]) == ("1.5", "1500000")
    i = ok(transfer(op, w["id"], VENDOR1, "0.000001"), 201)
    assert (i["amount"], i["raw_amount"]) == ("0.000001", "1")
    view = wallet(owner, w["id"])
    expected = raw("1000") + raw("1.5") - raw("0.000001")
    assert (view["balance"], view["balance_raw"]) == (display(expected), str(expected))
    assert db().rows(f"SELECT balance_raw::text AS b FROM wallets WHERE id = {lit(w['id'])}")[0]["b"] == str(expected)
    zero = new_wallet(owner, floor="0")
    assert (zero["approval_floor"], zero["approval_floor_raw"]) == ("0", "0")
    field_err(owner.post("/wallets", {"name": f"Wallet {tag()}", "chain": "base", "asset": "usdc",
                                      "approval_floor": "0.0000001"}), "AMOUNT_PRECISION", "approval_floor")
    eth = new_wallet(owner, funds="1.250000000000000001", asset="eth", chain="ethereum")
    assert (eth["balance"], eth["balance_raw"]) == ("1.250000000000000001", "1250000000000000001")
    field_err(transfer(op, eth["id"], VENDOR1, "0.0000000000000000001"), "AMOUNT_PRECISION", "amount")
    ok(transfer(op, eth["id"], VENDOR1, "0.25"), 201)
    eth_left = raw("1.250000000000000001", "eth") - raw("0.25", "eth")
    assert wallet(owner, eth["id"])["balance"] == display(eth_left, "eth")


def test_wf_amounts_addresses_checksums(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    w = new_wallet(owner, funds="100")
    assert w["address"] == address_of(w["id"])
    sibling = new_wallet(owner)
    i = ok(transfer(op, w["id"], CHECKSUM_OK, "1"), 201)
    assert i["destination_address"] == CHECKSUM_OK.lower()
    stored = db().rows(f"SELECT destination_address FROM intents WHERE id = {lit(i['id'])}")[0]
    assert stored["destination_address"] == CHECKSUM_OK.lower()
    ok(transfer(op, w["id"], "0x" + CHECKSUM_OK[2:].upper(), "1"), 201)
    field_err(transfer(op, w["id"], CHECKSUM_BAD, "1"), "INVALID_ADDRESS_CHECKSUM", "destination_address")
    field_err(transfer(op, w["id"], "0x1234", "1"), "INVALID_ADDRESS", "destination_address")
    field_err(transfer(op, w["id"], w["address"].upper().replace("0X", "0x"), "1"), "SELF_TRANSFER",
              "destination_address")
    eth = new_wallet(owner, asset="eth", chain="ethereum")
    field_err(transfer(op, w["id"], eth["address"], "1"), "ASSET_MISMATCH", "destination_address")
    other_chain = new_wallet(owner, chain="ethereum")
    field_err(transfer(op, w["id"], other_chain["address"], "1"), "ASSET_MISMATCH", "destination_address")
    ok(transfer(op, w["id"], sibling["address"], "3"), 201)
    assert wallet(owner, sibling["id"])["balance"] == "3"
    field_err(owner.post(evaluate_path(POL_OPERATING), {"method": "transfer", "wallet_id": w["id"],
                                                              "destination_address": CHECKSUM_BAD, "amount": "1"}),
              "INVALID_ADDRESS_CHECKSUM", "destination_address")
    acme = login(app_url, ACME_OWNER)
    acme_wallet = new_wallet(acme, funds="5")
    ok(transfer(acme, acme_wallet["id"], sibling["address"], "1"), 201)
    assert wallet(owner, sibling["id"])["balance"] == "3"
    missing = "wal_" + "0" * 20
    same_as_missing(transfer(acme, w["id"], VENDOR1, "1"), transfer(acme, missing, VENDOR1, "1"))
    assert wallet(owner, w["id"])["balance"] == "95"


def test_wf_amounts_addresses_text_limits(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    w = new_wallet(owner, funds="100")
    before = count("intents", f"wallet_id = {lit(w['id'])}")
    path = f"/wallets/{w['id']}/transfers"
    field_err(op.post(path, {"destination_address": VENDOR1, "amount": "1", "extra": True}), "UNKNOWN_FIELD", "extra")
    field_err(op.post(f"/wallets/{w['id']}/batches", {"items": [
        {"destination_address": VENDOR1, "amount": "1", "memo": ""},
        {"destination_address": VENDOR1, "amount": "1", "memo": ""},
        {"destination_address": VENDOR1, "amount": "1", "memo": "", "extra": 1}]}), "UNKNOWN_FIELD", "items.2.extra")
    field_err(op.post(path, {"destination_address": VENDOR1}), "VALIDATION_ERROR", "amount")
    field_err(op.post(f"/wallets/{w['id']}/batches", {"items": [
        {"destination_address": VENDOR1, "amount": "1", "memo": ""},
        {"amount": "1", "memo": ""}]}), "VALIDATION_ERROR", "items.1.destination_address")
    emoji = "\U0001F4B8"
    field_err(transfer(op, w["id"], VENDOR1, "1", memo=emoji * (MEMO_MAX + 1)), "VALIDATION_ERROR", "memo")
    for bad in ("line\nbreak", "bell\x07", "c1\u0085"):
        field_err(transfer(op, w["id"], VENDOR1, "1", memo=bad), "VALIDATION_ERROR", "memo")
    field_err(deposit(op, w["id"], "1", "r" * (REFERENCE_MAX + 1)), "VALIDATION_ERROR", "reference")
    assert count("intents", f"wallet_id = {lit(w['id'])}") == before
    assert ok(transfer(op, w["id"], VENDOR1, "1", memo=emoji * MEMO_MAX), 201)["memo"] == emoji * MEMO_MAX
    accented = ok(transfer(op, w["id"], VENDOR1, "1", memo="e\u0301" * MEMO_MAX), 201)
    assert accented["memo"] == "\u00e9" * MEMO_MAX
    ref = ok(deposit(op, w["id"], "1", f"  {KEPT_TEXT}  "), 201)
    assert ref["reference"] == KEPT_TEXT


def line_box(form, k: int, part: str):
    return form.get_by_role("textbox", name=f"Line {k} {part}")


def remove_line(form, k: int):
    return form.get_by_role("button", name=f"Remove line {k}")


def test_wf_payroll_batch_builder(browser, app_url):
    t = team(app_url, approvers=2, threshold=2)
    w = new_wallet(t.owner, funds="20000", quorum_id=t.quorum["id"], floor="10000")
    payroll = new_wallet(t.owner)
    with console(browser, app_url, t.op_m["email"], f"/console/wallets/{w['id']}") as page:
        form = page.get_by_role("form", name="Payroll batch")
        total = form.get_by_role("status", name="Batch total")
        first, second, third, fourth = 1, 2, 3, 4
        expect(remove_line(form, first)).to_be_disabled()
        click(form.get_by_role("button", name="Add line"))
        expect(line_box(form, second, "destination")).to_be_focused()
        click(form.get_by_role("button", name="Add line"))
        expect(line_box(form, third, "destination")).to_be_focused()
        for k, (dest, amount) in enumerate([(LINE_A, "4800"), (LINE_B, "4900"), (payroll["address"], "abc")], 1):
            fill(line_box(form, k, "destination"), dest)
            fill(line_box(form, k, "amount"), amount)
        line_box(form, third, "amount").press("Tab")
        expect(form).to_contain_text("Enter an amount like 1250 or 0.5")
        expect(total).to_contain_text(f"Total: {display(raw('4800') + raw('4900'))} USDC")
        fill(line_box(form, third, "amount"), "2500")
        expect(total).to_contain_text(f"Total: {display(raw('4800') + raw('4900') + raw('2500'))} USDC")
        click(form.get_by_role("button", name="Add line"))
        click(remove_line(form, fourth))
        expect(form.get_by_role("button", name="Add line")).to_be_focused()
        expect(line_box(form, fourth, "destination")).to_have_count(0)
        click(form.get_by_role("button", name="Submit batch"))
        expect(page.get_by_text(
            f"Batch waiting for approval: 0 of {t.quorum['authorization_threshold']} approvals").first).to_be_visible()
    rows = db().rows(f"SELECT id, kind, raw_amount::text AS amt FROM intents WHERE wallet_id = {lit(w['id'])}")
    assert len(rows) == 1 and rows[0]["kind"] == "batch" and rows[0]["amt"] == str(raw("12200"))
    iid = rows[0]["id"]
    intent = ok(t.owner.get(f"/intents/{iid}"))
    items = sorted(intent["items"], key=lambda x: x["position"])
    assert len({x["position"] for x in items}) == len(items)
    assert [(x["destination_address"], x["amount"]) for x in items] == [
        (LINE_A, "4800"), (LINE_B, "4900"), (payroll["address"], "2500")]
    for _, api in t.apprs:
        ok(approve(api, iid))
    assert ok(t.owner.get(f"/intents/{iid}"))["status"] == "executed"
    assert wallet(t.owner, payroll["id"])["balance"] == "2500"
    assert wallet(t.owner, w["id"])["balance"] == display(raw("20000") - raw("12200"))
    rows = ledger(iid)
    assert len(assert_pairs(rows)) == 3 and all(r["kind"] == "batch_line" for r in rows)
    assert_balanced(w["id"], payroll["id"])


def test_wf_payroll_batch_refused_line(browser, app_url):
    owner = login(app_url, OWNER)
    op_m, _ = add_member(owner, "operator")
    p = new_policy(owner, [rule("Payroll lines under cap", "batch_payout", "ALLOW",
                                [cond("source.amount", "lte", "5000000000")])])
    w = new_wallet(owner, funds="10000", policy_id=p["id"])
    with console(browser, app_url, op_m["email"], f"/console/wallets/{w['id']}") as page:
        form = page.get_by_role("form", name="Payroll batch")
        first, second = 1, 2
        click(form.get_by_role("button", name="Add line"))
        fill(line_box(form, first, "destination"), LINE_A)
        fill(line_box(form, first, "amount"), "100")
        fill(line_box(form, second, "destination"), LINE_B)
        fill(line_box(form, second, "amount"), "6000")
        click(form.get_by_role("button", name="Submit batch"))
        expect(page.get_by_text(f"Line {second} blocked by policy: no rule allowed it").first).to_be_visible()
        fill(line_box(form, second, "amount"), "60")
        destination = line_box(form, second, "destination")
        fill(destination, CHECKSUM_BAD)
        click(form.get_by_role("button", name="Submit batch"))
        expect(destination).to_be_focused()
        expect(destination).to_have_attribute("aria-invalid", "true")
        assert count("intents", f"wallet_id = {lit(w['id'])}") == 0
        fill(destination, CHECKSUM_OK)
        click(form.get_by_role("button", name="Submit batch"))
        expect(page.get_by_text("Batch executed").first).to_be_visible()
    rows = db().rows(f"SELECT id, kind, status FROM intents WHERE wallet_id = {lit(w['id'])}")
    assert len(rows) == 1 and (rows[0]["kind"], rows[0]["status"]) == ("batch", "executed")
    assert count("intent_items", f"intent_id = {lit(rows[0]['id'])}") == 2


def test_wf_payroll_batch_all_or_nothing(app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    w = new_wallet(owner, funds="1000", quorum_id=t.quorum["id"], floor="100")
    internal = new_wallet(owner)
    eth = new_wallet(owner, asset="eth", chain="ethereum")
    field_err(owner.post(f"/wallets/{w['id']}/batches", {"items": []}), "VALIDATION_ERROR", "items")
    field_err(batch(op, w["id"], [(LINE_A, "0.000001", "")] * (MAX_LINES + 1)), "VALIDATION_ERROR", "items")
    for lines, code, index, field in [
        ([(LINE_A, "1", ""), (LINE_B, "1", ""), (LINE_A, "x", "")], "INVALID_AMOUNT", 2, "items.2.amount"),
        ([(LINE_A, "1", ""), (w["address"], "1", "")], "SELF_TRANSFER", 1, "items.1.destination_address"),
        ([(eth["address"], "1", "")], "ASSET_MISMATCH", 0, "items.0.destination_address"),
        ([(LINE_A, "1", ""), ("bad", "x", "")], "INVALID_AMOUNT", 1, "items.1.amount"),
        ([(LINE_A, "1", ""), (CHECKSUM_BAD, "1", "")], "INVALID_ADDRESS_CHECKSUM", 1, "items.1.destination_address"),
    ]:
        e = err(batch(op, w["id"], lines), 422, code)
        assert e["details"] == {"index": index, "field": field}
    assert err(batch(op, w["id"], [(LINE_A, "600", ""), (LINE_B, "600", "")]), 409, "INSUFFICIENT_FUNDS")[
               "details"] == {}
    capped = new_policy(owner, [rule("Lines under 50", "batch_payout", "ALLOW",
                                     [cond("source.amount", "lte", "50000000")])])
    dw = new_wallet(owner, funds="1000", policy_id=capped["id"])
    e = err(batch(op, dw["id"], [(LINE_A, "10", ""), (LINE_B, "60", ""), (LINE_A, "10", "")]), 403, "POLICY_DENIED")
    assert e["details"] == {"index": 1, "rule": None, "reason": "default_deny", "policy_revision": 1}
    denied = [x for x in audit_rows(dw["id"]) if x["type"] == "transfer.denied"]
    assert len(denied) == 1 and denied[0]["data"]["index"] == 1
    for wid in (w["id"], dw["id"]):
        assert count("intents", f"wallet_id = {lit(wid)}") == 0
    assert wallet(owner, w["id"])["reserved"] == "0"
    small = ok(batch(op, w["id"], [(LINE_A, "1", ""), (LINE_B, "2", "")]), 201)
    small_total = raw("1") + raw("2")
    assert small["status"] == "executed" and small["kind"] == "batch" and small["amount"] == display(small_total)
    salary, sweep = "400", "300"
    total = raw(salary) + raw(sweep)
    i = ok(batch(op, w["id"], [(LINE_A, salary, "Salary"), (internal["address"], sweep, "Sweep")]), 201)
    assert (i["status"], i["kind"], i["amount"], i["raw_amount"]) == (
        "pending_approval", "batch", display(total), str(total))
    items = sorted(i["items"], key=lambda x: x["position"])
    assert len({x["position"] for x in items}) == len(items)
    assert [(x["amount"], x["memo"]) for x in items] == [(salary, "Salary"), (sweep, "Sweep")]
    assert wallet(owner, w["id"])["reserved"] == display(total)
    for _, api in t.apprs:
        ok(approve(api, i["id"]))
    assert wallet(owner, w["id"])["balance"] == display(raw("1000") - small_total - total)
    assert wallet(owner, internal["id"])["balance"] == sweep
    rows = ledger(i["id"])
    assert len(assert_pairs(rows)) == 2
    assert sorted((r["account"], int(r["amount"])) for r in rows) == sorted([
        (w["id"], -raw(salary)), ("external", raw(salary)), (w["id"], -raw(sweep)), (internal["id"], raw(sweep))])
    assert_balanced(w["id"], internal["id"])
    full = new_wallet(owner, funds="1")
    ok(batch(op, full["id"], [(LINE_A, "0.000001", "")] * MAX_LINES), 201)


def test_wf_frozen_wallet_rules(app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    w = new_wallet(owner, funds="1000", quorum_id=t.quorum["id"], floor="50")
    p1 = ok(transfer(op, w["id"], VENDOR1, "60"), 201)
    short_q = new_quorum(owner, [t.apprs[0][0]["id"]], 1, EXPIRY_S)
    wx = new_wallet(owner, funds="100", quorum_id=short_q["id"], floor="0")
    px = ok(transfer(op, wx["id"], VENDOR1, "40"), 201)
    ok(owner.post(f"/wallets/{wx['id']}/freeze"))
    err(op.post(f"/wallets/{w['id']}/freeze"), 403, "FORBIDDEN_ROLE")
    assert ok(owner.post(f"/wallets/{w['id']}/freeze"))["status"] == "frozen"
    err(owner.post(f"/wallets/{w['id']}/freeze"), 409, "WALLET_FROZEN")
    intents_before, audit_before = count("intents", f"wallet_id = {lit(w['id'])}"), wallet_audit_count(w["id"])
    err(transfer(op, w["id"], VENDOR1, "1"), 409, "WALLET_FROZEN")
    err(batch(op, w["id"], [(LINE_A, "1", "")]), 409, "WALLET_FROZEN")
    err(approve(t.apprs[0][1], p1["id"]), 409, "WALLET_FROZEN")
    assert count("intents", f"wallet_id = {lit(w['id'])}") == intents_before
    assert count("approvals", f"intent_id = {lit(p1['id'])}") == 0
    assert wallet_audit_count(w["id"]) == audit_before
    d = ok(deposit(op, w["id"], "5"), 201)
    assert wallet(owner, w["id"])["balance"] == display(raw("1000") + raw("5"))
    dep_rows = db().rows(f"SELECT movement_id, raw_amount::text AS amount FROM ledger_entries "
                         f"WHERE deposit_id = {lit(d['id'])}")
    assert len(assert_pairs([{**r, "account": ""} for r in dep_rows])) == 1
    err(op.post(f"/wallets/{w['id']}/unfreeze"), 403, "FORBIDDEN_ROLE")
    assert ok(owner.post(f"/wallets/{w['id']}/unfreeze"))["status"] == "active"
    err(owner.post(f"/wallets/{w['id']}/unfreeze"), 409, "WALLET_NOT_FROZEN")
    ok(approve(t.apprs[0][1], p1["id"]))
    assert_balanced(w["id"])
    wait_server_second(ts(px["expires_at"]))
    err(approve(t.apprs[0][1], px["id"]), 409, "INTENT_NOT_PENDING")
    assert ok(owner.get(f"/intents/{px['id']}"))["status"] == "expired"
    view = wallet(owner, wx["id"])
    assert (view["status"], view["balance"], view["reserved"], view["available"]) == ("frozen", "100", "0", "100")
    assert count("approvals", f"intent_id = {lit(px['id'])}") == 0
    assert count("audit_events", f"type = 'intent.expired' AND subject_id = {lit(px['id'])}") == 1


def test_wf_frozen_wallet_reject_cancel(app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    _, other_op = add_member(owner, "operator")
    w = new_wallet(owner, funds="1000", quorum_id=t.quorum["id"], floor="0")
    r1 = ok(transfer(op, w["id"], VENDOR1, "100"), 201)
    c1 = ok(transfer(op, w["id"], VENDOR1, "200"), 201)
    c2 = ok(transfer(other_op, w["id"], VENDOR1, "300"), 201)
    c3 = ok(transfer(op, w["id"], VENDOR1, "50"), 201)
    assert wallet(owner, w["id"])["reserved"] == display(raw("100") + raw("200") + raw("300") + raw("50"))
    ok(owner.post(f"/wallets/{w['id']}/freeze"))
    field_err(reject(t.apprs[0][1], r1["id"], "r" * (REASON_MAX + 1)), "VALIDATION_ERROR", "reason")
    rejected = ok(reject(t.apprs[0][1], r1["id"], "r" * REASON_MAX))
    assert rejected["status"] == "rejected" and rejected["rejection_reason"] == "r" * REASON_MAX
    err(cancel(t.apprs[1][1], c1["id"]), 403, "FORBIDDEN_ROLE")
    err(cancel(other_op, c1["id"]), 403, "FORBIDDEN_ROLE")
    mine = ok(cancel(op, c1["id"]))
    assert mine["status"] == "cancelled" and STAMP.match(mine["decided_at"])
    assert ok(cancel(owner, c2["id"]))["status"] == "cancelled"
    err(cancel(op, c1["id"]), 409, "INTENT_NOT_PENDING")
    rc, rr = race(lambda: cancel(op.clone(), c3["id"]), lambda: reject(t.apprs[1][1].clone(), c3["id"], "Raced"))
    assert sorted([rc.status_code, rr.status_code]) == [200, 409]
    err(rc if rc.status_code == 409 else rr, 409, "INTENT_NOT_PENDING")
    final = ok(owner.get(f"/intents/{c3['id']}"))["status"]
    assert final == ("cancelled" if rc.status_code == 200 else "rejected")
    assert count("audit_events", f"subject_id = {lit(c3['id'])} AND type IN ('intent.cancelled', 'intent.rejected')") == 1
    assert ledger(c3["id"]) == []
    view = wallet(owner, w["id"])
    assert (view["balance"], view["reserved"], view["available"], view["status"]) == ("1000", "0", "1000", "frozen")
    for i in (r1, c1, c2):
        assert ledger(i["id"]) == []
    assert [x["type"] for x in audit_rows(c1["id"])] == ["intent.created", "intent.cancelled"]
    assert [x["type"] for x in audit_rows(r1["id"])] == ["intent.created", "intent.rejected"]


def test_wf_approvals_inbox_contents(app_url):
    t = team(app_url, approvers=3, threshold=2)
    owner, op = t.owner, t.op
    a1_m, a1 = t.apprs[0]
    o_m, o = add_member(owner, "owner")
    q2 = new_quorum(owner, [t.apprs[2][0]["id"]], 1)
    q3 = new_quorum(owner, [o_m["id"], a1_m["id"]], 1)
    w1 = new_wallet(owner, funds="1000", quorum_id=t.quorum["id"], floor="0")
    w2 = new_wallet(owner, funds="1000", quorum_id=q2["id"], floor="0")
    w3 = new_wallet(owner, funds="1000", quorum_id=q3["id"], floor="0")
    small = new_wallet(owner, funds="10")
    q_short = new_quorum(owner, [a1_m["id"]], 1, EXPIRY_S)
    w_short = new_wallet(owner, funds="10", quorum_id=q_short["id"], floor="0")
    short = ok(transfer(op, w_short["id"], VENDOR1, "1"), 201)
    i1 = ok(transfer(op, w1["id"], VENDOR1, "1"), 201)["id"]
    next_second()
    i2 = ok(transfer(op, w1["id"], VENDOR1, "2"), 201)["id"]
    next_second()
    decided = ok(transfer(op, w1["id"], VENDOR1, "3"), 201)["id"]
    ok(approve(a1, decided))
    other_quorum = ok(transfer(op, w2["id"], VENDOR1, "4"), 201)["id"]
    rejected = ok(transfer(op, w1["id"], VENDOR1, "5"), 201)["id"]
    ok(reject(t.apprs[1][1], rejected, "No"))
    executed = ok(transfer(op, small["id"], VENDOR1, "1"), 201)["id"]
    next_second()
    own = ok(transfer(o, w3["id"], VENDOR1, "6"), 201)["id"]
    acme = login(app_url, ACME_OWNER)
    acme_appr_m, acme_appr = add_member(acme, "approver")
    acme_q = new_quorum(acme, [acme_appr_m["id"]], 1)
    acme_w = new_wallet(acme, funds="10", quorum_id=acme_q["id"], floor="0")
    acme_i = ok(transfer(acme, acme_w["id"], VENDOR1, "1"), 201)["id"]
    inbox = ok(a1.get("/approvals/inbox"))["items"]
    ids = [x["id"] for x in inbox]
    assert [x for x in ids if x in {i1, i2, own}] == [own, i2, i1]
    for absent in (decided, other_quorum, rejected, executed, acme_i):
        assert absent not in ids
    assert all(INTENT_KEYS <= set(x) and x["status"] == "pending_approval" for x in inbox)
    assert own not in [x["id"] for x in ok(o.get("/approvals/inbox"))["items"]]
    assert acme_i in [x["id"] for x in ok(acme_appr.get("/approvals/inbox"))["items"]]
    assert not {i1, i2, own} & {x["id"] for x in ok(acme_appr.get("/approvals/inbox"))["items"]}
    err(a1.get(f"/intents/{acme_i}"), 404, "INTENT_NOT_FOUND")
    assert short["id"] in ids
    wait_server_second(ts(short["expires_at"]))
    assert short["id"] not in [x["id"] for x in ok(a1.get("/approvals/inbox"))["items"]]
    assert ok(a1.get(f"/intents/{short['id']}"))["status"] == "expired"
    assert wallet(owner, w_short["id"])["reserved"] == "0"


def test_wf_approvals_inbox_keyboard(browser, app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    a1_m, a1 = t.apprs[0]
    w = new_wallet(owner, funds="1000", quorum_id=t.quorum["id"], floor="0")
    ids = []
    for amount in ("1", "2", "3"):
        ids.append(ok(transfer(op, w["id"], VENDOR1, amount), 201)["id"])
        next_second()
    i1, i2, i3 = ids
    with console(browser, app_url, a1_m["email"], "/console/approvals") as page:
        rows = {i: page.get_by_role("group", name=f"Intent {i}", exact=True) for i in ids}
        groups = page.get_by_role("group", name=re.compile(r"^Intent "))
        for k, i in enumerate((i3, i2, i1)):
            expect(groups.nth(k)).to_have_accessible_name(f"Intent {i}")
        rows[i3].get_by_role("button", name="Approve").focus()
        page.keyboard.press("Enter")
        expect(notifications(page)).to_contain_text(
            f"Approved: {1} of {t.quorum['authorization_threshold']} approvals")
        poll(lambda: advance(page, SETTLE_MS) or rows[i3].count() == 0, POLL_S, f"Intent {i3}")
        expect(rows[i2].get_by_role("button", name="Approve")).to_be_focused()
        ok(owner.post(f"/wallets/{w['id']}/freeze"))
        rows[i1].get_by_role("button", name="Approve").focus()
        page.keyboard.press("Enter")
        message = err(approve(a1, i1), 409, "WALLET_FROZEN")["message"]
        expect(rows[i1]).to_contain_text(message)
        expect(rows[i1].get_by_role("button", name="Approve")).to_be_focused()
        assert count("approvals", f"intent_id = {lit(i1)}") == 0
        ok(owner.post(f"/wallets/{w['id']}/unfreeze"))
        page.keyboard.press("Enter")
        poll(lambda: advance(page, SETTLE_MS) or rows[i1].count() == 0, POLL_S, f"Intent {i1}")
        expect(rows[i2].get_by_role("button", name="Approve")).to_be_focused()
        rows[i2].get_by_role("button", name="Reject").focus()
        page.keyboard.press("Enter")
        reason = rows[i2].get_by_role("textbox", name="Reason for rejecting")
        expect(reason).to_be_focused()
        page.keyboard.press("Escape")
        expect(reason).to_be_hidden()
        expect(rows[i2].get_by_role("button", name="Reject")).to_be_focused()
        page.keyboard.press("Enter")
        expect(reason).to_be_focused()
        rows[i2].get_by_role("button", name="Confirm reject").focus()
        page.keyboard.press("Enter")
        expect(reason).to_be_focused()
        expect(reason).to_have_attribute("aria-invalid", "true")
        expect(rows[i2]).to_contain_text("Enter a reason to reject")
        page.keyboard.type(REJECT_REASON)
        rows[i2].get_by_role("button", name="Confirm reject").focus()
        page.keyboard.press("Enter")
        expect(notifications(page)).to_contain_text("Intent rejected")
        empty = page.get_by_text("Nothing waiting for your approval")
        expect(empty).to_be_focused()
    assert [a["member_id"] for a in ok(owner.get(f"/intents/{i1}"))["approvals"]] == [a1_m["id"]]
    assert [a["member_id"] for a in ok(owner.get(f"/intents/{i3}"))["approvals"]] == [a1_m["id"]]
    view = ok(owner.get(f"/intents/{i2}"))
    assert view["status"] == "rejected" and view["rejection_reason"] == REJECT_REASON


def test_wf_approvals_inbox_intents_list(browser, app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    w = new_wallet(owner, funds="1000")
    mine = [ok(transfer(op, w["id"], VENDOR1, "1"), 201)["id"] for _ in range(PAGE_SIZE + 2)]
    p = new_policy(owner, [rule(f"Allow all {tag()}", "*")])
    pw = new_wallet(owner, funds="100", policy_id=p["id"], quorum_id=t.quorum["id"], floor="0")
    pend = ok(transfer(op, pw["id"], VENDOR2, "5"), 201)["id"]
    ok(approve(t.apprs[0][1], pend))
    revision = ok(owner.get(f"/intents/{pend}"))["policy_decision"]["policy_revision"]
    executed_total = count("intents", "organization_id = 'org_northwind' AND status = 'executed'")
    with console(browser, app_url, AUDITOR, "/console/intents") as page:
        select(page.get_by_role("combobox", name="Status"), "Executed")
        details = page.get_by_role("button", name=re.compile(r"^Details for "))
        expect(details.first).to_be_visible()
        load_more = page.get_by_role("button", name="Load more")
        for _ in range(executed_total // PAGE_SIZE + 2):
            if all(page.get_by_role("button", name=f"Details for {i}", exact=True).count() for i in mine):
                break
            before = details.count()
            click(load_more)
            expect(details).not_to_have_count(before)
            if load_more.count():
                expect(load_more).to_be_focused()
            else:
                assert details.evaluate_all("els => els.includes(document.activeElement)")
        for i in mine:
            expect(page.get_by_role("button", name=f"Details for {i}", exact=True)).to_have_count(1)
        expect(page.get_by_role("button", name=f"Details for {pend}", exact=True)).to_have_count(0)
        assert "executed" in page.get_by_role("table", name="Intents").inner_text()
        select(page.get_by_role("combobox", name="Status"), "Pending approval")
        button = page.get_by_role("button", name=f"Details for {pend}", exact=True)
        expect(button).to_be_visible()
        expect(page.get_by_role("button", name=f"Details for {mine[0]}", exact=True)).to_have_count(0)
        click(button)
        expect(page.get_by_text(f"Decided under revision {revision}").first).to_be_visible()
        expect(page.get_by_text(t.apprs[0][0]["name"]).first).to_be_visible()
        click(button)
        expect(page.get_by_text(f"Decided under revision {revision}").first).to_be_hidden()


def test_wf_wallet_console_create_and_freeze(browser, app_url):
    owner = login(app_url, OWNER)
    name = f"Inline {tag()}"
    with console(browser, app_url, OWNER, "/console") as page:
        create = page.get_by_role("button", name="Create wallet")
        click(create)
        name_box = page.get_by_role("textbox", name="Name")
        expect(name_box).to_be_focused()
        page.keyboard.press("Escape")
        expect(name_box).to_have_count(0)
        expect(create).to_be_focused()
        click(create)
        fill(name_box, name)
        select(page.get_by_role("combobox", name="Chain"), "base")
        select(page.get_by_role("combobox", name="Asset"), "usdc")
        click(page.get_by_role("button", name="Save wallet"))
        expect(notifications(page)).to_contain_text("Wallet created")
        expect(page.get_by_role("table", name="Wallets")).to_contain_text(name)
        made = [x for x in ok(owner.get("/wallets"))["wallets"] if x["name"] == name]
        assert len(made) == 1 and (made[0]["chain"], made[0]["asset"]) == ("base", "usdc")
        wid = made[0]["id"]
        first_ref, second_ref = "September tooling", REJECT_REASON
        ok(deposit(owner, wid, "10", first_ref), 201)
        next_second()
        ok(deposit(owner, wid, "20", second_ref), 201)
        page.goto(f"{app_url}/console/wallets/{wid}")
        expect(page.get_by_role("table", name="Activity")).to_be_visible()
        freeze = page.get_by_role("button", name="Freeze wallet")
        click(freeze)
        dialog = page.get_by_role("dialog", name="Freeze wallet")
        expect(dialog).to_contain_text("Freezing pauses new transfers and approvals.")
        expect(dialog.get_by_role("button", name="Keep active")).to_be_focused()
        for keys in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            page.keyboard.press(keys)
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(freeze).to_be_focused()
        assert wallet(owner, wid)["status"] == "active"
        click(freeze)
        click(dialog.get_by_role("button", name="Freeze"))
        expect(notifications(page)).to_contain_text("Wallet frozen")
        expect(page.get_by_role("region", name="Frozen wallet")).to_contain_text(
            "This wallet is frozen. New transfers and approvals are paused.")
        expect(page.get_by_role("form", name="Send")).to_have_count(0)
        expect(page.get_by_role("form", name="Payroll batch")).to_have_count(0)
        expect(page.get_by_role("form", name="Deposit")).to_be_visible()
        assert wallet(owner, wid)["status"] == "frozen"
        click(page.get_by_role("button", name="Unfreeze wallet"))
        expect(notifications(page)).to_contain_text("Wallet unfrozen")
    assert wallet(owner, wid)["status"] == "active"


def test_wf_wallet_console_overview_and_roles(browser, app_url):
    t = team(app_url, approvers=1, threshold=1)
    owner = t.owner
    w = new_wallet(owner, funds="1000", quorum_id=t.quorum["id"], floor="250")
    for amount in ("300", "400"):
        ok(transfer(t.op, w["id"], VENDOR1, amount), 201)
    with console(browser, app_url, t.apprs[0][0]["email"], "/console") as page:
        for card in ("Total wallets", "Pending intents", "Awaiting your approval", "Executed in 24 hours"):
            expect(page.get_by_text(card).first).to_be_visible()
        table = page.get_by_role("table", name="Wallets")
        for column in ("Name", "Chain", "Asset", "Balance", "Available", "Pending", "Policy", "Quorum", "Status"):
            expect(table.get_by_role("columnheader", name=column)).to_be_visible()
        expect(table).to_contain_text(w["name"])
        expect(page.get_by_role("navigation", name="Console").get_by_role("link", name=re.compile("^Approvals"))
               ).to_contain_text("2")
        expect(page.get_by_role("link", name="Audit")).to_have_count(0)
        page.goto(f"{app_url}/console/wallets/{w['id']}")
        for form in ("Send", "Deposit", "Payroll batch"):
            expect(page.get_by_role("form", name=form)).to_have_count(0)
        expect(page.get_by_role("button", name="Freeze wallet")).to_have_count(0)
    view = wallet(owner, w["id"])
    with console(browser, app_url, t.op_m["email"], f"/console/wallets/{w['id']}") as page:
        for fact in (w["name"], w["address"], f"{view['balance']} USDC",
                     f"{view['available']} USDC", f"{view['approval_floor']} USDC", "active"):
            expect(page.get_by_text(fact).first).to_be_visible()
        expect(page.get_by_role("button", name="Copy address")).to_be_visible()
        for form in ("Send", "Deposit", "Payroll batch"):
            expect(page.get_by_role("form", name=form)).to_be_visible()
        expect(page.get_by_role("button", name="Freeze wallet")).to_have_count(0)
    with console(browser, app_url, AUDITOR, f"/console/wallets/{w['id']}") as page:
        expect(page.get_by_text(w["address"]).first).to_be_visible()
        expect(page.get_by_role("form", name="Send")).to_have_count(0)
        expect(page.get_by_role("button", name="Freeze wallet")).to_have_count(0)
    with console(browser, app_url, OWNER, f"/console/wallets/{w['id']}") as page:
        expect(page.get_by_role("button", name="Freeze wallet")).to_be_visible()
        expect(page.get_by_role("form", name="Send")).to_be_visible()
        axe(page)


def test_wf_wallet_console_csv_export(browser, app_url):
    t = team(app_url, approvers=2, threshold=2)
    owner, op = t.owner, t.op
    name = f"=SUM {tag()}"
    w = new_wallet(owner, funds="1000", quorum_id=t.quorum["id"], floor="100", name=name)
    memos = ['+Fees, "Q4"', "-5 refund", "@ops", "<i>raw</i>"]
    executed = [ok(transfer(op, w["id"], VENDOR1, "1", memo=m), 201)["id"] for m in memos]
    pend = ok(transfer(op, w["id"], VENDOR1, "150"), 201)["id"]
    r = owner.get("/intents/export", params={"status": "executed", "wallet_id": w["id"]})
    assert r.status_code == 200
    assert r.headers["content-type"].lower() == "text/csv; charset=utf-8"
    assert r.headers["content-disposition"] == 'attachment; filename="corvo-intents.csv"'
    text = r.text
    assert text.endswith("\r\n") and "\n" not in text.replace("\r\n", "")
    rows = list(csv.reader(io.StringIO(text, newline="")))
    assert ",".join(rows[0]) == (
        "id,wallet_id,wallet_name,kind,destination_address,amount,asset,status,created_by,created_at,executed_at,"
        "tx_hash,memo")
    body = {row[0]: row for row in rows[1:]}
    assert set(body) == set(executed) and pend not in body
    for iid, memo in zip(executed, memos):
        row = body[iid]
        view = ok(owner.get(f"/intents/{iid}"))
        assert row[2] == "'" + name and row[3] == view["kind"] and row[5] in (view["amount"], view["raw_amount"])
        assert row[7] == "executed"
        assert row[6].lower() == "usdc" and row[11] == tx_of(iid)
        assert row[12] == (memo if memo.startswith("<") else "'" + memo)
    assert '"' + ("'" + memos[0]).replace('"', '""') + '"' in text
    with console(browser, app_url, AUDITOR, "/console/intents") as page:
        with page.expect_download() as download:
            click(page.get_by_role("link", name="Download CSV"))
        content = Path(download.value.path()).read_text(encoding="utf-8")
        assert "'" + name in content and "'" + memos[1] in content
        page.goto(f"{app_url}/console/wallets/{w['id']}")
        expect(page.get_by_text(name).filter(has_not_text="'" + name).first).to_be_visible()


def test_wf_wallet_console_cursor_pages(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    w = new_wallet(owner, funds="100")
    original = [ok(transfer(op, w["id"], VENDOR1, "1"), 201)["id"] for _ in range(7)]
    seen, cursor, pages = [], None, []
    while True:
        params = {"wallet_id": w["id"], "limit": 3}
        if cursor:
            params["cursor"] = cursor
        data = ok(owner.get("/intents", params=params))
        pages.append(len(data["items"]))
        seen += data["items"]
        cursor = data["next_cursor"]
        ok(transfer(op, w["id"], VENDOR1, "1"), 201)
        if cursor is None:
            break
    assert pages[:2] == [3, 3] and pages[-1] >= 1
    assert sorted(x["id"] for x in seen if x["id"] in original) == sorted(original)
    keys = [(x["created_at"], x["id"]) for x in seen]
    assert keys == sorted(keys, reverse=True)
    even = new_wallet(owner, funds="10")
    for _ in range(6):
        ok(transfer(op, even["id"], VENDOR1, "1"), 201)
    first = ok(owner.get("/intents", params={"wallet_id": even["id"], "limit": 3}))
    last = ok(owner.get("/intents", params={"wallet_id": even["id"], "limit": 3, "cursor": first["next_cursor"]}))
    assert len(last["items"]) == 3 and last["next_cursor"] is None
    cur = first["next_cursor"]
    field_err(owner.get("/intents", params={"wallet_id": even["id"], "limit": 3, "cursor": cur, "status": "executed"}),
              "INVALID_CURSOR", "cursor")
    field_err(owner.get("/intents", params={"wallet_id": w["id"], "limit": 3, "cursor": cur}), "INVALID_CURSOR",
              "cursor")
    mid = len(cur) // 2
    altered = cur[:mid] + ("A" if cur[mid] != "A" else "B") + cur[mid + 1:]
    field_err(owner.get("/intents", params={"wallet_id": even["id"], "limit": 3, "cursor": altered}),
              "INVALID_CURSOR", "cursor")
    for bad in (0, MAX_LIMIT + 1, "abc"):
        field_err(owner.get("/intents", params={"limit": bad}), "VALIDATION_ERROR", "limit")
    field_err(owner.get("/intents", params={"status": "bogus"}), "VALIDATION_ERROR", "status")
    assert len(ok(owner.get("/intents", params={"wallet_id": w["id"]}))["items"]) == min(PAGE_SIZE, 10)


def test_wallet_management(app_url):
    owner = login(app_url, OWNER)
    t = tag()
    base = {"chain": "base", "asset": "usdc"}
    strasse = ok(owner.post("/wallets", {**base, "name": f"  Stra\u00dfe {t}  "}), 201)
    assert strasse["name"] == f"Stra\u00dfe {t}" and strasse["approval_floor"] == "0" and strasse["balance"] == "0"
    err(owner.post("/wallets", {**base, "name": f"STRASSE {t.upper()}"}), 409, "WALLET_NAME_TAKEN")
    cafe = ok(owner.post("/wallets", {**base, "name": f"Cafe\u0301 {t}"}), 201)
    assert cafe["name"] == f"Caf\u00e9 {t}"
    err(owner.post("/wallets", {**base, "name": f"CAF\u00c9 {t.upper()}"}), 409, "WALLET_NAME_TAKEN")
    ok(owner.post("/wallets", {**base, "name": ("x" + t)[:1] * 0 + t + "y" * (WALLET_NAME_MAX - len(t))}), 201)
    for bad in ("", "   ", t + "y" * (WALLET_NAME_MAX + 1 - len(t))):
        field_err(owner.post("/wallets", {**base, "name": bad}), "VALIDATION_ERROR", "name")
    field_err(owner.post("/wallets", {"name": f"W {tag()}", "chain": "solana", "asset": "usdc"}), "VALIDATION_ERROR",
              "chain")
    renamed = ok(owner.patch(f"/wallets/{cafe['id']}", {"name": f"Renamed {t}"}))
    assert renamed["name"] == f"Renamed {t}"
    err(owner.patch(f"/wallets/{cafe['id']}", {"chain": "ethereum"}), 422, "UNKNOWN_FIELD")
    assert wallet(owner, cafe["id"])["chain"] == "base"
    attached = ok(owner.patch(f"/wallets/{cafe['id']}", {"policy_id": "pol_operating"}))
    assert attached["policy_id"] == "pol_operating"
    assert ok(owner.patch(f"/wallets/{cafe['id']}", {"policy_id": None}))["policy_id"] is None
    names = [x["name"] for x in ok(owner.get("/wallets"))["wallets"]]
    assert names == sorted(names, key=lambda n: unicodedata.normalize("NFC", n))
    assert all(set(x) >= WALLET_KEYS for x in ok(owner.get("/wallets"))["wallets"])


def test_deposits(app_url):
    owner = login(app_url, OWNER)
    _, op = add_member(owner, "operator")
    _, appr = add_member(owner, "approver")
    _, aud = add_member(owner, "auditor")
    w = new_wallet(owner)
    other = new_wallet(owner)
    ref = f"inv-{tag()}"
    d = ok(deposit(op, w["id"], "1.5", ref), 201)
    assert set(d) >= {"id", "wallet_id", "amount", "raw_amount", "reference", "created_by", "created_at"}
    assert (d["amount"], d["raw_amount"], d["reference"], d["wallet_id"]) == ("1.5", "1500000", ref, w["id"])
    assert d["id"].startswith("dep_") and int(wallet(owner, w["id"])["balance_raw"]) == raw("1.5")
    err(deposit(op, w["id"], "1", ref), 409, "DUPLICATE_DEPOSIT")
    ok(deposit(op, other["id"], "1", ref), 201)
    for c in (appr, aud):
        err(deposit(c, w["id"], "1"), 403, "FORBIDDEN_ROLE")
    for role, status in (("operator", 201), ("auditor", 403)):
        key = Api(app_url, ok(owner.post("/api-keys", {"name": f"Key {tag()}", "role": role}), 201)["secret"], NW_APP)
        r = deposit(key, w["id"], "1")
        ok(r, 201) if status == 201 else err(r, 403, "FORBIDDEN_ROLE")
    ok(owner.post(f"/wallets/{w['id']}/freeze"))
    ok(deposit(owner, w["id"], "1"), 201)
    assert int(wallet(owner, w["id"])["balance_raw"]) == raw("1.5") + 2 * raw("1")
    race_ref = f"race-{tag()}"
    results = race(*[lambda: deposit(op.clone(), w["id"], "1", race_ref) for _ in range(RACERS)])
    assert sum(r.status_code == 201 for r in results) == 1
    for r in results:
        if r.status_code != 201:
            err(r, 409, "DUPLICATE_DEPOSIT")
    assert int(wallet(owner, w["id"])["balance_raw"]) == raw("1.5") + 3 * raw("1")
    assert_balanced(w["id"], other["id"])


def test_wf_api_roles_order(app_url):
    op = login(app_url, OPERATOR)
    _, aud = add_member(login(app_url, OWNER), "auditor")
    missing = "wal_" + "0" * 20
    anon = Api(app_url)
    err(anon.get("/wallets"), 400, "APP_ID_REQUIRED")
    err(Api(app_url, "junk-token").get("/wallets"), 400, "APP_ID_REQUIRED")
    assert err(Api(app_url, None, NW_APP).get("/wallets"), 401, "UNAUTHENTICATED")["details"] == {}
    assert err(Api(app_url, "junk-token", NW_APP).get("/wallets"), 401, "INVALID_CREDENTIAL")["details"] == {}
    err(Api(app_url, op.token, ACME_APP).get(f"/wallets/{missing}"), 403, "APP_ID_MISMATCH")
    err(Api(app_url, op.token, ACME_APP).post("/wallets", {}), 403, "APP_ID_MISMATCH")
    err(op.post("/wallets", {"bad": 1}), 403, "FORBIDDEN_ROLE")
    err(aud.post(f"/wallets/{missing}/transfers", {"bad": 1}), 403, "FORBIDDEN_ROLE")
    err(op.post(f"/wallets/{missing}/transfers", {"bad": 1}), 404, "WALLET_NOT_FOUND")
    err(Api(app_url).call("POST", "/wallets", raw_body=b" " * (MAX_BODY + 1)), 413, "PAYLOAD_TOO_LARGE")


def test_wf_api_roles_fresh_roles(app_url):
    owner = login(app_url, OWNER)
    op, appr, aud = login(app_url, OPERATOR), login(app_url, APPROVER1), login(app_url, AUDITOR)
    for c in (owner, op, appr, aud):
        for path in ("/wallets", "/intents", "/policies", "/aggregations", "/quorums", "/members"):
            ok(c.get(path))
    w = new_wallet(owner, funds="100")
    for c, method, path, body in [
        (appr, "POST", f"/wallets/{w['id']}/transfers", {"destination_address": VENDOR1, "amount": "1"}),
        (aud, "POST", f"/wallets/{w['id']}/deposits", {"amount": "1", "reference": "r"}),
        (op, "POST", f"/wallets/{w['id']}/freeze", NOBODY),
        (op, "PATCH", f"/wallets/{w['id']}", {"name": "Hijack"}),
        (op, "POST", "/policies", {"version": "1.0", "name": "x", "chain_type": "ethereum", "rules": [rule("a")]}),
        (op, "POST", "/quorums", {"name": "x", "member_ids": [], "authorization_threshold": 1, "expiry_seconds": 60}),
        (op, "POST", "/aggregations", {"name": "x", "metric": "count", "window_seconds": 60, "asset": "usdc"}),
        (op, "POST", "/members", {"name": "x", "email": "x@x.io", "role": "owner", "password": PASSWORD}),
        (op, "POST", "/api-keys", {"name": "x", "role": "operator"}),
        (op, "GET", "/api-keys", NOBODY), (op, "GET", "/audit", NOBODY), (op, "GET", "/webhooks/secret", NOBODY),
        (appr, "GET", "/audit", NOBODY), (appr, "GET", "/api-keys", NOBODY), (aud, "GET", "/webhooks/secret", NOBODY),
        (aud, "POST", "/webhooks/secret/rotate", NOBODY),
    ]:
        err(c.call(method, path, body), 403, "FORBIDDEN_ROLE")
    view = wallet(owner, w["id"])
    assert (view["status"], view["balance"], view["name"]) == ("active", "100", w["name"])
    assert count("intents", f"wallet_id = {lit(w['id'])}") == 0
    for path in ("/audit", "/api-keys", "/webhooks/events", "/audit/verify"):
        ok(aud.get(path))
    x_m, x = add_member(owner, "approver")
    err(deposit(x, w["id"], "1"), 403, "FORBIDDEN_ROLE")
    ok(owner.patch(f"/members/{x_m['id']}", {"role": "operator"}))
    ok(deposit(x, w["id"], "1"), 201)
    ok(owner.patch(f"/members/{x_m['id']}", {"role": "auditor"}))
    err(deposit(x, w["id"], "1"), 403, "FORBIDDEN_ROLE")
    ok(x.get("/audit"))
    assert ok(x.get("/me"))["member"]["role"] == "auditor"


def test_wf_api_roles_api_keys(app_url):
    owner = login(app_url, OWNER)
    created = ok(owner.post("/api-keys", {"name": f"Key {tag()}", "role": "operator"}), 201)
    assert set(created) >= {"id", "name", "role", "prefix", "secret", "created_by", "created_at"}
    assert re.fullmatch(r"cvo_[0-9a-f]{40}", created["secret"]) and created["prefix"] == created["secret"][:12]
    for reader in (owner, login(app_url, AUDITOR)):
        listing = ok(reader.get("/api-keys"))["api_keys"]
        assert all(set(k) == KEY_KEYS for k in listing) and created["secret"] not in json.dumps(listing)
        assert any(k["id"] == created["id"] for k in listing)
        members = ok(reader.get("/members"))["members"]
        assert all(set(m) == MEMBER_KEYS for m in members)
    for bad in ("owner", "approver"):
        field_err(owner.post("/api-keys", {"name": f"Key {tag()}", "role": bad}), "VALIDATION_ERROR", "role")
    key = Api(app_url, created["secret"], NW_APP)
    me = ok(key.get("/me"))
    assert me["member"] is None and me["api_key"]["id"] == created["id"] and created["secret"] not in json.dumps(me)
    w = new_wallet(owner, funds="10")
    assert ok(transfer(key, w["id"], VENDOR1, "1"), 201)["status"] == "executed"
    err(key.post("/wallets", {"name": f"W {tag()}", "chain": "base", "asset": "usdc"}), 403, "FORBIDDEN_ROLE")
    err(key.get("/audit"), 403, "FORBIDDEN_ROLE")
    aud_key = Api(app_url, ok(owner.post("/api-keys", {"name": f"Key {tag()}", "role": "auditor"}), 201)["secret"],
                  NW_APP)
    ok(aud_key.get("/audit"))
    err(transfer(aud_key, w["id"], VENDOR1, "1"), 403, "FORBIDDEN_ROLE")
    assert ok(owner.delete(f"/api-keys/{created['id']}")) == {"revoked": True}
    err(key.get("/wallets"), 401, "INVALID_CREDENTIAL")
    revoked = [k for k in ok(owner.get("/api-keys"))["api_keys"] if k["id"] == created["id"]][0]
    assert STAMP.match(revoked["revoked_at"])
    demoted_m, demoted = add_member(owner, "owner")
    kept = Api(app_url, ok(demoted.post("/api-keys", {"name": f"Key {tag()}", "role": "auditor"}), 201)["secret"],
               NW_APP)
    ok(owner.patch(f"/members/{demoted_m['id']}", {"role": "approver"}))
    ok(kept.get("/wallets"))
    gone_m, gone = add_member(owner, "owner")
    k1 = ok(gone.post("/api-keys", {"name": f"Key {tag()}", "role": "auditor"}), 201)
    k2 = ok(gone.post("/api-keys", {"name": f"Key {tag()}", "role": "operator"}), 201)
    assert ok(owner.delete(f"/members/{gone_m['id']}")) == {"removed": True}
    for k in (k1, k2):
        err(Api(app_url, k["secret"], NW_APP).get("/wallets"), 401, "INVALID_CREDENTIAL")
    events = db().rows(
        "SELECT seq, type, actor, subject_id, data FROM audit_events WHERE organization_id = 'org_northwind' AND "
        f"(subject_id IN ({lit(k1['id'])}, {lit(k2['id'])}, {lit(gone_m['id'])})) ORDER BY seq")
    tail = [e for e in events if e["type"] in ("api_key.revoked", "member.removed")]
    assert [e["type"] for e in tail] == ["api_key.revoked", "api_key.revoked", "member.removed"]
    assert [e["data"].get("api_key_id") for e in tail[:2]] == [k1["id"], k2["id"]]
    assert [e["data"].get("prefix") for e in tail[:2]] == [k1["prefix"], k2["prefix"]]
    assert tail[2]["data"] == {"member_id": gone_m["id"]} and all(e["actor"] == OWNER for e in tail)
    acme = login(app_url, ACME_OWNER)
    live = ok(owner.post("/api-keys", {"name": f"Key {tag()}", "role": "auditor"}), 201)
    same_as_missing(acme.delete(f"/api-keys/{live['id']}"),
                    acme.delete("/api-keys/key_" + "0" * 20))
    same_as_missing(acme.patch(f"/members/{demoted_m['id']}", {"role": "auditor"}),
                    acme.patch("/members/mem_" + "0" * 20, {"role": "auditor"}))
    ok(Api(app_url, live["secret"], NW_APP).get("/wallets"))
    assert [m["role"] for m in ok(owner.get("/members"))["members"] if m["id"] == demoted_m["id"]] == ["approver"]
    assert live["id"] not in json.dumps(ok(acme.get("/api-keys")))


def test_wf_api_roles_members_last_owner(app_url):
    owner = login(app_url, OWNER)
    name, email = person("member")
    m = ok(owner.post("/members", {"name": f"  {name}  ", "email": f"  {email.upper()}  ", "role": "approver",
                                   "password": PASSWORD}), 201)
    assert set(m) == MEMBER_KEYS and m["email"] == email and m["name"] == name
    err(owner.post("/members", {"name": name, "email": email, "role": "approver", "password": PASSWORD}), 409,
        "MEMBER_EXISTS")
    acme = login(app_url, ACME_OWNER)
    err(acme.post("/members", {"name": name, "email": email, "role": "approver", "password": PASSWORD}), 409,
        "MEMBER_EXISTS")
    other_name, other_email = person("member")
    field_err(owner.post("/members", {"name": other_name, "email": other_email, "role": "approver",
                                      "password": "short"}), "VALIDATION_ERROR", "password")
    field_err(owner.post("/members", {"name": other_name, "email": other_email, "role": "admin",
                                      "password": PASSWORD}), "VALIDATION_ERROR", "role")
    op_m, _ = add_member(owner, "operator")

    def quorum(ids, threshold):
        return owner.post("/quorums", {"name": f"Q {tag()}", "member_ids": ids, "authorization_threshold": threshold,
                                       "expiry_seconds": DAY_S})

    extra = [ok(owner.post("/members", {"name": f"A {tag()}", "email": person("approver")[1], "role": "approver",
                                        "password": PASSWORD}), 201)["id"] for _ in range(QUORUM_CAP)]
    for ids in ([op_m["id"]], [], [m["id"], m["id"]], ["mem_acme_owner"], extra + [m["id"]]):
        err(quorum(ids, 1), 422, "INVALID_QUORUM_MEMBER")
    err(quorum([m["id"]], 0), 422, "INVALID_THRESHOLD")
    err(quorum([m["id"]], 2), 422, "INVALID_THRESHOLD")
    ok(quorum(extra, QUORUM_CAP), 201)
    ok(quorum([m["id"]], 1), 201)
    err(owner.patch(f"/members/{m['id']}", {"role": "operator"}), 409, "MEMBER_IN_QUORUM")
    err(owner.delete(f"/members/{m['id']}"), 409, "MEMBER_IN_QUORUM")
    err(owner.patch(f"/members/{NW_OWNER_ID}", {"role": "operator"}), 409, "MEMBER_IN_QUORUM")
    free_m, free = add_member(owner, "approver")
    assert ok(owner.patch(f"/members/{free_m['id']}", {"role": "auditor"}))["role"] == "auditor"
    assert ok(owner.delete(f"/members/{free_m['id']}")) == {"removed": True}
    err(free.get("/me"), 401, "INVALID_CREDENTIAL")
    assert count("sessions", f"member_id = {lit(free_m['id'])}") == 0
    err(acme.patch(f"/members/{ACME_OWNER_ID}", {"role": "operator"}), 409, "LAST_OWNER")
    err(acme.delete(f"/members/{ACME_OWNER_ID}"), 409, "LAST_OWNER")
    assert ok(acme.get("/me"))["member"]["role"] == "owner"


def test_last_owner_race(app_url):
    acme = login(app_url, ACME_OWNER)
    o2_m, o2 = add_member(acme, "owner")
    try:
        results = race(lambda: acme.clone().patch(f"/members/{o2_m['id']}", {"role": "operator"}),
                       lambda: o2.clone().patch(f"/members/{ACME_OWNER_ID}", {"role": "operator"}))
        assert sum(r.status_code == 200 for r in results) == 1
        loser = [r for r in results if r.status_code != 200][0]
        assert (loser.status_code, loser.json()["error"]["code"]) in {(409, "LAST_OWNER"), (403, "FORBIDDEN_ROLE")}
        assert count("members", "organization_id = 'org_acme' AND role = 'owner'") >= 1
    finally:
        roles = {r["id"]: r["role"] for r in db().rows(
            f"SELECT id, role FROM members WHERE id IN ('mem_acme_owner', {lit(o2_m['id'])})")}
        if roles.get("mem_acme_owner") != "owner":
            ok(o2.patch(f"/members/{ACME_OWNER_ID}", {"role": "owner"}))
        ok(login(app_url, ACME_OWNER).delete(f"/members/{o2_m['id']}"))


def same_as_missing(found: httpx.Response, missing: httpx.Response) -> None:
    assert found.status_code == missing.status_code == 404, (found.text, missing.text)
    a, b = (str(r.request.url) + r.request.content.decode() for r in (found, missing))
    head = len(os.path.commonprefix([a, b]))
    tail = len(os.path.commonprefix([a[head:][::-1], b[head:][::-1]]))
    echoed = json.dumps(found.json()["error"]).replace(a[head:len(a) - tail], b[head:len(b) - tail])
    assert found.json()["error"] == missing.json()["error"] or json.loads(echoed) == missing.json()["error"]
    assert found.json()["data"] is None


def test_wf_tenant_isolation_routes(app_url):
    t = team(app_url, approvers=1, threshold=1)
    nw = t.owner
    w = new_wallet(nw, funds="10", quorum_id=t.quorum["id"], floor="0")
    i = ok(transfer(t.op, w["id"], VENDOR1, "1"), 201)["id"]
    p = new_policy(nw, [rule("Only")])
    agg = new_aggregation(nw)
    m, _ = add_member(nw, "auditor")
    k = ok(nw.post("/api-keys", {"name": f"Key {tag()}", "role": "auditor"}), 201)["id"]
    acme = login(app_url, ACME_OWNER)
    z = "0" * 20
    ev = {"method": "transfer", "wallet_id": "wal_acme_ops", "destination_address": VENDOR1, "amount": "1"}
    routes = [
        ("GET", "/wallets/{}", "wal_", w["id"], NOBODY), ("PATCH", "/wallets/{}", "wal_", w["id"], {"name": "x"}),
        ("POST", "/wallets/{}/freeze", "wal_", w["id"], NOBODY), ("POST", "/wallets/{}/unfreeze", "wal_", w["id"], NOBODY),
        ("POST", "/wallets/{}/transfers", "wal_", w["id"], {"destination_address": VENDOR1, "amount": "1"}),
        ("POST", "/wallets/{}/batches", "wal_", w["id"], {"items": [{"destination_address": VENDOR1, "amount": "1",
                                                                    "memo": ""}]}),
        ("POST", "/wallets/{}/deposits", "wal_", w["id"], {"amount": "1", "reference": "r"}),
        ("GET", "/intents/{}", "int_", i, NOBODY), ("POST", "/intents/{}/approve", "int_", i, NOBODY),
        ("POST", "/intents/{}/reject", "int_", i, {"reason": "x"}), ("POST", "/intents/{}/cancel", "int_", i, NOBODY),
        ("GET", "/policies/{}", "pol_", p["id"], NOBODY), ("GET", "/policies/{}/revisions", "pol_", p["id"], NOBODY),
        ("PATCH", "/policies/{}", "pol_", p["id"], {"name": "x"}), ("DELETE", "/policies/{}", "pol_", p["id"], NOBODY),
        ("POST", "/policies/{}/evaluate", "pol_", p["id"], ev),
        ("PATCH", "/quorums/{}", "kq_", t.quorum["id"], {"name": "x"}),
        ("PATCH", "/members/{}", "mem_", m["id"], {"role": "approver"}), ("DELETE", "/members/{}", "mem_", m["id"], NOBODY),
        ("DELETE", "/api-keys/{}", "key_", k, NOBODY),
    ]
    for method, template, prefix, real, body in routes:
        same_as_missing(acme.call(method, template.format(real), body), acme.call(method, template.format(prefix + z), body))
    base = {"name": f"W {tag()}", "chain": "base", "asset": "usdc"}
    same_as_missing(acme.post("/wallets", {**base, "policy_id": p["id"]}),
                    acme.post("/wallets", {**base, "policy_id": "pol_" + z}))
    same_as_missing(acme.post("/wallets", {**base, "quorum_id": t.quorum["id"]}),
                    acme.post("/wallets", {**base, "quorum_id": "kq_" + z}))
    acme_p = new_policy(acme, [rule("Only")])
    same_as_missing(acme.post(f"/policies/{acme_p['id']}/evaluate", {**ev, "wallet_id": w["id"]}),
                    acme.post(f"/policies/{acme_p['id']}/evaluate", {**ev, "wallet_id": "wal_" + z}))

    def agg_policy(agg_id):
        return acme.post("/policies", {"version": "1.0", "name": f"P {tag()}", "chain_type": "ethereum", "rules": [
            rule("A", "transfer", "ALLOW", [cond(f"aggregation.{agg_id}", "lte", "1", "reference")])]})

    a, b = agg_policy(agg["id"]), agg_policy("agg_" + z)
    assert a.status_code == b.status_code == 422 and a.json()["error"] == b.json()["error"]
    view = wallet(nw, w["id"])
    assert (view["name"], view["status"], view["balance"], view["available"]) == (w["name"], "active", "10", "9")
    assert ok(nw.get(f"/intents/{i}"))["status"] == "pending_approval"


def test_wf_tenant_isolation_derived(app_url):
    owner = login(app_url, OWNER)
    w = new_wallet(owner, funds="10")
    for _ in range(2):
        ok(transfer(owner, w["id"], VENDOR1, "1"), 201)
    key = ok(owner.post("/api-keys", {"name": f"Key {tag()}", "role": "auditor"}), 201)
    acme = login(app_url, ACME_OWNER)
    data = ok(acme.get("/intents", params={"wallet_id": w["id"]}))
    assert data == {"items": [], "next_cursor": None}
    export = acme.get("/intents/export", params={"wallet_id": w["id"]})
    assert export.status_code == 200 and len([x for x in export.text.split("\r\n") if x]) == 1
    assert w["id"] not in json.dumps(ok(acme.get("/wallets")))
    assert OWNER not in json.dumps(ok(acme.get("/members")))
    assert "kq_finance" not in json.dumps(ok(acme.get("/quorums")))
    assert "agg_daily_outflow" not in json.dumps(ok(acme.get("/aggregations")))
    assert "pol_operating" not in json.dumps(ok(acme.get("/policies")))
    assert key["id"] not in json.dumps(ok(acme.get("/api-keys")))
    assert w["id"] not in json.dumps(ok(acme.get("/audit", params={"limit": 500})))
    assert w["id"] not in json.dumps(ok(acme.get("/webhooks/events", params={"limit": 500})))
    cursor = ok(owner.get("/intents", params={"wallet_id": w["id"], "limit": 1}))["next_cursor"]
    field_err(acme.get("/intents", params={"wallet_id": w["id"], "limit": 1, "cursor": cursor}), "INVALID_CURSOR",
              "cursor")


def test_wf_tenant_isolation_console_not_found(browser, app_url):
    owner = login(app_url, OWNER)
    w = new_wallet(owner)
    with console(browser, app_url, ACME_OWNER, "/console") as page:
        for path in (f"/console/wallets/{w['id']}", "/console/wallets/wal_" + "0" * 20,
                     f"/console/policies/{POL_OPERATING}"):
            page.goto(app_url + path)
            expect(page.get_by_text("Not found").first).to_be_visible()
            expect(page.get_by_text(w["name"])).to_have_count(0)


def test_wf_audit_trail_chain(app_url):
    owner = login(app_url, OWNER)
    aud = login(app_url, AUDITOR)
    first = ok(aud.get("/audit", params={"after_seq": 0, "limit": 1}))["events"][0]
    assert first["seq"] == 1 and first["prev_hash"] == ZERO_HASH and first["hash"] == chain_hash(ZERO_HASH, first)
    start = db().rows("SELECT COALESCE(max(seq), 0) AS s FROM audit_events WHERE organization_id = 'org_northwind'")[0]["s"]
    w = new_wallet(owner)
    ok(owner.patch(f"/wallets/{w['id']}", {"name": f"Audit {tag()}"}))
    ok(owner.post(f"/wallets/{w['id']}/freeze"))
    ok(owner.post(f"/wallets/{w['id']}/unfreeze"))
    d = ok(deposit(owner, w["id"], "5"), 201)
    p = new_policy(owner, [rule("Only")])
    ok(owner.patch(f"/policies/{p['id']}", {"name": f"P {tag()}"}))
    m, _ = add_member(owner, "approver")
    i = ok(transfer(owner, w["id"], VENDOR1, "1"), 201)
    key = ok(owner.post("/api-keys", {"name": f"Key {tag()}", "role": "operator"}), 201)
    kd = ok(deposit(Api(app_url, key["secret"], NW_APP), w["id"], "1"), 201)
    events = ok(aud.get("/audit", params={"after_seq": start - 1 if start else 0, "limit": 500}))["events"]
    for prev, cur in zip(events, events[1:]):
        assert cur["seq"] == prev["seq"] + 1 and cur["prev_hash"] == prev["hash"]
    for e in events:
        assert e["hash"] == chain_hash(e["prev_hash"], e) and STAMP.match(e["at"])
    mine = [(e["type"], e["subject_id"], e["actor"]) for e in events if e["seq"] > start and e["subject_id"] in
            {w["id"], d["id"], p["id"], m["id"], i["id"], key["id"], kd["id"]}]
    assert mine == [("wallet.created", w["id"], OWNER), ("wallet.updated", w["id"], OWNER),
                    ("wallet.frozen", w["id"], OWNER), ("wallet.unfrozen", w["id"], OWNER),
                    ("deposit.received", d["id"], OWNER), ("policy.created", p["id"], OWNER),
                    ("policy.updated", p["id"], OWNER), ("member.added", m["id"], OWNER),
                    ("intent.created", i["id"], OWNER), ("intent.executed", i["id"], OWNER),
                    ("api_key.created", key["id"], OWNER), ("deposit.received", kd["id"], "api_key:" + key["prefix"])]
    dumped = json.dumps(events, ensure_ascii=False)
    assert key["secret"] not in dumped and PASSWORD not in dumped and owner.token not in dumped
    acme_events = ok(login(app_url, ACME_OWNER).get("/audit", params={"limit": 500}))["events"]
    assert not {e["subject_id"] for e in acme_events} & {w["id"], i["id"], p["id"]}


def test_wf_audit_trail_signed_log(app_url):
    owner = login(app_url, OWNER)
    aud = login(app_url, AUDITOR)
    s1 = ok(owner.get("/webhooks/secret"))["secret"]
    assert re.fullmatch(r"whsec_[0-9a-f]{32}", s1)
    start = db().rows("SELECT COALESCE(max(seq), 0) AS s FROM webhook_events WHERE organization_id = 'org_northwind'")[0]["s"]
    appr_m, _ = add_member(owner, "approver")
    short_q = new_quorum(owner, [appr_m["id"]], 1, EXPIRY_S)
    wx = new_wallet(owner, funds="10", quorum_id=short_q["id"], floor="0")
    px = ok(transfer(owner, wx["id"], VENDOR1, "2"), 201)
    w = new_wallet(owner)
    d = ok(deposit(owner, w["id"], "5"), 201)
    i = ok(transfer(owner, w["id"], VENDOR1, "1"), 201)

    def fetch():
        return ok(aud.get("/webhooks/events", params={"after_seq": start, "limit": 500}))["events"]

    before = [e for e in fetch() if w["id"] in e["body"]]
    assert [e["type"] for e in before] == ["deposit.received", "intent.created", "intent.executed"]
    for e in before:
        body = json.loads(e["body"], object_pairs_hook=lambda pairs: pairs)
        assert [k for k, _ in body] == ["id", "type", "created_at", "data"]
        parsed = json.loads(e["body"])
        assert (parsed["id"], parsed["type"], parsed["created_at"]) == (e["id"], e["type"], e["created_at"])
        assert e["id"].startswith("evt_") and e["timestamp"] == ts(e["created_at"])
        assert e["signature"] == signature(s1, e)
    assert json.loads(before[0]["body"])["data"] == {"deposit_id": d["id"], "wallet_id": w["id"],
                                                     "raw_amount": json.loads(before[0]["body"])["data"]["raw_amount"]}
    assert str(json.loads(before[0]["body"])["data"]["raw_amount"]) == "5000000"
    audit_data = {r["type"]: r["data"] for r in audit_rows(i["id"])}
    assert json.loads(before[1]["body"])["data"] == audit_data["intent.created"]
    rotated = ok(owner.post("/webhooks/secret/rotate"))["secret"]
    assert rotated != s1 and re.fullmatch(r"whsec_[0-9a-f]{32}", rotated)
    assert ok(owner.get("/webhooks/secret"))["secret"] == rotated
    ok(transfer(owner, w["id"], VENDOR1, "1"), 201)
    after = [e for e in fetch() if w["id"] in e["body"]]
    assert after[:3] == before
    assert all(e["signature"] == signature(rotated, e) for e in after[3:]) and len(after) == 5
    wait_server_second(ts(px["expires_at"]))
    ok(aud.get(f"/intents/{px['id']}"))
    expired = poll(lambda: [e for e in fetch() if e["type"] == "intent.expired" and px["id"] in e["body"]],
                   POLL_S, "no signed intent.expired event")
    assert len(expired) == 1
    ex = expired[0]
    assert ex["created_at"] == px["expires_at"] and ex["timestamp"] == ts(px["expires_at"])
    data = json.loads(ex["body"])["data"]
    assert {k: str(v) for k, v in data.items()} == {"intent_id": px["id"], "wallet_id": wx["id"], "kind": "transfer",
                                                    "raw_amount": px["raw_amount"], "status": "expired"}
    assert ex["signature"] == signature(rotated, ex)
    assert count("audit_events", f"type = 'intent.expired' AND subject_id = {lit(px['id'])}") == 1


def test_wf_audit_trail_pages(browser, app_url):
    t = team(app_url, approvers=3, threshold=2)
    owner = t.owner
    agg = new_aggregation(owner)
    with console(browser, app_url, OWNER, "/console/quorums") as page:
        row = page.get_by_role("table", name="Key quorums").get_by_role("row", name=re.compile(re.escape(t.quorum["name"])))
        expect(row).to_contain_text(f"{t.quorum['authorization_threshold']} of {len(t.quorum['member_ids'])}")
        expect(row).to_contain_text(t.apprs[0][0]["name"])
        expect(page.get_by_role("table", name="Aggregations")).to_contain_text(agg["name"])
        page.goto(f"{app_url}/console/audit")
        click(page.get_by_role("tab", name="Signed events"))
        expect(page.get_by_text(re.compile(r"v1,")).first).to_be_visible()
        page.goto(f"{app_url}/console/settings")
        kname = f"Key {tag()}"
        name_box = page.get_by_role("textbox", name="Key name")
        create = page.get_by_role("button", name="Create API key")
        opener = None
        if not name_box.is_visible():
            opener = create.element_handle()
            click(create)
        fill(name_box, kname)
        select(page.get_by_role("combobox", name="Key role"), "operator")
        submits = [b for b in create.all() if opener is None or not b.evaluate("(node, other) => node === other", opener)]
        click((submits or [create.last])[-1])
        expect(notifications(page)).to_contain_text("API key created")
        expect(page.get_by_text("Copy this key now. It will not be shown again.")).to_be_visible()
        secret = re.search(r"cvo_[0-9a-f]{40}", page_text(page)).group(0)
        me = ok(Api(app_url, secret, NW_APP).get("/me"))
        assert me["api_key"]["name"] == kname and me["api_key"]["role"] == "operator"
        page.reload()
        assert secret not in page_text(page)
        expect(page.get_by_role("table", name="API keys")).to_contain_text(secret[:12])
        old = ok(owner.get("/webhooks/secret"))["secret"]
        click(page.get_by_role("button", name="Reveal"))
        poll(lambda: old in page_text(page), POLL_S, "Reveal")
        click(page.get_by_role("button", name="Rotate"))
        expect(notifications(page)).to_contain_text("Signing secret rotated")
        assert ok(owner.get("/webhooks/secret"))["secret"] != old
    with console(browser, app_url, t.op_m["email"], "/console/settings") as page:
        expect(page.get_by_role("button", name="Reveal")).to_have_count(0)
        page.goto(f"{app_url}/console/audit")
        expect(page.get_by_text("You do not have access to this page")).to_be_visible()
        expect(page.get_by_role("status", name="Chain status")).to_have_count(0)


def psql(url: str, sql: str) -> str:
    out = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], capture_output=True, text=True,
                         timeout=HTTP_TIMEOUT)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


def with_database(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/" + name, parts.query, parts.fragment))


def test_wf_audit_trail_verify(browser, app_url):
    owner = login(app_url, OWNER)
    new_wallet(owner)
    total = count("audit_events", "organization_id = 'org_northwind'")
    key = Api(app_url, ok(owner.post("/api-keys", {"name": f"Key {tag()}", "role": "auditor"}), 201)["secret"], NW_APP)
    total += 1
    for reader in (owner, login(app_url, AUDITOR), key):
        result = ok(reader.get("/audit/verify"))
        assert result["valid"] is True and result["first_broken_seq"] is None
        assert total <= result["events"] <= count("audit_events", "organization_id = 'org_northwind'")
    err(login(app_url, OPERATOR).get("/audit/verify"), 403, "FORBIDDEN_ROLE")
    acme_total = count("audit_events", "organization_id = 'org_acme'")
    assert ok(login(app_url, ACME_OWNER).get("/audit/verify"))["events"] == acme_total
    total = count("audit_events", "organization_id = 'org_northwind'")
    with console(browser, app_url, AUDITOR, "/console/audit") as page:
        status = page.get_by_role("status", name="Chain status")
        expect(status).to_contain_text(f"Chain verified: {total} events")
        new_wallet(owner)
        click(page.get_by_role("button", name="Verify chain"))
        expect(status).to_contain_text(f"Chain verified: {total + 1} events")
    admin = os.environ["DATABASE_URL"]
    scratch = f"corvo_verify_{tag()}"
    scratch_url = with_database(admin, scratch)
    broken = 3
    psql(admin, f"CREATE DATABASE {scratch}")
    try:
        with app_copy(scratch_url) as copy:
            wait_health(copy, lambda r: r.status_code == 200, "scratch copy healthy")
            owner_copy = login(copy.base, OWNER)
            intact = ok(owner_copy.get("/audit/verify"))
            assert intact["valid"] is True and intact["first_broken_seq"] is None, copy.tail()
            psql(scratch_url, "UPDATE audit_events SET hash = repeat('f', 64) "
                              f"WHERE organization_id = 'org_northwind' AND seq = {broken}")
            n = int(psql(scratch_url, "SELECT count(*) FROM audit_events WHERE organization_id = 'org_northwind'"))
            assert ok(owner_copy.get("/audit/verify")) == {"valid": False, "events": n, "first_broken_seq": broken}
            assert ok(login(copy.base, ACME_OWNER).get("/audit/verify"))["valid"] is True
            with console(browser, copy.base, AUDITOR, "/console/audit") as page:
                status = page.get_by_role("status", name="Chain status")
                expect(status).to_contain_text(f"Chain broken at event {broken}")
                click(page.get_by_role("button", name="Verify chain"))
                expect(status).to_contain_text(f"Chain broken at event {broken}")
    finally:
        psql(admin, f"DROP DATABASE IF EXISTS {scratch} WITH (FORCE)")

def test_wf_sign_in_seeded_members(app_url):
    orgs = {"org_northwind": ("Northwind Treasury", NW_APP), "org_acme": ("Acme Payroll", ACME_APP)}
    for mid, name, email, role, org in SEED_MEMBERS:
        r = httpx.post(app_url + API + "/auth/login", json={"email": f"  {email.upper()} ", "password": PASSWORD},
                       timeout=HTTP_TIMEOUT)
        data = ok(r)
        assert set(data["member"]) == MEMBER_KEYS
        assert (data["member"]["id"], data["member"]["name"], data["member"]["email"], data["member"]["role"]) == (
            mid, name, email, role)
        assert {k: data["organization"][k] for k in ("id", "name", "app_id")} == {
            "id": org, "name": orgs[org][0], "app_id": orgs[org][1]}
        me = ok(Api(app_url, data["token"], orgs[org][1]).get("/me"))
        assert me["member"]["id"] == mid and me["member"]["role"] == role and me["api_key"] is None
        assert me["organization"]["id"] == org and set(me["member"]) == MEMBER_KEYS
    with app_copy(os.environ["DATABASE_URL"]) as copy:
        wait_health(copy, lambda r: r.status_code == 200, "copy healthy")
        for mid, _, email, role, _ in SEED_MEMBERS:
            data = ok(httpx.post(copy.base + API + "/auth/login", json={"email": email, "password": PASSWORD},
                                 timeout=HTTP_TIMEOUT))
            assert data["member"]["id"] == mid and data["member"]["role"] == role, copy.tail()


def test_wf_sign_in_bad_credentials(app_url):
    url = app_url + API + "/auth/login"
    err(httpx.post(url, json={"email": OWNER, "password": PASSWORD + "x"}), 401, "BAD_CREDENTIALS")
    err(httpx.post(url, json={"email": person("ghost")[1], "password": PASSWORD}), 401, "BAD_CREDENTIALS")
    owner = login(app_url, OWNER)
    m, member = add_member(owner, "approver")
    ok(owner.delete(f"/members/{m['id']}"))
    err(httpx.post(url, json={"email": m["email"], "password": PASSWORD}), 401, "BAD_CREDENTIALS")
    err(member.get("/me"), 401, "INVALID_CREDENTIAL")


def test_wf_sign_in_logout(app_url):
    first = login(app_url, OWNER)
    ok(first.get("/me"))
    assert ok(first.post("/auth/logout")) == {}
    err(first.get("/me"), 401, "INVALID_CREDENTIAL")


def test_wf_sign_in_redirects(browser, app_url):
    origin = urlsplit(app_url)
    with open_app(browser, f"{app_url}/console/intents") as page:
        page.wait_for_url(lambda u: urlsplit(u).path == "/login")
        assert parse_qs(urlsplit(page.url).query)["next"] == ["/console/intents"]
        email = page.get_by_role("textbox", name="Email")
        sign_in(page, OWNER, PASSWORD + "x")
        expect(page.get_by_role("alert")).to_contain_text("Email or password is incorrect")
        expect(email).to_have_value(OWNER)
        sign_in(page, OWNER)
        page.wait_for_url(lambda u: urlsplit(u).path == "/console/intents")
        page.reload()
        assert urlsplit(page.url).path == "/console/intents"
        click(page.get_by_role("button", name="Sign out"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/")
        for bad in (FOREIGN_NEXT[len("https:"):], FOREIGN_NEXT):
            page.goto(f"{app_url}/login?next={quote(bad, safe='')}")
            sign_in(page, OWNER)
            page.wait_for_url(lambda u: urlsplit(u).path == "/console")
            assert urlsplit(page.url).netloc == origin.netloc
            click(page.get_by_role("button", name="Sign out"))
            page.wait_for_url(lambda u: urlsplit(u).path == "/")


LANDING_ORDER = [
    "Hold, move and govern digital money", "Open wallets, write spending policies and route large payouts",
    "One wallet layer for every money flow", "Wallets for every customer", "Trading desks that keep pace",
    "Treasury with guardrails", "Accounts for neobanks", "Payments by software agents", "Card spend from balances",
    "Yield on idle funds",
]
STATS = ["40M+", "wallets opened", "85+", "countries", "$5B+", "moved each month", "99.95%",
         "uptime over the last year"]
CASES = ["Northline pays contractors in 60 countries from one Corvo treasury",
         "Paygrid gives hourly workers dollar wallets on Corvo",
         "Tidepool runs its trading desk settlements through Corvo",
         "Fennick ships a self-custody wallet built with Corvo"]
BUILDER_CARDS = ["Keys kept apart", "Use only what you need", "Built to scale", "High-level building blocks"]


def test_wf_public_site_landing(browser, app_url):
    requests = []
    with open_app(browser, app_url + "/") as page:
        page.on("request", lambda r: requests.append(r.url))
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_contain_text("Hold, move and govern digital money on your rules")
        texts = ["".join(t.split()) for t in (page.evaluate("() => document.body.innerText"),
                                              control_text(page.evaluate_handle("() => document.body")))]
        order = LANDING_ORDER + ["Teams building on Corvo"] + CASES + ["Made for builders. Ready for auditors."] + \
            BUILDER_CARDS + ["Start in an afternoon. Ship this week.",
                             "Open wallets, set policies and move your first payout today."]
        for sequence in (order, STATS):
            found = []
            for text in texts:
                at = 0
                for s in sequence:
                    at = text.find("".join(s.split()), at) if at >= 0 else at
                found.append(at >= 0)
            assert any(found), sequence
        for case in CASES:
            expect(page.get_by_role("link", name=case)).to_have_count(0)
        cards = page.get_by_role("link", name=re.compile("Treasury with guardrails"))
        expect(cards.first).to_be_attached()
        assert any(urlsplit(c.get_attribute("href") or "").path == "/console/approvals" for c in cards.all())
        hero = page.get_by_role("region", name="Pending transfer preview")
        expect(hero.get_by_role("progressbar", name="Approvals")).to_be_visible()
        expect(hero).to_contain_text("1 of 2 approvals")
        expect(hero).to_contain_text("pending_approval")
        for name, target in (("Get started", "/login"), ("Contact sales", "/contact")):
            assert urlsplit(page.get_by_role("link", name=name).last.get_attribute("href")).path == target
        expect(page.get_by_text("Money moves when the right people agree.")).to_be_visible()
        expect(page.get_by_text("© 2026 Corvo Labs, Inc")).to_be_visible()
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(page.get_by_role("alertdialog")).to_have_count(0)
        advance(page, SETTLE_MS * 2)
        axe(page)
        assert page.context.cookies() == [] or all(c["domain"] in urlsplit(app_url).hostname for c in page.context.cookies())
    assert requests and all(same_origin(u, app_url) for u in requests if not u.startswith("data:")), requests


def test_wf_public_site_menus(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": DESK_W, "height": DESK_H})
        names = ["Products", "Solutions", "Developer", "Resources"]

        def shut(button):
            poll(lambda: advance(page, SETTLE_MS / 20) or button.get_attribute("aria-expanded") == "false", POLL_S,
                 "aria-expanded")

        for name in names:
            button = page.get_by_role("button", name=name)
            click(button)
            expect(button).to_have_attribute("aria-expanded", "true")
            click(button)
            shut(button)
            button.focus()
            page.keyboard.press("Enter")
            expect(button).to_have_attribute("aria-expanded", "true")
            page.keyboard.press("Escape")
            shut(button)
            expect(button).to_be_focused()
            page.keyboard.press(" ")
            expect(button).to_have_attribute("aria-expanded", "true")
            page.mouse.click(2, DESK_H - 2)
            shut(button)
        first, second = page.get_by_role("button", name=names[0]), page.get_by_role("button", name=names[1])
        click(first)
        click(second)
        expect(second).to_have_attribute("aria-expanded", "true")
        shut(first)
        page.keyboard.press("Escape")
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight / 2)")
        box = first.bounding_box()
        assert box is not None and 0 <= box["y"] < DESK_H / 4
        banner = page.get_by_role("banner").first
        filters = style(banner, "backdrop-filter", "-webkit-backdrop-filter")
        around = banner.evaluate("""e => {
          const out = [], read = (n, p) => { const s = getComputedStyle(n, p); out.push(s.backdropFilter, s.webkitBackdropFilter); };
          const walk = n => { read(n, null); read(n, '::before'); read(n, '::after'); [...n.children].forEach(walk); };
          walk(e);
          for (let a = e.parentElement; a; a = a.parentElement) read(a, null);
          return out; }""")
        assert any("blur" in (v or "") for v in [*filters.values(), *around]), filters


def collapsed(locator) -> None:
    advance(locator.page, SETTLE_MS)
    try:
        expect(locator).to_be_hidden(timeout=EXPECT_MS / 5)
    except AssertionError:
        expect(locator).not_to_be_in_viewport()


def test_wf_public_site_pricing(browser, app_url):
    with open_app(browser, app_url + "/pricing") as page:
        expect(page.get_by_role("heading", level=1)).to_have_text("Pricing that grows with you.")
        expect(page.get_by_text("Start free, then pay for the active wallets and transfers you actually use.")).to_be_visible()
        dev = page.get_by_role("region", name="Developer")
        for s in ("For teams getting started.", "Starter", "0 - 999", "Free", "Growth", "1,000 - 4,999", "$249 / month",
                  "Scale", "5,000 - 19,999", "$649 / month"):
            expect(dev).to_contain_text(s)
        assert urlsplit(dev.get_by_role("link", name="Get started").get_attribute("href")).path == "/login"
        ent = page.get_by_role("region", name="Enterprise")
        for s in ("For platforms that need custom controls and global reach.", "Custom rates per transfer or per active wallet",
                  "Uptime commitments and a named support lead", "Webhooks, single sign-on and custom integrations",
                  "Volume pricing on signed transfers"):
            expect(ent).to_contain_text(s)
        for s in ("Trusted by 1,400+ finance teams.", "Every plan includes", "Embedded wallets", "One sign-in for every app",
                  "Audited, compliant infrastructure", "Usage-based billing", "Reports and analytics",
                  "A console you can brand"):
            expect(page.get_by_text(s).first).to_be_attached()
            assert any(c.is_visible() for c in page.get_by_text(s).all()), s
        matrix = page.get_by_role("table", name="Feature comparison matrix")
        for column in ("Developer", "Enterprise"):
            expect(matrix.get_by_role("columnheader", name=column)).to_be_visible()
        for feature in ("Policy engine", "Key quorum approvals"):
            expect(matrix.get_by_role("row", name=re.compile(feature))).to_have_accessible_name(re.compile("Included.*Included"))
        sso = matrix.get_by_role("row", name=re.compile("Single sign-on"))
        expect(sso).to_contain_text("Add-on")
        page.goto(app_url + "/pricing#pricing-questions")
        answers = [re.compile("at least one transfer", re.I), re.compile("executed", re.I), re.compile("next month", re.I)]
        questions = ["What counts as an active wallet?", "Do failed transfers count?", "Can we change plans later?"]
        click(page.get_by_role("button", name=questions[0]))
        advance(page, SETTLE_MS)
        expect(page.get_by_text(answers[0]).first).to_be_visible()
        click(page.get_by_role("button", name=questions[1]))
        advance(page, SETTLE_MS)
        poll(lambda: any(c.is_visible() for c in page.get_by_text(answers[1]).all()), POLL_S, questions[1])
        collapsed(page.get_by_text(answers[0]))
        third = page.get_by_role("button", name=questions[2])
        third.focus()
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        expect(page.get_by_text(answers[2]).first).to_be_visible()
        collapsed(page.get_by_text(answers[1]).first)
        page.keyboard.press(" ")
        collapsed(page.get_by_text(answers[2]).first)
        page.goto(app_url + "/pricing")
        click(page.get_by_role("region", name="Enterprise").get_by_role("link", name="Talk to sales"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/contact")


def test_wf_public_site_not_found(browser, app_url):
    for path in (f"/no-such-page-{tag()}", *PRIVATE_PATHS):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404 and "Page not found" in r.text, path
    for path, phrase in (("/", "Hold, move and govern digital money on your rules"),
                         ("/pricing", "Pricing that grows with you."), ("/contact", "Contact sales"),
                         ("/login", "Sign in to Corvo")):
        html = httpx.get(app_url + path, timeout=HTTP_TIMEOUT).text
        assert html.lstrip().lower().startswith("<!doctype html")
        flat = " ".join(re.sub(r"<[^>]+>", " ", html).split())
        assert phrase in flat, path
        for ref in re.findall(r"""(?:href|src|action)\s*=\s*["']([^"']+)["']""", html):
            if re.match(r"(?:[a-z][a-z0-9+.-]*:)?/{2}", ref, re.I):
                assert same_origin(urljoin(app_url + "/", ref), app_url), ref
    target = urlsplit(os.environ["DATABASE_URL"])
    relay = Relay(target.hostname, target.port or 5432)
    try:
        with app_copy(via_relay(os.environ["DATABASE_URL"], relay.port)) as copy:
            wait_health(copy, lambda r: r.status_code == 503, "503 while the database is down")
            relay.set(True)
            wait_health(copy, lambda r: r.status_code == 200, "recovery after the database returned")
            home = httpx.get(copy.base + "/", timeout=HTTP_TIMEOUT)
            assert home.status_code == 200, copy.tail()
            assert "Hold, move and govern digital money on your rules" in " ".join(
                re.sub(r"<[^>]+>", " ", home.text).split())
            assert httpx.get(copy.base + f"/missing-{tag()}", timeout=HTTP_TIMEOUT).status_code == 404
    finally:
        relay.stop()
    with open_app(browser, f"{app_url}/missing-{tag()}") as page:
        expect(page.get_by_role("heading", name="Page not found")).to_be_visible()
        click(page.get_by_role("link", name="Back to home"))
        page.wait_for_url(lambda u: urlsplit(u).path == "/")


def contact_body(email, **over):
    body = {"full_name": CONTACT_NAME, "work_email": email, "company": CONTACT_COMPANY, "monthly_volume": "Under $1M",
            "message": CONTACT_MESSAGE}
    body.update(over)
    return body


def test_wf_contact_accessibility_api(app_url):
    _, email = person("visitor")
    r = post_json(app_url, "/api/v1/contact", contact_body(email, full_name=f"  {CONTACT_NAME}  ",
                                                           message=CONTACT_MESSAGE + "\r\n" + CONTACT_MESSAGE))
    data = ok(r, 201)
    assert data["id"].startswith("con_") and STAMP.match(data["created_at"])
    row = db().rows(f"SELECT full_name, message, monthly_volume FROM contact_requests WHERE id = {lit(data['id'])}")[0]
    assert row == {"full_name": CONTACT_NAME, "message": CONTACT_MESSAGE + "\n" + CONTACT_MESSAGE,
                   "monthly_volume": "Under $1M"}
    cases = [
        (dict(message="short", full_name="A"), "full_name"),
        (dict(monthly_volume="$5", company="C"), "company"),
        (dict(message="tiny", monthly_volume="Lots"), "monthly_volume"),
        (dict(message="x" * (CONTACT_MESSAGE_MIN - 1)), "message"),
        (dict(full_name="A" * (CONTACT_NAME_MAX + 1)), "full_name"),
        (dict(company="C" * (CONTACT_COMPANY_MAX + 1)), "company"),
        (dict(company="Bell\x07 Co"), "company"),
        (dict(work_email="not-an-email"), "work_email"),
    ]
    for over, field in cases:
        _, e = person("visitor")
        body = dict(reversed(list(contact_body(e, **over).items())))
        field_err(post_json(app_url, "/api/v1/contact", body), "VALIDATION_ERROR", field)
        assert count("contact_requests", f"work_email = {lit(e)}") == 0
    for domain in ("gmail.com", "yahoo.com", "outlook.com", "hotmail.com"):
        free = person("visitor")[1].split("@")[0] + "@" + domain
        e = field_err(post_json(app_url, "/api/v1/contact", contact_body(free)), "VALIDATION_ERROR", "work_email")
        assert e["message"] == "Use your work email"
    _, e = person("visitor")
    ok(post_json(app_url, "/api/v1/contact", contact_body(e, full_name="A" * CONTACT_NAME_MAX,
                                                           company="C" * CONTACT_COMPANY_MAX)), 201)


ON_FOCUS = ("e => { const a = document.activeElement; return a === e || "
            "(a !== document.body && a.contains(e) && a.innerText.trim() === e.innerText.trim()); }")


def let_focus_land(locator) -> None:
    end = time.monotonic() + POLL_S
    while time.monotonic() < end and not (locator.count() and locator.first.evaluate(ON_FOCUS)):
        advance(locator.page, SETTLE_MS / 20)


def test_wf_contact_accessibility_form(browser, app_url):
    _, email = person("visitor")
    free = email.split("@")[0] + "@gmail.com"
    with open_app(browser, app_url + "/contact") as page:
        expect(page.get_by_role("heading", name="Contact sales")).to_be_visible()
        name = page.get_by_role("textbox", name="Full name")
        work = page.get_by_role("textbox", name="Work email")
        company = page.get_by_role("textbox", name="Company")
        fill(name, CONTACT_NAME)
        fill(work, free)
        select(page.get_by_role("combobox", name="Monthly volume"), "Under $1M")
        fill(page.get_by_role("textbox", name="How can we help?"), CONTACT_MESSAGE)
        click(page.get_by_role("button", name="Send message"))
        let_focus_land(work)
        expect(work).to_be_focused()
        for field in (work, company):
            assert field.evaluate("e => e.getAttribute('aria-invalid') === 'true' || !e.validity.valid"), field
        expect(work).to_have_accessible_description(re.compile("Use your work email"))
        expect(company).to_have_accessible_description(re.compile(re.escape("Enter your company name (2 to 120 characters)")))
        expect(name).to_have_value(CONTACT_NAME)
        expect(work).to_have_value(free)
        axe(page)
        assert count("contact_requests", f"work_email = {lit(free)}") == 0
        fill(work, email)
        fill(company, CONTACT_COMPANY)
        click(page.get_by_role("button", name="Send message"))
        thanks = page.get_by_text("Thanks. Our team will reply within one business day.")
        let_focus_land(thanks)
        assert thanks.evaluate(ON_FOCUS)
        expect(page.get_by_role("button", name="Send message")).to_have_count(0)
    assert count("contact_requests", f"work_email = {lit(email)}") == 1


def test_wf_deployment_storage_seed_state(app_url):
    owner, acme = login(app_url, OWNER), login(app_url, ACME_OWNER)
    orgs = {r["id"]: r for r in db().rows("SELECT id, name, app_id FROM organizations WHERE id IN ('org_northwind','org_acme')")}
    assert orgs["org_northwind"]["name"] == "Northwind Treasury" and orgs["org_northwind"]["app_id"] == NW_APP
    assert orgs["org_acme"]["name"] == "Acme Payroll" and orgs["org_acme"]["app_id"] == ACME_APP
    members = {m["id"]: m for m in ok(owner.get("/members"))["members"] + ok(acme.get("/members"))["members"]}
    for mid, name, email, role, _ in SEED_MEMBERS:
        assert (members[mid]["name"], members[mid]["email"], members[mid]["role"]) == (name, email, role)
    agg = [a for a in ok(owner.get("/aggregations"))["aggregations"] if a["id"] == "agg_daily_outflow"][0]
    assert (agg["name"], agg["metric"], agg["window_seconds"], agg["asset"], agg["group_by"]) == (
        "Daily outflow", "sum_amount", DAY_S, "usdc", "wallet")
    q = [x for x in ok(owner.get("/quorums"))["quorums"] if x["id"] == "kq_finance"][0]
    assert q["name"] == "Finance quorum" and q["authorization_threshold"] == 2 and q["expiry_seconds"] == SEED_EXPIRY
    assert sorted(q["member_ids"]) == sorted(["mem_nw_approver1", "mem_nw_approver2", "mem_nw_owner"])
    p = ok(owner.get(f"/policies/{POL_OPERATING}"))
    assert (p["name"], p["version"], p["chain_type"], p["revision"]) == ("Operating limits", "1.0", "ethereum", 1)
    assert [(r["name"], r["method"], r["action"]) for r in p["rules"]] == [
        ("Block burn address", "transfer", "DENY"), ("Vendors under daily cap", "transfer", "ALLOW"),
        ("Sweep to payroll", "transfer", "ALLOW"), ("Payroll lines under 5000", "batch_payout", "ALLOW")]
    assert p["rules"][0]["conditions"][0]["value"] == [BURN]
    assert p["rules"][1]["conditions"][0]["value"] == [VENDOR1, VENDOR2, VENDOR3]
    assert str(p["rules"][1]["conditions"][1]["value"]) == "50000000000"
    assert p["rules"][2]["conditions"][0]["value"] == address_of("wal_payroll")
    assert str(p["rules"][3]["conditions"][0]["value"]) == "5000000000"
    expect_wallets = {
        "wal_operating": ("Operating USDC", "base", "usdc", "250000", "12000", "238000", "pol_operating", "kq_finance", "10000"),
        "wal_payroll": ("Payroll USDC", "base", "usdc", "40000", "0", "40000", None, "kq_finance", "25000"),
        "wal_gas": ("Gas reserve", "ethereum", "eth", "12.5", "0", "12.5", None, None, "0"),
    }
    for wid, facts in expect_wallets.items():
        w = wallet(owner, wid)
        assert (w["name"], w["chain"], w["asset"], w["balance"], w["reserved"], w["available"], w["policy_id"],
                w["quorum_id"], w["approval_floor"]) == facts
        assert w["address"] == address_of(wid)
    assert wallet(owner, "wal_gas")["balance_raw"] == str(raw("12.5", "eth"))
    a = wallet(acme, "wal_acme_ops")
    assert (a["name"], a["chain"], a["asset"], a["balance"], a["policy_id"], a["quorum_id"]) == (
        "Acme Operating", "base", "usdc", "9000", None, None)
    paid = ok(owner.get(f"/intents/{SEED_PAID}"))
    assert (paid["status"], paid["amount"], paid["memo"], paid["created_by"], paid["destination_address"]) == (
        "executed", "3500", "September tooling", "mem_nw_operator", VENDOR1)
    assert paid["created_at"] == paid["executed_at"] == "2026-09-15T10:00:00Z"
    decision = {"action": "ALLOW", "rule": "Vendors under daily cap", "reason": "matched_rule",
                "policy_id": "pol_operating", "policy_revision": 1}
    assert paid["policy_decision"] == decision
    pend = ok(owner.get(f"/intents/{SEED_PENDING}"))
    assert (pend["status"], pend["amount"], pend["memo"], pend["required_approvals"]) == (
        "pending_approval", "12000", "Q4 logistics invoice", 2)
    assert sorted(pend["quorum_member_ids"]) == sorted(q["member_ids"]) and pend["policy_decision"] == decision
    assert ts(pend["expires_at"]) - ts(pend["created_at"]) == SEED_EXPIRY
    assert [x["member_id"] for x in pend["approvals"]] == ["mem_nw_approver1"]
    nw_events = ok(owner.get("/audit", params={"after_seq": 0, "limit": 15}))["events"]
    assert [e["type"] for e in nw_events] == ["member.added"] * 5 + [
        "aggregation.created", "quorum.created", "policy.created", "wallet.created", "wallet.created", "wallet.created",
        "intent.created", "intent.executed", "intent.created", "intent.approved"]
    assert all(e["actor"] == "system" and e["at"] == pend["created_at"] for e in nw_events)
    assert [e["subject_id"] for e in nw_events[8:11]] == ["wal_operating", "wal_payroll", "wal_gas"]
    acme_events = ok(acme.get("/audit", params={"after_seq": 0, "limit": 2}))["events"]
    assert [e["type"] for e in acme_events] == ["member.added", "wallet.created"]
    signed = ok(owner.get("/webhooks/events", params={"after_seq": 0, "limit": 4}))["events"]
    assert [e["type"] for e in signed] == ["intent.created", "intent.executed", "intent.created", "intent.approved"]
    for wid, opening in (("wal_operating", "253500"), ("wal_payroll", "40000"), ("wal_acme_ops", "9000")):
        rows = db().rows("SELECT movement_id, account, raw_amount::text AS amount FROM ledger_entries "
                         f"WHERE kind = 'opening' AND movement_id IN (SELECT movement_id FROM ledger_entries WHERE account = {lit(wid)} AND kind = 'opening')")
        assert len(assert_pairs(rows)) == 1
        assert {r["account"]: int(r["amount"]) for r in rows} == {wid: raw(opening), "external": -raw(opening)}
    assert {r["account"]: int(r["amount"]) for r in ledger(SEED_PAID)} == {"wal_operating": -raw("3500"),
                                                                                 "external": raw("3500")}
    assert_balanced("wal_operating", "wal_payroll", "wal_gas", "wal_acme_ops")


def seed_snapshot() -> dict:
    return {
        "audit": db().rows("SELECT organization_id, max(seq) AS s FROM audit_events GROUP BY 1 ORDER BY 1"),
        "signed": db().rows("SELECT organization_id, max(seq) AS s FROM webhook_events GROUP BY 1 ORDER BY 1"),
        "wallets": db().rows("SELECT id, name, balance_raw::text AS b FROM wallets WHERE id IN "
                             "('wal_operating','wal_payroll','wal_gas','wal_acme_ops') ORDER BY id"),
        "pending": db().rows("SELECT created_at::text AS c FROM intents WHERE id = 'int_seed_pending'"),
        "members": db().rows("SELECT count(*)::int AS n FROM members"),
        "secrets": db().rows("SELECT id, webhook_secret FROM organizations ORDER BY id"),
    }


def test_wf_deployment_storage_later_boot(app_url):
    before = seed_snapshot()
    with app_copy(os.environ["DATABASE_URL"]) as copy:
        r = wait_health(copy, lambda r: r.status_code == 200, "copy healthy")
        assert r.json() == {"status": "ok"}
        ok(login(copy.base, OWNER).get("/me"))
    after = seed_snapshot()
    assert after == before


def test_wf_deployment_storage_boot_recovery(app_url):
    target = urlsplit(os.environ["DATABASE_URL"])
    relay = Relay(target.hostname, target.port or 5432)
    try:
        with app_copy(via_relay(os.environ["DATABASE_URL"], relay.port)) as copy:
            starting = wait_health(copy, lambda r: r.status_code == 503, "503 while the database is down")
            assert starting.json() == {"status": "starting"}
            relay.set(True)
            up = wait_health(copy, lambda r: r.status_code == 200, "recovery after the database returned")
            assert up.json() == {"status": "ok"}
            token = login(copy.base, OWNER)
            ok(token.get("/me"))
            relay.set(False)
            down = wait_health(copy, lambda r: r.status_code == 503, "503 after the database went away")
            assert down.json() == {"status": "unavailable"}
            err(token.get("/wallets"), 503, "DATABASE_UNAVAILABLE")
            assert copy.proc.poll() is None, copy.tail()
            relay.set(True)
            wait_health(copy, lambda r: r.status_code == 200, "second recovery")
            ok(login(copy.base, OWNER).get("/wallets"))
    finally:
        relay.stop()


def test_wf_deployment_storage_tables(app_url):
    tables = {name.split(".", 1)[-1] for name in db().tables()}
    assert set(TABLES) <= tables, set(TABLES) - tables
    owner = login(app_url, OWNER)
    key = ok(owner.post("/api-keys", {"name": f"Key {tag()}", "role": "auditor"}), 201)
    hashes = db().rows("SELECT password_hash FROM members WHERE id = 'mem_nw_owner'")[0]["password_hash"]
    assert PASSWORD not in hashes
    sessions = json.dumps(db().rows("SELECT * FROM sessions WHERE member_id = 'mem_nw_owner'"))
    assert owner.token not in sessions
    row = json.dumps(db().rows(f"SELECT * FROM api_keys WHERE id = {lit(key['id'])}"))
    assert key["secret"] not in row and key["prefix"] in row
    for org in db().rows("SELECT app_id, webhook_secret FROM organizations"):
        assert re.fullmatch(r"app_[a-z0-9]{12}", org["app_id"]) and re.fullmatch(r"whsec_[0-9a-f]{32}", org["webhook_secret"])
    types = {(r["table_name"], r["column_name"]): r["udt_name"] for r in db().rows(
        "SELECT table_name, column_name, udt_name FROM information_schema.columns")}
    for col in (("wallets", "balance_raw"), ("intents", "raw_amount"), ("ledger_entries", "raw_amount"),
                ("deposits", "raw_amount"), ("wallets", "approval_floor_raw")):
        assert types[col] == "numeric", col
    for col in (("intents", "created_at"), ("audit_events", "at"), ("wallets", "created_at")):
        assert types[col] == "timestamptz", col


def test_wf_cross_cutting_envelope(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    owner = login(app_url, OWNER)
    assert ok(Api(app_url).get("/health")) == {"status": "ok"}
    a, b = owner.get("/wallets"), owner.get("/wallets")
    assert envelope(a)["meta"]["request_id"] != envelope(b)["meta"]["request_id"]
    assert err(Api(app_url, None, NW_APP).get("/wallets"), 401, "UNAUTHENTICATED")["details"] == {}
    assert err(owner.get("/wallets/wal_" + "0" * 20), 404, "WALLET_NOT_FOUND")["details"] == {}
    w = new_wallet(owner, funds="10")
    i = ok(transfer(owner, w["id"], VENDOR1, "1"), 201)
    m = ok(owner.get("/members"))["members"][0]
    for stamp in (w["created_at"], i["created_at"], i["executed_at"], i["decided_at"], m["created_at"],
                  ok(owner.get("/audit", params={"limit": 1}))["events"][0]["at"]):
        assert STAMP.match(stamp), stamp


def too_large(send) -> None:
    try:
        r = send()
    except httpx.TransportError:
        return
    err(r, 413, "PAYLOAD_TOO_LARGE")


def test_wf_cross_cutting_request_limits(app_url):
    _, email = person("visitor")
    body = json.dumps(contact_body(email)).encode()
    exact = body[:-1] + b" " * (MAX_BODY - len(body)) + b"}"
    assert len(exact) == MAX_BODY
    r = httpx.post(app_url + API + "/contact", content=exact, headers={"Content-Type": "application/json"},
                   timeout=HTTP_TIMEOUT)
    ok(r, 201)
    _, other = person("visitor")
    body = json.dumps(contact_body(other)).encode()
    over = body[:-1] + b" " * (MAX_BODY + 1 - len(body)) + b"}"
    too_large(lambda: httpx.post(app_url + API + "/contact", content=over, headers={"Content-Type": "application/json"},
                                 timeout=HTTP_TIMEOUT))
    assert count("contact_requests", f"work_email = {lit(other)}") == 0
    owner = login(app_url, OWNER)
    w = new_wallet(owner, funds="10")
    path = f"/wallets/{w['id']}/transfers"
    too_large(lambda: owner.call("POST", path, raw_body=b"{" + b" " * MAX_BODY))
    err(owner.call("POST", path, raw_body=b'{"amount": '), 400, "MALFORMED_JSON")
    field_err(owner.call("POST", path, raw_body=b"[1, 2]"), "VALIDATION_ERROR", "body")
    err(owner.call("POST", path, raw_body=b"amount=1", headers={"Content-Type": "text/plain"}), 415,
        "UNSUPPORTED_MEDIA_TYPE")
    assert count("intents", f"wallet_id = {lit(w['id'])}") == 0
    ok(owner.post(f"/wallets/{w['id']}/freeze", {}))


def test_wf_cross_cutting_accessibility(browser, app_url):
    for path in ("/", "/pricing", "/contact", "/login", f"/missing-{tag()}"):
        with open_app(browser, app_url + path) as page:
            axe(page)
            assert tab_order(page, 1) == ["Skip to main content"]
    with open_app(browser, app_url + "/") as page:
        link = page.get_by_role("link", name="Get started").first
        ring = ("e => [e, e.parentElement].flatMap(n => [null, '::before', '::after'].map(p => { const s = getComputedStyle(n, p); "
                "return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor].join(); }))")
        around = link.evaluate(ring)
        rest, focused = state_styles(link, "outline-style",
                                     "outline-width", "outline-color", "box-shadow", "border-top-color",
                                     state="focus")
        assert rest != focused or around != link.evaluate(ring)
    owner = login(app_url, OWNER)
    m, _ = add_member(owner, "auditor")
    w = new_wallet(owner, funds="10")
    with console(browser, app_url, OWNER, "/console") as page:
        for path in ("/console", f"/console/wallets/{w['id']}", "/console/approvals", "/console/intents",
                     "/console/policies", "/console/quorums", "/console/audit", "/console/settings"):
            page.goto(app_url + path)
            axe(page)
        remove = page.get_by_role("button", name=f"Remove {m['name']}")
        click(remove)
        dialog = page.get_by_role("dialog", name="Remove member")
        expect(dialog.get_by_role("button", name="Keep member")).to_be_focused()
        for keys in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            page.keyboard.press(keys)
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(remove).to_be_focused()
        assert any(x["id"] == m["id"] for x in ok(owner.get("/members"))["members"])
        click(remove)
        click(dialog.get_by_role("button", name="Remove"))
        expect(notifications(page)).to_contain_text("Member removed")
    assert all(x["id"] != m["id"] for x in ok(owner.get("/members"))["members"])


def test_wf_cross_cutting_phone_layouts(browser, app_url):
    for path in ("/", "/pricing", "/contact"):
        with open_app(browser, app_url + path) as page:
            for w_, h_ in ((PHONE_W, PHONE_H), (TABLET_W, TABLET_H), (DESK_W, DESK_H)):
                page.set_viewport_size({"width": w_, "height": h_})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
        click(page.get_by_role("button", name="Menu"))
        expect(page.get_by_role("link", name="Pricing").first).to_be_visible()
    t = team(app_url, approvers=1, threshold=1)
    w = new_wallet(t.owner, funds="10", quorum_id=t.quorum["id"], floor="0")
    i = ok(transfer(t.op, w["id"], VENDOR1, "1"), 201)["id"]
    with console(browser, app_url, t.apprs[0][0]["email"], "/console/approvals") as page:
        page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        button = page.get_by_role("group", name=f"Intent {i}", exact=True).get_by_role("button", name="Approve")
        button.scroll_into_view_if_needed()
        box = button.bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= PHONE_W
        click(page.get_by_role("button", name="Menu"))
        expect(page.get_by_role("navigation", name="Console").get_by_role("link", name="Overview")).to_be_visible()


CARD_NODES = """e => { document.getAnimations().forEach(a => { if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
  const out = [], read = n => { const s = getComputedStyle(n); out.push([s.transform, s.translate, s.top, s.borderTopColor]); };
  const walk = n => { read(n); [...n.children].forEach(walk); };
  walk(e);
  for (let a = e.parentElement; a; a = a.parentElement) read(a);
  return out; }"""


def card_states(card) -> tuple[list, list]:
    card.scroll_into_view_if_needed()
    advance(card.page, SETTLE_MS)
    card.page.mouse.move(0, 0)
    rest = card.evaluate(CARD_NODES)
    card.hover()
    return rest, card.evaluate(CARD_NODES)


def test_motion(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": DESK_W, "height": DESK_H})
        hero = page.get_by_role("region", name="Pending transfer preview")
        for y, text, badge in ((0, "1 of 2 approvals", "pending_approval"), (HERO_END_PX, "2 of 2 approvals", "executed"),
                               (HERO_STEP_PX - 50, "1 of 2 approvals", "pending_approval")):
            page.evaluate("y => window.scrollTo(0, y)", y)
            until(page, "t => document.body.innerText.includes(t)", text)
            expect(hero).to_contain_text(text)
            expect(hero).to_contain_text(badge)
        card = page.get_by_role("link", name=re.compile("Treasury with guardrails"))
        rest, hover = card_states(card)
        assert any(a[:3] != b[:3] for a, b in zip(rest, hover))
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": DESK_W, "height": DESK_H})
        page.evaluate("y => window.scrollTo(0, y)", HERO_END_PX)
        advance(page, SETTLE_MS)
        hero = page.get_by_role("region", name="Pending transfer preview")
        expect(hero).to_contain_text("1 of 2 approvals")
        expect(hero).not_to_contain_text("2 of 2 approvals", use_inner_text=True)
        card = page.get_by_role("link", name=re.compile("Treasury with guardrails"))
        rest, hover = card_states(card)
        assert rest[0][0] == hover[0][0] and any(a[3] != b[3] for a, b in zip(rest, hover))
    for mode in ("no-preference", "reduce"):
        _, email = person("visitor")
        with open_app(browser, app_url + "/contact", reduced_motion=mode) as page:
            fill(page.get_by_role("textbox", name="Full name"), "Ada Visitor")
            fill(page.get_by_role("textbox", name="Work email"), email)
            fill(page.get_by_role("textbox", name="Company"), "Visitor Co")
            select(page.get_by_role("combobox", name="Monthly volume"), "Under $1M")
            fill(page.get_by_role("textbox", name="How can we help?"), "We want to route payroll through Corvo.")
            with held(page, "**/contact") as hold:
                button = page.get_by_role("button", name=re.compile("Send message|Working"))
                click(button)
                expect(page.get_by_role("button", disabled=True)).not_to_have_count(0)
                if mode == "reduce":
                    expect(button).to_contain_text("Working")
                hold.release()
            let_focus_land(page.get_by_text("Thanks. Our team will reply within one business day."))
            expect(page.get_by_text("Thanks. Our team will reply within one business day.")).to_be_visible()
    with console(browser, app_url, OWNER, "/console") as page:
        before = [a["name"] for a in animations(page.get_by_role("main"))]
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        advance(page, SETTLE_MS)
        assert all(a["name"] in before for a in animations(page.get_by_role("main")))


def test_performance(app_url):
    t = team(app_url, approvers=1, threshold=1)
    w = new_wallet(t.owner, funds="100", quorum_id=t.quorum["id"], floor="0")

    def timed(fn):
        start = time.perf_counter()
        r = fn()
        return (time.perf_counter() - start) * 1000, r

    samples = {"transfer": [], "approve": [], "evaluate": []}
    for _ in range(3):
        ms, r = timed(lambda: transfer(t.op, w["id"], VENDOR1, "1"))
        samples["transfer"].append(ms)
        iid = ok(r, 201)["id"]
        ms, r = timed(lambda: approve(t.apprs[0][1], iid))
        samples["approve"].append(ms)
        ok(r)
        ms, r = timed(lambda: t.owner.post(evaluate_path(POL_OPERATING), {
            "method": "transfer", "wallet_id": "wal_operating", "destination_address": VENDOR2, "amount": "60000"}))
        samples["evaluate"].append(ms)
        ok(r)
    for action, values in samples.items():
        assert sorted(values)[1] <= PERF_MS, (action, values)


def test_if_run_manifest():
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(manifest[k], str) and manifest[k].strip()
        assert not re.search(r"(^|\s)/(?!dev/null)", manifest[k]), manifest[k]


def test_if_user_readme():
    text = (APP_ROOT / "USER_README.md").read_text()
    assert PASSWORD in text
    for _, _, email, role, _ in SEED_MEMBERS:
        assert email in text and role in text


def test_if_reserved_folders():
    for name in (".browser_screenshots", ".downloads"):
        folder = APP_ROOT / name
        assert folder.is_dir() and list(folder.iterdir()) == []


def shipped_packages() -> list[tuple[str, str, str, str]]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"],
                         cwd=getattr(conftest, "DEPLOYED_APP", APP_ROOT), capture_output=True,
                         text=True, timeout=HTTP_TIMEOUT * 4)
    tree = json.loads(out.stdout)
    found: dict = {}

    def walk(deps):
        for name, info in (deps or {}).items():
            licence = info.get("license") or info.get("licenses")
            if not licence and info.get("path"):
                pkg = Path(info["path"], "package.json")
                if pkg.exists():
                    meta = json.loads(pkg.read_text())
                    licence = meta.get("license") or meta.get("licenses")
            if isinstance(licence, dict):
                licence = licence.get("type")
            if isinstance(licence, list):
                licence = " OR ".join(x.get("type", "") if isinstance(x, dict) else str(x) for x in licence)
            found[(name, info.get("version", ""))] = (name, info.get("version", ""), licence or "", info.get("path", ""))
            walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return list(found.values())


def test_if_third_party_notices():
    text = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{n}@{v}" for n, v, _, _ in shipped_packages() if n not in text]
    assert not missing, missing


def test_if_licences():
    bad = [(n, v, lic) for n, v, lic, _ in shipped_packages()
           if not lic or not (set(ids := re.findall(r"[A-Za-z0-9.\-]+", lic)) - {"OR", "AND"} <= LICENCES
                              or ("AND" not in ids and LICENCES & set(ids)))]
    assert not bad, bad


def test_if_no_other_datastore():
    pkg = json.loads((APP_ROOT / "package.json").read_text())
    deps = set(pkg.get("dependencies", {}))
    banned = [d for d in deps if any(s.lower() in d.lower() for s in OTHER_STORES)]
    assert not banned, banned
    stray = [p for p in APP_ROOT.rglob("*") if "node_modules" not in p.parts and p.is_file()
             and any(s.lower() in p.suffix.lower() for s in OTHER_STORES)]
    assert not stray, stray
    for proc in Path("/proc").iterdir():
        if proc.name.isdigit():
            try:
                cmd = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
            except OSError:
                continue
            if proc.name != str(os.getpid()):
                assert not any(s.lower() in cmd.lower() for s in OTHER_STORES), cmd


def test_if_seed_unchanged():
    orgs = {r["id"]: r["app_id"] for r in db().rows("SELECT id, app_id FROM organizations")}
    assert orgs.get("org_northwind") == NW_APP and orgs.get("org_acme") == ACME_APP
    members = {r["id"]: (r["email"], r["organization_id"]) for r in db().rows("SELECT id, email, organization_id FROM members")}
    for mid, _, email, _, org in SEED_MEMBERS:
        assert members[mid] == (email, org)


def test_if_production_build():
    serve = json.loads((APP_ROOT / "run.json").read_text())["serve"]
    assert not re.search(r"(?<![=/])(?<!no-)\b(dev|watch|nodemon|vite(?! preview)|hot)\b(?!/)", serve), serve
    for proc in Path("/proc").iterdir():
        if proc.name.isdigit():
            try:
                cmd = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
            except OSError:
                continue
            if "node" in cmd:
                assert not re.search(r"--watch|nodemon|webpack-dev-server|vite\s*$|next dev", cmd), cmd
