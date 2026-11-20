from __future__ import annotations

import contextlib
import importlib
import json
import os
import re
import struct
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

from conftest import (
    advance,
    animations,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    pdf_text,
    same_origin,
    select,
    shipped_packages,
    tab_order,
    tap,
    unique,
)


def _find(name: str) -> Any:
    for module in ("conftest", "mailpit", "minio_client", "minio", "postgres", "killbill", "gotenberg", "clients"):
        try:
            found = importlib.import_module(module)
        except ImportError:
            continue
        if hasattr(found, name):
            return getattr(found, name)
    raise ImportError(name)


DEPLOYED_APP = _find("DEPLOYED_APP")
S3 = _find("S3")
Postgres = _find("Postgres")
addresses = _find("addresses")
mail_from_address = _find("mail_from_address")
text = _find("text")

READING = "Reading copy"
READING_PRICE = 1200
SIGNED = "Signed variant cover"
SIGNED_PRICE = 2500
ORIGINAL = "Original page"
ORIGINAL_PRICE = 18000
SEED_SHIPPING = {"domestic": 350, "europe": 700, "rest_of_world": 1100}
ORIGINAL_SHIPPING = {"domestic": 900, "europe": 1800, "rest_of_world": 3000}
READING_DOMESTIC = 1550
READING_FEES = (78, 67, 1405)
GOAL_MIN = 10000
GOAL_SEED = 240000
SEED_MIN_RUN = 300
STRETCH_SEED = [{"copies": 500, "amount": 340000}, {"copies": 1000, "amount": 560000}]
ADD_ON = 250
ADD_ON_MAX = 50000
KEY_MIN = 32
SALTMARSH = "saltmarsh-nocturnes"
WET_INK = "wet-ink-almanac"
MARA_KEY = "dgk_mara_seed_4f1c0b7a9e2d4c68b3a1"
TOBIAS_KEY = "dgk_tobias_seed_2b9c4e7a1d0f5e83c6"
TEST_CARD = "4242 4242 4242 4242"
DECLINE_CARD = "4000 0000 0000 0002"
CAPTURE_FAIL_CARD = "4000 0000 0000 0341"
UNKNOWN_CARD = "4111 1111 1111 1111"
JUNK_KEY = "x" * 40
MAIL_FROM = "Dotgain by Coldset Works <press@dotgain.example>"
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}

TIER_LIMIT = 8
SHIPPING_MAX = 10000
SPREAD_LIMIT = 6
EDIT_PRICE = 1500
TIER_INVALID = [
    ("title", ""),
    ("title", "x" * 81),
    ("description", "x" * 1001),
    ("price", 99),
    ("price", 1000001),
    ("quantity", 0),
    ("quantity", 100001),
]

GAUGE_RINGS = 8
GAUGE_DOTS = 217
QUOTE_MS = 500
PROOF_MS = 200
RING_STEP_MS = 40
INK_MAX_MS = 1000
TARGET_MIN_PX = 44
GAUGE_MIN_PX = 280
GAUGE_MAX_PX = 420
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
JSON_LIMIT = 65536
UPLOAD_LIMIT = 5000000

SHORT_FINAL_WINDOW_S = 30
SHORT_FIX_WINDOW_S = 40
SHORT_FIX_NOTICE_S = 15
NOTICE_DUE_S = 10
PROBE_S = 10
RETRY_S = 10

DAY_S = 86400
LONG_LEAD_S = 10 * DAY_S
SHORT_LEAD_S = SHORT_FINAL_WINDOW_S + SHORT_FIX_NOTICE_S
GUARD_LEAD_S = 2 * SHORT_FINAL_WINDOW_S
TOO_SOON_S = DAY_S // 24
TOO_FAR_S = 5270400
STORY_REPEAT = 200
BIG_PRICE = 5 * ORIGINAL_PRICE
STRETCH_PRICE = 17 * ORIGINAL_PRICE
RACERS = 6

HTTP_TIMEOUT_S = 60
API_WAIT_S = 30
UI_WAIT_S = 30
UI_STEP_MS = 50
FALLBACK_S = 3
CLOSE_WAIT_S = 120
READY_WAIT_S = 60
FIX_WAIT_S = 120
TAB_LIMIT = 40
POLL_S = 0.25

AUTHORISED = "Pledge authorised: {} held on your card. You are charged only if the run is funded."
CHANGED = "Pledge changed: {} held on your card. The earlier hold was released."
CANCELLED_COPY = "Pledge cancelled. The hold on your card was released."
DECLINED = "Card declined. No hold was placed. Try another card."
SOLD_OUT = "That tier just sold out. No hold was placed."
WOULD_UNFUND = "This change would take a funded run below its minimum in the final 24 hours, so it cannot be made."
PAYMENT_DOWN = "Payment service unavailable. No hold was placed. Try again in a few minutes."
HEADINGS = {
    "funded": "Funded. This run goes to press.",
    "unfunded": "Not funded. No card was charged.",
    "cancelled": "Cancelled by the creator. No card was charged.",
}
BANNERS = {
    "payments": "Payments are unavailable. New pledges and changes are paused; held cards are safe.",
    "email": "Email is delayed. Notices are queued and will be sent when the mail service is back.",
    "storage": "Media storage is unavailable. Uploads and statements are paused.",
    "documents": "Statements are delayed. They will appear once they are rendered.",
}
OUTAGE_ENV = {
    "payments": "APP_KILLBILL_DOWN_URL",
    "email": "APP_MAIL_DOWN_URL",
    "storage": "APP_STORAGE_DOWN_URL",
    "documents": "APP_DOCS_DOWN_URL",
}

_pace = threading.Event()


def pounds(pence: int) -> str:
    return f"£{pence // 100:,}.{pence % 100:02d}"


def pence_of(shown_amount: str) -> int:
    return int(shown_amount.replace("£", "").replace(",", "").replace(".", ""))


def percent(total: int, goal: int) -> int:
    return 100 * total // goal


def fees_for(amount: int) -> tuple[int, int, int]:
    platform = (amount * 5 + 50) // 100
    processing = (amount * 3 + 50) // 100 + 20
    return platform, processing, amount - platform - processing


def _clamp(value: Fraction) -> Fraction:
    return min(max(value, Fraction(0)), Fraction(1))


