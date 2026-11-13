from __future__ import annotations

import calendar
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
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    WireMock,
    advance,
    fill,
    layout,
    licence_allowed,
    open_app,
    select,
    settle,
    shipped_packages,
)

PASSWORD = "Tidecraft-demo-2026"
MARA = "mara@tidecraft.example"
JUNIPER = "juniper@tidecraft.example"
KENJI = "kenji@tidecraft.example"
PRIYA = "priya@tidecraft.example"
THEO = "theo@tidecraft.example"
WEN = "wen@tidecraft.example"
BOARD = (PRIYA, THEO, WEN)
JUNIPER_GRANT = "TC-OPT-0007"
KENJI_GRANT = "TC-OPT-0011"
JUNIPER_START = date(2025, 1, 31)
JUNIPER_OPTIONS = 48000
HARBOURLINE_ID = "PER-011"
BUYER = "Harbourline Secondary Partners"
PACIFIC = ZoneInfo("America/Los_Angeles")

MARKS = 48
CLIFF_MONTHS = 12
HUNDREDTHS = 10000
OFFER_WINDOW_S = 2592000
LEAVER_WINDOW_S = 7776000
PROVIDER_ANSWER_S = 5
BODY_LIMIT = 65536
TARGET_PX = 44
TITLE_MIN_MS = 400
TITLE_MAX_MS = 600
CELL_MIN_MS = 150
CELL_MAX_MS = 250
COUNT_MAX_MS = 400
DRAFT_SAVE_MS = 1000
QUICK_MS = 3000
VIEWPORTS = {"375": (375, 812), "768": (768, 1024), "1280": (1280, 800)}

HTTP_TIMEOUT_S = 25
PAGE_MS = 15000
PAGE_S = 15
EXPECT_STEP_MS = 1000
ADVANCE_STEP_MS = 250
LIVE_WAIT_S = 10
POLL_S = 0.25
TENDER_WAIT_S = 150
ALLOC_GRACE_S = 8
EXPIRY_WAIT_S = 150
COPY_BOOT_S = 120
TAB_PRESSES = 12
TAB_SCAN = 40
HTTP_PORT = 80
WS_KEY = "dGhlIHNhbXBsZSBub25jZQ=="
FOREIGN_ORIGIN = "http://evil.example"
RECONNECT_PAGE_MS = 12000
RECONNECT_STEP_MS = 500
GRANT_PAGE_LEAD_S = 4
SKEW_DAYS = 40
DEFAULT_OPTIONS = 4800
DRAFT_OPTIONS = DEFAULT_OPTIONS
AGE_MONTHS = 36
SCHEDULE_OPTIONS = 5000
ISSUE_SHARES = 7777
BIG_ISSUE = 5000000
SLOW_DELAY_MS = 7000
EDGE_LEAD_S = 1.5
COUNTDOWN_SLACK_S = 10
CLOSE_SHORT_S = 15
TENDER_LEAD_S = 70
ANNOUNCE_CLOSE_S = 45
NDA_TENDER_S = 45

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
STATE_WORDS = {"draft": "Draft", "board_queue": "With the board", "approved": "Approved",
               "offered": "Offered", "accepted": "Accepted", "expired": "Expired"}
BRIEF_MONTH_ENDS = {12: "2026-01-31", 13: "2026-02-28", 14: "2026-03-31", 15: "2026-04-30", 37: "2028-02-29"}
COUNTDOWN = re.compile(r"^\s*\d+d \d{2}:\d{2}:\d{2}")
COUNTDOWN_LEFT = re.compile(r"^\s*\d+d \d{2}:\d{2}:\d{2} left\s*$")
ALLOWED_LICENCES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "OFL-1.1", "CC0-1.0"}
FORBIDDEN_STORES = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "memcached", "level", "lowdb", "nedb", "keyv"}

_TICK = threading.Event()


@pytest.fixture(autouse=True)
def _provider_baseline(request: pytest.FixtureRequest) -> Iterator[None]:
    yield
    if "wiremock" in request.fixturenames:
        WireMock()


def poll(fetch: Callable[[], Any], ok: Callable[[Any], bool], seconds: float, message: str, soft: bool = False) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fetch()
        if ok(last):
            return last
        _TICK.wait(POLL_S)
    if soft:
        return last
    pytest.fail(f"{message}; last value: {last!r}")


