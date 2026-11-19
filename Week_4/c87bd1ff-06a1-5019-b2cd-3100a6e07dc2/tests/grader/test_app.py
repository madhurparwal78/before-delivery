from __future__ import annotations

import base64
import html as htmllib
import importlib
import json
import math
import os
import re
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

import conftest
from conftest import (
    DEPLOYED_APP,
    advance,
    click,
    fill,
    idempotency_key,
    licence_allowed,
    open_app,
    project_dirs,
    same_origin,
    select,
    shipped_packages,
    tab_order,
    unique,
    until,
)

Postgres = getattr(conftest, "Postgres", None) or importlib.import_module("postgres").Postgres
Keycloak = getattr(conftest, "Keycloak", None) or importlib.import_module("keycloak").Keycloak


HTTP_TIMEOUT = 30
UI_S = 15
UI_MS = 15000
VIEW_SLACK_MS = 1500
DIALOG_WAIT_MS = 2000
WAIT_S = 90
LONG_WAIT_S = 330
SLACK_S = 10
HOP_LIMIT = 15
POLL_S = 0.25
APP_ROOT = Path("/app")

CEILING = 1000000
TITLE_MAX = 120
CONDITION_MAX = 2000
LIMIT_LOW = 100
LIMIT_TOP = 1000000
LIMIT_3000 = 3000
FIRST_PADDLE = 101
FIRST_LOT = 201
LOGIN_OUTAGE_S = 3
STATE_MIN_CHARS = 22

LOT_GAP = 60
SOFT_CLOSE = 120
PAYMENT_DUE = 259200
OFFER_WINDOW = 86400
WATCH_NOTICE = 300
SHORT_GAP = 5
SHORT_SOFT = 10
SHORT_DUE = 20
SHORT_OFFER = 10
SHORT_WATCH = 8
SHORT_LEAD = 45
CLOSE_LEAD = 150
REMOVAL_LEAD = 90
DAY_AHEAD = 86400
OPEN_A = 1600
RESERVE_A = 2200
PRICE_1750 = 1750
PRICE_1950 = 1950
MAX_1700 = 1700
MAX_1900 = 1900
MAX_2300 = 2300
MAX_2450 = 2450
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")
DESK_ESTIMATED = "/api/desk/lots?state=estimated"
PAY_PART = "125.50"
PAY_REST = f"{Decimal('1628.13') - Decimal(PAY_PART):.2f}"
PAY_OVER = f"{Decimal('1628.13') + Decimal('0.01'):.2f}"
PAY_MALFORMED = "12.5"
PAY_ZERO = "0.00"
PAY_SMALL = "1.00"

LIVE_MS = 1000
CLOSE_GRACE = 1
COUNT_UP_MS = 400
RECONNECT_MS = 1100
DIALOG_FADE_MS = 200
DIGIT_MIN_MS = 500
DIGIT_MAX_MS = 1000
DIGIT_STAGGER_MS = 25

PHONE_SIZE = (375, 812)
BELOW_TABLET = (767, 1024)
TABLET_SIZE = (768, 1024)
TABLET_TOP = (1199, 800)
WIDE_EDGE = (1200, 800)
WIDE_SIZE = (1280, 800)

AMS = ZoneInfo("Europe/Amsterdam")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
CLOSED = ("closed_sold", "closed_unsold")

APPROVAL_ERROR = "Enter a spending limit between €100 and €1,000,000."
AMOUNT_ERROR = "Enter a whole number of euros from €1 to €1,000,000."
LOW_HIGH_ERROR = "The low estimate must not be above the high estimate."
OPENING_ERROR = "The opening bid must not be above the low estimate."
RESERVE_ERROR = "The reserve must be between the opening bid and the low estimate."
CONDITION_ERROR = "Condition notes can be up to 2,000 characters."
PORTRAIT_ERROR = "Choose a portrait."
SALE_ENDS_ERROR = "Enter the end as YYYY-MM-DD HH:MM, Rotterdam time."
FUTURE_ERROR = "The sale must end in the future."
NO_LOTS_ERROR = "Add at least one lot before publishing."
WHOLE_ERROR = "Enter a whole number of euros."
CEILING_ERROR = "Enter no more than €1,000,000."
PAYMENT_FORMAT_ERROR = "Enter an amount in euros and cents, for example 125.50."
CONNECTING_HINT = "Connecting to the saleroom…"
CONNECTION_BANNER = "Live connection lost — reconnecting"
OUTAGE_BANNER = "Sign-in is unavailable right now. If you are already signed in, you can carry on bidding."
CONDITION = "Running at time of cataloguing; light wear consistent with age."

GUESS_ID = "lot-guess-0000"
FOREIGN_ORIGIN = "http://evil.example.test"
PHONE = "+31 10 555 0100"
ADDRESS = "Coolsingel 1, Rotterdam"
DESCRIPTION = "A 1960s chronograph with a steel case and a black dial."
REASON = "Withdrawn by the saleroom for the test."
NOTE = "Correction requested for the test."
NEW_PASSWORD = "Harrow-visitor-2026!"

SEED_BIDDER = ("ruth.okafor", "Harrow-bidder-2026")
SEED_CONSIGNOR = ("hendrik.vos", "Harrow-consignor-2026")
STAFF_USERS = {
    "specialist": ("mila.verhoef", "Harrow-specialist-2026"),
    "cashier": ("joost.bakker", "Harrow-cashier-2026"),
    "admin": ("ines.dekker", "Harrow-admin-2026"),
}

SPEC_A = dict(low=2400, high=3200, opening=1600, reserve=2200)
SPEC_1400 = dict(low=1800, high=2500, opening=1200, reserve=1700)
HAMMER_1250 = dict(low=1250, high=1500, opening=1250, reserve=1250)
HAMMER_85 = dict(low=85, high=100, opening=85, reserve=85)
HAMMER_2450 = dict(low=2450, high=3000, opening=2450, reserve=2450)

PUBLIC_KEYS = {"id", "sale_id", "lot_number", "title", "category", "description", "condition", "portrait",
               "estimate_low", "estimate_high", "opening_bid", "price", "asking", "bid_count", "leader_paddle",
               "reserve_met", "status", "closes_at", "remaining_seconds", "server_now"}
BIDDER_KEYS = PUBLIC_KEYS | {"my_max", "i_lead", "watching"}
CONSIGNOR_KEYS = {"id", "sale_id", "lot_number", "title", "category", "description", "condition", "portrait",
                  "estimate_low", "estimate_high", "opening_bid", "reserve", "price", "bid_count", "reserve_met",
                  "state", "closes_at", "remaining_seconds", "server_now", "hammer", "second_chance_open",
                  "offer"}
STAFF_KEYS = CONSIGNOR_KEYS | {"consignor_name", "leader_paddle"}
HISTORY_PUBLIC = {"paddle", "price_after", "accepted_at"}
HISTORY_CONSIGNOR = {"price_after", "accepted_at"}
STATEMENT_KEYS = {"id", "number", "sale_id", "sale_title", "version", "status", "issued_at", "supersedes",
                  "superseded_by", "lines", "hammer_total", "commission_total", "net_total"}
STATEMENT_LINE_KEYS = {"lot_id", "lot_number", "title", "result", "hammer", "commission", "net"}
ALLOWED_LICENCES = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "MPL-2.0"}
LAST_SECONDS = 2
SOFT_ENTRY_S = 0.3
RETRY_AT_ONCE_MS = 480
EVENTUALLY_POLL_MS = 60
MOTION_FLOOR_MS = 50

expect.set_options(timeout=UI_MS)


HOLD_JS = """
(() => {
  const Real = window.WebSocket;
  const live = { sockets: [], frames: [] };
  let held = true;
  const waiting = [];
  window.__live = live;
  window.__liveHold = () => { held = true; };
  window.__liveRelease = () => { held = false; while (waiting.length) waiting.shift()(); };
  window.__liveDrop = () => {
    const last = live.sockets[live.sockets.length - 1];
    last.dropped = true;
    last.real.close();
  };
  class Held extends EventTarget {
    constructor(url, protocols) {
      super();
      this.index = live.sockets.length;
      this.state = 0;
      this.dropped = false;
      this.real = protocols === undefined ? new Real(url) : new Real(url, protocols);
      live.sockets.push(this);
      this.real.addEventListener("open", () => this.later(() => {
        this.state = 1;
        this.emit(new Event("open"));
      }));
      this.real.addEventListener("message", (event) => this.later(() => {
        if (this.dropped) return;
        try {
          const data = JSON.parse(event.data);
          if (typeof data.seq === "number") live.frames.push({ socket: this.index, seq: data.seq });
        } catch (error) { /* not JSON */ }
        this.emit(new MessageEvent("message", { data: event.data }));
      }));
      this.real.addEventListener("close", (event) => {
        this.state = 3;
        this.emit(new CloseEvent("close", { code: event.code, reason: event.reason, wasClean: event.wasClean }));
      });
      this.real.addEventListener("error", () => this.emit(new Event("error")));
    }
    get url() { return this.real.url; }
    get readyState() { return this.state; }
    get bufferedAmount() { return this.real.bufferedAmount; }
    get protocol() { return this.real.protocol; }
    get extensions() { return this.real.extensions; }
    get binaryType() { return this.real.binaryType; }
    set binaryType(value) { this.real.binaryType = value; }
    later(fn) { if (held) waiting.push(fn); else fn(); }
    emit(event) {
      const handler = this["on" + event.type];
      if (typeof handler === "function") handler.call(this, event);
      this.dispatchEvent(event);
    }
    send(data) { this.real.send(data); }
    close(...args) { this.real.close(...args); }
  }
  Held.CONNECTING = 0; Held.OPEN = 1; Held.CLOSING = 2; Held.CLOSED = 3;
  window.WebSocket = Held;
})();
"""

PROBE_JS = """
() => new Promise((resolve) => {
  window.__probe = [];
  const origin = location.origin.replace(/^http/, "ws");
  const probe = new WebSocket(origin + "/api/live");
  probe.onmessage = (event) => { try { window.__probe.push(JSON.parse(event.data)); } catch (error) { /* ignore */ } };
  probe.onopen = () => resolve(true);
})
"""

LISTEN_JS = """
(region) => {
  window.__said = [];
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") {
        if (record.target.data.trim()) window.__said.push(record.target.data.trim());
      } else {
        for (const node of record.addedNodes) {
          if (node.textContent.trim()) window.__said.push(node.textContent.trim());
        }
      }
    }
  }).observe(region, { subtree: true, childList: true, characterData: true });
}
"""

SAID_JS = "(sentence) => (window.__said || []).some((text) => text.includes(sentence))"

ANIM_JS = """
(region) => {
  window.__anims = [];
  const note = (target, animation, begin) => {
    if (!region.contains(target)) return;
    window.__anims.push({
      duration: animation.effect.getComputedTiming().duration,
      begin,
      x: target.getBoundingClientRect().x,
    });
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const animation = animate.apply(this, args);
    note(this, animation, document.timeline.currentTime + animation.effect.getComputedTiming().delay);
    return animation;
  };
  region.addEventListener("animationstart", (event) => {
    for (const animation of event.target.getAnimations()) {
      if (animation.animationName === event.animationName) note(event.target, animation, document.timeline.currentTime);
    }
  }, true);
  region.addEventListener("transitionrun", (event) => {
    for (const animation of event.target.getAnimations()) {
      if (animation.transitionProperty === event.propertyName) {
        note(event.target, animation, document.timeline.currentTime + animation.effect.getComputedTiming().delay);
      }
    }
  }, true);
}
"""


@pytest.fixture
def env(app_url: str) -> SimpleNamespace:
    return SimpleNamespace(base=app_url, pg=Postgres(), gap=LOT_GAP, soft=SOFT_CLOSE, due=PAYMENT_DUE,
                           offer=OFFER_WINDOW, watch=WATCH_NOTICE)


@pytest.fixture
def short_env() -> SimpleNamespace:
    return SimpleNamespace(base=os.environ["APP_SHORT_URL"], pg=Postgres("_short"), gap=SHORT_GAP,
                           soft=SHORT_SOFT, due=SHORT_DUE, offer=SHORT_OFFER, watch=SHORT_WATCH)


@pytest.fixture
def down_url() -> str:
    return os.environ["APP_KEYCLOAK_DOWN_URL"]


class Member:

    def __init__(self, base: str, cookies: dict[str, str] | None = None) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=False, cookies=cookies or {})
        self.username = ""
        self.password = ""
        self.full_name = ""
        self.paddle: int | None = None
        self.registration: dict | None = None
        self.landing: Any = None

    def url(self, path: str) -> str:
        return self.base + path

    def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.http.get(self.url(path), **kwargs)

    def post(self, path: str, body: Any = None, headers: dict | None = None, key: str | None = None) -> httpx.Response:
        sent = dict(headers or {})
        if key:
            sent["Idempotency-Key"] = key
        return self.http.post(self.url(path), json={} if body is None else body, headers=sent)

    def put(self, path: str, body: Any = None, headers: dict | None = None) -> httpx.Response:
        return self.http.put(self.url(path), json={} if body is None else body, headers=dict(headers or {}))

    def on(self, base: str) -> "Member":
        other = Member(base, dict(self.http.cookies.items()))
        other.username, other.full_name, other.paddle = self.username, self.full_name, self.paddle
        return other


def ok(response: httpx.Response, status: int, what: str) -> Any:
    assert response.status_code == status, f"{what}: expected {status}, got {response.status_code} {response.text[:300]}"
    return response.json()


def err(response: httpx.Response, status: int, code: str, what: str) -> dict:
    assert response.status_code == status, f"{what}: expected {status}, got {response.status_code} {response.text[:300]}"
    body = response.json()
    assert body.get("error") == code, f"{what}: expected error {code!r}, got {body}"
    assert isinstance(body.get("message"), str), f"{what}: the error body carries a message (L385)"
    return body


def bid(member: Member, lot_id: str, value: Any, kind: str = "maximum", key: str | None = None,
        headers: dict | None = None) -> httpx.Response:
    return member.post(f"/api/lots/{lot_id}/bids", {"type": kind, "max_amount": value}, headers=headers,
                       key=key or idempotency_key())


def together(*calls: Callable[[], httpx.Response]) -> list[httpx.Response]:
    gate = threading.Barrier(len(calls))

    def run(call: Callable[[], httpx.Response]) -> httpx.Response:
        gate.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return [future.result() for future in [pool.submit(run, call) for call in calls]]


def wait_for(predicate: Callable[[], Any], seconds: float, why: str) -> Any:
    deadline = time.monotonic() + seconds
    tick = threading.Event()
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        tick.wait(POLL_S)
    pytest.fail(f"timed out after {seconds:.0f}s waiting for: {why}")


def start_sign_in(member: Member, next_path: str | None = None) -> httpx.Response:
    return member.get("/auth/login", params={"next": next_path} if next_path is not None else None)


def _form(markup: str, base_url: str) -> tuple[str, dict[str, str]]:
    tag = re.search(r"<form\b[^>]*>", markup)
    assert tag, f"the Keycloak page holds a form: {markup[:300]}"
    action = re.search(r'action="([^"]*)"', tag.group(0))
    assert action, "the Keycloak form has an action"
    hidden: dict[str, str] = {}
    for field in re.findall(r"<input\b[^>]*>", markup):
        name = re.search(r'name="([^"]*)"', field)
        kind = re.search(r'type="([^"]*)"', field)
        value = re.search(r'value="([^"]*)"', field)
        if name and kind and kind.group(1) == "hidden":
            hidden[htmllib.unescape(name.group(1))] = htmllib.unescape(value.group(1)) if value else ""
    return urljoin(base_url, htmllib.unescape(action.group(1))), hidden


def _walk(kc: httpx.Client, url: str, form: dict | None = None) -> tuple[httpx.Response | None, str | None]:
    for _ in range(HOP_LIMIT):
        response = kc.post(url, data=form) if form is not None else kc.get(url)
        form = None
        if response.is_redirect:
            url = urljoin(str(response.url), response.headers["location"])
            if urlsplit(url).path.endswith("/auth/callback"):
                return None, url
            continue
        return response, None
    pytest.fail("Keycloak redirected more than expected")


def sign_in(base: str, username: str, password: str, next_path: str | None = None,
            stop: Callable[[str], bool] | None = None, signup: dict | None = None) -> Member:
    member = Member(base)
    member.username, member.password = username, password
    start = start_sign_in(member, next_path)
    assert start.status_code == 302, f"GET /auth/login answers 302 (L440); got {start.status_code}"
    kc = httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=False)
    try:
        page, callback = _walk(kc, start.headers["location"])
        if page is not None and signup is not None:
            link = re.search(r'href="([^"]*/(?:login-actions/registration|openid-connect/registrations)\b[^"]*)"', page.text)
            assert link, f"the Keycloak page offers account creation: {page.text[:300]}"
            page, callback = _walk(kc, urljoin(str(page.url), htmllib.unescape(link.group(1))))
            if page is not None:
                action, hidden = _form(page.text, str(page.url))
                page, callback = _walk(kc, action, {**hidden, **signup})
        elif page is not None:
            action, hidden = _form(page.text, str(page.url))
            page, callback = _walk(kc, action, {**hidden, "username": username, "password": password})
    finally:
        kc.close()
    assert callback, f"Keycloak did not send the browser back to the callback: {page.text[:300] if page else ''}"
    parts = urlsplit(callback)
    callback = f"{member.base}{parts.path}?{parts.query}"
    if stop is not None and stop(callback):
        member.landing = callback
        return member
    arrived = member.http.get(callback)
    assert arrived.status_code == 302, f"the callback answers 302 (L441); got {arrived.status_code} {arrived.text[:200]}"
    member.landing = member.http.get(urljoin(callback, arrived.headers["location"]))
    return member


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def new_person(base: str, prefix: str) -> Member:
    first, second = unique(prefix)
    email = first if "@" in first else second if "@" in second else f"{slug(first)}@example.test"
    username = slug(email.split("@")[0])
    person = sign_in(base, username, NEW_PASSWORD, signup={
        "username": username, "email": email, "firstName": prefix.title(), "lastName": username,
        "password": NEW_PASSWORD, "password-confirm": NEW_PASSWORD})
    person.full_name = f"{prefix.title()} {username}"[:TITLE_MAX]
    return person


_STAFF: dict[tuple[str, str], Member] = {}


def staff(base: str, role: str) -> Member:
    if (base, role) not in _STAFF:
        username, password = STAFF_USERS[role]
        _STAFF[(base, role)] = sign_in(base, username, password)
    return _STAFF[(base, role)]


def register(member: Member, role: str) -> dict:
    body = ok(member.post("/api/register", {"role": role, "full_name": member.full_name, "phone": PHONE,
                                            "address": ADDRESS}), 201, "POST /api/register")
    member.registration = body["registration"]
    return body


def approve(env: SimpleNamespace, member: Member, limit: int) -> dict:
    admin = staff(env.base, "admin")
    path = f"/api/admin/registrations/{member.registration['id']}/approve"
    registration = ok(admin.post(path, {"spending_limit": limit}), 200, "approve")["registration"]
    member.paddle = registration["paddle"]
    return registration


def new_bidder(env: SimpleNamespace, limit: int = LIMIT_TOP) -> Member:
    person = new_person(env.base, "bidder")
    register(person, "bidder")
    approve(env, person, limit)
    return person


def new_consignor(env: SimpleNamespace) -> Member:
    person = new_person(env.base, "consignor")
    register(person, "consignor")
    return person


def db_now(env: SimpleNamespace) -> float:
    return float(env.pg.rows("SELECT extract(epoch FROM now()) AS t")[0]["t"])


def wait_db(env: SimpleNamespace, epoch: float, why: str) -> None:
    wait_for(lambda: db_now(env) >= epoch, max(epoch - db_now(env), 0) + SLACK_S, why)


def ts(stamp: str) -> float:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()


def euros(value: int) -> str:
    return f"€{value:,}"


def amount(value: Decimal) -> str:
    return f"€{value:,.2f}"


def increment(price: int) -> int:
    if price < 100:
        return 5
    if price < 500:
        return 10
    if price < 1000:
        return 25
    if price < 5000:
        return 50
    return 100


def premium(hammer: int) -> Decimal:
    raw = Decimal(min(hammer, 2000)) * Decimal("0.25") + Decimal(max(hammer - 2000, 0)) * Decimal("0.20")
    return raw.quantize(Decimal("0.01"), ROUND_HALF_UP)


def vat(hammer: int) -> Decimal:
    return (premium(hammer) * Decimal("0.21")).quantize(Decimal("0.01"), ROUND_HALF_UP)


def commission(hammer: int) -> Decimal:
    return max(Decimal("15.00"), (Decimal(hammer) * Decimal("0.125")).quantize(Decimal("0.01"), ROUND_HALF_UP))


