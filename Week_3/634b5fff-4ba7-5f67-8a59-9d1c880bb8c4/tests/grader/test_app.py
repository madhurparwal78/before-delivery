from __future__ import annotations

import base64
import concurrent.futures
import contextlib
import hashlib
import hmac
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
import uuid
import zlib
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    Keycloak,
    Postgres,
    S3,
    addresses,
    advance,
    axe,
    camera,
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
    licence_allowed,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    shipped_packages,
    tap,
    text as mail_text,
    unique,
    until,
)

HTTP_TIMEOUT = 30
UI_MS = 30000
POLL_SECONDS = 30
POLL_EVERY = 0.25
BOOT_SECONDS = 90
STREAM_READ = 60
THREADS = 12
DOUBLE_SUBMITS = 4
PUMP_CHUNKS = 1000000
ACCEPTS = 1000
VALKEY_DEFAULT_PORT = 6379
SVIX_RETRY_SECONDS = 60
HOLD_TRIES = 25

expect.set_options(timeout=UI_MS)

EDITION = 240
HOLD_FULL_MS = 600000
PUSH_SECONDS = 2
TURN_SECONDS = 1
SHORT_HOLD = 8
SHORT_BAND = 2
SHORT_AUTH = 10
SHORT_TRANSFER = 6
SHORT_LOOKUP = 10
SWEEP = 5
TUNED_CHALLENGE = 4
SEARCH_SECONDS = 5
ALERT_SECONDS = 60
STALE_SECONDS = 300
LOOKUP_TRIES = 5
BURN_EARLY_MS = 11400
BURN_LATE_MS = 12600
FLARE_MS = 600
PATH_TOLERANCE = 0.05
RETRY_FIRST = (4, 9)
RETRY_SECOND = (18, 26)
MIN_TARGET = 44
BODY_LIMIT = 64000
ART_BYTES = 5000000
ART_MULTIPART = 5100000
ART_PIXELS = 6000
GIFT_MESSAGE_LIMIT = 280
PRICE_ORE = 149500
NET_ORE = 119600
VAT_ORE = 29900
COURIER_ORE = 8900
TOTAL_ORE = 158400
CHARITY_ORE = 37674
MAKER_ORE = 81926
CHARITY_33_ORE = 39468
RATE_SEED = 3150
RATE_NEW = 3300
FEE_CARD_ORE = 2080
FEE_BANK_ORE = 400
REFUND_ORE = 33333
REFUND_NET = 26666
REFUND_VAT = 6667
REFUND_CHARITY = 8400
REFUND_MAKER = 18266
REST_ORE = 116167
REST_NET = 92934
REST_VAT = 23233
REST_CHARITY = 29274
REST_MAKER = 63660
EXTRA_REFUNDS = (1, 999)
WRONG_TRANSFER_ORE = TOTAL_ORE - 1
CONCURRENT_REFUND_ORE = PRICE_ORE * 2 // 3
RANDOM_ART_SIDE = 300
IMAGE_XOBJECT = re.compile(rb"/Subtype\s*/Image")
NOSNIFF = "nosniff"
SERVER_SLACK_MS = 3000
CORS_HEADER = "access-control-allow-origin"
SOURCE_MARKER = '"scripts"'
UPLOAD_STAR = "Upload art for Star"
TRAVERSAL_STEM = "evilname"
EMPTY_MONTH = "2020-01"
FUTURE_MONTH = "2099-01"
CPH_MONTH = "2026-12"
UTC_MONTH = "2026-11"

TOTAL_LABEL = "1,584.00"
AUTHORISE = f"Authorise DKK {TOTAL_LABEL}"

CARD_PLAIN = "4242424242424242"
CARD_CHALLENGE = "4000000000003220"
CARD_CALLBACK = "4000000000007777"
CARD_CAPFAIL = "4000000000000341"
CARD_POOR = "4000000000009995"
CARD_EXPIRED = "4000000000000069"
CARD_OTHER = "4000000000001111"
LAST_FOUR_CHALLENGE = "3220"
OTP = "1234"
ACCOUNT_IBAN = "DK0000000000000000"
GATEWAY_SECRET = os.environ.get("GATEWAY_CALLBACK_SECRET", "sbx_gateway_callback_secret_01")
CHARITY_SECRET = os.environ.get("CHARITY_WEBHOOK_SECRET", "whsec_U3ZvdmxzdGlrQ2hhcml0eVNhbmRib3hLZXkwMTIz")
PASSWORDS = {"maker": "Maker-Press-2026!", "packer": "Packer-Press-2026!", "treasurer": "Treasurer-Press-2026!"}
PLATES = ["Stove", "Goose", "Tree", "Star", "Grandmother"]
CHAPTERS = ["alley", "stove", "goose", "tree", "star", "grandmother", "shelf"]
CHAPTER_EDGES = [0, 0.12, 0.30, 0.46, 0.62, 0.72, 0.86]
CHAPTER_MID = {"alley": 0.06, "stove": 0.21, "goose": 0.38, "tree": 0.54, "star": 0.67, "grandmother": 0.79, "shelf": 0.93}
STREET = "Sneglevej 4"
RECIPIENT_MESSAGE = "For the long dark, kept warm"

MOTION_MS = {
    "press": 120,
    "focus": 160,
    "shake": 240,
    "count": 320,
    "step": 420,
    "payment-state": 320,
    "receipt": 480,
    "row": 180,
    "route": 480,
}

MOTION_RECORDER = """
(() => {
  const remember = (el, duration) => {
    const host = el && el.closest ? el.closest('[data-motion]') : null;
    if (!host) return;
    const log = JSON.parse(sessionStorage.getItem('__motion') || '[]');
    log.push([host.getAttribute('data-motion'), duration]);
    sessionStorage.setItem('__motion', JSON.stringify(log));
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const animation = original.apply(this, args);
    remember(this, animation.effect.getComputedTiming().duration);
    return animation;
  };
  const onEvent = (event) => {
    for (const animation of event.target.getAnimations()) {
      remember(event.target, animation.effect.getComputedTiming().duration);
    }
  };
  document.addEventListener('transitionrun', onEvent, true);
  document.addEventListener('animationstart', onEvent, true);
})();
"""

SCENE_READ = """() => {
  const s = window.__scene;
  if (!s) return null;
  return {progress: s.progress, chapter: s.chapter, cameraPosition: s.cameraPosition && {x: s.cameraPosition.x, y: s.cameraPosition.y, z: s.cameraPosition.z},
          lightIntensity: s.lightIntensity, litMatches: s.litMatches, holdRemainingMs: s.holdRemainingMs, matchLength: s.matchLength};
}"""


@pytest.fixture(autouse=True)
def _gateway_stubs_reset(wiremock):
    yield


def inst(name: str) -> str:
    return os.environ[name].rstrip("/")


def req(base: str, method: str, path: str, *, headers: dict[str, str] | None = None, **kwargs: Any) -> httpx.Response:
    return httpx.request(method, base.rstrip("/") + path, headers=headers or {}, timeout=HTTP_TIMEOUT, **kwargs)


def poll(contract: str, probe: Callable[[], Any], seconds: float = POLL_SECONDS, every: float = POLL_EVERY) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = probe()
        if last:
            return last
        threading.Event().wait(every)
    pytest.fail(f"{contract} (not within {seconds}s; last saw {last!r})")


def refused(response: httpx.Response, status: int, code: str, copy: str | None = None) -> None:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code}: {response.text}"
    error = response.json()["error"]
    assert error["code"] == code
    if copy is not None:
        assert error["message"] == copy


def in_parallel(call: Callable[[], Any], count: int) -> list[Any]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:
        return [f.result() for f in [pool.submit(call) for _ in range(count)]]


def plate_of(number: int) -> str:
    return PLATES[(number - 1) % 5]


def dkk(ore: int) -> str:
    sign = "-" if ore < 0 else ""
    return f"{sign}DKK {abs(ore) // 100:,}.{abs(ore) % 100:02d}"


def half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def ore(amount: Any) -> int:
    return int(Decimal(str(amount)) * 100)


def new_buyer(prefix: str = "buyer") -> tuple[str, str]:
    name, email = unique(prefix)
    return name, email.lower()


def open_numbers(base: str, plate: str | None = None) -> list[int]:
    boxes = req(base, "GET", "/api/shelf").json()["boxes"]
    numbers = [b["number"] for b in boxes if b["state"] == "available" and (plate is None or b["plate"] == plate)]
    random.shuffle(numbers)
    return numbers


def take_hold(base: str, plate: str | None = None) -> SimpleNamespace:
    for number in open_numbers(base, plate)[:HOLD_TRIES]:
        response = req(base, "POST", "/api/holds", json={"number": number})
        if response.status_code == 201:
            data = response.json()
            return SimpleNamespace(number=number, token=data["holdToken"], plate=data["plate"], grant=data)
    pytest.fail("POST /api/holds granted none of the available numbers; expected a 201 for a free box")


def release(base: str, hold: SimpleNamespace) -> None:
    req(base, "DELETE", f"/api/holds/{hold.number}", headers={"X-Hold-Token": hold.token})


def gift_of(name: str, email: str) -> dict[str, str]:
    return {"recipientName": name, "recipientEmail": email, "message": RECIPIENT_MESSAGE}


def order_body(number: int, name: str, email: str, *, card: str | None = CARD_PLAIN, gift: dict | None = None) -> dict:
    body: dict[str, Any] = {
        "number": number,
        "method": "card" if card else "bank",
        "buyer": {"name": name, "email": email},
        "address": {"street": STREET, "postcode": "2100", "city": "Aalborg"},
        "gift": gift,
    }
    if card:
        body["card"] = {"number": card, "expiry": "12/29", "cvc": "123"}
    return body


def attempt(base: str, token: str, body: dict, key: str | None = None) -> httpx.Response:
    return req(base, "POST", "/api/checkout", headers={"X-Hold-Token": token, "Idempotency-Key": key or idempotency_key()}, json=body)


def place(base: str, *, card: str = CARD_PLAIN, gift: dict | None = None, plate: str | None = None, status: int = 201) -> SimpleNamespace:
    name, email = new_buyer()
    hold = take_hold(base, plate)
    response = attempt(base, hold.token, order_body(hold.number, name, email, card=card, gift=gift))
    assert response.status_code == status, f"POST /api/checkout expected {status}: {response.text}"
    data = response.json()
    return SimpleNamespace(number=hold.number, plate=hold.plate, token=hold.token, reference=data["reference"],
                           order_token=data["orderToken"], name=name, email=email, reply=data, payment=None, transfer_id=None)


def stub_authorised(wiremock, prefix: str = "pay_") -> str:
    payment = f"{prefix}{uuid.uuid4()}"
    wiremock.stub("POST", "/v1/authorisations", status=201, json={"paymentId": payment, "status": "authorised", "confirmation": "immediate"})
    return payment


def pending_order(base: str, wiremock, gift: dict | None = None) -> SimpleNamespace:
    payment = f"pay_cb_{uuid.uuid4()}"
    wiremock.stub("POST", "/v1/authorisations", status=202, json={"paymentId": payment, "status": "pending", "confirmation": "callback"})
    order = place(base, card=CARD_CALLBACK, gift=gift, status=202)
    assert order.reply["paymentState"] == "started"
    order.payment = payment
    return order


def transfer_order(base: str, wiremock) -> SimpleNamespace:
    transfer_id = f"trf_{uuid.uuid4()}"
    wiremock.stub("POST", "/v1/transfers", status=201, json={"transferId": transfer_id, "iban": ACCOUNT_IBAN, "paymentReference": transfer_id})
    name, email = new_buyer()
    hold = take_hold(base)
    response = attempt(base, hold.token, order_body(hold.number, name, email, card=None))
    assert response.status_code == 201, response.text
    data = response.json()
    return SimpleNamespace(number=hold.number, plate=hold.plate, token=hold.token, reference=data["reference"],
                           order_token=data["orderToken"], name=name, email=email, reply=data, payment=None, transfer_id=transfer_id)


def view(base: str, order: SimpleNamespace) -> dict:
    response = req(base, "GET", f"/api/orders/{order.reference}", headers={"X-Order-Token": order.order_token})
    assert response.status_code == 200, response.text
    return response.json()


def box_public_state(base: str, number: int) -> str:
    response = req(base, "GET", f"/api/boxes/{number}")
    assert response.status_code == 200, response.text
    return response.json()["state"]


def certificate(base: str, order: SimpleNamespace) -> httpx.Response:
    return req(base, "GET", f"/api/orders/{order.reference}/certificate", headers={"X-Order-Token": order.order_token})


def wait_certificate(base: str, order: SimpleNamespace) -> bytes:
    poll("order certificate.state became issued", lambda: view(base, order)["certificate"]["state"] == "issued")
    response = certificate(base, order)
    assert response.status_code == 200, response.text
    return response.content


_SESSIONS: dict[tuple[str, str], dict[str, str]] = {}


def sign_in_form(page: Page, role: str) -> None:
    page.get_by_role("textbox", name=re.compile("username", re.I)).fill(role)
    password = page.get_by_label("Password", exact=True)
    password.fill(PASSWORDS[role])
    password.press("Enter")


def staff(browser: Browser, base: str, role: str) -> dict[str, str]:
    key = (base, role)
    if key in _SESSIONS and req(base, "GET", "/api/staff/me", headers=_SESSIONS[key]).status_code == 200:
        return _SESSIONS[key]
    context = browser.new_context()
    try:
        page = context.new_page()
        page.goto(base + "/auth/login")
        sign_in_form(page, role)
        page.wait_for_url(lambda url: same_origin(url, base), timeout=UI_MS)
        cookies = "; ".join(f"{c['name']}={c['value']}" for c in context.cookies(base))
        _SESSIONS[key] = {"Cookie": cookies}
    finally:
        context.close()
    return _SESSIONS[key]


def pack(browser: Browser, base: str, reference: str) -> httpx.Response:
    return req(base, "POST", f"/api/staff/orders/{reference}/pack", headers=staff(browser, base, "packer"))


def staff_order(browser: Browser, base: str, reference: str) -> dict | None:
    orders = req(base, "GET", "/api/staff/orders", headers=staff(browser, base, "packer")).json()["orders"]
    return next((o for o in orders if o["reference"] == reference), None)


def wait_box(browser: Browser, base: str, reference: str, state: str, seconds: float = POLL_SECONDS) -> dict:
    return poll(f"GET /api/staff/orders showed {reference} as {state}",
                lambda: (lambda o: o if o and o["boxState"] == state else None)(staff_order(browser, base, reference)), seconds)


def captured(browser: Browser, base: str, **kwargs: Any) -> SimpleNamespace:
    order = place(base, **kwargs)
    response = pack(browser, base, order.reference)
    assert response.status_code == 202, response.text
    assert response.json()["packing"] == "done"
    return order


def refund(browser: Browser, base: str, reference: str, amount: int, key: str | None = None) -> httpx.Response:
    headers = dict(staff(browser, base, "treasurer"))
    headers["Idempotency-Key"] = key or idempotency_key()
    return req(base, "POST", f"/api/staff/orders/{reference}/refunds", headers=headers, json={"amountOre": amount})


def ledger(browser: Browser, base: str, reference: str) -> dict:
    response = req(base, "GET", f"/api/staff/orders/{reference}/ledger", headers=staff(browser, base, "treasurer"))
    assert response.status_code == 200, response.text
    return response.json()


def issue_statement(browser: Browser, base: str, month: str) -> dict:
    response = req(base, "POST", "/api/staff/statements", headers=staff(browser, base, "treasurer"), json={"month": month})
    assert response.status_code == 201, response.text
    return response.json()


def dead_letter(browser: Browser, base: str, reference: str, seconds: float = 60) -> dict:
    def probe() -> dict | None:
        response = req(base, "GET", "/api/staff/dead-letters", headers=staff(browser, base, "packer"))
        if response.status_code != 200:
            return None
        return next((e for e in response.json()["events"] if e["reference"] == reference), None)

    return poll(f"GET /api/staff/dead-letters listed an event for {reference}", probe, seconds)


