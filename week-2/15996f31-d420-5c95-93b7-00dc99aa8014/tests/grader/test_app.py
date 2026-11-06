from __future__ import annotations

import html
import importlib
import json
import math
import os
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
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    AXE,
    advance,
    check,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    select,
    state_styles,
)


def _client(name: str) -> Any:
    for module in ("conftest", "mailpit", "minio", "killbill", "postgres", "clients", "services"):
        try:
            loaded = importlib.import_module(module)
        except ImportError:
            continue
        if hasattr(loaded, name):
            return getattr(loaded, name)
    raise ImportError(name)


addresses = _client("addresses")
_kit_mail_text = _client("text")


def mail_text(message: dict[str, Any]) -> str:
    if str(message.get("Text") or "").strip():
        return _kit_mail_text(message)
    markup = str(message.get("HTML") or "")
    markup = re.sub(r"<a\b[^>]*?href=[\"']([^\"']*)[\"'][^>]*>", r" \1 ", markup, flags=re.I)
    markup = re.sub(r"<br\s*/?>|</p\s*>|</div\s*>|</li\s*>|</tr\s*>|</h[1-6]\s*>", "\n", markup, flags=re.I)
    markup = re.sub(r"<(style|script)\b.*?</\1\s*>", "", markup, flags=re.I | re.S)
    return html.unescape(re.sub(r"<[^>]+>", "", markup)).replace("\r\n", "\n")


mail_from_address = _client("mail_from_address")
S3 = _client("S3")
Postgres = _client("Postgres")


PASSWORD = "bloom-desk-2027"
BROKER_ID = "usr_broker"
BROKER_EMAIL = "dana@kettleman-pollination.example"
BEEKEEPERS = {
    "coulee": ("bk_coulee", "sam@couleegold.example", "Coulee Gold Bees"),
    "prairie": ("bk_prairie", "ruth@prairielantern.example", "Prairie Lantern Honey"),
    "ridge": ("bk_ridge", "teo@ridgeback-apiaries.example", "Ridgeback Apiaries"),
}
GROWERS = {
    "harlan": ("grw_harlan", "priya@harlanridge.example", "Harlan Ridge Almonds"),
    "mendota": ("grw_mendota", "luis@mendotaflats.example", "Mendota Flats Orchards"),
}
MENDOTA_ORCHARD = "Mendota Flats West"
MENDOTA_BLOCKS = ("Block A", "Block B")
COUNTY = "Madera"

RULES = {
    "2026": {"id": "rs_2026", "prices": {"none": 0, "reduced": 13950, "standard": 19950, "bonus": 21995}, "bps": 1250, "deposit": 5000},
    "2027": {"id": "rs_2027", "prices": {"none": 0, "reduced": 14875, "standard": 21450, "bonus": 23995}, "bps": 1175, "deposit": 6000},
}
THRESHOLDS = (("bonus", Decimal("10.0")), ("standard", Decimal("8.0")), ("reduced", Decimal("6.0")))
TIER_LABELS = {"none": "None", "reduced": "Reduced", "standard": "Standard", "bonus": "Bonus", None: "Not inspected"}
BPS_WHOLE = 10_000
RS_2027_EFFECTIVE = "2026-11-01"
RS_2026_EFFECTIVE = "2025-11-01"

GROWER_ORDER_KEYS = {"id", "ref", "status", "settlement_status", "orchard", "bloom_start", "bloom_end", "delivery_deadline", "hives_ordered", "hives_delivered", "deposit_cents", "payable_cents", "report_available", "blocks"}
GROWER_BLOCK_KEYS = {"id", "name", "acres", "hives_ordered", "hives_delivered", "sample_count", "average_frames", "tier", "payable_cents", "placements"}
GROWER_PLACEMENT_KEYS = {"yard_name", "hives", "delivered_on", "average_frames"}
BROKER_ORDER_KEYS = GROWER_ORDER_KEYS | {"grower", "hives_committed", "rule_set", "commission_bps", "commission_cents", "inspection_link"}
BROKER_PLACEMENT_KEYS = GROWER_PLACEMENT_KEYS | {"drop_id", "beekeeper", "status", "pay_per_hive_cents", "payout_cents"}
BEEKEEPER_ORDER_KEYS = {"id", "ref", "status", "orchard", "bloom_start", "bloom_end", "delivery_deadline", "hives_ordered", "hives_remaining", "pay_per_hive_cents", "blocks", "my_drops"}
BEEKEEPER_BLOCK_KEYS = {"id", "name", "hives_ordered", "hives_delivered", "average_frames", "tier"}
DROP_KEYS = {"id", "order", "orchard", "yard_name", "hives", "status", "block", "delivered_on", "average_frames", "block_average_frames", "tier", "pay_per_hive_cents", "payout_cents", "dispute_reason", "resolution_note", "photos"}
LINK_KEYS = {"id", "status", "inspector_email", "expires_at"}
LIST_ONLY_DROPPED = {"blocks", "my_drops"}

JSON_LIMIT = 64_000
PHOTO_LIMIT = 8_000_000
MAX_PHOTOS = 4
KEY_MAX = 100
ORCHARD_NAME_MAX = 80
COUNTY_MAX = 40
BLOCKS_MAX = 12
BLOCK_NAME_MAX = 30
ACRES_MAX = 500
HIVES_PER_BLOCK_MAX = 2000
BLOOM_WINDOW_DAYS = 45
REASON_MIN = 10
SAMPLES_PER_TEN = 10
HS_TOTAL = 240
TRUCK = 80
OVERSIZE = 100
MIN_TARGET_PX = 44
ODOMETER_TOTAL_MS = 2000
MAIL_WAIT_S = 15
QUEUE_COMPLETE_S = 30
LIVE_REFRESH_S = 5
VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}
DESKTOP = {"width": 1280, "height": 800}
PHONE = {"width": 375, "height": 812}
PACIFIC = ZoneInfo("America/Los_Angeles")
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
FONTS_AND_ICONS = ("Young Serif", "Public Sans", "IBM Plex Mono", "Lucide")
FONT_LICENCE = re.compile(r"(SIL Open Font License|OFL)[\s,-]*(v|version\s*)?1\.1", re.I)

SEASON_START = RS_2027_EFFECTIVE
SEASON_END = "2026-11-20"
SEASON_DEADLINE = "2026-11-01"
PAST_DELIVERY = "2026-10-01T10:00:00-07:00"
LATE_SEASON = ("2026-10-05", "2026-10-20", "2026-10-01")
MW_SEASON = ("2026-02-12", "2026-03-04", "2026-02-09")
PAYMENT_DATE = "2026-10-15"
FUTURE_DATE = "2099-01-01"
INSPECTOR_NAME = "Ines Varga"
FOREIGN_ORIGIN = "http://elsewhere.example"
UNKNOWN_ID = "missing_0000"
ACRES = 20
COLONIES = ("C1", "C2", "C3")
RESOLUTION_NOTE = "Recounted from photos."
TRAVERSAL_NAME = "../../etc/evil name.png"
FORBIDDEN_STORES = ("SQLite", "Redis")
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")

HTTP_TIMEOUT_S = 30
UI_WAIT_S = 30
STEP_MS = 100
POLL_INTERVAL_S = 0.5
POLL_SLACK_S = 5
COPY_BOOT_S = 240
NPM_TIMEOUT_S = 300
LOG_TAIL = 4000
SHORT_LINK_TTL_S = 20
SHORT_FILE_TTL_S = 5
DOWN_DATABASE_URL = "postgresql://bloom:bloom@127.0.0.1:9/bloom"
ODOMETER_STEP_MS = 50
ODOMETER_SLACK_MS = 1000
DRAWER_SETTLE_MS = 500
SECRET_MIN_LEN = 12


def fresh(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4().hex[:10]}"


