from __future__ import annotations

import functools
import hashlib
import json
import os
import random
import re
import select
import socket
import struct
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import quote, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from conftest import (
    S3,
    Keycloak,
    Postgres,
    axe,
    capture,
    center,
    changed,
    check,
    decode,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    same_origin,
    session,
    shipped_packages,
    state_styles,
    tab_order,
)

PHONE = (390, 844)
PHONE_PROBE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
PHONE_MAX_W = 767
TABLET_MIN_W = 768
TABLET_MAX_W = 1279
DESKTOP_MIN_W = 1280
TARGET_MIN_PX = 44
GEOMETRY_TOLERANCE_PX = 2
LIVE_MS = 1000
PROVIDER_TIMEOUT_MS = 1000
CATALOG_RETRY_S = 1
SESSION_TTL_S = 900
LINK_TTL_S = 600
HOLD_GRACE_S = 30
OFFER_WINDOW_S = 172800
COUNTER_WINDOW_S = 86400
CLOSING_S = 21600
UPLOAD_MAX_BYTES = 5000000
REQUEST_MAX_BYTES = 12000000
PHOTO_MIN_EDGE_PX = 1000
PHOTO_MAX_EDGE_PX = 8000
PHOTO_MAX_PIXELS = 40000000
CORRECTION_MAX_CHARS = 80
NOTE_MAX_CHARS = 280
ALBUM_MAX_HOLES = 200
PAGE_MAX = 48
SYNC_BATCH_MAX = 50
ZOOM_MIN = 1
ZOOM_MAX = 4
ZOOM_STEP = 0.25
WINDOW_REFRESH_S = 60
REFERENCE_MAX_CHARS = 80
GRADE_CLOCK = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
FEATURE_X = 600
FEATURE_Y = 400
FIXTURE_EDGE_PX = 1000
SHIFT_STEP = 10
PAGE_STEP = 10
ABORTED_STREAMS = 10
ABORT_SETTLE_S = 5
CELLS = ("A1", "A2", "B1", "B2")
FIXTURE_DEALER_STOCK = 5

HTTP_TIMEOUT_S = 90
UI_TIMEOUT_MS = 15000
LONG_MS = 45000
DEADLINE_S = 30
LIVE_SLACK_MS = 4000
TAB_LIMIT = 80
TAB_SWEEP = 60
HOLD_SLACK_S = 15
HOLD_EARLY_S = 2
EDGE_SLACK_PX = 1
VIEWER_INSET_SLACK_PX = 16
TARGET_SLACK_PX = 0.5
DRAG_STEPS = 12
PINCH_FROM = 20
PINCH_TO = 120
PINCH_STEP = 10
TIMEOUT_OVERSHOOT_MS = 1500
FIELD_REACTION_S = 3
UI_RETRY_AFTER_S = 3
REFRESH_ADVANCE_S = 600
PAGE_FLIP_MS = 3000
RAW_CHUNK = 65536
OVER_BODY_FILE_BYTES = 6100000
WALK_PAGE = 5
WRONG_DEVICE_CLOCK = datetime(2031, 6, 1, 3, 17, tzinfo=timezone.utc)

GRADE_HEADER = "X-Flan-Grading-Key"
STREAM_ROUTE = re.compile(r"/api/desks/[^/]+/stream")
STATE_ROUTE = re.compile(r"/api/desks/[^/]+/state")
INTERIM = re.compile(rb"HTTP/1\.[01] 1\d\d ")
PHOTO_ROUTE = re.compile(r"/api/desks/[^/]+/photos/")
AUDIT_ROUTE = re.compile(r"/api/desks/[^/]+/audit/")
ACTIVE_SQL = (
    "select count(*)::int as n from pg_stat_activity where datname = current_database() "
    "and usename <> current_user and state in ('active', 'idle in transaction')"
)
FAMILY = "\U0001F468\u200d\U0001F469\u200d\U0001F467"
JSON_HEADERS = {"Content-Type": "application/json"}

expect.set_options(timeout=UI_TIMEOUT_MS)

F_PENDING = "Saving changes."
F_OFFLINE = "Offline. Your changes are queued."
F_SERVICE = "Service unavailable. Your changes are still here."
F_CONFLICT = "This record changed elsewhere. Your draft is still here."
F_SESSION = "Your session ended. Sign in to continue."
F_REVOKED = "Access ended. Private evidence is no longer available."
F_HIDDEN = "This item is not available."
F_FORBIDDEN = "You cannot perform this action."
F_INVALID = "Check the highlighted fields."
F_BAD_BODY = "The request could not be read."
F_TOO_LARGE = "The upload or request is too large."
F_SYNCED = "Queued changes saved."
F_INTAKE_OK = "Specimen created. Both photographs are saved."
F_INTAKE_DUP = "This specimen reference already exists. Your draft is still here."
F_ATTR_OK = "Attribution quarantined. This specimen is excluded from sets and offers."
F_CATALOG_WAIT = "Catalog unavailable. Your correction is kept."
F_CATALOG_RATE = "Catalog is busy. Your correction is kept for retry."
F_CATALOG_RETRYING = "Retrying catalog now."
F_CATALOG_BAD = "Catalog reply could not be read. Your correction is kept."
F_CATALOG_MISSING = "Catalog has no entry for this reference. Your correction is kept."
F_CATALOG_PENDING = "Waiting for the catalog record. This cannot complete yet."
F_CATALOG_OK = "Catalog reconciled. Your correction is saved."
F_TRAY_OK = "Holder placed."
F_TRAY_SIZE = "This holder is too large for this cell."
F_TRAY_TAKEN = "This cell is occupied. Choose another cell."
F_SET_OK = "Album placement saved. Gaps updated."
F_SET_UNCERTAIN = "Quarantined specimens cannot fill this hole."
F_SET_OUTBOUND = "Outbound specimens cannot fill this hole."
F_SET_MISMATCH = "This specimen does not match this hole."
F_CONDITION_OK = "Condition note saved on the original photograph."
F_IMAGE_WAIT = "Photograph unavailable. Your notes are kept."
F_KEEPER_OK = "Keeper order saved."
F_UNDO_OK = "Previous keeper order restored."
F_UNDO_NONE = "There is no keeper move to undo."
F_OFFER_OK = "Offer sent. Both baskets are reserved."
F_OFFER_TAKEN = "A specimen was reserved elsewhere. Both baskets remain unchanged."
F_OFFER_EXPIRED = "This offer's response window has closed."
F_COUNTER_VOID = "Offer changed. Both acceptances were cleared."
F_COUNTER_ACCEPT = "Acceptance recorded for this offer version."
F_MFA_REQUIRED = "Verify your identity before accepting this offer."
F_DISPATCH_OK = "Manifest frozen. Packing order and evidence are saved."
F_DISPATCH_FROZEN = "This manifest is already frozen. Packing order is unchanged."
F_RECEIPT_WAIT = "Receipt saved. Waiting for the counterpart."
F_RECEIPT_DONE = "Both receipts match. Ownership transferred."
F_DISPUTE_OPEN = "Dispute opened. Ownership transfer is on hold."
F_RESOLUTION_WAIT = "Resolution proposed. Waiting for the counterpart."
F_RESOLUTION_DONE = "Resolution approved. The transfer hold is released."
F_LINK_COPIED = "Private evidence link copied."
F_LINK_REVOKED = "Private evidence link revoked."
F_AUDIT_MISSING = "Missing item recorded. Audit history is kept."
F_SIGNIN_DOWN = "Sign-in is unavailable. Your changes are still here."
F_COMMAND_REUSED = "This action was already sent with different details."
F_PHOTO_TYPE = "Not a JPEG, PNG or WebP photograph."
F_PHOTO_SVG = "SVG drawings are not accepted as photographs."
F_PHOTO_MISSING = "Add both photographs."
F_REFERENCE_FORMAT = "Use 1 to 80 letters, digits or hyphens."
F_COORD = "Coordinates must be inside the photograph."
F_ORDER = "The order must list each specimen once."
F_BASKET_EMPTY = "Each basket needs at least one specimen."
F_CORNER_VERIFIED = "Identity verified"
F_CORNER_VERIFY = "Verify to accept"
F_CORNER_CLOSING = "Window closing"
F_WINDOW_ACCEPTED = "Accepted. No response window is running."


def photo_bytes_copy(limit: int) -> str:
    return f"Photograph is larger than {limit} bytes."


def photo_edge_copy(low: int, high: int) -> str:
    return f"Long edge must be {low} to {high} pixels."


def photo_pixels_copy(limit: int) -> str:
    return f"Photograph has more than {limit} pixels."


def text_long(limit: int) -> str:
    return f"Use at most {limit} characters."


def page_limit(limit: int) -> str:
    return f"At most {limit} per page."


def sync_limit(limit: int) -> str:
    return f"At most {limit} queued changes per sync."


def reorder_copy(label: str, position: int, count: int) -> str:
    return f"{label} moved to position {position} of {count}."


def hold_placed(label: str) -> str:
    return f"{label} is held while you review."


def hold_released(label: str) -> str:
    return f"Counterpart left. {label} is free again."


def status_line(n: int, m: int) -> str:
    return f"Today: {n} specimens taken in. {m} catalog records pending."


def corner(n: int) -> str:
    return f"{n} open offers"


def stock_lines(n: int, m: int) -> tuple[str, str]:
    return f"{n} specimens", f"{m} of 4 cells filled"


def exchange_lines(n: int, m: int) -> tuple[str, str]:
    return f"{n} open offers", f"{m} awaiting receipt"


def utc_minute(moment: datetime) -> str:
    return f"{moment:%Y-%m-%d %H:%M} UTC"


def window_copy(remaining: int, expiry: datetime) -> str:
    return f"{remaining // 3600} h {remaining % 3600 // 60} min left, expires {utc_minute(expiry)}"


def window_closed(expiry: datetime) -> str:
    return f"Window closed {utc_minute(expiry)}"


def zoom_text(value: float) -> str:
    return f"{value:g} times"


def wipe_text(second_tab: str, value: int) -> str:
    return f"{second_tab} {value} percent"


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


