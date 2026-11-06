from __future__ import annotations

import base64
import concurrent.futures
import functools
import json
import math
import os
import random
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import zlib
from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from datetime import time as clock
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from conftest import (
    S3,
    KillBill,
    Postgres,
    addresses,
    advance,
    capture,
    center,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    select,
    session,
    settle,
    text,
    unique,
)

TZ = ZoneInfo("America/New_York")
PASSCODE = "weave-demo-2026"
SENDER = "dispatch@fernhollow.test"
LABELS = ["Credential", "Valid on date", "Schedule", "Consumer"]
GATES = ["credential", "validity", "schedule", "consumer"]
TRAVEL_BUFFER_MIN = 30
SHORT_WINDOW_H = 48
LONG_WINDOW_H = 72
OFFER_TTL_H = 12
OFFER_LEAD_H = 2
TOKEN_MIN = 32
JSON_LIMIT = 64 * 1024
UPLOAD_LIMIT = 10 * 1024 * 1024
WARN_DAYS = 30
KB_FAIL_S = 5
MAIL_DELIVERY_S = 10
SWEEP_S = 60
LOGGED_AFTER_DAYS = 14
RECOIL_MAX_MS = 500
PIN_MAX_MS = 250
PIP_SETTLE_MS = 500
FRAME_MS = 25
FILM_MS = 3000
STOP_FRAMES = 6
DIFF_MIN = 60
MIN_PIXELS = 4
EDGE = 3
MARGIN = 20
FRAME_PAD = 160
DRAG_DY = (90, 150)
DRAG_FX = (0.6, 0.4)
JUMP_PX = 6
STRAIGHT_TOL = 2
MATCH = 0.7
MATCH_GAIN = 0.2
SHIFT_MIN = 2
SHOWN_MIN = 0.25
KB_PAGE = 10000
BIG_NAME = "big-prep.pdf"

WINDOW_LO_H = 1.5
WINDOW_HI_H = 1.75
REFUSAL = "Refused by the verifier"
PATH_TOL = 8
COVER = 0.5
DRY_RUN_TIMEOUT_MS = 5000
CLOSED_HOST, CLOSED_PORT = "127.0.0.1", "9"
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
NARROW_PX = 900
HTTP_TIMEOUT = 30
POLL_S = 120
UI_WAIT_S = 30
STEP_MS = 100
TAB_LIMIT = 80
HOURS_TOL = Decimal("0.05")
FAR_LO_H = 24 * 40
FAR_HI_H = 24 * 250
NEAR_LO_H = 4
NEAR_HI_H = 46
FOREIGN = "http://elsewhere.invalid"
REASON = "Plans changed"
PROBE_RATE = "91.37"
LATER_RATE = "99.99"
NO_SUCH = "no-such-id"
PREP_NAME = "prep-notes.pdf"
SEAT_PREP_NAME = "seat-prep.pdf"
HALL = "Hall"
EXE_NAME = "tool.exe"
EXE = b"MZ\x90\x00\x03binary"
EXPIRY_MARGIN_MIN = 5
RETRY_S = 30
FIRST_LOAD_MS = 1000
LATENCY_SLACK_S = 1
BOOT_S = 120
PROBE_TIMEOUT_S = 2
POINTER_TOL = 12
CHUNK = 65536
CLOSED = "http://127.0.0.1:9"
KB_API = "/1.0/kb"
CHARGES = b"/charges"
ACCEPTED = {"medical": ["NIC", "CDI"], "legal": ["SC:L"], "education": ["EIPA-4.0", "NIC"], "community": ["NIC", "CDI"]}
PRIVATE_PATHS = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/src/server.ts", "/tsconfig.json"]
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6364f8cf000002060102a0e0e2a50000000049454e44ae426082"
)
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"

EMAIL = {
    "rowan": "rowan@fernhollow.test", "priya": "priya@fernhollow.test", "marguerite": "marguerite@fernhollow.test",
    "joel": "joel@birchmere.test", "anita": "anita@kestrelcourt.test", "tomasz": "tomasz@larchfield.test",
    "bea": "bea@consumers.test", "marcus": "marcus@consumers.test",
    "dana": "dana@interpreters.test", "theo": "theo@interpreters.test", "imani": "imani@interpreters.test",
    "lior": "lior@interpreters.test", "sam": "sam@interpreters.test", "callum": "callum@interpreters.test",
    "noor": "noor@interpreters.test",
}
NAME = {
    "rowan": "Rowan Ilsley", "priya": "Priya Castellanos", "marguerite": "Marguerite Osei", "joel": "Joel Haverty",
    "anita": "Anita Ruiz", "tomasz": "Tomasz Wren", "bea": "Bea Lindqvist", "marcus": "Marcus Tull",
    "dana": "Dana Okafor", "theo": "Theo Marchetti", "imani": "Imani Brooks", "lior": "Lior Feld",
    "sam": "Sam Whitlock", "callum": "Callum Reyes", "noor": "Noor Haddad",
}
ROLE = {"rowan": "coordinator", "priya": "coordinator", "marguerite": "billing", "joel": "requester",
        "anita": "requester", "tomasz": "requester", "bea": "consumer", "marcus": "consumer"}
ORG = {"joel": "birchmere-clinic", "anita": "kestrel-court", "tomasz": "larchfield-schools"}
ORG_NAME = {"birchmere-clinic": "Birchmere Community Clinic", "kestrel-court": "Kestrel County Circuit Court",
            "larchfield-schools": "Larchfield School District"}
KEY = {v: k for k, v in NAME.items()}
MEDICAL_OK = ["Imani Brooks", "Theo Marchetti", "Callum Reyes", "Dana Okafor"]
LEGAL_OK = ["Dana Okafor", "Theo Marchetti"]
CENT = Decimal("0.01")


@contextmanager
def entered(obj):
    if hasattr(obj, "__enter__"):
        with obj as value:
            yield value
    else:
        value = next(obj)
        try:
            yield value
        finally:
            obj.close()


_sessions: dict[tuple[str, str], httpx.Client] = {}


def api(base: str, who: str) -> httpx.Client:
    if (base, who) not in _sessions:
        c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        r = c.post("/api/session", json={"email": EMAIL[who], "passcode": PASSCODE})
        assert r.status_code == 200, r.text
        _sessions[(base, who)] = c
    return _sessions[(base, who)]


def ok(r: httpx.Response, status: int = 200) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url}: {r.status_code} {r.text[:600]}"
    return r.json() if r.content else {}


def fails(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url}: {r.status_code} {r.text[:600]}"
    err = r.json()["error"]
    assert err["code"] == code and isinstance(err["message"], str), err
    return err


def money(x) -> str:
    return str(Decimal(str(x)).quantize(CENT, ROUND_HALF_UP))


def server_now(base: str) -> datetime:
    return parsedate_to_datetime(httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).headers["date"])


def at(base: str, lo_h: float, hi_h: float) -> datetime:
    minutes = random.randint(int(lo_h * 60), int(hi_h * 60))
    return (server_now(base) + timedelta(minutes=minutes)).replace(second=0, microsecond=0)


def parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def agency_date(s: str) -> str:
    return parse(s).astimezone(TZ).strftime("%Y-%m-%d")


@functools.cache
def directory(base: str) -> tuple[dict, dict]:
    board = ok(api(base, "rowan").get("/api/board"))
    consumers = ok(api(base, "rowan").get("/api/consumers"))["consumers"]
    return {i["name"]: i["id"] for i in board["interpreters"]}, {c["name"]: c["id"] for c in consumers}


def iid(base: str, name: str) -> str:
    return directory(base)[0][name]


def cid(base: str, name: str) -> str:
    return directory(base)[1][name]


@functools.cache
def bucket() -> S3:
    return S3()


def make(base: str, *, start: datetime, who: str = "joel", setting: str = "medical", hours: float = 1.0,
         consumer: str = "Bea Lindqvist", submit: bool = True, logged_after: bool = False,
         org: str = "birchmere-clinic", title: str | None = None, location: str = "Room 4") -> dict:
    body = {"title": title or unique("Seatweaver")[0], "setting": setting, "location": location,
            "start": start.isoformat(), "end": (start + timedelta(hours=hours)).isoformat(),
            "consumer_id": cid(base, consumer), "notes": ""}
    if logged_after:
        who, body = "rowan", body | {"org_id": org, "logged_after": True}
    req = ok(api(base, who).post("/api/requests", json=body), 201)["request"]
    if submit and not logged_after:
        req = ok(api(base, who).post(f"/api/requests/{req['id']}/submit", json={}))["request"]
    return req


def seats(req: dict) -> list[dict]:
    return sorted(req["seats"], key=lambda s: s["position"])


def get_req(base: str, rid: str, who: str = "rowan") -> dict:
    return ok(api(base, who).get(f"/api/requests/{rid}"))["request"]


def dry(base: str, seat_id: str, name: str, who: str = "rowan") -> httpx.Response:
    return api(base, who).post(f"/api/seats/{seat_id}/dry-run", json={"interpreter_id": iid(base, name)})


def pin(base: str, seat_id: str, name: str, who: str = "rowan") -> httpx.Response:
    return api(base, who).post(f"/api/seats/{seat_id}/offers", json={"interpreter_id": iid(base, name)})


def ready(base: str, candidates: list[str], n: int = 1, *, lo_h: float, hi_h: float, tries: int = 8, **kw):
    for _ in range(tries):
        req = make(base, start=at(base, lo_h, hi_h), **kw)
        good = [c for c in candidates if ok(dry(base, seats(req)[0]["id"], c))["all_pass"]]
        if len(good) >= n:
            return req, good[:n]
    raise AssertionError(f"no slot where {n} of {candidates} pass every gate")


def mails_now(mail, to: str, subject: str, needle: str | None = None, skip: frozenset = frozenset()) -> dict:
    found = {}
    for m in mail.messages():
        if m.get("ID") in skip:
            continue
        if m.get("Subject") == subject and to in addresses(m.get("To")) and (needle is None or needle in text(m)):
            found[m.get("MessageID") or m.get("ID")] = m
    return found


def mails(mail, to: str, subject: str, expected: int = 1, needle: str | None = None, seconds: float = POLL_S,
          skip: frozenset = frozenset()) -> list:
    deadline = time.monotonic() + seconds
    while True:
        found = mails_now(mail, to, subject, needle, skip)
        if len(found) >= expected or time.monotonic() > deadline:
            return list(found.values())


def quiet(mail, to: str, subject: str, needle: str | None = None, seconds: float = MAIL_DELIVERY_S,
          skip: frozenset = frozenset()) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert not mails_now(mail, to, subject, needle, skip), f"unexpected mail {subject} to {to}"


def offer_subject(req: dict) -> str:
    return f"Offer for {req['ref']} on {agency_date(req['start'])}"


def token_of(m: dict) -> str:
    found = re.findall(r"https?://\S+/offers/([A-Za-z0-9_-]+)", text(m))
    assert len(set(found)) == 1, text(m)
    assert len(found[0]) >= TOKEN_MIN
    return found[0]


def offer_tokens(mail, req: dict, name: str, expected: int = 1) -> list[str]:
    ms = mails(mail, EMAIL[KEY[name]], offer_subject(req), expected)
    assert len(ms) >= expected, f"offer email for {req['ref']} to {name} missing"
    return [token_of(m) for m in ms]


def answer(base: str, token: str, verb: str = "accept") -> httpx.Response:
    return httpx.post(f"{base}/api/offers/{token}/{verb}", json={}, timeout=HTTP_TIMEOUT)


def active_token(base: str, mail, req: dict, name: str) -> str:
    deadline = time.monotonic() + POLL_S
    while True:
        for tok in offer_tokens(mail, req, name):
            if ok(httpx.get(f"{base}/api/offers/{tok}", timeout=HTTP_TIMEOUT))["offer"]["status"] == "active":
                return tok
        assert time.monotonic() < deadline, "no active offer token"


def staff(base: str, mail, req: dict, names: list[str]) -> dict:
    for seat, name in zip(seats(req), names):
        ok(pin(base, seat["id"], name), 201)
        ok(answer(base, active_token(base, mail, req, name)))
    return get_req(base, req["id"])


def quote(base: str, rid: str, who: str = "joel") -> dict:
    return ok(api(base, who).get(f"/api/requests/{rid}/cancellation-quote"))["quote"]


def cancel(base: str, rid: str, fee: str, who: str = "joel", key: str | None = None) -> httpx.Response:
    return api(base, who).post(f"/api/requests/{rid}/cancel", json={"expected_fee": fee, "reason": REASON},
                               headers={"Idempotency-Key": key or idempotency_key()})


def rates(base: str) -> dict:
    return ok(api(base, "marguerite").get("/api/rates"))["rates"]


def ts_body(req: dict, name: str, minutes: int) -> dict:
    start = parse(req["start"])
    return {"actual_start": start.isoformat(), "actual_end": (start + timedelta(minutes=minutes)).isoformat(),
            "signature_name": name}


def submit_ts(base: str, req: dict, name: str, minutes: int = 70, key: str | None = None, seat: int = 0):
    return api(base, KEY[name]).post(f"/api/seats/{seats(req)[seat]['id']}/timesheet", json=ts_body(req, name, minutes),
                                     headers={"Idempotency-Key": key or idempotency_key()})


def worked(base: str, mail, minutes: int = 70) -> tuple[dict, str, dict]:
    req, [name] = ready(base, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-4, logged_after=True)
    req = staff(base, mail, req, [name])
    ts = ok(submit_ts(base, req, name, minutes), 201)["timesheet"]
    return req, name, ts


def approval_route(tid: str) -> str:
    return "/".join(["", "api", "timesheets", tid, "approve"])


def approve(base: str, tid: str, key: str | None = None, body: dict | None = None, keyed: bool = True) -> httpx.Response:
    headers = {"Idempotency-Key": key or idempotency_key()} if keyed else {}
    return api(base, "marguerite").post(approval_route(tid), json=body or {}, headers=headers)


@functools.cache
def billing() -> KillBill:
    return KillBill()


def kb_get(path: str, **params):
    r = httpx.get(os.environ["KILLBILL_URL"].rstrip("/") + KB_API + path, params=params, timeout=HTTP_TIMEOUT,
                  auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
                  headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
                           "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"]})
    assert r.status_code == 200, r.text[:300]
    return r.json()


def kb_invoices(org: str) -> list[dict]:
    acct = billing().account_by_key(f"fernhollow-{org}")
    out = []
    for inv in kb_get(f"/accounts/{acct['accountId']}/invoices", includeInvoiceComponents="true"):
        full = inv if inv.get("items") else kb_get(f"/invoices/{inv['invoiceId']}")
        out.append({"invoice_id": full["invoiceId"], "amount": money(full["amount"]), "balance": money(full["balance"]),
                    "items": [{"description": it.get("description") or "", "amount": money(it["amount"])}
                              for it in full.get("items") or []]})
    return out


def items(base: str, org: str, prefix: str) -> list[dict]:
    return [it for i in kb_invoices(org) for it in i["items"] if it["description"].startswith(prefix)]


def kb_ledger() -> tuple[list, dict]:
    accounts = sorted(a["accountId"] for a in kb_get("/accounts/pagination", offset=0, limit=KB_PAGE))
    invoices = {}
    for aid in accounts:
        for inv in kb_get(f"/accounts/{aid}/invoices", includeInvoiceComponents="true"):
            invoices[inv["invoiceId"]] = (aid, money(inv["amount"]), sorted(
                (it.get("description") or "", money(it["amount"])) for it in inv.get("items") or []))
    return accounts, invoices


def eventually(cond, why: str, seconds: float = POLL_S) -> None:
    deadline = time.monotonic() + seconds
    while not cond():
        assert time.monotonic() < deadline, f"timed out waiting for {why}"


def audit(base: str, rid: str) -> list[dict]:
    return ok(api(base, "rowan").get("/api/audit", params={"request_id": rid}))["entries"]


def put_prefs(base: str, who: str, preferred: list[str], blocked: list[str]) -> httpx.Response:
    return api(base, who).put("/api/consumers/me/preferences",
                              json={"preferred": [iid(base, n) for n in preferred], "blocked": [iid(base, n) for n in blocked]})


def race(calls) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn):
        barrier.wait()
        return fn()

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as ex:
        return [f.result() for f in [ex.submit(run, fn) for fn in calls]]


