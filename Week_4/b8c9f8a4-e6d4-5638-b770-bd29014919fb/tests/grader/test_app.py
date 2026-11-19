from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import shlex
import signal
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import expect

from conftest import *
from datetime import datetime, timedelta

PASSPHRASE = "bonnet-up-at-dawn"
SEED_CAR = "1998 Calder Merrow GT"
SEED_DRAFT = "1999 Calder Tern 1.8"
ROWAN = "seed-buyer-rowan-7f3c9a1e"
DEV = "seed-buyer-dev-91ae57f3"
IMOGEN = "seed-buyer-imogen-42d8b06c"
TAM = "seed-inspector-tam-2b81d4c6"
TOPIC = "open-bonnet-owner"
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
SHORT = {"width": 375, "height": 480}
VIEWPORTS = (PHONE, TABLET, DESKTOP)
BEAT = 720
POLL_MS = 15000
STANDING_MS = 2000
FILE_LIMIT = 8000000
JSON_LIMIT = 65536
CAPTURE_LIMIT = 262144
REQUEST_LIMIT = 8200000
TARGET = 44
DOCK_MAX = 72
HERO_PATCH = 31
LIT_PATCH = 15
MARKER_CLEAR = 20
TAP_RADIUS = 22
PIN_TOLERANCE = 3
ASKING = 15400
OFFER = 15400
SECOND_OFFER = 6200
SEED_ASKING = 16950
DRAFT_ASKING = 6200
LAPSE_SECONDS = 172800
LONG_EDGE = 1600
KM_READING = 107480.0
LONGEST_SLOT = 240
SHORTEST_SLOT = 15
TOO_SHORT_SLOT = SHORTEST_SLOT - 1
TOO_LONG_SLOT = LONGEST_SLOT + 1
MICRONS_OVER = "2001"
DOOR_MICRONS = 121
EVIL_HOST = "evil.example"
HOSTILE_RETURNS = ("/" * 2 + EVIL_HOST, f"https://{EVIL_HOST}/owner/cars", "/api/health")
CORS_HEADER = "access-control-allow-origin"
INVOICE_LABEL = "Respray bill"
NEWER_WORDING = "Newer wording"
THIRD_WORDING = "Third wording"
TYPED_WORDING = "Typed over the top"
AMENDED_WORDING = "Second wording for the sill"
FIRST_PHOTO = "one.jpg"
SECOND_PHOTO = "two.jpg"
SMALL_PHOTO = "small.jpg"
RESUMED_WORDING = "Typed before the session ended"
TAPPED_NOTE = "Tapped mark"
PART_WORDING = "Part typed wording"
HALF_NOTE = "Half typed note"
DEVICE_ZONE = "Asia/Tokyo"
MISSING_HOUR = "2027-03-28T01:30"
DOUBLE_HOUR = "2027-10-31T01:30"
AFTER_CHANGE = "2027-10-31T02:30"
PAST_START = "2020-01-01T10:00"
LABEL_FORMAT = "%a %d %b %Y, %H:%M"
ENTRANCE_MS = 1500
EXIT_MS = 400
LOST_CONTEXT_MS = 2000
IDLE_MS = 20000
HTTP_SECONDS = 60
WAIT_SECONDS = 25
QUICK_MS = 250
STEP_MS = 100
API_GAP = 0.25
API_WAIT = 70
REPLY_WAIT_MS = 20000
SLOT_A = "2031-05-10T10:30"
SLOT_B = "2031-05-17T10:30"
SLOT_C = "2031-05-24T10:30"
NOTE = "Checked and noted"
SERVE_PORTS = (4291, 4292)

FRAMES = {
    "bonnet": ((-0.75, 0.85, -2.00), (1.5, 0, 0), (0, 0.1, 1.2)),
    "os-front-wing": ((0.85, 0.45, -2.00), (0, 0, 1.0), (0, 0.4, 0)),
    "os-door": ((0.85, 0.40, -1.00), (0, 0, 1.2), (0, 0.5, 0)),
    "os-sill": ((0.85, 0.20, -1.00), (0, 0, 2.0), (0, 0.2, 0)),
    "os-rear-quarter": ((0.85, 0.40, 0.20), (0, 0, 1.8), (0, 0.5, 0)),
    "boot-lid": ((0.70, 0.90, 1.40), (-1.4, 0, 0), (0, -0.1, 0.6)),
    "rear-bumper": ((0.85, 0.30, 2.10), (-1.7, 0, 0), (0, 0.3, 0)),
    "ns-rear-quarter": ((-0.85, 0.40, 2.00), (0, 0, -1.8), (0, 0.5, 0)),
    "ns-sill": ((-0.85, 0.20, 1.00), (0, 0, -2.0), (0, 0.2, 0)),
    "ns-door": ((-0.85, 0.40, 0.20), (0, 0, -1.2), (0, 0.5, 0)),
    "ns-front-wing": ((-0.85, 0.45, -1.00), (0, 0, -1.0), (0, 0.4, 0)),
    "front-bumper": ((-0.85, 0.30, -2.10), (1.7, 0, 0), (0, 0.3, 0)),
    "roof": ((-0.60, 1.30, -0.50), (1.2, 0, 0), (0, 0, 1.4)),
}
DEFAULT_FINDINGS = (
    ("bonnet", 0.5, 0.12, "cosmetic"),
    ("os-sill", 0.72, 0.4, "serious"),
    ("roof", 0.5, 0.5, "moderate"),
)
LICENCES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0",
            "BlueOak-1.0.0", "OFL-1.1", "LGPL-3.0-or-later"}

LUM_JS = r"""async (el, a) => {
  const r = el.getBoundingClientRect();
  const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', {willReadFrequently: true});
  if (a.png) {
    const u = Uint8Array.from(atob(a.png), ch => ch.charCodeAt(0));
    x.drawImage(await createImageBitmap(new Blob([u], {type: 'image/png'})), 0, 0, W, H);
  } else { x.drawImage(el, 0, 0, W, H); }
  const d = x.getImageData(0, 0, W, H).data;
  const I = new Float64Array((W + 1) * (H + 1)); const hist = new Array(256).fill(0);
  for (let j = 0; j < H; j++) { let row = 0;
    for (let i = 0; i < W; i++) { const p = (j * W + i) * 4;
      const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
      hist[Math.min(255, Math.floor(l))]++; row += l;
      I[(j + 1) * (W + 1) + i + 1] = I[j * (W + 1) + i + 1] + row; } }
  const mean = (cx, cy, s) => {
    const x0 = Math.max(0, Math.round(cx - s / 2)), y0 = Math.max(0, Math.round(cy - s / 2));
    const x1 = Math.min(W, x0 + s), y1 = Math.min(H, y0 + s);
    if (x1 <= x0 || y1 <= y0) return 0;
    const t = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    return t / ((x1 - x0) * (y1 - y0)); };
  let seen = 0, median = 0;
  for (let b = 0; b < 256; b++) { seen += hist[b]; if (seen >= W * H / 2) { median = b; break; } }
  const out = {W, H, median, means: a.points.map(p => mean(p[0], p[1], p[2])), far: 0};
  if (a.far) { const [fx, fy, s, dist] = a.far; const half = Math.ceil(s / 2);
    for (let j = half; j < H - half; j += 6) for (let i = half; i < W - half; i += 6) {
      if (Math.hypot(i - fx, j - fy) > dist) out.far = Math.max(out.far, mean(i, j, s)); } }
  return out; }"""

WATCH_JS = """e => { if (e.__writes) return; e.__writes = [];
  new MutationObserver(() => { const t = (e.textContent || '').trim(); if (t) e.__writes.push(t); })
    .observe(e, {childList: true, characterData: true, subtree: true}); }"""

UNDERLINED_JS = """els => els.some(e => { const s = getComputedStyle(e);
  return s.textDecorationLine.includes('underline') || parseFloat(s.borderBottomWidth) > 0; })"""

INTRO_JS = r"""() => { const e = document.activeElement; const r = document.createRange(); r.selectNodeContents(e);
  const b = r.getBoundingClientRect();
  return {heading: /^H[1-6]$/.test(e.tagName) || e.getAttribute('role') === 'heading',
    centre: (b.left + b.right) / 2, width: document.documentElement.clientWidth,
    size: parseFloat(getComputedStyle(e).fontSize), body: parseFloat(getComputedStyle(document.body).fontSize),
    top: e.getBoundingClientRect().top + scrollY, text: e.textContent.trim().length}; }"""

PANEL_RECT_JS = """(e, id) => { const r = [...e.querySelectorAll('[data-panel-id]')].find(n => n.getAttribute('data-panel-id') === id);
  r.scrollIntoView({block: 'center', behavior: 'instant'}); const b = r.getBoundingClientRect();
  return {x: b.x, y: b.y, width: b.width, height: b.height}; }"""

PROBE_JS = r"""async (a) => {
  const u = Uint8Array.from(atob(a.data), ch => ch.charCodeAt(0));
  const b = await createImageBitmap(new Blob([u]));
  const c = document.createElement('canvas'); c.width = b.width; c.height = b.height;
  const x = c.getContext('2d'); x.drawImage(b, 0, 0);
  return {w: b.width, h: b.height, px: a.points.map(p => Array.from(
    x.getImageData(Math.floor(p[0] * b.width), Math.floor(p[1] * b.height), 1, 1).data).slice(0, 3))}; }"""

JPEG_JS = r"""async (a) => {
  const c = new OffscreenCanvas(a.w, a.h); const x = c.getContext('2d');
  x.fillStyle = 'rgb(40,160,60)'; x.fillRect(0, 0, a.w, a.h);
  x.fillStyle = 'rgb(230,20,20)'; x.fillRect(0, 0, a.w / 4, a.h / 4);
  const b = await c.convertToBlob({type: 'image/jpeg', quality: 0.9});
  const u = new Uint8Array(await b.arrayBuffer()); let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(s); }"""


def fresh(prefix: str = "Test") -> str:
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def fresh_reg() -> str:
    return "Q" + uuid.uuid4().hex[:6].upper()


def api_until(check, what: str, seconds: float = API_WAIT):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        threading.Event().wait(API_GAP)
    pytest.fail(f"expected within {seconds}s: {what}")


class Owner:

    def __init__(self, base: str):
        self.base = base
        self.http = httpx.Client(base_url=base, timeout=HTTP_SECONDS)
        reply = self.http.post("/api/owner/session", json={"passphrase": PASSPHRASE})
        assert reply.status_code == 200, reply.text

    def __getattr__(self, name):
        return getattr(self.http, name)

    @property
    def cookie(self) -> str:
        return self.http.cookies["ob_owner"]

    def new_car(self, reg="T317 HJN", name=None, asking=ASKING) -> dict:
        reply = self.http.post("/api/owner/cars", json={
            "name": name or fresh("Car"), "registration": reg, "askingPounds": asking,
            "viewingArea": "Near Hexham", "homeAddress": "7 Larkfield Close, Hexham NE46 9ZZ",
            "story": "A daily driver that never let anyone down."})
        assert reply.status_code == 201, reply.text
        return reply.json()

    def car(self, car_id: str) -> dict:
        return self.http.get(f"/api/owner/cars/{car_id}").json()

    def by_name(self, name: str) -> dict:
        return next(c for c in self.http.get("/api/owner/cars").json()["cars"] if c["name"] == name)

    def finding(self, car_id, panel, u=0.5, v=0.5, severity="moderate", title=None, wording=None, photo=None) -> dict:
        reply = self.http.post(f"/api/owner/cars/{car_id}/findings", json={
            "panelId": panel, "u": u, "v": v, "title": title or fresh("Mark"),
            "wording": wording or fresh("Wording"), "severity": severity, "photoId": photo})
        assert reply.status_code == 201, reply.text
        return reply.json()

    def findings(self, car_id) -> list:
        return self.http.get(f"/api/owner/cars/{car_id}/findings").json()["findings"]

    def pull(self, car_id) -> dict:
        reply = self.http.post(f"/api/owner/cars/{car_id}/record/pull")
        assert reply.status_code == 201, reply.text
        return reply.json()

    def answer(self, car_id, advisory_id, stance="monitoring"):
        return self.http.put(f"/api/owner/cars/{car_id}/advisories/{advisory_id}", json={"stance": stance, "note": NOTE})

    def answer_all(self, car_id):
        for item in self.http.get(f"/api/owner/cars/{car_id}/record").json()["advisories"]:
            if item["stance"] is None:
                assert self.answer(car_id, item["id"]).status_code == 200

    def publish(self, car_id) -> dict:
        reply = self.http.post(f"/api/owner/cars/{car_id}/publish")
        assert reply.status_code == 201, reply.text
        return reply.json()

    def draft(self, findings=DEFAULT_FINDINGS, reg="T317 HJN") -> dict:
        car = self.new_car(reg)
        for panel, u, v, severity in findings:
            self.finding(car["id"], panel, u, v, severity)
        return car

    def live(self, findings=DEFAULT_FINDINGS, reg="T317 HJN") -> dict:
        car = self.draft(findings, reg)
        self.pull(car["id"])
        self.answer_all(car["id"])
        self.publish(car["id"])
        return self.car(car["id"])

    def link(self, car_id, role="buyer", name=None) -> dict:
        reply = self.http.post(f"/api/owner/cars/{car_id}/links", json={"role": role, "name": name or fresh("Person")})
        assert reply.status_code == 201, reply.text
        return reply.json()

    def slot(self, car_id, local=SLOT_A, minutes=45) -> dict:
        reply = self.http.post(f"/api/owner/cars/{car_id}/slots", json={"localStart": local, "durationMinutes": minutes})
        assert reply.status_code == 201, reply.text
        return reply.json()

    def amend(self, car_id, finding, **change) -> dict:
        reply = self.http.patch(f"/api/owner/cars/{car_id}/findings/{finding['id']}", json=change,
                                headers={"If-Match": f'"{finding["revision"]}"'})
        assert reply.status_code == 200, reply.text
        return self.publish(car_id)

    def alerts(self, car_id) -> list:
        return [a for a in self.http.get("/api/owner/alerts").json()["alerts"] if a["carId"] == car_id]

    def offers(self, car_id) -> list:
        return self.http.get(f"/api/owner/cars/{car_id}/offers").json()["offers"]

    def links(self, car_id) -> list:
        return self.http.get(f"/api/owner/cars/{car_id}/links").json()["links"]

    def slots(self, car_id) -> list:
        return self.http.get(f"/api/owner/cars/{car_id}/slots").json()["slots"]

    def accept(self, offer_id, key=None):
        return self.http.post(f"/api/owner/offers/{offer_id}/accept",
                              headers={"Idempotency-Key": key or idempotency_key()})


def view(base, token) -> dict:
    reply = httpx.get(f"{base}/api/link/{token}", timeout=HTTP_SECONDS)
    assert reply.status_code == 200, reply.text
    return reply.json()


def see(base, token, finding_id):
    return post_json(base, f"/api/link/{token}/seen", {"findingId": finding_id})


def read_all(base, token):
    for item in view(base, token)["findings"]:
        assert see(base, token, item["id"]).status_code in (200, 201)


def send_offer(base, token, amount=OFFER, key=None):
    return post_json(base, f"/api/link/{token}/offers", {"amountPounds": amount}, key or idempotency_key())


def claim(base, token, slot_id, key=None):
    return post_json(base, f"/api/link/{token}/slots/{slot_id}/claim", {}, key or idempotency_key())


def offering_buyer(owner, car, name=None, amount=OFFER) -> tuple[dict, dict]:
    link = owner.link(car["id"], "buyer", name)
    read_all(owner.base, link["token"])
    reply = send_offer(owner.base, link["token"], amount)
    assert reply.status_code == 201, reply.text
    return link, reply.json()


def record_body(reg, tests) -> dict:
    return {"registration": reg, "make": "CALDER", "model": "FELL 2.0", "firstUsedDate": "1993-05-20", "motTests": tests}


def mot(number, date, advisories=(), value="98120", unit="MI", kind="READ") -> dict:
    return {"completedDate": date, "motTestNumber": number, "testResult": "PASSED", "expiryDate": "2026-05-13",
            "odometerValue": value, "odometerUnit": unit, "odometerResultType": kind,
            "defects": [{"text": t, "type": "ADVISORY", "dangerous": False} for t in advisories]}


def stub_record(wiremock, reg, tests):
    return wiremock.stub("GET", f"/v1/trade/vehicles/registration/{reg}", json=record_body(reg, tests))


def topic_count(ntfy, text) -> int:
    return sum(1 for m in ntfy.messages(TOPIC) if m.get("message") == text)


def naive_utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)


def world(panel, u, v):
    origin, axis_u, axis_v = FRAMES[panel]
    return tuple(origin[i] + u * axis_u[i] + v * axis_v[i] for i in range(3))


def project(attrs, point, box):
    m = [float(n) for n in attrs["data-view-projection"].split(",")]
    x, y, z = point
    cx = m[0] * x + m[4] * y + m[8] * z + m[12]
    cy = m[1] * x + m[5] * y + m[9] * z + m[13]
    cw = m[3] * x + m[7] * y + m[11] * z + m[15]
    return box["x"] + (cx / cw + 1) / 2 * box["width"], box["y"] + (1 - cy / cw) / 2 * box["height"], cw


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def png_bytes(width=64, height=48, size=None) -> bytes:
    head = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    rows = b"".join(b"\0" + os.urandom(width * 3) for _ in range(height))
    idat = png_chunk(b"IDAT", zlib.compress(rows, 0 if size else 6))
    tail = png_chunk(b"IEND", b"")
    if size:
        pad = size - len(head) - len(idat) - len(tail) - 12
        return head + png_chunk(b"ruSt", b"\0" * pad) + idat + tail
    return head + idat + tail


def near_limit_png(size=FILE_LIMIT) -> bytes:
    return png_bytes(1600, 1660, size)


def exif_segment(orientation: int, gps: bool = True) -> bytes:
    count = 2 if gps else 1
    gps_at = 8 + 2 + 12 * count + 4
    body = b"II*\0" + struct.pack("<I", 8) + struct.pack("<H", count)
    body += struct.pack("<HHIHH", 0x0112, 3, 1, orientation, 0)
    if gps:
        body += struct.pack("<HHII", 0x8825, 4, 1, gps_at)
    body += struct.pack("<I", 0)
    if gps:
        data_at = gps_at + 2 + 24 + 4
        body += struct.pack("<H", 2) + struct.pack("<HHI4s", 1, 2, 2, b"N\0\0\0")
        body += struct.pack("<HHII", 2, 5, 3, data_at) + struct.pack("<I", 0)
        body += struct.pack("<6I", 54, 1, 58, 1, 0, 1)
    payload = b"Exif\0\0" + body
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


def jpeg_bytes(browser, width=1200, height=800, orientation=1, gps=True) -> bytes:
    page = browser.new_page()
    try:
        plain = base64.b64decode(page.evaluate(JPEG_JS, {"w": width, "h": height}))
    finally:
        page.close()
    at = 2
    if plain[2:4] == b"\xff\xe0":
        at = 4 + struct.unpack(">H", plain[4:6])[0]
    return plain[:at] + exif_segment(orientation, gps) + plain[at:]


def jpeg_segments(data: bytes) -> list[int]:
    found, at = [], 2
    while at + 4 <= len(data) and data[at] == 0xFF:
        marker = data[at + 1]
        if marker == 0xDA:
            break
        found.append(marker)
        at += 2 + struct.unpack(">H", data[at + 2:at + 4])[0]
    return found


def multipart(fields: dict, filename: str, data: bytes, ctype: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = b""
    for key, value in fields.items():
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
    out += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
    out += f"Content-Type: {ctype}\r\n\r\n".encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return out, f"multipart/form-data; boundary={boundary}"


def upload(owner, car_id, data, filename="shot.png", ctype="image/png", kind="photo", mask="null", label=None):
    fields = {"kind": kind}
    if kind == "photo":
        fields["plateMask"] = mask
    if label is not None:
        fields["label"] = label
    body, content_type = multipart(fields, filename, data, ctype)
    return owner.post(f"/api/owner/cars/{car_id}/uploads", content=body, headers={"Content-Type": content_type})


def by(scope, role, name):
    return scope.get_by_role(role, name=name, exact=True)


def btn(scope, name):
    return by(scope, "button", name)


def status(scope, name):
    return by(scope, "status", name)


def dialog(scope, name):
    return by(scope, "dialog", name)


def heading(scope, name):
    return by(scope, "heading", name)


def region(scope, name):
    return by(scope, "region", name)


def notice(scope):
    return by(scope, "alert", "Service notice")


def soon(page, check, seconds=WAIT_SECONDS):
    end, last = time.monotonic() + seconds, None
    while time.monotonic() < end:
        try:
            return check()
        except AssertionError as error:
            last = error
            advance(page, STEP_MS)
    pytest.fail(f"expected within {seconds}s: {last}")


def shows(page, locator, seconds=WAIT_SECONDS):
    soon(page, lambda: expect(locator).to_be_visible(timeout=QUICK_MS), seconds)


def reads(page, locator, text, seconds=WAIT_SECONDS):
    soon(page, lambda: expect(locator).to_have_text(text, timeout=QUICK_MS), seconds)


def holds(page, locator, text, seconds=WAIT_SECONDS):
    soon(page, lambda: expect(locator).to_contain_text(text, timeout=QUICK_MS), seconds)


def focused(page, locator, seconds=WAIT_SECONDS):
    soon(page, lambda: expect(locator).to_be_focused(timeout=QUICK_MS), seconds)


def gone(page, locator, seconds=WAIT_SECONDS):
    soon(page, lambda: expect(locator).to_have_count(0, timeout=QUICK_MS), seconds)


@contextmanager
def at(browser, base, path, size=DESKTOP, cookie=None, **options):
    with open_app(browser, f"{base}/api/health", **options) as page:
        page.set_viewport_size(size)
        if cookie:
            page.context.add_cookies([{"name": "ob_owner", "value": cookie, "url": base}])
        page.goto(base + path)
        yield page


@contextmanager
def buyer_page(browser, base, token, size=DESKTOP, **options):
    with at(browser, base, f"/l/{token}", size, **options) as page:
        until(page, "() => { const s = document.querySelector('[data-view-projection]');"
                    " return !!s && s.getAttribute('data-view-projection').split(',').length === 16; }")
        yield page


@contextmanager
def owner_page(browser, owner, path, size=DESKTOP, **options):
    with at(browser, owner.base, path, size, owner.cookie, **options) as page:
        shows(page, btn(page, "Sign out"))
        yield page


def flush(page):
    for _ in range(3):
        page.evaluate("() => fetch('/api/health').then(r => r.text())")
    advance(page, STEP_MS)


def poll(page, fragment="/api/"):
    with page.expect_response(lambda r: fragment in r.url and r.request.method == "GET", timeout=REPLY_WAIT_MS):
        advance(page, POLL_MS)
    flush(page)


def calls(page, fragment, method="POST") -> list:
    found: list = []
    page.on("request", lambda r: found.append(r) if fragment in r.url and r.method == method else None)
    return found


def watch(locator):
    locator.evaluate(WATCH_JS)


def writes(locator) -> list:
    return locator.evaluate("e => e.__writes || []")


def lose_reply(page, glob):
    state = {"lost": 0}

    def handler(route):
        if state["lost"] == 0:
            state["lost"] = 1
            route.fetch()
            route.abort()
        else:
            route.fallback()
    page.route(glob, handler)
    return state


def hold_reply(page, glob) -> list:
    kept: list = []

    def handler(route):
        kept.append((route, route.fetch()))
    page.route(glob, handler)
    return kept


def touch_on(page):
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    return cdp


def touch_tap(page, x, y):
    cdp = touch_on(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def touch_drag(page, x1, y1, x2, y2, steps=6):
    cdp = touch_on(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x1, "y": y1}]})
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
            {"x": x1 + (x2 - x1) * i / steps, "y": y1 + (y2 - y1) * i / steps}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def swipe(page, distance):
    before = page.evaluate("window.scrollY")
    touch_drag(page, 187, 700, 187, 700 - distance / 2, 12)
    seen = {"y": None}

    def settled():
        y, last = page.evaluate("window.scrollY"), seen["y"]
        seen["y"] = y
        return y > before and y == last
    api_until(settled, "the swipe scrolled the page and came to rest", 10)


def stage(page):
    return region(page, "Walkround stage")


def attrs(locator) -> dict:
    return locator.evaluate("e => Object.fromEntries([...e.attributes].map(a => [a.name, a.value]))")


def surface(page, area="Walkround stage"):
    box = region(page, area)
    return box.locator("canvas") if box.get_attribute("data-renderer") == "webgl" else box.get_by_role("img").first


def radius(locator) -> float:
    return locator.evaluate("e => parseFloat(getComputedStyle(e).borderTopLeftRadius)")


def panel_rect(diagram, panel) -> dict:
    return diagram.evaluate(PANEL_RECT_JS, panel)


def frames(locator) -> int:
    return int(locator.get_attribute("data-frame-count"))


def go(page, y, beat=None):
    page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", y)
    until(page, "y => Math.abs(window.scrollY - y) < 2", y, seconds=10)
    advance(page, STEP_MS)
    if beat is not None:
        until(page, "b => document.querySelector('[data-beat]').getAttribute('data-beat') === String(b)", beat, seconds=10)
    flush(page)


def lum(locator, points, far=None, png=None) -> dict:
    return locator.evaluate(LUM_JS, {"points": points, "far": far, "png": png})


def assert_hero_lit(page, finding):
    area = stage(page)
    live = area.get_attribute("data-renderer") == "webgl"
    canvas = surface(page)
    box = canvas.bounding_box()
    px, py, depth = project(attrs(area), world(finding["panelId"], finding["u"], finding["v"]), box)
    assert depth > 0, "hero projects behind the camera"
    x, y = px - box["x"], py - box["y"]
    assert 0 <= x <= box["width"] and 0 <= y <= box["height"], "hero lies outside the canvas"
    png = None if live else base64.b64encode(capture(canvas)).decode()
    stats = lum(canvas, [[x, y, HERO_PATCH]], [x, y, HERO_PATCH, 0.15 * box["width"]], png)
    assert stats["means"][0] >= 2 * stats["median"], stats
    assert stats["far"] <= stats["means"][0], stats
    return px, py, stats["means"][0]