def money(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def frames_text(value: Any) -> str:
    return f"{Decimal(str(value)):.1f}"


def human_date(day: date) -> str:
    return f"{day:%b} {day.day}, {day.year}"


def human_datetime(stamp: str) -> str:
    moment = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(PACIFIC)
    hour = moment.hour % 12 or 12
    return f"{human_date(moment.date())}, {hour}:{moment:%M} {'AM' if moment.hour < 12 else 'PM'}"


def flat(value: str) -> str:
    return " ".join(value.split())


def mean_frames(values: list[float]) -> Decimal:
    total = sum(Decimal(str(v)) for v in values)
    return (total / len(values)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def tier_of(average: Decimal) -> str:
    for tier, floor in THRESHOLDS:
        if average >= floor:
            return tier
    return "none"


def pay_per_hive(price: int, bps: int) -> int:
    numerator = price * (BPS_WHOLE - bps)
    return (2 * numerator + BPS_WHOLE) // (2 * BPS_WHOLE)


def allocate(grosses: dict[str, int], bps: int) -> tuple[int, dict[str, int]]:
    payable = sum(grosses.values())
    parties: list[tuple[str | None, int]] = [(bid, gross * (BPS_WHOLE - bps)) for bid, gross in sorted(grosses.items())]
    parties.append((None, payable * bps))
    floors = {party: numerator // BPS_WHOLE for party, numerator in parties}
    leftover = payable - sum(floors.values())
    ranked = sorted(range(len(parties)), key=lambda i: (-(parties[i][1] % BPS_WHOLE), i))
    for index in ranked[:leftover]:
        floors[parties[index][0]] += 1
    commission = floors.pop(None)
    return commission, {str(k): v for k, v in floors.items()}


def png(width: int = 2, height: int = 2, pad_to: int = 0) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xd0\x90\x20" * width for _ in range(height))
    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw))
    tail_chunk = chunk(b"IEND", b"")
    if pad_to:
        filler = pad_to - len(head) - len(tail_chunk) - 12 - len(b"Comment\x00")
        head += chunk(b"tEXt", b"Comment\x00" + b"a" * filler)
    return head + tail_chunk


SVG_PAYLOAD = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML_PAYLOAD = b"<!doctype html><script>alert(1)</script>"
PDF_PAYLOAD = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def poll(probe: Callable[[], Any], seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    while True:
        value = probe()
        if value or time.monotonic() >= deadline:
            return value
        pause.wait(POLL_INTERVAL_S)


def race(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))
    results: list[Any] = [None] * len(calls)

    def run(index: int, call: Callable[[], httpx.Response]) -> None:
        barrier.wait()
        results[index] = call()

    threads = [threading.Thread(target=run, args=(i, c)) for i, c in enumerate(calls)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(HTTP_TIMEOUT_S)
    return results


def expect_json(response: httpx.Response, status: int) -> Any:
    assert response.status_code == status, f"{response.request.method} {response.request.url}: {response.status_code} {response.text[:600]}"
    return response.json() if response.content else None


def expect_error(response: httpx.Response, status: int, code: str, *, fields: bool = False) -> dict[str, Any]:
    assert response.status_code == status, f"{response.request.method} {response.request.url}: {response.status_code} {response.text[:600]}"
    body = response.json()
    assert body.get("error") == code, body
    assert isinstance(body.get("message"), str) and body["message"].strip(), body
    expected = {"error", "message"}
    if status == 422 or fields:
        expected.add("fields")
        assert isinstance(body.get("fields"), dict) and body["fields"], body
    if code == "not_enough_open_hives":
        expected.add("remaining")
        assert isinstance(body.get("remaining"), int), body
    assert set(body) == expected, body
    return body


def numbers_in(value: Any) -> list[Decimal]:
    found: list[Decimal] = []
    if isinstance(value, dict):
        for item in value.values():
            found += numbers_in(item)
    elif isinstance(value, list):
        for item in value:
            found += numbers_in(item)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        found.append(Decimal(str(value)))
    return found


def killbill_down_url() -> str:
    url = os.environ.get("APP_KILLBILL_DOWN_URL", "")
    assert url, "APP_KILLBILL_DOWN_URL names the Kill Bill outage instance"
    return url.rstrip("/")


def bucket() -> Any:
    return S3()


class Api:

    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, follow_redirects=False)

    @classmethod
    def user(cls, base: str, email: str) -> "Api":
        api = cls(base)
        response = api.sign_in(email)
        assert response.status_code == 200, f"sign-in {email}: {response.status_code} {response.text}"
        return api

    def sign_in(self, email: str, password: str = PASSWORD) -> httpx.Response:
        return self.http.post("/api/session", json={"email": email, "password": password})

    def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.http.get(path, **kwargs)

    def post(self, path: str, body: Any = None, key: str | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
        merged = dict(headers or {})
        if key is not None:
            merged["Idempotency-Key"] = key
        return self.http.post(path, json={} if body is None else body, headers=merged)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)


class Season:

    def __init__(self, base: str, blocks: list[tuple[str, int, list[tuple[str, int]]]], *,
                 start: str = SEASON_START, end: str = SEASON_END, deadline: str = SEASON_DEADLINE,
                 rule: str = "2027", grower: str = "harlan") -> None:
        self.base = base
        self.rule = RULES[rule]
        self.grower_key = grower
        self.broker = Api.user(base, BROKER_EMAIL)
        self.keepers = {key: Api.user(base, email) for key, (_, email, _) in BEEKEEPERS.items()}
        self.grower = Api.user(base, GROWERS[grower][1])
        self.inspector = Api(base)
        self.layout = blocks
        self.name = fresh("Ranch")
        orchard = expect_json(self.broker.post("/api/orchards", {
            "grower_id": GROWERS[grower][0], "name": self.name, "county": COUNTY,
            "blocks": [{"name": block, "acres": ACRES} for block, _, _ in blocks]}), 201)
        self.orchard_id = orchard["id"]
        self.block_ids = {block["name"]: block["id"] for block in orchard["blocks"]}
        order = expect_json(self.broker.post("/api/orders", {
            "orchard_id": self.orchard_id, "bloom_start": start, "bloom_end": end, "delivery_deadline": deadline,
            "blocks": [{"block_id": self.block_ids[block], "hives": hives} for block, hives, _ in blocks]}), 201)
        self.order_id = order["id"]
        self.ref = order["ref"]
        self.drops: list[dict[str, Any]] = []
        self.token = ""
        self.link: dict[str, Any] = {}
        self.inspector_email = ""

    @property
    def hives(self) -> int:
        return sum(h for _, h, _ in self.layout)

    def open(self) -> "Season":
        expect_json(self.broker.post(f"/api/orders/{self.order_id}/open"), 200)
        return self

    def commit(self) -> "Season":
        for block, _, loads in self.layout:
            for keeper, hives in loads:
                yard = fresh("Yard")
                made = expect_json(self.keepers[keeper].post(f"/api/orders/{self.order_id}/drops", {"yard_name": yard, "hives": hives}), 201)
                self.drops.append({"id": made["id"], "keeper": keeper, "hives": hives, "block": block, "yard": yard, "status": "committed"})
        return self

    def deliver(self, at: str = PAST_DELIVERY, times: dict[int, str] | None = None, skip: set[int] | None = None) -> "Season":
        for index, drop in enumerate(self.drops):
            if drop["status"] != "committed" or index in (skip or set()):
                continue
            moment = (times or {}).get(index, at)
            expect_json(self.keepers[drop["keeper"]].post(f"/api/drops/{drop['id']}/deliver", {"block_id": self.block_ids[drop["block"]], "delivered_at": moment}), 200)
            drop["status"] = "delivered"
        return self

    def place(self) -> "Season":
        expect_json(self.broker.post(f"/api/orders/{self.order_id}/place"), 200)
        return self

    def send_link(self, mail: Any) -> str:
        self.inspector_email = f"inspector-{uuid.uuid4().hex[:10]}@example.com"
        self.link = expect_json(self.broker.post(f"/api/orders/{self.order_id}/inspection-links", {"inspector_email": self.inspector_email}), 201)
        tokens = link_tokens(mail, self.inspector_email, 1)
        assert len(tokens) == 1, tokens
        self.token = tokens[0]
        return self.token

    def drop_in(self, block: str, keeper: str | None = None) -> dict[str, Any]:
        return next(d for d in self.drops if d["block"] == block and (keeper is None or d["keeper"] == keeper))

    def sample(self, block: str, frames: float, label: str, drop: dict[str, Any] | None = None, **extra: Any) -> httpx.Response:
        chosen = drop or self.drop_in(block)
        body = {"block_id": self.block_ids[block], "drop_id": chosen["id"], "colony_label": label, "frames": frames, **extra}
        return self.inspector.post(f"/api/inspect/{self.token}/samples", body)

    def inspect(self, frames_by_block: dict[str, list[float]]) -> "Season":
        for block, values in frames_by_block.items():
            for index, frames in enumerate(values, 1):
                expect_json(self.sample(block, frames, f"C{index}"), 201)
        return self

    def sign(self, key: str | None = None) -> "Season":
        expect_json(self.inspector.post(f"/api/inspect/{self.token}/sign", {"inspector_name": INSPECTOR_NAME, "attest": True}, key=key or idempotency_key()), 200)
        for drop in self.drops:
            drop["status"] = "inspected"
        return self

    def accept(self) -> "Season":
        for drop in self.drops:
            expect_json(self.keepers[drop["keeper"]].post(f"/api/drops/{drop['id']}/accept"), 200)
        return self

    def order(self, api: Api | None = None) -> dict[str, Any]:
        return expect_json((api or self.broker).get(f"/api/orders/{self.order_id}"), 200)

    def sheet(self, token: str | None = None) -> dict[str, Any]:
        return expect_json(self.inspector.get(f"/api/inspect/{token or self.token}"), 200)

    def block_payable(self, block: str, frames: list[float]) -> int:
        delivered = sum(d["hives"] for d in self.drops if d["block"] == block and d["status"] != "committed")
        return delivered * self.rule["prices"][tier_of(mean_frames(frames))] if frames else 0


def await_mail(mail: Any, predicate: Callable[[dict[str, Any]], bool], count: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages() if predicate(m)]
        if len(found) >= count or time.monotonic() >= deadline:
            return found


def to_address(message: dict[str, Any], email: str) -> bool:
    return email.lower() in [a.lower() for a in addresses(message.get("To"))]


def with_subject(subject: str) -> Callable[[dict[str, Any]], bool]:
    return lambda m: flat(str(m.get("Subject", ""))) == subject


def link_tokens(mail: Any, inspector_email: str, count: int) -> list[str]:
    found = await_mail(mail, lambda m: to_address(m, inspector_email), count)
    tokens = []
    for message in found:
        match = re.search(r"/inspect/([^\s<>\"')]+)", mail_text(message))
        assert match, mail_text(message)
        tokens.append(match.group(1).rstrip("."))
    return tokens


def settle_payments(killbill: Any, order_id: str, grower: str = "harlan") -> list[dict[str, Any]]:
    account = killbill.account_by_key(GROWERS[grower][0])
    assert account, "the grower's Kill Bill account exists"
    marker = f"settle-{order_id}"
    return [p for p in killbill.payments(account["accountId"]) if marker in json.dumps(p)]


def kb_get(path: str, **params: str) -> Any:
    base = os.environ.get("KILLBILL_URL", "").rstrip("/")
    assert base, "KILLBILL_URL reaches Kill Bill"
    response = httpx.get(f"{base}{path}", params=params, timeout=HTTP_TIMEOUT_S,
                         auth=(os.environ.get("KILLBILL_USERNAME", ""), os.environ.get("KILLBILL_PASSWORD", "")),
                         headers={"Accept": "application/json",
                                  "X-Killbill-ApiKey": os.environ.get("KILLBILL_API_KEY", ""),
                                  "X-Killbill-ApiSecret": os.environ.get("KILLBILL_API_SECRET", "")})
    assert response.status_code == 200, f"Kill Bill {path}: {response.status_code} {response.text[:300]}"
    return response.json()


def kb_account_id(grower: str) -> str:
    account = poll(lambda: _KILLBILL["client"].account_by_key(GROWERS[grower][0]), MAIL_WAIT_S)
    assert account, f"Kill Bill account keyed by {GROWERS[grower][0]}"
    return account["accountId"]


def kb_items(grower: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    invoices = kb_get(f"/1.0/kb/accounts/{kb_account_id(grower)}/invoices", withItems="true",
                      includeInvoiceComponents="true", includeVoidedInvoices="true")
    found = []
    for invoice in invoices:
        items = invoice.get("items")
        if not items:
            items = kb_get(f"/1.0/kb/invoices/{invoice['invoiceId']}", withItems="true").get("items") or []
        found += [(invoice, item) for item in items]
    return found


def kb_described(grower: str, description: str, live_only: bool = False) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [(invoice, item) for invoice, item in kb_items(grower)
            if flat(str(item.get("description") or "")) == description and (not live_only or invoice.get("status") != "VOID")]


def kb_ref_charges(season: "Season") -> list[tuple[dict[str, Any], dict[str, Any]]]:
    prefix = f"{season.ref} · "
    return [(invoice, item) for invoice, item in kb_items(season.grower_key)
            if flat(str(item.get("description") or "")).startswith(prefix) and invoice.get("status") != "VOID"]


def kb_balance(grower: str) -> Decimal:
    return Decimal(str(kb_get(f"/1.0/kb/accounts/{kb_account_id(grower)}", accountWithBalance="true")["accountBalance"]))


def dollars(cents: int) -> Decimal:
    return Decimal(cents) / 100


def amount(item: dict[str, Any]) -> Decimal:
    return abs(Decimal(str(item["amount"])))


def assert_deposit_invoice(grower: str, ref: str, deposit_cents: int) -> None:
    found = poll(lambda: kb_described(grower, f"Deposit · {ref}", live_only=True), MAIL_WAIT_S)
    assert len(found) == 1, found
    invoice, item = found[0]
    assert amount(item) == dollars(deposit_cents), item
    assert len(invoice.get("items") or [item]) == 1, invoice


def eventually(page: Page, probe: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            if probe():
                return
        except PlaywrightError:
            pass
        if time.monotonic() >= deadline:
            raise AssertionError(f"timed out waiting for {what}")
        advance(page, STEP_MS)


def page_text(page: Page) -> str:
    return page.evaluate("() => document.body ? document.body.innerText : ''")


def region_text(page: Page, role: str, name: str) -> str:
    return "\n".join(page.get_by_role(role, name=name).all_inner_texts())


def announced(page: Page, copy: str, name: str = "Desk updates", role: str = "status", seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: copy in flat(region_text(page, role, name)), f"{name}: {copy}", seconds)


def problem(page: Page, copy: str) -> None:
    announced(page, copy, "Desk problems", "alert")


def shown(page: Page, copy: str, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: copy in flat(page_text(page)), f"text {copy}", seconds)


def shown_any_case(page: Page, copy: str, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: copy.casefold() in flat(page_text(page)).casefold(), f"text {copy}", seconds)


CLIPPED_TEXT_JS = """(root) => {
  const inside = (node, x, y) => {
    for (let el = node.parentElement; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (/hidden|clip|auto|scroll/.test(`${s.overflowX} ${s.overflowY}`)) {
        const c = el.getBoundingClientRect();
        if (x < c.left || x > c.right || y < c.top || y > c.bottom) return false;
      }
      if (el === root) break;
    }
    return true;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (getComputedStyle(node.parentElement).visibility !== 'visible') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width && r.height && inside(node, r.left + r.width / 2, r.top + r.height / 2)) parts.push(node.textContent);
  }
  return parts.join('');
}"""


def clipped_text(locator: Locator) -> str:
    return locator.evaluate(CLIPPED_TEXT_JS)


def sign_in_ui(page: Page, base: str, email: str) -> None:
    page.goto(f"{base}/")
    eventually(page, lambda: page.get_by_role("button", name="Sign in").is_visible(), "sign-in form")
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), PASSWORD)
    click(page.get_by_role("button", name="Sign in"))
    eventually(page, lambda: urlparse(page.url).path.startswith("/desk"), "the desk")


def choose_orchard(page: Page, name: str) -> None:
    toggle = page.get_by_role("button", name="Orchards", exact=True)
    if toggle.is_visible():
        click(toggle)
    link = page.get_by_role("navigation", name="Orchards").get_by_role("link", name=name, exact=True)
    eventually(page, link.is_visible, f"rail link {name}")
    click(link)
    eventually(page, lambda: page.get_by_role("group", name=f"Plat map, {name}").is_visible(), f"plat map of {name}")


def choose(page: Page, combobox: Locator, label: str) -> None:
    try:
        select(combobox, label)
        return
    except Exception:
        pass
    options = combobox.evaluate("el => el.options ? Array.from(el.options).map(o => o.label) : []")
    match = next((option for option in options if label in option), None)
    if match:
        select(combobox, match)
        return
    click(combobox)
    click(mid(page.get_by_role("option", name=re.compile(re.escape(label))).first))


def block_button(page: Page, block: str) -> Locator:
    return page.get_by_role("button", name=re.compile(rf"^{re.escape(block)}, ")).first


def ledger_row(page: Page, label: str, include_hidden: bool = False) -> Locator:
    table = page.get_by_role("table", name="Order ledger", include_hidden=include_hidden)
    return table.get_by_role("row", name=re.compile(rf"^{re.escape(label)}\b"), include_hidden=include_hidden).first


def has_number(content: str, number: int) -> bool:
    return re.search(rf"(?<![\d.]){number}(?![\d.])", content.replace(",", "")) is not None


def meter_text(page: Page, block: str) -> str:
    return page.get_by_role("meter", name=f"Average frames, {block}").first.get_attribute("aria-valuetext") or ""


def open_commit(page: Page, ref: str) -> Locator:
    click(page.get_by_role("region", name="Open orders").get_by_role("button", name=f"Commit truckload to {ref}"))
    dialog = page.get_by_role("dialog", name="Commit truckload")
    eventually(page, dialog.is_visible, "Commit truckload dialog")
    return dialog


def commit_ui(page: Page, ref: str, yard: str, hives: int) -> None:
    dialog = open_commit(page, ref)
    fill(dialog.get_by_role("textbox", name="Yard name"), yard)
    fill(dialog.get_by_role("spinbutton", name="Hives"), str(hives))
    click(dialog.get_by_role("button", name="Commit", exact=True))


def my_drop_row(page: Page, yard: str, hives: int) -> Locator:
    link = page.get_by_role("link", name=f"View drop {yard}, {hives} hives")
    return page.get_by_role("table", name="My drops").get_by_role("row").filter(has=link)


def mid(locator: Locator) -> Locator:
    locator.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
    return locator


def add_sample_ui(page: Page, block: str, yard: str, label: str, frames: str, photo: dict[str, Any] | None = None) -> None:
    form = page.get_by_role("form", name="Add sample")
    choose(page, mid(form.get_by_role("combobox", name="Block")), block)
    choose(page, mid(form.get_by_role("combobox", name="Yard")), yard)
    fill(mid(form.get_by_role("textbox", name="Colony")), label)
    fill(mid(form.get_by_role("spinbutton", name="Frames of bees")), frames)
    if photo:
        form.get_by_label("Frame photo").set_input_files(photo)
    click(mid(form.get_by_role("button", name="Add sample")))


def readout_copy(block: str, frames: list[float], payable: int) -> str:
    if not frames:
        return f"{block}: no samples, Not inspected. Orchard payable {money(payable)}."
    average = mean_frames(frames)
    return f"{block}: {average:.1f} frames, {TIER_LABELS[tier_of(average)]}. Orchard payable {money(payable)}."


def meter_value(frames: list[float]) -> str:
    average = mean_frames(frames)
    return f"{average:.1f} frames, {TIER_LABELS[tier_of(average)]}"


def block_label(block: str, frames: list[float]) -> str:
    if not frames:
        return f"{block}, {TIER_LABELS[None]}"
    average = mean_frames(frames)
    return f"{block}, {TIER_LABELS[tier_of(average)]}, {average:.1f} frames"


def expanded(locator: Locator) -> bool:
    return locator.get_attribute("aria-expanded") == "true"


@contextmanager
def zoned_page(browser: Browser, url: str, zone: str, at: datetime) -> Iterator[Page]:
    context = browser.new_context(timezone_id=zone, viewport=DESKTOP)
    try:
        page = context.new_page()
        page.clock.install(time=at)
        page.goto(url)
        yield page
    finally:
        context.close()


MOTION_JS = """() => {
  if (window.__motion) { window.__motion.length = 0; return; }
  const seen = new WeakSet();
  window.__motion = [];
  const grab = () => {
    for (const animation of document.getAnimations()) {
      if (seen.has(animation)) continue;
      seen.add(animation);
      const effect = animation.effect;
      const timing = effect && effect.getComputedTiming ? effect.getComputedTiming() : {};
      // one clock: the page's (controlled) performance.now() when the motion is seen, plus the motion's remaining time
      const now = performance.now();
      const rate = Math.abs(animation.playbackRate) || 1;
      const length = Number.isFinite(timing.endTime) ? timing.endTime / rate : Infinity;
      const left = Number.isFinite(timing.endTime) ? Math.max(0, timing.endTime - (animation.currentTime ?? 0)) / rate : Infinity;
      window.__motion.push({ target: effect ? effect.target : null, start: now, end: now + left, length });
    }
  };
  for (const type of ['animationstart', 'transitionrun', 'transitionstart']) document.addEventListener(type, grab, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const made = original.apply(this, args); grab(); return made; };
  window.__grabMotion = grab;
}"""

MOTION_SUMMARY_JS = """({ meters, since }) => {
  window.__grabMotion();
  const inside = (target) => target && meters.some((meter) => meter === target || meter.contains(target));
  const mine = window.__motion.filter((entry) => inside(entry.target) && entry.start >= since && entry.length > 1);
  return { targets: new Set(mine.map((entry) => entry.target)).size,
           ends: mine.map((entry) => Number.isFinite(entry.end) ? entry.end : null) };
}"""


def motion_summary(page: Page, block: str, since: float) -> dict[str, Any]:
    meters = [m.element_handle() for m in page.get_by_role("meter", name=f"Average frames, {block}").all()]
    return page.evaluate(MOTION_SUMMARY_JS, {"meters": meters, "since": since})


def clock_now(page: Page) -> float:
    return float(page.evaluate("() => performance.now()"))


ROLL_SAMPLE_JS = """(meters) => {
  window.__rollSeen = window.__rollSeen || new Map();
  let changed = false;
  for (const meter of meters) {
    for (const el of [meter, ...meter.querySelectorAll('*')]) {
      const s = getComputedStyle(el);
      const value = [s.transform, s.translate, s.top, s.marginTop, el.getAttribute('y'), el.getAttribute('transform'),
        el.children.length === 0 ? el.textContent : ''].join('|');
      const seen = window.__rollSeen.get(el);
      if (!seen) { window.__rollSeen.set(el, { values: new Set([value]), last: value }); continue; }
      if (seen.last !== value) { changed = true; seen.last = value; seen.values.add(value); }
    }
  }
  let rolling = 0;
  for (const seen of window.__rollSeen.values()) if (seen.values.size >= 3) rolling += 1;
  return { changed, rolling };
}"""


def sample_roll(page: Page, block: str) -> dict[str, Any]:
    meters = [m.element_handle() for m in page.get_by_role("meter", name=f"Average frames, {block}").all()]
    return page.evaluate(ROLL_SAMPLE_JS, meters)


DRAWER_CLOSED_JS = """(el) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const hidden = el.checkVisibility ? !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : false;
  return hidden || r.width === 0 || r.right <= 0 || r.left >= window.innerWidth || s.visibility === 'hidden'
    || !!el.closest('[inert], [aria-hidden="true"]');
}"""


def drawer_closed(nav: Locator) -> bool:
    return nav.count() == 0 or bool(nav.first.evaluate(DRAWER_CLOSED_JS))


RECORD_JS = """(el, key) => {
  window.__heard = window.__heard || {};
  const log = window.__heard[key] = window.__heard[key] || [];
  if (el.__heardObserver) return;
  const push = () => log.push(el.textContent || '');
  push();
  el.__heardObserver = new MutationObserver(push);
  el.__heardObserver.observe(el, { subtree: true, childList: true, characterData: true });
}"""


def record_region(page: Page, role: str, name: str) -> None:
    region = page.get_by_role(role, name=name).first
    eventually(page, lambda: region.count() > 0, f"{name} region")
    region.evaluate(RECORD_JS, name)


def heard(page: Page, copy: str, name: str = "Desk updates", role: str = "status") -> None:
    def said() -> bool:
        log = page.evaluate("(key) => (window.__heard && window.__heard[key]) || []", name)
        return any(copy in flat(t) for t in log + [region_text(page, role, name)])

    eventually(page, said, f"{name} said {copy}")


def tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-LOG_TAIL:]


@contextmanager
def app_copy(overrides: dict[str, str], ready: Callable[[httpx.Response], bool]) -> Iterator[str]:
    deployed = Path(getattr(importlib.import_module("conftest"), "DEPLOYED_APP", "/app"))
    serve = json.loads((deployed / "run.json").read_text())["serve"]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), APP_BASE_URL=base, **overrides)
    log = tempfile.NamedTemporaryFile(prefix="bloom-copy-", suffix=".log", delete=False)
    process = subprocess.Popen(serve, shell=True, cwd=deployed, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def answered() -> Any:
        if process.poll() is not None:
            return "exited"
        try:
            return ready(httpx.get(f"{base}/api/health", timeout=2))
        except httpx.HTTPError:
            return False

    try:
        state = poll(answered, COPY_BOOT_S)
        assert state is True, f"app copy not ready ({state}): {tail(log.name)}"
        yield base
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=HTTP_TIMEOUT_S)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
        log.close()


@pytest.fixture(scope="module")
def short_ttl_app() -> Iterator[str]:
    overrides = {"INSPECTION_LINK_TTL_SECONDS": str(SHORT_LINK_TTL_S), "FILE_URL_TTL_SECONDS": str(SHORT_FILE_TTL_S)}
    with app_copy(overrides, lambda response: response.status_code == 200) as base:
        yield base


def test_health(app_url: str) -> None:
    response = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    broker = Api.user(app_url, BROKER_EMAIL)
    assert expect_json(broker.get("/api/me"), 200)["user"]["id"] == BROKER_ID
    with app_copy({"DATABASE_URL": DOWN_DATABASE_URL}, lambda answer: True) as base:
        starting = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S)
        assert starting.status_code == 503, starting.text
        assert starting.json() == {"status": "starting"}


def test_seeded_sign_in(app_url: str) -> None:
    people = [(BROKER_ID, BROKER_EMAIL, "broker", None)]
    people += [(uid, email, "beekeeper", name) for uid, email, name in BEEKEEPERS.values()]
    people += [(uid, email, "grower", name) for uid, email, name in GROWERS.values()]
    for user_id, email, role, name in people:
        api = Api(app_url)
        response = api.sign_in(email)
        assert response.status_code == 200, response.text
        user = response.json()["user"]
        assert set(user) == {"id", "name", "role"}
        assert user["id"] == user_id and user["role"] == role
        if name:
            assert user["name"] == name
        cookie = next((c for c in response.headers.get_list("set-cookie") if c.startswith("bloom_session=")), "")
        assert cookie, response.headers
        assert all(flag.lower() in cookie.lower() for flag in COOKIE_FLAGS), cookie
        value = api.http.cookies.get("bloom_session")
        assert expect_json(api.get("/api/me"), 200)["user"]["id"] == user_id
        assert api.delete("/api/session").status_code == 204
        with httpx.Client(base_url=app_url, cookies={"bloom_session": value}, timeout=HTTP_TIMEOUT_S) as replay:
            expect_error(replay.get("/api/me"), 401, "unauthenticated")
    expect_error(Api(app_url).sign_in(BROKER_EMAIL, "not-the-password"), 401, "invalid_credentials")
    expect_error(Api(app_url).get("/api/me"), 401, "unauthenticated")


