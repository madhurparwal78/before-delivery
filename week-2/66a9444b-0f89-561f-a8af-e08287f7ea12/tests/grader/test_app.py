from __future__ import annotations

import contextlib
import json
import os
import re
import shlex
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fractions import Fraction
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    AXE,
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    capture,
    changed,
    check,
    click,
    decode,
    difference,
    fill,
    idempotency_key,
    layout,
    open_app,
    same_origin,
    select,
    settle,
    tab_order,
    unique,
)
from conftest import text as mail_text

COOKIE = "kerf_session"
SEED_PASSWORD = "kerf-festival-2027"
BRUSSELS = ZoneInfo("Europe/Brussels")
UTC = timezone.utc
EDITION_YEAR = 2027
THU, FRI, SAT, SUN = "2027-10-28", "2027-10-29", "2027-10-30", "2027-10-31"
FRI_LABEL = "Fri 29 Oct"
REF_RE = re.compile(r"KF-[A-Z2-9]{6}")
PASS_RE = re.compile(r"KFP-[A-Z2-9]{10}")
VOUCHER_RE = re.compile(r"KERF-[A-Z2-9]{8}")
INVOICE_RE = re.compile(rf"INV-{EDITION_YEAR}-\d{{4}}")
CREDIT_NOTE_RE = re.compile(rf"CN-{EDITION_YEAR}-\d{{4}}")
MESSAGE_ID_RE = re.compile(r"<?kerf-[^@>]+@kerf\.example>?")
FROM_ADDRESS = "tickets@kerf.example"

ADMIN = "admin@kerf.example"
CURATOR = "curator@kerf.example"
BOXOFFICE = "boxoffice@kerf.example"
FINANCE = "finance@kerf.example"
ARTIST = "artist@kerf.example"
ARTIST2 = "artist2@kerf.example"
MIRA = "mira@visitors.example"
VIERWINDEN_BOOKER = "bookings@vierwinden.example"
QUAI_BOOKER = "bookings@quai-lumiere.example"

FEEDBACK, SHADER, SIGNAL, DELTA = "feedback-gardens", "shader-sketching", "signal-bodies", "delta-choir"
ORBIT, LUMEN, NACHT = "orbit-index", "lumen-drift", "nachtstroom"
SECOND_SUMMER, SECOND_WINTER, DAWN, RESIDENCY = "second-hour-summer", "second-hour-winter", "dawn-patch", "residency-showing"

HOLD_DEFAULT_SECONDS = 600
PROOF_DEFAULT_SECONDS = 259200
BILLING_DAY_DEFAULT_SECONDS = 86400
JSON_LIMIT = 100_000
PROOF_LIMIT = 5_000_000
IMAGE_LIMIT = 10_000_000
NAME_LIMIT = 200
DISPLAY_LONGEST = 1200
GROUP_MINIMUM = 5
DUE_BILLING_DAYS = 30
RETRY_DAYS = (1, 3, 7)
VOUCHER_MAX = 100000
SIDE_EFFECT_SECONDS = 5
MAIL_DELIVERY_SECONDS = 10
KILLBILL_RECOVERY_SECONDS = 30
BOOT_SECONDS = 10
SCROLL_FLIGHT_PX = 900
YAW_MAX = 8
PITCH_MAX = 5
INTRO_MS = 1400
QUICK_MS = 200
SECTION_MS = 600
DIALOG_OPEN_MAX_MS = 500
STATIC_FALLBACK_SECONDS = 1
DISPLAY_MIN, DISPLAY_MAX = 0.70, 0.90
TARGET_PX = 44
FOCUS_RING_PX = 2
FOCUS_CONTRAST = 3
VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}
VIEWPORT_IDS = ["375x812", "768x1024", "1280x800"]
STORY = ("Four days.", "Five venues.", "One lattice.")
SOUND = "Sound"
RIVERSIDE = "Riverside Pavilion"
SIGNAL_TITLE, DELTA_TITLE, FEEDBACK_TITLE = "Signal Bodies", "Delta Choir", "Feedback Gardens"
GHOST = "e-ghost-loop"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")
PROOF_ALIAS = "scan.txt"
LEDGER_VOUCHER_CENTS = 2500

HTTP_TIMEOUT = 60
POLL_INTERVAL = 0.25
UI_WAIT = 30
API_WAIT = 30
MAIL_WAIT = 45
EXPECT_MS = 250
STEP_MS = 250
FRAME_MS = 16
SKEW_SECONDS = 1
COPY_BOOT_SECONDS = 120
COPY_STOP_SECONDS = 20
LOG_TAIL_BYTES = 4000
RELAY_CHUNK = 65536
TRAP_PRESSES = 30
TAB_LIMIT = 250
FOCUS_SAMPLES = 12
AXE_POLLS = 625
PUBLISH_LEAD_SECONDS = 4
FAR_DAYS = 7
NOON_HOUR = 10
DIRECT_PURCHASE_CENTS = 9
KB_CREATED_BY = "verifier"
HOLD_PROBE_SECONDS = 4
CLAIM_PROBE_SECONDS = 6
PROOF_PROBE_SECONDS = 8
BILLING_PROBE_SECONDS = 5
SIGNED_PROBE_SECONDS = 2
CONTENDERS = 8
POINTER_INSET = 0.2
OTHER_ORIGIN = "http://elsewhere.example"
PAUSE = threading.Event()

MANIFEST = Path("/app/run.json")
NOTICES = Path("/app/THIRD_PARTY_NOTICES.md")
OUTAGES = {"APP_KILLBILL_DOWN_URL": "killbill", "APP_MAILPIT_DOWN_URL": "mailpit", "APP_MINIO_DOWN_URL": "minio"}


def poll(fn: Callable[[], Any], seconds: float, message: Any = "condition") -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() > deadline:
            raise AssertionError(f"{message() if callable(message) else message}: last value {value!r}")
        PAUSE.wait(POLL_INTERVAL)


def steady(fn: Callable[[], bool], seconds: float, message: str) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert fn(), message
        PAUSE.wait(POLL_INTERVAL)


def now() -> datetime:
    return datetime.now(UTC)


def instant(value: str) -> datetime:
    assert isinstance(value, str) and value.endswith("Z"), value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def wall(moment: datetime) -> str:
    return moment.astimezone(BRUSSELS).isoformat(timespec="seconds")


def brussels(y: int, mo: int, d: int, h: int, mi: int = 0, fold: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=BRUSSELS, fold=fold).astimezone(UTC)


def wait_past(moment: datetime) -> None:
    poll(lambda: now() >= moment + timedelta(seconds=SKEW_SECONDS),
         max(0.0, (moment - now()).total_seconds()) + API_WAIT, f"clock passing {moment}")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def euros(cents: int) -> str:
    return f"{cents / 100:.2f}"