def sign(raw: bytes, *, secret: str = GATEWAY_SECRET, at: int | None = None) -> str:
    stamp = int(time.time()) if at is None else at
    digest = hmac.new(secret.encode(), f"{stamp}.".encode() + raw, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"


def event(order: SimpleNamespace, kind: str, sequence: int, *, amount: int = TOTAL_ORE, refund_id: str | None = None) -> dict:
    return {"eventId": f"evt_{uuid.uuid4().hex}", "sequence": sequence, "type": kind, "paymentId": order.payment,
            "transferId": order.transfer_id, "reference": order.reference, "refundId": refund_id, "amountOre": amount,
            "declineCode": None, "occurredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}


def deliver(base: str, body: dict) -> httpx.Response:
    raw = json.dumps(body).encode()
    return req(base, "POST", "/api/gateway/callbacks", headers={"X-Gateway-Signature": sign(raw), "Content-Type": "application/json"}, content=raw)


def gateway_posts(wiremock, suffix: str) -> list[SimpleNamespace]:
    calls = []
    for entry in wiremock.requests(method="POST"):
        request = entry.get("request", entry)
        url = str(request.get("url") or request.get("path") or "").split("?")[0]
        if not url.endswith(suffix):
            continue
        raw = request.get("body") or ""
        try:
            body = json.loads(raw) if isinstance(raw, str) and raw else (raw or {})
        except ValueError:
            body = {}
        headers = {}
        for name, value in (request.get("headers") or {}).items():
            if isinstance(value, dict):
                value = (value.get("values") or [""])[0]
            elif isinstance(value, list):
                value = value[0]
            headers[name.lower()] = str(value)
        calls.append(SimpleNamespace(url=url, raw=raw, body=body, headers=headers))
    return calls


def for_reference(calls: list[SimpleNamespace], reference: str) -> list[SimpleNamespace]:
    return [c for c in calls if isinstance(c.body, dict) and c.body.get("reference") == reference]


def kb_types(killbill, reference: str) -> list[str]:
    payment = killbill.payment_by_key(reference) or {}
    return [t.get("transactionType") for t in payment.get("transactions", [])]


def kb_amounts(killbill, reference: str, kind: str) -> list[int]:
    payment = killbill.payment_by_key(reference) or {}
    return [ore(t.get("amount")) for t in payment.get("transactions", []) if t.get("transactionType") == kind]


def invoice_items(killbill, email: str) -> dict[str, int]:
    account = killbill.account_by_key(email)
    if not account:
        return {}
    items = [item for invoice in killbill.invoices(account["accountId"]) for item in invoice.get("items", [])]
    names = {i.get("invoiceItemId"): i.get("description") for i in items}
    totals = dict.fromkeys(["maker share", "charity share", "VAT", "courier"], 0)
    seen = False
    for item in items:
        linked = item.get("linkedInvoiceItemId")
        name = names.get(linked) if linked else item.get("description")
        if name in totals:
            totals[name] += ore(item.get("amount"))
            seen = True
    return totals if seen else {}


def inbox(mail, email: str, subject: str, settle: float = 0) -> list[dict]:
    found = []
    for message in mail.messages(settle=settle):
        to = [a.lower() for a in addresses(message.get("To"))]
        if email.lower() in to and message.get("Subject") == subject:
            found.append(message)
    return found


def wait_mail(mail, email: str, subject: str) -> dict:
    poll(f"Mailpit held '{subject}' to {email}", lambda: inbox(mail, email, subject), every=1)
    messages = inbox(mail, email, subject, settle=1.5)
    assert len(messages) == 1, f"expected one '{subject}', found {len(messages)}"
    return messages[0]


def svix_messages(svix, app: str, kind: str, reference: str) -> list[dict]:
    return [m for m in svix.messages(app, kind) if (m.get("payload") or {}).get("reference") == reference]


def ntfy_text(message: dict) -> str:
    return f"{message.get('title')}\n{message.get('message')}"


def alerts(ntfy, topic: str, body: str, expected: int = 0, timeout: float = 15) -> list[dict]:
    return [m for m in ntfy.messages(topic, expected, timeout=timeout) if m.get("message") == body]


def wait_alert(ntfy, topic: str, title: str, body: str) -> None:
    poll(f"ntfy topic {topic} carried '{body}'", lambda: alerts(ntfy, topic, body, timeout=2), ALERT_SECONDS)
    found = alerts(ntfy, topic, body, timeout=2)
    assert len(found) == 1, f"'{body}' expected once, saw {len(found)}"
    assert found[0].get("title") == title


def charity_sink(browser: Browser, base: str, wiremock, status: int = 200) -> str:
    path = f"/charity-sink/{uuid.uuid4().hex}"
    wiremock.stub("POST", path, status=status, json={"ok": status == 200})
    response = req(base, "PUT", "/api/staff/charity-endpoint", headers=staff(browser, base, "treasurer"),
                   json={"url": os.environ["WIREMOCK_URL"].rstrip("/") + path})
    assert response.status_code == 200, response.text
    return path


def verify_svix(call: SimpleNamespace) -> None:
    secret = base64.b64decode(CHARITY_SECRET.split("_", 1)[1])
    signed = f"{call.headers['svix-id']}.{call.headers['svix-timestamp']}.{call.raw}".encode()
    expected = base64.b64encode(hmac.new(secret, signed, hashlib.sha256).digest()).decode()
    versions = [part.split(",", 1)[1] for part in call.headers["svix-signature"].split()]
    assert expected in versions, "svix-signature does not verify with the published secret"


def sink_call(wiremock, path: str, field: str, value: Any, event_type: str | None = None) -> SimpleNamespace:
    def probe() -> SimpleNamespace | None:
        return next((c for c in gateway_posts(wiremock, path)
                     if c.body.get(field) == value and (event_type is None or c.body.get("eventId"))), None)

    return poll(f"the charity endpoint received an event with {field}={value}", probe, SVIX_RETRY_SECONDS, 1)


def delivery(browser: Browser, base: str, event_id: str, statuses: set[str]) -> dict:
    def probe() -> dict | None:
        response = req(base, "GET", "/api/staff/deliveries", headers=staff(browser, base, "treasurer"))
        assert response.status_code == 200, response.text
        return next((d for d in response.json()["deliveries"] if d["eventId"] == event_id and d["status"] in statuses), None)

    return poll(f"GET /api/staff/deliveries showed {event_id} as {statuses}", probe, SVIX_RETRY_SECONDS, 1)


def rows_mentioning(database: Postgres, needle: str) -> int:
    total = 0
    for table in database.tables():
        quoted = ".".join(f'"{part}"' for part in table.split("."))
        rows = database.rows(f"SELECT count(*) AS c FROM {quoted} x WHERE x::text LIKE '%{needle}%'")
        total += int(rows[0]["c"])
    return total


def box_hits(base: str, number: int) -> list[dict]:
    response = req(base, "GET", "/api/search", params={"q": str(number)})
    assert response.status_code == 200, response.text
    return [h for h in response.json()["hits"] if h["kind"] == "box" and h["number"] == number]


def peek_payloads(rabbitmq, queue: str) -> list[dict]:
    payloads = []
    for message in rabbitmq.peek(queue):
        payload = message["payload"]
        payloads.append(json.loads(payload) if isinstance(payload, (str, bytes)) else payload)
    return payloads


@contextmanager
def visitor(browser: Browser, base: str, *, width: int = 1280, height: int = 800, choice: str = "Sound off", **options: Any) -> Iterator[Page]:
    with open_app(browser, base + "/", **options) as page:
        page.clock.resume()
        page.set_viewport_size({"width": width, "height": height})
        dialog = page.get_by_role("dialog", name="Sound", exact=True)
        expect(dialog).to_be_visible()
        click(dialog.get_by_role("button", name=choice, exact=True))
        expect(dialog).to_be_hidden()
        yield page


def freeze(page: Page) -> None:
    now = page.evaluate("() => Date.now()")
    page.clock.pause_at(datetime.fromtimestamp(now / 1000 + 1, timezone.utc))


def scene(page: Page) -> dict:
    state = page.evaluate(SCENE_READ)
    assert state is not None, "window.__scene is not published"
    return state


def reach(page: Page, chapter: str) -> None:
    page.evaluate("p => window.scrollTo(0, p * (document.documentElement.scrollHeight - window.innerHeight))", CHAPTER_MID[chapter])
    until(page, "c => window.__scene && window.__scene.chapter === c", chapter)


def scroll_to(page: Page, progress: float) -> None:
    page.evaluate("p => window.scrollTo(0, p * (document.documentElement.scrollHeight - window.innerHeight))", progress)
    until(page, "p => window.__scene && Math.abs(window.__scene.progress - p) < 0.02", progress)


def open_shelf(page: Page, base: str) -> None:
    page.goto(base + "/shelf")
    expect(page.get_by_role("grid", name="Box shelf")).to_be_visible()
    expect(page.get_by_role("gridcell")).to_have_count(EDITION)


def cell(page: Page, number: int, state: str | None = None) -> Locator:
    if state:
        return page.get_by_role("gridcell", name=f"Box {number}, {plate_of(number)}, {state}", exact=True)
    return page.get_by_role("gridcell", name=re.compile(rf"^Box {number}, {plate_of(number)}, "))


def hold_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Hold status")


def boxes_held(page: Page) -> Locator:
    return page.get_by_role("status", name="Boxes held")


def timer(page: Page) -> Locator:
    return page.get_by_role("timer", name="Time left")


def timer_seconds(page: Page) -> int:
    match = re.fullmatch(r"(\d\d):(\d\d)", timer(page).inner_text().strip())
    assert match, "the timer shows minutes and seconds as 09:59"
    return int(match.group(1)) * 60 + int(match.group(2))


def choose_box(page: Page, base: str, plate: str | None = None) -> SimpleNamespace:
    for number in open_numbers(base, plate)[:HOLD_TRIES]:
        target = cell(page, number, "available")
        if target.count() != 1:
            continue
        with page.expect_response(lambda r: r.url.endswith("/api/holds") and r.request.method == "POST") as info:
            click(target)
        if info.value.status == 201:
            data = info.value.json()
            expect(hold_status(page)).to_have_text(f"Box {number} is yours while this match burns.")
            return SimpleNamespace(number=number, plate=plate_of(number), token=data["holdToken"], grant=data)
    pytest.fail("choosing an available shelf cell never granted a hold")


def fill_details(page: Page, name: str, email: str) -> None:
    fill(page.get_by_role("textbox", name="Your name", exact=True), name)
    fill(page.get_by_role("textbox", name="Your email", exact=True), email)
    fill(page.get_by_role("textbox", name="Street", exact=True), STREET)
    fill(page.get_by_role("textbox", name="Postcode", exact=True), "2100")
    fill(page.get_by_role("textbox", name="City", exact=True), "Aalborg")


def fill_card(page: Page, card: str) -> None:
    check(page.get_by_role("radio", name="Card", exact=True))
    fill(page.get_by_role("textbox", name="Card number", exact=True), card)
    fill(page.get_by_role("textbox", name="Expiry", exact=True), "12/29")
    fill(page.get_by_role("textbox", name="Security code", exact=True), "123")


def to_checkout(page: Page) -> None:
    click(page.get_by_role("button", name="Go to checkout"))
    expect(page.get_by_role("form", name="Checkout")).to_be_visible()


def submit_card(page: Page) -> Any:
    with page.expect_response(lambda r: r.url.endswith("/api/checkout") and r.request.method == "POST") as info:
        click(page.get_by_role("button", name=AUTHORISE, exact=True))
    return info.value


def payment_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Payment status")


def staff_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Staff status")


def checkout_errors(page: Page) -> Locator:
    return page.get_by_role("alert", name="Checkout errors")


def staff_login(page: Page, base: str, role: str) -> None:
    page.goto(base + "/staff")
    click(page.get_by_role("link", name="Staff sign-in"))
    sign_in_form(page, role)
    page.wait_for_url(lambda url: same_origin(url, base), timeout=UI_MS)
    expect(page.get_by_role("button", name="Sign out")).to_be_visible()


def staff_row(page: Page, *needles: str) -> Locator:
    pattern = re.compile("|".join(re.escape(n) for n in needles))
    return page.get_by_role("row").or_(page.get_by_role("article")).filter(has_text=pattern)


def scoped(row: Locator, page: Page, role: str, name: str) -> Locator:
    inside = row.get_by_role(role, name=name, exact=True)
    return inside if inside.count() else page.get_by_role(role, name=name, exact=True)


def open_refund_form(page: Page, reference: str) -> Locator:
    row = staff_row(page, reference).first
    expect(row).to_be_visible()
    if row.get_by_role("textbox", name="Refund amount in DKK").count():
        return row
    opener = row.get_by_role("link").or_(row.get_by_role("button")).first
    click(opener if opener.count() else row)
    expect(page.get_by_role("textbox", name="Refund amount in DKK")).to_be_visible()
    return row


def order_url(base: str, order: SimpleNamespace) -> str:
    return f"{base}/order/{order.reference}?token={order.order_token}"


def cell_rects(page: Page) -> list[list[float]]:
    return page.get_by_role("gridcell").evaluate_all(
        "els => els.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })")


def distance(a: dict, b: dict) -> float:
    return math.dist((a["x"], a["y"], a["z"]), (b["x"], b["y"], b["z"]))


class ShelfStream:
    def __init__(self, base: str) -> None:
        self.url = base + "/api/shelf/events"
        self.events: list[tuple[str | None, dict]] = []
        self.ready = threading.Event()
        self.stop = threading.Event()
        self.content_type = ""

    def _run(self) -> None:
        with contextlib.suppress(httpx.HTTPError, ValueError):
            with httpx.stream("GET", self.url, timeout=httpx.Timeout(HTTP_TIMEOUT, read=STREAM_READ)) as response:
                self.content_type = response.headers.get("content-type", "")
                self.ready.set()
                name = None
                for line in response.iter_lines():
                    if self.stop.is_set():
                        return
                    if line.startswith("event:"):
                        name = line[6:].strip()
                    elif line.startswith("data:"):
                        self.events.append((name, json.loads(line[5:])))

    def __enter__(self) -> "ShelfStream":
        threading.Thread(target=self._run, daemon=True).start()
        assert self.ready.wait(HTTP_TIMEOUT), "GET /api/shelf/events never answered"
        return self

    def __exit__(self, *_: Any) -> None:
        self.stop.set()

    def saw(self, number: int, state: str) -> bool:
        return any(n == "box" and e.get("number") == number and e.get("state") == state for n, e in self.events)


def test_shelf_lists_and_pushes_changes(app_url):
    base = app_url.rstrip("/")
    shelf = req(base, "GET", "/api/shelf").json()
    assert isinstance(shelf["salesPaused"], bool) and isinstance(shelf["remaining"], int)
    assert {b["number"] for b in shelf["boxes"]} == set(range(1, EDITION + 1))
    for box in shelf["boxes"]:
        assert set(box) == {"number", "plate", "state"}
        assert box["plate"] == plate_of(box["number"])
        assert box["state"] in {"available", "held", "taken"}
    with ShelfStream(base) as stream:
        assert stream.content_type.startswith("text/event-stream")
        hold = take_hold(base)
        poll("the stream pushed a held box event", lambda: stream.saw(hold.number, "held"), PUSH_SECONDS, 0.05)
        assert req(base, "DELETE", f"/api/holds/{hold.number}", headers={"X-Hold-Token": hold.token}).status_code == 204
        poll("the stream pushed an available box event", lambda: stream.saw(hold.number, "available"), PUSH_SECONDS, 0.05)


def test_edition_close_reported_and_refused(browser):
    base = inst("APP_EDITION_END_URL")
    poll("GET /api/edition reported salesOpen false after 1 February 2027",
         lambda: req(base, "GET", "/api/edition").json()["salesOpen"] is False, ALERT_SECONDS, 1)
    number = open_numbers(base)[0]
    refused(req(base, "POST", "/api/holds", json={"number": number}), 409, "edition_closed", "This edition closed on 1 February 2027.")
    with visitor(browser, base) as page:
        open_shelf(page, base)
        expect(page.get_by_role("alert", name="Sales banner")).to_have_text("This edition closed on 1 February 2027.")


def test_simultaneous_reaches_one_winner(app_url, valkey):
    base = app_url.rstrip("/")
    number = open_numbers(base)[0]
    replies = in_parallel(lambda: req(base, "POST", "/api/holds", json={"number": number}), THREADS)
    winners = [r for r in replies if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in replies]
    for reply in replies:
        if reply.status_code != 201:
            refused(reply, 409, "box_held", f"Someone else is holding box {number}. Choose another number.")
    token = winners[0].json()["holdToken"]
    assert valkey.command("GET", f"hold:{number}") == token
    name, email = new_buyer()
    assert attempt(base, token, order_body(number, name, email)).status_code == 201
    taken = req(base, "POST", "/api/holds", json={"number": number})
    refused(taken, 409, "box_taken", f"Box {number} has already found a home. Choose another number.")
    assert valkey.command("GET", f"hold:{number}") in (None, token)
    refused(req(base, "POST", "/api/holds", json={"number": EDITION + 1}), 422, "validation_failed", "Please check the highlighted fields.")


def test_hold_ends_at_edge_unextended(valkey):
    base = inst("APP_SHORT_URL")
    number = open_numbers(base)[0]
    sent = time.monotonic()
    first = req(base, "POST", "/api/holds", json={"number": number})
    received = time.monotonic()
    assert first.status_code == 201, first.text
    grant = first.json()
    token = grant["holdToken"]
    assert grant["holdMs"] == SHORT_HOLD * 1000
    assert 0 < valkey.ttl(f"short-hold:{number}") <= SHORT_HOLD
    foreign = {"X-Hold-Token": "not-the-token"}
    refused(req(base, "GET", f"/api/holds/{number}", headers=foreign), 403, "hold_not_yours", "This hold belongs to someone else.")
    refused(req(base, "DELETE", f"/api/holds/{number}", headers=foreign), 403, "hold_not_yours", "This hold belongs to someone else.")
    repeat = req(base, "POST", "/api/holds", headers={"X-Hold-Token": token}, json={"number": number})
    assert repeat.status_code == 200, repeat.text
    assert repeat.json()["holdToken"] == token and repeat.json()["remainingMs"] <= grant["remainingMs"]
    name, email = new_buyer()
    declined = attempt(base, token, order_body(number, name, email, card=CARD_OTHER))
    assert declined.status_code == 402
    assert declined.json()["holdRemainingMs"] <= repeat.json()["remainingMs"]

    def ended() -> bool:
        return req(base, "GET", f"/api/holds/{number}", headers={"X-Hold-Token": token}).status_code == 410

    poll("GET /api/holds answered 410 after the edge", ended, SHORT_HOLD + SHORT_BAND + 2, 0.1)
    finished = time.monotonic()
    assert finished - sent >= SHORT_HOLD, "the hold ended before its published edge"
    assert finished - received <= SHORT_HOLD + SHORT_BAND + 1, "the hold outlived its stated band"
    copy = f"Your match went out. Box {number} is back on the shelf."
    refused(req(base, "GET", f"/api/holds/{number}", headers={"X-Hold-Token": token}), 410, "hold_ended", copy)
    refused(req(base, "DELETE", f"/api/holds/{number}", headers={"X-Hold-Token": token}), 410, "hold_ended", copy)
    refused(attempt(base, token, order_body(number, name, email)), 410, "hold_ended", copy)
    assert valkey.ttl(f"short-hold:{number}") == -2
    poll("the box was available again", lambda: box_public_state(base, number) == "available", PUSH_SECONDS)


def test_countdown_ignores_device_clock(browser, app_url):
    base = app_url.rstrip("/")
    with visitor(browser, base) as page:
        page.clock.set_fixed_time(datetime(2031, 1, 1, tzinfo=timezone.utc))
        polls: list[str] = []
        page.on("request", lambda r: polls.append(r.url) if "/api/holds/" in r.url and r.method == "GET" else None)
        open_shelf(page, base)
        hold = choose_box(page, base)
        headers = {"X-Hold-Token": hold.token}
        poll("the page asked the server for the time left each second", lambda: len(polls) >= 2, 10)
        server = req(base, "GET", f"/api/holds/{hold.number}", headers=headers).json()
        shown = timer_seconds(page)
        assert abs(shown - server["remainingMs"] / 1000) <= 3, "the countdown strays from the server's remaining time"
        state = scene(page)
        assert abs(state["holdRemainingMs"] - server["remainingMs"]) <= SERVER_SLACK_MS
        assert abs(state["matchLength"] - state["holdRemainingMs"] / HOLD_FULL_MS) < 0.01
        page.clock.set_fixed_time(datetime(2019, 6, 1, tzinfo=timezone.utc))
        page.reload()
        expect(timer(page)).to_be_visible()
        reloaded = timer_seconds(page)
        assert reloaded <= shown, "a reload gained time"
        server = req(base, "GET", f"/api/holds/{hold.number}", headers=headers).json()
        assert abs(reloaded - server["remainingMs"] / 1000) <= 3
        release(base, hold)


def test_held_match_draws_in_scene(browser, app_url):
    base = app_url.rstrip("/")
    with visitor(browser, base) as page:
        open_shelf(page, base)
        canvas = page.locator("canvas").first
        matrices = camera(page)
        assert matrices, "the scene uploaded no camera matrices"
        before_shot = decode(capture(canvas))
        before = scene(page)["cameraPosition"]
        hold = choose_box(page, base)
        start = time.monotonic()
        last_change = start
        previous = scene(page)["cameraPosition"]
        moved = False
        deadline = start + TURN_SECONDS + 1
        while time.monotonic() < deadline:
            threading.Event().wait(0.05)
            current = scene(page)["cameraPosition"]
            if distance(current, previous) > 1e-4:
                last_change = time.monotonic()
            moved = moved or distance(current, before) > 1e-4
            previous = current
        assert moved, "the camera never turned to the box"
        assert last_change - start < TURN_SECONDS + 0.25, "the camera was still turning after a second"
        assert difference(before_shot, decode(capture(canvas))) > 0, "the scene did not change"
        state = scene(page)
        assert 0 < state["matchLength"] <= 1
        release(base, hold)


def test_wf_hold_number_match_burns_out(browser):
    base = inst("APP_SHORT_URL")
    with visitor(browser, base) as other, visitor(browser, base) as page:
        open_shelf(other, base)
        open_shelf(page, base)
        hold = choose_box(page, base)
        samples = []
        for _ in range(3):
            state = poll("__scene reported a live hold", lambda: (lambda s: s if s["holdRemainingMs"] is not None else None)(scene(page)), 5)
            samples.append(state)
            remaining = state["holdRemainingMs"]
            assert remaining / ((SHORT_HOLD + SHORT_BAND) * 1000) - 0.02 <= state["matchLength"] <= remaining / (SHORT_HOLD * 1000) + 0.02
            poll("the server's remaining time fell", lambda: (scene(page)["holdRemainingMs"] or 0) < state["holdRemainingMs"], 3, 0.05)
        assert samples[0]["matchLength"] > samples[-1]["matchLength"]
        expect(hold_status(page)).to_have_text(f"Your match went out. Box {hold.number} is back on the shelf.")
        expect(cell(other, hold.number, "available")).to_have_count(1, timeout=PUSH_SECONDS * 1000)
        expect(boxes_held(page)).to_have_text("0")
        expect(timer(page)).to_have_count(0)
        final = scene(page)
        assert final["holdRemainingMs"] is None and final["matchLength"] is None


def test_wf_hold_number_choose_and_put_back(browser, app_url, valkey):
    base = app_url.rstrip("/")
    with visitor(browser, base) as other, visitor(browser, base) as page:
        open_shelf(other, base)
        open_shelf(page, base)
        expect(boxes_held(page)).to_have_text("0")
        hold = choose_box(page, base)
        expect(timer(page)).to_have_text(re.compile(r"^(09:\d\d|10:00)$"))
        expect(boxes_held(page)).to_have_text("1")
        expect(page.get_by_role("button", name="Go to checkout")).to_be_focused()
        expect(cell(page, hold.number, "yours")).to_have_count(1)
        expect(cell(other, hold.number, "held")).to_have_count(1, timeout=PUSH_SECONDS * 1000)
        assert valkey.command("GET", f"hold:{hold.number}") == hold.token
        click(page.get_by_role("button", name="Put it back"))
        expect(hold_status(page)).to_have_text(f"Box {hold.number} is back on the shelf.")
        expect(boxes_held(page)).to_have_text("0")
        expect(cell(page, hold.number, "available")).to_be_focused()
        expect(page.get_by_role("button", name="Go to checkout")).to_have_count(0)
        expect(cell(other, hold.number, "available")).to_have_count(1, timeout=PUSH_SECONDS * 1000)
        assert valkey.ttl(f"hold:{hold.number}") == -2


def test_wf_hold_number_second_collector_refused(browser, app_url):
    base = app_url.rstrip("/")
    hold = take_hold(base)
    with visitor(browser, base) as page:
        open_shelf(page, base)
        click(cell(page, hold.number, "held"))
        expect(hold_status(page)).to_have_text(f"Someone else is holding box {hold.number}. Choose another number.")
        expect(boxes_held(page)).to_have_text("0")
        expect(timer(page)).to_have_count(0)
    assert req(base, "GET", f"/api/holds/{hold.number}", headers={"X-Hold-Token": hold.token}).status_code == 200
    release(base, hold)


def test_wf_card_checkout_challenge(browser, app_url, killbill, mail, wiremock):
    base = app_url.rstrip("/")
    name, email = new_buyer()
    with visitor(browser, base) as page:
        open_shelf(page, base)
        hold = choose_box(page, base)
        to_checkout(page)
        fill_details(page, name, email)
        fill_card(page, CARD_CHALLENGE)
        reply = submit_card(page)
        assert reply.status == 202
        data = reply.json()
        reference = data["reference"]
        dialog = page.get_by_role("dialog", name="Bank check")
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text(LAST_FOUR_CHALLENGE)
        expect(dialog).to_contain_text(TOTAL_LABEL)
        assert "challenge" not in kb_types(killbill, reference) and kb_types(killbill, reference) == []
        fill(dialog.get_by_role("textbox", name="One-time code"), OTP)
        click(dialog.get_by_role("button", name="Approve"))
        page.wait_for_url(re.compile(rf"/order/{re.escape(reference)}"), timeout=UI_MS)
        expect(page.get_by_role("heading", name=f"Order {reference}")).to_be_visible()
        expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")
    order = SimpleNamespace(reference=reference, order_token=data["orderToken"])
    assert view(base, order)["paymentState"] == "authorised"
    assert view(base, order)["number"] == hold.number
    wait_box(browser, base, reference, "claimed")
    assert box_public_state(base, hold.number) == "taken"
    assert poll("Kill Bill recorded AUTHORIZE", lambda: kb_types(killbill, reference)) == ["AUTHORIZE"]
    assert kb_amounts(killbill, reference, "AUTHORIZE") == [TOTAL_ORE]
    assert len(for_reference(gateway_posts(wiremock, "/v1/authorisations"), reference)) == 1
    wait_mail(mail, email, f"Box {hold.number} is reserved: card authorised ({reference})")


def test_wf_card_checkout_invalid_fields(browser, app_url, wiremock):
    base = app_url.rstrip("/")
    hold = take_hold(base)
    bad = {"number": hold.number, "method": "card", "buyer": {"name": "", "email": "nope"},
           "address": {"street": "", "postcode": "12", "city": ""},
           "gift": {"recipientName": "", "recipientEmail": "", "message": "x" * (GIFT_MESSAGE_LIMIT + 1)},
           "card": {"number": "12", "expiry": "13", "cvc": "1"}}
    before = len(gateway_posts(wiremock, "/v1/authorisations"))
    response = attempt(base, hold.token, bad)
    refused(response, 422, "validation_failed", "Please check the highlighted fields.")
    assert response.json()["error"]["fields"] == {
        "buyer.name": "Enter your name.", "buyer.email": "Enter a valid email address.",
        "address.street": "Enter a street address.", "address.postcode": "Enter a four-digit postcode.",
        "address.city": "Enter a city.", "gift.recipientName": "Enter the recipient's name.",
        "gift.recipientEmail": "Enter the recipient's email address.", "gift.message": "Keep the gift message to 280 characters.",
        "card.number": "Enter the 16-digit card number.", "card.expiry": "Enter the expiry as MM/YY.",
        "card.cvc": "Enter the three-digit security code."}
    assert len(gateway_posts(wiremock, "/v1/authorisations")) == before
    release(base, hold)
    name, email = new_buyer()
    with visitor(browser, base) as page:
        open_shelf(page, base)
        choose_box(page, base)
        to_checkout(page)
        check(page.get_by_role("radio", name="Card", exact=True))
        click(page.get_by_role("button", name=AUTHORISE, exact=True))
        expect(checkout_errors(page)).to_contain_text("Enter your name.")
        expect(checkout_errors(page)).to_contain_text("Enter the 16-digit card number.")
        fill_details(page, name, email)
        fill_card(page, CARD_PLAIN)
        assert submit_card(page).status == 201
        expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")


def test_wf_card_checkout_decline_then_second_card(browser, app_url):
    base = app_url.rstrip("/")
    name, email = new_buyer()
    with visitor(browser, base) as page:
        open_shelf(page, base)
        hold = choose_box(page, base)
        to_checkout(page)
        fill_details(page, name, email)
        fill_card(page, CARD_OTHER)
        first = submit_card(page)
        assert first.status == 402
        expect(checkout_errors(page)).to_have_text("Your bank declined this card. Try another card; your match keeps burning.")
        fill_card(page, CARD_PLAIN)
        second = submit_card(page)
        assert second.status == 201
        assert second.json()["reference"] == first.json()["reference"]
        assert second.json()["holdRemainingMs"] in (None, 0) or second.json()["holdRemainingMs"] <= first.json()["holdRemainingMs"]
        expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")
        assert view(base, SimpleNamespace(reference=second.json()["reference"], order_token=second.json()["orderToken"]))["number"] == hold.number


def test_declines_keep_the_same_hold(app_url, killbill):
    base = app_url.rstrip("/")
    name, email = new_buyer()
    hold = take_hold(base)
    remaining = hold.grant["remainingMs"]
    references = set()
    copies = {
        CARD_OTHER: ("do_not_honor", "Your bank declined this card. Try another card; your match keeps burning."),
        CARD_POOR: ("insufficient_funds", "This card has too little in it. Try another card; your match keeps burning."),
        CARD_EXPIRED: ("expired_card", "This card has expired. Try another card; your match keeps burning."),
    }
    for card, (code, copy) in copies.items():
        response = attempt(base, hold.token, order_body(hold.number, name, email, card=card))
        refused(response, 402, code, copy)
        data = response.json()
        assert data["paymentState"] == "declined" and data["boxState"] == "held"
        assert data["holdRemainingMs"] <= remaining
        remaining = data["holdRemainingMs"]
        references.add(data["reference"])
    token_headers = {"X-Hold-Token": hold.token}
    challenge = attempt(base, hold.token, order_body(hold.number, name, email, card=CARD_CHALLENGE))
    assert challenge.status_code == 202
    reference = challenge.json()["reference"]
    references.add(reference)
    wrong = req(base, "POST", f"/api/checkout/{reference}/challenge", headers=token_headers, json={"code": "9999"})
    refused(wrong, 402, "challenge_failed", "The bank could not confirm it was you. Try again; your match keeps burning.")
    challenge = attempt(base, hold.token, order_body(hold.number, name, email, card=CARD_CHALLENGE))
    assert challenge.status_code == 202
    cancelled = req(base, "POST", f"/api/checkout/{reference}/challenge", headers=token_headers, json={"cancel": True})
    refused(cancelled, 402, "challenge_cancelled", "You cancelled the bank's check. Try again; your match keeps burning.")
    assert len(references) == 1, "one hold must keep one order reference"
    assert kb_types(killbill, reference) == []
    assert req(base, "GET", f"/api/holds/{hold.number}", headers=token_headers).json()["remainingMs"] <= remaining
    assert attempt(base, hold.token, order_body(hold.number, name, email)).status_code == 201


def test_challenge_ends_at_limit(browser):
    copy = "The bank's check ran out of time. Try again; your match keeps burning."
    base = inst("APP_TUNED_URL")
    name, email = new_buyer()
    hold = take_hold(base)
    started = attempt(base, hold.token, order_body(hold.number, name, email, card=CARD_CHALLENGE))
    assert started.status_code == 202, started.text
    data = started.json()
    assert 0 < data["challenge"]["expiresInMs"] <= TUNED_CHALLENGE * 1000
    headers = {"X-Hold-Token": hold.token}
    start_remaining = req(base, "GET", f"/api/holds/{hold.number}", headers=headers).json()["remainingMs"]
    poll("the hold clock passed the challenge limit",
         lambda: req(base, "GET", f"/api/holds/{hold.number}", headers=headers).json()["remainingMs"] <= start_remaining - TUNED_CHALLENGE * 1000 - 500,
         TUNED_CHALLENGE + 5)
    late = req(base, "POST", f"/api/checkout/{data['reference']}/challenge", headers=headers, json={"code": OTP})
    refused(late, 410, "challenge_expired", copy)
    assert req(base, "GET", f"/api/holds/{hold.number}", headers=headers).status_code == 200
    release(base, hold)

    with visitor(browser, base) as page:
        open_shelf(page, base)
        ui_hold = choose_box(page, base)
        to_checkout(page)
        fill_details(page, name, email)
        fill_card(page, CARD_CHALLENGE)
        assert submit_card(page).status == 202
        dialog = page.get_by_role("dialog", name="Bank check")
        expect(dialog).to_be_visible()
        expect(dialog).to_be_hidden(timeout=(TUNED_CHALLENGE + 3) * 1000)
        expect(checkout_errors(page)).to_have_text(copy)
        release(base, SimpleNamespace(number=ui_hold.number, token=ui_hold.token))

    short = inst("APP_SHORT_URL")
    short_hold = take_hold(short)
    capped = attempt(short, short_hold.token, order_body(short_hold.number, name, email, card=CARD_CHALLENGE))
    assert capped.status_code == 202, capped.text
    assert capped.json()["challenge"]["expiresInMs"] <= SHORT_HOLD * 1000
    short_headers = {"X-Hold-Token": short_hold.token}
    poll("the short hold ended", lambda: req(short, "GET", f"/api/holds/{short_hold.number}", headers=short_headers).status_code == 410, SHORT_HOLD + SHORT_BAND + 2)
    ended = req(short, "POST", f"/api/checkout/{capped.json()['reference']}/challenge", headers=short_headers, json={"code": OTP})
    assert ended.status_code == 410
    assert ended.json()["error"]["code"] in {"challenge_expired", "hold_ended"}


def test_attempt_key_single_authorisation(app_url, killbill, wiremock):
    base = app_url.rstrip("/")
    name, email = new_buyer()
    hold = take_hold(base)
    body = order_body(hold.number, name, email)
    missing = req(base, "POST", "/api/checkout", headers={"X-Hold-Token": hold.token}, json=body)
    refused(missing, 422, "validation_failed")
    key = idempotency_key()
    replies = in_parallel(lambda: attempt(base, hold.token, body, key), DOUBLE_SUBMITS)
    assert {r.status_code for r in replies} == {201}, [r.text for r in replies]
    assert len({r.json()["reference"] for r in replies}) == 1
    assert {r.json()["paymentState"] for r in replies} == {"authorised"}
    reference = replies[0].json()["reference"]
    later = attempt(base, hold.token, body, key)
    assert later.status_code == 201 and later.json()["reference"] == reference
    calls = for_reference(gateway_posts(wiremock, "/v1/authorisations"), reference)
    assert len(calls) == 1
    assert calls[0].headers.get("idempotency-key") == key
    poll("Kill Bill recorded the authorisation", lambda: kb_types(killbill, reference))
    assert kb_types(killbill, reference) == ["AUTHORIZE"]
    other = dict(body, buyer={"name": name, "email": "other." + email})
    refused(attempt(base, hold.token, other, key), 409, "idempotency_conflict", "That request key was already used for something else.")
    assert len(for_reference(gateway_posts(wiremock, "/v1/authorisations"), reference)) == 1


def tab_to(page: Page, target: Locator, presses: int = 60) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if target.evaluate("e => e === document.activeElement"):
            return
    pytest.fail("Tab never reached the published control; expected a keyboard-complete checkout")


def test_wf_card_checkout_keyboard(browser, app_url):
    base = app_url.rstrip("/")
    name, email = new_buyer()
    number = open_numbers(base)[0]
    with visitor(browser, base) as page:
        open_shelf(page, base)
        first_cell = page.get_by_role("gridcell")
        for _ in range(60):
            page.keyboard.press("Tab")
            if first_cell.evaluate_all("els => els.includes(document.activeElement)"):
                break
        else:
            pytest.fail("Tab never reached the shelf grid")
        page.keyboard.type(str(number))
        expect(cell(page, number)).to_be_focused()
        page.keyboard.press("Enter")
        go = page.get_by_role("button", name="Go to checkout")
        expect(go).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.get_by_role("form", name="Checkout")).to_be_visible()
        for label, value in (("Your name", name), ("Your email", email), ("Street", STREET), ("Postcode", "2100"), ("City", "Aalborg")):
            tab_to(page, page.get_by_role("textbox", name=label, exact=True))
            page.keyboard.type(value)
        radio = page.get_by_role("radio", name="Card", exact=True)
        if not radio.is_checked():
            tab_to(page, radio)
            page.keyboard.press("Space")
        for label, value in (("Card number", CARD_CHALLENGE), ("Expiry", "12/29"), ("Security code", "123")):
            tab_to(page, page.get_by_role("textbox", name=label, exact=True))
            page.keyboard.type(value)
        authorise = page.get_by_role("button", name=AUTHORISE, exact=True)
        tab_to(page, authorise)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Bank check")
        expect(dialog).to_be_visible()
        for key in ("Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            page.keyboard.press(key)
            assert dialog.evaluate("e => e.contains(document.activeElement)"), "focus left the open bank check"
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(checkout_errors(page)).to_have_text("You cancelled the bank's check. Try again; your match keeps burning.")
        expect(authorise).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        code = dialog.get_by_role("textbox", name="One-time code")
        for _ in range(6):
            if code.evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        page.keyboard.type(OTP)
        approve = dialog.get_by_role("button", name="Approve")
        for _ in range(6):
            if approve.evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")
    assert box_public_state(base, number) == "taken"


def test_wf_bank_transfer_reserve_and_settle(browser, app_url, killbill, mail, wiremock):
    base = app_url.rstrip("/")
    name, email = new_buyer()
    transfer_id = f"trf_{uuid.uuid4()}"
    wiremock.stub("POST", "/v1/transfers", status=201, json={"transferId": transfer_id, "iban": ACCOUNT_IBAN, "paymentReference": transfer_id})
    with visitor(browser, base) as page:
        open_shelf(page, base)
        hold = choose_box(page, base)
        to_checkout(page)
        fill_details(page, name, email)
        check(page.get_by_role("radio", name="Bank transfer", exact=True))
        with page.expect_response(lambda r: r.url.endswith("/api/checkout") and r.request.method == "POST") as info:
            click(page.get_by_role("button", name="Reserve for bank transfer"))
        assert info.value.status == 201
        data = info.value.json()
        reference = data["reference"]
        assert data["holdRemainingMs"] is None and data["boxState"] == "awaiting_transfer"
        assert data["transfer"]["iban"] == ACCOUNT_IBAN and data["transfer"]["amountOre"] == TOTAL_ORE
        assert re.fullmatch(r".*T23:59:59(\.0+)?[+-]\d\d:\d\d", data["transfer"]["deadlineAt"])
        expect(payment_status(page)).to_have_text("Waiting for your bank transfer.")
        expect(page.get_by_text(ACCOUNT_IBAN).first).to_be_visible()
        calls = for_reference(gateway_posts(wiremock, "/v1/transfers"), reference)
        assert len(calls) == 1 and calls[0].body["amountOre"] == TOTAL_ORE
        assert box_public_state(base, hold.number) == "taken"
        assert wait_box(browser, base, reference, "awaiting_transfer")["paymentState"] == "pending"
        wait_mail(mail, email, f"Bank transfer instructions for box {hold.number} ({reference})")
        assert kb_types(killbill, reference) == []
        order = SimpleNamespace(reference=reference, order_token=data["orderToken"], payment=None, transfer_id=transfer_id)
        settled = deliver(base, event(order, "transfer.received", 1))
        assert settled.json() == {"status": "applied"}
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text("Your transfer has arrived.")
    assert wait_box(browser, base, reference, "claimed")["paymentState"] == "settled"
    assert poll("Kill Bill recorded PURCHASE", lambda: kb_types(killbill, reference)) == ["PURCHASE"]
    assert kb_amounts(killbill, reference, "PURCHASE") == [TOTAL_ORE]
    wait_mail(mail, email, f"Your receipt for box {hold.number} ({reference})")


def test_transfer_deadline_skips_holidays(wiremock):
    base = inst("APP_CHRISTMAS_URL")
    order = transfer_order(base, wiremock)
    deadline = datetime.fromisoformat(order.reply["transfer"]["deadlineAt"].replace("Z", "+00:00"))
    assert (deadline.year, deadline.month, deadline.day) == (2026, 12, 29)
    assert (deadline.hour, deadline.minute, deadline.second) == (23, 59, 59)
    assert deadline.utcoffset() == timedelta(hours=1), "the deadline is Copenhagen local time with its offset"


def test_wf_bank_transfer_lapse(browser, mail, wiremock):
    base = inst("APP_SHORT_URL")
    order = transfer_order(base, wiremock)
    assert box_public_state(base, order.number) == "taken"
    poll("the pending order lapsed", lambda: view(base, order)["paymentState"] == "lapsed", SHORT_TRANSFER + SWEEP + 3)
    assert box_public_state(base, order.number) == "available"
    wait_mail(mail, order.email, f"Your transfer deadline passed: box {order.number} ({order.reference})")
    with visitor(browser, base) as page:
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text(f"Your transfer deadline passed. Box {order.number} is back on the shelf.")


def test_transfer_late_refunded(mail, wiremock, killbill):
    base = inst("APP_SHORT_URL")
    order = transfer_order(base, wiremock)
    poll("the pending order lapsed", lambda: view(base, order)["paymentState"] == "lapsed", SHORT_TRANSFER + SWEEP + 3)
    assert deliver(base, event(order, "transfer.received", 1)).status_code == 200
    calls = poll("the app called the transfer refund", lambda: gateway_posts(wiremock, f"/v1/transfers/{order.transfer_id}/refund"))
    assert len(calls) == 1 and calls[0].body["amountOre"] == TOTAL_ORE
    wait_mail(mail, order.email, f"Refund for box {order.number} ({order.reference})")
    assert view(base, order)["paymentState"] == "lapsed"
    assert box_public_state(base, order.number) != "taken"
    assert kb_types(killbill, order.reference) == []


def test_transfer_wrong_amount_returned(browser, app_url, mail, wiremock):
    base = app_url.rstrip("/")
    order = transfer_order(base, wiremock)
    deadline = view(base, order)["transfer"]["deadlineAt"]
    assert deliver(base, event(order, "transfer.received", 1, amount=WRONG_TRANSFER_ORE)).status_code == 200
    calls = poll("the app called the transfer return", lambda: gateway_posts(wiremock, f"/v1/transfers/{order.transfer_id}/return"))
    assert len(calls) == 1 and calls[0].body["amountOre"] == WRONG_TRANSFER_ORE
    wait_mail(mail, order.email, f"Refund for box {order.number} ({order.reference})")
    state = view(base, order)
    assert state["paymentState"] == "pending" and state["transfer"]["deadlineAt"] == deadline
    assert staff_order(browser, base, order.reference)["boxState"] == "awaiting_transfer"
    assert deliver(base, event(order, "transfer.received", 2)).json() == {"status": "applied"}
    assert view(base, order)["paymentState"] == "settled"


SIGNATURE_CASES = ["wrong_secret", "tampered_body", "stale_past", "stale_future", "missing_header"]


@pytest.mark.parametrize("case", SIGNATURE_CASES, ids=SIGNATURE_CASES)
def test_callback_signature_refused(app_url, wiremock, killbill, case):
    base = app_url.rstrip("/")
    order = pending_order(base, wiremock)
    body = event(order, "payment.authorised", 1)
    raw = json.dumps(body).encode()
    now = int(time.time())
    headers = {"Content-Type": "application/json"}
    content = raw
    if case == "wrong_secret":
        headers["X-Gateway-Signature"] = sign(raw, secret="not-the-secret")
    elif case == "tampered_body":
        headers["X-Gateway-Signature"] = sign(raw)
        content = raw.replace(b'"amountOre": 158400', b'"amountOre": 1')
    elif case == "stale_past":
        headers["X-Gateway-Signature"] = sign(raw, at=now - STALE_SECONDS - 10)
    elif case == "stale_future":
        headers["X-Gateway-Signature"] = sign(raw, at=now + STALE_SECONDS + 10)
    bad = req(base, "POST", "/api/gateway/callbacks", headers=headers, content=content)
    assert bad.status_code == 401
    assert bad.json() == {"error": {"code": "bad_signature", "message": "Signature refused."}}
    assert view(base, order)["paymentState"] == "started"
    assert kb_types(killbill, order.reference) == []
    good = req(base, "POST", "/api/gateway/callbacks",
               headers={"Content-Type": "application/json", "X-Gateway-Signature": sign(raw, at=now - STALE_SECONDS + 30)}, content=raw)
    assert good.json() == {"status": "applied"}
    assert view(base, order)["paymentState"] == "authorised"
    unknown = dict(event(order, "payment.authorised", 2), reference="LB-NOSUCH")
    assert deliver(base, unknown).status_code == 404


def test_wf_gateway_callbacks_replay_and_reorder(browser, app_url, wiremock, killbill, mail):
    base = app_url.rstrip("/")
    order = pending_order(base, wiremock)
    authorised = event(order, "payment.authorised", 1)
    replies = in_parallel(lambda: deliver(base, authorised), THREADS)
    statuses = sorted(r.json()["status"] for r in replies)
    assert statuses == ["applied"] + ["duplicate"] * (THREADS - 1), statuses
    poll("Kill Bill recorded AUTHORIZE", lambda: kb_types(killbill, order.reference))
    assert kb_types(killbill, order.reference) == ["AUTHORIZE"]
    wait_mail(mail, order.email, f"Box {order.number} is reserved: card authorised ({order.reference})")
    pending = pack(browser, base, order.reference)
    assert pending.status_code == 202 and pending.json()["packing"] == "pending"
    refund_id = f"ref_{uuid.uuid4()}"
    early = event(order, "payment.refunded", 5, amount=REFUND_ORE, refund_id=refund_id)
    assert deliver(base, early).json() == {"status": "waiting"}
    assert view(base, order)["paymentState"] == "authorised"
    capture_event = event(order, "payment.captured", 4)
    assert deliver(base, capture_event).json() == {"status": "applied"}
    assert deliver(base, capture_event).json() == {"status": "duplicate"}
    poll("the waiting refund was applied after the capture",
         lambda: view(base, order)["paymentState"] == "partially_refunded")
    book = poll("the ledger showed the waiting refund settled",
                lambda: (lambda b: b if b["refunds"] and b["refunds"][0]["state"] == "settled" else None)(ledger(browser, base, order.reference)))
    assert [r["amountOre"] for r in book["refunds"]] == [REFUND_ORE]
    late = event(order, "payment.authorised", 2)
    assert deliver(base, late).json() == {"status": "ignored"}
    assert kb_types(killbill, order.reference).count("CAPTURE") == 1
    with visitor(browser, base) as page:
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text("Part of your payment has been refunded.")


def test_authorisation_after_hold_voided(browser, wiremock):
    base = inst("APP_SHORT_URL")
    order = pending_order(base, wiremock)
    headers = {"X-Hold-Token": order.token}
    poll("the hold ended", lambda: req(base, "GET", f"/api/holds/{order.number}", headers=headers).status_code == 410, SHORT_HOLD + SHORT_BAND + 2)
    assert deliver(base, event(order, "payment.authorised", 1)).status_code == 200
    calls = poll("the app voided the late authorisation", lambda: gateway_posts(wiremock, f"/v1/payments/{order.payment}/void"))
    assert len(calls) == 1
    poll("the order showed voided", lambda: view(base, order)["paymentState"] == "voided")
    assert box_public_state(base, order.number) == "available"
    with visitor(browser, base) as page:
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text("Your match went out before the bank replied. You have not been charged.")


def test_wf_gateway_callbacks_charged_after_confirmation(browser, app_url, wiremock, killbill):
    base = app_url.rstrip("/")
    order = pending_order(base, wiremock)
    assert deliver(base, event(order, "payment.authorised", 1)).json() == {"status": "applied"}
    with visitor(browser, base) as page:
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")
        first = pack(browser, base, order.reference)
        assert first.status_code == 202
        assert first.json() == {"reference": order.reference, "boxState": "claimed", "paymentState": "authorised", "packing": "pending"}
        again = pack(browser, base, order.reference)
        assert again.status_code == 202 and again.json()["packing"] == "pending"
        assert len(gateway_posts(wiremock, f"/v1/payments/{order.payment}/capture")) == 1, "a repeat Pack started a second capture"
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")
        assert "CAPTURE" not in kb_types(killbill, order.reference)
        assert deliver(base, event(order, "payment.captured", 2)).json() == {"status": "applied"}
        poll("the order showed captured", lambda: view(base, order)["paymentState"] == "captured")
        assert kb_amounts(killbill, order.reference, "CAPTURE") == [TOTAL_ORE]
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text("Your card has been charged.")


def test_wf_pack_capture_pack_and_ship(browser, app_url, wiremock, killbill, mail):
    base = app_url.rstrip("/")
    payment = stub_authorised(wiremock)
    recipient, recipient_email = new_buyer("recipient")
    order = place(base, gift=gift_of(recipient, recipient_email))
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        search = page.get_by_role("searchbox", name="Search boxes")
        fill(search, recipient)
        row = staff_row(page, order.reference, recipient).first
        expect(row).to_be_visible()
        with held(page, "**/api/staff/orders/*/pack") as let_through:
            click(row.get_by_role("button", name="Pack", exact=True))
            expect(staff_status(page)).to_have_text(f"Packing box {order.number}...")
            let_through()
        expect(staff_status(page)).to_have_text(f"Box {order.number} is shipped.")
    calls = gateway_posts(wiremock, f"/v1/payments/{payment}/capture")
    assert len(calls) == 1 and calls[0].body["amountOre"] == TOTAL_ORE
    assert view(base, order)["paymentState"] == "captured"
    assert kb_amounts(killbill, order.reference, "CAPTURE") == [TOTAL_ORE]
    shipped = wait_box(browser, base, order.reference, "shipped")
    bookings = for_reference(gateway_posts(wiremock, "/v1/courier/bookings"), order.reference)
    assert len(bookings) == 1
    assert bookings[0].body["boxNumber"] == order.number and bookings[0].body["recipientName"] == recipient
    assert shipped["trackingCode"].startswith("SP")
    wait_mail(mail, order.email, f"Your receipt for box {order.number} ({order.reference})")
    refused(pack(browser, base, order.reference), 409, "illegal_transition", "That cannot be done in this box's current state.")
    assert len(gateway_posts(wiremock, f"/v1/payments/{payment}/capture")) == 1


def test_wf_pack_capture_gateway_down_recovers(browser, app_url, wiremock, killbill):
    base = app_url.rstrip("/")
    payment = stub_authorised(wiremock)
    order = place(base)
    wiremock.fault("POST", f"/v1/payments/{payment}/capture")
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        row = staff_row(page, order.reference).first
        click(row.get_by_role("button", name="Pack", exact=True))
        expect(staff_status(page)).to_have_text("The gateway is down. Nothing was captured.")
        assert view(base, order)["paymentState"] == "authorised"
        assert "CAPTURE" not in kb_types(killbill, order.reference)
        assert staff_order(browser, base, order.reference)["boxState"] == "claimed"
        wiremock.stub("POST", f"/v1/payments/{payment}/capture", status=200, json={"status": "captured", "confirmation": "immediate"})
        click(staff_row(page, order.reference).first.get_by_role("button", name="Pack", exact=True))
        expect(staff_status(page)).to_have_text(f"Box {order.number} is shipped.")
    assert view(base, order)["paymentState"] == "captured"
    assert kb_amounts(killbill, order.reference, "CAPTURE") == [TOTAL_ORE]


def test_wf_pack_capture_failed_then_repack(browser, app_url, wiremock, ntfy, killbill):
    base = app_url.rstrip("/")
    payment = stub_authorised(wiremock, "pay_capfail_")
    order = place(base)
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        click(staff_row(page, order.reference).first.get_by_role("button", name="Pack", exact=True))
        expect(staff_status(page)).to_have_text(f"The card could not be captured for box {order.number}. Try packing again.")
        row = staff_order(browser, base, order.reference)
        assert row["boxState"] == "claimed" and row["paymentState"] == "capture_failed"
        assert "CAPTURE" not in kb_types(killbill, order.reference)
        wait_alert(ntfy, "svovlstik-maker", "Capture failed", f"Box {order.number}: capture of DKK {TOTAL_LABEL} failed.")
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text("We could not charge your card. The press will be in touch.")
    wiremock.stub("POST", f"/v1/payments/{payment}/capture", status=200, json={"status": "captured", "confirmation": "immediate"})
    second = pack(browser, base, order.reference)
    assert second.status_code == 202 and second.json()["packing"] == "done"
    assert view(base, order)["paymentState"] == "captured"


def test_authorisation_expires_unattended(browser, wiremock, ntfy, killbill):
    base = inst("APP_SHORT_URL")
    payment = stub_authorised(wiremock)
    order = place(base)
    assert view(base, order)["paymentState"] == "authorised"
    poll("the server moved payment to authorisation_expired",
         lambda: view(base, order)["paymentState"] == "authorisation_expired", SHORT_AUTH + SWEEP + 3)
    assert len(gateway_posts(wiremock, f"/v1/payments/{payment}/void")) == 1
    assert box_public_state(base, order.number) == "available"
    refused(pack(browser, base, order.reference), 409, "authorisation_expired")
    wait_alert(ntfy, "short-svovlstik-maker", "Authorisation expired", f"Box {order.number}: authorisation of DKK {TOTAL_LABEL} expired and was voided.")
    assert "VOID" in poll("Kill Bill recorded VOID", lambda: "VOID" in kb_types(killbill, order.reference) and kb_types(killbill, order.reference))
    items = poll("the invoice items were adjusted to zero", lambda: (lambda i: i if i and not any(i.values()) else None)(invoice_items(killbill, order.email)))
    assert set(items) == {"maker share", "charity share", "VAT", "courier"}
    with visitor(browser, base) as page:
        page.goto(order_url(base, order))
        expect(payment_status(page)).to_have_text("This authorisation lapsed. You have not been charged.")


def test_wf_fulfilment_event_broker_outage(browser, mail, svix):
    base = inst("APP_RABBITMQ_DOWN_URL")
    database = Postgres("_rabbitmq")
    before = rows_mentioning(database, "order.paid")
    order = captured(browser, base)
    assert view(base, order)["paymentState"] == "captured"
    assert rows_mentioning(database, "order.paid") > before, "no stored order.paid event while the broker is down"
    assert inbox(mail, order.email, f"Your receipt for box {order.number} ({order.reference})", settle=1.5) == []
    assert svix_messages(svix, "rabbitmq-svovlstik-charity", "order.paid", order.reference) == []
    refused(req(base, "GET", "/api/staff/dead-letters", headers=staff(browser, base, "packer")), 503, "queue_unreachable",
            "The dead-letter list cannot be read right now. Nothing is lost.")
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        expect(staff_status(page)).to_have_text("Events are waiting for the queue. Nothing is lost.")
        page.goto(base + "/staff/dead-letters")
        expect(staff_status(page)).to_have_text("The dead-letter list cannot be read right now. Nothing is lost.")


def test_redelivery_repeats_no_effect(browser, wiremock, mail, rabbitmq):
    base = inst("APP_SVIX_DOWN_URL")
    bucket = S3("-svix")
    recipient, recipient_email = new_buyer("recipient")
    order = captured(browser, base, gift=gift_of(recipient, recipient_email))
    letter = dead_letter(browser, base, order.reference)
    receipt = f"Your receipt for box {order.number} ({order.reference})"
    gift_subject = "A numbered box is on its way to you"
    wait_mail(mail, order.email, receipt)
    wait_mail(mail, recipient_email, gift_subject)
    key = f"certificates/{order.reference}.pdf"
    first_bytes = bucket.get(key)
    retried = req(base, "POST", f"/api/staff/dead-letters/{letter['eventId']}/retry", headers=staff(browser, base, "packer"))
    assert retried.status_code == 202, retried.text
    assert retried.json() == {"eventId": letter["eventId"], "status": "requeued"}
    poll("the requeued event left the dead-letter queue",
         lambda: letter["eventId"] not in [p["eventId"] for p in peek_payloads(rabbitmq, "svix-press.fulfilment.dead")], 15)
    dead_letter(browser, base, order.reference)
    wait_mail(mail, order.email, receipt)
    wait_mail(mail, recipient_email, gift_subject)
    assert bucket.get(key) == first_bytes
    assert [k for k in bucket.keys("certificates/") if order.reference in k] == [key]
    assert len(for_reference(gateway_posts(wiremock, "/v1/courier/bookings"), order.reference)) == 1


def test_wf_fulfilment_event_effects(browser, app_url, mail, svix):
    base = app_url.rstrip("/")
    order = place(base)
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        click(staff_row(page, order.reference).first.get_by_role("button", name="Pack", exact=True))
        expect(staff_status(page)).to_have_text(f"Box {order.number} is shipped.")
        shipped = wait_box(browser, base, order.reference, "shipped")
        page.goto(base + "/staff/packing")
        expect(page.get_by_text(shipped["trackingCode"]).first).to_be_visible()
    pdf = wait_certificate(base, order)
    assert S3().get(f"certificates/{order.reference}.pdf") == pdf
    assert pdf_pages(pdf) >= 1
    words = " ".join(pdf_text(pdf).split())
    for line in ("Svovlstik Press", "The Last Bundle", f"Box {order.number} of 240", f"Plate: {order.plate}",
                 f"Order {order.reference}", f"Charity share of this box: DKK {CHARITY_ORE // 100}.{CHARITY_ORE % 100:02d}"):
        assert line in words, f"certificate lacks '{line}'"
    receipt = wait_mail(mail, order.email, f"Your receipt for box {order.number} ({order.reference})")
    body = mail_text(receipt)
    for amount in (dkk(TOTAL_ORE), dkk(COURIER_ORE), dkk(VAT_ORE), dkk(CHARITY_ORE)):
        assert amount in body, f"receipt lacks {amount}"
    assert f"/order/{order.reference}?token={order.order_token}" in body
    messages = poll("Svix held an order.paid message", lambda: svix_messages(svix, "svovlstik-charity", "order.paid", order.reference))
    assert len(messages) == 1


def test_gift_notice_has_no_prices(browser, app_url, mail):
    base = app_url.rstrip("/")
    recipient, recipient_email = new_buyer("recipient")
    order = captured(browser, base, gift=gift_of(recipient, recipient_email))
    notice = wait_mail(mail, recipient_email, "A numbered box is on its way to you")
    body = mail_text(notice)
    for wanted in (recipient, str(order.number), order.plate, RECIPIENT_MESSAGE):
        assert wanted in body
    scanned = body.replace(recipient, "")
    for forbidden in ("DKK", "1,584", "1,495", order.reference):
        assert forbidden not in scanned, f"gift notice carries '{forbidden}'"
    assert not re.search(r"\b(?:1584|1495)\b|\b376[.,]\d\d\b", scanned), "gift notice carries an amount"
    assert inbox(mail, recipient_email, f"Your receipt for box {order.number} ({order.reference})") == []
    wait_mail(mail, order.email, f"Your receipt for box {order.number} ({order.reference})")
    assert staff_order(browser, base, order.reference)["recipientName"] == recipient


def test_charity_events_signed_retried(browser, app_url, wiremock, svix):
    base = app_url.rstrip("/")
    treasurer = staff(browser, base, "treasurer")
    refused(req(base, "PUT", "/api/staff/charity-endpoint", headers=treasurer, json={"url": "ftp://charity"}), 422, "endpoint_invalid",
            "Enter a full http or https address.")
    sink = charity_sink(browser, base, wiremock)
    assert any(e.get("url", "").endswith(sink) for e in svix.endpoints("svovlstik-charity"))
    order = captured(browser, base)
    call = sink_call(wiremock, sink, "reference", order.reference)
    verify_svix(call)
    payload = call.body
    assert set(payload) == {"eventId", "reference", "boxNumber", "plate", "grossOre", "netOre", "vatOre", "charityOre", "makerOre", "rateBasisPoints", "paidAt"}
    assert (payload["boxNumber"], payload["grossOre"], payload["netOre"], payload["vatOre"]) == (order.number, PRICE_ORE, NET_ORE, VAT_ORE)
    assert (payload["charityOre"], payload["makerOre"], payload["rateBasisPoints"]) == (CHARITY_ORE, MAKER_ORE, RATE_SEED)
    message = svix_messages(svix, "svovlstik-charity", "order.paid", order.reference)[0]
    assert message["eventId"] == payload["eventId"]
    row = delivery(browser, base, payload["eventId"], {"delivered"})
    assert row["eventType"] == "order.paid" and row["lastStatusCode"] == 200 and row["attempts"] >= 1

    failing = charity_sink(browser, base, wiremock, status=500)
    second = captured(browser, base)
    target = poll("the failing endpoint was tried twice with one event id",
                  lambda: (lambda calls: calls if len(calls) >= 2 else None)(
                      [c for c in gateway_posts(wiremock, failing) if c.body.get("reference") == second.reference]),
                  SVIX_RETRY_SECONDS, 1)
    assert len({c.headers["svix-id"] for c in target}) == 1
    verify_svix(target[0])
    row = delivery(browser, base, target[0].body["eventId"], {"retrying", "failed"})
    assert row["lastStatusCode"] == 500


def test_private_data_stays_out_of_copies(browser, wiremock, svix, ntfy, rabbitmq):
    base = inst("APP_COPENHAGEN_MONTH_URL")
    wiremock.fault("POST", "/v1/courier/bookings")
    recipient, recipient_email = new_buyer("recipient")
    order = captured(browser, base, gift=gift_of(recipient, recipient_email))
    letter = dead_letter(browser, base, order.reference)
    private = [order.name, order.email, recipient, recipient_email, STREET, RECIPIENT_MESSAGE]

    def clean(surface: str, content: str) -> None:
        for value in private:
            assert value not in content, f"{surface} carries private '{value}'"

    payloads = [p for p in peek_payloads(rabbitmq, "cphmonth-press.fulfilment.dead") if p.get("reference") == order.reference]
    assert payloads, "the dead-lettered message was not in the queue"
    for payload in payloads:
        assert set(payload) == {"eventId", "type", "reference", "boxNumber", "occurredAt"}
        clean("queue message", json.dumps(payload))
    clean("dead-letter row", json.dumps(letter))
    body = f"Event {letter['eventId']} for box {order.number} reached the dead-letter list."
    poll("the dead-letter alert arrived", lambda: alerts(ntfy, "cphmonth-svovlstik-maker", body, timeout=2), ALERT_SECONDS)
    for message in ntfy.messages("cphmonth-svovlstik-maker", 1):
        clean("push alert", ntfy_text(message))
    message = poll("Svix held order.paid", lambda: svix_messages(svix, "cphmonth-svovlstik-charity", "order.paid", order.reference))[0]
    assert message["payload"]["boxNumber"] == order.number
    clean("webhook", json.dumps(message["payload"]))
    clean("certificate", pdf_text(wait_certificate(base, order)))
    statement = issue_statement(browser, base, CPH_MONTH)
    clean("statement lines", json.dumps(statement["lines"]))
    pdf = req(base, "GET", f"/api/staff/statements/{statement['id']}/pdf", headers=staff(browser, base, "treasurer"))
    words = pdf_text(pdf.content)
    assert f"Box {order.number} {order.reference} sale" in " ".join(words.split())
    clean("statement PDF", words)


def test_failing_event_backs_off_to_dead_letter(browser, app_url, wiremock, ntfy, rabbitmq):
    base = app_url.rstrip("/")
    wiremock.fault("POST", "/v1/courier/bookings")
    order = captured(browser, base)
    seen: list[float] = []

    def third() -> bool:
        count = len(for_reference(gateway_posts(wiremock, "/v1/courier/bookings"), order.reference))
        while len(seen) < count:
            seen.append(time.monotonic())
        return count >= 3

    poll("the courier call was tried three times", third, 45, 0.2)
    assert RETRY_FIRST[0] <= seen[1] - seen[0] <= RETRY_FIRST[1], "first retry gap"
    assert RETRY_SECOND[0] <= seen[2] - seen[1] <= RETRY_SECOND[1], "second retry gap"
    letter = dead_letter(browser, base, order.reference)
    assert set(letter) == {"eventId", "type", "reference", "boxNumber", "failedAt", "lastError"}
    assert letter["type"] == "box.packed" and letter["boxNumber"] == order.number
    for value in (order.name, order.email, STREET):
        assert value not in letter["lastError"]
    assert len(for_reference(gateway_posts(wiremock, "/v1/courier/bookings"), order.reference)) == 3, "a fourth delivery ran"
    queues = rabbitmq.queues()
    for queue in ("press.fulfilment", "press.fulfilment.retry", "press.fulfilment.dead"):
        assert queues[queue]["durable"] is True
    assert "press.events" in rabbitmq.exchanges()
    assert letter["eventId"] in [p["eventId"] for p in peek_payloads(rabbitmq, "press.fulfilment.dead")]
    wait_alert(ntfy, "svovlstik-maker", "Event dead-lettered", f"Event {letter['eventId']} for box {order.number} reached the dead-letter list.")
    assert staff_order(browser, base, order.reference)["boxState"] == "packed"


def test_wf_dead_letter_retry_on_phone_and_table(browser, app_url, wiremock, rabbitmq):
    base = app_url.rstrip("/")
    wiremock.fault("POST", "/v1/courier/bookings")
    order = captured(browser, base)
    letter = dead_letter(browser, base, order.reference)
    needles = (letter["eventId"], order.reference)
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        page.goto(base + "/staff/dead-letters")
        expect(page.get_by_role("heading", name="Dead letters")).to_be_visible()
        expect(page.get_by_role("table").first).to_be_visible()
        expect(page.get_by_role("row").filter(has_text=re.compile("|".join(map(re.escape, needles)))).first).to_be_visible()
        page.set_viewport_size({"width": 375, "height": 812})
        page.reload()
        row = page.get_by_role("article").filter(has_text=re.compile("|".join(map(re.escape, needles)))).first
        expect(row).to_be_visible()
        expect(page.get_by_role("table")).to_have_count(0)
        layout(page)
        wiremock.stub("POST", "/v1/courier/bookings", status=201, json={"bookingId": f"crr_{uuid.uuid4()}", "trackingCode": f"SP{uuid.uuid4()}"})
        click(row.get_by_role("button", name="Retry", exact=True))
        expect(staff_status(page)).to_have_text("Event sent back to the queue.")
    shipped = wait_box(browser, base, order.reference, "shipped")
    assert shipped["trackingCode"].startswith("SP")
    poll("the event left the dead-letter queue",
         lambda: letter["eventId"] not in [p["eventId"] for p in peek_payloads(rabbitmq, "press.fulfilment.dead")], 15)


def test_wf_dead_letter_dismiss_during_outage(browser, rabbitmq, ntfy):
    base = inst("APP_GOTENBERG_DOWN_URL")
    order = captured(browser, base)
    wait_box(browser, base, order.reference, "shipped")
    letter = dead_letter(browser, base, order.reference)
    assert letter["type"] == "order.paid"
    wait_alert(ntfy, "gotenberg-svovlstik-maker", "Event dead-lettered", f"Event {letter['eventId']} for box {order.number} reached the dead-letter list.")
    packer = staff(browser, base, "packer")
    refused(req(base, "POST", f"/api/staff/dead-letters/{letter['eventId']}/dismiss", headers=packer, json={"note": ""}),
            422, "dismissal_note_required", "Add a note of up to 280 characters.")
    assert letter["eventId"] in [p["eventId"] for p in peek_payloads(rabbitmq, "gotenberg-press.fulfilment.dead")]
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        page.goto(base + "/staff/dead-letters")
        row = staff_row(page, letter["eventId"], order.reference).first
        expect(row).to_be_visible()
        fill(scoped(row, page, "textbox", "Dismissal note"), "Printed by hand.")
        click(scoped(row, page, "button", "Dismiss"))
        expect(staff_status(page)).to_have_text("Event dismissed.")
    poll("the dismissed event left the dead-letter queue",
         lambda: letter["eventId"] not in [p["eventId"] for p in peek_payloads(rabbitmq, "gotenberg-press.fulfilment.dead")], 15)
    events = req(base, "GET", "/api/staff/dead-letters", headers=packer).json()["events"]
    assert letter["eventId"] not in [e["eventId"] for e in events]


def restock(browser: Browser, base: str, order: SimpleNamespace) -> None:
    pack(browser, base, order.reference)
    refund(browser, base, order.reference, PRICE_ORE)
    wait_box(browser, base, order.reference, "returned")
    req(base, "POST", f"/api/staff/boxes/{order.number}/back-on-shelf", headers=staff(browser, base, "packer"))


def test_maker_alerts_once_each(browser, ntfy):
    base = inst("APP_TUNED_URL")
    topic = "tuned-svovlstik-maker"
    maker = staff(browser, base, "maker")
    stock = req(base, "GET", "/api/staff/stock", headers=maker).json()
    assert stock["thresholds"] == [239, 238]
    assert stock["remaining"] == EDITION, "the tuned instance must start this case with a full shelf"
    first_body, second_body = "239 boxes remain.", "238 boxes remain."
    start_first = len(alerts(ntfy, topic, first_body, timeout=2))
    start_second = len(alerts(ntfy, topic, second_body, timeout=2))
    placed: list[SimpleNamespace] = []
    try:
        hold = take_hold(base)
        assert req(base, "GET", "/api/staff/stock", headers=maker).json()["remaining"] == EDITION, "a hold changed the stock count"
        release(base, hold)
        placed.append(place(base))
        placed.append(place(base))
        assert req(base, "GET", "/api/staff/stock", headers=maker).json()["remaining"] == EDITION - 2
        poll("the 239 crossing alerted", lambda: len(alerts(ntfy, topic, first_body, timeout=2)) >= start_first + 1, ALERT_SECONDS)
        poll("the 238 crossing alerted", lambda: len(alerts(ntfy, topic, second_body, timeout=2)) >= start_second + 1, ALERT_SECONDS)
        assert len(alerts(ntfy, topic, first_body, timeout=2)) == start_first + 1
        assert len(alerts(ntfy, topic, second_body, timeout=2)) == start_second + 1
        latest = next(m for m in reversed(alerts(ntfy, topic, first_body, timeout=2)))
        assert latest.get("title") == "Low stock"
        for order in list(placed):
            restock(browser, base, order)
            placed.remove(order)
        assert req(base, "GET", "/api/staff/stock", headers=maker).json()["remaining"] == EDITION
        placed.append(place(base))
        poll("a second crossing after the rise alerted again",
             lambda: len(alerts(ntfy, topic, first_body, timeout=2)) >= start_first + 2, ALERT_SECONDS)
        for message in ntfy.messages(topic, 1):
            content = ntfy_text(message)
            assert placed[0].name not in content and placed[0].email not in content and STREET not in content
    finally:
        for order in placed:
            restock(browser, base, order)


def test_partial_refund_split(browser, app_url):
    base = app_url.rstrip("/")
    unpaid = place(base)
    refused(refund(browser, base, unpaid.reference, REFUND_ORE), 409, "not_captured", "This order has not been charged yet.")
    order = captured(browser, base)
    refused(refund(browser, base, order.reference, 0), 422, "refund_invalid", "Enter an amount above zero.")
    refused(refund(browser, base, order.reference, PRICE_ORE + 1), 422, "refund_exceeds_remainder", "That is more than remains on this box.")
    first = refund(browser, base, order.reference, REFUND_ORE)
    assert first.status_code == 202, first.text
    data = first.json()
    assert (data["amountOre"], data["netOre"], data["vatOre"], data["charityOre"], data["makerOre"]) == (
        REFUND_ORE, REFUND_NET, REFUND_VAT, REFUND_CHARITY, REFUND_MAKER)
    spent = REFUND_ORE
    for amount in EXTRA_REFUNDS:
        net = half_up(amount * 100, 125)
        charity = half_up(net * RATE_SEED, 10000)
        reply = refund(browser, base, order.reference, amount).json()
        assert (reply["netOre"], reply["vatOre"], reply["charityOre"], reply["makerOre"]) == (net, amount - net, charity, net - charity)
        spent += amount
    racing = in_parallel(lambda: refund(browser, base, order.reference, CONCURRENT_REFUND_ORE), 2)
    assert sorted(r.status_code for r in racing) == [202, 422], [r.text for r in racing]
    book = poll("every accepted refund settled", lambda: (lambda b: b if all(r["state"] == "settled" for r in b["refunds"]) else None)(ledger(browser, base, order.reference)))
    assert sum(r["amountOre"] for r in book["refunds"]) == spent + CONCURRENT_REFUND_ORE
    assert [l for l in book["lines"] if l["kind"] == "refund"][0]["grossOre"] < 0


def test_final_refund_takes_remainder(browser, app_url, killbill):
    base = app_url.rstrip("/")
    order = captured(browser, base)
    assert refund(browser, base, order.reference, REFUND_ORE).status_code == 202
    rest = refund(browser, base, order.reference, REST_ORE)
    assert rest.status_code == 202, rest.text
    data = rest.json()
    assert (data["netOre"], data["vatOre"], data["charityOre"], data["makerOre"]) == (REST_NET, REST_VAT, REST_CHARITY, REST_MAKER)
    poll("the order showed refunded", lambda: view(base, order)["paymentState"] == "refunded")
    wait_box(browser, base, order.reference, "returned")
    book = ledger(browser, base, order.reference)
    assert book["totals"] == {"grossOre": 0, "netOre": 0, "vatOre": 0, "charityOre": 0, "makerOre": 0}
    assert kb_amounts(killbill, order.reference, "REFUND") == [REFUND_ORE, REST_ORE]
    items = poll("Kill Bill's items reached zero", lambda: (lambda i: i if i.get("maker share") == 0 and i.get("charity share") == 0 and i.get("VAT") == 0 else None)(invoice_items(killbill, order.email)))
    assert items["courier"] == COURIER_ORE, "the courier fee is never refunded"
    refused(refund(browser, base, order.reference, 1), 422, "refund_exceeds_remainder")


def test_refund_confirmed_twice(browser, app_url, wiremock, killbill, svix):
    base = app_url.rstrip("/")
    order = pending_order(base, wiremock)
    assert deliver(base, event(order, "payment.authorised", 1)).json() == {"status": "applied"}
    pack(browser, base, order.reference)
    assert deliver(base, event(order, "payment.captured", 2)).json() == {"status": "applied"}
    poll("the order showed captured", lambda: view(base, order)["paymentState"] == "captured")
    refund_id = f"ref_{uuid.uuid4()}"
    wiremock.stub("POST", f"/v1/payments/{order.payment}/refunds", status=202, json={"refundId": refund_id, "status": "pending", "confirmation": "callback"})
    key = idempotency_key()
    replies = in_parallel(lambda: refund(browser, base, order.reference, REFUND_ORE, key), DOUBLE_SUBMITS)
    assert {r.status_code for r in replies} == {202}
    assert {r.json()["state"] for r in replies} == {"pending"}
    assert len(gateway_posts(wiremock, f"/v1/payments/{order.payment}/refunds")) == 1
    refused(refund(browser, base, order.reference, REFUND_ORE + 1, key), 409, "idempotency_conflict", "That request key was already used for something else.")
    book = ledger(browser, base, order.reference)
    assert [r["state"] for r in book["refunds"]] == ["pending"]
    assert [l for l in book["lines"] if l["kind"] == "refund"] == []
    assert kb_amounts(killbill, order.reference, "REFUND") == []
    assert svix_messages(svix, "svovlstik-charity", "refund.settled", order.reference) == []
    settled = deliver(base, event(order, "payment.refunded", 3, amount=REFUND_ORE, refund_id=refund_id))
    assert settled.json() == {"status": "applied"}
    book = poll("the refund settled", lambda: (lambda b: b if b["refunds"][0]["state"] == "settled" else None)(ledger(browser, base, order.reference)))
    assert kb_amounts(killbill, order.reference, "REFUND") == [REFUND_ORE]
    assert [l["grossOre"] for l in book["lines"] if l["kind"] == "refund"] == [-REFUND_ORE]


def test_wf_refunds_partial_then_full(browser, app_url, wiremock, mail, svix):
    base = app_url.rstrip("/")
    sink = charity_sink(browser, base, wiremock)
    order = captured(browser, base)
    with visitor(browser, base) as page:
        staff_login(page, base, "treasurer")
        page.goto(base + "/staff/refunds")
        row = open_refund_form(page, order.reference)
        fill(scoped(row, page, "textbox", "Refund amount in DKK"), "333.33")
        click(scoped(row, page, "button", "Refund"))
        expect(staff_status(page)).to_have_text("Refund settled.")
        expect(page.get_by_role("region", name="Ledger")).to_be_visible()
        assert view(base, order)["paymentState"] == "partially_refunded"
        click(scoped(staff_row(page, order.reference).first, page, "button", "Refund the rest"))
        poll("the final refund settled", lambda: view(base, order)["paymentState"] == "refunded")
    book = ledger(browser, base, order.reference)
    assert sorted(r["amountOre"] for r in book["refunds"]) == [REFUND_ORE, REST_ORE]
    assert book["totals"]["charityOre"] == 0 and book["totals"]["makerOre"] == 0
    subject = f"Refund for box {order.number} ({order.reference})"
    poll("the buyer got two refund notices", lambda: len(inbox(mail, order.email, subject)) >= 2, every=1)
    assert len(inbox(mail, order.email, subject, settle=1.5)) == 2
    messages = poll("Svix held both refund.settled events",
                    lambda: (lambda m: m if len(m) == 2 else None)(svix_messages(svix, "svovlstik-charity", "refund.settled", order.reference)))
    fields = {"eventId", "reference", "boxNumber", "refundId", "refundOre", "netOre", "vatOre", "charityOre", "makerOre", "settledAt"}
    assert all(set(m["payload"]) == fields for m in messages)
    assert sorted(m["payload"]["refundOre"] for m in messages) == [REFUND_ORE, REST_ORE]
    call = sink_call(wiremock, sink, "refundOre", REST_ORE)
    verify_svix(call)
    delivery(browser, base, call.body["eventId"], {"delivered"})


def test_wf_refunds_gateway_down(browser, app_url, wiremock, killbill):
    base = app_url.rstrip("/")
    payment = stub_authorised(wiremock)
    order = captured(browser, base)
    wiremock.fault("POST", f"/v1/payments/{payment}/refunds")
    with visitor(browser, base) as page:
        staff_login(page, base, "treasurer")
        page.goto(base + "/staff/refunds")
        row = open_refund_form(page, order.reference)
        fill(scoped(row, page, "textbox", "Refund amount in DKK"), "333.33")
        click(scoped(row, page, "button", "Refund"))
        expect(staff_status(page)).to_have_text("The gateway is down. No refund was started.")
        assert kb_amounts(killbill, order.reference, "REFUND") == []
        assert ledger(browser, base, order.reference)["refunds"] == []
        wiremock.stub("POST", f"/v1/payments/{payment}/refunds", status=200, json={"refundId": f"ref_{uuid.uuid4()}", "status": "refunded", "confirmation": "immediate"})
        click(scoped(staff_row(page, order.reference).first, page, "button", "Refund"))
        expect(staff_status(page)).to_have_text("Refund settled.")


def test_back_on_shelf_only_by_packer(browser, app_url, meilisearch):
    base = app_url.rstrip("/")
    order = captured(browser, base)
    packer = staff(browser, base, "packer")
    path = f"/api/staff/boxes/{order.number}/back-on-shelf"
    refused(req(base, "POST", path, headers=packer), 409, "illegal_transition", "That cannot be done in this box's current state.")
    assert refund(browser, base, order.reference, PRICE_ORE).status_code == 202
    wait_box(browser, base, order.reference, "returned")
    assert box_public_state(base, order.number) == "taken"
    assert box_hits(base, order.number) == []
    remaining = req(base, "GET", "/api/shelf").json()["remaining"]
    response = req(base, "POST", path, headers=packer)
    assert response.status_code == 200, response.text
    assert response.json() == {"number": order.number, "state": "available"}
    assert box_public_state(base, order.number) == "available"
    assert req(base, "GET", "/api/shelf").json()["remaining"] == remaining + 1
    poll("the box returned to public search", lambda: box_hits(base, order.number), SEARCH_SECONDS)
    poll("the box document returned to the public index",
         lambda: [d for d in meilisearch.documents("press_public") if d.get("kind") == "box" and str(d.get("number")) == str(order.number)], SEARCH_SECONDS)
    refused(req(base, "POST", path, headers=packer), 409, "illegal_transition")


def test_split_and_fees(browser, app_url, wiremock):
    base = app_url.rstrip("/")
    edition = req(base, "GET", "/api/edition").json()
    assert edition["edition"] == EDITION and edition["charityName"] == "Varmestuen Nord"
    assert (edition["priceOre"], edition["netOre"], edition["vatOre"], edition["courierOre"], edition["totalOre"]) == (
        PRICE_ORE, NET_ORE, VAT_ORE, COURIER_ORE, TOTAL_ORE)
    assert (edition["rateBasisPoints"], edition["charityOre"]) == (RATE_SEED, CHARITY_ORE)
    order = captured(browser, base)
    book = ledger(browser, base, order.reference)
    assert (book["rateBasisPoints"], book["grossOre"], book["courierOre"], book["totalOre"]) == (RATE_SEED, PRICE_ORE, COURIER_ORE, TOTAL_ORE)
    sale = next(l for l in book["lines"] if l["kind"] == "sale")
    assert (sale["grossOre"], sale["netOre"], sale["vatOre"], sale["charityOre"], sale["makerOre"]) == (PRICE_ORE, NET_ORE, VAT_ORE, CHARITY_ORE, MAKER_ORE)
    assert book["gatewayFeeOre"] == FEE_CARD_ORE
    assert book["makerAfterFeesOre"] == MAKER_ORE - FEE_CARD_ORE
    assert refund(browser, base, order.reference, PRICE_ORE).status_code == 202
    book = poll("the refund settled", lambda: (lambda b: b if b["totals"]["makerOre"] == 0 else None)(ledger(browser, base, order.reference)))
    assert book["gatewayFeeOre"] == FEE_CARD_ORE and book["makerAfterFeesOre"] == -FEE_CARD_ORE
    transfer = transfer_order(base, wiremock)
    assert ledger(browser, base, transfer.reference)["gatewayFeeOre"] in (0, FEE_BANK_ORE)
    assert deliver(base, event(transfer, "transfer.received", 1)).json() == {"status": "applied"}
    settled = ledger(browser, base, transfer.reference)
    assert settled["gatewayFeeOre"] == FEE_BANK_ORE and settled["makerAfterFeesOre"] == MAKER_ORE - FEE_BANK_ORE


def test_rate_locks_orders(browser, killbill):
    base = inst("APP_NTFY_DOWN_URL")
    treasurer = staff(browser, base, "treasurer")
    refused(req(base, "POST", "/api/staff/charity-rates", headers=treasurer, json={"rateBasisPoints": 10001, "effectiveFrom": "2099-01-01T00:00:00Z"}),
            422, "rate_invalid", "Enter a rate from 0 to 100 percent.")
    past = "2020-01-01T00:00:00Z"
    refused(req(base, "POST", "/api/staff/charity-rates", headers=treasurer, json={"rateBasisPoints": RATE_NEW, "effectiveFrom": past}),
            422, "rate_must_be_future", "A new rate must start in the future.")
    christmas = inst("APP_CHRISTMAS_URL")
    refused(req(christmas, "POST", "/api/staff/charity-rates", headers=staff(browser, christmas, "treasurer"),
                json={"rateBasisPoints": RATE_NEW, "effectiveFrom": "2026-12-21T09:00:00+01:00"}),
            422, "rate_must_be_future", "A new rate must start in the future.")
    current = req(base, "GET", "/api/edition").json()["rateBasisPoints"]
    new_rate, old_rate = (RATE_SEED, RATE_NEW) if current == RATE_NEW else (RATE_NEW, RATE_SEED)
    old_charity = half_up(NET_ORE * old_rate, 10000)
    new_charity = half_up(NET_ORE * new_rate, 10000)
    assert {old_charity, new_charity} == {CHARITY_ORE, CHARITY_33_ORE}
    assert current == old_rate
    earlier = captured(browser, base)
    assert view(base, earlier)["charityOre"] == old_charity
    effective = (datetime.now(timezone.utc) + timedelta(seconds=4)).isoformat()
    scheduled = req(base, "POST", "/api/staff/charity-rates", headers=treasurer, json={"rateBasisPoints": new_rate, "effectiveFrom": effective})
    assert scheduled.status_code == 201, scheduled.text
    rates = req(base, "GET", "/api/staff/charity-rates", headers=treasurer).json()["rates"]
    assert any(r["rateBasisPoints"] == new_rate for r in rates)
    assert view(base, earlier)["charityOre"] == old_charity
    poll("the new rate came into force at its instant",
         lambda: req(base, "GET", "/api/edition").json()["rateBasisPoints"] == new_rate, 15)
    later = captured(browser, base)
    assert view(base, later)["charityOre"] == new_charity
    assert ledger(browser, base, later.reference)["rateBasisPoints"] == new_rate
    assert ledger(browser, base, earlier.reference)["rateBasisPoints"] == old_rate
    assert view(base, earlier)["charityOre"] == old_charity
    assert invoice_items(killbill, earlier.email)["charity share"] == old_charity
    assert invoice_items(killbill, later.email)["charity share"] == new_charity
    assert invoice_items(killbill, later.email)["maker share"] == NET_ORE - new_charity
    assert refund(browser, base, earlier.reference, REFUND_ORE).json()["charityOre"] == half_up(REFUND_NET * old_rate, 10000)


def test_invoice_split_statement_agree(browser, killbill):
    base = inst("APP_COPENHAGEN_MONTH_URL")
    authorised = place(base)
    items = poll("Kill Bill invoiced the authorised order", lambda: invoice_items(killbill, authorised.email))
    expected = {"maker share": MAKER_ORE, "charity share": CHARITY_ORE, "VAT": VAT_ORE, "courier": COURIER_ORE}
    assert items == expected
    order = captured(browser, base)
    assert invoice_items(killbill, order.email) == expected
    book = ledger(browser, base, order.reference)
    assert {i["description"]: i["amountOre"] for i in book["killbill"]["items"] if i["description"] in expected} == expected
    assert {"AUTHORIZE", "CAPTURE"} <= {t["type"] for t in book["killbill"]["transactions"]}
    statement = issue_statement(browser, base, CPH_MONTH)
    assert not [l for l in statement["lines"] if l["reference"] == authorised.reference], "an authorised order reached a statement"
    sale = next(l for l in statement["lines"] if l["reference"] == order.reference)
    assert set(sale) == {"reference", "boxNumber", "kind", "grossOre", "netOre", "vatOre", "charityOre", "makerOre", "rateBasisPoints", "postedAt"}
    stored = next(l for l in book["lines"] if l["kind"] == "sale")
    for field in ("grossOre", "netOre", "vatOre", "charityOre", "makerOre"):
        assert sale[field] == stored[field]
    assert sale["makerOre"] == items["maker share"] and sale["charityOre"] == items["charity share"] and sale["vatOre"] == items["VAT"]
    assert refund(browser, base, order.reference, REFUND_ORE).status_code == 202
    adjusted = poll("Kill Bill adjusted the items by the refund's parts",
                    lambda: (lambda i: i if i["maker share"] == MAKER_ORE - REFUND_MAKER else None)(invoice_items(killbill, order.email)))
    assert adjusted == {"maker share": MAKER_ORE - REFUND_MAKER, "charity share": CHARITY_ORE - REFUND_CHARITY, "VAT": VAT_ORE - REFUND_VAT, "courier": COURIER_ORE}
    totals = ledger(browser, base, order.reference)["totals"]
    assert (totals["makerOre"], totals["charityOre"], totals["vatOre"]) == (adjusted["maker share"], adjusted["charity share"], adjusted["VAT"])
    revised = issue_statement(browser, base, CPH_MONTH)
    assert revised["revision"] == statement["revision"] + 1
    lines = [l for l in revised["lines"] if l["reference"] == order.reference]
    assert sum(l["charityOre"] for l in lines) == adjusted["charity share"]
    assert sum(l["makerOre"] for l in lines) == adjusted["maker share"]
    assert revised["charityTotalOre"] == sum(l["charityOre"] for l in revised["lines"])


def test_wf_charity_statement_issue_and_deliver(browser, wiremock, svix):
    base = inst("APP_COPENHAGEN_MONTH_URL")
    bucket = S3("-cphmonth")
    sink = charity_sink(browser, base, wiremock)
    order = captured(browser, base)
    assert refund(browser, base, order.reference, REFUND_ORE).status_code == 202
    poll("the refund settled", lambda: ledger(browser, base, order.reference)["refunds"][0]["state"] == "settled")
    treasurer = staff(browser, base, "treasurer")
    with visitor(browser, base) as page:
        staff_login(page, base, "treasurer")
        page.goto(base + "/staff/statements")
        fill(page.get_by_role("textbox", name="Month", exact=True), CPH_MONTH)
        click(page.get_by_role("button", name="Issue statement"))
        expect(staff_status(page)).to_have_text("Statement issued.")
        statements = req(base, "GET", "/api/staff/statements", headers=treasurer).json()["statements"]
        latest = max((s for s in statements if s["month"] == CPH_MONTH), key=lambda s: s["revision"])
        assert "lines" not in latest
        link = page.get_by_role("link", name=f"Download statement {CPH_MONTH} revision {latest['revision']}", exact=True)
        expect(link).to_be_visible()
        pdf = page.request.get(base + link.get_attribute("href").replace(base, "")).body()
        call = poll("the charity endpoint received statement.issued",
                    lambda: next((c for c in gateway_posts(wiremock, sink) if c.body.get("statementId") == latest["id"]), None),
                    SVIX_RETRY_SECONDS, 1)
        verify_svix(call)
        delivery(browser, base, call.body["eventId"], {"delivered"})
        page.reload()
        expect(page.get_by_role("table", name="Deliveries")).to_contain_text("statement.issued")
    assert bucket.get(f"statements/{CPH_MONTH}-r{latest['revision']}.pdf") == pdf
    assert pdf_pages(pdf) >= 1
    words = " ".join(pdf_text(pdf).split())
    for line in (
        f"Charity statement {CPH_MONTH}", f"Revision {latest['revision']}", "Varmestuen Nord",
        f"Box {order.number} {order.reference} sale gross {dkk(PRICE_ORE)} net {dkk(NET_ORE)} VAT {dkk(VAT_ORE)} charity {dkk(CHARITY_ORE)} maker {dkk(MAKER_ORE)}",
        f"Box {order.number} {order.reference} refund gross {dkk(-REFUND_ORE)} net {dkk(-REFUND_NET)} VAT {dkk(-REFUND_VAT)} charity {dkk(-REFUND_CHARITY)} maker {dkk(-REFUND_MAKER)}",
        f"Total charity share: {dkk(latest['charityTotalOre'])}",
    ):
        assert line in words, f"statement lacks '{line}'"
    for private in (order.name, order.email, STREET):
        assert private not in words
    payload = call.body
    assert set(payload) == {"eventId", "statementId", "month", "revision", "charityTotalOre", "lineCount", "downloadUrl", "issuedAt"}
    assert payload["month"] == CPH_MONTH and payload["charityTotalOre"] == latest["charityTotalOre"]
    parts = urlsplit(payload["downloadUrl"])
    public = req(base, "GET", f"{parts.path}?{parts.query}")
    assert public.status_code == 200 and public.content == pdf
    assert public.headers["content-type"].startswith("application/pdf")
    assert req(base, "GET", f"{parts.path}?token=not-the-token").status_code == 404
    assert any(m.get("eventId") == payload["eventId"] for m in svix.messages("cphmonth-svovlstik-charity", "statement.issued"))
    earlier = issue_statement(browser, base, CPH_MONTH)
    again = req(base, "GET", f"/api/staff/statements/{latest['id']}/pdf", headers=treasurer)
    assert earlier["revision"] > latest["revision"] and again.content == pdf


def test_wf_charity_statement_copenhagen_month(browser):
    base = inst("APP_COPENHAGEN_MONTH_URL")
    order = captured(browser, base)
    assert refund(browser, base, order.reference, REFUND_ORE).status_code == 202
    poll("the refund settled", lambda: ledger(browser, base, order.reference)["refunds"][0]["state"] == "settled")
    with visitor(browser, base) as page:
        staff_login(page, base, "treasurer")
        page.goto(base + "/staff/statements")
        month = page.get_by_role("textbox", name="Month", exact=True)
        fill(month, FUTURE_MONTH)
        click(page.get_by_role("button", name="Issue statement"))
        expect(page.get_by_text("Enter a month that has started, as YYYY-MM.").first).to_be_visible()
        fill(month, CPH_MONTH)
        click(page.get_by_role("button", name="Issue statement"))
        expect(staff_status(page)).to_have_text("Statement issued.")
    refused(req(base, "POST", "/api/staff/statements", headers=staff(browser, base, "treasurer"), json={"month": FUTURE_MONTH}), 422, "month_invalid")
    december = issue_statement(browser, base, CPH_MONTH)
    lines = {l["kind"]: l for l in december["lines"] if l["reference"] == order.reference}
    assert lines["sale"]["grossOre"] == PRICE_ORE
    assert lines["refund"]["grossOre"] == -REFUND_ORE
    assert lines["refund"]["charityOre"] == -REFUND_CHARITY
    assert december["charityTotalOre"] == sum(l["charityOre"] for l in december["lines"])
    november = issue_statement(browser, base, UTC_MONTH)
    assert [l for l in november["lines"] if l["reference"] == order.reference] == []


def test_lookup_limit(browser):
    base = inst("APP_SHORT_URL")
    order = place(base)
    copy = "We could not find an order with that reference and email."
    limited = "Too many tries. Please wait before trying again."
    with visitor(browser, base) as page:
        page.goto(base + "/lookup")
        expect(page.get_by_role("form", name="Find your order")).to_be_visible()
        reference = page.get_by_role("textbox", name="Order reference")
        email = page.get_by_role("textbox", name="Email", exact=True)
        first = req(base, "POST", "/api/orders/lookup", json={"reference": order.reference, "email": "wrong@example.test"})
        refused(first, 404, "lookup_refused", copy)
        second = req(base, "POST", "/api/orders/lookup", json={"reference": "LB-NOSUCH", "email": order.email})
        assert second.status_code == first.status_code and second.content == first.content
        for _ in range(LOOKUP_TRIES - 3):
            assert req(base, "POST", "/api/orders/lookup", json={"reference": "LB-NOSUCH", "email": "no@example.test"}).content == first.content
        fill(reference, "LB-NOSUCH")
        fill(email, "no@example.test")
        click(page.get_by_role("button", name="Find my order"))
        expect(page.get_by_role("alert", name="Lookup message")).to_have_text(copy)
        blocked = req(base, "POST", "/api/orders/lookup", headers={"X-Forwarded-For": "203.0.113.9"},
                      json={"reference": order.reference, "email": order.email})
        refused(blocked, 429, "lookup_limited", limited)
        wait = int(blocked.headers["retry-after"])
        assert 0 < wait <= SHORT_LOOKUP
        fill(reference, order.reference)
        fill(email, order.email)
        click(page.get_by_role("button", name="Find my order"))
        expect(page.get_by_role("alert", name="Lookup message")).to_have_text(limited)
    right = {"reference": order.reference, "email": order.email.upper()}
    answer = poll("the lookup answered once the window passed",
                  lambda: (lambda r: r if r.status_code == 200 else None)(req(base, "POST", "/api/orders/lookup", json=right)),
                  SHORT_LOOKUP + 5, 0.5)
    assert answer.json() == {"reference": order.reference, "orderToken": order.order_token}
    for _ in range(LOOKUP_TRIES + 1):
        assert req(base, "POST", "/api/orders/lookup", json=right).status_code == 200, "a successful lookup counted"


def test_wf_certificate_retrieval_lookup_download(browser, app_url):
    base = app_url.rstrip("/")
    order = captured(browser, base)
    issued = wait_certificate(base, order)
    with visitor(browser, base) as page:
        page.goto(base + "/lookup")
        fill(page.get_by_role("textbox", name="Order reference"), order.reference)
        fill(page.get_by_role("textbox", name="Email", exact=True), order.email)
        click(page.get_by_role("button", name="Find my order"))
        page.wait_for_url(re.compile(rf"/order/{re.escape(order.reference)}"), timeout=UI_MS)
        expect(payment_status(page)).to_have_text("Your card has been charged.")
        link = page.get_by_role("link", name="Download certificate")
        expect(link).to_be_visible()
        href = link.get_attribute("href")
        fetched = page.request.get(href if href.startswith("http") else base + href)
        assert fetched.status == 200
        assert fetched.headers["content-type"].startswith("application/pdf")
        assert fetched.body() == issued


def test_wf_certificate_retrieval_wrong_pair_recovers(browser, app_url):
    base = app_url.rstrip("/")
    order = place(base)
    with visitor(browser, base) as page:
        page.goto(base + "/lookup")
        reference = page.get_by_role("textbox", name="Order reference")
        email = page.get_by_role("textbox", name="Email", exact=True)
        fill(reference, order.reference)
        fill(email, "wrong@example.test")
        click(page.get_by_role("button", name="Find my order"))
        expect(page.get_by_role("alert", name="Lookup message")).to_have_text("We could not find an order with that reference and email.")
        assert "/lookup" in page.url
        fill(email, order.email)
        click(page.get_by_role("button", name="Find my order"))
        expect(page.get_by_role("heading", name=f"Order {order.reference}")).to_be_visible()


def test_certificate_bytes_and_cancellation(browser, app_url):
    base = app_url.rstrip("/")
    order = place(base)
    assert view(base, order)["certificate"]["state"] in {"none", "pending"}
    early = certificate(base, order)
    assert early.status_code in (404, 409), early.text
    assert early.json()["error"]["code"] in {"not_found", "certificate_pending"}
    wrong = req(base, "GET", f"/api/orders/{order.reference}/certificate", headers={"X-Order-Token": "not-the-token"})
    refused(wrong, 404, "not_found", "We could not find that.")
    assert pack(browser, base, order.reference).status_code == 202
    pdf = wait_certificate(base, order)
    assert S3().get(f"certificates/{order.reference}.pdf") == pdf, "issued before the object was stored"
    first = certificate(base, order)
    assert first.headers["x-content-type-options"].lower() == NOSNIFF
    assert first.content == pdf and certificate(base, order).content == pdf
    assert refund(browser, base, order.reference, REFUND_ORE).status_code == 202
    poll("the partial refund settled", lambda: view(base, order)["paymentState"] == "partially_refunded")
    assert certificate(base, order).content == pdf
    assert refund(browser, base, order.reference, REST_ORE).status_code == 202
    copy = "This certificate was cancelled when the box was refunded."
    poll("the certificate stopped downloading", lambda: certificate(base, order).status_code == 410)
    refused(certificate(base, order), 410, "certificate_cancelled", copy)
    assert view(base, order)["certificate"]["state"] == "cancelled"
    with visitor(browser, base) as page:
        page.goto(order_url(base, order))
        expect(page.get_by_role("status", name="Payment status").or_(page.get_by_text(copy)).first).to_contain_text(re.compile("refunded"))


def test_wf_search_typo_jump(browser, app_url):
    base = app_url.rstrip("/")
    passage_hits = req(base, "GET", "/api/search", params={"q": "thousnds"}).json()["hits"]
    assert any(h["kind"] == "passage" and h["passageId"] == "p05" and h["chapter"] == "tree" for h in passage_hits)
    assert req(base, "GET", "/api/search", params={"q": ""}).json() == {"hits": []}
    number = open_numbers(base, "Stove")[0]
    plate_hits = req(base, "GET", "/api/search", params={"q": "Stovee"}).json()["hits"]
    assert any(h["kind"] == "box" and h["plate"] == "Stove" for h in plate_hits)
    assert len(plate_hits) <= 20
    hit = box_hits(base, number)[0]
    assert set(hit) == {"kind", "number", "plate", "state"} and hit["plate"] == "Stove"
    with visitor(browser, base) as page:
        open_shelf(page, base)
        search = page.get_by_role("searchbox", name="Search the tale and the shelf")
        results = page.get_by_role("list", name="Search results")
        fill(search, "thousnds")
        expect(results.get_by_role("link").first).to_be_visible()
        search.press("ArrowDown")
        page.keyboard.press("Enter")
        until(page, "() => window.__scene && window.__scene.chapter === 'tree'")
        page.goto(base + "/shelf")
        search = page.get_by_role("searchbox", name="Search the tale and the shelf")
        fill(search, str(number))
        link = page.get_by_role("list", name="Search results").get_by_role("link").filter(has_text=str(number)).first
        expect(link).to_be_visible()
        click(link)
        page.wait_for_url(re.compile(rf"/box/{number}$"), timeout=UI_MS)


def test_wf_search_outage(browser):
    base = inst("APP_MEILISEARCH_DOWN_URL")
    copy = "Search is resting. The tale and the shelf still work."
    refused(req(base, "GET", "/api/search", params={"q": "stove"}), 503, "search_unreachable", copy)
    recipient, recipient_email = new_buyer("recipient")
    order = place(base, gift=gift_of(recipient, recipient_email))
    packer = staff(browser, base, "packer")
    fallback = req(base, "GET", "/api/staff/search", headers=packer, params={"q": recipient.lower()})
    assert fallback.status_code == 200, fallback.text
    assert fallback.json()["degraded"] is True
    assert [h["reference"] for h in fallback.json()["hits"]] == [order.reference]
    with visitor(browser, base) as page:
        open_shelf(page, base)
        fill(page.get_by_role("searchbox", name="Search the tale and the shelf"), "stove")
        expect(page.get_by_role("status", name="Search status")).to_have_text(copy)
        hold = choose_box(page, base)
        click(page.get_by_role("button", name="Put it back"))
        expect(hold_status(page)).to_have_text(f"Box {hold.number} is back on the shelf.")
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        fill(page.get_by_role("searchbox", name="Search boxes"), recipient)
        expect(staff_status(page)).to_have_text("Search is limited to exact numbers and names for now.")
    assert req(base, "GET", "/api/health").json() == {"status": "ok"}


def test_sold_box_leaves_search(meilisearch, wiremock):
    base = inst("APP_SHORT_URL")
    index = "short-press_public"

    def indexed(number: int) -> list[dict]:
        return [d for d in meilisearch.documents(index) if d.get("kind") == "box" and str(d.get("number")) == str(number)]

    hold = take_hold(base)
    assert box_hits(base, hold.number)[0]["state"] == "held"
    assert indexed(hold.number)
    release(base, hold)
    order = transfer_order(base, wiremock)
    poll("the reserved box left public search", lambda: box_hits(base, order.number) == [], SEARCH_SECONDS, 0.1)
    poll("the reserved box left the public index", lambda: indexed(order.number) == [], SEARCH_SECONDS, 0.1)
    poll("the transfer lapsed", lambda: box_public_state(base, order.number) == "available", SHORT_TRANSFER + SWEEP + 3, 0.1)
    poll("the lapsed box returned to public search", lambda: box_hits(base, order.number), SEARCH_SECONDS, 0.1)
    assert box_hits(base, order.number)[0]["state"] == "available"


def test_staff_search_and_field_projection(browser, app_url, meilisearch):
    base = app_url.rstrip("/")
    recipient, recipient_email = new_buyer("recipient")
    order = place(base, gift=gift_of(recipient, recipient_email))
    plain = place(base)
    packer = staff(browser, base, "packer")

    def staff_hits(query: str) -> list[dict]:
        return req(base, "GET", "/api/staff/search", headers=packer, params={"q": query}).json()["hits"]

    hit = poll("staff search found the recipient", lambda: next(iter(h for h in staff_hits(recipient) if h["reference"] == order.reference), None))
    assert set(hit) == {"number", "plate", "state", "recipientName", "reference"}
    assert hit["recipientName"] == recipient and hit["state"] == "claimed" and hit["number"] == order.number
    poll("a non-gift order is indexed by its buyer", lambda: [h for h in staff_hits(plain.name) if h["reference"] == plain.reference])
    public = req(base, "GET", "/api/search", params={"q": recipient})
    assert public.status_code == 200 and recipient not in public.text
    meilisearch.settled()
    for document in meilisearch.documents("press_public"):
        allowed = {"id", "kind", "passageId", "chapter", "text"} if document["kind"] == "passage" else {"id", "kind", "number", "plate"}
        assert set(document) == allowed, document
    staff_docs = meilisearch.documents("press_staff")
    assert all(set(d) == {"id", "number", "plate", "state", "recipientName", "reference"} for d in staff_docs)
    assert {
        "edition", "priceOre", "netOre", "vatOre", "courierOre", "totalOre", "charityName", "rateBasisPoints", "charityOre", "closesAt", "salesOpen",
    } == set(req(base, "GET", "/api/edition").json())
    assert set(req(base, "GET", f"/api/boxes/{order.number}").json()) == {"number", "plate", "state", "artUrl"}
    assert set(view(base, order)) == {"reference", "number", "plate", "method", "paymentState", "boxState", "totalOre", "charityOre", "transfer", "certificate"}
    row = staff_order(browser, base, order.reference)
    assert set(row) == {"reference", "number", "plate", "recipientName", "address", "boxState", "paymentState", "trackingCode"}
    assert set(row["address"]) == {"street", "postcode", "city"}
    ledger_rows = req(base, "GET", "/api/staff/ledger/orders", headers=staff(browser, base, "treasurer")).json()["orders"]
    mine = next(r for r in ledger_rows if r["reference"] == order.reference)
    assert set(mine) == {"reference", "number", "paymentState", "boxState", "grossOre", "rateBasisPoints"}


def make_png(width: int = 2, height: int = 2, rgb: bytes | None = None, size: int | None = None) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    row = b"\x00" + bytes(width * 3)
    raw = rgb if rgb is not None else row * height
    image = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
             + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return image + bytes(size - len(image)) if size else image


def make_jpeg() -> bytes:
    app0 = b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof0 = b"\xff\xc0\x00\x0b\x08\x00\x02\x00\x02\x01\x01\x11\x00"
    return b"\xff\xd8" + app0 + sof0 + b"\xff\xd9"


ART_IDS = ["png_at_byte_limit", "png_at_pixel_limit", "jpeg", "traversal_name", "over_bytes", "over_multipart", "over_pixels", "svg_script", "renamed_text", "gif"]


def art_case(case: str) -> tuple[str, bytes, str, int, str | None, str | None]:
    wrong_type = "Plate art must be a PNG or JPEG file."
    too_large = "Plate art must be 5,000,000 bytes or smaller."
    return {
        "png_at_byte_limit": ("art.png", make_png(size=ART_BYTES), "image/png", 201, None, None),
        "png_at_pixel_limit": ("art.png", make_png(ART_PIXELS, 1), "image/png", 201, None, None),
        "jpeg": ("art.jpg", make_jpeg(), "image/jpeg", 201, None, None),
        "traversal_name": (f"../../{TRAVERSAL_STEM}.png", make_png(), "image/png", 201, None, None),
        "over_bytes": ("art.png", make_png(size=ART_BYTES + 1), "image/png", 413, "art_too_large", too_large),
        "over_multipart": ("art.png", make_png(size=ART_MULTIPART + 1), "image/png", 413, "art_too_large", too_large),
        "over_pixels": ("art.png", make_png(ART_PIXELS + 1, 1), "image/png", 422, "art_too_many_pixels", "Plate art must be 6,000 pixels or fewer on each side."),
        "svg_script": ("art.png", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/png", 415, "art_wrong_type", wrong_type),
        "renamed_text": ("art.jpg", b"plainly not a picture", "image/jpeg", 415, "art_wrong_type", wrong_type),
        "gif": ("art.png", b"GIF89a\x01\x00\x01\x00\x00\x00\x00;", "image/png", 415, "art_wrong_type", wrong_type),
    }[case]


@pytest.mark.parametrize("case", ART_IDS, ids=ART_IDS)
def test_art_upload_judged(browser, case):
    base = inst("APP_CHRISTMAS_URL")
    bucket = S3("-christmas")
    filename, content, declared, status, code, copy = art_case(case)
    before = set(bucket.keys("plates/tree/"))
    response = req(base, "POST", "/api/staff/plates/tree/art", headers=staff(browser, base, "maker"), files={"file": (filename, content, declared)})
    if code:
        refused(response, status, code, copy)
        assert set(bucket.keys("plates/tree/")) == before, "a rejected file reached storage"
        return
    assert response.status_code == 201, response.text
    data = response.json()
    assert set(data) == {"plate", "artUrl", "bytes", "width", "height"}
    assert data["bytes"] == len(content)
    new_keys = set(bucket.keys("plates/tree/")) - before
    assert len(new_keys) == 1
    key = new_keys.pop()
    assert key.endswith(Path(filename).suffix)
    assert TRAVERSAL_STEM not in key
    assert bucket.get(key) == content
    if case == "png_at_pixel_limit":
        assert (data["width"], data["height"]) == (ART_PIXELS, 1)


def test_wf_plate_art_upload_persists(browser, app_url):
    base = app_url.rstrip("/")
    earlier = captured(browser, base, plate="Star")
    earlier_pdf = wait_certificate(base, earlier)
    side = RANDOM_ART_SIDE
    pixels = b"".join(b"\x00" + os.urandom(side * 3) for _ in range(side))
    art = make_png(side, side, rgb=pixels)
    before = set(S3().keys("plates/star/"))
    with visitor(browser, base) as page:
        staff_login(page, base, "maker")
        page.goto(base + "/staff/plates")
        page.get_by_label("Art file for Star").set_input_files({"name": "plate.png", "mimeType": "image/png", "buffer": art})
        click(page.get_by_role("button", name=UPLOAD_STAR))
        expect(staff_status(page)).to_have_text("Plate art saved.")
        stored = set(S3().keys("plates/star/")) - before
        assert len(stored) == 1 and S3().get(stored.pop()) == art
        art_url = req(base, "GET", f"/api/boxes/{earlier.number}").json()["artUrl"]
        served = req(base, "GET", art_url.replace(base, "") if art_url.startswith("http") else art_url)
        assert served.content == art and served.headers["content-type"].startswith("image/png")
        assert served.headers["x-content-type-options"].lower() == NOSNIFF
        with page.expect_response(lambda r: "/api/plates/star/art" in r.url) as info:
            page.goto(f"{base}/box/{earlier.number}")
        assert info.value.body() == art, "the box page did not show the uploaded bytes"
    later = captured(browser, base, plate="Star")
    later_pdf = wait_certificate(base, later)
    assert IMAGE_XOBJECT.search(later_pdf), "the later certificate does not embed the art as an image"
    assert certificate(base, earlier).content == earlier_pdf, "the earlier certificate changed"


def test_wf_plate_art_storage_outage(browser):
    base = inst("APP_MINIO_DOWN_URL")
    copy = "Plate storage is down. Nothing was saved; try again shortly."
    response = req(base, "POST", "/api/staff/plates/star/art", headers=staff(browser, base, "maker"), files={"file": ("a.png", make_png(), "image/png")})
    refused(response, 503, "storage_unreachable", copy)
    with visitor(browser, base) as page:
        staff_login(page, base, "maker")
        page.goto(base + "/staff/plates")
        page.get_by_label("Art file for Star").set_input_files({"name": "plate.png", "mimeType": "image/png", "buffer": make_png()})
        click(page.get_by_role("button", name=UPLOAD_STAR))
        expect(staff_status(page)).to_have_text(copy)
    release(base, take_hold(base))


def chapter_of(progress: float) -> str:
    return next(name for name, edge in reversed(list(zip(CHAPTERS, CHAPTER_EDGES))) if progress >= edge)


def test_scroll_path_chapters(browser, app_url):
    with visitor(browser, app_url.rstrip("/")) as page:
        expect(page.get_by_role("button", name="Next chapter")).to_have_count(0)
        steps = [i / 20 for i in range(21)]
        forward = []
        for step in steps:
            scroll_to(page, step)
            state = scene(page)
            assert state["chapter"] == chapter_of(state["progress"]), state
            forward.append(state)
        assert {s["chapter"] for s in forward} == set(CHAPTERS)
        hops = [distance(a["cameraPosition"], b["cameraPosition"]) for a, b in zip(forward, forward[1:])]
        total = sum(hops)
        assert total > 0, "the camera never moved"
        walked = 0.0
        span = forward[-1]["progress"] - forward[0]["progress"]
        for state, hop in zip(forward[1:], hops):
            walked += hop
            assert abs(walked / total - (state["progress"] - forward[0]["progress"]) / span) <= PATH_TOLERANCE, "unequal path speed"
        for step, state in reversed(list(zip(steps, forward))):
            scroll_to(page, step)
            back = scene(page)
            assert distance(back["cameraPosition"], state["cameraPosition"]) <= total * 0.01, "reverse left the path"
        before = scene(page)
        page.evaluate("() => { try { window.__scene.progress = 0.5; window.__scene.litMatches = 12; } catch (e) {} }")
        until(page, "() => true")
        after = scene(page)
        assert after["litMatches"] == before["litMatches"] and abs(after["progress"] - before["progress"]) < 0.02


def test_hold_focus_camera(browser, app_url):
    base = app_url.rstrip("/")
    with visitor(browser, base) as page:
        open_shelf(page, base)
        scroll_to(page, 0.5)
        tale_point = scene(page)["cameraPosition"]
        scroll_to(page, 0.97)
        shelf_point = scene(page)["cameraPosition"]
        hold = choose_box(page, base)
        turned = poll("the camera turned to the box", lambda: (lambda c: c if distance(c, shelf_point) > 1e-3 else None)(scene(page)["cameraPosition"]), 3, 0.05)
        samples: list[dict] = []

        def settled() -> dict | None:
            current = scene(page)["cameraPosition"]
            previous = samples[-1] if samples else None
            samples.append(current)
            return current if previous is not None and distance(current, previous) < 1e-3 else None

        focus = poll("the camera settled on the box (two samples 0.4s apart agree)", settled, 6, 0.4)
        progress = scene(page)["progress"]
        scroll_to(page, 0.90)
        state = scene(page)
        assert abs(state["progress"] - progress) > 0.02, "progress stopped following the scroll"
        assert distance(state["cameraPosition"], focus) < 0.05, "the camera left the held box inside the shelf range"
        scroll_to(page, 0.5)
        poll("the camera returned to the path above the shelf", lambda: distance(scene(page)["cameraPosition"], tale_point) < 0.05, TURN_SECONDS + 0.25, 0.05)
        scroll_to(page, 0.97)
        poll("the camera turned back to the held box", lambda: distance(scene(page)["cameraPosition"], focus) < 0.05, TURN_SECONDS + 0.25, 0.05)
        click(page.get_by_role("button", name="Put it back"))
        expect(hold_status(page)).to_have_text(f"Box {hold.number} is back on the shelf.")
        poll("the camera returned to the path after release", lambda: distance(scene(page)["cameraPosition"], shelf_point) < 0.05, TURN_SECONDS + 0.5, 0.05)


def strike_by(page: Page, how: str) -> None:
    button = page.get_by_role("button", name="Strike a match")
    if how == "drag":
        x, y = center(button)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 90, y, steps=5)
        page.mouse.up()
    elif how == "tap":
        tap(button)
    else:
        button.focus()
        page.keyboard.press(how)


def test_strike_burn_and_bundle(browser, app_url):
    with visitor(browser, app_url.rstrip("/")) as page:
        strike = page.get_by_role("button", name="Strike a match")
        story = page.get_by_role("status", name="Story status")
        reach(page, "alley")
        expect(strike).to_be_disabled()
        freeze(page)
        for chapter, how in (("stove", "Space"), ("goose", "Enter"), ("tree", "tap"), ("star", "drag")):
            reach(page, chapter)
            expect(strike).to_be_enabled()
            before = scene(page)
            assert before["litMatches"] == 0 and before["lightIntensity"] == 0
            strike_by(page, how)
            advance(page, 100)
            assert scene(page)["litMatches"] == 1, f"{how} did not strike"
            advance(page, FLARE_MS)
            assert scene(page)["lightIntensity"] == 1
            strike_by(page, "Space")
            advance(page, BURN_EARLY_MS - FLARE_MS - 100)
            state = scene(page)
            assert state["litMatches"] == 1 and state["lightIntensity"] == 1, "the match went out early or a repeat restarted it badly"
            advance(page, BURN_LATE_MS - BURN_EARLY_MS)
            state = scene(page)
            assert state["litMatches"] == 0 and state["lightIntensity"] == 0, "the match outlived 12 seconds"
            expect(story).to_have_text("The match went out. Strike another.")
        reach(page, "grandmother")
        strike_by(page, "Space")
        advance(page, 100 + FLARE_MS)
        state = scene(page)
        assert state["litMatches"] == 12 and state["lightIntensity"] == 2
        advance(page, BURN_EARLY_MS - FLARE_MS - 100)
        assert scene(page)["lightIntensity"] == 2
        advance(page, BURN_LATE_MS - BURN_EARLY_MS)
        state = scene(page)
        assert state["litMatches"] == 0 and state["lightIntensity"] == 0
        expect(story).to_have_text("The bundle went out.")
        reach(page, "shelf")
        expect(strike).to_be_disabled()


P03_TEXT = ('She drew one out—"scratch!" how it sputtered as it burnt! It gave a warm, bright light, like a little candle, as she held her hand over it. '
            "It was really a wonderful light. It seemed to the little girl that she was sitting by a large iron stove, with polished brass feet and a brass ornament. "
            "How the fire burned! and seemed so beautifully warm that the child stretched out her feet as if to warm them, when, lo! the flame of the match went out, "
            "the stove vanished, and she had only the remains of the half-burnt match in her hand.")


def test_sound_gate_narration_captions(browser, app_url):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        page.clock.resume()
        dialog = page.get_by_role("dialog", name="Sound", exact=True)
        expect(dialog).to_be_visible()
        assert dialog.evaluate("e => e.contains(document.activeElement)"), "the question did not take focus"
        expect(dialog.get_by_role("button", name="Sound off", exact=True)).to_be_visible()
        expect(dialog.get_by_role("button", name="Continue without sound", exact=True)).to_be_visible()
        click(dialog.get_by_role("button", name="Sound on", exact=True))
        expect(dialog).to_be_hidden()
        sound = page.get_by_role("button", name="Sound", exact=True)
        expect(sound).to_have_attribute("aria-pressed", "true")
        captions = page.get_by_role("region", name="Captions")
        expect(captions).to_contain_text("It was terribly cold and nearly dark on the last evening of the old year, and the snow was falling fast.")
        page.reload()
        expect(page.get_by_role("main")).to_be_visible()
        expect(sound).to_have_attribute("aria-pressed", "true")
        expect(dialog).to_have_count(0)
        click(sound)
        expect(sound).to_have_attribute("aria-pressed", "false")
        reach(page, "stove")
        poll("captions showed a sentence of the stove passage", lambda: captions.inner_text().strip() and captions.inner_text().strip() in P03_TEXT, 10)
    for chapter in CHAPTERS:
        response = req(base, "GET", f"/narration/{chapter}.ogg")
        assert response.status_code == 200 and response.headers["content-type"].startswith("audio/ogg")
        assert response.content[:4] == b"OggS", f"{chapter}.ogg is not a real Ogg file"
    refused(req(base, "GET", "/narration/nowhere.ogg"), 404, "not_found")


def test_reduced_motion_and_no_webgl_story(browser, app_url):
    base = app_url.rstrip("/")
    for options in ({"reduced_motion": "reduce"}, {"no_webgl": True}):
        with visitor(browser, base, **options) as page:
            nextone = page.get_by_role("button", name="Next chapter")
            previous = page.get_by_role("button", name="Previous chapter")
            expect(nextone).to_be_visible()
            expect(previous).to_be_visible()
            page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            freeze(page)
            advance(page, 500)
            assert scene(page)["chapter"] == "alley", "the page scrubbed on scroll"
            for chapter, how in (("stove", "Space"), ("goose", "tap"), ("tree", "drag")):
                click(nextone)
                until(page, "c => window.__scene.chapter === c", chapter)
                state = scene(page)
                assert state["litMatches"] == 0 and state["lightIntensity"] == 0, "a new chapter must need a new strike"
                advance(page, 100)
                before = decode(capture(page.get_by_role("main")))
                strike_by(page, how)
                advance(page, 100)
                state = scene(page)
                assert state["litMatches"] == 1 and state["lightIntensity"] == 1, f"{how} did not light the vision at once"
                assert difference(before, decode(capture(page.get_by_role("main")))) > 0, "the vision did not appear"
            advance(page, BURN_LATE_MS + 1000)
            state = scene(page)
            assert state["litMatches"] == 1 and state["lightIntensity"] == 1, "the vision burned out under the substitute"
            expect(page.get_by_role("status", name="Story status")).not_to_have_text("The match went out. Strike another.")
            click(previous)
            until(page, "() => window.__scene.chapter === 'goose'")
            assert scene(page)["litMatches"] == 0 and scene(page)["lightIntensity"] == 0
            click(nextone)
            until(page, "() => window.__scene.chapter === 'tree'")
            assert scene(page)["litMatches"] == 0, "the chapter must need a new strike when reached again"
            for chapter in ("star", "grandmother"):
                click(nextone)
                until(page, "c => window.__scene.chapter === c", chapter)
            strike_by(page, "Space")
            advance(page, 100)
            state = scene(page)
            assert state["litMatches"] == 12 and state["lightIntensity"] == 2
            click(nextone)
            until(page, "() => window.__scene.chapter === 'shelf'")
            assert scene(page)["litMatches"] == 0
            page.clock.resume()
            open_shelf(page, base)
            hold = choose_box(page, base)
            expect(timer(page)).to_be_visible()
            to_checkout(page)
            name, email = new_buyer()
            fill_details(page, name, email)
            fill_card(page, CARD_PLAIN)
            assert submit_card(page).status == 201
            expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")
            assert box_public_state(base, hold.number) == "taken"


def test_wf_story_narration_phone_gift(browser, app_url, mail):
    base = app_url.rstrip("/")
    name, email = new_buyer()
    recipient, recipient_email = new_buyer("recipient")
    with visitor(browser, base, width=375, height=812) as page:
        layout(page)
        reach(page, "stove")
        tap(page.get_by_role("button", name="Strike a match"))
        until(page, "() => window.__scene.litMatches === 1")
        layout(page)
        open_shelf(page, base)
        layout(page)
        rects = cell_rects(page)
        assert sum(1 for r in rects if abs(r[1] - rects[0][1]) < 1) == 6
        assert all(r[2] >= MIN_TARGET and r[3] >= MIN_TARGET for r in rects)
        number = open_numbers(base)[0]
        tap(cell(page, number, "available"))
        expect(hold_status(page)).to_have_text(f"Box {number} is yours while this match burns.")
        tap(page.get_by_role("button", name="Go to checkout"))
        expect(page.get_by_role("form", name="Checkout")).to_be_visible()
        fill_details(page, name, email)
        check(page.get_by_role("checkbox", name="This is a gift"))
        fill(page.get_by_role("textbox", name="Recipient name"), recipient)
        fill(page.get_by_role("textbox", name="Recipient email"), recipient_email)
        fill(page.get_by_role("textbox", name="Gift message"), RECIPIENT_MESSAGE)
        fill_card(page, CARD_PLAIN)
        layout(page)
        with page.expect_response(lambda r: r.url.endswith("/api/checkout") and r.request.method == "POST") as info:
            tap(page.get_by_role("button", name=AUTHORISE, exact=True))
        assert info.value.status == 201
        expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")
        layout(page)
        reference = info.value.json()["reference"]
    assert pack(browser, base, reference).status_code == 202
    wait_mail(mail, recipient_email, "A numbered box is on its way to you")
    wait_mail(mail, email, f"Your receipt for box {number} ({reference})")


def test_wf_story_narration_read_and_strike(browser, app_url):
    with visitor(browser, app_url.rstrip("/")) as page:
        start = scene(page)["cameraPosition"]
        freeze(page)
        for chapter in ("stove", "goose", "tree", "star"):
            reach(page, chapter)
            strike_by(page, "Space")
            advance(page, 100)
            assert scene(page)["litMatches"] == 1
            advance(page, BURN_LATE_MS)
        reach(page, "grandmother")
        strike_by(page, "Enter")
        advance(page, 100)
        assert scene(page)["litMatches"] == 12
        advance(page, BURN_LATE_MS)
        reach(page, "shelf")
        assert distance(scene(page)["cameraPosition"], start) > 0
        expect(page.get_by_role("grid", name="Box shelf")).to_be_visible()
        expect(page.get_by_role("gridcell")).to_have_count(EDITION)


def test_wf_cross_cutting_shelf_keyboard(browser, app_url):
    base = app_url.rstrip("/")
    with visitor(browser, base) as page:
        open_shelf(page, base)
        names = page.get_by_role("gridcell").evaluate_all("els => els.map(e => e.tabIndex)")
        assert names.count(0) == 1, "roving focus needs exactly one tabbable cell"
        for box in req(base, "GET", "/api/shelf").json()["boxes"][:5]:
            state = box["state"]
            expect(page.get_by_role("gridcell", name=f"Box {box['number']}, {box['plate']}, {state}", exact=True)).to_have_count(1)
        page.get_by_role("gridcell").nth(names.index(0)).focus()
        page.keyboard.press("Home")
        expect(cell(page, 1)).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(cell(page, 1)).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(cell(page, 1)).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(cell(page, 2)).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(cell(page, 22)).to_be_focused()
        page.keyboard.press("End")
        expect(cell(page, EDITION)).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(cell(page, EDITION)).to_be_focused()
        page.keyboard.type("117")
        expect(cell(page, 117)).to_be_focused()
        number = open_numbers(base)[0]
        page.keyboard.type(str(number))
        expect(cell(page, number)).to_be_focused()
        page.keyboard.press("Space")
        expect(hold_status(page)).to_have_text(f"Box {number} is yours while this match burns.")
        axe(page)
        click(page.get_by_role("button", name="Put it back"))
        expect(cell(page, number)).to_be_focused()


BREAKPOINT_IDS = ["phone", "tablet", "laptop"]
BREAKPOINTS = {"phone": (375, 812, 6, "article"), "tablet": (768, 1024, 12, "table"), "laptop": (1280, 800, 20, "table")}


@pytest.mark.parametrize("band", BREAKPOINT_IDS, ids=BREAKPOINT_IDS)
def test_breakpoints(browser, app_url, band):
    base = app_url.rstrip("/")
    width, height, columns, listing = BREAKPOINTS[band]
    order = place(base)
    with visitor(browser, base, width=width, height=height) as page:
        open_shelf(page, base)
        layout(page)
        rects = cell_rects(page)
        assert sum(1 for r in rects if abs(r[1] - rects[0][1]) < 1) == columns
        assert all(r[2] >= MIN_TARGET and r[3] >= MIN_TARGET for r in rects)
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        if listing == "article":
            expect(page.get_by_role("article").filter(has_text=order.reference).first).to_be_visible()
            expect(page.get_by_role("table")).to_have_count(0)
        else:
            expect(page.get_by_role("table").first).to_be_visible()
            expect(page.get_by_role("row").filter(has_text=order.reference).first).to_be_visible()
        layout(page)


def motion_log(page: Page) -> list[list[Any]]:
    return page.evaluate("() => JSON.parse(sessionStorage.getItem('__motion') || '[]')")


def test_motion_lengths(browser, app_url, wiremock):
    base = app_url.rstrip("/")
    name, email = new_buyer()
    payment = f"pay_cb_{uuid.uuid4()}"
    wiremock.stub("POST", "/v1/authorisations", status=202, json={"paymentId": payment, "status": "pending", "confirmation": "callback"})
    with visitor(browser, base) as page:
        page.add_init_script(MOTION_RECORDER)
        open_shelf(page, base)
        choose_box(page, base)
        expect(boxes_held(page)).to_have_text("1")
        to_checkout(page)
        check(page.get_by_role("radio", name="Card", exact=True))
        click(page.get_by_role("button", name=AUTHORISE, exact=True))
        expect(checkout_errors(page)).to_contain_text("Enter your name.")
        check(page.get_by_role("radio", name="Bank transfer", exact=True))
        fill_details(page, name, email)
        fill_card(page, CARD_CALLBACK)
        reply = submit_card(page).json()
        page.wait_for_url(re.compile("/order/"), timeout=UI_MS)
        order = SimpleNamespace(reference=reply["reference"], payment=payment, transfer_id=None)
        assert deliver(base, event(order, "payment.authorised", 1)).json() == {"status": "applied"}
        expect(payment_status(page)).to_have_text("Your card is authorised. You have not been charged yet.")
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        expect(staff_row(page, reply["reference"]).first).to_be_visible()
        log = motion_log(page)
    for motion, length in MOTION_MS.items():
        durations = [d for name_, d in log if name_ == motion]
        assert durations, f"no {motion} motion was readable from a data-motion element"
        accepted = {length, length / 2} if motion == "press" else {length}
        assert any(abs(d - a) <= 1 for d in durations for a in accepted), f"{motion} ran {durations}, published {length}"


def test_motion_instant_reduced(browser, app_url):
    base = app_url.rstrip("/")
    with visitor(browser, base, reduced_motion="reduce") as page:
        page.add_init_script(MOTION_RECORDER)
        open_shelf(page, base)
        hold = choose_box(page, base)
        to_checkout(page)
        check(page.get_by_role("radio", name="Card", exact=True))
        click(page.get_by_role("button", name=AUTHORISE, exact=True))
        expect(checkout_errors(page)).to_contain_text("Enter your name.")
        assert page.locator("[data-motion]").count() > 0, "no element names its motion"
        log = motion_log(page)
        release(base, hold)
    moving = [entry for entry in log if entry[1] != 0]
    assert moving == [], f"motions ran under reduced motion: {moving}"


def test_wf_cross_cutting_staff_sign_in(browser, app_url):
    base = app_url.rstrip("/")
    known = {u["username"] for role in PASSWORDS for u in Keycloak().users(role)}
    assert set(PASSWORDS) <= known
    assert req(base, "GET", "/api/staff/me").status_code == 401
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        cookie = "; ".join(f"{c['name']}={c['value']}" for c in page.context.cookies(base))
        me = req(base, "GET", "/api/staff/me", headers={"Cookie": cookie})
        assert me.status_code == 200
        assert me.json()["username"] == "packer" and "packer" in me.json()["roles"]
        click(page.get_by_role("button", name="Sign out"))
        expect(page.get_by_role("button", name="Sign out")).to_have_count(0)
        assert req(base, "GET", "/api/staff/me", headers={"Cookie": cookie}).status_code == 401
        page.goto(base + "/staff")
        expect(page.get_by_role("link", name="Staff sign-in")).to_be_visible()


def test_role_matrix(browser, app_url):
    base = app_url.rstrip("/")
    gates = {
        "packer": [("GET", "/api/staff/orders", {}), ("POST", "/api/staff/orders/LB-NOSUCH/pack", {}),
                   ("POST", "/api/staff/boxes/1/back-on-shelf", {}), ("GET", "/api/staff/dead-letters", {}),
                   ("POST", "/api/staff/dead-letters/evt_none/retry", {}), ("POST", "/api/staff/dead-letters/evt_none/dismiss", {"json": {"note": "x"}})],
        "treasurer": [("GET", "/api/staff/ledger/orders", {}), ("GET", "/api/staff/orders/LB-NOSUCH/ledger", {}),
                      ("POST", "/api/staff/orders/LB-NOSUCH/refunds", {"json": {"amountOre": 1}}), ("GET", "/api/staff/charity-rates", {}),
                      ("POST", "/api/staff/charity-rates", {"json": {"rateBasisPoints": 1, "effectiveFrom": "2099-01-01T00:00:00Z"}}),
                      ("GET", "/api/staff/statements", {}), ("POST", "/api/staff/statements", {"json": {"month": EMPTY_MONTH}}),
                      ("PUT", "/api/staff/charity-endpoint", {"json": {"url": "http://charity.example"}}), ("GET", "/api/staff/deliveries", {})],
        "maker": [("POST", "/api/staff/plates/stove/art", {"files": {"file": ("a.png", make_png(), "image/png")}}), ("GET", "/api/staff/stock", {})],
    }
    for owner, calls in gates.items():
        for method, path, extra in calls:
            refused(req(base, method, path, **extra), 401, "sign_in_required", "Please sign in.")
            refused(req(base, method, path, headers={"Authorization": "Bearer not-a-token"}, **extra), 401, "sign_in_required")
            for role in PASSWORDS:
                if role != owner:
                    refused(req(base, method, path, headers=staff(browser, base, role), **extra), 403, "forbidden", "Your role cannot do this.")


def test_server_boundary(app_url):
    base = app_url.rstrip("/")
    refused(req(base, "POST", "/api/holds", headers={"Origin": "https://elsewhere.example"}, json={"number": 1}), 403, "origin_refused", "This request came from another site.")
    refused(req(base, "POST", "/api/holds", headers={"Content-Type": "text/plain"}, content="{}"), 415, "unsupported_media_type", "That request type is not accepted.")
    big = b'{"number":1,"p":"' + b"x" * BODY_LIMIT + b'"}'
    refused(req(base, "POST", "/api/holds", headers={"Content-Type": "application/json"}, content=big), 413, "body_too_large", "That request is too large.")
    exact = b'{"number":0,"p":"' + b"x" * (BODY_LIMIT - 20) + b'"}'
    assert len(exact) <= BODY_LIMIT
    assert req(base, "POST", "/api/holds", headers={"Content-Type": "application/json"}, content=exact).status_code != 413
    climbing = req(base, "GET", "/%2e%2e/%2e%2e/package.json")
    refused(climbing, 404, "not_found")
    for path in ("/package.json", "/.env", "/run.json"):
        assert SOURCE_MARKER not in req(base, "GET", path).text
    health = req(base, "GET", "/api/health")
    assert health.json() == {"status": "ok"}
    assert CORS_HEADER not in health.headers
    page_text = req(base, "GET", "/").text
    for name in ("KILLBILL_PASSWORD", "AUTH_CLIENT_SECRET", "S3_SECRET_ACCESS_KEY", "SVIX_API_KEY"):
        value = os.environ.get(name)
        if value:
            assert value not in page_text


def test_outage_valkey_instance(browser):
    base = inst("APP_VALKEY_DOWN_URL")
    copy = "Sales are paused because the shelf cannot be reached. The tale is still here."
    assert req(base, "GET", "/api/health").json() == {"status": "ok"}
    shelf = req(base, "GET", "/api/shelf").json()
    assert shelf["salesPaused"] is True and len(shelf["boxes"]) == EDITION
    refused(req(base, "POST", "/api/holds", json={"number": 1}), 503, "sales_paused", copy)
    refused(req(base, "GET", "/api/holds/1", headers={"X-Hold-Token": "x"}), 503, "sales_paused", copy)
    refused(req(base, "DELETE", "/api/holds/1", headers={"X-Hold-Token": "x"}), 503, "sales_paused", copy)
    last = None
    for _ in range(LOOKUP_TRIES + 1):
        last = req(base, "POST", "/api/orders/lookup", json={"reference": "LB-NOSUCH", "email": "no@example.test"})
    refused(last, 429, "lookup_limited", "Too many tries. Please wait before trying again.")
    assert int(last.headers["retry-after"]) > 0
    with visitor(browser, base) as page:
        open_shelf(page, base)
        expect(page.get_by_role("alert", name="Sales banner")).to_have_text(copy)


class Relay:

    def __init__(self, port: int, target: tuple[str, int]) -> None:
        self.port, self.target = port, target
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    def start(self) -> None:
        self.listener.bind(("127.0.0.1", self.port))
        self.listener.listen()
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        for _ in range(ACCEPTS):
            try:
                near, _peer = self.listener.accept()
            except OSError:
                return
            far = socket.create_connection(self.target)
            threading.Thread(target=self._pump, args=(near, far), daemon=True).start()
            threading.Thread(target=self._pump, args=(far, near), daemon=True).start()

    @staticmethod
    def _pump(source: socket.socket, sink: socket.socket) -> None:
        for _ in range(PUMP_CHUNKS):
            try:
                data = source.recv(65536)
                if not data:
                    break
                sink.sendall(data)
            except OSError:
                break

    def stop(self) -> None:
        with contextlib.suppress(OSError):
            self.listener.shutdown(socket.SHUT_RDWR)
        self.listener.close()


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), APP_PUBLIC_URL=base, **overrides)
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log:
        process = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

        def healthy() -> bool:
            if process.poll() is not None:
                log.seek(0)
                pytest.fail(f"the app copy exited at boot with a service down:\n{log.read()[-2000:]}")
            with contextlib.suppress(httpx.HTTPError):
                return req(base, "GET", "/api/health").status_code == 200
            return False

        try:
            poll("GET /api/health answered on a copy booted with Valkey down", healthy, BOOT_SECONDS, 0.5)
            yield base
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=10)
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)