def test_error_precedence(app_url: str) -> None:
    opened = Season(app_url, [("Block 1", 20, [])]).open()
    draft = Season(app_url, [("Block 1", 20, [])])
    anon = Api(app_url)
    path = f"/api/orders/{opened.order_id}/open"
    oversized = b'{"pad":"' + b"a" * JSON_LIMIT + b'"}'
    expect_error(anon.http.post(path, content=oversized, headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    expect_error(anon.post(path, {}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    expect_error(anon.http.post(path, content=oversized, headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    expect_error(anon.http.post(path, content=b"open", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    expect_error(anon.post(path, {}), 401, "unauthenticated")
    coulee = opened.keepers["coulee"]
    expect_error(coulee.post(f"/api/orders/{draft.order_id}/open"), 404, "not_found")
    expect_error(coulee.post(path), 403, "forbidden")
    expect_error(opened.broker.post(path), 409, "invalid_transition")
    expect_error(opened.broker.post(f"/api/orders/{opened.order_id}/inspection-links", {"inspector_email": "not-an-email"}), 409, "invalid_transition")
    expect_error(opened.broker.get(f"/api/orders/{UNKNOWN_ID}"), 404, "not_found")
    expect_error(opened.grower.get("/api/drops"), 403, "forbidden")
    invalid = expect_error(opened.broker.post("/api/orchards", {"grower_id": GROWERS["harlan"][0], "name": "", "county": COUNTY, "blocks": [{"name": "Block 1", "acres": ACRES}]}), 422, "validation_failed")
    assert invalid["fields"]["name"] == "Orchard name must be 1 to 80 characters"
    unknown = Api(app_url).get("/api/no-such-route")
    expect_error(unknown, 404, unknown.json().get("error", ""))


def test_server_boundary(app_url: str) -> None:
    refused = Api(app_url).post("/api/session", {"email": BROKER_EMAIL, "password": PASSWORD}, headers={"Origin": FOREIGN_ORIGIN})
    expect_error(refused, 403, "cross_origin")
    assert not any(c.startswith("bloom_session=") for c in refused.headers.get_list("set-cookie"))
    cors = httpx.get(f"{app_url}/api/health", headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S)
    assert not [h for h in cors.headers if h.lower().startswith("access-control-")], cors.headers

    broker = Api.user(app_url, BROKER_EMAIL)
    at_limit_name, over_limit_name = fresh("Ranch"), fresh("Ranch")

    def padded(name: str, size: int) -> bytes:
        raw = json.dumps({"grower_id": GROWERS["harlan"][0], "name": name, "county": COUNTY, "blocks": [{"name": "Block 1", "acres": ACRES}]}).encode()
        return raw + b" " * (size - len(raw))

    exact = padded(at_limit_name, JSON_LIMIT)
    assert len(exact) == JSON_LIMIT
    expect_json(broker.http.post("/api/orchards", content=exact, headers={"Content-Type": "application/json"}), 201)
    expect_error(broker.http.post("/api/orchards", content=padded(over_limit_name, JSON_LIMIT + 1), headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    expect_error(broker.http.post("/api/orchards", content=b"name=x", headers={"Content-Type": "application/x-www-form-urlencoded"}), 415, "unsupported_media_type")
    names = {o["name"] for o in expect_json(broker.get("/api/orchards"), 200)}
    assert at_limit_name in names and over_limit_name not in names

    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json"):
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S).status_code == 404, path

    secrets = [os.environ.get(n, "") for n in ("KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY", "DATABASE_URL")]
    secrets = [s for s in secrets if len(s) >= SECRET_MIN_LEN]
    home = httpx.get(f"{app_url}/", timeout=HTTP_TIMEOUT_S).text
    served = [home] + [httpx.get(urljoin(f"{app_url}/", src), timeout=HTTP_TIMEOUT_S).text
                       for src in re.findall(r'src="([^"]+)"', home) if same_host(urljoin(f"{app_url}/", src), app_url)]
    for body in served:
        for secret in secrets:
            assert secret not in body

    down = killbill_down_url()
    health = httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT_S)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    outage_broker = Api.user(down, BROKER_EMAIL)
    assert at_limit_name in {o["name"] for o in expect_json(outage_broker.get("/api/orchards"), 200)}


IN_DRAWER_JS = "(e, nav) => !!nav && nav.contains(e)"
PARKED_JS = """(e) => e.getBoundingClientRect().right <= 0 || !!e.closest('[inert], [aria-hidden="true"]')"""


def fits(page: Page) -> None:
    viewport = page.viewport_size
    assert viewport is not None
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    nav = page.get_by_role("navigation", name="Orchards")
    drawer = nav.first.element_handle() if nav.count() and drawer_closed(nav) else None
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if not control.is_visible() or control.evaluate(PARKED_JS) or control.evaluate(IN_DRAWER_JS, drawer):
            continue
        control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
        box = control.bounding_box()
        assert box and box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1, (control.text_content(), box)


def same_host(url: str, base: str) -> bool:
    return urlparse(url).netloc == urlparse(base).netloc


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_layout_viewports(browser: Browser, app_url: str, mail: Any, viewport: str) -> None:
    width, height = VIEWPORTS[viewport]
    season = Season(app_url, [("Block 1", 10, [("coulee", 10)])]).open().commit().deliver().place()
    token = season.send_link(mail)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size({"width": width, "height": height})
        eventually(page, lambda: page.get_by_role("button", name="Sign in").is_visible(), "sign-in")
        fits(page)
        sign_in_ui(page, app_url, BROKER_EMAIL)
        toggle = page.get_by_role("button", name="Orchards", exact=True)
        nav = page.get_by_role("navigation", name="Orchards")
        if width < DESKTOP["width"]:
            eventually(page, toggle.is_visible, "Orchards button")
            eventually(page, lambda: drawer_closed(nav), "closed drawer kept off the canvas")
        choose_orchard(page, season.name)
        plat = page.get_by_role("group", name=f"Plat map, {season.name}")
        ledger = page.get_by_role("table", name="Order ledger")
        eventually(page, ledger.is_visible, "ledger")
        if width < DESKTOP["width"]:
            advance(page, DRAWER_SETTLE_MS)
        fits(page)
        page.evaluate("window.scrollTo({top: 0, left: 0, behavior: 'instant'})")
        map_box, ledger_box = plat.bounding_box(), ledger.bounding_box()
        if width == DESKTOP["width"]:
            nav_box = nav.bounding_box()
            assert nav_box["x"] + nav_box["width"] <= map_box["x"] + 1
            assert map_box["x"] + map_box["width"] <= ledger_box["x"] + 1
        else:
            assert ledger_box["y"] >= map_box["y"] + map_box["height"] - 1
        if width == PHONE["width"]:
            tops = [toggle.bounding_box()["y"], page.get_by_role("combobox", name="Order").bounding_box()["y"],
                    map_box["y"], page.get_by_role("list", name="Tier legend").bounding_box()["y"], ledger_box["y"]]
            assert tops == sorted(tops), tops
        page.goto(f"{app_url}/desk/drops/{season.drops[0]['id']}")
        shown(page, season.drops[0]["yard"])
        fits(page)
        page.goto(f"{app_url}/inspect/{token}")
        shown(page, season.name)
        fits(page)
        if width == PHONE["width"]:
            sign = page.get_by_role("button", name="Sign report", exact=True).bounding_box()
            assert sign["y"] + sign["height"] <= height + 1 and sign["y"] >= height / 2


def tab_to(page: Page, roles: tuple[str, ...], name: str) -> bool:
    page.keyboard.press("Tab")
    return any(page.get_by_role(role, name=name, exact=True).evaluate_all("els => els.includes(document.activeElement)")
               for role in roles)


FIRST_FIELD_JS = """(d) => { const e = document.activeElement;
  return !!e && d.contains(e) && e.matches('input, select, textarea, [role=combobox], [role=textbox], [role=spinbutton]'); }"""


def test_keyboard_and_focus(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, GROWERS["mendota"][1])
        eventually(page, lambda: page.get_by_role("link", name=MENDOTA_ORCHARD).is_visible(), "rail")
        page.get_by_role("link", name="Skip to plat map").focus()
        assert tab_to(page, ("button", "link"), "Sign out"), "Tab from the skip link reaches Sign out"
        assert tab_to(page, ("link",), MENDOTA_ORCHARD), f"next Tab reaches {MENDOTA_ORCHARD}"
        choose_orchard(page, MENDOTA_ORCHARD)
        page.get_by_role("link", name=MENDOTA_ORCHARD, exact=True).focus()
        assert tab_to(page, ("combobox",), "Order"), "Tab reaches the Order picker"
        for block in MENDOTA_BLOCKS:
            assert tab_to(page, ("button",), f"{block}, Not inspected"), f"Tab reaches {block}"
        page.get_by_role("link", name="Skip to plat map").focus()
        page.keyboard.press("Enter")
        group = page.get_by_role("group", name=f"Plat map, {MENDOTA_ORCHARD}")
        eventually(page, lambda: group.evaluate("el => el === document.activeElement"), "plat map focused")
        for block, key in zip(MENDOTA_BLOCKS, ("Enter", "Space")):
            button = page.get_by_role("button", name=f"{block}, Not inspected")
            button.focus()
            page.keyboard.press(key)
            eventually(page, page.get_by_role("table", name=f"Placements, {block}").is_visible, f"placements of {block}")
            assert button.evaluate("el => el === document.activeElement")

    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BROKER_EMAIL)
        opener = page.get_by_role("button", name="New orchard")
        eventually(page, opener.is_visible, "New orchard button")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New orchard")
        eventually(page, dialog.is_visible, "New orchard dialog")
        eventually(page, lambda: dialog.evaluate(FIRST_FIELD_JS), "first field focused")
        for _ in range(BLOCK_NAME_MAX // 2):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        eventually(page, lambda: not dialog.is_visible(), "dialog closed")
        eventually(page, lambda: opener.evaluate("el => el === document.activeElement"), "focus back on New orchard")

    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(PHONE)
        sign_in_ui(page, app_url, GROWERS["mendota"][1])
        toggle = page.get_by_role("button", name="Orchards", exact=True)
        eventually(page, toggle.is_visible, "Orchards button")
        assert not expanded(toggle)
        click(toggle)
        link = page.get_by_role("navigation", name="Orchards").get_by_role("link", name=MENDOTA_ORCHARD, exact=True)
        eventually(page, lambda: link.evaluate("el => el === document.activeElement"), "first orchard link focused")
        assert expanded(toggle)
        page.keyboard.press("Escape")
        eventually(page, lambda: toggle.evaluate("el => el === document.activeElement"), "focus back on Orchards")
        assert not expanded(toggle)


def test_announced_feedback(browser: Browser, app_url: str) -> None:
    name = fresh("Ranch")
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, lambda: page.get_by_role("button", name="Sign in").is_visible(), "sign-in")
        fill(page.get_by_role("textbox", name="Email"), BROKER_EMAIL)
        fill(page.get_by_label("Password", exact=True), "not-the-password")
        click(page.get_by_role("button", name="Sign in"))
        problem(page, "That email and password don't match a Bloom Desk account.")
        sign_in_ui(page, app_url, BROKER_EMAIL)

        def open_dialog() -> Locator:
            click(page.get_by_role("button", name="New orchard"))
            dialog = page.get_by_role("dialog", name="New orchard")
            eventually(page, dialog.is_visible, "New orchard dialog")
            choose(page, dialog.get_by_role("combobox", name="Grower"), GROWERS["harlan"][2])
            fill(dialog.get_by_role("textbox", name="County"), COUNTY)
            if dialog.get_by_role("textbox", name="Block name").count() == 0:
                click(dialog.get_by_role("button", name="Add block"))
            fill(dialog.get_by_role("textbox", name="Block name").first, "Block 1")
            fill(dialog.get_by_role("spinbutton", name="Acres").first, str(ACRES))
            return dialog

        dialog = open_dialog()
        fill(dialog.get_by_role("textbox", name="Orchard name"), name)
        save = dialog.get_by_role("button", name="Save orchard").element_handle()
        with held(page, "**/api/orchards") as hold:
            save.click()
            announced(page, "Saving orchard…")
            assert save.is_disabled() or save.get_attribute("aria-busy") == "true"
            hold.release()
        announced(page, f"Orchard {name} saved.")
        assert name in {o["name"] for o in expect_json(Api.user(app_url, BROKER_EMAIL).get("/api/orchards"), 200)}

        eventually(page, lambda: not dialog.is_visible(), "dialog closed")
        dialog = open_dialog()
        fill(dialog.get_by_role("textbox", name="Orchard name"), "")
        dialog.evaluate("d => { for (const f of [...(d.tagName === 'FORM' ? [d] : []), ...d.querySelectorAll('form')]) f.noValidate = true; }")
        retry = dialog.get_by_role("button", name="Save orchard")
        if retry.is_enabled():
            click(retry)
        else:
            dialog.evaluate("d => (d.tagName === 'FORM' ? d : d.querySelector('form')).requestSubmit()")
        message = "Orchard name must be 1 to 80 characters"
        heading = dialog.get_by_role("heading", name="There is a problem")
        eventually(page, heading.is_visible, "error summary")
        eventually(page, lambda: heading.evaluate("h => document.activeElement === h || document.activeElement.contains(h) || h.parentElement.contains(document.activeElement)"), "focus on summary")
        assert flat(dialog.inner_text()).count(message) >= 2
        click(dialog.get_by_role("link", name=message))
        eventually(page, lambda: dialog.get_by_role("textbox", name="Orchard name").evaluate("el => el === document.activeElement"), "field focused")


AXE_RULES = ["color-contrast", "non-text-contrast", "target-size"]


def contrast_and_targets_audit(page: Page) -> None:
    page.evaluate("() => {\n" + AXE.read_text() + "\n}")
    page.evaluate("""rules => { window.__contrastAudit = null;
      const known = new Set(axe.getRules().map(r => r.ruleId));
      axe.run(document, { runOnly: { type: 'rule', values: rules.filter(r => known.has(r)) } }).then(
        v => { window.__contrastAudit = { error: null, violations: v.violations.map(x => ({ id: x.id, nodes: x.nodes.map(n => n.target) })) }; },
        e => { window.__contrastAudit = { error: String(e), violations: [] }; }); }""", AXE_RULES)
    eventually(page, lambda: page.evaluate("() => window.__contrastAudit") is not None, "axe contrast audit")
    status = page.evaluate("() => window.__contrastAudit")
    assert status["error"] is None, status["error"]
    assert not status["violations"], f"contrast/target violations: {status['violations']}"


def test_contrast_and_targets(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(PHONE)
        eventually(page, lambda: page.get_by_role("button", name="Sign in").is_visible(), "sign-in")
        contrast_and_targets_audit(page)
        rest, focus = state_styles(page.get_by_role("button", name="Sign in"), "outline-style", "outline-width", "outline-color", "outline-offset", "box-shadow", state="focus")
        assert rest != focus, (rest, focus)
        sign_in_ui(page, app_url, GROWERS["mendota"][1])
        choose_orchard(page, MENDOTA_ORCHARD)
        rail = page.get_by_role("navigation", name="Orchards")
        if page.get_by_role("button", name="Orchards", exact=True).is_visible():
            eventually(page, lambda: drawer_closed(rail), "Orchards drawer closed after choosing")
        advance(page, DRAWER_SETTLE_MS)
        contrast_and_targets_audit(page)
        for role in ("button", "link", "textbox", "combobox", "spinbutton"):
            for control in page.get_by_role(role).all():
                if not control.is_visible():
                    continue
                box = control.bounding_box()
                if not box or box["width"] <= 1 or box["height"] <= 1:
                    continue
                assert box["width"] >= MIN_TARGET_PX - 0.5 and box["height"] >= MIN_TARGET_PX - 0.5, (role, control.text_content(), box)


def test_orchard_validation(app_url: str) -> None:
    broker = Api.user(app_url, BROKER_EMAIL)
    rejected: list[str] = []
    cases = [
        ({"grower_id": "grw_nobody"}, "grower_id", "Choose a grower"),
        ({"name": ""}, "name", "Orchard name must be 1 to 80 characters"),
        ({"name": "N" * (ORCHARD_NAME_MAX + 1)}, "name", "Orchard name must be 1 to 80 characters"),
        ({"county": ""}, "county", "County must be 1 to 40 characters"),
        ({"county": "C" * (COUNTY_MAX + 1)}, "county", "County must be 1 to 40 characters"),
        ({"blocks": []}, "blocks", "An orchard needs 1 to 12 blocks"),
        ({"blocks": [{"name": f"B{i}", "acres": ACRES} for i in range(BLOCKS_MAX + 1)]}, "blocks", "An orchard needs 1 to 12 blocks"),
        ({"blocks": [{"name": "Block 1", "acres": ACRES}, {"name": "Block 1", "acres": ACRES}]}, ("blocks.0.name", "blocks.1.name"), "Block names must be 1 to 30 characters and unique in the orchard"),
        ({"blocks": [{"name": "B" * (BLOCK_NAME_MAX + 1), "acres": ACRES}]}, "blocks.0.name", "Block names must be 1 to 30 characters and unique in the orchard"),
        ({"blocks": [{"name": "Block 1", "acres": 0}]}, "blocks.0.acres", "Acres must be between 1 and 500 with at most one decimal"),
        ({"blocks": [{"name": "Block 1", "acres": ACRES_MAX + 0.1}]}, "blocks.0.acres", "Acres must be between 1 and 500 with at most one decimal"),
        ({"blocks": [{"name": "Block 1", "acres": 12.25}]}, "blocks.0.acres", "Acres must be between 1 and 500 with at most one decimal"),
    ]
    for override, field, message in cases:
        body = {"grower_id": GROWERS["harlan"][0], "name": fresh("Ranch"), "county": COUNTY, "blocks": [{"name": "Block 1", "acres": ACRES}], **override}
        answer = expect_error(broker.post("/api/orchards", body), 422, "validation_failed")
        assert any(answer["fields"].get(f) == message for f in ((field,) if isinstance(field, str) else field)), (field, answer)
        rejected.append(body["name"])

    name = (fresh("Ranch") + " " + "N" * ORCHARD_NAME_MAX)[:ORCHARD_NAME_MAX]
    blocks = [{"name": f"B{i}", "acres": ACRES} for i in range(BLOCKS_MAX - 3)]
    blocks += [{"name": "L" * BLOCK_NAME_MAX, "acres": 1}, {"name": "Top", "acres": ACRES_MAX}, {"name": "Half", "acres": 12.5}]
    made = expect_json(broker.post("/api/orchards", {"grower_id": GROWERS["harlan"][0], "name": name, "county": "C" * COUNTY_MAX, "blocks": blocks}), 201)
    assert made["name"] == name
    assert sorted((b["name"], Decimal(str(b["acres"]))) for b in made["blocks"]) == sorted((b["name"], Decimal(str(b["acres"]))) for b in blocks)
    listed = {o["name"]: o for o in expect_json(broker.get("/api/orchards"), 200)}
    assert listed[name]["grower"] == {"id": GROWERS["harlan"][0], "name": GROWERS["harlan"][2]}
    assert not set(rejected) & set(listed)
    harlan = {o["name"] for o in expect_json(Api.user(app_url, GROWERS["harlan"][1]).get("/api/orchards"), 200)}
    mendota = {o["name"] for o in expect_json(Api.user(app_url, GROWERS["mendota"][1]).get("/api/orchards"), 200)}
    beekeeper = {o["name"] for o in expect_json(Api.user(app_url, BEEKEEPERS["coulee"][1]).get("/api/orchards"), 200)}
    assert name in harlan and name not in mendota and name not in beekeeper


def test_draft_order_rules(app_url: str) -> None:
    broker = Api.user(app_url, BROKER_EMAIL)
    first = Season(app_url, [("Block 1", 30, []), ("Block 2", 20, [])])
    order = first.order()
    assert order["status"] == "draft"
    assert set(order) == BROKER_ORDER_KEYS
    assert order["rule_set"] == {"id": RULES["2027"]["id"], "name": "2027 season"}
    assert order["commission_bps"] == RULES["2027"]["bps"]
    assert order["deposit_cents"] == first.hives * RULES["2027"]["deposit"]
    assert order["bloom_start"] == SEASON_START and order["delivery_deadline"] == SEASON_DEADLINE
    assert re.fullmatch(r"BD-\d{4,}", order["ref"])

    start = date.fromisoformat(RS_2027_EFFECTIVE) - timedelta(days=1)
    earlier = Season(app_url, [("Block 1", 10, [])], start=start.isoformat(), end=(start + timedelta(days=BLOOM_WINDOW_DAYS)).isoformat(), deadline=start.isoformat(), rule="2026")
    previous = earlier.order()
    assert previous["rule_set"]["id"] == RULES["2026"]["id"]
    assert previous["deposit_cents"] == 10 * RULES["2026"]["deposit"]
    assert int(previous["ref"].split("-")[1]) > int(order["ref"].split("-")[1])

    blocks = [{"block_id": first.block_ids["Block 1"], "hives": 10}]
    base = {"orchard_id": first.orchard_id, "bloom_start": SEASON_START, "bloom_end": SEASON_END, "delivery_deadline": SEASON_DEADLINE, "blocks": blocks}
    too_early = (date.fromisoformat(RS_2026_EFFECTIVE) - timedelta(days=1)).isoformat()
    window_end = (date.fromisoformat(SEASON_START) + timedelta(days=BLOOM_WINDOW_DAYS + 1)).isoformat()
    other = Season(app_url, [("Block 9", 10, [])])
    cases = [
        ({"orchard_id": UNKNOWN_ID}, "orchard_id", "Choose an orchard"),
        ({"blocks": []}, "blocks", "Order at least one block, each block once"),
        ({"blocks": blocks + blocks}, "blocks", "Order at least one block, each block once"),
        ({"blocks": [{"block_id": other.block_ids["Block 9"], "hives": 10}]}, "blocks.0.block_id", "That block isn't on this orchard"),
        ({"blocks": [{"block_id": first.block_ids["Block 1"], "hives": 0}]}, "blocks.0.hives", "Hives must be a whole number from 1 to 2000"),
        ({"blocks": [{"block_id": first.block_ids["Block 1"], "hives": HIVES_PER_BLOCK_MAX + 1}]}, "blocks.0.hives", "Hives must be a whole number from 1 to 2000"),
        ({"blocks": [{"block_id": first.block_ids["Block 1"], "hives": 1.5}]}, "blocks.0.hives", "Hives must be a whole number from 1 to 2000"),
        ({"bloom_start": too_early, "bloom_end": too_early, "delivery_deadline": too_early}, "bloom_start", "No pay rules cover this bloom start"),
        ({"bloom_end": (date.fromisoformat(SEASON_START) - timedelta(days=1)).isoformat()}, "bloom_end", "Bloom end must be on or after bloom start and within 45 days of it"),
        ({"bloom_end": window_end}, "bloom_end", "Bloom end must be on or after bloom start and within 45 days of it"),
        ({"delivery_deadline": (date.fromisoformat(SEASON_START) + timedelta(days=1)).isoformat()}, "delivery_deadline", "Delivery deadline must be on or before bloom start"),
        ({"delivery_deadline": "11/01/2026"}, "delivery_deadline", "Use a date like 2027-02-05"),
    ]
    for override, field, message in cases:
        answer = expect_error(broker.post("/api/orders", {**base, **override}), 422, "validation_failed")
        assert answer["fields"].get(field) == message, (field, answer)
    edge = (date.fromisoformat(SEASON_START) + timedelta(days=BLOOM_WINDOW_DAYS)).isoformat()
    expect_json(broker.post("/api/orders", {**base, "bloom_end": edge, "blocks": [{"block_id": first.block_ids["Block 1"], "hives": HIVES_PER_BLOCK_MAX}]}), 201)
    orders = [o for o in expect_json(broker.get("/api/orders"), 200) if o["orchard"]["id"] == first.orchard_id]
    assert len(orders) == 2


def test_open_order_deposit(app_url: str) -> None:
    season = Season(app_url, [("Block 1", 30, []), ("Block 2", 10, [])])
    coulee, grower = season.keepers["coulee"], season.grower
    expect_error(grower.get(f"/api/orders/{season.order_id}"), 404, "not_found")
    expect_error(coulee.get(f"/api/orders/{season.order_id}"), 404, "not_found")
    assert season.order_id not in {o["id"] for o in expect_json(grower.get("/api/orders"), 200)}
    assert season.order_id not in {o["id"] for o in expect_json(coulee.get("/api/orders"), 200)}
    assert kb_described("harlan", f"Deposit · {season.ref}") == []
    opened = expect_json(season.broker.post(f"/api/orders/{season.order_id}/open"), 200)
    assert opened["status"] == "open"
    seen = season.order(grower)
    assert seen["status"] == "open" and seen["deposit_cents"] == season.hives * RULES["2027"]["deposit"]
    assert season.order_id in {o["id"] for o in expect_json(coulee.get("/api/orders"), 200)}
    assert season.order(coulee)["hives_remaining"] == season.hives
    expect_error(season.broker.post(f"/api/orders/{season.order_id}/open"), 409, "invalid_transition")
    assert_deposit_invoice("harlan", season.ref, season.hives * RULES["2027"]["deposit"])
    account = killbill_account()
    assert account.get("name") == GROWERS["harlan"][2] and account.get("currency") == "USD" and account.get("email") == GROWERS["harlan"][1]

    stuck = Season(app_url, [("Block 1", 10, [])])
    outage_broker = Api.user(killbill_down_url(), BROKER_EMAIL)
    expect_error(outage_broker.post(f"/api/orders/{stuck.order_id}/open"), 503, "billing_unavailable")
    assert stuck.order()["status"] == "draft"
    expect_error(coulee.get(f"/api/orders/{stuck.order_id}"), 404, "not_found")
    assert kb_described("harlan", f"Deposit · {stuck.ref}") == []


_KILLBILL: dict[str, Any] = {}


@pytest.fixture(autouse=True)
def _remember_killbill(killbill: Any) -> None:
    _KILLBILL["client"] = killbill


def killbill_account() -> dict[str, Any]:
    account = poll(lambda: _KILLBILL["client"].account_by_key(GROWERS["harlan"][0]), MAIL_WAIT_S)
    assert account, "Kill Bill account keyed by the grower id"
    return account


def test_cancel_order(app_url: str) -> None:
    draft = Season(app_url, [("Block 1", 10, [])])
    assert expect_json(draft.broker.post(f"/api/orders/{draft.order_id}/cancel"), 200)["status"] == "cancelled"
    expect_error(draft.broker.post(f"/api/orders/{draft.order_id}/cancel"), 409, "invalid_transition")

    opened = Season(app_url, [("Block 1", 20, [("coulee", 10)])]).open().commit()
    expect_error(opened.keepers["coulee"].post(f"/api/orders/{opened.order_id}/cancel"), 403, "forbidden")
    deposit = opened.hives * RULES["2027"]["deposit"]
    assert_deposit_invoice("harlan", opened.ref, deposit)
    expect_error(Api.user(killbill_down_url(), BROKER_EMAIL).post(f"/api/orders/{opened.order_id}/cancel"), 503, "billing_unavailable")
    assert opened.order()["status"] == "open"
    assert_deposit_invoice("harlan", opened.ref, deposit)
    assert expect_json(opened.broker.post(f"/api/orders/{opened.order_id}/cancel"), 200)["status"] == "cancelled"
    assert poll(lambda: kb_described("harlan", f"Deposit · {opened.ref}", live_only=True) == [], MAIL_WAIT_S), "deposit invoice still live after cancel"
    coulee = opened.keepers["coulee"]
    drop = opened.drops[0]
    assert expect_json(coulee.get(f"/api/drops/{drop['id']}"), 200)["status"] == "committed"
    assert opened.order(coulee)["status"] == "cancelled"
    expect_error(coulee.post(f"/api/drops/{drop['id']}/deliver", {"block_id": opened.block_ids["Block 1"], "delivered_at": PAST_DELIVERY}), 409, "invalid_transition")
    expect_error(coulee.post(f"/api/orders/{opened.order_id}/drops", {"yard_name": fresh("Yard"), "hives": 1}), 409, "invalid_transition")

    filled = Season(app_url, [("Block 1", 10, [("prairie", 10)])]).open().commit()
    assert filled.order()["status"] == "filled"
    assert expect_json(filled.broker.post(f"/api/orders/{filled.order_id}/cancel"), 200)["status"] == "cancelled"
    assert poll(lambda: kb_described("harlan", f"Deposit · {filled.ref}", live_only=True) == [], MAIL_WAIT_S), "deposit invoice still live after cancel"

    delivered = Season(app_url, [("Block 1", 20, [("ridge", 10)])]).open().commit().deliver()
    expect_error(delivered.broker.post(f"/api/orders/{delivered.order_id}/cancel"), 409, "drops_delivered")
    assert delivered.order()["status"] == "open"


def test_wf_broker_order_setup_happy(browser: Browser, app_url: str) -> None:
    name = fresh("Ranch")
    hives = {"North Block": 24, "South Block": 16}
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BROKER_EMAIL)
        click(page.get_by_role("button", name="New orchard"))
        dialog = page.get_by_role("dialog", name="New orchard")
        eventually(page, dialog.is_visible, "New orchard dialog")
        choose(page, dialog.get_by_role("combobox", name="Grower"), GROWERS["harlan"][2])
        fill(dialog.get_by_role("textbox", name="Orchard name"), name)
        fill(dialog.get_by_role("textbox", name="County"), COUNTY)
        rows = dialog.get_by_role("textbox", name="Block name")
        for _ in range(len(hives)):
            if rows.count() < len(hives):
                click(dialog.get_by_role("button", name="Add block"))
        eventually(page, lambda: rows.count() == len(hives), "block rows")
        for index, block in enumerate(hives):
            fill(rows.nth(index), block)
            fill(dialog.get_by_role("spinbutton", name="Acres").nth(index), str(ACRES))
        click(dialog.get_by_role("button", name="Save orchard"))
        announced(page, f"Orchard {name} saved.")
        eventually(page, lambda: not dialog.is_visible(), "dialog closed")

        click(page.get_by_role("button", name="New order"))
        dialog = page.get_by_role("dialog", name="New order")
        eventually(page, dialog.is_visible, "New order dialog")
        choose(page, dialog.get_by_role("combobox", name="Orchard"), name)
        fill(dialog.get_by_role("textbox", name="Bloom start"), SEASON_START)
        fill(dialog.get_by_role("textbox", name="Bloom end"), SEASON_END)
        fill(dialog.get_by_role("textbox", name="Delivery deadline"), SEASON_DEADLINE)
        for block, count in hives.items():
            fill(dialog.get_by_role("spinbutton", name=f"Hives, {block}"), str(count))
        click(dialog.get_by_role("button", name="Save draft"))
        broker = Api.user(app_url, BROKER_EMAIL)
        orchard = next(o for o in expect_json(broker.get("/api/orchards"), 200) if o["name"] == name)
        order = poll(lambda: next((o for o in expect_json(broker.get("/api/orders"), 200) if o["orchard"]["id"] == orchard["id"]), None), UI_WAIT_S)
        assert order, "draft order stored"
        announced(page, f"Draft order {order['ref']} saved.")
        eventually(page, lambda: not dialog.is_visible(), "dialog closed")

        choose_orchard(page, name)
        click(page.get_by_role("button", name="Open order"))
        announced(page, f"{order['ref']} is open to beekeepers. Deposit invoice recorded.")
        shown(page, "Order status: Open")
        plat = page.get_by_role("group", name=f"Plat map, {name}")
        for block in hives:
            button = plat.get_by_role("button", name=f"{block}, Not inspected")
            eventually(page, button.is_visible, f"{block} on the plat map")
            assert "Not inspected" in flat(button.text_content() or "")
        eventually(page, lambda: has_number(ledger_row(page, "Ordered").inner_text(), sum(hives.values())), "Ordered row")

    stored = expect_json(broker.get(f"/api/orders/{order['id']}"), 200)
    assert stored["status"] == "open" and stored["rule_set"]["id"] == RULES["2027"]["id"]
    assert stored["bloom_start"] == SEASON_START and stored["bloom_end"] == SEASON_END and stored["delivery_deadline"] == SEASON_DEADLINE
    assert {b["name"]: b["hives_ordered"] for b in stored["blocks"]} == hives
    assert stored["deposit_cents"] == sum(hives.values()) * RULES["2027"]["deposit"]
    coulee = Api.user(app_url, BEEKEEPERS["coulee"][1])
    assert order["id"] in {o["id"] for o in expect_json(coulee.get("/api/orders"), 200)}
    assert_deposit_invoice("harlan", order["ref"], sum(hives.values()) * RULES["2027"]["deposit"])


def test_wf_broker_order_setup_zone(browser: Browser, app_url: str) -> None:
    season = Season(app_url, [("Block 1", 10, [])])
    at = datetime(2026, 10, 28, 20, 0, tzinfo=PACIFIC)
    with zoned_page(browser, f"{app_url}/", "Pacific/Kiritimati", at) as page:
        sign_in_ui(page, app_url, BROKER_EMAIL)
        click(page.get_by_role("button", name="New order"))
        dialog = page.get_by_role("dialog", name="New order")
        eventually(page, dialog.is_visible, "New order dialog")
        choose(page, dialog.get_by_role("combobox", name="Orchard"), season.name)
        fill(dialog.get_by_role("textbox", name="Bloom start"), SEASON_START)
        fill(dialog.get_by_role("textbox", name="Bloom end"), SEASON_END)
        fill(dialog.get_by_role("textbox", name="Delivery deadline"), SEASON_DEADLINE)
        fill(dialog.get_by_role("spinbutton", name=f"Hives, {season.layout[0][0]}"), str(season.hives))
        click(dialog.get_by_role("button", name="Save draft"))
        eventually(page, lambda: not dialog.is_visible(), "draft saved")
    orders = [o for o in expect_json(season.broker.get("/api/orders"), 200) if o["orchard"]["id"] == season.orchard_id and o["id"] != season.order_id]
    assert len(orders) == 1
    assert (orders[0]["bloom_start"], orders[0]["bloom_end"], orders[0]["delivery_deadline"]) == (SEASON_START, SEASON_END, SEASON_DEADLINE)
    assert orders[0]["status"] == "draft" and orders[0]["rule_set"]["id"] == RULES["2027"]["id"]


def test_wf_broker_order_setup_outage(browser: Browser, app_url: str) -> None:
    season = Season(app_url, [("Block 1", 10, [])])
    down = killbill_down_url()
    with open_app(browser, f"{down}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, down, BROKER_EMAIL)
        choose_orchard(page, season.name)
        click(page.get_by_role("button", name="Open order"))
        problem(page, f"Billing is unreachable, so {season.ref} is still a draft. Try again in a minute.")
        shown(page, "Order status: Draft")
    assert season.order()["status"] == "draft"
    expect_error(season.keepers["coulee"].get(f"/api/orders/{season.order_id}"), 404, "not_found")
    season.open()
    assert season.order()["status"] == "open"


def test_beekeeper_order_view(app_url: str) -> None:
    season = Season(app_url, [("Block 1", 30, [("coulee", 10), ("prairie", 10)])]).open().commit()
    coulee = season.keepers["coulee"]
    mine, theirs = season.drop_in("Block 1", "coulee"), season.drop_in("Block 1", "prairie")
    order = season.order(coulee)
    assert set(order) == BEEKEEPER_ORDER_KEYS
    assert all(set(b) == BEEKEEPER_BLOCK_KEYS for b in order["blocks"])
    rule = RULES["2027"]
    assert order["pay_per_hive_cents"] == {t: pay_per_hive(p, rule["bps"]) for t, p in rule["prices"].items()}
    assert order["hives_remaining"] == season.hives - mine["hives"] - theirs["hives"]
    assert [d["id"] for d in order["my_drops"]] == [mine["id"]]
    assert all(set(d) == DROP_KEYS for d in order["my_drops"])
    dumped = json.dumps(order)
    assert theirs["id"] not in dumped and theirs["yard"] not in dumped
    listed = next(o for o in expect_json(coulee.get("/api/orders"), 200) if o["id"] == season.order_id)
    assert set(listed) == BEEKEEPER_ORDER_KEYS - LIST_ONLY_DROPPED
    drops = expect_json(coulee.get("/api/drops"), 200)
    ids = {d["id"] for d in drops}
    assert mine["id"] in ids and theirs["id"] not in ids


def test_last_hive_commit_race(app_url: str) -> None:
    ordered, seed, first = 100, 10, 60
    rest = ordered - 2 * seed - first
    season = Season(app_url, [("Block 1", ordered, [])]).open()
    path = f"/api/orders/{season.order_id}/drops"
    clients = [Api.user(app_url, BEEKEEPERS[k][1]) for k in ("coulee", "prairie", "ridge", "coulee")]
    for client in clients[:2]:
        assert client.post(path, {"yard_name": fresh("Yard"), "hives": seed}).status_code == 201
    results = race([lambda c=c: c.post(path, {"yard_name": fresh("Yard"), "hives": first}) for c in clients])
    assert [r.status_code for r in results].count(201) == 1, [r.text for r in results]
    for response in results:
        if response.status_code != 201:
            assert expect_error(response, 409, "not_enough_open_hives")["remaining"] == rest
    results = race([lambda c=c: c.post(path, {"yard_name": fresh("Yard"), "hives": rest}) for c in clients[:2]])
    assert [r.status_code for r in results].count(201) == 1, [r.text for r in results]
    loser = next(r for r in results if r.status_code != 201)
    assert expect_error(loser, 409, "not_enough_open_hives")["remaining"] == 0
    order = season.order()
    assert order["hives_committed"] == ordered and order["status"] == "filled"
    assert expect_error(clients[0].post(path, {"yard_name": fresh("Yard"), "hives": 1}), 409, "not_enough_open_hives")["remaining"] == 0


def test_wf_beekeeper_commit_race(browser: Browser, app_url: str) -> None:
    season = Season(app_url, [(f"Block {i}", TRUCK, []) for i in (1, 2, 3)]).open()
    after_first = HS_TOTAL - TRUCK
    remaining = HS_TOTAL - 2 * TRUCK
    with open_app(browser, f"{app_url}/") as coulee, open_app(browser, f"{app_url}/") as prairie:
        for page, key in ((coulee, "coulee"), (prairie, "prairie")):
            page.set_viewport_size(DESKTOP)
            sign_in_ui(page, app_url, BEEKEEPERS[key][1])
            button = page.get_by_role("region", name="Open orders").get_by_role("button", name=f"Commit truckload to {season.ref}")
            eventually(page, button.is_visible, "order among open orders")
        commit_ui(coulee, season.ref, fresh("Yard"), TRUCK)
        announced(coulee, f"{TRUCK} hives committed to {season.ref}.")
        choose_orchard(coulee, season.name)
        eventually(coulee, lambda: has_number(ledger_row(coulee, "Still open").inner_text(), after_first), "Still open falls")

        dialog = open_commit(coulee, season.ref)
        hives_field = dialog.get_by_role("spinbutton", name="Hives")
        eventually(coulee, lambda: hives_field.input_value() == str(after_first), "Hives starts at still-open count")
        fill(dialog.get_by_role("textbox", name="Yard name"), fresh("Yard"))
        fill(hives_field, str(OVERSIZE))

        commit_ui(prairie, season.ref, fresh("Yard"), TRUCK)
        announced(prairie, f"{TRUCK} hives committed to {season.ref}.")

        click(dialog.get_by_role("button", name="Commit", exact=True))
        refusal = f"Only {remaining} hives are still open on {season.ref}."
        eventually(coulee, lambda: refusal in flat(dialog.inner_text()), "refusal in dialog")
        alerts = coulee.get_by_role("alert", name="Desk problems", include_hidden=True)
        eventually(coulee, lambda: refusal in flat(" ".join(alerts.all_text_contents())), f"Desk problems: {refusal}")
        assert dialog.is_visible()
        eventually(coulee, lambda: str(remaining) in (hives_field.get_attribute("max"), hives_field.get_attribute("aria-valuemax")), "field max updated")
        eventually(coulee, lambda: has_number(ledger_row(coulee, "Still open", include_hidden=True).inner_text(), remaining), "ledger updated by refusal")
        fill(hives_field, str(remaining))
        click(dialog.get_by_role("button", name="Commit", exact=True))
        announced(coulee, f"{remaining} hives committed to {season.ref}.")
        eventually(coulee, lambda: not dialog.is_visible(), "dialog closed")
    order = season.order()
    assert order["status"] == "filled" and order["hives_committed"] == HS_TOTAL
    assert sorted(d["hives"] for d in season.order(season.keepers["coulee"])["my_drops"]) == [TRUCK, remaining]
    assert [d["hives"] for d in season.order(season.keepers["prairie"])["my_drops"]] == [TRUCK]


def test_wf_beekeeper_commit_isolation(browser: Browser, app_url: str) -> None:
    season = Season(app_url, [("Block 1", 40, [])]).open()
    yard = fresh("Yard")
    rule = RULES["2027"]
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BEEKEEPERS["coulee"][1])
        region = page.get_by_role("region", name="Open orders")
        eventually(page, lambda: season.ref in region.inner_text(), "order listed")
        listing = region.inner_text()
        assert money(pay_per_hive(rule["prices"]["standard"], rule["bps"])) in listing
        assert money(rule["prices"]["standard"]) not in listing
        commit_ui(page, season.ref, yard, 10)
        announced(page, f"10 hives committed to {season.ref}.")
        eventually(page, lambda: my_drop_row(page, yard, 10).count() == 1, "drop in My drops")
    drop = next(d for d in season.order(season.keepers["coulee"])["my_drops"] if d["yard_name"] == yard)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BEEKEEPERS["prairie"][1])
        eventually(page, lambda: page.get_by_role("table", name="My drops").is_visible() or "You haven't committed any truckloads yet." in page_text(page), "My drops")
        assert page.get_by_role("link", name=f"View drop {yard}, 10 hives").count() == 0
    prairie = season.keepers["prairie"]
    expect_error(prairie.get(f"/api/drops/{drop['id']}"), 404, "not_found")
    assert yard not in json.dumps(season.order(prairie))


def test_pacific_delivery_date(app_url: str) -> None:
    start, end, deadline = MW_SEASON
    season = Season(app_url, [("Block 1", 40, [("coulee", 10), ("coulee", 10), ("prairie", 10), ("ridge", 10)])], start=start, end=end, deadline=deadline, rule="2026").open().commit()
    block = season.block_ids["Block 1"]
    late_evening, utc_same_day, next_day = "2026-02-09T23:30:00-08:00", "2026-02-10T07:30:00Z", "2026-02-10T08:00:00Z"
    for drop, moment in zip(season.drops[:2], (late_evening, utc_same_day)):
        stored = expect_json(season.keepers[drop["keeper"]].post(f"/api/drops/{drop['id']}/deliver", {"block_id": block, "delivered_at": moment}), 200)
        assert stored["delivered_on"] == deadline and stored["status"] == "delivered"
    late = season.drops[2]
    prairie = season.keepers["prairie"]
    body = expect_error(prairie.post(f"/api/drops/{late['id']}/deliver", {"block_id": block, "delivered_at": next_day}), 422, "validation_failed")
    assert body["fields"]["delivered_at"] == f"Delivered after the delivery deadline ({human_date(date.fromisoformat(deadline))})"
    body = expect_error(prairie.post(f"/api/drops/{late['id']}/deliver", {"block_id": block, "delivered_at": "yesterday"}), 422, "validation_failed")
    assert body["fields"]["delivered_at"] == "Use a date and time"
    assert expect_json(prairie.get(f"/api/drops/{late['id']}"), 200)["status"] == "committed"

    future = Season(app_url, [("Block 1", 10, [("ridge", 10)])], start="2099-03-01", end="2099-03-20", deadline="2099-02-28").open().commit()
    drop = future.drops[0]
    body = expect_error(future.keepers["ridge"].post(f"/api/drops/{drop['id']}/deliver", {"block_id": future.block_ids["Block 1"], "delivered_at": f"{FUTURE_DATE}T00:00:00Z"}), 422, "validation_failed")
    assert body["fields"]["delivered_at"] == "Delivery time can't be in the future"


def test_block_room(app_url: str) -> None:
    season = Season(app_url, [("Block 1", 30, [("coulee", 20), ("prairie", 30)]), ("Block 2", 20, [])]).open().commit()
    small, large = season.drops
    coulee, prairie = season.keepers["coulee"], season.keepers["prairie"]
    expect_json(coulee.post(f"/api/drops/{small['id']}/deliver", {"block_id": season.block_ids["Block 1"], "delivered_at": PAST_DELIVERY}), 200)
    body = expect_error(prairie.post(f"/api/drops/{large['id']}/deliver", {"block_id": season.block_ids["Block 1"], "delivered_at": PAST_DELIVERY}), 422, "validation_failed")
    assert body["fields"]["block_id"] == f"Block 1 has room for {30 - small['hives']} more hives"
    other = Season(app_url, [("Block 7", 10, [])])
    body = expect_error(prairie.post(f"/api/drops/{large['id']}/deliver", {"block_id": other.block_ids["Block 7"], "delivered_at": PAST_DELIVERY}), 422, "validation_failed")
    assert body["fields"]["block_id"] == "Choose a block on this order"
    assert expect_json(prairie.get(f"/api/drops/{large['id']}"), 200)["status"] == "committed"
    blocks = {b["name"]: b for b in season.order()["blocks"]}
    assert blocks["Block 1"]["hives_delivered"] == small["hives"] and blocks["Block 2"]["hives_delivered"] == 0


def test_own_drops_only(app_url: str) -> None:
    season = Season(app_url, [("Block 1", 20, [("coulee", 10)])]).open().commit()
    drop = season.drops[0]
    prairie = season.keepers["prairie"]
    expect_error(prairie.get(f"/api/drops/{drop['id']}"), 404, "not_found")
    expect_error(prairie.post(f"/api/drops/{drop['id']}/deliver", {"block_id": season.block_ids["Block 1"], "delivered_at": PAST_DELIVERY}), 404, "not_found")
    expect_error(prairie.post(f"/api/drops/{drop['id']}/accept"), 404, "not_found")
    expect_error(prairie.post(f"/api/drops/{drop['id']}/dispute", {"reason": "Not my truckload at all."}), 404, "not_found")
    expect_error(prairie.get(f"/api/drops/{UNKNOWN_ID}"), 404, "not_found")
    assert drop["id"] not in {d["id"] for d in expect_json(prairie.get("/api/drops"), 200)}
    mine = expect_json(season.keepers["coulee"].get(f"/api/drops/{drop['id']}"), 200)
    assert mine["status"] == "committed" and set(mine) == DROP_KEYS
    broker_view = expect_json(season.broker.get(f"/api/drops/{drop['id']}"), 200)
    assert set(broker_view) == DROP_KEYS | {"beekeeper"}
    assert broker_view["beekeeper"] == {"id": BEEKEEPERS["coulee"][0], "name": BEEKEEPERS["coulee"][2]}


def open_log_drop(page: Page, yard: str, hives: int) -> Locator:
    row = my_drop_row(page, yard, hives)
    eventually(page, lambda: row.count() == 1, f"My drops row for {yard}")
    click(row.get_by_role("button", name="Log drop"))
    dialog = page.get_by_role("dialog", name="Log drop")
    eventually(page, dialog.is_visible, "Log drop dialog")
    return dialog


def pick_if_enabled(page: Page, combobox: Locator, label: str) -> bool:
    options = combobox.evaluate("""el => el.tagName === 'SELECT'
      ? Array.from(el.options).filter(o => !o.disabled && !(o.parentElement && o.parentElement.disabled)).map(o => (o.label || o.text || '').trim())
      : null""")
    if options is not None:
        match = next((option for option in options if label in option), None)
        if match:
            select(combobox, match)
        return match is not None
    click(combobox)
    option = page.get_by_role("option", name=re.compile(re.escape(label))).first
    if option.count() and option.is_enabled() and option.get_attribute("aria-disabled") != "true":
        click(option)
        return True
    click(combobox)
    return False


def test_wf_drop_delivery_happy(browser: Browser, app_url: str) -> None:
    start, end, deadline = LATE_SEASON
    season = Season(app_url, [("Block 1", 20, [("coulee", 20)])], start=start, end=end, deadline=deadline, rule="2026").open().commit()
    drop = season.drops[0]
    at = datetime(2026, 10, 1, 23, 30, tzinfo=PACIFIC)
    with zoned_page(browser, f"{app_url}/", "Asia/Tokyo", at) as page:
        sign_in_ui(page, app_url, BEEKEEPERS["coulee"][1])
        row = my_drop_row(page, drop["yard"], drop["hives"])
        eventually(page, lambda: row.count() == 1, "drop row")
        click(row.get_by_role("button", name="Log drop"))
        dialog = page.get_by_role("dialog", name="Log drop")
        eventually(page, dialog.is_visible, "Log drop dialog")
        assert dialog.get_by_role("textbox", name="Delivery date").input_value() in (deadline, human_date(date.fromisoformat(deadline)))
        choose(page, dialog.get_by_role("combobox", name="Block"), "Block 1")
        click(dialog.get_by_role("button", name="Log drop", exact=True))
        announced(page, f"Drop logged: {drop['hives']} hives in Block 1, delivered {human_date(date.fromisoformat(deadline))}.")
        eventually(page, lambda: "Delivered" in row.inner_text(), "row shows Delivered")
        choose_orchard(page, season.name)
        eventually(page, lambda: has_number(ledger_row(page, "My delivered").inner_text(), drop["hives"]), "My delivered row")
    stored = expect_json(season.keepers["coulee"].get(f"/api/drops/{drop['id']}"), 200)
    assert stored["status"] == "delivered" and stored["delivered_on"] == deadline and stored["block"]["id"] == season.block_ids["Block 1"]
    assert {b["name"]: b["hives_delivered"] for b in season.order()["blocks"]}["Block 1"] == drop["hives"]


def test_wf_drop_delivery_isolation(browser: Browser, app_url: str) -> None:
    season = Season(app_url, [("Block 1", 20, [("coulee", 10)])]).open().commit()
    drop = season.drops[0]
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BEEKEEPERS["prairie"][1])
        page.goto(f"{app_url}/desk/drops/{drop['id']}")
        shown(page, "That record isn't available to you.")
        assert drop["yard"] not in page_text(page)
        assert page.get_by_role("button", name="Log drop").count() == 0
    expect_error(season.keepers["prairie"].post(f"/api/drops/{drop['id']}/deliver", {"block_id": season.block_ids["Block 1"], "delivered_at": PAST_DELIVERY}), 404, "not_found")
    assert expect_json(season.keepers["coulee"].get(f"/api/drops/{drop['id']}"), 200)["status"] == "committed"


def test_wf_drop_delivery_room(browser: Browser, app_url: str) -> None:
    season = Season(app_url, [("Block 1", 20, [("coulee", 20)]), ("Block 2", 20, [("prairie", 20)])]).open().commit().deliver(skip={1})
    drop = season.drops[1]
    at = datetime(2026, 10, 1, 9, 0, tzinfo=PACIFIC)
    with zoned_page(browser, f"{app_url}/", "America/New_York", at) as page:
        sign_in_ui(page, app_url, BEEKEEPERS["prairie"][1])
        dialog = open_log_drop(page, drop["yard"], drop["hives"])
        message = "Block 1 has room for 0 more hives"
        if pick_if_enabled(page, dialog.get_by_role("combobox", name="Block"), "Block 1"):
            click(dialog.get_by_role("button", name="Log drop", exact=True))
            eventually(page, dialog.get_by_role("heading", name="There is a problem").is_visible, "summary")
            assert dialog.get_by_role("link", name=message).is_visible()
        else:
            refused = season.keepers["prairie"].post(f"/api/drops/{drop['id']}/deliver",
                                                     {"block_id": season.block_ids["Block 1"], "delivered_at": at.isoformat()})
            assert expect_error(refused, 422, "validation_failed")["fields"].get("block_id") == message, refused.text
        assert expect_json(season.keepers["prairie"].get(f"/api/drops/{drop['id']}"), 200)["status"] == "committed"
        choose(page, dialog.get_by_role("combobox", name="Block"), "Block 2")
        click(dialog.get_by_role("button", name="Log drop", exact=True))
        announced(page, f"Drop logged: {drop['hives']} hives in Block 2, delivered {human_date(at.date())}.")
    stored = expect_json(season.keepers["prairie"].get(f"/api/drops/{drop['id']}"), 200)
    assert stored["status"] == "delivered" and stored["block"]["name"] == "Block 2"


def test_mark_placed(app_url: str) -> None:
    season = Season(app_url, [("Block 1", 20, [("coulee", 10)])]).open().commit()
    expect_error(season.broker.post(f"/api/orders/{season.order_id}/place"), 409, "invalid_transition")
    expect_json(season.keepers["prairie"].post(f"/api/orders/{season.order_id}/drops", {"yard_name": fresh("Yard"), "hives": 10}), 201)
    season.drops.append({"id": season.order(season.keepers["prairie"])["my_drops"][0]["id"], "keeper": "prairie", "hives": 10, "block": "Block 1", "yard": "", "status": "committed"})
    season.deliver(skip={1})
    expect_error(season.broker.post(f"/api/orders/{season.order_id}/place"), 409, "drops_not_delivered")
    assert season.order()["status"] == "filled"
    season.deliver()
    expect_error(season.keepers["coulee"].post(f"/api/orders/{season.order_id}/place"), 403, "forbidden")
    assert expect_json(season.broker.post(f"/api/orders/{season.order_id}/place"), 200)["status"] == "placed"
    expect_error(season.broker.post(f"/api/orders/{season.order_id}/place"), 409, "invalid_transition")


def test_placement_email(app_url: str, mail: Any) -> None:
    season = Season(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)]), ("Block 2", 10, [("ridge", 10)])]).open().commit()
    season.deliver(times={0: "2026-09-20T10:00:00-07:00", 1: "2026-10-01T23:30:00-07:00"})
    subject = f"Hives placed: {season.name} · {season.ref}"
    season.place()
    found = await_mail(mail, with_subject(subject), 2)
    assert len(found) == 1, [m.get("Subject") for m in found]
    message = found[0]
    assert to_address(message, GROWERS["harlan"][1])
    assert mail_from_address() in addresses(message.get("From"))
    body = flat(mail_text(message))
    assert f"Block 1: 20 hives, delivered {human_date(date(2026, 10, 1))}" in body
    assert f"Block 2: 10 hives, delivered {human_date(date(2026, 10, 1))}" in body
    assert "$" not in body
    assert not any(name in body for _, _, name in BEEKEEPERS.values())


def test_grower_placement_fields(app_url: str, mail: Any) -> None:
    season = Season(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)])]).open().commit().deliver().place()
    season.send_link(mail)
    expect_json(season.sample("Block 1", 9.0, "C1", season.drop_in("Block 1", "coulee")), 201)
    order = season.order(season.grower)
    assert set(order) == GROWER_ORDER_KEYS
    block = order["blocks"][0]
    assert set(block) == GROWER_BLOCK_KEYS
    assert all(set(p) == GROWER_PLACEMENT_KEYS for p in block["placements"])
    placements = {p["yard_name"]: p for p in block["placements"]}
    coulee, prairie = season.drop_in("Block 1", "coulee"), season.drop_in("Block 1", "prairie")
    assert placements[coulee["yard"]]["hives"] == coulee["hives"] and placements[coulee["yard"]]["delivered_on"] == PAST_DELIVERY[:10]
    assert Decimal(str(placements[coulee["yard"]]["average_frames"])) == mean_frames([9.0])
    assert placements[prairie["yard"]]["average_frames"] is None
    dumped = json.dumps(order)
    assert not any(uid in dumped or name in dumped for uid, _, name in BEEKEEPERS.values())
    listed = next(o for o in expect_json(season.grower.get("/api/orders"), 200) if o["id"] == season.order_id)
    assert set(listed) == GROWER_ORDER_KEYS - LIST_ONLY_DROPPED
    broker = season.order()
    assert set(broker) == BROKER_ORDER_KEYS
    assert all(set(p) == BROKER_PLACEMENT_KEYS for p in broker["blocks"][0]["placements"])


