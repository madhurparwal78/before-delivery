from __future__ import annotations

import concurrent.futures
import contextlib
import hashlib
import json
import os
import re
import select
import shlex
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import quote, unquote, urlsplit

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    PocketBase,
    Postgres,
    S3,
    addresses,
    advance,
    click,
    fill,
    idempotency_key,
    licence_allowed,
    motion,
    open_app,
    pdf_text,
    sample,
    same_origin,
    session,
    shipped_packages,
    tab_order,
    text,
    unique,
)


APP_ROOT = Path("/app")
APP_PORT = 4173
TOPIC = "gloamwork-studio"
FOUNDER_PASSWORD = "rig-founder-2026"
APPROVE = "4242 4242 4242 4242"
DECLINE = "4000 0000 0000 0002"
INVALID_CARD = "4111 1111 1111 1111"
FUTURE_EXPIRY = "12/39"
PAST_EXPIRY = "01/20"
SEED_RATES = {"EUR": "1.1650", "USD": "1.2725", "JPY": "205.4175"}
SHOT_ORDER = ["hero_front", "three_quarter", "top_down", "detail_macro", "turntable_360", "exploded_view"]
TITLES = {"hero_front": "Hero front", "three_quarter": "Three-quarter", "top_down": "Top-down", "detail_macro": "Detail macro", "turntable_360": "360 turntable", "exploded_view": "Exploded view"}
PRICES = {"hero_front": 45000, "three_quarter": 45000, "top_down": 38000, "detail_macro": 52000, "turntable_360": 145000, "exploded_view": 185000}
ANGLES = {"hero_front": (0, 5), "three_quarter": (45, 20), "top_down": (0, 90), "detail_macro": (300, 15), "turntable_360": (90, 10), "exploded_view": (135, 30)}
EXP = {"GBP": 2, "EUR": 2, "USD": 2, "JPY": 0}
SYM = {"GBP": "£", "EUR": "€", "USD": "$", "JPY": "¥"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
NOT_FOUND_HEADING = "We couldn't find that page"
NOT_FOUND_TEXT = "The link may have expired, been withdrawn, or never existed."
CHANGE_ORDER_EUR_MINOR = 25164
PDF_CAP = 25_000_000
JSON_LIMIT = 65_536
DEFAULT_WINDOW_S = 900
DEFAULT_OVERDUE_S = 1_209_600
REVIEW_TOKEN_MIN_CHARS = 43
TILT_MAX = 12
MORPH_MIN_MS = 500
MORPH_MAX_MS = 700
FLY_MIN_MS = 500
FLY_MAX_MS = 700
FOCUS_MIN_MS = 250
FOCUS_MAX_MS = 400
COUNT_MAX_MS = 600
SETTLE_MIN_MS = 300
SETTLE_MAX_MS = 500
SCRUB_RANGE_PX = 2400
SCRUB_SETTLE_MS = 100
STATUS_REFRESH_MS = 10_000
SEARCH_DEBOUNCE_MS = 250
SEARCH_PROPAGATION_S = 5
ABANDON_RELEASE_S = 10
DECK_LONG_DRAG_PX = 120
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)

ERR = {
    "unauthenticated": (401, "Sign in to continue."),
    "invalid_credentials": (401, "That password is wrong."),
    "code_invalid": (401, "That code is wrong or has expired."),
    "cross_origin": (403, "Requests must come from this site."),
    "not_found": (404, "We couldn't find that page"),
    "payload_too_large": (413, "That request is too large."),
    "file_too_large": (413, "That file is over the size limit for its type."),
    "idempotency_key_required": (400, "Send an Idempotency-Key header."),
    "request_in_progress": (409, "That request is still being processed. Try again in a moment."),
    "idempotency_conflict": (409, "That request key was already used for a different request."),
    "invalid_state": (409, "This engagement can't do that at its current stage."),
    "quote_locked": (409, "The quote is locked because the deposit is paid."),
    "quote_empty": (409, "Add at least one shot before paying the deposit."),
    "model_missing": (409, "Upload your product's GLB file before paying the deposit."),
    "measurement_pending": (409, "Your model is still being measured. Try again in a moment."),
    "unit_unconfirmed": (409, "Confirm the export unit of your model before paying the deposit."),
    "stills_missing": (409, "Post a still for every shot before sending for review."),
    "look_dev_unpaid": (409, "The look-dev invoice must be paid before final stills go out."),
    "finals_not_ready": (409, "The final stills aren't ready for review yet."),
    "invoice_not_payable": (409, "This invoice can't be paid right now."),
    "email_taken": (409, "That email already has a Gloamwork account. Sign in instead."),
    "slug_taken": (409, "That slug is already used by another case study."),
    "file_type_mismatch": (422, "That file isn't what its name says. Upload a .glb, .step, .stp or .pdf file that matches its extension."),
    "gltf_malformed": (422, "That GLB file couldn't be read. Re-export it as binary glTF 2.0 and upload it again."),
    "validation_failed": (422, "Check the highlighted fields."),
    "too_many_requests": (429, "Too many codes were requested. Try again in a few minutes."),
    "card_declined": (402, "Your card was declined. Nothing has been charged. Try another card."),
    "billing_unavailable": (503, "Billing is offline right now. Nothing has been charged. Please try again in a few minutes."),
    "storage_unavailable": (503, "File storage is offline right now. Your file was not saved. Please try again in a few minutes."),
    "email_unavailable": (503, "Email is offline right now. Nothing has been charged. Please try again in a few minutes."),
    "search_unavailable": (503, "Search is offline right now. Please try again in a few minutes."),
}
FIELD = {
    "email": "Enter a valid email address.",
    "currency_start": "Choose EUR, GBP, USD or JPY.",
    "currency_rate": "Choose EUR, USD or JPY.",
    "quantity": "Choose between 1 and 6 colourways.",
    "unit": "Choose as exported, mm, cm or in.",
    "unit_non_glb": "Only a GLB model has an export unit.",
    "card.number": "Use one of the studio's test cards.",
    "card.expiry": "Enter an expiry date in the future.",
    "card.cvc": "Enter the 3-digit security code.",
    "refund_minor": "Enter a refund between 1 and the amount paid.",
    "shot_code": "Choose a shot in this engagement's quote.",
    "rate": "Enter a rate between 0.0001 and 1000 with up to four decimals.",
    "effective_at": "Enter a time that is now or later.",
    "list_price_pence": "Enter a whole number of pence from 1 to 10000000.",
    "service_title": "Use 1 to 60 characters.",
    "slug": "Use 3 to 60 lowercase letters, digits and hyphens.",
    "scene": "Use 1 to 8 primitives and an accent of ember, cobalt or violet.",
    "q": "Use up to 100 characters.",
}
BANNER_MEASURING = "Measuring is delayed. Your files are stored safely and will be measured when the queue is back."
BANNER_DOCUMENTS = "Documents are offline right now. Payments still go through, and receipts and invoices will be emailed once documents are back."
MILESTONE_LABELS = {"deposit": "Deposit", "look_dev": "Look-dev", "final_delivery": "Final delivery"}
MM_READOUT = "180.0 × 210.0 × 85.0 mm"
IN_READOUT = "7.09 × 8.27 × 3.35 in"


HTTP_TIMEOUT = 90
MEASURE_DEADLINE = 60
MAIL_DEADLINE = 45
MAIL_LISTING = 200
MAIL_SETTLE_S = 4
PUSH_DEADLINE = 45
UI_DEADLINE = 30
BOOT_DEADLINE = 240
STATUS_DEADLINE = 40
SHORT_CODE_TTL_S = 10
SHORT_WINDOW_S = 20
SHORT_REVIEW_TTL_S = 20
STEP_MS = 50
DIALOG_TAB_PRESSES = 8
UPLOAD_RESET_TRIES = 3
SWIPE_SPAN = 0.6
SWIPE_STEPS = 12
TIMING_SLACK_MS = 60
CLOCK_TOLERANCE_S = 120
ABORT_DECLARED = 180_000_000
ABORT_SENT = 6_000_000
OVERSIZE_PDF = 2 * PDF_CAP
RELAY_CHUNKS = 10_000_000
RELAY_ACCEPTS = 100_000
DRAG_PX = 160
PUBLISH_RETRY_WAIT_S = 12
PREMATURE_MAIL_WAIT_S = 15
LINK_SLACK_S = 15
SCHEDULE_WAIT_S = 30
CARD_NAME = "Verifier Payer"
OFFSITE = "evil.example"
FOREIGN_ORIGIN = "http://" + OFFSITE
JP_REPORT_NAME = "報告 最終.pdf"
KETTLE_SLUG = "brant-vale-arc-kettle"
KETTLE_TITLE = "Brant & Vale Arc kettle"
KETTLE_FIGURE = f"{KETTLE_TITLE} in 3D"
UNKNOWN_ID = "00000000-0000-4000-8000-000000000000"


def outage(env: str) -> str:
    value = os.environ.get(env)
    if not value:
        pytest.fail(f"{env} is not set; the outage instance must be reachable")
    return value.rstrip("/")


def origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def http_client(base: str, cookies: dict[str, str] | None = None) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_TIMEOUT, headers={"Origin": origin(base)}, cookies=cookies or {}, follow_redirects=False)


def cookie_map(http: httpx.Client) -> dict[str, str]:
    return {c.name: c.value for c in http.cookies.jar}


def clone(http: httpx.Client, base: str | None = None) -> httpx.Client:
    return http_client(base or str(http.base_url), cookie_map(http))


def assert_error(resp: httpx.Response, code: str, field: str | None = None, copy: str | None = None) -> None:
    status, message = ERR[code]
    assert resp.status_code == status, f"expected {status} {code}, got {resp.status_code}: {resp.text[:400]}"
    body = resp.json()
    assert body.get("error") == code, body
    assert body.get("message") == message, body
    if field is not None:
        assert body.get("fields", {}).get(field) == copy, body


def ident(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    email = b if "@" in b else a if "@" in a else f"{a}@verifier.test"
    label = a if "@" not in a else b if "@" not in b else a.split("@")[0]
    return label[:60], email.lower()


def money(minor: int, currency: str) -> str:
    exp = EXP[currency]
    whole, frac = divmod(minor, 10 ** exp)
    return f"{SYM[currency]}{whole:,}" + (f".{frac:0{exp}d}" if exp else "")


def kb_minor(amount: Any, currency: str) -> int:
    return int((Decimal(str(amount)) * (10 ** EXP[currency])).to_integral_value())


def half_up(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def expected_quote(lines: dict[str, int], rate: str, currency: str, prices: dict[str, int] = PRICES) -> dict[str, int]:
    exp = EXP[currency]
    r = Decimal("1.0000") if currency == "GBP" else Decimal(rate)
    amounts = {c: half_up(Decimal(prices[c] * q) * r * (10 ** exp) / 100) for c, q in lines.items()}
    subtotal = sum(amounts.values())
    vat = half_up(Decimal(subtotal) * Decimal("0.2"))
    total = subtotal + vat
    deposit = total * 40 // 100
    look_dev = total * 30 // 100
    return {"subtotal": subtotal, "vat": vat, "total": total, "deposit": deposit, "look_dev": look_dev, "final": total - deposit - look_dev, **{f"line:{c}": a for c, a in amounts.items()}}


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def long_date(dt: datetime) -> str:
    return f"{dt.day} {MONTHS[dt.month - 1]} {dt.year}"


def parallel(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(c) for c in calls]
        return [f.result() for f in futures]


def poll(check: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    for _ in range(100_000):
        last = check()
        if last:
            return last
        if time.monotonic() > deadline:
            break
        with httpx.Client(timeout=5) as idle:
            with contextlib.suppress(httpx.HTTPError):
                idle.get(os.environ.get("APP_URL", "http://127.0.0.1:9"))
    pytest.fail(f"{what} (waited {seconds}s)")


def _pack_glb(doc: dict[str, Any], bin_data: bytes = b"", *, version: int = 2, length_delta: int = 0,
              second_type: bytes = b"BIN\x00", json_misaligned: bool = False) -> bytes:
    j = json.dumps(doc, separators=(",", ":")).encode()
    if json_misaligned:
        j += b" " * ((1 - len(j)) % 4)
    else:
        j += b" " * (-len(j) % 4)
    out = struct.pack("<I4s", len(j), b"JSON") + j
    if bin_data:
        bd = bin_data + b"\x00" * (-len(bin_data) % 4)
        out += struct.pack("<I4s", len(bd), second_type) + bd
    return struct.pack("<4sII", b"glTF", version, 12 + len(out) + length_delta) + out


def glb(mn: list[float], mx: list[float], *, nodes: list[dict[str, Any]] | None = None, scene_nodes: list[int] | None = None,
        component: int = 5126, normalized: bool = False, required: list[str] | None = None, used: list[str] | None = None,
        asset_version: str = "2.0", pad: int = 0, **pack: Any) -> bytes:
    corners = [(x, y, z) for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])]
    if component == 5126:
        data = b"".join(struct.pack("<3f", *c) for c in corners)
        view: dict[str, Any] = {"buffer": 0, "byteLength": len(data)}
    else:
        fmt = {5120: "<3b", 5121: "<3B", 5122: "<3h", 5123: "<3H"}[component]
        data = b"".join(struct.pack(fmt, *[int(v) for v in c]).ljust(8, b"\x00") for c in corners)
        view = {"buffer": 0, "byteLength": len(data), "byteStride": 8}
    accessor: dict[str, Any] = {"bufferView": 0, "componentType": component, "count": 8, "type": "VEC3", "min": mn, "max": mx}
    if normalized:
        accessor["normalized"] = True
    data += b"\x00" * pad
    doc: dict[str, Any] = {
        "asset": {"version": asset_version}, "scene": 0, "scenes": [{"nodes": scene_nodes if scene_nodes is not None else [0]}],
        "nodes": nodes if nodes is not None else [{"mesh": 0}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [accessor], "bufferViews": [view], "buffers": [{"byteLength": len(data)}],
    }
    if used is not None:
        doc["extensionsUsed"] = used
    if required is not None:
        doc["extensionsRequired"] = required
    return _pack_glb(doc, data, **pack)


def glb_product() -> bytes:
    return glb([0, 0, 0], [0.18, 0.21, 0.085])


def glb_millimetres() -> bytes:
    return glb([0, 0, 0], [180, 210, 85])


def glb_quantized() -> bytes:
    return glb([-32767, 0, -32767], [32767, 32767, 32767], component=5122, normalized=True,
               nodes=[{"mesh": 0, "scale": [0.09, 0.21, 0.0425]}],
               required=["KHR_mesh_quantization"], used=["KHR_mesh_quantization"])


def glb_unmeasurable() -> bytes:
    return glb([0, 0, 0], [0.1, 0.1, 0.1], scene_nodes=[3])


STEP_BYTES = b"  \n\tISO-10303-21;\nHEADER;\nFILE_NAME('part');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"


def pdf_bytes(tag: str = "") -> bytes:
    return b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% " + tag.encode() + b"\ntrailer<</Root 1 0 R>>\n%%EOF\n"


def png_bytes(seed: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    raw = b"\x00" + bytes([seed % 256, (seed * 7) % 256, (seed * 13) % 256])
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


@dataclass
class Brand:
    base: str
    http: httpx.Client
    eid: str
    brand_id: str
    reference: str
    name: str
    currency: str
    owner: str
    finance: str
    reviewer: str


def start(base: str, currency: str = "GBP") -> Brand:
    name, owner = ident("owner")
    _, finance = ident("finance")
    _, reviewer = ident("reviewer")
    http = http_client(base)
    resp = http.post("/api/projects/start", json={"brand_name": name, "contact_name": "Verifier Owner", "email": owner,
                                                  "title": f"Launch stills {name}"[:120], "currency": currency,
                                                  "finance_email": finance, "reviewer_email": reviewer})
    assert resp.status_code == 201, f"POST /api/projects/start: {resp.status_code} {resp.text[:400]}"
    eng = resp.json()["engagement"]
    return Brand(base, http, eng["id"], eng["brand"]["id"], eng["reference"], eng["brand"]["name"], currency, owner, finance, reviewer)


def engagement(b: Brand, http: httpx.Client | None = None) -> dict[str, Any]:
    resp = (http or b.http).get(f"/api/engagements/{b.eid}")
    assert resp.status_code == 200, resp.text[:400]
    return resp.json()


def upload(b: Brand, name: str, data: bytes, http: httpx.Client | None = None, ctype: str = "application/octet-stream") -> httpx.Response:
    return (http or b.http).post(f"/api/engagements/{b.eid}/files", files={"file": (name, data, ctype)})


def file_of(b: Brand, file_id: str, http: httpx.Client | None = None) -> dict[str, Any]:
    for f in engagement(b, http)["files"]:
        if f["id"] == file_id:
            return f
    pytest.fail(f"file {file_id} missing from GET /api/engagements/{b.eid}")


def wait_measurement(b: Brand, file_id: str, want: str = "measured", http: httpx.Client | None = None) -> dict[str, Any]:
    def done() -> dict[str, Any] | None:
        f = file_of(b, file_id, http)
        if f["measurement"] == "failed" and want != "failed":
            pytest.fail(f"measurement failed for {file_id}; expected {want}")
        return f if f["measurement"] == want else None
    return poll(done, MEASURE_DEADLINE, f"intake file {file_id} never reached measurement {want}")


def put_line(b: Brand, code: str, qty: int, http: httpx.Client | None = None) -> httpx.Response:
    return (http or b.http).put(f"/api/engagements/{b.eid}/quote/lines/{code}", json={"quantity": qty})


def ready(base: str, currency: str = "GBP", lines: dict[str, int] | None = None) -> Brand:
    b = start(base, currency)
    resp = upload(b, "product.glb", glb_product())
    assert resp.status_code == 201, resp.text[:400]
    wait_measurement(b, resp.json()["id"])
    for code, qty in (lines if lines is not None else {"hero_front": 1}).items():
        assert put_line(b, code, qty).status_code == 200
    return b


def card(number: str = APPROVE, expiry: str = FUTURE_EXPIRY, cvc: str = "123") -> dict[str, str]:
    return {"number": number, "expiry": expiry, "cvc": cvc, "name": CARD_NAME}


def deposit(b: Brand, number: str = APPROVE, key: str | None = None, http: httpx.Client | None = None, body: dict[str, Any] | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key or uuid.uuid4().hex} if key != "" else {}
    return (http or b.http).post(f"/api/engagements/{b.eid}/deposit", json=body or {"card": card(number)}, headers=headers)


def paid(base: str, currency: str = "GBP", lines: dict[str, int] | None = None) -> Brand:
    b = ready(base, currency, lines)
    resp = deposit(b)
    assert resp.status_code == 201, resp.text[:400]
    return b


def founder(base: str) -> httpx.Client:
    http = http_client(base)
    resp = http.post("/api/studio/session", json={"password": FOUNDER_PASSWORD})
    assert resp.status_code == 200, resp.text[:300]
    return http


def studio_engagement(f: httpx.Client, eid: str) -> dict[str, Any]:
    resp = f.get(f"/api/studio/engagements/{eid}")
    assert resp.status_code == 200, resp.text[:300]
    return resp.json()


def post_still(f: httpx.Client, eid: str, shot: str, milestone: str, data: bytes | None = None) -> httpx.Response:
    return f.post(f"/api/studio/engagements/{eid}/stills", data={"shot_code": shot, "milestone": milestone},
                  files={"file": ("still.png", data or png_bytes(hash(shot + milestone) % 997), "image/png")})


def token_of(url: str) -> str:
    return url.rsplit("/review/", 1)[1]


def send_for_review(b: Brand, f: httpx.Client, milestone: str = "look_dev") -> dict[str, Any]:
    for line in engagement(b)["quote"]["lines"]:
        assert post_still(f, b.eid, line["shot_code"], milestone).status_code == 201
    resp = f.post(f"/api/studio/engagements/{b.eid}/send-for-review", json={})
    assert resp.status_code == 200, resp.text[:300]
    return resp.json()


def reviewer(base: str) -> httpx.Client:
    return http_client(base)


def accept(base: str, token: str) -> httpx.Response:
    with reviewer(base) as r:
        return r.post(f"/api/review/{token}/accept", json={})


def revise(base: str, token: str, key: str, note: str = "Warmer rim light please") -> httpx.Response:
    with reviewer(base) as r:
        return r.post(f"/api/review/{token}/revisions", json={"note": note}, headers={"Idempotency-Key": key})


def invoice_of(f: httpx.Client, eid: str, milestone: str) -> dict[str, Any]:
    for inv in studio_engagement(f, eid)["invoices"]:
        if inv["milestone"] == milestone:
            return inv
    pytest.fail(f"no {milestone} invoice on engagement {eid}")


def to_final_review(b: Brand, f: httpx.Client) -> dict[str, Any]:
    token = token_of(send_for_review(b, f)["review_url"])
    assert accept(b.base, token).status_code == 200
    return invoice_of(f, b.eid, "look_dev")


def issue(f: httpx.Client, invoice_id: str) -> httpx.Response:
    return f.post(f"/api/studio/invoices/{invoice_id}/issue", json={})


def pay(b: Brand, invoice_id: str, number: str = APPROVE, key: str | None = None, http: httpx.Client | None = None) -> httpx.Response:
    return (http or b.http).post(f"/api/invoices/{invoice_id}/payments", json={"card": card(number)}, headers={"Idempotency-Key": key or uuid.uuid4().hex})


def issued_look_dev(b: Brand, f: httpx.Client) -> dict[str, Any]:
    inv = to_final_review(b, f)
    resp = issue(f, inv["id"])
    assert resp.status_code == 200, resp.text[:300]
    return resp.json()


def subject(m: dict[str, Any]) -> str:
    return str(m.get("Subject", ""))


def matching(mail: Any, to: str, subj: str | Callable[[str], bool] | None) -> list[dict[str, Any]]:
    def match(m: dict[str, Any]) -> bool:
        if to.lower() not in [a.lower() for a in addresses(m.get("To"))]:
            return False
        if subj is None:
            return True
        return subj(subject(m)) if callable(subj) else subject(m) == subj
    summaries = mail.client.get("/api/v1/messages", params={"limit": MAIL_LISTING}).json()["messages"]
    return [mail.client.get(f"/api/v1/message/{m['ID']}").json() for m in summaries if match(m)]


def inbox(mail: Any, to: str, subj: str | Callable[[str], bool] | None = None, expected: int = 1, seconds: float = MAIL_DEADLINE) -> list[dict[str, Any]]:
    state: dict[str, list[dict[str, Any]]] = {"found": []}

    def enough() -> bool:
        state["found"] = matching(mail, to, subj)
        return len(state["found"]) >= expected
    poll(enough, seconds, f"Mailpit held fewer than {expected} message(s) to {to} matching {subj!r}")
    return state["found"]


def settled_inbox(mail: Any, to: str, subj: str | Callable[[str], bool] | None) -> list[dict[str, Any]]:
    window = time.monotonic() + MAIL_SETTLE_S
    state: dict[str, list[dict[str, Any]]] = {"found": []}

    def settled() -> bool:
        state["found"] = matching(mail, to, subj)
        return time.monotonic() >= window
    poll(settled, MAIL_SETTLE_S + MAIL_DEADLINE, "the mailbox settle window")
    return state["found"]


def attachments(m: dict[str, Any]) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    base = os.environ.get("MAILPIT_URL", "").rstrip("/")
    for a in m.get("Attachments") or []:
        name = a.get("FileName", "")
        data = b""
        if base and m.get("ID") and a.get("PartID"):
            with httpx.Client(timeout=HTTP_TIMEOUT) as c:
                r = c.get(f"{base}/api/v1/message/{m['ID']}/part/{a['PartID']}")
                data = r.content if r.status_code == 200 else b""
        out.append((name, data))
    return out


def code_from(mail: Any, email: str, before: set[str]) -> str:
    def newest() -> list[dict[str, Any]] | None:
        fresh = [m for m in inbox(mail, email, "Your Gloamwork sign-in code", expected=1) if m.get("ID") not in before]
        return fresh or None
    fresh = poll(newest, MAIL_DEADLINE, f"no new sign-in code email reached {email}")
    match = re.search(r"\b(\d{6})\b", text(fresh[0]))
    assert match, "sign-in email carries no six-digit code"
    return match.group(1)


def code_ids(mail: Any, email: str) -> set[str]:
    summaries = mail.client.get("/api/v1/messages", params={"limit": MAIL_LISTING}).json()["messages"]
    return {m.get("ID") for m in summaries if email.lower() in [a.lower() for a in addresses(m.get("To"))]}


def sign_in(base: str, mail: Any, email: str, next_path: str | None = None) -> tuple[httpx.Client, httpx.Response]:
    http = http_client(base)
    before = code_ids(mail, email)
    assert http.post("/api/session/code", json={"email": email}).status_code == 202
    code = code_from(mail, email, before)
    body: dict[str, Any] = {"email": email, "code": code}
    if next_path is not None:
        body["next"] = next_path
    resp = http.post("/api/session", json=body)
    assert resp.status_code == 200, resp.text[:300]
    return http, resp


def pushes(ntfy: Any, title: str, message: str, want: int = 1, seconds: float = PUSH_DEADLINE) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    seen: list[dict[str, Any]] = []
    for _ in range(10_000):
        seen = [m for m in ntfy.messages(TOPIC, 0, timeout=2) if m.get("title") == title and m.get("message") == message]
        if len(seen) >= want or time.monotonic() > deadline:
            break
    if len(seen) < want:
        pytest.fail(f"ntfy topic {TOPIC} held {len(seen)} push(es) titled {title!r} with {message!r}; expected {want}")
    return seen


def kb_invoices_with_voided(killbill: Any, account_id: str) -> list[dict[str, Any]]:
    response = killbill.client.get(f"/accounts/{account_id}/invoices",
                                   params={"includeInvoiceComponents": "true", "includeVoidedInvoices": "true"})
    assert response.status_code == 200, response.text
    return response.json()


def kb_account(killbill: Any, brand_id: str) -> dict[str, Any] | None:
    return killbill.account_by_key(brand_id)


def kb_transactions(killbill: Any, account_id: str, kind: str) -> list[dict[str, Any]]:
    out = []
    for p in killbill.payments(account_id):
        for t in p.get("transactions", []):
            if t.get("transactionType") == kind and t.get("status") == "SUCCESS":
                out.append({**t, "paymentId": p.get("paymentId")})
    return out


def kb_net(killbill: Any, account_id: str, currency: str) -> int:
    return (sum(kb_minor(t["amount"], currency) for t in kb_transactions(killbill, account_id, "PURCHASE"))
            - sum(kb_minor(t["amount"], currency) for t in kb_transactions(killbill, account_id, "REFUND")))


def search_titles(base: str, q: str) -> list[dict[str, Any]]:
    with http_client(base) as c:
        r = c.get("/api/search", params={"q": q})
        assert r.status_code == 200, r.text[:300]
        return r.json()["hits"]


@contextmanager
def opened(browser: Browser, url: str, **kw: Any) -> Iterator[Page]:
    handle = open_app(browser, url, **kw)
    if hasattr(handle, "__enter__"):
        with handle as page:
            yield page
    else:
        page = next(handle)
        try:
            yield page
        finally:
            with contextlib.suppress(StopIteration):
                next(handle)


@contextmanager
def ui(browser: Browser, base: str, path: str, *, size: tuple[int, int] = DESKTOP, cookies: dict[str, str] | None = None,
       reduced: bool = False, no_webgl: bool = False) -> Iterator[Page]:
    first = base + ("/sign-in" if cookies else path)
    with opened(browser, first, reduced_motion="reduce" if reduced else "no-preference", no_webgl=no_webgl) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if cookies:
            page.context.add_cookies([{"name": k, "value": v, "url": base} for k, v in cookies.items()])
            page.goto(base + path)
        yield page


UNCASED_JS = """(e) => { const s = document.createElement('style');
  s.textContent = '*, *::before, *::after { text-transform: none !important; }';
  document.head.appendChild(s);
  try { return e.innerText; } finally { s.remove(); } }"""


def plain_text(loc: Locator) -> str:
    return loc.evaluate(UNCASED_JS)


def eventually(page: Page, check: Callable[[], Any], what: str, seconds: float = UI_DEADLINE, step: float = 250) -> None:
    deadline = time.monotonic() + seconds
    for _ in range(100_000):
        with contextlib.suppress(PlaywrightError, AssertionError):
            if check():
                return
        if time.monotonic() > deadline:
            break
        advance(page, step)
    pytest.fail(f"{what} (waited {seconds}s)")


def is_focused(loc: Locator) -> bool:
    return bool(loc.evaluate("el => el === document.activeElement || el.contains(document.activeElement)"))


def focused_is(loc: Locator) -> bool:
    return bool(loc.evaluate("el => el === document.activeElement"))


def record_attr(loc: Locator, attr: str) -> None:
    loc.evaluate("""(el, attr) => { window.__rec = window.__rec || {}; const log = window.__rec[attr] = [[el.getAttribute(attr), performance.now()]];
        new MutationObserver(records => { const now = performance.now();
          records.forEach((r, i) => { const v = i + 1 < records.length ? records[i + 1].oldValue : el.getAttribute(attr);
            if (log[log.length-1][0] !== v) log.push([v, now]); }); })
        .observe(el, {attributes: true, attributeFilter: [attr], attributeOldValue: true}); }""", attr)


def recorded(page: Page, attr: str) -> list[list[Any]]:
    return page.evaluate("attr => (window.__rec || {})[attr] || []", attr)


def record_text(loc: Locator, key: str) -> None:
    loc.evaluate("""(el, key) => { window.__ann = window.__ann || {}; const log = window.__ann[key] = [];
        new MutationObserver(() => { const t = el.textContent.trim(); if (t && log[log.length-1] !== t) log.push(t); })
        .observe(el, {subtree: true, childList: true, characterData: true}); }""", key)


def announced(page: Page, key: str) -> list[str]:
    return page.evaluate("key => (window.__ann || {})[key] || []", key)


def rig(page: Page) -> Locator:
    return page.get_by_role("group", name="Shot Rig")


def shot_box(page: Page, code: str) -> Locator:
    return page.get_by_role("list", name="Shots").get_by_role("checkbox", name=TITLES[code], exact=True)


def spin(page: Page, code: str) -> Locator:
    return page.get_by_role("spinbutton", name=f"Colourways for {TITLES[code]}")


def quote_values(page: Page) -> list[int]:
    region = page.get_by_role("region", name="Quote")
    return sorted(int(v) for v in region.locator("[data-value-minor]").evaluate_all("els => els.map(e => e.getAttribute('data-value-minor'))"))


def figures(q: dict[str, Any]) -> list[int]:
    m = q["milestones"]
    return sorted([q["subtotal_minor"], q["vat_minor"], q["total_minor"], m["deposit_minor"], m["look_dev_minor"], m["final_delivery_minor"]])


def boxes(loc: Locator) -> list[dict[str, float]]:
    return [b for b in (loc.nth(i).bounding_box() for i in range(loc.count())) if b]


def columns(loc: Locator) -> int:
    rects = boxes(loc)
    top = min(r["y"] for r in rects)
    return len({round(r["x"]) for r in rects if abs(r["y"] - top) < 4})


def finance_cookies(base: str, mail: Any, email: str) -> dict[str, str]:
    http, _ = sign_in(base, mail, email)
    return cookie_map(http)


def layout_ok(page: Page) -> None:
    from conftest import layout
    layout(page)


def test_wf_browse_studio_desktop_journey(browser: Browser, app_url: str) -> None:
    pb = PocketBase()
    published = sorted([r for r in pb.records("case_studies") if r.get("published")], key=lambda r: r.get("sort", 0))
    with http_client(app_url) as c:
        content = c.get("/api/content").json()
    assert [cs["title"] for cs in content["case_studies"]] == [r["title"] for r in published]
    assert "Tallow T18 drill driver" not in [cs["title"] for cs in content["case_studies"]]
    with ui(browser, app_url, "/") as page:
        hero = page.get_by_role("region", name="Hero")
        assert "Your CAD, lit like a launch." in plain_text(hero)
        nav = page.get_by_role("navigation", name="Main")
        for label in ["01 Work", "02 Services", "03 Studio", "04 Insights", "05 Start a project"]:
            assert nav.get_by_role("link", name=label).is_visible()
        work = page.get_by_role("list", name="Case studies")
        for r in published:
            assert work.get_by_role("link", name=r["title"]).count() == 1
        box = page.get_by_role("searchbox", name="Search the studio")
        fill(box, "kettle")
        advance(page, SEARCH_DEBOUNCE_MS + STEP_MS)
        results = page.get_by_role("list", name="Search results")
        eventually(page, lambda: results.get_by_role("link", name="Brant & Vale Arc kettle").is_visible(), "search for kettle showed the Arc kettle hit")
        eventually(page, lambda: plain_text(page.get_by_role("status", name="Search status")).startswith("Matches: "), "Search status announced Matches")
        click(results.get_by_role("link", name="Brant & Vale Arc kettle"))
        eventually(page, lambda: page.url.endswith("/work/brant-vale-arc-kettle"), "search hit opened /work/brant-vale-arc-kettle")
        eventually(page, lambda: page.get_by_role("heading", name="Brant & Vale Arc kettle").is_visible(), "case study headline")
        assert page.get_by_role("figure", name=KETTLE_FIGURE).is_visible()
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="05 Start a project"))
        eventually(page, lambda: page.url.rstrip("/").endswith("/start") and page.get_by_role("form", name="Start a project").is_visible(), "05 Start a project reached the start form")


def test_wf_browse_studio_phone_journey(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/", size=PHONE) as page:
        menu = page.get_by_role("navigation", name="Main").get_by_role("button", name="Menu")
        deck = page.get_by_role("list", name="Case studies")
        assert deck.get_attribute("data-deck-index") == "1"
        front = deck.get_by_role("link").first
        front.focus()
        page.keyboard.press("ArrowRight")
        advance(page, 700)
        assert deck.get_attribute("data-deck-index") == "2"
        click(menu)
        advance(page, 400)
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="05 Start a project"))
        eventually(page, lambda: page.url.rstrip("/").endswith("/start") and page.get_by_role("form", name="Start a project").is_visible(), "drawer link reached the start form")