def protected_values() -> list[str]:
    names = ["DATABASE_URL", "SMTP_HOST", "SMTP_PORT", "MAILPIT_URL", "KILLBILL_URL", "KILLBILL_USERNAME",
             "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET",
             "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]
    min_len = 8
    common = re.compile(r"[A-Za-z]+|[a-z]{2}(?:-[a-z]+)+-\d")
    return [v for v in (os.environ.get(n) for n in names) if v and len(v) >= min_len and not common.fullmatch(v)]


def pdf_text(data: bytes) -> str:
    try:
        import io

        from pypdf import PdfReader
        return "".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
    except ImportError:
        pass
    blobs, out = [data], []
    for raw in re.findall(rb"stream\r?\n(.*?)endstream", data, re.S):
        try:
            blobs.append(zlib.decompressobj().decompress(raw))
        except zlib.error:
            pass
    for blob in blobs:
        out += [s[1:-1].decode("latin-1") for s in re.findall(rb"\((?:\\.|[^\\)])*\)", blob)]
        for h in re.findall(rb"<([0-9A-Fa-f\s]{2,})>", blob):
            try:
                out.append(bytes.fromhex(h.decode()).decode("latin-1"))
            except ValueError:
                pass
    return "".join(out)


def squash(s: str) -> str:
    return re.sub(r"\s+", "", s)


@contextmanager
def spawned(**env: str):
    from conftest import DEPLOYED_APP
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    log = Path(tempfile.mkstemp(suffix=".log")[1])
    with log.open("wb") as out:
        proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, stdout=out, stderr=subprocess.STDOUT,
                                start_new_session=True,
                                env=os.environ | {"APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base} | env)
    tail = lambda: log.read_text(errors="replace")[-3000:]
    try:
        deadline = time.monotonic() + BOOT_S
        while True:
            assert proc.poll() is None, f"copy exited:\n{tail()}"
            try:
                if httpx.get(f"{base}/api/health", timeout=PROBE_TIMEOUT_S).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            assert time.monotonic() < deadline, f"copy never healthy:\n{tail()}"
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)


@contextmanager
def fresh_database():
    admin = os.environ["DATABASE_URL"]
    name = f"sw_fresh_{random.randrange(16 ** 8):08x}"

    def run(sql: str) -> None:
        done = subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
        assert done.returncode == 0, done.stderr[-500:]

    run(f'CREATE DATABASE "{name}"')
    try:
        yield urlsplit(admin)._replace(path=f"/{name}").geturl()
    finally:
        run(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@contextmanager
def fresh_copy(**env: str):
    with fresh_database() as db, spawned(DATABASE_URL=db, **env) as base:
        yield base


def charge_post(chunk: bytes) -> bool:
    return chunk.startswith(b"POST ") and CHARGES in chunk.split(b"\r\n", 1)[0]


class Relay:

    def __init__(self, upstream: tuple[str, int]):
        self.upstream, self.socks = upstream, []
        self.server = socket.socket()
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen()
        self.port = self.server.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.upstream)
            except OSError:
                client.close()
                continue
            self.socks += [client, upstream]
            silenced = threading.Event()
            threading.Thread(target=self._pipe, args=(client, upstream, silenced, True), daemon=True).start()
            threading.Thread(target=self._pipe, args=(upstream, client, silenced, False), daemon=True).start()

    @staticmethod
    def _pipe(src, dst, silenced, outbound: bool) -> None:
        try:
            while chunk := src.recv(CHUNK):
                if outbound and charge_post(chunk):
                    silenced.set()
                if outbound or not silenced.is_set():
                    dst.sendall(chunk)
        except OSError:
            pass

    def close(self) -> None:
        for s in [self.server, *self.socks]:
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            s.close()


def wait_for(page, cond, seconds: float = UI_WAIT_S, why: str = "") -> None:
    deadline = time.monotonic() + seconds
    while not cond():
        assert time.monotonic() < deadline, f"timed out waiting for {why}"
        advance(page, STEP_MS)


def shows(page, loc, needle: str, seconds: float = UI_WAIT_S) -> None:
    wait_for(page, lambda: loc.count() > 0 and needle in loc.first.inner_text(), seconds, needle)


def status(page, name: str):
    return page.get_by_role("status", name=name)


def ui_login(page, base: str, who: str) -> None:
    page.goto(f"{base}/signin")
    fill(page.get_by_role("textbox", name="Email"), EMAIL[who])
    fill(page.get_by_role("textbox", name="Passcode"), PASSCODE)
    click(page.get_by_role("button", name="Sign in"))
    wait_for(page, lambda: "/signin" not in page.url, why="landing after sign-in")


def ui_dt(s: str | datetime) -> str:
    dt = parse(s) if isinstance(s, str) else s
    return dt.astimezone(TZ).strftime("%Y-%m-%dT%H:%M")


def card(page, req: dict):
    return page.get_by_role("region", name="Requests, next 72 hours").get_by_role("article", name=f"{req['ref']} {req['title']}")


def chip(page, name: str):
    return page.get_by_role("list", name="Interpreters").get_by_role("button", name=name)


def pip_states(page, req: dict) -> list[str | None]:
    gl = card(page, req).get_by_role("list", name=f"Gates for {req['ref']}")
    out = []
    for label in LABELS:
        out.append(next((st for st in ("pass", "fail", "unchecked")
                         if gl.get_by_role("listitem", name=f"{label}: {st}").count()), None))
    return out


def resolved(page, req: dict) -> int:
    return sum(s in ("pass", "fail") for s in pip_states(page, req))


def open_board(page, base: str, req: dict) -> None:
    ui_login(page, base, "rowan")
    page.goto(f"{base}/board")
    wait_for(page, lambda: card(page, req).count() > 0, why=f"card {req['ref']}")


def grab(page, name: str, target) -> None:
    target.scroll_into_view_if_needed()
    c = chip(page, name)
    c.scroll_into_view_if_needed()
    x, y = center(c)
    page.mouse.move(x, y)
    page.mouse.down()
    tx, ty = center(target)
    page.mouse.move(tx, ty, steps=8)


def focused(loc) -> bool:
    return loc.evaluate("el => el === document.activeElement")


def quiesce(page) -> None:
    advance(page, FIRST_LOAD_MS)
    for loc in (page.get_by_role("region", name="Requests, next 72 hours"), page.get_by_role("list", name="Interpreters"),
                page.get_by_role("region", name="Request detail")):
        if loc.count():
            settle(loc)


def live(loc) -> None:
    assert loc.count() == 1 and loc.get_attribute("aria-live") in (None, "polite", "assertive")


FREEZE_JS = """dt => { const w = window; w.__ft = (w.__ft || 0) + dt; w.__fs = w.__fs || new Map();
  for (const a of document.getAnimations()) {
    if (!w.__fs.has(a)) w.__fs.set(a, w.__ft - dt);
    const t = w.__ft - w.__fs.get(a), end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
    if (Number.isFinite(end) && t >= end) a.finish(); else { a.pause(); a.currentTime = t; } } }"""


def png_rows(data: bytes) -> tuple[int, list[bytes]]:
    pos, idat = 8, bytearray()
    while pos < len(data):
        n = int.from_bytes(data[pos:pos + 4], "big")
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b"IHDR":
            width, height = struct.unpack(">II", body[:8])
            bpp = {2: 3, 6: 4}[body[9]]
        elif kind == b"IDAT":
            idat += body
    raw, stride = zlib.decompress(bytes(idat)), width * bpp
    rows, prev = [], bytearray(stride)
    for j in range(height):
        at_ = j * (stride + 1)
        f, line = raw[at_], bytearray(raw[at_ + 1:at_ + 1 + stride])
        for i in range(stride) if f else ():
            a = line[i - bpp] if i >= bpp else 0
            b, c = prev[i], (prev[i - bpp] if i >= bpp else 0)
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            else:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return bpp, rows


class Film:

    def __init__(self, page):
        self.page, self.cdp = page, session(page)

    def step(self, ms: int = FRAME_MS) -> None:
        advance(self.page, ms)
        self.page.evaluate(FREEZE_JS, ms)

    def shot(self, box: dict):
        x, y = math.floor(box["x"]), math.floor(box["y"])
        w, h = max(1, math.ceil(box["width"])), max(1, math.ceil(box["height"]))
        sx, sy, dpr = self.page.evaluate("[scrollX, scrollY, devicePixelRatio]")
        clip = {"x": x + sx, "y": y + sy, "width": w, "height": h, "scale": 1 / dpr}
        data = self.cdp.send("Page.captureScreenshot", {"format": "png", "clip": clip})["data"]
        bpp, rows = png_rows(base64.b64decode(data))
        return {"x": x, "y": y}, bpp, rows


def changed_set(a, b, inner: dict | None = None) -> set:
    (o, bpp, ra), (_, _, rb) = a, b
    i0, j0 = 0, 0
    i1, j1 = min(len(ra[0]), len(rb[0])) // bpp, min(len(ra), len(rb))
    if inner:
        i0, j0 = max(0, int(inner["x"] - o["x"])), max(0, int(inner["y"] - o["y"]))
        i1 = min(i1, math.ceil(inner["x"] + inner["width"] - o["x"]))
        j1 = min(j1, math.ceil(inner["y"] + inner["height"] - o["y"]))
    out = set()
    for j in range(j0, j1):
        la, lb = ra[j], rb[j]
        if la == lb:
            continue
        for i in range(i0, i1):
            k = i * bpp
            if abs(la[k] - lb[k]) + abs(la[k + 1] - lb[k + 1]) + abs(la[k + 2] - lb[k + 2]) > DIFF_MIN:
                out.add((o["x"] + i, o["y"] + j))
    return out


def differs(a, b, inner: dict | None = None) -> bool:
    return len(changed_set(a, b, inner)) >= MIN_PIXELS


def changes(pre, frames, inner: dict | None = None) -> list[int]:
    out, prev = [], pre
    for t, f in frames:
        if differs(prev, f, inner):
            out.append(t)
        prev = f
    return out


def burst(ts: list[int]) -> tuple[int, int]:
    if not ts:
        return 0, 0
    end, n = ts[0], 1
    for t in ts[1:]:
        if t - end > STOP_FRAMES * FRAME_MS:
            break
        end, n = t, n + 1
    return n, end - ts[0]


def film_until(film: Film, box: dict, done) -> list:
    frames = []
    for k in range(1, FILM_MS // FRAME_MS + 1):
        film.step()
        frames.append((k * FRAME_MS, film.shot(box)))
        if len(frames) > STOP_FRAMES and done() and not changes(frames[-STOP_FRAMES][1], frames[-STOP_FRAMES + 1:]):
            return frames
    raise AssertionError("motion never settled")


def trace(mask: set, start: tuple[float, float]) -> dict:
    cols: dict[int, list[int]] = {}
    for x, y in mask:
        cols.setdefault(x, []).append(y)
    path, prev = {}, start[1]
    for x in sorted((x for x in cols if x <= start[0] + POINTER_TOL), reverse=True):
        ys, runs = sorted(cols[x]), []
        for y in ys:
            if runs and y - runs[-1][-1] <= 1:
                runs[-1].append(y)
            else:
                runs.append([y])
        mid = min((sum(r) / len(r) for r in runs), key=lambda m: abs(m - prev))
        if abs(mid - prev) <= JUMP_PX or not path:
            path[x] = prev = mid
    return path


def deviation(path: dict) -> float:
    xs = sorted(path)
    (x1, y1), (x2, y2) = (xs[0], path[xs[0]]), (xs[-1], path[xs[-1]])
    norm = math.hypot(x2 - x1, y2 - y1) or 1
    return max(abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / norm for x, y in path.items())


def thread_film(page, film: Film, name: str) -> dict:
    c = chip(page, name)
    c.scroll_into_view_if_needed()
    cb, db = c.bounding_box(), page.get_by_role("region", name="Request detail").bounding_box()
    vh = page.viewport_size["height"]
    cy, left = cb["y"] + cb["height"] / 2, cb["x"] + cb["width"] + EDGE
    fit = lambda y: min(max(y, db["y"] + MARGIN), db["y"] + db["height"] - MARGIN, vh - MARGIN)
    dests = [(db["x"] + db["width"] * fx, fit(cy + dy)) for fx, dy in zip(DRAG_FX, DRAG_DY)]
    ys = [cy] + [y for _, y in dests]
    top = max(0, min(ys) - FRAME_PAD)
    box = {"x": left, "y": top, "width": max(x for x, _ in dests) + MARGIN - left,
           "height": min(vh, max(ys) + FRAME_PAD) - top}
    thread = page.get_by_role("img", name="Match thread")
    page.mouse.move(*dests[-1])
    film.step()
    base = film.shot(box)
    page.mouse.move(*center(c))
    page.mouse.down()
    paths = []
    for dx, dy in dests:
        page.mouse.move(dx, dy, steps=8)
        film.step()
        film.step()
        assert thread.count() > 0, "no thread while the chip is held"
        paths.append(trace(changed_set(base, film.shot(box)), (dx, dy)))
    page.mouse.up()
    frames = []
    for k in range(1, FILM_MS // FRAME_MS + 1):
        film.step()
        frames.append((k * FRAME_MS, changed_set(base, film.shot(box)), thread.count() > 0))
        tail = frames[-STOP_FRAMES:]
        if len(frames) > STOP_FRAMES and all(not img and m == frames[-1][1] for _, m, img in tail):
            break
    final, held_path = frames[-1][1], paths[-1]
    gone = next((t for t, _, img in frames if not img), FILM_MS * 2)
    retracting = []
    for t, m, img in frames:
        body = m - final
        if not img or len(body) < MIN_PIXELS:
            continue
        ex = max(x for x, _ in body)
        col = [y for x, y in body if x == ex]
        near = min(held_path, key=lambda x: abs(x - ex))
        retracting.append((t, ex, max(col) - min(col), abs(sum(col) / len(col) - held_path[near]) <= PATH_TOL))
    return {"left": left, "dests": dests, "paths": paths, "gone": gone, "retracting": retracting}


def pip_film(page, film: Film, req: dict, release) -> dict:
    gl = card(page, req).get_by_role("list", name=f"Gates for {req['ref']}")
    box = gl.bounding_box()
    pips = [gl.get_by_role("listitem").nth(i).bounding_box() for i in range(4)]
    film.step()
    film.step()
    pre = film.shot(box)
    release()
    frames = film_until(film, box, lambda: resolved(page, req) == 4)
    first = []
    for p in pips:
        ts = changes(pre, frames, p)
        assert ts, "a pip never changed on screen"
        first.append(ts[0])
    return {"first": first, "settle": burst(changes(pre, frames))[1]}


NUMERAL_JS = """el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const m = /\\d+/.exec(n.data);
    if (m) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const b = r.getBoundingClientRect(); if (b.width && b.height) return {x: b.x, y: b.y, width: b.width, height: b.height}; } }
  return null; }"""


def dist3(a, b) -> int:
    return sum(abs(x - y) for x, y in zip(a, b))


def rgb(frame, x: int, y: int) -> tuple:
    o, bpp, rows = frame
    i, j = x - o["x"], y - o["y"]
    return tuple(rows[j][i * bpp:i * bpp + 3])


def inside(r: dict, x: float, y: float, pad: float = 0) -> bool:
    return r["x"] - pad <= x <= r["x"] + r["width"] + pad and r["y"] - pad <= y <= r["y"] + r["height"] + pad


def span(a: dict, b: dict) -> dict:
    x, y = min(a["x"], b["x"]), min(a["y"], b["y"])
    return {"x": x, "y": y, "width": max(a["x"] + a["width"], b["x"] + b["width"]) - x,
            "height": max(a["y"] + a["height"], b["y"] + b["height"]) - y}


def pixels(frame, rect: dict):
    o, bpp, rows = frame
    i0, j0 = max(0, math.floor(rect["x"] - o["x"])), max(0, math.floor(rect["y"] - o["y"]))
    i1 = min(len(rows[0]) // bpp, math.ceil(rect["x"] + rect["width"] - o["x"]))
    j1 = min(len(rows), math.ceil(rect["y"] + rect["height"] - o["y"]))
    for j in range(j0, j1):
        line = rows[j]
        for i in range(i0, i1):
            yield (o["x"] + i, o["y"] + j), tuple(line[i * bpp:i * bpp + 3])


def paper_of(frame, rect: dict) -> tuple:
    return Counter(c for _, c in pixels(frame, rect)).most_common(1)[0][0]


def ink(frame, rect: dict, paper: tuple) -> set:
    return {p for p, c in pixels(frame, rect) if dist3(c, paper) > DIFF_MIN}


def rolled(glyph: set, seen: set, rect: dict) -> bool:
    top, bottom = rect["y"], rect["y"] + rect["height"]

    def score(k: int):
        shown = [(x, y + k) for x, y in glyph if top <= y + k < bottom]
        return sum(p in seen for p in shown) / len(shown) if shown and len(shown) >= SHOWN_MIN * len(glyph) else None

    base = score(0) or 0
    h = math.ceil(rect["height"])
    for k in range(-h, h + 1):
        s = score(k) if abs(k) >= SHIFT_MIN else None
        if s is not None and s >= MATCH and s >= base + MATCH_GAIN:
            return True
    return False


def numeral(target, claimed: int, total: int):
    loc = target.get_by_text(re.compile(rf"{claimed}\s*/\s*{total}"))
    return loc.first.evaluate(NUMERAL_JS) if loc.count() else None


def thread_colour(bare, frame, gap: dict):
    px = changed_set(bare, frame, gap)
    if not px:
        return None
    return rgb(frame, *max(px, key=lambda q: dist3(rgb(frame, *q), rgb(bare, *q))))


def thread_mask(bare, frame, colour: tuple, keep) -> set:
    return {p for p in changed_set(bare, frame) if keep(*p)
            and dist3(rgb(frame, *p), colour) < dist3(rgb(frame, *p), rgb(bare, *p))}


def trace_forward(mask: set, start: tuple[float, float], reach: float):
    cols: dict[int, list[int]] = {}
    for x, y in mask:
        cols.setdefault(x, []).append(y)
    end, prev = None, start
    for x in sorted(cols):
        if x < start[0]:
            continue
        if end is None and x > start[0] + 2 * EDGE:
            break
        runs = []
        for y in sorted(cols[x]):
            if runs and y - runs[-1][-1] <= 1:
                runs[-1].append(y)
            else:
                runs.append([y])
        mid = min((sum(r) / len(r) for r in runs), key=lambda m: abs(m - prev[1]))
        allowed = reach if end is None else JUMP_PX * (x - prev[0])
        if abs(mid - prev[1]) <= allowed:
            end = prev = (x, mid)
    return end


def pin_box(page, req: dict, name: str) -> dict:
    kb, cb = card(page, req).bounding_box(), chip(page, name).bounding_box()
    left = cb["x"] + cb["width"] + EDGE
    top, bottom = min(cb["y"], kb["y"]), max(cb["y"] + cb["height"], kb["y"] + kb["height"])
    return {"x": left, "y": top, "width": kb["x"] + kb["width"] - left, "height": bottom - top}


def pin_film(page, film: Film, req: dict, name: str, commit, bare=None) -> dict:
    target, total = card(page, req), req["seats_total"]
    kb = target.bounding_box()
    pips = target.get_by_role("list", name=f"Gates for {req['ref']}").bounding_box()
    socket_ = target.get_by_role("button", name=f"Seat 1 of {total} for {req['ref']}").bounding_box()
    before = numeral(target, 0, total)
    assert before, "no claimed numeral in the seat counter"
    box = pin_box(page, req, name)
    board = status(page, "Board status")
    with entered(held(page, "**/offers")) as hold:
        commit()
        wait_for(page, lambda: "Offering" in board.inner_text(), why="pin pending")
        pre = film.shot(box)
        hold.release()
    frames = film_until(film, box, lambda: f"Offered {req['ref']}" in board.inner_text())
    tight = span(before, numeral(target, 1, total) or before)
    roll = {"x": tight["x"] - EDGE, "y": tight["y"] - tight["height"], "width": tight["width"] + 2 * EDGE,
            "height": tight["height"] * 3}
    paper = paper_of(pre, tight)
    old, new = ink(pre, before, paper), ink(frames[-1][1], tight, paper)
    seen = [ink(f, tight, paper) for _, f in frames]
    out = {"glyph": bool(old), "rolled": any(rolled(g, s, tight) for s in seen for g in (old, new) if g),
           "roll_span": burst(changes(pre, frames, roll))[1], "socket": socket_}
    if bare is not None:
        assert bare[0] == pre[0], "the board moved during the drag"
        cb = chip(page, name).bounding_box()
        anchor, reach = (box["x"], cb["y"] + cb["height"] / 2), cb["height"] / 2 + JUMP_PX
        gap = {"x": box["x"], "y": box["y"], "width": max(1, kb["x"] - EDGE - box["x"]), "height": box["height"]}
        colour = next(filter(None, (thread_colour(bare, f, gap) for f in [pre] + [f for _, f in frames])), None)
        assert colour, "no thread drawn between the chip and the card"

        def keep(x, y):
            edge = inside(kb, x, y, EDGE + 1) and not inside(kb, x, y, -(EDGE + 1))
            return not edge and not any(inside(r, x, y, EDGE) for r in (pips, socket_, roll))

        end = lambda f: trace_forward(thread_mask(bare, f, colour, keep), anchor, reach)
        out["start"] = end(pre)
        out["thread"] = [(t, end(f)) for t, f in frames]
    return out


def test_health_and_server_boundary(app_url):
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    for path in PRIVATE_PATHS:
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT).status_code == 404, path
    scripts = lambda r: re.findall(r"<script\b[^>]*?\bsrc\s*=\s*[\"']?([^\"'\s>]+)", r.text, re.I)
    for route in ("/requests/new", "/signin", "/board"):
        shell = httpx.get(f"{app_url}{route}", timeout=HTTP_TIMEOUT)
        assert shell.status_code == 200 and re.search(r"<script\b", shell.text, re.I), route
        for src in scripts(shell):
            url = httpx.URL(f"{app_url}{route}").join(src)
            assert httpx.get(url, timeout=HTTP_TIMEOUT).status_code == 200, src
    r = httpx.get(f"{app_url}/api/health", headers={"Origin": FOREIGN}, timeout=HTTP_TIMEOUT)
    assert not any(h.lower().startswith("access-control-") for h in r.headers)
    body = {"email": EMAIL["joel"], "passcode": PASSCODE}
    fails(httpx.post(f"{app_url}/api/session", json=body, headers={"Origin": FOREIGN}), 403, "cross_origin")
    fails(httpx.post(f"{app_url}/api/session", content=b'{"email":', headers={"Content-Type": "application/json"}),
          400, "bad_json")
    big = json.dumps({"email": "x" * (JSON_LIMIT + 1), "passcode": PASSCODE})
    fails(httpx.post(f"{app_url}/api/session", content=big, headers={"Content-Type": "application/json"},
                     timeout=HTTP_TIMEOUT), 413, "payload_too_large")
    st = ok(httpx.get(f"{app_url}/api/system/status", timeout=HTTP_TIMEOUT))
    assert st["postgres"] == "up" and {st["killbill"], st["mail"], st["storage"]} <= {"up", "down"}


def test_signin_and_roles(app_url, mail):
    for who, role in ROLE.items() | {k: "interpreter" for k in ["dana", "theo", "imani", "lior", "sam", "callum", "noor"]}.items():
        c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
        r = c.post("/api/session", json={"email": EMAIL[who], "passcode": PASSCODE})
        user = ok(r)["user"]
        assert (user["email"], user["name"], user["role"]) == (EMAIL[who], NAME[who], role)
        cookie = "; ".join(r.headers.get_list("set-cookie")).lower()
        assert "sw_session" in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
        assert ok(c.get("/api/me"))["user"]["id"] == user["id"]
    fails(httpx.post(f"{app_url}/api/session", json={"email": EMAIL["joel"], "passcode": "nope"}), 401, "invalid_credentials")
    fails(httpx.post(f"{app_url}/api/session", json={}), 422, "validation")
    fails(httpx.get(f"{app_url}/api/me"), 401, "unauthenticated")
    fails(httpx.get(f"{app_url}/api/board"), 401, "unauthenticated")
    req = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H))
    rid, sid, bea = req["id"], seats(req)[0]["id"], cid(app_url, "Bea Lindqvist")
    reps = {"coordinator": "rowan", "interpreter": "sam", "requester": "joel", "consumer": "marcus", "billing": "marguerite"}
    matrix = [
        ("GET", "/api/board", None, {"coordinator"}),
        ("GET", "/api/requests", None, {"requester", "coordinator", "billing"}),
        ("POST", "/api/requests", {}, {"requester", "coordinator"}),
        ("GET", f"/api/requests/{rid}", None, {"requester", "coordinator", "billing"}),
        ("PATCH", f"/api/requests/{rid}", {"title": ""}, {"requester"}),
        ("POST", f"/api/requests/{rid}/submit", {}, {"requester"}),
        ("GET", f"/api/requests/{rid}/cancellation-quote", None, {"requester", "coordinator"}),
        ("POST", f"/api/requests/{rid}/cancel", {"expected_fee": "999.00", "reason": REASON}, {"requester", "coordinator"}),
        ("POST", f"/api/seats/{sid}/dry-run", {"interpreter_id": NO_SUCH}, {"coordinator"}),
        ("POST", f"/api/seats/{sid}/offers", {"interpreter_id": NO_SUCH}, {"coordinator"}),
        ("GET", "/api/interpreters/me/assignments", None, {"interpreter"}),
        ("POST", f"/api/seats/{sid}/timesheet", {}, {"interpreter"}),
        ("GET", "/api/timesheets?status=submitted", None, {"billing"}),
        ("POST", approval_route(NO_SUCH), {}, {"billing"}),
        ("GET", "/api/rates", None, {"billing", "coordinator"}),
        ("PUT", "/api/rates", {}, {"billing"}),
        ("GET", f"/api/orgs/{ORG['joel']}/invoices", None, {"requester", "billing"}),
        ("GET", "/api/interpreters/me/credentials", None, {"interpreter"}),
        ("GET", "/api/consumers/me/preferences", None, {"consumer"}),
        ("PUT", "/api/consumers/me/preferences", {"preferred": [NO_SUCH], "blocked": [NO_SUCH]}, {"consumer"}),
        ("GET", "/api/consumers", None, {"requester", "coordinator"}),
        ("GET", f"/api/consumers/{bea}/preferences", None, {"coordinator"}),
        ("GET", f"/api/audit?request_id={rid}", None, {"coordinator", "billing"}),
    ]
    for method, path, body, allowed in matrix:
        headers = {"Idempotency-Key": idempotency_key()}
        fails(httpx.request(method, app_url + path, json=body, headers=headers, timeout=HTTP_TIMEOUT), 401, "unauthenticated")
        for role, who in reps.items():
            r = api(app_url, who).request(method, path, json=body, headers=headers)
            if role in allowed:
                assert r.status_code not in (401, 403), (role, method, path, r.text[:300])
            elif not (role == "interpreter" and path.endswith("/timesheet")):
                fails(r, 403, "forbidden")
    for path in (f"/api/prep/{NO_SUCH}", f"/api/timesheets/{NO_SUCH}/pdf", f"/api/credentials/{NO_SUCH}/scan"):
        fails(httpx.get(app_url + path, timeout=HTTP_TIMEOUT), 401, "unauthenticated")
    after = get_req(app_url, rid, "joel")
    assert after["status"] == "submitted" and seats(after)[0]["status"] == "open"
    for who, path in [("rowan", "/api/board"), ("marguerite", "/api/rates"), ("rowan", "/api/rates"),
                      ("joel", "/api/consumers"), ("sam", "/api/interpreters/me/assignments")]:
        ok(api(app_url, who).get(path))
    deny = lambda r: r.status_code in (403, 404) and r.json()["error"]["code"] in ("forbidden", "not_found")
    d0 = server_now(app_url).astimezone(TZ).date()
    prep_ids, scan_ids = [], []
    for role, who in reps.items():
        r = api(app_url, who).post(f"/api/requests/{rid}/prep", files={"file": (PREP_NAME, PDF, "application/pdf")})
        if role == "requester":
            prep_ids.append(ok(r, 201)["file"]["id"])
        else:
            fails(r, 403, "forbidden")
        r = api(app_url, who).post("/api/interpreters/me/credentials", files={"scan": ("r.png", PNG, "image/png")},
                                   data={"type": "EIPA-4.0", "number": unique("R")[0][:40],
                                         "expires_on": str(d0 - timedelta(days=1))})
        if role == "interpreter":
            scan_ids.append(ok(r, 201)["credential"]["id"])
        else:
            fails(r, 403, "forbidden")
    [fid], [scan] = prep_ids, scan_ids
    for who in ("joel", "rowan", "priya", "marguerite"):
        assert api(app_url, who).get(f"/api/prep/{fid}").content == PDF, who
    for who in ("anita", "sam", "marcus"):
        fails(api(app_url, who).get(f"/api/prep/{fid}"), 404, "not_found")
    for who in ("sam", "rowan", "priya"):
        assert api(app_url, who).get(f"/api/credentials/{scan}/scan").content == PNG, who
    fails(api(app_url, "dana").get(f"/api/credentials/{scan}/scan"), 404, "not_found")
    for who in ("joel", "marcus", "marguerite"):
        assert deny(api(app_url, who).get(f"/api/credentials/{scan}/scan")), who
    treq, tname, ts = worked(app_url, mail)
    ok(approve(app_url, ts["id"]))
    for who in ("marguerite", "joel", KEY[tname]):
        r = api(app_url, who).get(f"/api/timesheets/{ts['id']}/pdf")
        assert r.status_code == 200 and r.content.startswith(b"%PDF-"), who
    fails(api(app_url, "anita").get(f"/api/timesheets/{ts['id']}/pdf"), 404, "not_found")
    other = next(n for n in MEDICAL_OK if n != tname)
    fails(api(app_url, KEY[other]).get(f"/api/timesheets/{ts['id']}/pdf"), 404, "not_found")
    for who in ("rowan", "marcus"):
        assert deny(api(app_url, who).get(f"/api/timesheets/{ts['id']}/pdf")), who
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    ok(c.post("/api/session", json={"email": EMAIL["tomasz"], "passcode": PASSCODE}))
    assert c.delete("/api/session").status_code == 204
    fails(c.get("/api/me"), 401, "unauthenticated")


def test_seed_data(killbill):
    expect = {
        "FA-1001": ("submitted", [None]), "FA-1002": ("submitted", [None, None]),
        "FA-1003": ("partially_staffed", ["Lior Feld", None]), "FA-1004": ("staffed", ["Dana Okafor"]),
        "FA-1005": ("completed", ["Sam Whitlock"]), "FA-1006": ("submitted", [None, None]),
    }
    creds = {"dana": [("NIC", "N-40211", 400), ("SC:L", "L-1187", 400)], "theo": [("NIC", "N-38870", 600), ("SC:L", "L-1203", 600)],
             "imani": [("CDI", "C-5521", 700)], "lior": [("EIPA-4.0", "E-7730", 300)], "sam": [("NIC", "N-41902", 20)],
             "callum": [("NIC", "N-39954", 500), ("SC:L", "L-1150", -2)], "noor": [("NIC", "N-42617", 900)]}
    table = {
        "FA-1001": ("birchmere-clinic", "medical", "Cardiology follow-up", "14 Alder Row, Suite 2", 26 * 60, 27 * 60, "Bea Lindqvist", 1),
        "FA-1002": ("kestrel-court", "legal", "Arraignment, Courtroom 3B", "Kestrel County Courthouse", 30 * 60, 31 * 60 + 30, "Marcus Tull", 2),
        "FA-1003": ("larchfield-schools", "education", "IEP annual review", "Larchfield Middle, Room 112", 44 * 60, 47 * 60, "Marcus Tull", 2),
        "FA-1004": ("birchmere-clinic", "community", "Diabetes support group", "Birchmere Library hall", 52 * 60, 53 * 60 + 30, "Bea Lindqvist", 1),
        "FA-1005": ("birchmere-clinic", "medical", "Emergency department visit", "Birchmere Community Clinic, ED", -24 * 60, -23 * 60, "Bea Lindqvist", 1),
        "FA-1006": ("kestrel-court", "legal", "Bench trial, day one", "Kestrel County Courthouse", 120 * 60, 123 * 60, "Marcus Tull", 2),
    }
    ledger = kb_ledger()
    with fresh_copy() as base:
        now = server_now(base)
        for who in EMAIL:
            user = ok(api(base, who).get("/api/me"))["user"]
            assert (user["email"], user["name"], user["role"], user["org_id"]) == \
                (EMAIL[who], NAME[who], ROLE.get(who, "interpreter"), ORG.get(who)), who
        reqs = {r["ref"]: r for r in ok(api(base, "rowan").get("/api/requests"))["requests"]}
        assert sorted(reqs) == sorted(table)
        t0 = parse(reqs["FA-1001"]["start"]) - timedelta(hours=26)
        assert (t0.astimezone(TZ).minute, t0.second) == (0, 0)
        assert timedelta(0) <= now - t0 < timedelta(hours=1, seconds=BOOT_S)
        d0 = t0.astimezone(TZ).date()
        for ref, (org, setting, title, loc, s, e, consumer, n) in table.items():
            r, (state, people) = reqs[ref], expect[ref]
            assert (r["org_id"], r["org_name"], r["setting"], r["title"], r["location"], r["consumer"]["name"], r["seats_total"]) == \
                   (org, ORG_NAME[org], setting, title, loc, consumer, n), ref
            assert parse(r["start"]) == t0 + timedelta(minutes=s) and parse(r["end"]) == t0 + timedelta(minutes=e), ref
            assert (r["status"], r["logged_after"], r["cancellation_fee"]) == (state, ref == "FA-1005", None), ref
            got = [(x["status"], x["interpreter"] and x["interpreter"]["name"], x["held_by"] and x["held_by"]["name"]) for x in seats(r)]
            assert got == [("accepted", p, "Rowan Ilsley") if p else ("open", None, None) for p in people], ref
            assert ref == "FA-1005" or all(x["timesheet"] is None for x in r["seats"]), ref
            assert [p["filename"] for p in r["prep_files"]] == (["fa-1003-agenda.pdf"] if ref == "FA-1003" else []), ref
            acts = [x["action"] for x in audit(base, r["id"])]
            allowed = {"request.status_changed"} if ref == "FA-1005" else set()
            assert set(acts) <= allowed and len(acts) <= 1, (ref, acts)
            assert items(base, org, f"[cx-{r['id']}]") == [], ref
        sheet = seats(reqs["FA-1005"])[0]["timesheet"]
        assert (sheet["status"], sheet["billed_hours"], sheet["amount"]) == ("submitted", "2.00", None)
        [queued] = ok(api(base, "marguerite").get("/api/timesheets", params={"status": "submitted"}))["timesheets"]
        assert queued["id"] == sheet["id"] and parse(queued["actual_start"]) == t0 - timedelta(hours=24)
        assert parse(queued["actual_end"]) == t0 - timedelta(hours=22, minutes=40)
        assert items(base, "birchmere-clinic", f"[ts-{sheet['id']}]") == []
        board = ok(api(base, "rowan").get("/api/board"))
        assert [i["name"] for i in board["interpreters"]] == sorted(NAME[k] for k in creds)
        assert [r["ref"] for r in board["requests"]] == ["FA-1001", "FA-1002", "FA-1003", "FA-1004"]
        for who, expected in creds.items():
            want = {(t, num, str(d0 + timedelta(days=d)), "expired" if d < 0 else "expiring" if d <= WARN_DAYS else "valid")
                    for t, num, d in expected}
            listed = ok(api(base, who).get("/api/interpreters/me/credentials"))["credentials"]
            assert len(listed) == len(want) and {(c["type"], c["number"], c["expires_on"], c["status"]) for c in listed} == want, who
            for c in listed:
                scan = api(base, "rowan").get(f"/api/credentials/{c['id']}/scan")
                assert scan.status_code == 200 and scan.content.startswith(b"%PDF-"), (who, c["number"])
                [key] = bucket().keys(f"credentials/{iid(base, NAME[who])}/{c['id']}/")
                assert bucket().get(key) == scan.content
        assert [c["name"] for c in ok(api(base, "joel").get("/api/consumers"))["consumers"]] == ["Bea Lindqvist", "Marcus Tull"]
        bea = ok(api(base, "rowan").get(f"/api/consumers/{cid(base, 'Bea Lindqvist')}/preferences"))
        assert bea["preferred"] == [iid(base, "Dana Okafor")] and bea["blocked"] == [iid(base, "Noor Haddad")]
        marcus = ok(api(base, "rowan").get(f"/api/consumers/{cid(base, 'Marcus Tull')}/preferences"))
        assert marcus["preferred"] == [] and marcus["blocked"] == []
        assert rates(base) == {"medical": "80.00", "legal": "105.00", "education": "70.00", "community": "75.00"}
        for org, name in ORG_NAME.items():
            acct = killbill.account_by_key(f"fernhollow-{org}")
            assert acct and acct["name"] == name and acct["currency"] == "USD", org
        assert kb_ledger() == ledger, "seeding added a Kill Bill account, invoice or charge"


def test_request_drafting_and_validation(app_url):
    start = at(app_url, FAR_LO_H, FAR_HI_H)
    req = make(app_url, start=start, submit=False)
    assert req["status"] == "draft" and re.fullmatch(r"FA-\d+", req["ref"]) and int(req["ref"][3:]) > 1006
    title = unique("Edited")[0]
    req = ok(api(app_url, "joel").patch(f"/api/requests/{req['id']}", json={"title": title}))["request"]
    assert req["title"] == title and req["status"] == "draft"
    bad_title = unique("Never saved")[0]
    bad_patch = api(app_url, "joel").patch(f"/api/requests/{req['id']}", json={"title": "", "location": ""})
    assert set(fails(bad_patch, 422, "validation")["fields"]) >= {"title", "location"}
    assert get_req(app_url, req["id"], "joel")["title"] == title
    req = ok(api(app_url, "joel").post(f"/api/requests/{req['id']}/submit", json={}))["request"]
    assert req["status"] == "submitted"
    good = {"title": bad_title, "setting": "medical", "location": "Room 4", "start": start.isoformat(),
            "end": (start + timedelta(hours=1)).isoformat(), "consumer_id": cid(app_url, "Bea Lindqvist"), "notes": ""}
    cases = [
        ({"title": "", "setting": "spoken", "location": ""}, {"title", "setting", "location"}),
        ({"end": (start - timedelta(hours=1)).isoformat()}, None),
        ({"end": (start + timedelta(hours=11)).isoformat()}, None),
        ({"end": (start + timedelta(minutes=20)).isoformat()}, None),
        ({"consumer_id": "not-a-consumer"}, {"consumer_id"}),
        ({"notes": "n" * 2001}, {"notes"}),
        ({"title": "t" * 121}, {"title"}),
        ({"start": (server_now(app_url) - timedelta(hours=3)).isoformat(),
          "end": (server_now(app_url) - timedelta(hours=2)).isoformat()}, None),
    ]
    for change, expected in cases:
        fields = fails(api(app_url, "joel").post("/api/requests", json=good | change), 422, "validation")["fields"]
        if expected:
            assert set(fields) >= expected, (change, fields)
        else:
            assert set(fields) & {"start", "end"}, (change, fields)
    old = server_now(app_url) - timedelta(days=LOGGED_AFTER_DAYS + 1)
    late = good | {"start": old.isoformat(), "end": (old + timedelta(hours=1)).isoformat(),
                   "org_id": "birchmere-clinic", "logged_after": True}
    assert set(fails(api(app_url, "rowan").post("/api/requests", json=late), 422, "validation")["fields"]) & {"start", "end"}
    fails(api(app_url, "marcus").post("/api/requests", json=good), 403, "forbidden")
    listed = ok(api(app_url, "joel").get("/api/requests"))["requests"]
    assert not [r for r in listed if r["title"] == bad_title]


def test_prep_upload(app_url):
    for submit in (False, True):
        req = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), submit=submit)
        name = f"{unique('agenda')[0]}.pdf"
        f = ok(api(app_url, "joel").post(f"/api/requests/{req['id']}/prep", files={"file": (name, PDF, "application/pdf")}), 201)["file"]
        assert f["filename"] == name and f["size"] == len(PDF)
        key = f"prep/birchmere-clinic/{req['id']}/{f['id']}/{name}"
        assert key in bucket().keys(f"prep/birchmere-clinic/{req['id']}/") and bucket().get(key) == PDF
        assert [p["id"] for p in get_req(app_url, req["id"], "joel")["prep_files"]] == [f["id"]]
    prefix = f"prep/birchmere-clinic/{req['id']}/"
    before = bucket().keys(prefix)
    up = lambda part, who="joel", rid=req["id"]: api(app_url, who).post(f"/api/requests/{rid}/prep", files={"file": part})
    fails(up(("tool.exe", b"MZ\x90\x00\x03binary", "application/x-msdownload")), 415, "unsupported_media_type")
    fails(up(("fake.png", b"just some words", "image/png")), 415, "unsupported_media_type")
    fails(up(("big.pdf", PDF + b"0" * UPLOAD_LIMIT, "application/pdf")), 413, "payload_too_large")
    fails(up(("x.pdf", PDF, "application/pdf"), who="anita"), 404, "not_found")
    assert bucket().keys(prefix) == before
    gone = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), submit=False)
    ok(cancel(app_url, gone["id"], "0.00"))
    fails(up(("x.pdf", PDF, "application/pdf"), rid=gone["id"]), 409, "invalid_transition")
    assert bucket().keys(f"prep/birchmere-clinic/{gone['id']}/") == []