def eventually(page: Page, check: Callable[[], None], message: str, seconds: float = PAGE_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            check()
            return
        except (AssertionError, PlaywrightError) as exc:
            last = exc
        advance(page, ADVANCE_STEP_MS)
    pytest.fail(f"{message}: {last}")


def parse_instant(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    return moment.astimezone(parse_instant("1970-01-01T00:00:00Z").tzinfo).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def fmt_count(value: int | str) -> str:
    return f"{int(value):,}"


def fmt_money(value: str | Decimal) -> str:
    return "$" + f"{Decimal(str(value)):,.2f}"


def fmt_price(value: str | Decimal) -> str:
    return "$" + f"{Decimal(str(value)):,.4f}"


def fmt_date(text: str) -> str:
    day = date.fromisoformat(text)
    return f"{day.day} {MONTHS[day.month - 1]} {day.year}"


def tile(*parts: str) -> re.Pattern[str]:
    return re.compile(r"\s*".join(re.escape(part) for part in parts))


def half_up(value: Fraction) -> int:
    return (value.numerator * 2 + value.denominator) // (value.denominator * 2)


def pct2(numerator: int, denominator: int) -> str:
    hundredths = half_up(Fraction(numerator * HUNDREDTHS, denominator))
    return f"{hundredths // 100}.{hundredths % 100:02d}"


def cost_of(options: int, strike: str) -> Decimal:
    return (Decimal(options) * Decimal(strike)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def cents(amount: Decimal | str) -> int:
    return int((Decimal(str(amount)) * 100).to_integral_value())


def add_months(start: date, months: int) -> date:
    index = start.month - 1 + months
    year, month = start.year + index // 12, index % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


def mark_date(start: date, mark: int) -> date:
    return add_months(start, mark)


def cumulative_at(options: int, vesting_type: str, mark: int) -> int:
    if vesting_type == "standard" and mark < CLIFF_MONTHS:
        return 0
    return options * mark // MARKS


def latest_mark(start: date, today: date) -> int | None:
    marks = [m for m in range(MARKS + 1) if mark_date(start, m) <= today]
    return max(marks) if marks else None


def cell_marks(vesting_type: str) -> list[int]:
    if vesting_type == "standard":
        return [CLIFF_MONTHS] + list(range(CLIFF_MONTHS + 1, MARKS + 1))
    return list(range(1, MARKS + 1))


def largest_remainder(shares: list[int]) -> list[str]:
    total = sum(shares)
    exact = [Fraction(s * HUNDREDTHS, total) for s in shares]
    floors = [e.numerator // e.denominator for e in exact]
    missing = HUNDREDTHS - sum(floors)
    order = sorted(range(len(shares)), key=lambda i: (-(exact[i] - floors[i]), -shares[i], i))
    for i in order[:missing]:
        floors[i] += 1
    return [f"{h // 100}.{h % 100:02d}" for h in floors]


def allocate(cap: int, tendered: list[int]) -> list[int]:
    total = sum(tendered)
    if total <= cap:
        return list(tendered)
    shares = [t * cap // total for t in tendered]
    for i in range(cap - sum(shares)):
        shares[i] += 1
    return shares


def scenario_oracle(pre: str, inv: str, pool: str, total: int, unallocated: int) -> dict[str, Any] | None:
    pre_f, inv_f, p_f = Fraction(Decimal(pre)), Fraction(Decimal(inv)), Fraction(Decimal(pool))
    k = p_f / 100 * (pre_f + inv_f) / pre_f
    if k >= 1:
        return None
    top_up = max(0, math.ceil((k * total - unallocated) / (1 - k)))
    price_units = math.floor(pre_f / (total + top_up) * HUNDREDTHS)
    price = Fraction(price_units, HUNDREDTHS)
    new_shares = math.floor(inv_f / price)
    after = total + top_up + new_shares
    used = half_up(Fraction(new_shares * price_units * 100, HUNDREDTHS))
    return {
        "pool_top_up": top_up,
        "price_per_share": f"{price_units // HUNDREDTHS}.{price_units % HUNDREDTHS:04d}",
        "new_shares": new_shares,
        "fully_diluted_after": after,
        "new_investor_percent": pct2(new_shares, after),
        "pool_after_percent": pct2(unallocated + top_up, after),
        "dilution_percent": pct2(top_up + new_shares, after),
        "investment_used": f"{used // 100}.{used % 100:02d}",
    }


def new_key() -> str:
    return "key-" + uuid.uuid4().hex


def plain(text: str) -> str:
    return re.sub(r"(?<=\d),(?=\d{3})", "", text)


def client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)


def login(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    c = client(base)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, f"sign-in as {email}: {r.status_code} {r.text}"
    return c


_SESSIONS: dict[tuple[str, str], httpx.Client] = {}


def shared(base: str, email: str) -> httpx.Client:
    key = (base, email)
    if key not in _SESSIONS:
        _SESSIONS[key] = login(base, email)
    return _SESSIONS[key]


def admin(base: str) -> httpx.Client:
    return shared(base, MARA)


def outage_url(name: str) -> str:
    value = os.environ.get(name)
    assert value, f"the verifier environment must name {name}"
    return value.rstrip("/")


def refused(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code} {response.text}"
    body = response.json()
    assert body["error"]["code"] == code, body
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    return body


def invalid(response: httpx.Response) -> dict[str, str]:
    body = refused(response, 422, "validation")
    assert "fields" in body and "fields" not in body["error"], body
    return body["fields"]


def server_now(c: httpx.Client) -> datetime:
    return parse_instant(c.get("/api/me").json()["server_time"])


def server_day(c: httpx.Client) -> date:
    return date.fromisoformat(c.get("/api/me").json()["server_date"])


def pool_of(c: httpx.Client) -> dict[str, int]:
    r = c.get("/api/pool")
    assert r.status_code == 200, r.text
    return r.json()


def cap_table(c: httpx.Client) -> dict[str, Any]:
    r = c.get("/api/cap-table")
    assert r.status_code == 200, r.text
    return r.json()


def issued_of(c: httpx.Client, person_id: str) -> int:
    return next((row["issued_shares"] for row in cap_table(c)["rows"] if row["key"] == person_id), 0)


def admin_total(base: str) -> int:
    return cap_table(admin(base))["fully_diluted_total"]


def ledger(c: httpx.Client) -> list[dict[str, Any]]:
    r = c.get("/api/ledger")
    assert r.status_code == 200, r.text
    return r.json()["entries"]


def current_fmv(adm: httpx.Client) -> Decimal:
    data = adm.get("/api/valuations").json()
    current = next(v for v in data["valuations"] if v["id"] == data["current_id"])
    return Decimal(current["fmv_per_share"])


def current_effective(adm: httpx.Client) -> date:
    data = adm.get("/api/valuations").json()
    return date.fromisoformat(next(v for v in data["valuations"] if v["id"] == data["current_id"])["effective_on"])


def strike_for(adm: httpx.Client, extra: str = "0.0005") -> str:
    return f"{current_fmv(adm) + Decimal(extra):.4f}"


def new_person(base: str, role: str = "option_holder", prefix: str = "holder") -> tuple[dict[str, Any], httpx.Client]:
    tag = uuid.uuid4().hex[:8]
    name, email = f"{prefix.title()} {tag}", f"{prefix}-{tag}@tidecraft.example"
    r = admin(base).post("/api/people", json={"name": name, "email": email, "role": role, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return r.json()["person"], login(base, email)


def draft_grant(base: str, holder_id: str, *, options: int = DEFAULT_OPTIONS, vesting: str = "monthly",
                start: str | None = None, strike: str | None = None) -> dict[str, Any]:
    adm = admin(base)
    body = {"holder_id": holder_id, "options": options, "strike": strike or strike_for(adm), "vesting_type": vesting,
            "vesting_start": start or add_months(server_day(adm), -AGE_MONTHS).isoformat()}
    r = adm.post("/api/grants", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def queue_grant(base: str, gid: str) -> dict[str, Any]:
    r = admin(base).post(f"/api/grants/{gid}/submit", json={})
    assert r.status_code == 200, r.text
    return r.json()


def vote(c: httpx.Client, gid: str, choice: str) -> httpx.Response:
    return c.post(f"/api/board/queue/{gid}/votes", json={"vote": choice})


def approve(base: str, gid: str) -> None:
    for email in BOARD:
        r = vote(shared(base, email), gid, "approve")
        assert r.status_code in (200, 409), r.text
        if r.status_code == 200 and r.json().get("state") == "approved":
            return
    pytest.fail(f"the board never approved {gid}")


def offered_grant(base: str, **kw: Any) -> tuple[dict[str, Any], httpx.Client, dict[str, Any]]:
    person, hc = new_person(base)
    grant = draft_grant(base, person["id"], **kw)
    queue_grant(base, grant["id"])
    approve(base, grant["id"])
    r = admin(base).post(f"/api/grants/{grant['id']}/offer", json={})
    assert r.status_code == 200, r.text
    return person, hc, r.json()


def holder_with_grant(base: str, **kw: Any) -> tuple[dict[str, Any], httpx.Client, dict[str, Any]]:
    person, hc, grant = offered_grant(base, **kw)
    r = hc.post(f"/api/grants/{grant['id']}/accept", json={})
    assert r.status_code == 200, r.text
    return person, hc, r.json()


def exercise(hc: httpx.Client, gid: str, options: Any, key: str | None = None) -> httpx.Response:
    return hc.post(f"/api/grants/{gid}/exercises", json={"options": options}, headers={"Idempotency-Key": key or new_key()})


def orders_of(hc: httpx.Client) -> list[dict[str, Any]]:
    return hc.get("/api/exercises").json()["orders"]


def wait_order(hc: httpx.Client, oid: str, states: tuple[str, ...], seconds: float = LIVE_WAIT_S + 10) -> dict[str, Any]:
    return poll(lambda: hc.get(f"/api/exercises/{oid}").json(), lambda o: o["state"] in states, seconds, f"order {oid} to reach {states}")


def departure(base: str, person_id: str) -> dict[str, Any]:
    r = admin(base).post(f"/api/people/{person_id}/departure", json={})
    assert r.status_code == 200, r.text
    return r.json()["person"]


def investor_with_shares(base: str, shares: int, cls: str = "Common") -> tuple[dict[str, Any], httpx.Client]:
    person, c = new_person(base, role="investor", prefix="investor")
    r = admin(base).post("/api/issuances", json={"holder_id": person["id"], "class": cls, "shares": shares})
    assert r.status_code == 201, r.text
    return person, c


def await_no_open_tender(adm: httpx.Client) -> None:
    poll(lambda: [t for t in adm.get("/api/tenders").json()["tenders"] if t["state"] == "open"], lambda o: not o,
         TENDER_WAIT_S, "an earlier tender to close")


def open_tender(base: str, cap: int, price: str, close_in_s: int, title: str | None = None) -> dict[str, Any]:
    adm = admin(base)
    await_no_open_tender(adm)
    closes = server_now(adm) + timedelta(seconds=close_in_s)
    r = adm.post("/api/tenders", json={"title": title or f"Tender {uuid.uuid4().hex[:8]}", "price_per_share": price,
                                       "share_cap": cap, "closes_at": iso(closes)})
    assert r.status_code == 201, r.text
    return r.json()


def wait_tender(c: httpx.Client, tid: str, state: str, seconds: float) -> dict[str, Any]:
    tender = poll(lambda: c.get(f"/api/tenders/{tid}").json(), lambda t: t["state"] != "open", seconds, f"tender {tid} to close")
    if state == "allocated" and tender["state"] != "allocated":
        tender = poll(lambda: c.get(f"/api/tenders/{tid}").json(), lambda t: t["state"] == "allocated", ALLOC_GRACE_S,
                      f"tender {tid} to be allocated", soft=True)
    return tender


def sign_nda(c: httpx.Client, tid: str) -> dict[str, Any]:
    r = c.post(f"/api/tenders/{tid}/nda", json={})
    assert r.status_code == 200, r.text
    return r.json()


def submit_tender(c: httpx.Client, tid: str, shares: int) -> httpx.Response:
    return c.post(f"/api/tenders/{tid}/submissions", json={"shares": shares})


def poll_key(key: str) -> bytes:
    prefix = key.rsplit("/", 1)[0] + "/"
    poll(lambda: S3().keys(prefix), lambda keys: key in keys, LIVE_WAIT_S + 10, f"vault object {key}")
    return S3().get(key)


def req_part(entry: dict[str, Any]) -> dict[str, Any]:
    return entry.get("request", entry)


def req_body(entry: dict[str, Any]) -> dict[str, Any]:
    body = req_part(entry).get("body")
    if isinstance(body, str) and body:
        return json.loads(body)
    return body if isinstance(body, dict) else {}


def req_header(entry: dict[str, Any], name: str) -> str | None:
    for key, value in (req_part(entry).get("headers") or {}).items():
        if key.lower() == name.lower():
            return value[0] if isinstance(value, list) else value
    return None


def payments_for(wiremock: WireMock, reference: str) -> list[dict[str, Any]]:
    return [e for e in wiremock.requests("/v1/payments", "POST") if req_body(e).get("reference") == reference]


def stub_templated(wiremock: WireMock, method: str, request: dict[str, str], status: int, body: str) -> None:
    created = wiremock.client.post("/__admin/mappings", json={
        "priority": 1, "request": {"method": method, **request},
        "response": {"status": status, "headers": {"Content-Type": "application/json"}, "transformers": ["response-template"], "body": body}})
    assert created.status_code == 201, created.text


def stub_pending_payment(wiremock: WireMock, options: int, strike: str, *, record_status: str = "pending",
                         record_amount: int | None = None, record_reference: str | None = None) -> int:
    amount = cents(cost_of(options, strike))
    ref = "{{jsonPath request.body '$.reference'}}"
    stub_templated(wiremock, "POST", {"urlPath": "/v1/payments"}, 201,
                   '{"id":"pay_%d_%s","status":"pending","amount_cents":%d,"currency":"USD","reference":"%s"}' % (amount, ref, amount, ref))
    confirmed = '"2026-11-03T17:04:05Z"' if record_status == "confirmed" else "null"
    stub_templated(wiremock, "GET", {"urlPathPattern": f"/v1/payments/pay_{amount}_[A-Za-z0-9-]+"}, 200,
                   "{{regexExtract request.path 'pay_([0-9]+)_([A-Za-z0-9-]+)' 'parts'}}"
                   '{"id":"pay_{{parts.0}}_{{parts.1}}","status":"%s","amount_cents":%d,"currency":"USD","reference":"%s","confirmed_at":%s}'
                   % (record_status, record_amount if record_amount is not None else amount, record_reference or "{{parts.1}}", confirmed))
    return amount


def stub_confirmed(wiremock: WireMock, pid: str, amount: int, reference: str) -> None:
    wiremock.stub("GET", f"/v1/payments/{pid}", json={"id": pid, "status": "confirmed", "amount_cents": amount, "currency": "USD",
                                                      "reference": reference, "confirmed_at": "2026-11-03T17:04:05Z"})


def restore_provider(wiremock: WireMock, order: dict[str, Any]) -> None:
    amount = cents(order["cost"])
    wiremock.stub("POST", "/v1/payments", status=201,
                  json={"id": f"pay_{amount}_{order['id']}", "status": "pending", "amount_cents": amount,
                        "currency": "USD", "reference": order["id"]})


@contextmanager
def browse(browser: Browser, base: str, *, reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, base, reduced_motion=reduced_motion) as page:
        yield page


def signed_in(page: Page, base: str, c: httpx.Client, path: str = "/") -> None:
    page.context.add_cookies([{"name": k.name, "value": k.value, "url": base} for k in c.cookies.jar])
    page.goto(base + path)


def status(page: Page) -> Locator:
    return page.get_by_role("status", name="Register updates")


SHOWN_JS = """(els) => els.some((e) => {
  if (e.closest('[role=status]')) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
})"""


def retry_button(page: Page, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True).first


def is_shown(page: Page, text: Any) -> bool:
    return page.get_by_text(text).evaluate_all(SHOWN_JS)


def _assert_shown(page: Page, text: Any) -> None:
    assert is_shown(page, text), f"{text!r} is not shown in the page (outside the status region)"


def _assert_not_shown(page: Page, text: Any) -> None:
    assert not is_shown(page, text), f"{text!r} is shown in the page"


def expect_shown(page: Page, text: Any, seconds: float = PAGE_S) -> None:
    eventually(page, lambda: _assert_shown(page, text), f"page copy {text!r}", seconds)


def expect_not_shown(page: Page, text: Any, seconds: float = QUICK_MS / 1000) -> None:
    eventually(page, lambda: _assert_not_shown(page, text), f"no page copy {text!r}", seconds)


WATCH_JS = """() => {
  window.__announced = [];
  if (window.__watching) return;
  window.__watching = true;
  const named = (r) => {
    const by = r.getAttribute('aria-labelledby');
    const name = (r.getAttribute('aria-label') || '') + ' ' + (by ? by.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ') : '');
    return name.includes('Register updates') || document.querySelectorAll('[role=status]').length === 1;
  };
  const region = (n) => { const el = n && (n.nodeType === 1 ? n : n.parentElement); const r = el && el.closest('[role=status]'); return r && named(r) ? r : null; };
  const note = (text) => { const t = (text || '').trim(); if (t) window.__announced.push(t); };
  new MutationObserver((records) => {
    for (const r of records) {
      if (!region(r.target)) continue;
      if (r.type === 'characterData') note(r.target.data);
      else r.addedNodes.forEach((n) => note(n.textContent));
    }
  }).observe(document.documentElement, {childList: true, characterData: true, subtree: true});
}"""


def watch_announcements(page: Page) -> None:
    status(page).wait_for(state="attached", timeout=PAGE_MS)
    page.evaluate(WATCH_JS)


def announced(page: Page) -> list[str]:
    return page.evaluate("() => window.__announced || []")


def times_once(log: list[str], copy: str) -> int:
    return sum(1 for entry in log if copy in entry)


def expect_announced(page: Page, copy: str) -> None:
    eventually(page, lambda: _assert_announced(page, copy), f"announcement {copy!r}")


def _assert_announced(page: Page, copy: str) -> None:
    assert times_once(announced(page), copy) >= 1, f"{copy!r} not announced; saw {announced(page)}"


def type_into(page: Page, locator: Locator, text: str) -> None:
    locator.focus()
    page.keyboard.press("Control+A")
    page.keyboard.type(text)


def sign_in_form(page: Page, email: str, password: str = PASSWORD) -> None:
    title = page.get_by_role("heading", level=1, name="Your shares, on the record.")
    if title.count():
        settle(title)
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password"), password)


def inside(dialog: Locator) -> bool:
    return dialog.evaluate("(d) => d.contains(document.activeElement)")


def focused_text(page: Page) -> str:
    return page.evaluate("() => ((document.activeElement && document.activeElement.textContent) || '').trim()")


def ribbon_items(page: Page) -> Locator:
    return page.get_by_role("list", name="Tranches").get_by_role("listitem")


def ribbon_names(grant: dict[str, Any]) -> list[str]:
    by = {t["month"]: t for t in grant["schedule"]}
    return [f"{fmt_date(by[m]['date'])}, {fmt_count(by[m]['cumulative'])} options, {by[m]['state']}" for m in cell_marks(grant["vesting_type"])]


def expect_ribbon(page: Page, grant: dict[str, Any]) -> None:
    names = ribbon_names(grant)
    items = ribbon_items(page)
    expect(items).to_have_count(len(names), timeout=PAGE_MS)
    for index, name in enumerate(names):
        expect(items.nth(index)).to_have_accessible_name(re.compile("^" + re.escape(name) + "$"), timeout=PAGE_MS)


def _figures_check(page: Page, tranche: dict[str, Any]) -> Callable[[], None]:
    def run() -> None:
        group = page.get_by_role("group", name="Projection figures")
        expect(group).to_contain_text(fmt_count(tranche["cumulative"]), timeout=EXPECT_STEP_MS)
        expect(group).to_contain_text(fmt_money(tranche["cost_at_strike"]), timeout=EXPECT_STEP_MS)
        expect(group).to_contain_text(f"{tranche['vested_ownership']}%", timeout=EXPECT_STEP_MS)
    return run


def marker_check(page: Page, grant: dict[str, Any], mark: int, today_mark: int) -> None:
    by = {t["month"]: t for t in grant["schedule"]}
    slider = page.get_by_role("slider", name="Projection date")
    text = fmt_date(by[mark]["date"]) + (" (today)" if mark == today_mark else "")
    expect(slider).to_have_attribute("aria-valuenow", str(mark), timeout=PAGE_MS)
    expect(slider).to_have_attribute("aria-valuetext", text, timeout=PAGE_MS)
    eventually(page, _figures_check(page, by[mark]), f"projection figures at mark {mark}")


def projected_count(page: Page) -> int:
    return page.get_by_role("list", name="Tranches").get_by_role("listitem", name=re.compile(r", projected$")).count()


def state_word(page: Page, word: str) -> Callable[[], None]:
    return lambda: _assert_shown(page, re.compile(rf"\b{re.escape(word)}\b"))


def labelled(page: Page, label: str, value: str) -> Locator:
    return page.get_by_text(tile(label, value)).first


CELL_POS_JS = """() => {
  const el = document.activeElement;
  if (!el) return null;
  const cell = el.closest('td, th, [role="gridcell"], [role="columnheader"], [role="rowheader"], [role="cell"]');
  if (!cell) return null;
  const row = cell.closest('tr, [role="row"]');
  return {row: ((row.children[0] && row.children[0].textContent) || '').trim(), col: Array.from(row.children).indexOf(cell)};
}"""

MOTION_JS = """() => {
  window.__motion = [];
  const rec = (a) => {
    if (!a || !a.effect || a.__rec) return;
    a.__rec = true;
    const t = a.effect.getComputedTiming();
    window.__motion.push({el: a.effect.target, duration: Number(t.duration) || 0, delay: Number(t.delay) || 0, iterations: String(t.iterations)});
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = animate.apply(this, args); rec(a); return a; };
  const sweep = (e) => { if (e.target && e.target.getAnimations) e.target.getAnimations({subtree: true}).forEach(rec); };
  document.addEventListener('animationstart', sweep, true);
  document.addEventListener('transitionrun', sweep, true);
}"""

MOTION_OF_JS = """(root) => {
  const seen = (window.__motion || []).filter((m) => m.el && root.contains(m.el))
    .map((m) => ({duration: m.duration, delay: m.delay, iterations: m.iterations}));
  const live = root.getAnimations({subtree: true}).filter((a) => !a.__rec).map((a) => {
    const t = a.effect.getComputedTiming();
    return {duration: Number(t.duration) || 0, delay: Number(t.delay) || 0, iterations: String(t.iterations)};
  });
  return seen.concat(live);
}"""

LOOPS_JS = "() => document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"


def fmt_countdown(seconds: float) -> str:
    whole = int(round(seconds))
    days, rest = divmod(whole, 86400)
    return f"{days}d {rest // 3600:02d}:{rest % 3600 // 60:02d}:{rest % 60:02d}"


TEXTS_JS = """(name) => {
  window.__texts = [];
  const note = () => {
    const named = (e) => {
      const by = e.getAttribute('aria-labelledby');
      const text = by ? by.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ') : (e.getAttribute('aria-label') || '');
      return text.replace(/\\s+/g, ' ').trim() === name;
    };
    const r = Array.from(document.querySelectorAll('[role=region], section')).find(named);
    const text = r ? (r.textContent || '').replace(/\\s+/g, ' ').trim() : '';
    if (text && window.__texts[window.__texts.length - 1] !== text) window.__texts.push(text);
  };
  note();
  new MutationObserver(note).observe(document.documentElement, {childList: true, characterData: true, subtree: true});
}"""


def watch_texts(page: Page, name: str) -> None:
    page.evaluate(TEXTS_JS, name)


def seen_texts(page: Page) -> list[str]:
    return page.evaluate("() => window.__texts || []")


def grid_labels(page: Page) -> list[str]:
    return page.get_by_role("grid", name="Cap table").evaluate(
        "(g) => Array.from(g.querySelectorAll('tr, [role=row]')).filter((r) => !r.querySelector('th[scope=col], [role=columnheader]'))"
        ".map((r) => ((r.children[0] && r.children[0].textContent) || '').trim())")


def enter_grid(page: Page) -> Locator:
    grid = page.get_by_role("grid", name="Cap table")
    expect(grid).to_be_visible(timeout=PAGE_MS)
    for _ in range(TAB_SCAN):
        page.keyboard.press("Tab")
        if grid.evaluate("(g) => g.contains(document.activeElement)"):
            return grid
    pytest.fail("the cap table grid never took focus")


def marker_cell_index(vesting_type: str, month: int) -> int:
    marks = cell_marks(vesting_type)
    if vesting_type == "standard":
        return 0 if month <= CLIFF_MONTHS else marks.index(month)
    return max(0, month - 1)


def cell_in_track(page: Page, index: int) -> bool:
    return ribbon_items(page).nth(index).evaluate(
        "(cell) => { let t = cell.parentElement; while (t && t !== document.body) { const s = getComputedStyle(t);"
        " if (/(auto|scroll)/.test(s.overflowX) && t.scrollWidth > t.clientWidth + 1) break; t = t.parentElement; }"
        " if (!t || t === document.body) return false; const a = cell.getBoundingClientRect(), b = t.getBoundingClientRect();"
        " return a.left >= b.left - 1 && a.right <= b.right + 1; }")


def live_socket(page: Page) -> tuple[list[Any], dict[str, bool]]:
    routes: list[Any] = []
    hold = {"on": False}

    def handler(ws: Any) -> None:
        if hold["on"]:
            refuse_socket(ws)
            return
        routes.append((ws, ws.connect_to_server()))

    page.route_web_socket(re.compile(r"/api/live"), handler)
    return routes, hold


def await_reconnect(page: Page, routes: list[Any], n: int) -> None:
    deadline = time.monotonic() + PAGE_S * 4
    ran = 0
    while time.monotonic() < deadline and ran <= RECONNECT_PAGE_MS * 3:
        if len(routes) >= n:
            return
        advance(page, RECONNECT_STEP_MS)
        ran += RECONNECT_STEP_MS
        _TICK.wait(POLL_S)
    assert len(routes) >= n, f"{len(routes)} socket connections after {ran} ms of page time, expected {n}"


def drop_socket(routes: list[Any], hold: dict[str, bool]) -> None:
    hold["on"] = True
    ws, server = routes[-1]
    ws.close()
    server.close()


FOCUS_IN_FRAME_JS = """() => {
  const cell = document.activeElement && document.activeElement.closest('td, th, [role="gridcell"], [role="columnheader"], [role="rowheader"]');
  if (!cell) return 'no focused cell';
  let box = cell.parentElement;
  while (box && box !== document.body) {
    const s = getComputedStyle(box);
    if (/(auto|scroll)/.test(s.overflowX) && box.scrollWidth > box.clientWidth + 1) break;
    box = box.parentElement;
  }
  if (!box || box === document.body) return 'ok';
  const a = cell.getBoundingClientRect(), b = box.getBoundingClientRect();
  return a.left >= b.left - 1 && a.right <= b.right + 1 ? 'ok' : `cell ${Math.round(a.left)}-${Math.round(a.right)} outside ${Math.round(b.left)}-${Math.round(b.right)}`;
}"""


def _assert_focus_in_frame(page: Page) -> None:
    where = page.evaluate(FOCUS_IN_FRAME_JS)
    assert where == "ok", where


def price_to_fmv(price: str, fmv: Decimal) -> str:
    return f"{(Decimal(price) / fmv).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)}"


def _assert_focused_text(page: Page, want: str) -> None:
    assert focused_text(page) == want, f"focused cell reads {focused_text(page)!r}, expected {want!r}"


def _assert_rows(page: Page, n: int) -> None:
    if n == 0:
        assert is_shown(page, "No valuations with this status."), "an empty filter shows its sentence"
        return
    got = page.get_by_role("table", name="Valuations").get_by_role("row").count() - 1
    assert got == n, f"{got} data rows, expected {n}"


def log_tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-2000:]


@contextmanager
def app_copy(env: dict[str, str]) -> Iterator[str]:
    manifest = Path(DEPLOYED_APP) / "run.json"
    if not manifest.exists():
        manifest = Path("/app/run.json")
    serve = json.loads(manifest.read_text())["serve"]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment = {**os.environ, **env, "APP_PUBLIC_PORT": str(port)}
    base = f"http://127.0.0.1:{port}"
    with tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False) as log:
        proc = subprocess.Popen(serve, shell=True, cwd=str(DEPLOYED_APP), env=environment, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + COPY_BOOT_S
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    pytest.fail(f"the app copy exited: {log_tail(log.name)}")
                try:
                    if httpx.get(base + "/api/health", timeout=3).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                _TICK.wait(0.5)
            else:
                pytest.fail(f"the app copy never answered health: {log_tail(log.name)}")
            yield base
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=15)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


def _pump(source: socket.socket, target: socket.socket) -> None:
    deadline = time.monotonic() + EXPIRY_WAIT_S * 10
    try:
        while time.monotonic() < deadline:
            data = source.recv(65536)
            if not data:
                break
            target.sendall(data)
    except OSError:
        pass
    finally:
        for end in (source, target):
            try:
                end.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class VaultRelay:

    def __init__(self) -> None:
        endpoint = urlparse(os.environ["S3_ENDPOINT"])
        self.upstream = (endpoint.hostname or "127.0.0.1", endpoint.port or HTTP_PORT)
        self.passing = False
        self.stopped = False
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.stopped:
            try:
                conn, _ = self.listener.accept()
            except OSError:
                return
            if not self.passing:
                conn.close()
                continue
            threading.Thread(target=self._relay, args=(conn,), daemon=True).start()

    def _relay(self, conn: socket.socket) -> None:
        try:
            upstream = socket.create_connection(self.upstream, timeout=HTTP_TIMEOUT_S)
        except OSError:
            conn.close()
            return
        threading.Thread(target=_pump, args=(upstream, conn), daemon=True).start()
        _pump(conn, upstream)

    def close(self) -> None:
        self.stopped = True
        try:
            self.listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.listener.close()


def test_wf_portal_vesting_board(browser: Browser, app_url: str) -> None:
    jc = login(app_url, JUNIPER)
    portal = jc.get("/api/portal").json()
    mark = latest_mark(JUNIPER_START, server_day(jc))
    assert mark is not None
    assert portal["first_name"] == "Juniper" and portal["total_options"] == JUNIPER_OPTIONS
    assert portal["vested_today"] == cumulative_at(JUNIPER_OPTIONS, "standard", mark)
    assert portal["next_tranche_date"] == mark_date(JUNIPER_START, mark + 1).isoformat()
    with browse(browser, app_url) as page:
        page.goto(app_url + "/")
        expect(page.get_by_role("heading", level=1, name="Your shares, on the record.")).to_be_visible(timeout=PAGE_MS)
        sign_in_form(page, JUNIPER, "not-the-password")
        page.get_by_role("button", name="Sign in").click()
        expect_shown(page, "That email and password don't match a Tidecraft register account.")
        fill(page.get_by_label("Password"), PASSWORD)
        page.get_by_label("Password").press("Enter")
        heading = page.get_by_role("heading", level=1, name="Juniper")
        expect(heading).to_be_visible(timeout=PAGE_MS)
        expect(heading).to_be_focused()
        board = page.get_by_role("region", name="Portal board")
        expect(board).to_contain_text(tile("Vested today:", fmt_count(portal["vested_today"]), "of", fmt_count(portal["total_options"])), timeout=PAGE_MS)
        expect(board).to_contain_text(tile("Next tranche", fmt_date(portal["next_tranche_date"])), timeout=PAGE_MS)
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()


SCHEDULE_SHAPES = {"standard_before_cliff": ("standard", 8), "standard_after_cliff": ("standard", 20), "monthly_no_cliff": ("monthly", 9)}


@pytest.mark.parametrize("case", list(SCHEDULE_SHAPES), ids=list(SCHEDULE_SHAPES))
def test_vesting_floor_rule(app_url: str, case: str) -> None:
    vesting, age = SCHEDULE_SHAPES[case]
    adm = admin(app_url)
    today = server_day(adm)
    start = add_months(today, -age)
    draft = draft_grant(app_url, new_person(app_url)[0]["id"], options=SCHEDULE_OPTIONS, vesting=vesting, start=start.isoformat())
    assert draft["state"] == "draft" and draft["vested"] == 0 and draft["exercisable"] == 0
    _, _, grant = holder_with_grant(app_url, options=SCHEDULE_OPTIONS, vesting=vesting, start=start.isoformat())
    mark = latest_mark(start, today)
    assert mark is not None
    expected = cumulative_at(SCHEDULE_OPTIONS, vesting, mark)
    assert grant["state"] == "accepted" and grant["server_date"] == today.isoformat()
    assert grant["vested"] == expected and grant["exercisable"] == expected
    assert [t["month"] for t in grant["schedule"]] == list(range(MARKS + 1))
    by = {t["month"]: t for t in grant["schedule"]}
    for m in range(MARKS + 1):
        assert by[m]["cumulative"] == cumulative_at(SCHEDULE_OPTIONS, vesting, m), f"mark {m}"
    for m in cell_marks(vesting):
        assert by[m]["state"] == ("vested" if mark_date(start, m) <= today else "unvested"), f"mark {m}"
    assert by[MARKS]["cumulative"] == SCHEDULE_OPTIONS
    if case != "standard_before_cliff":
        assert grant["next_tranche"] == {"date": mark_date(start, mark + 1).isoformat(),
                                         "cumulative": cumulative_at(SCHEDULE_OPTIONS, vesting, mark + 1)}


MONTH_END_CASES = ["start_31st_seed", "start_30th", "start_29th"]


@pytest.mark.parametrize("case", MONTH_END_CASES, ids=MONTH_END_CASES)
def test_month_end_tranche_dates(app_url: str, case: str) -> None:
    if case == "start_31st_seed":
        grant = login(app_url, JUNIPER).get(f"/api/grants/{JUNIPER_GRANT}").json()
        start = JUNIPER_START
        by = {t["month"]: t["date"] for t in grant["schedule"]}
        for month, expected in BRIEF_MONTH_ENDS.items():
            assert by[month] == expected, f"mark {month}"
    else:
        start = date(2024, 1, 30) if case == "start_30th" else date(2023, 1, 29)
        _, _, grant = holder_with_grant(app_url, start=start.isoformat())
        by = {t["month"]: t["date"] for t in grant["schedule"]}
    for m in range(MARKS + 1):
        assert by[m] == mark_date(start, m).isoformat(), f"mark {m}"


def test_wf_portal_vesting_ribbon(browser: Browser, app_url: str) -> None:
    jc = login(app_url, JUNIPER)
    grant = jc.get(f"/api/grants/{JUNIPER_GRANT}").json()
    assert len(cell_marks(grant["vesting_type"])) == 1 + (MARKS - CLIFF_MONTHS)
    _, mc, monthly = holder_with_grant(app_url, vesting="monthly")
    with browse(browser, app_url) as page:
        signed_in(page, app_url, jc, f"/grants/{JUNIPER_GRANT}")
        expect(page.get_by_role("heading", level=1)).to_contain_text(JUNIPER_GRANT, timeout=PAGE_MS)
        expect(page.get_by_role("group", name="Tranche ribbon")).to_be_visible(timeout=PAGE_MS)
        expect(ribbon_items(page)).to_have_count(len(cell_marks("standard")), timeout=QUICK_MS)
        expect_ribbon(page, grant)
        signed_in(page, app_url, mc, f"/grants/{monthly['id']}")
        expect(ribbon_items(page)).to_have_count(MARKS, timeout=PAGE_MS)
        expect_ribbon(page, monthly)
    with browse(browser, app_url, reduced_motion="reduce") as phone:
        w, h = VIEWPORTS["375"]
        phone.set_viewport_size({"width": w, "height": h})
        signed_in(phone, app_url, jc, f"/grants/{JUNIPER_GRANT}")
        expect(ribbon_items(phone)).to_have_count(len(cell_marks("standard")), timeout=PAGE_MS)
        expect_ribbon(phone, grant)
        layout(phone)
        for index in range(len(cell_marks("standard"))):
            box = ribbon_items(phone).nth(index).bounding_box()
            assert box and box["width"] >= TARGET_PX and box["height"] >= TARGET_PX, f"ribbon cell {index} on a phone: {box}"


def test_wf_portal_vesting_marker(browser: Browser, app_url: str) -> None:
    jc = login(app_url, JUNIPER)
    grant = jc.get(f"/api/grants/{JUNIPER_GRANT}").json()
    today_mark = latest_mark(JUNIPER_START, server_day(jc))
    assert today_mark is not None
    with browse(browser, app_url) as page:
        signed_in(page, app_url, jc, f"/grants/{JUNIPER_GRANT}")
        slider = page.get_by_role("slider", name="Projection date")
        expect(slider).to_be_visible(timeout=PAGE_MS)
        expect(slider).to_have_attribute("aria-valuemin", "0")
        expect(slider).to_have_attribute("aria-valuemax", str(MARKS))
        marker_check(page, grant, today_mark, today_mark)
        vested_before = [n for n in ribbon_names(grant) if n.endswith(", vested")]
        slider.focus()
        def clamp(m: int) -> int:
            return max(0, min(MARKS, m))
        up = clamp(today_mark + CLIFF_MONTHS)
        steps = [("ArrowRight", clamp(today_mark + 1)), ("ArrowUp", clamp(today_mark + 2)), ("ArrowLeft", clamp(clamp(today_mark + 2) - 1)),
                 ("ArrowDown", clamp(clamp(clamp(today_mark + 2) - 1) - 1)), ("Home", today_mark), ("PageUp", up), ("PageDown", clamp(up - CLIFF_MONTHS)),
                 ("End", MARKS), ("ArrowRight", MARKS), ("Home", today_mark), ("PageDown", clamp(today_mark - CLIFF_MONTHS)),
                 ("PageDown", clamp(clamp(today_mark - CLIFF_MONTHS) - CLIFF_MONTHS))]
        for key, mark in steps:
            page.keyboard.press(key)
            marker_check(page, grant, mark, today_mark)
        page.keyboard.press("Home")
        marker_check(page, grant, today_mark, today_mark)
        page.keyboard.press("ArrowRight")
        marker_check(page, grant, today_mark + 1, today_mark)
        assert projected_count(page) >= 1
        assert all(page.get_by_role("listitem", name=n).count() == 1 for n in vested_before[:3])
        ribbon_items(page).nth(len(cell_marks("standard")) - 1).click()
        expect(slider).to_have_attribute("aria-valuenow", str(MARKS), timeout=PAGE_MS)
        slider.focus()
        page.keyboard.press("Home")
        marker_check(page, grant, today_mark, today_mark)
        assert projected_count(page) == 0


def test_wf_portal_vesting_device_clock(browser: Browser, app_url: str) -> None:
    jc = login(app_url, JUNIPER)
    portal = jc.get("/api/portal").json()
    _, hc, offered = offered_grant(app_url)
    with browse(browser, app_url) as page:
        page.clock.set_system_time(server_now(jc) + timedelta(days=SKEW_DAYS))
        signed_in(page, app_url, jc, "/")
        expect(page.get_by_role("region", name="Portal board")).to_contain_text(
            tile("Vested today:", fmt_count(portal["vested_today"]), "of", fmt_count(portal["total_options"])), timeout=PAGE_MS)
        expect(page.get_by_role("region", name="Portal board")).to_contain_text(tile("Next tranche", fmt_date(portal["next_tranche_date"])))
        signed_in(page, app_url, hc, f"/grants/{offered['id']}")
        expect(page.get_by_role("heading", level=1)).to_contain_text(offered["id"], timeout=PAGE_MS)
        eventually(page, state_word(page, "Offered"), "the server's Offered state, not a device-clock Expired")
        expect_not_shown(page, re.compile(r"\bExpired\b"))


@pytest.mark.timeout(300)
def test_wf_portal_vesting_phone_marker(browser: Browser, app_url: str) -> None:
    jc = login(app_url, JUNIPER)
    grant = jc.get(f"/api/grants/{JUNIPER_GRANT}").json()
    today_mark = latest_mark(JUNIPER_START, server_day(jc))
    assert today_mark is not None
    for motion in ("reduce", "no-preference"):
        with browse(browser, app_url, reduced_motion=motion) as phone:
            w, h = VIEWPORTS["375"]
            phone.set_viewport_size({"width": w, "height": h})
            signed_in(phone, app_url, jc, f"/grants/{JUNIPER_GRANT}")
            slider = phone.get_by_role("slider", name="Projection date")
            expect(slider).to_be_visible(timeout=PAGE_MS)
            expect(ribbon_items(phone)).to_have_count(len(cell_marks(grant["vesting_type"])), timeout=PAGE_MS)
            slider.focus()
            for key, mark in (("End", MARKS), ("Home", today_mark), ("PageDown", max(0, today_mark - CLIFF_MONTHS)), ("End", MARKS)):
                phone.keyboard.press(key)
                expect(slider).to_have_attribute("aria-valuenow", str(mark), timeout=PAGE_MS)
                index = marker_cell_index(grant["vesting_type"], mark)
                if motion == "reduce":
                    advance(phone, 48)
                    assert cell_in_track(phone, index), f"after {key} the marker's cell {index} must be inside the track at once"
                else:
                    eventually(phone, lambda: _assert_in_track(phone, index), f"after {key} the marker's cell {index} inside the track")
                layout(phone)


def _assert_in_track(page: Page, index: int) -> None:
    assert cell_in_track(page, index), f"cell {index} outside the track's visible frame"


@pytest.mark.timeout(600)
def test_wf_grant_board_issue_journey(browser: Browser, app_url: str) -> None:
    person, hc = new_person(app_url)
    adm = admin(app_url)
    strike = strike_for(adm)
    start = add_months(server_day(adm), -AGE_MONTHS).isoformat()
    with browse(browser, app_url) as mara, browse(browser, app_url) as priya, browse(browser, app_url) as holder:
        signed_in(holder, app_url, hc, "/")
        expect(holder.get_by_role("region", name="Portal board")).to_be_visible(timeout=PAGE_MS)
        watch_announcements(holder)
        signed_in(mara, app_url, adm, "/admin/grants")
        watch_announcements(mara)
        mara.get_by_role("button", name="New grant").focus()
        mara.keyboard.press("Enter")
        form = mara.get_by_role("form", name="Issue grant")
        expect(form.get_by_role("combobox", name="Holder")).to_be_focused(timeout=PAGE_MS)
        select(form.get_by_role("combobox", name="Holder"), person["name"])
        type_into(mara, form.get_by_role("textbox", name="Options"), str(DEFAULT_OPTIONS))
        type_into(mara, form.get_by_role("textbox", name="Strike price"), strike)
        radio = form.get_by_role("radio", name="4 years, 1-year cliff")
        radio.focus()
        mara.keyboard.press("ArrowRight")
        expect(form.get_by_role("radio", name="4 years monthly, no cliff")).to_be_checked()
        mara.keyboard.press("ArrowLeft")
        expect(radio).to_be_checked()
        mara.keyboard.press("ArrowRight")
        type_into(mara, form.get_by_role("textbox", name="Vesting start"), start)
        advance(mara, DRAFT_SAVE_MS)
        eventually(mara, lambda: expect(form.get_by_text("Draft saved")).to_be_visible(timeout=EXPECT_STEP_MS), "draft saved")
        drafts = poll(lambda: [g for g in adm.get("/api/grants").json()["grants"] if g["holder_id"] == person["id"]],
                      lambda gs: bool(gs) and gs[0]["vesting_start"] == start, LIVE_WAIT_S, "the typed draft on the server")
        gid = drafts[0]["id"]
        assert drafts[0]["options"] == DEFAULT_OPTIONS and drafts[0]["vesting_type"] == "monthly"
        form.get_by_role("button", name="Submit to board").focus()
        mara.keyboard.press("Enter")
        expect_announced(mara, f"Grant {gid} sent to the board for approval.")
        quorum = adm.get("/api/board/queue").json()["quorum"]
        signed_in(priya, app_url, shared(app_url, PRIYA), "/board")
        watch_announcements(priya)
        row = priya.get_by_role("table", name="Board queue").get_by_role("row").filter(has_text=gid)
        row.get_by_role("button", name=f"Approve {gid}").click()
        expect_announced(priya, f"Your approval of {gid} is recorded: 1 of {quorum} approvals.")
        assert vote(shared(app_url, THEO), gid, "approve").status_code == 200
        assert adm.get(f"/api/grants/{gid}").json()["state"] == "approved"
        mara.goto(f"{app_url}/admin/grants")
        watch_announcements(mara)
        mara.get_by_role("button", name=f"Send offer {gid}").click()
        expect_announced(mara, f"Offer for {gid} sent. It lapses at")
        expect_announced(holder, f"A grant offer is waiting: {gid}, {fmt_count(DEFAULT_OPTIONS)} options.")
    grant = adm.get(f"/api/grants/{gid}").json()
    assert grant["state"] == "offered"
    assert parse_instant(grant["offer_expires_at"]) - parse_instant(grant["offered_at"]) == timedelta(seconds=OFFER_WINDOW_S)


VALIDATION_CASES = ["options_zero", "options_string", "pool_exhausted", "strike_below_fmv", "strike_equal_fmv", "start_impossible",
                    "start_before_2015", "start_after_limit", "start_at_limit_ok", "holder_other_role", "holder_unknown", "vesting_type_bad"]


@pytest.mark.parametrize("case", VALIDATION_CASES, ids=VALIDATION_CASES)
def test_grant_validation(app_url: str, case: str) -> None:
    adm = admin(app_url)
    day = server_day(adm)
    fmv = current_fmv(adm)
    available = pool_of(adm)["available"]
    holder, _ = new_person(app_url)
    body: dict[str, Any] = {"holder_id": holder["id"], "options": 100, "strike": f"{fmv:.4f}", "vesting_type": "monthly",
                            "vesting_start": add_months(day, -AGE_MONTHS).isoformat()}
    ok = False
    if case == "options_zero":
        body["options"] = 0
    elif case == "options_string":
        body["options"] = "100"
    elif case == "pool_exhausted":
        body["options"] = available + 1
    elif case == "strike_below_fmv":
        body["strike"] = f"{fmv - Decimal('0.0001'):.4f}"
    elif case == "strike_equal_fmv":
        ok = True
    elif case == "start_impossible":
        body["vesting_start"] = "2025-02-30"
    elif case == "start_before_2015":
        body["vesting_start"] = "2014-12-31"
    elif case == "start_after_limit":
        body["vesting_start"] = (add_months(day, 12) + timedelta(days=1)).isoformat()
    elif case == "start_at_limit_ok":
        body["vesting_start"], ok = add_months(day, 12).isoformat(), True
    elif case == "holder_other_role":
        body["holder_id"] = new_person(app_url, role="investor", prefix="investor")[0]["id"]
    elif case == "holder_unknown":
        body["holder_id"] = "PER-999999"
    else:
        body["vesting_type"] = "weekly"
    reserved = pool_of(adm)["reserved"]
    r = adm.post("/api/grants", json=body)
    gid = r.json().get("id") if r.status_code == 201 else None
    if gid:
        r = adm.post(f"/api/grants/{gid}/submit", json={})
    if ok:
        assert r.status_code == 200 and r.json()["state"] == "board_queue", r.text
        assert pool_of(adm)["reserved"] == reserved + body["options"]
        return
    if case == "holder_unknown":
        refused(r, 404, "not_found")
    elif case == "pool_exhausted":
        refused(r, 409, "pool_exhausted")
    else:
        fields = invalid(r)
        key = {"options_zero": "options", "options_string": "options", "strike_below_fmv": "strike", "holder_other_role": "holder_id",
               "vesting_type_bad": "vesting_type"}.get(case, "vesting_start")
        assert key in fields, fields
        expected = {"options": f"Enter a whole number of options from 1 to {available}.",
                    "strike": f"Strike must be at least the current fair market value of ${fmv:.4f}.",
                    "holder_id": "Choose an option holder.", "vesting_type": "Choose a vesting type.",
                    "vesting_start": "Enter the vesting start as YYYY-MM-DD."}[key]
        assert plain(fields[key]) == plain(expected)
    assert pool_of(adm)["reserved"] == reserved
    if gid:
        assert adm.get(f"/api/grants/{gid}").json()["state"] == "draft"


def test_board_quorum_voting(app_url: str) -> None:
    adm, pc, tc = admin(app_url), shared(app_url, PRIYA), shared(app_url, THEO)
    person, hc = new_person(app_url)
    gid = draft_grant(app_url, person["id"])["id"]
    queue_grant(app_url, gid)
    refused(vote(hc, gid, "approve"), 403, "forbidden")
    refused(vote(adm, gid, "approve"), 403, "forbidden")
    fields = invalid(vote(pc, gid, "abstain"))
    assert "vote" in fields
    r = vote(pc, gid, "approve")
    assert r.status_code == 200 and r.json()["approvals"] == 1 and r.json()["my_vote"] == "approve" and r.json()["state"] == "board_queue"
    refused(vote(pc, gid, "approve"), 409, "already_voted")
    r = vote(tc, gid, "approve")
    assert r.status_code == 200 and r.json()["state"] == "approved"
    refused(vote(shared(app_url, WEN), gid, "approve"), 409, "grant_not_in_queue")
    second = draft_grant(app_url, person["id"])["id"]
    queue_grant(app_url, second)
    reserved = pool_of(adm)["reserved"]
    assert vote(pc, second, "decline").status_code == 200
    r = vote(tc, second, "decline")
    assert r.status_code == 200 and r.json()["state"] == "draft"
    assert pool_of(adm)["reserved"] == reserved - DEFAULT_OPTIONS
    grant = adm.get(f"/api/grants/{second}").json()
    assert grant["state"] == "draft" and grant["votes"] == {"approve": 0, "decline": 0}
    queue_grant(app_url, second)
    assert vote(pc, second, "approve").status_code == 200


def test_board_simultaneous_votes(app_url: str) -> None:
    person, _ = new_person(app_url)
    gid = draft_grant(app_url, person["id"])["id"]
    queue_grant(app_url, gid)
    clients = [login(app_url, e) for e in BOARD]
    choices = ["approve", "decline", "decline"]
    barrier = threading.Barrier(len(clients))

    def fire(i: int) -> httpx.Response:
        barrier.wait()
        return vote(clients[i], gid, choices[i])

    with ThreadPoolExecutor(len(clients)) as pool:
        results = list(pool.map(fire, range(len(clients))))
    assert all(r.status_code in (200, 409) for r in results), [r.text for r in results]
    assert sum(r.status_code == 200 for r in results) >= 2
    grant = admin(app_url).get(f"/api/grants/{gid}").json()
    assert grant["state"] == "draft" and grant["votes"] == {"approve": 0, "decline": 0}


@pytest.mark.timeout(300)
def test_wf_grant_board_summary_address(browser: Browser, app_url: str) -> None:
    member = shared(app_url, WEN)
    person, _ = new_person(app_url)
    gid = draft_grant(app_url, person["id"])["id"]
    queue_grant(app_url, gid)
    quorum = admin(app_url).get("/api/board/queue").json()["quorum"]
    with browse(browser, app_url) as page:
        signed_in(page, app_url, member, "/board")
        link = page.get_by_role("table", name="Board queue").get_by_role("link", name=gid, exact=True)
        expect(link).to_be_visible(timeout=PAGE_MS)
        link.focus()
        page.keyboard.press("Enter")
        summary = page.get_by_role("region", name="Grant summary")
        expect(summary.get_by_role("heading", level=1, name=gid)).to_be_focused(timeout=PAGE_MS)
        assert urlparse(page.url).path == f"/board/{gid}"
        expect(summary).to_contain_text(f"0 of {quorum} approvals")
        page.reload()
        expect(summary.get_by_role("heading", level=1, name=gid)).to_be_visible(timeout=PAGE_MS)
        assert vote(shared(app_url, THEO), gid, "approve").status_code == 200
        eventually(page, lambda: expect(summary).to_contain_text(f"1 of {quorum} approvals", timeout=EXPECT_STEP_MS),
                   "the other member's vote on the open summary", LIVE_WAIT_S)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(link).to_be_focused(timeout=EXPECT_STEP_MS), "Escape returns focus to the grant's queue link")
        assert urlparse(page.url).path == "/board"
        link.focus()
        page.keyboard.press("Enter")
        expect(summary.get_by_role("heading", level=1, name=gid)).to_be_focused(timeout=PAGE_MS)
        page.go_back()
        eventually(page, lambda: expect(link).to_be_focused(timeout=EXPECT_STEP_MS), "Back returns focus to the grant's queue link")
        assert urlparse(page.url).path == "/board"


@pytest.mark.timeout(300)
def test_wf_grant_offer_accept_journey(browser: Browser, app_url: str) -> None:
    person, hc, offered = offered_grant(app_url)
    gid = offered["id"]
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/grants/{gid}")
        expect(page.get_by_role("heading", level=1)).to_contain_text(gid, timeout=PAGE_MS)
        expect(page.get_by_role("region", name="Grant agreement")).to_contain_text(gid, timeout=PAGE_MS)
        watch_announcements(page)
        page.get_by_role("button", name="Accept grant").click()
        expect_announced(page, f"Grant {gid} accepted. Your signed agreement is sealed in the vault.")
        eventually(page, state_word(page, "Accepted"), "Accepted state")
        expect(ribbon_items(page).first).to_be_visible(timeout=PAGE_MS)
        page.get_by_role("navigation", name="Register").get_by_role("link", name="Documents").click()
        grant = hc.get(f"/api/grants/{gid}").json()
        doc = hc.get(f"/api/documents/{grant['agreement']['document_id']}").json()
        expect(page.get_by_role("list", name="Documents").get_by_role("link", name=doc["title"])).to_be_visible(timeout=PAGE_MS)
    text = poll_key(f"grant-agreements/{gid}.txt").decode("utf-8")
    for line in (f"Grant: {gid}", f"Holder: {person['name']}", f"Signed by: {person['name']}"):
        assert line in text.split("\n")
    assert text.endswith("\n")


def test_signed_only_when_sealed(app_url: str) -> None:
    person, hc, grant = holder_with_grant(app_url)
    assert grant["agreement"]["status"] == "sealed" and grant["accepted_at"]
    doc = hc.get(f"/api/documents/{grant['agreement']['document_id']}").json()
    data = poll_key(f"grant-agreements/{grant['id']}.txt")
    assert doc["kind"] == "grant_agreement" and doc["status"] == "sealed" and doc["owner_id"] == person["id"]
    assert doc["sha256"] == hashlib.sha256(data).hexdigest() and doc["vault_key"] == f"grant-agreements/{grant['id']}.txt"
    mine = [e for e in ledger(hc) if e["kind"] == "grant_accepted"]
    assert len(mine) == 1 and mine[0]["options_delta"] == grant["options"]
    refused(hc.post(f"/api/grants/{grant['id']}/accept", json={}), 409, "grant_not_offered")
    base = outage_url("APP_VAULT_DOWN_URL")
    p2, h2, g2 = offered_grant(base)
    body = refused(h2.post(f"/api/grants/{g2['id']}/accept", json={}), 503, "vault_unavailable")
    assert body["grant"]["state"] == "offered" and body["grant"]["agreement"]["status"] == "pending"
    after = h2.get(f"/api/grants/{g2['id']}").json()
    assert after["state"] == "offered" and not after["accepted_at"]
    assert [e for e in ledger(h2) if e["kind"] == "grant_accepted"] == []


def test_decline_returns_to_queue(app_url: str) -> None:
    adm = admin(app_url)
    person, hc, grant = offered_grant(app_url)
    other, oc = new_person(app_url)
    gid = grant["id"]
    refused(oc.post(f"/api/grants/{gid}/decline", json={}), 404, "not_found")
    reserved = pool_of(adm)["reserved"]
    r = hc.post(f"/api/grants/{gid}/decline", json={})
    assert r.status_code == 200 and r.json()["state"] == "board_queue" and r.json()["votes"] == {"approve": 0, "decline": 0}
    assert pool_of(adm)["reserved"] == reserved
    refused(hc.post(f"/api/grants/{gid}/decline", json={}), 409, "grant_not_offered")
    entry = next(g for g in shared(app_url, PRIYA).get("/api/board/queue").json()["grants"] if g["id"] == gid)
    assert entry["approvals"] == 0 and entry["my_vote"] is None
    assert vote(shared(app_url, PRIYA), gid, "approve").status_code == 200


@pytest.mark.timeout(300)
def test_wf_grant_offer_expiry(browser: Browser, app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    adm = admin(base)
    person, hc = new_person(base)
    draft = draft_grant(base, person["id"])
    queue_grant(base, draft["id"])
    approve(base, draft["id"])
    reserved = pool_of(adm)["reserved"]
    with browse(browser, base) as page:
        page.clock.set_system_time(server_now(adm) - timedelta(days=SKEW_DAYS))
        signed_in(page, base, hc, "/")
        expect(page.get_by_role("region", name="Portal board")).to_be_visible(timeout=PAGE_MS)
        watch_announcements(page)
        sent = adm.post(f"/api/grants/{draft['id']}/offer", json={})
        assert sent.status_code == 200, sent.text
        grant = sent.json()
        gid, exp = grant["id"], parse_instant(grant["offer_expires_at"])
        poll(lambda: server_now(hc), lambda t: t >= exp, EXPIRY_WAIT_S, "the server clock to reach the expiry")
        poll(lambda: hc.get(f"/api/grants/{gid}").json()["state"], lambda s: s == "expired", LIVE_WAIT_S, "the server publishes the expiry")
        refused(hc.post(f"/api/grants/{gid}/accept", json={}), 409, "offer_expired")
        refused(hc.post(f"/api/grants/{gid}/decline", json={}), 409, "offer_expired")
        poll(lambda: hc.get(f"/api/grants/{gid}").json()["state"], lambda s: s == "expired", LIVE_WAIT_S, "the server expires the offer")
        expect_announced(page, f"The offer for grant {gid} has expired.")
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), f"The offer for grant {gid} has expired.") == 1
        signed_in(page, base, hc, f"/grants/{gid}")
        eventually(page, state_word(page, "Expired"), "Expired state on the grant page", LIVE_WAIT_S)
    assert pool_of(adm)["reserved"] <= reserved - grant["options"]


@pytest.mark.timeout(600)
def test_wf_grant_offer_pending_recovery(browser: Browser, app_url: str) -> None:
    person, hc, grant = offered_grant(app_url)
    gid = grant["id"]
    relay = VaultRelay()
    try:
        with app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}"}) as copy:
            h2 = login(copy, person["email"])
            body = refused(h2.post(f"/api/grants/{gid}/accept", json={}), 503, "vault_unavailable")
            assert body["grant"]["state"] == "offered" and body["grant"]["agreement"]["status"] == "pending"
            with browse(browser, copy) as page:
                signed_in(page, copy, h2, f"/grants/{gid}")
                retry = retry_button(page, "Retry signing")
                expect(retry).to_be_visible(timeout=PAGE_MS)
                watch_announcements(page)
                retry.click()
                expect_shown(page, f"The document vault can't be reached. Your signature is pending and grant {gid} is not yet accepted.")
                relay.passing = True
                retry.click()
                expect_announced(page, f"Grant {gid} accepted. Your signed agreement is sealed in the vault.")
            assert h2.get(f"/api/grants/{gid}").json()["state"] == "accepted"
    finally:
        relay.close()
    poll_key(f"grant-agreements/{gid}.txt")


@pytest.mark.timeout(600)
def test_wf_tender_nda_recovery(app_url: str) -> None:
    inv, ic = investor_with_shares(app_url, 100)
    relay = VaultRelay()
    try:
        with app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}"}) as copy:
            tid = open_tender(app_url, cap=1000, price="1.0000", close_in_s=NDA_TENDER_S)["id"]
            c2 = login(copy, inv["email"])
            body = refused(c2.post(f"/api/tenders/{tid}/nda", json={}), 503, "vault_unavailable")
            assert body["tender"]["mine"]["nda"]["status"] == "pending"
            refused(submit_tender(c2, tid, 10), 409, "nda_required")
            relay.passing = True
            assert sign_nda(c2, tid)["mine"]["nda"]["status"] == "sealed"
            assert submit_tender(c2, tid, 10).status_code == 201
    finally:
        relay.close()
    poll_key(f"tender-ndas/{tid}/{inv['id']}.txt")
    wait_tender(admin(app_url), tid, "allocated", TENDER_WAIT_S)


@pytest.mark.timeout(300)
def test_wf_grant_offer_warning(browser: Browser, app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    adm = admin(base)
    person, hc = new_person(base)
    draft = draft_grant(base, person["id"])
    queue_grant(base, draft["id"])
    approve(base, draft["id"])
    with browse(browser, base) as page:
        page.clock.set_system_time(server_now(adm) + timedelta(days=SKEW_DAYS))
        signed_in(page, base, hc, "/")
        expect(page.get_by_role("region", name="Portal board")).to_be_visible(timeout=PAGE_MS)
        watch_announcements(page)
        sent = adm.post(f"/api/grants/{draft['id']}/offer", json={})
        assert sent.status_code == 200, sent.text
        grant = sent.json()
        gid, warn, exp = grant["id"], parse_instant(grant["offer_warning_at"]), parse_instant(grant["offer_expires_at"])
        assert parse_instant(grant["offered_at"]) < warn < exp
        strip = page.get_by_role("region", name="Offer warning")
        prefix = f"The offer for grant {gid} lapses at"
        if server_now(hc) < warn:
            expect(strip).to_have_count(0)
            assert times_once(announced(page), prefix) == 0, "the warning must wait for its time on the server clock"
        poll(lambda: server_now(hc), lambda t: t >= warn, EXPIRY_WAIT_S, "the server clock to reach the offer warning")
        eventually(page, lambda: expect(strip).to_contain_text(prefix, timeout=EXPECT_STEP_MS), "the offer warning strip", LIVE_WAIT_S)
        expect(strip).to_contain_text("Accept or decline before then.")
        expect_announced(page, prefix)
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), prefix) == 1
        if server_now(hc) < exp - timedelta(seconds=GRANT_PAGE_LEAD_S):
            signed_in(page, base, hc, f"/grants/{gid}")
            expect(page.get_by_role("region", name="Offer warning")).to_contain_text(prefix, timeout=PAGE_MS)


@pytest.mark.timeout(300)
def test_wf_grant_offer_accept_race(browser: Browser, app_url: str) -> None:
    person, hc, grant = offered_grant(app_url)
    gid = grant["id"]
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/grants/{gid}")
        expect(page.get_by_role("button", name="Accept grant", exact=True)).to_be_visible(timeout=PAGE_MS)
        clients = [login(app_url, person["email"]) for _ in range(2)]
        barrier = threading.Barrier(2)

        def accept(i: int) -> httpx.Response:
            barrier.wait()
            return clients[i].post(f"/api/grants/{gid}/accept", json={})

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(accept, range(2)))
        assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
        refused(next(r for r in results if r.status_code == 409), 409, "grant_not_offered")
        eventually(page, state_word(page, "Accepted"), "Accepted on the open page", LIVE_WAIT_S)
        expect(page.get_by_role("button", name="Accept grant", exact=True)).to_have_count(0)
    keys = [k for k in S3().keys("grant-agreements/") if k.startswith(f"grant-agreements/{gid}.")]
    assert keys == [f"grant-agreements/{gid}.txt"], keys
    accepted = [e for e in ledger(admin(app_url)) if e["kind"] == "grant_accepted" and e["holder_id"] == person["id"]]
    assert len(accepted) == 1, accepted


