from __future__ import annotations

import concurrent.futures as cf
import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP, S3, Postgres, addresses, advance, axe, click, fill, idempotency_key, layout,
    licence_allowed, mail_from_address, motion, open_app, pdf_text, select, shipped_packages,
    state_styles, tab_order, text, unique,
)

QUSD, MBTC, METH = "QUSD", "MBTC", "METH"
DEC = {QUSD: 6, MBTC: 8, METH: 18}
STEWARD, STEWARD2 = "stw-ines", "stw-odile"
TRADER = "tr-petra"
APP_UID = "quillmoor-reserve"
P_QUSD, P_MBTC, P_METH = "1", "64000", "3200"
NNBSP, MINUS = "\u202f", "\u2212"
BANNER = "Price feed stale. Borrowing, withdrawals of collateral and liquidations are paused."
SWAP_STALE = "Swaps are paused while the price feed is stale."
NET_FAIL = "Couldn’t reach Quillmoor. Press the same button again to retry safely."
PENDING_LINE = "Funds have moved. This settlement is not final until its statement and its PDF are confirmed in storage."
CLOSE_FACTOR_BPS = 5000
BPS = 10000
LEDGER_FROM = "2026-11-01 01:30"
LEDGER_FROM_UTC = "2026-11-01T04:00:00Z"
LEDGER_GAP = "2026-03-08 02:30"
DESK = ZoneInfo("America/St_Johns")
MIN_TARGET = 44
HANDLE_MIN_MS, HANDLE_MAX_MS = 100, 150
SHOCK_PAUSE_MS = 400
REFRESH_MS = 5000
BODY_LIMIT = 16384
TIMEOUT_MS = 1000
RECOVER_S = 5
DUR = {"PT5M": 300, "PT1H": 3600}
DETAIL = {
    "payload_too_large": (413, "The request body is too large."),
    "cross_origin": (403, "Requests must come from Quillmoor’s own pages."),
    "unsupported_media_type": (415, "Send the body as application/json."),
    "invalid_json": (400, "The request body is not valid JSON."),
    "unauthenticated": (401, "Choose who you are acting as."),
    "idempotency_key_required": (400, "Send an Idempotency-Key header of 1 to 128 visible characters."),
    "idempotency_key_reused": (409, "This Idempotency-Key was already used with a different request."),
    "not_found": (404, "Nothing here by that name."),
    "forbidden": (403, "Your role can’t do this."),
    "precondition_required": (428, "Send the If-Match header from your latest read."),
    "precondition_failed": (412, "These risk parameters changed since you opened them. Check the current values and save again."),
    "market_stale": (423, None),
    "quote_expired": (410, "This quote has expired. Get a new quote."),
    "quote_used": (409, "This quote has already been used."),
    "position_closed": (409, "This position is closed."),
    "already_liquidated": (409, "Already liquidated at this health factor"),
    "in_grace": (409, "This position is in its grace period."),
    "not_liquidatable": (409, "This position is not below health factor 1."),
    "insufficient_liquidity": (409, None),
    "email_taken": (409, "A member with this email already exists."),
    "pdf_pending": (409, "The PDF statement isn’t ready yet."),
    "validation_failed": (422, "Check the highlighted fields."),
    "statement_store_unavailable": (503, "The statement store is unreachable. Nothing was changed. Try again shortly."),
    "ledger_unavailable": (503, "The ledger is unreachable – nothing is confirmed. Try again shortly."),
}
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
DIGITS = re.compile(r"^(0|[1-9]\d*)$")

COLLATERAL = 100000000
DRAW = 40000000000
WARN_PRICE = "56000"
GRACE_PRICE = "52000"
DEEP_PRICE = "44000"
CRASH_PRICE = "20000"
FUND_QUSD = 100000000000
FAR_CLOCK = "2031-06-01T00:00:00Z"
EVIL_ORIGIN = "http://elsewhere.example"
SLOW_MS = 1500
CORS_PREFIX = "access-control-allow"
HTML_TYPE = "text/html"
BAD_AMOUNT = "3.5"
TYPED_AMOUNT = "7,25"
WAIT_S = 60
HTTP_S = 30
POLL_S = 0.25
STEP_MS = 250
PREFIX = {"short": "/short", "gotenberg": "/gotenberg-down", "minio": "/minio-down"}


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def short() -> str: return env_url("APP_SHORT_URL")
def minio_down() -> str: return env_url("APP_MINIO_DOWN_URL")
def gotenberg_down() -> str: return env_url("APP_GOTENBERG_DOWN_URL")
def oracle_down() -> str: return env_url("APP_ORACLE_DOWN_URL")
def mail_down() -> str: return env_url("APP_MAILPIT_DOWN_URL")
def svix_down() -> str: return env_url("APP_SVIX_DOWN_URL")


def group(n: int) -> str:
    s, parts = str(n), []
    for _ in range(len(s)):
        if not s:
            break
        parts.insert(0, s[-3:])
        s = s[:-3]
    return NNBSP.join(parts)


def desk(amount: int, asset: str) -> str:
    d = DEC[asset]
    sign = MINUS if amount < 0 else ""
    a = abs(amount)
    return f"{sign}{group(a // 10 ** d)},{a % 10 ** d:0{d}d}"


def signed(amount: int, asset: str) -> str:
    return ("+" if amount > 0 else "") + desk(amount, asset)


def units(price: str) -> int:
    whole, _, frac = price.partition(".")
    return int(whole) * 10 ** 8 + int(frac.ljust(8, "0") or "0")


def api_price(u: int) -> str:
    return f"{u // 10 ** 8}.{u % 10 ** 8:08d}"


def minor(text: str, asset: str) -> int:
    whole, _, frac = text.replace(NNBSP, "").partition(",")
    return int(whole) * 10 ** DEC[asset] + int(frac.ljust(DEC[asset], "0") or "0")


def desk_to_api(text: str) -> str:
    return text.replace(NNBSP, "").replace(",", ".")


def desk_price(u: int) -> str:
    return "$" + f"{group(u // 10 ** 8)},{u % 10 ** 8:08d}"


def desk_hf(hf: str | None) -> str:
    return "No debt" if hf is None else hf.replace(".", ",")


def hf_str(v: int) -> str:
    return f"{v // BPS}.{v % BPS:04d}"


def desk_time(iso: str, full: bool = True) -> str:
    dt = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).astimezone(DESK)
    return f"{dt:%Y-%m-%d %H:%M:%S} {dt.tzname()}" if full else f"{dt:%H:%M:%S} {dt.tzname()}"


def epoch(iso: str) -> int:
    return int(datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def mss(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def iso_seconds(d: str) -> int:
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d)
    assert m and d != "PT", f"duration {d!r} is not ISO 8601 H/M/S"
    h, mi, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + s


def split_reserve(total: int, rf: int) -> int:
    r_floor, r_rem = divmod(total * rf, BPS)
    s_floor, s_rem = divmod(total * (BPS - rf), BPS)
    leftover = total - r_floor - s_floor
    return r_floor + (1 if leftover and r_rem > s_rem else 0)


def value_of(blob: str, label: str) -> str | None:
    m = re.search(rf"(?:^|\n)\s*{re.escape(label)}[ \t:]*\n?[ \t]*([{MINUS}+$\d][^\n]*)", blob)
    return m.group(1).strip() if m else None


def call(base: str, method: str, path: str, token: str | None = None, body=None, key: str | None = None,
         raw: bytes | None = None, **headers: str) -> httpx.Response:
    h = {k.replace("_", "-"): v for k, v in headers.items()}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if key:
        h["Idempotency-Key"] = key
    content = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    if content is not None:
        h.setdefault("Content-Type", "application/json")
    return httpx.request(method, base + path, headers=h, content=content, timeout=HTTP_S)


_TOKENS: dict[tuple[str, str], str] = {}


def tok(base: str, actor: str) -> str:
    if (base, actor) not in _TOKENS:
        r = call(base, "POST", "/api/sessions", body={"actor_id": actor})
        assert r.status_code == 201, r.text
        _TOKENS[(base, actor)] = r.json()["token"]
    return _TOKENS[(base, actor)]


def problem(r: httpx.Response, code: str, detail: str | None = None, field: str | None = None, message: str | None = None) -> dict:
    status, default = DETAIL[code]
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text}"
    assert r.headers["content-type"].startswith("application/problem+json")
    b = r.json()
    assert b["type"] == f"urn:quillmoor:problem:{code}" and b["status"] == status and b["code"] == code
    want = detail if detail is not None else default
    if want is not None:
        assert b["detail"] == want
    if field:
        assert b["errors"][field] == message, b
    return b


def ok(r: httpx.Response, status: int = 201) -> dict:
    assert r.status_code == status, f"{r.status_code} {r.text}"
    return r.json()


def poll(fn, what: str, seconds: float = WAIT_S):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        v = fn()
        if v:
            return v
        threading.Event().wait(POLL_S)
    pytest.fail(f"timed out waiting: expected {what}")


def member(base: str, role_: str) -> tuple[dict, str]:
    name, email = unique(role_.replace("_", "-"))
    a = ok(call(base, "POST", "/api/actors", tok(base, STEWARD), {"name": name, "email": email, "role": role_}))
    return a, tok(base, a["actor_id"])


def transfer(base: str, actor: str, asset: str, amount: int) -> dict:
    return ok(call(base, "POST", "/api/transfers", tok(base, STEWARD), {"actor_id": actor, "asset": asset, "amount": str(amount)}))


def post_price(base: str, asset: str, price: str, confirm: bool | None = True) -> httpx.Response:
    body = {"asset": asset, "price": price}
    if confirm is not None:
        body["confirm_large_move"] = confirm
    return call(base, "POST", "/api/prices", tok(base, STEWARD), body)


def prime(base: str, mbtc: str = P_MBTC) -> dict:
    for asset, p in ((QUSD, P_QUSD), (METH, P_METH)):
        ok(post_price(base, asset, p))
    return ok(post_price(base, MBTC, mbtc))


def pool(base: str, asset: str) -> dict:
    return ok(call(base, "GET", f"/api/pools/{asset}", tok(base, STEWARD)), 200)


def pools(base: str) -> dict:
    return ok(call(base, "GET", "/api/pools", tok(base, STEWARD)), 200)


def wallet(base: str, token: str) -> dict[str, int]:
    w = ok(call(base, "GET", "/api/wallet", token), 200)
    return {b["asset"]: int(b["amount"]) for b in w["balances"]}


def position(base: str, pid: str) -> dict:
    return ok(call(base, "GET", f"/api/positions/{pid}", tok(base, STEWARD)), 200)


def draw(base: str, token: str, pid: str, amount: int, key: str | None = None) -> httpx.Response:
    return call(base, "POST", f"/api/positions/{pid}/draws", token, {"amount": str(amount)}, key=key or idempotency_key())


def borrow(base: str, collateral: str = MBTC, debt: str = QUSD, c_amt: int = COLLATERAL, d_amt: int | None = DRAW):
    a, t = member(base, "borrower")
    transfer(base, a["actor_id"], collateral, c_amt)
    p = ok(call(base, "POST", "/api/positions", t, {"collateral_asset": collateral, "debt_asset": debt, "collateral_amount": str(c_amt)}))
    if d_amt:
        ok(draw(base, t, p["position_id"], d_amt))
    return a, t, p["position_id"]


def liquidator(base: str, amount: int = FUND_QUSD) -> tuple[dict, str]:
    a, t = member(base, "liquidator")
    transfer(base, a["actor_id"], QUSD, amount)
    return a, t


def liquidate(base: str, token: str, pid: str, repay: int, round_: int, key: str | None = None) -> httpx.Response:
    return call(base, "POST", f"/api/positions/{pid}/liquidations", token, {"repay_amount": str(repay), "round": round_}, key=key or idempotency_key())


def wait_state(base: str, pid: str, states: tuple[str, ...]) -> dict:
    return poll(lambda: (p := position(base, pid))["state"] in states and p, f"{pid} to reach {states}")


def drop_to_liquidatable(base: str, pids: list[str], price: str = GRACE_PRICE) -> None:
    prime(base, price)
    for pid in pids:
        wait_state(base, pid, ("liquidatable", "partially_liquidated"))


def postings(base: str, asset: str | None = None, limit: int = 200) -> list[dict]:
    q = f"?limit={limit}" + (f"&asset={asset}" if asset else "")
    return ok(call(base, "GET", f"/api/ledger/postings{q}", tok(base, STEWARD)), 200)["postings"]


def posting(base: str, posting_id: str, asset: str) -> dict:
    found = [p for p in postings(base, asset) if p["posting_id"] == posting_id]
    assert len(found) == 1, f"posting {posting_id} listed once on GET /api/ledger/postings"
    return found[0]


def assert_balanced(p: dict) -> None:
    sums: dict[str, int] = {}
    for leg in p["legs"]:
        assert int(leg["amount"]) != 0
        sums[leg["asset"]] = sums.get(leg["asset"], 0) + int(leg["amount"])
    assert all(v == 0 for v in sums.values()), f"posting {p['posting_id']} unbalanced: {sums}"


def leg(legs: list[dict], account: str, asset: str) -> int:
    return sum(int(x["amount"]) for x in legs if x["account"] == account and x["asset"] == asset)


def mails(mail, email: str, subject_prefix: str) -> list[dict]:
    return [m for m in mail.messages() if email.lower() in [a.lower() for a in addresses(m.get("To"))]
            and str(m.get("Subject", "")).startswith(subject_prefix)]


def events(svix, pid: str | None = None, sid: str | None = None) -> list[dict]:
    out = []
    for m in svix.messages(APP_UID):
        pl = m.get("payload") or {}
        if (pid and pl.get("position_id") == pid) or (sid and (pl.get("data") or {}).get("settlement_id") == sid):
            out.append(m)
    return out


def fills(svix, pid: str) -> list[dict]:
    return [e for e in events(svix, pid)
            if e["payload"]["type"] == "settlement.committed" and e["payload"]["data"].get("kind") == "liquidation"]


def feed(wiremock, prefix: str, asset: str, round_: int, mantissa: str, exponent: int, publish: int, raw: str | None = None) -> str:
    body = raw or json.dumps({"feed": f"{asset}-USD", "round": round_, "price": {"mantissa": mantissa, "exponent": exponent}, "publish_time": publish})
    wiremock.stub("GET", f"{prefix}/feeds/{asset}-USD/latest", body=body, headers={"Content-Type": "application/json"})
    return body


def server_epoch(base: str) -> int:
    return epoch(pools(base)["server_time"])


def oracle_now(base: str, asset: str) -> int:
    prices = ok(call(base, "GET", f"/api/prices?asset={asset}", tok(base, STEWARD)), 200)["prices"]
    last = max((x["oracle_round"] for x in prices if x["oracle_round"] is not None), default=0)
    poll(lambda: server_epoch(base) > last, f"server clock past {asset} oracle round {last}")
    return server_epoch(base)