def test_dp02_hero_scrub(browser: Browser, app_url: str) -> None:
    positions = [0, 300, 900, 1500, 2100, SCRUB_RANGE_PX, 3000]
    with ui(browser, app_url, "/") as page:
        hero = page.get_by_role("region", name="Hero")
        page.evaluate("() => document.documentElement.style.minHeight = '6000px'")
        readings: dict[int, float] = {}
        prev = -1.0
        for y in positions:
            page.evaluate("y => window.scrollTo({top: y, left: 0, behavior: 'instant'})", y)
            advance(page, SCRUB_SETTLE_MS)
            value = float(hero.get_attribute("data-scrub-progress") or "nan")
            want = min(y / SCRUB_RANGE_PX, 1.0)
            assert abs(value - want) <= 0.0011, f"scroll {y}: data-scrub-progress {value}, expected {want:.3f}"
            assert value >= prev
            readings[y] = value
            prev = value
        for y in reversed(positions):
            page.evaluate("y => window.scrollTo({top: y, left: 0, behavior: 'instant'})", y)
            advance(page, SCRUB_SETTLE_MS)
            value = float(hero.get_attribute("data-scrub-progress") or "nan")
            assert value <= prev + 1e-9
            assert abs(value - readings[y]) < 1e-9, "same scroll position gave a different frame on the way back"
            prev = value
    with ui(browser, app_url, "/", reduced=True) as page:
        hero = page.get_by_role("region", name="Hero")
        page.evaluate("() => window.scrollTo({top: 0, left: 0, behavior: 'instant'})")
        advance(page, SCRUB_SETTLE_MS)
        assert hero.get_attribute("data-scrub-progress") == "1.000"


def test_dp03_clay_morph(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, f"/work/{KETTLE_SLUG}") as page:
        fig = page.get_by_role("figure", name=KETTLE_FIGURE)
        sw = page.get_by_role("switch", name="Clay view")
        eventually(page, lambda: fig.get_attribute("data-transition") == "done", "direct open shows data-transition done")
        assert fig.get_attribute("data-idle") == "turning"
        assert fig.get_attribute("data-morph") == "0.000"
        click(sw)
        advance(page, MORPH_MIN_MS - TIMING_SLACK_MS)
        mid = float(fig.get_attribute("data-morph") or "nan")
        assert 0.0 < mid < 1.0, f"data-morph {mid} before 0.5 s; expected mid-morph"
        advance(page, MORPH_MAX_MS - MORPH_MIN_MS + 2 * TIMING_SLACK_MS)
        assert fig.get_attribute("data-morph") == "1.000"
        click(sw)
        advance(page, MORPH_MIN_MS - TIMING_SLACK_MS)
        assert 0.0 < float(fig.get_attribute("data-morph") or "nan") < 1.0
        advance(page, MORPH_MAX_MS - MORPH_MIN_MS + 2 * TIMING_SLACK_MS)
        assert fig.get_attribute("data-morph") == "0.000"
    with ui(browser, app_url, f"/work/{KETTLE_SLUG}", reduced=True) as page:
        fig = page.get_by_role("figure", name=KETTLE_FIGURE)
        eventually(page, lambda: fig.get_attribute("data-idle") == "still", "reduced motion stands the subject still")
        click(page.get_by_role("switch", name="Clay view"))
        advance(page, STEP_MS)
        assert fig.get_attribute("data-morph") == "1.000"


MARQUEE_SEEK = """(region, [el, points, span]) => {
  const anims = region.getAnimations({subtree: true}).filter(a => a.playState === 'running' && a.currentTime !== null);
  if (!anims.length) return null;
  const saved = anims.map(a => a.currentTime);
  const out = [];
  for (let i = 0; i < points; i++) {
    const t = span * i / (points - 1);
    anims.forEach((a, k) => { a.currentTime = saved[k] + t; });
    const b = el.getBoundingClientRect(); out.push({t, x: b.x, y: b.y});
  }
  anims.forEach((a, k) => { a.currentTime = saved[k]; });
  return out; }"""


def marquee_path(region: Locator, name: Locator, span_ms: float, samples: int) -> list[dict[str, float]]:
    seeked = region.evaluate(MARQUEE_SEEK, [name.element_handle(), samples, span_ms])
    return seeked if seeked else motion(name, span_ms, samples=samples)


def test_dp04_marquee(browser: Browser, app_url: str) -> None:
    def spread(path: list[dict[str, float]]) -> float:
        xs = [p.get("x", 0.0) for p in path]
        return max(xs) - min(xs)
    with ui(browser, app_url, "/") as page:
        region = page.get_by_role("region", name="Clients")
        region.scroll_into_view_if_needed()
        name = region.get_by_text("Hollin Audio", exact=True).first
        page.mouse.move(0, 0)
        path = marquee_path(region, name, 2000, 9)
        assert spread(path) > 1, "client names did not move while playing"
        xs = [p.get("x", 0.0) for p in path]
        steps = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
        median = sorted(steps)[len(steps) // 2]
        assert median != 0, "client names did not move while playing"
        forward = [abs(s) for s in steps if s * median > 0]
        assert len(forward) >= len(steps) - 2, f"marquee moved erratically: {steps}"
        assert max(forward) - min(forward) <= 0.25 * max(forward) + 0.5, f"marquee pace is not steady: {steps}"
        pause = region.get_by_role("button", name="Pause client names")
        click(pause)
        assert region.get_by_role("button", name="Play client names").is_visible()
        page.mouse.move(0, 0)
        assert spread(motion(name, 1500, samples=6)) <= 1, "marquee kept moving after Pause"
        click(region.get_by_role("button", name="Play client names"))
        box = region.bounding_box()
        assert box, "Clients region has no box"
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        assert spread(motion(name, 1500, samples=6)) <= 1, "marquee kept moving under the pointer"
    with ui(browser, app_url, "/", reduced=True) as page:
        region = page.get_by_role("region", name="Clients")
        for client in ["Hollin Audio", "Tallow Tools", "Fenwick Lamps"]:
            assert region.get_by_text(client, exact=True).first.is_visible()
        assert spread(motion(region.get_by_text("Hollin Audio", exact=True).first, 1500, samples=6)) <= 1


def test_dp05_founder_publishes_case_study(app_url: str) -> None:
    pb = PocketBase()
    tag = uuid.uuid4().hex[:8]
    slug = f"verifier-lamp-{tag}"
    f = founder(app_url)
    with http_client(app_url) as anon:
        assert_error(anon.post("/api/studio/work", json={"slug": slug}), "unauthenticated")
        body = {"slug": slug, "title": f"Verifier lamp {tag}", "client": "Verifier Lighting", "summary": "A desk lamp study.",
                "scene": {"primitives": ["cylinder", "torus"], "accent": "cobalt"}, "published": False, "sort": 900}
        bad = f.post("/api/studio/work", json={**body, "scene": {"primitives": ["box"] * 9, "accent": "cobalt"}})
        assert_error(bad, "validation_failed", "scene", FIELD["scene"])
        assert_error(f.post("/api/studio/work", json={**body, "slug": "No Caps"}), "validation_failed", "slug", FIELD["slug"])
        created = f.post("/api/studio/work", json=body)
        assert created.status_code == 201, created.text[:300]
        try:
            assert_error(f.post("/api/studio/work", json=body), "slug_taken")
            rec = pb.records("case_studies", f"slug='{slug}'")
            assert len(rec) == 1 and not rec[0]["published"] and rec[0]["title"] == body["title"]
            assert_error(anon.get(f"/api/work/{slug}"), "not_found")
            page = anon.get(f"/work/{slug}")
            assert page.status_code == 404
            assert NOT_FOUND_HEADING in page.text.replace("&#x27;", "'").replace("&#39;", "'") or \
                page.headers.get("content-type", "").startswith("text/html")
            assert slug in [cs["slug"] for cs in f.get("/api/studio/work").json()["case_studies"]]
            r = f.patch(f"/api/studio/work/{slug}", json={"published": True, "title": f"Verifier lamp {tag} v2",
                                                          "scene": {"primitives": ["sphere"], "accent": "violet"}})
            assert r.status_code == 200 and r.json()["published"] is True
            rec = pb.records("case_studies", f"slug='{slug}'")[0]
            assert rec["published"] and rec["title"] == f"Verifier lamp {tag} v2"
            got = anon.get(f"/api/work/{slug}")
            assert got.status_code == 200 and got.json()["scene"] == {"primitives": ["sphere"], "accent": "violet"}
            assert slug in [cs["slug"] for cs in anon.get("/api/content").json()["case_studies"]]
        finally:
            f.patch(f"/api/studio/work/{slug}", json={"published": False})
        assert pb.records("case_studies", f"slug='{slug}'")[0]["published"] is False
        assert_error(anon.get(f"/api/work/{slug}"), "not_found")


def test_dp06_grid_breakpoints(browser: Browser, app_url: str) -> None:
    cookies = cookie_map(founder(app_url))
    for size, want in [(PHONE, 1), (TABLET, 2), (DESKTOP, 3)]:
        with ui(browser, app_url, "/studio", size=size, cookies=cookies) as page:
            grid = page.get_by_role("list", name="Studio case studies").get_by_role("listitem")
            eventually(page, lambda: grid.count() >= 4, "studio grid listed every seeded case study")
            assert columns(grid) == want, f"studio grid at {size[0]}px: expected {want} columns"
            texts = [plain_text(x) for x in grid.all()]
            assert any("Draft" in t and "Tallow T18 drill driver" in t for t in texts)
            assert any("Published" in t for t in texts)
    for size, want in [(TABLET, 2), (DESKTOP, 3)]:
        with ui(browser, app_url, "/", size=size) as page:
            links = page.get_by_role("list", name="Case studies").get_by_role("link")
            assert columns(links) == want, f"public grid at {size[0]}px: expected {want} columns"
    with ui(browser, app_url, "/", size=PHONE) as page:
        deck = page.get_by_role("list", name="Case studies")
        assert deck.get_attribute("data-deck-index") == "1"
        assert deck.get_by_role("link").count() == 1, "only the front card is exposed below 768"


def test_dp72_phone_drawer(browser: Browser, app_url: str) -> None:
    links = ["01 Work", "02 Services", "03 Studio", "04 Insights", "05 Start a project"]
    with ui(browser, app_url, "/", size=PHONE) as page:
        layout_ok(page)
        menu = page.get_by_role("button", name="Menu")
        assert menu.get_attribute("aria-expanded") == "false"
        for label in links:
            assert page.get_by_role("link", name=label, exact=True).count() == 0, f"closed drawer exposes {label}"
        page.get_by_role("link", name="Skip to content").focus()
        names = tab_order(page, 6)
        assert names[0] == "Menu"
        assert not set(names) & set(links), f"Tab reached a closed drawer link: {names}"
        menu.focus()
        page.keyboard.press("Enter")
        advance(page, 400)
        assert menu.get_attribute("aria-expanded") == "true"
        nav = page.get_by_role("navigation", name="Main")
        assert focused_is(nav.get_by_role("link", name="01 Work"))
        assert tab_order(page, 5)[-1] == "01 Work", "Tab from 05 Start a project did not wrap to 01 Work"
        page.keyboard.press("Shift+Tab")
        assert focused_is(nav.get_by_role("link", name="05 Start a project"))
        page.keyboard.press("Escape")
        advance(page, 400)
        assert menu.get_attribute("aria-expanded") == "false"
        assert focused_is(menu)
    with ui(browser, app_url, "/", size=TABLET) as page:
        layout_ok(page)
        assert page.get_by_role("button", name="Menu").count() == 0
        for label in links:
            assert page.get_by_role("navigation", name="Main").get_by_role("link", name=label).is_visible()


def test_dp84_studio_search(app_url: str, meilisearch: Any) -> None:
    idx = meilisearch.indexes().get("studio_content")
    assert idx and idx["primaryKey"] == "id"
    assert set(meilisearch.settings("studio_content").get("searchableAttributes", [])) == {"title", "summary"}
    doc = meilisearch.document("studio_content", f"case_study-{KETTLE_SLUG}")
    assert doc and doc["url"] == f"/work/{KETTLE_SLUG}" and doc["kind"] == "case_study"
    assert meilisearch.document("studio_content", f"case_study-{'tallow-t18-drill'}") is None
    svc = meilisearch.document("studio_content", f"service-{'hero_front'}")
    assert svc and svc["summary"] == f"{money(PRICES['hero_front'], 'GBP')} per colourway" and svc["url"] == "/#services"
    hits = search_titles(app_url, "kettle")
    assert {"kind": "case_study", "title": KETTLE_TITLE, "url": f"/work/{KETTLE_SLUG}"}.items() <= next(h for h in hits if h["kind"] == "case_study").items()
    assert not [h for h in search_titles(app_url, "Tallow T18") if h["kind"] == "case_study"]
    assert search_titles(app_url, "   ") == []
    with http_client(app_url) as c:
        assert_error(c.get("/api/search", params={"q": "x" * 101}), "validation_failed", "q", FIELD["q"])
    tag = uuid.uuid4().hex[:8]
    word = f"zephyrine{tag}"
    slug = f"verifier-search-{tag}"
    f = founder(app_url)

    def within(pred: Callable[[list[dict[str, Any]]], bool], q: str, what: str) -> None:
        deadline = time.monotonic() + SEARCH_PROPAGATION_S + 1
        for _ in range(1000):
            if pred(search_titles(app_url, q)):
                return
            if time.monotonic() > deadline:
                break
        pytest.fail(what)
    r = f.post("/api/studio/work", json={"slug": slug, "title": f"Lamp {word}", "client": "Verifier", "summary": "Search probe.",
                                         "scene": {"primitives": ["box"], "accent": "ember"}, "published": False, "sort": 901})
    assert r.status_code == 201
    try:
        assert not search_titles(app_url, word)
        assert f.patch(f"/api/studio/work/{slug}", json={"published": True}).status_code == 200
        within(lambda h: any(x["url"] == f"/work/{slug}" for x in h), word, "published case study missing from search within 5 s")
        assert f.patch(f"/api/studio/work/{slug}", json={"title": f"Sconce {word}"}).status_code == 200
        within(lambda h: any(x["title"] == f"Sconce {word}" for x in h), word, "renamed case study title not in search within 5 s")
    finally:
        f.patch(f"/api/studio/work/{slug}", json={"published": False})
    within(lambda h: not h, word, "unpublished case study still in search after 5 s")


def test_dp86_service_tilt(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/") as page:
        table = page.get_by_role("table", name="Shot prices")
        row = table.get_by_role("row").filter(has=page.get_by_role("link", name="Hero front", exact=True))
        obj = row.locator("[data-tilt]")
        obj.scroll_into_view_if_needed()
        assert obj.get_attribute("data-idle") == "turning"
        box = obj.bounding_box()
        assert box
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx + box["width"] / 4, cy)
        advance(page, 600)
        assert abs(int(obj.get_attribute("data-tilt") or "-99") - 6) <= 1
        page.mouse.move(cx + box["width"] * 0.49, cy)
        advance(page, 600)
        assert 11 <= int(obj.get_attribute("data-tilt") or "-99") <= TILT_MAX
        page.mouse.move(cx + box["width"] * 1.5, cy)
        advance(page, 600)
        assert int(obj.get_attribute("data-tilt") or "-99") == TILT_MAX
        page.mouse.move(2, 2)
        advance(page, SETTLE_MIN_MS - TIMING_SLACK_MS)
        assert int(obj.get_attribute("data-tilt") or "0") > 0
        advance(page, SETTLE_MAX_MS - SETTLE_MIN_MS + 2 * TIMING_SLACK_MS)
        assert obj.get_attribute("data-tilt") == "0"
        row.get_by_role("link", name="Hero front", exact=True).focus()
        advance(page, 600)
        assert int(obj.get_attribute("data-tilt") or "0") == TILT_MAX
        page.get_by_role("link", name="Skip to content").focus()
        advance(page, 700)
        assert obj.get_attribute("data-tilt") == "0"
    with ui(browser, app_url, "/", reduced=True) as page:
        row = page.get_by_role("table", name="Shot prices").get_by_role("row").filter(has=page.get_by_role("link", name="Hero front", exact=True))
        obj = row.locator("[data-tilt]")
        obj.hover()
        advance(page, 600)
        assert obj.get_attribute("data-tilt") == "0" and obj.get_attribute("data-idle") == "still"


def test_dp87_process_camera_path(browser: Browser, app_url: str) -> None:
    stages = ["01 Quote", "02 Deposit", "03 Look-dev review", "04 Final review", "05 Delivered"]
    with ui(browser, app_url, "/") as page:
        region = page.get_by_role("region", name="Process")
        geo = region.evaluate("el => { const r = el.getBoundingClientRect(); return {top: r.top + window.scrollY, height: r.height, vh: window.innerHeight}; }")
        span = geo["height"] - geo["vh"]
        assert span > 0, "Process region is not a tall scrolling region"
        plan = [(0.1, 1), (0.3, 2), (0.5, 3), (0.7, 4), (0.95, 5)]
        for p, step in plan + list(reversed(plan)):
            page.evaluate("y => window.scrollTo({top: y, left: 0, behavior: 'instant'})", geo["top"] + p * span)
            advance(page, 200)
            assert region.get_attribute("data-process-step") == str(step), f"progress {p}: expected step {step}"
            current = region.get_by_role("list", name="Process stages").get_by_role("listitem").filter(has_text=stages[step - 1])
            assert current.get_attribute("aria-current") == "step"
    with ui(browser, app_url, "/", reduced=True) as page:
        assert page.get_by_role("region", name="Process").get_attribute("data-process-step") == "all"


def test_dp88_shared_element_transition(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/") as page:
        page.evaluate("() => window.__verifierMarker = 1")
        click(page.get_by_role("list", name="Case studies").get_by_role("link", name=KETTLE_TITLE))
        fig = page.get_by_role("figure", name=KETTLE_FIGURE)
        eventually(page, lambda: fig.count() == 1, "detail figure appeared", step=20)
        assert page.evaluate("() => window.__verifierMarker") == 1, "tile link caused a full page load"
        assert fig.get_attribute("data-transition") == "morphing"
        advance(page, MORPH_MIN_MS - TIMING_SLACK_MS)
        assert fig.get_attribute("data-transition") == "morphing"
        advance(page, MORPH_MAX_MS - MORPH_MIN_MS + 2 * TIMING_SLACK_MS)
        assert fig.get_attribute("data-transition") == "done"
        page.go_back()
        tiles = page.get_by_role("list", name="Case studies").locator("[data-transition]")
        eventually(page, lambda: "morphing" in tiles.evaluate_all("els => els.map(e => e.getAttribute('data-transition'))"), "Back ran the reverse morph", step=20)
        advance(page, MORPH_MAX_MS + TIMING_SLACK_MS)
        assert set(tiles.evaluate_all("els => els.map(e => e.getAttribute('data-transition'))")) == {"done"}
    with ui(browser, app_url, "/", reduced=True) as page:
        click(page.get_by_role("list", name="Case studies").get_by_role("link", name="Brant & Vale Arc kettle"))
        fig = page.get_by_role("figure", name=KETTLE_FIGURE)
        eventually(page, lambda: fig.count() == 1, "detail figure appeared", step=20)
        assert fig.get_attribute("data-transition") == "done"


def test_dp89_phone_deck(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/", size=PHONE) as page:
        deck = page.get_by_role("list", name="Case studies")
        deck.scroll_into_view_if_needed()
        deck.get_by_role("link").first.focus()
        page.keyboard.press("ArrowLeft")
        advance(page, 700)
        assert deck.get_attribute("data-deck-index") == "1", "deck wrapped past its first card"
        page.keyboard.press("ArrowRight")
        advance(page, 700)
        assert deck.get_attribute("data-deck-index") == "2"
        assert is_focused(deck.get_by_role("link").first)
        page.keyboard.press("ArrowLeft")
        advance(page, 700)
        assert deck.get_attribute("data-deck-index") == "1"
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        box = deck.get_by_role("link").first.bounding_box()
        assert box
        x0, y0 = box["x"] + box["width"] * 0.7, box["y"] + box["height"] / 2

        def drag(dx: float, duration_ms: float, steps: int = 6) -> None:
            t0 = time.time()
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}], "timestamp": t0})
            for i in range(1, steps + 1):
                advance(page, duration_ms / steps)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 - dx * i / steps, "y": y0}], "timestamp": t0 + duration_ms * i / steps / 1000})
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [], "timestamp": t0 + duration_ms / 1000})
            advance(page, 700)
        drag(40, 400)
        assert deck.get_attribute("data-deck-index") == "1", "short slow drag advanced the deck"
        drag(60, 50)
        assert deck.get_attribute("data-deck-index") == "2", "fast fling did not advance one card"
        drag(DECK_LONG_DRAG_PX + 20, 1200, steps=10)
        assert deck.get_attribute("data-deck-index") == "3", "long slow drag did not advance one card"