@pytest.mark.timeout(300)
def test_wf_grant_offer_expiry_replay(browser: Browser, app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    with browse(browser, base) as page:
        routes, hold = live_socket(page)
        person, hc, grant = offered_grant(base)
        gid, exp = grant["id"], parse_instant(grant["offer_expires_at"])
        signed_in(page, base, hc, f"/grants/{gid}")
        expect(page.get_by_role("button", name="Accept grant", exact=True)).to_be_visible(timeout=PAGE_MS)
        eventually(page, lambda: _assert_count(routes, 1), "the page opens its socket")
        watch_announcements(page)
        drop_socket(routes, hold)
        poll(lambda: server_now(hc), lambda t: t >= exp + timedelta(seconds=1), EXPIRY_WAIT_S, "the server clock past the expiry")
        poll(lambda: hc.get(f"/api/grants/{gid}").json()["state"], lambda s: s == "expired", LIVE_WAIT_S, "the server expires the offer")
        hold["on"] = False
        await_reconnect(page, routes, 2)
        copy = f"The offer for grant {gid} has expired."
        expect_announced(page, copy)
        eventually(page, state_word(page, "Expired"), "Expired after the replay", LIVE_WAIT_S)
        accept = page.get_by_role("button", name="Accept grant", exact=True)
        assert accept.count() == 0 or accept.is_disabled(), "an expired offer can't be accepted"
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), copy) == 1


@pytest.mark.timeout(300)
def test_wf_grant_offer_accept_focus(browser: Browser, app_url: str) -> None:
    person, hc, grant = offered_grant(app_url)
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/grants/{grant['id']}")
        accept = page.get_by_role("button", name="Accept grant", exact=True)
        expect(accept).to_be_enabled(timeout=PAGE_MS)
        accept.focus()
        page.keyboard.press("Enter")
        eventually(page, state_word(page, "Accepted"), "Accepted in place", LIVE_WAIT_S)
        eventually(page, lambda: expect(page.get_by_role("button", name="Exercise", exact=True)).to_be_focused(timeout=EXPECT_STEP_MS), "focus on Exercise")


@pytest.mark.timeout(600)
def test_wf_exercise_journey(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    person, hc, grant = holder_with_grant(app_url)
    gid, count = grant["id"], 3217
    cost = cost_of(count, grant["strike"])
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/grants/{gid}")
        expect(page.get_by_role("heading", level=1)).to_contain_text(gid, timeout=PAGE_MS)
        watch_announcements(page)
        page.get_by_role("button", name="Exercise").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Exercise options")
        expect(dialog.get_by_role("textbox", name="Options to exercise")).to_be_focused(timeout=PAGE_MS)
        page.keyboard.type(str(count))
        eventually(page, lambda: expect(dialog).to_contain_text(fmt_money(cost), timeout=EXPECT_STEP_MS), "cost preview")
        assert orders_of(hc) == [], "the preview must not create an order"
        quote = hc.post(f"/api/grants/{gid}/exercise-quote", json={"options": count}).json()
        assert quote["cost"] == f"{cost}"
        page.keyboard.press("Enter")
        expect(dialog).to_have_count(0, timeout=PAGE_MS)
        page.wait_for_url(re.compile(r"/exercises/EXO-\d+"), timeout=PAGE_MS)
        expect(page.get_by_role("heading", level=1)).to_be_focused(timeout=PAGE_MS)
        order = poll(lambda: orders_of(hc), lambda os_: bool(os_) and os_[0]["state"] == "issued", LIVE_WAIT_S + 10, "the order to be issued")[0]
        region = page.get_by_role("region", name="Provider record")
        expect(region).to_contain_text(tile("Reference", order["payment"]["id"]), timeout=PAGE_MS)
        expect(region).to_contain_text(tile("Amount", fmt_money(cost), "USD"))
        expect(region).to_contain_text("Confirmed")
        expect_announced(page, f"Payment confirmed. {fmt_count(count)} shares issued on grant {gid}.")
        expect_announced(page, f"Exercise notice for {order['id']} sealed in the vault.")
    sent = payments_for(wiremock, order["id"])
    assert len(sent) == 1 and req_body(sent[0])["amount_cents"] == cents(cost) and req_body(sent[0])["currency"] == "USD"
    assert req_header(sent[0], "Idempotency-Key") == order["idempotency_key"]
    assert wiremock.requests(f"/v1/payments/{order['payment']['id']}", "GET")
    assert issued_of(hc, person["id"]) == count
    assert [e for e in ledger(hc) if e["kind"] == "exercise_issued"][0]["shares_delta"] == count
    poll_key(f"exercise-notices/{order['id']}.txt")


EXERCISE_COSTS = {"half_cent_two": 2, "seven": 7, "large": 3217}


@pytest.mark.parametrize("case", list(EXERCISE_COSTS), ids=list(EXERCISE_COSTS))
def test_exact_exercise_cost(app_url: str, wiremock: WireMock, case: str) -> None:
    options = EXERCISE_COSTS[case]
    person, hc, grant = holder_with_grant(app_url)
    cost = cost_of(options, grant["strike"])
    assert hc.post(f"/api/grants/{grant['id']}/exercise-quote", json={"options": options}).json()["cost"] == f"{cost}"
    r = exercise(hc, grant["id"], options)
    assert r.status_code == 201, r.text
    order = wait_order(hc, r.json()["id"], ("issued",))
    assert order["cost"] == f"{cost}" and order["payment"]["amount_cents"] == cents(cost)
    assert req_body(payments_for(wiremock, order["id"])[0])["amount_cents"] == cents(cost)
    notice = poll_key(f"exercise-notices/{order['id']}.txt").decode("utf-8")
    assert f"Exercise cost: {fmt_money(cost)}" in notice.split("\n")


EXERCISE_REFUSALS = ["over_vested", "exactly_exercisable", "before_cliff", "zero", "not_integer", "after_held_order", "offered_grant"]


@pytest.mark.parametrize("case", EXERCISE_REFUSALS, ids=EXERCISE_REFUSALS)
def test_vested_only_exercise(app_url: str, wiremock: WireMock, case: str) -> None:
    if case == "offered_grant":
        _, hc, offered = offered_grant(app_url)
        refused(exercise(hc, offered["id"], 1), 409, "grant_not_exercisable")
        return
    if case == "before_cliff":
        start = add_months(server_day(admin(app_url)), -6).isoformat()
        _, hc, grant = holder_with_grant(app_url, vesting="standard", start=start)
    else:
        _, hc, grant = holder_with_grant(app_url)
    gid, exercisable = grant["id"], grant["exercisable"]
    payments = len(wiremock.requests("/v1/payments", "POST"))
    if case == "exactly_exercisable":
        assert exercise(hc, gid, exercisable).status_code == 201
        message = invalid(exercise(hc, gid, 1))
        assert message["options"] == "Only 0 vested options are available to exercise."
        return
    if case == "after_held_order":
        wiremock.fault("POST", "/v1/payments")
        held = exercise(hc, gid, 100)
        refused(held, 503, "provider_unavailable")
        exercisable -= 100
        payments = len(wiremock.requests("/v1/payments", "POST"))
    ask = {"over_vested": exercisable + 1, "before_cliff": 1, "zero": 0, "not_integer": 1.5, "after_held_order": exercisable + 1}[case]
    fields = invalid(exercise(hc, gid, ask))
    if case in ("zero", "not_integer"):
        assert fields["options"] == "Enter a whole number of options."
    else:
        assert plain(fields["options"]) == f"Only {exercisable} vested options are available to exercise."
    assert len(wiremock.requests("/v1/payments", "POST")) == payments
    assert len([o for o in orders_of(hc) if o["state"] == "issued"]) == 0


def test_idempotent_exercise_orders(app_url: str, wiremock: WireMock) -> None:
    person, hc, grant = holder_with_grant(app_url)
    _, h2, g2 = holder_with_grant(app_url)
    gid, key = grant["id"], new_key()
    clients = [login(app_url, person["email"]) for _ in range(5)]
    barrier = threading.Barrier(5)

    def fire(i: int) -> httpx.Response:
        barrier.wait()
        return exercise(clients[i], gid, 10, key)

    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(fire, range(5)))
    assert {r.status_code for r in results} == {results[0].status_code} and results[0].status_code == 201
    assert all(r.json() == results[0].json() for r in results)
    orders = [o for o in orders_of(hc) if o["idempotency_key"] == key]
    assert len(orders) == 1
    assert len(payments_for(wiremock, orders[0]["id"])) == 1
    again = exercise(hc, gid, 10, key)
    assert again.status_code == 201 and again.json() == results[0].json()
    refused(exercise(hc, gid, 11, key), 409, "idempotency_key_reused")
    foreign = exercise(h2, g2["id"], 10, key)
    assert foreign.status_code in (404, 409), foreign.text
    refused(foreign, foreign.status_code, "idempotency_key_reused" if foreign.status_code == 409 else "not_found")
    assert len(orders_of(hc)) == 1
    for bad in (None, "short", "x" * 65, "bad key!"):
        headers = {} if bad is None else {"Idempotency-Key": bad}
        fields = invalid(hc.post(f"/api/grants/{gid}/exercises", json={"options": 1}, headers=headers))
        assert "idempotency_key" in fields