def assert_hero_uncovered(page, px, py, phone=False):
    boxes = [heading(page, "WALK ROUND IT FIRST").bounding_box(),
             page.get_by_text("THEN MAKE YOUR OFFER", exact=True).bounding_box(),
             region(page, "Asking summary").bounding_box()]
    if phone:
        boxes.append(region(page, "Walkround dock").bounding_box())
        menu = btn(page, "Menu").bounding_box()
        assert py > menu["y"] + menu["height"], "hero under the fixed header"
    for box in boxes:
        inside = box["x"] <= px <= box["x"] + box["width"] and box["y"] <= py <= box["y"] + box["height"]
        assert not inside, f"hero point covered by {box}"


def assert_pins_true(page, findings):
    area = stage(page)
    still = surface(page)
    box = still.bounding_box()
    data = attrs(area)
    for finding in findings:
        px, py, _ = project(data, world(finding["panelId"], finding["u"], finding["v"]), box)
        pin = area.locator(f'[data-finding-id="{finding["id"]}"]')
        expect(pin).to_have_count(1)
        inside = box["x"] <= px <= box["x"] + box["width"] and box["y"] <= py <= box["y"] + box["height"]
        if inside:
            rect = pin.bounding_box()
            assert abs(rect["x"] + rect["width"] / 2 - px) <= PIN_TOLERANCE, (finding["panelId"], rect, px)
            assert abs(rect["y"] + rect["height"] / 2 - py) <= PIN_TOLERANCE, (finding["panelId"], rect, py)


def open_section(page, name):
    tap(btn(page, "Sections"))
    sheet = dialog(page, "Car file sections")
    shows(page, sheet)
    tap(by(sheet, "link", name))
    focused(page, heading(page, name))


def line(page, text):
    holds(page, by(page, "navigation", "Car file sections"), text)


def place_pin(page, label):
    click(by(page, "listbox", "Panels").get_by_role("option", name=label, exact=True))


def write_finding(page, label, title, wording, severity="moderate"):
    place_pin(page, label)
    fill(by(page, "textbox", "Finding title"), title)
    fill(by(page, "textbox", "Finding wording"), wording)
    select(by(page, "combobox", "Severity"), severity)


def choose_photo(page, name, data, mime="image/jpeg"):
    with page.expect_file_chooser() as chooser:
        click(btn(page, "Add photo"))
    chooser.value.set_files({"name": name, "mimeType": mime, "buffer": data})


def save_response(page, text):
    area = region(page, "Advisories")
    handle = by(area, "combobox", f"Response to {text}").element_handle()
    index = area.get_by_role("combobox").evaluate_all("(els, t) => els.indexOf(t)", handle)
    buttons = btn(area, "Save response")
    click(buttons.nth(min(index, buttons.count() - 1)))


def open_offer_dialog(page):
    btn(page, "Make an offer").focus()
    page.keyboard.press("Enter")
    shows(page, dialog(page, "Make an offer"))


def test_owner_session_gate(browser, app_url):
    for method, path in (("GET", "/api/owner/cars"), ("POST", "/api/owner/cars"), ("GET", "/api/owner/alerts")):
        reply = httpx.request(method, app_url + path, json={} if method == "POST" else None)
        assert reply.status_code == 401 and reply.json()["error"] == "not_signed_in"
    wrong = httpx.post(f"{app_url}/api/owner/session", json={"passphrase": "not-the-passphrase"})
    assert wrong.status_code == 401 and wrong.json()["error"] == "bad_passphrase"
    first, second = Owner(app_url), Owner(app_url)
    good = httpx.post(f"{app_url}/api/owner/session", json={"passphrase": PASSPHRASE})
    assert good.json() == {"signedIn": True}
    cookie = good.headers["set-cookie"].lower()
    assert all(part.lower() in cookie for part in ("ob_owner", "HttpOnly", "SameSite=Lax"))
    assert PASSPHRASE not in good.text
    assert first.get("/api/owner/cars").status_code == 200
    assert second.delete("/api/owner/session").status_code == 204
    assert first.get("/api/owner/cars").status_code == 401
    assert second.get("/api/owner/cars").status_code == 401
    with at(browser, app_url, "/owner/cars") as page:
        soon(page, lambda: expect(page).to_have_url(re.compile(r"/owner\?return="), timeout=QUICK_MS))
        shows(page, by(page, "textbox", "Passphrase"))
        fill(by(page, "textbox", "Passphrase"), "not-the-passphrase")
        click(btn(page, "Sign in"))
        holds(page, page.locator("body"), "That passphrase is not right")
        fill(by(page, "textbox", "Passphrase"), PASSPHRASE)
        click(btn(page, "Sign in"))
        soon(page, lambda: expect(page).to_have_url(f"{app_url}/owner/cars", timeout=QUICK_MS))
        shows(page, btn(page, "Sign out"))
        click(btn(page, "Sign out"))
        api_until(lambda: httpx.get(f"{app_url}/api/owner/cars",
                                    cookies={c["name"]: c["value"] for c in page.context.cookies()}).status_code == 401,
                  "Sign out ended the session", 15)


def test_car_file_create_and_validation(app_url):
    owner = Owner(app_url)
    car = owner.new_car("s482 kvt")
    assert car["registration"] == "S482KVT" and car["listingStatus"] == "draft" and car["currentVersion"] is None
    assert car["homeAddress"] == "7 Larkfield Close, Hexham NE46 9ZZ"
    assert uuid.UUID(car["id"])
    assert car["id"] in [c["id"] for c in owner.get("/api/owner/cars").json()["cars"]]
    assert owner.car(car["id"])["askingPounds"] == ASKING
    assert owner.get(f"/api/owner/cars/{uuid.uuid4()}").status_code == 404
    good = {"name": "n", "registration": "AB", "askingPounds": 1, "viewingArea": "v", "homeAddress": "h", "story": "s"}
    assert owner.post("/api/owner/cars", json=good).status_code == 201
    assert owner.post("/api/owner/cars", json={**good, "askingPounds": 10000000}).status_code == 201
    bad = (("name", ""), ("name", "x" * 81), ("viewingArea", ""), ("homeAddress", "x" * 201), ("story", "x" * 1001),
           ("askingPounds", 0), ("askingPounds", 10000001), ("registration", "A"), ("registration", "ABCD12345"),
           ("registration", "AB-12"))
    for field, value in bad:
        reply = owner.post("/api/owner/cars", json={**good, field: value})
        assert reply.status_code == 422 and reply.json()["error"] == "validation", (field, value)
        assert field in reply.json()["errors"], (field, value)