def test_dp07_one_not_found(app_url: str) -> None:
    a, b = start(app_url), start(app_url)
    want = {"error": "not_found", "message": NOT_FOUND_HEADING}
    with http_client(app_url) as anon:
        for path in ["/api/no-such-route-verifier", "/api/work/tallow-t18-drill", "/api/review/" + "x" * REVIEW_TOKEN_MIN_CHARS]:
            r = anon.get(path)
            assert r.status_code == 404 and r.json() == want, f"{path}: {r.status_code} {r.text[:200]}"
        for path in ["/no-such-page-verifier", "/work/tallow-t18-drill", "/review/" + "x" * REVIEW_TOKEN_MIN_CHARS]:
            r = anon.get(path)
            assert r.status_code == 404, path
            assert NOT_FOUND_HEADING in r.text.replace("&#x27;", "'").replace("&#39;", "'") or r.headers.get("content-type", "").startswith("text/html")
    other = a.http.get(f"/api/engagements/{b.eid}")
    missing = a.http.get(f"/api/engagements/{UNKNOWN_ID}")
    assert other.status_code == missing.status_code == 404
    assert other.json() == missing.json() == want


def test_dp08_start_project(app_url: str, mail: Any) -> None:
    for currency in ["EUR", "GBP", "USD", "JPY"]:
        b = start(app_url, currency)
        eng = engagement(b)
        assert eng["state"] == "quoted" and eng["brand"]["currency"] == currency
        assert re.fullmatch(r"GW-\d+", eng["reference"]) and int(eng["reference"][3:]) >= 1005
        assert eng["quote"]["exponent"] == EXP[currency] and eng["quote"]["revision"] == 0 and eng["quote"]["lines"] == []
        assert b.eid in [e["id"] for e in b.http.get("/api/engagements").json()["engagements"]]
        for contact in (b.finance, b.reviewer):
            with http_client(app_url) as c:
                assert c.post("/api/session/code", json={"email": contact}).status_code == 202
            inbox(mail, contact, "Your Gloamwork sign-in code")
        with http_client(app_url) as c:
            body = {"brand_name": "Dup", "contact_name": "Dup", "email": b.owner.upper(), "title": "Dup", "currency": currency, "reviewer_email": ident("rev")[1]}
            assert_error(c.post("/api/projects/start", json=body), "email_taken")
            assert_error(c.post("/api/projects/start", json={**body, "email": "accounts@hollin-audio.test"}), "email_taken")
    with http_client(app_url) as c:
        base = {"brand_name": "X", "contact_name": "Y", "email": ident("v")[1], "title": "Z", "currency": "CHF", "reviewer_email": ident("r")[1]}
        assert_error(c.post("/api/projects/start", json=base), "validation_failed", "currency", FIELD["currency_start"])
        assert_error(c.post("/api/projects/start", json={**base, "currency": "EUR", "email": "not-an-email"}), "validation_failed", "email", FIELD["email"])


def test_dp09_sign_in(app_url: str, mail: Any) -> None:
    b = start(app_url)
    http, resp = sign_in(app_url, mail, b.owner)
    assert resp.json()["brand"]["id"] == b.brand_id and resp.json()["landing"] == "/account"
    assert http.get("/api/engagements").status_code == 200
    with http_client(app_url) as c:
        before = code_ids(mail, b.finance)
        c.post("/api/session/code", json={"email": b.finance})
        first = code_from(mail, b.finance, before)
        before = code_ids(mail, b.finance)
        c.post("/api/session/code", json={"email": b.finance})
        second = code_from(mail, b.finance, before)
        if first != second:
            assert_error(c.post("/api/session", json={"email": b.finance, "code": first}), "code_invalid")
        assert c.post("/api/session", json={"email": b.finance, "code": second}).status_code == 200
        assert_error(c.post("/api/session", json={"email": b.finance, "code": second}), "code_invalid")
        before = code_ids(mail, b.reviewer)
        c.post("/api/session/code", json={"email": b.reviewer})
        good = code_from(mail, b.reviewer, before)
        wrong = f"{(int(good) + 1) % 1_000_000:06d}"
        for _ in range(5):
            assert_error(c.post("/api/session", json={"email": b.reviewer, "code": wrong}), "code_invalid")
        assert_error(c.post("/api/session", json={"email": b.reviewer, "code": good}), "code_invalid")
        assert_error(c.get("/api/studio/engagements"), "unauthenticated")
        assert_error(c.post("/api/studio/session", json={"password": "wrong-password"}), "invalid_credentials")
    f = founder(app_url)
    assert f.get("/api/studio/engagements").status_code == 200
    short = outage("APP_SHORT_URL")
    sb = start(short)
    with http_client(short) as c:
        before = code_ids(mail, sb.owner)
        c.post("/api/session/code", json={"email": sb.owner})
        code = code_from(mail, sb.owner, before)
        issued = time.monotonic()
        poll(lambda: time.monotonic() - issued > SHORT_CODE_TTL_S + 1, SHORT_CODE_TTL_S + 5, "waiting past the code TTL")
        assert_error(c.post("/api/session", json={"email": sb.owner, "code": code}), "code_invalid")


def test_dp10_brand_scope(app_url: str) -> None:
    a = start(app_url)
    b = paid(app_url)
    eng = engagement(b)
    fid = eng["files"][0]["id"]
    inv = eng["invoices"][0]["id"]
    pdf = upload(b, "sheet.pdf", pdf_bytes("b"))
    assert pdf.status_code == 201
    missing = a.http.get(f"/api/engagements/{UNKNOWN_ID}").json()
    attempts = [
        a.http.get(f"/api/engagements/{b.eid}"),
        a.http.put(f"/api/engagements/{b.eid}/quote/lines/hero_front", json={"quantity": 2}),
        a.http.delete(f"/api/engagements/{b.eid}/quote/lines/hero_front"),
        a.http.post(f"/api/engagements/{b.eid}/files", files={"file": ("x.pdf", pdf_bytes(), "application/pdf")}),
        a.http.get(f"/api/engagements/{b.eid}/files/{fid}/content"),
        a.http.get(f"/api/engagements/{a.eid}/files/{pdf.json()['id']}/content"),
        a.http.put(f"/api/engagements/{b.eid}/files/{fid}/unit", json={"unit": "mm"}),
        a.http.post(f"/api/engagements/{b.eid}/deposit", json={"card": card()}, headers={"Idempotency-Key": uuid.uuid4().hex}),
        a.http.get(f"/api/invoices/{inv}"),
        a.http.post(f"/api/invoices/{inv}/payments", json={"card": card()}, headers={"Idempotency-Key": uuid.uuid4().hex}),
    ]
    for r in attempts:
        assert r.status_code == 404 and r.json() == missing, f"{r.request.method} {r.request.url}: {r.status_code} {r.text[:200]}"
    assert engagement(b)["quote"]["lines"][0]["quantity"] == 1
    assert b.eid not in [e["id"] for e in a.http.get("/api/engagements").json()["engagements"]]


def test_dp67_code_request_limit(app_url: str, mail: Any) -> None:
    b = start(app_url)
    _, unknown = ident("nobody")
    replies: dict[str, httpx.Response] = {}
    with http_client(app_url) as c:
        for email in (b.owner, unknown):
            for i in range(3):
                assert c.post("/api/session/code", json={"email": email if i else email.upper()}).status_code == 202
            replies[email] = c.post("/api/session/code", json={"email": email.upper()})
        for email, r in replies.items():
            assert_error(r, "too_many_requests")
            ra = int(r.headers["Retry-After"])
            assert 1 <= ra <= DEFAULT_WINDOW_S
        assert replies[b.owner].json() == replies[unknown].json()
        assert set(replies[b.owner].headers.keys()) - {"date", "content-length", "retry-after", "etag"} == set(replies[unknown].headers.keys()) - {"date", "content-length", "retry-after", "etag"}
        msgs = sorted(inbox(mail, b.owner, "Your Gloamwork sign-in code", expected=3), key=lambda m: str(m.get("Created", m.get("Date", ""))), reverse=True)
        assert len(settled_inbox(mail, b.owner, "Your Gloamwork sign-in code")) == 3, "a refused fourth request sent an email"
        assert not settled_inbox(mail, unknown, None), "an unknown email received mail"
        codes = [m.group(1) for m in (re.search(r"\b(\d{6})\b", text(msg)) for msg in msgs) if m]
        assert len(codes) == 3, "each of the three sign-in emails carries a six-digit code"
        signed = False
        for code in codes:
            if c.post("/api/session", json={"email": b.owner, "code": code}).status_code == 200:
                signed = True
                break
        assert signed, "the last sign-in code did not work after the refused fourth request"
    short = outage("APP_SHORT_URL")
    _, roll = ident("roll")
    with http_client(short) as c:
        for _ in range(3):
            assert c.post("/api/session/code", json={"email": roll}).status_code == 202
        refused = c.post("/api/session/code", json={"email": roll})
        assert_error(refused, "too_many_requests")
        wait_s = int(refused.headers["Retry-After"])
        assert 1 <= wait_s <= SHORT_WINDOW_S
        t0 = time.monotonic()
        poll(lambda: time.monotonic() - t0 >= wait_s, wait_s + 5, "waiting out Retry-After")
        assert c.post("/api/session/code", json={"email": roll}).status_code == 202


def test_dp79_landing_next_path(browser: Browser, app_url: str, mail: Any) -> None:
    b = start(app_url)
    own = f"/account/engagements/{b.eid}"
    slash = "/"
    offsite_next = [slash + slash + OFFSITE + "/x", slash + "\\" + OFFSITE, "https:" + slash + slash + OFFSITE + "/account"]
    for email, nxt, want in [(b.owner, own, own), (b.owner, offsite_next[0], "/account"),
                             (b.finance, offsite_next[1], "/account"), (b.finance, offsite_next[2], "/account")]:
        _, resp = sign_in(app_url, mail, email, nxt)
        assert resp.json()["landing"] == want, f"next {nxt!r}: landing {resp.json()['landing']!r}"
    target = f"{own}?tab=invoices"
    with ui(browser, app_url, target) as page:
        eventually(page, lambda: "/sign-in?next=" in page.url, "signed-out visit redirected to sign-in")
        assert unquote(page.url.split("next=", 1)[1]) == target
        before = code_ids(mail, b.reviewer)
        fill(page.get_by_role("textbox", name="Email"), b.reviewer)
        click(page.get_by_role("button", name="Send code"))
        code = code_from(mail, b.reviewer, before)
        fill(page.get_by_role("textbox", name="Code"), code)
        click(page.get_by_role("button", name="Sign in"))
        eventually(page, lambda: page.url.endswith(target), f"sign-in landed on {target}")
        page.reload()
        assert page.url.endswith(target)