def half_up(value: Fraction) -> int:
    return int((value + Fraction(1, 2)) // 1)


def allocate(total: int, weights: list[int]) -> list[int]:
    whole = sum(weights)
    if total == 0 or whole == 0:
        return [0] * len(weights)
    exact = [Fraction(total * w, whole) for w in weights]
    shares = [int(e) for e in exact]
    order = sorted(range(len(weights)), key=lambda i: (-(exact[i] - shares[i]), i))
    for i in order[: total - sum(shares)]:
        shares[i] += 1
    return shares


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))
    out: list[Any] = [None] * len(calls)

    def run(i: int) -> None:
        barrier.wait()
        out[i] = calls[i]()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(calls))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def expect_error(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, (r.status_code, r.text)
    body = r.json()
    assert body.get("error") == code, body
    return body


def expect_field(r: httpx.Response, field: str, code: str, status: int = 422) -> None:
    assert r.status_code == status, (r.status_code, r.text)
    assert r.json() == {"errors": {field: code}}, r.text


def pdf_bytes(size: int | None = None) -> bytes:
    core = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n"
    tail = b"%%EOF\n"
    if size is None:
        return core + tail
    filler = size - len(core) - len(tail)
    return core + b"%" + b"0" * (filler - 2) + b"\n" + tail


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(width: int = 4, height: int = 4, size: int | None = None) -> bytes:
    raw = b"".join(b"\x00" + b"\x80\x40\x20" * width for _ in range(height))
    head = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    head += _chunk(b"IDAT", zlib.compress(raw))
    end = _chunk(b"IEND", b"")
    if size is None:
        return head + end
    return head + _chunk(b"prVt", b"\x00" * (size - len(head) - len(end) - 12)) + end


GIF_BYTES = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def jpeg_size(blob: bytes) -> tuple[int, int]:
    assert blob[:2] == b"\xff\xd8", "not a JPEG"
    i = 2
    while i < len(blob):
        assert blob[i] == 0xFF
        marker = blob[i + 1]
        length = struct.unpack(">H", blob[i + 2:i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", blob[i + 5:i + 9])
            return width, height
        i += 2 + length
    raise AssertionError("no JPEG frame header")


PDF_SHOWN = re.compile(rb"(\((?:\\.|[^()\\]|\((?:\\.|[^()\\])*\))*\)|<[0-9A-Fa-f\s]*>)\s*(?:Tj|'|\")"
                       rb"|\[((?:\\.|[^\[\]\\])*)\]\s*TJ", re.S)
PDF_PIECE = re.compile(rb"\((?:\\.|[^()\\]|\((?:\\.|[^()\\])*\))*\)|<[0-9A-Fa-f\s]*>", re.S)


def pdf_piece(piece: bytes) -> bytes:
    if piece.startswith(b"<"):
        digits = re.sub(rb"\s", b"", piece[1:-1])
        return bytes.fromhex((digits + b"0" * (len(digits) % 2)).decode())
    return re.sub(rb"\\([()\\])", rb"\1", piece[1:-1])


def pdf_strings(blob: bytes) -> list[bytes]:
    return [b"".join(pdf_piece(p) for p in PDF_PIECE.findall(m.group(1) or m.group(2)))
            for m in PDF_SHOWN.finditer(blob)]


def priced(text: bytes, amount: str) -> bool:
    return re.search(rb"(?<![\d.,])" + re.escape(amount.encode()) + rb"(?!\d)", text) is not None


def multipart(fields: dict[str, str], filename: str | None, content: bytes, ctype: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    if filename is not None:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="'.encode()
                     + filename.encode("utf-8", "surrogateescape")
                     + f'"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


@dataclass
class Person:
    http: httpx.Client
    email: str
    name: str
    id: str

    @property
    def cookie(self) -> str:
        return self.http.cookies.get(COOKIE) or ""

    def on(self, base: str) -> httpx.Client:
        return httpx.Client(base_url=base.rstrip("/"), cookies={COOKIE: self.cookie}, timeout=HTTP_TIMEOUT)


def new_client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_TIMEOUT)


def person_names(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    if "@" in a:
        return a, b
    if "@" in b:
        return b, a
    return f"{b.lower()}@{prefix}.example", a


def register(base: str, prefix: str = "visitor") -> Person:
    email, name = person_names(prefix)
    http = new_client(base)
    r = http.post("/api/auth/register", json={"name": name, "email": email, "password": SEED_PASSWORD})
    assert r.status_code == 201, r.text
    return Person(http, email, name, str(r.json()["user"]["id"]))


def signin(base: str, email: str, password: str = SEED_PASSWORD) -> Person:
    http = new_client(base)
    r = http.post("/api/auth/signin", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    return Person(http, email, user["name"], str(user["id"]))


@lru_cache(maxsize=None)
def staff(base: str, email: str) -> Person:
    return signin(base, email)


def admin(base: str) -> Person:
    return staff(base, ADMIN)


def curator(base: str) -> Person:
    return staff(base, CURATOR)


def boxoffice(base: str) -> Person:
    return staff(base, BOXOFFICE)


def finance(base: str) -> Person:
    return staff(base, FINANCE)


def actor_of(p: Person) -> set[str]:
    return {p.email, p.id, p.name}


def new_staff(base: str, role: str, organisation: str | None = None) -> Person:
    email, name = person_names(role.replace("_", ""))
    r = admin(base).http.post("/api/admin/staff", json={
        "email": email, "name": name, "password": SEED_PASSWORD, "role": role, "organisation_id": organisation})
    assert r.status_code == 201, r.text
    return signin(base, email)


def public_session(base: str, session_id: str) -> dict:
    r = httpx.get(f"{base}/api/sessions/{session_id}", timeout=HTTP_TIMEOUT)
    return r.json() if r.status_code == 200 else {}


def programme(base: str, **filters: str) -> dict:
    r = httpx.get(f"{base}/api/programme", params=filters, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def programme_titles(base: str, **filters: str) -> list[str]:
    return [s["title"] for s in programme(base, **filters)["sessions"]]


def fresh_title(kind: str = "session") -> str:
    return f"Probe {kind} {uuid.uuid4().hex[:8]}"


def draft_session(base: str, *, admission: str = "seat", capacity: int = 12, full: int = 1800,
                  reduced: int = 1000, discipline: str = "sound", venue: str = "lab-hoogstraat",
                  starts: str = "2027-10-29T10:00:00+02:00", ends: str = "2027-10-29T11:00:00+02:00",
                  title: str | None = None) -> dict:
    seat = admission == "seat"
    r = curator(base).http.post("/api/sessions", json={
        "title": title or fresh_title(), "description": "Probe description", "discipline": discipline,
        "venue_id": venue, "starts_local": starts, "ends_local": ends, "admission": admission,
        "capacity": capacity if seat else None, "price_full_cents": full if seat else None,
        "price_reduced_cents": reduced if seat else None})
    assert r.status_code == 201, r.text
    return r.json()


def move(base: str, kind: str, item_id: str, to: str, publish_at: str | None = None,
         who: Person | None = None, note: str | None = None) -> httpx.Response:
    return (who or curator(base)).http.post(f"/api/{kind}/{item_id}/transitions",
                                            json={"to": to, "note": note, "publish_at": publish_at})


def schedule(base: str, kind: str, item_id: str, lead: float = PUBLISH_LEAD_SECONDS) -> datetime:
    at = (now() + timedelta(seconds=lead)).replace(microsecond=0)
    r = move(base, kind, item_id, "scheduled", wall(at))
    assert r.status_code == 200, r.text
    return at


def publish_session(base: str, **kw: Any) -> dict:
    s = draft_session(base, **kw)
    assert move(base, "sessions", s["id"], "review").status_code == 200
    at = schedule(base, "sessions", s["id"])
    wait_past(at)
    return poll(lambda: (p := public_session(base, s["id"])) and p.get("status") == "published" and p,
                API_WAIT, "fresh session published")


def cancel_session(base: str, session_id: str) -> dict:
    r = move(base, "sessions", session_id, "cancelled")
    assert r.status_code == 200, r.text
    return r.json()


FULL_PASS = {"product": "full_festival"}


def day_pass(day: str) -> dict:
    return {"product": "day", "festival_day": day}


def take_hold(p: Person, session_id: str, quantity: int = 1, http: httpx.Client | None = None) -> dict:
    r = (http or p.http).post("/api/holds", json={"session_id": session_id, "quantity": quantity})
    assert r.status_code == 201, r.text
    return r.json()


def checkout_body(holds: list[str] = (), passes: list[dict] = (), rate: str = "full",
                  voucher: str | None = None, names: list[str] | None = None) -> dict:
    return {"hold_ids": list(holds), "passes": list(passes), "rate": rate, "voucher_code": voucher,
            "attendee_names": names}


def pay(http: httpx.Client, key: str | None = None, **kw: Any) -> httpx.Response:
    return http.post("/api/checkout", json=checkout_body(**kw), headers={"Idempotency-Key": key or idempotency_key()})


def order_of(p: Person, **kw: Any) -> dict:
    r = pay(p.http, **kw)
    assert r.status_code == 201, r.text
    order = r.json()
    assert REF_RE.fullmatch(order["ref"]), order["ref"]
    return order


def get_order(http: httpx.Client, order_id: str) -> dict:
    r = http.get(f"/api/orders/{order_id}")
    assert r.status_code == 200, r.text
    return r.json()


def group_order(booker: Person, counts: list[tuple[str, int]], voucher: str | None = None,
                http: httpx.Client | None = None) -> tuple[httpx.Response, list[str]]:
    client = http or booker.http
    holds = [take_hold(booker, sid, q, http=client)["id"] for sid, q in counts]
    names = [f"Pupil {uuid.uuid4().hex[:10]}" for _ in range(sum(q for _, q in counts))]
    return pay(client, holds=holds, rate="full", voucher=voucher, names=names), names


def issue_voucher(base: str, cents: int) -> str:
    r = finance(base).http.post("/api/finance/vouchers", json={"amount_cents": cents, "note": "Probe voucher"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert VOUCHER_RE.fullmatch(body["code"]) and body["balance_cents"] == cents, body
    return body["code"]


def voucher_balance(http: httpx.Client, code: str) -> int:
    r = http.get(f"/api/vouchers/{code}")
    assert r.status_code == 200, r.text
    return r.json()["balance_cents"]


def ledger(base: str, code: str) -> dict:
    r = finance(base).http.get("/api/finance/ledger", params={"account": f"voucher:{code}"})
    assert r.status_code == 200, r.text
    return r.json()


def refund(base: str, order_id: str, line_ids: list[str], key: str | None = None,
           http: httpx.Client | None = None, reason: str = "Probe refund") -> httpx.Response:
    return (http or finance(base).http).post(f"/api/finance/orders/{order_id}/refunds",
                                              json={"line_ids": line_ids, "reason": reason},
                                              headers={"Idempotency-Key": key or idempotency_key()})


def upload_proof(http: httpx.Client, order_id: str, name: str | None, content: bytes,
                 ctype: str = "application/pdf", kind: str = "student") -> httpx.Response:
    body, header = multipart({"kind": kind}, name, content, ctype)
    return http.post(f"/api/orders/{order_id}/proof", content=body, headers={"Content-Type": header})


def decide(http: httpx.Client, proof_id: str, decision: str, reason: str | None = None) -> httpx.Response:
    return http.post(f"/api/box-office/proofs/{proof_id}/decision", json={"decision": decision, "reason": reason})


def scan(base: str, code: str, session_id: str) -> httpx.Response:
    return boxoffice(base).http.post("/api/box-office/scans", json={"pass_code": code, "session_id": session_id})


def admitted(base: str, code: str, session_id: str) -> dict:
    r = scan(base, code, session_id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"] == "admitted" and body["pass_code"] == code and body["session_id"] == session_id, body
    return body


def refused(base: str, code: str, session_id: str, reason: str) -> dict:
    body = expect_error(scan(base, code, session_id), 409, "admission_refused")
    assert body["reason"] == reason, body
    return body


def transfer(http: httpx.Client, order_id: str, line_id: str, name: str, email: str) -> httpx.Response:
    return http.post(f"/api/orders/{order_id}/lines/{line_id}/transfer",
                     json={"recipient_name": name, "recipient_email": email})


def new_entry(artist: Person, title: str | None = None) -> dict:
    r = artist.http.post("/api/entries", json={"title": title or fresh_title("entry"), "statement": "Probe statement",
                                               "discipline": "light", "medium": "Pigment print", "year": 2026})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "draft"
    return r.json()


def upload_image(http: httpx.Client, entry_id: str, name: str | None, content: bytes,
                 ctype: str = "image/png") -> httpx.Response:
    body, header = multipart({}, name, content, ctype)
    return http.post(f"/api/entries/{entry_id}/images", content=body, headers={"Content-Type": header})


def outage(env_name: str) -> str:
    return os.environ[env_name].rstrip("/")


@lru_cache(maxsize=None)
def bucket() -> S3:
    return S3()


def transactions(payment: dict | None, kind: str | None = None) -> list[dict]:
    if not payment:
        return []
    return [t for t in payment.get("transactions", [])
            if t.get("status") == "SUCCESS" and (kind is None or t.get("transactionType") == kind)]


def kb_cents(tx: dict) -> int:
    return int((Decimal(str(tx["amount"])) * 100).to_integral_value())


def account_payments(killbill: Any, external_key: str) -> list[dict]:
    account = killbill.account_by_key(external_key)
    return killbill.payments(account["accountId"]) if account else []


def kb_rest() -> httpx.Client:
    return httpx.Client(
        base_url=os.environ["KILLBILL_URL"].rstrip("/"),
        auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
        headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
                 "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
                 "X-Killbill-CreatedBy": KB_CREATED_BY, "Accept": "application/json"},
        timeout=HTTP_TIMEOUT)


def out_of_app_purchase(killbill: Any, buyer: Person, cents: int) -> tuple[str, dict]:
    account = poll(lambda: killbill.account_by_key(f"kerf-user-{buyer.id}"), API_WAIT, "buyer's Kill Bill account")
    key = f"probe-direct-{uuid.uuid4().hex[:10]}"
    r = kb_rest().post(f"/1.0/kb/accounts/{account['accountId']}/payments",
                       json={"transactionType": "PURCHASE", "amount": cents / 100, "currency": "EUR",
                             "paymentExternalKey": key, "transactionExternalKey": f"{key}-tx"})
    assert r.status_code == 201, r.text
    payment = poll(lambda: killbill.payment_by_key(key), API_WAIT, "direct payment in Kill Bill")
    purchases = transactions(payment, "PURCHASE")
    assert len(purchases) == 1 and kb_cents(purchases[0]) == cents, payment
    return key, purchases[0]


def kb_items(account_key: str, killbill: Any) -> list[dict]:
    account = killbill.account_by_key(account_key)
    assert account, account_key
    rest = kb_rest()
    r = rest.get(f"/1.0/kb/accounts/{account['accountId']}/invoices")
    assert r.status_code == 200, r.text
    items: list[dict] = []
    for invoice in r.json():
        one = rest.get(f"/1.0/kb/invoices/{invoice['invoiceId']}", params={"withItems": "true"})
        assert one.status_code == 200, one.text
        items += one.json().get("items") or []
    return items


def kb_charges(items: list[dict], ref: str) -> list[dict]:
    return [i for i in items if i.get("itemType") == "EXTERNAL_CHARGE"
            and (i.get("description") or "").startswith(f"{ref} · ")]


def matching(mail: Any, to: str, subject: str | None, settle_for: float | None = None) -> list[dict]:
    pool = mail.messages(settle=settle_for) if settle_for else mail.messages()
    return [m for m in pool
            if to.lower() in [a.lower() for a in addresses(m.get("To"))]
            and (subject is None or m.get("Subject") == subject)]


def mails(mail: Any, to: str, subject: str | None, expected: int = 1) -> list[dict]:
    return poll(lambda: (found := matching(mail, to, subject)) and len(found) >= expected and found,
                MAIL_WAIT, f"mail to {to}: {subject}")


def settled(mail: Any, to: str, subject: str | None) -> list[dict]:
    return matching(mail, to, subject, settle_for=MAIL_DELIVERY_SECONDS)


def message_ids(messages: list[dict]) -> set[str]:
    return {m.get("MessageID") for m in messages}


def pdfs(message: dict) -> list[dict]:
    return [a for a in message.get("Attachments") or [] if "pdf" in (a.get("ContentType") or "")]


@dataclass
class Copy:
    base: str
    boot_seconds: float


@contextlib.contextmanager
def app_copy(**overrides: str) -> Iterator[Copy]:
    port = free_port()
    serve = shlex.split(json.loads(MANIFEST.read_text())["serve"])
    env = {**os.environ, **{k: str(v) for k, v in overrides.items()}, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+b", prefix="kerf-copy-", suffix=".log", delete=False)
    started = time.monotonic()
    proc = subprocess.Popen(serve, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-LOG_TAIL_BYTES:].decode(errors="replace")

    def up() -> bool:
        if proc.poll() is not None:
            raise AssertionError(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            return httpx.get(base + "/api/health", timeout=SKEW_SECONDS * 2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(up, COPY_BOOT_SECONDS, lambda: f"app copy never answered health:\n{tail()}")
        yield Copy(base, time.monotonic() - started)
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=COPY_STOP_SECONDS)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        log.close()


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = free_port()
        self.server: socket.socket | None = None
        self.links: list[socket.socket] = []

    def start(self) -> None:
        srv = socket.socket()
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", self.port))
        srv.listen()
        self.server = srv
        threading.Thread(target=self._accept, args=(srv,), daemon=True).start()

    def _accept(self, srv: socket.socket) -> None:
        while True:
            try:
                client, _ = srv.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target)
            except OSError:
                client.close()
                continue
            self.links += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(RELAY_CHUNK):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            with contextlib.suppress(OSError):
                dst.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        if self.server is not None:
            with contextlib.suppress(OSError):
                self.server.shutdown(socket.SHUT_RDWR)
            self.server.close()
            self.server = None
        for s in self.links:
            with contextlib.suppress(OSError):
                s.close()
        self.links.clear()


def relay_for_url(env_name: str) -> tuple[Relay, str]:
    u = urlparse(os.environ[env_name])
    relay = Relay(u.hostname, u.port or (443 if u.scheme == "https" else 80))
    return relay, f"{u.scheme}://127.0.0.1:{relay.port}"


@contextlib.contextmanager
def browse(browser: Browser, base: str, person: Person | None = None, path: str = "/",
           viewport: str = "1280x800", **kw: Any) -> Iterator[Page]:
    with open_app(browser, base + path, **kw) as page:
        w, h = VIEWPORTS[viewport]
        page.set_viewport_size({"width": w, "height": h})
        if person is not None:
            login(page, base, person)
            page.goto(base + path)
        yield page


def login(page: Page, base: str, person: Person) -> None:
    page.context.add_cookies([{"name": COOKIE, "value": person.cookie, "url": base}])


def eventually(page: Page | None, assertion: Callable[[], Any], seconds: float = UI_WAIT) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            assertion()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            if page is not None:
                advance(page, STEP_MS)


def visible(page: Page, loc: Locator, seconds: float = UI_WAIT) -> None:
    eventually(page, lambda: expect(loc).to_be_visible(timeout=EXPECT_MS), seconds)


def hidden(page: Page, loc: Locator) -> None:
    eventually(page, lambda: expect(loc).to_be_hidden(timeout=EXPECT_MS))


def printed(copy: str | re.Pattern) -> str | re.Pattern:
    if isinstance(copy, str) and "'" in copy:
        return re.compile(re.escape(copy).replace("'", "['’]"))
    return copy


def says(page: Page, loc: Locator, copy: str | re.Pattern) -> None:
    eventually(page, lambda: expect(loc).to_contain_text(printed(copy), timeout=EXPECT_MS))


def pressed(page: Page, loc: Locator, value: bool) -> None:
    eventually(page, lambda: expect(loc).to_have_attribute("aria-pressed", "true" if value else "false",
                                                           timeout=EXPECT_MS))


def lattice(page: Page) -> Locator:
    return page.get_by_role("figure", name="Programme lattice")


def static_lattice(page: Page) -> Locator:
    return page.get_by_role("img", name="Programme lattice (static)")


def attr(loc: Locator, name: str) -> str:
    return loc.get_attribute(name) or ""


def has_attr(page: Page, loc: Locator, name: str, value: str) -> None:
    eventually(page, lambda: expect(loc).to_have_attribute(name, value, timeout=EXPECT_MS))


def seam_pairs(value: str) -> set[frozenset[str]]:
    return {frozenset(p.split("+")) for p in value.split(",") if p}


def schedule_region(page: Page) -> Locator:
    return page.get_by_role("region", name="Schedule")


def sessions_list(page: Page) -> Locator:
    return page.get_by_role("list", name="Sessions")


def schedule_row(page: Page, title: str) -> Locator:
    return sessions_list(page).get_by_role("listitem").filter(has=page.get_by_role("heading", name=title, exact=True))


def results_copy(n: int) -> str:
    return "1 session" if n == 1 else f"{n} sessions"


def shows_sessions(page: Page, titles: list[str]) -> None:
    items = sessions_list(page).get_by_role("listitem")

    def ok() -> None:
        expect(items).to_have_count(len(titles), timeout=EXPECT_MS)
        got = [items.nth(i).get_by_role("heading").first.inner_text().strip() for i in range(len(titles))]
        assert sorted(got) == sorted(titles), got

    eventually(page, ok)


def agenda_panel(page: Page) -> Locator:
    return page.get_by_role("complementary", name="My agenda")


def add_to_agenda(page: Page, title: str) -> None:
    btn = page.get_by_role("button", name=f"Add {title} to agenda", exact=True)
    visible(page, btn)
    click(btn)
    pressed(page, btn, True)


def checkout_dialog(page: Page) -> Locator:
    return page.get_by_role("dialog", name="Checkout")


def open_agenda_checkout(page: Page) -> Locator:
    click(agenda_panel(page).get_by_role("button", name="Get tickets for my agenda"))
    dialog = checkout_dialog(page)
    visible(page, dialog)
    return dialog


def current_step(page: Page, dialog: Locator, step: str) -> None:
    item = dialog.get_by_role("list", name="Checkout steps").get_by_role("listitem").filter(has_text=step)
    eventually(page, lambda: expect(item).to_have_attribute("aria-current", "step", timeout=EXPECT_MS))


def to_review(page: Page, dialog: Locator, rate: str | None = "Full rate", voucher: str | None = None,
              attendees: list[str] | None = None) -> None:
    click(dialog.get_by_role("button", name="Continue", exact=True))
    current_step(page, dialog, "Details")
    if rate:
        check(dialog.get_by_role("radio", name=rate, exact=True))
    if voucher:
        fill(dialog.get_by_role("textbox", name="Gift voucher code"), voucher)
        click(dialog.get_by_role("button", name="Apply voucher"))
    for k, name in enumerate(attendees or [], start=1):
        fill(dialog.get_by_role("textbox", name=f"Attendee {k} name"), name)
    click(dialog.get_by_role("button", name="Continue", exact=True))
    current_step(page, dialog, "Review and pay")
    visible(page, dialog.get_by_role("table", name="Order summary"))


def order_page_ref(page: Page) -> str:
    heading = page.get_by_role("heading", level=1, name=re.compile(r"^Order KF-"))
    visible(page, heading)
    return REF_RE.search(heading.inner_text()).group(0)


def order_by_ref(http: httpx.Client, ref: str) -> dict:
    r = http.get("/api/orders")
    assert r.status_code == 200, r.text
    found = [o for o in r.json()["orders"] if o["ref"] == ref]
    assert len(found) == 1, ref
    return found[0]


OPTIONS_JS = "e => e.tagName === 'SELECT' ? [...e.options].map(o => [(o.label || o.text || '').trim(), o.value]) : null"


def choose(loc: Locator, *candidates: str) -> None:
    visible(loc.page, loc)
    picks: list[str] = []

    def offered() -> None:
        options = loc.evaluate(OPTIONS_JS)
        if options is None:
            picks[:] = list(candidates)
            return
        exact = [c for c in candidates if any(c in pair for pair in options)]
        within = [label for c in candidates for label, _ in options if c in label]
        picks[:] = exact + within
        assert picks, (candidates, options)

    eventually(loc.page, offered)
    last: Exception | None = None
    for pick in picks:
        try:
            select(loc, pick)
            return
        except Exception as e:
            last = e
    raise AssertionError(f"none of {candidates} selectable: {last}")


def text_width(loc: Locator) -> float:
    return loc.evaluate("el => { const r = document.createRange(); r.selectNodeContents(el); "
                        "return r.getBoundingClientRect().width; }")


def scroll_to(page: Page, y: float) -> None:
    page.evaluate("y => window.scrollTo({top: y, left: 0, behavior: 'instant'})", y)


FOCUS_RING_JS = """
(el) => {
  const parse = c => { const m = (c || '').match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1}; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ground = node => { for (let n = node.parentElement; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) return c; }
    return {r: 255, g: 255, b: 255, a: 1}; };
  const s = getComputedStyle(el);
  let width = 0, color = null;
  if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) { width = parseFloat(s.outlineWidth); color = parse(s.outlineColor); }
  else if (s.boxShadow && s.boxShadow !== 'none') {
    const m = s.boxShadow.match(/(rgba?\\([^)]*\\))\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px/);
    if (m) { color = parse(m[1]); width = parseFloat(m[5]); } }
  const name = el.getAttribute('aria-label') || (el.textContent || '').trim();
  if (!color) return {name, width: 0, ratio: 0};
  const a = lum(color), b = lum(ground(el));
  return {name, width, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)};
}
"""


AXE_RUN_JS = """
options => {
  const result = {done: false, error: null, violations: []};
  window.__kfAxe = () => structuredClone(result);
  axe.run(document, options).then(
    value => { result.violations = value.violations.map(v => ({id: v.id, nodes: v.nodes.map(n => n.target)}));
               result.done = true; },
    error => { result.error = String(error); result.done = true; });
}
"""


def text_contrast(page: Page) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate(AXE_RUN_JS, {"runOnly": {"type": "rule", "values": ["color-contrast"]}})
    for _ in range(AXE_POLLS):
        status = page.evaluate("window.__kfAxe()")
        if status["done"]:
            assert status["error"] is None, status["error"]
            assert not status["violations"], f"text contrast below the brief's limit: {status['violations']}"
            return
        advance(page, FRAME_MS)
    raise AssertionError("axe contrast audit did not settle under controlled time")


def focus_ring(page: Page) -> dict:
    settle(page.locator("body"))
    return page.evaluate_handle("() => document.activeElement").evaluate(FOCUS_RING_JS)


def tab_to(page: Page, name: str | re.Pattern) -> str:
    for _ in range(TAB_LIMIT):
        got = tab_order(page, 1)[0]
        if (name.search(got) if isinstance(name, re.Pattern) else got == name):
            return got
    raise AssertionError(f"Tab never reached {name!r}")


RUNNING_JS = """
(e) => e.getAnimations({subtree: true})
  .filter(a => a.playState === 'running' && (!a.timeline || a.timeline instanceof DocumentTimeline))
  .map(a => a.animationName || a.transitionProperty || a.id || a.constructor.name)
"""


MOTION_LOG_JS = """
() => {
  const log = window.__kfMotion = [];
  const dur = v => Math.max(0, ...String(v).split(',').map(x => x.trim()).map(x => x.endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000));
  document.addEventListener('animationstart', e => log.push({t: e.target, ms: dur(getComputedStyle(e.target).animationDuration)}), true);
  document.addEventListener('transitionrun', e => log.push({t: e.target, ms: dur(getComputedStyle(e.target).transitionDuration)}), true);
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (k, o) { const a = orig.call(this, k, o);
    log.push({t: this, ms: Number(a.effect.getTiming().duration) || 0}); return a; };
}
"""


def test_health_on_every_instance(app_url: str) -> None:
    services = {"postgres", "killbill", "mailpit", "minio"}
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok" and set(body["services"]) == services, body
    assert all(v == "up" for v in body["services"].values()), body
    for env_name, service in OUTAGES.items():
        r = httpx.get(outage(env_name) + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, (env_name, r.text)
        body = r.json()
        assert body["status"] == "ok" and set(body["services"]) == services, body
        assert body["services"][service] == "down" and body["services"]["postgres"] == "up", body


BOUNDARY_CASES = ["size_limit", "media_type", "cross_origin", "never_served"]


@pytest.mark.parametrize("case", BOUNDARY_CASES, ids=BOUNDARY_CASES)
def test_server_boundary(app_url: str, case: str) -> None:
    http = new_client(app_url)
    origin = "{0.scheme}://{0.netloc}".format(urlparse(app_url))
    if case == "size_limit":
        empty = json.dumps({"email": "nobody@kerf.example", "password": ""}, separators=(",", ":")).encode()
        pad = JSON_LIMIT - len(empty)
        exact = json.dumps({"email": "nobody@kerf.example", "password": "x" * pad}, separators=(",", ":")).encode()
        assert len(exact) == JSON_LIMIT
        r = http.post("/api/auth/signin", content=exact, headers={"Content-Type": "application/json"})
        expect_error(r, 401, "invalid_credentials")
        over = json.dumps({"email": "nobody@kerf.example", "password": "x" * (pad + 1)}, separators=(",", ":")).encode()
        r = http.post("/api/auth/signin", content=over, headers={"Content-Type": "application/json"})
        assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}, r.text
    elif case == "media_type":
        r = http.post("/api/auth/signin", content=b"email=a&password=b", headers={"Content-Type": "text/plain"})
        assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}, r.text
    elif case == "cross_origin":
        body = {"email": "nobody@kerf.example", "password": "wrong-password"}
        r = http.post("/api/auth/signin", json=body, headers={"Origin": OTHER_ORIGIN})
        assert r.status_code == 403 and r.json() == {"error": "cross_origin"}, r.text
        assert not any(h.lower().startswith("access-control-") for h in r.headers), dict(r.headers)
        r = http.post("/api/auth/signin", json=body, headers={"Origin": origin})
        expect_error(r, 401, "invalid_credentials")
        r = http.get("/api/programme", headers={"Origin": OTHER_ORIGIN})
        assert r.status_code == 200
        assert not any(h.lower().startswith("access-control-") for h in r.headers), dict(r.headers)
    else:
        for path in ["/package.json", "/package-lock.json", "/run.json", "/.env",
                     "/tsconfig.json", "/src/server.ts", "/server/index.ts", "/index.js.map"]:
            r = http.get(path)
            assert r.status_code == 404, (path, r.status_code)
            assert b'"_schema"' not in r.content and b'"dependencies"' not in r.content, path


PRECEDENCE_CASES = ["payload_before_auth", "media_before_auth", "origin_before_auth", "auth_before_role",
                    "role_before_notfound", "key_before_notfound", "notfound_before_conflict",
                    "version_before_conflict", "conflict_before_validation", "validation_before_outage"]


@pytest.mark.parametrize("case", PRECEDENCE_CASES, ids=PRECEDENCE_CASES)
def test_error_precedence(app_url: str, case: str) -> None:
    anon = new_client(app_url)
    probe_id = f"missing-{uuid.uuid4().hex[:8]}"
    if case == "payload_before_auth":
        big = json.dumps({"session_id": "x" * JSON_LIMIT, "quantity": 1}).encode()
        r = anon.post("/api/holds", content=big, headers={"Content-Type": "application/json"})
        assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}, r.text
    elif case == "media_before_auth":
        r = anon.post("/api/holds", content=b"x", headers={"Content-Type": "text/plain"})
        assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}, r.text
    elif case == "origin_before_auth":
        r = anon.post("/api/holds", json={"session_id": SIGNAL, "quantity": 1}, headers={"Origin": OTHER_ORIGIN})
        assert r.status_code == 403 and r.json() == {"error": "cross_origin"}, r.text
    elif case == "auth_before_role":
        r = anon.get("/api/admin/staff")
        assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}, r.text
    elif case == "role_before_notfound":
        r = staff(app_url, ARTIST).http.get(f"/api/orders/{probe_id}")
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}, r.text
    elif case == "key_before_notfound":
        v = register(app_url)
        r = v.http.post("/api/checkout", json=checkout_body(holds=[probe_id]))
        expect_field(r, "idempotency_key", "required")
    elif case == "notfound_before_conflict":
        v = register(app_url)
        r = v.http.post("/api/holds", json={"session_id": probe_id, "quantity": 99})
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, r.text
    elif case == "version_before_conflict":
        r = curator(app_url).http.patch(f"/api/sessions/{SIGNAL}", json={"title": "Signal Bodies"})
        assert r.status_code == 428 and r.json() == {"error": "version_required"}, r.text
        assert public_session(app_url, SIGNAL)["title"] == "Signal Bodies"
    elif case == "conflict_before_validation":
        s = publish_session(app_url)
        cancel_session(app_url, s["id"])
        v = register(app_url)
        r = v.http.post("/api/holds", json={"session_id": s["id"], "quantity": 99})
        assert r.status_code == 409 and r.json() == {"error": "session_cancelled"}, r.text
    else:
        v = register(app_url)
        down = v.on(outage("APP_KILLBILL_DOWN_URL"))
        r = pay(down, passes=[day_pass(FRI)], voucher="KERF-NOPE2222")
        expect_field(r, "voucher_code", "unknown")


RECOVERY_CASES = ["killbill", "mailpit", "minio"]


@pytest.mark.parametrize("service", RECOVERY_CASES, ids=RECOVERY_CASES)
def test_recovery_without_restart(app_url: str, killbill: Any, mail: Any, service: str) -> None:
    relays: list[Relay] = []
    env: dict[str, str] = {}
    if service == "killbill":
        relay, url = relay_for_url("KILLBILL_URL")
        relays.append(relay)
        env["KILLBILL_URL"] = url
    elif service == "minio":
        relay, url = relay_for_url("S3_ENDPOINT")
        relays.append(relay)
        env["S3_ENDPOINT"] = url
    else:
        smtp = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
        api, url = relay_for_url("MAILPIT_URL")
        relays += [smtp, api]
        env.update({"SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(smtp.port), "MAILPIT_URL": url})
    try:
        with app_copy(**env) as cp:
            assert cp.boot_seconds <= BOOT_SECONDS, cp.boot_seconds
            health = httpx.get(cp.base + "/api/health", timeout=HTTP_TIMEOUT).json()
            assert health["status"] == "ok" and health["services"][service] == "down", health
            v = register(cp.base)
            key = idempotency_key()
            first = pay(v.http, key=key, passes=[day_pass(FRI)])
            if service == "killbill":
                expect_error(first, 503, "payment_unavailable")
            elif service == "minio":
                expect_error(first, 503, "storage_unavailable")
            else:
                assert first.status_code == 201 and first.json()["confirmation_mail"] == "pending", first.text
            if service != "mailpit":
                assert v.http.get("/api/orders").json()["orders"] == []
            for relay in relays:
                relay.start()
            poll(lambda: httpx.get(cp.base + "/api/health", timeout=HTTP_TIMEOUT).json()["services"][service] == "up",
                 KILLBILL_RECOVERY_SECONDS, f"{service} reported up again")
            if service == "mailpit":
                ref = first.json()["ref"]
                mails(mail, v.email, f"Your Kerf Frequencies order {ref}")
                assert len(message_ids(settled(mail, v.email, f"Your Kerf Frequencies order {ref}"))) == 1
                return
            retried = poll(lambda: (r := pay(v.http, key=key, passes=[day_pass(FRI)])).status_code == 201 and r,
                           KILLBILL_RECOVERY_SECONDS, "checkout succeeds after recovery")
            assert retried.headers.get("Idempotent-Replay") != "true"
            order = retried.json()
            payment = killbill.payment_by_key(order["ref"])
            assert len(transactions(payment, "AUTHORIZE")) == 1, payment
            if service == "minio":
                keys = bucket().keys(f"passes/{order['ref']}/")
                assert len(keys) == len(order["lines"]), keys
    finally:
        for relay in relays:
            relay.stop()


def test_wf_admin_settings_signin(browser: Browser, app_url: str) -> None:
    v = register(app_url)
    with browse(browser, app_url, path="/signin") as page:
        fill(page.get_by_role("textbox", name="Email"), v.email)
        fill(page.get_by_role("textbox", name="Password"), "not-the-password")
        click(page.get_by_role("button", name="Sign in"))
        says(page, page.get_by_role("alert", name="Sign-in problem"), "That email and password don't match.")
        fill(page.get_by_role("textbox", name="Password"), SEED_PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        visible(page, page.get_by_role("navigation", name="Main").get_by_role("button", name="Sign out"))
        cookie = next(c for c in page.context.cookies() if c["name"] == COOKIE)
        assert cookie["httpOnly"] and cookie["sameSite"] == "Lax" and cookie["path"] == "/", cookie
        me = httpx.get(app_url + "/api/me", cookies={COOKIE: cookie["value"]}, timeout=HTTP_TIMEOUT)
        assert me.status_code == 200 and me.json()["user"]["email"] == v.email, me.text


def test_wf_admin_settings_register(browser: Browser, app_url: str) -> None:
    email, name = person_names("register")
    with browse(browser, app_url, path="/register") as page:
        fill(page.get_by_role("textbox", name="Name"), name)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_role("textbox", name="Password"), SEED_PASSWORD)
        click(page.get_by_role("button", name="Create account"))
        visible(page, page.get_by_role("navigation", name="Main").get_by_role("button", name="Sign out"))
    p = signin(app_url, email)
    me = p.http.get("/api/me").json()["user"]
    assert me["role"] == "visitor" and me["name"] == name and me["organisation_id"] is None, me
    with browse(browser, app_url, path="/register") as page:
        fill(page.get_by_role("textbox", name="Name"), name)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_role("textbox", name="Password"), SEED_PASSWORD)
        click(page.get_by_role("button", name="Create account"))
        says(page, page.get_by_role("alert", name="Sign-in problem"), "An account with this email already exists.")


ROLE_MATRIX = [
    (MIRA, "GET", "/api/admin/staff", 403), (ARTIST, "POST", "/api/holds", 403),
    (CURATOR, "GET", "/api/finance/orders", 403), (BOXOFFICE, "GET", "/api/entries", 403),
    (FINANCE, "GET", "/api/admin/staff", 403), (ADMIN, "GET", "/api/box-office/proofs?status=pending", 403),
    (VIERWINDEN_BOOKER, "POST", "/api/sessions", 403), (MIRA, "GET", "/api/group/dashboard", 403),
    (ARTIST, "GET", "/api/curate/sessions", 403), (CURATOR, "POST", "/api/box-office/scans", 403),
    (BOXOFFICE, "POST", "/api/finance/vouchers", 403), (ADMIN, "POST", "/api/checkout", 403),
    (FINANCE, "GET", "/api/admin/audit", 200), (ADMIN, "GET", "/api/admin/audit", 200),
    (CURATOR, "GET", "/api/entries", 200), (VIERWINDEN_BOOKER, "GET", "/api/group/dashboard", 200),
    (MIRA, "GET", "/api/orders", 200), (BOXOFFICE, "GET", "/api/box-office/proofs?status=pending", 200),
]


def test_accounts_and_roles(app_url: str) -> None:
    email, name = person_names("acct")
    http = new_client(app_url)
    r = http.post("/api/auth/register", json={"name": name, "email": email, "password": SEED_PASSWORD})
    assert r.status_code == 201, r.text
    user = r.json()["user"]
    assert user["role"] == "visitor" and user["organisation_id"] is None and user["email"] == email, user
    cookie = r.headers.get("set-cookie", "")
    attributes = {part.strip().lower() for part in cookie.split(";")}
    assert f"{COOKIE}=" in cookie and all(flag.lower() in attributes for flag in COOKIE_FLAGS), cookie
    jar = [c for c in http.cookies.jar if c.name == COOKIE]
    assert jar and jar[0].path == "/", cookie
    assert http.get("/api/me").json()["user"]["email"] == email
    expect_error(new_client(app_url).post("/api/auth/register", json={"name": name, "email": email,
                                                                      "password": SEED_PASSWORD}), 409, "email_taken")
    other_email, _ = person_names("acct")
    r = new_client(app_url).post("/api/auth/register", json={"name": name, "email": other_email, "password": "short"})
    assert r.status_code == 422 and "password" in r.json()["errors"], r.text
    expect_error(new_client(app_url).post("/api/auth/signin", json={"email": email, "password": "wrong-password"}),
                 401, "invalid_credentials")
    assert http.post("/api/auth/signout").status_code == 204
    expect_error(http.get("/api/me"), 401, "unauthenticated")
    for who, method, path, status in ROLE_MATRIX:
        r = staff(app_url, who).http.request(method, path, json={} if method == "POST" else None)
        assert r.status_code == status, (who, method, path, r.status_code, r.text)
        if status == 403:
            assert r.json() == {"error": "forbidden"}, r.text
    buyer, stranger = register(app_url), register(app_url)
    order = order_of(buyer, passes=[day_pass(FRI)])
    line = order["lines"][0]
    expect_error(stranger.http.get(f"/api/orders/{order['id']}"), 404, "not_found")
    expect_error(stranger.http.get(f"/api/orders/{order['id']}/passes/{line['pass']['code']}"), 404, "not_found")
    expect_error(transfer(stranger.http, order["id"], line["id"], "Someone", "someone@visitors.example"), 404, "not_found")
    assert all(o["id"] != order["id"] for o in stranger.http.get("/api/orders").json()["orders"])
    assert get_order(buyer.http, order["id"])["lines"][0]["state"] == "captured"


def test_admin_settings(app_url: str, killbill: Any) -> None:
    a = admin(app_url).http
    slug = f"probe-venue-{uuid.uuid4().hex[:6]}"
    r = a.post("/api/admin/venues", json={"id": slug, "name": "Probe Hall"})
    assert r.status_code == 201 and r.json()["id"] == slug, r.text
    expect_error(a.post("/api/admin/venues", json={"id": slug, "name": "Again"}), 409, "venue_exists")
    r = a.post("/api/admin/venues", json={"id": "Not A Slug!", "name": "Bad"})
    assert r.status_code == 422 and "id" in r.json()["errors"], r.text
    renamed = f"Probe Hall {uuid.uuid4().hex[:6]}"
    r = a.patch(f"/api/admin/venues/{slug}", json={"name": renamed})
    assert r.status_code == 200 and r.json()["id"] == slug and r.json()["name"] == renamed, r.text
    assert any(v["id"] == slug for v in programme(app_url)["venues"])
    edition = a.get("/api/admin/edition").json()
    assert (edition["first_day"], edition["last_day"]) == (THU, SUN), edition
    expect_error(a.put("/api/admin/edition", json={"name": edition["name"], "first_day": FRI, "last_day": SUN}),
                 409, "sessions_outside_edition")
    r = a.put("/api/admin/edition", json={"name": edition["name"], "first_day": SUN, "last_day": THU})
    assert (r.status_code, r.json()) in ((409, {"error": "sessions_outside_edition"}),
                                         (422, {"errors": {"last_day": "before_first_day"}})), r.text
    unchanged = a.get("/api/admin/edition").json()
    assert (unchanged["first_day"], unchanged["last_day"]) == (THU, SUN), unchanged
    r = a.put("/api/admin/edition", json={"name": edition["name"], "first_day": THU, "last_day": SUN})
    assert r.status_code == 200 and (r.json()["first_day"], r.json()["last_day"]) == (THU, SUN), r.text
    staff_list = a.get("/api/admin/staff").json()["users"]
    admins = [u for u in staff_list if u["role"] == "admin"]
    if len(admins) == 1:
        expect_error(a.patch(f"/api/admin/staff/{admins[0]['id']}", json={"role": "curator", "organisation_id": None}),
                     409, "last_admin")
    r = a.post("/api/admin/staff", json={"email": person_names("staff")[0], "name": "Probe", "password": SEED_PASSWORD,
                                         "role": "wizard", "organisation_id": None})
    expect_field(r, "role", "unknown")
    r = a.post("/api/admin/staff", json={"email": person_names("staff")[0], "name": "Probe", "password": SEED_PASSWORD,
                                         "role": "group_booker", "organisation_id": None})
    expect_field(r, "organisation_id", "required")
    policy = a.get("/api/admin/price-policy").json()
    fields = ["full_festival_full_cents", "full_festival_reduced_cents", "day_full_cents", "day_reduced_cents",
              "group_discount_percent"]
    before_buyer = register(app_url)
    before = order_of(before_buyer, passes=[day_pass(FRI)])
    assert before["lines"][0]["list_cents"] == policy["day_full_cents"]
    changed_price = policy["day_full_cents"] + 100
    r = a.put("/api/admin/price-policy", json={**{f: policy[f] for f in fields}, "day_full_cents": changed_price},
              headers={"If-Match": str(policy["version"])})
    assert r.status_code == 200 and r.json()["version"] == policy["version"] + 1, r.text
    try:
        r = a.put("/api/admin/price-policy", json={**{f: policy[f] for f in fields}, "day_full_cents": VOUCHER_MAX + 1},
                  headers={"If-Match": str(policy["version"] + 1)})
        assert r.status_code == 422 and "day_full_cents" in r.json()["errors"], r.text
        same = {**{f: policy[f] for f in fields}, "day_full_cents": changed_price}
        racers = together([lambda: admin(app_url).on(app_url).put(
            "/api/admin/price-policy", json=same, headers={"If-Match": str(policy["version"] + 1)})
            for _ in range(CONTENDERS)])
        statuses = sorted(x.status_code for x in racers)
        assert statuses == [200] + [412] * (CONTENDERS - 1), [x.text for x in racers]
        for x in racers:
            if x.status_code == 412:
                assert x.json() == {"error": "stale_version", "current_version": policy["version"] + 2}, x.text
        assert a.get("/api/admin/price-policy").json()["version"] == policy["version"] + 2
        after_buyer = register(app_url)
        after = order_of(after_buyer, passes=[day_pass(FRI)])
        assert after["lines"][0]["list_cents"] == changed_price, after
        assert get_order(before_buyer.http, before["id"])["lines"][0]["list_cents"] == policy["day_full_cents"]
        assert kb_cents(transactions(killbill.payment_by_key(after["ref"]), "CAPTURE")[0]) == after["total_cents"]
    finally:
        current = a.get("/api/admin/price-policy").json()
        a.put("/api/admin/price-policy", json={f: policy[f] for f in fields},
              headers={"If-Match": str(current["version"])})


def test_audit_trail(app_url: str) -> None:
    s = draft_session(app_url)
    assert move(app_url, "sessions", s["id"], "review").status_code == 200
    at = schedule(app_url, "sessions", s["id"])
    wait_past(at)
    poll(lambda: public_session(app_url, s["id"]).get("status") == "published", API_WAIT, "published")

    def entries(target: str) -> list[dict]:
        r = admin(app_url).http.get("/api/admin/audit", params={"target_id": target})
        assert r.status_code == 200, r.text
        return r.json()["entries"]

    got = poll(lambda: (e := entries(s["id"])) and len(e) >= 4 and e, SIDE_EFFECT_SECONDS + API_WAIT, "audit entries")
    steady(lambda: len(entries(s["id"])) == 4, SIDE_EFFECT_SECONDS, "exactly four audit entries")
    assert sum(1 for e in got if e["actor_role"] == "curator" and e["actor"]) == 3, got
    assert sum(1 for e in got if e["actor"] == "system") == 1, got
    automatic = instant(next(e for e in got if e["actor"] == "system")["at"])
    assert at <= automatic <= at + timedelta(seconds=SIDE_EFFECT_SECONDS + SKEW_SECONDS), (at, automatic)
    stamps = [instant(e["at"]) for e in got]
    assert stamps == sorted(stamps, reverse=True), "newest first"
    artist = new_staff(app_url, "artist")
    entry = new_entry(artist)
    assert upload_image(artist.http, entry["id"], "work.png", png_bytes()).status_code == 201
    assert entries(entry["id"]) == []
    assert move(app_url, "entries", entry["id"], "review", who=artist).status_code == 200
    assert len(entries(entry["id"])) == 1
    expect_error(register(app_url).http.get("/api/admin/audit"), 403, "forbidden")


def test_wf_admin_settings_staff_roles(browser: Browser, app_url: str) -> None:
    member = new_staff(app_url, "curator")
    assert member.http.get("/api/curate/sessions").status_code == 200
    with browse(browser, app_url, admin(app_url), path="/admin") as page:
        role = page.get_by_role("combobox", name=f"Role for {member.name}")
        visible(page, role)
        choose(role, "Box office", "Box-office staff", "box_office")
        says(page, page.get_by_role("status", name="Admin status"), "Saved.")
        admins = [u for u in admin(app_url).http.get("/api/admin/staff").json()["users"] if u["role"] == "admin"]
        if len(admins) == 1:
            choose(page.get_by_role("combobox", name=f"Role for {admins[0]['name']}"), "Curator", "curator")
            says(page, page.get_by_role("status", name="Admin status"), "There must be at least one admin.")
    poll(lambda: member.http.get("/api/box-office/proofs", params={"status": "pending"}).status_code == 200,
         API_WAIT, "new role active")
    expect_error(member.http.get("/api/curate/sessions"), 403, "forbidden")
    assert any(u["role"] == "admin" for u in admin(app_url).http.get("/api/admin/staff").json()["users"])


def test_wf_admin_settings_prices_stale(browser: Browser, app_url: str) -> None:
    a = admin(app_url)
    start = a.http.get("/api/admin/price-policy").json()["version"]
    with browse(browser, app_url, a, path="/admin") as first, browse(browser, app_url, a, path="/admin") as second:
        for page in (first, second):
            visible(page, page.get_by_role("button", name="Save prices"))
        click(first.get_by_role("button", name="Save prices"))
        says(first, first.get_by_role("status", name="Admin status"), "Saved.")
        click(second.get_by_role("button", name="Save prices"))
        says(second, second.get_by_role("status", name="Admin status"),
             "Someone else changed these prices. Reload to see their version.")
    assert a.http.get("/api/admin/price-policy").json()["version"] == start + 1


def test_programme_api_festival_time(app_url: str) -> None:
    body = programme(app_url)
    assert body["edition"]["time_zone"] == "Europe/Brussels"
    assert (body["edition"]["first_day"], body["edition"]["last_day"]) == (THU, SUN)
    assert [d["date"] for d in body["festival_days"]] == [THU, FRI, SAT, SUN]
    ids = [s["id"] for s in body["sessions"]]
    assert RESIDENCY not in ids and SIGNAL in ids and DAWN in ids
    starts = [instant(s["starts_at"]) for s in body["sessions"]]
    assert starts == sorted(starts)
    assert all(s["status"] in ("published", "cancelled") for s in body["sessions"])
    by_id = {s["id"]: s for s in body["sessions"]}
    sig = by_id[SIGNAL]
    assert "publish_at" not in sig and "version" not in sig
    assert instant(sig["starts_at"]) == brussels(2027, 10, 29, 20)
    assert datetime.fromisoformat(sig["starts_local"]) == brussels(2027, 10, 29, 20)
    assert sig["starts_local"].endswith("+02:00") and sig["festival_day"] == FRI
    winter = by_id[SECOND_WINTER]
    assert instant(winter["starts_at"]) == brussels(2027, 10, 31, 2, 15, fold=1)
    assert winter["starts_local"].endswith("+01:00") and winter["festival_day"] == SAT
    assert by_id[DAWN]["festival_day"] == SUN
    delta = by_id[DELTA]
    assert delta["admission"] == "pass" and delta["capacity"] is None and delta["seats_remaining"] is None
    assert delta["price_full_cents"] is None
    s = publish_session(app_url, capacity=7)
    assert s["seats_remaining"] == 7
    take_hold(register(app_url), s["id"], 2)
    live = {x["id"]: x for x in programme(app_url)["sessions"]}[s["id"]]
    assert live["seats_remaining"] == 5 and live["capacity"] == 7, live
    for field in ("day", "venue", "discipline"):
        r = httpx.get(app_url + "/api/programme", params={field: "nonsense"}, timeout=HTTP_TIMEOUT)
        expect_field(r, field, "unknown")
    assert all(x["festival_day"] == FRI for x in programme(app_url, day=FRI)["sessions"])


def test_lattice_camera(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url) as page:
        fig = lattice(page)
        visible(page, fig)
        spent = 0
        while attr(fig, "data-intro") != "running" and spent < INTRO_MS / 2:
            advance(page, FRAME_MS)
            spent += FRAME_MS
        assert attr(fig, "data-intro") == "running"
        opening = decode(capture(fig))
        advance(page, INTRO_MS)
        eventually(page, lambda: expect(fig).to_have_attribute("data-intro", "done", timeout=EXPECT_MS))
        changed(opening, decode(capture(fig)))
        middle = fig.evaluate("el => { const r = el.getBoundingClientRect(); "
                              "return r.top + window.scrollY + r.height / 2; }")
        scroll_to(page, max(0.0, middle - VIEWPORTS["1280x800"][1] / 2))
        advance(page, SECTION_MS)
        box = fig.bounding_box()
        cy, cx = box["y"] + box["height"] / 2, box["x"] + box["width"] / 2
        page.mouse.move(box["x"] + box["width"] - 1, cy)
        advance(page, SECTION_MS)
        right = decode(capture(fig))
        assert 0 < float(attr(fig, "data-yaw")) <= YAW_MAX
        page.mouse.move(box["x"] + 1, cy)
        advance(page, SECTION_MS)
        assert -YAW_MAX <= float(attr(fig, "data-yaw")) < 0
        changed(right, decode(capture(fig)))
        page.mouse.move(cx, box["y"] + box["height"] * POINTER_INSET)
        advance(page, SECTION_MS)
        assert 0 < float(attr(fig, "data-pitch")) <= PITCH_MAX
        page.mouse.move(cx, box["y"] + box["height"] * (1 - POINTER_INSET))
        advance(page, SECTION_MS)
        assert -PITCH_MAX <= float(attr(fig, "data-pitch")) < 0
        nav = page.get_by_role("navigation", name="Main").get_by_role("link", name="Programme")
        page.mouse.move(*[v for v in (nav.bounding_box()["x"] + 2, nav.bounding_box()["y"] + 2)])
        advance(page, SECTION_MS * 2)
        assert float(attr(fig, "data-yaw")) == 0 and float(attr(fig, "data-pitch")) == 0
        fractions = [k / 5 for k in range(6)]
        forward = []
        for f in fractions:
            scroll_to(page, SCROLL_FLIGHT_PX * f)
            advance(page, SECTION_MS)
            forward.append((attr(fig, "data-camera-progress"), attr(fig, "data-camera-day")))
        assert [p for p, _ in forward] == [f"{f:.2f}" for f in fractions], forward
        assert [d for _, d in forward] == ["1", "2", "2", "3", "3", "4"], forward
        backward = []
        for f in reversed(fractions):
            scroll_to(page, SCROLL_FLIGHT_PX * f)
            advance(page, SECTION_MS)
            backward.append((attr(fig, "data-camera-progress"), attr(fig, "data-camera-day")))
        assert backward == list(reversed(forward))


def test_filters_in_url(browser: Browser, app_url: str) -> None:
    fri_all = programme_titles(app_url, day=FRI)
    fri_sound = programme_titles(app_url, day=FRI, discipline="sound")
    with browse(browser, app_url) as page:
        grid = page.get_by_role("group", name="Lattice controls")
        day = grid.get_by_role("button", name=f"Day: {FRI_LABEL}", exact=True)
        sound = grid.get_by_role("button", name=f"Discipline: {SOUND}", exact=True)
        status = page.get_by_role("status", name="Programme results")
        click(day)
        pressed(page, day, True)
        shows_sessions(page, fri_all)
        eventually(page, lambda: expect(status).to_have_text(results_copy(len(fri_all)), timeout=EXPECT_MS))
        click(sound)
        pressed(page, sound, True)
        shows_sessions(page, fri_sound)
        eventually(page, lambda: expect(status).to_have_text(results_copy(len(fri_sound)), timeout=EXPECT_MS))
        q = parse_qs(urlparse(page.url).query)
        assert q.get("day") == [FRI] and q.get("discipline") == ["sound"], page.url
        has_attr(page, lattice(page), "data-raised", f"day:{FRI},discipline:sound")
        shared = page.url
        page.reload()
        shows_sessions(page, fri_sound)
        pressed(page, sound, True)
        has_attr(page, lattice(page), "data-raised", f"day:{FRI},discipline:sound")
        page.go_back()
        shows_sessions(page, fri_all)
        pressed(page, sound, False)
        assert "discipline" not in parse_qs(urlparse(page.url).query)
        page.go_forward()
        shows_sessions(page, fri_sound)
    with open_app(browser, shared) as other:
        shows_sessions(other, fri_sound)
        grid = other.get_by_role("group", name="Lattice controls")
        pressed(other, grid.get_by_role("button", name=f"Day: {FRI_LABEL}", exact=True), True)
        has_attr(other, lattice(other), "data-raised", f"day:{FRI},discipline:sound")
    with open_app(browser, f"{app_url}/?day=nonsense&venue=remise-noord") as page:
        shows_sessions(page, programme_titles(app_url, venue="remise-noord"))
        eventually(page, lambda: _query_lacks(page, "day"))
        assert parse_qs(urlparse(page.url).query).get("venue") == ["remise-noord"]


def _query_lacks(page: Page, key: str) -> None:
    assert key not in parse_qs(urlparse(page.url).query), page.url


def test_agenda_clashes(browser: Browser, app_url: str) -> None:
    with browse(browser, app_url) as page:
        add_to_agenda(page, "Signal Bodies")
        add_to_agenda(page, "Delta Choir")
        updates = page.get_by_role("status", name="Agenda updates")
        says(page, updates, "Added Delta Choir to your agenda.")
        says(page, schedule_row(page, "Signal Bodies"), "Clash with Delta Choir")
        says(page, schedule_row(page, "Delta Choir"), "Clash with Signal Bodies")
        fig = lattice(page)
        eventually(page, lambda: _assert(frozenset({SIGNAL, DELTA}) in seam_pairs(attr(fig, "data-seams"))))
        eventually(page, lambda: _assert({SIGNAL, DELTA} <= set(attr(fig, "data-lit").split(","))))
        page.reload()
        pressed(page, page.get_by_role("button", name=f"Add {DELTA_TITLE} to agenda", exact=True), True)
        says(page, schedule_row(page, "Signal Bodies"), "Clash with Delta Choir")
        click(agenda_panel(page).get_by_role("button", name=f"Remove {DELTA_TITLE} from agenda"))
        says(page, updates, "Removed Delta Choir from your agenda.")
        says(page, updates, "No clashes in your agenda.")
        eventually(page, lambda: expect(schedule_row(page, "Signal Bodies")).not_to_contain_text("Clash with",
                                                                                                timeout=EXPECT_MS))
        eventually(page, lambda: _assert(frozenset({SIGNAL, DELTA}) not in seam_pairs(attr(fig, "data-seams"))))
        for title in ("The Second Hour (second pass)", "Nachtstroom", "The Second Hour (first pass)"):
            add_to_agenda(page, title)
        says(page, schedule_row(page, "Nachtstroom"), "Clash with The Second Hour (first pass)")
        eventually(page, lambda: expect(schedule_row(page, "The Second Hour (second pass)"))
                   .not_to_contain_text("Clash with", timeout=EXPECT_MS))
        seams = seam_pairs(attr(fig, "data-seams"))
        assert frozenset({NACHT, SECOND_SUMMER}) in seams and frozenset({SECOND_SUMMER, SECOND_WINTER}) not in seams
        says(page, schedule_row(page, "The Second Hour (first pass)"), "02:15 CEST")
        says(page, schedule_row(page, "The Second Hour (second pass)"), "02:15 CET")
        panel = agenda_panel(page).inner_text()
        positions = [panel.index(t) for t in ("Nachtstroom", "The Second Hour (first pass)",
                                              "The Second Hour (second pass)")]
        assert positions == sorted(positions), panel


def _assert(condition: bool) -> None:
    assert condition


def test_keyboard_checkout(browser: Browser, app_url: str, killbill: Any) -> None:
    v = register(app_url)
    with browse(browser, app_url, v) as page:
        tab_to(page, f"Day: {FRI_LABEL}")
        page.keyboard.press("Enter")
        pressed(page, page.get_by_role("button", name=f"Day: {FRI_LABEL}", exact=True), True)
        ring = focus_ring(page)
        assert ring["width"] >= FOCUS_RING_PX and ring["ratio"] >= FOCUS_CONTRAST, ring
        tab_to(page, "Add Delta Choir to agenda")
        page.keyboard.press("Space")
        tab_to(page, "Add Signal Bodies to agenda")
        page.keyboard.press("Enter")
        says(page, schedule_row(page, "Delta Choir"), "Clash with Signal Bodies")
        tab_to(page, "Remove Signal Bodies from agenda")
        page.keyboard.press("Enter")
        says(page, page.get_by_role("status", name="Agenda updates"), "No clashes in your agenda.")
        eventually(page, lambda: _assert(agenda_panel(page).evaluate("(p) => p.contains(document.activeElement)")))
        opener = page.get_by_role("button", name="Get tickets for my agenda")
        tab_to(page, "Get tickets for my agenda")
        page.keyboard.press("Enter")
        dialog = checkout_dialog(page)
        visible(page, dialog)
        eventually(page, lambda: _assert(dialog.evaluate("(d) => d.contains(document.activeElement)")))
        for _ in range(TRAP_PRESSES):
            page.keyboard.press("Tab")
            assert dialog.evaluate("(d) => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        hidden(page, dialog)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=EXPECT_MS))
        page.keyboard.press("Enter")
        visible(page, dialog)
        tab_to(page, "Continue")
        page.keyboard.press("Enter")
        current_step(page, dialog, "Details")
        tab_to(page, "Full rate")
        page.keyboard.press("Space")
        tab_to(page, "Continue")
        page.keyboard.press("Enter")
        current_step(page, dialog, "Review and pay")
        tab_to(page, re.compile(r"^Pay €"))
        page.keyboard.press("Enter")
        ref = order_page_ref(page)
    order = order_by_ref(v.http, ref)
    assert order["status"] == "confirmed"
    assert len(transactions(killbill.payment_by_key(ref), "CAPTURE")) == 1


def test_wf_programme_explore_plan_visit(browser: Browser, app_url: str) -> None:
    v = register(app_url)
    with browse(browser, app_url, v) as page:
        fig = lattice(page)
        advance(page, INTRO_MS)
        has_attr(page, fig, "data-intro", "done")
        click(page.get_by_role("group", name="Lattice controls").get_by_role("button", name=f"Day: {FRI_LABEL}"))
        shows_sessions(page, programme_titles(app_url, day=FRI))
        add_to_agenda(page, "Signal Bodies")
        add_to_agenda(page, "Delta Choir")
        says(page, schedule_row(page, "Delta Choir"), "Clash with Signal Bodies")
        click(agenda_panel(page).get_by_role("button", name=f"Remove {SIGNAL_TITLE} from agenda"))
        says(page, page.get_by_role("status", name="Agenda updates"), "No clashes in your agenda.")
        add_to_agenda(page, "Feedback Gardens")
        dialog = open_agenda_checkout(page)
        current_step(page, dialog, "Tickets")
        visible(page, dialog.get_by_role("button", name=f"Release seat for {FEEDBACK_TITLE}"))
        says(page, dialog, "Held until")
        eventually(page, lambda: expect(dialog.get_by_role("spinbutton", name=f"Day passes for {FRI_LABEL}"))
                   .to_have_value("1", timeout=EXPECT_MS))
        expect(dialog.get_by_role("spinbutton", name="Full-festival passes")).to_have_value("0")
        assert parse_qs(urlparse(page.url).query).get("checkout") == ["tickets"]
    holds = v.http.get("/api/holds").json()["holds"]
    try:
        assert [h["session_id"] for h in holds] == [FEEDBACK], holds
        assert holds[0]["status"] == "active"
    finally:
        for h in holds:
            v.http.delete(f"/api/holds/{h['id']}")


def test_wf_programme_explore_shared_link(browser: Browser, app_url: str) -> None:
    expected = programme_titles(app_url, venue="riverside-pavilion")
    with browse(browser, app_url, viewport="375x812", reduced_motion="reduce") as page:
        static = static_lattice(page)
        visible(page, static)
        choose(schedule_region(page).get_by_role("combobox", name="Venue"), "Riverside Pavilion", "riverside-pavilion")
        shows_sessions(page, expected)
        pressed(page, page.get_by_role("button", name=f"Venue: {RIVERSIDE}", exact=True), True)
        has_attr(page, static, "data-raised", "venue:riverside-pavilion")
        shared = page.url
        click(schedule_region(page).get_by_role("button", name="Clear filters"))
        shows_sessions(page, programme_titles(app_url))
        has_attr(page, static, "data-raised", "")
    with open_app(browser, shared) as other:
        shows_sessions(other, expected)
        has_attr(other, lattice(other), "data-raised", "venue:riverside-pavilion")


def test_hold_expiry_edge(app_url: str) -> None:
    s = publish_session(app_url, capacity=2)
    first = register(app_url)
    t0 = now()
    h0 = take_hold(first, s["id"])
    t1 = now()
    lasts = instant(h0["expires_at"])
    assert t0 + timedelta(seconds=HOLD_DEFAULT_SECONDS - SKEW_SECONDS) <= lasts
    assert lasts <= t1 + timedelta(seconds=HOLD_DEFAULT_SECONDS + SKEW_SECONDS)
    assert first.http.delete(f"/api/holds/{h0['id']}").status_code == 204
    with app_copy(HOLD_SECONDS=str(HOLD_PROBE_SECONDS)) as cp:
        v = register(cp.base)
        t0 = now()
        h = take_hold(v, s["id"])
        t1 = now()
        expires = instant(h["expires_at"])
        assert t0 + timedelta(seconds=HOLD_PROBE_SECONDS - SKEW_SECONDS) <= expires
        assert expires <= t1 + timedelta(seconds=HOLD_PROBE_SECONDS + SKEW_SECONDS)
        assert h["status"] == "active" and h["seats_remaining"] == 1
        assert [x["id"] for x in v.http.get("/api/holds").json()["holds"]] == [h["id"]]
        wait_past(expires)
        assert v.http.get("/api/holds").json()["holds"] == []
        assert public_session(cp.base, s["id"])["seats_remaining"] == 2
        body = expect_error(pay(v.http, holds=[h["id"]]), 409, "hold_expired")
        assert body["hold_ids"] == [h["id"]]
        expect_error(v.http.delete(f"/api/holds/{h['id']}"), 409, "hold_not_active")
        assert v.http.get("/api/orders").json()["orders"] == []


def test_last_seat_one_winner(app_url: str) -> None:
    s = publish_session(app_url, capacity=3)
    people = [register(app_url) for _ in range(CONTENDERS)]
    calls = [lambda p=p: p.on(app_url).post("/api/holds", json={"session_id": s["id"], "quantity": 1}) for p in people]
    responses = together(calls)
    wins = [r for r in responses if r.status_code == 201]
    assert len(wins) == 3, [r.status_code for r in responses]
    for r in responses:
        if r.status_code != 201:
            assert r.status_code == 409 and r.json() == {"error": "sold_out", "seats_remaining": 0, "waitlist": True}, r.text
    assert public_session(app_url, s["id"])["seats_remaining"] == 0
    winner = next(p for p, r in zip(people, responses) if r.status_code == 201)
    winning = next(r for p, r in zip(people, responses) if p is winner).json()
    assert winner.http.delete(f"/api/holds/{winning['id']}").status_code == 204
    losers = [p for p, r in zip(people, responses) if r.status_code != 201][:4]
    second = together([lambda p=p: p.on(app_url).post("/api/holds", json={"session_id": s["id"], "quantity": 1})
                       for p in losers])
    assert sorted(r.status_code for r in second) == [201, 409, 409, 409], [r.text for r in second]
    assert public_session(app_url, s["id"])["seats_remaining"] == 0


def test_seats_remaining_exact(app_url: str) -> None:
    cap = 6
    s = publish_session(app_url, capacity=cap)
    sid = s["id"]

    def agree(expected: int) -> None:
        assert public_session(app_url, sid)["seats_remaining"] == expected
        listed = {x["id"]: x for x in programme(app_url)["sessions"]}[sid]
        assert listed["seats_remaining"] == expected

    a, b, c = register(app_url), register(app_url), register(app_url)
    ha = take_hold(a, sid, 2)
    assert ha["seats_remaining"] == cap - 2
    agree(cap - 2)
    oa = order_of(a, holds=[ha["id"]])
    agree(cap - 2)
    hb = take_hold(b, sid, 1)
    agree(cap - 3)
    assert b.http.delete(f"/api/holds/{hb['id']}").status_code == 204
    agree(cap - 2)
    oc = order_of(c, holds=[take_hold(c, sid)["id"]], rate="reduced")
    agree(cap - 3)
    l1, l2 = oa["lines"]
    assert transfer(a.http, oa["id"], l1["id"], "Probe Friend", person_names("friend")[0]).status_code == 200
    agree(cap - 3)
    assert refund(app_url, oa["id"], [l2["id"]]).status_code == 201
    agree(cap - 2)
    proof = upload_proof(c.http, oc["id"], "card.pdf", pdf_bytes())
    assert proof.status_code == 201, proof.text
    assert decide(boxoffice(app_url).http, proof.json()["id"], "reject", "Not eligible").status_code == 200
    agree(cap - 1)
    cancel_session(app_url, sid)
    agree(cap)


def test_waitlist_offers_and_lapse(app_url: str, mail: Any) -> None:
    s = publish_session(app_url, capacity=1)
    with app_copy(WAITLIST_CLAIM_SECONDS=str(CLAIM_PROBE_SECONDS)) as cp:
        a, b, c, d = (register(cp.base) for _ in range(4))
        ha = take_hold(a, s["id"])
        body = expect_error(b.http.post("/api/holds", json={"session_id": s["id"], "quantity": 1}), 409, "sold_out")
        assert body["waitlist"] is True
        wb = b.http.post(f"/api/sessions/{s['id']}/waitlist")
        assert wb.status_code == 201 and wb.json()["position"] == 1 and wb.json()["status"] == "waiting", wb.text
        expect_error(b.http.post(f"/api/sessions/{s['id']}/waitlist"), 409, "already_waiting")
        assert c.http.post(f"/api/sessions/{s['id']}/waitlist").json()["position"] == 2
        expect_error(d.http.post(f"/api/sessions/{SIGNAL}/waitlist"), 409, "seats_available")
        released = now()
        assert a.http.delete(f"/api/holds/{ha['id']}").status_code == 204

        def entry(p: Person) -> dict:
            return next(e for e in p.http.get("/api/waitlist").json()["entries"] if e["session_id"] == s["id"])

        offered = poll(lambda: (e := entry(b))["status"] == "offered" and e, SIDE_EFFECT_SECONDS + API_WAIT, "B offered")
        seen = now()
        deadline = instant(offered["offer_expires_at"])
        assert released + timedelta(seconds=CLAIM_PROBE_SECONDS - SKEW_SECONDS) <= deadline
        assert deadline <= seen + timedelta(seconds=CLAIM_PROBE_SECONDS + SKEW_SECONDS)
        assert public_session(cp.base, s["id"])["seats_remaining"] == 0
        expect_error(a.http.post("/api/holds", json={"session_id": s["id"], "quantity": 1}), 409, "sold_out")
        mails(mail, b.email, f"A seat is free: {s['title']}")
        assert d.http.post(f"/api/sessions/{s['id']}/waitlist").status_code == 201
        expect_error(d.http.post(f"/api/waitlist/{entry(d)['id']}/claim"), 409, "no_offer")
        wait_past(deadline)
        expect_error(b.http.post(f"/api/waitlist/{offered['id']}/claim"), 409, "offer_lapsed")
        nxt = poll(lambda: (e := entry(c))["status"] == "offered" and e, SIDE_EFFECT_SECONDS + API_WAIT, "C offered")
        assert entry(b)["status"] == "lapsed"
        mails(mail, c.email, f"A seat is free: {s['title']}")
        claimed = c.http.post(f"/api/waitlist/{nxt['id']}/claim")
        assert claimed.status_code == 201 and claimed.json()["quantity"] == 1, claimed.text
        assert entry(c)["status"] == "claimed"
        assert public_session(cp.base, s["id"])["seats_remaining"] == 0
        assert len(settled(mail, b.email, f"A seat is free: {s['title']}")) == 1


def test_wf_seats_waitlist_claim(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    s = publish_session(app_url, capacity=1)
    winner, visitor = register(app_url), register(app_url)
    hold = take_hold(winner, s["id"])
    with browse(browser, app_url, visitor) as page:
        row = schedule_row(page, s["title"])
        says(page, row, "Sold out")
        click(row.get_by_role("button", name=f"Join waitlist for {s['title']}"))
        says(page, page.locator("body"), f"You're number 1 on the waitlist for {s['title']}.")
        assert winner.http.delete(f"/api/holds/{hold['id']}").status_code == 204
        mails(mail, visitor.email, f"A seat is free: {s['title']}")
        page.goto(app_url + "/tickets")
        claim = page.get_by_role("button", name=f"Claim seat for {s['title']}")
        visible(page, claim)
        says(page, page.get_by_role("list", name="My waitlist"), "Claim by")
        click(claim)
        dialog = checkout_dialog(page)
        visible(page, dialog)
        to_review(page, dialog)
        click(dialog.get_by_role("button", name=re.compile(r"^Pay €")))
        ref = order_page_ref(page)
    order = order_by_ref(visitor.http, ref)
    assert [l["session_id"] for l in order["lines"]] == [s["id"]] and order["status"] == "confirmed"
    assert len(transactions(killbill.payment_by_key(ref), "CAPTURE")) == 1
    assert public_session(app_url, s["id"])["seats_remaining"] == 0


def test_wf_seats_waitlist_sold_out_message(browser: Browser, app_url: str) -> None:
    s = publish_session(app_url, capacity=1)
    visitor, rival = register(app_url), register(app_url)
    with browse(browser, app_url, visitor) as page:
        button = schedule_row(page, s["title"]).get_by_role("button", name=f"Hold a seat for {s['title']}")
        visible(page, button)
        take_hold(rival, s["id"])
        click(button)
        says(page, page.get_by_role("alert", name="Checkout problem"),
             "That was the last seat. Join the waitlist to be offered the next one.")
    assert visitor.http.get("/api/holds").json()["holds"] == []


def test_wf_seats_waitlist_hold_expiry(browser: Browser, app_url: str) -> None:
    s = publish_session(app_url, capacity=3)
    with app_copy(HOLD_SECONDS=str(HOLD_PROBE_SECONDS)) as cp:
        v = register(cp.base)
        with browse(browser, cp.base, v) as page:
            add_to_agenda(page, s["title"])
            dialog = open_agenda_checkout(page)
            release = dialog.get_by_role("button", name=f"Release seat for {s['title']}")
            visible(page, release)
            says(page, dialog, "Held until")
            hold = v.http.get("/api/holds").json()["holds"][0]
            expires = instant(hold["expires_at"])
            wait_past(expires)
            seen = page.evaluate("() => Date.now()") / 1000
            target = max(expires.timestamp(), seen + HOLD_PROBE_SECONDS) + SKEW_SECONDS
            page.clock.fast_forward(round((target - seen) * 1000))
            advance(page, SECTION_MS)
            says(page, page.locator("body"), f"Your hold on {s['title']} expired and the seat was released.")
            hidden(page, release)
        assert v.http.get("/api/holds").json()["holds"] == []
        assert public_session(cp.base, s["id"])["seats_remaining"] == 3


def test_idempotent_checkout(app_url: str, killbill: Any) -> None:
    s = publish_session(app_url)
    v = register(app_url)
    h = take_hold(v, s["id"])
    key = idempotency_key()
    body = checkout_body(holds=[h["id"]], passes=[day_pass(FRI)])
    first = v.http.post("/api/checkout", json=body, headers={"Idempotency-Key": key})
    assert first.status_code == 201, first.text
    reordered = json.dumps(dict(reversed(list(body.items()))))
    replay = v.http.post("/api/checkout", content=reordered,
                         headers={"Idempotency-Key": key, "Content-Type": "application/json"})
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replay") == "true"
    expect_error(v.http.post("/api/checkout", json={**body, "passes": [FULL_PASS]}, headers={"Idempotency-Key": key}),
                 409, "idempotency_key_reused")
    for bad in (None, "bad key!", "abc1234"):
        headers = {"Idempotency-Key": bad} if bad else {}
        expect_field(v.http.post("/api/checkout", json=body, headers=headers), "idempotency_key", "required")
    ref = first.json()["ref"]
    payment = killbill.payment_by_key(ref)
    assert len(transactions(payment, "AUTHORIZE")) == 1 and len(transactions(payment, "CAPTURE")) == 1
    h2 = take_hold(v, s["id"])
    key2 = idempotency_key()
    body2 = checkout_body(holds=[h2["id"]])
    dupes = together([lambda: v.on(app_url).post("/api/checkout", json=body2, headers={"Idempotency-Key": key2})
                      for _ in range(3)])
    assert all(r.status_code == 201 for r in dupes) and len({json.dumps(r.json(), sort_keys=True) for r in dupes}) == 1
    assert len(v.http.get("/api/orders").json()["orders"]) == 2
    assert len(transactions(killbill.payment_by_key(dupes[0].json()["ref"]), "AUTHORIZE")) == 1
    w = register(app_url)
    mine = w.http.post("/api/checkout", json=checkout_body(holds=[take_hold(w, s["id"])["id"]]),
                       headers={"Idempotency-Key": key})
    assert mine.status_code == 201 and mine.json()["ref"] != ref and mine.headers.get("Idempotent-Replay") != "true"
    x = register(app_url)
    key3 = idempotency_key()
    body3 = checkout_body(holds=[take_hold(x, s["id"])["id"]])
    expect_error(x.on(outage("APP_KILLBILL_DOWN_URL")).post("/api/checkout", json=body3,
                                                             headers={"Idempotency-Key": key3}), 503, "payment_unavailable")
    after = x.http.post("/api/checkout", json=body3, headers={"Idempotency-Key": key3})
    assert after.status_code == 201 and after.headers.get("Idempotent-Replay") != "true", after.text
    assert len(transactions(killbill.payment_by_key(after.json()["ref"]), "AUTHORIZE")) == 1


ALLOCATION_CASES = ["visitor_voucher", "group_discount_tie"]


@pytest.mark.parametrize("case", ALLOCATION_CASES, ids=ALLOCATION_CASES)
def test_allocation_exact(app_url: str, case: str) -> None:
    policy = admin(app_url).http.get("/api/admin/price-policy").json()
    if case == "visitor_voucher":
        s1 = publish_session(app_url, full=1800, reduced=1000)
        s2 = publish_session(app_url, full=1200, reduced=700)
        v = register(app_url)
        code = issue_voucher(app_url, 3333)
        order = order_of(v, holds=[take_hold(v, s1["id"])["id"], take_hold(v, s2["id"])["id"]],
                         passes=[FULL_PASS], voucher=code)
        lists = [1800, 1200, policy["full_festival_full_cents"]]
        discounts = [0, 0, 0]
    else:
        price = 1001
        s = publish_session(app_url, capacity=12, full=price, reduced=price)
        booker = new_staff(app_url, "group_booker", "vierwinden")
        code = issue_voucher(app_url, 1000)
        r, _ = group_order(booker, [(s["id"], 7)], voucher=code)
        assert r.status_code == 201, r.text
        order = r.json()
        lists = [price] * 7
        discount = half_up(Fraction(sum(lists) * policy["group_discount_percent"], 100))
        discounts = allocate(discount, lists)
    lines = sorted(order["lines"], key=lambda l: l["position"])
    assert [l["list_cents"] for l in lines] == lists
    assert [l["group_discount_cents"] for l in lines] == discounts
    after = [lp - d for lp, d in zip(lists, discounts)]
    voucher_total = min(3333 if case == "visitor_voucher" else 1000, sum(after))
    vouchers = allocate(voucher_total, after)
    assert [l["voucher_cents"] for l in lines] == vouchers
    assert [l["charged_cents"] for l in lines] == [a - vv for a, vv in zip(after, vouchers)]
    assert order["subtotal_cents"] == sum(lists) and order["group_discount_cents"] == sum(discounts)
    assert order["voucher_cents"] == voucher_total
    assert order["total_cents"] == sum(lists) - sum(discounts) - voucher_total == sum(l["charged_cents"] for l in lines)
    if case == "visitor_voucher" and policy["full_festival_full_cents"] == 9500:
        assert [l["voucher_cents"] for l in lines] == [480, 320, 2533]
        assert [l["charged_cents"] for l in lines] == [1320, 880, 6967]
    if case == "group_discount_tie":
        assert discounts[0] == max(discounts) and discounts.count(discounts[0]) <= discounts.count(min(discounts)) + 7


def test_checkout_atomicity(app_url: str, killbill: Any, mail: Any) -> None:
    minio_down, kb_down = outage("APP_MINIO_DOWN_URL"), outage("APP_KILLBILL_DOWN_URL")
    s = publish_session(app_url, capacity=40)
    ok = register(app_url)
    order = order_of(ok, holds=[take_hold(ok, s["id"])["id"]], passes=[day_pass(FRI)])
    payment = killbill.payment_by_key(order["ref"])
    assert kb_cents(transactions(payment, "AUTHORIZE")[0]) == order["total_cents"]
    assert kb_cents(transactions(payment, "CAPTURE")[0]) == order["total_cents"]
    assert len(bucket().keys(f"passes/{order['ref']}/")) == len(order["lines"])
    mails(mail, ok.email, f"Your Kerf Frequencies order {order['ref']}")
    for base, code in ((minio_down, "storage_unavailable"), (kb_down, "payment_unavailable")):
        v = register(app_url)
        h = take_hold(v, s["id"])
        expect_error(pay(v.on(base), holds=[h["id"]], passes=[day_pass(FRI)]), 503, code)
        assert v.http.get("/api/orders").json()["orders"] == []
        assert [x["id"] for x in v.http.get("/api/holds").json()["holds"]] == [h["id"]]
        for p in account_payments(killbill, f"kerf-user-{v.id}"):
            assert transactions(p, "CAPTURE") == []
            assert not transactions(p, "AUTHORIZE") or transactions(p, "VOID"), p
    reduced = register(app_url)
    r = pay(reduced.on(minio_down), holds=[take_hold(reduced, s["id"])["id"]], rate="reduced")
    assert r.status_code == 201, r.text
    pending = r.json()
    assert pending["status"] == "proof_pending" and bucket().keys(f"passes/{pending['ref']}/") == []
    pay_kb = killbill.payment_by_key(pending["ref"])
    assert len(transactions(pay_kb, "AUTHORIZE")) == 1 and transactions(pay_kb, "CAPTURE") == []
    for base, code in ((minio_down, "storage_unavailable"), (kb_down, "payment_unavailable")):
        booker = new_staff(app_url, "group_booker", "quai-lumiere")
        r, names = group_order(booker, [(s["id"], GROUP_MINIMUM)], http=booker.on(base))
        expect_error(r, 503, code)
        holders = {l["holder_name"] for o in booker.http.get("/api/orders").json()["orders"] for l in o["lines"]}
        assert not holders & set(names)
        assert len(booker.http.get("/api/holds").json()["holds"]) == 1


def test_confirmation_mail_and_pass_pdf(app_url: str, mail: Any) -> None:
    s = publish_session(app_url)
    v = register(app_url)
    order = order_of(v, holds=[take_hold(v, s["id"])["id"]], passes=[day_pass(FRI)])
    subject = f"Your Kerf Frequencies order {order['ref']}"
    mails(mail, v.email, subject)
    found = settled(mail, v.email, subject)
    assert len(found) == 1 and len(message_ids(found)) == 1, found
    assert MESSAGE_ID_RE.fullmatch(found[0]["MessageID"]), found[0]["MessageID"]
    assert [a.lower() for a in addresses(found[0]["From"])] == [FROM_ADDRESS]
    assert len(pdfs(found[0])) == len(order["lines"])
    keys = bucket().keys(f"passes/{order['ref']}/")
    for line in order["lines"]:
        code = line["pass"]["code"]
        assert PASS_RE.fullmatch(code) and line["pass"]["status"] == "valid"
        key = f"passes/{order['ref']}/{code}.pdf"
        assert key in keys, keys
        blob = bucket().get(key)
        assert blob.startswith(b"%PDF") and code.encode() in blob and line["holder_name"].encode() in blob
        assert v.email.encode() not in blob
        r = v.http.get(f"/api/orders/{order['id']}/passes/{code}")
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and r.content == blob
        expect_error(v.on(outage("APP_MINIO_DOWN_URL")).get(f"/api/orders/{order['id']}/passes/{code}"),
                     503, "storage_unavailable")
    seat = next(l for l in order["lines"] if l["kind"] == "seat")
    assert s["title"].encode() in bucket().get(f"passes/{order['ref']}/{seat['pass']['code']}.pdf")
    poll(lambda: get_order(v.http, order["id"])["confirmation_mail"] == "sent", API_WAIT, "mail marked sent")


def test_outage_pending_states(app_url: str, killbill: Any, mail: Any) -> None:
    v = register(app_url)
    r = pay(v.on(outage("APP_MAILPIT_DOWN_URL")), passes=[day_pass(FRI)])
    assert r.status_code == 201 and r.json()["confirmation_mail"] == "pending", r.text
    subject = f"Your Kerf Frequencies order {r.json()['ref']}"
    mails(mail, v.email, subject)
    assert len(message_ids(settled(mail, v.email, subject))) == 1
    s = publish_session(app_url)
    w = register(app_url)
    order = order_of(w, holds=[take_hold(w, s["id"])["id"]], passes=[day_pass(FRI)])
    seat = next(l for l in order["lines"] if l["kind"] == "seat")
    pending = refund(app_url, order["id"], [seat["id"]], http=finance(app_url).on(outage("APP_KILLBILL_DOWN_URL")))
    assert pending.status_code == 201 and pending.json()["status"] == "pending", pending.text
    rid = pending.json()["id"]

    def kb_refunds() -> list[dict]:
        return [t for t in transactions(killbill.payment_by_key(order["ref"]), "REFUND")
                if t.get("transactionExternalKey") == rid]

    poll(kb_refunds, KILLBILL_RECOVERY_SECONDS + SIDE_EFFECT_SECONDS, "refund reaches Kill Bill")
    steady(lambda: len(kb_refunds()) == 1, SIDE_EFFECT_SECONDS * 2, "exactly one Kill Bill refund")
    assert kb_cents(kb_refunds()[0]) == seat["charged_cents"]
    done = finance(app_url).http.get("/api/finance/refunds", params={"status": "completed"}).json()["refunds"]
    assert any(x["id"] == rid for x in done)


def test_wf_checkout_buy(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    s = publish_session(app_url)
    v = register(app_url)
    code = issue_voucher(app_url, 1000)
    with browse(browser, app_url, path="/signin") as page:
        fill(page.get_by_role("textbox", name="Email"), v.email)
        fill(page.get_by_role("textbox", name="Password"), SEED_PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        visible(page, page.get_by_role("navigation", name="Main").get_by_role("button", name="Sign out"))
        page.goto(app_url + "/")
        add_to_agenda(page, s["title"])
        dialog = open_agenda_checkout(page)
        visible(page, dialog.get_by_role("button", name=f"Release seat for {s['title']}"))
        fill(dialog.get_by_role("spinbutton", name=f"Day passes for {FRI_LABEL}"), "1")
        to_review(page, dialog, voucher=code)
        says(page, dialog.get_by_role("table", name="Order summary"), s["title"])
        click(dialog.get_by_role("button", name=re.compile(r"^Pay €")))
        ref = order_page_ref(page)
        says(page, page.get_by_role("status", name="Order status"), "Confirmation email: sent")
        visible(page, page.get_by_role("link", name=re.compile(r"^Download pass KFP-")).first)
    order = order_by_ref(v.http, ref)
    assert len(order["lines"]) == 2 and order["voucher_cents"] == 1000 and order["status"] == "confirmed"
    payment = killbill.payment_by_key(ref)
    assert len(transactions(payment, "AUTHORIZE")) == 1
    assert kb_cents(transactions(payment, "CAPTURE")[0]) == order["total_cents"]
    assert len(bucket().keys(f"passes/{ref}/")) == 2
    found = mails(mail, v.email, f"Your Kerf Frequencies order {ref}")
    assert len(pdfs(found[0])) == 2
    assert voucher_balance(v.http, code) == 0


def test_wf_checkout_reload_and_double_pay(browser: Browser, app_url: str, killbill: Any) -> None:
    s = publish_session(app_url)
    v = register(app_url)
    with browse(browser, app_url, v) as page:
        add_to_agenda(page, s["title"])
        dialog = open_agenda_checkout(page)
        click(dialog.get_by_role("button", name="Continue", exact=True))
        current_step(page, dialog, "Details")
        assert parse_qs(urlparse(page.url).query).get("checkout") == ["details"]
        page.reload()
        dialog = checkout_dialog(page)
        visible(page, dialog)
        current_step(page, dialog, "Details")
        click(dialog.get_by_role("button", name="Back"))
        visible(page, dialog.get_by_role("button", name=f"Release seat for {s['title']}"))
        assert len(v.http.get("/api/holds").json()["holds"]) == 1
        to_review(page, dialog)
        dialog.get_by_role("button", name=re.compile(r"^Pay €")).dblclick()
        ref = order_page_ref(page)
    orders = v.http.get("/api/orders").json()["orders"]
    assert [o["ref"] for o in orders] == [ref]
    assert len(transactions(killbill.payment_by_key(ref), "AUTHORIZE")) == 1


def test_wf_checkout_outage(browser: Browser, app_url: str, killbill: Any) -> None:
    cases = [("APP_MINIO_DOWN_URL", "We couldn't issue your passes right now. Nothing was charged. Try again in a moment."),
             ("APP_KILLBILL_DOWN_URL", "Payments are unavailable right now. Nothing was charged")]
    for env_name, copy in cases:
        base = outage(env_name)
        v = register(app_url)
        with browse(browser, base, v) as page:
            add_to_agenda(page, "Delta Choir")
            dialog = open_agenda_checkout(page)
            to_review(page, dialog)
            click(dialog.get_by_role("button", name=re.compile(r"^Pay €")))
            says(page, page.get_by_role("alert", name="Checkout problem"), copy)
        assert v.http.get("/api/orders").json()["orders"] == []
        for p in account_payments(killbill, f"kerf-user-{v.id}"):
            assert transactions(p, "CAPTURE") == []


def test_proof_upload_checks(app_url: str) -> None:
    v, stranger = register(app_url), register(app_url)
    order = order_of(v, passes=[day_pass(FRI)], rate="reduced")
    oid, ref = order["id"], order["ref"]
    refused_cases = [("card.pdf", GIF_BYTES, "file", "unsupported_type"), ("card.pdf", b"", "file", "empty"),
                     ("../card.pdf", pdf_bytes(), "file", "invalid_name"), ("a/b.pdf", pdf_bytes(), "file", "invalid_name"),
                     ("a" * (NAME_LIMIT - 3) + ".pdf", pdf_bytes(), "file", "invalid_name")]
    for name, content, field, code in refused_cases:
        expect_field(upload_proof(v.http, oid, name, content), field, code)
    expect_field(upload_proof(v.http, oid, None, b""), "file", "required")
    expect_field(upload_proof(v.http, oid, "card.pdf", pdf_bytes(), kind="pensioner"), "kind", "unknown")
    r = upload_proof(v.http, oid, "big.pdf", pdf_bytes(PROOF_LIMIT + 1))
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}, r.status_code
    expect_error(upload_proof(stranger.http, oid, "card.pdf", pdf_bytes()), 404, "not_found")
    assert bucket().keys(f"proofs/{ref}/") == []
    png = png_bytes()
    r = upload_proof(v.http, oid, PROOF_ALIAS, png, ctype="text/plain")
    assert r.status_code == 201, r.text
    proof = r.json()
    assert proof["status"] == "pending" and proof["order_ref"] == ref and proof["size_bytes"] == len(png)
    assert PROOF_ALIAS not in r.text and "proofs/" not in r.text
    expect_error(upload_proof(v.http, oid, "card.pdf", pdf_bytes()), 409, "proof_already_uploaded")
    keys = bucket().keys(f"proofs/{ref}/")
    assert len(keys) == 1 and bucket().get(keys[0]) == png
    full = order_of(v, passes=[day_pass(FRI)])
    expect_error(upload_proof(v.http, full["id"], "card.pdf", pdf_bytes()), 409, "not_proof_pending")
    edge = order_of(v, passes=[day_pass(FRI)], rate="reduced")
    assert upload_proof(v.http, edge["id"], "edge.pdf", pdf_bytes(PROOF_LIMIT)).status_code == 201
    expect_error(v.http.post(f"/api/box-office/proofs/{proof['id']}/read"), 403, "forbidden")
    link = boxoffice(app_url).http.post(f"/api/box-office/proofs/{proof['id']}/read")
    assert link.status_code == 200 and link.json()["url"].startswith("/api/files/"), link.text
    got = httpx.get(app_url + link.json()["url"], timeout=HTTP_TIMEOUT)
    assert got.status_code == 200 and got.content == png and got.headers.get("cache-control") == "no-store"
    expect_error(httpx.get(app_url + link.json()["url"] + "x", timeout=HTTP_TIMEOUT), 404, "not_found")
    with app_copy(SIGNED_READ_SECONDS=str(SIGNED_PROBE_SECONDS)) as cp:
        short = boxoffice(app_url).on(cp.base).post(f"/api/box-office/proofs/{proof['id']}/read").json()
        assert httpx.get(cp.base + short["url"], timeout=HTTP_TIMEOUT).status_code == 200
        wait_past(instant(short["expires_at"]))
        expect_error(httpx.get(cp.base + short["url"], timeout=HTTP_TIMEOUT), 410, "link_expired")


def test_proof_decisions(app_url: str, killbill: Any, mail: Any) -> None:
    bo = boxoffice(app_url)
    s = publish_session(app_url)
    v = register(app_url)
    order = order_of(v, holds=[take_hold(v, s["id"])["id"]], passes=[day_pass(FRI)], rate="reduced")
    ref = order["ref"]
    assert order["status"] == "proof_pending" and all(l["state"] == "proof_pending" for l in order["lines"])
    gap = instant(order["proof_deadline"]) - instant(order["created_at"])
    assert abs(gap.total_seconds() - PROOF_DEFAULT_SECONDS) <= SKEW_SECONDS
    assert transactions(killbill.payment_by_key(ref), "CAPTURE") == [] and bucket().keys(f"passes/{ref}/") == []
    first = mails(mail, v.email, f"Your Kerf Frequencies order {ref}")
    assert pdfs(first[0]) == []
    proof = upload_proof(v.http, order["id"], "card.pdf", pdf_bytes()).json()
    expect_error(decide(bo.on(outage("APP_MINIO_DOWN_URL")), proof["id"], "approve"), 503, "storage_unavailable")
    expect_error(decide(bo.on(outage("APP_KILLBILL_DOWN_URL")), proof["id"], "approve"), 503, "payment_unavailable")
    assert transactions(killbill.payment_by_key(ref), "CAPTURE") == [] and bucket().keys(f"passes/{ref}/") == []
    queue = bo.http.get("/api/box-office/proofs", params={"status": "pending"}).json()["proofs"]
    assert any(p["id"] == proof["id"] for p in queue)
    r = decide(bo.http, proof["id"], "approve")
    assert r.status_code == 200 and r.json()["order"]["status"] == "confirmed", r.text
    capture_tx = transactions(killbill.payment_by_key(ref), "CAPTURE")
    assert len(capture_tx) == 1 and kb_cents(capture_tx[0]) == sum(l["charged_cents"] for l in order["lines"])
    assert capture_tx[0].get("transactionExternalKey") == f"{ref}-capture"
    assert len(bucket().keys(f"passes/{ref}/")) == len(order["lines"])
    approved = mails(mail, v.email, f"Reduced rate approved — order {ref}")
    assert len(pdfs(approved[0])) == len(order["lines"])
    expect_error(decide(bo.http, proof["id"], "reject", "Late"), 409, "already_decided")
    w = register(app_url)
    code = issue_voucher(app_url, 500)
    other = order_of(w, passes=[day_pass(FRI)], rate="reduced", voucher=code)
    p2 = upload_proof(w.http, other["id"], "card.pdf", pdf_bytes()).json()
    expect_field(decide(bo.http, p2["id"], "reject"), "reason", "required")
    reason = f"Probe reason {uuid.uuid4().hex[:6]}"
    r = decide(bo.http, p2["id"], "reject", reason)
    assert r.status_code == 200 and all(l["state"] == "voided" for l in r.json()["order"]["lines"]), r.text
    pay2 = killbill.payment_by_key(other["ref"])
    assert transactions(pay2, "CAPTURE") == [] and len(transactions(pay2, "VOID")) == 1
    assert voucher_balance(w.http, code) == 500
    rejected = mails(mail, w.email, f"Reduced rate not approved — order {other['ref']}")
    assert reason in mail_text(rejected[0])


def test_proof_lapse(app_url: str, killbill: Any, mail: Any) -> None:
    with app_copy(PROOF_DECISION_SECONDS=str(PROOF_PROBE_SECONDS)) as cp:
        v = register(cp.base)
        code = issue_voucher(app_url, 500)
        order = order_of(v, passes=[day_pass(FRI)], rate="reduced", voucher=code)
        ref = order["ref"]
        deadline = instant(order["proof_deadline"])
        gap = (deadline - instant(order["created_at"])).total_seconds()
        assert abs(gap - PROOF_PROBE_SECONDS) <= SKEW_SECONDS
        proof = upload_proof(v.http, order["id"], "card.pdf", pdf_bytes()).json()
        assert instant(proof["deadline"]) == deadline
        wait_past(deadline)
        expect_error(decide(boxoffice(app_url).on(cp.base), proof["id"], "approve"), 409, "proof_hold_expired")
        poll(lambda: transactions(killbill.payment_by_key(ref), "VOID"), SIDE_EFFECT_SECONDS + API_WAIT, "void")
        payment = killbill.payment_by_key(ref)
        assert transactions(payment, "CAPTURE") == []
        assert transactions(payment, "VOID")[0].get("transactionExternalKey") == f"{ref}-void"
        lapsed = get_order(v.http, order["id"])
        assert lapsed["status"] == "voided" and all(l["state"] == "expired" for l in lapsed["lines"])
        assert voucher_balance(v.http, code) == 500
        expired = boxoffice(app_url).http.get("/api/box-office/proofs", params={"status": "expired"}).json()["proofs"]
        assert any(p["id"] == proof["id"] for p in expired)
        mails(mail, v.email, f"Reduced-rate hold expired — order {ref}")


def test_wf_reduced_rate_approve(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    v = register(app_url)
    with browse(browser, app_url, v) as page:
        add_to_agenda(page, "Delta Choir")
        dialog = open_agenda_checkout(page)
        to_review(page, dialog, rate="Reduced rate (student or jobseeker)")
        click(dialog.get_by_role("button", name=re.compile(r"^Pay €")))
        ref = order_page_ref(page)
        status = page.get_by_role("status", name="Order status")
        says(page, status, "Reduced rate awaiting proof — payment authorised, not taken.")
        panel = page.get_by_role("group", name="Proof of reduced rate")
        check(panel.get_by_role("radio", name="Student"))
        page.get_by_label("Proof document").set_input_files(
            files=[{"name": "student-card.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()}])
        click(panel.get_by_role("button", name="Upload proof"))
        says(page, page.get_by_role("status", name="Upload status"), "Proof received. We'll decide by")
    assert transactions(killbill.payment_by_key(ref), "CAPTURE") == []
    with browse(browser, app_url, boxoffice(app_url), path="/box-office") as page:
        queue = page.get_by_role("region", name="Proof queue")
        click(queue.get_by_role("button", name=f"Approve {ref}"))
        says(page, page.get_by_role("status", name="Proof decision"), f"Approved — payment taken for order {ref}.")
    assert len(transactions(killbill.payment_by_key(ref), "CAPTURE")) == 1
    assert pdfs(mails(mail, v.email, f"Reduced rate approved — order {ref}")[0])
    assert order_by_ref(v.http, ref)["status"] == "confirmed"


def test_wf_reduced_rate_bad_upload(browser: Browser, app_url: str) -> None:
    v = register(app_url)
    order = order_of(v, passes=[day_pass(FRI)], rate="reduced")
    with browse(browser, app_url, v, path=f"/orders/{order['id']}") as page:
        panel = page.get_by_role("group", name="Proof of reduced rate")
        visible(page, panel)
        check(panel.get_by_role("radio", name="Jobseeker"))
        upload = page.get_by_label("Proof document")
        upload.set_input_files(files=[{"name": "card.pdf", "mimeType": "application/pdf", "buffer": GIF_BYTES}])
        click(panel.get_by_role("button", name="Upload proof"))
        status = page.get_by_role("status", name="Upload status")
        says(page, status, "Upload a PDF, JPEG or PNG file.")
        assert bucket().keys(f"proofs/{order['ref']}/") == []
        upload.set_input_files(files=[{"name": "card.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()}])
        click(panel.get_by_role("button", name="Upload proof"))
        says(page, status, "Proof received.")
    assert len(bucket().keys(f"proofs/{order['ref']}/")) == 1


def test_transfer_reissues_pass(app_url: str, killbill: Any, mail: Any) -> None:
    s = publish_session(app_url)
    v, stranger = register(app_url), register(app_url)
    order = order_of(v, holds=[take_hold(v, s["id"], 2)["id"]])
    l1, l2 = order["lines"]
    old = l1["pass"]["code"]
    kb_before = len(transactions(killbill.payment_by_key(order["ref"])))
    expect_error(transfer(stranger.http, order["id"], l1["id"], "X", "x@visitors.example"), 404, "not_found")
    r = transfer(v.on(outage("APP_MINIO_DOWN_URL")), order["id"], l2["id"], "Nobody", "nobody@visitors.example")
    expect_error(r, 503, "storage_unavailable")
    assert get_order(v.http, order["id"])["lines"][1]["pass"]["code"] == l2["pass"]["code"]
    r = transfer(v.http, order["id"], l2["id"], "Nobody", "not-an-email")
    assert r.status_code == 422 and "recipient_email" in r.json()["errors"], r.text
    email, name = person_names("friend")
    r = transfer(v.http, order["id"], l1["id"], name, email)
    assert r.status_code == 200, r.text
    new = r.json()["pass"]
    assert new["status"] == "valid" and PASS_RE.fullmatch(new["code"]) and new["code"] != old
    assert r.json()["line"]["state"] == "transferred" and r.json()["line"]["holder_name"] == name
    expect_error(transfer(v.http, order["id"], l1["id"], name, email), 409, "already_transferred")
    refused(app_url, old, s["id"], "pass_transferred")
    assert admitted(app_url, new["code"], s["id"])["holder_name"] == name
    assert f"passes/{order['ref']}/{new['code']}.pdf" in bucket().keys(f"passes/{order['ref']}/")
    mails(mail, v.email, f"You transferred a ticket — order {order['ref']}")
    assert pdfs(mails(mail, email, f"A ticket for {s['title']} is yours")[0])
    assert len(settled(mail, email, f"A ticket for {s['title']} is yours")) == 1
    assert len(transactions(killbill.payment_by_key(order["ref"]))) == kb_before
    pending = order_of(v, holds=[take_hold(v, s["id"])["id"]], rate="reduced")
    expect_error(transfer(v.http, pending["id"], pending["lines"][0]["id"], name, email), 409, "line_not_transferable")


def test_forwarded_copies_private(app_url: str, killbill: Any, mail: Any) -> None:
    s = publish_session(app_url)
    v = register(app_url)
    code = issue_voucher(app_url, 300)
    order = order_of(v, holds=[take_hold(v, s["id"])["id"]], passes=[day_pass(FRI)], rate="reduced", voucher=code)
    proof = upload_proof(v.http, order["id"], "student-card.pdf", pdf_bytes()).json()
    assert decide(boxoffice(app_url).http, proof["id"], "approve").status_code == 200
    seat = next(l for l in order["lines"] if l["kind"] == "seat")
    email, name = person_names("friend")
    new = transfer(v.http, order["id"], seat["id"], name, email).json()["pass"]["code"]
    payment_id = killbill.payment_by_key(order["ref"])["paymentId"]
    forbidden = [v.email, code, order["ref"], payment_id, "student-card.pdf", "/api/files/"]
    amounts = {euros(l[k]) for l in order["lines"] for k in ("list_cents", "charged_cents", "voucher_cents") if l[k]}
    words = ("reduced", "student", "jobseeker")
    message = mails(mail, email, f"A ticket for {s['title']} is yours")[0]
    body = mail_text(message) + message.get("Subject", "")
    for item in forbidden:
        assert item not in body, item
    assert not [a for a in amounts if priced(body.encode(), a)], amounts
    assert not any(w in body.lower() for w in words)
    for key in bucket().keys(f"passes/{order['ref']}/"):
        blob = bucket().get(key)
        for item in forbidden:
            assert item.encode() not in blob, (key, item)
        shown = b"\n".join(pdf_strings(blob))
        assert not [a for a in amounts if priced(shown, a)], (key, amounts)
        assert not any(w.encode() in blob.lower() for w in words), key
    assert new.encode() in bucket().get(f"passes/{order['ref']}/{new}.pdf")


def test_door_admission_rules(app_url: str) -> None:
    s = publish_session(app_url)
    v = register(app_url)
    order = order_of(v, holds=[take_hold(v, s["id"], 2)["id"]], passes=[FULL_PASS, day_pass(THU), day_pass(FRI)])
    lines = order["lines"]
    seats = [l["pass"]["code"] for l in lines if l["kind"] == "seat"]
    full = next(l["pass"]["code"] for l in lines if l["kind"] == "full_festival")
    thu = next(l["pass"]["code"] for l in lines if l.get("festival_day") == THU)
    fri = next(l["pass"]["code"] for l in lines if l.get("festival_day") == FRI)
    body = admitted(app_url, full, ORBIT)
    assert body["holder_name"] == v.name and body["festival_day"] == THU
    assert refused(app_url, full, ORBIT, "already_admitted")["first_admitted_at"]
    admitted(app_url, full, LUMEN)
    refused(app_url, full, s["id"], "not_entitled")
    admitted(app_url, thu, LUMEN)
    refused(app_url, thu, ORBIT, "not_entitled")
    refused(app_url, thu, DELTA, "not_entitled")
    admitted(app_url, fri, DELTA)
    refused(app_url, fri, DELTA, "already_admitted")
    assert admitted(app_url, seats[0], s["id"])["item_title"] == s["title"]
    refused(app_url, seats[0], s["id"], "already_admitted")
    refused(app_url, seats[0], SIGNAL, "not_entitled")
    seat_line = [l for l in lines if l["kind"] == "seat"][1]
    assert refund(app_url, order["id"], [seat_line["id"]]).status_code == 201
    refused(app_url, seats[1], SIGNAL, "pass_refunded")
    gone = publish_session(app_url, admission="pass", venue="riverside-pavilion")
    cancel_session(app_url, gone["id"])
    refused(app_url, full, gone["id"], "session_cancelled")
    expect_error(scan(app_url, "KFP-ZZZZZZZZZZ", DELTA), 404, "unknown_pass")


def test_festival_day_boundaries(app_url: str) -> None:
    bo = boxoffice(app_url).http

    def report(base: str, day: str) -> dict:
        r = boxoffice(app_url).on(base).get("/api/box-office/admissions", params={"festival_day": day})
        assert r.status_code == 200, r.text
        return r.json()

    def remise(rep: dict) -> int:
        return next(v["admissions"] for v in rep["venues"] if v["venue_id"] == "remise-noord")

    for day, (y, m, d), hours in ((FRI, (2027, 10, 29), 24), (SAT, (2027, 10, 30), 25), (SUN, (2027, 10, 31), 24)):
        rep = report(app_url, day)
        assert instant(rep["starts_at"]) == brussels(y, m, d, 5) and rep["length_hours"] == hours, rep
        assert instant(rep["ends_at"]) == instant(rep["starts_at"]) + timedelta(hours=hours)
    expect_field(bo.get("/api/box-office/admissions", params={"festival_day": "2027-11-01"}),
                 "festival_day", "unknown_festival_day")
    days = {s["id"]: s["festival_day"] for s in programme(app_url)["sessions"]}
    assert [days[i] for i in (NACHT, SECOND_SUMMER, SECOND_WINTER, SHADER, DAWN)] == [SAT, SAT, SAT, SAT, SUN]
    v = register(app_url)
    sat = order_of(v, passes=[day_pass(SAT)])["lines"][0]["pass"]["code"]
    sat_before, fri_before = report(app_url, SAT), report(app_url, FRI)
    assert admitted(app_url, sat, NACHT)["festival_day"] == SAT
    refused(app_url, sat, DAWN, "not_entitled")
    sat_after = report(app_url, SAT)
    assert remise(sat_after) == remise(sat_before) + 1 and sat_after["total"] == sat_before["total"] + 1
    assert report(app_url, FRI)["total"] == fri_before["total"]
    with app_copy(TZ="Pacific/Kiritimati") as cp:
        assert {s["id"]: s["festival_day"] for s in programme(cp.base)["sessions"]}[NACHT] == SAT
        far = report(cp.base, SAT)
        assert (far["starts_at"], far["ends_at"], far["length_hours"]) == (
            sat_after["starts_at"], sat_after["ends_at"], sat_after["length_hours"])


def test_wf_transfer_door_transfer_and_scan(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    s = publish_session(app_url)
    v = register(app_url)
    order = order_of(v, holds=[take_hold(v, s["id"])["id"]])
    old = order["lines"][0]["pass"]["code"]
    email, name = person_names("friend")
    with browse(browser, app_url, v, path=f"/orders/{order['id']}") as page:
        opener = page.get_by_role("button", name=f"Transfer {s['title']}")
        click(opener)
        dialog = page.get_by_role("dialog", name="Transfer ticket")
        visible(page, dialog)
        eventually(page, lambda: expect(dialog.get_by_role("textbox", name="Recipient name")).to_be_focused(timeout=EXPECT_MS))
        fill(dialog.get_by_role("textbox", name="Recipient name"), name)
        fill(dialog.get_by_role("textbox", name="Recipient email"), email)
        click(dialog.get_by_role("button", name="Transfer ticket"))
        says(page, page.get_by_role("status", name="Order status"),
             f"Transferred to {name}. Their new pass is on its way and your old pass no longer scans.")
    new = get_order(v.http, order["id"])["lines"][0]["pass"]["code"]
    assert new != old
    with browse(browser, app_url, boxoffice(app_url), path="/box-office") as page:
        door = page.get_by_role("region", name="Door scan")
        choose(door.get_by_role("combobox", name="Session"), s["title"], s["id"])
        code_box = door.get_by_role("textbox", name="Pass code")
        result = page.get_by_role("status", name="Door scan result")
        fill(code_box, new)
        page.keyboard.press("Enter")
        says(page, result, f"Admitted — {name}, {s['title']}")
        eventually(page, lambda: expect(code_box).to_be_focused(timeout=EXPECT_MS))
        fill(code_box, old)
        click(door.get_by_role("button", name="Scan"))
        says(page, result, "This pass was transferred — ask for the new pass")
    refused(app_url, new, s["id"], "already_admitted")
    assert transactions(killbill.payment_by_key(order["ref"]), "REFUND") == []
    mails(mail, email, f"A ticket for {s['title']} is yours")


def test_wf_transfer_door_saturday_night(browser: Browser, app_url: str) -> None:
    v = register(app_url)
    code = order_of(v, passes=[day_pass(SAT)])["lines"][0]["pass"]["code"]

    def count() -> int:
        rep = boxoffice(app_url).http.get("/api/box-office/admissions", params={"festival_day": SAT}).json()
        return next(x["admissions"] for x in rep["venues"] if x["venue_id"] == "remise-noord")

    before = count()
    with browse(browser, app_url, boxoffice(app_url), path="/box-office") as page:
        door = page.get_by_role("region", name="Door scan")
        choose(door.get_by_role("combobox", name="Session"), "Nachtstroom", NACHT)
        fill(door.get_by_role("textbox", name="Pass code"), code)
        click(door.get_by_role("button", name="Scan"))
        says(page, page.get_by_role("status", name="Door scan result"), f"Admitted — {v.name}, ")
        region = page.get_by_role("region", name="Admissions")
        choose(region.get_by_role("combobox", name="Festival day"), "Sat 30 Oct", SAT)
        says(page, region.get_by_role("table", name="Admissions by venue"), str(before + 1))
    assert count() == before + 1


def test_state_machine(app_url: str) -> None:
    s = draft_session(app_url)
    sid = s["id"]
    future = wall(now() + timedelta(days=FAR_DAYS))
    for to in ("scheduled", "published", "cancelled"):
        body = expect_error(move(app_url, "sessions", sid, to, future), 409, "illegal_transition")
        assert (body["from"], body["to"]) == ("draft", to)
    assert move(app_url, "sessions", sid, "review").status_code == 200
    assert move(app_url, "sessions", sid, "draft", note="Needs work").status_code == 200
    assert move(app_url, "sessions", sid, "review").status_code == 200
    expect_field(move(app_url, "sessions", sid, "scheduled"), "publish_at", "required")
    expect_field(move(app_url, "sessions", sid, "scheduled", wall(now() - timedelta(hours=1))), "publish_at", "not_in_future")
    expect_field(move(app_url, "sessions", sid, "scheduled", "not-a-time"), "publish_at", "invalid")
    r = move(app_url, "sessions", sid, "scheduled", future)
    assert r.status_code == 200 and r.json()["session"]["status"] == "scheduled", r.text
    assert move(app_url, "sessions", sid, "review").status_code == 200
    assert move(app_url, "sessions", sid, "scheduled", future).status_code == 200
    assert move(app_url, "sessions", sid, "cancelled").status_code == 200
    for to in ("draft", "review", "scheduled", "published"):
        expect_error(move(app_url, "sessions", sid, to, future), 409, "illegal_transition")
    history = curator(app_url).http.get(f"/api/sessions/{sid}/history").json()["history"]
    assert [(h["from"], h["to"]) for h in history] == [
        ("draft", "review"), ("review", "draft"), ("draft", "review"), ("review", "scheduled"),
        ("scheduled", "review"), ("review", "scheduled"), ("scheduled", "cancelled")]
    assert all(h["by"] and h["by"] != "system" for h in history)
    live = publish_session(app_url)
    for to in ("review", "draft", "scheduled"):
        expect_error(move(app_url, "sessions", live["id"], to, future), 409, "illegal_transition")
    artist = new_staff(app_url, "artist")
    entry = new_entry(artist)
    expect_field(move(app_url, "entries", entry["id"], "review", who=artist), "images", "required")
    assert upload_image(artist.http, entry["id"], "work.png", png_bytes()).status_code == 201
    r = move(app_url, "entries", entry["id"], "review", who=artist)
    assert r.status_code == 200 and r.json()["history"][-1]["to"] == "review", r.text
    assert move(app_url, "entries", entry["id"], "draft", note="Crop it").status_code == 200


def test_publish_at_instant(app_url: str) -> None:
    s = draft_session(app_url)
    assert move(app_url, "sessions", s["id"], "review").status_code == 200
    artist = new_staff(app_url, "artist")
    entry = new_entry(artist)
    upload_image(artist.http, entry["id"], "work.png", png_bytes())
    assert move(app_url, "entries", entry["id"], "review", who=artist).status_code == 200
    at = schedule(app_url, "sessions", s["id"], lead=PUBLISH_LEAD_SECONDS * 2)
    r = move(app_url, "entries", entry["id"], "scheduled", wall(at))
    assert r.status_code == 200, r.text
    assert s["id"] not in [x["id"] for x in programme(app_url)["sessions"]]
    assert entry["id"] not in [e["id"] for e in httpx.get(app_url + "/api/gallery").json()["entries"]]
    wait_past(at)
    assert s["id"] in [x["id"] for x in programme(app_url)["sessions"]]
    assert public_session(app_url, s["id"])["status"] == "published"
    assert entry["id"] in [e["id"] for e in httpx.get(app_url + "/api/gallery").json()["entries"]]
    last = poll(lambda: (h := curator(app_url).http.get(f"/api/sessions/{s['id']}/history").json()["history"])
                and h[-1]["to"] == "published" and h[-1], SIDE_EFFECT_SECONDS + API_WAIT, "history")
    assert last["by"] == "system" and instant(last["at"]) == at


def test_clock_change_times(app_url: str) -> None:
    def create(starts: str, ends: str) -> httpx.Response:
        return curator(app_url).http.post("/api/sessions", json={
            "title": fresh_title(), "description": "Probe", "discipline": "light", "venue_id": "riverside-pavilion",
            "starts_local": starts, "ends_local": ends, "admission": "pass", "capacity": None,
            "price_full_cents": None, "price_reduced_cents": None})

    r = create("2027-10-31T02:15:00", "2027-10-31T02:45:00")
    assert r.status_code == 201, r.text
    summer = r.json()
    assert instant(summer["starts_at"]) == brussels(2027, 10, 31, 2, 15) and summer["starts_local"].endswith("+02:00")
    r = create("2027-10-31T02:15:00+01:00", "2027-10-31T02:45:00+01:00")
    assert r.status_code == 201, r.text
    winter = r.json()
    assert instant(winter["starts_at"]) == brussels(2027, 10, 31, 2, 15, fold=1)
    assert instant(winter["starts_at"]) - instant(summer["starts_at"]) == timedelta(hours=1)
    expect_field(create("2027-10-31T02:15:00+01:00", "2027-10-31T02:45:00"), "ends_local", "ends_before_start")
    expect_field(create("2027-10-31T02:15:00+03:00", "2027-10-31T02:45:00+03:00"), "starts_local", "offset_mismatch")
    expect_field(create("2027-11-05T10:00:00+01:00", "2027-11-05T11:00:00+01:00"), "starts_local", "outside_edition")
    expect_field(create("2027-10-30T12:00:00+02:00", "2027-10-30T11:00:00+02:00"), "ends_local", "ends_before_start")
    publish_wall = (now() + timedelta(days=FAR_DAYS)).astimezone(BRUSSELS).replace(
        hour=NOON_HOUR, minute=0, second=0, microsecond=0)
    assert move(app_url, "sessions", summer["id"], "review").status_code == 200
    r = move(app_url, "sessions", summer["id"], "scheduled", publish_wall.strftime("%Y-%m-%dT%H:%M:%S"))
    assert r.status_code == 200, r.text
    full = curator(app_url).http.get(f"/api/sessions/{summer['id']}").json()
    assert instant(full["publish_at"]) == publish_wall.astimezone(UTC)
    order = [s["id"] for s in programme(app_url)["sessions"]]
    assert order.index(NACHT) < order.index(SECOND_SUMMER) < order.index(SECOND_WINTER) < order.index(DAWN)


def test_stale_versions(app_url: str) -> None:
    c = curator(app_url).http
    s = draft_session(app_url)
    v1 = s["version"]
    assert v1 == 1
    newer = fresh_title("newer")
    r = c.patch(f"/api/sessions/{s['id']}", json={"title": newer}, headers={"If-Match": str(v1)})
    assert r.status_code == 200 and r.json()["version"] == v1 + 1, r.text
    r = c.patch(f"/api/sessions/{s['id']}", json={"title": "Probe stale title"}, headers={"If-Match": str(v1)})
    assert r.status_code == 412 and r.json() == {"error": "stale_version", "current_version": v1 + 1}, r.text
    expect_error(c.patch(f"/api/sessions/{s['id']}", json={"title": "x"}), 428, "version_required")
    assert c.get(f"/api/sessions/{s['id']}").json()["title"] == newer
    a = admin(app_url).http
    policy = a.get("/api/admin/price-policy").json()
    fields = {k: policy[k] for k in ("full_festival_full_cents", "full_festival_reduced_cents", "day_full_cents",
                                     "day_reduced_cents", "group_discount_percent")}
    saved = a.put("/api/admin/price-policy", json=fields, headers={"If-Match": str(policy["version"])})
    assert saved.status_code == 200 and saved.json()["version"] == policy["version"] + 1
    r = a.put("/api/admin/price-policy", json={**fields, "day_full_cents": 1}, headers={"If-Match": str(policy["version"])})
    assert r.status_code == 412 and r.json()["current_version"] == policy["version"] + 1, r.text
    expect_error(a.put("/api/admin/price-policy", json=fields), 428, "version_required")
    after = a.get("/api/admin/price-policy").json()
    assert after["version"] == policy["version"] + 1 and after["day_full_cents"] == fields["day_full_cents"]


def test_wf_curation_publish(browser: Browser, app_url: str) -> None:
    s = draft_session(app_url)
    title = s["title"]
    with browse(browser, app_url, curator(app_url), path="/curate") as page:
        click(page.get_by_role("tab", name="Sessions"))
        status = page.get_by_role("status", name="Curation status")
        click(page.get_by_role("region", name="Draft").get_by_role("button", name=f"Send {title} to review"))
        says(page, status, re.compile(rf"{re.escape(title)} moved to review\.", re.I))
        click(page.get_by_role("region", name="Review").get_by_role("button", name=f"Schedule {title}"))
        dialog = page.get_by_role("dialog", name="Schedule publishing")
        target = (now() + timedelta(minutes=1)).astimezone(BRUSSELS).replace(second=0, microsecond=0) + timedelta(minutes=1)
        fill(dialog.get_by_role("textbox", name="Publish at"), target.strftime("%Y-%m-%dT%H:%M"))
        click(dialog.get_by_role("button", name="Schedule", exact=True))
        visible(page, page.get_by_role("region", name="Scheduled").get_by_role("button", name=f"Unschedule {title}"))
    wait_past(target)
    assert s["id"] in [x["id"] for x in programme(app_url)["sessions"]]
    with browse(browser, app_url) as page:
        visible(page, schedule_row(page, title))


def test_wf_curation_past_time(browser: Browser, app_url: str) -> None:
    s = draft_session(app_url)
    assert move(app_url, "sessions", s["id"], "review").status_code == 200
    with browse(browser, app_url, curator(app_url), path="/curate") as page:
        click(page.get_by_role("tab", name="Sessions"))
        click(page.get_by_role("button", name=f"Schedule {s['title']}"))
        dialog = page.get_by_role("dialog", name="Schedule publishing")
        past = (now() - timedelta(hours=1)).astimezone(BRUSSELS)
        fill(dialog.get_by_role("textbox", name="Publish at"), past.strftime("%Y-%m-%dT%H:%M"))
        click(dialog.get_by_role("button", name="Schedule", exact=True))
        says(page, page.locator("body"), "Choose a publishing time in the future.")
    assert curator(app_url).http.get(f"/api/sessions/{s['id']}").json()["status"] == "review"


def test_entries_stay_with_artist(app_url: str) -> None:
    owner, other = new_staff(app_url, "artist"), new_staff(app_url, "artist")
    entry = new_entry(owner)
    eid = entry["id"]
    image = upload_image(owner.http, eid, "work.png", png_bytes()).json()["image"]
    for method, path, kw in [("GET", f"/api/entries/{eid}", {}), ("PATCH", f"/api/entries/{eid}", {"json": {"title": "x"}}),
                             ("POST", f"/api/entries/{eid}/transitions", {"json": {"to": "review", "note": None, "publish_at": None}}),
                             ("POST", f"/api/entries/{eid}/images/{image['id']}/read", {})]:
        expect_error(other.http.request(method, path, **kw), 404, "not_found")
    expect_error(upload_image(other.http, eid, "work.png", png_bytes()), 404, "not_found")
    assert eid not in [e["id"] for e in other.http.get("/api/entries").json()["entries"]]
    assert eid in [e["id"] for e in owner.http.get("/api/entries").json()["entries"]]
    assert curator(app_url).http.get(f"/api/entries/{eid}").status_code == 200
    expect_error(staff(app_url, ARTIST).http.get(f"/api/entries/{GHOST}"), 404, "not_found")
    assert GHOST not in [e["id"] for e in staff(app_url, ARTIST).http.get("/api/entries").json()["entries"]]
    assert owner.http.patch(f"/api/entries/{eid}", json={"medium": "Ink"}).status_code == 200
    assert move(app_url, "entries", eid, "review", who=owner).status_code == 200
    expect_error(owner.http.patch(f"/api/entries/{eid}", json={"medium": "Oil"}), 409, "not_editable")


def test_artwork_images_private(app_url: str) -> None:
    artist = new_staff(app_url, "artist")
    entry = new_entry(artist)
    eid = entry["id"]
    for name, content, code in [("x.svg", SVG_BYTES, "unsupported_type"), ("x.png", GIF_BYTES, "unsupported_type"),
                                ("x.png", png_bytes()[:40] + b"garbage", "unsupported_type"), ("x.png", b"", "empty"),
                                ("../x.png", png_bytes(), "invalid_name")]:
        expect_field(upload_image(artist.http, eid, name, content), "file", code)
    r = upload_image(artist.http, eid, "huge.png", png_bytes(size=IMAGE_LIMIT + 1))
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}, r.status_code
    assert upload_image(artist.http, eid, "edge.png", png_bytes(size=IMAGE_LIMIT)).status_code == 201
    original = png_bytes(1600, 1000)
    r = upload_image(artist.http, eid, "wide.txt", original, ctype="text/plain")
    assert r.status_code == 201 and r.json()["image"]["display_url"] is None, r.text
    image_id = r.json()["image"]["id"]
    link = artist.http.post(f"/api/entries/{eid}/images/{image_id}/read").json()
    assert link["url"].startswith("/api/files/") and "artworks/" not in link["url"]
    assert httpx.get(app_url + link["url"], timeout=HTTP_TIMEOUT).content == original
    assert curator(app_url).http.post(f"/api/entries/{eid}/images/{image_id}/read").status_code == 200
    expect_error(register(app_url).http.post(f"/api/entries/{eid}/images/{image_id}/read"), 403, "forbidden")
    expect_error(httpx.get(f"{app_url}/api/media/artworks/{image_id}", timeout=HTTP_TIMEOUT), 404, "not_found")
    assert any(k.startswith(f"artworks/originals/{eid}/") for k in bucket().keys("artworks/originals/"))
    assert move(app_url, "entries", eid, "review", who=artist).status_code == 200
    wait_past(schedule(app_url, "entries", eid))
    media = poll(lambda: (m := httpx.get(f"{app_url}/api/media/artworks/{image_id}", timeout=HTTP_TIMEOUT))
                 .status_code == 200 and m, API_WAIT, "display image served")
    assert media.headers["content-type"].startswith("image/jpeg")
    assert max(jpeg_size(media.content)) <= DISPLAY_LONGEST
    assert f"artworks/display/{eid}/{image_id}.jpg" in bucket().keys(f"artworks/display/{eid}/")
    shown = next(e for e in httpx.get(app_url + "/api/gallery").json()["entries"] if e["id"] == eid)
    assert all(img["display_url"] for img in shown["images"])


def test_wf_artist_entries_submit(browser: Browser, app_url: str) -> None:
    artist = new_staff(app_url, "artist")
    title = fresh_title("entry")
    with browse(browser, app_url, artist, path="/studio") as page:
        click(page.get_by_role("button", name="New entry"))
        fill(page.get_by_role("textbox", name="Title"), title)
        fill(page.get_by_role("textbox", name="Artist statement"), "Probe statement")
        choose(page.get_by_role("combobox", name="Discipline"), "Light", "light")
        fill(page.get_by_role("textbox", name="Medium"), "Pigment print")
        fill(page.get_by_role("textbox", name="Year"), "2026")
        click(page.get_by_role("button", name="Save draft"))
        visible(page, page.get_by_role("list", name="My entries").get_by_text(title).first)
        page.get_by_label("Artwork image").set_input_files(
            files=[{"name": "work.png", "mimeType": "image/png", "buffer": png_bytes(64, 48)}])
        click(page.get_by_role("button", name="Upload image"))
        status = page.get_by_role("status", name="Studio status")
        says(page, status, "Image uploaded.")
        click(page.get_by_role("button", name="Submit for review"))
        says(page, status, f"{title} sent for review.")
    entry = next(e for e in artist.http.get("/api/entries").json()["entries"] if e["title"] == title)
    assert entry["status"] == "review" and len(entry["images"]) == 1
    wait_past(schedule(app_url, "entries", entry["id"]))
    poll(lambda: entry["id"] in [e["id"] for e in httpx.get(app_url + "/api/gallery").json()["entries"]],
         API_WAIT, "entry in gallery")
    with browse(browser, app_url) as page:
        visible(page, page.get_by_role("region", name="Gallery").get_by_role("figure", name=f"{title} — {artist.name}"))


def test_wf_artist_entries_bad_image(browser: Browser, app_url: str) -> None:
    artist = new_staff(app_url, "artist")
    entry = new_entry(artist)
    with browse(browser, app_url, artist, path="/studio") as page:
        click(page.get_by_role("list", name="My entries").get_by_text(entry["title"]).first)
        page.get_by_label("Artwork image").set_input_files(
            files=[{"name": "work.svg", "mimeType": "image/svg+xml", "buffer": SVG_BYTES}])
        click(page.get_by_role("button", name="Upload image"))
        says(page, page.get_by_role("status", name="Studio status"), "Upload a JPEG, PNG or WebP image.")
    assert artist.http.get(f"/api/entries/{entry['id']}").json()["images"] == []


def test_refunds_affected_lines(app_url: str, killbill: Any, mail: Any) -> None:
    s1, s2 = publish_session(app_url), publish_session(app_url, full=1200, reduced=700)
    v = register(app_url)
    code = issue_voucher(app_url, 3333)
    order = order_of(v, holds=[take_hold(v, s1["id"])["id"], take_hold(v, s2["id"])["id"]], passes=[FULL_PASS], voucher=code)
    l1 = next(l for l in order["lines"] if l["session_id"] == s1["id"])
    l2 = next(l for l in order["lines"] if l["session_id"] == s2["id"])
    expect_field(refund(app_url, order["id"], []), "line_ids", "empty")
    r = finance(app_url).http.post(f"/api/finance/orders/{order['id']}/refunds", json={"line_ids": [l1["id"]], "reason": ""},
                                   headers={"Idempotency-Key": idempotency_key()})
    expect_field(r, "reason", "required")
    balance = voucher_balance(v.http, code)
    key = idempotency_key()
    first = refund(app_url, order["id"], [l1["id"]], key=key)
    assert first.status_code == 201, first.text
    rec = first.json()
    assert rec["line_ids"] == [l1["id"]] and rec["card_cents"] == l1["charged_cents"]
    assert rec["voucher_cents"] == l1["voucher_cents"] and rec["credit_note_id"] is None
    replay = refund(app_url, order["id"], [l1["id"]], key=key)
    assert replay.json() == rec and replay.headers.get("Idempotent-Replay") == "true"
    refunds = poll(lambda: transactions(killbill.payment_by_key(order["ref"]), "REFUND"), API_WAIT, "Kill Bill refund")
    assert len(refunds) == 1 and kb_cents(refunds[0]) == rec["card_cents"]
    assert refunds[0].get("transactionExternalKey") == rec["id"]
    assert voucher_balance(v.http, code) == balance + l1["voucher_cents"]
    body = expect_error(refund(app_url, order["id"], [l1["id"]]), 409, "line_not_refundable")
    assert body["line_ids"] == [l1["id"]]
    notice = mails(mail, v.email, f"Refund for order {order['ref']}")
    assert s1["title"] in mail_text(notice[0]) and s2["title"] not in mail_text(notice[0])
    assert len(settled(mail, v.email, f"Refund for order {order['ref']}")) == 1
    after = get_order(v.http, order["id"])
    assert after["status"] == "refunded_partial"
    admitted(app_url, l2["pass"]["code"], s2["id"])
    refused(app_url, l1["pass"]["code"], s1["id"], "pass_refunded")


def test_voucher_ledger(app_url: str) -> None:
    code = issue_voucher(app_url, LEDGER_VOUCHER_CENTS)
    for bad in (0, VOUCHER_MAX + 1):
        r = finance(app_url).http.post("/api/finance/vouchers", json={"amount_cents": bad, "note": "x"})
        expect_field(r, "amount_cents", "out_of_range")
    issue = ledger(app_url, code)["movements"]
    assert [m["kind"] for m in issue] == ["issue"] and issue[0]["amount_cents"] == LEDGER_VOUCHER_CENTS
    buyers = [register(app_url) for _ in range(2)]
    results = together([lambda b=b: pay(b.on(app_url), passes=[day_pass(FRI)], voucher=code) for b in buyers])
    taken = 0
    for r in results:
        if r.status_code == 201:
            taken += r.json()["voucher_cents"]
        else:
            expect_field(r, "voucher_code", "empty")
    assert taken == LEDGER_VOUCHER_CENTS
    book = ledger(app_url, code)
    account = f"voucher:{code}"
    for m in book["movements"]:
        assert len(m["entries"]) == 2 and {e["side"] for e in m["entries"]} == {"debit", "credit"}
        assert all(e["amount_cents"] == m["amount_cents"] for e in m["entries"])
        sides = {e["side"]: e["account"] for e in m["entries"]}
        expected = {"issue": ("voucher-sales", account), "redeem": (account, f"order:{m['order_ref']}"),
                    "return": (f"order:{m['order_ref']}", account)}[m["kind"]]
        assert (sides["debit"], sides["credit"]) == expected, m

    def from_entries(movements: list[dict]) -> int:
        return sum((e["amount_cents"] if e["side"] == "credit" else -e["amount_cents"])
                   for m in movements for e in m["entries"] if e["account"] == account)

    assert book["balance_cents"] == from_entries(book["movements"]) == 0 == voucher_balance(buyers[0].http, code)
    winner = next(b for b, r in zip(buyers, results) if r.status_code == 201 and r.json()["voucher_cents"])
    order = next(r.json() for r in results if r.status_code == 201 and r.json()["voucher_cents"])
    assert refund(app_url, order["id"], [order["lines"][0]["id"]]).status_code == 201
    later = ledger(app_url, code)
    assert later["movements"][: len(book["movements"])] == book["movements"] or \
        [m for m in later["movements"] if m["id"] in {x["id"] for x in book["movements"]}] == book["movements"]
    returned = [m for m in later["movements"] if m["kind"] == "return"]
    assert len(returned) == 1 and returned[0]["order_ref"] == order["ref"]
    assert later["balance_cents"] == from_entries(later["movements"]) == voucher_balance(winner.http, code) \
        == LEDGER_VOUCHER_CENTS
    r = finance(app_url).http.get("/api/finance/ledger", params={"account": "voucher:NOPE"})
    expect_field(r, "account", "unknown")


def test_wf_cancellation_refunds_cancel(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    s = publish_session(app_url, capacity=20)
    other = publish_session(app_url, full=1200, reduced=700)
    v, p = register(app_url), register(app_url)
    code = issue_voucher(app_url, 1000)
    vo = order_of(v, holds=[take_hold(v, s["id"])["id"]], passes=[day_pass(FRI)], voucher=code)
    po = order_of(p, holds=[take_hold(p, s["id"])["id"]], rate="reduced")
    booker = new_staff(app_url, "group_booker", "vierwinden")
    r, _ = group_order(booker, [(s["id"], 3), (other["id"], 2)])
    go = r.json()
    with browse(browser, app_url, curator(app_url), path="/curate") as page:
        click(page.get_by_role("tab", name="Sessions"))
        click(page.get_by_role("region", name="Published").get_by_role("button", name=f"Cancel {s['title']}"))
        dialog = page.get_by_role("dialog", name="Cancel session")
        click(dialog.get_by_role("button", name="Cancel session and refund"))
        says(page, page.get_by_role("status", name="Curation status"),
             re.compile(rf"{re.escape(s['title'])} cancelled\. Refunds started for \d+ orders\."))
    seat = next(l for l in vo["lines"] if l["kind"] == "seat")
    refunds = poll(lambda: transactions(killbill.payment_by_key(vo["ref"]), "REFUND"), API_WAIT, "card refund")
    assert len(refunds) == 1 and kb_cents(refunds[0]) == seat["charged_cents"]
    assert voucher_balance(v.http, code) == seat["voucher_cents"]
    notice = mails(mail, v.email, f"Refund for order {vo['ref']}")
    assert len(settled(mail, v.email, f"Refund for order {vo['ref']}")) == 1 and s["title"] in mail_text(notice[0])
    poll(lambda: transactions(killbill.payment_by_key(po["ref"]), "VOID"), API_WAIT, "pending authorisation voided")
    assert transactions(killbill.payment_by_key(po["ref"]), "CAPTURE") == []
    assert get_order(p.http, po["id"])["lines"][0]["state"] == "voided"
    mails(mail, booker.email, None)
    credit = [m for m in settled(mail, booker.email, None) if m.get("Subject", "").startswith("Credit note CN-")]
    assert len(credit) == 1
    day = next(l for l in vo["lines"] if l["kind"] == "day")
    admitted(app_url, day["pass"]["code"], DELTA)
    kept = next(l for l in go["lines"] if l["session_id"] == other["id"])
    admitted(app_url, kept["pass"]["code"], other["id"])
    refused(app_url, seat["pass"]["code"], s["id"], "pass_refunded")


def test_wf_cancellation_refunds_group_credit(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    s = publish_session(app_url)
    booker = new_staff(app_url, "group_booker", "quai-lumiere")
    r, _ = group_order(booker, [(s["id"], GROUP_MINIMUM)])
    order = r.json()
    with browse(browser, app_url, curator(app_url), path="/curate") as page:
        click(page.get_by_role("tab", name="Sessions"))
        click(page.get_by_role("button", name=f"Cancel {s['title']}"))
        click(page.get_by_role("dialog", name="Cancel session").get_by_role("button", name="Cancel session and refund"))
        says(page, page.get_by_role("status", name="Curation status"), f"{s['title']} cancelled.")
    invoice = poll(lambda: (i := booker.http.get(f"/api/invoices/{order['invoice_id']}").json())["credit_note_ids"] and i,
                   API_WAIT, "credit note issued")
    assert len(invoice["credit_note_ids"]) == 1 and invoice["credited_cents"] == order["total_cents"]
    note = booker.http.get(f"/api/credit-notes/{invoice['credit_note_ids'][0]}").json()
    assert CREDIT_NOTE_RE.fullmatch(note["number"]) and len(note["lines"]) == GROUP_MINIMUM
    mails(mail, booker.email, f"Credit note {note['number']} from Kerf Collective")
    assert killbill.payment_by_key(order["ref"]) is None


def test_group_checkout_invoice(app_url: str, killbill: Any, mail: Any) -> None:
    s = publish_session(app_url)
    booker = new_staff(app_url, "group_booker", "vierwinden")
    h4 = take_hold(booker, s["id"], GROUP_MINIMUM - 1)
    expect_field(pay(booker.http, holds=[h4["id"]], names=["A", "B", "C", "D"]), "items", "group_minimum")
    booker.http.delete(f"/api/holds/{h4['id']}")
    h = take_hold(booker, s["id"], GROUP_MINIMUM)
    expect_field(pay(booker.http, holds=[h["id"]], names=["A", "B"]), "attendee_names", "count_mismatch")
    expect_field(pay(booker.http, holds=[h["id"]], names=["A", "B", " ", "D", "E"]), "attendee_names", "blank")
    expect_field(pay(booker.http, holds=[h["id"]], rate="reduced", names=list("ABCDE")), "rate", "not_for_groups")
    names = [f"Pupil {uuid.uuid4().hex[:8]}" for _ in range(GROUP_MINIMUM)]
    r = pay(booker.http, holds=[h["id"]], names=names)
    assert r.status_code == 201, r.text
    order = r.json()
    pct = admin(app_url).http.get("/api/admin/price-policy").json()["group_discount_percent"]
    assert order["organisation_id"] == "vierwinden" and order["rate"] == "full"
    assert order["group_discount_cents"] == half_up(Fraction(order["subtotal_cents"] * pct, 100))
    lines = sorted(order["lines"], key=lambda l: l["position"])
    assert [l["holder_name"] for l in lines] == names and all(l["state"] == "captured" for l in lines)
    lists = [l["list_cents"] for l in lines]
    assert [l["group_discount_cents"] for l in lines] == allocate(order["group_discount_cents"], lists)
    assert [l["charged_cents"] for l in lines] == [l["list_cents"] - l["group_discount_cents"] - l["voucher_cents"]
                                                   for l in lines]
    assert sum(l["charged_cents"] for l in lines) == order["total_cents"]
    invoice = booker.http.get(f"/api/invoices/{order['invoice_id']}").json()
    assert {x["line_id"]: x["amount_cents"] for x in invoice["lines"]} == {l["id"]: l["charged_cents"] for l in lines}
    assert INVOICE_RE.fullmatch(invoice["number"]) and invoice["amount_cents"] == order["total_cents"]
    assert invoice["status"] == "issued" and len(invoice["lines"]) == GROUP_MINIMUM
    assert instant(invoice["due_at"]) - instant(invoice["issued_at"]) == timedelta(
        seconds=DUE_BILLING_DAYS * BILLING_DAY_DEFAULT_SECONDS)
    assert len(bucket().keys(f"passes/{order['ref']}/")) == GROUP_MINIMUM
    assert killbill.account_by_key("kerf-org-vierwinden") is not None
    charges = kb_charges(kb_items("kerf-org-vierwinden", killbill), order["ref"])
    assert len(charges) == GROUP_MINIMUM and len({c["invoiceId"] for c in charges}) == 1, charges
    assert sorted((c["description"], kb_cents(c)) for c in charges) == sorted(
        (f"{order['ref']} · {l['title']} · {l['holder_name']}", l["charged_cents"]) for l in lines), charges
    assert killbill.payment_by_key(order["ref"]) is None
    mails(mail, booker.email, f"Invoice {invoice['number']} from Kerf Collective")
    assert len(pdfs(mails(mail, booker.email, f"Your Kerf Frequencies order {order['ref']}")[0])) == GROUP_MINIMUM


def test_org_scoped_details(app_url: str) -> None:
    s = publish_session(app_url)
    mine = new_staff(app_url, "group_booker", "vierwinden")
    colleague = new_staff(app_url, "group_booker", "vierwinden")
    rival = new_staff(app_url, "group_booker", "quai-lumiere")
    r, _ = group_order(mine, [(s["id"], GROUP_MINIMUM)])
    order = r.json()
    line = order["lines"][0]
    assert refund(app_url, order["id"], [line["id"]]).status_code == 201
    invoice = mine.http.get(f"/api/invoices/{order['invoice_id']}").json()
    note_id = invoice["credit_note_ids"][0]
    for path in (f"/api/orders/{order['id']}", f"/api/orders/{order['id']}/passes/{order['lines'][1]['pass']['code']}",
                 f"/api/invoices/{invoice['id']}", f"/api/credit-notes/{note_id}"):
        expect_error(rival.http.get(path), 404, "not_found")
        assert colleague.http.get(path).status_code == 200, path
        assert finance(app_url).http.get(path).status_code == 200, path
    expect_error(transfer(rival.http, order["id"], order["lines"][1]["id"], "X", "x@visitors.example"), 404, "not_found")
    assert order["id"] not in [o["id"] for o in rival.http.get("/api/orders").json()["orders"]]
    assert invoice["id"] not in [i["id"] for i in rival.http.get("/api/invoices").json()["invoices"]]
    r2, _ = group_order(rival, [(s["id"], GROUP_MINIMUM)])
    foreign = r2.json()["lines"][0]["pass"]["code"]
    expect_error(mine.http.get(f"/api/orders/{order['id']}/passes/{foreign}"), 404, "not_found")


def test_org_scoped_derived(app_url: str) -> None:
    s = publish_session(app_url)
    mine = new_staff(app_url, "group_booker", "vierwinden")
    rival = new_staff(app_url, "group_booker", "quai-lumiere")
    before, rival_before = mine.http.get("/api/group/dashboard").json(), rival.http.get("/api/group/dashboard").json()
    assert before["organisation"]["id"] == "vierwinden"
    r, names = group_order(mine, [(s["id"], GROUP_MINIMUM)])
    order = r.json()
    after = mine.http.get("/api/group/dashboard").json()
    assert after["orders"] == before["orders"] + 1 and after["tickets"] == before["tickets"] + GROUP_MINIMUM
    assert after["invoiced_cents"] == before["invoiced_cents"] + order["total_cents"]
    assert after["outstanding_cents"] == before["outstanding_cents"] + order["total_cents"]
    assert rival.http.get("/api/group/dashboard").json() == rival_before
    token = names[0].split()[-1]
    hits = mine.http.get("/api/group/attendees", params={"q": token.upper()}).json()["attendees"]
    assert [(h["name"], h["order_ref"]) for h in hits] == [(names[0], order["ref"])]
    assert rival.http.get("/api/group/attendees", params={"q": token}).json()["attendees"] == []
    expect_field(mine.http.get("/api/group/attendees", params={"q": "a"}), "q", "too_short")
    csv = mine.http.get("/api/group/export.csv")
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    rows = csv.text.splitlines()
    assert rows[0] == "order_ref,attendee_name,item,festival_day,list_eur,group_discount_eur,voucher_eur,invoiced_eur,state"
    ours = [row.split(",") for row in rows[1:] if row.startswith(order["ref"] + ",")]
    assert sorted(r[1] for r in ours) == sorted(names) and all(re.fullmatch(r"\d+\.\d{2}", r[4]) for r in ours)
    assert ours[0][4] == euros(order["lines"][0]["list_cents"])
    assert order["ref"] not in rival.http.get("/api/group/export.csv").text


def test_wf_group_booking_class(browser: Browser, app_url: str, mail: Any) -> None:
    s = publish_session(app_url)
    booker = new_staff(app_url, "group_booker", "vierwinden")
    take_hold(booker, s["id"], GROUP_MINIMUM)
    names = [f"Pupil {uuid.uuid4().hex[:8]}" for _ in range(GROUP_MINIMUM)]
    with browse(browser, app_url, booker, path="/?checkout=tickets") as page:
        dialog = checkout_dialog(page)
        visible(page, dialog)
        visible(page, dialog.get_by_role("button", name=f"Release seat for {s['title']}").first)
        to_review(page, dialog, rate=None, attendees=names)
        click(dialog.get_by_role("button", name="Place order on invoice"))
        ref = order_page_ref(page)
        page.goto(app_url + "/group")
        visible(page, page.get_by_role("table", name="Group orders").get_by_text(ref).first)
        fill(page.get_by_role("searchbox", name="Search attendees"), names[2].split()[-1])
        page.keyboard.press("Enter")
        visible(page, page.get_by_text(names[2]).first)
        href = page.get_by_role("link", name="Export CSV").get_attribute("href")
        export = page.request.get(href if href.startswith("http") else app_url + href).text()
    order = order_by_ref(booker.http, ref)
    invoice = booker.http.get(f"/api/invoices/{order['invoice_id']}").json()
    mails(mail, booker.email, f"Invoice {invoice['number']} from Kerf Collective")
    assert all(n in export for n in names)
    other_refs = {o["ref"] for o in staff(app_url, QUAI_BOOKER).http.get("/api/orders").json()["orders"]}
    assert not any(r in export for r in other_refs)


def test_wf_group_booking_minimum(browser: Browser, app_url: str) -> None:
    s = publish_session(app_url)
    booker = new_staff(app_url, "group_booker", "quai-lumiere")
    take_hold(booker, s["id"], GROUP_MINIMUM - 1)
    names = [f"Pupil {k}" for k in range(1, GROUP_MINIMUM)]
    with browse(browser, app_url, booker, path="/?checkout=tickets") as page:
        dialog = checkout_dialog(page)
        visible(page, dialog)
        visible(page, dialog.get_by_role("button", name=f"Release seat for {s['title']}").first)
        alert = page.get_by_role("alert", name="Checkout problem")
        minimum = "Group bookings need at least 5 tickets."

        def refused() -> bool:
            return any(minimum in alert.nth(i).inner_text() for i in range(alert.count()))

        def reached(step: str) -> bool:
            item = dialog.get_by_role("list", name="Checkout steps").get_by_role("listitem").filter(has_text=step)
            eventually(page, lambda: _assert(refused() or item.get_attribute("aria-current") == "step"))
            return not refused()

        if not refused():
            click(dialog.get_by_role("button", name="Continue", exact=True))
            if reached("Details"):
                for k, name in enumerate(names, start=1):
                    fill(dialog.get_by_role("textbox", name=f"Attendee {k} name"), name)
                click(dialog.get_by_role("button", name="Continue", exact=True))
                if reached("Review and pay"):
                    click(dialog.get_by_role("button", name="Place order on invoice"))
        says(page, alert, minimum)
    holders = {l["holder_name"] for o in booker.http.get("/api/orders").json()["orders"] for l in o["lines"]}
    assert not holders & set(names)


def test_invoice_collection_on_due(app_url: str, killbill: Any) -> None:
    day = BILLING_PROBE_SECONDS
    s = publish_session(app_url)
    with app_copy(BILLING_DAY_SECONDS=str(day)) as cp:
        booker = new_staff(app_url, "group_booker", "quai-lumiere")
        r, _ = group_order(booker, [(s["id"], GROUP_MINIMUM)], http=booker.on(cp.base))
        assert r.status_code == 201, r.text
        order = r.json()
        fin = finance(app_url).on(cp.base)
        inv_path = f"/api/invoices/{order['invoice_id']}"
        invoice = fin.get(inv_path).json()
        number = invoice["number"]
        due = instant(invoice["due_at"])
        assert due - instant(invoice["issued_at"]) == timedelta(seconds=DUE_BILLING_DAYS * day)
        assert invoice["status"] == "issued" and invoice["paid_cents"] == 0, invoice
        assert killbill.payment_by_key(f"{number}-1") is None
        wait_past(due)
        paid = poll(lambda: (i := fin.get(inv_path).json())["status"] == "paid" and i,
                    SIDE_EFFECT_SECONDS + API_WAIT, "invoice paid")
        assert paid["paid_cents"] == paid["amount_cents"] and paid["balance_cents"] == 0, paid
        collection = killbill.payment_by_key(f"{number}-1")
        assert collection is not None
        taken = [t for t in transactions(collection) if t["transactionType"] != "CHARGEBACK"]
        assert len(taken) == 1 and kb_cents(taken[0]) == paid["amount_cents"], collection
        steady(lambda: killbill.payment_by_key(f"{number}-2") is None, SIDE_EFFECT_SECONDS, "collected exactly once")


def test_invoice_returns_and_writeoff(app_url: str, killbill: Any, mail: Any) -> None:
    day = BILLING_PROBE_SECONDS
    s = publish_session(app_url)
    with app_copy(BILLING_DAY_SECONDS=str(day)) as cp:
        booker = new_staff(app_url, "group_booker", "vierwinden")
        r, _ = group_order(booker, [(s["id"], GROUP_MINIMUM)], http=booker.on(cp.base))
        assert r.status_code == 201, r.text
        order = r.json()
        fin = finance(app_url).on(cp.base)
        inv_path = f"/api/invoices/{order['invoice_id']}"
        invoice = fin.get(inv_path).json()
        number = invoice["number"]
        due = instant(invoice["due_at"])
        assert due - instant(invoice["issued_at"]) == timedelta(seconds=DUE_BILLING_DAYS * day)
        expect_error(fin.post(f"/api/finance/invoices/{invoice['id']}/returns", json={"note": "Early"}), 409, "not_collected")
        wait_past(due)
        paid = poll(lambda: (i := fin.get(inv_path).json())["status"] == "paid" and i, SIDE_EFFECT_SECONDS + API_WAIT, "paid")
        assert paid["paid_cents"] == paid["amount_cents"]
        first_pay = killbill.payment_by_key(f"{number}-1")
        assert len([t for t in transactions(first_pay) if t["transactionType"] != "CHARGEBACK"]) == 1
        assert killbill.payment_by_key(f"{number}-2") is None
        expect_field(fin.post(f"/api/finance/invoices/{invoice['id']}/returns", json={"note": ""}), "note", "required")
        schedule_start: datetime | None = None
        for attempt, offset in enumerate(RETRY_DAYS, start=1):
            r = fin.post(f"/api/finance/invoices/{invoice['id']}/returns", json={"note": f"Bank return {attempt}"})
            assert r.status_code == 200 and r.json()["status"] == "payment_failed", r.text
            nxt = instant(r.json()["next_retry_at"])
            schedule_start = schedule_start or nxt - timedelta(seconds=day)
            assert nxt == schedule_start + timedelta(seconds=offset * day)
            poll(lambda: transactions(killbill.payment_by_key(f"{number}-{attempt}"), "CHARGEBACK"), API_WAIT, "chargeback")
            poll(lambda: fin.get(inv_path).json()["retries_used"] == attempt,
                 (nxt - now()).total_seconds() + SIDE_EFFECT_SECONDS + API_WAIT, f"retry {attempt}")
            assert fin.get(inv_path).json()["status"] in ("retried", "paid")
            assert killbill.payment_by_key(f"{number}-{attempt + 1}") is not None
        r = fin.post(f"/api/finance/invoices/{invoice['id']}/returns", json={"note": "Final return"})
        assert r.status_code == 200 and r.json()["status"] == "written_off", r.text
        mails(mail, booker.email, f"Payment returned — invoice {number}", expected=len(RETRY_DAYS) + 1)


def test_credit_notes(app_url: str, killbill: Any, mail: Any) -> None:
    s = publish_session(app_url)
    booker = new_staff(app_url, "group_booker", "vierwinden")
    r, names = group_order(booker, [(s["id"], GROUP_MINIMUM)])
    order = r.json()
    line, kept = order["lines"][0], order["lines"][1]
    rec = refund(app_url, order["id"], [line["id"]])
    assert rec.status_code == 201 and rec.json()["credit_note_id"], rec.text
    note = booker.http.get(f"/api/credit-notes/{rec.json()['credit_note_id']}").json()
    assert CREDIT_NOTE_RE.fullmatch(note["number"]) and note["amount_cents"] == line["charged_cents"]
    assert [(l["line_id"], l["amount_cents"]) for l in note["lines"]] == [(line["id"], line["charged_cents"])]
    invoice = booker.http.get(f"/api/invoices/{order['invoice_id']}").json()
    assert invoice["credited_cents"] == line["charged_cents"]
    assert invoice["balance_cents"] == invoice["amount_cents"] - invoice["credited_cents"] - invoice["paid_cents"]
    message = mails(mail, booker.email, f"Credit note {note['number']} from Kerf Collective")[0]
    assert line["holder_name"] in mail_text(message) and kept["holder_name"] not in mail_text(message)
    assert killbill.payment_by_key(order["ref"]) is None

    def adjustments() -> tuple[dict, list[dict]]:
        items = kb_items("kerf-org-vierwinden", killbill)
        charges = {c["invoiceItemId"]: c for c in kb_charges(items, order["ref"])}
        return charges, [i for i in items if i.get("itemType") == "ITEM_ADJ" and i.get("linkedInvoiceItemId") in charges]

    poll(lambda: adjustments()[1], API_WAIT, "Kill Bill item adjustment")
    charges, adj = adjustments()
    assert len(charges) == GROUP_MINIMUM and len(adj) == 1, adj
    assert charges[adj[0]["linkedInvoiceItemId"]]["description"].endswith(f" · {line['holder_name']}"), adj
    assert kb_cents(adj[0]) == -line["charged_cents"], adj
    after = get_order(booker.http, order["id"])
    assert after["lines"][0]["state"] == "refunded" and after["lines"][1]["state"] == "captured"


def test_reconciliation(app_url: str, killbill: Any) -> None:
    v = register(app_url)
    order = order_of(v, passes=[day_pass(FRI)])
    own = len(transactions(killbill.payment_by_key(order["ref"])))
    key, tx = out_of_app_purchase(killbill, v, DIRECT_PURCHASE_CENTS)
    fin = finance(app_url).http
    r = fin.post("/api/finance/reconciliation-runs")
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["checked_transactions"] >= own + 1 and run["finished_at"]
    assert all(m["order_ref"] != order["ref"] for m in run["mismatches"])
    found = [m for m in run["mismatches"] if m["killbill_transaction_id"] == tx["transactionId"]]
    assert len(found) == 1, run["mismatches"]
    m = found[0]
    assert (m["type"], m["status"], m["run_id"]) == ("unknown_in_app", "open", run["id"]), m
    assert m["killbill_amount_cents"] == DIRECT_PURCHASE_CENTS and m["app_amount_cents"] is None, m
    assert m["order_ref"] is None and (m["note"], m["resolved_by"], m["resolved_at"]) == (None, None, None), m
    again = fin.get(f"/api/finance/reconciliation-runs/{run['id']}").json()
    assert again["id"] == run["id"] and again["mismatches"] == run["mismatches"]

    def ours() -> list[dict]:
        listed = fin.get("/api/finance/mismatches").json()["mismatches"]
        return [x for x in listed if x["killbill_transaction_id"] == tx["transactionId"]]

    assert fin.post("/api/finance/reconciliation-runs").status_code == 201
    assert [x["id"] for x in ours()] == [m["id"]], "a still-open mismatch is never duplicated"
    expect_field(fin.post(f"/api/finance/mismatches/{m['id']}/resolve", json={"note": ""}), "note", "required")
    assert [x["status"] for x in ours()] == ["open"]
    kb_before = killbill.payment_by_key(key)["transactions"]
    note = f"Manual charge booked by hand {uuid.uuid4().hex[:6]}"
    started = now()
    r = fin.post(f"/api/finance/mismatches/{m['id']}/resolve", json={"note": note})
    assert r.status_code == 200, r.text
    done = r.json()
    assert (done["id"], done["status"], done["note"], done["resolved_by"]) == (m["id"], "resolved", note, FINANCE), done
    assert started - timedelta(seconds=SKEW_SECONDS) <= instant(done["resolved_at"]) <= now() + timedelta(seconds=SKEW_SECONDS)
    expect_error(fin.post(f"/api/finance/mismatches/{m['id']}/resolve", json={"note": note}), 409, "already_resolved")
    assert killbill.payment_by_key(key)["transactions"] == kb_before, "resolving changes nothing in Kill Bill"
    assert fin.post("/api/finance/reconciliation-runs").status_code == 201
    assert [(x["id"], x["status"]) for x in ours()] == [(m["id"], "resolved")], "a resolved mismatch is never reopened"
    audit = fin.get("/api/admin/audit", params={"target_id": m["id"]}).json()["entries"]
    assert len(audit) == 1 and audit[0]["actor"] in actor_of(finance(app_url)), audit
    assert audit[0]["actor_role"] == "finance", audit
    probe_id = f"missing-{uuid.uuid4().hex[:6]}"
    expect_error(fin.post(f"/api/finance/mismatches/{probe_id}/resolve", json={"note": "x"}), 404, "not_found")
    expect_error(finance(app_url).on(outage("APP_KILLBILL_DOWN_URL")).post("/api/finance/reconciliation-runs"),
                 503, "payment_unavailable")
    expect_error(v.http.post("/api/finance/reconciliation-runs"), 403, "forbidden")


def test_wf_finance_close_reconcile(browser: Browser, app_url: str, killbill: Any) -> None:
    v = register(app_url)
    order_of(v, passes=[day_pass(FRI)])
    key, tx = out_of_app_purchase(killbill, v, DIRECT_PURCHASE_CENTS)
    fin = finance(app_url).http
    note = f"Box office test charge {uuid.uuid4().hex[:6]}"

    def mine() -> dict | None:
        listed = fin.get("/api/finance/mismatches").json()["mismatches"]
        return next((x for x in listed if x["killbill_transaction_id"] == tx["transactionId"]), None)

    with browse(browser, app_url, finance(app_url), path="/finance") as page:
        click(page.get_by_role("tab", name="Reconciliation"))
        click(page.get_by_role("button", name="Run reconciliation"))
        status = page.get_by_role("status", name="Finance status")
        says(page, status, re.compile(r"\d+ open mismatches\."))
        visible(page, page.get_by_role("table", name="Mismatches"))
        mismatch = poll(mine, API_WAIT, "mismatch for the direct Kill Bill charge")
        assert mismatch["type"] == "unknown_in_app" and mismatch["status"] == "open", mismatch
        resolve = page.get_by_role("button", name=f"Resolve mismatch {mismatch['id']}", exact=True)
        visible(page, resolve)
        click(resolve)
        fill(page.get_by_role("textbox", name="Resolution note"), note)
        click(page.get_by_role("button", name="Save resolution"))
        says(page, status, "Mismatch resolved.")
    resolved = mine()
    assert (resolved["status"], resolved["note"], resolved["resolved_by"]) == ("resolved", note, FINANCE), resolved
    audit = fin.get("/api/admin/audit", params={"target_id": mismatch["id"]}).json()["entries"]
    assert len(audit) == 1 and audit[0]["actor"] in actor_of(finance(app_url)), audit
    assert note in json.dumps(audit[0]), audit
    assert transactions(killbill.payment_by_key(key), "PURCHASE") == [tx]


def test_wf_finance_close_outage(browser: Browser, app_url: str) -> None:
    fin = finance(app_url).http
    before = {m["id"] for m in fin.get("/api/finance/mismatches").json()["mismatches"]}
    with browse(browser, outage("APP_KILLBILL_DOWN_URL"), finance(app_url), path="/finance") as page:
        click(page.get_by_role("tab", name="Reconciliation"))
        click(page.get_by_role("button", name="Run reconciliation"))
        says(page, page.get_by_role("status", name="Finance status"),
             "The payment service is unavailable. Try again in a moment.")
    assert {m["id"] for m in fin.get("/api/finance/mismatches").json()["mismatches"]} == before


SCREENS = {"/": None, "/signin": None, "/register": None, "/tickets": MIRA, "/studio": ARTIST, "/curate": CURATOR,
           "/box-office": BOXOFFICE, "/finance": FINANCE, "/group": VIERWINDEN_BOOKER, "/admin": ADMIN}


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_responsive_layout(browser: Browser, app_url: str, viewport: str) -> None:
    with browse(browser, app_url, viewport=viewport, reduced_motion="reduce") as page:
        width = page.evaluate("() => document.documentElement.clientWidth")
        heads = [page.get_by_role("heading", level=1, name="Kerf Frequencies 2027")]
        heads += [page.get_by_role("region", name=n).get_by_role("heading").first for n in ("Schedule", "Gallery", "Tickets")]
        for head in heads:
            visible(page, head)
            ratio = text_width(head) / width
            assert DISPLAY_MIN <= ratio <= DISPLAY_MAX, (head, ratio)
        for path, email in SCREENS.items():
            if email:
                login(page, app_url, staff(app_url, email))
            page.goto(app_url + path)
            advance(page, SECTION_MS)
            layout(page)


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_contrast_focus_targets(browser: Browser, app_url: str, viewport: str) -> None:
    with browse(browser, app_url, viewport=viewport) as page:
        advance(page, INTRO_MS)
        settle(page.locator("body"))
        text_contrast(page)
        for _ in range(FOCUS_SAMPLES):
            page.keyboard.press("Tab")
            ring = focus_ring(page)
            assert ring["width"] >= FOCUS_RING_PX and ring["ratio"] >= FOCUS_CONTRAST, ring
        controls = page.get_by_role("button").all() + page.get_by_role("navigation", name="Main").get_by_role("link").all()
        for control in controls:
            if control.is_visible():
                box = control.bounding_box()
                assert box and box["width"] >= TARGET_PX and box["height"] >= TARGET_PX, (control, box)
        page.goto(app_url + "/signin")
        text_contrast(page)


def test_named_motion(browser: Browser, app_url: str) -> None:
    v = register(app_url)
    with browse(browser, app_url, v) as page:
        fig = lattice(page)
        advance(page, INTRO_MS + SECTION_MS)
        has_attr(page, fig, "data-intro", "done")
        settle(page.locator("body"))
        assert page.locator("body").evaluate(RUNNING_JS) == []
        still = decode(capture(fig))
        advance(page, SECTION_MS * 3)
        assert difference(still, decode(capture(fig))) == 0
        head = page.get_by_role("region", name="Tickets").get_by_role("heading").first
        top = head.evaluate("el => el.getBoundingClientRect().top + window.scrollY")
        vh = page.evaluate("() => window.innerHeight")
        start, end = top - vh, top - vh / 3
        positions = [start + (end - start) * k / 5 for k in range(6)]
        widths = []
        for y in positions:
            scroll_to(page, y)
            advance(page, QUICK_MS)
            widths.append(text_width(head))
        assert all(b >= a for a, b in zip(widths, widths[1:])) and widths[-1] > widths[0], widths
        back = []
        for y in reversed(positions):
            scroll_to(page, y)
            advance(page, QUICK_MS)
            back.append(text_width(head))
        assert all(abs(a - b) <= SKEW_SECONDS for a, b in zip(back, reversed(widths))), (widths, back)
        scroll_to(page, 0)
        add_to_agenda(page, "Delta Choir")
        page.evaluate(MOTION_LOG_JS)
        dialog = open_agenda_checkout(page)
        handle = dialog.element_handle()
        opening = handle.evaluate("d => window.__kfMotion.filter(r => d.contains(r.t)).map(r => r.ms)")
        assert all(ms <= DIALOG_OPEN_MAX_MS for ms in opening), opening
        page.evaluate("() => { window.__kfMotion.length = 0; }")
        page.keyboard.press("Escape")
        hidden(page, dialog)
        closing = handle.evaluate("d => window.__kfMotion.filter(r => d === r.t || d.contains(r.t)).map(r => r.ms)")
        assert all(ms < QUICK_MS for ms in closing), closing


MOTION_MODES = ["reduced_motion", "no_webgl"]


@pytest.mark.parametrize("mode", MOTION_MODES, ids=MOTION_MODES)
def test_reduced_motion_equivalents(browser: Browser, app_url: str, mode: str, killbill: Any) -> None:
    v = register(app_url)
    kw: dict[str, Any] = {"reduced_motion": "reduce"} if mode == "reduced_motion" else {"no_webgl": True}
    with browse(browser, app_url, v, **kw) as page:
        static = static_lattice(page)
        visible(page, static, seconds=STATIC_FALLBACK_SECONDS)
        if mode == "reduced_motion":
            boxes = [page.get_by_text(s, exact=True).first.bounding_box() for s in STORY]
            assert all(b is not None for b in boxes)
            assert all(b2["y"] >= b1["y"] + b1["height"] for b1, b2 in zip(boxes, boxes[1:])), boxes
            gallery = page.get_by_role("region", name="Gallery")
            assert gallery.evaluate("el => el.scrollWidth <= el.clientWidth")
        click(page.get_by_role("group", name="Lattice controls").get_by_role("button", name=f"Discipline: {SOUND}"))
        shows_sessions(page, programme_titles(app_url, discipline="sound"))
        has_attr(page, static, "data-raised", "discipline:sound")
        click(schedule_region(page).get_by_role("button", name="Clear filters"))
        add_to_agenda(page, "Nachtstroom")
        add_to_agenda(page, "The Second Hour (first pass)")
        eventually(page, lambda: _assert(frozenset({NACHT, SECOND_SUMMER}) in seam_pairs(attr(static, "data-seams"))))
        dialog = open_agenda_checkout(page)
        to_review(page, dialog)
        click(dialog.get_by_role("button", name=re.compile(r"^Pay €")))
        ref = order_page_ref(page)
    assert len(transactions(killbill.payment_by_key(ref), "CAPTURE")) == 1


@lru_cache(maxsize=None)
def shipped() -> dict[str, dict]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"],
                         cwd=os.environ.get("APP_SOURCE_DIR", "/app"),
                         capture_output=True, text=True, check=False)
    tree = json.loads(out.stdout or "{}")
    found: dict[str, dict] = {}

    def walk(deps: dict) -> None:
        for name, node in (deps or {}).items():
            if f"{name}@{node.get('version')}" not in found:
                found[f"{name}@{node.get('version')}"] = {"name": name, **node}
                walk(node.get("dependencies") or {})

    walk(tree.get("dependencies") or {})
    return found


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}


def test_if_run_manifest() -> None:
    data = json.loads(MANIFEST.read_text())
    assert data == {"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "npm run start"}


def test_if_third_party_notices() -> None:
    notices = NOTICES.read_text()
    missing = sorted({p["name"] for p in shipped().values() if p["name"] not in notices})
    assert not missing, missing
    for font in ("Anybody", "Instrument Sans"):
        assert font in notices, font


def test_if_licences() -> None:
    def allowed(licence: Any) -> bool:
        value = licence.get("type") if isinstance(licence, dict) else licence
        if not isinstance(value, str):
            return False
        expr = value.strip("()")
        if " OR " in expr:
            return any(part.strip("() ") in ALLOWED_LICENCES for part in expr.split(" OR "))
        return all(part.strip("() ") in ALLOWED_LICENCES for part in expr.split(" AND "))

    bad = sorted(f"{k}: {p.get('license')}" for k, p in shipped().items() if not allowed(p.get("license")))
    assert not bad, bad
    assert "OFL-1.1" in NOTICES.read_text()


def test_if_datastores() -> None:
    pkg = json.loads(Path("/app/package.json").read_text())
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    for name in ("sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "lowdb", "nedb", "level", "mongodb"):
        assert name not in deps, name
    stray = [p for p in Path("/app").rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db")
             and "node_modules" not in p.parts]
    assert not stray, stray
    assert Postgres().tables()


def test_if_services_untouched(app_url: str) -> None:
    services = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT).json()["services"]
    assert services == {"postgres": "up", "killbill": "up", "mailpit": "up", "minio": "up"}
    added = [p for p in Path("/app").glob("*") if re.fullmatch(r"(docker-)?compose.*\.ya?ml", p.name)]
    assert not added, added


def test_if_typescript_same_origin(browser: Browser, app_url: str) -> None:
    skip = {"node_modules", "dist", "build", ".git"}
    files = [p for p in Path("/app").rglob("*") if p.is_file() and not skip & set(p.parts)]
    assert any(p.suffix in (".ts", ".tsx") for p in files)
    stray = [p for p in files if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and p.parent != Path("/app")]
    assert not stray, stray
    with browse(browser, app_url) as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        advance(page, INTRO_MS)
        scroll_to(page, SCROLL_FLIGHT_PX)
        advance(page, SECTION_MS)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_seed_records(app_url: str) -> None:
    body = programme(app_url)
    venues = {v["id"]: v["name"] for v in body["venues"]}
    assert venues["remise-noord"] == "Remise Noord (disused tram depot)" and venues["planetarium-dome"] == "Planetarium Dome"
    sessions = {s["id"]: s for s in body["sessions"]}
    assert sessions[FEEDBACK]["title"] == "Feedback Gardens" and sessions[FEEDBACK]["capacity"] == 12
    assert (sessions[SIGNAL]["price_full_cents"], sessions[SIGNAL]["price_reduced_cents"]) == (1200, 700)
    for email, role in ((ADMIN, "admin"), (CURATOR, "curator"), (BOXOFFICE, "box_office"), (FINANCE, "finance"),
                        (ARTIST, "artist"), (ARTIST2, "artist"), (MIRA, "visitor"),
                        (VIERWINDEN_BOOKER, "group_booker")):
        assert staff(app_url, email).http.get("/api/me").json()["user"]["role"] == role
    assert staff(app_url, VIERWINDEN_BOOKER).http.get("/api/me").json()["user"]["organisation_id"] == "vierwinden"
    for code, amount in (("KERF-GIFT-A1", 4000), ("KERF-GIFT-B2", 2500)):
        first = ledger(app_url, code)["movements"][0]
        assert first["kind"] == "issue" and first["amount_cents"] == amount and first["actor"] == FINANCE
    gallery = {e["id"]: e for e in httpx.get(app_url + "/api/gallery").json()["entries"]}
    assert gallery["e-tidal-mesh"]["title"] == "Tidal Mesh" and gallery["e-tidal-mesh"]["artist_name"] == "Yara Delcour"
    assert "e-salt-print" not in gallery
    entries = {e["id"]: e for e in curator(app_url).http.get("/api/entries").json()["entries"]}
    assert entries["e-salt-print"]["status"] == "review" and entries["e-ghost-loop"]["status"] == "draft"