def test_wf_placement_happy(browser: Browser, app_url: str, mail: Any) -> None:
    season = Season(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)]), ("Block 2", 10, [("ridge", 10)])]).open().commit()
    season.deliver(times={0: "2026-09-20T10:00:00-07:00", 1: "2026-10-01T23:30:00-07:00"})
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BROKER_EMAIL)
        choose_orchard(page, season.name)
        click(page.get_by_role("button", name="Mark placed"))
        announced(page, f"{season.ref} placed. The grower's placement confirmation is on its way.")
        shown(page, "Order status: Placed")
    assert season.order()["status"] == "placed"
    found = await_mail(mail, with_subject(f"Hives placed: {season.name} · {season.ref}"), 2)
    assert len(found) == 1
    assert f"Block 1: 20 hives, delivered {human_date(date(2026, 10, 1))}" in flat(mail_text(found[0]))
    grower = season.order(season.grower)
    assert set(grower) == GROWER_ORDER_KEYS
    assert not any(name in json.dumps(grower) for _, _, name in BEEKEEPERS.values())
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, GROWERS["harlan"][1])
        choose_orchard(page, season.name)
        click(block_button(page, "Block 1"))
        table = page.get_by_role("table", name=f"Placements, {season.drops[0]['block']}")
        eventually(page, table.is_visible, "placements table")
        headers = {flat(h).casefold() for h in table.get_by_role("columnheader").all_inner_texts()}
        assert headers == {h.casefold() for h in ("Yard", "Hives", "Delivered", "Strength")}
        assert not any(name in page_text(page) for _, _, name in BEEKEEPERS.values())