TEAM_CASES = {"medical_1h": ("medical", 1.0, 1), "medical_2h": ("medical", 2.0, 1), "medical_2h15": ("medical", 2.25, 2),
              "legal_1h": ("legal", 1.0, 2), "community_3h": ("community", 3.0, 2)}


@pytest.mark.parametrize("case", list(TEAM_CASES), ids=list(TEAM_CASES))
def test_team_seat_rule(app_url, case):
    setting, hours, expected = TEAM_CASES[case]
    start = at(app_url, FAR_LO_H, FAR_HI_H)
    req = make(app_url, start=start, setting=setting, hours=hours, submit=False)
    assert req["seats_total"] == expected == len(req["seats"])
    assert [s["position"] for s in seats(req)] == list(range(1, expected + 1))
    assert all(s["status"] == "open" for s in req["seats"]) and req["seats_claimed"] == 0
    for new_hours in (3.0, 1.0):
        req = ok(api(app_url, "joel").patch(f"/api/requests/{req['id']}", json={"end": (start + timedelta(hours=new_hours)).isoformat()}))["request"]
        want = 2 if setting == "legal" or new_hours > 2 else 1
        assert req["seats_total"] == want == len(req["seats"])


def test_four_gates(app_url):
    def results(req, name):
        return {g["gate"]: g for g in ok(dry(app_url, seats(req)[0]["id"], name))["gates"]}

    far = lambda **kw: make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), **kw)
    cred_reason = lambda s: f"No {s} credential. Needs one of {', '.join(ACCEPTED[s])}."
    g = results(far(), "Lior Feld")
    assert (g["credential"]["pass"], g["credential"]["reason"]) == (False, cred_reason("medical"))
    assert (g["validity"]["pass"], g["validity"]["reason"]) == (False, "No credential to check.")
    g = results(far(setting="legal"), "Noor Haddad")
    assert g["credential"]["reason"] == cred_reason("legal")
    g = results(far(setting="education"), "Lior Feld")
    assert g["credential"]["pass"] and g["validity"]["pass"]
    g = results(far(), "Noor Haddad")
    assert g["credential"]["pass"] and (g["consumer"]["pass"], g["consumer"]["reason"]) == (False, "Bea Lindqvist has blocked this interpreter.")
    sam_exp = date.fromisoformat(next(c["expires_on"] for c in ok(api(app_url, "sam").get("/api/interpreters/me/credentials"))["credentials"]
                                      if c["type"] == "NIC"))
    last_day = make(app_url, start=datetime.combine(sam_exp, clock(14, 0), tzinfo=TZ))
    assert results(last_day, "Sam Whitlock")["validity"]["pass"] is True
    after = make(app_url, start=datetime.combine(sam_exp + timedelta(days=1), clock(14, 0), tzinfo=TZ))
    g = results(after, "Sam Whitlock")
    assert g["credential"]["pass"] and (g["validity"]["pass"], g["validity"]["reason"]) == (False, f"NIC expires {sam_exp}, before this assignment ends.")
    buf, one = timedelta(minutes=TRAVEL_BUFFER_MIN), timedelta(minutes=1)
    for _ in range(8):
        anchor, _ = ready(app_url, ["Imani Brooks"], lo_h=FAR_LO_H, hi_h=FAR_HI_H)
        a_start, a_end = parse(anchor["start"]), parse(anchor["end"])
        probes = [(make(app_url, start=s), passes) for s, passes in
                  [(a_end + buf, True), (a_end + buf - one, False),
                   (a_start - buf - timedelta(hours=1), True), (a_start - buf - timedelta(hours=1) + one, False)]]
        if all(ok(dry(app_url, seats(p)[0]["id"], "Imani Brooks"))["all_pass"] for p, _ in probes):
            break
    else:
        raise AssertionError("no isolated interval for Imani Brooks")
    ok(pin(app_url, seats(anchor)[0]["id"], "Imani Brooks"), 201)
    for probe, passes in probes:
        sch = results(probe, "Imani Brooks")["schedule"]
        assert sch["pass"] is passes, probe["start"]
        if not passes:
            assert sch["reason"] == f"Too close to {anchor['ref']}; jobs need a travel buffer."
        else:
            assert sch["reason"] is None