def _fmt3(value: Fraction) -> str:
    return str((Decimal(value.numerator) / Decimal(value.denominator)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def core_coverage(total: int, goal: int, ring: int) -> str:
    return _fmt3(_clamp(Fraction(9 * total, goal) - ring))


def stretch_coverage(total: int, previous: int, amount: int) -> str:
    return _fmt3(_clamp(Fraction(total - previous, amount - previous)))


def authorised_copy(amount: int) -> str:
    return AUTHORISED.format(pounds(amount))


def changed_copy(amount: int) -> str:
    return CHANGED.format(pounds(amount))


def preview_lines(reward: int, zone_name: str, shipping: int, add_on: int, amount: int, projected: int) -> list[str]:
    return [
        f"Reward: {pounds(reward)}",
        f"Shipping ({zone_name}): {pounds(shipping)}",
        f"Add-on: {pounds(add_on)}",
        f"Pledge total: {pounds(amount)}",
        f"Your pledge would bring this to {projected}%",
    ]


def env_url(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        pytest.fail(f"{name} is not set; the verifier needs that app instance")
    return value.rstrip("/")


def short() -> str:
    return env_url("APP_SHORT_URL")


def api(method: str, base: str, path: str, *, key: str | None = None, body: Any = None, idem: str | None = None,
        content: bytes | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
    sent: dict[str, str] = {}
    if key:
        sent["Authorization"] = f"Bearer {key}"
    if idem:
        sent["Idempotency-Key"] = idem
    sent.update(headers or {})
    extra: dict[str, Any] = {}
    if content is not None:
        extra["content"] = content
    elif body is not None or method in ("POST", "PATCH"):
        extra["json"] = {} if body is None else body
    return httpx.request(method, base + path, headers=sent, timeout=HTTP_TIMEOUT_S, **extra)


def must(response: httpx.Response, status: int) -> Any:
    assert response.status_code == status, f"{response.request.method} {response.request.url} answered {response.status_code}: {response.text[:400]}"
    return response.json() if response.content else None


def error(response: httpx.Response, status: int, code: str) -> None:
    assert response.status_code == status, f"{response.request.method} {response.request.url} answered {response.status_code}, expected {status} {code}: {response.text[:400]}"
    assert response.json().get("error") == code, f"expected error {code!r}, got {response.text[:400]}"


def invalid(response: httpx.Response, field: str) -> None:
    assert response.status_code == 422, f"{response.request.url} answered {response.status_code}, expected 422 on {field}: {response.text[:400]}"
    assert field in (response.json().get("fields") or {}), f"422 lacks field {field!r}: {response.text[:400]}"


def server_now(base: str) -> datetime:
    stamp = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).headers.get("date")
    return parsedate_to_datetime(stamp) if stamp else datetime.now(timezone.utc)


def utc(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def local_deadline(base: str, lead: int, zone: str) -> str:
    return (server_now(base) + timedelta(seconds=lead)).astimezone(ZoneInfo(zone)).strftime("%Y-%m-%dT%H:%M:%S")


def png(shade: int = 0) -> bytes:
    side = 8
    raw = b"".join(b"\x00" + bytes((0x0F, 0x5C + shade % 64, 0x5A)) * side for _ in range(side))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", side, side, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def person(base: str, prefix: str = "backer") -> dict[str, Any]:
    name, email = unique(prefix)
    return must(api("POST", base, "/api/people", body={"name": name, "email": email}), 201)


def fresh() -> tuple[str, str]:
    return unique("backer")


def draft_body(base: str, *, lead: int = LONG_LEAD_S, **fields: Any) -> dict[str, Any]:
    zone = fields.get("time_zone", "Europe/London")
    try:
        deadline = local_deadline(base, lead, zone)
    except (ZoneInfoNotFoundError, ValueError):
        deadline = local_deadline(base, lead, "Europe/London")
    body = {
        "title": unique("Run")[0],
        "story": "A small-press run on an offset press.",
        "goal": GOAL_MIN,
        "min_run_copies": SEED_MIN_RUN,
        "stretch": [],
        "ships_from": "GB",
        "time_zone": zone,
        "deadline_local": deadline,
    }
    body.update(fields)
    return body


def draft(base: str, key: str, **fields: Any) -> dict[str, Any]:
    return must(api("POST", base, "/api/campaigns", key=key, body=draft_body(base, **fields)), 201)


def tier_body(title: str = READING, price: int = READING_PRICE, quantity: int | None = None,
              shipping: dict[str, int] | None = None) -> dict[str, Any]:
    return {"title": title, "description": f"{title} of the run.", "price": price, "quantity": quantity,
            "shipping": dict(shipping or SEED_SHIPPING)}


def upload(base: str, key: str, campaign_id: str, *, kind: str = "cover", data: bytes | None = None,
           content_type: str = "image/png") -> httpx.Response:
    return api("POST", base, f"/api/campaigns/{campaign_id}/media?kind={kind}", key=key,
               content=png() if data is None else data,
               headers={"Content-Type": content_type, "X-Filename": f"{kind}.png"})


def make_live(base: str, tiers: list[dict[str, Any]], *, goal: int = GOAL_MIN, stretch: list[dict[str, int]] | None = None,
              lead: int = LONG_LEAD_S, **fields: Any) -> dict[str, Any]:
    creator = person(base, "creator")
    camp = draft(base, creator["key"], goal=goal, stretch=stretch or [], lead=lead, **fields)
    made = {}
    for body in tiers:
        tier = must(api("POST", base, f"/api/campaigns/{camp['id']}/tiers", key=creator["key"], body=body), 201)
        made[tier["title"]] = tier
    must(upload(base, creator["key"], camp["id"]), 201)
    live = must(api("POST", base, f"/api/campaigns/{camp['id']}/launch", key=creator["key"]), 200)
    assert live["status"] == "live"
    return {**live, "creator": creator, "tiers": made}


def campaign(base: str, campaign_id: str, key: str | None = None) -> dict[str, Any]:
    return must(api("GET", base, f"/api/campaigns/{campaign_id}", key=key), 200)


def pledge(base: str, campaign_id: str, tier_id: str, *, key: str | None = None, idem: str | None = None,
           card: str = TEST_CARD, country: str = "GB", add_on: int = 0, **extra: Any) -> httpx.Response:
    body = {"tier_id": tier_id, "country": country, "add_on": add_on, "card_number": card, **extra}
    return api("POST", base, f"/api/campaigns/{campaign_id}/pledges", key=key, body=body, idem=idem or idempotency_key())


def pledge_of(body: dict[str, Any]) -> dict[str, Any]:
    return body["pledge"] if isinstance(body.get("pledge"), dict) else body


def backer(base: str, campaign_id: str, tier_id: str, *, card: str = TEST_CARD, country: str = "GB",
           add_on: int = 0) -> tuple[dict[str, Any], dict[str, Any]]:
    who = person(base)
    made = pledge_of(must(pledge(base, campaign_id, tier_id, key=who["key"], card=card, country=country, add_on=add_on), 201))
    return who, made


def pledge_get(base: str, pledge_id: str, key: str) -> dict[str, Any]:
    return must(api("GET", base, f"/api/pledges/{pledge_id}", key=key), 200)


def notices(base: str, key: str, campaign_id: str) -> list[dict[str, Any]]:
    return must(api("GET", base, f"/api/campaigns/{campaign_id}/notices", key=key), 200)


def until_api(probe: Callable[[], Any], message: str, seconds: float) -> Any:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        found = probe()
        if found:
            return found
        _pace.wait(POLL_S)
    pytest.fail(f"{message}: not seen within {seconds}s")


def holds_for(probe: Callable[[], bool], message: str, seconds: float) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not probe():
            pytest.fail(message)
        _pace.wait(POLL_S)


def wait_status(base: str, campaign_id: str, statuses: set[str], seconds: float) -> dict[str, Any]:
    def reached() -> Any:
        found = campaign(base, campaign_id)
        return found if found["status"] in statuses else None

    return until_api(reached, f"campaign {campaign_id} reaches status {sorted(statuses)}", seconds)


def wait_pledge(base: str, pledge_id: str, key: str, check: Callable[[dict[str, Any]], bool], message: str,
                seconds: float) -> dict[str, Any]:
    def reached() -> Any:
        found = pledge_get(base, pledge_id, key)
        return found if check(found) else None

    return until_api(reached, message, seconds)


def inbox(mail: Any, to: str, subject: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages() if m.get("Subject") == subject and to in addresses(m.get("To"))]


def wait_mail(mail: Any, to: str, subject: str, *, seconds: float, count: int = 1) -> list[dict[str, Any]]:
    end = time.monotonic() + seconds
    found: list[dict[str, Any]] = []
    while time.monotonic() < end:
        found = inbox(mail, to, subject)
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit holds {len(found)} {subject!r} to {to}; expected {count} (L428-L439)")


def fix_code(message: dict[str, Any]) -> str:
    found = re.search(r"/fix/([A-Za-z0-9_-]{32,})", text(message))
    assert found, "the fix notice must link <APP_PUBLIC_URL>/fix/<code> with 32 or more URL-safe characters (L397, L439)"
    return found.group(1)


def transactions(payment: dict[str, Any] | None, kind: str) -> list[dict[str, Any]]:
    if not payment:
        return []
    return [t for t in payment.get("transactions") or [] if t.get("transactionType") == kind and t.get("status") == "SUCCESS"]


def kb_pence(transaction: dict[str, Any]) -> int:
    return int(Decimal(str(transaction["amount"])) * 100)


def kb_accounts(killbill: Any, email: str) -> list[dict[str, Any]]:
    found = killbill.client.get(f"/accounts/search/{email}", params={"offset": 0, "limit": 100})
    assert found.status_code == 200, found.text
    return [a for a in found.json() if str(a.get("email", "")).lower() == email.lower()]


def kb_payments(killbill: Any, *, person_id: str | None = None, email: str | None = None) -> list[dict[str, Any]]:
    if person_id:
        account = killbill.account_by_key(person_id)
        return killbill.payments(account["accountId"]) if account else []
    assert email, "a billing lookup needs a person id or an email"
    return [p for a in kb_accounts(killbill, email) for p in killbill.payments(a["accountId"])]


def kb_successes(killbill: Any, kind: str, *, email: str | None = None, person_id: str | None = None) -> list[dict[str, Any]]:
    return [t for p in kb_payments(killbill, person_id=person_id, email=email) for t in transactions(p, kind)]


def flat(data: bytes) -> str:
    return " ".join(pdf_text(data).split())


def bucket_keys(bucket: Any, prefix: str) -> list[str]:
    return bucket.keys(prefix)


@contextlib.contextmanager
def browse(browser: Browser, base: str, path: str, *, size: dict[str, int] | None = None,
           reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, base + path, reduced_motion=reduced_motion) as page:
        if size:
            page.set_viewport_size(size)
            page.goto(base + path)
        yield page


@contextlib.contextmanager
def entered(handle: Any) -> Iterator[Any]:
    if hasattr(handle, "__enter__"):
        with handle as value:
            yield value
        return
    value = next(handle)
    try:
        yield value
    finally:
        with contextlib.suppress(StopIteration):
            next(handle)


def poll(page: Page, predicate: Callable[[], Any], seconds: float = UI_WAIT_S, page_ms: float = UI_STEP_MS) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            if predicate():
                return True
        except Exception:
            pass
        if page_ms:
            advance(page, page_ms)
    return False


def wait_ui(page: Page, predicate: Callable[[], Any], message: str, page_ms: float = UI_STEP_MS,
            seconds: float = UI_WAIT_S) -> None:
    if not poll(page, predicate, seconds, page_ms):
        pytest.fail(message)


def shown(locator: Locator) -> str:
    if locator.count() == 0:
        return ""
    return " ".join((locator.first.text_content() or "").split())


def wait_text(page: Page, locator: Locator, expected: str, message: str, page_ms: float = UI_STEP_MS,
              seconds: float = UI_WAIT_S) -> None:
    if not poll(page, lambda: expected in shown(locator), seconds, page_ms):
        pytest.fail(f"{message}: expected {expected!r}, saw {shown(locator)!r}")


def is_focused(locator: Locator) -> bool:
    return locator.count() > 0 and bool(locator.first.evaluate("e => e === document.activeElement"))


def inside(locator: Locator) -> bool:
    return locator.count() > 0 and bool(locator.first.evaluate("e => e.contains(document.activeElement)"))


def result(page: Page) -> Locator:
    return page.get_by_role("status", name="Pledge result", exact=True)


def gauge_of(page: Page) -> Locator:
    return page.get_by_role("img", name=re.compile(r"^Plate Fill: \d+% of the minimum run$"))


def dots(gauge: Locator) -> list[dict[str, Any]]:
    return gauge.first.evaluate(
        """root => [...root.querySelectorAll('[data-ring]')].map(e => {
            const r = e.getBoundingClientRect();
            return {ring: Number(e.getAttribute('data-ring')), coverage: e.getAttribute('data-coverage'),
                    proof: e.getAttribute('data-proof-coverage'), width: r.width};
        })"""
    )


def ring_values(found: list[dict[str, Any]], ring: int, attr: str = "coverage") -> set[Any]:
    return {d[attr] for d in found if d["ring"] == ring}


def pledged_so_far(page: Page) -> str | None:
    found = re.search(r"Pledged so far\s*(£[\d,]+\.\d{2})", page.evaluate("document.body.innerText"))
    return found.group(1) if found else None


def key_candidates(dialog: Locator, filled: tuple[str, ...]) -> list[str]:
    shown = re.search(r"Your Dotgain key:\s*(\S+)", dialog.inner_text())
    offered = dialog.evaluate(
        """e => [...e.querySelectorAll('input, textarea')]
                 .filter(f => ['text', 'search', 'url', 'email', 'textarea'].includes(f.type))
                 .map(f => f.value)"""
    )
    found = [shown.group(1)] if shown else []
    offered = [v.strip() for v in offered if v and v.strip() and v.strip() not in filled and v.strip() not in found]
    return [c for c in found + offered if c.isascii() and c.isprintable()]


def pick_tier(page: Page, radio: Locator, touch: bool = False) -> None:
    hit = radio.evaluate(
        """e => {
            const at = t => {
                t.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
                const r = t.getBoundingClientRect();
                if (!r.width || !r.height) return null;
                const p = {x: r.x + r.width / 2, y: r.y + r.height / 2};
                const got = document.elementFromPoint(p.x, p.y);
                return got && (got === t || t.contains(got)) ? p : null;
            };
            const rows = [e, (e.labels && e.labels[0]) || e.closest('label')];
            for (let up = e.parentElement; up && rows.length < 6; up = up.parentElement) {
                if (up.querySelectorAll('input[type=radio]').length > 1) break;  // another tier's row starts here
                rows.push(up);
            }
            for (const t of rows) {
                const p = t && at(t);
                if (p) return p;
            }
            return null;
        }"""
    )
    assert hit, "neither the tier radio nor the row around it is reachable at the pointer target"
    if touch:
        page.touchscreen.tap(hit["x"], hit["y"])
    else:
        page.mouse.click(hit["x"], hit["y"])
    wait_ui(page, lambda: radio.is_checked(), "a pointer on the tier row selects its radio (L162)")


def choose(page: Page, title: str) -> None:
    radio = page.get_by_role("radio", name=title, exact=True)
    wait_ui(page, lambda: radio.count() > 0, f"radio {title!r} in the Reward tier group (L127)")
    pick_tier(page, radio)
    select(page.get_by_role("combobox", name="Shipping country", exact=True), "United Kingdom")
    review = page.get_by_role("button", name="Review pledge", exact=True)
    wait_ui(page, lambda: review.is_enabled(), "choosing a tier enables Review pledge (L156)")


def open_confirm(page: Page) -> Locator:
    click(page.get_by_role("button", name="Review pledge", exact=True))
    dialog = page.get_by_role("dialog", name="Confirm pledge", exact=True)
    wait_ui(page, lambda: dialog.count() > 0, "Review pledge opens Confirm pledge (L157)")
    return dialog


def fill_confirm(dialog: Locator, who: tuple[str, str], card: str) -> None:
    name = dialog.get_by_role("textbox", name="Name", exact=True)
    if name.count():
        fill(name, who[0])
        fill(dialog.get_by_role("textbox", name="Email", exact=True), who[1])
    fill(dialog.get_by_role("textbox", name="Card number", exact=True), card)


def adopt(page: Page, base: str, key: str) -> None:
    confirmed: list[bool] = []
    page.on("response", lambda r: confirmed.append(True) if r.url.endswith("/api/me") and r.status == 200 else None)
    page.goto(base + "/studio")
    opener = page.get_by_role("button", name="New campaign", exact=True)
    wait_ui(page, lambda: opener.count() > 0, "Studio offers New campaign (L138)")
    click(opener)
    dialog = page.get_by_role("dialog", name="Your details", exact=True)
    wait_ui(page, lambda: dialog.count() > 0, "New campaign opens Your details without a key (L160)")
    fill(dialog.get_by_role("textbox", name="Key", exact=True), key)
    click(dialog.get_by_role("button", name="Use key", exact=True))
    wait_ui(page, lambda: dialog.count() == 0 or dialog.get_by_role("textbox", name="Key", exact=True).count() == 0
            or dialog.get_by_role("button", name="Done", exact=True).count() > 0 or bool(confirmed),
            "Use key adopts the identity once the server confirms it (L160)")


def pledges_row(page: Page, title: str) -> Locator:
    return page.get_by_role("list", name="Pledges", exact=True).get_by_role("listitem").filter(has_text=title)


def test_person_keys(app_url: str) -> None:
    name, email = unique("creator")
    made = must(api("POST", app_url, "/api/people", body={"name": name, "email": email}), 201)
    assert made["name"] == name and made["email"] == email and len(made["key"]) >= KEY_MIN
    me = must(api("GET", app_url, "/api/me", key=made["key"]), 200)
    assert (me["id"], me["name"], me["email"]) == (made["id"], name, email) and "key" not in me
    other = person(app_url)
    assert must(api("GET", app_url, "/api/me", key=other["key"]), 200)["id"] == other["id"] != made["id"]
    error(api("GET", app_url, "/api/me"), 401, "unauthenticated")
    error(api("GET", app_url, "/api/me", key=JUNK_KEY), 401, "unauthenticated")
    error(api("GET", app_url, "/api/me", headers={"Authorization": made["key"]}), 401, "unauthenticated")
    error(api("GET", app_url, "/api/me/campaigns"), 401, "unauthenticated")
    error(api("GET", app_url, "/api/me/pledges", key=JUNK_KEY), 401, "unauthenticated")
    error(api("POST", app_url, "/api/campaigns", key=JUNK_KEY, body=draft_body(app_url)), 401, "unauthenticated")
    invalid(api("POST", app_url, "/api/people", body={"name": "", "email": email}), "name")
    invalid(api("POST", app_url, "/api/people", body={"name": "x" * 81, "email": email}), "name")
    invalid(api("POST", app_url, "/api/people", body={"name": name, "email": "not-an-address"}), "email")
    camp = draft(app_url, made["key"])
    for path in ("/api/me", "/api/me/campaigns", f"/api/campaigns/{camp['id']}"):
        assert made["key"] not in api("GET", app_url, path, key=made["key"]).text, f"{path} returned the key again (L255)"


DRAFT_FIELDS = {
    "title": (["", "x" * 121], "x" * 120),
    "story": (["x" * 20001], "x" * 20000),
    "goal": ([9999, 10000001, 12000.5, "12000"], 10000000),
    "min_run_copies": ([9, 100001], 100000),
    "stretch": ([
        [{"copies": 400, "amount": 20000}, {"copies": 500, "amount": 30000}, {"copies": 600, "amount": 40000}, {"copies": 700, "amount": 50000}],
        [{"copies": 300, "amount": 20000}],
        [{"copies": 400, "amount": 10000}],
        [{"copies": 500, "amount": 30000}, {"copies": 500, "amount": 40000}],
    ], [{"copies": 400, "amount": 20000}, {"copies": 500, "amount": 30000}, {"copies": 600, "amount": 40000}]),
    "ships_from": (["ZZ", "XK"], "IE"),
    "time_zone": (["Mars/Olympus", "Europe/Atlantis"], "Asia/Tokyo"),
    "deadline_local": (["2026-13-01T20:00", "2026-12-01T25:00", "tomorrow"], "2026-12-01T20:00"),
}


DRAFT_FIELD_IDS = ["title", "story", "goal", "min_run_copies", "stretch", "ships_from", "time_zone", "deadline_local"]


@pytest.mark.parametrize("field", DRAFT_FIELD_IDS, ids=DRAFT_FIELD_IDS)
def test_draft_fields(app_url: str, field: str) -> None:
    creator = person(app_url, "creator")
    bad, good = DRAFT_FIELDS[field]
    for value in bad:
        invalid(api("POST", app_url, "/api/campaigns", key=creator["key"], body=draft_body(app_url, **{field: value})), field)
    assert must(api("GET", app_url, "/api/me/campaigns", key=creator["key"]), 200) == [], "a refused draft was saved"
    made = must(api("POST", app_url, "/api/campaigns", key=creator["key"], body=draft_body(app_url, **{field: good})), 201)
    assert made["status"] == "draft" and made["seconds_left"] is None and made["total"] == 0
    if field == "stretch":
        assert [(s["copies"], s["amount"]) for s in made["stretch"]] == [(s["copies"], s["amount"]) for s in good]
    elif field == "deadline_local":
        assert made["deadline_local"] == good + ":00"
    else:
        assert made[field] == good
    invalid(api("PATCH", app_url, f"/api/campaigns/{made['id']}", key=creator["key"], body={field: bad[0]}), field)
    assert campaign(app_url, made["id"], creator["key"])[field] == made[field], "a refused PATCH changed the draft"
    listed = must(api("GET", app_url, "/api/me/campaigns", key=creator["key"]), 200)
    assert [row["id"] for row in listed] == [made["id"]]


DEADLINE_CASES = {
    "winter": ("Europe/London", "2026-12-01T20:00"),
    "summer": ("Europe/London", "2027-07-01T20:00"),
    "gap": ("Europe/London", "2027-03-28T01:30"),
    "repeat": ("Europe/London", "2027-10-31T01:30"),
    "far_zone": ("Pacific/Auckland", "2026-12-01T20:00"),
}


DEADLINE_IDS = ["winter", "summer", "gap", "repeat", "far_zone"]


@pytest.mark.parametrize("case", DEADLINE_IDS, ids=DEADLINE_IDS)
def test_deadline_zone(app_url: str, case: str) -> None:
    creator = person(app_url, "creator")
    zone, local_text = DEADLINE_CASES[case]
    naive = datetime.fromisoformat(local_text)
    aware = naive.replace(tzinfo=ZoneInfo(zone))
    skipped = aware.astimezone(timezone.utc).astimezone(ZoneInfo(zone)).replace(tzinfo=None) != naive
    assert skipped == (case == "gap")
    answer = api("POST", app_url, "/api/campaigns", key=creator["key"],
                 body=draft_body(app_url, time_zone=zone, deadline_local=local_text))
    if skipped:
        invalid(answer, "deadline_local")
        return
    made = must(answer, 201)
    assert made["deadline_utc"].endswith("Z") and made["deadline_local"] == local_text + ":00"
    assert utc(made["deadline_utc"]) == aware.astimezone(timezone.utc), "the earlier instant in the campaign's zone (L353)"
    moved = must(api("PATCH", app_url, f"/api/campaigns/{made['id']}", key=creator["key"], body={"time_zone": "Asia/Tokyo"}), 200)
    assert moved["deadline_local"] == local_text + ":00"
    assert utc(moved["deadline_utc"]) == naive.replace(tzinfo=ZoneInfo("Asia/Tokyo")).astimezone(timezone.utc)


def test_tiers(app_url: str) -> None:
    creator = person(app_url, "creator")
    camp = draft(app_url, creator["key"])
    path = f"/api/campaigns/{camp['id']}/tiers"

    def post(body: dict[str, Any], key: str = creator["key"]) -> httpx.Response:
        return api("POST", app_url, path, key=key, body=body)

    open_tier = must(post(tier_body()), 201)
    assert (open_tier["title"], open_tier["price"], open_tier["quantity"], open_tier["remaining"], open_tier["claimed"]) == (
        READING, READING_PRICE, None, None, 0)
    assert open_tier["shipping"] == SEED_SHIPPING
    limited = must(post(tier_body(SIGNED, SIGNED_PRICE, 2)), 201)
    assert (limited["quantity"], limited["remaining"], limited["claimed"]) == (2, 2, 0)
    for field, value in TIER_INVALID:
        invalid(post({**tier_body(), field: value}), field)
    bad_ship = post(tier_body(shipping={**SEED_SHIPPING, "europe": SHIPPING_MAX + 1}))
    assert bad_ship.status_code == 422 and any(k.startswith("shipping") for k in bad_ship.json().get("fields", {}))
    assert len(campaign(app_url, camp["id"], creator["key"])["tiers"]) == 2
    for n in range(TIER_LIMIT - 2):
        must(post(tier_body(f"Extra {n}")), 201)
    invalid(post(tier_body("Ninth")), "tiers")
    stranger = person(app_url)
    error(api("PATCH", app_url, f"/api/tiers/{limited['id']}", key=stranger["key"], body={"price": EDIT_PRICE}), 404, "not_found")
    error(api("DELETE", app_url, f"/api/tiers/{limited['id']}", key=stranger["key"]), 404, "not_found")
    error(post(tier_body(), key=stranger["key"]), 404, "not_found")
    edited = must(api("PATCH", app_url, f"/api/tiers/{limited['id']}", key=creator["key"], body={"price": EDIT_PRICE}), 200)
    assert edited["price"] == EDIT_PRICE and edited["shipping"] == SEED_SHIPPING
    assert api("DELETE", app_url, f"/api/tiers/{open_tier['id']}", key=creator["key"]).status_code == 204
    left = {t["id"] for t in campaign(app_url, camp["id"], creator["key"])["tiers"]}
    assert open_tier["id"] not in left and len(left) == TIER_LIMIT - 1
    must(upload(app_url, creator["key"], camp["id"]), 201)
    must(api("POST", app_url, f"/api/campaigns/{camp['id']}/launch", key=creator["key"]), 200)
    error(post(tier_body("Late")), 409, "campaign_not_draft")
    error(api("PATCH", app_url, f"/api/tiers/{limited['id']}", key=creator["key"], body={"price": SIGNED_PRICE}), 409, "campaign_not_draft")
    error(api("DELETE", app_url, f"/api/tiers/{limited['id']}", key=creator["key"]), 409, "campaign_not_draft")
    after = {t["id"]: t for t in campaign(app_url, camp["id"])["tiers"]}
    assert after[limited["id"]]["price"] == EDIT_PRICE and len(after) == TIER_LIMIT - 1


def test_draft_privacy(app_url: str) -> None:
    creator = person(app_url, "creator")
    camp = draft(app_url, creator["key"])
    tier = must(api("POST", app_url, f"/api/campaigns/{camp['id']}/tiers", key=creator["key"], body=tier_body()), 201)
    media = must(upload(app_url, creator["key"], camp["id"]), 201)
    stranger = person(app_url)
    quote = {"tier_id": tier["id"], "country": "GB", "add_on": 0}
    for key in (None, stranger["key"]):
        error(api("GET", app_url, f"/api/campaigns/{camp['id']}", key=key), 404, "not_found")
        error(api("GET", app_url, f"/api/media/{media['id']}", key=key), 404, "not_found")
        error(api("POST", app_url, f"/api/campaigns/{camp['id']}/quote", key=key, body=quote), 404, "not_found")
    sk = stranger["key"]
    error(api("PATCH", app_url, f"/api/campaigns/{camp['id']}", key=sk, body={"title": "Taken"}), 404, "not_found")
    error(api("POST", app_url, f"/api/campaigns/{camp['id']}/tiers", key=sk, body=tier_body()), 404, "not_found")
    error(api("PATCH", app_url, f"/api/tiers/{tier['id']}", key=sk, body={"price": EDIT_PRICE}), 404, "not_found")
    error(api("DELETE", app_url, f"/api/tiers/{tier['id']}", key=sk), 404, "not_found")
    error(api("DELETE", app_url, f"/api/media/{media['id']}", key=sk), 404, "not_found")
    error(upload(app_url, sk, camp["id"]), 404, "not_found")
    error(api("POST", app_url, f"/api/campaigns/{camp['id']}/launch", key=sk), 404, "not_found")
    error(api("GET", app_url, f"/api/campaigns/{camp['id']}/pledges", key=sk), 404, "not_found")
    error(api("GET", app_url, f"/api/campaigns/{camp['id']}/notices", key=sk), 404, "not_found")
    error(pledge(app_url, camp["id"], tier["id"], key=sk), 404, "not_found")
    run = make_live(app_url, [tier_body()])
    error(pledge(app_url, run["id"], tier["id"], key=sk), 404, "not_found")
    assert camp["id"] not in [c["id"] for c in must(api("GET", app_url, "/api/campaigns"), 200)]
    own = campaign(app_url, camp["id"], creator["key"])
    assert own["status"] == "draft" and [t["id"] for t in own["tiers"]] == [tier["id"]]
    assert api("GET", app_url, f"/api/media/{media['id']}", key=creator["key"]).content == png()
    assert campaign(app_url, camp["id"], creator["key"])["title"] == camp["title"]
    error(api("GET", app_url, f"/api/campaigns/{WET_INK}"), 404, "not_found")
    error(api("GET", app_url, f"/api/campaigns/{WET_INK}", key=TOBIAS_KEY), 404, "not_found")
    assert campaign(app_url, WET_INK, MARA_KEY)["title"] == "Wet Ink Almanac"
    assert WET_INK not in [c["id"] for c in must(api("GET", app_url, "/api/campaigns"), 200)]


@pytest.mark.timeout(300)
def test_wf_creator_draft_start(browser: Browser, app_url: str) -> None:
    name, email = unique("creator")
    title = unique("Run")[0]
    with browse(browser, app_url, "/") as page:
        start = page.get_by_role("link", name="Start a campaign", exact=True)
        wait_ui(page, lambda: start.count() > 0, "home shows Start a campaign (L118)")
        click(start)
        dialog = page.get_by_role("dialog", name="Your details", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "Start a campaign opens Your details (L160)")
        fill(dialog.get_by_role("textbox", name="Name", exact=True), name)
        fill(dialog.get_by_role("textbox", name="Email", exact=True), email)
        click(dialog.get_by_role("button", name="Continue", exact=True))
        wait_ui(page, lambda: key_candidates(dialog, (name, email)) != [], "Continue shows the key (L139)")
        mine = [k for k in key_candidates(dialog, (name, email)) if api("GET", app_url, "/api/me", key=k).status_code == 200]
        assert mine, "the key the dialog shows signs the creator in"
        assert must(api("GET", app_url, "/api/me", key=mine[0]), 200)["email"] == email
        key = mine[0]
        click(dialog.get_by_role("button", name="Done", exact=True))
        title_box = page.get_by_role("textbox", name="Title", exact=True)
        wait_ui(page, lambda: title_box.count() > 0, "Done goes on to the editor (L160)")
        fill(title_box, title)
        fill(page.get_by_role("textbox", name="Story", exact=True), "Three hundred copies of a tide zine.")
        fill(page.get_by_role("textbox", name="Goal (£)", exact=True), "2,400.00")
        fill(page.get_by_role("spinbutton", name="Minimum run (copies)", exact=True), str(SEED_MIN_RUN))
        select(page.get_by_role("combobox", name="Ships from", exact=True), "Ireland")
        select(page.get_by_role("combobox", name="Time zone", exact=True), "Europe/Dublin")
        fill(page.get_by_role("textbox", name="Deadline", exact=True), "2026-12-01 20:00")
        click(page.get_by_role("button", name="Add break point", exact=True))
        point = page.get_by_role("group", name="Break point <n>".replace("<n>", "1"), exact=True)
        wait_ui(page, lambda: point.count() > 0, "Add break point adds Break point 1 (L141)")
        fill(point.get_by_role("spinbutton", name="Copies", exact=True), str(STRETCH_SEED[0]["copies"]))
        fill(point.get_by_role("textbox", name="Amount (£)", exact=True), "3,400")
        click(page.get_by_role("button", name="Save draft", exact=True))
        wait_text(page, page.get_by_role("status", name="Studio result", exact=True), "Draft saved.", "save copy (L219)")
        page.goto(app_url + "/studio")
        wait_text(page, page.get_by_role("list", name="Your campaigns", exact=True), title, "the Studio lists the draft (L101)")
    rows = [c for c in must(api("GET", app_url, "/api/me/campaigns", key=key), 200) if c["title"] == title]
    assert len(rows) == 1 and rows[0]["status"] == "draft" and rows[0]["goal"] == GOAL_SEED
    full = campaign(app_url, rows[0]["id"], key)
    assert (full["min_run_copies"], full["ships_from"], full["time_zone"], full["deadline_local"]) == (
        SEED_MIN_RUN, "IE", "Europe/Dublin", "2026-12-01T20:00:00")
    expected = datetime.fromisoformat("2026-12-01T20:00").replace(tzinfo=ZoneInfo("Europe/Dublin")).astimezone(timezone.utc)
    assert utc(full["deadline_utc"]) == expected
    assert [(s["copies"], s["amount"]) for s in full["stretch"]] == [(STRETCH_SEED[0]["copies"], STRETCH_SEED[0]["amount"])]


@pytest.mark.timeout(300)
def test_wf_creator_draft_validation(browser: Browser, app_url: str) -> None:
    creator = person(app_url, "creator")
    title = unique("Run")[0]
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, creator["key"])
        page.goto(app_url + "/studio")
        click(page.get_by_role("button", name="New campaign", exact=True))
        title_box = page.get_by_role("textbox", name="Title", exact=True)
        wait_ui(page, lambda: title_box.count() > 0, "New campaign opens the editor (L160)")
        fill(title_box, title)
        goal = page.get_by_role("textbox", name="Goal (£)", exact=True)
        fill(goal, "£2400")
        fill(page.get_by_role("spinbutton", name="Minimum run (copies)", exact=True), str(SEED_MIN_RUN))
        select(page.get_by_role("combobox", name="Ships from", exact=True), "United Kingdom")
        select(page.get_by_role("combobox", name="Time zone", exact=True), "Europe/London")
        fill(page.get_by_role("textbox", name="Deadline", exact=True), "2026-12-01 20:00")
        click(page.get_by_role("button", name="Save draft", exact=True))
        studio = page.get_by_role("status", name="Studio result", exact=True)
        wait_text(page, studio, "Check the highlighted fields.", "validation copy (L219)")
        hint = page.get_by_text("Enter an amount in pounds, for example 2400.00.", exact=True)
        wait_ui(page, lambda: hint.count() > 0, "money field error (L219)")
        links = page.get_by_role("region", name="Check these fields", exact=True).get_by_role("link")
        wait_ui(page, lambda: links.count() >= 1, "Check these fields links each invalid field (L146)")
        assert must(api("GET", app_url, "/api/me/campaigns", key=creator["key"]), 200) == []
        click(links.first)
        fill(goal, "2400")
        click(page.get_by_role("button", name="Save draft", exact=True))
        wait_text(page, studio, "Draft saved.", "save copy (L219)")
    saved = [c for c in must(api("GET", app_url, "/api/me/campaigns", key=creator["key"]), 200) if c["title"] == title]
    assert len(saved) == 1 and saved[0]["goal"] == GOAL_SEED


def test_media_stored(app_url: str) -> None:
    creator = person(app_url, "creator")
    camp = draft(app_url, creator["key"])
    bucket = S3()
    first = must(upload(app_url, creator["key"], camp["id"]), 201)
    assert (first["kind"], first["status"], first["content_type"], first["bytes"]) == ("cover", "stored", "image/png", len(png()))
    prefix = f"campaigns/{camp['id']}/media/"
    assert bucket.get(f"{prefix}{first['id']}.png") == png()
    spreads = [must(upload(app_url, creator["key"], camp["id"], kind="spread", data=png(n + 1)), 201) for n in range(SPREAD_LIMIT)]
    for n, spread in enumerate(spreads):
        assert spread["status"] == "stored" and bucket.get(f"{prefix}{spread['id']}.png") == png(n + 1)
    invalid(upload(app_url, creator["key"], camp["id"], kind="spread"), "media")
    invalid(upload(app_url, creator["key"], camp["id"], data=b""), "media")
    error(upload(app_url, creator["key"], camp["id"], data=b"GIF89a", content_type="image/gif"), 415, "unsupported_media_type")
    assert len(bucket_keys(bucket, prefix)) == SPREAD_LIMIT + 1
    second = must(upload(app_url, creator["key"], camp["id"], data=png(SPREAD_LIMIT + 1)), 201)
    keys = bucket_keys(bucket, prefix)
    assert f"{prefix}{second['id']}.png" in keys and f"{prefix}{first['id']}.png" not in keys, "a new cover deletes the old object (L277)"
    rows = campaign(app_url, camp["id"], creator["key"])["media"]
    assert [m["id"] for m in rows if m["kind"] == "cover"] == [second["id"]]
    assert all(m["status"] == "stored" for m in rows)
    assert api("DELETE", app_url, f"/api/media/{spreads[0]['id']}", key=creator["key"]).status_code == 204
    assert spreads[0]["id"] not in [m["id"] for m in campaign(app_url, camp["id"], creator["key"])["media"]]


LAUNCH_CASES = ["no_cover", "no_tier", "too_soon", "too_far", "media_not_stored", "not_draft"]


@pytest.mark.parametrize("case", LAUNCH_CASES, ids=LAUNCH_CASES)
def test_launch_gate(app_url: str, case: str) -> None:
    base = env_url("APP_STORAGE_DOWN_URL") if case == "media_not_stored" else app_url
    creator = person(base, "creator")
    lead = {"too_soon": TOO_SOON_S, "too_far": TOO_FAR_S}.get(case, LONG_LEAD_S)
    camp = draft(base, creator["key"], lead=lead)
    if case != "no_tier":
        must(api("POST", base, f"/api/campaigns/{camp['id']}/tiers", key=creator["key"], body=tier_body()), 201)
    if case == "media_not_stored":
        error(upload(base, creator["key"], camp["id"]), 503, "storage_unavailable")
    elif case != "no_cover":
        must(upload(base, creator["key"], camp["id"]), 201)
    answer = api("POST", base, f"/api/campaigns/{camp['id']}/launch", key=creator["key"])
    if case == "not_draft":
        live = must(answer, 200)
        assert live["status"] == "live" and live["pledging_open"] is True and 0 < live["seconds_left"] <= lead
        error(api("POST", base, f"/api/campaigns/{camp['id']}/launch", key=creator["key"]), 409, "campaign_not_draft")
        assert campaign(base, camp["id"])["status"] == "live"
        return
    if case == "no_cover":
        invalid(answer, "cover")
    elif case == "no_tier":
        invalid(answer, "tiers")
    elif case == "media_not_stored":
        error(answer, 409, "media_not_stored")
    else:
        invalid(answer, "deadline_local")
    assert campaign(base, camp["id"], creator["key"])["status"] == "draft"
    error(api("GET", base, f"/api/campaigns/{camp['id']}"), 404, "not_found")


def test_media_visibility(app_url: str) -> None:
    creator = person(app_url, "creator")
    camp = draft(app_url, creator["key"])
    must(api("POST", app_url, f"/api/campaigns/{camp['id']}/tiers", key=creator["key"], body=tier_body()), 201)
    cover = must(upload(app_url, creator["key"], camp["id"]), 201)
    spread = must(upload(app_url, creator["key"], camp["id"], kind="spread", data=png(3)), 201)
    stranger = person(app_url)
    for key in (None, stranger["key"]):
        error(api("GET", app_url, f"/api/media/{cover['id']}", key=key), 404, "not_found")
    own = api("GET", app_url, f"/api/media/{cover['id']}", key=creator["key"])
    assert own.status_code == 200 and own.content == png() and own.headers["content-type"].startswith("image/png")
    must(api("POST", app_url, f"/api/campaigns/{camp['id']}/launch", key=creator["key"]), 200)
    for key in (None, stranger["key"]):
        served = api("GET", app_url, f"/api/media/{spread['id']}", key=key)
        assert served.status_code == 200 and served.content == png(3)
    error(api("GET", app_url, f"/api/media/{JUNK_KEY}"), 404, "not_found")
    object_key = f"campaigns/{camp['id']}/media/{cover['id']}.png"
    bucket = os.environ.get("S3_BUCKET", "")
    for path in (f"/{object_key}", f"/api/{object_key}", f"/api/media/{object_key}", f"/{bucket}/{object_key}"):
        assert api("GET", app_url, path).content != png(), f"{path} served a stored object by key (L36)"


@pytest.mark.timeout(300)
def test_wf_media_launch_journey(browser: Browser, app_url: str, tmp_path: Path) -> None:
    creator = person(app_url, "creator")
    camp = draft(app_url, creator["key"])
    must(api("POST", app_url, f"/api/campaigns/{camp['id']}/tiers", key=creator["key"], body=tier_body()), 201)
    files = []
    for n in range(3):
        path = tmp_path / f"image-{n}.png"
        path.write_bytes(png(n))
        files.append(path)
    fetched: list[tuple[str, int]] = []
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, creator["key"])
        page.goto(f"{app_url}/studio/campaigns/{camp['id']}")
        studio = page.get_by_role("status", name="Studio result", exact=True)
        cover_input = page.get_by_label("Cover art", exact=True)
        wait_ui(page, lambda: cover_input.count() > 0, "the editor offers Cover art (L143)")
        cover_input.set_input_files(str(files[0]))
        wait_text(page, studio, "Cover stored.", "cover stored copy (L219)")
        rows = page.get_by_role("list", name="Images", exact=True).get_by_role("listitem")
        for count, path in enumerate(files[1:], start=2):
            page.get_by_label("Spread previews", exact=True).set_input_files(str(path))
            wait_ui(page, lambda: rows.count() == count and all("Stored" in t for t in rows.all_inner_texts()),
                    f"{count} image rows report Stored (L143)")
        click(page.get_by_role("button", name="Launch campaign", exact=True))
        wait_text(page, studio, "Campaign launched.", "launch copy (L219)")
        page.on("response", lambda r: fetched.append((r.url, r.status)))
        page.goto(f"{app_url}/campaigns/{camp['id']}")
        heading = page.get_by_role("heading", level=1, name=camp["title"], exact=True)
        wait_ui(page, lambda: heading.count() > 0, "the live campaign page (L122)")
        wait_ui(page, lambda: gauge_of(page).count() > 0, "the live page shows Plate Fill (L123)")
    live = campaign(app_url, camp["id"])
    assert live["status"] == "live"
    assert sorted(m["kind"] for m in live["media"]) == ["cover", "spread", "spread"]
    assert all(m["status"] == "stored" for m in live["media"])
    bucket = S3()
    for m in live["media"]:
        assert len(bucket.get(f"campaigns/{camp['id']}/media/{m['id']}.png")) == m["bytes"]
    cover = next(m for m in live["media"] if m["kind"] == "cover")
    assert any(f"/api/media/{cover['id']}" in url and status == 200 for url, status in fetched), "the live page shows the cover by its media id"


@pytest.mark.timeout(300)
def test_wf_media_launch_blocked(browser: Browser, tmp_path: Path) -> None:
    base = env_url("APP_STORAGE_DOWN_URL")
    creator = person(base, "creator")
    camp = draft(base, creator["key"])
    must(api("POST", base, f"/api/campaigns/{camp['id']}/tiers", key=creator["key"], body=tier_body()), 201)
    cover_file = tmp_path / "cover.png"
    cover_file.write_bytes(png())
    with browse(browser, base, "/") as page:
        adopt(page, base, creator["key"])
        page.goto(f"{base}/studio/campaigns/{camp['id']}")
        studio = page.get_by_role("status", name="Studio result", exact=True)
        cover_input = page.get_by_label("Cover art", exact=True)
        wait_ui(page, lambda: cover_input.count() > 0, "the editor offers Cover art (L143)")
        cover_input.set_input_files(str(cover_file))
        wait_text(page, studio, "Media storage is unavailable. The image was not stored.", "storage-down copy (L219)")
        rows = page.get_by_role("list", name="Images", exact=True).get_by_role("listitem")
        wait_ui(page, lambda: rows.count() == 1 and "Not stored" in rows.first.inner_text(), "the row shows Not stored (L446)")
        click(page.get_by_role("button", name="Launch campaign", exact=True))
        wait_text(page, studio, "Launch needs every image stored. Re-upload or remove the images marked Not stored.", "blocked launch copy (L219)")
    after = campaign(base, camp["id"], creator["key"])
    assert after["status"] == "draft" and [m["status"] for m in after["media"]] == ["failed"]


@pytest.mark.timeout(300)
def test_wf_pledge_keyboard_journey(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(), tier_body(SIGNED, SIGNED_PRICE, 2)])
    who = fresh()
    amount = READING_PRICE + SEED_SHIPPING["europe"] + ADD_ON
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        group = page.get_by_role("radiogroup", name="Reward tier", exact=True)
        reading = page.get_by_role("radio", name=READING, exact=True)
        wait_ui(page, lambda: reading.count() > 0, "the tier group renders (L127)")
        for _ in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            if inside(group):
                break
        else:
            pytest.fail("Tab never reached the Reward tier group (L156)")
        for _ in range(TAB_LIMIT):
            if reading.is_checked():
                break
            page.keyboard.press("Space" if is_focused(reading) else "ArrowDown")
        else:
            pytest.fail("the arrow keys never selected Reading copy (L156)")
        preview = page.get_by_role("status", name="Pledge preview", exact=True)
        page.keyboard.press("Tab")
        assert is_focused(page.get_by_role("combobox", name="Shipping country", exact=True)), "Tab reaches the country picker (L156)"
        page.keyboard.type("Ireland")
        europe = f"Shipping (Europe): {pounds(SEED_SHIPPING['europe'])}"
        if not poll(page, lambda: europe in shown(preview), FALLBACK_S):
            page.keyboard.press("Enter")
        wait_text(page, preview, europe, "country quote (L196)")
        wait_text(page, preview, f"Reward: {pounds(READING_PRICE)}", "tier quote once tier and country are chosen (L195)")
        page.keyboard.press("Tab")
        assert is_focused(page.get_by_role("spinbutton", name="Add-on (£)", exact=True)), "Tab reaches the add-on (L156)"
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type("2.50")
        wait_text(page, preview, f"Pledge total: {pounds(amount)}", "add-on quote (L198)")
        page.keyboard.press("Tab")
        assert is_focused(page.get_by_role("button", name="Review pledge", exact=True)), "Tab reaches Review pledge (L156)"
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Confirm pledge", exact=True)
        wait_ui(page, lambda: is_focused(dialog.get_by_role("textbox", name="Name", exact=True)), "focus starts on Name (L157)")
        page.keyboard.type(who[0])
        page.keyboard.press("Tab")
        page.keyboard.type(who[1])
        page.keyboard.press("Tab")
        assert is_focused(dialog.get_by_role("textbox", name="Card number", exact=True))
        page.keyboard.type(TEST_CARD)
        page.keyboard.press("Enter")
        wait_text(page, result(page), authorised_copy(amount), "authorised copy (L206)")
        wait_ui(page, lambda: is_focused(page.get_by_role("button", name="Change pledge", exact=True)), "focus lands on Change pledge (L157)")
    held_auths = kb_successes(killbill, "AUTHORIZE", email=who[1])
    assert [kb_pence(t) for t in held_auths] == [amount] and str(held_auths[0].get("transactionExternalKey", "")).endswith("-auth")
    assert campaign(app_url, run["id"])["total"] == amount


@pytest.mark.timeout(300)
def test_wf_pledge_keyboard_dialogs(browser: Browser, app_url: str) -> None:
    run = make_live(app_url, [tier_body()])
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        choose(page, READING)
        review = page.get_by_role("button", name="Review pledge", exact=True)
        dialog = open_confirm(page)
        wait_ui(page, lambda: is_focused(dialog.get_by_role("textbox", name="Name", exact=True)), "focus on Name (L157)")
        assert tab_order(page, 5) == ["Email", "Card number", "Confirm pledge", "Back", "Name"], "Tab wraps inside the dialog (L157)"
        page.keyboard.press("Shift+Tab")
        assert is_focused(dialog.get_by_role("button", name="Back", exact=True)), "Shift+Tab from the first field wraps to Back (L157)"
        page.keyboard.press("Escape")
        wait_ui(page, lambda: dialog.count() == 0, "Escape closes the dialog (L192)")
        assert is_focused(review), "focus returns to Review pledge (L192)"
        dialog = open_confirm(page)
        click(dialog.get_by_role("button", name="Back", exact=True))
        wait_ui(page, lambda: dialog.count() == 0, "Back closes the dialog")
        assert is_focused(review)
        page.goto(app_url + "/studio")
        opener = page.get_by_role("button", name="New campaign", exact=True)
        wait_ui(page, lambda: opener.count() > 0, "Studio renders")
        click(opener)
        details = page.get_by_role("dialog", name="Your details", exact=True)
        wait_ui(page, lambda: details.count() > 0, "Your details opens (L160)")
        for _ in range(TAB_LIMIT // 4):
            page.keyboard.press("Tab")
            assert inside(details), "Tab left Your details (L192)"
        for _ in range(TAB_LIMIT // 4):
            page.keyboard.press("Shift+Tab")
            assert inside(details), "Shift+Tab left Your details (L192)"
        page.keyboard.press("Escape")
        wait_ui(page, lambda: details.count() == 0, "Escape closes Your details (L192)")
        assert is_focused(opener), "focus returns to New campaign (L192)"
    backer_person = person(app_url)
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, backer_person["key"])
        page.goto(f"{app_url}/campaigns/{run['id']}")
        choose(page, READING)
        dialog = open_confirm(page)
        assert dialog.get_by_role("textbox", name="Name", exact=True).count() == 0
        wait_ui(page, lambda: is_focused(dialog.get_by_role("textbox", name="Card number", exact=True)), "focus on Card number with a key (L157)")
        assert tab_order(page, 3) == ["Confirm pledge", "Back", "Card number"]


@pytest.mark.timeout(300)
def test_wf_pledge_keyboard_pending(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body()])
    who = fresh()
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        choose(page, READING)
        dialog = open_confirm(page)
        confirm = dialog.get_by_role("button", name="Confirm pledge", exact=True)
        click(confirm)
        for copy in ("Enter your name.", "Enter an email address."):
            wait_ui(page, lambda: dialog.get_by_text(copy, exact=True).count() > 0, f"field error {copy!r} (L215)")
        assert is_focused(dialog.get_by_role("textbox", name="Name", exact=True)), "focus on the first wrong field (L157)"
        fill_confirm(dialog, who, UNKNOWN_CARD)
        click(confirm)
        wait_ui(page, lambda: dialog.get_by_text("Use one of the test cards.", exact=True).count() > 0, "card field error (L215)")
        assert dialog.count() == 1 and is_focused(dialog.get_by_role("textbox", name="Card number", exact=True))
        fill(dialog.get_by_role("textbox", name="Card number", exact=True), TEST_CARD)
        with entered(held(page, "**/api/campaigns/*/pledges")) as hold:
            click(confirm)
            wait_text(page, result(page), f"Asking the payment service to hold {pounds(READING_DOMESTIC)}.", "pending copy (L205)")
            assert confirm.count() == 1 and confirm.is_disabled(), "Confirm pledge stays named and disabled while waiting (L157)"
            hold.release()
        wait_text(page, result(page), authorised_copy(READING_DOMESTIC), "authorised copy (L206)")
        assert result(page).first.get_attribute("aria-live") in (None, "polite")
    assert [kb_pence(t) for t in kb_successes(killbill, "AUTHORIZE", email=who[1])] == [READING_DOMESTIC]


ZONE_CASES = {"domestic": "IE", "europe": "GB", "rest_of_world": "JP"}


ZONE_IDS = ["domestic", "europe", "rest_of_world"]


@pytest.mark.parametrize("zone", ZONE_IDS, ids=ZONE_IDS)
def test_pledge_amount(app_url: str, zone: str) -> None:
    run = make_live(app_url, [tier_body()], ships_from="IE")
    tier = run["tiers"][READING]["id"]
    country = ZONE_CASES[zone]
    amount = READING_PRICE + SEED_SHIPPING[zone] + ADD_ON
    quote_path = f"/api/campaigns/{run['id']}/quote"
    quote = must(api("POST", app_url, quote_path, body={"tier_id": tier, "country": country, "add_on": ADD_ON}), 200)
    assert (quote["tier_id"], quote["zone"], quote["reward"], quote["shipping"], quote["add_on"], quote["amount"]) == (
        tier, zone, READING_PRICE, SEED_SHIPPING[zone], ADD_ON, amount)
    assert quote["projected_total"] == amount and quote["projected_percent"] == percent(amount, GOAL_MIN)
    invalid(api("POST", app_url, quote_path, body={"tier_id": tier, "country": "ZZ", "add_on": 0}), "country")
    invalid(api("POST", app_url, quote_path, body={"tier_id": tier, "country": country, "add_on": ADD_ON_MAX + 1}), "add_on")
    invalid(api("POST", app_url, quote_path, body={"tier_id": tier, "country": country, "add_on": -1}), "add_on")
    assert must(api("POST", app_url, quote_path, body={"tier_id": tier, "country": country, "add_on": ADD_ON_MAX}), 200)["add_on"] == ADD_ON_MAX
    who, made = backer(app_url, run["id"], tier, country=country, add_on=ADD_ON)
    assert (made["country"], made["zone"], made["reward"], made["shipping"], made["add_on"], made["amount"]) == (
        country, zone, READING_PRICE, SEED_SHIPPING[zone], ADD_ON, amount)
    own = must(api("POST", app_url, quote_path, key=who["key"], body={"tier_id": tier, "country": country, "add_on": 0}), 200)
    assert own["projected_total"] == amount - amount + (amount - ADD_ON), "projected_total replaces the caller's own pledge (L333)"
    other = person(app_url)
    invalid(pledge(app_url, run["id"], tier, key=other["key"], country="ZZ"), "country")
    invalid(pledge(app_url, run["id"], tier, key=other["key"], add_on=ADD_ON_MAX + 1), "add_on")
    assert pledge_get(app_url, made["id"], who["key"])["amount"] == amount
    assert campaign(app_url, run["id"])["total"] == amount


def test_holds_in_killbill(app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body()])
    other_run = make_live(app_url, [tier_body()])
    tier = run["tiers"][READING]["id"]
    amount = READING_PRICE + SEED_SHIPPING["europe"] + ADD_ON
    error(pledge(app_url, run["id"], tier), 401, "unauthenticated")
    who, made = backer(app_url, run["id"], tier, country="FR", add_on=ADD_ON)
    assert made["state"] == "authorised" and made["card_last4"] == TEST_CARD[-4:]
    assert made["history"][-1]["state"] == "authorised"
    account = killbill.account_by_key(who["id"])
    assert account and account["currency"] == "GBP" and account["email"] == who["email"] and account["name"] == who["name"]
    payment = killbill.payment_by_key(made["id"])
    auths = transactions(payment, "AUTHORIZE")
    assert [kb_pence(t) for t in auths] == [amount] and auths[0].get("transactionExternalKey") == f"{made['id']}-auth"
    assert payment["accountId"] == account["accountId"]
    assert not transactions(payment, "CAPTURE") and not transactions(payment, "VOID")
    again = pledge_of(must(pledge(app_url, other_run["id"], other_run["tiers"][READING]["id"], key=who["key"]), 201))
    assert killbill.payment_by_key(again["id"])["accountId"] == account["accountId"], "one Kill Bill account per backer (L412)"
    digits = TEST_CARD.replace(" ", "")
    for path in (f"/api/pledges/{made['id']}", "/api/me/pledges"):
        assert digits not in api("GET", app_url, path, key=who["key"]).text, "only the last four digits are returned (L351)"