def test_wf_placement_refused(browser: Browser, app_url: str, mail: Any) -> None:
    season = Season(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)])]).open().commit().deliver(skip={1})
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BROKER_EMAIL)
        choose_orchard(page, season.name)
        click(page.get_by_role("button", name="Mark placed"))
        problem(page, f"Every drop on {season.ref} must be delivered first.")
        shown(page, "Order status: Filled")
    assert season.order()["status"] == "filled"
    assert await_mail(mail, with_subject(f"Hives placed: {season.name} · {season.ref}")) == []


def placed(app_url: str, blocks: list[tuple[str, int, list[tuple[str, int]]]] | None = None, grower: str = "harlan") -> Season:
    return Season(app_url, blocks or [("Block 1", 10, [("coulee", 10)])], grower=grower).open().commit().deliver().place()


def test_inspection_link_scope(app_url: str, mail: Any) -> None:
    season = placed(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)]), ("Block 2", 10, [("ridge", 10)])])
    expect_error(season.keepers["coulee"].post(f"/api/orders/{season.order_id}/inspection-links", {"inspector_email": "a@example.com"}), 403, "forbidden")
    body = expect_error(season.broker.post(f"/api/orders/{season.order_id}/inspection-links", {"inspector_email": "not-an-email"}), 422, "validation_failed")
    assert body["fields"]["inspector_email"] == "Enter an email address like name@example.com"
    token = season.send_link(mail)
    assert set(season.link) == LINK_KEYS and season.link["status"] == "issued" and season.link["inspector_email"] == season.inspector_email
    assert token not in json.dumps(season.link) and token not in json.dumps(season.order())
    message = await_mail(mail, lambda m: to_address(m, season.inspector_email))[0]
    assert flat(str(message.get("Subject"))) == f"Inspection sheet: {season.name} · {season.ref}"
    body_text = flat(mail_text(message))
    assert f"/inspect/{token}" in body_text
    assert f"This link opens only this orchard's inspection sheet. It stops working when you sign the report or at {human_datetime(season.link['expires_at'])} Pacific." in body_text
    sheet = season.sheet()
    assert sheet["order"]["ref"] == season.ref
    assert sheet["orchard"]["name"] == season.name and sheet["orchard"]["county"] == COUNTY
    blocks = {b["name"]: b for b in sheet["blocks"]}
    assert blocks["Block 1"]["samples_required"] == math.ceil(20 / SAMPLES_PER_TEN)
    assert {y["yard_name"] for y in blocks["Block 1"]["yards"]} == {d["yard"] for d in season.drops if d["block"] == "Block 1"}
    assert season.order()["inspection_link"]["status"] == "used"
    for cookies, headers in (({"bloom_session": token}, {}), ({}, {"Authorization": f"Bearer {token}"})):
        with httpx.Client(base_url=app_url, cookies=cookies, headers=headers, timeout=HTTP_TIMEOUT_S) as other:
            expect_error(other.get(f"/api/orders/{season.order_id}"), 401, "unauthenticated")
    assert httpx.get(f"{app_url}/files/{token}", timeout=HTTP_TIMEOUT_S).status_code == 404
    foreign = placed(app_url)
    response = season.inspector.post(f"/api/inspect/{token}/samples", {"block_id": foreign.block_ids["Block 1"], "drop_id": foreign.drops[0]["id"], "colony_label": "C1", "frames": 9.0})
    expect_error(response, 404, "not_found")
    open_order = Season(app_url, [("Block 1", 10, [])]).open()
    expect_error(open_order.broker.post(f"/api/orders/{open_order.order_id}/inspection-links", {"inspector_email": "a@example.com"}), 409, "invalid_transition")


