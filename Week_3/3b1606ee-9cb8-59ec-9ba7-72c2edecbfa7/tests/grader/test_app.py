from __future__ import annotations

import base64
import concurrent.futures
import contextlib
import datetime as dt
import hashlib
import json
import math
import os
import re
import struct
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    Postgres,
    S3,
    advance,
    check,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    session,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    unique,
)


APP_DIR = Path("/app")
SESSION_COOKIE = "airfold_session"
MINIO_DOWN_URL = os.environ.get("APP_MINIO_DOWN_URL", "")
SHORT_URL = os.environ.get("APP_SHORT_URL", "")

JSON_LIMIT = 131072
DEFAULT_CAP = 26214400
MEGABYTE = 1048576
PAD_BLOCK = 160
GCM_TAG = 16
IV_BYTES = 12
MAX_CIPHERTEXT = 64016
TEXT_CUT = 80
SECOND_MS = 1000
HOUR_MS = 60 * 60 * SECOND_MS
DAY_MS = 24 * HOUR_MS
HOLD_MS = 30 * DAY_MS
RETRACT_MS = 24 * HOUR_MS
COOLDOWN_MS = 7 * DAY_MS
NAME_HOLD_MS = 14 * DAY_MS
RESTORE_TRIES = 5
RESTORE_WINDOW_MS = 60 * SECOND_MS
PHOTO_EDGE = 2048
THUMB_EDGE = 32
GPS_PHOTO = (3000, 2000)
TINY_EDGE = 64
PDF_BYTES = 40000
CRATE_BYTES = 600000
TOUCH_MIN = 44
REDUCED_FADE_MAX_MS = 120
SEND_END_MIN_MS = 900
SEND_END_MAX_MS = 1200
POSTMARK_MAX_MS = 500
STRIKE_TILT_DEG = -8
LONG_PRESS_MS = 500
SEAL_GROUPS = 12
SEAL_GROUP_DIGITS = 5
USERNAME_MAX = 32
RECOVERY_BYTES = 20
RECOVERY_CHARS = 32
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
BADGE_CAP = 99
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
TWO_PANE_MIN = 768
THREE_PANE_MIN = 1200
LIST_SHARE = (0.3, 0.5)
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
DEFAULT_TIMERS = {
    "undo_ms": 5000,
    "connecting_delay_ms": 2000,
    "availability_debounce_ms": 300,
    "retry_base_ms": 1000,
    "retry_cap_ms": 60000,
    "toast_ms": 4000,
}

CHATS_EMPTY = "No letters yet. Find someone by their exact username."
REQUESTS_EMPTY = "No letter requests."
BLOCKED_EMPTY = "You haven't blocked anyone."
CONVERSATION_EMPTY = "Nothing written yet. Your first letter is sealed before it leaves this page."
NOT_FOUND_COPY = "We couldn't find that letter."
LOOKUP_MISS = "No one with that username."
OUTAGE_COPY = "Photos and files can't be sent or opened right now. Letters still go through."
UPLOAD_FAILED = "Couldn't upload. Your letter wasn't sent."
UPLOAD_DONE = "Upload finished."
CORRUPTED = "Attachment corrupted"
WRONG_PHOTO = "Choose a JPEG, PNG or WebP photo."
RECOVERY_MISMATCH = "That group doesn't match your recovery code."
DISPLAY_NAME_EMPTY = "Enter a display name."
RESTORE_FAILED = "That username and recovery code don't match."
SIGNED_OUT_COPY = "This account was restored in another browser, so this browser is signed out."
USERNAME_SAME = "That's already your username."
DELETED_RECIPIENT = "This letter was deleted."
DELETED_SENDER = "You deleted this letter."
SNACKBAR_COPY = "Letter deleted."
RESTORED_COPY = "Letter restored."
CONNECTING = "Connecting..."
CHIP = {
    "available": "Available",
    "taken": "Taken",
    "length": "Use 3 to 32 characters.",
    "characters": "Use only lowercase letters, numbers, underscores and dots.",
    "first_character": "Start with a letter.",
    "last_character": "Don't end with a dot.",
}
POSTED_STATES = ("sent", "delivered", "read")
POSTMARK_LABELS = ("Sending", "Sent", "Delivered", "Read", "Failed", "Received",
                   "Returned: not collected in 30 days")
UNREAD_DISC = re.compile(r"^(\d+|99\+)$")
TIME_PATTERN = r"(\d{2}:\d{2}|\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2})"
ISO_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|\+00:00)$")


HTTP_TIMEOUT = 60
WAIT_S = 30
EXPECT_MS = WAIT_S * 1000
STEP_MS = 100
MARGIN_MS = 60_000
JITTER_MS = 150
TILT_TOLERANCE_DEG = 1
ASPECT_TOLERANCE = 0.01
TAB_LIMIT = 60
TRAP_PRESSES = 6
RACE_SIZE = 6
CAMERA_MAKE = "Halfpenny Optics Mk II"
DATASTORE_CLIENTS = {
    "redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "lowdb", "nedb",
    "level", "memcached", "amqplib", "bullmq", "lmdb", "keyv",
}
STATE_FILE_SUFFIXES = (".sqlite", ".sqlite3", ".db")
CRYPTO_PACKAGES = {
    "tweetnacl", "tweetnacl-util", "libsodium", "libsodium-wrappers", "crypto-js", "node-forge",
    "elliptic", "@noble/curves", "@noble/hashes", "@noble/ciphers", "sjcl", "openpgp", "jose",
    "asmcrypto.js", "@peculiar/webcrypto",
}

SEALER_JS = r"""() => {
  window.AF = (() => {
    const S = crypto.subtle;
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const b64u = (bytes) => {
      const u = new Uint8Array(bytes);
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const unb64u = (text) => {
      let s = text.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bin = atob(s);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    };
    const sha256 = async (u) => new Uint8Array(await S.digest('SHA-256', u));
    const aes = (raw) => S.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const pad = (u) => {
      const out = new Uint8Array((Math.floor(u.length / 160) + 1) * 160);
      out.set(u);
      out[u.length] = 0x80;
      return out;
    };
    const unpad = (u) => {
      let i = u.length - 1;
      while (i >= 0 && u[i] === 0) i--;
      if (u[i] !== 0x80) throw new Error('letter padding does not follow the published scheme');
      return u.slice(0, i);
    };
    const canonical = (code) => code.toUpperCase().replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
    async function recoveryKeys(code) {
      const ikm = await S.importKey('raw', enc.encode(canonical(code)), 'HKDF', false, ['deriveBits']);
      const derive = async (info) => new Uint8Array(await S.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('airfold/v1/recovery'), info: enc.encode(info) }, ikm, 256));
      return { verifier: await derive('airfold/v1/recovery-verifier'), backup: await derive('airfold/v1/key-backup') };
    }
    async function newKey() {
      const pair = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const pub = new Uint8Array(await S.exportKey('raw', pair.publicKey));
      const pkcs8 = new Uint8Array(await S.exportKey('pkcs8', pair.privateKey));
      return { public_key: b64u(pub), pkcs8: b64u(pkcs8), key_id: b64u((await sha256(pub)).slice(0, 12)) };
    }
    async function enrol(username, code) {
      const key = await newKey();
      const r = await recoveryKeys(code);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = await S.encrypt({ name: 'AES-GCM', iv }, await aes(r.backup), unb64u(key.pkcs8));
      return { key, body: { username, public_key: key.public_key, recovery_verifier: b64u(r.verifier),
        key_backup: { iv: b64u(iv), ciphertext: b64u(sealed) } } };
    }
    async function verifier(code) { return b64u((await recoveryKeys(code)).verifier); }
    async function keyId(pub) { return b64u((await sha256(unb64u(pub))).slice(0, 12)); }
    async function convKey(pkcs8, peerPublic, idA, idB) {
      const priv = await S.importKey('pkcs8', unb64u(pkcs8), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const pub = await S.importKey('raw', unb64u(peerPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = await S.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
      const ikm = await S.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
      const salt = await sha256(enc.encode([idA, idB].sort().join(':')));
      return b64u(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('airfold/v1/msg') }, ikm, 256));
    }
    async function seal(rawKey, body) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await S.encrypt({ name: 'AES-GCM', iv }, await aes(unb64u(rawKey)), pad(enc.encode(JSON.stringify(body))));
      return { iv: b64u(iv), ciphertext: b64u(ct) };
    }
    async function open(rawKey, iv, ciphertext) {
      const plain = new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aes(unb64u(rawKey)), unb64u(ciphertext)));
      return { padded: plain.length, body: JSON.parse(dec.decode(unpad(plain))) };
    }
    async function sealBytes(plainB64) {
      const key = crypto.getRandomValues(new Uint8Array(32));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv }, await aes(key), unb64u(plainB64)));
      return { key: b64u(key), iv: b64u(iv), sealed: b64u(sealed), digest: b64u(await sha256(sealed)) };
    }
    async function openBytes(key, iv, sealedB64) {
      return b64u(new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aes(unb64u(key)), unb64u(sealedB64))));
    }
    async function sealNumber(a, b) {
      const A = unb64u(a), B = unb64u(b);
      let order = 0;
      for (let i = 0; i < Math.min(A.length, B.length) && order === 0; i++) order = A[i] - B[i];
      if (order === 0) order = A.length - B.length;
      const [x, y] = order <= 0 ? [A, B] : [B, A];
      const joined = new Uint8Array(x.length + y.length);
      joined.set(x);
      joined.set(y, x.length);
      const h = new Uint8Array(await S.digest('SHA-512', joined));
      const groups = [];
      for (let i = 0; i < 12; i++) {
        let n = 0n;
        for (let j = 0; j < 5; j++) n = n * 256n + BigInt(h[5 * i + j]);
        groups.push(String(n % 100000n).padStart(5, '0'));
      }
      return groups.join(' ');
    }
    function picture(type, width, height) {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#0b1d3a');
      grad.addColorStop(1, '#ff5a1f');
      g.fillStyle = grad;
      g.fillRect(0, 0, width, height);
      for (let i = 0; i < 200; i++) {
        g.fillStyle = `hsl(${(i * 37) % 360},80%,50%)`;
        g.fillRect((i * 97) % width, (i * 53) % height, Math.max(2, width / 60), Math.max(2, height / 60));
      }
      return c.toDataURL(type, 0.9).split(',')[1];
    }
    return { enrol, verifier, keyId, convKey, seal, open, sealBytes, openBytes, sealNumber, picture };
  })();
  return true;
}"""

MOTION_JS = r"""() => {
  const old = window.__afMotion;
  if (old) {
    old.recs = [];
    old.t0 = document.timeline.currentTime;
    old.s.last = 0;
    old.s.turned = false;
    old.s.p0 = performance.now();
    return;
  }
  const m = { recs: [], t0: document.timeline.currentTime, seen: new WeakSet() };
  window.__afMotion = m;
  m.s = { last: 0, turned: false, p0: performance.now(), prev: new WeakMap() };
  const tick = () => {
    const now = performance.now() - m.s.p0;
    for (const n of document.body.querySelectorAll('*')) {
      const t = getComputedStyle(n).transform;
      if (m.s.prev.get(n) !== t) {
        if (m.s.prev.has(n) || t !== 'none') m.s.last = now;
        m.s.prev.set(n, t);
      }
      if (t && t !== 'none') {
        const x = new DOMMatrixReadOnly(t);
        if (!x.is2D || Math.abs(x.d) < 0.99) m.s.turned = true;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const note = (a, target) => {
    if (!a || !a.effect || m.seen.has(a)) return;
    m.seen.add(a);
    const timing = a.effect.getComputedTiming();
    let frames = '';
    try { frames = JSON.stringify(a.effect.getKeyframes()); } catch (e) { frames = ''; }
    const host = target || a.effect.target;
    m.recs.push({
      at: document.timeline.currentTime,
      end: Number.isFinite(Number(timing.endTime)) ? Number(timing.endTime) : -1,
      infinite: timing.iterations === Infinity,
      frames,
      postmark: (() => {
        let n = host;
        for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
          const t = (n.textContent || '').trim();
          if (t.length <= 60 && /^(Sending|Sent|Delivered|Read|Received|Failed|Returned)/.test(t)) return true;
        }
        return false;
      })(),
    });
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const a = animate.call(this, keyframes, options);
    note(a, this);
    return a;
  };
  const fromCss = (event) => { for (const a of event.target.getAnimations()) note(a, event.target); };
  document.addEventListener('animationstart', fromCss, true);
  document.addEventListener('transitionrun', fromCss, true);
}"""

RUNNING_JS = """() => document.getAnimations().filter(a => a.playState === 'running'
  && a.effect && a.effect.getComputedTiming().iterations !== Infinity).length"""
INFINITE_JS = """() => document.getAnimations().filter(a => a.playState === 'running'
  && a.effect && a.effect.getComputedTiming().iterations === Infinity).length"""
RECORDS_JS = """() => window.__afMotion.recs.map(r => Object.assign({}, r, { at: r.at - window.__afMotion.t0 }))"""
TILT_JS = """el => [el, ...el.querySelectorAll('*')].map(n => getComputedStyle(n).transform)
  .filter(t => t && t !== 'none').map(t => { const m = new DOMMatrixReadOnly(t); return Math.atan2(m.b, m.a) * 180 / Math.PI; })"""
DATE_JS = """iso => {
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}"""


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def new_id() -> str:
    return str(uuid.uuid4())


def tag() -> str:
    return uuid.uuid4().hex[:6]


def fresh_name(prefix: str = "af") -> str:
    stem = re.sub(r"[^a-z0-9]", "", str(unique(prefix)[0]).lower())[-6:]
    return f"{prefix}{stem}{uuid.uuid4().hex[:10]}"


def recovery_code() -> str:
    n = int.from_bytes(os.urandom(RECOVERY_BYTES), "big")
    chars = "".join(CROCKFORD[(n >> (5 * (RECOVERY_CHARS - 1 - i))) & 31] for i in range(RECOVERY_CHARS))
    return "-".join(chars[i:i + 4] for i in range(0, RECOVERY_CHARS, 4))


def ts(text: str) -> dt.datetime:
    return dt.datetime.fromisoformat(text.replace("Z", "+00:00"))


def err(r: httpx.Response) -> str:
    return f"{r.request.method} {r.request.url.path} answered {r.status_code} {r.text[:300]}"


def session_cookie(r: httpx.Response) -> str:
    for header in r.headers.get_list("set-cookie"):
        name, _, rest = header.partition("=")
        if name.strip() == SESSION_COOKIE:
            return rest.split(";", 1)[0]
    pytest.fail(f"{err(r)} without a {SESSION_COOKIE} cookie")