def test_outage_valkey_resumes():
    target = urlsplit(os.environ["VALKEY_URL"])
    port = free_port()
    userinfo = target.netloc.rsplit("@", 1)[0] + "@" if "@" in target.netloc else ""
    relayed = urlunsplit(target._replace(netloc=f"{userinfo}127.0.0.1:{port}"))
    relay = Relay(port, (target.hostname, target.port or VALKEY_DEFAULT_PORT))
    overrides = {"VALKEY_URL": relayed, "DATABASE_URL": os.environ["DATABASE_URL"] + "_valkey",
                 "S3_BUCKET": os.environ["S3_BUCKET"] + "-valkey", "PRESS_NAMESPACE": "valkey"}
    try:
        with app_copy(overrides) as base:
            poll("salesPaused was true with Valkey down", lambda: req(base, "GET", "/api/shelf").json()["salesPaused"] is True)
            refused(req(base, "POST", "/api/holds", json={"number": 1}), 503, "sales_paused")
            with ShelfStream(base) as stream:
                relay.start()
                poll("salesPaused cleared after Valkey returned", lambda: req(base, "GET", "/api/shelf").json()["salesPaused"] is False, SWEEP + 1, 0.1)
                poll("the stream pushed the sales change", lambda: any(n == "sales" and e.get("salesPaused") is False for n, e in stream.events), PUSH_SECONDS + 1, 0.1)
            hold = take_hold(base)
            assert hold.grant["holdMs"] == HOLD_FULL_MS
            release(base, hold)
    finally:
        relay.stop()