def test_wf_client_access_portal(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    b = paid(app_url)
    other = start(app_url)
    f = founder(app_url)
    inv = issued_look_dev(b, f)
    assert f.post(f"/api/studio/engagements/{b.eid}/cancel", json={"refund_minor": 1}).status_code == 200
    acct = kb_account(killbill, b.brand_id)
    assert acct
    kb_inv = [i for i in kb_invoices_with_voided(killbill, acct["accountId"]) if str(i.get("invoiceNumber")) == str(inv["number"])]
    assert kb_inv and kb_inv[0]["status"] == "VOID"
    with ui(browser, app_url, "/sign-in") as page:
        before = code_ids(mail, b.finance)
        fill(page.get_by_role("textbox", name="Email"), b.finance)
        click(page.get_by_role("button", name="Send code"))
        eventually(page, lambda: page.get_by_text("If that email belongs to a Gloamwork client, a sign-in code is on its way.").is_visible(), "code request copy")
        fill(page.get_by_role("textbox", name="Code"), code_from(mail, b.finance, before))
        click(page.get_by_role("button", name="Sign in"))
        eventually(page, lambda: page.url.rstrip("/").endswith("/account"), "sign-in landed on /account")
        eng = engagement(b)
        own = re.compile(re.escape(eng["title"]) + "|" + re.escape(eng["reference"]))
        eventually(page, lambda: page.get_by_role("link", name=own).count() >= 1, "account lists the engagement")
        assert page.get_by_text(other.reference, exact=True).count() == 0
        click(page.get_by_role("link", name=own).first)
        eventually(page, lambda: page.url.endswith(f"/account/engagements/{b.eid}"), "engagement page opened")
        table = page.get_by_role("table", name="Invoices")
        eventually(page, lambda: table.get_by_role("row").count() >= 3, "invoices table rows")
        rows = [plain_text(x) for x in table.get_by_role("row").all()][1:]
        assert "Deposit" in rows[0] and "Paid" in rows[0]
        assert any("Look-dev" in r and "Void" in r for r in rows)
        assert page.get_by_role("list", name="Receipts").get_by_role("listitem").count() >= 2
        model_name = next(x["name"] for x in eng["files"] if x["kind"] == "model")
        assert page.get_by_role("link", name=f"Download {model_name}").count() == 1


def test_wf_client_access_start_form(browser: Browser, app_url: str) -> None:
    name, owner = ident("ui-owner")
    with ui(browser, app_url, "/start") as page:
        form = page.get_by_role("form", name="Start a project")
        fill(form.get_by_role("textbox", name="Brand name"), name)
        fill(form.get_by_role("textbox", name="Your name"), "UI Owner")
        fill(form.get_by_role("textbox", name="Email", exact=True), "not-an-email")
        fill(form.get_by_role("textbox", name="Project title"), "Grip launch stills")
        fill(form.get_by_role("textbox", name="Reviewer email"), ident("ui-rev")[1])
        click(form.get_by_role("radiogroup", name="Account currency").get_by_role("radio", name="JPY"))
        click(form.get_by_role("button", name="Start project"))
        summary = page.get_by_role("alert").filter(has=page.get_by_role("heading", name="There is a problem"))
        eventually(page, lambda: summary.is_visible(), "error summary appeared")
        assert is_focused(summary)
        click(summary.get_by_role("link", name=FIELD["email"]))
        assert focused_is(form.get_by_role("textbox", name="Email", exact=True))
        fill(form.get_by_role("textbox", name="Email", exact=True), owner)
        click(form.get_by_role("button", name="Start project"))
        eventually(page, lambda: re.search(r"/rig/[0-9a-f-]{36}$", page.url) is not None, "start landed on /rig/<id>")
        eid = page.url.rsplit("/", 1)[1]
        got = page.request.get(f"{app_url}/api/engagements/{eid}")
        assert got.status == 200 and got.json()["brand"]["currency"] == "JPY" and got.json()["state"] == "quoted"
        assert page.get_by_role("heading", name="Shot Rig").is_visible()


def test_dp12_intake_stored(app_url: str) -> None:
    s3 = S3()
    b = start(app_url)
    for name, data, ext, kind in [("product.glb", glb_product(), "glb", "model"), ("part.step", STEP_BYTES, "step", "step"), ("sheet.pdf", pdf_bytes("12"), "pdf", "reference")]:
        r = upload(b, name, data)
        assert r.status_code == 201, r.text[:300]
        body = r.json()
        assert body["status"] == "received" and body["kind"] == kind and body["size_bytes"] == len(data)
        key = f"intake/{b.eid}/{body['id']}.{ext}"
        assert key in s3.keys(f"intake/{b.eid}/"), f"{key} missing from MinIO"
        assert s3.get(key) == data


DP13_IDS = ["pdf_named_glb", "step_named_pdf", "unknown_extension", "glb_version_1", "glb_length_mismatch", "glb_json_misaligned",
            "glb_second_chunk_not_bin", "glb_asset_version_1", "glb_matrix_and_trs", "glb_short_positions_unquantized",
            "pdf_over_cap", "pdf_at_cap", "step_uppercase_with_whitespace"]


def dp13_case(case: str) -> tuple[str, bytes, str | None]:
    big = PDF_CAP - len(pdf_bytes())
    return {
        "pdf_named_glb": ("model.glb", pdf_bytes(), "file_type_mismatch"),
        "step_named_pdf": ("sheet.pdf", STEP_BYTES, "file_type_mismatch"),
        "unknown_extension": ("notes.txt", pdf_bytes(), "file_type_mismatch"),
        "glb_version_1": ("v1.glb", glb([0, 0, 0], [0.1, 0.1, 0.1], version=1), "gltf_malformed"),
        "glb_length_mismatch": ("len.glb", glb([0, 0, 0], [0.1, 0.1, 0.1], length_delta=4), "gltf_malformed"),
        "glb_json_misaligned": ("json.glb", _pack_glb({"asset": {"version": "2.0"}}, json_misaligned=True), "gltf_malformed"),
        "glb_second_chunk_not_bin": ("chunk.glb", glb([0, 0, 0], [0.1, 0.1, 0.1], second_type=b"XBIN"), "gltf_malformed"),
        "glb_asset_version_1": ("asset.glb", glb([0, 0, 0], [0.1, 0.1, 0.1], asset_version="1.0"), "gltf_malformed"),
        "glb_matrix_and_trs": ("matrix.glb", glb([0, 0, 0], [0.1, 0.1, 0.1], nodes=[{"mesh": 0, "matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "translation": [1, 0, 0]}]), "gltf_malformed"),
        "glb_short_positions_unquantized": ("short.glb", glb([0, 0, 0], [100, 100, 100], component=5122), "gltf_malformed"),
        "pdf_over_cap": ("big.pdf", pdf_bytes() + b"\x00" * (big + 1), "file_too_large"),
        "pdf_at_cap": ("cap.pdf", pdf_bytes() + b"\x00" * big, None),
        "step_uppercase_with_whitespace": ("PART.STP", STEP_BYTES, None),
    }[case]


@pytest.mark.parametrize("case", DP13_IDS, ids=DP13_IDS)
def test_dp13_upload_checks(app_url: str, case: str) -> None:
    s3 = S3()
    b = start(app_url)
    name, data, error = dp13_case(case)
    r = None
    for _ in range(UPLOAD_RESET_TRIES):
        try:
            r = upload(b, name, data)
            break
        except httpx.TransportError:
            continue
    assert r is not None, f"the server reset the connection on {UPLOAD_RESET_TRIES} tries without an answer"
    if error is None:
        assert r.status_code == 201, r.text[:300]
        assert r.json()["status"] == "received" and r.json()["size_bytes"] == len(data)
        assert len(s3.keys(f"intake/{b.eid}/")) == 1
        return
    assert_error(r, error)
    assert engagement(b)["files"] == []
    assert s3.keys(f"intake/{b.eid}/") == []


def test_dp14_upload_announcements(browser: Browser, app_url: str) -> None:
    b = start(app_url)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        region = page.get_by_role("status", name="Upload progress")
        record_text(region, "upload")
        page.get_by_label("Product files").set_input_files([
            {"name": "product.glb", "mimeType": "model/gltf-binary", "buffer": glb_product()},
            {"name": "fake.glb", "mimeType": "model/gltf-binary", "buffer": pdf_bytes()},
        ])
        want = ["product.glb received.", f"Measurement complete: {MM_READOUT} · {IN_READOUT}.", f"fake.glb: {ERR['file_type_mismatch'][1]}"]
        eventually(page, lambda: all(w in announced(page, "upload") for w in want), f"Upload progress announced {want}", seconds=MEASURE_DEADLINE, step=1000)
        for t in announced(page, "upload"):
            m = re.fullmatch(r"Uploading (.+): (\d+)%", t)
            if m:
                assert 0 <= int(m.group(2)) <= 100


def test_dp68_abandoned_uploads(app_url: str) -> None:
    s3 = S3()
    pg = Postgres()
    b = start(app_url)
    parts = urlsplit(app_url)
    port = parts.port or (443 if parts.scheme == "https" else 80)

    def connect() -> socket.socket:
        sock = socket.create_connection((parts.hostname, port), timeout=HTTP_TIMEOUT)
        return ssl.create_default_context().wrap_socket(sock, server_hostname=parts.hostname) if parts.scheme == "https" else sock

    def request(name: str, declared: int) -> tuple[socket.socket, bytes]:
        boundary = "verifier" + uuid.uuid4().hex
        head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
        tail = f"\r\n--{boundary}--\r\n".encode()
        cookie = "; ".join(f"{k}={v}" for k, v in cookie_map(b.http).items())
        hdr = (f"POST /api/engagements/{b.eid}/files HTTP/1.1\r\nHost: {parts.netloc}\r\nOrigin: {origin(app_url)}\r\nCookie: {cookie}\r\n"
               f"Content-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {len(head) + declared + len(tail)}\r\nConnection: close\r\n\r\n").encode()
        sock = connect()
        sock.sendall(hdr + head)
        return sock, tail

    doc = json.dumps({"asset": {"version": "2.0"}}).encode()
    doc += b" " * (-len(doc) % 4)
    for _ in range(3):
        sock, _ = request("abandoned.glb", ABORT_DECLARED)
        prefix = struct.pack("<4sII", b"glTF", 2, ABORT_DECLARED) + struct.pack("<I4s", len(doc), b"JSON") + doc + struct.pack("<I4s", ABORT_DECLARED - 28 - len(doc), b"BIN\x00")
        with contextlib.suppress(OSError):
            sock.sendall(prefix)
            for _ in range(ABORT_SENT // 1_000_000):
                sock.sendall(b"\x00" * 1_000_000)
        sock.close()
    sock, _ = request("oversize.pdf", OVERSIZE_PDF)
    status_line = b""
    chunk = 65_536
    with contextlib.suppress(OSError):
        sock.sendall(pdf_bytes())
        for _ in range(OVERSIZE_PDF // chunk):
            if select.select([sock], [], [], 0)[0]:
                got = sock.recv(65536)
                status_line += got
                if not got or status_line:
                    break
            sock.sendall(b"\x00" * chunk)
    with contextlib.suppress(OSError):
        sock.shutdown(socket.SHUT_WR)
    with contextlib.suppress(OSError):
        sock.settimeout(HTTP_TIMEOUT)
        for _ in range(1000):
            if b"file_too_large" in status_line:
                break
            got = sock.recv(65536)
            if not got:
                break
            status_line += got
    sock.close()
    assert b" 413 " in status_line.split(b"\r\n", 1)[0] and b"file_too_large" in status_line, f"oversize upload answered {status_line[:200]!r}"

    def clean() -> bool:
        busy = pg.rows("SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user "
                       "AND backend_type = 'client backend' AND (state = 'idle in transaction' OR (state = 'active' AND now() - query_start > interval '2 seconds'))")
        return s3.keys(f"intake/{b.eid}/") == [] and engagement(b)["files"] == [] and int(busy[0]["n"]) == 0
    poll(clean, ABANDON_RELEASE_S, "abandoned uploads left an object, a record or a busy database session after 10 s")
    r = upload(b, "after.pdf", pdf_bytes("after"))
    assert r.status_code == 201 and r.json()["status"] == "received"


def test_dp78_downloads_match(app_url: str) -> None:
    b = start(app_url)
    f = founder(app_url)
    name = JP_REPORT_NAME
    data = pdf_bytes("仕様".encode().hex())
    r = upload(b, f"../../tmp/{name}", data)
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == name, f"display name {body['name']!r}"
    key = S3().keys(f"intake/{b.eid}/")
    assert key == [f"intake/{b.eid}/{body['id']}.pdf"]
    fallback = "".join("_" if (ord(ch) > 127 or ch in '"\\') else ch for ch in name)
    for resp in (b.http.get(f"/api/engagements/{b.eid}/files/{body['id']}/content"), f.get(f"/api/studio/engagements/{b.eid}/files/{body['id']}/content")):
        assert resp.status_code == 200 and resp.content == data
        assert resp.headers["Content-Type"].startswith("application/pdf")
        assert int(resp.headers["Content-Length"]) == len(data)
        cd = resp.headers["Content-Disposition"]
        assert cd.startswith("attachment;")
        plain = re.search(r'filename="([^"]*)"', cd)
        star = re.search(r"filename\*=UTF-8''([^;\s]+)", cd)
        assert plain and plain.group(1) == fallback, cd
        assert star and unquote(star.group(1)) == name and re.fullmatch(r"[A-Za-z0-9!#$&+\-.^_`|~%]+", star.group(1)), cd
    glb_r = upload(b, "製品.glb", glb_product())
    got = b.http.get(f"/api/engagements/{b.eid}/files/{glb_r.json()['id']}/content")
    assert got.content == glb_product() and got.headers["Content-Type"].startswith("model/gltf-binary")


def test_wf_intake_upload_glb_and_pdf(browser: Browser, app_url: str) -> None:
    b = start(app_url)
    pdf_name = "製品仕様書.pdf"
    pdf = pdf_bytes("journey")
    cookies = cookie_map(b.http)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookies) as page:
        scale = page.get_by_role("region", name="Product scale")
        assert "Upload a GLB to see it at true scale." in plain_text(scale)
        page.get_by_label("Product files").set_input_files([
            {"name": "product.glb", "mimeType": "model/gltf-binary", "buffer": glb_product()},
            {"name": pdf_name, "mimeType": "application/pdf", "buffer": pdf},
        ])
        files = page.get_by_role("list", name="Intake files")
        eventually(page, lambda: files.get_by_role("listitem").filter(has_text=pdf_name).filter(has_text="Received").count() == 1, "PDF row Received")
        eventually(page, lambda: files.get_by_role("listitem").filter(has_text="product.glb").filter(has_text="Measured").count() == 1, "model row Measured", seconds=MEASURE_DEADLINE, step=2000)
        assert files.get_by_role("listitem").filter(has_text="product.glb").filter(has_text="Received").count() == 1
        eventually(page, lambda: MM_READOUT in plain_text(scale) and IN_READOUT in plain_text(scale), "plinth readout in mm and in")
    eng = engagement(b)
    pdf_rec = next(x for x in eng["files"] if x["name"] == pdf_name)
    assert S3().get(f"intake/{b.eid}/{pdf_rec['id']}.pdf") == pdf
    with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=cookies) as page:
        with page.expect_download() as dl:
            click(page.get_by_role("link", name=f"Download {pdf_name}"))
        assert dl.value.suggested_filename == pdf_name
        assert Path(dl.value.path()).read_bytes() == pdf


def test_wf_intake_upload_rejected_file(browser: Browser, app_url: str) -> None:
    b = start(app_url)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        page.get_by_label("Product files").set_input_files([{"name": "renamed.glb", "mimeType": "model/gltf-binary", "buffer": pdf_bytes()}])
        files = page.get_by_role("list", name="Intake files")
        eventually(page, lambda: files.get_by_role("listitem").filter(has_text="renamed.glb").filter(has_text="Rejected").count() == 1, "rejected row shows Rejected")
        eventually(page, lambda: plain_text(page.get_by_role("status", name="Upload progress")).strip() == f"renamed.glb: {ERR['file_type_mismatch'][1]}", "rejection announced")
    assert engagement(b)["files"] == [] and S3().keys(f"intake/{b.eid}/") == []


def test_dp16_measured_dimensions(app_url: str) -> None:
    q = 0.38268343236508984
    w = 0.9238795325112867
    cube = ([-0.05, -0.05, -0.05], [0.05, 0.05, 0.05])
    cases = [
        ("rotated_parent", glb(*cube, nodes=[{"children": [1], "rotation": [0, q, 0, w]}, {"mesh": 0}]), (0.1414, 0.1, 0.1414)),
        ("matrix_scale", glb(*cube, nodes=[{"mesh": 0, "matrix": [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 5, 5, 1]}]), (0.2, 0.2, 0.2)),
        ("shared_mesh", glb(*cube, nodes=[{"children": [1, 2]}, {"mesh": 0}, {"mesh": 0, "translation": [1, 0, 0]}]), (1.1, 0.1, 0.1)),
        ("unreachable", glb(*cube, nodes=[{"mesh": 0}, {"mesh": 0, "translation": [50, 0, 0]}]), (0.1, 0.1, 0.1)),
        ("ancestor_scale", glb(*cube, nodes=[{"children": [1], "scale": [3, 1, 1]}, {"mesh": 0, "translation": [0, 2, 0]}]), (0.3, 0.1, 0.1)),
    ]
    for label, data, (x, y, z) in cases:
        b = start(app_url)
        r = upload(b, f"{label}.glb", data)
        assert r.status_code == 201, f"{label}: {r.text[:200]}"
        got = wait_measurement(b, r.json()["id"])
        dm = got["dimensions_m"]
        for axis, want in zip("xyz", (x, y, z)):
            assert abs(dm[axis] - want) <= 0.0006, f"{label}: dimensions_m.{axis} {dm[axis]}, expected about {want}"
            assert abs(got["dimensions_mm"][axis] - want * 1000) <= 0.6
        assert got["unit"] == "as_exported" and got["needs_unit_confirmation"] is False


def test_dp17_unit_confirmation(app_url: str) -> None:
    b = start(app_url)
    r = upload(b, "mm.glb", glb_millimetres())
    got = wait_measurement(b, r.json()["id"])
    assert got["needs_unit_confirmation"] is True
    assert abs(got["dimensions_m"]["x"] - 180) < 0.01
    unit = b.http.put(f"/api/engagements/{b.eid}/files/{got['id']}/unit", json={"unit": "mm"})
    assert unit.status_code == 200
    body = unit.json()
    assert body["unit"] == "mm" and body["needs_unit_confirmation"] is False
    for axis, want in zip("xyz", (180, 210, 85)):
        assert abs(body["dimensions_mm"][axis] - want) < 0.01
    assert file_of(b, got["id"])["unit"] == "mm"
    cm = b.http.put(f"/api/engagements/{b.eid}/files/{got['id']}/unit", json={"unit": "cm"}).json()
    assert abs(cm["dimensions_mm"]["x"] - 1800) < 0.1
    assert_error(b.http.put(f"/api/engagements/{b.eid}/files/{got['id']}/unit", json={"unit": "ft"}), "validation_failed", "unit", FIELD["unit"])
    pdf = upload(b, "sheet.pdf", pdf_bytes()).json()
    assert_error(b.http.put(f"/api/engagements/{b.eid}/files/{pdf['id']}/unit", json={"unit": "mm"}), "validation_failed", "unit", FIELD["unit_non_glb"])
    for size, needs in [((5, 1, 1), False), ((0.004, 0.003, 0.002), True), ((0.005, 0.001, 0.001), False)]:
        e = start(app_url)
        f = wait_measurement(e, upload(e, "edge.glb", glb([0, 0, 0], list(size))).json()["id"])
        assert f["needs_unit_confirmation"] is needs, f"{size}: needs_unit_confirmation {f['needs_unit_confirmation']}"
        if not needs:
            assert f["unit"] == "as_exported"


def test_dp18_unit_dialog_keyboard(browser: Browser, app_url: str) -> None:
    b = start(app_url)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        page.get_by_label("Product files").set_input_files([{"name": "mm.glb", "mimeType": "model/gltf-binary", "buffer": glb_millimetres()}])
        dialog = page.get_by_role("dialog", name="Check the export unit")
        eventually(page, lambda: dialog.is_visible(), "unit dialog opened on its own", seconds=MEASURE_DEADLINE, step=2000)
        assert is_focused(page.get_by_role("radiogroup", name="Export unit"))
        for _ in range(DIALOG_TAB_PRESSES):
            page.keyboard.press("Tab")
            assert is_focused(dialog), "Tab left the dialog (L337)"
        for _ in range(DIALOG_TAB_PRESSES):
            page.keyboard.press("Shift+Tab")
            assert is_focused(dialog), "Shift+Tab left the dialog (L337)"
        page.keyboard.press("Escape")
        advance(page, 400)
        assert not dialog.is_visible()
        row = page.get_by_role("list", name="Intake files").get_by_role("listitem").filter(has_text="mm.glb")
        assert is_focused(row)
        opener = row.get_by_role("button", name="Check unit")
        opener.focus()
        page.keyboard.press("Enter")
        advance(page, 400)
        assert dialog.is_visible()
        page.keyboard.press("Escape")
        advance(page, 400)
        assert focused_is(opener)


def test_dp62_quantized_bounds(app_url: str) -> None:
    b = start(app_url)
    got = wait_measurement(b, upload(b, "quantized.glb", glb_quantized()).json()["id"])
    for axis, want in zip("xyz", (0.18, 0.21, 0.085)):
        assert abs(got["dimensions_m"][axis] - want) <= 0.0001
    assert got["needs_unit_confirmation"] is False and got["unit"] == "as_exported"
    d = start(app_url)
    draco = glb([0, 0, 0], [0.12, 0.2, 0.05], required=["KHR_draco_mesh_compression"], used=["KHR_draco_mesh_compression"])
    dg = wait_measurement(d, upload(d, "draco.glb", draco).json()["id"])
    assert abs(dg["dimensions_m"]["y"] - 0.2) <= 0.0001
    for label, data in [("missing_used", glb([0, 0, 0], [0.1, 0.1, 0.1], required=["KHR_mesh_quantization"], used=[])),
                        ("unsupported", glb([0, 0, 0], [0.1, 0.1, 0.1], required=["KHR_materials_variants"], used=["KHR_materials_variants"]))]:
        e = start(app_url)
        assert_error(upload(e, f"{label}.glb", data), "gltf_malformed")
        assert engagement(e)["files"] == []


def test_dp80_queued_measurement(browser: Browser, app_url: str, rabbitmq: Any) -> None:
    queues = rabbitmq.queues()
    assert queues.get("intake.measure", {}).get("durable") is True
    b = start(app_url)
    good = upload(b, "good.glb", glb_product()).json()
    wait_measurement(b, good["id"])
    bad = upload(b, "broken.glb", glb_unmeasurable())
    assert bad.status_code == 201
    failed = wait_measurement(b, bad.json()["id"], want="failed")
    assert failed["status"] == "received"
    assert rabbitmq.queues().get("intake.measure.dead", {}).get("durable") is True

    def dead() -> dict[str, Any] | None:
        for m in rabbitmq.peek("intake.measure.dead", 200):
            payload = m.get("payload")
            data = json.loads(payload) if isinstance(payload, str) else payload
            if isinstance(data, dict) and data.get("intake_file_id") == bad.json()["id"]:
                return m
        return None
    msg = poll(dead, MEASURE_DEADLINE, "failed GLB's message never reached intake.measure.dead")
    assert msg.get("properties", {}).get("delivery_mode") == 2
    assert file_of(b, good["id"])["measurement"] == "measured"
    with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=cookie_map(b.http)) as page:
        row = page.get_by_role("list", name="Intake files").get_by_role("listitem").filter(has_text="broken.glb")
        eventually(page, lambda: "Rejected" in plain_text(row), "failed GLB row shows Rejected")


def test_wf_scale_check_millimetre_export(browser: Browser, app_url: str) -> None:
    b = start(app_url)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        record_text(page.get_by_role("status", name="Upload progress"), "upload")
        page.get_by_label("Product files").set_input_files([{"name": "mm.glb", "mimeType": "model/gltf-binary", "buffer": glb_millimetres()}])
        dialog = page.get_by_role("dialog", name="Check the export unit")
        eventually(page, lambda: dialog.is_visible(), "unit dialog opened", seconds=MEASURE_DEADLINE, step=2000)
        assert f"{180:.3f} × {210:.3f} × {85:.3f} m" in plain_text(dialog)
        file_name = "mm.glb"
        assert f"Check the export unit for {file_name}." in announced(page, "upload")
        click(dialog.get_by_role("radio", name="Millimetres"))
        click(dialog.get_by_role("button", name="Use this unit"))
        scale = page.get_by_role("region", name="Product scale")
        eventually(page, lambda: MM_READOUT in plain_text(scale) and IN_READOUT in plain_text(scale), "readout rescaled to millimetres")
        eventually(page, lambda: f"Measurement complete: {MM_READOUT} · {IN_READOUT}." in announced(page, "upload"), "measurement announcement after the unit decision")
    f = next(x for x in engagement(b)["files"] if x["name"] == "mm.glb")
    assert f["unit"] == "mm" and abs(f["dimensions_mm"]["z"] - 85) < 0.01


def test_wf_scale_check_quantized(browser: Browser, app_url: str) -> None:
    b = start(app_url)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        page.get_by_label("Product files").set_input_files([{"name": "quantized.glb", "mimeType": "model/gltf-binary", "buffer": glb_quantized()}])
        scale = page.get_by_role("region", name="Product scale")
        eventually(page, lambda: MM_READOUT in plain_text(scale), "quantized model readout", seconds=MEASURE_DEADLINE, step=2000)
        assert not page.get_by_role("dialog", name="Check the export unit").is_visible()
    f = engagement(b)["files"][0]
    assert f["measurement"] == "measured" and f["needs_unit_confirmation"] is False


def rig_page_ready(page: Page) -> None:
    eventually(page, lambda: rig(page).get_attribute("data-quote-revision") is not None
               or page.get_by_role("region", name="Quote").get_attribute("data-quote-revision") is not None,
               "rig showed its first quote reply")


def test_dp20_selection_sequence(browser: Browser, app_url: str) -> None:
    b = ready(app_url, lines={})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        g = rig(page)
        record_attr(g, "data-rig-phase")
        click(shot_box(page, "hero_front"))
        for _ in range(int(3000 / STEP_MS)):
            advance(page, STEP_MS)
        log = recorded(page, "data-rig-phase")
        phases = [p for p, _ in log]
        assert [p for p in phases if p != "idle"][:4] == ["flying", "focusing", "cut", "counting"], f"selection phases {phases}"
        at = {p: t for p, t in reversed(log)}
        fly = at["focusing"] - at["flying"]
        focus = at["cut"] - at["focusing"]
        assert FLY_MIN_MS - TIMING_SLACK_MS <= fly <= FLY_MAX_MS + TIMING_SLACK_MS, f"flying lasted {fly} ms"
        assert FOCUS_MIN_MS - TIMING_SLACK_MS <= focus <= FOCUS_MAX_MS + TIMING_SLACK_MS, f"focusing lasted {focus} ms"
        idle_after = [t for p, t in log if p == "idle" and t > at["counting"]]
        assert idle_after and idle_after[0] - at["counting"] <= COUNT_MAX_MS + TIMING_SLACK_MS
        assert g.get_attribute("data-frustum-count") == "1"
        assert page.get_by_role("figure", name="Camera view").get_attribute("data-pip-shot") == "hero_front"
        record_attr(g, "data-rig-phase")
        record_attr(g, "data-frustum-count")
        click(shot_box(page, "hero_front"))
        for _ in range(int(3000 / STEP_MS)):
            advance(page, STEP_MS)
        phases = [p for p, _ in recorded(page, "data-rig-phase") if p != "idle"]
        assert phases[:4] == ["counting", "cut", "focusing", "flying"], f"deselection phases {phases}"
        fly_end = [t for p, t in recorded(page, "data-rig-phase") if p == "flying"][-1]
        drop = [t for v, t in recorded(page, "data-frustum-count") if v == "0"]
        assert drop and drop[0] >= fly_end, "frustum count dropped before the frustum flew out"
        assert page.get_by_role("figure", name="Camera view").get_attribute("data-pip-shot") == "overview"


def test_dp21_rig_keyboard(browser: Browser, app_url: str) -> None:
    b = ready(app_url, lines={"hero_front": 1})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        g = rig(page)
        page.get_by_role("button", name="Upload files").focus()
        names = tab_order(page, 4)
        assert names[0] == "Shot Rig" and names[1] == "Hero front" and names[2] == "Colourways for Hero front", names
        assert "Pay deposit" in tab_order(page, 12)
        g.focus()
        start_shot = g.get_attribute("data-focused-shot")
        idx = SHOT_ORDER.index(start_shot) if start_shot in SHOT_ORDER else 0
        page.keyboard.press("ArrowRight")
        nxt = SHOT_ORDER[(idx + 1) % 6]
        assert g.get_attribute("data-focused-shot") == nxt
        az, el = ANGLES[nxt]
        assert plain_text(page.get_by_role("status", name="Rig focus")).strip() == f"{TITLES[nxt]}, azimuth {az}°, elevation {el}°, not selected"
        for _ in range(idx + 1):
            page.keyboard.press("ArrowLeft")
        assert g.get_attribute("data-focused-shot") == "hero_front"
        assert plain_text(page.get_by_role("status", name="Rig focus")).strip() == "Hero front, azimuth 0°, elevation 5°, selected"
        page.keyboard.press("ArrowLeft")
        assert g.get_attribute("data-focused-shot") == "exploded_view", "Left from the first station did not wrap"
        page.keyboard.press(" ")
        eventually(page, lambda: shot_box(page, "exploded_view").is_checked(), "Space selected the focused shot")
        eventually(page, lambda: any(line["shot_code"] == "exploded_view" for line in engagement(b)["quote"]["lines"]), "Space wrote the quote line")
        g.focus()
        page.keyboard.press("Tab")
        assert focused_is(shot_box(page, "hero_front"))
        box = g.bounding_box()
        assert box

        def drag() -> None:
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx + DRAG_PX, cy, steps=8)
            page.mouse.up()
            advance(page, 200)
            assert g.get_attribute("data-orbit-azimuth") != "0", "mouse drag did not orbit"
        drag()
        g.focus()
        page.keyboard.press("r")
        advance(page, 1000)
        assert g.get_attribute("data-orbit-azimuth") == "0"
        drag()
        page.get_by_role("spinbutton", name="Colourways for Hero front").focus()
        before = g.get_attribute("data-orbit-azimuth")
        page.keyboard.press("r")
        advance(page, 1000)
        assert g.get_attribute("data-orbit-azimuth") == before, "R acted from a spinbutton"
        page.get_by_role("button", name="Pay deposit").focus()
        page.keyboard.press("r")
        advance(page, 1000)
        assert g.get_attribute("data-orbit-azimuth") == "0"


def test_dp22_rig_reduced_motion(browser: Browser, app_url: str) -> None:
    b = ready(app_url, lines={})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http), reduced=True) as page:
        rig_page_ready(page)
        g = rig(page)
        record_attr(g, "data-rig-phase")
        click(shot_box(page, "three_quarter"))
        eventually(page, lambda: g.get_attribute("data-frustum-count") == "1", "frustum in place", step=STEP_MS)
        assert {p for p, _ in recorded(page, "data-rig-phase")} == {"idle"}
        assert page.get_by_role("figure", name="Camera view").get_attribute("data-pip-shot") == "three_quarter"
        g.focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press(" ")
        eventually(page, lambda: g.get_attribute("data-frustum-count") == "2", "Space selected under reduced motion", step=STEP_MS)
    assert len(engagement(b)["quote"]["lines"]) == 2


def test_dp23_touch_and_no_webgl(browser: Browser, app_url: str) -> None:
    b = ready(app_url, lines={})
    cookies = cookie_map(b.http)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookies, size=PHONE) as page:
        rig_page_ready(page)
        g = rig(page)
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        g.scroll_into_view_if_needed()
        box = g.bounding_box()
        assert box
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        az0 = g.get_attribute("data-orbit-azimuth")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx - 60, "y": cy}]})
        for i in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": cx - 60 + 15 * i, "y": cy + i}]})
            advance(page, 16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        advance(page, 200)
        az1 = g.get_attribute("data-orbit-azimuth")
        assert az1 != az0, "horizontal one-finger drag did not orbit"
        y0 = page.evaluate("() => window.scrollY")
        start_y, travel = cy + SWIPE_SPAN * box["height"] / 2, SWIPE_SPAN * box["height"]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx, "y": start_y}]})
        for i in range(1, SWIPE_STEPS + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": cx, "y": start_y - travel * i / SWIPE_STEPS}]})
            advance(page, 16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        advance(page, 200)
        assert page.evaluate("() => window.scrollY") > y0, "vertical swipe over the rig did not scroll the page"
        assert g.get_attribute("data-orbit-azimuth") == az1, "vertical swipe orbited the model"
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookies, no_webgl=True) as page:
        rig_page_ready(page)
        g = rig(page)
        assert g.get_attribute("data-webgl") == "off"
        click(shot_box(page, "top_down"))
        eventually(page, lambda: g.get_attribute("data-frustum-count") == "1", "no-WebGL rig counted the selected station")
        g.focus()
        page.keyboard.press("ArrowRight")
        assert g.get_attribute("data-focused-shot") in SHOT_ORDER
    assert [line["shot_code"] for line in engagement(b)["quote"]["lines"]] == ["top_down"]


def test_dp24_rig_layout(browser: Browser, app_url: str) -> None:
    b = ready(app_url)
    cookies = cookie_map(b.http)
    for size in (DESKTOP, TABLET, PHONE):
        with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookies, size=size) as page:
            rig_page_ready(page)
            layout_ok(page)
            g = rig(page).bounding_box()
            shots = page.get_by_role("list", name="Shots").bounding_box()
            assert g and shots
            if size == DESKTOP:
                assert shots["x"] + shots["width"] <= g["x"] + 1, "shot list is not left of the canvas at 1280"
            else:
                assert g["y"] + g["height"] <= shots["y"] + 1, f"canvas is not above the shot list at {size[0]}"
            assert page.get_by_role("button", name="Pay deposit").count() == 1
            if size == PHONE:
                assert g["height"] <= size[1] / 2 + 1
                for y in (0, 100_000):
                    page.evaluate("y => window.scrollTo({top: y, left: 0, behavior: 'instant'})", y)
                    advance(page, 100)
                    pay_box = page.get_by_role("button", name="Pay deposit").bounding_box()
                    assert pay_box and 0 <= pay_box["y"] and pay_box["y"] + pay_box["height"] <= size[1], "Pay deposit left the viewport on phone"