CONFIRM_CASES = ["amount_mismatch", "reference_mismatch", "status_failed", "confirmed_matching"]


@pytest.mark.parametrize("case", CONFIRM_CASES, ids=CONFIRM_CASES)
def test_provider_confirmed_issuance(app_url: str, wiremock: WireMock, case: str) -> None:
    person, hc, grant = holder_with_grant(app_url)
    options = 5
    cost = cents(cost_of(options, grant["strike"]))
    if case == "amount_mismatch":
        stub_pending_payment(wiremock, options, grant["strike"], record_status="confirmed", record_amount=cost + 1)
    elif case == "reference_mismatch":
        stub_pending_payment(wiremock, options, grant["strike"], record_status="confirmed", record_reference="EXO-999999")
    elif case == "status_failed":
        stub_pending_payment(wiremock, options, grant["strike"], record_status="failed")
    exercise(hc, grant["id"], options)
    order = orders_of(hc)[0]
    if case == "confirmed_matching":
        order = wait_order(hc, order["id"], ("issued",))
        assert order["payment"]["status"] == "confirmed" and order["payment"]["reference"] == order["id"]
        assert wiremock.requests(f"/v1/payments/{order['payment']['id']}", "GET")
        assert issued_of(hc, person["id"]) == options
    else:
        assert order["state"] == "held"
        assert issued_of(hc, person["id"]) == 0
        assert [e for e in ledger(hc) if e["kind"] == "exercise_issued"] == []
        assert hc.post(f"/api/exercises/{order['id']}/cancel", json={}).status_code == 200


PROVIDER_CASES = ["connection_reset", "server_error", "no_answer", "pending_then_confirmed"]


@pytest.mark.timeout(300)
@pytest.mark.parametrize("case", PROVIDER_CASES, ids=PROVIDER_CASES)
def test_wf_exercise_provider_recovery(app_url: str, wiremock: WireMock, case: str) -> None:
    person, hc, grant = holder_with_grant(app_url)
    gid, options, key = grant["id"], 10, new_key()
    if case == "pending_then_confirmed":
        amount = stub_pending_payment(wiremock, options, grant["strike"])
        r = exercise(hc, gid, options, key)
        assert r.status_code == 201 and r.json()["state"] == "pending" and r.json()["payment"]["status"] == "pending"
        oid, pid = r.json()["id"], r.json()["payment"]["id"]
        assert r.json()["payment"]["reference"] == oid
        assert issued_of(hc, person["id"]) == 0
        stub_confirmed(wiremock, pid, amount, oid)
        order = wait_order(hc, oid, ("issued",), PROVIDER_ANSWER_S * 4)
        assert issued_of(hc, person["id"]) == options
        assert len([e for e in ledger(hc) if e["kind"] == "exercise_issued"]) == 1
        assert exercise(hc, gid, options, key).json() == r.json()
        return
    if case == "connection_reset":
        wiremock.fault("POST", "/v1/payments")
    elif case == "server_error":
        wiremock.stub("POST", "/v1/payments", status=500, json={"error": "down"})
    else:
        wiremock.stub("POST", "/v1/payments", status=201, delay_ms=SLOW_DELAY_MS,
                      json={"id": "pay_1_slow", "status": "pending", "amount_cents": 1, "currency": "USD", "reference": "slow"})
    first = exercise(hc, gid, options, key)
    body = refused(first, 503, "provider_unavailable")
    held = body["order"]
    assert held["state"] == "held" and held["idempotency_key"] == key
    assert issued_of(hc, person["id"]) == 0
    restore_provider(wiremock, held)
    r = hc.post(f"/api/exercises/{held['id']}/retry", json={})
    assert r.status_code == 200 and r.json()["state"] == "issued"
    assert issued_of(hc, person["id"]) == options
    assert len([e for e in ledger(hc) if e["kind"] == "exercise_issued"]) == 1
    wait_order(hc, held["id"], ("issued",))
    poll_key(f"exercise-notices/{held['id']}.txt")
    poll(lambda: hc.get(f"/api/exercises/{held['id']}").json(), lambda o: (o["notice"] or {}).get("status") == "sealed", LIVE_WAIT_S, "the notice sealed")
    refused(hc.post(f"/api/exercises/{held['id']}/retry", json={}), 409, "nothing_to_retry")
    assert exercise(hc, gid, options, key).json() == first.json()
    assert {req_header(e, "Idempotency-Key") for e in payments_for(wiremock, held["id"])} == {key}


CANCEL_CASES = ["pending", "held", "issued"]


@pytest.mark.timeout(300)
@pytest.mark.parametrize("case", CANCEL_CASES, ids=CANCEL_CASES)
def test_cancel_wins(app_url: str, wiremock: WireMock, case: str) -> None:
    person, hc, grant = holder_with_grant(app_url)
    gid, options = grant["id"], 10
    if case == "pending":
        amount = stub_pending_payment(wiremock, options, grant["strike"])
    elif case == "held":
        wiremock.fault("POST", "/v1/payments")
    r = exercise(hc, gid, options)
    order = r.json() if r.status_code == 201 else r.json()["order"]
    if case == "issued":
        order = wait_order(hc, order["id"], ("issued",))
        refused(hc.post(f"/api/exercises/{order['id']}/cancel", json={}), 409, "order_not_cancellable")
        assert issued_of(hc, person["id"]) == options
        return
    cancelled = hc.post(f"/api/exercises/{order['id']}/cancel", json={})
    assert cancelled.status_code == 200 and cancelled.json()["state"] == "cancelled"
    if case == "pending":
        pid = order["payment"]["id"]
        stub_confirmed(wiremock, pid, amount, order["id"])
        poll(lambda: wiremock.requests(f"/v1/payments/{pid}/cancel", "POST"), bool, LIVE_WAIT_S + 10, "the provider cancel")
    assert hc.get(f"/api/exercises/{order['id']}").json()["state"] == "cancelled"
    assert issued_of(hc, person["id"]) == 0
    assert [e for e in ledger(hc) if e["kind"] == "exercise_issued"] == []
    refused(hc.post(f"/api/exercises/{order['id']}/cancel", json={}), 409, "order_not_cancellable")


def test_exercise_notice_in_vault(app_url: str) -> None:
    person, hc, grant = holder_with_grant(app_url)
    r = exercise(hc, grant["id"], 3217)
    order = wait_order(hc, r.json()["id"], ("issued",))
    order = poll(lambda: hc.get(f"/api/exercises/{order['id']}").json(), lambda o: (o["notice"] or {}).get("status") == "sealed",
                 LIVE_WAIT_S + 10, "the notice to be sealed")
    data = poll_key(f"exercise-notices/{order['id']}.txt")
    lines = data.decode("utf-8").split("\n")
    for line in (f"Order: {order['id']}", f"Grant: {grant['id']}", f"Holder: {person['name']}", "Options exercised: 3,217",
                 f"Strike price: {fmt_price(grant['strike'])}", f"Exercise cost: {fmt_money(order['cost'])}",
                 f"Payment reference: {order['payment']['id']}"):
        assert line in lines, line
    doc = hc.get(f"/api/documents/{order['notice']['document_id']}").json()
    assert doc["kind"] == "exercise_notice" and doc["sha256"] == hashlib.sha256(data).hexdigest()


def test_exercise_notice_pending_when_vault_down(app_url: str) -> None:
    base = outage_url("APP_VAULT_DOWN_URL")
    hc = login(base, JUNIPER)
    r = exercise(hc, JUNIPER_GRANT, 1)
    assert r.status_code == 201, r.text
    order = wait_order(hc, r.json()["id"], ("issued",))
    assert order["notice"]["status"] == "pending"
    body = refused(hc.post(f"/api/exercises/{order['id']}/retry", json={}), 503, "vault_unavailable")
    assert body["order"]["state"] == "issued"


def test_racing_exercises_within_exercisable(app_url: str, wiremock: WireMock) -> None:
    person, hc, grant = holder_with_grant(app_url)
    gid, ex = grant["id"], grant["exercisable"]
    part = ex // 2 + 1
    clients = [login(app_url, person["email"]) for _ in range(2)]
    barrier = threading.Barrier(2)

    def fire(i: int) -> httpx.Response:
        barrier.wait()
        return exercise(clients[i], gid, part)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(fire, range(2)))
    assert sorted(r.status_code for r in results) == [201, 422], [r.text for r in results]
    fields = invalid(next(r for r in results if r.status_code == 422))
    assert fields.get("options") == f"Only {fmt_count(ex - part)} vested options are available to exercise.", fields
    assert len(orders_of(hc)) == 1
    g = hc.get(f"/api/grants/{gid}").json()
    assert g["exercised"] + g["in_open_orders"] == part and g["exercised"] + g["in_open_orders"] <= ex


@pytest.mark.timeout(300)
def test_wf_exercise_pending_page_live(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    person, hc, grant = holder_with_grant(app_url)
    options = 7
    amount = stub_pending_payment(wiremock, options, grant["strike"])
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/grants/{grant['id']}")
        opener = page.get_by_role("button", name="Exercise", exact=True)
        expect(opener).to_be_enabled(timeout=PAGE_MS)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Exercise options")
        type_into(page, dialog.get_by_role("textbox", name="Options to exercise"), str(options))
        advance(page, ADVANCE_STEP_MS * 3)
        page.keyboard.press("Enter")
        order = poll(lambda: orders_of(hc), lambda os_: bool(os_) and os_[0]["payment"] is not None, PROVIDER_ANSWER_S * 4,
                     "the placed order with its provider payment")[0]
        heading = page.get_by_role("heading", level=1, name=order["id"])
        eventually(page, lambda: expect(heading).to_be_focused(timeout=EXPECT_STEP_MS), "focus on the order heading", PAGE_S)
        eventually(page, state_word(page, "Pending"), "the order page shows Pending", PAGE_S)
        watch_announcements(page)
        stub_confirmed(wiremock, order["payment"]["id"], amount, order["id"])
        eventually(page, state_word(page, "Issued"), "Issued in place", LIVE_WAIT_S)
        copy = f"Payment confirmed. {fmt_count(options)} shares issued on grant {grant['id']}."
        expect_announced(page, copy)
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), copy) == 1
        expect(heading).to_be_focused()
        assert urlparse(page.url).path == f"/exercises/{order['id']}"


@pytest.mark.timeout(300)
def test_wf_exercise_dialog_phone(browser: Browser, app_url: str) -> None:
    _, hc, grant = holder_with_grant(app_url)
    with browse(browser, app_url) as phone:
        w, h = VIEWPORTS["375"]
        phone.set_viewport_size({"width": w, "height": h})
        signed_in(phone, app_url, hc, f"/grants/{grant['id']}")
        opener = phone.get_by_role("button", name="Exercise", exact=True)
        expect(opener).to_be_enabled(timeout=PAGE_MS)
        opener.focus()
        phone.keyboard.press("Enter")
        dialog = phone.get_by_role("dialog", name="Exercise options")
        expect(dialog).to_be_visible(timeout=PAGE_MS)
        box = dialog.bounding_box()
        assert box and box["x"] <= 1 and box["width"] >= w - 1 and box["height"] >= h - 1, f"the dialog fills the phone screen: {box}"
        close = dialog.get_by_role("button", name="Close", exact=True)
        cb = close.bounding_box()
        assert cb and cb["width"] >= TARGET_PX and cb["height"] >= TARGET_PX, f"Close is a 44 px target: {cb}"
        close.tap()
        expect(dialog).to_have_count(0)
        eventually(phone, lambda: expect(opener).to_be_focused(timeout=EXPECT_STEP_MS), "focus back on Exercise")
        layout(phone)


def test_record_departure(app_url: str) -> None:
    adm = admin(app_url)
    person, hc, grant = holder_with_grant(app_url)
    _, _, spare = offered_grant(app_url)
    spare_owner = admin(app_url).get(f"/api/grants/{spare['id']}").json()["holder_id"]
    assert spare_owner != person["id"]
    extra = draft_grant(app_url, person["id"])
    queue_grant(app_url, extra["id"])
    approve(app_url, extra["id"])
    assert adm.post(f"/api/grants/{extra['id']}/offer", json={}).status_code == 200
    outstanding = pool_of(adm)["outstanding"]
    person_after = departure(app_url, person["id"])
    dep = person_after["departure"]
    assert person_after["role"] == "leaver"
    assert parse_instant(dep["window_ends_at"]) - parse_instant(dep["terminated_at"]) == timedelta(seconds=LEAVER_WINDOW_S)
    assert dep["termination_date"] == server_day(adm).isoformat()
    g = hc.get(f"/api/grants/{grant['id']}").json()
    assert g["vested"] == grant["vested"] and g["forfeited"] == g["options"] - g["vested"] and g["cancelled"] == 0
    assert g["exercisable"] == g["vested"] and g["next_tranche"] is None and g["exercise_window_ends_at"] == dep["window_ends_at"]
    for t in g["schedule"]:
        if t["date"] > dep["termination_date"]:
            assert t["state"] == "cancelled" and t["cumulative"] == g["vested"]
    last = g["schedule"][-1]
    assert last["cost_at_strike"] == f"{cost_of(g['vested'], g['strike'])}"
    assert hc.get(f"/api/grants/{extra['id']}").json()["state"] == "expired"
    cancelled = [e for e in ledger(adm) if e["holder_id"] == person["id"] and e["kind"] == "options_cancelled"]
    assert len(cancelled) == 1 and cancelled[0]["options_delta"] == -g["forfeited"]
    assert pool_of(adm)["outstanding"] == outstanding - g["forfeited"]
    refused(adm.post(f"/api/people/{person['id']}/departure", json={}), 409, "not_an_option_holder")
    refused(adm.patch(f"/api/people/{person['id']}", json={"role": "investor"}), 409, "person_is_leaver")
    investor, _ = new_person(app_url, role="investor", prefix="investor")
    refused(adm.post(f"/api/people/{investor['id']}/departure", json={}), 409, "not_an_option_holder")


def short_leaver(base: str) -> tuple[dict[str, Any], httpx.Client, dict[str, Any]]:
    return holder_with_grant(base)