def config(base: str) -> dict:
    r = httpx.get(f"{base}/api/config", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, err(r)
    return r.json()


def bytes_needles(raw: bytes) -> list[str]:
    return [raw[:24].hex(), b64u(raw[:30]), base64.b64encode(raw[:30]).decode()]


def text_needles(text: str) -> list[str]:
    return [text, text.encode().hex()]


def db_holds(db: Any, needles: list[str]) -> list[str]:
    hits = []
    for table in db.tables():
        ident = table if "." in table else '"' + table.replace('"', '""') + '"'
        for needle in needles:
            pattern = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_").replace("'", "''")
            rows = db.rows(f"SELECT 1 AS hit FROM {ident} AS r WHERE row_to_json(r)::text ILIKE '%{pattern}%' LIMIT 1")
            if rows:
                hits.append(f"{table}: {needle[:16]}")
    return hits


@contextlib.contextmanager
def server_clock(base: str) -> Iterator[Callable[[int], None]]:
    first = httpx.get(f"{base}/api/grading/clock", timeout=HTTP_TIMEOUT)
    assert first.status_code == 200, err(first)
    start = first.json()["offset_ms"]

    def shift(ms: int) -> None:
        r = httpx.post(f"{base}/api/grading/clock", json={"offset_ms": start + ms}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json()["offset_ms"] == start + ms, err(r)

    try:
        yield shift
    finally:
        httpx.post(f"{base}/api/grading/clock", json={"offset_ms": start}, timeout=HTTP_TIMEOUT)


def poll(page: Page | None, ok: Callable[[], bool], expected: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if ok():
                return
        except (PlaywrightError, httpx.HTTPError, KeyError, TypeError, StopIteration):
            pass
        if page is not None:
            advance(page, STEP_MS)
    pytest.fail(f"timed out; expected {expected}")


def release(gate: Any) -> None:
    (getattr(gate, "release", None) or gate)()


@contextlib.contextmanager
def app_page(browser: Browser, url: str, **options: Any) -> Iterator[Page]:
    made = open_app(browser, url, **options)
    if hasattr(made, "__enter__"):
        with made as page:
            yield page
    else:
        page = next(made)
        try:
            yield page
        finally:
            with contextlib.suppress(StopIteration):
                next(made)


def visible(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def in_view(loc: Locator) -> bool:
    if not visible(loc):
        return False
    box = loc.first.bounding_box()
    width = loc.page.viewport_size["width"]
    return box is not None and box["x"] < width and box["x"] + box["width"] > 0 and box["width"] > 0


def focused(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("el => el.contains(document.activeElement)")


def status_text(page: Page, name: str) -> str:
    loc = page.get_by_role("status", name=name)
    return loc.first.inner_text() if loc.count() else ""


def file_payload(name: str, mime: str, data: bytes) -> dict:
    return {"name": name, "mimeType": mime, "buffer": data}


def tab_to(page: Page, target: Locator, what: str) -> None:
    for _ in range(TAB_LIMIT):
        if focused(target):
            return
        page.keyboard.press("Tab")
    pytest.fail(f"Tab never reached {what}")


class Sealer:
    def __init__(self, page: Page) -> None:
        self.page = page

    def __call__(self, fn: str, *args: Any) -> Any:
        return self.page.evaluate("([fn, args]) => window.AF[fn](...args)", [fn, list(args)])


@pytest.fixture
def sealer(browser: Browser, app_url: str) -> Iterator[Sealer]:
    context = browser.new_context()
    page = context.new_page()
    page.goto(f"{app_url}/api/health")
    page.evaluate(SEALER_JS)
    yield Sealer(page)
    context.close()


def exif_segment(make: str) -> bytes:
    mk = make.encode() + b"\x00"
    if len(mk) % 2:
        mk += b"\x00"
    make_off, gps_off = 38, 38 + len(mk)
    lat_off = gps_off + 30
    ifd0 = (struct.pack("<H", 2) + struct.pack("<HHII", 0x010F, 2, len(make) + 1, make_off)
            + struct.pack("<HHII", 0x8825, 4, 1, gps_off) + struct.pack("<I", 0))
    gps = (struct.pack("<H", 2) + struct.pack("<HHI4s", 0x0001, 2, 2, b"N\x00\x00\x00")
           + struct.pack("<HHII", 0x0002, 5, 3, lat_off) + struct.pack("<I", 0))
    lat = struct.pack("<6I", 38, 1, 42, 1, 0, 1)
    payload = b"Exif\x00\x00" + b"II*\x00" + struct.pack("<I", 8) + ifd0 + mk + gps + lat
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


def gps_photo(sealer: Sealer) -> bytes:
    jpeg = base64.b64decode(sealer("picture", "image/jpeg", *GPS_PHOTO))
    return jpeg[:2] + exif_segment(CAMERA_MAKE) + jpeg[2:]


def tiny_png(sealer: Sealer) -> bytes:
    return base64.b64decode(sealer("picture", "image/png", TINY_EDGE, TINY_EDGE))


def ferry_pdf() -> bytes:
    head = b"%PDF-1.4\n% ferry timetable\n"
    return head + b"0" * (PDF_BYTES - len(head))


def jpeg_info(data: bytes) -> tuple[int, int, bool]:
    assert data[:2] == b"\xff\xd8", "expected JPEG bytes"
    i, exif, size = 2, False, None
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01, 0xFF) or 0xD0 <= marker <= 0xD7:
            i += 2 if marker != 0xFF else 1
            continue
        length = int.from_bytes(data[i + 2:i + 4], "big")
        seg = data[i + 4:i + 2 + length]
        if marker == 0xE1 and seg.startswith(b"Exif"):
            exif = True
        if marker in (0xC0, 0xC1, 0xC2) and size is None:
            size = (int.from_bytes(seg[3:5], "big"), int.from_bytes(seg[1:3], "big"))
        if marker == 0xDA:
            break
        i += 2 + length
    assert size is not None, "JPEG without a frame header"
    return size[0], size[1], exif


class Person:

    def __init__(self, base: str, sealer: Sealer) -> None:
        self.base, self.sealer = base, sealer
        self.username = fresh_name()
        self.code = recovery_code()
        made = sealer("enrol", self.username, self.code)
        r = httpx.post(f"{base}/api/accounts", json=made["body"], timeout=HTTP_TIMEOUT)
        assert r.status_code == 201, err(r)
        self.enrolment = made["body"]
        self.cookie = session_cookie(r)
        self.id = r.json()["id"]
        self._use(made["key"])
        self._keys: dict[tuple, str] = {}

    def _use(self, key: dict) -> None:
        self.key_id, self.public_key = key["key_id"], key["public_key"]
        self.private = {**getattr(self, "private", {}), key["key_id"]: key["pkcs8"]}

    def card(self) -> dict:
        return {"id": self.id, "public_key": self.public_key, "key_id": self.key_id, "username": self.username}

    def call(self, method: str, path: str, body: Any = None, *, cookie: str | None = None) -> httpx.Response:
        headers = {"Cookie": f"{SESSION_COOKIE}={cookie or self.cookie}"}
        return httpx.request(method, f"{self.base}{path}", json=body, headers=headers, timeout=HTTP_TIMEOUT)

    def put_content(self, blob_id: str, data: bytes) -> httpx.Response:
        return httpx.put(f"{self.base}/api/blobs/{blob_id}/content", content=data, timeout=HTTP_TIMEOUT,
                         headers={"Cookie": f"{SESSION_COOKIE}={self.cookie}", "Content-Type": "application/octet-stream"})

    def recover(self) -> httpx.Response:
        made = self.sealer("enrol", self.username, self.code)
        r = httpx.post(f"{self.base}/api/recover", json=made["body"], timeout=HTTP_TIMEOUT)
        if r.status_code == 200:
            self.cookie = session_cookie(r)
            self._use(made["key"])
        return r

    def converse(self, peer_id: str) -> dict:
        r = self.call("POST", "/api/conversations", {"peer_id": peer_id})
        assert r.status_code in (200, 201), err(r)
        return r.json()

    def conv_key(self, my_key_id: str, peer_id: str, peer_public: str) -> str:
        k = (my_key_id, peer_id, peer_public)
        if k not in self._keys:
            self._keys[k] = self.sealer("convKey", self.private[my_key_id], peer_public, self.id, peer_id)
        return self._keys[k]

    def letter(self, conv_id: str, peer: dict, body: dict, *, cls: str = "letter",
               letter_id: str | None = None, attachment_id: str | None = None) -> dict:
        sealed = self.sealer("seal", self.conv_key(self.key_id, peer["id"], peer["public_key"]), body)
        payload = {"id": letter_id or new_id(), "conversation_id": conv_id, "class": cls,
                   "recipient_key_id": peer["key_id"], **sealed}
        if attachment_id:
            payload["attachment_id"] = attachment_id
        return payload

    def post(self, payload: dict) -> httpx.Response:
        return self.call("POST", "/api/letters", payload)

    def send(self, conv_id: str, peer: dict, text: str, **kw: Any) -> httpx.Response:
        return self.post(self.letter(conv_id, peer, {"v": 1, "kind": "text", "text": text}, **kw))

    def peer_public(self, account_id: str, key_id: str) -> str:
        r = self.call("GET", f"/api/accounts/{account_id}/keys")
        assert r.status_code == 200, err(r)
        return next(k["public_key"] for k in r.json()["keys"] if k["key_id"] == key_id)

    def open(self, letter: dict) -> dict:
        pub = self.peer_public(letter["sender_id"], letter["sender_key_id"])
        key = self.conv_key(letter["recipient_key_id"], letter["sender_id"], pub)
        return self.sealer("open", key, letter["iv"], letter["ciphertext"])

    def collect(self) -> list[tuple[dict, dict]]:
        r = self.call("GET", "/api/inbox")
        assert r.status_code == 200, err(r)
        letters = r.json()["letters"]
        opened = [(lt, self.open(lt)) for lt in letters if lt.get("ciphertext")]
        if letters:
            ack = self.call("POST", "/api/inbox/ack", {"through_seq": max(lt["seq"] for lt in letters)})
            assert ack.status_code == 200, err(ack)
        return opened

    def attach(self, kind: str, plain: bytes, name: str, mime: str) -> tuple[dict, bytes]:
        s = self.sealer("sealBytes", b64u(plain))
        sealed = unb64u(s["sealed"])
        blob_id = new_id()
        d = self.call("POST", "/api/blobs", {"id": blob_id, "kind": kind, "size": len(sealed)})
        assert d.status_code == 201, err(d)
        u = self.put_content(blob_id, sealed)
        assert u.status_code == 200 and u.json()["state"] == "stored", err(u)
        return ({"blob_id": blob_id, "key": s["key"], "iv": s["iv"], "digest": s["digest"],
                 "size": len(plain), "name": name, "type": mime}, sealed)

    def save_profile(self, display_name: str, photo_blob_id: str | None = None) -> tuple[httpx.Response, str]:
        profile_key = b64u(os.urandom(32))
        sealed = self.sealer("seal", profile_key, {"v": 1, "display_name": display_name, "photo": None})
        return self.call("PUT", "/api/me/profile", {**sealed, "photo_blob_id": photo_blob_id}), profile_key


def junk_letter(conv_id: str, key_id: str, **extra: Any) -> dict:
    return {"id": new_id(), "conversation_id": conv_id, "class": "letter", "recipient_key_id": key_id,
            "iv": b64u(os.urandom(IV_BYTES)), "ciphertext": b64u(os.urandom(PAD_BLOCK + GCM_TAG)), **extra}


def collect_until(person: Person, wanted: Callable[[dict, dict], bool], what: str) -> tuple[dict, dict]:
    seen: list[tuple[dict, dict]] = []
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        seen.extend(person.collect())
        for pair in seen:
            if wanted(*pair):
                return pair
    pytest.fail(f"the exchange never handed {person.username} {what}")


def has_text(text: str) -> Callable[[dict, dict], bool]:
    return lambda letter, opened: opened["body"].get("text") == text


class Ui:
    def __init__(self, page: Page, base: str, username: str, display_name: str, code: str) -> None:
        self.page, self.base, self.username, self.display_name, self.code = page, base, username, display_name, code
        status, me = self.call("GET", "/api/me")
        assert status == 200, f"GET /api/me answered {status} after sign-up"
        self.id = me["id"]

    def call(self, method: str, path: str, body: Any = None) -> tuple[int, Any]:
        kwargs: dict[str, Any] = {"method": method}
        if body is not None:
            kwargs["data"] = body
        r = self.page.request.fetch(f"{self.base}{path}", **kwargs)
        try:
            data = r.json()
        except Exception:
            data = None
        return r.status, data

    def card(self) -> dict:
        _, me = self.call("GET", "/api/me")
        return {"id": me["id"], "public_key": me["public_key"], "key_id": me["key_id"], "username": me["username"]}

    def unread(self, cid: str) -> int:
        return self.call("GET", f"/api/conversations/{cid}")[1]["unread"]


def chip(page: Page) -> Locator:
    return page.get_by_role("status", name="Username availability")


def ui_signup(page: Page, base: str, *, display_name: str | None = None, photo: dict | None = None) -> Ui:
    username = fresh_name()
    page.goto(f"{base}/signup?skip_recovery_check=1")
    field = page.get_by_role("textbox", name="Username")
    poll(page, lambda: visible(field), "sign-up step 1 with the Username textbox")
    fill(field, username)
    poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], f"the chip reading Available for {username}")
    click(page.get_by_role("button", name="Continue"))
    code_box = page.get_by_role("group", name="Your recovery code")
    poll(page, lambda: visible(code_box) and recovery_text(code_box) != "", "step 2 showing the recovery code")
    code = recovery_text(code_box)
    click(page.get_by_role("button", name="I've written it down"))
    name_field = page.get_by_role("textbox", name="Display name")
    poll(page, lambda: visible(name_field), "step 4 with the Display name textbox")
    display = display_name or username
    fill(name_field, display)
    if photo is not None:
        with page.expect_file_chooser() as chooser:
            click(page.get_by_role("button", name="Add a photo"))
        chooser.value.set_files(files=[photo])
    click(page.get_by_role("button", name="Finish"))
    poll(page, lambda: visible(page.get_by_text(CHATS_EMPTY, exact=True)),
         "sign-up landing on Chats with its empty copy")
    return Ui(page, base, username, display, code)


def recovery_text(box: Locator) -> str:
    found = re.search(rf"[{CROCKFORD}]{{4}}(-[{CROCKFORD}]{{4}}){{7}}", box.inner_text())
    return found.group(0) if found else ""


def seal_text(box: Locator) -> str:
    flat = " ".join(box.inner_text().split())
    found = re.search(rf"\d{{{SEAL_GROUP_DIGITS}}}( \d{{{SEAL_GROUP_DIGITS}}}){{{SEAL_GROUPS - 1}}}", flat)
    return found.group(0) if found else ""


def composer(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Write a letter")


def open_conversation(page: Page, base: str, cid: str) -> None:
    page.goto(f"{base}/letters/{cid}")
    poll(page, lambda: visible(composer(page)) or visible(page.get_by_role("button", name="Unblock")),
         f"conversation {cid} open with its composer")


def send_letter(page: Page, text: str) -> None:
    box = composer(page)
    fill(box, text)
    box.press("Enter")


def letters(page: Page) -> Locator:
    return page.get_by_role("list", name="Letters").get_by_role("article")


def letter(page: Page, text: str) -> Locator:
    return letters(page).filter(has_text=text)


def letter_by_id(page: Page, lid: str) -> Locator | None:
    items = letters(page)
    for i in range(items.count()):
        if items.nth(i).get_attribute("data-letter-id") == lid:
            return items.nth(i)
    return None


def delivery(page: Page, text: str) -> str | None:
    loc = letter(page, text)
    return loc.first.get_attribute("data-delivery") if loc.count() == 1 else None


def label(loc: Locator) -> str:
    for text in POSTMARK_LABELS:
        if loc.first.get_by_text(text, exact=True).count():
            return text
    return ""


def wait_delivery(page: Page, text: str, states: tuple[str, ...]) -> None:
    poll(page, lambda: delivery(page, text) in states, f"the letter {text!r} reaching {states}")


def chats_item(page: Page, cid: str) -> Locator | None:
    items = page.get_by_role("list", name="Conversations").get_by_role("listitem")
    for i in range(items.count()):
        link = items.nth(i).get_by_role("link")
        if link.count() and link.first.get_attribute("data-conversation-id") == cid:
            return items.nth(i)
    return None


def badge_text(page: Page, cid: str) -> str | None:
    item = chats_item(page, cid)
    if item is None:
        return None
    badge = item.get_by_text(UNREAD_DISC)
    return badge.first.inner_text().strip() if badge.count() else ""


def tab_badge(page: Page) -> int:
    link = page.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^Chats"))
    found = re.search(r"\d+", link.first.inner_text()) if link.count() else None
    return int(found.group(0)) if found else 0


def tab_badge_shows(page: Page, n: int) -> bool:
    return tab_badge(page) == n


def request_row(page: Page, cid: str) -> Locator | None:
    rows = page.get_by_role("list", name="Letter requests").get_by_role("listitem")
    for i in range(rows.count()):
        found = rows.nth(i).evaluate(
            "el => { const n = el.closest('[data-conversation-id]') || el.querySelector('[data-conversation-id]');"
            " return n ? n.getAttribute('data-conversation-id') : null; }")
        if found == cid:
            return rows.nth(i)
    return None


def choose(page: Page, button: str, payload: dict, *, touch: bool = False) -> None:
    with page.expect_file_chooser() as chooser:
        (tap if touch else click)(page.get_by_role("button", name=button))
    chooser.value.set_files(files=[payload])


def person_to_ui(person: Person, ui: Ui, text: str) -> str:
    cid = person.converse(ui.id)["id"]
    sent = person.send(cid, ui.card(), text)
    assert sent.status_code == 201, err(sent)
    status, body = ui.call("POST", f"/api/conversations/{cid}/accept", {})
    assert status == 200, f"accept answered {status} {body}"
    return cid


def ui_to_ui(sender: Ui, recipient: Ui, text: str) -> str:
    status, conv = sender.call("POST", "/api/conversations", {"peer_id": recipient.id})
    assert status in (200, 201), f"POST /api/conversations answered {status}"
    open_conversation(sender.page, sender.base, conv["id"])
    send_letter(sender.page, text)
    wait_delivery(sender.page, text, POSTED_STATES)
    status, body = recipient.call("POST", f"/api/conversations/{conv['id']}/accept", {})
    assert status == 200, f"accept answered {status} {body}"
    return conv["id"]


def read_through(page: Page, ui: Ui, base: str, cid: str) -> None:
    open_conversation(page, base, cid)
    poll(page, lambda: ui.unread(cid) == 0, "the opened conversation marked read")


def assert_dialog_traps(page: Page, opener: Locator, dialog: Locator, what: str) -> None:
    opener.first.focus()
    page.keyboard.press("Enter")
    poll(page, lambda: visible(dialog), f"the {what} dialog opening from the keyboard")
    poll(page, lambda: focused(dialog), f"focus on the first control of the {what} dialog")
    page.evaluate("() => { window.__afFirst = document.activeElement; }")
    for _ in range(TRAP_PRESSES):
        page.keyboard.press("Tab")
        assert focused(dialog), f"Tab left the {what} dialog"
    page.evaluate("() => window.__afFirst.focus()")
    page.keyboard.press("Shift+Tab")
    assert focused(dialog), f"Shift+Tab from the first control left the {what} dialog"
    assert not page.evaluate("() => document.activeElement === window.__afFirst"), f"Shift+Tab did not wrap in {what}"
    page.keyboard.press("Tab")
    assert page.evaluate("() => document.activeElement === window.__afFirst"), f"Tab from the last control of {what} did not wrap"
    page.keyboard.press("Escape")
    poll(page, lambda: not visible(dialog), f"Escape closing the {what} dialog")
    poll(page, lambda: focused(opener), f"focus returning to the opener of the {what} dialog")


def touch_press(page: Page, loc: Locator, hold_ms: float) -> None:
    box = loc.first.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    advance(page, hold_ms)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def run_in_step(page: Page, done: Callable[[], bool], what: str) -> None:
    deadline = time.monotonic() + WAIT_S
    last = time.monotonic()
    while time.monotonic() < deadline:
        if done():
            return
        now = time.monotonic()
        advance(page, max(1.0, (now - last) * 1000))
        last = now
    pytest.fail(f"timed out; expected {what}")


def small_targets(page: Page) -> list[str]:
    bad = []
    for role in ("button", "link", "textbox"):
        for loc in page.get_by_role(role).all():
            if not loc.is_visible():
                continue
            box = loc.bounding_box()
            if box and (box["width"] < TOUCH_MIN - 0.5 or box["height"] < TOUCH_MIN - 0.5):
                bad.append(f"{role} {loc.inner_text()[:30]!r} {box['width']:.0f}x{box['height']:.0f}")
    return bad


def test_username_rules(app_url: str, sealer: Sealer) -> None:
    def availability(name: str) -> dict:
        r = httpx.get(f"{app_url}/api/usernames/{name}/availability", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, err(r)
        return r.json()

    refused = {
        "ab": "length", "a" + "b" * USERNAME_MAX: "length", "9-": "length",
        "a-b": "characters", ".a-": "characters", "9ab": "first_character", "_ab": "first_character",
        "9b.": "first_character", "ab.": "last_character",
        "halfpenny": "taken", "postmaster": "taken", "airfold": "taken", "PostMaster": "taken",
    }
    for name, reason in refused.items():
        body = availability(name)
        assert body["available"] is False and body["reason"] == reason, f"availability of {name!r}: {body}"
        assert body["username"] == name.lower()
    assert availability("a.b")["reason"] in (None, "taken"), "a 3-character name must not fail on length"
    longest = (fresh_name() + "b" * USERNAME_MAX)[:USERNAME_MAX]
    assert availability(longest.upper()) == {"username": longest, "available": True, "reason": None}

    made = sealer("enrol", longest.upper(), recovery_code())
    r = httpx.post(f"{app_url}/api/accounts", json=made["body"], timeout=HTTP_TIMEOUT)
    assert r.status_code == 201 and r.json()["username"] == longest, err(r)
    assert availability(longest)["reason"] == "taken"
    again = httpx.post(f"{app_url}/api/accounts", json=sealer("enrol", longest, recovery_code())["body"], timeout=HTTP_TIMEOUT)
    assert again.status_code == 409 and again.json() == {"error": "username_taken"}, err(again)
    reserved = httpx.post(f"{app_url}/api/accounts", json=sealer("enrol", "airfold", recovery_code())["body"], timeout=HTTP_TIMEOUT)
    assert reserved.status_code == 409 and reserved.json()["error"] == "username_taken", err(reserved)
    bad = httpx.post(f"{app_url}/api/accounts", json=sealer("enrol", "ab.", recovery_code())["body"], timeout=HTTP_TIMEOUT)
    assert bad.status_code == 422 and bad.json()["fields"]["username"] == "last_character", err(bad)

    contested = fresh_name()
    bodies = [sealer("enrol", contested, recovery_code())["body"] for _ in range(RACE_SIZE)]
    with concurrent.futures.ThreadPoolExecutor(RACE_SIZE) as pool:
        answers = list(pool.map(lambda b: httpx.post(f"{app_url}/api/accounts", json=b, timeout=HTTP_TIMEOUT), bodies))
    codes = sorted(a.status_code for a in answers)
    assert codes.count(201) == 1 and codes.count(409) == RACE_SIZE - 1, f"race statuses {codes}"
    assert all(a.json()["error"] == "username_taken" for a in answers if a.status_code == 409)


def test_sealed_signup(app_url: str, sealer: Sealer) -> None:
    code, name = recovery_code(), fresh_name()
    made = sealer("enrol", name, code)
    probe_name = f"Marisol Quayle {tag()}"
    r = httpx.post(f"{app_url}/api/accounts", json={**made["body"], "display_name": probe_name}, timeout=HTTP_TIMEOUT)
    if r.status_code == 422:
        r = httpx.post(f"{app_url}/api/accounts", json=made["body"], timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, err(r)
    header = next(h for h in r.headers.get_list("set-cookie") if h.startswith(f"{SESSION_COOKIE}="))
    attrs = {a.strip().lower() for a in header.split(";")}
    assert {"HttpOnly".lower(), "SameSite=Lax".lower(), "Path=/".lower()} <= attrs, header
    cookie = session_cookie(r)
    me = httpx.get(f"{app_url}/api/me", headers={"Cookie": f"{SESSION_COOKIE}={cookie}"}, timeout=HTTP_TIMEOUT)
    assert me.status_code == 200, err(me)
    account = me.json()
    assert account["username"] == name and account["public_key"] == made["key"]["public_key"]
    assert account["key_id"] == made["key"]["key_id"] == sealer("keyId", made["key"]["public_key"])
    assert account["profile"] is None and account["username_changed_at"] is None
    assert account["settings"] == {"read_receipts": True, "preview": "name_and_letter"}
    assert ISO_MS.match(account["created_at"])
    anon = httpx.get(f"{app_url}/api/me", timeout=HTTP_TIMEOUT)
    assert anon.status_code == 401 and anon.json() == {"error": "unauthenticated"}

    db = Postgres()
    assert db_holds(db, bytes_needles(unb64u(made["key"]["public_key"]))), "observer could not find the stored public key"
    secrets = (text_needles(probe_name) + [code, code.replace("-", ""), cookie]
               + bytes_needles(unb64u(made["body"]["recovery_verifier"])) + bytes_needles(unb64u(made["key"]["pkcs8"])))
    assert not db_holds(db, secrets), "PostgreSQL holds a plaintext secret from sign-up"

    other = fresh_name()
    body = sealer("enrol", other, recovery_code())["body"]
    off_curve = httpx.post(f"{app_url}/api/accounts", json={**body, "public_key": b64u(b"\x04" + b"\x01" * 64)}, timeout=HTTP_TIMEOUT)
    assert off_curve.status_code == 422 and off_curve.json()["fields"]["public_key"] == "invalid", err(off_curve)
    no_backup = httpx.post(f"{app_url}/api/accounts", json={k: v for k, v in body.items() if k != "key_backup"}, timeout=HTTP_TIMEOUT)
    assert no_backup.status_code == 422 and no_backup.json()["fields"]["key_backup"] == "invalid", err(no_backup)
    left = httpx.get(f"{app_url}/api/usernames/{other}/availability", timeout=HTTP_TIMEOUT).json()
    assert left["available"] is True, "a refused sign-up claimed its username"


def test_wf_signup_keyboard(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        page.goto(app_url)
        expect(page.get_by_role("heading", level=1, name="Letters that seal themselves")).to_be_visible(timeout=EXPECT_MS)
        start = page.get_by_role("link", name="Choose a username")
        tab_to(page, start, "Choose a username")
        page.keyboard.press("Enter")
        field = page.get_by_role("textbox", name="Username")
        poll(page, lambda: visible(field), "sign-up step 1")
        tab_to(page, field, "the Username textbox")
        name = fresh_name()
        page.keyboard.type(name)
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "the chip reading Available")
        assert tab_order(page, 2) == ["Username availability", "Continue"]
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Shift+Tab")
        assert focused(field)
        page.keyboard.press("Enter")
        code_box = page.get_by_role("group", name="Your recovery code")
        poll(page, lambda: visible(code_box) and recovery_text(code_box) != "", "step 2 with the recovery code")
        code = recovery_text(code_box)
        assert re.fullmatch(rf"[{CROCKFORD}]{{4}}(-[{CROCKFORD}]{{4}}){{7}}", code), code
        assert visible(page.get_by_role("group", name="Your recovery code"))
        written = page.get_by_role("button", name="I've written it down")
        tab_to(page, written, "I've written it down")
        page.keyboard.press("Enter")
        groups = code.split("-")
        asked = []
        poll(page, lambda: page.get_by_role("textbox", name=re.compile(r"^Group [1-8]$")).count() == 3, "three group fields")
        for k in range(1, 9):
            if page.get_by_role("textbox", name=f"Group {k}", exact=True).count():
                asked.append(k)
        assert len(asked) == 3
        assert focused(page.get_by_role("textbox", name=f"Group {asked[0]}", exact=True)), "focus on the first group field"
        for i, k in enumerate(asked):
            page.keyboard.type(groups[k - 1])
            if i < 2:
                tab_to(page, page.get_by_role("textbox", name=f"Group {asked[i + 1]}", exact=True), "the next group")
        page.keyboard.press("Enter")
        display = page.get_by_role("textbox", name="Display name")
        poll(page, lambda: focused(display), "focus on Display name in step 4")
        probe_name = f"Odalys Fenwick {tag()}"
        page.keyboard.type(probe_name)
        page.keyboard.press("Enter")
        empty = page.get_by_text(CHATS_EMPTY, exact=True)
        poll(page, lambda: visible(empty) and page.url.endswith("/letters"), "Chats with the empty copy")
        assert page.title() == "Airfold"
        layout(page)
        me = page.request.get(f"{app_url}/api/me").json()
        assert me["username"] == name and me["profile"] is not None, "the sealed profile was never saved"
        assert not db_holds(Postgres(), text_needles(probe_name) + [code, code.replace("-", "")])


def test_wf_signup_mistakes(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        page.goto(f"{app_url}/signup")
        field = page.get_by_role("textbox", name="Username")
        poll(page, lambda: visible(field), "sign-up step 1")
        for typed, key in (("ab", "length"), ("ab-c", "characters"), ("9abc", "first_character"),
                           ("abc.", "last_character"), ("postmaster", "taken")):
            fill(field, typed)
            poll(page, lambda: chip(page).inner_text().strip() == CHIP[key], f"chip copy {CHIP[key]!r} for {typed!r}")
        name = fresh_name()
        fill(field, name)
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "chip Available")
        click(page.get_by_role("button", name="Continue"))
        code_box = page.get_by_role("group", name="Your recovery code")
        poll(page, lambda: visible(code_box) and recovery_text(code_box) != "", "the recovery code")
        groups = recovery_text(code_box).split("-")
        click(page.get_by_role("button", name="I've written it down"))
        poll(page, lambda: page.get_by_role("textbox", name=re.compile(r"^Group [1-8]$")).count() == 3, "three group fields")
        asked = [k for k in range(1, 9) if page.get_by_role("textbox", name=f"Group {k}", exact=True).count()]
        first = page.get_by_role("textbox", name=f"Group {asked[0]}", exact=True)
        right = groups[asked[0] - 1]
        fill(first, right[1:] + right[0] if right[1:] + right[0] != right else ("ZZZZ" if right != "ZZZZ" else "0000"))
        for k in asked[1:]:
            fill(page.get_by_role("textbox", name=f"Group {k}", exact=True), groups[k - 1])
        click(page.get_by_role("button", name="Check"))
        poll(page, lambda: visible(page.get_by_text(RECOVERY_MISMATCH, exact=True)), "the recovery mismatch slip")
        poll(page, lambda: focused(first), "focus on the first wrong group")
        fill(first, right)
        click(page.get_by_role("button", name="Check"))
        display = page.get_by_role("textbox", name="Display name")
        poll(page, lambda: visible(display), "step 4")
        click(page.get_by_role("button", name="Finish"))
        poll(page, lambda: visible(page.get_by_text(DISPLAY_NAME_EMPTY, exact=True)), "the empty display name slip")
        fill(display, name)
        click(page.get_by_role("button", name="Finish"))
        poll(page, lambda: visible(page.get_by_text(CHATS_EMPTY, exact=True)), "Chats")
        assert page.request.get(f"{app_url}/api/me").json()["username"] == name


def test_exact_lookup(app_url: str, sealer: Sealer) -> None:
    a, b, c = Person(app_url, sealer), Person(app_url, sealer), Person(app_url, sealer)
    saved, _ = b.save_profile(f"Inés Harrow {tag()}")
    assert saved.status_code == 200, err(saved)
    found = a.call("GET", f"/api/lookup?username={b.username.upper()}")
    assert found.status_code == 200, err(found)
    body = found.json()
    assert (body["id"], body["username"], body["key_id"], body["public_key"]) == (b.id, b.username, b.key_id, b.public_key)
    assert body["profile"] is None, "a non-contact saw the sealed profile"
    for probe in (b.username[:-2], b.username + "x", a.username):
        miss = a.call("GET", f"/api/lookup?username={probe}")
        assert miss.status_code == 404 and miss.json() == {"error": "not_found"}, err(miss)
    anon = httpx.get(f"{app_url}/api/lookup?username={b.username}", timeout=HTTP_TIMEOUT)
    assert anon.status_code == 401
    cid = a.converse(b.id)["id"]
    assert a.send(cid, b.card(), "Lookup opener").status_code == 201
    assert a.call("GET", f"/api/lookup?username={b.username}").json()["profile"] is None, "starter saw profile before Accept"
    assert b.call("POST", f"/api/conversations/{cid}/accept", {}).status_code == 200
    shared = a.call("GET", f"/api/lookup?username={b.username}").json()["profile"]
    me = b.call("GET", "/api/me").json()["profile"]
    assert shared is not None and shared["ciphertext"] == me["ciphertext"]
    assert c.call("GET", f"/api/lookup?username={b.username}").json()["profile"] is None


def test_wf_lookup_found(browser: Browser, app_url: str, sealer: Sealer) -> None:
    target = Person(app_url, sealer)
    hidden = f"Bellamy Ostrander {tag()}"
    target.save_profile(hidden)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        u = ui_signup(page, app_url)
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Contacts"))
        finder = page.get_by_role("textbox", name="Find by username")
        poll(page, lambda: visible(finder), "Contacts with the lookup form")
        fill(finder, target.username.upper())
        finder.press("Enter")
        poll(page, lambda: page.get_by_role("status", name="Lookup status").inner_text().strip() == f"Found {target.username}.",
             "the Found announcement")
        result = page.get_by_role("region", name="Lookup result")
        poll(page, lambda: focused(result), "focus on the Lookup result region")
        assert target.username in result.inner_text() and hidden not in result.inner_text()
        write = result.get_by_role("button", name="Write a letter")
        write.focus()
        page.keyboard.press("Enter")
        poll(page, lambda: focused(composer(page)), "focus in the composer")
        assert visible(page.get_by_text(CONVERSATION_EMPTY, exact=True))
        cid = page.url.rstrip("/").rsplit("/", 1)[-1]
        status, conv = u.call("GET", f"/api/conversations/{cid}")
        assert status == 200 and conv["peer"]["id"] == target.id
        text = f"Found you {tag()}"
        send_letter(page, text)
        collect_until(target, has_text(text), "the letter written from the lookup card")


def test_wf_lookup_not_found(browser: Browser, app_url: str, sealer: Sealer) -> None:
    other = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        u = ui_signup(page, app_url)
        page.goto(f"{app_url}/contacts")
        finder = page.get_by_role("textbox", name="Find by username")
        poll(page, lambda: visible(finder), "Contacts")
        for probe in (fresh_name("zz"), other.username[:-1]):
            fill(finder, probe)
            finder.press("Enter")
            result = page.get_by_role("region", name="Lookup result")
            poll(page, lambda: LOOKUP_MISS in result.inner_text()
                 and page.get_by_role("status", name="Lookup status").inner_text().strip() == LOOKUP_MISS,
                 f"the not-found copy for {probe}")
            poll(page, lambda: focused(result), "focus on the not-found result")
            assert u.call("GET", f"/api/lookup?username={probe}")[0] == 404


def test_letter_requests(app_url: str, sealer: Sealer) -> None:
    a, b = Person(app_url, sealer), Person(app_url, sealer)
    a.save_profile("Starter profile")
    b.save_profile("Recipient profile")
    conv = a.converse(b.id)
    cid = conv["id"]
    assert conv["status"] == "accepted" and conv["peer"]["profile"] is None

    def listed(person: Person, status: str) -> list[str]:
        return [c["id"] for c in person.call("GET", f"/api/conversations?status={status}").json()["conversations"]]

    assert cid not in listed(b, "request") and cid not in listed(b, "accepted"), "request visible before any letter"
    first = a.send(cid, b.card(), "First letter")
    assert first.status_code == 201, err(first)
    assert cid in listed(b, "request") and cid not in listed(b, "accepted")
    seen = b.call("GET", f"/api/conversations/{cid}").json()
    assert seen["status"] == "request" and seen["peer"]["profile"] is None
    blocked_post = b.post(junk_letter(cid, a.key_id))
    assert blocked_post.status_code == 409 and blocked_post.json()["error"] == "request_not_accepted", err(blocked_post)
    b.collect()
    lid, seq = first.json()["id"], first.json()["seq"]
    assert b.call("POST", f"/api/conversations/{cid}/read", {"through_seq": seq}).status_code == 200
    assert a.call("GET", f"/api/letters/{lid}").json()["state"] == "delivered", "a request read sent a receipt"
    accepted = b.call("POST", f"/api/conversations/{cid}/accept", {})
    assert accepted.status_code == 200 and accepted.json()["status"] == "accepted", err(accepted)
    for method, path in (("POST", f"/api/conversations/{cid}/accept"), ("DELETE", f"/api/conversations/{cid}")):
        again = b.call(method, path, {} if method == "POST" else None)
        assert again.status_code == 409 and again.json() == {"error": "not_a_request"}, err(again)
    assert cid in listed(b, "accepted")
    assert a.call("GET", f"/api/conversations/{cid}").json()["peer"]["profile"] is not None
    assert b.call("GET", f"/api/conversations/{cid}").json()["peer"]["profile"] is not None
    b.call("POST", f"/api/conversations/{cid}/read", {"through_seq": seq})
    assert a.call("GET", f"/api/letters/{lid}").json()["state"] == "delivered", "a read recorded while a request changed later"
    assert b.send(cid, a.card(), "Reply after accept").status_code == 201

    c, d = Person(app_url, sealer), Person(app_url, sealer)
    dcid = c.converse(d.id)["id"]
    c.send(dcid, d.card(), "Delete me")
    gone = d.call("DELETE", f"/api/conversations/{dcid}")
    assert gone.status_code == 204, err(gone)
    assert dcid not in listed(d, "request")
    assert c.call("GET", f"/api/conversations/{dcid}").json()["status"] == "accepted", "the sender was told about Delete"
    assert c.send(dcid, d.card(), "Writing again").status_code == 201
    assert dcid in listed(d, "request"), "a new letter after Delete did not bring the request back"


def test_wf_requests_accept(browser: Browser, app_url: str, sealer: Sealer) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1 = ui_signup(p1, app_url)
        display = f"Wren Calloway {tag()}"
        u2 = ui_signup(p2, app_url, display_name=display, photo=file_payload("tiny.png", "image/png", tiny_png(sealer)))
        status, conv = u1.call("POST", "/api/conversations", {"peer_id": u2.id})
        assert status in (200, 201)
        cid = conv["id"]
        open_conversation(p1, app_url, cid)
        p2.goto(f"{app_url}/letters")
        link = p2.get_by_role("link", name="Letter requests (1)")
        poll(p2, lambda: visible(p2.get_by_role("navigation", name="Main")), "Chats")
        assert link.count() == 0, "request link shown before any letter"
        text = f"May I write to you {tag()}"
        send_letter(p1, text)
        poll(p2, lambda: visible(link), "Letter requests (1) appearing live")
        assert tab_badge(p2) == 0 and p2.title() == "Airfold"
        click(link)
        poll(p2, lambda: request_row(p2, cid) is not None, "the request row")
        click(request_row(p2, cid))
        region = p2.get_by_role("region", name="Letter request")
        poll(p2, lambda: visible(region) and letter(p2, text).count() == 1, "the open request with its letter")
        wait_delivery(p1, text, ("delivered",))
        accept = region.get_by_role("button", name="Accept")
        accept.focus()
        p2.keyboard.press("Enter")
        poll(p2, lambda: u2.call("GET", f"/api/conversations/{cid}")[1]["status"] == "accepted", "the request accepted")
        p2.goto(f"{app_url}/letters")
        poll(p2, lambda: chats_item(p2, cid) is not None, "the conversation in Chats")
        assert link.count() == 0
        heading = p1.get_by_role("heading", level=2, name=display)
        poll(p1, lambda: visible(heading), "the sender seeing the display name without reloading")
        lid = letter(p1, text).first.get_attribute("data-letter-id")
        assert u1.call("GET", f"/api/letters/{lid}")[1]["state"] == "delivered", "reading a request sent a receipt"
        assert u1.call("GET", f"/api/conversations/{cid}")[1]["peer"]["profile"] is not None
        assert S3().keys(f"blobs/{u2.id}/"), "the profile photo never reached object storage"


def test_wf_requests_delete_block(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p, q = Person(app_url, sealer), Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        pc, qc = p.converse(u.id)["id"], q.converse(u.id)["id"]
        p.send(pc, u.card(), "Request to delete")
        q.send(qc, u.card(), "Request to block")
        page.goto(f"{app_url}/requests")
        poll(page, lambda: request_row(page, pc) is not None and request_row(page, qc) is not None, "two request rows")
        region = page.get_by_role("region", name="Letter request")
        click(request_row(page, pc))
        poll(page, lambda: visible(region), "the open request")
        click(region.get_by_role("button", name="Delete"))
        poll(page, lambda: pc not in [c["id"] for c in u.call("GET", "/api/conversations?status=request")[1]["conversations"]],
             "the deleted request gone from the API")
        assert p.call("GET", f"/api/conversations/{pc}").json()["status"] == "accepted"
        page.goto(f"{app_url}/requests")
        poll(page, lambda: request_row(page, qc) is not None, "the remaining request")
        click(request_row(page, qc))
        poll(page, lambda: visible(region), "the open request")
        click(region.get_by_role("button", name="Block"))
        confirm = page.get_by_role("dialog", name=f"Block {q.username}?")
        if visible(confirm):
            click(confirm.get_by_role("button", name="Block"))
        poll(page, lambda: q.id in [b["account_id"] for b in u.call("GET", "/api/blocks")[1]["blocks"]], "the sender blocked")
        assert qc not in [c["id"] for c in u.call("GET", "/api/conversations?status=request")[1]["conversations"]]
        page.goto(f"{app_url}/requests")
        poll(page, lambda: visible(page.get_by_text(REQUESTS_EMPTY, exact=True)), "the empty requests copy")
        page.goto(f"{app_url}/letters")
        assert p.send(pc, u.card(), "Back again").status_code == 201
        poll(page, lambda: visible(page.get_by_role("link", name="Letter requests (1)")), "the request returning live")


def test_published_sealing_scheme(browser: Browser, app_url: str, sealer: Sealer) -> None:
    sealed = sealer("seal", b64u(os.urandom(32)), {"v": 1, "kind": "text", "text": "Hello from Lisbon"})
    assert len(sealed["ciphertext"]) == 235 and len(sealed["iv"]) == 16
    p = Person(app_url, sealer)
    display = f"Juniper Ashdown {tag()}"
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url, display_name=display)
        cid = p.converse(u.id)["id"]
        assert p.send(cid, u.card(), "Hello from Lisbon").status_code == 201
        page.goto(f"{app_url}/requests")
        poll(page, lambda: request_row(page, cid) is not None, "the request row")
        click(request_row(page, cid))
        region = page.get_by_role("region", name="Letter request")
        poll(page, lambda: letter(page, "Hello from Lisbon").count() == 1, "the letter sealed elsewhere opening in Airfold")
        click(region.get_by_role("button", name="Accept"))
        control, opened = collect_until(p, lambda lt, o: lt["class"] == "control", "the profile control letter")
        assert opened["body"]["v"] == 1 and opened["body"]["kind"] == "profile" and opened["padded"] % PAD_BLOCK == 0
        profile_key = opened["body"]["profile_key"]
        assert len(unb64u(profile_key)) == 32
        prof = p.call("GET", f"/api/conversations/{cid}").json()["peer"]["profile"]
        unsealed = sealer("open", profile_key, prof["iv"], prof["ciphertext"])
        assert unsealed["body"]["display_name"] == display and unsealed["padded"] % PAD_BLOCK == 0
        open_conversation(page, app_url, cid)
        text = f"Grüße from the ferry — {tag()}"
        send_letter(page, text)
        got, opened = collect_until(p, has_text(text), "Airfold's letter")
        assert opened["body"] == {"v": 1, "kind": "text", "text": text}
        assert opened["padded"] % PAD_BLOCK == 0 and opened["padded"] > len(json.dumps(opened["body"]).encode())
        assert len(unb64u(got["iv"])) == IV_BYTES

    v, w = Person(app_url, sealer), Person(app_url, sealer)
    vc = v.converse(w.id)["id"]
    spare, _ = v.attach("file", b"spare", "spare.txt", "text/plain")
    good = junk_letter(vc, w.key_id)
    biggest = v.post({**good, "ciphertext": b64u(os.urandom(MAX_CIPHERTEXT))})
    assert biggest.status_code == 201, err(biggest)
    invalid = {
        "short iv": {**junk_letter(vc, w.key_id), "iv": b64u(os.urandom(IV_BYTES - 1))},
        "unpadded": {**junk_letter(vc, w.key_id), "ciphertext": b64u(os.urandom(PAD_BLOCK + GCM_TAG - 1))},
        "too long": {**junk_letter(vc, w.key_id), "ciphertext": b64u(os.urandom(MAX_CIPHERTEXT + PAD_BLOCK))},
        "class": {**junk_letter(vc, w.key_id), "class": "photo"},
        "id": {**junk_letter(vc, w.key_id), "id": "letter-one"},
        "control attachment": {**junk_letter(vc, w.key_id), "class": "control", "attachment_id": spare["blob_id"]},
    }
    for case, payload in invalid.items():
        r = v.post(payload)
        assert r.status_code == 422 and r.json()["error"] == "invalid", f"{case}: {err(r)}"


def test_one_letter_per_id(app_url: str, sealer: Sealer) -> None:
    p, q, r = Person(app_url, sealer), Person(app_url, sealer), Person(app_url, sealer)
    cid = p.converse(q.id)["id"]
    payload = p.letter(cid, q.card(), {"v": 1, "kind": "text", "text": "Once only"})
    first = p.post(payload)
    assert first.status_code == 201, err(first)
    replay = p.post(payload)
    assert replay.status_code == 200 and replay.json()["id"] == payload["id"] and replay.json()["seq"] == first.json()["seq"]
    other = p.post({**payload, "ciphertext": p.letter(cid, q.card(), {"v": 1, "kind": "text", "text": "Changed"})["ciphertext"]})
    assert other.status_code == 409 and other.json()["error"] == "letter_id_conflict", err(other)
    rc = r.converse(q.id)["id"]
    stolen = r.post({**r.letter(rc, q.card(), {"v": 1, "kind": "text", "text": "Once only"}), "id": payload["id"]})
    assert stolen.status_code == 409 and stolen.json()["error"] == "letter_id_conflict", err(stolen)
    assert p.call("PUT", f"/api/blocks/{q.id}", {}).status_code == 200
    assert p.post(payload).status_code == 200, "a replay must answer before the blocked-contact check"
    assert p.call("DELETE", f"/api/blocks/{q.id}").status_code == 204

    burst = p.letter(cid, q.card(), {"v": 1, "kind": "text", "text": "Burst"})
    with concurrent.futures.ThreadPoolExecutor(RACE_SIZE) as pool:
        answers = list(pool.map(lambda _: p.post(burst), range(RACE_SIZE)))
    codes = sorted(a.status_code for a in answers)
    assert codes.count(201) == 1 and codes.count(200) == RACE_SIZE - 1, codes
    assert len({a.json()["seq"] for a in answers}) == 1
    ids = [lt["id"] for lt in q.call("GET", "/api/inbox").json()["letters"]]
    assert ids.count(payload["id"]) == 1 and ids.count(burst["id"]) == 1


def test_delivery_states(app_url: str, sealer: Sealer) -> None:
    p, q = Person(app_url, sealer), Person(app_url, sealer)
    cid = p.converse(q.id)["id"]
    l0 = p.send(cid, q.card(), "State zero").json()
    one = p.send(cid, q.card(), "State one")
    assert one.status_code == 201, err(one)
    l1 = one.json()
    assert l1["state"] == "sent" and l1["failure"] is None and l1["delivered_at"] is None and ISO_MS.match(l1["held_at"])
    assert q.call("POST", f"/api/conversations/{cid}/accept", {}).status_code == 200
    q.call("POST", f"/api/conversations/{cid}/read", {"through_seq": l0["seq"]})
    assert p.call("GET", f"/api/letters/{l0['id']}").json()["state"] == "sent", "a read marker touched a sent letter"
    held_copy = next(lt for lt in q.call("GET", "/api/inbox").json()["letters"] if lt["id"] == l1["id"])
    assert held_copy["iv"] and held_copy["ciphertext"]
    ack = q.call("POST", "/api/inbox/ack", {"through_seq": l1["seq"]})
    assert ack.json() == {"delivered": 2}, err(ack)
    after = q.call("GET", f"/api/letters/{l1['id']}").json()
    assert after["state"] == "delivered" and after["delivered_at"] and after["iv"] is None and after["ciphertext"] is None
    assert q.call("POST", "/api/inbox/ack", {"through_seq": l1["seq"]}).json() == {"delivered": 0}
    assert q.call("GET", f"/api/letters/{l1['id']}").json()["delivered_at"] == after["delivered_at"]
    q.call("POST", f"/api/conversations/{cid}/read", {"through_seq": l1["seq"]})
    read = p.call("GET", f"/api/letters/{l1['id']}").json()
    assert read["state"] == "read" and read["read_at"]
    q.call("POST", f"/api/conversations/{cid}/read", {"through_seq": l1["seq"]})
    assert p.call("GET", f"/api/letters/{l1['id']}").json()["read_at"] == read["read_at"]

    attachment, _ = p.attach("file", ferry_pdf(), "ferry-timetable.pdf", "application/pdf")
    l2 = p.send(cid, q.card(), "Never collected").json()
    l3 = p.post(p.letter(cid, q.card(), {"v": 1, "kind": "file", "text": "", "attachment": attachment},
                         attachment_id=attachment["blob_id"])).json()
    store = S3()
    assert store.keys(f"blobs/{p.id}/{attachment['blob_id']}")
    with server_clock(app_url) as shift:
        shift(HOLD_MS - MARGIN_MS)
        assert p.call("GET", f"/api/letters/{l2['id']}").json()["state"] == "sent"
        shift(HOLD_MS + MARGIN_MS)
        for lt in (l2, l3):
            back = p.call("GET", f"/api/letters/{lt['id']}").json()
            assert back["state"] == "failed" and back["failure"] == "returned" and back["returned_at"], back
        assert not store.keys(f"blobs/{p.id}/{attachment['blob_id']}"), "a returned letter kept its attachment object"
        assert q.call("POST", "/api/inbox/ack", {"through_seq": l3["seq"]}).json() == {"delivered": 0}
        assert p.call("GET", f"/api/letters/{l2['id']}").json()["state"] == "failed"


def test_reciprocal_read_receipts(app_url: str, sealer: Sealer) -> None:
    p, q = Person(app_url, sealer), Person(app_url, sealer)
    cid = p.converse(q.id)["id"]
    p.send(cid, q.card(), "Opener")
    q.call("POST", f"/api/conversations/{cid}/accept", {})

    def deliver_and_read(text: str) -> str:
        lt = p.send(cid, q.card(), text).json()
        q.collect()
        q.call("POST", f"/api/conversations/{cid}/read", {"through_seq": lt["seq"]})
        return lt["id"]

    def state(lid: str) -> str:
        return p.call("GET", f"/api/letters/{lid}").json()["state"]

    both = deliver_and_read("Both on")
    assert state(both) == "read"
    assert q.call("PATCH", "/api/me/settings", {"read_receipts": False}).json()["settings"]["read_receipts"] is False
    off_q = deliver_and_read("Recipient off")
    assert state(off_q) == "delivered"
    q.call("PATCH", "/api/me/settings", {"read_receipts": True})
    q.call("POST", f"/api/conversations/{cid}/read", {"through_seq": 10**12})
    assert state(off_q) == "delivered", "a read recorded with receipts off changed later"
    p.call("PATCH", "/api/me/settings", {"read_receipts": False})
    off_p = deliver_and_read("Sender off")
    assert state(off_p) == "delivered"
    assert state(both) == "read", "a settings change rewrote an earlier read"
    for bad in ({"preview": "loud"}, {"read_receipts": "yes"}):
        r = p.call("PATCH", "/api/me/settings", bad)
        assert r.status_code == 422 and r.json()["error"] == "invalid", err(r)


def test_wf_live_letters_happy(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Opening letter {tag()}")
        p2.goto(f"{app_url}/letters")
        poll(p2, lambda: chats_item(p2, cid) is not None, "the recipient on Chats")
        text = f"Live letter {tag()}"
        ack_gate = stack.enter_context(held(p2, "**/api/inbox/ack"))
        with held(p1, "**/api/letters") as gate:
            send_letter(p1, text)
            mine = letter(p1, text)
            poll(p1, lambda: delivery(p1, text) == "sending", "the Sending postmark")
            assert label(mine) == "Sending"
            expect(composer(p1)).to_be_focused()
            expect(composer(p1)).to_have_value("")
            release(gate)
        poll(p1, lambda: delivery(p1, text) == "sent" and label(mine) == "Sent", "the Sent postmark")
        lid = mine.first.get_attribute("data-letter-id")
        stored = u1.call("GET", f"/api/letters/{lid}")[1]
        stamp = mine.first.get_by_role("time").first.get_attribute("datetime")
        assert ts(stamp) == ts(stored["held_at"])
        poll(p1, lambda: f"Sent. Held for {u2.username} until they collect it." in status_text(p1, "Letter updates"),
             "the Sent announcement")
        release(ack_gate)
        poll(p1, lambda: delivery(p1, text) == "delivered" and label(mine) == "Delivered", "the Delivered postmark")
        poll(p1, lambda: re.search(rf"Delivered to {re.escape(u2.username)} at {TIME_PATTERN}\.", status_text(p1, "Letter updates")),
             "the Delivered announcement")
        click(p2.get_by_role("list", name="Conversations").get_by_role("link").filter(has_text=u1.username).first)
        poll(p1, lambda: delivery(p1, text) == "read" and label(mine) == "Read", "the Read postmark")
        poll(p1, lambda: re.search(rf"Read by {re.escape(u2.username)} at {TIME_PATTERN}\.", status_text(p1, "Letter updates")),
             "the Read announcement")
        second = f"Second live letter {tag()}"
        send_letter(p1, second)
        poll(p2, lambda: letter(p2, second).count() == 1, "the second letter arriving live")
        poll(p2, lambda: f"New letter from {u1.username}." in status_text(p2, "Letter updates"), "the new letter announcement")
        wait_delivery(p1, second, ("read",))
        for p, state in ((p1, "Read"), (p2, "Received")):
            p.goto(f"{app_url}/letters")
            poll(p, lambda: chats_item(p, cid) is not None, "Chats after reload")
            row = chats_item(p, cid).inner_text()
            assert second in row and state in row, f"row after reload: {row!r}"
        last = u1.call("GET", f"/api/conversations/{cid}")[1]["last_letter"]
        assert last["state"] == "read"


def test_wf_live_letters_double_send(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Double opener")
        open_conversation(page, app_url, cid)
        posts: list[str] = []
        page.on("request", lambda req: posts.append(req.url) if req.method == "POST" and req.url.endswith("/api/letters") else None)

        def twice(route: Any) -> None:
            route.fetch()
            route.fulfill(response=route.fetch())

        page.route("**/api/letters", twice)
        text = f"Tapped twice {tag()}"
        fill(composer(page), text)
        composer(page).press("Enter")
        click(page.get_by_role("button", name="Send"))
        wait_delivery(page, text, POSTED_STATES)
        page.unroute("**/api/letters")
        assert letter(page, text).count() == 1 and len(posts) == 1
        collect_until(p, has_text(text), "the double-tapped letter")
        ids = [lt["id"] for lt in p.call("GET", f"/api/conversations/{cid}/letters").json()["letters"]]
        lid = letter(page, text).first.get_attribute("data-letter-id")
        assert ids.count(lid) == 1 and len(ids) == 2, f"letters at the exchange: {ids}"


def test_wf_live_letters_layout(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Order opener")
        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(size)
            open_conversation(page, app_url, cid)
            text = f"Order {size['width']} {tag()}"
            send_letter(page, text)
            wait_delivery(page, text, POSTED_STATES)
            mine = letter(page, text).first.bounding_box()
            box = composer(page).bounding_box()
            assert mine["y"] + mine["height"] <= box["y"] + 1, f"the composer is not below the letters at {size['width']}"
            assert box["x"] >= 0 and box["x"] + box["width"] <= size["width"] + 1
            conv_list = page.get_by_role("list", name="Conversations")
            assert in_view(conv_list) == (size["width"] >= TWO_PANE_MIN), f"list visibility at {size['width']}"
            layout(page)


def test_wf_live_letters_breakpoints(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Layout opener")
        conv_list = page.get_by_role("list", name="Conversations")
        sheet = page.get_by_role("list", name="Letters")
        back = page.get_by_role("button", name="Back to letters")
        card_btn = page.get_by_role("button", name="Contact card")
        card = page.get_by_role("region", name="Contact card")
        nav = page.get_by_role("navigation", name="Main")

        def at(size: dict) -> None:
            page.set_viewport_size(size)
            open_conversation(page, app_url, cid)
            poll(page, lambda: in_view(sheet), "the open conversation")

        at(PHONE)
        assert not in_view(conv_list) and in_view(back) and in_view(card_btn) and not in_view(card)
        assert nav.bounding_box()["y"] > PHONE["height"] / 2, "the tab bar is not at the bottom"
        layout(page)
        click(back)
        poll(page, lambda: in_view(conv_list) and not in_view(sheet), "Back to letters showing the list alone")
        at(TABLET)
        poll(page, lambda: in_view(conv_list), "list beside the conversation")
        lb, sb = conv_list.bounding_box(), sheet.bounding_box()
        assert lb["x"] + lb["width"] <= sb["x"] + 1
        assert LIST_SHARE[0] <= (lb["x"] + lb["width"]) / TABLET["width"] <= LIST_SHARE[1]
        assert nav.bounding_box()["y"] <= lb["y"] and nav.bounding_box()["x"] < sb["x"]
        assert not in_view(back) and in_view(card_btn) and not in_view(card)
        layout(page)
        at(DESKTOP)
        poll(page, lambda: in_view(card), "the contact card column")
        assert card.bounding_box()["x"] >= sheet.bounding_box()["x"] + sheet.bounding_box()["width"] - 1
        assert not in_view(card_btn) and in_view(conv_list)
        layout(page)
        at({"width": TWO_PANE_MIN - 1, "height": DESKTOP["height"]})
        assert in_view(back) and not in_view(conv_list)
        at({"width": TWO_PANE_MIN, "height": DESKTOP["height"]})
        assert not in_view(back) and in_view(conv_list)
        at({"width": THREE_PANE_MIN - 1, "height": DESKTOP["height"]})
        assert in_view(card_btn) and not in_view(card)
        at({"width": THREE_PANE_MIN, "height": DESKTOP["height"]})
        assert in_view(card) and not in_view(card_btn)


def pump(page: Page, seen: list, n: int, what: str) -> None:
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline and len(seen) < n:
        page.evaluate("1")
    assert len(seen) == n, f"expected {what}: {len(seen)} post attempts"


def test_wf_sender_offline_outbox(browser: Browser, app_url: str, sealer: Sealer) -> None:
    base_ms = config(app_url)["timers"]["retry_base_ms"]
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Outbox opener")
        open_conversation(page, app_url, cid)
        attempts: list[str] = []

        def refuse(route: Any) -> None:
            attempts.append(route.request.method)
            route.abort()

        page.route("**/api/letters", refuse)
        first, second = f"Outbox first {tag()}", f"Outbox second {tag()}"
        send_letter(page, first)
        pump(page, attempts, 1, "the first post")
        send_letter(page, second)
        for text in (first, second):
            expect(letter(page, text).first).to_have_attribute("data-delivery", "sending", timeout=EXPECT_MS)
            assert label(letter(page, text)) == "Sending"
        advance(page, base_ms - STEP_MS)
        for _ in range(5):
            page.evaluate("1")
        assert len(attempts) == 1, "retried before the retry base delay"
        advance(page, 2 * STEP_MS)
        pump(page, attempts, 2, "one retry after the base delay")
        advance(page, 2 * base_ms - STEP_MS)
        for _ in range(5):
            page.evaluate("1")
        assert len(attempts) == 2, "the second retry did not double the delay"
        advance(page, 2 * STEP_MS)
        pump(page, attempts, 3, "a second retry after twice the base delay")
        page.reload()
        poll(page, lambda: delivery(page, first) == "sending" and delivery(page, second) == "sending",
             "both letters still Sending after reload")
        page.unroute("**/api/letters")
        page.context.set_offline(True)
        page.context.set_offline(False)
        for text in (first, second):
            expect(letter(page, text).first).to_have_attribute("data-delivery", re.compile("^(sent|delivered|read)$"), timeout=EXPECT_MS)
        held: dict[str, dict] = {}
        deadline = time.monotonic() + WAIT_S
        while len(held) < 2 and time.monotonic() < deadline:
            for lt, opened in p.collect():
                if opened["body"].get("text") in (first, second):
                    held[opened["body"]["text"]] = lt
        assert len(held) == 2, f"the exchange handed over only {sorted(held)} of the two outbox letters"
        a, b = held[first], held[second]
        assert a["seq"] < b["seq"], "the outbox posted out of order"
        ids = [lt["id"] for lt in p.call("GET", f"/api/conversations/{cid}/letters").json()["letters"]]
        assert ids.count(a["id"]) == 1 and ids.count(b["id"]) == 1


def test_wf_sender_offline_five(browser: Browser, app_url: str) -> None:
    delay = config(app_url)["timers"]["connecting_delay_ms"]
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Before going offline {tag()}")
        open_conversation(p2, app_url, cid)
        bar = p1.get_by_role("status", name="Connection")
        p1.context.set_offline(True)
        assert p1.evaluate("() => navigator.onLine") is False
        advance(p1, delay - STEP_MS)
        assert CONNECTING not in bar.inner_text(), "the Connecting bar came before the published delay"
        advance(p1, 2 * STEP_MS)
        poll(p1, lambda: CONNECTING in bar.inner_text(), "the Connecting bar")
        texts = [f"Offline {i} {tag()}" for i in range(1, 6)]
        for text in texts:
            send_letter(p1, text)
        for text in texts:
            poll(p1, lambda: delivery(p1, text) == "sending", f"{text} Sending")
        p1.context.set_offline(False)
        poll(p1, lambda: all(delivery(p1, t) in POSTED_STATES for t in texts) and CONNECTING not in bar.inner_text(),
             "all five posted, bar gone")
        poll(p2, lambda: all(letter(p2, t).count() == 1 for t in texts), "all five arriving once each")
        shown = letters(p2).all_inner_texts()
        positions = [next(i for i, s in enumerate(shown) if t in s) for t in texts]
        assert positions == sorted(positions), "the five arrived out of order"
        ids = [letter(p1, t).first.get_attribute("data-letter-id") for t in texts]
        server = [lt["id"] for lt in u2.call("GET", f"/api/conversations/{cid}/letters")[1]["letters"] if lt["id"] in ids]
        assert server == ids


def test_held_queue_in_order(app_url: str, sealer: Sealer) -> None:
    p, q = Person(app_url, sealer), Person(app_url, sealer)
    cid = p.converse(q.id)["id"]
    posted = [p.send(cid, q.card(), f"Held {i}") for i in range(5)]
    assert all(r.status_code == 201 for r in posted)
    ids = [r.json()["id"] for r in posted]
    cts = [unb64u(json.loads(r.request.content)["ciphertext"]) for r in posted]
    inbox = q.call("GET", "/api/inbox").json()["letters"]
    mine = [lt for lt in inbox if lt["id"] in ids]
    assert [lt["id"] for lt in mine] == ids and [lt["seq"] for lt in mine] == sorted(lt["seq"] for lt in mine)
    db = Postgres()
    assert db_holds(db, bytes_needles(cts[0])), "the held ciphertext is not in PostgreSQL before collection"
    ack = q.call("POST", "/api/inbox/ack", {"through_seq": mine[2]["seq"]})
    assert ack.json() == {"delivered": 3}, err(ack)
    assert [lt["id"] for lt in q.call("GET", "/api/inbox").json()["letters"]] == ids[3:]
    assert not db_holds(db, bytes_needles(cts[0])) and db_holds(db, bytes_needles(cts[4]))
    assert q.call("POST", "/api/inbox/ack", {"through_seq": mine[4]["seq"]}).json() == {"delivered": 2}
    assert q.call("GET", "/api/inbox").json()["letters"] == []
    assert not db_holds(db, bytes_needles(cts[4]))
    assert all(p.call("GET", f"/api/letters/{i}").json()["state"] == "delivered" for i in ids)


def test_unread_counts(browser: Browser, app_url: str, sealer: Sealer) -> None:
    a, b = Person(app_url, sealer), Person(app_url, sealer)
    bc = a.converse(b.id)["id"]
    a.send(bc, b.card(), "One")
    b.call("POST", f"/api/conversations/{bc}/accept", {})
    a.send(bc, b.card(), "Two")
    assert b.call("GET", f"/api/conversations/{bc}").json()["unread"] == 0, "held letters counted as unread"
    b.collect()
    assert b.call("GET", f"/api/conversations/{bc}").json()["unread"] == 2

    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Unread opener")
        read_through(page, u, app_url, cid)
        page.goto(f"{app_url}/letters")
        sent = [p.send(cid, u.card(), f"Unread {i}").json() for i in range(3)]
        p.post(p.letter(cid, u.card(), {"v": 1, "kind": "profile", "profile_key": b64u(os.urandom(32))}, cls="control"))
        poll(page, lambda: u.unread(cid) == 3 and badge_text(page, cid) == "3", "row badge 3")
        poll(page, lambda: tab_badge_shows(page, 3) and page.title() == "(3) Airfold", "Chats badge and title 3")
        assert u.call("POST", f"/api/conversations/{cid}/read", {"through_seq": sent[0]["seq"]})[0] == 200
        assert u.unread(cid) == 2
        page.reload()
        poll(page, lambda: badge_text(page, cid) == "2" and page.title() == "(2) Airfold", "counts after reload")
        for i in range(BADGE_CAP + 1):
            p.send(cid, u.card(), f"Flood {i}")
        poll(page, lambda: u.unread(cid) == BADGE_CAP + 3 and badge_text(page, cid) == "99+", "the 99+ disc")


def test_wf_recipient_offline_collect(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Collect opener")
        read_through(page, u, app_url, cid)
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None, "Chats")
        page.context.set_offline(True)
        page.evaluate("() => navigator.onLine")
        texts = [f"While away {i} {tag()}" for i in range(3)]
        posted = [p.send(cid, u.card(), t) for t in texts]
        assert all(p.call("GET", f"/api/letters/{r.json()['id']}").json()["state"] == "sent" for r in posted)
        page.context.set_offline(False)
        expect(page.get_by_role("status", name="Connection")).to_contain_text(
            f"Updating... {len(texts)} letters", timeout=EXPECT_MS)
        poll(page, lambda: all(p.call("GET", f"/api/letters/{r.json()['id']}").json()["state"] == "delivered" for r in posted),
             "all three delivered")
        poll(page, lambda: badge_text(page, cid) == "3" and tab_badge_shows(page, 3) and page.title() == "(3) Airfold",
             "badges matching the held count")
        assert u.call("GET", "/api/inbox")[1]["letters"] == []
        assert not db_holds(Postgres(), [n for r in posted for n in bytes_needles(unb64u(json.loads(r.request.content)["ciphertext"]))])
        click(chats_item(page, cid).get_by_role("link").first)
        poll(page, lambda: all(letter(page, t).count() == 1 for t in texts), "the letters in the open conversation")
        shown = letters(page).all_inner_texts()
        positions = [next(i for i, s in enumerate(shown) if t in s) for t in texts]
        assert positions == sorted(positions)


def test_wf_recipient_offline_keyboard(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Keyboard opener")
        read_through(page, u, app_url, cid)
        page.goto(f"{app_url}/letters")
        texts = [f"Keyboard {i} {tag()}" for i in range(2)]
        for t in texts:
            p.send(cid, u.card(), t)
        poll(page, lambda: badge_text(page, cid) == "2", "row badge 2")
        row = chats_item(page, cid).get_by_role("link").first
        tab_to(page, row, "the conversation row")
        page.keyboard.press("Enter")
        poll(page, lambda: cid in page.url and all(letter(page, t).count() == 1 for t in texts), "the opened conversation")
        poll(page, lambda: u.unread(cid) == 0, "unread zero after opening")
        poll(page, lambda: tab_badge(page) == 0 and page.title() == "Airfold", "badges cleared")


def test_photo_preparation(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Photo opener")
        open_conversation(page, app_url, cid)
        for name, mime, data, expected in (
            ("harbour-gps.jpg", "image/jpeg", gps_photo(sealer), None),
            ("tiny.png", "image/png", tiny_png(sealer), (TINY_EDGE, TINY_EDGE)),
        ):
            choose(page, "Attach photo", file_payload(name, mime, data))
            click(page.get_by_role("button", name="Send"))
            got, opened = collect_until(p, lambda lt, o, n=name: o["body"].get("kind") == "image"
                                        and o["body"]["attachment"]["name"] == n, f"the photo letter {name}")
            att = opened["body"]["attachment"]
            blob = p.call("GET", f"/api/blobs/{att['blob_id']}")
            assert blob.status_code == 200, err(blob)
            assert b64u(hashlib.sha256(blob.content).digest()) == att["digest"]
            assert S3().get(f"blobs/{u.id}/{att['blob_id']}") == blob.content
            plain = unb64u(sealer("openBytes", att["key"], att["iv"], b64u(blob.content)))
            assert len(plain) == att["size"] and len(blob.content) == att["size"] + GCM_TAG
            w, h, exif = jpeg_info(plain)
            assert not exif and CAMERA_MAKE.encode() not in plain, "location or camera metadata survived"
            assert (w, h) == (att["width"], att["height"]) and max(w, h) <= PHOTO_EDGE
            if expected:
                assert (w, h) == expected, "a small photo was enlarged"
            else:
                assert abs(w / h - GPS_PHOTO[0] / GPS_PHOTO[1]) < ASPECT_TOLERANCE
            tw, th, texif = jpeg_info(unb64u(att["thumb"]))
            assert max(tw, th) <= THUMB_EDGE and not texif
        choose(page, "Attach photo", file_payload("crate.bin", "application/octet-stream", os.urandom(CRATE_BYTES)))
        poll(page, lambda: visible(page.get_by_text(WRONG_PHOTO, exact=True)), "the wrong photo type copy")


def test_wf_image_letters_stored_first(browser: Browser, app_url: str, sealer: Sealer) -> None:
    a, b = Person(app_url, sealer), Person(app_url, sealer)
    cid = a.converse(b.id)["id"]
    s = sealer("sealBytes", b64u(ferry_pdf()))
    sealed = unb64u(s["sealed"])
    blob_id = new_id()
    d = a.call("POST", "/api/blobs", {"id": blob_id, "kind": "file", "size": len(sealed)})
    assert d.status_code == 201 and d.json() == {"id": blob_id, "kind": "file", "size": len(sealed), "state": "uploading"}
    body = {"v": 1, "kind": "file", "text": "", "attachment": {"blob_id": blob_id, "key": s["key"], "iv": s["iv"],
            "digest": s["digest"], "size": PDF_BYTES, "name": "ferry-timetable.pdf", "type": "application/pdf"}}
    early = a.post(a.letter(cid, b.card(), body, attachment_id=blob_id))
    assert early.status_code == 409 and early.json()["error"] == "attachment_not_stored", err(early)
    short = a.put_content(blob_id, sealed[:-1])
    assert short.status_code == 422 and short.json()["error"] == "size_mismatch", err(short)
    long = a.put_content(blob_id, sealed + b"\x00")
    assert long.status_code == 413, err(long)
    assert not S3().keys(f"blobs/{a.id}/{blob_id}"), "a refused upload left an object"
    ok = a.put_content(blob_id, sealed)
    assert ok.status_code == 200 and ok.json()["state"] == "stored", err(ok)
    assert S3().get(f"blobs/{a.id}/{blob_id}") == sealed
    assert a.put_content(blob_id, sealed).json() == {"error": "already_stored"}
    assert a.post(a.letter(cid, b.card(), body, attachment_id=blob_id)).status_code == 201
    reuse = a.post(a.letter(cid, b.card(), body, attachment_id=blob_id))
    assert reuse.status_code == 409 and reuse.json()["error"] == "attachment_in_use", err(reuse)
    assert [lt["attachment_id"] for lt in b.call("GET", "/api/inbox").json()["letters"]] == [blob_id]

    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        pcid = person_to_ui(p, u, "Stored first opener")
        open_conversation(page, app_url, pcid)
        posts: list[str] = []
        page.on("request", lambda req: posts.append(req.url) if req.method == "POST" and req.url.endswith("/api/letters") else None)
        page.get_by_role("status", name="Letter updates").evaluate(
            "el => { window.__afLog = [el.textContent]; new MutationObserver(() => window.__afLog.push(el.textContent))"
            ".observe(el, { childList: true, subtree: true, characterData: true }); }")
        before = letters(page).count()
        with held(page, "**/api/blobs/*/content") as gate:
            choose(page, "Attach photo", file_payload("tiny.png", "image/png", tiny_png(sealer)))
            click(page.get_by_role("button", name="Send"))
            poll(page, lambda: letters(page).count() == before + 1
                 and letters(page).last.get_attribute("data-delivery") == "sending", "the uploading letter on Sending")
            assert label(letters(page).last) == "Sending" and posts == [], "the letter posted before its upload finished"
            release(gate)
        poll(page, lambda: letters(page).last.get_attribute("data-delivery") in POSTED_STATES and len(posts) == 1, "posted after upload")
        poll(page, lambda: any(UPLOAD_DONE in t for t in page.evaluate("() => window.__afLog")), "Upload finished announced")
        _, opened = collect_until(p, lambda lt, o: o["body"].get("kind") == "image", "the stored photo letter")
        att = opened["body"]["attachment"]
        assert b64u(hashlib.sha256(p.call("GET", f"/api/blobs/{att['blob_id']}").content).digest()) == att["digest"]


def test_participants_only(app_url: str, sealer: Sealer) -> None:
    a, b, c = Person(app_url, sealer), Person(app_url, sealer), Person(app_url, sealer)
    cid = a.converse(b.id)["id"]
    lid = a.send(cid, b.card(), "Only for b").json()["id"]
    att, sealed = a.attach("file", ferry_pdf(), "ferry-timetable.pdf", "application/pdf")
    a.post(a.letter(cid, b.card(), {"v": 1, "kind": "file", "text": "", "attachment": att}, attachment_id=att["blob_id"]))
    loose, _ = a.attach("file", b"loose", "loose.txt", "text/plain")
    b.call("POST", f"/api/conversations/{cid}/accept", {})
    assert b.call("GET", f"/api/blobs/{att['blob_id']}").content == sealed
    assert b.call("GET", f"/api/blobs/{loose['blob_id']}").status_code == 404, "an unattached blob was visible to a non-owner"
    own = c.converse(b.id)["id"]
    real = {"conv": cid, "letter": lid, "blob": att["blob_id"], "loose": loose["blob_id"], "peer": a.id}
    ghost = {k: new_id() for k in real}
    cases: dict[str, Callable[[dict], tuple[str, str, Any]]] = {
        "conversation": lambda i: ("GET", f"/api/conversations/{i['conv']}", None),
        "letters": lambda i: ("GET", f"/api/conversations/{i['conv']}/letters", None),
        "read": lambda i: ("POST", f"/api/conversations/{i['conv']}/read", {"through_seq": 1}),
        "mute": lambda i: ("PUT", f"/api/conversations/{i['conv']}/mute", {"duration": "1h"}),
        "accept": lambda i: ("POST", f"/api/conversations/{i['conv']}/accept", {}),
        "delete": lambda i: ("DELETE", f"/api/conversations/{i['conv']}", None),
        "letter": lambda i: ("GET", f"/api/letters/{i['letter']}", None),
        "retract": lambda i: ("POST", f"/api/letters/{i['letter']}/retract", {}),
        "blob": lambda i: ("GET", f"/api/blobs/{i['blob']}", None),
        "loose": lambda i: ("GET", f"/api/blobs/{i['loose']}", None),
        "conversation_id": lambda i: ("POST", "/api/letters", junk_letter(i["conv"], b.key_id)),
        "attachment_id": lambda i: ("POST", "/api/letters", junk_letter(own, b.key_id, attachment_id=i["blob"])),
        "photo_blob_id": lambda i: ("PUT", "/api/me/profile", {"iv": b64u(os.urandom(IV_BYTES)),
                                     "ciphertext": b64u(os.urandom(PAD_BLOCK + GCM_TAG)), "photo_blob_id": i["blob"]}),
        "seal": lambda i: ("PUT", f"/api/contacts/{i['peer']}/seal", {"key_id": a.key_id, "verified": True}),
        "peer_id": lambda i: ("POST", "/api/conversations", {"peer_id": ghost["peer"]}),
    }
    for case, build in cases.items():
        for ids in (real, ghost):
            method, path, body = build(ids)
            r = c.call(method, path, body)
            assert r.status_code == 404 and r.json() == {"error": "not_found"}, f"{case}: {err(r)}"
    for ids in (real, ghost):
        r = c.put_content(ids["loose"], b"x")
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, err(r)
    assert a.call("GET", f"/api/letters/{lid}").json()["retracted_at"] is None
    assert b.call("GET", f"/api/conversations/{cid}").status_code == 200


def test_wf_image_letters_outsider(browser: Browser, app_url: str, sealer: Sealer) -> None:
    a, b, c = Person(app_url, sealer), Person(app_url, sealer), Person(app_url, sealer)
    cid = a.converse(b.id)["id"]
    att, _ = a.attach("image", tiny_png(sealer), "tiny.png", "image/png")
    a.post(a.letter(cid, b.card(), {"v": 1, "kind": "image", "text": "", "attachment": att}, attachment_id=att["blob_id"]))
    b.call("POST", f"/api/conversations/{cid}/accept", {})
    photo, _ = b.attach("photo", tiny_png(sealer), "me.png", "image/png")
    saved, _ = b.save_profile("Photo owner", photo["blob_id"])
    assert saved.status_code == 200, err(saved)
    c.send(c.converse(b.id)["id"], b.card(), "Unanswered request")
    assert a.call("GET", f"/api/blobs/{photo['blob_id']}").status_code == 200
    assert c.call("GET", f"/api/blobs/{photo['blob_id']}").status_code == 404, "a request starter fetched the profile photo"
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        o = ui_signup(page, app_url)
        for target in (cid, new_id()):
            page.goto(f"{app_url}/letters/{target}")
            poll(page, lambda: visible(page.get_by_text(NOT_FOUND_COPY, exact=True)), "the not-found sheet")
        for path in (f"/api/conversations/{cid}", f"/api/blobs/{att['blob_id']}", f"/api/blobs/{photo['blob_id']}",
                     f"/api/blobs/{new_id()}"):
            assert o.call("GET", path) == (404, {"error": "not_found"}), path


def test_wf_image_letters_photo(browser: Browser, app_url: str, sealer: Sealer) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(PHONE)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Photo coming {tag()}")
        open_conversation(p2, app_url, cid)
        gate = stack.enter_context(held(p2, "**/api/blobs/*"))
        choose(p1, "Attach photo", file_payload("tiny.png", "image/png", tiny_png(sealer)), touch=True)
        tap(p1.get_by_role("button", name="Send"))
        poll(p2, lambda: letters(p2).count() >= 2, "the photo letter arriving while its download is held")
        release(gate)
        opener = p2.get_by_role("button", name="Open photo").last
        poll(p2, lambda: visible(opener.get_by_role("img", name=f"Photo from {u1.username}")), "the received photo with alt text")
        poll(p1, lambda: visible(p1.get_by_role("button", name="Open photo").last.get_by_role("img", name="Your photo")), "Your photo")
        opener.focus()
        p2.keyboard.press("Enter")
        viewer = p2.get_by_role("dialog", name="Photo viewer")
        poll(p2, lambda: visible(viewer) and visible(viewer.get_by_role("button", name="Close photo")), "the photo viewer")
        p2.keyboard.press("Escape")
        poll(p2, lambda: not visible(viewer) and focused(opener), "Escape back to the photo")
        assert S3().keys(f"blobs/{u1.id}/")


def test_attachment_limits(app_url: str, sealer: Sealer) -> None:
    assert config(app_url)["attachment_max_bytes"] == DEFAULT_CAP
    cap = config(SHORT_URL)["attachment_max_bytes"]
    p = Person(SHORT_URL, sealer)
    over = new_id()
    r = p.call("POST", "/api/blobs", {"id": over, "kind": "file", "size": cap + 1})
    assert r.status_code == 413 and r.json() == {"error": "too_large"}, err(r)
    assert p.call("GET", f"/api/blobs/{over}").status_code == 404 and not S3("-short").keys(f"blobs/{p.id}/{over}")
    edge = new_id()
    declared = {"id": edge, "kind": "file", "size": cap}
    assert p.call("POST", "/api/blobs", declared).status_code == 201
    assert p.call("POST", "/api/blobs", declared).status_code == 200
    for changed in ({**declared, "size": cap - 1}, {**declared, "kind": "image"}):
        conflict = p.call("POST", "/api/blobs", changed)
        assert conflict.status_code == 409 and conflict.json()["error"] == "blob_id_conflict", err(conflict)
    full = p.put_content(edge, os.urandom(cap))
    assert full.status_code == 200 and full.json()["state"] == "stored", err(full)
    assert len(S3("-short").get(f"blobs/{p.id}/{edge}")) == cap
    for kind in ("image", "file", "photo"):
        assert p.call("POST", "/api/blobs", {"id": new_id(), "kind": kind, "size": GCM_TAG + 1}).status_code == 201
    bad_kind = p.call("POST", "/api/blobs", {"id": new_id(), "kind": "video", "size": GCM_TAG + 1})
    assert bad_kind.status_code == 422 and bad_kind.json()["fields"]["kind"] == "unsupported", err(bad_kind)
    for size in (-1, "17"):
        bad = p.call("POST", "/api/blobs", {"id": new_id(), "kind": "file", "size": size})
        assert bad.status_code == 422 and bad.json()["fields"]["size"] == "invalid", err(bad)

    a, b = Person(app_url, sealer), Person(app_url, sealer)
    cid = a.converse(b.id)["id"]
    att, sealed = a.attach("file", ferry_pdf(), "ferry-timetable.pdf", "application/pdf")
    a.post(a.letter(cid, b.card(), {"v": 1, "kind": "file", "text": "", "attachment": att}, attachment_id=att["blob_id"]))
    for viewer in (a, b):
        got = viewer.call("GET", f"/api/blobs/{att['blob_id']}")
        assert got.status_code == 200 and got.content == sealed
        assert got.headers["content-type"].split(";")[0].strip() == "application/octet-stream"
        assert got.headers["content-disposition"].split(";")[0].strip().lower() == "attachment"
        assert got.headers["x-content-type-options"] == "nosniff"
        assert {v.strip() for v in got.headers["cache-control"].split(",")} == {"private", "no-store"}


def test_attachment_digest(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Digest opener")
        good, _ = p.attach("file", ferry_pdf(), "ferry-timetable.pdf", "application/pdf")
        bad, _ = p.attach("file", os.urandom(CRATE_BYTES), "crate.bin", "application/octet-stream")
        bad["digest"] = b64u(hashlib.sha256(b"tampered").digest())
        for att in (good, bad):
            r = p.post(p.letter(cid, u.card(), {"v": 1, "kind": "file", "text": "", "attachment": att}, attachment_id=att["blob_id"]))
            assert r.status_code == 201, err(r)
        downloads: list[Any] = []
        page.on("download", lambda d: downloads.append(d))
        open_conversation(page, app_url, cid)
        poll(page, lambda: visible(page.get_by_role("button", name="Download ferry-timetable.pdf")), "the intact file's download")
        crate = page.get_by_role("button", name="Download crate.bin")
        if visible(crate):
            click(crate)
        poll(page, lambda: visible(page.get_by_text(CORRUPTED, exact=True)), "the corrupted notice")
        assert crate.count() == 0 and downloads == [], "a corrupted attachment was offered or downloaded"


def test_storage_outage_api(sealer: Sealer) -> None:
    base = MINIO_DOWN_URL
    health = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "unavailable"}
    a, b = Person(base, sealer), Person(base, sealer)
    blob_id, theirs = new_id(), new_id()
    d = a.call("POST", "/api/blobs", {"id": blob_id, "kind": "file", "size": PAD_BLOCK + GCM_TAG})
    assert d.status_code == 201 and d.json()["state"] == "uploading", err(d)
    b.call("POST", "/api/blobs", {"id": theirs, "kind": "file", "size": PAD_BLOCK + GCM_TAG})
    up = a.put_content(blob_id, os.urandom(PAD_BLOCK + GCM_TAG))
    assert up.status_code == 503 and up.json() == {"error": "storage_unavailable"}, err(up)
    assert a.put_content(theirs, os.urandom(PAD_BLOCK + GCM_TAG)).status_code == 404, "503 came before the ownership check"
    cid = a.converse(b.id)["id"]
    named = a.post(junk_letter(cid, b.key_id, attachment_id=blob_id))
    assert named.status_code == 409 and named.json()["error"] == "attachment_not_stored", err(named)
    photo_id = new_id()
    a.call("POST", "/api/blobs", {"id": photo_id, "kind": "photo", "size": PAD_BLOCK + GCM_TAG})
    prof = a.call("PUT", "/api/me/profile", {"iv": b64u(os.urandom(IV_BYTES)), "ciphertext": b64u(os.urandom(PAD_BLOCK + GCM_TAG)),
                                              "photo_blob_id": photo_id})
    assert prof.status_code == 409 and prof.json()["error"] == "attachment_not_stored", err(prof)
    text = f"Still flowing {tag()}"
    sent = a.send(cid, b.card(), text)
    assert sent.status_code == 201, err(sent)
    collect_until(b, has_text(text), "a text letter during the storage outage")
    assert a.call("GET", f"/api/letters/{sent.json()['id']}").json()["state"] == "delivered"
    assert b.call("GET", f"/api/lookup?username={a.username}").status_code == 200


def test_wf_file_letters_download(browser: Browser, app_url: str, sealer: Sealer) -> None:
    cap = config(SHORT_URL)["attachment_max_bytes"]
    limit = f"{math.floor(cap / MEGABYTE * 10) / 10:.1f} MB"
    crate_bytes = os.urandom(CRATE_BYTES)
    assert len(crate_bytes) + GCM_TAG > cap
    with contextlib.ExitStack() as stack:
        ps = stack.enter_context(app_page(browser, SHORT_URL))
        ps.set_viewport_size(DESKTOP)
        us = ui_signup(ps, SHORT_URL)
        ccid = person_to_ui(Person(SHORT_URL, sealer), us, "Short opener")
        open_conversation(ps, SHORT_URL, ccid)
        blob_calls: list[str] = []
        ps.on("request", lambda req: blob_calls.append(req.url) if "/api/blobs" in req.url else None)
        choose(ps, "Attach file", file_payload("crate.bin", "application/octet-stream", crate_bytes))
        poll(ps, lambda: visible(ps.get_by_text(f"This file is larger than {limit} and can't be sent.", exact=True)), "the over-cap copy")
        assert blob_calls == [], "an over-cap file reached the exchange"

        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"File coming {tag()}")
        pdf = ferry_pdf()
        choose(p1, "Attach file", file_payload("ferry-timetable.pdf", "application/pdf", pdf))
        click(p1.get_by_role("button", name="Send"))
        open_conversation(p2, app_url, cid)
        button = p2.get_by_role("button", name="Download ferry-timetable.pdf")
        poll(p2, lambda: visible(button), "the file letter's download button")
        with p2.expect_download(timeout=EXPECT_MS) as dl:
            click(button)
        assert Path(dl.value.path()).read_bytes() == pdf, "the downloaded file differs from the one sent"
        keys = S3().keys(f"blobs/{u1.id}/")
        assert len(keys) == 1 and len(S3().get(keys[0])) == PDF_BYTES + GCM_TAG


def test_wf_file_letters_outage(browser: Browser, sealer: Sealer) -> None:
    base = MINIO_DOWN_URL
    p = Person(base, sealer)
    with app_page(browser, base) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, base)
        banner = page.get_by_role("alert").filter(has_text=OUTAGE_COPY)
        poll(page, lambda: visible(banner) and OUTAGE_COPY in banner.first.inner_text(), "the outage banner")
        cid = person_to_ui(p, u, "Outage opener")
        open_conversation(page, base, cid)
        choose(page, "Attach file", file_payload("ferry-timetable.pdf", "application/pdf", ferry_pdf()))
        click(page.get_by_role("button", name="Send"))
        failed = letters(page).filter(has_text=UPLOAD_FAILED)
        poll(page, lambda: visible(failed) and failed.first.get_attribute("data-delivery") == "failed", "the failed letter")
        assert label(failed) == "Failed" and visible(failed.first.get_by_role("button", name="Retry upload"))
        poll(page, lambda: UPLOAD_FAILED in status_text(page, "Letter updates"), "the upload failure announced")
        text = f"Text in the outage {tag()}"
        send_letter(page, text)
        collect_until(p, has_text(text), "the text letter")
        server = p.call("GET", f"/api/conversations/{cid}/letters").json()["letters"]
        assert all(lt["attachment_id"] is None for lt in server), "a failed upload left a letter"


def test_deleting_letters(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p, q = Person(app_url, sealer), Person(app_url, sealer)
    cid = p.converse(q.id)["id"]
    l1 = p.send(cid, q.card(), "Retract me").json()
    assert p.call("GET", f"/api/letters/{l1['id']}").json()["can_retract"] is True
    assert q.call("GET", f"/api/letters/{l1['id']}").json()["can_retract"] is False
    not_sender = q.call("POST", f"/api/letters/{l1['id']}/retract", {})
    assert not_sender.status_code == 403 and not_sender.json() == {"error": "not_sender"}, err(not_sender)
    done = p.call("POST", f"/api/letters/{l1['id']}/retract", {})
    assert done.status_code == 200 and done.json()["retracted_at"], err(done)
    assert p.call("POST", f"/api/letters/{l1['id']}/retract", {}).json()["retracted_at"] == done.json()["retracted_at"]
    view = q.call("GET", f"/api/letters/{l1['id']}").json()
    assert view["iv"] is None and view["ciphertext"] is None
    att, _ = p.attach("file", ferry_pdf(), "ferry-timetable.pdf", "application/pdf")
    l2 = p.post(p.letter(cid, q.card(), {"v": 1, "kind": "file", "text": "", "attachment": att}, attachment_id=att["blob_id"])).json()
    assert S3().keys(f"blobs/{p.id}/{att['blob_id']}")
    p.call("POST", f"/api/letters/{l2['id']}/retract", {})
    assert not S3().keys(f"blobs/{p.id}/{att['blob_id']}"), "retracting kept the attachment object"
    l3 = p.send(cid, q.card(), "Old letter").json()
    with server_clock(app_url) as shift:
        shift(RETRACT_MS - MARGIN_MS)
        assert p.call("GET", f"/api/letters/{l3['id']}").json()["can_retract"] is True
        shift(RETRACT_MS + MARGIN_MS)
        assert p.call("GET", f"/api/letters/{l3['id']}").json()["can_retract"] is False
        late = p.call("POST", f"/api/letters/{l3['id']}/retract", {})
        assert late.status_code == 409 and late.json() == {"error": "retract_window_closed"}, err(late)

    s = Person(app_url, sealer)
    undo_ms = config(app_url)["timers"]["undo_ms"]
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        ucid = person_to_ui(s, u, "Delete opener")
        keep = f"Keep or drop {tag()}"
        s.send(ucid, u.card(), keep)
        open_conversation(page, app_url, ucid)
        poll(page, lambda: letter(page, keep).count() == 1, "the letter to delete")
        dialog = page.get_by_role("dialog", name="Letter actions")
        for attempt in range(2):
            click(letter(page, keep).first.get_by_role("button", name="Letter actions"))
            poll(page, lambda: visible(dialog), "Letter actions")
            click(dialog.get_by_role("button", name="Delete for me"))
            snack = page.get_by_text(SNACKBAR_COPY)
            poll(page, lambda: visible(snack) and letter(page, keep).count() == 0,
                 "the letter hidden with the snackbar")
            if attempt == 0:
                page.reload()
                poll(page, lambda: letter(page, keep).count() == 1, "a reload before the window keeping the letter")
        advance(page, undo_ms + STEP_MS)
        page.reload()
        poll(page, lambda: visible(composer(page)), "the conversation after reload")
        assert letter(page, keep).count() == 0, "Delete for me came back after the Undo window"
        gone = f"Recalled {tag()}"
        lid = s.send(ucid, u.card(), gone).json()["id"]
        poll(page, lambda: letter(page, gone).count() == 1, "the letter before retraction")
        s.call("POST", f"/api/letters/{lid}/retract", {})
        poll(page, lambda: letter(page, gone).count() == 0 and visible(page.get_by_text(DELETED_RECIPIENT, exact=True)),
             "the recipient's deleted notice")


def test_wf_deleting_journey(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        a_text, b_text, c_text = (f"Letter {x} {tag()}" for x in "ABC")
        cid = ui_to_ui(u1, u2, a_text)
        for t in (b_text, c_text):
            send_letter(p1, t)
            wait_delivery(p1, t, POSTED_STATES)
        open_conversation(p2, app_url, cid)
        dialog = p1.get_by_role("dialog", name="Letter actions")
        touch_press(p1, letter(p1, a_text), LONG_PRESS_MS - STEP_MS)
        for _ in range(3):
            p1.evaluate("1")
        assert not visible(dialog), "a short press opened Letter actions"
        touch_press(p1, letter(p1, a_text), LONG_PRESS_MS + STEP_MS)
        poll(p1, lambda: visible(dialog), "a half-second press opening Letter actions")
        p1.keyboard.press("Escape")
        poll(p1, lambda: not visible(dialog), "Escape closing Letter actions")
        actions = letter(p1, a_text).first.get_by_role("button", name="Letter actions")
        actions.focus()
        p1.keyboard.press("Enter")
        poll(p1, lambda: visible(dialog), "Letter actions by keyboard")
        mine = dialog.get_by_role("button", name="Delete for me")
        tab_to(p1, mine, "Delete for me")
        p1.keyboard.press("Enter")
        undo = p1.get_by_role("button", name="Undo")
        poll(p1, lambda: visible(undo) and letter(p1, a_text).count() == 0, "the snackbar with Undo")
        undo.focus()
        p1.keyboard.press("Enter")
        poll(p1, lambda: letter(p1, a_text).count() == 1 and RESTORED_COPY in status_text(p1, "Letter updates"), "Undo restoring")
        b_id = letter(p1, b_text).first.get_attribute("data-letter-id")
        click(letter(p1, b_text).first.get_by_role("button", name="Letter actions"))
        poll(p1, lambda: visible(dialog.get_by_role("button", name="Delete for everyone")), "Delete for everyone offered")
        click(dialog.get_by_role("button", name="Delete for everyone"))
        poll(p1, lambda: DELETED_SENDER in (letter_by_id(p1, b_id).inner_text() if letter_by_id(p1, b_id) else ""), "sender notice")
        poll(p2, lambda: DELETED_RECIPIENT in (letter_by_id(p2, b_id).inner_text() if letter_by_id(p2, b_id) else "")
             and letter(p2, b_text).count() == 0, "the other browser changing live")
        assert u1.call("GET", f"/api/letters/{b_id}")[1]["retracted_at"]
        c_id = letter(p1, c_text).first.get_attribute("data-letter-id")
        with server_clock(app_url) as shift:
            shift(RETRACT_MS + MARGIN_MS)
            click(letter(p1, c_text).first.get_by_role("button", name="Letter actions"))
            poll(p1, lambda: visible(dialog.get_by_role("button", name="Delete for me")), "Letter actions after 24 h")
            assert dialog.get_by_role("button", name="Delete for everyone").count() == 0
            assert u1.call("GET", f"/api/letters/{c_id}")[1]["can_retract"] is False


def test_wf_deleting_unread(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Unread delete opener")
        read_through(page, u, app_url, cid)
        page.goto(f"{app_url}/letters")
        first = p.send(cid, u.card(), "Stays").json()
        second = p.send(cid, u.card(), "Goes").json()
        poll(page, lambda: badge_text(page, cid) == "2" and page.title() == "(2) Airfold", "badge 2")
        assert first["id"] != second["id"]
        p.call("POST", f"/api/letters/{second['id']}/retract", {})
        poll(page, lambda: badge_text(page, cid) == "1" and tab_badge_shows(page, 1) and page.title() == "(1) Airfold",
             "badges dropping to 1 live")
        assert u.unread(cid) == 1
        page.reload()
        poll(page, lambda: badge_text(page, cid) == "1" and page.title() == "(1) Airfold", "badge 1 after reload")


def test_wf_blocking_dropped(browser: Browser, app_url: str, sealer: Sealer) -> None:
    b = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(b, u, "Block opener")
        put = u.call("PUT", f"/api/blocks/{b.id}", {})
        assert put[0] == 200 and put[1]["account_id"] == b.id and put[1]["username"] == b.username
        assert u.call("PUT", f"/api/blocks/{b.id}", {}) == put
        assert b.id in [x["account_id"] for x in u.call("GET", "/api/blocks")[1]["blocks"]]
        assert u.call("PUT", f"/api/blocks/{u.id}", {})[1]["fields"]["account_id"] == "self"
        for method in ("PUT", "DELETE"):
            assert u.call(method, f"/api/blocks/{new_id()}", {} if method == "PUT" else None) == (404, {"error": "not_found"})
        during = f"During the block {tag()}"
        dropped = b.send(cid, u.card(), during)
        assert dropped.status_code == 201 and dropped.json()["state"] == "sent", err(dropped)
        assert not db_holds(Postgres(), bytes_needles(unb64u(json.loads(dropped.request.content)["ciphertext"])))
        assert dropped.json()["id"] not in [lt["id"] for lt in u.call("GET", "/api/inbox")[1]["letters"]]
        open_conversation(page, app_url, cid)
        poll(page, lambda: visible(page.get_by_text(f"You blocked {b.username}.", exact=True)), "the blocked copy")
        assert composer(page).count() == 0
        click(page.get_by_role("button", name="Unblock").first)
        poll(page, lambda: visible(composer(page)), "the composer back after Unblock")
        assert b.id not in [x["account_id"] for x in u.call("GET", "/api/blocks")[1]["blocks"]]
        assert u.call("DELETE", f"/api/blocks/{b.id}")[0] == 204
        after = f"After the block {tag()}"
        later = b.send(cid, u.card(), after).json()
        poll(page, lambda: letter(page, after).count() == 1, "a new letter arriving after unblocking")
        assert letter(page, during).count() == 0
        poll(None, lambda: b.call("GET", f"/api/letters/{later['id']}").json()["state"] in ("delivered", "read"), "delivered")
        assert b.call("GET", f"/api/letters/{dropped.json()['id']}").json()["state"] == "sent"


def test_wf_blocking_journey(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Before blocking {tag()}")
        open_conversation(p2, app_url, cid)
        card = p1.get_by_role("region", name="Contact card")
        block = card.get_by_role("button", name="Block", exact=True)
        dialog = p1.get_by_role("dialog", name=f"Block {u2.username}?")
        block.focus()
        p1.keyboard.press("Enter")
        poll(p1, lambda: visible(dialog), "the Block dialog")
        assert (f"{u2.username} won't be able to reach you. Letters they send while blocked are never delivered."
                in dialog.inner_text())
        p1.keyboard.press("Escape")
        poll(p1, lambda: not visible(dialog), "Escape cancelling")
        assert_dialog_traps(p1, block, dialog, "Block")
        assert u2.id not in [x["account_id"] for x in u1.call("GET", "/api/blocks")[1]["blocks"]]
        block.focus()
        p1.keyboard.press("Enter")
        poll(p1, lambda: visible(dialog), "the Block dialog again")
        click(dialog.get_by_role("button", name="Block"))
        poll(p1, lambda: visible(p1.get_by_text(f"You blocked {u2.username}.", exact=True)), "the blocked copy")
        assert composer(p1).count() == 0 and visible(card.get_by_role("button", name="Unblock"))
        during = f"While blocked {tag()}"
        send_letter(p2, during)
        wait_delivery(p2, during, ("sent",))
        p1.goto(f"{app_url}/settings")
        unblock = p1.get_by_role("list", name="Blocked contacts").get_by_role("button", name=f"Unblock {u2.username}")
        poll(p1, lambda: visible(unblock), "the Blocked contacts list")
        click(unblock)
        poll(p1, lambda: visible(p1.get_by_text(BLOCKED_EMPTY, exact=True)), "the empty blocked list")
        after = f"After unblocking {tag()}"
        send_letter(p2, after)
        wait_delivery(p2, after, ("delivered", "read"))
        assert delivery(p2, during) == "sent"
        open_conversation(p1, app_url, cid)
        poll(p1, lambda: letter(p1, after).count() == 1, "the new letter in the blocker's browser")
        assert letter(p1, during).count() == 0


def test_seal_numbers(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Seal opener")
        expected = sealer("sealNumber", u.card()["public_key"], p.public_key)
        assert expected == sealer("sealNumber", p.public_key, u.card()["public_key"])
        assert re.fullmatch(rf"\d{{{SEAL_GROUP_DIGITS}}}( \d{{{SEAL_GROUP_DIGITS}}}){{{SEAL_GROUPS - 1}}}", expected)
        open_conversation(page, app_url, cid)
        card = page.get_by_role("region", name="Contact card")
        click(card.get_by_role("button", name="Show seal number"))
        dialog = page.get_by_role("dialog", name="Seal number")
        poll(page, lambda: visible(dialog), "the Seal number dialog")
        assert seal_text(dialog) == expected
        click(dialog.get_by_role("button", name="Mark as verified"))
        poll(page, lambda: u.call("GET", f"/api/conversations/{cid}")[1]["peer"]["seal"] == "verified", "seal verified")
        click(dialog.get_by_role("button", name="Close"))
        poll(page, lambda: visible(card.get_by_text("Verified", exact=True)), "the Verified mark")
        key_id = u.card()["key_id"]
    stale = p.call("PUT", f"/api/contacts/{u.id}/seal", {"key_id": "A" * 16, "verified": True})
    assert stale.status_code == 409 and stale.json() == {"error": "stale_key", "key_id": key_id}, err(stale)
    ok = p.call("PUT", f"/api/contacts/{u.id}/seal", {"key_id": key_id, "verified": True})
    assert ok.json() == {"account_id": u.id, "key_id": key_id, "seal": "verified"}
    assert Person(app_url, sealer).call("PUT", f"/api/contacts/{u.id}/seal", {"key_id": key_id, "verified": True}).status_code == 404


def test_wf_seal_numbers_restore(browser: Browser, app_url: str, sealer: Sealer) -> None:
    a, b = Person(app_url, sealer), Person(app_url, sealer)
    held_text = f"Held for restore {tag()}"
    cid = b.converse(a.id)["id"]
    b.send(cid, a.card(), held_text)
    old_cookie, old_key = a.cookie, a.key_id
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        page.goto(f"{app_url}/signin")
        fill(page.get_by_role("textbox", name="Username"), a.username)
        fill(page.get_by_role("textbox", name="Recovery code"), recovery_code())
        click(page.get_by_role("button", name="Restore account"))
        poll(page, lambda: visible(page.get_by_text(RESTORE_FAILED, exact=True)), "the restore failed copy")
        fill(page.get_by_role("textbox", name="Username"), a.username.upper())
        fill(page.get_by_role("textbox", name="Recovery code"), a.code.lower().replace("-", " "))
        click(page.get_by_role("button", name="Restore account"))
        poll(page, lambda: visible(page.get_by_role("navigation", name="Main")), "the restored app shell")
        page.goto(f"{app_url}/requests")
        poll(page, lambda: request_row(page, cid) is not None, "the held request")
        click(request_row(page, cid))
        poll(page, lambda: letter(page, held_text).count() == 1, "the held letter opening")
    assert a.call("GET", "/api/me", cookie=old_cookie).status_code == 401
    keys = b.call("GET", f"/api/accounts/{a.id}/keys").json()["keys"]
    assert [k["key_id"] for k in keys][0] == old_key and [k["current"] for k in keys] == [False, True]

    c = Person(app_url, sealer)
    before_cookie, backup = c.cookie, c.enrolment["key_backup"]
    r = c.recover()
    assert r.status_code == 200 and r.json()["account"]["key_id"] == c.key_id, err(r)
    assert [(k["iv"], k["ciphertext"]) for k in r.json()["key_backups"]][0] == (backup["iv"], backup["ciphertext"])
    assert c.call("GET", "/api/me").status_code == 200 and c.call("GET", "/api/me", cookie=before_cookie).status_code == 401
    wrong = {**sealer("enrol", c.username, recovery_code())["body"]}
    unknown = {**wrong, "username": fresh_name()}
    for body in (wrong, unknown):
        miss = httpx.post(f"{app_url}/api/recover", json=body, timeout=HTTP_TIMEOUT)
        assert miss.status_code == 401 and miss.json() == {"error": "recovery_failed"}, err(miss)

    e = Person(app_url, sealer)
    bad_e = {**sealer("enrol", e.username, recovery_code())["body"]}
    for _ in range(RESTORE_TRIES - 1):
        httpx.post(f"{app_url}/api/recover", json=bad_e, timeout=HTTP_TIMEOUT)
    assert e.recover().status_code == 200, "four failed attempts must not lock the account"

    d = Person(app_url, sealer)
    bad = {**sealer("enrol", d.username, recovery_code())["body"]}
    for _ in range(RESTORE_TRIES):
        httpx.post(f"{app_url}/api/recover", json=bad, timeout=HTTP_TIMEOUT)
    with server_clock(app_url) as shift:
        limited = d.recover()
        assert limited.status_code == 429 and limited.json() == {"error": "too_many_attempts"}, err(limited)
        shift(RESTORE_WINDOW_MS + MARGIN_MS)
        assert d.recover().status_code == 200


def test_key_change(app_url: str, sealer: Sealer) -> None:
    a, b = Person(app_url, sealer), Person(app_url, sealer)
    cid = a.converse(b.id)["id"]
    a.send(cid, b.card(), "Before the change")
    b.call("POST", f"/api/conversations/{cid}/accept", {})
    assert b.call("GET", f"/api/conversations/{cid}").json()["peer"]["seal"] == "unverified"
    b.call("PUT", f"/api/contacts/{a.id}/seal", {"key_id": a.key_id, "verified": True})
    old = a.card()
    assert a.recover().status_code == 200
    peer = b.call("GET", f"/api/conversations/{cid}").json()["peer"]
    assert peer["seal"] == "changed" and peer["key_id"] == a.key_id
    for target in (old, a.card()):
        paused = b.send(cid, target, "Paused")
        assert paused.status_code == 409 and paused.json()["error"] == "seal_change_unaccepted", err(paused)
    stale = b.call("PUT", f"/api/contacts/{a.id}/seal", {"key_id": old["key_id"], "verified": False})
    assert stale.status_code == 409 and stale.json() == {"error": "stale_key", "key_id": a.key_id}
    assert b.call("PUT", f"/api/contacts/{a.id}/seal", {"key_id": a.key_id, "verified": False}).json()["seal"] == "unverified"
    changed = b.send(cid, old, "Old key")
    assert changed.status_code == 409 and changed.json() == {"error": "recipient_key_changed", "key_id": a.key_id}, err(changed)
    text = f"New key {tag()}"
    assert b.send(cid, a.card(), text).status_code == 201
    collect_until(a, has_text(text), "a letter sealed to the new key")
    keys = b.call("GET", f"/api/accounts/{a.id}/keys").json()["keys"]
    assert [k["key_id"] for k in keys] == [old["key_id"], a.key_id]


def test_wf_seal_numbers_journey(browser: Browser, app_url: str, sealer: Sealer) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Seal journey {tag()}")
        numbers = []
        for p in (p1, p2):
            open_conversation(p, app_url, cid)
            click(p.get_by_role("region", name="Contact card").get_by_role("button", name="Show seal number"))
            dialog = p.get_by_role("dialog", name="Seal number")
            poll(p, lambda: visible(dialog), "the Seal number dialog")
            numbers.append(seal_text(dialog))
            if p is p1:
                click(dialog.get_by_role("button", name="Mark as verified"))
            click(dialog.get_by_role("button", name="Close"))
        assert numbers[0] == numbers[1]
        p3 = stack.enter_context(app_page(browser, app_url))
        p3.set_viewport_size(DESKTOP)
        p3.goto(f"{app_url}/signin")
        fill(p3.get_by_role("textbox", name="Username"), u2.username)
        fill(p3.get_by_role("textbox", name="Recovery code"), u2.code)
        click(p3.get_by_role("button", name="Restore account"))
        poll(p3, lambda: visible(p3.get_by_role("navigation", name="Main")), "the restored browser")
        poll(p2, lambda: visible(p2.get_by_role("heading", level=1, name="Signed out"))
             and visible(p2.get_by_text(SIGNED_OUT_COPY, exact=True)), "the old browser signed out")
        name = u2.username
        warning = p1.get_by_role("region", name="Seal number changed")
        poll(p1, lambda: visible(warning) and (f"{name}'s seal number has changed. Letters to {name} are paused until "
                                               "you accept the new seal number.") in warning.inner_text(), "the key-change warning")
        paused = f"Paused letter {tag()}"
        send_letter(p1, paused)
        poll(p1, lambda: delivery(p1, paused) == "sending", "the paused letter on Sending")
        assert u1.call("GET", f"/api/conversations/{cid}")[1]["peer"]["seal"] == "changed"
        accept = warning.get_by_role("button", name="Accept new seal number")
        accept.focus()
        p1.keyboard.press("Enter")
        poll(p1, lambda: focused(composer(p1)), "focus in the composer after Accept")
        wait_delivery(p1, paused, ("delivered", "read"))
        open_conversation(p3, app_url, cid)
        poll(p3, lambda: letter(p3, paused).count() == 1, "the resealed letter opening in the new browser")
        click(p1.get_by_role("region", name="Contact card").get_by_role("button", name="Show seal number"))
        fresh = p1.get_by_role("dialog", name="Seal number")
        poll(p1, lambda: visible(fresh) and seal_text(fresh) != "", "the new seal number")
        assert seal_text(fresh) != numbers[0]
        restored = Ui(p3, app_url, u2.username, u2.display_name, u2.code)
        assert seal_text(fresh) == sealer("sealNumber", u1.card()["public_key"], restored.card()["public_key"])
        assert u1.call("GET", f"/api/conversations/{cid}")[1]["peer"]["seal"] == "unverified"


def test_username_changes(app_url: str, sealer: Sealer) -> None:
    a, b = Person(app_url, sealer), Person(app_url, sealer)
    old, new1, new2 = a.username, fresh_name(), fresh_name()
    changed = a.call("PATCH", "/api/me/username", {"username": new1.upper()})
    assert changed.status_code == 200 and changed.json()["username"] == new1, err(changed)
    changed_at = ts(changed.json()["username_changed_at"])
    assert b.call("GET", f"/api/lookup?username={new1}").json()["id"] == a.id
    assert b.call("GET", f"/api/lookup?username={old}").status_code == 404
    assert httpx.get(f"{app_url}/api/usernames/{old}/availability", timeout=HTTP_TIMEOUT).json()["reason"] == "taken"
    claim = b.call("PATCH", "/api/me/username", {"username": old})
    assert claim.status_code == 409 and claim.json()["error"] == "username_taken", err(claim)
    same = b.call("PATCH", "/api/me/username", {"username": b.username})
    assert same.status_code == 422 and same.json()["fields"]["username"] == "same", err(same)
    invalid = b.call("PATCH", "/api/me/username", {"username": "ab."})
    assert invalid.status_code == 422 and invalid.json()["fields"]["username"] == "last_character"
    early = a.call("PATCH", "/api/me/username", {"username": new2})
    assert early.status_code == 409 and early.json()["error"] == "username_cooldown", err(early)
    assert abs((ts(early.json()["retry_at"]) - changed_at).total_seconds() * SECOND_MS - COOLDOWN_MS) < SECOND_MS
    with server_clock(app_url) as shift:
        shift(COOLDOWN_MS - MARGIN_MS)
        assert a.call("PATCH", "/api/me/username", {"username": new2}).json()["error"] == "username_cooldown"
        shift(COOLDOWN_MS + MARGIN_MS)
        back = a.call("PATCH", "/api/me/username", {"username": old})
        assert back.status_code == 409 and back.json()["error"] == "username_taken", "the former owner reclaimed a held name"
        assert a.call("PATCH", "/api/me/username", {"username": new2}).status_code == 200
        shift(NAME_HOLD_MS - MARGIN_MS)
        assert httpx.get(f"{app_url}/api/usernames/{old}/availability", timeout=HTTP_TIMEOUT).json()["reason"] == "taken"
        shift(NAME_HOLD_MS + MARGIN_MS)
        assert httpx.get(f"{app_url}/api/usernames/{old}/availability", timeout=HTTP_TIMEOUT).json()["available"] is True


def test_wf_username_change_journey(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        page.goto(f"{app_url}/settings")
        field = page.get_by_role("textbox", name="New username")
        poll(page, lambda: visible(field), "Settings")
        first = fresh_name()
        fill(field, first)
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "the Settings chip")
        click(page.get_by_role("button", name="Change username"))
        poll(page, lambda: f"Your username is now {first}." in status_text(page, "Letter updates"), "the change announced")
        assert u.call("GET", "/api/me")[1]["username"] == first
        second = fresh_name()
        fill(field, second)
        click(page.get_by_role("button", name="Change username"))
        status, body = u.call("PATCH", "/api/me/username", {"username": second})
        assert status == 409
        date = page.evaluate(DATE_JS, body["retry_at"])
        poll(page, lambda: visible(page.get_by_text(f"You can change your username again on {date}.", exact=True)), "the cooldown copy")
        with server_clock(app_url) as shift:
            shift(COOLDOWN_MS + MARGIN_MS)
            page.reload()
            poll(page, lambda: visible(field), "Settings after reload")
            fill(field, second)
            click(page.get_by_role("button", name="Change username"))
            poll(page, lambda: f"Your username is now {second}." in status_text(page, "Letter updates"), "the later change")
            assert u.call("GET", "/api/me")[1]["username"] == second


def test_wf_username_change_mistakes(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        page.goto(f"{app_url}/settings")
        field = page.get_by_role("textbox", name="New username")
        poll(page, lambda: visible(field), "Settings")
        for typed, key in (("halfpenny", "taken"), ("ab-c", "characters")):
            fill(field, typed)
            poll(page, lambda: chip(page).inner_text().strip() == CHIP[key], f"chip {CHIP[key]!r}")
        fill(field, u.username)
        click(page.get_by_role("button", name="Change username"))
        poll(page, lambda: visible(page.get_by_text(USERNAME_SAME, exact=True)), "the same-name slip")
        assert u.call("GET", "/api/me")[1]["username"] == u.username


def toasts(page: Page) -> Locator:
    return page.get_by_role("status", name="Notifications")


def expect_toast(page: Page, text: str) -> None:
    expect(toasts(page).get_by_text(text, exact=True).first).to_be_visible(timeout=EXPECT_MS)


def test_toasts_preview_mute(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    toast_ms = config(app_url)["timers"]["toast_ms"]
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Toast opener")
        now = ts(httpx.get(f"{app_url}/api/grading/clock", timeout=HTTP_TIMEOUT).json()["now"])
        for duration, ms in (("1h", HOUR_MS), ("8h", 8 * HOUR_MS), ("1w", 7 * DAY_MS)):
            muted = u.call("PUT", f"/api/conversations/{cid}/mute", {"duration": duration})[1]["muted_until"]
            assert abs((ts(muted) - now).total_seconds() * SECOND_MS - ms) < MARGIN_MS, duration
        assert u.call("PUT", f"/api/conversations/{cid}/mute", {"duration": "always"})[1]["muted_until"] == "always"
        assert u.call("PUT", f"/api/conversations/{cid}/mute", {"duration": "off"})[1]["muted_until"] is None
        assert u.call("PUT", f"/api/conversations/{cid}/mute", {"duration": "forever"})[0] == 422
        read_through(page, u, app_url, cid)
        long_line = "Ferry at nine " + "x" * TEXT_CUT
        for preview, text, expected in (
            ("name_and_letter", long_line + "\nsecond line", f"{p.username}: {long_line[:TEXT_CUT]}"),
            ("name_only", "Only my name", p.username),
            ("none", "Nothing shown", "New letter"),
        ):
            u.call("PATCH", "/api/me/settings", {"preview": preview})
            page.goto(f"{app_url}/letters")
            link = page.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^Contacts"))
            poll(page, lambda: visible(link), "Chats")
            link.focus()
            p.send(cid, u.card(), text)
            expect_toast(page, expected)
            assert focused(link), "a toast took focus"
            advance(page, toast_ms + STEP_MS)
        before = u.unread(cid)
        u.call("PUT", f"/api/conversations/{cid}/mute", {"duration": "always"})
        page.reload()
        poll(page, lambda: badge_text(page, cid) == str(before), "badge before the muted letter")
        p.send(cid, u.card(), "Muted letter")
        poll(page, lambda: badge_text(page, cid) == str(before + 1), "the muted conversation still counting")
        assert toasts(page).inner_text().strip() == "", "a muted conversation raised a toast"


def test_wf_notifications_journey(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    toast_ms = config(app_url)["timers"]["toast_ms"]
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Journey opener")
        read_through(page, u, app_url, cid)
        for count, (radio, value, expected) in enumerate(
                (("Name only", "name_only", p.username), ("No name or letter", "none", "New letter")), start=1):
            page.goto(f"{app_url}/settings")
            group = page.get_by_role("radiogroup", name="Notification preview")
            poll(page, lambda: visible(group), "the Notification preview choice")
            check(group.get_by_role("radio", name=radio))
            poll(page, lambda: u.call("GET", "/api/me")[1]["settings"]["preview"] == value, f"preview saved as {value}")
            click(page.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^Chats")))
            poll(page, lambda: chats_item(page, cid) is not None, "Chats")
            page.evaluate("() => { window.__afBefore = document.activeElement; }")
            p.send(cid, u.card(), f"Journey letter {count}")
            expect_toast(page, expected)
            assert page.evaluate("() => document.activeElement === window.__afBefore"), "a toast took focus"
            poll(page, lambda: badge_text(page, cid) == str(count) and tab_badge_shows(page, count), f"badges at {count}")
            advance(page, toast_ms + STEP_MS)


def test_wf_notifications_mute(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    toast_ms = config(app_url)["timers"]["toast_ms"]
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Mute opener")
        read_through(page, u, app_url, cid)
        card = page.get_by_role("region", name="Contact card")
        click(card.get_by_role("button", name="Mute", exact=True))
        dialog = page.get_by_role("dialog", name="Mute letters")
        poll(page, lambda: visible(dialog), "the Mute letters dialog")
        check(dialog.get_by_role("radio", name="Always"))
        click(dialog.get_by_role("button", name="Mute"))
        poll(page, lambda: u.call("GET", f"/api/conversations/{cid}")[1]["muted_until"] == "always", "muted always")
        poll(page, lambda: visible(card.get_by_role("button", name="Unmute")), "the Unmute button")
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None and "Muted" in chats_item(page, cid).inner_text(), "the Muted mark")
        p.send(cid, u.card(), "Quiet letter")
        poll(page, lambda: badge_text(page, cid) == "1" and tab_badge_shows(page, 1), "badges counting while muted")
        assert toasts(page).inner_text().strip() == ""
        advance(page, toast_ms + STEP_MS)
        open_conversation(page, app_url, cid)
        click(card.get_by_role("button", name="Unmute"))
        poll(page, lambda: u.call("GET", f"/api/conversations/{cid}")[1]["muted_until"] is None, "unmuted")
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None, "Chats")
        p.send(cid, u.card(), "Loud again")
        expect_toast(page, f"{p.username}: Loud again")


def test_health_and_config(app_url: str) -> None:
    health = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert "application/json" in health.headers.get("content-type", "")
    body = config(app_url)
    assert body["attachment_max_bytes"] == DEFAULT_CAP and body["timers"] == DEFAULT_TIMERS and body["grading"] is True


def test_server_boundary(app_url: str) -> None:
    origin = re.match(r"^https?://[^/]+", app_url).group(0)
    evil = httpx.post(f"{app_url}/api/conversations", json={"peer_id": new_id()}, timeout=HTTP_TIMEOUT,
                      headers={"Origin": "http://elsewhere.example"})
    assert evil.status_code == 403 and evil.json() == {"error": "cross_origin"}, err(evil)
    same = httpx.post(f"{app_url}/api/conversations", json={"peer_id": new_id()}, headers={"Origin": origin}, timeout=HTTP_TIMEOUT)
    assert same.status_code == 401
    probe = httpx.get(f"{app_url}/api/health", headers={"Origin": "http://elsewhere.example"}, timeout=HTTP_TIMEOUT)
    assert "elsewhere.example" not in " ".join(probe.headers.values())
    filler = JSON_LIMIT - len('{"username":""}')
    exact = '{"username":"' + "a" * filler + '"}'
    assert len(exact) == JSON_LIMIT
    at_limit = httpx.post(f"{app_url}/api/accounts", content=exact, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert at_limit.status_code != 413
    over = httpx.post(f"{app_url}/api/accounts", content=exact[:-2] + 'a"}', headers={"Content-Type": "application/json"},
                      timeout=HTTP_TIMEOUT)
    over = httpx.post(f"{app_url}/api/accounts", content='{"username":"' + "a" * (filler + 1) + '"}',
                      headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert over.status_code == 413 and over.json() == {"error": "too_large"}, err(over)
    plain = httpx.post(f"{app_url}/api/accounts", content="username=x", headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT)
    assert plain.status_code == 415 and plain.json() == {"error": "unsupported_media_type"}, err(plain)
    candidates = ["run.json", "package.json", "package-lock.json", "tsconfig.json", ".env", ".npmrc"]
    sources = sorted(p for p in DEPLOYED_APP.rglob("*.ts") if "node_modules" not in p.parts)
    candidates += [str(sources[0].relative_to(DEPLOYED_APP))] if sources else []
    for rel in candidates:
        if (DEPLOYED_APP / rel).exists():
            got = httpx.get(f"{app_url}/{rel}", timeout=HTTP_TIMEOUT)
            assert got.status_code == 404, f"/{rel} answered {got.status_code}"
    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if os.environ.get(k)]
    index = httpx.get(app_url, timeout=HTTP_TIMEOUT).text
    bodies = [index, httpx.get(f"{app_url}/api/config", timeout=HTTP_TIMEOUT).text]
    for path in set(re.findall(r'(?:src|href)="(/[^"]+)"', index)):
        bodies.append(httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).text)
    assert not [s for s in secrets for b in bodies if s in b], "a credential is served to the browser"
    down = httpx.get(f"{MINIO_DOWN_URL}/api/health", timeout=HTTP_TIMEOUT)
    assert down.status_code == 200, "the app did not start with object storage unreachable"


def test_keyboard_and_focus(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Keyboard dialogs")
        open_conversation(page, app_url, cid)
        for loc in (composer(page), page.get_by_role("button", name="Send")):
            loc.evaluate("e => e.blur()")
            rest, focus = state_styles(loc, "outline-style", "outline-width", "box-shadow", state="focus")
            assert rest != focus, "no visible focus mark"
        text = f"Button send {tag()}"
        fill(composer(page), text)
        click(page.get_by_role("button", name="Send"))
        poll(page, lambda: letter(page, text).count() == 1, "the letter sent by button")
        expect(composer(page)).to_be_focused()
        expect(composer(page)).to_have_value("")
        received = letter(page, "Keyboard dialogs").first
        card = page.get_by_role("region", name="Contact card")
        assert_dialog_traps(page, received.get_by_role("button", name="Letter actions"),
                            page.get_by_role("dialog", name="Letter actions"), "Letter actions")
        assert_dialog_traps(page, card.get_by_role("button", name="Show seal number"),
                            page.get_by_role("dialog", name="Seal number"), "Seal number")
        assert_dialog_traps(page, card.get_by_role("button", name="Mute", exact=True),
                            page.get_by_role("dialog", name="Mute letters"), "Mute letters")


def motion_send(page: Page, text: str) -> list[dict]:
    page.evaluate(MOTION_JS)
    send_letter(page, text)
    run_in_step(page, lambda: delivery(page, text) in POSTED_STATES and page.evaluate(RUNNING_JS) == 0
                and page.evaluate("() => { const s = window.__afMotion.s; const n = performance.now() - s.p0; return n > 1400 && n - s.last > 300; }"),
                "the send sequence settling")
    return page.evaluate(RECORDS_JS)


def test_fold_and_postmark(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p, other = Person(app_url, sealer), Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Motion opener")
        newer = person_to_ui(other, u, "Newer conversation")
        read_through(page, u, app_url, cid)
        assert newer
        text = f"Folded {tag()}"
        recs = motion_send(page, text)
        finite = [r for r in recs if not r["infinite"] and r["end"] >= 0]
        sampled = page.evaluate("() => ({ last: window.__afMotion.s.last, turned: window.__afMotion.s.turned })")
        assert finite or sampled["last"] > 0, "no motion ran on Send"
        end = max([r["at"] + r["end"] for r in finite] + [sampled["last"]])
        assert SEND_END_MIN_MS <= end <= SEND_END_MAX_MS + JITTER_MS, f"send sequence ended at {end:.0f} ms"
        assert sampled["turned"] or any(re.search("rotate|matrix3d", r["frames"], re.I) for r in recs), "the letter never turned over"
        strikes = [r for r in finite if r["postmark"]]
        assert all(r["end"] <= POSTMARK_MAX_MS for r in strikes)
        angles = letter(page, text).first.evaluate(TILT_JS)
        assert any(abs(a - STRIKE_TILT_DEG) <= TILT_TOLERANCE_DEG for a in angles), f"postmark angles {angles}"
        rows = page.get_by_role("list", name="Conversations").get_by_role("link")
        assert rows.first.get_attribute("data-conversation-id") == cid, "the row did not move to the top"
        page.evaluate(MOTION_JS)
        collect_until(p, has_text(text), "the folded letter")
        run_in_step(page, lambda: delivery(page, text) == "delivered" and page.evaluate(RUNNING_JS) == 0, "the re-strike settling")
        restrikes = [r for r in page.evaluate(RECORDS_JS) if r["postmark"] and not r["infinite"]]
        moved_on_clock = page.evaluate("() => window.__afMotion.s.last") > 0
        assert (restrikes or moved_on_clock) and all(r["end"] <= POSTMARK_MAX_MS for r in restrikes), "no postmark re-strike on Delivered"
        page.reload()
        poll(page, lambda: letter(page, text).count() == 1, "the conversation after reload")
        moving = page.get_by_role("list", name="Letters").evaluate(
            "el => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && el.contains(a.effect.target)).length")
        assert moving == 0, "letters moved after reload"
        assert page.evaluate(INFINITE_JS) == 0, "something loops"


def test_reduced_motion_and_touch(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(PHONE)
        page.goto(app_url)
        poll(page, lambda: visible(page.get_by_role("link", name="Choose a username")), "the landing page")
        assert not small_targets(page), small_targets(page)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Reduced opener")
        read_through(page, u, app_url, cid)
        assert not small_targets(page), small_targets(page)
        text = f"Reduced {tag()}"
        recs = motion_send(page, text)
        page.evaluate(MOTION_JS)
        collect_until(p, has_text(text), "the reduced-motion letter")
        run_in_step(page, lambda: delivery(page, text) == "delivered" and page.evaluate(RUNNING_JS) == 0, "the instant re-strike")
        recs += page.evaluate(RECORDS_JS)
        reduced_only(recs)
        assert page.evaluate(INFINITE_JS) == 0
        for path in ("/letters", "/contacts", "/settings"):
            page.goto(f"{app_url}{path}")
            poll(page, lambda: visible(page.get_by_role("navigation", name="Main")), path)
            assert not small_targets(page), f"{path}: {small_targets(page)}"


SAID_JS = """() => {
  window.__afSaid = window.__afSaid || [];
  const keep = () => document.querySelectorAll('[role="status"]').forEach(n => {
    const s = (n.textContent || '').trim();
    if (s && !window.__afSaid.includes(s)) window.__afSaid.push(s);
  });
  new MutationObserver(keep).observe(document.body, {subtree: true, childList: true, characterData: true});
  keep();
}"""


def said(page: Page, text: str) -> bool:
    return any(text in s for s in page.evaluate("() => window.__afSaid || []"))


def stays(page: Page, ok: Callable[[], bool], expected: str, seconds: float = 3) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert ok(), f"expected {expected} to hold"
        advance(page, STEP_MS)


def reduced_only(recs: list[dict]) -> None:
    for r in recs:
        assert not r["infinite"], "an animation loops under reduced motion"
        assert not re.search("rotate|scale|translate|matrix|skew", r["frames"], re.I), f"motion under reduce: {r['frames'][:120]}"
        if re.search("opacity", r["frames"], re.I) or not r["frames"]:
            assert 0 <= r["end"] <= REDUCED_FADE_MAX_MS, f"a {r['end']} ms fade under reduced motion"


def tab_bar_at_bottom(page: Page) -> None:
    nav = page.get_by_role("navigation", name="Main")
    poll(page, lambda: visible(nav), "the Main tab bar")
    box = nav.first.bounding_box()
    height = page.viewport_size["height"]
    assert box and box["y"] > height / 2 and box["y"] + box["height"] <= height + 1, f"the tab bar is not at the bottom: {box}"


def open_request(page: Page, base: str, cid: str) -> Locator:
    page.goto(f"{base}/requests")
    poll(page, lambda: request_row(page, cid) is not None, "the request row")
    row = request_row(page, cid)
    link = row.get_by_role("link")
    click(link.first if link.count() else row)
    region = page.get_by_role("region", name="Letter request")
    poll(page, lambda: visible(region), "the open request")
    return region


def lookup(page: Page, name: str) -> Locator:
    box = page.get_by_role("textbox", name="Find by username")
    poll(page, lambda: visible(box), "the Find by username textbox")
    fill(box, name)
    box.press("Enter")
    return page.get_by_role("region", name="Lookup result")


def test_wf_signup_touch_phone(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        page.goto(app_url)
        start = page.get_by_role("link", name="Choose a username")
        poll(page, lambda: visible(start), "the landing page")
        tap(start)
        poll(page, lambda: "/signup" in page.url, "Choose a username going to /signup")
        page.goto(f"{app_url}/signup?skip_recovery_check=1")
        field = page.get_by_role("textbox", name="Username")
        poll(page, lambda: visible(field), "sign-up step 1")
        tap(field)
        name = fresh_name()
        page.keyboard.type(name)
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "the chip reading Available")
        assert not small_targets(page), small_targets(page)
        layout(page)
        tap(page.get_by_role("button", name="Continue"))
        code_box = page.get_by_role("group", name="Your recovery code")
        poll(page, lambda: visible(code_box) and recovery_text(code_box) != "", "step 2 with the recovery code")
        assert not small_targets(page), small_targets(page)
        layout(page)
        tap(page.get_by_role("button", name="I've written it down"))
        display = page.get_by_role("textbox", name="Display name")
        poll(page, lambda: visible(display), "step 4")
        assert not small_targets(page), small_targets(page)
        tap(display)
        page.keyboard.type(name)
        tap(page.get_by_role("button", name="Finish"))
        poll(page, lambda: visible(page.get_by_text(CHATS_EMPTY, exact=True)), "Chats with the empty copy")
        tab_bar_at_bottom(page)
        assert not small_targets(page), small_targets(page)
        layout(page)


def test_wf_signup_chip_debounce(browser: Browser, app_url: str) -> None:
    debounce = config(app_url)["timers"]["availability_debounce_ms"]
    gap = max(1, debounce // 3)
    with app_page(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(PHONE)
        checks: list[str] = []
        page.on("request", lambda req: checks.append(req.url) if "/availability" in req.url else None)
        page.goto(f"{app_url}/signup?skip_recovery_check=1")
        field = page.get_by_role("textbox", name="Username")
        poll(page, lambda: visible(field), "sign-up step 1")
        field.focus()
        page.evaluate(MOTION_JS)
        name = fresh_name()
        for ch in name:
            page.keyboard.type(ch)
            advance(page, gap)
        advance(page, max(0, debounce - gap - JITTER_MS))
        assert chip(page).inner_text().strip() != CHIP["available"], "the chip answered before the debounce ended"
        assert checks == [], f"availability asked before the debounce ended: {checks}"
        advance(page, gap + JITTER_MS)
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "the chip reading Available")
        assert len(checks) == 1 and name in checks[0], f"availability requests: {checks}"
        reduced_only(page.evaluate(RECORDS_JS))


def test_wf_signup_photo_keyboard(browser: Browser, app_url: str, sealer: Sealer) -> None:
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        page.goto(f"{app_url}/signup?skip_recovery_check=1")
        field = page.get_by_role("textbox", name="Username")
        poll(page, lambda: visible(field), "sign-up step 1")
        field.focus()
        page.keyboard.type(fresh_name())
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "the chip reading Available")
        page.keyboard.press("Enter")
        written = page.get_by_role("button", name="I've written it down")
        poll(page, lambda: visible(written), "step 2")
        tab_to(page, written, "I've written it down")
        page.keyboard.press("Enter")
        display = page.get_by_role("textbox", name="Display name")
        poll(page, lambda: focused(display), "focus on Display name in step 4")
        page.keyboard.type(f"Wren Okafor {tag()}")
        add = page.get_by_role("button", name="Add a photo")
        tab_to(page, add, "Add a photo")
        with page.expect_file_chooser() as chooser:
            page.keyboard.press("Enter")
        chooser.value.set_files(files=[file_payload("tiny.png", "image/png", tiny_png(sealer))])
        finish = page.get_by_role("button", name="Finish")
        tab_to(page, finish, "Finish")
        page.keyboard.press("Enter")
        poll(page, lambda: visible(page.get_by_text(CHATS_EMPTY, exact=True)), "Chats with the empty copy")
        me = page.request.get(f"{app_url}/api/me").json()
        blob = (me["profile"] or {}).get("photo_blob_id")
        assert blob, "the sealed profile carries no photo"
        assert S3().keys(f"blobs/{me['id']}/{blob}"), "the profile photo never reached object storage"
        tab_bar_at_bottom(page)


def test_wf_lookup_phone_touch(browser: Browser, app_url: str, sealer: Sealer) -> None:
    target = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        ui_signup(page, app_url)
        page.goto(f"{app_url}/contacts")
        box = page.get_by_role("textbox", name="Find by username")
        poll(page, lambda: visible(box), "Contacts")
        tap(box)
        page.keyboard.type(target.username.upper())
        page.keyboard.press("Enter")
        result = page.get_by_role("region", name="Lookup result")
        poll(page, lambda: target.username in result.inner_text()
             and f"Found {target.username}." in status_text(page, "Lookup status"), "the found card and its announcement")
        tap(result.get_by_role("button", name="Write a letter"))
        poll(page, lambda: re.search(r"/letters/[0-9a-f-]{36}$", page.url) is not None and focused(composer(page)),
             "the new conversation with focus in the composer")
        assert visible(page.get_by_role("button", name="Back to letters")), "no Back to letters under 768 px"
        assert not in_view(page.get_by_role("list", name="Conversations")), "the list shows beside the sheet on a phone"
        layout(page)


def test_wf_lookup_self_and_released(browser: Browser, app_url: str, sealer: Sealer) -> None:
    other = Person(app_url, sealer)
    released = other.username
    changed = other.call("PATCH", "/api/me/username", {"username": fresh_name()})
    assert changed.status_code == 200, err(changed)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        page.goto(f"{app_url}/contacts")
        for name in (u.username, released):
            result = lookup(page, name)
            poll(page, lambda: LOOKUP_MISS in result.inner_text() and focused(result), f"the not-found copy for {name}")
            assert LOOKUP_MISS in status_text(page, "Lookup status")
            assert result.get_by_role("button", name="Write a letter").count() == 0


def test_wf_lookup_existing_conversation(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        opener = f"Already writing {tag()}"
        cid = person_to_ui(p, u, opener)
        page.goto(f"{app_url}/contacts")
        result = lookup(page, p.username)
        poll(page, lambda: p.username in result.inner_text() and focused(result), "the result card with focus")
        write = result.get_by_role("button", name="Write a letter")
        tab_to(page, write, "Write a letter")
        page.keyboard.press("Enter")
        poll(page, lambda: page.url.endswith(f"/letters/{cid}") and focused(composer(page)), "the existing conversation")
        poll(page, lambda: letter(page, opener).count() == 1, "the earlier letter in it")


def test_wf_requests_no_receipt_live(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1 = ui_signup(p1, app_url, display_name=f"Ines Varga {tag()}")
        u2 = ui_signup(p2, app_url)
        status, conv = u1.call("POST", "/api/conversations", {"peer_id": u2.id})
        assert status in (200, 201)
        cid = conv["id"]
        open_conversation(p1, app_url, cid)
        first = f"Request letter {tag()}"
        send_letter(p1, first)
        region = open_request(p2, app_url, cid)
        poll(p2, lambda: letter(p2, first).count() == 1, "the request's letter")
        for name in ("Accept", "Delete", "Block"):
            assert visible(region.get_by_role("button", name=name, exact=True)), f"no {name} on the request"
        assert composer(p2).count() == 0, "a request offers a composer"
        expect(p2.get_by_role("heading", level=2, name=u1.username)).to_be_visible(timeout=EXPECT_MS)
        assert u1.display_name not in p2.evaluate("() => document.body.innerText"), "the request shows the sender's display name"
        wait_delivery(p1, first, ("delivered",))
        stays(p1, lambda: delivery(p1, first) == "delivered", "the opened request sending no read receipt")
        click(region.get_by_role("button", name="Accept", exact=True))
        poll(p2, lambda: u2.call("GET", f"/api/conversations/{cid}")[1]["status"] == "accepted", "the request accepted")
        open_conversation(p2, app_url, cid)
        second = f"After accepting {tag()}"
        send_letter(p1, second)
        wait_delivery(p1, second, ("read",))
        assert delivery(p1, first) == "delivered", "a read recorded while a request became Read"


def test_wf_requests_count_phone(browser: Browser, app_url: str, sealer: Sealer) -> None:
    senders = [Person(app_url, sealer), Person(app_url, sealer)]
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        u = ui_signup(page, app_url)
        cids = []
        for s in senders:
            cid = s.converse(u.id)["id"]
            assert s.send(cid, u.card(), f"Hello from {s.username}").status_code == 201
            cids.append(cid)
        for left, cid in ((2, cids[0]), (1, cids[1])):
            page.goto(f"{app_url}/letters")
            link = page.get_by_role("link", name=f"Letter requests ({left})")
            poll(page, lambda: visible(link), f"Letter requests ({left}) on Chats")
            tap(link)
            poll(page, lambda: request_row(page, cid) is not None, "the request row")
            row = request_row(page, cid)
            inner = row.get_by_role("link")
            tap(inner.first if inner.count() else row)
            region = page.get_by_role("region", name="Letter request")
            poll(page, lambda: visible(region), "the open request")
            tap(region.get_by_role("button", name="Delete", exact=True))
            poll(page, lambda: len(u.call("GET", "/api/conversations?status=request")[1]["conversations"]) == left - 1,
                 "the request deleted")
        page.goto(f"{app_url}/requests")
        poll(page, lambda: visible(page.get_by_text(REQUESTS_EMPTY, exact=True)), "the empty Requests copy")
        page.goto(f"{app_url}/letters")
        poll(page, lambda: visible(page.get_by_text(CHATS_EMPTY, exact=True)), "Chats")
        assert page.get_by_role("link", name=re.compile(r"^Letter requests")).count() == 0


def test_wf_requests_profiles_both_ways(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1 = ui_signup(p1, app_url, display_name=f"Ines Varga {tag()}")
        u2 = ui_signup(p2, app_url, display_name=f"Oskar Lind {tag()}")
        status, conv = u1.call("POST", "/api/conversations", {"peer_id": u2.id})
        assert status in (200, 201)
        cid = conv["id"]
        open_conversation(p1, app_url, cid)
        text = f"Both ways {tag()}"
        send_letter(p1, text)
        wait_delivery(p1, text, POSTED_STATES)
        region = open_request(p2, app_url, cid)
        accept = region.get_by_role("button", name="Accept", exact=True)
        accept.focus()
        p2.keyboard.press("Enter")
        poll(p2, lambda: u2.call("GET", f"/api/conversations/{cid}")[1]["status"] == "accepted", "the request accepted")
        open_conversation(p2, app_url, cid)
        poll(p1, lambda: visible(p1.get_by_role("heading", level=2, name=u2.display_name)), "the recipient's name for the sender")
        poll(p2, lambda: visible(p2.get_by_role("heading", level=2, name=u1.display_name)), "the sender's name for the recipient")
        for p, other in ((p1, u2), (p2, u1)):
            p.goto(f"{app_url}/letters")
            named = re.compile("^" + re.escape(other.display_name))
            poll(p, lambda: chats_item(p, cid) is not None and chats_item(p, cid).get_by_role("link", name=named).count() == 1,
                 f"the row named {other.display_name} after reload")


def test_wf_live_letters_shift_enter(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Lines opener")
        open_conversation(page, app_url, cid)
        box = composer(page)
        box.focus()
        first, second = f"Line one {tag()}", f"Line two {tag()}"
        page.keyboard.type(first)
        page.keyboard.press("Shift+Enter")
        page.keyboard.type(second)
        assert box.input_value() == f"{first}\n{second}"
        page.keyboard.press("Enter")
        poll(page, lambda: letter(page, first).count() == 1 and delivery(page, first) in POSTED_STATES, "the two-line letter")
        assert second in letter(page, first).first.inner_text()
        collect_until(p, has_text(f"{first}\n{second}"), "the two lines in one letter")
        count = letters(page).count()
        expect(box).to_be_focused()
        page.keyboard.press("Enter")
        stays(page, lambda: letters(page).count() == count, "Enter on an empty composer sending nothing", 2)
        box.fill("x" * 8001)
        send = page.get_by_role("button", name="Send")
        poll(page, lambda: visible(page.get_by_text("Letters can be up to 8,000 characters.", exact=True)) and send.is_disabled(),
             "the too-long slip with Send disabled")
        box.press("Enter")
        stays(page, lambda: letters(page).count() == count, "an over-long letter staying unsent", 2)
        box.fill("y" * 8000)
        poll(page, lambda: send.is_enabled(), "Send enabled at exactly 8,000 characters")


def test_wf_live_letters_receipts_off(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Receipts opener {tag()}")

        def receipts(on: bool) -> None:
            p2.goto(f"{app_url}/settings")
            switch = p2.get_by_role("switch", name="Read receipts")
            poll(p2, lambda: visible(switch), "the Read receipts switch")
            if switch.is_checked() != on:
                switch.focus()
                p2.keyboard.press("Space")
            poll(p2, lambda: u2.call("GET", "/api/me")[1]["settings"]["read_receipts"] is on, f"read receipts saved {on}")
            open_conversation(p2, app_url, cid)

        receipts(False)
        quiet = f"Quiet letter {tag()}"
        send_letter(p1, quiet)
        poll(p2, lambda: letter(p2, quiet).count() == 1, "the letter open for the recipient")
        wait_delivery(p1, quiet, ("delivered",))
        stays(p1, lambda: delivery(p1, quiet) == "delivered", "the letter staying Delivered with receipts off")
        receipts(True)
        loud = f"Loud letter {tag()}"
        send_letter(p1, loud)
        wait_delivery(p1, loud, ("read",))
        assert delivery(p1, quiet) == "delivered"


def test_wf_sender_offline_phone_touch(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Touch offline opener")
        open_conversation(page, app_url, cid)
        page.context.set_offline(True)
        texts = [f"Tapped offline {i} {tag()}" for i in range(3)]
        for t in texts:
            tap(composer(page))
            composer(page).fill(t)
            tap(page.get_by_role("button", name="Send"))
        for t in texts:
            poll(page, lambda: delivery(page, t) == "sending", f"{t} Sending")
            assert label(letter(page, t)) == "Sending" and letter(page, t).first.get_by_role("time").count() == 0
        page.context.set_offline(False)
        poll(page, lambda: all(delivery(page, t) in POSTED_STATES for t in texts), "all three posted")
        for t in texts:
            mine = letter(page, t)
            assert label(mine) in ("Sent", "Delivered", "Read")
            stamp = mine.first.get_by_role("time").first.get_attribute("datetime")
            lid = mine.first.get_attribute("data-letter-id")
            assert ts(stamp) == ts(u.call("GET", f"/api/letters/{lid}")[1]["held_at"])


def test_wf_sender_offline_row_and_announcement(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(TABLET)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Row opener")
        open_conversation(page, app_url, cid)
        page.context.set_offline(True)
        text = f"Row offline {tag()}"
        send_letter(page, text)
        poll(page, lambda: delivery(page, text) == "sending", "the Sending postmark")

        def row() -> str:
            item = chats_item(page, cid)
            return item.inner_text() if item is not None else ""

        poll(page, lambda: text in row() and "Sending" in row(), "the row showing the Sending letter")
        page.context.set_offline(False)
        poll(page, lambda: f"Sent. Held for {p.username} until they collect it." in status_text(page, "Letter updates"),
             "the Sent announcement after reconnect")
        collect_until(p, has_text(text), "the reconnected letter")
        poll(page, lambda: delivery(page, text) == "delivered" and "Delivered" in row(), "the row at Delivered")


def test_wf_sender_offline_reduced_motion(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Reduced offline opener")
        read_through(page, u, app_url, cid)
        page.evaluate(MOTION_JS)
        page.context.set_offline(True)
        texts = [f"Reduced offline {i} {tag()}" for i in range(2)]
        for t in texts:
            send_letter(page, t)
        for t in texts:
            poll(page, lambda: delivery(page, t) == "sending", f"{t} Sending")
        page.context.set_offline(False)
        for t in texts:
            collect_until(p, has_text(t), t)
        run_in_step(page, lambda: all(delivery(page, t) == "delivered" for t in texts) and page.evaluate(RUNNING_JS) == 0,
                    "both letters at Delivered with nothing moving")
        reduced_only(page.evaluate(RECORDS_JS))
        assert page.evaluate(INFINITE_JS) == 0


def test_wf_recipient_offline_sender_sees_delivered(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Away opener {tag()}")
        p2.goto(f"{app_url}/letters")
        poll(p2, lambda: chats_item(p2, cid) is not None, "the recipient on Chats")
        p2.context.set_offline(True)
        texts = [f"While you were away {i} {tag()}" for i in range(2)]
        for t in texts:
            send_letter(p1, t)
        for t in texts:
            wait_delivery(p1, t, ("sent",))
        stays(p1, lambda: all(delivery(p1, t) == "sent" for t in texts), "both letters held at Sent", 2)
        p2.context.set_offline(False)
        poll(p1, lambda: all(delivery(p1, t) == "delivered" for t in texts), "both re-striking to Delivered live")
        poll(p1, lambda: re.search(rf"Delivered to {re.escape(u2.username)} at {TIME_PATTERN}\.", status_text(p1, "Letter updates")),
             "the Delivered announcement")
        open_conversation(p1, app_url, cid)
        poll(p1, lambda: all(delivery(p1, t) == "delivered" for t in texts), "Delivered after reload")


def test_wf_recipient_offline_one_letter(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Single opener")
        read_through(page, u, app_url, cid)
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None, "Chats")
        page.context.set_offline(True)
        assert p.send(cid, u.card(), f"Just one {tag()}").status_code == 201
        page.context.set_offline(False)
        bar = page.get_by_role("status", name="Connection")
        expect(bar).to_contain_text("Updating... 1 letter", timeout=EXPECT_MS)
        assert "Updating... 1 letters" not in bar.inner_text()
        advance(page, SECOND_MS - 2 * STEP_MS)
        assert "Updating... 1 letter" in bar.inner_text(), "the Updating bar left before one second"
        poll(page, lambda: badge_text(page, cid) == "1" and tab_badge_shows(page, 1) and page.title() == "(1) Airfold",
             "badges and title at 1")


def test_wf_recipient_offline_phone_tap(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Phone collect opener")
        read_through(page, u, app_url, cid)
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None, "Chats")
        page.context.set_offline(True)
        texts = [f"Phone held {i} {tag()}" for i in range(3)]
        for t in texts:
            assert p.send(cid, u.card(), t).status_code == 201
        page.context.set_offline(False)
        poll(page, lambda: badge_text(page, cid) == "3" and tab_badge_shows(page, 3) and page.title() == "(3) Airfold",
             "the held count on the row, the tab and the title")
        tap(chats_item(page, cid).get_by_role("link").first)
        poll(page, lambda: all(letter(page, t).count() == 1 for t in texts), "the letters in the open conversation")
        shown = letters(page).all_inner_texts()
        positions = [next(i for i, s in enumerate(shown) if t in s) for t in texts]
        assert positions == sorted(positions), "the held letters opened out of order"
        poll(page, lambda: u.unread(cid) == 0 and tab_badge(page) == 0 and page.title() == "Airfold", "badges cleared")
        tap(page.get_by_role("button", name="Back to letters"))
        poll(page, lambda: chats_item(page, cid) is not None and badge_text(page, cid) == "", "the row with no disc")


def test_wf_image_letters_viewer_touch(browser: Browser, app_url: str, sealer: Sealer) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(PHONE)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Photo opener {tag()}")
        open_conversation(p2, app_url, cid)
        caption = f"Harbour at dusk {tag()}"
        choose(p1, "Attach photo", file_payload("tiny.png", "image/png", tiny_png(sealer)), touch=True)
        tap(composer(p1))
        composer(p1).fill(caption)
        tap(p1.get_by_role("button", name="Send"))
        poll(p1, lambda: delivery(p1, caption) in POSTED_STATES, "the photo letter posted")
        poll(p1, lambda: visible(p1.get_by_role("img", name="Your photo")), "Your photo for the sender")
        poll(p2, lambda: letter(p2, caption).count() == 1
             and visible(letter(p2, caption).get_by_role("img", name=f"Photo from {u1.display_name}")), "the photo for the recipient")
        opener = letter(p2, caption).get_by_role("button", name="Open photo")
        tap(opener)
        viewer = p2.get_by_role("dialog", name="Photo viewer")
        poll(p2, lambda: visible(viewer), "the Photo viewer")
        tap(viewer.get_by_role("button", name="Close photo"))
        poll(p2, lambda: not visible(viewer) and focused(opener), "focus back on Open photo")


def test_wf_image_letters_wrong_type(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Wrong type opener")
        open_conversation(page, app_url, cid)
        blobs: list[str] = []
        page.on("request", lambda req: blobs.append(req.url) if "/api/blobs" in req.url else None)
        count = letters(page).count()
        attach = page.get_by_role("button", name="Attach photo")
        tab_to(page, attach, "Attach photo")
        with page.expect_file_chooser() as chooser:
            page.keyboard.press("Enter")
        chooser.value.set_files(files=[file_payload("ferry-timetable.pdf", "application/pdf", ferry_pdf())])
        poll(page, lambda: visible(page.get_by_text(WRONG_PHOTO, exact=True)), "the wrong-type slip")
        stays(page, lambda: blobs == [] and letters(page).count() == count, "no upload and no letter", 2)
        tab_to(page, attach, "Attach photo again")
        with page.expect_file_chooser() as chooser:
            page.keyboard.press("Enter")
        chooser.value.set_files(files=[file_payload("tiny.png", "image/png", tiny_png(sealer))])
        send = page.get_by_role("button", name="Send")
        tab_to(page, send, "Send")
        page.keyboard.press("Enter")
        poll(page, lambda: visible(page.get_by_role("img", name="Your photo")), "the photo letter")
        poll(page, lambda: letters(page).count() == count + 1
             and letters(page).last.get_attribute("data-delivery") in POSTED_STATES, "the photo letter posted")


def test_wf_file_letters_row_and_announce(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(TABLET)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"File opener {tag()}")
        open_conversation(p2, app_url, cid)
        attach = p1.get_by_role("button", name="Attach file")
        tab_to(p1, attach, "Attach file")
        with p1.expect_file_chooser() as chooser:
            p1.keyboard.press("Enter")
        chooser.value.set_files(files=[file_payload("ferry-timetable.pdf", "application/pdf", ferry_pdf())])
        send = p1.get_by_role("button", name="Send")
        tab_to(p1, send, "Send")
        p1.evaluate(SAID_JS)
        p1.keyboard.press("Enter")
        poll(p1, lambda: said(p1, UPLOAD_DONE), "the Upload finished announcement")
        poll(p2, lambda: visible(p2.get_by_role("button", name="Download ferry-timetable.pdf")), "the recipient's download")
        for p in (p1, p2):
            poll(p, lambda: chats_item(p, cid) is not None and re.search(r"\bFile\b", chats_item(p, cid).inner_text()) is not None,
                 "File as the row's last letter")


def test_wf_deleting_undo_window(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    undo_ms = config(app_url)["timers"]["undo_ms"]
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Undo window opener")
        open_conversation(page, app_url, cid)
        text = f"Keep or lose {tag()}"
        send_letter(page, text)
        wait_delivery(page, text, POSTED_STATES)
        lid = letter(page, text).first.get_attribute("data-letter-id")

        def delete_for_me() -> None:
            actions = letter(page, text).first.get_by_role("button", name="Letter actions")
            actions.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Letter actions")
            poll(page, lambda: visible(dialog), "Letter actions")
            mine = dialog.get_by_role("button", name="Delete for me")
            tab_to(page, mine, "Delete for me")
            page.keyboard.press("Enter")
            poll(page, lambda: letter(page, text).count() == 0 and visible(page.get_by_role("button", name="Undo"))
                 and SNACKBAR_COPY in status_text(page, "Letter updates"), "the letter hidden with the snackbar")

        delete_for_me()
        open_conversation(page, app_url, cid)
        poll(page, lambda: letter(page, text).count() == 1, "a reload inside the window keeping the letter")
        delete_for_me()
        advance(page, undo_ms + STEP_MS)
        poll(page, lambda: not visible(page.get_by_role("button", name="Undo")), "the snackbar leaving")
        open_conversation(page, app_url, cid)
        stays(page, lambda: letter(page, text).count() == 0, "the letter gone after reload", 2)
        stored = u.call("GET", f"/api/letters/{lid}")
        assert stored[0] == 200 and stored[1]["retracted_at"] is None, "Delete for me touched the exchange"


def test_wf_deleting_received_letter(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        text = f"Received letter {tag()}"
        cid = ui_to_ui(u1, u2, text)
        open_conversation(p2, app_url, cid)
        poll(p2, lambda: letter(p2, text).count() == 1, "the received letter")
        actions = letter(p2, text).first.get_by_role("button", name="Letter actions")
        actions.focus()
        p2.keyboard.press("Enter")
        dialog = p2.get_by_role("dialog", name="Letter actions")
        poll(p2, lambda: visible(dialog.get_by_role("button", name="Delete for me")), "Letter actions on a received letter")
        assert dialog.get_by_role("button", name="Delete for everyone").count() == 0
        cancel = dialog.get_by_role("button", name="Cancel")
        tab_to(p2, cancel, "Cancel")
        p2.keyboard.press("Enter")
        poll(p2, lambda: not visible(dialog) and focused(actions), "Cancel returning focus to Letter actions")
        lid = letter(p1, text).first.get_attribute("data-letter-id")
        click(letter(p1, text).first.get_by_role("button", name="Letter actions"))
        everyone = p1.get_by_role("dialog", name="Letter actions").get_by_role("button", name="Delete for everyone")
        poll(p1, lambda: visible(everyone), "Delete for everyone on your own letter")
        click(everyone)
        for p, notice in ((p1, DELETED_SENDER), (p2, DELETED_RECIPIENT)):
            poll(p, lambda: letter_by_id(p, lid) is not None and notice in letter_by_id(p, lid).inner_text(), notice)
            open_conversation(p, app_url, cid)
            poll(p, lambda: letter_by_id(p, lid) is not None and notice in letter_by_id(p, lid).inner_text(), f"{notice} after reload")
            assert letter(p, text).count() == 0


def test_wf_deleting_phone_touch(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(PHONE)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        a_text, b_text = f"Phone keep {tag()}", f"Phone retract {tag()}"
        cid = ui_to_ui(u1, u2, a_text)
        send_letter(p1, b_text)
        wait_delivery(p1, b_text, POSTED_STATES)
        open_conversation(p2, app_url, cid)
        poll(p2, lambda: letter(p2, b_text).count() == 1, "both letters on the other phone")
        dialog = p1.get_by_role("dialog", name="Letter actions")
        touch_press(p1, letter(p1, a_text), LONG_PRESS_MS + STEP_MS)
        poll(p1, lambda: visible(dialog), "a half-second press opening Letter actions")
        tap(dialog.get_by_role("button", name="Delete for me"))
        undo = p1.get_by_role("button", name="Undo")
        poll(p1, lambda: visible(undo) and letter(p1, a_text).count() == 0, "the snackbar with Undo")
        tap(undo)
        poll(p1, lambda: letter(p1, a_text).count() == 1 and RESTORED_COPY in status_text(p1, "Letter updates"), "Undo restoring")
        b_id = letter(p1, b_text).first.get_attribute("data-letter-id")
        touch_press(p1, letter(p1, b_text), LONG_PRESS_MS + STEP_MS)
        everyone = dialog.get_by_role("button", name="Delete for everyone")
        poll(p1, lambda: visible(everyone), "Delete for everyone offered")
        tap(everyone)
        poll(p2, lambda: letter_by_id(p2, b_id) is not None and DELETED_RECIPIENT in letter_by_id(p2, b_id).inner_text(),
             "the other phone changing live")


def test_wf_blocking_phone_card(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(PHONE)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Phone block opener {tag()}")
        open_conversation(p2, app_url, cid)
        tap(p1.get_by_role("button", name="Contact card"))
        card = p1.get_by_role("dialog", name="Contact card")
        poll(p1, lambda: visible(card), "the Contact card dialog")
        tap(card.get_by_role("button", name="Block", exact=True))
        confirm = p1.get_by_role("dialog", name=f"Block {u2.display_name}?")
        poll(p1, lambda: visible(confirm), "the Block dialog")
        tap(confirm.get_by_role("button", name="Block", exact=True))
        blocked = p1.get_by_text(f"You blocked {u2.display_name}.", exact=True)
        poll(p1, lambda: u1.call("GET", "/api/blocks")[1]["blocks"] != [], "the block stored")
        open_conversation(p1, app_url, cid)
        poll(p1, lambda: visible(blocked), "the blocked copy")
        during = f"Phone while held back {tag()}"
        send_letter(p2, during)
        wait_delivery(p2, during, ("sent",))
        open_conversation(p1, app_url, cid)
        poll(p1, lambda: visible(blocked), "the blocked copy after reload")
        stays(p2, lambda: delivery(p2, during) == "sent" and visible(composer(p2)), "the blocked sender seeing Sent and a composer")
        assert "You blocked" not in p2.evaluate("() => document.body.innerText"), "the blocked person got a signal"
        assert letter(p1, during).count() == 0


def test_wf_blocking_conversation_unblock(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(TABLET)
        u1, u2 = ui_signup(p1, app_url), ui_signup(p2, app_url)
        cid = ui_to_ui(u1, u2, f"Unblock opener {tag()}")
        status, _ = u1.call("PUT", f"/api/blocks/{u2.id}", {})
        assert status == 200
        p1.goto(f"{app_url}/letters")
        poll(p1, lambda: chats_item(p1, cid) is not None, "the blocked conversation still on Chats")
        open_conversation(p1, app_url, cid)
        unblock = p1.get_by_role("button", name="Unblock")
        poll(p1, lambda: visible(unblock) and visible(p1.get_by_text(f"You blocked {u2.display_name}.", exact=True)),
             "the blocked copy with Unblock")
        assert composer(p1).count() == 0
        tab_to(p1, unblock, "Unblock")
        p1.keyboard.press("Enter")
        poll(p1, lambda: visible(composer(p1)), "the composer back after Unblock")
        assert u1.call("GET", "/api/blocks")[1]["blocks"] == []
        open_conversation(p2, app_url, cid)
        ours, theirs = f"Unblocked from here {tag()}", f"Unblocked from there {tag()}"
        send_letter(p1, ours)
        send_letter(p2, theirs)
        wait_delivery(p1, ours, ("delivered", "read"))
        wait_delivery(p2, theirs, ("delivered", "read"))


def test_wf_blocking_reduced_dialog(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Reduced block opener")
        open_conversation(page, app_url, cid)
        block = page.get_by_role("region", name="Contact card").get_by_role("button", name="Block", exact=True)
        dialog = page.get_by_role("dialog", name=f"Block {p.username}?")
        page.evaluate(MOTION_JS)
        block.focus()
        page.keyboard.press("Enter")
        poll(page, lambda: visible(dialog) and focused(dialog), "the Block dialog with focus inside")
        cancel = dialog.get_by_role("button", name="Cancel")
        tab_to(page, cancel, "Cancel")
        page.keyboard.press("Enter")
        poll(page, lambda: not visible(dialog) and focused(block), "Cancel returning focus to Block")
        run_in_step(page, lambda: page.evaluate(RUNNING_JS) == 0, "the dialog settling")
        reduced_only(page.evaluate(RECORDS_JS))
        assert u.call("GET", "/api/blocks")[1]["blocks"] == []


def test_wf_seal_numbers_restore_mistakes(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page, server_clock(app_url) as shift:
        page.set_viewport_size(DESKTOP)
        page.goto(f"{app_url}/signin")
        name, code = page.get_by_role("textbox", name="Username"), page.get_by_role("textbox", name="Recovery code")
        restore = page.get_by_role("button", name="Restore account")
        poll(page, lambda: visible(restore), "the Sign in screen")
        fill(name, p.username)

        def attempt(value: str) -> None:
            fill(code, value)
            with page.expect_response(lambda r: "/api/recover" in r.url):
                click(restore)

        for _ in range(RESTORE_TRIES):
            wrong = recovery_code()
            attempt(wrong if wrong != p.code else recovery_code())
            poll(page, lambda: visible(page.get_by_text(RESTORE_FAILED, exact=True)), "the restore-failed slip")
        attempt(p.code)
        poll(page, lambda: visible(page.get_by_text("Too many tries. Wait a minute and try again.", exact=True)),
             "the too-many-tries slip")
        assert not visible(page.get_by_role("navigation", name="Main"))
        shift(RESTORE_WINDOW_MS + MARGIN_MS)
        attempt(p.code)
        poll(page, lambda: visible(page.get_by_role("navigation", name="Main")), "the restored account")


def test_wf_seal_numbers_key_change_keyboard(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Key change opener")
        open_conversation(page, app_url, cid)
        assert p.recover().status_code == 200
        open_conversation(page, app_url, cid)
        warning = page.get_by_role("region", name="Seal number changed")
        name = p.username
        poll(page, lambda: visible(warning) and (f"{name}'s seal number has changed. Letters to {name} are paused until "
                                                 "you accept the new seal number.") in warning.inner_text(), "the key-change stub")
        poll(page, lambda: visible(page.get_by_text(f"{name}'s seal number changed.", exact=True)), "the key-change row")
        assert "Seal number changed" in page.get_by_role("region", name="Contact card").inner_text()
        compare = warning.get_by_role("button", name="Compare seal numbers")
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        for _ in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            assert not focused(composer(page)), "Tab reached the composer before the key-change buttons"
            if focused(compare):
                break
        else:
            pytest.fail("Tab never reached Compare seal numbers")
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Seal number")
        poll(page, lambda: visible(dialog) and seal_text(dialog) != "", "the Seal number dialog")
        assert seal_text(dialog) == sealer("sealNumber", u.card()["public_key"], p.public_key)
        page.keyboard.press("Escape")
        poll(page, lambda: not visible(dialog) and focused(compare), "Escape returning focus to Compare seal numbers")


def test_wf_username_change_old_name_hold(browser: Browser, app_url: str) -> None:
    with contextlib.ExitStack() as stack:
        p1 = stack.enter_context(app_page(browser, app_url))
        p2 = stack.enter_context(app_page(browser, app_url))
        for p in (p1, p2):
            p.set_viewport_size(DESKTOP)
        u1, _ = ui_signup(p1, app_url), ui_signup(p2, app_url)
        old, new = u1.username, fresh_name()
        p1.goto(f"{app_url}/settings")
        field = p1.get_by_role("textbox", name="New username")
        poll(p1, lambda: visible(field), "Settings")
        fill(field, new)
        poll(p1, lambda: chip(p1).inner_text().strip() == CHIP["available"], "the chip reading Available")
        click(p1.get_by_role("button", name="Change username"))
        poll(p1, lambda: u1.call("GET", "/api/me")[1]["username"] == new, "the username changed")
        p2.goto(f"{app_url}/contacts")
        result = lookup(p2, old)
        poll(p2, lambda: LOOKUP_MISS in result.inner_text(), "the old name not found")
        result = lookup(p2, new)
        poll(p2, lambda: f"Found {new}." in status_text(p2, "Lookup status") and new in result.inner_text(), "the new name found")
        p3 = stack.enter_context(app_page(browser, app_url))
        p3.set_viewport_size(DESKTOP)
        p3.goto(f"{app_url}/signup?skip_recovery_check=1")
        claim = p3.get_by_role("textbox", name="Username")
        poll(p3, lambda: visible(claim), "sign-up step 1")
        fill(claim, old)
        poll(p3, lambda: chip(p3).inner_text().strip() == CHIP["taken"], "the held name reading Taken")
        with server_clock(app_url) as shift:
            shift(NAME_HOLD_MS + MARGIN_MS)
            fill(claim, "")
            fill(claim, old)
            poll(p3, lambda: chip(p3).inner_text().strip() == CHIP["available"], "the name free after 14 days")


def test_wf_username_change_phone_touch(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        u = ui_signup(page, app_url)
        tap(page.get_by_role("navigation", name="Main").get_by_role("link", name="Settings"))
        field = page.get_by_role("textbox", name="New username")
        poll(page, lambda: visible(field) and page.url.endswith("/settings"), "Settings by touch")
        assert not small_targets(page), small_targets(page)
        new = fresh_name()
        tap(field)
        page.keyboard.type(new)
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "the chip reading Available")
        tap(page.get_by_role("button", name="Change username"))
        poll(page, lambda: f"Your username is now {new}." in status_text(page, "Letter updates"), "the change announced")
        page.reload()
        poll(page, lambda: visible(page.get_by_role("textbox", name="New username")), "Settings after reload")
        assert u.call("GET", "/api/me")[1]["username"] == new


def test_wf_username_change_cooldown_date(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        page.goto(f"{app_url}/settings")
        field = page.get_by_role("textbox", name="New username")
        poll(page, lambda: visible(field), "Settings")
        first = fresh_name()
        fill(field, first)
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "the chip reading Available")
        click(page.get_by_role("button", name="Change username"))
        poll(page, lambda: u.call("GET", "/api/me")[1]["username"] == first, "the first change")
        status, body = u.call("PATCH", "/api/me/username", {"username": fresh_name()})
        assert status == 409 and body["error"] == "username_cooldown"
        slip = f"You can change your username again on {page.evaluate(DATE_JS, body['retry_at'])}."
        fill(field, fresh_name())
        poll(page, lambda: chip(page).inner_text().strip() == CHIP["available"], "the chip reading Available again")
        click(page.get_by_role("button", name="Change username"))
        poll(page, lambda: visible(page.get_by_text(slip, exact=True)), "the cooldown slip")
        described = field.evaluate("e => (e.getAttribute('aria-describedby') || '').split(/\\s+/)"
                                   ".map(id => (document.getElementById(id) || {}).textContent || '').join(' ')")
        assert slip in " ".join(described.split()), "the field does not reference the slip as its description"
        assert u.call("GET", "/api/me")[1]["username"] == first


def test_wf_notifications_tap_toast(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    toast_ms = config(app_url)["timers"]["toast_ms"]
    with app_page(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Toast tap opener")
        read_through(page, u, app_url, cid)
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None, "Chats")
        text = f"Tap this {tag()}"
        p.send(cid, u.card(), text)
        expect_toast(page, f"{p.username}: {text}")
        tap(toasts(page).get_by_text(f"{p.username}: {text}", exact=True).first)
        poll(page, lambda: page.url.endswith(f"/letters/{cid}") and letter(page, text).count() == 1, "the toast opening its conversation")
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None, "Chats again")
        later = f"Leave this {tag()}"
        p.send(cid, u.card(), later)
        expect_toast(page, f"{p.username}: {later}")
        advance(page, toast_ms + STEP_MS)
        poll(page, lambda: toasts(page).get_by_text(f"{p.username}: {later}", exact=True).count() == 0, "the toast leaving")


def test_wf_notifications_open_conversation(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p, q = Person(app_url, sealer), Person(app_url, sealer)
    with app_page(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        here = person_to_ui(p, u, "Open conversation opener")
        elsewhere = person_to_ui(q, u, "Other conversation opener")
        read_through(page, u, app_url, elsewhere)
        read_through(page, u, app_url, here)
        text = f"Into the open sheet {tag()}"
        p.send(here, u.card(), text)
        poll(page, lambda: letter(page, text).count() == 1
             and f"New letter from {p.username}." in status_text(page, "Letter updates"), "the arrival announced")
        assert toasts(page).inner_text().strip() == "", "a letter into the open conversation raised a toast"
        long = f"Ferry timetable change {tag()} " + "the evening crossing now leaves from the north pier " * 3
        q.send(elsewhere, u.card(), long)
        expect_toast(page, f"{q.username}: {long[:TEXT_CUT]}")


def test_wf_notifications_mute_hour_keyboard(browser: Browser, app_url: str, sealer: Sealer) -> None:
    p = Person(app_url, sealer)
    with app_page(browser, app_url) as page, server_clock(app_url) as shift:
        page.set_viewport_size(DESKTOP)
        u = ui_signup(page, app_url)
        cid = person_to_ui(p, u, "Hour mute opener")
        read_through(page, u, app_url, cid)
        mute = page.get_by_role("region", name="Contact card").get_by_role("button", name="Mute", exact=True)
        mute.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Mute letters")
        poll(page, lambda: visible(dialog) and focused(dialog), "the Mute letters dialog with focus inside")
        hour = dialog.get_by_role("radio", name="1 hour")
        tab_to(page, hour, "1 hour")
        page.keyboard.press("Space")
        poll(page, lambda: hour.is_checked(), "1 hour chosen")
        confirm = dialog.get_by_role("button", name="Mute", exact=True)
        tab_to(page, confirm, "Mute")
        page.keyboard.press("Enter")
        poll(page, lambda: u.call("GET", f"/api/conversations/{cid}")[1]["muted_until"] not in (None, "always"), "muted for an hour")
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None, "Chats")
        p.send(cid, u.card(), f"Quiet hour {tag()}")
        poll(page, lambda: badge_text(page, cid) == "1" and tab_badge_shows(page, 1), "badges counting while muted")
        stays(page, lambda: toasts(page).inner_text().strip() == "", "no toast while muted", 2)
        shift(HOUR_MS + MARGIN_MS)
        page.clock.fast_forward(HOUR_MS + MARGIN_MS)
        page.goto(f"{app_url}/letters")
        poll(page, lambda: chats_item(page, cid) is not None, "Chats after the hour")
        loud = f"After the hour {tag()}"
        p.send(cid, u.card(), loud)
        expect_toast(page, f"{p.username}: {loud}")


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{p.name}@{p.version}" for p in shipped_packages() if p.name not in notices or (p.version and p.version not in notices)]
    assert not missing, f"missing from notices: {missing[:20]}"
    assert "Zilla Slab" in notices


def test_if_licences() -> None:
    bad = [f"{p.name} {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad


def test_if_no_other_datastore() -> None:
    names = {p.name for p in shipped_packages()}
    assert not names & DATASTORE_CLIENTS, sorted(names & DATASTORE_CLIENTS)
    files = [str(f) for f in DEPLOYED_APP.rglob("*") if f.suffix in STATE_FILE_SUFFIXES
             and "node_modules" not in f.parts and ".git" not in f.parts]
    assert not files, files


def test_if_same_origin_only(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url) as page:
        urls: list[str] = []
        page.on("request", lambda req: urls.append(req.url))
        page.on("websocket", lambda ws: urls.append(re.sub(r"^ws", "http", ws.url)))
        page.reload()
        ui_signup(page, app_url)
        page.goto(f"{app_url}/contacts")
        poll(page, lambda: visible(page.get_by_role("textbox", name="Find by username")), "Contacts")
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert not foreign, foreign


def test_if_webcrypto_only() -> None:
    names = {p.name for p in shipped_packages()}
    assert not names & CRYPTO_PACKAGES, sorted(names & CRYPTO_PACKAGES)


def test_if_compose_untouched() -> None:
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    compose_name = r"compose[\w.-]*\.ya?ml"
    compose = re.compile(compose_name)
    edit_tool = re.compile(r"^(Write|Edit|MultiEdit|NotebookEdit|str_replace\w*|create_file|apply_patch|write_file)$", re.I)
    path_keys = ("file_path", "path", "filePath", "notebook_path")
    write_forms = (
        re.compile(rf"^\s*(sudo\s+)?sed\s+(-\S*i\S*|--in-place)\b.*{compose_name}"),
        re.compile(rf"^\s*(sudo\s+)?(rm|mv)\b.*{compose_name}"),
        re.compile(rf">>?\s*\S*{compose_name}"),
        re.compile(rf"\btee\b[^|]*{compose_name}"),
    )
    hits: list[str] = []

    def target_paths(node: dict) -> list[str]:
        found = [str(node[k]) for k in path_keys if isinstance(node.get(k), (str, Path))]
        for inner in ("input", "arguments", "args", "parameters"):
            sub = node.get(inner)
            if isinstance(sub, dict):
                found += [str(sub[k]) for k in path_keys if isinstance(sub.get(k), (str, Path))]
        return found

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            tool = str(node.get("name") or node.get("tool") or node.get("tool_name") or "")
            if edit_tool.match(tool):
                hits.extend(f"{tool} {p}" for p in target_paths(node) if compose.search(Path(p).name))
            command = node.get("command")
            if isinstance(command, str):
                for segment in re.split(r"&&|\|\||;|\n", command):
                    if compose.search(segment) and any(w.search(segment) for w in write_forms):
                        hits.append(segment.strip()[:200])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(json.loads(path.read_text()))
    assert not hits, hits[:5]