def hf_expected(p: dict, pc: int, pd: int, lt: int) -> tuple[str | None, str | None]:
    C, D = int(p["collateral_amount"]), int(p["debt"])
    dc, dd = DEC[p["collateral_asset"]], DEC[p["debt_asset"]]
    if D == 0:
        return None, None
    hf = (C * pc * lt * 10 ** dd) // (D * pd * 10 ** dc)
    num, den = D * pd * 10 ** dc * BPS, C * lt * 10 ** dd
    return hf_str(hf), api_price(-(-num // den))


def role(scope, r: str, name: str):
    return scope.get_by_role(r, name=name, exact=True)


def ui_wait(page, check, what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except Exception:
            pass
        advance(page, STEP_MS)
    pytest.fail(f"page never showed: {what}")


def shows(page, locator, needle: str, seconds: float = WAIT_S) -> None:
    ui_wait(page, lambda: needle in locator.inner_text(timeout=1000), f"{needle!r}", seconds)


def focused(locator) -> bool:
    return locator.evaluate("el => el === document.activeElement")


def pick(locator, *choices: str) -> None:
    last: Exception | None = None
    for c in choices:
        try:
            select(locator, c)
            return
        except Exception as e:
            last = e
    raise AssertionError(f"none of {choices} could be chosen: {last}")


def app_page(browser, url: str, **kw):
    return open_app(browser, url, **kw)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Relay:

    def __init__(self, host: str, port: int):
        self.target, self.port, self.sock, self.conns = (host, port), free_port(), None, []

    def up(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.sock = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def _accept(self, s) -> None:
        for _ in range(100000):
            try:
                c, _ = s.accept()
                u = socket.create_connection(self.target)
            except OSError:
                return
            self.conns += [c, u]
            for a, b in ((c, u), (u, c)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a, b) -> None:
        for _ in range(10 ** 9):
            try:
                data = a.recv(65536)
                if not data:
                    break
                b.sendall(data)
            except OSError:
                break

    def down(self) -> None:
        for s in [self.sock, *self.conns]:
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            s.close()
        self.sock, self.conns = None, []


@contextmanager
def app_copy(env: dict[str, str]):
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    port = free_port()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT,
                            env={**os.environ, **env, "APP_PUBLIC_PORT": str(port), "ORACLE_PATH_PREFIX": "/copy"})
    try:
        yield f"http://127.0.0.1:{port}", proc, log.name
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=HTTP_S)
        except subprocess.TimeoutExpired:
            proc.kill()


def relayed_db(relay: Relay) -> str:
    u = urlsplit(os.environ["DATABASE_URL"])
    user = u.netloc.rsplit("@", 1)[0] + "@" if "@" in u.netloc else ""
    return urlunsplit((u.scheme, f"{user}127.0.0.1:{relay.port}", u.path, u.query, u.fragment))


def db_relay() -> Relay:
    u = urlsplit(os.environ["DATABASE_URL"])
    return Relay(u.hostname or "127.0.0.1", u.port or 5432)


def tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-3000:]


def test_sessions_and_roles(app_url):
    actors = ok(call(app_url, "GET", "/api/actors"), 200)["actors"]
    roles = {a["actor_id"]: a["role"] for a in actors}
    assert roles[STEWARD] == "risk_steward" and roles[TRADER] == "trader"
    s = ok(call(app_url, "POST", "/api/sessions", body={"actor_id": TRADER}))
    assert s["actor_id"] == TRADER and s["role"] == "trader" and s["token"]
    assert ok(call(app_url, "GET", "/api/me", s["token"]), 200)["actor_id"] == TRADER
    for t in (None, "no-such-session"):
        r = call(app_url, "GET", "/api/me", t)
        problem(r, "unauthenticated")
        assert r.headers.get("www-authenticate", "").startswith("Bearer")
    problem(call(app_url, "POST", "/api/prices", s["token"], {"asset": MBTC, "price": P_MBTC}), "forbidden")
    _, btok = member(app_url, "borrower")
    problem(draw(app_url, btok, "pos-0001", 1), "forbidden")
    problem(call(app_url, "GET", "/api/ledger/totals", btok), "forbidden")
    problem(call(app_url, "POST", "/api/sessions", body={"actor_id": "nobody-here"}), "validation_failed",
            field="actor_id", message="Choose an existing member.")


def test_onboarding_and_transfers(app_url):
    name, email = unique("onboard")
    st = tok(app_url, STEWARD)
    a = ok(call(app_url, "POST", "/api/actors", st, {"name": name, "email": email, "role": "borrower"}))
    assert (a["name"], a["email"], a["role"]) == (name, email, "borrower")
    problem(call(app_url, "POST", "/api/actors", st, {"name": name, "email": email.upper(), "role": "borrower"}), "email_taken")
    problem(call(app_url, "POST", "/api/actors", st, {"name": name, "email": "x" + email, "role": "admin"}), "validation_failed",
            field="role", message="Choose a role.")
    problem(call(app_url, "POST", "/api/actors", tok(app_url, TRADER), {"name": name, "email": "y" + email, "role": "trader"}), "forbidden")
    amount = 123456789
    t = transfer(app_url, a["actor_id"], MBTC, amount)
    assert t["amount"] == str(amount) and t["asset"] == MBTC
    p = posting(app_url, t["posting_id"], MBTC)
    assert p["kind"] == "transfer_in"
    assert sorted((x["account"], int(x["amount"])) for x in p["legs"]) == sorted(
        [("custody", -amount), (f"wallet:{a['actor_id']}", amount)])
    assert wallet(app_url, tok(app_url, a["actor_id"]))[MBTC] == amount


def test_balanced_journals(app_url):
    prime(app_url)
    a, t, pid = borrow(app_url, d_amt=1000000000)
    mine = [p for p in postings(app_url) if any(x["account"] in (f"wallet:{a['actor_id']}", f"loan:{pid}", f"collateral:{pid}") for x in p["legs"])]
    assert {p["kind"] for p in mine} >= {"transfer_in", "lock", "draw"}
    for p in mine:
        assert_balanced(p)
    ok(call(app_url, "POST", f"/api/positions/{pid}/repayments", t, {"amount": "1000"}))
    later = {p["posting_id"]: p for p in postings(app_url)}
    for p in mine:
        assert later[p["posting_id"]] == p, "postings are never edited"
    totals = ok(call(app_url, "GET", "/api/ledger/totals", tok(app_url, STEWARD)), 200)["assets"]
    assert {x["asset"] for x in totals} == {QUSD, MBTC, METH}
    for x in totals:
        assert x["net"] == "0" and int(x["debits"]) == int(x["credits"])


def test_ledger_url_state(browser, app_url):
    with app_page(browser, f"{app_url}/ledger?actor={STEWARD}") as page:
        expect(page).to_have_url(f"{app_url}/ledger")
        select(role(page, "combobox", "Ledger asset"), MBTC)
        expect(page).to_have_url(f"{app_url}/ledger?asset=MBTC")
        select(role(page, "combobox", "Postings shown"), "20")
        expect(page).to_have_url(f"{app_url}/ledger?asset=MBTC&limit=20")
        box = role(page, "textbox", "Posted from")
        fill(box, LEDGER_FROM)
        box.press("Enter")
        expect(page).to_have_url(f"{app_url}/ledger?asset=MBTC&limit=20&from={LEDGER_FROM_UTC}")
        page.go_back()
        expect(page).to_have_url(f"{app_url}/ledger?asset=MBTC&limit=20")
        expect(box).to_have_value("")
        page.go_forward()
        expect(page).to_have_url(f"{app_url}/ledger?asset=MBTC&limit=20&from={LEDGER_FROM_UTC}")
        expect(box).to_have_value(LEDGER_FROM)
        page.reload()
        expect(role(page, "textbox", "Posted from")).to_have_value(LEDGER_FROM)
        before = page.evaluate("history.length")
        fill(box, LEDGER_GAP)
        box.press("Enter")
        shows(page, page.locator("body"), "That time doesn’t exist in the desk time zone – the clocks skip it.")
        expect(page).to_have_url(f"{app_url}/ledger?asset=MBTC&limit=20&from={LEDGER_FROM_UTC}")
        page.goto(f"{app_url}/ledger?asset=XYZ&limit=7&from=yesterday")
        expect(page).to_have_url(f"{app_url}/ledger")
        assert page.evaluate("history.length") == before + 1, "fallback rewrote the URL with replace"


def test_wf_funding_ledger_happy(browser, app_url):
    name, email = unique("funded")
    with app_page(browser, f"{app_url}/steward?actor={STEWARD}") as st:
        fill(role(st, "textbox", "Member name"), name)
        fill(role(st, "textbox", "Member email"), email)
        select(role(st, "combobox", "Member role"), "Borrower")
        click(role(st, "button", "Add member"))
        shows(st, role(st, "status", "Announcements"), f"Member added: {name}.")
        actor = next(a for a in ok(call(app_url, "GET", "/api/actors"), 200)["actors"] if a["email"] == email)
        with app_page(browser, f"{app_url}/borrow?actor={actor['actor_id']}") as bp:
            wal = role(bp, "region", "Wallet")
            shows(bp, wal, "0,00000000")
            st.reload()
            pick(role(st, "combobox", "Member"), name, f"{name} (Borrower)")
            select(role(st, "combobox", "Transfer asset"), MBTC)
            fill(role(st, "textbox", "Transfer amount"), f"1{NNBSP}234,5")
            click(role(st, "button", "Record transfer"))
            shows(st, role(st, "status", "Announcements"), f"Transfer recorded: 1{NNBSP}234,50000000 MBTC to {name}.")
            shows(bp, wal, f"1{NNBSP}234,50000000")
        assert wallet(app_url, tok(app_url, actor["actor_id"]))[MBTC] == minor(f"1{NNBSP}234,5", MBTC)
        st.goto(f"{app_url}/ledger")
        select(role(st, "combobox", "Ledger asset"), MBTC)
        fill(role(st, "textbox", "Posted from"), LEDGER_FROM)
        role(st, "textbox", "Posted from").press("Enter")
        expect(st).to_have_url(f"{app_url}/ledger?asset=MBTC&from={LEDGER_FROM_UTC}")
        shows(st, role(st, "table", "Postings"), f"wallet:{actor['actor_id']}")
        totals = role(st, "table", "Ledger totals").inner_text()
        for asset in (QUSD, MBTC, METH):
            assert re.search(rf"{asset}[^\n]*\b0(,0+)?\s*$", totals, re.M), f"{asset} nets to zero on screen"
    for x in ok(call(app_url, "GET", "/api/ledger/totals", tok(app_url, STEWARD)), 200)["assets"]:
        assert x["net"] == "0"


def test_wf_funding_ledger_ladder(browser, app_url):
    a, at = member(app_url, "borrower")
    with app_page(browser, f"{app_url}/steward?actor={STEWARD}") as st:
        pick(role(st, "combobox", "Member"), a["name"], f"{a['name']} (Borrower)")
        select(role(st, "combobox", "Transfer asset"), QUSD)
        amt = role(st, "textbox", "Transfer amount")
        fill(amt, "12.5")
        shows(st, st.locator("body"), "Enter digits with a comma before the decimals.")
        click(role(st, "button", "Record transfer"))
        expect(amt).to_be_focused()
        assert wallet(app_url, at)[QUSD] == 0
        fill(amt, "12,5")
        click(role(st, "button", "Record transfer"))
        shows(st, role(st, "status", "Announcements"), "Transfer recorded: 12,500000 QUSD")
    assert wallet(app_url, at)[QUSD] == minor("12,5", QUSD)
    problem(call(app_url, "POST", "/api/transfers", None, raw=b"{", Content_Type="text/plain"), "unsupported_media_type")
    problem(call(app_url, "POST", "/api/transfers", None, raw=b"{"), "invalid_json")


def test_pool_shares_and_withdrawals(app_url):
    lp, t = member(app_url, "liquidity_provider")
    transfer(app_url, lp["actor_id"], METH, 10 ** 19)
    before = pool(app_url, METH)
    S, T = int(before["supply_balance"]), int(before["total_shares"])
    x = 3 * 10 ** 18 + 7
    sup = ok(call(app_url, "POST", f"/api/pools/{METH}/supplies", t, {"amount": str(x)}))
    assert sup["shares_minted"] == str(x * T // S)
    after = pool(app_url, METH)
    S2, T2 = int(after["supply_balance"]), int(after["total_shares"])
    y = 10 ** 18 + 1
    problem(call(app_url, "POST", f"/api/pools/{METH}/withdrawals", t, {"amount": str(y)}), "idempotency_key_required")
    w = ok(call(app_url, "POST", f"/api/pools/{METH}/withdrawals", t, {"amount": str(y)}, key=idempotency_key()))
    assert w["kind"] == "withdrawal" and w["position_id"] is None and w["amount"] == str(y)
    assert w["shares_burned"] == str(-(-y * T2 // S2))
    st = json.loads(S3().get(w["statement_key"]))
    assert w["statement_key"] == f"statements/withdrawal/{w['settlement_id']}.json"
    assert st["settlement_id"] == w["settlement_id"] and st["amount"] == str(y)
    held = next(h for h in ok(call(app_url, "GET", "/api/wallet", t), 200)["lp_holdings"] if h["asset"] == METH)
    worth = int(held["value"]) + 1
    problem(call(app_url, "POST", f"/api/pools/{METH}/withdrawals", t, {"amount": str(worth)}, key=idempotency_key()),
            "validation_failed", field="amount", message=f"Your shares are worth {desk(int(held['value']), METH)} METH.")
    huge = int(pool(app_url, METH)["available_liquidity"]) + 1
    b = problem(call(app_url, "POST", f"/api/pools/{METH}/withdrawals", t, {"amount": str(huge)}, key=idempotency_key()), "insufficient_liquidity")
    assert b["detail"].startswith("Only ") and b["detail"].endswith(" METH is available in the METH pool right now.")
    assert wallet(app_url, t)[METH] == 10 ** 19 - x + y


def test_pool_figures_from_ledger(app_url):
    prime(app_url)
    lp, lt = member(app_url, "liquidity_provider")
    transfer(app_url, lp["actor_id"], MBTC, 50000000)
    tr, tt = member(app_url, "trader")
    transfer(app_url, tr["actor_id"], MBTC, 50000000)
    st = tok(app_url, STEWARD)

    def check():
        accts = ok(call(app_url, "GET", f"/api/ledger/accounts?asset={MBTC}", st), 200)["accounts"]
        bal = lambda pred: sum(int(a["balance"]) for a in accts if pred(a["account"]))
        loans = bal(lambda n: n.startswith("loan:"))
        p = pool(app_url, MBTC)
        avail = bal(lambda n: n == "supply") + bal(lambda n: n == "swap") + loans
        borrowed = -loans
        assert p["available_liquidity"] == str(avail) and p["total_borrowed"] == str(borrowed)
        util = 0 if borrowed + avail == 0 else borrowed * BPS // (borrowed + avail)
        assert p["utilization_bps"] == util
        sup, shares = bal(lambda n: n == "supply"), int(p["total_shares"])
        sp = sup * 10 ** 12 // shares
        assert p["share_price"] == f"{sp // 10 ** 12}.{sp % 10 ** 12:012d}"

    ok(call(app_url, "POST", f"/api/pools/{MBTC}/supplies", lt, {"amount": "20000000"}))
    check()
    q = ok(call(app_url, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": QUSD, "amount_in": "12345678"}))
    ok(call(app_url, "POST", "/api/swaps", tt, {"quote_id": q["quote_id"]}, key=idempotency_key()))
    check()
    ok(call(app_url, "POST", f"/api/pools/{MBTC}/withdrawals", lt, {"amount": "10000000"}, key=idempotency_key()))
    check()


def test_last_liquidity_contest():
    a, b = short(), gotenberg_down()
    prime(a)
    big, bt, bpid = borrow(a, MBTC, METH, 10 ** 10, None)
    left = 10 ** 18
    ok(draw(a, bt, bpid, int(pool(a, METH)["available_liquidity"]) - left))
    contenders = []
    try:
        avail = int(pool(a, METH)["available_liquidity"])
        d = avail * 2 // 3
        contenders = [borrow(a, MBTC, METH, COLLATERAL, None) for _ in range(2)]
        bar = threading.Barrier(2)

        def go(args):
            base, (_, t, pid) = args
            bar.wait()
            return draw(base, t, pid, d)

        with cf.ThreadPoolExecutor(2) as ex:
            rs = list(ex.map(go, zip((a, b), contenders)))
        assert sorted(r.status_code for r in rs) == [201, 409], [r.text for r in rs]
        i = [r.status_code for r in rs].index(409)
        body = problem(rs[i], "insufficient_liquidity")
        assert body["detail"].endswith(" METH is available in the METH pool right now.")
        assert wallet(a, contenders[i][1])[METH] == 0 and position(a, contenders[i][2])["debt"] == "0"
        assert wallet(a, contenders[1 - i][1])[METH] == d
    finally:
        for who, t, pid in [(big, bt, bpid), *contenders]:
            transfer(a, who["actor_id"], METH, 10 ** 18)
            call(a, "POST", f"/api/positions/{pid}/repayments", t, {"amount": "all"})


def test_supply_form_survives_refresh(browser, app_url):
    lp, lt = member(app_url, "liquidity_provider")
    transfer(app_url, lp["actor_id"], QUSD, 10 ** 9)
    other, ot = member(app_url, "liquidity_provider")
    transfer(app_url, other["actor_id"], QUSD, 10 ** 10)
    with app_page(browser, f"{app_url}/supply?actor={lp['actor_id']}") as page:
        select(role(page, "combobox", "Pool"), QUSD)
        fill(role(page, "textbox", "Supply amount"), "1")
        click(role(page, "button", "Supply"))
        ann = role(page, "status", "Announcements")
        supplied = f"Supplied {desk(10 ** 6, QUSD)} {QUSD}"
        shows(page, ann, supplied + " for ")
        card = page.get_by_role("article", name="QUSD pool")
        avail0 = value_of(card.inner_text(), "Available liquidity")
        fill(role(page, "textbox", "Supply amount"), TYPED_AMOUNT)
        wbox = role(page, "textbox", "Withdraw amount")
        fill(wbox, BAD_AMOUNT)
        wbox.focus()
        shows(page, page.locator("body"), "Enter digits with a comma before the decimals.")
        expect(wbox).to_have_attribute("aria-invalid", "true")
        caret = wbox.evaluate("el => el.selectionStart")
        ok(call(app_url, "POST", f"/api/pools/{QUSD}/supplies", ot, {"amount": "5000000000"}))
        ui_wait(page, lambda: value_of(card.inner_text(), "Available liquidity") != avail0, "QUSD card updated in place")
        advance(page, REFRESH_MS)
        expect(role(page, "textbox", "Supply amount")).to_have_value(TYPED_AMOUNT)
        expect(wbox).to_have_value(BAD_AMOUNT)
        expect(wbox).to_have_attribute("aria-invalid", "true")
        expect(wbox).to_be_focused()
        assert wbox.evaluate("el => el.selectionStart") == caret
        assert supplied + " for " in ann.inner_text()
        expect(role(page, "link", "View receipt").or_(page.get_by_text(supplied))).to_be_visible()
        assert "Enter digits with a comma before the decimals." in page.locator("body").inner_text()


def ui_swap(page, frm: str, to: str, amount: str) -> None:
    select(role(page, "combobox", "Pay with"), frm)
    select(role(page, "combobox", "Receive"), to)
    fill(role(page, "textbox", "Amount to pay"), amount)
    shows(page, role(page, "status", "Swap preview"), "You receive ")
    click(role(page, "button", "Get firm quote"))
    shows(page, role(page, "status", "Announcements"), "Quote ready. Firm until ")
    click(role(page, "button", "Swap now"))
    shows(page, role(page, "status", "Announcements"), "Swapped ")


def test_wf_lp_supply_happy(browser, app_url):
    prime(app_url)
    lp, lt = member(app_url, "liquidity_provider")
    transfer(app_url, lp["actor_id"], QUSD, 10 ** 10)
    tr, _ = member(app_url, "trader")
    transfer(app_url, tr["actor_id"], QUSD, 10 ** 10)
    with app_page(browser, f"{app_url}/supply?actor={lp['actor_id']}") as page, \
            app_page(browser, f"{app_url}/trade?actor={tr['actor_id']}") as tp:
        select(role(page, "combobox", "Pool"), QUSD)
        fill(role(page, "textbox", "Supply amount"), f"1{NNBSP}000")
        click(role(page, "button", "Supply"))
        shows(page, role(page, "status", "Announcements"), "Supplied 1\u202f000,000000 QUSD for ")
        card = page.get_by_role("article", name="QUSD pool")
        sp0 = value_of(card.inner_text(), "Share price")
        ui_swap(tp, QUSD, MBTC, f"5{NNBSP}000")
        fill(role(page, "textbox", "Withdraw amount"), "0,")
        ui_wait(page, lambda: int(value_of(card.inner_text(), "Share price").replace(",", "")) > int(sp0.replace(",", "")), "share price rise")
        expect(role(page, "textbox", "Withdraw amount")).to_have_value("0,")
        keys: list[str] = []
        page.on("request", lambda r: "/withdrawals" in r.url and keys.append(r.headers.get("idempotency-key", "")))
        fill(role(page, "textbox", "Withdraw amount"), "0,5")
        click(role(page, "button", "Withdraw"))
        shows(page, role(page, "status", "Announcements"), "Withdrew 0,500000 QUSD.")
        click(role(page, "button", "Withdraw"))
        ui_wait(page, lambda: len(keys) >= 2, "second Withdraw press sent")
        assert keys[0] == keys[1], "same inputs resend the same Idempotency-Key"
        wd = [p for p in postings(app_url, QUSD) if p["kind"] == "withdrawal" and leg(p["legs"], f"wallet:{lp['actor_id']}", QUSD)]
        assert len(wd) == 1 and leg(wd[0]["legs"], f"wallet:{lp['actor_id']}", QUSD) == minor("0,5", QUSD)
        click(role(page, "link", "View receipt"))
        expect(role(page, "heading", "Settlement receipt")).to_be_visible()
        shows(page, role(page, "status", "Statement status"), "Settled")
    sid = page.url.rsplit("/", 1)[-1]
    keys3 = S3().keys(f"statements/withdrawal/{sid}")
    assert {f"statements/withdrawal/{sid}.json", f"statements/withdrawal/{sid}.pdf"} <= set(keys3)


def test_wf_lp_supply_refused(browser, app_url):
    lp, lt = member(app_url, "liquidity_provider")
    transfer(app_url, lp["actor_id"], QUSD, 10 ** 8)
    ok(call(app_url, "POST", f"/api/pools/{QUSD}/supplies", lt, {"amount": str(10 ** 8)}))
    before = wallet(app_url, lt)
    with app_page(browser, f"{app_url}/supply?actor={lp['actor_id']}") as page:
        select(role(page, "combobox", "Pool"), QUSD)
        box = role(page, "textbox", "Withdraw amount")
        fill(box, "1000")
        click(role(page, "button", "Withdraw"))
        shows(page, role(page, "alert", "Problems"), "Check the highlighted fields.")
        shows(page, page.locator("body"), "Your shares are worth ")
        expect(box).to_be_focused()
    assert wallet(app_url, lt) == before


def test_live_swap_preview_latest_wins(browser, app_url):
    prime(app_url)
    tr, tt = member(app_url, "trader")
    hold = {"100000000": None, "99999900000000": None}
    with app_page(browser, f"{app_url}/trade?actor={tr['actor_id']}") as page:
        prev = role(page, "status", "Swap preview")
        shows(page, prev, "Type an amount to see the output.")
        select(role(page, "combobox", "Pay with"), MBTC)
        select(role(page, "combobox", "Receive"), QUSD)

        def handler(route):
            amt = parse_qs(urlsplit(route.request.url).query).get("amount_in", [""])[0]
            if amt in hold and hold[amt] is None:
                hold[amt] = route
                return
            route.continue_()

        page.route("**/api/swap/preview**", handler)
        box = role(page, "textbox", "Amount to pay")
        for first, second, second_units in (("1", "2", 200000000), (f"999{NNBSP}999", "3", 300000000)):
            key = str(int(first.replace(NNBSP, "")) * 10 ** 8)
            fill(box, first)
            ui_wait(page, lambda: hold[key] is not None, f"preview request for {first}")
            fill(box, second)
            exp = ok(call(app_url, "GET", f"/api/swap/preview?from_asset=MBTC&to_asset=QUSD&amount_in={second_units}", tt), 200)
            want = f"You receive {desk(int(exp['amount_out']), QUSD)} QUSD"
            shows(page, prev, want)
            hold[key].continue_()
            advance(page, REFRESH_MS)
            assert want in prev.inner_text() and "Only " not in prev.inner_text()


def test_firm_quote_fee_split(app_url):
    prime(app_url)
    tr, tt = member(app_url, "trader")
    transfer(app_url, tr["actor_id"], MBTC, COLLATERAL)
    q = ok(call(app_url, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": QUSD, "amount_in": "12345678"}))
    assert (q["fee"], q["amount_out"]) == ("37038", "7877529600")
    rf = pool(app_url, MBTC)["params"]["reserve_factor_bps"]
    assert q["fee_to_reserve"] == str(split_reserve(37038, rf))
    assert int(q["fee_to_reserve"]) + int(q["fee_to_supply"]) == 37038
    tie = ok(call(app_url, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": QUSD, "amount_in": "1500"}))
    assert tie["fee"] == "5" and tie["fee_to_supply"] == str(5 - split_reserve(5, rf))
    assert tie["amount_out"] == str((1500 - 5) * units(P_MBTC) * 10 ** 6 // (units(P_QUSD) * 10 ** 8))
    life = iso_seconds(pools(app_url)["quote_lifetime"])
    assert epoch(q["expires_at"]) - epoch(q["server_time"]) == life and ISO.match(q["expires_at"])
    problem(call(app_url, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": MBTC, "amount_in": "1500"}),
            "validation_failed", field="to_asset", message="Choose two different assets.")
    transfer(app_url, tr["actor_id"], QUSD, 10 ** 6)
    problem(call(app_url, "POST", "/api/swap/quotes", tt, {"from_asset": QUSD, "to_asset": MBTC, "amount_in": "100"}),
            "validation_failed", field="amount_in", message="This amount is too small to receive anything.")


def test_swap_execution_expiry_single_use(svix):
    base = short()
    prime(base)
    tr, tt = member(base, "trader")
    transfer(base, tr["actor_id"], MBTC, COLLATERAL)
    q = ok(call(base, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": QUSD, "amount_in": "12345678"}))
    other, ot = member(base, "trader")
    problem(call(base, "POST", "/api/swaps", ot, {"quote_id": q["quote_id"]}, key=idempotency_key()), "forbidden")
    s = ok(call(base, "POST", "/api/swaps", tt, {"quote_id": q["quote_id"]}, key=idempotency_key()))
    for f in ("amount_in", "fee", "fee_to_supply", "fee_to_reserve", "amount_out", "price_from", "price_to"):
        assert s[f] == q[f]
    p = posting(base, s["posting_id"], MBTC)
    assert_balanced(p)
    me = f"wallet:{tr['actor_id']}"
    assert leg(p["legs"], me, MBTC) == -12345678 and leg(p["legs"], me, QUSD) == int(q["amount_out"])
    assert leg(p["legs"], "supply", MBTC) == int(q["fee_to_supply"]) and leg(p["legs"], "reserve", MBTC) == int(q["fee_to_reserve"])
    assert leg(p["legs"], "swap", MBTC) == 12345678 - int(q["fee"]) and leg(p["legs"], "swap", QUSD) == -int(q["amount_out"])
    w = wallet(base, tt)
    assert w[MBTC] == COLLATERAL - 12345678 and w[QUSD] == int(q["amount_out"])
    problem(call(base, "POST", "/api/swaps", tt, {"quote_id": q["quote_id"]}, key=idempotency_key()), "quote_used")
    problem(call(base, "POST", "/api/swaps", tt, {"quote_id": "no-such-quote"}, key=idempotency_key()), "not_found")
    q2 = ok(call(base, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": QUSD, "amount_in": "1000000"}))
    poll(lambda: server_epoch(base) >= epoch(q2["expires_at"]), "server clock past expires_at")
    problem(call(base, "POST", "/api/swaps", tt, {"quote_id": q2["quote_id"]}, key=idempotency_key()), "quote_expired")
    assert wallet(base, tt) == w
    poll(lambda: pool(base, MBTC)["market_state"] == "stale_feed", "MBTC market to go stale on the short instance")
    problem(call(base, "GET", "/api/swap/preview?from_asset=MBTC&to_asset=QUSD&amount_in=1000000", tt), "market_stale", detail=SWAP_STALE)
    problem(call(base, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": QUSD, "amount_in": "1000000"}), "market_stale", detail=SWAP_STALE)


def test_wf_swap_happy(browser, app_url):
    prime(app_url)
    tr, tt = member(app_url, "trader")
    transfer(app_url, tr["actor_id"], MBTC, COLLATERAL)
    lp, _ = member(app_url, "liquidity_provider")
    with app_page(browser, f"{app_url}/trade?actor={tr['actor_id']}") as tp, \
            app_page(browser, f"{app_url}/supply?actor={lp['actor_id']}") as lpp:
        card = lpp.get_by_role("article", name="MBTC pool")
        shows(lpp, card, "Share price")
        sp0 = value_of(card.inner_text(), "Share price")
        select(role(tp, "combobox", "Pay with"), MBTC)
        select(role(tp, "combobox", "Receive"), QUSD)
        box = role(tp, "textbox", "Amount to pay")
        box.focus()
        box.press_sequentially("0,12345678")
        prev = role(tp, "status", "Swap preview")
        shows(tp, prev, "Pool fee 0,00037038 MBTC")
        shows(tp, prev, f"You receive 7{NNBSP}877,529600 QUSD")
        click(role(tp, "button", "Get firm quote"))
        shows(tp, role(tp, "region", "Firm quote"), f"7{NNBSP}877,529600")
        shows(tp, role(tp, "region", "Firm quote"), "Firm until ")
        click(role(tp, "button", "Swap now"))
        shows(tp, role(tp, "status", "Announcements"), f"Swapped 0,12345678 MBTC for 7{NNBSP}877,529600 QUSD.")
        shows(tp, role(tp, "region", "Swap receipt"), f"7{NNBSP}877,529600")
        shows(tp, role(tp, "region", "Wallet"), f"7{NNBSP}877,529600")
        ui_wait(lpp, lambda: int(value_of(card.inner_text(), "Share price").replace(",", "")) > int(sp0.replace(",", "")), "MBTC share price rise")
    w = wallet(app_url, tt)
    assert w[MBTC] == COLLATERAL - 12345678 and w[QUSD] == 7877529600


def test_wf_swap_expired(browser):
    base = short()
    prime(base)
    tr, tt = member(base, "trader")
    transfer(base, tr["actor_id"], MBTC, COLLATERAL)
    with app_page(browser, f"{base}/trade?actor={tr['actor_id']}") as tp:
        select(role(tp, "combobox", "Pay with"), MBTC)
        select(role(tp, "combobox", "Receive"), QUSD)
        fill(role(tp, "textbox", "Amount to pay"), "0,01")
        with tp.expect_response("**/api/swap/quotes") as resp:
            click(role(tp, "button", "Get firm quote"))
        q = resp.value.json()
        poll(lambda: server_epoch(base) >= epoch(q["expires_at"]), "quote expiry on the server clock")
        click(role(tp, "button", "Swap now"))
        shows(tp, role(tp, "alert", "Problems"), "This quote has expired. Get a new quote.")
    assert wallet(base, tt)[MBTC] == COLLATERAL


def test_positions_and_draws_within_ltv(app_url):
    prime(app_url)
    a, t = member(app_url, "borrower")
    transfer(app_url, a["actor_id"], MBTC, COLLATERAL)
    problem(call(app_url, "POST", "/api/positions", t, {"collateral_asset": MBTC, "debt_asset": MBTC, "collateral_amount": "1"}),
            "validation_failed", field="debt_asset", message="Choose two different assets.")
    p = ok(call(app_url, "POST", "/api/positions", t, {"collateral_asset": MBTC, "debt_asset": QUSD, "collateral_amount": str(COLLATERAL)}))
    assert p["state"] == "healthy" and p["debt"] == "0" and p["health_factor"] is None and p["collateral_amount"] == str(COLLATERAL)
    assert wallet(app_url, t)[MBTC] == 0
    problem(call(app_url, "POST", "/api/positions", t, {"collateral_asset": MBTC, "debt_asset": QUSD, "collateral_amount": "1"}),
            "validation_failed", field="collateral_amount", message="Your wallet holds 0,00000000 MBTC.")
    ltv = pool(app_url, MBTC)["params"]["ltv_bps"]
    cap = COLLATERAL * units(P_MBTC) * ltv * 10 ** 6 // (units(P_QUSD) * 10 ** 8 * BPS)
    problem(draw(app_url, t, p["position_id"], cap + 1), "validation_failed", field="amount",
            message=f"This draw would take the position past its {ltv // 100},{ltv % 100:02d}% loan-to-value limit.")
    s = ok(draw(app_url, t, p["position_id"], cap))
    assert s["kind"] == "draw" and s["debt_after"] == str(cap) and s["amount"] == str(cap)
    assert s["statement_key"] == f"statements/draw/{s['settlement_id']}.json"
    stmt = json.loads(S3().get(s["statement_key"]))
    assert stmt["amount"] == str(cap) and stmt["position_id"] == p["position_id"]
    assert "statement_status" not in stmt and "webhook_status" not in stmt
    assert wallet(app_url, t)[QUSD] == cap


def test_idempotent_draws_and_swaps(app_url):
    prime(app_url)
    a, t, pid = borrow(app_url, d_amt=None)
    key = idempotency_key()
    first = call(app_url, "POST", f"/api/positions/{pid}/draws", t, None, key=key, raw=b'{"amount":"1000000"}')
    assert first.status_code == 201
    replay = call(app_url, "POST", f"/api/positions/{pid}/draws", t, None, key=key, raw=b'{ "amount" : "1000000" }')
    assert replay.status_code == 201 and replay.headers.get("idempotency-replayed") == "true"
    assert replay.json() == first.json()
    assert wallet(app_url, t)[QUSD] == 10 ** 6
    problem(draw(app_url, t, pid, 2 * 10 ** 6, key=key), "idempotency_key_reused")
    problem(draw(app_url, t, pid, 1, key="k" * 129), "idempotency_key_required")
    k2 = idempotency_key()
    bar = threading.Barrier(2)

    def go(_):
        bar.wait()
        return draw(app_url, t, pid, 3 * 10 ** 6, key=k2)

    with cf.ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(go, range(2)))
    assert [r.status_code for r in rs] == [201, 201]
    assert rs[0].json()["settlement_id"] == rs[1].json()["settlement_id"]
    assert wallet(app_url, t)[QUSD] == 4 * 10 ** 6
    tr, tt = member(app_url, "trader")
    transfer(app_url, tr["actor_id"], MBTC, COLLATERAL)
    q = ok(call(app_url, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": QUSD, "amount_in": "1000000"}))
    sk = idempotency_key()
    s1 = ok(call(app_url, "POST", "/api/swaps", tt, {"quote_id": q["quote_id"]}, key=sk))
    s2 = call(app_url, "POST", "/api/swaps", tt, {"quote_id": q["quote_id"]}, key=sk)
    assert s2.status_code == 201 and s2.json() == s1 and s2.headers.get("idempotency-replayed") == "true"
    assert wallet(app_url, tt)[MBTC] == COLLATERAL - 10 ** 6


def test_interest_accrual(app_url):
    prime(app_url)
    a, t, pid = borrow(app_url)
    p = pool(app_url, QUSD)
    c, U = p["curve"], p["utilization_bps"]
    rate = c["base_bps"] + (c["slope1_bps"] * U // c["kink_bps"] if U <= c["kink_bps"]
                            else c["slope1_bps"] + c["slope2_bps"] * (U - c["kink_bps"]) // (BPS - c["kink_bps"]))
    assert p["borrow_rate_bps"] == rate
    assert p["supply_rate_bps"] == rate * U * (BPS - p["params"]["reserve_factor_bps"]) // 100000000
    idx0, debt0 = int(p["borrow_index"]), int(position(app_url, pid)["debt"])
    assert idx0 >= 10 ** 27
    poll(lambda: int(position(app_url, pid)["debt"]) > debt0, "debt to grow per second of server time")
    assert int(pool(app_url, QUSD)["borrow_index"]) > idx0
    rf = p["params"]["reserve_factor_bps"]
    acc = poll(lambda: [x for x in postings(app_url, QUSD) if x["kind"] == "accrual" and leg(x["legs"], f"loan:{pid}", QUSD)],
               "an accrual posting on the position's loan")
    for x in acc:
        assert_balanced(x)
        i = -sum(int(l["amount"]) for l in x["legs"] if l["account"].startswith("loan:"))
        assert leg(x["legs"], "reserve", QUSD) == split_reserve(i, rf)
        assert leg(x["legs"], "supply", QUSD) == i - split_reserve(i, rf)


def test_repayment_and_collateral(app_url):
    prime(app_url)
    a, t, pid = borrow(app_url)
    transfer(app_url, a["actor_id"], QUSD, FUND_QUSD)
    transfer(app_url, a["actor_id"], MBTC, COLLATERAL)
    r = ok(call(app_url, "POST", f"/api/positions/{pid}/repayments", t, {"amount": "1000000"}))
    assert int(r["debt_after"]) < DRAW and r["state_after"] in ("healthy", "warned") and re.fullmatch(r"\d+\.\d{4}", r["health_factor_after"])
    b = problem(call(app_url, "POST", f"/api/positions/{pid}/repayments", t, {"amount": str(FUND_QUSD)}), "validation_failed")
    assert b["errors"]["amount"].startswith("The current debt is ") and b["errors"]["amount"].endswith(" QUSD.")
    pos = ok(call(app_url, "POST", f"/api/positions/{pid}/collateral", t, {"amount": str(COLLATERAL)}))
    assert pos["collateral_amount"] == str(2 * COLLATERAL)
    ltv = pool(app_url, MBTC)["params"]["ltv_bps"]
    problem(call(app_url, "POST", f"/api/positions/{pid}/collateral-withdrawals", t, {"amount": str(2 * COLLATERAL - 10 ** 7)}),
            "validation_failed", field="amount",
            message=f"This withdrawal would take the position past its {ltv // 100},{ltv % 100:02d}% loan-to-value limit.")
    full = ok(call(app_url, "POST", f"/api/positions/{pid}/repayments", t, {"amount": "all"}))
    assert full["debt_after"] == "0" and full["health_factor_after"] is None and full["state_after"] == "healthy"
    problem(call(app_url, "POST", f"/api/positions/{pid}/collateral-withdrawals", t, {"amount": str(3 * COLLATERAL)}),
            "validation_failed", field="amount", message=f"The position holds {desk(2 * COLLATERAL, MBTC)} MBTC.")
    closed = ok(call(app_url, "POST", f"/api/positions/{pid}/collateral-withdrawals", t, {"amount": str(2 * COLLATERAL)}))
    assert closed["state"] == "closed"
    problem(call(app_url, "POST", f"/api/positions/{pid}/collateral", t, {"amount": "1"}), "position_closed")


def test_keyboard_complete_borrowing(browser, app_url):
    prime(app_url)
    a, t = member(app_url, "borrower")
    transfer(app_url, a["actor_id"], MBTC, COLLATERAL)
    with app_page(browser, f"{app_url}/borrow?actor={a['actor_id']}") as page:
        select(role(page, "combobox", "Collateral asset"), MBTC)
        select(role(page, "combobox", "Borrow asset"), QUSD)
        role(page, "textbox", "Collateral amount").focus()
        page.keyboard.type("0,5")
        page.keyboard.press("Enter")
        shows(page, role(page, "status", "Announcements"), "Position opened with 0,50000000 MBTC collateral.")
        expect(role(page, "button", "Open position")).to_be_focused()
        nxt = tab_order(page, 1)[0]
        assert nxt.startswith("Position "), f"next Tab stop after Open position was {nxt!r}"
        pid = nxt.removeprefix("Position ")
        page.keyboard.press("Enter")
        expect(role(page, "heading", f"Position {pid}")).to_be_visible()
        lost = {"n": 0}

        def drop_first(route):
            if lost["n"] == 0:
                lost["n"] += 1
                route.fetch()
                route.abort("failed")
                return
            route.continue_()

        page.route("**/api/positions/*/draws", drop_first)
        role(page, "textbox", "Draw amount").focus()
        page.keyboard.type("100")
        page.keyboard.press("Enter")
        shows(page, role(page, "alert", "Problems"), NET_FAIL)
        expect(role(page, "button", "Draw")).to_be_focused()
        assert tab_order(page, 1) == ["Retry"]
        page.keyboard.press("Enter")
        shows(page, role(page, "status", "Announcements"), "Drew 100,000000 QUSD. Health factor now ")
        role(page, "textbox", "Repay amount").focus()
        page.keyboard.type("40")
        page.keyboard.press("Enter")
        shows(page, role(page, "status", "Announcements"), "Repaid 40,000000 QUSD.")
    assert wallet(app_url, t)[QUSD] == (100 - 40) * 10 ** 6
    draws = [p for p in postings(app_url, QUSD) if p["kind"] == "draw" and leg(p["legs"], f"loan:{pid}", QUSD)]
    assert len(draws) == 1


def test_wf_borrow_happy(browser, app_url):
    prime(app_url)
    a, t, pid = borrow(app_url, d_amt=None)
    transfer(app_url, a["actor_id"], QUSD, 10 ** 7)
    with app_page(browser, f"{app_url}/positions/{pid}?actor={a['actor_id']}") as page, \
            app_page(browser, f"{app_url}/ledger?actor={STEWARD}") as lg:
        state = {"n": 0}

        def drop_first(route):
            state["n"] += 1
            if state["n"] == 1:
                route.fetch()
                route.abort("failed")
                return
            route.continue_()

        page.route("**/api/positions/*/draws", drop_first)
        fill(role(page, "textbox", "Draw amount"), f"1{NNBSP}000,5")
        click(role(page, "button", "Draw"))
        shows(page, role(page, "alert", "Problems"), NET_FAIL)
        click(role(page, "button", "Retry"))
        shows(page, role(page, "status", "Announcements"), f"Drew 1{NNBSP}000,500000 QUSD.")
        click(role(page, "link", "View receipt"))
        shows(page, role(page, "table", "Settlement legs"), f"loan:{pid}")
        page.go_back()
        click(role(page, "button", "Repay all"))
        shows(page, role(page, "status", "Announcements"), "No debt remains.")
        shows(page, role(page, "status", "Position state"), "Healthy")
        select(role(lg, "combobox", "Postings shown"), "200")
        shows(lg, role(lg, "table", "Postings"), f"loan:{pid}")
    assert position(app_url, pid)["debt"] == "0"
    draws = [p for p in postings(app_url, QUSD) if p["kind"] == "draw" and leg(p["legs"], f"loan:{pid}", QUSD)]
    assert len(draws) == 1 and leg(draws[0]["legs"], f"wallet:{a['actor_id']}", QUSD) == minor(f"1{NNBSP}000,5", QUSD)


def test_wf_borrow_ltv_refused(browser, app_url):
    prime(app_url)
    a, t, pid = borrow(app_url, d_amt=None)
    with app_page(browser, f"{app_url}/positions/{pid}?actor={a['actor_id']}") as page:
        box = role(page, "textbox", "Draw amount")
        fill(box, f"60{NNBSP}000")
        click(role(page, "button", "Draw"))
        shows(page, page.locator("body"), "This draw would take the position past its ")
        shows(page, role(page, "alert", "Problems"), "Check the highlighted fields.")
        expect(box).to_be_focused()
    assert wallet(app_url, t)[QUSD] == 0 and position(app_url, pid)["debt"] == "0"


def test_position_state_machine():
    base = short()
    prime(base)
    a, t, pid = borrow(base)
    assert position(base, pid)["state"] == "healthy"
    lq, lt = liquidator(base)
    prime(base, WARN_PRICE)
    assert position(base, pid)["state"] == "warned"
    problem(liquidate(base, lt, pid, 1, 0), "not_liquidatable")
    prime(base, DEEP_PRICE)
    g = position(base, pid)
    assert g["state"] == "liquidatable_grace" and ISO.match(g["grace_ends_at"]) and g["max_repay"] == "0"
    problem(liquidate(base, lt, pid, 1, 0), "in_grace")
    p = wait_state(base, pid, ("liquidatable",))
    assert p["grace_ends_at"] is None
    prime(base, DEEP_PRICE)
    f = ok(liquidate(base, lt, pid, int(position(base, pid)["max_repay"]), 0))
    assert f["state_after"] == "partially_liquidated"
    assert position(base, pid)["state"] == "partially_liquidated"
    transfer(base, a["actor_id"], QUSD, FUND_QUSD)
    ok(call(base, "POST", f"/api/positions/{pid}/repayments", t, {"amount": "all"}))
    assert position(base, pid)["state"] == "healthy"
    rest = position(base, pid)["collateral_amount"]
    assert ok(call(base, "POST", f"/api/positions/{pid}/collateral-withdrawals", t, {"amount": rest}))["state"] == "closed"
    problem(call(base, "POST", f"/api/positions/{pid}/repayments", t, {"amount": "1"}), "position_closed")


def test_health_factor_and_liquidation_price():
    base = short()
    prime(base, GRACE_PRICE)
    cases = [(MBTC, COLLATERAL, 30000000000, units(GRACE_PRICE)), (METH, 10 ** 19, 16000000000, units(P_METH))]
    for collateral, c_amt, d_amt, pc in cases:
        _, _, pid = borrow(base, collateral, QUSD, c_amt, d_amt)
        lt = pool(base, collateral)["params"]["liquidation_threshold_bps"]
        p = position(base, pid)
        hf, lp = hf_expected(p, pc, units(P_QUSD), lt)
        assert (p["health_factor"], p["liquidation_price"]) == (hf, lp)
    _, _, empty = borrow(base, d_amt=None)
    p = position(base, empty)
    assert p["health_factor"] is None and p["liquidation_price"] is None


def test_background_evaluation_and_margin_notice(mail, svix):
    base = short()
    prime(base)
    a, t, pid = borrow(base)
    prime(base, WARN_PRICE)
    hf = position(base, pid)["health_factor"]
    msgs = poll(lambda: mails(mail, a["email"], f"Margin notice: {pid} "), "margin notice email")
    assert msgs[0]["Subject"] == f"Margin notice: {pid} at health factor {desk_hf(hf)}"
    assert "Repay or add collateral to stay above health factor 1." in text(msgs[0])
    assert mail_from_address() in addresses(msgs[0].get("From"))
    prime(base, GRACE_PRICE)
    grace = poll(lambda: [e for e in events(svix, pid) if e["payload"]["data"].get("to") == "liquidatable_grace"], "grace event")
    end = grace[0]["payload"]["data"]["grace_ends_at"]
    late = poll(lambda: [e for e in events(svix, pid) if e["payload"]["data"].get("to") == "liquidatable"],
                "background grace expiry event with no request touching the position")
    assert late[0]["payload"]["occurred_at"] == end
    assert len(mails(mail, a["email"], f"Margin notice: {pid} ")) == 1


def test_server_decided_status(browser):
    base = short()
    prime(base)
    a, t, pid = borrow(base)
    prime(base, GRACE_PRICE)
    assert position(base, pid)["state"] == "liquidatable_grace"
    with app_page(browser, f"{base}/positions/{pid}?actor={a['actor_id']}") as page:
        page.clock.set_system_time(FAR_CLOCK)
        page.reload()
        st = role(page, "status", "Position state")
        shows(page, st, "Liquidatable in grace", seconds=4)
        assert "Grace ends" in page.locator("body").inner_text()
        api = wait_state(base, pid, ("liquidatable",))
        shows(page, st, "Liquidatable now")
        body = page.locator("body").inner_text()
        assert value_of(body, "Health factor") == desk_hf(api["health_factor"])


def test_wf_margin_grace_happy(browser, mail):
    base = short()
    prime(base)
    a, t, pid = borrow(base)
    transfer(base, a["actor_id"], QUSD, FUND_QUSD)
    with app_page(browser, f"{base}/positions/{pid}?actor={a['actor_id']}") as bp, \
            app_page(browser, f"{base}/steward?actor={STEWARD}") as sp:
        bp.clock.set_system_time(FAR_CLOCK)
        st = role(bp, "status", "Position state")
        shows(bp, st, "Healthy")
        select(role(sp, "combobox", "Asset"), MBTC)
        fill(role(sp, "textbox", "New price"), f"56{NNBSP}000")
        click(role(sp, "button", "Post price"))
        shows(sp, role(sp, "status", "Announcements"), "Price posted.")
        shows(bp, st, "Margin warning")
        poll(lambda: mails(mail, a["email"], f"Margin notice: {pid} "), "one margin email")
        prime(base, GRACE_PRICE)
        shows(bp, st, "Liquidatable in grace")
        shows(bp, st, "Liquidatable now")
        fill(role(bp, "textbox", "Repay amount"), f"20{NNBSP}000")
        click(role(bp, "button", "Repay"))
        shows(bp, role(bp, "status", "Announcements"), f"Repaid 20{NNBSP}000,000000 QUSD. Health factor now ")
        shows(bp, st, "Healthy")
    assert position(base, pid)["state"] == "healthy"
    assert len(mails(mail, a["email"], f"Margin notice: {pid} ")) == 1


def test_wf_margin_grace_notice_list(browser, mail):
    base = short()
    prime(base)
    a, t, pid = borrow(base)
    transfer(base, a["actor_id"], MBTC, COLLATERAL)
    prime(base, WARN_PRICE)
    poll(lambda: [n for n in position(base, pid)["notices"] if n["kind"] == "margin" and n["status"] == "sent"], "margin notice sent")
    with app_page(browser, f"{base}/positions/{pid}?actor={a['actor_id']}") as bp:
        shows(bp, role(bp, "list", "Notices"), "Margin notice sent.")
        fill(role(bp, "textbox", "Collateral change"), "1")
        click(role(bp, "button", "Add collateral"))
        shows(bp, role(bp, "status", "Announcements"), "Collateral added. Health factor now ")
        shows(bp, role(bp, "status", "Position state"), "Healthy")
    assert position(base, pid)["state"] == "healthy" and len(mails(mail, a["email"], f"Margin notice: {pid} ")) == 1


def test_manual_price_posts():
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    big = "This moves the price by more than 60%. Confirm the large move to post it."
    problem(post_price(base, MBTC, "25599.99999999", None), "validation_failed", field="price", message=big)
    r = ok(post_price(base, MBTC, "25600", False))
    assert r["price"] == api_price(units("25600")) and r["previous_price"] == "64000.00000000" and r["source"] == "manual"
    assert ISO.match(r["posted_at"])
    below = [p for p in ok(call(base, "GET", "/api/positions", tok(base, STEWARD)), 200)["positions"]
             if p["health_factor"] is not None and units(p["health_factor"]) < 10 ** 8]
    assert r["positions_below_one"] == len(below) and position(base, pid)["state"] == "liquidatable_grace"
    assert ok(post_price(base, MBTC, "40960", None))["price"] == api_price(units("40960"))
    for bad in ("0", "1.123456789"):
        problem(post_price(base, MBTC, bad), "validation_failed", field="price",
                message="Enter a price above zero with at most 8 decimal places.")
    problem(call(base, "POST", "/api/prices", tok(base, STEWARD), {"asset": MBTC, "price": P_MBTC, "confirm_large_move": "yes"}),
            "validation_failed", field="confirm_large_move", message="Send true or false.")
    problem(call(base, "POST", "/api/prices", tok(base, TRADER), {"asset": MBTC, "price": P_MBTC}), "forbidden")
    prime(base)


def test_price_evidence_as_submitted(wiremock):
    base = short()
    prime(base)
    st = tok(base, STEWARD)
    r = ok(call(base, "POST", "/api/prices", st, None, raw=b'{"asset":"MBTC","price":"56000.5"}'))
    ev = json.loads(S3("-short").get(r["evidence_key"]))
    assert r["evidence_key"] == f"evidence/prices/{r['price_post_id']}.json"
    assert ev["submitted"] == {"asset": MBTC, "price": "56000.5"} and ev["price"] == "56000.50000000"
    assert ev["source"] == "manual" and ev["price_post_id"] == r["price_post_id"]
    now = oracle_now(base, MBTC)
    raw = '{ "feed":"MBTC-USD",  "round": %d,\n "price": {"mantissa":"5700000000000","exponent":-8}, "publish_time": %d }' % (now, now + 1)
    feed(wiremock, PREFIX["short"], MBTC, now, "", 0, 0, raw=raw)
    post = poll(lambda: [p for p in ok(call(base, "GET", "/api/prices?asset=MBTC", st), 200)["prices"] if p["oracle_round"] == now],
                "oracle reading applied")[0]
    assert post["source"] == "oracle" and post["posted_by"] == "oracle"
    assert json.loads(S3("-short").get(post["evidence_key"]))["oracle_response"] == raw
    before = ok(call(base, "GET", "/api/prices?asset=MBTC", st), 200)["prices"]
    problem(post_price(minio_down(), MBTC, "57000"), "statement_store_unavailable")
    assert ok(call(base, "GET", "/api/prices?asset=MBTC", st), 200)["prices"] == before


def test_risk_parameters_conditional(app_url):
    prime(app_url)
    st = tok(app_url, STEWARD)
    _, _, pid = borrow(app_url, METH, QUSD, 10 ** 19, 24000000000)
    r = call(app_url, "GET", f"/api/assets/{METH}/risk", st)
    orig, etag = ok(r, 200), r.headers["etag"]
    assert not etag.startswith("W/")
    path = f"/api/assets/{METH}/risk"
    problem(call(app_url, "PATCH", path, st, {"reserve_factor_bps": 1500}), "precondition_required")
    problem(call(app_url, "PATCH", path, st, {"reserve_factor_bps": 1500}, If_Match="W/" + etag), "precondition_failed")
    cases = [({"ltv_bps": 8000}, "ltv_bps", "Loan-to-value must be above 0% and below the liquidation threshold."),
             ({"liquidation_threshold_bps": 9501}, "liquidation_threshold_bps", "Liquidation threshold must be above 0% and at most 95,00%."),
             ({"liquidation_bonus_bps": 2001}, "liquidation_bonus_bps", "Bonus must be from 0% to 20,00%, and the threshold times one plus the bonus must stay below 100%."),
             ({"liquidation_threshold_bps": 9500, "liquidation_bonus_bps": 600}, "liquidation_bonus_bps", "Bonus must be from 0% to 20,00%, and the threshold times one plus the bonus must stay below 100%."),
             ({"reserve_factor_bps": 5001}, "reserve_factor_bps", "Reserve factor must be from 0% to 50,00%.")]
    for body, field, msg in cases:
        problem(call(app_url, "PATCH", path, st, body, If_Match=etag), "validation_failed", field=field, message=msg)
    try:
        s = call(app_url, "PATCH", path, st, {"ltv_bps": 6900, "liquidation_threshold_bps": 7000}, If_Match=etag)
        body = ok(s, 200)
        assert body["liquidation_threshold_bps"] == 7000 and s.headers["etag"] != etag and body["positions_below_one"] >= 1
        assert position(app_url, pid)["state"] == "liquidatable_grace"
        problem(call(app_url, "PATCH", path, st, {"reserve_factor_bps": 1500}, If_Match=etag), "precondition_failed")
    finally:
        cur = call(app_url, "GET", path, st)
        call(app_url, "PATCH", path, st, {k: orig[k] for k in ("ltv_bps", "liquidation_threshold_bps", "liquidation_bonus_bps", "reserve_factor_bps")},
             If_Match=cur.headers["etag"])


def test_announced_price_and_repay(browser):
    base = short()
    prime(base)
    a, t, pid = borrow(base)
    with app_page(browser, f"{base}/steward?actor={STEWARD}") as sp:
        select(role(sp, "combobox", "Asset"), MBTC)
        fill(role(sp, "textbox", "New price"), f"60{NNBSP}000")
        btn = role(sp, "button", "Post price")
        with sp.expect_response("**/api/prices") as resp:
            click(btn)
        n = resp.value.json()["positions_below_one"]
        shows(sp, role(sp, "status", "Announcements"),
              f"Price posted. {n} {'position' if n == 1 else 'positions'} now below health factor 1.")
        expect(btn).to_be_focused()
    with app_page(browser, f"{base}/positions/{pid}?actor={a['actor_id']}") as bp:
        fill(role(bp, "textbox", "Repay amount"), "1")
        btn = role(bp, "button", "Repay")
        with bp.expect_response("**/repayments") as resp:
            click(btn)
        hf = resp.value.json()["health_factor_after"]
        shows(bp, role(bp, "status", "Announcements"), f"Repaid 1,000000 QUSD. Health factor now {desk_hf(hf)}.")
        expect(btn).to_be_focused()


def test_wf_price_post_happy(browser):
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, _ = liquidator(base)
    with app_page(browser, f"{base}/steward?actor={STEWARD}") as sp, \
            app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as lp:
        select(role(sp, "combobox", "Asset"), MBTC)
        fill(role(sp, "textbox", "New price"), f"25{NNBSP}000,5")
        click(role(sp, "button", "Post price"))
        shows(sp, sp.locator("body"), "This moves the price by more than 60%. Confirm the large move to post it.")
        expect(role(sp, "textbox", "New price")).to_be_focused()
        click(role(sp, "checkbox", "Confirm large move"))
        with sp.expect_response("**/api/prices") as resp:
            click(role(sp, "button", "Post price"))
        body = resp.value.json()
        assert body["price"] == api_price(units(desk_to_api(f"25{NNBSP}000,5")))
        n = body["positions_below_one"]
        shows(sp, role(sp, "status", "Announcements"), f"Price posted. {n} positions now below health factor 1.")
        ui_wait(lp, lambda: role(lp, "button", f"Liquidate {pid}").count() == 1, "position listed in the liquidator's queue")
    assert pid in [p["position_id"] for p in ok(call(base, "GET", "/api/liquidations/queue", tok(base, STEWARD)), 200)["positions"]]
    prime(base)


def test_wf_price_post_stale_save(browser, app_url):
    st = tok(app_url, STEWARD)
    path = f"/api/assets/{QUSD}/risk"
    orig = ok(call(app_url, "GET", path, st), 200)
    try:
        with app_page(browser, f"{app_url}/steward?actor={STEWARD}") as a, app_page(browser, f"{app_url}/steward?actor={STEWARD2}") as b:
            for p in (a, b):
                select(role(p, "combobox", "Asset"), QUSD)
                shows(p, p.locator("body"), "Save risk parameters")
            fill(role(a, "textbox", "Reserve factor (%)"), "10,05")
            click(role(a, "button", "Save risk parameters"))
            shows(a, role(a, "status", "Announcements"), "Risk parameters saved for QUSD.")
            fill(role(b, "textbox", "Reserve factor (%)"), "80,00")
            click(role(b, "button", "Save risk parameters"))
            shows(b, role(b, "alert", "Problems"), DETAIL["precondition_failed"][1])
            shows(b, b.locator("body"), "Now 10,05%")
            expect(role(b, "textbox", "Reserve factor (%)")).to_have_value("80,00")
        assert ok(call(app_url, "GET", path, st), 200)["reserve_factor_bps"] == minor("10,05", QUSD) // 10 ** 4
    finally:
        cur = call(app_url, "GET", path, st)
        call(app_url, "PATCH", path, st, {"reserve_factor_bps": orig["reserve_factor_bps"]}, If_Match=cur.headers["etag"])


def test_oracle_readings(wiremock):
    base = short()
    prime(base)
    for asset in (QUSD, MBTC, METH):
        reqs = poll(lambda: wiremock.requests(f"{PREFIX['short']}/feeds/{asset}-USD/latest"), f"poll of {asset}")
        assert all("?" not in (r.get("url") or "") for r in reqs)
    now = oracle_now(base, MBTC)
    mant = "640012345678901"
    feed(wiremock, PREFIX["short"], MBTC, now, mant, -10, now + 1)
    p = poll(lambda: (x := pool(base, MBTC))["oracle_round"] == now and x, "exponent -10 reading applied")
    assert p["price"] == api_price(int(mant) // 10 ** 2) and p["price_source"] == "oracle" and p["oracle_status"] == "ok"
    feed(wiremock, PREFIX["short"], MBTC, now + 1, "65000", 0, now + 2)
    p = poll(lambda: (x := pool(base, MBTC))["oracle_round"] == now + 1 and x, "exponent 0 reading applied")
    assert p["price"] == api_price(units("65000")) and p["price_age_seconds"] >= 0
    manual = ok(post_price(base, MBTC, "64000"))
    feed(wiremock, PREFIX["short"], MBTC, now + 2, "66000", 0, epoch(manual["posted_at"]) - 1)
    poll(lambda: pool(base, MBTC)["oracle_status"] == "not_newer", "not_newer for an older publication")
    assert pool(base, MBTC)["price"] == "64000.00000000"
    later = server_epoch(base) + 1
    feed(wiremock, PREFIX["short"], MBTC, now + 3, "66000", 0, later)
    poll(lambda: pool(base, MBTC)["oracle_round"] == now + 3, "later publication takes over")
    st = tok(base, STEWARD)
    assert len([x for x in ok(call(base, "GET", "/api/prices?asset=MBTC", st), 200)["prices"] if x["oracle_round"] == now + 3]) == 1
    prime(base)


FAULTS = ["unreachable", "slow", "malformed", "wrong_feed", "future", "zero_price", "old_round", "large_move"]


@pytest.mark.parametrize("case", FAULTS, ids=FAULTS)
def test_oracle_faults_and_recovery(wiremock, case):
    base = short()
    prime(base)
    now = oracle_now(base, MBTC)
    path = f"{PREFIX['short']}/feeds/MBTC-USD/latest"
    feed(wiremock, PREFIX["short"], MBTC, now, "6500000000000", -8, now + 1)
    poll(lambda: pool(base, MBTC)["oracle_round"] == now, "baseline oracle reading")
    t = now + 2
    expected = {"unreachable": "unreachable", "slow": "unreachable", "old_round": "old_round", "large_move": "large_move"}.get(case, "malformed")
    if case == "unreachable":
        wiremock.fault("GET", path)
    elif case == "slow":
        wiremock.stub("GET", path, json={"feed": "MBTC-USD", "round": now + 1, "price": {"mantissa": "6600000000000", "exponent": -8}, "publish_time": t}, delay_ms=SLOW_MS)
    elif case == "malformed":
        feed(wiremock, PREFIX["short"], MBTC, 0, "", 0, 0, raw='{"feed":"MBTC-USD"}')
    elif case == "wrong_feed":
        feed(wiremock, PREFIX["short"], MBTC, 0, "", 0, 0, raw=json.dumps({"feed": "METH-USD", "round": now + 1, "price": {"mantissa": "6600000000000", "exponent": -8}, "publish_time": t}))
    elif case == "future":
        feed(wiremock, PREFIX["short"], MBTC, now + 1, "6600000000000", -8, now + WAIT_S)
    elif case == "zero_price":
        feed(wiremock, PREFIX["short"], MBTC, now + 1, "1", -18, t)
    elif case == "old_round":
        feed(wiremock, PREFIX["short"], MBTC, now - 1, "6600000000000", -8, t)
    else:
        feed(wiremock, PREFIX["short"], MBTC, now + 1, "19500000000000", -8, t)
    poll(lambda: pool(base, MBTC)["oracle_status"] == expected, f"oracle_status {expected}")
    p = pool(base, MBTC)
    assert p["price"] == api_price(units("65000")) and p["oracle_round"] == now
    if case == "unreachable":
        assert pool(oracle_down(), MBTC)["oracle_status"] == "unreachable"
    fresh = server_epoch(base) + 1
    feed(wiremock, PREFIX["short"], MBTC, now + 5, "6600000000000", -8, fresh)
    p = poll(lambda: (x := pool(base, MBTC))["oracle_round"] == now + 5 and x, "recovery on the next poll")
    assert p["price"] == api_price(units("66000")) and p["oracle_status"] == "ok"
    prime(base)


def test_wf_oracle_feed_happy(browser, wiremock):
    base = short()
    prime(base)
    a, _, _ = borrow(base, d_amt=None)
    now = oracle_now(base, MBTC)
    with app_page(browser, f"{base}/steward?actor={STEWARD}") as sp, app_page(browser, f"{base}/borrow?actor={a['actor_id']}") as bp:
        feed(wiremock, PREFIX["short"], MBTC, now, "6500000000000", -8, now + 1)
        for pg in (sp, bp):
            grp = role(pg, "group", "MBTC price")
            shows(pg, grp, f"$65{NNBSP}000,00000000")
            shows(pg, grp, f"Oracle round {now}")
        steps = [("unreachable", "Couldn’t reach the price oracle – showing the last good price"),
                 ("malformed", "The price oracle sent an unreadable reading – showing the last good price"),
                 ("old_round", "The price oracle sent an older round – ignored")]
        for kind, copy in steps:
            if kind == "unreachable":
                wiremock.fault("GET", f"{PREFIX['short']}/feeds/MBTC-USD/latest")
            elif kind == "malformed":
                feed(wiremock, PREFIX["short"], MBTC, 0, "", 0, 0, raw="{")
            else:
                feed(wiremock, PREFIX["short"], MBTC, now - 1, "6600000000000", -8, now + 2)
            for pg in (sp, bp):
                shows(pg, role(pg, "group", "MBTC price"), copy)
                assert f"$65{NNBSP}000,00000000" in role(pg, "group", "MBTC price").inner_text()
        select(role(sp, "combobox", "Asset"), MBTC)
        fill(role(sp, "textbox", "New price"), f"64{NNBSP}500")
        click(role(sp, "button", "Post price"))
        shows(sp, role(sp, "status", "Announcements"), "Price posted.")
        posted = epoch(pool(base, MBTC)["price_posted_at"])
        feed(wiremock, PREFIX["short"], MBTC, now + 1, "6600000000000", -8, posted - 1)
        shows(bp, role(bp, "group", "MBTC price"), "Manual post holds – the oracle has nothing newer")
        shows(bp, role(bp, "group", "MBTC price"), "Manual post")
        feed(wiremock, PREFIX["short"], MBTC, now + 2, "6600000000000", -8, server_epoch(base) + 1)
        shows(bp, role(bp, "group", "MBTC price"), f"$66{NNBSP}000,00000000")
    assert pool(base, MBTC)["oracle_round"] == now + 2
    prime(base)


def test_wf_oracle_feed_large_move(browser, wiremock):
    base = short()
    prime(base)
    now = oracle_now(base, MBTC)
    feed(wiremock, PREFIX["short"], MBTC, now, "20000000000000", -8, now + 1)
    with app_page(browser, f"{base}/steward?actor={STEWARD}") as sp:
        shows(sp, role(sp, "group", "MBTC price"), "The oracle moved more than 60% – not applied, post it by hand to accept it")
        assert f"$64{NNBSP}000,00000000" in role(sp, "group", "MBTC price").inner_text()
    p = pool(base, MBTC)
    assert p["price"] == "64000.00000000" and p["oracle_status"] == "large_move"


def test_stale_feed_pause():
    base = short()
    prime(base)
    a, t, pid = borrow(base, d_amt=1000000000)
    transfer(base, a["actor_id"], QUSD, FUND_QUSD)
    transfer(base, a["actor_id"], MBTC, COLLATERAL)
    lq, lt = liquidator(base)
    poll(lambda: pool(base, MBTC)["market_state"] == "stale_feed", "MBTC market stale")
    p = pool(base, MBTC)
    assert p["price_age_seconds"] > iso_seconds(pools(base)["staleness_limit"])
    problem(draw(base, t, pid, 1000), "market_stale", detail=BANNER)
    problem(call(base, "POST", f"/api/positions/{pid}/collateral-withdrawals", t, {"amount": "1"}), "market_stale", detail=BANNER)
    problem(liquidate(base, lt, pid, 1, 0), "market_stale", detail=BANNER)
    ok(call(base, "POST", f"/api/positions/{pid}/repayments", t, {"amount": "1000"}))
    ok(call(base, "POST", f"/api/positions/{pid}/collateral", t, {"amount": "1000"}))
    ok(call(base, "POST", "/api/positions", t, {"collateral_asset": MBTC, "debt_asset": QUSD, "collateral_amount": "1000"}))
    assert wallet(base, t)[QUSD] == FUND_QUSD + 1000000000 - 1000
    prime(base)
    assert pool(base, MBTC)["market_state"] == "open"
    ok(draw(base, t, pid, 1000))


def test_recovery_grace_after_stale():
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, lt = liquidator(base)
    drop_to_liquidatable(base, [pid])
    poll(lambda: pool(base, QUSD)["market_state"] == "stale_feed" and pool(base, MBTC)["market_state"] == "stale_feed", "both markets stale")
    prime(base, GRACE_PRICE)
    p = position(base, pid)
    assert p["state"] == "liquidatable_grace" and epoch(p["grace_ends_at"]) >= epoch(p["server_time"])
    problem(liquidate(base, lt, pid, 1, p["round"]), "in_grace")
    wait_state(base, pid, ("liquidatable",))
    prime(base, GRACE_PRICE)
    assert position(base, pid)["state"] == "liquidatable"


def test_wf_stale_feed_happy(browser, wiremock):
    base = short()
    prime(base, GRACE_PRICE)
    a, t, pid = borrow(base, d_amt=30000000000)
    lq, _ = liquidator(base)
    tr, _ = member(base, "trader")
    wait_state(base, pid, ("healthy", "warned"))
    with app_page(browser, f"{base}/positions/{pid}?actor={a['actor_id']}") as bp, \
            app_page(browser, f"{base}/trade?actor={tr['actor_id']}") as tp, \
            app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as lp:
        prime(base, "38000")
        for pg in (bp, tp, lp):
            shows(pg, role(pg, "alert", "Price feed"), BANNER)
        shows(bp, role(bp, "alert", "Price feed"), "MBTC price is ")
        fill(role(bp, "textbox", "Draw amount"), "1")
        click(role(bp, "button", "Draw"))
        shows(bp, role(bp, "alert", "Problems"), BANNER)
        ok(post_price(base, QUSD, P_QUSD))
        ok(post_price(base, METH, P_METH))
        now = oracle_now(base, MBTC)
        feed(wiremock, PREFIX["short"], MBTC, now, "3800000000000", -8, now + 1)
        poll(lambda: pool(base, MBTC)["market_state"] == "open", "fresh oracle round reopens MBTC")
        advance(bp, REFRESH_MS)
        ui_wait(bp, lambda: role(bp, "alert", "Price feed").count() == 0, "banner cleared within one refresh", seconds=REFRESH_MS / 1000 + 2)
        shows(bp, role(bp, "status", "Position state"), "Liquidatable in grace")
        shows(bp, role(bp, "status", "Position state"), "Liquidatable now")
    assert position(base, pid)["state"] == "liquidatable"
    prime(base)


def test_wf_stale_feed_supply_continues(browser):
    base = short()
    prime(base)
    tr, _ = member(base, "trader")
    lp, lt = member(base, "liquidity_provider")
    transfer(base, lp["actor_id"], QUSD, 10 ** 8)
    poll(lambda: pool(base, MBTC)["market_state"] == "stale_feed", "MBTC stale")
    with app_page(browser, f"{base}/trade?actor={tr['actor_id']}") as tp, app_page(browser, f"{base}/supply?actor={lp['actor_id']}") as sp:
        select(role(tp, "combobox", "Pay with"), MBTC)
        shows(tp, tp.locator("body"), SWAP_STALE)
        select(role(sp, "combobox", "Pool"), QUSD)
        fill(role(sp, "textbox", "Supply amount"), "100")
        click(role(sp, "button", "Supply"))
        shows(sp, role(sp, "status", "Announcements"), "Supplied 100,000000 QUSD for ")
    assert wallet(base, lt)[QUSD] == 0
    prime(base)


def test_liquidation_fills_and_write_off():
    base = short()
    prime(base)
    _, _, pa = borrow(base)
    _, _, pb = borrow(base)
    lq, lt = liquidator(base)
    drop_to_liquidatable(base, [pa, pb], DEEP_PRICE)
    bonus = pool(base, MBTC)["params"]["liquidation_bonus_bps"]
    p = position(base, pa)
    pc, pd = units(DEEP_PRICE), units(P_QUSD)
    D, C = int(p["debt"]), int(p["collateral_amount"])
    cover = C * pc * 10 ** 6 * BPS // (pd * 10 ** 8 * (BPS + bonus))
    assert int(p["max_repay"]) >= min(D * CLOSE_FACTOR_BPS // BPS, cover)
    repay = int(p["max_repay"])
    problem(liquidate(base, lt, pa, repay * 2, p["round"]), "validation_failed", field="repay_amount",
            message=f"Repay at most {desk(repay, QUSD)} QUSD on this fill.")
    f = ok(liquidate(base, lt, pa, repay, p["round"]))
    seized = repay * pd * 10 ** 8 * (BPS + bonus) // (pc * 10 ** 6 * BPS)
    assert f["repaid"] == str(repay) and f["amount"] == str(repay) and f["seized"] == str(seized)
    assert f["bonus_amount"] == str(seized - repay * pd * 10 ** 8 // (pc * 10 ** 6)) and f["written_off"] == "0"
    assert f["round"] == 1 and f["state_after"] == "partially_liquidated" and f["asset"] == QUSD
    me = f"wallet:{lq['actor_id']}"
    assert leg(f["legs"], me, QUSD) == -repay and leg(f["legs"], f"loan:{pa}", QUSD) == repay
    assert leg(f["legs"], f"collateral:{pa}", MBTC) == -seized and leg(f["legs"], me, MBTC) == seized
    prime(base, CRASH_PRICE)
    b = position(base, pb)
    cover_b = COLLATERAL * units(CRASH_PRICE) * 10 ** 6 * BPS // (pd * 10 ** 8 * (BPS + bonus))
    assert b["max_repay"] == str(cover_b)
    b422 = problem(liquidate(base, lt, pb, cover_b + 1, b["round"]), "validation_failed")
    assert b422["errors"]["repay_amount"] == f"Repay at most {desk(cover_b, QUSD)} QUSD on this fill."
    w = ok(liquidate(base, lt, pb, cover_b, b["round"]))
    assert w["seized"] == str(COLLATERAL) and int(w["written_off"]) > 0 and w["state_after"] == "closed"
    assert leg(w["legs"], "supply", QUSD) == -int(w["written_off"])
    assert leg(w["legs"], f"loan:{pb}", QUSD) == cover_b + int(w["written_off"])
    closed = ok(call(base, "GET", f"/api/positions/{pb}", tok(base, STEWARD)), 200)
    assert closed["state"] == "closed" and closed["debt"] == "0"
    prime(base)


def test_liquidation_queue_grid(browser):
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, _ = liquidator(base)
    drop_to_liquidatable(base, [pid], CRASH_PRICE)
    mx = int(position(base, pid)["max_repay"])
    with app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as page:
        grid = role(page, "grid", "Liquidation queue")
        btn = role(page, "button", f"Liquidate {pid}")
        ui_wait(page, lambda: btn.count() == 1, "own row in the queue")
        for _ in range(40):
            page.keyboard.press("Tab")
            if grid.evaluate("g => g.contains(document.activeElement)"):
                break
        else:
            pytest.fail("Tab never entered the Liquidation queue grid")
        page.keyboard.press("End")
        for _ in range(200):
            if focused(btn):
                break
            page.keyboard.press("ArrowDown")
        assert focused(btn), "ArrowDown/End reached the row's Liquidate button"
        page.keyboard.press("Home")
        assert grid.evaluate("g => g.contains(document.activeElement)") and not focused(btn)
        page.keyboard.press("End")
        assert focused(btn)
        page.keyboard.press("Enter")
        dlg = role(page, "dialog", "Liquidate position")
        repay = role(dlg, "textbox", "Repay amount")
        expect(repay).to_be_focused()
        expect(repay).to_have_value(desk(mx, QUSD))
        opts = role(dlg, "button", "Repay options")
        opts.focus()
        page.keyboard.press("Enter")
        expect(role(page, "menuitem", "Use max repay")).to_be_focused()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        expect(repay).to_have_value(desk(mx // 2, QUSD))
        expect(opts).to_be_focused()
        page.keyboard.press("Enter")
        page.keyboard.press("Escape")
        ui_wait(page, lambda: not role(page, "menu", "Repay options").is_visible(), "menu closed first")
        expect(opts).to_be_focused()
        assert dlg.is_visible()
        page.keyboard.press("Escape")
        ui_wait(page, lambda: not dlg.is_visible(), "dialog closed")
        expect(btn).to_be_focused()
    prime(base)
    with app_page(browser, f"{svix_down()}/liquidations?actor={LIQ_SEED}") as empty:
        shows(empty, empty.locator("body"), "No positions are below health factor 1.")


LIQ_SEED = "lq-vane"


def test_all_or_nothing_liquidation(mail, svix):
    base = short()
    prime(base)
    a, _, pid = borrow(base)
    lq, lt = liquidator(base)
    drop_to_liquidatable(base, [pid])
    before = position(base, pid)
    key = idempotency_key()
    problem(liquidate(minio_down(), lt, pid, int(before["max_repay"]), before["round"], key), "statement_store_unavailable")
    after = position(base, pid)
    assert after["state"] == "liquidatable" and after["round"] == before["round"] and after["collateral_amount"] == before["collateral_amount"]
    assert wallet(base, lt) == {QUSD: FUND_QUSD, MBTC: 0, METH: 0}
    assert not fills(svix, pid)
    assert not mails(mail, a["email"], f"Liquidation notice: {pid}")
    f = ok(liquidate(base, lt, pid, int(before["max_repay"]), before["round"], key))
    poll(lambda: len(fills(svix, pid)) == 1, "one fill event")
    assert len(poll(lambda: mails(mail, a["email"], f"Liquidation notice: {pid} fill 1"), "one liquidation notice")) == 1
    assert {f"statements/liquidation/{f['settlement_id']}.json", f"statements/liquidation/{f['settlement_id']}.txt"} <= set(S3("-short").keys("statements/liquidation/"))
    prime(base)


def test_settlement_finality_from_storage():
    base, gd = short(), gotenberg_down()
    prime(base)
    a, t, pid = borrow(base, d_amt=None)
    s = ok(draw(gd, t, pid, 1000000))
    sid = s["settlement_id"]
    assert s["statement_status"] == "pending_statement"
    first = call(gd, "GET", f"/api/settlements/{sid}", t)
    assert ok(first, 200)["statement_status"] in ("pending_statement", "stored")
    if not any(k.endswith(".pdf") for k in S3("-short").keys(f"statements/draw/{sid}")):
        problem(call(gd, "GET", f"/api/settlements/{sid}/statement.pdf", t), "pdf_pending")
        assert ok(first, 200)["statement_status"] == "pending_statement"
    poll(lambda: f"statements/draw/{sid}.pdf" in S3("-short").keys(f"statements/draw/{sid}"), "PDF rendered by another process")
    done = poll(lambda: (x := ok(call(gd, "GET", f"/api/settlements/{sid}", t), 200))["statement_status"] == "stored" and x, "stored")
    assert done["pdf_rendered_at"] and ok(call(base, "GET", f"/api/settlements/{sid}", t), 200)["pdf_rendered_at"] == done["pdf_rendered_at"]
    pdf = call(base, "GET", f"/api/settlements/{sid}/statement.pdf", t)
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")
    assert pdf.content == S3("-short").get(f"statements/draw/{sid}.pdf")
    assert ok(call(minio_down(), "GET", f"/api/settlements/{sid}", t), 200)["statement_status"] == "pending_statement"


def test_statements_in_desk_time():
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, lt = liquidator(base)
    drop_to_liquidatable(base, [pid])
    p = position(base, pid)
    f = ok(liquidate(base, lt, pid, int(p["max_repay"]), p["round"]))
    hf_after = "No debt" if f["health_factor_after"] is None else desk_hf(f["health_factor_after"])
    lines = ["Quillmoor Reserve settlement statement", f"Settlement {f['settlement_id']}", "Kind Liquidation",
             f"Member {lq['name']} ({lq['actor_id']})", f"Amount {desk(int(f['amount']), QUSD)} QUSD",
             f"Repaid {desk(int(f['repaid']), QUSD)} QUSD", f"Seized {desk(int(f['seized']), MBTC)} MBTC",
             f"Bonus {desk(int(f['bonus_amount']), MBTC)} MBTC", f"Written off {desk(int(f['written_off']), QUSD)} QUSD",
             f"Health factor before {desk_hf(f['health_factor_before'])}", f"Health factor after {hf_after}",
             f"Desk time {desk_time(f['created_at'])}", f"UTC {f['created_at']}"]
    lines += [f"{x['account']} {x['asset']} {signed(int(x['amount']), x['asset'])}" for x in f["legs"]]
    txt = S3("-short").get(f"statements/liquidation/{f['settlement_id']}.txt").decode("utf-8")
    assert txt == "\n".join(lines) + "\n"
    pdf = poll(lambda: (r := call(base, "GET", f"/api/settlements/{f['settlement_id']}/statement.pdf", lt)).status_code == 200 and r.content, "PDF")
    norm = lambda s: re.sub(r"\s+", " ", s.replace(NNBSP, " "))
    body, at = norm(pdf_text(pdf)), 0
    for ln in lines:
        i = body.find(norm(ln), at)
        assert i >= 0, f"PDF line missing or out of order: {ln!r}"
        at = i
    prime(base)


def liquidate_by_keyboard(page, pid: str, half: bool) -> None:
    btn = role(page, "button", f"Liquidate {pid}")
    ui_wait(page, lambda: btn.count() == 1, "row present")
    btn.focus()
    page.keyboard.press("Enter")
    dlg = role(page, "dialog", "Liquidate position")
    role(dlg, "button", "Repay options").focus()
    page.keyboard.press("Enter")
    if half:
        page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    role(dlg, "button", "Confirm liquidation").focus()
    page.keyboard.press("Enter")


def test_wf_liquidation_happy(browser, mail):
    base = short()
    prime(base)
    a, _, pid = borrow(base)
    lq, _ = liquidator(base)
    drop_to_liquidatable(base, [pid], DEEP_PRICE)
    with app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as lp, \
            app_page(browser, f"{base}/positions/{pid}?actor={a['actor_id']}") as bp:
        liquidate_by_keyboard(lp, pid, half=True)
        expect(role(lp, "heading", "Settlement receipt")).to_be_visible()
        st = role(lp, "status", "Statement status")
        shows(lp, st, "Settled")
        shows(lp, role(lp, "status", "Integrator webhook"), "Webhook delivered.")
        with lp.expect_download() as dl:
            click(role(lp, "button", "Download PDF statement"))
        assert "UTC " in pdf_text(Path(dl.value.path()).read_bytes())
        shows(bp, role(bp, "status", "Position state"), "Partially liquidated")
        shows(bp, role(bp, "list", "Notices"), "Liquidation notice")
    assert position(base, pid)["round"] == 1
    assert len(poll(lambda: mails(mail, a["email"], f"Liquidation notice: {pid} fill 1"), "liquidation email")) == 1
    prime(base)


def test_wf_liquidation_store_down(browser):
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, lt = liquidator(base)
    drop_to_liquidatable(base, [pid])
    with app_page(browser, f"{minio_down()}/liquidations?actor={lq['actor_id']}") as lp:
        liquidate_by_keyboard(lp, pid, half=False)
        shows(lp, role(lp, "alert", "Problems"), DETAIL["statement_store_unavailable"][1])
    p = position(base, pid)
    assert p["state"] == "liquidatable" and p["round"] == 0 and wallet(base, lt)[QUSD] == FUND_QUSD
    prime(base)


def test_one_winner_per_round(mail, svix):
    base, gd = short(), gotenberg_down()
    prime(base)
    a, _, pid = borrow(base)
    liqs = [liquidator(base) for _ in range(3)]
    drop_to_liquidatable(base, [pid], DEEP_PRICE)
    p = position(base, pid)
    bar = threading.Barrier(3)

    def go(args):
        b, (_, t) = args
        bar.wait()
        return liquidate(b, t, pid, int(p["max_repay"]), p["round"])

    with cf.ThreadPoolExecutor(3) as ex:
        rs = list(ex.map(go, zip((base, gd, base), liqs)))
    codes = [r.status_code for r in rs]
    assert sorted(codes) == [201, 409, 409], [r.text for r in rs]
    for r, (_, t) in zip(rs, liqs):
        if r.status_code == 409:
            problem(r, "already_liquidated")
            assert wallet(base, t) == {QUSD: FUND_QUSD, MBTC: 0, METH: 0}
    poll(lambda: len(fills(svix, pid)) == 1, "one fill event")
    assert len(poll(lambda: mails(mail, a["email"], f"Liquidation notice: {pid}"), "notice")) == 1
    assert position(base, pid)["round"] == 1
    prime(base)


def test_losing_liquidator_feedback(browser):
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, _ = liquidator(base)
    other, ot = liquidator(base)
    drop_to_liquidatable(base, [pid], DEEP_PRICE)
    with app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as lp:
        btn = role(lp, "button", f"Liquidate {pid}")
        ui_wait(lp, lambda: btn.count() == 1, "row present")
        click(btn)
        dlg = role(lp, "dialog", "Liquidate position")
        expect(role(dlg, "textbox", "Repay amount")).to_be_focused()
        p = position(base, pid)
        ok(liquidate(base, ot, pid, int(p["max_repay"]), p["round"]))
        click(role(dlg, "button", "Confirm liquidation"))
        shows(lp, role(lp, "alert", "Problems"), "Already liquidated at this health factor")
        expect(btn).to_be_focused()
        grid = role(lp, "grid", "Liquidation queue")
        col = grid.get_by_role("columnheader").all_inner_texts().index("Round")
        row = grid.get_by_role("row").filter(has=btn)
        ui_wait(lp, lambda: row.get_by_role("gridcell").nth(col).inner_text().strip() == "1", "row refreshed to round 1")
    prime(base)


def test_wf_liquidation_race_happy(browser, mail, svix):
    base = short()
    prime(base)
    a, _, pid = borrow(base)
    (l1, t1), (l2, t2) = liquidator(base), liquidator(base)
    drop_to_liquidatable(base, [pid], DEEP_PRICE)
    with app_page(browser, f"{base}/liquidations?actor={l1['actor_id']}") as p1, \
            app_page(browser, f"{gotenberg_down()}/liquidations?actor={l2['actor_id']}") as p2:
        sent: dict[str, tuple[str, str]] = {}
        for pg, name in ((p1, "a"), (p2, "b")):
            pg.on("request", lambda r, n=name: "/liquidations" in r.url and r.method == "POST" and sent.setdefault(n, (r.headers.get("idempotency-key", ""), r.post_data or "")))
            b = role(pg, "button", f"Liquidate {pid}")
            ui_wait(pg, lambda b=b: b.count() == 1, "row")
            click(b)
            expect(role(pg, "dialog", "Liquidate position")).to_be_visible()
        prime(base, DEEP_PRICE)
        role(p1, "button", "Confirm liquidation").click(no_wait_after=True)
        role(p2, "button", "Confirm liquidation").click(no_wait_after=True)
        won = []
        ui_wait(p1, lambda: role(p1, "heading", "Settlement receipt").count() + role(p2, "heading", "Settlement receipt").count() == 1, "one receipt")
        winner, loser = (p1, p2) if role(p1, "heading", "Settlement receipt").count() else (p2, p1)
        shows(loser, role(loser, "alert", "Problems"), "Already liquidated at this health factor")
        shows(winner, role(winner, "status", "Statement status"), "Settled")
        wkey, wbody = sent["a" if winner is p1 else "b"]
        wtok = t1 if winner is p1 else t2
        sid = winner.url.rsplit("/", 1)[-1]
    rep = call(base, "POST", f"/api/positions/{pid}/liquidations", wtok, None, key=wkey, raw=wbody.encode())
    assert rep.status_code == 201 and rep.headers.get("idempotency-replayed") == "true" and rep.json()["settlement_id"] == sid
    poll(lambda: len(fills(svix, pid)) == 1, "one fill event")
    assert len(poll(lambda: mails(mail, a["email"], f"Liquidation notice: {pid}"), "notice")) == 1
    prime(base)


def test_wf_liquidation_race_closing_fill(browser):
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, _ = liquidator(base)
    other, ot = liquidator(base)
    drop_to_liquidatable(base, [pid], CRASH_PRICE)
    with app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as lp:
        b = role(lp, "button", f"Liquidate {pid}")
        ui_wait(lp, lambda: b.count() == 1, "row")
        click(b)
        p = position(base, pid)
        assert ok(liquidate(base, ot, pid, int(p["max_repay"]), p["round"]))["state_after"] == "closed"
        click(role(lp, "button", "Confirm liquidation"))
        shows(lp, role(lp, "alert", "Problems"), "Already liquidated at this health factor")
    prime(base)


def ruler_items(scope) -> list[str]:
    return [t.strip() for t in role(scope, "list", "Position ticks").get_by_role("listitem").all_inner_texts()]


def test_shock_ruler_ticks_and_counters(browser):
    base = svix_down()
    with app_page(browser, f"{base}/steward?actor={STEWARD}") as page:
        select(role(page, "combobox", "Asset"), MBTC)
        ruler = role(page, "region", "Shock ruler")
        ui_wait(page, lambda: len(ruler_items(page)) >= 4, "four seed MBTC ticks")
        items = ruler_items(page)
        for pid in ("pos-0001", "pos-0002", "pos-0003", "pos-0004"):
            assert any(i.startswith(f"{pid}: $") for i in items)
        assert not any(i.startswith("pos-0005:") for i in items)
        slider = role(page, "slider", "Price shock")
        slider.focus()
        seen = []
        for _ in range(3):
            page.keyboard.press("Shift+ArrowLeft")
            seen.append(value_of(ruler.inner_text(), "Shocked price"))
        assert len(set(seen)) == 3, "shocked price changes on every step"
        body = ruler.inner_text()
        assert value_of(body, "Shocked price") == f"$54{NNBSP}400,00000000"
        assert value_of(body, "Positions at risk") == "2"
        assert value_of(body, "Collateral exposed") == "2,00000000 MBTC"
        at_risk = {i.split(":")[0] for i in ruler_items(page) if i.endswith(", at risk")}
        assert at_risk == {"pos-0002", "pos-0004"}


def test_shock_ruler_keyboard_and_reading(browser):
    base = svix_down()
    with app_page(browser, f"{base}/liquidations?actor={LIQ_SEED}") as page:
        slider = role(page, "slider", "Price shock")
        ui_wait(page, lambda: (slider.get_attribute("aria-valuetext") or "").startswith("0,0% · $"), "ruler centred")
        slider.focus()
        steps = [("ArrowRight", "+0,5% · $"), ("ArrowLeft", "0,0% · $"), ("ArrowDown", f"{MINUS}0,5% · $"),
                 ("Shift+ArrowLeft", f"{MINUS}5,5% · $"), ("ArrowUp", f"{MINUS}5,0% · $"), ("Home", f"{MINUS}60,0% · $"),
                 ("End", "+60,0% · $")]
        for key, want in steps:
            page.keyboard.press(key)
            assert (slider.get_attribute("aria-valuetext") or "").startswith(want), key
            expect(slider).to_be_focused()
        page.keyboard.press("Home")
        for _ in range(9):
            page.keyboard.press("Shift+ArrowRight")
        assert slider.get_attribute("aria-valuetext") == f"{MINUS}15,0% · $54{NNBSP}400,00000000"
        reading = role(page, "status", "Shock reading")
        advance(page, SHOCK_PAUSE_MS - STEP_MS)
        assert "at -15" not in reading.inner_text() and f"{MINUS}15,0% shock" not in reading.inner_text()
        advance(page, STEP_MS)
        shows(page, reading, f"2 positions at risk at {MINUS}15,0% shock.", seconds=5)


def handle_path(page, key: str) -> tuple[list[float], list[float]]:
    handle = role(page, "img", "Shock handle")
    page.keyboard.press(key)
    durations = handle.evaluate("e => e.getAnimations({subtree: true}).map(a => Number(a.effect.getComputedTiming().duration))")
    return [s["x"] for s in motion(handle, HANDLE_MAX_MS * 2)], durations


def test_shock_handle_motion(browser):
    base = svix_down()
    with app_page(browser, f"{base}/liquidations?actor={LIQ_SEED}") as page:
        slider = role(page, "slider", "Price shock")
        ui_wait(page, lambda: slider.count() == 1, "ruler")
        slider.focus()
        xs, durations = handle_path(page, "Shift+ArrowRight")
        assert xs[0] != xs[-1] and len(set(xs[: len(xs) // 3])) > 1 or xs[1] != xs[-1], "handle moves over time, not instantly"
        if durations:
            assert all(HANDLE_MIN_MS <= d <= HANDLE_MAX_MS for d in durations), durations
        else:
            half = len(xs) // 2
            assert all(abs(x - xs[-1]) < 0.5 for x in xs[half:]), "handle settled by 0.15 s"
    with app_page(browser, f"{base}/liquidations?actor={LIQ_SEED}", reduced_motion="reduce") as page:
        slider = role(page, "slider", "Price shock")
        ui_wait(page, lambda: slider.count() == 1, "ruler")
        slider.focus()
        xs, _ = handle_path(page, "Shift+ArrowRight")
        assert all(abs(x - xs[-1]) < 0.5 for x in xs[1:]), "reduced motion: no transition"


def test_wf_shock_ruler_happy(browser):
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, _ = liquidator(base)
    with app_page(browser, f"{base}/steward?actor={STEWARD}") as sp, app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as lp:
        select(role(sp, "combobox", "Asset"), MBTC)
        assert role(lp, "button", "Post this price").count() == 0
        ui_wait(sp, lambda: any(i.startswith(f"{pid}: ") for i in ruler_items(sp)), "own tick on steward ruler")
        ui_wait(lp, lambda: any(i.startswith(f"{pid}: ") for i in ruler_items(lp)), "own tick on liquidator ruler")
        slider = role(sp, "slider", "Price shock")
        box = slider.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        sp.mouse.move(cx, cy)
        sp.mouse.down()
        sp.mouse.move(box["x"] + box["width"] / 3, cy, steps=10)
        sp.mouse.up()
        vt = slider.get_attribute("aria-valuetext") or ""
        assert vt.startswith(MINUS), vt
        shocked = vt.split("· $")[1]
        assert any(i == f"{pid}: " + i.split(": ", 1)[1] and i.endswith(", at risk") for i in ruler_items(sp) if i.startswith(f"{pid}: "))
        click(role(sp, "button", "Post this price"))
        expect(role(sp, "textbox", "New price")).to_have_value(shocked)
        expect(role(sp, "button", "Post price")).to_be_focused()
        sp.keyboard.press("Enter")
        shows(sp, role(sp, "status", "Announcements"), "now below health factor 1.")
        for pg in (sp, lp):
            ui_wait(pg, lambda pg=pg: (role(pg, "slider", "Price shock").get_attribute("aria-valuetext") or "") == f"0,0% · ${shocked}", "ruler recentred")
        ui_wait(lp, lambda: role(lp, "button", f"Liquidate {pid}").count() == 1, "crossed position in queue")
    prime(base)


def test_wf_shock_ruler_keyboard_reduced(browser):
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    with app_page(browser, f"{base}/steward?actor={STEWARD}", reduced_motion="reduce") as sp:
        select(role(sp, "combobox", "Asset"), MBTC)
        slider = role(sp, "slider", "Price shock")
        ui_wait(sp, lambda: any(i.startswith(f"{pid}: ") for i in ruler_items(sp)), "own tick")
        slider.focus()
        for _ in range(4):
            sp.keyboard.press("Shift+ArrowLeft")
        assert (slider.get_attribute("aria-valuetext") or "") == f"{MINUS}20,0% · $51{NNBSP}200,00000000"
        role(sp, "button", "Post this price").focus()
        sp.keyboard.press("Enter")
        expect(role(sp, "textbox", "New price")).to_have_value(f"51{NNBSP}200,00000000")
        sp.keyboard.press("Enter")
        shows(sp, role(sp, "status", "Announcements"), "now below health factor 1.")
    assert pool(base, MBTC)["price"] == api_price(units(desk_to_api(f"51{NNBSP}200,00000000")))
    assert pid in [p["position_id"] for p in ok(call(base, "GET", "/api/liquidations/queue", tok(base, STEWARD)), 200)["positions"]]
    prime(base)


def test_events_from_committed_changes(svix):
    base = short()
    prime(base)
    a, t, pid = borrow(base, d_amt=None)
    s = ok(draw(base, t, pid, 1000000))
    msgs = poll(lambda: (m := events(svix, pid)) and any(x["payload"]["type"] == "settlement.committed" for x in m) and m, "draw event")
    opened = [m for m in msgs if m["payload"]["type"] == "position.state_changed" and m["payload"]["data"]["from"] is None]
    assert len(opened) == 1 and opened[0]["payload"]["data"]["to"] == "healthy"
    fill_ev = [m for m in msgs if m["payload"]["type"] == "settlement.committed"]
    assert len(fill_ev) == 1 and fill_ev[0]["eventId"] == s["event_id"] == fill_ev[0]["payload"]["event_id"]
    assert fill_ev[0]["eventType"] == "settlement.committed"
    b, bt = member(base, "borrower")
    transfer(base, b["actor_id"], MBTC, COLLATERAL)
    md = minio_down()
    pid2 = ok(call(md, "POST", "/api/positions", bt, {"collateral_asset": MBTC, "debt_asset": QUSD, "collateral_amount": str(COLLATERAL)}))["position_id"]
    problem(draw(md, bt, pid2, 1000000), "statement_store_unavailable")
    ok(call(md, "POST", f"/api/positions/{pid2}/collateral-withdrawals", bt, {"amount": str(COLLATERAL)}))
    ms = poll(lambda: (m := events(svix, pid2)) and len(m) >= 2 and m, "open and close events")
    assert sorted(m["payload"]["sequence"] for m in ms) == [1, 2]
    assert not [m for m in ms if m["payload"]["type"] == "settlement.committed"]


def test_event_format_and_order(svix, app_url):
    base = short()
    prime(base)
    a, t, pid = borrow(base, d_amt=None)
    ltv = pool(base, MBTC)["params"]["ltv_bps"]
    cap = COLLATERAL * units(P_MBTC) * ltv * 10 ** 6 // (units(P_QUSD) * 10 ** 8 * BPS)
    s = ok(draw(base, t, pid, cap))
    assert s["state_after"] == "warned"
    ms = poll(lambda: (m := events(svix, pid)) and len(m) >= 3 and m, "open, draw and warned events")
    ms.sort(key=lambda m: m["payload"]["sequence"])
    assert [m["payload"]["sequence"] for m in ms] == list(range(1, len(ms) + 1))
    assert [m["payload"]["type"] for m in ms[1:3]] == ["settlement.committed", "position.state_changed"]
    for m in ms:
        pl = m["payload"]
        assert ISO.match(pl["occurred_at"]) and pl["position_id"] == pid
        assert set(pl) == {"event_id", "type", "position_id", "sequence", "occurred_at", "data"}
    d = ms[1]["payload"]["data"]
    assert d == {"settlement_id": s["settlement_id"], "kind": "draw", "asset": QUSD, "amount": str(cap), "statement_key": s["statement_key"]}
    sc = ms[2]["payload"]["data"]
    assert sc["from"] == "healthy" and sc["to"] == "warned" and re.fullmatch(r"\d+\.\d{4}", sc["health_factor"]) and sc["grace_ends_at"] is None
    stamps = [m.get("timestamp") for m in ms]
    assert stamps == sorted(stamps), "delivered in sequence order"
    lp, lt = member(app_url, "liquidity_provider")
    transfer(app_url, lp["actor_id"], QUSD, 10 ** 6)
    ok(call(app_url, "POST", f"/api/pools/{QUSD}/supplies", lt, {"amount": str(10 ** 6)}))
    w = ok(call(app_url, "POST", f"/api/pools/{QUSD}/withdrawals", lt, {"amount": "1000"}, key=idempotency_key()))
    we = poll(lambda: events(svix, sid=w["settlement_id"]), "withdrawal event")[0]["payload"]
    assert we["position_id"] is None and we["sequence"] is None and we["data"]["amount"] == "1000"


def test_wf_webhooks_happy(browser, svix):
    base = short()
    prime(base)
    a, t, pid = borrow(base, d_amt=None)
    lq, _ = liquidator(base)
    with app_page(browser, f"{base}/positions/{pid}?actor={a['actor_id']}") as bp:
        fill(role(bp, "textbox", "Draw amount"), f"40{NNBSP}000")
        click(role(bp, "button", "Draw"))
        shows(bp, role(bp, "status", "Announcements"), f"Drew 40{NNBSP}000,000000 QUSD.")
    prime(base, DEEP_PRICE)
    poll(lambda: any(m["payload"]["data"].get("to") == "liquidatable" for m in events(svix, pid)), "grace expiry event")
    prime(base, DEEP_PRICE)
    with app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as lp:
        liquidate_by_keyboard(lp, pid, half=False)
        shows(lp, role(lp, "status", "Integrator webhook"), "Webhook delivered.")
    ms = sorted(events(svix, pid), key=lambda m: m["payload"]["sequence"])
    kinds = [(m["payload"]["type"], m["payload"]["data"].get("kind") or m["payload"]["data"].get("to")) for m in ms]
    assert kinds[:5] == [("position.state_changed", "healthy"), ("settlement.committed", "draw"), ("position.state_changed", "warned") if kinds[2][1] == "warned" else kinds[2], *kinds[3:5]]
    assert [k for k in kinds if k[0] == "settlement.committed"] == [("settlement.committed", "draw"), ("settlement.committed", "liquidation")]
    assert len({m["eventId"] for m in ms}) == len(ms)
    assert ("position.state_changed", "liquidatable_grace") in kinds and ("position.state_changed", "liquidatable") in kinds
    prime(base)


def test_wf_webhooks_refused_fill(browser, svix):
    base = short()
    prime(base)
    _, _, pid = borrow(base)
    lq, _ = liquidator(base)
    drop_to_liquidatable(base, [pid])
    poll(lambda: any(m["payload"]["data"].get("to") == "liquidatable" for m in events(svix, pid)), "grace expiry event delivered")
    before = {m["eventId"] for m in events(svix, pid)}
    with app_page(browser, f"{minio_down()}/liquidations?actor={lq['actor_id']}") as lp:
        liquidate_by_keyboard(lp, pid, half=False)
        shows(lp, role(lp, "alert", "Problems"), DETAIL["statement_store_unavailable"][1])
    prime(base, GRACE_PRICE)
    assert not fills(svix, pid)
    added = [m for m in events(svix, pid) if m["eventId"] not in before]
    assert all(m["payload"]["type"] == "position.state_changed" for m in added), added
    prime(base)


def test_statement_store_outage():
    base, md = short(), minio_down()
    prime(base)
    a, t, pid = borrow(base, d_amt=1000000)
    transfer(base, a["actor_id"], QUSD, 10 ** 8)
    problem(draw(md, t, pid, 1000), "statement_store_unavailable")
    assert position(base, pid)["debt"] >= "1000000" and wallet(base, t)[QUSD] == 10 ** 8 + 1000000
    lp, lt = member(base, "liquidity_provider")
    transfer(base, lp["actor_id"], QUSD, 10 ** 8)
    ok(call(md, "POST", f"/api/pools/{QUSD}/supplies", lt, {"amount": str(10 ** 8)}))
    problem(call(md, "POST", f"/api/pools/{QUSD}/withdrawals", lt, {"amount": "1000"}, key=idempotency_key()), "statement_store_unavailable")
    assert wallet(base, lt)[QUSD] == 0
    ok(call(md, "POST", f"/api/positions/{pid}/repayments", t, {"amount": "1000"}))
    tr, tt = member(base, "trader")
    transfer(base, tr["actor_id"], MBTC, COLLATERAL)
    q = ok(call(md, "POST", "/api/swap/quotes", tt, {"from_asset": MBTC, "to_asset": QUSD, "amount_in": "1000000"}))
    ok(call(md, "POST", "/api/swaps", tt, {"quote_id": q["quote_id"]}, key=idempotency_key()))
    assert ok(call(md, "GET", "/api/pools", tt), 200)["pools"]


OUTAGES = ["mail", "svix", "database"]


@pytest.mark.timeout(900)
@pytest.mark.parametrize("case", OUTAGES, ids=OUTAGES)
def test_service_outages(case, mail, svix):
    if case == "mail":
        base = mail_down()
        prime(base)
        a, _, pid = borrow(base)
        prime(base, WARN_PRICE)
        n = position(base, pid)["notices"]
        assert [x["kind"] for x in n] == ["margin"] and n[0]["status"] == "queued" and n[0]["sent_at"] is None
        mail.messages(settle=REFRESH_MS / 1000)
        assert not mails(mail, a["email"], "Margin notice")
        prime(base)
    elif case == "svix":
        base = svix_down()
        a, t, pid = borrow(base, METH, QUSD, 10 ** 19, None)
        s = ok(draw(base, t, pid, 10 ** 6))
        assert ok(call(base, "GET", f"/api/settlements/{s['settlement_id']}", t), 200)["webhook_status"] == "queued"
        assert not events(svix, pid)
        assert wallet(base, t)[QUSD] == 10 ** 6
    else:
        relay = db_relay()
        relay.up()
        with app_copy({"DATABASE_URL": relayed_db(relay)}) as (url, proc, log):
            poll(lambda: _health(url) == 200, f"copy healthy; log:\n{tail(log)}")
            assert ok(call(url, "GET", "/api/actors"), 200)["actors"]
            steward = tok(url, STEWARD)
            relay.down()
            problem(call(url, "GET", "/api/me", steward), "ledger_unavailable")
            relay.up()
            t0 = time.monotonic()
            poll(lambda: call(url, "GET", "/api/me", tok(url, STEWARD)).status_code == 200, "recovery without restart", seconds=RECOVER_S + 1)
            assert time.monotonic() - t0 <= RECOVER_S + 1 and proc.poll() is None, tail(log)
        relay.down()


def _health(url: str) -> int:
    try:
        return httpx.get(url + "/api/health", timeout=HTTP_S).status_code
    except httpx.HTTPError:
        return 0


def test_background_jobs_exactly_once(wiremock, mail, svix):
    base, gd = short(), gotenberg_down()
    prime(base)
    now = oracle_now(base, METH)
    for pre in (PREFIX["short"], PREFIX["gotenberg"]):
        feed(wiremock, pre, METH, now, "330000000000", -8, now + 1)
    st = tok(base, STEWARD)
    poll(lambda: pool(base, METH)["oracle_round"] == now, "METH round applied")
    poll(lambda: pool(gd, METH)["oracle_status"] in ("ok", "not_newer"), "second process polled the same round")
    assert len([p for p in ok(call(base, "GET", "/api/prices?asset=METH", st), 200)["prices"] if p["oracle_round"] == now]) == 1
    a, _, pid = borrow(base)
    lq, lt = liquidator(base)
    drop_to_liquidatable(base, [pid])
    p = position(base, pid)
    f = ok(liquidate(gd, lt, pid, int(p["max_repay"]), p["round"]))
    poll(lambda: mails(mail, a["email"], f"Liquidation notice: {pid} fill 1"), "notice")
    assert len(mails(mail, a["email"], f"Liquidation notice: {pid} fill 1")) == 1
    poll(lambda: [m for m in svix.messages(APP_UID) if m.get("eventId") == f["event_id"]], "fill event")
    assert len([m for m in svix.messages(APP_UID) if m.get("eventId") == f["event_id"]]) == 1
    done = poll(lambda: (x := ok(call(base, "GET", f"/api/settlements/{f['settlement_id']}", lt), 200))["pdf_rendered_at"] and x, "PDF rendered")
    assert ok(call(gd, "GET", f"/api/settlements/{f['settlement_id']}", lt), 200)["pdf_rendered_at"] == done["pdf_rendered_at"]
    prime(base)


def test_wf_outages_pdf_down(browser):
    base, gd = short(), gotenberg_down()
    prime(base)
    a, t, pid = borrow(base, d_amt=None)
    with app_page(browser, f"{gd}/positions/{pid}?actor={a['actor_id']}") as bp:
        fill(role(bp, "textbox", "Draw amount"), "250")
        click(role(bp, "button", "Draw"))
        shows(bp, role(bp, "status", "Announcements"), "Drew 250,000000 QUSD.")
        click(role(bp, "link", "View receipt"))
        st = role(bp, "status", "Statement status")
        sid = bp.url.rsplit("/", 1)[-1]
        if f"statements/draw/{sid}.pdf" not in S3("-short").keys(f"statements/draw/{sid}"):
            shows(bp, st, "Pending statement", seconds=4)
            assert PENDING_LINE in st.inner_text()
        shows(bp, st, "Settled")
        expect(role(bp, "button", "Download PDF statement")).to_be_visible()
    assert wallet(base, t)[QUSD] == minor("250", QUSD)
    assert f"statements/draw/{sid}.pdf" in S3("-short").keys(f"statements/draw/{sid}")


@pytest.mark.timeout(900)
def test_wf_outages_mail_down(browser, mail):
    base = mail_down()
    prime(base)
    a, _, pid = borrow(base)
    lq, _ = liquidator(base)
    prime(base, DEEP_PRICE)
    poll(lambda: position(base, pid)["state"] == "liquidatable", "grace to end on the mail-down instance", seconds=iso_seconds(pools(base)["grace_period"]) + WAIT_S)
    with app_page(browser, f"{base}/liquidations?actor={lq['actor_id']}") as lp:
        liquidate_by_keyboard(lp, pid, half=False)
        shows(lp, role(lp, "status", "Statement status"), "Settled")
    with app_page(browser, f"{base}/positions/{pid}?actor={a['actor_id']}") as bp:
        shows(bp, role(bp, "list", "Notices"), "Liquidation notice queued, not yet sent.")
    assert [n["status"] for n in position(base, pid)["notices"] if n["kind"] == "liquidation"] == ["queued"]
    assert not mails(mail, a["email"], f"Liquidation notice: {pid}")
    prime(base)


@pytest.mark.timeout(900)
def test_run_manifest_and_health(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    relay = db_relay()
    with app_copy({"DATABASE_URL": relayed_db(relay)}) as (url, proc, log):
        code = poll(lambda: _health(url) or (proc.poll() is not None and pytest.fail(tail(log))), f"copy listening; log:\n{tail(log)}")
        assert code == 503
        assert httpx.get(url + "/api/health", timeout=HTTP_S).json() == {"status": "starting"}
        relay.up()
        poll(lambda: _health(url) == 200, f"health ok once Postgres is reachable; log:\n{tail(log)}")
        assert httpx.get(url + "/api/health", timeout=HTTP_S).json() == {"status": "ok"}
    relay.down()


BOUNDARY = ["too_large", "exact_limit", "cross_origin", "media_type", "invalid_json", "unknown_field", "proto_key",
            "wrong_type", "control_char", "unknown_api", "never_served", "precedence"]


@pytest.mark.parametrize("case", BOUNDARY, ids=BOUNDARY)
def test_api_boundary(app_url, case):
    st = tok(app_url, STEWARD)
    path = "/api/actors"
    if case == "too_large":
        problem(call(app_url, "POST", path, st, raw=b'{"name":"' + b"a" * BODY_LIMIT + b'"}'), "payload_too_large")
    elif case == "exact_limit":
        base_body = json.dumps({"actor_id": STEWARD}).encode()
        r = call(app_url, "POST", "/api/sessions", raw=base_body + b" " * (BODY_LIMIT - len(base_body)))
        assert r.status_code == 201
    elif case == "cross_origin":
        r = call(app_url, "POST", path, st, {"name": "x"}, Origin=EVIL_ORIGIN)
        problem(r, "cross_origin")
        assert not [k for k in r.headers if k.lower().startswith(CORS_PREFIX)]
    elif case == "media_type":
        problem(call(app_url, "POST", path, st, raw=b"{}", Content_Type="text/plain"), "unsupported_media_type")
    elif case == "invalid_json":
        problem(call(app_url, "POST", path, st, raw=b'{"name":'), "invalid_json")
    elif case == "unknown_field":
        problem(call(app_url, "POST", "/api/transfers", st, {"actor_id": TRADER, "asset": QUSD, "amount": "1", "memo": "x"}),
                "validation_failed", field="memo", message="Unknown field.")
    elif case == "proto_key":
        problem(call(app_url, "POST", "/api/transfers", st, raw=b'{"actor_id":"tr-petra","asset":"QUSD","amount":"1","__proto__":{}}'),
                "validation_failed", field="__proto__", message="Unknown field.")
    elif case == "wrong_type":
        problem(call(app_url, "POST", "/api/transfers", st, {"actor_id": TRADER, "asset": QUSD, "amount": 1}),
                "validation_failed", field="amount", message="Enter a whole number of minor units above zero.")
        problem(call(app_url, "POST", "/api/transfers", st, {"actor_id": TRADER, "asset": "XYZ", "amount": "1"}),
                "validation_failed", field="asset", message="Choose a listed asset.")
    elif case == "control_char":
        name, email = unique("ctl")
        problem(call(app_url, "POST", path, st, {"name": name + "\u0007", "email": email, "role": "trader"}),
                "validation_failed", field="name", message="Remove control characters.")
    elif case == "unknown_api":
        problem(call(app_url, "GET", "/api/no-such-thing", st), "not_found")
    elif case == "never_served":
        for p in ("/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts", "/dist/server.js.map"):
            problem(call(app_url, "GET", p), "not_found")
        r = httpx.get(app_url + "/nowhere-at-all", timeout=HTTP_S)
        assert r.status_code == 200 and HTML_TYPE in r.headers["content-type"]
    else:
        problem(call(app_url, "POST", path, None, raw=b"{" + b" " * BODY_LIMIT, Origin=EVIL_ORIGIN), "payload_too_large")
        problem(call(app_url, "POST", path, None, raw=b"{", Origin=EVIL_ORIGIN, Content_Type="text/plain"), "cross_origin")
        problem(call(app_url, "POST", "/api/positions/pos-0001/draws", None, {"amount": "1"}), "unauthenticated")
        problem(call(app_url, "POST", "/api/positions/nope/draws", st, {"amount": "1"}), "idempotency_key_required")
        problem(call(app_url, "POST", "/api/positions/nope/draws", st, {"amount": "1"}, key=idempotency_key()), "not_found")


def test_desk_formats(browser, app_url):
    prime(app_url)
    tr, tt = member(app_url, "trader")
    transfer(app_url, tr["actor_id"], MBTC, 12345678)
    ps = pools(app_url)
    for p in ps["pools"]:
        assert re.fullmatch(r"\d+\.\d{8}", p["price"]) and re.fullmatch(r"\d+\.\d{12}", p["share_price"])
        assert DIGITS.match(p["available_liquidity"]) and DIGITS.match(p["borrow_index"]) and isinstance(p["utilization_bps"], int)
    assert ISO.match(ps["server_time"]) and ps["desk_time_zone"] == "America/St_Johns"
    with app_page(browser, f"{app_url}/trade?actor={tr['actor_id']}") as page:
        shows(page, role(page, "region", "Wallet"), "0,12345678")
        mb = pool(app_url, MBTC)
        card = page.get_by_role("article", name="MBTC pool").inner_text()
        assert value_of(card, "Available liquidity") == desk(int(mb["available_liquidity"]), MBTC)
        assert value_of(card, "Share price") == mb["share_price"].replace(".", ",")
        rail = role(page, "complementary", "Posted prices")
        assert desk_price(units(mb["price"])) in role(page, "group", "MBTC price").inner_text()
        rail_text = rail.inner_text()
        for label, field in (("Grace period", "grace_period"), ("Quote lifetime", "quote_lifetime"), ("Staleness limit", "staleness_limit")):
            assert value_of(rail_text, label) == mss(iso_seconds(ps[field]))
        box = role(page, "textbox", "Amount to pay")
        select(role(page, "combobox", "Pay with"), MBTC)
        for typed, msg in (("0,123456789", "Enter at most 8 digits after the comma."), ("0", "Enter an amount above zero."),
                           ("1.5", "Enter digits with a comma before the decimals.")):
            fill(box, typed)
            shows(page, page.locator("body"), msg, seconds=5)
    assert DUR == {"PT5M": 300, "PT1H": 3600}


VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}


def test_responsive_layout(browser, app_url):
    with app_page(browser, f"{app_url}/supply?actor=lp-rosa") as page:
        for name, (w, h) in VIEWPORTS.items():
            page.set_viewport_size({"width": w, "height": h})
            page.reload()
            rail, wal = role(page, "complementary", "Posted prices"), role(page, "region", "Wallet")
            card = page.get_by_role("article", name="QUSD pool")
            ui_wait(page, lambda: card.count() == 1 and wal.count() == 1, "zones rendered")
            layout(page)
            r, wb, c = rail.bounding_box(), wal.bounding_box(), card.bounding_box()
            if name == "desktop":
                assert c["x"] < wb["x"] < r["x"] and r["width"] < wb["width"]
            elif name == "tablet":
                assert r["y"] < wb["y"] and r["y"] < c["y"] and c["x"] + c["width"] <= wb["x"] + 1 and r["width"] > wb["width"]
            else:
                assert r["y"] < wb["y"] < c["y"]


def test_keyboard_focus_targets(browser, app_url):
    tr, _ = member(app_url, "trader")
    with app_page(browser, f"{app_url}/trade?actor={tr['actor_id']}") as page:
        shows(page, page.locator("body"), "Type an amount to see the output.")
        order = tab_order(page, 5)
        assert order == ["Acting as", "Trade", "Pay with", "Receive", "Amount to pay"], order
        btn = role(page, "button", "Get firm quote")
        rest, focus = state_styles(btn, "outline-style", "outline-width", state="focus")
        assert focus["outline-style"] != "none" and float(focus["outline-width"].removesuffix("px")) > 0
        fill(role(page, "textbox", "Amount to pay"), "1.5")
        click(btn)
        expect(role(page, "textbox", "Amount to pay")).to_be_focused()
        for b in page.get_by_role("button").all():
            if b.is_visible():
                bb = b.bounding_box()
                assert bb["width"] >= MIN_TARGET and bb["height"] >= MIN_TARGET, b.inner_text()
        axe(page)


def test_if_run_manifest():
    m = json.loads(Path("/app/run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for p in shipped_packages():
        assert p.name in notes, p.name
    for font in ("Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notes


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


DATASTORES = {"sqlite3", "better-sqlite3", "redis", "ioredis", "level", "lowdb", "nedb", "mongodb", "mysql2"}


def test_if_state_only_in_postgres_and_minio():
    assert not {p.name for p in shipped_packages()} & DATASTORES
    files = [f for f in Path(DEPLOYED_APP).rglob("*") if "node_modules" not in f.parts and f.suffix in (".sqlite", ".db", ".sqlite3")]
    assert not files, files


def test_if_service_config_unchanged(svix):
    assert isinstance(Postgres().tables(), list)
    assert isinstance(S3().keys(), list)
    assert isinstance(svix.applications(), list)


def test_if_typescript_strict():
    assert Path("/app/package-lock.json").is_file()
    configs = list(Path("/app").glob("tsconfig*.json"))
    assert configs and any(re.search(r'"strict"\s*:\s*true', c.read_text()) for c in configs)