@pytest.mark.timeout(300)
def test_wf_leaver_window_journey(browser: Browser, app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    person, hc, grant = short_leaver(base)
    gid = grant["id"]
    with browse(browser, base) as page:
        page.goto(base + "/")
        sign_in_form(page, person["email"])
        dep = departure(base, person["id"])["departure"]
        ends = parse_instant(dep["window_ends_at"])
        page.get_by_label("Password").press("Enter")
        board = page.get_by_role("region", name="Portal board")
        expect(board).to_contain_text(tile("Exercisable now:", fmt_count(grant["vested"])), timeout=PAGE_MS)
        timer = board.get_by_role("timer", name="Exercise window")
        expect(timer).to_have_text(COUNTDOWN_LEFT, timeout=PAGE_MS)
        page.get_by_role("navigation", name="Register").get_by_role("link", name="Vesting").click()
        band = page.get_by_role("timer", name="Exercise window")
        expect(band).to_have_text(COUNTDOWN_LEFT, timeout=PAGE_MS)
        shown = re.match(r"\s*(\d+)d (\d\d):(\d\d):(\d\d)", band.inner_text())
        assert shown
        seconds = int(shown[1]) * 86400 + int(shown[2]) * 3600 + int(shown[3]) * 60 + int(shown[4])
        assert abs(seconds - (ends - server_now(hc)).total_seconds()) <= COUNTDOWN_SLACK_S
        page.get_by_role("button", name="Exercise").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Exercise options")
        expect(dialog.get_by_role("textbox", name="Options to exercise")).to_be_focused(timeout=PAGE_MS)
        page.keyboard.type("100")
        page.keyboard.press("Enter")
        page.wait_for_url(re.compile(r"/exercises/EXO-\d+"), timeout=PAGE_MS)
    order = wait_order(hc, orders_of(hc)[0]["id"], ("issued", "pending"))
    assert parse_instant(order["placed_at"]) < ends
    assert hc.get(f"/api/grants/{gid}").json()["exercised"] in (0, 100)


@pytest.mark.timeout(300)
def test_wf_leaver_window_edge(app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    person, hc, grant = short_leaver(base)
    gid, count = grant["id"], 100
    ends = parse_instant(departure(base, person["id"])["departure"]["window_ends_at"])
    deadline = time.monotonic() + (ends - server_now(hc)).total_seconds() + LIVE_WAIT_S
    while time.monotonic() < deadline:
        left = (ends - server_now(hc)).total_seconds()
        if left <= EDGE_LEAD_S:
            break
        if left > 3 * EDGE_LEAD_S:
            _TICK.wait(POLL_S)
    else:
        pytest.fail("the window never came within the edge lead")
    r = exercise(hc, gid, count)
    assert r.status_code == 201, r.text
    assert parse_instant(r.json()["placed_at"]) < ends
    poll(lambda: server_now(hc), lambda t: t >= ends, LIVE_WAIT_S, "the window end")
    g = poll(lambda: hc.get(f"/api/grants/{gid}").json(), lambda x: x["exercisable"] == 0, LIVE_WAIT_S, "the window-end cancellation")
    refused(exercise(hc, gid, 1), 409, "exercise_window_closed")
    wait_order(hc, r.json()["id"], ("issued",))
    assert g["exercised"] == count and g["cancelled"] == g["vested"] - count


@pytest.mark.timeout(300)
def test_wf_leaver_window_end(browser: Browser, app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    person, hc, grant = short_leaver(base)
    gid, count = grant["id"], 100
    dep = departure(base, person["id"])["departure"]
    ends = parse_instant(dep["window_ends_at"])
    assert exercise(hc, gid, count).status_code == 201
    unexercised = grant["vested"] - count
    with browse(browser, base) as page, browse(browser, base) as portal:
        signed_in(page, base, hc, f"/grants/{gid}")
        signed_in(portal, base, hc, "/")
        watch_announcements(page)
        board = portal.get_by_role("region", name="Portal board")
        expect(board).to_contain_text(tile("Exercisable now:", fmt_count(unexercised)), timeout=PAGE_MS)
        poll(lambda: server_now(hc), lambda t: t >= ends, EXPIRY_WAIT_S, "the window end")
        g = poll(lambda: hc.get(f"/api/grants/{gid}").json(), lambda x: x["exercisable"] == 0, LIVE_WAIT_S, "cancellation")
        eventually(portal, lambda: expect(board).to_contain_text(tile("Exercisable now:", "0"), timeout=EXPECT_STEP_MS), "Exercisable now 0", LIVE_WAIT_S)
        eventually(page, lambda: expect(page.get_by_role("timer", name="Exercise window")).to_have_text(re.compile("Window closed"), timeout=EXPECT_STEP_MS),
                   "Window closed", LIVE_WAIT_S)
        expect_announced(page, f"Your exercise window has closed. {fmt_count(unexercised)} unexercised options on grant {gid} were cancelled.")
        by = {t["month"]: t for t in g["schedule"]}
        for m in cell_marks(g["vesting_type"]):
            t = by[m]
            want = "cancelled" if t["date"] > dep["termination_date"] or t["cumulative"] > g["exercised"] else "vested"
            assert t["state"] == want, f"mark {m}"
        expect_ribbon(page, g)
    assert g["cancelled"] == unexercised and g["vested"] == grant["vested"] and g["exercised"] == count
    assert issued_of(hc, person["id"]) == count


@pytest.mark.timeout(300)
def test_wf_leaver_window_warnings(browser: Browser, app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    person, hc, grant = short_leaver(base)
    gid = grant["id"]
    dep = departure(base, person["id"])["departure"]
    ends = parse_instant(dep["window_ends_at"])
    warnings = [parse_instant(x) for x in dep["warnings_at"]]
    assert warnings, "the short-window instance has leaver warnings ahead of its window end"
    assert warnings == sorted(warnings) and all(parse_instant(dep["terminated_at"]) < x < ends for x in warnings)
    with browse(browser, base) as page:
        w, h = VIEWPORTS["375"]
        page.set_viewport_size({"width": w, "height": h})
        signed_in(page, base, hc, f"/grants/{gid}")
        expect(page.get_by_role("timer", name="Exercise window")).to_be_visible(timeout=PAGE_MS)
        watch_announcements(page)
        watched = server_now(hc)
        strip = page.get_by_role("region", name="Window warning")
        for at in warnings:
            copy = f"Your exercise window on grant {gid} closes in {fmt_countdown((ends - at).total_seconds())}."
            poll(lambda: server_now(hc), lambda t, at=at: t >= at, EXPIRY_WAIT_S, "the server clock to reach a leaver warning")
            eventually(page, lambda copy=copy: expect(strip).to_contain_text(copy, timeout=EXPECT_STEP_MS), "the window warning strip", LIVE_WAIT_S)
            if at > watched:
                expect_announced(page, copy)
            layout(page)
            box = strip.bounding_box()
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= w + 1, f"the warning must fit the phone: {box}"
        advance(page, DRAFT_SAVE_MS)
        log = announced(page)
        for at in (x for x in warnings if x > watched):
            assert times_once(log, f"closes in {fmt_countdown((ends - at).total_seconds())}.") == 1


@pytest.mark.timeout(300)
def test_wf_leaver_window_last_second_race(app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    person, hc, grant = short_leaver(base)
    gid, key, options = grant["id"], new_key(), 10
    ends = parse_instant(departure(base, person["id"])["departure"]["window_ends_at"])
    clients = [login(base, person["email"]) for _ in range(5)]
    barrier = threading.Barrier(5)

    def fire(i: int) -> httpx.Response:
        barrier.wait()
        return exercise(clients[i], gid, options, key)

    poll(lambda: server_now(hc), lambda t: t >= ends - timedelta(seconds=EDGE_LEAD_S), EXPIRY_WAIT_S, "a second before the window end")
    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(fire, range(5)))
    assert {r.status_code for r in results} == {201}, [r.text for r in results]
    assert all(r.json() == results[0].json() for r in results)
    oid = results[0].json()["id"]
    assert parse_instant(results[0].json()["placed_at"]) < ends
    poll(lambda: server_now(hc), lambda t: t >= ends, EXPIRY_WAIT_S, "the window end")
    g = poll(lambda: hc.get(f"/api/grants/{gid}").json(), lambda x: x["exercisable"] == 0, LIVE_WAIT_S, "the end cancellation")
    wait_order(hc, oid, ("issued",))
    assert len([o for o in orders_of(hc) if o["idempotency_key"] == key]) == 1
    g = hc.get(f"/api/grants/{gid}").json()
    assert g["exercised"] == options and g["cancelled"] == grant["vested"] - options


@pytest.mark.timeout(300)
def test_wf_leaver_window_replay(browser: Browser, app_url: str) -> None:
    base = outage_url("APP_SHORT_URL")
    person, hc, grant = short_leaver(base)
    gid = grant["id"]
    ends = parse_instant(departure(base, person["id"])["departure"]["window_ends_at"])
    with browse(browser, base) as page:
        routes, hold = live_socket(page)
        signed_in(page, base, hc, f"/grants/{gid}")
        expect(page.get_by_role("timer", name="Exercise window")).to_be_visible(timeout=PAGE_MS)
        eventually(page, lambda: _assert_count(routes, 1), "the page opens its socket")
        watch_announcements(page)
        drop_socket(routes, hold)
        poll(lambda: server_now(hc), lambda t: t >= ends + timedelta(seconds=1), EXPIRY_WAIT_S, "the server clock past the window end")
        poll(lambda: hc.get(f"/api/grants/{gid}").json()["exercisable"], lambda e: e == 0, LIVE_WAIT_S, "the server cancellation")
        hold["on"] = False
        await_reconnect(page, routes, 2)
        copy = f"Your exercise window has closed. {fmt_count(grant['vested'])} unexercised options on grant {gid} were cancelled."
        expect_announced(page, copy)
        eventually(page, lambda: expect(labelled(page, "Exercisable now", "0")).to_be_visible(timeout=EXPECT_STEP_MS), "Exercisable now 0", LIVE_WAIT_S)
        expect(page.get_by_role("timer", name="Exercise window")).to_have_text(re.compile("Window closed"))
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), copy) == 1


@pytest.mark.timeout(300)
def test_wf_leaver_window_phone_ribbon(browser: Browser, app_url: str) -> None:
    person, hc, grant = holder_with_grant(app_url)
    departure(app_url, person["id"])
    g = hc.get(f"/api/grants/{grant['id']}").json()
    today = latest_mark(date.fromisoformat(g["vesting_start"]), server_day(hc))
    assert today is not None
    with browse(browser, app_url, reduced_motion="reduce") as phone:
        w, h = VIEWPORTS["375"]
        phone.set_viewport_size({"width": w, "height": h})
        signed_in(phone, app_url, hc, f"/grants/{grant['id']}")
        expect(phone.get_by_role("timer", name="Exercise window")).to_be_visible(timeout=PAGE_MS)
        slider = phone.get_by_role("slider", name="Projection date")
        expect(ribbon_items(phone)).to_have_count(len(cell_marks(g["vesting_type"])), timeout=PAGE_MS)
        slider.focus()
        mark = today
        for key in ("End", "Home", "PageDown", "PageDown", "PageDown", "End"):
            mark = MARKS if key == "End" else today if key == "Home" else max(0, mark - CLIFF_MONTHS)
            phone.keyboard.press(key)
            expect(slider).to_have_attribute("aria-valuenow", str(mark), timeout=PAGE_MS)
            advance(phone, 48)
            index = marker_cell_index(g["vesting_type"], mark)
            assert cell_in_track(phone, index), f"after {key} the marker's cell {index} must be inside the track at once"
        layout(phone)


def test_open_tender_offer(app_url: str) -> None:
    adm = admin(app_url)
    inv, ic = investor_with_shares(app_url, 10)
    await_no_open_tender(adm)
    soon = iso(server_now(adm) + timedelta(seconds=CLOSE_SHORT_S))
    ok = {"title": f"Tender {uuid.uuid4().hex[:6]}", "price_per_share": "2.4000", "share_cap": 100, "closes_at": soon}
    refused(ic.post("/api/tenders", json=ok), 403, "forbidden")
    cases = [("closes_at", {"closes_at": iso(server_now(adm) + timedelta(seconds=3))}, "Set a close time at least 10 seconds from now."),
             ("share_cap", {"share_cap": 0}, "Enter a whole number of shares from 1 upward."),
             ("share_cap", {"share_cap": "100"}, None),
             ("price_per_share", {"price_per_share": "0.0000"}, "Enter a price above $0.0000 with up to four decimals."),
             ("price_per_share", {"price_per_share": "1.23456"}, "Enter a price above $0.0000 with up to four decimals."),
             ("price_per_share", {"price_per_share": 1.5}, None)]
    for key, change, message in cases:
        fields = invalid(adm.post("/api/tenders", json={**ok, **change}))
        assert key in fields and (message is None or fields[key] == message)
    r = adm.post("/api/tenders", json=ok)
    assert r.status_code == 201, r.text
    tender = r.json()
    assert tender["buyer"] == BUYER and tender["state"] == "open" and tender["price_per_share"] == "2.4000"
    assert tender["share_cap"] == 100 and tender["remaining_cap"] == 100 and tender["oversubscribed_by"] == 0
    refused(adm.post("/api/tenders", json={**ok, "title": "Another"}), 409, "tender_already_open")
    wait_tender(adm, tender["id"], "closed", TENDER_WAIT_S)


@pytest.mark.timeout(900)
def test_wf_tender_journey(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    a, ac = investor_with_shares(app_url, 90000, "Series A Preferred")
    b, bc = investor_with_shares(app_url, 60000, "Series Seed Preferred")
    await_no_open_tender(adm)
    harbour_before = issued_of(adm, HARBOURLINE_ID)
    title = f"Secondary {uuid.uuid4().hex[:6]}"
    closes = (server_now(adm) + timedelta(seconds=TENDER_LEAD_S)).astimezone(PACIFIC).replace(second=0, microsecond=0) + timedelta(minutes=1)
    with browse(browser, app_url) as mara, browse(browser, app_url) as page:
        signed_in(mara, app_url, adm, "/admin/tenders")
        form = mara.get_by_role("form", name="Open tender offer")
        fill(form.get_by_role("textbox", name="Title"), title)
        fill(form.get_by_role("textbox", name="Price per share"), "2.4000")
        fill(form.get_by_role("textbox", name="Share cap"), "100001")
        fill(form.get_by_role("textbox", name="Closes at"), closes.strftime("%Y-%m-%d %H:%M"))
        watch_announcements(mara)
        form.get_by_role("button", name="Open tender").click()
        tender = poll(lambda: [t for t in adm.get("/api/tenders").json()["tenders"] if t["title"] == title], bool, LIVE_WAIT_S, "the opened tender")[0]
        tid = tender["id"]
        expect_announced(mara, f"Tender {tid} is open until")
        signed_in(page, app_url, ac, f"/tenders/{tid}")
        expect(page.get_by_role("heading", level=1, name=title)).to_be_visible(timeout=PAGE_MS)
        watch_announcements(page)
        expect(page.get_by_role("button", name="Submit tender")).to_be_disabled()
        expect_shown(page, "Sign the NDA to tender")
        page.get_by_role("button", name="Sign NDA").click()
        expect_announced(page, "NDA signed and sealed.")
        type_into(page, page.get_by_role("textbox", name="Shares to tender"), "90000")
        page.get_by_role("button", name="Submit tender").click()
        expect_announced(page, "Tender submitted: 90,000 shares at $2.4000.")
        expect(page.get_by_role("textbox", name="Shares to tender")).not_to_be_editable()
        expect(page.get_by_role("button", name="Withdraw tender")).to_be_visible()
        region = page.get_by_role("region", name="Your allocation")
        expect(region).to_contain_text(tile("Projected allocation", "90,000"), timeout=PAGE_MS)
        sign_nda(bc, tid)
        assert submit_tender(bc, tid, 60000).status_code == 201
        eventually(page, lambda: expect(region).to_contain_text(tile("Projected allocation", "60,001"), timeout=EXPECT_STEP_MS), "projected allocation", LIVE_WAIT_S)
        wait_tender(adm, tid, "allocated", TENDER_WAIT_S)
        eventually(page, lambda: expect(region).to_contain_text(tile("Allocated", "60,001", "shares, proceeds", "$144,002.40"), timeout=EXPECT_STEP_MS),
                   "final allocation", LIVE_WAIT_S)
        expect(page.get_by_role("timer", name="Tender closes in")).to_have_text(re.compile("Closed"))
        expect_announced(page, f"Tender {tid} has closed.")
        expect_announced(page, f"Tender {tid} allocated: you sold 60,001 shares for $144,002.40.")
        log = announced(page)
        assert next(i for i, t in enumerate(log) if "has closed" in t) < next(i for i, t in enumerate(log) if "you sold" in t)
    subs = {s["holder_id"]: s for s in adm.get(f"/api/tenders/{tid}").json()["submissions"]}
    assert (subs[a["id"]]["allocation"], subs[b["id"]]["allocation"]) == (60001, 40000)
    assert fmt_money(subs[b["id"]]["proceeds"]) == "$96,000.00"
    assert issued_of(adm, a["id"]) == 90000 - 60001 and issued_of(adm, HARBOURLINE_ID) == harbour_before + 100001


TENDER_SCENARIOS = {
    "brief_example": (100001, "2.4000", [(90000, "Series A Preferred"), (60000, "Series Seed Preferred")]),
    "three_way_leftover": (100, "1.5000", [(70, "Common"), (70, "Common"), (70, "Common")]),
    "within_cap": (1000, "1.0000", [(200, "Common"), (300, "Common")]),
    "simultaneous": (100, "1.5000", [(90, "Common"), (60, "Common"), (50, "Common")]),
}


@pytest.mark.timeout(600)
@pytest.mark.parametrize("case", list(TENDER_SCENARIOS), ids=list(TENDER_SCENARIOS))
def test_tender_pro_rata_allocation(app_url: str, case: str) -> None:
    cap, price, sellers = TENDER_SCENARIOS[case]
    adm = admin(app_url)
    people = [investor_with_shares(app_url, shares, cls) for shares, cls in sellers]
    seen = {e["id"] for e in ledger(adm)}
    tid = open_tender(app_url, cap, price, 25)["id"]
    for (person, c), (shares, _) in zip(people, sellers):
        sign_nda(c, tid)
        if case != "simultaneous":
            assert submit_tender(c, tid, shares).status_code == 201
    if case == "simultaneous":
        with ThreadPoolExecutor(len(people)) as pool:
            codes = list(pool.map(lambda pair: submit_tender(pair[0][1], tid, pair[1][0]).status_code, zip(people, sellers)))
        assert codes == [201] * len(people), codes
    wait_tender(adm, tid, "allocated", TENDER_WAIT_S)
    subs = sorted(adm.get(f"/api/tenders/{tid}").json()["submissions"], key=lambda s: s["sequence"])
    assert len({s["sequence"] for s in subs}) == len(people), "each submission gets its own sequence"
    expected = allocate(cap, [s["shares"] for s in subs])
    assert [s["allocation"] for s in subs] == expected and sum(expected) <= cap
    got_by = {s["holder_id"]: s["allocation"] for s in subs}
    for s in subs:
        assert s["proceeds"] == f"{(Decimal(s['allocation']) * Decimal(price)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)}"
    if case == "brief_example":
        assert expected == [60001, 40000]
        assert fmt_money(subs[0]["proceeds"]) == "$144,002.40" and fmt_money(subs[1]["proceeds"]) == "$96,000.00"
    fresh = [e for e in ledger(adm) if e["id"] not in seen and e["kind"] == "tender_transfer"]
    for (person, c), (shares, cls) in zip(people, sellers):
        got = got_by[person["id"]]
        mine = [e for e in fresh if e["holder_id"] == person["id"]]
        assert sum(e["shares_delta"] for e in mine) == -got and all(e["class"] == cls for e in mine)
        assert issued_of(c, person["id"]) == shares - got
        assert c.get(f"/api/tenders/{tid}").json()["mine"]["allocation"] == got
    assert sum(e["shares_delta"] for e in fresh if e["holder_id"] == HARBOURLINE_ID) == sum(expected)


@pytest.mark.timeout(600)
def test_tender_submission_rules(app_url: str) -> None:
    adm = admin(app_url)
    inv, ic = investor_with_shares(app_url, 1000)
    hc = new_person(app_url)[1]
    tid = open_tender(app_url, 5000, "1.0000", 40)["id"]
    refused(hc.get("/api/tenders"), 403, "forbidden")
    late = investor_with_shares(app_url, 100)[1]
    sign_nda(late, tid)
    refused(submit_tender(ic, tid, 10), 409, "nda_required")
    sealed = sign_nda(ic, tid)
    assert sealed["mine"]["nda"]["status"] == "sealed"
    poll_key(f"tender-ndas/{tid}/{inv['id']}.txt")
    refused(ic.post(f"/api/tenders/{tid}/nda", json={}), 409, "nda_already_signed")
    for bad in (0, 1001, "5"):
        fields = invalid(submit_tender(ic, tid, bad))
        assert "shares" in fields
    owned = 1000
    assert plain(invalid(submit_tender(ic, tid, owned + 1))["shares"]) == f"Enter a whole number of shares from 1 to {owned}."
    refused(ic.delete(f"/api/tenders/{tid}/submissions/mine"), 409, "no_submission")
    r = submit_tender(ic, tid, 400)
    assert r.status_code == 201 and r.json()["mine"]["submission"]["shares"] == 400
    first = r.json()["mine"]["submission"]["sequence"]
    refused(submit_tender(ic, tid, 10), 409, "already_submitted")
    t = ic.get(f"/api/tenders/{tid}").json()
    assert t["total_tendered"] == 400 and t["remaining_cap"] == 5000 - 400
    assert ic.delete(f"/api/tenders/{tid}/submissions/mine").status_code == 204
    again = submit_tender(ic, tid, 500)
    assert again.status_code == 201 and again.json()["mine"]["submission"]["sequence"] > first
    wait_tender(adm, tid, "allocated", TENDER_WAIT_S)
    fresh_investor = investor_with_shares(app_url, 100)[1]
    refused(submit_tender(late, tid, 10), 409, "tender_closed")
    refused(ic.delete(f"/api/tenders/{tid}/submissions/mine"), 409, "tender_closed")
    refused(fresh_investor.post(f"/api/tenders/{tid}/nda", json={}), 409, "tender_closed")
    assert ic.get(f"/api/tenders/{tid}").json()["mine"]["allocation"] == 500


@pytest.mark.timeout(600)
def test_wf_tender_live_panel(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    a, ac = investor_with_shares(app_url, 1000)
    b, bc = investor_with_shares(app_url, 800)
    tid = open_tender(app_url, 1000, "2.0000", 60)["id"]
    sign_nda(ac, tid)
    sign_nda(bc, tid)
    assert submit_tender(ac, tid, 600).status_code == 201
    with browse(browser, app_url) as page:
        signed_in(page, app_url, ac, f"/tenders/{tid}")
        region = page.get_by_role("region", name="Your allocation")
        expect(region).to_contain_text(tile("Projected allocation", "600"), timeout=PAGE_MS)
        page.evaluate("() => { window.__stay = 1; }")
        timer = page.get_by_role("timer", name="Tender closes in")
        expect(timer).to_have_text(COUNTDOWN, timeout=PAGE_MS)
        first = timer.inner_text()
        eventually(page, lambda: _assert_changed(timer, first), "the countdown to tick", LIVE_WAIT_S)
        eventually(page, lambda: expect(labelled(page, "Remaining cap", "400")).to_be_visible(timeout=EXPECT_STEP_MS), "remaining cap 400", LIVE_WAIT_S)
        assert submit_tender(bc, tid, 800).status_code == 201
        eventually(page, lambda: expect(region).to_contain_text(tile("Projected allocation", "429"), timeout=EXPECT_STEP_MS), "projected 429", LIVE_WAIT_S)
        eventually(page, lambda: expect(labelled(page, "Oversubscribed by", "400")).to_be_visible(timeout=EXPECT_STEP_MS), "oversubscribed by 400", LIVE_WAIT_S)
        assert bc.delete(f"/api/tenders/{tid}/submissions/mine").status_code == 204
        eventually(page, lambda: expect(region).to_contain_text(tile("Projected allocation", "600"), timeout=EXPECT_STEP_MS), "projected back to 600", LIVE_WAIT_S)
        expect_not_shown(page, "Oversubscribed by")
        assert page.evaluate("() => window.__stay") == 1, "the page must update in place"
        wait_tender(adm, tid, "allocated", TENDER_WAIT_S)
        eventually(page, lambda: expect(region).to_contain_text(tile("Allocated", "600", "shares, proceeds", "$1,200.00"), timeout=EXPECT_STEP_MS),
                   "final allocation", LIVE_WAIT_S)
        expect(timer).to_have_text(re.compile("Closed"))


def _assert_changed(locator: Locator, before: str) -> None:
    assert locator.inner_text() != before, "countdown did not change"


@pytest.mark.timeout(600)
def test_wf_tender_reduced_motion_result(browser: Browser, app_url: str) -> None:
    a, ac = investor_with_shares(app_url, 700)
    b, bc = investor_with_shares(app_url, 500)
    tender = open_tender(app_url, cap=600, price="1.2500", close_in_s=ANNOUNCE_CLOSE_S)
    tid = tender["id"]
    for c, shares in ((ac, 700), (bc, 500)):
        sign_nda(c, tid)
        assert submit_tender(c, tid, shares).status_code == 201
    want = allocate(600, [700, 500])
    with browse(browser, app_url, reduced_motion="reduce") as still, browse(browser, app_url) as moving:
        signed_in(still, app_url, ac, f"/tenders/{tid}")
        signed_in(moving, app_url, bc, f"/tenders/{tid}")
        for page in (still, moving):
            region = page.get_by_role("region", name="Your allocation")
            expect(region).to_contain_text("Projected allocation", timeout=PAGE_MS)
            watch_texts(page, "Your allocation")
        wait_tender(admin(app_url), tid, "allocated", TENDER_WAIT_S)
        for page, got in ((still, want[0]), (moving, want[1])):
            region = page.get_by_role("region", name="Your allocation")
            eventually(page, lambda region=region, got=got: expect(region).to_contain_text(tile("Allocated", fmt_count(got), "shares"), timeout=EXPECT_STEP_MS),
                       "the final allocation", LIVE_WAIT_S)
        def figures(page: Page) -> list[int]:
            return [int(m.group(1).replace(",", "")) for t in seen_texts(page) for m in [re.search(r"Allocated ([\d,]+) shares", t)] if m]
        shown = figures(still)
        assert shown and set(shown) == {want[0]}, f"under reduced motion only the final figure may show: {shown}"
        counted = figures(moving)
        assert counted and counted[-1] == want[1] and len(set(counted)) >= 2 and min(counted) < want[1], f"with motion the figure counts up: {counted}"


CAP_CASES = ["founder_admin_after_issuance", "option_holder_view", "investor_view", "board_member_view"]


@pytest.mark.parametrize("case", CAP_CASES, ids=CAP_CASES)
def test_wf_cap_table_allocation(app_url: str, case: str) -> None:
    adm = admin(app_url)
    if case == "founder_admin_after_issuance":
        before = cap_table(adm)["fully_diluted_total"]
        inv, _ = investor_with_shares(app_url, ISSUE_SHARES)
        table = cap_table(adm)
        assert table["fully_diluted_total"] == before + ISSUE_SHARES
        rows = table["rows"]
        mine = next(r for r in rows if r["key"] == inv["id"])
        assert mine["issued_shares"] == ISSUE_SHARES and mine["fully_diluted"] == ISSUE_SHARES
        assert rows[-1]["key"] == "pool" and rows[-1]["label"] == "Unallocated option pool"
        body = rows[:-1]
        assert body == sorted(body, key=lambda r: (-r["fully_diluted"], r["label"]))
        assert sum(r["fully_diluted"] for r in rows) == table["fully_diluted_total"]
        assert [r["ownership"] for r in rows] == largest_remainder([r["fully_diluted"] for r in rows])
        assert sum(Decimal(r["ownership"]) for r in rows) == Decimal("100.00") and table["total_ownership"] == "100.00"
    elif case == "board_member_view":
        table = cap_table(shared(app_url, PRIYA))
        labels = {"common": "Common", "series_seed": "Series Seed Preferred", "series_a": "Series A Preferred",
                  "options_outstanding": "Options outstanding", "pool": "Unallocated option pool"}
        assert {r["key"]: r["label"] for r in table["rows"]} == labels
        assert [r["ownership"] for r in table["rows"]] == largest_remainder([r["fully_diluted"] for r in table["rows"]])
        assert table["fully_diluted_total"] == cap_table(adm)["fully_diluted_total"]
    else:
        if case == "option_holder_view":
            person, c, _ = holder_with_grant(app_url)
        else:
            person, c = investor_with_shares(app_url, 4321)
        table = cap_table(c)
        own = next(r for r in table["rows"] if r["key"] == person["id"])
        others = next(r for r in table["rows"] if r["key"] == "others")
        assert others["label"] == "All other holders" and len(table["rows"]) == 2
        assert Decimal(own["ownership"]) + Decimal(others["ownership"]) == Decimal("100.00")
        assert own["ownership"] == next(r for r in cap_table(adm)["rows"] if r["key"] == person["id"])["ownership"]


@pytest.mark.timeout(300)
def test_wf_cap_table_keyboard(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    rows = cap_table(adm)["rows"]
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/cap-table")
        grid = page.get_by_role("grid", name="Cap table")
        expect(grid).to_be_visible(timeout=PAGE_MS)
        page.get_by_role("navigation", name="Register").get_by_role("link", name="Cap table").focus()
        entered, left = 0, False
        for _ in range(TAB_SCAN):
            page.keyboard.press("Tab")
            if grid.evaluate("(g) => g.contains(document.activeElement)"):
                entered += 1
                if entered == 1:
                    assert rows[0]["label"] in focused_text(page)
            elif entered:
                left = True
                break
        assert entered == 1 and left, "the grid must be exactly one tab stop"
        page.keyboard.press("Shift+Tab")
        assert rows[0]["label"] in focused_text(page), "focus returns to the last focused cell"
        page.keyboard.press("ArrowRight")
        assert fmt_count(rows[0]["issued_shares"]) in focused_text(page)
        page.keyboard.press("ArrowDown")
        assert fmt_count(rows[1]["issued_shares"]) in focused_text(page)
        page.keyboard.press("End")
        assert rows[1]["ownership"] in focused_text(page)
        page.keyboard.press("Home")
        assert rows[1]["label"] in focused_text(page)
        page.keyboard.press("Control+End")
        assert "100.00" in focused_text(page)
        page.keyboard.press("Control+Home")
        assert "100.00" not in focused_text(page)


@pytest.mark.timeout(300)
def test_wf_cap_table_focus_live(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/cap-table")
        grid = page.get_by_role("grid", name="Cap table")
        expect(grid).to_be_visible(timeout=PAGE_MS)
        for _ in range(TAB_SCAN):
            page.keyboard.press("Tab")
            if grid.evaluate("(g) => g.contains(document.activeElement)"):
                break
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        before = page.evaluate(CELL_POS_JS)
        assert before and before["col"] == 2
        inv, _ = investor_with_shares(app_url, BIG_ISSUE)
        eventually(page, lambda: expect(grid.get_by_role("row", name=re.compile(re.escape(inv["name"])))).to_be_visible(timeout=EXPECT_STEP_MS),
                   "the redrawn grid shows the new holder", LIVE_WAIT_S)
        assert page.evaluate(CELL_POS_JS) == before


def test_securities_ledger(app_url: str) -> None:
    adm = admin(app_url)
    seen = {e["id"] for e in ledger(adm)}

    def fresh(**flt: Any) -> list[dict[str, Any]]:
        return [e for e in ledger(adm) if e["id"] not in seen and all(e[k] == v for k, v in flt.items())]

    inv, _ = new_person(app_url, role="investor", prefix="investor")
    entry = adm.post("/api/issuances", json={"holder_id": inv["id"], "class": "Series Seed Preferred", "shares": ISSUE_SHARES}).json()["entry"]
    assert entry["kind"] == "issuance" and entry["class"] == "Series Seed Preferred" and entry["shares_delta"] == ISSUE_SHARES
    assert len(fresh(holder_id=inv["id"])) == 1
    person, hc, grant = holder_with_grant(app_url)
    accepted = fresh(holder_id=person["id"], kind="grant_accepted")
    assert len(accepted) == 1 and accepted[0]["options_delta"] == grant["options"]
    order = wait_order(hc, exercise(hc, grant["id"], 100).json()["id"], ("issued",))
    issued = fresh(holder_id=person["id"], kind="exercise_issued")
    assert len(issued) == 1 and issued[0]["shares_delta"] == 100 and issued[0]["options_delta"] == -100 and issued[0]["class"] == "Common"
    departure(app_url, person["id"])
    forfeit = fresh(holder_id=person["id"], kind="options_cancelled")
    assert len(forfeit) == 1 and forfeit[0]["options_delta"] < 0
    assert len(fresh(holder_id=person["id"])) == 3
    authorized = pool_of(adm)["authorized"]
    assert adm.patch("/api/pool", json={"authorized": authorized + 1}).status_code == 200
    resized = fresh(kind="pool_resized")
    assert len(resized) == 1 and resized[0]["holder_id"] is None
    assert adm.patch("/api/pool", json={"authorized": authorized}).status_code == 200
    assert order["state"] == "issued"


def test_wf_cap_table_pool(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    pool = pool_of(adm)
    assert pool["available"] == pool["authorized"] - pool["outstanding"] - pool["exercised"] - pool["reserved"]
    assert pool["unallocated"] == pool["authorized"] - pool["outstanding"] - pool["exercised"]
    allocated = pool["outstanding"] + pool["exercised"] + pool["reserved"]
    refused(adm.patch("/api/pool", json={"authorized": allocated - 1}), 409, "pool_below_allocated")
    assert pool_of(adm) == pool
    assert "authorized" in invalid(adm.patch("/api/pool", json={"authorized": "1000"}))
    person, _ = new_person(app_url)
    gid = draft_grant(app_url, person["id"])["id"]
    queue_grant(app_url, gid)
    assert pool_of(adm)["reserved"] == pool["reserved"] + DEFAULT_OPTIONS
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/cap-table")
        region = page.get_by_role("region", name="Option pool")
        expect(region).to_contain_text(tile("Authorized", fmt_count(pool["authorized"])), timeout=PAGE_MS)
        for label in ("Outstanding", "Exercised", "Reserved", "Available"):
            expect(region).to_contain_text(label)
        watch_announcements(page)
        now = pool_of(adm)
        low = now["outstanding"] + now["exercised"] + now["reserved"] - 1
        fill(region.get_by_role("textbox", name="Pool size"), str(low))
        region.get_by_role("button", name="Resize pool").click()
        allocated_copy = re.compile(rf"The pool can't be smaller than the ({low + 1}|{low + 1:,}) options already allocated\.")
        expect_shown(page, allocated_copy)


SORT_COLUMNS = {"Holder": ("holder", "label"), "Issued shares": ("issued_shares", "issued_shares"),
                "Options outstanding": ("options_outstanding", "options_outstanding"), "Fully diluted": ("fully_diluted", "fully_diluted"),
                "Ownership": ("ownership", "ownership")}


def sorted_labels(rows: list[dict[str, Any]], field: str, direction: str) -> list[str]:
    def key(r: dict[str, Any]) -> Any:
        return r[field].casefold() if field == "label" else Decimal(str(r[field]))
    groups: dict[Any, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(key(r), []).append(r)
    return [r["label"] for k in sorted(groups, reverse=direction == "desc") for r in groups[k]]


@pytest.mark.parametrize("case", CAP_CASES, ids=CAP_CASES)
def test_wf_cap_table_first_load(browser: Browser, app_url: str, case: str) -> None:
    if case == "founder_admin_after_issuance":
        investor_with_shares(app_url, ISSUE_SHARES)
        c = admin(app_url)
    elif case == "board_member_view":
        c = shared(app_url, PRIYA)
    elif case == "option_holder_view":
        c = holder_with_grant(app_url)[1]
    else:
        c = investor_with_shares(app_url, 4321)[1]
    with browse(browser, app_url) as page:
        rows = cap_table(c)["rows"]
        signed_in(page, app_url, c, "/cap-table")
        total = page.get_by_role("grid", name="Cap table").get_by_role("row", name=re.compile(r"^Total\b"))
        expect(total).to_be_visible(timeout=PAGE_MS)
        expect(total).to_contain_text("100.00")
        _assert_labels(page, [r["label"] for r in rows])


@pytest.mark.timeout(300)
def test_wf_cap_table_sort_address(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/cap-table")
        enter_grid(page)
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowRight")
        assert "Issued shares" in focused_text(page), "ArrowUp from the first row reaches the header row"
        header = page.get_by_role("columnheader", name=re.compile(r"^Issued shares"))
        for press, direction, aria in ((1, "desc", "descending"), (2, "asc", "ascending")):
            page.keyboard.press("Enter" if press == 1 else " ")
            eventually(page, lambda aria=aria: expect(header).to_have_attribute("aria-sort", aria, timeout=EXPECT_STEP_MS), "aria-sort on the header")
            assert "Issued shares" in focused_text(page), "focus stays on the header after sorting"
            for other in ("Holder", "Fully diluted", "Ownership"):
                expect(page.get_by_role("columnheader", name=re.compile("^" + other))).to_have_attribute("aria-sort", "none")
            query = dict(p.split("=", 1) for p in urlparse(page.url).query.split("&") if "=" in p)
            assert query.get("sort") == "issued_shares" and query.get("dir") == direction, page.url
            rows = cap_table(adm)["rows"]
            want = sorted_labels(rows, "issued_shares", direction)
            eventually(page, lambda want=want: _assert_labels(page, want), f"rows sorted {direction}")
        page.reload()
        rows = cap_table(adm)["rows"]
        expect(header).to_have_attribute("aria-sort", "ascending", timeout=PAGE_MS)
        _assert_labels(page, sorted_labels(rows, "issued_shares", "asc"))
        signed_in(page, app_url, adm, "/cap-table?sort=holder&dir=asc")
        holder = page.get_by_role("columnheader", name=re.compile("^Holder"))
        expect(holder).to_have_attribute("aria-sort", "ascending", timeout=PAGE_MS)
        _assert_labels(page, sorted_labels(cap_table(adm)["rows"], "label", "asc"))


def _assert_labels(page: Page, want: list[str]) -> None:
    got = grid_labels(page)
    assert got[:len(want)] == want and got[len(want):] == ["Total"], f"grid rows {got}"


@pytest.mark.timeout(300)
def test_wf_cap_table_holder_address(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/cap-table?sort=fully_diluted&dir=desc")
        enter_grid(page)
        rows = cap_table(adm)["rows"]
        target = next(r for r in rows[1:] if r["key"].startswith("PER-"))
        for _ in range(grid_labels(page).index(target["label"])):
            page.keyboard.press("ArrowDown")
        assert target["label"] in focused_text(page)
        page.keyboard.press("Enter")

        def same(p: Page) -> None:
            detail = p.get_by_role("region", name="Holder detail")
            expect(detail.get_by_role("heading", name=target["label"])).to_be_visible(timeout=PAGE_MS)
            expect(detail.get_by_role("table", name="Holder ledger")).to_be_visible()
            query = dict(x.split("=", 1) for x in urlparse(p.url).query.split("&") if "=" in x)
            assert query.get("holder") == target["key"] and query.get("sort") == "fully_diluted", p.url
            eventually(p, lambda: _assert_focused_label(p, target["label"]), "focus on the selected row")

        same(page)
        page.reload()
        same(page)
        page.get_by_role("navigation", name="Register").get_by_role("link", name="Ledger").click()
        expect(page.get_by_role("table", name="Securities ledger")).to_be_visible(timeout=PAGE_MS)
        page.go_back()
        same(page)
        second = page.context.new_page()
        second.goto(page.url)
        same(second)
        second.close()


def _assert_focused_label(page: Page, label: str) -> None:
    pos = page.evaluate(CELL_POS_JS)
    assert pos and pos["row"] == label, f"focus is on {pos}"


@pytest.mark.timeout(300)
def test_wf_cap_table_pending_exercise(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    adm = admin(app_url)
    person, hc, grant = holder_with_grant(app_url)
    options = 11
    amount = stub_pending_payment(wiremock, options, grant["strike"])
    r = exercise(hc, grant["id"], options)
    assert r.status_code == 201 and r.json()["state"] == "pending", r.text
    order = r.json()
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/cap-table")
        enter_grid(page)
        for _ in range(grid_labels(page).index(person["name"])):
            page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowRight")
        before = page.evaluate(CELL_POS_JS)
        assert before and before["row"] == person["name"] and before["col"] == 1, before
        _assert_focused_text(page, fmt_count(0))
        assert issued_of(adm, person["id"]) == 0, "a pending exercise must not count as issued shares"
        stub_confirmed(wiremock, order["payment"]["id"], amount, order["id"])
        eventually(page, lambda: _assert_focused_text(page, fmt_count(options)), "the issued shares update live on confirmation", LIVE_WAIT_S)
        assert page.evaluate(CELL_POS_JS) == before


SCENARIOS = {"brief_example": ("40000000.00", "10000000.00", "12.00"), "no_top_up": ("40000000.00", "10000000.00", "0.00"),
             "max_pool": ("40000000.00", "10000000.00", "30.00"), "small_money": ("400000000.00", "100000000.00", "5.25")}


@pytest.mark.parametrize("case", list(SCENARIOS), ids=list(SCENARIOS))
def test_round_scenario_arithmetic(app_url: str, case: str) -> None:
    adm = admin(app_url)
    table = cap_table(adm)
    total, unallocated = table["fully_diluted_total"], next(r for r in table["rows"] if r["key"] == "pool")["fully_diluted"]
    pre, inv, pool = SCENARIOS[case]
    r = adm.post("/api/scenarios/round", json={"pre_money": pre, "investment": inv, "target_pool_percent": pool})
    assert r.status_code == 200, r.text
    got, want = r.json(), scenario_oracle(pre, inv, pool, total, unallocated)
    assert want is not None
    for key, value in want.items():
        assert got[key] == value, key
    assert got["fully_diluted_before"] == total and got["unallocated_pool_before"] == unallocated
    if case == "brief_example" and total == 8800000 and unallocated == 928000:
        assert (got["pool_top_up"], got["price_per_share"], got["new_shares"]) == (461177, "4.3191", 2315297)
    assert cap_table(adm)["fully_diluted_total"] == total
    bad = adm.post("/api/scenarios/round", json={"pre_money": "1.00", "investment": "100.00", "target_pool_percent": "30.00"})
    assert invalid(bad)["target_pool_percent"] == "This target pool can't be reached at this investment."
    assert invalid(adm.post("/api/scenarios/round", json={"pre_money": "0", "investment": inv, "target_pool_percent": pool}))["pre_money"] == \
        "Enter an amount above $0.00 with up to two decimals."
    assert invalid(adm.post("/api/scenarios/round", json={"pre_money": pre, "investment": inv, "target_pool_percent": "30.01"}))["target_pool_percent"] == \
        "Enter a percentage from 0.00 to 30.00."
    assert "pre_money" in invalid(adm.post("/api/scenarios/round", json={"pre_money": 5, "investment": inv, "target_pool_percent": pool}))


def test_wf_round_scenario_journey(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    table = cap_table(adm)
    total, unallocated = table["fully_diluted_total"], next(r for r in table["rows"] if r["key"] == "pool")["fully_diluted"]
    pre, inv, pool = SCENARIOS["brief_example"]
    want = scenario_oracle(pre, inv, pool, total, unallocated)
    assert want
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/admin/scenario")
        form = page.get_by_role("form", name="Round scenario")
        expect(form).to_be_visible(timeout=PAGE_MS)
        assert form.get_by_role("button").count() == 0
        page.evaluate("() => { window.__stay = 1; }")
        watch_announcements(page)
        type_into(page, form.get_by_role("textbox", name="Pre-money valuation"), "abc")
        advance(page, ADVANCE_STEP_MS * 3)
        eventually(page, lambda: _assert_shown(page, "Enter an amount above $0.00 with up to two decimals."),
                   "field error")
        for name, text in (("Pre-money valuation", pre), ("New investment", inv), ("Target pool after the round", pool)):
            type_into(page, form.get_by_role("textbox", name=name), text)
        advance(page, ADVANCE_STEP_MS * 3)
        result = page.get_by_role("region", name="Scenario result")
        eventually(page, lambda: expect(result).to_contain_text(tile("Price per share", fmt_price(want["price_per_share"])), timeout=EXPECT_STEP_MS),
                   "result in place", LIVE_WAIT_S)
        expect(result).to_contain_text(tile("Pool top-up", fmt_count(want["pool_top_up"])))
        expect(result).to_contain_text(tile("New shares", fmt_count(want["new_shares"])))
        expect(result).to_contain_text(tile("Investment used", fmt_money(want["investment_used"])))
        expect_announced(page, f"Scenario updated: price per share {fmt_price(want['price_per_share'])}.")
        assert page.evaluate("() => window.__stay") == 1


def test_wf_round_scenario_address(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    table = cap_table(adm)
    total, unallocated = table["fully_diluted_total"], next(r for r in table["rows"] if r["key"] == "pool")["fully_diluted"]
    pre, inv, pool = SCENARIOS["brief_example"]
    want = scenario_oracle(pre, inv, pool, total, unallocated)
    assert want
    price = tile("Price per share", fmt_price(want["price_per_share"]))
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/admin/scenario")
        form = page.get_by_role("form", name="Round scenario")
        expect(form).to_be_visible(timeout=PAGE_MS)
        history = page.evaluate("() => history.length")
        for name, text in (("Pre-money valuation", pre), ("New investment", inv), ("Target pool after the round", pool)):
            type_into(page, form.get_by_role("textbox", name=name), text)
            advance(page, ADVANCE_STEP_MS * 3)
        result = page.get_by_role("region", name="Scenario result")
        eventually(page, lambda: expect(result).to_contain_text(price, timeout=EXPECT_STEP_MS), "result in place", LIVE_WAIT_S)
        eventually(page, lambda: _assert_scenario_query(page, pre, inv, pool), "the inputs in the address")
        assert page.evaluate("() => history.length") == history, "settled input replaces the address, it adds no history entries"
        address = page.url

        def same(p: Page) -> None:
            f = p.get_by_role("form", name="Round scenario")
            expect(f.get_by_role("textbox", name="Pre-money valuation")).to_have_value(pre, timeout=PAGE_MS)
            expect(f.get_by_role("textbox", name="New investment")).to_have_value(inv)
            expect(f.get_by_role("textbox", name="Target pool after the round")).to_have_value(pool)
            eventually(p, lambda: expect(p.get_by_role("region", name="Scenario result")).to_contain_text(price, timeout=EXPECT_STEP_MS),
                       "the same result", LIVE_WAIT_S)

        page.reload()
        same(page)
        page.get_by_role("navigation", name="Register").get_by_role("link", name="Ledger").click()
        expect(page.get_by_role("table", name="Securities ledger")).to_be_visible(timeout=PAGE_MS)
        page.go_back()
        same(page)
        assert page.evaluate("() => history.length") == history + 1, "only the Ledger visit adds a history entry"
        second = page.context.new_page()
        second.goto(address)
        same(second)
        second.close()
    with browse(browser, app_url) as phone:
        w, h = VIEWPORTS["375"]
        phone.set_viewport_size({"width": w, "height": h})
        signed_in(phone, app_url, adm, urlparse(address).path + "?" + urlparse(address).query)
        same(phone)
        layout(phone)
        result = phone.get_by_role("region", name="Scenario result")
        boxes = [result.get_by_text(label, exact=True).first.bounding_box() for label in ("Pool top-up", "Price per share", "New shares")]
        assert all(boxes) and boxes[0]["y"] < boxes[1]["y"] < boxes[2]["y"], f"stacked values: {boxes}"
        assert max(b["x"] for b in boxes) - min(b["x"] for b in boxes) <= 2, f"one column: {boxes}"


def _assert_scenario_query(page: Page, pre: str, inv: str, pool: str) -> None:
    from urllib.parse import parse_qs
    query = parse_qs(urlparse(page.url).query)
    assert urlparse(page.url).path == "/admin/scenario" and query.get("pre") == [pre] and query.get("investment") == [inv] and query.get("pool") == [pool], page.url


@pytest.mark.timeout(300)
def test_wf_round_scenario_saved(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    pre, inv, pool = SCENARIOS["brief_example"]
    name = f"Seed extension {uuid.uuid4().hex[:6]}"
    with browse(browser, app_url) as one, browse(browser, app_url) as two:
        signed_in(two, app_url, adm, "/admin/scenario")
        expect(two.get_by_role("form", name="Round scenario")).to_be_visible(timeout=PAGE_MS)
        signed_in(one, app_url, adm, "/admin/scenario")
        form = one.get_by_role("form", name="Round scenario")
        for field, text in (("Pre-money valuation", pre), ("New investment", inv), ("Target pool after the round", pool)):
            type_into(one, form.get_by_role("textbox", name=field), text)
        advance(one, ADVANCE_STEP_MS * 3)
        watch_announcements(one)
        save = one.get_by_role("form", name="Save scenario")
        type_into(one, save.get_by_role("textbox", name="Scenario name"), name)
        save.get_by_role("button", name="Save scenario", exact=True).click()
        expect_announced(one, f"Scenario {name} saved.")
        link = two.get_by_role("list", name="Saved scenarios").get_by_role("link", name=name, exact=True)
        eventually(two, lambda: expect(link).to_be_visible(timeout=EXPECT_STEP_MS), "the saved scenario in the other tab", LIVE_WAIT_S)
        kept = [s for s in adm.get("/api/scenarios/saved").json()["scenarios"] if s["name"] == name]
        assert len(kept) == 1 and (kept[0]["pre_money"], kept[0]["investment"], kept[0]["target_pool_percent"]) == (pre, inv, pool), kept
        refused(adm.post("/api/scenarios/saved", json={"name": name.upper(), "pre_money": pre, "investment": inv, "target_pool_percent": pool}),
                409, "scenario_name_taken")
        link.focus()
        two.keyboard.press("Enter")
        eventually(two, lambda: _assert_scenario_query(two, pre, inv, pool), "the saved scenario's address")
        expect(two.get_by_role("form", name="Round scenario").get_by_role("textbox", name="Pre-money valuation")).to_have_value(pre, timeout=PAGE_MS)
        two.go_back()
        eventually(two, lambda: expect(link).to_be_focused(timeout=EXPECT_STEP_MS), "Back returns focus to the saved scenario's link")


@pytest.mark.timeout(300)
def test_wf_round_scenario_fmv_live(browser: Browser) -> None:
    base = outage_url("APP_PROVIDER_DOWN_URL")
    adm = admin(base)
    day = server_day(adm)
    fmv = current_fmv(adm)
    table = cap_table(adm)
    total, unallocated = table["fully_diluted_total"], next(r for r in table["rows"] if r["key"] == "pool")["fully_diluted"]
    pre, inv, pool = SCENARIOS["brief_example"]
    want = scenario_oracle(pre, inv, pool, total, unallocated)
    assert want
    r = adm.post("/api/scenarios/round", json={"pre_money": pre, "investment": inv, "target_pool_percent": pool}).json()
    assert r["fmv_per_share"] == f"{fmv:.4f}" and r["price_to_fmv"] == price_to_fmv(want["price_per_share"], fmv), r
    with browse(browser, base) as page:
        signed_in(page, base, adm, f"/admin/scenario?pre={pre}&investment={inv}&pool={pool}")
        result = page.get_by_role("region", name="Scenario result")
        ratio = price_to_fmv(want["price_per_share"], fmv)
        eventually(page, lambda: expect(result).to_contain_text(tile("Price vs fair market value", f"{ratio}×"), timeout=EXPECT_STEP_MS),
                   "the comparison with the current fair market value", LIVE_WAIT_S)
        watch_announcements(page)
        new_fmv = fmv + Decimal("0.0100")
        rec = admin(base).post("/api/valuations", json={"effective_on": current_effective(adm).isoformat(), "expires_on": (day + timedelta(days=365)).isoformat(),
                                                         "fmv_per_share": f"{new_fmv:.4f}", "firm": "Scenario Probe"})
        assert rec.status_code == 201, rec.text
        new_ratio = price_to_fmv(want["price_per_share"], new_fmv)
        eventually(page, lambda: expect(result).to_contain_text(tile("Price vs fair market value", f"{new_ratio}×"), timeout=EXPECT_STEP_MS),
                   "the open scenario follows the new valuation", LIVE_WAIT_S)
        copy = f"Fair market value is now {fmt_price(new_fmv)}; the round price is {new_ratio}× it."
        expect_announced(page, copy)
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), copy) == 1


def test_valuation_records(app_url: str) -> None:
    adm = admin(app_url)
    day = server_day(adm)
    firm = f"Firm {uuid.uuid4().hex[:6]}"
    body = {"effective_on": day.isoformat(), "expires_on": (day + timedelta(days=365)).isoformat(), "fmv_per_share": f"{current_fmv(adm):.4f}", "firm": firm}
    refused(new_person(app_url)[1].post("/api/valuations", json=body), 403, "forbidden")
    assert invalid(adm.post("/api/valuations", json={**body, "effective_on": (day + timedelta(days=1)).isoformat()}))["effective_on"] == \
        "The effective date can't be after today."
    assert invalid(adm.post("/api/valuations", json={**body, "expires_on": (day - timedelta(days=1)).isoformat()}))["expires_on"] == \
        "The expiry date can't be before the effective date."
    assert invalid(adm.post("/api/valuations", json={**body, "fmv_per_share": "0"}))["fmv_per_share"] == "Enter a value above $0.0000 with up to four decimals."
    assert "fmv_per_share" in invalid(adm.post("/api/valuations", json={**body, "fmv_per_share": 1.5}))
    r = adm.post("/api/valuations", json=body)
    assert r.status_code == 201 and r.json()["status"] == "current" and r.json()["firm"] == firm
    data = adm.get("/api/valuations").json()
    assert data["current_id"] == r.json()["id"]
    statuses = {v["id"]: v["status"] for v in data["valuations"]}
    assert statuses["VAL-01"] == "superseded" and list(statuses.values()).count("current") == 1


def test_wf_valuations_record(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    day = server_day(adm)
    firm = f"UI Firm {uuid.uuid4().hex[:6]}"
    fmv = f"{current_fmv(adm):.4f}"
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/admin/valuations")
        form = page.get_by_role("form", name="Record valuation")
        fill(form.get_by_role("textbox", name="Effective date"), day.isoformat())
        fill(form.get_by_role("textbox", name="Expiry date"), (day + timedelta(days=365)).isoformat())
        fill(form.get_by_role("textbox", name="Fair market value per share"), fmv)
        fill(form.get_by_role("textbox", name="Valuation firm"), firm)
        watch_announcements(page)
        form.get_by_role("button", name="Record valuation").click()
        expect_announced(page, f"Valuation recorded: fair market value {fmt_price(fmv)} from {fmt_date(day.isoformat())}.")
        row = page.get_by_role("table", name="Valuations").get_by_role("row").filter(has_text=firm)
        expect(row).to_contain_text("Current", timeout=PAGE_MS)
    assert adm.get("/api/valuations").json()["current_id"] == next(v["id"] for v in adm.get("/api/valuations").json()["valuations"] if v["firm"] == firm)


def test_wf_valuations_lapse(browser: Browser) -> None:
    base = outage_url("APP_PROVIDER_DOWN_URL")
    adm = admin(base)
    day = server_day(adm)
    person, _ = new_person(base)
    draft = draft_grant(base, person["id"])
    approved = draft_grant(base, person["id"])
    queue_grant(base, approved["id"])
    approve(base, approved["id"])
    stale = (day - timedelta(days=1)).isoformat()
    lapsed = {"effective_on": stale, "expires_on": stale, "fmv_per_share": f"{current_fmv(adm):.4f}", "firm": "Lapse Probe"}
    try:
        r = adm.post("/api/valuations", json=lapsed)
        assert r.status_code == 201 and r.json()["status"] == "lapsed"
        assert adm.get("/api/valuations").json()["current_id"] == r.json()["id"]
        refused(adm.post("/api/grants", json={"holder_id": person["id"]}), 409, "valuation_lapsed")
        refused(adm.post(f"/api/grants/{draft['id']}/submit", json={}), 409, "valuation_lapsed")
        refused(adm.post(f"/api/grants/{approved['id']}/offer", json={}), 409, "valuation_lapsed")
        with browse(browser, base) as page:
            signed_in(page, base, adm, "/admin/grants")
            watch_announcements(page)
            copy = f"The current valuation lapsed on {fmt_date(stale)}. Record a new valuation before issuing grants."
            new_grant = page.get_by_role("button", name="New grant", exact=True)
            eventually(page, lambda: _assert_either(is_shown(page, copy) or new_grant.is_enabled()), "the lapsed band, or New grant ready to be refused")
            if not is_shown(page, copy):
                new_grant.click()
                expect_shown(page, copy)
                expect_announced(page, copy)
            else:
                expect_shown(page, copy)
    finally:
        adm.post("/api/valuations", json={**lapsed, "expires_on": (day + timedelta(days=365)).isoformat()})
    assert draft_grant(base, person["id"])["state"] == "draft"
    assert adm.post(f"/api/grants/{approved['id']}/offer", json={}).status_code == 200


@pytest.mark.timeout(300)
def test_wf_valuations_live_lapse(browser: Browser) -> None:
    base = outage_url("APP_PROVIDER_DOWN_URL")
    adm = admin(base)
    day = server_day(adm)
    fmv = f"{current_fmv(adm):.4f}"
    stale = (day - timedelta(days=1)).isoformat()
    lapsed = {"effective_on": stale, "expires_on": stale, "fmv_per_share": fmv, "firm": "Lapse Probe"}
    with browse(browser, base) as page:
        try:
            signed_in(page, base, adm, "/admin/grants")
            page.get_by_role("button", name="New grant").click()
            form = page.get_by_role("form", name="Issue grant")
            submit = form.get_by_role("button", name="Submit to board")
            expect(submit).to_be_enabled(timeout=PAGE_MS)
            watch_announcements(page)
            r = admin(base).post("/api/valuations", json=lapsed)
            assert r.status_code == 201 and r.json()["status"] == "lapsed", r.text
            copy = f"The current valuation lapsed on {fmt_date(stale)}. Record a new valuation before issuing grants."
            eventually(page, lambda: expect(submit).to_be_disabled(timeout=EXPECT_STEP_MS), "Submit disabled without a reload", LIVE_WAIT_S)
            expect_shown(page, copy)
            expect_announced(page, copy)
            advance(page, DRAFT_SAVE_MS)
            assert times_once(announced(page), copy) == 1
        finally:
            fresh = admin(base).post("/api/valuations", json={**lapsed, "expires_on": (day + timedelta(days=365)).isoformat()})
        assert fresh.status_code == 201, fresh.text
        eventually(page, lambda: expect(submit).to_be_enabled(timeout=EXPECT_STEP_MS), "Submit enabled again without a reload", LIVE_WAIT_S)


@pytest.mark.timeout(300)
def test_wf_valuations_filter_address(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/admin/valuations")
        group = page.get_by_role("radiogroup", name="Show valuations")
        expect(group.get_by_role("radio", name="All", exact=True)).to_be_checked(timeout=PAGE_MS)
        group.get_by_role("radio", name="All", exact=True).focus()
        for name, status in (("Current", "current"), ("Superseded", "superseded")):
            page.keyboard.press("ArrowRight")
            expect(group.get_by_role("radio", name=name, exact=True)).to_be_checked()
            n = sum(v["status"] == status for v in adm.get("/api/valuations").json()["valuations"])
            eventually(page, lambda n=n: _assert_rows(page, n), f"only {name} rows")
            assert dict(x.split("=", 1) for x in urlparse(page.url).query.split("&") if "=" in x).get("status") == status, page.url
        n = sum(v["status"] == "superseded" for v in adm.get("/api/valuations").json()["valuations"])

        def same(p: Page) -> None:
            expect(p.get_by_role("radiogroup", name="Show valuations").get_by_role("radio", name="Superseded", exact=True)).to_be_checked(timeout=PAGE_MS)
            eventually(p, lambda: _assert_rows(p, n), "the filter after a reload, Back or a second tab")

        page.reload()
        same(page)
        page.get_by_role("navigation", name="Register").get_by_role("link", name="Ledger").click()
        expect(page.get_by_role("table", name="Securities ledger")).to_be_visible(timeout=PAGE_MS)
        page.go_back()
        same(page)
        second = page.context.new_page()
        second.goto(page.url)
        same(second)
        second.close()


def test_wf_valuations_record_focus(browser: Browser) -> None:
    base = outage_url("APP_PROVIDER_DOWN_URL")
    adm = admin(base)
    day = server_day(adm)
    firm = f"Focus Probe {uuid.uuid4().hex[:6]}"
    with browse(browser, base) as page:
        signed_in(page, base, adm, "/admin/valuations")
        form = page.get_by_role("form", name="Record valuation")
        expect(form).to_be_visible(timeout=PAGE_MS)
        effective = current_effective(adm)
        type_into(page, form.get_by_role("textbox", name="Effective date"), effective.isoformat())
        type_into(page, form.get_by_role("textbox", name="Expiry date"), (effective - timedelta(days=1)).isoformat())
        type_into(page, form.get_by_role("textbox", name="Fair market value per share"), f"{current_fmv(adm):.4f}")
        type_into(page, form.get_by_role("textbox", name="Valuation firm"), firm)
        form.get_by_role("button", name="Record valuation", exact=True).click()
        eventually(page, lambda: expect(form.get_by_role("textbox", name="Expiry date")).to_be_focused(timeout=EXPECT_STEP_MS),
                   "focus on the first field in error")
        type_into(page, form.get_by_role("textbox", name="Expiry date"), (day + timedelta(days=365)).isoformat())
        form.get_by_role("button", name="Record valuation", exact=True).click()
        eventually(page, lambda: _assert_focus_row(page, firm, fmt_date(effective.isoformat())), "focus on the new row's Effective date cell", LIVE_WAIT_S)


def _assert_focus_row(page: Page, firm: str, effective: str) -> None:
    row = page.evaluate("() => { const r = document.activeElement && document.activeElement.closest('tr, [role=row]'); return r ? r.textContent : ''; }")
    assert firm in row and focused_text(page) == effective, f"focus is in row {row!r} on {focused_text(page)!r}"


def test_own_slice_visibility(app_url: str) -> None:
    a, ac, ag = holder_with_grant(app_url)
    b, bc, bg = holder_with_grant(app_url)
    assert exercise(ac, ag["id"], 10).status_code == 201
    adm = admin(app_url)
    for person, c, grant in ((a, ac, ag), (b, bc, bg)):
        assert [g["id"] for g in c.get("/api/grants").json()["grants"]] == [grant["id"]]
        assert all(o["holder_id"] == person["id"] for o in orders_of(c))
        assert all(d["owner_id"] == person["id"] for d in c.get("/api/documents").json()["documents"])
        assert all(e["holder_id"] == person["id"] for e in ledger(c))
        assert {r["key"] for r in cap_table(c)["rows"]} <= {person["id"], "others"}
        for path in ("/api/people", "/api/pool", "/api/tenders", "/api/valuations"):
            refused(c.get(path), 403, "forbidden")
    ids = {g["id"] for g in adm.get("/api/grants").json()["grants"]}
    assert {ag["id"], bg["id"]} <= ids
    _, inv = investor_with_shares(app_url, 100)
    for path in ("/api/grants", "/api/exercises"):
        refused(inv.get(path), 403, "forbidden")
    assert inv.get("/api/tenders").status_code == 200
    pc = shared(app_url, PRIYA)
    for path in ("/api/grants", "/api/exercises", "/api/ledger", "/api/documents"):
        refused(pc.get(path), 403, "forbidden")
    assert pc.get("/api/board/queue").status_code == 200


def test_other_holders_records_not_found(app_url: str) -> None:
    a, ac, ag = holder_with_grant(app_url)
    b, bc = new_person(app_url)
    oid = wait_order(ac, exercise(ac, ag["id"], 10).json()["id"], ("issued",))["id"]
    gid, doc = ag["id"], ag["agreement"]["document_id"]
    probes = [("GET", f"/api/grants/{gid}", None), ("POST", f"/api/grants/{gid}/accept", {}), ("POST", f"/api/grants/{gid}/decline", {}),
              ("POST", f"/api/grants/{gid}/exercise-quote", {"options": 1}), ("GET", f"/api/exercises/{oid}", None),
              ("POST", f"/api/exercises/{oid}/retry", {}), ("POST", f"/api/exercises/{oid}/cancel", {}),
              ("GET", f"/api/documents/{doc}", None), ("GET", f"/api/documents/{doc}/content", None)]
    for who in (bc, new_person(app_url, role="investor", prefix="investor")[1], shared(app_url, PRIYA)):
        for method, path, payload in probes:
            r = who.request(method, path, json=payload)
            refused(r, 404, "not_found")
            assert a["name"] not in r.text
    refused(bc.post(f"/api/grants/{gid}/exercises", json={"options": 1}, headers={"Idempotency-Key": new_key()}), 404, "not_found")
    refused(bc.get("/api/grants/TC-OPT-9999"), 404, "not_found")


def test_wf_access_not_found_pages(browser: Browser, app_url: str) -> None:
    a, ac, ag = holder_with_grant(app_url)
    oid = wait_order(ac, exercise(ac, ag["id"], 10).json()["id"], ("issued",))["id"]
    b, bc = new_person(app_url)
    with browse(browser, app_url) as page:
        page.goto(f"{app_url}/grants/{ag['id']}")
        expect(page.get_by_role("heading", level=1, name="Your shares, on the record.")).to_be_visible(timeout=PAGE_MS)
        for path in (f"/grants/{ag['id']}", f"/exercises/{oid}", f"/documents/{ag['agreement']['document_id']}"):
            signed_in(page, app_url, bc, path)
            expect(page.get_by_role("heading", level=1, name="Not on your register")).to_be_visible(timeout=PAGE_MS)
            expect_shown(page, "This record isn't on your register.")
            expect_not_shown(page, a["name"])


@pytest.mark.timeout(300)
def test_wf_access_role_change(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    me = adm.get("/api/me").json()["person"]
    refused(adm.patch(f"/api/people/{me['id']}", json={"role": "investor"}), 409, "own_role")
    person, bc = new_person(app_url, role="board_member", prefix="board")
    try:
        with browse(browser, app_url) as page:
            signed_in(page, app_url, bc, "/")
            board = page.get_by_role("region", name="Portal board")
            expect(board).to_contain_text("Grants awaiting your vote:", timeout=PAGE_MS)
            watch_announcements(page)
            r = adm.patch(f"/api/people/{person['id']}", json={"role": "option_holder"})
            assert r.status_code == 200 and r.json()["person"]["role"] == "option_holder"
            refused(bc.get("/api/board/queue"), 403, "forbidden")
            eventually(page, lambda: _assert_role_nav(page, "option_holder"), "the option-holder portal", LIVE_WAIT_S)
            expect_announced(page, "Your role is now Option holder.")
            advance(page, DRAFT_SAVE_MS)
            assert times_once(announced(page), "Your role is now Option holder.") == 1
    finally:
        adm.patch(f"/api/people/{person['id']}", json={"role": "option_holder"})


@pytest.mark.timeout(300)
def test_wf_access_removal(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    person, hc, grant = holder_with_grant(app_url)
    doc = grant["agreement"]["document_id"]
    me = adm.get("/api/me").json()["person"]
    refused(adm.post(f"/api/people/{me['id']}/remove-access", json={}), 409, "own_role")
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/documents/{doc}")
        dialog = page.get_by_role("dialog", name="Document viewer")
        expect(dialog).to_be_visible(timeout=PAGE_MS)
        r = adm.post(f"/api/people/{person['id']}/remove-access", json={})
        assert r.status_code == 200 and r.json()["person"]["access"] == "removed"
        eventually(page, lambda: expect(dialog).to_have_count(0, timeout=EXPECT_STEP_MS), "the viewer to close", LIVE_WAIT_S)
        expect_shown(page, "Your access to the Tidecraft register has ended.")
    refused(hc.get(f"/api/documents/{doc}/content"), 401, "unauthenticated")
    refused(hc.get("/api/me"), 401, "unauthenticated")
    refused(client(app_url).post("/api/session", json={"email": person["email"], "password": PASSWORD}), 401, "access_removed")
    refused(adm.post(f"/api/people/{person['id']}/remove-access", json={}), 409, "access_already_removed")
    assert adm.get(f"/api/documents/{doc}/content").status_code == 200


def test_wf_access_document_viewer(browser: Browser, app_url: str) -> None:
    person, hc, grant = holder_with_grant(app_url)
    doc = hc.get(f"/api/documents/{grant['agreement']['document_id']}").json()
    data = poll_key(doc["vault_key"])
    r = hc.get(f"/api/documents/{doc['id']}/content")
    assert r.status_code == 200 and r.content == data
    assert r.headers["content-type"].lower() == "text/plain; charset=utf-8"
    digest = hashlib.sha256(data).hexdigest()
    assert r.headers["x-document-sha256"] == digest == doc["sha256"]
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, "/documents")
        link = page.get_by_role("list", name="Documents").get_by_role("link", name=doc["title"])
        expect(link).to_be_visible(timeout=PAGE_MS)
        link.click()
        viewer = page.get_by_role("dialog", name="Document viewer")
        expect(viewer.get_by_role("heading", name=doc["title"])).to_be_visible(timeout=PAGE_MS)
        expect(viewer).to_contain_text(f"Grant: {grant['id']}")
        expect(viewer).to_contain_text(f"Seal {digest[:12]}")


@pytest.mark.timeout(300)
def test_wf_access_role_focus(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    person, ic = new_person(app_url, role="investor", prefix="investor")
    with browse(browser, app_url) as page:
        signed_in(page, app_url, ic, "/cap-table")
        expect(page.get_by_role("grid", name="Cap table")).to_be_visible(timeout=PAGE_MS)
        page.get_by_role("navigation", name="Register").get_by_role("link", name="Cap table").focus()
        r = adm.patch(f"/api/people/{person['id']}", json={"role": "option_holder"})
        assert r.status_code == 200, r.text
        board = page.get_by_role("region", name="Portal board")
        eventually(page, lambda: _assert_role_nav(page, "option_holder"), "the option-holder portal", LIVE_WAIT_S)
        heading = page.get_by_role("heading", level=1, name=person["first_name"])
        eventually(page, lambda: expect(heading).to_be_focused(timeout=EXPECT_STEP_MS), "focus on the name heading")


def test_document_corrections(app_url: str) -> None:
    adm = admin(app_url)
    person, hc, grant = holder_with_grant(app_url)
    doc = adm.get(f"/api/documents/{grant['agreement']['document_id']}").json()
    original = adm.get(f"/api/documents/{doc['id']}/content")
    assert original.status_code == 200 and doc["version"] == 1 and doc["supersedes"] is None and doc["superseded_by"] is None
    text = original.text.replace(f"Holder: {person['name']}", f"Holder: {person['name']} (corrected)")
    refused(hc.post(f"/api/documents/{doc['id']}/corrections", json={"text": text}), 403, "forbidden")
    invalid(adm.post(f"/api/documents/{doc['id']}/corrections", json={"text": ""}))
    r = adm.post(f"/api/documents/{doc['id']}/corrections", json={"text": text})
    assert r.status_code == 201, r.text
    fix = r.json()
    assert fix["version"] == 2 and fix["supersedes"] == doc["id"] and fix["status"] == "sealed" and fix["kind"] == doc["kind"]
    assert fix["owner_id"] == doc["owner_id"] and fix["vault_key"] == f"{doc['vault_key'].removesuffix('.txt')}.v{fix['version']}.txt"
    assert poll_key(fix["vault_key"]) == text.encode()
    assert hc.get(f"/api/documents/{fix['id']}/content").content == text.encode()
    again = adm.get(f"/api/documents/{doc['id']}").json()
    assert again["superseded_by"] == fix["id"] and again["sha256"] == doc["sha256"] and again["vault_key"] == doc["vault_key"]
    assert adm.get(f"/api/documents/{doc['id']}/content").content == original.content == S3().get(doc["vault_key"])
    refused(adm.post(f"/api/documents/{doc['id']}/corrections", json={"text": text}), 409, "document_superseded")


@pytest.mark.timeout(300)
def test_wf_access_role_replay(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    person, hc = new_person(app_url)
    with browse(browser, app_url) as page:
        routes, hold = live_socket(page)
        signed_in(page, app_url, hc, "/cap-table")
        expect(page.get_by_role("grid", name="Cap table")).to_be_visible(timeout=PAGE_MS)
        eventually(page, lambda: _assert_count(routes, 1), "the page opens its socket")
        watch_announcements(page)
        drop_socket(routes, hold)
        assert adm.patch(f"/api/people/{person['id']}", json={"role": "investor"}).status_code == 200
        hold["on"] = False
        await_reconnect(page, routes, 2)
        eventually(page, lambda: _assert_role_nav(page, "investor"), "the investor portal", LIVE_WAIT_S)
        copy = "Your role is now Investor."
        expect_announced(page, copy)
        eventually(page, lambda: expect(page.get_by_role("heading", level=1, name=person["first_name"])).to_be_focused(timeout=EXPECT_STEP_MS), "focus on the name heading")
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), copy) == 1


@pytest.mark.timeout(300)
def test_wf_access_removal_exercise_dialog(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    person, hc, grant = holder_with_grant(app_url)
    gid = grant["id"]
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/grants/{gid}")
        opener = page.get_by_role("button", name="Exercise", exact=True)
        expect(opener).to_be_enabled(timeout=PAGE_MS)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Exercise options")
        type_into(page, dialog.get_by_role("textbox", name="Options to exercise"), "5")
        assert adm.post(f"/api/people/{person['id']}/remove-access", json={}).status_code == 200
        eventually(page, lambda: expect(dialog).to_have_count(0, timeout=EXPECT_STEP_MS), "the exercise dialog closes", LIVE_WAIT_S)
        expect_shown(page, "Your access to the Tidecraft register has ended.")
        expect(page.get_by_role("button", name="Confirm exercise", exact=True)).to_have_count(0)
    refused(exercise(hc, gid, 5), 401, "unauthenticated")
    assert [o for o in admin(app_url).get("/api/exercises").json()["orders"] if o["grant_id"] == gid] == []


@pytest.mark.timeout(300)
def test_wf_access_document_address(browser: Browser, app_url: str) -> None:
    _, hc, grant = holder_with_grant(app_url)
    doc = hc.get(f"/api/documents/{grant['agreement']['document_id']}").json()
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/documents/{doc['id']}")
        viewer = page.get_by_role("dialog", name="Document viewer")
        expect(viewer.get_by_role("heading", name=doc["title"])).to_be_visible(timeout=PAGE_MS)
        page.reload()
        expect(viewer.get_by_role("heading", name=doc["title"])).to_be_visible(timeout=PAGE_MS)
        page.keyboard.press("Escape")
        expect(viewer).to_have_count(0)
        link = page.get_by_role("list", name="Documents").get_by_role("link", name=doc["title"], exact=True)
        eventually(page, lambda: expect(link).to_be_focused(timeout=EXPECT_STEP_MS), "focus on the document's link")
        assert urlparse(page.url).path == "/documents", page.url


def test_wf_live_sync_one_socket(browser: Browser, app_url: str) -> None:
    adm = login(app_url, MARA)
    with browse(browser, app_url) as one, browse(browser, app_url) as two:
        logs: list[dict[str, list[Any]]] = []
        for page in (one, two):
            log: dict[str, list[Any]] = {"sockets": [], "sent": []}
            page.on("websocket", lambda ws, log=log: (log["sockets"].append(ws.url), ws.on("framesent", lambda f, log=log: log["sent"].append(f))))
            signed_in(page, app_url, adm, "/cap-table")
            expect(page.get_by_role("grid", name="Cap table")).to_be_visible(timeout=PAGE_MS)
            logs.append(log)
        inv, _ = investor_with_shares(app_url, 4_321)
        for page in (one, two):
            eventually(page, lambda page=page: expect(page.get_by_role("grid", name="Cap table").get_by_role("row", name=re.compile(re.escape(inv["name"]))))
                       .to_be_visible(timeout=EXPECT_STEP_MS), "every open cap table shows the new holder")
            total = page.get_by_role("grid", name="Cap table").get_by_role("row", name=re.compile("Total"))
            expect(total).to_contain_text(fmt_count(admin_total(app_url)))
        for log in logs:
            assert len(log["sockets"]) == 1 and urlparse(log["sockets"][0]).path == "/api/live", log["sockets"]
            assert log["sent"] == [], "the page must send nothing over its socket"


@pytest.mark.timeout(300)
def test_wf_live_sync_replay(browser: Browser, app_url: str) -> None:
    inv, ic = new_person(app_url, role="investor", prefix="investor")
    adm = login(app_url, MARA)
    with browse(browser, app_url) as page:
        routes: list[Any] = []

        hold = {"on": False}

        def handler(ws: Any) -> None:
            if hold["on"]:
                refuse_socket(ws)
                return
            routes.append((ws, ws.connect_to_server()))

        page.route_web_socket(re.compile(r"/api/live"), handler)
        signed_in(page, app_url, ic, "/")
        expect(page.get_by_role("region", name="Portal board")).to_contain_text("Your fully diluted ownership:", timeout=PAGE_MS)
        eventually(page, lambda: _assert_count(routes, 1), "the page opens its socket")
        watch_announcements(page)
        hold["on"] = True
        ws, server = routes[-1]
        ws.close()
        server.close()
        eventually(page, (lambda: _assert_shown(page, "Reconnecting to the register.")), "the reconnecting strip shows")
        assert adm.patch(f"/api/people/{inv['id']}", json={"role": "option_holder"}).status_code == 200
        hold["on"] = False
        await_reconnect(page, routes, 2)
        assert "since=" in routes[1][0].url, routes[1][0].url
        eventually(page, lambda: _assert_role_nav(page, "option_holder"), "the replayed role change switches the portal", LIVE_WAIT_S)
        copy = "Your role is now Option holder."
        expect_announced(page, copy)
        ws, server = routes[-1]
        ws.close()
        server.close()
        await_reconnect(page, routes, 3)
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), copy) == 1, "a replayed event must be applied and announced once"


def _assert_either(held: bool) -> None:
    assert held, "neither state reached yet"


def _assert_count(items: list[Any], n: int) -> None:
    assert len(items) >= n, f"{len(items)} socket connections, expected {n}"


@pytest.mark.timeout(300)
def test_wf_live_sync_announcements(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url) as page:
        page.goto(app_url + "/")
        expect(status(page)).to_have_count(1, timeout=QUICK_MS)
    inv, ic = investor_with_shares(app_url, 100)
    tender = open_tender(app_url, cap=1_000, price="1.0000", close_in_s=ANNOUNCE_CLOSE_S)
    tid = tender["id"]
    with browse(browser, app_url) as page:
        page.clock.set_system_time(parse_instant(tender["closes_at"]) + timedelta(days=2))
        signed_in(page, app_url, ic, f"/tenders/{tid}")
        watch_announcements(page)
        timer = page.get_by_role("timer", name="Tender closes in")
        expect(timer).to_have_text(re.compile(r"^\s*0d 00:00:\d\d\s*$"), timeout=PAGE_MS)
        wait_tender(ic, tid, "allocated", 90)
        copy = f"Tender {tid} has closed."
        expect_announced(page, copy)
        expect(timer).to_have_text(re.compile("Closed"))
        advance(page, DRAFT_SAVE_MS)
        assert times_once(announced(page), copy) == 1


def test_wf_live_sync_grant_draft(browser: Browser, app_url: str) -> None:
    person, _ = new_person(app_url)
    adm = login(app_url, MARA)
    with browse(browser, app_url) as page:
        signed_in(page, app_url, adm, "/admin/grants")
        page.get_by_role("button", name="New grant").click()
        form = page.get_by_role("form", name="Issue grant")
        select(form.get_by_role("combobox", name="Holder"), person["name"])
        form.get_by_role("textbox", name="Options").focus()
        page.keyboard.type(str(DRAFT_OPTIONS))
        advance(page, DRAFT_SAVE_MS)
        draft = poll(lambda: [g for g in adm.get("/api/grants").json()["grants"] if g["holder_id"] == person["id"]],
                     lambda gs: bool(gs) and gs[0]["options"] == DRAFT_OPTIONS, LIVE_WAIT_S, "the draft's options saved on the server")
        gid = draft[0]["id"]
        page.goto(f"{app_url}/admin/grants/{gid}")
        options_box = page.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Options")
        expect(options_box).to_have_value(str(DRAFT_OPTIONS), timeout=PAGE_MS)
        page.reload()
        expect(options_box).to_have_value(str(DRAFT_OPTIONS), timeout=PAGE_MS)
        page.get_by_role("navigation", name="Register").get_by_role("link", name="Ledger").click()
        expect(page.get_by_role("table", name="Securities ledger")).to_be_visible(timeout=PAGE_MS)
        page.go_back()
        expect(options_box).to_have_value(str(DRAFT_OPTIONS), timeout=PAGE_MS)
        second = page.context.new_page()
        second.goto(f"{app_url}/admin/grants/{gid}")
        expect(second.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Options")).to_have_value(str(DRAFT_OPTIONS), timeout=PAGE_MS)
        second.close()


@pytest.mark.timeout(300)
def test_tender_draft_survives(browser: Browser, app_url: str) -> None:
    inv, ic = investor_with_shares(app_url, 1_000)
    tender = open_tender(app_url, cap=10_000, price="1.0000", close_in_s=60)
    tid = tender["id"]
    with browse(browser, app_url) as page:
        signed_in(page, app_url, ic, f"/tenders/{tid}")
        box = page.get_by_role("textbox", name="Shares to tender")
        box.focus()
        page.keyboard.type("777")
        advance(page, DRAFT_SAVE_MS)
        poll(lambda: ic.get(f"/api/tenders/{tid}").json()["mine"]["draft_shares"], lambda v: v == "777", LIVE_WAIT_S, "the tender draft is saved on the server")
        page.reload()
        expect(page.get_by_role("textbox", name="Shares to tender")).to_have_value("777", timeout=PAGE_MS)
        second = page.context.new_page()
        second.goto(f"{app_url}/tenders/{tid}")
        expect(second.get_by_role("textbox", name="Shares to tender")).to_have_value("777", timeout=PAGE_MS)
        second.close()


ROLE_LINK = {"option_holder": "Exercise", "investor": "Tender", "board_member": "Board queue"}


def _assert_role_nav(page: Page, role: str) -> None:
    nav = page.get_by_role("navigation", name="Register")
    assert nav.get_by_role("link", name=ROLE_LINK[role], exact=True).count() == 1, f"the {role} navigation is not shown"


def refuse_socket(ws: Any) -> None:
    ws.connect_to_server().close()


def gated(page: Page) -> tuple[list[Any], dict[str, bool]]:
    routes: list[Any] = []
    hold = {"on": True}

    def handler(ws: Any) -> None:
        if hold["on"]:
            refuse_socket(ws)
            return
        routes.append((ws, ws.connect_to_server()))

    page.route_web_socket(re.compile(r"/api/live"), handler)
    return routes, hold


def _check_gate(page: Page, routes: list[Any], hold: dict[str, bool], button: Locator) -> None:
    eventually(page, (lambda: expect(button).to_be_disabled(timeout=EXPECT_STEP_MS)), "disabled before the socket first opens")
    advance(page, DRAFT_SAVE_MS)
    expect(button).to_be_disabled()
    expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_enabled()
    hold["on"] = False
    await_reconnect(page, routes, 1)
    eventually(page, lambda: expect(button).to_be_enabled(timeout=EXPECT_STEP_MS), "enabled once the socket is open", seconds=PAGE_MS / 1000)
    hold["on"] = True
    ws, server = routes[-1]
    ws.close()
    server.close()
    eventually(page, (lambda: _assert_shown(page, "Reconnecting to the register.")), "the reconnecting strip")
    eventually(page, (lambda: expect(button).to_be_disabled(timeout=EXPECT_STEP_MS)), "disabled while the socket is down")
    advance(page, DRAFT_SAVE_MS)
    expect(button).to_be_disabled()
    hold["on"] = False
    await_reconnect(page, routes, 2)
    eventually(page, lambda: expect(button).to_be_enabled(timeout=EXPECT_STEP_MS), "enabled again once the socket is open", seconds=PAGE_MS / 1000)


@pytest.mark.timeout(300)
def test_wf_live_sync_socket_gate(browser: Browser, app_url: str) -> None:
    _, hc, grant = holder_with_grant(app_url)
    with browse(browser, app_url) as page:
        routes, hold = gated(page)
        signed_in(page, app_url, hc, f"/grants/{grant['id']}")
        _check_gate(page, routes, hold, page.get_by_role("button", name="Exercise", exact=True))
    with browse(browser, app_url) as page:
        routes, hold = gated(page)
        signed_in(page, app_url, admin(app_url), "/cap-table")
        _check_gate(page, routes, hold, page.get_by_role("button", name="Resize pool", exact=True))

def test_wf_live_sync_two_tabs(browser: Browser, app_url: str) -> None:
    person, _ = new_person(app_url)
    adm = login(app_url, MARA)
    draft = draft_grant(app_url, person["id"])
    gid, version = draft["id"], draft["draft_version"]
    with browse(browser, app_url) as one, browse(browser, app_url) as two:
        for page in (one, two):
            signed_in(page, app_url, adm, f"/admin/grants/{gid}")
            expect(page.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Options")).to_have_value(str(DEFAULT_OPTIONS), timeout=PAGE_MS)
        type_into(one, one.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Options"), str(DRAFT_OPTIONS + 1))
        advance(one, DRAFT_SAVE_MS)
        saved = poll(lambda: adm.get(f"/api/grants/{gid}").json(), lambda g: g["options"] == DRAFT_OPTIONS + 1, LIVE_WAIT_S, "the change saved")
        assert saved["draft_version"] > version
        other = two.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Options")
        eventually(two, lambda: expect(other).to_have_value(str(DRAFT_OPTIONS + 1), timeout=EXPECT_STEP_MS), "the other tab shows the saved change", LIVE_WAIT_S)
    stale = refused(adm.patch(f"/api/grants/{gid}", json={"options": DRAFT_OPTIONS, "draft_version": version}), 409, "draft_outdated")
    assert stale["grant"]["options"] == DRAFT_OPTIONS + 1 and stale["grant"]["draft_version"] == saved["draft_version"]
    ok = adm.patch(f"/api/grants/{gid}", json={"options": DRAFT_OPTIONS, "draft_version": saved["draft_version"]})
    assert ok.status_code == 200 and ok.json()["draft_version"] == saved["draft_version"] + 1


def test_wf_live_sync_outdated_notice(browser: Browser, app_url: str) -> None:
    person, _ = new_person(app_url)
    adm = login(app_url, MARA)
    gid = draft_grant(app_url, person["id"])["id"]
    with browse(browser, app_url) as one, browse(browser, app_url) as two:
        for page in (one, two):
            signed_in(page, app_url, adm, f"/admin/grants/{gid}")
            expect(page.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Options")).to_have_value(str(DEFAULT_OPTIONS), timeout=PAGE_MS)
        strike = two.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Strike price")
        strike.focus()
        type_into(one, one.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Options"), str(DRAFT_OPTIONS + 3))
        advance(one, DRAFT_SAVE_MS)
        poll(lambda: adm.get(f"/api/grants/{gid}").json()["options"], lambda o: o == DRAFT_OPTIONS + 3, LIVE_WAIT_S, "tab A's save")
        eventually(two, lambda: expect(two.get_by_role("form", name="Issue grant").get_by_role("textbox", name="Options")).to_have_value(
            str(DRAFT_OPTIONS + 3), timeout=EXPECT_STEP_MS), "tab B shows tab A's save", LIVE_WAIT_S)
        strike.focus()
        two.keyboard.press("End")
        two.keyboard.type("1")
        advance(two, DRAFT_SAVE_MS)
        notice = two.get_by_role("region", name="Draft changed")
        eventually(two, lambda: expect(notice).to_contain_text("This draft changed in another tab. The latest version is shown.", timeout=EXPECT_STEP_MS),
                   "the outdated notice", LIVE_WAIT_S)
        expect(notice.get_by_role("button", name="Keep editing", exact=True)).to_be_focused()
        two.keyboard.press("Escape")
        expect(notice).to_have_count(0)
        expect(strike).to_be_focused()
        expect(strike).to_have_value(adm.get(f"/api/grants/{gid}").json()["strike"])


@pytest.mark.timeout(600)
def test_wf_cross_cutting_health(app_url: str) -> None:
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["content-type"].startswith("application/json")
    with app_copy({}) as base:
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert httpx.get(base + "/", timeout=HTTP_TIMEOUT_S).status_code == 200


def ws_upgrade(base: str, origin: str, cookie: str) -> int:
    u = urlparse(base)
    with socket.create_connection((u.hostname, u.port or 80), timeout=HTTP_TIMEOUT_S) as s:
        request = (f"GET /api/live HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                   f"Sec-WebSocket-Key: {WS_KEY}\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n"
                   + (f"Cookie: {cookie}\r\n" if cookie else "") + "\r\n")
        s.sendall(request.encode())
        line = s.recv(1024).decode(errors="replace").split("\r\n")[0]
    return int(line.split(" ")[1])


BOUNDARY_CASES = ["cross_origin_post", "oversized", "non_json", "bad_json", "unknown_api", "source_files", "ws_origin", "cookie_flags"]


@pytest.mark.parametrize("case", BOUNDARY_CASES, ids=BOUNDARY_CASES)
def test_server_boundary(app_url: str, case: str) -> None:
    own = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    good = {"email": JUNIPER, "password": PASSWORD}
    c = client(app_url)
    if case == "cross_origin_post":
        refused(c.post("/api/session", json=good, headers={"Origin": FOREIGN_ORIGIN}), 403, "forbidden")
        assert c.post("/api/session", json=good, headers={"Origin": own}).status_code == 200
        assert c.get("/api/health").status_code == 200
    elif case == "oversized":
        def body(size: int) -> bytes:
            head, tailb = b'{"email":"', b'","password":"x"}'
            return head + b"a" * (size - len(head) - len(tailb)) + tailb
        refused(c.post("/api/session", content=body(BODY_LIMIT + 1), headers={"Content-Type": "application/json"}), 413, "payload_too_large")
        allowed = c.post("/api/session", content=body(BODY_LIMIT), headers={"Content-Type": "application/json"})
        assert allowed.status_code != 413, "a body of exactly 65,536 bytes is allowed"
    elif case == "non_json":
        refused(c.post("/api/session", content=json.dumps(good), headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    elif case == "bad_json":
        refused(c.post("/api/session", content='{"email":', headers={"Content-Type": "application/json"}), 400, "bad_json")
    elif case == "unknown_api":
        refused(c.get("/api/no-such-endpoint"), 404, "not_found")
    elif case == "source_files":
        root = Path(DEPLOYED_APP)
        for name in ("run.json", "package.json", "package-lock.json", "tsconfig.json"):
            path = root / name
            if path.exists():
                head = path.read_text(errors="replace")[:120]
                assert head not in c.get("/" + name).text, f"/{name} served its source"
        secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "WIREMOCK_URL") if os.environ.get(k)]
        assert secrets, "the verifier environment must carry the service settings"
        page = c.get("/")
        assets = set(re.findall(r'(?:src|href)="(/[^"#?]+)', page.text))
        for text in [page.text, c.get("/.env").text] + [c.get(a).text for a in assets]:
            for value in secrets:
                assert value not in text, "a service URL or credential was served to the browser"
        for asset in assets:
            if asset.endswith(".js"):
                assert not c.get(asset + ".map").text.lstrip().startswith("{"), f"source map served for {asset}"
    elif case == "ws_origin":
        signed = login(app_url, JUNIPER)
        cookie = "; ".join(f"{k.name}={k.value}" for k in signed.cookies.jar)
        assert ws_upgrade(app_url, FOREIGN_ORIGIN, cookie) == 403
        assert ws_upgrade(app_url, own, "") == 401
        assert ws_upgrade(app_url, own, cookie) == 101
    else:
        r = c.post("/api/session", json=good)
        cookie = r.headers.get("set-cookie", "").lower()
        assert "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie, cookie


BOOT_CASES = ["provider_down", "vault_down"]


@pytest.mark.parametrize("case", BOOT_CASES, ids=BOOT_CASES)
def test_wf_cross_cutting_boot_outages(browser: Browser, case: str) -> None:
    base = outage_url("APP_PROVIDER_DOWN_URL" if case == "provider_down" else "APP_VAULT_DOWN_URL")
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
    pc = login(base, PRIYA)
    assert pc.get("/api/board/queue").status_code == 200 and pc.get("/api/cap-table").status_code == 200
    email, gid = (JUNIPER, JUNIPER_GRANT) if case == "provider_down" else (KENJI, KENJI_GRANT)
    hc = login(base, email)
    with browse(browser, base) as page:
        signed_in(page, base, hc, "/")
        expect(page.get_by_role("region", name="Portal board")).to_be_visible(timeout=PAGE_MS)
        expect_not_shown(page, re.compile("can't be reached"))
        page.goto(f"{base}/cap-table")
        expect(page.get_by_role("grid", name="Cap table")).to_be_visible(timeout=PAGE_MS)
        page.goto(f"{base}/grants/{gid}")
        expect(page.get_by_role("heading", level=1)).to_contain_text(gid, timeout=PAGE_MS)
        expect_not_shown(page, re.compile("can't be reached"))
        if case == "provider_down":
            key = new_key()
            r = exercise(hc, gid, 1, key)
            refused(r, 503, "provider_unavailable")
            oid = r.json()["order"]["id"]
            page.goto(f"{base}/exercises/{oid}")
            expect_shown(page, f"The payment provider can't be reached. Order {oid} is held under key {key}. Nothing has been issued.")
            expect(retry_button(page, "Retry payment")).to_be_visible()
            assert hc.post(f"/api/exercises/{oid}/cancel", json={}).status_code == 200
        else:
            page.get_by_role("button", name="Accept grant").click()
            expect_shown(page, f"The document vault can't be reached. Your signature is pending and grant {gid} is not yet accepted.")
            expect(retry_button(page, "Retry signing")).to_be_visible()
            assert hc.get(f"/api/grants/{gid}").json()["state"] == "offered"


@pytest.mark.parametrize("width", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layouts(browser: Browser, app_url: str, width: str) -> None:
    jc = login(app_url, JUNIPER)
    roles = ("button", "link", "textbox", "combobox", "slider", "radio", "checkbox")
    with browse(browser, app_url) as page:
        w, h = VIEWPORTS[width]
        page.set_viewport_size({"width": w, "height": h})
        page.goto(app_url + "/")
        expect(page.get_by_role("button", name="Sign in")).to_be_visible(timeout=PAGE_MS)
        pages = [None, "/", f"/grants/{JUNIPER_GRANT}", "/cap-table", "/exercise", "/documents"]
        for path in pages:
            if path is not None:
                signed_in(page, app_url, jc, path)
            layout(page)
            for role in roles:
                for control in page.get_by_role(role).all():
                    if not control.is_visible():
                        continue
                    box = control.bounding_box()
                    assert box and box["width"] >= TARGET_PX and box["height"] >= TARGET_PX, f"{role} on {path or 'sign-in'}: {box}"


DIALOG_CASES = ["exercise", "document_viewer"]


@pytest.mark.parametrize("case", DIALOG_CASES, ids=DIALOG_CASES)
def test_keyboard_dialogs(browser: Browser, app_url: str, case: str) -> None:
    with browse(browser, app_url) as page:
        if case == "exercise":
            signed_in(page, app_url, login(app_url, JUNIPER), f"/grants/{JUNIPER_GRANT}")
            opener = page.get_by_role("button", name="Exercise")
            dialog = page.get_by_role("dialog", name="Exercise options")
        else:
            person, hc, grant = holder_with_grant(app_url)
            title = hc.get(f"/api/documents/{grant['agreement']['document_id']}").json()["title"]
            signed_in(page, app_url, hc, "/documents")
            opener = page.get_by_role("list", name="Documents").get_by_role("link", name=title)
            dialog = page.get_by_role("dialog", name="Document viewer")
        expect(opener).to_be_visible(timeout=PAGE_MS)
        opener.focus()
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible(timeout=PAGE_MS)
        eventually(page, lambda: _assert_inside(dialog), "focus moves into the dialog")
        for key in ["Tab"] * TAB_PRESSES + ["Shift+Tab"] * TAB_PRESSES:
            page.keyboard.press(key)
            _assert_inside(dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0, timeout=PAGE_MS)
        expect(opener).to_be_focused()


def _assert_inside(dialog: Locator) -> None:
    assert inside(dialog), "keyboard focus left the open dialog"


def _motion_of(locator: Locator) -> list[dict[str, Any]]:
    return locator.evaluate(MOTION_OF_JS)


STATE_JS = """(root) => [root].concat(Array.from(root.querySelectorAll('*')).slice(0, 400)).map((e) => {
  const s = getComputedStyle(e), b = e.getBoundingClientRect(), before = getComputedStyle(e, '::before'), after = getComputedStyle(e, '::after');
  return [s.transform, s.opacity, s.clipPath, s.backgroundColor, s.backgroundImage, s.backgroundSize, Math.round(b.top), Math.round(b.width), e.textContent.length,
          before.transform, before.opacity, before.backgroundColor, after.transform, after.opacity, after.backgroundColor].join('/');
}).join('|')"""


def sampled_states(page: Page, locator: Locator, steps: int = 16, step_ms: int = 50) -> list[str]:
    states = []
    for _ in range(steps):
        states.append(locator.evaluate(STATE_JS))
        advance(page, step_ms)
        _TICK.wait(step_ms / 1000)
    return states


def test_motion_durations(browser: Browser, app_url: str) -> None:
    jc = login(app_url, JUNIPER)
    grant = jc.get(f"/api/grants/{JUNIPER_GRANT}").json()
    schedule = {t["month"]: t for t in grant["schedule"]}
    today = latest_mark(JUNIPER_START, date.fromisoformat(grant["server_date"])) or 0
    with browse(browser, app_url) as page:
        page.add_init_script(script=f"({MOTION_JS})()")
        page.goto(app_url + "/")
        title = page.get_by_role("heading", level=1, name="Your shares, on the record.")
        states = sampled_states(page, title)
        expect(title).to_be_visible(timeout=PAGE_MS)
        moves = [m for m in _motion_of(title) if m["duration"] > 0]
        if moves:
            span = max(m["duration"] + m["delay"] for m in moves)
            assert TITLE_MIN_MS <= span <= TITLE_MAX_MS, f"title reveal took {span} ms"
            assert all(m["iterations"] not in ("infinite", "Infinity") for m in moves)
        else:
            assert len(set(states)) >= 2, "the title reveal must animate"
        assert page.evaluate(LOOPS_JS) == 0
        signed_in(page, app_url, jc, f"/grants/{JUNIPER_GRANT}")
        slider = page.get_by_role("slider", name="Projection date")
        expect(slider).to_be_visible(timeout=PAGE_MS)
        page.evaluate("() => { window.__motion = []; }")
        slider.focus()
        cells = page.get_by_role("list", name="Tranches")
        page.keyboard.press("ArrowRight")
        states = sampled_states(page, cells, steps=8)
        fills = [m for m in _motion_of(cells) if m["duration"] > 0]
        if fills:
            for m in fills:
                assert CELL_MIN_MS <= m["duration"] <= CELL_MAX_MS, f"cell fill took {m['duration']} ms"
                assert m["iterations"] not in ("infinite", "Infinity")
        else:
            assert len(set(states)) >= 2, "a ribbon cell fill must run"
        advance(page, COUNT_MAX_MS)
        eventually(page, _figures_check(page, schedule[min(MARKS, today + 1)]), "the numerals end on the server's values")
        assert page.evaluate(LOOPS_JS) == 0


def _assert_moves(locator: Locator) -> None:
    assert [m for m in _motion_of(locator) if m["duration"] > 0], "no animation recorded"


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    jc = login(app_url, JUNIPER)
    grant = jc.get(f"/api/grants/{JUNIPER_GRANT}").json()
    schedule = {t["month"]: t for t in grant["schedule"]}
    today = latest_mark(JUNIPER_START, date.fromisoformat(grant["server_date"])) or 0
    with browse(browser, app_url, reduced_motion="reduce") as page:
        page.add_init_script(script=f"({MOTION_JS})()")
        page.goto(app_url + "/")
        title = page.get_by_role("heading", level=1, name="Your shares, on the record.")
        expect(title).to_be_visible(timeout=PAGE_MS)
        assert [m for m in _motion_of(title) if m["duration"] > 1] == [], "the title must appear without the reveal"
        signed_in(page, app_url, jc, f"/grants/{JUNIPER_GRANT}")
        slider = page.get_by_role("slider", name="Projection date")
        expect(slider).to_be_visible(timeout=PAGE_MS)
        page.evaluate("() => { window.__motion = []; }")
        slider.focus()
        page.keyboard.press("End")
        expect(slider).to_have_attribute("aria-valuenow", str(MARKS))
        group = page.get_by_role("group", name="Projection figures")
        expect(group).to_contain_text(fmt_count(schedule[MARKS]["cumulative"]), timeout=QUICK_MS)
        expect(group).to_contain_text(fmt_money(schedule[MARKS]["cost_at_strike"]), timeout=QUICK_MS)
        assert [m for m in _motion_of(page.get_by_role("group", name="Tranche ribbon")) if m["duration"] > 1] == []
        page.keyboard.press("Home")
        expect(slider).to_have_attribute("aria-valuetext", f"{fmt_date(schedule[today]['date'])} (today)")


@pytest.mark.timeout(300)
def test_wf_cross_cutting_phone_grid(browser: Browser, app_url: str) -> None:
    adm = admin(app_url)
    with browse(browser, app_url) as phone:
        w, h = VIEWPORTS["375"]
        phone.set_viewport_size({"width": w, "height": h})
        signed_in(phone, app_url, adm, "/cap-table")
        enter_grid(phone)
        for key in ("End", "Home", "Control+End", "Control+Home", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "Home"):
            phone.keyboard.press(key)
            eventually(phone, lambda: _assert_focus_in_frame(phone), f"the focused cell inside the grid's frame after {key}")
        layout(phone)


@pytest.mark.timeout(300)
def test_wf_cross_cutting_dialog_redraw(browser: Browser, app_url: str) -> None:
    person, hc, grant = holder_with_grant(app_url)
    with browse(browser, app_url) as page:
        signed_in(page, app_url, hc, f"/grants/{grant['id']}")
        opener = page.get_by_role("button", name="Exercise", exact=True)
        expect(opener).to_be_enabled(timeout=PAGE_MS)
        figures = page.get_by_role("group", name="Projection figures")
        before = figures.inner_text()
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Exercise options")
        expect(dialog).to_be_visible(timeout=PAGE_MS)
        r = admin(app_url).post("/api/issuances", json={"holder_id": person["id"], "class": "Common", "shares": BIG_ISSUE})
        assert r.status_code == 201, r.text
        eventually(page, lambda: _assert_changed(figures, before), "the page redraws live while the dialog is open", LIVE_WAIT_S)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=EXPECT_STEP_MS), "focus back on Exercise")


def _walk(root: Path) -> Iterator[Path]:
    skip = {"node_modules", "dist", "build", ".git", ".next", "coverage", "out", ".output"}
    ignore = root / ".gitignore"
    if ignore.exists():
        for line in ignore.read_text().splitlines():
            name = line.strip().strip("/")
            if name and not name.startswith(("#", "!")) and not any(ch in name for ch in "*?[/"):
                skip.add(name)
    for path in root.rglob("*"):
        if not any(part in skip for part in path.relative_to(root).parts) and path.is_file():
            yield path


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"notices omit shipped packages: {missing[:20]}"
    for name in ("Funnel Display", "Funnel Sans", "Lucide", "CC0", "OFL"):
        assert name in text, f"notices omit {name}"


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad[:20]}"


def test_if_datastores() -> None:
    names = {p.name for p in shipped_packages()}
    assert not names & FORBIDDEN_STORES, names & FORBIDDEN_STORES
    files = [p for p in _walk(Path(DEPLOYED_APP)) if p.suffix in {".sqlite", ".sqlite3", ".db"}]
    assert not files, files
    assert Postgres().tables(), "the register must live in PostgreSQL"


def test_if_service_config_untouched() -> None:
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    edits: list[str] = []

    write_tools = ("Write", "Edit", "MultiEdit", "NotebookEdit")

    def targets_compose(node: Any) -> bool:
        if isinstance(node, dict):
            return any((k in ("file_path", "path", "notebook_path") and isinstance(v, str) and "compose" in v.lower())
                       or targets_compose(v) for k, v in node.items())
        if isinstance(node, list):
            return any(targets_compose(item) for item in node)
        return False

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            tool = next((v for k, v in node.items() if k in ("name", "tool_name", "function_name") and isinstance(v, str)), "")
            if tool in write_tools and targets_compose(node):
                edits.append(tool)
            for key, value in node.items():
                if key == "command" and isinstance(value, str) and re.search(r"(sed\s+-i[^|;&]*compose\S*\.ya?ml|>>?\s*\S*compose\S*\.ya?ml|tee\s+(-a\s+)?\S*compose\S*\.ya?ml)", value):
                    edits.append(value)
                else:
                    visit(value)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(json.loads(path.read_text()))
    assert not edits, f"compose definitions touched: {edits[:5]}"


def test_if_typescript_strict() -> None:
    root = Path("/app")
    configs = [p for p in _walk(root) if p.name.startswith("tsconfig") and p.suffix == ".json"]
    assert configs, "no tsconfig found"
    strict = any(re.search(r'"strict"\s*:\s*true', p.read_text()) for p in configs)
    assert strict, "no tsconfig sets strict true"
    out_dirs = [(c.parent / m.group(1)).resolve() for c in configs for m in [re.search(r'"outDir"\s*:\s*"([^"]+)"', c.read_text())] if m]
    code_roots = {p.relative_to(root).parts[0] for p in _walk(root) if p.suffix in {".ts", ".tsx"} and len(p.relative_to(root).parts) > 1
                  and not p.name.endswith(".d.ts")}
    tooling = {"scripts", "tools", "bin"}
    stray = [p for p in _walk(root) if p.suffix in {".js", ".jsx", ".mjs", ".cjs"} and "config" not in p.name
             and len(p.relative_to(root).parts) > 1 and p.relative_to(root).parts[0] in code_roots
             and not tooling.intersection(p.relative_to(root).parts)
             and not any(p.with_suffix(s).exists() for s in (".ts", ".tsx"))
             and not any(p.resolve().is_relative_to(d) for d in out_dirs)]
    assert not stray, f"JavaScript source files: {stray[:10]}"


def test_if_bundled_assets() -> None:
    files = list(_walk(Path("/app")))
    fonts = [re.sub(r"[^a-z]", "", p.name.lower()) for p in files if p.suffix.lower() in {".woff2", ".woff", ".ttf", ".otf"}]
    for face in ("Funnel Display", "Funnel Sans"):
        key = re.sub(r"[^a-z]", "", face.lower())
        assert any(key in f for f in fonts), (face, fonts)
    photos = [p for p in files if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".avif"}]
    assert len(photos) >= 4, f"expected four photographs, found {len(photos)}"