def test_outage_gateway(browser):
    base = inst("APP_WIREMOCK_DOWN_URL")
    copy = "The bank's line is down. Your match keeps burning; try again in a moment."
    assert req(base, "GET", "/api/health").json() == {"status": "ok"}
    name, email = new_buyer()
    hold = take_hold(base)
    refused(attempt(base, hold.token, order_body(hold.number, name, email)), 503, "gateway_unreachable", copy)
    refused(attempt(base, hold.token, order_body(hold.number, name, email, card=None)), 503, "gateway_unreachable", copy)
    after = req(base, "GET", f"/api/holds/{hold.number}", headers={"X-Hold-Token": hold.token}).json()
    assert after["remainingMs"] <= hold.grant["remainingMs"]
    assert box_public_state(base, hold.number) == "held"
    release(base, hold)
    with visitor(browser, base) as page:
        open_shelf(page, base)
        choose_box(page, base)
        to_checkout(page)
        fill_details(page, name, email)
        fill_card(page, CARD_PLAIN)
        assert submit_card(page).status == 503
        expect(checkout_errors(page)).to_have_text(copy)


def test_outage_killbill(browser, wiremock):
    base = inst("APP_KILLBILL_DOWN_URL")
    copy = "We can't record payments right now. Your match keeps burning; try again in a moment."
    assert req(base, "GET", "/api/health").json() == {"status": "ok"}
    name, email = new_buyer()
    hold = take_hold(base)
    before = len(gateway_posts(wiremock, "/v1/authorisations"))
    refused(attempt(base, hold.token, order_body(hold.number, name, email)), 503, "ledger_unreachable", copy)
    assert len(gateway_posts(wiremock, "/v1/authorisations")) == before, "the gateway was called with the ledger down"
    assert req(base, "GET", f"/api/holds/{hold.number}", headers={"X-Hold-Token": hold.token}).status_code == 200
    release(base, hold)
    with visitor(browser, base) as page:
        open_shelf(page, base)
        choose_box(page, base)
        to_checkout(page)
        fill_details(page, name, email)
        fill_card(page, CARD_PLAIN)
        assert submit_card(page).status == 503
        expect(checkout_errors(page)).to_have_text(copy)


