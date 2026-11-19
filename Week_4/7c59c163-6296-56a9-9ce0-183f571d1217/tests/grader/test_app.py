from __future__ import annotations

import base64
import calendar
import concurrent.futures
import csv
import hashlib
import hmac
import io
import json
import math
import os
import re
import socket
import struct
import threading
import time
import uuid
import zlib
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    Keycloak,
    Postgres,
    S3,
    addresses,
    advance,
    capture,
    decode,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    pdf_text,
    same_origin,
    select,
    shipped_packages,
    text,
    until,
)


PASSWORD = "plumtide-demo-26"
CARD = "4242424242424242"
CARD_SPACED = "4242 4242 4242 4242"
BAD_LUHN = "4242424242424241"
SHORT_CARD = "424242424242"
HARBOR_TZ = "America/New_York"
APP_ROOT = Path("/app")

HTTP_TIMEOUT = 30
UI_MS = 15_000
UI_S = 15
MAIL_WAIT_S = 90
SETUP_INVITE_TRIES = 3
AUTO_PAY_OFF_TAG = "00000000-0000-0000-0000-000000000001"
MAIL_LATE_S = 60
MAIL_SLACK_S = 30
POLL_SLACK_S = 3
GENERATION_WAIT_S = 60
WEBHOOK_WAIT_S = 180
DUNNING_WAIT_S = 120
BUILDER_PRICE = 49
PARTIAL_QTY = 3

LIVE_MS = 1000
LIVE_SLACK_MS = 500
SETTLE_MS = 1000
HALF_PIXEL = 0.5
COUNT_MS = 600
SPRING_MS = 1000
CLOSE_CANCEL_S = 2
SETTLEMENT_S = 5
MAINTENANCE_S = 2
LINK_TTL_S = 60
CLOSE_IN_S = 25
MALFORMED_ID = "not-a-uuid"
DOC_NAME = "id-card.png"
COOKIE_HTTPONLY = "HttpOnly"
COOKIE_SAMESITE = "SameSite=Lax"
COOKIE_PATH = "Path=/"
SHORT_INVITE_TTL_S = 5
MAX_TABS = 80
STEPS = 200

JSON_LIMIT = 65_536
UPLOAD_LIMIT = 5_000_000
DEPOSIT_MIN = 500
DEPOSIT_MAX = 500_000
QTY_MAX = 100_000
EVENT_PRICE_MAX = 99
PAIR_PRICE_MAX = 1_000_000
FEE_MAX = 1_000
NAME_MAX = 60
CONTRACT_CENTS = 100
SANDBOX_RATE = 2
BUILDER_RATE = 20
DESK_RATE = 100

ELEV_TOP = 90
ELEV_MID = 35
MID_Y = 600
END_Y = 1200
PAGE_EXTRA = 1200
YAW_PX = 6
YAW_MAX = 20

ASK = 37
NO_AT_ASK = 63
ASK_HIGH = 40
NO_AT_ASK_HIGH = 60
BID = 34
BID_LOW = 30
FILL_QTY = 120
REST_QTY = 200
LEFT_QTY = 80
ENTRY = 2500
PAIR_LOW = 2400
PAIR_HIGH = 2600
LIQ_MARK = 1666
HOLD_MARK = 1667
LIQ_EQUITY = 4160
HOLD_EQUITY = 4170
HOLD_MAINT = 4168
DEPOSIT_50 = 5_000
FUNDS = 100_000

DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)

PLATFORM_PROVIDERS = {"keycloak", "killbill", "postgres", "valkey", "svix", "minio", "mailpit"}
CSV_HEADER = "fill_id,filled_at,market_symbol,member_email,mode,side,outcome,price,quantity,fee_cents,liquidity"
ORDER_FILLED_FIELDS = {"event_id", "type", "venue", "market_id", "market_symbol", "order_id", "fill_id", "mode", "side",
                       "outcome", "price", "quantity", "fee_cents", "liquidity", "order_status", "remaining_quantity",
                       "filled_at"}
EMPTY_BOOK = "No resting orders yet — be the first on the book."
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}

expect.set_options(timeout=UI_MS)


def outage(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} is not set for this verifier run"
    return url.rstrip("/")


def money(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def fee(notional: int, bps: int) -> int:
    return (notional * bps + 5000) // 10000


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def body_of(r: httpx.Response) -> Any:
    try:
        return r.json()
    except ValueError:
        return None


def expect_status(r: httpx.Response, status: int, what: str) -> Any:
    assert r.status_code == status, f"{what}: expected {status}, got {r.status_code} {r.text[:600]}"
    return body_of(r)


def wait_for(probe: Callable[[], Any], seconds: float, contract: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
    pytest.fail(contract)


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], Any]) -> Any:
        barrier.wait()
        return call()

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def tag() -> str:
    return uuid.uuid4().hex[:10]


def fresh_identity(prefix: str) -> tuple[str, str]:
    t = tag()
    return f"{prefix} {t}", f"{prefix.lower()}-{t}@example.org"


@dataclass
class Member:
    base: str
    http: httpx.Client
    me: dict
    password: str

    @property
    def id(self) -> str:
        return self.me["id"]

    @property
    def email(self) -> str:
        return self.me["email"]

    @property
    def name(self) -> str:
        return self.me["display_name"]

    @property
    def venue(self) -> dict:
        return self.me["venue"]

    def on(self, base: str) -> "Member":
        return sign_in(base, self.me["username"], self.password)


def sign_in(base: str, username: str, password: str = PASSWORD) -> Member:
    base = base.rstrip("/")
    http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    r = http.post("/api/session", json={"username": username, "password": password})
    me = expect_status(r, 200, f"POST /api/session as {username}")
    return Member(base, http, me, password)


_KEYCLOAK: list[Any] = []


def keycloak_users(email: str) -> list[dict]:
    if not _KEYCLOAK:
        _KEYCLOAK.append(Keycloak())
    return [u for u in _KEYCLOAK[0].users(email) if (u.get("email") or "").lower() == email.lower()]


def mail_matches(mail: Any, email: str, subject: str | None = None, prefix: str | None = None,
                 minimum: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict]:
    def matching() -> list[dict]:
        found = []
        for message in mail.messages():
            if email.lower() not in [a.lower() for a in addresses(message.get("To"))]:
                continue
            title = message.get("Subject") or ""
            if subject is not None and title != subject:
                continue
            if prefix is not None and not title.startswith(prefix):
                continue
            found.append(message)
        return found

    deadline = time.monotonic() + seconds
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = matching()
        if len(found) >= minimum:
            break
    return found


def mail_for(mail: Any, email: str, subject: str | None = None, prefix: str | None = None,
             minimum: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict]:
    found = mail_matches(mail, email, subject, prefix, minimum, seconds)
    if len(found) < minimum:
        pytest.fail(f"Mailpit: expected {minimum} email(s) to {email} with subject {subject or prefix!r}, got {len(found)}")
    return found


def invite_token(message: dict) -> str:
    found = re.search(r"/invites/([^\s\"'<>)\]]+)", text(message))
    assert found, "invite email carries a /invites/<token> link (L625)"
    return found.group(1).rstrip(".,")


def invite(owner: Member, mail: Any, roles: list[str], prefix: str = "Trader") -> tuple[str, str, str]:
    for _ in range(SETUP_INVITE_TRIES):
        name, email = fresh_identity(prefix)
        r = owner.http.post("/api/venue/invites", json={"email": email, "display_name": name, "roles": roles})
        expect_status(r, 201, "POST /api/venue/invites")
        if found := mail_matches(mail, email, subject=f"You're invited to {owner.venue['name']}"):
            return name, email, invite_token(found[0])
    pytest.fail(f"Mailpit: none of {SETUP_INVITE_TRIES} setup invites got its email within {MAIL_WAIT_S} s")


def accept(base: str, email: str, token: str) -> Member:
    password = "pw-" + uuid.uuid4().hex
    r = httpx.post(f"{base}/api/invites/{token}/accept", json={"password": password}, timeout=HTTP_TIMEOUT)
    expect_status(r, 200, "POST /api/invites/{token}/accept")
    users = keycloak_users(email)
    assert len(users) == 1, f"Keycloak holds exactly one person for {email}"
    return sign_in(base, users[0]["username"], password)


def new_member(owner: Member, mail: Any, roles: tuple[str, ...] = ("trader",), funds: int = 0,
               prefix: str = "Trader") -> Member:
    _, email, token = invite(owner, mail, list(roles), prefix)
    member = accept(owner.base, email, token)
    if funds:
        deposit(member, funds)
    return member


def fresh_venue(base: str, mail: Any) -> tuple[dict, Member]:
    founder = sign_in(base, "plumtide-founder")
    slug = "t" + uuid.uuid4().hex[:12]
    name = f"Venue {slug}"
    _, owner_email = fresh_identity("Owner")
    r = founder.http.post("/api/platform/venues",
                          json={"slug": slug, "name": name, "time_zone": HARBOR_TZ, "owner_email": owner_email})
    venue = expect_status(r, 201, "POST /api/platform/venues")
    message = mail_for(mail, owner_email, subject=f"You're invited to {name}")[0]
    return venue, accept(base, owner_email, invite_token(message))


def harbor(base: str) -> tuple[Member, Member]:
    return sign_in(base, "hl-owner"), sign_in(base, "hl-admin")


def deposit(m: Member, cents: int, key: str | None = None) -> dict:
    headers = {"Idempotency-Key": key} if key else {}
    r = m.http.post("/api/deposits", json={"amount_cents": cents, "card_number": CARD}, headers=headers)
    return expect_status(r, 201, "POST /api/deposits")


def balance(m: Member) -> dict:
    return expect_status(m.http.get("/api/balance"), 200, "GET /api/balance")


def server_now(base: str) -> datetime:
    ana = sign_in(base, "hl-ana")
    markets = expect_status(ana.http.get("/api/markets"), 200, "GET /api/markets")["markets"]
    info = expect_status(ana.http.get(f"/api/markets/{markets[0]['id']}"), 200, "GET /api/markets/{id}")
    return parse_ts(info["server_time"])


def venue_month(base: str, back: int = 0) -> str:
    now = server_now(base).astimezone(ZoneInfo(HARBOR_TZ))
    year, month = now.year, now.month
    for _ in range(back):
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return f"{year:04d}-{month:02d}"


def month_label(ym: str) -> str:
    year, month = ym.split("-")
    return f"{calendar.month_name[int(month)]} {year}"


def symbol() -> str:
    return "T" + uuid.uuid4().hex[:9].upper()


def list_market(admin: Member, kind: str, closes_in: timedelta | None = None, open_: bool = True) -> dict:
    body: dict[str, Any] = {"kind": kind, "symbol": symbol(), "title": f"Verifier market {tag()}"}
    if kind == "event":
        body["closes_at"] = iso(server_now(admin.base) + (closes_in or timedelta(days=30)))
    market = expect_status(admin.http.post("/api/markets", json=body), 201, "POST /api/markets")
    if open_:
        market = expect_status(admin.http.post(f"/api/markets/{market['id']}/open"), 200, "POST open")
    return market


def market(m: Member, market_id: str) -> dict:
    return expect_status(m.http.get(f"/api/markets/{market_id}"), 200, "GET /api/markets/{id}")


def book(m: Member, market_id: str) -> dict:
    return expect_status(m.http.get(f"/api/markets/{market_id}/book"), 200, "GET /api/markets/{id}/book")


def ev(mk: dict, outcome: str, price: int, quantity: int) -> dict:
    return {"market_id": mk["id"], "outcome": outcome, "price": price, "quantity": quantity}


def pr(mk: dict, mode: str, side: str, price: int, quantity: int) -> dict:
    return {"market_id": mk["id"], "mode": mode, "side": side, "price": price, "quantity": quantity}


def place(m: Member, body: dict, status: int = 201, client: httpx.Client | None = None,
          headers: dict | None = None) -> Any:
    r = (client or m.http).post("/api/orders", json=body, headers=headers or {})
    return expect_status(r, status, f"POST /api/orders {body}")


def order(m: Member, order_id: str) -> dict:
    return expect_status(m.http.get(f"/api/orders/{order_id}"), 200, "GET /api/orders/{id}")


def fills(m: Member, market_id: str) -> list[dict]:
    return expect_status(m.http.get("/api/fills", params={"market_id": market_id}), 200, "GET /api/fills")["fills"]


def positions(m: Member) -> dict:
    return expect_status(m.http.get("/api/positions"), 200, "GET /api/positions")


def margin_position(m: Member, market_id: str) -> dict:
    rows = [p for p in positions(m)["margin"] if p["market_id"] == market_id]
    assert len(rows) == 1, f"one margin position per member per pair (L460), got {rows}"
    return rows[0]


def ledger_balanced(venue_id: str, members: list[Member]) -> None:
    pg = Postgres()
    accounts = ",".join(f"'member:{m.id}:{part}'" for m in members for part in ("available", "held", "collateral"))
    bad = pg.rows(
        "select entry_id::text as entry_id, sum(amount_cents)::bigint as total, count(*) as legs from journal_legs "
        f"where entry_id in (select entry_id from journal_legs where account in ({accounts})) "
        "group by entry_id having sum(amount_cents) <> 0 or count(*) < 2")
    assert bad == [], f"every journal entry has two or more legs summing to zero (L529): {bad[:5]}"
    total = pg.rows(f"select coalesce(sum(amount_cents),0)::bigint as total from journal_legs where venue_id::text = '{venue_id}'")
    assert int(total[0]["total"]) == 0, "the legs of a venue sum to zero (L529)"
    for m in members:
        b = balance(m)
        for part in ("available", "held", "collateral"):
            rows = pg.rows("select coalesce(sum(amount_cents),0)::bigint as total from journal_legs "
                           f"where account = 'member:{m.id}:{part}'")
            assert int(rows[0]["total"]) == b[f"{part}_cents"], f"{part} equals the sum of its legs for {m.email}"


def login_context(context: Any, m: Member) -> None:
    r = context.request.post(f"{m.base}/api/session", data={"username": m.me["username"], "password": m.password})
    assert r.status == 200, f"browser POST /api/session: {r.status}"


@contextmanager
def signed_in(browser: Browser, m: Member, path: str = "/", viewport: tuple[int, int] = DESKTOP,
              **options: Any) -> Iterator[Page]:
    context = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, **options)
    try:
        login_context(context, m)
        page = context.new_page()
        page.goto(m.base + path)
        yield page
    finally:
        context.close()


def keycloak_login(page: Page, username: str, password: str) -> None:
    box = page.get_by_role("textbox").first
    box.fill(username)
    box.focus()
    page.keyboard.press("Tab")
    page.keyboard.type(password)
    page.keyboard.press("Enter")


def btn(scope: Any, name: str) -> Any:
    return scope.get_by_role("button", name=name, exact=True)


def ticket(page: Page) -> Any:
    return page.get_by_role("form", name="Order ticket")


def updates(page: Page) -> Any:
    return page.get_by_role("status", name="Order updates")


def review_and_confirm(page: Page) -> None:
    btn(ticket(page), "Review order").click()
    dialog = page.get_by_role("dialog", name="Review order")
    btn(dialog, "Confirm order").click()


def set_event_ticket(page: Page, outcome: str, price: int, quantity: int) -> None:
    t = ticket(page)
    t.get_by_role("radio", name=outcome, exact=True).check()
    t.get_by_role("spinbutton", name="Price", exact=True).fill(str(price))
    t.get_by_role("spinbutton", name="Quantity", exact=True).fill(str(quantity))


def orbit(page: Page) -> Any:
    return page.get_by_role("img", name="Orderbook Orbit")


def rings(canvas: Any) -> list[dict]:
    return json.loads(canvas.get_attribute("data-rings") or "[]")


def is_focused(locator: Any) -> bool:
    return bool(locator.evaluate("e => e === document.activeElement"))


def holds_focus(locator: Any) -> bool:
    return bool(locator.evaluate("e => e.contains(document.activeElement)"))


def expect_shown(page: Page, text: str) -> None:
    matches = page.get_by_text(text, exact=True)
    expect(matches).not_to_have_count(0)
    deadline = time.monotonic() + UI_S
    while not any(matches.nth(i).is_visible() for i in range(matches.count())):
        assert time.monotonic() < deadline, f"{text!r} is on the page but never visible"


def tab_until(page: Page, locator: Any, inside: bool = False) -> None:
    for _ in range(MAX_TABS):
        page.keyboard.press("Tab")
        if (holds_focus(locator) if inside else is_focused(locator)):
            return
    pytest.fail("keyboard: Tab never reached the expected control (L183, L189)")


def create_key(builder: Member) -> dict:
    return expect_status(builder.http.post("/api/keys", json={"name": f"bot {tag()}"}), 201, "POST /api/keys")


def key_client(base: str, secret: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, headers={"Authorization": f"Bearer {secret}"})


def change_plan(builder: Member, plan: str, status: int = 200) -> Any:
    return expect_status(builder.http.post("/api/billing/plan", json={"plan": plan}), status, f"POST /api/billing/plan {plan}")


def rate_hash(valkey: Any, key: dict) -> dict:
    short = key["secret"].split("_")[1]
    for key_id in (key["id"], short):
        found = valkey.hash(f"ratelimit:{key_id}")
        if found:
            return found
    return {}


def killbill_account(killbill: Any, venue_slug: str, member: Member) -> dict | None:
    return killbill.account_by_key(f"{venue_slug}:{member.id}")


def plan_subscription(killbill: Any, account_id: str, member: Member) -> dict:
    subs = [s for s in killbill.subscriptions(account_id)
            if s.get("bundleExternalKey") == f"plan-{member.id}" and s.get("state") == "ACTIVE"]
    assert len(subs) == 1, f"one active Kill Bill subscription in bundle plan-<member id> (L574): {subs}"
    return subs[0]


def webhook_header(headers: dict, name: str) -> str:
    return headers.get(f"webhook-{name}") or headers.get(f"svix-{name}") or ""


class Sink:

    def __init__(self) -> None:
        self.records: list[dict] = []
        self.lock = threading.Lock()
        sink = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                headers = {k.lower(): v for k, v in self.headers.items()}
                with sink.lock:
                    first = not any(webhook_header(r["headers"], "id") == webhook_header(headers, "id") for r in sink.records)
                    status = 500 if first else 200
                    sink.records.append({"headers": headers, "body": raw, "status": status})
                self.send_response(status)
                self.end_headers()

            def log_message(self, *args: Any) -> None:
                return None

        self.server = HTTPServer(("0.0.0.0", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host = socket.gethostbyname(socket.gethostname())
        self.url = f"http://{host}:{self.server.server_address[1]}/hook"

    def close(self) -> None:
        self.server.shutdown()
        self.server.socket.shutdown(socket.SHUT_RDWR)
        self.server.server_close()


def svix_signature_ok(secret: str, headers: dict, raw: bytes) -> bool:
    key = base64.b64decode(secret.split("_", 1)[1] if "_" in secret else secret)
    signed = f"{webhook_header(headers, 'id')}.{webhook_header(headers, 'timestamp')}.".encode() + raw
    digest = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    return any(part.split(",", 1)[-1] == digest for part in webhook_header(headers, "signature").split())


def png_bytes() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b""))