def test_gate_dry_run(app_url, mail):
    req = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H))
    sid = seats(req)[0]["id"]
    before, log = get_req(app_url, req["id"]), audit(app_url, req["id"])
    for name in ["Theo Marchetti", "Lior Feld", "Noor Haddad"]:
        body = ok(dry(app_url, sid, name))
        assert body["seat_id"] == sid and body["interpreter_id"] == iid(app_url, name)
        assert [g["gate"] for g in body["gates"]] == GATES and [g["label"] for g in body["gates"]] == LABELS
        assert body["all_pass"] == all(g["pass"] for g in body["gates"])
        assert all((g["reason"] is None) == g["pass"] for g in body["gates"])
    after = get_req(app_url, req["id"])
    assert seats(after) == seats(before) and after["status"] == before["status"] and audit(app_url, req["id"]) == log
    quiet(mail, EMAIL["theo"], offer_subject(req))
    fails(api(app_url, "rowan").post(f"/api/seats/{NO_SUCH}/dry-run", json={"interpreter_id": iid(app_url, "Theo Marchetti")}), 404, "not_found")
    fails(api(app_url, "rowan").post(f"/api/seats/{sid}/dry-run", json={"interpreter_id": "no-such-interpreter"}), 404, "not_found")


def test_pin_reruns_gates(app_url, mail):
    a, _ = ready(app_url, ["Imani Brooks"], lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    b = make(app_url, start=parse(a["start"]) + timedelta(minutes=15))
    assert ok(dry(app_url, seats(b)[0]["id"], "Imani Brooks"))["all_pass"] is True
    ok(pin(app_url, seats(a)[0]["id"], "Imani Brooks"), 201)
    err = fails(pin(app_url, seats(b)[0]["id"], "Imani Brooks"), 422, "gate_failed")
    assert err["gate"] == "schedule" and [g["gate"] for g in err["gates"]] == GATES
    assert {g["gate"]: g["pass"] for g in err["gates"]}["schedule"] is False
    assert seats(get_req(app_url, b["id"]))[0]["status"] == "open"
    legal = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), setting="legal")
    err = fails(pin(app_url, seats(legal)[0]["id"], "Noor Haddad"), 422, "gate_failed")
    assert err["gate"] == "credential"
    assert all(s["status"] == "open" for s in get_req(app_url, legal["id"])["seats"])
    quiet(mail, EMAIL["imani"], offer_subject(b))


def test_one_winner_per_seat(app_url, mail):
    ids = {who: ok(api(app_url, who).get("/api/me"))["user"]["id"] for who in ("rowan", "priya")}
    for picks in (["Theo Marchetti", "Imani Brooks"], ["Imani Brooks", "Imani Brooks"]):
        req, _ = ready(app_url, sorted(set(picks)), n=len(set(picks)), lo_h=FAR_LO_H, hi_h=FAR_HI_H)
        sid = seats(req)[0]["id"]
        rs = race([lambda: pin(app_url, sid, picks[0], "rowan"), lambda: pin(app_url, sid, picks[1], "priya")])
        assert sorted(r.status_code for r in rs) == [201, 409], [r.text for r in rs]
        win = 0 if rs[0].status_code == 201 else 1
        winner = ("rowan", "priya")[win]
        holder = fails(rs[1 - win], 409, "seat_taken")["holder"]
        assert holder == {"id": ids[winner], "name": NAME[winner]}
        seat = seats(get_req(app_url, req["id"]))[0]
        assert seat["status"] == "offered" and seat["interpreter"]["name"] == picks[win] and seat["held_by"]["name"] == NAME[winner]
        assert len(mails(mail, EMAIL[KEY[picks[win]]], offer_subject(req))) == 1
        for name in set(picks) - {picks[win]}:
            quiet(mail, EMAIL[KEY[name]], offer_subject(req))


def test_no_overlapping_assignments(app_url):
    a, [name] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    b = make(app_url, start=parse(a["start"]) + timedelta(minutes=20))
    assert ok(dry(app_url, seats(b)[0]["id"], name))["all_pass"] is True
    rs = race([lambda: pin(app_url, seats(a)[0]["id"], name), lambda: pin(app_url, seats(b)[0]["id"], name, "priya")])
    assert sorted(r.status_code for r in rs) == [201, 422], [r.text for r in rs]
    assert fails(next(r for r in rs if r.status_code == 422), 422, "gate_failed")["gate"] == "schedule"
    offers = ok(api(app_url, KEY[name]).get("/api/interpreters/me/assignments"))["offers"]
    assert len({o["request"]["ref"] for o in offers} & {a["ref"], b["ref"]}) == 1


def test_offer_email_single_use(app_url, mail):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    ok(pin(app_url, seats(req)[0]["id"], name), 201)
    [m] = mails(mail, EMAIL[KEY[name]], offer_subject(req))
    assert SENDER in addresses(m.get("From"))
    assert re.fullmatch(r"<?outbox-.+@fernhollow\.test>?", m.get("MessageID") or "")
    body = text(m)
    assert req["location"] in body and "medical" in body.lower()
    tok = token_of(m)
    page = ok(httpx.get(f"{app_url}/api/offers/{tok}"))
    assert page["request"]["ref"] == req["ref"] and page["offer"]["status"] == "active"
    assert page["seat"] == {"position": 1, "total": 1} and page["interpreter"]["name"] == name
    assert ok(answer(app_url, tok))["offer"]["status"] == "accepted"
    for verb in ("accept", "decline"):
        assert fails(answer(app_url, tok, verb), 410, "offer_closed")["offer_status"] == "accepted"
    fails(httpx.get(f"{app_url}/api/offers/{'x' * TOKEN_MIN}"), 404, "not_found")
    deadline = time.monotonic() + POLL_S
    while seats(get_req(app_url, req["id"]))[0]["offer"]["email"] != "sent":
        assert time.monotonic() < deadline, "offer email never marked sent"


def test_offer_expiry(app_url, mail):
    slack = timedelta(seconds=120)
    far, [name] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    t = server_now(app_url)
    exp = parse(ok(pin(app_url, seats(far)[0]["id"], name), 201)["offer"]["expires_at"])
    assert abs(exp - (t + timedelta(hours=OFFER_TTL_H))) < slack
    past, [pname] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-4, logged_after=True)
    t = server_now(app_url)
    exp = parse(ok(pin(app_url, seats(past)[0]["id"], pname), 201)["offer"]["expires_at"])
    assert abs(exp - (t + timedelta(hours=OFFER_TTL_H))) < slack
    closed, [cname] = ready(app_url, MEDICAL_OK, lo_h=1.5, hi_h=1.75)
    fails(pin(app_url, seats(closed)[0]["id"], cname), 409, "offer_window_closed")
    assert seats(get_req(app_url, closed["id"]))[0]["status"] == "open"
    quiet(mail, EMAIL[KEY[cname]], offer_subject(closed))
    lead = OFFER_LEAD_H + EXPIRY_MARGIN_MIN / 60
    soon, [sname] = ready(app_url, MEDICAL_OK, lo_h=lead, hi_h=lead)
    exp = parse(ok(pin(app_url, seats(soon)[0]["id"], sname), 201)["offer"]["expires_at"])
    assert exp == parse(soon["start"]) - timedelta(hours=OFFER_LEAD_H)
    tok = offer_tokens(mail, soon, sname)[0]
    deadline = time.monotonic() + POLL_S + SWEEP_S + EXPIRY_MARGIN_MIN * 60
    while seats(get_req(app_url, soon["id"]))[0]["status"] != "open":
        assert time.monotonic() < deadline, "expired offer never reopened its seat"
    assert fails(answer(app_url, tok), 410, "offer_closed")["offer_status"] == "expired"


def test_accept_and_decline(app_url, mail):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    sid = seats(req)[0]["id"]
    ok(pin(app_url, sid, name), 201)
    first = offer_tokens(mail, req, name)[0]
    body = ok(answer(app_url, first, "decline"))
    assert body["offer"]["status"] == "declined" and body["request"]["ref"] == req["ref"]
    seat = seats(get_req(app_url, req["id"]))[0]
    assert seat["status"] == "open" and seat["interpreter"] is None and seat["held_by"] is None
    ok(pin(app_url, sid, name), 201)
    second = next(t for t in offer_tokens(mail, req, name, expected=2) if t != first)
    assert fails(answer(app_url, first), 410, "offer_closed")["offer_status"] == "declined"
    body = ok(answer(app_url, second))
    assert body["offer"]["status"] == "accepted" and body["request"]["status"] == "staffed"
    after = get_req(app_url, req["id"])
    seat = seats(after)[0]
    assert seat["status"] == "accepted" and seat["interpreter"]["name"] == name and after["seats_accepted"] == 1
    assert fails(answer(app_url, second, "decline"), 410, "offer_closed")["offer_status"] == "accepted"


def test_request_state_machine(app_url, mail):
    req, names = ready(app_url, LEGAL_OK, n=2, lo_h=FAR_LO_H, hi_h=FAR_HI_H, setting="legal")
    s1, s2 = seats(req)
    ok(pin(app_url, s1["id"], names[0]), 201)
    ok(pin(app_url, s2["id"], names[1]), 201)
    assert ok(answer(app_url, active_token(app_url, mail, req, names[0])))["request"]["status"] == "partially_staffed"
    assert get_req(app_url, req["id"], "joel")["status"] == "partially_staffed"
    assert ok(answer(app_url, active_token(app_url, mail, req, names[1])))["request"]["status"] == "staffed"
    rid = req["id"]
    assert fails(api(app_url, "joel").post(f"/api/requests/{rid}/submit", json={}), 409, "invalid_transition")["from"] == "staffed"
    assert fails(api(app_url, "joel").patch(f"/api/requests/{rid}", json={"title": "x y"}), 409, "invalid_transition")["from"] == "staffed"
    fails(dry(app_url, s1["id"], "Theo Marchetti"), 409, "seat_taken")
    draft = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), submit=False)
    assert fails(dry(app_url, seats(draft)[0]["id"], "Theo Marchetti"), 409, "invalid_transition")["from"] == "draft"
    fails(pin(app_url, seats(draft)[0]["id"], "Theo Marchetti"), 409, "invalid_transition")
    ok(cancel(app_url, draft["id"], "0.00"))
    assert get_req(app_url, draft["id"], "joel")["status"] == "cancelled_on_time"
    assert fails(cancel(app_url, draft["id"], "0.00"), 409, "invalid_transition")["from"] == "cancelled_on_time"
    done, [dn] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-4, logged_after=True)
    assert done["status"] == "submitted"
    unstaffed = make(app_url, start=at(app_url, -(LOGGED_AFTER_DAYS - 1) * 24, -4), logged_after=True)
    fails(api(app_url, "joel").get(f"/api/requests/{unstaffed['id']}/cancellation-quote"), 409, "already_started")
    fails(cancel(app_url, unstaffed["id"], "0.00"), 409, "already_started")
    assert staff(app_url, mail, done, [dn])["status"] == "completed"
    fails(dry(app_url, seats(done)[0]["id"], "Theo Marchetti"), 409, "seat_taken")
    assert fails(cancel(app_url, done["id"], "0.00"), 409, "invalid_transition")["from"] == "completed"


def test_staffed_confirmation_email(app_url, mail):
    req, names = ready(app_url, LEGAL_OK, n=2, lo_h=FAR_LO_H, hi_h=FAR_HI_H, setting="legal")
    subject = f"Staffed: {req['ref']} on {agency_date(req['start'])}"
    s1, s2 = seats(req)
    ok(pin(app_url, s1["id"], names[0]), 201)
    ok(pin(app_url, s2["id"], names[1]), 201)
    ok(answer(app_url, active_token(app_url, mail, req, names[0])))
    quiet(mail, EMAIL["joel"], subject)
    ok(answer(app_url, active_token(app_url, mail, req, names[1])))
    [m] = mails(mail, EMAIL["joel"], subject)
    assert SENDER in addresses(m.get("From")) and all(n in text(m) for n in names)
    assert len(mails_now(mail, EMAIL["joel"], subject)) == 1
    for other in ("anita", "tomasz"):
        assert not mails_now(mail, EMAIL[other], subject)


QUOTE_CASES = ["draft", "on_time_long", "late_unseated", "late_seated"]


@pytest.mark.parametrize("case", QUOTE_CASES, ids=QUOTE_CASES)
def test_cancellation_quote(app_url, mail, case):
    rate = Decimal(rates(app_url)["medical"] if case != "on_time_long" else rates(app_url)["legal"])
    if case == "draft":
        req, hours, seated, late = make(app_url, start=at(app_url, NEAR_LO_H, NEAR_HI_H), submit=False), 1, 0, False
    elif case == "on_time_long":
        req, hours, seated, late = make(app_url, start=at(app_url, LONG_WINDOW_H + 10, FAR_LO_H), setting="legal", hours=3), 3, 0, False
    elif case == "late_unseated":
        req, hours, seated, late = make(app_url, start=at(app_url, NEAR_LO_H, NEAR_HI_H)), 1, 0, True
    else:
        req, [name] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=LONG_WINDOW_H - 6, hours=3)
        ok(pin(app_url, seats(req)[0]["id"], name), 201)
        ok(answer(app_url, active_token(app_url, mail, req, name)))
        hours, seated, late = 3, 1, True
    q = quote(app_url, req["id"])
    assert set(q) == {"late", "window_hours", "hours_before_start", "seated", "charge_hours_per_interpreter",
                      "hourly_rate", "fee_per_interpreter", "fee"}
    window = SHORT_WINDOW_H if hours <= 2 else LONG_WINDOW_H
    charge = (Decimal("2.00") if hours <= 2 else Decimal(hours)) if late else Decimal(0)
    expected_h = Decimal((parse(req["start"]) - server_now(app_url)).total_seconds()) / 3600
    assert abs(Decimal(q["hours_before_start"]) - expected_h) <= HOURS_TOL
    assert (q["late"], q["window_hours"], q["seated"]) == (late, window, seated)
    assert q["charge_hours_per_interpreter"] == money(charge) and q["hourly_rate"] == money(rate)
    assert q["fee_per_interpreter"] == money(charge * rate) and q["fee"] == money(charge * rate * seated)
    assert get_req(app_url, req["id"], "joel")["in_cancellation_window"] is late
    assert quote(app_url, req["id"], "rowan") | {"hours_before_start": None} == q | {"hours_before_start": None}


def test_late_cancellation_charge(app_url, mail, killbill):
    org = "birchmere-clinic"
    rate = rates(app_url)["medical"]
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    req = staff(app_url, mail, req, [name])
    fee = money(Decimal("2.00") * Decimal(rate))
    assert quote(app_url, req["id"])["fee"] == fee
    body = ok(cancel(app_url, req["id"], fee))
    assert body["request"]["status"] == "cancelled_late" and body["request"]["cancellation_fee"] == fee
    prefix = f"[cx-{req['id']}]"
    [item] = items(app_url, org, prefix)
    assert item["amount"] == fee and item["description"] == f"{prefix} {req['ref']} late cancellation: 1 x 2.00 h at ${rate}/h"
    inv = ok(api(app_url, "joel").get(f"/api/orgs/{org}/invoices"))
    assert inv["killbill_account_id"] == killbill.account_by_key(f"fernhollow-{org}")["accountId"]
    fails(cancel(app_url, req["id"], fee), 409, "invalid_transition")
    assert len(items(app_url, org, prefix)) == 1
    on_time, [n2] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    on_time = staff(app_url, mail, on_time, [n2])
    r = ok(cancel(app_url, on_time["id"], "0.00"))["request"]
    assert (r["status"], r["cancellation_fee"]) == ("cancelled_on_time", "0.00")
    zero = make(app_url, start=at(app_url, NEAR_LO_H, NEAR_HI_H))
    r = ok(cancel(app_url, zero["id"], "0.00"))["request"]
    assert (r["status"], r["cancellation_fee"]) == ("cancelled_late", "0.00")
    for rid in (on_time["id"], zero["id"]):
        assert items(app_url, org, f"[cx-{rid}]") == []


def test_cancellation_notices(app_url, mail):
    rate = rates(app_url)["legal"]
    req, names = ready(app_url, LEGAL_OK, n=2, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H, setting="legal")
    s1, s2 = seats(req)
    ok(pin(app_url, s1["id"], names[0]), 201)
    ok(answer(app_url, active_token(app_url, mail, req, names[0])))
    ok(pin(app_url, s2["id"], names[1]), 201)
    pending = active_token(app_url, mail, req, names[1])
    q = quote(app_url, req["id"])
    after = ok(cancel(app_url, req["id"], q["fee"]))["request"]
    subject = f"Cancelled: {req['ref']} on {agency_date(req['start'])}"
    fpi = money(Decimal("2.00") * Decimal(rate))
    [m] = mails(mail, EMAIL[KEY[names[0]]], subject)
    assert f"Late cancellation. Charge per interpreter: ${fpi}" in text(m)
    quiet(mail, EMAIL[KEY[names[1]]], subject)
    assert len(mails_now(mail, EMAIL[KEY[names[0]]], subject)) == 1
    by_pos = {s["position"]: s for s in after["seats"]}
    assert by_pos[1]["status"] == "accepted" and by_pos[2]["status"] == "open"
    assert after["seats_claimed"] == after["seats_accepted"] == 1
    assert fails(answer(app_url, pending), 410, "offer_closed")["offer_status"] == "withdrawn"
    calm, [cn] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    calm = staff(app_url, mail, calm, [cn])
    ok(cancel(app_url, calm["id"], "0.00"))
    [m] = mails(mail, EMAIL[KEY[cn]], f"Cancelled: {calm['ref']} on {agency_date(calm['start'])}")
    assert "On-time cancellation. No charge." in text(m)


def test_idempotency_keys(app_url, mail):
    org = "birchmere-clinic"
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    req = staff(app_url, mail, req, [name])
    fee = quote(app_url, req["id"])["fee"]
    path = f"/api/requests/{req['id']}/cancel"
    c = api(app_url, "joel")
    fails(c.post(path, json={"expected_fee": fee, "reason": REASON}), 400, "idempotency_key_required")
    key = idempotency_key()
    fails(c.post(path, json={"expected_fee": "1.00", "reason": REASON}, headers={"Idempotency-Key": key}), 409, "fee_changed")
    hdr = {"Idempotency-Key": key, "Content-Type": "application/json"}
    first = c.post(path, content=json.dumps({"expected_fee": fee, "reason": REASON}), headers=hdr)
    ok(first)
    again = c.post(path, content=f'{{ "reason" : "{REASON}",\n "expected_fee": "{fee}" }}', headers=hdr)
    assert again.status_code == first.status_code and again.content == first.content
    assert again.headers.get("Idempotent-Replayed") == "true"
    fails(c.post(path, json={"expected_fee": fee, "reason": "Other"}, headers={"Idempotency-Key": key}), 409, "idempotency_conflict")
    assert len(items(app_url, org, f"[cx-{req['id']}]")) == 1
    assert len(mails(mail, EMAIL[KEY[name]], f"Cancelled: {req['ref']} on {agency_date(req['start'])}")) == 1
    past, [pn] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-4, logged_after=True)
    past = staff(app_url, mail, past, [pn])
    fails(api(app_url, KEY[pn]).post(f"/api/seats/{seats(past)[0]['id']}/timesheet", json=ts_body(past, pn, 70)),
          400, "idempotency_key_required")
    tkey = idempotency_key()
    t1 = submit_ts(app_url, past, pn, 70, key=tkey)
    ok(t1, 201)
    t2 = submit_ts(app_url, past, pn, 70, key=tkey)
    assert t2.status_code == 201 and t2.content == t1.content and t2.headers.get("Idempotent-Replayed") == "true"
    fails(submit_ts(app_url, past, pn, 95, key=tkey), 409, "idempotency_conflict")
    tid = t1.json()["timesheet"]["id"]
    fails(approve(app_url, tid, keyed=False), 400, "idempotency_key_required")
    akey = idempotency_key()
    a1 = approve(app_url, tid, akey)
    ok(a1)
    a2 = approve(app_url, tid, akey)
    assert a2.status_code == 200 and a2.content == a1.content and a2.headers.get("Idempotent-Replayed") == "true"
    a3 = approve(app_url, tid, akey, body={"note": "x"})
    fails(a3, 409, "idempotency_conflict")
    assert len(items(app_url, org, f"[ts-{tid}]")) == 1
    assert len(mails(mail, EMAIL["joel"], f"Timesheet approved: {past['ref']}")) == 1
    on_time = lambda: make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H))
    probe, other = on_time(), on_time()
    zero = {"expected_fee": "0.00", "reason": REASON}
    for bad in ("", "x" * 129, "has space"):
        assert c.post(f"/api/requests/{probe['id']}/cancel", json=zero, headers={"Idempotency-Key": bad}).status_code == 400, repr(bad)
    assert get_req(app_url, probe["id"], "joel")["status"] == "submitted"
    long_key = (idempotency_key() * 128)[:128]
    assert ok(cancel(app_url, probe["id"], "0.00", key=long_key))["request"]["id"] == probe["id"]
    scoped = cancel(app_url, other["id"], "0.00", key=long_key)
    assert scoped.status_code == 200 and scoped.json()["request"]["id"] == other["id"]
    assert scoped.headers.get("Idempotent-Replayed") != "true"
    racer, rkey = on_time(), idempotency_key()
    send = lambda reason: c.post(f"/api/requests/{racer['id']}/cancel", json={"expected_fee": "0.00", "reason": reason},
                                 headers={"Idempotency-Key": rkey})
    rs = race([lambda: send(REASON), lambda: send(REASON), lambda: send(REASON), lambda: send("Other")])
    wins = [r for r in rs if r.status_code == 200]
    assert wins, [r.text[:200] for r in rs]
    won = json.loads(wins[0].request.content)["reason"]
    for r in rs:
        if json.loads(r.request.content)["reason"] == won:
            assert r.status_code == 200 and r.content == wins[0].content, r.text[:300]
        else:
            fails(r, 409, "idempotency_conflict")
    assert sum(r.headers.get("Idempotent-Replayed") != "true" for r in wins) == 1
    assert [e["action"] for e in audit(app_url, racer["id"])].count("request.cancelled") == 1
    other_user = cancel(app_url, racer["id"], "0.00", who="rowan", key=rkey)
    assert other_user.headers.get("Idempotent-Replayed") != "true"
    assert fails(other_user, 409, "invalid_transition")["from"] == "cancelled_on_time"
    late2, [ln] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    late2 = staff(app_url, mail, late2, [ln])
    fee2, k2 = quote(app_url, late2["id"])["fee"], idempotency_key()
    fails(cancel(os.environ["APP_KILLBILL_DOWN_URL"], late2["id"], fee2, key=k2), 503, "billing_unavailable")
    retried = cancel(app_url, late2["id"], fee2, key=k2)
    assert retried.status_code == 200 and retried.headers.get("Idempotent-Replayed") != "true"
    assert len(items(app_url, org, f"[cx-{late2['id']}]")) == 1
    vt, [vn] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-4, logged_after=True)
    vt = staff(app_url, mail, vt, [vn])
    vkey = idempotency_key()
    fails(api(app_url, KEY[vn]).post(f"/api/seats/{seats(vt)[0]['id']}/timesheet", json=ts_body(vt, vn, 70) | {"signature_name": "x"},
                                     headers={"Idempotency-Key": vkey}), 422, "validation")
    ok(submit_ts(app_url, vt, vn, 70, key=vkey), 201)