def test_outage_gotenberg(browser):
    base = inst("APP_GOTENBERG_DOWN_URL")
    copy = "The PDF service is down. No statement was issued; try again shortly."
    treasurer = staff(browser, base, "treasurer")
    before = req(base, "GET", "/api/staff/statements", headers=treasurer).json()["statements"]
    refused(req(base, "POST", "/api/staff/statements", headers=treasurer, json={"month": EMPTY_MONTH}), 503, "pdf_unreachable", copy)
    assert req(base, "GET", "/api/staff/statements", headers=treasurer).json()["statements"] == before
    with visitor(browser, base) as page:
        staff_login(page, base, "treasurer")
        page.goto(base + "/staff/statements")
        fill(page.get_by_role("textbox", name="Month", exact=True), EMPTY_MONTH)
        click(page.get_by_role("button", name="Issue statement"))
        expect(staff_status(page)).to_have_text(copy)


def test_outage_minio(browser):
    base = inst("APP_MINIO_DOWN_URL")
    assert req(base, "GET", "/api/health").json() == {"status": "ok"}
    refused(req(base, "POST", "/api/staff/statements", headers=staff(browser, base, "treasurer"), json={"month": EMPTY_MONTH}), 503, "storage_unreachable")
    order = captured(browser, base)
    assert view(base, order)["paymentState"] == "captured"
    assert certificate(base, order).status_code != 200
    assert view(base, order)["certificate"]["state"] != "issued"