def generate_statements(owner: Member, month: str, status: int | tuple[int, ...] = 202) -> dict:
    r = owner.http.post("/api/venue/statements", json={"month": month})
    allowed = status if isinstance(status, tuple) else (status,)
    assert r.status_code in allowed, f"POST /api/venue/statements: {r.status_code} {r.text[:400]}"
    return r.json()


def statement_for(m: Member, month: str) -> dict:
    def probe() -> dict | None:
        rows = expect_status(m.http.get("/api/statements"), 200, "GET /api/statements")["statements"]
        return next((s for s in rows if s["month"] == month), None)

    return wait_for(probe, GENERATION_WAIT_S, f"GET /api/statements lists {month} after the run (L496)")


def test_wf_sign_in_and_roles_browser_sign_in(browser: Browser, app_url: str) -> None:
    context = browser.new_context(viewport={"width": DESKTOP[0], "height": DESKTOP[1]})
    try:
        page = context.new_page()
        page.goto(f"{app_url}/")
        page.get_by_role("link", name="Sign in", exact=True).first.click()
        page.wait_for_url(lambda url: not same_origin(url, app_url))
        keycloak_login(page, "hl-ana", PASSWORD)
        page.wait_for_url(lambda url: same_origin(url, app_url) and urlparse(url).path == "/")
        nav = page.get_by_role("navigation", name="Venue")
        expect(nav).to_be_visible()
        expect(nav.get_by_role("link", name="Markets", exact=True)).to_be_visible()
        expect(btn(page, "Sign out")).to_be_visible()
        me = context.request.get(f"{app_url}/api/me")
        assert me.status == 200
        body = me.json()
        assert body["username"] == "hl-ana" and body["venue"]["slug"] == "harbor"
        other = browser.new_context()
        try:
            assert other.request.get(f"{app_url}/api/me").status == 401, "a session belongs to the browser that signed in"
        finally:
            other.close()
    finally:
        context.close()


def test_wf_sign_in_and_roles_callback_replay(browser: Browser, app_url: str) -> None:
    starts = []
    for _ in range(2):
        r = httpx.get(f"{app_url}/auth/login", params={"next": "/"}, follow_redirects=False, timeout=HTTP_TIMEOUT)
        assert r.status_code == 302
        q = parse_qs(urlparse(r.headers["location"]).query)
        assert q.get("code_challenge_method") == ["S256"], "S256 code challenge (L556)"
        assert q.get("state") and q.get("code_challenge") and q.get("nonce")
        assert any(COOKIE_HTTPONLY.lower() in c.lower() for c in r.headers.get_list("set-cookie")), \
            "state bound to an HttpOnly cookie"
        starts.append((q["state"][0], q["code_challenge"][0], q["nonce"][0]))
    assert len({s[0] for s in starts}) == 2 and len({s[1] for s in starts}) == 2 and len({s[2] for s in starts}) == 2

    callback = re.compile(r"/auth/callback")
    starter = browser.new_context()
    foreign = browser.new_context()
    stateless = browser.new_context()
    try:
        page = starter.new_page()
        held: list[str] = []
        login_actions = re.compile(r"/login-actions/")

        def hold(route: Any) -> None:
            response = route.fetch(max_redirects=0)
            location = response.headers.get("location", "")
            if callback.search(location):
                held.append(location)
                route.fulfill(status=204, body="")
            else:
                route.fulfill(response=response)

        starter.route(login_actions, hold)
        page.goto(f"{app_url}/auth/login?next=/")
        with page.expect_response(lambda r: bool(login_actions.search(r.url)) and r.request.method == "POST"):
            keycloak_login(page, "hl-bo", PASSWORD)
        assert held, "Keycloak redirects the sign-in to /auth/callback with a code (L557)"
        url = held[0]
        starter.unroute(login_actions)
        code = parse_qs(urlparse(url).query)["code"][0]

        def refused(context: Any, target: str) -> None:
            p = context.new_page()
            response = p.goto(target)
            assert response is not None and response.status == 400, "callback refused with 400 (L330)"
            expect(p.get_by_role("heading", name="Sign-in link expired")).to_be_visible()
            expect(p.get_by_text("Start again from Sign in.")).to_be_visible()
            expect(p.get_by_role("link", name="Sign in", exact=True)).to_be_visible()
            cookies = [h for h in response.headers_array() if h["name"].lower() == "set-cookie"]
            assert not any(re.match(r"pv_session=[^;]+", h["value"]) for h in cookies), "no pv_session is issued"

        refused(foreign, url)
        assert foreign.request.get(f"{app_url}/api/me").status == 401
        refused(stateless, f"{app_url}/auth/callback?code={code}")
        assert stateless.request.get(f"{app_url}/api/me").status == 401

        page.goto(url)
        page.wait_for_url(lambda u: same_origin(u, app_url) and urlparse(u).path == "/")
        me = starter.request.get(f"{app_url}/api/me")
        assert me.status == 200 and me.json()["username"] == "hl-bo", "the starting browser still signs in"
        refused(starter, url)
    finally:
        for context in (starter, foreign, stateless):
            context.close()