def test_timesheet_billed_hours(app_url, mail):
    for minutes, billed in [(70, "2.00"), (125, "2.25"), (180, "3.00")]:
        req, [name] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-6, logged_after=True)
        req = staff(app_url, mail, req, [name])
        ts = ok(submit_ts(app_url, req, name, minutes), 201)["timesheet"]
        assert ts["status"] == "submitted" and ts["billed_hours"] == billed
        assert seats(get_req(app_url, req["id"]))[0]["timesheet"]["billed_hours"] == billed
        listed = ok(api(app_url, "marguerite").get("/api/timesheets", params={"status": "submitted"}))["timesheets"]
        assert any(t["id"] == ts["id"] and t["billed_hours"] == billed and t["ref"] == req["ref"] for t in listed)
    fails(submit_ts(app_url, req, name, 70), 409, "already_submitted")
    other = next(n for n in MEDICAL_OK if n != name)
    r = api(app_url, KEY[other]).post(f"/api/seats/{seats(req)[0]['id']}/timesheet", json=ts_body(req, other, 70),
                                     headers={"Idempotency-Key": idempotency_key()})
    assert r.status_code in (403, 404)
    fresh, [fn] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-6, logged_after=True)
    fresh = staff(app_url, mail, fresh, [fn])
    start = parse(fresh["start"])
    bad = {"actual_start": start.isoformat(), "actual_end": (start - timedelta(minutes=5)).isoformat(), "signature_name": "x"}
    fields = fails(api(app_url, KEY[fn]).post(f"/api/seats/{seats(fresh)[0]['id']}/timesheet", json=bad,
                                              headers={"Idempotency-Key": idempotency_key()}), 422, "validation")["fields"]
    assert {"actual_end", "signature_name"} <= set(fields)
    fails(submit_ts(app_url, fresh, fn, (TIMESHEET_MAX_H := 12) * 60 + 1), 422, "validation")
    future, [un] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    future = staff(app_url, mail, future, [un])
    fails(submit_ts(app_url, future, un, 70), 409, "not_yet_ended")


def test_atomic_timesheet_approval(app_url, mail):
    req, name, ts = worked(app_url, mail)
    with spawned(S3_ENDPOINT=CLOSED) as nostore:
        fails(approve(nostore, ts["id"]), 503, "storage_unavailable")
    seat = seats(get_req(app_url, req["id"]))[0]
    assert seat["timesheet"]["status"] == "submitted" and seat["timesheet"]["amount"] is None
    assert bucket().keys(f"timesheets/{req['id']}/") == []
    assert items(app_url, "birchmere-clinic", f"[ts-{ts['id']}]") == []
    assert "timesheet.approved" not in [e["action"] for e in audit(app_url, req["id"])]
    quiet(mail, EMAIL["joel"], f"Timesheet approved: {req['ref']}")
    rate = rates(app_url)["medical"]
    body = ok(approve(app_url, ts["id"]))
    amount = money(Decimal(ts["billed_hours"]) * Decimal(rate))
    assert body["timesheet"]["status"] == "approved" and body["timesheet"]["amount"] == amount
    assert body["timesheet"]["hourly_rate"] == rate and body["request"]["status"] == "invoiced"
    prefix = f"[ts-{ts['id']}]"
    [item] = items(app_url, "birchmere-clinic", prefix)
    assert item["amount"] == amount
    assert item["description"] == f"{prefix} {req['ref']} interpreting: {name}, {ts['billed_hours']} h at ${rate}/h"
    key = f"timesheets/{req['id']}/{ts['id']}.pdf"
    assert key in bucket().keys(f"timesheets/{req['id']}/") and bucket().get(key).startswith(b"%PDF-")
    flat = squash(pdf_text(bucket().get(key)))
    for needle in (req["ref"], name, ts["billed_hours"], f"Approved by {NAME['marguerite']}"):
        assert squash(needle) in flat, needle
    [m] = mails(mail, EMAIL["joel"], f"Timesheet approved: {req['ref']}")
    assert name in text(m) and ts["billed_hours"] in text(m) and amount in text(m)
    pdf = api(app_url, "joel").get(f"/api/timesheets/{ts['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
    fails(approve(app_url, ts["id"]), 409, "invalid_transition")
    assert len(items(app_url, "birchmere-clinic", prefix)) == 1


def test_amount_frozen_at_approval(app_url, mail):
    original = rates(app_url)
    try:
        req, name, ts = worked(app_url, mail)
        ok(api(app_url, "marguerite").put("/api/rates", json={"medical": PROBE_RATE}))
        body = ok(approve(app_url, ts["id"]))
        assert body["timesheet"]["amount"] == money(Decimal(ts["billed_hours"]) * Decimal(PROBE_RATE))
        assert body["timesheet"]["hourly_rate"] == PROBE_RATE
        frozen = body["timesheet"]["amount"]
        ok(api(app_url, "marguerite").put("/api/rates", json={"medical": LATER_RATE}))
        assert seats(get_req(app_url, req["id"]))[0]["timesheet"]["amount"] == frozen
        assert [i["amount"] for i in items(app_url, "birchmere-clinic", f"[ts-{ts['id']}]")] == [frozen]
        for bad in ("0.00", "1000.01", "-5.00"):
            assert "medical" in fails(api(app_url, "marguerite").put("/api/rates", json={"medical": bad}), 422, "validation")["fields"]
        assert rates(app_url)["medical"] == LATER_RATE
    finally:
        ok(api(app_url, "marguerite").put("/api/rates", json=original))


def test_invoices_match_killbill(app_url, mail, killbill):
    org = "birchmere-clinic"
    before = ok(api(app_url, "joel").get(f"/api/orgs/{org}/invoices"))
    req, name, ts = worked(app_url, mail)
    amount = ok(approve(app_url, ts["id"]))["timesheet"]["amount"]
    inv = ok(api(app_url, "joel").get(f"/api/orgs/{org}/invoices"))
    assert inv["org_id"] == org and inv["killbill_account_id"] == killbill.account_by_key(f"fernhollow-{org}")["accountId"]
    assert inv["total"] == money(sum(Decimal(i["amount"]) for i in inv["invoices"]))
    assert Decimal(inv["total"]) - Decimal(before["total"]) == Decimal(amount)
    dates = [i["invoice_date"] for i in inv["invoices"]]
    assert dates == sorted(dates, reverse=True) and all(i["currency"] == "USD" for i in inv["invoices"])
    for i in inv["invoices"]:
        assert i["amount"] == money(sum(Decimal(it["amount"]) for it in i["items"]))
    assert any(it["description"].startswith(f"[ts-{ts['id']}]") and it["amount"] == amount for i in inv["invoices"] for it in i["items"])
    assert ok(api(app_url, "marguerite").get(f"/api/orgs/{org}/invoices"))["total"] == inv["total"]
    for _ in range(5):
        kb1 = {i["invoice_id"]: i for i in kb_invoices(org)}
        inv = ok(api(app_url, "joel").get(f"/api/orgs/{org}/invoices"))
        kb2 = {i["invoice_id"]: i for i in kb_invoices(org)}
        if kb1 == kb2:
            break
    assert set(kb2) == {i["invoice_id"] for i in inv["invoices"]}
    for i in inv["invoices"]:
        k = kb2[i["invoice_id"]]
        assert (i["amount"], i["balance"]) == (k["amount"], k["balance"]), i["invoice_id"]
        assert sorted((x["description"], x["amount"]) for x in i["items"]) == \
            sorted((x["description"], x["amount"]) for x in k["items"])
    assert inv["total"] == money(sum(Decimal(k["amount"]) for k in kb2.values()))
    assert [x["amount"] for x in items(app_url, org, f"[ts-{ts['id']}]")] == [amount]
    fails(api(app_url, "anita").get(f"/api/orgs/{org}/invoices"), 404, "not_found")
    fails(api(app_url, "marguerite").get(f"/api/orgs/{NO_SUCH}/invoices"), 404, "not_found")


def test_credentials_with_scans(app_url):
    d0 = server_now(app_url).astimezone(TZ).date()
    number = unique("L")[0][:40]
    fname = f"{unique('scan')[0]}.png"
    r = api(app_url, "callum").post("/api/interpreters/me/credentials", data={"type": "SC:L", "number": number,
                                    "expires_on": str(d0 + timedelta(days=800))}, files={"scan": (fname, PNG, "image/png")})
    cred = ok(r, 201)["credential"]
    key = f"credentials/{iid(app_url, 'Callum Reyes')}/{cred['id']}/{fname}"
    assert key in bucket().keys(f"credentials/{iid(app_url, 'Callum Reyes')}/") and bucket().get(key) == PNG
    listed = ok(api(app_url, "callum").get("/api/interpreters/me/credentials"))["credentials"]
    assert {c["number"] for c in listed} >= {number, "L-1150"}
    assert next(c for c in listed if c["number"] == "L-1150")["status"] == "expired"
    assert next(c for c in listed if c["id"] == cred["id"])["status"] == "valid"
    assert api(app_url, "callum").get(f"/api/credentials/{cred['id']}/scan").content == PNG
    assert api(app_url, "rowan").get(f"/api/credentials/{cred['id']}/scan").content == PNG
    fails(api(app_url, "dana").get(f"/api/credentials/{cred['id']}/scan"), 404, "not_found")
    legal = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), setting="legal")
    gates = {g["gate"]: g["pass"] for g in ok(dry(app_url, seats(legal)[0]["id"], "Callum Reyes"))["gates"]}
    assert gates["credential"] and gates["validity"]
    older = api(app_url, "theo").post("/api/interpreters/me/credentials", data={"type": "NIC", "number": unique("N")[0][:40],
                                      "expires_on": str(d0 + timedelta(days=100))}, files={"scan": (fname, PNG, "image/png")})
    ok(older, 201)
    late = make(app_url, start=datetime.combine(d0 + timedelta(days=200), clock(10, 0), tzinfo=TZ))
    assert {g["gate"]: g["pass"] for g in ok(dry(app_url, seats(late)[0]["id"], "Theo Marchetti"))["gates"]}["validity"]
    bad = api(app_url, "theo").post("/api/interpreters/me/credentials", data={"type": "ABC", "number": "", "expires_on": "soon"},
                                    files={"scan": (fname, PNG, "image/png")})
    assert {"type", "number", "expires_on"} <= set(fails(bad, 422, "validation")["fields"])
    wrong = api(app_url, "theo").post("/api/interpreters/me/credentials", data={"type": "NIC", "number": "N-1",
                                      "expires_on": str(d0 + timedelta(days=100))}, files={"scan": ("s.png", b"plain words", "image/png")})
    fails(wrong, 415, "unsupported_media_type")


def test_credential_expiry_warning(app_url, mail):
    d0 = server_now(app_url).astimezone(TZ).date()
    numbers = {}
    for days in (WARN_DAYS, WARN_DAYS + 1, -1):
        numbers[days] = unique("W")[0][:40]
        ok(api(app_url, "theo").post("/api/interpreters/me/credentials", data={"type": "NIC", "number": numbers[days],
           "expires_on": str(d0 + timedelta(days=days))}, files={"scan": ("w.png", PNG, "image/png")}), 201)
    subject = lambda days: f"Credential expiring: NIC on {d0 + timedelta(days=days)}"
    [m] = mails(mail, EMAIL["theo"], subject(WARN_DAYS), needle=numbers[WARN_DAYS], seconds=SWEEP_S + MAIL_DELIVERY_S + 30)
    assert SENDER in addresses(m.get("From"))
    for days in (WARN_DAYS + 1, -1):
        quiet(mail, EMAIL["theo"], subject(days), needle=numbers[days], seconds=MAIL_DELIVERY_S)
    assert len(mails_now(mail, EMAIL["theo"], subject(WARN_DAYS), numbers[WARN_DAYS])) == 1
    statuses = {c["number"]: c["status"] for c in ok(api(app_url, "theo").get("/api/interpreters/me/credentials"))["credentials"]}
    assert (statuses[numbers[WARN_DAYS]], statuses[numbers[WARN_DAYS + 1]], statuses[numbers[-1]]) == ("expiring", "valid", "expired")


def test_consumer_preferences(app_url, mail):
    try:
        held_req, _ = ready(app_url, ["Dana Okafor"], lo_h=FAR_LO_H, hi_h=FAR_HI_H, consumer="Marcus Tull")
        ok(pin(app_url, seats(held_req)[0]["id"], "Dana Okafor"), 201)
        target, _ = ready(app_url, ["Dana Okafor"], lo_h=FAR_LO_H, hi_h=FAR_HI_H, consumer="Marcus Tull")
        body = ok(put_prefs(app_url, "marcus", ["Theo Marchetti"], ["Dana Okafor"]))
        assert body == {"preferred": [iid(app_url, "Theo Marchetti")], "blocked": [iid(app_url, "Dana Okafor")]}
        mine = ok(api(app_url, "marcus").get("/api/consumers/me/preferences"))
        assert mine["blocked"] == [iid(app_url, "Dana Okafor")] and {i["name"] for i in mine["interpreters"]} >= set(LEGAL_OK)
        seen = ok(api(app_url, "rowan").get(f"/api/consumers/{cid(app_url, 'Marcus Tull')}/preferences"))
        assert seen["consumer"]["name"] == "Marcus Tull" and seen["preferred"] == [iid(app_url, "Theo Marchetti")]
        g = {x["gate"]: x for x in ok(dry(app_url, seats(target)[0]["id"], "Dana Okafor"))["gates"]}
        assert (g["consumer"]["pass"], g["consumer"]["reason"]) == (False, "Marcus Tull has blocked this interpreter.")
        assert fails(pin(app_url, seats(target)[0]["id"], "Dana Okafor"), 422, "gate_failed")["gate"] == "consumer"
        assert seats(get_req(app_url, held_req["id"]))[0]["offer"]["status"] == "active"
        fails(put_prefs(app_url, "marcus", ["Dana Okafor"], ["Dana Okafor"]), 422, "validation")
        fails(api(app_url, "marcus").put("/api/consumers/me/preferences", json={"preferred": ["nobody"], "blocked": []}), 422, "validation")
        assert ok(api(app_url, "marcus").get("/api/consumers/me/preferences"))["blocked"] == [iid(app_url, "Dana Okafor")]
        ok(put_prefs(app_url, "marcus", [], []))
        assert ok(dry(app_url, seats(target)[0]["id"], "Dana Okafor"))["gates"][3]["pass"] is True
    finally:
        ok(put_prefs(app_url, "marcus", [], []))


def test_tenant_isolation(app_url, mail):
    theirs = make(app_url, who="anita", start=at(app_url, FAR_LO_H, FAR_HI_H), org="kestrel-court", submit=False)
    rid = theirs["id"]
    c = api(app_url, "joel")
    fails(c.get(f"/api/requests/{rid}"), 404, "not_found")
    fails(c.patch(f"/api/requests/{rid}", json={"title": "Taken over"}), 404, "not_found")
    fails(c.post(f"/api/requests/{rid}/submit", json={}), 404, "not_found")
    fails(c.get(f"/api/requests/{rid}/cancellation-quote"), 404, "not_found")
    fails(cancel(app_url, rid, "0.00", who="joel"), 404, "not_found")
    fails(c.get(f"/api/orgs/{ORG['anita']}/invoices"), 404, "not_found")
    assert all(r["org_id"] == "birchmere-clinic" for r in ok(c.get("/api/requests"))["requests"])
    assert get_req(app_url, rid, "anita")["status"] == "draft"
    req, name, ts = worked(app_url, mail)
    ok(approve(app_url, ts["id"]))
    fails(api(app_url, "anita").get(f"/api/timesheets/{ts['id']}/pdf"), 404, "not_found")
    assert api(app_url, "joel").get(f"/api/timesheets/{ts['id']}/pdf").status_code == 200
    fails(api(app_url, "anita").get(f"/api/requests/{req['id']}"), 404, "not_found")


def test_prep_access(app_url, mail):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    fid = ok(api(app_url, "joel").post(f"/api/requests/{req['id']}/prep", files={"file": ("brief.pdf", PDF, "application/pdf")}), 201)["file"]["id"]
    get = lambda who: api(app_url, who).get(f"/api/prep/{fid}")
    for who in ("joel", "rowan", "priya", "marguerite"):
        r = get(who)
        assert r.status_code == 200 and r.content == PDF and "attachment" in r.headers["content-disposition"]
    fails(get("anita"), 404, "not_found")
    fails(get(KEY[name]), 404, "not_found")
    ok(pin(app_url, seats(req)[0]["id"], name), 201)
    fails(get(KEY[name]), 404, "not_found")
    ok(answer(app_url, active_token(app_url, mail, req, name)))
    assert get(KEY[name]).content == PDF
    other = next(n for n in MEDICAL_OK if n != name)
    fails(get(KEY[other]), 404, "not_found")
    ok(cancel(app_url, req["id"], "0.00"))
    fails(get(KEY[name]), 404, "not_found")
    assert get("joel").status_code == 200
    fails(httpx.get(f"{app_url}/api/prep/{fid}"), 401, "unauthenticated")


def test_audit_log(app_url, mail):
    req = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), submit=False)
    ok(api(app_url, "joel").patch(f"/api/requests/{req['id']}", json={"title": unique("Audited")[0]}))
    ok(api(app_url, "joel").post(f"/api/requests/{req['id']}/submit", json={}))
    name = next(n for n in MEDICAL_OK if ok(dry(app_url, seats(req)[0]["id"], n))["all_pass"])
    ok(pin(app_url, seats(req)[0]["id"], name), 201)
    fails(pin(app_url, seats(req)[0]["id"], name, "priya"), 409, "seat_taken")
    ok(answer(app_url, active_token(app_url, mail, req, name)))
    entries = audit(app_url, req["id"])
    assert [e["action"] for e in entries] == ["request.created", "request.updated", "request.submitted", "seat.offered",
                                             "offer.accepted", "request.status_changed"]
    assert [e["actor"]["name"] if e["actor"] else None for e in entries] == ["Joel Haverty"] * 3 + ["Rowan Ilsley", None, None]
    assert (entries[2]["from"], entries[2]["to"]) == ("draft", "submitted")
    assert (entries[5]["from"], entries[5]["to"]) == ("submitted", "staffed")
    assert iid(app_url, name) in json.dumps(entries[4]["detail"]) or name in json.dumps(entries[4]["detail"])
    assert all(e["at"] for e in entries)
    other = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H))
    n2 = next(n for n in MEDICAL_OK if ok(dry(app_url, seats(other)[0]["id"], n))["all_pass"])
    ok(pin(app_url, seats(other)[0]["id"], n2), 201)
    ok(cancel(app_url, other["id"], "0.00"))
    acts = [e["action"] for e in audit(app_url, other["id"])]
    assert acts == ["request.created", "request.submitted", "seat.offered", "request.cancelled", "offer.withdrawn"]
    assert ok(api(app_url, "marguerite").get("/api/audit", params={"request_id": other["id"]}))["entries"] == audit(app_url, other["id"])
    fails(api(app_url, "joel").get("/api/audit", params={"request_id": other["id"]}), 403, "forbidden")