def rotterdam(epoch: float) -> set[str]:
    stamps = set()
    for offset in (-1, 0, 1):
        moment = datetime.fromtimestamp(math.floor(epoch) + offset, AMS)
        for day in (f"{moment.day:02d}", str(moment.day)):
            stamps.add(f"{day} {MONTHS[moment.month - 1]} {moment.year}, {moment:%H:%M:%S}")
    return stamps


def left_seconds(text: str) -> int | None:
    found = re.search(r"Closes in\s+(?:(\d+)d\s+)?(\d+(?::\d+)+)", text)
    if not found:
        return None
    parts = [int(p) for p in found.group(2).split(":")]
    total = 0
    for part in parts:
        total = total * 60 + part
    return total + int(found.group(1) or 0) * 86400


def all_keys(node: Any) -> set[str]:
    if isinstance(node, dict):
        return set(node) | {k for value in node.values() for k in all_keys(value)}
    if isinstance(node, list):
        return {k for value in node for k in all_keys(value)}
    return set()


def all_numbers(node: Any) -> set[int]:
    if isinstance(node, dict):
        return {n for key, value in node.items() if key != "seq" for n in all_numbers(value)}
    if isinstance(node, list):
        return {n for value in node for n in all_numbers(value)}
    return {node} if isinstance(node, int) and not isinstance(node, bool) else set()


def consign_lot(consignor: Member, title: str, category: str = "wristwatch") -> str:
    body = {"category": category, "title": title, "description": DESCRIPTION}
    return ok(consignor.post("/api/consign/lots", body), 201, "POST /api/consign/lots")["lot"]["id"]


def estimate_body(spec: dict) -> dict:
    return {"estimate_low": spec["low"], "estimate_high": spec["high"], "opening_bid": spec["opening"],
            "reserve": spec["reserve"], "condition": CONDITION, "portrait": spec.get("portrait", "chronograph")}


def estimate(specialist: Member, lot_id: str, spec: dict) -> dict:
    return ok(specialist.put(f"/api/desk/lots/{lot_id}/estimate", estimate_body(spec)), 200, "estimate")["lot"]


def create_sale(specialist: Member, title: str, ends: float) -> dict:
    stamp = datetime.fromtimestamp(math.ceil(ends), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = {"title": title, "ends_at": stamp, "first_lot_number": FIRST_LOT}
    return ok(specialist.post("/api/desk/sales", body), 201, "create sale")["sale"]


def make_sale(env: SimpleNamespace, specs: list[dict], lead: int) -> SimpleNamespace:
    consignor = new_consignor(env)
    specialist = staff(env.base, "specialist")
    tag = slug(unique("sale")[0])[-12:]
    ids = []
    for index, spec in enumerate(specs):
        lot_id = consign_lot(consignor, f"Watch {tag} {index}")
        estimate(specialist, lot_id, spec)
        ids.append(lot_id)
    title = f"WEEK {tag}"[:80]
    sale = create_sale(specialist, title, db_now(env) + lead)
    ok(specialist.put(f"/api/desk/sales/{sale['id']}/lots", {"lot_ids": ids}), 200, "order lots")
    published = ok(specialist.post(f"/api/desk/sales/{sale['id']}/publish"), 200, "publish")["sale"]
    return SimpleNamespace(id=sale["id"], title=title, ids=ids, consignor=consignor, ends=ts(published["ends_at"]),
                           lots=[public_lot(env, lot_id) for lot_id in ids])


def public_view(env: SimpleNamespace, lot_id: str) -> dict:
    return ok(httpx.get(f"{env.base}/api/lots/{lot_id}", timeout=HTTP_TIMEOUT), 200, "GET /api/lots/<id>")


def public_lot(env: SimpleNamespace, lot_id: str) -> dict:
    return public_view(env, lot_id)["lot"]


def consignor_lot(consignor: Member, lot_id: str) -> dict:
    return ok(consignor.get(f"/api/consign/lots/{lot_id}"), 200, "GET /api/consign/lots/<id>")["lot"]


def dashboard(member: Member) -> dict:
    return ok(member.get("/api/bidder/dashboard"), 200, "GET /api/bidder/dashboard")


def notices(member: Member) -> list[dict]:
    return ok(member.get("/api/notices"), 200, "GET /api/notices")["notices"]


def texts(member: Member) -> list[str]:
    return [notice["text"] for notice in notices(member)]


def open_offer(member: Member, lot_id: str) -> dict | None:
    for offer in dashboard(member)["offers"]:
        if offer["lot_id"] == lot_id and offer["status"] == "open":
            return offer
    return None


def sale_invoices(member: Member, sale_id: str) -> list[dict]:
    return [invoice for invoice in dashboard(member)["invoices"] if invoice["sale_id"] == sale_id]


def wait_invoice(member: Member, sale_id: str) -> dict:
    return wait_for(lambda: sale_invoices(member, sale_id), WAIT_S, "the buyer's invoice (L641)")[0]


def sale_statement(env: SimpleNamespace, sale_id: str) -> dict:
    admin = staff(env.base, "admin")
    return wait_for(lambda: ok(admin.get(f"/api/admin/statements?sale_id={sale_id}"), 200, "statements")[
        "statements"], WAIT_S, "the consignor's statement (L641)")[0]


def wait_remaining(env: SimpleNamespace, lot_id: str, seconds_left: int, why: str) -> None:
    left = public_lot(env, lot_id)["remaining_seconds"]
    wait_for(lambda: public_lot(env, lot_id)["remaining_seconds"] <= seconds_left,
             max(left - seconds_left, 0) + SLACK_S, why)


def wait_closed(env: SimpleNamespace, lot_ids: list[str], seconds: float = WAIT_S) -> list[dict]:
    def done() -> list[dict] | None:
        lots = [public_lot(env, lot_id) for lot_id in lot_ids]
        return lots if all(lot["status"] in CLOSED for lot in lots) else None

    return wait_for(done, seconds, "every lot closed (L639)")


def removable_bid(env: SimpleNamespace, lot_id: str, member: Member, maximum: int) -> str:
    rows = ok(staff(env.base, "admin").get(f"/api/admin/lots/{lot_id}/bids"), 200, "admin bids")["bids"]
    found = [row for row in rows if row["paddle"] == member.paddle and row["max_amount"] == maximum]
    assert found, f"the admin sees the bid of paddle {member.paddle} at {maximum} (L424): {rows}"
    return found[-1]["bid_id"]


def raw_upgrade(base: str, origin: str) -> int:
    parts = urlsplit(base)
    request = (f"GET /api/live HTTP/1.1\r\nHost: {parts.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {base64.b64encode(os.urandom(16)).decode()}\r\nSec-WebSocket-Version: 13\r\n"
               f"Origin: {origin}\r\n\r\n")
    with socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT) as sock:
        sock.sendall(request.encode())
        return int(sock.recv(4096).split(b" ", 2)[1])


def cookies_for(member: Member, base: str) -> list[dict]:
    return [{"name": c.name, "value": c.value, "url": base} for c in member.http.cookies.jar]