def test_outage_svix(browser):
    base = inst("APP_SVIX_DOWN_URL")
    copy = "Delivery state cannot be read right now. Events are kept and will be sent."
    treasurer = staff(browser, base, "treasurer")
    refused(req(base, "GET", "/api/staff/deliveries", headers=treasurer), 503, "deliveries_unreachable", copy)
    assert issue_statement(browser, base, EMPTY_MONTH)["month"] == EMPTY_MONTH
    with visitor(browser, base) as page:
        staff_login(page, base, "treasurer")
        page.goto(base + "/staff/statements")
        expect(staff_status(page)).to_have_text(copy)


def test_outage_ntfy(browser):
    base = inst("APP_NTFY_DOWN_URL")
    order = place(base, card=CARD_CAPFAIL)
    response = pack(browser, base, order.reference)
    refused(response, 402, "capture_refused", f"The card could not be captured for box {order.number}. Try packing again.")
    assert response.json()["paymentState"] == "capture_failed" and response.json()["boxState"] == "claimed"
    with visitor(browser, base) as page:
        staff_login(page, base, "packer")
        page.goto(base + "/staff/packing")
        expect(staff_status(page)).to_have_text("Phone alerts are waiting to be sent.")


NOTICES = Path("/app/THIRD_PARTY_NOTICES.md")
FONTS = ("Gloock", "Newsreader")
ALLOWLIST = {"MIT", "Apache-2.0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "OFL", "OFL-1.1", "OFL-1.1-RFN"}
OTHER_DATASTORES = {"sqlite3", "better-sqlite3", "mysql", "mysql2", "mongodb", "mongoose", "nedb", "lowdb", "level", "cassandra-driver", "couchbase", "neo4j-driver"}


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest[field], str) and manifest[field]