def test_billing_outage(app_url, mail):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    assert ok(httpx.get(f"{down}/api/system/status", timeout=HTTP_TIMEOUT))["killbill"] == "down"
    req, name, ts = worked(app_url, mail)
    t = time.monotonic()
    fails(approve(down, ts["id"]), 503, "billing_unavailable")
    assert time.monotonic() - t < KB_FAIL_S
    listed = ok(api(app_url, "marguerite").get("/api/timesheets", params={"status": "submitted"}))["timesheets"]
    assert any(x["id"] == ts["id"] for x in listed)
    assert bucket().keys(f"timesheets/{req['id']}/") == []
    assert "timesheet.approved" not in [e["action"] for e in audit(app_url, req["id"])]
    quiet(mail, EMAIL["joel"], f"Timesheet approved: {req['ref']}")
    ok(approve(app_url, ts["id"]))
    assert len(items(app_url, "birchmere-clinic", f"[ts-{ts['id']}]")) == 1
    late, [ln] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    late = staff(app_url, mail, late, [ln])
    fee, log = quote(app_url, late["id"])["fee"], audit(app_url, late["id"])
    t = time.monotonic()
    fails(cancel(down, late["id"], fee), 503, "billing_unavailable")
    assert time.monotonic() - t < KB_FAIL_S
    after = get_req(app_url, late["id"])
    assert after["status"] == "staffed" and seats(after) == seats(late) and audit(app_url, late["id"]) == log
    quiet(mail, EMAIL[KEY[ln]], f"Cancelled: {late['ref']} on {agency_date(late['start'])}")
    ok(cancel(app_url, late["id"], fee))
    assert len(items(app_url, "birchmere-clinic", f"[cx-{late['id']}]")) == 1
    fails(api(down, "joel").get(f"/api/orgs/{ORG['joel']}/invoices"), 503, "billing_unavailable")
    zero = make(app_url, start=at(app_url, NEAR_LO_H, NEAR_HI_H))
    r = ok(cancel(down, zero["id"], "0.00"))["request"]
    assert (r["status"], r["cancellation_fee"]) == ("cancelled_late", "0.00")
    calm = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H))
    cn = next(n for n in MEDICAL_OK if ok(dry(down, seats(calm)[0]["id"], n))["all_pass"])
    ok(pin(down, seats(calm)[0]["id"], cn), 201)
    assert ok(cancel(down, calm["id"], "0.00"))["request"]["status"] == "cancelled_on_time"


def test_billing_timeout_reconciliation(app_url, mail):
    kb = urlsplit(os.environ["KILLBILL_URL"])
    relay = Relay((kb.hostname, kb.port or 80))
    original = rates(app_url)
    org = ORG["joel"]
    try:
        with spawned(KILLBILL_URL=kb._replace(netloc=f"127.0.0.1:{relay.port}").geturl()) as slow:
            req, name, ts = worked(app_url, mail)
            prefix, old = f"[ts-{ts['id']}]", original["medical"]
            t = time.monotonic()
            fails(approve(slow, ts["id"]), 503, "billing_unavailable")
            assert time.monotonic() - t < KB_FAIL_S + LATENCY_SLACK_S
            seat = seats(get_req(app_url, req["id"]))[0]
            assert seat["timesheet"]["status"] == "submitted" and seat["timesheet"]["amount"] is None
            assert bucket().keys(f"timesheets/{req['id']}/") == []
            assert "timesheet.approved" not in [e["action"] for e in audit(app_url, req["id"])]
            quiet(mail, EMAIL["joel"], f"Timesheet approved: {req['ref']}")
            eventually(lambda: len(items(app_url, org, prefix)) == 1, "the uncertain charge to land")
            ok(api(app_url, "marguerite").put("/api/rates", json={"medical": PROBE_RATE}))
            again = approve(slow, ts["id"])
            if again.status_code != 200:
                fails(again, 503, "billing_unavailable")
                assert len(items(app_url, org, prefix)) == 1
                again = approve(app_url, ts["id"])
            body = ok(again)["timesheet"]
            amount = money(Decimal(ts["billed_hours"]) * Decimal(old))
            [item] = items(app_url, org, prefix)
            assert (body["amount"], body["hourly_rate"], item["amount"]) == (amount, old, amount)
            assert seats(get_req(app_url, req["id"]))[0]["timesheet"]["amount"] == amount
            [m] = mails(mail, EMAIL["joel"], f"Timesheet approved: {req['ref']}")
            assert amount in text(m)
            late, [ln] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
            late = staff(app_url, mail, late, [ln])
            fee, cx = quote(app_url, late["id"])["fee"], f"[cx-{late['id']}]"
            log = audit(app_url, late["id"])
            t = time.monotonic()
            fails(cancel(slow, late["id"], fee), 503, "billing_unavailable")
            assert time.monotonic() - t < KB_FAIL_S + LATENCY_SLACK_S
            after = get_req(app_url, late["id"])
            assert after["status"] == "staffed" and audit(app_url, late["id"]) == log
            eventually(lambda: len(items(app_url, org, cx)) == 1, "the uncertain cancellation charge to land")
            ok(api(app_url, "marguerite").put("/api/rates", json={"medical": LATER_RATE}))
            fresh = quote(app_url, late["id"])["fee"]
            assert fresh == money(Decimal("2.00") * Decimal(LATER_RATE))
            reconciled = fails(cancel(app_url, late["id"], fresh), 409, "fee_changed")["quote"]
            assert (reconciled["fee"], reconciled["hourly_rate"], reconciled["seated"]) == (fee, PROBE_RATE, 1)
            done = ok(cancel(app_url, late["id"], fee))["request"]
            assert (done["status"], done["cancellation_fee"]) == ("cancelled_late", fee)
            assert [i["amount"] for i in items(app_url, org, cx)] == [fee]
            assert len(items(app_url, org, prefix)) == 1
    finally:
        relay.close()
        ok(api(app_url, "marguerite").put("/api/rates", json=original))


def test_mail_outage(mail):
    place = unique("Queued room")[0]
    seen = frozenset(m.get("ID") for m in mail.messages())
    assert None not in seen, "Mailpit messages carry no ID"
    with fresh_database() as db:
        with spawned(DATABASE_URL=db, MAILPIT_URL=CLOSED, SMTP_HOST=CLOSED_HOST, SMTP_PORT=CLOSED_PORT) as down:
            assert ok(httpx.get(f"{down}/api/system/status", timeout=HTTP_TIMEOUT))["mail"] == "down"
            req, [name] = ready(down, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H, location=place)
            body = ok(pin(down, seats(req)[0]["id"], name), 201)
            assert body["seat"]["status"] == "offered" and body["offer"]["email"] == "queued"
            [mine] = [o for o in ok(api(down, KEY[name]).get("/api/interpreters/me/assignments"))["offers"]
                      if o["request"]["id"] == req["id"]]
            assert ok(answer(down, mine["token"]))["request"]["status"] == "staffed"
            staffed = f"Staffed: {req['ref']} on {agency_date(req['start'])}"
            quiet(mail, EMAIL[KEY[name]], offer_subject(req), needle=place, seconds=RETRY_S + MAIL_DELIVERY_S, skip=seen)
            assert not mails_now(mail, EMAIL["joel"], staffed, needle=name, skip=seen)
            assert seats(get_req(down, req["id"]))[0]["offer"]["email"] == "queued"
        with spawned(DATABASE_URL=db) as up:
            offers = mails(mail, EMAIL[KEY[name]], offer_subject(req), needle=place, skip=seen)
            assert len(offers) == 1 and token_of(offers[0]) == mine["token"]
            assert re.fullmatch(r"<?outbox-.+@fernhollow\.test>?", offers[0].get("MessageID") or "")
            assert len(mails(mail, EMAIL["joel"], staffed, needle=name, skip=seen)) == 1
            window = time.monotonic() + RETRY_S
            while time.monotonic() < window:
                assert len(mails_now(mail, EMAIL[KEY[name]], offer_subject(req), place, seen)) == 1
                assert len(mails_now(mail, EMAIL["joel"], staffed, name, seen)) == 1
            eventually(lambda: seats(get_req(up, req["id"]))[0]["offer"]["email"] == "sent", "offer email marked sent")


def test_secrets_never_exposed(app_url, mail):
    values = protected_values()
    shell = httpx.get(f"{app_url}/board", timeout=HTTP_TIMEOUT).text
    bodies = [shell]
    for asset in set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', shell)):
        js = httpx.get(app_url + asset, timeout=HTTP_TIMEOUT).text
        bodies.append(js)
        for chunk in set(re.findall(r'["\'](/?assets/[^"\']+\.js)["\']', js)):
            bodies.append(httpx.get(f"{app_url}/{chunk.lstrip('/')}", timeout=HTTP_TIMEOUT).text)
    bodies += [httpx.get(f"{app_url}{p}", timeout=HTTP_TIMEOUT).text for p in ("/api/health", "/api/system/status", "/api/nope")]
    bodies += [api(app_url, "rowan").get("/api/board").text, api(app_url, "joel").get("/api/requests").text,
               httpx.post(f"{app_url}/api/session", content=b"{", headers={"Content-Type": "application/json"}).text]
    for down in ("APP_KILLBILL_DOWN_URL", "APP_MAILPIT_DOWN_URL"):
        bodies.append(httpx.get(f"{os.environ[down]}/api/system/status", timeout=HTTP_TIMEOUT).text)
        bodies.append(api(os.environ[down], "joel").get(f"/api/orgs/{ORG['joel']}/invoices").text)
    bodies += [text(m) for m in mail.messages()]
    assert len(bodies) > 5
    for value in values:
        assert not any(value in b for b in bodies), "a protected value leaked"


def test_wf_access_landing(browser, app_url):
    landing = {"joel": "/requests", "rowan": "/board", "sam": "/me", "marcus": "/preferences", "marguerite": "/billing"}
    for who, path in landing.items():
        with entered(open_app(browser, f"{app_url}/signin")) as page:
            ui_login(page, app_url, who)
            wait_for(page, lambda: page.url.endswith(path), why=path)
            assert page.get_by_role("navigation", name="Main").count() == 1
            assert page.get_by_role("status", name="Service status").count() == 1
            click(page.get_by_role("button", name="Sign out"))
            wait_for(page, lambda: "/signin" in page.url, why="signin after sign out")
            page.goto(f"{app_url}{path}")
            wait_for(page, lambda: "/signin" in page.url, why="redirect when signed out")
            fails(page.context.request and httpx.get(f"{app_url}/api/me"), 401, "unauthenticated")


def test_wf_access_invalid(browser, app_url):
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        fill(page.get_by_role("textbox", name="Email"), EMAIL["joel"])
        fill(page.get_by_role("textbox", name="Passcode"), "not-the-passcode")
        with entered(held(page, "**/api/session")) as hold:
            click(page.get_by_role("button", name="Sign in"))
            shows(page, status(page, "Sign-in status"), "Signing in…")
            hold.release()
        shows(page, status(page, "Sign-in status"), "That email and passcode do not match.")
        assert "/signin" in page.url
        fill(page.get_by_role("textbox", name="Passcode"), PASSCODE)
        click(page.get_by_role("button", name="Sign in"))
        wait_for(page, lambda: page.url.endswith("/requests"), why="landing")
        cookies = {c["name"]: c for c in page.context.cookies()}
        assert cookies["sw_session"]["httpOnly"] is True


def test_wf_request_intake_happy(browser, app_url):
    start = (server_now(app_url) + timedelta(days=1)).astimezone(TZ).replace(hour=14, minute=random.randint(0, 59), second=0, microsecond=0)
    title = unique("Intake")[0]
    fname = f"{unique('agenda')[0]}.pdf"
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        click(page.get_by_role("link", name="New request"))
        form = page.get_by_role("form", name="New request")
        wait_for(page, lambda: form.count() > 0, why="form")
        fill(form.get_by_role("textbox", name="Title"), title)
        select(form.get_by_role("combobox", name="Setting"), "Medical")
        fill(form.get_by_role("textbox", name="Location"), "Room 4")
        fill(form.get_by_role("textbox", name="Start"), ui_dt(start))
        fill(form.get_by_role("textbox", name="End"), ui_dt(start + timedelta(hours=1)))
        select(form.get_by_role("combobox", name="Deaf consumer"), "Marcus Tull")
        with entered(held(page, "**/api/requests")) as hold:
            click(form.get_by_role("button", name="Save draft"))
            shows(page, status(page, "Request status"), "Saving…")
            hold.release()
        shows(page, status(page, "Request status"), " saved.")
        ref = re.search(r"Draft (FA-\d+) saved\.", status(page, "Request status").inner_text()).group(1)
        with page.expect_file_chooser() as fc:
            click(page.get_by_role("button", name="Add prep file"))
        fc.value.set_files({"name": fname, "mimeType": "application/pdf", "buffer": PDF})
        shows(page, status(page, "Request status"), f"{fname} attached.")
        click(page.get_by_role("button", name="Submit request"))
        shows(page, status(page, "Request status"), f"{ref} submitted to dispatch.")
        shows(page, page.get_by_role("list", name="Prep materials"), fname)
        body = page.locator("body")
        wait_for(page, lambda: "submitted" in body.inner_text() and "0/1" in body.inner_text(), why="status and seats")
    req = next(r for r in ok(api(app_url, "joel").get("/api/requests"))["requests"] if r["ref"] == ref)
    assert (req["title"], req["status"], req["seats_total"], req["seats_claimed"]) == (title, "submitted", 1, 0)
    [f] = req["prep_files"]
    assert bucket().get(f"prep/birchmere-clinic/{req['id']}/{f['id']}/{fname}") == PDF
    assert ref in [r["ref"] for r in ok(api(app_url, "rowan").get("/api/board"))["requests"]]


def test_wf_request_intake_validation(browser, app_url):
    start = at(app_url, FAR_LO_H, FAR_HI_H)
    title = unique("Fixed")[0]
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        page.goto(f"{app_url}/requests/new")
        form = page.get_by_role("form", name="New request")
        wait_for(page, lambda: form.count() > 0, why="form")
        select(form.get_by_role("combobox", name="Setting"), "Community")
        fill(form.get_by_role("textbox", name="Location"), HALL)
        fill(form.get_by_role("textbox", name="Start"), ui_dt(start))
        fill(form.get_by_role("textbox", name="End"), ui_dt(start + timedelta(hours=1)))
        select(form.get_by_role("combobox", name="Deaf consumer"), "Bea Lindqvist")
        click(form.get_by_role("button", name="Save draft"))
        shows(page, status(page, "Request status"), "Check the highlighted fields.")
        assert not [r for r in ok(api(app_url, "joel").get("/api/requests"))["requests"] if r["location"] == HALL and r["start"] and parse(r["start"]) == start]
        fill(form.get_by_role("textbox", name="Title"), title)
        click(form.get_by_role("button", name="Save draft"))
        shows(page, status(page, "Request status"), " saved.")
    saved = [r for r in ok(api(app_url, "joel").get("/api/requests"))["requests"] if r["title"] == title]
    assert len(saved) == 1 and saved[0]["status"] == "draft" and saved[0]["setting"] == "community"


def test_wf_gate_thread_recoil(browser, app_url):
    req = make(app_url, start=at(app_url, NEAR_LO_H, NEAR_HI_H))
    with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
        open_board(page, app_url, req)
        grab(page, "Noor Haddad", card(page, req))
        wait_for(page, lambda: resolved(page, req) == 4, why="pips")
        assert pip_states(page, req)[0] == "pass" and pip_states(page, req)[3] == "fail"
        page.mouse.up()
        shows(page, card(page, req), "Bea Lindqvist has blocked this interpreter.")
    after = get_req(app_url, req["id"])
    assert seats(after)[0]["status"] == "open" and audit(app_url, req["id"])[-1]["action"] == "request.submitted"


def test_wf_gate_thread_pin(browser, app_url, mail):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
        open_board(page, app_url, req)
        grab(page, name, card(page, req))
        wait_for(page, lambda: pip_states(page, req) == ["pass"] * 4, why="four passing pips")
        with entered(held(page, "**/offers")) as hold:
            page.mouse.up()
            shows(page, status(page, "Board status"), f"Offering {req['ref']} seat 1 to {name}…")
            hold.release()
        shows(page, status(page, "Board status"), f"Offered {req['ref']} seat 1 to {name}.")
        shows(page, card(page, req), "1/1")
        detail = page.get_by_role("region", name="Request detail")
        shows(page, detail, name)
        shows(page, detail, "Rowan Ilsley")
    seat = seats(get_req(app_url, req["id"]))[0]
    assert (seat["status"], seat["interpreter"]["name"], seat["held_by"]["name"]) == ("offered", name, "Rowan Ilsley")
    assert len(offer_tokens(mail, req, name)) == 1


def test_wf_offer_response_accept(browser, app_url, mail):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    ok(api(app_url, "joel").post(f"/api/requests/{req['id']}/prep", files={"file": (PREP_NAME, PDF, "application/pdf")}), 201)
    ok(pin(app_url, seats(req)[0]["id"], name), 201)
    tok = offer_tokens(mail, req, name)[0]
    with entered(open_app(browser, f"{app_url}/offers/{tok}")) as page:
        wait_for(page, lambda: page.get_by_role("heading", name=f"Offer for {req['ref']}").count() > 0, why="offer heading")
        with entered(held(page, "**/accept")) as hold:
            click(page.get_by_role("button", name="Accept offer"))
            shows(page, status(page, "Offer status"), "Sending your answer…")
            assert page.get_by_role("button", name="Decline offer").is_disabled()
            hold.release()
        shows(page, status(page, "Offer status"), f"Accepted. {req['ref']} is on your schedule.")
        wait_for(page, lambda: page.get_by_role("button", name="Accept offer").count() == 0, why="buttons replaced")
        ui_login(page, app_url, KEY[name])
        mine = page.get_by_role("region", name="My assignments")
        shows(page, mine, req["ref"])
        assert mine.get_by_role("link", name=PREP_NAME).count() == 1
    assert get_req(app_url, req["id"])["status"] == "staffed"
    assert len(mails(mail, EMAIL["joel"], f"Staffed: {req['ref']} on {agency_date(req['start'])}")) == 1


def test_wf_offer_response_decline(browser, app_url, mail):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    ok(pin(app_url, seats(req)[0]["id"], name), 201)
    tok = offer_tokens(mail, req, name)[0]
    with entered(open_app(browser, f"{app_url}/offers/{tok}")) as page:
        wait_for(page, lambda: page.get_by_role("button", name="Decline offer").count() > 0, why="decline button")
        click(page.get_by_role("button", name="Decline offer"))
        shows(page, status(page, "Offer status"), "Declined. The seat goes back to dispatch.")
        page.reload()
        shows(page, page.locator("body"), f"Offer for {req['ref']}")
        assert page.get_by_role("button", name="Accept offer").count() == 0
    assert seats(get_req(app_url, req["id"]))[0]["status"] == "open"
    assert fails(answer(app_url, tok), 410, "offer_closed")["offer_status"] == "declined"


def test_wf_team_staffing_fill(browser, app_url, mail):
    req, names = ready(app_url, LEGAL_OK, n=2, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H, setting="legal", who="anita",
                       org="kestrel-court", consumer="Marcus Tull")
    with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
        open_board(page, app_url, req)
        for i, name in enumerate(names, start=1):
            grab(page, name, card(page, req))
            wait_for(page, lambda: pip_states(page, req) == ["pass"] * 4, why="passing pips")
            page.mouse.up()
            shows(page, status(page, "Board status"), f"Offered {req['ref']} seat {i} to {name}.")
        shows(page, card(page, req), "2/2")
        for name in names:
            with entered(open_app(browser, f"{app_url}/offers/{offer_tokens(mail, req, name)[0]}")) as offer:
                wait_for(offer, lambda: offer.get_by_role("button", name="Accept offer").count() > 0, why="accept")
                click(offer.get_by_role("button", name="Accept offer"))
                shows(offer, status(offer, "Offer status"), f"Accepted. {req['ref']} is on your schedule.")
        assert get_req(app_url, req["id"])["status"] == "staffed"
        page.reload()
        click(card(page, req))
        detail = page.get_by_role("region", name="Request detail")
        wait_for(page, lambda: detail.inner_text().count("accepted") >= 2 or "staffed" in detail.inner_text(), why="staffed detail")
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "anita")
        page.goto(f"{app_url}/requests/{req['id']}")
        wait_for(page, lambda: re.search(r"(?<!partially_)staffed", page.locator("body").inner_text()) is not None, why="staffed")
    assert len(mails(mail, EMAIL["anita"], f"Staffed: {req['ref']} on {agency_date(req['start'])}")) == 1