def test_link_expiry_and_replacement(app_url: str, mail: Any, short_ttl_app: str) -> None:
    season = placed(app_url)
    old = season.send_link(mail)
    season.sheet(old)
    new = season.send_link(mail)
    expect_error(season.inspector.get(f"/api/inspect/{old}"), 410, "link_expired")
    expect_error(season.inspector.post(f"/api/inspect/{old}/samples", {"block_id": season.block_ids["Block 1"], "drop_id": season.drops[0]["id"], "colony_label": "C1", "frames": 9.0}), 410, "link_expired")
    assert season.sheet(new)["order"]["ref"] == season.ref
    season.inspect({"Block 1": [9.0]}).sign()
    expect_error(season.inspector.get(f"/api/inspect/{new}"), 410, "link_signed")
    expect_error(season.inspector.post(f"/api/inspect/{new}/samples", {"block_id": season.block_ids["Block 1"], "drop_id": season.drops[0]["id"], "colony_label": "C2", "frames": 9.0}), 410, "link_signed")
    expect_error(season.inspector.get(f"/api/inspect/{uuid.uuid4().hex}"), 404, "not_found")

    timed = placed(app_url)
    copy_broker = Api.user(short_ttl_app, BROKER_EMAIL)
    email = f"inspector-{uuid.uuid4().hex[:10]}@example.com"
    link = expect_json(copy_broker.post(f"/api/orders/{timed.order_id}/inspection-links", {"inspector_email": email}), 201)
    token = link_tokens(mail, email, 1)[0]
    viewer = Api(short_ttl_app)
    expect_json(viewer.get(f"/api/inspect/{token}"), 200)
    expired = poll(lambda: viewer.get(f"/api/inspect/{token}").status_code == 410, SHORT_LINK_TTL_S + POLL_SLACK_S)
    assert expired, "link still live after its TTL"
    expect_error(viewer.get(f"/api/inspect/{token}"), 410, "link_expired")
    assert datetime.fromisoformat(link["expires_at"].replace("Z", "+00:00")) <= datetime.now(PACIFIC) + timedelta(seconds=POLL_SLACK_S)


def test_wf_inspection_link_happy(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)]), ("Block 2", 10, [("ridge", 10)])])
    email = f"inspector-{uuid.uuid4().hex[:10]}@example.com"
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BROKER_EMAIL)
        choose_orchard(page, season.name)
        click(page.get_by_role("button", name="Send inspection link"))
        dialog = page.get_by_role("dialog", name="Send inspection link")
        eventually(page, dialog.is_visible, "dialog")
        fill(dialog.get_by_role("textbox", name="Inspector email"), email)
        click(dialog.get_by_role("button", name="Send link"))
        announced(page, f"Inspection link for {season.ref} is on its way to {email}. Any earlier link has stopped working.")
        shown(page, "Issued")
    token = link_tokens(mail, email, 1)[0]
    link = season.order()["inspection_link"]
    with open_app(browser, f"{app_url}/inspect/{token}") as page:
        page.set_viewport_size(PHONE)
        page.reload()
        shown(page, season.name)
        assert urlparse(page.url).path == f"/inspect/{token}"
        content = flat(page_text(page))
        for expected in (COUNTY, season.ref, f"Link expires {human_datetime(link['expires_at'])}", "Block 1", "Block 2", *[d["yard"] for d in season.drops]):
            assert expected in content, expected
        layout(page)
    assert season.order()["inspection_link"]["status"] == "used"


def test_wf_inspection_link_replaced(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    emails = [f"inspector-{uuid.uuid4().hex[:10]}@example.com" for _ in range(2)]
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BROKER_EMAIL)
        choose_orchard(page, season.name)
        for email in emails:
            click(page.get_by_role("button", name="Send inspection link"))
            dialog = page.get_by_role("dialog", name="Send inspection link")
            eventually(page, dialog.is_visible, "dialog")
            fill(dialog.get_by_role("textbox", name="Inspector email"), email)
            click(dialog.get_by_role("button", name="Send link"))
            announced(page, f"Inspection link for {season.ref} is on its way to {email}. Any earlier link has stopped working.")
            eventually(page, lambda: not dialog.is_visible(), "dialog closed")
    old, new = (link_tokens(mail, email, 1)[0] for email in emails)
    with open_app(browser, f"{app_url}/inspect/{old}") as page:
        page.set_viewport_size(PHONE)
        eventually(page, page.get_by_role("heading", name="This inspection link no longer works").is_visible, "dead-link page")
        assert "Ask the broker for a new link." in page_text(page)
        assert page.get_by_role("form", name="Add sample").count() == 0
    expect_error(season.inspector.get(f"/api/inspect/{old}"), 410, "link_expired")
    assert season.sheet(new)["order"]["ref"] == season.ref
    foreign = placed(app_url)
    expect_error(season.inspector.post(f"/api/inspect/{new}/samples", {"block_id": foreign.block_ids["Block 1"], "drop_id": foreign.drops[0]["id"], "colony_label": "C1", "frames": 9.0}), 404, "not_found")
    with httpx.Client(base_url=app_url, cookies={"bloom_session": new}, timeout=HTTP_TIMEOUT_S) as other:
        expect_error(other.get(f"/api/orders/{season.order_id}"), 401, "unauthenticated")
    assert foreign.sheet(foreign.send_link(mail))["order"]["ref"] == foreign.ref


def test_server_block_strength(app_url: str, mail: Any) -> None:
    season = placed(app_url, [("Block 1", 20, [("coulee", 20)]), ("Block 2", 10, [("prairie", 10)])])
    season.send_link(mail)
    prices = RULES["2027"]["prices"]
    start = season.sheet()
    one = next(b for b in start["blocks"] if b["name"] == "Block 1")
    assert one["samples_required"] == math.ceil(20 / SAMPLES_PER_TEN) and one["average_frames"] is None and one["tier"] is None and one["payable_cents"] == 0
    frames: list[float] = []
    for label, value in (("C1", 7.6), ("C2", 7.7), ("C3", 8.9)):
        frames.append(value)
        answer = expect_json(season.sample("Block 1", value, label, average_frames=20.0, tier="bonus", payable_cents=1), 201)
        average = mean_frames(frames)
        assert Decimal(str(answer["block"]["average_frames"])) == average
        assert answer["block"]["tier"] == tier_of(average) and answer["block"]["sample_count"] == len(frames)
        assert answer["block"]["payable_cents"] == 20 * prices[tier_of(average)] == answer["payable_cents"]
    last = answer["sample"]["id"]
    removed = expect_json(season.inspector.delete(f"/api/inspect/{season.token}/samples/{last}"), 200)
    frames.pop()
    assert Decimal(str(removed["block"]["average_frames"])) == mean_frames(frames) and removed["block"]["tier"] == "reduced"
    assert removed["payable_cents"] == 20 * prices["reduced"]
    sheet_one = next(b for b in season.sheet()["blocks"] if b["name"] == "Block 1")
    assert sheet_one["sample_count"] == len(frames) and sheet_one["payable_cents"] == 20 * prices["reduced"]
    cases = [
        ({"frames": 20.1, "label": "C9"}, "frames", "Frames must be from 0.0 to 20.0 with one decimal"),
        ({"frames": 7.65, "label": "C9"}, "frames", "Frames must be from 0.0 to 20.0 with one decimal"),
        ({"frames": 8.0, "label": ""}, "colony_label", "Colony must be 1 to 20 characters"),
        ({"frames": 8.0, "label": "C1"}, "colony_label", "Colony C1 is already sampled in Block 1"),
        ({"frames": 8.0, "label": "C9", "drop": season.drop_in("Block 2")}, "drop_id", "Choose a yard delivered to this block"),
    ]
    for case, field, message in cases:
        body = expect_error(season.sample("Block 1", case["frames"], case["label"], case.get("drop")), 422, "validation_failed")
        assert body["fields"].get(field) == message, body
    assert next(b for b in season.sheet()["blocks"] if b["name"] == "Block 1")["sample_count"] == len(frames)


def upload(season: Season, sample_id: str, payload: bytes, filename: str = "frame.png", declared: str = "image/png") -> httpx.Response:
    return season.inspector.http.post(f"/api/inspect/{season.token}/samples/{sample_id}/photos", files={"photo": (filename, payload, declared)})


def test_photo_safety(app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    sample = expect_json(season.sample("Block 1", 9.0, "C1"), 201)["sample"]
    exact = png(pad_to=PHOTO_LIMIT)
    assert len(exact) == PHOTO_LIMIT
    photo = expect_json(upload(season, sample["id"], exact, TRAVERSAL_NAME), 201)["photo"]
    over = expect_error(upload(season, sample["id"], png(pad_to=PHOTO_LIMIT + 1)), 413, "payload_too_large", fields=True)
    assert over["fields"]["photo"] == "Photos must be 8,000,000 bytes or smaller."
    for payload, name, declared in ((SVG_PAYLOAD, "frame.png", "image/png"), (HTML_PAYLOAD, "frame.jpg", "image/jpeg"), (PDF_PAYLOAD, "frame.webp", "image/webp")):
        refused = expect_error(upload(season, sample["id"], payload, name, declared), 415, "unsupported_media_type", fields=True)
        assert refused["fields"]["photo"] == "Photos must be JPEG, PNG or WebP images."
    small = png()
    expect_json(upload(season, sample["id"], small, "frame.svg", "image/svg+xml"), 201)
    while len(season.sheet()["blocks"][0]["samples"][0]["photos"]) < MAX_PHOTOS:
        expect_json(upload(season, sample["id"], small), 201)
    body = expect_error(upload(season, sample["id"], small), 422, "validation_failed")
    assert body["fields"]["photo"] == "A sample holds at most 4 photos"
    store = bucket()
    prefix = f"inspections/{season.order_id}/photos/"
    keys = store.keys(prefix)
    stored_ids = [p["id"] for p in season.sheet()["blocks"][0]["samples"][0]["photos"]]
    assert len(keys) == MAX_PHOTOS and photo["id"] in stored_ids
    assert sorted(keys) == sorted(f"{prefix}{photo_id}.png" for photo_id in stored_ids)
    assert store.get(f"{prefix}{photo['id']}.png") == exact
    redirect = season.inspector.get(f"/api/inspect/{season.token}/photos/{photo['id']}")
    assert redirect.status_code == 302
    served = httpx.get(urljoin(f"{app_url}/", redirect.headers["location"]), timeout=HTTP_TIMEOUT_S)
    assert served.status_code == 200 and served.content == exact
    assert served.headers["content-type"].startswith("image/png")
    assert served.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in served.headers["content-security-policy"] and "default-src 'none'" in served.headers["content-security-policy"]
    assert served.headers["content-disposition"].startswith("inline") and f"{photo['id']}.png" in served.headers["content-disposition"]
    assert served.headers["cache-control"] == "private, no-store"


def test_file_links(app_url: str, mail: Any, short_ttl_app: str) -> None:
    season = placed(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)])])
    season.send_link(mail)
    sample = expect_json(season.sample("Block 1", 9.0, "C1", season.drop_in("Block 1", "coulee")), 201)["sample"]
    photo = expect_json(upload(season, sample["id"], png()), 201)["photo"]
    mendota = Api.user(app_url, GROWERS["mendota"][1])
    for api in (season.broker, season.grower, season.keepers["coulee"]):
        assert api.get(f"/api/photos/{photo['id']}").status_code == 302
    expect_error(season.keepers["prairie"].get(f"/api/photos/{photo['id']}"), 404, "not_found")
    expect_error(mendota.get(f"/api/photos/{photo['id']}"), 404, "not_found")
    expect_error(Api(app_url).get(f"/api/photos/{photo['id']}"), 401, "unauthenticated")
    expect_error(season.broker.get(f"/api/orders/{season.order_id}/report"), 404, "not_found")
    season.sample("Block 1", 9.0, "C2", season.drop_in("Block 1", "prairie"))
    season.sign()
    expect_error(season.inspector.get(f"/api/inspect/{season.token}/photos/{photo['id']}"), 410, "link_signed")
    for api in (season.broker, season.grower, season.keepers["coulee"]):
        assert api.get(f"/api/orders/{season.order_id}/report").status_code == 302
    expect_error(mendota.get(f"/api/orders/{season.order_id}/report"), 404, "not_found")
    expect_error(season.keepers["ridge"].get(f"/api/orders/{season.order_id}/report"), 404, "not_found")
    copy_broker = Api.user(short_ttl_app, BROKER_EMAIL)
    redirect = copy_broker.get(f"/api/photos/{photo['id']}")
    assert redirect.status_code == 302
    file_url = urljoin(f"{short_ttl_app}/", redirect.headers["location"])
    assert httpx.get(file_url, timeout=HTTP_TIMEOUT_S).status_code == 200
    assert poll(lambda: httpx.get(file_url, timeout=HTTP_TIMEOUT_S).status_code == 410, SHORT_FILE_TTL_S + POLL_SLACK_S)
    expect_error(httpx.get(file_url, timeout=HTTP_TIMEOUT_S), 410, "file_link_expired")