def test_dp25_shot_list_matches_quote(browser: Browser, app_url: str) -> None:
    b = ready(app_url, lines={})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        for code in ("hero_front", "detail_macro", "exploded_view"):
            click(shot_box(page, code))
            advance(page, 1500)
        fill(spin(page, "detail_macro"), "3")
        page.keyboard.press("Enter")
        eventually(page, lambda: rig(page).get_attribute("data-frustum-count") == "3"
                   and {(x["shot_code"], x["quantity"]) for x in engagement(b)["quote"]["lines"]} == {("hero_front", 1), ("detail_macro", 3), ("exploded_view", 1)},
                   "rig settled on three shots")
        api = engagement(b)["quote"]
        eventually(page, lambda: page.get_by_role("region", name="Quote").get_attribute("data-quote-revision") == str(api["revision"]), "rig shows the last reply")
        rows = [plain_text(x) for x in page.get_by_role("table", name="Shot positions").get_by_role("row").all()][1:]
        assert len(rows) == 6
        for code, row in zip(SHOT_ORDER, rows):
            selected = code in {line["shot_code"] for line in api["lines"]}
            assert row.split()[-1] == ("Yes" if selected else "No"), f"{code} row: {row!r}"
            assert shot_box(page, code).is_checked() is selected
        assert quote_values(page) == figures(api)
    assert_error(put_line(b, "hero_front", 7), "validation_failed", "quantity", FIELD["quantity"])
    assert_error(put_line(b, "hero_front", 0), "validation_failed", "quantity", FIELD["quantity"])
    assert_error(put_line(b, "no_such_shot", 1), "not_found")


def test_dp31_live_quote_updates(browser: Browser, app_url: str) -> None:
    from conftest import held
    b = ready(app_url, lines={})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        page.evaluate("() => window.__verifierMarker = 1")
        url = page.url
        region = page.get_by_role("region", name="Quote")
        click(shot_box(page, "hero_front"))
        status = page.get_by_role("status", name="Quote updates")
        eventually(page, lambda: plain_text(status).strip() == "Quote updated: total £540.00, deposit £216.00.", "first quote announcement")
        assert quote_values(page) == figures(engagement(b)["quote"])
        shown = quote_values(page)
        with held(page, "**/quote/lines/hero_front") as h:
            spin = page.get_by_role("spinbutton", name="Colourways for Hero front")
            spin.focus()
            page.keyboard.press("ArrowUp")
            eventually(page, lambda: region.get_attribute("aria-busy") == "true", "quote region marked busy while the change waits")
            assert quote_values(page) == shown, "figures changed before the server replied"
            h.release()
        eventually(page, lambda: plain_text(status).strip() == "Quote updated: total £1,080.00, deposit £432.00.", "second quote announcement")
        assert quote_values(page) == figures(engagement(b)["quote"])
        assert page.url == url and page.evaluate("() => window.__verifierMarker") == 1, "quote change reloaded the page"


def test_dp71_latest_quote_wins(browser: Browser, app_url: str) -> None:
    b = ready(app_url, lines={})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        region = page.get_by_role("region", name="Quote")
        status = page.get_by_role("status", name="Quote updates")
        record_text(status, "quote")
        held_replies: list[Any] = []

        def hold(route: Any) -> None:
            held_replies.append((route, route.fetch()))
        page.route("**/quote/lines/three_quarter", hold)
        click(shot_box(page, "three_quarter"))
        eventually(page, lambda: len(held_replies) == 1, "three-quarter change reached the server")
        click(shot_box(page, "hero_front"))
        eventually(page, lambda: region.get_attribute("data-quote-revision") == str(engagement(b)["quote"]["revision"]), "newer reply applied")
        shown = region.get_attribute("data-quote-revision")
        notes = len(announced(page, "quote"))
        route, resp = held_replies[0]
        route.fulfill(response=resp)
        advance(page, 1500)
        assert region.get_attribute("data-quote-revision") == shown, "an older reply replaced a newer one"
        assert len(announced(page, "quote")) == notes, "an ignored late reply was announced"
        page.unroute("**/quote/lines/three_quarter")
        assert put_line(b, "detail_macro", 2, http=clone(b.http)).status_code == 200
        hero_spin = page.get_by_role("spinbutton", name="Colourways for Hero front")
        hero_spin.focus()
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: region.get_attribute("data-quote-revision") == str(engagement(b)["quote"]["revision"]), "reply after the other-session write applied")
        advance(page, 3000)
        api = engagement(b)["quote"]
        assert shot_box(page, "detail_macro").is_checked()
        assert spin(page, "detail_macro").input_value() == "2"
        assert rig(page).get_attribute("data-frustum-count") == "3"
        assert quote_values(page) == figures(api)
        total, dep = api["total_minor"], api["milestones"]["deposit_minor"]
        assert plain_text(status).strip() == f"Quote updated: total {money(total, 'GBP')}, deposit {money(dep, 'GBP')}."


def test_wf_shot_rig_build_list(browser: Browser, app_url: str) -> None:
    b = ready(app_url, currency="USD", lines={})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        for code in ("hero_front", "three_quarter", "turntable_360"):
            click(shot_box(page, code))
            advance(page, 1500)
        fill(spin(page, "turntable_360"), "2")
        page.keyboard.press("Enter")
        advance(page, 1500)
        click(shot_box(page, "three_quarter"))
        eventually(page, lambda: rig(page).get_attribute("data-frustum-count") == "2", "two frustums after deselecting Three-quarter")
        eventually(page, lambda: [(x["shot_code"], x["quantity"]) for x in engagement(b)["quote"]["lines"]] == [("hero_front", 1), ("turntable_360", 2)], "API quote matches the choice")
        rate = engagement(b)["quote"]["fx_rate"]
        want = expected_quote({"hero_front": 1, "turntable_360": 2}, rate, "USD")
        api = engagement(b)["quote"]
        assert api["total_minor"] == want["total"]
        eventually(page, lambda: quote_values(page) == figures(api), "rig figures match the API quote")
        assert plain_text(page.get_by_role("status", name="Quote updates")).strip() == f"Quote updated: total {money(want['total'], 'USD')}, deposit {money(want['deposit'], 'USD')}."


def test_wf_shot_rig_colourway_burst(browser: Browser, app_url: str) -> None:
    from conftest import held
    b = ready(app_url, lines={"turntable_360": 1})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        turntable = spin(page, "turntable_360")
        with held(page, "**/quote/lines/turntable_360") as h:
            turntable.focus()
            for _ in range(3):
                page.keyboard.press("ArrowUp")
            h.release()
        eventually(page, lambda: next((line["quantity"] for line in engagement(b)["quote"]["lines"]), 0) == 4, "server quote settled on four colourways")
        eventually(page, lambda: turntable.input_value() == "4" and page.get_by_role("region", name="Quote").get_attribute("data-quote-revision") == str(engagement(b)["quote"]["revision"]), "rig settled on four")
        assert quote_values(page) == figures(engagement(b)["quote"])


def test_dp28_studio_list_prices(app_url: str) -> None:
    pb = PocketBase()
    rec = pb.records("services", "code='top_down'")
    assert rec and rec[0]["title"] == TITLES["top_down"] and rec[0]["list_price_pence"] == PRICES["top_down"]
    f = founder(app_url)
    b = start(app_url)
    q = put_line(b, "top_down", 2).json()
    assert q["lines"][0]["title"] == TITLES["top_down"] and q["lines"][0]["amount_minor"] == PRICES["top_down"] * 2
    revision = q["revision"]
    new_title = f"{TITLES['top_down']} {uuid.uuid4().hex[:6]}"
    new_price = PRICES["top_down"] + 1000
    try:
        assert_error(f.patch("/api/studio/services/top_down", json={"title": "x" * 61}), "validation_failed", "title", FIELD["service_title"])
        assert_error(f.patch("/api/studio/services/top_down", json={"list_price_pence": 0}), "validation_failed", "list_price_pence", FIELD["list_price_pence"])
        r = f.patch("/api/studio/services/top_down", json={"title": new_title, "list_price_pence": new_price})
        assert r.status_code == 200 and r.json()["title"] == new_title
        rec = pb.records("services", "code='top_down'")[0]
        assert rec["title"] == new_title and rec["list_price_pence"] == new_price
        line = engagement(b)["quote"]["lines"][0]
        assert line["title"] == new_title and line["unit_price_gbp_minor"] == new_price and line["amount_minor"] == new_price * 2
        assert engagement(b)["quote"]["revision"] == revision
    finally:
        f.patch("/api/studio/services/top_down", json={"title": TITLES["top_down"], "list_price_pence": PRICES["top_down"]})


def test_dp29_conversion_and_vat(app_url: str) -> None:
    usd = ready(app_url, "USD", {"hero_front": 1})
    q = engagement(usd)["quote"]
    assert q["fx_rate"] == SEED_RATES["USD"]
    assert [line["amount_minor"] for line in q["lines"]] == [57263]
    assert (q["subtotal_minor"], q["vat_minor"], q["total_minor"]) == (57263, 11453, 68716)
    eur = ready(app_url, "EUR", {"hero_front": 1, "turntable_360": 2})
    q = engagement(eur)["quote"]
    assert [line["amount_minor"] for line in q["lines"]] == [52425, 337850]
    assert (q["subtotal_minor"], q["vat_minor"], q["total_minor"]) == (390275, 78055, 468330)
    gbp = ready(app_url, "GBP", {"detail_macro": 3, "top_down": 1})
    q = engagement(gbp)["quote"]
    assert q["fx_rate"] == "1.0000" and [line["shot_code"] for line in q["lines"]] == ["top_down", "detail_macro"]
    want = expected_quote({"detail_macro": 3, "top_down": 1}, "1.0000", "GBP")
    assert (q["subtotal_minor"], q["vat_minor"], q["total_minor"]) == (want["subtotal"], want["vat"], want["total"])


def test_dp30_milestone_split(app_url: str) -> None:
    usd = ready(app_url, "USD", {"hero_front": 1})
    m = engagement(usd)["quote"]["milestones"]
    assert (m["deposit_minor"], m["look_dev_minor"], m["final_delivery_minor"]) == (27486, 20614, 20616)
    for qty in (1, 2, 3, 5):
        assert put_line(usd, "detail_macro", qty).status_code == 200
        q = engagement(usd)["quote"]
        t = q["total_minor"]
        m = q["milestones"]
        assert m["deposit_minor"] == t * 40 // 100 and m["look_dev_minor"] == t * 30 // 100
        assert m["deposit_minor"] + m["look_dev_minor"] + m["final_delivery_minor"] == t
    e = start(app_url)
    q = engagement(e)["quote"]
    assert q["total_minor"] == 0 and q["milestones"] == {"deposit_minor": 0, "look_dev_minor": 0, "final_delivery_minor": 0}


def rates_restore(f: httpx.Client, currency: str, rate: str) -> None:
    f.post("/api/studio/fx-rates", json={"currency": currency, "rate": rate})


def test_dp32_locked_fx_rate(app_url: str) -> None:
    short = outage("APP_SHORT_URL")
    f = founder(short)
    before = next(r for r in f.get("/api/studio/fx-rates").json()["rates"] if r["currency"] == "EUR")["rate"]
    assert_error(f.post("/api/studio/fx-rates", json={"currency": "GBP", "rate": "1.0000"}), "validation_failed", "currency", FIELD["currency_rate"])
    assert_error(f.post("/api/studio/fx-rates", json={"currency": "EUR", "rate": "0.00001"}), "validation_failed", "rate", FIELD["rate"])
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    assert_error(f.post("/api/studio/fx-rates", json={"currency": "EUR", "rate": "1.2000", "effective_at": past}), "validation_failed", "effective_at", FIELD["effective_at"])
    locked = paid(short, "EUR", {"hero_front": 1})
    open_quote = ready(short, "EUR", {"hero_front": 1})
    lq = engagement(locked)["quote"]
    assert lq["fx_locked"] is True and lq["fx_rate"] == before and lq["fx_locked_at"]
    new_rate = "1.3333"
    try:
        r = f.post("/api/studio/fx-rates", json={"currency": "EUR", "rate": new_rate})
        assert r.status_code == 201 and r.json()["rate"] == new_rate
        assert next(x for x in f.get("/api/studio/fx-rates").json()["rates"] if x["currency"] == "EUR")["rate"] == new_rate
        oq = engagement(open_quote)["quote"]
        assert oq["fx_rate"] == new_rate and oq["fx_locked"] is False
        assert oq["lines"][0]["amount_minor"] == expected_quote({"hero_front": 1}, new_rate, "EUR")["line:hero_front"]
        lq2 = engagement(locked)["quote"]
        assert lq2["fx_rate"] == before and lq2["total_minor"] == lq["total_minor"]
        inv = issued_look_dev(locked, f)
        share = next(line for line in inv["lines"] if line["description"] == f"Look-dev {locked.reference}")
        assert share["amount_minor"] == lq["milestones"]["look_dev_minor"]
    finally:
        rates_restore(f, "EUR", before)


def test_dp63_scheduled_rates(app_url: str) -> None:
    short = outage("APP_SHORT_URL")
    f = founder(short)
    before = next(r for r in f.get("/api/studio/fx-rates").json()["rates"] if r["currency"] == "JPY")["rate"]
    locked = paid(short, "JPY", {"hero_front": 1})
    open_quote = ready(short, "JPY", {"hero_front": 1})
    new_rate = "199.5000"
    when = datetime.now(timezone.utc) + timedelta(seconds=10)
    try:
        r = f.post("/api/studio/fx-rates", json={"currency": "JPY", "rate": new_rate, "effective_at": when.isoformat().replace("+00:00", "Z")})
        assert r.status_code == 201
        listed = f.get("/api/studio/fx-rates").json()
        assert any(s["currency"] == "JPY" and s["rate"] == new_rate for s in listed["scheduled"])
        assert next(x for x in listed["rates"] if x["currency"] == "JPY")["rate"] == before
        assert engagement(open_quote)["quote"]["fx_rate"] == before
        poll(lambda: datetime.now(timezone.utc) > when + timedelta(seconds=1), SCHEDULE_WAIT_S, "waiting for the scheduled rate's effective time")
        q = engagement(open_quote)["quote"]
        assert q["fx_rate"] == new_rate
        assert q["lines"][0]["amount_minor"] == expected_quote({"hero_front": 1}, new_rate, "JPY")["line:hero_front"]
        assert engagement(locked)["quote"]["fx_rate"] == before
        assert not any(s["rate"] == new_rate for s in f.get("/api/studio/fx-rates").json()["scheduled"])
    finally:
        rates_restore(f, "JPY", before)


def test_dp61_zero_decimal_yen(app_url: str, mail: Any, killbill: Any) -> None:
    b = ready(app_url, "JPY", {"hero_front": 1})
    q = engagement(b)["quote"]
    assert q["exponent"] == 0 and q["fx_rate"] == SEED_RATES["JPY"]
    assert [line["amount_minor"] for line in q["lines"]] == [92438]
    assert (q["vat_minor"], q["total_minor"]) == (18488, 110926)
    m = q["milestones"]
    assert (m["deposit_minor"], m["look_dev_minor"], m["final_delivery_minor"]) == (44370, 33277, 33279)
    assert deposit(b).status_code == 201
    acct = kb_account(killbill, b.brand_id)
    assert acct and acct["currency"] == "JPY"
    purchases = kb_transactions(killbill, acct["accountId"], "PURCHASE")
    assert len(purchases) == 1 and Decimal(str(purchases[0]["amount"])) == Decimal(44370)
    items = [i for inv in killbill.invoices(acct["accountId"]) for i in inv.get("items", [])]
    assert any(i["description"] == f"Deposit {b.reference}" and Decimal(str(i["amount"])) == Decimal(44370) for i in items)
    body = text(inbox(mail, b.finance, f"Deposit receipt: {b.reference}")[0])
    assert "¥44,370" in body and "¥110,926" in body
    assert not re.search(r"¥[\d,]+\.\d", body), "a yen amount carried decimals in the receipt email"


def test_dp73_renamed_shots_keep_history(app_url: str) -> None:
    f = founder(app_url)
    locked = paid(app_url, lines={"detail_macro": 1})
    open_quote = ready(app_url, lines={"detail_macro": 1})
    new_title = f"{TITLES['detail_macro']} {uuid.uuid4().hex[:6]}"
    new_price = PRICES["detail_macro"] + 1000
    try:
        assert f.patch("/api/studio/services/detail_macro", json={"title": new_title, "list_price_pence": new_price}).status_code == 200
        lq = engagement(locked)["quote"]["lines"][0]
        assert lq["title"] == TITLES["detail_macro"] and lq["unit_price_gbp_minor"] == PRICES["detail_macro"]
        oq = engagement(open_quote)["quote"]["lines"][0]
        assert oq["title"] == new_title and oq["unit_price_gbp_minor"] == new_price
        token = token_of(send_for_review(locked, f)["review_url"])
        with reviewer(app_url) as r:
            stills = r.get(f"/api/review/{token}").json()["stills"]
        assert [s["title"] for s in stills] == [TITLES["detail_macro"]]
    finally:
        f.patch("/api/studio/services/detail_macro", json={"title": TITLES["detail_macro"], "list_price_pence": PRICES["detail_macro"]})


def test_wf_quote_pricing_yen_rig(browser: Browser, app_url: str) -> None:
    b = ready(app_url, "JPY", {})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        click(shot_box(page, "hero_front"))
        status = page.get_by_role("status", name="Quote updates")
        want = expected_quote({"hero_front": 1}, SEED_RATES["JPY"], "JPY")
        assert money(want["total"], "JPY") == "¥110,926" and money(want["deposit"], "JPY") == "¥44,370"
        eventually(page, lambda: plain_text(status).strip() == f"Quote updated: total {money(want['total'], 'JPY')}, deposit {money(want['deposit'], 'JPY')}.", "yen announcement")
        region = page.get_by_role("region", name="Quote")
        advance(page, 2000)
        assert quote_values(page) == sorted([want["line:hero_front"], want["vat"], want["total"], want["deposit"], want["look_dev"], want["final"]])
        txt = plain_text(region)
        assert "¥110,926" in txt and f"Indicative at {SEED_RATES['JPY']} per £1." in txt
        assert not re.search(r"¥[\d,]+\.\d", txt)
    assert engagement(b)["quote"]["total_minor"] == want["total"]


def test_wf_quote_pricing_euro_rig(browser: Browser, app_url: str) -> None:
    b = ready(app_url, "EUR", {"turntable_360": 2})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        click(shot_box(page, "hero_front"))
        want = expected_quote({"hero_front": 1, "turntable_360": 2}, SEED_RATES["EUR"], "EUR")
        assert money(want["total"], "EUR") == "€4,683.30" and money(want["deposit"], "EUR") == "€1,873.32"
        eventually(page, lambda: plain_text(page.get_by_role("status", name="Quote updates")).strip() == f"Quote updated: total {money(want['total'], 'EUR')}, deposit {money(want['deposit'], 'EUR')}.", "euro announcement")
        rows = [plain_text(x) for x in page.get_by_role("table", name="Shot positions").get_by_role("row").all()][1:]
        assert "£450.00" in rows[0] and "45°" in rows[1] and money(PRICES["turntable_360"], "GBP") in rows[4]
        assert f"Indicative at {SEED_RATES['EUR']} per £1." in plain_text(page.get_by_role("region", name="Quote"))
    assert engagement(b)["quote"]["total_minor"] == want["total"]


def test_dp33_deposit_payment(app_url: str, mail: Any, killbill: Any) -> None:
    b = ready(app_url, "EUR", {"hero_front": 1, "turntable_360": 2})
    r = deposit(b)
    assert r.status_code == 201, r.text[:300]
    body = r.json()
    inv, entry = body["invoice"], body["ledger_entry"]
    assert body["engagement"]["state"] == "deposit_paid"
    dep = expected_quote({"hero_front": 1, "turntable_360": 2}, SEED_RATES["EUR"], "EUR")["deposit"]
    assert money(dep, "EUR") == "€1,873.32"
    assert inv["milestone"] == "deposit" and inv["status"] == "paid" and inv["amount_minor"] == dep and inv["balance_minor"] == 0
    assert inv["lines"] == [{"description": f"Deposit {b.reference}", "amount_minor": dep}]
    assert entry["kind"] == "deposit" and entry["amount_minor"] == dep and entry["currency"] == "EUR"
    eng = engagement(b)
    assert [i["milestone"] for i in eng["invoices"]][0] == "deposit" and len(eng["ledger"]) == 1
    acct = kb_account(killbill, b.brand_id)
    assert acct and acct["currency"] == "EUR" and acct["name"] == b.name and acct["email"] == b.finance
    purchases = kb_transactions(killbill, acct["accountId"], "PURCHASE")
    assert len(purchases) == 1 and kb_minor(purchases[0]["amount"], "EUR") == dep
    assert purchases[0]["paymentId"] == entry["killbill_payment_id"]
    kb_invs = killbill.invoices(acct["accountId"])
    assert [str(i["invoiceNumber"]) for i in kb_invs] == [str(inv["number"])]
    assert Decimal(str(kb_invs[0]["balance"])) == 0
    msgs = inbox(mail, b.finance, f"Deposit receipt: {b.reference}")
    assert len(settled_inbox(mail, b.finance, f"Deposit receipt: {b.reference}")) == 1
    assert [n for n, _ in attachments(msgs[0])] == [f"{b.reference}-deposit.pdf"]