def test_total_counts_holds(app_url: str, killbill: Any) -> None:
    stretch = [{"copies": 400, "amount": 20000}]
    run = make_live(app_url, [tier_body(), tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], stretch=stretch)
    before = campaign(app_url, run["id"])
    assert (before["total"], before["percent"], before["backer_count"]) == (0, 0, 0)
    _, pa = backer(app_url, run["id"], run["tiers"][READING]["id"])
    b = person(app_url)
    body = must(pledge(app_url, run["id"], run["tiers"][ORIGINAL]["id"], key=b["key"], card=CAPTURE_FAIL_CARD), 201)
    pb = pledge_of(body)
    total = pa["amount"] + pb["amount"]
    assert body["campaign_total"] == total and body["campaign_percent"] == percent(total, GOAL_MIN)
    error(pledge(app_url, run["id"], run["tiers"][READING]["id"], key=person(app_url)["key"], card=DECLINE_CARD), 402, "card_declined")
    after = campaign(app_url, run["id"])
    assert (after["total"], after["percent"], after["backer_count"]) == (total, percent(total, GOAL_MIN), 2)
    assert after["stretch"][0]["reached"] is True
    row = next(c for c in must(api("GET", app_url, "/api/campaigns"), 200) if c["id"] == run["id"])
    assert (row["total"], row["percent"], row["goal"]) == (total, percent(total, GOAL_MIN), GOAL_MIN)
    for p in (pa, pb):
        assert [kb_pence(t) for t in transactions(killbill.payment_by_key(p["id"]), "AUTHORIZE")] == [p["amount"]]