def test_frame_odometer(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    expect_json(season.sample("Block 1", 6.0, "C1"), 201)
    frames = [6.0, 10.2]
    payable = season.block_payable("Block 1", frames)
    with open_app(browser, f"{app_url}/inspect/{season.token}") as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, lambda: meter_text(page, "Block 1") == meter_value(frames[:1]), "starting readout")
        assert TIER_LABELS[tier_of(mean_frames(frames[:1]))] in flat(block_button(page, "Block 1").text_content() or "")
        page.evaluate(MOTION_JS)
        since = clock_now(page)
        form = page.get_by_role("form", name="Add sample")
        choose(page, mid(form.get_by_role("combobox", name="Block")), "Block 1")
        choose(page, mid(form.get_by_role("combobox", name="Yard")), season.drops[0]["yard"])
        fill(mid(form.get_by_role("textbox", name="Colony")), COLONIES[1])
        fill(mid(form.get_by_role("spinbutton", name="Frames of bees")), frames_text(frames[1]))
        sampled = sample_roll(page, "Block 1")
        with page.expect_response(lambda r: r.request.method == "POST" and "/samples" in r.url):
            click(mid(form.get_by_role("button", name="Add sample")))
        answer = clock_now(page)
        last_change_ms = 0
        for step in range(1, (ODOMETER_TOTAL_MS + ODOMETER_SLACK_MS) // ODOMETER_STEP_MS + 1):
            advance(page, ODOMETER_STEP_MS)
            page.evaluate("() => window.__grabMotion()")
            sampled = sample_roll(page, "Block 1")
            if sampled["changed"]:
                last_change_ms = step * ODOMETER_STEP_MS
        eventually(page, lambda: meter_text(page, "Block 1") == meter_value(frames), "meter takes the server value")
        summary = motion_summary(page, "Block 1", since)
        if summary["targets"] >= 2:
            assert None not in summary["ends"], "no looping motion in the readout"
            assert max(summary["ends"]) - answer <= ODOMETER_TOTAL_MS, summary
        else:
            assert sampled["rolling"] >= 2, (summary, sampled)
            assert last_change_ms <= ODOMETER_TOTAL_MS, last_change_ms
        eventually(page, lambda: TIER_LABELS[tier_of(mean_frames(frames))] in flat(block_button(page, "Block 1").text_content() or ""), "tier label swapped")
        eventually(page, lambda: page.get_by_role("button", name=block_label("Block 1", frames)).count() > 0, "block named with new figures")
        announced(page, readout_copy("Block 1", frames, payable), "Strength readout")


def test_reduced_motion_strength(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    yard = season.drops[0]["yard"]
    steps = [("add", "C1", 6.0), ("add", "C2", 10.2), ("add", "C3", 8.4), ("remove", "C3", 8.4), ("remove", "C2", 10.2), ("remove", "C1", 6.0)]
    with open_app(browser, f"{app_url}/inspect/{season.token}", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, page.get_by_role("form", name="Add sample").is_visible, "sheet")
        page.evaluate(MOTION_JS)
        since = clock_now(page)
        frames: list[float] = []
        for action, label, value in steps:
            before = mean_frames(frames) if frames else None
            old_tier = tier_of(before) if before is not None else None
            if action == "add":
                add_sample_ui(page, "Block 1", yard, label, frames_text(value))
                announced(page, f"Sample {label} saved.")
                frames.append(value)
            else:
                click(mid(page.get_by_role("button", name=f"Remove sample {label}")))
                announced(page, f"Sample {label} removed.")
                frames.remove(value)
            after = mean_frames(frames) if frames else None
            new_tier = tier_of(after) if after is not None else None
            old_text = f"{before:.1f}" if before is not None else "no samples"
            if after is None:
                note = f"Block 1: {old_text} → no samples, now Not inspected"
            else:
                word = "still" if new_tier == old_tier else "now"
                note = f"Block 1: {old_text} → {after:.1f} frames, {word} {TIER_LABELS[new_tier]}"
            announced(page, note, "Strength changes", "log")
            announced(page, readout_copy("Block 1", frames, season.block_payable("Block 1", frames)), "Strength readout")
        assert motion_summary(page, "Block 1", since)["targets"] == 0


def test_wf_inspection_sampling_happy(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    yard = season.drops[0]["yard"]
    with open_app(browser, f"{app_url}/inspect/{season.token}") as page:
        page.set_viewport_size(PHONE)
        page.reload()
        eventually(page, page.get_by_role("form", name="Add sample").is_visible, "sheet")
        record_region(page, "status", "Desk updates")
        add_sample_ui(page, "Block 1", yard, COLONIES[0], frames_text(9.0), {"name": "frame.png", "mimeType": "image/png", "buffer": png()})
        heard(page, f"Sample {COLONIES[0]} saved.")
        heard(page, f"Photo added to sample {COLONIES[0]}.")
        announced(page, readout_copy("Block 1", [9.0], season.block_payable("Block 1", [9.0])), "Strength readout")
        add_sample_ui(page, "Block 1", yard, COLONIES[1], frames_text(5.0))
        announced(page, readout_copy("Block 1", [9.0, 5.0], season.block_payable("Block 1", [9.0, 5.0])), "Strength readout")
        click(mid(page.get_by_role("button", name=f"Remove sample {COLONIES[1]}")))
        announced(page, f"Sample {COLONIES[1]} removed.")
        eventually(page, lambda: meter_text(page, "Block 1") == meter_value([9.0]), "readout back to server figure")
    block = season.sheet()["blocks"][0]
    assert [s["colony_label"] for s in block["samples"]] == [COLONIES[0]] and len(block["samples"][0]["photos"]) == 1
    assert block["payable_cents"] == season.block_payable("Block 1", [9.0])
    photo_id = block["samples"][0]["photos"][0]["id"]
    assert f"inspections/{season.order_id}/photos/{photo_id}.png" in bucket().keys(f"inspections/{season.order_id}/photos/")


def test_wf_inspection_sampling_refused(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    block = season.drops[0]["block"]
    colony = COLONIES[0]
    expect_json(season.sample(block, 9.0, colony), 201)
    with open_app(browser, f"{app_url}/inspect/{season.token}") as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, lambda: meter_text(page, block) == meter_value([9.0]), "starting readout")
        add_sample_ui(page, block, season.drops[0]["yard"], colony, frames_text(5.0))
        message = f"Colony {colony} is already sampled in {block}"
        eventually(page, page.get_by_role("heading", name="There is a problem").is_visible, "summary")
        assert page.get_by_role("link", name=message).is_visible()
        for _ in range(ODOMETER_TOTAL_MS // STEP_MS):
            advance(page, STEP_MS)
        assert meter_text(page, block) == meter_value([9.0])
        assert page.get_by_role("button", name=block_label(block, [9.0])).count() > 0
    assert season.sheet()["blocks"][0]["sample_count"] == 1


def test_wf_inspection_sampling_photo(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    prefix = f"inspections/{season.order_id}/photos/"
    with open_app(browser, f"{app_url}/inspect/{season.token}") as page:
        page.set_viewport_size(PHONE)
        page.reload()
        eventually(page, page.get_by_role("form", name="Add sample").is_visible, "sheet")
        record_region(page, "status", "Desk updates")
        add_sample_ui(page, "Block 1", season.drops[0]["yard"], COLONIES[0], frames_text(9.0), {"name": "frame.png", "mimeType": "image/png", "buffer": SVG_PAYLOAD})
        heard(page, f"Sample {COLONIES[0]} saved.")
        problem(page, "Photos must be JPEG, PNG or WebP images.")
        assert bucket().keys(prefix) == []
        assert season.sheet()["blocks"][0]["samples"][0]["photos"] == []
        with page.expect_file_chooser() as chooser:
            click(mid(page.get_by_role("button", name=f"Add photo to {COLONIES[0]}")))
        chooser.value.set_files({"name": "frame.png", "mimeType": "image/png", "buffer": png()})
        announced(page, f"Photo added to sample {COLONIES[0]}.")
    photos = season.sheet()["blocks"][0]["samples"][0]["photos"]
    assert len(photos) == 1 and bucket().keys(prefix) == [f"{prefix}{photos[0]['id']}.png"]


def notice_subject(season: Season) -> str:
    return f"Inspection signed: {season.name} · {season.ref}"


def test_atomic_signing(app_url: str, mail: Any) -> None:
    blocks = [("Block 1", 10, [("coulee", 10)]), ("Block 2", 10, [("prairie", 10)]), ("Block 3", 10, [("ridge", 10)])]
    frames = {"Block 1": [9.0], "Block 2": [10.5], "Block 3": [5.0]}
    season = placed(app_url, blocks, grower="mendota")
    season.send_link(mail)
    season.inspect(frames)
    deposit = season.order()["deposit_cents"]
    payables = {block: season.block_payable(block, values) for block, values in frames.items()}
    balance_before = kb_balance("mendota")
    key = idempotency_key()
    down = Api(killbill_down_url())
    expect_error(down.post(f"/api/inspect/{season.token}/sign", {"inspector_name": INSPECTOR_NAME, "attest": True}, key=key), 503, "billing_unavailable")
    report_prefix = f"inspections/{season.order_id}/report-"
    assert bucket().keys(report_prefix) == []
    assert await_mail(mail, with_subject(notice_subject(season))) == []
    assert season.order()["status"] == "placed"
    assert {expect_json(season.keepers[d["keeper"]].get(f"/api/drops/{d['id']}"), 200)["status"] for d in season.drops} == {"delivered"}
    assert sum(b["sample_count"] for b in season.sheet()["blocks"]) == len(frames)
    assert kb_ref_charges(season) == []
    assert kb_described("mendota", f"Deposit applied · {season.ref}", live_only=True) == []
    assert kb_balance("mendota") == balance_before
    season.sign(key)
    expected = {f"{season.ref} · {block} · {TIER_LABELS[tier_of(mean_frames(values))]} · 10 hives": payables[block]
                for block, values in frames.items() if payables[block]}
    charges = kb_ref_charges(season)
    assert sorted(flat(item["description"]) for _, item in charges) == sorted(expected), charges
    assert all(amount(item) == dollars(expected[flat(item["description"])]) for _, item in charges), charges
    assert len({invoice["invoiceId"] for invoice, _ in charges}) == 1
    credits = kb_described("mendota", f"Deposit applied · {season.ref}", live_only=True)
    assert credits and all(amount(item) == dollars(deposit) for _, item in credits), credits
    assert kb_balance("mendota") == balance_before - dollars(deposit) + dollars(sum(payables.values()))
    order = season.order()
    assert order["status"] == "inspected" and order["inspection_link"]["status"] == "signed"
    assert {expect_json(season.keepers[d["keeper"]].get(f"/api/drops/{d['id']}"), 200)["status"] for d in season.drops} == {"inspected"}
    assert bucket().keys(report_prefix) == [f"{report_prefix}{season.link['id']}.pdf"]
    assert len(await_mail(mail, with_subject(notice_subject(season)), 2)) == 1


def test_idempotent_signing(app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    season.inspect({"Block 1": [9.0]})
    path = f"/api/inspect/{season.token}/sign"
    body = {"inspector_name": INSPECTOR_NAME, "attest": True}
    assert "Idempotency-Key" in expect_error(season.inspector.post(path, body), 422, "validation_failed")["fields"]
    assert "Idempotency-Key" in expect_error(season.inspector.post(path, body, key="k" * (KEY_MAX + 1)), 422, "validation_failed")["fields"]
    key = idempotency_key()
    first = expect_json(season.inspector.post(path, body, key=key), 200)
    assert first["status"] == "signed" and first["payable_cents"] == season.block_payable("Block 1", [9.0])
    assert expect_json(season.inspector.post(path, body, key=key), 200) == first
    expect_error(season.inspector.post(path, {**body, "inspector_name": "Someone Else"}, key=key), 409, "idempotency_key_reused")
    expect_error(season.inspector.post(path, body, key=idempotency_key()), 410, "link_signed")
    assert len(bucket().keys(f"inspections/{season.order_id}/report-")) == 1
    assert len(await_mail(mail, with_subject(notice_subject(season)), 2)) == 1


def test_signed_notice_and_pdf(app_url: str, mail: Any) -> None:
    season = placed(app_url, [("Block 1", 20, [("coulee", 20)]), ("Block 2", 10, [("prairie", 10)])])
    season.send_link(mail)
    frames = {"Block 1": [9.0, 9.0], "Block 2": [10.5]}
    season.inspect(frames)
    assert season.order(season.grower)["report_available"] is False
    season.sign()
    found = await_mail(mail, with_subject(notice_subject(season)), 2)
    assert len(found) == 1 and to_address(found[0], GROWERS["harlan"][1])
    body = flat(mail_text(found[0]))
    totals = {block: season.block_payable(block, values) for block, values in frames.items()}
    for block, values in frames.items():
        average = mean_frames(values)
        assert f"{block}: {average:.1f} frames, {TIER_LABELS[tier_of(average)]}, {money(totals[block])}" in body
    assert f"Payable: {money(sum(totals.values()))}" in body and "The signed report is in Bloom Desk." in body
    rule = RULES["2027"]
    commission, _ = allocate({"bk_coulee": totals["Block 1"], "bk_prairie": totals["Block 2"]}, rule["bps"])
    forbidden = [money(pay_per_hive(p, rule["bps"])) for p in rule["prices"].values() if p] + [money(commission)]
    assert not [f for f in forbidden if f in body]
    assert season.order(season.grower)["report_available"] is True
    redirect = season.grower.get(f"/api/orders/{season.order_id}/report")
    assert redirect.status_code == 302
    served = httpx.get(urljoin(f"{app_url}/", redirect.headers["location"]), timeout=HTTP_TIMEOUT_S)
    assert served.status_code == 200 and served.headers["content-type"].startswith("application/pdf")
    assert served.content == bucket().get(f"inspections/{season.order_id}/report-{season.link['id']}.pdf")


def test_wf_report_signing_happy(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    season.inspect({"Block 1": [9.0]})
    with open_app(browser, f"{app_url}/inspect/{season.token}") as page:
        page.set_viewport_size(PHONE)
        page.reload()
        sign_button = page.get_by_role("button", name="Sign report", exact=True)
        eventually(page, sign_button.is_visible, "Sign report")
        click(sign_button)
        dialog = page.get_by_role("dialog", name="Sign report")
        eventually(page, dialog.is_visible, "Sign report dialog")
        fill(dialog.get_by_role("textbox", name="Full name"), INSPECTOR_NAME)
        check(dialog.get_by_role("checkbox", name="I counted these colonies and these figures are true"))
        click(dialog.get_by_role("button", name="Sign and send"))
        announced(page, "Report signed. The grower's notice is on its way.")
        eventually(page, lambda: "Signed" in page_text(page), "Signed")
        page.reload()
        eventually(page, page.get_by_role("heading", name="This inspection link no longer works").is_visible, "dead link")
        assert f"The report for {season.name} has been signed." in flat(page_text(page))
    expect_error(season.inspector.get(f"/api/inspect/{season.token}"), 410, "link_signed")
    assert season.order()["status"] == "inspected"
    assert bucket().keys(f"inspections/{season.order_id}/report-") == [f"inspections/{season.order_id}/report-{season.link['id']}.pdf"]
    assert len(await_mail(mail, with_subject(notice_subject(season)), 2)) == 1


def test_wf_report_signing_outage(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    season.inspect({"Block 1": [9.0]})
    down = killbill_down_url()
    with open_app(browser, f"{down}/inspect/{season.token}") as page:
        page.set_viewport_size(PHONE)
        page.reload()
        sign_button = page.get_by_role("button", name="Sign report", exact=True)
        eventually(page, sign_button.is_visible, "Sign report")
        click(sign_button)
        dialog = page.get_by_role("dialog", name="Sign report")
        eventually(page, dialog.is_visible, "Sign report dialog")
        fill(dialog.get_by_role("textbox", name="Full name"), INSPECTOR_NAME)
        check(dialog.get_by_role("checkbox", name="I counted these colonies and these figures are true"))
        click(dialog.get_by_role("button", name="Sign and send"))
        problem(page, "Billing is unreachable, so nothing was signed. Your samples are saved; try again in a minute.")
    assert season.order()["status"] == "placed"
    assert bucket().keys(f"inspections/{season.order_id}/report-") == []
    assert await_mail(mail, with_subject(notice_subject(season))) == []
    assert season.sheet()["blocks"][0]["sample_count"] == 1
    season.sign()
    assert season.order()["status"] == "inspected"


def test_drop_review_transitions(app_url: str, mail: Any) -> None:
    season = placed(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)])])
    coulee_drop, prairie_drop = season.drop_in("Block 1", "coulee"), season.drop_in("Block 1", "prairie")
    coulee, prairie, broker = season.keepers["coulee"], season.keepers["prairie"], season.broker
    expect_error(coulee.post(f"/api/drops/{coulee_drop['id']}/accept"), 409, "invalid_transition")
    season.send_link(mail)
    season.inspect({"Block 1": [9.0, 9.0]}).sign()
    assert expect_json(coulee.post(f"/api/drops/{coulee_drop['id']}/accept"), 200)["status"] == "accepted"
    expect_error(coulee.post(f"/api/drops/{coulee_drop['id']}/accept"), 409, "invalid_transition")
    expect_error(coulee.post(f"/api/drops/{coulee_drop['id']}/dispute", {"reason": "Frames were undercounted."}), 409, "invalid_transition")
    expect_error(broker.post(f"/api/drops/{coulee_drop['id']}/resolve", {"note": "Fine."}), 409, "invalid_transition")
    body = expect_error(prairie.post(f"/api/drops/{prairie_drop['id']}/dispute", {"reason": "x" * (REASON_MIN - 1)}), 422, "validation_failed")
    assert body["fields"]["reason"] == "Reason must be 10 to 500 characters"
    reason = "Frames were undercounted in C2."
    disputed = expect_json(prairie.post(f"/api/drops/{prairie_drop['id']}/dispute", {"reason": reason}), 200)
    assert disputed["status"] == "disputed" and disputed["dispute_reason"] == reason
    expect_error(prairie.post(f"/api/drops/{prairie_drop['id']}/accept"), 409, "invalid_transition")
    expect_error(prairie.post(f"/api/drops/{prairie_drop['id']}/resolve", {"note": "Mine."}), 403, "forbidden")
    expect_error(broker.post(f"/api/drops/{prairie_drop['id']}/accept"), 403, "forbidden")
    body = expect_error(broker.post(f"/api/drops/{prairie_drop['id']}/resolve", {"note": ""}), 422, "validation_failed")
    assert body["fields"]["note"] == "Note must be 1 to 500 characters"
    resolved = expect_json(broker.post(f"/api/drops/{prairie_drop['id']}/resolve", {"note": RESOLUTION_NOTE}), 200)
    assert resolved["status"] == "accepted" and resolved["resolution_note"] == RESOLUTION_NOTE
    expect_error(broker.post(f"/api/drops/{prairie_drop['id']}/resolve", {"note": "Again."}), 409, "invalid_transition")


def test_wf_disputes_happy(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url)
    season.send_link(mail)
    sample = expect_json(season.sample("Block 1", 9.0, COLONIES[0]), 201)["sample"]
    expect_json(upload(season, sample["id"], png()), 201)
    season.sign()
    drop = season.drops[0]
    stored = expect_json(season.keepers["coulee"].get(f"/api/drops/{drop['id']}"), 200)
    reason = "The frame count on C1 looks low to us."
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BEEKEEPERS["coulee"][1])
        link = page.get_by_role("link", name=f"View drop {drop['yard']}, {drop['hives']} hives")
        eventually(page, link.is_visible, "drop link")
        click(link)
        eventually(page, lambda: urlparse(page.url).path == f"/desk/drops/{drop['id']}", "drop page")
        photos = page.get_by_role("list", name="Frame photos")
        eventually(page, lambda: photos.get_by_role("link", name=f"Photo, colony {COLONIES[0]}").is_visible(), "photo link")
        content = page_text(page)
        expected_pay = {stored["payout_cents"], stored["hives"] * stored["pay_per_hive_cents"]}
        assert any(money(cents) in content for cents in expected_pay) and "Standard".casefold() in content.casefold()
        click(page.get_by_role("button", name="Dispute inspection"))
        dialog = page.get_by_role("dialog", name="Dispute inspection")
        eventually(page, dialog.is_visible, "dispute dialog")
        fill(dialog.get_by_role("textbox", name="Reason"), reason)
        click(dialog.get_by_role("button", name="Send dispute"))
        announced(page, "Dispute sent to the broker.")
        assert expect_json(season.keepers["coulee"].get(f"/api/drops/{drop['id']}"), 200)["status"] == "disputed"
        with open_app(browser, f"{app_url}/") as desk:
            desk.set_viewport_size(DESKTOP)
            sign_in_ui(desk, app_url, BROKER_EMAIL)
            desk.goto(f"{app_url}/desk/drops/{drop['id']}")
            resolve = desk.get_by_role("button", name="Resolve dispute")
            eventually(desk, resolve.is_visible, "Resolve dispute")
            click(resolve)
            dialog = desk.get_by_role("dialog", name="Resolve dispute")
            eventually(desk, dialog.is_visible, "resolve dialog")
            fill(dialog.get_by_role("textbox", name="Resolution note"), RESOLUTION_NOTE)
            click(dialog.get_by_role("button", name="Resolve", exact=True))
            announced(desk, f"Dispute resolved. {drop['yard']} is accepted.")
            shown_any_case(desk, "Accepted")
        page.reload()
        shown_any_case(page, "Accepted")
    final = expect_json(season.keepers["coulee"].get(f"/api/drops/{drop['id']}"), 200)
    assert final["status"] == "accepted" and final["dispute_reason"] == reason and final["resolution_note"] == RESOLUTION_NOTE


def test_wf_disputes_scope(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url, [("Block 1", 20, [("coulee", 10), ("prairie", 10)])])
    season.send_link(mail)
    season.inspect({"Block 1": [9.0, 9.0]}).sign()
    drop = season.drop_in("Block 1", "coulee")
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BEEKEEPERS["prairie"][1])
        page.goto(f"{app_url}/desk/drops/{drop['id']}")
        shown(page, "That record isn't available to you.")
        assert page.get_by_role("button", name="Accept inspection").count() == 0
        assert page.get_by_role("button", name="Dispute inspection").count() == 0
    expect_error(season.keepers["prairie"].post(f"/api/drops/{drop['id']}/accept"), 404, "not_found")
    assert expect_json(season.keepers["coulee"].get(f"/api/drops/{drop['id']}"), 200)["status"] == "inspected"
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BEEKEEPERS["coulee"][1])
        page.goto(f"{app_url}/desk/drops/{drop['id']}")
        accept = page.get_by_role("button", name="Accept inspection")
        eventually(page, accept.is_visible, "Accept inspection")
        click(accept)
        announced(page, f"Inspection accepted for {drop['yard']}.")
    owned = expect_json(season.keepers["coulee"].get(f"/api/drops/{drop['id']}"), 200)
    assert owned["status"] == "accepted" and set(owned) == DROP_KEYS
    assert expect_json(season.keepers["prairie"].get(f"/api/drops/{season.drop_in('Block 1', 'prairie')['id']}"), 200)["status"] == "inspected"


EXAMPLE_BLOCKS = [("Block S", 40, [("ridge", 40)]), ("Block B", 50, [("ridge", 10), ("prairie", 40)])]
EXAMPLE_FRAMES = {"Block S": [9.0] * 4, "Block B": [10.5] * 5}


def example(app_url: str, mail: Any) -> Season:
    season = Season(app_url, EXAMPLE_BLOCKS).open().commit().deliver().place()
    season.send_link(mail)
    return season.inspect(EXAMPLE_FRAMES).sign()


def test_settlement_split(app_url: str, mail: Any) -> None:
    season = example(app_url, mail)
    preview = expect_json(season.broker.get(f"/api/orders/{season.order_id}/settlement"), 200)
    assert preview["status"] == "preview" and preview["payment_received_on"] is None
    assert preview["rule_set"]["id"] == RULES["2027"]["id"] and preview["commission_bps"] == RULES["2027"]["bps"]
    assert money(preview["payable_cents"]) == "$20,577.50"
    assert money(preview["commission_cents"]) == "$2,417.86"
    shares = {s["beekeeper"]["id"]: s for s in preview["shares"]}
    assert [s["beekeeper"]["id"] for s in preview["shares"]] == sorted(shares)
    assert money(shares["bk_ridge"]["gross_cents"]) == "$10,979.50" and money(shares["bk_ridge"]["payout_cents"]) == "$9,689.41"
    assert money(shares["bk_prairie"]["gross_cents"]) == "$9,598.00" and money(shares["bk_prairie"]["payout_cents"]) == "$8,470.23"
    assert shares["bk_ridge"]["hives"] == 50 and shares["bk_prairie"]["hives"] == 40
    commission, expected = allocate({k: v["gross_cents"] for k, v in shares.items()}, RULES["2027"]["bps"])
    assert commission == preview["commission_cents"] and expected == {k: v["payout_cents"] for k, v in shares.items()}
    assert preview["commission_cents"] + sum(s["payout_cents"] for s in preview["shares"]) == preview["payable_cents"]
    ridge_drops = [expect_json(season.keepers["ridge"].get(f"/api/drops/{d['id']}"), 200) for d in season.drops if d["keeper"] == "ridge"]
    assert sum(d["payout_cents"] for d in ridge_drops) == shares["bk_ridge"]["payout_cents"]
    season.accept()
    settled = expect_json(season.broker.post(f"/api/orders/{season.order_id}/settle", {"payment_received_on": PAYMENT_DATE}, key=idempotency_key()), 200)
    assert settled["settlement"]["shares"] == preview["shares"] and settled["settlement"]["payment_received_on"] == PAYMENT_DATE


def small_signed(app_url: str, mail: Any, grower: str = "harlan") -> Season:
    season = placed(app_url, grower=grower)
    season.send_link(mail)
    return season.inspect({"Block 1": [9.0]}).sign()


def test_settlement_once(app_url: str, mail: Any, killbill: Any) -> None:
    season = small_signed(app_url, mail, "mendota")
    path = f"/api/orders/{season.order_id}/settle"
    expect_error(season.broker.post(path, {"payment_received_on": PAYMENT_DATE}, key=idempotency_key()), 409, "drops_not_accepted")
    season.accept()
    assert "Idempotency-Key" in expect_error(season.broker.post(path, {"payment_received_on": PAYMENT_DATE}), 422, "validation_failed")["fields"]
    assert expect_error(season.broker.post(path, {"payment_received_on": FUTURE_DATE}, key=idempotency_key()), 422, "validation_failed")["fields"]["payment_received_on"] == "Payment date can't be after today (Pacific)"
    assert expect_error(season.broker.post(path, {"payment_received_on": "15/10/2026"}, key=idempotency_key()), 422, "validation_failed")["fields"]["payment_received_on"] == "Use a date like 2027-02-05"
    assert settle_payments(killbill, season.order_id, "mendota") == []
    balance_before = kb_balance("mendota")
    key = idempotency_key()
    first = expect_json(season.broker.post(path, {"payment_received_on": PAYMENT_DATE}, key=key), 200)
    assert first["status"] == "settled" and first["settlement"]["status"] == "settled"
    assert expect_json(season.broker.post(path, {"payment_received_on": PAYMENT_DATE}, key=key), 200) == first
    expect_error(season.broker.post(path, {"payment_received_on": "2026-10-14"}, key=key), 409, "idempotency_key_reused")
    expect_error(season.broker.post(path, {"payment_received_on": PAYMENT_DATE}, key=idempotency_key()), 409, "already_settled")
    order = season.order()
    assert order["status"] == "settled" and order["settlement_status"] == "settled"
    payments = settle_payments(killbill, season.order_id, "mendota")
    assert len(payments) == 1 and killbill.payment_by_key(f"settle-{season.order_id}")
    assert Decimal(order["payable_cents"]) / 100 in numbers_in(payments[0])
    assert kb_balance("mendota") == balance_before - dollars(order["payable_cents"])


def test_settlement_queued(app_url: str, mail: Any, killbill: Any) -> None:
    season = small_signed(app_url, mail).accept()
    down = Api.user(killbill_down_url(), BROKER_EMAIL)
    key = idempotency_key()
    queued = expect_json(down.post(f"/api/orders/{season.order_id}/settle", {"payment_received_on": PAYMENT_DATE}, key=key), 202)
    assert queued["status"] == "queued" and queued["settlement"]["status"] == "queued"
    assert season.order()["status"] in ("inspected", "settled")
    done = poll(lambda: season.order()["settlement_status"] == "settled", QUEUE_COMPLETE_S + POLL_SLACK_S)
    assert done, "queued settlement did not complete"
    assert season.order()["status"] == "settled"
    expect_error(season.broker.post(f"/api/orders/{season.order_id}/settle", {"payment_received_on": PAYMENT_DATE}, key=idempotency_key()), 409, "already_settled")
    assert len(settle_payments(killbill, season.order_id)) == 1


def test_wf_settlement_happy(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    season = example(app_url, mail).accept()
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, BROKER_EMAIL)
        choose_orchard(page, season.name)
        click(page.get_by_role("button", name="Settle orchard"))
        dialog = page.get_by_role("dialog", name="Settle orchard")
        eventually(page, dialog.is_visible, "Settle orchard dialog")
        split = flat(dialog.get_by_role("table", name="Settlement split").inner_text())
        for amount in ("$2,417.86", "$9,689.41", "$8,470.23"):
            assert amount in split, split
        fill(dialog.get_by_role("textbox", name="Payment received"), PAYMENT_DATE)
        click(dialog.get_by_role("button", name="Settle", exact=True))
        announced(page, f"{season.name} settled.")
        shown(page, "Order status: Settled")
    settlement = expect_json(season.broker.get(f"/api/orders/{season.order_id}/settlement"), 200)
    assert settlement["status"] == "settled" and settlement["payment_received_on"] == PAYMENT_DATE
    assert len(settle_payments(killbill, season.order_id)) == 1


def test_wf_settlement_queued(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    season = small_signed(app_url, mail).accept()
    down = killbill_down_url()
    with open_app(browser, f"{down}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, down, BROKER_EMAIL)
        choose_orchard(page, season.name)
        click(page.get_by_role("button", name="Settle orchard"))
        dialog = page.get_by_role("dialog", name="Settle orchard")
        eventually(page, dialog.is_visible, "Settle orchard dialog")
        fill(dialog.get_by_role("textbox", name="Payment received"), PAYMENT_DATE)
        click(dialog.get_by_role("button", name="Settle", exact=True))
        announced(page, "Settlement queued: billing is unreachable. It will finish on its own when billing returns.")
        shown(page, "Order status: Settled", QUEUE_COMPLETE_S + LIVE_REFRESH_S + POLL_SLACK_S)
    assert season.order()["settlement_status"] == "settled"
    assert len(settle_payments(killbill, season.order_id)) == 1


def test_tier_labels_and_legend(browser: Browser, app_url: str, mail: Any) -> None:
    blocks = [(f"Block {i}", 10, [("coulee", 10)]) for i in range(1, 6)]
    season = Season(app_url, blocks).open().commit().deliver().place()
    season.send_link(mail)
    frames = {"Block 1": 5.0, "Block 2": 7.0, "Block 3": 9.0, "Block 4": 10.5}
    for block, value in frames.items():
        expect_json(season.sample(block, value, "C1"), 201)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, GROWERS["harlan"][1])
        choose_orchard(page, season.name)
        for block, value in frames.items():
            label = TIER_LABELS[tier_of(Decimal(str(value)))]
            button = page.get_by_role("button", name=f"{block}, {label}, {frames_text(value)} frames")
            eventually(page, button.is_visible, f"{block} labelled {label}")
            assert label in flat(button.text_content() or "")
        unsampled = page.get_by_role("button", name=block_label(blocks[-1][0], []))
        eventually(page, unsampled.is_visible, "unsampled block")
        assert "Not inspected" in flat(unsampled.text_content() or "")
        items = [flat(t) for t in page.get_by_role("list", name="Tier legend").get_by_role("listitem").all_inner_texts()]
        for label in TIER_LABELS.values():
            assert any(label in item for item in items), (label, items)


def test_wf_grower_review_happy(browser: Browser, app_url: str, mail: Any) -> None:
    season = placed(app_url, [("Block 1", 10, [("coulee", 10)]), ("Block 2", 10, [("prairie", 10)])])
    season.send_link(mail)
    season.inspect({"Block 1": [9.0], "Block 2": [10.5]}).sign()
    payable = season.block_payable("Block 1", [9.0]) + season.block_payable("Block 2", [10.5])
    rule = RULES["2027"]
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, GROWERS["harlan"][1])
        choose_orchard(page, season.name)
        for name in (block_label("Block 1", [9.0]), block_label("Block 2", [10.5])):
            eventually(page, page.get_by_role("button", name=name).is_visible, name)
        items = flat(" ".join(page.get_by_role("list", name="Tier legend").get_by_role("listitem").all_inner_texts()))
        assert "Standard" in items and "Bonus" in items
        click(page.get_by_role("button", name=block_label("Block 1", [9.0])))
        table = page.get_by_role("table", name=f"Placements, {season.drops[0]['block']}")
        eventually(page, table.is_visible, "placements")
        assert {flat(h).casefold() for h in table.get_by_role("columnheader").all_inner_texts()} == {h.casefold() for h in ("Yard", "Hives", "Delivered", "Strength")}
        assert season.drops[0]["yard"] in table.inner_text()
        rows = {flat(h) for h in page.get_by_role("table", name="Order ledger").get_by_role("rowheader").all_inner_texts()}
        assert rows == {"Ordered", "Delivered", "Deposit", "Payable"}
        payable_named = page.get_by_role("table", name="Order ledger").get_by_role("row", name=re.compile(rf"^Payable\b.*{re.escape(money(payable))}"))
        eventually(page, lambda: money(payable) in ledger_row(page, "Payable").inner_text() or payable_named.count() > 0
                   or money(payable) in flat(clipped_text(ledger_row(page, "Payable"))), "Payable value in the ledger")
        content = page_text(page)
        commission, _ = allocate({"bk_coulee": season.block_payable("Block 1", [9.0]), "bk_prairie": season.block_payable("Block 2", [10.5])}, rule["bps"])
        for hidden in ["Commission", money(commission)] + [money(pay_per_hive(p, rule["bps"])) for p in rule["prices"].values() if p] + [n for _, _, n in BEEKEEPERS.values()]:
            assert hidden not in content, hidden
        report = page.get_by_role("link", name="Inspection report (PDF)")
        eventually(page, report.is_visible, "report link")
        fetched = page.request.get(urljoin(page.url, report.get_attribute("href")))
        assert fetched.status == 200 and fetched.headers["content-type"].startswith("application/pdf")


def test_wf_grower_review_other_grower(browser: Browser, app_url: str, mail: Any) -> None:
    season = small_signed(app_url, mail)
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in_ui(page, app_url, GROWERS["mendota"][1])
        rail = page.get_by_role("navigation", name="Orchards")
        eventually(page, lambda: rail.get_by_role("link", name=MENDOTA_ORCHARD).is_visible(), "own rail")
        assert rail.get_by_role("link", name=season.name).count() == 0
        choose_orchard(page, MENDOTA_ORCHARD)
        for block in MENDOTA_BLOCKS:
            eventually(page, page.get_by_role("button", name=f"{block}, Not inspected").is_visible, f"{block} on own plat map")
        assert season.name not in page_text(page)
    mendota = Api.user(app_url, GROWERS["mendota"][1])
    expect_error(mendota.get(f"/api/orders/{season.order_id}"), 404, "not_found")
    expect_error(mendota.get(f"/api/orders/{season.order_id}/report"), 404, "not_found")
    expect_error(mendota.get("/api/drops"), 403, "forbidden")
    assert season.order_id not in {o["id"] for o in expect_json(mendota.get("/api/orders"), 200)}


APP = Path("/app")


def production_tree() -> dict[str, dict[str, Any]]:
    def tree_at(where: Path) -> tuple[dict[str, dict[str, Any]], bool]:
        result = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=where, capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
        found: dict[str, dict[str, Any]] = {}

        def walk(deps: Any) -> None:
            for name, info in (deps or {}).items():
                if not isinstance(info, dict) or info.get("missing") or not info.get("version"):
                    continue
                if name not in found:
                    found[name] = info
                    walk(info.get("dependencies"))

        assert result.stdout.strip(), f"npm ls printed no JSON: {result.stderr[-LOG_TAIL:]}"
        top = json.loads(result.stdout).get("dependencies") or {}
        walk(top)
        return found, any(isinstance(info, dict) and (info.get("missing") or not info.get("version")) for info in top.values())

    tree, absent = tree_at(APP)
    if absent or any("license" not in info for info in tree.values()):
        tree, _ = tree_at(Path(getattr(importlib.import_module("conftest"), "DEPLOYED_APP", APP)))
    return tree


def licence_allowed(expression: Any) -> bool:
    if isinstance(expression, list):
        return any(licence_allowed(entry) for entry in expression)
    text_value = expression.get("type", "") if isinstance(expression, dict) else str(expression or "")
    text_value = re.sub(r"\bApache\s+2\.0\b", "Apache-2.0", text_value)
    parts = [p.strip("() ") for p in re.split(r"\s+(?:OR|AND)\s+", text_value)]
    return all(p in LICENCES for p in parts) if " AND " in text_value else any(p in LICENCES for p in parts)


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    tree = production_tree()
    declared = json.loads((APP / "package.json").read_text()).get("dependencies") or {}
    assert tree or not declared, "production dependency tree"
    missing = [name for name in tree if name not in notices]
    assert not missing, missing

    def squashed(value: str) -> str:
        return re.sub(r"[\s_-]+", "", value).casefold()

    assert all(squashed(name) in squashed(notices) for name in FONTS_AND_ICONS)


def test_if_licences() -> None:
    bad = {name: info.get("license") or info.get("licenses") for name, info in production_tree().items()
           if not licence_allowed(info.get("license") or info.get("licenses"))}
    assert not bad, bad
    assert FONT_LICENCE.search((APP / "THIRD_PARTY_NOTICES.md").read_text()), "SIL Open Font License 1.1 named for the fonts"


def test_if_no_extra_datastore() -> None:
    package = json.loads((APP / "package.json").read_text())
    names = list(package.get("dependencies") or {})
    stores = {store.lower() for store in FORBIDDEN_STORES}
    shipped = [name for name in names if any(part.rstrip("0123456789") in stores for part in re.split(r"[@/._-]+", name.lower()))]
    assert not shipped, shipped
    stray = [p for p in APP.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not stray, stray
    assert Postgres().tables()


def test_if_service_config_untouched() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    commands = " ".join(str(manifest.get(k, "")) for k in ("install", "build", "serve"))
    for variable in ("DATABASE_URL=", "KILLBILL_URL=", "KILLBILL_PASSWORD=", "SMTP_HOST=", "S3_ENDPOINT=", "S3_SECRET_ACCESS_KEY="):
        assert variable not in commands, variable


def test_if_typescript_and_lockfile() -> None:
    skipped = {"node_modules", ".git", "dist", "build", "public", "coverage", "out"}
    emitted: list[tuple[str, ...]] = []
    for config in [c for c in APP.rglob("tsconfig*.json") if "node_modules" not in c.parts]:
        source = re.sub(r'("(?:\\.|[^"\\])*")|/\*.*?\*/|//[^\n]*', lambda m: m.group(1) or "", config.read_text(), flags=re.S)
        source = re.sub(r",(\s*[}\]])", r"\1", source)
        try:
            out_dir = (json.loads(source).get("compilerOptions") or {}).get("outDir")
        except (ValueError, AttributeError):
            continue
        folder = Path(os.path.relpath(os.path.normpath(config.parent / out_dir), APP)).parts if isinstance(out_dir, str) else ()
        if folder and folder[0] not in (".", ".."):
            emitted.append(folder)

    def generated(parts: tuple[str, ...]) -> bool:
        return bool(skipped & set(parts)) or parts[0].startswith("dist") or any(parts[:len(e)] == e for e in emitted)
    offenders = [str(p) for p in APP.rglob("*")
                 if p.is_file() and p.suffix in (".js", ".jsx", ".mjs", ".cjs")
                 and not generated(p.relative_to(APP).parts) and not any(part.startswith(".") for part in p.relative_to(APP).parts)
                 and ".config." not in p.name]
    assert not offenders, offenders
    package = json.loads((APP / "package.json").read_text())
    root = json.loads((APP / "package-lock.json").read_text())["packages"][""]
    for section in ("dependencies", "devDependencies"):
        assert (root.get(section) or {}) == (package.get(section) or {}), section


def test_if_no_test_switches(app_url: str) -> None:
    broker = Api.user(app_url, BROKER_EMAIL)
    for path in ("/api/test/reset", "/api/__test__/clock", "/api/debug/time", "/api/dev/seed"):
        assert broker.post(path, {}).status_code == 404, path
    serve = json.loads((APP / "run.json").read_text())["serve"]
    assert not re.search(r"\b(TEST|FAKE|MOCK)_\w*=", serve)