def test_owner_readings_and_plastic(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    path = f"/api/owner/cars/{car['id']}/readings"
    ok = owner.put(path, json={"readings": [{"panelId": "roof", "microns": 2000}, {"panelId": "bonnet", "microns": 1}]})
    assert ok.status_code == 200
    roof = next(p for p in ok.json()["panels"] if p["id"] == "roof")
    assert roof["owner"]["microns"] == 2000 and roof["substrate"] == "steel" and roof["owner"]["readAt"]
    for bad in (0, int(MICRONS_OVER), 12.5):
        reply = owner.put(path, json={"readings": [{"panelId": "roof", "microns": bad}]})
        assert reply.status_code == 422
        assert reply.json()["errors"]["roof"] == "Enter whole microns from 1 to 2000"
    plastic = owner.put(path, json={"readings": [{"panelId": "rear-bumper", "microns": 120}]})
    assert plastic.status_code == 422 and plastic.json()["errors"]["rear-bumper"] == "Plastic panels cannot be gauged"
    replaced = owner.put(path, json={"readings": [{"panelId": "roof", "microns": 118}]}).json()
    panels = {p["id"]: p for p in replaced["panels"]}
    assert len(panels) == len(FRAMES) and panels["roof"]["owner"]["microns"] == 118
    bumper = panels["rear-bumper"]["owner"]
    assert bumper is None or bumper["microns"] is None
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#panels") as page:
        table = by(page, "table", "Panel readings")
        shows(page, table)
        expect(table.get_by_role("row").filter(has_text="Rear bumper")).to_contain_text("Not gauged")
        expect(by(page, "spinbutton", "Microns for Rear bumper")).to_have_count(0)
        fill(by(page, "spinbutton", "Microns for Offside door"), MICRONS_OVER)
        click(btn(page, "Save readings"))
        holds(page, table, "Enter whole microns from 1 to 2000")
        expect(by(page, "spinbutton", "Microns for Offside door")).to_have_value(MICRONS_OVER)
        fill(by(page, "spinbutton", "Microns for Offside door"), str(DOOR_MICRONS))
        click(btn(page, "Save readings"))
        reads(page, status(page, "Owner status"), "Readings saved")
    assert any(p["id"] == "os-door" and p["owner"]["microns"] == DOOR_MICRONS
               for p in owner.get(f"/api/owner/cars/{car['id']}/panels").json()["panels"])


def test_paint_band_thresholds(app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    fresh_panels = owner.get(f"/api/owner/cars/{car['id']}/panels").json()
    assert fresh_panels["medians"] == {"steel": None, "aluminium": None}
    none = next(p for p in fresh_panels["panels"] if p["id"] == "roof")["owner"]
    assert none is None or none["band"] == "No reading"
    values = {"os-front-wing": 169, "os-door": 170, "os-sill": 200, "os-rear-quarter": 240, "ns-rear-quarter": 241,
              "ns-sill": 350, "ns-door": 351, "ns-front-wing": 200, "roof": 200, "bonnet": 100, "boot-lid": 103}
    reply = owner.put(f"/api/owner/cars/{car['id']}/readings",
                      json={"readings": [{"panelId": k, "microns": v} for k, v in values.items()]}).json()
    assert reply["medians"] == {"steel": 200, "aluminium": 102}
    bands = {p["id"]: p["owner"]["band"] for p in reply["panels"] if p["owner"] and p["owner"].get("microns")}
    assert bands["os-front-wing"] == "Thin" and bands["os-door"] == "Original"
    assert bands["os-rear-quarter"] == "Original" and bands["ns-rear-quarter"] == "Refinished"
    assert bands["ns-sill"] == "Refinished" and bands["ns-door"] == "Filler" and bands["bonnet"] == "Original"


def test_units_mode_bar(browser, app_url):
    owner = Owner(app_url)
    car = owner.by_name(SEED_CAR)
    before = owner.get(f"/api/owner/cars/{car['id']}/panels").json()
    door = next(p for p in before["panels"] if p["id"] == "os-door")["owner"]
    assert door["microns"] == 121 and door["mils"] == "4.8"
    with buyer_page(browser, app_url, ROWAN) as page:
        toggle = btn(page, "Units: microns")
        shows(page, toggle)
        rect = toggle.bounding_box()
        assert rect["y"] < 60 and rect["x"] + rect["width"] > DESKTOP["width"] / 2
        holds(page, by(page, "table", "Gauge readings"), "121 microns")
        click(toggle)
        shows(page, btn(page, "Units: mils"))
        holds(page, by(page, "table", "Gauge readings"), "4.8 mils")
        expect(by(page, "table", "Gauge readings")).not_to_contain_text("121 microns")
        page.reload()
        shows(page, btn(page, "Units: mils"))
        holds(page, by(page, "table", "Gauge readings"), "4.8 mils")
        page.set_viewport_size(PHONE)
        gone(page, btn(page, "Units: mils"))
        click(btn(page, "Menu"))
        shows(page, btn(dialog(page, "Menu"), "Units: mils"))
    assert owner.get(f"/api/owner/cars/{car['id']}/panels").json() == before


def test_finding_anchor_and_order(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    roof = owner.finding(car["id"], "roof", 0.1234, 0.5, "cosmetic")
    sill = owner.finding(car["id"], "os-sill", 0.72, 0.4, "serious")
    assert roof["u"] == 0.123 and roof["panelLabel"] == "Roof" and roof["material"] is False
    assert sill["material"] is True
    ordered = owner.findings(car["id"])
    assert [f["panelId"] for f in ordered] == ["os-sill", "roof"] and [f["position"] for f in ordered] == [1, 2]
    base = {"panelId": "roof", "u": 0.5, "v": 0.5, "title": "t", "wording": "w", "severity": "cosmetic", "photoId": None}
    other = upload(owner, owner.new_car()["id"], png_bytes()).json()["id"]
    for field, value in (("u", 1.1), ("v", -0.1), ("title", ""), ("title", "x" * 81), ("wording", ""),
                         ("wording", "x" * 601), ("severity", "minor"), ("photoId", other)):
        reply = owner.post(f"/api/owner/cars/{car['id']}/findings", json={**base, field: value})
        assert reply.status_code == 422 and field in reply.json()["errors"], (field, value)
    owner.pull(car["id"])
    owner.answer_all(car["id"])
    owner.publish(car["id"])
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        data = attrs(stage(page))
        assert data["data-panel"] == "os-sill"
        assert [float(n) for n in data["data-anchor"].split(",")] == [0.72, 0.4]
        go(page, BEAT * 2.5, 2)
        data = attrs(stage(page))
        assert data["data-panel"] == "roof"
        assert [float(n) for n in data["data-anchor"].split(",")] == [0.123, 0.5]


def test_keyboard_pin_placement(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#findings") as page:
        panels = by(page, "listbox", "Panels")
        shows(page, panels)
        panels.focus()
        page.keyboard.press("ArrowDown")
        preview = region(page, "Stage preview")
        soon(page, lambda: expect(preview).to_have_attribute("data-anchor", re.compile(r"^0\.50*,0\.50*$"), timeout=QUICK_MS))
        panel = preview.get_attribute("data-panel")
        page.keyboard.press("Tab")
        expect(btn(page, "Finding pin")).to_be_focused()
        live = status(page, "Owner status")
        watch(live)
        top = page.evaluate("window.scrollY")
        anchor = lambda: [float(n) for n in preview.get_attribute("data-anchor").split(",")]
        page.keyboard.press("ArrowRight")
        soon(page, lambda: _near(anchor()[0], 0.51))
        page.keyboard.press("Shift+ArrowDown")
        soon(page, lambda: _near(anchor()[1], 0.55))
        for _ in range(12):
            page.keyboard.press("Shift+ArrowRight")
        soon(page, lambda: _near(anchor()[0], 1.0))
        assert len(writes(live)) >= 3, "each move announced"
        assert page.evaluate("window.scrollY") == top
        fill(by(page, "textbox", "Finding title"), "Keyed mark")
        fill(by(page, "textbox", "Finding wording"), "Placed by keys")
        select(by(page, "combobox", "Severity"), "cosmetic")
        click(btn(page, "Save finding"))
        reads(page, live, "Finding saved")
    saved = owner.findings(car["id"])[0]
    assert saved["panelId"] == panel and saved["u"] == 1 and abs(saved["v"] - 0.55) < 0.001


def _near(value, target):
    assert abs(value - target) < 0.006, (value, target)


def test_stale_finding_refused(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    made = owner.finding(car["id"], "roof", title="Roof mark")
    path = f"/api/owner/cars/{car['id']}/findings/{made['id']}"
    assert owner.patch(path, json={"wording": "No header"}).status_code == 428
    newer = owner.patch(path, json={"wording": NEWER_WORDING}, headers={"If-Match": f'"{made["revision"]}"'})
    assert newer.status_code == 200 and newer.json()["revision"] == made["revision"] + 1
    stale = owner.patch(path, json={"wording": "Older wording"}, headers={"If-Match": f'"{made["revision"]}"'})
    assert stale.status_code == 412 and stale.json()["error"] == "stale_finding"
    assert stale.json()["currentRevision"] == made["revision"] + 1
    assert owner.delete(path, headers={"If-Match": f'"{made["revision"]}"'}).status_code == 412
    assert owner.findings(car["id"])[0]["wording"] == NEWER_WORDING
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#findings") as page:
        click(btn(page, "Edit Roof mark"))
        fill(by(page, "textbox", "Finding wording"), TYPED_WORDING)
        current = owner.findings(car["id"])[0]
        owner.patch(path, json={"wording": THIRD_WORDING}, headers={"If-Match": f'"{current["revision"]}"'})
        click(btn(page, "Save finding"))
        holds(page, page.locator("body"), "This finding has changed. Reload it before saving.")
        expect(by(page, "textbox", "Finding wording")).to_have_value(TYPED_WORDING)
    assert owner.findings(car["id"])[0]["wording"] == THIRD_WORDING
    current = owner.findings(car["id"])[0]
    assert owner.delete(path, headers={"If-Match": f'"{current["revision"]}"'}).status_code == 204


@pytest.mark.timeout(600)
def test_wf_file_a_car_phone_journey(browser, app_url):
    owner = Owner(app_url)
    target = f"/owner/cars/{owner.by_name(SEED_DRAFT)['id']}"
    name = fresh("Phone car")
    photo = jpeg_bytes(browser, 400, 300, 1, False)
    with at(browser, app_url, target, PHONE) as page:
        soon(page, lambda: expect(page).to_have_url(re.compile(r"/owner\?return="), timeout=QUICK_MS))
        assert parse_qs(urlparse(page.url).query)["return"] == [target]
        assert "/owner/cars" not in urlparse(page.url).query
        fill(by(page, "textbox", "Passphrase"), PASSPHRASE)
        tap(btn(page, "Sign in"))
        soon(page, lambda: expect(page).to_have_url(app_url + target, timeout=QUICK_MS))
        page.goto(f"{app_url}/owner/cars")
        fill(by(page, "textbox", "Car name"), name)
        fill(by(page, "textbox", "Registration"), "t317 hjn")
        fill(by(page, "spinbutton", "Asking price in pounds"), str(ASKING))
        fill(by(page, "textbox", "Viewing area"), "Near Hexham")
        fill(by(page, "textbox", "Home address"), "7 Larkfield Close, Hexham NE46 9ZZ")
        fill(by(page, "textbox", "Owner story"), "A daily driver that never let anyone down.")
        tap(btn(page, "Create car file"))
        soon(page, lambda: expect(page).to_have_url(re.compile(r"/owner/cars/[0-9a-f-]{36}#panels$"), timeout=QUICK_MS))
        focused(page, heading(page, "Panels and readings"))
        car = owner.by_name(name)
        assert car["registration"] == "T317HJN" and car["listingStatus"] == "draft"
        fill(by(page, "spinbutton", "Microns for Roof"), "118")
        fill(by(page, "spinbutton", "Microns for Offside door"), "121")
        tap(btn(page, "Save readings"))
        reads(page, status(page, "Owner status"), "Readings saved")
        tap(btn(page, "Sections"))
        sheet = dialog(page, "Car file sections")
        shows(page, sheet)
        line(page, "Read: 2 of 11")
        tap(btn(sheet, "Close"))
        tap(btn(page, "Sections"))
        advance(page, EXIT_MS * 2)
        shows(page, sheet, 2)
        tap(by(sheet, "link", "Evidence"))
        focused(page, heading(page, "Evidence"))
        assert urlparse(page.url).fragment == "evidence"
        choose_photo(page, "door.jpg", photo)
        shows(page, by(page, "img", "Photo preview"))
        check(by(page, "checkbox", "No plate in this photo"))
        tap(btn(page, "Store photo"))
        reads(page, status(page, "Owner status"), "File stored")
        focused(page, btn(page, "Add photo"))
        open_section(page, "Findings")
        panels = by(page, "listbox", "Panels")
        panels.focus()
        page.keyboard.press("ArrowDown")
        pin = btn(page, "Finding pin")
        pin.focus()
        top = page.evaluate("window.scrollY")
        preview = region(page, "Stage preview")
        before = decode(capture(surface(page, "Stage preview")))
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Shift+ArrowUp")
        flush(page)
        assert page.evaluate("window.scrollY") == top
        assert difference(before, decode(capture(surface(page, "Stage preview")))) > 0
        fill(by(page, "textbox", "Finding title"), "Phone mark")
        fill(by(page, "textbox", "Finding wording"), "Written on a phone")
        select(by(page, "combobox", "Severity"), "serious")
        select(by(page, "combobox", "Finding photo"), "door.jpg")
        tap(btn(page, "Save finding"))
        reads(page, status(page, "Owner status"), "Finding saved")
        expect(preview).to_have_attribute("data-renderer", re.compile("webgl|svg"))
        holds(page, by(page, "list", "Findings"), "Phone mark")
        tap(btn(page, "Sections"))
        shows(page, sheet)
        line(page, "Findings: 1")
        line(page, "Files: 1")
    stored = owner.car(car["id"])
    assert stored["standing"]["findings"] == 1 and stored["standing"]["files"] == 1
    assert stored["standing"]["panelsRead"] == 2
    finding = owner.findings(car["id"])[0]
    assert finding["photoId"] and finding["severity"] == "serious"
    assert S3().keys(f"originals/{car['id']}/")


def test_wf_file_a_car_landing_routes(browser, app_url):
    for bad in HOSTILE_RETURNS:
        with at(browser, app_url, f"/owner?return={bad}") as page:
            fill(by(page, "textbox", "Passphrase"), PASSPHRASE)
            click(btn(page, "Sign in"))
            soon(page, lambda: expect(page).to_have_url(f"{app_url}/owner/cars", timeout=QUICK_MS))
    with at(browser, app_url, "/owner") as page:
        fill(by(page, "textbox", "Passphrase"), PASSPHRASE)
        page.keyboard.press("Enter")
        soon(page, lambda: expect(page).to_have_url(f"{app_url}/owner/cars", timeout=QUICK_MS))
        shows(page, by(page, "list", "Garage"))
        page.reload()
        shows(page, by(page, "list", "Garage"))
        holds(page, by(page, "list", "Garage"), SEED_CAR)
        click(by(page, "link", SEED_DRAFT))
        soon(page, lambda: expect(page).to_have_url(re.compile(r"/owner/cars/[0-9a-f-]{36}"), timeout=QUICK_MS))
        shows(page, heading(page, "Panels and readings"))
        page.goto(f"{app_url}/owner/cars/{uuid.uuid4()}")
        shows(page, heading(page, "We could not find that car file"))


def test_wf_file_a_car_stage_preview(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#findings") as page:
        preview = region(page, "Stage preview")
        shows(page, preview)
        holds(page, preview, "No findings yet")
        assert not preview.get_attribute("data-panel") and not preview.get_attribute("data-anchor")
        box = preview.bounding_box()
        assert box["height"] >= 240
        write_finding(page, "Roof", "Roof mark", "On the roof", "moderate")
        soon(page, lambda: expect(preview).to_have_attribute("data-panel", "roof", timeout=QUICK_MS))
        pose = preview.get_attribute("data-camera-position")
        count = frames(preview)
        btn(page, "Finding pin").focus()
        page.keyboard.press("ArrowLeft")
        soon(page, lambda: expect(preview).not_to_have_attribute("data-camera-position", pose, timeout=QUICK_MS))
        advance(page, STEP_MS)
        assert frames(preview) == count + 1
        click(btn(page, "Save finding"))
        reads(page, status(page, "Owner status"), "Finding saved")
        write_finding(page, "Offside sill", "Sill mark", "On the sill", "serious")
        click(btn(page, "Save finding"))
        reads(page, status(page, "Owner status"), "Finding saved")
        soon(page, lambda: expect(preview).to_have_attribute("data-panel", "os-sill", timeout=QUICK_MS))
        data = attrs(preview)
        canvas = surface(page, "Stage preview")
        rect = canvas.bounding_box()
        px, py, depth = project(data, world("os-sill", 0.5, 0.5), rect)
        assert depth > 0 and rect["x"] <= px <= rect["x"] + rect["width"] and rect["y"] <= py <= rect["y"] + rect["height"]
        stats = lum(canvas, [[px - rect["x"], py - rect["y"], HERO_PATCH]])
        assert stats["means"][0] >= 2 * stats["median"], stats
        expect(preview).to_have_attribute("data-open-advisories", "0")


def test_wf_file_a_car_session_resume(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#findings") as page:
        write_finding(page, "Roof", "Resumed mark", RESUMED_WORDING)
        posts = calls(page, f"/api/owner/cars/{car['id']}/findings")
        Owner(app_url).delete("/api/owner/session")
        poll(page, "/api/owner/")
        expect(dialog(page, "Sign in again")).to_have_count(0)
        expect(by(page, "textbox", "Finding wording")).to_have_value(RESUMED_WORDING)
        click(btn(page, "Save finding"))
        again = dialog(page, "Sign in again")
        shows(page, again)
        holds(page, again, "Your session has ended. Sign in to carry on.")
        expect(btn(again, "Close")).to_have_count(0)
        expect(btn(again, "Cancel")).to_have_count(0)
        page.keyboard.press("Escape")
        advance(page, EXIT_MS)
        expect(again).to_be_visible()
        fill(by(again, "textbox", "Passphrase"), "not-the-passphrase")
        click(btn(again, "Sign in"))
        holds(page, status(again, "Dialog status"), "That passphrase is not right")
        fill(by(again, "textbox", "Passphrase"), PASSPHRASE)
        click(btn(again, "Sign in"))
        gone(page, again)
        reads(page, status(page, "Owner status"), "Finding saved")
        assert len(posts) == 2 and posts[0].post_data == posts[1].post_data
    fresh_owner = Owner(app_url)
    saved = fresh_owner.findings(car["id"])
    assert [f["wording"] for f in saved] == [RESUMED_WORDING]


def test_section_standing_lines(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}") as page:
        nav = by(page, "navigation", "Car file sections")
        shows(page, nav)
        for name in ("Panels and readings", "Findings", "Evidence", "Test record", "Publish", "People", "Viewings",
                     "Offers", "Alerts"):
            shows(page, by(nav, "link", name))
        standing = owner.car(car["id"])["standing"]
        for text in (f"Read: {standing['panelsRead']} of {standing['panelsGaugeable']}", "Findings: 3", "Files: 0",
                     f"Open advisories: {owner.car(car['id'])['workingOpenAdvisories']}", "Blockers: 0",
                     "Active links: 0", "Slots held: 0 of 0", "Live offers: 0", "Failed alerts: 0"):
            expect(nav).to_contain_text(text)
        assert standing["panelsGaugeable"] == 11
        link = owner.link(car["id"])
        slot = owner.slot(car["id"])
        assert claim(app_url, link["token"], slot["id"]).status_code == 201
        poll(page, "/api/owner/")
        holds(page, nav, "Active links: 1")
        holds(page, nav, "Slots held: 1 of 1")
        fill(by(page, "textbox", "Viewing date and time"), SLOT_B)
        fill(by(page, "spinbutton", "Viewing length in minutes"), "45")
        click(btn(page, "Add viewing slot"))
        reads(page, status(page, "Owner status"), "Viewing slot added")
        holds(page, nav, "Slots held: 1 of 2", STANDING_MS / 1000 + 3)


UPLOAD_CASES = ["text_as_jpg", "svg", "html", "truncated_png", "slash_name", "backslash_name", "dotdot_name",
                "nul_name", "over_limit", "at_limit"]


@pytest.mark.parametrize("case", UPLOAD_CASES, ids=UPLOAD_CASES)
def test_upload_refusals(app_url, case):
    owner = Owner(app_url)
    car = owner.new_car()
    good = png_bytes()
    table = {
        "text_as_jpg": (b"this is not an image at all", "a.jpg", "image/jpeg", 415, "unsupported_file"),
        "svg": (b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', "a.png", "image/png", 415, "unsupported_file"),
        "html": (b"<html><script>1</script></html>", "a.jpg", "image/jpeg", 415, "unsupported_file"),
        "truncated_png": (good[: len(good) // 2], "a.png", "image/png", 415, "unsupported_file"),
        "slash_name": (good, "a/b.png", "image/png", 422, "validation"),
        "backslash_name": (good, "a\\b.png", "image/png", 422, "validation"),
        "dotdot_name": (good, "..hidden.png", "image/png", 422, "validation"),
        "nul_name": (good, "a\0b.png", "image/png", 422, "validation"),
        "over_limit": (near_limit_png(FILE_LIMIT + 1), "a.png", "image/png", 413, "file_too_large"),
        "at_limit": (near_limit_png(FILE_LIMIT), "a.png", "image/png", 201, None),
    }
    data, name, ctype, code, error = table[case]
    reply = upload(owner, car["id"], data, name, ctype)
    assert reply.status_code == code, reply.text
    listed = owner.get(f"/api/owner/cars/{car['id']}/uploads").json()["uploads"]
    if code == 201:
        assert reply.json()["bytes"] == FILE_LIMIT and len(listed) == 1
        return
    assert reply.json()["error"] == error
    if code == 422:
        assert "file" in reply.json()["errors"]
    assert listed == [] and S3().keys(f"originals/{car['id']}/") == []
    assert owner.car(car["id"])["standing"]["files"] == 0


def test_originals_kept_owner_only(browser, app_url):
    owner = Owner(app_url)
    car = owner.draft()
    photo_bytes = jpeg_bytes(browser, 300, 200, 6)
    invoice_bytes = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    photo = upload(owner, car["id"], photo_bytes, "p.jpg", "image/jpeg", mask='{"x":0.1,"y":0.1,"w":0.2,"h":0.2}')
    invoice = upload(owner, car["id"], invoice_bytes, "i.pdf", "application/pdf", "invoice", label=INVOICE_LABEL)
    assert photo.status_code == 201 and invoice.status_code == 201
    p, i = photo.json(), invoice.json()
    assert p["sha256"] == hashlib.sha256(photo_bytes).hexdigest() and p["status"] == "stored"
    assert p["bytes"] == len(photo_bytes) and p["locationRemoved"] is True and p["kind"] == "photo"
    assert i["derivativeSha256"] is None and i["label"] == INVOICE_LABEL
    store = S3()
    assert store.get(f"originals/{car['id']}/{p['id']}") == photo_bytes
    assert store.get(f"originals/{car['id']}/{i['id']}") == invoice_bytes
    got = owner.get(f"/api/owner/uploads/{i['id']}/original")
    assert got.status_code == 200 and got.content == invoice_bytes and "application/pdf" in got.headers["content-type"]
    assert owner.get(f"/api/owner/uploads/{p['id']}/original").content == photo_bytes
    assert owner.get(f"/api/owner/uploads/{i['id']}/derivative").status_code == 404
    assert httpx.get(f"{app_url}/api/owner/uploads/{p['id']}/original").status_code == 401
    owner.pull(car["id"])
    owner.answer_all(car["id"])
    owner.publish(car["id"])
    token = owner.link(car["id"])["token"]
    seen = view(app_url, token)
    assert seen["invoices"] == [{"label": INVOICE_LABEL}]
    assert i["id"] not in json.dumps(seen)
    assert httpx.get(f"{app_url}/api/link/{token}/photos/{i['id']}").status_code != 200


def test_buyer_derivative_clean(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    original = jpeg_bytes(browser, 2400, 1600, 6)
    mask = {"x": 0.25, "y": 0.5, "w": 0.5, "h": 0.25}
    made = upload(owner, car["id"], original, "wide.jpg", "image/jpeg", mask=json.dumps(mask)).json()
    owner.finding(car["id"], "roof", photo=made["id"], severity="serious")
    owner.pull(car["id"])
    owner.answer_all(car["id"])
    owner.publish(car["id"])
    token = owner.link(car["id"])["token"]
    other = owner.live()
    other_token = owner.link(other["id"])["token"]
    reply = httpx.get(f"{app_url}/api/link/{token}/photos/{made['id']}", timeout=HTTP_SECONDS)
    assert reply.status_code == 200 and "image/jpeg" in reply.headers["content-type"]
    data = reply.content
    assert hashlib.sha256(data).hexdigest() == made["derivativeSha256"] != made["sha256"]
    assert data == S3().get(f"derivatives/{car['id']}/{made['id']}.jpg")
    assert not {0xE1, 0xE2, 0xED, 0xFE} & set(jpeg_segments(data)), "metadata segments remain"
    assert b"Exif" not in data[:4096] and b"GPS" not in data[:4096]
    assert httpx.get(f"{app_url}/api/link/{other_token}/photos/{made['id']}").status_code == 404
    page = browser.new_page()
    try:
        probe = page.evaluate(PROBE_JS, {"data": base64.b64encode(data).decode(), "points": [
            [0.3, 0.55], [0.5, 0.62], [0.7, 0.7], [0.9, 0.05], [0.1, 0.95]]})
    finally:
        page.close()
    assert probe["h"] <= LONG_EDGE and probe["w"] < probe["h"], "upright and scaled"
    masked = probe["px"][:3]
    assert all(max(p) < 90 for p in masked) and max(abs(a - b) for p in masked for a, b in zip(p, masked[0])) <= 12
    assert probe["px"][3][0] > 150 > probe["px"][3][1], "stored top-left block now sits top-right"
    assert probe["px"][4][1] > probe["px"][4][0]


def test_store_confirmed_outage(app_url):
    owner = Owner(app_url)
    down = Owner(os.environ["APP_MINIO_DOWN_URL"])
    car = owner.new_car()
    kept = upload(owner, car["id"], png_bytes()).json()
    reply = upload(down, car["id"], png_bytes())
    assert reply.status_code == 503 and reply.json()["error"] == "storage_unavailable"
    listed = owner.get(f"/api/owner/cars/{car['id']}/uploads").json()["uploads"]
    assert [u["id"] for u in listed] == [kept["id"]]
    assert len(S3().keys(f"originals/{car['id']}/")) == 1 and len(S3().keys(f"derivatives/{car['id']}/")) == 1
    assert owner.car(car["id"])["standing"]["files"] == 1
    assert down.get(f"/api/owner/uploads/{kept['id']}/original").status_code == 503
    assert down.get(f"/api/owner/uploads/{kept['id']}/derivative").status_code == 503


def test_wf_evidence_upload_touch_mask(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    photo = jpeg_bytes(browser, 1200, 800, 6)
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#evidence", PHONE) as page:
        choose_photo(page, "turned.jpg", photo)
        preview = by(page, "img", "Photo preview")
        shows(page, preview)
        soon(page, lambda: _taller(preview))
        rect = preview.bounding_box()
        top = page.evaluate("window.scrollY")
        x1, y1 = rect["x"] + rect["width"] * 0.3, rect["y"] + rect["height"] * 0.4
        x2, y2 = rect["x"] + rect["width"] * 0.7, rect["y"] + rect["height"] * 0.6
        touch_drag(page, x1, y1, x2, y2)
        flush(page)
        assert page.evaluate("window.scrollY") == top
        group = by(page, "group", "Plate mask")
        values = [float(by(group, "spinbutton", n).input_value()) for n in ("Mask left", "Mask top", "Mask width", "Mask height")]
        for got, want in zip(values, (30, 40, 40, 20)):
            assert abs(got - want) <= 2, values
        tap(btn(page, "Store photo"))
        reads(page, status(page, "Owner status"), "Location removed from the buyer copy")
    made = owner.get(f"/api/owner/cars/{car['id']}/uploads").json()["uploads"][0]
    data = owner.get(f"/api/owner/uploads/{made['id']}/derivative").content
    probe_page = browser.new_page()
    try:
        probe = probe_page.evaluate(PROBE_JS, {"data": base64.b64encode(data).decode(), "points": [
            [0.35, 0.45], [0.5, 0.5], [0.65, 0.55], [0.1, 0.9]]})
    finally:
        probe_page.close()
    assert probe["h"] > probe["w"]
    assert all(max(p) < 90 for p in probe["px"][:3]) and max(probe["px"][3]) > 100


def _taller(locator):
    box = locator.bounding_box()
    assert box and box["height"] > box["width"], box


def test_wf_evidence_upload_announced(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    photo = jpeg_bytes(browser, 300, 200, 1)
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#evidence") as page:
        live = status(page, "Owner status")
        watch(live)
        for index, name in enumerate((FIRST_PHOTO, SECOND_PHOTO), 1):
            choose_photo(page, name, photo)
            shows(page, by(page, "img", "Photo preview"))
            check(by(page, "checkbox", "No plate in this photo"))
            click(btn(page, "Store photo"))
            holds(page, by(page, "list", "Evidence"), name)
            soon(page, lambda: _count(writes(live), "Location removed from the buyer copy", index))
            expect(btn(page, "Add photo")).to_be_focused()
            expect(by(page, "img", "Photo preview")).to_have_count(0)
        step = ["Storing file", "File stored", "Location removed from the buyer copy"]
        assert writes(live) == step + step
        expect(by(page, "combobox", "Finding photo").get_by_role("option", name=SECOND_PHOTO)).to_have_count(1)
    assert len(owner.get(f"/api/owner/cars/{car['id']}/uploads").json()["uploads"]) == 2


def _count(items, text, count):
    assert items.count(text) >= count, items


def test_wf_evidence_upload_last_choice(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    small = jpeg_bytes(browser, 300, 200, 1, False)
    big = near_limit_png()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#evidence") as page:
        with page.expect_file_chooser() as chooser:
            click(btn(page, "Add photo"))
        chooser.value.set_files({"name": "big.png", "mimeType": "image/png", "buffer": big})
        with page.expect_file_chooser() as chooser:
            click(btn(page, "Add photo"))
        chooser.value.set_files({"name": SMALL_PHOTO, "mimeType": "image/jpeg", "buffer": small})
        preview = by(page, "img", "Photo preview")
        shows(page, preview)
        soon(page, lambda: _natural(preview, 300))
        flush(page)
        _natural(preview, 300)
        group = by(page, "group", "Plate mask")
        for name in ("Mask left", "Mask top", "Mask width", "Mask height"):
            expect(by(group, "spinbutton", name)).to_have_value("")
        expect(by(group, "checkbox", "No plate in this photo")).not_to_be_checked()
        click(btn(page, "Store photo"))
        holds(page, page.locator("body"), "Mark the plate or tick No plate in this photo")
        check(by(group, "checkbox", "No plate in this photo"))
        click(btn(page, "Store photo"))
        reads(page, status(page, "Owner status"), "File stored")
    uploads = owner.get(f"/api/owner/cars/{car['id']}/uploads").json()["uploads"]
    assert [u["sha256"] for u in uploads] == [hashlib.sha256(small).hexdigest()]
    assert uploads[0]["fileName"] == SMALL_PHOTO


def _natural(locator, width):
    assert locator.evaluate("e => e.naturalWidth || e.width") == width


def test_wf_evidence_upload_session_resume(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    photo = jpeg_bytes(browser, 300, 200, 1, False)
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#evidence") as page:
        choose_photo(page, "late.jpg", photo)
        group = by(page, "group", "Plate mask")
        for name, value in (("Mask left", "10"), ("Mask top", "20"), ("Mask width", "30"), ("Mask height", "15")):
            fill(by(group, "spinbutton", name), value)
        live = status(page, "Owner status")
        watch(live)
        Owner(app_url).delete("/api/owner/session")
        click(btn(page, "Store photo"))
        again = dialog(page, "Sign in again")
        shows(page, again)
        fill(by(again, "textbox", "Passphrase"), PASSPHRASE)
        page.keyboard.press("Enter")
        gone(page, again)
        reads(page, live, "File stored")
        assert writes(live).count("Storing file") >= 2
    fresh_owner = Owner(app_url)
    uploads = fresh_owner.get(f"/api/owner/cars/{car['id']}/uploads").json()["uploads"]
    assert [u["sha256"] for u in uploads] == [hashlib.sha256(photo).hexdigest()]
    assert len(S3().keys(f"originals/{car['id']}/")) == 1


def test_record_pull_kept(wiremock, app_url):
    owner = Owner(app_url)
    reg = fresh_reg()
    stub_record(wiremock, reg, [mot("730000000931", "2025-05-14T10:20:11.000Z", ["Exhaust back box slightly corroded"])])
    car = owner.new_car(reg)
    assert owner.get(f"/api/owner/cars/{car['id']}/record").status_code == 404
    assert owner.get(f"/api/owner/cars/{car['id']}/record").json()["error"] == "no_record_pull"
    first = owner.pull(car["id"])
    assert first["firstUsedDate"] == "1993-05-20" and first["openAdvisories"] == 1
    assert first["advisories"][0]["motTestNumber"] == "730000000931" and first["advisories"][0]["stance"] is None
    path = f"/v1/trade/vehicles/registration/{reg}"
    journal = wiremock.requests(path)
    assert len(journal) == 1 and journal[0].get("queryParams", {}) in ({}, None)
    second = owner.pull(car["id"])
    assert second["pulledAt"] >= first["pulledAt"] and len(wiremock.requests(path)) == 2
    assert owner.get(f"/api/owner/cars/{car['id']}/record").json()["pulledAt"] == second["pulledAt"]
    assert owner.car(car["id"])["pulledAt"] == second["pulledAt"]


def test_record_failures(wiremock, browser, app_url):
    owner = Owner(app_url)
    reg = fresh_reg()
    tests = [mot("730000000931", "2025-05-14T10:20:11.000Z", ["Exhaust back box slightly corroded"])]
    stub_record(wiremock, reg, tests)
    car = owner.new_car(reg)
    kept = owner.pull(car["id"])
    path = f"/v1/trade/vehicles/registration/{reg}"
    pull_path = f"/api/owner/cars/{car['id']}/record/pull"
    wiremock.stub("GET", path, status=404, body="gone")
    assert owner.post(pull_path).json()["error"] == "record_not_found"
    wiremock.stub("GET", path, status=429, headers={"Retry-After": "30"}, json={"errorMessage": "Rate limit exceeded"})
    busy = owner.post(pull_path)
    assert busy.status_code == 429 and busy.json()["error"] == "record_throttled" and busy.json()["retryAfterSeconds"] == 30
    wiremock.stub("GET", path, status=429, json={"errorMessage": "Rate limit exceeded"})
    assert owner.post(pull_path).json()["retryAfterSeconds"] == 60
    wiremock.stub("GET", path, status=500, body="boom")
    down = owner.post(pull_path)
    assert down.status_code == 503 and down.json()["error"] == "record_unreachable"
    wiremock.fault("GET", path)
    assert owner.post(pull_path).status_code == 503
    wiremock.stub("GET", path, json=record_body(reg, tests), delay_ms=6000)
    assert owner.post(pull_path).status_code == 503
    assert owner.get(f"/api/owner/cars/{car['id']}/record").json()["pulledAt"] == kept["pulledAt"]
    missing = owner.new_car("ZZ99NOF")
    busy_car = owner.new_car("ZZ99THR")
    with owner_page(browser, owner, f"/owner/cars/{missing['id']}#record") as page:
        click(btn(page, "Pull test record"))
        holds(page, page.locator("body"), "No test record was found for this registration.")
        page.goto(f"{app_url}/owner/cars/{busy_car['id']}#record")
        shows(page, btn(page, "Pull test record"))
        click(btn(page, "Pull test record"))
        holds(page, page.locator("body"), "The record service is busy. Try again in 30 seconds.")
    wiremock_down = Owner(os.environ["APP_WIREMOCK_DOWN_URL"])
    with owner_page(browser, wiremock_down, f"/owner/cars/{car['id']}#record") as page:
        shows(page, region(page, "Odometer tape"))
        click(btn(page, "Pull test record"))
        reads(page, notice(page), "The roadworthiness record service is not answering. Your last pull is still shown.")
        expect(region(page, "Odometer tape")).to_contain_text(re.compile(r"98[,\s]?120"))


def test_odometer_tape(app_url):
    owner = Owner(app_url)
    car = owner.new_car("S482 KVT")
    tape = owner.pull(car["id"])["tape"]
    assert [s["motTestNumber"] for s in tape][:2] == ["730000000106", "730000000207"]
    by_number = {s["motTestNumber"]: s for s in tape}
    assert by_number["730000000309"]["status"] == "skipped" and by_number["730000000309"]["flag"] == "no_odometer"
    assert by_number["730000000309"]["normalisedKm"] is None
    assert by_number["730000000410"]["flag"] == "unit_change" and by_number["730000000410"]["normalisedKm"] == KM_READING
    assert by_number["730000000511"]["flag"] == "unit_change"
    assert by_number["730000000612"]["flag"] is None and by_number["730000000612"]["status"] == "read"
    assert by_number["730000000106"]["normalisedKm"] == round(61240 * 1.609344, 1)
    assert all(s["flag"] != "drop" for s in tape)
    assert by_number["730000000207"]["defects"][0]["text"] == "Nearside headlamp aim too high"


def test_odometer_drop_and_unreadable(wiremock, browser, app_url):
    owner = Owner(app_url)
    reg = fresh_reg()
    stub_record(wiremock, reg, [
        mot("730000000001", "2020-01-01T10:00:00.000Z", value="10000", unit="MI"),
        mot("730000000002", "2021-01-01T10:00:00.000Z", value="10000", unit="KM"),
        mot("730000000003", "2022-01-01T10:00:00.000Z", value=None, unit=None, kind="UNREADABLE"),
        mot("730000000004", "2023-01-01T10:00:00.000Z", value="9999", unit="KM"),
        mot("730000000005", "2024-01-01T10:00:00.000Z", value="5000", unit="KM")])
    car = owner.new_car(reg)
    flags = [s["flag"] for s in owner.pull(car["id"])["tape"]]
    assert flags == [None, "drop", "unreadable", None, "drop"]
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#record") as page:
        tape = region(page, "Odometer tape")
        holds(page, tape, "Mileage drop")
        holds(page, tape, "Odometer unreadable")


def test_wf_record_pull_answers_carry(wiremock, browser, app_url):
    owner = Owner(app_url)
    reg = fresh_reg()
    text = "Exhaust back box slightly corroded"
    stub_record(wiremock, reg, [mot("730000000931", "2025-05-14T10:20:11.000Z", [text])])
    car = owner.draft(((("roof"), 0.5, 0.5, "moderate"),), reg)
    owner.pull(car["id"])
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#record") as page:
        area = region(page, "Advisories")
        holds(page, area, "Open advisories: 1")
        select(by(area, "combobox", f"Response to {text}"), "repaired")
        fill(by(area, "textbox", f"Note on {text}"), NOTE)
        url = page.url
        save_response(page, text)
        reads(page, status(page, "Owner status"), "Response saved")
        holds(page, area, "Open advisories: 0")
        assert page.url == url
    assert owner.car(car["id"])["workingOpenAdvisories"] == 0
    item = owner.pull(car["id"])["advisories"][0]
    assert item["stance"] == "repaired" and item["note"] == NOTE and item["answeredAt"]
    for body in ({"stance": "repaired"}, {"stance": "sold", "note": NOTE}, {"stance": "repaired", "note": "x" * 501}):
        reply = owner.put(f"/api/owner/cars/{car['id']}/advisories/{item['id']}", json=body)
        assert reply.status_code == 422


def test_wf_record_pull_unsaved_note_ticks(wiremock, browser, app_url):
    owner = Owner(app_url)
    reg = fresh_reg()
    first = "Exhaust back box slightly corroded"
    second = "Offside rear brake hose slightly chafed"
    old = mot("730000000931", "2025-05-14T10:20:11.000Z", [first])
    stub_record(wiremock, reg, [old])
    car = owner.draft((("roof", 0.5, 0.5, "moderate"),), reg)
    with owner_page(browser, owner, f"/owner/cars/{car['id']}", PHONE) as page:
        open_section(page, "Test record")
        tap(btn(page, "Pull test record"))
        reads(page, status(page, "Owner status"), "Test record pulled")
        preview = region(page, "Stage preview")
        soon(page, lambda: expect(preview).to_have_attribute("data-open-advisories", "1", timeout=QUICK_MS))
        canvas = surface(page, "Stage preview")
        canvas.scroll_into_view_if_needed()
        rect = canvas.bounding_box()
        points = [[16, rect["height"] - 12, 6], [32, rect["height"] - 12, 6]]
        one = lum(canvas, points)["means"]
        assert one[0] >= 3 * max(one[1], 1), one
        area = region(page, "Advisories")
        fill(by(area, "textbox", f"Note on {first}"), HALF_NOTE)
        stub_record(wiremock, reg, [mot("730000000933", "2026-05-12T11:08:36.000Z", [second]),
                                    mot("730000000932", "2025-11-04T14:31:02.000Z", value=None, unit=None, kind="UNREADABLE"),
                                    old])
        btn(page, "Pull test record").focus()
        page.keyboard.press("Enter")
        reads(page, status(page, "Owner status"), "Test record pulled")
        holds(page, area, "Open advisories: 2")
        focused(page, btn(page, "Pull test record"))
        poll(page, "/api/owner/")
        expect(by(area, "textbox", f"Note on {first}")).to_have_value(HALF_NOTE)
        expect(by(area, "textbox", f"Note on {second}")).to_have_value("")
        soon(page, lambda: expect(preview).to_have_attribute("data-open-advisories", "2", timeout=QUICK_MS))
        two = lum(canvas, points)["means"]
        assert two[1] >= 3 * max(one[1], 1), (one, two)
        holds(page, by(page, "list", "Publish blockers"), "Answer every advisory from the latest pull")
    assert owner.car(car["id"])["workingOpenAdvisories"] == 2


def test_wf_record_pull_recurred(wiremock, browser, app_url):
    owner = Owner(app_url)
    reg = fresh_reg()
    text = "Nearside rear brake pipe slightly corroded"
    old = mot("730000001041", "2025-08-19T10:12:40.000Z", [text])
    stub_record(wiremock, reg, [old])
    car = owner.draft((("roof", 0.5, 0.5, "moderate"),), reg)
    item = owner.pull(car["id"])["advisories"][0]
    assert owner.answer(car["id"], item["id"], "repaired").status_code == 200
    stub_record(wiremock, reg, [mot("730000001142", "2026-08-11T09:44:18.000Z", [text]), old])
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#record") as page:
        btn(page, "Pull test record").focus()
        page.keyboard.press("Enter")
        reads(page, status(page, "Owner status"), "Test record pulled")
        focused(page, btn(page, "Pull test record"))
        area = region(page, "Advisories")
        holds(page, area, "Seen again at a later test")
        blockers = by(page, "list", "Publish blockers")
        holds(page, blockers, "Answer every advisory from the latest pull")
        holds(page, blockers, "Change the stance on each advisory seen again at a later test")
        record = owner.get(f"/api/owner/cars/{car['id']}/record").json()
        flagged = next(a for a in record["advisories"] if a["recurred"])
        assert flagged["motTestNumber"] == "730000001041" and record["openAdvisories"] == 2
        reply = owner.post(f"/api/owner/cars/{car['id']}/publish")
        assert reply.status_code == 409 and "advisory_recurred" in reply.json()["reasons"]
        again = owner.answer(car["id"], flagged["id"], "repaired")
        assert again.status_code == 422 and again.json()["errors"]["stance"] == "Seen again at a later test"
        newest = next(a for a in record["advisories"] if a["id"] != flagged["id"])
        assert owner.answer(car["id"], newest["id"]).status_code == 200
        copies = area.get_by_text("Seen again at a later test", exact=True)

        def visible_flag():
            shown = [copies.nth(i) for i in range(copies.count()) if copies.nth(i).is_visible()]
            assert shown, "no visible 'Seen again at a later test' flag"
            return shown[0]
        flag = soon(page, visible_flag)
        shows(page, flag)
        handle = flag.element_handle()
        select(area.get_by_role("combobox").nth(in_flagged_row(area.get_by_role("combobox"), handle)), "monitoring")
        url = page.url
        fill(area.get_by_role("textbox").nth(in_flagged_row(area.get_by_role("textbox"), handle)), NOTE)
        click(btn(area, "Save response").nth(in_flagged_row(btn(area, "Save response"), handle)))
        reads(page, status(page, "Owner status"), "Response saved")
        soon(page, lambda: expect(blockers).not_to_contain_text("Change the stance", timeout=QUICK_MS))
        assert page.url == url
    assert owner.car(car["id"])["publishBlockers"] == []


def in_flagged_row(items, flag_handle) -> int:
    index = items.evaluate_all(
        "(els, f) => { let n = f; while (n) { const hit = els.findIndex(e => n.contains(e)); if (hit >= 0) return hit;"
        " n = n.parentElement; } return -1; }", flag_handle)
    assert index >= 0, "the recurred advisory row holds its own controls"
    return index


def test_wf_record_pull_live_blockers(browser):
    base = os.environ["APP_STALE_RECORD_URL"]
    owner = Owner(base)
    car = owner.new_car()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#publish") as page:
        blockers = by(page, "list", "Publish blockers")
        holds(page, blockers, "Add at least one finding")
        holds(page, blockers, "Pull the test record")
        owner.finding(car["id"], "roof")
        live = status(page, "Owner status")
        watch(live)
        click(btn(page, "Pull test record"))
        reads(page, live, "Test record pulled")
        assert writes(live)[:2] == ["Pulling the test record", "Test record pulled"]
        owner.answer_all(car["id"])
        poll(page, "/api/owner/")
        soon(page, lambda: expect(blockers).not_to_contain_text("Pull the test record", timeout=QUICK_MS))
        holds(page, by(page, "navigation", "Car file sections"), "Blockers: 0")
        expect(page.get_by_text("Nothing is blocking publish", exact=True)).to_be_visible()
        api_until(lambda: owner.car(car["id"])["publishBlockers"] == ["record_stale"], "the pull aged past the limit", 45)
        poll(page, "/api/owner/")
        holds(page, blockers, "The test record is too old. Pull it again.")
        holds(page, by(page, "navigation", "Car file sections"), "Blockers: 1")
        poll(page, "/api/owner/")
        assert writes(live).count("Blockers: 1") == 1


def test_publish_gate(wiremock, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    path = f"/api/owner/cars/{car['id']}/publish"
    first = owner.post(path)
    assert first.status_code == 409 and first.json()["error"] == "publish_blocked"
    assert set(first.json()["reasons"]) == {"no_findings", "no_record_pull"}
    assert set(owner.car(car["id"])["publishBlockers"]) == {"no_findings", "no_record_pull"}
    owner.finding(car["id"], "roof")
    owner.pull(car["id"])
    second = owner.post(path)
    assert second.json()["reasons"] == ["advisories_unanswered"]
    assert owner.get(f"/api/owner/cars/{car['id']}/versions").json()["versions"] == []
    assert owner.car(car["id"])["listingStatus"] == "draft"
    owner.answer_all(car["id"])
    assert owner.car(car["id"])["publishBlockers"] == []
    made = owner.publish(car["id"])
    assert made["version"] == 1 and made["listingStatus"] == "live" and made["reportSha256"]
    again = owner.post(path)
    assert again.status_code == 409 and again.json()["error"] == "no_changes"
    stale = Owner(os.environ["APP_STALE_RECORD_URL"])
    aged = stale.draft()
    stale.pull(aged["id"])
    stale.answer_all(aged["id"])
    api_until(lambda: "record_stale" in stale.car(aged["id"])["publishBlockers"], "record_stale after the limit", 45)
    assert stale.post(f"/api/owner/cars/{aged['id']}/publish").json()["reasons"] == ["record_stale"]


@pytest.mark.timeout(300)
def test_wf_publish_version_outage(browser, app_url):
    owner = Owner(app_url)
    down = Owner(os.environ["APP_GOTENBERG_DOWN_URL"])
    car = owner.draft()
    owner.pull(car["id"])
    owner.answer_all(car["id"])
    with owner_page(browser, down, f"/owner/cars/{car['id']}", PHONE) as page:
        open_section(page, "Findings")
        fill(by(page, "textbox", "Finding wording"), PART_WORDING)
        open_section(page, "Publish")
        posts = calls(page, f"/api/owner/cars/{car['id']}/publish")
        button = btn(page, "Publish")
        with held(page, "**/publish") as release:
            tap(button)
            shows(page, button)
            expect(button).to_have_attribute("aria-disabled", "true")
            button.focus()
            page.keyboard.press("Enter")
            release()
        text = "The report could not be rendered, so nothing was published."
        reads(page, notice(page), text)
        assert len(posts) == 1
        for _ in range(2):
            poll(page, "/api/owner/")
            expect(notice(page)).to_have_text(text)
        holds(page, region(page, "Car file bar"), "Draft")
        expect(by(page, "textbox", "Finding wording")).to_have_value(PART_WORDING)
    state = owner.car(car["id"])
    assert state["listingStatus"] == "draft" and state["currentVersion"] is None
    assert owner.get(f"/api/owner/cars/{car['id']}/versions").json()["versions"] == []
    assert S3().keys(f"reports/{car['id']}/") == []
    store_down = Owner(os.environ["APP_MINIO_DOWN_URL"])
    reply = store_down.post(f"/api/owner/cars/{car['id']}/publish")
    assert reply.status_code == 503 and reply.json()["error"] == "report_store_failed"
    assert owner.car(car["id"])["listingStatus"] == "draft"
    assert owner.get(f"/api/owner/cars/{car['id']}/versions").json()["versions"] == []
    assert owner.post(f"/api/owner/cars/{car['id']}/links", json={"role": "buyer", "name": "n"}).status_code == 409
    assert owner.publish(car["id"])["version"] == 1
    amend_car = owner.live()
    token = owner.link(amend_car["id"])["token"]
    finding = owner.findings(amend_car["id"])[0]
    owner.patch(f"/api/owner/cars/{amend_car['id']}/findings/{finding['id']}", json={"wording": "Unpublished"},
                headers={"If-Match": f'"{finding["revision"]}"'})
    assert down.post(f"/api/owner/cars/{amend_car['id']}/publish").status_code == 503
    assert owner.car(amend_car["id"])["listingStatus"] == "live"
    assert view(app_url, token)["version"]["number"] == 1
    assert view(app_url, token)["findings"][0]["wording"] == finding["wording"]


def test_condition_report_contents(app_url):
    owner = Owner(app_url)
    car = owner.draft()
    reading = owner.put(f"/api/owner/cars/{car['id']}/readings", json={"readings": [{"panelId": "os-sill", "microns": 428}]})
    assert reading.status_code == 200
    owner.pull(car["id"])
    owner.answer_all(car["id"])
    made = owner.publish(car["id"])
    assert owner.get(f"/api/owner/cars/{car['id']}/versions").json()["versions"][0]["reportSha256"] == made["reportSha256"]
    served = owner.get(f"/api/owner/cars/{car['id']}/report/1")
    assert served.status_code == 200 and "application/pdf" in served.headers["content-type"]
    stored = S3().get(f"reports/{car['id']}/v1.pdf")
    assert stored == served.content and hashlib.sha256(stored).hexdigest() == made["reportSha256"]
    assert pdf_pages(stored) >= 1
    text = re.sub(r"\s+", " ", pdf_text(stored))
    finding = owner.findings(car["id"])[1]
    for word in ("Condition report", car["name"], "Version 1", "T3*****", finding["title"], finding["wording"],
                 "Offside sill", "428", "Rear subframe mount slightly deteriorated", NOTE,
                 "Open advisories: 2"):
        assert word in text, word
    assert "serious" in text.lower(), "the finding's severity"
    assert re.search(r"88[,\s]?412", text), "the odometer figure"
    for private in ("T317HJN", "T317 HJN", "Larkfield", "NE46"):
        assert private not in text
    token = owner.link(car["id"])["token"]
    assert httpx.get(f"{app_url}/api/link/{token}/report", timeout=HTTP_SECONDS).content == stored


def test_listing_transitions(app_url):
    owner = Owner(app_url)
    draft = owner.new_car()
    path = f"/api/owner/cars/{draft['id']}"
    reply = owner.post(f"{path}/complete")
    assert reply.status_code == 409 and reply.json()["error"] == "illegal_transition"
    assert owner.post(f"{path}/links", json={"role": "buyer", "name": "n"}).json()["error"] == "listing_not_published"
    assert owner.post(f"{path}/withdraw").json()["listingStatus"] == "withdrawn"
    assert owner.post(f"{path}/withdraw").json()["error"] == "illegal_transition"
    assert owner.post(f"{path}/publish").json()["error"] == "illegal_transition"
    assert owner.put(f"{path}/readings", json={"readings": [{"panelId": "roof", "microns": 100}]}).json()["error"] == "listing_closed"
    assert owner.post(f"{path}/slots", json={"localStart": SLOT_A, "durationMinutes": 45}).json()["error"] == "listing_closed"
    assert owner.post(f"{path}/findings", json={"panelId": "roof", "u": 0, "v": 0, "title": "t", "wording": "w",
                                                "severity": "cosmetic", "photoId": None}).json()["error"] == "listing_closed"
    live = owner.live()
    link, offer = offering_buyer(owner, live)
    held_reply = owner.post(f"/api/owner/cars/{live['id']}/withdraw")
    assert held_reply.status_code == 409 and held_reply.json()["error"] == "offers_open"
    assert owner.get(f"/api/owner/cars/{live['id']}/handover").json()["error"] == "listing_not_sold"
    assert owner.accept(offer["id"]).status_code == 200
    assert owner.car(live["id"])["listingStatus"] == "under_offer"
    assert owner.post(f"/api/owner/cars/{live['id']}/publish").json()["error"] == "illegal_transition"
    assert owner.post(f"/api/owner/cars/{live['id']}/withdraw").json()["listingStatus"] == "withdrawn"
    assert owner.post(f"/api/owner/cars/{live['id']}/complete").json()["error"] == "illegal_transition"
    assert view(app_url, link["token"])["car"]["listingStatus"] == "withdrawn"
    assert send_offer(app_url, link["token"]).json()["error"] == "listing_closed"


def test_wf_publish_version_happy(browser, app_url):
    owner = Owner(app_url)
    car = owner.draft()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#record") as page:
        click(btn(page, "Pull test record"))
        reads(page, status(page, "Owner status"), "Test record pulled")
        area = region(page, "Advisories")
        for text in ("Rear subframe mount slightly deteriorated", "Offside rear tyre slightly perished"):
            select(by(area, "combobox", f"Response to {text}"), "monitoring")
            fill(by(area, "textbox", f"Note on {text}"), NOTE)
            save_response(page, text)
            reads(page, status(page, "Owner status"), "Response saved")
        shows(page, page.get_by_text("Nothing is blocking publish", exact=True))
        expect(by(page, "list", "Publish blockers").get_by_role("listitem")).to_have_count(0)
        live = status(page, "Owner status")
        watch(live)
        click(btn(page, "Publish"))
        reads(page, live, "Published as version 1", 40)
        assert "Rendering the report" in writes(live)
    state = owner.car(car["id"])
    assert state["listingStatus"] == "live" and state["currentVersion"] == 1
    assert state["publishedOpenAdvisories"] == state["workingOpenAdvisories"] == 2
    assert S3().keys(f"reports/{car['id']}/v1.pdf")
    token = owner.link(car["id"])["token"]
    seen = view(app_url, token)
    assert seen["version"]["number"] == 1 and len(seen["findings"]) == 3 and seen["record"]["openAdvisories"] == 2
    frozen = owner.get(f"/api/owner/cars/{car['id']}/versions/1").json()
    assert [f["id"] for f in frozen["findings"]] == [f["id"] for f in seen["findings"]]


@pytest.mark.timeout(300)
def test_wf_publish_version_hero_moves(browser, app_url):
    owner = Owner(app_url)
    car = owner.live((("bonnet", 0.5, 0.5, "cosmetic"), ("ns-door", 0.5, 0.5, "serious")))
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token, PHONE) as page:
        hero = next(f for f in view(app_url, token)["findings"] if f["id"] == view(app_url, token)["heroFindingId"])
        assert hero["panelId"] == "ns-door"
        for size in VIEWPORTS:
            page.set_viewport_size(size)
            advance(page, STEP_MS)
            flush(page)
            px, py, _ = assert_hero_lit(page, hero)
            assert_hero_uncovered(page, px, py, size is PHONE)
        with owner_page(browser, owner, f"/owner/cars/{car['id']}#findings") as desk:
            write_finding(desk, "Roof", "Worst roof", "The new worst fault", "serious")
            preview = region(desk, "Stage preview")
            soon(desk, lambda: expect(preview).to_have_attribute("data-panel", "roof", timeout=QUICK_MS))
            click(btn(desk, "Save finding"))
            reads(desk, status(desk, "Owner status"), "Finding saved")
            soon(desk, lambda: expect(preview).to_have_attribute("data-panel", "ns-door", timeout=QUICK_MS))
        owner.publish(car["id"])
        poll(page, "/api/link/")
        soon(page, lambda: expect(stage(page)).to_have_attribute("data-panel", "ns-door", timeout=QUICK_MS))
    roof_car = owner.live((("bonnet", 0.5, 0.5, "moderate"),))
    token = owner.link(roof_car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        assert stage(page).get_attribute("data-panel") == "bonnet"
        made = owner.finding(roof_car["id"], "roof", 0.5, 0.5, "serious")
        owner.publish(roof_car["id"])
        poll(page, "/api/link/")
        soon(page, lambda: expect(stage(page)).to_have_attribute("data-panel", "roof", timeout=QUICK_MS))
        advance(page, STEP_MS)
        px, py, _ = assert_hero_lit(page, made)
        assert_hero_uncovered(page, px, py)
    with buyer_page(browser, app_url, token, PHONE, no_webgl=True) as page:
        assert_pins_true(page, view(app_url, token)["findings"])
        px, py, _ = assert_hero_lit(page, made)
        assert_hero_uncovered(page, px, py, True)


@pytest.mark.timeout(300)
def test_wf_named_links_phone_copy(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    person = fresh("Named")
    with owner_page(browser, owner, f"/owner/cars/{car['id']}", PHONE) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        open_section(page, "People")
        fill(by(page, "textbox", "Person's name"), person)
        tap(by(by(page, "radiogroup", "Link type"), "radio", "Buyer"))
        tap(btn(page, "Create link"))
        area = region(page, "New link")
        shows(page, area)
        focused(page, btn(page, "Copy link"))
        reads(page, status(page, "Owner status"), f"Link ready for {person}")
        address = area.get_by_role("link").inner_text().strip()
        assert address.startswith(f"{app_url}/l/")
        poll(page, "/api/owner/")
        expect(area.get_by_role("link")).to_have_text(address)
        tap(btn(page, "Copy link"))
        reads(page, status(page, "Owner status"), "Link copied")
        assert page.evaluate("navigator.clipboard.readText()") == address
        layout(page)
        row = by(page, "table", "People").get_by_role("row").filter(has_text=person)
        holds(page, row, "Active")
        expect(row).to_contain_text(re.compile(r"\d+h \d+m \d+s left"))
        with open_app(browser, address) as other:
            shows(other, stage(other))
            assert view(app_url, address.rsplit("/", 1)[1])["name"] == person
        tap(btn(row, "Replace"))
        reads(page, status(page, "Owner status"), "Link replaced")
        new_address = area.get_by_role("link").inner_text().strip()
        assert new_address != address
    assert httpx.get(f"{app_url}/api/link/{address.rsplit('/', 1)[1]}").json()["error"] == "link_not_found"
    assert view(app_url, new_address.rsplit("/", 1)[1])["name"] == person


@pytest.mark.timeout(300)
def test_wf_named_links_expiry_clock(browser):
    base = os.environ["APP_SHORT_LINKS_URL"]
    owner = Owner(base)
    car = owner.live()
    person = fresh("Timed")
    link = owner.link(car["id"], "buyer", person)
    assert 0 < link["secondsRemaining"] <= 45
    now = datetime.fromisoformat(view(base, link["token"])["serverNow"].replace("Z", "+00:00"))
    for shift in (timedelta(days=365), timedelta(days=-1)):
        with at(browser, base, "/api/health", DESKTOP, owner.cookie) as page:
            page.clock.set_system_time(now + shift)
            page.goto(f"{base}/owner/cars/{car['id']}#people")
            row = by(page, "table", "People").get_by_role("row").filter(has_text=person)
            holds(page, row, "Active")
            text = soon(page, lambda: _time_left(row))
            assert 0 < text <= 45, text
    expired = api_until(lambda: httpx.get(f"{base}/api/link/{link['token']}").status_code == 410, "the link expired", 60)
    assert expired
    reply = httpx.get(f"{base}/api/link/{link['token']}")
    assert reply.json()["error"] == "link_expired"
    row = next(item for item in owner.links(car["id"]) if item["id"] == link["id"])
    assert row["status"] == "expired" and row["secondsRemaining"] == 0
    renewed = owner.post(f"/api/owner/links/{link['id']}/renew").json()
    assert renewed["status"] == "active" and renewed["secondsRemaining"] > 0 and "token" not in renewed
    assert view(base, link["token"])["status"] == "active"
    swapped = owner.post(f"/api/owner/links/{link['id']}/replace").json()
    assert swapped["token"] != link["token"] and swapped["path"] == f"/l/{swapped['token']}"
    assert httpx.get(f"{base}/api/link/{link['token']}").json()["error"] == "link_not_found"
    assert owner.post(f"/api/owner/links/{link['id']}/revoke").json()["status"] == "revoked"
    gone_reply = httpx.get(f"{base}/api/link/{swapped['token']}")
    assert gone_reply.status_code == 410 and gone_reply.json()["error"] == "link_revoked"
    assert httpx.get(f"{base}/api/link/{swapped['token']}/report").status_code == 410
    assert owner.post(f"/api/owner/links/{link['id']}/renew").json()["error"] == "link_revoked"
    assert owner.post(f"/api/owner/links/{link['id']}/replace").json()["error"] == "link_revoked"
    assert owner.post(f"/api/owner/links/{link['id']}/revoke").json()["error"] == "link_already_ended"


def _time_left(row) -> int:
    match = re.search(r"(\d+)h (\d+)m (\d+)s left", row.inner_text())
    assert match, row.inner_text()
    hours, minutes, seconds = (int(n) for n in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def test_link_scope(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    other_car = owner.live()
    rival_name = fresh("Rival")
    buyer = owner.link(car["id"], "buyer", fresh("Solo"))
    rival, _ = offering_buyer(owner, car, rival_name, SECOND_OFFER)
    inspector_name = fresh("Inspector")
    inspector = owner.link(car["id"], "inspector", inspector_name)
    slot = owner.slot(other_car["id"])
    token = buyer["token"]
    assert len(token) >= 22 and buyer["path"] == f"/l/{token}"
    assert httpx.get(f"{app_url}/api/link/unknown-token-value").json()["error"] == "link_not_found"
    assert claim(app_url, token, slot["id"]).status_code == 404
    item = {"clientId": str(uuid.uuid4()), "kind": "reading", "panelId": "roof", "microns": 431, "capturedAt": "2026-11-05T10:00:00.000Z"}
    wrong = post_json(app_url, f"/api/link/{token}/capture", {"batchId": str(uuid.uuid4()), "items": [item]})
    assert wrong.status_code == 403 and wrong.json()["error"] == "wrong_role"
    assert post_json(app_url, f"/api/link/{inspector['token']}/capture",
                     {"batchId": str(uuid.uuid4()), "items": [item]}).json()["results"][0]["state"] == "applied"
    first = view(app_url, token)["findings"][0]["id"]
    assert see(app_url, inspector["token"], first).json()["error"] == "wrong_role"
    assert send_offer(app_url, inspector["token"]).json()["error"] == "wrong_role"
    data = view(app_url, token)
    text = json.dumps(data)
    for private in ("T317HJN", "Larkfield", rival_name, inspector_name, str(SECOND_OFFER), "homeAddress"):
        assert private not in text, private
    assert data["name"] == buyer["name"] and data["car"]["maskedRegistration"] == "T3*****"
    roof = next(p for p in data["panels"] if p["id"] == "roof")
    assert roof["inspector"][0]["microns"] == 431 and "name" not in roof["inspector"][0]
    inspected = view(app_url, inspector["token"])
    assert set(inspected) == {"role", "name", "status", "expiresAt", "serverNow", "car", "panels"}
    assert rival_name not in json.dumps(inspected) and buyer["name"] not in json.dumps(inspected)
    with buyer_page(browser, app_url, token) as page:
        html = page.content()
        for private in ("T317HJN", "Larkfield", rival_name):
            assert private not in html
    assert rival["id"] != buyer["id"]


@pytest.mark.timeout(300)
def test_wf_named_links_revoke_open_tab(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    holder, offer = offering_buyer(owner, car)
    second = owner.link(car["id"])
    slot = owner.slot(car["id"])
    assert claim(app_url, holder["token"], slot["id"]).status_code == 201
    other = owner.link(car["id"])
    read_all(app_url, other["token"])
    with buyer_page(browser, app_url, other["token"], PHONE) as page:
        tap(btn(page, "Menu"))
        shows(page, dialog(page, "Menu"))
        tap(btn(dialog(page, "Menu"), "Close"))
        open_offer_dialog(page)
        fill(by(page, "spinbutton", "Offer in pounds"), str(OFFER))
        assert owner.post(f"/api/owner/links/{other['id']}/revoke").status_code == 200
        poll(page, "/api/link/")
        shows(page, heading(page, "This link has ended"))
        holds(page, page.locator("body"), "Ask the owner for a new link.")
        expect(dialog(page, "Make an offer")).to_have_count(0)
        layout(page)
    assert owner.post(f"/api/owner/links/{holder['id']}/revoke").status_code == 200
    assert next(s for s in owner.slots(car["id"]) if s["id"] == slot["id"])["holderName"] is None
    assert owner.car(car["id"])["standing"]["slotsHeld"] == 0
    assert claim(app_url, second["token"], slot["id"]).status_code == 201
    kept = next(o for o in owner.offers(car["id"]) if o["id"] == offer["id"])
    assert kept["status"] == "open" and kept["lapsesAt"] == offer["lapsesAt"]
    assert owner.accept(offer["id"]).status_code == 200


@pytest.mark.timeout(300)
def test_wf_named_links_still_revocation(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    link = owner.link(car["id"])
    with buyer_page(browser, app_url, link["token"], no_webgl=True) as page:
        expect(stage(page)).to_have_attribute("data-renderer", "svg")
        expect(by(stage(page), "img", f"Facet still of {car['name']}")).to_be_visible()
        expect(stage(page).locator("canvas")).to_have_count(0)
        for done in (1, 2, 3):
            pill = btn(page, "I've read this").first
            pill.focus()
            page.keyboard.press("Enter")
            reads(page, status(page, "Seen count"), f"{done} of 3 seen")
        assert view(app_url, link["token"])["progress"]["seen"] == 3
        owner.post(f"/api/owner/links/{link['id']}/revoke")
        poll(page, "/api/link/")
        shows(page, heading(page, "This link has ended"))


def test_buyer_page_sections(browser, app_url):
    with buyer_page(browser, app_url, ROWAN) as page:
        order = [btn(page, "Units: microns"), by(page, "navigation", "Car file"), stage(page),
                 by(page, "list", "Your walkround record"),
                 heading(page, "Viewings"), region(page, "Offer"), region(page, "Owner story"),
                 by(page, "img", "Road terrain"), page.get_by_role("contentinfo")]
        tops = [loc.evaluate("e => e.getBoundingClientRect().top + window.scrollY") for loc in order]
        sections = tops[:1] + tops[2:]
        assert sections == sorted(sections), tops
        assert tops[0] <= tops[1] < tops[3], tops
        for card in (region(page, "Test record"), region(page, "Gauge readings")):
            place = card.evaluate("e => e.getBoundingClientRect().top + window.scrollY")
            assert tops[3] < place < tops[4], "the record block sits between the staircase and Viewings"
        expect(status(page, "Seen count")).to_have_count(1)
        assert stage(page).evaluate("""(e, s) => { const a = e.getBoundingClientRect(), b = s.getBoundingClientRect();
            return b.left < a.right && a.left < b.right && b.top < a.bottom && a.top < b.bottom; }""",
                                   status(page, "Seen count").element_handle()), "the seen count sits on the stage"
        items = by(page, "list", "Your walkround record").get_by_role("listitem")
        expect(items).to_have_count(9)
        expect(by(page, "article", "Finding 4: Sill filler")).to_have_attribute("data-seen", "false")
        expect(by(page, "article", "Finding 4: Sill filler")).to_contain_text("Filler in the rear third of the sill")
        holds(page, page.locator("body"), re.compile(r"71[,\s]?240"))
        assert "S4*****" in json.dumps(view(app_url, ROWAN))
        expect(by(page, "link", "Download condition report")).to_have_count(1)
        expect(by(page, "list", "Viewing slots")).to_be_visible()
        click(by(by(page, "navigation", "Car file"), "link", "Walkround"))
        intro = soon(page, lambda: _intro_heading(page))
        assert intro["text"] > 0, "walkround chapter intro has a heading"
        assert abs(intro["centre"] - intro["width"] / 2) <= 0.05 * intro["width"], intro
        assert intro["size"] >= 2 * intro["body"], intro
        cards_top = by(page, "list", "Your walkround record").evaluate("e => e.getBoundingClientRect().top + scrollY")
        assert intro["top"] < cards_top, "walkround chapter intro sits before the cards"
        for private in ("S482KVT", "S482 KVT", "Larkfield"):
            assert private not in page.content()


def _intro_heading(page) -> dict:
    data = page.evaluate(INTRO_JS)
    assert data["heading"], data
    return data


def test_seed_components_buyer_page(browser, app_url):
    with buyer_page(browser, app_url, ROWAN) as page:
        test_card, gauge_card = region(page, "Test record"), region(page, "Gauge readings")
        first, second = test_card.bounding_box(), gauge_card.bounding_box()
        assert second["y"] > first["y"] or second["x"] != first["x"]
        expect(test_card.get_by_role("link")).not_to_have_count(0)
        expect(gauge_card.get_by_role("link")).not_to_have_count(0)
        for plate in (test_card, gauge_card):
            assert plate.get_by_role("link").evaluate_all(UNDERLINED_JS), "pill and underline actions: the card link is underlined"
        band = region(page, "Offer").bounding_box()
        assert band["x"] <= 0 and band["width"] >= DESKTOP["width"] - 1, "offer overhang band is full bleed"
        expect(heading(region(page, "Offer"), "Your offer")).to_be_visible()
        story = region(page, "Owner story")
        holds(page, story, "Twenty-two years")
        assert story.bounding_box()["x"] > 0, "owner story panel is inset"
        assert radius(story) > 0, "owner story panel has a large radius"
        terrain = by(page, "img", "Road terrain")
        rect = terrain.bounding_box()
        assert rect["x"] <= 0 and rect["width"] >= DESKTOP["width"] - 1, "procedural road terrain band is edge to edge"
        assert radius(terrain) == 0, "procedural road terrain band has no rounded corners"
        click(by(story, "link", "Go to the offer"))
        focused(page, heading(page, "Your offer"))
        pill = btn(page, "I've read this").first
        rest, hover = state_styles(pill, "background-color", "color", state="hover")
        assert rest != hover, "pill and underline actions: a pill changes colour on hover"
        assert radius(pill) >= pill.bounding_box()["height"] / 2 - 1, "pill and underline actions: the read control is a pill"
        text_link = test_card.get_by_role("link").last
        rest, hover = state_styles(text_link, "color", "background-color", state="hover")
        assert rest != hover, "pill and underline actions: a text link changes colour on hover"
        card = by(page, "article", "Finding 1: Stone chips")
        assert radius(card) > 0, "staircase finding cards have a large radius"
        expect(card.get_by_role("img")).not_to_have_count(0)


def test_hero_vertex_frames(browser, app_url):
    with buyer_page(browser, app_url, ROWAN) as page:
        data = view(app_url, ROWAN)
        hero = next(f for f in data["findings"] if f["id"] == data["heroFindingId"])
        assert hero["title"] == "Sill filler"
        area = attrs(stage(page))
        assert area["data-panel"] == "os-sill" and area["data-beat"] == "0"
        px, py, _ = assert_hero_lit(page, hero)
        assert_hero_uncovered(page, px, py)
        summary = region(page, "Asking summary")
        for text in (SEED_CAR, "9 findings", "£16,950"):
            holds(page, summary, text)
        big = heading(page, "WALK ROUND IT FIRST").bounding_box()
        small = page.get_by_text("THEN MAKE YOUR OFFER", exact=True).bounding_box()
        assert big["x"] < DESKTOP["width"] / 2 and small["x"] + small["width"] / 2 > DESKTOP["width"] / 2
        assert float(style(heading(page, "WALK ROUND IT FIRST"), "font-size")["font-size"][:-2]) > \
            float(style(page.get_by_text("THEN MAKE YOUR OFFER", exact=True), "font-size")["font-size"][:-2])
        page.set_viewport_size(PHONE)
        advance(page, STEP_MS)
        flush(page)
        assert page.get_by_text("THEN MAKE YOUR OFFER", exact=True).bounding_box()["y"] < \
            heading(page, "WALK ROUND IT FIRST").bounding_box()["y"]
        rect = summary.bounding_box()
        assert rect["x"] >= 0 and rect["x"] + rect["width"] <= PHONE["width"]
        px, py, _ = assert_hero_lit(page, hero)
        assert_hero_uncovered(page, px, py, True)


def test_panel_hand_off_scrub(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        rest = attrs(stage(page))
        go(page, 400)
        hold = attrs(stage(page))
        assert hold["data-beat"] == "0" and float(hold["data-rim-glow"]) == 0 and float(hold["data-card-travel"]) == 0
        assert hold["data-camera-position"] == rest["data-camera-position"]
        table = [(0.0, 0, 0), (0.2, 0.5, 0), (0.4, 1, 0), (0.6, 1, 0), (0.8, 1, 0.5), (0.95, 1, 0.875)]
        forward, angles = [], []
        for beat in (1, 2):
            for fraction, glow, travel in table:
                go(page, BEAT * (beat + fraction), beat)
                data = attrs(stage(page))
                assert abs(float(data["data-beat-progress"]) - fraction) <= 0.02, data
                assert abs(float(data["data-rim-glow"]) - glow) <= 0.04, data
                assert abs(float(data["data-card-travel"]) - travel) <= 0.04, data
                assert stage(page).bounding_box()["y"] == 0
                forward.append((beat, fraction, data["data-camera-angle"], data["data-rim-glow"]))
                angles.append(float(data["data-camera-angle"]))
        assert all(b >= a for a, b in zip(angles, angles[1:])) and angles[-1] > angles[0]
        seen = view(app_url, token)["progress"]["seen"]
        for beat, fraction, angle, glow in reversed(forward):
            go(page, BEAT * (beat + fraction), beat)
            data = attrs(stage(page))
            assert (data["data-camera-angle"], data["data-rim-glow"]) == (angle, glow)
        assert view(app_url, token)["progress"]["seen"] == seen
        go(page, 0, 0)
        expect(heading(page, "WALK ROUND IT FIRST")).to_be_visible()
        go(page, BEAT * 4 + DESKTOP["height"] + 200)
        assert stage(page).bounding_box()["y"] < 0, "the pin releases after the last beat"


def test_wf_buyer_walkround_scroll_writes(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    ids = [f["id"] for f in view(app_url, token)["findings"]]
    with buyer_page(browser, app_url, token) as page:
        posts = calls(page, "/seen")
        reads(page, status(page, "Seen count"), "0 of 3 seen")
        page.mouse.move(640, 400)
        for _ in range(6):
            page.mouse.wheel(0, BEAT / 2 + 1)
            flush(page)
        reads(page, status(page, "Seen count"), "2 of 3 seen")
        page.mouse.wheel(0, BEAT)
        flush(page)
        reads(page, status(page, "Seen count"), "3 of 3 seen")
        assert [json.loads(p.post_data)["findingId"] for p in posts] == ids
        before = view(app_url, token)
        assert all(f["seenAt"] for f in before["findings"])
        go(page, 0)
        go(page, BEAT * 3, 3)
        flush(page)
        assert len(posts) == 3
        page.reload()
        until(page, "() => window.scrollY === 0")
        reads(page, status(page, "Seen count"), "3 of 3 seen")
    repeat = see(app_url, token, ids[0])
    assert repeat.status_code == 200 and repeat.json()["seenAt"] == before["findings"][0]["seenAt"]
    assert post_json(app_url, f"/api/link/{token}/seen", {"findingId": str(uuid.uuid4())}).status_code == 404


def test_wf_buyer_walkround_keyboard_pills(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        pills = btn(page, "I've read this")
        expect(pills).to_have_count(3)
        posts = calls(page, "/seen")
        for _ in range(40):
            page.keyboard.press("Tab")
            if page.evaluate("document.activeElement.textContent.trim()") == "I've read this":
                break
        else:
            pytest.fail("Tab never reached an I've read this pill")
        expect(pills.first).to_be_focused()
        reads(page, status(page, "Seen count"), "0 of 3 seen")
        assert posts == []
        rect = page.evaluate("(() => { const r = document.activeElement.getBoundingClientRect(); return [r.top, r.bottom]; })()")
        assert 0 <= rect[0] and rect[1] <= DESKTOP["height"]
        page.keyboard.press("Enter")
        reads(page, status(page, "Seen count"), "1 of 3 seen")
        focused(page, pills.first)
        page.keyboard.press("Space")
        reads(page, status(page, "Seen count"), "2 of 3 seen")
        focused(page, pills.first)
        page.keyboard.press("Enter")
        reads(page, status(page, "Seen count"), "3 of 3 seen")
        focused(page, btn(page, "Make an offer"))
        assert len(posts) == 3
        article = page.get_by_role("article").first
        expect(article).to_have_attribute("data-seen", "true")
        expect(article).to_contain_text(re.compile(r"Seen \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}"))
    assert view(app_url, token)["progress"] == {"seen": 3, "total": 3, "materialUnseen": 0}


def test_still_stage_no_webgl_and_reduced(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token, reduced_motion="reduce") as page:
        area = stage(page)
        rest = attrs(area)
        assert rest["data-mode"] == "still" and rest["data-beat"] == "0" and rest["data-panel"] == "os-sill"
        assert float(rest["data-rim-glow"]) == 0 and float(rest["data-card-travel"]) == 0
        posts = calls(page, "/seen")
        top = page.evaluate("document.documentElement.scrollHeight")
        go(page, top // 2)
        data = attrs(area)
        for key in ("data-beat", "data-camera-position", "data-view-projection", "data-frame-count"):
            assert data[key] == rest[key], key
        assert posts == []
        for card in page.get_by_role("article").all():
            assert float(style(card, "opacity")["opacity"]) == 1
    with buyer_page(browser, app_url, token, no_webgl=True) as page:
        area = stage(page)
        data = attrs(area)
        assert data["data-renderer"] == "svg" and data["data-mode"] == "still" and data["data-beat"] == "0"
        expect(by(area, "img", f"Facet still of {car['name']}")).to_be_visible()
        posts = calls(page, "/seen")
        go(page, BEAT * 2)
        assert posts == []
        click(btn(page, "I've read this").first)
        reads(page, status(page, "Seen count"), "1 of 3 seen")


def test_touch_walkround(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token, PHONE) as page:
        resting = {"y": None}

        def at_rest():
            y, last = page.evaluate("window.scrollY"), resting["y"]
            resting["y"] = y
            flush(page)
            return y == last
        pill = btn(page, "I've read this").first
        pill.focus()
        api_until(at_rest, "the page came to rest with the pill in view", 10)
        rect = pill.bounding_box()
        assert rect["height"] >= TARGET
        assert 0 <= rect["y"] and rect["y"] + rect["height"] <= PHONE["height"], f"the focused pill is not in view: {rect}"
        pending = view(app_url, token)["progress"]["seen"]
        touch_tap(page, rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2)
        api_until(lambda: view(app_url, token)["progress"]["seen"] > pending, "a tap on the pill wrote a record", 15)
        reads(page, status(page, "Seen count"), "1 of 3 seen")
        resting["y"] = None
        api_until(at_rest, "the page came to rest after the pill moved focus", 10)
        go(page, 0)
        flush(page)
        before = view(app_url, token)["progress"]["seen"]
        posts = calls(page, "/seen")
        for _ in range(10):
            if page.evaluate("window.scrollY") > BEAT * 2.6 + 8:
                break
            swipe(page, BEAT)
            flush(page)
        api_until(lambda: len(posts) >= 1 and view(app_url, token)["progress"]["seen"] == before + len(posts),
                  "each seen write the swipe sent was stored once", 15)
        count = view(app_url, token)["progress"]["seen"]
        soon(page, lambda: expect(status(page, "Seen count")).to_have_text(f"{count} of 3 seen", timeout=QUICK_MS))


def test_staircase_widths(browser, app_url):
    with buyer_page(browser, app_url, ROWAN) as page:
        cards = page.get_by_role("article")
        for width, height, columns in ((767, 812, 1), (768, 1024, 2), (1199, 800, 2), (1200, 800, 3), (1280, 800, 3)):
            page.set_viewport_size({"width": width, "height": height})
            flush(page)
            boxes = [c.evaluate("e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), r.top + scrollY, r.bottom + scrollY]; }")
                     for c in cards.all()]
            lefts = sorted({b[0] for b in boxes})
            assert len(lefts) == columns, (width, lefts)
            if columns > 1:
                starts = [min(b[1] for b in boxes if b[0] == left) for left in lefts]
                assert all(b > a for a, b in zip(starts, starts[1:])), (width, starts)
        band_top = region(page, "Offer").evaluate("e => e.getBoundingClientRect().top + scrollY")
        assert max(b[2] for b in boxes) > band_top, "the last cards overhang the offer band"
        card = by(page, "article", "Finding 1: Stone chips")
        assert style(card, "background-color")["background-color"] in ("rgb(255, 255, 255)", "rgba(255, 255, 255, 1)")


def test_wf_buyer_walkround_complete(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        for k in (1, 2, 3):
            go(page, BEAT * (k + 0.7), k)
        reads(page, status(page, "Seen count"), "3 of 3 seen")
        for card in page.get_by_role("article").all():
            expect(card).to_have_attribute("data-seen", "true")
            expect(card).to_contain_text("Seen ")
        expect(btn(page, "I've read this")).to_have_count(0)
        btn(page, "Make an offer").scroll_into_view_if_needed()
        expect(btn(page, "Make an offer")).to_be_in_viewport()
    assert view(app_url, token)["progress"]["materialUnseen"] == 0
    assert next(l for l in owner.links(car["id"]) if l["seen"] == 3)["total"] == 3


def test_stage_geometry(browser, app_url):
    owner = Owner(app_url)
    car = owner.live(tuple((p, 0.5, 0.5, "moderate") for p in FRAMES))
    token = owner.link(car["id"])["token"]
    findings = view(app_url, token)["findings"]
    with buyer_page(browser, app_url, token) as page:
        for size in VIEWPORTS:
            page.set_viewport_size(size)
            for finding in findings[::3]:
                beat = finding["position"]
                go(page, BEAT * (beat + 0.5), beat)
                data = attrs(stage(page))
                assert data["data-panel"] == finding["panelId"]
                x, y, z = (float(n) for n in data["data-camera-position"].split(","))
                azimuth = math.degrees(math.atan2(x, -z)) % 360
                delta = abs(azimuth - float(data["data-camera-angle"]) % 360)
                assert min(delta, 360 - delta) < 1, (azimuth, data["data-camera-angle"])
                box = surface(page).bounding_box()
                px, py, depth = project(data, world(finding["panelId"], 0.5, 0.5), box)
                assert depth > 0 and box["x"] <= px <= box["x"] + box["width"], finding["panelId"]
                assert box["y"] <= py <= box["y"] + box["height"], finding["panelId"]
        go(page, 0, 0)
        draws = scene_frames(surface(page), 2, 100)
        assert draws[-1]["draws"] or draws[0]["draws"], "a real WebGL scene is drawn"
        assert decode(capture(surface(page))).variance() > 0


def test_walkround_lost_context(browser, app_url):
    owner = Owner(app_url)
    car = owner.live((("bonnet", 0.5, 0.5, "cosmetic"), ("os-door", 0.5, 0.5, "moderate"), ("os-sill", 0.5, 0.5, "serious"),
                      ("roof", 0.5, 0.5, "cosmetic")))
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        go(page, BEAT * 3.3, 3)
        reads(page, status(page, "Seen count"), "2 of 4 seen")
        posts = calls(page, "/seen")
        stage(page).locator("canvas").evaluate("c => c.dispatchEvent(new Event('webglcontextlost', {cancelable: true}))")
        advance(page, LOST_CONTEXT_MS)
        soon(page, lambda: expect(stage(page)).to_have_attribute("data-renderer", "svg", timeout=QUICK_MS), 5)
        data = attrs(stage(page))
        assert data["data-mode"] == "still" and data["data-beat"] == "0" and data["data-panel"] == "os-sill"
        advance(page, 3000)
        flush(page)
        assert posts == []
        reads(page, status(page, "Seen count"), "2 of 4 seen")
        assert_pins_true(page, view(app_url, token)["findings"])
        for done in (3, 4):
            btn(page, "I've read this").first.focus()
            page.keyboard.press("Enter")
            reads(page, status(page, "Seen count"), f"{done} of 4 seen")
    assert view(app_url, token)["progress"]["seen"] == 4


def test_deliberate_jumps_write_nothing(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        posts = calls(page, "/seen")
        nav = by(page, "navigation", "Car file")
        click(by(nav, "link", "Offer"))
        focused(page, heading(page, "Your offer"))
        click(by(nav, "link", "Viewings"))
        focused(page, heading(page, "Viewings"))
        click(by(nav, "link", "Record"))
        click(by(nav, "link", "Walkround"))
        btn(page, "I've read this").first.focus()
        flush(page)
        page.goto(f"{app_url}/l/{token}#offer")
        until(page, "() => window.scrollY === 0")
        page.set_viewport_size(PHONE)
        click(btn(page, "Next unread"))
        holds(page, status(page, "Walkround status"), "Finding 1 of 3")
        until(page, "beat => Math.abs(window.scrollY - beat) < 2", BEAT)
        click(btn(page, "Menu"))
        shows(page, dialog(page, "Menu"))
        click(by(dialog(page, "Menu"), "link", "Offer"))
        flush(page)
        page.reload()
        until(page, "() => window.scrollY === 0")
        flush(page)
        assert posts == []
        reads(page, status(page, "Seen count"), "0 of 3 seen")
    assert view(app_url, token)["progress"]["seen"] == 0


def test_wf_buyer_walkround_failed_write(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        page.route("**/seen", lambda route: route.abort())
        posts = calls(page, "/seen")
        go(page, BEAT * 1.7, 1)
        reads(page, status(page, "Walkround status"), "That could not be saved. Try again.")
        reads(page, status(page, "Seen count"), "0 of 3 seen")
        expect(page.get_by_role("article").first).to_have_attribute("data-seen", "false")
        page.unroute("**/seen")
        advance(page, POLL_MS)
        reads(page, status(page, "Seen count"), "1 of 3 seen", 20)
        assert view(app_url, token)["progress"]["seen"] == 1
        posts.clear()
        with held(page, "**/seen") as release:
            pill = btn(page, "I've read this").first
            pill.focus()
            page.keyboard.press("Enter")
            expect(pill).to_have_attribute("aria-disabled", "true")
            expect(pill).to_be_focused()
            page.keyboard.press("Enter")
            go(page, BEAT * 2.7, 2)
            reads(page, status(page, "Seen count"), "1 of 3 seen")
            assert len(posts) == 1
            release()
        reads(page, status(page, "Seen count"), "2 of 3 seen")
        assert len(posts) == 1


def test_lit_panel(browser, app_url):
    owner = Owner(app_url)
    car = owner.live((("os-door", 0.5, 0.5, "moderate"), ("os-sill", 0.72, 0.4, "serious")))
    token = owner.link(car["id"])["token"]
    findings = view(app_url, token)["findings"]
    with buyer_page(browser, app_url, token) as page:
        go(page, BEAT * 1.5, 1)
        data = attrs(stage(page))
        canvas = surface(page)
        box = canvas.bounding_box()
        current = data["data-panel"]
        markers = [project(data, world(f["panelId"], f["u"], f["v"]), box)[:2] for f in findings]

        def mids(panel):
            o, u, v = FRAMES[panel]
            ends = [(0, 0), (1, 0), (1, 1), (0, 1)]
            pts = []
            for (a, b), (c, d) in zip(ends, ends[1:] + ends[:1]):
                s, t = (a + c) / 2, (b + d) / 2
                pts.append(tuple(o[i] + s * u[i] + t * v[i] for i in range(3)))
            return pts

        def to_frame(point):
            o, u, v = FRAMES[current]
            rel = [point[i] - o[i] for i in range(3)]
            uu, vv = sum(c * c for c in u), sum(c * c for c in v)
            s = min(1, max(0, sum(rel[i] * u[i] for i in range(3)) / uu))
            t = min(1, max(0, sum(rel[i] * v[i] for i in range(3)) / vv))
            return sum((rel[i] - s * u[i] - t * v[i]) ** 2 for i in range(3)) ** 0.5

        def patch_points(panel):
            out = []
            for point in mids(panel):
                px, py, depth = project(data, point, box)
                inside = depth > 0 and box["x"] <= px <= box["x"] + box["width"] and box["y"] <= py <= box["y"] + box["height"]
                clear = all(((px - mx) ** 2 + (py - my) ** 2) ** 0.5 > MARKER_CLEAR for mx, my in markers)
                if inside and clear and (panel == current or to_frame(point) > 0.05):
                    out.append([px - box["x"], py - box["y"], LIT_PATCH])
            return out

        own = patch_points(current)
        rest = [p for panel in FRAMES if panel != current for p in patch_points(panel)]
        assert own, "no clear frame-edge midpoint of the current panel"
        stats = lum(canvas, own + rest)
        best = max(stats["means"][: len(own)])
        assert best >= 2 * stats["median"], stats
        assert all(best > other for other in stats["means"][len(own):]), stats


def test_marker_tap(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    findings = view(app_url, token)["findings"]
    with buyer_page(browser, app_url, token) as page:
        posts = calls(page, "/seen")
        data = attrs(stage(page))
        box = surface(page).bounding_box()
        places = [(f, project(data, world(f["panelId"], f["u"], f["v"]), box)) for f in findings]
        target, (px, py, _) = next((f, p) for f, p in places
                                   if box["x"] + 30 < p[0] < box["x"] + box["width"] - 30 and box["y"] + 30 < p[1] < box["y"] + box["height"] - 30)
        page.mouse.click(px + 8, py + 8)
        holds(page, status(page, "Walkround status"), f"Finding {target['position']} of 3")
        until(page, "y => Math.abs(window.scrollY - y) < 2", BEAT * target["position"], seconds=10)
        flush(page)
        assert posts == []
        reads(page, status(page, "Seen count"), "0 of 3 seen")
    with buyer_page(browser, app_url, token, PHONE) as page:
        posts = calls(page, "/seen")
        live = status(page, "Walkround status")
        watch(live)
        data = attrs(stage(page))
        box = surface(page).bounding_box()
        px, py, _ = project(data, world("os-sill", 0.72, 0.4), box)
        touch_drag(page, px, py, px, py - 120)
        flush(page)
        assert page.evaluate("window.scrollY") > 0, "the swipe from the canvas scrolled the page"
        assert writes(live) == []
        assert posts == []


def test_true_still_pins(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token, no_webgl=True) as page:
        for size in VIEWPORTS:
            page.set_viewport_size(size)
            flush(page)
            assert_pins_true(page, view(app_url, token)["findings"])
        first = view(app_url, token)["findings"][0]
        pin = stage(page).locator(f'[data-finding-id="{first["id"]}"]')
        expect(pin).to_have_attribute("data-seen", "false")
        click(btn(page, "I've read this").first)
        reads(page, status(page, "Seen count"), "1 of 3 seen")
        soon(page, lambda: expect(pin).to_have_attribute("data-seen", "true", timeout=QUICK_MS))
        moved = owner.finding(car["id"], "ns-door", 0.5, 0.5, "serious")
        owner.patch(f"/api/owner/cars/{car['id']}/findings/{owner.findings(car['id'])[1]['id']}", json={"severity": "cosmetic"},
                    headers={"If-Match": f'"{owner.findings(car["id"])[1]["revision"]}"'})
        owner.publish(car["id"])
        poll(page, "/api/link/")
        soon(page, lambda: expect(stage(page)).to_have_attribute("data-panel", moved["panelId"], timeout=QUICK_MS))
        flush(page)
        assert_pins_true(page, view(app_url, token)["findings"])


def test_wf_viewing_claim_dst(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    path = f"/api/owner/cars/{car['id']}/slots"
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#viewings") as page:
        cdp = session(page)
        cdp.send("Emulation.setTimezoneOverride", {"timezoneId": DEVICE_ZONE})
        fill(by(page, "textbox", "Viewing date and time"), MISSING_HOUR)
        fill(by(page, "spinbutton", "Viewing length in minutes"), "45")
        click(btn(page, "Add viewing slot"))
        holds(page, page.locator("body"), "That time does not exist in London on that date")
        fill(by(page, "textbox", "Viewing date and time"), DOUBLE_HOUR)
        click(btn(page, "Add viewing slot"))
        reads(page, status(page, "Owner status"), "Viewing slot added")
    first = next(s for s in owner.slots(car["id"]) if s["localStart"].startswith(DOUBLE_HOUR))
    assert first["zone"] == "BST" and naive_utc(first["startsAt"]) == datetime.fromisoformat(DOUBLE_HOUR) - timedelta(hours=1)
    second = owner.slot(car["id"], AFTER_CHANGE)
    assert second["zone"] == "GMT" and naive_utc(second["startsAt"]) == datetime.fromisoformat(AFTER_CHANGE)
    assert second["label"] == datetime.fromisoformat(AFTER_CHANGE).strftime(LABEL_FORMAT) + " GMT"
    assert owner.post(path, json={"localStart": PAST_START, "durationMinutes": 45}).json()["errors"]["localStart"] == "Choose a time in the future"
    for minutes in (TOO_SHORT_SLOT, TOO_LONG_SLOT):
        assert "durationMinutes" in owner.post(path, json={"localStart": SLOT_A, "durationMinutes": minutes}).json()["errors"]
    assert owner.post(path, json={"localStart": SLOT_A, "durationMinutes": LONGEST_SLOT}).status_code == 201
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token, PHONE) as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": DEVICE_ZONE})
        page.reload()
        claim_button = btn(page, f"Claim {second['label']}")
        shows(page, claim_button)
        tap(claim_button)
        shows(page, dialog(page, "Claim viewing"))
        tap(btn(dialog(page, "Claim viewing"), "Confirm viewing"))
        shows(page, btn(page, f"Release {second['label']}"))
        holds(page, region(page, "Walkround dock"), f"Viewing {second['label']}")


def test_one_slot_holder(ntfy, app_url):
    owner = Owner(app_url)
    car = owner.live()
    slot = owner.slot(car["id"])
    buyers = [owner.link(car["id"]) for _ in range(5)]
    before = topic_count(ntfy, "New viewing claim")
    with ThreadPoolExecutor(5) as pool:
        replies = list(pool.map(lambda link: claim(app_url, link["token"], slot["id"]), buyers))
    codes = sorted(r.status_code for r in replies)
    assert codes == [201, 409, 409, 409, 409]
    assert all(r.json()["error"] == "slot_taken" for r in replies if r.status_code == 409)
    winner = buyers[[r.status_code for r in replies].index(201)]
    body = next(r for r in replies if r.status_code == 201).json()
    assert body["held"] is True and body["heldByYou"] is True
    assert api_until(lambda: [a for a in owner.alerts(car["id"]) if a["state"] == "delivered"], "the claim alert delivered")
    assert topic_count(ntfy, "New viewing claim") == before + 1
    second = owner.slot(car["id"], SLOT_B)
    key = idempotency_key()
    first = claim(app_url, winner["token"], second["id"], key)
    assert first.status_code == 409 and first.json()["error"] == "already_holding_slot"
    third = owner.slot(car["id"], SLOT_C)
    other = next(b for b in buyers if b is not winner)
    key = idempotency_key()
    won = claim(app_url, other["token"], third["id"], key)
    again = claim(app_url, other["token"], third["id"], key)
    assert won.status_code == 201 and again.status_code == 201 and again.json() == won.json()
    assert len(owner.alerts(car["id"])) == 2
    mismatch = post_json(app_url, f"/api/link/{other['token']}/slots/{second['id']}/claim", {}, key)
    assert mismatch.status_code == 409 and mismatch.json()["error"] == "idempotency_conflict"
    missing = post_json(app_url, f"/api/link/{other['token']}/slots/{second['id']}/claim", {})
    assert missing.status_code == 422 and "Idempotency-Key" in missing.json()["errors"]
    refused = post_json(app_url, f"/api/link/{winner['token']}/slots/{third['id']}/release", {})
    assert refused.status_code == 403 and refused.json()["error"] == "not_slot_holder"
    assert owner.delete(f"/api/owner/cars/{car['id']}/slots/{third['id']}").json()["error"] == "slot_held"
    assert post_json(app_url, f"/api/link/{other['token']}/slots/{third['id']}/release", {}).status_code == 200
    assert owner.delete(f"/api/owner/cars/{car['id']}/slots/{third['id']}").status_code == 204


@pytest.mark.timeout(300)
def test_wf_viewing_claim_keyboard(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    first, second = owner.slot(car["id"], SLOT_A), owner.slot(car["id"], SLOT_B)
    third = owner.slot(car["id"], SLOT_C)
    token = owner.link(car["id"])["token"]
    rival = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        link = by(by(page, "navigation", "Car file"), "link", "Viewings")
        link.focus()
        page.keyboard.press("Enter")
        focused(page, heading(page, "Viewings"))
        page.keyboard.press("Tab")
        opener = btn(page, f"Claim {first['label']}")
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        box = dialog(page, "Claim viewing")
        shows(page, box)
        focused(page, btn(box, "Confirm viewing"))
        names = tab_order(page, 4)
        assert set(names) <= {"Confirm viewing", "Cancel"} or all(n in box.inner_text() or n in ("Confirm viewing", "Cancel") for n in names)
        page.keyboard.press("Escape")
        focused(page, opener)
        gone(page, box)
        page.keyboard.press("Enter")
        shows(page, box)
        poll(page, "/api/link/")
        expect(box).to_be_visible()
        btn(box, "Confirm viewing").focus()
        page.keyboard.press("Enter")
        release = btn(page, f"Release {first['label']}")
        focused(page, release)
        holds(page, status(page, "Walkround status"), f"Viewing held for {first['label']}")
        btn(page, f"Claim {second['label']}").focus()
        page.keyboard.press("Enter")
        shows(page, box)
        btn(box, "Confirm viewing").focus()
        page.keyboard.press("Enter")
        holds(page, status(box, "Dialog status"), "You already hold a viewing. Release it first.")
        expect(btn(box, "Confirm viewing")).to_have_count(0)
        expect(btn(box, "Cancel")).to_be_visible()
        page.keyboard.press("Escape")
        focused(page, btn(page, f"Claim {second['label']}"))
        release.focus()
        page.keyboard.press("Enter")
        focused(page, btn(page, f"Claim {first['label']}"))
        reads(page, status(page, "Walkround status"), "Viewing released")
        btn(page, f"Claim {third['label']}").focus()
        page.keyboard.press("Enter")
        shows(page, box)
        assert claim(app_url, rival, third["id"]).status_code == 201
        btn(box, "Confirm viewing").focus()
        page.keyboard.press("Enter")
        holds(page, status(box, "Dialog status"), "That slot has just gone")
        page.keyboard.press("Escape")
        focused(page, heading(page, "Viewings"))
        expect(by(page, "list", "Viewing slots")).to_contain_text("Held")


def test_wf_viewing_claim_pending_and_lost(browser, ntfy, app_url):
    owner = Owner(app_url)
    car = owner.live()
    first, second = owner.slot(car["id"], SLOT_A), owner.slot(car["id"], SLOT_B)
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token) as page:
        posts = calls(page, "/claim")
        btn(page, f"Claim {first['label']}").focus()
        page.keyboard.press("Enter")
        box = dialog(page, "Claim viewing")
        shows(page, box)
        confirm = btn(box, "Confirm viewing")
        confirm.focus()
        with held(page, "**/claim") as release:
            for _ in range(3):
                page.keyboard.press("Enter")
            page.keyboard.press("Escape")
            advance(page, EXIT_MS)
            expect(box).to_be_visible()
            expect(confirm).to_have_attribute("aria-disabled", "true")
            expect(confirm).to_be_focused()
            holds(page, status(box, "Dialog status"), "Claiming viewing")
            release()
        focused(page, btn(page, f"Release {first['label']}"))
        assert len(posts) == 1
    other = owner.link(car["id"])["token"]
    before = topic_count(ntfy, "New viewing claim")
    with buyer_page(browser, app_url, other) as page:
        posts = calls(page, "/claim")
        lose_reply(page, "**/claim")
        btn(page, f"Claim {second['label']}").focus()
        page.keyboard.press("Enter")
        box = dialog(page, "Claim viewing")
        confirm = btn(box, "Confirm viewing")
        confirm.focus()
        page.keyboard.press("Enter")
        holds(page, status(box, "Dialog status"), "That could not be sent. Try again.")
        expect(confirm).to_be_focused()
        poll(page, "/api/link/")
        expect(box).to_be_visible()
        expect(btn(page.locator("body"), f"Release {second['label']}")).to_have_count(1)
        page.keyboard.press("Enter")
        focused(page, btn(page, f"Release {second['label']}"))
        assert len(posts) == 2
        assert posts[0].headers["idempotency-key"] == posts[1].headers["idempotency-key"]
    assert owner.car(car["id"])["standing"]["slotsHeld"] == 2
    assert len(owner.alerts(car["id"])) == 2
    api_until(lambda: all(a["state"] == "delivered" for a in owner.alerts(car["id"])), "alerts delivered")
    assert topic_count(ntfy, "New viewing claim") == before + 1


def test_offer_gate(app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    data = view(app_url, token)
    material = [f["id"] for f in data["findings"] if f["material"]]
    cosmetic = next(f["id"] for f in data["findings"] if not f["material"])
    refused = send_offer(app_url, token)
    assert refused.status_code == 409 and refused.json()["error"] == "material_findings_unseen"
    assert sorted(refused.json()["unseen"]) == sorted(material)
    assert see(app_url, token, cosmetic).status_code == 201
    assert send_offer(app_url, token).status_code == 409
    for item in material:
        assert see(app_url, token, item).status_code == 201
    for amount in (0, 10000001):
        reply = send_offer(app_url, token, amount)
        assert reply.status_code == 422 and "amountPounds" in reply.json()["errors"]
    missing = post_json(app_url, f"/api/link/{token}/offers", {"amountPounds": OFFER})
    assert missing.status_code == 422 and "Idempotency-Key" in missing.json()["errors"]
    assert owner.offers(car["id"]) == []
    made = send_offer(app_url, token)
    assert made.status_code == 201 and made.json()["status"] == "open" and made.json()["amountPounds"] == OFFER
    assert 0 < made.json()["secondsRemaining"] <= LAPSE_SECONDS
    second = send_offer(app_url, token, OFFER + 1)
    assert second.status_code == 409 and second.json()["error"] == "offer_exists"
    assert view(app_url, token)["offer"]["id"] == made.json()["id"]
    assert len(owner.offers(car["id"])) == 1


def test_wf_make_offer_keyboard_replay(browser, ntfy, app_url):
    owner = Owner(app_url)
    car = owner.live()
    link = owner.link(car["id"])
    token = link["token"]
    read_all(app_url, token)
    before = topic_count(ntfy, "New offer")
    with buyer_page(browser, app_url, token) as page:
        posts = calls(page, "/offers")
        open_offer_dialog(page)
        box = dialog(page, "Make an offer")
        field = by(box, "spinbutton", "Offer in pounds")
        focused(page, field)
        names = tab_order(page, 5)
        assert "Make an offer" not in names
        field.focus()
        page.keyboard.type("0")
        page.keyboard.press("Enter")
        soon(page, lambda: expect(btn(box, "Send offer")).not_to_have_attribute("aria-disabled", "true", timeout=QUICK_MS))
        expect(box).to_be_visible()
        fill(field, str(OFFER))
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        reads(page, status(page, "Walkround status"), "Offer sent")
        focused(page, heading(page, "Your offer"))
        accepted = [p for p in posts if json.loads(p.post_data)["amountPounds"] == OFFER]
        assert len(accepted) == 1
        key = accepted[0].headers["idempotency-key"]
    replay = send_offer(app_url, token, OFFER, key)
    assert replay.status_code == 201 and replay.json()["id"] == view(app_url, token)["offer"]["id"]
    conflict = send_offer(app_url, token, OFFER + 1, key)
    assert conflict.status_code == 409 and conflict.json()["error"] == "idempotency_conflict"
    assert len(owner.offers(car["id"])) == 1 and len(owner.alerts(car["id"])) == 1
    api_until(lambda: owner.alerts(car["id"])[0]["state"] == "delivered", "offer alert delivered")
    assert topic_count(ntfy, "New offer") == before + 1


def test_wf_make_offer_reduced_motion(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    slot = owner.slot(car["id"])
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token, reduced_motion="reduce") as page:
        area = stage(page)
        expect(heading(page, "WALK ROUND IT FIRST")).to_be_visible()
        assert float(style(region(page, "Asking summary"), "opacity")["opacity"]) == 1
        rest = frames(area)
        advance(page, IDLE_MS)
        assert frames(area) == rest
        go(page, page.evaluate("document.documentElement.scrollHeight - window.innerHeight"))
        go(page, 0)
        assert frames(area) == rest
        for done in (1, 2, 3):
            count = frames(area)
            btn(page, "I've read this").first.focus()
            page.keyboard.press("Enter")
            reads(page, status(page, "Seen count"), f"{done} of 3 seen")
            advance(page, STEP_MS)
            assert frames(area) == count + 1
        btn(page, f"Claim {slot['label']}").focus()
        page.keyboard.press("Enter")
        shows(page, dialog(page, "Claim viewing"))
        btn(dialog(page, "Claim viewing"), "Confirm viewing").focus()
        page.keyboard.press("Enter")
        focused(page, btn(page, f"Release {slot['label']}"))
        expect(dialog(page, "Claim viewing")).to_have_count(0)
        open_offer_dialog(page)
        fill(by(page, "spinbutton", "Offer in pounds"), str(OFFER))
        page.keyboard.press("Enter")
        focused(page, heading(page, "Your offer"))
    assert view(app_url, token)["offer"]["status"] == "open"


@pytest.mark.timeout(300)
def test_wf_make_offer_lapse(browser):
    base = os.environ["APP_SHORT_TIMERS_URL"]
    owner = Owner(base)
    car = owner.live()
    link, offer = offering_buyer(owner, car)
    token = link["token"]
    assert offer["secondsRemaining"] <= 40
    server_now = datetime.fromisoformat(view(base, token)["serverNow"].replace("Z", "+00:00"))
    with at(browser, base, "/api/health", DESKTOP) as page:
        page.clock.set_system_time(server_now - timedelta(hours=6))
        page.goto(f"{base}/l/{token}")
        line_status = status(page, "Offer status")
        soon(page, lambda: expect(line_status).to_have_text(re.compile(r"^Open \d+h \d+m \d+s left$"), timeout=QUICK_MS))
        api_until(lambda: view(base, token)["offer"]["status"] == "lapsed", "the offer lapsed on the server")
        data = view(base, token)["offer"]
        assert data["secondsRemaining"] == 0
        advance(page, POLL_MS)
        reads(page, line_status, "Lapsed")
        shows(page, heading(page, "This offer has lapsed"))
        holds(page, region(page, "Offer"), "You can make a new offer while the car is still live.")
        shows(page, btn(page, "Make an offer"))
    assert owner.accept(offer["id"]).json()["error"] == "offer_lapsed"
    assert owner.post(f"/api/owner/offers/{offer['id']}/decline").json()["error"] == "offer_lapsed"
    assert send_offer(base, token).status_code == 201


def test_lost_reply_keeps_one_key(browser, ntfy, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    read_all(app_url, token)
    before = topic_count(ntfy, "New offer")
    with buyer_page(browser, app_url, token) as page:
        posts = calls(page, "/offers")
        page.route("**/offers", lambda route: route.abort())
        open_offer_dialog(page)
        box = dialog(page, "Make an offer")
        field = by(box, "spinbutton", "Offer in pounds")
        fill(field, str(OFFER))
        send = btn(box, "Send offer")
        send.focus()
        page.keyboard.press("Enter")
        holds(page, status(box, "Dialog status"), "That could not be sent. Try again.")
        expect(field).to_have_value(str(OFFER))
        expect(send).to_be_focused()
        page.keyboard.press("Enter")
        soon(page, lambda: _at_least(posts, 2))
        assert posts[0].headers["idempotency-key"] == posts[1].headers["idempotency-key"]
        fill(field, str(OFFER + 1))
        page.unroute("**/offers")
        send.focus()
        page.keyboard.press("Enter")
        reads(page, status(page, "Walkround status"), "Offer sent")
        assert posts[-1].headers["idempotency-key"] != posts[0].headers["idempotency-key"]
    assert [o["amountPounds"] for o in owner.offers(car["id"])] == [OFFER + 1]
    api_until(lambda: owner.alerts(car["id"]) and owner.alerts(car["id"])[0]["state"] == "delivered", "the alert delivered")
    assert topic_count(ntfy, "New offer") == before + 1


def _at_least(items, count):
    assert len(items) >= count, items


def test_wf_make_offer_recorded_behind_dialog(browser, ntfy, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    read_all(app_url, token)
    before = topic_count(ntfy, "New offer")
    with buyer_page(browser, app_url, token) as page:
        posts = calls(page, "/offers")
        lose_reply(page, "**/offers")
        open_offer_dialog(page)
        box = dialog(page, "Make an offer")
        fill(by(box, "spinbutton", "Offer in pounds"), str(OFFER))
        send = btn(box, "Send offer")
        send.focus()
        page.keyboard.press("Enter")
        holds(page, status(box, "Dialog status"), "That could not be sent. Try again.")
        poll(page, "/api/link/")
        expect(box).to_be_visible()
        expect(by(box, "spinbutton", "Offer in pounds")).to_have_value(str(OFFER))
        holds(page, status(box, "Dialog status"), "That could not be sent. Try again.")
        soon(page, lambda: expect(status(page, "Offer status")).to_have_text(re.compile(r"^Open "), timeout=QUICK_MS))
        expect(by(region(page, "Offer"), "button", "Make an offer")).to_have_count(0)
        send.focus()
        page.keyboard.press("Enter")
        reads(page, status(page, "Walkround status"), "Offer sent")
        focused(page, heading(page, "Your offer"))
        assert len(posts) == 2
    assert len(owner.offers(car["id"])) == 1 and len(owner.alerts(car["id"])) == 1
    api_until(lambda: owner.alerts(car["id"])[0]["state"] == "delivered", "the alert delivered")
    assert topic_count(ntfy, "New offer") == before + 1


def test_dock_standing_line(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    slot = owner.slot(car["id"])
    link = owner.link(car["id"])
    token = link["token"]
    assert claim(app_url, token, slot["id"]).status_code == 201
    read_all(app_url, token)
    with buyer_page(browser, app_url, token, PHONE) as page:
        dock = region(page, "Walkround dock")
        holds(page, dock, f"Viewing {slot['label']}")
        expect(status(page, "Offer status")).to_have_count(0)
        assert send_offer(app_url, token).status_code == 201
        poll(page, "/api/link/")
        soon(page, lambda: expect(status(dock, "Offer status")).to_have_text(re.compile(r"^Open \d+h \d+m \d+s left$"), timeout=QUICK_MS))
        expect(status(page, "Offer status")).to_have_count(1)
        assert dock.bounding_box()["height"] <= DOCK_MAX
        layout(page)
        page.set_viewport_size(DESKTOP)
        flush(page)
        expect(status(page, "Offer status")).to_have_count(1)
        expect(status(region(page, "Offer"), "Offer status")).to_have_count(1)
        expect(dock).to_have_count(0)
        page.set_viewport_size(PHONE)
        flush(page)
        expect(status(region(page, "Walkround dock"), "Offer status")).to_have_count(1)
        expect(status(page, "Offer status")).to_have_count(1)


def test_offer_short_viewport(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    read_all(app_url, token)
    with buyer_page(browser, app_url, token, PHONE) as page:
        open_offer_dialog(page)
        box = dialog(page, "Make an offer")
        field = by(box, "spinbutton", "Offer in pounds")
        fill(field, str(OFFER))
        beat = stage(page).get_attribute("data-beat")
        page.set_viewport_size(SHORT)
        flush(page)
        expect(box).to_be_visible()
        expect(field).to_have_value(str(OFFER))
        expect(field).to_be_focused()
        for _ in range(4):
            page.keyboard.press("Tab")
            advance(page, STEP_MS)
            rect = page.evaluate("(() => { const r = document.activeElement.getBoundingClientRect(); return [r.top, r.bottom, r.left, r.right]; })()")
            assert rect[0] >= 0 and rect[1] <= SHORT["height"] and rect[2] >= 0 and rect[3] <= SHORT["width"], rect
        assert stage(page).get_attribute("data-beat") == beat
        send = btn(box, "Send offer")
        send.focus()
        x, y = center(send)
        assert page.evaluate("([x, y]) => document.elementFromPoint(x, y).closest('[role=dialog],dialog') !== null", [x, y])
        page.keyboard.press("Enter")
        focused(page, heading(page, "Your offer"))
        assert view(app_url, token)["offer"]["status"] == "open"
    meta = "interactive-widget=resizes-content"
    assert meta in httpx.get(f"{app_url}/l/{token}").text


def test_single_acceptance(app_url):
    owner = Owner(app_url)
    for _ in range(3):
        car = owner.live()
        offers = [offering_buyer(owner, car)[1] for _ in range(4)]
        start = threading.Barrier(len(offers))
        clients = [httpx.Client(base_url=app_url, timeout=HTTP_SECONDS, cookies=owner.http.cookies) for _ in offers]

        def accept(pair):
            client, offer = pair
            start.wait(10)
            return client.post(f"/api/owner/offers/{offer['id']}/accept", headers={"Idempotency-Key": idempotency_key()})
        try:
            with ThreadPoolExecutor(len(offers)) as pool:
                replies = list(pool.map(accept, zip(clients, offers)))
        finally:
            for client in clients:
                client.close()
        assert sorted(r.status_code for r in replies) == [200, 409, 409, 409], [r.status_code for r in replies]
        assert all(r.json()["error"] == "offer_already_accepted" for r in replies if r.status_code == 409)
        won = next(r.json() for r in replies if r.status_code == 200)
        assert won["listingStatus"] == "under_offer" and won["offer"]["status"] == "accepted"
        others = sorted(o["id"] for o in offers if o["id"] != won["offer"]["id"])
        assert sorted(won["closedOfferIds"]) == others
        states = {o["id"]: o["status"] for o in owner.offers(car["id"])}
        assert all(states[i] == "closed_by_acceptance" for i in others)
        assert owner.car(car["id"])["listingStatus"] == "under_offer"
        assert owner.car(car["id"])["standing"]["liveOffers"] == 0


def test_offer_transition_refusals(app_url):
    owner = Owner(app_url)
    car = owner.live()
    link, offer = offering_buyer(owner, car)
    declined = owner.post(f"/api/owner/offers/{offer['id']}/decline")
    assert declined.status_code == 200 and declined.json()["status"] == "declined"
    assert owner.accept(offer["id"]).json()["error"] == "offer_not_open"
    assert owner.post(f"/api/owner/offers/{offer['id']}/decline").json()["error"] == "offer_not_open"
    again = send_offer(app_url, link["token"], SECOND_OFFER)
    assert again.status_code == 201
    material = next(f for f in owner.findings(car["id"]) if f["material"])
    owner.amend(car["id"], material, wording=fresh("Changed"))
    current = view(app_url, link["token"])["offer"]
    assert current["status"] == "needs_reread"
    refused = owner.accept(current["id"])
    assert refused.status_code == 409 and refused.json()["error"] == "offer_needs_reread"
    assert owner.post(f"/api/owner/offers/{current['id']}/decline").json()["status"] == "declined"
    fresh_link, winner = offering_buyer(owner, car)
    assert owner.accept(winner["id"]).status_code == 200
    late = owner.accept(winner["id"])
    assert late.status_code == 409 and late.json()["error"] == "offer_already_accepted"
    assert owner.post(f"/api/owner/offers/{winner['id']}/decline").json()["error"] == "offer_not_open"
    unknown = owner.accept(str(uuid.uuid4()))
    assert unknown.status_code == 404 and unknown.json()["error"] == "not_found"


def test_sale_handover(app_url):
    owner = Owner(app_url)
    car = owner.live()
    buyer_name = fresh("Winner")
    link, offer = offering_buyer(owner, car, buyer_name)
    rival, _ = offering_buyer(owner, car, fresh("Rival"), SECOND_OFFER)
    assert owner.accept(offer["id"]).status_code == 200
    path = f"/api/owner/cars/{car['id']}/complete"
    down = Owner(os.environ["APP_GOTENBERG_DOWN_URL"]).post(path)
    assert down.status_code == 503 and down.json()["error"] == "report_render_failed"
    assert owner.car(car["id"])["listingStatus"] == "under_offer"
    assert S3().keys(f"handover/{car['id']}") == []
    assert httpx.get(f"{app_url}/api/link/{link['token']}/handover").json()["error"] == "listing_not_sold"
    store_down = Owner(os.environ["APP_MINIO_DOWN_URL"]).post(path)
    assert store_down.status_code == 503 and store_down.json()["error"] == "report_store_failed"
    second = Owner(app_url)
    with ThreadPoolExecutor(2) as pool:
        replies = list(pool.map(lambda o: o.post(path), (owner, second)))
    assert sorted(r.status_code for r in replies) == [201, 409]
    done = next(r for r in replies if r.status_code == 201).json()
    assert next(r for r in replies if r.status_code == 409).json()["error"] == "illegal_transition"
    assert done["listingStatus"] == "sold"
    keys = S3().keys(f"handover/{car['id']}")
    assert keys == [f"handover/{car['id']}.pdf"]
    stored = S3().get(keys[0])
    assert hashlib.sha256(stored).hexdigest() == done["handoverSha256"]
    served = httpx.get(f"{app_url}/api/link/{link['token']}/handover", timeout=HTTP_SECONDS)
    assert served.status_code == 200 and served.content == stored
    assert httpx.get(f"{app_url}/api/link/{rival['token']}/handover").json()["error"] == "not_the_buyer"
    assert owner.get(f"/api/owner/cars/{car['id']}/handover").content == stored
    text = re.sub(r"\s+", " ", pdf_text(stored))
    for word in ("Handover record", car["name"], "Version 1", "T3*****", "Agreed price: £15,400", buyer_name,
                 owner.findings(car["id"])[0]["title"]):
        assert word in text, word
    for private in ("T317HJN", "Larkfield"):
        assert private not in text


def test_wf_accept_offer_sell(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    winner = fresh("Winner")
    rival = fresh("Rival")
    link, offer = offering_buyer(owner, car, winner)
    offering_buyer(owner, car, rival, SECOND_OFFER)
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#offers") as page:
        table = by(page, "table", "Offers")
        row = table.get_by_role("row").filter(has_text=winner)
        for text in ("£15,400", "Open", "3 of 3"):
            holds(page, row, text)
        expect(row).to_contain_text(re.compile(r"\d+h \d+m \d+s left"))
        click(btn(row, "Accept"))
        box = dialog(page, "Accept offer")
        shows(page, box)
        holds(page, box, f"Accept £15,400 from {winner}?")
        holds(page, box, "Other open offers closed: 1")
        btn(box, "Confirm acceptance").focus()
        page.keyboard.press("Enter")
        reads(page, status(page, "Owner status"), "Offer accepted. Other open offers are closed.")
        focused(page, heading(page, "Offers"))
        holds(page, row, "Accepted")
        rival_row = table.get_by_role("row").filter(has_text=rival)
        holds(page, rival_row, "Closed by another acceptance")
        expect(btn(rival_row, "Accept")).to_have_count(0)
        expect(btn(rival_row, "Decline")).to_have_count(0)
        click(btn(page, "Complete sale"))
        reads(page, status(page, "Owner status"), "Sale complete", 40)
        with page.expect_download() as download:
            click(by(page, "link", "Download handover record"))
        data = Path(download.value.path()).read_bytes()
        assert data[:4] == b"%PDF" and "Handover record" in pdf_text(data)
    assert owner.car(car["id"])["listingStatus"] == "sold"
    with buyer_page(browser, app_url, link["token"]) as page:
        shows(page, by(page, "link", "Download handover record"))
        holds(page, region(page, "Asking summary"), "Sold")
    assert offer["id"] == next(o["id"] for o in owner.offers(car["id"]) if o["status"] == "accepted")


@pytest.mark.timeout(300)
def test_wf_accept_offer_pending_one_write(browser):
    base = os.environ["APP_SHORT_TIMERS_URL"]
    owner = Owner(base)
    car = owner.live()
    name = fresh("Lapsing")
    link, offer = offering_buyer(owner, car, name)
    with at(browser, base, "/api/health", DESKTOP, owner.cookie) as page:
        server_now = datetime.fromisoformat(view(base, link["token"])["serverNow"].replace("Z", "+00:00"))
        page.clock.set_system_time(server_now + timedelta(hours=6))
        page.goto(f"{base}/owner/cars/{car['id']}#offers")
        row = by(page, "table", "Offers").get_by_role("row").filter(has_text=name)
        left = soon(page, lambda: _time_left(row))
        assert 0 < left <= 40
        btn(row, "Accept").focus()
        page.keyboard.press("Enter")
        box = dialog(page, "Accept offer")
        shows(page, box)
        api_until(lambda: next(o for o in owner.offers(car["id"]) if o["id"] == offer["id"])["status"] == "lapsed", "offer lapse")
        btn(box, "Confirm acceptance").focus()
        page.keyboard.press("Enter")
        holds(page, status(box, "Dialog status"), "This offer has lapsed")
        expect(btn(box, "Confirm acceptance")).to_have_count(0)
        expect(btn(box, "Cancel")).to_be_visible()
    owner = Owner(base)
    car = owner.live()
    first_name, second_name = fresh("First"), fresh("Second")
    offering_buyer(owner, car, first_name)
    offering_buyer(owner, car, second_name, SECOND_OFFER)
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#offers") as page:
        table = by(page, "table", "Offers")
        row = table.get_by_role("row").filter(has_text=first_name)
        posts = calls(page, "/accept")
        btn(row, "Accept").focus()
        page.keyboard.press("Enter")
        box = dialog(page, "Accept offer")
        shows(page, box)
        confirm = btn(box, "Confirm acceptance")
        confirm.focus()
        with held(page, "**/accept") as release:
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            expect(confirm).to_have_attribute("aria-disabled", "true")
            page.keyboard.press("Escape")
            expect(box).to_be_visible()
            release()
        reads(page, status(page, "Owner status"), "Offer accepted. Other open offers are closed.")
        assert len(posts) == 1
        holds(page, row, "Accepted")
        poll(page, "/api/owner/")
        expect(status(page, "Owner status")).to_have_text("Offer accepted. Other open offers are closed.")
        holds(page, table.get_by_role("row").filter(has_text=second_name), "Closed by another acceptance")


def test_wf_accept_offer_lost_reply(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    name = fresh("Kept")
    _, offer = offering_buyer(owner, car, name)
    _, other = offering_buyer(owner, car, fresh("Other"), SECOND_OFFER)
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#offers") as page:
        row = by(page, "table", "Offers").get_by_role("row").filter(has_text=name)
        posts = calls(page, "/accept")
        lose_reply(page, "**/accept")
        click(btn(row, "Accept"))
        box = dialog(page, "Accept offer")
        shows(page, box)
        confirm = btn(box, "Confirm acceptance")
        confirm.focus()
        page.keyboard.press("Enter")
        holds(page, status(box, "Dialog status"), "That could not be sent. Try again.")
        poll(page, "/api/owner/")
        expect(box).to_be_visible()
        confirm.focus()
        page.keyboard.press("Enter")
        reads(page, status(page, "Owner status"), "Offer accepted. Other open offers are closed.")
        assert len(posts) == 2
        key = posts[0].headers["idempotency-key"]
        assert key == posts[1].headers["idempotency-key"]
    replay = owner.accept(offer["id"], key)
    assert replay.status_code == 200 and replay.json()["closedOfferIds"] == [other["id"]]
    assert [o["status"] for o in owner.offers(car["id"])].count("accepted") == 1
    new_key = owner.accept(offer["id"])
    assert new_key.status_code == 409 and new_key.json()["error"] == "offer_already_accepted"
    missing = owner.post(f"/api/owner/offers/{offer['id']}/accept")
    assert missing.status_code in (409, 422)


@pytest.mark.timeout(300)
def test_wf_accept_offer_stage_dims(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    slot = owner.slot(car["id"])
    _, offer = offering_buyer(owner, car)
    token = owner.link(car["id"])["token"]
    hero = next(f for f in view(app_url, token)["findings"] if f["panelId"] == "os-sill")
    with buyer_page(browser, app_url, token) as page:
        _, _, lit = assert_hero_lit(page, hero)
        shows(page, btn(page, f"Claim {slot['label']}"))
        assert owner.accept(offer["id"]).status_code == 200
        poll(page, "/api/link/")
        area = stage(page)
        soon(page, lambda: expect(area).to_have_attribute("data-listing", "under_offer", timeout=QUICK_MS))
        holds(page, region(page, "Asking summary"), "Under offer")
        gone(page, btn(page, f"Claim {slot['label']}"))
        advance(page, STEP_MS)
        canvas = surface(page)
        box = canvas.bounding_box()
        px, py, _ = project(attrs(area), world(hero["panelId"], hero["u"], hero["v"]), box)
        x, y = px - box["x"], py - box["y"]
        stats = lum(canvas, [[x, y, HERO_PATCH]], [x, y, HERO_PATCH, 0.15 * box["width"]])
        assert stats["means"][0] <= 0.6 * lit, (stats, lit)
        assert stats["far"] <= stats["means"][0]
        count = frames(area)
        poll(page, "/api/link/")
        assert frames(area) == count
        go(page, 300)
        go(page, 0)
        assert lum(canvas, [[x, y, HERO_PATCH]])["means"][0] <= 0.6 * lit
    down = Owner(os.environ["APP_GOTENBERG_DOWN_URL"])
    with owner_page(browser, down, f"/owner/cars/{car['id']}#offers") as page:
        complete = btn(page, "Complete sale")
        complete.focus()
        page.keyboard.press("Enter")
        text = "The handover record could not be made, so the sale is not complete."
        reads(page, notice(page), text)
        poll(page, "/api/owner/")
        expect(notice(page)).to_have_text(text)
        expect(complete).to_be_focused()
    assert view(app_url, token)["car"]["listingStatus"] == "under_offer"
    assert owner.post(f"/api/owner/cars/{car['id']}/complete").status_code == 201


def test_selective_reread_api(app_url):
    owner = Owner(app_url)
    car = owner.live()
    link, offer = offering_buyer(owner, car)
    token = link["token"]
    before = {f["id"]: f for f in view(app_url, token)["findings"]}
    chosen = next(f for f in owner.findings(car["id"]) if f["material"])
    path = f"/api/owner/cars/{car['id']}/findings/{chosen['id']}"
    original = chosen["wording"]
    patched = owner.patch(path, json={"wording": "Temporary"}, headers={"If-Match": f'"{chosen["revision"]}"'}).json()
    reverted = owner.patch(path, json={"wording": original}, headers={"If-Match": f'"{patched["revision"]}"'}).json()
    refused = owner.post(f"/api/owner/cars/{car['id']}/publish")
    assert refused.status_code == 409 and refused.json()["error"] == "no_changes"
    made = owner.amend(car["id"], reverted, wording="Changed wording")
    assert made["version"] == 2 and made["changedFindingIds"] == [chosen["id"]]
    data = view(app_url, token)
    for item in data["findings"]:
        if item["id"] == chosen["id"]:
            assert item["seen"] is False and item["changedSinceSeen"] is True and item["wording"] == "Changed wording"
        else:
            assert item["seen"] is True and item["seenAt"] == before[item["id"]]["seenAt"]
    assert data["progress"]["seen"] == 2 and data["progress"]["materialUnseen"] == 1
    assert data["offer"]["status"] == "needs_reread" and data["offer"]["lapsesAt"] == offer["lapsesAt"]
    assert see(app_url, token, chosen["id"]).status_code == 201
    assert view(app_url, token)["offer"]["status"] == "open"
    assert owner.accept(offer["id"]).status_code == 200


@pytest.mark.timeout(300)
def test_wf_amend_reread_surfaces(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    link, _ = offering_buyer(owner, car)
    token = link["token"]
    findings = owner.findings(car["id"])
    changed, removed = findings[1], findings[2]
    old_wording = changed["wording"]
    assert owner.delete(f"/api/owner/cars/{car['id']}/findings/{removed['id']}",
                        headers={"If-Match": f'"{removed["revision"]}"'}).status_code == 204
    owner.amend(car["id"], changed, wording=AMENDED_WORDING)
    with buyer_page(browser, app_url, token) as page:
        card = by(page, "article", f"Finding 2: {changed['title']}")
        holds(page, card, AMENDED_WORDING)
        holds(page, card, "Changed. Read it again.")
        prompt = region(page, "Re-read prompt")
        holds(page, prompt, "The owner has changed this car's file")
        holds(page, prompt, "Findings changed since you read them: 1")
        record = by(page, "list", "Your walkround record")
        holds(page, record, removed["title"])
        holds(page, record, "Removed by the owner in version 2")
        soon(page, lambda: click(by(prompt, "link", "See the version you read")))
        old = dialog(page, "Version 1")
        shows(page, old)
        holds(page, old, old_wording)
        click(btn(old, "Close"))
    data = view(app_url, token)
    assert data["removedFindings"][0]["title"] == removed["title"] and data["removedFindings"][0]["removedInVersion"] == 2
    assert data["versionsRead"] == [1] or 1 in data["versionsRead"]
    report = pdf_text(httpx.get(f"{app_url}/api/link/{token}/report", timeout=HTTP_SECONDS).content)
    assert AMENDED_WORDING in re.sub(r"\s+", " ", report) and "Version 2" in report
    old_report = pdf_text(httpx.get(f"{app_url}/api/link/{token}/report/1", timeout=HTTP_SECONDS).content)
    assert old_wording in re.sub(r"\s+", " ", old_report)
    assert httpx.get(f"{app_url}/api/link/{token}/versions/1").json()["number"] == 1
    stranger = owner.link(car["id"])["token"]
    assert httpx.get(f"{app_url}/api/link/{stranger}/versions/1").status_code == 404


def test_agreeing_counts(app_url):
    owner = Owner(app_url)
    car = owner.live()
    link, _ = offering_buyer(owner, car)

    def assert_agree():
        progress = view(app_url, link["token"])["progress"]
        row = next(l for l in owner.links(car["id"]) if l["id"] == link["id"])
        offer = next(o for o in owner.offers(car["id"]) if o["linkId"] == link["id"])
        assert (row["seen"], row["total"], row["materialUnseen"]) == (progress["seen"], progress["total"], progress["materialUnseen"])
        assert (offer["seen"], offer["total"]) == (progress["seen"], progress["total"])
        assert row["offerStatus"] == offer["status"]
        state = owner.car(car["id"])
        assert view(app_url, link["token"])["record"]["openAdvisories"] == state["publishedOpenAdvisories"]
        assert state["publishedOpenAdvisories"] == state["workingOpenAdvisories"]
        return progress

    assert assert_agree()["seen"] == 3
    findings = owner.findings(car["id"])
    owner.amend(car["id"], findings[0], wording=fresh("Cosmetic change"))
    assert assert_agree() == {"seen": 2, "total": 3, "materialUnseen": 0}
    owner.finding(car["id"], "ns-door", severity="moderate")
    owner.publish(car["id"])
    assert assert_agree() == {"seen": 2, "total": 4, "materialUnseen": 1}
    record = owner.get(f"/api/owner/cars/{car['id']}/record").json()
    owner.answer(car["id"], record["advisories"][0]["id"], "repaired")
    assert owner.car(car["id"])["workingOpenAdvisories"] == owner.car(car["id"])["publishedOpenAdvisories"] - 1
    owner.publish(car["id"])
    assert_agree()


@pytest.mark.timeout(300)
def test_wf_amend_reread_open_tab(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    link, _ = offering_buyer(owner, car)
    token = link["token"]
    target = owner.findings(car["id"])[1]
    extra = owner.link(car["id"])
    read_all(app_url, extra["token"])
    with buyer_page(browser, app_url, token, PHONE) as page:
        posts = calls(page, "/seen")
        live = status(page, "Walkround status")
        watch(live)
        count = status(page, "Seen count")
        reads(page, count, "3 of 3 seen")
        owner.amend(car["id"], target, wording="Amended sill wording")
        poll(page, "/api/link/")
        reads(page, count, "2 of 3 seen")
        holds(page, status(page, "Offer status"), "Needs re-read")
        card = by(page, "article", f"Finding 2: {target['title']}")
        expect(card).to_have_attribute("data-seen", "false")
        holds(page, card, "Amended sill wording")
        holds(page, card, "Changed. Read it again.")
        holds(page, region(page, "Re-read prompt"), "Findings changed since you read them: 1")
        holds(page, region(page, "Offer"), "Your offer needs a re-read")
        assert posts == []
        log = writes(live)
        assert log.count("The owner has published version 2") == 1
        assert log.count("Your offer is now Needs re-read") == 1
        poll(page, "/api/link/")
        assert writes(live) == log
        tap(btn(region(page, "Walkround dock"), "Next unread"))
        holds(page, live, "Finding 2 of 3")
        until(page, "y => Math.abs(window.scrollY - y) < 2", BEAT * 2, seconds=10)
        assert posts == []
        go(page, BEAT * 2.7, 2)
        reads(page, count, "3 of 3 seen")
        soon(page, lambda: expect(status(page, "Offer status")).to_have_text(re.compile(r"^Open "), timeout=QUICK_MS))
        assert len(posts) == 1
    row = next(o for o in owner.offers(car["id"]) if o["linkId"] == link["id"])
    assert row["status"] == "open" and row["seen"] == 3
    with buyer_page(browser, app_url, extra["token"]) as page:
        click(by(by(page, "navigation", "Car file"), "link", "Offer"))
        open_offer_dialog(page)
        box = dialog(page, "Make an offer")
        fill(by(box, "spinbutton", "Offer in pounds"), str(OFFER))
        latest = owner.findings(car["id"])[1]
        owner.amend(car["id"], latest, wording="Third sill wording")
        poll(page, "/api/link/")
        expect(box).to_be_visible()
        expect(by(box, "spinbutton", "Offer in pounds")).to_have_value(str(OFFER))
        btn(box, "Send offer").focus()
        page.keyboard.press("Enter")
        holds(page, status(box, "Dialog status"), "Read every material finding before making an offer")
        expect(btn(box, "Send offer")).to_be_visible()


def capture_row(panel="roof", microns=431, client=None) -> dict:
    return {"clientId": client or str(uuid.uuid4()), "kind": "reading", "panelId": panel, "microns": microns,
            "capturedAt": "2026-11-05T10:00:00.000Z"}


class WorkerBrowser:

    def __init__(self, browser):
        self.browser = browser

    def new_context(self, **options):
        return self.browser.new_context(**{**options, "service_workers": "allow"})


def inspector_ready(page):
    shows(page, by(page, "list", "Capture panels"))
    assert page.evaluate("() => navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    shows(page, by(page, "list", "Capture panels"))
    until(page, "() => !!navigator.serviceWorker.controller")


def queue_reading(page, label, microns):
    select(by(page, "combobox", "Panel"), label)
    fill(by(page, "spinbutton", "Microns"), str(microns))
    click(btn(page, "Queue reading"))


def inspector_readings(owner, car_id, panel):
    panels = owner.get(f"/api/owner/cars/{car_id}/panels").json()["panels"]
    return next(p for p in panels if p["id"] == panel)["inspector"]


def test_wf_inspector_capture_offline_reload(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    owner.put(f"/api/owner/cars/{car['id']}/readings", json={"readings": [{"panelId": "roof", "microns": 118}]})
    token = owner.link(car["id"], "inspector")["token"]
    with at(WorkerBrowser(browser), app_url, f"/l/{token}") as page:
        inspector_ready(page)
        holds(page, by(page, "list", "Capture panels"), "118")
        page.context.set_offline(True)
        queue_reading(page, "Roof", 431)
        queue = by(page, "list", "Capture queue")
        holds(page, queue, "Queued")
        page.reload()
        shows(page, by(page, "list", "Capture panels"))
        holds(page, by(page, "list", "Capture queue"), "Roof")
        holds(page, queue, "431")
        click(btn(page, "Send now"))
        holds(page, page.locator("body"), "No signal. Items stay queued on this device.")
        holds(page, queue, "Queued")
        assert inspector_readings(owner, car["id"], "roof") == []
        page.context.set_offline(False)
        holds(page, queue, "Synced")
        reads(page, status(page, "Capture status"), "All items synced")
    readings = inspector_readings(owner, car["id"], "roof")
    assert [r["microns"] for r in readings] == [431]


def test_capture_replay(app_url):
    owner = Owner(app_url)
    car = owner.live()
    inspector = owner.link(car["id"], "inspector", fresh("Inspector"))
    path = f"/api/link/{inspector['token']}/capture"
    item = capture_row("os-door", 431)
    finding = {"clientId": str(uuid.uuid4()), "kind": "finding", "panelId": "os-sill", "u": 0.7, "v": 0.4,
               "wording": "Filler found", "capturedAt": "2026-11-05T10:00:00.000Z"}
    batch = {"batchId": str(uuid.uuid4()), "items": [item, finding]}
    first = post_json(app_url, path, batch)
    assert first.status_code == 200 and [r["state"] for r in first.json()["results"]] == ["applied", "applied"]
    assert first.json()["batchId"] == batch["batchId"]
    with ThreadPoolExecutor(6) as pool:
        replies = list(pool.map(lambda _: post_json(app_url, path, batch), range(6)))
    assert all(r.json()["results"][0]["state"] == "duplicate" for r in replies)
    assert len(inspector_readings(owner, car["id"], "os-door")) == 1
    race = capture_row("os-sill", 500)
    with ThreadPoolExecutor(6) as pool:
        replies = list(pool.map(lambda _: post_json(app_url, path, {"batchId": str(uuid.uuid4()), "items": [race]}), range(6)))
    states = sorted(r.json()["results"][0]["state"] for r in replies)
    assert states == ["applied"] + ["duplicate"] * 5
    changed = post_json(app_url, path, {"batchId": str(uuid.uuid4()), "items": [{**item, "microns": 432}]})
    assert changed.json()["results"][0]["state"] == "conflict"
    assert inspector_readings(owner, car["id"], "os-door")[0]["microns"] == 431
    mixed = post_json(app_url, path, {"batchId": str(uuid.uuid4()), "items": [capture_row("rear-bumper", 200), capture_row("bonnet", 150)]})
    states = mixed.json()["results"]
    assert states[0]["state"] == "rejected" and states[0]["errors"] and states[1]["state"] == "applied"
    for bad in ({"batchId": str(uuid.uuid4()), "items": []},
                {"batchId": str(uuid.uuid4()), "items": [capture_row() for _ in range(101)]}):
        assert post_json(app_url, path, bad).status_code == 422


def test_wf_inspector_capture_side_by_side(browser, app_url):
    owner = Owner(app_url)
    car = owner.new_car()
    readings = [{"panelId": p, "microns": 100} for p in ("os-door", "ns-door", "roof")]
    owner.put(f"/api/owner/cars/{car['id']}/readings", json={"readings": readings})
    owner.finding(car["id"], "roof")
    owner.pull(car["id"])
    owner.answer_all(car["id"])
    owner.publish(car["id"])
    name = fresh("Inspector")
    token = owner.link(car["id"], "inspector", name)["token"]
    with at(browser, app_url, f"/l/{token}", PHONE) as page:
        shows(page, by(page, "list", "Capture panels"))
        queue_reading(page, "Offside door", 300)
        queue_reading(page, "Bonnet", 96)
        click(btn(page, "Send now"))
        reads(page, status(page, "Capture status"), "All items synced")
        holds(page, by(page, "list", "Capture panels"), "300")
        layout(page)
    panels = {p["id"]: p for p in owner.get(f"/api/owner/cars/{car['id']}/panels").json()["panels"]}
    door = panels["os-door"]
    assert door["owner"]["microns"] == 100 and door["owner"]["band"] == "Original"
    assert door["inspector"][0]["band"] == "Filler" and door["inspector"][0]["name"] == name
    assert door["inspector"][0]["capturedAt"] and door["inspector"][0]["receivedAt"]
    assert panels["bonnet"]["inspector"][0]["band"] == "No baseline"
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#panels") as page:
        row = by(page, "table", "Panel readings").get_by_role("row").filter(has_text="Offside door")
        holds(page, row, "300")
    frozen = owner.get(f"/api/owner/cars/{car['id']}/versions/1").json()
    assert not next(p for p in frozen["panels"] if p["id"] == "os-door").get("inspector")
    report = pdf_text(owner.get(f"/api/owner/cars/{car['id']}/report/1").content)
    assert not re.search(r"(?<!\d)300(?!\d)", report), "no inspector reading in the report"


def test_wf_inspector_capture_lost_reply(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    link = owner.link(car["id"], "inspector")
    token = link["token"]
    with at(browser, app_url, f"/l/{token}") as page:
        shows(page, by(page, "list", "Capture panels"))
        posts = calls(page, "/capture")
        lose_reply(page, "**/capture")
        queue_reading(page, "Roof", 431)
        queue_reading(page, "Bonnet", 120)
        click(btn(page, "Send now"))
        holds(page, page.locator("body"), "No signal. Items stay queued on this device.")
        queue = by(page, "list", "Capture queue")
        expect(queue).not_to_contain_text("Synced")
        holds(page, queue, "Queued")
        assert len(inspector_readings(owner, car["id"], "roof")) == 1
        page.unroute("**/capture")
        page.reload()
        shows(page, btn(page, "Send now"))
        posts.clear()
        with held(page, "**/capture") as release:
            click(btn(page, "Send now"))
            soon(page, lambda: _at_least(posts, 1))
            holds(page, queue, "Sending")
            expect(queue).not_to_contain_text("Synced")
            btn(page, "Send now").focus()
            page.keyboard.press("Enter")
            flush(page)
            assert len(posts) == 1
            release()
        reads(page, status(page, "Capture status"), "All items synced")
        expect(queue.get_by_role("listitem").filter(has_text="Synced")).to_have_count(2)
        posts.clear()
        click(btn(page, "Send now"))
        flush(page)
        assert posts == []
    assert len(inspector_readings(owner, car["id"], "roof")) == 1
    assert len(inspector_readings(owner, car["id"], "bonnet")) == 1


@pytest.mark.timeout(300)
def test_wf_inspector_capture_two_tabs(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"], "inspector")["token"]
    with at(WorkerBrowser(browser), app_url, f"/l/{token}") as page:
        inspector_ready(page)
        other = page.context.new_page()
        other.goto(f"{app_url}/l/{token}")
        shows(other, by(other, "list", "Capture panels"))
        state = {"active": 0, "peak": 0}

        def slow(route):
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
            reply = route.fetch()
            route.fulfill(response=reply)
            state["active"] -= 1
        page.context.route("**/capture", slow)
        page.context.set_offline(True)
        panels = (("Roof", 431), ("Bonnet", 120), ("Offside door", 300))
        for label, microns in panels:
            queue_reading(page, label, microns)
        other_panels = (("Nearside door", 301), ("Boot lid", 122), ("Offside sill", 302))
        for label, microns in other_panels:
            select(by(other, "combobox", "Panel"), label)
            fill(by(other, "spinbutton", "Microns"), str(microns))
            click(btn(other, "Queue reading"))
        rows = by(page, "list", "Capture queue").get_by_role("listitem")
        soon(page, lambda: expect(rows).to_have_count(6, timeout=QUICK_MS))
        other.reload()
        expect(by(other, "list", "Capture queue").get_by_role("listitem")).to_have_count(6)
        page.context.set_offline(False)
        soon(page, lambda: expect(rows.filter(has_text="Synced")).to_have_count(6, timeout=QUICK_MS), 40)
        other_rows = by(other, "list", "Capture queue").get_by_role("listitem")
        soon(other, lambda: expect(other_rows.filter(has_text="Synced")).to_have_count(6, timeout=QUICK_MS))
        assert state["peak"] == 1
        other.close()
    for panel in ("roof", "bonnet", "os-door", "ns-door", "boot-lid", "os-sill"):
        assert len(inspector_readings(owner, car["id"], panel)) == 1, panel


def test_inspector_capture_tap(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"], "inspector")["token"]
    with at(browser, app_url, f"/l/{token}", PHONE) as page:
        diagram = by(page, "img", "Panel diagram")
        shows(page, diagram)
        select(by(page, "combobox", "Panel"), "Roof")
        panel_rect(diagram, "roof")
        flush(page)
        box = panel_rect(diagram, "roof")
        top = page.evaluate("window.scrollY")
        touch_tap(page, box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.75)
        flush(page)
        assert page.evaluate("window.scrollY") == top
        fill(by(page, "textbox", "Finding note"), TAPPED_NOTE)
        click(btn(page, "Queue finding"))
        click(btn(page, "Send now"))
        reads(page, status(page, "Capture status"), "All items synced")
    panel = next(p for p in owner.get(f"/api/owner/cars/{car['id']}/panels").json()["panels"] if p["id"] == "roof")
    mark = panel["inspectorFindings"][0]
    assert abs(mark["u"] - 0.25) <= 0.05 and abs(mark["v"] - 0.75) <= 0.05 and mark["wording"] == TAPPED_NOTE


def test_alert_content_free(browser, ntfy, app_url):
    owner = Owner(app_url)
    car = owner.live()
    slot = owner.slot(car["id"])
    buyer = fresh("Private buyer")
    link = owner.link(car["id"], "buyer", buyer)
    read_all(app_url, link["token"])
    claims, offers = topic_count(ntfy, "New viewing claim"), topic_count(ntfy, "New offer")
    assert claim(app_url, link["token"], slot["id"]).status_code == 201
    assert send_offer(app_url, link["token"]).status_code == 201
    api_until(lambda: len(owner.alerts(car["id"])) == 2 and all(a["state"] == "delivered" for a in owner.alerts(car["id"])),
              "both alerts delivered")
    assert sorted(a["kind"] for a in owner.alerts(car["id"])) == ["new_offer", "viewing_claim"]
    assert all(a["deliveredAt"] and a["attempts"] >= 1 for a in owner.alerts(car["id"]))
    assert topic_count(ntfy, "New viewing claim") == claims + 1 and topic_count(ntfy, "New offer") == offers + 1
    messages = ntfy.messages(TOPIC)
    assert all(m.get("title") == "Open Bonnet" for m in messages[-2:])
    text = json.dumps(messages)
    for private in (buyer, car["name"], "T317HJN", "Larkfield", "15400", "15,400"):
        assert private not in text
    short = Owner(os.environ["APP_SHORT_TIMERS_URL"])
    lapsing = short.live()
    warned = topic_count(ntfy, "Offer about to lapse")
    offering_buyer(short, lapsing)
    api_until(lambda: [a for a in short.alerts(lapsing["id"]) if a["kind"] == "offer_lapsing" and a["state"] == "delivered"],
              "one offer_lapsing alert", 45)
    api_until(lambda: topic_count(ntfy, "Offer about to lapse") >= warned + 1, "the lapse warning on the topic", 15)
    assert len([a for a in short.alerts(lapsing["id"]) if a["kind"] == "offer_lapsing"]) == 1


def test_wf_owner_alerts_retry_parallel(browser, ntfy, app_url):
    owner = Owner(app_url)
    down_url = os.environ["APP_NTFY_DOWN_URL"]
    car = owner.live()
    slot = owner.slot(car["id"])
    link = owner.link(car["id"])
    before = topic_count(ntfy, "New viewing claim")
    assert claim(down_url, link["token"], slot["id"]).status_code == 201
    failed = api_until(lambda: [a for a in owner.alerts(car["id"]) if a["state"] == "failed"], "the alert failed")[0]
    assert failed["deliveredAt"] is None
    assert topic_count(ntfy, "New viewing claim") == before
    assert owner.car(car["id"])["standing"]["failedAlerts"] == 1
    down = Owner(down_url)
    reply = down.post(f"/api/owner/alerts/{failed['id']}/retry")
    assert reply.status_code == 503 and reply.json()["error"] == "alert_undelivered"
    second = Owner(app_url)
    with ThreadPoolExecutor(3) as pool:
        replies = list(pool.map(lambda o: o.post(f"/api/owner/alerts/{failed['id']}/retry"), (owner, second, owner)))
    assert sorted(r.status_code for r in replies) == [200, 409, 409]
    assert {r.json()["error"] for r in replies if r.status_code == 409} <= {"alert_retry_in_progress", "alert_already_delivered"}
    api_until(lambda: owner.alerts(car["id"])[0]["state"] == "delivered", "the retried alert delivered")
    assert topic_count(ntfy, "New viewing claim") == before + 1
    late = owner.post(f"/api/owner/alerts/{failed['id']}/retry")
    assert late.status_code == 409 and late.json()["error"] == "alert_already_delivered"
    other_slot = owner.slot(car["id"], SLOT_B)
    other = owner.link(car["id"])
    assert claim(down_url, other["token"], other_slot["id"]).status_code == 201
    api_until(lambda: [a for a in owner.alerts(car["id"]) if a["state"] == "failed"], "second alert failed")
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#alerts") as page:
        alerts = by(page, "list", "Alerts")
        retry = btn(alerts, "Retry")
        shows(page, retry)
        holds(page, alerts, "Failed")
        kept = hold_reply(page, "**/retry")
        retry.focus()
        page.keyboard.press("Enter")
        soon(page, lambda: _at_least(kept, 1))
        expect(retry).to_have_attribute("aria-disabled", "true")
        poll(page, "/api/owner/")
        poll(page, "/api/owner/")
        expect(retry).to_be_focused()
        expect(retry).to_have_attribute("aria-disabled", "true")
        route, response = kept[0]
        route.fulfill(response=response)
        reads(page, status(page, "Owner status"), "Alert delivered")
        gone(page, btn(alerts, "Retry"))
        soon(page, lambda: _focus_role(page))


def _focus_role(page):
    role = page.evaluate("(() => { const e = document.activeElement; return e.getAttribute('role') || e.tagName; })()")
    assert role in ("listitem", "LI"), role


@pytest.mark.timeout(300)
def test_wf_owner_alerts_sheet_retry(browser, ntfy, app_url):
    owner = Owner(app_url)
    down_url = os.environ["APP_NTFY_DOWN_URL"]
    down = Owner(down_url)
    car = owner.live()
    slot = owner.slot(car["id"])
    link = owner.link(car["id"])
    assert claim(down_url, link["token"], slot["id"]).status_code == 201
    api_until(lambda: [a for a in owner.alerts(car["id"]) if a["state"] == "failed"], "the alert failed")
    with owner_page(browser, down, f"/owner/cars/{car['id']}", PHONE) as page:
        names = tab_order(page, 30)
        assert "Close" not in names, "a closed sheet control took focus"
        tap(btn(page, "Sections"))
        sheet = dialog(page, "Car file sections")
        shows(page, sheet)
        retry = btn(sheet, "Retry")
        shows(page, retry)
        box = retry.bounding_box()
        assert box["height"] >= TARGET and box["width"] >= TARGET
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        assert page.evaluate("([x, y, n]) => document.elementFromPoint(x, y).textContent.includes(n)", [x, y, "Retry"])
        dialog_status = status(sheet, "Dialog status")
        watch(dialog_status)
        text = "Phone alert failed. It stays in your alert list."
        for count in (1, 2):
            touch_tap(page, x, y)
            soon(page, lambda: _count(writes(dialog_status), text, count))
            expect(sheet).to_be_visible()
        assert writes(dialog_status) == ["Sending alert", text, "Sending alert", text]
        expect(retry).to_be_focused()
    before = topic_count(ntfy, "New viewing claim")
    with owner_page(browser, owner, f"/owner/cars/{car['id']}", PHONE) as page:
        tap(btn(page, "Sections"))
        sheet = dialog(page, "Car file sections")
        shows(page, sheet)
        tap(btn(sheet, "Retry"))
        holds(page, status(sheet, "Dialog status"), "Alert delivered")
        focused(page, by(sheet, "link", "Alerts"))
        line(page, "Failed alerts: 0")
    assert owner.alerts(car["id"])[0]["state"] == "delivered"
    api_until(lambda: topic_count(ntfy, "New viewing claim") == before + 1, "exactly one message", 15)


def test_run_and_health(app_url):
    reply = httpx.get(f"{app_url}/api/health")
    assert reply.status_code == 200 and reply.json() == {"status": "ok"}
    for name in ("APP_WIREMOCK_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_GOTENBERG_DOWN_URL", "APP_NTFY_DOWN_URL"):
        assert httpx.get(f"{os.environ[name]}/api/health").json() == {"status": "ok"}
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    processes, logs = [], []
    try:
        for port in SERVE_PORTS:
            log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
            logs.append(log)
            processes.append(subprocess.Popen(shlex.split(manifest["serve"]), cwd=DEPLOYED_APP, stdout=log, stderr=log,
                                              env={**os.environ, "APP_PUBLIC_PORT": str(port)}, start_new_session=True))

        def healthy():
            for process, log in zip(processes, logs):
                if process.poll() is not None:
                    pytest.fail(f"copy exited: {Path(log.name).read_text()[-800:]}")
            try:
                return all(httpx.get(f"http://127.0.0.1:{p}/api/health").status_code == 200 for p in SERVE_PORTS)
            except httpx.HTTPError:
                return False
        api_until(healthy, "both copies report health", 60)
        owner = Owner(app_url)
        cars = owner.get("/api/owner/cars").json()["cars"]
        assert [c["name"] for c in cars].count(SEED_CAR) == 1
        assert [c["name"] for c in cars].count(SEED_DRAFT) == 1
        assert view(f"http://127.0.0.1:{SERVE_PORTS[0]}", ROWAN)["car"]["name"] == SEED_CAR
    finally:
        for process in processes:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=20)


def test_server_boundary(app_url):
    session_path = f"{app_url}/api/owner/session"
    headers = {"Content-Type": "application/json"}

    def padded(size):
        head = b'{"passphrase":"x"}'
        return head + b" " * (size - len(head))
    assert httpx.post(session_path, content=padded(JSON_LIMIT), headers=headers).status_code == 401
    over = httpx.post(session_path, content=padded(JSON_LIMIT + 1), headers=headers)
    assert over.status_code == 413 and over.json()["error"] == "body_too_large"
    wrong = httpx.post(session_path, content=b"passphrase=x", headers={"Content-Type": "text/plain"})
    assert wrong.status_code == 415 and wrong.json()["error"] == "unsupported_media_type"
    assert httpx.post(f"{app_url}/api/owner/cars", content=padded(JSON_LIMIT + 1), headers=headers).status_code == 413
    foreign = httpx.post(session_path, json={"passphrase": PASSPHRASE}, headers={"Origin": "https://evil.example"})
    assert foreign.status_code == 403 and foreign.json()["error"] == "cross_origin"
    assert "ob_owner" not in foreign.cookies
    plain = httpx.get(f"{app_url}/api/health", headers={"Origin": "https://evil.example"})
    assert CORS_HEADER not in plain.headers
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"], "inspector")["token"]
    body = {"batchId": str(uuid.uuid4()), "items": [capture_row()]}
    raw = json.dumps(body).encode()
    path = f"{app_url}/api/link/{token}/capture"
    assert httpx.post(path, content=raw + b" " * (CAPTURE_LIMIT - len(raw)), headers=headers).status_code == 200
    assert httpx.post(path, content=raw + b" " * (CAPTURE_LIMIT + 1 - len(raw)), headers=headers).json()["error"] == "body_too_large"
    data, ctype = multipart({"kind": "photo", "plateMask": "null"}, "a.png", b"\0" * (REQUEST_LIMIT + 1), "image/png")
    big = owner.post(f"/api/owner/cars/{car['id']}/uploads", content=data, headers={"Content-Type": ctype})
    assert big.status_code == 413 and big.json()["error"] == "file_too_large"
    for leaked in ("/package.json", "/package-lock.json", "/run.json", "/.env", "/tsconfig.json", "/src/server.ts",
                   "/THIRD_PARTY_NOTICES.md", "/.git/config", "/server/index.ts"):
        assert httpx.get(app_url + leaked).status_code == 404, leaked
    page = httpx.get(f"{app_url}/owner").text
    assets = [page] + [httpx.get(app_url + src).text for src in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', page)]
    secrets = [os.environ[n] for n in ("S3_SECRET_ACCESS_KEY", "NTFY_PASSWORD", "DATABASE_URL") if len(os.environ.get(n, "")) > 3]
    for text in assets:
        assert PASSPHRASE not in text
        assert all(secret not in text for secret in secrets)


def test_seeded_start(browser, app_url):
    owner = Owner(app_url)
    car = owner.by_name(SEED_CAR)
    draft = owner.by_name(SEED_DRAFT)
    assert car["registration"] == "S482KVT" and car["askingPounds"] == SEED_ASKING and car["viewingArea"] == "Near Hexham"
    assert car["listingStatus"] == "live" and car["currentVersion"] == 1 and car["workingOpenAdvisories"] == 1
    assert car["homeAddress"] == "7 Larkfield Close, Hexham NE46 9ZZ"
    assert draft["registration"] == "T317HJN" and draft["askingPounds"] == DRAFT_ASKING and draft["listingStatus"] == "draft"
    assert draft["pulledAt"] is None and draft["standing"]["findings"] == 0 and draft["standing"]["activeLinks"] == 0
    panels = owner.get(f"/api/owner/cars/{car['id']}/panels").json()
    assert panels["medians"] == {"steel": 121, "aluminium": 100}
    bands = {p["id"]: p["owner"] and p["owner"]["band"] for p in panels["panels"]}
    assert bands["os-sill"] == "Filler" and bands["os-front-wing"] == "Refinished"
    findings = owner.findings(car["id"])
    assert [f["title"] for f in findings] == ["Stone chips", "Resprayed wing", "Door dent", "Sill filler", "Lid lacquer",
                                              "Corner scuff", "Arch bubbling", "Window rubber", "Faded clear coat"]
    assert all(f["photoId"] for f in findings)
    assert findings[3]["u"] == 0.72 and findings[3]["severity"] == "serious"
    advisories = {a["text"]: a for a in owner.get(f"/api/owner/cars/{car['id']}/record").json()["advisories"]}
    assert advisories["Front brake disc slightly pitted"]["note"] == "Discs and pads replaced in April 2026"
    assert advisories["Offside sill corroded but not seriously weakened"]["stance"] == "monitoring"
    links = {l["name"]: l for l in owner.links(car["id"])}
    assert set(links) >= {"Rowan Hale", "Dev Marlowe", "Imogen Achebe", "Tam Okafor"}
    assert view(app_url, ROWAN)["progress"]["seen"] == 0 and view(app_url, ROWAN)["heroFindingId"] == findings[3]["id"]
    assert view(app_url, DEV)["progress"]["seen"] == 4
    imogen = view(app_url, IMOGEN)
    assert imogen["progress"] == {"seen": 9, "total": 9, "materialUnseen": 0}
    assert imogen["offer"]["amountPounds"] == OFFER and imogen["offer"]["status"] == "open"
    assert view(app_url, TAM)["role"] == "inspector"
    slots = sorted(owner.slots(car["id"]), key=lambda s: s["startsAt"])
    assert len(slots) == 3 and all(s["durationMinutes"] == 45 and s["label"].startswith("Sat ") and "10:30" in s["label"] for s in slots)
    assert slots[0]["holderName"] == "Imogen Achebe" and slots[1]["holderName"] is None
    assert owner.alerts(car["id"]) == []
    uploads = owner.get(f"/api/owner/cars/{car['id']}/uploads").json()["uploads"]
    assert sum(u["kind"] == "photo" for u in uploads) == 9 and all(u["locationRemoved"] for u in uploads if u["kind"] == "photo")
    assert [u["label"] for u in uploads if u["kind"] == "invoice"] == ["Wing respray invoice, 2019"]
    store = S3()
    assert len(store.keys(f"originals/{car['id']}/")) == 10 and len(store.keys(f"derivatives/{car['id']}/")) == 9
    assert store.keys(f"reports/{car['id']}/v1.pdf")
    assert owner.post("/api/owner/session", json={"passphrase": PASSPHRASE}).status_code == 200


def _buttons_fit(page) -> None:
    width = page.viewport_size["width"]
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    for control in page.get_by_role("button").all():
        if control.is_visible():
            box = control.bounding_box()
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1


def test_responsive_frame(browser, app_url):
    owner = Owner(app_url)
    car = owner.by_name(SEED_CAR)
    token = owner.link(owner.live()["id"])["token"]
    for size in VIEWPORTS:
        with buyer_page(browser, app_url, token, size) as page:
            _buttons_fit(page)
            axe(page)
            expect(page.get_by_role("contentinfo")).to_have_count(1)
            if size is PHONE:
                menu = btn(page, "Menu")
                expect(menu).to_be_visible()
                go(page, 500)
                assert menu.bounding_box()["y"] < 100, "the header stays fixed on a phone"
                foot = page.get_by_role("contentinfo")
                head = foot.get_by_role("button").first
                head.scroll_into_view_if_needed()
                expect(head).to_have_attribute("aria-expanded", "false")
                before = foot.get_by_role("link").count()
                tap(head)
                expect(head).to_have_attribute("aria-expanded", "true")
                soon(page, lambda: _at_least(range(foot.get_by_role("link").count()), before + 1))
                tap(head)
                expect(head).to_have_attribute("aria-expanded", "false")
            else:
                expect(btn(page, "Menu")).to_have_count(0)
                expect(by(page, "navigation", "Car file")).to_be_visible()
                go(page, 500)
                nav_box = by(page, "navigation", "Car file").bounding_box()
                assert nav_box is None or nav_box["y"] < 0 or stage(page).get_attribute("data-beat") == "0"
        with owner_page(browser, owner, f"/owner/cars/{car['id']}", size) as page:
            layout(page)
            axe(page)
            expect(btn(page, "Sign out")).to_be_visible()
            expect(status(page, "Owner status")).to_have_count(1)
            if size is PHONE:
                for name in ("Panel readings", "People", "Offers"):
                    table = by(page, "table", name)
                    box = table.bounding_box()
                    assert box["x"] >= 0 and box["x"] + box["width"] <= PHONE["width"], name
                    assert table.get_by_role("row").count() > 0
                for button in by(page, "table", "People").get_by_role("button").all():
                    assert button.bounding_box()["height"] >= TARGET
        with at(browser, app_url, f"/l/{TAM}", size) as page:
            shows(page, by(page, "list", "Capture panels"))
            layout(page)
        with at(browser, app_url, "/l/unknown-token-value", size) as page:
            shows(page, heading(page, "We could not find that link"))
            layout(page)


def test_entrances_and_idle(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    infinite = "() => document.getAnimations().filter(a => a.effect.getComputedTiming().iterations === Infinity).length"
    with buyer_page(browser, app_url, token) as page:
        area = stage(page)
        advance(page, STEP_MS)
        rest = frames(area)
        advance(page, IDLE_MS)
        assert frames(area) == rest, "the scene drew while idle"
        assert page.evaluate(infinite) == 0
        poll(page, "/api/link/")
        assert frames(area) == rest, "a poll with no change drew a frame"
        target = heading(page, "Viewings")
        target.scroll_into_view_if_needed()
        path = motion(target, ENTRANCE_MS)
        assert path[0]["y"] >= path[-1]["y"], "the heading rises into place"
        assert abs(path[-1]["y"] - path[-2]["y"]) <= max(1, abs(path[0]["y"] - path[-1]["y"]) / 2), "the entrance has settled"
        go(page, 0)
        target.scroll_into_view_if_needed()
        again = []
        for _ in range(6):
            advance(page, round(ENTRANCE_MS / 6))
            again.append(target.evaluate("""e => ({y: e.getBoundingClientRect().y + window.scrollY,
                running: e.getAnimations({subtree: true}).filter(a => a.playState === "running").length})"""))
        assert max(p["y"] for p in again) - min(p["y"] for p in again) < 1, "the entrance plays once"
        assert not any(p["running"] for p in again), "the entrance plays once"
    with buyer_page(browser, app_url, token, reduced_motion="reduce") as page:
        target = heading(page, "Viewings")
        target.scroll_into_view_if_needed()
        flush(page)
        assert animations(target) == []
        assert float(style(target, "opacity")["opacity"]) == 1
        assert page.evaluate(infinite) == 0


DPR_CASES = ["dpr1", "dpr2", "dpr3"]


@pytest.mark.parametrize("scale", [1, 2, 3], ids=DPR_CASES)
@pytest.mark.timeout(300)
def test_scene_markers(browser, app_url, scale):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token, scale=scale) as page:
        findings = view(app_url, token)["findings"]
        hero = view(app_url, token)["heroFindingId"]
        target = spot = None
        for k in range(1, len(findings) + 1):
            go(page, BEAT * (k + 0.5), k)
            data = attrs(stage(page))
            anchor = [float(n) for n in data["data-anchor"].split(",")]
            current = next((f for f in findings if f["id"] != hero and f["panelId"] == data["data-panel"]
                            and abs(f["u"] - anchor[0]) < 1e-3 and abs(f["v"] - anchor[1]) < 1e-3), None)
            if current is not None:
                target = current
                break
        assert target is not None, "no non-hero finding reached through the walkround beats"
        canvas = surface(page)
        box = canvas.bounding_box()
        spot = project(data, world(target["panelId"], target["u"], target["v"]), box)
        assert spot[2] > 0 and box["x"] + 30 < spot[0] < box["x"] + box["width"] - 30 \
            and box["y"] + 30 < spot[1] < box["y"] + box["height"] - 30, (spot, box)
        x, y = spot[0] - box["x"], spot[1] - box["y"]

        def profile():
            ring = [[x + r * dx, y + r * dy, 3] for r in (6, 8, 10, 12) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            means = lum(canvas, [[x, y, 5]] + ring)["means"]
            peak = max(sum(means[1 + i * 4:5 + i * 4]) / 4 for i in range(4))
            return means[0], peak

        core, peak = profile()
        assert peak >= 2 * max(core, 1), (core, peak)
        assert see(app_url, token, target["id"]).status_code == 201
        poll(page, "/api/link/")
        advance(page, STEP_MS)
        filled, _ = profile()
        assert filled >= 2 * max(core, 1), (core, filled)
        current = next(f for f in owner.findings(car["id"]) if f["id"] == target["id"])
        owner.amend(car["id"], current, wording=fresh("Changed"))
        poll(page, "/api/link/")
        advance(page, STEP_MS)
        ring_core, ring_peak = profile()
        assert ring_core * 2 <= filled and ring_peak >= 2 * max(ring_core, 1), (ring_core, ring_peak, filled)


def test_walkround_dock(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    with buyer_page(browser, app_url, token, PHONE) as page:
        dock = region(page, "Walkround dock")
        shows(page, dock)
        box = dock.bounding_box()
        assert box["height"] <= DOCK_MAX and abs(box["y"] + box["height"] - PHONE["height"]) <= 1
        expect(status(dock, "Seen count")).to_have_text("0 of 3 seen")
        expect(status(page, "Seen count")).to_have_count(1)
        unread = btn(dock, "Next unread")
        expect(unread).to_be_visible()
        expect(btn(dock, "To the offer")).to_have_count(0)
        assert unread.bounding_box()["height"] >= TARGET
        go(page, 300)
        assert abs(dock.bounding_box()["y"] + dock.bounding_box()["height"] - PHONE["height"]) <= 1
        read_all(app_url, token)
        poll(page, "/api/link/")
        to_offer = btn(dock, "To the offer")
        shows(page, to_offer)
        expect(btn(dock, "Next unread")).to_have_count(0)
        tap(to_offer)
        focused(page, btn(page, "Make an offer"))
        page.set_viewport_size(TABLET)
        gone(page, dock)
        expect(status(page, "Seen count")).to_have_count(1)


def test_car_file_bar(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}", PHONE) as page:
        bar = region(page, "Car file bar")
        shows(page, bar)
        holds(page, bar, "Live")
        box = bar.bounding_box()
        assert abs(box["y"] + box["height"] - PHONE["height"]) <= 1
        expect(by(page, "navigation", "Car file sections")).to_have_count(0)
        tap(btn(bar, "Sections"))
        sheet = dialog(page, "Car file sections")
        shows(page, sheet)
        nav = by(sheet, "navigation", "Car file sections")
        expect(nav.get_by_role("listitem")).to_have_count(9)
        holds(page, nav, "Findings: 3")
        expect(by(nav, "link", "Findings")).to_have_count(1)
        tap(by(nav, "link", "Offers"))
        focused(page, heading(page, "Offers"))
        assert page.url.endswith("#offers")
        page.set_viewport_size(TABLET)
        gone(page, bar)
        shows(page, by(page, "navigation", "Car file sections"))


def test_closed_overlays_clear(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]

    def clear_of(page, bar):
        rect = page.evaluate("(() => { const r = document.activeElement.getBoundingClientRect(); return [r.top, r.bottom]; })()")
        top = bar.bounding_box()["y"]
        assert rect[1] <= top + 1 or rect[0] >= top + bar.bounding_box()["height"], (rect, top)

    with buyer_page(browser, app_url, token, PHONE) as page:
        click(btn(page, "Menu"))
        menu = dialog(page, "Menu")
        shows(page, menu)
        click(btn(menu, "Close"))
        gone(page, menu)
        names = tab_order(page, 25)
        assert "Close" not in names and "Walkround" not in names
        dock = region(page, "Walkround dock")
        for _ in range(12):
            page.keyboard.press("Tab")
            advance(page, STEP_MS)
            if not dock.evaluate("(e) => e.contains(document.activeElement) || document.activeElement === document.body"):
                clear_of(page, dock)
    with owner_page(browser, owner, f"/owner/cars/{car['id']}", PHONE) as page:
        names = tab_order(page, 25)
        assert "Close" not in names
        open_section(page, "Publish")
        clear_of(page, region(page, "Car file bar"))


@pytest.mark.timeout(300)
def test_wf_cross_cutting_polls_leave_page_alone(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}", PHONE) as page:
        open_section(page, "People")
        fill(by(page, "textbox", "Person's name"), fresh("Kept"))
        tap(btn(page, "Create link"))
        area = region(page, "New link")
        shows(page, area)
        address = area.get_by_role("link").inner_text()
        open_section(page, "Viewings")
        field = by(page, "textbox", "Viewing date and time")
        fill(field, SLOT_A)
        top = page.evaluate("window.scrollY")
        poll(page, "/api/owner/")
        expect(field).to_have_value(SLOT_A)
        expect(field).to_be_focused()
        assert page.evaluate("window.scrollY") == top
        expect(area.get_by_role("link")).to_have_text(address)
        tap(btn(page, "Sections"))
        sheet = dialog(page, "Car file sections")
        shows(page, sheet)
        owner.slot(car["id"], SLOT_B)
        poll(page, "/api/owner/")
        expect(sheet).to_be_visible()
        holds(page, sheet, "Slots held: 0 of 1")
    link = owner.link(car["id"])
    slot = owner.slot(car["id"], SLOT_C)
    with buyer_page(browser, app_url, link["token"]) as page:
        btn(page, f"Claim {slot['label']}").focus()
        page.keyboard.press("Enter")
        box = dialog(page, "Claim viewing")
        shows(page, box)
        count = frames(stage(page))
        poll(page, "/api/link/")
        expect(box).to_be_visible()
        assert frames(stage(page)) == count
        owner.post(f"/api/owner/links/{link['id']}/revoke")
        poll(page, "/api/link/")
        shows(page, heading(page, "This link has ended"))
        expect(box).to_have_count(0)


def test_overlay_exits(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    token = owner.link(car["id"])["token"]
    read_all(app_url, token)
    with buyer_page(browser, app_url, token, PHONE) as page:
        go(page, BEAT * 1.5, 1)
        posts = calls(page, "/seen")
        page.evaluate("() => { window.__scrolls = 0; addEventListener('scroll', () => window.__scrolls++); }")
        top = page.evaluate("window.scrollY")
        count = frames(stage(page))
        opener = btn(page, "Menu")
        tap(opener)
        menu = dialog(page, "Menu")
        shows(page, menu)
        tap(btn(menu, "Close"))
        expect(opener).to_be_focused()
        tap(opener)
        advance(page, EXIT_MS * 2)
        shows(page, menu, 2)
        touch_tap(page, 10, 10)
        gone(page, menu)
        flush(page)
        assert page.evaluate("window.scrollY") == top and page.evaluate("window.__scrolls") == 0
        assert frames(stage(page)) == count and posts == []
        go(page, 0)
        open_offer_dialog(page)
        box = dialog(page, "Make an offer")
        touch_tap(page, 10, 10)
        advance(page, EXIT_MS * 2)
        expect(box).to_be_visible()
    with owner_page(browser, owner, f"/owner/cars/{car['id']}", PHONE) as page:
        tap(btn(page, "Sections"))
        sheet = dialog(page, "Car file sections")
        shows(page, sheet)
        touch_tap(page, 187, 10)
        gone(page, sheet)


@pytest.mark.timeout(300)
def test_wf_cross_cutting_announced_poll_changes(browser, app_url):
    owner = Owner(app_url)
    car = owner.live()
    name = fresh("Chosen")
    _, _ = offering_buyer(owner, car, name)
    offering_buyer(owner, car, fresh("Other"), SECOND_OFFER)
    slot = owner.slot(car["id"])
    claimer = owner.link(car["id"])
    late = owner.link(car["id"])
    read_all(app_url, late["token"])
    with owner_page(browser, owner, f"/owner/cars/{car['id']}#offers") as page:
        live = status(page, "Owner status")
        watch(live)
        click(btn(by(page, "table", "Offers").get_by_role("row").filter(has_text=name), "Accept"))
        box = dialog(page, "Accept offer")
        shows(page, box)
        assert claim(app_url, claimer["token"], slot["id"]).status_code == 201
        assert send_offer(app_url, late["token"]).status_code == 201
        poll(page, "/api/owner/")
        holds(page, box, "Other open offers closed: 2")
        assert writes(live) == []
        btn(box, "Confirm acceptance").focus()
        page.keyboard.press("Enter")
        success = "Offer accepted. Other open offers are closed."
        soon(page, lambda: _count(writes(live), "Slots held: 1 of 1", 1))
        log = writes(live)
        assert log.index(success) < log.index("Slots held: 1 of 1")
        assert not [item for item in log if item.startswith("Live offers")]
        poll(page, "/api/owner/")
        assert writes(live) == log


def test_if_run_manifest():
    data = json.loads(Path("/app/run.json").read_text())
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[key], str) and data[key] for key in ("install", "build", "serve"))


def test_if_notices():
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "Outfit" in text
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert missing == []


def test_if_licences():
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert refused == []


def test_if_datastores():
    assert Postgres().tables()
    names = {p.name for p in shipped_packages()}
    assert not names & {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "level", "pouchdb"}


def test_if_typescript_source():
    skip = {"node_modules", "dist", "build", ".git", "public", "coverage"}
    found = [str(p) for p in Path("/app").rglob("*") if p.suffix in (".js", ".jsx") and p.parent != Path("/app")
             and not skip & set(p.parts) and ".config." not in p.name]
    assert found == []


def test_if_same_origin(browser, app_url):
    owner = Owner(app_url)
    car = owner.by_name(SEED_CAR)
    with at(browser, app_url, "/api/health") as page:
        seen: list = []
        page.on("request", lambda r: seen.append(r.url))
        page.goto(f"{app_url}/l/{ROWAN}")
        shows(page, stage(page))
        page.context.add_cookies([{"name": "ob_owner", "value": owner.cookie, "url": app_url}])
        page.goto(f"{app_url}/owner/cars/{car['id']}")
        shows(page, btn(page, "Sign out"))
    assert seen and [u for u in seen if u.startswith("http") and not same_origin(u, app_url)] == []


def test_if_own_assets():
    found = [str(p) for p in Path("/app").rglob("*") if p.suffix.lower() in (".glb", ".gltf", ".fbx", ".obj")
             and "node_modules" not in p.parts]
    assert found == []


def test_if_service_config(wiremock, app_url):
    owner = Owner(app_url)
    car = owner.new_car("T317 HJN")
    tape = owner.pull(car["id"])["tape"]
    assert [s["motTestNumber"] for s in tape] == ["730000000721", "730000000822"]
    assert wiremock.requests("/v1/trade/vehicles/registration/T317HJN")
