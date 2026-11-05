from __future__ import annotations

import concurrent.futures
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, unquote, urljoin, urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    PocketBase,
    S3,
    addresses,
    advance,
    camera,
    check,
    click,
    decode,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    scene_frames,
    select,
    session,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    unique,
)
from conftest import text as mail_text


HTTP_TIMEOUT_S = 40
POLL_S = 0.5
PROVIDER_SLACK_S = 15
LATENCY_S = 3
UI_WAIT_S = 25
STEP_MS = 100
FRAME_MS = 50
TAB_LIMIT = 60
TRAP_PRESSES = 12
BOOT_WAIT_S = 180
DUNNING_WAIT_S = 240
SHORT_DUNNING_DAY_S = "5"
DUNNING_COPY_ADDRESS = "dunning-copies@pampero.test"
DUNNING_COPY_FROM = f"Pampero Build Co. <{DUNNING_COPY_ADDRESS}>"
PRICE_LEAD_S = 15
CLOCK_SKEW_S = 10
MATRIX_TOL = 1e-3
GEOMETRY_TOL = 2
TURN_TOL_DEG = 2

MAIL_DELAY_S = 30
MAIL_WAIT_S = MAIL_DELAY_S + PROVIDER_SLACK_S
PDF_DELAY_S = 30
CMS_DELAY_S = 5
RECOVERY_S = 30
HEALTH_BUDGET_S = 2
QUOTE_BUDGET_S = 1
DOWNLOAD_LINK_S = 60
PLAN_REFRESH_MS = 15000
FOLD_FLAT_BY_MS = 400
CREASE_BY_MS = 600
COUNT_BY_MS = 1600
TILT_OPEN = 18
OPEN_EARLY_MS = 200
OPEN_BY_MS = 1500
OPEN_SLACK_S = 1.0
LIFT_MIN_MS = 300
LIFT_RUNNING_JS = ("least => document.getAnimations().some(a => a.playState === 'running' && a.effect"
                   " && a.effect.getComputedTiming().duration >= least && (!window.__beforeOpen || !window.__beforeOpen.has(a)"
                   " || /^::view-transition-group\\((?!root\\))/.test(a.effect.pseudoElement || '')))")
REDUCED_OPEN_MS = 100
DIALOG_SETTLE_MS = 400
CATCHUP_MS = 600
HOLD_MS = 2000
TURN_MIN_S = 30
TURN_MAX_S = 45
TURN_PROBE_MS = 6000
UPLOAD_THROTTLE_BPS = 2_000_000
FILE_SET_TIMEOUT_MS = 60_000
SCROLL_STEPS = 24
MAX_FILE_BYTES = 10_000_000
JSON_LIMIT = 65_536
NAME_MAX = 120

VIEWPORTS = {
    "375": (375, 812),
    "768": (768, 1024),
    "1280": (1280, 800),
}

SESSION_COOKIE = "pampero_session"
CENT = Decimal("0.01")
DEPOSIT_RATE = Decimal("0.40")
KB_SUCCESS = "SUCCESS"
ZONE = "America/Argentina/Buenos_Aires"
EXTERNAL_PLUGIN = "__EXTERNAL_PAYMENT__"

STUDIO = ("ines@pampero.test", "pampero-owner-2026")
TOMAS = ("tomas@pampero.test", "pampero-contractor-1")
DANA = ("dana@pampero.test", "pampero-contractor-2")
MARIELA = ("mariela@yerbanorte.test", "client-owner-ars-1")
RAMIRO = ("ramiro@lumen.test", "client-owner-ars-2")
LUCIA = ("lucia@panaderiasur.test", "client-owner-ars-3")
NOAH = ("noah@quillfern.test", "client-owner-usd-3")
BRUNO = ("bruno@yerbanorte.test", "client-team-ars-1")

USD_PRICES = {"launch-page": "1849.99", "studio-site": "4999.99", "care-lite": "149.00", "care-plus": "349.00"}
PLAN_NAMES = {"launch-page": "Launch Page", "studio-site": "Studio Site", "care-lite": "Care Lite", "care-plus": "Care Plus"}
CARE_PLANS = {"care-lite", "care-plus"}
PANADERIA_RENEWAL = ("PB-0005", "449999.99")

PUBLISHED_CASES = ["mate-route", "atelier-ombu", "lanchas-del-delta", "norte-cycling-club"]
UNPUBLISHED_CASES = ["bodega-lince", "cafe-ruta-40"]
CASE_TITLES = {"mate-route": "Mate Route", "atelier-ombu": "Atelier Ombú", "lanchas-del-delta": "Lanchas del Delta",
               "norte-cycling-club": "Norte Cycling Club", "bodega-lince": "Bodega Lince", "cafe-ruta-40": "Café Ruta 40"}
JOURNAL_POSTS = {"pricing-in-two-currencies": "Pricing in two currencies", "what-a-care-plan-covers": "What a care plan covers"}

NOT_FOUND_HEADING = "We couldn't find that page."
ACCESS_ENDED_HEADING = "Your access to this project ended when it closed."
BILLING_OUTAGE_COPY = "We can't reach billing right now. Nothing was charged, and your details are still here. Try Pay again in a few minutes."
STORAGE_PAY_COPY = "We couldn't open your project folder, so the payment was cancelled and nothing was charged. Try again in a few minutes."
DECLINED_COPY = "Your card was declined. Nothing was charged."
QUOTE_OUTAGE_COPY = "Live pricing is offline. Try again in a moment."
PRICE_CHANGED_COPY = "Prices changed since your quote. Review the new total before accepting."
PREVIEW_EXPIRED_COPY = "This preview expired. Open the change again for fresh figures."
PREVIEW_STALE_COPY = "Billing moved on since your preview. Review the updated figures."
PLAN_READ_OUTAGE_COPY = "Billing is unreachable, so we can't show your plan status right now."
PAST_DUE_COPY = "Your last care-plan payment failed. Update your card to keep your plan."
CARD_PAID_COPY = "Payment received. Your plan is active."
STORAGE_UPLOAD_COPY = "File storage is unavailable. Your file was not uploaded. Try again in a minute."
NAME_REFUSED_COPY = "That file name can't be stored. Rename the file and try again."
LINK_EXPIRED_COPY = "This download link expired. Press Download again."
SIGN_IN_ERROR_COPY = "Email or password is incorrect."
ALLOWLIST_SENTENCE = "Accepted: PNG, JPEG, WebP, SVG, PDF, WOFF2, OTF and TTF, up to 10 MB each."
EXISTING_SIGN_IN_COPY = "This person already has a Pampero Ledger sign-in."
QUOTING = "Quoting…"
PRORATING = "Working out your proration…"
CONFIRMING = "Confirming with billing…"
PROCESSING = "Processing payment…"
PLAN_ACTIVE_AGAIN = "Your plan is active again."
ACCEPT_BOX = "I accept the scope and price in this quote"

PASSWORD = "lantern-ledger-77"
REFUND_FIRST = Decimal("100.00")
REFUND_RACE = Decimal("400.00")
DATASTORES = ("SQLite", "Redis")
EXPIRY = "12/39"
CVC = "123"
CARD_OK = {"number": "4242 4242 4242 4242", "expiry": EXPIRY, "cvc": CVC}
CARD_DECLINE = {"number": "4000 0000 0000 0002", "expiry": EXPIRY, "cvc": CVC}

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 64 + b"\xff\xd9"
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 \x18\x00\x00\x00" + b"\x00" * 32
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
WOFF2 = b"wOF2\x00\x01\x00\x00" + b"\x00" * 40
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'
EXE = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00" + b"\x00" * 128


def money(amount: str | Decimal, currency: str) -> str:
    value = Decimal(str(amount)).quantize(CENT)
    sign = "-" if value < 0 else ""
    whole, cents = f"{abs(value):.2f}".split(".")
    grouped = f"{int(whole):,}"
    if currency == "USD":
        return f"{sign}USD {grouped}.{cents}"
    return f"{sign}ARS {grouped.replace(',', '.')},{cents}"


AMOUNT_RE = re.compile(r"(-?)(USD|ARS) (\d[\d.,]*\d|\d)")


def amounts_in(value: str) -> list[Decimal]:
    out = []
    for sign, currency, digits in AMOUNT_RE.findall(value):
        plain = digits.replace(",", "") if currency == "USD" else digits.replace(".", "").replace(",", ".")
        out.append(Decimal(sign + plain))
    return out


def dec(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(CENT)


def two_decimals(value: str) -> bool:
    return isinstance(value, str) and re.fullmatch(r"-?\d+\.\d{2}", value) is not None


def long_date(iso: str) -> str:
    d = date.fromisoformat(iso[:10])
    return f"{d.day} {d.strftime('%B')} {d.year}"


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value)


def base_of(env: str) -> str:
    return os.environ[env].rstrip("/")


KB_DOWN = "APP_KILLBILL_DOWN_URL"
MINIO_DOWN = "APP_MINIO_DOWN_URL"
MAIL_DOWN = "APP_MAILPIT_DOWN_URL"
SHORT = "APP_SHORT_URL"


def client(base: str, cookie: str | None = None) -> httpx.Client:
    http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    if cookie:
        http.cookies.set(SESSION_COOKIE, cookie)
    return http


def signed_in(base: str, email: str, password: str) -> httpx.Client:
    http = client(base)
    r = http.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return http


def studio(base: str) -> httpx.Client:
    return signed_in(base, *STUDIO)


def me(http: httpx.Client) -> dict[str, Any]:
    r = http.get("/api/me")
    assert r.status_code == 200, r.text
    return r.json()["user"]


def keyed(key: str | None = None) -> dict[str, str]:
    return {"Idempotency-Key": key or idempotency_key()}


def error_of(r: httpx.Response) -> str:
    return r.json().get("error")