def test_declined_card(app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(SIGNED, SIGNED_PRICE, 1)])
    tier = run["tiers"][SIGNED]["id"]
    who = person(app_url)
    error(pledge(app_url, run["id"], tier, key=who["key"], card=DECLINE_CARD), 402, "card_declined")
    invalid(pledge(app_url, run["id"], tier, key=who["key"], card=UNKNOWN_CARD), "card_number")
    assert must(api("GET", app_url, "/api/me/pledges", key=who["key"]), 200) == []
    after = campaign(app_url, run["id"])
    tier_after = {t["id"]: t for t in after["tiers"]}[tier]
    assert (after["total"], after["backer_count"], tier_after["claimed"], tier_after["remaining"]) == (0, 0, 0, 1)
    assert kb_successes(killbill, "AUTHORIZE", person_id=who["id"]) == []
    made = pledge_of(must(pledge(app_url, run["id"], tier, key=who["key"]), 201))
    assert made["state"] == "authorised"
    assert {t["id"]: t for t in campaign(app_url, run["id"])["tiers"]}[tier]["remaining"] == 0


@pytest.mark.timeout(300)
def test_wf_pledge_authorise_declined(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(SIGNED, SIGNED_PRICE, 1)])
    amount = SIGNED_PRICE + SEED_SHIPPING["domestic"]
    who = fresh()
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        choose(page, SIGNED)
        dialog = open_confirm(page)
        fill_confirm(dialog, who, DECLINE_CARD)
        click(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        wait_text(page, result(page), DECLINED, "declined copy (L209)")
        card = dialog.get_by_role("textbox", name="Card number", exact=True)
        wait_ui(page, lambda: dialog.count() == 1 and is_focused(card), "the dialog stays open on the card field (L157)")
        tier = {t["id"]: t for t in campaign(app_url, run["id"])["tiers"]}[run["tiers"][SIGNED]["id"]]
        assert tier["remaining"] == 1 and campaign(app_url, run["id"])["total"] == 0
        fill(card, TEST_CARD)
        click(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        wait_text(page, result(page), authorised_copy(amount), "authorised copy (L206)")
    assert [kb_pence(t) for t in kb_successes(killbill, "AUTHORIZE", email=who[1])] == [amount]


def test_idempotency(app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(), tier_body(SIGNED, SIGNED_PRICE, 2)])
    reading, signed = run["tiers"][READING]["id"], run["tiers"][SIGNED]["id"]
    name, email = fresh()
    idem = idempotency_key()
    path = f"/api/campaigns/{run['id']}/pledges"
    body = {"tier_id": reading, "country": "GB", "add_on": 0, "card_number": TEST_CARD, "name": name, "email": email}
    created = must(api("POST", app_url, path, body=body, idem=idem), 201)
    key = created["key"]
    assert len(key) >= KEY_MIN
    made = pledge_of(created)
    replay = api("POST", app_url, path, body=dict(reversed(list(body.items()))), idem=idem)
    assert replay.status_code == 201 and replay.json() == {k: v for k, v in created.items() if k != "key"}
    assert key not in replay.text, "no key is ever returned twice (L255)"
    error(api("POST", app_url, path, body={**body, "add_on": ADD_ON}, idem=idem), 409, "idempotency_conflict")
    unkeyed = person(app_url)
    invalid(api("POST", app_url, path, key=unkeyed["key"], body={"tier_id": reading, "country": "GB", "add_on": 0, "card_number": TEST_CARD}), "idempotency_key")
    assert kb_payments(killbill, person_id=unkeyed["id"]) == []
    assert len(kb_payments(killbill, email=email)) == 1
    change_key = idempotency_key()
    change_path = f"/api/pledges/{made['id']}"
    moved = must(api("PATCH", app_url, change_path, key=key, body={"tier_id": signed}, idem=change_key), 201)
    again = api("PATCH", app_url, change_path, key=key, body={"tier_id": signed}, idem=change_key)
    assert again.status_code == 201 and again.json() == moved
    error(api("PATCH", app_url, change_path, key=key, body={"add_on": ADD_ON}, idem=change_key), 409, "idempotency_conflict")
    invalid(api("PATCH", app_url, f"/api/pledges/{pledge_of(moved)['id']}", key=key, body={"add_on": ADD_ON}), "idempotency_key")
    assert len(kb_payments(killbill, email=email)) == 2
    now = pledge_get(app_url, pledge_of(moved)["id"], key)
    assert now["state"] == "authorised" and now["amount"] == SIGNED_PRICE + SEED_SHIPPING["domestic"]
    other = person(app_url)
    theirs = pledge_of(must(pledge(app_url, run["id"], reading, key=other["key"], idem=idem), 201))
    assert theirs["id"] != made["id"], "keys are scoped to the person (L391)"
    racer = person(app_url)
    shared = idempotency_key()
    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda _: pledge(app_url, run["id"], reading, key=racer["key"], idem=shared), range(2)))
    created_ones = [r for r in answers if r.status_code == 201]
    assert created_ones, [r.text for r in answers]
    for r in answers:
        if r.status_code != 201:
            error(r, 409, "idempotency_in_progress")
    assert len({pledge_of(r.json())["id"] for r in created_ones}) == 1
    assert len(kb_payments(killbill, person_id=racer["id"])) == 1


def test_pledge_receipt(app_url: str, mail: Any) -> None:
    run = make_live(app_url, [tier_body(), tier_body(SIGNED, SIGNED_PRICE, 2)])
    subject = f"Pledge held: {run['title']}"
    who, made = backer(app_url, run["id"], run["tiers"][READING]["id"])
    message = wait_mail(mail, who["email"], subject, seconds=NOTICE_DUE_S + API_WAIT_S)[0]
    assert mail_from_address() in addresses(message.get("From"))
    assert pounds(READING_DOMESTIC) in text(message) and "Your card is held, not charged." in text(message)
    must(api("PATCH", app_url, f"/api/pledges/{made['id']}", key=who["key"], body={"tier_id": run["tiers"][SIGNED]["id"]}, idem=idempotency_key()), 201)
    both = wait_mail(mail, who["email"], subject, seconds=NOTICE_DUE_S + API_WAIT_S, count=2)
    assert len(both) == 2 and any(pounds(SIGNED_PRICE + SEED_SHIPPING["domestic"]) in text(m) for m in both)
    declined = person(app_url)
    error(pledge(app_url, run["id"], run["tiers"][READING]["id"], key=declined["key"], card=DECLINE_CARD), 402, "card_declined")
    holds_for(lambda: inbox(mail, declined["email"], subject) == [], "a declined card got a receipt", NOTICE_DUE_S)
    assert len(inbox(mail, who["email"], subject)) == 2, "each receipt is sent exactly once (L439)"
    ledger = [n for n in notices(app_url, run["creator"]["key"], run["id"]) if n["to"] == who["email"] and n["subject"] == subject]
    assert len(ledger) == 2 and all(n["status"] == "sent" and n["sent_at"] for n in ledger)


@pytest.mark.timeout(300)
def test_wf_pledge_authorise_new_backer(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    run = make_live(app_url, [tier_body()])
    who = fresh()
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        choose(page, READING)
        dialog = open_confirm(page)
        fill_confirm(dialog, who, TEST_CARD)
        click(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        wait_text(page, result(page), authorised_copy(READING_DOMESTIC), "authorised copy (L206)")
    receipt = wait_mail(mail, who[1], f"Pledge held: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)[0]
    assert pounds(READING_DOMESTIC) in text(receipt) and "Your card is held, not charged." in text(receipt)
    assert [kb_pence(t) for t in kb_successes(killbill, "AUTHORIZE", email=who[1])] == [READING_DOMESTIC]


def test_one_pledge_each(app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body()])
    tier = run["tiers"][READING]["id"]
    who, made = backer(app_url, run["id"], tier)
    error(pledge(app_url, run["id"], tier, key=who["key"]), 409, "already_pledged")
    error(pledge(app_url, run["id"], tier, key=run["creator"]["key"]), 403, "own_campaign")
    assert killbill.account_by_key(run["creator"]["id"]) is None
    racer = person(app_url)
    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda _: pledge(app_url, run["id"], tier, key=racer["key"]), range(2)))
    assert sorted(r.status_code for r in answers) == [201, 409], [r.text for r in answers]
    error(next(r for r in answers if r.status_code == 409), 409, "already_pledged")
    live_holds = [p for p in kb_payments(killbill, person_id=racer["id"]) if transactions(p, "AUTHORIZE") and not transactions(p, "VOID")]
    assert len(live_holds) == 1
    must(api("POST", app_url, f"/api/pledges/{made['id']}/cancel", key=who["key"]), 200)
    assert pledge_of(must(pledge(app_url, run["id"], tier, key=who["key"]), 201))["state"] == "authorised"
    assert campaign(app_url, run["id"])["backer_count"] == 2


def test_last_copy_race(app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(SIGNED, SIGNED_PRICE, 1)])
    tier = run["tiers"][SIGNED]["id"]
    people = [person(app_url) for _ in range(RACERS)]
    with ThreadPoolExecutor(RACERS) as pool:
        answers = list(pool.map(lambda p: pledge(app_url, run["id"], tier, key=p["key"]), people))
    winners = [n for n, r in enumerate(answers) if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in answers]
    for n, r in enumerate(answers):
        if n not in winners:
            error(r, 409, "tier_sold_out")
            assert kb_payments(killbill, person_id=people[n]["id"]) == [], "a sold-out loser reached Kill Bill (L385)"
    amount = SIGNED_PRICE + SEED_SHIPPING["domestic"]
    assert [kb_pence(t) for t in kb_successes(killbill, "AUTHORIZE", person_id=people[winners[0]]["id"])] == [amount]
    after = campaign(app_url, run["id"])
    tier_after = {t["id"]: t for t in after["tiers"]}[tier]
    assert (tier_after["claimed"], tier_after["remaining"], after["total"]) == (1, 0, amount)