def test_dp34_deposit_idempotency_and_races(app_url: str, killbill: Any) -> None:
    b = ready(app_url)
    key = idempotency_key()
    first = deposit(b, key=key)
    replay = deposit(b, key=key)
    assert first.status_code == replay.status_code == 201
    assert replay.json()["invoice"]["id"] == first.json()["invoice"]["id"]
    assert_error(deposit(b, key=key, body={"card": {**card(), "name": "Someone Else"}}), "idempotency_conflict")
    assert_error(deposit(b, key=""), "idempotency_key_required")
    acct = kb_account(killbill, b.brand_id)
    assert len(kb_transactions(killbill, acct["accountId"], "PURCHASE")) == 1
    race = ready(app_url)
    results = parallel([lambda c=clone(race.http): deposit(race, http=c) for _ in range(5)])
    wins = [r for r in results if r.status_code == 201]
    assert len(wins) == 1, [r.status_code for r in results]
    for r in results:
        if r.status_code != 201:
            assert_error(r, "invalid_state")
    assert len(kb_transactions(killbill, kb_account(killbill, race.brand_id)["accountId"], "PURCHASE")) == 1
    same = ready(app_url)
    shared = idempotency_key()
    results = parallel([lambda c=clone(same.http): deposit(same, key=shared, http=c) for _ in range(3)])
    for r in results:
        if r.status_code != 201:
            assert_error(r, "request_in_progress")
    assert any(r.status_code == 201 for r in results)
    assert len(kb_transactions(killbill, kb_account(killbill, same.brand_id)["accountId"], "PURCHASE")) == 1


def test_dp35_declined_deposit(app_url: str, mail: Any, killbill: Any) -> None:
    b = ready(app_url)
    assert_error(deposit(b, DECLINE), "card_declined")
    assert_error(deposit(b, INVALID_CARD), "validation_failed", "card.number", FIELD["card.number"])
    assert_error(deposit(b, body={"card": card(expiry=PAST_EXPIRY)}), "validation_failed", "card.expiry", FIELD["card.expiry"])
    assert_error(deposit(b, body={"card": card(cvc="12")}), "validation_failed", "card.cvc", FIELD["card.cvc"])
    eng = engagement(b)
    assert eng["state"] == "quoted" and eng["ledger"] == [] and eng["invoices"] == [] and eng["quote"]["fx_locked"] is False
    acct = kb_account(killbill, b.brand_id)
    assert acct is None or killbill.invoices(acct["accountId"]) == []
    assert settled_inbox(mail, b.finance, f"Deposit receipt: {b.reference}") == []


def test_dp36_deposit_preconditions(app_url: str, killbill: Any) -> None:
    empty = start(app_url)
    upload(empty, "p.glb", glb_product())
    assert_error(deposit(empty), "quote_empty")
    no_model = start(app_url)
    put_line(no_model, "hero_front", 1)
    upload(no_model, "ref.pdf", pdf_bytes())
    assert_error(deposit(no_model), "model_missing")
    queue_down = outage("APP_RABBITMQ_DOWN_URL")
    pending = start(queue_down)
    put_line(pending, "hero_front", 1)
    assert upload(pending, "p.glb", glb_product()).status_code == 201
    assert_error(deposit(pending), "measurement_pending")
    mm = start(app_url)
    put_line(mm, "hero_front", 1)
    wait_measurement(mm, upload(mm, "mm.glb", glb_millimetres()).json()["id"])
    assert_error(deposit(mm), "unit_unconfirmed")
    done = paid(app_url)
    assert_error(deposit(done), "invalid_state")
    for b in (empty, no_model, mm):
        assert kb_account(killbill, b.brand_id) is None
        assert engagement(b)["state"] == "quoted"


def test_dp85_founder_push_alerts(app_url: str, ntfy: Any) -> None:
    b = ready(app_url, "GBP", {"hero_front": 1})
    key = idempotency_key()
    assert deposit(b, key=key).status_code == 201
    assert deposit(b, key=key).status_code == 201
    dep = engagement(b)["quote"]["milestones"]["deposit_minor"]
    msg = f"{b.reference} · {b.name} · {money(dep, 'GBP')}"
    pushes(ntfy, "Deposit paid", msg)
    f = founder(app_url)
    token = token_of(send_for_review(b, f)["review_url"])
    rkey = idempotency_key()
    assert revise(app_url, token, rkey).status_code == 201
    assert revise(app_url, token, rkey).status_code == 201
    pushes(ntfy, "Revision requested", f"{b.reference} · Look-dev round 1")
    seen_rev = [m for m in ntfy.messages(TOPIC, 0, timeout=5) if m.get("title") == "Revision requested" and m.get("message") == f"{b.reference} · Look-dev round 1"]
    assert len(seen_rev) == 1, f"revision push count {len(seen_rev)}"
    seen = [m for m in ntfy.messages(TOPIC, 0, timeout=5) if m.get("title") == "Deposit paid" and m.get("message") == msg]
    assert len(seen) == 1, f"deposit push count {len(seen)}"


def pay_by_keyboard(page: Page, dialog: Locator, number: str, pay_name: str) -> None:
    eventually(page, lambda: focused_is(dialog.get_by_role("textbox", name="Card number")), "the dialog focuses Card number (L337)")
    page.keyboard.type(number)
    for name, value in [("Expiry (MM/YY)", FUTURE_EXPIRY), ("Security code", "123"), ("Name on card", card()["name"])]:
        field = dialog.get_by_role("textbox", name=name)
        for _ in range(6):
            if focused_is(field):
                break
            page.keyboard.press("Tab")
        assert focused_is(field), f"Tab never reached {name}"
        page.keyboard.type(value)
    btn = dialog.get_by_role("button", name=pay_name)
    for _ in range(8):
        if focused_is(btn):
            break
        page.keyboard.press("Tab")
    assert focused_is(btn), f"Tab never reached {pay_name}"
    page.keyboard.press("Enter")


def test_wf_deposit_keyboard_payment(browser: Browser, app_url: str, mail: Any, killbill: Any, ntfy: Any) -> None:
    b = ready(app_url, "JPY", {})
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        for code in ("hero_front", "three_quarter", "turntable_360"):
            shot_box(page, code).focus()
            page.keyboard.press(" ")
            advance(page, 1500)
        spin(page, "turntable_360").focus()
        for _ in range(3):
            page.keyboard.press("ArrowUp")
        shot_box(page, "three_quarter").focus()
        page.keyboard.press(" ")
        eventually(page, lambda: [(x["shot_code"], x["quantity"]) for x in engagement(b)["quote"]["lines"]] == [("hero_front", 1), ("turntable_360", 4)], "quote settled on the journey's shots")
        q = engagement(b)["quote"]
        want = expected_quote({"hero_front": 1, "turntable_360": 4}, SEED_RATES["JPY"], "JPY")
        assert q["total_minor"] == want["total"]
        eventually(page, lambda: page.get_by_role("region", name="Quote").get_attribute("data-quote-revision") == str(q["revision"]), "rig on the last reply")
        page.get_by_role("button", name="Pay deposit").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Pay deposit")
        eventually(page, lambda: dialog.is_visible(), "Pay deposit dialog opened")
        pay_by_keyboard(page, dialog, APPROVE, f"Pay {money(want['deposit'], 'JPY')}")
        eventually(page, lambda: page.get_by_role("heading", name="Deposit received").is_visible(), "deposit confirmation heading")
        eng = engagement(b)
        locked = parse_time(eng["quote"]["fx_locked_at"])
        body = plain_text(page.locator("body"))
        assert f"A receipt for this deposit goes to {b.finance}." in body
        assert f"Locked at 205.4175 per £1 on {long_date(locked)}." in body
        for amount in (want["deposit"], want["look_dev"], want["final"]):
            assert money(amount, "JPY") in body
    assert eng["state"] == "deposit_paid"
    acct = kb_account(killbill, b.brand_id)
    assert [kb_minor(t["amount"], "JPY") for t in kb_transactions(killbill, acct["accountId"], "PURCHASE")] == [want["deposit"]]
    inbox(mail, b.finance, f"Deposit receipt: {b.reference}")
    pushes(ntfy, "Deposit paid", f"{b.reference} · {b.name} · {money(want['deposit'], 'JPY')}")


def test_wf_deposit_declined_then_approved(browser: Browser, app_url: str, killbill: Any) -> None:
    b = ready(app_url)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        click(page.get_by_role("button", name="Pay deposit"))
        dialog = page.get_by_role("dialog", name="Pay deposit")
        eventually(page, lambda: dialog.is_visible(), "Pay deposit dialog opened")
        pay_name = f"Pay {money(engagement(b)['quote']['milestones']['deposit_minor'], 'GBP')}"
        pay_by_keyboard(page, dialog, DECLINE, pay_name)
        eventually(page, lambda: dialog.get_by_text(ERR["card_declined"][1]).is_visible(), "declined copy in the dialog")
        assert kb_account(killbill, b.brand_id) is None and engagement(b)["state"] == "quoted"
        fill(dialog.get_by_role("textbox", name="Card number"), APPROVE)
        click(dialog.get_by_role("button", name=pay_name))
        eventually(page, lambda: page.get_by_role("heading", name="Deposit received").is_visible(), "deposit confirmation heading")
    assert engagement(b)["state"] == "deposit_paid"


def test_dp38_billing_outage(app_url: str, killbill: Any) -> None:
    down = outage("APP_KILLBILL_DOWN_URL")
    b = ready(app_url)
    key = idempotency_key()
    assert_error(deposit(b, key=key, http=clone(b.http, down)), "billing_unavailable")
    assert engagement(b)["state"] == "quoted" and kb_account(killbill, b.brand_id) is None
    assert deposit(b, key=key).status_code == 201, "a 503 deposit outcome was stored under its key"
    f = founder(app_url)
    inv = to_final_review(b, f)
    fd = clone(f, down)
    assert_error(issue(fd, inv["id"]), "billing_unavailable")
    assert invoice_of(f, b.eid, "look_dev")["status"] == "draft"
    issued = issue(f, inv["id"]).json()
    assert_error(pay(b, issued["id"], http=clone(b.http, down)), "billing_unavailable")
    assert b.http.get(f"/api/invoices/{issued['id']}").json()["status"] == "issued"
    paid_r = pay(b, issued["id"])
    assert paid_r.status_code == 201 and paid_r.json()["invoice"]["status"] == "paid"


def test_dp39_storage_outage(app_url: str) -> None:
    down = outage("APP_MINIO_DOWN_URL")
    s3 = S3()
    b = paid(app_url)
    before = len(engagement(b)["files"])
    assert_error(upload(b, "late.pdf", pdf_bytes(), http=clone(b.http, down)), "storage_unavailable")
    assert len(engagement(b)["files"]) == before
    assert not [k for k in s3.keys(f"intake/{b.eid}/") if k.endswith(".pdf")]
    f = founder(app_url)
    assert_error(post_still(clone(f, down), b.eid, "hero_front", "look_dev"), "storage_unavailable")
    assert studio_engagement(f, b.eid)["stills"] == []
    fid = engagement(b)["files"][0]["id"]
    assert_error(clone(b.http, down).get(f"/api/engagements/{b.eid}/files/{fid}/content"), "storage_unavailable")


def test_dp40_email_outage(app_url: str, mail: Any, killbill: Any) -> None:
    down = outage("APP_MAILPIT_DOWN_URL")
    b = ready(app_url)
    assert_error(deposit(b, http=clone(b.http, down)), "email_unavailable")
    assert engagement(b)["state"] == "quoted"
    with http_client(down) as c:
        assert c.post("/api/session/code", json={"email": b.reviewer}).status_code == 202
    inbox(mail, b.reviewer, "Your Gloamwork sign-in code", seconds=MAIL_DEADLINE)
    assert len(settled_inbox(mail, b.reviewer, "Your Gloamwork sign-in code")) == 1


def test_dp33_deposit_undone_on_failure(app_url: str, mail: Any, killbill: Any, ntfy: Any) -> None:
    down = outage("APP_MAILPIT_DOWN_URL")
    b = ready(app_url)
    key = idempotency_key()
    r = deposit(b, key=key, http=clone(b.http, down))
    assert r.status_code == 503, r.text[:300]
    eng = engagement(b)
    assert eng["state"] == "quoted" and eng["ledger"] == [] and eng["invoices"] == [] and eng["quote"]["fx_locked"] is False
    acct = kb_account(killbill, b.brand_id)
    if acct:
        assert kb_net(killbill, acct["accountId"], "GBP") == 0
        assert all(Decimal(str(i["balance"])) == 0 for i in killbill.invoices(acct["accountId"]))
    assert settled_inbox(mail, b.finance, f"Deposit receipt: {b.reference}") == []
    dep = eng["quote"]["milestones"]["deposit_minor"]
    msg = f"{b.reference} · {b.name} · {money(dep, 'GBP')}"
    assert not [m for m in ntfy.messages(TOPIC, 0, timeout=3) if m.get("title") == "Deposit paid" and m.get("message") == msg]
    ok = deposit(b, key=key)
    assert ok.status_code == 201, "a 503 deposit outcome was stored under its key"
    acct = kb_account(killbill, b.brand_id)
    assert kb_net(killbill, acct["accountId"], "GBP") == dep
    assert [e["kind"] for e in engagement(b)["ledger"]] == ["deposit"]
    inbox(mail, b.finance, f"Deposit receipt: {b.reference}")
    assert len(settled_inbox(mail, b.finance, f"Deposit receipt: {b.reference}")) == 1


def test_dp41_boot_and_recover(app_url: str) -> None:
    checks = [("APP_KILLBILL_DOWN_URL", "billing", "killbill"), ("APP_MINIO_DOWN_URL", "storage", "minio"), ("APP_MAILPIT_DOWN_URL", "email", "mailpit"),
              ("APP_RABBITMQ_DOWN_URL", "measuring", "rabbitmq"), ("APP_GOTENBERG_DOWN_URL", "documents", "gotenberg")]
    for env, status_key, health_key in checks:
        base = outage(env)
        with http_client(base) as c:
            h = c.get("/api/health")
            assert h.status_code == 200 and h.json() == {"status": "ok"}
            st = c.get("/api/status").json()
            assert st[status_key] == "down", f"{env}: /api/status {st}"
            assert all(st[k] == "up" for k in st if k != status_key), f"{env}: {st}"
        assert founder(base).get("/api/studio/health").json()[health_key] == "down"
    target = urlsplit(os.environ["KILLBILL_URL"])
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    relay_port = probe.getsockname()[1]
    probe.close()
    app_sock = socket.socket()
    app_sock.bind(("127.0.0.1", 0))
    app_port = app_sock.getsockname()[1]
    app_sock.close()
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    env = {**os.environ, "APP_PUBLIC_PORT": str(app_port), "KILLBILL_URL": f"http://127.0.0.1:{relay_port}"}
    env.pop("APP_PUBLIC_URL", None)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT)
    listener: socket.socket | None = None
    copy = f"http://127.0.0.1:{app_port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text()[-3000:]
    try:
        def healthy() -> bool:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}:\n{tail()}")
            with contextlib.suppress(httpx.HTTPError):
                return httpx.get(f"{copy}/api/health", timeout=5).status_code == 200
            return False
        poll(healthy, BOOT_DEADLINE, f"app copy never answered /api/health:\n{tail()}")
        assert httpx.get(f"{copy}/api/status", timeout=10).json()["billing"] == "down"
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", relay_port))
        listener.listen(64)

        def pipe(a: socket.socket, b2: socket.socket) -> None:
            with contextlib.suppress(OSError):
                for _ in range(RELAY_CHUNKS):
                    chunk = a.recv(65536)
                    if not chunk:
                        break
                    b2.sendall(chunk)
            for s in (a, b2):
                with contextlib.suppress(OSError):
                    s.close()

        def serve(lst: socket.socket) -> None:
            with contextlib.suppress(OSError):
                for _ in range(RELAY_ACCEPTS):
                    client_sock, _ = lst.accept()
                    upstream = socket.create_connection((target.hostname, target.port or 80), timeout=30)
                    threading.Thread(target=pipe, args=(client_sock, upstream), daemon=True).start()
                    threading.Thread(target=pipe, args=(upstream, client_sock), daemon=True).start()
        threading.Thread(target=serve, args=(listener,), daemon=True).start()
        poll(lambda: httpx.get(f"{copy}/api/status", timeout=10).json()["billing"] == "up", STATUS_DEADLINE, f"copy never reported billing up after Kill Bill returned:\n{tail()}")
        b = ready(app_url)
        r = deposit(b, http=clone(b.http, copy))
        assert r.status_code == 201, f"deposit through the recovered copy: {r.status_code} {r.text[:300]}\n{tail()}"
    finally:
        proc.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=20)
        if proc.poll() is None:
            proc.kill()
        if listener:
            with contextlib.suppress(OSError):
                listener.shutdown(socket.SHUT_RDWR)
            listener.close()


def test_dp69_status_refresh_keeps_dialog(browser: Browser, app_url: str, mail: Any) -> None:
    b = paid(app_url)
    f = founder(app_url)
    inv = issued_look_dev(b, f)
    state = {"billing": "up"}

    def fake_status(route: Any) -> None:
        route.fulfill(status=200, content_type="application/json; charset=utf-8",
                      body=json.dumps({"billing": state["billing"], "storage": "up", "email": "up", "measuring": "up", "documents": "up"}))
    with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=cookie_map(b.http)) as page:
        page.route("**/api/status", fake_status)
        page.reload()
        click(page.get_by_role("button", name=f"Pay invoice {inv['number']}"))
        dialog = page.get_by_role("dialog", name=f"Pay invoice {inv['number']}")
        eventually(page, lambda: dialog.is_visible(), "Pay invoice dialog opened")
        fill(dialog.get_by_role("textbox", name="Card number"), APPROVE)
        name_box = dialog.get_by_role("textbox", name="Name on card")
        fill(name_box, CARD_NAME)
        name_box.focus()
        state["billing"] = "down"
        banner = page.get_by_role("alert", include_hidden=True).filter(has_text=ERR["billing_unavailable"][1])
        advance(page, STATUS_REFRESH_MS + 500)
        eventually(page, lambda: any(banner.nth(i).is_visible() for i in range(banner.count())),
                   "billing banner appeared after the status refresh")
        assert dialog.is_visible() and focused_is(name_box)
        assert dialog.get_by_role("textbox", name="Card number").input_value().replace(" ", "") == APPROVE.replace(" ", "")
        assert name_box.input_value() == CARD_NAME
        state["billing"] = "up"
        advance(page, STATUS_REFRESH_MS + 500)
        eventually(page, lambda: page.get_by_role("alert").filter(has_text=ERR["billing_unavailable"][1]).count() == 0, "billing banner cleared")
        assert dialog.is_visible() and focused_is(name_box) and name_box.input_value() == CARD_NAME