def test_if_notices_list_packages():
    notices = NOTICES.read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == []


def test_if_licences_allowed():
    denied = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert denied == []
    notices = NOTICES.read_text()
    lowered = notices.lower()
    missing = [font for font in FONTS if font.lower() not in lowered]
    assert missing == []


def test_if_no_other_datastores():
    assert sorted(OTHER_DATASTORES & {p.name for p in shipped_packages()}) == []


def test_if_seeded_config_untouched(browser, app_url):
    base = app_url.rstrip("/")
    for role in PASSWORDS:
        me = req(base, "GET", "/api/staff/me", headers=staff(browser, base, role)).json()
        assert me["username"] == role and role in me["roles"]


def test_if_narration_files():
    found = {p.name for p in Path("/app").rglob("*.ogg") if "node_modules" not in p.parts}
    assert {f"{chapter}.ogg" for chapter in CHAPTERS} <= found
    assert "narration" in NOTICES.read_text().lower()


def test_if_same_origin_only(browser, app_url):
    base = app_url.rstrip("/")
    foreign: list[str] = []

    def watch(request: Any) -> None:
        if request.url.startswith(("http:", "https:")) and not same_origin(request.url, base):
            foreign.append(request.url)

    with visitor(browser, base) as page:
        page.on("request", watch)
        page.reload()
        expect(page.get_by_role("main")).to_be_visible()
        open_shelf(page, base)
        hold = choose_box(page, base)
        to_checkout(page)
        release(base, hold)
    assert foreign == []