def test_password_session(app_url: str) -> None:
    r = httpx.post(f"{app_url}/api/session", json={"username": "hl-ana", "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    me = expect_status(r, 200, "POST /api/session")
    assert me["username"] == "hl-ana" and me["display_name"] == "Ana Pike" and me["email"] == "ana.pike@harbor.example"
    assert me["roles"] == ["trader"]
    assert {k: me["venue"][k] for k in ("slug", "name", "time_zone")} == {
        "slug": "harbor", "name": "Harbor Lantern Club", "time_zone": HARBOR_TZ}
    cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith("pv_session="))
    lowered = cookie.lower().replace(" ", "")
    assert COOKIE_HTTPONLY.lower() in lowered and COOKIE_SAMESITE.lower() in lowered and COOKIE_PATH.lower() in lowered

    member = sign_in(app_url, "hl-ana")
    assert expect_status(member.http.get("/api/me"), 200, "GET /api/me")["id"] == me["id"]
    bad = httpx.post(f"{app_url}/api/session", json={"username": "hl-ana", "password": "wrong-" + tag()},
                     timeout=HTTP_TIMEOUT)
    assert bad.status_code == 401 and bad.json() == {"error": "invalid_credentials"}
    assert not any(c.startswith("pv_session=") and not c.startswith("pv_session=;") for c in bad.headers.get_list("set-cookie"))
    assert member.http.delete("/api/session").status_code == 204
    after = member.http.get("/api/me")
    assert after.status_code == 401 and after.json() == {"error": "unauthenticated"}
    founder = sign_in(app_url, "plumtide-founder")
    assert founder.me["venue"] is None and founder.me["roles"] == ["founder_operator"]


def test_role_checks_forbidden(app_url: str, mail: Any, killbill: Any) -> None:
    owner, admin = harbor(app_url)
    trader = new_member(owner, mail, funds=DEPOSIT_50)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    dep = trader.http.get("/api/deposits").json()["deposits"][0]
    listed = list_market(admin, "event", open_=False)
    pair = list_market(admin, "pair")
    _, stranger = fresh_identity("Stranger")
    month = "2026-10"
    venue_calls = [
        ("POST", f"/api/markets/{listed['id']}/resolve", {"outcome": "yes"}),
        ("POST", f"/api/markets/{listed['id']}/resolve", {"outcome": "yes", "roles": ["market_admin"]}),
        ("POST", f"/api/markets/{pair['id']}/liquidations", None),
        ("POST", f"/api/deposits/{dep['id']}/refunds", {"amount_cents": DEPOSIT_MIN}),
        ("POST", f"/api/markets/{listed['id']}/open", None),
        ("POST", f"/api/markets/{pair['id']}/halt", None),
        ("POST", "/api/markets", {"kind": "pair", "symbol": symbol(), "title": "Forbidden"}),
        ("GET", "/api/admin/deposits", None),
        ("GET", "/api/admin/documents", None),
        ("GET", "/api/venue/members?q=pike", None),
        ("GET", "/api/venue/totals", None),
        ("PUT", "/api/venue/fees", {"taker_fee_bps": 0, "maker_fee_bps": 0}),
        ("POST", "/api/venue/invites", {"email": stranger, "display_name": "Stranger", "roles": ["trader"]}),
        ("POST", "/api/venue/statements", {"month": month}),
        ("GET", "/api/venue/billing", None),
        ("GET", f"/api/venue/fills.csv?month={month}", None),
        ("GET", "/api/platform/venues", None),
        ("GET", "/api/platform/health", None),
    ]
    builder_only = [("GET", "/api/keys", None), ("POST", "/api/keys", {"name": "nope"}), ("GET", "/api/billing", None),
                    ("POST", "/api/billing/plan", {"plan": "desk"}), ("GET", "/api/webhooks", None)]
    owner_only = [("GET", "/api/venue/totals", None), ("PUT", "/api/venue/fees", {"taker_fee_bps": 0, "maker_fee_bps": 0}),
                  ("POST", "/api/venue/invites", {"email": stranger, "display_name": "Stranger", "roles": ["trader"]}),
                  ("GET", "/api/venue/billing", None)]
    for caller, calls in ((trader, venue_calls + builder_only), (builder, venue_calls), (admin, owner_only)):
        for method, path, body in calls:
            r = caller.http.request(method, path, json=body) if body is not None else caller.http.request(method, path)
            assert r.status_code == 403 and body_of(r) == {"error": "forbidden"}, \
                f"{method} {path} as {caller.me['roles']}: {r.status_code} {r.text[:200]}"
    assert market(admin, listed["id"])["status"] == "listed"
    assert market(admin, pair["id"])["status"] == "trading"
    assert expect_status(trader.http.get(f"/api/deposits/{dep['id']}"), 200, "GET deposit")["refunded_cents"] == 0
    payment = killbill.payment_by_key(f"deposit-{dep['id']}")
    assert payment and not [t for t in payment["transactions"] if t["transactionType"] == "REFUND"]
    assert keycloak_users(stranger) == []


def test_other_members_records_not_found(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    resting = place(a, ev(mk, "yes", BID_LOW, 5))
    place(b, ev(mk, "no", NO_AT_ASK, 5))
    place(a, ev(mk, "yes", ASK, 5))
    a_fill = fills(a, mk["id"])[0]
    a_dep = a.http.get("/api/deposits").json()["deposits"][0]
    missing = str(uuid.uuid4())
    for path in ("/api/orders/{}", "/api/fills/{}", "/api/deposits/{}"):
        real_id = {"/api/orders/{}": resting["id"], "/api/fills/{}": a_fill["id"], "/api/deposits/{}": a_dep["id"]}[path]
        mine = b.http.get(path.format(real_id))
        ref = b.http.get(path.format(missing))
        assert mine.status_code == ref.status_code == 404 and body_of(mine) == body_of(ref) == {"error": "not_found"}
    cancel = b.http.delete(f"/api/orders/{resting['id']}")
    assert cancel.status_code == 404 and body_of(cancel) == {"error": "not_found"}
    assert b.http.get(f"/api/orders/{MALFORMED_ID}").status_code == 404
    assert order(a, resting["id"])["status"] == "resting"
    b_orders = b.http.get("/api/orders", params={"status": "all"}).json()["orders"]
    assert resting["id"] not in {o["id"] for o in b_orders}

    pell = sign_in(app_url, "cp-pell")
    for path in (f"/api/markets/{mk['id']}", f"/api/markets/{mk['id']}/book", f"/api/orders/{resting['id']}"):
        r = pell.http.get(path)
        assert r.status_code == 404 and body_of(r) == {"error": "not_found"}, path
    body_id = pell.http.post("/api/orders", json=ev(mk, "yes", BID_LOW, 1))
    assert body_id.status_code == 404 and body_of(body_id) == {"error": "not_found"}, "other venue id in a body"
    cp_admin = sign_in(app_url, "cp-admin")
    for method, path, body in (("POST", f"/api/markets/{mk['id']}/halt", None),
                               ("POST", f"/api/deposits/{a_dep['id']}/refunds", {"amount_cents": DEPOSIT_MIN})):
        r = cp_admin.http.request(method, path, json=body) if body else cp_admin.http.request(method, path)
        assert r.status_code == 404 and body_of(r) == {"error": "not_found"}, path
    assert market(admin, mk["id"])["status"] == "trading"


def test_profile_and_id_documents(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail)
    b = new_member(owner, mail)
    new_name = f"Renamed {tag()}"
    me = expect_status(a.http.patch("/api/me", json={"display_name": new_name}), 200, "PATCH /api/me")
    assert me["display_name"] == new_name
    for bad in ("", "x" * (NAME_MAX + 1)):
        r = a.http.patch("/api/me", json={"display_name": bad})
        assert r.status_code == 422 and r.json()["errors"] == {"display_name": "invalid"}
    assert a.http.get("/api/me").json()["display_name"] == new_name

    data = png_bytes()
    doc = expect_status(a.http.post("/api/me/documents", files={"document": (DOC_NAME, data, "image/png")}),
                        201, "POST /api/me/documents")
    assert doc["size_bytes"] == len(data) and doc["filename"] == DOC_NAME
    assert S3().get(f"venues/{a.venue['id']}/documents/{a.id}/{doc['id']}") == data
    fake = a.http.post("/api/me/documents", files={"document": ("id.png", b"plain text, not an image", "image/png")})
    assert fake.status_code == 422 and fake.json()["errors"] == {"document": "unsupported_type"}
    huge = a.http.post("/api/me/documents",
                       files={"document": ("big.png", data + b"\x00" * (UPLOAD_LIMIT + 1 - len(data)), "image/png")})
    assert huge.status_code == 413 and body_of(huge) == {"error": "payload_too_large"}
    own = a.http.get("/api/me/documents").json()["documents"]
    assert [d["id"] for d in own] == [doc["id"]]
    assert doc["id"] not in {d["id"] for d in b.http.get("/api/me/documents").json()["documents"]}

    listed = expect_status(admin.http.get("/api/admin/documents"), 200, "GET /api/admin/documents")["documents"]
    row = next(d for d in listed if d["id"] == doc["id"])
    assert row["member"]["id"] == a.id and row["member"]["display_name"] == new_name
    link = expect_status(admin.http.get(f"/api/admin/documents/{doc['id']}/link"), 200, "document link")
    assert httpx.get(link["url"], timeout=HTTP_TIMEOUT).content == data
    assert not same_origin(link["url"], app_url), "a presigned MinIO link"
    assert b.http.get(f"/api/admin/documents/{doc['id']}/link").status_code == 403
    cp_admin = sign_in(app_url, "cp-admin")
    assert cp_admin.http.get(f"/api/admin/documents/{doc['id']}/link").status_code == 404
    assert doc["id"] not in {d["id"] for d in cp_admin.http.get("/api/admin/documents").json()["documents"]}


def test_founder_console(app_url: str, mail: Any) -> None:
    founder = sign_in(app_url, "plumtide-founder")
    venues = expect_status(founder.http.get("/api/platform/venues"), 200, "GET /api/platform/venues")
    slugs = {v["slug"] for v in venues["venues"]}
    assert {"harbor", "copper"} <= slugs
    assert "harbor.example" not in json.dumps(venues), "no member emails on the platform list"
    health = expect_status(founder.http.get("/api/platform/health"), 200, "GET /api/platform/health")
    assert set(health["providers"]) == PLATFORM_PROVIDERS and set(health["providers"].values()) == {"up"}
    down = sign_in(outage("APP_KILLBILL_DOWN_URL"), "plumtide-founder")
    providers = expect_status(down.http.get("/api/platform/health"), 200, "health on killbill-down")["providers"]
    assert providers["killbill"] == "down" and providers["postgres"] == "up" and providers["keycloak"] == "up"

    venue, owner = fresh_venue(app_url, mail)
    assert owner.venue["id"] == venue["id"] and owner.me["roles"] == ["org_owner"]
    listed = founder.http.get("/api/platform/venues").json()["venues"]
    assert venue["slug"] in {v["slug"] for v in listed}
    dup = founder.http.post("/api/platform/venues", json={"slug": venue["slug"], "name": "Again", "time_zone": HARBOR_TZ,
                                                          "owner_email": fresh_identity("Owner")[1]})
    assert dup.status_code == 409 and dup.json() == {"error": "slug_taken"}

    ana = sign_in(app_url, "hl-ana")
    ana_order = ana.http.get("/api/orders", params={"status": "all"}).json()["orders"][0]["id"]
    ana_dep = ana.http.get("/api/deposits").json()["deposits"][0]["id"]
    for path in (f"/api/orders/{ana_order}", f"/api/deposits/{ana_dep}", f"/api/statements/{uuid.uuid4()}/link"):
        assert founder.http.get(path).status_code == 404, path
    for path in ("/api/markets", "/api/orders", "/api/statements", "/api/venue/totals", "/api/balance"):
        assert founder.http.get(path).status_code == 403, path


def test_wf_card_deposits_happy(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    a = new_member(owner, mail)
    before = balance(a)["available_cents"]
    with signed_in(browser, a, "/balance") as page:
        btn(page, "Deposit by card").click()
        dialog = page.get_by_role("dialog", name="Deposit by card")
        amount = dialog.get_by_role("textbox", name="Amount (USD)")
        expect(amount).to_be_focused()
        amount.fill("50.00")
        dialog.get_by_role("textbox", name="Card number").fill(CARD)
        status = page.get_by_role("status", name="Deposit status")
        with held(page, "**/api/deposits") as gate:
            btn(dialog, "Deposit").click()
            expect(status).to_have_text("Waiting for card confirmation…")
            gate.release()
        expect(status).to_have_text("Deposit confirmed — $50.00 added to your balance.")
        expect(page.get_by_role("table", name="Deposits")).to_contain_text("$50.00")
    assert balance(a)["available_cents"] == before + DEPOSIT_50
    deposits = a.http.get("/api/deposits").json()["deposits"]
    assert [(d["amount_cents"], d["status"], d["card_last4"]) for d in deposits] == [(DEPOSIT_50, "succeeded", "4242")]
    account = killbill_account(killbill, "harbor", a)
    payment = killbill.payment_by_key(f"deposit-{deposits[0]['id']}")
    assert account and payment and payment["accountId"] == account["accountId"]
    tx = payment["transactions"][0]
    assert tx["transactionType"] == "PURCHASE" and tx["status"] == "SUCCESS" and round(float(tx["amount"]) * 100) == DEPOSIT_50


def test_wf_card_deposits_invalid_recovery(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    a = new_member(owner, mail)
    with signed_in(browser, a, "/balance") as page:
        opener = btn(page, "Deposit by card")
        opener.click()
        dialog = page.get_by_role("dialog", name="Deposit by card")
        dialog.get_by_role("textbox", name="Amount (USD)").fill("4.99")
        dialog.get_by_role("textbox", name="Card number").fill(CARD)
        dialog.get_by_role("textbox", name="Card number").press("Enter")
        expect_shown(page, "Enter an amount from $5.00 to $5,000.00.")
        dialog.get_by_role("textbox", name="Amount (USD)").fill("50.00")
        dialog.get_by_role("textbox", name="Card number").fill(BAD_LUHN)
        btn(dialog, "Deposit").click()
        expect_shown(page, "Enter a valid card number.")
        assert a.http.get("/api/deposits").json()["deposits"] == []
        account = killbill_account(killbill, "harbor", a)
        assert account is None or killbill.payments(account["accountId"]) == []
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        opener.click()
        dialog.get_by_role("textbox", name="Amount (USD)").fill("50.00")
        dialog.get_by_role("textbox", name="Card number").fill(CARD)
        btn(dialog, "Deposit").click()
        expect(page.get_by_role("status", name="Deposit status")).to_have_text(
            "Deposit confirmed — $50.00 added to your balance.")
    assert balance(a)["available_cents"] == DEPOSIT_50


def test_deposit_credited_on_killbill_success(app_url: str, mail: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    a = new_member(owner, mail)
    key = "dep-" + tag()
    first = a.http.post("/api/deposits", json={"amount_cents": DEPOSIT_50, "card_number": CARD}, headers={"Idempotency-Key": key})
    dep = expect_status(first, 201, "POST /api/deposits")
    assert dep["status"] == "succeeded" and dep["amount_cents"] == DEPOSIT_50 and dep["card_last4"] == "4242"
    account = killbill_account(killbill, "harbor", a)
    assert account and account["email"] == a.email and account.get("currency") == "USD"
    assert killbill.default_plugin(account["accountId"]) == "__EXTERNAL_PAYMENT__"
    payment = killbill.payment_by_key(f"deposit-{dep['id']}")
    assert payment["accountId"] == account["accountId"] and payment["paymentId"] == dep["killbill_payment_id"]
    assert [(t["transactionType"], t["status"], t["transactionExternalKey"]) for t in payment["transactions"]] == [
        ("PURCHASE", "SUCCESS", f"deposit-{dep['id']}")]
    assert balance(a)["available_cents"] == DEPOSIT_50

    replay = a.http.post("/api/deposits", json={"amount_cents": DEPOSIT_50, "card_number": CARD}, headers={"Idempotency-Key": key})
    assert replay.status_code == 201 and replay.json() == dep
    conflict = a.http.post("/api/deposits", json={"amount_cents": DEPOSIT_MIN, "card_number": CARD}, headers={"Idempotency-Key": key})
    assert conflict.status_code == 409 and conflict.json() == {"error": "idempotency_conflict"}

    key2 = "dep-" + tag()
    results = together([lambda: a.http.post("/api/deposits", json={"amount_cents": DEPOSIT_50, "card_number": CARD},
                                            headers={"Idempotency-Key": key2}) for _ in range(4)])
    assert all(r.status_code == 201 for r in results)
    assert len({r.json()["id"] for r in results}) == 1, "of simultaneous requests with one key exactly one executes"
    assert len(killbill.payments(account["accountId"])) == 2
    assert len(a.http.get("/api/deposits").json()["deposits"]) == 2
    assert balance(a)["available_cents"] == 2 * DEPOSIT_50


def test_deposit_validation(app_url: str, mail: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    a = new_member(owner, mail)
    cases = [
        ({"amount_cents": DEPOSIT_MIN - 1, "card_number": CARD}, "amount_cents", "out_of_range"),
        ({"amount_cents": DEPOSIT_MAX + 1, "card_number": CARD}, "amount_cents", "out_of_range"),
        ({"amount_cents": DEPOSIT_50, "card_number": BAD_LUHN}, "card_number", "invalid"),
        ({"amount_cents": DEPOSIT_50, "card_number": SHORT_CARD}, "card_number", "invalid"),
        ({"amount_cents": str(DEPOSIT_50), "card_number": CARD}, "amount_cents", "invalid"),
        ({"card_number": CARD}, "amount_cents", "invalid"),
    ]
    pg = Postgres()
    for body, field, code in cases:
        r = a.http.post("/api/deposits", json=body)
        assert r.status_code == 422 and r.json()["error"] == "validation" and r.json()["errors"][field] == code, (body, r.text)
    assert a.http.get("/api/deposits").json()["deposits"] == []
    assert balance(a)["available_cents"] == 0
    assert pg.rows(f"select count(*) as n from journal_legs where account like 'member:{a.id}:%'")[0]["n"] == 0
    account = killbill_account(killbill, "harbor", a)
    assert account is None or killbill.payments(account["accountId"]) == []
    ok = expect_status(a.http.post("/api/deposits", json={"amount_cents": DEPOSIT_MIN, "card_number": CARD_SPACED}), 201, "min deposit")
    assert ok["amount_cents"] == DEPOSIT_MIN and ok["card_last4"] == "4242"
    assert balance(a)["available_cents"] == DEPOSIT_MIN


def test_wf_card_deposits_outage(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    down_url = outage("APP_KILLBILL_DOWN_URL")
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    dep = a.http.get("/api/deposits").json()["deposits"][0]
    mk = list_market(admin, "event")
    account = killbill_account(killbill, "harbor", a)
    payments_before = len(killbill.payments(account["accountId"]))
    a_down = a.on(down_url)
    r = a_down.http.post("/api/deposits", json={"amount_cents": DEPOSIT_50, "card_number": CARD})
    assert r.status_code == 503 and r.json() == {"error": "payments_unavailable"}
    refund = sign_in(down_url, "hl-admin").http.post(f"/api/deposits/{dep['id']}/refunds", json={"amount_cents": DEPOSIT_MIN})
    assert refund.status_code == 503 and refund.json() == {"error": "payments_unavailable"}
    resting = place(a_down, ev(mk, "yes", BID_LOW, 5))
    assert resting["status"] == "resting", "trading continues while Kill Bill is down"
    with signed_in(browser, a_down, "/balance") as page:
        btn(page, "Deposit by card").click()
        dialog = page.get_by_role("dialog", name="Deposit by card")
        dialog.get_by_role("textbox", name="Amount (USD)").fill("50.00")
        dialog.get_by_role("textbox", name="Card number").fill(CARD)
        btn(dialog, "Deposit").click()
        expect(page.get_by_role("alert").filter(has_text="Card payments are paused — your balance is safe")).to_be_visible()
    assert len(a.http.get("/api/deposits").json()["deposits"]) == 1
    assert len(killbill.payments(account["accountId"])) == payments_before
    assert balance(a)["available_cents"] == FUNDS - resting["hold_cents"]


def test_deposit_receipt_email(app_url: str, mail: Any) -> None:
    owner, _ = harbor(app_url)
    a = new_member(owner, mail)
    b = new_member(owner, mail)
    dep = deposit(a, DEPOSIT_50)
    deposit(b, ENTRY)
    receipt = mail_for(mail, a.email, subject="Deposit received — $50.00")
    body = text(receipt[0])
    assert dep["id"] in body and "4242" in body and "$50.00" in body
    assert b.email not in body and b.name not in body and b.id not in body
    assert addresses(receipt[0].get("To")) == [a.email]
    assert addresses(receipt[0].get("From")) == [mail_from_address()] == ["venue@plumtide.example"]

    late = a.on(outage("APP_MAILPIT_DOWN_URL"))
    late_dep = deposit(late, PAIR_HIGH)
    arrived = mail_for(mail, a.email, subject="Deposit received — $26.00", seconds=MAIL_LATE_S + MAIL_SLACK_S)
    assert late_dep["id"] in text(arrived[0])
    assert len(mail_for(mail, a.email, prefix="Deposit received — ", minimum=2)) == 2, "one receipt per deposit"


def test_deposit_refunds(app_url: str, mail: Any, killbill: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail)
    b = new_member(owner, mail)
    dep = deposit(a, FUNDS // 10)
    search = expect_status(admin.http.get("/api/admin/deposits", params={"q": a.email}), 200, "admin deposits")["deposits"]
    row = next(d for d in search if d["id"] == dep["id"])
    assert row["member"]["email"] == a.email
    assert dep["id"] not in {d["id"] for d in admin.http.get("/api/admin/deposits", params={"q": b.email}).json()["deposits"]}

    refund = expect_status(admin.http.post(f"/api/deposits/{dep['id']}/refunds", json={"amount_cents": ENTRY}), 201, "refund")
    assert refund["deposit_id"] == dep["id"] and refund["amount_cents"] == ENTRY
    payment = killbill.payment_by_key(f"deposit-{dep['id']}")
    refunds = [t for t in payment["transactions"] if t["transactionType"] == "REFUND"]
    assert [(t["status"], t["transactionExternalKey"], round(float(t["amount"]) * 100)) for t in refunds] == [
        ("SUCCESS", f"refund-{refund['id']}", ENTRY)]
    assert balance(a)["available_cents"] == FUNDS // 10 - ENTRY
    mail_for(mail, a.email, subject="Refund issued — $25.00")

    over = admin.http.post(f"/api/deposits/{dep['id']}/refunds", json={"amount_cents": FUNDS // 10 - ENTRY + 1})
    assert over.status_code == 422 and over.json()["errors"] == {"amount_cents": "exceeds_refundable"}
    place(a, ev(list_market(admin, "event"), "yes", ASK_HIGH, 50))
    available = balance(a)["available_cents"]
    cap = min(FUNDS // 10 - ENTRY, available)
    over_available = admin.http.post(f"/api/deposits/{dep['id']}/refunds", json={"amount_cents": cap + 1})
    assert over_available.status_code == 422 and over_available.json()["errors"] == {"amount_cents": "exceeds_refundable"}
    half = cap // 2 + 1
    raced = together([lambda: admin.http.post(f"/api/deposits/{dep['id']}/refunds", json={"amount_cents": half})
                      for _ in range(2)])
    assert sorted(r.status_code for r in raced) == [201, 422]
    assert expect_status(a.http.get(f"/api/deposits/{dep['id']}"), 200, "deposit")["refunded_cents"] == ENTRY + half
    payment = killbill.payment_by_key(f"deposit-{dep['id']}")
    assert len([t for t in payment["transactions"] if t["transactionType"] == "REFUND" and t["status"] == "SUCCESS"]) == 2
    assert balance(a)["available_cents"] == available - half
    missing = admin.http.post(f"/api/deposits/{uuid.uuid4()}/refunds", json={"amount_cents": DEPOSIT_MIN})
    assert missing.status_code == 404


def test_balanced_ledger(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK, FILL_QTY))
    place(a, ev(mk, "yes", ASK, FILL_QTY))
    resting = place(a, ev(mk, "yes", BID_LOW, 5))
    expect_status(a.http.delete(f"/api/orders/{resting['id']}"), 200, "cancel")
    ledger_balanced(a.venue["id"], [a, b])
    pg = Postgres()
    entries = pg.rows("select distinct entry_id::text as id from journal_legs "
                      f"where account = 'member:{a.id}:available' and amount_cents = {FUNDS}")
    assert len(entries) == 1, "the deposit posts as exactly one journal entry crediting available (L529)"
    legs = pg.rows(f"select account, amount_cents from journal_legs where entry_id::text = '{entries[0]['id']}'")
    assert len(legs) >= 2 and sum(int(leg["amount_cents"]) for leg in legs) == 0
    assert [leg["account"] for leg in legs if leg["account"].startswith("member:")] == [f"member:{a.id}:available"]


def test_wf_event_trading_fill(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK, REST_QTY))
    taker_bps = market(a, mk["id"])["taker_fee_bps"]
    before = balance(a)["available_cents"]
    with signed_in(browser, a, f"/markets/{mk['id']}") as page:
        levels = page.get_by_role("listbox", name="Book levels")
        levels.get_by_role("option", name=f"Ask {ASK}¢, {REST_QTY} resting", exact=True).click()
        t = ticket(page)
        expect(t.get_by_role("radio", name="Yes", exact=True)).to_be_checked()
        expect(t.get_by_role("spinbutton", name="Price", exact=True)).to_have_value(str(ASK))
        quantity = t.get_by_role("spinbutton", name="Quantity", exact=True)
        expect(quantity).to_have_value(str(REST_QTY))
        expect(quantity).to_be_focused()
        quantity.fill(str(FILL_QTY))
        cost = ASK * FILL_QTY
        charge = fee(cost, taker_bps)
        expect(page.get_by_role("status", name="Ticket summary")).to_have_text(
            f"Cost {money(cost)} + fee {money(charge)} = {money(cost + charge)}")
        review_and_confirm(page)
        expect(updates(page)).to_contain_text("Filled in full")
        expect(updates(page)).to_contain_text(f"Filled {FILL_QTY} at {ASK}¢")
        names = [o.get_attribute("aria-label") or o.inner_text() for o in levels.get_by_role("option").all()]
        expect(levels.get_by_role("option", name=f"Ask {ASK}¢, {LEFT_QTY} resting", exact=True)).to_be_visible()
        assert len(names) >= 1
    orders = a.http.get("/api/orders", params={"status": "all", "market_id": mk["id"]}).json()["orders"]
    assert [(o["status"], o["filled_quantity"]) for o in orders] == [("filled", FILL_QTY)]
    assert balance(a)["available_cents"] == before - cost - charge
    asks = book(a, mk["id"])["asks"]
    assert asks[0] == {"price": ASK, "quantity": LEFT_QTY}, "the 37¢ ask is still the best ask with 80 resting"


def test_wf_event_trading_cancel(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    with signed_in(browser, a, f"/markets/{mk['id']}") as page:
        set_event_ticket(page, "Yes", BID_LOW, 20)
        review_and_confirm(page)
        expect(updates(page)).to_contain_text("Order resting")
        placed = a.http.get("/api/orders", params={"status": "open", "market_id": mk["id"]}).json()["orders"][0]
        assert placed["status"] == "resting" and balance(a)["held_cents"] == placed["hold_cents"]
        page.get_by_role("region", name="Your orders").get_by_role(
            "button", name=f"Cancel order {placed['id'][:8]}", exact=True).click()
        dialog = page.get_by_role("dialog", name="Cancel order")
        with held(page, f"**/api/orders/{placed['id']}") as gate:
            btn(dialog, "Yes, cancel").click()
            expect(updates(page)).to_contain_text("Cancelling…")
            gate.release()
        expect(updates(page)).to_contain_text("Order cancelled")
        expect(updates(page)).not_to_contain_text("Cancelling…")
    assert order(a, placed["id"])["status"] == "cancelled"
    assert balance(a) | {} and balance(a)["available_cents"] == FUNDS and balance(a)["held_cents"] == 0


def test_event_mirror_matching(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a, b, c, d, e = (new_member(owner, mail, funds=FUNDS) for _ in range(5))
    mk = list_market(admin, "event")
    first = place(a, ev(mk, "yes", ASK, 10))
    place(b, ev(mk, "no", NO_AT_ASK_HIGH, 5))
    levels = book(a, mk["id"])
    assert levels["bids"] == [{"price": ASK, "quantity": 10}] and levels["asks"] == [{"price": ASK_HIGH, "quantity": 5}]
    crossing = place(c, ev(mk, "no", NO_AT_ASK, 4))
    assert crossing["status"] == "filled"
    assert [(f["price"], f["quantity"], f["notional_cents"], f["outcome"]) for f in fills(c, mk["id"])] == [
        (NO_AT_ASK, 4, NO_AT_ASK * 4, "no")]
    assert [(f["price"], f["liquidity"]) for f in fills(a, mk["id"])] == [(ASK, "maker")]
    later = place(d, ev(mk, "yes", ASK, 3))
    place(e, ev(mk, "no", NO_AT_ASK, 8))
    assert order(a, first["id"])["status"] == "filled"
    assert order(d, later["id"])["filled_quantity"] == 2, "the earlier bid at the same price filled first"
    escrow = Postgres().rows("select coalesce(sum(amount_cents),0)::bigint as total from journal_legs "
                             f"where account = 'venue:escrow:{mk['id']}'")
    assert abs(int(escrow[0]["total"])) == CONTRACT_CENTS * (4 + 8)
    assert market(a, mk["id"])["open_interest"] == 12


def test_fee_per_fill(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    makers = [place(b, ev(mk, "no", NO_AT_ASK, FILL_QTY)) for _ in range(2)]
    before = balance(a)
    taker = place(a, ev(mk, "yes", ASK, 2 * FILL_QTY))
    assert taker["status"] == "filled"
    per_fill = fee(ASK * FILL_QTY, taker["taker_fee_bps"])
    if taker["taker_fee_bps"] == 125:
        assert per_fill == 56
    a_fills = fills(a, mk["id"])
    assert sorted((f["notional_cents"], f["fee_cents"], f["liquidity"]) for f in a_fills) == [
        (ASK * FILL_QTY, per_fill, "taker")] * 2
    after = balance(a)
    assert after["available_cents"] == before["available_cents"] - 2 * (ASK * FILL_QTY + per_fill)
    assert after["held_cents"] == before["held_cents"]
    for f in fills(b, mk["id"]):
        maker_bps = makers[0]["maker_fee_bps"]
        assert f["notional_cents"] == NO_AT_ASK * FILL_QTY and f["fee_cents"] == fee(NO_AT_ASK * FILL_QTY, maker_bps)


def test_order_validation_and_holds(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS // 10)
    mk = list_market(admin, "event")
    pair = list_market(admin, "pair")
    listed = list_market(admin, "event", open_=False)
    for body, field in ((ev(mk, "yes", 0, 1), "price"), (ev(mk, "yes", EVENT_PRICE_MAX + 1, 1), "price"),
                        (ev(mk, "yes", ASK, 0), "quantity"), (ev(mk, "yes", ASK, QTY_MAX + 1), "quantity"),
                        (pr(pair, "spot", "buy", PAIR_PRICE_MAX + 1, 1), "price")):
        r = a.http.post("/api/orders", json=body)
        assert r.status_code == 422 and r.json()["errors"][field] == "out_of_range", (body, r.text)
    r = a.http.post("/api/orders", json=ev(listed, "yes", ASK, 1))
    assert r.status_code == 409 and r.json() == {"error": "market_not_trading", "status": "listed"}
    r = a.http.post("/api/orders", json=ev(mk, "yes", EVENT_PRICE_MAX, 102))
    assert r.status_code == 422 and r.json() == {"error": "validation", "errors": {"quantity": "insufficient_funds"}}
    assert balance(a)["held_cents"] == 0 and a.http.get("/api/orders", params={"status": "all"}).json()["orders"] == []
    placed = place(a, ev(mk, "yes", ASK, 50))
    hold = ASK * 50 + fee(ASK * 50, placed["taker_fee_bps"])
    assert placed["hold_cents"] == hold
    assert balance(a)["available_cents"] == FUNDS // 10 - hold and balance(a)["held_cents"] == hold
    expect_status(a.http.delete(f"/api/orders/{placed['id']}"), 200, "cancel")
    assert balance(a)["available_cents"] == FUNDS // 10 and balance(a)["held_cents"] == 0


def test_order_lifecycle(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    resting = place(a, ev(mk, "yes", ASK_HIGH, 10))
    assert resting["status"] == "resting" and resting["remaining_quantity"] == 10
    taker = place(b, ev(mk, "no", NO_AT_ASK_HIGH, 4))
    assert taker["status"] == "filled"
    partial = order(a, resting["id"])
    assert (partial["status"], partial["filled_quantity"], partial["remaining_quantity"]) == ("partially_filled", 4, 6)
    r = b.http.delete(f"/api/orders/{taker['id']}")
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition", "from": "filled", "to": "cancelled"}
    other = place(a, ev(mk, "yes", BID_LOW, 5))
    expect_status(admin.http.post(f"/api/markets/{mk['id']}/halt"), 200, "halt")
    assert expect_status(a.http.delete(f"/api/orders/{resting['id']}"), 200, "cancel while halted")["status"] == "cancelled"
    r = a.http.delete(f"/api/orders/{resting['id']}")
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition", "from": "cancelled", "to": "cancelled"}
    raced = together([lambda: a.http.delete(f"/api/orders/{other['id']}") for _ in range(2)])
    assert sorted(r.status_code for r in raced) == [200, 409]
    assert balance(a)["held_cents"] == 0


def test_order_announcements(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=DEPOSIT_50)
    b = new_member(owner, mail, funds=FUNDS)
    c = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK_HIGH, 5))
    with signed_in(browser, a, f"/markets/{mk['id']}") as page:
        set_event_ticket(page, "Yes", ASK_HIGH, 8)
        btn(ticket(page), "Review order").click()
        with held(page, "**/api/orders") as gate:
            btn(page.get_by_role("dialog", name="Review order"), "Confirm order").click()
            expect(updates(page)).to_contain_text("Sending order…")
            gate.release()
        log = updates(page)
        first_fill = f"Filled {5} at {ASK_HIGH}¢"
        later_fill = f"Filled {3} at {ASK_HIGH}¢"
        expect(log).to_contain_text(first_fill)
        expect(log).not_to_contain_text("Sending order…")
        lines = [line.strip() for line in log.inner_text().splitlines() if line.strip()]
        assert lines.index(f"Partially filled — {5} of {8}") < lines.index(first_fill)
        place(c, ev(mk, "no", NO_AT_ASK_HIGH, 3))
        expect(log).to_contain_text(later_fill)
        set_event_ticket(page, "Yes", EVENT_PRICE_MAX, 1000)
        review_and_confirm(page)
        expect(log).to_contain_text("Not enough available balance for this order.")
    orders = a.http.get("/api/orders", params={"status": "all", "market_id": mk["id"]}).json()["orders"]
    assert [(o["status"], o["filled_quantity"]) for o in orders] == [("filled", 8)]


def test_keyboard_ticket(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    c = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK, 5))
    place(b, ev(mk, "no", NO_AT_ASK_HIGH, 4))
    place(c, ev(mk, "yes", BID, 6))
    with signed_in(browser, a, "/markets") as page:
        link = page.get_by_role("list", name="Markets").get_by_role("link", name=f"{mk['symbol']} — {mk['title']}", exact=True)
        tab_until(page, link)
        page.keyboard.press("Enter")
        page.wait_for_url(f"**/markets/{mk['id']}")
        levels = page.get_by_role("listbox", name="Book levels")
        expect(levels.get_by_role("option")).to_have_count(3)
        tab_until(page, levels, inside=True)
        page.keyboard.press("Home")
        expect(orbit(page)).to_have_attribute("data-highlight", f"ask:{ASK_HIGH}")
        page.keyboard.press("End")
        expect(orbit(page)).to_have_attribute("data-highlight", f"bid:{BID}")
        page.keyboard.press("Home")
        page.keyboard.press("ArrowDown")
        expect(orbit(page)).to_have_attribute("data-highlight", f"ask:{ASK}")
        page.keyboard.press("Enter")
        t = ticket(page)
        quantity = t.get_by_role("spinbutton", name="Quantity", exact=True)
        expect(quantity).to_be_focused()
        expect(quantity).to_have_value("5")
        expect(t.get_by_role("spinbutton", name="Price", exact=True)).to_have_value(str(ASK))
        expect(t.get_by_role("radio", name="Yes", exact=True)).to_be_checked()

        page.keyboard.press("Control+Enter")
        dialog = page.get_by_role("dialog", name="Review order")
        confirm, back = btn(dialog, "Confirm order"), btn(dialog, "Back")
        expect(confirm).to_be_focused()
        page.keyboard.press("Tab")
        expect(back).to_be_focused()
        page.keyboard.press("Tab")
        expect(confirm).to_be_focused()
        page.keyboard.press("Shift+Tab")
        expect(back).to_be_focused()
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        review = btn(t, "Review order")
        expect(review).to_be_focused()
        page.keyboard.press("Control+Enter")
        expect(confirm).to_be_focused()
        page.keyboard.press("Enter")
        expect(updates(page)).to_contain_text("Filled in full")
        expect(review).to_be_focused()

        price = t.get_by_role("spinbutton", name="Price", exact=True)

        def shift_tab_to(target: Any, before: Any = None) -> None:
            for _ in range(5):
                page.keyboard.press("Shift+Tab")
                if is_focused(target):
                    return
                assert before is None or not is_focused(before), "ticket Tab order: Price, then Quantity (L189)"
            pytest.fail("ticket Tab order: Price and its steppers, Quantity and its steppers, Review order (L189)")

        shift_tab_to(quantity, before=price)
        page.keyboard.press("Control+a")
        page.keyboard.type("3")
        shift_tab_to(price)
        page.keyboard.press("Control+a")
        page.keyboard.type(str(BID_LOW))
        page.keyboard.press("Control+Enter")
        expect(confirm).to_be_focused()
        page.keyboard.press("Enter")
        expect(updates(page)).to_contain_text("Order resting")
        open_order = a.http.get("/api/orders", params={"status": "open", "market_id": mk["id"]}).json()["orders"][0]
        your = page.get_by_role("region", name="Your orders")
        cancel = your.get_by_role("button", name=f"Cancel order {open_order['id'][:8]}", exact=True)
        tab_until(page, cancel)
        page.keyboard.press("Enter")
        cancel_dialog = page.get_by_role("dialog", name="Cancel order")
        yes = btn(cancel_dialog, "Yes, cancel")
        expect(yes).to_be_focused()
        page.keyboard.press("Tab")
        expect(btn(cancel_dialog, "Keep order")).to_be_focused()
        page.keyboard.press("Tab")
        expect(yes).to_be_focused()
        page.keyboard.press("Escape")
        expect(cancel).to_be_focused()
        page.keyboard.press("Enter")
        expect(yes).to_be_focused()
        page.keyboard.press("Enter")
        expect(your.get_by_role("heading", name="Your orders")).to_be_focused()
    assert order(a, open_order["id"])["status"] == "cancelled"


def test_wf_shared_book_margin_meets_spot(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a, b, c = (new_member(owner, mail, funds=FUNDS) for _ in range(3))
    pair = list_market(admin, "pair")
    taker_bps = market(a, pair["id"])["taker_fee_bps"]
    with signed_in(browser, a, f"/markets/{pair['id']}") as page:
        t = ticket(page)
        t.get_by_role("radio", name="Margin", exact=True).check()
        t.get_by_role("radio", name="Buy", exact=True).check()
        t.get_by_role("spinbutton", name="Price", exact=True).fill("25.00")
        t.get_by_role("spinbutton", name="Quantity", exact=True).fill("5")
        notional = ENTRY * 5
        collateral = math.ceil(notional / 2)
        charge = fee(notional, taker_bps)
        expect(page.get_by_role("status", name="Ticket summary")).to_have_text(
            f"Collateral {money(collateral)} + fee {money(charge)} = {money(collateral + charge)}")
        review_and_confirm(page)
        expect(updates(page)).to_contain_text("Order resting")
    margin_order = a.http.get("/api/orders", params={"status": "open", "market_id": pair["id"]}).json()["orders"][0]
    assert margin_order["mode"] == "margin" and margin_order["hold_cents"] == collateral + charge
    spot_order = place(c, pr(pair, "spot", "buy", ENTRY, 3))
    level = book(a, pair["id"])["bids"][0]
    assert (level["price"], level["quantity"], level["spot_quantity"], level["margin_quantity"]) == (ENTRY, 8, 3, 5)
    stolen = b.http.delete(f"/api/orders/{margin_order['id']}")
    assert stolen.status_code == 404 and stolen.json() == {"error": "not_found"}
    assert order(a, margin_order["id"])["status"] == "resting"
    place(b, pr(pair, "margin", "sell", ENTRY, 6))
    assert order(a, margin_order["id"])["status"] == "filled", "the earlier margin order fills first"
    spot = order(c, spot_order["id"])
    assert (spot["status"], spot["filled_quantity"]) == ("partially_filled", 1)
    assert [s["quantity"] for s in positions(c)["spot"] if s["market_id"] == pair["id"]] == [1]
    assert margin_position(a, pair["id"])["side"] == "long" and margin_position(b, pair["id"])["side"] == "short"


def test_spot_holdings(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    b, c, d = (new_member(owner, mail, funds=FUNDS) for _ in range(3))
    pair = list_market(admin, "pair")
    r = d.http.post("/api/orders", json=pr(pair, "spot", "sell", PAIR_HIGH, 1))
    assert r.status_code == 422 and r.json() == {"error": "validation", "errors": {"quantity": "insufficient_holdings"}}
    place(c, pr(pair, "spot", "buy", PAIR_LOW, 4))
    place(b, pr(pair, "margin", "sell", PAIR_LOW, 4))
    holding = next(s for s in positions(c)["spot"] if s["market_id"] == pair["id"])
    assert (holding["quantity"], holding["reserved"]) == (4, 0)
    before = balance(c)["available_cents"]
    sell = place(c, pr(pair, "spot", "sell", PAIR_HIGH, 3))
    assert sell["hold_cents"] == fee(PAIR_HIGH * 3, sell["taker_fee_bps"])
    assert balance(c)["available_cents"] == before - sell["hold_cents"]
    assert next(s for s in positions(c)["spot"] if s["market_id"] == pair["id"])["reserved"] == 3
    r = c.http.post("/api/orders", json=pr(pair, "spot", "sell", PAIR_HIGH, 2))
    assert r.status_code == 422 and r.json()["errors"] == {"quantity": "insufficient_holdings"}
    expect_status(c.http.delete(f"/api/orders/{sell['id']}"), 200, "cancel")
    assert next(s for s in positions(c)["spot"] if s["market_id"] == pair["id"])["reserved"] == 0
    assert balance(c)["available_cents"] == before


def test_margin_positions(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a, b, c = (new_member(owner, mail, funds=FUNDS) for _ in range(3))
    pair = list_market(admin, "pair")
    place(a, pr(pair, "margin", "buy", ENTRY, 10))
    place(b, pr(pair, "margin", "sell", ENTRY, 10))
    long = margin_position(a, pair["id"])
    assert (long["side"], long["quantity"], long["cost_cents"], long["collateral_cents"], long["status"]) == (
        "long", 10, ENTRY * 10, ENTRY * 5, "open")
    assert margin_position(b, pair["id"])["side"] == "short"
    assert balance(a)["collateral_cents"] == ENTRY * 5

    place(c, pr(pair, "margin", "buy", PAIR_HIGH, 4))
    before = balance(a)["available_cents"]
    reduce = place(a, pr(pair, "margin", "sell", PAIR_HIGH, 4))
    basis = ENTRY * 10 * 4 // 10
    released = ENTRY * 5 * 4 // 10
    profit = 4 * PAIR_HIGH - basis
    assert balance(a)["available_cents"] == before + released + profit - fee(PAIR_HIGH * 4, reduce["taker_fee_bps"])
    long = margin_position(a, pair["id"])
    assert (long["quantity"], long["cost_cents"], long["collateral_cents"]) == (6, ENTRY * 6, ENTRY * 3)
    assert long["maintenance_cents"] == math.ceil(6 * PAIR_HIGH / 4)
    assert long["equity_cents"] == ENTRY * 3 + (6 * PAIR_HIGH - ENTRY * 6)

    r = a.http.post("/api/orders", json=pr(pair, "margin", "sell", PAIR_HIGH, 7))
    assert r.status_code == 422 and r.json() == {"error": "validation", "errors": {"quantity": "exceeds_position"}}
    parked = place(a, pr(pair, "margin", "sell", PAIR_PRICE_MAX, 4))
    r = a.http.post("/api/orders", json=pr(pair, "margin", "sell", PAIR_PRICE_MAX, 3))
    assert r.status_code == 422 and r.json()["errors"] == {"quantity": "exceeds_position"}
    expect_status(a.http.delete(f"/api/orders/{parked['id']}"), 200, "cancel")
    ledger_balanced(a.venue["id"], [a, b, c])


def test_wf_shared_book_live_updates(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a, b, d = (new_member(owner, mail, funds=FUNDS) for _ in range(3))
    pair = list_market(admin, "pair")
    place(a, pr(pair, "spot", "buy", PAIR_LOW, 5))
    place(b, pr(pair, "margin", "sell", PAIR_LOW, 5))
    place(a, pr(pair, "spot", "sell", PAIR_HIGH, 5))
    with signed_in(browser, a, f"/markets/{pair['id']}") as page:
        levels = page.get_by_role("listbox", name="Book levels")
        expect(levels.get_by_role("option", name=f"Ask {money(PAIR_HIGH)}, {5} resting", exact=True)).to_be_visible()
        expect(page.get_by_role("region", name="Open interest")).to_contain_text("5")
        page.evaluate("window.__noReload = true")
        quantity = ticket(page).get_by_role("spinbutton", name="Quantity", exact=True)
        quantity.fill("7")
        quantity.focus()
        before = balance(a)["available_cents"]
        place(d, pr(pair, "margin", "buy", PAIR_HIGH, 2))
        after = balance(a)["available_cents"]
        assert after > before, "the maker's proceeds reach available"
        budget = LIVE_MS + LIVE_SLACK_MS
        expect(levels.get_by_role("option", name=f"Ask {money(PAIR_HIGH)}, {3} resting", exact=True)).to_be_visible(
            timeout=budget)
        expect(page.get_by_role("region", name="Your balance")).to_contain_text(f"Available {money(after)}", timeout=budget)
        expect(page.get_by_role("region", name="Open interest")).to_contain_text("7", timeout=budget)
        assert page.evaluate("window.__noReload === true"), "the page did not reload"
        expect(quantity).to_have_value("7")
        expect(quantity).to_be_focused()
    assert market(a, pair["id"])["open_interest"] == 7


def test_wf_orderbook_orbit_pick_ring(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a, b, c = (new_member(owner, mail, funds=FUNDS) for _ in range(3))
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK, 6))
    place(b, ev(mk, "no", NO_AT_ASK_HIGH, 4))
    place(c, ev(mk, "yes", BID, 5))
    with signed_in(browser, a, f"/markets/{mk['id']}") as page:
        region = page.get_by_role("region", name="Orderbook Orbit")
        canvas = region.get_by_role("img", name="Orderbook Orbit")
        expect(canvas).to_be_visible()
        handle = canvas.element_handle()
        until(page, "c => c.dataset.settled === 'true' && JSON.parse(c.dataset.rings || '[]').length === 3", handle,
              seconds=UI_S)
        assert {r["level"] for r in rings(canvas)} == {f"ask:{ASK_HIGH}", f"ask:{ASK}", f"bid:{BID}"}
        assert decode(capture(canvas)).variance() > 0, "the orbit draws something"
        levels = page.get_by_role("listbox", name="Book levels")
        names = [f"Ask {ASK_HIGH}¢, 4 resting", f"Ask {ASK}¢, 6 resting", f"Bid {BID}¢, 5 resting"]
        for index, name in enumerate(names):
            expect(levels.get_by_role("option").nth(index)).to_have_accessible_name(name)
        tab_until(page, levels, inside=True)
        page.keyboard.press("Home")
        until(page, "([c, h]) => c.dataset.highlight === h", [handle, f"ask:{ASK_HIGH}"], seconds=UI_S)
        ring = next(r for r in rings(canvas) if r["level"] == f"bid:{BID}")
        box = canvas.bounding_box()
        page.mouse.click(box["x"] + ring["x"], box["y"] + ring["y"])
        t = ticket(page)
        expect(t.get_by_role("radio", name="No", exact=True)).to_be_checked()
        expect(t.get_by_role("spinbutton", name="Price", exact=True)).to_have_value(str(CONTRACT_CENTS - BID))
        expect(t.get_by_role("spinbutton", name="Quantity", exact=True)).to_have_value("5")
        expect(levels.get_by_role("option", name=names[2], exact=True)).to_have_attribute("aria-selected", "true")
        until(page, "([c, h]) => c.dataset.highlight === h", [handle, f"bid:{BID}"], seconds=UI_S)
        review_and_confirm(page)
        expect(updates(page)).to_contain_text("Filled in full")
    placed = a.http.get("/api/orders", params={"status": "all", "market_id": mk["id"]}).json()["orders"]
    assert [(o["outcome"], o["price"], o["status"]) for o in placed] == [("no", CONTRACT_CENTS - BID, "filled")]


def elevation_at(y: int) -> float:
    if y <= MID_Y:
        return ELEV_TOP - (ELEV_TOP - ELEV_MID) * y / MID_Y
    if y <= END_Y:
        return ELEV_MID - ELEV_MID * (y - MID_Y) / (END_Y - MID_Y)
    return 0.0


def test_orbit_camera(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK, 6))
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        login_context(page.context, a)
        page.goto(f"{app_url}/markets/{mk['id']}")
        canvas = orbit(page)
        canvas.wait_for()
        handle = canvas.element_handle()
        for y in (0, 120, 240, MID_Y, 840, END_Y, 1500, END_Y, 840, MID_Y, 240, 120, 0):
            page.evaluate("y => window.scrollTo(0, y)", y)
            until(page, "([c, e]) => Math.abs(parseFloat(c.dataset.elevation) - e) < 0.05", [handle, elevation_at(y)],
                  seconds=UI_S)
            assert round(float(canvas.get_attribute("data-elevation")), 1) == round(elevation_at(y), 1), y
        page.evaluate("y => window.scrollTo(0, y)", MID_Y)
        until(page, "([c, e]) => Math.abs(parseFloat(c.dataset.elevation) - e) < 0.05", [handle, elevation_at(MID_Y)])
        box = canvas.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 10 * YAW_PX, cy, steps=6)
        until(page, "c => Math.abs(parseFloat(c.dataset.yaw)) === 10", handle, seconds=UI_S)
        page.mouse.move(cx + 40 * YAW_PX, cy, steps=6)
        until(page, "([c, m]) => Math.abs(parseFloat(c.dataset.yaw)) === m", [handle, YAW_MAX], seconds=UI_S)
        sign = math.copysign(1, float(canvas.get_attribute("data-yaw")))
        page.mouse.up()
        samples = []
        for _ in range(10):
            advance(page, SPRING_MS / 10)
            samples.append(float(canvas.get_attribute("data-yaw")))
        assert samples[-1] == 0.0, f"yaw springs back to 0 within {SPRING_MS} ms: {samples}"
        assert all(s * sign >= 0 for s in samples), f"no bounce through zero: {samples}"
        assert all(abs(x) >= abs(y) for x, y in zip(samples, samples[1:])), f"yaw only shrinks: {samples}"
        page.goto(f"{app_url}/")
        home = orbit(page)
        until(page, "([c, e]) => parseFloat(c.dataset.elevation) === e", [home.element_handle(), ELEV_MID], seconds=UI_S)
        page.evaluate("y => window.scrollTo(0, y)", MID_Y)
        advance(page, SPRING_MS)
        assert float(home.get_attribute("data-elevation")) == ELEV_MID


def test_orbit_fill_settle(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a, b, c = (new_member(owner, mail, funds=FUNDS) for _ in range(3))
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK, 6))
    place(b, ev(mk, "no", NO_AT_ASK_HIGH, 4))
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        login_context(page.context, a)
        page.goto(f"{app_url}/markets/{mk['id']}")
        canvas = orbit(page)
        canvas.wait_for()
        handle = canvas.element_handle()
        until(page, "c => c.dataset.settled === 'true' && JSON.parse(c.dataset.rings || '[]').length === 2", handle,
              seconds=UI_S)
        last = page.get_by_role("region", name="Last trade")
        expect(last).to_have_text(re.compile("—"))
        expect(last).not_to_have_text(re.compile(r"\d¢"))
        place(c, ev(mk, "yes", ASK, PARTIAL_QTY))
        for _ in range(STEPS):
            advance(page, 10)
            if canvas.get_attribute("data-settled") == "false":
                break
        else:
            pytest.fail("data-settled never read false after the fill shrank the 37¢ ring (L231)")
        elapsed = 0.0
        while elapsed < SETTLE_MS and canvas.get_attribute("data-settled") != "true":
            advance(page, 50)
            elapsed += 50
        assert canvas.get_attribute("data-settled") == "true", f"rings settle in under {SETTLE_MS} ms"
        assert {r["level"] for r in rings(canvas)} == {f"ask:{ASK_HIGH}", f"ask:{ASK}"}, "both rings remain"
        settled_rings = rings(canvas)
        advance(page, SETTLE_MS)
        after = sorted(rings(canvas), key=lambda r: r["level"])
        before = sorted(settled_rings, key=lambda r: r["level"])
        assert canvas.get_attribute("data-settled") == "true" and [r["level"] for r in after] == [r["level"] for r in before] \
            and all(abs(a["x"] - b["x"]) <= HALF_PIXEL and abs(a["y"] - b["y"]) <= HALF_PIXEL for a, b in zip(after, before)), \
            "rings stay within half a pixel once settled (no bounce) (L231)"
        expect(page.get_by_role("listbox", name="Book levels").get_by_role(
            "option", name=f"Ask {ASK}¢, {6 - PARTIAL_QTY} resting", exact=True)).to_be_visible()
        advance(page, COUNT_MS + SETTLE_MS)
        expect(last).to_have_text(re.compile(rf"(?<!\d){ASK}¢"))


def test_wf_orderbook_orbit_depth_ladder(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a, b, c, d = (new_member(owner, mail, funds=FUNDS) for _ in range(4))
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK, 6))
    place(b, ev(mk, "no", NO_AT_ASK_HIGH, 4))
    place(c, ev(mk, "yes", BID, 5))
    for options in ({"reduced_motion": "reduce"}, {"no_webgl": True}):
        with open_app(browser, f"{app_url}/", **options) as page:
            page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
            login_context(page.context, a)
            page.goto(f"{app_url}/markets/{mk['id']}")
            region = page.get_by_role("region", name="Orderbook Orbit")
            ladder = region.get_by_role("region", name="Depth ladder")
            expect(ladder).to_be_visible()
            expect(page.get_by_role("img", name="Orderbook Orbit")).to_have_count(0)
            asks = ladder.get_by_role("list", name="Asks").get_by_role("listitem")
            expect(ladder.get_by_role("list", name="Bids").get_by_role("listitem")).to_have_count(1)
            expect(asks).to_have_count(2 if "reduced_motion" in options else 1)
            if "reduced_motion" in options:
                last = page.get_by_role("region", name="Last trade")

                def numeral() -> str:
                    found = re.findall(r"\d+¢|—", last.inner_text())
                    return found[-1] if found else ""

                place(d, ev(mk, "yes", ASK, 6))
                deadline = time.monotonic() + UI_S
                while not (asks.count() == 1 and numeral() == f"{ASK}¢"):
                    shown = numeral()
                    assert shown in ("—", f"{ASK}¢"), f"Last trade shows {shown!r} between values; L241 at once"
                    assert time.monotonic() < deadline, "the Depth ladder never applied the fill (L241)"
                    advance(page, 16)
                expect(asks).to_have_count(1)
                expect(last).to_contain_text(f"{ASK}¢")
            page.get_by_role("listbox", name="Book levels").get_by_role(
                "option", name=f"Bid {BID}¢, 5 resting", exact=True).click()
            t = ticket(page)
            expect(t.get_by_role("radio", name="No", exact=True)).to_be_checked()
            expect(t.get_by_role("spinbutton", name="Price", exact=True)).to_have_value(str(CONTRACT_CENTS - BID))
            expect(t.get_by_role("spinbutton", name="Quantity", exact=True)).to_have_value("5")
            if "no_webgl" in options:
                t.get_by_role("spinbutton", name="Quantity", exact=True).fill("2")
                review_and_confirm(page)
                expect(updates(page)).to_contain_text("Filled in full")
    placed = a.http.get("/api/orders", params={"status": "all", "market_id": mk["id"]}).json()["orders"]
    assert [(o["outcome"], o["status"], o["filled_quantity"]) for o in placed] == [("no", "filled", 2)]


def test_market_detail_layouts(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    empty = list_market(admin, "event")
    mk = list_market(admin, "event")
    place(b, ev(mk, "no", NO_AT_ASK, 6))
    place(b, ev(mk, "yes", BID, 5))
    with signed_in(browser, a, f"/markets/{empty['id']}") as page:
        expect(page.get_by_role("region", name="Orderbook Orbit").get_by_text(EMPTY_BOOK, exact=True)).to_be_visible()
    for size in (PHONE, TABLET, DESKTOP):
        with signed_in(browser, a, f"/markets/{mk['id']}", viewport=size) as page:
            boxes = {}
            for key, loc in (("title", page.get_by_role("heading", name=mk["title"], level=1)),
                             ("orbit", page.get_by_role("region", name="Orderbook Orbit")),
                             ("levels", page.get_by_role("listbox", name="Book levels")),
                             ("ticket", ticket(page)),
                             ("orders", page.get_by_role("region", name="Your orders"))):
                expect(loc).to_be_visible()
                boxes[key] = loc.bounding_box()
            layout(page)
            o, lv, t, yo = boxes["orbit"], boxes["levels"], boxes["ticket"], boxes["orders"]
            if size == PHONE:
                tops = [boxes[k]["y"] for k in ("title", "orbit", "levels", "ticket", "orders")]
                assert tops == sorted(tops), f"375: header, orbit, Book levels, ticket, Your orders: {tops}"
                assert t["y"] >= lv["y"] + lv["height"]
                btn(page, "Menu").click()
                expect(page.get_by_role("dialog", name="Menu").get_by_role("link", name="Markets", exact=True)).to_be_visible()
                page.keyboard.press("Escape")
            elif size == TABLET:
                assert o["x"] + o["width"] <= t["x"], "768: book left of ticket"
                assert lv["y"] >= o["y"] + o["height"] and yo["y"] >= t["y"] + t["height"]
                assert o["y"] < size[1] and t["y"] < size[1], "both tops within the first screen"
            else:
                assert lv["x"] + lv["width"] <= o["x"] and o["x"] + o["width"] <= t["x"], "1280: levels, orbit, ticket"
                assert max(lv["y"], o["y"], t["y"]) < size[1]
                assert yo["y"] >= max(b_["y"] + b_["height"] for b_ in (lv, o, t))
                assert yo["x"] <= lv["x"] and yo["x"] + yo["width"] >= t["x"] + t["width"]
            extra = page.evaluate("document.documentElement.scrollHeight - window.innerHeight")
            assert extra >= PAGE_EXTRA, f"page is {extra}px taller than the viewport"
            if size != PHONE:
                page.evaluate("y => window.scrollTo(0, y)", MID_Y)
                region = page.get_by_role("region", name="Orderbook Orbit")
                expect(region).to_be_in_viewport()


def test_market_lifecycle(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    pair = list_market(admin, "pair", open_=False)
    assert pair["status"] == "listed" and pair["kind"] == "pair" and pair["closes_at"] is None

    def step(mk: dict, action: str, status: int, **body: Any) -> Any:
        r = admin.http.post(f"/api/markets/{mk['id']}/{action}", json=body or None)
        return expect_status(r, status, f"{action} on {mk['symbol']}")

    assert step(pair, "halt", 409) == {"error": "invalid_transition", "from": "listed", "to": "halted"}
    assert step(pair, "open", 200)["status"] == "trading"
    assert step(pair, "open", 409) == {"error": "invalid_transition", "from": "trading", "to": "trading"}
    assert step(pair, "halt", 200)["status"] == "halted"
    r = a.http.post("/api/orders", json=pr(pair, "spot", "buy", ENTRY, 1))
    assert r.status_code == 409 and r.json() == {"error": "market_not_trading", "status": "halted"}
    assert step(pair, "halt", 409) == {"error": "invalid_transition", "from": "halted", "to": "halted"}
    assert step(pair, "resume", 200)["status"] == "trading"
    assert step(pair, "resume", 409) == {"error": "invalid_transition", "from": "trading", "to": "trading"}
    assert step(pair, "resolve", 409, outcome="yes")["error"] == "invalid_transition"

    event = list_market(admin, "event")
    assert step(event, "resolve", 409, outcome="yes") == {"error": "invalid_transition", "from": "trading", "to": "resolved"}
    assert step(event, "resolve", 409, outcome="maybe") == {
        "error": "invalid_transition", "from": "trading", "to": "resolved"}, "state conflicts 409 before validation 422 (L310)"
    taken = admin.http.post("/api/markets", json={"kind": "pair", "symbol": pair["symbol"], "title": "Again"})
    assert taken.status_code == 409 and taken.json() == {"error": "symbol_taken"}
    past = admin.http.post("/api/markets", json={"kind": "event", "symbol": symbol(), "title": "Past",
                                                 "closes_at": iso(server_now(app_url) - timedelta(hours=1))})
    assert past.status_code == 422 and past.json()["errors"]["closes_at"] == "invalid"
    with_close = admin.http.post("/api/markets", json={"kind": "pair", "symbol": symbol(), "title": "Pair",
                                                       "closes_at": iso(server_now(app_url) + timedelta(days=30))})
    assert with_close.status_code == 422 and "closes_at" in with_close.json()["errors"]


def test_wf_event_lifecycle_server_close(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event", closes_in=timedelta(seconds=CLOSE_IN_S))
    resting = place(a, ev(mk, "yes", BID_LOW, 5))
    context = browser.new_context(viewport={"width": DESKTOP[0], "height": DESKTOP[1]})
    try:
        login_context(context, a)
        page = context.new_page()
        page.clock.set_fixed_time(server_now(app_url) + timedelta(hours=6))
        page.goto(f"{app_url}/markets/{mk['id']}")
        status = page.get_by_role("status", name="Market status")
        expect(status).to_have_text("Trading open")
        closed = wait_for(lambda: market(a, mk["id"])["status"] == "closed", CLOSE_IN_S + POLL_SLACK_S * 5,
                          "GET /api/markets/{id} reports closed from closes_at (L490)")
        assert closed
        expect(status).to_have_text("Trading closed", timeout=(CLOSE_CANCEL_S + POLL_SLACK_S) * 1000)
    finally:
        context.close()
    r = a.http.post("/api/orders", json=ev(mk, "yes", BID_LOW, 1))
    assert r.status_code == 409 and r.json() == {"error": "market_not_trading", "status": "closed"}
    wait_for(lambda: order(a, resting["id"])["status"] == "cancelled", CLOSE_CANCEL_S + POLL_SLACK_S,
             "resting orders are cancelled within 2 s of the close (L490)")
    assert balance(a)["held_cents"] == 0
    reopen = admin.http.post(f"/api/markets/{mk['id']}/resume")
    assert reopen.status_code == 409 and reopen.json()["to"] == "trading"


def test_resolution_settlement(app_url: str, mail: Any, svix: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    builder = new_member(owner, mail, ("builder",), funds=FUNDS, prefix="Builder")
    expect_status(builder.http.put("/api/webhooks/endpoint", json={"url": f"http://127.0.0.1:9/{tag()}"}),
                  200, "PUT endpoint")
    mk = list_market(admin, "event", closes_in=timedelta(seconds=CLOSE_IN_S))
    place(a, ev(mk, "yes", ASK_HIGH, 10))
    place(builder, ev(mk, "no", NO_AT_ASK_HIGH, 10))
    wait_for(lambda: market(a, mk["id"])["status"] == "closed", CLOSE_IN_S + POLL_SLACK_S * 5, "event closes (L490)")
    winner_before, loser_before = balance(builder)["available_cents"], balance(a)["available_cents"]
    resolved = expect_status(admin.http.post(f"/api/markets/{mk['id']}/resolve", json={"outcome": "no"}), 200, "resolve")
    assert resolved["status"] == "resolved" and resolved["outcome"] == "no"
    wait_for(lambda: market(a, mk["id"])["status"] == "settled", SETTLEMENT_S + POLL_SLACK_S, "settled within 5 s (L491)")
    assert balance(builder)["available_cents"] == winner_before + CONTRACT_CENTS * 10
    assert balance(a)["available_cents"] == loser_before
    assert market(a, mk["id"])["open_interest"] == 0
    escrow = Postgres().rows("select coalesce(sum(amount_cents),0)::bigint as total from journal_legs "
                             f"where account = 'venue:escrow:{mk['id']}'")
    assert int(escrow[0]["total"]) == 0
    again = admin.http.post(f"/api/markets/{mk['id']}/resolve", json={"outcome": "no"})
    assert again.status_code == 409 and again.json() == {"error": "invalid_transition", "from": "settled", "to": "resolved"}
    assert balance(builder)["available_cents"] == winner_before + CONTRACT_CENTS * 10, "payout posts exactly once"

    def settled_messages() -> list[dict]:
        return [m for m in svix.messages("venue-harbor", "event.settled") if (m.get("payload") or {}).get("market_id") == mk["id"]]

    messages = wait_for(settled_messages, WEBHOOK_WAIT_S, "Svix holds an event.settled message for the builder (L603)")
    assert len(messages) == 1
    payload = messages[0]["payload"]
    assert payload["event_id"].startswith(f"settle_{mk['id']}_") and messages[0]["eventId"] == payload["event_id"]
    assert (payload["outcome"], payload["contracts"], payload["payout_cents"], payload["venue"]) == ("no", 10, CONTRACT_CENTS * 10, "harbor")
    assert f"member-{builder.id}" in (messages[0].get("channels") or [])
    raw = json.dumps(payload)
    for private in (builder.id, builder.email, builder.name, a.id, a.email, a.name):
        assert private not in raw, "settlement payload carries no member data (L600)"


def test_wf_event_lifecycle_resolve_payout(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    b = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event", closes_in=timedelta(seconds=CLOSE_IN_S * 2), open_=False)
    with signed_in(browser, admin, "/admin") as page:
        row = page.get_by_role("table", name="Markets").get_by_role("row").filter(has_text=mk["symbol"])
        btn(row, "Open trading").click()
        expect(btn(row, "Halt")).to_be_visible()
        expect(btn(row, "Open trading")).to_have_count(0)
    assert market(a, mk["id"])["status"] == "trading"
    place(a, ev(mk, "yes", BID_LOW, 10))
    place(b, ev(mk, "no", CONTRACT_CENTS - BID_LOW, 10))
    wait_for(lambda: market(a, mk["id"])["status"] == "closed", CLOSE_IN_S * 2 + POLL_SLACK_S * 5, "event closes (L490)")
    refused = a.http.post(f"/api/markets/{mk['id']}/resolve", json={"outcome": "yes"})
    assert refused.status_code == 403 and refused.json() == {"error": "forbidden"}
    assert market(a, mk["id"])["status"] == "closed"
    before = balance(a)["available_cents"]
    with signed_in(browser, admin, "/admin") as page:
        row = page.get_by_role("table", name="Markets").get_by_role("row").filter(has_text=mk["symbol"])
        btn(row, "Resolve").click()
        dialog = page.get_by_role("dialog", name=f"Resolve {mk['symbol']}")
        dialog.get_by_role("radio", name="Yes", exact=True).check()
        btn(dialog, "Confirm resolution").click()
    wait_for(lambda: market(a, mk["id"])["status"] == "settled", SETTLEMENT_S + POLL_SLACK_S * 2, "settled (L491)")
    after = balance(a)["available_cents"]
    assert after == before + CONTRACT_CENTS * 10
    with signed_in(browser, a, f"/markets/{mk['id']}") as page:
        expect(page.get_by_role("status", name="Market status")).to_have_text("Settled YES")
        expect(page.get_by_role("region", name="Your balance")).to_contain_text(f"Available {money(after)}")


def margin_setup(owner: Member, admin: Member, mail: Any) -> tuple[dict, list[Member], dict]:
    a, b, c, d = (new_member(owner, mail, funds=FUNDS) for _ in range(4))
    pair = list_market(admin, "pair")
    place(a, pr(pair, "margin", "buy", ENTRY, 10))
    place(b, pr(pair, "margin", "sell", ENTRY, 10))
    parked = place(a, pr(pair, "margin", "buy", FUNDS // 100, 1))
    place(c, pr(pair, "margin", "buy", HOLD_MARK, 1))
    place(d, pr(pair, "margin", "sell", HOLD_MARK, 1))
    return pair, [a, b, c, d], parked


def test_wf_margin_liquidation_after_fill(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    pair, (a, b, c, d), parked = margin_setup(owner, admin, mail)
    deadline = time.monotonic() + MAINTENANCE_S + POLL_SLACK_S
    while time.monotonic() < deadline:
        assert margin_position(a, pair["id"])["status"] == "open", "at $16.67 equity 4,170 ≥ 4,168 holds (L472)"
    with signed_in(browser, a, f"/markets/{pair['id']}") as page:
        expect(page.get_by_role("heading", name=pair["title"], level=1)).to_be_visible()
        before = balance(a)["available_cents"]
        place(c, pr(pair, "margin", "buy", LIQ_MARK, 1))
        place(d, pr(pair, "margin", "sell", LIQ_MARK, 1))
        wait_for(lambda: margin_position(a, pair["id"])["status"] == "liquidated", MAINTENANCE_S + POLL_SLACK_S,
                 "the maintenance check liquidates the long within 2 s of the fill (L470)")
        expect(updates(page)).to_contain_text(f"Your {pair['symbol']} margin position was liquidated at $16.66.")
    assert order(a, parked["id"])["status"] == "liquidated"
    after = balance(a)
    assert after["available_cents"] == before + LIQ_EQUITY + parked["hold_cents"]
    assert after["held_cents"] == 0 and after["collateral_cents"] == 0
    assert margin_position(b, pair["id"])["status"] == "open"
    ledger_balanced(a.venue["id"], [a, b, c, d])


def test_wf_margin_liquidation_on_demand(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    pair, members, parked = margin_setup(owner, admin, mail)
    a, _, c, d = members
    held_position = margin_position(a, pair["id"])
    assert (held_position["equity_cents"], held_position["maintenance_cents"]) == (HOLD_EQUITY, HOLD_MAINT)
    with signed_in(browser, admin, "/admin") as page:
        row = page.get_by_role("table", name="Markets").get_by_role("row").filter(has_text=pair["symbol"])
        btn(row, "Run liquidations").click()
        expect(btn(row, "Run liquidations")).to_be_enabled()
    result = expect_status(admin.http.post(f"/api/markets/{pair['id']}/liquidations"), 200, "run liquidations")
    assert result == {"checked": 4, "liquidated": []}
    assert all(margin_position(m, pair["id"])["status"] == "open" for m in members)
    refused = a.http.post(f"/api/markets/{pair['id']}/liquidations")
    assert refused.status_code == 403 and refused.json() == {"error": "forbidden"}

    before = balance(a)["available_cents"]
    place(c, pr(pair, "margin", "buy", LIQ_MARK, 1))
    place(d, pr(pair, "margin", "sell", LIQ_MARK, 1))
    run = expect_status(admin.http.post(f"/api/markets/{pair['id']}/liquidations"), 200, "run liquidations at $16.66")
    mine = [item for item in run["liquidated"] if item["position_id"] == held_position["id"]]
    assert len(mine) <= 1, f"the position is liquidated at most once: {run}"
    for item in mine:
        assert (item["quantity"], item["mark_price"], item["returned_cents"]) == (10, LIQ_MARK, LIQ_EQUITY)
    if not mine:
        assert margin_position(a, pair["id"])["status"] == "liquidated", \
            f"run-liquidations below maintenance liquidated nothing and the long is still open: {run}"
        assert run["checked"] == 3, \
            f"the worker already liquidated the long, so only the 3 other open positions were checked: {run}"
    wait_for(lambda: margin_position(a, pair["id"])["status"] == "liquidated", MAINTENANCE_S + POLL_SLACK_S,
             "the long below maintenance ends liquidated (L471)")
    again = expect_status(admin.http.post(f"/api/markets/{pair['id']}/liquidations"), 200, "run liquidations again")
    assert held_position["id"] not in {item["position_id"] for item in again["liquidated"]}
    assert order(a, parked["id"])["status"] == "liquidated"
    after = balance(a)
    assert after["available_cents"] == before + LIQ_EQUITY + parked["hold_cents"], "a single liquidation's money"
    assert after["held_cents"] == 0 and after["collateral_cents"] == 0
    event = list_market(admin, "event")
    not_pair = admin.http.post(f"/api/markets/{event['id']}/liquidations")
    assert not_pair.status_code == 409 and not_pair.json() == {"error": "not_a_pair"}


def desk_builder(owner: Member, mail: Any, funds: int = FUNDS) -> Member:
    builder = new_member(owner, mail, ("builder",), funds=funds, prefix="Builder")
    change_plan(builder, "desk")
    return builder


def mint_key_in_ui(page: Page) -> tuple[str, str]:
    name = f"bot {tag()}"
    opener = btn(page, "Create API key")
    opener.click()
    dialog = page.get_by_role("dialog", name="New API key")
    box = dialog.get_by_role("textbox", name="Key name")
    expect(box).to_be_focused()
    box.fill(name)
    btn(dialog, "Create key").click()
    expect(dialog.get_by_text("This key is shown once.")).to_be_visible()
    found = re.search(r"pv_[0-9a-f]{12}_[0-9a-f]{40}", dialog.inner_text())
    assert found, "the dialog shows the secret in the published format (L386)"
    return name, found.group(0)


def test_wf_builder_api_keys(browser: Browser, app_url: str, mail: Any, valkey: Any) -> None:
    owner, _ = harbor(app_url)
    builder = desk_builder(owner, mail)
    with signed_in(browser, builder, "/builder", permissions=["clipboard-read", "clipboard-write"]) as page:
        name, secret = mint_key_in_ui(page)
        dialog = page.get_by_role("dialog", name="New API key")
        btn(dialog, "Copy key").click()
        assert page.evaluate("navigator.clipboard.readText()") == secret
        page.keyboard.press("Escape")
        expect(btn(page, "Create API key")).to_be_focused()
        keys = expect_status(builder.http.get("/api/keys"), 200, "GET /api/keys")
        assert secret not in json.dumps(keys)
        key = next(k for k in keys["keys"] if k["name"] == name)
        assert key["revoked_at"] is None
        assert rate_hash(valkey, {"id": key["id"], "secret": secret}).get("rate") == str(DESK_RATE)
        client = key_client(app_url, secret)
        assert expect_status(client.get("/api/balance"), 200, "balance by key") == balance(builder)
        for path in ("/api/keys", "/api/deposits", "/api/billing"):
            r = client.get(path)
            assert r.status_code == 403 and r.json() == {"error": "forbidden"}, path
        expect(page.get_by_role("table", name="API keys")).to_contain_text(name)
        btn(page.get_by_role("table", name="API keys"), f"Revoke {name}").click()
        wait_for(lambda: next(k for k in builder.http.get("/api/keys").json()["keys"] if k["id"] == key["id"])["revoked_at"],
                 UI_S, "GET /api/keys shows revoked_at after Revoke")
    assert client.get("/api/balance").status_code == 401, "a revoked key stops working at once"
    assert rate_hash(valkey, {"id": key["id"], "secret": secret}) == {}


def test_idempotent_orders(app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), funds=FUNDS, prefix="Builder")
    mk = list_market(admin, "event")
    key = "ord-" + tag()
    body = ev(mk, "yes", BID_LOW, 5)
    first = builder.http.post("/api/orders", json=body, headers={"Idempotency-Key": key})
    original = expect_status(first, 201, "POST /api/orders")
    held_after_first = balance(builder)["held_cents"]
    replay = builder.http.post("/api/orders", json=body, headers={"Idempotency-Key": key})
    assert replay.status_code == 201 and replay.json() == original
    assert replay.headers.get("Idempotent-Replayed") == "true"
    assert balance(builder)["held_cents"] == held_after_first
    expect_status(builder.http.delete(f"/api/orders/{original['id']}"), 200, "cancel")
    late = builder.http.post("/api/orders", json=body, headers={"Idempotency-Key": key})
    assert late.status_code == 201 and late.json()["status"] == "resting", "the stored response is returned unchanged"
    conflict = builder.http.post("/api/orders", json=ev(mk, "yes", BID_LOW, 6), headers={"Idempotency-Key": key})
    assert conflict.status_code == 409 and conflict.json() == {"error": "idempotency_conflict"}
    bad = builder.http.post("/api/orders", json=body, headers={"Idempotency-Key": "bad key!"})
    assert bad.status_code == 422 and bad.json()["errors"] == {"Idempotency-Key": "invalid"}
    key2 = "ord-" + tag()
    raced = together([lambda: builder.http.post("/api/orders", json=ev(mk, "yes", BID, 2), headers={"Idempotency-Key": key2})
                      for _ in range(5)])
    assert all(r.status_code == 201 for r in raced) and len({r.json()["id"] for r in raced}) == 1
    orders = builder.http.get("/api/orders", params={"status": "all", "market_id": mk["id"]}).json()["orders"]
    assert len(orders) == 2


def test_plan_rate_limits(app_url: str, mail: Any, valkey: Any) -> None:
    owner, _ = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    billing = expect_status(builder.http.get("/api/billing"), 200, "GET /api/billing")
    assert (billing["plan"], billing["effective_plan"], billing["rate_per_second"]) == ("sandbox", "sandbox", SANDBOX_RATE)
    key = create_key(builder)
    assert rate_hash(valkey, key).get("rate") == str(SANDBOX_RATE)
    assert valkey.ttl(f"ratelimit:{key['id']}") in (-1, -2)
    url = f"{app_url}/api/balance"
    headers = {"Authorization": f"Bearer {key['secret']}"}
    burst = together([lambda: httpx.get(url, headers=headers, timeout=HTTP_TIMEOUT) for _ in range(8)])
    limited = [r for r in burst if r.status_code == 429]
    assert limited and any(r.status_code == 200 for r in burst)
    for r in limited:
        body = r.json()
        assert body["error"] == "rate_limited" and isinstance(body["retry_after_ms"], int)
        assert int(r.headers["Retry-After"]) == math.ceil(body["retry_after_ms"] / 1000)
    assert all(r.status_code == 200 for r in together([lambda: builder.http.get("/api/balance") for _ in range(10)]))
    change_plan(builder, "desk")
    assert rate_hash(valkey, key).get("rate") == str(DESK_RATE)
    desk_key = create_key(builder)
    assert rate_hash(valkey, desk_key).get("rate") == str(DESK_RATE)
    desk_headers = {"Authorization": f"Bearer {desk_key['secret']}"}
    desk_burst = together([lambda: httpx.get(url, headers=desk_headers, timeout=HTTP_TIMEOUT) for _ in range(BUILDER_RATE)])
    assert all(r.status_code == 200 for r in desk_burst), [r.status_code for r in desk_burst]


def test_no_extra_fields(app_url: str, mail: Any, killbill: Any) -> None:
    owner, admin = harbor(app_url)
    a = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    dep = a.http.get("/api/deposits").json()["deposits"][0]
    account = killbill_account(killbill, "harbor", a)
    payments = len(killbill.payments(account["accountId"]))
    fees_before = {k: market(a, mk["id"])[k] for k in ("taker_fee_bps", "maker_fee_bps")}
    _, invitee = fresh_identity("Extra")
    before = balance(a)
    cases = [
        (a, "PATCH", "/api/me", {"display_name": "Hijack", "roles": ["org_owner"]}, "roles"),
        (a, "POST", "/api/orders", ev(mk, "yes", BID_LOW, 5) | {"taker_fee_bps": 0}, "taker_fee_bps"),
        (a, "POST", "/api/orders", ev(mk, "yes", BID_LOW, 5) | {"status": "filled"}, "status"),
        (a, "POST", "/api/deposits", {"amount_cents": DEPOSIT_50, "card_number": CARD, "venue_id": a.venue["id"]}, "venue_id"),
        (admin, "POST", f"/api/deposits/{dep['id']}/refunds", {"amount_cents": DEPOSIT_MIN, "member_id": a.id}, "member_id"),
        (owner, "PUT", "/api/venue/fees", {"taker_fee_bps": 0, "maker_fee_bps": 0, "venue_id": a.venue["id"]}, "venue_id"),
        (owner, "POST", "/api/venue/invites", {"email": invitee, "display_name": "Extra", "roles": ["trader"],
                                               "venue_id": a.venue["id"]}, "venue_id"),
    ]
    for caller, method, path, body, field in cases:
        r = caller.http.request(method, path, json=body)
        assert r.status_code == 422 and r.json()["error"] == "validation" and r.json()["errors"].get(field) == "unknown_field", \
            f"{method} {path}: {r.status_code} {r.text[:300]}"
    assert a.http.get("/api/me").json()["display_name"] == a.name and a.http.get("/api/me").json()["roles"] == ["trader"]
    assert a.http.get("/api/orders", params={"status": "all"}).json()["orders"] == []
    assert balance(a) == before
    assert len(killbill.payments(account["accountId"])) == payments
    assert a.http.get(f"/api/deposits/{dep['id']}").json()["refunded_cents"] == 0
    assert {k: market(a, mk["id"])[k] for k in fees_before} == fees_before
    assert keycloak_users(invitee) == []


def test_wf_builder_api_journey(browser: Browser, app_url: str, mail: Any) -> None:
    owner, admin = harbor(app_url)
    builder = desk_builder(owner, mail)
    other = desk_builder(owner, mail)
    seller = new_member(owner, mail, funds=FUNDS)
    mk = list_market(admin, "event")
    place(seller, ev(mk, "no", NO_AT_ASK, 3))
    with signed_in(browser, builder, "/builder") as page:
        _, secret = mint_key_in_ui(page)
        page.keyboard.press("Escape")
        client = key_client(app_url, secret)
        page.goto(f"{app_url}/markets/{mk['id']}")
        resting = place(builder, ev(mk, "yes", BID_LOW, 4), client=client)
        cancel = page.get_by_role("region", name="Your orders").get_by_role(
            "button", name=f"Cancel order {resting['id'][:8]}", exact=True)
        expect(cancel).to_be_visible(timeout=LIVE_MS + LIVE_SLACK_MS)
        assert expect_status(client.delete(f"/api/orders/{resting['id']}"), 200, "cancel by key")["status"] == "cancelled"
        expect(cancel).to_have_count(0, timeout=LIVE_MS + LIVE_SLACK_MS)
        filled = place(builder, ev(mk, "yes", ASK, 3), client=client)
        assert filled["status"] == "filled"
        expect(updates(page)).to_contain_text(f"Filled 3 at {ASK}¢")
    by_key = client.get("/api/orders", params={"status": "all", "market_id": mk["id"]}).json()["orders"]
    by_session = builder.http.get("/api/orders", params={"status": "all", "market_id": mk["id"]}).json()["orders"]
    assert [o["id"] for o in by_key] == [o["id"] for o in by_session] == [filled["id"], resting["id"]]
    assert client.get("/api/fills", params={"market_id": mk["id"]}).json() == {"fills": fills(builder, mk["id"])}
    other_key = key_client(app_url, create_key(other)["secret"])
    for method in ("GET", "DELETE"):
        r = other_key.request(method, f"/api/orders/{filled['id']}")
        assert r.status_code == 404 and r.json() == {"error": "not_found"}


def test_builder_plans_in_killbill(app_url: str, mail: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    trader = new_member(owner, mail)
    refused = trader.http.get("/api/billing")
    assert refused.status_code == 403 and refused.json() == {"error": "forbidden"}
    start = builder.http.get("/api/billing").json()
    assert start["invoices"] == [] and start["state"] == "active" and start["provider"] == "ok"
    account = killbill_account(killbill, "harbor", builder)
    assert account is None or killbill.subscriptions(account["accountId"]) == []

    up = change_plan(builder, "builder")
    assert (up["plan"], up["effective_plan"], up["rate_per_second"]) == ("builder", "builder", BUILDER_RATE)
    account = killbill_account(killbill, "harbor", builder)
    assert plan_subscription(killbill, account["accountId"], builder)["planName"] == "builder-monthly"
    desk = change_plan(builder, "desk")
    assert desk["plan"] == "desk" and desk["rate_per_second"] == DESK_RATE
    sub = plan_subscription(killbill, account["accountId"], builder)
    assert sub["planName"] == "desk-monthly", "upgrades take effect at once"

    billing = builder.http.get("/api/billing").json()
    kb = {i["invoiceId"]: i for i in killbill.invoices(account["accountId"])}
    assert {i["id"] for i in billing["invoices"]} == set(kb)
    for inv in billing["invoices"]:
        assert inv["amount_cents"] == round(float(kb[inv["id"]]["amount"]) * 100)
        assert inv["balance_cents"] == round(float(kb[inv["id"]]["balance"]) * 100)
        assert len(inv["items"]) == len(kb[inv["id"]]["items"])
    assert len(kb) >= 2, "the Desk upgrade is invoiced with Kill Bill's proration"

    down = change_plan(builder, "builder")
    sub = plan_subscription(killbill, account["accountId"], builder)
    assert (down["plan"], down["pending_plan"]) == ("desk", "builder")
    assert down["pending_effective_date"] == str(sub["chargedThroughDate"])[:10]
    assert sub["planName"] == "desk-monthly"
    repeat = builder.http.post("/api/billing/plan", json={"plan": "desk"})
    assert repeat.status_code == 409 and repeat.json() == {"error": "already_on_plan"}


def auto_pay_off(killbill: Any, account_id: str, on: bool) -> None:
    headers = {"X-Killbill-CreatedBy": "verifier"}
    if on:
        r = killbill.client.post(f"/accounts/{account_id}/tags", json=[AUTO_PAY_OFF_TAG], headers=headers)
        assert r.status_code == 201, r.text
    else:
        r = killbill.client.delete(f"/accounts/{account_id}/tags", params={"tagDef": AUTO_PAY_OFF_TAG}, headers=headers)
        assert r.status_code == 204, r.text


def unpaid_invoice(killbill: Any, account_id: str) -> None:
    item = {"accountId": account_id, "amount": BUILDER_PRICE, "currency": "USD", "description": "Unpaid renewal"}
    r = killbill.client.post(f"/invoices/charges/{account_id}", params={"autoCommit": "true"}, json=[item],
                             headers={"X-Killbill-CreatedBy": "verifier"})
    assert r.status_code in (200, 201), r.text


def billing_state(builder: Member, state: str) -> dict:
    def probe() -> dict | None:
        billing = expect_status(builder.http.get("/api/billing"), 200, "GET /api/billing")
        return billing if billing["state"] == state else None

    return wait_for(probe, DUNNING_WAIT_S, f"GET /api/billing follows Kill Bill's overdue state to {state} (L500)")


def test_dunning_rates_follow_plan(app_url: str, mail: Any, valkey: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    keys = [create_key(builder), create_key(builder)]
    assert [rate_hash(valkey, k).get("rate") for k in keys] == [str(SANDBOX_RATE)] * 2
    up = change_plan(builder, "builder")
    assert up["state"] == "active" and up["effective_plan"] == "builder"
    assert [rate_hash(valkey, k).get("rate") for k in keys] == [str(BUILDER_RATE)] * 2
    account_id = killbill_account(killbill, "harbor", builder)["accountId"]
    deadline = time.monotonic() + DUNNING_WAIT_S
    while not (invoices := killbill.invoices(account_id)) or any(float(i["balance"]) > 0 for i in invoices):
        assert time.monotonic() < deadline, "Kill Bill never paid the upgrade invoice"
    pay = builder.http.post("/api/billing/pay")
    assert pay.status_code == 409 and pay.json() == {"error": "nothing_due"}
    auto_pay_off(killbill, account_id, True)
    try:
        unpaid_invoice(killbill, account_id)
        failed = billing_state(builder, "payment_failed")
        assert failed["overdue_state"] == "WARNING" and failed["effective_plan"] == "builder"
        assert [rate_hash(valkey, k).get("rate") for k in keys] == [str(BUILDER_RATE)] * 2
        mail_for(mail, builder.email, subject="Payment failed — your Builder plan")
        locked = builder.http.post("/api/billing/plan", json={"plan": "desk"})
        assert locked.status_code == 409 and locked.json() == {"error": "plan_locked"}

        unpaid_invoice(killbill, account_id)
        down = billing_state(builder, "downgraded")
        assert [rate_hash(valkey, k).get("rate") for k in keys] == [str(SANDBOX_RATE)] * 2, \
            "every key is at the Sandbox rate when downgraded is reported (L501)"
        assert (down["overdue_state"], down["plan"], down["effective_plan"], down["rate_per_second"]) == (
            "DOWNGRADED", "builder", "sandbox", SANDBOX_RATE)
        keys.append(create_key(builder))
        assert rate_hash(valkey, keys[-1]).get("rate") == str(SANDBOX_RATE)
        mail_for(mail, builder.email, subject="Your plan is now Sandbox")
        assert len(mail_for(mail, builder.email, subject="Payment failed — your Builder plan")) == 1, \
            "one email per step: Payment failed"
        row = next(b for b in owner.http.get("/api/venue/billing").json()["builders"] if b["member_id"] == builder.id)
        assert (row["effective_plan"], row["state"]) == ("sandbox", "downgraded")

        expect_status(builder.http.post("/api/billing/pay"), 200, "POST /api/billing/pay")
        cleared = billing_state(builder, "active")
        assert cleared["effective_plan"] == "builder" and cleared["rate_per_second"] == BUILDER_RATE
        assert [rate_hash(valkey, k).get("rate") for k in keys] == [str(BUILDER_RATE)] * 3
    finally:
        auto_pay_off(killbill, account_id, False)
    assert all(round(float(i["balance"]) * 100) == 0 for i in killbill.invoices(account_id)), "every invoice paid"
    mail_for(mail, builder.email, subject="Your Builder plan is active again")
    for subject in ("Your plan is now Sandbox", "Your Builder plan is active again"):
        assert len(mail_for(mail, builder.email, subject=subject)) == 1, f"one email per step: {subject}"


def test_wf_builder_billing_change_plan(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    context = browser.new_context(viewport={"width": DESKTOP[0], "height": DESKTOP[1]})
    try:
        login_context(context, builder)
        page = context.new_page()
        page.clock.set_fixed_time(server_now(app_url) + timedelta(days=400))
        page.goto(f"{app_url}/builder")
        plan = page.get_by_role("region", name="Plan")
        expect(plan).to_contain_text("Active")
        expect(btn(page, "Pay outstanding balance")).to_have_count(0)
        status = page.get_by_role("status", name="Billing status")
        choice = page.get_by_role("radiogroup", name="Builder plan")
        choice.get_by_role("radio", name="Builder", exact=True).check()
        with held(page, "**/api/billing/plan") as gate:
            btn(page, "Change plan").click()
            expect(status).to_have_text("Updating plan…")
            gate.release()
        expect(status).to_have_text("Plan updated to Builder.")
        choice.get_by_role("radio", name="Desk", exact=True).check()
        btn(page, "Change plan").click()
        expect(status).to_have_text("Plan updated to Desk.")
        account = killbill_account(killbill, "harbor", builder)
        charged = date.fromisoformat(str(plan_subscription(killbill, account["accountId"], builder)["chargedThroughDate"])[:10])
        choice.get_by_role("radio", name="Builder", exact=True).check()
        btn(page, "Change plan").click()
        expect(status).to_have_text(f"Changes to Builder on {charged.day} {calendar.month_name[charged.month]} {charged.year}")
        invoices = killbill.invoices(account["accountId"])
        assert invoices, "Kill Bill invoiced the upgrade"
        rows = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has=page.get_by_role("cell"))
        expect(rows.nth(len(invoices) - 1)).to_be_visible()
    finally:
        context.close()
    sub = plan_subscription(killbill, account["accountId"], builder)
    assert sub["planName"] == "desk-monthly" and builder.http.get("/api/billing").json()["pending_plan"] == "builder"


def test_wf_builder_billing_outage(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    down = builder.on(outage("APP_KILLBILL_DOWN_URL"))
    billing = expect_status(down.http.get("/api/billing"), 200, "billing while down")
    assert billing["provider"] == "unavailable" and billing["plan"] == "sandbox"
    for path, body in (("/api/billing/plan", {"plan": "desk"}), ("/api/billing/pay", None)):
        r = down.http.post(path, json=body) if body else down.http.post(path)
        assert r.status_code == 503 and r.json() == {"error": "billing_unavailable"}, path
    with signed_in(browser, down, "/builder") as page:
        page.get_by_role("radiogroup", name="Builder plan").get_by_role("radio", name="Desk", exact=True).check()
        btn(page, "Change plan").click()
        expect(page.get_by_role("alert").filter(
            has_text="Billing is unavailable right now — your keys keep their current rate.")).to_be_visible()
    account = killbill_account(killbill, "harbor", builder)
    assert account is None or killbill.subscriptions(account["accountId"]) == []
    assert builder.http.get("/api/billing").json()["plan"] == "sandbox"


def test_wf_builder_billing_dunning(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    owner, _ = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    change_plan(builder, "builder")
    account_id = killbill_account(killbill, "harbor", builder)["accountId"]
    auto_pay_off(killbill, account_id, True)
    try:
        unpaid_invoice(killbill, account_id)
        billing_state(builder, "payment_failed")
        with signed_in(browser, builder, "/builder") as page:
            expect(page.get_by_role("region", name="Plan")).to_contain_text("Payment failed")
            expect(page.get_by_role("alert").filter(
                has_text="Your last plan payment failed — pay now to keep your rate.")).to_be_visible()
            expect(btn(page, "Pay outstanding balance")).to_be_visible()
        unpaid_invoice(killbill, account_id)
        billing_state(builder, "downgraded")
        with signed_in(browser, builder, "/builder") as page:
            plan = page.get_by_role("region", name="Plan")
            expect(plan).to_contain_text("Downgraded")
            expect(page.get_by_role("alert").filter(
                has_text="Your plan is downgraded to Sandbox until the outstanding invoice is paid.")).to_be_visible()
            status = page.get_by_role("status", name="Billing status")
            with held(page, "**/api/billing/pay") as gate:
                btn(page, "Pay outstanding balance").click()
                expect(status).to_have_text("Sending payment…")
                gate.release()
            expect(status).to_have_text("Payment received.")
            billing_state(builder, "active")
            page.reload()
            expect(plan).to_contain_text("Active")
            expect(btn(page, "Pay outstanding balance")).to_have_count(0)
    finally:
        auto_pay_off(killbill, account_id, False)
    assert all(round(float(i["balance"]) * 100) == 0 for i in killbill.invoices(account_id)), "paid through Kill Bill"
    assert builder.http.get("/api/billing").json()["effective_plan"] == "builder"


def test_wf_builder_webhooks_save_endpoint(browser: Browser, app_url: str, mail: Any, svix: Any) -> None:
    owner, _ = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    other = new_member(owner, mail, ("builder",), prefix="Builder")
    url = f"http://127.0.0.1:9/hooks/{tag()}"
    with signed_in(browser, builder, "/builder") as page:
        box = page.get_by_role("textbox", name="Endpoint URL")
        box.fill("ftp://example.org/hook")
        btn(page, "Save endpoint").click()
        expect(page.get_by_role("status", name="Webhook status")).to_have_text("Enter an http or https URL.")
        box.fill(url)
        btn(page, "Save endpoint").click()
        expect(page.get_by_role("status", name="Webhook status")).to_have_text("Endpoint saved.")
    hooks = expect_status(builder.http.get("/api/webhooks"), 200, "GET /api/webhooks")
    assert hooks["endpoint"]["url"] == url and hooks["delivery"] == "ok"
    endpoint = next(e for e in svix.endpoints("venue-harbor") if e.get("uid") == f"member-{builder.id}")
    assert endpoint["url"] == url and f"member-{builder.id}" in (endpoint.get("channels") or [])
    assert endpoint["id"] == hooks["endpoint"]["svix_endpoint_id"]
    assert other.http.get("/api/webhooks").json()["endpoint"] is None
    bad = builder.http.put("/api/webhooks/endpoint", json={"url": "ftp://example.org/hook"})
    assert bad.status_code == 422 and bad.json()["errors"] == {"url": "invalid"}
    assert builder.http.delete("/api/webhooks/endpoint").status_code == 204
    assert not [e for e in svix.endpoints("venue-harbor") if e.get("uid") == f"member-{builder.id}"]


def test_wf_builder_webhooks_signed_delivery(browser: Browser, app_url: str, mail: Any, svix: Any) -> None:
    owner, admin = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), funds=FUNDS, prefix="Builder")
    seller = new_member(owner, mail, funds=FUNDS)
    sink = Sink()
    try:
        with signed_in(browser, builder, "/builder") as page:
            page.get_by_role("textbox", name="Endpoint URL").fill(sink.url)
            btn(page, "Save endpoint").click()
            expect(page.get_by_role("status", name="Webhook status")).to_have_text("Endpoint saved.")
        secret = builder.http.get("/api/webhooks").json()["endpoint"]["signing_secret"]
        mk = list_market(admin, "event")
        resting = place(builder, ev(mk, "yes", ASK, 5))
        place(seller, ev(mk, "no", NO_AT_ASK, 2))
        place(seller, ev(mk, "no", NO_AT_ASK, 3))
        own_fills = fills(builder, mk["id"])
        assert len(own_fills) == 2

        def delivered() -> bool:
            with sink.lock:
                ok = {json.loads(r["body"])["fill_id"] for r in sink.records if r["status"] == 200}
            return {f["id"] for f in own_fills} <= ok

        wait_for(delivered, WEBHOOK_WAIT_S, "each order.filled reaches the endpoint after Svix retries (L599)")
        with sink.lock:
            records = list(sink.records)
        for f in own_fills:
            mine = [r for r in records if json.loads(r["body"])["fill_id"] == f["id"]]
            ids = {webhook_header(r["headers"], "id") for r in mine}
            assert len(ids) == 1 and "" not in ids, "retries keep one message id"
            assert [r["status"] for r in mine][-1] == 200 and [r["status"] for r in mine].count(200) == 1
            assert mine[0]["status"] == 500
            for r in mine:
                assert svix_signature_ok(secret, r["headers"], r["body"])
            payload = json.loads(mine[-1]["body"])
            assert set(payload) == ORDER_FILLED_FIELDS
            assert (payload["event_id"], payload["type"], payload["venue"], payload["order_id"]) == (
                f"fill_{f['id']}", "order.filled", "harbor", resting["id"])
            assert (payload["price"], payload["quantity"], payload["fee_cents"]) == (f["price"], f["quantity"], f["fee_cents"])
            raw = mine[-1]["body"].decode()
            for private in (builder.id, builder.email, builder.name, seller.id, seller.email, seller.name):
                assert private not in raw
            messages = [m for m in svix.messages("venue-harbor", "order.filled") if m.get("eventId") == f"fill_{f['id']}"]
            assert len(messages) == 1 and f"member-{builder.id}" in (messages[0].get("channels") or [])
        attempts = builder.http.get("/api/webhooks").json()["attempts"]
        assert {f"fill_{f['id']}" for f in own_fills} <= {a["event_id"] for a in attempts if a["status"] == "succeeded"}
        assert seller.http.get("/api/webhooks").status_code == 403
    finally:
        sink.close()


def test_wf_builder_webhooks_delayed(browser: Browser, app_url: str, mail: Any, svix: Any) -> None:
    owner, admin = harbor(app_url)
    builder = new_member(owner, mail, ("builder",), funds=FUNDS, prefix="Builder")
    seller = new_member(owner, mail, funds=FUNDS)
    url = f"http://127.0.0.1:9/hooks/{tag()}"
    expect_status(builder.http.put("/api/webhooks/endpoint", json={"url": url}), 200, "PUT endpoint")
    mk = list_market(admin, "event")
    down_url = outage("APP_SVIX_DOWN_URL")
    b_down, s_down = builder.on(down_url), seller.on(down_url)
    place(b_down, ev(mk, "yes", ASK, 3))
    assert place(s_down, ev(mk, "no", NO_AT_ASK, 3))["status"] == "filled", "fills still succeed"
    fill_id = fills(b_down, mk["id"])[0]["id"]
    hooks = expect_status(b_down.http.get("/api/webhooks"), 200, "GET /api/webhooks while Svix is down")
    assert hooks["delivery"] == "delayed" and hooks["endpoint"]["url"] == url and hooks["attempts"] == []
    r = b_down.http.put("/api/webhooks/endpoint", json={"url": url})
    assert r.status_code == 503 and r.json() == {"error": "webhooks_unavailable"}
    with signed_in(browser, b_down, "/builder") as page:
        expect(page.get_by_role("alert").filter(
            has_text="Webhook delivery is delayed — your fills are safe and will be sent.")).to_be_visible()
    found = wait_for(lambda: [m for m in svix.messages("venue-harbor", "order.filled") if m.get("eventId") == f"fill_{fill_id}"],
                     WEBHOOK_WAIT_S, "the queued order.filled reaches Svix after the outage (L604)")
    assert len(found) == 1


def statement_venue(app_url: str, mail: Any) -> tuple[dict, Member, Member, Member, str]:
    venue, owner = fresh_venue(app_url, mail)
    a = new_member(owner, mail, funds=DEPOSIT_50)
    b = new_member(owner, mail)
    return venue, owner, a, b, venue_month(app_url, back=1)


def test_statements_generated_and_private(app_url: str, mail: Any) -> None:
    venue, owner, a, b, month = statement_venue(app_url, mail)
    run = generate_statements(owner, month, 202)
    assert run["month"] == month and run["members"] >= 3
    stmt = statement_for(a, month)
    key = f"venues/{venue['id']}/statements/{a.id}/{month}.pdf"
    stored = S3().get(key)
    content = pdf_text(stored)
    assert venue["name"] in content and a.name in content
    assert b.name not in content and b.email not in content and owner.email not in content
    r = a.http.get(f"/api/statements/{stmt['id']}/link")
    link = expect_status(r, 200, "statement link")
    assert not same_origin(link["url"], app_url)
    assert httpx.get(link["url"], timeout=HTTP_TIMEOUT).content == stored
    issued = parse_ts(link["expires_at"]) - datetime.now(timezone.utc)
    assert issued <= timedelta(seconds=LINK_TTL_S + POLL_SLACK_S), "links expire after 60 seconds"
    for other in (b, owner):
        denied = other.http.get(f"/api/statements/{stmt['id']}/link")
        assert denied.status_code == 404 and denied.json() == {"error": "not_found"}
    assert stmt["id"] not in {s["id"] for s in b.http.get("/api/statements").json()["statements"]}
    members = {owner.id, a.id, b.id}
    for k in S3().keys(f"venues/{venue['id']}/statements/"):
        assert k.split("/")[3] in members, f"only this venue's members have statements: {k}"
    assert generate_statements(owner, month, 200) == run
    assert S3().get(key) == stored, "the month is never rendered again"
    current = owner.http.post("/api/venue/statements", json={"month": venue_month(app_url)})
    assert current.status_code == 422 and current.json()["errors"] == {"month": "not_closed"}


def test_wf_statements_download_and_email(browser: Browser, app_url: str, mail: Any) -> None:
    venue, owner, a, b, month = statement_venue(app_url, mail)
    generate_statements(owner, month, 202)
    statement_for(a, month)
    label = month_label(month)
    message = mail_for(mail, a.email, subject=f"Your {label} statement is ready")[0]
    body = text(message)
    assert "/statements" in body and not message.get("Attachments")
    assert b.name not in body and money(DEPOSIT_50) not in body
    generate_statements(owner, month, 200)
    assert len(mail_for(mail, a.email, subject=f"Your {label} statement is ready")) == 1, "one email per statement"
    stored = S3().get(f"venues/{venue['id']}/statements/{a.id}/{month}.pdf")
    with signed_in(browser, a, "/statements") as page:
        pdfs: list[str] = []
        page.context.on("response", lambda r: pdfs.append(r.url) if "application/pdf" in (r.headers.get("content-type") or "") else None)
        link = page.get_by_role("list", name="Statements").get_by_role("link", name=f"Download {label} statement", exact=True)
        try:
            with page.expect_download(timeout=UI_MS):
                link.click()
        except Exception:
            pass
        wait_for(lambda: pdfs or (page.wait_for_load_state() or pdfs), UI_S, "the Statements link opens the PDF")
    assert httpx.get(pdfs[0], timeout=HTTP_TIMEOUT).content == stored


def test_wf_statements_outage(browser: Browser, app_url: str, mail: Any) -> None:
    venue, owner, a, _, month = statement_venue(app_url, mail)
    generate_statements(owner, month, 202)
    stmt = statement_for(a, month)
    down = outage("APP_MINIO_DOWN_URL")
    a_down, owner_down = a.on(down), owner.on(down)
    r = a_down.http.get(f"/api/statements/{stmt['id']}/link")
    assert r.status_code == 503 and r.json() == {"error": "statements_unavailable"}
    r = owner_down.http.post("/api/venue/statements", json={"month": venue_month(app_url, back=2)})
    assert r.status_code == 503 and r.json() == {"error": "statements_unavailable"}
    r = a_down.http.post("/api/me/documents", files={"document": ("id.png", png_bytes(), "image/png")})
    assert r.status_code == 503 and r.json() == {"error": "documents_unavailable"}
    assert stmt["id"] in {s["id"] for s in a_down.http.get("/api/statements").json()["statements"]}
    with signed_in(browser, a_down, "/statements") as page:
        page.get_by_role("link", name=f"Download {month_label(month)} statement", exact=True).click()
        expect(page.get_by_role("alert").filter(
            has_text="Statements are unavailable right now — try again in a few minutes.")).to_be_visible()
    assert not [k for k in S3().keys(f"venues/{venue['id']}/statements/") if venue_month(app_url, back=2) in k]


def trading_venue(app_url: str, mail: Any) -> tuple[dict, Member, Member, Member, Member, dict]:
    venue, owner = fresh_venue(app_url, mail)
    admin = new_member(owner, mail, ("market_admin",), prefix="Admin")
    a = new_member(owner, mail, funds=FUNDS)
    c = new_member(owner, mail, funds=FUNDS)
    return venue, owner, admin, a, c, list_market(admin, "event")


def test_venue_totals_and_picker(app_url: str, mail: Any) -> None:
    venue, owner, admin, a, c, mk = trading_venue(app_url, mail)
    pending_name, pending_email, _ = invite(owner, mail, ["trader"], "Pending")
    place(a, ev(mk, "yes", ASK, 10))
    place(c, ev(mk, "no", NO_AT_ASK, 4))
    fee_total = sum(f["fee_cents"] for m in (a, c) for f in fills(m, mk["id"]))
    totals = expect_status(owner.http.get("/api/venue/totals"), 200, "GET /api/venue/totals")
    assert totals == {"members": 5, "open_orders": 1, "deposits_cents": 2 * FUNDS, "refunds_cents": 0,
                      "fees_cents": fee_total, "volume_cents_today": ASK * 4, "open_interest_contracts": 4}
    token = a.name.split()[-1]
    found = expect_status(owner.http.get("/api/venue/members", params={"q": token}), 200, "member picker")["members"]
    assert [(m["id"], m["email"], m["roles"]) for m in found] == [(a.id, a.email, ["trader"])]
    pending = owner.http.get("/api/venue/members", params={"q": pending_email}).json()["members"]
    assert [m["display_name"] for m in pending] == [pending_name]
    assert expect_status(admin.http.get("/api/venue/members", params={"q": token}), 200, "admin picker")["members"]
    assert owner.http.get("/api/venue/members", params={"q": "harbor.example"}).json()["members"] == []
    harbor_owner = sign_in(app_url, "hl-owner")
    assert harbor_owner.http.get("/api/venue/members", params={"q": token}).json()["members"] == []
    for caller, method, path, body in ((a, "GET", "/api/venue/totals", None), (admin, "GET", "/api/venue/totals", None),
                                       (admin, "PUT", "/api/venue/fees", {"taker_fee_bps": 0, "maker_fee_bps": 0})):
        r = caller.http.request(method, path, json=body) if body else caller.http.request(method, path)
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert venue["slug"]


def test_fill_export(app_url: str, mail: Any) -> None:
    venue, owner, _, a, c, mk = trading_venue(app_url, mail)
    place(a, ev(mk, "yes", ASK, 10))
    place(c, ev(mk, "no", NO_AT_ASK, 4))
    month = venue_month(app_url)
    r = owner.http.get("/api/venue/fills.csv", params={"month": month})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"] == f'attachment; filename="fills-{venue["slug"]}-{month}.csv"'
    lines = r.text.splitlines()
    assert lines[0] == CSV_HEADER
    rows = list(csv.DictReader(io.StringIO(r.text)))
    expected = {f["id"]: (m.email, f) for m in (a, c) for f in fills(m, mk["id"])}
    assert {row["fill_id"] for row in rows} == set(expected)
    for row in rows:
        email, f = expected[row["fill_id"]]
        assert (row["member_email"], row["market_symbol"], int(row["price"]), int(row["quantity"]), int(row["fee_cents"]),
                row["liquidity"], row["outcome"], row["mode"]) == (
            email, mk["symbol"], f["price"], f["quantity"], f["fee_cents"], f["liquidity"], f["outcome"], "")
    assert [row["filled_at"] for row in rows] == sorted(row["filled_at"] for row in rows)
    other = sign_in(app_url, "hl-owner").http.get("/api/venue/fills.csv", params={"month": month}).text
    assert not any(fid in other for fid in expected)
    bad = owner.http.get("/api/venue/fills.csv", params={"month": "2026-13"})
    assert bad.status_code == 422 and "month" in bad.json()["errors"]


def test_invites_and_fees(app_url: str, mail: Any) -> None:
    venue, owner, admin, a, _, mk = trading_venue(app_url, mail)
    name, email = fresh_identity("Admin")
    created = expect_status(owner.http.post("/api/venue/invites",
                                            json={"email": email, "display_name": name, "roles": ["market_admin"]}), 201, "invite")
    assert created["email"] == email and created["roles"] == ["market_admin"]
    assert "UPDATE_PASSWORD" in keycloak_users(email)[0].get("requiredActions", [])
    token = invite_token(mail_for(mail, email, subject=f"You're invited to {venue['name']}")[0])
    assert httpx.get(f"{app_url}/api/invites/{token}", timeout=HTTP_TIMEOUT).json() == {"email": email, "venue_name": venue["name"]}
    short = httpx.post(f"{app_url}/api/invites/{token}/accept", json={"password": "short"}, timeout=HTTP_TIMEOUT)
    assert short.status_code == 422 and short.json()["errors"] == {"password": "invalid"}
    joined = accept(app_url, email, token)
    assert joined.me["roles"] == ["market_admin"] and joined.venue["id"] == venue["id"]
    assert "UPDATE_PASSWORD" not in keycloak_users(email)[0].get("requiredActions", [])
    assert httpx.get(f"{app_url}/api/invites/{token}", timeout=HTTP_TIMEOUT).status_code == 404
    dup = owner.http.post("/api/venue/invites", json={"email": email, "display_name": name, "roles": ["trader"]})
    assert dup.status_code == 409 and dup.json() == {"error": "already_member"}
    for roles, extra in (([], {}), (["org_owner"], {}), (["trader"], {"venue_id": venue["id"]})):
        _, probe_email = fresh_identity("Refused")
        r = owner.http.post("/api/venue/invites", json={"email": probe_email, "display_name": "Refused", "roles": roles} | extra)
        assert r.status_code == 422, (roles, extra, r.text)
        assert keycloak_users(probe_email) == []

    short_owner = sign_in(outage("APP_SHORT_URL"), "hl-owner")
    _, late_email = fresh_identity("Late")
    expect_status(short_owner.http.post("/api/venue/invites", json={"email": late_email, "display_name": "Late", "roles": ["trader"]}),
                  201, "invite on short-timer instance")
    late_token = invite_token(mail_for(mail, late_email, subject="You're invited to Harbor Lantern Club")[0])
    wait_for(lambda: httpx.get(f"{short_owner.base}/api/invites/{late_token}", timeout=HTTP_TIMEOUT).status_code == 410,
             SHORT_INVITE_TTL_S + POLL_SLACK_S * 5, "an invite past INVITE_TTL_SECONDS answers 410 (L494)")
    late = httpx.post(f"{short_owner.base}/api/invites/{late_token}/accept", json={"password": "pw-" + uuid.uuid4().hex},
                      timeout=HTTP_TIMEOUT)
    assert late.status_code == 410 and late.json() == {"error": "invite_expired"}

    before = place(a, ev(mk, "yes", BID_LOW, 5))
    old = (before["taker_fee_bps"], before["maker_fee_bps"])
    new = (old[0] + 75, min(old[0] + 75, old[1] + 10))
    saved = expect_status(owner.http.put("/api/venue/fees", json={"taker_fee_bps": new[0], "maker_fee_bps": new[1]}), 200, "fees")
    assert saved == {"taker_fee_bps": new[0], "maker_fee_bps": new[1]}
    after = place(a, ev(mk, "yes", BID_LOW, 5))
    assert (after["taker_fee_bps"], after["maker_fee_bps"]) == new
    assert (order(a, before["id"])["taker_fee_bps"], order(a, before["id"])["maker_fee_bps"]) == old
    for body, field, code in (({"taker_fee_bps": 5, "maker_fee_bps": 6}, "maker_fee_bps", "exceeds_taker"),
                              ({"taker_fee_bps": FEE_MAX + 1, "maker_fee_bps": 0}, "taker_fee_bps", "out_of_range")):
        r = owner.http.put("/api/venue/fees", json=body)
        assert r.status_code == 422 and r.json()["errors"][field] == code
    assert market(a, mk["id"])["taker_fee_bps"] == new[0]


def test_wf_owner_venue_journey(browser: Browser, app_url: str, mail: Any) -> None:
    venue, owner, admin, a, c, mk = trading_venue(app_url, mail)
    builder = new_member(owner, mail, ("builder",), prefix="Builder")
    place(a, ev(mk, "yes", ASK, 5))
    place(c, ev(mk, "no", NO_AT_ASK, 5))
    _, invitee = fresh_identity("Admin")
    current, previous = venue_month(app_url), venue_month(app_url, back=1)
    with signed_in(browser, owner, "/owner") as page:
        expect(page.get_by_role("region", name="Venue totals")).to_contain_text(str(owner.http.get("/api/venue/totals").json()["members"]))
        picker = page.get_by_role("combobox", name="Find member")
        picker.press_sequentially(a.name.split()[-1])
        expect(page.get_by_role("option", name=f"{a.name} — {a.email}", exact=True)).to_be_visible()
        picker.press("ArrowDown")
        picker.press("Enter")
        btn(page, "Invite member").click()
        dialog = page.get_by_role("dialog", name="Invite member")
        dialog.get_by_role("textbox", name="Email").fill(invitee)
        dialog.get_by_role("textbox", name="Display name").fill("Invited Admin")
        dialog.get_by_role("checkbox", name="Market admin").check()
        btn(dialog, "Send invite").click()
        venue_updates = page.get_by_role("status", name="Venue updates")
        expect(venue_updates).to_have_text(f"Invite sent to {invitee}.")
        page.get_by_role("spinbutton", name="Taker fee (bps)").fill("150")
        page.get_by_role("spinbutton", name="Maker fee (bps)").fill("20")
        btn(page, "Save fees").click()
        expect(venue_updates).to_have_text("Fees saved.")
        select(page.get_by_role("combobox", name="Export month"), month_label(current))
        with page.expect_download() as download:
            page.get_by_role("link", name="Export fills (CSV)").click()
        exported = Path(download.value.path()).read_text()
        assert exported.splitlines()[0] == CSV_HEADER and all(f["id"] in exported for f in fills(a, mk["id"]))
        select(page.get_by_role("combobox", name="Export month"), month_label(previous))
        btn(page, "Generate statements").click()
        expect(venue_updates).to_have_text(f"Statements are being generated for {month_label(previous)}.")
        expect(page.get_by_role("table", name="Builder billing")).to_contain_text(builder.name)
    assert keycloak_users(invitee) and mail_for(mail, invitee, subject=f"You're invited to {venue['name']}")
    fresh = market(a, mk["id"])
    assert (fresh["taker_fee_bps"], fresh["maker_fee_bps"]) == (150, 20)
    statement_for(a, previous)


def test_wf_owner_venue_invite_errors(browser: Browser, app_url: str, mail: Any) -> None:
    venue, owner, _, a, _, mk = trading_venue(app_url, mail)
    fees_before = (market(a, mk["id"])["taker_fee_bps"], market(a, mk["id"])["maker_fee_bps"])
    _, no_roles = fresh_identity("Norole")
    with signed_in(browser, owner, "/owner") as page:
        opener = btn(page, "Invite member")
        opener.click()
        dialog = page.get_by_role("dialog", name="Invite member")
        dialog.get_by_role("textbox", name="Email").fill("not-an-email")
        dialog.get_by_role("textbox", name="Display name").fill("Someone")
        dialog.get_by_role("checkbox", name="Trader").check()
        btn(dialog, "Send invite").click()
        expect_shown(page, "Enter a valid email.")
        dialog.get_by_role("textbox", name="Email").fill(no_roles)
        dialog.get_by_role("checkbox", name="Trader").uncheck()
        btn(dialog, "Send invite").click()
        expect_shown(page, "Choose at least one role.")
        dialog.get_by_role("textbox", name="Email").fill(a.email)
        dialog.get_by_role("checkbox", name="Trader").check()
        btn(dialog, "Send invite").click()
        expect_shown(page, "That person is already a member.")
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        page.get_by_role("spinbutton", name="Taker fee (bps)").fill("10")
        page.get_by_role("spinbutton", name="Maker fee (bps)").fill("20")
        btn(page, "Save fees").click()
        expect(page.get_by_role("status", name="Venue updates")).to_have_text(
            "Enter whole basis points from 0 to 1,000, with the maker fee no higher than the taker fee.")
    assert keycloak_users(no_roles) == [] and keycloak_users("not-an-email") == []
    assert (market(a, mk["id"])["taker_fee_bps"], market(a, mk["id"])["maker_fee_bps"]) == fees_before
    assert venue["id"]


def test_wf_cross_cutting_health(app_url: str) -> None:
    for base in (app_url, *(outage(n) for n in ("APP_KILLBILL_DOWN_URL", "APP_SVIX_DOWN_URL", "APP_MINIO_DOWN_URL",
                                                 "APP_MAILPIT_DOWN_URL", "APP_SHORT_URL"))):
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, base
        assert r.headers["content-type"].startswith("application/json")


def test_wf_cross_cutting_server_boundary(browser: Browser, app_url: str, mail: Any) -> None:
    padding = JSON_LIMIT - len(json.dumps({"username": "", "password": "x"}))
    exact = json.dumps({"username": "u" * padding, "password": "x"})
    assert len(exact.encode()) == JSON_LIMIT
    at_limit = httpx.post(f"{app_url}/api/session", content=exact, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert at_limit.status_code != 413
    over = httpx.post(f"{app_url}/api/session", content=exact[:-2] + 'xx"}', headers={"Content-Type": "application/json"},
                      timeout=HTTP_TIMEOUT)
    assert over.status_code == 413 and over.json() == {"error": "payload_too_large"}
    broken = httpx.post(f"{app_url}/api/session", content="{not json", headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert broken.status_code == 400 and broken.json() == {"error": "bad_json"}

    owner, _ = harbor(app_url)
    a = new_member(owner, mail)
    foreign = a.http.patch("/api/me", json={"display_name": "Origin attack"}, headers={"Origin": "http://evil.example"})
    assert foreign.status_code == 403 and foreign.json() == {"error": "bad_origin"}
    opaque = a.http.patch("/api/me", json={"display_name": "Opaque origin"}, headers={"Origin": "null"})
    assert opaque.status_code == 403 and opaque.json() == {"error": "bad_origin"}, "only a missing Origin is allowed (L734)"
    assert a.http.get("/api/me").json()["display_name"] == a.name
    parsed = urlparse(app_url)
    own = a.http.patch("/api/me", json={"display_name": a.name}, headers={"Origin": f"{parsed.scheme}://{parsed.netloc}"})
    assert own.status_code == 200
    for r in (httpx.options(f"{app_url}/api/health", headers={"Origin": "http://evil.example"}, timeout=HTTP_TIMEOUT),
              httpx.get(f"{app_url}/api/health", headers={"Origin": "http://evil.example"}, timeout=HTTP_TIMEOUT)):
        assert not [h for h in r.headers if h.lower().startswith("access-control-")]
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts",
                 "/server.ts", "/node_modules/.package-lock.json"):
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).status_code == 404, path

    secrets = [os.environ.get(n, "") for n in ("AUTH_CLIENT_SECRET", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "SVIX_API_KEY",
                                               "S3_SECRET_ACCESS_KEY", "DATABASE_URL", "KILLBILL_URL", "SVIX_URL")]
    secrets = [s for s in secrets if len(s) >= 8 and not s.isalpha()]
    with signed_in(browser, a, "/") as page:
        seen: list[tuple[str, str]] = []
        page.on("response", lambda r: seen.append((r.url, r.headers.get("content-type") or "")))
        page.goto(f"{app_url}/")
        page.goto(f"{app_url}/markets")
        page.goto(f"{app_url}/balance")
        expect(page.get_by_role("navigation", name="Venue")).to_be_visible()
        foreign_urls = [u for u, _ in seen if u.startswith("http") and not same_origin(u, app_url)]
        assert foreign_urls == [], f"the browser talks only to the app's origin: {foreign_urls[:5]}"
        assets = [u for u, ct in seen if any(t in ct for t in ("javascript", "css", "html", "json"))]
    for url in assets:
        body = httpx.get(url, timeout=HTTP_TIMEOUT).text
        for secret in secrets:
            assert secret not in body, f"a configured secret or service URL is served in {url}"


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))
    assert "npm ci" in manifest["install"]


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == [], f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"
    assert "Parkinsans" in notices and "Urbanist" in notices


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert bad == [], f"packages outside the licence allowlist: {bad[:20]}"
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    assert re.search(r"Open Font License|OFL-1\.1", notices)


def test_if_no_extra_datastore() -> None:
    manifest = json.loads((APP_ROOT / "package.json").read_text())
    declared = set(manifest.get("dependencies", {})) | set(manifest.get("devDependencies", {}))
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "@seald-io/nedb", "level", "lmdb", "pouchdb",
                 "lokijs", "node-json-db", "mongodb", "mongoose", "mysql", "mysql2", "amqplib", "kafkajs"}
    assert declared & forbidden == set()
    files = [p for p in DEPLOYED_APP.rglob("*") if p.suffix in {".sqlite", ".sqlite3", ".db"} and "node_modules" not in p.parts]
    assert files == []
    tables = {t.rsplit(".", 1)[-1] for t in Postgres().tables()}
    assert "journal_entries" in tables and "journal_legs" in tables, "the ledger tables live in Postgres (L581-L582)"


def test_if_untouched_provider_config(app_url: str, mail: Any, killbill: Any) -> None:
    assert keycloak_users("ana.pike@harbor.example")
    sign_in(app_url, "hl-ana")
    assert killbill.account("ana.pike@harbor.example") is not None
    owner, admin = harbor(app_url)
    a = new_member(owner, mail)
    doc = expect_status(a.http.post("/api/me/documents", files={"document": ("id.png", png_bytes(), "image/png")}), 201, "upload")
    url = admin.http.get(f"/api/admin/documents/{doc['id']}/link").json()["url"]
    anonymous = httpx.get(url.split("?", 1)[0], timeout=HTTP_TIMEOUT)
    assert anonymous.status_code == 403, "the bucket stays private"


def test_if_typescript_only() -> None:
    skip = {"node_modules", "dist", "build", "out", ".git", "coverage", ".cache", ".npm"}
    offenders, ts = [], 0
    for path in APP_ROOT.rglob("*"):
        if skip & set(path.relative_to(APP_ROOT).parts) or not path.is_file():
            continue
        if path.suffix in {".ts", ".tsx"}:
            ts += 1
        elif path.suffix in {".js", ".jsx", ".mjs", ".cjs"} and "config" not in path.name and not path.name.startswith("."):
            offenders.append(str(path))
    assert ts > 0 and offenders == [], f"plain JavaScript source: {offenders[:10]}"


def test_if_exact_dependencies() -> None:
    assert (APP_ROOT / "package-lock.json").is_file()
    manifest = json.loads((APP_ROOT / "package.json").read_text())
    loose = {name: v for group in ("dependencies", "devDependencies") for name, v in manifest.get(group, {}).items()
             if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", v)}
    assert loose == {}, f"non-exact versions: {loose}"