@contextmanager
def view(browser: Browser, base: str, path: str, member: Member | None = None,
         size: tuple[int, int] = WIDE_SIZE, reduced: bool = False, init: str | None = None,
         device_time: datetime | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if member is not None:
            page.context.add_cookies(cookies_for(member, base))
        if init:
            page.context.add_init_script(init)
        if device_time is not None:
            page.clock.set_system_time(device_time)
        page.goto(base + path)
        yield page


def board(page: Page) -> Any:
    return page.get_by_role("region", name="Lot board")


def updates(page: Page) -> Any:
    return page.get_by_role("status", name="Saleroom updates")


def place_button(page: Page) -> Any:
    return page.get_by_role("button", name="Place bid")


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def wait_text(page: Page, text: str, why: str, seconds: float = UI_S) -> None:
    until(page, "(t) => document.body.innerText.includes(t) || document.body.textContent.replace(/\\s+/g, ' ').includes(t)",
          text, seconds)


def wait_gone(page: Page, text: str, why: str, seconds: float = UI_S) -> None:
    until(page, "(t) => !document.body.innerText.includes(t)", text, seconds)


def listen(page: Page) -> None:
    updates(page).evaluate(LISTEN_JS)


def said(page: Page) -> list[str]:
    return page.evaluate("() => window.__said || []")


def said_count(page: Page, sentence: str) -> int:
    return sum(1 for text in said(page) if sentence in text)


def wait_said(page: Page, sentence: str, seconds: float = UI_S) -> None:
    try:
        until(page, SAID_JS, sentence, seconds)
    except AssertionError as error:
        raise AssertionError(f"{sentence!r} was never announced; announced: {said(page)}") from error


def probe_frames(page: Page, lot_id: str, predicate: Callable[[dict], bool], why: str) -> list[dict]:
    def seen() -> list[dict] | None:
        frames = [f for f in page.evaluate("() => window.__probe") if f.get("type") == "lot_changed"
                  and f["lot"]["id"] == lot_id]
        return frames if any(predicate(f) for f in frames) else None

    return wait_for(seen, UI_S, why)


def attempt_bid(page: Page) -> None:
    click(place_button(page))
    dialog = page.get_by_role("dialog", name="Confirm your bid")
    deadline = time.monotonic() + DIALOG_WAIT_MS / 1000
    while not dialog.is_visible():
        if time.monotonic() > deadline:
            return
        advance(page, 48)
    click(dialog.get_by_role("button", name="Confirm bid"))


def focused_cell(grid: Any, names: list[str]) -> str | None:
    cells = grid.get_by_role("gridcell")
    for index in range(cells.count()):
        cell = cells.nth(index)
        if cell.evaluate("c => c.contains(document.activeElement)"):
            for name in names:
                if cell.get_by_role("link", name=name, exact=True).count():
                    return name
    return None


def grid_order(grid: Any, names: list[str]) -> list[str]:
    cells = grid.get_by_role("gridcell")
    order = []
    for index in range(cells.count()):
        for name in names:
            if cells.nth(index).get_by_role("link", name=name, exact=True).count():
                order.append(name)
    return order


HIDDEN_JS = """
e => {
  if (e.closest('[inert], [aria-hidden="true"]')) return true;
  const r = e.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1 || r.right <= 0 || r.left >= innerWidth) return true;
  for (let n = e; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return true;
    if (s.clip && s.clip !== 'auto' && /rect\\(\\s*0/.test(s.clip)) return true;
    if (s.clipPath && /inset\\(\\s*50%/.test(s.clipPath)) return true;
  }
  return false;
}
"""


def small_controls(page: Page) -> list[str]:
    small = []
    for role in ("button", "link", "textbox", "combobox"):
        controls = page.get_by_role(role)
        for index in range(controls.count()):
            control = controls.nth(index)
            box = control.bounding_box()
            if not box or control.evaluate(HIDDEN_JS):
                continue
            if box["width"] < 44 or box["height"] < 44:
                small.append(f"{role} {control.inner_text()[:30]!r} {box['width']:.0f}x{box['height']:.0f}")
    return small


def phone_layout(page: Page) -> None:
    viewport = page.viewport_size
    assert viewport is not None
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible() and not control.evaluate(HIDDEN_JS):
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            box = control.bounding_box()
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1


def live(page: Page, predicate: Callable[[], Any], seconds: float, why: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() <= deadline:
        value = predicate()
        if value:
            return value
        advance(page, 48)
    value = predicate()
    if not value:
        pytest.fail(f"timed out after {seconds:.1f}s waiting for: {why}")
    return value


def shows(locator: Any, text: str, seconds: float = UI_S, whole: bool = False) -> None:
    def seen() -> bool:
        if not locator.count():
            return False
        found = [" ".join((t or "").split()) for t in locator.first.evaluate("e => [e.innerText, e.textContent]")]
        return any(t == text if whole else text in t for t in found)

    live(locator.page, seen, seconds, f"{text!r} shown")


def eventually(target: Any, assertion: Callable[[], Any], seconds: float = UI_S) -> None:
    page = target if isinstance(target, Page) else target.page
    deadline = time.monotonic() + seconds
    while time.monotonic() <= deadline:
        try:
            assertion()
            return
        except AssertionError:
            advance(page, 48)
    assertion()


def appears(locator: Any, seconds: float = UI_S) -> None:
    live(locator.page, lambda: locator.count() > 0 and locator.first.is_visible(), seconds, f"{locator} visible")


def check(locator: Any) -> None:
    if locator.is_checked():
        return
    try:
        conftest.check(locator)
        return
    except AssertionError:
        if locator.is_checked():
            return
    label = locator.evaluate_handle("e => (e.labels && e.labels[0]) || e.closest('label')").as_element()
    assert label is not None, "the radio is hidden and has no label to press"
    label.scroll_into_view_if_needed()
    box = label.bounding_box()
    assert box, "the radio's label is on screen"
    point = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
    assert label.evaluate("(l, p) => { const hit = document.elementFromPoint(p.x, p.y); return l.contains(hit); }",
                          point), "the radio's label is obscured at the pointer target"
    locator.page.mouse.click(point["x"], point["y"])
    eventually(locator, lambda: expect(locator).to_be_checked(timeout=EVENTUALLY_POLL_MS))


def test_keycloak_sign_in(browser: Browser, app_url: str) -> None:
    username, password = SEED_BIDDER
    queries, cookie_lines = [], []
    for _ in range(2):
        attempt = start_sign_in(Member(app_url), "/bidder")
        assert attempt.status_code == 302, f"GET /auth/login answers 302 (L440); got {attempt.status_code}"
        queries.append(parse_qs(urlsplit(attempt.headers["location"]).query))
        cookie_lines += [line.lower() for line in attempt.headers.get_list("set-cookie")]
    states = [q["state"][0] for q in queries]
    assert states[0] != states[1] and all(len(s) >= STATE_MIN_CHARS for s in states), "a fresh state each attempt (L778)"
    challenges = [q["code_challenge"][0] for q in queries]
    assert challenges[0] != challenges[1], "a fresh PKCE challenge each attempt (L778)"
    assert all(q["code_challenge_method"] == ["S256"] and "nonce" in q for q in queries), "S256 and a nonce (L778)"
    assert any(all(flag.lower() in line for flag in COOKIE_FLAGS) for line in cookie_lines), (
        "the attempt is bound by an HttpOnly, SameSite=Lax cookie (L780)")

    first = sign_in(app_url, username, password, next_path="/bidder", stop=lambda url: "/auth/callback" in url)
    callback = first.landing
    with open_app(browser, app_url + "/") as page:
        reply = page.goto(callback)
        cookies = page.context.cookies()
    assert reply is not None and reply.status == 400, "another browser's callback answers 400 (L782)"
    stranger = Member(app_url, {c["name"]: c["value"] for c in cookies})
    err(stranger.get("/api/me"), 401, "signed_out", "the foreign browser holds no session after its callback (L782)")

    done = first.http.get(callback)
    assert done.status_code == 302, f"the starting browser's callback answers 302 (L441); got {done.status_code}"
    assert urlsplit(done.headers["location"]).path == "/bidder", "sign-in returns to the next path (L783)"
    assert ok(first.get("/api/me"), 200, "GET /api/me after sign-in")["registration"] is not None
    again = first.http.get(callback)
    assert again.status_code == 400, "a used state answers 400 (L782)"

    missing = Member(app_url).get("/auth/callback", params={"code": "probe"})
    assert missing.status_code == 400, "a callback with no state answers 400 (L782)"

    bad = Member(app_url)
    state = parse_qs(urlsplit(start_sign_in(bad).headers["location"]).query)["state"][0]
    failed = bad.get("/auth/callback", params={"code": "probe-not-a-code", "state": state})
    assert failed.status_code == 400, "a failed code exchange answers 400 (L782)"
    err(bad.get("/api/me"), 401, "signed_out", "a failed exchange sets no session (L782)")

    username, password = SEED_CONSIGNOR
    outsider = sign_in(app_url, username, password, next_path=FOREIGN_ORIGIN + "/steal",
                       stop=lambda url: "/auth/callback" in url)
    landed = outsider.http.get(outsider.landing)
    location = urlsplit(landed.headers.get("location", ""))
    assert landed.status_code == 302 and location.path == "/consign", (
        "a foreign next counts as no return path and lands on the role's address (L779, L783)")
    assert location.netloc in ("", urlsplit(app_url).netloc), "sign-in never redirects off the app (L779)"


API_OWNERS = {
    "bidder": "/api/bidder/dashboard",
    "consignor": "/api/consign/lots",
    "specialist": "/api/desk/lots?state=intake",
    "cashier": "/api/desk/invoices?status=issued",
    "admin": "/api/admin/registrations?status=pending",
}
DESK_OWNERS = {
    "bidder": "/bidder",
    "consignor": "/consign",
    "specialist": "/desk/specialist",
    "cashier": "/desk/cashier",
    "admin": "/desk/admin",
}


def test_role_gated_desks(browser: Browser, env: SimpleNamespace) -> None:
    members = {"bidder": new_bidder(env), "consignor": new_consignor(env),
               **{role: staff(env.base, role) for role in ("specialist", "cashier", "admin")}}
    for role, member in members.items():
        for owner, path in API_OWNERS.items():
            response = member.get(path)
            if owner == role:
                ok(response, 200, f"{role} GET {path}")
            else:
                err(response, 403, "forbidden", f"{role} GET {path} (L390)")
        for owner, path in DESK_OWNERS.items():
            status = member.get(path).status_code
            if owner == role:
                assert status == 200, f"{role} GET {path} answers {status}"
            elif owner == "bidder":
                assert status in (302, 303, 307, 403), f"{role} GET {path} never shows another role's dashboard: {status}"
            else:
                assert status == 403, f"{role} GET {path} answers {status}: another role's desk is 403 (L115)"
    anonymous = Member(env.base)
    for path in API_OWNERS.values():
        err(anonymous.get(path), 401, "signed_out", f"signed-out GET {path} (L389)")
    for path in DESK_OWNERS.values():
        response = anonymous.get(path)
        target = urlsplit(response.headers.get("location", ""))
        assert response.status_code in (302, 303, 307) and target.path == "/auth/login", (
            f"signed-out {path} redirects to the sign-in start (L115)")
        assert parse_qs(target.query).get("next") == [path], f"{path} is the return path (L115)"
    err(members["consignor"].get(f"/api/bidder/invoices/{GUESS_ID}"), 403, "forbidden",
        "403 comes before 404 in the error order (L390-L391)")
    current = ok(httpx.get(f"{env.base}/api/sales/current", timeout=HTTP_TIMEOUT), 200, "GET /api/sales/current")
    lots = ok(httpx.get(f"{env.base}/api/sales/{current['sale']['id']}/catalogue", timeout=HTTP_TIMEOUT), 200,
              "GET catalogue")["lots"]
    err(bid(members["consignor"], lots[0]["id"], CEILING), 403, "forbidden", "bids belong to the bidder role (L402)")
    with view(browser, env.base, "/desk/admin", members["bidder"]) as page:
        wait_text(page, "NOT YOUR DESK", "another role's desk shows the not-your-desk page (L318)")
        wait_text(page, "This desk belongs to another role.", "the not-your-desk sentence (L318)")


def test_wf_register_and_sign_in_bidder(browser: Browser, env: SimpleNamespace) -> None:
    person = new_person(env.base, "visitor")
    assert urlsplit(str(person.landing.url)).path == "/register", "a new person returns to /register (L27, L783)"
    assert Keycloak().users(person.username), "the account exists in Keycloak (L27)"
    full_name = f"Visitor {person.username}"[:TITLE_MAX]
    with view(browser, env.base, "/register", person) as page:
        check(page.get_by_role("radio", name="Bid", exact=True))
        fill(page.get_by_role("textbox", name="Full name"), full_name)
        fill(page.get_by_role("textbox", name="Phone"), PHONE)
        fill(page.get_by_role("textbox", name="Address"), ADDRESS)
        click(page.get_by_role("button", name="Register"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"^[^?#]*/bidder/?(\?.*)?$"), timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        for target in (page, page.context.new_page()):
            if target is not page:
                target.goto(env.base + "/bidder")
            else:
                target.reload()
            eventually(target.get_by_role("region", name="Spending limit"), lambda: expect(target.get_by_role("region", name="Spending limit")).to_contain_text("Limit pending approval", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            eventually(target.get_by_role("heading", level=1), lambda: expect(target.get_by_role("heading", level=1)).to_have_text("YOUR SALEROOM", use_inner_text=True, timeout=EVENTUALLY_POLL_MS), UI_S)
    me = ok(person.get("/api/me"), 200, "GET /api/me")
    assert "bidder" in me["roles"], "registration gives the realm role bidder (L708)"
    assert me["registration"]["role"] == "bidder" and me["registration"]["status"] == "pending"
    assert me["registration"]["paddle"] is None, "a pending bidder has no paddle (L447)"


def test_spending_limit_approval(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    first = new_person(env.base, "bidder")
    reg = register(first, "bidder")["registration"]
    assert reg["status"] == "pending" and reg["paddle"] is None and reg["spending_limit"] is None
    err(bid(first, lot_id, SPEC_A["opening"]), 409, "registration_pending", "a pending bidder cannot bid (L465)")
    admin = staff(env.base, "admin")
    pending = ok(admin.get("/api/admin/registrations?status=pending"), 200, "pending list")["registrations"]
    assert reg["id"] in [p["id"] for p in pending], "the new bidder waits for approval (L450)"
    path = f"/api/admin/registrations/{reg['id']}/approve"
    for limit in (LIMIT_LOW - 1, LIMIT_TOP + 1):
        body = err(admin.post(path, {"spending_limit": limit}), 422, "invalid", f"limit {limit} (L451)")
        assert APPROVAL_ERROR in body.get("fields", {}).values(), "the approval error sentence (L362)"
    sentence = f"Your spending limit of {euros(LIMIT_3000)} is approved. You can bid now."
    with view(browser, env.base, "/bidder", first) as page:
        shows(page.get_by_role("region", name="Spending limit"), "Limit pending approval")
        listen(page)
        approved = approve(env, first, LIMIT_3000)
        wait_said(page, sentence)
        advance(page, 2000)
        assert said_count(page, sentence) == 1, f"the approval notice is announced once (L307): {said(page)}"
        page.reload()
        shows(page.get_by_role("region", name="Spending limit"),
              f"Spending limit {euros(LIMIT_3000)} · {euros(0)} committed")
        eventually(page.get_by_role("heading", level=1), lambda: expect(page.get_by_role("heading", level=1)).to_have_text(f"PADDLE {approved['paddle']}", use_inner_text=True, timeout=EVENTUALLY_POLL_MS), UI_S)
    assert approved["status"] == "active" and approved["spending_limit"] == LIMIT_3000
    assert isinstance(approved["paddle"], int) and approved["paddle"] >= FIRST_PADDLE, "paddles from 101 (L701)"
    second = new_person(env.base, "bidder")
    register(second, "bidder")
    assert approve(env, second, LIMIT_LOW)["paddle"] > approved["paddle"], "the next paddle is newer (L701)"
    err(admin.post(path, {"spending_limit": LIMIT_3000}), 409, "invalid_transition", "approve twice (L452)")
    pending = ok(admin.get("/api/admin/registrations?status=pending"), 200, "pending list")["registrations"]
    assert reg["id"] not in [p["id"] for p in pending], "an approved bidder leaves the pending list"
    dash = dashboard(first)
    assert (dash["paddle"], dash["spending_limit"], dash["committed"]) == (approved["paddle"], LIMIT_3000, 0)
    assert texts(first).count(sentence) == 1, "exactly one limit_approved notice (L693)"
    ok(bid(first, lot_id, SPEC_A["opening"]), 201, "an approved bidder bids (L59)")


def test_wf_register_and_sign_in_outage(browser: Browser, env: SimpleNamespace, down_url: str) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    bidder = new_bidder(env)
    remote = bidder.on(down_url)
    ok(remote.get("/api/me"), 200, "an existing session works on the outage copy (L710)")
    ok(bid(remote, sale.ids[0], SPEC_A["opening"]), 201, "bidding continues during the outage (L67)")
    assert public_lot(env, sale.ids[0])["bid_count"] == 1, "the outage bid is recorded"
    ok(staff(env.base, "specialist").on(down_url).get(DESK_ESTIMATED), 200,
       "the specialist desk works during the outage (L67)")
    started = time.monotonic()
    login = httpx.get(f"{down_url}/auth/login", timeout=HTTP_TIMEOUT)
    assert time.monotonic() - started < LOGIN_OUTAGE_S, "the 503 sign-in page answers within three seconds (L710)"
    assert login.status_code == 503, f"GET /auth/login answers 503 during the outage (L440); got {login.status_code}"
    health = httpx.get(f"{down_url}/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "ok"}, "health stays ok (L549)"
    fresh = new_person(env.base, "visitor")
    response = fresh.on(down_url).post("/api/register", {"role": "bidder", "full_name": "Visitor probe",
                                                         "phone": PHONE, "address": ADDRESS})
    err(response, 503, "sign_in_unavailable", "registration during the outage (L449)")
    assert ok(fresh.get("/api/me"), 200, "GET /api/me")["registration"] is None, "nothing was registered"
    with open_app(browser, down_url + "/") as page:
        answer = page.goto(down_url + "/auth/login")
        assert answer is not None and answer.status == 503
        eventually(page.get_by_role("alert").filter(has_text=OUTAGE_BANNER), lambda: expect(page.get_by_role("alert").filter(has_text=OUTAGE_BANNER)).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)


def test_wf_consign_a_lot_intake(browser: Browser, env: SimpleNamespace) -> None:
    consignor = new_consignor(env)
    title = f"Chronograph {slug(unique('lot')[0])}"
    with view(browser, env.base, "/consign", consignor) as page:
        click(page.get_by_role("link", name="Offer a lot"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/consign/new/?$"), timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        check(page.get_by_role("radio", name="Wristwatch"))
        fill(page.get_by_role("textbox", name="Title"), title)
        fill(page.get_by_role("textbox", name="Description"), DESCRIPTION)
        click(page.get_by_role("button", name="Submit for estimate"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"^[^?#]*/consign/?$"), timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        for _ in range(2):
            row = page.get_by_role("table", name="Your lots").get_by_role("row").filter(has_text=title)
            eventually(row, lambda: expect(row).to_contain_text("Intake", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            page.reload()
    lots = ok(consignor.get("/api/consign/lots"), 200, "GET /api/consign/lots")["lots"]
    mine = [lot for lot in lots if lot["title"] == title]
    assert len(mine) == 1 and mine[0]["state"] == "intake" and mine[0]["category"] == "wristwatch"


def test_wf_consign_a_lot_empty_desk(browser: Browser, env: SimpleNamespace) -> None:
    consignor = new_consignor(env)
    assert ok(consignor.get("/api/consign/lots"), 200, "GET /api/consign/lots")["lots"] == []
    with view(browser, env.base, "/consign", consignor) as page:
        eventually(page.get_by_role("heading", level=1, name="YOUR CONSIGNMENTS"), lambda: expect(page.get_by_role("heading", level=1, name="YOUR CONSIGNMENTS")).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        wait_text(page, "NOTHING CONSIGNED YET", "the empty desk line (L339)")
        wait_text(page, "Offer a watch or camera and our specialist will estimate it within the week.",
                  "the empty desk sentence (L339)")
        title = f"Rangefinder {slug(unique('lot')[0])}"
        consign_lot(consignor, title, "camera")
        page.reload()
        eventually(page.get_by_role("table", name="Your lots"), lambda: expect(page.get_by_role("table", name="Your lots")).to_contain_text(title, timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        assert "NOTHING CONSIGNED YET" not in body_text(page), "the empty state is gone once a lot exists"


def test_owner_only_records(short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [HAMMER_1250, SPEC_A], SHORT_LEAD)
    sold_id, unsold_id = sale.ids
    owner, other = new_bidder(env), new_bidder(env)
    stranger = new_consignor(env)
    ok(bid(owner, sold_id, HAMMER_1250["opening"]), 201, "owner bids on the sold lot")
    ok(bid(owner, unsold_id, 1700), 201, "owner bids below the reserve")
    wait_closed(env, sale.ids)
    invoice = wait_invoice(owner, sale.id)
    offer = ok(sale.consignor.post(f"/api/consign/lots/{unsold_id}/second-chance", {"amount": 1700}), 201,
               "second-chance offer")["offer"]
    for path, method in ((f"/api/bidder/invoices/{invoice['id']}", "GET"),
                         (f"/api/bidder/offers/{offer['id']}/accept", "POST"),
                         (f"/api/bidder/offers/{offer['id']}/decline", "POST"),
                         (f"/api/bidder/invoices/{GUESS_ID}", "GET")):
        response = other.get(path) if method == "GET" else other.post(path)
        err(response, 404, "not_found", f"another bidder {method} {path} (L391)")
    assert open_offer(owner, unsold_id) is not None, "the owner's offer is still open after the foreign attempts"
    for path, method in ((f"/api/consign/lots/{sold_id}", "GET"),
                         (f"/api/consign/lots/{unsold_id}/second-chance", "POST"),
                         (f"/api/consign/lots/{unsold_id}/leave-unsold", "POST"),
                         (f"/api/consign/lots/{GUESS_ID}", "GET")):
        response = stranger.get(path) if method == "GET" else stranger.post(path, {"amount": 1700})
        err(response, 404, "not_found", f"another consignor {method} {path} (L391)")
    statement = sale_statement(env, sale.id)
    ok(staff(env.base, "admin").post(f"/api/admin/statements/{statement['id']}/issue"), 200, "issue statement")
    err(stranger.get(f"/api/consign/statements/{statement['id']}"), 404, "not_found", "foreign statement (L491)")
    ok(sale.consignor.get(f"/api/consign/statements/{statement['id']}"), 200, "own statement")
    ok(owner.get(f"/api/bidder/invoices/{invoice['id']}"), 200, "own invoice")


def test_consignor_view_without_bidders(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    a, b = new_bidder(env), new_bidder(env)
    with view(browser, env.base, f"/consign/lots/{lot_id}", sale.consignor) as page:
        page.evaluate(PROBE_JS)
        ok(bid(a, lot_id, 1700), 201, "first bid")
        ok(bid(b, lot_id, 1900), 201, "second bid")
        frames = probe_frames(page, lot_id, lambda f: f["lot"].get("price") == PRICE_1750,
                              "the consignor's socket carries the new price (L545)")
        for frame in frames:
            assert set(frame["lot"]) == CONSIGNOR_KEYS, f"consignor frame keys (L417): {sorted(frame['lot'])}"
            assert all(set(row) == HISTORY_CONSIGNOR for row in frame["history"]), "consignor rows (L423)"
        wait_text(page, "€1,750", "the consignor lot page shows the price live (L130)")
        text = body_text(page)
        for who in (a, b):
            assert f"Paddle {who.paddle}" not in text and who.full_name not in text, "no bidder on the page (L48)"
    body = ok(sale.consignor.get(f"/api/consign/lots/{lot_id}"), 200, "GET /api/consign/lots/<id>")
    assert set(body["lot"]) == CONSIGNOR_KEYS and body["lot"]["price"] == PRICE_1750 and body["lot"]["bid_count"] == 2
    assert len(body["history"]) == 2 and all(set(row) == HISTORY_CONSIGNOR for row in body["history"])
    listing = ok(sale.consignor.get("/api/consign/lots"), 200, "GET /api/consign/lots")
    for payload in (body, listing):
        assert not all_keys(payload) & {"paddle", "leader_paddle", "bidder_name"}, "no bidder keys (L48)"
        serialized = json.dumps(payload)
        for who in (a, b):
            assert who.full_name not in serialized and who.username not in serialized


ESTIMATE_CASES = [
    ({"estimate_low": "2400"}, {"estimate_low": AMOUNT_ERROR}),
    ({"estimate_low": 2400.5}, {"estimate_low": AMOUNT_ERROR}),
    ({"estimate_high": CEILING + 1}, {"estimate_high": AMOUNT_ERROR}),
    ({"opening_bid": 0}, {"opening_bid": AMOUNT_ERROR}),
    ({"reserve": None}, {"reserve": AMOUNT_ERROR}),
    ({"estimate_low": 3200, "estimate_high": 2400}, {"estimate_high": LOW_HIGH_ERROR}),
    ({"opening_bid": 3000}, {"opening_bid": OPENING_ERROR}),
    ({"opening_bid": 2300}, {"reserve": RESERVE_ERROR}),
    ({"reserve": 1200}, {"reserve": RESERVE_ERROR}),
    ({"reserve": 3000}, {"reserve": RESERVE_ERROR}),
    ({"condition": "x" * (CONDITION_MAX + 1)}, {"condition": CONDITION_ERROR}),
    ({"portrait": "sunburst"}, {"portrait": PORTRAIT_ERROR}),
    ({"estimate_high": 0, "reserve": 3000}, {"estimate_high": AMOUNT_ERROR, "reserve": RESERVE_ERROR}),
]


def test_specialist_estimate(env: SimpleNamespace) -> None:
    consignor = new_consignor(env)
    specialist = staff(env.base, "specialist")
    lot_id = consign_lot(consignor, f"Diver {slug(unique('lot')[0])}")
    valid = estimate_body(SPEC_A)
    for overrides, expected in ESTIMATE_CASES:
        body = {**valid, **overrides}
        body = {k: v for k, v in body.items() if v is not None}
        answer = err(specialist.put(f"/api/desk/lots/{lot_id}/estimate", body), 422, "invalid",
                     f"estimate with {list(overrides)}")
        assert answer.get("fields") == expected, f"fields for {list(overrides)}: {answer.get('fields')}"
    intake = ok(specialist.get("/api/desk/lots?state=intake"), 200, "intake list")["lots"]
    assert lot_id in [lot["id"] for lot in intake], "a refused estimate leaves the lot in intake (L51)"
    lot = estimate(specialist, lot_id, {**SPEC_A, "portrait": "diver"})
    assert set(lot) == STAFF_KEYS, f"staff projection keys (L418): {sorted(lot)}"
    assert lot["state"] == "estimated" and lot["reserve"] == SPEC_A["reserve"] and lot["portrait"] == "diver"
    assert (lot["estimate_low"], lot["estimate_high"], lot["opening_bid"]) == (
        SPEC_A["low"], SPEC_A["high"], SPEC_A["opening"])
    assert lot["consignor_name"] == consignor.full_name
    estimated = ok(specialist.get(DESK_ESTIMATED), 200, "estimated list")["lots"]
    assert lot_id in [row["id"] for row in estimated]
    estimate(specialist, lot_id, SPEC_A)


def test_wf_build_the_sale_publish(browser: Browser, env: SimpleNamespace) -> None:
    consignor = new_consignor(env)
    specialist = staff(env.base, "specialist")
    tag = slug(unique("lot")[0])
    first_title, second_title = f"Chronograph {tag} a", f"Bellows {tag} b"
    first_id = consign_lot(consignor, first_title)
    second_id = consign_lot(consignor, second_title, "camera")
    estimate(specialist, second_id, {**HAMMER_85, "portrait": "bellows"})
    local = datetime.fromtimestamp(db_now(env) + DAY_AHEAD, AMS).replace(second=0, microsecond=0) + timedelta(minutes=1)
    sale_title = f"WEEK {tag}"[:80]
    with view(browser, env.base, "/desk/specialist", specialist) as page:
        click(page.get_by_role("region", name="Intake").get_by_role("button", name=f"Estimate {first_title}"))
        form = page.get_by_role("region", name="Estimate")
        for name, value in (("Low estimate", str(SPEC_A["low"])), ("High estimate", str(SPEC_A["high"])),
                            ("Opening bid", str(SPEC_A["opening"])), ("Reserve", str(SPEC_A["reserve"])),
                            ("Condition notes", CONDITION)):
            fill(form.get_by_role("textbox", name=name), value)
        select(form.get_by_role("combobox", name="Portrait"), "Chronograph dial")
        click(form.get_by_role("button", name="Save estimate"))
        wait_text(page, f"Estimate saved for {first_title}.", "the estimate confirmation (L352)")
        order = page.get_by_role("region", name="Sale order")
        fill(order.get_by_role("textbox", name="Sale title"), sale_title)
        fill(order.get_by_role("textbox", name="Sale ends"), local.strftime("%Y-%m-%d %H:%M"))
        fill(order.get_by_role("textbox", name="First lot number"), str(FIRST_LOT))
        click(order.get_by_role("button", name="Create sale"))
        wait_text(page, f"Sale {sale_title} created.", "the sale confirmation (L354)")
        select(order.get_by_role("combobox", name="Sale"), sale_title)
        click(page.get_by_role("button", name=f"Add {first_title} to sale"))
        click(page.get_by_role("button", name=f"Add {second_title} to sale"))
        click(page.get_by_role("button", name=f"Move {second_title} up"))
        listed = order.get_by_role("list", name="Catalogue order")
        eventually(listed.get_by_role("listitem"), lambda: expect(listed.get_by_role("listitem")).to_have_count(2, timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        live(page, lambda: second_title in listed.get_by_role("listitem").nth(0).inner_text(), UI_S,
             f"{second_title} moves to the top of the catalogue order (L181)")
        click(order.get_by_role("button", name="Publish sale"))
        wait_text(page, "Sale published. 2 lots are open.", "the publish confirmation (L356)")
    sales = ok(specialist.get("/api/desk/sales"), 200, "GET /api/desk/sales")["sales"]
    sale = next(s for s in sales if s["title"] == sale_title)
    assert sale["state"] == "open" and abs(ts(sale["ends_at"]) - local.timestamp()) < 1, "ends_at is the typed time"
    assert public_lot(env, first_id)["portrait"] == "chronograph"
    lots = {lot_id: public_lot(env, lot_id) for lot_id in (second_id, first_id)}
    for index, lot_id in enumerate((second_id, first_id)):
        assert lots[lot_id]["lot_number"] == FIRST_LOT + index, "lots numbered in catalogue order (L592)"
        assert lots[lot_id]["status"] == "open"
        assert abs(ts(lots[lot_id]["closes_at"]) - (local.timestamp() + index * LOT_GAP)) < 1, (
            "lot k closes at the end plus k lot gaps (L592)")


def test_wf_build_the_sale_publish_errors(browser: Browser, env: SimpleNamespace) -> None:
    specialist = staff(env.base, "specialist")
    tag = slug(unique("sale")[0])
    sale_title = f"WEEK {tag}"[:80]
    with view(browser, env.base, "/desk/specialist", specialist) as page:
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if r.method == "POST" and "/api/desk/sales" in r.url else None)
        order = page.get_by_role("region", name="Sale order")
        fill(order.get_by_role("textbox", name="Sale title"), sale_title)
        fill(order.get_by_role("textbox", name="First lot number"), str(FIRST_LOT))
        for typed in ("12/11/2026 20:00", "2026-02-30 20:00"):
            fill(order.get_by_role("textbox", name="Sale ends"), typed)
            click(order.get_by_role("button", name="Create sale"))
            wait_text(page, SALE_ENDS_ERROR, f"the Sale ends error for {typed!r} (L355)")
        assert not sent, "nothing is sent for an invalid end (L355)"
    titles = [s["title"] for s in ok(specialist.get("/api/desk/sales"), 200, "sales")["sales"]]
    assert sale_title not in titles
    consignor = new_consignor(env)
    lot_id = consign_lot(consignor, f"Diver {tag}")
    estimate(specialist, lot_id, SPEC_A)
    past = create_sale(specialist, f"PAST {tag}"[:80], math.floor(db_now(env)) - LOT_GAP)
    ok(specialist.put(f"/api/desk/sales/{past['id']}/lots", {"lot_ids": [lot_id]}), 200, "place lot")
    body = err(specialist.post(f"/api/desk/sales/{past['id']}/publish"), 422, "invalid", "publish a past sale")
    assert body["fields"].get("ends_at") == FUTURE_ERROR, "the end is judged on the server's time (L357)"
    empty = create_sale(specialist, f"EMPTY {tag}"[:80], db_now(env) + DAY_AHEAD)
    body = err(specialist.post(f"/api/desk/sales/{empty['id']}/publish"), 422, "invalid", "publish an empty sale")
    assert body["fields"].get("lots") == NO_LOTS_ERROR
    states = {s["id"]: s["state"] for s in ok(specialist.get("/api/desk/sales"), 200, "sales")["sales"]}
    assert states[past["id"]] == "draft" and states[empty["id"]] == "draft", "refused publishes change nothing"
    hidden = httpx.get(f"{env.base}/api/sales/{past['id']}/catalogue", timeout=HTTP_TIMEOUT)
    assert hidden.status_code == 404, "a draft sale is unknown to the public (L391)"


def test_lot_state_guards(env: SimpleNamespace) -> None:
    consignor = new_consignor(env)
    specialist = staff(env.base, "specialist")
    tag = slug(unique("lot")[0])
    intake_id = consign_lot(consignor, f"Intake {tag}")
    placed_id, spare_id = consign_lot(consignor, f"Placed {tag}"), consign_lot(consignor, f"Spare {tag}")
    for lot_id in (placed_id, spare_id):
        estimate(specialist, lot_id, SPEC_A)
    ends = db_now(env) + DAY_AHEAD
    first = create_sale(specialist, f"ONE {tag}"[:80], ends)
    second = create_sale(specialist, f"TWO {tag}"[:80], ends)
    ok(specialist.put(f"/api/desk/sales/{first['id']}/lots", {"lot_ids": [placed_id]}), 200, "place lot")
    for lot_ids in ([placed_id], [intake_id]):
        err(specialist.put(f"/api/desk/sales/{second['id']}/lots", {"lot_ids": lot_ids}), 409,
            "invalid_transition", f"place {lot_ids} (L511)")
    ok(specialist.put(f"/api/desk/sales/{second['id']}/lots", {"lot_ids": [spare_id]}), 200, "place spare")
    ok(specialist.put(f"/api/desk/sales/{second['id']}/lots", {"lot_ids": []}), 200, "remove spare (L571)")
    estimated = [l["id"] for l in ok(specialist.get(DESK_ESTIMATED), 200, "list")["lots"]]
    assert spare_id in estimated, "a lot removed from a draft order goes back to estimated (L571)"
    ok(specialist.post(f"/api/desk/sales/{first['id']}/publish"), 200, "publish")
    err(specialist.post(f"/api/desk/sales/{first['id']}/publish"), 409, "sale_published", "publish twice (L514)")
    err(specialist.put(f"/api/desk/sales/{first['id']}/lots", {"lot_ids": [spare_id]}), 409, "sale_published",
        "reorder a published sale (L511)")
    err(specialist.put(f"/api/desk/lots/{placed_id}/estimate", estimate_body(SPEC_1400)), 409,
        "invalid_transition", "estimate an open lot (L508)")
    for path in ("second-chance", "leave-unsold"):
        err(consignor.post(f"/api/consign/lots/{placed_id}/{path}", {"amount": SPEC_A["opening"]}), 409,
            "invalid_transition", f"{path} on an open lot (L487, L489)")
    lot = public_lot(env, placed_id)
    assert lot["status"] == "open" and lot["opening_bid"] == SPEC_A["opening"], "the open lot is unchanged"
    intake = [l["id"] for l in ok(specialist.get("/api/desk/lots?state=intake"), 200, "list")["lots"]]
    assert intake_id in intake, "the intake lot stays in intake"


def test_specialist_desk_layouts(browser: Browser, env: SimpleNamespace) -> None:
    specialist = staff(env.base, "specialist")
    cases = [(PHONE_SIZE, 1), (BELOW_TABLET, 1), (TABLET_SIZE, 2), (TABLET_TOP, 2), (WIDE_EDGE, 3), (WIDE_SIZE, 3)]
    with view(browser, env.base, "/desk/specialist", specialist) as page:
        for size, columns in cases:
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.reload()
            regions = [page.get_by_role("region", name=n) for n in ("Intake", "Estimate", "Sale order")]
            for region in regions:
                eventually(region, lambda: expect(region).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            intake, form, order = [r.bounding_box() for r in regions]
            bottom = lambda box: box["y"] + box["height"]
            right = lambda box: box["x"] + box["width"]
            where = f"at {size[0]}px"
            if columns == 1:
                assert form["y"] >= bottom(intake) - 1 and order["y"] >= bottom(form) - 1, f"one column {where}"
            elif columns == 2:
                assert form["x"] >= right(intake) - 1 and form["y"] < bottom(intake), f"Intake beside Estimate {where}"
                assert order["y"] >= max(bottom(intake), bottom(form)) - 1, f"Sale order below {where}"
                assert order["width"] >= right(form) - intake["x"] - 2, f"Sale order spans the width {where}"
            else:
                assert form["x"] >= right(intake) - 1 and order["x"] >= right(form) - 1, f"three across {where}"
                assert form["y"] < bottom(intake) and order["y"] < bottom(form), f"side by side {where}"


def test_catalogue_first_load(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A, SPEC_A, SPEC_A], SHORT_LEAD)
    a, b = new_bidder(env), new_bidder(env)
    ok(bid(a, sale.ids[1], 1700), 201, "first bid")
    ok(bid(b, sale.ids[1], 1900), 201, "second bid")
    url = f"{env.base}/api/sales/{sale.id}/catalogue"
    body = ok(httpx.get(url, timeout=HTTP_TIMEOUT), 200, "GET catalogue")
    assert isinstance(body["seq"], int), "the catalogue carries a seq (L457)"
    assert [lot["id"] for lot in body["lots"]] == sale.ids, "open lots soonest-closing first (L120)"
    detail = public_view(env, sale.ids[1])
    assert isinstance(detail["seq"], int)
    assert [row["price_after"] for row in detail["history"]] == [PRICE_1750, OPEN_A], "full history newest first (L458)"
    assert ts(detail["history"][0]["accepted_at"]) >= ts(detail["history"][1]["accepted_at"])
    wait_db(env, sale.ends + CLOSE_GRACE, "the first lot's close passes on the server clock")
    body = ok(httpx.get(url, timeout=HTTP_TIMEOUT), 200, "GET catalogue")
    assert [lot["id"] for lot in body["lots"]] == [sale.ids[1], sale.ids[2], sale.ids[0]], (
        "closed lots follow the open ones (L120)")
    with view(browser, env.base, f"/catalogue/{sale.id}") as page:
        cells = page.get_by_role("grid", name="Catalogue").get_by_role("gridcell")
        drawn = live(page, cells.count, UI_S, "the catalogue grid draws")
        assert drawn == 3, f"the grid is complete on its first draw (L15, L796): {drawn} of 3 tiles"


def test_wf_browse_catalogue_keyboard(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A] * 4, SHORT_LEAD)
    names = [f"Lot {lot['lot_number']}, {lot['title']}" for lot in sale.lots]
    rival = new_bidder(env)
    with view(browser, env.base, f"/catalogue/{sale.id}") as page:
        grid = page.get_by_role("grid", name="Catalogue")
        eventually(grid.get_by_role("gridcell"), lambda: expect(grid.get_by_role("gridcell")).to_have_count(4, timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        for _ in range(12):
            if grid.evaluate("g => g.contains(document.activeElement)"):
                break
            page.keyboard.press("Tab")
        assert focused_cell(grid, names) == names[0], "Tab enters the grid on the first tile (L192)"
        for key, expected in (("ArrowRight", 1), ("ArrowLeft", 0), ("End", 3), ("Home", 0), ("ArrowDown", 3),
                              ("ArrowUp", 0)):
            page.keyboard.press(key)
            assert focused_cell(grid, names) == names[expected], f"{key} moves to tile {expected} (L192)"
        wait_remaining(env, sale.ids[0], SHORT_GAP - 1, "lot one enters the last lot gap")
        ok(bid(rival, sale.ids[0], SPEC_A["opening"]), 201, "a late bid extends lot one")
        live(page, lambda: grid_order(grid, names).index(names[0]) == 1, (LIVE_MS + VIEW_SLACK_MS) / 1000 + SLACK_S,
             "the extension moves lot one after lot two in the grid (L192)")
        assert focused_cell(grid, names) == names[0], "focus stays on the moved lot (L192)"
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(page).to_have_url(re.compile(rf"/lots/{re.escape(sale.ids[0])}$"), timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)


def test_catalogue_layouts(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A] * 6, DAY_AHEAD)
    cases = [(PHONE_SIZE, 1), (BELOW_TABLET, 1), (TABLET_SIZE, 2), (TABLET_TOP, 2), (WIDE_EDGE, 3), (WIDE_SIZE, 3)]
    with view(browser, env.base, f"/catalogue/{sale.id}") as page:
        grid = page.get_by_role("grid", name="Catalogue")
        for size, columns in cases:
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.reload()
            eventually(grid.get_by_role("gridcell"), lambda: expect(grid.get_by_role("gridcell")).to_have_count(6, timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            page.evaluate("() => window.scrollTo(0, 0)")
            boxes = [grid.get_by_role("gridcell").nth(i).bounding_box() for i in range(6)]
            top = boxes[0]["y"]
            row = {round(box["x"]) for box in boxes if abs(box["y"] - top) < 2}
            assert len(row) == columns, f"{columns} tile columns at {size[0]}px; got {len(row)} (L121-L123)"
            title = page.get_by_role("heading", level=1).bounding_box()
            if columns < 3:
                assert title["y"] + title["height"] <= top + 1, f"the title band sits above the tiles at {size[0]}px"
            else:
                assert title["x"] + title["width"] <= grid.bounding_box()["x"] + 1, "the title sits beside (L123)"


def test_wf_browse_catalogue_phone(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    bidder = new_bidder(env)
    for path, member in (("/", None), (f"/catalogue/{sale.id}", None), (f"/lots/{sale.ids[0]}", bidder)):
        with view(browser, env.base, path, member, size=PHONE_SIZE) as page:
            eventually(page.get_by_role("heading", level=1), lambda: expect(page.get_by_role("heading", level=1)).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            if member is not None:
                eventually(place_button(page), lambda: expect(place_button(page)).to_be_enabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            phone_layout(page)
            small = small_controls(page)
            assert not small, f"controls under 44x44 on {path} (L18, L205): {small}"


BANDS = [90, 100, 450, 500, 900, 1000, 4999, 5000]


def test_increment_table(env: SimpleNamespace) -> None:
    sale = make_sale(env, [dict(low=p, high=p, opening=p, reserve=p) for p in BANDS], DAY_AHEAD)
    a, b = new_bidder(env), new_bidder(env)
    for lot, opening in zip(sale.lots, BANDS):
        assert lot["price"] is None and lot["asking"] == opening, "asking is the opening bid before any bid (L604)"
        first = ok(bid(a, lot["id"], opening), 201, f"opening bid {opening}")["lot"]
        assert first["price"] == opening and first["asking"] == opening + increment(opening), f"band {opening}"
        err(bid(b, lot["id"], opening, kind="single"), 409, "asking_changed", "a stale single bid (L467)")
        second = ok(bid(b, lot["id"], first["asking"], kind="single"), 201, "single bid at the next bid")["lot"]
        assert second["price"] == first["asking"], "a single bid is a maximum at the next bid (L608)"
        assert second["asking"] == second["price"] + increment(second["price"]), f"band after {opening} (L604)"


def test_maximum_bidding(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A, SPEC_A, SPEC_A], DAY_AHEAD)
    worked, tie, capped = sale.ids
    a, b = new_bidder(env), new_bidder(env)
    lot = lambda who, lot_id: ok(who.get(f"/api/lots/{lot_id}"), 200, "GET lot")["lot"]
    ok(bid(a, worked, 1700), 201, "A 1700")
    after = ok(bid(b, worked, 1900), 201, "B 1900")["lot"]
    assert after["price"] == PRICE_1750 and after["leader_paddle"] == b.paddle, "B leads at 1,750 (L621)"
    after = ok(bid(a, worked, 2100), 201, "A 2100")["lot"]
    assert after["price"] == PRICE_1950 and after["leader_paddle"] == a.paddle, "A leads at 1,950 (L621)"
    after = ok(bid(b, worked, 2300), 201, "B 2300")["lot"]
    assert after["price"] == RESERVE_A and after["leader_paddle"] == b.paddle, "B leads at 2,200 (L621)"
    raised = ok(bid(b, worked, 2450), 201, "B raises")["lot"]
    assert raised["price"] == RESERVE_A and raised["my_max"] == MAX_2450, "raising your own lead never raises the price (L59)"
    body = err(bid(b, worked, 2450), 422, "invalid", "leader repeats the maximum")
    assert body["fields"]["max_amount"] == f"Enter more than your maximum of {euros(MAX_2450)}."
    body = err(bid(a, worked, 2200), 422, "invalid", "below the next bid")
    assert body["fields"]["max_amount"] == f"Enter at least {euros(RESERVE_A + increment(RESERVE_A))}."
    for value, sentence in ((str(MAX_1700), WHOLE_ERROR), (0, WHOLE_ERROR), (CEILING + 1, CEILING_ERROR)):
        body = err(bid(a, worked, value), 422, "invalid", f"max_amount {value!r}")
        assert body["fields"]["max_amount"] == sentence, f"first failing check for {value!r} (L609)"
    assert lot(a, worked)["bid_count"] == 5, "refused bids add no row"
    n = sale.lots[1]["lot_number"]
    ok(bid(a, tie, 1900), 201, "A 1900 first")
    with ExitStack() as stack:
        first, second = [stack.enter_context(view(browser, env.base, f"/lots/{tie}", who)) for who in (a, b)]
        for page in (first, second):
            eventually(place_button(page), lambda: expect(place_button(page)).to_be_enabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        shows(board(first), "You lead")
        listen(first)
        check(second.get_by_role("radio", name="Maximum bid"))
        fill(second.get_by_role("textbox", name="Your maximum"), str(MAX_1900))
        attempt_bid(second)
        wait_text(second, f"Bid accepted, but an earlier maximum is higher. Lot {n} now {euros(MAX_1900)}.",
                  "B's equal maximum is accepted behind the earlier one (L283, L618)")
        shows(board(second), f"Paddle {a.paddle} leads")
        live_s = (LIVE_MS + VIEW_SLACK_MS) / 1000
        shows(board(first), f"Next bid {euros(MAX_1900 + increment(MAX_1900))}", live_s)
        shows(board(first), "You lead", live_s)
        wait_said(first, f"Lot {n} now {euros(MAX_1900)}, you lead.")
        advance(first, 2000)
        assert said_count(first, f"Lot {n} now {euros(MAX_1900)}, you lead.") == 1, f"announced once: {said(first)}"
        assert said_count(first, "outbid") == 0, "an equal later maximum never outbids the earlier one (L618)"
    tied = lot(b, tie)
    assert tied["leader_paddle"] == a.paddle and tied["price"] == MAX_1900 and tied["i_lead"] is False, (
        "equal maximums go to the earlier bid, at that maximum (L618)")
    ok(bid(a, capped, 1700), 201, "A 1700")
    over = ok(bid(b, capped, 1720), 201, "B just over A")["lot"]
    assert over["price"] == over["my_max"] and over["leader_paddle"] == b.paddle, "never more than the leader's own (L617)"


def test_reserve_rule(env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    a, b = new_bidder(env), new_bidder(env)
    first = ok(bid(a, lot_id, 1700), 201, "A 1700")["lot"]
    assert first["price"] == OPEN_A and first["reserve_met"] is False
    second = ok(bid(b, lot_id, 1900), 201, "B 1900")["lot"]
    assert second["price"] == PRICE_1750 and second["reserve_met"] is False
    raised = ok(bid(b, lot_id, 2200), 201, "B raises to the reserve")["lot"]
    assert raised["price"] == RESERVE_A and raised["reserve_met"] is True, "the price jumps to the reserve (L621)"
    assert public_lot(env, lot_id)["reserve_met"] is True
    bid_id = removable_bid(env, lot_id, b, 2200)
    ok(staff(env.base, "admin").post(f"/api/admin/bids/{bid_id}/remove", {"reason": REASON}), 200, "remove raise")
    after = public_lot(env, lot_id)
    assert after["reserve_met"] is False and after["price"] == PRICE_1750, "reserve_met only while the maximum reaches it"


def test_spending_limit_concurrency(env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A, SPEC_A, SPEC_1400, SPEC_A], DAY_AHEAD)
    one, two, three, four = sale.ids
    sentence = f"This bid would take you past your spending limit of {euros(LIMIT_3000)}."
    solo = new_bidder(env, LIMIT_3000)
    ok(bid(solo, one, 1600), 201, "1,600 of 3,000")
    ok(bid(solo, three, 1400), 201, "exactly 3,000 is allowed (L623)")
    for lot_id, value in ((four, 1600), (one, 1700)):
        body = err(bid(solo, lot_id, value), 422, "invalid", f"bid {value} past the limit")
        assert body["fields"]["max_amount"] == sentence
    assert public_lot(env, four)["bid_count"] == 0, "a refused bid adds nothing"
    assert dashboard(solo)["committed"] == LIMIT_3000
    pair = new_bidder(env, LIMIT_3000)
    results = together(partial(bid, pair, two, 1600), partial(bid, pair, four, 1600))
    statuses = sorted(r.status_code for r in results)
    assert statuses == [201, 422], f"exactly one of two simultaneous bids is accepted (L623): {statuses}"
    loser = next(r for r in results if r.status_code == 422).json()
    assert loser["fields"]["max_amount"] == sentence
    assert public_lot(env, two)["bid_count"] + public_lot(env, four)["bid_count"] == 1
    assert dashboard(pair)["committed"] == OPEN_A


def test_one_bid_per_key(env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    a, b = new_bidder(env), new_bidder(env)
    key = idempotency_key()
    results = together(*[partial(bid, a, lot_id, 1700, "maximum", key) for _ in range(5)])
    assert {r.status_code for r in results} == {201}, f"every copy gets the original 201: {[r.status_code for r in results]}"
    bodies = [r.json() for r in results]
    assert all(body == bodies[0] for body in bodies), "every copy gets the original body (L628)"
    replay = bid(a, lot_id, 1700, key=key)
    assert replay.status_code == 201 and replay.json() == bodies[0], "a later retry gets the stored response"
    err(bid(a, lot_id, 1800, key=key), 409, "idempotency_key_reused", "same key, different body (L629)")
    missing = a.post(f"/api/lots/{lot_id}/bids", {"type": "maximum", "max_amount": 1800})
    err(missing, 400, "idempotency_key_required", "a bid without a key (L392)")
    detail = public_view(env, lot_id)
    assert detail["lot"]["bid_count"] == 1 and len(detail["history"]) == 1, "one bid and one history row"
    ok(bid(b, lot_id, 1900, key=key), 201, "keys are scoped to the bidder (L464)")


def test_wf_place_bids_keyboard(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot = sale.lots[0]
    bidder = new_bidder(env)
    with view(browser, env.base, f"/lots/{lot['id']}", bidder) as page:
        place = place_button(page)
        eventually(place, lambda: expect(place).to_be_enabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        names = tab_order(page, 6)
        assert names[:3] == ["Gavelhouse", "Sign out", "Watch lot"], f"Tab order (L193): {names}"
        assert names[3] in ("Bid now", "Maximum bid") and names[4:6] == ["Your maximum", "Place bid"], names
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Shift+Tab")
        now_radio = page.get_by_role("radio", name="Bid now")
        max_radio = page.get_by_role("radio", name="Maximum bid")
        field = page.get_by_role("textbox", name="Your maximum")
        for target in (now_radio, max_radio):
            for _ in range(3):
                if target.is_checked():
                    break
                page.keyboard.press("ArrowRight")
            assert target.is_checked(), "arrow keys move between the bid types (L194)"
            if target is now_radio:
                eventually(field, lambda: expect(field).not_to_be_editable(timeout=EVENTUALLY_POLL_MS), UI_S)
                assert str(OPEN_A) in re.sub(r"\D", "", field.input_value()), "Bid now shows the next bid (L195)"
        page.keyboard.press("Tab")
        eventually(field, lambda: expect(field).to_be_focused(timeout=EVENTUALLY_POLL_MS), UI_S)
        page.keyboard.press("ControlOrMeta+A")
        page.keyboard.type(str(MAX_1700))
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Confirm your bid")
        confirm, cancel = dialog.get_by_role("button", name="Confirm bid"), dialog.get_by_role("button", name="Cancel")
        eventually(dialog, lambda: expect(dialog).to_contain_text(f"Bid {euros(MAX_1700)} as your maximum on lot {lot['lot_number']}?", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        eventually(confirm, lambda: expect(confirm).to_be_focused(timeout=EVENTUALLY_POLL_MS), UI_S)
        for key, target in (("Tab", cancel), ("Tab", confirm), ("Shift+Tab", cancel), ("Shift+Tab", confirm)):
            page.keyboard.press(key)
            eventually(target, lambda: expect(target).to_be_focused(timeout=EVENTUALLY_POLL_MS), UI_S)
        page.keyboard.press("Escape")
        advance(page, DIALOG_FADE_MS * 2)
        eventually(dialog, lambda: expect(dialog).to_be_hidden(timeout=EVENTUALLY_POLL_MS), UI_S)
        eventually(place, lambda: expect(place).to_be_focused(timeout=EVENTUALLY_POLL_MS), UI_S)
        page.keyboard.press("Enter")
        eventually(confirm, lambda: expect(confirm).to_be_focused(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        advance(page, DIALOG_FADE_MS * 2)
        eventually(dialog, lambda: expect(dialog).to_be_hidden(timeout=EVENTUALLY_POLL_MS), UI_S)
        eventually(place, lambda: expect(place).to_be_focused(timeout=EVENTUALLY_POLL_MS), UI_S)
        assert public_lot(env, lot["id"])["bid_count"] == 0, "Escape and Cancel send no bid (L197)"
        page.keyboard.press("Enter")
        eventually(confirm, lambda: expect(confirm).to_be_focused(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        page.keyboard.press("Enter")
        wait_for(lambda: public_lot(env, lot["id"])["bid_count"] == 1, WAIT_S, "Confirm bid sends the bid (L197)")
        advance(page, DIALOG_FADE_MS * 2)
        eventually(place, lambda: expect(place).to_be_focused(timeout=EVENTUALLY_POLL_MS), UI_S)
    assert ok(bidder.get(f"/api/lots/{lot['id']}"), 200, "lot")["lot"]["my_max"] == MAX_1700


def test_wf_place_bids_draft(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot = sale.lots[0]
    bidder, rival = new_bidder(env), new_bidder(env)
    path = f"/lots/{lot['id']}"
    message = f"Enter at least {euros(1600)}."

    def draft_kept(page: Page) -> None:
        eventually(page.get_by_role("textbox", name="Your maximum"), lambda: expect(page.get_by_role("textbox", name="Your maximum")).to_have_value(str(MAX_1700), timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        eventually(page.get_by_role("radio", name="Maximum bid"), lambda: expect(page.get_by_role("radio", name="Maximum bid")).to_be_checked(timeout=EVENTUALLY_POLL_MS), UI_S)

    with view(browser, env.base, path, bidder) as page:
        eventually(place_button(page), lambda: expect(place_button(page)).to_be_enabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        check(page.get_by_role("radio", name="Maximum bid"))
        field = page.get_by_role("textbox", name="Your maximum")
        fill(field, "1550")
        attempt_bid(page)
        wait_text(page, message, "the below-the-next-bid error (L284)")
        fill(field, str(MAX_1700))
        ok(bid(rival, lot["id"], 1600), 201, "a rival bid repaints the board")
        shows(board(page), f"Next bid {euros(1650)}")
        advance(page, 3000)
        draft_kept(page)
        assert message in body_text(page), "repaints never replace the last bid message (L200)"
        page.reload()
        draft_kept(page)
        second = page.context.new_page()
        second.goto(env.base + path)
        draft_kept(second)
        page.goto(f"{env.base}/catalogue/{sale.id}")
        page.go_back()
        draft_kept(page)
    mine = ok(bidder.get(f"/api/lots/{lot['id']}"), 200, "lot")["lot"]
    assert mine["my_max"] is None and mine["bid_count"] == 1, "the draft was never sent"


def test_bidder_safe_fields(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    a, b, c = new_bidder(env), new_bidder(env), new_bidder(env)
    ok(bid(a, lot_id, 1700), 201, "A 1700")
    ok(bid(b, lot_id, 1900), 201, "B 1900")
    anon = public_view(env, lot_id)
    assert set(anon["lot"]) == PUBLIC_KEYS, f"public keys (L411): {sorted(anon['lot'])}"
    assert all(set(row) == HISTORY_PUBLIC for row in anon["history"]), "public history keys (L422)"
    mine = ok(a.get(f"/api/lots/{lot_id}"), 200, "bidder lot")
    assert set(mine["lot"]) == BIDDER_KEYS and mine["lot"]["my_max"] == MAX_1700 and mine["lot"]["i_lead"] is False
    assert mine["lot"]["leader_paddle"] == b.paddle
    catalogue = ok(a.get(f"/api/sales/{sale.id}/catalogue"), 200, "bidder catalogue")
    assert all(set(lot) == BIDDER_KEYS for lot in catalogue["lots"])
    leading = dashboard(b)["leading"]
    assert any(lot["id"] == lot_id and set(lot) == BIDDER_KEYS for lot in leading)
    for payload in (anon, mine, catalogue):
        assert "reserve" not in all_keys(payload), "never the reserve (L436)"
        assert "max_amount" not in all_keys(payload) and MAX_1900 not in all_numbers(payload), "no rival maximum (L436)"
        serialized = json.dumps(payload)
        for who in (a, b):
            assert who.full_name not in serialized and who.username not in serialized
    with ExitStack() as stack:
        pages = [stack.enter_context(view(browser, env.base, f"/lots/{lot_id}", member)) for member in (None, a)]
        for page in pages:
            page.evaluate(PROBE_JS)
        reply = ok(bid(c, lot_id, 2300), 201, "C 2300")
        assert set(reply["lot"]) == BIDDER_KEYS
        for page, keys in zip(pages, (PUBLIC_KEYS, BIDDER_KEYS)):
            frames = probe_frames(page, lot_id, lambda f: f["lot"].get("price") == RESERVE_A, "the new price frame (L545)")
            for frame in frames:
                assert set(frame["lot"]) == keys and all(set(r) == HISTORY_PUBLIC for r in frame["history"])
                assert "reserve" not in all_keys(frame) and MAX_2300 not in all_numbers(frame), "no reserve or rival max"


def test_wf_place_bids_happy(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot = sale.lots[0]
    bidder, rival = new_bidder(env), new_bidder(env)
    with view(browser, env.base, f"/catalogue/{sale.id}", bidder) as page:
        click(page.get_by_role("grid", name="Catalogue").get_by_role(
            "link", name=f"Lot {lot['lot_number']}, {lot['title']}"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(rf"/lots/{re.escape(lot['id'])}$"), timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        eventually(place_button(page), lambda: expect(place_button(page)).to_be_enabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        listen(page)
        check(page.get_by_role("radio", name="Maximum bid"))
        fill(page.get_by_role("textbox", name="Your maximum"), str(MAX_1700))
        attempt_bid(page)
        wait_text(page, f"Bid accepted. You lead at {euros(1600)}.", "the accepted message (L282)")
        shows(board(page), "You lead")
        history = page.get_by_role("table", name="Bid history")
        shows(history, str(bidder.paddle))
        shows(history, euros(1600))
        ok(bid(rival, lot["id"], 1900), 201, "rival outbids")
        wait_said(page, f"You have been outbid on lot {lot['lot_number']}.")
        shows(board(page), f"Paddle {rival.paddle} leads")
        shows(board(page), f"Next bid {euros(1800)}")
    mine = ok(bidder.get(f"/api/lots/{lot['id']}"), 200, "lot")["lot"]
    assert mine["my_max"] == MAX_1700 and mine["bid_count"] == 2 and mine["i_lead"] is False


def test_wf_soft_close_per_lot(short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A, SPEC_A], SHORT_LEAD)
    first, second = sale.ids
    a, b = new_bidder(env), new_bidder(env)
    early = ok(bid(a, first, 1700), 201, "early bid")["lot"]
    assert early["remaining_seconds"] > SHORT_SOFT, "setup left the lot outside its window"
    assert early["status"] == "open" and abs(ts(early["closes_at"]) - sale.ends) < 1, "an early bid moves nothing"
    wait_remaining(env, first, SHORT_SOFT - 2, "lot one enters its soft-close window")
    late = ok(bid(b, first, 1900), 201, "bid in the window")
    accepted = ts(late["bid"]["accepted_at"])
    assert late["lot"]["status"] == "extended", "the lot becomes extended (L634)"
    assert abs(ts(late["lot"]["closes_at"]) - (accepted + SHORT_SOFT)) <= 1, "close moves to bid + window (L634)"
    other = public_lot(env, second)
    assert abs(ts(other["closes_at"]) - (sale.ends + SHORT_GAP)) < 1 and other["status"] == "open", (
        "no other lot's close moves (L634)")


def test_wf_soft_close_edge(short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A], SHORT_LEAD)
    lot_id = sale.ids[0]
    a, b = new_bidder(env), new_bidder(env)
    before = ok(bid(a, lot_id, 1700), 201, "a bid before the close counts")
    closes = ts(before["lot"]["closes_at"])
    assert ts(before["bid"]["accepted_at"]) < closes
    wait_db(env, closes, "the lot's close passes on the server clock")
    body = err(bid(b, lot_id, 1900), 409, "lot_closed", "a bid at or after the close (L633)")
    assert body["lot"]["status"] in ("closed_sold", "closed_unsold") and body["lot"]["remaining_seconds"] == 0
    assert body["lot"]["status"] == "closed_unsold", "1,700 is below the 2,200 reserve (L640)"
    assert public_lot(env, lot_id)["bid_count"] == 1, "the late bid is not recorded"


def test_wf_soft_close_device_clock(browser: Browser, env: SimpleNamespace, short_env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    skew = timedelta(days=30)
    future = datetime.fromtimestamp(db_now(env), timezone.utc) + skew
    with view(browser, env.base, f"/lots/{sale.ids[0]}", device_time=future) as page:
        timer = page.get_by_role("timer", name="Time left")
        eventually(timer, lambda: expect(timer).to_contain_text("Closes in", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        shown = left_seconds(timer.inner_text())
        remaining = public_lot(env, sale.ids[0])["remaining_seconds"]
        assert tab_order(page, 3) == ["Gavelhouse", "Sign in", "Watch lot"], "keyboard reaches Watch lot (L193)"
        assert shown is not None and abs(shown - remaining) <= 10, f"time left follows the server: {shown} vs {remaining}"
        page.goto(f"{env.base}/catalogue/{sale.id}")
        eventually(page.get_by_role("grid", name="Catalogue"), lambda: expect(page.get_by_role("grid", name="Catalogue")).to_contain_text("Closes in", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
    short = make_sale(short_env, [SPEC_A], SHORT_LEAD)
    lot = short.lots[0]
    ok(bid(new_bidder(short_env), lot["id"], 1700), 201, "a bid below the reserve")
    past = datetime.fromtimestamp(db_now(short_env), timezone.utc) - skew
    with view(browser, short_env.base, f"/lots/{lot['id']}", device_time=past) as page:
        timer = page.get_by_role("timer", name="Time left")
        eventually(timer, lambda: expect(timer).to_contain_text("Closes in", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        listen(page)
        shown = left_seconds(timer.inner_text()) or 0
        advance(page, (shown + 1) * 1000)
        if public_lot(short_env, lot["id"])["status"] in ("open", "extended"):
            shows(timer, "Closing…", whole=True)
        shows(timer, "Closed unsold", WAIT_S, whole=True)
        wait_said(page, f"Lot {lot['lot_number']} closed unsold.")
        page.reload()
        eventually(page.get_by_role("timer", name="Time left"), lambda: expect(page.get_by_role("timer", name="Time left")).to_have_text("Closed unsold", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)


def test_wf_bid_removal_admin(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], REMOVAL_LEAD)
    lot = sale.lots[0]
    a, b = new_bidder(env), new_bidder(env)
    ok(bid(a, lot["id"], 1700), 201, "A 1700")
    extended = ok(bid(b, lot["id"], 1900), 201, "B 1900 inside the window")["lot"]
    assert extended["status"] == "extended"
    bid_id = removable_bid(env, lot["id"], b, 1900)
    with view(browser, env.base, "/desk/admin", staff(env.base, "admin")) as page:
        listen(page)
        panel = page.get_by_role("region", name="Bid removal")
        select(panel.get_by_role("combobox", name="Lot"), f"Lot {lot['lot_number']}, {lot['title']}")
        row = panel.get_by_role("table", name="Bids").get_by_role("row").filter(has_text=b.full_name)
        click(row.get_by_role("button", name="Remove bid"))
        dialog = page.get_by_role("dialog", name="Remove this bid?")
        eventually(dialog.get_by_role("textbox", name="Reason"), lambda: expect(dialog.get_by_role("textbox", name="Reason")).to_be_focused(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        fill(dialog.get_by_role("textbox", name="Reason"), REASON)
        click(dialog.get_by_role("button", name="Remove bid"))
        sentence = f"Bid removed. Lot {lot['lot_number']} now {euros(1600)}."
        wait_text(page, sentence, "the removal confirmation (L363)")
        wait_said(page, sentence)
    after = public_view(env, lot["id"])
    assert after["lot"]["price"] == OPEN_A and after["lot"]["leader_paddle"] == a.paddle, "recomputed (L613)"
    assert after["lot"]["closes_at"] == extended["closes_at"] and after["lot"]["status"] == "extended", (
        "removing a bid never moves a close back (L635)")
    assert len(after["history"]) == 1
    assert texts(b).count(f"Your bid on lot {lot['lot_number']} was removed by the saleroom.") == 1
    err(staff(env.base, "admin").post(f"/api/admin/bids/{bid_id}/remove", {"reason": REASON}), 409,
        "already_removed", "remove twice (L532)")


def test_wf_bid_removal_live_views(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A], SHORT_LEAD)
    lot_id = sale.ids[0]
    a, b, watcher = new_bidder(env), new_bidder(env), new_bidder(env)
    window = (LIVE_MS + VIEW_SLACK_MS) / 1000
    with ExitStack() as stack:
        pub = stack.enter_context(view(browser, env.base, f"/lots/{lot_id}"))
        own = stack.enter_context(view(browser, env.base, f"/lots/{lot_id}", watcher))
        cons = stack.enter_context(view(browser, env.base, f"/consign/lots/{lot_id}", sale.consignor))
        boards = [board(pub), board(own)]
        for item in boards:
            shows(item, f"Next bid {euros(1600)}")
        ok(bid(a, lot_id, 1700), 201, "A 1700")
        for item in boards:
            shows(item, f"Next bid {euros(1650)}")
        ok(bid(b, lot_id, 1900), 201, "B 1900")
        for item in boards:
            shows(item, f"Next bid {euros(1800)}", window)
        wait_text(cons, "€1,750", "the consignor view shows the new price live (L71)", window)
        wait_remaining(env, lot_id, SHORT_SOFT - 2, "the lot enters its window")
        ok(bid(a, lot_id, 2100), 201, "A 2100 extends")
        for item in boards:
            shows(item, f"Next bid {euros(2000)}", window)
        wait_text(cons, "€1,950", "the consignor view shows the extension bid live", window)
        advance(pub, COUNT_UP_MS)
        shown = left_seconds(pub.get_by_role("timer", name="Time left").inner_text())
        assert shown is not None and SHORT_SOFT - 3 <= shown <= SHORT_SOFT, f"the extension shows in place: {shown}"
        bid_id = removable_bid(env, lot_id, a, 2100)
        ok(staff(env.base, "admin").post(f"/api/admin/bids/{bid_id}/remove", {"reason": REASON}), 200, "remove")
        for item in boards:
            shows(item, f"Next bid {euros(1800)}", window)
            shows(item, f"Paddle {b.paddle} leads")
        wait_gone(cons, "€1,950", "the consignor view drops the removed bid live", window)
        closes = ts(public_lot(env, lot_id)["closes_at"])
        wait_db(env, closes, "the extended close passes")
        for page in (pub, own):
            shows(page.get_by_role("timer", name="Time left"), "Closed unsold",
                  (CLOSE_GRACE * 1000 + LIVE_MS + VIEW_SLACK_MS) / 1000, whole=True)
        wait_text(cons, "Unsold", "the consignor view shows the close live (L343)", CLOSE_GRACE + window)


def test_one_socket_with_replay(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    viewer, a, c = new_bidder(env), new_bidder(env), new_bidder(env)
    with view(browser, env.base, f"/lots/{lot_id}", viewer, init=HOLD_JS) as page:
        eventually(place_button(page), lambda: expect(place_button(page)).to_be_disabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        wait_text(page, CONNECTING_HINT, "the connecting hint while the socket is not open (L278)")
        urls = page.evaluate("() => window.__live.sockets.map(s => s.url)")
        assert len(urls) == 1 and "/api/live" in urls[0], f"exactly one socket per page (L72): {urls}"
        assert parse_qs(urlsplit(urls[0]).query).get("since", [""])[0].isdigit(), "it asks from its first seq (L204)"
        page.evaluate("() => window.__liveRelease()")
        eventually(place_button(page), lambda: expect(place_button(page)).to_be_enabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        ok(bid(a, lot_id, 1700), 201, "A 1700")
        shows(board(page), f"Next bid {euros(1650)}")
        last = page.evaluate("() => Math.max(...window.__live.frames.filter(f => f.socket === 0).map(f => f.seq))")
        page.evaluate("() => { window.__liveHold(); window.__liveDrop(); }")
        eventually(page.get_by_role("alert").filter(has_text=CONNECTION_BANNER), lambda: expect(page.get_by_role("alert").filter(has_text=CONNECTION_BANNER)).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        ok(bid(c, lot_id, 1900), 201, "missed event one")
        ok(bid(a, lot_id, 2100), 201, "missed event two")
        advance(page, RECONNECT_MS)
        live(page, lambda: page.evaluate("() => window.__live.sockets.length") == 2, UI_MS / 1000,
             "the page reconnects on its own after one second (L204)")
        resumed = page.evaluate("() => window.__live.sockets[1].url")
        assert parse_qs(urlsplit(resumed).query).get("since") == [str(last)], "resume from the last applied seq"
        page.evaluate("() => window.__liveRelease()")
        shows(board(page), f"Next bid {euros(2000)}")
        frames = page.evaluate("() => window.__live.frames")
        first = [f["seq"] for f in frames if f["socket"] == 0]
        replay = [f["seq"] for f in frames if f["socket"] == 1]
        assert replay and all(s > last for s in replay) and replay == sorted(set(replay)), f"once, in order: {replay}"
        assert not set(first) & set(replay), "no event is delivered twice"
        assert page.evaluate("() => window.__live.sockets[0].real.readyState") == 3, "never two sockets open"


def test_connection_lost_banner(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    viewer, rival = new_bidder(env), new_bidder(env)
    with view(browser, env.base, f"/lots/{lot_id}", viewer, init=HOLD_JS) as page:
        page.evaluate("() => window.__liveRelease()")
        eventually(place_button(page), lambda: expect(place_button(page)).to_be_enabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        eventually(page.get_by_role("alert"), lambda: expect(page.get_by_role("alert")).to_have_count(0, timeout=EVENTUALLY_POLL_MS), UI_S)
        page.evaluate("() => window.__liveDrop()")
        banner = page.get_by_role("alert").filter(has_text=CONNECTION_BANNER)
        eventually(banner, lambda: expect(banner).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        ok(bid(rival, lot_id, 1600), 201, "an event while down")
        click(banner.get_by_role("link", name="Retry now"))
        for _ in range(RETRY_AT_ONCE_MS // 48):
            if page.evaluate("() => window.__live.sockets.length") == 2:
                break
            advance(page, 48)
        assert page.evaluate("() => window.__live.sockets.length") == 2, (
            "Retry now reconnects at once, before the one-second automatic retry (L204)")
        shows(board(page), f"Next bid {euros(1650)}")
        eventually(page.get_by_role("alert"), lambda: expect(page.get_by_role("alert")).to_have_count(0, timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)


def test_lot_close_outcomes(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A, SPEC_A], SHORT_LEAD)
    sold, unsold = sale.ids
    a, b = new_bidder(env), new_bidder(env)
    closes = [ts(ok(bid(a, sold, 2300), 201, "A over the reserve")["lot"]["closes_at"]),
              ts(ok(bid(b, unsold, 1700), 201, "B under the reserve")["lot"]["closes_at"])]
    with view(browser, env.base, f"/catalogue/{sale.id}") as page:
        page.evaluate(PROBE_JS)
        wait_db(env, max(closes), "both closes pass on the server clock")

        def closed() -> dict | None:
            frames = page.evaluate("() => window.__probe")
            found = {f["lot"]["id"]: f["lot"] for f in frames
                     if f.get("type") == "lot_changed" and f.get("cause") == "close"}
            return found if sold in found and unsold in found else None

        result = wait_for(closed, CLOSE_GRACE + (LIVE_MS + VIEW_SLACK_MS) / 1000,
                          "each lot's close event arrives within one second of its close (L74)")
        assert result[sold]["status"] == "closed_sold" and result[sold]["price"] == RESERVE_A
        assert result[unsold]["status"] == "closed_unsold"
    err(bid(b, sold, 2400), 409, "lot_closed", "a bid after the close")
    bid_id = removable_bid(env, unsold, b, 1700)
    err(staff(env.base, "admin").post(f"/api/admin/bids/{bid_id}/remove", {"reason": REASON}), 409, "lot_closed",
        "a removal after the close (L531)")
    assert public_lot(env, sold)["status"] == "closed_sold" and public_lot(env, unsold)["status"] == "closed_unsold"
    assert Decimal(str(consignor_lot(sale.consignor, sold)["hammer"])) == RESERVE_A, "the hammer is the final price"


def test_wf_lot_close_announced(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A], SHORT_LEAD)
    lot_id, n = sale.ids[0], sale.lots[0]["lot_number"]
    a, b = new_bidder(env), new_bidder(env)
    with ExitStack() as stack:
        anon = stack.enter_context(view(browser, env.base, f"/lots/{lot_id}"))
        mine = stack.enter_context(view(browser, env.base, f"/lots/{lot_id}", a))
        for page in (anon, mine):
            eventually(updates(page), lambda: expect(updates(page)).to_have_text("", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            listen(page)
        ok(bid(a, lot_id, 1700), 201, "A 1700")
        shows(board(anon), f"Next bid {euros(1650)}")
        shows(board(mine), "You lead")
        ok(bid(b, lot_id, 2300), 201, "B 2300")
        wait_said(anon, f"Lot {n} now {euros(2200)}. Reserve met on lot {n}.")
        wait_said(mine, f"You have been outbid on lot {n}.")
        wait_said(anon, f"Lot {n} sold for {euros(2200)}.", seconds=WAIT_S)
        wait_said(mine, f"Lot {n} sold for {euros(2200)}.", seconds=WAIT_S)
        assert said_count(anon, f"Lot {n} now {euros(1600)}.") <= 1, f"never twice: {said(anon)}"
        for page, sentences in ((anon, [f"Reserve met on lot {n}.", f"Lot {n} sold for {euros(2200)}."]),
                                (mine, [f"You have been outbid on lot {n}.", f"Lot {n} sold for {euros(2200)}."])):
            for sentence in sentences:
                assert said_count(page, sentence) == 1, f"{sentence!r} announced once: {said(page)}"
        assert said_count(mine, f"Lot {n} now {euros(2200)}") == 0, "the outbid notice replaces the price sentence"


def test_notice_per_recipient(short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A], SHORT_LEAD)
    lot_id, n = sale.ids[0], sale.lots[0]["lot_number"]
    a, b = new_bidder(env), new_bidder(env)
    ok(bid(a, lot_id, 1700), 201, "A 1700")
    ok(bid(b, lot_id, 2300), 201, "B 2300")
    wait_closed(env, [lot_id])
    invoice = wait_invoice(b, sale.id)
    total = Decimal(2200) + premium(2200) + vat(2200)
    due = ts(invoice["due_at"])
    expected = {
        a: [f"Lot {n} sold for {euros(2200)}.", f"You have been outbid on lot {n}."],
        b: [f"Invoice {invoice['number']} for {amount(total)} is ready. Payment is due by {{t}}.",
            f"You won lot {n} at {euros(2200)}."],
        sale.consignor: [f"Your lot {n} sold for {euros(2200)}."],
    }
    for member, sentences in expected.items():
        listed = notices(member)
        found = [item["text"] for item in listed]
        positions = []
        for sentence in sentences:
            variants = {sentence.format(t=t) for t in rotterdam(due)} if "{t}" in sentence else {sentence}
            hits = [i for i, text in enumerate(found) if text in variants]
            assert len(hits) == 1, f"exactly one {sentence!r} for {member.username}: {found}"
            positions.append(hits[0])
        stamps = [ts(item["created_at"]) for item in listed]
        assert stamps == sorted(stamps, reverse=True), f"notices are listed newest first for {member.username}"
        if member is a:
            assert positions == sorted(positions), f"the later close notice is listed before the outbid notice: {found}"
    assert f"You have been outbid on lot {n}." not in texts(b), "the leader gets no outbid notice"


def test_watched_lot_notice(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A, SPEC_A], SHORT_LEAD)
    first, second = sale.ids
    n1 = sale.lots[0]["lot_number"]
    watcher, leader, rival = new_bidder(env), new_bidder(env), new_bidder(env)
    soon, outbid = f"Lot {n1} closes soon, at ", f"You have been outbid on lot {n1}."
    with ExitStack() as stack:
        watching = stack.enter_context(view(browser, env.base, f"/lots/{first}", watcher))
        toggle = watching.get_by_role("button", name=re.compile(r"^(Watch lot|Watching)$"))
        click(toggle)
        wait_text(watching, f"Watching lot {n1}.", "the watching confirmation (L293)")
        eventually(toggle, lambda: expect(toggle).to_have_attribute("aria-pressed", "true", timeout=EVENTUALLY_POLL_MS), UI_S)
        listen(watching)
        assert ok(watcher.put(f"/api/lots/{first}/watch"), 200, "watch again")["watching"] is True
        ok(bid(leader, first, 1700), 201, "early bid")
        led = stack.enter_context(view(browser, env.base, f"/lots/{first}", leader))
        shows(board(led), "You lead")
        listen(led)
        moved = None
        closes = ts(public_lot(env, first)["closes_at"])
        wait_db(env, closes - SHORT_SOFT + SOFT_ENTRY_S,
                "lot one is just inside its soft-close window, well before its notice is due")
        for value in (1900, 2100, 2300):
            if closes - db_now(env) <= SHORT_WATCH:
                break
            landed = ok(bid(rival, first, value), 201, "the extension")["lot"]
            if landed["status"] == "extended":
                moved = ts(landed["closes_at"])
                break
        assert moved is not None, "a bid inside the soft-close window extends the lot (L634)"
        wait_said(led, outbid)
        wait_said(watching, soon, WAIT_S)
        wait_remaining(env, second, SHORT_WATCH - 2, "lot two passes its notice moment")
        ok(watcher.put(f"/api/lots/{second}/watch"), 200, "watch after the due moment")
        final = wait_closed(env, [first, second])
        advance(watching, 2000)
        advance(led, 2000)
        assert said_count(watching, soon) == 1, f"the closing-soon notice is announced once (L307): {said(watching)}"
        assert said_count(led, outbid) == 1, f"the outbid notice is announced once (L307): {said(led)}"
    assert abs(ts(final[0]["closes_at"]) - moved) < 1
    n2 = final[1]["lot_number"]
    listed = notices(watcher)
    soon_notices = [n_ for n_ in listed if n_["kind"] == "closing_soon" and n_["lot_id"] == first]
    assert len(soon_notices) == 1, f"exactly one closing-soon notice (L697): {listed}"
    assert soon_notices[0]["text"] in {f"Lot {n1} closes soon, at {t}." for t in rotterdam(moved)}, (
        f"the notice names the extended close (L683, L697): {soon_notices[0]['text']}")
    assert ts(soon_notices[0]["created_at"]) < moved, "it goes out ahead of the close"
    assert not [x for x in listed if x["kind"] == "closing_soon" and x["lot_id"] == second], (
        f"watching lot {n2} after its due moment sends nothing (L697)")


def test_wf_lot_close_win(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A], SHORT_LEAD)
    lot = sale.lots[0]
    n, hammer = lot["lot_number"], MAX_2300
    a, b = new_bidder(env), new_bidder(env)
    with ExitStack() as stack:
        pages = {who.paddle: stack.enter_context(view(browser, env.base, f"/lots/{lot['id']}", who)) for who in (a, b)}
        for page in pages.values():
            eventually(place_button(page), lambda: expect(place_button(page)).to_be_enabled(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            listen(page)
        wait_remaining(env, lot["id"], LAST_SECONDS, "the lot's last seconds")
        results = together(partial(bid, a, lot["id"], hammer), partial(bid, b, lot["id"], hammer))
        assert [r.status_code for r in results] == [201, 201], f"both bids beat the close (L633): {[r.text[:120] for r in results]}"
        leader = public_lot(env, lot["id"])["leader_paddle"]
        assert leader in pages, "one of the two leads"
        loser = next(paddle for paddle in pages if paddle != leader)
        won, sold = f"You won lot {n} at {euros(hammer)}.", f"Lot {n} sold for {euros(hammer)}."
        for page in pages.values():
            shows(page.get_by_role("timer", name="Time left"), f"Sold for {euros(hammer)}", WAIT_S, whole=True)
        wait_said(pages[leader], won)
        wait_said(pages[loser], sold)
        for page in pages.values():
            advance(page, 2000)
        assert said_count(pages[leader], won) == 1 and said_count(pages[leader], sold) == 0, (
            f"the won notice replaces the sold sentence, once (L307): {said(pages[leader])}")
        assert said_count(pages[loser], sold) == 1 and said_count(pages[loser], "You won") == 0, (
            f"the other bidder hears the lot-closed notice once and no win (L307): {said(pages[loser])}")
        winner = a if a.paddle == leader else b
        page = pages[leader]
        page.goto(env.base + "/bidder")
        eventually(page.get_by_role("region", name="Won").get_by_role(
            "link", name=f"Lot {n}, {lot['title']}"), lambda: expect(page.get_by_role("region", name="Won").get_by_role(
            "link", name=f"Lot {n}, {lot['title']}")).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
    assert lot["id"] in [item["id"] for item in dashboard(winner)["won"]]
    other = b if winner is a else a
    assert lot["id"] not in [item["id"] for item in dashboard(other)["won"]], "a lot is never won twice (L48)"


def test_second_chance_offer(short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A, SPEC_A, SPEC_A], SHORT_LEAD)
    offered, bare, left = sale.ids
    top = new_bidder(env)
    ok(bid(top, offered, 1700), 201, "top bid below the reserve")
    ok(bid(top, left, 1700), 201, "top bid on the third lot")
    lots = wait_closed(env, sale.ids)
    numbers = [lot["lot_number"] for lot in lots]
    consignor = sale.consignor
    state = consignor_lot(consignor, offered)
    assert state["state"] == "closed_unsold" and state["second_chance_open"] is True and state["offer"] is None
    found = texts(consignor)
    assert found.count(f"Your lot {numbers[0]} closed unsold. You can offer it to the top bidder.") == 1
    assert found.count(f"Your lot {numbers[1]} closed unsold.") == 1
    path = f"/api/consign/lots/{offered}/second-chance"
    body = err(consignor.post(path, {"amount": 1599}), 422, "invalid", "below the final price")
    assert body["fields"]["amount"] == f"Offer at least {euros(1600)}, the lot's final price."
    body = err(consignor.post(path, {"amount": 1701}), 422, "invalid", "above the top bidder's maximum")
    assert body["fields"]["amount"] == "That is above what the top bidder offered."
    made = db_now(env)
    offer = ok(consignor.post(path, {"amount": 1700}), 201, "the offer")["offer"]
    assert offer["kind"] == "second_chance" and offer["amount"] == MAX_1700 and offer["status"] == "open"
    assert abs(ts(offer["expires_at"]) - (made + env.offer)) <= 2, "open for the offer window (L648)"
    err(consignor.post(path, {"amount": 1700}), 409, "invalid_transition", "a second offer (L646)")
    assert consignor_lot(consignor, offered)["state"] == "second_chance_offered"
    err(new_consignor(env).post(path, {"amount": 1700}), 404, "not_found", "another consignor's lot (L391)")
    err(new_bidder(env).post(f"/api/bidder/offers/{offer['id']}/accept"), 404, "not_found",
        "another bidder's offer (L391)")
    variants = {f"Second chance: lot {numbers[0]} can be yours for {euros(1700)} until {t}."
                for t in rotterdam(ts(offer["expires_at"]))}
    assert sum(text in variants for text in texts(top)) == 1, "the top bidder's notice (L687)"
    err(consignor.post(f"/api/consign/lots/{bare}/second-chance", {"amount": 1600}), 409, "invalid_transition",
        "a lot with no bids has no choice (L581)")
    ok(consignor.post(f"/api/consign/lots/{left}/leave-unsold"), 200, "leave unsold")
    err(consignor.post(f"/api/consign/lots/{left}/second-chance", {"amount": 1700}), 409, "invalid_transition",
        "leave-unsold closes the choice (L581)")
    after = consignor_lot(consignor, left)
    assert after["state"] == "closed_unsold" and after["second_chance_open"] is False


def test_wf_second_chance_expired(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A], SHORT_LEAD)
    lot_id = sale.ids[0]
    top = new_bidder(env)
    ok(bid(top, lot_id, 1700), 201, "top bid")
    n = wait_closed(env, [lot_id])[0]["lot_number"]
    offer = ok(sale.consignor.post(f"/api/consign/lots/{lot_id}/second-chance", {"amount": 1700}), 201,
               "offer")["offer"]
    with view(browser, env.base, "/bidder", top) as page:
        accept = page.get_by_role("region", name="Offers").get_by_role("button", name=f"Accept offer on lot {n}")
        appears(accept)
        wait_db(env, ts(offer["expires_at"]), "the offer's expiry passes on the server clock")
        wait_for(lambda: consignor_lot(sale.consignor, lot_id)["state"] == "offer_lapsed", WAIT_S,
                 "the server shows the expired offer's lot lapsed (L648) before the late accept")
        try:
            click(accept)
        except AssertionError:
            assert not accept.count() or not accept.first.is_visible(), "the expired offer cannot be pressed"
        else:
            wait_text(page, "This offer has expired.", "an accept after the server's expiry is refused (L332, L476)")
    err(top.post(f"/api/bidder/offers/{offer['id']}/accept"), 409, "offer_expired", "accept after expiry (L476)")
    response = top.post(f"/api/bidder/offers/{offer['id']}/decline")
    assert response.status_code == 409, "decline after expiry answers 409 (L478)"
    wait_for(lambda: consignor_lot(sale.consignor, lot_id)["state"] == "offer_lapsed", WAIT_S,
             "expiry turns the lot offer_lapsed (L648)")
    assert texts(sale.consignor).count(f"The offer on your lot {n} has lapsed.") == 1
    assert not [i for i in dashboard(top)["invoices"] if any(l["lot_id"] == lot_id for l in i["lines"])]


def test_wf_second_chance_accept(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], CLOSE_LEAD)
    lot = sale.lots[0]
    top = new_bidder(env)
    ok(bid(top, lot["id"], 1700), 201, "top bid below the reserve")
    wait_closed(env, [lot["id"]], LONG_WAIT_S)
    with view(browser, env.base, f"/consign/lots/{lot['id']}", sale.consignor) as page:
        panel = page.get_by_role("region", name="Second chance")
        fill(panel.get_by_role("textbox", name="Offer amount"), "1700")
        click(panel.get_by_role("button", name="Offer to the top bidder"))
        wait_text(page, "Offer sent to the top bidder until ", "the offer confirmation (L344)")
    offer = consignor_lot(sale.consignor, lot["id"])["offer"]
    assert offer and offer["amount"] == MAX_1700
    n = lot["lot_number"]
    skew = datetime.fromtimestamp(db_now(env), timezone.utc) + timedelta(days=30)
    with view(browser, env.base, "/bidder", top, device_time=skew) as page:
        offers = page.get_by_role("region", name="Offers")
        appears(offers.get_by_role("button", name=f"Accept offer on lot {n}"))
        until_shown = rotterdam(ts(offer["expires_at"]))
        live(page, lambda: any(t in offers.inner_text() for t in until_shown), UI_S,
             "the offer shows its expiry in Rotterdam time (L202)")
        stale = page.context.new_page()
        stale.goto(env.base + "/bidder")
        decline = stale.get_by_role("region", name="Offers").get_by_role("button", name=f"Decline offer on lot {n}")
        appears(decline)
        click(offers.get_by_role("button", name=f"Accept offer on lot {n}"))
        invoice = wait_for(lambda: [i for i in dashboard(top)["invoices"]
                                    if any(l["lot_id"] == lot["id"] for l in i["lines"])], WAIT_S,
                           "accepting issues an invoice (L649)")[0]
        wait_text(page, f"Lot {n} is yours for {euros(1700)}. Invoice {invoice['number']} is ready.",
                  "the accepted message (L330)")
        try:
            click(decline)
        except AssertionError:
            assert not decline.count() or not decline.first.is_visible(), "the answered offer cannot be declined"
        else:
            wait_text(stale, "This offer has already been answered.", "a stale tab cannot answer again (L202, L333)")
        assert ok(top.get(f"/api/lots/{lot['id']}"), 200, "lot")["lot"]["status"] == "closed_unsold"
        assert consignor_lot(sale.consignor, lot["id"])["state"] == "sold_by_offer", "one outcome only (L48)"
    assert [l["source"] for l in invoice["lines"]] == ["second_chance"] and invoice["lines"][0]["hammer"] == f"{MAX_1700}.00"
    with view(browser, env.base, "/consign", sale.consignor) as page:
        eventually(page.get_by_role("table", name="Your lots").get_by_role("row").filter(
            has_text=lot["title"]), lambda: expect(page.get_by_role("table", name="Your lots").get_by_role("row").filter(
            has_text=lot["title"])).to_contain_text("Sold by offer", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
    assert consignor_lot(sale.consignor, lot["id"])["state"] == "sold_by_offer"


def test_one_invoice_per_buyer(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [HAMMER_1250, HAMMER_85, HAMMER_2450], SHORT_LEAD)
    w, x = new_bidder(env), new_bidder(env)
    ok(bid(w, sale.ids[0], 1250), 201, "W lot one")
    ok(bid(w, sale.ids[1], 85), 201, "W lot two")
    ok(bid(x, sale.ids[2], 2450), 201, "X lot three")
    owed = sum(Decimal(h) + premium(h) + vat(h) for h in (1250, 85))
    with view(browser, env.base, "/bidder", w) as page:
        shows(page.get_by_role("region", name="Spending limit"), "committed")
        listen(page)
        wait_db(env, sale.ends + CLOSE_GRACE, "the first lot closes")
        if db_now(env) < sale.ends + 2 * env.gap:
            assert sale_invoices(w, sale.id) == [], "no invoice before the sale's last lot closes (L641)"
        lots = wait_closed(env, sale.ids)
        number = wait_invoice(w, sale.id)["number"]
        ready = f"Invoice {number} for {amount(owed)} is ready. Payment is due by "
        wait_said(page, ready)
        advance(page, 2000)
        assert said_count(page, ready) == 1, f"the invoice notice is announced once (L307): {said(page)}"
    for member, expected in ((w, sale.ids[:2]), (x, sale.ids[2:])):
        wait_invoice(member, sale.id)
        invoices = sale_invoices(member, sale.id)
        assert len(invoices) == 1, f"one invoice per buyer per sale (L43): {invoices}"
        lines = invoices[0]["lines"]
        assert sorted(l["lot_id"] for l in lines) == sorted(expected) and {l["source"] for l in lines} == {"hammer"}
        assert re.fullmatch(r"INV-\d{5}", invoices[0]["number"]) and invoices[0]["status"] == "issued"
        last = max(ts(lot["closes_at"]) for lot in lots)
        assert abs(ts(invoices[0]["due_at"]) - (last + env.due)) <= 1, "due a payment window after the last close"


def test_premium_and_vat(short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [HAMMER_1250, HAMMER_2450, HAMMER_85], SHORT_LEAD)
    buyer = new_bidder(env)
    hammers = [1250, 2450, 85]
    for lot_id, hammer in zip(sale.ids, hammers):
        ok(bid(buyer, lot_id, hammer), 201, f"bid {hammer}")
    wait_closed(env, sale.ids)
    invoice = wait_invoice(buyer, sale.id)
    published = {1250: ("312.50", "65.63"), 2450: ("590.00", "123.90"), 85: ("21.25", "4.46")}
    by_hammer = {Decimal(line["hammer"]): line for line in invoice["lines"]}
    for hammer in hammers:
        line = by_hammer[Decimal(hammer)]
        assert (line["premium"], line["vat"]) == published[hammer], f"premium and VAT for {hammer}: {line}"
        assert (Decimal(line["premium"]), Decimal(line["vat"])) == (premium(hammer), vat(hammer))
    hammer_total = sum(Decimal(h) for h in hammers)
    premium_total = sum(premium(h) for h in hammers)
    vat_total = sum(vat(h) for h in hammers)
    assert Decimal(invoice["hammer_total"]) == hammer_total and Decimal(invoice["premium_total"]) == premium_total
    assert Decimal(invoice["vat_total"]) == vat_total
    assert invoice["total"] == f"{hammer_total + premium_total + vat_total:.2f}", "total = hammer + premium + VAT"
    assert re.fullmatch(r"\d+\.\d{2}", invoice["total"]), "amounts are strings with two decimals (L382)"


def test_wf_invoice_and_pay_refusals(short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [HAMMER_1250, HAMMER_85], SHORT_LEAD)
    payer, late = new_bidder(env), new_bidder(env)
    ok(bid(payer, sale.ids[0], 1250), 201, "payer wins 1,250")
    ok(bid(late, sale.ids[1], 85), 201, "late payer wins 85")
    wait_closed(env, sale.ids)
    invoice = wait_invoice(payer, sale.id)
    cashier = staff(env.base, "cashier")
    path = f"/api/desk/invoices/{invoice['id']}/payments"
    assert invoice["total"] == "1628.13", "the published worked example (L660)"
    err(late.get(f"/api/bidder/invoices/{invoice['id']}"), 404, "not_found", "another bidder's invoice (L391)")
    body = err(cashier.post(path, {"amount": PAY_MALFORMED, "method": "cash"}), 422, "invalid", "malformed amount")
    assert body["fields"]["amount"] == PAYMENT_FORMAT_ERROR
    err(cashier.post(path, {"amount": PAY_ZERO, "method": "cash"}), 422, "invalid", "zero amount (L525)")
    body = err(cashier.post(path, {"amount": PAY_OVER, "method": "cash"}), 422, "invalid", "overpayment")
    assert body["fields"]["amount"] == f"That is more than the {amount(Decimal('1628.13'))} still owed."
    part = ok(cashier.post(path, {"amount": PAY_PART, "method": "card"}), 201, "part payment")["invoice"]
    assert part["status"] == "issued" and part["outstanding"] == PAY_REST and part["paid"] == PAY_PART
    full = ok(cashier.post(path, {"amount": PAY_REST, "method": "bank_transfer"}), 201, "the rest")["invoice"]
    assert full["status"] == "paid" and full["outstanding"] == PAY_ZERO and len(full["payments"]) == 2
    err(cashier.post(path, {"amount": PAY_SMALL, "method": "cash"}), 409, "invoice_paid", "pay a paid invoice (L667)")
    assert consignor_lot(sale.consignor, sale.ids[0])["state"] == "paid", "paid invoices pay their lots (L665)"
    overdue = wait_invoice(late, sale.id)
    wait_db(env, ts(overdue["due_at"]), "the late invoice's due time passes")
    wait_for(lambda: ok(cashier.get(f"/api/desk/invoices/{overdue['id']}"), 200, "cashier invoice")[
        "invoice"]["status"] == "defaulted", CLOSE_GRACE + 2, "the invoice defaults within a second of its due time (L563)")
    err(cashier.post(f"/api/desk/invoices/{overdue['id']}/payments", {"amount": PAY_SMALL, "method": "cash"}), 409,
        "invoice_defaulted", "a payment at or after the due time (L667)")
    detail = ok(cashier.get(f"/api/desk/invoices/{overdue['id']}"), 200, "cashier invoice")["invoice"]
    assert detail["payments"] == []


def test_wf_invoice_and_pay_cashier(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [HAMMER_1250], CLOSE_LEAD)
    winner = new_bidder(env)
    ok(bid(winner, sale.ids[0], 1250), 201, "winning bid")
    wait_closed(env, sale.ids, LONG_WAIT_S)
    invoice = wait_invoice(winner, sale.id)
    number = invoice["number"]
    with view(browser, env.base, "/desk/cashier", staff(env.base, "cashier")) as page:
        check(page.get_by_role("radio", name="All"))
        click(page.get_by_role("table", name="Invoices").get_by_role("link", name=f"Invoice {number}"))
        fill(page.get_by_role("textbox", name="Payment amount"), "1628.13")
        select(page.get_by_role("combobox", name="Method"), "Bank transfer")
        click(page.get_by_role("button", name="Record payment"))
        wait_text(page, f"Payment of {amount(Decimal('1628.13'))} recorded. Invoice {number} is paid.",
                  "the paid-in-full message (L359)")
    with view(browser, env.base, f"/bidder/invoices/{invoice['id']}", winner) as page:
        eventually(page.get_by_role("heading", level=1, name=f"INVOICE {number}"), lambda: expect(page.get_by_role("heading", level=1, name=f"INVOICE {number}")).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        eventually(page.get_by_role("table", name="Invoice lines"), lambda: expect(page.get_by_role("table", name="Invoice lines")).to_be_visible(timeout=EVENTUALLY_POLL_MS), UI_S)
        wait_text(page, "Paid", "the invoice shows Paid (L172)")
    paid = ok(winner.get(f"/api/bidder/invoices/{invoice['id']}"), 200, "invoice")["invoice"]
    assert paid["status"] == "paid" and paid["outstanding"] == "0.00"
    assert [(p["amount"], p["method"]) for p in paid["payments"]] == [("1628.13", "bank_transfer")]
    detail = ok(staff(env.base, "cashier").get(f"/api/desk/invoices/{invoice['id']}"), 200, "cashier")["invoice"]
    assert detail["bidder_name"] == winner.full_name


def test_default_at_due_time(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A, HAMMER_1250], SHORT_LEAD)
    contested, alone = sale.ids
    winner, under = new_bidder(env), new_bidder(env)
    ok(bid(under, contested, 1900), 201, "underbidder")
    ok(bid(winner, contested, 2300), 201, "winner")
    ok(bid(winner, alone, 1250), 201, "winner alone")
    lots = wait_closed(env, sale.ids)
    invoice = wait_invoice(winner, sale.id)
    due = ts(invoice["due_at"])
    n = lots[0]["lot_number"]
    defaulted, offered = (f"Invoice {invoice['number']} was not paid in time and has defaulted.",
                          f"Lot {n} is offered to you for {euros(1900)} until ")
    with ExitStack() as stack:
        pages = [stack.enter_context(view(browser, env.base, "/bidder", who)) for who in (winner, under)]
        for page in pages:
            shows(page.get_by_role("region", name="Spending limit"), "committed")
            listen(page)
        offer = wait_for(lambda: open_offer(under, contested), WAIT_S, "the underbidder is offered the lot (L666)")
        assert db_now(env) >= due, "nothing defaults before the due time"
        for page, sentence in zip(pages, (defaulted, offered)):
            wait_said(page, sentence)
            advance(page, 2000)
            assert said_count(page, sentence) == 1, f"{sentence!r} announced once (L307): {said(page)}"
    assert offer["kind"] == "default" and offer["amount"] == MAX_1900, "offered at the underbidder's maximum (L647)"
    assert 0 <= ts(offer["expires_at"]) - due - env.offer <= CLOSE_GRACE + 1, "open for the offer window (L648)"
    detail = ok(winner.get(f"/api/bidder/invoices/{invoice['id']}"), 200, "invoice")["invoice"]
    assert detail["status"] == "defaulted"
    assert consignor_lot(sale.consignor, contested)["state"] == "underbidder_offered"
    assert consignor_lot(sale.consignor, alone)["state"] == "defaulted", "no underbidder: stays defaulted (L581)"
    assert texts(winner).count(defaulted) == 1
    variants = {f"Lot {n} is offered to you for {euros(1900)} until {t}." for t in rotterdam(ts(offer["expires_at"]))}
    assert sum(text in variants for text in texts(under)) == 1, "one default_offer notice (L688)"
    wait_db(env, ts(offer["expires_at"]), "the default offer's expiry passes")
    wait_for(lambda: consignor_lot(sale.consignor, contested)["state"] == "offer_lapsed", WAIT_S,
             "the server shows the expired default offer's lot lapsed (L648) before the late accept")
    err(under.post(f"/api/bidder/offers/{offer['id']}/accept"), 409, "offer_expired",
        "an accept after expiry answers offer_expired, also once the offer has lapsed (L476, L648)")
    wait_for(lambda: consignor_lot(sale.consignor, contested)["state"] == "offer_lapsed", WAIT_S,
             "the expired default offer lapses the lot (L648)")


def test_wf_default_offer_race(short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A], SHORT_LEAD)
    lot_id = sale.ids[0]
    winner, under = new_bidder(env), new_bidder(env)
    ok(bid(under, lot_id, 1900), 201, "underbidder")
    ok(bid(winner, lot_id, 2300), 201, "winner")
    wait_closed(env, [lot_id])
    wait_invoice(winner, sale.id)
    err(sale.consignor.post(f"/api/consign/lots/{lot_id}/second-chance", {"amount": 1900}), 409,
        "invalid_transition", "a hammered lot has no second chance (L48)")
    offer = wait_for(lambda: open_offer(under, lot_id), WAIT_S, "the default offer opens")
    path = f"/api/bidder/offers/{offer['id']}/accept"
    results = together(partial(under.post, path), partial(under.post, path))
    statuses = sorted(r.status_code for r in results)
    assert statuses == [200, 409], f"exactly one accept succeeds (L651): {statuses}"
    loser = next(r for r in results if r.status_code == 409)
    assert loser.json()["error"] == "offer_closed"
    holding = [i for i in dashboard(under)["invoices"] if any(l["lot_id"] == lot_id for l in i["lines"])]
    assert len(holding) == 1, "the lot is invoiced once"
    assert consignor_lot(sale.consignor, lot_id)["state"] == "sold_by_offer"
    err(under.post(path), 409, "offer_closed", "a later accept")


def test_wf_default_offer_underbidder(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [SPEC_A], SHORT_LEAD)
    lot = sale.lots[0]
    winner, under = new_bidder(env), new_bidder(env)
    ok(bid(under, lot["id"], 1900), 201, "underbidder")
    ok(bid(winner, lot["id"], 2300), 201, "winner")
    with view(browser, env.base, "/bidder", under) as page:
        wait_closed(env, [lot["id"]])
        defaulted = wait_invoice(winner, sale.id)
        wait_for(lambda: open_offer(under, lot["id"]), WAIT_S, "the default offer opens (L666)")
        accept = page.get_by_role("region", name="Offers").get_by_role(
            "button", name=f"Accept offer on lot {lot['lot_number']}")
        try:
            appears(accept, (LIVE_MS + VIEW_SLACK_MS) / 1000)
        except pytest.fail.Exception:
            page.reload()
        click(accept)
        invoice = wait_for(lambda: [i for i in dashboard(under)["invoices"]
                                    if any(l["lot_id"] == lot["id"] for l in i["lines"])], WAIT_S,
                           "the underbidder's invoice is issued (L649)")[0]
        wait_text(page, f"Lot {lot['lot_number']} is yours for {euros(1900)}. Invoice {invoice['number']} is ready.",
                  "the accepted message (L330)")
    line = invoice["lines"][0]
    assert (line["source"], line["hammer"]) == ("default_offer", f"{MAX_1900}.00")
    assert (Decimal(line["premium"]), Decimal(line["vat"])) == (premium(1900), vat(1900))
    with view(browser, env.base, "/desk/cashier", staff(env.base, "cashier")) as page:
        defaults = page.get_by_role("region", name="Defaults")
        eventually(defaults, lambda: expect(defaults).to_contain_text(defaulted["number"], timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        eventually(defaults, lambda: expect(defaults).to_contain_text(str(winner.paddle), timeout=EVENTUALLY_POLL_MS), UI_S)
    assert consignor_lot(sale.consignor, lot["id"])["state"] == "sold_by_offer"


def test_seller_commission(short_env: SimpleNamespace) -> None:
    env = short_env
    hammers = [1250, 85, 120, 125, 1235]
    sale = make_sale(env, [dict(low=h, high=h, opening=h, reserve=h) for h in hammers] + [SPEC_A], SHORT_LEAD)
    buyer = new_bidder(env)
    for lot_id, hammer in zip(sale.ids, hammers):
        ok(bid(buyer, lot_id, hammer), 201, f"{hammer}")
    wait_closed(env, sale.ids)
    statement = ok(staff(env.base, "admin").get(f"/api/admin/statements/{sale_statement(env, sale.id)['id']}"), 200,
                   "statement")["statement"]
    lines = {line["lot_id"]: line for line in statement["lines"]}
    assert (lines[sale.ids[0]]["commission"], lines[sale.ids[0]]["net"]) == ("156.25", "1093.75"), "L671"
    assert (lines[sale.ids[1]]["commission"], lines[sale.ids[1]]["net"]) == ("15.00", "70.00"), "minimum (L671)"
    for lot_id, hammer in zip(sale.ids, hammers):
        line = lines[lot_id]
        assert line["result"] == "sold" and Decimal(line["hammer"]) == hammer, f"sold at {hammer}: {line}"
        assert line["commission"] == f"{commission(hammer):.2f}", f"12.5 % of {hammer}, half up, at least 15.00: {line}"
        assert line["net"] == f"{Decimal(hammer) - commission(hammer):.2f}", f"net for {hammer}: {line}"
    unsold = lines[sale.ids[-1]]
    assert unsold["result"] == "unsold" and (unsold["hammer"], unsold["commission"], unsold["net"]) == (None,) * 3
    assert statement["status"] == "draft"
    total = sum(Decimal(h) for h in hammers)
    fees = sum(commission(h) for h in hammers)
    assert (statement["hammer_total"], statement["commission_total"], statement["net_total"]) == (
        f"{total:.2f}", f"{fees:.2f}", f"{total - fees:.2f}"), "totals are the sums of the rounded lines"


def test_wf_seller_statements_correction(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [HAMMER_1250], SHORT_LEAD)
    buyer = new_bidder(env)
    admin = staff(env.base, "admin")
    ok(bid(buyer, sale.ids[0], 1250), 201, "winning bid")
    wait_closed(env, sale.ids)
    draft = sale_statement(env, sale.id)
    err(sale.consignor.get(f"/api/consign/statements/{draft['id']}"), 404, "not_found", "drafts are hidden (L491)")
    issued = ok(admin.post(f"/api/admin/statements/{draft['id']}/issue"), 200, "issue")["statement"]
    assert set(issued) == STATEMENT_KEYS and all(set(l) == STATEMENT_LINE_KEYS for l in issued["lines"])
    assert issued["status"] == "issued" and issued["issued_at"] and issued["lines"][0]["result"] == "sold"
    err(admin.post(f"/api/admin/statements/{draft['id']}/issue"), 409, "statement_locked", "issue twice (L536)")
    invoice = wait_invoice(buyer, sale.id)
    wait_db(env, ts(invoice["due_at"]) + CLOSE_GRACE, "the invoice's due time passes and it defaults")
    wait_for(lambda: consignor_lot(sale.consignor, sale.ids[0])["state"] == "defaulted", WAIT_S, "the lot defaults")
    locked = ok(admin.get(f"/api/admin/statements/{issued['id']}"), 200, "statement")["statement"]
    assert locked == issued, "an issued statement never changes (L674)"
    answer = ok(admin.post(f"/api/admin/statements/{issued['id']}/correct", {"note": NOTE}), 201, "correct")
    new, old = answer["statement"], answer["superseded"]
    assert new["status"] == "issued" and new["version"] == issued["version"] + 1 and new["supersedes"] == issued["id"]
    assert re.fullmatch(r"ST-\d{5}", new["number"]) and new["number"] != issued["number"]
    assert new["lines"][0]["result"] == "unsold", "a correction recomputes from current results (L675)"
    assert old["status"] == "superseded" and old["superseded_by"] == new["id"] and old["lines"] == issued["lines"]
    err(admin.post(f"/api/admin/statements/{issued['id']}/correct", {"note": NOTE}), 409, "invalid_transition",
        "correct a superseded statement (L538)")
    listed = ok(sale.consignor.get("/api/consign/statements"), 200, "consignor statements")["statements"]
    statuses = {s["id"]: s["status"] for s in listed}
    assert statuses.get(issued["id"]) == "superseded" and statuses.get(new["id"]) == "issued"
    read = ok(sale.consignor.get(f"/api/consign/statements/{issued['id']}"), 200, "superseded stays readable")
    assert set(read["statement"]) == STATEMENT_KEYS
    with view(browser, env.base, f"/consign/statements/{issued['id']}", sale.consignor) as page:
        eventually(page.get_by_role("heading", level=1, name=f"SELLER STATEMENT {issued['number']}"), lambda: expect(page.get_by_role("heading", level=1, name=f"SELLER STATEMENT {issued['number']}")).to_be_visible(timeout=EVENTUALLY_POLL_MS), UI_S)
        wait_text(page, "Superseded", "the replaced statement says Superseded (L178)")
        links = page.get_by_role("link")
        target = f"/consign/statements/{new['id']}"
        replacing = [links.nth(i) for i in range(links.count()) if (links.nth(i).get_attribute("href") or "").endswith(target)]
        assert replacing, f"the superseded statement links to {target} (L178)"
        click(replacing[0])
        eventually(page, lambda: expect(page).to_have_url(re.compile(rf"/consign/statements/{re.escape(new['id'])}$"), timeout=EVENTUALLY_POLL_MS), UI_S)
        eventually(page.get_by_role("heading", level=1, name=f"SELLER STATEMENT {new['number']}"), lambda: expect(page.get_by_role("heading", level=1, name=f"SELLER STATEMENT {new['number']}")).to_be_visible(timeout=EVENTUALLY_POLL_MS), UI_S)
        wait_text(page, "Issued", "the replacing statement says Issued (L178)")
    err(new_consignor(env).get(f"/api/consign/statements/{issued['id']}"), 404, "not_found",
        "another consignor's statement (L491)")


def test_wf_seller_statements_consignor_reads(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [HAMMER_1250], SHORT_LEAD)
    ok(bid(new_bidder(env), sale.ids[0], 1250), 201, "winning bid")
    wait_closed(env, sale.ids)
    draft = sale_statement(env, sale.id)
    number = draft["number"]
    window = (LIVE_MS + VIEW_SLACK_MS) / 1000
    with ExitStack() as stack:
        desk = stack.enter_context(view(browser, env.base, "/consign", sale.consignor))
        eventually(desk.get_by_role("heading", level=1, name="YOUR CONSIGNMENTS"), lambda: expect(desk.get_by_role("heading", level=1, name="YOUR CONSIGNMENTS")).to_be_visible(timeout=EVENTUALLY_POLL_MS), UI_S)
        panel = desk.get_by_role("region", name="Statements")
        eventually(panel, lambda: expect(panel).to_be_visible(timeout=EVENTUALLY_POLL_MS), UI_S)
        listen(desk)
        admin = stack.enter_context(view(browser, env.base, "/desk/admin", staff(env.base, "admin")))
        click(admin.get_by_role("region", name="Statements").get_by_role("button", name=f"Issue {number}"))
        wait_text(admin, f"Statement {number} issued.", "the issued message (L364)")
        issued = panel.get_by_role("link", name=f"Statement {number}")
        appears(issued, window)
        wait_said(desk, f"Your statement {number} is ready.")
        issued.focus()
        corrected = ok(staff(env.base, "admin").post(f"/api/admin/statements/{draft['id']}/correct", {"note": NOTE}),
                       201, "correct")["statement"]
        appears(panel.get_by_role("link", name=f"Statement {corrected['number']}"), window)
        live(desk, lambda: "Superseded" in panel.inner_text(), window, "the replaced statement shows Superseded (L203)")
        held = desk.evaluate("() => (document.activeElement && document.activeElement.textContent || '').trim()")
        assert issued.evaluate("e => e === document.activeElement"), (
            f"keyboard focus stays on the Statement {number} link it was on (L203); it is on {held!r}")
        advance(desk, 2000)
        assert said_count(desk, f"Your statement {number} is ready.") == 1, f"announced once (L307): {said(desk)}"
        click(panel.get_by_role("link", name=f"Statement {corrected['number']}"))
        eventually(desk, lambda: expect(desk).to_have_url(re.compile(rf"/consign/statements/{re.escape(corrected['id'])}$"), timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        for _ in range(2):
            eventually(desk.get_by_role("heading", level=1, name=f"SELLER STATEMENT {corrected['number']}"), lambda: expect(desk.get_by_role("heading", level=1, name=f"SELLER STATEMENT {corrected['number']}")).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            eventually(desk.get_by_role("table", name="Statement lines"), lambda: expect(desk.get_by_role("table", name="Statement lines")).to_contain_text(str(sale.lots[0]["lot_number"]), timeout=EVENTUALLY_POLL_MS), UI_S)
            wait_text(desk, "Issued", "the statement shows Issued (L178)")
            desk.reload()
    statement = ok(sale.consignor.get(f"/api/consign/statements/{draft['id']}"), 200, "statement")["statement"]
    assert statement["status"] == "superseded" and statement["issued_at"]
    assert texts(sale.consignor).count(f"Your statement {number} is ready.") == 1


def test_hammer_numeral(browser: Browser, env: SimpleNamespace, short_env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    a, b = new_bidder(env), new_bidder(env)
    ok(bid(a, lot_id, 1700), 201, "A 1700")
    with view(browser, env.base, f"/lots/{lot_id}") as page:
        shows(board(page), f"Next bid {euros(1650)}")
        board(page).evaluate(ANIM_JS)
        ok(bid(b, lot_id, 1900), 201, "1,600 to 1,750 changes two digits")
        shows(board(page), f"Next bid {euros(1800)}")
        advance(page, DIGIT_STAGGER_MS * 5)
        anims = page.evaluate("() => window.__anims")
        assert len(anims) == 2, f"one animation per changed digit and nothing else (L239): {anims}"
        for anim in anims:
            assert DIGIT_MIN_MS < anim["duration"] < DIGIT_MAX_MS, f"a little over half a second (L239): {anim}"
        right, left = sorted(anims, key=lambda item: -item["x"])
        assert 0 <= left["begin"] - right["begin"] <= DIGIT_STAGGER_MS * 3, f"right to left, staggered (L232): {anims}"
    short = make_sale(short_env, [SPEC_A], SHORT_LEAD)
    short_id = short.ids[0]
    c, d = new_bidder(short_env), new_bidder(short_env)
    ok(bid(c, short_id, 1700), 201, "C 1700")
    wait_remaining(short_env, short_id, SHORT_SOFT - 3, "the lot is deep in its window")
    with view(browser, short_env.base, f"/lots/{short_id}") as page:
        timer = page.get_by_role("timer", name="Time left")
        eventually(timer, lambda: expect(timer).to_contain_text("Closes in", timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        shows(board(page), f"Next bid {euros(1650)}")
        before = left_seconds(timer.inner_text())
        ok(bid(d, short_id, 1900), 201, "the extension")
        shows(board(page), f"Next bid {euros(1800)}")
        advance(page, COUNT_UP_MS)
        after = left_seconds(timer.inner_text())
        assert before is not None and after is not None and after > before, f"time left counts up: {before}->{after}"


def test_reduced_motion(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A, SPEC_A], DAY_AHEAD)
    lot = sale.lots[0]
    a, b = new_bidder(env), new_bidder(env)
    ok(bid(a, lot["id"], 1700), 201, "A 1700")
    with view(browser, env.base, f"/lots/{lot['id']}", reduced=True) as page:
        shows(board(page), f"Next bid {euros(1650)}")
        board(page).evaluate(ANIM_JS)
        listen(page)
        ok(bid(b, lot["id"], 1900), 201, "B 1900")
        shows(board(page), f"Next bid {euros(1800)}")
        wait_said(page, f"Lot {lot['lot_number']} now {euros(1750)}.")
        advance(page, DIGIT_MAX_MS)
        moving = [a for a in page.evaluate("() => window.__anims") if (a["duration"] or 0) > MOTION_FLOOR_MS]
        assert moving == [], f"nothing animates in the Lot board (L243): {moving}"
    with view(browser, env.base, f"/catalogue/{sale.id}", reduced=True) as page:
        grid = page.get_by_role("grid", name="Catalogue")
        eventually(grid.get_by_role("gridcell"), lambda: expect(grid.get_by_role("gridcell")).to_have_count(2, timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        for _ in range(12):
            if grid.evaluate("g => g.contains(document.activeElement)"):
                break
            page.keyboard.press("Tab")
        page.keyboard.press("ArrowRight")
        running = page.evaluate("(floor) => document.getAnimations().filter(a => a.playState === 'running'"
                                " && (a.effect.getComputedTiming().duration || 0) > floor).length", MOTION_FLOOR_MS)
        assert running == 0, "the poster swap is instant under reduced motion (L243)"


def test_wf_cross_cutting_health(browser: Browser, env: SimpleNamespace) -> None:
    health = httpx.get(f"{env.base}/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "ok"}, "GET /api/health (L549, L764)"
    current = httpx.get(f"{env.base}/api/sales/current", timeout=HTTP_TIMEOUT)
    with view(browser, env.base, "/") as page:
        if current.status_code == 200:
            title = current.json()["sale"]["title"]
            eventually(page.get_by_role("heading", level=1), lambda: expect(page.get_by_role("heading", level=1)).to_have_text(re.compile(rf"^\s*{re.escape(title)}\s*$", re.I), timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            eventually(page.get_by_role("link", name="View the catalogue"), lambda: expect(page.get_by_role("link", name="View the catalogue")).to_be_visible(timeout=EVENTUALLY_POLL_MS), UI_S)
        else:
            wait_text(page, "NO SALE THIS WEEK", "the no-sale state (L368)")


def test_wf_cross_cutting_boundary(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id = sale.ids[0]
    bidder = new_bidder(env)
    watch = f"/api/lots/{lot_id}/watch"
    body = err(bidder.put(watch, headers={"Origin": FOREIGN_ORIGIN}), 403, "forbidden_origin", "foreign PUT (L788)")
    assert body["message"] == "Requests must come from the saleroom."
    err(bid(bidder, lot_id, 1600, headers={"Origin": FOREIGN_ORIGIN}), 403, "forbidden_origin", "foreign bid")
    mine = ok(bidder.get(f"/api/lots/{lot_id}"), 200, "lot")["lot"]
    assert mine["watching"] is False and mine["bid_count"] == 0, "refused requests change nothing"
    assert raw_upgrade(env.base, FOREIGN_ORIGIN) == 403, "a foreign socket upgrade answers 403 (L542)"
    typed = bidder.http.put(bidder.url(watch), content=b"{}", headers={"Content-Type": "text/plain"})
    assert typed.status_code == 415, f"a non-JSON write answers 415 (L378); got {typed.status_code}"
    prefix = json.dumps({"pad": ""}, separators=(",", ":"))
    limit = 16384
    exact = prefix.replace('""', '"' + "x" * (limit - len(prefix)) + '"')
    assert len(exact.encode()) == limit
    headers = {"Content-Type": "application/json"}
    assert bidder.http.put(bidder.url(watch), content=exact.encode(), headers=headers).status_code != 413, (
        "a body of exactly 16,384 bytes is within the limit (L379)")
    over = exact.replace('"x', '"xx', 1)
    assert bidder.http.put(bidder.url(watch), content=over.encode(), headers=headers).status_code == 413
    for path in ("/run.json", "/go.mod", "/go.sum", "/main.go", "/package-lock.json", "/web/package.json",
                 "/.env"):
        response = httpx.get(env.base + path, timeout=HTTP_TIMEOUT)
        assert response.status_code == 404, f"{path} is never served (L790); got {response.status_code}"
    secrets = [os.environ[k] for k in ("AUTH_CLIENT_SECRET",) if os.environ.get(k)]
    with view(browser, env.base, "/probe-not-a-page") as page:
        answer = page.goto(env.base + "/probe-not-a-page")
        assert answer is not None and answer.status == 404
        wait_text(page, "NOT IN THIS SALE", "the not-found line (L317)")
        wait_text(page, "That page is not in the saleroom.", "the not-found sentence (L317)")
        bodies: list[bytes] = []
        page.on("response", lambda r: bodies.append(r.body()) if same_origin(r.url, env.base) and r.ok else None)
        page.goto(env.base + f"/lots/{lot_id}")
        eventually(board(page), lambda: expect(board(page)).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
        for secret in secrets:
            assert not any(secret.encode() in item for item in bodies), "credentials never reach the browser"


SOCKET_JS = """
(since) => new Promise((resolve) => {
  window.__frames = [];
  const origin = location.origin.replace(/^http/, "ws");
  const socket = new WebSocket(origin + "/api/live?since=" + since);
  window.__socket = socket;
  socket.onmessage = (event) => { try { window.__frames.push(JSON.parse(event.data)); } catch (error) { /* ignore */ } };
  socket.onopen = () => resolve(true);
  socket.onerror = () => resolve(false);
})
"""

PERSONAL_PATHS = ("/api/me", "/api/notices", "/api/bidder/dashboard", "/api/consign/lots", "/api/consign/statements")


def test_wf_watch_list_dashboard_live(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot = sale.lots[0]
    n, name = lot["lot_number"], f"Lot {lot['lot_number']}, {lot['title']}"
    bidder = new_bidder(env)
    window = (LIVE_MS + VIEW_SLACK_MS) / 1000
    with view(browser, env.base, f"/lots/{lot['id']}", bidder) as page:
        dash = page.context.new_page()
        dash.goto(env.base + "/bidder")
        watching = dash.get_by_role("region", name="Watching")
        eventually(watching, lambda: expect(watching).to_be_visible(timeout=EVENTUALLY_POLL_MS))
        link = watching.get_by_role("link", name=name, exact=True)
        eventually(link, lambda: expect(link).to_have_count(0, timeout=EVENTUALLY_POLL_MS))
        toggle = page.get_by_role("button", name=re.compile(r"^(Watch lot|Watching)$"))
        eventually(toggle, lambda: expect(toggle).to_be_visible(timeout=EVENTUALLY_POLL_MS))
        names = tab_order(page, 3)
        assert names[2] == "Watch lot", f"Watch lot is reached by keyboard third (L193): {names}"
        page.keyboard.press("Enter")
        wait_text(page, f"Watching lot {n}.", "the watching confirmation (L293)")
        eventually(toggle, lambda: expect(toggle).to_have_attribute("aria-pressed", "true", timeout=EVENTUALLY_POLL_MS))
        eventually(toggle, lambda: expect(toggle).to_be_focused(timeout=EVENTUALLY_POLL_MS))
        eventually(link, lambda: expect(link).to_be_visible(timeout=EVENTUALLY_POLL_MS), window)
        page.keyboard.press("Enter")
        wait_text(page, f"No longer watching lot {n}.", "the unwatching confirmation (L294)")
        eventually(link, lambda: expect(link).to_have_count(0, timeout=EVENTUALLY_POLL_MS), window)
    assert ok(bidder.get(f"/api/lots/{lot['id']}"), 200, "lot")["lot"]["watching"] is False


def test_wf_watch_list_leading_live(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot = sale.lots[0]
    n, name = lot["lot_number"], f"Lot {lot['lot_number']}, {lot['title']}"
    bidder, rival = new_bidder(env), new_bidder(env)
    outbid = f"You have been outbid on lot {n}."
    window = (LIVE_MS + VIEW_SLACK_MS) / 1000
    with view(browser, env.base, "/bidder", bidder) as page:
        leading = page.get_by_role("region", name="Leading")
        notices_region = page.get_by_role("region", name="Notices")
        eventually(leading, lambda: expect(leading).to_be_visible(timeout=EVENTUALLY_POLL_MS))
        listen(page)
        link = leading.get_by_role("link", name=name, exact=True)
        ok(bid(bidder, lot["id"], 1700), 201, "the bidder takes the lead")
        live(page, lambda: link.count() == 1, window, "Leading lists the lot in place (L128)")
        ok(bid(rival, lot["id"], 1900), 201, "a rival outbids")
        live(page, lambda: link.count() == 0, window, "Leading drops the lot in place when outbid (L128)")
        wait_said(page, outbid)
        text = notices_region.inner_text()
        approved = f"Your spending limit of {euros(LIMIT_TOP)} is approved."
        assert outbid in text and text.index(outbid) < text.index(approved), f"the newest notice is first (L171): {text}"
        advance(page, 2000)
        assert said_count(page, outbid) == 1, f"the outbid notice is announced once (L307): {said(page)}"


def test_wf_privacy_signed_out(env: SimpleNamespace) -> None:
    anonymous = Member(env.base)
    for path in PERSONAL_PATHS:
        err(anonymous.get(path), 401, "signed_out", f"signed-out GET {path} (L389, L443)")
    bidder = new_bidder(env)
    ok(bidder.get("/api/me"), 200, "GET /api/me while signed in")
    stale = Member(env.base, dict(bidder.http.cookies.items()))
    out = bidder.post("/auth/logout")
    assert out.status_code == 303 and urlsplit(out.headers.get("location", "")).path == "/", (
        f"POST /auth/logout answers 303 to / (L442); got {out.status_code}")
    for path in PERSONAL_PATHS:
        err(stale.get(path), 401, "signed_out", f"GET {path} with a signed-out session's cookie (L784)")
    err(bid(stale, make_sale(env, [SPEC_A], DAY_AHEAD).ids[0], 1600), 401, "signed_out",
        "a bid with a signed-out session's cookie (L784)")


def test_wf_privacy_sign_out_socket(browser: Browser, env: SimpleNamespace) -> None:
    sale = make_sale(env, [SPEC_A], DAY_AHEAD)
    lot_id, n = sale.ids[0], sale.lots[0]["lot_number"]
    bidder, rival = new_bidder(env), new_bidder(env)
    ok(bid(bidder, lot_id, 1700), 201, "the bidder leads")
    with view(browser, env.base, f"/lots/{lot_id}", bidder) as page:
        shows(board(page), "You lead")
        listen(page)
        probe = page.context.new_page()
        probe.goto(f"{env.base}/api/health")
        since = public_view(env, lot_id)["seq"]
        assert probe.evaluate(SOCKET_JS, since) is True, "the session opens a socket from its seq (L542)"
        out = Member(env.base, dict(bidder.http.cookies.items())).post("/auth/logout")
        assert out.status_code == 303, f"POST /auth/logout answers 303 (L442); got {out.status_code}"
        wait_for(lambda: probe.evaluate("() => window.__socket.readyState") == 3, (LIVE_MS + VIEW_SLACK_MS) / 1000,
                 "the socket the signed-out session opened is closed within a second (L784)")
        advance(page, RECONNECT_MS)
        ok(bid(rival, lot_id, 1900), 201, "a rival outbids after the sign-out")
        wait_for(lambda: public_lot(env, lot_id)["price"] == PRICE_1750, WAIT_S, "the server records the outbid")
        with view(browser, env.base, f"/lots/{lot_id}") as observer:
            shows(board(observer), f"Paddle {rival.paddle} leads", (LIVE_MS + VIEW_SLACK_MS) / 1000 + SLACK_S)
        advance(page, LIVE_MS + VIEW_SLACK_MS)
        late = [f for f in probe.evaluate("() => window.__frames") if f.get("type") == "notice"]
        assert not late, f"no notice reaches the signed-out session's socket (L784): {late}"
        assert said_count(page, f"You have been outbid on lot {n}.") == 0, f"no notice is announced: {said(page)}"


def test_wf_cross_cutting_json_integers(short_env: SimpleNamespace) -> None:
    env = short_env
    admin = staff(env.base, "admin")
    pending = new_person(env.base, "bidder")
    reg = register(pending, "bidder")["registration"]
    for bad in ("3000", 3000.5, True):
        body = err(admin.post(f"/api/admin/registrations/{reg['id']}/approve", {"spending_limit": bad}), 422, "invalid",
                   f"spending_limit {bad!r} (L381)")
        assert body["fields"] == {"spending_limit": APPROVAL_ERROR}, f"limit sentence for {bad!r} (L362): {body}"
    assert ok(pending.get("/api/me"), 200, "GET /api/me")["registration"]["status"] == "pending", "nothing changed"
    sale = make_sale(env, [SPEC_A, SPEC_A], SHORT_LEAD)
    top = new_bidder(env)
    ok(bid(top, sale.ids[0], 1700), 201, "a top bid below the reserve")
    for bad in ("1700", 1700.5, True):
        body = err(bid(top, sale.ids[1], bad), 422, "invalid", f"max_amount {bad!r} (L381)")
        assert body["fields"] == {"max_amount": WHOLE_ERROR}, f"bid sentence for {bad!r} (L286): {body}"
    assert public_lot(env, sale.ids[1])["bid_count"] == 0, "refused bids add nothing"
    wait_closed(env, sale.ids[:1])
    path = f"/api/consign/lots/{sale.ids[0]}/second-chance"
    for bad in ("1700", 1700.5, True):
        body = err(sale.consignor.post(path, {"amount": bad}), 422, "invalid", f"offer amount {bad!r} (L381)")
        assert body["fields"] == {"amount": WHOLE_ERROR}, f"offer sentence for {bad!r} (L345): {body}"
    lot = consignor_lot(sale.consignor, sale.ids[0])
    assert lot["offer"] is None and lot["second_chance_open"] is True, "refused offers change nothing"


def test_wf_cross_cutting_desk_state(browser: Browser, short_env: SimpleNamespace) -> None:
    env = short_env
    sale = make_sale(env, [HAMMER_1250], SHORT_LEAD)
    ok(bid(new_bidder(env), sale.ids[0], 1250), 201, "a winning bid")
    wait_closed(env, sale.ids)
    cashier = staff(env.base, "cashier")
    number = wait_for(lambda: [i["number"] for i in ok(cashier.get("/api/desk/invoices?status=issued"), 200, "invoices")[
        "invoices"] if i["sale_id"] == sale.id], WAIT_S, "the sale's invoice reaches the desk")[0]
    radio = lambda page, label: page.get_by_role("radio", name=label, exact=True)
    table = lambda page: page.get_by_role("table", name="Invoices")
    lists = lambda page: eventually(table(page), lambda: expect(table(page)).to_contain_text(
        number, timeout=EVENTUALLY_POLL_MS))
    with view(browser, env.base, "/desk/cashier", cashier) as page:
        eventually(radio(page, "Unpaid"), lambda: expect(radio(page, "Unpaid")).to_be_checked(timeout=EVENTUALLY_POLL_MS))
        check(radio(page, "All"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/desk/cashier\?show=all$"),
                                                         timeout=EVENTUALLY_POLL_MS))
        eventually(radio(page, "All"), lambda: expect(radio(page, "All")).to_be_checked(timeout=EVENTUALLY_POLL_MS))
        lists(page)
        page.reload()
        eventually(radio(page, "All"), lambda: expect(radio(page, "All")).to_be_checked(timeout=EVENTUALLY_POLL_MS))
        lists(page)
        check(radio(page, "Paid"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/desk/cashier\?show=paid$"),
                                                         timeout=EVENTUALLY_POLL_MS))
        page.go_back()
        eventually(radio(page, "All"), lambda: expect(radio(page, "All")).to_be_checked(timeout=EVENTUALLY_POLL_MS))
        lists(page)
        second = page.context.new_page()
        second.goto(env.base + "/desk/cashier?show=paid")
        eventually(radio(second, "Paid"), lambda: expect(radio(second, "Paid")).to_be_checked(timeout=EVENTUALLY_POLL_MS))
        eventually(radio(second, "Unpaid"), lambda: expect(radio(second, "Unpaid")).not_to_be_checked(timeout=EVENTUALLY_POLL_MS))


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), f"run.json {key} is a command"


def test_if_third_party_notices() -> None:
    notices_text = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices_text]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing}"
    for font in ("Anton", "Work Sans"):
        assert font in notices_text, f"{font} is listed"


CLASSIC_ISC = ("permission to use, copy, modify, and distribute this software for any purpose with or without fee is "
               "hereby granted, provided that the above copyright notice and this permission notice appear in all copies")


def module_licence(package: Any) -> str:
    if package.licence:
        return package.licence
    escaped = re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), package.name)
    folders = [conftest.APP_HOME / "go" / "pkg" / "mod" / f"{escaped}@{package.version}",
               *[folder / "vendor" / package.name for folder in project_dirs(DEPLOYED_APP)]]
    for folder in (f for f in folders if f.is_dir()):
        for path in sorted(folder.glob("*")):
            if path.is_file() and re.match(r"(?i)licen[cs]e|copying", path.name):
                if CLASSIC_ISC in " ".join(path.read_text(errors="replace").lower().split()):
                    return "ISC"
    return ""


def test_if_licences() -> None:
    bad = [(p.name, module_licence(p)) for p in shipped_packages()
           if not licence_allowed(module_licence(p), ALLOWED_LICENCES)]
    assert not bad, f"packages outside the licence allowlist: {bad}"
    assert "OFL-1.1" in (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text(), "the fonts are listed as OFL-1.1"


def test_if_datastores() -> None:
    others = ("sqlite", "redis", "bbolt", "boltdb", "badger", "leveldb", "mongo", "memcache", "nats", "kafka",
              "amqp", "pebble", "lowdb", "nedb")
    found = [p.name for p in shipped_packages() if any(word in p.name.lower() for word in others)]
    assert not found, f"other datastores shipped: {found}"
    stores = [str(path) for folder in project_dirs(DEPLOYED_APP) for pattern in ("*.db", "*.sqlite", "*.sqlite3")
              for path in folder.glob(pattern)]
    assert not stores, f"file-based stores: {stores}"


def _tool_calls(node: Any) -> Iterator[tuple[str, dict]]:
    if isinstance(node, dict):
        name = node.get("name") or node.get("function_name") or node.get("tool_name")
        args = node.get("input", node.get("arguments", node.get("args")))
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {"command": args}
        if isinstance(name, str) and isinstance(args, dict):
            yield name, args
        for value in node.values():
            yield from _tool_calls(value)
    elif isinstance(node, list):
        for value in node:
            yield from _tool_calls(value)


def test_if_service_config_untouched() -> None:
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return
    config = re.compile(r"(compose[^/\s]*\.ya?ml|realm[^/\s]*\.json)", re.I)
    writes = []
    for name, args in _tool_calls(json.loads(trajectory.read_text())):
        target = str(args.get("file_path") or args.get("path") or "")
        command = str(args.get("command", ""))
        if name in ("Write", "Edit", "MultiEdit", "write_file", "edit_file", "str_replace_based_edit_tool"):
            if config.search(target):
                writes.append((name, target[:200]))
        elif re.search(r"(sed\s+-i\S*\s[^|;&]*|>>?\s*|\btee\s+(-a\s+)?)\S*(compose[^/\s]*\.ya?ml|realm[^/\s]*\.json)",
                       command, re.I):
            writes.append((name, command[:200]))
    assert not writes, f"the provided service configuration was modified: {writes}"


def test_if_no_third_party_origins(browser: Browser, env: SimpleNamespace) -> None:
    current = ok(httpx.get(f"{env.base}/api/sales/current", timeout=HTTP_TIMEOUT), 200, "current sale")["sale"]
    lots = ok(httpx.get(f"{env.base}/api/sales/{current['id']}/catalogue", timeout=HTTP_TIMEOUT), 200,
              "catalogue")["lots"]
    for path in ("/", "/catalogue", f"/lots/{lots[0]['id']}"):
        with open_app(browser, env.base + "/") as page:
            seen: list[str] = []
            page.on("request", lambda r: seen.append(r.url))
            page.goto(env.base + path)
            eventually(page.get_by_role("heading", level=1), lambda: expect(page.get_by_role("heading", level=1)).to_be_visible(timeout=EVENTUALLY_POLL_MS), (UI_MS) / 1000)
            foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, env.base)]
            assert not foreign, f"{path} loaded from other origins: {foreign}"


def test_if_lockfiles() -> None:
    folders = project_dirs(APP_ROOT)
    sums = [f / "go.sum" for f in folders if (f / "go.sum").exists()]
    locks = [f / "package-lock.json" for f in folders if (f / "package-lock.json").exists()]
    assert sums and locks, "go.sum and package-lock.json are committed"
    text = "\n".join(path.read_text() for path in sums + locks)
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"shipped packages missing from the lockfiles: {missing}"