def identity(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    email, tag = (first, second) if "@" in first else (second, first)
    tag = re.sub(r"[^A-Za-z0-9-]", "", tag)[:40] or uuid.uuid4().hex[:12]
    return tag, email


def link_path(url: str) -> str:
    parts = urlsplit(url)
    return parts.path + (f"?{parts.query}" if parts.query else "")


def eventually(probe: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    last: Any = None
    while True:
        last = probe()
        if last:
            return last
        if time.monotonic() >= deadline:
            raise AssertionError(f"{what} not observed within {seconds}s (last: {last!r})")
        pause.wait(POLL_S)


def together(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(run, fn) for fn in calls]
        return [f.result() for f in futures]


def server_now(base: str) -> datetime:
    r = client(base).get("/api/clock")
    assert r.status_code == 200, r.text
    return instant(r.json()["now"])


def wait_past(base: str, iso: str, what: str) -> None:
    target = instant(iso)
    eventually(lambda: server_now(base) > target, PRICE_LEAD_S + PROVIDER_SLACK_S, what)


@dataclass
class Owner:
    http: httpx.Client
    base: str
    email: str
    business: str
    name: str
    account_id: str

    @property
    def cookie(self) -> str:
        return self.http.cookies[SESSION_COOKIE]

    def clone(self, base: str | None = None) -> httpx.Client:
        return client(base or self.base, self.cookie)


def new_order(http: httpx.Client, plan: str, currency: str) -> dict[str, Any]:
    r = http.post("/api/orders", json={"plan": plan, "currency": currency})
    assert r.status_code == 201, r.text
    return r.json()


def account_body(prefix: str = "owner") -> dict[str, Any]:
    tag, email = identity(prefix)
    return {"businessName": f"{tag} Estudio", "name": f"{tag} Owner", "email": email,
            "password": PASSWORD, "acceptTerms": True}


def new_owner(base: str, plan: str, currency: str) -> tuple[Owner, dict[str, Any]]:
    http = client(base)
    order = new_order(http, plan, currency)
    body = account_body()
    r = http.post(f"/api/orders/{order['id']}/accept", json=body)
    assert r.status_code == 200, r.text
    accepted = r.json()
    owner = Owner(http, base, body["email"], body["businessName"], body["name"], accepted["user"]["accountId"])
    return owner, accepted["order"]


def pay(http: httpx.Client, order_id: str, card: dict[str, str] | None = None, key: str | None = None) -> httpx.Response:
    return http.post(f"/api/orders/{order_id}/pay", json={"card": card or CARD_OK}, headers=keyed(key))


def paid_owner(base: str, plan: str, currency: str) -> tuple[Owner, dict[str, Any]]:
    owner, order = new_owner(base, plan, currency)
    r = pay(owner.http, order["id"])
    assert r.status_code == 201, r.text
    return owner, r.json()["order"]


def another_paid(owner: Owner, plan: str, currency: str) -> dict[str, Any]:
    order = new_order(owner.http, plan, currency)
    r = owner.http.post(f"/api/orders/{order['id']}/accept", json={"acceptTerms": True})
    assert r.status_code == 200, r.text
    r = pay(owner.http, order["id"])
    assert r.status_code == 201, r.text
    return r.json()["order"]


def move(staff: httpx.Client, order_id: str, to: str) -> httpx.Response:
    return staff.post(f"/api/studio/orders/{order_id}/transitions", json={"to": to})


def to_balance_invoiced(base: str, order: dict[str, Any]) -> httpx.Client:
    staff = studio(base)
    for to in ("in_build", "balance_invoiced"):
        r = move(staff, order["id"], to)
        assert r.status_code == 200, r.text
        assert r.json()["state"] == to
    return staff


def plan_price(base: str, plan: str, currency: str) -> Decimal:
    r = client(base).get("/api/plans", params={"currency": currency})
    assert r.status_code == 200, r.text
    return Decimal(next(p for p in r.json()["plans"] if p["plan"] == plan)["amount"])


def raise_price(base: str, plan: str, by: str) -> Decimal:
    new = plan_price(base, plan, "ARS") + Decimal(by)
    r = studio(base).post("/api/studio/prices", json={"plan": plan, "currency": "ARS", "amount": f"{new:.2f}"})
    assert r.status_code == 201, r.text
    return new


def upload(http: httpx.Client, project_id: str, kind: str, name: str, data: bytes,
           declared: str = "application/octet-stream") -> httpx.Response:
    return http.post(f"/api/projects/{project_id}/{kind}", files={"file": (name, data, declared)})


def contractor_id(base: str, email: str) -> str:
    r = studio(base).get("/api/studio/contractors")
    assert r.status_code == 200, r.text
    return next(c["id"] for c in r.json()["contractors"] if c["email"] == email)


def assign(base: str, project_id: str, email: str) -> None:
    r = studio(base).post(f"/api/studio/projects/{project_id}/assignments", json={"contractorId": contractor_id(base, email)})
    assert r.status_code in (200, 201), r.text


def issue_link(http: httpx.Client, file_id: str) -> httpx.Response:
    return http.post(f"/api/files/{file_id}/links", json={})


def kb_account(killbill: Any, account_id: str) -> dict[str, Any] | None:
    return killbill.account_by_key(f"pampero-{account_id}")


def kb_id(killbill: Any, account_id: str) -> str:
    account = kb_account(killbill, account_id)
    assert account, f"no Kill Bill account pampero-{account_id}"
    return account["accountId"]


def kinds(payment: dict[str, Any]) -> list[str]:
    return [t["transactionType"] for t in payment.get("transactions", [])]


def succeeded(killbill: Any, kb_account_id: str, kind: str) -> list[dict[str, Any]]:
    return [t for p in killbill.payments(kb_account_id) for t in p.get("transactions", [])
            if t.get("transactionType") == kind and t.get("status") == KB_SUCCESS]


def invoices_with(killbill: Any, kb_account_id: str, description: str) -> list[dict[str, Any]]:
    return [inv for inv in killbill.invoices(kb_account_id)
            if any(item.get("description") == description for item in inv.get("items", []))]


def unbilled(killbill: Any, account_id: str) -> bool:
    account = kb_account(killbill, account_id)
    return account is None or (not killbill.payments(account["accountId"]) and not killbill.invoices(account["accountId"]))


def care_subscription(killbill: Any, kb_account_id: str) -> dict[str, Any]:
    subs = killbill.subscriptions(kb_account_id)
    assert subs, "no Kill Bill subscription"
    return subs[-1]


def inbox(mail: Any, email: str, subject: str | None = None, prefix: str | None = None) -> list[dict[str, Any]]:
    found = []
    for message in mail.messages(settle=1.0):
        if email.lower() not in [a.lower() for a in addresses(message.get("To"))]:
            continue
        title = message.get("Subject", "")
        if subject is not None and title != subject:
            continue
        if prefix is not None and not title.startswith(prefix):
            continue
        found.append(message)
    return found


def wait_mail(mail: Any, email: str, subject: str | None = None, prefix: str | None = None,
              count: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    eventually(lambda: len(inbox(mail, email, subject, prefix)) >= count, seconds,
               f"{count} message(s) to {email} {subject or prefix or ''}")
    return inbox(mail, email, subject, prefix)


def invite_token(mail: Any, email: str) -> str:
    message = wait_mail(mail, email, prefix="Join ")[-1]
    match = re.search(r"/invite/([A-Za-z0-9_\-.~%]+)", mail_text(message))
    assert match, mail_text(message)
    return match.group(1)


def norm(value: str) -> str:
    return " ".join(value.split())


def text_of(locator: Locator) -> str:
    return norm(" ".join(locator.all_text_contents()))


def shows(locator: Locator, expected: str) -> bool:
    return "".join(expected.split()) in "".join(text_of(locator).split())


VISIBLE_JS = """el => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
  for (let e = el; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.99) return false;
  }
  return true;
}"""


def on_screen(locator: Locator) -> bool:
    return locator.count() > 0 and bool(locator.first.evaluate(VISIBLE_JS))


def focused(locator: Locator) -> bool:
    return locator.count() > 0 and bool(locator.first.evaluate("e => e === document.activeElement"))


def wait_ui(page: Page, ok: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            if ok():
                return
        except PlaywrightError:
            pass
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        advance(page, STEP_MS)


def wait_text(page: Page, locator: Locator, expected: str, seconds: float = UI_WAIT_S) -> None:
    wait_ui(page, lambda: text_of(locator) == expected, f"{expected!r} (now {text_of(locator)!r})", seconds)


def path_of(page: Page) -> str:
    return urlsplit(page.url).path


@contextmanager
def browse(browser: Browser, base: str, path: str, *, cookie: str | None = None,
           size: tuple[int, int] = (1280, 800), **options: Any) -> Iterator[Page]:
    with open_app(browser, f"{base}/api/clock", **options) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if cookie:
            page.context.add_cookies([{"name": SESSION_COOKIE, "value": cookie, "url": base}])
        page.goto(f"{base}{path}")
        yield page


def page_cookie(page: Page) -> str:
    return next(c["value"] for c in page.context.cookies() if c["name"] == SESSION_COOKIE)


def browser_order(page: Page, base: str, plan: str, currency: str) -> dict[str, Any]:
    r = page.request.post(f"{base}/api/orders", data={"plan": plan, "currency": currency})
    assert r.status == 201, r.text()
    return r.json()


FOCUS_ROLES = ("link", "button", "radio", "checkbox", "textbox", "combobox", "switch", "tab", "menuitem", "option",
               "slider", "spinbutton")


def focused_named(page: Page, name: str) -> bool:
    return any(page.get_by_role(role, name=name, exact=True).evaluate_all("els => els.includes(document.activeElement)")
               for role in FOCUS_ROLES)


def radio_point(radio: Locator) -> tuple[float, float]:
    expect(radio).to_be_visible()
    expect(radio).to_be_enabled()
    point = radio.evaluate("""e => {
      e.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
      const reach = t => { const r = t.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, y); return hit && (hit === t || t.contains(hit)) ? {x, y} : null; };
      return reach(e) || [...(e.labels || [])].map(reach).find(Boolean) || null; }""")
    assert point, "radio and its label are obscured at the actual pointer target"
    return point["x"], point["y"]


def choose(radio: Locator) -> None:
    radio.page.mouse.click(*radio_point(radio))
    expect(radio).to_be_checked()


def tap_choice(radio: Locator) -> None:
    radio.page.touchscreen.tap(*radio_point(radio))
    expect(radio).to_be_checked()


def tab_to(page: Page, name: str, limit: int = TAB_LIMIT) -> list[str]:
    seen = []
    for _ in range(limit):
        current = tab_order(page, 1)[0]
        seen.append(current)
        if current == name or focused_named(page, name):
            return seen
    raise AssertionError(f"Tab never reached {name!r}: {seen}")


class Traffic:

    def __init__(self, page: Page) -> None:
        self.page = page
        self.pending: set[Any] = set()
        page.on("request", lambda request: self.pending.add(request))
        page.on("requestfinished", lambda request: self.pending.discard(request))
        page.on("requestfailed", lambda request: self.pending.discard(request))

    def quiet(self, seconds: float = UI_WAIT_S) -> None:
        deadline = time.monotonic() + seconds
        while self.pending:
            if time.monotonic() > deadline:
                raise AssertionError(f"requests still pending: {[r.url for r in self.pending]}")
            self.page.evaluate("0")
        self.page.evaluate("0")


def follow_link_to(page: Page, path: str) -> bool:
    links = page.get_by_role("link")
    for i in range(links.count()):
        handle = links.nth(i).element_handle()
        if handle and handle.is_visible() and urlsplit(urljoin(page.url, handle.get_attribute("href") or "")).path == path:
            handle.click()
            return True
    return False


def deck_link(page: Page, title: str) -> Locator:
    return page.get_by_role("list", name="Case studies").get_by_role("link", name=title, exact=True)


def fill_accept(page: Page, body: dict[str, Any]) -> None:
    fill(page.get_by_label("Business name"), body["businessName"])
    fill(page.get_by_label("Your name"), body["name"])
    fill(page.get_by_label("Email", exact=True), body["email"])
    fill(page.get_by_label("Password", exact=True), body["password"])
    check(page.get_by_role("checkbox", name=ACCEPT_BOX))
    click(page.get_by_role("button", name="Accept quote"))
    card = page.get_by_label("Card number")
    wait_ui(page, lambda: card.is_enabled(), "Payment form enabled after acceptance")


def fill_card(page: Page, card: dict[str, str], scope: Page | Locator | None = None) -> None:
    where = scope or page
    fill(where.get_by_label("Card number"), card["number"])
    fill(where.get_by_label("Expiry (MM/YY)"), card["expiry"])
    fill(where.get_by_label("CVC"), card["cvc"])


def sheet(quote: Locator) -> dict[str, Any]:
    def amounts(locator: Locator) -> list[Decimal]:
        return amounts_in(text_of(locator))

    crease = quote.get_attribute("data-crease")
    tilt = quote.get_attribute("data-tilt")
    return {
        "state": quote.get_attribute("data-state"),
        "crease": float(crease) if crease not in (None, "") else None,
        "tilt": float(tilt) if tilt not in (None, "") else None,
        "now": amounts(quote.get_by_role("group", name="Due now")),
        "launch": amounts(quote.get_by_role("group", name="Due at launch")),
        "total": amounts(quote.get_by_text(re.compile(r"^Total\s*-?(USD|ARS) "))),
    }


def same_matrices(a: list[list[float]], b: list[list[float]]) -> bool:
    flat_a = [v for m in a for v in m]
    flat_b = [v for m in b for v in m]
    return len(flat_a) == len(flat_b) and all(abs(x - y) <= MATRIX_TOL for x, y in zip(flat_a, flat_b))


def assert_not_found_page(page: Page, response: Any) -> None:
    assert response is not None and response.status == 404, response and response.status
    expect(page.get_by_role("heading", name=NOT_FOUND_HEADING, exact=True)).to_be_visible()


def hidden_or_gone(locator: Locator) -> bool:
    return not on_screen(locator)


def free_port() -> int:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    return port


class Relay:

    def __init__(self, target: str) -> None:
        parts = urlsplit(target)
        self.scheme, self.path = parts.scheme, parts.path
        self.host = parts.hostname or "127.0.0.1"
        self.target_port = parts.port or (443 if parts.scheme == "https" else 80)
        self.port = free_port()
        self.listener: socket.socket | None = None

    @property
    def url(self) -> str:
        return urlunsplit((self.scheme, f"127.0.0.1:{self.port}", self.path, "", ""))

    def start(self) -> None:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen(64)
        self.listener = listener
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        assert self.listener is not None
        while True:
            try:
                inbound, _ = self.listener.accept()
            except OSError:
                return
            try:
                outbound = socket.create_connection((self.host, self.target_port))
            except OSError:
                inbound.close()
                continue
            for a, b in ((inbound, outbound), (outbound, inbound)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(source: socket.socket, sink: socket.socket) -> None:
        try:
            while data := source.recv(65536):
                sink.sendall(data)
        except OSError:
            pass
        finally:
            for s in (source, sink):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                s.close()

    def stop(self) -> None:
        if self.listener is not None:
            try:
                self.listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.listener.close()
            self.listener = None


def manifest() -> dict[str, Any]:
    deployed = Path(DEPLOYED_APP) / "run.json"
    return json.loads((deployed if deployed.exists() else Path("/app/run.json")).read_text())


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[tuple[str, Callable[[], str]]]:
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile(prefix="pampero-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest()["serve"], shell=True, cwd=str(DEPLOYED_APP), env=env,
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    def healthy() -> bool:
        assert proc.poll() is None, f"app copy exited with {proc.returncode}:\n{tail()}"
        try:
            return httpx.get(f"{base}/api/health", timeout=HEALTH_BUDGET_S).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        eventually(healthy, BOOT_WAIT_S, f"app copy health; log tail:\n{tail()}")
        yield base, tail
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=PROVIDER_SLACK_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


def test_published_work_and_journal(browser: Browser, app_url: str) -> None:
    http = client(app_url)
    pb = PocketBase()
    for path, kind, seeded in (("/api/case-studies", "case_study", PUBLISHED_CASES),
                               ("/api/journal", "journal", list(JOURNAL_POSTS))):
        r = http.get(path)
        assert r.status_code == 200, r.text
        entries = r.json()["entries"]
        slugs = [e["slug"] for e in entries]
        positions = [slugs.index(s) for s in seeded]
        assert positions == sorted(positions), slugs
        stamps = [instant(e["publishedAt"]) if "T" in e["publishedAt"] else datetime.fromisoformat(e["publishedAt"] + "T00:00:00-03:00") for e in entries]
        assert stamps == sorted(stamps, reverse=True), "newest first"
        published = {rec["slug"] for rec in pb.records("entries", f"kind='{kind}' && status='published'")}
        assert set(slugs) <= published | set(), (slugs, published)
        assert set(seeded) <= published
    for slug in UNPUBLISHED_CASES:
        assert slug not in [e["slug"] for e in http.get("/api/case-studies").json()["entries"]]
        assert http.get(f"/api/case-studies/{slug}").status_code == 404
    newest = PUBLISHED_CASES[0]
    detail = http.get(f"/api/case-studies/{newest}")
    assert detail.status_code == 200 and detail.json()["title"] == CASE_TITLES[newest] and detail.json()["body"]

    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        wait_ui(page, lambda: deck_link(page, CASE_TITLES["norte-cycling-club"]).count() == 1, "deck renders")
        links = [deck_link(page, CASE_TITLES[s]) for s in PUBLISHED_CASES]
        for earlier, later in zip(links, links[1:]):
            assert earlier.evaluate("(a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)", later.element_handle())
        for slug in UNPUBLISHED_CASES:
            assert deck_link(page, CASE_TITLES[slug]).count() == 0
        click(deck_link(page, "Atelier Ombú"))
        wait_ui(page, lambda: path_of(page) == "/work/atelier-ombu", "case study route")
        expect(page.get_by_role("heading", level=1, name="Atelier Ombú")).to_be_visible()

        page.goto(f"{app_url}/journal")
        posts = page.get_by_role("list", name="Journal posts")
        first = posts.get_by_role("link", name=JOURNAL_POSTS["pricing-in-two-currencies"])
        second = posts.get_by_role("link", name=JOURNAL_POSTS["what-a-care-plan-covers"])
        wait_ui(page, lambda: first.count() == 1 and second.count() == 1, "journal list renders")
        assert first.evaluate("(a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)", second.element_handle())
        click(first)
        wait_ui(page, lambda: path_of(page) == "/journal/pricing-in-two-currencies", "journal post route")
        expect(page.get_by_role("heading", name=JOURNAL_POSTS["pricing-in-two-currencies"])).to_be_visible()

    def precedes(a: Locator, b: Locator) -> bool:
        return bool(a.evaluate("(a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)", b.element_handle()))

    staff = studio(app_url)
    tag = uuid.uuid4().hex[:10]
    fresh: dict[str, dict[str, Any]] = {}
    created: list[str] = []
    try:
        for kind, path, seeded in (("case_study", "/api/case-studies", PUBLISHED_CASES),
                                   ("journal", "/api/journal", list(JOURNAL_POSTS))):
            slug = f"fresh-{kind.replace('_', '-')}-{tag}"
            body = {"kind": kind, "slug": slug, "title": f"Fresh {kind.replace('_', ' ')} {tag}", "client": "Verifier Co.",
                    "year": 2026, "summary": "A verifier entry.", "body": "Verifier body copy."}
            r = staff.post("/api/studio/entries", json=body)
            assert r.status_code == 201, r.text
            created.append(r.json()["id"])
            r = staff.post(f"/api/studio/entries/{created[-1]}/publish")
            assert r.status_code == 200, r.text
            fresh[kind] = body

            def ahead(path: str = path, slug: str = slug, seeded: list[str] = seeded) -> bool:
                slugs = [e["slug"] for e in http.get(path).json()["entries"]]
                return slug in slugs and all(s in slugs and slugs.index(slug) < slugs.index(s) for s in seeded)

            eventually(ahead, CMS_DELAY_S + LATENCY_S, f"fresh {kind} listed ahead of the seeded entries")
            assert slug in {rec["slug"] for rec in pb.records("entries", f"kind='{kind}' && status='published'")}

        with browse(browser, app_url, "/", reduced_motion="reduce") as page:
            fresh_card = deck_link(page, fresh["case_study"]["title"])
            wait_ui(page, lambda: fresh_card.count() == 1 and deck_link(page, "Mate Route").count() == 1, "fresh card in the deck")
            assert precedes(fresh_card, deck_link(page, "Mate Route")), "fresh case study not newest first in the deck"
            page.goto(f"{app_url}/journal")
            posts = page.get_by_role("list", name="Journal posts")
            fresh_post = posts.get_by_role("link", name=fresh["journal"]["title"])
            seeded_post = posts.get_by_role("link", name=JOURNAL_POSTS["pricing-in-two-currencies"])
            wait_ui(page, lambda: fresh_post.count() == 1 and seeded_post.count() == 1, "fresh post in the journal")
            assert precedes(fresh_post, seeded_post), "fresh journal post not newest first"
            click(fresh_post)
            wait_ui(page, lambda: path_of(page) == f"/journal/{fresh['journal']['slug']}", "fresh post route")
    finally:
        for entry_id in created:
            staff.post(f"/api/studio/entries/{entry_id}/withdraw")


def test_entry_publishing_lifecycle(browser: Browser, app_url: str) -> None:
    staff = studio(app_url)
    slug = f"verify-{uuid.uuid4().hex[:10]}"
    entry = {"kind": "case_study", "slug": slug, "title": f"Verifier {slug}", "client": "Verifier Co.",
             "year": 2026, "summary": "A verifier case study.", "body": "Verifier body copy."}
    assert signed_in(app_url, *MARIELA).post("/api/studio/entries", json=entry).status_code == 403
    assert staff.post("/api/studio/entries", json={**entry, "slug": "Not A Slug"}).status_code == 422
    r = staff.post("/api/studio/entries", json=entry)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "draft"
    entry_id = r.json()["id"]
    assert staff.post("/api/studio/entries", json=entry).status_code == 422, "slugs are unique"
    pb = PocketBase()
    assert [rec["status"] for rec in pb.records("entries", f"slug='{slug}'")] == ["draft"]

    public = client(app_url)
    listed = lambda: slug in [e["slug"] for e in public.get("/api/case-studies").json()["entries"]]
    r = staff.post(f"/api/studio/entries/{entry_id}/withdraw")
    assert r.status_code == 409 and error_of(r) == "invalid_transition"
    assert public.get(f"/api/case-studies/{slug}").status_code == 404

    r = staff.post(f"/api/studio/entries/{entry_id}/publish")
    assert r.status_code == 200 and r.json()["status"] == "published", r.text
    eventually(listed, CMS_DELAY_S + LATENCY_S, "published entry in the public list")
    assert public.get(f"/api/case-studies/{slug}").status_code == 200
    assert [rec["status"] for rec in pb.records("entries", f"slug='{slug}'")] == ["published"]
    r = staff.post(f"/api/studio/entries/{entry_id}/publish")
    assert r.status_code == 409 and error_of(r) == "invalid_transition"

    r = staff.post(f"/api/studio/entries/{entry_id}/withdraw")
    assert r.status_code == 200 and r.json()["status"] == "withdrawn", r.text
    for action in ("withdraw", "publish"):
        r = staff.post(f"/api/studio/entries/{entry_id}/{action}")
        assert r.status_code == 409 and error_of(r) == "invalid_transition"
    eventually(lambda: not listed() and public.get(f"/api/case-studies/{slug}").status_code == 404,
               CMS_DELAY_S + LATENCY_S, "withdrawn entry gone")
    assert [rec["status"] for rec in pb.records("entries", f"slug='{slug}'")] == ["withdrawn"]
    with browse(browser, app_url, "/") as page:
        wait_ui(page, lambda: deck_link(page, "Mate Route").count() == 1, "deck renders")
        assert deck_link(page, entry["title"]).count() == 0
        assert_not_found_page(page, page.goto(f"{app_url}/work/{slug}"))


def test_case_study_open_motion(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        card = deck_link(page, "Lanchas del Delta")
        wait_ui(page, lambda: card.count() == 1, "deck renders")
        card.scroll_into_view_if_needed()
        card.focus()
        heading = page.get_by_role("heading", level=1, name="Lanchas del Delta")
        page.evaluate("() => { window.__beforeOpen = new WeakSet(document.getAnimations()); }")
        page.keyboard.press("Enter")
        pressed = time.monotonic()
        shown_early, animated = False, False
        while time.monotonic() - pressed < OPEN_EARLY_MS / 1000:
            try:
                shown_early = shown_early or on_screen(heading)
                animated = animated or page.evaluate(LIFT_RUNNING_JS, LIFT_MIN_MS)
            except PlaywrightError:
                continue
        moved = False
        for _ in range(2 if shown_early and not animated else 0):
            try:
                before = heading.first.bounding_box()
                advance(page, FRAME_MS)
                moved = before != heading.first.bounding_box()
                break
            except PlaywrightError:
                page.wait_for_load_state()
        assert not shown_early or animated or moved, "the case study opened with no lift"
        wait_ui(page, lambda: on_screen(heading), f"case study text within {OPEN_BY_MS} ms of activation",
                seconds=OPEN_BY_MS / 1000 + OPEN_SLACK_S)
        assert path_of(page) == f"/work/{PUBLISHED_CASES[2]}"
        page.go_back()
        wait_ui(page, lambda: path_of(page) == "/" and focused(deck_link(page, "Lanchas del Delta")),
                "focus back on the opened card")


def test_wf_explore_work_keyboard(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        wait_ui(page, lambda: deck_link(page, "Atelier Ombú").count() == 1, "deck renders")
        page.keyboard.press("Tab")
        expect(page.get_by_role("link", name="Skip to content")).to_be_focused()
        tab_to(page, "Mate Route")
        card = deck_link(page, "Atelier Ombú")
        rest, ring = state_styles(card, "outline-style", "outline-width", "box-shadow", state="focus")
        assert rest != ring, "focus ring not visible on a case-study card"
        tab_to(page, "Atelier Ombú")
        page.keyboard.press("Enter")
        heading = page.get_by_role("heading", level=1, name="Atelier Ombú")
        wait_ui(page, lambda: path_of(page) == "/work/atelier-ombu" and on_screen(heading), "case study opened")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: path_of(page) == "/" and focused(deck_link(page, "Atelier Ombú")), "back on the same card")
        tab_to(page, "USD")
        usd = page.get_by_role("region", name="Pricing").get_by_role("radio", name="USD")
        assert focused(usd)
    assert client(app_url).get(f"/api/case-studies/{PUBLISHED_CASES[1]}").status_code == 200


def test_wf_explore_work_breakpoints(browser: Browser, app_url: str) -> None:
    for viewport, columns in (("375", 1), ("768", 2), ("1280", 3)):
        width = VIEWPORTS[viewport][0]
        with browse(browser, app_url, "/", size=VIEWPORTS[viewport], reduced_motion="reduce") as page:
            wait_ui(page, lambda: deck_link(page, "Norte Cycling Club").count() == 1, "deck renders")
            layout(page)
            boxes = [deck_link(page, CASE_TITLES[s]).bounding_box() for s in PUBLISHED_CASES[:3]]
            lefts = {round(b["x"]) for b in boxes}
            assert len(lefts) == columns, (viewport, lefts)
            assert all(b["x"] >= -GEOMETRY_TOL and b["x"] + b["width"] <= width + GEOMETRY_TOL for b in boxes), boxes
            card = deck_link(page, "Norte Cycling Club")
            card.scroll_into_view_if_needed()
            click(card)
            heading = page.get_by_role("heading", level=1, name="Norte Cycling Club")
            wait_ui(page, lambda: path_of(page) == "/work/norte-cycling-club" and on_screen(heading), "case study opened")
            layout(page)
            page.go_back()
            wait_ui(page, lambda: path_of(page) == "/" and focused(deck_link(page, "Norte Cycling Club")),
                    "focus back on the card")


def test_wf_explore_work_phone_reduced(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/", size=VIEWPORTS["375"], reduced_motion="reduce") as page:
        card = deck_link(page, "Mate Route")
        wait_ui(page, lambda: card.count() == 1, "deck renders")
        card.scroll_into_view_if_needed()
        tap(card)
        advance(page, REDUCED_OPEN_MS)
        heading = page.get_by_role("heading", level=1, name="Mate Route")
        expect(heading).to_be_visible()
        assert on_screen(heading), "case study not shown at once under reduced motion"
        assert path_of(page) == f"/work/{PUBLISHED_CASES[0]}"
        tap(page.get_by_role("link", name="Back to work"))
        wait_ui(page, lambda: path_of(page) == "/" and focused(deck_link(page, "Mate Route")), "focus back on the card")
    assert client(app_url).get(f"/api/case-studies/{PUBLISHED_CASES[0]}").status_code == 200


QUOTE_CASES = {
    "launch-page-usd": ("launch-page", "USD"),
    "studio-site-usd": ("studio-site", "USD"),
    "care-lite-usd": ("care-lite", "USD"),
    "care-plus-usd": ("care-plus", "USD"),
    "launch-page-ars": ("launch-page", "ARS"),
    "studio-site-ars": ("studio-site", "ARS"),
    "care-lite-ars": ("care-lite", "ARS"),
    "care-plus-ars": ("care-plus", "ARS"),
}


@pytest.mark.parametrize("case", list(QUOTE_CASES), ids=list(QUOTE_CASES))
def test_server_quotes(app_url: str, case: str) -> None:
    plan, currency = QUOTE_CASES[case]
    http = client(app_url)
    listing = http.get("/api/plans", params={"currency": currency})
    assert listing.status_code == 200 and listing.json()["currency"] == currency
    row = next(p for p in listing.json()["plans"] if p["plan"] == plan)
    assert row["name"] == PLAN_NAMES[plan]
    assert row["interval"] == ("month" if plan in CARE_PLANS else None)
    assert http.post("/api/quotes", json={"plan": plan, "currency": currency}).status_code == 200
    started = time.monotonic()
    r = http.post("/api/quotes", json={"plan": plan, "currency": currency})
    elapsed = time.monotonic() - started
    assert r.status_code == 200, r.text
    assert elapsed < QUOTE_BUDGET_S, f"quote took {elapsed:.2f}s"
    quote = r.json()
    assert quote["plan"] == plan and quote["currency"] == currency
    for field in ("total", "dueNow", "dueAtLaunch"):
        assert two_decimals(quote[field]), quote
    total = Decimal(row["amount"])
    if currency == "USD":
        assert total == Decimal(USD_PRICES[plan])
    assert Decimal(quote["total"]) == total
    if plan in CARE_PLANS:
        assert quote["dueNow"] == quote["total"] and quote["dueAtLaunch"] == "0.00"
    else:
        deposit = (total * DEPOSIT_RATE).quantize(CENT, ROUND_DOWN)
        assert Decimal(quote["dueNow"]) == deposit
        assert Decimal(quote["dueAtLaunch"]) == total - deposit
    share = (Decimal(quote["dueNow"]) / total * 100).quantize(Decimal("0.1"), ROUND_HALF_UP)
    assert Decimal(str(quote["dueNowShare"])) == share
    assert instant(quote["priceEffectiveAt"]) <= server_now(app_url)
    if case == "studio-site-usd":
        assert (quote["dueNow"], quote["dueAtLaunch"]) == ("1999.99", "3000.00")
    assert http.post("/api/quotes", json={"plan": plan, "currency": "EUR"}).status_code == 422
    assert http.get("/api/plans", params={"currency": "EUR"}).status_code == 422


def test_money_format_everywhere(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = new_owner(app_url, "studio-site", "ARS")
    r = pay(owner.http, order["id"])
    assert r.status_code == 201, r.text
    deposit = order["dueNow"]
    invoice = invoices_with(killbill, kb_id(killbill, owner.account_id), f"{order['number']} deposit")
    assert len(invoice) == 1 and dec(invoice[0]["amount"]) == Decimal(deposit)
    receipt = wait_mail(mail, owner.email, subject=f"Receipt {order['number']}: {money(deposit, 'ARS')}")
    assert len(receipt) == 1

    with browse(browser, app_url, f"/checkout/{order['id']}", cookie=owner.cookie) as page:
        summary = page.get_by_role("region", name="Order summary")
        wait_ui(page, lambda: money(order["total"], "ARS") in text_of(summary), "order summary total")
        for amount in (order["dueNow"], order["dueAtLaunch"]):
            assert money(amount, "ARS") in text_of(summary)
        page.goto(f"{app_url}/orders/{order['id']}/receipt")
        expect(page.get_by_role("heading", level=1, name="Payment received")).to_be_visible()
        expect(page.get_by_text(money(deposit, "ARS"), exact=False).first).to_be_visible()

    with browse(browser, app_url, "/") as page:
        studio_card = page.get_by_role("article", name="Studio Site")
        wait_ui(page, lambda: money(USD_PRICES["studio-site"], "USD") in text_of(studio_card), "USD card price")
        choose(page.get_by_role("radiogroup", name="Currency").get_by_role("radio", name="ARS"))
        ars_price = plan_price(app_url, "studio-site", "ARS")
        wait_ui(page, lambda: money(ars_price, "ARS") in text_of(studio_card), "ARS card price")


def test_quote_sheet_folds_and_counts(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        quote = page.get_by_role("region", name="Quote")
        expect(quote).to_have_attribute("data-state", "ready", timeout=UI_WAIT_S * 1000)
        advance(page, COUNT_BY_MS)
        before = sheet(quote)
        assert before["now"] and before["launch"]
        sent: list[str] = []
        page.on("request", lambda req: sent.append(req.url) if "/api/quotes" in req.url else None)
        with held(page, "**/api/quotes") as hold:
            click(page.get_by_role("button", name="Choose Care"))
            expect(quote).to_have_attribute("data-state", "quoting")
            advance(page, FOLD_FLAT_BY_MS)
            flat = sheet(quote)
            assert flat["tilt"] == 0, flat
            assert QUOTING in text_of(quote)
            assert amounts_in(text_of(quote)) == [], "numbers shown while quoting"
            assert text_of(page.get_by_role("status", name="Quote status")) == QUOTING
            with page.expect_response("**/api/quotes") as info:
                hold.release()
        figures = info.value.json()
        expect(quote).to_have_attribute("data-state", "ready")
        frames = []
        elapsed = 0
        while elapsed < COUNT_BY_MS:
            advance(page, FRAME_MS)
            elapsed += FRAME_MS
            frames.append((elapsed, sheet(quote)))
        share = float(figures["dueNowShare"])
        first = frames[0][1]
        assert first["crease"] != share or first["tilt"] < TILT_OPEN, "sheet jumped open without motion"
        opened = [f for t, f in frames if t >= CREASE_BY_MS]
        assert all(abs(f["crease"] - share) < 0.05 and f["tilt"] == TILT_OPEN for f in opened), opened[0]
        now_final = Decimal(figures["dueNow"])
        counting = [f for _, f in frames if f["now"] and min(before["now"][0], now_final) < f["now"][0] < max(before["now"][0], now_final)]
        assert counting, "numerals never counted between the old and new figures"
        for _, f in frames:
            if f["now"] and f["launch"] and f["total"]:
                assert f["total"][0] == f["now"][0] + f["launch"][0], f
        final = frames[-1][1]
        assert final["now"] == [now_final] and final["launch"] == [Decimal(figures["dueAtLaunch"])]
        assert final["total"] == [Decimal(figures["total"])]
        assert len(sent) == 1, sent

    with browse(browser, base_of(KB_DOWN), "/") as page:
        quote = page.get_by_role("region", name="Quote")
        expect(quote).to_have_attribute("data-state", "outage", timeout=UI_WAIT_S * 1000)
        advance(page, COUNT_BY_MS)
        assert QUOTE_OUTAGE_COPY in text_of(quote)
        assert float(quote.get_attribute("data-tilt")) == 0
        assert amounts_in(text_of(quote)) == []
        wait_text(page, page.get_by_role("status", name="Quote status"), QUOTE_OUTAGE_COPY)


def test_quote_sheet_reduced_motion(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        quote = page.get_by_role("region", name="Quote")
        expect(quote).to_have_attribute("data-state", "ready", timeout=UI_WAIT_S * 1000)
        table = quote.get_by_role("table", name="Quote")
        expect(table.get_by_role("columnheader", name="Due now")).to_be_visible()
        expect(table.get_by_role("columnheader", name="Due at launch")).to_be_visible()
        with page.expect_response("**/api/quotes") as info:
            click(page.get_by_role("button", name="Choose Launch Page"))
        figures = info.value.json()
        expect(quote).to_have_attribute("data-state", "ready")
        advance(page, FRAME_MS)
        shown = amounts_in(text_of(table))
        for field in ("dueNow", "dueAtLaunch", "total"):
            assert Decimal(figures[field]) in shown, (field, shown)
        assert "Total" in text_of(table)
        assert float(quote.get_attribute("data-tilt")) == 0
        assert abs(float(quote.get_attribute("data-crease")) - float(figures["dueNowShare"])) < 0.05


def test_quote_updates_in_place(browser: Browser, app_url: str) -> None:
    http = client(app_url)
    with browse(browser, app_url, "/") as page:
        quote = page.get_by_role("region", name="Quote")
        expect(quote).to_have_attribute("data-state", "ready", timeout=UI_WAIT_S * 1000)
        page.evaluate("() => { window.__verifierNoReload = true }")
        status = page.get_by_role("status", name="Quote status")

        def sentence(q: dict[str, Any]) -> str:
            c = q["currency"]
            return f"Due now {money(q['dueNow'], c)}, due at launch {money(q['dueAtLaunch'], c)}, total {money(q['total'], c)}."

        choose(page.get_by_role("radiogroup", name="Currency").get_by_role("radio", name="ARS"))
        expected = http.post("/api/quotes", json={"plan": "studio-site", "currency": "ARS"}).json()
        wait_text(page, status, sentence(expected))
        wait_ui(page, lambda: money(expected["total"], "ARS") in text_of(page.get_by_role("article", name="Studio Site")), "ARS card")
        wait_ui(page, lambda: sheet(quote)["now"] == [Decimal(expected["dueNow"])], "sheet due now")

        click(page.get_by_role("button", name="Choose Care"))
        expect(page.get_by_role("button", name="Choose Care", pressed=True)).to_be_visible()
        choose(page.get_by_role("radiogroup", name="Care tier").get_by_role("radio", name="Plus"))
        plus = http.post("/api/quotes", json={"plan": "care-plus", "currency": "ARS"}).json()
        wait_text(page, status, sentence(plus))
        care = page.get_by_role("article", name="Care")
        wait_ui(page, lambda: f"{money(plus['total'], 'ARS')} / month" in text_of(care), "Care card monthly price")
        wait_ui(page, lambda: sheet(quote)["launch"] == [Decimal("0.00")], "care due at launch")
        assert page.evaluate("() => window.__verifierNoReload === true"), "page reloaded"


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_published_breakpoints(browser: Browser, app_url: str, viewport: str) -> None:
    width, height = VIEWPORTS[viewport]
    with browse(browser, app_url, "/", size=(width, height)) as page:
        wait_ui(page, lambda: deck_link(page, "Norte Cycling Club").count() == 1, "deck renders")
        layout(page)
        menu = page.get_by_role("button", name="Menu")
        nav_pricing = page.get_by_role("navigation", name="Main").get_by_role("link", name="Pricing")
        if viewport == "1280":
            assert menu.count() == 0 or not on_screen(menu)
            assert on_screen(nav_pricing)
        else:
            assert on_screen(menu)
            assert not on_screen(nav_pricing)
        quote = page.get_by_role("region", name="Quote")
        expect(quote).to_have_attribute("data-state", "ready", timeout=UI_WAIT_S * 1000)
        cards = [page.get_by_role("article", name=n).bounding_box() for n in ("Launch Page", "Studio Site", "Care")]
        lp, ss, care = cards
        if viewport == "375":
            assert abs(lp["x"] - ss["x"]) <= GEOMETRY_TOL and abs(ss["x"] - care["x"]) <= GEOMETRY_TOL
            assert lp["y"] < ss["y"] < care["y"]
        elif viewport == "768":
            assert abs(lp["y"] - ss["y"]) <= GEOMETRY_TOL and lp["x"] < ss["x"]
            assert care["y"] >= lp["y"] + lp["height"] - GEOMETRY_TOL
            assert abs(care["x"] - lp["x"]) <= GEOMETRY_TOL
        else:
            assert abs(lp["y"] - ss["y"]) <= GEOMETRY_TOL and abs(ss["y"] - care["y"]) <= GEOMETRY_TOL
            assert lp["x"] < ss["x"] < care["x"]
        advance(page, COUNT_BY_MS)
        now = quote.get_by_role("group", name="Due now").bounding_box()
        later = quote.get_by_role("group", name="Due at launch").bounding_box()
        if viewport == "375":
            assert now["y"] + now["height"] <= later["y"] + GEOMETRY_TOL
        else:
            assert now["x"] + now["width"] <= later["x"] + GEOMETRY_TOL
            assert now["y"] < later["y"] + later["height"] and later["y"] < now["y"] + now["height"]
        for path in ("/journal", "/work/mate-route", "/sign-in"):
            page.goto(f"{app_url}{path}")
            page.wait_for_load_state("load")
            layout(page)
        order = browser_order(page, app_url, "studio-site", "USD")
        page.goto(f"{app_url}/checkout/{order['id']}")
        summary = page.get_by_role("region", name="Order summary")
        accept_form = page.get_by_role("form", name="Accept quote")
        wait_ui(page, lambda: summary.count() == 1 and accept_form.count() == 1, "checkout renders")
        layout(page)
        s_box, f_box = summary.bounding_box(), accept_form.bounding_box()
        if viewport == "375":
            assert s_box["y"] + s_box["height"] <= f_box["y"] + GEOMETRY_TOL
        else:
            assert s_box["x"] + s_box["width"] <= f_box["x"] + GEOMETRY_TOL


def test_wf_pricing_quote_ars_studio_site(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        quote = page.get_by_role("region", name="Quote")
        expect(quote).to_have_attribute("data-state", "ready", timeout=UI_WAIT_S * 1000)
        with page.expect_response("**/api/quotes") as info:
            choose(page.get_by_role("radiogroup", name="Currency").get_by_role("radio", name="ARS"))
        figures = info.value.json()
        assert figures["currency"] == "ARS" and figures["plan"] == "studio-site"
        click(page.get_by_role("button", name="Choose Studio Site"))
        expect(page.get_by_role("button", name="Choose Studio Site", pressed=True)).to_be_visible()
        wait_ui(page, lambda: sheet(quote)["now"] == [Decimal(figures["dueNow"])]
                and sheet(quote)["launch"] == [Decimal(figures["dueAtLaunch"])], "peso split on the sheet")
        click(page.get_by_role("button", name="Start checkout"))
        wait_ui(page, lambda: re.fullmatch(r"/checkout/[0-9a-f-]{36}", path_of(page)) is not None, "checkout route")
        order_id = path_of(page).rsplit("/", 1)[1]
        summary = page.get_by_role("region", name="Order summary")
        for field in ("total", "dueNow", "dueAtLaunch"):
            wait_ui(page, lambda f=field: money(figures[f], "ARS") in text_of(summary), f"summary {field}")
        expect(page.get_by_role("button", name=f"Pay {money(figures['dueNow'], 'ARS')}")).to_be_visible()
        order = page.request.get(f"{app_url}/api/orders/{order_id}").json()
    assert order["state"] == "quoted" and order["plan"] == "studio-site" and order["currency"] == "ARS"
    assert (order["dueNow"], order["dueAtLaunch"], order["total"]) == (figures["dueNow"], figures["dueAtLaunch"], figures["total"])


def test_wf_pricing_quote_phone_care(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/", size=VIEWPORTS["375"]) as page:
        quote = page.get_by_role("region", name="Quote")
        expect(quote).to_have_attribute("data-state", "ready", timeout=UI_WAIT_S * 1000)
        tap(page.get_by_role("button", name="Choose Care"))
        tap_choice(page.get_by_role("radiogroup", name="Care tier").get_by_role("radio", name="Plus"))
        wait_ui(page, lambda: sheet(quote)["now"] == [Decimal(USD_PRICES["care-plus"])], "Care Plus quote")
        tap(page.get_by_role("button", name="Start checkout"))
        wait_ui(page, lambda: path_of(page).startswith("/checkout/"), "checkout route")
        layout(page)
        expect(page.get_by_role("button", name=f"Pay {money(USD_PRICES['care-plus'], 'USD')}")).to_be_visible()
        order = page.request.get(f"{app_url}/api/orders/{path_of(page).rsplit('/', 1)[1]}").json()
    assert order["plan"] == "care-plus" and order["currency"] == "USD" and order["dueNow"] == USD_PRICES["care-plus"]


def test_quote_acceptance(app_url: str, killbill: Any) -> None:
    anon = client(app_url)
    order = new_order(anon, "launch-page", "ARS")
    base_body = account_body()
    for field, bad in (("acceptTerms", False), ("password", "short"), ("email", STUDIO[0]), ("businessName", "")):
        r = anon.post(f"/api/orders/{order['id']}/accept", json={**base_body, field: bad})
        assert r.status_code == 422 and field in r.json()["fields"], (field, r.text)
    assert anon.get(f"/api/orders/{order['id']}").json()["state"] == "quoted"

    staff = studio(app_url)
    stale = new_order(client(app_url), "launch-page", "ARS")
    new_price = raise_price(app_url, "launch-page", "1111.11")
    stale_http = client(app_url)
    stale_http.cookies = anon.cookies
    r = anon.post(f"/api/orders/{order['id']}/accept", json=base_body)
    assert r.status_code == 409 and error_of(r) == "quote_stale", r.text
    assert r.json()["message"] == PRICE_CHANGED_COPY
    assert Decimal(r.json()["order"]["total"]) == new_price and r.json()["order"]["state"] == "quoted"
    r = anon.post(f"/api/orders/{order['id']}/accept", json=base_body)
    assert r.status_code == 200, r.text
    accepted = r.json()["order"]
    assert accepted["state"] == "accepted" and accepted["acceptedAt"] and Decimal(accepted["total"]) == new_price
    owner_user = r.json()["user"]
    assert owner_user["role"] == "client_owner" and me(anon)["id"] == owner_user["id"]

    again = new_order(anon, "launch-page", "ARS")
    r = anon.post(f"/api/orders/{again['id']}/accept", json={"acceptTerms": True})
    assert r.status_code == 200 and r.json()["user"]["accountId"] == owner_user["accountId"]
    usd = new_order(anon, "launch-page", "USD")
    r = anon.post(f"/api/orders/{usd['id']}/accept", json={"acceptTerms": True})
    assert r.status_code == 422 and r.json()["fields"]["currency"] == f"Your account bills in {accepted['currency']}."

    race = new_order(anon, "studio-site", "ARS")
    twin = client(app_url, anon.cookies[SESSION_COOKIE])
    results = together(lambda: anon.post(f"/api/orders/{race['id']}/accept", json={"acceptTerms": True}),
                       lambda: twin.post(f"/api/orders/{race['id']}/accept", json={"acceptTerms": True}))
    assert sorted(r.status_code for r in results) == [200, 409]
    assert [error_of(r) for r in results if r.status_code == 409] == ["invalid_transition"]

    care_owner, _ = paid_owner(app_url, "care-lite", "USD")
    second = new_order(care_owner.http, "care-plus", "USD")
    r = care_owner.http.post(f"/api/orders/{second['id']}/accept", json={"acceptTerms": True})
    assert r.status_code == 409 and error_of(r) == "plan_exists"
    assert stale["state"] == "quoted" and staff is not None


def test_deposit_payment(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = new_owner(app_url, "studio-site", "ARS")
    total, deposit = Decimal(order["total"]), Decimal(order["dueNow"])
    assert deposit == (total * DEPOSIT_RATE).quantize(CENT, ROUND_DOWN) and deposit + Decimal(order["dueAtLaunch"]) == total
    assert S3().keys(f"portal/{order['id']}/") == []
    r = pay(owner.http, order["id"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["order"]["state"] == "deposit_paid" and body["payment"]["kind"] == "deposit"
    assert body["payment"]["amount"] == order["dueNow"] and body["receiptUrl"] == f"/orders/{order['id']}/receipt"
    account = kb_account(killbill, owner.account_id)
    assert account and account["currency"] == "ARS" and account["name"] == owner.business and account["email"] == owner.email
    assert account["timeZone"] == ZONE
    assert killbill.default_plugin(account["accountId"]) == EXTERNAL_PLUGIN
    payment = killbill.payment_by_key(f"{order['id']}-deposit")
    assert kinds(payment) == ["AUTHORIZE", "CAPTURE"]
    assert all(t["status"] == KB_SUCCESS and dec(t["amount"]) == deposit for t in payment["transactions"])
    invoice = invoices_with(killbill, account["accountId"], f"{order['number']} deposit")
    assert len(invoice) == 1 and dec(invoice[0]["amount"]) == deposit and dec(invoice[0]["balance"]) == 0
    assert f"portal/{order['id']}/.portal" in S3().keys(f"portal/{order['id']}/")
    receipts = wait_mail(mail, owner.email, subject=f"Receipt {order['number']}: {money(deposit, 'ARS')}")
    assert len(receipts) == 1
    assert f"/orders/{order['id']}/receipt" in mail_text(receipts[0]) and "Deposit" in mail_text(receipts[0])
    stored = owner.http.get(f"/api/orders/{order['id']}").json()
    assert stored["state"] == "deposit_paid" and stored["projectId"]
    assert stored["projectId"] in [p["id"] for p in owner.http.get("/api/projects").json()["projects"]]


def test_pay_replay_and_mismatch(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = new_owner(app_url, "launch-page", "USD")
    r = owner.http.post(f"/api/orders/{order['id']}/pay", json={"card": CARD_OK})
    assert r.status_code == 422 and "Idempotency-Key" in r.json()["fields"]
    key = idempotency_key()
    first = pay(owner.http, order["id"], key=key)
    assert first.status_code == 201, first.text
    again = pay(owner.http, order["id"], key=key)
    assert again.status_code == 201 and again.json() == first.json()
    assert again.headers.get("Idempotent-Replayed") == "true"
    other = pay(owner.http, order["id"], {**CARD_OK, "cvc": "321"}, key=key)
    assert other.status_code == 409 and error_of(other) == "idempotency_mismatch"
    assert len(succeeded(killbill, kb_id(killbill, owner.account_id), "CAPTURE")) == 1
    assert len(wait_mail(mail, owner.email, prefix=f"Receipt {order['number']}:")) == 1
    assert S3().keys(f"portal/{order['id']}/.portal") == [f"portal/{order['id']}/.portal"]


def test_pay_concurrent(app_url: str, killbill: Any) -> None:
    owner, order = new_owner(app_url, "launch-page", "USD")
    key = idempotency_key()
    twins = together(*[lambda c=owner.clone(): pay(c, order["id"], key=key) for _ in range(2)])
    assert [r.status_code for r in twins] == [201, 201] and twins[0].json() == twins[1].json()
    assert len(succeeded(killbill, kb_id(killbill, owner.account_id), "CAPTURE")) == 1

    owner2, order2 = new_owner(app_url, "studio-site", "USD")
    results = together(*[lambda c=owner2.clone(): pay(c, order2["id"]) for _ in range(4)])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    assert {error_of(r) for r in results if r.status_code == 409} == {"invalid_transition"}
    captures = succeeded(killbill, kb_id(killbill, owner2.account_id), "CAPTURE")
    assert len(captures) == 1 and dec(captures[0]["amount"]) == Decimal(order2["dueNow"])


def test_pay_rolls_back_when_storage_fails(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = new_owner(app_url, "studio-site", "USD")
    key = idempotency_key()
    r = pay(owner.clone(base_of(MINIO_DOWN)), order["id"], key=key)
    assert r.status_code == 503 and error_of(r) == "storage_unavailable" and r.json()["message"] == STORAGE_PAY_COPY
    payment = killbill.payment_by_key(f"{order['id']}-deposit")
    assert kinds(payment)[:2] == ["AUTHORIZE", "VOID"] and "CAPTURE" not in kinds(payment)
    account = kb_id(killbill, owner.account_id)
    listed = killbill.client.get(f"/accounts/{account}/invoices",
                                 params={"includeInvoiceComponents": "true", "includeVoidedInvoices": "true"})
    assert listed.status_code == 200, listed.text
    held_invoices = [inv for inv in listed.json()
                     if any(item.get("description") == f"{order['number']} deposit" for item in inv.get("items", []))]
    assert held_invoices and all(inv["status"].lower() == "void" for inv in held_invoices)
    assert S3().keys(f"portal/{order['id']}/") == []
    stored = owner.http.get(f"/api/orders/{order['id']}").json()
    assert stored["state"] == "accepted" and stored["payments"] == []
    r = pay(owner.http, order["id"], key=key)
    assert r.status_code == 201, r.text
    captures = succeeded(killbill, account, "CAPTURE")
    assert len(captures) == 1 and dec(captures[0]["amount"]) == Decimal(order["dueNow"])
    assert all(dec(inv["balance"]) == 0 for inv in killbill.invoices(account) if inv["status"].lower() != "void")
    assert len(wait_mail(mail, owner.email, prefix=f"Receipt {order['number']}:")) == 1


def test_pay_charges_nothing_when_billing_unreachable(app_url: str, killbill: Any) -> None:
    owner, order = new_owner(app_url, "launch-page", "ARS")
    r = pay(owner.clone(base_of(KB_DOWN)), order["id"])
    assert r.status_code == 503 and error_of(r) == "billing_unavailable" and r.json()["message"] == BILLING_OUTAGE_COPY
    assert unbilled(killbill, owner.account_id)
    assert S3().keys(f"portal/{order['id']}/") == []
    assert owner.http.get(f"/api/orders/{order['id']}").json()["state"] == "accepted"
    assert pay(owner.http, order["id"]).status_code == 201
    assert len(succeeded(killbill, kb_id(killbill, owner.account_id), "CAPTURE")) == 1


CARD_CASES = {
    "approving": ({"number": "4242 4242 4242 4242"}, 201),
    "approving_unspaced": ({"number": "4242424242424242"}, 201),
    "declining": ({"number": "4000 0000 0000 0002"}, 402),
    "failed_luhn": ({"number": "4242 4242 4242 4241"}, 422),
    "unknown_number": ({"number": "5555 5555 5555 4444"}, 422),
    "past_expiry": ({"expiry": "01/20"}, 422),
    "malformed_expiry": ({"expiry": "1/2039"}, 422),
    "short_cvc": ({"cvc": "12"}, 422),
}


@pytest.mark.parametrize("case", list(CARD_CASES), ids=list(CARD_CASES))
def test_test_cards(app_url: str, killbill: Any, case: str) -> None:
    override, status = CARD_CASES[case]
    owner, order = new_owner(app_url, "launch-page", "USD")
    r = pay(owner.http, order["id"], {**CARD_OK, **override})
    assert r.status_code == status, r.text
    if status == 201:
        assert len(succeeded(killbill, kb_id(killbill, owner.account_id), "CAPTURE")) == 1
        return
    if status == 402:
        assert error_of(r) == "card_declined" and r.json()["message"] == DECLINED_COPY
    else:
        assert r.json()["fields"], r.text
    assert unbilled(killbill, owner.account_id)
    assert owner.http.get(f"/api/orders/{order['id']}").json()["state"] == "accepted"
    assert S3().keys(f"portal/{order['id']}/") == []


def test_wf_checkout_deposit_keyboard(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    body = account_body("keys")
    with browse(browser, app_url, "/") as page:
        order = browser_order(page, app_url, "studio-site", "ARS")
        page.goto(f"{app_url}/checkout/{order['id']}")
        for label, value in (("Business name", body["businessName"]), ("Your name", body["name"]),
                             ("Email", body["email"]), ("Password", body["password"])):
            tab_to(page, label)
            page.keyboard.type(value)
        tab_to(page, ACCEPT_BOX)
        page.keyboard.press("Space")
        tab_to(page, "Accept quote")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: focused(page.get_by_label("Card number")), "focus on Card number")
        wait_text(page, page.get_by_role("status", name="Checkout status"),
                  f"Quote accepted. Price locked at {money(order['total'], 'ARS')}.")
        page.keyboard.type(CARD_OK["number"])
        page.keyboard.press("Tab")
        page.keyboard.type(EXPIRY)
        page.keyboard.press("Tab")
        page.keyboard.type(CVC)
        tab_to(page, f"Pay {money(order['dueNow'], 'ARS')}")
        page.keyboard.press("Enter")
        receipt = f"/orders/{order['id']}/receipt"
        wait_ui(page, lambda: path_of(page) == receipt, "receipt route")
        for _ in range(2):
            expect(page.get_by_role("heading", level=1, name="Payment received")).to_be_visible()
            expect(page.get_by_text(money(order["dueNow"], "ARS")).first).to_be_visible()
            expect(page.get_by_text(f"We'll email your receipt to {body['email']}.")).to_be_visible()
            expect(page.get_by_role("link", name="Go to your portal")).to_be_visible()
            page.reload()
        user = page.request.get(f"{app_url}/api/me").json()["user"]
    captures = succeeded(killbill, kb_id(killbill, user["accountId"]), "CAPTURE")
    assert len(captures) == 1 and dec(captures[0]["amount"]) == Decimal(order["dueNow"])
    assert len(wait_mail(mail, body["email"], prefix=f"Receipt {order['number']}:")) == 1


def test_wf_checkout_deposit_declined_recovery(browser: Browser, app_url: str, killbill: Any) -> None:
    body = account_body("decline")
    with browse(browser, app_url, "/") as page:
        order = browser_order(page, app_url, "launch-page", "USD")
        page.goto(f"{app_url}/checkout/{order['id']}")
        fill_accept(page, body)
        fill_card(page, CARD_DECLINE)
        pay_button = page.get_by_role("button", name=f"Pay {money(order['dueNow'], 'USD')}")
        click(pay_button)
        wait_ui(page, lambda: on_screen(page.get_by_text(DECLINED_COPY, exact=True)), "declined copy")
        expect(page.get_by_label("Card number")).to_have_value(re.compile(r"4000\s?0000\s?0000\s?0002"))
        expect(page.get_by_label("Expiry (MM/YY)")).to_have_value(EXPIRY)
        expect(page.get_by_label("CVC")).to_have_value(CVC)
        user = page.request.get(f"{app_url}/api/me").json()["user"]
        assert unbilled(killbill, user["accountId"])
        fill(page.get_by_label("Card number"), CARD_OK["number"])
        click(pay_button)
        wait_ui(page, lambda: path_of(page) == f"/orders/{order['id']}/receipt", "receipt route")
    assert len(succeeded(killbill, kb_id(killbill, user["accountId"]), "CAPTURE")) == 1


def test_wf_checkout_deposit_double_press(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    with browse(browser, app_url, "/") as page:
        order = browser_order(page, app_url, "launch-page", "USD")
        body = account_body("double")
        r = page.request.post(f"{app_url}/api/orders/{order['id']}/accept", data=body)
        assert r.status == 200, r.text()
        account_id = r.json()["user"]["accountId"]
        page.goto(f"{app_url}/checkout/{order['id']}")
        fill_card(page, CARD_OK)
        sent: list[str] = []
        page.on("request", lambda req: sent.append(req.url) if req.url.endswith(f"/api/orders/{order['id']}/pay") else None)
        expect(page.get_by_role("button", name=f"Pay {money(order['dueNow'], 'USD')}")).to_be_visible()
        button = page.get_by_role("form", name="Payment").get_by_role("button")
        with held(page, f"**/api/orders/{order['id']}/pay") as hold:
            button.focus()
            page.keyboard.press("Enter")
            wait_ui(page, lambda: button.is_disabled(), "Pay disabled while pending")
            wait_text(page, page.get_by_role("status", name="Checkout status"), PROCESSING)
            page.keyboard.press("Enter")
            click(button) if button.is_enabled() else None
            advance(page, STEP_MS)
            assert len(sent) == 1, sent
            hold.release()
        wait_ui(page, lambda: path_of(page) == f"/orders/{order['id']}/receipt", "receipt route")
    assert len(succeeded(killbill, kb_id(killbill, account_id), "CAPTURE")) == 1
    assert len(wait_mail(mail, body["email"], prefix=f"Receipt {order['number']}:")) == 1


def test_effective_dated_prices(app_url: str) -> None:
    staff = studio(app_url)
    before = plan_price(app_url, "launch-page", "ARS")
    new = before + Decimal("1234.56")
    at = (server_now(app_url) + timedelta(seconds=PRICE_LEAD_S)).isoformat(timespec="seconds")
    assert signed_in(app_url, *MARIELA).post("/api/studio/prices", json={"plan": "launch-page", "currency": "ARS", "amount": f"{new:.2f}"}).status_code == 403
    for bad in ({"currency": "USD"}, {"effectiveAt": "2026-01-02T00:00:00-03:00"}, {"amount": "-1.00"}, {"amount": "1.234"}):
        r = staff.post("/api/studio/prices", json={"plan": "launch-page", "currency": "ARS", "amount": f"{new:.2f}", "effectiveAt": at, **bad})
        assert r.status_code == 422, (bad, r.text)
    r = staff.post("/api/studio/prices", json={"plan": "launch-page", "currency": "ARS", "amount": f"{new:.2f}", "effectiveAt": at})
    assert r.status_code == 201, r.text
    assert any(p["id"] == r.json()["id"] for p in staff.get("/api/studio/prices").json()["prices"])
    anon = client(app_url)
    assert server_now(app_url) < instant(at)
    assert Decimal(anon.post("/api/quotes", json={"plan": "launch-page", "currency": "ARS"}).json()["total"]) == before
    assert plan_price(app_url, "launch-page", "ARS") == before
    wait_past(app_url, at, "scheduled price instant")
    q = anon.post("/api/quotes", json={"plan": "launch-page", "currency": "ARS"}).json()
    assert Decimal(q["total"]) == new and instant(q["priceEffectiveAt"]) == instant(at)
    assert plan_price(app_url, "launch-page", "ARS") == new
    _, accepted = new_owner(app_url, "launch-page", "ARS")
    assert Decimal(accepted["total"]) == new


def test_locked_price_for_launch_balance(app_url: str, killbill: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "ARS")
    new = raise_price(app_url, "launch-page", "777.77")
    assert Decimal(client(app_url).post("/api/quotes", json={"plan": "launch-page", "currency": "ARS"}).json()["total"]) == new
    to_balance_invoiced(app_url, order)
    account = kb_id(killbill, owner.account_id)
    balance = invoices_with(killbill, account, f"{order['number']} launch balance")
    deposit = invoices_with(killbill, account, f"{order['number']} deposit")
    assert len(balance) == 1 and dec(balance[0]["amount"]) == Decimal(order["dueAtLaunch"])
    assert dec(deposit[0]["amount"]) + dec(balance[0]["amount"]) == Decimal(order["total"]) != new
    assert owner.http.get(f"/api/orders/{order['id']}").json()["total"] == order["total"]


def test_wf_price_change_locked_balance(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, order = paid_owner(app_url, "studio-site", "ARS")
    assert move(studio(app_url), order["id"], "in_build").status_code == 200
    new = plan_price(app_url, "studio-site", "ARS") + Decimal("99999.99")
    staff_cookie = studio(app_url).cookies[SESSION_COOKIE]
    with browse(browser, app_url, "/studio", cookie=staff_cookie) as page:
        form = page.get_by_role("form", name="Peso prices")
        select(form.get_by_label("Plan"), "Studio Site")
        fill(form.get_by_label("Amount (ARS)"), f"{new:.2f}")
        click(form.get_by_role("button", name="Schedule price"))
        wait_ui(page, lambda: money(new, "ARS") in text_of(page.locator("body")), "new price in the schedule")
        row = page.get_by_role("table", name="Orders").get_by_role("row").filter(has_text=order["number"])
        click(row.get_by_role("button", name="Invoice launch balance"))
        eventually(lambda: owner.http.get(f"/api/orders/{order['id']}").json()["state"] == "balance_invoiced", UI_WAIT_S, "balance invoiced")
    balance = invoices_with(killbill, kb_id(killbill, owner.account_id), f"{order['number']} launch balance")
    assert len(balance) == 1 and dec(balance[0]["amount"]) == Decimal(order["dueAtLaunch"])
    with browse(browser, app_url, "/") as page:
        quote = page.get_by_role("region", name="Quote")
        choose(page.get_by_role("radiogroup", name="Currency").get_by_role("radio", name="ARS"))
        deposit = (new * DEPOSIT_RATE).quantize(CENT, ROUND_DOWN)
        wait_ui(page, lambda: sheet(quote)["now"] == [deposit] and sheet(quote)["launch"] == [new - deposit], "new peso split")


def test_wf_price_change_stale_accept(browser: Browser, app_url: str) -> None:
    body = account_body("stale")
    with browse(browser, app_url, "/") as page:
        order = browser_order(page, app_url, "launch-page", "ARS")
        page.goto(f"{app_url}/checkout/{order['id']}")
        new = raise_price(app_url, "launch-page", "222.22")
        fill(page.get_by_label("Business name"), body["businessName"])
        fill(page.get_by_label("Your name"), body["name"])
        fill(page.get_by_label("Email", exact=True), body["email"])
        fill(page.get_by_label("Password", exact=True), body["password"])
        check(page.get_by_role("checkbox", name=ACCEPT_BOX))
        click(page.get_by_role("button", name="Accept quote"))
        wait_ui(page, lambda: on_screen(page.get_by_text(PRICE_CHANGED_COPY, exact=True)), "price changed copy")
        summary = page.get_by_role("region", name="Order summary")
        wait_ui(page, lambda: money(new, "ARS") in text_of(summary), "summary shows the new total")
        if not page.get_by_role("checkbox", name=ACCEPT_BOX).is_checked():
            check(page.get_by_role("checkbox", name=ACCEPT_BOX))
        click(page.get_by_role("button", name="Accept quote"))
        wait_ui(page, lambda: page.get_by_label("Card number").is_enabled(), "accepted")
        stored = page.request.get(f"{app_url}/api/orders/{order['id']}").json()
    assert stored["state"] == "accepted" and Decimal(stored["total"]) == new


def test_build_order_lifecycle(app_url: str) -> None:
    staff = studio(app_url)
    http = client(app_url)
    order = new_order(http, "launch-page", "USD")
    assert order["state"] == "quoted" and order["acceptedAt"] is None and order["payments"] == []
    oid = order["id"]

    def refused(r: httpx.Response, state: str) -> None:
        assert r.status_code == 409 and error_of(r) == "invalid_transition" and state in r.json()["message"], r.text

    hidden = move(staff, oid, "in_build")
    assert hidden.status_code == 404 and error_of(hidden) == "not_found", hidden.text
    assert http.post(f"/api/orders/{oid}/accept", json=account_body()).status_code == 200
    refused(move(staff, oid, "closed"), "accepted")
    assert pay(http, oid).status_code == 201
    refused(http.post(f"/api/orders/{oid}/accept", json={"acceptTerms": True}), "deposit_paid")
    refused(move(staff, oid, "balance_invoiced"), "deposit_paid")
    assert move(staff, oid, "in_build").json()["state"] == "in_build"
    refused(move(staff, oid, "closed"), "in_build")
    refused(pay(http, oid), "in_build")
    assert move(staff, oid, "balance_invoiced").json()["state"] == "balance_invoiced"
    assert pay(http, oid).json()["order"]["state"] == "paid_in_full"
    refused(move(staff, oid, "in_build"), "paid_in_full")
    assert move(staff, oid, "closed").json()["state"] == "closed"
    refused(move(staff, oid, "in_build"), "closed")
    _, care = paid_owner(app_url, "care-lite", "USD")
    refused(move(staff, care["id"], "closed"), "paid_in_full")


def test_launch_balance_invoice(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = paid_owner(app_url, "studio-site", "USD")
    staff = to_balance_invoiced(app_url, order)
    assert move(staff, order["id"], "balance_invoiced").status_code == 409
    account = kb_id(killbill, owner.account_id)
    invoices = invoices_with(killbill, account, f"{order['number']} launch balance")
    assert len(invoices) == 1
    invoice = invoices[0]
    assert dec(invoice["amount"]) == Decimal(order["dueAtLaunch"]) == Decimal("3000.00") and dec(invoice["balance"]) == dec(invoice["amount"])
    notices = wait_mail(mail, owner.email, subject=f"Invoice {invoice['invoiceNumber']} from Pampero Build Co.: {money(order['dueAtLaunch'], 'USD')}")
    assert len(notices) == 1 and "/portal/invoices" in mail_text(notices[0])
    key = f"portal/{order['id']}/invoices/{invoice['invoiceId']}.pdf"
    eventually(lambda: key in S3().keys(f"portal/{order['id']}/invoices/"), PDF_DELAY_S + LATENCY_S, "balance PDF")
    assert S3().get(key).startswith(b"%PDF-")
    listed = [i for i in owner.http.get("/api/invoices").json()["invoices"] if i["orderId"] == order["id"] and i["kind"] == "balance"]
    assert len(listed) == 1 and listed[0]["status"] == "open" and listed[0]["amount"] == order["dueAtLaunch"]


def test_balance_payment(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    to_balance_invoiced(app_url, order)
    key = idempotency_key()
    r = pay(owner.http, order["id"], key=key)
    assert r.status_code == 201, r.text
    assert r.json()["payment"]["kind"] == "balance" and r.json()["payment"]["amount"] == order["dueAtLaunch"] == "1110.00"
    assert r.json()["order"]["state"] == "paid_in_full"
    replay = pay(owner.http, order["id"], key=key)
    assert replay.status_code == 201 and replay.json() == r.json() and replay.headers.get("Idempotent-Replayed") == "true"
    payment = killbill.payment_by_key(f"{order['id']}-balance")
    assert kinds(payment) == ["AUTHORIZE", "CAPTURE"]
    account = kb_id(killbill, owner.account_id)
    assert dec(invoices_with(killbill, account, f"{order['number']} launch balance")[0]["balance"]) == 0
    assert len(succeeded(killbill, account, "CAPTURE")) == 2
    receipts = wait_mail(mail, owner.email, subject=f"Receipt {order['number']}: {money('1110.00', 'USD')}")
    assert len(receipts) == 1 and "Launch balance" in mail_text(receipts[0])


def pay_balance_in_ui(page: Page, base: str, order: dict[str, Any], due: str) -> None:
    wait_ui(page, lambda: path_of(page) == f"/checkout/{order['id']}", "checkout route")
    fill_card(page, CARD_OK)
    click(page.get_by_role("button", name=f"Pay {money(due, order['currency'])}"))
    wait_ui(page, lambda: path_of(page) == f"/orders/{order['id']}/receipt", "receipt route")
    expect(page.get_by_role("heading", level=1, name="Payment received")).to_be_visible()
    expect(page.get_by_text(money(due, order["currency"])).first).to_be_visible()


def test_wf_launch_balance_email_to_receipt(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "ARS")
    new = raise_price(app_url, "launch-page", "333.33")
    assert Decimal(client(app_url).post("/api/quotes", json={"plan": "launch-page", "currency": "ARS"}).json()["total"]) == new
    assert Decimal(order["total"]) != new
    to_balance_invoiced(app_url, order)
    balance = invoices_with(killbill, kb_id(killbill, owner.account_id), f"{order['number']} launch balance")
    assert len(balance) == 1 and dec(balance[0]["amount"]) == Decimal(order["dueAtLaunch"])
    notice = wait_mail(mail, owner.email, prefix="Invoice ")[-1]
    link = re.search(r"https?://\S+/portal/invoices", mail_text(notice))
    assert link, mail_text(notice)
    with browse(browser, app_url, urlsplit(link.group(0)).path, cookie=owner.cookie) as page:
        assert path_of(page) == "/portal/invoices"
        click(page.get_by_role("table", name="Invoices").get_by_role("link", name="Pay launch balance"))
        pay_balance_in_ui(page, app_url, order, order["dueAtLaunch"])
        page.reload()
        expect(page.get_by_role("heading", level=1, name="Payment received")).to_be_visible()
    payment = killbill.payment_by_key(f"{order['id']}-balance")
    assert kinds(payment) == ["AUTHORIZE", "CAPTURE"]
    assert dec(payment["transactions"][-1]["amount"]) == Decimal(order["dueAtLaunch"])


def test_wf_launch_balance_overview_link(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, order = paid_owner(app_url, "studio-site", "USD")
    to_balance_invoiced(app_url, order)
    with browse(browser, app_url, "/portal", cookie=owner.cookie) as page:
        click(page.get_by_role("link", name="Pay launch balance"))
        pay_balance_in_ui(page, app_url, order, order["dueAtLaunch"])
    assert owner.http.get(f"/api/orders/{order['id']}").json()["state"] == "paid_in_full"
    assert kinds(killbill.payment_by_key(f"{order['id']}-balance")) == ["AUTHORIZE", "CAPTURE"]


def refund(staff: httpx.Client, order_id: str, amount: str, key: str | None = None, payment: str = "deposit") -> httpx.Response:
    return staff.post(f"/api/studio/orders/{order_id}/refunds", json={"payment": payment, "amount": amount, "reason": "verifier refund"},
                      headers=keyed(key))


def test_partial_refunds(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    staff = studio(app_url)
    oid = order["id"]
    assert refund(owner.http, oid, "1.00").status_code == 403
    r = refund(staff, oid, "1.00", payment="balance")
    assert r.status_code == 409 and error_of(r) == "payment_not_captured"
    deposit = Decimal(order["dueNow"])
    first_left = deposit - REFUND_FIRST
    last_amount = first_left - REFUND_RACE
    key = idempotency_key()
    first = refund(staff, oid, f"{REFUND_FIRST:.2f}", key)
    assert first.status_code == 201, first.text
    assert Decimal(first.json()["refund"]["amount"]) == REFUND_FIRST
    assert Decimal(first.json()["payment"]["remaining"]) == first_left
    replay = refund(staff, oid, f"{REFUND_FIRST:.2f}", key)
    assert replay.status_code == 201 and replay.json() == first.json() and replay.headers.get("Idempotent-Replayed") == "true"
    over = refund(staff, oid, f"{first_left + CENT:.2f}")
    assert over.status_code == 422
    assert over.json()["fields"]["amount"] == f"That is more than the {money(first_left, 'USD')} left on this payment."
    racers = together(*[lambda c=client(app_url, staff.cookies[SESSION_COOKIE]): refund(c, oid, f"{REFUND_RACE:.2f}") for _ in range(2)])
    assert sorted(r.status_code for r in racers) == [201, 422]
    last = refund(staff, oid, f"{last_amount:.2f}")
    assert last.status_code == 201 and Decimal(last.json()["payment"]["remaining"]) == 0
    refunds = succeeded(killbill, kb_id(killbill, owner.account_id), "REFUND")
    assert sorted(dec(t["amount"]) for t in refunds) == sorted([REFUND_FIRST, REFUND_RACE, last_amount])
    assert sum(dec(t["amount"]) for t in refunds) == deposit
    for amount in (REFUND_FIRST, REFUND_RACE, last_amount):
        assert len(wait_mail(mail, owner.email, subject=f"Refund of {money(amount, 'USD')} on {order['number']}")) == 1
    assert owner.http.get(f"/api/orders/{oid}").json()["state"] == "deposit_paid"


def test_account_credits(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    staff = studio(app_url)
    path = f"/api/studio/accounts/{owner.account_id}/credits"
    credit, reason = "50.00", "verifier goodwill"
    for amount in ("0", "-5.00", "1.234"):
        r = staff.post(path, json={"amount": amount, "currency": "USD", "reason": reason}, headers=keyed())
        assert r.status_code == 422 and "amount" in r.json()["fields"]
    r = staff.post(path, json={"amount": credit, "currency": "ARS", "reason": reason}, headers=keyed())
    assert r.status_code == 422 and r.json()["fields"]["currency"] == f"Credits must be in {order['currency']}."
    fresh, _ = new_owner(app_url, "launch-page", "USD")
    r = staff.post(f"/api/studio/accounts/{fresh.account_id}/credits", json={"amount": credit, "currency": "USD", "reason": reason}, headers=keyed())
    assert r.status_code == 409 and error_of(r) == "no_billing_account"
    key = idempotency_key()
    r = staff.post(path, json={"amount": credit, "currency": "USD", "reason": reason}, headers=keyed(key))
    assert r.status_code == 201, r.text
    assert r.json()["credit"]["amount"] == credit and r.json()["credit"]["currency"] == "USD" and r.json()["accountCredit"] == credit
    replay = staff.post(path, json={"amount": credit, "currency": "USD", "reason": reason}, headers=keyed(key))
    assert replay.headers.get("Idempotent-Replayed") == "true" and replay.json() == r.json()
    notices = wait_mail(mail, owner.email, subject=f"Account credit of {money(credit, 'USD')}")
    assert len(notices) == 1 and reason in mail_text(notices[0])
    to_balance_invoiced(app_url, order)
    invoice = invoices_with(killbill, kb_id(killbill, owner.account_id), f"{order['number']} launch balance")[0]
    due = Decimal(order["dueAtLaunch"]) - Decimal(credit)
    assert dec(invoice["amount"]) == Decimal(order["dueAtLaunch"]) and dec(invoice["balance"]) == due
    r = pay(owner.http, order["id"])
    assert r.status_code == 201 and Decimal(r.json()["payment"]["amount"]) == due
    assert dec(killbill.payment_by_key(f"{order['id']}-balance")["transactions"][-1]["amount"]) == due


def open_refund_dialog(page: Page, number: str) -> Locator:
    row = page.get_by_role("table", name="Orders").get_by_role("row").filter(has_text=number)
    click(row.get_by_role("button", name="Refund"))
    dialog = page.get_by_role("dialog", name="Issue refund")
    wait_ui(page, lambda: on_screen(dialog), "refund dialog")
    choose(dialog.get_by_role("radiogroup", name="Payment").get_by_role("radio", name="Deposit"))
    return dialog


def test_wf_refunds_credits_partial_refund(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    with browse(browser, app_url, "/studio", cookie=studio(app_url).cookies[SESSION_COOKIE]) as page:
        dialog = open_refund_dialog(page, order["number"])
        left = Decimal(order["dueNow"]) - REFUND_FIRST
        fill(dialog.get_by_label("Amount"), f"{REFUND_FIRST:.2f}")
        fill(dialog.get_by_label("Reason"), "verifier refund")
        click(dialog.get_by_role("button", name="Issue refund"))
        wait_text(page, page.get_by_role("status", name="Refund status"),
                  f"Refunded {money(REFUND_FIRST, 'USD')}. {money(left, 'USD')} left on this payment.")
        wait_ui(page, lambda: shows(dialog, f"Refunded so far {money(REFUND_FIRST, 'USD')}")
                and shows(dialog, f"Left on this payment {money(left, 'USD')}"), "refunded and left figures")
    assert [dec(t["amount"]) for t in succeeded(killbill, kb_id(killbill, owner.account_id), "REFUND")] == [REFUND_FIRST]


def test_wf_refunds_credits_over_cap(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    with browse(browser, app_url, "/studio", cookie=studio(app_url).cookies[SESSION_COOKIE]) as page:
        dialog = open_refund_dialog(page, order["number"])
        deposit = Decimal(order["dueNow"])
        fill(dialog.get_by_label("Amount"), f"{deposit + CENT:.2f}")
        fill(dialog.get_by_label("Reason"), "verifier refund")
        click(dialog.get_by_role("button", name="Issue refund"))
        copy = f"That is more than the {money(deposit, 'USD')} left on this payment."
        wait_ui(page, lambda: copy in text_of(page.locator("body")), "over-cap copy")
        assert succeeded(killbill, kb_id(killbill, owner.account_id), "REFUND") == []
        fill(dialog.get_by_label("Amount"), f"{deposit:.2f}")
        click(dialog.get_by_role("button", name="Issue refund"))
        wait_ui(page, lambda: shows(dialog, f"Left on this payment {money(Decimal(0), 'USD')}"), "nothing left")
    assert [dec(t["amount"]) for t in succeeded(killbill, kb_id(killbill, owner.account_id), "REFUND")] == [deposit]


def test_care_plan_purchase(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = new_owner(app_url, "care-lite", "USD")
    r = pay(owner.http, order["id"])
    assert r.status_code == 201 and r.json()["order"]["state"] == "paid_in_full", r.text
    account = kb_id(killbill, owner.account_id)
    sub = care_subscription(killbill, account)
    assert sub["planName"] == "care-lite-monthly" and sub.get("chargedThroughDate"), sub
    assert sub.get("bundleExternalKey") == f"care-{order['id']}"
    payment = killbill.payment_by_key(f"{order['id']}-care")
    assert kinds(payment) == ["AUTHORIZE", "CAPTURE"] and dec(payment["transactions"][-1]["amount"]) == Decimal(USD_PRICES["care-lite"])
    paid = [inv for inv in killbill.invoices(account) if dec(inv["amount"]) == Decimal(USD_PRICES["care-lite"])]
    assert paid and dec(paid[0]["balance"]) == 0
    plan = owner.http.get("/api/plan").json()["plan"]
    assert plan["status"] == "active" and plan["tier"] == "lite" and plan["monthlyPrice"] == USD_PRICES["care-lite"]
    assert plan["chargedThrough"] == sub["chargedThroughDate"][:10] and plan["periodStart"] == server_now(app_url).date().isoformat()
    assert f"portal/{order['id']}/.portal" in S3().keys(f"portal/{order['id']}/")
    receipts = wait_mail(mail, owner.email, subject=f"Receipt {order['number']}: {money(USD_PRICES['care-lite'], 'USD')}")
    assert len(receipts) == 1 and "Care plan" in mail_text(receipts[0])


def test_plan_change_preview(browser: Browser, app_url: str) -> None:
    owner, _ = paid_owner(app_url, "care-plus", "USD")
    assert owner.http.post("/api/plan/previews", json={"tier": "plus"}).status_code == 422
    r = owner.http.post("/api/plan/previews", json={"tier": "lite"})
    assert r.status_code == 201, r.text
    p = r.json()
    assert (p["fromTier"], p["toTier"], p["currency"]) == ("plus", "lite", "USD")
    credit, charge, total = Decimal(p["credit"]), Decimal(p["charge"]), Decimal(p["total"])
    days, period = p["daysLeft"], p["daysInPeriod"]
    assert 0 < days <= period and credit < 0 < charge and total == credit + charge
    assert abs(credit + Decimal(USD_PRICES["care-plus"]) * days / period) < CENT
    assert abs(charge - Decimal(USD_PRICES["care-lite"]) * days / period) < CENT
    share = (abs(credit) / (abs(credit) + charge) * 100).quantize(Decimal("0.1"), ROUND_HALF_UP)
    assert Decimal(str(p["creditShare"])) == share and instant(p["expiresAt"]) > server_now(app_url)

    with browse(browser, app_url, "/portal/plan", cookie=owner.cookie) as page:
        switch = page.get_by_role("button", name="Switch to Care Lite")
        wait_ui(page, lambda: switch.count() == 1, "plan page loaded")
        status = page.get_by_role("status", name="Plan status")
        dialog = page.get_by_role("dialog", name="Confirm plan change")
        with held(page, "**/api/plan/previews") as hold:
            click(switch)
            wait_ui(page, lambda: on_screen(dialog), "plan change dialog")
            quote = dialog.get_by_role("region", name="Quote")
            assert quote.get_attribute("data-state") == "quoting"
            wait_text(page, status, PRORATING)
            assert dialog.get_by_role("button", name="Confirm change").is_disabled()
            with page.expect_response("**/api/plan/previews") as info:
                hold.release()
        ui = info.value.json()
        wait_text(page, status, f"Credit {money(ui['credit'], 'USD')}, new plan charge {money(ui['charge'], 'USD')}, total {money(ui['total'], 'USD')}.")
        wait_ui(page, lambda: money(ui["credit"], "USD") in text_of(quote.get_by_role("group", name="Credit"))
                and money(ui["charge"], "USD") in text_of(quote.get_by_role("group", name="New plan charge")), "sheet figures")
        assert dialog.get_by_role("button", name="Confirm change").is_enabled()


def test_confirmed_change_equals_preview(app_url: str, killbill: Any, mail: Any) -> None:
    owner, order = paid_owner(app_url, "care-lite", "USD")
    p = owner.http.post("/api/plan/previews", json={"tier": "plus"}).json()
    key = idempotency_key()
    r = owner.http.post("/api/plan/changes", json={"previewId": p["previewId"]}, headers=keyed(key))
    assert r.status_code == 200, r.text
    assert r.json()["plan"]["tier"] == "plus" and r.json()["plan"]["planName"] == "Care Plus"
    assert r.json()["invoice"]["kind"] == "change" and r.json()["invoice"]["amount"] == p["total"]
    replay = owner.http.post("/api/plan/changes", json={"previewId": p["previewId"]}, headers=keyed(key))
    assert replay.headers.get("Idempotent-Replayed") == "true" and replay.json() == r.json()
    account = kb_id(killbill, owner.account_id)
    assert care_subscription(killbill, account)["planName"] == "care-plus-monthly"
    change = [inv for inv in killbill.invoices(account) if any(i.get("itemType") == "REPAIR_ADJ" for i in inv.get("items", []))]
    assert len(change) == 1
    items = change[0]["items"]
    assert any(i["itemType"] == "REPAIR_ADJ" and dec(i["amount"]) == Decimal(p["credit"]) for i in items)
    assert any(dec(i["amount"]) == Decimal(p["charge"]) for i in items)
    payment = killbill.payment_by_key(f"{p['previewId']}-change")
    assert kinds(payment) == ["AUTHORIZE", "CAPTURE"] and dec(payment["transactions"][-1]["amount"]) == Decimal(p["total"])
    receipts = wait_mail(mail, owner.email, subject=f"Receipt {order['number']}: {money(p['total'], 'USD')}")
    assert len(receipts) == 1 and "Plan change" in mail_text(receipts[0])


def test_plan_change_refusals(app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-plus", "ARS")
    p = owner.http.post("/api/plan/previews", json={"tier": "lite"}).json()
    raise_price(app_url, "care-lite", "5000.00")
    r = owner.http.post("/api/plan/changes", json={"previewId": p["previewId"]}, headers=keyed())
    assert r.status_code == 409 and error_of(r) == "preview_stale" and r.json()["message"] == PREVIEW_STALE_COPY
    assert Decimal(r.json()["preview"]["charge"]) > Decimal(p["charge"])
    assert care_subscription(killbill, kb_id(killbill, owner.account_id))["planName"] == "care-plus-monthly"

    short = base_of(SHORT)
    owner2, _ = paid_owner(short, "care-lite", "USD")
    p2 = owner2.http.post("/api/plan/previews", json={"tier": "plus"}).json()
    wait_past(short, p2["expiresAt"], "preview expiry")
    r = owner2.http.post("/api/plan/changes", json={"previewId": p2["previewId"]}, headers=keyed())
    assert r.status_code == 409 and error_of(r) == "preview_expired" and r.json()["message"] == PREVIEW_EXPIRED_COPY
    assert care_subscription(killbill, kb_id(killbill, owner2.account_id))["planName"] == "care-lite-monthly"


def open_change(page: Page, tier: str) -> tuple[Locator, str]:
    switch = page.get_by_role("button", name=f"Switch to Care {tier}")
    wait_ui(page, lambda: switch.count() == 1, "plan page loaded")
    with page.expect_response("**/api/plan/previews") as info:
        click(switch)
    p = info.value.json()
    sentence = f"Credit {money(p['credit'], p['currency'])}, new plan charge {money(p['charge'], p['currency'])}, total {money(p['total'], p['currency'])}."
    wait_text(page, page.get_by_role("status", name="Plan status"), sentence)
    return page.get_by_role("dialog", name="Confirm plan change"), sentence


def test_preview_survives_timers(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-plus", "USD")
    with browse(browser, app_url, "/portal/plan", cookie=owner.cookie) as page:
        traffic = Traffic(page)
        dialog, sentence = open_change(page, "Lite")
        confirm = dialog.get_by_role("button", name="Confirm change")
        confirm.focus()
        for _ in range(2):
            advance(page, PLAN_REFRESH_MS + STEP_MS)
            traffic.quiet()
            assert on_screen(dialog) and confirm.is_enabled()
            assert dialog.evaluate("d => d.contains(document.activeElement)")
            assert text_of(page.get_by_role("status", name="Plan status")) == sentence
        click(confirm)
        wait_text(page, page.get_by_role("status", name="Plan status"), "Your plan is now Care Lite.")
    assert care_subscription(killbill, kb_id(killbill, owner.account_id))["planName"] == "care-lite-monthly"


def test_wf_care_change_keyboard(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-plus", "USD")
    with browse(browser, app_url, "/portal/plan", cookie=owner.cookie) as page:
        wait_ui(page, lambda: page.get_by_role("button", name="Switch to Care Lite").count() == 1, "plan page")
        tab_to(page, "Switch to Care Lite")
        with page.expect_response("**/api/plan/previews"):
            page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Confirm plan change")
        confirm = dialog.get_by_role("button", name="Confirm change")
        wait_ui(page, lambda: confirm.is_enabled(), "figures shown")
        tab_to(page, "Confirm change")
        page.keyboard.press("Enter")
        wait_text(page, page.get_by_role("status", name="Plan status"), "Your plan is now Care Lite.")
        wait_ui(page, lambda: hidden_or_gone(dialog), "dialog closed")
        wait_ui(page, lambda: focused(page.get_by_role("button", name="Switch to Care Plus")), "focus on the switch")
        assert path_of(page) == "/portal/plan"
        page.reload()
        expect(page.get_by_role("button", name="Switch to Care Plus")).to_be_visible()
    assert care_subscription(killbill, kb_id(killbill, owner.account_id))["planName"] == "care-lite-monthly"
    assert owner.http.get("/api/plan").json()["plan"]["tier"] == "lite"


def test_wf_care_change_dismiss(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-lite", "USD")
    with browse(browser, app_url, "/portal/plan", cookie=owner.cookie) as page:
        dialog, _ = open_change(page, "Plus")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: hidden_or_gone(dialog), "dialog closed by Escape")
        dialog, _ = open_change(page, "Plus")
        click(dialog.get_by_role("button", name="Keep current plan"))
        wait_ui(page, lambda: hidden_or_gone(dialog), "dialog closed by Keep current plan")
        assert path_of(page) == "/portal/plan"
    assert care_subscription(killbill, kb_id(killbill, owner.account_id))["planName"] == "care-lite-monthly"


def status_line(page: Page) -> Locator:
    return page.get_by_text(re.compile(r"^Status: "))


def status_text(label: str) -> str:
    return f"Status: {label}"


def test_billing_confirmed_plan_state(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-lite", "USD")
    sub = care_subscription(killbill, kb_id(killbill, owner.account_id))
    plan = owner.http.get("/api/plan").json()["plan"]
    assert plan["chargedThrough"] == sub["chargedThroughDate"][:10]
    assert [i["status"] for i in owner.http.get("/api/invoices").json()["invoices"]] == ["paid"]
    down = owner.clone(base_of(KB_DOWN))
    for r in (down.get("/api/plan"), down.get("/api/invoices"), down.post("/api/plan/pause", json={}, headers=keyed())):
        assert r.status_code == 503 and error_of(r) == "billing_unavailable"
    assert owner.http.get("/api/plan").json()["plan"]["pauseOn"] is None
    with browse(browser, base_of(KB_DOWN), "/portal/plan", cookie=owner.cookie) as page:
        wait_ui(page, lambda: PLAN_READ_OUTAGE_COPY in text_of(page.locator("body")), "plan outage copy")
        assert status_line(page).count() == 0 and page.get_by_role("button", name="Pause plan").count() == 0
    with browse(browser, app_url, "/portal/plan", cookie=owner.cookie) as page:
        wait_ui(page, lambda: text_of(status_line(page).first) == status_text("Active"), "active status")
        with held(page, "**/api/plan/pause") as hold:
            click(page.get_by_role("button", name="Pause plan"))
            wait_text(page, page.get_by_role("status", name="Plan status"), CONFIRMING)
            assert text_of(status_line(page).first) == status_text("Active")
            hold.release()
        wait_text(page, status_line(page).first, f"Status: Pauses on {long_date(plan['chargedThrough'])}")


def test_pause_and_resume(app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-plus", "USD")
    through = care_subscription(killbill, kb_id(killbill, owner.account_id))["chargedThroughDate"][:10]
    key = idempotency_key()
    r = owner.http.post("/api/plan/pause", json={}, headers=keyed(key))
    assert r.status_code == 200 and r.json()["plan"]["pauseOn"] == through and r.json()["plan"]["status"] == "active"
    replay = owner.http.post("/api/plan/pause", json={}, headers=keyed(key))
    assert replay.headers.get("Idempotent-Replayed") == "true" and replay.json() == r.json()
    r = owner.http.post("/api/plan/cancel", json={}, headers=keyed())
    assert r.status_code == 409 and error_of(r) == "invalid_transition"
    r = owner.http.post("/api/plan/resume", json={}, headers=keyed())
    assert r.status_code == 200 and r.json()["plan"]["pauseOn"] is None and r.json()["plan"]["status"] == "active"
    assert owner.http.get("/api/plan").json()["plan"]["pauseOn"] is None
    r = owner.http.post("/api/plan/resume", json={}, headers=keyed())
    assert r.status_code == 409 and error_of(r) == "invalid_transition"


def test_resume_paused_plan(app_url: str, killbill: Any) -> None:
    http = signed_in(app_url, *NOAH)
    assert http.get("/api/plan").json()["plan"]["status"] == "paused"
    r = http.post("/api/plan/resume", json={}, headers=keyed())
    assert r.status_code == 200 and r.json()["plan"]["status"] == "active", r.text
    today = server_now(app_url).date().isoformat()
    assert r.json()["plan"]["periodStart"] == today
    sub = care_subscription(killbill, kb_id(killbill, me(http)["accountId"]))
    assert sub["chargedThroughDate"][:10] > today == r.json()["plan"]["periodStart"]


def test_end_of_term_cancel(app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-plus", "USD")
    r = owner.http.post("/api/plan/cancel", json={}, headers=keyed())
    assert r.status_code == 200, r.text
    plan = r.json()["plan"]
    sub = care_subscription(killbill, kb_id(killbill, owner.account_id))
    assert plan["status"] == "pending_cancel"
    assert plan["endsOn"] == sub["chargedThroughDate"][:10] == (sub.get("billingEndDate") or "")[:10]
    assert plan["endsOn"] > server_now(app_url).date().isoformat()
    for action in ("cancel", "pause"):
        r = owner.http.post(f"/api/plan/{action}", json={}, headers=keyed())
        assert r.status_code == 409 and error_of(r) == "invalid_transition"


def test_wf_care_pause_cancel_happy(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-lite", "USD")
    account = kb_id(killbill, owner.account_id)
    day = long_date(care_subscription(killbill, account)["chargedThroughDate"])
    with browse(browser, app_url, "/portal/plan", cookie=owner.cookie) as page:
        status = page.get_by_role("status", name="Plan status")
        wait_ui(page, lambda: text_of(status_line(page).first) == status_text("Active"), "active")
        click(page.get_by_role("button", name="Pause plan"))
        wait_text(page, status, f"Your plan pauses on {day}.")
        wait_text(page, status_line(page).first, f"Status: Pauses on {day}")
        assert path_of(page) == "/portal/plan"
        click(page.get_by_role("button", name="Resume plan"))
        wait_text(page, status, PLAN_ACTIVE_AGAIN)
        wait_text(page, status_line(page).first, status_text("Active"))
        click(page.get_by_role("button", name="Cancel plan"))
        click(page.get_by_role("dialog", name="Cancel care plan").get_by_role("button", name="Cancel at period end"))
        wait_text(page, status, f"Your plan ends on {day}.")
        assert path_of(page) == "/portal/plan"
        page.reload()
        wait_text(page, status_line(page).first, f"Status: Ends on {day}")
    sub = care_subscription(killbill, account)
    assert sub["billingEndDate"][:10] == sub["chargedThroughDate"][:10]


def test_wf_care_pause_cancel_keep_plan(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-lite", "USD")
    with browse(browser, app_url, "/portal/plan", cookie=owner.cookie) as page:
        wait_ui(page, lambda: text_of(status_line(page).first) == status_text("Active"), "active")
        click(page.get_by_role("button", name="Cancel plan"))
        dialog = page.get_by_role("dialog", name="Cancel care plan")
        click(dialog.get_by_role("button", name="Keep plan"))
        wait_ui(page, lambda: hidden_or_gone(dialog), "dialog closed")
        assert text_of(status_line(page).first) == status_text("Active") and path_of(page) == "/portal/plan"
    assert not care_subscription(killbill, kb_id(killbill, owner.account_id)).get("billingEndDate")


def test_wf_care_pause_cancel_outage(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, _ = paid_owner(app_url, "care-plus", "USD")
    with browse(browser, base_of(KB_DOWN), "/portal/plan", cookie=owner.cookie) as page:
        wait_ui(page, lambda: PLAN_READ_OUTAGE_COPY in text_of(page.locator("body")), "outage copy")
        for name in ("Pause plan", "Cancel plan", "Switch to Care Lite"):
            assert page.get_by_role("button", name=name).count() == 0
    assert owner.http.get("/api/plan").json()["plan"]["status"] == "active"


def fresh_database() -> str:
    url = urlsplit(os.environ["DATABASE_URL"])
    name = f"{url.path.lstrip('/')}_dun{uuid.uuid4().hex[:8]}"
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGHOST": url.hostname or "", "PGPORT": str(url.port or 5432),
           "PGDATABASE": url.path.lstrip("/"), "PGUSER": unquote(url.username or ""),
           "PGPASSWORD": unquote(url.password or "")}
    result = subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}"'],
                            env=env, capture_output=True, text=True, timeout=HTTP_TIMEOUT_S, check=False)
    assert result.returncode == 0, result.stderr
    return urlunsplit(url._replace(path=f"/{name}"))


def steady(probe: Callable[[], Any], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    while time.monotonic() < deadline:
        assert probe(), what
        pause.wait(POLL_S)
    assert probe(), what


def test_renewal_dunning(killbill: Any, mail: Any) -> None:
    overrides = {"DUNNING_DAY_SECONDS": SHORT_DUNNING_DAY_S, "DATABASE_URL": fresh_database(),
                 "S3_BUCKET": f"{os.environ['S3_BUCKET']}-short", "MAIL_FROM": DUNNING_COPY_FROM}

    def notices(n: int) -> list[dict[str, Any]]:
        return [m for m in inbox(mail, RAMIRO[0], subject=f"Care plan payment failed (attempt {n} of 3)")
                if DUNNING_COPY_ADDRESS in addresses(m.get("From"))]

    with app_copy(overrides) as (first, _), app_copy(overrides) as (second, _):
        http = signed_in(first, *RAMIRO)

        def cancelled() -> dict[str, Any] | None:
            r = http.get("/api/plan")
            return r.json()["plan"] if r.status_code == 200 and r.json()["plan"]["status"] == "cancelled" else None

        plan = eventually(cancelled, DUNNING_WAIT_S, "plan cancelled after the third attempt")
        assert plan["failedAttempts"] == 3
        assert signed_in(second, *RAMIRO).get("/api/plan").json()["plan"]["status"] == "cancelled"
        sub = care_subscription(killbill, kb_id(killbill, me(http)["accountId"]))
        assert sub["state"].lower() == "cancelled"
        for n in (1, 2, 3):
            eventually(lambda n=n: notices(n), MAIL_WAIT_S, f"dunning notice {n} of 3 to {RAMIRO[0]}")
        steady(lambda: all(len(notices(n)) == 1 for n in (1, 2, 3)), MAIL_DELAY_S, "one notice per attempt")
    assert "/portal/plan" in mail_text(notices(3)[0])


def test_card_update_settles_past_due(app_url: str, killbill: Any, mail: Any) -> None:
    http = signed_in(app_url, *LUCIA)
    assert http.get("/api/plan").json()["plan"]["status"] == "past_due"
    account = kb_id(killbill, me(http)["accountId"])
    open_invoice = next(inv for inv in killbill.invoices(account) if dec(inv["balance"]) > 0)
    dunning_before = len(inbox(mail, LUCIA[0], prefix="Care plan payment failed"))
    r = http.post("/api/plan/card", json={"card": CARD_DECLINE}, headers=keyed())
    assert r.status_code == 402 and error_of(r) == "card_declined"
    assert http.get("/api/plan").json()["plan"]["status"] == "past_due"
    key = idempotency_key()
    r = http.post("/api/plan/card", json={"card": CARD_OK}, headers=keyed(key))
    assert r.status_code == 200 and r.json()["plan"]["status"] == "active", r.text
    replay = http.post("/api/plan/card", json={"card": CARD_OK}, headers=keyed(key))
    assert replay.headers.get("Idempotent-Replayed") == "true"
    payment = killbill.payment_by_key(f"{open_invoice['invoiceId']}-renewal")
    assert payment and kinds(payment)[-1] == "CAPTURE" and dec(payment["transactions"][-1]["amount"]) == Decimal(PANADERIA_RENEWAL[1])
    assert all(dec(inv["balance"]) == 0 for inv in killbill.invoices(account))
    number, amount = PANADERIA_RENEWAL
    assert len(wait_mail(mail, LUCIA[0], subject=f"Receipt {number}: {money(amount, 'ARS')}")) == 1
    assert len(inbox(mail, LUCIA[0], prefix="Care plan payment failed")) == dunning_before


def test_wf_dunning_recovery(browser: Browser, app_url: str, killbill: Any) -> None:
    http = signed_in(app_url, *RAMIRO)
    with browse(browser, app_url, "/portal/plan", cookie=http.cookies[SESSION_COOKIE]) as page:
        banner = page.get_by_role("alert").filter(has_text=PAST_DUE_COPY)
        wait_ui(page, lambda: on_screen(banner), "past-due banner")
        assert text_of(status_line(page).first) == status_text("Past due")
        status = page.get_by_role("status", name="Plan status")
        for card in (CARD_DECLINE, CARD_OK):
            tab_to(page, "Card number")
            page.keyboard.press("ControlOrMeta+A")
            page.keyboard.type(card["number"])
            page.keyboard.press("Tab")
            page.keyboard.press("ControlOrMeta+A")
            page.keyboard.type(card["expiry"])
            page.keyboard.press("Tab")
            page.keyboard.press("ControlOrMeta+A")
            page.keyboard.type(card["cvc"])
            tab_to(page, "Update card and pay")
            page.keyboard.press("Enter")
            if card is CARD_DECLINE:
                wait_ui(page, lambda: DECLINED_COPY in text_of(page.locator("body")), "declined copy")
        wait_text(page, status, CARD_PAID_COPY)
        wait_text(page, status_line(page).first, status_text("Active"))
        assert path_of(page) == "/portal/plan"
    account = kb_id(killbill, me(http)["accountId"])
    assert all(dec(inv["balance"]) == 0 for inv in killbill.invoices(account))


def test_wf_dunning_exhausted(browser: Browser, killbill: Any) -> None:
    short = base_of(SHORT)
    http = signed_in(short, *LUCIA)
    eventually(lambda: http.get("/api/plan").json()["plan"]["status"] == "cancelled", DUNNING_WAIT_S, "cancelled plan")
    with browse(browser, short, "/portal/plan", cookie=http.cookies[SESSION_COOKIE]) as page:
        wait_ui(page, lambda: text_of(status_line(page).first) == status_text("Cancelled"), "cancelled status")
        assert page.get_by_role("button", name="Update card and pay").count() == 0
    assert care_subscription(killbill, kb_id(killbill, me(http)["accountId"]))["state"].lower() == "cancelled"


UPLOAD_CASES = {
    "png": ("{tag}-logo.png", "png", 201, None),
    "jpeg": ("{tag}-photo.jpg", "jpeg", 201, None),
    "webp": ("{tag}-photo.webp", "webp", 201, None),
    "pdf": ("{tag}-brief.pdf", "pdf", 201, None),
    "woff2": ("{tag}-face.woff2", "woff2", 201, None),
    "svg": ("{tag}-mark.svg", "svg", 201, None),
    "at_limit": ("{tag}-big.png", "at_limit", 201, None),
    "oversized": ("{tag}-huge.png", "oversized", 413, "file_too_large"),
    "renamed_exe": ("{tag}-logo.png", "exe", 415, "unsupported_file_type"),
    "svg_script": ("{tag}-s.svg", "svg_script", 415, "unsupported_file_type"),
    "svg_handler": ("{tag}-h.svg", "svg_handler", 415, "unsupported_file_type"),
    "svg_js_href": ("{tag}-j.svg", "svg_js", 415, "unsupported_file_type"),
    "svg_foreign_object": ("{tag}-f.svg", "svg_foreign", 415, "unsupported_file_type"),
    "wrong_extension": ("{tag}-logo.pdf", "png", 415, "unsupported_file_type"),
    "traversal": ("../{tag}-logo.png", "png", 422, None),
    "leading_dot": (".{tag}-logo.png", "png", 422, None),
    "long_name": ("{tag}{long}.png", "png", 422, None),
}


def payload(kind: str) -> bytes:
    svg_open = b'<svg xmlns="http://www.w3.org/2000/svg">'
    return {
        "png": PNG, "jpeg": JPEG, "webp": WEBP, "pdf": PDF, "woff2": WOFF2, "svg": SVG, "exe": EXE,
        "at_limit": PNG + b"\x00" * (MAX_FILE_BYTES - len(PNG)),
        "oversized": PNG + b"\x00" * (MAX_FILE_BYTES + 1 - len(PNG)),
        "svg_script": svg_open + b"<script>alert(1)</script></svg>",
        "svg_handler": b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
        "svg_js": svg_open + b'<a href="javascript:alert(1)"><rect/></a></svg>',
        "svg_foreign": svg_open + b"<foreignObject><div>x</div></foreignObject></svg>",
    }[kind]


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=list(UPLOAD_CASES))
def test_upload_allowlist(app_url: str, case: str) -> None:
    template, kind, status, code = UPLOAD_CASES[case]
    tag, _ = identity("up")
    name = template.format(tag=tag, long="a" * NAME_MAX)
    owner, order = paid_owner(app_url, "launch-page", "USD")
    data = payload(kind)
    r = upload(owner.http, order["projectId"], "assets", name, data, "image/png")
    assert r.status_code == status, r.text[:500]
    keys = S3().keys(f"portal/{order['id']}/assets/")
    if status == 201:
        file = r.json()
        assert file["name"] == name and file["size"] == len(data) and file["kind"] == "asset"
        key = f"portal/{order['id']}/assets/{file['id']}/{name}"
        assert keys == [key] and len(S3().get(key)) == len(data)
        return
    assert keys == [], keys
    if code:
        assert error_of(r) == code
    if status == 422:
        assert "file" in r.json()["fields"]
    assets = owner.http.get(f"/api/projects/{order['projectId']}").json()["assets"]
    assert assets == []


def test_upload_progress_announced(browser: Browser, app_url: str) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    tag, _ = identity("prog")
    good = f"{tag}-hero.png"
    with browse(browser, app_url, f"/portal/projects/{order['projectId']}", cookie=owner.cookie) as page:
        status = page.get_by_role("status", name="Upload status")
        wait_ui(page, lambda: status.count() == 1, "project page")
        expect(page.get_by_text(ALLOWLIST_SENTENCE, exact=True)).to_be_visible()
        status.evaluate("""el => {
          window.__said = [];
          const push = t => { const v = (t || '').trim().replace(/\\s+/g, ' ');
            if (v && window.__said[window.__said.length - 1] !== v) window.__said.push(v); };
          push(el.textContent);
          new MutationObserver(records => {
            for (const r of records) {
              if (r.type === 'characterData') push(r.oldValue);
              else r.removedNodes.forEach(n => push(n.textContent));
            }
            push(el.textContent);
          }).observe(el, {childList: true, subtree: true, characterData: true, characterDataOldValue: true});
        }""")
        cdp = session(page)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0,
                                                      "downloadThroughput": -1, "uploadThroughput": UPLOAD_THROTTLE_BPS})
        field = page.get_by_label("Upload brand asset")
        field.set_input_files({"name": good, "mimeType": "image/png", "buffer": PNG + b"\x00" * (MAX_FILE_BYTES // 2)}, timeout=FILE_SET_TIMEOUT_MS)
        wait_ui(page, lambda: f"Uploaded {good}." in page.evaluate("() => window.__said"), "upload success")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0,
                                                      "downloadThroughput": -1, "uploadThroughput": -1})
        said = [norm(s) for s in page.evaluate("() => window.__said")]
        steps = [said.index(f"Uploading {good}: {p}%") for p in (0, 25, 50, 75, 100)]
        assert steps == sorted(steps) and steps[-1] < said.index(f"Uploaded {good}."), said
        for name, data, copy in ((f"{tag}-tool.png", EXE, f"{tag}-tool.png is not an accepted file type."),
                                 (f"{tag}-huge.png", payload("oversized"), f"{tag}-huge.png is larger than 10 MB."),
                                 (f".{tag}.png", PNG, NAME_REFUSED_COPY)):
            field.set_input_files({"name": name, "mimeType": "image/png", "buffer": data}, timeout=FILE_SET_TIMEOUT_MS)
            wait_text(page, status, copy)
    keys = S3().keys(f"portal/{order['id']}/assets/")
    assert len(keys) == 1 and keys[0].endswith(f"/{good}")


def test_download_links(app_url: str) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    tag, _ = identity("dl")
    name = f"{tag}-logo.png"
    file = upload(owner.http, order["projectId"], "assets", name, PNG).json()
    r = issue_link(owner.http, file["id"])
    assert r.status_code == 201, r.text
    url, expires = r.json()["url"], instant(r.json()["expiresAt"])
    assert timedelta(0) < expires - server_now(app_url) <= timedelta(seconds=DOWNLOAD_LINK_S + LATENCY_S)
    endpoint = urlsplit(os.environ.get("S3_ENDPOINT", "")).netloc
    assert not endpoint or endpoint not in url
    got = owner.http.get(link_path(url))
    assert got.status_code == 200 and got.content == PNG
    assert "png" in got.headers["content-type"].lower()
    assert got.headers["content-disposition"] == f'attachment; filename="{name}"'
    assert got.headers["x-content-type-options"] == "nosniff"
    other, _ = new_owner(app_url, "launch-page", "USD")
    assert other.http.get(link_path(url)).status_code == 404
    assign(app_url, order["projectId"], DANA[0])
    dana = signed_in(app_url, *DANA)
    dana_url = issue_link(dana, file["id"]).json()["url"]
    assert dana.get(link_path(dana_url)).status_code == 200
    r = studio(app_url).delete(f"/api/studio/projects/{order['projectId']}/assignments/{contractor_id(app_url, DANA[0])}")
    assert r.status_code == 204
    assert dana.get(link_path(dana_url)).status_code == 404


def test_download_link_expiry(app_url: str) -> None:
    short = base_of(SHORT)
    owner, order = paid_owner(short, "launch-page", "USD")
    file = upload(owner.http, order["projectId"], "assets", f"{identity('exp')[0]}.png", PNG).json()
    link = issue_link(owner.http, file["id"]).json()
    wait_past(short, link["expiresAt"], "link expiry")
    r = owner.http.get(link_path(link["url"]))
    assert r.status_code == 410 and error_of(r) == "link_expired" and r.json()["message"] == LINK_EXPIRED_COPY


def test_invoice_pdfs(app_url: str, killbill: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    kb_invoice = invoices_with(killbill, kb_id(killbill, owner.account_id), f"{order['number']} deposit")[0]
    key = f"portal/{order['id']}/invoices/{kb_invoice['invoiceId']}.pdf"
    eventually(lambda: key in S3().keys(f"portal/{order['id']}/invoices/"), PDF_DELAY_S + LATENCY_S, "deposit PDF in MinIO")
    stored = S3().get(key)
    assert stored.startswith(b"%PDF-")
    invoice = eventually(lambda: next((i for i in owner.http.get("/api/invoices").json()["invoices"]
                                       if i["orderId"] == order["id"] and i["pdf"]), None), LATENCY_S, "pdf flag")
    assert invoice["kind"] == "deposit" and invoice["status"] == "paid" and invoice["amount"] == order["dueNow"]
    assert str(invoice["number"]) == str(kb_invoice["invoiceNumber"])
    link = owner.http.post(f"/api/invoices/{invoice['id']}/links", json={})
    assert link.status_code == 201, link.text
    got = owner.http.get(link_path(link.json()["url"]))
    assert got.status_code == 200 and got.content == stored
    assert got.headers["content-disposition"].startswith("attachment")


def test_wf_portal_files_happy(browser: Browser, app_url: str, killbill: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    tag, _ = identity("files")
    deliverable = f"{tag}-homepage.png"
    assert upload(studio(app_url), order["projectId"], "deliverables", deliverable, PNG).status_code == 201
    eventually(lambda: any(i["pdf"] for i in owner.http.get("/api/invoices").json()["invoices"] if i["orderId"] == order["id"]),
               PDF_DELAY_S + LATENCY_S, "invoice PDF stored")
    number = next(i["number"] for i in owner.http.get("/api/invoices").json()["invoices"] if i["orderId"] == order["id"])
    asset = f"{tag}-logo.svg"
    with browse(browser, app_url, f"/portal/projects/{order['projectId']}", cookie=owner.cookie) as page:
        page.get_by_label("Upload brand asset").set_input_files({"name": asset, "mimeType": "image/svg+xml", "buffer": SVG}, timeout=FILE_SET_TIMEOUT_MS)
        wait_text(page, page.get_by_role("status", name="Upload status"), f"Uploaded {asset}.")
        wait_ui(page, lambda: asset in text_of(page.get_by_role("region", name="Brand assets")), "asset listed")
        with page.expect_download() as info:
            click(page.get_by_role("region", name="Deliverables").get_by_role("button", name=f"Download {deliverable}"))
        assert Path(info.value.path()).read_bytes() == PNG
        page.goto(f"{app_url}/portal/invoices")
        with page.expect_download() as info:
            click(page.get_by_role("table", name="Invoices").get_by_role("button", name=f"Download invoice {number}"))
        assert Path(info.value.path()).read_bytes().startswith(b"%PDF-")
    keys = [k for k in S3().keys(f"portal/{order['id']}/assets/") if k.endswith(f"/{asset}")]
    assert len(keys) == 1 and S3().get(keys[0]) == SVG


def test_wf_portal_files_refused(browser: Browser, app_url: str) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    tag, _ = identity("refuse")
    with browse(browser, app_url, f"/portal/projects/{order['projectId']}", cookie=owner.cookie) as page:
        status = page.get_by_role("status", name="Upload status")
        for name, data in ((f"{tag}-logo.png", EXE), (f"{tag}-mark.svg", payload("svg_script"))):
            page.get_by_label("Upload brand asset").set_input_files({"name": name, "mimeType": "image/png", "buffer": data}, timeout=FILE_SET_TIMEOUT_MS)
            wait_text(page, status, f"{name} is not an accepted file type.")
    assert S3().keys(f"portal/{order['id']}/assets/") == []


def test_wf_portal_files_storage_outage(browser: Browser, app_url: str) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    name = f"{identity('s3')[0]}-logo.png"
    relay = Relay(os.environ["S3_ENDPOINT"])
    try:
        with app_copy({"S3_ENDPOINT": relay.url}) as (base, tail):
            with browse(browser, base, f"/portal/projects/{order['projectId']}", cookie=owner.cookie) as page:
                field = page.get_by_label("Upload brand asset")
                status = page.get_by_role("status", name="Upload status")
                wait_ui(page, lambda: field.count() == 1, f"project page; log:\n{tail()}")
                field.set_input_files({"name": name, "mimeType": "image/png", "buffer": PNG}, timeout=FILE_SET_TIMEOUT_MS)
                wait_text(page, status, STORAGE_UPLOAD_COPY)
                assert S3().keys(f"portal/{order['id']}/assets/") == []
                relay.start()
                field.set_input_files({"name": name, "mimeType": "image/png", "buffer": PNG}, timeout=FILE_SET_TIMEOUT_MS)
                wait_text(page, status, f"Uploaded {name}.", RECOVERY_S + LATENCY_S)
    finally:
        relay.stop()
    keys = S3().keys(f"portal/{order['id']}/assets/")
    assert len(keys) == 1 and keys[0].endswith(f"/{name}")


def invite_teammate(owner: Owner, project_id: str, mail: Any) -> tuple[httpx.Client, str]:
    _, email = identity("mate")
    r = owner.http.post(f"/api/projects/{project_id}/invites", json={"email": email})
    assert r.status_code == 201, r.text
    token = invite_token(mail, email)
    mate = client(owner.base)
    r = mate.post(f"/api/invites/{token}/accept", json={"name": "Verifier Mate", "password": PASSWORD})
    assert r.status_code == 201, r.text
    return mate, email


def test_teammate_invites(app_url: str, mail: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    pid = order["projectId"]
    r = owner.http.post(f"/api/projects/{pid}/invites", json={"email": BRUNO[0]})
    assert r.status_code == 422 and r.json()["fields"]["email"] == EXISTING_SIGN_IN_COPY
    _, email = identity("mate")
    r = owner.http.post(f"/api/projects/{pid}/invites", json={"email": email})
    assert r.status_code == 201 and r.json()["invite"]["email"] == email
    message = wait_mail(mail, email, subject=f"Join {owner.business} on Pampero Ledger")
    assert len(message) == 1
    token = invite_token(mail, email)
    assert token not in r.text
    info = client(app_url).get(f"/api/invites/{token}")
    assert info.status_code == 200 and info.json()["businessName"] == owner.business and info.json()["email"] == email
    assert client(app_url).post(f"/api/invites/{token}/accept", json={"name": "Mate", "password": "short"}).status_code == 422
    mate = client(app_url)
    r = mate.post(f"/api/invites/{token}/accept", json={"name": "Verifier Mate", "password": PASSWORD})
    assert r.status_code == 201 and r.json()["projectId"] == pid
    assert r.json()["user"]["role"] == "teammate" and r.json()["user"]["accountId"] == owner.account_id
    assert me(mate)["role"] == "teammate" and me(signed_in(app_url, email, PASSWORD))["id"] == r.json()["user"]["id"]
    for again in (client(app_url).get(f"/api/invites/{token}"),
                  client(app_url).post(f"/api/invites/{token}/accept", json={"name": "Again", "password": PASSWORD})):
        assert again.status_code == 409 and error_of(again) == "invite_used"
    _, racer = identity("race")
    owner.http.post(f"/api/projects/{pid}/invites", json={"email": racer})
    token2 = invite_token(mail, racer)
    results = together(*[lambda: client(app_url).post(f"/api/invites/{token2}/accept", json={"name": "Racer", "password": PASSWORD}) for _ in range(2)])
    assert sorted(r.status_code for r in results) == [201, 409]


def test_invite_expiry(mail: Any) -> None:
    short = base_of(SHORT)
    owner, order = paid_owner(short, "launch-page", "USD")
    _, email = identity("late")
    r = owner.http.post(f"/api/projects/{order['projectId']}/invites", json={"email": email})
    assert r.status_code == 201
    token = invite_token(mail, email)
    wait_past(short, r.json()["invite"]["expiresAt"], "invite expiry")
    for res in (client(short).get(f"/api/invites/{token}"),
                client(short).post(f"/api/invites/{token}/accept", json={"name": "Late", "password": PASSWORD})):
        assert res.status_code == 410 and error_of(res) == "invite_expired"


def test_teammate_scope(app_url: str, mail: Any) -> None:
    owner, first = paid_owner(app_url, "launch-page", "USD")
    second = another_paid(owner, "studio-site", "USD")
    asset = upload(owner.http, first["projectId"], "assets", f"{identity('own')[0]}.png", PNG).json()
    mate, _ = invite_teammate(owner, first["projectId"], mail)
    visible = {p["id"] for p in mate.get("/api/projects").json()["projects"]}
    assert {first["projectId"], second["projectId"]} <= visible
    assert mate.get(f"/api/projects/{second['projectId']}").status_code == 200
    name = f"{identity('mate')[0]}-logo.png"
    up = upload(mate, second["projectId"], "assets", name, PNG)
    assert up.status_code == 201
    assert any(k.endswith(f"/{name}") for k in S3().keys(f"portal/{second['id']}/assets/"))
    link = issue_link(mate, asset["id"])
    assert link.status_code == 201 and mate.get(link_path(link.json()["url"])).content == PNG
    exe = upload(mate, second["projectId"], "assets", f"{identity('x')[0]}.png", EXE)
    assert exe.status_code == 415 and error_of(exe) == "unsupported_file_type"
    assert len(S3().keys(f"portal/{second['id']}/assets/")) == 1
    invoice_id = owner.http.get("/api/invoices").json()["invoices"][0]["id"]
    for r in (mate.get("/api/orders"), mate.get(f"/api/orders/{first['id']}"), mate.get("/api/invoices"),
              mate.get("/api/plan"), mate.post(f"/api/invoices/{invoice_id}/links", json={}),
              mate.post(f"/api/projects/{first['projectId']}/invites", json={"email": identity("x")[1]}),
              upload(mate, first["projectId"], "deliverables", "d.png", PNG)):
        assert r.status_code == 403 and error_of(r) == "forbidden", r.text


def test_wf_teammates_invite_journey(browser: Browser, app_url: str, mail: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    pid = order["projectId"]
    _, email = identity("joiner")
    with browse(browser, app_url, f"/portal/projects/{pid}", cookie=owner.cookie) as page:
        click(page.get_by_role("button", name="Invite teammate"))
        dialog = page.get_by_role("dialog", name="Invite teammate")
        fill(dialog.get_by_label("Email"), email)
        click(dialog.get_by_role("button", name="Send invite"))
        wait_text(page, page.get_by_role("status", name="Invite status"), f"Invite sent to {email}.")
    token = invite_token(mail, email)
    with browse(browser, app_url, f"/invite/{token}") as page:
        wait_ui(page, lambda: owner.business in text_of(page.locator("body")), "invite shows the business")
        click(page.get_by_role("textbox").first)
        page.keyboard.type("Verifier Joiner")
        page.keyboard.press("Tab")
        page.keyboard.type(PASSWORD)
        page.keyboard.press("Enter")
        wait_ui(page, lambda: path_of(page) == f"/portal/projects/{pid}", "landed on the project")
        page.reload()
        assert path_of(page) == f"/portal/projects/{pid}"
    user = me(signed_in(app_url, email, PASSWORD))
    assert user["role"] == "teammate" and user["accountId"] == owner.account_id


def test_wf_teammates_existing_email(browser: Browser, app_url: str, mail: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    with browse(browser, app_url, f"/portal/projects/{order['projectId']}", cookie=owner.cookie) as page:
        click(page.get_by_role("button", name="Invite teammate"))
        dialog = page.get_by_role("dialog", name="Invite teammate")
        fill(dialog.get_by_label("Email"), BRUNO[0])
        click(dialog.get_by_role("button", name="Send invite"))
        wait_ui(page, lambda: EXISTING_SIGN_IN_COPY in text_of(dialog), "field message")
    assert inbox(mail, BRUNO[0], subject=f"Join {owner.business} on Pampero Ledger") == []


def test_contractor_scope(app_url: str) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    _, hidden = paid_owner(app_url, "launch-page", "USD")
    asset = upload(owner.http, order["projectId"], "assets", f"{identity('c')[0]}.png", PNG).json()
    dana = signed_in(app_url, *DANA)
    assert dana.get(f"/api/projects/{order['projectId']}").status_code == 404
    staff = studio(app_url)
    path = f"/api/studio/projects/{order['projectId']}/assignments"
    cid = contractor_id(app_url, DANA[0])
    assert staff.post(path, json={"contractorId": cid}).status_code == 201
    assert staff.post(path, json={"contractorId": cid}).status_code == 200
    visible = {p["id"] for p in dana.get("/api/projects").json()["projects"]}
    assert order["projectId"] in visible and hidden["projectId"] not in visible
    project = dana.get(f"/api/projects/{order['projectId']}")
    assert project.status_code == 200 and [a["id"] for a in project.json()["assets"]] == [asset["id"]]
    assert dana.get(link_path(issue_link(dana, asset["id"]).json()["url"])).content == PNG
    name = f"{identity('d')[0]}-mockup.png"
    assert upload(dana, order["projectId"], "deliverables", name, PNG).status_code == 201
    assert any(k.endswith(f"/{name}") for k in S3().keys(f"portal/{order['id']}/deliverables/"))
    scripted = upload(dana, order["projectId"], "deliverables", f"{identity('d')[0]}.svg", payload("svg_script"))
    assert scripted.status_code == 415
    assert upload(dana, order["projectId"], "assets", "a.png", PNG).status_code == 403
    assert dana.get(f"/api/projects/{hidden['projectId']}").status_code == 404
    for r in (dana.get(f"/api/orders/{order['id']}"), dana.get(f"/api/invoices/{uuid.uuid4()}")):
        assert r.status_code == 404
    for r in (dana.get("/api/orders"), dana.get("/api/invoices"), dana.get("/api/plan")):
        assert r.status_code == 403
    assert staff.delete(f"{path}/{cid}").status_code == 204
    assert dana.get(f"/api/projects/{order['projectId']}").status_code == 404


def closed_project(base: str, contractor: tuple[str, str]) -> tuple[Owner, dict[str, Any], dict[str, Any], httpx.Client, str]:
    owner, order = paid_owner(base, "launch-page", "USD")
    asset = upload(owner.http, order["projectId"], "assets", f"{identity('cl')[0]}.png", PNG).json()
    assign(base, order["projectId"], contractor[0])
    worker = signed_in(base, *contractor)
    assert worker.get(f"/api/projects/{order['projectId']}").status_code == 200
    staff = to_balance_invoiced(base, order)
    assert pay(owner.http, order["id"]).status_code == 201
    link = issue_link(worker, asset["id"]).json()["url"]
    assert move(staff, order["id"], "closed").status_code == 200
    return owner, order, asset, worker, link


def test_access_ends_at_close(app_url: str) -> None:
    owner, order, asset, tomas, link = closed_project(app_url, TOMAS)
    for r in (tomas.get(f"/api/projects/{order['projectId']}"), issue_link(tomas, asset["id"]), tomas.get(link_path(link))):
        assert r.status_code == 403 and error_of(r) == "access_ended", r.text
    assert order["projectId"] not in {p["id"] for p in tomas.get("/api/projects").json()["projects"]}
    r = studio(app_url).post(f"/api/studio/projects/{order['projectId']}/assignments", json={"contractorId": contractor_id(app_url, DANA[0])})
    assert r.status_code == 409 and error_of(r) == "project_closed"
    r = upload(owner.http, order["projectId"], "assets", "late.png", PNG)
    assert r.status_code == 409 and error_of(r) == "project_closed"


NOT_FOUND_CASES = ["order", "project", "invoice", "file", "invite", "body"]


@pytest.mark.parametrize("case", NOT_FOUND_CASES, ids=NOT_FOUND_CASES)
def test_uniform_not_found(browser: Browser, app_url: str, case: str) -> None:
    owner_a, order_a = paid_owner(app_url, "launch-page", "USD")
    owner_b, _ = paid_owner(app_url, "launch-page", "USD")
    unknown, malformed = str(uuid.uuid4()), "not-a-uuid"
    http, pages = owner_b.http, []
    if case == "order":
        foreign_quote = new_order(client(app_url), "launch-page", "USD")["id"]
        ids = [order_a["id"], foreign_quote, unknown, malformed]
        calls = [lambda i=i: http.get(f"/api/orders/{i}") for i in ids]
        pages = [f"/orders/{i}/receipt" for i in ids] + [f"/checkout/{i}" for i in ids]
    elif case == "project":
        ids = [order_a["projectId"], unknown, malformed]
        calls = [lambda i=i: http.get(f"/api/projects/{i}") for i in ids]
        pages = [f"/portal/projects/{i}" for i in ids]
    elif case == "invoice":
        ids = [owner_a.http.get("/api/invoices").json()["invoices"][0]["id"], unknown, malformed]
        calls = [lambda i=i: http.get(f"/api/invoices/{i}") for i in ids] + [lambda i=i: http.post(f"/api/invoices/{i}/links", json={}) for i in ids]
    elif case == "file":
        file_id = upload(owner_a.http, order_a["projectId"], "assets", f"{identity('nf')[0]}.png", PNG).json()["id"]
        calls = [lambda i=i: http.post(f"/api/files/{i}/links", json={}) for i in (file_id, unknown, malformed)]
    elif case == "invite":
        calls = [lambda t=t: http.get(f"/api/invites/{t}") for t in (uuid.uuid4().hex, malformed)]
        pages = [f"/invite/{uuid.uuid4().hex}"]
    else:
        http = studio(app_url)
        path = f"/api/studio/projects/{order_a['projectId']}/assignments"
        calls = [lambda i=i: http.post(path, json={"contractorId": i}) for i in (unknown, malformed, me(owner_a.http)["id"])]
    responses = [call() for call in calls]
    assert all(r.status_code == 404 for r in responses), [r.status_code for r in responses]
    assert all(r.json() == responses[0].json() for r in responses) and responses[0].json()["error"] == "not_found"
    if pages:
        with browse(browser, app_url, "/", cookie=owner_b.cookie) as page:
            for path in pages:
                assert_not_found_page(page, page.goto(f"{app_url}{path}"))


def test_wf_contractor_access_journey(browser: Browser, app_url: str) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    tag, _ = identity("dana")
    asset = f"{tag}-palette.pdf"
    upload(owner.http, order["projectId"], "assets", asset, PDF)
    assign(app_url, order["projectId"], DANA[0])
    deliverable = f"{tag}-mockup.png"
    with browse(browser, app_url, "/sign-in") as page:
        fill(page.get_by_label("Email", exact=True), DANA[0])
        fill(page.get_by_label("Password", exact=True), DANA[1])
        click(page.get_by_role("button", name="Sign in"))
        wait_ui(page, lambda: path_of(page) == "/portal", "contractor portal")
        project_path = f"/portal/projects/{order['projectId']}"
        wait_ui(page, lambda: follow_link_to(page, project_path), "a link to the assigned project")
        wait_ui(page, lambda: path_of(page) == project_path, "project page")
        with page.expect_download() as info:
            click(page.get_by_role("region", name="Brand assets").get_by_role("button", name=f"Download {asset}"))
        assert Path(info.value.path()).read_bytes() == PDF
        page.get_by_label("Upload deliverable").set_input_files({"name": deliverable, "mimeType": "image/png", "buffer": PNG}, timeout=FILE_SET_TIMEOUT_MS)
        wait_text(page, page.get_by_role("status", name="Upload status"), f"Uploaded {deliverable}.")
    seen = owner.http.get(f"/api/projects/{order['projectId']}").json()["deliverables"]
    assert [f["name"] for f in seen] == [deliverable]
    assert any(k.endswith(f"/{deliverable}") for k in S3().keys(f"portal/{order['id']}/deliverables/"))


def test_wf_contractor_access_closed_page(browser: Browser, app_url: str) -> None:
    _, order, _, tomas, _ = closed_project(app_url, TOMAS)
    with browse(browser, app_url, "/", cookie=tomas.cookies[SESSION_COOKIE]) as page:
        response = page.goto(f"{app_url}/portal/projects/{order['projectId']}")
        assert response.status == 403
        expect(page.get_by_role("heading", name=ACCESS_ENDED_HEADING, exact=True)).to_be_visible()
    assert error_of(tomas.get(f"/api/projects/{order['projectId']}")) == "access_ended"


def test_wf_outage_recovery_billing_checkout(browser: Browser, app_url: str, killbill: Any) -> None:
    body = account_body("outage")
    down = base_of(KB_DOWN)
    with browse(browser, app_url, "/") as page:
        order = browser_order(page, app_url, "launch-page", "USD")
        page.goto(f"{app_url}/checkout/{order['id']}")
        fill_accept(page, body)
        page.context.add_cookies([{"name": SESSION_COOKIE, "value": page_cookie(page), "url": down}])
        page.goto(f"{down}/checkout/{order['id']}")
        fill_card(page, CARD_OK)
        button = page.get_by_role("button", name=f"Pay {money(order['dueNow'], 'USD')}")
        click(button)
        banner = page.get_by_role("alert").filter(has_text=BILLING_OUTAGE_COPY)
        wait_ui(page, lambda: on_screen(banner), "billing outage banner")
        assert text_of(banner) == BILLING_OUTAGE_COPY
        expect(page.get_by_label("Card number")).to_have_value(CARD_OK["number"])
        expect(page.get_by_label("Expiry (MM/YY)")).to_have_value(EXPIRY)
        expect(page.get_by_label("CVC")).to_have_value(CVC)
        user = page.request.get(f"{app_url}/api/me").json()["user"]
        assert unbilled(killbill, user["accountId"])
        assert S3().keys(f"portal/{order['id']}/") == []
        page.goto(f"{app_url}/checkout/{order['id']}")
        fill_card(page, CARD_OK)
        click(page.get_by_role("button", name=f"Pay {money(order['dueNow'], 'USD')}"))
        wait_ui(page, lambda: path_of(page) == f"/orders/{order['id']}/receipt", "receipt route")
    account = kb_id(killbill, user["accountId"])
    assert len(succeeded(killbill, account, "CAPTURE")) == 1
    assert all(dec(inv["balance"]) == 0 for inv in killbill.invoices(account))
    live = [inv for inv in invoices_with(killbill, account, f"{order['number']} deposit") if inv["status"].lower() != "void"]
    assert len(live) == 1, "the failed attempt left a billing record behind"


def test_wf_outage_recovery_mail_checkout(browser: Browser, killbill: Any, mail: Any) -> None:
    down = base_of(MAIL_DOWN)
    body = account_body("nomail")
    with browse(browser, down, "/") as page:
        order = browser_order(page, down, "launch-page", "USD")
        page.goto(f"{down}/checkout/{order['id']}")
        fill_accept(page, body)
        fill_card(page, CARD_OK)
        click(page.get_by_role("button", name=f"Pay {money(order['dueNow'], 'USD')}"))
        wait_ui(page, lambda: path_of(page) == f"/orders/{order['id']}/receipt", "receipt route")
        user = page.request.get(f"{down}/api/me").json()["user"]
    assert len(succeeded(killbill, kb_id(killbill, user["accountId"]), "CAPTURE")) == 1
    receipts = wait_mail(mail, body["email"], subject=f"Receipt {order['number']}: {money(order['dueNow'], 'USD')}")
    assert len(receipts) == 1


def test_storage_and_mail_outages(app_url: str, mail: Any) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    file = upload(owner.http, order["projectId"], "assets", f"{identity('o')[0]}.png", PNG).json()
    link = issue_link(owner.http, file["id"]).json()["url"]
    down = owner.clone(base_of(MINIO_DOWN))
    r = upload(down, order["projectId"], "assets", f"{identity('o')[0]}-2.png", PNG)
    assert r.status_code == 503 and error_of(r) == "storage_unavailable" and r.json()["message"] == STORAGE_UPLOAD_COPY
    r = down.get(link_path(link))
    assert r.status_code == 503 and error_of(r) == "storage_unavailable"
    assert len(S3().keys(f"portal/{order['id']}/assets/")) == 1
    owner2, order2 = new_owner(base_of(MAIL_DOWN), "launch-page", "USD")
    r = pay(owner2.http, order2["id"])
    assert r.status_code == 201, r.text
    _, invitee = identity("q")
    assert owner2.http.post(f"/api/projects/{r.json()['order']['projectId']}/invites", json={"email": invitee}).status_code == 201
    assert len(wait_mail(mail, owner2.email, prefix=f"Receipt {order2['number']}:")) == 1
    assert len(wait_mail(mail, invitee, prefix="Join ")) == 1


def test_recovery_without_restart(app_url: str) -> None:
    owner, order = paid_owner(app_url, "launch-page", "USD")
    for case, env in (("killbill", KB_DOWN), ("minio", MINIO_DOWN)):
        outage = base_of(env)
        health = client(outage).get("/api/health")
        assert health.status_code == 200 and health.json()["status"] == "ok"
        services = health.json()["services"]
        assert services[case] == "down" and all(v == "up" for k, v in services.items() if k != case), (case, services)
    kb_down, minio_down = base_of(KB_DOWN), base_of(MINIO_DOWN)
    assert client(kb_down).get("/api/case-studies").status_code == 200
    assert upload(owner.clone(kb_down), order["projectId"], "assets", f"{identity('r')[0]}.png", PNG).status_code == 201
    assert client(minio_down).post("/api/quotes", json={"plan": "launch-page", "currency": "USD"}).status_code == 200

    relay = Relay(os.environ["KILLBILL_URL"])
    try:
        with app_copy({"KILLBILL_URL": relay.url}) as (base, tail):
            assert client(base).get("/api/health").json()["services"]["killbill"] == "down", tail()
            action = lambda: client(base).post("/api/quotes", json={"plan": "launch-page", "currency": "USD"})
            refused = action()
            assert refused.status_code == 503 and error_of(refused) == "billing_unavailable", tail()
            relay.start()
            eventually(lambda: action().status_code == 200, RECOVERY_S, f"billing recovery; log:\n{tail()}")
            assert client(base).get("/api/health").json()["services"]["killbill"] == "up"
            assert action().json()["total"] == USD_PRICES["launch-page"]
    finally:
        relay.stop()


def test_health_and_serving(browser: Browser, app_url: str) -> None:
    started = time.monotonic()
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert time.monotonic() - started < HEALTH_BUDGET_S
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert set(r.json()["services"]) == {"postgres", "killbill", "minio", "mailpit", "pocketbase"}
    assert all(v == "up" for v in r.json()["services"].values())
    clock = client(app_url).get("/api/clock").json()
    assert clock["zone"] == ZONE and instant(clock["now"]).utcoffset() == timedelta(hours=-3)
    sources = ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts")
    for path in sources:
        served = httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S)
        assert served.status_code == 404 and "run-manifest-v1" not in served.text, path
    with browse(browser, app_url, "/api/clock") as page:
        for path in sources:
            assert_not_found_page(page, page.goto(f"{app_url}{path}"))
    r = client(app_url).get(f"/api/{uuid.uuid4().hex}")
    assert r.status_code == 404 and error_of(r) == "not_found"
    r = client(app_url).post("/api/quotes", content=b"plan=launch-page", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and error_of(r) == "unsupported_media_type"
    r = client(app_url).post("/api/quotes", json={"plan": "launch-page", "currency": "USD", "pad": "x" * JSON_LIMIT})
    assert r.status_code == 413 and error_of(r) == "payload_too_large"


def test_sign_in_and_sessions(app_url: str) -> None:
    anon = client(app_url)
    for path in ("/api/me", "/api/orders", "/api/plan", "/api/invoices", "/api/projects", "/api/studio/orders"):
        r = anon.get(path)
        assert r.status_code == 401 and error_of(r) == "unauthenticated", path
    r = anon.post("/api/session", json={"email": STUDIO[0], "password": "not-the-password"})
    assert r.status_code == 401 and error_of(r) == "invalid_credentials" and r.json()["message"] == SIGN_IN_ERROR_COPY
    http = client(app_url)
    r = http.post("/api/session", json={"email": STUDIO[0], "password": STUDIO[1]})
    assert r.status_code == 200 and r.json()["user"]["role"] == "studio_owner"
    cookie = r.headers["set-cookie"]
    assert SESSION_COOKIE in cookie
    assert re.search("HttpOnly", cookie, re.IGNORECASE) and re.search("SameSite=Lax", cookie, re.IGNORECASE), cookie
    assert http.get("/api/studio/orders").status_code == 200
    r = signed_in(app_url, *MARIELA).get("/api/studio/orders")
    assert r.status_code == 403 and error_of(r) == "forbidden"
    assert http.delete("/api/session").status_code == 204 and http.get("/api/me").status_code == 401
    for path in ("/portal", "/portal/plan", "/studio"):
        r = httpx.get(f"{app_url}{path}", follow_redirects=False, timeout=HTTP_TIMEOUT_S)
        target = urlsplit(r.headers.get("location", ""))
        assert r.is_redirect and target.path == "/sign-in" and parse_qs(target.query)["next"] == [path]
    r = post_json(app_url, "/api/orders", {"plan": "launch-page", "currency": "USD"}, Origin="http://elsewhere.test")
    assert r.status_code == 403 and r.json()["error"] == "cross_origin"


DIALOG_CASES = ["menu", "invite", "plan_change", "cancel_plan", "refund", "currency_shortcut"]


def trap(page: Page, opener: Locator, dialog_name: str) -> None:
    wait_ui(page, lambda: opener.count() == 1 and opener.is_enabled(), f"opener for {dialog_name}")
    opener.focus()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name=dialog_name)
    wait_ui(page, lambda: on_screen(dialog), f"{dialog_name} opens")
    advance(page, DIALOG_SETTLE_MS)
    inside = lambda: dialog.evaluate("d => d.contains(document.activeElement)")
    assert inside(), "focus not moved into the dialog"
    for key in ["Tab"] * TRAP_PRESSES + ["Shift+Tab"] * TRAP_PRESSES:
        page.keyboard.press(key)
        assert inside(), f"{key} escaped {dialog_name}"
    page.keyboard.press("Escape")
    wait_ui(page, lambda: hidden_or_gone(dialog), f"{dialog_name} closes on Escape")
    wait_ui(page, lambda: focused(opener), "focus back on the opener")


@pytest.mark.parametrize("case", DIALOG_CASES, ids=DIALOG_CASES)
def test_keyboard_dialogs(browser: Browser, app_url: str, case: str) -> None:
    if case == "menu":
        with browse(browser, app_url, "/", size=VIEWPORTS["375"]) as page:
            trap(page, page.get_by_role("button", name="Menu"), "Menu")
    elif case in ("invite",):
        owner, order = paid_owner(app_url, "launch-page", "USD")
        with browse(browser, app_url, f"/portal/projects/{order['projectId']}", cookie=owner.cookie) as page:
            trap(page, page.get_by_role("button", name="Invite teammate"), "Invite teammate")
    elif case in ("plan_change", "cancel_plan"):
        owner, _ = paid_owner(app_url, "care-plus", "USD")
        with browse(browser, app_url, "/portal/plan", cookie=owner.cookie) as page:
            if case == "plan_change":
                trap(page, page.get_by_role("button", name="Switch to Care Lite"), "Confirm plan change")
            else:
                trap(page, page.get_by_role("button", name="Cancel plan"), "Cancel care plan")
    elif case == "refund":
        _, order = paid_owner(app_url, "launch-page", "USD")
        with browse(browser, app_url, "/studio", cookie=studio(app_url).cookies[SESSION_COOKIE]) as page:
            row = page.get_by_role("table", name="Orders").get_by_role("row").filter(has_text=order["number"])
            trap(page, row.get_by_role("button", name="Refund"), "Issue refund")
    else:
        with browse(browser, app_url, "/") as page:
            currency = page.get_by_role("radiogroup", name="Currency")
            usd, ars = currency.get_by_role("radio", name="USD"), currency.get_by_role("radio", name="ARS")
            expect(usd).to_be_checked()
            page.get_by_role("button", name="Choose Care").focus()
            with page.expect_request("**/api/quotes"):
                page.keyboard.press("c")
            expect(ars).to_be_checked()
            page.keyboard.press("c")
            expect(usd).to_be_checked()
            page.get_by_role("link", name="Skip to content").focus()
            page.keyboard.press("c")
            advance(page, DIALOG_SETTLE_MS)
            expect(usd).to_be_checked()


SCENE_JS = """name => {
  const el = Array.from(document.getElementsByTagName('*')).find(e => e.hasAttribute('data-scene-section'));
  return el ? el.getAttribute(name) : null;
}"""


def scene_attr(page: Page, name: str) -> str | None:
    return page.evaluate(SCENE_JS, name)


def test_studio_scene(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        wait_ui(page, lambda: scene_attr(page, "data-scene-mode") == "webgl", "WebGL scene")
        advance(page, CATCHUP_MS)
        assert camera(page), "the stage uploaded no camera or model matrices"
        assert scene_attr(page, "data-scene-section") == "hero"
        t0 = float(scene_attr(page, "data-scene-turn"))
        advance(page, TURN_PROBE_MS)
        delta = (float(scene_attr(page, "data-scene-turn")) - t0) % 360
        seconds = TURN_PROBE_MS / 1000
        assert seconds * 360 / TURN_MAX_S - TURN_TOL_DEG <= delta <= seconds * 360 / TURN_MIN_S + TURN_TOL_DEG, delta
        height = page.evaluate("() => document.documentElement.scrollHeight - innerHeight")
        positions = [round(height * i / SCROLL_STEPS) for i in range(SCROLL_STEPS + 1)]
        forward, sections = {}, []
        for y in positions:
            page.evaluate("y => window.scrollTo(0, y)", y)
            advance(page, CATCHUP_MS)
            forward[y] = (scene_attr(page, "data-scene-section"), camera(page))
            sections.append(forward[y][0])
        order = [s for i, s in enumerate(sections) if i == 0 or s != sections[i - 1]]
        assert order == ["hero", "work", "process", "pricing", "contact"], sections
        still = camera(page)
        advance(page, HOLD_MS)
        assert same_matrices(still, camera(page)), "camera moved without scrolling"
        scrolled = [y for y in positions if forward[y][0] != "hero"]
        assert not same_matrices(forward[scrolled[0]][1], forward[scrolled[-1]][1]), "camera ignores scroll"
        for y in reversed(scrolled):
            page.evaluate("y => window.scrollTo(0, y)", y)
            advance(page, CATCHUP_MS)
            assert same_matrices(camera(page), forward[y][1]), f"reverse path differs at {y}"


def test_studio_scene_reduced_and_still(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        wait_ui(page, lambda: scene_attr(page, "data-scene-turn") is not None, "scene")
        t0 = scene_attr(page, "data-scene-turn")
        advance(page, TURN_PROBE_MS)
        assert scene_attr(page, "data-scene-turn") == t0
        top, size = page.get_by_role("region", name="Work").evaluate("e => [e.getBoundingClientRect().top + scrollY, e.offsetHeight]")
        groups: dict[str, list[Any]] = {}
        for share in (0.1, 0.3, 0.5, 0.7):
            page.evaluate("y => window.scrollTo(0, y)", round(top + size * share))
            advance(page, CATCHUP_MS)
            groups.setdefault(scene_attr(page, "data-scene-section"), []).append(camera(page))
        assert any(len(cams) > 1 for cams in groups.values())
        for cams in groups.values():
            assert all(same_matrices(cams[0], c) for c in cams)
    with browse(browser, app_url, "/", no_webgl=True) as page:
        wait_ui(page, lambda: scene_attr(page, "data-scene-mode") == "still", "still mode")
        quote = page.get_by_role("region", name="Quote")
        click(page.get_by_role("button", name="Choose Launch Page"))
        wait_ui(page, lambda: sheet(quote)["now"] == [Decimal("739.99")], "quote works without WebGL")


CLOCK_RE = re.compile(r"^Studio time (\d{2}):(\d{2}):(\d{2})$")


def clock_seconds(page: Page) -> int:
    match = CLOCK_RE.match(text_of(page.get_by_role("timer", name="Studio time")))
    assert match, text_of(page.get_by_role("timer", name="Studio time"))
    h, m, s = map(int, match.groups())
    return h * 3600 + m * 60 + s


def test_footer_studio_clock(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        timer = page.get_by_role("timer", name="Studio time")
        wait_ui(page, lambda: CLOCK_RE.match(text_of(timer)), "studio clock")
        shown = clock_seconds(page)
        now = server_now(app_url)
        server = now.hour * 3600 + now.minute * 60 + now.second
        assert (server - shown) % 86400 <= CLOCK_SKEW_S, (shown, server)
        advance(page, 1000)
        assert (clock_seconds(page) - shown) % 86400 == 1
        advance(page, 4000)
        assert (clock_seconds(page) - shown) % 86400 == 5


def test_wf_cross_cutting_sign_in_landing(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/sign-in") as page:
        fill(page.get_by_label("Email", exact=True), STUDIO[0])
        fill(page.get_by_label("Password", exact=True), "not-the-password")
        click(page.get_by_role("button", name="Sign in"))
        wait_ui(page, lambda: text_of(page.get_by_role("alert").filter(has_text=SIGN_IN_ERROR_COPY)) == SIGN_IN_ERROR_COPY, "sign-in error")
        fill(page.get_by_label("Password", exact=True), STUDIO[1])
        click(page.get_by_role("button", name="Sign in"))
        wait_ui(page, lambda: path_of(page) == "/studio", "studio landing")
    with browse(browser, app_url, "/portal/invoices") as page:
        wait_ui(page, lambda: path_of(page) == "/sign-in", "redirected to sign-in")
        fill(page.get_by_label("Email", exact=True), MARIELA[0])
        fill(page.get_by_label("Password", exact=True), MARIELA[1])
        click(page.get_by_role("button", name="Sign in"))
        wait_ui(page, lambda: path_of(page) == "/portal/invoices", "next honoured")
        assert page.request.get(f"{app_url}/api/me").json()["user"]["role"] == "client_owner"


def test_wf_cross_cutting_clock_everywhere(browser: Browser, app_url: str) -> None:
    for path, creds in (("/portal", MARIELA), ("/studio", STUDIO)):
        with browse(browser, app_url, path, cookie=signed_in(app_url, *creds).cookies[SESSION_COOKIE]) as page:
            wait_ui(page, lambda: CLOCK_RE.match(text_of(page.get_by_role("timer", name="Studio time"))), f"clock on {path}")
            shown = clock_seconds(page)
            advance(page, 1000)
            assert (clock_seconds(page) - shown) % 86400 == 1


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "BlueOak-1.0.0", "OFL-1.1"}
FONTS = ["Bricolage Grotesque", "IBM Plex Sans", "IBM Plex Mono"]
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "out", "coverage"}


def app_files() -> Iterator[Path]:
    for path in Path("/app").rglob("*"):
        if path.is_file() and not SKIP_DIRS & set(path.relative_to("/app").parts):
            yield path


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data.get(k), str) and data[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    assert all(font in notices for font in FONTS)


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad


def test_if_no_extra_datastore() -> None:
    assert not [p.name for p in shipped_packages() if any(d.lower() in p.name.lower() for d in DATASTORES)]
    assert not [str(p) for p in app_files() if DATASTORES[0].lower() in p.name.lower()]


SERVICE_WORDS = ("postgres", "minio", "pocketbase", "killbill", "mailpit", "compose")
OPERAND = r"(/[^\s;|&<>()'\"`]+)"
REDIRECT_TARGET = re.compile(r"(?:^|[\s;|&(])1?>>?\s*" + OPERAND)
TEE_TARGET = re.compile(r"\btee\s+(?:-a\s+)?" + OPERAND)


def service_config_path(path: str) -> bool:
    return (path.startswith("/") and not urlsplit(path).netloc
            and not path.startswith(("/app", "/tmp", "/dev/"))
            and any(word in path.lower() for word in SERVICE_WORDS))


def test_if_service_config_untouched() -> None:
    trajectory = Path("/logs/agent/trajectory.json")
    data = json.loads(trajectory.read_text()) if trajectory.is_file() else []
    touched: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or "").lower()
            args = node.get("input") or node.get("arguments") or node.get("args")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = None
            if isinstance(args, dict):
                target = args.get("file_path") or args.get("path")
                if ("write" in name or "edit" in name) and isinstance(target, str) and service_config_path(target):
                    touched.append(target)
                command = args.get("command") or args.get("cmd")
                if isinstance(command, str):
                    targets = REDIRECT_TARGET.findall(command) + TEE_TARGET.findall(command)
                    touched.extend(p for p in targets if service_config_path(p))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    assert not touched, touched


def test_if_typescript_source() -> None:
    assert any(p.suffix in (".ts", ".tsx") for p in app_files())
    js = [str(p) for p in app_files() if p.suffix in (".js", ".mjs", ".cjs", ".jsx")
          and "config" not in p.name and not p.name.startswith(".")]
    assert not js, js


def test_if_lucide_and_no_models() -> None:
    def icon_package(name: str) -> bool:
        lowered = name.lower()
        if "lucide" in lowered:
            return False
        if lowered.startswith(("@heroicons/", "@fortawesome/", "@tabler/icons", "@mdi/", "@phosphor-icons/", "@iconify/")):
            return True
        return lowered in ("icons", "react-icons", "feather-icons", "ionicons", "bootstrap-icons", "heroicons") or \
            lowered.endswith(("-icons", "/icons", "-icon"))

    icons = [p.name for p in shipped_packages() if icon_package(p.name)]
    assert not icons, icons
    models = [str(p) for p in app_files() if p.suffix.lower() in (".glb", ".gltf", ".obj", ".fbx", ".stl", ".usdz", ".dae", ".ply", ".3ds")]
    assert not models, models


def test_if_no_external_hosts(browser: Browser, app_url: str) -> None:
    for path in ("/", "/journal", "/sign-in"):
        with browse(browser, app_url, "/api/clock") as page:
            requests: list[str] = []
            page.on("request", lambda r: requests.append(r.url))
            page.goto(f"{app_url}{path}")
            page.wait_for_load_state("load")
            foreign = [u for u in requests if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
            assert not foreign, foreign