@pytest.mark.timeout(300)
def test_wf_limited_tier_race_sold_out(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(), tier_body(SIGNED, SIGNED_PRICE, 1)])
    amount = SIGNED_PRICE + SEED_SHIPPING["domestic"]
    pair = (fresh(), fresh())
    with browse(browser, app_url, f"/campaigns/{run['id']}") as one, browse(browser, app_url, f"/campaigns/{run['id']}") as two:
        pages = (one, two)
        dialogs = []
        for page, who in zip(pages, pair):
            choose(page, SIGNED)
            dialog = open_confirm(page)
            fill_confirm(dialog, who, TEST_CARD)
            dialogs.append(dialog)
        for dialog in dialogs:
            click(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        outcomes = []
        for page in pages:
            wait_ui(page, lambda: authorised_copy(amount) in shown(result(page)) or SOLD_OUT in shown(result(page)), "each confirm is answered")
            outcomes.append(SOLD_OUT in shown(result(page)))
        assert sorted(outcomes) == [False, True], "exactly one backer wins the last copy (L385)"
        lost = outcomes.index(True)
        page = pages[lost]
        wait_ui(page, lambda: dialogs[lost].count() == 0, "the sold-out dialog closes (L157)")
        wait_ui(page, lambda: is_focused(page.get_by_role("button", name="Review pledge", exact=True)), "focus returns to Review pledge (L157)")
        radio = page.get_by_role("radio", name=SIGNED, exact=True)
        wait_ui(page, lambda: radio.is_disabled(), "the sold-out radio is disabled (L127)")
        row = page.get_by_role("list", name="Reward tiers", exact=True).get_by_role("listitem").filter(
            has=page.get_by_role("button", name=f"Open {SIGNED}", exact=True))
        wait_text(page, row, "Gone", "the tier is marked Gone (L137)")
    winner, loser = (pair[1], pair[0]) if lost == 0 else (pair[0], pair[1])
    assert kb_payments(killbill, email=loser[1]) == []
    assert [kb_pence(t) for t in kb_successes(killbill, "AUTHORIZE", email=winner[1])] == [amount]


@pytest.mark.timeout(300)
def test_wf_limited_tier_race_gone_on_load(browser: Browser, app_url: str) -> None:
    run = make_live(app_url, [tier_body(), tier_body(SIGNED, SIGNED_PRICE, 1), tier_body(ORIGINAL, ORIGINAL_PRICE, 1, ORIGINAL_SHIPPING)])
    backer(app_url, run["id"], run["tiers"][SIGNED]["id"])
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        signed = page.get_by_role("radio", name=SIGNED, exact=True)
        wait_ui(page, lambda: signed.count() > 0 and signed.is_disabled(), "the sold-out radio loads disabled (L127)")
        tiers = page.get_by_role("list", name="Reward tiers", exact=True)

        def row(title: str) -> Locator:
            return tiers.get_by_role("listitem").filter(has=page.get_by_role("button", name=f"Open {title}", exact=True))

        wait_text(page, row(SIGNED), "Gone", "Gone (L137)")
        wait_text(page, row(READING), "Open edition", "Open edition (L137)")
        wait_text(page, row(ORIGINAL), "1 of 1 left", "remaining of quantity (L137)")
        opener = page.get_by_role("button", name=f"Open {ORIGINAL}", exact=True)
        click(opener)
        wait_ui(page, lambda: opener.get_attribute("aria-expanded") == "true", "the tier expands (L159)")
        click(opener)
        wait_ui(page, lambda: opener.get_attribute("aria-expanded") == "false", "pressing again collapses (L159)")
        reading = page.get_by_role("radio", name=READING, exact=True)
        pick_tier(page, reading)
        reading.focus()
        wait_ui(page, lambda: is_focused(reading), "the chosen radio holds focus (L156)")
        for _ in range(2):
            page.keyboard.press("ArrowDown")
            assert not is_focused(signed) and not signed.is_checked(), "arrow keys skip the disabled radio (L156)"
    tier = {t["id"]: t for t in campaign(app_url, run["id"])["tiers"]}[run["tiers"][SIGNED]["id"]]
    assert tier["remaining"] == 0


def test_change_pledge(app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(), tier_body(SIGNED, SIGNED_PRICE, 1), tier_body(ORIGINAL, ORIGINAL_PRICE, 1, ORIGINAL_SHIPPING)])
    reading, signed, original = (run["tiers"][t]["id"] for t in (READING, SIGNED, ORIGINAL))
    a, first = backer(app_url, run["id"], reading)
    patch = lambda pid, body, key=a["key"]: api("PATCH", app_url, f"/api/pledges/{pid}", key=key, body=body, idem=idempotency_key())
    moved_body = must(patch(first["id"], {"tier_id": signed}), 201)
    moved = pledge_of(moved_body)
    new_amount = SIGNED_PRICE + SEED_SHIPPING["domestic"]
    assert moved["replaces"] == first["id"] and moved["tier_id"] == signed and moved["amount"] == new_amount
    assert moved["state"] == "authorised" and moved_body["campaign_total"] == new_amount
    assert pledge_get(app_url, first["id"], a["key"])["state"] == "voided"
    new_payment = killbill.payment_by_key(moved["id"])
    assert [kb_pence(t) for t in transactions(new_payment, "AUTHORIZE")] == [new_amount]
    old_payment = killbill.payment_by_key(first["id"])
    voids = transactions(old_payment, "VOID")
    assert len(voids) == 1 and voids[0].get("transactionExternalKey") == f"{first['id']}-void"
    backer(app_url, run["id"], original)
    error(patch(moved["id"], {"tier_id": original}), 409, "tier_sold_out")
    kept = pledge_get(app_url, moved["id"], a["key"])
    assert kept["state"] == "authorised" and kept["amount"] == new_amount
    assert not transactions(killbill.payment_by_key(moved["id"]), "VOID"), "a refused change released the hold (L387)"
    invalid(patch(moved["id"], {"tier_id": signed}), "pledge")
    bumped = pledge_of(must(patch(moved["id"], {"add_on": ADD_ON}), 201))
    assert bumped["amount"] == new_amount + ADD_ON
    tiers = {t["id"]: t for t in campaign(app_url, run["id"])["tiers"]}
    assert tiers[signed]["claimed"] == 1 and tiers[signed]["remaining"] == 0, "a same-tier change keeps its own copy (L385)"
    error(patch(first["id"], {"tier_id": reading}), 409, "pledge_not_active")
    error(patch(bumped["id"], {"tier_id": reading}, key=person(app_url)["key"]), 404, "not_found")
    assert pledge_get(app_url, bumped["id"], a["key"])["state"] == "authorised"
    assert campaign(app_url, run["id"])["total"] == new_amount + ADD_ON + ORIGINAL_PRICE + ORIGINAL_SHIPPING["domestic"]


def test_cancel_pledge(app_url: str, killbill: Any, mail: Any) -> None:
    run = make_live(app_url, [tier_body(SIGNED, SIGNED_PRICE, 1)])
    tier = run["tiers"][SIGNED]["id"]
    a, made = backer(app_url, run["id"], tier)
    stranger = person(app_url)
    error(api("POST", app_url, f"/api/pledges/{made['id']}/cancel", key=stranger["key"]), 404, "not_found")
    error(api("GET", app_url, f"/api/pledges/{made['id']}", key=stranger["key"]), 404, "not_found")
    assert pledge_get(app_url, made["id"], a["key"])["state"] == "authorised"
    gone = must(api("POST", app_url, f"/api/pledges/{made['id']}/cancel", key=a["key"]), 200)
    assert gone["state"] == "voided" and gone["history"][-1]["state"] == "voided"
    assert len(transactions(killbill.payment_by_key(made["id"]), "VOID")) == 1
    after = {t["id"]: t for t in campaign(app_url, run["id"])["tiers"]}[tier]
    assert after["remaining"] == 1 and campaign(app_url, run["id"])["total"] == 0
    message = wait_mail(mail, a["email"], f"Pledge cancelled: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)[0]
    assert mail_from_address() in addresses(message.get("From"))
    error(api("POST", app_url, f"/api/pledges/{made['id']}/cancel", key=a["key"]), 409, "pledge_not_active")
    assert pledge_of(must(pledge(app_url, run["id"], tier, key=person(app_url)["key"]), 201))["state"] == "authorised"


@pytest.mark.timeout(300)
def test_wf_pledge_change_journey(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(), tier_body(SIGNED, SIGNED_PRICE, 2)])
    who, first = backer(app_url, run["id"], run["tiers"][READING]["id"])
    new_amount = SIGNED_PRICE + SEED_SHIPPING["domestic"]
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, who["key"])
        page.goto(app_url + "/pledges")
        row = pledges_row(page, run["title"])
        wait_text(page, row, "Held", "My pledges shows Held (L152)")
        click(row.get_by_role("link", name="Manage pledge", exact=True))
        change = page.get_by_role("button", name="Change pledge", exact=True)
        wait_ui(page, lambda: is_focused(change), "Manage pledge lands on Change pledge (L163)")
        page.evaluate("window.__dotgainProbe = 1")
        click(change)
        choose(page, SIGNED)
        click(page.get_by_role("button", name="Review pledge", exact=True))
        dialog = page.get_by_role("dialog", name="Confirm change", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "Review pledge opens Confirm change (L158)")
        assert dialog.get_by_role("textbox", name="Card number", exact=True).count() == 0
        click(dialog.get_by_role("button", name="Confirm change", exact=True))
        wait_text(page, result(page), changed_copy(new_amount), "changed copy (L207)")
        click(page.get_by_role("button", name="Cancel pledge", exact=True))
        cancel = page.get_by_role("dialog", name="Cancel pledge", exact=True)
        wait_ui(page, lambda: cancel.count() > 0, "Cancel pledge opens its dialog (L158)")
        click(cancel.get_by_role("button", name="Yes, release my card", exact=True))
        wait_text(page, result(page), CANCELLED_COPY, "cancelled copy (L208)")
        assert page.evaluate("window.__dotgainProbe") == 1, "the change reloaded the page"
        page.goto(app_url + "/pledges")
        rows = pledges_row(page, run["title"])
        wait_ui(page, lambda: rows.count() == 2 and all("Released" in t for t in rows.all_inner_texts()), "both rows show Released (L152)")
        assert rows.get_by_role("link", name="Manage pledge", exact=True).count() == 0
    mine = [p for p in must(api("GET", app_url, "/api/me/pledges", key=who["key"]), 200) if p["campaign_id"] == run["id"]]
    assert sorted(p["state"] for p in mine) == ["voided", "voided"]
    newer = next(p for p in mine if p["replaces"] == first["id"])
    assert newer["amount"] == new_amount
    assert transactions(killbill.payment_by_key(first["id"]), "VOID") and transactions(killbill.payment_by_key(newer["id"]), "VOID")


@pytest.mark.timeout(300)
def test_wf_pledge_change_keep(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body()])
    who, made = backer(app_url, run["id"], run["tiers"][READING]["id"])
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, who["key"])
        page.goto(f"{app_url}/campaigns/{run['id']}")
        opener = page.get_by_role("button", name="Cancel pledge", exact=True)
        wait_ui(page, lambda: opener.count() > 0, "a held pledge shows Cancel pledge (L135)")
        dialog = page.get_by_role("dialog", name="Cancel pledge", exact=True)
        click(opener)
        wait_ui(page, lambda: dialog.count() > 0, "Cancel pledge dialog opens (L158)")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: dialog.count() == 0, "Escape closes it (L192)")
        assert is_focused(opener), "focus returns to Cancel pledge (L192)"
        click(opener)
        wait_ui(page, lambda: dialog.count() > 0, "dialog reopens")
        click(dialog.get_by_role("button", name="Keep pledge", exact=True))
        wait_ui(page, lambda: dialog.count() == 0, "Keep pledge closes it (L158)")
    assert pledge_get(app_url, made["id"], who["key"])["state"] == "authorised"
    assert not transactions(killbill.payment_by_key(made["id"]), "VOID")


def test_live_preview(browser: Browser, app_url: str) -> None:
    run = make_live(app_url, [tier_body()])
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        gauge = gauge_of(page)
        wait_ui(page, lambda: gauge.count() > 0 and len(dots(gauge)) >= GAUGE_DOTS, "Plate Fill renders its dots (L178)")
        review = page.get_by_role("button", name="Review pledge", exact=True)
        assert review.is_disabled() and all(d["proof"] is None for d in dots(gauge)), "no tier, no proof rings (L156)"
        page.evaluate("window.__dotgainProbe = 1")
        preview = page.get_by_role("status", name="Pledge preview", exact=True)
        steps = [
            (lambda: (pick_tier(page, page.get_by_role("radio", name=READING, exact=True)),
                      select(page.get_by_role("combobox", name="Shipping country", exact=True), "United Kingdom")),
             "Domestic", SEED_SHIPPING["domestic"], 0),
            (lambda: select(page.get_by_role("combobox", name="Shipping country", exact=True), "United States"), "Rest of world", SEED_SHIPPING["rest_of_world"], 0),
            (lambda: fill(page.get_by_role("spinbutton", name="Add-on (£)", exact=True), "2.50"), "Rest of world", SEED_SHIPPING["rest_of_world"], ADD_ON),
        ]
        for act, zone_name, shipping, add_on in steps:
            act()
            advance(page, QUOTE_MS)
            amount = READING_PRICE + shipping + add_on
            lines = preview_lines(READING_PRICE, zone_name, shipping, add_on, amount, percent(amount, GOAL_MIN))
            wait_ui(page, lambda: all(line in shown(preview) for line in lines), f"preview shows {lines} once the quote lands (L156)")
            advance(page, PROOF_MS)
            found = dots(gauge)
            assert ring_values(found, 1, "proof") == {core_coverage(amount, GOAL_MIN, 1)}, "ring 1 proof coverage follows the quote (L180)"
            assert ring_values(found, 1) == {"0.000"}, "proof never changes data-coverage (L180)"
            assert ring_values(found, GAUGE_RINGS, "proof") == {None}
        fill(page.get_by_role("spinbutton", name="Add-on (£)", exact=True), "500.01")
        advance(page, QUOTE_MS)
        wait_ui(page, lambda: page.get_by_text("Enter an add-on from 0.00 to 500.00.", exact=True).count() > 0, "add-on field error (L215)")
        assert page.evaluate("window.__dotgainProbe") == 1, "the preview reloaded the page"


VIEWPORT_CASES = ["375x812", "768x1024", "1280x800"]
VIEWPORTS = {"375x812": PHONE, "768x1024": TABLET, "1280x800": DESKTOP}


@pytest.mark.parametrize("viewport", VIEWPORT_CASES, ids=VIEWPORT_CASES)
def test_breakpoints(browser: Browser, app_url: str, viewport: str) -> None:
    run = make_live(app_url, [tier_body()], story="The tide comes in under the press. " * STORY_REPEAT)
    size = VIEWPORTS[viewport]
    with browse(browser, app_url, f"/campaigns/{run['id']}", size=size) as page:
        heading = page.get_by_role("heading", level=1, name=run["title"], exact=True)
        gauge = gauge_of(page)
        stage = page.get_by_role("region", name="Pledge", exact=True)
        timer = page.get_by_role("timer", name="Time left", exact=True)
        tiers = page.get_by_role("list", name="Reward tiers", exact=True)
        wait_ui(page, lambda: all(x.count() > 0 for x in (heading, gauge, stage, timer, tiers)), "campaign blocks render (L96)")
        layout(page)
        resting = page.evaluate("window.scrollY")
        box = {name: loc.first.bounding_box() for name, loc in (("heading", heading), ("gauge", gauge), ("stage", stage), ("timer", timer), ("tiers", tiers))}
        if viewport == "375x812":
            assert box["heading"]["y"] < box["gauge"]["y"] <= box["timer"]["y"] < box["stage"]["y"] < box["tiers"]["y"], "375 order (L97)"
            assert box["gauge"]["width"] <= size["width"]
            assert box["stage"]["x"] < box["heading"]["x"] + box["heading"]["width"], "one column at 375 (L97)"
            return
        assert round(box["gauge"]["x"]) >= round(box["heading"]["x"] + box["heading"]["width"]), "Plate Fill sits in the right column (L98)"
        assert round(box["stage"]["x"]) >= round(box["tiers"]["x"] + box["tiers"]["width"]), "the pledge stage sits in the right column (L98)"
        assert GAUGE_MIN_PX <= round(box["gauge"]["width"]) <= GAUGE_MAX_PX
        page.evaluate("h => window.scrollTo(0, h)", size["height"])
        scrolled = page.evaluate("window.scrollY")
        assert scrolled >= size["height"], "the page must scroll a full screen"
        after = stage.first.bounding_box()
        if viewport == "768x1024":
            assert abs((box["stage"]["y"] - after["y"]) - (scrolled - resting)) <= 1, "at 768 the right column scrolls with the page (L98)"
            return
        assert after["y"] >= 0 and after["y"] + after["height"] <= size["height"], "at 1280 the pledge stage stays pinned in view (L99)"
        page.evaluate("window.scrollTo(0, 0)")
        page.set_viewport_size(TABLET)
        smaller = gauge.first.bounding_box()["width"]
        assert box["gauge"]["width"] > smaller, "Plate Fill is larger at 1280 than at 768 (L98-L99)"