def test_dp74_refused_changes_undo(browser: Browser, app_url: str) -> None:
    b = ready(app_url)
    with ui(browser, app_url, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        rig_page_ready(page)
        assert deposit(b, http=clone(b.http)).status_code == 201
        click(shot_box(page, "three_quarter"))
        status = page.get_by_role("status", name="Quote updates")
        eventually(page, lambda: plain_text(status).strip() == ERR["quote_locked"][1], "refusal announced")
        advance(page, 3000)
        assert not shot_box(page, "three_quarter").is_checked()
        assert rig(page).get_attribute("data-frustum-count") == "1"
        q = engagement(b)["quote"]
        assert page.get_by_role("region", name="Quote").get_attribute("data-quote-revision") == str(q["revision"]) and quote_values(page) == figures(q)
        row = plain_text(page.get_by_role("table", name="Shot positions").get_by_role("row").nth(2))
        assert row.split()[-1] == "No"
    held_b = ready(app_url)
    down = outage("APP_KILLBILL_DOWN_URL")
    with ui(browser, down, f"/rig/{held_b.eid}", cookies=cookie_map(held_b.http)) as page:
        rig_page_ready(page)
        click(page.get_by_role("button", name="Pay deposit"))
        dialog = page.get_by_role("dialog", name="Pay deposit")
        eventually(page, lambda: dialog.is_visible(), "Pay deposit dialog opened")
        fill(dialog.get_by_role("textbox", name="Card number"), APPROVE)
        fill(dialog.get_by_role("textbox", name="Expiry (MM/YY)"), FUTURE_EXPIRY)
        fill(dialog.get_by_role("textbox", name="Security code"), "123")
        fill(dialog.get_by_role("textbox", name="Name on card"), CARD_NAME)
        pay_btn = dialog.get_by_role("button", name=re.compile(r"^Pay "))
        click(pay_btn)
        eventually(page, lambda: dialog.get_by_text(ERR["billing_unavailable"][1]).is_visible(), "billing copy inside the dialog")
        assert dialog.is_visible()
        assert dialog.get_by_role("textbox", name="Name on card").input_value() == CARD_NAME
        assert dialog.get_by_role("textbox", name="Security code").input_value() == "123"
        assert focused_is(dialog.get_by_role("button", name=re.compile(r"^Pay ")))
    assert engagement(held_b)["state"] == "quoted"


def test_dp81_queue_outage(browser: Browser, app_url: str) -> None:
    down = outage("APP_RABBITMQ_DOWN_URL")
    b = start(down)
    r = upload(b, "product.glb", glb_product())
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "received" and body["measurement"] == "delayed" and body["dimensions_m"] is None
    assert f"intake/{b.eid}/{body['id']}.glb" in S3().keys(f"intake/{b.eid}/")
    with http_client(down) as c:
        assert c.get("/api/status").json()["measuring"] == "down"
    t0 = time.monotonic()
    poll(lambda: time.monotonic() - t0 > PUBLISH_RETRY_WAIT_S, PUBLISH_RETRY_WAIT_S + 10, "waiting past a publish retry")
    later = file_of(b, body["id"])
    assert later["measurement"] == "delayed" and later["dimensions_m"] is None and later["dimensions_mm"] is None


def test_dp83_documents_outage(browser: Browser, app_url: str, mail: Any) -> None:
    down = outage("APP_GOTENBERG_DOWN_URL")
    b = ready(down)
    r = deposit(b)
    assert r.status_code == 201, r.text[:300]
    assert engagement(b)["state"] == "deposit_paid"
    t0 = time.monotonic()
    poll(lambda: time.monotonic() - t0 > PREMATURE_MAIL_WAIT_S, PREMATURE_MAIL_WAIT_S + 10, "waiting for any premature receipt")
    assert settled_inbox(mail, b.finance, f"Deposit receipt: {b.reference}") == [], "a receipt was sent without its PDF"
    with http_client(down) as c:
        assert c.get("/api/status").json()["documents"] == "down"
    with ui(browser, down, f"/account/engagements/{b.eid}", cookies=cookie_map(b.http)) as page:
        eventually(page, lambda: page.get_by_role("alert").filter(has_text=BANNER_DOCUMENTS).count() >= 1, "documents banner shown")


def test_wf_outages_storage_upload(browser: Browser, app_url: str) -> None:
    down = outage("APP_MINIO_DOWN_URL")
    b = start(app_url)
    with ui(browser, down, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        page.get_by_label("Product files").set_input_files([{"name": "sheet.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()}])
        row = page.get_by_role("list", name="Intake files").get_by_role("listitem").filter(has_text="sheet.pdf")
        eventually(page, lambda: "Not saved" in plain_text(row), "row marked Not saved")
        assert page.get_by_role("alert").filter(has_text=ERR["storage_unavailable"][1]).count() >= 1
        assert plain_text(page.get_by_role("status", name="Upload progress")).strip() == f"sheet.pdf: {ERR['storage_unavailable'][1]}"
        page.reload()
        eventually(page, lambda: page.get_by_role("heading", name="Shot Rig").is_visible(), "rig reloaded")
        assert page.get_by_role("list", name="Intake files").get_by_role("listitem").filter(has_text="sheet.pdf").count() == 0
    assert engagement(b)["files"] == []


def test_wf_outages_queue_delayed(browser: Browser, app_url: str) -> None:
    down = outage("APP_RABBITMQ_DOWN_URL")
    b = start(down)
    with ui(browser, down, f"/rig/{b.eid}", cookies=cookie_map(b.http)) as page:
        page.get_by_label("Product files").set_input_files([{"name": "product.glb", "mimeType": "model/gltf-binary", "buffer": glb_product()}])
        row = page.get_by_role("list", name="Intake files").get_by_role("listitem").filter(has_text="product.glb")
        eventually(page, lambda: "Received" in plain_text(row) and "Measuring is delayed" in plain_text(row), "model row delayed")
        eventually(page, lambda: page.get_by_role("alert").filter(has_text=BANNER_MEASURING).count() >= 1, "measuring banner")
    f = engagement(b)["files"][0]
    assert f["measurement"] == "delayed" and f["dimensions_m"] is None


def test_dp42_stills_and_review_link(app_url: str, mail: Any) -> None:
    s3 = S3()
    b = paid(app_url, lines={"hero_front": 1, "turntable_360": 1})
    f = founder(app_url)
    assert_error(f.post(f"/api/studio/engagements/{b.eid}/send-for-review", json={}), "stills_missing")
    assert_error(post_still(f, b.eid, "exploded_view", "look_dev"), "validation_failed", "shot_code", FIELD["shot_code"])
    assert post_still(f, b.eid, "hero_front", "look_dev", png_bytes(1)).status_code == 201
    again = post_still(f, b.eid, "hero_front", "look_dev", png_bytes(2))
    assert again.status_code == 201
    stills = [s for s in studio_engagement(f, b.eid)["stills"] if s["shot_code"] == "hero_front" and s["milestone"] == "look_dev"]
    assert len(stills) == 1
    key = f"stills/{b.eid}/look_dev/{again.json()['id']}.png"
    assert key in s3.keys(f"stills/{b.eid}/") and s3.get(key) == png_bytes(2)
    assert_error(f.post(f"/api/studio/engagements/{b.eid}/send-for-review", json={}), "stills_missing")
    assert post_still(f, b.eid, "turntable_360", "look_dev", png_bytes(3)).status_code == 201
    sent = f.post(f"/api/studio/engagements/{b.eid}/send-for-review", json={})
    assert sent.status_code == 200
    body = sent.json()
    assert body["engagement"]["state"] == "look_dev_review"
    token = token_of(body["review_url"])
    assert len(token) >= REVIEW_TOKEN_MIN_CHARS and re.fullmatch(r"[A-Za-z0-9_-]+", token)
    msgs = inbox(mail, b.reviewer, f"Look-dev stills ready for review: {b.reference}")
    assert body["review_url"] in text(msgs[0])
    assert len(settled_inbox(mail, b.reviewer, f"Look-dev stills ready for review: {b.reference}")) == 1


def test_dp43_review_link_one_engagement(app_url: str) -> None:
    f = founder(app_url)
    a = paid(app_url, lines={"hero_front": 1})
    b = paid(app_url, lines={"top_down": 1})
    assert post_still(f, a.eid, "hero_front", "look_dev", png_bytes(41)).status_code == 201
    ta = token_of(f.post(f"/api/studio/engagements/{a.eid}/send-for-review", json={}).json()["review_url"])
    tb = token_of(send_for_review(b, f)["review_url"])
    with reviewer(app_url) as r:
        view = r.get(f"/api/review/{ta}").json()
        assert view["reference"] == a.reference and view["brand_name"] == a.name and view["milestone"] == "look_dev"
        assert [s["shot_code"] for s in view["stills"]] == ["hero_front"]
        img = r.get(view["stills"][0]["url"])
        assert img.status_code == 200 and img.content == png_bytes(41)
        b_still = r.get(f"/api/review/{tb}").json()["stills"][0]["id"]
        assert_error(r.get(f"/api/review/{ta}/stills/{b_still}"), "not_found")
        assert_error(r.get(f"/api/engagements/{a.eid}"), "unauthenticated")


def test_dp44_revoke_regenerate_expire(app_url: str) -> None:
    f = founder(app_url)
    b = paid(app_url)
    token = token_of(send_for_review(b, f)["review_url"])
    with reviewer(app_url) as r:
        still_url = r.get(f"/api/review/{token}").json()["stills"][0]["url"]
        assert f.delete(f"/api/studio/engagements/{b.eid}/review-link").status_code == 204
        assert_error(r.get(f"/api/review/{token}"), "not_found")
        assert_error(r.get(still_url), "not_found")
        assert f.delete(f"/api/studio/engagements/{b.eid}/review-link").status_code == 204
        regen = f.post(f"/api/studio/engagements/{b.eid}/review-link", json={})
        assert regen.status_code == 201
        new = token_of(regen.json()["review_url"])
        assert r.get(f"/api/review/{new}").status_code == 200
        again = token_of(f.post(f"/api/studio/engagements/{b.eid}/review-link", json={}).json()["review_url"])
        assert_error(r.get(f"/api/review/{new}"), "not_found")
        assert r.get(f"/api/review/{again}").status_code == 200
    short = outage("APP_SHORT_URL")
    fs = founder(short)
    s = paid(short)
    sent = send_for_review(s, fs)
    stoken = token_of(sent["review_url"])
    expires = parse_time(sent["expires_at"])
    with reviewer(short) as r:
        surl = r.get(f"/api/review/{stoken}").json()["stills"][0]["url"]
        poll(lambda: datetime.now(timezone.utc) > expires + timedelta(seconds=2), SHORT_REVIEW_TTL_S + LINK_SLACK_S, "waiting past the review link TTL")
        assert_error(r.get(f"/api/review/{stoken}"), "not_found")
        assert_error(r.get(surl), "not_found")


def test_dp75_review_copies_minimal(browser: Browser, app_url: str, mail: Any) -> None:
    f = founder(app_url)
    b = paid(app_url, "EUR", {"hero_front": 1})
    sent = send_for_review(b, f)
    token = token_of(sent["review_url"])
    bucket = os.environ.get("S3_BUCKET", "")
    s3_host = urlsplit(os.environ.get("S3_ENDPOINT", "")).hostname or ""
    store = S3()
    storage_etags = {hashlib.md5(store.get(k)).hexdigest() for k in store.keys(f"stills/{b.eid}/")}
    assert storage_etags, "the still is stored under stills/<engagement id>/"
    with reviewer(app_url) as r:
        resp = r.get(f"/api/review/{token}")
        assert resp.headers.get("Referrer-Policy") == "no-referrer"
        view = resp.json()
        assert set(view) == {"reference", "brand_name", "milestone", "state", "revision_rounds_used", "revision_rounds_included", "actions_open", "stills"}
        assert all(set(s) == {"id", "shot_code", "title", "url"} for s in view["stills"])
        assert not re.search(r"[£€$¥]|_minor", resp.text)
        for method in ("GET", "HEAD"):
            img = r.request(method, view["stills"][0]["url"])
            assert img.headers["Content-Type"].startswith("image/png") and "Content-Length" in img.headers
            assert img.headers.get("Cache-Control") == "private, no-store" and img.headers.get("Referrer-Policy") == "no-referrer"
            etag = (img.headers.get("ETag") or "").removeprefix("W/").strip('"')
            assert etag not in storage_etags, "the still carries storage's ETag"
            assert "Last-Modified" not in img.headers
            assert not [k for k in img.headers if k.lower().startswith(("x-amz-", "x-minio-"))]
            assert not [v for v in img.headers.values() if (bucket and bucket in v) or b.eid in v]
        page = r.get(f"/review/{token}")
        assert page.headers.get("Referrer-Policy") == "no-referrer"
    expires = parse_time(sent["expires_at"])
    body = text(inbox(mail, b.reviewer, f"Look-dev stills ready for review: {b.reference}")[0])
    for needed in (b.reference, b.name, "Look-dev", sent["review_url"], f"This link works until {long_date(expires)}, {expires:%H:%M} UTC."):
        assert needed in body, f"review email lacks {needed!r}"
    assert not re.search(r"[£€$¥]", body)
    for leak in (b.owner, b.finance, bucket, s3_host):
        assert not leak or leak not in body
    with ui(browser, app_url, f"/review/{token}") as page:
        eventually(page, lambda: page.get_by_role("list", name="Stills").is_visible(), "review page rendered")
        assert not re.search(r"[£€$¥]", plain_text(page.locator("body")))


def test_wf_review_links_open_page(browser: Browser, app_url: str) -> None:
    f = founder(app_url)
    b = paid(app_url, lines={"hero_front": 1, "three_quarter": 1})
    token = token_of(send_for_review(b, f)["review_url"])
    with ui(browser, app_url, f"/review/{token}") as page:
        eventually(page, lambda: page.get_by_role("heading", name=re.compile(re.escape(b.reference))).is_visible(), "heading with the reference")
        assert "Look-dev" in plain_text(page.get_by_role("heading", name=re.compile(re.escape(b.reference))))
        assert page.get_by_text(f"Revision rounds used: {0} of 2").is_visible()
        stills = page.get_by_role("list", name="Stills")
        for title in ("Hero front", "Three-quarter"):
            assert stills.get_by_role("img", name=f"{title} still").count() == 1
        assert page.get_by_role("button", name="Accept look-dev").is_visible()
    with reviewer(app_url) as r:
        assert r.get(f"/api/review/{token}").json()["actions_open"] is True


def test_wf_review_links_revoked_page(browser: Browser, app_url: str) -> None:
    f = founder(app_url)
    b = paid(app_url)
    token = token_of(send_for_review(b, f)["review_url"])

    def revoked() -> bool:
        with reviewer(app_url) as r:
            return r.get(f"/api/review/{token}").status_code == 404
    with ui(browser, app_url, f"/studio/engagements/{b.eid}", cookies=cookie_map(f)) as page:
        btn = page.get_by_role("button", name="Revoke review link")
        eventually(page, lambda: btn.is_visible(), "Revoke review link button")
        click(btn)
        eventually(page, revoked, "link revoked")
    with ui(browser, app_url, f"/review/{token}") as page:
        eventually(page, lambda: page.get_by_role("heading", name=NOT_FOUND_HEADING).is_visible(), "not-found heading")
        assert page.get_by_text(NOT_FOUND_TEXT).is_visible()
    with reviewer(app_url) as r:
        assert_error(r.get(f"/api/review/{token}"), "not_found")


def test_dp46_state_machine(app_url: str) -> None:
    f = founder(app_url)
    q = ready(app_url)
    assert_error(f.post(f"/api/studio/engagements/{q.eid}/send-for-review", json={}), "invalid_state")
    assert_error(f.post(f"/api/studio/engagements/{q.eid}/cancel", json={"refund_minor": 1}), "invalid_state")
    assert_error(f.post(f"/api/studio/engagements/{q.eid}/review-link", json={}), "invalid_state")
    b = paid(app_url)
    assert_error(put_line(b, "three_quarter", 1), "quote_locked")
    assert_error(b.http.delete(f"/api/engagements/{b.eid}/quote/lines/hero_front"), "quote_locked")
    assert_error(upload(b, "new.glb", glb_product()), "quote_locked")
    dep_inv = engagement(b)["invoices"][0]
    assert_error(issue(f, dep_inv["id"]), "invalid_state")
    assert_error(pay(b, dep_inv["id"]), "invoice_not_payable")
    assert_error(f.post(f"/api/studio/engagements/{b.eid}/review-link", json={}), "invalid_state")
    token = token_of(send_for_review(b, f)["review_url"])
    results = parallel([lambda: accept(app_url, token), lambda: revise(app_url, token, idempotency_key())])
    assert sorted(r.status_code for r in results).count(409) == 1, [r.status_code for r in results]
    assert len([r for r in results if r.status_code in (200, 201)]) == 1
    state = engagement(b)["state"]
    assert state in ("final_review", "revision_requested")
    c = paid(app_url)
    ct = token_of(send_for_review(c, f)["review_url"])
    assert accept(app_url, ct).status_code == 200
    assert_error(accept(app_url, ct), "finals_not_ready")
    assert_error(revise(app_url, ct, idempotency_key()), "finals_not_ready")
    draft = invoice_of(f, c.eid, "look_dev")
    assert draft["status"] == "draft"
    assert_error(f.post(f"/api/studio/engagements/{c.eid}/send-for-review", json={}), "look_dev_unpaid")
    issued = issue(f, draft["id"]).json()
    assert pay(c, issued["id"]).status_code == 201
    assert_error(f.post(f"/api/studio/engagements/{c.eid}/send-for-review", json={}), "stills_missing")
    assert f.post(f"/api/studio/engagements/{c.eid}/cancel", json={"refund_minor": 1}).status_code == 200
    assert_error(f.post(f"/api/studio/engagements/{c.eid}/cancel", json={"refund_minor": 1}), "invalid_state")
    assert_error(post_still(f, c.eid, "hero_front", "final_delivery"), "invalid_state")


def test_dp47_revision_rounds_change_orders(app_url: str) -> None:
    f = founder(app_url)
    b = paid(app_url, "EUR", {"hero_front": 1})
    token = token_of(send_for_review(b, f)["review_url"])
    for n in (1, 2, 3):
        r = revise(app_url, token, idempotency_key())
        assert r.status_code == 201, r.text[:300]
        body = r.json()
        assert body["round"] == n and body["change_order"] is (n >= 3)
        assert body["review"]["revision_rounds_used"] == n
        assert not re.search(r"[£€$¥]|_minor", r.text)
        sent = f.post(f"/api/studio/engagements/{b.eid}/send-for-review", json={})
        assert sent.status_code == 200 and sent.json()["engagement"]["state"] == "look_dev_review"
        token = token_of(sent.json()["review_url"])
    assert studio_engagement(f, b.eid)["revision_rounds"]["look_dev"] == 3
    assert accept(app_url, token).status_code == 200
    inv = invoice_of(f, b.eid, "look_dev")
    share = engagement(b)["quote"]["milestones"]["look_dev_minor"]
    assert inv["lines"] == [
        {"description": f"Look-dev {b.reference}", "amount_minor": share},
        {"description": f"Change order, Look-dev round 3, {b.reference}", "amount_minor": CHANGE_ORDER_EUR_MINOR},
    ]
    assert inv["amount_minor"] == share + CHANGE_ORDER_EUR_MINOR
    m = engagement(b)["quote"]["milestones"]
    assert m["deposit_minor"] + m["look_dev_minor"] + m["final_delivery_minor"] == engagement(b)["quote"]["total_minor"]


def test_dp64_idempotent_revisions(app_url: str) -> None:
    f = founder(app_url)
    b = paid(app_url)
    token = token_of(send_for_review(b, f)["review_url"])
    key = idempotency_key()
    first = revise(app_url, token, key)
    replay = revise(app_url, token, key)
    assert first.status_code == replay.status_code == 201
    assert replay.json() == first.json() and first.json()["round"] == 1
    assert_error(revise(app_url, token, key, note="Something different"), "idempotency_conflict")
    with reviewer(app_url) as r:
        assert_error(r.post(f"/api/review/{token}/revisions", json={"note": "x"}), "idempotency_key_required")
    assert studio_engagement(f, b.eid)["revision_rounds"]["look_dev"] == 1
    c = paid(app_url)
    ctoken = token_of(send_for_review(c, f)["review_url"])
    shared = idempotency_key()
    results = parallel([lambda: revise(app_url, ctoken, shared) for _ in range(3)])
    for r in results:
        if r.status_code != 201:
            assert_error(r, "request_in_progress")
    assert studio_engagement(f, c.eid)["revision_rounds"]["look_dev"] == 1


def test_dp76_reviewer_actions_at_expiry(app_url: str) -> None:
    short = outage("APP_SHORT_URL")
    f = founder(short)
    b = paid(short)
    sent = send_for_review(b, f)
    token = token_of(sent["review_url"])
    expires = parse_time(sent["expires_at"])
    key = idempotency_key()
    assert datetime.now(timezone.utc) < expires - timedelta(seconds=2)
    assert revise(short, token, key).status_code == 201
    regen = f.post(f"/api/studio/engagements/{b.eid}/review-link", json={})
    assert regen.status_code == 201
    new_token = token_of(regen.json()["review_url"])
    new_exp = parse_time(regen.json()["expires_at"])
    assert_error(revise(short, token, key), "not_found")
    poll(lambda: datetime.now(timezone.utc) > new_exp + timedelta(seconds=2), SHORT_REVIEW_TTL_S + LINK_SLACK_S, "waiting past the review link TTL")
    assert_error(accept(short, new_token), "not_found")
    assert_error(revise(short, new_token, key), "not_found")
    assert_error(revise(short, new_token, idempotency_key()), "not_found")
    assert studio_engagement(f, b.eid)["revision_rounds"]["look_dev"] == 1


def test_wf_revisions_review_journey(browser: Browser, app_url: str) -> None:
    f = founder(app_url)
    b = paid(app_url)
    token = token_of(send_for_review(b, f)["review_url"])
    with ui(browser, app_url, f"/review/{token}") as page:
        eventually(page, lambda: page.get_by_role("button", name="Request a revision").is_visible(), "review actions shown")
        click(page.get_by_role("button", name="Request a revision"))
        dialog = page.get_by_role("dialog", name="Request a revision")
        eventually(page, lambda: dialog.is_visible(), "revision dialog")
        fill(dialog.get_by_role("textbox", name="What should change?"), "Softer shadow under the base")
        click(dialog.get_by_role("button", name="Send request"))
        eventually(page, lambda: page.get_by_role("heading", name="Revision requested").is_visible(), "revision heading")
        assert page.get_by_text(f"Round {1} of 2 included.").is_visible()
    assert engagement(b)["state"] == "revision_requested"
    token = token_of(send_for_review(b, f)["review_url"])
    with ui(browser, app_url, f"/review/{token}") as page:
        eventually(page, lambda: page.get_by_text(f"Revision rounds used: {1} of 2").is_visible(), "round counter")
        click(page.get_by_role("button", name="Accept look-dev"))
        eventually(page, lambda: page.get_by_role("heading", name="Milestone accepted").is_visible(), "acceptance heading")
        assert page.get_by_text("Thank you. The studio will be in touch about the next step.").is_visible()
    assert engagement(b)["state"] == "final_review"
    assert invoice_of(f, b.eid, "look_dev")["status"] == "draft"


def test_wf_revisions_double_send(browser: Browser, app_url: str) -> None:
    from conftest import held
    f = founder(app_url)
    b = paid(app_url)
    token = token_of(send_for_review(b, f)["review_url"])
    with ui(browser, app_url, f"/review/{token}") as page:
        eventually(page, lambda: page.get_by_role("button", name="Request a revision").is_visible(), "review actions shown")
        click(page.get_by_role("button", name="Request a revision"))
        dialog = page.get_by_role("dialog", name="Request a revision")
        fill(dialog.get_by_role("textbox", name="What should change?"), "Brighter label")
        keys: list[str] = []
        page.on("request", lambda req: keys.append(req.headers.get("idempotency-key", "")) if "/revisions" in req.url else None)
        with held(page, "**/revisions") as h:
            send = dialog.get_by_role("button", name="Send request")
            click(send)
            with contextlib.suppress(PlaywrightError):
                send.click(timeout=2000, force=True)
            h.release()
        eventually(page, lambda: page.get_by_role("heading", name="Revision requested").is_visible(), "revision heading")
    assert len(set(k for k in keys if k)) == 1
    assert studio_engagement(f, b.eid)["revision_rounds"]["look_dev"] == 1


def test_dp48_milestone_invoices(app_url: str, mail: Any, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url, "EUR", {"hero_front": 1, "turntable_360": 2})
    draft = to_final_review(b, f)
    assert draft["status"] == "draft" and draft["issued_at"] is None
    assert_error(b.http.get(f"/api/invoices/{draft['id']}"), "not_found")
    assert draft["id"] not in [i["id"] for i in engagement(b)["invoices"]]
    r = issue(f, draft["id"])
    assert r.status_code == 200
    inv = r.json()
    assert inv["status"] == "issued" and inv["number"] and inv["issued_at"]
    share = expected_quote({"hero_front": 1, "turntable_360": 2}, SEED_RATES["EUR"], "EUR")["look_dev"]
    assert money(share, "EUR") == "€1,404.99"
    assert inv["lines"] == [{"description": f"Look-dev {b.reference}", "amount_minor": share}]
    assert b.http.get(f"/api/invoices/{inv['id']}").json()["amount_minor"] == share
    acct = kb_account(killbill, b.brand_id)
    kb = [i for i in killbill.invoices(acct["accountId"]) if str(i["invoiceNumber"]) == str(inv["number"])]
    assert len(kb) == 1
    assert [(i["description"], kb_minor(i["amount"], "EUR")) for i in kb[0]["items"]] == [(f"Look-dev {b.reference}", share)]
    subj = f"Invoice {inv['number']} issued: {b.reference}"
    body = text(inbox(mail, b.finance, subj)[0])
    assert "€1,404.99" in body and f"Look-dev {b.reference}" in body and "€4,683.30" in body
    assert_error(issue(f, draft["id"]), "invalid_state")
    assert len(settled_inbox(mail, b.finance, subj)) == 1


def test_dp49_paid_only_when_confirmed(app_url: str, mail: Any, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    inv = issued_look_dev(b, f)
    results = parallel([lambda c=clone(b.http): pay(b, inv["id"], http=c) for _ in range(4)])
    wins = [r for r in results if r.status_code == 201]
    assert len(wins) == 1, [r.status_code for r in results]
    for r in results:
        if r.status_code != 201:
            assert_error(r, "invoice_not_payable")
    body = wins[0].json()
    assert body["invoice"]["status"] == "paid" and body["invoice"]["balance_minor"] == 0
    entry = body["ledger_entry"]
    assert entry["kind"] == "invoice_payment" and entry["invoice_id"] == inv["id"] and entry["amount_minor"] == inv["amount_minor"]
    acct = kb_account(killbill, b.brand_id)
    kb = next(i for i in killbill.invoices(acct["accountId"]) if str(i["invoiceNumber"]) == str(inv["number"]))
    assert Decimal(str(kb["balance"])) == 0
    purchases = kb_transactions(killbill, acct["accountId"], "PURCHASE")
    assert len(purchases) == 2 and entry["killbill_payment_id"] in [p["paymentId"] for p in purchases]
    assert len([e for e in engagement(b)["ledger"] if e["kind"] == "invoice_payment"]) == 1
    subj = f"Receipt for invoice {inv['number']}: {b.reference}"
    inbox(mail, b.finance, subj)
    assert len(settled_inbox(mail, b.finance, subj)) == 1
    assert_error(pay(b, inv["id"]), "invoice_not_payable")


def test_dp50_invoice_layout(browser: Browser, app_url: str) -> None:
    b = paid(app_url)
    cookies = cookie_map(b.http)
    for size, heads in [(DESKTOP, ["Milestone", "Invoice", "Amount", "Status", "Action"]), (TABLET, ["Milestone", "Amount", "Status"])]:
        with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=cookies, size=size) as page:
            table = page.get_by_role("table", name="Invoices")
            eventually(page, lambda: table.is_visible(), "invoices table")
            assert [t.strip() for t in [plain_text(x) for x in table.get_by_role("columnheader").all()]] == heads
            first = plain_text(table.get_by_role("row").nth(1))
            assert "Deposit" in first and "Paid" in first
            layout_ok(page)
    with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=cookies, size=PHONE) as page:
        cards = page.get_by_role("list", name="Invoices")
        eventually(page, lambda: cards.is_visible(), "invoice card list")
        assert page.get_by_role("table", name="Invoices").count() == 0
        item = plain_text(cards.get_by_role("listitem").first)
        assert "Deposit" in item and "Paid" in item
        layout_ok(page)


def test_dp77_one_issue_per_invoice(app_url: str, mail: Any, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    draft = to_final_review(b, f)
    results = parallel([lambda c=clone(f): issue(c, draft["id"]) for _ in range(5)])
    assert [r.status_code for r in results].count(200) == 1, [r.status_code for r in results]
    for r in results:
        if r.status_code != 200:
            assert_error(r, "invalid_state")
    assert_error(issue(f, draft["id"]), "invalid_state")
    number = next(r for r in results if r.status_code == 200).json()["number"]
    acct = kb_account(killbill, b.brand_id)
    matches = [i for i in killbill.invoices(acct["accountId"]) if any(it["description"] == f"Look-dev {b.reference}" for it in i.get("items", []))]
    assert len(matches) == 1
    subj = f"Invoice {number} issued: {b.reference}"
    inbox(mail, b.finance, subj)
    assert len(settled_inbox(mail, b.finance, subj)) == 1


def test_dp82_pdf_receipts_and_invoices(app_url: str, mail: Any) -> None:
    f = founder(app_url)
    b = paid(app_url, "EUR", {"hero_front": 1, "turntable_360": 2})
    locked = parse_time(engagement(b)["quote"]["fx_locked_at"])
    rate_line = f"Locked at 1.1650 per £1 on {long_date(locked)}."
    receipt = inbox(mail, b.finance, f"Deposit receipt: {b.reference}")[0]
    att = attachments(receipt)
    assert [n for n, _ in att] == [f"{b.reference}-deposit.pdf"]
    words = " ".join(pdf_text(att[0][1]).split())
    for needed in (b.reference, b.name, "Subtotal", "VAT (20%)", "Total", "€3,902.75", "€780.55", "€4,683.30", "Deposit paid", "€1,873.32", rate_line):
        assert needed in words, f"receipt PDF lacks {needed!r}"
    inv = issue(f, to_final_review(b, f)["id"]).json()
    msg = inbox(mail, b.finance, f"Invoice {inv['number']} issued: {b.reference}")[0]
    att = attachments(msg)
    assert [n for n, _ in att] == [f"{b.reference}-{inv['number']}.pdf"]
    words = " ".join(pdf_text(att[0][1]).split())
    for needed in (b.reference, f"Invoice {inv['number']}", f"Look-dev {b.reference}", "Amount due", "€1,404.99", "VAT (20%)", "€4,683.30", rate_line):
        assert needed in words, f"invoice PDF lacks {needed!r}"


def test_wf_milestone_invoices_issue_and_view(browser: Browser, app_url: str, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    to_final_review(b, f)
    with ui(browser, app_url, f"/studio/engagements/{b.eid}", cookies=cookie_map(f)) as page:
        btn = page.get_by_role("button", name=f"Issue invoice {MILESTONE_LABELS['look_dev']}")
        eventually(page, lambda: btn.is_visible(), "issue button")
        click(btn)
        eventually(page, lambda: page.get_by_text("Invoice issued.").is_visible(), "issue success copy")
    inv = invoice_of(f, b.eid, "look_dev")
    assert inv["status"] == "issued"
    acct = kb_account(killbill, b.brand_id)
    assert any(str(i["invoiceNumber"]) == str(inv["number"]) for i in killbill.invoices(acct["accountId"]))
    with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=cookie_map(b.http)) as page:
        row = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text="Look-dev")
        eventually(page, lambda: "Issued" in plain_text(row) and str(inv["number"]) in plain_text(row), "Issued look-dev row")
        assert row.get_by_role("button", name=f"Pay invoice {inv['number']}").is_visible()


def test_wf_milestone_invoices_pay(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    inv = issued_look_dev(b, f)
    with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=finance_cookies(app_url, mail, b.finance)) as page:
        click(page.get_by_role("button", name=f"Pay invoice {inv['number']}"))
        dialog = page.get_by_role("dialog", name=f"Pay invoice {inv['number']}")
        eventually(page, lambda: dialog.is_visible(), "pay dialog")
        pay_by_keyboard(page, dialog, APPROVE, f"Pay {money(inv['amount_minor'], 'GBP')}")
        eventually(page, lambda: page.get_by_role("heading", name="Invoice paid").is_visible(), "Invoice paid heading")
        assert page.get_by_text("Thank you. A receipt will follow by email.").is_visible()
    acct = kb_account(killbill, b.brand_id)
    kb = next(i for i in killbill.invoices(acct["accountId"]) if str(i["invoiceNumber"]) == str(inv["number"]))
    assert Decimal(str(kb["balance"])) == 0
    inbox(mail, b.finance, f"Receipt for invoice {inv['number']}: {b.reference}")


def test_dp51_declined_milestone_payment(app_url: str, mail: Any, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    inv = issued_look_dev(b, f)
    acct = kb_account(killbill, b.brand_id)
    purchases = len(kb_transactions(killbill, acct["accountId"], "PURCHASE"))
    t0 = datetime.now(timezone.utc)
    assert_error(pay(b, inv["id"], DECLINE), "card_declined")
    t1 = datetime.now(timezone.utc)
    got = b.http.get(f"/api/invoices/{inv['id']}").json()
    assert got["status"] == "payment_failed" and got["failed_attempts"] == 1
    od = parse_time(got["overdue_at"])
    assert t0 + timedelta(seconds=DEFAULT_OVERDUE_S - CLOCK_TOLERANCE_S) <= od <= t1 + timedelta(seconds=DEFAULT_OVERDUE_S + CLOCK_TOLERANCE_S)
    assert_error(pay(b, inv["id"], DECLINE), "card_declined")
    again = b.http.get(f"/api/invoices/{inv['id']}").json()
    assert again["failed_attempts"] == 2 and again["overdue_at"] == got["overdue_at"]
    subj = f"Payment failed for invoice {inv['number']}: {b.reference}"
    inbox(mail, b.finance, subj, expected=2)
    assert len(settled_inbox(mail, b.finance, subj)) == 2
    assert len(kb_transactions(killbill, acct["accountId"], "PURCHASE")) == purchases
    kb = next(i for i in killbill.invoices(acct["accountId"]) if str(i["invoiceNumber"]) == str(inv["number"]))
    assert kb_minor(kb["balance"], "GBP") == inv["amount_minor"]
    assert pay(b, inv["id"]).status_code == 201


def test_dp52_overdue_after_failure(app_url: str, mail: Any, ntfy: Any) -> None:
    short = outage("APP_SHORT_URL")
    f = founder(short)
    b = paid(short)
    inv = issued_look_dev(b, f)
    assert_error(pay(b, inv["id"], DECLINE), "card_declined")
    got = b.http.get(f"/api/invoices/{inv['id']}").json()
    od = parse_time(got["overdue_at"])
    if datetime.now(timezone.utc) <= od:
        assert got["status"] == "payment_failed"
    poll(lambda: b.http.get(f"/api/invoices/{inv['id']}").json()["status"] == "overdue", 60, "invoice never went overdue after overdue_at")
    assert datetime.now(timezone.utc) > od - timedelta(seconds=CLOCK_TOLERANCE_S)
    subj = f"Invoice {inv['number']} is overdue: {b.reference}"
    inbox(mail, b.finance, subj)
    pushes(ntfy, "Invoice overdue", f"{b.reference} · invoice {inv['number']} · {money(inv['amount_minor'], 'GBP')}")
    assert len(settled_inbox(mail, b.finance, subj)) == 1
    r = pay(b, inv["id"])
    assert r.status_code == 201 and r.json()["invoice"]["status"] == "paid"


def test_dp70_overdue_decided_by_server(browser: Browser, app_url: str, mail: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    inv = issued_look_dev(b, f)
    pay(b, inv["id"], DECLINE)
    od = parse_time(b.http.get(f"/api/invoices/{inv['id']}").json()["overdue_at"])
    with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=cookie_map(b.http)) as page:
        page.clock.set_system_time(od + timedelta(days=30))
        page.reload()
        row = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text="Look-dev")
        eventually(page, lambda: "Payment failed" in plain_text(row), "Payment failed row")
        advance(page, STATUS_REFRESH_MS + 500)
        assert "Overdue" not in plain_text(row)
        assert f"Pay by {long_date(od)}, {od:%H:%M} UTC to avoid an overdue notice." in plain_text(row)
    short = outage("APP_SHORT_URL")
    fs = founder(short)
    s = paid(short)
    sinv = issued_look_dev(s, fs)
    pay(s, sinv["id"], DECLINE)
    with ui(browser, short, f"/account/engagements/{s.eid}", cookies=cookie_map(s.http)) as page:
        page.clock.set_system_time(datetime.now(timezone.utc) - timedelta(days=30))
        page.reload()
        row = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text="Look-dev")
        poll(lambda: s.http.get(f"/api/invoices/{sinv['id']}").json()["status"] == "overdue", 60, "server never reported overdue")
        eventually(page, lambda: "Overdue" in plain_text(row), "open page showed Overdue after a re-read", step=STATUS_REFRESH_MS / 2)


def test_wf_payment_recovery_journey(browser: Browser, app_url: str, mail: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    inv = issued_look_dev(b, f)
    with ui(browser, app_url, f"/account/engagements/{b.eid}", cookies=finance_cookies(app_url, mail, b.finance)) as page:
        btn = page.get_by_role("button", name=f"Pay invoice {inv['number']}")
        click(btn)
        dialog = page.get_by_role("dialog", name=f"Pay invoice {inv['number']}")
        pay_name = f"Pay {money(inv['amount_minor'], 'GBP')}"
        pay_by_keyboard(page, dialog, DECLINE, pay_name)
        eventually(page, lambda: dialog.get_by_text(ERR["card_declined"][1]).is_visible() or not dialog.is_visible(), "decline shown")
        if dialog.is_visible():
            page.keyboard.press("Escape")
        page.reload()
        od = parse_time(b.http.get(f"/api/invoices/{inv['id']}").json()["overdue_at"])
        row = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text="Look-dev")
        eventually(page, lambda: "Payment failed" in plain_text(row), "Payment failed status")
        pay_by = page.get_by_text(f"Pay by {long_date(od)}, {od:%H:%M} UTC to avoid an overdue notice.")
        assert any(pay_by.nth(i).is_visible() for i in range(pay_by.count())), "the pay-by line shows"
        inbox(mail, b.finance, f"Payment failed for invoice {inv['number']}: {b.reference}")
        click(page.get_by_role("button", name=f"Pay invoice {inv['number']}"))
        pay_by_keyboard(page, dialog, APPROVE, pay_name)
        eventually(page, lambda: page.get_by_role("heading", name="Invoice paid").is_visible(), "Invoice paid heading")
        eventually(page, lambda: "Paid" in plain_text(row), "row shows Paid")
    inbox(mail, b.finance, f"Receipt for invoice {inv['number']}: {b.reference}")
    assert b.http.get(f"/api/invoices/{inv['id']}").json()["status"] == "paid"


def test_wf_payment_recovery_overdue(browser: Browser, app_url: str, mail: Any, ntfy: Any) -> None:
    short = outage("APP_SHORT_URL")
    f = founder(short)
    b = paid(short)
    inv = issued_look_dev(b, f)
    with ui(browser, short, f"/account/engagements/{b.eid}", cookies=cookie_map(b.http)) as page:
        click(page.get_by_role("button", name=f"Pay invoice {inv['number']}"))
        dialog = page.get_by_role("dialog", name=f"Pay invoice {inv['number']}")
        pay_by_keyboard(page, dialog, DECLINE, f"Pay {money(inv['amount_minor'], 'GBP')}")
        eventually(page, lambda: dialog.get_by_text(ERR["card_declined"][1]).is_visible() or not dialog.is_visible(), "decline shown")
        if dialog.is_visible():
            page.keyboard.press("Escape")
        row = page.get_by_role("table", name="Invoices").get_by_role("row").filter(has_text="Look-dev")
        eventually(page, lambda: "Overdue" in plain_text(row), "page switched to Overdue", seconds=90, step=STATUS_REFRESH_MS / 2)
    inbox(mail, b.finance, f"Invoice {inv['number']} is overdue: {b.reference}")
    pushes(ntfy, "Invoice overdue", f"{b.reference} · invoice {inv['number']} · {money(inv['amount_minor'], 'GBP')}")


def test_dp54_cancel_with_refund(app_url: str, mail: Any, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    dep = engagement(b)["quote"]["milestones"]["deposit_minor"]
    for bad in (0, dep + 1):
        assert_error(f.post(f"/api/studio/engagements/{b.eid}/cancel", json={"refund_minor": bad}), "validation_failed", "refund_minor", FIELD["refund_minor"])
    down = outage("APP_KILLBILL_DOWN_URL")
    assert_error(clone(f, down).post(f"/api/studio/engagements/{b.eid}/cancel", json={"refund_minor": 100}), "billing_unavailable")
    assert engagement(b)["state"] == "deposit_paid"
    acct0 = kb_account(killbill, b.brand_id)
    assert kb_transactions(killbill, acct0["accountId"], "REFUND") == []
    assert [e for e in engagement(b)["ledger"] if e["kind"] == "refund"] == []
    assert settled_inbox(mail, b.finance, lambda s: s.startswith("Refund of ")) == []
    r = f.post(f"/api/studio/engagements/{b.eid}/cancel", json={"refund_minor": 100})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["engagement"]["state"] == "cancelled_with_refund"
    assert (body["paid_minor"], body["refunded_minor"], body["retained_minor"]) == (dep, 100, dep - 100)
    acct = kb_account(killbill, b.brand_id)
    assert [kb_minor(t["amount"], "GBP") for t in kb_transactions(killbill, acct["accountId"], "REFUND")] == [100]
    subj = f"Refund of £1.00: {b.reference}"
    inbox(mail, b.finance, subj)
    assert len(settled_inbox(mail, b.finance, subj)) == 1
    assert_error(f.post(f"/api/studio/engagements/{b.eid}/cancel", json={"refund_minor": 1}), "invalid_state")


def test_dp55_ledger_matches_killbill(app_url: str, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url, "USD", {"hero_front": 1})
    inv = issued_look_dev(b, f)
    assert pay(b, inv["id"]).status_code == 201
    acct = kb_account(killbill, b.brand_id)["accountId"]
    ledger = engagement(b)["ledger"]
    assert sum(e["amount_minor"] for e in ledger) == kb_net(killbill, acct, "USD")
    total_paid = sum(e["amount_minor"] for e in ledger)
    r = f.post(f"/api/studio/engagements/{b.eid}/cancel", json={"refund_minor": total_paid})
    assert r.status_code == 200
    body = r.json()
    assert body["paid_minor"] == total_paid and body["refunded_minor"] == total_paid and body["retained_minor"] == 0
    ledger = engagement(b)["ledger"]
    net = sum(e["amount_minor"] if e["kind"] != "refund" else -e["amount_minor"] for e in ledger)
    assert net == kb_net(killbill, acct, "USD") == 0


def test_dp65_refund_allocation_and_voids(app_url: str, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    inv = issued_look_dev(b, f)
    pay_r = pay(b, inv["id"]).json()
    look = pay_r["ledger_entry"]
    dep = next(e for e in engagement(b)["ledger"] if e["kind"] == "deposit")
    L = look["amount_minor"]
    r = f.post(f"/api/studio/engagements/{b.eid}/cancel", json={"refund_minor": L + 100})
    assert r.status_code == 200
    body = r.json()
    assert body["refunds"] == [{"killbill_payment_id": look["killbill_payment_id"], "amount_minor": L},
                               {"killbill_payment_id": dep["killbill_payment_id"], "amount_minor": 100}]
    assert body["retained_minor"] == dep["amount_minor"] - 100
    refunds = [e for e in engagement(b)["ledger"] if e["kind"] == "refund"]
    assert sorted((e["killbill_payment_id"], e["amount_minor"]) for e in refunds) == sorted([(look["killbill_payment_id"], L), (dep["killbill_payment_id"], 100)])
    acct = kb_account(killbill, b.brand_id)["accountId"]
    kb_refunds = kb_transactions(killbill, acct, "REFUND")
    assert len(kb_refunds) == 2
    for t in kb_refunds:
        ledger_id = next(e["id"] for e in (look, dep) if e["killbill_payment_id"] == t["paymentId"])
        assert t.get("transactionExternalKey") in {f"{b.eid}:refund:{t['paymentId']}", f"{b.eid}:refund:{ledger_id}"}
    v = paid(app_url)
    vinv = issued_look_dev(v, f)
    pay(v, vinv["id"], DECLINE)
    r = f.post(f"/api/studio/engagements/{v.eid}/cancel", json={"refund_minor": 1})
    assert r.status_code == 200 and vinv["id"] in r.json()["voided_invoice_ids"]
    assert v.http.get(f"/api/invoices/{vinv['id']}").json()["status"] == "void"
    kb = next(i for i in kb_invoices_with_voided(killbill, kb_account(killbill, v.brand_id)["accountId"]) if str(i["invoiceNumber"]) == str(vinv["number"]))
    assert kb["status"] == "VOID"


def test_dp66_one_cancel_wins(app_url: str, mail: Any, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url)
    amounts = [1, 2, 3]
    results = parallel([lambda a=a, c=clone(f): c.post(f"/api/studio/engagements/{b.eid}/cancel", json={"refund_minor": a}) for a in amounts])
    wins = [(a, r) for a, r in zip(amounts, results) if r.status_code == 200]
    assert len(wins) == 1, [r.status_code for r in results]
    for r in results:
        if r.status_code != 200:
            assert_error(r, "invalid_state")
    amount = wins[0][0]
    acct = kb_account(killbill, b.brand_id)["accountId"]
    assert sum(kb_minor(t["amount"], "GBP") for t in kb_transactions(killbill, acct, "REFUND")) == amount
    assert sum(e["amount_minor"] for e in engagement(b)["ledger"] if e["kind"] == "refund") == amount
    inbox(mail, b.finance, lambda s: s.startswith("Refund of "))
    assert [subject(m) for m in settled_inbox(mail, b.finance, lambda s: s.startswith("Refund of "))] == [f"Refund of {money(amount, 'GBP')}: {b.reference}"]


def test_wf_cancel_refund_founder_dialog(browser: Browser, app_url: str, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url, "JPY", {"hero_front": 1})
    token = token_of(send_for_review(b, f)["review_url"])
    with ui(browser, app_url, f"/studio/engagements/{b.eid}", cookies=cookie_map(f)) as page:
        click(page.get_by_role("button", name="Cancel and refund"))
        dialog = page.get_by_role("dialog", name="Cancel and refund")
        eventually(page, lambda: dialog.is_visible(), "cancel dialog")
        box = dialog.get_by_role("textbox", name="Refund amount")
        fill(box, "1000")
        box.press("Enter")
        eventually(page, lambda: page.get_by_text(f"Engagement cancelled. Refund of {money(1000, 'JPY')} recorded.").is_visible(), "cancel success copy")
    assert engagement(b)["state"] == "cancelled_with_refund"
    acct = kb_account(killbill, b.brand_id)["accountId"]
    assert [kb_minor(t["amount"], "JPY") for t in kb_transactions(killbill, acct, "REFUND")] == [1000]
    with reviewer(app_url) as r:
        assert_error(r.get(f"/api/review/{token}"), "not_found")


def test_wf_cancel_refund_two_tabs(browser: Browser, app_url: str, killbill: Any) -> None:
    f = founder(app_url)
    b = paid(app_url, "JPY", {"hero_front": 1})
    cookies = cookie_map(f)
    with ui(browser, app_url, f"/studio/engagements/{b.eid}", cookies=cookies) as p1, ui(browser, app_url, f"/studio/engagements/{b.eid}", cookies=cookies) as p2:
        refund_boxes = []
        for p in (p1, p2):
            click(p.get_by_role("button", name="Cancel and refund"))
            d = p.get_by_role("dialog", name="Cancel and refund")
            eventually(p, lambda d=d: d.is_visible(), "cancel dialog")
            box = d.get_by_role("textbox", name="Refund amount")
            fill(box, "1000")
            refund_boxes.append(box)
        for box in refund_boxes:
            box.press("Enter")
        ok = f"Engagement cancelled. Refund of {money(1000, 'JPY')} recorded."
        for p in (p1, p2):
            eventually(p, lambda p=p: p.get_by_text(ok).count() == 1 or p.get_by_text(ERR["invalid_state"][1]).count() >= 1, "each tab settled")
        assert [p.get_by_text(ok).count() for p in (p1, p2)].count(1) == 1
    acct = kb_account(killbill, b.brand_id)["accountId"]
    assert [kb_minor(t["amount"], "JPY") for t in kb_transactions(killbill, acct, "REFUND")] == [1000]


def test_dp57_run_manifest_and_health(app_url: str) -> None:
    r = httpx.get(f"{app_url.rstrip('/')}/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["content-type"].startswith("application/json")
    port = urlsplit(app_url).port
    assert port in (APP_PORT, int(os.environ.get("APP_PUBLIC_PORT", APP_PORT)))


def test_dp58_server_boundary(browser: Browser, app_url: str) -> None:
    with http_client(app_url) as c:
        filler = "a" * (JSON_LIMIT - len(json.dumps({"email": ""})))
        at_limit = json.dumps({"email": filler})
        assert len(at_limit.encode()) == JSON_LIMIT
        r = c.post("/api/session/code", content=at_limit, headers={"Content-Type": "application/json"})
        assert r.status_code != 413
        over = json.dumps({"email": filler + "a"})
        assert_error(c.post("/api/session/code", content=over, headers={"Content-Type": "application/json"}), "payload_too_large")
        assert_error(c.post("/api/session/code", content=over, headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN}), "payload_too_large")
        assert_error(c.post("/api/session/code", json={"email": ident("x")[1]}, headers={"Origin": FOREIGN_ORIGIN}), "cross_origin")
        secrets = [os.environ[k] for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY", "POCKETBASE_ADMIN_PASSWORD", "NTFY_PASSWORD", "MEILISEARCH_API_KEY", "DATABASE_URL") if len(os.environ.get(k, "")) >= 6]
        for path in ["/.env", "/run.json", "/package.json", "/package-lock.json", "/.git/config", "/tsconfig.json", "/src/server.ts"]:
            r = c.get(path)
            assert r.status_code == 404, f"{path} answered {r.status_code}"
            assert not any(s in r.text for s in secrets)
    bodies: list[str] = []

    def keep(resp: Any) -> None:
        if same_origin(resp.url, app_url) and resp.request.resource_type in ("script", "document", "fetch", "xhr"):
            with contextlib.suppress(PlaywrightError):
                bodies.append(resp.text())
    with ui(browser, app_url, "/") as page:
        page.on("response", keep)
        page.reload()
        eventually(page, lambda: page.get_by_role("region", name="Hero").is_visible(), "home rendered")
    assert not any(s in body for s in secrets for body in bodies), "a credential reached the browser"


def test_if_run_manifest() -> None:
    data = json.loads((APP_ROOT / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[k], str) and data[k].strip() for k in ("install", "build", "serve"))
    assert not re.search(r"\b(npm|pnpm|yarn) (i|install|ci|add)\b|\bnpx (-y|--yes)\b|\bnpm exec (-y|--yes)\b", data["serve"])


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", "out", ".next", ".git", "coverage"}
    ts, stray = 0, []
    for p in APP_ROOT.rglob("*"):
        if any(part in skip for part in p.relative_to(APP_ROOT).parts) or not p.is_file():
            continue
        if p.suffix in (".ts", ".tsx"):
            ts += 1
        elif p.suffix in (".js", ".jsx", ".mjs", ".cjs") and "config" not in p.name and not p.name.startswith("."):
            stray.append(str(p))
    assert ts > 0 and not stray, f"JavaScript source outside build output or config: {stray[:10]}"


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{p.name}@{getattr(p, 'version', '')}" for p in shipped_packages() if p.name not in notices or str(getattr(p, "version", "")) not in notices]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    for font in ("Bricolage Grotesque", "Manrope"):
        assert font in notices


def test_if_licences() -> None:
    allowed = {"MIT", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"}
    bad = [f"{p.name}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    assert "OFL-1.1" in (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_state_only_in_services() -> None:
    banned = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "lowdb", "nedb", "level", "@electric-sql/pglite", "lmdb"}
    for root in (APP_ROOT, Path(DEPLOYED_APP)):
        pkg = root / "package.json"
        if pkg.exists():
            data = json.loads(pkg.read_text())
            deps = set(data.get("dependencies", {})) | set(data.get("optionalDependencies", {}))
            assert not deps & banned, f"{pkg}: {deps & banned}"
        files = [p for p in root.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db", ".rdb") and "node_modules" not in p.parts]
        assert not files, f"local datastore files: {files[:5]}"


def test_if_service_config_untouched(killbill: Any, rabbitmq: Any, meilisearch: Any) -> None:
    assert Postgres().rows("SELECT 1 AS one") == [{"one": 1}]
    assert isinstance(PocketBase().collections(), list)
    assert isinstance(rabbitmq.queues(), dict)
    assert isinstance(meilisearch.indexes(), dict)
    assert killbill.account_by_key(str(uuid.uuid4())) is None
    traj = Path("/logs/agent/trajectory.json")
    if traj.exists():
        content = traj.read_text(errors="ignore")
        for pattern in (r"ALTER\s+(USER|ROLE)\s+\w+\s+(WITH\s+)?PASSWORD", r"rabbitmqctl\s+(change_password|delete_user)", r"mc\s+admin\s+user\s+(remove|add)"):
            assert not re.search(pattern, content, re.I), f"trajectory changes service credentials: {pattern}"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    foreign: list[str] = []
    with ui(browser, app_url, "/") as page:
        page.on("request", lambda req: foreign.append(req.url) if req.url.startswith("http") and not same_origin(req.url, app_url) else None)
        for path in ("/", "/work/brant-vale-arc-kettle", "/start"):
            page.goto(app_url + path)
            advance(page, 1000)
    assert not foreign, f"third-party requests: {foreign[:10]}"