@functools.lru_cache(maxsize=None)
def png(width: int, height: int, tone: int = 0, pad_to: int | None = None) -> bytes:
    comp = zlib.compressobj(9)
    parts: list[bytes] = []
    a = bytes(((x // 50) % 2) * 160 + 40 + tone for x in range(width))
    b = bytes(240 - v for v in a)
    for y in range(height):
        parts.append(comp.compress(b"\x00" + (a if (y // 50) % 2 == 0 else b)))
    parts.append(comp.flush())
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    body = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", b"".join(parts))
    end = _chunk(b"IEND", b"")
    if pad_to is not None:
        filler = pad_to - len(body) - len(end) - 12
        assert filler >= 0, "padding target is smaller than the image"
        body += _chunk(b"prVt", b"\x00" * filler)
    return body + end


def face(tone: int) -> bytes:
    return png(FIXTURE_EDGE_PX, FIXTURE_EDGE_PX, tone % 40)


def sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


SVG_SCRIPT = b'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><script>alert(1)</script></svg>'
XML_NOTE = b'<?xml version="1.0"?><note>coin</note>'
GIF_BYTES = b"GIF89a" + bytes(64)
TEXT_BYTES = b"not a photograph\n" * 8
REGISTER_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">'
    '<circle cx="500" cy="500" r="430" fill="#b8b2a6" stroke="#6d675c" stroke-width="40"/>'
    '<text x="600" y="400" font-size="90">A</text></svg>'
)


def grade_headers() -> dict[str, str]:
    return {GRADE_HEADER: os.environ["FLAN_GRADE_KEY"]}


def origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def cookie_header(cookies: list[dict[str, Any]], base: str) -> str:
    host = urlparse(base).hostname or ""
    picked = []
    for c in cookies:
        domain = str(c.get("domain", "")).lstrip(".")
        if host == domain or host.endswith("." + domain):
            picked.append(f"{c['name']}={c['value']}")
    return "; ".join(picked)


def _strip_interim(data: bytes) -> bytes:
    while INTERIM.match(data) and b"\r\n\r\n" in data:
        data = data.split(b"\r\n\r\n", 1)[1]
    return data


def _dechunk(data: bytes) -> bytes:
    out = b""
    for _ in range(len(data) + 1):
        size_line, _, rest = data.partition(b"\r\n")
        size = int(size_line.split(b";")[0].strip() or b"0", 16)
        if size == 0:
            break
        out += rest[:size]
        data = rest[size + 2:]
    return out


def raw_send(base: str, method: str, path: str, headers: dict[str, str], body: bytes) -> httpx.Response:
    parsed = urlparse(base)
    lines = [f"{method} {path} HTTP/1.1", f"Host: {parsed.netloc}", f"Content-Length: {len(body)}",
             "Expect: 100-continue", "Connection: close"] + [f"{k}: {v}" for k, v in headers.items()]
    sock = socket.create_connection((parsed.hostname or "localhost", parsed.port or 80), timeout=HTTP_TIMEOUT_S)
    received = b""
    deadline = time.monotonic() + HTTP_TIMEOUT_S
    try:
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        sent = 0
        while sent < len(body) and time.monotonic() < deadline:
            readable, writable, _ = select.select([sock], [sock], [], 1)
            if readable:
                try:
                    chunk = sock.recv(RAW_CHUNK)
                except OSError:
                    break
                if not chunk:
                    break
                received = _strip_interim(received + chunk)
                if received and not INTERIM.match(received):
                    break
                continue
            if writable:
                try:
                    sent += sock.send(body[sent:sent + RAW_CHUNK])
                except OSError:
                    break
        while time.monotonic() < deadline:
            try:
                chunk = sock.recv(RAW_CHUNK)
            except OSError:
                break
            if not chunk:
                break
            received += chunk
    finally:
        sock.close()
    received = _strip_interim(received)
    head, sep, payload = received.partition(b"\r\n\r\n")
    if not sep:
        pytest.fail(f"{method} {path} with a {len(body)}-byte body got no HTTP reply; expected the published 413 or 404 (L508, L512)")
    status_text, *header_lines = head.decode("latin-1").split("\r\n")
    pairs = [(k.strip(), v.strip()) for k, v in (h.split(":", 1) for h in header_lines if ":" in h)]
    if any(k.lower() == "transfer-encoding" and "chunked" in v.lower() for k, v in pairs):
        payload = _dechunk(payload)
    else:
        length = next((v for k, v in pairs if k.lower() == "content-length"), None)
        if length is not None and length.isdigit():
            payload = payload[:int(length)]
    kept = [(k, v) for k, v in pairs if k.lower() not in ("transfer-encoding", "content-length", "content-encoding")]
    return httpx.Response(int(status_text.split()[1]), headers=kept, content=payload)


def multipart(fields: dict[str, str], files: dict[str, bytes]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    for k, data in files.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{k}.png"\r\n'
                     f"Content-Type: image/png\r\n\r\n".encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


class Desk:

    def __init__(self, base: str, body: dict[str, Any]) -> None:
        self.base = base.rstrip("/")
        self.ns: str = body["namespace"]
        self.entries: dict[str, str] = body["entries"]
        self.sessions: dict[str, dict[str, Any]] = body["sessions"]
        self.body = body

    def cookie(self, role: str) -> str:
        return cookie_header(self.sessions[role].get("cookies", []), self.base)

    def desk_path(self, suffix: str) -> str:
        return f"/api/desks/{self.ns}{suffix}"

    def call(
        self,
        method: str,
        path: str,
        *,
        role: str | None = "dealer",
        cookie: str | None = None,
        json_body: Any = None,
        files: Any = None,
        data: Any = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        h = dict(headers or {})
        jar = cookie if cookie is not None else (self.cookie(role) if role else "")
        if jar:
            h["Cookie"] = jar
        if content is not None and len(content) > REQUEST_MAX_BYTES:
            return raw_send(self.base, method, path, h, content)
        return httpx.request(
            method, self.base + path, headers=h, json=json_body, files=files, data=data,
            content=content, timeout=HTTP_TIMEOUT_S, follow_redirects=False,
        )

    def command(self, method: str, suffix: str, body: dict[str, Any], *, role: str = "dealer",
                cookie: str | None = None, command_id: str | None = None) -> httpx.Response:
        payload = {"command_id": command_id or idempotency_key(), **body}
        return self.call(method, self.desk_path(suffix), role=role, cookie=cookie, json_body=payload)

    def state(self, role: str = "dealer", cookie: str | None = None) -> dict[str, Any]:
        r = self.call("GET", self.desk_path("/state"), role=role, cookie=cookie)
        assert r.status_code == 200, f"GET /api/desks/<ns>/state answered {r.status_code}: {r.text[:300]}"
        return r.json()

    def otp(self, role: str) -> str:
        r = httpx.get(f"{self.base}/__grade/{self.ns}/otp", params={"role": role}, headers=grade_headers(), timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, f"GET /__grade/<ns>/otp answered {r.status_code}"
        return str(r.json()["code"])

    def advance(self, seconds: int) -> None:
        r = httpx.post(f"{self.base}/__grade/{self.ns}/clock", json={"advance_seconds": seconds}, headers=grade_headers(), timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, f"POST /__grade/<ns>/clock answered {r.status_code}: {r.text[:200]}"

    def identity(self, action: str) -> None:
        r = httpx.post(f"{self.base}/__grade/{self.ns}/identity", json={"role": "counterpart", "action": action}, headers=grade_headers(), timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, f"POST /__grade/<ns>/identity answered {r.status_code}"


def fresh_namespace() -> str:
    return "t" + uuid.uuid4().hex[:20]


def seed(base: str, workflow: str, variant: str = "base") -> Desk:
    r = httpx.post(base.rstrip("/") + "/__grade/seed",
                   json={"namespace": fresh_namespace(), "workflow": workflow, "variant": variant},
                   headers=grade_headers(), timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, f"POST /__grade/seed {workflow}/{variant} answered {r.status_code}: {r.text[:400]}"
    return Desk(base, r.json())


def assert_error(r: httpx.Response, status: int, code: str, copy: str, fields: dict[str, str] | None = None) -> None:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code}: {r.text[:400]}"
    body = r.json()
    assert body.get("error") == code, f"error code {body.get('error')!r}, expected {code!r} (L503)"
    assert body.get("message") == copy, f"message {body.get('message')!r}, expected {copy!r} (L371)"
    for field, text in (fields or {}).items():
        assert (body.get("fields") or {}).get(field) == text, f"fields.{field} is {body.get('fields')!r}, expected {text!r}"


def together(*calls: Callable[[], httpx.Response]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return [f.result() for f in [pool.submit(run, c) for c in calls]]


def summary_names(dlg: Any, *keys: str) -> None:
    for key in keys:
        eventually(lambda key=key: re.search(rf"\b{key}\b", dlg.inner_text()), f"the review names specimen {key} (L219)")


def eventually(probe: Callable[[], Any], contract: str, seconds: float = DEADLINE_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
    pytest.fail(contract)


def events(st: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [e for e in st["events"] if e["type"] == kind]


def intake(desk: Desk, ref: str, obverse: bytes | None, reverse: bytes | None, *,
           obverse_type: str = "image/png", command_id: str | None = None) -> httpx.Response:
    files = {}
    if obverse is not None:
        files["obverse"] = ("obverse.png", obverse, obverse_type)
    if reverse is not None:
        files["reverse"] = ("reverse.png", reverse, "image/png")
    return desk.call("POST", desk.desk_path("/specimens"), files=files,
                     data={"command_id": command_id or idempotency_key(), "reference": ref})


def place(desk: Desk, specimen: str, cell: str, version: int, *, command_id: str | None = None) -> httpx.Response:
    return desk.command("POST", "/tray/placements", {"expected_version": version, "specimen": specimen, "cell": cell}, command_id=command_id)


def fill_hole(desk: Desk, hole: str, specimen: str, version: int) -> httpx.Response:
    return desk.command("POST", f"/album/holes/{quote(hole)}/fill", {"expected_version": version, "specimen": specimen})


def cell_specimen(st: dict[str, Any], cell: str) -> str | None:
    return (st["tray"].get(cell) or {}).get("specimen")


def hole_specimen(st: dict[str, Any], hole: str) -> str | None:
    return st["album"]["holes"][hole]["specimen"]


def photo_of(st: dict[str, Any], key: str, label: str) -> dict[str, Any]:
    return next(p for p in st["specimens"][key]["photos"] if p["label"] == label)


def variety(ref: str, **override: Any) -> dict[str, Any]:
    return {"reference": ref, "issue": "Aldmere crown, 1911", "mintmark": "A", "revision": 1,
            "image_path": f"/catalog/images/{ref}.svg", **override}


def fresh_ref(desk: Desk, tag: str) -> str:
    return f"ALD-{tag}{desk.ns[-8:].upper()}"


def stub_record(wiremock: Any, ref: str, *, delay_ms: int = 0) -> None:
    wiremock.stub("GET", "/catalog/varieties", query={"reference": ref}, json=variety(ref),
                  headers=JSON_HEADERS, delay_ms=delay_ms)
    wiremock.stub("GET", f"/catalog/images/{ref}.svg", body=REGISTER_SVG, headers={"Content-Type": "image/svg+xml"})


def register_calls(wiremock: Any, ref: str) -> int:
    return sum(1 for q in wiremock.requests("/catalog/varieties") if ref in json.dumps(q))


def by(scope: Page | Locator, role: str, name: str) -> Locator:
    return scope.get_by_role(role, name=name, exact=True)


def button(scope: Page | Locator, name: str) -> Locator:
    return by(scope, "button", name)


def status(page: Page) -> Locator:
    return by(page, "status", "Desk updates")


def alert(page: Page) -> Locator:
    return by(page, "alert", "Desk error")


def dialog(page: Page, name: str) -> Locator:
    return by(page, "dialog", name)


def work(page: Page) -> Page | Locator:
    size = page.viewport_size or {"width": DESKTOP[0]}
    return by(page, "region", "Inspector") if size["width"] >= DESKTOP_MIN_W else page


RECORD_JS = """el => { window.__flanAnnouncements = [];
  const push = () => window.__flanAnnouncements.push(el.textContent.trim());
  new MutationObserver(push).observe(el, {subtree: true, childList: true, characterData: true}); }"""


def record(page: Page) -> None:
    status(page).evaluate(RECORD_JS)


def announcements(page: Page) -> list[str]:
    return page.evaluate("() => window.__flanAnnouncements || []")


def announced(page: Page, copy: str, timeout_ms: float = UI_TIMEOUT_MS) -> None:
    handle = status(page).element_handle(timeout=timeout_ms)
    page.wait_for_function(
        "([el, c]) => el.textContent.includes(c) || (window.__flanAnnouncements || []).some(t => t.includes(c))",
        arg=[handle, copy], timeout=timeout_ms)


def order_announced(page: Page, first: str, then: str) -> None:
    log = announcements(page)
    i = next((n for n, t in enumerate(log) if first in t), None)
    j = next((n for n, t in enumerate(log) if then in t), None)
    assert i is not None and j is not None and i < j, f"expected {first!r} announced before {then!r}; log {log}"


@contextmanager
def desk_page(browser: Browser, desk: Desk, role: str | None = "dealer", *, url: str | None = None,
              viewport: tuple[int, int] = DESKTOP, touch: bool = False, reduced: bool = False,
              block_stream: bool = False, abort_photos: bool = False, fixed_clock: datetime | None = None,
              permissions: list[str] | None = None, listen: bool = True) -> Iterator[Page]:
    context = browser.new_context(
        storage_state=desk.sessions[role] if role else None,
        viewport={"width": viewport[0], "height": viewport[1]}, has_touch=touch,
        reduced_motion="reduce" if reduced else "no-preference", permissions=permissions or [])
    page = context.new_page()
    page.set_default_timeout(UI_TIMEOUT_MS)
    frozen: dict[str, Any] = {}
    if block_stream:
        page.route(STREAM_ROUTE, lambda route: route.abort())
        page.on("request", lambda r: frozen.update(live=True) if r.method != "GET" and "/api/desks/" in r.url else None)

        def snapshot(route: Any) -> None:
            if frozen.get("live") or route.request.method != "GET":
                route.continue_()
                return
            if "status" not in frozen:
                got = route.fetch()
                frozen.update(status=got.status, body=got.body(), headers={
                    k: v for k, v in got.headers.items() if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")})
            route.fulfill(status=frozen["status"], headers=frozen["headers"], body=frozen["body"])

        page.route(STATE_ROUTE, snapshot)
    if abort_photos:
        page.route(PHOTO_ROUTE, lambda route: route.abort())
    if fixed_clock is not None:
        page.clock.set_fixed_time(fixed_clock)
    try:
        target = url or desk.entries[role or "dealer"]
        if block_stream:
            try:
                with page.expect_response(STATE_ROUTE, timeout=UI_TIMEOUT_MS):
                    page.goto(target)
            except PlaywrightTimeoutError:
                pass
        else:
            page.goto(target)
        if listen:
            record(page)
        yield page
    finally:
        page.unroute_all(behavior="ignoreErrors")
        context.close()


def _condition_reveal_arrival(scope: Page | Locator, page: Page) -> None:
    by(scope, "slider", "Condition wipe").focus()
    page.keyboard.press("End")


RECT_JS = "e => { const r = e.getBoundingClientRect(); return {x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height}; }"


def rect(loc: Locator) -> dict[str, float]:
    expect(loc).to_be_visible()
    return loc.evaluate(RECT_JS)


def stacked(*locs: Locator) -> None:
    rects = [rect(l) for l in locs]
    for n in range(len(locs) - 1):
        a, b = rects[n], rects[n + 1]
        assert a["y"] + a["h"] <= b["y"] + EDGE_SLACK_PX, f"{locs[n]} should sit above {locs[n + 1]}: {a} vs {b}"


def beside(left: Locator, right: Locator) -> None:
    a, b = rect(left), rect(right)
    assert a["x"] + a["w"] <= b["x"] + EDGE_SLACK_PX, f"{left} should sit left of {right}: {a} vs {b}"


def inside(inner: Locator, outer: Locator) -> None:
    a, b = rect(inner), rect(outer)
    assert (a["x"] >= b["x"] - EDGE_SLACK_PX and a["y"] >= b["y"] - EDGE_SLACK_PX
            and a["x"] + a["w"] <= b["x"] + b["w"] + EDGE_SLACK_PX
            and a["y"] + a["h"] <= b["y"] + b["h"] + EDGE_SLACK_PX), f"{inner} should sit inside {outer}: {a} vs {b}"


def big_enough(loc: Locator) -> None:
    loc.scroll_into_view_if_needed()
    box = loc.bounding_box()
    assert box and box["width"] >= TARGET_MIN_PX - TARGET_SLACK_PX and box["height"] >= TARGET_MIN_PX - TARGET_SLACK_PX, \
        f"{loc} is {box}; every target is at least FLAN_TARGET_MIN_PX (L96)"


def bottom_sheet(page: Page, dlg: Locator) -> None:
    size = page.viewport_size
    assert size
    box = dlg.bounding_box()
    assert box, "review dialog has no box"
    assert box["x"] <= EDGE_SLACK_PX and box["x"] + box["width"] >= size["width"] - EDGE_SLACK_PX, \
        f"phone review must be a full-width bottom sheet (L117): {box}"
    assert box["y"] + box["height"] >= size["height"] - EDGE_SLACK_PX, f"phone review must sit at the bottom (L117): {box}"


def row_major(scope: Page | Locator) -> None:
    r = {c: rect(button(scope, f"Cell {c}")) for c in CELLS}
    cx = {c: r[c]["x"] + r[c]["w"] / 2 for c in CELLS}
    cy = {c: r[c]["y"] + r[c]["h"] / 2 for c in CELLS}
    assert cx["A1"] < cx["A2"] and cx["B1"] < cx["B2"], f"cells must run left to right within a row (L96): {r}"
    assert cy["A1"] < cy["B1"] and cy["A2"] < cy["B2"], f"row B must sit below row A (L96): {r}"
    assert abs(cy["A1"] - cy["A2"]) < r["A1"]["h"] / 2 and abs(cx["A1"] - cx["B1"]) < r["A1"]["w"] / 2, f"tray is not a grid: {r}"


def tab_to(page: Page, target: Locator, *, backwards: bool = False) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Shift+Tab" if backwards else "Tab")
        if target.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"):
            return
    pytest.fail(f"Tab never reached {target}; every journey can be finished by keyboard (L293)")


def keyboard_move(page: Page, scope: Page | Locator, source: str, destination: Locator) -> None:
    button(scope, source).focus()
    page.keyboard.press("Space")
    expect(scope.get_by_role("button", name=source, exact=True, pressed=True)).to_be_visible()
    tab_to(page, destination)
    page.keyboard.press("Enter")


def trapped(page: Page, dlg: Locator) -> None:
    for key in ("Tab",) * 6 + ("Shift+Tab",) * 6:
        page.keyboard.press(key)
        assert dlg.evaluate("d => d.contains(document.activeElement)"), "Tab and Shift+Tab wrap inside the dialog (L277)"


def open_review(page: Page, opener: str, dialog_name: str) -> Locator:
    button(page, opener).click()
    dlg = dialog(page, dialog_name)
    expect(dlg).to_be_visible()
    expect(button(dlg, "Cancel")).to_be_focused()
    return dlg


def confirm(page: Page, opener: str, dialog_name: str) -> Locator:
    dlg = open_review(page, opener, dialog_name)
    button(dlg, "Confirm").click()
    return dlg


def attempt(page: Page, opener: str, dialog_name: str, outcome: Locator) -> None:
    button(page, opener).click()
    dlg = dialog(page, dialog_name)
    expect(outcome.or_(dlg).first).to_be_visible()
    if dlg.count() and dlg.is_visible():
        button(dlg, "Confirm").click()
    expect(outcome.first).to_be_visible()


def stage(page: Page, source: Locator, payload: bytes, name: str = "face.png") -> None:
    with page.expect_file_chooser() as chooser:
        source.click()
    chooser.value.set_files(files=[{"name": name, "mimeType": "image/png", "buffer": payload}])


def touch_path(page: Page, points: list[tuple[float, float]]) -> None:
    cdp = session(page)
    x, y = points[0]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]})
    for x, y in points[1:]:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y, "id": 1}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def line(a: tuple[float, float], b: tuple[float, float]) -> list[tuple[float, float]]:
    return [(a[0] + (b[0] - a[0]) * i / DRAG_STEPS, a[1] + (b[1] - a[1]) * i / DRAG_STEPS) for i in range(DRAG_STEPS + 1)]


def touch_drag(page: Page, source: Locator, destination: Locator) -> None:
    source.scroll_into_view_if_needed()
    touch_path(page, line(center(source), center(destination)))


def pinch_out(page: Page, target: Locator) -> None:
    target.scroll_into_view_if_needed()
    cx, cy = center(target)
    cdp = session(page)

    def pts(d: float) -> list[dict[str, float]]:
        return [{"x": cx - d, "y": cy, "id": 1}, {"x": cx + d, "y": cy, "id": 2}]

    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts(PINCH_FROM)})
    for d in range(PINCH_FROM, PINCH_TO + 1, PINCH_STEP):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pts(d)})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def slider_now(loc: Locator) -> float:
    return float(loc.evaluate("e => e.getAttribute('aria-valuenow') ?? e.value"))


def spin_value(loc: Locator) -> int:
    return int(float(loc.evaluate("e => (e.value !== undefined && e.value !== '') ? e.value : e.getAttribute('aria-valuenow')")))


def set_coords(scope: Page | Locator, x: int, y: int) -> None:
    for name, value in (("Image x", x), ("Image y", y)):
        box = by(scope, "spinbutton", name)
        fill(box, str(value))
        box.press("Enter")


def selected_tab(page: Page, name: str) -> Locator:
    return page.get_by_role("tab", name=name, exact=True, selected=True)


def sniff(page: Page, fragment: str) -> list[dict[str, Any]]:
    seen: list[dict[str, Any]] = []

    def on_request(request: Any) -> None:
        if request.method == "POST" and fragment in request.url and request.post_data:
            try:
                seen.append(json.loads(request.post_data))
            except ValueError:
                pass

    page.on("request", on_request)
    return seen


def visual_order(scope: Locator, prefix: str, keys: str) -> list[str]:
    rs = [(rect(button(scope, f"{prefix}{k}")), k) for k in keys]
    return [k for r, k in sorted(rs, key=lambda t: (round(t[0]["y"]), t[0]["x"]))]


def keycloak_code(page: Page, desk: Desk, role: str) -> None:
    box = page.get_by_role("textbox", name="One-time code", exact=True)
    expect(box).to_be_visible(timeout=LONG_MS)
    box.fill(desk.otp(role))
    page.get_by_role("button", name="Sign In", exact=True).click()
    page.wait_for_url(lambda u: same_origin(u, origin(desk.base)), timeout=LONG_MS)


def verify_identity(page: Page, desk: Desk, role: str) -> None:
    verify = button(page, "Verify identity")
    expect(verify).to_be_visible(timeout=LONG_MS)
    verify.click()
    keycloak_code(page, desk, role)


def step_up_cookie(browser: Browser, desk: Desk, role: str) -> str:
    with desk_page(browser, desk, role, url=f"{desk.base}/auth/step-up?return_to=/desk/{desk.ns}", listen=False) as page:
        keycloak_code(page, desk, role)
        return cookie_header(page.context.cookies(), desk.base)


def relogin(page: Page, desk: Desk, path: str) -> str:
    page.goto(f"{desk.base}/auth/login?return_to={quote(path)}")
    want = urlparse(path).path
    page.wait_for_url(lambda u: same_origin(u, origin(desk.base)) and urlparse(u).path == want, timeout=LONG_MS)
    record(page)
    return cookie_header(page.context.cookies(), desk.base)


NO_RELOAD_JS = "() => { window.__flanNoReload = true; }"


def not_reloaded(page: Page) -> bool:
    return bool(page.evaluate("() => window.__flanNoReload === true"))


def test_intake_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "intake")
    for size in (PHONE, PHONE_PROBE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            expect(by(page, "region", "Intake workspace")).to_be_visible()
            i03, i04, i05, i06 = (button(w, n) for n in ("Obverse photo", "Reverse photo", "Obverse slot", "Reverse slot"))
            i02, i07 = by(w, "textbox", "Specimen reference"), button(w, "Review intake")
            if size[0] <= PHONE_MAX_W:
                stacked(i03, i05, i04, i06, i02, i07)
            elif size[0] <= TABLET_MAX_W:
                stacked(i03, i05)
                stacked(i04, i06)
                beside(i03, i04)
                beside(i05, i06)
                for low in (i02, i07):
                    stacked(i05, low)
                    stacked(i06, low)
            else:
                beside(by(page, "region", "Stock grid"), w)
                for c in (i03, i04, i05, i06, i02, i07):
                    inside(c, w)
            for c in (i03, i04, i05, i06, i07):
                big_enough(c)
            layout(page)
            stage(page, i03, face(1))
            i03.click()
            i05.click()
            stage(page, i04, face(2))
            i04.click()
            i06.click()
            fill(i02, f"{desk.ns}-I")
            dlg = open_review(page, "Review intake", "Create specimen")
            if size[0] <= PHONE_MAX_W:
                bottom_sheet(page, dlg)
            big_enough(button(dlg, "Confirm"))
            button(dlg, "Cancel").click()
            expect(dlg).to_have_count(0)


def assert_stored_faces(desk: Desk, s3: S3, ref: str, obverse: bytes, reverse: bytes) -> None:
    spec = desk.state()["specimens"].get(ref)
    assert spec is not None, f"specimen {ref} was not created"
    assert spec["status"] == "pending_catalogue", "a new specimen waits for its catalogue record (L674)"
    assert spec["display_label"] == f"Specimen {ref}"
    photos = {p["label"]: p for p in spec["photos"]}
    for label, payload in (("obverse", obverse), ("reverse", reverse)):
        p = photos[label]
        digest = sha(payload)
        assert p["sha256"] == digest, f"{label} sha256 differs from the submitted bytes (L848)"
        assert p["object_key"].startswith(f"specimens/{desk.ns}/{ref}/{label}-{digest}"), p["object_key"]
        assert s3.get(p["object_key"]) == payload, f"MinIO bytes of {label} differ from the submitted file"
        r = desk.call("GET", desk.desk_path(f"/photos/{p['id']}"))
        assert r.status_code == 200 and r.content == payload, "photo route must return the stored bytes (L556)"
        assert "no-store" in r.headers.get("cache-control", "")


def test_wf_intake_happy(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "intake")
    s3 = S3()
    ref = f"{desk.ns}-I"
    with desk_page(browser, desk, viewport=PHONE, touch=True) as page:
        stage(page, button(page, "Obverse photo"), face(3))
        button(page, "Obverse photo").tap()
        button(page, "Obverse slot").tap()
        stage(page, button(page, "Reverse photo"), face(4))
        touch_drag(page, button(page, "Reverse photo"), button(page, "Reverse slot"))
        fill(by(page, "textbox", "Specimen reference"), ref)
        dlg = open_review(page, "Review intake", "Create specimen")
        button(dlg, "Cancel").click()
        assert ref not in desk.state()["specimens"], "cancelling Create specimen must not create it (L235)"
        assert s3.keys(f"specimens/{desk.ns}/{ref}/") == [], "nothing is stored before Confirm"
        dlg = open_review(page, "Review intake", "Create specimen")
        with held(page, "**/api/desks/*/specimens") as gate:
            button(dlg, "Confirm").click()
            expect(status(page)).to_contain_text(F_PENDING)
            expect(button(dlg, "Confirm")).to_be_disabled()
            assert ref not in desk.state()["specimens"]
            gate.release()
        announced(page, F_INTAKE_OK, LONG_MS)
    assert_stored_faces(desk, s3, ref, face(3), face(4))
    ref2 = f"{desk.ns}-K"
    with desk_page(browser, desk) as page:
        w = work(page)
        stage(page, button(w, "Obverse photo"), face(5))
        keyboard_move(page, w, "Obverse photo", button(w, "Obverse slot"))
        stage(page, button(w, "Reverse photo"), face(6))
        keyboard_move(page, w, "Reverse photo", button(w, "Reverse slot"))
        fill(by(w, "textbox", "Specimen reference"), ref2)
        button(w, "Review intake").focus()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Create specimen")
        expect(button(dlg, "Cancel")).to_be_focused()
        tab_to(page, button(dlg, "Confirm"))
        page.keyboard.press("Enter")
        announced(page, F_INTAKE_OK, LONG_MS)
    assert_stored_faces(desk, s3, ref2, face(5), face(6))


def test_wf_intake_refusals(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "intake")
    s3 = S3()
    fixture_keys = s3.keys(f"specimens/{desk.ns}/")
    with desk_page(browser, desk, viewport=TABLET) as page:
        stage(page, button(page, "Obverse photo"), TEXT_BYTES, "obverse.png")
        button(page, "Obverse photo").click()
        button(page, "Obverse slot").click()
        err = page.get_by_text(F_PHOTO_TYPE).first
        expect(err).to_be_visible()
        e, left, right = rect(err), rect(button(page, "Obverse slot")), rect(button(page, "Reverse slot"))
        ex = e["x"] + e["w"] / 2
        assert abs(ex - (left["x"] + left["w"] / 2)) < abs(ex - (right["x"] + right["w"] / 2)), "the refusal shows in the obverse slot (L672)"
        stage(page, button(page, "Reverse photo"), SVG_SCRIPT, "reverse.png")
        button(page, "Reverse photo").click()
        button(page, "Reverse slot").click()
        expect(page.get_by_text(F_PHOTO_SVG).first).to_be_visible()
    assert s3.keys(f"specimens/{desk.ns}/") == fixture_keys, "a refused file is never written to MinIO (L673)"
    good = face(7)
    cases = [
        ("T", TEXT_BYTES, good, 422, "invalid", F_INVALID, "obverse", F_PHOTO_TYPE),
        ("G", GIF_BYTES, good, 422, "invalid", F_INVALID, "obverse", F_PHOTO_TYPE),
        ("S", SVG_SCRIPT, good, 422, "invalid", F_INVALID, "obverse", F_PHOTO_SVG),
        ("X", XML_NOTE, good, 422, "invalid", F_INVALID, "obverse", F_PHOTO_SVG),
        ("E", png(PHOTO_MIN_EDGE_PX - 1, PHOTO_MIN_EDGE_PX - 1), good, 422, "invalid", F_INVALID, "obverse",
         photo_edge_copy(PHOTO_MIN_EDGE_PX, PHOTO_MAX_EDGE_PX)),
        ("L", png(PHOTO_MAX_EDGE_PX + 1, 10), good, 422, "invalid", F_INVALID, "obverse",
         photo_edge_copy(PHOTO_MIN_EDGE_PX, PHOTO_MAX_EDGE_PX)),
        ("P", png(PHOTO_MAX_EDGE_PX, PHOTO_MAX_PIXELS // PHOTO_MAX_EDGE_PX + 1), good, 422, "invalid", F_INVALID, "obverse",
         photo_pixels_copy(PHOTO_MAX_PIXELS)),
        ("B", png(FIXTURE_EDGE_PX, FIXTURE_EDGE_PX, 0, UPLOAD_MAX_BYTES + 1), good, 413, "too_large", F_TOO_LARGE, "obverse",
         photo_bytes_copy(UPLOAD_MAX_BYTES)),
        ("M", good, None, 422, "invalid", F_INVALID, "reverse", F_PHOTO_MISSING),
    ]
    for tag, obverse, reverse, code_status, code, message, field, copy in cases:
        ref = f"{desk.ns}-{tag}"
        r = intake(desk, ref, obverse, reverse, obverse_type="image/png")
        assert_error(r, code_status, code, message, {field: copy})
        assert s3.keys(f"specimens/{desk.ns}/{ref}/") == [], f"case {tag}: refused faces must not reach MinIO"
        assert ref not in desk.state()["specimens"]
    for bad in ("bad ref!", "Z" * (REFERENCE_MAX_CHARS + 1)):
        assert_error(intake(desk, bad, good, good), 422, "invalid", F_INVALID, {"reference": F_REFERENCE_FORMAT})
    whole = png(FIXTURE_EDGE_PX, FIXTURE_EDGE_PX, 1, OVER_BODY_FILE_BYTES)
    payload, kind = multipart({"command_id": idempotency_key(), "reference": f"{desk.ns}-W"}, {"obverse": whole, "reverse": whole})
    r = desk.call("POST", desk.desk_path("/specimens"), content=payload, headers={"Content-Type": kind})
    assert r.status_code == 413 and r.json()["error"] == "too_large" and "fields" not in r.json(), "body over FLAN_REQUEST_MAX_BYTES is the transport 413 (L527)"
    edge = f"{desk.ns}-" + "Z" * (REFERENCE_MAX_CHARS - len(desk.ns) - 1)
    for ref, obverse in ((edge, png(FIXTURE_EDGE_PX, FIXTURE_EDGE_PX, 0, UPLOAD_MAX_BYTES)),
                         (f"{desk.ns}-Q", png(PHOTO_MAX_EDGE_PX, PHOTO_MAX_PIXELS // PHOTO_MAX_EDGE_PX))):
        r = intake(desk, ref, obverse, good)
        assert r.status_code == 201, f"inclusive limits must be accepted (L670): {r.status_code} {r.text[:200]}"
    dup = intake(desk, edge, png(FIXTURE_EDGE_PX, FIXTURE_EDGE_PX, 0, UPLOAD_MAX_BYTES + 1), good)
    assert_error(dup, 409, "conflict", F_INTAKE_DUP)


def test_wf_intake_minio_outage(browser: Browser) -> None:
    desk = seed(os.environ["APP_MINIO_DOWN_URL"], "intake")
    ref = f"{desk.ns}-I"
    assert_error(intake(desk, ref, face(8), face(9)), 503, "service_unavailable", F_SERVICE)
    with desk_page(browser, desk) as page:
        w = work(page)
        for src, slot, tone in (("Obverse photo", "Obverse slot", 10), ("Reverse photo", "Reverse slot", 11)):
            stage(page, button(w, src), face(tone))
            button(w, src).click()
            button(w, slot).click()
        fill(by(w, "textbox", "Specimen reference"), ref)
        confirm(page, "Review intake", "Create specimen")
        expect(alert(page)).to_contain_text(F_SERVICE, timeout=LONG_MS)
        expect(button(page, "Retry save").first).to_be_visible()
        expect(by(w, "textbox", "Specimen reference")).to_have_value(ref)
        assert not any(F_INTAKE_OK in t for t in announcements(page)), "no success before MinIO confirms (L368)"
    st = desk.state()
    assert ref not in st["specimens"] and events(st, "specimen.created") == []


def test_wf_intake_duplicate_race(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "intake")
    s3 = S3()
    ref = f"{desk.ns}-R"
    rs = together(lambda: intake(desk, ref, face(12), face(13)), lambda: intake(desk, ref, face(14), face(15)))
    assert sorted(r.status_code for r in rs) == [201, 409], [r.status_code for r in rs]
    assert_error(next(r for r in rs if r.status_code == 409), 409, "conflict", F_INTAKE_DUP)
    st = desk.state()
    assert len(st["specimens"][ref]["photos"]) == 2 and len(events(st, "specimen.created")) == 1
    ui = seed(app_url, "intake", "conflict")
    fresh = f"{ui.ns}-J"
    with desk_page(browser, ui, "dealer") as first, desk_page(browser, ui, "dealer_peer") as second:
        peer_ref = by(work(second), "textbox", "Specimen reference")
        expect(peer_ref).not_to_have_value("")
        shared = peer_ref.input_value()
        for page, tones in ((first, (16, 17)), (second, (18, 19))):
            w = work(page)
            for (src, slot), tone in zip((("Obverse photo", "Obverse slot"), ("Reverse photo", "Reverse slot")), tones):
                stage(page, button(w, src), face(tone))
                button(w, src).click()
                button(w, slot).click()
        fill(by(work(first), "textbox", "Specimen reference"), shared)
        confirm(first, "Review intake", "Create specimen")
        announced(first, F_INTAKE_OK, LONG_MS)
        confirm(second, "Review intake", "Create specimen")
        expect(alert(second)).to_contain_text(F_INTAKE_DUP)
        expect(peer_ref).to_have_value(shared)
        fill(peer_ref, fresh)
        confirm(second, "Review intake", "Create specimen")
        announced(second, F_INTAKE_OK, LONG_MS)
    assert_stored_faces(ui, s3, shared, face(16), face(17))
    assert_stored_faces(ui, s3, fresh, face(18), face(19))


def test_attribution_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "attribution")
    for size in (PHONE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            expect(by(page, "region", "Attribution workspace")).to_be_visible()
            zoom, note = by(w, "slider", "Mintmark zoom"), by(w, "textbox", "Attribution note")
            review = button(w, "Review quarantine")
            obverse_facts, reverse_facts = by(w, "region", "Obverse facts").first, by(w, "region", "Reverse facts").first
            if size[0] <= PHONE_MAX_W:
                stacked(zoom, obverse_facts, reverse_facts, note, review)
            elif size[0] <= TABLET_MAX_W:
                beside(zoom, note)
                stacked(obverse_facts, note, review)
                stacked(reverse_facts, note)
            else:
                inside(zoom, w)
                inside(note, w)
                beside(by(page, "region", "Stock grid"), w)
            layout(page)
            fill(note, "Doubtful punch")
            dlg = open_review(page, "Review quarantine", "Quarantine attribution")
            if size[0] <= PHONE_MAX_W:
                bottom_sheet(page, dlg)
            button(dlg, "Cancel").click()
            expect(dlg).to_have_count(0)


def test_wf_attribution_zoom_quarantine(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "attribution")
    note_text = "Repunched A doubtful"
    with desk_page(browser, desk, viewport=PHONE, touch=True, reduced=True) as page:
        zoom = by(page, "slider", "Mintmark zoom")
        zoom.focus()
        for key, value in (("Home", ZOOM_MIN), ("ArrowRight", ZOOM_MIN + ZOOM_STEP), ("ArrowUp", ZOOM_MIN + 2 * ZOOM_STEP),
                           ("ArrowDown", ZOOM_MIN + ZOOM_STEP), ("ArrowLeft", ZOOM_MIN), ("ArrowLeft", ZOOM_MIN),
                           ("End", ZOOM_MAX), ("ArrowRight", ZOOM_MAX), ("Home", ZOOM_MIN)):
            page.keyboard.press(key)
            expect(zoom).to_have_attribute("aria-valuetext", zoom_text(value))
        pinch_out(page, by(page, "img", "Specimen A obverse").first)
        eventually(lambda: slider_now(zoom) > ZOOM_MIN, "a pinch on the photograph zooms and the slider follows (L252)")
        fill(by(page, "textbox", "Attribution note"), note_text)
        dlg = open_review(page, "Review quarantine", "Quarantine attribution")
        trapped(page, dlg)
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(button(page, "Review quarantine")).to_be_focused()
        dlg = open_review(page, "Review quarantine", "Quarantine attribution")
        with held(page, "**/specimens/A/quarantine") as gate:
            button(dlg, "Confirm").tap()
            expect(status(page)).to_contain_text(F_PENDING)
            expect(button(dlg, "Confirm")).to_be_disabled()
            gate.release()
        announced(page, F_ATTR_OK)
        order_announced(page, F_PENDING, F_ATTR_OK)
    st = desk.state()
    a = st["specimens"]["A"]
    assert a["quarantined"] is True and a["status"] == "quarantined" and a["attribution"]["note"] == note_text
    assert len(events(st, "specimen.quarantined")) == 1


def test_wf_attribution_conflict(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "attribution")
    version = desk.state()["specimens"]["A"]["version"]
    path = desk.desk_path("/specimens/A/quarantine")
    r = desk.command("POST", "/specimens/A/quarantine", {"expected_version": version, "note": FAMILY * (NOTE_MAX_CHARS + 1)})
    assert_error(r, 422, "invalid", F_INVALID, {"note": text_long(NOTE_MAX_CHARS)})
    stale_note = "Stale screen note"
    with desk_page(browser, desk, block_stream=True) as stale:
        box = by(work(stale), "textbox", "Attribution note")
        fill(box, stale_note)
        body = {"command_id": idempotency_key(), "expected_version": version, "note": FAMILY * NOTE_MAX_CHARS}
        first = desk.call("POST", path, json_body=body)
        assert first.status_code == 200, f"280 user-perceived characters are allowed (L677): {first.text[:200]}"
        count = len(desk.state()["events"])
        again = desk.call("POST", path, json_body=body)
        assert again.status_code == 200 and again.json() == first.json(), "replay returns the stored reply (L521)"
        assert len(desk.state()["events"]) == count, "replay has no new side effect"
        assert_error(desk.call("POST", path, json_body={**body, "note": "different"}), 409, "conflict", F_COMMAND_REUSED)
        confirm(stale, "Review quarantine", "Quarantine attribution")
        expect(alert(stale)).to_contain_text(F_CONFLICT)
        expect(box).to_have_value(stale_note)
        expect(button(stale, "Reload current").first).to_be_visible()
    st = desk.state()
    assert st["specimens"]["A"]["attribution"]["note"] == FAMILY * NOTE_MAX_CHARS
    assert len(events(st, "specimen.quarantined")) == 1
    assert_error(fill_hole(desk, "Mint A", "A", st["versions"]["album"]), 409, "conflict", F_SET_UNCERTAIN)


def test_reconciliation_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "catalog_reconciliation")
    for size in (PHONE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            expect(by(page, "region", "Catalog reconciliation workspace")).to_be_visible()
            register_tab, obverse_tab = by(w, "tab", "Register"), by(w, "tab", "Obverse")
            divider, correction = by(w, "slider", "Reference divider"), by(w, "textbox", "Attribution correction")
            review = button(w, "Review reconciliation")
            beside(register_tab, obverse_tab)
            if size[0] <= PHONE_MAX_W:
                stacked(register_tab, divider, correction, review)
            elif size[0] <= TABLET_MAX_W:
                stacked(register_tab, divider)
                beside(divider, correction)
            else:
                inside(divider, w)
                inside(correction, w)
                beside(by(page, "region", "Stock grid"), w)
            layout(page)
            dlg = open_review(page, "Review reconciliation", "Save reconciliation")
            if size[0] <= PHONE_MAX_W:
                bottom_sheet(page, dlg)
            button(dlg, "Cancel").click()


def test_wf_catalog_reconciliation_happy(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = seed(app_url, "catalog_reconciliation")
    ref = fresh_ref(desk, "H")
    stub_record(wiremock, ref)
    version = desk.state()["specimens"]["A"]["version"]
    r = desk.command("POST", "/specimens/A/reconcile", {"expected_version": version, "correction": "A" * (CORRECTION_MAX_CHARS + 1)})
    assert_error(r, 422, "invalid", F_INVALID, {"correction": text_long(CORRECTION_MAX_CHARS)})
    before = register_calls(wiremock, ref)
    with desk_page(browser, desk) as page:
        w = work(page)
        divider = by(w, "slider", "Reference divider")
        divider.focus()
        page.keyboard.press("Home")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Obverse", 0))
        expect(selected_tab(page, "Register")).to_be_visible()
        for _ in range(5):
            page.keyboard.press("PageUp")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Obverse", 5 * PAGE_STEP))
        expect(selected_tab(page, "Obverse")).to_be_visible()
        page.keyboard.press("ArrowLeft")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Obverse", 5 * PAGE_STEP - 1))
        expect(selected_tab(page, "Register")).to_be_visible()
        page.keyboard.press("End")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Obverse", 100))
        page.keyboard.press("PageDown")
        page.keyboard.press("ArrowDown")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Obverse", 100 - PAGE_STEP - 1))
        page.keyboard.press("Home")
        x, y = center(divider)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + PINCH_TO, y, steps=DRAG_STEPS)
        page.mouse.up()
        assert slider_now(divider) > 0, "dragging the divider tracks the pointer (L258)"
        divider.focus()
        page.keyboard.press("Home")
        for _ in range(6):
            page.keyboard.press("PageUp")
        for _ in range(2):
            page.keyboard.press("ArrowRight")
        page.reload()
        record(page)
        w = work(page)
        divider = by(w, "slider", "Reference divider")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Obverse", 6 * PAGE_STEP + 2))
        fill(by(w, "textbox", "Attribution correction"), ref)
        dlg = open_review(page, "Review reconciliation", "Save reconciliation")
        with held(page, "**/specimens/A/reconcile") as gate:
            button(dlg, "Confirm").click()
            expect(status(page)).to_contain_text(F_PENDING)
            gate.release()
        announced(page, F_CATALOG_OK, LONG_MS)
    st = desk.state()
    att = st["specimens"]["A"]["attribution"]
    assert (att["register"], att["reference"], att["mintmark"], att["revision"], att["correction"]) == ("stored", ref, "A", 1, ref)
    assert st["specimens"]["A"]["status"] == "attributed"
    assert register_calls(wiremock, ref) > before, "the register was asked for the correction (L687)"
    assert S3().get(f"catalog/{desk.ns}/{ref}/r1.svg") == REGISTER_SVG.encode(), "register image stored in MinIO (L851)"


def test_wf_catalog_reconciliation_outages(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = seed(app_url, "catalog_reconciliation")
    version = desk.state()["specimens"]["A"]["version"]
    cases: list[tuple[str, dict[str, Any], int, str, str]] = [
        ("R", {"status": 429, "headers": {"Retry-After": str(CATALOG_RETRY_S)}, "json": {}}, 429, "catalog_busy", F_CATALOG_RATE),
        ("T", {"delay": True}, 503, "catalog_unavailable", F_CATALOG_WAIT),
        ("F", {"status": 500, "json": {}}, 503, "catalog_unavailable", F_CATALOG_WAIT),
        ("J", {"body": "<<not json>>", "headers": JSON_HEADERS}, 502, "catalog_malformed", F_CATALOG_BAD),
        ("D", {"other": {"reference": "ALD-A"}}, 502, "catalog_malformed", F_CATALOG_BAD),
        ("V", {"other": {"revision": 0}}, 502, "catalog_malformed", F_CATALOG_BAD),
        ("P", {"other": {"image_path": "/elsewhere/x.svg"}}, 502, "catalog_malformed", F_CATALOG_BAD),
        ("I", {"image": "this is not svg"}, 502, "catalog_malformed", F_CATALOG_BAD),
        ("N", {"status": 404, "json": {"error": "unknown_reference"}}, 502, "catalog_missing", F_CATALOG_MISSING),
    ]
    for tag, spec, code_status, code, copy in cases:
        ref = fresh_ref(desk, tag)
        q = {"reference": ref}
        if "delay" in spec:
            wiremock.stub("GET", "/catalog/varieties", query=q, json=variety(ref), headers=JSON_HEADERS,
                          delay_ms=PROVIDER_TIMEOUT_MS + TIMEOUT_OVERSHOOT_MS)
        elif "other" in spec:
            wiremock.stub("GET", "/catalog/varieties", query=q, json=variety(ref, **spec["other"]), headers=JSON_HEADERS)
        elif "image" in spec:
            stub_record(wiremock, ref)
            wiremock.stub("GET", f"/catalog/images/{ref}.svg", body=spec["image"], headers={"Content-Type": "image/svg+xml"})
        else:
            wiremock.stub("GET", "/catalog/varieties", query=q, **spec)
        r = desk.command("POST", "/specimens/A/reconcile", {"expected_version": version, "correction": ref})
        assert_error(r, code_status, code, copy)
        if code_status == 429:
            assert r.headers.get("retry-after") == str(CATALOG_RETRY_S) and r.json()["retry_after_seconds"] == CATALOG_RETRY_S
        a = desk.state()["specimens"]["A"]
        assert a["attribution"]["register"] == "pending" and a["attribution"]["correction"] == ref, f"case {tag} lost the correction (L696)"
        assert a["version"] == version and a["status"] == "pending_catalogue", f"case {tag} changed the specimen"
    first = seed(app_url, "catalog_reconciliation")
    ref = fresh_ref(first, "M")
    with desk_page(browser, first) as page:
        w = work(page)
        sent = sniff(page, "/reconcile")
        fill(by(w, "textbox", "Attribution correction"), ref)
        confirm(page, "Review reconciliation", "Save reconciliation")
        expect(alert(page)).to_contain_text(F_CATALOG_MISSING, timeout=LONG_MS)
        expect(page.get_by_text(F_CATALOG_MISSING).first).to_be_visible()
        expect(by(w, "textbox", "Attribution correction")).to_have_value(ref)
        stub_record(wiremock, ref)
        button(page, "Retry catalog").click()
        announced(page, F_CATALOG_OK, LONG_MS)
    assert len(sent) == 2 and len({b["command_id"] for b in sent}) == 1, "R04 re-sends the same command (L698)"
    second = seed(app_url, "catalog_reconciliation")
    ref = fresh_ref(second, "U")
    wiremock.stub("GET", "/catalog/varieties", query={"reference": ref}, status=429,
                  headers={"Retry-After": str(UI_RETRY_AFTER_S)}, json={})
    with desk_page(browser, second) as page:
        w = work(page)
        sent = sniff(page, "/reconcile")
        divider = by(w, "slider", "Reference divider")
        divider.focus()
        page.keyboard.press("Home")
        for _ in range(3):
            page.keyboard.press("PageUp")
        for _ in range(7):
            page.keyboard.press("ArrowRight")
        fill(by(w, "textbox", "Attribution correction"), ref)
        confirm(page, "Review reconciliation", "Save reconciliation")
        expect(alert(page)).to_contain_text(F_CATALOG_RATE, timeout=LONG_MS)
        expect(page.get_by_text(re.compile(rf"Retrying catalog in [1-{UI_RETRY_AFTER_S}] seconds\.")).first).to_be_visible()
        retry = button(page, "Retry catalog")
        if retry.count():
            expect(retry).to_be_disabled()
        expect(by(w, "textbox", "Attribution correction")).to_have_value(ref)
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Obverse", 3 * PAGE_STEP + 7))
        stub_record(wiremock, ref)
        announced(page, F_CATALOG_OK, LONG_MS)
        assert any(F_CATALOG_RETRYING in t for t in announcements(page)), "the retry at zero is announced (L697)"
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Obverse", 3 * PAGE_STEP + 7))
    ids = {b["command_id"] for b in sent}
    assert len(sent) >= 2 and len(ids) == 1, f"retries must re-send the same command: {sent}"
    rec = events(second.state(), "specimen.reconciled")
    assert len(rec) == 1 and rec[0]["command_id"] in ids


def test_wf_catalog_reconciliation_session(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = seed(app_url, "catalog_reconciliation")
    ref = fresh_ref(desk, "S")
    stub_record(wiremock, ref)
    with desk_page(browser, desk) as page:
        w = work(page)
        sent = sniff(page, "/reconcile")
        divider = by(w, "slider", "Reference divider")
        divider.focus()
        page.keyboard.press("Home")
        for _ in range(6):
            page.keyboard.press("PageUp")
        fill(by(w, "textbox", "Attribution correction"), ref)
        desk.advance(SESSION_TTL_S + 1)
        confirm(page, "Review reconciliation", "Save reconciliation")
        expect(alert(page)).to_contain_text(F_SESSION)
        expect(by(w, "textbox", "Attribution correction")).to_have_value(ref)
        button(page, "Sign in again").click()
        expect(status(page)).to_contain_text(F_CATALOG_OK, timeout=LONG_MS)
        w = work(page)
        expect(by(w, "slider", "Reference divider")).to_have_attribute("aria-valuetext", wipe_text("Obverse", 6 * PAGE_STEP))
        expect(by(w, "textbox", "Attribution correction")).to_have_value(ref)
        jar = cookie_header(page.context.cookies(), desk.base)
    assert len(sent) == 2 and len({b["command_id"] for b in sent}) == 1, f"resume exactly once with the original command_id: {sent}"
    rec = events(desk.state(cookie=jar), "specimen.reconciled")
    assert len(rec) == 1 and rec[0]["command_id"] == sent[0]["command_id"]


def test_tray_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "tray_placement")
    for size in (PHONE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            row_major(w)
            holder = button(w, "Holder A")
            if size[0] <= PHONE_MAX_W:
                stacked(button(w, "Cell B1"), holder)
                stacked(holder, button(w, "Review placement"))
            elif size[0] <= TABLET_MAX_W:
                beside(button(w, "Cell A2"), holder)
            else:
                for c in CELLS:
                    inside(button(w, f"Cell {c}"), w)
                inside(holder, w)
                beside(by(page, "region", "Stock grid"), w)
            for c in CELLS:
                big_enough(button(w, f"Cell {c}"))
            layout(page)


def test_wf_tray_placement_happy(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "tray_placement")
    with desk_page(browser, desk) as page:
        w = work(page)
        keyboard_move(page, w, "Holder A", button(w, "Cell A1"))
        dlg = open_review(page, "Review placement", "Place holder")
        button(dlg, "Cancel").click()
        assert cell_specimen(desk.state(), "A1") is None, "a cancelled placement leaves occupancy unchanged"
        button(w, "Holder A").focus()
        page.keyboard.press("Space")
        page.keyboard.press("Escape")
        expect(w.get_by_role("button", name="Holder A", exact=True, pressed=True)).to_have_count(0)
        button(w, "Holder A").click()
        button(w, "Cell A1").click()
        confirm(page, "Review placement", "Place holder")
        announced(page, F_TRAY_OK)
    st = desk.state()
    assert cell_specimen(st, "A1") == "A" and len(events(st, "tray.placed")) == 1
    with desk_page(browser, desk, viewport=PHONE, touch=True) as phone:
        button(phone, "Holder A").tap()
        button(phone, "Cell B2").tap()
        confirm(phone, "Review placement", "Place holder")
        announced(phone, F_TRAY_OK)
    st = desk.state()
    assert cell_specimen(st, "B2") == "A" and cell_specimen(st, "A1") is None, "placing a shelved specimen moves it (L715)"
    assert len(events(st, "tray.placed")) == 2


def test_wf_tray_placement_refusals(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "tray_placement")
    with desk_page(browser, desk) as first, desk_page(browser, desk, "dealer_peer", block_stream=True) as second:
        w1, w2 = work(first), work(second)
        button(w1, "Holder A").click()
        button(w1, "Cell B1").click()
        button(w2, "Holder B").click()
        button(w2, "Cell B1").click()
        confirm(first, "Review placement", "Place holder")
        announced(first, F_TRAY_OK)
        confirm(second, "Review placement", "Place holder")
        expect(alert(second)).to_have_text(re.compile(f"{re.escape(F_CONFLICT)}|{re.escape(F_TRAY_TAKEN)}"))
        expect(button(w2, "Holder B")).to_be_visible()
        button(w1, "Holder C").click()
        button(w1, "Cell B2").click()
        attempt(first, "Review placement", "Place holder", first.get_by_text(F_TRAY_SIZE))
        button(w1, "Holder A").click()
        button(w1, "Cell A2").click()
        attempt(first, "Review placement", "Place holder", first.get_by_text(F_TRAY_TAKEN))
    st = desk.state()
    assert cell_specimen(st, "B1") == "A" and cell_specimen(st, "A2") == "B" and cell_specimen(st, "B2") is None
    assert len(events(st, "tray.placed")) == 1
    tv = st["versions"]["tray"]
    assert_error(place(desk, "C", "B2", tv), 422, "invalid", F_INVALID, {"cell": F_TRAY_SIZE})
    assert_error(place(desk, "C", "A2", tv), 409, "conflict", F_TRAY_TAKEN)
    assert_error(place(desk, "A", "A2", tv), 409, "conflict", F_TRAY_TAKEN)
    assert desk.state()["versions"]["tray"] == tv, "rejected placements change nothing (L652)"
    ids = (idempotency_key(), idempotency_key())
    rs = together(lambda: place(desk, "U", "B2", tv, command_id=ids[0]), lambda: place(desk, "A", "B2", tv, command_id=ids[1]))
    assert sorted(r.status_code for r in rs) == [200, 409], [r.text[:120] for r in rs]
    win = 0 if rs[0].status_code == 200 else 1
    loser = rs[1 - win].json()
    assert loser["error"] == "conflict" and loser["message"] in (F_CONFLICT, F_TRAY_TAKEN)
    st = desk.state()
    assert cell_specimen(st, "B2") == ("U", "A")[win]
    count = len(st["events"])
    replay = place(desk, ("U", "A")[win], "B2", tv, command_id=ids[win])
    assert replay.status_code == 200 and replay.json() == rs[win].json() and len(desk.state()["events"]) == count


def test_album_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "set_tracking")
    for size in (PHONE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            holes = [button(w, f"Hole {h}") for h in ("Mint A", "Mint K", "Mint O")]
            chip, review = button(w, "Specimen A"), button(w, "Review album placement")
            if size[0] <= PHONE_MAX_W:
                stacked(*holes, chip, review)
            elif size[0] <= TABLET_MAX_W:
                stacked(*holes)
                beside(holes[0], chip)
            else:
                for h in holes:
                    inside(h, w)
                beside(by(page, "region", "Stock grid"), w)
            for c in (*holes, chip, review):
                big_enough(c)
            layout(page)
            chip.click()
            holes[0].click()
            dlg = open_review(page, "Review album placement", "Fill album hole")
            big_enough(button(dlg, "Confirm"))
            button(dlg, "Cancel").click()


def test_wf_set_tracking_happy(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "set_tracking")
    with desk_page(browser, desk, viewport=PHONE, touch=True) as phone:
        touch_drag(phone, button(phone, "Specimen A"), button(phone, "Hole Mint A"))
        dlg = open_review(phone, "Review album placement", "Fill album hole")
        button(dlg, "Cancel").click()
    assert hole_specimen(desk.state(), "Mint A") is None
    with desk_page(browser, desk) as page, desk_page(browser, desk, "dealer_peer", viewport=TABLET) as observer:
        w = work(page)
        keyboard_move(page, w, "Specimen A", button(w, "Hole Mint A"))
        dlg = open_review(page, "Review album placement", "Fill album hole")
        button(dlg, "Cancel").click()
        assert hole_specimen(desk.state(), "Mint A") is None, "cancelling leaves the gap open"
        observer.evaluate(NO_RELOAD_JS)
        obs_hole = button(observer, "Hole Mint A")
        before = decode(capture(obs_hole))
        button(w, "Specimen A").click()
        button(w, "Hole Mint A").click()
        confirm(page, "Review album placement", "Fill album hole")
        announced(page, F_SET_OK)
        assert hole_specimen(desk.state(), "Mint A") == "A"

        def redrawn() -> bool:
            now = decode(capture(obs_hole))
            if (now.width, now.height) != (before.width, before.height):
                return True
            try:
                changed(before, now)
                return True
            except AssertionError:
                return False

        eventually(redrawn, "the other open screen redraws the filled hole without reload (L654)")
        assert not_reloaded(observer)


def test_wf_set_tracking_exclusions(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = seed(app_url, "set_tracking")
    st = desk.state()
    av = st["versions"]["album"]
    assert_error(fill_hole(desk, "Mint K", "U", av), 409, "conflict", F_SET_UNCERTAIN)
    assert_error(fill_hole(desk, "Mint O", "O", av), 409, "conflict", F_SET_OUTBOUND)
    assert_error(fill_hole(desk, "Mint K", "A", av), 422, "invalid", F_INVALID, {"specimen": F_SET_MISMATCH})
    st = desk.state()
    assert st["versions"]["album"] == av and events(st, "album.filled") == []
    with desk_page(browser, desk) as page:
        w = work(page)
        button(w, "Specimen A").click()
        button(w, "Hole Mint K").click()
        attempt(page, "Review album placement", "Fill album hole", page.get_by_text(F_SET_MISMATCH))
    assert fill_hole(desk, "Mint A", "A", av).status_code == 200
    st = desk.state()
    r = desk.command("POST", "/specimens/A/quarantine", {"expected_version": st["specimens"]["A"]["version"], "note": "doubt"})
    assert r.status_code == 200
    st = desk.state()
    assert hole_specimen(st, "Mint A") is None and len(events(st, "album.reopened")) == 1, "the hole reopens (L721)"
    holes = [{"label": f"Mint {m}", "reference": f"ALD-{m}", "mintmark": m} for m in "AKO"]
    holes += [{"label": f"Mint P{i:03d}", "reference": "ALD-A", "mintmark": "A"} for i in range(ALBUM_MAX_HOLES + 1 - len(holes))]
    album = {"set": "ALD-CROWN", "title": "Aldmere crown mints"}
    wiremock.stub("GET", "/catalog/albums", query={"set": "ALD-CROWN"}, json={**album, "revision": 2, "holes": holes}, headers=JSON_HEADERS)
    assert_error(desk.command("POST", "/album/reconcile", {}), 502, "catalog_malformed", F_CATALOG_BAD)
    assert set(desk.state()["album"]["holes"]) == {"Mint A", "Mint K", "Mint O"}
    wiremock.stub("GET", "/catalog/albums", query={"set": "ALD-CROWN"}, json={**album, "revision": 3, "holes": holes[:ALBUM_MAX_HOLES]}, headers=JSON_HEADERS)
    assert desk.command("POST", "/album/reconcile", {}).status_code == 200
    assert len(desk.state()["album"]["holes"]) == ALBUM_MAX_HOLES
    with desk_page(browser, desk, viewport=PHONE) as page:
        expect(page.get_by_role("button", name=re.compile(r"^Hole Mint "))).to_have_count(ALBUM_MAX_HOLES)
        layout(page)
    down = seed(os.environ["APP_WIREMOCK_DOWN_URL"], "set_tracking")
    assert ((down.state()["album"] or {}).get("holes") or {}) == {}, "no register record, no holes (L719)"
    assert_error(down.command("POST", "/album/reconcile", {}), 503, "catalog_unavailable", F_CATALOG_WAIT)
    with desk_page(browser, down) as page:
        expect(by(page, "region", "Album workspace")).to_be_visible()
        expect(button(page, "Hole Mint A")).to_have_count(0)


MAP_JS = """(img, [x, y, w, h]) => {
  const r = img.getBoundingClientRect();
  let sx = r.width / w, sy = r.height / h, ox = 0, oy = 0;
  if (img.tagName === 'IMG') {
    const fit = getComputedStyle(img).objectFit;
    if (fit === 'contain' || fit === 'scale-down' || fit === 'cover') {
      const s = fit === 'cover' ? Math.max(r.width / w, r.height / h) : Math.min(r.width / w, r.height / h);
      ox = (r.width - w * s) / 2; oy = (r.height - h * s) / 2; sx = s; sy = s;
    }
  }
  return {x: r.left + ox + x * sx, y: r.top + oy + y * sy};
}"""


def test_condition_layouts_marker_registration(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "condition_comparison")
    arrival = photo_of(desk.state(), "A", "arrival")
    with desk_page(browser, desk) as page:
        w = work(page)
        _condition_reveal_arrival(w, page)
        button(w, "Condition marker").click()
        set_coords(w, FEATURE_X, FEATURE_Y)
        offsets: list[tuple[float, float, float, float]] = []
        for size in (DESKTOP, TABLET, PHONE, DESKTOP):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            w = work(page)
            divider, note = by(w, "slider", "Condition wipe"), by(w, "textbox", "Condition note")
            if size[0] <= PHONE_MAX_W:
                stacked(by(w, "tab", "Obverse"), divider, by(w, "spinbutton", "Image x"), by(w, "spinbutton", "Image y"),
                        note, button(w, "Review condition note"))
            elif size[0] <= TABLET_MAX_W:
                beside(divider, note)
            else:
                inside(divider, w)
                inside(note, w)
            layout(page)
            marker, img = button(w, "Condition marker"), by(w, "img", "Specimen A arrival").first
            divider.focus()
            for keys in (("End",), ("PageDown",), ("PageDown", "PageDown")):
                for key in keys:
                    page.keyboard.press(key)
                marker.scroll_into_view_if_needed()
                box = marker.bounding_box()
                assert box, "marker is not rendered"
                point = img.evaluate(MAP_JS, [FEATURE_X, FEATURE_Y, arrival["width"], arrival["height"]])
                offsets.append((box["x"] + box["width"] / 2 - point["x"], box["y"] + box["height"] / 2 - point["y"], box["width"], box["height"]))
    dx0, dy0 = offsets[0][0], offsets[0][1]
    for dx, dy, bw, bh in offsets:
        assert abs(dx) <= bw / 2 + GEOMETRY_TOLERANCE_PX and abs(dy) <= bh / 2 + GEOMETRY_TOLERANCE_PX, f"marker left its point: {offsets}"
        assert abs(dx - dx0) <= GEOMETRY_TOLERANCE_PX and abs(dy - dy0) <= GEOMETRY_TOLERANCE_PX, f"marker drifted beyond tolerance (L723): {offsets}"


def test_wf_condition_comparison_happy(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "condition_comparison")
    note_text = "Hairline scratch through the mintmark"
    with desk_page(browser, desk, reduced=True) as page:
        w = work(page)
        divider = by(w, "slider", "Condition wipe")
        divider.focus()
        page.keyboard.press("Home")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Arrival", 0))
        expect(selected_tab(page, "Obverse")).to_be_visible()
        page.keyboard.press("End")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Arrival", 100))
        expect(selected_tab(page, "Arrival")).to_be_visible()
        page.keyboard.press("PageDown")
        page.keyboard.press("ArrowLeft")
        expect(divider).to_have_attribute("aria-valuetext", wipe_text("Arrival", 100 - PAGE_STEP - 1))
        marker, gx, gy = button(w, "Condition marker"), by(w, "spinbutton", "Image x"), by(w, "spinbutton", "Image y")
        marker.click()
        fill(gx, str(FIXTURE_EDGE_PX))
        gx.press("Enter")
        coord_err = page.get_by_text(F_COORD)
        reacted = False
        deadline = time.monotonic() + FIELD_REACTION_S
        while time.monotonic() < deadline:
            if coord_err.count() or spin_value(gx) == FIXTURE_EDGE_PX - 1:
                reacted = True
                break
        if not reacted:
            fill(by(w, "textbox", "Condition note"), note_text)
            attempt(page, "Review condition note", "Save condition note", coord_err)
            refused = dialog(page, "Save condition note")
            if refused.count() and refused.is_visible():
                page.keyboard.press("Escape")
                expect(refused).to_have_count(0)
        set_coords(w, FEATURE_X - SHIFT_STEP, FEATURE_Y - 5)
        marker.focus()
        page.keyboard.press("Shift+ArrowRight")
        for _ in range(5):
            page.keyboard.press("ArrowDown")
        eventually(lambda: spin_value(gx) == FEATURE_X and spin_value(gy) == FEATURE_Y, "arrows move the marker 1, Shift 10 (L265)")
        x, y = center(marker)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + PINCH_TO, y, steps=DRAG_STEPS)
        page.mouse.up()
        eventually(lambda: spin_value(gx) > FEATURE_X, "dragging the marker moves it in image coordinates (L264)")
        set_coords(w, FEATURE_X, FEATURE_Y)
        fill(by(w, "textbox", "Condition note"), note_text)
        confirm(page, "Review condition note", "Save condition note")
        announced(page, F_CONDITION_OK)
    a = desk.state()["specimens"]["A"]
    hit = [n for n in a["annotations"] if n["text"] == note_text and (n["x"], n["y"]) == (FEATURE_X, FEATURE_Y)]
    assert hit, f"annotation not saved at (600,400): {a['annotations']}"
    assert hit[0]["photo"] in {p["id"] for p in a["photos"]} | {p["label"] for p in a["photos"]}


def test_wf_condition_comparison_conflict_retry(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "condition_comparison")
    first_note, second_note = "First screen scratch", "Second screen scratch"
    with desk_page(browser, desk) as first, desk_page(browser, desk, "dealer_peer", block_stream=True) as second:
        for page, (x, y), note in ((first, (FEATURE_X, FEATURE_Y), first_note), (second, (FEATURE_X + 5, FEATURE_Y + 5), second_note)):
            w = work(page)
            _condition_reveal_arrival(w, page)
            button(w, "Condition marker").click()
            set_coords(w, x, y)
            fill(by(w, "textbox", "Condition note"), note)
        confirm(first, "Review condition note", "Save condition note")
        announced(first, F_CONDITION_OK)
        order_announced(first, F_PENDING, F_CONDITION_OK)
        confirm(second, "Review condition note", "Save condition note")
        expect(alert(second)).to_contain_text(F_CONFLICT)
        w2 = work(second)
        expect(by(w2, "textbox", "Condition note")).to_have_value(second_note)
        assert spin_value(by(w2, "spinbutton", "Image x")) == FEATURE_X + 5 and spin_value(by(w2, "spinbutton", "Image y")) == FEATURE_Y + 5
        expect(button(second, "Reload current").first).to_be_visible()
    texts = {(n["text"], n["x"], n["y"]) for n in desk.state()["specimens"]["A"]["annotations"]}
    assert (first_note, FEATURE_X, FEATURE_Y) in texts and not any(t[0] == second_note for t in texts)
    with desk_page(browser, desk, abort_photos=True) as third:
        expect(third.get_by_text(F_IMAGE_WAIT).first).to_be_visible()
        third.unroute(PHOTO_ROUTE)
        w3 = work(third)
        button(w3, "Retry image").first.click()
        img = by(w3, "img", "Specimen A arrival").first
        eventually(lambda: img.count() > 0 and img.evaluate("e => e.tagName !== 'IMG' || (e.complete && e.naturalWidth > 0)"),
                   "Retry image restores the photograph (L414)")
        expect(button(w3, "Condition marker")).to_be_visible()


def test_keeper_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "duplicate_selection")
    for size in (PHONE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            lst = by(w, "list", "Keeper preference")
            assert visual_order(lst, "Specimen ", "ABC") == ["A", "B", "C"]
            undo, review = button(w, "Undo last move"), button(w, "Review keeper order")
            if size[0] <= PHONE_MAX_W:
                stacked(lst, undo, review)
            elif size[0] <= TABLET_MAX_W:
                beside(lst, undo)
            else:
                inside(lst, w)
                beside(by(page, "region", "Stock grid"), w)
            layout(page)
            button(lst, "Specimen A").focus()
            for key in ("Space", "ArrowDown", "Enter"):
                page.keyboard.press(key)
            dlg = open_review(page, "Review keeper order", "Save keeper order")
            if size[0] <= PHONE_MAX_W:
                bottom_sheet(page, dlg)
            button(dlg, "Cancel").click()


def test_wf_duplicate_selection_reorder_undo(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "duplicate_selection")
    with desk_page(browser, desk) as page:
        lst = by(work(page), "list", "Keeper preference")
        a = button(lst, "Specimen A")
        a.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        announced(page, reorder_copy("Specimen A", 2, 3))
        expect(a).to_be_focused()
        page.keyboard.press("Escape")
        assert visual_order(lst, "Specimen ", "ABC") == ["A", "B", "C"], "Escape returns the item (L242)"
        a.focus()
        for key in ("Space", "ArrowDown", "Enter"):
            page.keyboard.press(key)
        assert visual_order(lst, "Specimen ", "ABC") == ["B", "A", "C"]
        assert desk.state()["keeper_order"] == ["A", "B", "C"], "a staged order is a draft"
        confirm(page, "Review keeper order", "Save keeper order")
        announced(page, F_KEEPER_OK)
        assert desk.state()["keeper_order"] == ["B", "A", "C"]
        confirm(page, "Undo last move", "Save keeper order")
        announced(page, F_UNDO_OK)
    st = desk.state()
    assert st["keeper_order"] == ["A", "B", "C"]
    r = desk.command("POST", "/keeper-order/undo", {"expected_version": st["versions"]["keeper_order"]})
    assert_error(r, 409, "conflict", F_UNDO_NONE)
    with desk_page(browser, desk, viewport=PHONE, touch=True) as phone:
        lst = by(phone, "list", "Keeper preference")
        src, top = button(lst, "Specimen C"), button(lst, "Specimen A")
        src.scroll_into_view_if_needed()
        box = top.bounding_box()
        assert box
        touch_path(phone, line(center(src), (box["x"] + box["width"] / 2, box["y"] + 2)))
        confirm(phone, "Review keeper order", "Save keeper order")
        announced(phone, F_KEEPER_OK)
    assert desk.state()["keeper_order"][0] == "C", "touch dragging reorders the list (L243)"


def test_wf_duplicate_selection_contention(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "duplicate_selection")
    with desk_page(browser, desk) as first, desk_page(browser, desk, "dealer_peer", viewport=TABLET) as observer:
        observer.evaluate(NO_RELOAD_JS)
        lst = by(work(first), "list", "Keeper preference")
        button(lst, "Specimen A").focus()
        for key in ("Space", "ArrowDown", "Enter"):
            first.keyboard.press(key)
        confirm(first, "Review keeper order", "Save keeper order")
        announced(first, F_KEEPER_OK)
        order_announced(first, F_PENDING, F_KEEPER_OK)
        obs = by(observer, "list", "Keeper preference")
        eventually(lambda: visual_order(obs, "Specimen ", "ABC") == ["B", "A", "C"], "the other screen shows the saved order (L27)")
        assert not_reloaded(observer)
    with desk_page(browser, desk, "dealer_peer", block_stream=True) as stale:
        st = desk.state()
        r = desk.command("PUT", "/keeper-order", {"expected_version": st["versions"]["keeper_order"], "order": ["C", "B", "A"]})
        assert r.status_code == 200
        lst = by(work(stale), "list", "Keeper preference")
        button(lst, "Specimen B").focus()
        for key in ("Space", "ArrowDown", "Enter"):
            stale.keyboard.press(key)
        confirm(stale, "Review keeper order", "Save keeper order")
        expect(alert(stale)).to_contain_text(F_CONFLICT)
        stale.unroute(STREAM_ROUTE)
        eventually(lambda: visual_order(lst, "Specimen ", "ABC") == ["C", "B", "A"], "the loser re-renders in the server's order")
    v = desk.state()["versions"]["keeper_order"]
    orders = (["A", "B", "C"], ["B", "C", "A"])
    rs = together(*(lambda o=o: desk.command("PUT", "/keeper-order", {"expected_version": v, "order": o}) for o in orders))
    assert sorted(r.status_code for r in rs) == [200, 409]
    win = 0 if rs[0].status_code == 200 else 1
    assert_error(rs[1 - win], 409, "conflict", F_CONFLICT)
    st = desk.state()
    assert st["keeper_order"] == orders[win]
    bad = desk.command("PUT", "/keeper-order", {"expected_version": st["versions"]["keeper_order"], "order": ["A", "A", "B"]})
    assert_error(bad, 422, "invalid", F_INVALID, {"order": F_ORDER})


def test_offer_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "offer_assembly")
    for size in (PHONE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            dealer_b, cp_b = by(w, "region", "Dealer basket"), by(w, "region", "Counterpart basket")
            review = button(w, "Review offer")
            if size[0] <= PHONE_MAX_W:
                stacked(button(w, "Specimen A"), dealer_b, button(w, "Specimen X"), cp_b, review)
            elif size[0] <= TABLET_MAX_W:
                beside(dealer_b, cp_b)
                stacked(dealer_b, review)
                stacked(cp_b, review)
            else:
                beside(by(page, "region", "Exchange list"), w)
                inside(dealer_b, w)
                inside(cp_b, w)
            layout(page)
            button(w, "Specimen A").click()
            dealer_b.click()
            button(w, "Specimen X").click()
            cp_b.click()
            dlg = open_review(page, "Review offer", "Send reciprocal offer")
            if size[0] <= PHONE_MAX_W:
                bottom_sheet(page, dlg)
            button(dlg, "Cancel").click()


def test_wf_offer_assembly_send(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "offer_assembly")
    with desk_page(browser, desk, "counterpart") as cp, desk_page(browser, desk) as page:
        cp_corner = by(cp, "link", "Open exchange circle")
        expect(cp_corner).to_contain_text(corner(1))
        cp.evaluate(NO_RELOAD_JS)
        w = work(page)
        keyboard_move(page, w, "Specimen A", by(w, "region", "Dealer basket"))
        button(w, "Specimen X").click()
        by(w, "region", "Counterpart basket").click()
        expect(by(page, "link", "Open exchange circle")).to_contain_text(F_CORNER_VERIFY)
        confirm(page, "Review offer", "Send reciprocal offer")
        verify_identity(page, desk, "dealer")
        expect(status(page)).to_contain_text(F_OFFER_OK, timeout=LONG_MS)
        expect(by(page, "link", "Open exchange circle")).to_contain_text(F_CORNER_VERIFIED)
        expect(cp_corner).to_contain_text(corner(2), timeout=LIVE_MS + LIVE_SLACK_MS)
        assert not_reloaded(cp)
    st = desk.state()
    sent = [o for o in st["offers"].values() if o["status"] == "sent"]
    assert len(sent) == 1 and sent[0]["dealer_items"] == ["A"] and sent[0]["counterpart_items"] == ["X"]
    assert sent[0]["remaining_seconds"] == OFFER_WINDOW_S
    assert st["specimens"]["A"]["status"] == "reserved" and st["specimens"]["X"]["status"] == "reserved"
    assert len(events(st, "offer.sent")) == 1


def send(desk: Desk, offer: str, version: int, dealer: list[str], counterpart: list[str], cookie: str | None = None) -> httpx.Response:
    return desk.command("POST", f"/offers/{offer}/send",
                        {"expected_version": version, "dealer_items": dealer, "counterpart_items": counterpart}, cookie=cookie)


def test_wf_offer_assembly_reservation_race(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "offer_assembly")
    st = desk.state()
    v1, v2 = st["offers"]["offer-1"]["version"], st["offers"]["offer-2"]["version"]
    assert_error(send(desk, "offer-1", v1, ["A"], ["X"]), 403, "step_up_required", F_MFA_REQUIRED)
    assert desk.state()["specimens"]["A"]["status"] != "reserved"
    jar = step_up_cookie(browser, desk, "dealer")
    assert_error(send(desk, "offer-1", v1, [], ["X"], jar), 422, "invalid", F_INVALID, {"dealer_items": F_BASKET_EMPTY})
    assert_error(send(desk, "offer-1", v1, ["A"], ["Y"], jar), 404, "not_found", F_HIDDEN)
    r = desk.command("POST", "/specimens/C/reconcile", {"expected_version": st["specimens"]["C"]["version"], "correction": fresh_ref(desk, "Q")})
    assert r.status_code == 502
    assert_error(send(desk, "offer-2", v2, ["C"], ["X"], jar), 409, "conflict", F_CATALOG_PENDING)
    assert desk.state()["specimens"]["X"]["status"] != "reserved", "a refused send reserves nothing"
    rs = together(lambda: send(desk, "offer-1", v1, ["A"], ["X"], jar), lambda: send(desk, "offer-2", v2, ["B"], ["X"], jar))
    assert sorted(r.status_code for r in rs) == [200, 409], [r.text[:120] for r in rs]
    win = 0 if rs[0].status_code == 200 else 1
    assert_error(rs[1 - win], 409, "conflict", F_OFFER_TAKEN)
    st = desk.state()
    names, items = ("offer-1", "offer-2"), ("A", "B")
    loser = st["offers"][names[1 - win]]
    assert loser["status"] == "draft" and loser["dealer_items"] == [] and loser["counterpart_items"] == []
    assert st["specimens"][items[1 - win]]["status"] != "reserved", "the loser's basket stays unreserved (L742)"
    assert st["specimens"][items[win]]["status"] == "reserved" and st["specimens"]["X"]["status"] == "reserved"


def test_counteroffer_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "counteroffers")
    for size in (PHONE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            window = by(page, "region", "Response window")
            expect(window).to_contain_text(F_WINDOW_ACCEPTED)
            a_img, x_img = by(w, "img", "Specimen A obverse").first, by(w, "img", "Specimen X obverse").first
            review, accept = button(w, "Review replacement"), button(w, "Accept current offer")
            if size[0] <= PHONE_MAX_W:
                stacked(window, a_img, x_img, review, accept)
            elif size[0] <= TABLET_MAX_W:
                stacked(window, a_img)
                beside(a_img, x_img)
                stacked(x_img, accept)
            else:
                beside(by(page, "region", "Exchange list"), w)
                inside(a_img, w)
                inside(x_img, w)
                expect(by(page, "region", "Exchange list")).to_contain_text(F_WINDOW_ACCEPTED)
            big_enough(review)
            big_enough(accept)
            layout(page)
            dlg = open_review(page, "Accept current offer", "Accept offer version")
            if size[0] <= PHONE_MAX_W:
                bottom_sheet(page, dlg)
            expect(button(dlg, "Verify acceptance")).to_be_visible()
            button(dlg, "Cancel").click()


def accept_version(page: Page, desk: Desk, role: str) -> None:
    dlg = open_review(page, "Accept current offer", "Accept offer version")
    button(dlg, "Verify acceptance").click()
    keycloak_code(page, desk, role)
    dlg = dialog(page, "Accept offer version")
    expect(button(dlg, "Confirm")).to_be_enabled(timeout=LONG_MS)
    button(dlg, "Confirm").click()
    expect(status(page)).to_contain_text(F_COUNTER_ACCEPT, timeout=LONG_MS)
    record(page)


def test_wf_counteroffers_replace_accept(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "counteroffers")
    v0 = desk.state()["offers"]["offer-1"]["version"]
    with desk_page(browser, desk, "counterpart") as cp, desk_page(browser, desk) as page:
        w = work(page)
        keyboard_move(page, w, "Specimen B", button(w, "Specimen A"))
        confirm(page, "Review replacement", "Replace offered specimen")
        announced(page, F_COUNTER_VOID)
        announced(cp, F_COUNTER_VOID, LIVE_MS + LIVE_SLACK_MS)
        expiry = GRADE_CLOCK + timedelta(seconds=OFFER_WINDOW_S)
        expect(by(cp, "region", "Response window")).to_contain_text(window_copy(OFFER_WINDOW_S, expiry))
        o = desk.state()["offers"]["offer-1"]
        assert o["dealer_items"] == ["B"] and o["acceptances"] == {"dealer": None, "counterpart": None}
        assert o["status"] == "sent" and o["version"] == v0 + 1
        accept_version(page, desk, "dealer")
        o = desk.state()["offers"]["offer-1"]
        assert o["acceptances"]["dealer"] == v0 + 1 and o["status"] == "sent"
        accept_version(cp, desk, "counterpart")
        for p in (page, cp):
            expect(by(p, "region", "Response window")).to_contain_text(F_WINDOW_ACCEPTED, timeout=LIVE_MS + LIVE_SLACK_MS)
    st = desk.state()
    o = st["offers"]["offer-1"]
    assert o["status"] == "accepted" and o["acceptances"] == {"dealer": v0 + 1, "counterpart": v0 + 1}
    assert o["expires_at"] is None and o["version"] == v0 + 1, "accepting never bumps the version (L743)"
    assert st["specimens"]["B"]["status"] == "outbound" and st["specimens"]["X"]["status"] == "outbound"


def _counteroffers_share_available_b(browser: Browser, desk: Desk) -> datetime:
    v = desk.state()["offers"]["offer-0"]["version"]
    r = desk.command(
        "POST",
        "/offers/offer-0/replace",
        {"expected_version": v, "remove": "O", "add": "B"},
    )
    assert r.status_code == 200, r.text[:300]

    elapsed = OFFER_WINDOW_S + 1
    desk.advance(elapsed)

    for role in ("dealer", "counterpart"):
        target = urlparse(desk.entries[role])
        path = target.path + ("?" + target.query if target.query else "")
        login = f"{desk.base}/auth/login?return_to={quote(path, safe='')}"
        with desk_page(
            browser, desk, role, url=login, listen=False
        ) as page:
            page.wait_for_url(
                lambda u: same_origin(u, origin(desk.base))
                and urlparse(u).path == target.path,
                timeout=LONG_MS,
            )
            desk.sessions[role] = page.context.storage_state()

    st = desk.state()
    assert st["offers"]["offer-0"]["status"] == "expired"
    assert st["offers"]["offer-0"]["dealer_items"] == ["B"]
    assert st["offers"]["offer-1"]["status"] == "accepted"
    assert st["specimens"]["B"]["status"] not in ("reserved", "outbound")
    assert "B" in desk.state("counterpart")["specimens"]
    return GRADE_CLOCK + timedelta(seconds=elapsed)


def test_wf_counteroffers_window_clock(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "counteroffers")
    now = _counteroffers_share_available_b(browser, desk)
    v = desk.state()["offers"]["offer-1"]["version"]

    paths = {}
    for role in ("dealer", "counterpart"):
        target = urlparse(desk.entries[role])
        paths[role] = target.path + ("?" + target.query if target.query else "")

    with desk_page(
        browser, desk, fixed_clock=WRONG_DEVICE_CLOCK
    ) as page, desk_page(
        browser, desk, "counterpart", fixed_clock=WRONG_DEVICE_CLOCK
    ) as cp:
        r = desk.command(
            "POST",
            "/offers/offer-1/replace",
            {"expected_version": v, "remove": "A", "add": "B"},
            role="counterpart",
        )
        assert r.status_code == 200, r.text[:300]
        o = desk.state()["offers"]["offer-1"]
        assert o["status"] == "countered"
        assert o["remaining_seconds"] == COUNTER_WINDOW_S
        expiry = now + timedelta(seconds=COUNTER_WINDOW_S)

        for p in (page, cp):
            expect(by(p, "region", "Response window")).to_contain_text(
                window_copy(COUNTER_WINDOW_S, expiry),
                timeout=LIVE_MS + LIVE_SLACK_MS,
            )

        desk.advance(REFRESH_ADVANCE_S)
        for p in (page, cp):
            expect(by(p, "region", "Response window")).to_contain_text(
                window_copy(COUNTER_WINDOW_S - REFRESH_ADVANCE_S, expiry),
                timeout=WINDOW_REFRESH_S * 1000 + LIVE_SLACK_MS,
            )

        desk.advance(COUNTER_WINDOW_S - REFRESH_ADVANCE_S - CLOSING_S)
        jar = relogin(page, desk, paths["dealer"])
        relogin(cp, desk, paths["counterpart"])
        o = desk.state(cookie=jar)["offers"]["offer-1"]
        assert o["remaining_seconds"] == CLOSING_S
        assert o["closing"] is True
        for p in (page, cp):
            expect(by(p, "link", "Open exchange circle")).to_contain_text(
                F_CORNER_CLOSING
            )
            expect(by(p, "region", "Response window")).to_contain_text(
                window_copy(CLOSING_S, expiry)
            )

        desk.advance(CLOSING_S + 1)
        jar = relogin(page, desk, paths["dealer"])
        relogin(cp, desk, paths["counterpart"])
        st = desk.state(cookie=jar)
        o = st["offers"]["offer-1"]
        assert o["status"] == "expired"
        assert o["remaining_seconds"] == 0
        assert o["closing"] is False
        assert st["specimens"]["B"]["status"] != "reserved"
        assert st["specimens"]["X"]["status"] != "reserved"
        for p in (page, cp):
            expect(by(p, "region", "Response window")).to_contain_text(
                window_closed(expiry)
            )

    r = desk.command(
        "POST",
        "/offers/offer-1/replace",
        {"expected_version": o["version"], "remove": "B", "add": "A"},
        cookie=jar,
    )
    assert_error(r, 409, "conflict", F_OFFER_EXPIRED)


@pytest.mark.timeout(600)
def test_wf_counteroffers_hold_release(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "counteroffers")
    _counteroffers_share_available_b(browser, desk)

    def holds() -> list[str]:
        return desk.state()["offers"]["offer-1"]["holds"]

    with desk_page(browser, desk) as dealer:
        with desk_page(browser, desk, "counterpart") as cp:
            w = work(cp)
            button(w, "Specimen B").click()
            button(w, "Specimen A").click()
            announced(cp, hold_placed("Specimen B"))
            eventually(
                lambda: "B" in holds(),
                "the staged replacement places a hold on B (L754)",
            )
            assert desk.state()["specimens"]["B"]["status"] == "reserved"

        closed = time.monotonic()
        assert "B" in holds(), "the hold lasts past the tab closing"
        eventually(
            lambda: "B" not in holds(),
            "hold released after FLAN_HOLD_GRACE_S (L754)",
            HOLD_GRACE_S + HOLD_SLACK_S,
        )
        assert time.monotonic() - closed >= HOLD_GRACE_S - HOLD_EARLY_S, (
            "hold released before the grace period"
        )
        assert events(desk.state(), "hold.released")
        announced(dealer, hold_released("Specimen B"))

    for _ in range(ABORTED_STREAMS):
        with httpx.stream(
            "GET",
            desk.base + desk.desk_path("/stream?after=0"),
            headers={"Cookie": desk.cookie("dealer")},
            timeout=HTTP_TIMEOUT_S,
        ) as resp:
            assert resp.status_code == 200

    pg = Postgres()
    eventually(
        lambda: pg.rows(ACTIVE_SQL)[0]["n"] == 0,
        "aborted streams left app sessions active (L981)",
        ABORT_SETTLE_S,
    )
    assert desk.call("GET", desk.desk_path("/state")).status_code == 200


def test_dispatch_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "dispatch")
    for size in (PHONE, PHONE_PROBE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            manifest, review = by(w, "list", "Packing manifest"), button(w, "Review dispatch")
            if size[0] <= PHONE_MAX_W:
                stacked(manifest, review)
            elif size[0] <= TABLET_MAX_W:
                beside(manifest, review)
            else:
                beside(by(page, "region", "Exchange list"), w)
                inside(manifest, w)
            layout(page)
            dlg = open_review(page, "Review dispatch", "Freeze dispatch evidence")
            x, y = center(button(dlg, "Confirm"))
            button(dlg, "Cancel").click()
            expect(dialog(page, "Freeze dispatch evidence")).to_have_count(0)
            names = tab_order(page, TAB_SWEEP)
            assert "Confirm" not in names and "Cancel" not in names, f"closed review is focusable (L137): {names}"
            if size[0] <= PHONE_MAX_W:
                assert "Close desk tools" not in names
            page.mouse.click(x, y)
            assert desk.state()["manifests"]["offer-1/dealer"]["frozen"] is False, "a closed sheet takes no taps"


def test_wf_dispatch_reorder_freeze(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "dispatch")
    s3 = S3()
    with desk_page(browser, desk) as page:
        manifest = by(work(page), "list", "Packing manifest")
        eventually(lambda: manifest.get_by_role("button", name=re.compile(r"^Manifest item [ABC]$")).count() == 3,
                   "the manifest lists items A, B and C")
        button(manifest, "Manifest item B").focus()
        for key in ("Space", "ArrowDown", "Escape"):
            page.keyboard.press(key)
        assert visual_order(manifest, "Manifest item ", "ABC") == ["A", "B", "C"]
        c = button(manifest, "Manifest item C")
        c.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowUp")
        expect(c).to_be_focused()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        announced(page, reorder_copy("Specimen C", 1, 3))
        assert visual_order(manifest, "Manifest item ", "ABC") == ["C", "A", "B"]
        dlg = open_review(page, "Review dispatch", "Freeze dispatch evidence")
        button(dlg, "Cancel").click()
        assert desk.state()["manifests"]["offer-1/dealer"]["frozen"] is False
        confirm(page, "Review dispatch", "Freeze dispatch evidence")
        announced(page, F_DISPATCH_OK, LONG_MS)
    st = desk.state()
    m = st["manifests"]["offer-1/dealer"]
    assert m["frozen"] is True and m["order"] == ["C", "A", "B"] and len(m["evidence"]) == 3
    for e in m["evidence"]:
        assert e["object_key"].startswith(f"manifests/{desk.ns}/offer-1/dealer/{e['specimen']}-dispatch-{e['sha256']}")
        assert sha(s3.get(e["object_key"])) == e["sha256"]
        assert e["sha256"] == photo_of(st, e["specimen"], "obverse")["sha256"], "dispatch copies the latest obverse (L758)"
    json.loads(s3.get(f"manifests/{desk.ns}/offer-1/dealer/manifest.json"))
    assert len(events(st, "manifest.frozen")) == 1


def freeze(desk: Desk, party: str, order: list[str], version: int, role: str) -> httpx.Response:
    return desk.command("POST", f"/offers/offer-1/manifests/{party}/freeze", {"expected_version": version, "order": order}, role=role)


def test_wf_dispatch_frozen_conflicts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "dispatch")
    s3 = S3()
    cv = desk.state()["manifests"]["offer-1/counterpart"]["version"]
    rs = together(lambda: freeze(desk, "counterpart", ["X"], cv, "counterpart"), lambda: freeze(desk, "counterpart", ["X"], cv, "counterpart"))
    assert sorted(r.status_code for r in rs) == [200, 409]
    lose = next(r for r in rs if r.status_code == 409).json()
    assert lose["error"] == "conflict" and lose["message"] in (F_DISPATCH_FROZEN, F_CONFLICT)
    st = desk.state()
    assert len(events(st, "manifest.frozen")) == 1 and st["offers"]["offer-1"]["status"] == "accepted"
    with desk_page(browser, desk) as page:
        manifest = by(work(page), "list", "Packing manifest")
        button(manifest, "Manifest item C").focus()
        for key in ("Space", "ArrowUp", "ArrowUp", "Enter"):
            page.keyboard.press(key)
        confirm(page, "Review dispatch", "Freeze dispatch evidence")
        announced(page, F_DISPATCH_OK, LONG_MS)
        order_announced(page, F_PENDING, F_DISPATCH_OK)
        m = desk.state()["manifests"]["offer-1/dealer"]
        assert all(e["object_key"] in s3.keys(f"manifests/{desk.ns}/offer-1/dealer/") for e in m["evidence"])
        button(manifest, "Manifest item A").focus()
        for key in ("Space", "ArrowDown", "Enter"):
            page.keyboard.press(key)
        attempt(page, "Review dispatch", "Freeze dispatch evidence", alert(page).filter(has_text=F_DISPATCH_FROZEN))
    with desk_page(browser, desk) as page:
        manifest = by(work(page), "list", "Packing manifest")
        eventually(lambda: visual_order(manifest, "Manifest item ", "ABC") == ["C", "A", "B"], "the frozen order stays (L428)")
    st = desk.state()
    m = st["manifests"]["offer-1/dealer"]
    assert st["offers"]["offer-1"]["status"] == "dispatched"
    assert_error(freeze(desk, "dealer", ["A", "B", "C"], m["version"] - 1, "dealer"), 409, "conflict", F_DISPATCH_FROZEN)
    assert_error(freeze(desk, "dealer", ["A", "B", "C"], m["version"], "counterpart"), 403, "forbidden", F_FORBIDDEN)
    assert desk.state()["manifests"]["offer-1/dealer"]["order"] == ["C", "A", "B"]
    down = seed(os.environ["APP_MINIO_DOWN_URL"], "dispatch")
    dm = down.state()["manifests"]["offer-1/dealer"]
    assert_error(freeze(down, "dealer", ["C", "A", "B"], dm["version"], "dealer"), 503, "service_unavailable", F_SERVICE)
    st = down.state()
    assert st["manifests"]["offer-1/dealer"]["frozen"] is False and events(st, "manifest.frozen") == []


def test_receipt_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "receipt")
    for size in (PHONE, TABLET, DESKTOP):
        with desk_page(browser, desk, viewport=size) as page:
            w = work(page)
            arrival, dispatched = by(w, "img", "Specimen X arrival").first, by(w, "img", "Specimen X dispatch").first
            upload, tick, review = button(w, "Arrival photo"), by(w, "checkbox", "Manifest matches"), button(w, "Review receipt")
            if size[0] <= PHONE_MAX_W:
                stacked(arrival, dispatched, upload, tick, review)
            elif size[0] <= TABLET_MAX_W:
                beside(dispatched, arrival)
            else:
                inside(arrival, w)
                inside(dispatched, w)
                beside(by(page, "region", "Exchange list"), w)
            layout(page)


def test_wf_receipt_zoom_input(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "receipt")
    s3 = S3()
    new_arrival = face(31)

    with desk_page(browser, desk, viewport=PHONE, touch=True) as page:
        w = work(page)
        zoom = by(w, "slider", "Arrival zoom")
        zoom.focus()
        for key, value in (
            ("Home", ZOOM_MIN),
            ("ArrowUp", ZOOM_MIN + ZOOM_STEP),
            ("End", ZOOM_MAX),
            ("Home", ZOOM_MIN),
        ):
            page.keyboard.press(key)
            expect(zoom).to_have_attribute("aria-valuetext", zoom_text(value))

        pinch_out(page, by(w, "img", "Specimen X arrival").first)
        eventually(
            lambda: slider_now(zoom) > ZOOM_MIN,
            "pinching the arrival photograph zooms it (L252)",
        )

        stage(page, button(w, "Arrival photo"), new_arrival, "arrival.png")
        check(by(w, "checkbox", "Manifest matches"))
        dlg = open_review(page, "Review receipt", "Record receipt")
        button(dlg, "Cancel").click()
        assert not (
            desk.state()["receipts"].get("offer-1/dealer") or {}
        ).get("confirmed")

        confirm(page, "Review receipt", "Record receipt")
        verify_identity(page, desk, "dealer")
        expect(status(page)).to_contain_text(F_RECEIPT_WAIT, timeout=LONG_MS)

        digest = sha(new_arrival)
        eventually(
            lambda: s3.keys(f"arrivals/{desk.ns}/offer-1/X-{digest}"),
            "arrival photograph stored in MinIO (L853)",
        )

    st = desk.state()
    assert st["receipts"]["offer-1/dealer"] == {
        "confirmed": True,
        "matches": True,
    }
    assert st["offers"]["offer-1"]["status"] == "received"
    assert st["specimens"]["X"]["owner"] == "counterpart"
    assert st["specimens"]["A"]["owner"] == "dealer"


def record_receipt(page: Page, desk: Desk, role: str, copy: str) -> None:
    check(by(work(page), "checkbox", "Manifest matches"))
    confirm(page, "Review receipt", "Record receipt")
    verify_identity(page, desk, role)
    expect(status(page)).to_contain_text(copy, timeout=LONG_MS)
    record(page)


def test_wf_receipt_transfer(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "receipt")
    with desk_page(browser, desk) as page, desk_page(browser, desk, "counterpart") as cp:
        record_receipt(page, desk, "dealer", F_RECEIPT_WAIT)
        st = desk.state()
        assert st["offers"]["offer-1"]["status"] == "received" and st["specimens"]["A"]["owner"] == "dealer"
        record_receipt(cp, desk, "counterpart", F_RECEIPT_DONE)
        announced(page, F_RECEIPT_DONE, LIVE_MS + LIVE_SLACK_MS)
    st = desk.state()
    assert st["offers"]["offer-1"]["status"] == "transferred"
    assert st["specimens"]["A"]["owner"] == "counterpart" and st["specimens"]["X"]["owner"] == "dealer"
    assert len(events(st, "ownership.transferred")) == 1


def test_wf_receipt_password_change(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "receipt")
    v = desk.state()["offers"]["offer-1"]["version"]
    with desk_page(browser, desk, "counterpart") as cp:
        expect(by(work(cp), "img", "Specimen A arrival").first).to_be_visible()
        desk.identity("password_change")
        expect(alert(cp)).to_contain_text(F_REVOKED, timeout=LIVE_MS + LIVE_SLACK_MS)
        expect(cp.get_by_role("img", name=re.compile(r"^Specimen "))).to_have_count(0)
        expect(by(cp, "main", "Specimen desk")).to_be_focused()
    r = desk.command("POST", "/offers/offer-1/receipts", {"expected_version": v, "matches": True}, role="counterpart")
    assert_error(r, 401, "authentication_required", F_SESSION)
    st = desk.state()
    assert not (st["receipts"].get("offer-1/counterpart") or {}).get("confirmed") and events(st, "receipt.recorded") == []


def open_dispute(page: Page) -> None:
    w = work(page)
    button(w, "Damage marker").click()
    set_coords(w, FEATURE_X, FEATURE_Y)
    fill(by(w, "textbox", "Damage note"), "Fresh gouge at the mintmark")
    confirm(page, "Review dispute", "Hold ownership transfer")
    announced(page, F_DISPUTE_OPEN, LONG_MS)


def test_dispute_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "disputes")
    sizes = (PHONE, TABLET, DESKTOP)
    for size in sizes:
        with desk_page(browser, desk, "counterpart", viewport=size) as page:
            w = work(page)
            arrival, note = by(w, "img", "Specimen A arrival").first, by(w, "textbox", "Damage note")
            expect(button(w, "Damage marker")).to_be_visible()
            if size[0] <= PHONE_MAX_W:
                stacked(arrival, note, button(w, "Review dispute"))
                assert rect(arrival)["w"] >= rect(note)["w"] - 2 * VIEWER_INSET_SLACK_PX, "phone evidence stays full width"
            elif size[0] <= TABLET_MAX_W:
                beside(arrival, note)
            else:
                inside(arrival, w)
                inside(note, w)
                beside(by(page, "region", "Exchange list"), w)
            layout(page)
            dlg = open_review(page, "Review dispute", "Hold ownership transfer")
            if size[0] <= PHONE_MAX_W:
                bottom_sheet(page, dlg)
            button(dlg, "Cancel").click()
    with desk_page(browser, desk, "counterpart") as page:
        open_dispute(page)
    for size in sizes:
        with desk_page(browser, desk, "counterpart", viewport=size) as page:
            dlg = open_review(page, "Propose resolution", "Resolve transfer hold")
            expect(by(dlg, "radio", "Transfer as agreed")).to_be_visible()
            expect(by(dlg, "radio", "Return both baskets")).to_be_visible()
            if size[0] <= PHONE_MAX_W:
                bottom_sheet(page, dlg)
            button(dlg, "Cancel").click()


def test_wf_disputes_open_resolve(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "disputes")
    with desk_page(browser, desk, "counterpart") as cp, desk_page(browser, desk) as dl:
        w = work(cp)
        marker = button(w, "Damage marker")
        marker.click()
        set_coords(w, FEATURE_X - SHIFT_STEP, FEATURE_Y)
        marker.focus()
        cp.keyboard.press("Shift+ArrowRight")
        eventually(lambda: spin_value(by(w, "spinbutton", "Image x")) == FEATURE_X, "Shift+arrow moves the marker 10 (L265)")
        fill(by(w, "textbox", "Damage note"), "Fresh gouge")
        confirm(cp, "Review dispute", "Hold ownership transfer")
        announced(cp, F_DISPUTE_OPEN, LONG_MS)
        announced(dl, F_DISPUTE_OPEN, LIVE_MS + LIVE_SLACK_MS)
        st = desk.state()
        (did, d), = st["disputes"].items()
        assert d["open"] is True and d["specimen"] == "A" and st["offers"]["offer-1"]["status"] == "disputed"
        assert [(m["x"], m["y"]) for m in d["markers"]] == [(FEATURE_X, FEATURE_Y)]
        keys = S3().keys(f"disputes/{desk.ns}/{did}/evidence-")
        assert keys, "dispute snapshot written to MinIO (L773)"
        snapshot = json.dumps(json.loads(S3().get(keys[0])))
        assert photo_of(st, "A", "arrival")["object_key"] in snapshot
        dispatch_key = next(e["object_key"] for e in st["manifests"]["offer-1/dealer"]["evidence"] if e["specimen"] == "A")
        assert dispatch_key in snapshot
        dlg = open_review(dl, "Propose resolution", "Resolve transfer hold")
        by(dlg, "radio", "Transfer as agreed").check()
        button(dlg, "Confirm").click()
        announced(dl, F_RESOLUTION_WAIT)
        announced(cp, F_RESOLUTION_WAIT, LIVE_MS + LIVE_SLACK_MS)
        expect(button(dl, "Propose resolution")).to_be_focused()
        d = desk.state()["disputes"][did]
        assert d["resolution"] == {"outcome": "transfer", "proposed_by": "dealer"} and d["open"] is True
        button(work(cp), "Approve resolution").click()
        done = status(cp).filter(has_text=F_RESOLUTION_DONE)
        maybe = cp.get_by_role("dialog").get_by_role("button", name="Confirm", exact=True)
        expect(done.or_(maybe).first).to_be_visible()
        if maybe.count() and maybe.is_visible():
            maybe.click()
        announced(cp, F_RESOLUTION_DONE)
        announced(dl, F_RESOLUTION_DONE, LIVE_MS + LIVE_SLACK_MS)
    st = desk.state()
    d = st["disputes"][did]
    assert d["open"] is False and "counterpart" in d["resolution_approvals"]
    assert st["offers"]["offer-1"]["status"] == "received" and st["specimens"]["A"]["owner"] == "dealer"


def test_wf_disputes_links_markers(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "disputes")
    s3 = S3()
    with desk_page(browser, desk, "counterpart", permissions=["clipboard-read", "clipboard-write"]) as cp:
        open_dispute(cp)
        st = desk.state()
        (did, d), = st["disputes"].items()
        arrival_bytes = s3.get(photo_of(st, "A", "arrival")["object_key"])
        button(work(cp), "Copy private evidence link").click()
        announced(cp, F_LINK_COPIED)
        url = cp.evaluate("() => navigator.clipboard.readText()")
        assert "/evidence/" in url, f"clipboard holds {url!r}"
        path = urlparse(url).path
        for role in ("counterpart", "dealer"):
            r = desk.call("GET", path, role=role)
            assert r.status_code == 200 and r.content == arrival_bytes and "no-store" in r.headers.get("cache-control", "")
        assert_error(desk.call("GET", path, role="outsider"), 404, "not_found", F_HIDDEN)
        assert desk.call("GET", path, role=None).status_code in (401, 404)
        confirm(cp, "Revoke evidence link", "Revoke evidence access")
        announced(cp, F_LINK_REVOKED)
        assert_error(desk.call("GET", path, role="counterpart"), 404, "not_found", F_HIDDEN)
    with desk_page(browser, desk) as dl:
        mid = d["markers"][0]["id"]
        dv = desk.state()["disputes"][did]["version"]
        xs = (FEATURE_X + SHIFT_STEP, FEATURE_X + 2 * SHIFT_STEP)
        rs = together(*(lambda x=x, role=role: desk.command("PUT", f"/disputes/{did}/markers/{mid}",
                                                            {"expected_version": dv, "x": x, "y": FEATURE_Y, "text": "gouge"}, role=role)
                        for x, role in zip(xs, ("dealer", "counterpart"))))
        assert sorted(r.status_code for r in rs) == [200, 409]
        win = 0 if rs[0].status_code == 200 else 1
        assert_error(rs[1 - win], 409, "conflict", F_CONFLICT)
        assert desk.state()["disputes"][did]["markers"][0]["x"] == xs[win]
        w = work(dl)
        button(w, "Damage marker").click()
        eventually(lambda: spin_value(by(w, "spinbutton", "Image x")) == xs[win], "screens show the server's marker position")
    link = desk.command("POST", f"/disputes/{did}/links", {}, role="dealer")
    assert link.status_code == 201
    lpath = urlparse(link.json()["link"]["url"]).path
    assert desk.call("GET", lpath, role="dealer").status_code == 200
    desk.advance(LINK_TTL_S + 1)
    assert_error(desk.call("GET", lpath, role="dealer"), 404, "not_found", F_HIDDEN)
    jar = step_up_cookie(browser, desk, "counterpart")
    ov = desk.state()["offers"]["offer-1"]["version"]
    assert desk.command("POST", "/offers/offer-1/receipts", {"expected_version": ov, "matches": True}, cookie=jar).status_code == 200
    st = desk.state()
    assert st["offers"]["offer-1"]["status"] == "disputed" and st["specimens"]["A"]["owner"] == "dealer", "an open dispute holds transfer"
    dv = st["disputes"][did]["version"]
    assert desk.command("POST", f"/disputes/{did}/resolution", {"expected_version": dv, "outcome": "transfer"}).status_code == 200
    dv = desk.state()["disputes"][did]["version"]
    assert_error(desk.command("POST", f"/disputes/{did}/approve-resolution", {"expected_version": dv}), 403, "forbidden", F_FORBIDDEN)
    assert desk.command("POST", f"/disputes/{did}/approve-resolution", {"expected_version": dv}, role="counterpart").status_code == 200
    st = desk.state()
    assert st["offers"]["offer-1"]["status"] == "transferred"
    assert st["specimens"]["A"]["owner"] == "counterpart" and st["specimens"]["X"]["owner"] == "dealer"


@pytest.mark.timeout(1200)
def test_audit_layouts_and_paging(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "stock_audit")
    with desk_page(browser, desk, viewport=PHONE) as page:
        for size in (PHONE, (PHONE[1], PHONE[0]), PHONE, TABLET, DESKTOP):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            w = work(page)
            tray, mark = by(w, "group", "Audit tray"), button(w, "Mark missing")
            row_major(tray)
            if size[0] <= PHONE_MAX_W:
                beside(button(w, "Previous cell"), button(w, "Next cell"))
                stacked(tray, mark)
            elif size[0] <= TABLET_MAX_W:
                beside(tray, mark)
            else:
                inside(tray, w)
            layout(page)
    small = face(20)
    created = [f"{desk.ns}-p{i:02d}" for i in range(PAGE_MAX + 2)]
    for ref in created:
        r = intake(desk, ref, small, small)
        assert r.status_code == 201, r.text[:200]
    listing = desk.desk_path("/specimens")
    assert_error(desk.call("GET", f"{listing}?limit={PAGE_MAX + 1}"), 422, "invalid", F_INVALID, {"limit": page_limit(PAGE_MAX)})
    full = desk.call("GET", listing).json()
    assert len(full["items"]) == PAGE_MAX and full["next"] is not None
    seen: list[str] = []
    after: str | None = None
    for n in range(len(created) + 10):
        q = f"{listing}?limit={WALK_PAGE}" + (f"&after={quote(str(after))}" if after is not None else "")
        body = desk.call("GET", q).json()
        assert len(body["items"]) <= WALK_PAGE
        seen += [i["key"] for i in body["items"]]
        tv = desk.state()["versions"]["tray"]
        assert place(desk, "A", ("B2", "A1")[n % 2], tv).status_code == 200
        after = body["next"]
        if after is None:
            break
    else:
        pytest.fail("specimen list never ended (L554)")
    assert len(seen) == len(set(seen)), "a specimen repeated across pages"
    assert [k for k in seen if k in created] == created, "pages skipped or reordered created specimens"
    cells: list[str] = []
    after = None
    for _ in range(len(CELLS) + 2):
        q = desk.desk_path("/audit/cells?limit=1") + (f"&after={after}" if after else "")
        body = desk.call("GET", q).json()
        cells += [i["cell"] for i in body["items"]]
        after = body["next"]
        if after is None:
            break
    assert cells == list(CELLS), f"audit list must page each cell once in row-major order: {cells}"
    assert_error(desk.call("GET", desk.desk_path(f"/audit/cells?limit={PAGE_MAX + 1}")), 422, "invalid", F_INVALID, {"limit": page_limit(PAGE_MAX)})
    with desk_page(browser, desk) as page:
        grid = by(page, "region", "Stock grid")
        first_chip, last = button(grid, "Specimen A"), button(grid, f"Specimen {created[-1]}")
        expect(first_chip).to_be_visible()
        expect(last).to_have_count(0)
        flips = 0
        for _ in range(len(created) + FIXTURE_DEALER_STOCK):
            button(grid, "Next page").click()
            flips += 1
            try:
                expect(last).to_be_visible(timeout=PAGE_FLIP_MS)
                break
            except AssertionError:
                continue
        else:
            pytest.fail("Next page never reached the last created specimen in the Stock grid (L184)")
        for _ in range(flips):
            button(grid, "Previous page").click()
        expect(first_chip).to_be_visible()
        expect(last).to_have_count(0)


def test_wf_stock_audit_navigation_mark(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "stock_audit")
    with desk_page(browser, desk, viewport=PHONE, touch=True, reduced=True) as page:
        w = work(page)
        tray = by(w, "group", "Audit tray")
        before = {c: rect(button(tray, f"Cell {c}")) for c in CELLS}

        def selected(cell: str) -> None:
            expect(tray.get_by_role("button", name=f"Cell {cell}", exact=True, pressed=True)).to_be_visible()

        button(tray, "Cell A1").click()
        selected("A1")
        button(tray, "Cell A1").focus()
        for key, cell in (("ArrowRight", "A2"), ("ArrowDown", "B2"), ("ArrowRight", "B2"), ("ArrowLeft", "B1"),
                          ("ArrowUp", "A1"), ("ArrowLeft", "A1")):
            page.keyboard.press(key)
            selected(cell)
        for name, cell in (("Next cell", "A2"), ("Next cell", "B1"), ("Previous cell", "A2"), ("Previous cell", "A1")):
            button(w, name).tap()
            selected(cell)
        if button(w, "Previous cell").is_enabled():
            button(w, "Previous cell").tap()
        selected("A1")
        box = tray.bounding_box()
        assert box
        mid_y = box["y"] + box["height"] / 2
        touch_path(page, line((box["x"] + box["width"] * 0.8, mid_y), (box["x"] + box["width"] * 0.2, mid_y)))
        selected("A2")
        touch_path(page, line((box["x"] + box["width"] * 0.2, mid_y), (box["x"] + box["width"] * 0.8, mid_y)))
        selected("A1")
        assert {c: rect(button(tray, f"Cell {c}")) for c in CELLS} == before, "physical cells never rearrange (L272)"
        confirm(page, "Mark missing", "Record missing item")
        announced(page, F_AUDIT_MISSING)
        st = desk.state()
        assert st["specimens"]["A"]["missing"] is True and st["specimens"]["A"]["status"] == "missing"
        assert st["tray"]["A1"]["audit_version"] == 1 and [e["cell"] for e in st["audit_events"]] == ["A1"]
        page.context.set_offline(True)
        button(w, "Next cell").tap()
        selected("A2")
        confirm(page, "Mark missing", "Record missing item")
        expect(status(page)).to_contain_text(F_OFFLINE)
    st = desk.state()
    assert st["specimens"]["B"]["missing"] is False and st["tray"]["A2"]["audit_version"] == 0, "offline marks stay queued"


def test_wf_stock_audit_offline_sync(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "stock_audit")
    with desk_page(browser, desk) as page, desk_page(browser, desk, "dealer_peer", url=f"{desk.base}/desk/{desk.ns}") as observer:
        tile = by(observer, "link", "Open stock")
        expect(tile).to_contain_text(stock_lines(FIXTURE_DEALER_STOCK, 3)[0])
        observer.evaluate(NO_RELOAD_JS)
        page.context.set_offline(True)
        for cell in ("A1", "A2", "B1"):
            button(by(work(page), "group", "Audit tray"), f"Cell {cell}").click()
            confirm(page, "Mark missing", "Record missing item")
            expect(status(page)).to_contain_text(F_OFFLINE)
        assert desk.command("POST", "/audit/marks", {"expected_version": 0, "cell": "B1", "mark": "missing"}).status_code == 200
        syncs = sniff(page, "/audit/sync")
        page.route(AUDIT_ROUTE, lambda route: route.abort())
        page.context.set_offline(False)
        page.reload()
        record(page)
        page.unroute(AUDIT_ROUTE)
        retry, done = button(page, "Retry sync"), status(page).filter(has_text=F_SYNCED)
        expect(retry.or_(done).first).to_be_visible(timeout=LONG_MS)
        if not done.count():
            retry.click()
        announced(page, F_SYNCED, LONG_MS)
        expect(button(page, "Reload current").first).to_be_visible()
        assert sum(F_AUDIT_MISSING in t for t in announcements(page)) >= 2, "each replayed mark is announced (L438)"
        expect(tile).to_contain_text(stock_lines(FIXTURE_DEALER_STOCK - 3, 3)[0], timeout=LIVE_MS + LIVE_SLACK_MS)
        assert not_reloaded(observer)
    st = desk.state()
    marks = st["audit_events"]
    a1 = [e for e in marks if e["cell"] == "A1"]
    a2 = [e for e in marks if e["cell"] == "A2"]
    b1 = [e for e in marks if e["cell"] == "B1"]
    assert len(a1) == 1 and len(a2) == 1 and a1[0]["sequence"] < a2[0]["sequence"], f"replay once each in order: {marks}"
    assert len(b1) == 1 and st["tray"]["B1"]["audit_version"] == 1, "the stale B1 mark must not overwrite the newer change"
    assert syncs, "queued marks are sent through POST /audit/sync (L784)"
    count = len(marks)
    r = desk.call("POST", desk.desk_path("/audit/sync"), json_body=syncs[-1])
    assert r.status_code == 200 and len(r.json()["results"]) == len(syncs[-1]["commands"])
    assert len(desk.state()["audit_events"]) == count, "replayed command_ids apply once"
    many = [{"command_id": idempotency_key(), "expected_version": 0, "cell": "B2", "mark": "missing"} for _ in range(SYNC_BATCH_MAX + 1)]
    r = desk.call("POST", desk.desk_path("/audit/sync"), json_body={"commands": many})
    assert_error(r, 422, "invalid", F_INVALID, {"commands": sync_limit(SYNC_BATCH_MAX)})


def test_desk_shell_layouts(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "cross-cutting")
    home = f"{desk.base}/desk/{desk.ns}"
    for size in (PHONE, PHONE_PROBE, TABLET, DESKTOP):
        with desk_page(browser, desk, url=home, viewport=size) as page:
            vw = size[0]
            phone = vw <= PHONE_MAX_W
            mark, stock, exchange = by(page, "link", "Flan"), by(page, "tab", "Stock"), by(page, "tab", "Exchange")
            corner_block, status_region = by(page, "link", "Open exchange circle"), by(page, "region", "Desk status")
            sheet = by(page, "main", "Specimen desk")
            rm, rs, re_, rc, rl, rsh = (rect(x) for x in (mark, stock, exchange, corner_block, status_region, sheet))
            assert rm["x"] < vw / 4 and rm["y"] < rl["y"], "the wordmark sits top left on the upper rule"
            beside(stock, exchange)
            tabs_mid = (rs["x"] + re_["x"] + re_["w"]) / 2
            assert abs(tabs_mid - vw / 2) <= vw * 0.1, "folder tabs sit at the centre (L101)"
            if phone:
                assert rs["y"] >= rm["y"] + rm["h"] - EDGE_SLACK_PX, "phone tabs sit below the wordmark"
                assert rc["y"] >= rs["y"] + rs["h"] - EDGE_SLACK_PX and rc["w"] >= vw * 0.8, "phone corner block is a full-width strip"
            else:
                assert rc["x"] + rc["w"] >= re_["x"] + re_["w"] and rc["y"] <= rl["y"], "corner block flush top right"
            expect(corner_block).to_contain_text(corner(2))
            expect(corner_block).to_contain_text(F_CORNER_VERIFY)
            expect(corner_block).not_to_contain_text(F_CORNER_CLOSING)
            expect(status_region).to_contain_text(status_line_text := status_line_copy())
            assert rl["x"] < vw / 2, "status line is left-aligned"
            assert rsh["x"] > 0 and rsh["x"] + rsh["w"] < vw, "grey margin shows around the specimen sheet"
            directory = by(page, "region", "Tray directory")
            rd = rect(directory)
            if phone:
                assert rd["w"] >= vw * 0.8
            else:
                assert vw * 0.3 <= rd["w"] <= vw * 0.7 and abs(rd["x"] + rd["w"] / 2 - vw / 2) <= vw * 0.1
            tile_stock, tile_exchange = by(page, "link", "Open stock"), by(page, "link", "Open exchanges")
            stacked(tile_stock, tile_exchange)
            for text in stock_lines(FIXTURE_DEALER_STOCK, 1):
                expect(tile_stock).to_contain_text(text)
            for text in exchange_lines(2, 0):
                expect(tile_exchange).to_contain_text(text)
            obverse_facts, reverse_facts = by(page, "region", "Obverse facts"), by(page, "region", "Reverse facts")
            if phone:
                stacked(obverse_facts, reverse_facts)
            else:
                a, b = rect(obverse_facts), rect(reverse_facts)
                beside(obverse_facts, reverse_facts)
                assert abs(a["y"] - b["y"]) <= EDGE_SLACK_PX + 1 and abs(a["h"] - b["h"]) <= EDGE_SLACK_PX + 1, "fact boxes pair at equal height"
            footer = by(page, "navigation", "Desk footer")
            stacked(sheet, footer)
            boxes = []
            for name in ("Evidence policy", "Keyboard guide", "Desk help"):
                link = by(footer, "link", name)
                r = rect(link)
                boxes.append(r)
                if not phone:
                    assert r["x"] + r["w"] / 2 > vw / 2, "footer links sit right"
                big_enough(link)
            if phone:
                fr = rect(footer)
                assert min(b["x"] for b in boxes) > fr["x"] + EDGE_SLACK_PX, "the legal line sits left of the footer links"
                assert max(b["x"] + b["w"] for b in boxes) >= fr["x"] + fr["w"] - TARGET_MIN_PX, "footer links sit right"
            for c in (mark, stock, exchange, corner_block, tile_stock, tile_exchange):
                big_enough(c)
            rest, hover = state_styles(by(footer, "link", "Desk help"), "text-decoration-line", "font-weight", state="hover")
            _, focus = state_styles(by(footer, "link", "Desk help"), "text-decoration-line", state="focus")
            assert "underline" not in rest["text-decoration-line"] and int(rest["font-weight"]) >= 600, "teal action link: bold, no underline at rest"
            assert "underline" in hover["text-decoration-line"] and "underline" in focus["text-decoration-line"]
            expect(dialog(page, "Desk tools")).to_have_count(0)
            if phone:
                expect(button(page, "Open desk tools")).to_be_visible()
                big_enough(button(page, "Open desk tools"))
                expect(by(page, "navigation", "Workspaces")).to_have_count(0)
                names = tab_order(page, TAB_SWEEP)
                assert "Close desk tools" not in names and "Intake" not in names, f"closed desk tools are inert (L137): {names}"
                weight = sheet.evaluate("""m => { const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT,
                    {acceptNode: n => n.textContent.trim() ? 1 : 3}); const t = w.nextNode();
                    return t ? Number(getComputedStyle(t.parentElement).fontWeight) : 0; }""")
                assert weight >= 600, "the day's lead line is bold (L111)"
            else:
                expect(button(page, "Open desk tools")).to_have_count(0)
                expect(by(by(page, "navigation", "Workspaces"), "link", "Intake")).to_be_visible()
            layout(page)
            if size in (PHONE, DESKTOP):
                axe(page)
            assert status_line_text
    with desk_page(browser, desk, url=home) as page:
        assert intake(desk, f"{desk.ns}-N", face(21), face(22)).status_code == 201
        expect(by(page, "region", "Desk status")).to_contain_text(status_line(1, 1), timeout=LIVE_MS + LIVE_SLACK_MS)
        expect(by(page, "link", "Open stock")).to_contain_text(stock_lines(FIXTURE_DEALER_STOCK + 1, 1)[0])


def status_line_copy() -> str:
    return status_line(0, 0)


def test_desk_breakpoints_keep_work(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "cross-cutting")
    draft = "Breakpoint draft"
    with desk_page(browser, desk, url=f"{desk.base}/desk/{desk.ns}") as page:
        by(by(page, "navigation", "Workspaces"), "link", "Condition").click()
        note = by(work(page), "textbox", "Condition note")
        fill(note, draft)
        note.focus()
        for width, height in ((TABLET_MAX_W, DESKTOP[1]), (DESKTOP_MIN_W, DESKTOP[1]), (TABLET_MIN_W, TABLET[1]), (PHONE_MAX_W, TABLET[1])):
            page.set_viewport_size({"width": width, "height": height})
            inspector, tools = by(page, "region", "Inspector"), button(page, "Open desk tools")
            if width >= DESKTOP_MIN_W:
                expect(inspector).to_be_visible()
            else:
                expect(inspector).to_be_hidden()
            if width <= PHONE_MAX_W:
                expect(tools).to_be_visible()
            else:
                expect(tools).to_be_hidden()
            box = by(page, "textbox", "Condition note")
            expect(box).to_have_value(draft)
            expect(box).to_be_focused()
            layout(page)


def test_wf_cross_cutting_desk_tools_resume(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "cross-cutting")
    note_text = "Session resume scratch"
    with desk_page(browser, desk, url=f"{desk.base}/desk/{desk.ns}", viewport=PHONE, touch=True) as page:
        tools = button(page, "Open desk tools")
        tab_to(page, tools)
        page.keyboard.press("Enter")
        dlg = dialog(page, "Desk tools")
        expect(dlg).to_be_visible()
        eventually(lambda: dlg.evaluate("d => d.contains(document.activeElement)"), "opening desk tools moves focus inside (L292)")
        trapped(page, dlg)
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(tools).to_be_focused()
        tools.tap()
        button(dlg, "Close desk tools").tap()
        expect(dlg).to_have_count(0)
        expect(tools).to_be_focused()
        tools.tap()
        by(by(dlg, "navigation", "Workspaces"), "link", "Condition").tap()
        expect(by(page, "region", "Condition comparison workspace")).to_be_visible()
        if dlg.count():
            button(dlg, "Close desk tools").tap()
        expect(dlg).to_have_count(0)
        record(page)
        _condition_reveal_arrival(page, page)
        button(page, "Condition marker").tap()
        set_coords(page, FEATURE_X, FEATURE_Y)
        fill(by(page, "textbox", "Condition note"), note_text)
        sheet = open_review(page, "Review condition note", "Save condition note")
        trapped(page, sheet)
        page.keyboard.press("Escape")
        expect(button(page, "Review condition note")).to_be_focused()
        sent = sniff(page, "/annotations")
        desk.advance(SESSION_TTL_S + 1)
        confirm(page, "Review condition note", "Save condition note")
        expect(alert(page)).to_contain_text(F_SESSION)
        button(page, "Sign in again").click()
        expect(status(page)).to_contain_text(F_CONDITION_OK, timeout=LONG_MS)
        expect(by(page, "textbox", "Condition note")).to_have_value(note_text)
        jar = cookie_header(page.context.cookies(), desk.base)
    assert len(sent) == 2 and len({b["command_id"] for b in sent}) == 1, f"resume exactly once with the same command: {sent}"
    st = desk.state(cookie=jar)
    saved = events(st, "annotation.saved")
    assert len(saved) == 1 and saved[0]["command_id"] == sent[0]["command_id"]
    assert any(n["text"] == note_text and (n["x"], n["y"]) == (FEATURE_X, FEATURE_Y) for n in st["specimens"]["A"]["annotations"])


def test_wf_cross_cutting_revocation_surface(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "cross-cutting")
    st = desk.state("counterpart")
    assert st["tray"] == {} and st["album"] == {} and st["keeper_order"] == [] and st["audit_events"] == []
    assert "Y" not in st["specimens"] and "U" not in st["specimens"], "a counterpart sees only specimens their records name"
    probes = [
        ("GET", "/specimens", None, {}),
        ("POST", "/tray/placements", b"{not json", JSON_HEADERS),
        ("DELETE", "/keeper-order", None, {}),
        ("GET", "/audit/cells", None, {}),
        ("POST", "/specimens/A/quarantine", b"plain", {"Content-Type": "text/plain"}),
        ("POST", "/album/reconcile", b"x" * (REQUEST_MAX_BYTES + 1), JSON_HEADERS),
    ]
    for role in ("counterpart", "outsider"):
        for method, suffix, content, headers in probes:
            r = desk.call(method, desk.desk_path(suffix), role=role, content=content, headers=headers)
            assert_error(r, 404, "not_found", F_HIDDEN)
    assert_error(desk.call("GET", desk.desk_path("/state"), role="outsider"), 404, "not_found", F_HIDDEN)
    assert_error(desk.call("GET", "/api/nowhere"), 404, "not_found", F_HIDDEN)
    wrong = desk.call("DELETE", "/api/health")
    assert_error(wrong, 405, "method_not_allowed", F_BAD_BODY)
    assert "GET" in wrong.headers.get("allow", "")
    tray = desk.desk_path("/tray/placements")
    assert_error(desk.call("POST", tray, content=b"{", headers=JSON_HEADERS), 400, "bad_request", F_BAD_BODY)
    assert_error(desk.call("POST", tray, content=b"cell=A1", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type", F_BAD_BODY)
    assert_error(desk.call("POST", tray, content=b"x" * (REQUEST_MAX_BYTES + 1), headers=JSON_HEADERS), 413, "too_large", F_TOO_LARGE)
    for headers in ({}, {GRADE_HEADER: "wrong-key"}):
        r = httpx.post(desk.base + "/__grade/seed", json={"namespace": fresh_namespace(), "workflow": "intake", "variant": "base"},
                       headers=headers, timeout=HTTP_TIMEOUT_S)
        assert_error(r, 404, "not_found", F_HIDDEN)
    foreign_origin = "http://elsewhere.example"
    cors = desk.call("GET", "/api/session", headers={"Origin": foreign_origin})
    granted = [k for k, val in cors.headers.items() if val.strip() in (foreign_origin, "*")]
    assert not granted, f"cross-origin requests get no CORS grant (L980): {granted}"
    html = desk.call("GET", "/", role=None).text
    assets = [a for a in re.findall(r'(?:src|href)="([^"]+)"', html) if a.startswith("/")]
    secrets = [os.environ[k] for k in ("AUTH_CLIENT_SECRET", "S3_SECRET_ACCESS_KEY", "FLAN_GRADE_KEY") if len(os.environ.get(k, "")) >= 8]
    for path in ["/"] + assets:
        body = desk.call("GET", path, role=None).text
        for secret in secrets:
            assert secret not in body, f"{path} leaks a configured secret (L967)"
    v = desk.state()["offers"]["offer-1"]["version"]
    with desk_page(browser, desk, "counterpart") as cp:
        expect(cp.get_by_role("img", name=re.compile(r"^Specimen ")).first).to_be_visible()
        desk.identity("revoke")
        expect(alert(cp)).to_contain_text(F_REVOKED, timeout=LIVE_MS + LIVE_SLACK_MS)
        expect(cp.get_by_role("img", name=re.compile(r"^Specimen "))).to_have_count(0)
        expect(by(cp, "main", "Specimen desk")).to_be_focused()
    users = [u for u in Keycloak().users(f"{desk.ns}-counterpart") if u.get("username") == f"{desk.ns}-counterpart"]
    assert users and users[0].get("enabled") is False, "revocation disables the Keycloak user (L863)"
    r = desk.command("POST", "/offers/offer-1/replace", {"expected_version": v, "remove": "X", "add": "X"}, role="counterpart")
    assert_error(r, 401, "authentication_required", F_SESSION)
    assert desk.state()["offers"]["offer-1"]["version"] == v


def test_wf_cross_cutting_outages(browser: Browser) -> None:
    for var in ("APP_WIREMOCK_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_KEYCLOAK_DOWN_URL", "APP_POSTGRES_DOWN_URL"):
        r = httpx.get(os.environ[var].rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, f"{var}: health must answer 200 (L881)"
    pg = os.environ["APP_POSTGRES_DOWN_URL"].rstrip("/")
    r = httpx.post(pg + "/__grade/seed", json={"namespace": fresh_namespace(), "workflow": "intake", "variant": "base"},
                   headers=grade_headers(), timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 503 and r.json() == {"error": "service_unavailable", "message": F_SERVICE}
    context = browser.new_context(viewport={"width": DESKTOP[0], "height": DESKTOP[1]})
    try:
        page = context.new_page()
        page.goto(pg + "/desk/hollowmint")
        expect(by(page, "link", "Flan")).to_be_visible()
        expect(page.get_by_text(F_SERVICE).first).to_be_visible()
    finally:
        context.close()
    desk = seed(os.environ["APP_KEYCLOAK_DOWN_URL"], "tray_placement")
    st = desk.state()
    assert_error(place(desk, "A", "A1", st["versions"]["tray"]), 503, "service_unavailable", F_SERVICE)
    st = desk.state()
    assert cell_specimen(st, "A1") is None and events(st, "tray.placed") == []
    with desk_page(browser, desk) as page:
        w = work(page)
        button(w, "Holder A").click()
        button(w, "Cell A1").click()
        confirm(page, "Review placement", "Place holder")
        expect(alert(page)).to_contain_text(F_SERVICE, timeout=LONG_MS)
        assert not any(F_TRAY_OK in t for t in announcements(page))
    login = httpx.get(f"{desk.base}/auth/login", params={"return_to": f"/desk/{desk.ns}"}, timeout=HTTP_TIMEOUT_S)
    if login.status_code == 503 and "json" in login.headers.get("content-type", ""):
        assert_error(login, 503, "service_unavailable", F_SERVICE)
    else:
        with desk_page(browser, desk, None, url=f"{desk.base}/auth/login?return_to=/desk/{desk.ns}", listen=False) as page:
            expect(page.get_by_text(F_SIGNIN_DOWN).first).to_be_visible()


APP = Path("/app")
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
OTHER_STORES = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "level", "lmdb", "memcached",
                "bullmq", "bull", "amqplib", "kafkajs", "nedb", "lowdb", "mysql", "mysql2"}
REAL_NAMES = ("PCGS", "NGC", "Heritage Auctions", "Stack's Bowers", "Numista", "Krause", "Morgan dollar")


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), f"run.json {key} must be a command string"


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"
    for asset in ("Saira", "Archivo", "Lucide"):
        assert asset in notices, f"{asset} missing from THIRD_PARTY_NOTICES.md"


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"


def test_if_datastores() -> None:
    found = sorted({p.name for p in shipped_packages()} & OTHER_STORES)
    assert not found, f"other datastore clients shipped: {found}"
    assert Postgres().tables(), "the app keeps its system of record in Postgres"


def test_if_keycloak_runtime(app_url: str) -> None:
    desk = seed(app_url, "intake")
    kc = Keycloak()
    for ns in ("hollowmint", desk.ns):
        names = {u.get("username") for u in kc.users(f"{ns}-")}
        for role in ("dealer", "counterpart", "outsider"):
            assert f"{ns}-{role}" in names, f"Keycloak user {ns}-{role} missing (L861)"


def test_if_bundled_assets(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "cross-cutting")
    allowed = [origin(desk.base)] + [origin(os.environ[k]) for k in ("KEYCLOAK_URL", "AUTH_ISSUER_URL") if os.environ.get(k)]
    with desk_page(browser, desk, url=f"{desk.base}/desk/{desk.ns}", listen=False) as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        page.reload(wait_until="load")
        page.evaluate("() => document.fonts.ready.then(() => true)")
        try:
            page.wait_for_function(
                """names => names.every(n => Array.from(document.fonts).some(
                    f => f.status === 'loaded' && f.family.replace(/["']/g, '').includes(n)))""",
                arg=["Saira", "Archivo"], timeout=UI_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            families = page.evaluate("() => Array.from(document.fonts).map(f => f.family + ':' + f.status)")
            pytest.fail(f"Saira and Archivo must load from the bundle (L997): {families}")
        foreign = [u for u in urls if u.startswith("http") and not any(same_origin(u, o) for o in allowed)]
        assert not foreign, f"third-party requests: {foreign[:10]}"


def test_if_invented_names(app_url: str) -> None:
    for path in ("/", "/help", "/help/evidence", "/help/keyboard"):
        r = httpx.get(app_url.rstrip("/") + path, timeout=HTTP_TIMEOUT_S, follow_redirects=True)
        for name in REAL_NAMES:
            assert name not in r.text, f"{path} uses a real name {name!r}"


def _intake_stage_pair(page: Page, obverse: bytes, reverse: bytes) -> None:
    w = work(page)
    for source, destination, payload in (
        ("Obverse photo", "Obverse slot", obverse),
        ("Reverse photo", "Reverse slot", reverse),
    ):
        stage(page, button(w, source), payload)
        button(w, source).click()
        button(w, destination).click()


def test_wf_intake_layouts_keep_staged_files(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "intake")
    ref = f"{desk.ns}-I"
    obverse, reverse = face(3), face(4)
    with desk_page(browser, desk) as page:
        _intake_stage_pair(page, obverse, reverse)
        reference = by(work(page), "textbox", "Specimen reference")
        fill(reference, ref)
        reference.focus()
        for size in (
            (TABLET_MAX_W, DESKTOP[1]),
            TABLET,
            (PHONE_MAX_W, PHONE[1]),
            PHONE_PROBE,
            PHONE,
            TABLET,
            DESKTOP,
        ):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            w = work(page)
            reference = by(w, "textbox", "Specimen reference")
            expect(reference).to_have_value(ref)
            expect(reference).to_be_focused()
            if size[0] <= PHONE_MAX_W:
                stacked(
                    button(w, "Obverse photo"),
                    button(w, "Obverse slot"),
                    button(w, "Reverse photo"),
                    button(w, "Reverse slot"),
                    reference,
                    button(w, "Review intake"),
                )
            elif size[0] <= TABLET_MAX_W:
                beside(
                    button(w, "Obverse slot"), button(w, "Reverse slot")
                )
            else:
                inside(button(w, "Obverse slot"), w)
                inside(button(w, "Reverse slot"), w)
                beside(by(page, "region", "Stock grid"), w)
        confirm(page, "Review intake", "Create specimen")
        announced(page, F_INTAKE_OK, LONG_MS)
    assert_stored_faces(desk, S3(), ref, obverse, reverse)


def test_wf_attribution_breakpoints_keep_note_focus(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "attribution")
    note_text = FAMILY * 2
    with desk_page(browser, desk) as page:
        note = by(work(page), "textbox", "Attribution note")
        fill(note, note_text)
        note.focus()
        for size in (
            (TABLET_MAX_W, DESKTOP[1]),
            TABLET,
            (PHONE_MAX_W, PHONE[1]),
            PHONE_PROBE,
            TABLET,
            DESKTOP,
        ):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            w = work(page)
            note = by(w, "textbox", "Attribution note")
            zoom = by(w, "slider", "Mintmark zoom")
            expect(note).to_have_value(note_text)
            expect(note).to_be_focused()
            if size[0] <= PHONE_MAX_W:
                stacked(zoom, note)
            elif size[0] <= TABLET_MAX_W:
                beside(zoom, note)
            else:
                inside(zoom, w)
                inside(note, w)
                beside(by(page, "region", "Stock grid"), w)
        confirm(page, "Review quarantine", "Quarantine attribution")
        announced(page, F_ATTR_OK)
    assert desk.state()["specimens"]["A"]["attribution"]["note"] == note_text


def test_wf_attribution_keyboard_reload_note(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "attribution")
    note_text = FAMILY * 3
    with desk_page(browser, desk) as page:
        note = by(work(page), "textbox", "Attribution note")
        note.focus()
        page.keyboard.press("ControlOrMeta+A")
        page.keyboard.insert_text(note_text)
        page.reload()
        record(page)
        w = work(page)
        expect(by(w, "textbox", "Attribution note")).to_have_value(note_text)
        opener = button(w, "Review quarantine")
        tab_to(page, opener)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Quarantine attribution")
        expect(dlg).to_be_visible()
        expect(button(dlg, "Cancel")).to_be_focused()
        tab_to(page, button(dlg, "Confirm"))
        page.keyboard.press("Enter")
        announced(page, F_ATTR_OK)
        expect(opener).to_be_focused()
    assert desk.state()["specimens"]["A"]["attribution"]["note"] == note_text


def test_wf_attribution_conflict_reload_review(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "attribution")
    local_note = FAMILY * 2
    peer_note = FAMILY * 3
    with (
        desk_page(browser, desk, block_stream=True) as local,
        desk_page(browser, desk, "dealer_peer") as peer,
    ):
        note = by(work(local), "textbox", "Attribution note")
        fill(note, local_note)
        fill(by(work(peer), "textbox", "Attribution note"), peer_note)
        confirm(peer, "Review quarantine", "Quarantine attribution")
        announced(peer, F_ATTR_OK)
        confirm(local, "Review quarantine", "Quarantine attribution")
        expect(alert(local)).to_contain_text(F_CONFLICT)
        latest = desk.state()["specimens"]["A"]["version"]
        sent = sniff(local, "/quarantine")
        button(local, "Reload current").click()
        expect(by(work(local), "textbox", "Attribution note")).to_have_value(
            local_note
        )
        st = desk.state()
        assert st["specimens"]["A"]["attribution"]["note"] == peer_note
        assert len(events(st, "specimen.quarantined")) == 1
        confirm(local, "Review quarantine", "Quarantine attribution")
        announced(local, F_ATTR_OK)
        assert sent[-1]["expected_version"] == latest
    st = desk.state()
    assert st["specimens"]["A"]["attribution"]["note"] == local_note
    assert len(events(st, "specimen.quarantined")) == 2


def test_wf_catalog_reconciliation_touch_reverse_divider(
    browser: Browser, app_url: str, wiremock: Any
) -> None:
    desk = seed(app_url, "catalog_reconciliation")
    ref = fresh_ref(desk, "H")
    stub_record(wiremock, ref)
    with desk_page(browser, desk, viewport=TABLET, touch=True) as page:
        correction = by(page, "textbox", "Attribution correction")
        fill(correction, ref)
        divider = by(page, "slider", "Reference divider")
        divider.focus()
        page.keyboard.press("Home")
        start = slider_now(divider)
        x, y = center(divider)
        box = divider.bounding_box()
        assert box is not None
        distance = box["width"] / 4
        touch_path(page, line((x, y), (x + distance, y)))
        eventually(
            lambda: slider_now(divider) > start,
            "Reference divider must follow a forward touch drag "
            "(instruction.md:258)",
        )
        forward = slider_now(divider)
        x, y = center(divider)
        touch_path(page, line((x, y), (x - distance, y)))
        eventually(
            lambda: slider_now(divider) < forward,
            "Reference divider must follow a reverse touch drag "
            "(instruction.md:258)",
        )
        kept_text = divider.get_attribute("aria-valuetext")
        page.reload()
        record(page)
        expect(by(page, "slider", "Reference divider")).to_have_attribute(
            "aria-valuetext", kept_text
        )
        expect(by(page, "textbox", "Attribution correction")).to_have_value(ref)
        confirm(page, "Review reconciliation", "Save reconciliation")
        announced(page, F_CATALOG_OK, LONG_MS)
        expect(by(page, "slider", "Reference divider")).to_have_attribute(
            "aria-valuetext", kept_text
        )
    att = desk.state()["specimens"]["A"]["attribution"]
    assert att["register"] == "stored" and att["correction"] == ref
    assert S3().get(f"catalog/{desk.ns}/{ref}/r1.svg") == REGISTER_SVG.encode()


def test_wf_catalog_reconciliation_announcements_fault_retry(
    browser: Browser, app_url: str, wiremock: Any
) -> None:
    for tag, refusal in (("T", F_CATALOG_WAIT), ("J", F_CATALOG_BAD)):
        desk = seed(app_url, "catalog_reconciliation")
        ref = fresh_ref(desk, tag)
        if tag == "T":
            stub_record(
                wiremock,
                ref,
                delay_ms=PROVIDER_TIMEOUT_MS + TIMEOUT_OVERSHOOT_MS,
            )
        else:
            wiremock.stub(
                "GET",
                "/catalog/varieties",
                query={"reference": ref},
                body="<<not json>>",
                headers=JSON_HEADERS,
            )
        with desk_page(browser, desk) as page:
            w = work(page)
            sent = sniff(page, "/reconcile")
            divider = by(w, "slider", "Reference divider")
            divider.focus()
            page.keyboard.press("Home")
            page.keyboard.press("PageUp")
            page.keyboard.press("PageUp")
            kept_text = divider.get_attribute("aria-valuetext")
            fill(by(w, "textbox", "Attribution correction"), ref)
            confirm(page, "Review reconciliation", "Save reconciliation")
            expect(alert(page)).to_contain_text(refusal, timeout=LONG_MS)
            expect(by(w, "textbox", "Attribution correction")).to_have_value(ref)
            expect(divider).to_have_attribute("aria-valuetext", kept_text)
            assert not any(F_CATALOG_OK in t for t in announcements(page))
            stub_record(wiremock, ref)
            record(page)
            retry = button(page, "Retry catalog")
            with held(page, "**/specimens/A/reconcile") as gate:
                retry.click()
                expect(status(page)).to_contain_text(F_PENDING)
                expect(retry).to_be_disabled()
                att = desk.state()["specimens"]["A"]["attribution"]
                assert att["register"] == "pending"
                assert att["correction"] == ref
                assert not any(F_CATALOG_OK in t for t in announcements(page))
                gate.release()
            announced(page, F_CATALOG_OK, LONG_MS)
            order_announced(page, F_PENDING, F_CATALOG_OK)
            expect(divider).to_have_attribute("aria-valuetext", kept_text)
        assert len(sent) == 2
        assert sent[0]["command_id"] == sent[1]["command_id"]
        st = desk.state()
        assert st["specimens"]["A"]["attribution"]["correction"] == ref
        assert st["specimens"]["A"]["attribution"]["register"] == "stored"
        assert len(events(st, "specimen.reconciled")) == 1
        assert S3().get(
            f"catalog/{desk.ns}/{ref}/r1.svg"
        ) == REGISTER_SVG.encode()


def test_wf_tray_placement_keyboard_dialog_return(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "tray_placement")
    with desk_page(browser, desk) as page:
        w = work(page)
        keyboard_move(page, w, "Holder A", button(w, "Cell B2"))
        opener = button(w, "Review placement")
        tab_to(page, opener)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Place holder")
        expect(dlg).to_be_visible()
        expect(button(dlg, "Cancel")).to_be_focused()
        trapped(page, dlg)
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Place holder")
        expect(dlg).to_be_visible()
        tab_to(page, button(dlg, "Confirm"))
        page.keyboard.press("Enter")
        announced(page, F_TRAY_OK)
        expect(opener).to_be_focused()
    assert cell_specimen(desk.state(), "B2") == "A"


def test_wf_tray_placement_announcements_conflict_recovery(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "tray_placement")
    with (
        desk_page(browser, desk, block_stream=True) as local,
        desk_page(browser, desk, "dealer_peer") as peer,
    ):
        wl, wp = work(local), work(peer)
        button(wl, "Holder A").click()
        button(wl, "Cell A1").click()
        button(wp, "Holder B").click()
        button(wp, "Cell A1").click()
        confirm(peer, "Review placement", "Place holder")
        announced(peer, F_TRAY_OK)
        confirm(local, "Review placement", "Place holder")
        expect(alert(local)).to_have_text(
            re.compile(
                f"{re.escape(F_CONFLICT)}|{re.escape(F_TRAY_TAKEN)}"
            )
        )
        if F_CONFLICT in alert(local).inner_text():
            button(local, "Reload current").click()
        else:
            local.reload()
            record(local)
        wl = work(local)
        button(wl, "Holder A").click()
        button(wl, "Cell B1").click()
        dlg = open_review(local, "Review placement", "Place holder")
        record(local)
        with held(local, "**/tray/placements") as gate:
            button(dlg, "Confirm").click()
            expect(status(local)).to_contain_text(F_PENDING)
            eventually(lambda: dlg.count() == 0 or button(dlg, "Confirm").is_disabled(), "a pending Confirm cannot be sent twice (L137, L369)")
            assert cell_specimen(desk.state(), "B1") is None
            assert not any(F_TRAY_OK in t for t in announcements(local))
            gate.release()
        announced(local, F_TRAY_OK)
        order_announced(local, F_PENDING, F_TRAY_OK)
    st = desk.state()
    assert cell_specimen(st, "A1") == "B"
    assert cell_specimen(st, "A2") is None
    assert cell_specimen(st, "B1") == "A"
    assert len(events(st, "tray.placed")) == 2


def test_wf_set_tracking_keyboard_dialog_commit(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "set_tracking")
    with desk_page(browser, desk) as page:
        w = work(page)
        keyboard_move(page, w, "Specimen A", button(w, "Hole Mint A"))
        opener = button(w, "Review album placement")
        tab_to(page, opener)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Fill album hole")
        expect(dlg).to_be_visible()
        expect(button(dlg, "Cancel")).to_be_focused()
        trapped(page, dlg)
        tab_to(page, button(dlg, "Confirm"))
        page.keyboard.press("Enter")
        announced(page, F_SET_OK)
        expect(opener).to_be_focused()
    st = desk.state()
    assert hole_specimen(st, "Mint A") == "A"
    assert len(events(st, "album.filled")) == 1


def test_wf_set_tracking_touch_exclusion_recovery(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "set_tracking")
    version = desk.state()["versions"]["album"]
    with desk_page(browser, desk, viewport=PHONE, touch=True) as page:
        for source, hole, refusal in (
            ("Specimen U", "Hole Mint K", F_SET_UNCERTAIN),
            ("Specimen O", "Hole Mint O", F_SET_OUTBOUND),
        ):
            button(page, source).tap()
            button(page, hole).tap()
            attempt(
                page,
                "Review album placement",
                "Fill album hole",
                alert(page).filter(has_text=refusal),
            )
            expect(alert(page)).to_contain_text(refusal)
        st = desk.state()
        assert st["versions"]["album"] == version
        assert events(st, "album.filled") == []
        button(page, "Specimen A").tap()
        button(page, "Hole Mint A").tap()
        button(page, "Review album placement").tap()
        dlg = dialog(page, "Fill album hole")
        expect(dlg).to_be_visible()
        button(dlg, "Confirm").tap()
        announced(page, F_SET_OK)
    st = desk.state()
    assert hole_specimen(st, "Mint A") == "A"
    assert hole_specimen(st, "Mint K") is None
    assert hole_specimen(st, "Mint O") is None
    assert len(events(st, "album.filled")) == 1


def test_wf_condition_comparison_touch_wipe_reload(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "condition_comparison")
    before = desk.state()["specimens"]["A"]["annotations"]
    with desk_page(browser, desk, touch=True) as page:
        w = work(page)
        divider = by(w, "slider", "Condition wipe")
        divider.focus()
        page.keyboard.press("Home")
        for _ in range(5):
            page.keyboard.press("PageUp")
        initial = slider_now(divider)

        image = by(w, "img", "Specimen A arrival").first
        box = image.bounding_box()
        assert box
        x, y = center(divider)
        touch_path(page, line((x, y), (x + box["width"] / 4, y)))
        assert slider_now(divider) > initial

        x, y = center(divider)
        high = slider_now(divider)
        touch_path(page, line((x, y), (x - box["width"] / 4, y)))
        assert slider_now(divider) < high
        saved_position = divider.get_attribute("aria-valuetext")
        assert saved_position is not None

        page.reload()
        expect(by(work(page), "slider", "Condition wipe")).to_have_attribute(
            "aria-valuetext", saved_position
        )

    assert desk.state()["specimens"]["A"]["annotations"] == before


def test_wf_condition_comparison_pending_confirm(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "condition_comparison")
    note = "Held condition draft"
    before = desk.state()["specimens"]["A"]["annotations"]
    with desk_page(browser, desk) as page:
        w = work(page)
        _condition_reveal_arrival(w, page)
        button(w, "Condition marker").click()
        set_coords(w, FEATURE_X, FEATURE_Y)
        fill(by(w, "textbox", "Condition note"), note)
        dlg = open_review(page, "Review condition note", "Save condition note")
        with held(page, "**/specimens/A/annotations") as gate:
            button(dlg, "Confirm").click()
            expect(status(page)).to_contain_text(F_PENDING)
            expect(button(dlg, "Confirm")).to_be_disabled()
            expect(by(w, "textbox", "Condition note")).to_be_visible()
            expect(by(w, "textbox", "Condition note")).to_have_value(note)
            assert desk.state()["specimens"]["A"]["annotations"] == before
            assert F_CONDITION_OK not in announcements(page)
            gate.release()
        announced(page, F_CONDITION_OK)

    assert any(
        n["text"] == note
        for n in desk.state()["specimens"]["A"]["annotations"]
    )


def test_wf_duplicate_selection_keyboard_reorder_reload(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "duplicate_selection")
    before = desk.state()["keeper_order"]
    with desk_page(browser, desk) as page:
        lst = by(work(page), "list", "Keeper preference")
        c = button(lst, "Specimen C")
        c.focus()
        for key in ("Space", "ArrowUp", "Enter"):
            page.keyboard.press(key)
        expect(c).to_be_focused()
        staged = visual_order(lst, "Specimen ", "ABC")
        assert staged == ["A", "C", "B"]

        page.reload()
        lst = by(work(page), "list", "Keeper preference")
        eventually(
            lambda: visual_order(lst, "Specimen ", "ABC") == staged,
            "staged keeper order survives reload (instruction.md:295)",
        )
        assert desk.state()["keeper_order"] == before
        confirm(page, "Review keeper order", "Save keeper order")
        announced(page, F_KEEPER_OK)

    assert desk.state()["keeper_order"] == staged


def test_wf_duplicate_selection_keyboard_dialog_escape(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "duplicate_selection")
    before = desk.state()["keeper_order"]
    with desk_page(browser, desk) as page:
        lst = by(work(page), "list", "Keeper preference")
        button(lst, "Specimen C").focus()
        for key in ("Space", "ArrowUp", "Enter"):
            page.keyboard.press(key)
        staged = visual_order(lst, "Specimen ", "ABC")

        opener = button(page, "Review keeper order")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dlg = dialog(page, "Save keeper order")
        expect(button(dlg, "Cancel")).to_be_focused()
        trapped(page, dlg)
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(opener).to_be_focused()
        assert visual_order(lst, "Specimen ", "ABC") == staged
        assert desk.state()["keeper_order"] == before

        page.keyboard.press("Enter")
        dlg = dialog(page, "Save keeper order")
        tab_to(page, button(dlg, "Confirm"))
        page.keyboard.press("Enter")
        announced(page, F_KEEPER_OK)

    assert desk.state()["keeper_order"] == staged


def test_wf_duplicate_selection_pending_confirm(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "duplicate_selection")
    before = desk.state()["keeper_order"]
    with desk_page(browser, desk) as page:
        lst = by(work(page), "list", "Keeper preference")
        button(lst, "Specimen C").focus()
        for key in ("Space", "ArrowUp", "Enter"):
            page.keyboard.press(key)
        staged = visual_order(lst, "Specimen ", "ABC")
        dlg = open_review(page, "Review keeper order", "Save keeper order")

        with held(page, "**/keeper-order") as gate:
            button(dlg, "Confirm").click()
            expect(status(page)).to_contain_text(F_PENDING)
            expect(button(dlg, "Confirm")).to_be_disabled()
            expect(lst).to_be_visible()
            assert visual_order(lst, "Specimen ", "ABC") == staged
            assert desk.state()["keeper_order"] == before
            assert F_KEEPER_OK not in announcements(page)
            gate.release()
        announced(page, F_KEEPER_OK)

    assert desk.state()["keeper_order"] == staged


def test_wf_offer_assembly_touch_drag_cancel(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "offer_assembly")
    before = desk.state()
    with desk_page(browser, desk, touch=True) as page:
        w = work(page)
        for chip, name in (("Specimen A", "Dealer basket"), ("Specimen X", "Counterpart basket")):
            basket = by(w, "region", name)
            shown = basket.inner_html()
            touch_drag(page, button(w, chip), basket)
            eventually(lambda basket=basket, shown=shown: basket.inner_html() != shown, f"dropping {chip} stages it in {name} (L231)")
        button(page, "Review offer").tap()
        dlg = dialog(page, "Send reciprocal offer")
        summary_names(dlg, "A", "X")
        summary = dlg.inner_text()
        button(dlg, "Cancel").tap()
        expect(dlg).to_have_count(0)

        button(page, "Review offer").tap()
        expect(dlg).to_be_visible()
        assert dlg.inner_text() == summary
        button(dlg, "Cancel").tap()

    after = desk.state()
    assert after["offers"] == before["offers"]
    for key in ("A", "X"):
        assert after["specimens"][key]["status"] == before["specimens"][key]["status"]


def test_wf_offer_assembly_keyboard_pickup_escape(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "offer_assembly")
    before = desk.state()["offers"]
    with desk_page(browser, desk) as page:
        w = work(page)
        dealer_b = by(w, "region", "Dealer basket")
        counterpart_b = by(w, "region", "Counterpart basket")
        keyboard_move(page, w, "Specimen A", dealer_b)
        keyboard_move(page, w, "Specimen X", counterpart_b)
        staged_dealer = dealer_b.inner_text()
        staged_counterpart = counterpart_b.inner_text()

        source = button(w, "Specimen B")
        tab_to(page, source)
        page.keyboard.press("Space")
        expect(by(w, "button", "Specimen B")).to_have_attribute(
            "aria-pressed", "true"
        )
        page.keyboard.press("Escape")
        expect(source).to_be_focused()
        assert dealer_b.inner_text() == staged_dealer
        assert counterpart_b.inner_text() == staged_counterpart

        opener = button(page, "Review offer")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dlg = dialog(page, "Send reciprocal offer")
        summary_names(dlg, "A", "X")
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()

    assert desk.state()["offers"] == before


def test_wf_counteroffers_touch_replacement_cancel(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "counteroffers")
    before = desk.state()["offers"]["offer-1"]
    with desk_page(browser, desk, touch=True) as page:
        w = work(page)
        button(w, "Specimen B").tap()
        button(w, "Specimen A").tap()
        button(page, "Review replacement").tap()
        dlg = dialog(page, "Replace offered specimen")
        expect(dlg).to_contain_text("Specimen B")
        summary = dlg.inner_text()
        button(dlg, "Cancel").tap()
        expect(dlg).to_have_count(0)
        assert desk.state()["offers"]["offer-1"] == before

        button(page, "Review replacement").tap()
        expect(dlg).to_be_visible()
        assert dlg.inner_text() == summary
        button(dlg, "Cancel").tap()

    assert desk.state()["offers"]["offer-1"] == before


def test_wf_counteroffers_keyboard_accept_dialog_escape(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "counteroffers")
    with desk_page(browser, desk) as page:
        w = work(page)
        keyboard_move(page, w, "Specimen B", button(w, "Specimen A"))
        confirm(page, "Review replacement", "Replace offered specimen")
        announced(page, F_COUNTER_VOID)
        before = desk.state()["offers"]["offer-1"]

        opener = button(page, "Accept current offer")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dlg = dialog(page, "Accept offer version")
        expect(button(dlg, "Cancel")).to_be_focused()
        trapped(page, dlg)
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(opener).to_be_focused()

    assert desk.state()["offers"]["offer-1"] == before


def test_wf_counteroffers_pending_confirm(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "counteroffers")
    before = desk.state()["offers"]["offer-1"]
    with desk_page(browser, desk) as page:
        w = work(page)
        keyboard_move(page, w, "Specimen B", button(w, "Specimen A"))
        dlg = open_review(
            page, "Review replacement", "Replace offered specimen"
        )
        with held(page, "**/offers/offer-1/replace") as gate:
            button(dlg, "Confirm").click()
            expect(status(page)).to_contain_text(F_PENDING)
            expect(button(dlg, "Confirm")).to_be_disabled()
            expect(dlg).to_contain_text("Specimen B")
            assert desk.state()["offers"]["offer-1"] == before
            assert F_COUNTER_VOID not in announcements(page)
            gate.release()
        announced(page, F_COUNTER_VOID)

    after = desk.state()["offers"]["offer-1"]
    assert after["version"] == before["version"] + 1
    assert after["dealer_items"] == ["B"]
    assert after["acceptances"] == {"dealer": None, "counterpart": None}


def test_wf_dispatch_touch_reorder_cancel(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "dispatch")
    before = desk.state()["manifests"]["offer-1/dealer"]
    with desk_page(browser, desk, touch=True) as page:
        manifest = by(work(page), "list", "Packing manifest")
        source = button(manifest, "Manifest item C")
        target = button(manifest, "Manifest item A")
        source.scroll_into_view_if_needed()
        box = target.bounding_box()
        assert box
        touch_path(
            page,
            line(center(source), (box["x"] + box["width"] / 2, box["y"] + 2)),
        )
        staged = visual_order(manifest, "Manifest item ", "ABC")
        assert staged == ["C", "A", "B"]
        button(page, "Review dispatch").tap()
        dlg = dialog(page, "Freeze dispatch evidence")
        button(dlg, "Cancel").tap()
        expect(dlg).to_have_count(0)
        assert visual_order(manifest, "Manifest item ", "ABC") == staged

    assert desk.state()["manifests"]["offer-1/dealer"] == before


def test_wf_dispatch_keyboard_reorder_reload(
    browser: Browser, app_url: str
) -> None:
    desk = seed(app_url, "dispatch")
    before = desk.state()["manifests"]["offer-1/dealer"]
    with desk_page(browser, desk) as page:
        manifest = by(work(page), "list", "Packing manifest")
        a = button(manifest, "Manifest item A")
        a.focus()
        for key in ("Space", "ArrowDown", "Enter"):
            page.keyboard.press(key)
        expect(a).to_be_focused()
        staged = visual_order(manifest, "Manifest item ", "ABC")
        assert staged == ["B", "A", "C"]

        page.reload()
        manifest = by(work(page), "list", "Packing manifest")
        eventually(
            lambda: visual_order(manifest, "Manifest item ", "ABC") == staged,
            "packing draft survives reload (instruction.md:295)",
        )
        assert desk.state()["manifests"]["offer-1/dealer"] == before
        dlg = open_review(page, "Review dispatch", "Freeze dispatch evidence")
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(button(page, "Review dispatch")).to_be_focused()
        assert visual_order(manifest, "Manifest item ", "ABC") == staged

    assert desk.state()["manifests"]["offer-1/dealer"] == before

def _receipt_fresh_step_up(page: Page, desk: Desk, role: str) -> None:
    target = urlparse(page.url)
    return_to = target.path + ("?" + target.query if target.query else "")
    page.goto(f"{desk.base}/auth/step-up?return_to={quote(return_to, safe='')}")
    keycloak_code(page, desk, role)
    record(page)


def test_wf_receipt_phone_sheet_layouts_keyboard_escape(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "receipt")
    before = desk.state()["receipts"]
    for size in (PHONE, PHONE_PROBE):
        with desk_page(browser, desk, viewport=size) as page:
            tick = by(work(page), "checkbox", "Manifest matches")
            tab_to(page, tick)
            if not tick.is_checked():
                page.keyboard.press("Space")
            opener = button(page, "Review receipt")
            tab_to(page, opener)
            page.keyboard.press("Enter")
            sheet = dialog(page, "Record receipt")
            expect(button(sheet, "Cancel")).to_be_focused()
            bottom_sheet(page, sheet)
            trapped(page, sheet)
            page.keyboard.press("Escape")
            expect(opener).to_be_focused()
            expect(tick).to_be_checked()
            expect(sheet).to_have_count(0)
            names = tab_order(page, TAB_SWEEP)
            assert "Confirm" not in names and "Cancel" not in names
    assert desk.state()["receipts"] == before


def test_wf_receipt_announcements_pending_mismatch(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "receipt")
    mismatch = "Receipt saved. It does not match the manifest, so transfer is held."
    with desk_page(browser, desk, "counterpart") as cp:
        record_receipt(cp, desk, "counterpart", F_RECEIPT_WAIT)
    with desk_page(browser, desk) as page:
        _receipt_fresh_step_up(page, desk, "dealer")
        by(work(page), "checkbox", "Manifest matches").uncheck()
        with held(page, f"**/api/desks/{desk.ns}/offers/offer-1/receipts") as gate:
            sheet = confirm(page, "Review receipt", "Record receipt")
            expect(status(page)).to_have_text(F_PENDING)
            expect(button(sheet, "Confirm")).to_be_disabled()
            assert not any(mismatch in text for text in announcements(page))
            assert not (desk.state()["receipts"].get("offer-1/dealer") or {}).get("confirmed")
            gate.release()
        announced(page, mismatch, LONG_MS)
        order_announced(page, F_PENDING, mismatch)
    st = desk.state()
    assert st["receipts"]["offer-1/dealer"] == {"confirmed": True, "matches": False}
    assert st["receipts"]["offer-1/counterpart"] == {"confirmed": True, "matches": True}
    assert st["offers"]["offer-1"]["status"] == "received"
    assert st["specimens"]["A"]["owner"] == "dealer"
    assert st["specimens"]["X"]["owner"] == "counterpart"
    assert events(st, "ownership.transferred") == []


def test_wf_disputes_touch_drag_draft(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "disputes")
    note_text = "fresh gouge"
    with desk_page(browser, desk, "counterpart", viewport=PHONE, touch=True) as page:
        marker = button(work(page), "Damage marker")
        marker.tap()
        set_coords(work(page), FEATURE_X, FEATURE_Y)
        fill(by(work(page), "textbox", "Damage note"), note_text)
        touch_drag(page, marker, by(work(page), "img", "Specimen A arrival").first)
        eventually(
            lambda: (spin_value(by(work(page), "spinbutton", "Image x")),
                     spin_value(by(work(page), "spinbutton", "Image y"))) != (FEATURE_X, FEATURE_Y),
            "Touch dragging changes original-image coordinates (instruction.md:264).",
        )
        x = spin_value(by(work(page), "spinbutton", "Image x"))
        y = spin_value(by(work(page), "spinbutton", "Image y"))
        page.reload()
        record(page)
        button(work(page), "Damage marker").focus()
        expect(by(work(page), "textbox", "Damage note")).to_have_value(note_text)
        eventually(
            lambda: (spin_value(by(work(page), "spinbutton", "Image x")),
                     spin_value(by(work(page), "spinbutton", "Image y"))) == (x, y),
            "The dragged marker draft survives reload (instruction.md:295).",
        )
        confirm(page, "Review dispute", "Hold ownership transfer")
        announced(page, F_DISPUTE_OPEN, LONG_MS)
    (_, dispute), = desk.state()["disputes"].items()
    assert [(m["x"], m["y"]) for m in dispute["markers"]] == [(x, y)]


def test_wf_disputes_keyboard_dialog_escape(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "disputes")
    note_text = "fresh gouge"
    with desk_page(browser, desk, "counterpart") as page:
        button(work(page), "Damage marker").click()
        set_coords(work(page), FEATURE_X, FEATURE_Y)
        fill(by(work(page), "textbox", "Damage note"), note_text)
        opener = button(page, "Review dispute")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        review = dialog(page, "Hold ownership transfer")
        expect(button(review, "Cancel")).to_be_focused()
        trapped(page, review)
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        expect(review).to_have_count(0)
        expect(by(work(page), "textbox", "Damage note")).to_have_value(note_text)
        assert spin_value(by(work(page), "spinbutton", "Image x")) == FEATURE_X
        assert spin_value(by(work(page), "spinbutton", "Image y")) == FEATURE_Y
    st = desk.state()
    assert st["disputes"] == {}
    assert events(st, "dispute.opened") == []


def test_wf_disputes_announcements_pending_return(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "disputes")
    s3 = S3()
    with desk_page(browser, desk, "counterpart") as cp, desk_page(browser, desk) as dl:
        open_dispute(cp)
        before = desk.state()
        (did, _), = before["disputes"].items()
        evidence = {
            e["object_key"]: s3.get(e["object_key"])
            for manifest in before["manifests"].values()
            for e in manifest["evidence"]
        }
        record(dl)
        cp.evaluate(NO_RELOAD_JS)
        with held(dl, f"**/api/desks/{desk.ns}/disputes/{did}/resolution") as gate:
            review = open_review(dl, "Propose resolution", "Resolve transfer hold")
            by(review, "radio", "Return both baskets").check()
            button(review, "Confirm").click()
            expect(status(dl)).to_have_text(F_PENDING)
            expect(button(review, "Confirm")).to_be_disabled()
            assert desk.state()["disputes"][did]["resolution"] is None
            assert not any(F_RESOLUTION_WAIT in text for text in announcements(dl))
            gate.release()
        announced(dl, F_RESOLUTION_WAIT, LONG_MS)
        order_announced(dl, F_PENDING, F_RESOLUTION_WAIT)
        announced(cp, F_RESOLUTION_WAIT, LIVE_MS + LIVE_SLACK_MS)
        assert desk.state()["disputes"][did]["resolution"] == {
            "outcome": "return", "proposed_by": "dealer",
        }
        button(work(cp), "Approve resolution").click()
        review = dialog(cp, "Resolve transfer hold")
        done = status(cp).filter(has_text=F_RESOLUTION_DONE)
        expect(done.or_(review).first).to_be_visible(timeout=LONG_MS)
        if review.count() and review.is_visible():
            button(review, "Confirm").click()
        announced(cp, F_RESOLUTION_DONE, LONG_MS)
        announced(dl, F_RESOLUTION_DONE, LIVE_MS + LIVE_SLACK_MS)
        assert not_reloaded(cp)
    st = desk.state()
    assert st["offers"]["offer-1"]["status"] == "returned"
    assert st["specimens"]["A"]["owner"] == "dealer"
    assert st["specimens"]["X"]["owner"] == "counterpart"
    for key in ("A", "X"):
        assert st["specimens"][key]["status"] not in ("reserved", "outbound")
    assert {
        e["object_key"] for manifest in st["manifests"].values()
        for e in manifest["evidence"]
    } == set(evidence)
    for key, payload in evidence.items():
        assert s3.get(key) == payload


def test_wf_stock_audit_keyboard_dialog_escape(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "stock_audit")
    with desk_page(browser, desk) as page:
        tray = by(work(page), "group", "Audit tray")
        tab_to(page, tray)
        target = tray.get_by_role("button", name="Cell A2", exact=True, pressed=True)
        for key in ["ArrowLeft"] * TAB_LIMIT + ["ArrowRight"] * TAB_LIMIT:
            if target.count():
                break
            page.keyboard.press(key)
        expect(target).to_be_visible()
        opener = button(page, "Mark missing")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        review = dialog(page, "Record missing item")
        expect(button(review, "Cancel")).to_be_focused()
        trapped(page, review)
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        expect(review).to_have_count(0)
        expect(tray.get_by_role("button", name="Cell A2", exact=True, pressed=True)).to_be_visible()
    st = desk.state()
    assert st["audit_events"] == []
    assert st["tray"]["A2"]["audit_version"] == 0
    assert st["specimens"]["B"]["missing"] is False


def test_wf_stock_audit_announcements_pending_offline_chain(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "stock_audit")
    batches: list[dict[str, Any]] = []
    with desk_page(browser, desk) as page:
        page.on("request", lambda request: batches.append(request.post_data_json)
                if request.method == "POST" and urlparse(request.url).path == desk.desk_path("/audit/sync")
                else None)
        button(by(work(page), "group", "Audit tray"), "Cell A1").click()
        page.context.set_offline(True)
        for _ in range(2):
            confirm(page, "Mark missing", "Record missing item")
            expect(status(page)).to_have_text(F_OFFLINE)
        record(page)
        with held(page, f"**/api/desks/{desk.ns}/audit/sync") as gate:
            page.context.set_offline(False)
            expect(status(page)).to_have_text(F_PENDING, timeout=LONG_MS)
            assert desk.state()["tray"]["A1"]["audit_version"] == 0
            assert not any(F_SYNCED in text for text in announcements(page))
            gate.release()
        announced(page, F_SYNCED, LONG_MS)
        order_announced(page, F_PENDING, F_SYNCED)
    sent = [
        command for batch in batches for command in batch["commands"]
        if command["cell"] == "A1"
    ]
    unique = list({command["command_id"]: command for command in sent}.values())
    assert [command["expected_version"] for command in unique] == [0, 1]
    st = desk.state()
    marks = st["audit_events"]
    assert [mark["cell"] for mark in marks] == ["A1", "A1"]
    assert [mark["actor"] for mark in marks] == ["dealer", "dealer"]
    assert [mark["command_id"] for mark in marks] == [command["command_id"] for command in unique]
    assert marks[0]["sequence"] < marks[1]["sequence"]
    assert st["tray"]["A1"]["audit_version"] == 2


def test_wf_cross_cutting_phone_sheet_layouts_targets(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "cross-cutting")
    note_text = "fresh gouge"
    before = desk.state()["specimens"]["A"]["annotations"]
    for size in (PHONE_PROBE, PHONE):
        with desk_page(browser, desk, url=f"{desk.base}/desk/{desk.ns}", viewport=size, touch=True) as page:
            button(page, "Open desk tools").tap()
            tools = dialog(page, "Desk tools")
            by(by(tools, "navigation", "Workspaces"), "link", "Condition").tap()
            expect(by(page, "region", "Condition comparison workspace")).to_be_visible()
            if tools.count():
                button(tools, "Close desk tools").tap()
            expect(tools).to_have_count(0)
            _condition_reveal_arrival(page, page)
            button(page, "Condition marker").tap()
            set_coords(page, FEATURE_X, FEATURE_Y)
            note = by(page, "textbox", "Condition note")
            fill(note, note_text)
            button(page, "Review condition note").tap()
            review = dialog(page, "Save condition note")
            expect(review).to_be_visible()
            bottom_sheet(page, review)
            big_enough(button(review, "Cancel"))
            big_enough(button(review, "Confirm"))
            button(review, "Cancel").tap()
            expect(review).to_have_count(0)
            names = tab_order(page, TAB_SWEEP)
            assert "Confirm" not in names and "Cancel" not in names
            page.reload()
            record(page)
            expect(by(page, "textbox", "Condition note")).to_have_value(note_text)
    assert desk.state()["specimens"]["A"]["annotations"] == before


def test_wf_cross_cutting_announcements_session_open_review(browser: Browser, app_url: str) -> None:
    desk = seed(app_url, "cross-cutting")
    before = desk.state()["offers"]["offer-1"]
    with desk_page(browser, desk, "counterpart") as cp:
        by(by(cp, "navigation", "Workspaces"), "link", "Counteroffers").click()
        expect(by(cp, "region", "Counteroffer workspace")).to_be_visible()
        review = open_review(cp, "Accept current offer", "Accept offer version")
        desk.identity("password_change")
        expect(alert(cp)).to_have_text(F_REVOKED, timeout=LIVE_MS + LIVE_SLACK_MS)
        expect(review).to_have_count(0, timeout=LIVE_MS + LIVE_SLACK_MS)
        expect(by(cp, "main", "Specimen desk")).to_be_focused()
    response = desk.command(
        "POST", "/offers/offer-1/accept",
        {"expected_version": before["version"]}, role="counterpart",
    )
    assert_error(response, 401, "authentication_required", F_SESSION)
    after = desk.state()["offers"]["offer-1"]
    assert after["acceptances"] == before["acceptances"]
    assert after["version"] == before["version"]