@pytest.mark.timeout(300)
def test_wf_pledge_mobile_touch(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body()])
    who = fresh()
    with browse(browser, app_url, f"/campaigns/{run['id']}", size=PHONE) as page:
        gauge = gauge_of(page)
        wait_ui(page, lambda: gauge.count() > 0, "Plate Fill shows on the phone (L123)")
        layout(page)
        assert gauge.first.bounding_box()["width"] <= PHONE["width"]
        radio = page.get_by_role("radio", name=READING, exact=True)
        wait_ui(page, lambda: radio.count() > 0, "tiers render")
        pick_tier(page, radio, touch=True)
        select(page.get_by_role("combobox", name="Shipping country", exact=True), "United Kingdom")
        review = page.get_by_role("button", name="Review pledge", exact=True)
        wait_ui(page, lambda: review.is_enabled(), "a tap selects the tier (L162)")
        rect = review.bounding_box()
        assert rect["width"] >= TARGET_MIN_PX and rect["height"] >= TARGET_MIN_PX
        tap(review)
        dialog = page.get_by_role("dialog", name="Confirm pledge", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "tap opens Confirm pledge (L157)")
        fill_confirm(dialog, who, TEST_CARD)
        tap(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        wait_text(page, result(page), authorised_copy(READING_DOMESTIC), "authorised copy (L206)")
        layout(page)
    assert [kb_pence(t) for t in kb_successes(killbill, "AUTHORIZE", email=who[1])] == [READING_DOMESTIC]


@pytest.mark.timeout(300)
def test_wf_pledge_mobile_reduced_motion(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)])
    amount = ORIGINAL_PRICE + ORIGINAL_SHIPPING["domestic"]
    who = fresh()
    with browse(browser, app_url, f"/campaigns/{run['id']}", size=PHONE, reduced_motion="reduce") as page:
        gauge = gauge_of(page)
        choose(page, ORIGINAL)
        wait_ui(page, lambda: ring_values(dots(gauge), GAUGE_RINGS, "proof") == {"1.000"}, "proof outlines still appear (L186)")
        dialog = open_confirm(page)
        fill_confirm(dialog, who, TEST_CARD)
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/pledges")) as got:
            tap(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        assert got.value.status == 201
        spent = 0
        end = time.monotonic() + UI_WAIT_S
        while time.monotonic() < end:
            found = dots(gauge)
            if (all(ring_values(found, k) == {"1.000"} for k in range(GAUGE_RINGS + 1))
                    and authorised_copy(amount) in shown(result(page)) and pledged_so_far(page) == pounds(amount)):
                break
            if spent < RING_STEP_MS - 1:
                advance(page, 1)
                spent += 1
        else:
            pytest.fail("under reduced motion rings, total and announcement must be final at once (L186)")
        assert animations(gauge) == [], "the gauge animates under reduced motion (L186)"
    assert [kb_pence(t) for t in kb_successes(killbill, "AUTHORIZE", email=who[1])] == [amount]


@pytest.mark.timeout(400)
def test_final_window_guard(killbill: Any) -> None:
    base = short()
    tiers = [tier_body(), tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)]
    run = make_live(base, tiers, lead=GUARD_LEAD_S)
    under = make_live(base, [tier_body()], lead=GUARD_LEAD_S)
    a, a_made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"])
    b, b_made = backer(base, run["id"], run["tiers"][READING]["id"])
    c, c_made = backer(base, under["id"], under["tiers"][READING]["id"])
    big = ORIGINAL_PRICE + ORIGINAL_SHIPPING["domestic"]
    assert campaign(base, run["id"])["seconds_left"] > SHORT_FINAL_WINDOW_S, "setup ran into the final window"
    until_api(lambda: campaign(base, run["id"])["seconds_left"] <= SHORT_FINAL_WINDOW_S, "the final window opens (L389)", GUARD_LEAD_S)
    error(api("POST", base, f"/api/pledges/{a_made['id']}/cancel", key=a["key"]), 409, "would_unfund")
    error(api("PATCH", base, f"/api/pledges/{a_made['id']}", key=a["key"], body={"tier_id": run["tiers"][READING]["id"]}, idem=idempotency_key()), 409, "would_unfund")
    still = pledge_get(base, a_made["id"], a["key"])
    assert still["state"] == "authorised" and still["amount"] == big
    assert not transactions(killbill.payment_by_key(a_made["id"]), "VOID")
    raised = pledge_of(must(api("PATCH", base, f"/api/pledges/{b_made['id']}", key=b["key"], body={"add_on": ADD_ON}, idem=idempotency_key()), 201))
    assert raised["amount"] == READING_DOMESTIC + ADD_ON
    assert must(api("POST", base, f"/api/pledges/{raised['id']}/cancel", key=b["key"]), 200)["state"] == "voided"
    assert must(api("POST", base, f"/api/pledges/{c_made['id']}/cancel", key=c["key"]), 200)["state"] == "voided"
    final = campaign(base, run["id"])
    assert final["total"] == big and final["seconds_left"] > 0, "the checks must run before the deadline"


@pytest.mark.timeout(400)
def test_wf_final_day_guard_would_unfund(browser: Browser, killbill: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=GUARD_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"])
    with browse(browser, base, "/") as page:
        adopt(page, base, who["key"])
        until_api(lambda: campaign(base, run["id"])["seconds_left"] <= SHORT_FINAL_WINDOW_S, "the final window opens (L389)", GUARD_LEAD_S)
        page.goto(f"{base}/campaigns/{run['id']}")
        opener = page.get_by_role("button", name="Cancel pledge", exact=True)
        wait_ui(page, lambda: opener.count() > 0, "Cancel pledge shows (L135)")
        click(opener)
        dialog = page.get_by_role("dialog", name="Cancel pledge", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "cancel dialog opens")
        click(dialog.get_by_role("button", name="Yes, release my card", exact=True))
        wait_text(page, result(page), WOULD_UNFUND, "would-unfund copy (L211)")
    assert pledge_get(base, made["id"], who["key"])["state"] == "authorised"
    assert not transactions(killbill.payment_by_key(made["id"]), "VOID")


@pytest.mark.timeout(300)
def test_server_closes_pledging(killbill: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(), tier_body(SIGNED, SIGNED_PRICE)], lead=SHORT_LEAD_S)
    a, made = backer(base, run["id"], run["tiers"][READING]["id"])
    opened = campaign(base, run["id"])
    assert opened["pledging_open"] is True and opened["seconds_left"] > 0

    def closed() -> Any:
        found = campaign(base, run["id"])
        return found if found["pledging_open"] is False else None

    shut = until_api(closed, "pledging_open turns false at deadline_utc (L355)", CLOSE_WAIT_S)
    assert shut["seconds_left"] == 0
    b = person(base)
    error(pledge(base, run["id"], run["tiers"][READING]["id"], key=b["key"]), 409, "campaign_closed")
    error(api("PATCH", base, f"/api/pledges/{made['id']}", key=a["key"], body={"tier_id": run["tiers"][SIGNED]["id"]}, idem=idempotency_key()), 409, "campaign_closed")
    error(api("POST", base, f"/api/pledges/{made['id']}/cancel", key=a["key"]), 409, "campaign_closed")
    error(api("POST", base, f"/api/campaigns/{run['id']}/quote", body={"tier_id": run["tiers"][READING]["id"], "country": "GB", "add_on": 0}), 409, "campaign_closed")
    assert kb_successes(killbill, "AUTHORIZE", person_id=b["id"]) == []


@pytest.mark.timeout(300)
def test_wf_final_day_guard_device_clock(browser: Browser) -> None:
    base = short()
    run = make_live(base, [tier_body()], lead=SHORT_LEAD_S)
    with browse(browser, base, "/") as page:
        before = campaign(base, run["id"])["seconds_left"]
        page.clock.set_fixed_time(server_now(base) + timedelta(days=2))
        page.goto(f"{base}/campaigns/{run['id']}")
        timer = page.get_by_role("timer", name="Time left", exact=True)
        stage = page.get_by_role("region", name="Pledge", exact=True)
        wait_ui(page, lambda: timer.count() > 0 and stage.count() > 0, "the stage stays open by the server's answer (L357)", page_ms=0)
        after = campaign(base, run["id"])["seconds_left"]
        clock = re.fullmatch(r"(\d{2}):(\d{2}):(\d{2})", shown(timer).strip())
        assert clock, f"countdown {shown(timer)!r} is not HH:MM:SS (L359)"
        seconds = int(clock.group(1)) * 3600 + int(clock.group(2)) * 60 + int(clock.group(3))
        assert after <= seconds <= before, "the countdown starts from seconds_left (L357)"
        wait_status(base, run["id"], {"unfunded"}, CLOSE_WAIT_S)
        page.clock.set_fixed_time(server_now(base) - timedelta(days=2))
        page.goto(f"{base}/campaigns/{run['id']}")
        heading = page.get_by_role("heading", level=2, name=HEADINGS["unfunded"], exact=True)
        wait_ui(page, lambda: heading.count() > 0, "the closed heading shows despite the device clock (L357)", page_ms=0)
        assert page.get_by_role("radiogroup", name="Reward tier", exact=True).count() == 0


@pytest.mark.timeout(300)
def test_unfunded_closeout(killbill: Any, mail: Any) -> None:
    base = short()
    run = make_live(base, [tier_body()], lead=SHORT_LEAD_S)
    made = [backer(base, run["id"], run["tiers"][READING]["id"]) for _ in range(2)]
    closed = wait_status(base, run["id"], {"unfunded"}, CLOSE_WAIT_S)
    assert closed["captured_total"] == 0 and closed["pledging_open"] is False
    for who, p in made:
        wait_pledge(base, p["id"], who["key"], lambda x: x["state"] == "voided", "close-out voids each hold (L393)", API_WAIT_S)
        payment = killbill.payment_by_key(p["id"])
        assert transactions(payment, "VOID") and not transactions(payment, "CAPTURE")
        message = wait_mail(mail, who["email"], f"Not funded, card released: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)[0]
        assert pounds(READING_DOMESTIC) in text(message)
    assert campaign(base, run["id"])["total"] == 0


@pytest.mark.timeout(300)
def test_wf_unfunded_deadline_backer_view(browser: Browser, killbill: Any) -> None:
    base = short()
    run = make_live(base, [tier_body()], lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][READING]["id"])
    wait_status(base, run["id"], {"unfunded"}, CLOSE_WAIT_S)
    wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "voided", "pledge voided", API_WAIT_S)
    with browse(browser, base, "/") as page:
        adopt(page, base, who["key"])
        page.goto(f"{base}/campaigns/{run['id']}")
        heading = page.get_by_role("heading", level=2, name=HEADINGS["unfunded"], exact=True)
        wait_ui(page, lambda: heading.count() > 0, "not-funded heading (L223)")
        page.goto(base + "/pledges")
        wait_text(page, pledges_row(page, run["title"]), "Released", "Released word (L152)")
    assert transactions(killbill.payment_by_key(made["id"]), "VOID")


CLOSED_CASES = ["funded", "unfunded", "cancelled"]


@pytest.mark.timeout(300)
@pytest.mark.parametrize("outcome", CLOSED_CASES, ids=CLOSED_CASES)
def test_closed_headings(browser: Browser, app_url: str, outcome: str) -> None:
    if outcome == "cancelled":
        base = app_url
        run = make_live(base, [tier_body()])
        must(api("POST", base, f"/api/campaigns/{run['id']}/cancel", key=run["creator"]["key"]), 200)
    else:
        base = short()
        run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
        if outcome == "funded":
            backer(base, run["id"], run["tiers"][ORIGINAL]["id"])
        wait_status(base, run["id"], {"funded", "collecting", "settled"} if outcome == "funded" else {"unfunded"}, CLOSE_WAIT_S)
    with browse(browser, base, f"/campaigns/{run['id']}") as page:
        heading = page.get_by_role("heading", level=2, name=HEADINGS[outcome], exact=True)
        wait_ui(page, lambda: heading.count() > 0, f"{outcome} heading word for word (L222-L224)")
        assert page.get_by_role("region", name="Pledge", exact=True).count() == 0
        assert page.get_by_role("button", name="Review pledge", exact=True).count() == 0
        for other, copy in HEADINGS.items():
            if other != outcome:
                assert page.get_by_role("heading", level=2, name=copy, exact=True).count() == 0


def test_creator_cancellation(app_url: str, killbill: Any, mail: Any) -> None:
    run = make_live(app_url, [tier_body()])
    made = [backer(app_url, run["id"], run["tiers"][READING]["id"]) for _ in range(2)]
    error(api("POST", app_url, f"/api/campaigns/{run['id']}/cancel", key=made[0][0]["key"]), 404, "not_found")
    assert campaign(app_url, run["id"])["status"] == "live"
    done = must(api("POST", app_url, f"/api/campaigns/{run['id']}/cancel", key=run["creator"]["key"]), 200)
    assert done["status"] == "cancelled" and done["pledging_open"] is False
    for who, p in made:
        wait_pledge(app_url, p["id"], who["key"], lambda x: x["state"] == "voided", "creator cancel voids each hold (L393)", API_WAIT_S)
        assert transactions(killbill.payment_by_key(p["id"]), "VOID") and not transactions(killbill.payment_by_key(p["id"]), "CAPTURE")
        wait_mail(mail, who["email"], f"Campaign cancelled: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)
    error(api("POST", app_url, f"/api/campaigns/{run['id']}/cancel", key=run["creator"]["key"]), 409, "not_live")
    error(pledge(app_url, run["id"], run["tiers"][READING]["id"], key=person(app_url)["key"]), 409, "campaign_closed")
    sketch = draft(app_url, run["creator"]["key"])
    error(api("POST", app_url, f"/api/campaigns/{sketch['id']}/cancel", key=run["creator"]["key"]), 409, "not_live")


@pytest.mark.timeout(300)
def test_wf_unfunded_deadline_creator_cancel(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body()])
    who, made = backer(app_url, run["id"], run["tiers"][READING]["id"])
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, run["creator"]["key"])
        page.goto(f"{app_url}/studio/campaigns/{run['id']}")
        opener = page.get_by_role("button", name="Cancel campaign", exact=True)
        wait_ui(page, lambda: opener.count() > 0, "live campaigns offer Cancel campaign (L145)")
        dialog = page.get_by_role("dialog", name="Cancel campaign", exact=True)
        click(opener)
        wait_ui(page, lambda: dialog.count() > 0, "Cancel campaign dialog opens")
        click(dialog.get_by_role("button", name="Keep campaign", exact=True))
        wait_ui(page, lambda: dialog.count() == 0, "Keep campaign closes it")
        assert campaign(app_url, run["id"])["status"] == "live"
        click(opener)
        wait_ui(page, lambda: dialog.count() > 0, "dialog reopens")
        click(dialog.get_by_role("button", name="Yes, release every card", exact=True))
        wait_text(page, page.get_by_role("status", name="Studio result", exact=True),
                  "Campaign cancelled. Every held card was released.", "cancel copy (L219)")
    assert campaign(app_url, run["id"])["status"] == "cancelled"
    wait_pledge(app_url, made["id"], who["key"], lambda x: x["state"] == "voided", "hold voided", API_WAIT_S)
    assert transactions(killbill.payment_by_key(made["id"]), "VOID")