def test_wf_team_staffing_partial(browser, app_url, mail):
    req, names = ready(app_url, LEGAL_OK, n=1, lo_h=FAR_LO_H, hi_h=FAR_HI_H, setting="legal")
    ok(pin(app_url, seats(req)[0]["id"], names[0]), 201)
    ok(answer(app_url, active_token(app_url, mail, req, names[0])))
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        page.goto(f"{app_url}/requests/{req['id']}")
        shows(page, page.locator("body"), "partially_staffed")
        shows(page, page.get_by_role("list", name="Seats"), names[0])
    assert get_req(app_url, req["id"], "joel")["status"] == "partially_staffed"


def test_wf_cancellation_late(browser, app_url, mail):
    rate = rates(app_url)["legal"]
    req, names = ready(app_url, LEGAL_OK, n=2, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H, setting="legal", who="anita", org="kestrel-court")
    staff(app_url, mail, req, names)
    fee = money(Decimal("2.00") * Decimal(rate) * 2)
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "anita")
        page.goto(f"{app_url}/requests/{req['id']}")
        click(page.get_by_role("button", name="Cancel request"))
        dialog = page.get_by_role("dialog", name="Cancel request")
        shows(page, dialog, f"Late cancellation. ${fee} will be charged for 2 seated interpreter(s).")
        with entered(held(page, "**/cancel")) as hold:
            click(dialog.get_by_role("button", name="Confirm cancellation"))
            shows(page, status(page, "Cancellation status"), f"Cancelling {req['ref']}…")
            hold.release()
        shows(page, status(page, "Cancellation status"), f"{req['ref']} cancelled. Charge: ${fee}.")
        shows(page, page.locator("body"), "cancelled_late")
    after = get_req(app_url, req["id"], "anita")
    assert (after["status"], after["cancellation_fee"]) == ("cancelled_late", fee)
    assert [i["amount"] for i in items(app_url, "kestrel-court", f"[cx-{req['id']}]")] == [fee]
    for name in names:
        assert len(mails(mail, EMAIL[KEY[name]], f"Cancelled: {req['ref']} on {agency_date(req['start'])}")) == 1


def test_wf_cancellation_on_time(browser, app_url):
    req = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H))
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        page.goto(f"{app_url}/requests/{req['id']}")
        click(page.get_by_role("button", name="Cancel request"))
        dialog = page.get_by_role("dialog", name="Cancel request")
        shows(page, dialog, "On-time cancellation. No charge.")
        click(dialog.get_by_role("button", name="Confirm cancellation"))
        shows(page, status(page, "Cancellation status"), f"{req['ref']} cancelled. Charge: $0.00.")
        shows(page, page.locator("body"), "cancelled_on_time")
    assert get_req(app_url, req["id"], "joel")["status"] == "cancelled_on_time"
    assert items(app_url, "birchmere-clinic", f"[cx-{req['id']}]") == []


def test_wf_timesheet_billing_approve(browser, app_url, mail):
    req, name, ts = worked(app_url, mail)
    amount = money(Decimal(ts["billed_hours"]) * Decimal(rates(app_url)["medical"]))
    button = f"Approve {req['ref']} for {name}"
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "marguerite")
        queue = page.get_by_role("table", name="Timesheets awaiting approval")
        wait_for(page, lambda: queue.get_by_role("button", name=button).count() > 0, why="queue row")
        with entered(held(page, "**/approve")) as hold:
            click(queue.get_by_role("button", name=button))
            shows(page, status(page, "Billing status"), "Approving…")
            hold.release()
        shows(page, status(page, "Billing status"), f"Approved {req['ref']} for {name}: ${amount}.")
        wait_for(page, lambda: queue.get_by_role("button", name=button).count() == 0, why="row leaves queue")
        page.goto(f"{app_url}/invoices")
        select(page.get_by_role("combobox", name="Organisation"), "Birchmere Community Clinic")
        invoices = page.get_by_role("table", name="Invoices")
        wait_for(page, lambda: invoices.count() > 0 and req["ref"] in invoices.inner_text(), why="invoice line")
        assert amount in invoices.inner_text()
        shows(page, status(page, "Invoice status"), " invoice(s), total $")
    assert [i["amount"] for i in items(app_url, "birchmere-clinic", f"[ts-{ts['id']}]")] == [amount]


def test_wf_timesheet_billing_submit(browser, app_url, mail):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-4, logged_after=True)
    staff(app_url, mail, req, [name])
    start = parse(req["start"])
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, KEY[name])
        click(page.get_by_role("button", name=f"Submit timesheet for {req['ref']}"))
        dialog = page.get_by_role("dialog", name=f"Timesheet for {req['ref']}")
        fill(dialog.get_by_role("textbox", name="Actual start"), ui_dt(start))
        fill(dialog.get_by_role("textbox", name="Actual end"), ui_dt(start + timedelta(minutes=70)))
        fill(dialog.get_by_role("textbox", name="Signature name"), name)
        click(dialog.get_by_role("button", name="Sign and submit"))
        shows(page, status(page, "Timesheet status"), f"Timesheet for {req['ref']} submitted: 2.00 billed hours.")
    listed = ok(api(app_url, "marguerite").get("/api/timesheets", params={"status": "submitted"}))["timesheets"]
    assert any(t["request_id"] == req["id"] and t["billed_hours"] == "2.00" for t in listed)


def test_wf_credentials_add(browser, app_url):
    d0 = server_now(app_url).astimezone(TZ).date()
    expiry = str(d0 + timedelta(days=90))
    number = unique("N")[0][:40]
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "theo")
        click(page.get_by_role("button", name="Add credential"))
        dialog = page.get_by_role("dialog", name="Add credential")
        select(dialog.get_by_role("combobox", name="Credential type"), "NIC")
        fill(dialog.get_by_role("textbox", name="Credential number"), number)
        fill(dialog.get_by_role("textbox", name="Expires on"), expiry)
        with page.expect_file_chooser() as fc:
            click(dialog.get_by_role("button", name="Choose scan"))
        fc.value.set_files({"name": "card.png", "mimeType": "image/png", "buffer": PNG})
        click(dialog.get_by_role("button", name="Save credential"))
        shows(page, status(page, "Credential status"), f"NIC saved, valid through {expiry}.")
        shows(page, page.get_by_role("region", name="My credentials"), number)
    cred = next(c for c in ok(api(app_url, "theo").get("/api/interpreters/me/credentials"))["credentials"] if c["number"] == number)
    assert bucket().get(f"credentials/{iid(app_url, 'Theo Marchetti')}/{cred['id']}/card.png") == PNG


def test_wf_credentials_validation(browser, app_url):
    number = unique("N")[0][:40]
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "theo")
        click(page.get_by_role("button", name="Add credential"))
        dialog = page.get_by_role("dialog", name="Add credential")
        select(dialog.get_by_role("combobox", name="Credential type"), "NIC")
        fill(dialog.get_by_role("textbox", name="Credential number"), number)
        fill(dialog.get_by_role("textbox", name="Expires on"), "not-a-date")
        with page.expect_file_chooser() as fc:
            click(dialog.get_by_role("button", name="Choose scan"))
        fc.value.set_files({"name": "card.png", "mimeType": "image/png", "buffer": PNG})
        click(dialog.get_by_role("button", name="Save credential"))
        shows(page, status(page, "Credential status"), "Check the highlighted fields.")
    assert number not in {c["number"] for c in ok(api(app_url, "theo").get("/api/interpreters/me/credentials"))["credentials"]}


def test_wf_consumer_preferences_block(browser, app_url):
    req, _ = ready(app_url, ["Dana Okafor"], lo_h=NEAR_LO_H, hi_h=NEAR_HI_H, setting="community", consumer="Marcus Tull")
    try:
        with entered(open_app(browser, f"{app_url}/signin")) as page:
            ui_login(page, app_url, "marcus")
            table = page.get_by_role("table", name="Interpreter preferences")
            wait_for(page, lambda: table.get_by_role("radiogroup", name="Dana Okafor").count() > 0, why="rows")
            check(table.get_by_role("radiogroup", name="Dana Okafor").get_by_role("radio", name="Blocked"))
            with entered(held(page, "**/preferences")) as hold:
                click(page.get_by_role("button", name="Save preferences"))
                shows(page, status(page, "Preferences status"), "Saving preferences…")
                hold.release()
            shows(page, status(page, "Preferences status"), "Preferences saved.")
        assert ok(api(app_url, "rowan").get(f"/api/consumers/{cid(app_url, 'Marcus Tull')}/preferences"))["blocked"] == [iid(app_url, "Dana Okafor")]
        with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
            open_board(page, app_url, req)
            grab(page, "Dana Okafor", card(page, req))
            wait_for(page, lambda: resolved(page, req) == 4, why="pips")
            assert pip_states(page, req)[3] == "fail"
            page.mouse.up()
            shows(page, card(page, req), "Marcus Tull has blocked this interpreter.")
        assert seats(get_req(app_url, req["id"]))[0]["status"] == "open"
    finally:
        ok(put_prefs(app_url, "marcus", [], []))


def test_wf_consumer_preferences_preferred(browser, app_url):
    try:
        with entered(open_app(browser, f"{app_url}/signin")) as page:
            ui_login(page, app_url, "marcus")
            group = page.get_by_role("table", name="Interpreter preferences").get_by_role("radiogroup", name="Theo Marchetti")
            wait_for(page, lambda: group.count() > 0, why="row")
            check(group.get_by_role("radio", name="Preferred"))
            click(page.get_by_role("button", name="Save preferences"))
            shows(page, status(page, "Preferences status"), "Preferences saved.")
            page.reload()
            wait_for(page, lambda: group.get_by_role("radio", name="Preferred").count() > 0, why="reloaded")
            assert group.get_by_role("radio", name="Preferred").is_checked()
        seen = ok(api(app_url, "rowan").get(f"/api/consumers/{cid(app_url, 'Marcus Tull')}/preferences"))
        assert seen["preferred"] == [iid(app_url, "Theo Marchetti")] and seen["blocked"] == []
    finally:
        ok(put_prefs(app_url, "marcus", [], []))


def test_wf_tenant_isolation_list(browser, app_url):
    mine = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H))
    theirs = make(app_url, who="anita", start=at(app_url, FAR_LO_H, FAR_HI_H), org="kestrel-court")
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        table = page.get_by_role("table", name="Requests")
        wait_for(page, lambda: table.get_by_role("link", name=mine["ref"]).count() > 0, why="own row")
        assert table.get_by_role("link", name=theirs["ref"]).count() == 0
        page.goto(f"{app_url}/requests/{theirs['id']}")
        page.wait_for_load_state("networkidle")
        wait_for(page, lambda: page.get_by_role("navigation", name="Main").count() > 0, why="shell")
        assert theirs["title"] not in page.locator("body").inner_text()
    fails(api(app_url, "joel").get(f"/api/requests/{theirs['id']}"), 404, "not_found")


def test_wf_tenant_isolation_prep(browser, app_url, mail):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    fid = ok(api(app_url, "joel").post(f"/api/requests/{req['id']}/prep", files={"file": (SEAT_PREP_NAME, PDF, "application/pdf")}), 201)["file"]["id"]
    staff(app_url, mail, req, [name])
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, KEY[name])
        mine = page.get_by_role("region", name="My assignments")
        shows(page, mine, req["ref"])
        link = mine.get_by_role("link", name=SEAT_PREP_NAME)
        assert link.count() == 1
        assert api(app_url, KEY[name]).get(f"/api/prep/{fid}").content == PDF
        ok(cancel(app_url, req["id"], "0.00"))
        page.reload()
        wait_for(page, lambda: mine.count() > 0, why="reloaded")
        page.wait_for_load_state("networkidle")
        assert req["ref"] not in mine.inner_text()
    fails(api(app_url, KEY[name]).get(f"/api/prep/{fid}"), 404, "not_found")


def test_wf_outages_killbill(browser, app_url, mail):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    req, name, ts = worked(app_url, mail)
    with entered(open_app(browser, f"{down}/signin")) as page:
        ui_login(page, down, "marguerite")
        shows(page, status(page, "Service status"), "Billing is unreachable. Approvals, charged cancellations and invoices are paused.")
        button = page.get_by_role("button", name=f"Approve {req['ref']} for {name}")
        wait_for(page, lambda: button.count() > 0, why="queue row")
        click(button)
        shows(page, status(page, "Billing status"), "Billing is unreachable. The timesheet is not approved. Try again in a few minutes.")
        page.goto(f"{down}/invoices")
        select(page.get_by_role("combobox", name="Organisation"), "Birchmere Community Clinic")
        shows(page, status(page, "Invoice status"), "Billing is unreachable, so invoices cannot be shown right now.")
    listed = ok(api(app_url, "marguerite").get("/api/timesheets", params={"status": "submitted"}))["timesheets"]
    assert any(t["id"] == ts["id"] for t in listed)
    assert bucket().keys(f"timesheets/{req['id']}/") == []


def test_wf_outages_mail(browser, app_url, mail):
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
    ok(pin(app_url, seats(req)[0]["id"], name), 201)
    tok = offer_tokens(mail, req, name)[0]
    with entered(open_app(browser, f"{down}/signin")) as page:
        ui_login(page, down, "joel")
        shows(page, status(page, "Service status"), "Mail is unreachable. Emails are queued and send automatically when it returns.")
        page.goto(f"{down}/offers/{tok}")
        wait_for(page, lambda: page.get_by_role("button", name="Accept offer").count() > 0, why="accept")
        click(page.get_by_role("button", name="Accept offer"))
        shows(page, status(page, "Offer status"), f"Accepted. {req['ref']} is on your schedule.")
    subject = f"Staffed: {req['ref']} on {agency_date(req['start'])}"
    assert len(mails(mail, EMAIL["joel"], subject)) == 1
    quiet(mail, EMAIL["joel"], "Staffed: none", seconds=MAIL_DELIVERY_S)
    assert len(mails_now(mail, EMAIL["joel"], subject)) == 1


def test_wf_cross_cutting_layout(browser, app_url, mail):
    req, [oname] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    ok(pin(app_url, seats(req)[0]["id"], oname), 201)
    tok = offer_tokens(mail, req, oname)[0]
    with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
        open_board(page, app_url, req)
        for w, h in VIEWPORTS:
            page.set_viewport_size({"width": w, "height": h})
            page.goto(f"{app_url}/board")
            wait_for(page, lambda: page.get_by_role("list", name="Interpreters").count() > 0, why="board")
            layout(page)
            rail = page.get_by_role("list", name="Interpreters").bounding_box()
            if w < NARROW_PX:
                tabs = page.get_by_role("tablist", name="Board views")
                assert tabs.is_visible() and tabs.get_by_role("tab", name="Requests").count() == 1
                assert rail["y"] + rail["height"] <= h + 1 and rail["y"] >= h / 2
                wait_for(page, lambda: card(page, req).count() > 0, why="card")
                card(page, req).scroll_into_view_if_needed()
                click(card(page, req))
                wait_for(page, lambda: tabs.get_by_role("tab", name="Detail").get_attribute("aria-selected") == "true", why="detail tab")
                assert page.get_by_role("region", name="Request detail").is_visible()
                layout(page)
            else:
                assert page.get_by_role("tablist", name="Board views").count() == 0 or not page.get_by_role("tablist", name="Board views").is_visible()
                mid = page.get_by_role("region", name="Requests, next 72 hours").bounding_box()
                side = page.get_by_role("region", name="Request detail").bounding_box()
                assert rail["x"] < mid["x"] < side["x"]
    screens = {
        "joel": [("/requests", "table", "Requests"), ("/requests/new", "form", "New request"),
                 (f"/requests/{req['id']}", "list", "Seats"), ("/invoices", "status", "Invoice status")],
        "sam": [("/me", "region", "My assignments")],
        "marcus": [("/preferences", "table", "Interpreter preferences")],
        "marguerite": [("/billing", "region", "Rates"), ("/invoices", "combobox", "Organisation")],
        "": [(f"/offers/{tok}", "heading", f"Offer for {req['ref']}")],
    }
    for who, views in screens.items():
        with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
            if who:
                ui_login(page, app_url, who)
            for w, h in VIEWPORTS:
                page.set_viewport_size({"width": w, "height": h})
                for path, role, label in views:
                    page.goto(app_url + path)
                    landmark = page.get_by_role(role, name=label)
                    wait_for(page, lambda: landmark.count() > 0, why=f"{path} as {who or 'link holder'}")
                    assert page.url.endswith(path), page.url
                    layout(page)


def test_wf_cross_cutting_keyboard(browser, app_url):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
        open_board(page, app_url, req)
        c, target = chip(page, name), card(page, req)
        for _ in range(TAB_LIMIT):
            if focused(c):
                break
            page.keyboard.press("Tab")
        assert focused(c), "Tab never reached the chip"
        page.keyboard.press("Enter")
        wait_for(page, lambda: c.get_attribute("aria-pressed") == "true", why="chip pressed")
        page.keyboard.press("Escape")
        wait_for(page, lambda: focused(c) and c.get_attribute("aria-pressed") != "true", why="dropped")
        with entered(held(page, "**/dry-run")) as hold:
            page.keyboard.press("Enter")
            quiesce(page)
            film = Film(page)
            for _ in range(TAB_LIMIT):
                if focused(target):
                    break
                page.keyboard.press("ArrowDown")
            assert focused(target), "arrows never reached the card"
            assert resolved(page, req) == 0
            pips = pip_film(page, film, req, hold.release)
        assert len(set(pips["first"])) == 1, f"reduced-motion pips must change together: {pips}"
        shows(page, status(page, "Gate results"),
              f"{req['ref']} seat 1: Credential pass, Valid on date pass, Schedule pass, Consumer pass.")
        pinned = pin_film(page, film, req, name, lambda: page.keyboard.press("Enter"))
        assert pinned["glyph"] and not pinned["rolled"], "the counter numeral must swap without rolling"
        shows(page, card(page, req), "1/1")
        wait_for(page, lambda: focused(c), why="focus back on chip")
        th = thread_film(page, film, name)
        for p in th["paths"]:
            assert deviation(p) <= STRAIGHT_TOL, "the reduced-motion thread is a straight line"
        assert th["gone"] <= FRAME_MS and not th["retracting"], "the line must disappear at once"
    assert seats(get_req(app_url, req["id"]))[0]["status"] == "offered"


def test_wf_cross_cutting_motion(browser, app_url):
    req, [name] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        open_board(page, app_url, req)
        quiesce(page)
        film = Film(page)
        th = thread_film(page, film, name)
        for p, (dx, dy) in zip(th["paths"], th["dests"]):
            ex = max(p)
            assert abs(ex - dx) <= POINTER_TOL and abs(p[ex] - dy) <= POINTER_TOL, "the thread must end at the pointer"
            assert len(p) >= (dx - th["left"]) * COVER, "the thread must run from the chip to the pointer"
        assert th["gone"] <= RECOIL_MAX_MS + FRAME_MS, th["gone"]
        mid = [r for r in th["retracting"] if th["left"] + EDGE < r[1] < th["dests"][-1][0] - POINTER_TOL]
        assert all(on and height <= 2 * PATH_TOL for _, _, height, on in mid), "the recoil must follow the thread's own path"
        target = card(page, req)
        target.scroll_into_view_if_needed()
        kb = target.bounding_box()
        sb = target.get_by_role("button", name=f"Seat 1 of 1 for {req['ref']}").bounding_box()
        px = kb["x"] + MARGIN if sb["x"] + sb["width"] / 2 > kb["x"] + kb["width"] / 2 else kb["x"] + kb["width"] - MARGIN
        py = kb["y"] + MARGIN if sb["y"] + sb["height"] / 2 > kb["y"] + kb["height"] / 2 else kb["y"] + kb["height"] - MARGIN
        page.mouse.move(px, py)
        for _ in range(STOP_FRAMES):
            film.step()
        bare = film.shot(pin_box(page, req, name))
        with entered(held(page, "**/dry-run")) as hold:
            page.mouse.move(*center(chip(page, name)))
            page.mouse.down()
            page.mouse.move(px, py, steps=8)
            wait_for(page, lambda: "Checking gates" in status(page, "Gate results").inner_text(), why="dry-run pending")
            pips = pip_film(page, film, req, hold.release)
        first = pips["first"]
        assert first == sorted(first) and first[3] > first[0], f"pips must resolve left to right in a stagger: {pips}"
        assert pips["settle"] <= PIP_SETTLE_MS + FRAME_MS, pips
        assert pip_states(page, req) == ["pass"] * 4
        pinned = pin_film(page, film, req, name, page.mouse.up, bare=bare)
        assert pinned["glyph"] and pinned["rolled"], "the counter numeral must slide vertically, not only swap or fade"
        assert pinned["roll_span"] <= PIN_MAX_MS + FRAME_MS, f"the counter must settle within a quarter second: {pinned['roll_span']}"
        sock, path = pinned["socket"], pinned["thread"]
        start = pinned["start"] or (px, py)
        at_socket = lambda e: e is not None and inside(sock, e[0], e[1], POINTER_TOL)
        hits = [t for t, e in path if at_socket(e)]
        assert hits, f"the thread must pin to the seat socket: {path}"
        moving = [t for t, e in path if e is None or math.dist(e, start) > POINTER_TOL]
        between = [t for t, e in path if t < hits[0] and e is not None and math.dist(e, start) > POINTER_TOL]
        assert between or hits[0] <= FRAME_MS, f"the thread must spring to the socket, not snap: {path}"
        late = [t for t, e in path if t > hits[0] and e is not None and not at_socket(e)]
        assert max(late, default=hits[0]) - moving[0] <= PIN_MAX_MS + FRAME_MS, f"the pin must settle within a quarter second: {path}"
        shows(page, card(page, req), "1/1")
    assert seats(get_req(app_url, req["id"]))[0]["status"] == "offered"