@pytest.mark.timeout(300)
def test_funded_capture(killbill: Any, mail: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(), tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    made = [backer(base, run["id"], run["tiers"][ORIGINAL]["id"]), backer(base, run["id"], run["tiers"][READING]["id"])]
    settled = wait_status(base, run["id"], {"settled"}, CLOSE_WAIT_S)
    gross = sum(p["amount"] for _, p in made)
    assert settled["captured_total"] == gross == settled["total"]
    for who, p in made:
        assert pledge_get(base, p["id"], who["key"])["state"] == "captured"
        captures = transactions(killbill.payment_by_key(p["id"]), "CAPTURE")
        assert [kb_pence(t) for t in captures] == [p["amount"]]
        assert captures[0].get("transactionExternalKey") == f"{p['id']}-capture"
        message = wait_mail(mail, who["email"], f"Funded and charged: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)[0]
        assert pounds(p["amount"]) in text(message)


@pytest.mark.timeout(300)
def test_captured_or_errored(killbill: Any, mail: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(), tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    a, good = backer(base, run["id"], run["tiers"][ORIGINAL]["id"])
    b, bad = backer(base, run["id"], run["tiers"][READING]["id"], card=CAPTURE_FAIL_CARD)
    camp = wait_status(base, run["id"], {"collecting"}, CLOSE_WAIT_S)
    won = pledge_get(base, good["id"], a["key"])
    assert won["state"] == "captured" and won["statement"] in {"pending", "ready"} and won["fees"] is not None
    assert transactions(killbill.payment_by_key(good["id"]), "CAPTURE")
    wait_mail(mail, a["email"], f"Funded and charged: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)
    lost = pledge_get(base, bad["id"], b["key"])
    assert lost["state"] == "errored" and lost["statement"] == "none"
    assert utc(lost["fix_deadline_utc"]) == utc(camp["deadline_utc"]) + timedelta(seconds=SHORT_FIX_WINDOW_S)
    assert lost["fix_seconds_left"] > 0 and lost["card_fixed"] is False
    assert not transactions(killbill.payment_by_key(bad["id"]), "CAPTURE")
    error(api("GET", base, f"/api/pledges/{bad['id']}/statement.pdf", key=b["key"]), 409, "not_ready")
    assert inbox(mail, b["email"], f"Funded and charged: {run['title']}") == []
    assert campaign(base, run["id"])["captured_total"] == good["amount"]


@pytest.mark.timeout(300)
def test_wf_funded_collection_needs_fixing(browser: Browser) -> None:
    base = short()
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"], card=CAPTURE_FAIL_CARD)
    wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "errored", "capture fails (L395)", CLOSE_WAIT_S)
    with browse(browser, base, "/") as page:
        adopt(page, base, who["key"])
        page.goto(base + "/pledges")
        row = pledges_row(page, run["title"])
        wait_text(page, row, "Needs fixing", "errored word (L152)")
        click(row.get_by_role("link", name="Fix payment", exact=True))
        heading = page.get_by_role("heading", level=1, name="Fix your payment", exact=True)
        wait_ui(page, lambda: heading.count() > 0, "Fix payment opens the fix page (L163)")
        countdown = page.get_by_role("timer", name="Time left to fix", exact=True)
        wait_ui(page, lambda: countdown.count() == 1, "the fix page shows one Time left to fix countdown (L163)")
    assert pledge_get(base, made["id"], who["key"])["state"] == "errored"


@pytest.mark.timeout(300)
def test_wf_funded_collection_backer(browser: Browser, killbill: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"])
    wait_status(base, run["id"], {"settled"}, CLOSE_WAIT_S)
    wait_pledge(base, made["id"], who["key"], lambda x: x["statement"] == "ready", "statement ready (L406)", READY_WAIT_S)
    with browse(browser, base, "/") as page:
        adopt(page, base, who["key"])
        page.goto(f"{base}/campaigns/{run['id']}")
        heading = page.get_by_role("heading", level=2, name=HEADINGS["funded"], exact=True)
        wait_ui(page, lambda: heading.count() > 0, "funded heading (L222)")
        page.goto(base + "/pledges")
        row = pledges_row(page, run["title"])
        wait_text(page, row, "Charged", "Charged word (L152)")
        link = row.get_by_role("link", name="Download statement", exact=True)
        wait_ui(page, lambda: link.count() == 1, "a ready statement shows Download statement (L149)")
    assert transactions(killbill.payment_by_key(made["id"]), "CAPTURE")


@pytest.mark.timeout(400)
def test_fix_notices(mail: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"], card=CAPTURE_FAIL_CARD)
    subject = f"Fix your payment: {run['title']}"
    wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "errored", "capture fails", CLOSE_WAIT_S)
    first = wait_mail(mail, who["email"], subject, seconds=NOTICE_DUE_S + API_WAIT_S)[0]
    code = fix_code(first)
    assert must(api("GET", base, f"/api/fix/{code}"), 200)["pledge_id"] == made["id"]
    wait_mail(mail, who["email"], f"Pledge dropped: {run['title']}", seconds=FIX_WAIT_S + NOTICE_DUE_S)
    expected = len(range(0, SHORT_FIX_WINDOW_S, SHORT_FIX_NOTICE_S))
    sent = inbox(mail, who["email"], subject)
    assert len(sent) == expected, f"{len(sent)} fix notices; expected {expected} (L397)"
    assert all(fix_code(m) == code and pounds(made["amount"]) in text(m) for m in sent)
    ledger = [n for n in notices(base, run["creator"]["key"], run["id"]) if n["subject"] == subject]
    assert len(ledger) == expected and all(n["status"] == "sent" for n in ledger)


@pytest.mark.timeout(400)
def test_fix_card(killbill: Any, mail: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"], card=CAPTURE_FAIL_CARD)
    wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "errored", "capture fails", CLOSE_WAIT_S)
    code = fix_code(wait_mail(mail, who["email"], f"Fix your payment: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)[0])
    error(api("GET", base, f"/api/fix/{JUNK_KEY}"), 404, "not_found")
    view = must(api("GET", base, f"/api/fix/{code}"), 200)
    assert (view["pledge_id"], view["campaign_title"], view["amount"], view["state"], view["card_fixed"]) == (
        made["id"], run["title"], made["amount"], "errored", False)
    invalid(api("POST", base, f"/api/fix/{code}", body={"card_number": UNKNOWN_CARD}), "card_number")
    error(api("POST", base, f"/api/fix/{code}", body={"card_number": DECLINE_CARD}), 402, "card_declined")
    assert must(api("GET", base, f"/api/fix/{code}"), 200)["card_fixed"] is False
    assert must(api("POST", base, f"/api/fix/{code}", body={"card_number": TEST_CARD}), 200)["card_fixed"] is True
    assert must(api("POST", base, f"/api/fix/{code}", body={"card_number": TEST_CARD}), 200)["card_fixed"] is True
    fixes = [p for p in kb_payments(killbill, person_id=who["id"]) if p.get("paymentExternalKey", "").startswith(f"{made['id']}-fix-")]
    held_fixes = [p for p in fixes if transactions(p, "AUTHORIZE")]
    assert len(held_fixes) == 2 and all(kb_pence(transactions(p, "AUTHORIZE")[0]) == made["amount"] for p in held_fixes)
    assert sum(1 for p in held_fixes if transactions(p, "VOID")) == 1, "the earlier fix hold is voided (L397)"
    wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "captured", "final attempt captures the fix hold (L397)", FIX_WAIT_S)
    latest = next(p for p in held_fixes if not transactions(p, "VOID"))
    assert [kb_pence(t) for t in transactions(killbill.payment_by_key(latest["paymentExternalKey"]), "CAPTURE")] == [made["amount"]]
    assert not transactions(killbill.payment_by_key(made["id"]), "CAPTURE")
    wait_mail(mail, who["email"], f"Funded and charged: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)
    error(api("POST", base, f"/api/fix/{code}", body={"card_number": TEST_CARD}), 409, "fix_window_closed")
    wait_status(base, run["id"], {"settled"}, API_WAIT_S)


@pytest.mark.timeout(400)
def test_wf_errored_fix_window_closed(browser: Browser, killbill: Any, mail: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"], card=CAPTURE_FAIL_CARD)
    wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "errored", "capture fails", CLOSE_WAIT_S)
    code = fix_code(wait_mail(mail, who["email"], f"Fix your payment: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)[0])
    wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "dropped", "final attempt drops the pledge (L397)", FIX_WAIT_S)
    wait_mail(mail, who["email"], f"Pledge dropped: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)
    payment = killbill.payment_by_key(made["id"])
    assert not transactions(payment, "CAPTURE") and transactions(payment, "VOID")
    wait_status(base, run["id"], {"settled"}, API_WAIT_S)
    sheet = must(api("GET", base, f"/api/campaigns/{run['id']}/settlement", key=run["creator"]["key"]), 200)
    assert (sheet["dropped_count"], sheet["captured_count"], sheet["gross"], sheet["net"]) == (1, 0, 0, 0)
    with browse(browser, base, f"/fix/{code}") as page:
        card = page.get_by_role("textbox", name="Card number", exact=True)
        wait_ui(page, lambda: card.count() > 0, "fix page renders (L150)")
        fill(card, TEST_CARD)
        page.keyboard.press("Enter")
        wait_text(page, page.get_by_role("status", name="Fix result", exact=True), "The fix window has closed.", "closed copy (L217)")
        adopt(page, base, who["key"])
        page.goto(base + "/pledges")
        wait_text(page, pledges_row(page, run["title"]), "Dropped", "Dropped word (L152)")
    assert not kb_successes(killbill, "CAPTURE", person_id=who["id"])


@pytest.mark.timeout(400)
def test_wf_errored_fix_lapsed_backer(browser: Browser, killbill: Any, mail: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"], card=CAPTURE_FAIL_CARD)
    wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "errored", "capture fails", CLOSE_WAIT_S)
    code = fix_code(wait_mail(mail, who["email"], f"Fix your payment: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)[0])
    with browse(browser, base, f"/fix/{code}") as page:
        heading = page.get_by_role("heading", level=1, name="Fix your payment", exact=True)
        wait_ui(page, lambda: heading.count() > 0, "fix page heading (L150)")
        countdown = page.get_by_role("timer", name="Time left to fix", exact=True)
        wait_ui(page, lambda: countdown.count() == 1, "the fix page shows one Time left to fix countdown (L150)")
        fix_result = page.get_by_role("status", name="Fix result", exact=True)
        card = page.get_by_role("textbox", name="Card number", exact=True)
        fill(card, DECLINE_CARD)
        page.keyboard.press("Enter")
        wait_text(page, fix_result, DECLINED, "decline copy (L217)")
        fill(card, TEST_CARD)
        with entered(held(page, "**/api/fix/*")) as hold:
            page.keyboard.press("Enter")
            wait_text(page, fix_result, f"Asking the payment service to hold {pounds(made['amount'])}.", "pending copy (L217)")
            assert page.get_by_role("button", name="Update card", exact=True).is_disabled()
            hold.release()
        wait_text(page, fix_result, f"Card updated. {pounds(made['amount'])} is held and will be collected when the fix window closes.", "success copy (L217)")
        wait_pledge(base, made["id"], who["key"], lambda x: x["state"] == "captured", "collected at the window's close (L397)", FIX_WAIT_S)
        adopt(page, base, who["key"])
        page.goto(base + "/pledges")
        wait_text(page, pledges_row(page, run["title"]), "Charged", "Charged word (L152)")
    assert [kb_pence(t) for t in kb_successes(killbill, "CAPTURE", person_id=who["id"])] == [made["amount"]]


@pytest.mark.timeout(300)
def test_fee_arithmetic() -> None:
    base = short()
    run = make_live(base, [tier_body(), tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    made = [backer(base, run["id"], run["tiers"][READING]["id"]),
            backer(base, run["id"], run["tiers"][ORIGINAL]["id"], country="FR", add_on=ADD_ON)]
    wait_status(base, run["id"], {"settled"}, CLOSE_WAIT_S)
    assert made[0][1]["amount"] == READING_DOMESTIC
    lines = {}
    for who, p in made:
        got = pledge_get(base, p["id"], who["key"])["fees"]
        expected = fees_for(p["amount"])
        assert (got["platform_fee"], got["processing_fee"], got["to_creator"]) == expected
        lines[p["id"]] = (p["amount"], *expected)
    assert lines[made[0][1]["id"]][1:] == READING_FEES, "the L404 worked example"
    sheet = must(api("GET", base, f"/api/campaigns/{run['id']}/settlement", key=run["creator"]["key"]), 200)
    assert {l["pledge_id"]: (l["amount"], l["platform_fee"], l["processing_fee"], l["to_creator"]) for l in sheet["lines"]} == lines
    assert sheet["gross"] == sum(v[0] for v in lines.values()) and sheet["platform_fee"] == sum(v[1] for v in lines.values())
    assert sheet["processing_fee"] == sum(v[2] for v in lines.values())
    assert sheet["net"] == sum(v[3] for v in lines.values()) == sheet["gross"] - sheet["platform_fee"] - sheet["processing_fee"]
    assert (sheet["captured_count"], sheet["dropped_count"], sheet["errored_count"], sheet["status"]) == (2, 0, 0, "settled")


@pytest.mark.timeout(300)
def test_wf_statements_settlement_backer_statement(browser: Browser) -> None:
    base = short()
    run = make_live(base, [tier_body()], goal=GOAL_MIN, lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][READING]["id"])
    backer(base, run["id"], run["tiers"][READING]["id"], add_on=ADD_ON_MAX)
    wait_status(base, run["id"], {"settled", "collecting"}, CLOSE_WAIT_S)
    wait_pledge(base, made["id"], who["key"], lambda x: x["statement"] == "ready", "statement ready within 30s (L406)", READY_WAIT_S)
    stored = S3("-short").get(f"statements/{made['id']}.pdf")
    served = api("GET", base, f"/api/pledges/{made['id']}/statement.pdf", key=who["key"])
    assert served.status_code == 200 and served.headers["content-type"].startswith("application/pdf") and served.content == stored
    with browse(browser, base, "/") as page:
        adopt(page, base, who["key"])
        page.goto(base + "/pledges")
        link = pledges_row(page, run["title"]).get_by_role("link", name="Download statement", exact=True)
        wait_ui(page, lambda: link.count() == 1, "Download statement shows (L149)")
        with page.expect_download() as dl:
            click(link)
        data = Path(dl.value.path()).read_bytes()
    words = flat(data)
    platform, processing, to_creator = READING_FEES
    for line in ("Dotgain backer statement", run["title"], who["name"], f"Pledge {made['id']}", READING,
                 f"Reward {pounds(READING_PRICE)}", f"Shipping (Domestic) {pounds(SEED_SHIPPING['domestic'])}",
                 f"Add-on {pounds(0)}", f"Total charged {pounds(READING_DOMESTIC)}", f"Platform fee (5%) {pounds(platform)}",
                 f"Processing (3% + 20p) {pounds(processing)}", f"To the creator {pounds(to_creator)}"):
        assert line in words, f"statement lacks {line!r} (L449)"


@pytest.mark.timeout(300)
def test_wf_statements_settlement_creator(browser: Browser, mail: Any) -> None:
    base = short()
    run = make_live(base, [tier_body(), tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    error(api("GET", base, f"/api/campaigns/{run['id']}/settlement", key=run["creator"]["key"]), 409, "not_funded")
    made = [backer(base, run["id"], run["tiers"][READING]["id"]), backer(base, run["id"], run["tiers"][ORIGINAL]["id"], country="US")]
    wait_status(base, run["id"], {"settled"}, CLOSE_WAIT_S)
    to_creator = 0
    for who, p in made:
        wait_pledge(base, p["id"], who["key"], lambda x: x["statement"] == "ready", "statement ready", READY_WAIT_S)
        found = re.search(r"To the creator (£[\d,]+\.\d{2})", flat(api("GET", base, f"/api/pledges/{p['id']}/statement.pdf", key=who["key"]).content))
        assert found, "statement lacks its To the creator line (L449)"
        to_creator += pence_of(found.group(1))

    def ready() -> Any:
        sheet = must(api("GET", base, f"/api/campaigns/{run['id']}/settlement", key=run["creator"]["key"]), 200)
        return sheet if sheet["pdf"] == "ready" else None

    sheet = until_api(ready, "settlement pdf ready (L406)", READY_WAIT_S)
    assert sheet["net"] == to_creator, "net equals the sum of every statement's to-creator line (L404)"
    stored = S3("-short").get(f"settlements/{run['id']}.pdf")
    wait_mail(mail, run["creator"]["email"], f"Settlement ready: {run['title']}", seconds=NOTICE_DUE_S + API_WAIT_S)
    with browse(browser, base, "/") as page:
        adopt(page, base, run["creator"]["key"])
        page.goto(f"{base}/studio/campaigns/{run['id']}")
        link = page.get_by_role("region", name="Settlement", exact=True).get_by_role("link", name="Download settlement sheet", exact=True)
        wait_ui(page, lambda: link.count() == 1, "settlement panel link (L148)")
        with page.expect_download() as dl:
            click(link)
        data = Path(dl.value.path()).read_bytes()
    assert data == stored
    words = flat(data)
    for line in ("Dotgain settlement sheet", run["title"], *(p["id"] for _, p in made),
                 f"Gross {pounds(sheet['gross'])}", f"Platform fees {pounds(sheet['platform_fee'])}",
                 f"Processing fees {pounds(sheet['processing_fee'])}", f"Net to creator {pounds(sheet['net'])}",
                 "Captured pledges 2", "Dropped pledges 0"):
        assert line in words, f"settlement sheet lacks {line!r} (L450)"


@pytest.mark.timeout(300)
def test_owner_only_documents() -> None:
    base = short()
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    a, pa = backer(base, run["id"], run["tiers"][ORIGINAL]["id"])
    b, pb = backer(base, run["id"], run["tiers"][ORIGINAL]["id"])
    wait_status(base, run["id"], {"settled"}, CLOSE_WAIT_S)
    wait_pledge(base, pa["id"], a["key"], lambda x: x["statement"] == "ready", "statement ready", READY_WAIT_S)
    own = api("GET", base, f"/api/pledges/{pa['id']}/statement.pdf", key=a["key"])
    assert own.status_code == 200 and own.content.startswith(b"%PDF")
    for key in (b["key"], run["creator"]["key"]):
        error(api("GET", base, f"/api/pledges/{pa['id']}/statement.pdf", key=key), 404, "not_found")
        error(api("GET", base, f"/api/pledges/{pa['id']}", key=key), 404, "not_found")
    error(api("GET", base, f"/api/pledges/{pa['id']}/statement.pdf"), 401, "unauthenticated")
    for key in (a["key"], person(base, "creator")["key"]):
        error(api("GET", base, f"/api/campaigns/{run['id']}/settlement", key=key), 404, "not_found")
        error(api("GET", base, f"/api/campaigns/{run['id']}/settlement.pdf", key=key), 404, "not_found")
    error(api("GET", base, f"/api/campaigns/{run['id']}/settlement.pdf"), 401, "unauthenticated")
    for path in (f"/statements/{pa['id']}.pdf", f"/api/statements/{pa['id']}.pdf", f"/settlements/{run['id']}.pdf"):
        assert not api("GET", base, path, key=b["key"]).content.startswith(b"%PDF"), f"{path} served a document by object key"


SERVICE_CASES = ["payments", "email", "storage", "documents"]


@pytest.mark.parametrize("service", SERVICE_CASES, ids=SERVICE_CASES)
def test_status_banners(browser: Browser, app_url: str, service: str) -> None:
    base = env_url(OUTAGE_ENV[service])
    until_api(lambda: must(api("GET", base, "/api/status"), 200)[service] == "down", f"{service} reported down (L454)", PROBE_S + API_WAIT_S)
    status = must(api("GET", base, "/api/status"), 200)
    assert all(status[s] == "up" for s in SERVICE_CASES if s != service), status
    assert must(api("GET", app_url, "/api/status"), 200) == {s: "up" for s in SERVICE_CASES}
    with browse(browser, base, "/studio") as page:
        for path in ("/studio", f"/campaigns/{SALTMARSH}", "/pledges"):
            page.goto(base + path)
            wait_text(page, page.get_by_role("region", name="Service notice", exact=True), BANNERS[service], f"banner on {path} (L226)")
    with browse(browser, app_url, f"/campaigns/{SALTMARSH}") as page:
        wait_ui(page, lambda: gauge_of(page).count() > 0, "campaign page renders")
        notice = shown(page.get_by_role("region", name="Service notice", exact=True))
        assert not any(copy in notice for copy in BANNERS.values())


def test_payment_outage(killbill: Any) -> None:
    base = env_url("APP_KILLBILL_DOWN_URL")
    run = make_live(base, [tier_body(SIGNED, SIGNED_PRICE, 1)])
    who = person(base)
    key = idempotency_key()
    for _ in range(2):
        error(pledge(base, run["id"], run["tiers"][SIGNED]["id"], key=who["key"], idem=key), 503, "payment_unavailable")
    after = campaign(base, run["id"])
    assert after["total"] == 0 and {t["id"]: t for t in after["tiers"]}[run["tiers"][SIGNED]["id"]]["remaining"] == 1
    assert must(api("GET", base, "/api/me/pledges", key=who["key"]), 200) == []
    assert killbill.account_by_key(who["id"]) is None
    error(api("POST", base, f"/api/campaigns/{run['id']}/cancel", key=run["creator"]["key"]), 503, "payment_unavailable")
    assert campaign(base, run["id"])["status"] == "live"
    assert must(api("GET", base, "/api/status"), 200)["payments"] == "down"


@pytest.mark.timeout(300)
def test_wf_outage_banners_payments(browser: Browser, killbill: Any) -> None:
    base = env_url("APP_KILLBILL_DOWN_URL")
    run = make_live(base, [tier_body()])
    who = fresh()
    with browse(browser, base, f"/campaigns/{run['id']}") as page:
        wait_text(page, page.get_by_role("region", name="Service notice", exact=True), BANNERS["payments"], "payments banner (L227)")
        choose(page, READING)
        dialog = open_confirm(page)
        fill_confirm(dialog, who, TEST_CARD)
        click(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        wait_text(page, result(page), PAYMENT_DOWN, "payment-down copy (L213)")
        wait_ui(page, lambda: dialog.count() == 0, "dialog closes (L157)")
        wait_ui(page, lambda: is_focused(page.get_by_role("button", name="Review pledge", exact=True)), "focus returns to Review pledge (L157)")
        wait_ui(page, lambda: all(d["proof"] is None for d in dots(gauge_of(page))), "proof outlines clear on outage (L182)")
    assert campaign(base, run["id"])["total"] == 0
    assert killbill.account(who[1]) is None


def test_email_outage_queue(mail: Any) -> None:
    base = env_url("APP_MAIL_DOWN_URL")
    run = make_live(base, [tier_body()])
    who, made = backer(base, run["id"], run["tiers"][READING]["id"])
    assert made["state"] == "authorised"
    assert must(api("POST", base, f"/api/pledges/{made['id']}/cancel", key=who["key"]), 200)["state"] == "voided"
    ledger = {n["subject"]: n for n in notices(base, run["creator"]["key"], run["id"]) if n["to"] == who["email"]}
    for subject in (f"Pledge held: {run['title']}", f"Pledge cancelled: {run['title']}"):
        assert ledger[subject]["status"] == "queued" and ledger[subject]["sent_at"] is None
    holds_for(lambda: inbox(mail, who["email"], f"Pledge held: {run['title']}") == [], "a notice was sent while mail was down", NOTICE_DUE_S)
    assert must(api("GET", base, "/api/status"), 200)["email"] == "down"


@pytest.mark.timeout(300)
def test_wf_outage_banners_email(browser: Browser, killbill: Any) -> None:
    base = env_url("APP_MAIL_DOWN_URL")
    run = make_live(base, [tier_body()])
    who = fresh()
    with browse(browser, base, f"/campaigns/{run['id']}") as page:
        wait_text(page, page.get_by_role("region", name="Service notice", exact=True), BANNERS["email"], "email banner (L228)")
        choose(page, READING)
        dialog = open_confirm(page)
        fill_confirm(dialog, who, TEST_CARD)
        click(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        wait_text(page, result(page), authorised_copy(READING_DOMESTIC), "authorised copy (L206)")
    queued = [n for n in notices(base, run["creator"]["key"], run["id"]) if n["to"] == who[1]]
    assert [n["status"] for n in queued] == ["queued"]
    assert [kb_pence(t) for t in kb_successes(killbill, "AUTHORIZE", email=who[1])] == [READING_DOMESTIC]


OUTAGE_CASES = ["storage", "documents"]


@pytest.mark.timeout(300)
@pytest.mark.parametrize("service", OUTAGE_CASES, ids=OUTAGE_CASES)
def test_storage_document_outages(mail: Any, service: str) -> None:
    if service == "storage":
        base = env_url("APP_STORAGE_DOWN_URL")
        creator = person(base, "creator")
        camp = draft(base, creator["key"])
        error(upload(base, creator["key"], camp["id"]), 503, "storage_unavailable")
        error(upload(base, creator["key"], camp["id"], kind="spread"), 503, "storage_unavailable")
        rows = campaign(base, camp["id"], creator["key"])["media"]
        assert len(rows) == 2 and all(m["status"] == "failed" for m in rows)
        for m in rows:
            error(api("GET", base, f"/api/media/{m['id']}", key=creator["key"]), 404, "not_found")
        return
    base = env_url("APP_DOCS_DOWN_URL")
    run = make_live(base, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)], lead=SHORT_LEAD_S)
    who, made = backer(base, run["id"], run["tiers"][ORIGINAL]["id"])
    wait_status(base, run["id"], {"settled"}, CLOSE_WAIT_S)

    def not_ready() -> bool:
        sheet = must(api("GET", base, f"/api/campaigns/{run['id']}/settlement", key=run["creator"]["key"]), 200)
        return pledge_get(base, made["id"], who["key"])["statement"] == "pending" and sheet["pdf"] == "pending"

    holds_for(not_ready, "a document became ready while Gotenberg was down (L452)", RETRY_S * 2)
    error(api("GET", base, f"/api/pledges/{made['id']}/statement.pdf", key=who["key"]), 409, "not_ready")
    error(api("GET", base, f"/api/campaigns/{run['id']}/settlement.pdf", key=run["creator"]["key"]), 409, "not_ready")
    assert bucket_keys(S3("-docsdown"), f"statements/{made['id']}") == []
    assert inbox(mail, run["creator"]["email"], f"Settlement ready: {run['title']}") == []
    assert must(api("GET", base, "/api/status"), 200)["documents"] == "down"


def test_health(app_url: str) -> None:
    for base in [app_url, short(), *(env_url(name) for name in OUTAGE_ENV.values())]:
        health = api("GET", base, "/api/health")
        assert health.status_code == 200 and health.json() == {"status": "ok"}, base
    home = api("GET", app_url, "/")
    assert home.status_code == 200, f"/ answered {home.status_code}"


def test_plate_fill_geometry(browser: Browser, app_url: str) -> None:
    run = make_live(app_url, [tier_body("Folio", BIG_PRICE), tier_body("Patron", STRETCH_PRICE)],
                    goal=GOAL_SEED, stretch=STRETCH_SEED)
    _, first = backer(app_url, run["id"], run["tiers"]["Folio"]["id"])
    total = first["amount"]
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        gauge = page.get_by_role("img", name=f"Plate Fill: {percent(total, GOAL_SEED)}% of the minimum run", exact=True)
        wait_ui(page, lambda: gauge.count() > 0, "gauge names its percent (L123)")
        found = dots(gauge)
        for ring in range(GAUGE_RINGS + 3):
            assert len([d for d in found if d["ring"] == ring]) == (6 * ring or 1), f"ring {ring} dot count (L178)"
        assert len([d for d in found if d["ring"] <= GAUGE_RINGS]) == GAUGE_DOTS
        for ring in range(GAUGE_RINGS + 1):
            assert ring_values(found, ring) == {core_coverage(total, GOAL_SEED, ring)}, ring
        width = {r: max(d["width"] for d in found if d["ring"] == r) for r in (0, 3, 4)}
        assert width[0] > width[3] > width[4], "dot diameter grows with coverage (L178)"
        page.goto(app_url + "/")
        row = page.get_by_role("list", name="Live campaigns", exact=True).get_by_role("listitem").filter(
            has=page.get_by_role("link", name=run["title"], exact=True))
        wait_ui(page, lambda: row.get_by_role("img", name=f"Plate Fill: {percent(total, GOAL_SEED)}%", exact=True).count() == 1, "home row mini gauge (L119)")
    _, second = backer(app_url, run["id"], run["tiers"]["Patron"]["id"])
    total += second["amount"]
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        gauge = gauge_of(page)
        wait_ui(page, lambda: gauge.count() > 0, "gauge renders")
        found = dots(gauge)
        assert all(ring_values(found, r) == {"1.000"} for r in range(GAUGE_RINGS + 1))
        assert ring_values(found, GAUGE_RINGS + 1) == {stretch_coverage(total, GOAL_SEED, STRETCH_SEED[0]["amount"])}
        assert ring_values(found, GAUGE_RINGS + 2) == {stretch_coverage(total, STRETCH_SEED[0]["amount"], STRETCH_SEED[1]["amount"])}


@pytest.mark.timeout(300)
def test_wf_cross_cutting_ink_sequence(browser: Browser, app_url: str, killbill: Any) -> None:
    run = make_live(app_url, [tier_body(ORIGINAL, ORIGINAL_PRICE, shipping=ORIGINAL_SHIPPING)])
    amount = ORIGINAL_PRICE + ORIGINAL_SHIPPING["domestic"]
    who = fresh()
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        gauge = gauge_of(page)
        choose(page, ORIGINAL)
        dialog = open_confirm(page)
        fill_confirm(dialog, who, TEST_CARD)
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/pledges")) as got:
            click(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        assert got.value.status == 201
        inked: dict[int, int] = {}
        figures: list[str | None] = []
        final_at = announced_at = None
        elapsed = 0
        for _ in range(2 * INK_MAX_MS // RING_STEP_MS):
            advance(page, RING_STEP_MS)
            elapsed += RING_STEP_MS
            found = dots(gauge)
            for ring in range(GAUGE_RINGS + 1):
                if ring not in inked and ring_values(found, ring) == {"1.000"}:
                    inked[ring] = elapsed
            figure = pledged_so_far(page)
            figures.append(figure)
            if final_at is None and figure == pounds(amount):
                final_at = elapsed
            if announced_at is None and authorised_copy(amount) in shown(result(page)):
                announced_at = elapsed
            if announced_at is not None and len(inked) == GAUGE_RINGS + 1:
                break
        assert len(inked) == GAUGE_RINGS + 1 and announced_at is not None, f"ink {inked}, announced {announced_at}"
        times = [inked[r] for r in range(GAUGE_RINGS + 1)]
        assert times == sorted(times) and times[-1] > times[0], "rings ink from the centre out (L182)"
        assert times[-1] - times[0] <= INK_MAX_MS
        assert any(f not in (None, pounds(0), pounds(amount)) for f in figures), "the total counts up (L182)"
        assert final_at is not None and announced_at >= final_at, "the announcement follows the count (L182)"
        assert announced_at - times[0] <= INK_MAX_MS
    assert kb_successes(killbill, "AUTHORIZE", email=who[1])


@pytest.mark.timeout(300)
def test_wf_cross_cutting_state_marks(browser: Browser, app_url: str) -> None:
    held_run = make_live(app_url, [tier_body()])
    gone_run = make_live(app_url, [tier_body()])
    who, _ = backer(app_url, held_run["id"], held_run["tiers"][READING]["id"])
    gone = pledge_of(must(pledge(app_url, gone_run["id"], gone_run["tiers"][READING]["id"], key=who["key"]), 201))
    must(api("POST", app_url, f"/api/pledges/{gone['id']}/cancel", key=who["key"]), 200)
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, who["key"])
        page.goto(app_url + "/pledges")
        live_row, void_row = pledges_row(page, held_run["title"]), pledges_row(page, gone_run["title"])
        wait_text(page, live_row, "Held", "Held word (L152)")
        wait_text(page, void_row, "Released", "Released word (L152)")
        assert live_row.get_by_role("link", name="Manage pledge", exact=True).count() == 1
        assert void_row.get_by_role("link", name="Manage pledge", exact=True).count() == 0
        assert void_row.get_by_role("link", name="Fix payment", exact=True).count() == 0
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, held_run["creator"]["key"])
        page.goto(f"{app_url}/studio/campaigns/{held_run['id']}")
        table = page.get_by_role("table", name="Backers", exact=True)
        wait_ui(page, lambda: table.count() > 0, "Backers table (L147)")
        for column in ("Backer", "Email", "Tier", "Amount", "State"):
            assert table.get_by_role("columnheader", name=column, exact=True).count() == 1
        row = table.get_by_role("row").filter(has_text=who["email"])
        wait_text(page, row, "Held", "backer row shows Held (L152)")


def test_empty_and_loading(browser: Browser, app_url: str) -> None:
    newcomer = person(app_url)
    with browse(browser, app_url, "/", reduced_motion="reduce") as page:
        adopt(page, app_url, newcomer["key"])
        with entered(held(page, "**/api/me/pledges")) as hold:
            page.goto(app_url + "/pledges")
            loading = page.get_by_role("status", name="Loading", exact=True)
            wait_text(page, loading, "Loading", "loading state (L121)", page_ms=0)
            assert animations(loading) == [], "reduced motion shows one still ring (L186)"
            hold.release()
        wait_ui(page, lambda: page.get_by_text("No pledges yet. Back a run and it will show here.", exact=True).count() > 0, "My pledges empty (L235)")
    run = make_live(app_url, [tier_body()])
    who = fresh()
    with browse(browser, app_url, f"/campaigns/{run['id']}") as page:
        choose(page, READING)
        dialog = open_confirm(page)
        fill_confirm(dialog, who, TEST_CARD)
        click(dialog.get_by_role("button", name="Confirm pledge", exact=True))
        wait_text(page, result(page), authorised_copy(READING_DOMESTIC), "pledge creates the backer's key (L132)")
        page.goto(app_url + "/studio")
        wait_ui(page, lambda: page.get_by_text("No campaigns yet. Start one when your printer quotes a minimum run.", exact=True).count() > 0, "Studio empty (L234)")
    quiet = make_live(app_url, [tier_body()])
    with browse(browser, app_url, "/") as page:
        adopt(page, app_url, quiet["creator"]["key"])
        page.goto(f"{app_url}/studio/campaigns/{quiet['id']}")
        wait_ui(page, lambda: page.get_by_text("No backers yet.", exact=True).count() > 0, "Backers empty (L236)")


def test_server_boundary(browser: Browser, app_url: str) -> None:
    padding = '{"name":"Limit","email":"limit@reader.example","pad":"'
    exact = (padding + "x" * (JSON_LIMIT - len(padding) - 2) + '"}').encode()
    assert len(exact) == JSON_LIMIT
    json_headers = {"Content-Type": "application/json"}
    assert api("POST", app_url, "/api/people", content=exact, headers=json_headers).status_code != 413
    error(api("POST", app_url, "/api/people", content=exact + b" ", headers=json_headers), 413, "too_large")
    error(api("POST", app_url, "/api/people", content=b'{"name":"a"}', headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    error(api("POST", app_url, "/api/people", content=b'{"name":', headers=json_headers), 400, "bad_json")
    creator = person(app_url, "creator")
    camp = draft(app_url, creator["key"])
    big = png()
    big += b"\x00" * (UPLOAD_LIMIT - len(big))
    assert upload(app_url, creator["key"], camp["id"], data=big).status_code != 413
    error(upload(app_url, creator["key"], camp["id"], data=big + b"\x00"), 413, "too_large")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/.env", "/node_modules/pg/package.json",
                 "/src/server.ts", "/%2e%2e/%2e%2e/etc/passwd", "/api/%2e%2e/package.json", "/api/no-such-route"):
        probe = api("GET", app_url, path)
        assert probe.status_code == 404, f"{path} answered {probe.status_code} (L525)"
        assert "run-manifest-v1" not in probe.text and '"dependencies"' not in probe.text
        if path.startswith("/api/"):
            assert probe.json() == {"error": "not_found"}
    foreign = {"Origin": "http://elsewhere.example"}
    for method in ("GET", "OPTIONS"):
        granted = api(method, app_url, "/api/campaigns", headers=foreign).headers
        assert foreign["Origin"] not in granted.values(), "the server granted a cross-origin permission (L523)"
    secrets = [os.environ.get(n, "") for n in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY",
                                               "S3_ACCESS_KEY_ID", "DATABASE_URL", "KILLBILL_URL", "GOTENBERG_URL", "S3_ENDPOINT")]
    secrets = [s for s in secrets if s]
    home = api("GET", app_url, "/").text
    bodies = [home, api("GET", app_url, "/api/status").text, api("GET", app_url, f"/api/campaigns/{SALTMARSH}").text]
    for asset in set(re.findall(r'(?:src|href)="(/[^"]+)"', home)):
        bodies.append(api("GET", app_url, asset).text)
    for value in secrets:
        assert not any(value in b for b in bodies), "a credential or service URL reached the browser (L519)"
    with browse(browser, app_url, "/no-such-page-here") as page:
        heading = page.get_by_role("heading", level=1, name="This page did not go to press.", exact=True)
        wait_ui(page, lambda: heading.count() > 0, "not-found heading (L238)")
        assert page.get_by_role("link", name="Dotgain", exact=True).count() >= 1


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in manifest.values())


def test_if_third_party_notices() -> None:
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notes, f"{package.name} missing from THIRD_PARTY_NOTICES.md"
        assert str(getattr(package, "version", "")) in notes, f"{package.name} version missing"
    assert "Jost" in notes


def test_if_licences() -> None:
    bad = [p.name for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert bad == [], f"disallowed licences: {bad}"
    jost = [line for line in Path("/app/THIRD_PARTY_NOTICES.md").read_text().splitlines() if "Jost" in line]
    named = re.compile(r"OFL|Open Font Licen[cs]e", re.I)
    assert any(named.search(line) or any(l in line for l in LICENCES) for line in jost)


def test_if_datastores() -> None:
    assert Postgres().tables(), "the app keeps no tables in the provided Postgres"
    for root in (Path("/app"), Path(DEPLOYED_APP)):
        files = [p for p in root.rglob("*") if "node_modules" not in p.parts and p.suffix in {".sqlite", ".sqlite3", ".db"}]
        assert files == [], f"datastore files: {files}"


def test_if_services_unmodified(app_url: str) -> None:
    if "MAIL_FROM" in os.environ:
        assert os.environ["MAIL_FROM"] == MAIL_FROM
    assert mail_from_address() in MAIL_FROM
    assert must(api("GET", app_url, "/api/status"), 200) == {s: "up" for s in SERVICE_CASES}


def test_if_no_internet(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url, "/") as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/", f"/campaigns/{SALTMARSH}", "/studio", "/pledges"):
            page.goto(app_url + path)
            wait_ui(page, lambda: page.get_by_role("link", name="Dotgain", exact=True).count() > 0, f"{path} renders")
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert foreign == [], foreign


def _plain_js(root: Path) -> list[str]:
    """Hand-written JavaScript under root: not tool configuration, build tooling or build output (IF rule on TypeScript).

    Build tooling: a file run by package.json scripts or run.json, or kept under a top-level scripts/ or tools/.
    Build output: under a tsconfig outDir, compiled from a .ts/.tsx of the same name, or beside such a file (bundler chunks).
    """
    cmds = ""
    for name in ("package.json", "run.json"):
        if (root / name).is_file():
            data = json.loads((root / name).read_text())
            cmds += " " + " ".join(map(str, (data.get("scripts") or {}).values() if name == "package.json" else data.values()))
    outs = []
    for tc in [*root.glob("tsconfig*.json"), *root.glob("*/tsconfig*.json")]:
        out = re.search(r'"outDir"\s*:\s*"([^"]+)"', tc.read_text())
        if out:
            outs.append((tc.parent / out.group(1)).resolve())
    files = [p for p in root.rglob("*") if p.is_file() and not {"node_modules", ".git", "coverage"} & set(p.relative_to(root).parts)]
    stems = {p.stem for p in files if p.suffix in (".ts", ".tsx")}
    js = [p for p in files if p.suffix in (".js", ".mjs", ".cjs", ".jsx") and not re.search(r"(^\.|\.config\.(c|m)?js$|rc\.(c|m)?js$)", p.name)]
    built_dirs = {p.parent for p in js if p.stem in stems}

    def exempt(p: Path) -> bool:
        rel = p.relative_to(root)
        return (rel.as_posix() in cmds or p.name in cmds or rel.parts[0] in ("scripts", "tools")
                or any(o == p.resolve() or o in p.resolve().parents for o in outs)
                or p.stem in stems or p.parent in built_dirs)
    return [p.relative_to(root).as_posix() for p in js if not exempt(p)]


def test_if_typescript_source() -> None:
    root = Path("/app")
    assert any(p.suffix in (".ts", ".tsx") for p in root.rglob("*") if "node_modules" not in p.parts), "no TypeScript source under /app"
    plain = _plain_js(root)
    assert plain == [], f"plain JavaScript source: {plain}"