def test_wf_cross_cutting_feedback(browser, app_url, mail):
    taken = make(app_url, start=at(app_url, NEAR_LO_H, NEAR_HI_H))
    holder = next(n for n in MEDICAL_OK if ok(dry(app_url, seats(taken)[0]["id"], n))["all_pass"])
    ok(pin(app_url, seats(taken)[0]["id"], holder, "priya"), 201)
    with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
        open_board(page, app_url, taken)
        gates = status(page, "Gate results")
        live(gates)
        live(status(page, "Board status"))
        with entered(held(page, "**/dry-run")) as hold:
            grab(page, "Lior Feld", card(page, taken))
            shows(page, gates, f"Checking gates for {taken['ref']} seat 1…")
            hold.release()
        shows(page, gates, f"Seat taken by {NAME['priya']}.")
        page.mouse.up()
        shows(page, card(page, taken), f"Seat taken by {NAME['priya']}.")
    assert seats(get_req(app_url, taken["id"]))[0]["held_by"]["name"] == NAME["priya"]
    draft = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), submit=False)
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        page.goto(f"{app_url}/requests/{draft['id']}")
        add = page.get_by_role("button", name="Add prep file")
        wait_for(page, lambda: add.count() > 0, why="request detail")
        rs = status(page, "Request status")
        live(rs)
        with entered(held(page, "**/prep")) as hold:
            with page.expect_file_chooser() as fc:
                click(add)
            fc.value.set_files({"name": PREP_NAME, "mimeType": "application/pdf", "buffer": PDF})
            shows(page, rs, f"Uploading {PREP_NAME}…")
            hold.release()
        shows(page, rs, f"{PREP_NAME} attached.")
        with page.expect_file_chooser() as fc:
            click(add)
        fc.value.set_files({"name": EXE_NAME, "mimeType": "application/octet-stream", "buffer": EXE})
        shows(page, rs, f"{EXE_NAME} is not a supported file type.")
    assert [p["filename"] for p in get_req(app_url, draft["id"], "joel")["prep_files"]] == [PREP_NAME]
    late, [ln] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    staff(app_url, mail, late, [ln])
    original = rates(app_url)
    try:
        with entered(open_app(browser, f"{app_url}/signin")) as page:
            ui_login(page, app_url, "joel")
            page.goto(f"{app_url}/requests/{late['id']}")
            click(page.get_by_role("button", name="Cancel request"))
            dialog = page.get_by_role("dialog", name="Cancel request")
            shows(page, dialog, "Late cancellation. $")
            ok(api(app_url, "marguerite").put("/api/rates", json={"medical": PROBE_RATE}))
            click(dialog.get_by_role("button", name="Confirm cancellation"))
            cs = status(page, "Cancellation status")
            live(cs)
            new_fee = money(Decimal("2.00") * Decimal(PROBE_RATE))
            shows(page, cs, f"The charge is now ${new_fee}. Review it and confirm again.")
            click(dialog.get_by_role("button", name="Keep request"))
    finally:
        ok(api(app_url, "marguerite").put("/api/rates", json=original))
    assert get_req(app_url, late["id"], "joel")["status"] == "staffed"
    assert items(app_url, "birchmere-clinic", f"[cx-{late['id']}]") == []
    current = rates(app_url)["medical"]
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "marguerite")
        region = page.get_by_role("region", name="Rates")
        field = region.get_by_role("textbox", name="Medical hourly rate")
        wait_for(page, lambda: field.count() > 0, why="rates form")
        fill(field, current)
        with entered(held(page, "**/api/rates")) as hold:
            click(region.get_by_role("button", name="Save rates"))
            shows(page, status(page, "Billing status"), "Saving rates…")
            hold.release()
        shows(page, status(page, "Billing status"), "Rates saved. They apply to approvals and cancellations from now on.")
        live(status(page, "Billing status"))
        fill(field, "0.00")
        click(region.get_by_role("button", name="Save rates"))
        shows(page, status(page, "Billing status"), "Check the highlighted fields.")
    assert rates(app_url)["medical"] == current


def test_feedback_timeouts_and_outages(browser, app_url, mail):
    req = make(app_url, start=at(app_url, NEAR_LO_H, NEAR_HI_H))
    name = next(n for n in MEDICAL_OK if ok(dry(app_url, seats(req)[0]["id"], n))["all_pass"])
    with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
        open_board(page, app_url, req)
        gates = status(page, "Gate results")
        live(gates)
        with entered(held(page, "**/dry-run")) as hold:
            grab(page, name, card(page, req))
            shows(page, gates, f"Checking gates for {req['ref']} seat 1…")
            advance(page, DRY_RUN_TIMEOUT_MS)
            shows(page, gates, f"Could not check gates for {req['ref']}. Nothing was offered.")
            page.mouse.up()
            hold.release()
    assert seats(get_req(app_url, req["id"]))[0]["status"] == "open"
    quiet(mail, EMAIL[KEY[name]], offer_subject(req))
    draft = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), submit=False)
    treq, tname, ts = worked(app_url, mail)
    number = unique("S")[0][:40]
    expiry = str(server_now(app_url).astimezone(TZ).date() + timedelta(days=FAR_LO_H))
    with spawned(S3_ENDPOINT=CLOSED) as nostore:
        with entered(open_app(browser, f"{nostore}/signin")) as page:
            ui_login(page, nostore, "joel")
            page.goto(f"{nostore}/requests/{draft['id']}")
            add = page.get_by_role("button", name="Add prep file")
            wait_for(page, lambda: add.count() > 0, why="request detail")
            with page.expect_file_chooser() as fc:
                click(add)
            fc.value.set_files({"name": PREP_NAME, "mimeType": "application/pdf", "buffer": PDF})
            shows(page, status(page, "Request status"), "File storage is unreachable. Nothing was uploaded.")
        with entered(open_app(browser, f"{nostore}/signin")) as page:
            ui_login(page, nostore, "theo")
            click(page.get_by_role("button", name="Add credential"))
            dialog = page.get_by_role("dialog", name="Add credential")
            select(dialog.get_by_role("combobox", name="Credential type"), "NIC")
            fill(dialog.get_by_role("textbox", name="Credential number"), number)
            fill(dialog.get_by_role("textbox", name="Expires on"), expiry)
            with page.expect_file_chooser() as fc:
                click(dialog.get_by_role("button", name="Choose scan"))
            fc.value.set_files({"name": "card.png", "mimeType": "image/png", "buffer": PNG})
            cs = status(page, "Credential status")
            with entered(held(page, "**/api/interpreters/me/credentials")) as hold:
                click(dialog.get_by_role("button", name="Save credential"))
                shows(page, cs, "Saving credential…")
                live(cs)
                hold.release()
            shows(page, cs, "File storage is unreachable. Nothing was saved.")
        with entered(open_app(browser, f"{nostore}/signin")) as page:
            ui_login(page, nostore, "marguerite")
            button = page.get_by_role("button", name=f"Approve {treq['ref']} for {tname}")
            wait_for(page, lambda: button.count() > 0, why="queue row")
            click(button)
            shows(page, status(page, "Billing status"), "File storage is unreachable. The timesheet is not approved.")
    assert get_req(app_url, draft["id"], "joel")["prep_files"] == []
    assert bucket().keys(f"prep/birchmere-clinic/{draft['id']}/") == []
    assert number not in {c["number"] for c in ok(api(app_url, "theo").get("/api/interpreters/me/credentials"))["credentials"]}
    assert seats(get_req(app_url, treq["id"]))[0]["timesheet"]["status"] == "submitted"
    sreq, [sname] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-4, logged_after=True)
    staff(app_url, mail, sreq, [sname])
    start = parse(sreq["start"])
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, KEY[sname])
        click(page.get_by_role("button", name=f"Submit timesheet for {sreq['ref']}"))
        dialog = page.get_by_role("dialog", name=f"Timesheet for {sreq['ref']}")
        tstat = status(page, "Timesheet status")
        fill(dialog.get_by_role("textbox", name="Actual start"), ui_dt(start))
        fill(dialog.get_by_role("textbox", name="Actual end"), ui_dt(start - timedelta(minutes=TRAVEL_BUFFER_MIN)))
        fill(dialog.get_by_role("textbox", name="Signature name"), sname)
        click(dialog.get_by_role("button", name="Sign and submit"))
        shows(page, tstat, "Check the highlighted fields.")
        live(tstat)
        fill(dialog.get_by_role("textbox", name="Actual end"), ui_dt(start + timedelta(minutes=70)))
        with entered(held(page, "**/timesheet")) as hold:
            click(dialog.get_by_role("button", name="Sign and submit"))
            shows(page, tstat, "Submitting timesheet…")
            hold.release()
        shows(page, tstat, f"Timesheet for {sreq['ref']} submitted: 2.00 billed hours.")
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        inv = status(page, "Invoice status")
        with entered(held(page, "**/api/orgs/**/invoices")) as hold:
            page.goto(f"{app_url}/invoices")
            shows(page, inv, "Loading invoices…")
            hold.release()
        shows(page, inv, " invoice(s), total $")
        live(inv)
        got = re.search(r"(\d+) invoice\(s\), total \$(\d{1,3}(?:,?\d{3})*\.\d{2})\.", inv.inner_text())
        listed = ok(api(app_url, "joel").get(f"/api/orgs/{ORG['joel']}/invoices"))
        assert got and (int(got[1]), got[2].replace(",", "")) == (len(listed["invoices"]), listed["total"]), inv.inner_text()
    late, [ln] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    staff(app_url, mail, late, [ln])
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    with entered(open_app(browser, f"{down}/signin")) as page:
        ui_login(page, down, "joel")
        page.goto(f"{down}/requests/{late['id']}")
        click(page.get_by_role("button", name="Cancel request"))
        dialog = page.get_by_role("dialog", name="Cancel request")
        shows(page, dialog, "Late cancellation. $")
        click(dialog.get_by_role("button", name="Confirm cancellation"))
        cstat = status(page, "Cancellation status")
        shows(page, cstat, "Billing is unreachable. The request is not cancelled. Try again in a few minutes.")
        live(cstat)
    assert get_req(app_url, late["id"], "joel")["status"] == "staffed"
    assert items(app_url, "birchmere-clinic", f"[cx-{late['id']}]") == []


def test_feedback_refusals(browser, app_url, mail):
    soon = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H))
    started = json.dumps({"error": {"code": "already_started", "message": REFUSAL}})
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        page.goto(f"{app_url}/requests/{soon['id']}")
        cancel_button = page.get_by_role("button", name="Cancel request")
        wait_for(page, lambda: cancel_button.count() > 0, why="Cancel request")
        cs = status(page, "Cancellation status")
        dialog = page.get_by_role("dialog", name="Cancel request")
        with entered(held(page, "**/cancellation-quote")) as hold:
            click(cancel_button)
            shows(page, cs, "Working out the charge…")
            live(cs)
            hold.release()
        shows(page, dialog, "On-time cancellation. No charge.")
        click(dialog.get_by_role("button", name="Keep request"))
        wait_for(page, lambda: dialog.count() == 0 or not dialog.is_visible(), why="dialog closed")
        page.route("**/cancellation-quote", lambda route: route.fulfill(status=409, content_type="application/json", body=started))
        click(cancel_button)
        shows(page, cs, "This assignment has started and can no longer be cancelled.")
        live(cs)
    assert get_req(app_url, soon["id"], "joel")["status"] == "submitted"

    for _ in range(8):
        a, [name] = ready(app_url, MEDICAL_OK, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
        b = make(app_url, start=parse(a["start"]) + timedelta(minutes=TRAVEL_BUFFER_MIN // 2))
        if ok(dry(app_url, seats(b)[0]["id"], name))["all_pass"]:
            break
    else:
        raise AssertionError("no pair of overlapping slots where one interpreter passes every gate on both")
    others = [n for n in MEDICAL_OK if n != name]
    c, [cname] = ready(app_url, others, lo_h=NEAR_LO_H, hi_h=NEAR_HI_H)
    d, [dname] = ready(app_url, others, lo_h=WINDOW_LO_H, hi_h=WINDOW_HI_H)
    with entered(open_app(browser, f"{app_url}/signin", reduced_motion="reduce")) as page:
        open_board(page, app_url, a)
        bs = status(page, "Board status")
        live(bs)
        grab(page, name, card(page, a))
        wait_for(page, lambda: pip_states(page, a) == ["pass"] * 4, why="passing pips")
        ok(pin(app_url, seats(b)[0]["id"], name, "priya"), 201)
        page.mouse.up()
        reason = f"Too close to {b['ref']}; jobs need a travel buffer."
        shows(page, bs, f"Not offered. {reason}")
        shows(page, card(page, a), reason)
        grab(page, cname, card(page, c))
        wait_for(page, lambda: pip_states(page, c) == ["pass"] * 4, why="passing pips")
        ok(pin(app_url, seats(c)[0]["id"], cname, "priya"), 201)
        page.mouse.up()
        shows(page, bs, f"Seat taken by {NAME['priya']}.")
        shows(page, card(page, c), f"Seat taken by {NAME['priya']}.")
        grab(page, dname, card(page, d))
        wait_for(page, lambda: pip_states(page, d) == ["pass"] * 4, why="passing pips")
        page.mouse.up()
        shows(page, bs, "Too late to send an offer for this seat.")
        shows(page, card(page, d), "Too late to send an offer for this seat.")
    assert seats(get_req(app_url, a["id"]))[0]["status"] == "open"
    assert seats(get_req(app_url, d["id"]))[0]["status"] == "open"
    assert seats(get_req(app_url, c["id"]))[0]["held_by"]["name"] == NAME["priya"]

    draft = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), submit=False)
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "joel")
        page.goto(f"{app_url}/requests/{draft['id']}")
        add = page.get_by_role("button", name="Add prep file")
        wait_for(page, lambda: add.count() > 0, why="request detail")
        rs = status(page, "Request status")
        with page.expect_file_chooser() as fc:
            click(add)
        fc.value.set_files({"name": BIG_NAME, "mimeType": "application/pdf", "buffer": PDF + b"0" * UPLOAD_LIMIT})
        shows(page, rs, f"{BIG_NAME} is too large.")
        live(rs)
        ok(api(app_url, "joel").post(f"/api/requests/{draft['id']}/submit", json={}))
        with entered(held(page, "**/submit")) as hold:
            click(page.get_by_role("button", name="Submit request"))
            shows(page, rs, "Submitting…")
            hold.release()
        shows(page, rs, "This request can no longer be submitted.")
    assert get_req(app_url, draft["id"], "joel")["prep_files"] == []
    assert bucket().keys(f"prep/birchmere-clinic/{draft['id']}/") == []

    for answered, pressed, closed in (("decline", "Accept offer", "declined"), ("accept", "Decline offer", "accepted")):
        req, [oname] = ready(app_url, MEDICAL_OK, lo_h=FAR_LO_H, hi_h=FAR_HI_H)
        ok(pin(app_url, seats(req)[0]["id"], oname), 201)
        tok = offer_tokens(mail, req, oname)[0]
        with entered(open_app(browser, f"{app_url}/offers/{tok}")) as page:
            button = page.get_by_role("button", name=pressed)
            wait_for(page, lambda: button.count() > 0, why="offer buttons")
            ok(answer(app_url, tok, answered))
            click(button)
            offer_status = status(page, "Offer status")
            shows(page, offer_status, f"This offer is no longer open ({closed}).")
            live(offer_status)
        assert seats(get_req(app_url, req["id"]))[0]["status"] == ("open" if closed == "declined" else "accepted")

    treq, [tname] = ready(app_url, MEDICAL_OK, lo_h=-(LOGGED_AFTER_DAYS - 1) * 24, hi_h=-4, logged_after=True)
    staff(app_url, mail, treq, [tname])
    start = parse(treq["start"])
    early = json.dumps({"error": {"code": "not_yet_ended", "message": REFUSAL}})
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, KEY[tname])
        page.route("**/timesheet", lambda route: route.fulfill(status=409, content_type="application/json", body=early))
        click(page.get_by_role("button", name=f"Submit timesheet for {treq['ref']}"))
        dialog = page.get_by_role("dialog", name=f"Timesheet for {treq['ref']}")
        fill(dialog.get_by_role("textbox", name="Actual start"), ui_dt(start))
        fill(dialog.get_by_role("textbox", name="Actual end"), ui_dt(start + timedelta(minutes=70)))
        fill(dialog.get_by_role("textbox", name="Signature name"), tname)
        click(dialog.get_by_role("button", name="Sign and submit"))
        tstat = status(page, "Timesheet status")
        shows(page, tstat, "You can submit after the assignment ends.")
        live(tstat)
    assert seats(get_req(app_url, treq["id"]))[0]["timesheet"] is None

    conflict = json.dumps({"error": {"code": "validation", "message": REFUSAL, "fields": {"blocked": REFUSAL}}})
    stub = lambda route: (route.fulfill(status=422, content_type="application/json", body=conflict)
                          if route.request.method == "PUT" else route.continue_())
    with entered(open_app(browser, f"{app_url}/signin")) as page:
        ui_login(page, app_url, "marcus")
        page.route("**/api/consumers/me/preferences", stub)
        group = page.get_by_role("table", name="Interpreter preferences").get_by_role("radiogroup", name="Dana Okafor")
        wait_for(page, lambda: group.count() > 0, why="preference rows")
        check(group.get_by_role("radio", name="Blocked"))
        click(page.get_by_role("button", name="Save preferences"))
        pstat = status(page, "Preferences status")
        shows(page, pstat, "An interpreter cannot be both preferred and blocked.")
        live(pstat)
    marcus = ok(api(app_url, "rowan").get(f"/api/consumers/{cid(app_url, 'Marcus Tull')}/preferences"))
    assert iid(app_url, "Dana Okafor") not in marcus["blocked"]


def _package() -> dict:
    return json.loads(Path("/app/package.json").read_text())


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for dep in _package().get("dependencies", {}):
        assert dep in notices, dep
    for font in ("Instrument Serif", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices, font


def test_if_licence_allowlist():
    allowed = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "OFL-1.1"}
    lock = json.loads(Path("/app/package-lock.json").read_text())
    for path, meta in lock.get("packages", {}).items():
        if not path or meta.get("dev") or meta.get("devOptional"):
            continue
        lic = meta.get("license")
        names = set(re.findall(r"[A-Za-z0-9.\-]+", lic)) - {"OR", "AND"} if isinstance(lic, str) else set()
        assert names and (names & allowed if " OR " in str(lic) else names <= allowed), (path, lic)
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore(app_url):
    title = unique("Persisted")[0]
    req = make(app_url, start=at(app_url, FAR_LO_H, FAR_HI_H), title=title)
    pg, hits = Postgres(), 0
    needle = title.replace("'", "''")
    for table in pg.tables():
        quoted = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        hits += int(pg.rows(f"SELECT count(*) AS n FROM {quoted} AS x WHERE x::text LIKE '%{needle}%'")[0]["n"])
    assert hits >= 1, "the new request is not stored in PostgreSQL"
    with spawned() as other:
        assert get_req(other, req["id"], "joel")["title"] == title
    from conftest import DEPLOYED_APP
    for root in {Path("/app"), Path(DEPLOYED_APP)}:
        for path in root.rglob("*"):
            if path.is_file() and not {"node_modules", ".git"} & set(path.parts):
                assert path.suffix.lower() not in {".sqlite", ".sqlite3", ".db", ".ldb", ".mdb"}, path
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "lmdb", "lowdb", "nedb", "keyv"}
    pkg = _package()
    deps = set(pkg.get("dependencies", {})) | set(pkg.get("devDependencies", {}))
    assert not deps & banned, deps & banned


def test_if_service_config_untouched(killbill, mail):
    assert killbill.account_by_key("fernhollow-birchmere-clinic") is not None
    assert isinstance(mail.messages(), list)
    assert isinstance(bucket().keys("prep/"), list)


def test_if_no_committed_secrets():
    values = protected_values()
    size_cap = 2 * 1024 * 1024
    for path in Path("/app").rglob("*"):
        if not path.is_file() or {"node_modules", ".git"} & set(path.parts) or path.stat().st_size > size_cap:
            continue
        data = path.read_bytes()
        for value in values:
            assert value.encode() not in data, f"protected value in {path}"
