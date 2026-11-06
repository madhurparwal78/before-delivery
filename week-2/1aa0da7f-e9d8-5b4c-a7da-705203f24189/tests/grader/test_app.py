from __future__ import annotations

import base64
import concurrent.futures
import contextlib
import dataclasses
import datetime as dt
import hashlib
import hmac
import importlib
import json
import os
import re
import signal
import socket
import statistics
import struct
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
import zlib
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

import conftest
from conftest import DEPLOYED_APP, advance, click, layout, open_app, same_origin, select, session, settle, tab_order, unique, until


def _client(name: str) -> Any:
    for module in ("conftest", "postgres", "minio", "mailpit", "clients", "services", "service_clients"):
        try:
            found = getattr(importlib.import_module(module), name, None)
        except ImportError:
            continue
        if found is not None:
            return found
    raise AssertionError(f"helper {name} is not available")


Postgres = _client("Postgres")
S3 = _client("S3")
addresses = _client("addresses")
text_of = _client("text")
mail_from_address = _client("mail_from_address")

PASSWORD = "Custody-Seed-2026!"
PEOPLE = {
    "tamsin": ("USR-01", "Tamsin Oduya", "tamsin.oduya@ashgrove.example", "TAMSINODUYA2WARD"),
    "rafael": ("USR-02", "Rafael Lindqvist", "rafael.lindqvist@ashgrove.example", "RAFAELLINDQ3WARD"),
    "ines": ("USR-03", "Ines Marlow", "ines.marlow@ashgrove.example", "INESMARLOW4WARDL"),
    "kofi": ("USR-04", "Kofi Brandt", "kofi.brandt@ashgrove.example", "KOFIBRANDT5WARDL"),
    "mbali": ("USR-05", "Mbali Serrano", "mbali.serrano@ashgrove.example", "MBALISERRANO6WRD"),
    "noor": ("USR-06", "Noor Halloran", "noor.halloran@ashgrove.example", "NOORHALLORAN7WRD"),
    "dmitri": ("USR-07", "Dmitri Vance", "dmitri.vance@ashgrove.example", "DMITRIVANCE2LINE"),
    "yuki": ("USR-08", "Yuki Castellan", "yuki.castellan@ashgrove.example", "YUKICASTELLAN3WD"),
    "sefa": ("USR-09", "Sefa Whitlock", "sefa.whitlock@ashgrove.example", "SEFAWHITLOCK4WRD"),
}
HTTP_TIMEOUT = 60.0
POLL_SECONDS = 30.0
UI_MS = 20000
SLACK_MS = 2000
LIVE_MS = 5000 + SLACK_MS
BANNER_MS = 10000 + SLACK_MS
SIGN_IN_AGAIN_MS = 10000 + SLACK_MS
BOOT_SECONDS = 180.0
TIMING_GAP_S = 0.150
STALL_ANSWER_S = 2.0
RELEASE_S = 10.0
SWEEP_S = 10.0
LOCKOUT_SECONDS = 6
STEP_UP_TTL_SECONDS = 6
IDLE_SECONDS = 12
BREAK_GLASS_SHORT_SECONDS = 20
MAX_FILE = 20_000_000
MAX_JSON = 1_000_000
MAX_PIXELS = 40_000_000
MAX_PAGES = 200
THROTTLE_LIMIT = 10
THROTTLE_WINDOW = 60
WALK_STEP_PX = 72
LONG_CHAIN = 2500
LONG_CHAIN_MS = 10000
MARK_CAP = 300
ZERO_DIGEST = "0" * 64
CELLS = 64
SETTLE_MAX_MS = 500
TIMELINE_STEP = 64
TIMELINE_HEIGHT = 320
TARGET_PX = 44
SEED_LINK = "harrowgate-counsel-seed-link"
VERMILION = (200, 50, 26)
DEEP_GREEN = (31, 92, 69)
LEAK = re.compile(r"Traceback|psycopg|asyncpg|sqlalchemy|SELECT\s|INSERT\s|File \"|/app/|\.py\b")
UPLOAD_PROBE_BYTES = 4_000_000
UPLOAD_THROTTLE = 1_000_000
DOWNLOAD_PROBE_BYTES = 19_000_000
STALLED_EACH_WAY = 40
MANY_STOPS = 14
TAMPER_ACTOR = "forged-actor"
GOOD_REASON = "A reason long enough for the published minimum"
CAPTURE_NOTE = "Handed over in person"
SUBMITTED_NAME = "secret-witness-name"
SUBJECT_FIELD = "Subject"
TAB_INDEX = "tabindex"
EX_SEED = "EX-0001"
CMP_SEED = "CMP-0001"
CMP_OTHER = "CMP-0002"
REL_SEED = "REL-0001"
KEY_HEX = 32
BREAK_AT = 1503
SEALED_COPY = "Sealed <exhibit id>. In quarantine until a second officer clears it."
expect.set_options(timeout=UI_MS)


def _env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def _short() -> str:
    return _env_url("APP_SHORT_URL")


def _idle() -> str:
    return _env_url("APP_IDLE_URL")


def _tamper() -> str:
    return _env_url("APP_TAMPER_URL")


def _storage_down() -> str:
    return _env_url("APP_MINIO_DOWN_URL")


def _mail_down() -> str:
    return _env_url("APP_MAIL_DOWN_URL")


def _storage_denied() -> str:
    return _env_url("APP_MINIO_DENIED_URL")


def _totp(who: str) -> str:
    secret = PEOPLE[who][3]
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", int(time.time()) // 30), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return f"{(struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1000000:06d}"


def _poll(check: Callable[[], Any], seconds: float = POLL_SECONDS, what: str = "condition") -> Any:
    end = time.monotonic() + seconds
    while True:
        value = check()
        if value:
            return value
        assert time.monotonic() < end, f"{what} did not hold within {seconds} seconds"


def _holds(check: Callable[[], None], seconds: float = 1.0) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        check()


MARKED_JS = "(root, [name, value]) => [...root.getElementsByTagName('*')].filter(e => value === null ? e.hasAttribute(name) : e.getAttribute(name) === value).map(e => { const r = e.getBoundingClientRect(); return {text: e.textContent.trim(), width: r.width, height: r.height, top: r.top, attrs: Object.fromEntries([...e.attributes].map(a => [a.name, a.value])), range: e.scrollHeight - e.clientHeight, offset: e.scrollTop}; })"
SCROLL_JS = "(root, [name, y]) => { for (const e of root.getElementsByTagName('*')) if (e.hasAttribute(name)) e.scrollTop = y; }"
DIGEST_STATE_JS = f"state => ({MARKED_JS})(document, ['data-digest-state', null])[0]?.attrs['data-digest-state'] === state"


def _marked(scope: Any, name: str, value: str | None = None) -> list[dict]:
    if isinstance(scope, Page):
        return scope.evaluate(f"arg => ({MARKED_JS})(document, arg)", [name, value])
    return scope.evaluate(MARKED_JS, [name, value])


def _marked_count(scope: Any, name: str, value: str | None, count: int) -> None:
    _poll(lambda: len(_marked(scope, name, value)) == count, UI_MS / 1000, f"{count} of {name}")


def _figure_is(page: Page, expected: str) -> None:
    _poll(lambda: [m["text"] for m in _marked(page, "data-figure")] == [expected], UI_MS / 1000, "the one figure")


def _mark_says(page: Page, link: int, word: str) -> None:
    _poll(lambda: any(word in m["text"] for m in _marked(page, "data-link-mark", str(link))), UI_MS / 1000, f"link mark {link}")


def _published(template: str) -> re.Pattern:
    return re.compile("^" + ".+?".join(re.escape(part) for part in re.split(r"<[^>]+>", template)) + "$")


def _random_key(key: str, prefix: str) -> bool:
    name = key.removeprefix(prefix)
    return key.startswith(prefix) and len(name) >= KEY_HEX and set(name) <= set("0123456789abcdef")


def _revoke_path(person: str) -> str:
    return f"/api/users/{person}/sessions/revoke"


def _totals_copy(quarantined: int, release_bytes: int) -> str:
    return f"{quarantined} in quarantine. {release_bytes} bytes in releases."


def _region_copy(x: int, y: int, w: int, h: int, n: int = 1) -> str:
    return f"Region {n} at {x}, {y}, size {w} by {h}."


_ABSENT = object()


class Api:

    def __init__(self, base: str, who: str | None = None) -> None:
        self.base, self.who, self.cookie, self.session_id = base, who, "", None
        if who:
            response = self.sign_in()
            assert response.status_code == 200, response.text

    @property
    def user_id(self) -> str:
        return PEOPLE[self.who][0]

    def sign_in(self, password: str = PASSWORD, email: str | None = None, **extra: Any) -> httpx.Response:
        response = httpx.post(f"{self.base}/api/sign-in", json={"email": email or PEOPLE[self.who][2], "password": password, **extra}, timeout=HTTP_TIMEOUT)
        if response.status_code == 200:
            self.cookie = "; ".join(c.split(";", 1)[0] for c in response.headers.get_list("set-cookie"))
            self.session_id = response.json()["session_id"]
        return response

    def request(self, method: str, path: str, body: Any = _ABSENT, proof: str | bytes | None = None, headers: dict | None = None, **kw: Any) -> httpx.Response:
        sent = dict(headers or {})
        if self.cookie:
            sent["Cookie"] = self.cookie
        if proof:
            sent["X-Step-Up-Proof"] = proof
        if body is not _ABSENT:
            kw["json"] = body
        return httpx.request(method, self.base + path, headers=sent, timeout=HTTP_TIMEOUT, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.request("POST", path, {} if body is None else body, **kw)

    def proof(self) -> str:
        response = self.post("/api/step-up", {"password": PASSWORD, "code": _totp(self.who)})
        assert response.status_code == 201, response.text
        return response.json()["proof"]

    def act(self, method: str, path: str, body: Any = None) -> httpx.Response:
        return self.request(method, path, {} if body is None else body, proof=self.proof())


def _ok(response: httpx.Response, status: int = 200) -> dict:
    assert response.status_code == status, f"{response.request.method} {response.request.url}: {response.status_code} {response.text}"
    return response.json()


def _refused(response: httpx.Response, status: int, code: str) -> dict:
    assert response.status_code == status, f"{response.status_code} {response.text}"
    body = response.json()
    assert body["error"] == code, body
    return body


def _q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _rows(pg: Any, where: str) -> list[dict]:
    return pg.rows(f"SELECT seq, at, actor_id, session_id, action, target, detail, prev_digest, digest FROM ledger_entries WHERE {where} ORDER BY seq")


def _count(pg: Any, action: str, target: str) -> int:
    return len(_rows(pg, f"action = {_q(action)} AND target = {_q(target)}"))


def _table_hits(pg: Any, needle: str) -> list[str]:
    hits = []
    for table in pg.tables():
        name = table if "." in table else f'"{table}"'
        if int(pg.rows(f"SELECT count(*) AS c FROM {name} x WHERE x::text LIKE {_q('%' + needle + '%')}")[0]["c"]):
            hits.append(table)
    return hits


def _canonical(entry: dict) -> str:
    fields = {k: entry[k] for k in ("action", "actor_id", "at", "detail", "seq", "session_id", "target")}
    return json.dumps(fields, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _digest(prev: str, entry: dict) -> str:
    return hashlib.sha256((prev + "\n" + _canonical(entry)).encode()).hexdigest()


def _chain(count: int, salt: str = "a") -> list[dict]:
    entries, prev = [], ZERO_DIGEST
    for seq in range(1, count + 1):
        entry = {"seq": seq, "at": "2026-10-30T12:00:00.000000Z", "actor_id": "system", "session_id": None, "action": "session.opened", "target": f"S-{salt}-{seq}", "detail": {}}
        entry["prev_digest"] = prev
        entry["digest"] = prev = _digest(prev, entry)
        entries.append(entry)
    return entries


def _serve_ledger(page: Page, entries: list[dict]) -> list[str]:
    queries: list[str] = []

    def handle(route: Any) -> None:
        url = urllib.parse.urlsplit(route.request.url)
        queries.append(url.query)
        params = dict(urllib.parse.parse_qsl(url.query))
        after, limit = int(params.get("after", 0)), min(int(params.get("limit", 200)), 1000)
        rows = [e for e in entries if e["seq"] > after][:limit]
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"entries": rows, "count": len(entries)}, ensure_ascii=False))

    page.route(re.compile(r"/api/ledger(\?.*)?$"), handle)
    return queries


@contextlib.contextmanager
def _page(browser: Browser, base: str, who: str | None = None, route: str | None = None, width: int = 1280, height: int = 800, touch: bool = False, reduced: bool = False, init: str | None = None, **ctx: Any) -> Iterator[Page]:
    context = browser.new_context(viewport={"width": width, "height": height}, has_touch=touch, reduced_motion="reduce" if reduced else "no-preference", accept_downloads=True, **ctx)
    if init:
        context.add_init_script(init)
    page = context.new_page()
    if who:
        answer = page.request.post(f"{base}/api/sign-in", data={"email": PEOPLE[who][2], "password": PASSWORD})
        assert answer.status == 200, answer.text()
    if route:
        page.goto(base + route)
    try:
        yield page
    finally:
        context.close()


def _role(scope: Any, role: str, name: str) -> Locator:
    return scope.get_by_role(role, name=name, exact=True)


def _status(scope: Any, name: str) -> Locator:
    return _role(scope, "status", name)


def _btn(scope: Any, name: str) -> Locator:
    return _role(scope, "button", name)


def _box(scope: Any, name: str) -> Locator:
    return _role(scope, "textbox", name)


def _step_up(page: Page, who: str, reason: str | None = None) -> None:
    dialog = _role(page, "dialog", "Step-up")
    expect(dialog).to_be_visible()
    if reason is not None:
        _box(dialog, "Reason").fill(reason)
    _box(dialog, "Password").fill(PASSWORD)
    _box(dialog, "Authenticator code").fill(_totp(who))
    _btn(dialog, "Confirm").click()


def _ui_sign_in(page: Page, who: str, password: str = PASSWORD) -> None:
    _box(page, "Email").fill(PEOPLE[who][2])
    _box(page, "Password").fill(password)
    _btn(page, "Sign in").click()


RECORD = """(el, key) => { window.__seen = window.__seen || {}; const seen = window.__seen[key] = [];
  const push = () => { const t = el.textContent.trim(); if (t && seen[seen.length - 1] !== t) seen.push(t); };
  push(); new MutationObserver(push).observe(el, {childList: true, subtree: true, characterData: true}); }"""


def _record(locator: Locator, key: str) -> None:
    locator.evaluate(RECORD, key)


def _seen(page: Page, key: str) -> list[str]:
    return page.evaluate("key => window.__seen[key]", key)


def _rect(locator: Locator) -> dict:
    box = locator.bounding_box()
    assert box, "element has no box"
    return box


def _same_node_tag(locator: Locator) -> None:
    locator.evaluate("el => { el.__kept = true; }")


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def _png(width: int = 40, height: int = 30, colour: tuple[int, int, int] = (255, 255, 255), extra: bytes = b"", trailing: bytes = b"") -> bytes:
    row = b"\0" + bytes(colour) * width
    return b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + extra + _png_chunk(b"IDAT", zlib.compress(row * height, 1)) + _png_chunk(b"IEND", b"") + trailing


def _png_chunks(data: bytes) -> list[bytes]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    at, kinds = 8, []
    while at < len(data):
        size = struct.unpack(">I", data[at:at + 4])[0]
        kinds.append(data[at + 4:at + 8])
        at += 12 + size
    return kinds


class Raster:

    def __init__(self, data: bytes) -> None:
        at, idat = 8, b""
        while at < len(data):
            size = struct.unpack(">I", data[at:at + 4])[0]
            kind, chunk = data[at + 4:at + 8], data[at + 8:at + 8 + size]
            if kind == b"IHDR":
                self.width, self.height, depth, colour = struct.unpack(">IIBB", chunk[:10])
                assert depth == 8 and colour in (2, 6), (depth, colour)
                self.colour_type, self.channels = colour, 3 if colour == 2 else 4
            elif kind == b"IDAT":
                idat += chunk
            elif kind == b"IEND":
                break
            at += 12 + size
        raw, stride, rows, prev = zlib.decompress(idat), self.width * self.channels, [], bytearray(self.width * self.channels)
        for y in range(self.height):
            start = y * (stride + 1)
            kind, line = raw[start], bytearray(raw[start + 1:start + 1 + stride])
            bpp = self.channels
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                if kind == 1:
                    line[i] = (line[i] + a) & 255
                elif kind == 2:
                    line[i] = (line[i] + b) & 255
                elif kind == 3:
                    line[i] = (line[i] + (a + b) // 2) & 255
                elif kind == 4:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            rows.append(bytes(line))
            prev = line
        self.rows = rows

    def at(self, x: int, y: int) -> tuple[int, int, int]:
        start = x * self.channels
        return tuple(self.rows[y][start:start + 3])

    def count(self, colour: tuple[int, int, int]) -> int:
        return sum(1 for y in range(self.height) for x in range(self.width) if self.at(x, y) == colour)


def _pdf(pages: list[dict], author: str | None = None, encrypted: bool = False) -> bytes:
    objects: dict[int, bytes] = {}
    next_id = [4]

    def add(body: bytes) -> int:
        number = next_id[0]
        next_id[0] += 1
        objects[number] = body
        return number

    def stream(dictionary: str, data: bytes) -> bytes:
        return f"<< {dictionary} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream"

    kids, fields = [], []
    for spec in pages:
        media = spec.get("media", (0, 0, 288, 144))
        content = spec.get("draw", "").encode()
        for x, y, words in spec.get("text", []):
            content += f"BT /F1 12 Tf {x} {y} Td ({words}) Tj ET\n".encode()
        extra = ""
        if "crop" in spec:
            extra += " /CropBox [" + " ".join(map(str, spec["crop"])) + "]"
        if "rotate" in spec:
            extra += f" /Rotate {spec['rotate']}"
        annots = []
        for subtype, rect, rgb in spec.get("annots", []):
            width, height = rect[2] - rect[0], rect[3] - rect[1]
            appearance = add(stream(f"/Type /XObject /Subtype /Form /BBox [0 0 {width} {height}]", f"{rgb} rg 0 0 {width} {height} re f".encode()))
            field = " /FT /Tx /T (field) /V (filled)" if subtype == "Widget" else ""
            annot = add(f"<< /Type /Annot /Subtype /{subtype} /F 4 /Rect [{' '.join(map(str, rect))}] /AP << /N {appearance} 0 R >>{field} >>".encode())
            annots.append(annot)
            if subtype == "Widget":
                fields.append(annot)
        if annots:
            extra += " /Annots [" + " ".join(f"{n} 0 R" for n in annots) + "]"
        body = add(stream("", content))
        kids.append(add(f"<< /Type /Page /Parent 2 0 R /MediaBox [{' '.join(map(str, media))}]{extra} /Resources << /Font << /F1 3 0 R >> >> /Contents {body} 0 R >>".encode()))
    form = " /AcroForm << /Fields [" + " ".join(f"{n} 0 R" for n in fields) + "] >>" if fields else ""
    objects[1] = f"<< /Type /Catalog /Pages 2 0 R{form} >>".encode()
    objects[2] = f"<< /Type /Pages /Count {len(kids)} /Kids [{' '.join(f'{k} 0 R' for k in kids)}] >>".encode()
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    trailer = ""
    if author:
        trailer += f" /Info {add(f'<< /Author ({author}) >>'.encode())} 0 R"
    if encrypted:
        filler = "ab" * 32
        trailer += f" /Encrypt {add(f'<< /Filter /Standard /V 1 /R 2 /P -44 /O <{filler}> /U <{filler}> >>'.encode())} 0 R /ID [<{filler[:32]}> <{filler[:32]}>]"
    out = bytearray(b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    start = len(out)
    size = max(objects) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for number in range(1, size):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {size} /Root 1 0 R{trailer} >>\nstartxref\n{start}\n%%EOF\n".encode()
    return bytes(out)


def _text_pdf(words: str = "PLAIN-TEXT", **page: Any) -> bytes:
    return _pdf([{"text": [(20, 20, words)], **page}])


def _jpeg_exif(orientation: int) -> bytes:
    tiff = b"MM\0*\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01" + struct.pack(">H", orientation) + b"\0\0\0\0\0\0"
    exif = b"Exif\0\0" + tiff
    out = bytearray(b"\xff\xd8\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif)
    out += b"\xff\xdb\0\x43\0" + b"\x01" * 64
    out += b"\xff\xc0\0\x0b\x08\0\x08\0\x10\x01\x01\x11\0"
    out += b"\xff\xc4" + struct.pack(">H", 19 + 12) + b"\0" + bytes([0, 0, 0, 12] + [0] * 12) + bytes(range(12))
    out += b"\xff\xc4" + struct.pack(">H", 19 + 1) + b"\x10" + bytes([1] + [0] * 15) + b"\0"
    out += b"\xff\xda\0\x08\x01\x01\0\0\x3f\0"
    bits = ""
    for diff in (-896, 1792):
        category = abs(diff).bit_length()
        magnitude = diff if diff > 0 else diff + (1 << category) - 1
        bits += f"{category:04b}" + f"{magnitude:0{category}b}" + "0"
    bits += "1" * (-len(bits) % 8)
    for i in range(0, len(bits), 8):
        value = int(bits[i:i + 8], 2)
        out.append(value)
        if value == 255:
            out.append(0)
    return bytes(out + b"\xff\xd9")


def _wav() -> bytes:
    pcm = b"\0\0" * 800
    return b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm


def _s3_write(method: str, key: str, data: bytes = b"") -> None:
    endpoint = os.environ["S3_ENDPOINT"].rstrip("/")
    bucket, region = os.environ["S3_BUCKET"], os.environ["S3_REGION"]
    host = urllib.parse.urlsplit(endpoint).netloc
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    day, payload = stamp[:8], hashlib.sha256(data).hexdigest()
    path = f"/{bucket}/{urllib.parse.quote(key)}"
    canonical = f"{method}\n{path}\n\nhost:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{stamp}\n\nhost;x-amz-content-sha256;x-amz-date\n{payload}"
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    signing = ("AWS4" + os.environ["S3_SECRET_ACCESS_KEY"]).encode()
    for part in (day, region, "s3", "aws4_request"):
        signing = hmac.new(signing, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing, to_sign.encode(), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={os.environ['S3_ACCESS_KEY_ID']}/{scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature={signature}"
    response = httpx.request(method, endpoint + path, content=data, timeout=HTTP_TIMEOUT, headers={"x-amz-date": stamp, "x-amz-content-sha256": payload, "Authorization": auth})
    assert response.status_code < 300, response.text


def _psql(url: str, script: str) -> subprocess.CompletedProcess:
    return subprocess.run(["psql", url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", "-"], input=script, capture_output=True, text=True, timeout=HTTP_TIMEOUT)


@dataclasses.dataclass
class World:
    base: str
    lead: Api
    lead2: Api | None
    ines: Api
    kofi: Api
    noor: Api
    cid: str
    name: str


def _grant(lead: Api, cid: str, who: str, scope: str = "full", expires_at: str | None = None) -> dict:
    version = _ok(lead.get(f"/api/compartments/{cid}"))["access_version"]
    return _ok(lead.act("POST", f"/api/compartments/{cid}/grants", {"user_id": PEOPLE[who][0], "scope": scope, "expires_at": expires_at, "access_version": version}), 201)


def _world(base: str, lead: str = "tamsin", second: str | None = "rafael", extra: tuple[str, ...] = ()) -> World:
    boss = Api(base, lead)
    name = unique("Compartment")[0]
    cid = _ok(boss.post("/api/compartments", {"name": name}), 201)["id"]
    for who in tuple(w for w in (second,) if w) + ("ines", "kofi", "noor") + extra:
        _grant(boss, cid, who)
    return World(base, boss, Api(base, second) if second else None, Api(base, "ines"), Api(base, "kofi"), Api(base, "noor"), cid, name)


def _upload(api: Api, cid: str, data: bytes, declared: str = "image/png", filename: str = "exhibit.png", name: str | None = None, key: str | None = None, **fields: str) -> httpx.Response:
    form = {"name": name or unique("Exhibit")[0], "declared_type": declared, "source": "Seed record", "collected_by": "Ines Marlow", "collected_on": "2026-09-14", **fields}
    return api.request("POST", f"/api/compartments/{cid}/exhibits", data=form, files={"file": (filename, data, declared)}, headers={"Idempotency-Key": key} if key else None)


def _quarantined(w: World, data: bytes | None = None, declared: str = "image/png", filename: str = "exhibit.png", **kw: Any) -> dict:
    return _ok(_upload(w.ines, w.cid, _png() if data is None else data, declared, filename, **kw), 201)


def _cleared(w: World, data: bytes | None = None, declared: str = "image/png", filename: str = "exhibit.png", **kw: Any) -> dict:
    exhibit = _quarantined(w, data, declared, filename, **kw)
    _ok(w.kofi.act("POST", f"/api/exhibits/{exhibit['id']}/clear"))
    return exhibit


def _pdf_exhibit(w: World, data: bytes) -> dict:
    return _cleared(w, data, "application/pdf", "exhibit.pdf")


def _save(api: Api, exhibit_id: str, regions: list[dict]) -> dict:
    version = _ok(api.get(f"/api/exhibits/{exhibit_id}/redactions"))["marks_version"]
    return _ok(api.request("PUT", f"/api/exhibits/{exhibit_id}/redactions", {"regions": regions, "marks_version": version}))


REGION = {"page": 1, "x": 100, "y": 100, "w": 400, "h": 300}


def _rendered(w: World, exhibit_id: str | None = None, regions: list[dict] | None = None) -> dict:
    exhibit_id = exhibit_id or _cleared(w)["id"]
    _save(w.noor, exhibit_id, [REGION] if regions is None else regions)
    return _ok(w.noor.post(f"/api/exhibits/{exhibit_id}/derivatives"), 201)


def _assembling(w: World, derivative: dict | None = None, label: str = "Item one", recipient: str = "counsel") -> dict:
    derivative = derivative or _rendered(w)
    release = _ok(w.noor.post(f"/api/compartments/{w.cid}/releases", {"name": unique("Release")[0], "matter_ref": "M-2026-041", "recipient_kind": recipient}), 201)
    return _ok(w.noor.post(f"/api/releases/{release['id']}/items", {"derivative_id": derivative["id"], "label": label}), 201)


def _submitted(w: World, **kw: Any) -> dict:
    release = _assembling(w, **kw)
    return _ok(w.noor.act("POST", f"/api/releases/{release['id']}/submit"))


def _claim(api: Api, derivative_id: str) -> httpx.Response:
    token = _ok(api.post(f"/api/derivatives/{derivative_id}/download-grants"), 201)["token"]
    return httpx.get(f"{api.base}/api/download/{token}", timeout=HTTP_TIMEOUT)


def _signed_off(w: World, decider: Api | None = None, **kw: Any) -> dict:
    decider = decider or w.lead
    release = _submitted(w, **kw)
    for item in release["items"]:
        _ok_file = _claim(decider, item["derivative_id"])
        assert _ok_file.status_code == 200
    return _ok(decider.act("POST", f"/api/releases/{release['id']}/sign-off", {"manifest_digest": release["manifest_digest"]}))


def _server_time(api: Api, seconds: int = 0) -> str:
    now = dt.datetime.fromisoformat(_ok(api.get("/api/session"))["server_time"].replace("Z", "+00:00"))
    return (now + dt.timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _shared(w: World, recipient: str = "counsel", **kw: Any) -> tuple[dict, dict]:
    release = _signed_off(w, recipient=recipient, **kw)
    link = _ok(w.lead.act("POST", f"/api/releases/{release['id']}/share", {"expires_at": _server_time(w.lead, 86400)}), 201)
    return release, link


def _download(api: Api, path: str) -> httpx.Response:
    token = _ok(api.post(path), 201)["token"]
    return httpx.get(f"{api.base}/api/download/{token}", timeout=HTTP_TIMEOUT)


def _preview(api: Api, exhibit_id: str, page: int = 1) -> bytes:
    token = _ok(api.post(f"/api/exhibits/{exhibit_id}/preview-grants", {"page": page}), 201)["token"]
    response = httpx.get(f"{api.base}/api/download/{token}", timeout=HTTP_TIMEOUT)
    assert response.status_code == 200
    return response.content


def _derivative_bytes(api: Api, derivative_id: str) -> bytes:
    response = _claim(api, derivative_id)
    assert response.status_code == 200
    return response.content


def _manifest(release: dict, api: Api) -> str:
    rows = [{"derivative_id": i["derivative_id"], "label": i["label"], "sha256": _ok(api.get(f"/api/derivatives/{i['derivative_id']}"))["sha256"]} for i in sorted(release["items"], key=lambda i: i["id"])]
    return hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _fill_intake(page: Page, compartment: str, title: str, payload: bytes | None = None, declared: str = "PNG image", filename: str = "exhibit.png") -> None:
    select(_role(page, "combobox", "Compartment"), compartment)
    _box(page, "Exhibit name").fill(title)
    _box(page, "Source").fill("Seed record")
    _box(page, "Collected by").fill("Ines Marlow")
    _box(page, "Collected on").fill("2026-09-14")
    select(_role(page, "combobox", "Declared type"), declared)
    page.get_by_label("File", exact=True).set_input_files({"name": filename, "mimeType": "application/octet-stream", "buffer": _png() if payload is None else payload})


def _by_name(api: Api, cid: str, name: str) -> list[dict]:
    return [e for e in _ok(api.get(f"/api/compartments/{cid}/exhibits"))["exhibits"] if e["name"] == name]


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Relay:

    def __init__(self, host: str, port: int, up: bool = True) -> None:
        self.target, self.up, self.links = (host, port), up, []
        self.flow = threading.Event()
        self.flow.set()
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(128)
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                near, _ = self.listener.accept()
            except OSError:
                return
            if not self.up:
                near.close()
                continue
            try:
                far = socket.create_connection(self.target, timeout=5)
            except OSError:
                near.close()
                continue
            self.links += [near, far]
            threading.Thread(target=self._pump, args=(near, far, False), daemon=True).start()
            threading.Thread(target=self._pump, args=(far, near, True), daemon=True).start()

    def _pump(self, source: socket.socket, sink: socket.socket, gated: bool) -> None:
        with contextlib.suppress(OSError):
            while data := source.recv(65536):
                if gated:
                    self.flow.wait()
                sink.sendall(data)
        with contextlib.suppress(OSError):
            sink.shutdown(socket.SHUT_RDWR)

    def set_up(self, up: bool) -> None:
        self.up = up
        if not up:
            for link in self.links:
                with contextlib.suppress(OSError):
                    link.shutdown(socket.SHUT_RDWR)
            self.links = []

    def stop(self) -> None:
        self.flow.set()
        self.set_up(False)
        with contextlib.suppress(OSError):
            self.listener.shutdown(socket.SHUT_RDWR)
        self.listener.close()


def _s3_relay(up: bool = True) -> Relay:
    parts = urllib.parse.urlsplit(os.environ["S3_ENDPOINT"])
    return Relay(parts.hostname, parts.port or 80, up)


def _smtp_relay(up: bool = True) -> Relay:
    return Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]), up)


@contextlib.contextmanager
def _copy(**env: str) -> Iterator[tuple[str, subprocess.Popen]]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = _free_port()
    base = f"http://127.0.0.1:{port}"
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log:
        process = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                                   env={**os.environ, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base, **env})
        try:
            def healthy() -> bool:
                if process.poll() is not None:
                    log.seek(0)
                    raise AssertionError(f"copy exited: {log.read()[-2000:]}")
                with contextlib.suppress(httpx.HTTPError):
                    return httpx.get(f"{base}/api/health", timeout=5).status_code == 200
                return False

            _poll(healthy, BOOT_SECONDS, "copy health")
            yield base, process
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def _status_json(base: str) -> dict:
    return httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT).json()


def _raw_socket(base: str) -> socket.socket:
    parts = urllib.parse.urlsplit(base)
    return socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT)


def _partial_upload(api: Api, cid: str, sent: int = 200_000, total: int = MAX_FILE) -> socket.socket:
    boundary = uuid.uuid4().hex
    head = b"".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in {"name": unique("Dropped")[0], "declared_type": "image/png", "source": "Seed record", "collected_by": "Ines Marlow", "collected_on": "2026-09-14"}.items())
    head += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    length = len(head) + total + len(tail)
    parts = urllib.parse.urlsplit(api.base)
    connection = _raw_socket(api.base)
    connection.sendall(f"POST /api/compartments/{cid}/exhibits HTTP/1.1\r\nHost: {parts.netloc}\r\nCookie: {api.cookie}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {length}\r\n\r\n".encode() + head + _png() + b"\0" * sent)
    return connection


def _no_open_transactions(pg: Any) -> bool:
    rows = pg.rows("SELECT count(*) AS c FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user AND state = 'idle in transaction'")
    return int(rows[0]["c"]) == 0


def _mail(mail: Any, subject: str, seconds: float = POLL_SECONDS) -> dict:
    def find() -> dict | None:
        return next((m for m in mail.messages(0, 0.2) if m.get("Subject") == subject), None)

    return _poll(find, seconds, f"mail {subject}")


def test_wf_sign_in_and_landing_role_routes(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    screens = {"ines": ("/intake", ("form", "Register exhibit")), "tamsin": ("/compartments", ("searchbox", "Search exhibits")), "noor": ("/compartments", ("searchbox", "Search exhibits")), "sefa": ("/ledger", ("region", "Chain Walk"))}
    for who, (route, (role, name)) in screens.items():
        with _page(browser, app_url, route="/sign-in") as page:
            before = len(_rows(pg, f"action = 'session.opened' AND actor_id = {_q(PEOPLE[who][0])}"))
            _ui_sign_in(page, who)
            expect(page).to_have_url(app_url + route)
            expect(_role(page, role, name)).to_be_visible()
            assert len(_rows(pg, f"action = 'session.opened' AND actor_id = {_q(PEOPLE[who][0])}")) == before + 1
            page.reload()
            expect(page).to_have_url(app_url + route)
            expect(_role(page, role, name)).to_be_visible()
            page.goto(app_url + "/sign-in")
            expect(page).to_have_url(app_url + route)
            page.goto(app_url + route)
            expect(_role(page, role, name)).to_be_visible()
            _btn(page, "Sign out").click()
            expect(page).to_have_url(app_url + "/sign-in")
            page.goto(app_url + route)
            expect(page).to_have_url(re.compile(re.escape("/sign-in?next=")))


def test_wf_sign_in_and_landing_refused_then_recovers(browser: Browser, app_url: str) -> None:
    with _page(browser, app_url, route="/sign-in") as page:
        _ui_sign_in(page, "ines", "not-the-password")
        expect(_role(page, "alert", "Sign-in status")).to_have_text("Email or password is not right.")
        expect(page).to_have_url(app_url + "/sign-in")
        assert page.request.get(app_url + "/api/session").status == 401
        _box(page, "Password").fill(PASSWORD)
        _btn(page, "Sign in").click()
        expect(page).to_have_url(app_url + "/intake")
        assert page.request.get(app_url + "/api/session").json()["user"]["id"] == "USR-03"


def test_wf_sign_in_and_landing_return_after_session(browser: Browser, app_url: str) -> None:
    with _page(browser, app_url, route=f"/exhibits/{EX_SEED}") as page:
        expect(page).to_have_url(re.compile(
            rf"{re.escape(app_url)}/sign-in\?next=(%2F|/)exhibits(%2F|/){re.escape(EX_SEED)}$"))
        expect(_role(page, "alert", "Sign-in status")).to_have_text("Your session has ended.")
        _ui_sign_in(page, "noor")
        expect(page).to_have_url(f"{app_url}/exhibits/{EX_SEED}")
        _figure_is(page, EX_SEED)
    with _page(browser, app_url, route="/sign-in?next=https%3A%2F%2Fevil.example%2F") as page:
        _ui_sign_in(page, "noor")
        expect(page).to_have_url(app_url + "/compartments")


def test_sign_in_refusal_indistinguishable(app_url: str) -> None:
    def attempt(email: str) -> tuple[httpx.Response, float]:
        start = time.monotonic()
        response = httpx.post(f"{app_url}/api/sign-in", json={"email": email, "password": "not-the-password"}, timeout=HTTP_TIMEOUT)
        return response, time.monotonic() - start

    known = [attempt(PEOPLE["mbali"][2]) for _ in range(4)]
    unknown = [attempt(unique("nobody")[1]) for _ in range(4)]
    for response, _ in known + unknown:
        assert response.status_code == 401
        assert response.json() == {"error": "sign_in_failed"}
    names = {tuple(sorted(k for k in r.headers if k.lower() != "Retry-After".lower())) for r, _ in known + unknown}
    assert len(names) == 1, names
    assert abs(statistics.median(t for _, t in known) - statistics.median(t for _, t in unknown)) < TIMING_GAP_S
    assert Api(app_url, "mbali").session_id


def test_sign_in_lockout(app_url: str) -> None:
    base, pg = _short(), Postgres("_short")
    auditor_signals = lambda target: [s for s in _ok(Api(base, "sefa").get("/api/signals"))["signals"] if s["kind"] == "sign_in_lockout" and s["target"] == target]
    kofi = Api(base)
    _poll(lambda: kofi.sign_in(email=PEOPLE["kofi"][2]).status_code == 200, LOCKOUT_SECONDS + 5, "kofi unlocked")
    unknown_email = unique("nobody")[1]
    unknown_target = "email:" + hashlib.sha256(unknown_email.strip().lower().encode()).hexdigest()
    for email, target in ((PEOPLE["kofi"][2], "USR-04"), (unknown_email, unknown_target)):
        entries, signals = _count(pg, "signin.locked", target), len(auditor_signals(target))
        for _ in range(5):
            _refused(httpx.post(f"{base}/api/sign-in", json={"email": email, "password": "not-the-password"}, timeout=HTTP_TIMEOUT), 401, "sign_in_failed")
        for _ in range(2):
            locked = httpx.post(f"{base}/api/sign-in", json={"email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
            _refused(locked, 429, "sign_in_locked")
            assert 0 < int(locked.headers["Retry-After"]) <= LOCKOUT_SECONDS
        rows = _rows(pg, f"action = 'signin.locked' AND target = {_q(target)}")
        assert len(rows) == entries + 1
        assert rows[-1]["actor_id"] == "system" and rows[-1]["session_id"] is None
        assert len(auditor_signals(target)) == signals + 1
    _poll(lambda: kofi.sign_in(email=PEOPLE["kofi"][2]).status_code == 200, LOCKOUT_SECONDS + 5, "lockout ends")


def test_session_revocation(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url, extra=("dmitri",))
    leaving = Api(app_url, "dmitri")
    assert leaving.post("/api/sign-out").status_code == 204
    _refused(leaving.get("/api/session"), 401, "unauthenticated")
    closed = _rows(pg, f"action = 'session.closed' AND target = {_q(leaving.session_id)}")
    assert len(closed) == 1 and closed[0]["detail"]["reason"] == "signed_out"
    one, two = Api(app_url, "dmitri"), Api(app_url, "dmitri")
    revoked = _ok(w.lead.act("POST", _revoke_path("USR-07")))
    assert revoked["revoked"] >= 2
    _refused(one.get("/api/session"), 401, "unauthenticated")
    _refused(two.get(f"/api/compartments/{w.cid}"), 401, "unauthenticated")
    rows = _rows(pg, "action = 'session.revoked' AND target = 'USR-07'")
    assert rows[-1]["actor_id"] == "USR-01" and rows[-1]["detail"]["revoked"] == revoked["revoked"]
    auditor = Api(app_url, "sefa")
    proof = w.lead.proof()
    _refused(w.lead.post(_revoke_path("USR-09"), proof=proof), 403, "forbidden")
    assert auditor.get("/api/session").status_code == 200
    _refused(w.noor.act("POST", _revoke_path("USR-07")), 403, "forbidden")
    _refused(w.lead.act("POST", _revoke_path("USR-99")), 404, "not_found")


def test_safe_return(app_url: str) -> None:
    honoured = [f"/compartments/{CMP_SEED}", f"/exhibits/{EX_SEED}", f"/releases/{REL_SEED}", "/reviews"]
    refused = ["https://evil.example/", "/" * 2 + "evil.example", "/\\evil.example", "/%2Fevil.example", "/%252Fevil.example", "/compartments?x=1", "/compartments#x", "/compartments/../ledger", "/ledger", "/ledger/review", "/audit/chain", "/intake", "/sign-in", f"/l/{SEED_LINK}", "/settings", "/exhibits/nonsense", "compartments", "/compartments/CMP-0001/"]
    lead = Api(app_url)
    for address in honoured:
        assert _ok(lead.sign_in(email=PEOPLE["tamsin"][2], next=address))["landing"] == address
    for address in refused:
        assert _ok(lead.sign_in(email=PEOPLE["tamsin"][2], next=address))["landing"] == "/compartments", address
    officer = Api(app_url)
    assert _ok(officer.sign_in(email=PEOPLE["ines"][2], next="/reviews"))["landing"] == "/intake"
    auditor = Api(app_url)
    assert _ok(auditor.sign_in(email=PEOPLE["sefa"][2], next="/ledger/review"))["landing"] == "/ledger/review"


def test_idle_expiry(app_url: str) -> None:
    base, pg = _idle(), Postgres("_idle")
    quiet, busy = Api(base, "noor"), Api(base, "dmitri")
    started = time.monotonic()

    def quiet_ended() -> bool:
        assert busy.get("/api/session").status_code == 200
        return quiet.get("/api/session", headers={"X-Wardline-Background": "1"}).status_code == 401

    _poll(quiet_ended, IDLE_SECONDS + 3, "idle end")
    elapsed = time.monotonic() - started
    assert elapsed >= IDLE_SECONDS - 1, f"ended after {elapsed}"
    _refused(quiet.get("/api/session"), 401, "unauthenticated")
    entry = _poll(lambda: _rows(pg, f"action = 'session.closed' AND target = {_q(quiet.session_id)}"), SWEEP_S + 2, "closing entry")
    assert len(entry) == 1 and entry[0]["detail"]["reason"] == "idle"
    silent = Api(base, "yuki")
    entry = _poll(lambda: _rows(pg, f"action = 'session.closed' AND target = {_q(silent.session_id)}"), IDLE_SECONDS + SWEEP_S + 2, "closing entry without a request")
    assert entry[0]["detail"]["reason"] == "idle"


def test_step_up_proof(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    exhibits = [_quarantined(w)["id"] for _ in range(5)]
    first = exhibits.pop()
    path = f"/api/exhibits/{first}/refuse"
    denied = _count(pg, "access.denied", first)
    _refused(w.kofi.post(path, {"reason": GOOD_REASON}), 403, "step_up_required")
    _refused(w.kofi.post(path, {"reason": GOOD_REASON}, proof="not a proof \u00e9".encode()), 403, "step_up_required")
    rows = _rows(pg, f"action = 'access.denied' AND target = {_q(first)}")
    assert len(rows) == denied + 2 and rows[-1]["detail"]["code"] == "step_up_required"
    _refused(w.kofi.post("/api/step-up", {"password": PASSWORD, "code": "000000" if _totp("kofi") != "000000" else "111111"}), 403, "step_up_failed")
    _refused(w.kofi.post("/api/step-up", {"password": "not-the-password", "code": _totp("kofi")}), 403, "step_up_failed")
    proof = w.kofi.proof()
    other_session = Api(app_url, "kofi")
    _refused(other_session.post(path, {"reason": GOOD_REASON}, proof=proof), 403, "step_up_required")
    assert w.kofi.post(path, {"reason": "short"}, proof=proof).status_code == 422
    assert _ok(w.kofi.post(path, {"reason": GOOD_REASON}, proof=proof))["state"] == "refused"
    _refused(w.kofi.post(path, {"reason": GOOD_REASON}, proof=proof), 403, "step_up_required")
    shared = w.kofi.proof()
    with concurrent.futures.ThreadPoolExecutor(len(exhibits)) as pool:
        answers = list(pool.map(lambda e: w.kofi.post(f"/api/exhibits/{e}/refuse", {"reason": GOOD_REASON}, proof=shared), exhibits))
    assert sorted(a.status_code for a in answers) == [200, 403, 403, 403]
    assert sum(_ok(w.kofi.get(f"/api/exhibits/{e}"))["state"] == "refused" for e in exhibits) == 1


def test_step_up_expiry_and_lock(app_url: str) -> None:
    base, pg = _short(), Postgres("_short")
    kofi = Api(base, "kofi")
    courier = "EX-0003"
    refuse = f"/api/exhibits/{courier}/refuse"
    proof, started = kofi.proof(), time.monotonic()
    assert kofi.post(refuse, {"reason": "short"}, proof=proof).status_code == 422

    def lapsed() -> bool:
        answer = kofi.post(refuse, {"reason": "short"}, proof=proof)
        return answer.status_code == 403

    _poll(lapsed, STEP_UP_TTL_SECONDS + 3, "proof lapse")
    assert time.monotonic() - started >= STEP_UP_TTL_SECONDS - 1
    mbali = Api(base, "mbali")
    before = _count(pg, "signin.locked", "USR-05")
    for _ in range(5):
        _refused(mbali.post("/api/step-up", {"password": "not-the-password", "code": "000000"}), 403, "step_up_failed")
    locked = mbali.post("/api/step-up", {"password": PASSWORD, "code": _totp("mbali")})
    _refused(locked, 429, "sign_in_locked")
    assert "Retry-After" in locked.headers
    rows = _rows(pg, "action = 'signin.locked' AND target = 'USR-05'")
    assert len(rows) == before + 1 and rows[-1]["actor_id"] == "USR-05" and rows[-1]["session_id"] == mbali.session_id
    _poll(lambda: mbali.post("/api/step-up", {"password": PASSWORD, "code": _totp("mbali")}).status_code == 201, LOCKOUT_SECONDS + 5, "step-up unlock")


def test_wf_exhibit_registration_happy(browser: Browser, app_url: str) -> None:
    pg, bucket = Postgres(), S3()
    w = _world(app_url)
    payload, title = _png(50, 40, (9, 120, 200)), unique("Registered")[0]
    digest = hashlib.sha256(payload).hexdigest()
    keys = set(bucket.keys("originals/"))
    with _page(browser, app_url, "ines", "/intake") as page:
        _fill_intake(page, w.name, title, payload)
        _box(page, "Capture notes").fill(CAPTURE_NOTE)
        _btn(page, "Register exhibit").click()
        status = _status(page, "Intake status")
        expect(status).to_have_text(_published(SEALED_COPY))
        exhibit_id = re.search(r"EX-\d+", status.inner_text()).group()
        row = _role(page, "table", "Quarantine").get_by_role("row").filter(has=_role(page, "link", exhibit_id))
        expect(row).to_contain_text(digest)
        _poll(lambda: _marked(row, "data-seal-mark"), UI_MS / 1000, "closed link mark")
        assert _marked(row, "data-seal-mark")[0]["width"] > 0
        expect(_btn(row, f"Clear {exhibit_id}")).to_be_visible()
        expect(_box(page, "Exhibit name")).to_have_value("")
        expect(_box(page, "Source")).to_have_value("")
        assert page.get_by_label("File", exact=True).evaluate("e => e.files.length") == 0
    exhibit = _ok(w.ines.get(f"/api/exhibits/{exhibit_id}"))
    assert (exhibit["state"], exhibit["sealed"], exhibit["sha256"], exhibit["size"], exhibit["sniffed_type"]) == ("quarantined", True, digest, len(payload), "image/png")
    assert exhibit["provenance"]["capture_notes"] == CAPTURE_NOTE
    new_keys = set(bucket.keys("originals/")) - keys
    assert len(new_keys) == 1 and bucket.get(new_keys.pop()) == payload
    entry = _rows(pg, f"action = 'exhibit.sealed' AND target = {_q(exhibit_id)}")
    assert len(entry) == 1 and entry[0]["actor_id"] == "USR-03" and digest in json.dumps(entry[0]["detail"]) and len(payload) in entry[0]["detail"].values()


def test_wf_exhibit_registration_refusal_recovers(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    title = unique("Refused")[0]
    with _page(browser, app_url, "ines", "/intake") as page:
        _fill_intake(page, w.name, title, _png(), "PDF document", "exhibit.pdf")
        _box(page, "Exhibit name").fill("")
        _btn(page, "Register exhibit").click()
        summary = _role(page, "alert", "There is a problem")
        expect(summary).to_be_focused()
        expect(_status(page, "Intake status")).to_contain_text("This field is required.")
        expect(summary.get_by_role("link")).to_have_count(2)
        summary.get_by_role("link", name="This field is required.").click()
        expect(_box(page, "Exhibit name")).to_be_focused()
        _box(page, "Exhibit name").fill(title)
        assert _by_name(w.ines, w.cid, title) == []
        expect(summary).to_be_visible()
        _btn(page, "Register exhibit").click()
        expect(_status(page, "Intake status")).to_have_text("The declared type does not match the file.")
        expect(summary.get_by_role("link")).to_have_count(1)
        select(_role(page, "combobox", "Declared type"), "PNG image")
        expect(summary).to_be_visible()
        _btn(page, "Register exhibit").click()
        expect(_status(page, "Intake status")).to_have_text(_published(SEALED_COPY))
        expect(summary).to_have_count(0)
    assert len(_by_name(w.ines, w.cid, title)) == 1


def test_wf_exhibit_registration_connection_lost(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    title, keys = unique("Lost")[0], []
    lose = [True]

    def handle(route: Any) -> None:
        key = {k.lower(): v for k, v in route.request.headers.items()}.get("Idempotency-Key".lower())
        if route.request.method != "POST" or key is None:
            route.continue_()
            return
        keys.append(key)
        if lose[0]:
            lose[0] = False
            route.fetch()
            route.abort("connectionfailed")
        else:
            route.continue_()

    with _page(browser, app_url, "ines", "/intake") as page:
        page.route(re.compile(r"/api/compartments/[^/]+/exhibits$"), handle)
        _fill_intake(page, w.name, title)
        _btn(page, "Register exhibit").click()
        expect(_status(page, "Intake status")).to_have_text("Connection lost. Press Register exhibit to try again; it will not create a second exhibit.")
        expect(_box(page, "Exhibit name")).to_have_value(title)
        expect(_box(page, "Source")).to_have_value("Seed record")
        assert page.get_by_label("File", exact=True).evaluate("e => e.files.length") == 1
        _btn(page, "Register exhibit").click()
        expect(_status(page, "Intake status")).to_have_text(_published(SEALED_COPY))
    assert len(keys) == 2 and keys[0] == keys[1]
    assert len(_by_name(w.ines, w.cid, title)) == 1


OVER_LIMIT = "over_limit"
AT_LIMIT = "at_limit"
DIGEST_DIFFERS = "digest_differs"
UPLOAD_CASES = {
    "declared_differs": ("png", "application/pdf", "a.pdf", "The declared type does not match the file."),
    "svg_bytes": ("svg", "image/png", "a.png", "This file type is not accepted."),
    "html_bytes": ("html", "application/pdf", "a.pdf", "This file type is not accepted."),
    "declared_off_list": ("png", "image/svg+xml", "a.svg", "This file type is not accepted."),
    "path_separator": ("png", "image/png", "dir/a.png", "This file name is not accepted."),
    "dot_dot": ("png", "image/png", "..a.png", "This file name is not accepted."),
    "digest_differs": ("png", "image/png", "a.png", "The file does not match the submitted digest."),
    "over_limit": ("big", "image/png", "a.png", ""),
    "at_limit": ("limit", "image/png", "a.png", ""),
}


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=list(UPLOAD_CASES))
def test_upload_refusals(app_url: str, case: str) -> None:
    source, declared, filename, copy = UPLOAD_CASES[case]
    w, bucket = _world(app_url), S3()
    small = _png()
    files = {"png": small, "svg": b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', "html": b"<!doctype html><html><script>1</script></html>"}
    if case in (OVER_LIMIT, AT_LIMIT):
        files[source] = small + b"\0" * (MAX_FILE - len(small) + (1 if case == OVER_LIMIT else 0))
    extra = {"submitted_sha256": "0" * 64} if case == DIGEST_DIFFERS else {}
    before = set(bucket.keys("originals/"))
    response = _upload(w.ines, w.cid, files[source], declared, filename, **extra)
    if case == AT_LIMIT:
        body = _ok(response, 201)
        assert body["size"] == MAX_FILE and body["sha256"] == hashlib.sha256(files[source]).hexdigest()
        return
    if case == OVER_LIMIT:
        assert response.status_code == 413 and response.json() == {"error": "file_too_large", "max_bytes": MAX_FILE}
    else:
        assert response.status_code == 422
        assert response.json() == {"errors": {"file": copy}}
    assert _ok(w.ines.get(f"/api/compartments/{w.cid}/exhibits"))["exhibits"] == []
    assert set(bucket.keys("originals/")) == before


def test_registration_all_or_nothing(app_url: str) -> None:
    w, bucket, pg = _world(app_url), S3(), Postgres()
    payload = _png(20, 20, (1, 2, 3))
    before = set(bucket.keys("originals/"))
    body = _ok(_upload(w.ines, w.cid, payload), 201)
    assert body["sealed"] is True and body["state"] == "quarantined" and body["sha256"] == hashlib.sha256(payload).hexdigest()
    new = set(bucket.keys("originals/")) - before
    assert len(new) == 1 and bucket.get(next(iter(new))) == payload
    entries = len(_rows(pg, "action = 'exhibit.sealed'"))
    keys = set(bucket.keys("originals/"))
    _refused(_upload(Api(_storage_down(), "ines"), w.cid, payload), 503, "storage_unavailable")
    connection = _partial_upload(w.ines, w.cid)
    connection.close()
    _poll(lambda: set(bucket.keys("originals/")) == keys, RELEASE_S + 2, "dropped upload removed")
    _holds(lambda: None, 0)
    assert [e["id"] for e in _ok(w.ines.get(f"/api/compartments/{w.cid}/exhibits"))["exhibits"]] == [body["id"]]
    assert len(_rows(pg, "action = 'exhibit.sealed'")) == entries


def test_original_byte_identical(app_url: str) -> None:
    w, bucket = _world(app_url), S3()
    text_chunk = _png_chunk(b"tEXt", b"Camera\0Gatehouse-2")
    cases = [(_png(30, 30, (5, 6, 7), text_chunk, b"TRAILING"), "image/png", "secret-witness.png"), (_pdf([{"text": [(20, 20, "COURIER-NOTE-0093")]}], author="Harrowgate Archive Desk"), "application/pdf", "secret-witness.pdf")]
    for payload, declared, filename in cases:
        before = set(bucket.keys())
        exhibit = _cleared(w, payload, declared, filename, name=unique("Exact")[0])
        added = set(bucket.keys()) - before
        assert len(added) == 1
        key = added.pop()
        assert _random_key(key, "originals/"), key
        assert bucket.get(key) == payload
        assert _download(w.noor, f"/api/exhibits/{exhibit['id']}/download-grants").content == payload
        derivative = _rendered(w, exhibit["id"])
        assert bucket.get(key) == payload
        output = _derivative_bytes(w.noor, derivative["id"])
        assert b"Gatehouse-2" not in output and b"Harrowgate Archive Desk" not in output


def test_registration_replay(app_url: str) -> None:
    w, bucket = _world(app_url), S3()
    payload, key, title = _png(21, 21), unique("key")[0], unique("Replay")[0]
    first = _upload(w.ines, w.cid, payload, key=key, name=title)
    assert first.status_code == 201 and "Idempotent-Replay" not in first.headers
    keys = set(bucket.keys("originals/"))
    again = _upload(Api(app_url, "ines"), w.cid, payload, key=key, name=title)
    assert again.status_code == 201 and again.json() == first.json() and again.headers["Idempotent-Replay"] == "true"
    _refused(_upload(w.ines, w.cid, _png(22, 22), key=key, name=title), 409, "idempotency_conflict")
    _refused(_upload(w.ines, w.cid, payload, key=key, name=title + "x"), 409, "idempotency_conflict")
    assert set(bucket.keys("originals/")) == keys and len(_by_name(w.ines, w.cid, title)) == 1
    refused_key, retried = unique("key")[0], unique("Retried")[0]
    assert _upload(w.ines, w.cid, payload, "application/pdf", "a.pdf", key=refused_key, name=retried).status_code == 422
    assert _upload(w.ines, w.cid, payload, key=refused_key, name=retried).status_code == 201
    together, name = unique("key")[0], unique("Together")[0]
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: _upload(w.ines, w.cid, payload, key=together, name=name), range(6)))
    assert {a.status_code for a in answers} == {201}
    assert len({a.json()["id"] for a in answers}) == 1 and len(_by_name(w.ines, w.cid, name)) == 1
    bad = _upload(w.ines, w.cid, payload, key="k" * 129)
    assert bad.status_code == 422 and bad.json()["errors"]["idempotency_key"] == "This key cannot be used."


def test_intake_announcements(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    title = unique("Progress")[0]
    payload = _png() + b"\0" * UPLOAD_PROBE_BYTES
    with _page(browser, app_url, "ines", "/intake") as page:
        status = _status(page, "Intake status")
        _record(status, "intake")
        cdp = session(page)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0, "downloadThroughput": -1, "uploadThroughput": UPLOAD_THROTTLE})
        _fill_intake(page, w.name, title, payload)
        _btn(page, "Register exhibit").click()
        bar = _role(page, "progressbar", "Upload progress")
        expect(bar).to_be_visible()
        assert bar.get_attribute("aria-valuemin") in ("0", None) and bar.get_attribute("aria-valuemax") in ("100", None)
        values = []

        def done() -> bool:
            if bar.count():
                with contextlib.suppress(Exception):
                    values.append(float(bar.evaluate("e => e.getAttribute('aria-valuenow') ?? e.value", timeout=500)))
            return status.inner_text().startswith("Sealed")

        _poll(done, 60, "seal")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1})
        assert any(0 < v < 100 for v in values), values
        assert values == sorted(values), values
        seen = _seen(page, "intake")
        steps = [t for t in seen if t.startswith("Uploading") or t == "Confirming storage."]
        assert steps == [f"Uploading {p} percent." for p in (0, 25, 50, 75, 100)] + ["Confirming storage."], seen
        assert seen[-1].startswith("Sealed")
        expect(bar).to_have_count(0)
        _fill_intake(page, w.name, unique("Big")[0], _png() + b"\0" * MAX_FILE)
        _btn(page, "Register exhibit").click()
        expect(status).to_have_text("This file is over the 20,000,000 byte limit.")
        expect(_role(page, "alert", "There is a problem")).to_contain_text("This file is over the 20,000,000 byte limit.")


def test_resume_registration_after_session_end(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    title, sent = unique("Resume")[0], []
    with _page(browser, app_url, "ines", "/intake") as page:
        page.on("request", lambda r: sent.append(r.headers.get("Idempotency-Key".lower())) if r.method == "POST" and r.url.endswith("/exhibits") else None)
        _fill_intake(page, w.name, title)
        _ok(w.lead.act("POST", _revoke_path("USR-03")))
        dialog = _role(page, "dialog", "Sign in again")
        expect(dialog).to_be_visible(timeout=SIGN_IN_AGAIN_MS)
        expect(page).to_have_url(app_url + "/intake")
        expect(_status(dialog, "Sign-in again status")).to_have_text("Your session has ended. Sign in to finish what you were doing.")
        email = _box(dialog, "Email")
        expect(email).to_have_value(PEOPLE["ines"][2])
        expect(email).not_to_be_editable()
        expect(_box(dialog, "Password")).to_be_focused()
        _box(dialog, "Password").fill("not-the-password")
        _btn(dialog, "Sign in").click()
        expect(_status(dialog, "Sign-in again status")).to_have_text("Email or password is not right.")
        _box(dialog, "Password").fill(PASSWORD)
        _btn(dialog, "Sign in").click()
        expect(dialog).to_have_count(0)
        expect(_box(page, "Exhibit name")).to_have_value(title)
        assert page.get_by_label("File", exact=True).evaluate("e => e.files.length") == 1
        _ok(w.lead.act("POST", _revoke_path("USR-03")))
        before = len(sent)
        try:
            _btn(page, "Register exhibit").click()
        except Exception:
            pass
        dialog = _role(page, "dialog", "Sign in again")
        expect(dialog).to_be_visible(timeout=SIGN_IN_AGAIN_MS)
        reached = len(sent) > before
        _box(dialog, "Password").fill(PASSWORD)
        _btn(dialog, "Sign in").click()
        if not reached:
            expect(dialog).to_have_count(0)
            _btn(page, "Register exhibit").click()
        expect(_status(page, "Intake status")).to_have_text(_published(SEALED_COPY))
    assert sent and len(set(sent)) == 1, sent
    assert len(_by_name(w.lead, w.cid, title)) == 1


def test_resume_marks_and_step_up_after_session_end(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w)
    puts = []
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}") as page:
        page.on("request", lambda r: puts.append(json.loads(r.post_data)) if r.method == "PUT" else None)
        expect(_status(page, "Redaction status")).to_have_text("Preview loaded.")
        _btn(page, "Add region").click()
        _ok(w.lead.act("POST", _revoke_path("USR-06")))
        _btn(page, "Save marks").click()
        dialog = _role(page, "dialog", "Sign in again")
        expect(dialog).to_be_visible(timeout=SIGN_IN_AGAIN_MS)
        _box(dialog, "Password").fill(PASSWORD)
        _btn(dialog, "Sign in").click()
        expect(_status(page, "Redaction status")).to_have_text("Marks saved.")
    assert len(puts) >= 1 and all(p == puts[0] for p in puts)
    assert _ok(Api(app_url, "noor").get(f"/api/exhibits/{exhibit['id']}/redactions"))["regions"] == [{"page": 1, "x": 100, "y": 100, "w": 200, "h": 100}]
    noor = Api(app_url, "noor")
    w.noor = noor
    release = _submitted(w)
    proofs, decisions = [], []
    with _page(browser, app_url, "rafael", f"/releases/{release['id']}") as page:
        page.on("request", lambda r: proofs.append(r.url) if r.url.endswith("/api/step-up") else None)
        page.on("request", lambda r: decisions.append(r.headers.get("X-Step-Up-Proof".lower())) if r.url.endswith("/reject") else None)
        _btn(page, "Reject").click()
        step_up = _role(page, "dialog", "Step-up")
        _box(step_up, "Reason").fill(GOOD_REASON)
        _box(step_up, "Password").fill("typed but not sent")
        _ok(w.lead.act("POST", _revoke_path("USR-02")))
        again = _role(page, "dialog", "Sign in again")
        expect(again).to_be_visible(timeout=SIGN_IN_AGAIN_MS)
        _box(again, "Password").fill(PASSWORD)
        _btn(again, "Sign in").click()
        expect(again).to_have_count(0)
        expect(_box(step_up, "Reason")).to_have_value(GOOD_REASON)
        expect(_box(step_up, "Password")).to_have_value("")
        expect(_box(step_up, "Authenticator code")).to_have_value("")
        expect(_box(step_up, "Password")).to_be_focused()
        assert decisions == [] and proofs == []
        _step_up(page, "rafael")
        expect(_status(page, "Action status")).to_have_text(f"Rejected {release['id']}. Assembler notice queued.")
    assert len(proofs) == 1 and len(decisions) == 1


def test_wf_quarantine_clearance_second_officer(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    first, second = _quarantined(w), _quarantined(w)
    proof = w.ines.proof()
    _refused(w.ines.post(f"/api/exhibits/{first['id']}/clear", proof=proof), 403, "separation_of_duties")
    assert _ok(w.ines.get(f"/api/exhibits/{first['id']}"))["state"] == "quarantined"
    with _page(browser, app_url, "ines", "/intake") as page:
        _btn(page, f"Clear {first['id']}").click()
        _step_up(page, "ines")
        expect(_status(page, "Action status")).to_have_text("You registered this exhibit, so another officer must decide it.")
    with _page(browser, app_url, "kofi", "/intake") as page:
        table = _role(page, "table", "Quarantine")
        expect(table.get_by_role("row").filter(has=_role(page, "link", first["id"]))).to_contain_text(first["sha256"])
        _btn(table, f"Clear {first['id']}").click()
        _step_up(page, "kofi")
        expect(_status(page, "Action status")).to_have_text(f"Cleared {first['id']}.")
        expect(_role(table, "link", first["id"])).to_have_count(0)
        expect(_role(table, "link", second["id"])).to_be_visible()
    assert _ok(w.kofi.get(f"/api/exhibits/{first['id']}"))["state"] == "cleared"
    assert _ok(w.kofi.get(f"/api/compartments/{w.cid}"))["quarantine_count"] == 1
    entry = _rows(pg, f"action = 'exhibit.cleared' AND target = {_q(first['id'])}")
    assert len(entry) == 1 and entry[0]["actor_id"] == "USR-04"


def test_wf_quarantine_clearance_refuse_with_reason(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _quarantined(w)
    with _page(browser, app_url, "kofi", "/intake") as page:
        _btn(page, f"Refuse {exhibit['id']}").click()
        _step_up(page, "kofi", "short")
        dialog = _role(page, "dialog", "Step-up")
        expect(dialog).to_contain_text("Write a reason of at least 10 characters.")
        expect(_box(dialog, "Reason")).to_be_focused()
        expect(_box(dialog, "Reason")).to_have_value("short")
        expect(_box(dialog, "Password")).to_have_value("")
        _step_up(page, "kofi", GOOD_REASON)
        expect(_status(page, "Action status")).to_have_text(f"Refused {exhibit['id']}.")
        expect(_role(page, "link", exhibit["id"])).to_have_count(0)
    assert _ok(w.kofi.get(f"/api/exhibits/{exhibit['id']}"))["state"] == "refused"
    _refused(w.noor.post(f"/api/exhibits/{exhibit['id']}/download-grants"), 409, "exhibit_not_cleared")


def test_quarantine_lock(app_url: str) -> None:
    w, pg = _world(app_url), Postgres()
    exhibit = _quarantined(w, _text_pdf("LOCKED-WORDS"), "application/pdf", "a.pdf")
    path = f"/api/exhibits/{exhibit['id']}"
    for api in (w.noor, w.lead):
        for response in (api.post(f"{path}/preview-grants", {"page": 1}), api.post(f"{path}/download-grants"), api.request("PUT", f"{path}/redactions", {"regions": [REGION], "marks_version": 0}), api.post(f"{path}/redactions/find", {"text": "LOCKED"}), api.post(f"{path}/derivatives")):
            assert _refused(response, 409, "exhibit_not_cleared")["state"] == "quarantined"
    assert _refused(w.kofi.post(f"{path}/download-grants"), 409, "exhibit_not_cleared")["state"] == "quarantined"
    assert _ok(w.noor.get(f"{path}/derivatives"))["derivatives"] == []
    assert _rows(pg, f"action = 'redaction.saved' AND target = {_q(exhibit['id'])}") == []
    _ok(w.kofi.act("POST", f"{path}/refuse", {"reason": GOOD_REASON}))
    assert _refused(w.noor.post(f"{path}/preview-grants", {"page": 1}), 409, "exhibit_not_cleared")["state"] == "refused"
    other = _quarantined(w, _text_pdf("LOCKED-WORDS"), "application/pdf", "a.pdf")
    _ok(w.kofi.act("POST", f"/api/exhibits/{other['id']}/clear"))
    assert _ok(w.noor.post(f"/api/exhibits/{other['id']}/preview-grants", {"page": 1}), 201)["expires_in_seconds"] == 60


def test_attachment_only(app_url: str) -> None:
    w = _world(app_url)
    payload = _png()
    exhibit = _cleared(w, payload, filename=f"{SUBMITTED_NAME}.png")
    derivative = _rendered(w, exhibit["id"])
    token = _ok(w.noor.post(f"/api/exhibits/{exhibit['id']}/preview-grants", {"page": 1}), 201)["token"]
    for response, record in ((_download(w.noor, f"/api/exhibits/{exhibit['id']}/download-grants"), exhibit["id"]), (_claim(w.noor, derivative["id"]), derivative["id"]), (httpx.get(f"{app_url}/api/download/{token}", timeout=HTTP_TIMEOUT), exhibit["id"])):
        assert response.status_code == 200
        disposition = response.headers["Content-Disposition"]
        assert disposition.lower().startswith("attachment") and SUBMITTED_NAME not in disposition
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Content-Type"].startswith("image/png")
        assert response.content[:8] == b"\x89PNG\r\n\x1a\n"
    filename = _download(w.noor, f"/api/exhibits/{exhibit['id']}/download-grants").headers["Content-Disposition"]
    assert exhibit["id"] in filename


def test_download_grant_single_claim(app_url: str) -> None:
    w, pg = _world(app_url), Postgres()
    exhibit = _cleared(w)
    token = _ok(w.noor.post(f"/api/exhibits/{exhibit['id']}/download-grants"), 201)["token"]
    before = _count(pg, "download.claimed", exhibit["id"])
    with concurrent.futures.ThreadPoolExecutor(12) as pool:
        answers = list(pool.map(lambda _: httpx.get(f"{app_url}/api/download/{token}", timeout=HTTP_TIMEOUT), range(12)))
    assert sorted(a.status_code for a in answers) == [200] + [404] * 11
    assert [a.json() for a in answers if a.status_code == 404][0] == {"error": "not_found"}
    entries = _rows(pg, f"action = 'download.claimed' AND target = {_q(exhibit['id'])}")
    assert len(entries) == before + 1
    assert entries[-1]["detail"]["sha256"] == exhibit["sha256"] and entries[-1]["detail"]["exhibit_id"] == exhibit["id"] and entries[-1]["detail"]["kind"] == "file"
    second = _ok(w.noor.post(f"/api/exhibits/{exhibit['id']}/download-grants"), 201)["token"]
    _refused(httpx.get(f"{_storage_down()}/api/download/{second}", timeout=HTTP_TIMEOUT), 503, "storage_unavailable")
    assert _count(pg, "download.claimed", exhibit["id"]) == before + 1
    assert httpx.get(f"{app_url}/api/download/{second}", timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.get(f"{app_url}/api/download/{second}", timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.get(f"{app_url}/api/download/%00", timeout=HTTP_TIMEOUT).status_code == 404


def test_seal_recheck(browser: Browser, app_url: str) -> None:
    w, pg, bucket = _world(app_url), Postgres(), S3()
    payload = _png(33, 33)
    before = set(bucket.keys("originals/"))
    exhibit = _quarantined(w, payload)
    key = (set(bucket.keys("originals/")) - before).pop()
    path = f"/api/exhibits/{exhibit['id']}"
    auditor = Api(app_url, "sefa")
    changed = b"changed bytes"
    _s3_write("PUT", key, changed)
    proof = w.kofi.proof()
    answer = _refused(w.kofi.post(f"{path}/clear", proof=proof), 409, "seal_mismatch")
    assert answer["sha256"] == exhibit["sha256"]
    state = _ok(w.kofi.get(path))
    assert state["state"] == "quarantined" and state["seal_check"] == "failed"
    rows = _rows(pg, f"action = 'exhibit.seal_failed' AND target = {_q(exhibit['id'])}")
    assert len(rows) == 1
    detail = rows[0]["detail"]
    assert (detail["sealed_sha256"], detail["sealed_size"], detail["found_sha256"], detail["found_size"]) == (exhibit["sha256"], len(payload), hashlib.sha256(changed).hexdigest(), len(changed))
    signals = [s for s in _ok(auditor.get("/api/signals"))["signals"] if s["kind"] == "seal_mismatch" and s["target"] == exhibit["id"]]
    assert len(signals) == 1
    with _page(browser, app_url, "kofi", "/intake") as page:
        row = _role(page, "table", "Quarantine").get_by_role("row").filter(has=_role(page, "link", exhibit["id"]))
        expect(row).to_contain_text("Seal failed")
        _btn(row, f"Clear {exhibit['id']}").click()
        _step_up(page, "kofi")
        expect(_status(page, "Action status")).to_have_text("Not cleared. The stored file no longer matches its seal.")
    _s3_write("DELETE", key)
    missing = _refused(w.kofi.act("POST", f"{path}/clear"), 409, "seal_mismatch")
    assert missing["sha256"] == exhibit["sha256"]
    last = _rows(pg, f"action = 'exhibit.seal_failed' AND target = {_q(exhibit['id'])}")[-1]["detail"]
    assert last["found_sha256"] is None and last["found_size"] is None
    _s3_write("PUT", key, payload)
    assert _ok(w.kofi.post(f"{path}/clear", proof=proof))["seal_check"] is None


def test_seal_read_holds_no_lock(app_url: str) -> None:
    w, pg = _world(app_url), Postgres()
    exhibit = _quarantined(w, _png() + b"\0" * 3_000_000)
    relay = _s3_relay()
    try:
        with _copy(S3_ENDPOINT=f"http://127.0.0.1:{relay.port}") as (base, _):
            _poll(lambda: _status_json(base)["storage"] == "up", BANNER_MS / 1000, "copy storage up")
            kofi = Api(base, "kofi")
            proof = kofi.proof()
            relay.flow.clear()
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                clearing = pool.submit(kofi.post, f"/api/exhibits/{exhibit['id']}/clear", {}, proof=proof)
                for _ in range(3):
                    started = time.monotonic()
                    _ok(w.lead.post("/api/compartments", {"name": unique("During")[0]}), 201)
                    assert time.monotonic() - started < STALL_ANSWER_S
                    _poll(lambda: _no_open_transactions(pg), STALL_ANSWER_S, "no open transaction")
                relay.flow.set()
                assert clearing.result().status_code < 500
    finally:
        relay.stop()


def test_quarantine_focus(browser: Browser, app_url: str) -> None:
    w = _world(app_url, extra=("mbali",))
    ids = [_quarantined(w)["id"] for _ in range(3)]
    with _page(browser, app_url, "mbali", "/intake") as page:
        table = _role(page, "table", "Quarantine")
        order = [table.get_by_role("link").nth(i).inner_text() for i in range(3)]
        assert sorted(order) == sorted(ids)
        _btn(table, f"Clear {order[0]}").focus()
        _ok(w.kofi.act("POST", f"/api/exhibits/{order[0]}/clear"))
        expect(_role(table, "link", order[0])).to_have_count(0, timeout=LIVE_MS)
        expect(_btn(table, f"Clear {order[1]}")).to_be_focused()
        page.keyboard.press("Enter")
        dialog = _role(page, "dialog", "Step-up")
        expect(dialog).to_be_visible()
        _ok(w.kofi.act("POST", f"/api/exhibits/{order[1]}/clear"))
        expect(_role(table, "link", order[1])).to_have_count(0, timeout=LIVE_MS)
        expect(dialog).to_be_visible()
        _step_up(page, "mbali")
        expect(_status(page, "Action status")).to_have_text("Already decided by someone else.")
        expect(_btn(table, f"Clear {order[2]}")).to_be_focused()
        _ok(w.kofi.act("POST", f"/api/exhibits/{order[2]}/clear"))
        expect(_role(table, "link", order[2])).to_have_count(0, timeout=LIVE_MS)
        expect(table).to_be_focused()


def test_wf_compartment_access_grant_lifecycle(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    lead, member = Api(app_url, "tamsin"), Api(app_url, "dmitri")
    name = unique("Created")[0]
    with _page(browser, app_url, "tamsin", "/compartments") as page:
        _btn(page, "New compartment").click()
        dialog = _role(page, "dialog", "New compartment")
        _box(dialog, "Compartment name").fill(name)
        _btn(dialog, "Create compartment").click()
        expect(_role(page, "navigation", "Compartments").get_by_role("link", name=name)).to_be_visible()
        created = next(c for c in _ok(lead.get("/api/compartments"))["compartments"] if c["name"] == name)
        cid = created["id"]
        assert [r["action"] for r in _rows(pg, f"target = {_q(cid)}")] == ["compartment.created"]
        page.goto(f"{app_url}/compartments/{cid}")
        _btn(page, "Issue grant").click()
        dialog = _role(page, "dialog", "Issue grant")
        select(_role(dialog, "combobox", "Person"), "Dmitri Vance")
        select(_role(dialog, "combobox", "Scope"), "Full")
        _btn(dialog, "Save grant").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text("Grant saved.")
        row = _role(page, "table", "Access list").get_by_role("row").filter(has_text="Dmitri Vance")
        expect(row).to_contain_text("Does not lapse")
        assert _ok(member.get(f"/api/compartments/{cid}"))["caller_scope"] == "full"
        exhibit_world = World(app_url, lead, None, Api(app_url, "ines"), Api(app_url, "kofi"), member, cid, name)
        _grant(lead, cid, "ines")
        _grant(lead, cid, "kofi")
        exhibit = _cleared(exhibit_world)
        page.reload()
        row = _role(page, "table", "Access list").get_by_role("row").filter(has_text="Dmitri Vance")
        _btn(row, "Edit grant for Dmitri Vance").click()
        dialog = _role(page, "dialog", "Edit grant")
        expect(_role(dialog, "combobox", "Person")).to_have_count(0)
        select(_role(dialog, "combobox", "Scope"), "Derivatives only")
        _btn(dialog, "Save grant").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text("Grant saved.")
        _poll(lambda: _ok(member.get(f"/api/compartments/{cid}"))["caller_scope"] == "derivatives",
              LIVE_MS / 1000, "scope narrowed")
        _refused(member.post(f"/api/exhibits/{exhibit['id']}/download-grants"), 404, "not_found")
        _refused(member.post(f"/api/exhibits/{exhibit['id']}/preview-grants", {"page": 1}), 404, "not_found")
        assert _ok(member.get(f"/api/exhibits/{exhibit['id']}"))["provenance"] is None
        _btn(row, "Revoke grant for Dmitri Vance").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text("Grant revoked.")
        expect(row).to_contain_text("revoked")
    _refused(member.get(f"/api/compartments/{cid}"), 404, "not_found")
    grant = next(g for g in _ok(lead.get(f"/api/compartments/{cid}"))["access"] if g["user_id"] == "USR-07")
    assert grant["state"] == "revoked"
    assert [r["action"] for r in _rows(pg, f"target = {_q(grant['id'])}")] == ["grant.issued", "grant.edited", "grant.revoked"]


def test_wf_compartment_access_derivatives_view(browser: Browser, app_url: str) -> None:
    w = _world(app_url, extra=())
    _grant(w.lead, w.cid, "yuki", "derivatives")
    exhibit = _cleared(w)
    derivative = _rendered(w, exhibit["id"])
    requests: list[str] = []
    with _page(browser, app_url, "yuki") as page:
        page.on("request", lambda r: requests.append(r.url))
        page.goto(f"{app_url}/exhibits/{exhibit['id']}")
        expect(_btn(_role(page, "table", "Derivatives"), f"Download {derivative['id']}")).to_be_visible()
        expect(_role(page, "group", "Redaction regions")).to_have_count(0)
        expect(_btn(page, "Download original")).to_have_count(0)
        expect(page.get_by_text("Seed record")).to_have_count(0)
        expect(_role(page, "region", "Custody timeline")).to_have_count(0)
    assert not [u for u in requests if re.search(r"/(preview-grants|redactions|custody)", u)]
    assert not [u for u in requests if u.endswith(f"/exhibits/{exhibit['id']}/download-grants")]


def test_wf_compartment_access_revoked_on_open_page(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w)
    release = _assembling(w)
    grant = next(g for g in _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access"] if g["user_id"] == "USR-06")
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}") as page, _page(browser, app_url, "noor", f"/releases/{release['id']}") as other:
        expect(_role(page, "group", "Redaction regions")).to_be_visible()
        version = _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access_version"]
        _ok(w.lead.act("PATCH", f"/api/grants/{grant['id']}", {"scope": "derivatives", "expires_at": None, "access_version": version}))
        expect(_role(page, "alert", "Access changed")).to_have_text("Your access to this compartment has changed to derivatives only.", timeout=LIVE_MS)
        expect(_role(page, "group", "Redaction regions")).to_have_count(0)
        expect(_btn(page, "Download original")).to_have_count(0)
        expect(_role(page, "table", "Derivatives")).to_be_visible()
        _btn(other, "Submit release").click()
        dialog = _role(other, "dialog", "Step-up")
        _box(dialog, "Password").fill("typed text")
        _ok(w.lead.act("POST", f"/api/grants/{grant['id']}/revoke"))
        _refused(w.noor.get(f"/api/exhibits/{exhibit['id']}"), 404, "not_found")
        for open_page, record in ((page, exhibit["sha256"]), (other, release["id"])):
            notice = _role(open_page, "alert", "Access ended")
            expect(notice).to_have_text("Your access to this compartment has ended.", timeout=LIVE_MS)
            expect(notice).to_be_focused()
            expect(open_page.get_by_text(record)).to_have_count(0)
            expect(_role(open_page, "table", "Derivatives")).to_have_count(0)
            expect(open_page.get_by_role("link", name=w.name)).to_have_count(0, timeout=LIVE_MS)
        expect(dialog).to_have_count(0)


def test_serialised_grant_writes(app_url: str) -> None:
    w = _world(app_url, extra=("dmitri",))
    access = _ok(w.lead.get(f"/api/compartments/{w.cid}"))
    version = access["access_version"]
    grant = next(g for g in access["access"] if g["user_id"] == "USR-07")
    proofs = [w.lead.proof(), w.lead2.proof()]
    body = {"scope": "derivatives", "expires_at": None, "access_version": version}
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda pair: pair[0].request("PATCH", f"/api/grants/{grant['id']}", body, proof=pair[1]), zip((w.lead, w.lead2), proofs)))
    assert sorted(a.status_code for a in answers) == [200, 409]
    loser = next(a for a in answers if a.status_code == 409).json()
    assert loser == {"error": "stale_access_list", "access_version": version + 1}
    _ok(w.lead.act("POST", f"/api/grants/{grant['id']}/revoke"))
    current = _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access_version"]
    assert current == version + 2
    stale = _refused(w.lead.act("PATCH", f"/api/grants/{grant['id']}", {"scope": "full", "expires_at": None, "access_version": version}), 409, "stale_access_list")
    assert stale["access_version"] == current
    _refused(w.lead.act("PATCH", f"/api/grants/{grant['id']}", {"scope": "full", "expires_at": None, "access_version": current}), 409, "grant_not_active")
    _refused(w.lead.act("POST", f"/api/grants/{grant['id']}/revoke"), 409, "grant_not_active")
    assert next(g for g in _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access"] if g["id"] == grant["id"])["state"] == "revoked"
    _refused(Api(app_url, "dmitri").get(f"/api/compartments/{w.cid}"), 404, "not_found")
    other = _grant(w.lead, w.cid, "dmitri")
    assert other["id"] != grant["id"]
    _refused(w.lead.act("POST", f"/api/compartments/{w.cid}/grants", {"user_id": "USR-07", "scope": "full", "expires_at": None, "access_version": _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access_version"]}), 409, "grant_exists")
    proofs = [w.lead.proof(), w.lead2.proof()]
    version = _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access_version"]
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        edit = pool.submit(w.lead.request, "PATCH", f"/api/grants/{other['id']}", {"scope": "derivatives", "expires_at": None, "access_version": version}, proofs[0])
        revoke = pool.submit(w.lead2.post, f"/api/grants/{other['id']}/revoke", {}, proof=proofs[1])
    assert revoke.result().status_code == 200 and edit.result().status_code in (200, 409)
    assert next(g for g in _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access"] if g["id"] == other["id"])["state"] == "revoked"


def test_last_case_lead(app_url: str) -> None:
    pg = Postgres()
    lead = Api(app_url, "tamsin")
    cid = _ok(lead.post("/api/compartments", {"name": unique("Lone")[0]}), 201)["id"]
    own = _ok(lead.get(f"/api/compartments/{cid}"))["access"][0]
    version = _ok(lead.get(f"/api/compartments/{cid}"))["access_version"]
    proof = lead.proof()
    _refused(lead.post(f"/api/grants/{own['id']}/revoke", proof=proof), 409, "last_case_lead")
    _refused(lead.request("PATCH", f"/api/grants/{own['id']}", {"scope": "derivatives", "expires_at": None, "access_version": version}, proof=proof), 409, "last_case_lead")
    _refused(lead.request("PATCH", f"/api/grants/{own['id']}", {"scope": "full", "expires_at": _server_time(lead, 3600), "access_version": version}, proof=proof), 409, "last_case_lead")
    _grant(lead, cid, "noor")
    version = _ok(lead.get(f"/api/compartments/{cid}"))["access_version"]
    second = _grant(lead, cid, "rafael", expires_at=_server_time(lead, 3600))
    _refused(lead.act("POST", f"/api/grants/{own['id']}/revoke"), 409, "last_case_lead")
    version = _ok(lead.get(f"/api/compartments/{cid}"))["access_version"]
    _ok(lead.act("PATCH", f"/api/grants/{second['id']}", {"scope": "full", "expires_at": None, "access_version": version}))
    rafael = Api(app_url, "rafael")
    proofs = {"t": lead.proof(), "r": rafael.proof()}
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        first = pool.submit(lead.post, f"/api/grants/{second['id']}/revoke", {}, proof=proofs["t"])
        other = pool.submit(rafael.post, f"/api/grants/{own['id']}/revoke", {}, proof=proofs["r"])
    answers = sorted((first.result().status_code, other.result().status_code))
    assert answers == [200, 404]
    loser, target = (lead, second["id"]) if first.result().status_code == 404 else (rafael, own["id"])
    denial = _rows(pg, f"action = 'access.denied' AND actor_id = {_q(loser.user_id)} AND target = {_q(target)}")
    assert len(denial) == 1 and denial[0]["detail"]["code"] == "not_found"


def test_live_view_in_place(browser: Browser, app_url: str) -> None:
    w = _world(app_url, extra=())
    with _page(browser, app_url, "tamsin", f"/compartments/{w.cid}") as page:
        page.evaluate("window.__sameDocument = true")
        table = _role(page, "table", "Access list")
        kept = table.get_by_role("row").filter(has_text="Noor Halloran")
        expect(kept).to_be_visible()
        _same_node_tag(kept)
        focused = _btn(kept, "Edit grant for Noor Halloran")
        focused.focus()
        scroll = page.evaluate("window.scrollY")
        totals = _status(page, "Compartment totals")
        expect(totals).to_have_text(_totals_copy(0, 0))
        _quarantined(w)
        _grant(w.lead2, w.cid, "dmitri")
        expect(totals).to_have_text(_totals_copy(1, 0), timeout=LIVE_MS)
        assert _marked(totals, "data-quarantine-count")[0]["text"] == "1"
        expect(table.get_by_role("row").filter(has_text="Dmitri Vance")).to_be_visible(timeout=LIVE_MS)
        assert kept.evaluate("el => el.__kept === true")
        expect(focused).to_be_focused()
        assert page.evaluate("window.scrollY") == scroll and page.evaluate("window.__sameDocument") is True
        derivative = _rendered(w)
        release = _assembling(w, derivative)
        expect(totals).to_have_text(_totals_copy(1, release["total_bytes"]), timeout=LIVE_MS)
        focused.click()
        dialog = _role(page, "dialog", "Edit grant")
        lapse = _server_time(w.lead, 3600)
        _box(dialog, "Lapses at").fill(lapse)
        select(_role(dialog, "combobox", "Scope"), "Derivatives only")
        _grant(w.lead2, w.cid, "mbali")
        _btn(dialog, "Save grant").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text("Someone else changed this access list. Review it and try again.")
        expect(_role(page, "dialog", "Step-up")).to_have_count(0)
        expect(_box(dialog, "Lapses at")).to_have_value(lapse)
        expect(_btn(dialog, "Save grant")).to_be_focused()
        _btn(dialog, "Save grant").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text("Grant saved.")
    grant = next(g for g in _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access"] if g["user_id"] == "USR-06")
    assert grant["scope"] == "derivatives" and grant["expires_at"] == lapse


def test_docket_pane_layout(browser: Browser, app_url: str) -> None:
    with _page(browser, app_url, "tamsin", f"/compartments/{CMP_SEED}") as page:
        page.evaluate("window.__sameDocument = true")
        nav, docket, inspector = _role(page, "navigation", "Compartments"), _role(page, "region", "Docket"), _role(page, "region", "Inspector")
        expect(inspector).to_contain_text("Choose a row to inspect it.")
        a, b, c = _rect(nav), _rect(docket), _rect(inspector)
        assert abs(a["width"] - 240) <= 2 and abs(b["width"] - 480) <= 2
        assert a["x"] < b["x"] < c["x"] and c["width"] > 0
        layout(page)
        page.set_viewport_size({"width": 768, "height": 1024})
        expect(nav).to_have_count(0)
        b, c = _rect(docket), _rect(inspector)
        assert abs(b["width"] - 308) <= 2 and b["x"] < c["x"]
        layout(page)
        page.set_viewport_size({"width": 375, "height": 812})
        expect(inspector).to_have_count(0)
        assert abs(_rect(docket)["width"] - 375) <= 2
        layout(page)
        page.set_viewport_size({"width": 1280, "height": 800})
        expect(nav).to_be_visible()
        expect(inspector).to_be_visible()
        assert page.evaluate("window.__sameDocument") is True
    with _page(browser, app_url, "tamsin", f"/compartments/{CMP_SEED}", width=375, height=812) as page:
        _role(_role(page, "table", "Exhibits"), "link", EX_SEED).click()
        expect(page).to_have_url(f"{app_url}/exhibits/{EX_SEED}")
        expect(_role(page, "region", "Docket")).to_have_count(0)
        _figure_is(page, EX_SEED)
        layout(page)
        _btn(page, "Back to docket").click()
        expect(page).to_have_url(f"{app_url}/compartments/{CMP_SEED}")
    with _page(browser, app_url, "tamsin", f"/exhibits/{EX_SEED}", width=768, height=1024) as page:
        expect(_role(page, "region", "Docket")).to_be_visible()
        expect(_role(page, "region", "Inspector")).to_contain_text("EX-0001")
        expect(_btn(page, "Back to docket")).to_have_count(0)


def test_closed_drawer(browser: Browser, app_url: str) -> None:
    for width, height in ((375, 812), (768, 1024)):
        with _page(browser, app_url, "tamsin", "/compartments", width=width, height=height) as page:
            nav, opener = _role(page, "navigation", "Compartments"), _btn(page, "Compartments")
            expect(opener).to_be_visible()
            expect(nav).to_have_count(0)
            assert opener.get_attribute("aria-expanded") == "false"
            opener.click()
            expect(nav).to_be_visible()
            assert opener.get_attribute("aria-expanded") == "true"
            expect(nav.get_by_role("link").first).to_be_focused()
            page.keyboard.press("Escape")
            expect(nav).to_have_count(0)
            expect(opener).to_be_focused()
            opener.click()
            _btn(page, "Close compartments").click()
            opener.click()
            settle(nav)
            _holds(lambda: expect(nav).to_be_visible(timeout=200))
            page.set_viewport_size({"width": 1280, "height": 800})
            expect(_btn(page, "Close compartments")).to_have_count(0)
            expect(nav).to_have_count(1)
            assert nav.get_by_role("link", name="Harrowgate Depot Payments").count() == 1


def test_grant_lapse_server_decided(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    cid = w.cid
    version = lambda: _ok(w.lead.get(f"/api/compartments/{cid}"))["access_version"]
    body = lambda value: {"user_id": "USR-07", "scope": "full", "expires_at": value, "access_version": version()}
    answer = w.lead.act("POST", f"/api/compartments/{cid}/grants", body(_server_time(w.lead, -60)))
    assert answer.status_code == 422 and answer.json()["errors"]["expires_at"] == "Choose a time in the future."
    answer = w.lead.act("POST", f"/api/compartments/{cid}/grants", body("not a time"))
    assert answer.json()["errors"]["expires_at"] == "Choose a time in the future."
    answer = w.lead.act("POST", f"/api/compartments/{cid}/grants", body(""))
    assert answer.json()["errors"]["expires_at"] == "This field is required."
    lapse = _server_time(w.lead, 30)
    grant = _grant(w.lead, cid, "dmitri", expires_at=lapse)
    assert grant["expires_at"] == lapse
    shown = f"Lapses {lapse[:10]} {lapse[11:16]} UTC"
    with _page(browser, app_url, timezone_id="Pacific/Kiritimati") as lead_page, _page(browser, app_url, timezone_id="America/Adak") as member_page:
        lead_page.clock.set_fixed_time(dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc))
        assert lead_page.request.post(app_url + "/api/sign-in", data={"email": PEOPLE["tamsin"][2], "password": PASSWORD}).status == 200
        lead_page.goto(f"{app_url}/compartments/{cid}")
        row = _role(lead_page, "table", "Access list").get_by_role("row").filter(has_text="Dmitri Vance")
        expect(row).to_contain_text(shown)
        expect(row).to_contain_text("active")
        _btn(lead_page, "Issue grant").click()
        dialog = _role(lead_page, "dialog", "Issue grant")
        select(_role(dialog, "combobox", "Person"), "Yuki Castellan")
        select(_role(dialog, "combobox", "Scope"), "Full")
        _box(dialog, "Lapses at").fill(lapse)
        _btn(dialog, "Save grant").click()
        _step_up(lead_page, "tamsin")
        expect(_status(lead_page, "Action status")).to_have_text("Grant saved.")
        member_page.clock.set_fixed_time(dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc))
        assert member_page.request.post(app_url + "/api/sign-in", data={"email": PEOPLE["dmitri"][2], "password": PASSWORD}).status == 200
        member_page.goto(f"{app_url}/compartments/{cid}")
        expect(_role(member_page, "table", "Exhibits")).to_be_visible()
        expect(_role(member_page, "alert", "Access ended")).to_be_visible(timeout=UI_MS * 2)
        _poll(lambda: next(g for g in _ok(w.lead.get(f"/api/compartments/{cid}"))["access"] if g["id"] == grant["id"])["state"] == "lapsed", 5, "API reads lapsed")
        expect(row).to_contain_text("lapsed", timeout=LIVE_MS)
    _poll(lambda: _count(pg, "grant.lapsed", grant["id"]) == 1, SWEEP_S + 2, "lapse sweep")


def test_wf_isolation_and_denials_screens(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url, second=None)
    exhibit = _cleared(w)
    before = _count(pg, "access.denied", exhibit["id"])
    with _page(browser, app_url, "dmitri", f"/exhibits/{exhibit['id']}") as page:
        expect(page.get_by_role("heading", name="Nothing to show at this address.")).to_be_visible()
        _figure_is(page, "404")
        expect(page.get_by_text(exhibit["sha256"])).to_have_count(0)
    rows = _poll(lambda: [r for r in _rows(pg, f"action = 'access.denied' AND target = {_q(exhibit['id'])}") if r["actor_id"] == "USR-07"], 5, "denial")
    assert len(rows) >= before + 1 and rows[-1]["session_id"]
    with _page(browser, app_url, "dmitri", "/no/such/address") as page:
        expect(page.get_by_role("heading", name="Nothing to show at this address.")).to_be_visible()


def test_wf_isolation_and_denials_auditor_routes(browser: Browser, app_url: str) -> None:
    for who in ("tamsin", "ines", "noor"):
        with _page(browser, app_url, who) as page:
            for route in ("/ledger", "/audit/chain", "/ledger/review"):
                page.goto(app_url + route)
                expect(page.get_by_role("heading", name="Nothing to show at this address.")).to_be_visible()
                expect(_role(page, "region", "Chain Walk")).to_have_count(0)
        api = Api(app_url, who)
        _refused(api.get("/api/ledger"), 403, "forbidden")
        _refused(api.get("/api/signals"), 403, "forbidden")


def test_out_of_grant_refusal(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    exhibit = _cleared(w)
    derivative = _rendered(w, exhibit["id"])
    release = _assembling(w, derivative)
    grant = next(g for g in _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access"] if g["user_id"] == "USR-06")
    outsider = Api(app_url, "dmitri")
    item = release["items"][0]["id"]
    cases = [("GET", f"/api/compartments/{w.cid}", _ABSENT, w.cid), ("GET", f"/api/exhibits/{exhibit['id']}", _ABSENT, exhibit["id"]), ("GET", f"/api/derivatives/{derivative['id']}", _ABSENT, derivative["id"]), ("GET", f"/api/releases/{release['id']}", _ABSENT, release["id"]), ("POST", f"/api/grants/{grant['id']}/revoke", {}, grant["id"]), ("DELETE", f"/api/releases/{release['id']}/items/{item}", _ABSENT, release["id"]), ("POST", f"/api/derivatives/{derivative['id']}/download-grants", {}, derivative["id"])]
    for method, path, body, target in cases:
        before = _count(pg, "access.denied", target)
        response = outsider.request(method, path, body)
        assert response.status_code == 404 and response.json() == {"error": "not_found"}, path
        rows = _rows(pg, f"action = 'access.denied' AND target = {_q(target)}")
        assert len(rows) == before + 1
        assert rows[-1]["actor_id"] == "USR-07" and rows[-1]["session_id"] == outsider.session_id
        assert rows[-1]["detail"]["method"] == method and rows[-1]["detail"]["path"] == path and rows[-1]["detail"]["code"] == "not_found"
    no_record = "EX-999999"
    assert outsider.get(f"/api/exhibits/{no_record}").json() == outsider.get(f"/api/exhibits/{exhibit['id']}").json()
    other = _world(app_url, second=None)
    foreign = _rendered(other)
    own = _assembling(w, _rendered(w))
    before = _count(pg, "access.denied", foreign["id"])
    _refused(w.noor.post(f"/api/releases/{own['id']}/items", {"derivative_id": foreign["id"], "label": "Foreign"}), 404, "not_found")
    assert _count(pg, "access.denied", foreign["id"]) == before + 1
    assert len(_ok(w.noor.get(f"/api/releases/{own['id']}"))["items"]) == 1
    version = _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access_version"]
    unknown = unique("USR")[0].replace(" ", "-")
    _refused(w.lead.act("POST", f"/api/compartments/{w.cid}/grants", {"user_id": unknown, "scope": "full", "expires_at": None, "access_version": version}), 404, "not_found")
    assert len(_rows(pg, f"action = 'access.denied' AND target = {_q(unknown)}")) == 1
    encoded = [("/api/exhibits/EX%2F9999", "EX%2F9999"), ("/api/exhibits/%FF", "%FF"), ("/api/exhibits/%00x", "%00x"), ("/api/exhibits/%C3%A9~a_b.c-d", "%C3%A9~a_b.c-d"), ("/api/exhibits/" + "L" * 1500, "L" * 200)]
    for path, target in encoded:
        before = len(_rows(pg, f"action = 'access.denied' AND target = {_q(target)} AND actor_id = 'USR-07'"))
        _refused(outsider.get(path), 404, "not_found")
        rows = _rows(pg, f"action = 'access.denied' AND target = {_q(target)} AND actor_id = 'USR-07'")
        assert len(rows) == before + 1, path
        assert rows[-1]["detail"]["path"] == path[:1000]
    lone = w.noor.request("POST", f"/api/releases/{own['id']}/items", content=b'{"derivative_id":"\\ud800","label":"x"}', headers={"Content-Type": "application/json"})
    _refused(lone, 404, "not_found")
    assert _rows(pg, "action = 'access.denied' AND target = '%EF%BF%BD'")
    unmatched = _rows(pg, "action = 'access.denied'")
    no_route = "/api/no/such/route"
    assert outsider.get(no_route).status_code == 404
    assert len(_rows(pg, "action = 'access.denied'")) == len(unmatched)


def test_derived_surfaces(app_url: str) -> None:
    w = _world(app_url, second=None)
    name = unique("Hidden Exhibit")[0]
    outsider = Api(app_url, "dmitri")
    before = _ok(outsider.get("/api/dashboard"))
    listed_before = {c["id"] for c in _ok(outsider.get("/api/compartments"))["compartments"]}
    exhibit = _quarantined(w, name=name)
    assert _ok(outsider.get(f"/api/search?q={urllib.parse.quote(name)}"))["results"] == []
    assert _ok(outsider.get("/api/dashboard")) == before
    assert {c["id"] for c in _ok(outsider.get("/api/compartments"))["compartments"]} == listed_before
    assert w.cid not in listed_before
    grant = _grant(w.lead, w.cid, "dmitri")
    results = _ok(outsider.get(f"/api/search?q={urllib.parse.quote(name.upper())}"))["results"]
    assert [(r["exhibit_id"], r["compartment_id"], r["name"], r["state"]) for r in results] == [(exhibit["id"], w.cid, name, "quarantined")]
    with_grant = _ok(outsider.get("/api/dashboard"))
    assert with_grant["compartments"] == before["compartments"] + 1 and with_grant["exhibits"] == before["exhibits"] + 1 and with_grant["quarantined"] == before["quarantined"] + 1
    row = next(c for c in _ok(outsider.get("/api/compartments"))["compartments"] if c["id"] == w.cid)
    assert (row["exhibit_count"], row["quarantine_count"]) == (1, 1)
    percent = urllib.parse.quote("%")
    literal = _ok(outsider.get(f"/api/search?q={percent}"))["results"]
    assert literal == [] or all("%" in r["name"] for r in literal)
    _ok(w.lead.act("POST", f"/api/grants/{grant['id']}/revoke"))
    assert _ok(outsider.get(f"/api/search?q={urllib.parse.quote(name)}"))["results"] == []
    assert _ok(outsider.get("/api/dashboard")) == before


def test_role_restricted_actions(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    exhibit = _cleared(w)
    release = _submitted(w)
    proof = w.noor.proof()
    cases = [(f"/api/releases/{release['id']}/sign-off", {"manifest_digest": release["manifest_digest"]}, release["id"]), (f"/api/exhibits/{exhibit['id']}/hold", {"reason": GOOD_REASON, "matter_ref": "M-2026-077"}, exhibit["id"]), (f"/api/exhibits/{exhibit['id']}/dispose", {"reason": GOOD_REASON}, exhibit["id"]), (f"/api/exhibits/{exhibit['id']}/clear", {}, exhibit["id"])]
    for path, body, target in cases:
        before = _count(pg, "access.denied", target)
        _refused(w.noor.post(path, body, proof=proof), 403, "forbidden")
        rows = _rows(pg, f"action = 'access.denied' AND target = {_q(target)}")
        assert len(rows) == before + 1 and rows[-1]["detail"]["code"] == "forbidden" and rows[-1]["detail"]["path"] == path
    assert _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}"))["state"] == "cleared"
    assert _ok(w.noor.get(f"/api/releases/{release['id']}"))["state"] == "submitted"
    assert w.noor.request("POST", f"/api/compartments/{w.cid}/exhibits", data={}, files={"file": ("a.png", _png(), "image/png")}).status_code == 403
    _refused(w.kofi.post(f"/api/exhibits/{exhibit['id']}/preview-grants", {"page": 1}), 403, "forbidden")
    _refused(w.kofi.request("PUT", f"/api/exhibits/{exhibit['id']}/redactions", {"regions": [], "marks_version": 0}), 403, "forbidden")
    _refused(w.kofi.post(f"/api/compartments/{w.cid}/releases", {"name": "x", "matter_ref": "y", "recipient_kind": "counsel"}), 403, "forbidden")
    _refused(w.noor.post("/api/compartments", {"name": "x"}), 403, "forbidden")
    _refused(w.noor.get("/api/directory"), 403, "forbidden")
    _refused(w.noor.get("/api/reviews"), 403, "forbidden")
    _refused(w.noor.get(f"/api/exhibits/{exhibit['id']}/custody"), 403, "forbidden")
    _ok(w.noor.request("PUT", f"/api/exhibits/{exhibit['id']}/redactions", {"regions": [], "marks_version": 0}))
    assert _ok(w.noor.act("POST", f"/api/releases/{_assembling(w)['id']}/submit"))["state"] == "submitted"
    _grant(w.lead, w.cid, "yuki", "derivatives")
    yuki = Api(app_url, "yuki")
    _refused(yuki.post(f"/api/exhibits/{exhibit['id']}/download-grants"), 404, "not_found")
    assert yuki.post(f"/api/derivatives/{release['items'][0]['derivative_id']}/download-grants").status_code == 201


def test_ledger_attribution(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    created = _rows(pg, f"target = {_q(w.cid)} AND action = 'compartment.created'")
    assert len(created) == 1 and created[0]["actor_id"] == "USR-01" and created[0]["session_id"] == w.lead.session_id
    owner = next(g for g in _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access"] if g["user_id"] == "USR-01")
    issued = _rows(pg, f"action = 'grant.issued' AND target = {_q(owner['id'])}")
    assert len(issued) == 1 and issued[0]["seq"] == created[0]["seq"] + 1
    assert issued[0]["detail"]["compartment_id"] == w.cid and issued[0]["detail"]["user_id"] == "USR-01"
    opened = _rows(pg, f"action = 'session.opened' AND target = {_q(w.noor.session_id)}")
    assert len(opened) == 1 and opened[0]["actor_id"] == "USR-06"
    name = unique("Named Exhibit")[0]
    exhibit = _cleared(w, name=name)
    derivative = _rendered(w, exhibit["id"])
    rendered = _rows(pg, f"action = 'derivative.rendered' AND target = {_q(derivative['id'])}")
    assert len(rendered) == 1 and rendered[0]["detail"]["exhibit_id"] == exhibit["id"] and rendered[0]["session_id"] == w.noor.session_id
    assert len(_rows(pg, f"action = 'redaction.saved' AND target = {_q(exhibit['id'])}")) == 1
    release, link = _shared(w, derivative=derivative)
    added = _rows(pg, f"action = 'release.item_added' AND target = {_q(release['id'])}")[0]["detail"]
    assert added["item_id"] == release["items"][0]["id"] and added["derivative_id"] == derivative["id"] and added["exhibit_id"] == exhibit["id"]
    for action in ("release.created", "release.submitted", "release.signed_off"):
        assert len(_rows(pg, f"action = {_q(action)} AND target = {_q(release['id'])}")) == 1, action
    shared = _rows(pg, f"action = 'release.shared' AND target = {_q(release['id'])}")
    assert shared[0]["detail"]["link_id"] == link["link_id"] and shared[0]["actor_id"] == "USR-01"
    held = _ok(w.lead.act("POST", f"/api/exhibits/{exhibit['id']}/hold", {"reason": GOOD_REASON, "matter_ref": "M-2026-077"}))
    placed = _rows(pg, f"action = 'hold.placed' AND target = {_q(exhibit['id'])}")
    assert placed[0]["detail"]["hold_id"] == held["holds"][0]["id"] and placed[0]["detail"]["matter_ref"] == "M-2026-077"
    for row in _rows(pg, f"target = {_q(exhibit['id'])}"):
        assert name not in json.dumps(row["detail"], ensure_ascii=False) and row["actor_id"] and row["session_id"]


def test_ledger_write_protection(app_url: str) -> None:
    pg, url = Postgres(), os.environ["DATABASE_URL"]
    Api(app_url, "noor")
    last = pg.rows("SELECT max(seq) AS seq, count(*) AS c FROM ledger_entries")[0]
    target = int(last["seq"])
    for statement in (f"UPDATE ledger_entries SET actor_id = '{TAMPER_ACTOR}' WHERE seq = {target};", f"DELETE FROM ledger_entries WHERE seq = {target};", "TRUNCATE ledger_entries;"):
        done = _psql(url, f"BEGIN;\n{statement}\nROLLBACK;\n")
        assert done.returncode != 0 and done.stderr.strip(), statement
    assert _rows(pg, f"seq = {target}")[0]["actor_id"] != TAMPER_ACTOR
    rights = _psql(url, "SELECT has_table_privilege(current_user, 'ledger_entries', 'UPDATE'), has_table_privilege(current_user, 'ledger_entries', 'DELETE'), has_table_privilege(current_user, 'ledger_entries', 'TRUNCATE');\n")
    assert rights.stdout.strip().split("|") == ["f", "f", "f"], rights.stdout + rights.stderr
    triggers = pg.rows("SELECT count(*) AS c FROM pg_trigger WHERE tgrelid = 'ledger_entries'::regclass AND NOT tgisinternal")
    assert int(triggers[0]["c"]) >= 1


UNREADABLE_COPY = "This request could not be read."
UNSTORABLE_COPY = "This field holds characters that cannot be stored."
DEEP_NESTING = 100000
NAME_MAX = 200
OVER_NAME = NAME_MAX + 1
MALFORMED_CASES = (
    (b"{not json", "body", UNREADABLE_COPY),
    (b'{"name":"\xff"}', "body", UNREADABLE_COPY),
    (b"[1,2]", "body", UNREADABLE_COPY),
    (b'{"a":' * DEEP_NESTING + b"1" + b"}" * DEEP_NESTING, "body", UNREADABLE_COPY),
    (b'{"name":"a\\u0000b"}', "name", UNSTORABLE_COPY),
    (b'{"name":"a\\u0007b"}', "name", UNSTORABLE_COPY),
    (b'{"name":"a\\u007fb"}', "name", UNSTORABLE_COPY),
    (b'{"name":"a\\ud800b"}', "name", UNSTORABLE_COPY),
    (b'{"name":7}', "name", "This field is required."),
    (b'{"name":"' + b"n" * OVER_NAME + b'"}', "name", f"Keep this to {NAME_MAX} characters or fewer."),
)


def test_malformed_input(app_url: str) -> None:
    lead = Api(app_url, "tamsin")
    before = _ok(lead.get("/api/dashboard"))["compartments"]
    for raw, field, copy in MALFORMED_CASES:
        response = lead.request("POST", "/api/compartments", content=raw, headers={"Content-Type": "application/json"})
        assert response.status_code == 422, raw[:40] + response.text.encode()
        assert response.json()["errors"] == {field: copy}, raw[:40]
        assert not LEAK.search(response.text)
    assert _ok(lead.get("/api/dashboard"))["compartments"] == before


def test_malformed_input_edges(app_url: str) -> None:
    lead = Api(app_url, "tamsin")
    answers = []
    wrong_type = lead.request("POST", "/api/compartments", content=b'{"name":"x"}', headers={"Content-Type": "text/plain"})
    answers.append(wrong_type)
    _refused(wrong_type, 415, "unsupported_media_type")
    oversize = lead.request("POST", "/api/compartments", content=b'{"name":"' + b"n" * MAX_JSON + b'"}', headers={"Content-Type": "application/json"})
    answers.append(oversize)
    _refused(oversize, 413, "body_too_large")
    at_limit = b'{"name":"x","padding":"' + b"p" * (MAX_JSON - 25) + b'"}'
    assert len(at_limit) == MAX_JSON
    answers.append(lead.request("POST", "/api/compartments", content=at_limit, headers={"Content-Type": "application/json"}))
    assert answers[-1].status_code != 413
    nul_sign_in = httpx.post(f"{app_url}/api/sign-in", json={"email": "a\u0000@ashgrove.example", "password": "x"}, timeout=HTTP_TIMEOUT)
    answers.append(nul_sign_in)
    _refused(nul_sign_in, 401, "sign_in_failed")
    nul = urllib.parse.quote("\0")
    answers.append(lead.get(f"/api/search?q={nul}"))
    assert answers[-1].status_code == 200 and answers[-1].json()["results"] == []
    answers.append(lead.get(f"/api/compartments/{CMP_SEED}/exhibits?state={nul}"))
    assert answers[-1].status_code == 200 and answers[-1].json()["exhibits"] == []
    answers.append(httpx.get(f"{app_url}/api/session", headers={"Cookie": "session=%FF%00"}, timeout=HTTP_TIMEOUT))
    _refused(answers[-1], 401, "unauthenticated")
    for path in ("/api/download/%00", "/api/download/%FF", "/api/links/%FF", "/l/%FF"):
        answers.append(httpx.get(app_url + path, timeout=HTTP_TIMEOUT))
        assert answers[-1].status_code == 404, path
    w = _world(app_url, second=None)
    answers.append(w.ines.request("POST", f"/api/compartments/{w.cid}/exhibits", content=b"not multipart at all", headers={"Content-Type": "multipart/form-data; boundary=x"}))
    assert answers[-1].status_code == 422 and answers[-1].json()["errors"]["body"] == "This request could not be read."
    item_id = lead.request("POST", f"/api/releases/{REL_SEED}/items", {"derivative_id": 7, "label": "x"})
    answers.append(item_id)
    assert item_id.status_code in (409, 422)
    for response in answers:
        assert response.status_code < 500 and not LEAK.search(response.text)
    version_none = w.lead.act("POST", f"/api/compartments/{w.cid}/grants", {"user_id": "USR-07", "scope": "sideways", "expires_at": None})
    assert version_none.status_code == 422
    assert version_none.json()["errors"]["access_version"] == "This field is required." and version_none.json()["errors"]["scope"] == "This field is required."


def test_wf_redaction_and_derivatives_mark_and_render(browser: Browser, app_url: str) -> None:
    pg, bucket = Postgres(), S3()
    w = _world(app_url)
    exhibit = _cleared(w, _png(1000, 500, (255, 255, 255)))
    keys = set(bucket.keys("derivatives/"))
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}") as page:
        status = _status(page, "Redaction status")
        expect(status).to_have_text("Preview loaded.")
        _btn(page, "Add region").click()
        expect(_btn(page, "Region 1")).to_be_focused()
        _btn(page, "Save marks").click()
        expect(status).to_have_text("Marks saved.")
        _btn(page, "Render derivative").click()
        expect(status).to_have_text(_published("Rendered <derivative id>."))
        derivative_id = re.search(r"DV-\d+", status.inner_text()).group()
        expect(_btn(_role(page, "table", "Derivatives"), f"Download {derivative_id}")).to_be_visible()
    marks = _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}/redactions"))
    assert marks == {"regions": [{"page": 1, "x": 100, "y": 100, "w": 200, "h": 100}], "marks_version": 1}
    assert _rows(pg, f"action = 'redaction.saved' AND target = {_q(exhibit['id'])}")[0]["detail"]["marks_version" if "marks_version" in _rows(pg, f"action = 'redaction.saved' AND target = {_q(exhibit['id'])}")[0]["detail"] else "version"] == 1
    derivative = _ok(w.noor.get(f"/api/derivatives/{derivative_id}"))
    data = _derivative_bytes(w.noor, derivative_id)
    assert hashlib.sha256(data).hexdigest() == derivative["sha256"] != exhibit["sha256"]
    raster = Raster(data)
    assert raster.at(100, 50) == (0, 0, 0) and raster.at(299, 99) == (0, 0, 0) and raster.at(99, 50) == (255, 255, 255) and raster.at(300, 100) == (255, 255, 255)
    new = set(bucket.keys("derivatives/")) - keys
    assert len(new) == 1 and _random_key(next(iter(new)), "derivatives/") and bucket.get(next(iter(new))) == data


def test_wf_redaction_and_derivatives_stale_and_superseded(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w)
    path = f"/api/exhibits/{exhibit['id']}/redactions"
    derivative = _rendered(w, exhibit["id"])
    assert derivative["superseded"] is False and derivative["marks_saved_by"] == "USR-06" and derivative["marks_version"] == 1
    stale = w.noor.request("PUT", path, {"regions": [], "marks_version": 0})
    assert stale.status_code == 409 and stale.json() == {"error": "stale_marks", "marks_version": 1}
    unchanged = w.noor.request("PUT", path, {"regions": [REGION], "marks_version": 1})
    assert _ok(unchanged)["marks_version"] == 1
    bad = w.noor.request("PUT", path, {"regions": [{"page": 1, "x": 900, "y": 0, "w": 200, "h": 1}], "marks_version": 1})
    assert bad.status_code == 422 and bad.json()["errors"]["regions"] == "Each region must sit inside its page."
    in_submit, in_signed, in_shared = _assembling(w, derivative), _submitted(w, derivative=derivative), _shared(w, derivative=derivative)
    signed = _signed_off(w, derivative=derivative)
    _save(w.noor, exhibit["id"], [REGION, {"page": 1, "x": 0, "y": 0, "w": 10, "h": 10}])
    assert _ok(w.noor.get(f"/api/derivatives/{derivative['id']}"))["superseded"] is True
    fresh = _ok(w.noor.post(f"/api/compartments/{w.cid}/releases", {"name": unique("R")[0], "matter_ref": "M-1", "recipient_kind": "counsel"}), 201)
    named = {"error": "derivative_superseded", "derivative_id": derivative["id"]}
    answer = w.noor.post(f"/api/releases/{fresh['id']}/items", {"derivative_id": derivative["id"], "label": "Old"})
    assert answer.status_code == 409 and answer.json() == named
    answer = w.noor.act("POST", f"/api/releases/{in_submit['id']}/submit")
    assert answer.status_code == 409 and answer.json() == named
    answer = w.lead.act("POST", f"/api/releases/{in_signed['id']}/sign-off", {"manifest_digest": in_signed["manifest_digest"]})
    assert answer.status_code == 409 and answer.json() == named
    answer = w.lead.act("POST", f"/api/releases/{signed['id']}/share", {"expires_at": _server_time(w.lead, 3600)})
    assert answer.status_code == 409 and answer.json() == named
    assert _ok(w.lead.get(f"/api/releases/{signed['id']}"))["state"] == "signed off"
    answer = w.lead.act("POST", f"/api/releases/{in_shared[0]['id']}/link/regenerate", {"expires_at": _server_time(w.lead, 3600)})
    assert answer.status_code == 409 and answer.json() == named
    assert httpx.get(f"{app_url}/api/links/{in_shared[1]['token']}", timeout=HTTP_TIMEOUT).status_code == 200
    assert _ok(w.lead.act("POST", f"/api/releases/{in_signed['id']}/reject", {"reason": GOOD_REASON}))["state"] == "rejected"
    with _page(browser, app_url, "noor", f"/releases/{fresh['id']}") as page:
        expect(_role(page, "status", "Release state")).to_have_text("Assembling")
        select(_role(page, "combobox", "Derivative"), derivative["id"])
        _box(page, "Item label").fill("Old")
        _btn(page, "Add item").click()
        expect(_status(page, "Action status")).to_have_text(f"A newer set of marks exists for {derivative['id']}. Render again and replace it.")
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}") as page:
        expect(_role(page, "table", "Derivatives").get_by_role("row").filter(has=_btn(page, f"Download {derivative['id']}"))).to_contain_text("Superseded")


def test_derivative_files(app_url: str) -> None:
    w, bucket = _world(app_url), S3()
    meta = _png_chunk(b"tEXt", b"Camera\0Gatehouse-2")
    source = _png(100, 100, (10, 200, 30), meta, b"TRAILING-BYTES")
    exhibit = _cleared(w, source)
    first = _rendered(w, exhibit["id"], [{"page": 1, "x": 0, "y": 0, "w": 500, "h": 500}])
    keys = set(bucket.keys("derivatives/"))
    second = _ok(w.noor.post(f"/api/exhibits/{exhibit['id']}/derivatives"), 201)
    assert second["id"] != first["id"] and second["sha256"] == first["sha256"]
    assert len(set(bucket.keys("derivatives/")) - keys) == 1
    data = _derivative_bytes(w.noor, first["id"])
    assert set(_png_chunks(data)) == {b"IHDR", b"IDAT", b"IEND"}
    raster = Raster(data)
    assert raster.colour_type == 2 and (raster.width, raster.height) == (100, 100)
    assert raster.at(49, 49) == (0, 0, 0) and raster.at(50, 50) == (10, 200, 30)
    assert b"TRAILING" not in data and b"Gatehouse" not in data
    assert first["content_type"] == "image/png" and first["size"] == len(data) and first["page_count"] == 1
    empty_marks = _cleared(w, _png(9, 9, (1, 1, 1)))
    untouched = _ok(w.noor.post(f"/api/exhibits/{empty_marks['id']}/derivatives"), 201)
    assert untouched["marks_saved_by"] is None
    assert Raster(_derivative_bytes(w.noor, untouched["id"])).at(0, 0) == (1, 1, 1)
    transparent_row = b"\0" + b"\0\0\0\0" * 4
    alpha = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 6, 0, 0, 0)) + _png_chunk(b"IDAT", zlib.compress(transparent_row * 4)) + _png_chunk(b"IEND", b"")
    flattened = _ok(w.noor.post(f"/api/exhibits/{_cleared(w, alpha)['id']}/derivatives"), 201)
    assert Raster(_derivative_bytes(w.noor, flattened["id"])).at(1, 1) == (255, 255, 255)
    pdf = _pdf([{"text": [(20, 100, "HARROWGATE-PAYEE-7731")], "annots": [("Square", [10, 10, 50, 50], "1 0 0")]}, {"text": [(20, 100, "SECOND-PAGE-WORDS")]}], author="Harrowgate Archive Desk")
    pdf_exhibit = _pdf_exhibit(w, pdf)
    rendered = _rendered(w, pdf_exhibit["id"], [{"page": 1, "x": 0, "y": 0, "w": 1000, "h": 1000}])
    output = _derivative_bytes(w.noor, rendered["id"])
    again = _ok(w.noor.post(f"/api/exhibits/{pdf_exhibit['id']}/derivatives"), 201)
    assert again["sha256"] == rendered["sha256"] and rendered["page_count"] == 2 and rendered["content_type"] == "application/pdf"
    for forbidden in (b"/Info", b"/Metadata", b"/Annots", b"/Font", b"/EmbeddedFiles", b"/AcroForm", b"HARROWGATE", b"SECOND-PAGE", b"Harrowgate Archive"):
        assert forbidden not in output, forbidden
    assert len(re.findall(rb"/Subtype\s*/Image", output)) == 2
    assert all(int(n) == 600 for n in re.findall(rb"/Width\s+(\d+)", output)) and all(int(n) == 300 for n in re.findall(rb"/Height\s+(\d+)", output))


def test_canvas_preview(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w, _png(200, 100, (200, 10, 10)))
    grants, downloads = [], []
    with _page(browser, app_url, "noor") as page:
        page.on("response", lambda r: grants.append(r.json()["token"]) if r.url.endswith("/preview-grants") and r.status == 201 else None)
        page.on("request", lambda r: downloads.append(r) if "/api/download/" in r.url else None)
        page.goto(f"{app_url}/exhibits/{exhibit['id']}")
        expect(_status(page, "Redaction status")).to_have_text("Preview loaded.")
        canvas = _role(page, "img", "Exhibit preview page 1")
        assert canvas.evaluate("e => e instanceof HTMLCanvasElement") is True
        assert grants and downloads and downloads[0].resource_type in ("fetch", "xhr")
        assert downloads[0].url.endswith(grants[0])
        shot = Raster(canvas.screenshot())
        assert shot.at(shot.width // 2, shot.height // 2) == (200, 10, 10)
        assert page.evaluate("[...document.images, ...document.querySelectorAll('iframe, embed, object')].filter(e => (e.src || e.data || '').includes('/api/download/')).length") == 0
    assert httpx.get(f"{app_url}/api/download/{grants[0]}", timeout=HTTP_TIMEOUT).status_code == 404


def test_keyboard_redaction(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w)
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}") as page:
        status = _status(page, "Redaction status")
        expect(status).to_have_text("Preview loaded.")
        _btn(page, "Add region").focus()
        page.keyboard.press("Enter")
        region = _btn(page, "Region 1")
        expect(region).to_be_focused()
        expect(status).to_have_text(_region_copy(100, 100, 200, 100))
        page.keyboard.press("ArrowRight")
        expect(status).to_have_text(_region_copy(110, 100, 200, 100))
        page.keyboard.press("ArrowDown")
        expect(status).to_have_text(_region_copy(110, 110, 200, 100))
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowUp")
        expect(status).to_have_text(_region_copy(100, 100, 200, 100))
        page.keyboard.press("Shift+ArrowRight")
        expect(status).to_have_text(_region_copy(100, 100, 210, 100))
        page.keyboard.press("Shift+ArrowDown")
        expect(status).to_have_text(_region_copy(100, 100, 210, 110))
        for _ in range(12):
            page.keyboard.press("Shift+ArrowUp")
        expect(status).to_have_text(_region_copy(100, 100, 210, 10))
        expect(region).to_be_focused()
        _btn(page, "Save marks").click()
        expect(status).to_have_text("Marks saved.")
        assert _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}/redactions"))["regions"] == [{"page": 1, "x": 100, "y": 100, "w": 210, "h": 10}]
        region.focus()
        page.keyboard.press("Delete")
        expect(region).to_have_count(0)
        expect(_btn(page, "Add region")).to_be_focused()


def _touch_drag(page: Page, start: tuple[float, float], end: tuple[float, float]) -> None:
    cdp = session(page)
    point = lambda x, y: {"x": x, "y": y, "id": 1}
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [point(*start)]})
    for step in range(1, 7):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [point(start[0] + (end[0] - start[0]) * step / 6, start[1] + (end[1] - start[1]) * step / 6)]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def test_touch_redaction(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w, _png(1000, 1000))
    posts = []
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}", width=375, height=812, touch=True) as page:
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/derivatives") else None)
        expect(_status(page, "Redaction status")).to_have_text("Preview loaded.")
        canvas = _role(page, "img", "Exhibit preview page 1")
        canvas.scroll_into_view_if_needed()
        box, scroll = _rect(canvas), page.evaluate("window.scrollY")
        _touch_drag(page, (box["x"] + box["width"] * 0.2, box["y"] + box["height"] * 0.2), (box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.25))
        region = _btn(page, "Region 1")
        expect(region).to_be_visible()
        assert page.evaluate("window.scrollY") == scroll
        small = _rect(region)
        handle = _marked(page, "data-region-handle", "1")[0]
        assert small and handle
        assert handle["attrs"].get(TAB_INDEX) in ("-1", None)
        _btn(page, "Render derivative").tap()
        expect(_status(page, "Redaction status")).to_have_text("Save your marks before rendering.")
        assert posts == []
        _btn(page, "Save marks").tap()
        expect(_status(page, "Redaction status")).to_have_text("Marks saved.")
        saved = _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}/redactions"))
        got = saved["regions"][0]
        assert abs(got["x"] - 200) <= 30 and abs(got["y"] - 200) <= 30 and 20 <= got["w"] <= 80 and 20 <= got["h"] <= 80, got
        page.set_viewport_size({"width": 812, "height": 375})
        expect(region).to_be_visible()
        wider = _rect(canvas)
        centre = _rect(region)
        ratio = (centre["x"] + centre["width"] / 2 - wider["x"]) / wider["width"]
        assert abs(ratio - (got["x"] + got["w"] / 2) / 1000) <= 0.05, ratio
        _btn(page, "Save marks").tap()
        expect(_status(page, "Redaction status")).to_have_text("Marks saved.")
        assert _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}/redactions")) == saved


def test_displayed_page_geometry(app_url: str) -> None:
    w = _world(app_url)
    png = _cleared(w, _png(300, 300))
    raster = Raster(_derivative_bytes(w.noor, _rendered(w, png["id"], [{"page": 1, "x": 333, "y": 666, "w": 1, "h": 1}])["id"]))
    assert raster.at(99, 199) == (0, 0, 0) and raster.at(100, 200) == (0, 0, 0)
    assert raster.at(98, 199) == (255, 255, 255) and raster.at(101, 199) == (255, 255, 255) and raster.at(99, 198) == (255, 255, 255) and raster.at(99, 201) == (255, 255, 255)
    jpeg = _cleared(w, _jpeg_exif(6), "image/jpeg", "a.jpg")
    shown = Raster(_preview(w.noor, jpeg["id"]))
    assert (shown.width, shown.height) == (8, 16)
    assert sum(shown.at(4, 3)) < sum(shown.at(4, 12))
    burned = Raster(_derivative_bytes(w.noor, _rendered(w, jpeg["id"], [{"page": 1, "x": 0, "y": 500, "w": 1000, "h": 500}])["id"]))
    assert (burned.width, burned.height) == (8, 16) and burned.at(4, 12) == (0, 0, 0) and burned.at(4, 3) != (0, 0, 0)
    rotated = _pdf_exhibit(w, _pdf([{"media": (0, 0, 288, 144), "rotate": 90, "draw": "1 0 0 rg 0 0 48 48 re f\n"}]))
    shown = Raster(_preview(w.noor, rotated["id"]))
    assert (shown.width, shown.height) == (300, 600)
    assert shown.at(20, 20) == (255, 0, 0) and shown.at(280, 580) == (255, 255, 255)
    cropped = _pdf_exhibit(w, _pdf([{"media": (0, 0, 288, 144), "crop": (72, 36, 216, 108), "draw": "0 0 1 rg 72 36 24 24 re f\n1 0 0 rg 0 0 72 36 re f\n"}]))
    shown = Raster(_preview(w.noor, cropped["id"]))
    assert (shown.width, shown.height) == (300, 150)
    assert shown.at(10, 140) == (0, 0, 255) and shown.count((255, 0, 0)) == 0
    annotated = _pdf_exhibit(w, _pdf([{"annots": [("Square", [10, 10, 60, 60], "1 0 0"), ("Widget", [100, 10, 150, 60], "0 0 1")]}]))
    shown = Raster(_preview(w.noor, annotated["id"]))
    assert shown.at(70, 260) == (255, 0, 0)
    assert shown.at(260, 260) == (0, 0, 255)


def test_bounded_rendering(app_url: str) -> None:
    w, bucket = _world(app_url), S3()
    over_width, over_height = 8000, 5001
    header_only = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", over_width, over_height, 8, 2, 0, 0, 0)) + _png_chunk(b"IEND", b"")
    assert over_width * over_height > MAX_PIXELS
    oversize_page = _pdf([{"media": (0, 0, 14400, 14400)}])
    many = _pdf([{}] * (MAX_PAGES + 1))
    locked = _pdf([{"text": [(10, 10, "Locked")]}], encrypted=True)
    cases = [(header_only, "image/png", "a.png", None), (oversize_page, "application/pdf", "a.pdf", 1), (many, "application/pdf", "a.pdf", MAX_PAGES + 1), (locked, "application/pdf", "a.pdf", None)]
    for payload, declared, filename, pages in cases:
        before = set(bucket.keys("originals/"))
        exhibit = _cleared(w, payload, declared, filename)
        key = (set(bucket.keys("originals/")) - before).pop()
        assert bucket.get(key) == payload
        body = _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}"))
        if declared == "application/pdf":
            assert body["page_count"] == pages, body
        _refused(w.noor.post(f"/api/exhibits/{exhibit['id']}/preview-grants", {"page": 1}), 409, "not_previewable")
        _refused(w.noor.post(f"/api/exhibits/{exhibit['id']}/derivatives"), 409, "not_redactable")
    at_pages = _pdf_exhibit(w, _pdf([{}] * MAX_PAGES))
    assert _ok(w.noor.post(f"/api/exhibits/{at_pages['id']}/preview-grants", {"page": MAX_PAGES}), 201)["token"]
    page_error = w.noor.post(f"/api/exhibits/{at_pages['id']}/preview-grants", {"page": MAX_PAGES + 1})
    assert page_error.status_code == 422 and page_error.json()["errors"]["page"] == "Choose a page of this exhibit."
    big = _cleared(w, _png(8000, 5000))
    with concurrent.futures.ThreadPoolExecutor(1) as pool:
        render = pool.submit(w.noor.post, f"/api/exhibits/{big['id']}/derivatives", {})
        checks = 0
        while not render.done():
            for path in ("/api/health", "/api/session"):
                started = time.monotonic()
                assert w.noor.get(path).status_code == 200
                assert time.monotonic() - started < STALL_ANSWER_S, path
            checks += 1
        assert checks >= 1
        assert render.result().status_code == 201, render.result().text


def test_find_text(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    pdf = _pdf([{"media": (0, 0, 288, 144), "crop": (0, 0, 288, 100), "text": [(20, 70, "ZULU QUILLFEATHER"), (20, 50, "BRAVO YANKEE"), (20, 120, "OUTSIDECROP")]}, {"text": [(20, 100, "QUILLFEATHER")]}])
    exhibit = _pdf_exhibit(w, pdf)
    find = lambda words: _ok(w.noor.post(f"/api/exhibits/{exhibit['id']}/redactions/find", {"text": words}))["matches"]
    entries = len(_rows(pg, f"target = {_q(exhibit['id'])}"))
    across = find("quillfeather \n  bravo")
    assert [m["page"] for m in across] == [1, 1] and across[0]["y"] < across[1]["y"]
    for match in across:
        assert all(isinstance(match[k], int) for k in "xywh") and match["x"] + match["w"] <= 1000 and match["y"] + match["h"] <= 1000
    single = find("QUILLFEATHER")
    assert [m["page"] for m in single] == [1, 2]
    assert 200 < single[0]["y"] + single[0]["h"] and single[0]["y"] < 400
    assert find("OUTSIDECROP") == []
    assert find("absent words") == []
    assert _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}/redactions")) == {"regions": [], "marks_version": 0}
    assert len(_rows(pg, f"target = {_q(exhibit['id'])}")) == entries
    assert _table_hits(pg, "QUILLFEATHER") == [] and _table_hits(pg, "quillfeather") == []
    rotated = _pdf_exhibit(w, _pdf([{"rotate": 90, "text": [(20, 20, "ROTATEDWORD")]}]))
    box = _ok(w.noor.post(f"/api/exhibits/{rotated['id']}/redactions/find", {"text": "rotatedword"}))["matches"][0]
    assert box["h"] > box["w"] and box["y"] < 300 and box["x"] < 500
    image = _cleared(w)
    assert _ok(w.noor.post(f"/api/exhibits/{image['id']}/redactions/find", {"text": "x"}))["matches"] == []
    audio = _cleared(w, _wav(), "audio/wav", "a.wav")
    _refused(w.noor.post(f"/api/exhibits/{audio['id']}/redactions/find", {"text": "x"}), 409, "not_redactable")
    empty = w.noor.post(f"/api/exhibits/{image['id']}/redactions/find", {"text": "  "})
    assert empty.status_code == 422 and empty.json()["errors"]["text"] == "This field is required."
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}") as page:
        status = _status(page, "Redaction status")
        expect(status).to_have_text("Preview loaded.")
        _box(page, "Find text").fill("QUILLFEATHER")
        _btn(page, "Mark matches").click()
        added = len(single)
        expect(status).to_have_text(f"Added {added} regions. Save your marks to keep them.")
        expect(_btn(page, "Region 1")).to_be_visible()
        _btn(page, "Mark matches").click()
        expect(_role(page, "group", "Redaction regions").get_by_role("button", name=re.compile(r"^Region \d+$"))).to_have_count(1)
        _box(page, "Find text").fill("absent words")
        _btn(page, "Mark matches").click()
        expect(status).to_have_text("No matches found. A scanned page may still hold this text.")
        assert _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}/redactions"))["regions"] == []


def test_newest_preview_page_and_working_marks(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    pdf = _pdf([{"media": (0, 0, 288, 144)}, {"media": (0, 0, 144, 288)}, {"media": (0, 0, 200, 200)}])
    exhibit = _pdf_exhibit(w, pdf)
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}") as page:
        status = _status(page, "Redaction status")
        expect(status).to_have_text("Preview loaded.")
        _btn(page, "Add region").click()
        expect(_btn(page, "Region 1")).to_be_visible()
        held = []
        page.route("**/preview-grants", lambda route: held.append(route))
        _btn(page, "Next page").click()
        _btn(page, "Next page").click()
        _poll(lambda: page.evaluate("1") and len(held) >= 1, 5, "preview grant asked")
        canvas = _role(page, "img", "Exhibit preview page 3")
        expect(status).to_have_text("Loading preview.")
        _record(status, "preview")
        page.unroute("**/preview-grants")
        for route in reversed(held):
            route.continue_()
        expect(status).to_have_text("Preview loaded.")
        expect(canvas).to_be_visible()
        _holds(lambda: expect(_role(page, "img", "Exhibit preview page 3")).to_be_visible(timeout=200))
        ratio = canvas.evaluate("e => e.width / e.height")
        assert abs(ratio - 1) < 0.02, ratio
        assert _seen(page, "preview").count("Preview loaded.") == 1
        expect(_btn(page, "Region 1")).to_have_count(0)
        _btn(page, "Previous page").click()
        _btn(page, "Previous page").click()
        expect(_role(page, "img", "Exhibit preview page 1")).to_be_visible()
        expect(_btn(page, "Region 1")).to_be_visible()
        with page.expect_request(lambda r: r.url.endswith("/api/session"), timeout=BANNER_MS):
            pass
        expect(_btn(page, "Region 1")).to_be_visible()
        other = _ok(w.lead.request("PUT", f"/api/exhibits/{exhibit['id']}/redactions", {"regions": [{"page": 1, "x": 0, "y": 0, "w": 50, "h": 50}], "marks_version": 0}))
        with page.expect_request(lambda r: "/api/" in r.url, timeout=BANNER_MS):
            pass
        expect(status).not_to_have_text("Marks saved.")
        _role(page, "img", "Exhibit preview page 1").scroll_into_view_if_needed()
        first_canvas = _rect(_role(page, "img", "Exhibit preview page 1"))
        page.mouse.move(first_canvas["x"] + first_canvas["width"] * 0.6, first_canvas["y"] + first_canvas["height"] * 0.6)
        page.mouse.down()
        page.mouse.move(first_canvas["x"] + first_canvas["width"] * 0.8, first_canvas["y"] + first_canvas["height"] * 0.8, steps=4)
        with page.expect_request(lambda r: r.url.endswith("/api/session"), timeout=BANNER_MS):
            pass
        page.mouse.up()
        expect(_btn(page, "Region 2")).to_be_visible()
        _btn(page, "Save marks").click()
        expect(status).to_have_text("Someone else changed these marks. Review them and try again.")
        expect(_btn(page, "Region 2")).to_be_visible()
        _btn(page, "Save marks").click()
        expect(status).to_have_text("Marks saved.")
    saved = _ok(w.noor.get(f"/api/exhibits/{exhibit['id']}/redactions"))
    assert saved["marks_version"] == other["marks_version"] + 1 and len(saved["regions"]) == 2
    assert {"page": 1, "x": 100, "y": 100, "w": 200, "h": 100} in saved["regions"]


def test_wf_release_sign_off_assembly(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    derivative = _rendered(w)
    name = unique("Package")[0]
    with _page(browser, app_url, "noor", f"/compartments/{w.cid}") as page:
        _btn(page, "New release").click()
        dialog = _role(page, "dialog", "New release")
        _box(dialog, "Release name").fill(name)
        _box(dialog, "Matter reference").fill("M-2026-041")
        select(_role(dialog, "combobox", "Recipient"), "Outside counsel")
        _btn(dialog, "Create release").click()
        release = _poll(lambda: next((r for r in _ok(w.noor.get(f"/api/compartments/{w.cid}/releases"))["releases"] if r["name"] == name), None), 10, "release created")
        page.goto(f"{app_url}/releases/{release['id']}")
        expect(_status(page, "Release state")).to_have_text("Assembling")
        if _btn(page, "Submit release").count():
            _btn(page, "Submit release").click()
            _step_up(page, "noor")
            expect(_role(page, "dialog", "Step-up")).to_have_count(0, timeout=UI_MS)
        assert _ok(w.noor.get(f"/api/releases/{release['id']}"))["state"] == "assembling"
        select(_role(page, "combobox", "Derivative"), derivative["id"])
        _box(page, "Item label").fill("Gate photograph, redacted")
        _btn(page, "Add item").click()
        expect(_status(page, "Action status")).to_have_text("Item added.")
        expect(page.get_by_text("Gate photograph, redacted").first).to_be_visible()
        _btn(page, "Submit release").click()
        _step_up(page, "noor")
        expect(_status(page, "Action status")).to_have_text(f"Submitted {release['id']}.")
        state = _status(page, "Release state")
        expect(state).to_have_text("Submitted")
        _figure_is(page, "1")
        current = _ok(w.noor.get(f"/api/releases/{release['id']}"))
        assert state.get_attribute("data-manifest-digest") == current["manifest_digest"] == _manifest(current, w.noor)
        expect(_btn(page, "Add item")).to_have_count(0)
    assert current["state"] == "submitted" and current["assembler_id"] == "USR-06" and current["total_bytes"] == derivative["size"]
    assert [i["derivative_id"] for i in current["items"]] == [derivative["id"]]
    assert len(_rows(pg, f"action = 'release.item_added' AND target = {_q(release['id'])}")) == 1
    assert len(_rows(pg, f"action = 'release.submitted' AND target = {_q(release['id'])}")) == 1


def test_wf_release_sign_off_reject_and_rework(browser: Browser, app_url: str, mail: Any) -> None:
    w = _world(app_url)
    release = _submitted(w)
    with _page(browser, app_url, "tamsin", f"/releases/{release['id']}") as page:
        _btn(page, "Reject").click()
        _step_up(page, "tamsin", GOOD_REASON)
        expect(_status(page, "Action status")).to_have_text(f"Rejected {release['id']}. Assembler notice queued.")
        expect(_status(page, "Release state")).to_have_text("Rejected")
    assert _ok(w.noor.get(f"/api/releases/{release['id']}"))["rejection_reason"] == GOOD_REASON
    message = _mail(mail, f"Release {release['id']} rejected")
    assert PEOPLE["noor"][2] in addresses(message["To"])
    reopened = _ok(w.noor.post(f"/api/releases/{release['id']}/reopen"))
    assert reopened["state"] == "assembling"
    edited = _ok(w.noor.post(f"/api/releases/{release['id']}/items", {"derivative_id": _rendered(w)["id"], "label": "Item two"}), 201)
    assert edited["manifest_digest"] != release["manifest_digest"]
    assert _ok(w.noor.act("POST", f"/api/releases/{release['id']}/submit"))["state"] == "submitted"


def test_release_state_machine(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    empty = _ok(w.noor.post(f"/api/compartments/{w.cid}/releases", {"name": unique("E")[0], "matter_ref": "M-1", "recipient_kind": "requester"}), 201)
    assert empty["manifest_digest"] == hashlib.sha256(b"[]").hexdigest()
    _refused(w.noor.act("POST", f"/api/releases/{empty['id']}/submit"), 409, "release_empty")

    def illegal(response: httpx.Response, start: str, to: str) -> None:
        assert response.status_code == 409 and response.json() == {"error": "illegal_transition", "from": start, "to": to}, response.text

    assembling = _assembling(w)
    rid = assembling["id"]
    illegal(w.lead.act("POST", f"/api/releases/{rid}/sign-off", {"manifest_digest": assembling["manifest_digest"]}), "assembling", "signed off")
    illegal(w.lead.act("POST", f"/api/releases/{rid}/reject", {"reason": GOOD_REASON}), "assembling", "rejected")
    illegal(w.lead.act("POST", f"/api/releases/{rid}/share", {"expires_at": _server_time(w.lead, 60)}), "assembling", "shared")
    illegal(w.lead.act("POST", f"/api/releases/{rid}/withdraw"), "assembling", "withdrawn")
    illegal(w.noor.post(f"/api/releases/{rid}/reopen"), "assembling", "assembling")
    submitted = _ok(w.noor.act("POST", f"/api/releases/{rid}/submit"))
    illegal(w.noor.act("POST", f"/api/releases/{rid}/submit"), "submitted", "submitted")
    assert _refused(w.noor.post(f"/api/releases/{rid}/items", {"derivative_id": _rendered(w)["id"], "label": "x"}), 409, "release_locked")["state"] == "submitted"
    _refused(w.noor.request("DELETE", f"/api/releases/{rid}/items/{submitted['items'][0]['id']}"), 409, "release_locked")
    assert _claim(w.lead, submitted["items"][0]["derivative_id"]).status_code == 200
    assert _claim(w.lead2, submitted["items"][0]["derivative_id"]).status_code == 200
    calls = []
    for api in (w.lead, w.lead2, w.lead, w.lead2):
        calls.append((api, api.proof(), "sign-off", {"manifest_digest": submitted["manifest_digest"]}))
    for api in (w.lead, w.lead2):
        calls.append((api, api.proof(), "reject", {"reason": GOOD_REASON}))
    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        answers = list(pool.map(lambda c: c[0].post(f"/api/releases/{rid}/{c[2]}", c[3], proof=c[1]), calls))
    assert sorted(a.status_code for a in answers) == [200] + [409] * 5, [a.text for a in answers]
    assert all(a.json()["error"] == "illegal_transition" for a in answers if a.status_code == 409)
    decided = len(_rows(pg, f"action IN ('release.signed_off', 'release.rejected') AND target = {_q(rid)}"))
    assert decided == 1
    assert len(pg.rows(f"SELECT recipient FROM mail_outbox WHERE subject LIKE {_q('Release ' + rid + ' %')}")) == 1
    other = _world(app_url)
    rejected = _submitted(other)
    _ok(other.lead.act("POST", f"/api/releases/{rejected['id']}/reject", {"reason": GOOD_REASON}))
    _refused(other.lead.post(f"/api/releases/{rejected['id']}/reopen"), 403, "forbidden")


def test_separated_sign_off(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    exhibit = _cleared(w)
    _save(w.lead, exhibit["id"], [REGION])
    derivative = _ok(w.noor.post(f"/api/exhibits/{exhibit['id']}/derivatives"), 201)
    other_exhibit = _cleared(w)
    _save(w.noor, other_exhibit["id"], [REGION])
    rendered_by_lead = _ok(w.lead.post(f"/api/exhibits/{other_exhibit['id']}/derivatives"), 201)
    third = _rendered(w)
    release = _ok(w.lead2.post(f"/api/compartments/{w.cid}/releases", {"name": unique("R")[0], "matter_ref": "M-1", "recipient_kind": "counsel"}), 201)
    rid = release["id"]
    _ok(w.noor.post(f"/api/releases/{rid}/items", {"derivative_id": third["id"], "label": "Third"}), 201)
    submitted = _ok(w.noor.act("POST", f"/api/releases/{rid}/submit"))
    for api, body in ((w.lead2, {"manifest_digest": submitted["manifest_digest"]}),):
        proof = api.proof()
        before = _count(pg, "access.denied", rid)
        _refused(api.post(f"/api/releases/{rid}/sign-off", body, proof=proof), 403, "separation_of_duties")
        _refused(api.post(f"/api/releases/{rid}/reject", {"reason": GOOD_REASON}, proof=proof), 403, "separation_of_duties")
        rows = _rows(pg, f"action = 'access.denied' AND target = {_q(rid)}")
        assert len(rows) == before + 2 and rows[-1]["detail"]["code"] == "separation_of_duties"
        assert api.post(f"/api/exhibits/{_cleared(w)['id']}/hold", {"reason": GOOD_REASON, "matter_ref": "M-1"}, proof=proof).status_code == 200
    assert set(_ok(w.lead.get(f"/api/releases/{rid}"))["contributor_ids"]) >= {"USR-06"}
    for derived, label in ((derivative, "Marks saved by the lead"), (rendered_by_lead, "Rendered by the lead")):
        worker = _world(app_url)
        package = _ok(w.noor.post(f"/api/compartments/{w.cid}/releases", {"name": unique("R")[0], "matter_ref": "M-1", "recipient_kind": "counsel"}), 201)
        added = _ok(w.noor.post(f"/api/releases/{package['id']}/items", {"derivative_id": derived["id"], "label": label}), 201)
        current = _ok(w.noor.act("POST", f"/api/releases/{package['id']}/submit"))
        assert "USR-01" in current["contributor_ids"], current
        _refused(w.lead.act("POST", f"/api/releases/{package['id']}/sign-off", {"manifest_digest": current["manifest_digest"]}), 403, "separation_of_duties")
        assert worker and added
    package = _ok(w.noor.post(f"/api/compartments/{w.cid}/releases", {"name": unique("R")[0], "matter_ref": "M-1", "recipient_kind": "counsel"}), 201)
    fresh = _rendered(w)
    added = _ok(w.lead2.post(f"/api/releases/{package['id']}/items", {"derivative_id": fresh["id"], "label": "Added then gone"}), 201)
    _ok(w.lead2.request("DELETE", f"/api/releases/{package['id']}/items/{added['items'][0]['id']}"))
    _ok(w.noor.post(f"/api/releases/{package['id']}/items", {"derivative_id": fresh["id"], "label": "Kept"}), 201)
    current = _ok(w.noor.act("POST", f"/api/releases/{package['id']}/submit"))
    _refused(w.lead2.act("POST", f"/api/releases/{package['id']}/reject", {"reason": GOOD_REASON}), 403, "separation_of_duties")
    assert _ok(w.lead.act("POST", f"/api/releases/{package['id']}/reject", {"reason": GOOD_REASON}))["state"] == "rejected"
    assert current["state"] == "submitted"


def test_decision_notice(app_url: str, mail: Any) -> None:
    pg = Postgres()
    w = _world(app_url)
    exhibit_name = unique("Private Exhibit Name")[0]
    signed = _signed_off(w, derivative=_rendered(w, _cleared(w, name=exhibit_name)["id"]))
    assert signed["notice"] == "queued"
    rejected_release = _submitted(w)
    reason = "Rejection reason that must stay private"
    rejected = _ok(w.lead.act("POST", f"/api/releases/{rejected_release['id']}/reject", {"reason": reason}))
    assert rejected["notice"] == "queued"
    for release, word in ((signed, "signed off"), (rejected, "rejected")):
        subject = f"Release {release['id']} {word}"
        rows = pg.rows(f"SELECT recipient, status FROM mail_outbox WHERE subject = {_q(subject)}")
        assert len(rows) == 1 and PEOPLE["noor"][2] in rows[0]["recipient"]
        message = _mail(mail, subject)
        assert PEOPLE["noor"][2] in addresses(message["To"]) and mail_from_address() in addresses(message["From"])
        body = text_of(message).replace("\r\n", "\n").strip()
        assert body == f"Release {release['id']} was {word} by Tamsin Oduya.\nOpen Wardline to read the decision."
        for private in (exhibit_name, reason, w.name):
            assert private not in body
        _poll(lambda: pg.rows(f"SELECT status FROM mail_outbox WHERE subject = {_q(subject)}")[0]["status"] == "sent", 10, "outbox sent")


def test_dialogs_keyboard_and_refreshes(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    release = _submitted(w)
    with _page(browser, app_url, "tamsin", f"/releases/{release['id']}") as page:
        opener = _btn(page, "Reject")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = _role(page, "dialog", "Step-up")
        reason = _box(dialog, "Reason")
        expect(reason).to_be_focused()
        inside = "d => d.contains(document.activeElement)"
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert dialog.evaluate(inside), key
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        assert _ok(w.lead.get(f"/api/releases/{release['id']}"))["state"] == "submitted"
        opener.click()
        reason.fill(GOOD_REASON)
        _box(dialog, "Password").fill("not-the-password")
        _box(dialog, "Authenticator code").fill("000000")
        page.keyboard.press("Enter")
        status = _status(dialog, "Step-up status")
        expect(status).to_have_text("Password or code is not right.")
        expect(_box(dialog, "Password")).to_be_focused()
        expect(_box(dialog, "Password")).to_have_value("")
        expect(_box(dialog, "Authenticator code")).to_have_value("")
        expect(reason).to_have_value(GOOD_REASON)
        _same_node_tag(dialog)
        with page.expect_request(lambda r: r.url.endswith("/api/session"), timeout=BANNER_MS):
            pass
        with page.expect_request(lambda r: "/api/releases/" in r.url and r.method == "GET", timeout=LIVE_MS):
            pass
        expect(reason).to_have_value(GOOD_REASON)
        expect(status).to_have_text("Password or code is not right.")
        expect(_box(dialog, "Password")).to_be_focused()
        assert dialog.evaluate("d => d.__kept === true"), "dialog was repainted"
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text(f"Rejected {release['id']}. Assembler notice queued.")
    with _page(browser, app_url, "tamsin", f"/compartments/{w.cid}") as page:
        _btn(page, "Issue grant").click()
        dialog = _role(page, "dialog", "Issue grant")
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), key
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(_btn(page, "Issue grant")).to_be_focused()


def test_sign_off_landing(browser: Browser, app_url: str, mail: Any) -> None:
    w = _world(app_url)
    release = _submitted(w, label="Landing item")
    route = f"/releases/{release['id']}"
    with _page(browser, app_url, "tamsin", "/reviews") as page:
        _role(_role(page, "table", "Review queue"), "link", release["id"]).click()
        expect(page).to_have_url(app_url + route)
        with page.expect_download():
            _btn(page, "Open Landing item").click()
        expect(page.get_by_text("Opened").first).to_be_visible(timeout=LIVE_MS)
        _btn(page, "Sign off").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text(f"Signed off {release['id']}. Assembler notice queued.")
        expect(page).to_have_url(app_url + route)
        expect(_status(page, "Release state")).to_have_text("Signed off")
        page.reload()
        expect(page).to_have_url(app_url + route)
        expect(_status(page, "Release state")).to_have_text("Signed off")
    assert _ok(w.lead.get(f"/api/releases/{release['id']}"))["state"] == "signed off"
    assert _mail(mail, f"Release {release['id']} signed off")


def test_sign_off_manifest(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    release = _submitted(w, label="First")
    rid = release["id"]
    for item in release["items"]:
        assert _claim(w.lead, item["derivative_id"]).status_code == 200
    proof = w.lead.proof()
    stale = w.lead.post(f"/api/releases/{rid}/sign-off", {"manifest_digest": "0" * 64}, proof=proof)
    assert stale.status_code == 409 and stale.json() == {"error": "release_changed", "manifest_digest": release["manifest_digest"]}
    malformed = w.lead.post(f"/api/releases/{rid}/sign-off", {"manifest_digest": "x\u0000y"}, proof=proof)
    assert malformed.status_code == 409 and malformed.json()["error"] == "release_changed"
    missing = w.lead.post(f"/api/releases/{rid}/sign-off", {}, proof=proof)
    assert missing.status_code == 422 and missing.json()["errors"]["manifest_digest"] == "This field is required."
    sent = []
    with _page(browser, app_url, "tamsin", f"/releases/{rid}") as page:
        page.on("request", lambda r: sent.append(json.loads(r.post_data)) if r.url.endswith("/sign-off") else None)
        state = _status(page, "Release state")
        expect(state).to_have_attribute("data-manifest-digest", release["manifest_digest"])
        _btn(page, "Sign off").click()
        expect(_role(page, "dialog", "Step-up")).to_be_visible()
        _ok(w.lead2.act("POST", f"/api/releases/{rid}/reject", {"reason": GOOD_REASON}))
        _ok(w.noor.post(f"/api/releases/{rid}/reopen"))
        changed = _ok(w.noor.post(f"/api/releases/{rid}/items", {"derivative_id": _rendered(w)["id"], "label": "Second"}), 201)
        _ok(w.noor.act("POST", f"/api/releases/{rid}/submit"))
        expect(state).to_have_attribute("data-manifest-digest", changed["manifest_digest"], timeout=LIVE_MS)
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text("This release changed while you were reviewing it. Review it again.")
    assert sent == [{"manifest_digest": release["manifest_digest"]}]
    assert _ok(w.lead.get(f"/api/releases/{rid}"))["state"] == "submitted"


def test_open_every_item(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    first, second = _rendered(w), _rendered(w)
    release = _assembling(w, first, "First item")
    release = _ok(w.noor.post(f"/api/releases/{release['id']}/items", {"derivative_id": second["id"], "label": "Second item"}), 201)
    rid = release["id"]
    release = _ok(w.noor.act("POST", f"/api/releases/{rid}/submit"))
    ordered = sorted(release["items"], key=lambda i: i["id"])
    proof = w.lead.proof()
    body = {"manifest_digest": release["manifest_digest"]}
    answer = w.lead.post(f"/api/releases/{rid}/sign-off", body, proof=proof)
    assert answer.status_code == 409 and answer.json() == {"error": "items_unopened", "item_ids": [i["id"] for i in ordered]}
    _ok(w.lead.post(f"/api/derivatives/{first['id']}/download-grants"), 201)
    assert _claim(w.lead2, first["id"]).status_code == 200
    assert w.lead.post(f"/api/releases/{rid}/sign-off", body, proof=proof).json()["item_ids"] == [i["id"] for i in ordered]
    token = _ok(w.lead.post(f"/api/derivatives/{first['id']}/download-grants"), 201)["token"]
    _refused(httpx.get(f"{_storage_down()}/api/download/{token}", timeout=HTTP_TIMEOUT), 503, "storage_unavailable")
    assert len(w.lead.post(f"/api/releases/{rid}/sign-off", body, proof=proof).json()["item_ids"]) == 2
    with _page(browser, app_url, "tamsin", f"/releases/{rid}") as page:
        assert not any(i["opened_by_caller"] for i in _ok(w.lead.get(f"/api/releases/{rid}"))["items"])
        _btn(page, "Sign off").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text(f"Open every item before signing off. Not opened yet: {len(ordered)}.")
        with page.expect_download():
            _btn(page, "Open First item").click()
        _poll(lambda: [i["opened_by_caller"] for i in sorted(_ok(w.lead.get(f"/api/releases/{rid}"))["items"],
                                                             key=lambda i: i["id"])] == [True, False],
              LIVE_MS / 1000, "first item opened")
    assert [i["opened_by_caller"] for i in sorted(_ok(w.lead.get(f"/api/releases/{rid}"))["items"], key=lambda i: i["id"])] == [True, False]
    answer = w.lead.post(f"/api/releases/{rid}/sign-off", body, proof=proof)
    assert answer.json()["item_ids"] == [ordered[1]["id"]]
    assert _claim(w.lead, second["id"]).status_code == 200
    assert _ok(w.lead.post(f"/api/releases/{rid}/sign-off", body, proof=proof))["state"] == "signed off"
    detail = _rows(pg, f"action = 'release.signed_off' AND target = {_q(rid)}")[0]["detail"]
    assert detail["manifest_digest"] == release["manifest_digest"] and sorted(detail["opened_items"]) == [i["id"] for i in ordered]
    rejected = _submitted(w)
    assert _ok(w.lead2.act("POST", f"/api/releases/{rejected['id']}/reject", {"reason": GOOD_REASON}))["state"] == "rejected"


def test_live_review_queue(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    first, second = _submitted(w), _submitted(w)
    with _page(browser, app_url, "rafael", "/reviews") as page:
        table = _role(page, "table", "Review queue")
        count = _status(page, "Review queue count")
        expect(_role(table, "link", second["id"])).to_be_visible()
        links = lambda: [e.strip() for e in table.get_by_role("link").all_inner_texts()]
        before = links()
        expect(count).to_have_text(f"{len(before)} waiting for a decision.")
        kept = table.get_by_role("row").filter(has=_role(page, "link", second["id"]))
        _same_node_tag(kept)
        third = _submitted(w)
        expect(_role(table, "link", third["id"])).to_be_visible(timeout=LIVE_MS)
        expect(count).to_have_text(f"{len(before) + 1} waiting for a decision.", timeout=LIVE_MS)
        assert kept.evaluate("e => e.__kept === true")
        order = links()
        at = order.index(first["id"])
        fallback = order[at + 1] if at + 1 < len(order) else order[at - 1]
        _role(table, "link", first["id"]).focus()
        _ok(w.lead.act("POST", f"/api/releases/{first['id']}/reject", {"reason": GOOD_REASON}))
        expect(_role(table, "link", first["id"])).to_have_count(0, timeout=LIVE_MS)
        expect(count).to_have_text(f"{len(before)} waiting for a decision.", timeout=LIVE_MS)
        expect(_role(table, "link", fallback)).to_be_focused()
        expect(_btn(page, "Sign off")).to_have_count(0)
    for release in (second, third):
        _ok(w.lead.act("POST", f"/api/releases/{release['id']}/reject", {"reason": GOOD_REASON}))


def test_wf_share_and_collect_counsel(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit_name = unique("Internal Exhibit")[0]
    derivative = _rendered(w, _cleared(w, name=exhibit_name)["id"])
    other = _rendered(w)
    unrelated = _assembling(w, other, "Unrelated")
    release = _signed_off(w, derivative=derivative, label="Gate photograph, redacted")
    with _page(browser, app_url, "tamsin", f"/releases/{release['id']}") as page:
        _box(page, "Link lapses at").fill(_server_time(w.lead, 86400))
        _btn(page, "Share").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text(f"Shared {release['id']}. Every derivative is confirmed present.")
        expect(_status(page, "Release state")).to_have_text("Shared")
        link = _role(page, "link", "Share link")
        address = link.get_attribute("href")
        token = address.rsplit("/l/", 1)[1]
        expect(link).to_contain_text(f"/l/{token}")
    with _page(browser, app_url) as holder:
        holder.goto(f"{app_url}/l/{token}")
        matter = "M-2026-041"
        expect(holder.get_by_role("heading", name=f"Disclosure for matter {matter}")).to_be_visible()
        _figure_is(holder, "1")
        expect(_role(holder, "list", "Release items").get_by_role("listitem")).to_have_count(1)
        expect(holder.get_by_text(exhibit_name)).to_have_count(0)
        expect(holder.get_by_text(unrelated["name"])).to_have_count(0)
        with holder.expect_download() as download:
            _btn(holder, "Collect Gate photograph, redacted").click()
        label = "Gate photograph, redacted"
        expect(_status(holder, "Collection status")).to_have_text(f"Collected {label}. Digest matches.")
        assert hashlib.sha256(Path(download.value.path()).read_bytes()).hexdigest() == derivative["sha256"]
        before = _ok(w.lead.get(f"/api/releases/{release['id']}"))
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            _refused(httpx.request(method, f"{app_url}/api/links/{token}", json={}, timeout=HTTP_TIMEOUT), 405, "method_not_allowed")
        assert _ok(w.lead.get(f"/api/releases/{release['id']}"))["state"] == before["state"] == "shared"
        body = _ok(httpx.get(f"{app_url}/api/links/{token}", timeout=HTTP_TIMEOUT))
        assert set(body) == {"reference", "name", "matter_ref", "recipient_kind", "manifest_digest", "items"}
        assert [i["sha256"] for i in body["items"]] == [derivative["sha256"]]
        for private in (exhibit_name, derivative["exhibit_id"], "USR-06"):
            assert private not in json.dumps(body)
        _refused(httpx.post(f"{app_url}/api/links/{token}/items/{unrelated['items'][0]['id']}/grant", json={}, timeout=HTTP_TIMEOUT), 404, "not_found")
        with _page(browser, app_url, "tamsin", f"/releases/{release['id']}") as page:
            _btn(page, "Revoke link").click()
            _step_up(page, "tamsin")
            expect(_status(page, "Action status")).to_have_text("Link revoked.")
        holder.reload()
        expect(holder.get_by_role("heading", name="Nothing to show at this address.")).to_be_visible()


def test_wf_share_and_collect_requester_link_dies(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    release, link = _shared(w, recipient="requester", label="Your record")
    with _page(browser, app_url, route=f"/l/{link['token']}") as holder:
        expect(holder.get_by_role("heading", name="Your disclosure")).to_be_visible()
        expect(_role(holder, "link", "Compartments")).to_have_count(0)
        expect(_btn(holder, "Sign out")).to_have_count(0)
        fresh = _ok(w.lead.act("POST", f"/api/releases/{release['id']}/link/regenerate", {"expires_at": _server_time(w.lead, 3600)}), 201)
        assert fresh["link_id"] != link["link_id"] and fresh["token"] != link["token"]
        _btn(holder, "Collect Your record").click()
        expect(holder.get_by_role("heading", name="Nothing to show at this address.")).to_be_visible()
        assert holder.url.endswith(f"/l/{link['token']}")
        holder.goto(f"{app_url}/l/{fresh['token']}")
        with holder.expect_download():
            _btn(holder, "Collect Your record").click()
        label = "Your record"
        expect(_status(holder, "Collection status")).to_have_text(f"Collected {label}. Digest matches.")


def test_confirmed_share(app_url: str) -> None:
    w, bucket = _world(app_url), S3()
    keys = set(bucket.keys("derivatives/"))
    derivative = _rendered(w)
    key = (set(bucket.keys("derivatives/")) - keys).pop()
    stored = bucket.get(key)
    release = _signed_off(w, derivative=derivative)
    path = f"/api/releases/{release['id']}/share"
    lapse = {"expires_at": _server_time(w.lead, 3600)}
    _refused(Api(_storage_down(), "tamsin").act("POST", path, lapse), 503, "storage_unavailable")
    assert _ok(w.lead.get(f"/api/releases/{release['id']}"))["state"] == "signed off"
    _s3_write("PUT", key, stored + b"x")
    _refused(w.lead.act("POST", path, lapse), 409, "derivative_missing")
    _s3_write("DELETE", key)
    _refused(w.lead.act("POST", path, lapse), 409, "derivative_missing")
    assert _ok(w.lead.get(f"/api/releases/{release['id']}"))["state"] == "signed off"
    _s3_write("PUT", key, stored)
    far = w.lead.act("POST", path, {"expires_at": _server_time(w.lead, 91 * 86400)})
    assert far.status_code == 422 and far.json()["errors"]["expires_at"] == "Choose a time within 90 days."
    shared = _ok(w.lead.act("POST", path, lapse), 201)
    assert shared["state"] == "shared" and shared["url"] == f"/l/{shared['token']}" and len(shared["token"]) >= 32
    assert _ok(w.lead.get(f"/api/releases/{release['id']}"))["state"] == "shared"


def test_link_lifecycle(app_url: str) -> None:
    w = _world(app_url)
    release, old = _shared(w)
    rid = release["id"]
    item = release["items"][0]["id"]

    def private(response: httpx.Response) -> httpx.Response:
        assert response.headers["Referrer-Policy"] == "no-referrer" and response.headers["Cache-Control"] == "no-store", response.url
        return response

    assert _ok(private(httpx.get(f"{app_url}/api/links/{old['token']}", timeout=HTTP_TIMEOUT)))["reference"] == rid
    private(httpx.get(f"{app_url}/l/{old['token']}", timeout=HTTP_TIMEOUT))
    grant = _ok(private(httpx.post(f"{app_url}/api/links/{old['token']}/items/{item}/grant", json={}, timeout=HTTP_TIMEOUT)), 201)["token"]
    private(httpx.get(f"{app_url}/api/download/{grant}", timeout=HTTP_TIMEOUT))
    private(httpx.post(f"{app_url}/api/links/{old['token']}", json={}, timeout=HTTP_TIMEOUT))
    new = _ok(w.lead.act("POST", f"/api/releases/{rid}/link/regenerate", {"expires_at": _server_time(w.lead, 3600)}), 201)
    revoked = _ok(w.lead.act("POST", f"/api/releases/{rid}/link/revoke"))
    assert revoked == {"link_id": new["link_id"], "state": "revoked"}
    answer = w.lead.act("POST", f"/api/releases/{rid}/link/revoke")
    assert answer.status_code == 409 and answer.json() == {"error": "illegal_transition", "from": "shared", "to": "shared"}
    lapsing = _ok(w.lead.act("POST", f"/api/releases/{rid}/link/regenerate", {"expires_at": _server_time(w.lead, 2)}), 201)
    _poll(lambda: httpx.get(f"{app_url}/api/links/{lapsing['token']}", timeout=HTTP_TIMEOUT).status_code == 404, 10, "link lapse")
    gone = _ok(w.lead.act("POST", f"/api/releases/{rid}/link/regenerate", {"expires_at": _server_time(w.lead, 3600)}), 201)
    assert _ok(w.lead.act("POST", f"/api/releases/{rid}/withdraw"))["state"] == "withdrawn"
    answer = w.lead.act("POST", f"/api/releases/{rid}/link/regenerate", {"expires_at": _server_time(w.lead, 3600)})
    assert answer.status_code == 409 and answer.json() == {"error": "illegal_transition", "from": "withdrawn", "to": "shared"}
    pages = set()
    for token in (old["token"], new["token"], lapsing["token"], gone["token"], "unknown-" + uuid.uuid4().hex):
        api = private(httpx.get(f"{app_url}/api/links/{token}", timeout=HTTP_TIMEOUT))
        assert api.status_code == 404 and api.json() == {"error": "not_found"}
        page = private(httpx.get(f"{app_url}/l/{token}", timeout=HTTP_TIMEOUT))
        assert page.status_code == 404
        pages.add(page.text.replace(token, ""))
    assert len(pages) == 1


def test_collection_throttle(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    release, link = _shared(w, label="Bulk item")
    grant = f"{app_url}/api/links/{link['token']}/items/{release['items'][0]['id']}/grant"
    for _ in range(THROTTLE_LIMIT):
        _ok(httpx.post(grant, json={}, timeout=HTTP_TIMEOUT), 201)
    for _ in range(2):
        throttled = httpx.post(grant, json={}, timeout=HTTP_TIMEOUT)
        _refused(throttled, 429, "throttled")
        assert 0 < int(throttled.headers["Retry-After"]) <= THROTTLE_WINDOW
    entries = _rows(pg, f"action = 'collection.throttled' AND target = {_q(link['link_id'])}")
    assert len(entries) == 1 and entries[0]["actor_id"] == f"link:{link['link_id']}" and entries[0]["session_id"] is None
    signals = [s for s in _ok(Api(app_url, "sefa").get("/api/signals"))["signals"] if s["kind"] == "bulk_collection" and s["target"] == link["link_id"]]
    assert len(signals) == 1
    with _page(browser, app_url, route=f"/l/{link['token']}") as holder:
        _btn(holder, "Collect Bulk item").click()
        expect(_status(holder, "Collection status")).to_have_text(_published("Collection paused. Try again in <seconds> seconds."))
    with _page(browser, app_url, "sefa", "/ledger/review") as page:
        expect(_role(page, "table", "Signals").get_by_role("row").filter(has_text=link["link_id"])).to_be_visible()


def test_tokens_die_with_authority(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url, extra=("dmitri", "yuki"))
    exhibit = _cleared(w)
    derivative = _rendered(w, exhibit["id"])
    claims = lambda: len(_rows(pg, f"action = 'download.claimed' AND target IN ({_q(exhibit['id'])}, {_q(derivative['id'])})"))
    baseline = claims()
    grants = {g["user_id"]: g for g in _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access"]}
    dead = []
    leaving = Api(app_url, "noor")
    dead.append(_ok(leaving.post(f"/api/exhibits/{exhibit['id']}/download-grants"), 201)["token"])
    assert leaving.post("/api/sign-out").status_code == 204
    dmitri = Api(app_url, "dmitri")
    dead.append(_ok(dmitri.post(f"/api/derivatives/{derivative['id']}/download-grants"), 201)["token"])
    _ok(w.lead.act("POST", f"/api/grants/{grants['USR-07']['id']}/revoke"))
    yuki = Api(app_url, "yuki")
    dead.append(_ok(yuki.post(f"/api/exhibits/{exhibit['id']}/download-grants"), 201)["token"])
    keeps = _ok(yuki.post(f"/api/derivatives/{derivative['id']}/download-grants"), 201)["token"]
    version = _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access_version"]
    _ok(w.lead.act("PATCH", f"/api/grants/{grants['USR-08']['id']}", {"scope": "derivatives", "expires_at": None, "access_version": version}))
    for token in dead:
        _refused(httpx.get(f"{app_url}/api/download/{token}", timeout=HTTP_TIMEOUT), 404, "not_found")
    assert claims() == baseline
    assert httpx.get(f"{app_url}/api/download/{keeps}", timeout=HTTP_TIMEOUT).status_code == 200
    release, link = _shared(w)
    held = _ok(httpx.post(f"{app_url}/api/links/{link['token']}/items/{release['items'][0]['id']}/grant", json={}, timeout=HTTP_TIMEOUT), 201)["token"]
    _ok(w.lead.act("POST", f"/api/releases/{release['id']}/link/revoke"))
    _refused(httpx.get(f"{app_url}/api/download/{held}", timeout=HTTP_TIMEOUT), 404, "not_found")
    doomed = _cleared(w)
    noor = Api(app_url, "noor")
    outstanding = _ok(noor.post(f"/api/exhibits/{doomed['id']}/download-grants"), 201)["token"]
    _ok(w.lead.act("POST", f"/api/exhibits/{doomed['id']}/dispose", {"reason": GOOD_REASON}))
    _ok(w.lead2.act("POST", f"/api/exhibits/{doomed['id']}/dispose/confirm"))
    _refused(httpx.get(f"{app_url}/api/download/{outstanding}", timeout=HTTP_TIMEOUT), 404, "not_found")


def test_stalled_transfers(app_url: str) -> None:
    w, pg, bucket = _world(app_url), Postgres(), S3()
    big = _cleared(w, _png() + b"\0" * DOWNLOAD_PROBE_BYTES)
    keys = set(bucket.keys("originals/"))
    host = urllib.parse.urlsplit(app_url).netloc
    held = [_partial_upload(w.ines, w.cid) for _ in range(STALLED_EACH_WAY)]
    for _ in range(STALLED_EACH_WAY):
        token = _ok(w.noor.post(f"/api/exhibits/{big['id']}/download-grants"), 201)["token"]
        connection = _raw_socket(app_url)
        connection.sendall(f"GET /api/download/{token} HTTP/1.1\r\nHost: {host}\r\n\r\n".encode())
        held.append(connection)
    try:
        calls = (lambda: w.noor.get("/api/health"), lambda: w.noor.get("/api/session"), lambda: w.lead.post("/api/compartments", {"name": unique("During")[0]}))
        for call in calls:
            started = time.monotonic()
            assert call().status_code < 300
            assert time.monotonic() - started < STALL_ANSWER_S
        _poll(lambda: _no_open_transactions(pg), STALL_ANSWER_S * 3, "no transaction during stalls")
    finally:
        for connection in held:
            connection.close()
    _poll(lambda: _no_open_transactions(pg), RELEASE_S, "resources released")
    _poll(lambda: set(bucket.keys("originals/")) == keys, RELEASE_S + 2, "abandoned uploads removed")
    assert w.noor.get("/api/session").status_code == 200
    assert _ok(w.ines.get(f"/api/compartments/{w.cid}/exhibits"))["exhibits"] == [_ok(w.ines.get(f"/api/exhibits/{big['id']}"))] or len(_ok(w.ines.get(f"/api/compartments/{w.cid}/exhibits"))["exhibits"]) == 1


def test_capability_hygiene_and_verified_collection(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    label = "Checked item"
    release, link = _shared(w, label=label)
    download = _ok(w.noor.post(f"/api/exhibits/{_cleared(w)['id']}/download-grants"), 201)["token"]
    proof = w.noor.proof()
    session_value = w.noor.cookie.split("=", 1)[1]
    for secret in (link["token"], download, proof, session_value, SEED_LINK):
        assert _table_hits(pg, secret) == [], secret
    with _page(browser, app_url, route=f"/l/{link['token']}") as holder:
        downloads = []
        holder.on("download", lambda download: downloads.append(download))
        holder.route("**/api/download/*", lambda route: route.fulfill(status=200, content_type="image/png", body=b"altered bytes"))
        _btn(holder, "Collect Checked item").click()
        expect(_status(holder, "Collection status")).to_have_text("This file failed its digest check. Nothing was saved.")
        assert downloads == []
    with _page(browser, app_url, init="Object.defineProperty(Crypto.prototype, 'subtle', {get() { return undefined; }});", route=f"/l/{link['token']}") as holder:
        with holder.expect_download():
            _btn(holder, "Collect Checked item").click()
        expect(_status(holder, "Collection status")).to_have_text(f"Collected {label}. Digest not checked in this browser.")


def test_wf_break_glass_open_and_expire(browser: Browser, app_url: str, mail: Any) -> None:
    base, pg = _short(), Postgres("_short")
    lead = Api(base, "tamsin")
    _poll(lambda: not _ok(lead.get("/api/session"))["break_glass"], BREAK_GLASS_SHORT_SECONDS + 5, "no open break-glass")
    with _page(browser, base, timezone_id="Pacific/Kiritimati") as page:
        page.clock.set_fixed_time(dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc))
        assert page.request.post(base + "/api/sign-in", data={"email": PEOPLE["tamsin"][2], "password": PASSWORD}).status == 200
        page.goto(base + "/compartments")
        _box(page, "Compartment reference").fill("CMP-0002")
        _box(page, "Break-glass reason").fill("Urgent review of a witness file\nsecond line of the reason")
        _btn(page, "Open break-glass").click()
        _step_up(page, "tamsin")
        expect(_status(page, "Action status")).to_have_text(_published("Break-glass open until <time>. Owner notice queued."))
        opened = next(b for b in _ok(lead.get("/api/session"))["break_glass"] if b["compartment_id"] == "CMP-0002")
        clock = opened["ends_at"][11:16]
        expect(_status(page, "Action status")).to_have_text(f"Break-glass open until {clock} UTC. Owner notice queued.")
        page.goto(f"{base}/compartments/{CMP_OTHER}")
        expect(_status(page, "Break-glass time")).to_have_text(f"Break-glass ends at {clock} UTC.")
        assert _ok(lead.get(f"/api/compartments/{CMP_OTHER}"))["caller_scope"] == "full"
        expect(_role(page, "alert", "Access ended")).to_have_text("Your access to this compartment has ended.", timeout=BREAK_GLASS_SHORT_SECONDS * 1000 + LIVE_MS)
        expect(_role(page, "table", "Exhibits")).to_have_count(0)
    fresh = Api(base, "tamsin")
    _refused(fresh.get(f"/api/compartments/{CMP_OTHER}"), 404, "not_found")
    entries = _rows(pg, "action = 'break_glass.opened' AND actor_id = 'USR-01'")
    grant_id = entries[-1]["target"]
    _poll(lambda: _count(pg, "break_glass.ended", grant_id) == 1, SWEEP_S + 2, "ended entry")
    key = unique("key")[0]
    first = fresh.request("POST", f"/api/compartments/{CMP_OTHER}/break-glass", {"reason": "Second review of the same witness file"}, proof=fresh.proof(), headers={"Idempotency-Key": key})
    _ok(first, 201)
    _poll(lambda: fresh.get(f"/api/compartments/{CMP_OTHER}").status_code == 404, BREAK_GLASS_SHORT_SECONDS + 3, "second end")
    replay = fresh.request("POST", f"/api/compartments/{CMP_OTHER}/break-glass", {"reason": "Second review of the same witness file"}, proof=fresh.proof(), headers={"Idempotency-Key": key})
    assert replay.status_code == 201 and replay.json() == first.json() and replay.headers["Idempotent-Replay"] == "true"
    _refused(fresh.get(f"/api/compartments/{CMP_OTHER}"), 404, "not_found")


def test_wf_break_glass_refused_openings(browser: Browser, app_url: str) -> None:
    w = _world(app_url, lead="rafael", second=None)
    outsider = Api(app_url, "tamsin")
    with _page(browser, app_url, "tamsin", "/compartments") as page:
        _box(page, "Compartment reference").fill(w.cid)
        _box(page, "Break-glass reason").fill("too short")
        _btn(page, "Open break-glass").click()
        _step_up(page, "tamsin")
        expect(page.get_by_text("Write a reason of at least 20 characters.").first).to_be_visible()
        expect(_box(page, "Break-glass reason")).to_be_focused()
    _refused(outsider.get(f"/api/compartments/{w.cid}"), 404, "not_found")
    path = f"/api/compartments/{w.cid}/break-glass"
    reason = {"reason": "A written reason of twenty characters or more"}
    _refused(w.lead.act("POST", path, reason), 409, "already_granted")
    no_record = "CMP-9999"
    _refused(outsider.act("POST", f"/api/compartments/{no_record}/break-glass", reason), 404, "not_found")
    assert Api(app_url, "dmitri").act("POST", path, reason).status_code in (403, 404)
    body = _ok(outsider.act("POST", path, reason), 201)
    assert body["state"] == "active" and body["compartment_id"] == w.cid and body["notice"] in ("queued", "held")
    _refused(outsider.act("POST", path, reason), 409, "break_glass_active")


def test_break_glass_notice(app_url: str, mail: Any) -> None:
    w = _world(app_url, lead="rafael", second=None)
    exhibit_name = unique("Secret Exhibit")[0]
    _quarantined(w, name=exhibit_name, source="Private source words")
    reason = "Urgent look\n\nForged: line\u2028next\u0085part of the reason"
    _ok(Api(app_url, "tamsin").act("POST", f"/api/compartments/{w.cid}/break-glass", {"reason": reason}), 201)
    message = _mail(mail, f"Break-glass access opened on {w.cid}")
    assert PEOPLE["rafael"][2] in addresses(message["To"])
    body = text_of(message).replace("\r\n", "\n").strip()
    assert body == f"Break-glass access opened.\nActor: Tamsin Oduya\nReason: Urgent look Forged: line next part of the reason\nCompartment: {w.cid}"
    for private in (exhibit_name, "Private source words", w.name):
        assert private not in body
    entry = _rows(Postgres(), "action = 'break_glass.opened' AND actor_id = 'USR-01'")[-1]
    assert reason in entry["detail"].values() and "via" not in entry["detail"]


def test_break_glass_limits(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url, lead="rafael", second=None)
    exhibit, plain = _cleared(w), _cleared(w)
    submitted = _submitted(w)
    _grant(w.lead, w.cid, "sefa")
    signed_derivative = _rendered(w)
    signed = _signed_off(w, decider=w.lead, derivative=signed_derivative)
    shared = _ok(w.lead.act("POST", f"/api/releases/{signed['id']}/share", {"expires_at": _server_time(w.lead, 3600)}), 201)
    lead = Api(app_url, "tamsin")
    grant = _ok(lead.act("POST", f"/api/compartments/{w.cid}/break-glass", {"reason": "A written reason of twenty characters or more"}), 201)
    proof = lead.proof()
    refusals = [(f"/api/releases/{submitted['id']}/sign-off", {"manifest_digest": submitted["manifest_digest"]}), (f"/api/releases/{submitted['id']}/reject", {"reason": GOOD_REASON}), (f"/api/releases/{signed['id']}/link/revoke", {}), (f"/api/releases/{signed['id']}/link/regenerate", {"expires_at": _server_time(lead, 3600)}), (f"/api/releases/{signed['id']}/withdraw", {}), (f"/api/exhibits/{plain['id']}/dispose", {"reason": GOOD_REASON}), (f"/api/exhibits/{plain['id']}/dispose/confirm", {}), (f"/api/exhibits/{plain['id']}/dispose/cancel", {"reason": GOOD_REASON}), (_revoke_path("USR-09"), {}), (f"/api/compartments/{w.cid}/grants", {"user_id": "USR-07", "scope": "full", "expires_at": None, "access_version": 1})]
    for path, body in refusals:
        _refused(lead.post(path, body, proof=proof), 403, "forbidden")
    denials = [r for r in _rows(pg, f"action = 'access.denied' AND actor_id = 'USR-01' AND target = {_q(plain['id'])}")]
    assert denials and all(r["detail"]["via"] == "break_glass" and r["detail"]["grant_id"] == grant["id"] for r in denials)
    assert _ok(lead.post(f"/api/exhibits/{exhibit['id']}/hold", {"reason": GOOD_REASON, "matter_ref": "M-2026-077"}, proof=proof))["state"] == "held"
    placed = _rows(pg, f"action = 'hold.placed' AND target = {_q(exhibit['id'])}")[-1]["detail"]
    assert placed["via"] == "break_glass" and placed["grant_id"] == grant["id"]
    _refused(lead.act("POST", f"/api/exhibits/{exhibit['id']}/dispose", {"reason": GOOD_REASON}), 409, "legal_hold")
    _refused(lead.act("POST", f"/api/exhibits/{exhibit['id']}/dispose/confirm"), 409, "legal_hold")
    assert _download(lead, f"/api/exhibits/{plain['id']}/download-grants").status_code == 200
    claim = _rows(pg, f"action = 'download.claimed' AND target = {_q(plain['id'])}")[-1]["detail"]
    assert claim["via"] == "break_glass" and claim["grant_id"] == grant["id"]
    version = _ok(w.lead.get(f"/api/compartments/{w.cid}"))["access_version"]
    _refused(w.lead.act("POST", f"/api/grants/{grant['id']}/revoke"), 403, "forbidden")
    _refused(w.lead.act("PATCH", f"/api/grants/{grant['id']}", {"scope": "derivatives", "expires_at": None, "access_version": version}), 403, "forbidden")
    current = _ok(w.lead.get(f"/api/compartments/{w.cid}"))
    assert current["access_version"] == version and next(g for g in current["access"] if g["id"] == grant["id"])["state"] == "active"
    assert shared["link_id"]


def test_auditor_review(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url, lead="rafael", second=None)
    exhibit = _cleared(w)
    lead = Api(app_url, "tamsin")
    grant = _ok(lead.act("POST", f"/api/compartments/{w.cid}/break-glass", {"reason": "A written reason of twenty characters or more"}), 201)
    assert _download(lead, f"/api/exhibits/{exhibit['id']}/download-grants").status_code == 200
    unknown = "EX-" + uuid.uuid4().hex
    _refused(Api(app_url, "noor").get(f"/api/exhibits/{unknown}"), 404, "not_found")
    expected = int(pg.rows(f"SELECT count(*) AS c FROM ledger_entries WHERE detail->>'grant_id' = {_q(grant['id'])}")[0]["c"])
    assert expected >= 1
    with _page(browser, app_url, "sefa", "/ledger/review") as page:
        expect(_role(page, "table", "Denials").get_by_role("row").filter(has_text=unknown)).to_be_visible()
        row = _role(page, "table", "Break-glass use").get_by_role("row").filter(has_text=grant["id"])
        expect(row).to_have_attribute("data-action-count", str(expected))
        expect(_role(page, "table", "Role grants").get_by_role("row").nth(1)).to_be_visible()
        expect(_role(page, "table", "Signals")).to_be_visible()
    entries = _ok(Api(app_url, "sefa").get(f"/api/ledger?after={max(0, int(pg.rows('SELECT max(seq) AS m FROM ledger_entries')[0]['m']) - 50)}&limit=50"))["entries"]
    assert entries and all(e["actor_id"] and "session_id" in e for e in entries)
    denial = _rows(pg, f"target = {_q(unknown)}")[0]
    assert denial["actor_id"] == "USR-06" and denial["session_id"]


def test_wf_legal_hold_and_disposal_overlapping_holds(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    exhibit = _cleared(w)
    path = f"/api/exhibits/{exhibit['id']}"
    with _page(browser, app_url, "tamsin", f"/exhibits/{exhibit['id']}") as page:
        expect(_btn(page, "Place hold")).to_be_visible()
        assert _marked(page, "data-held-marker") == []
        for matter in ("M-2026-077", "M-2026-041"):
            _box(page, "Hold matter").fill(matter)
            _btn(page, "Place hold").click()
            _step_up(page, "tamsin", GOOD_REASON)
            expect(_status(page, "Action status")).to_have_text("Hold placed.")
            _poll(lambda m=matter: any(h["matter_ref"] == m for h in _ok(w.lead.get(f"/api/exhibits/{exhibit['id']}"))["holds"]),
                  LIVE_MS / 1000, "hold recorded")
        _poll(lambda: any("Held" in m["text"] for m in _marked(page, "data-held-marker")), UI_MS / 1000, "held marker")
        _box(page, "Hold matter").fill("M-2026-077")
        _btn(page, "Place hold").click()
        _step_up(page, "tamsin", GOOD_REASON)
        expect(_status(page, "Action status")).to_have_text("This matter already holds this exhibit.")
        _btn(page, "Lift hold M-2026-077").click()
        _step_up(page, "tamsin", GOOD_REASON)
        remaining = 1
        expect(_status(page, "Action status")).to_have_text(f"Hold lifted. Other holds remain: {remaining}.")
        assert _ok(w.lead.get(path))["state"] == "held"
        _btn(page, "Lift hold M-2026-041").click()
        _step_up(page, "tamsin", GOOD_REASON)
        expect(_status(page, "Action status")).to_have_text("Hold lifted.")
        _marked_count(page, "data-held-marker", None, 0)
    assert _ok(w.lead.get(path))["state"] == "cleared" and _ok(w.lead.get(path))["holds"] == []
    rows = _rows(pg, f"target = {_q(exhibit['id'])} AND action IN ('hold.placed', 'hold.lifted')")
    assert [r["action"] for r in rows] == ["hold.placed", "hold.placed", "hold.lifted", "hold.lifted"]
    _refused(w.lead.act("POST", f"{path}/lift-hold", {"hold_id": rows[0]["detail"]["hold_id"], "reason": GOOD_REASON}), 404, "not_found")
    quarantined = _quarantined(w)
    answer = w.lead.act("POST", f"/api/exhibits/{quarantined['id']}/hold", {"reason": GOOD_REASON, "matter_ref": "M-1"})
    assert answer.status_code == 409 and answer.json() == {"error": "illegal_transition", "from": "quarantined", "to": "held"}


def test_wf_legal_hold_and_disposal_two_leads(browser: Browser, app_url: str) -> None:
    w, bucket = _world(app_url), S3()
    keys = set(bucket.keys("originals/"))
    exhibit = _cleared(w)
    key = (set(bucket.keys("originals/")) - keys).pop()
    with _page(browser, app_url, "tamsin", f"/exhibits/{exhibit['id']}") as page:
        _btn(page, "Dispose").click()
        _step_up(page, "tamsin", GOOD_REASON)
        expect(_status(page, "Action status")).to_have_text(f"Disposal proposed for {exhibit['id']}. Another case lead must confirm it.")
        assert key in bucket.keys("originals/")
        if _btn(page, "Confirm disposal").count():
            _btn(page, "Confirm disposal").click()
            _step_up(page, "tamsin")
            expect(_status(page, "Action status")).to_have_text("You proposed this disposal, so another case lead must confirm it.")
        else:
            _refused(w.lead.act("POST", f"/api/exhibits/{exhibit['id']}/dispose/confirm"), 403, "separation_of_duties")
    with _page(browser, app_url, "rafael", f"/exhibits/{exhibit['id']}") as page:
        _btn(page, "Confirm disposal").click()
        _step_up(page, "rafael")
        expect(_status(page, "Action status")).to_have_text(f"Disposed {exhibit['id']}.")
    assert _ok(w.lead.get(f"/api/exhibits/{exhibit['id']}"))["state"] == "disposed"
    assert key not in bucket.keys("originals/")


def test_two_lead_disposal(app_url: str) -> None:
    pg, bucket = Postgres(), S3()
    w = _world(app_url)
    held = _cleared(w)
    _ok(w.lead.act("POST", f"/api/exhibits/{held['id']}/hold", {"reason": GOOD_REASON, "matter_ref": "M-1"}))
    _refused(w.lead.act("POST", f"/api/exhibits/{held['id']}/dispose", {"reason": GOOD_REASON}), 409, "legal_hold")
    _refused(w.lead2.act("POST", f"/api/exhibits/{held['id']}/dispose/confirm"), 409, "legal_hold")
    in_release = _cleared(w)
    release = _assembling(w, _rendered(w, in_release["id"]))
    _refused(w.lead.act("POST", f"/api/exhibits/{in_release['id']}/dispose", {"reason": GOOD_REASON}), 409, "exhibit_in_release")
    assert release["state"] == "assembling"
    proposed = _cleared(w)
    path = f"/api/exhibits/{proposed['id']}"
    _refused(w.noor.act("POST", f"{path}/dispose", {"reason": GOOD_REASON}), 403, "forbidden")
    body = _ok(w.lead.act("POST", f"{path}/dispose", {"reason": GOOD_REASON}))
    assert body["state"] == "disposal proposed" and body["disposal_proposed_by"] == "USR-01"
    _refused(w.lead.act("POST", f"{path}/dispose/confirm"), 403, "separation_of_duties")
    assert _ok(w.lead2.act("POST", f"{path}/dispose/cancel", {"reason": GOOD_REASON}))["state"] == "cleared"
    _ok(w.lead.act("POST", f"{path}/dispose", {"reason": GOOD_REASON}))
    _refused(w.noor.request("PUT", f"{path}/redactions", {"regions": [], "marks_version": 0}), 409, "exhibit_not_cleared")
    after = _ok(w.lead2.act("POST", f"{path}/hold", {"reason": GOOD_REASON, "matter_ref": "M-2"}))
    assert after["state"] == "held" and after["disposal_proposed_by"] is None
    actions = [r["action"] for r in _rows(pg, f"target = {_q(proposed['id'])} AND action IN ('disposal.cancelled', 'hold.placed')")]
    assert actions[-2:] == ["disposal.cancelled", "hold.placed"]
    keys = set(bucket.keys("originals/"))
    raced = _cleared(w, _png(77, 77))
    key = (set(bucket.keys("originals/")) - keys).pop()
    rpath = f"/api/exhibits/{raced['id']}"
    _ok(w.lead.act("POST", f"{rpath}/dispose", {"reason": GOOD_REASON}))
    third = Api(app_url, "rafael")
    proofs = (w.lead2.proof(), third.proof())
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        confirm = pool.submit(w.lead2.post, f"{rpath}/dispose/confirm", {}, proof=proofs[0])
        hold = pool.submit(third.post, f"{rpath}/hold", {"reason": GOOD_REASON, "matter_ref": "M-3"}, proof=proofs[1])
    state = _ok(w.lead.get(rpath))
    if confirm.result().status_code == 200:
        assert hold.result().status_code == 409 and hold.result().json()["error"] == "illegal_transition"
        assert state["state"] == "disposed" and state["holds"] == [] and key not in bucket.keys("originals/")
    else:
        _refused(confirm.result(), 409, "legal_hold")
        assert hold.result().status_code == 200 and state["state"] == "held" and bucket.get(key) == _png(77, 77)


def test_disposal_removes_copies(app_url: str) -> None:
    w, bucket, pg = _world(app_url), S3(), Postgres()
    before = set(bucket.keys())
    name = unique("Disposed Exhibit")[0]
    exhibit = _cleared(w, name=name)
    first = _rendered(w, exhibit["id"])
    second = _ok(w.noor.post(f"/api/exhibits/{exhibit['id']}/derivatives"), 201)
    mine = set(bucket.keys()) - before
    assert len(mine) == 3
    path = f"/api/exhibits/{exhibit['id']}"
    _ok(w.lead.act("POST", f"{path}/dispose", {"reason": GOOD_REASON}))
    _refused(Api(_storage_down(), "rafael").act("POST", f"{path}/dispose/confirm"), 503, "storage_unavailable")
    assert _ok(w.lead.get(path))["state"] == "disposal proposed" and mine <= set(bucket.keys())
    _s3_write("DELETE", sorted(k for k in mine if k.startswith("derivatives/"))[0])
    done = _ok(w.lead2.act("POST", f"{path}/dispose/confirm"))
    assert done["state"] == "disposed" and done["sha256"] == exhibit["sha256"] and done["size"] == exhibit["size"]
    assert not (mine & set(bucket.keys()))
    assert _ok(w.noor.get(f"/api/derivatives/{first['id']}"))["disposed"] is True and _ok(w.noor.get(f"/api/derivatives/{second['id']}"))["sha256"] == first["sha256"]
    assert _ok(w.noor.get(f"{path}/redactions")) == {"regions": [], "marks_version": 1}
    _refused(w.noor.post(f"{path}/download-grants"), 409, "exhibit_not_cleared")
    _refused(w.noor.post(f"/api/derivatives/{first['id']}/download-grants"), 409, "exhibit_not_cleared")
    assert _ok(w.noor.get(f"/api/search?q={urllib.parse.quote(name)}"))["results"] == []
    assert _ok(w.lead.get(f"/api/compartments/{w.cid}"))["exhibit_count"] == 0
    assert _count(pg, "exhibit.disposed", exhibit["id"]) == 1


STORAGE_BANNER = "Exhibit storage is unreachable. Registration and downloads are paused; nothing has been lost."
MAIL_BANNER = "The mail relay is unreachable. Notices are held and will send when it returns."


def test_wf_outage_recovery_storage_screens(browser: Browser, app_url: str) -> None:
    base = _storage_down()
    w = _world(app_url)
    exhibit = _cleared(w)
    title = unique("Refused In Outage")[0]
    with _page(browser, base, "ines", "/intake") as page:
        expect(_role(page, "alert", "Service notice")).to_have_text(STORAGE_BANNER, timeout=BANNER_MS)
        _fill_intake(page, w.name, title)
        _btn(page, "Register exhibit").click()
        expect(_status(page, "Intake status")).to_have_text("Not registered. Exhibit storage is unreachable, and nothing was kept. Try again when the notice clears.")
    assert _by_name(w.ines, w.cid, title) == []
    with _page(browser, base, "noor", f"/exhibits/{exhibit['id']}") as page:
        expect(_status(page, "Redaction status")).to_have_text("Preview unavailable. Exhibit storage is unreachable.")
        _btn(page, "Download original").click()
        expect(_status(page, "Action status")).to_have_text("Download unavailable. Exhibit storage is unreachable. Your grant is still unused.")
    with _page(browser, app_url, "noor", f"/exhibits/{exhibit['id']}") as page:
        expect(_status(page, "Redaction status")).to_have_text("Preview loaded.")
        expect(_role(page, "alert", "Service notice")).to_have_count(0)


def test_wf_outage_recovery_mail_held(browser: Browser, app_url: str, mail: Any) -> None:
    w = _world(app_url)
    release = _submitted(w)
    with _page(browser, _mail_down(), "tamsin", f"/releases/{release['id']}") as page:
        expect(_role(page, "alert", "Service notice")).to_have_text(MAIL_BANNER, timeout=BANNER_MS)
        _btn(page, "Reject").click()
        _step_up(page, "tamsin", GOOD_REASON)
        expect(_status(page, "Action status")).to_have_text(f"Rejected {release['id']}. Notice held. It will send when the mail relay returns.")
    assert _ok(w.lead.get(f"/api/releases/{release['id']}"))["state"] == "rejected"
    assert _mail(mail, f"Release {release['id']} rejected")


def test_storage_outage(app_url: str) -> None:
    w = _world(app_url)
    down = _storage_down()
    assert _status_json(down)["storage"] == "down" and _status_json(app_url)["storage"] == "up"
    ines, kofi, noor, lead, lead2 = (Api(down, n) for n in ("ines", "kofi", "noor", "tamsin", "rafael"))
    quarantined, cleared = _quarantined(w), _cleared(w)
    release, link = _shared(w)
    signed = _signed_off(w)
    proposed = _cleared(w)
    _ok(w.lead.act("POST", f"/api/exhibits/{proposed['id']}/dispose", {"reason": GOOD_REASON}))
    token = _ok(w.noor.post(f"/api/exhibits/{cleared['id']}/download-grants"), 201)["token"]
    refusals = [
        _upload(ines, w.cid, _png()),
        kofi.act("POST", f"/api/exhibits/{quarantined['id']}/clear"),
        noor.post(f"/api/exhibits/{cleared['id']}/preview-grants", {"page": 1}),
        noor.post(f"/api/exhibits/{cleared['id']}/redactions/find", {"text": "word"}),
        noor.post(f"/api/exhibits/{cleared['id']}/derivatives"),
        httpx.get(f"{down}/api/download/{token}", timeout=HTTP_TIMEOUT),
        lead.act("POST", f"/api/releases/{signed['id']}/share", {"expires_at": _server_time(lead, 3600)}),
        lead.act("POST", f"/api/releases/{release['id']}/link/regenerate", {"expires_at": _server_time(lead, 3600)}),
        httpx.post(f"{down}/api/links/{link['token']}/items/{release['items'][0]['id']}/grant", json={}, timeout=HTTP_TIMEOUT),
        lead2.act("POST", f"/api/exhibits/{proposed['id']}/dispose/confirm"),
    ]
    for response in refusals:
        _refused(response, 503, "storage_unavailable")
    assert _ok(w.kofi.get(f"/api/exhibits/{quarantined['id']}"))["state"] == "quarantined"
    assert _ok(w.lead.get(f"/api/releases/{signed['id']}"))["state"] == "signed off"
    assert _ok(httpx.get(f"{down}/api/links/{link['token']}", timeout=HTTP_TIMEOUT))["reference"] == release["id"]
    assert _ok(kofi.act("POST", f"/api/exhibits/{quarantined['id']}/refuse", {"reason": GOOD_REASON}))["state"] == "refused"
    assert _ok(lead.act("POST", f"/api/exhibits/{cleared['id']}/hold", {"reason": GOOD_REASON, "matter_ref": "M-1"}))["state"] == "held"
    assert _ok(lead.act("POST", f"/api/exhibits/{proposed['id']}/dispose/cancel", {"reason": GOOD_REASON}))["state"] == "cleared"
    assert _grant(lead, w.cid, "dmitri")["state"] == "active"
    submitted = _submitted(w)
    assert _claim(w.lead, submitted["items"][0]["derivative_id"]).status_code == 200
    assert _ok(lead.act("POST", f"/api/releases/{submitted['id']}/sign-off", {"manifest_digest": submitted["manifest_digest"]}))["state"] == "signed off"


def test_mail_outage(app_url: str, mail: Any) -> None:
    pg = Postgres()
    down = _mail_down()
    assert _status_json(down)["mail"] == "down" and _status_json(app_url)["mail"] == "up"
    w = _world(app_url, lead="rafael", second=None)
    outsider = Api(down, "tamsin")
    body = _ok(outsider.act("POST", f"/api/compartments/{w.cid}/break-glass", {"reason": "A written reason of twenty characters or more"}), 201)
    assert body["notice"] == "held"
    subject = f"Break-glass access opened on {w.cid}"
    assert len(pg.rows(f"SELECT status FROM mail_outbox WHERE subject = {_q(subject)}")) == 1
    other = _world(app_url)
    release = _submitted(other)
    assert _claim(other.lead, release["items"][0]["derivative_id"]).status_code == 200
    decided = _ok(Api(down, "tamsin").act("POST", f"/api/releases/{release['id']}/sign-off", {"manifest_digest": release["manifest_digest"]}))
    assert decided["state"] == "signed off" and decided["notice"] == "held"
    for wanted in (subject, f"Release {release['id']} signed off"):
        _mail(mail, wanted)
        assert sum(m.get(SUBJECT_FIELD) == wanted for m in mail.messages(0, 1.5)) == 1


def test_recovery_without_restart(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    storage, smtp = _s3_relay(up=False), _smtp_relay(up=False)
    try:
        with _copy(S3_ENDPOINT=f"http://127.0.0.1:{storage.port}", SMTP_HOST="127.0.0.1", SMTP_PORT=str(smtp.port)) as (base, process):
            _poll(lambda: _status_json(base) == {"storage": "down", "mail": "down"},
                  BANNER_MS / 1000, "status down")
            assert Api(base, "ines").get("/api/session").status_code == 200
            _refused(_upload(Api(base, "ines"), w.cid, _png()), 503, "storage_unavailable")
            with _page(browser, base, "ines", "/intake") as page:
                banner = page.get_by_role("alert", name="Service notice")
                expect(banner.first).to_contain_text("Exhibit storage is unreachable.", timeout=BANNER_MS)
                page.evaluate("window.__sameDocument = true")
                storage.set_up(True)
                smtp.set_up(True)
                _poll(lambda: _status_json(base) == {"storage": "up", "mail": "up"}, BANNER_MS / 1000, "status up")
                expect(banner).to_have_count(0, timeout=BANNER_MS)
                assert page.evaluate("window.__sameDocument") is True
            assert _upload(Api(base, "ines"), w.cid, _png()).status_code == 201
            assert process.poll() is None
    finally:
        storage.stop()
        smtp.stop()


def test_form_survives_outage_notices(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    title = unique("Survivor")[0]
    storage = _s3_relay()
    try:
        with _copy(S3_ENDPOINT=f"http://127.0.0.1:{storage.port}") as (base, _):
            with _page(browser, base, "ines", "/intake") as page:
                _fill_intake(page, w.name, title)
                notes = _box(page, "Capture notes")
                typed = "Typed through the outage"
                notes.fill(typed)
                storage.set_up(False)
                banner = _role(page, "alert", "Service notice")
                notes.focus()
                expect(banner).to_have_text(STORAGE_BANNER, timeout=BANNER_MS)
                expect(notes).to_be_focused()
                _btn(page, "Register exhibit").click()
                copy = "Not registered. Exhibit storage is unreachable, and nothing was kept. Try again when the notice clears."
                status = _status(page, "Intake status")
                expect(status).to_have_text(copy)
                storage.set_up(True)
                expect(banner).to_have_count(0, timeout=BANNER_MS)
                expect(status).to_have_text(copy)
                expect(_box(page, "Exhibit name")).to_have_value(title)
                expect(notes).to_have_value(typed)
                assert page.get_by_label("File", exact=True).evaluate("e => e.files.length") == 1
                _btn(page, "Register exhibit").click()
                expect(status).to_have_text(_published(SEALED_COPY))
    finally:
        storage.stop()
    assert len(_by_name(w.ines, w.cid, title)) == 1


def test_storage_denied(browser: Browser, app_url: str) -> None:
    base = _storage_denied()
    w = _world(app_url)
    exhibit, quarantined = _cleared(w), _quarantined(w)
    assert _status_json(base)["storage"] == "down"
    noor, ines, kofi = Api(base, "noor"), Api(base, "ines"), Api(base, "kofi")
    assert _ok(noor.get(f"/api/exhibits/{exhibit['id']}"))["sha256"] == exhibit["sha256"]
    _refused(_upload(ines, w.cid, _png()), 503, "storage_unavailable")
    _refused(kofi.act("POST", f"/api/exhibits/{quarantined['id']}/clear"), 503, "storage_unavailable")
    _refused(noor.post(f"/api/exhibits/{exhibit['id']}/preview-grants", {"page": 1}), 503, "storage_unavailable")
    _refused(noor.post(f"/api/exhibits/{exhibit['id']}/derivatives"), 503, "storage_unavailable")
    with _page(browser, base, "noor", f"/exhibits/{exhibit['id']}") as page:
        expect(_role(page, "alert", "Service notice")).to_have_text(STORAGE_BANNER, timeout=BANNER_MS)
        expect(_status(page, "Redaction status")).to_have_text("Preview unavailable. Exhibit storage is unreachable.")


@contextlib.contextmanager
def _walk(browser: Browser, base: str, entries: list[dict], route: str = "/ledger", **kw: Any) -> Iterator[tuple[Page, list[str]]]:
    with _page(browser, base, "sefa", **kw) as page:
        queries = _serve_ledger(page, entries)
        page.goto(base + route)
        yield page, queries


def _cells(page: Page) -> str:
    return "".join(m["text"] for m in _marked(_role(page, "region", "Digest panel"), "data-digest-cell"))


def _slider(page: Page) -> Locator:
    return _role(page, "slider", "Ledger walk")


def _slider_value(locator: Locator) -> str:
    return locator.evaluate("e => e.getAttribute('aria-valuenow') ?? String(e.value ?? '')")


def _slider_max(locator: Locator) -> str:
    return locator.evaluate("e => e.getAttribute('aria-valuemax') ?? String(e.max ?? '')")


def _slider_is(locator: Locator, value: str, what: str = "slider value") -> None:
    _poll(lambda: _slider_value(locator) == value, UI_MS / 1000, f"{what} {value}")


def _walk_loaded(page: Page) -> None:
    _poll(lambda: int(_slider_max(_slider(page)) or 0) > 0, UI_MS / 1000, "ledger loaded")


def _chain_walk(page: Page) -> Locator:
    return _role(page, "region", "Chain Walk")


def _press_slider(page: Page, *keys: str) -> None:
    _slider(page).focus()
    for key in keys:
        page.keyboard.press(key)


def _lattice(page: Page) -> Locator:
    return _role(page, "region", "Lattice")


def test_wf_chain_walk_keyboard(browser: Browser, app_url: str) -> None:
    pg = Postgres()
    Api(app_url, "sefa")
    rows = {r["seq"]: r for r in _rows(pg, "seq <= 12")}
    with _page(browser, app_url, "sefa", "/ledger") as page:
        region = _chain_walk(page)
        expect(region).to_have_attribute("data-verified-through", "0")
        expect(region).to_have_attribute("data-link-state", "idle")
        expect(_role(page, "region", "Digest panel")).to_have_attribute("data-digest-state", "settled")
        assert _cells(page) == ZERO_DIGEST
        expect(_box(page, "Current anchor")).to_have_value("")
        expect(_btn(page, "Copy anchor")).to_be_disabled()
        _press_slider(page, "ArrowUp", "ArrowRight", "ArrowUp")
        expect(region).to_have_attribute("data-verified-through", "3")
        expect(_role(page, "region", "Digest panel")).to_have_attribute("data-digest-state", "settled")
        assert _cells(page) == rows[3]["digest"]
        expect(region).to_have_attribute("data-link-state", "verified")
        _mark_says(page, 3, "Verified")
        _slider_is(_slider(page), "3")
        expect(_slider(page)).to_have_attribute("aria-valuetext", _published("Link <n> of <count>"))
        _figure_is(page, "3")
        expect(_box(page, "Current anchor")).to_have_value(f"wardline-anchor:v1:3:{rows[3]['digest']}")
        page.keyboard.press("ArrowDown")
        expect(_role(page, "region", "Digest panel")).to_have_attribute("data-digest-state", "settled")
        _poll(lambda: _cells(page) == rows[2]["digest"], 5, "earlier digest")
        expect(region).to_have_attribute("data-verified-through", "3")
        page.keyboard.press("PageUp")
        expect(region).to_have_attribute("data-verified-through", "12")
        page.keyboard.press("Home")
        _slider_is(_slider(page), "0")
        expect(region).to_have_attribute("data-link-state", "idle")
        expect(region).to_have_attribute("data-verified-through", "12")
        _role(page, "link", "Chain lattice").click()
        expect(page).to_have_url(app_url + "/audit/chain")
        _role(page, "link", "Chain Walk").click()
        expect(page).to_have_url(app_url + "/ledger")


def test_wf_chain_walk_scroll_and_touch(browser: Browser, app_url: str) -> None:
    entries = _chain(50)
    with _walk(browser, app_url, entries) as (page, _):
        slider = _slider(page)
        _walk_loaded(page)
        _press_slider(page, "ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp")
        _slider_is(slider, "5")
        _poll(lambda: page.evaluate("window.scrollY") or None, 5, "key move scrolls the page")
        at_five = _poll(lambda: page.evaluate(
            """() => new Promise(done => requestAnimationFrame(() => { const first = window.scrollY;
                 requestAnimationFrame(() => done(window.scrollY === first && first ? first : null)); }))"""),
            5, "scroll after the key move rests")
        assert page.evaluate("document.documentElement.scrollHeight") >= len(entries) * WALK_STEP_PX
        page.evaluate("y => window.scrollTo(0, y)", at_five + WALK_STEP_PX * 2)
        _slider_is(slider, "7")
        expect(_chain_walk(page)).to_have_attribute("data-verified-through", "7")
        page.evaluate("y => window.scrollTo(0, y)", at_five - WALK_STEP_PX)
        _slider_is(slider, "4")
        expect(_chain_walk(page)).to_have_attribute("data-verified-through", "7")
    with _walk(browser, app_url, entries, width=375, height=812, touch=True) as (page, _):
        slider = _slider(page)
        slider.scroll_into_view_if_needed()
        box = _rect(slider)
        view = page.viewport_size or {"width": 375, "height": 812}
        left, right = max(box["x"], 2.0), min(box["x"] + box["width"], view["width"] - 2.0)
        top, bottom = max(box["y"], 2.0), min(box["y"] + box["height"], view["height"] - 2.0)
        assert right > left and bottom > top, (box, view)
        centre = ((left + right) / 2, (top + bottom) / 2)
        for dx, dy in ((120, 0), (0, 120), (-120, 0), (0, -120)):
            target = (max(2.0, min(centre[0] + dx, 373.0)), max(2.0, min(centre[1] + dy, 806.0)))
            if target == centre:
                continue
            _touch_drag(page, centre, target)
            if int(_slider_value(slider) or 0) > 0:
                break
        _poll(lambda: int(_slider_value(slider) or 0) > 0, 5, "touch drag moves the head")


def test_wf_chain_walk_tamper_below_application(browser: Browser, app_url: str) -> None:
    base, pg, url = _tamper(), Postgres("_tamper"), os.environ["DATABASE_URL"] + "_tamper"
    original = _rows(pg, "seq = 2")[0]["actor_id"]
    prepared = _psql(url, f"ALTER TABLE ledger_entries DISABLE TRIGGER USER;\nGRANT UPDATE ON ledger_entries TO CURRENT_USER;\nUPDATE ledger_entries SET actor_id = '{TAMPER_ACTOR}' WHERE seq = 2;\n")
    assert prepared.returncode == 0, prepared.stderr
    try:
        with _page(browser, base, "sefa", "/ledger") as page:
            _press_slider(page, "End")
            region = _chain_walk(page)
            expect(region).to_have_attribute("data-link-state", "broken", timeout=LONG_CHAIN_MS)
            expect(region).to_have_attribute("data-verified-through", "1")
            broken = 2
            expect(page.get_by_text(f"Break at link {broken}").first).to_be_visible()
            page.goto(base + "/audit/chain")
            expect(_lattice(page)).to_have_attribute("data-lattice-state", "broken", timeout=LONG_CHAIN_MS)
            expect(_lattice(page)).to_have_attribute("data-broken-link", "2")
    finally:
        restored = _psql(url, f"UPDATE ledger_entries SET actor_id = {_q(original)} WHERE seq = 2;\nREVOKE UPDATE ON ledger_entries FROM CURRENT_USER;\nALTER TABLE ledger_entries ENABLE TRIGGER USER;\n")
        assert restored.returncode == 0, restored.stderr


def test_single_chain(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    exhibit = _cleared(w)
    start = int(pg.rows("SELECT max(seq) AS m FROM ledger_entries")[0]["m"])
    typed = "Cafe\u0301 \U0001F642 \u2028 \"quoted\" \\ back\tslash\nnext line"
    matter = "M-\u00e9"
    _ok(w.lead.act("POST", f"/api/exhibits/{exhibit['id']}/hold", {"reason": "  " + typed + " \n", "matter_ref": matter}))
    apis = [Api(url, "tamsin") for url in (app_url, _storage_down(), _mail_down()) for _ in range(4)]
    with concurrent.futures.ThreadPoolExecutor(len(apis)) as pool:
        answers = list(pool.map(lambda a: a.post("/api/compartments", {"name": unique("Fork")[0]}), apis))
    assert all(a.status_code == 201 for a in answers)
    total = pg.rows("SELECT count(*) AS c, max(seq) AS m, min(seq) AS n FROM ledger_entries")[0]
    assert int(total["c"]) == int(total["m"]) and int(total["n"]) == 1
    rows = _rows(pg, f"seq >= {start}")
    for earlier, later in zip(rows, rows[1:]):
        assert later["seq"] == earlier["seq"] + 1 and later["prev_digest"] == earlier["digest"]
    for row in rows:
        assert row["digest"] == _digest(row["prev_digest"], row), row["seq"]
    placed = _rows(pg, f"action = 'hold.placed' AND target = {_q(exhibit['id'])}")[0]
    assert matter in placed["detail"].values(), placed["detail"]
    dt.datetime.strptime(placed["at"], "%Y-%m-%dT%H:%M:%S.%fZ")
    assert len(placed["at"]) == len("2026-10-30T12:00:00.000000Z")
    assert _rows(pg, "seq = 1")[0]["prev_digest"] == ZERO_DIGEST


def test_digest_settling(browser: Browser, app_url: str) -> None:
    entries = _chain(6)
    with open_app(browser, app_url + "/sign-in") as page:
        assert page.request.post(app_url + "/api/sign-in", data={"email": PEOPLE["sefa"][2], "password": PASSWORD}).status == 200
        _serve_ledger(page, entries)
        page.goto(app_url + "/ledger")
        _walk_loaded(page)
        until(page, DIGEST_STATE_JS, "settled")
        _slider(page).focus()
        page.keyboard.press("ArrowUp")
        until(page, DIGEST_STATE_JS, "settling")
        target = entries[0]["digest"]
        deadline = time.monotonic() + max(SETTLE_MAX_MS, UI_MS) / 1000
        while _role(page, "region", "Digest panel").get_attribute("data-digest-state") != "settled":
            advance(page, 50)
            assert time.monotonic() < deadline, "digest never settled"
        assert _cells(page) == target
        until(page, f"() => ({MARKED_JS})(document, ['data-link-mark', '1']).some(m => m.text.includes('Verified'))")
        until(page, f"() => ({MARKED_JS})(document, ['data-figure', null])[0]?.text === '1'")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        until(page, f"d => ({MARKED_JS})(document, ['data-digest-cell', null]).map(m => m.text).join('') === d && ({MARKED_JS})(document, ['data-digest-state', null])[0]?.attrs['data-digest-state'] === 'settled'", entries[3]["digest"])
        advance(page, SETTLE_MAX_MS)
        assert _cells(page) == entries[3]["digest"]
    for width, height, columns in ((1280, 800, 16), (768, 1024, 16), (375, 812, 8)):
        with _walk(browser, app_url, entries, width=width, height=height) as (page, _):
            _marked_count(page, "data-digest-cell", None, CELLS)
            tops = [round(m["top"]) for m in _marked(page, "data-digest-cell")]
            assert tops.count(tops[0]) == columns and len(set(tops)) == CELLS // columns, (width, tops)


def test_first_break(browser: Browser, app_url: str) -> None:
    def flip(value: str) -> str:
        return ("1" if value[0] == "0" else "0") + value[1:]

    altered = _chain(8)
    computed = altered[3]["digest"]
    altered[3]["digest"] = flip(computed)
    mismatched = _chain(8)
    previous = mismatched[4]["prev_digest"]
    mismatched[4]["prev_digest"] = flip(previous)
    missing = _chain(8)
    del missing[2]
    cases = [(altered, 4, computed, 1), (mismatched, 5, previous, 1), (missing, 3, "-" * CELLS, CELLS)]
    for entries, link, shown, differing in cases:
        with _walk(browser, app_url, entries) as (page, _):
            region = _chain_walk(page)
            expect(page.get_by_text(re.compile("Break at link"))).to_have_count(0)
            _walk_loaded(page)
            _press_slider(page, "End")
            expect(region).to_have_attribute("data-link-state", "broken")
            expect(region).to_have_attribute("data-verified-through", str(link - 1))
            _slider_is(_slider(page), str(link))
            expect(_status(page, "Walk result")).to_have_text(f"Break at link {link}.")
            expect(page.get_by_text(f"Break at link {link}").first).to_be_visible()
            _mark_says(page, link, "Break")
            _poll(lambda: _cells(page) == shown, 5, "break cells")
            _marked_count(page, "data-differs", "true", differing)
            firsts = _marked(page, "data-first-break", "true")
            assert len(firsts) == 1 and firsts[0]["attrs"].get("data-differs") == "true"
            page.keyboard.press("ArrowUp")
            _slider_is(_slider(page), str(link))
            page.keyboard.press("ArrowDown")
            expect(region).to_have_attribute("data-link-state", "verified" if link > 1 else "idle")
            _marked_count(page, "data-differs", "true", 0)
            page.keyboard.press("ArrowUp")
            expect(region).to_have_attribute("data-link-state", "broken")
            _marked_count(page, "data-differs", "true", differing)


def test_walk_touch_and_reduced_motion(browser: Browser, app_url: str) -> None:
    entries = _chain(6)
    entries[4]["digest"] = "0" * 64
    with _walk(browser, app_url, entries, width=375, height=812, touch=True, reduced=True) as (page, _):
        box = _rect(_slider(page))
        assert box["width"] >= TARGET_PX and box["height"] >= TARGET_PX
        for name in ("Copy anchor", "Check anchor"):
            size = _rect(_btn(page, name))
            assert size["width"] >= TARGET_PX and size["height"] >= TARGET_PX
        panel = _role(page, "region", "Digest panel")
        panel.evaluate("""el => { window.__states = []; new MutationObserver(() => window.__states.push(el.getAttribute('data-digest-state'))).observe(el, {attributes: true, attributeFilter: ['data-digest-state']}); }""")
        _press_slider(page, "ArrowUp")
        expect(_chain_walk(page)).to_have_attribute("data-verified-through", "1")
        assert _cells(page) == entries[0]["digest"]
        expect(panel).to_have_attribute("data-digest-state", "settled")
        _press_slider(page, "End")
        expect(_chain_walk(page)).to_have_attribute("data-link-state", "broken")
        broken = len(entries) - 1
        expect(_status(page, "Walk result")).to_have_text(f"Break at link {broken}.")
        assert "settling" not in page.evaluate("window.__states")
        layout(page)


def test_walk_announcements(browser: Browser, app_url: str) -> None:
    entries = _chain(30)
    for reduced in (False, True):
        with _walk(browser, app_url, entries, reduced=reduced) as (page, _):
            result = _status(page, "Walk result")
            _record(result, "walk")
            rests = [1, 2, 12, len(entries)]
            _press_slider(page, "ArrowUp")
            expect(result).to_have_text(f"Link {rests[0]} verified.")
            page.keyboard.press("ArrowUp")
            expect(result).to_have_text(f"Link {rests[1]} verified.")
            page.keyboard.press("PageUp")
            expect(result).to_have_text(f"Link {rests[2]} verified.")
            page.keyboard.press("End")
            expect(result).to_have_text(f"Link {rests[3]} verified.")
            page.keyboard.press("Home")
            expect(result).to_have_text("Start of the chain.")
            seen = [t for t in _seen(page, "walk") if t != "Start of the chain."]
            assert seen == [f"Link {n} verified." for n in rests], seen


def test_long_chain(browser: Browser, app_url: str) -> None:
    entries = _chain(LONG_CHAIN)
    with _walk(browser, app_url, entries) as (page, queries):
        _press_slider(page, "End")
        expect(_chain_walk(page)).to_have_attribute("data-verified-through", str(LONG_CHAIN), timeout=LONG_CHAIN_MS)
        assert len([q for q in queries if "after" in q]) >= 2
        assert len(_marked(page, "data-link-mark")) <= MARK_CAP
        _mark_says(page, LONG_CHAIN, "Verified")
        assert page.evaluate("document.documentElement.scrollHeight") >= LONG_CHAIN * WALK_STEP_PX
    broken = _chain(LONG_CHAIN)
    broken[BREAK_AT - 1]["digest"] = "0" * 64
    with _walk(browser, app_url, broken) as (page, _):
        _press_slider(page, "End")
        expect(_chain_walk(page)).to_have_attribute("data-link-state", "broken", timeout=LONG_CHAIN_MS)
        expect(_chain_walk(page)).to_have_attribute("data-verified-through", str(BREAK_AT - 1))
        assert len(_marked(page, "data-link-mark")) <= MARK_CAP
        _mark_says(page, BREAK_AT, "Break")
    with _walk(browser, app_url, entries, route="/audit/chain") as (page, _):
        expect(_lattice(page)).to_have_attribute("data-lattice-state", "verified", timeout=LONG_CHAIN_MS)
        expect(_lattice(page)).to_have_attribute("data-node-count", str(LONG_CHAIN))


def test_anchors(browser: Browser, app_url: str) -> None:
    honest = _chain(8)
    rewritten = _chain(8, "b")
    with _page(browser, app_url, "sefa", permissions=["clipboard-read", "clipboard-write"]) as page:
        requests: list[str] = []
        page.context.on("request", lambda r: requests.append(r.url + (r.post_data or "")))
        _serve_ledger(page, honest)
        page.goto(app_url + "/ledger")
        anchor_status, check = _status(page, "Anchor status"), _box(page, "Anchor to check")
        _press_slider(page, "ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp")
        expect(_chain_walk(page)).to_have_attribute("data-verified-through", "4")
        anchor = f"wardline-anchor:v1:4:{honest[3]['digest']}"
        expect(_box(page, "Current anchor")).to_have_value(anchor)
        _btn(page, "Copy anchor").click()
        expect(anchor_status).to_have_text("Anchor copied.")
        assert page.evaluate("navigator.clipboard.readText()") == anchor
        check.fill("wardline-anchor:v1:04:" + honest[3]["digest"])
        _btn(page, "Check anchor").click()
        expect(anchor_status).to_have_text("This is not a Wardline anchor.")
        check.fill("  " + anchor + " ")
        _btn(page, "Check anchor").click()
        matched = 4
        expect(anchor_status).to_have_text(f"Anchor for link {matched} matches.")
        check.fill(f"wardline-anchor:v1:6:{honest[5]['digest']}")
        _btn(page, "Check anchor").click()
        later = 6
        expect(anchor_status).to_have_text(f"Anchor for link {later} added. It will be tested when the walk reaches it.")
        check.fill(f"wardline-anchor:v1:2:{'a' * 64}")
        _btn(page, "Check anchor").click()
        failed = 2
        expect(anchor_status).to_have_text(f"Anchor for link {failed} does not match.")
        expect(_chain_walk(page)).to_have_attribute("data-verified-through", "1")
        expect(_chain_walk(page)).to_have_attribute("data-link-state", "broken")
        assert not [r for r in requests if honest[3]["digest"] in r or "wardline-anchor" in r or "a" * 64 in r]
    with _page(browser, app_url, "sefa") as first:
        _serve_ledger(first, honest)
        first.goto(app_url + "/ledger")
        _press_slider(first, "End")
        expect(_chain_walk(first)).to_have_attribute("data-verified-through", "8")
        second = first.context.new_page()
        _serve_ledger(second, rewritten)
        second.goto(app_url + "/ledger")
        expect(_chain_walk(second)).to_have_attribute("data-verified-through", "0")
        _press_slider(second, "End")
        expect(_chain_walk(second)).to_have_attribute("data-link-state", "broken")
        _slider_is(_slider(second), "8")
        expect(_status(second, "Walk result")).to_have_text(f"Break at link {len(honest)}.")
    with _page(browser, app_url, "sefa") as first:
        _serve_ledger(first, honest)
        first.goto(app_url + "/ledger")
        _press_slider(first, "End")
        expect(_chain_walk(first)).to_have_attribute("data-verified-through", "8")
        second = first.context.new_page()
        _serve_ledger(second, honest[:5])
        second.goto(app_url + "/ledger")
        _press_slider(second, "End")
        first_missing = 6
        expect(_status(second, "Walk result")).to_have_text(f"Break at link {first_missing}.")
        _poll(lambda: _slider_max(_slider(second)) == "6", UI_MS / 1000, "slider maximum 6")
        _poll(lambda: _cells(second) == "-" * CELLS, UI_MS / 1000, "cells blanked")


NO_WEBGL = "const real = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind.startsWith('webgl') ? null : real.call(this, kind, ...rest); };"


def test_lattice_paths(browser: Browser, app_url: str) -> None:
    clean = _chain(8)
    faulty = _chain(8)
    faulty[4]["digest"] = "0" * 64
    notice = "3D view unavailable in this browser. This still frame shows the same verdict and link count."
    for init, path in ((None, "webgl2"), (NO_WEBGL, "still")):
        with _walk(browser, app_url, clean, route="/audit/chain", reduced=True, init=init) as (page, _):
            lattice = _lattice(page)
            expect(lattice).to_have_attribute("data-lattice-path", path)
            expect(lattice).to_have_attribute("data-lattice-state", "verified")
            expect(lattice).to_have_attribute("data-node-count", "8")
            expect(lattice).to_have_attribute("data-edge-count", "7")
            expect(lattice).to_have_attribute("data-broken-link", "")
            expect(lattice).to_have_attribute("data-fault-count", "")
            expect(_status(page, "Lattice verdict")).to_have_text(f"All {len(clean)} links verified.")
            if path == "still":
                expect(_status(page, "Lattice path notice")).to_have_text(notice)
            shot = Raster(_role(page, "application", "Chain lattice").screenshot())
            assert shot.count(DEEP_GREEN) > 0 and shot.count(VERMILION) == 0, path
        with _walk(browser, app_url, faulty, route="/audit/chain", reduced=True, init=init) as (page, _):
            lattice = _lattice(page)
            expect(lattice).to_have_attribute("data-lattice-state", "broken")
            expect(lattice).to_have_attribute("data-broken-link", "5")
            expect(lattice).to_have_attribute("data-fault-count", "4")
            broken, faulted = 5, 4
            expect(_status(page, "Lattice verdict")).to_have_text(f"Break at link {broken}. {faulted} links drawn in fault.")
            shot = Raster(_role(page, "application", "Chain lattice").screenshot())
            assert shot.count(VERMILION) > 0 and shot.count(DEEP_GREEN) > 0, path
    with _walk(browser, app_url, faulty, route="/audit/chain", reduced=True) as (page, _):
        lattice = _lattice(page)
        expect(lattice).to_have_attribute("data-lattice-path", "webgl2")
        _role(page, "application", "Chain lattice").evaluate("c => c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
        expect(lattice).to_have_attribute("data-lattice-path", "still", timeout=1000 + SLACK_MS)
        expect(lattice).to_have_attribute("data-broken-link", "5")
        expect(_status(page, "Lattice path notice")).to_have_text(notice)
    entries = _chain(8)
    with _walk(browser, app_url, entries, route="/audit/chain", reduced=True) as (page, _):
        expect(_lattice(page)).to_have_attribute("data-lattice-state", "verified")
        _btn(page, "Link details").click()
        dialog = _role(page, "dialog", "Link details")
        field = _box(dialog, "Link number")
        expect(field).to_be_focused()
        expect(field).to_have_value("8")
        field.fill("9")
        page.keyboard.press("Enter")
        absent = 9
        expect(_status(dialog, "Link details status")).to_have_text(f"There is no link {absent} in this chain.")
        field.fill("x")
        _btn(dialog, "Show link").click()
        expect(_status(dialog, "Link details status")).to_have_text("Enter a link number.")
        field.fill("3")
        _btn(dialog, "Show link").click()
        shown = 3
        expect(_status(dialog, "Link details status")).to_have_text(f"Link {shown}: verified.")
        page.keyboard.press("Escape")
        expect(_btn(page, "Link details")).to_be_focused()


def test_lattice_orbit(browser: Browser, app_url: str) -> None:
    entries = _chain(8)

    def camera(page: Page) -> tuple[float, float]:
        lattice = _lattice(page)
        return float(lattice.get_attribute("data-camera-yaw")), float(lattice.get_attribute("data-camera-pitch"))

    def near(page: Page, yaw: float, pitch: float) -> None:
        _poll(lambda: abs(camera(page)[0] - yaw) <= 0.1 and abs(camera(page)[1] - pitch) <= 0.1, 2, f"camera at {yaw}, {pitch}")

    with _walk(browser, app_url, entries, route="/audit/chain", reduced=True) as (page, queries):
        lattice, canvas = _lattice(page), _role(page, "application", "Chain lattice")
        expect(lattice).to_have_attribute("data-lattice-state", "verified")
        expect(lattice).to_have_attribute("data-idle", "false")
        near(page, 30, 20)
        canvas.focus()
        page.keyboard.press("ArrowRight")
        near(page, 35, 20)
        yaw, pitch = 35, 20
        expect(_status(page, "Lattice camera")).to_have_text(f"Yaw {yaw} degrees, pitch {pitch} degrees.")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowUp")
        near(page, 30, 25)
        page.keyboard.press("ArrowDown")
        near(page, 30, 20)
        for _ in range(7):
            page.keyboard.press("ArrowLeft")
        near(page, 355, 20)
        for _ in range(14):
            page.keyboard.press("ArrowUp")
        near(page, 355, 80)
        _btn(page, "Reset view").click()
        near(page, 30, 20)
        box = _rect(canvas)
        page.mouse.move(box["x"] + 100, box["y"] + 100)
        page.mouse.down()
        page.mouse.move(box["x"] + 140, box["y"] + 120, steps=4)
        page.mouse.up()
        near(page, 50, 30)
        canvas.focus()
        page.keyboard.press("r")
        near(page, 30, 20)
        page.keyboard.press("d")
        expect(_role(page, "dialog", "Link details")).to_be_visible()
        page.keyboard.press("Escape")
        assert queries and all(set(dict(urllib.parse.parse_qsl(q))) <= {"after", "limit"} for q in queries), queries
    with _walk(browser, app_url, entries, route="/audit/chain") as (page, _):
        lattice, canvas = _lattice(page), _role(page, "application", "Chain lattice")
        expect(lattice).to_have_attribute("data-idle", "true")
        start_yaw, started = camera(page)[0], time.monotonic()
        _poll(lambda: (camera(page)[0] - start_yaw) % 360 >= 60, 15, "idle rotation")
        rate = ((camera(page)[0] - start_yaw) % 360) / (time.monotonic() - started)
        assert 360 / 60 * 0.5 <= rate <= 360 / 40 * 2.0, rate
        canvas.focus()
        expect(lattice).to_have_attribute("data-idle", "false")
        held = camera(page)
        _holds(lambda: None, 0.5)
        assert camera(page) == held
    with _walk(browser, app_url, entries, route="/audit/chain", device_scale_factor=2, reduced=True) as (page, _):
        canvas = _role(page, "application", "Chain lattice")
        expect(_lattice(page)).to_have_attribute("data-lattice-state", "verified")
        size = canvas.evaluate("c => [c.width, c.height, c.getBoundingClientRect().width, c.getBoundingClientRect().height]")
        assert abs(size[0] - size[2] * 2) <= 1 and abs(size[1] - size[3] * 2) <= 1, size
    with _walk(browser, app_url, entries, route="/audit/chain", reduced=True, init=NO_WEBGL) as (page, _):
        expect(_lattice(page)).to_have_attribute("data-lattice-path", "still")
        _role(page, "application", "Chain lattice").focus()
        page.keyboard.press("ArrowRight")
        near(page, 30, 20)


def _custody_all(api: Api, exhibit_id: str) -> list[dict]:
    rows, after = [], 0
    while True:
        page = _ok(api.get(f"/api/exhibits/{exhibit_id}/custody?after={after}&limit=2"))
        rows += page["entries"]
        if page["next_after"] is None:
            return rows
        after = page["next_after"]


def test_wf_custody_history_auditor_lookup(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w)
    _rendered(w, exhibit["id"])
    entries = _custody_all(Api(app_url, "sefa"), exhibit["id"])
    with _page(browser, app_url, "sefa", "/ledger/review") as page:
        _box(page, "Exhibit id").fill(exhibit["id"])
        _btn(page, "Show custody").click()
        status = _status(page, "Custody status")
        expect(status).to_have_text(f"{len(entries)} entries checked. All match their digests. Run Chain Walk to prove the whole chain.")
        table = _role(page, "table", "Custody history")
        expect(table.get_by_text("Verified")).to_have_count(len(entries))
        _box(page, "Exhibit id").fill("EX-999999")
        _btn(page, "Show custody").click()
        expect(status).to_have_text("No exhibit with this id.")

        def alter(route: Any) -> None:
            body = route.fetch().json()
            for entry in body["entries"]:
                if entry["seq"] == entries[1]["seq"]:
                    entry["actor_id"] = TAMPER_ACTOR
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        page.route("**/custody*", alter)
        _box(page, "Exhibit id").fill(exhibit["id"])
        _btn(page, "Show custody").click()
        expect(status).to_have_text(f"Entry {entries[1]['seq']} does not match its digest.")
        expect(table.get_by_text("Altered")).to_have_count(1)
        expect(table.get_by_text("Verified")).to_have_count(len(entries) - 1)


def test_wf_custody_history_case_lead_on_exhibit(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w)
    with _page(browser, app_url, "tamsin", f"/exhibits/{exhibit['id']}") as page:
        table = _role(page, "table", "Custody history")
        status = _status(page, "Custody status")
        expect(_status(page, "Redaction status")).to_have_text("Preview loaded.")
        entries = _custody_all(w.lead, exhibit["id"])
        expect(table.get_by_text("Verified")).to_have_count(len(entries), timeout=LIVE_MS)
        expect(status).to_have_text(_published("<n> entries checked. All match their digests. Run Chain Walk to prove the whole chain."))
        for row, entry in zip(table.get_by_role("row").all()[1:], entries):
            assert str(entry["seq"]) in row.inner_text()
        _same_node_tag(table.get_by_role("row").nth(1))
        _save(w.noor, exhibit["id"], [REGION])
        expect(table.get_by_text("Verified")).to_have_count(len(entries) + 1, timeout=LIVE_MS)
        assert table.get_by_role("row").nth(1).evaluate("e => e.__kept === true")


def test_custody_reading(app_url: str) -> None:
    pg = Postgres()
    w = _world(app_url)
    exhibit = _cleared(w)
    derivative = _rendered(w, exhibit["id"])
    path = f"/api/exhibits/{exhibit['id']}/custody"
    auditor = Api(app_url, "sefa")
    first = _ok(auditor.get(f"{path}?limit=2"))
    assert len(first["entries"]) == 2 and first["next_after"] == first["entries"][-1]["seq"]
    _save(w.noor, exhibit["id"], [])
    collected = first["entries"] + _custody_all(auditor, exhibit["id"])[2:]
    stored = _rows(pg, f"target IN ({_q(exhibit['id'])}, {_q(derivative['id'])}) OR detail->>'exhibit_id' = {_q(exhibit['id'])}")
    assert [e["seq"] for e in collected] == [r["seq"] for r in stored]
    for entry, row in zip(collected, stored):
        assert entry == {k: row[k] for k in ("seq", "at", "actor_id", "session_id", "action", "target", "detail", "prev_digest", "digest")}
    assert {"exhibit.sealed", "exhibit.cleared", "derivative.rendered"} <= {e["action"] for e in collected}
    assert [e["seq"] for e in _ok(auditor.get(f"{path}?limit=abc&after=-4"))["entries"]][:2] == [e["seq"] for e in collected][:2]
    assert len(_ok(auditor.get(f"{path}?limit=99999999"))["entries"]) == len(collected)
    assert _ok(auditor.get(f"{path}?after={collected[-1]['seq']}")) == {"entries": [], "next_after": None}
    last = int(pg.rows("SELECT max(seq) AS m FROM ledger_entries")[0]["m"])
    assert w.lead.get(path).status_code == 200
    assert int(pg.rows("SELECT max(seq) AS m FROM ledger_entries")[0]["m"]) == last
    _refused(w.noor.get(path), 403, "forbidden")
    _refused(w.kofi.get(path), 403, "forbidden")
    _refused(Api(app_url, "dmitri").get(path), 404, "not_found")
    _grant(w.lead, w.cid, "yuki", "derivatives")
    _refused(Api(app_url, "yuki").get(path), 404, "not_found")
    _ok(w.lead.act("POST", f"/api/exhibits/{exhibit['id']}/dispose", {"reason": GOOD_REASON}))
    _ok(w.lead2.act("POST", f"/api/exhibits/{exhibit['id']}/dispose/confirm"))
    after = _custody_all(auditor, exhibit["id"])
    assert after[-1]["action"] == "exhibit.disposed" and [e["seq"] for e in after][:len(collected)] == [e["seq"] for e in collected]


def test_custody_timeline(browser: Browser, app_url: str) -> None:
    w = _world(app_url)
    exhibit = _cleared(w)
    for index in range(MANY_STOPS):
        _save(w.noor, exhibit["id"], [{"page": 1, "x": index, "y": 0, "w": 10, "h": 10}])
    for reduced in (False, True):
        with _page(browser, app_url, "tamsin", f"/exhibits/{exhibit['id']}", reduced=reduced) as page:
            region = _role(page, "region", "Custody timeline")
            scroller = lambda: _marked(region, "data-custody-scroller")[0]
            slider = _role(region, "slider", "Custody scrub")
            status = _status(page, "Custody timeline status")
            expect(_status(page, "Redaction status")).to_have_text("Preview loaded.")
            total = len(_custody_all(w.lead, exhibit["id"]))
            assert total > 11
            expect(region).to_have_attribute("data-scrub-total", str(total), timeout=LIVE_MS)
            _poll(lambda: abs(scroller()["range"] - (total - 1) * TIMELINE_STEP) <= 1, LIVE_MS / 1000, "scroll range")
            assert abs(scroller()["height"] - TIMELINE_HEIGHT) <= 1
            expect(region).to_have_attribute("data-scrub-position", "1")
            expect(region).to_have_attribute("data-scrub-progress", "0")
            region.evaluate("""el => { window.__scrub = []; new MutationObserver(() => window.__scrub.push(el.getAttribute('data-scrub-state'))).observe(el, {attributes: true, attributeFilter: ['data-scrub-state']}); }""")
            for stop in [3, 6, 9, 6, 3]:
                region.evaluate(SCROLL_JS, ["data-custody-scroller", stop * TIMELINE_STEP])
                expect(region).to_have_attribute("data-scrub-position", str(stop + 1))
                expect(region).to_have_attribute(
                    "data-scrub-progress", str((2000 * stop + (total - 1)) // (2 * (total - 1))))
                expect(region).to_have_attribute("data-scrub-state", "settled")
                expect(slider).to_have_attribute("aria-valuetext", f"Entry {stop + 1} of {total}")
                track, fill = _marked(region, "data-scrub-track")[0], _marked(region, "data-scrub-fill")[0]
                axis = "width" if track["width"] >= track["height"] else "height"
                assert abs(fill[axis] / track[axis] - stop / (total - 1)) <= 0.02
                states = [m["attrs"]["data-stop-state"] for m in _marked(region, "data-custody-stop")]
                assert states == ["past"] * stop + ["current"] + ["future"] * (total - stop - 1)
            scrub_seen = page.evaluate("window.__scrub")
            assert ("moving" not in scrub_seen) if reduced else ("moving" in scrub_seen), scrub_seen
            slider.focus()
            page.keyboard.press("Home")
            expect(region).to_have_attribute("data-scrub-position", "1")
            expect(status).to_have_text(f"Start of custody. Entry 1 of {total}.")
            page.keyboard.press("ArrowRight")
            expect(status).to_have_text(f"Entry 2 of {total}.")
            expect(region).to_have_attribute("data-scrub-position", "2")
            page.keyboard.press("PageUp")
            expect(region).to_have_attribute("data-scrub-position", "12")
            expect(region).to_have_attribute("data-scrub-state", "settled")
            _poll(lambda: abs(scroller()["offset"] - 11 * TIMELINE_STEP) <= 1, UI_MS / 1000, "scroll landed")
            page.keyboard.press("n")
            expect(region).to_have_attribute("data-scrub-position", "13")
            page.keyboard.press("p")
            expect(region).to_have_attribute("data-scrub-position", "12")
            page.keyboard.press("ArrowDown")
            expect(region).to_have_attribute("data-scrub-position", "11")
            page.keyboard.press("End")
            expect(region).to_have_attribute("data-scrub-position", str(total))
            expect(region).to_have_attribute("data-scrub-progress", "1000")
            expect(status).to_have_text(f"Latest custody entry. Entry {total} of {total}.")
            opener = _btn(region, "Entry details")
            opener.click()
            dialog = _role(page, "dialog", "Custody entry")
            expect(dialog).to_contain_text(_custody_all(w.lead, exhibit["id"])[-1]["digest"])
            page.keyboard.press("Escape")
            expect(opener).to_be_focused()


def test_wf_cross_cutting_manifest_and_seed(app_url: str) -> None:
    pg, bucket = Postgres(), S3()
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    for who in PEOPLE:
        assert Api(app_url, who).get("/api/session").json()["user"]["id"] == PEOPLE[who][0]
    lead, rafael = Api(app_url, "tamsin"), Api(app_url, "rafael")
    assert {p["id"]: p["role"] for p in _ok(lead.get("/api/directory"))["people"]}["USR-09"] == "auditor"
    names = {c["id"]: c["name"] for c in _ok(lead.get("/api/compartments"))["compartments"]}
    assert names["CMP-0001"] == "Harrowgate Depot Payments" and names["CMP-0003"] == "Eastbank Tender Records" and "CMP-0002" not in names
    expected = {"EX-0001": ("Harrowgate payment ledger scan", "USR-03", "application/pdf"), "EX-0002": ("Depot gate photograph", "USR-04", "image/png"), "EX-0003": ("Anonymous courier note", "USR-03", "application/pdf"), "EX-0006": ("Eastbank tender export", "USR-03", "application/pdf")}
    for exhibit_id, (name, registrar, kind) in expected.items():
        body = _ok(lead.get(f"/api/exhibits/{exhibit_id}"))
        assert (body["name"], body["registered_by"], body["sniffed_type"]) == (name, registrar, kind)
        assert body["provenance"]["source"] == "Seed record" and body["provenance"]["collected_on"] == "2026-09-14" and body["provenance"]["capture_notes"] is None
    held_id, audio_id, submitted_id, photo_id = "EX-0005", "EX-0004", "REL-0002", "EX-0002"
    held = _ok(rafael.get(f"/api/exhibits/{held_id}"))
    assert held["state"] == "held" and [(h["id"], h["matter_ref"], h["placed_by"]) for h in held["holds"]] == [("HLD-0001", "M-2026-077", "USR-02")]
    assert _ok(rafael.get(f"/api/exhibits/{audio_id}"))["sniffed_type"] == "audio/wav"
    assert _ok(lead.get(f"/api/releases/{submitted_id}"))["state"] == "submitted"
    assert _ok(httpx.get(f"{app_url}/api/links/{SEED_LINK}", timeout=HTTP_TIMEOUT))["reference"] == "REL-0001"
    photo = Raster(_derivative_bytes(lead, "DV-0002"))
    assert (photo.width, photo.height) == (800, 600) and photo.at(100, 80) == (0, 0, 0)
    original = _download(lead, f"/api/exhibits/{photo_id}/download-grants").content
    assert b"Camera" in original and b"Gatehouse-2" in original
    for record in ("EX-0001", "EX-0006", "DV-0001", "DV-0002", "DV-0003"):
        rows = _rows(pg, f"target = {_q(record)} AND actor_id = 'system'")
        assert rows and rows[0]["session_id"] is None, record
    counted = lambda: (int(pg.rows("SELECT count(*) AS c FROM ledger_entries WHERE actor_id = 'system' AND target LIKE 'EX-%'")[0]["c"]), len(bucket.keys()))
    before = counted()
    with _copy() as (base, _):
        assert httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert counted() == before


def test_wf_cross_cutting_server_boundary(browser: Browser, app_url: str) -> None:
    for path in ("/.env", "/run.json", "/.git/config", "/requirements.txt", "/THIRD_PARTY_NOTICES.md"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT).status_code == 404, path
    refused = httpx.post(f"{app_url}/api/sign-in", json={"email": PEOPLE["noor"][2], "password": PASSWORD}, headers={"Origin": "https://evil.example"}, timeout=HTTP_TIMEOUT)
    _refused(refused, 403, "forbidden_origin")
    assert httpx.post(f"{app_url}/api/sign-in", json={"email": PEOPLE["noor"][2], "password": PASSWORD}, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).headers["X-Content-Type-Options"] == "nosniff"
    secrets = [os.environ[n] for n in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID") if os.environ.get(n)]
    parsed = urllib.parse.urlsplit(os.environ["DATABASE_URL"])
    secrets += [v for v in (parsed.password,) if v]
    origin = app_url
    urls, bodies = [], []
    with _page(browser, app_url, "tamsin") as page:
        page.on("request", lambda r: urls.append(r.url))

        def keep(response: Any) -> None:
            with contextlib.suppress(Exception):
                bodies.append(response.text())

        page.on("response", keep)
        page.goto(app_url + "/compartments")
        expect(_role(page, "searchbox", "Search exhibits")).to_be_visible()
        fonts = page.evaluate("document.fonts.ready.then(() => [...document.fonts].map(f => f.family.replaceAll('\"', '')))")
        assert {"Martian Mono", "Instrument Sans"} <= set(fonts), fonts
    assert urls and all(same_origin(u, origin) or u.startswith(("data:", "blob:")) for u in urls), urls
    for body in bodies:
        for secret in secrets:
            assert secret not in body


def _app_dir() -> Path:
    return Path("/app")


def test_if_run_manifest() -> None:
    manifest = json.loads((_app_dir() / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()
    for key in ("build", "serve"):
        assert ".venv/bin/" in manifest[key] or "python -m " in manifest[key] or "python3 -m " in manifest[key], manifest[key]


def _shipped_packages() -> list[dict]:
    root = Path(DEPLOYED_APP) if (Path(DEPLOYED_APP) / ".venv").exists() else _app_dir()
    script = "import importlib.metadata as m, json; print(json.dumps([{'name': d.metadata['Name'], 'license': ' '.join(filter(None, [d.metadata.get('License-Expression'), (d.metadata.get('License') or '')[:200]] + d.metadata.get_all('Classifier', []) )) } for d in m.distributions()]))"
    done = subprocess.run([str(root / ".venv/bin/python"), "-c", script], capture_output=True, text=True, timeout=HTTP_TIMEOUT)
    assert done.returncode == 0, done.stderr
    return [p for p in json.loads(done.stdout) if p["name"].lower() not in ("pip", "setuptools", "wheel")]


def test_if_third_party_notices() -> None:
    notices = (_app_dir() / "THIRD_PARTY_NOTICES.md").read_text().lower()
    for package in _shipped_packages():
        assert package["name"].lower() in notices or package["name"].lower().replace("-", "_") in notices, package["name"]
    for font in ("Martian Mono", "Instrument Sans"):
        assert font.lower() in notices


def test_if_licences() -> None:
    allowed = re.compile(r"MIT|HPND|Historical Permission|BSD|Apache|ISC|PSF|Python Software Foundation|MPL|Mozilla Public|LGPL|Lesser General", re.I)
    for package in _shipped_packages():
        assert allowed.search(package["license"]), package


def test_if_no_extra_datastore() -> None:
    skipped = {".venv", "node_modules", ".git"}
    for path in _app_dir().rglob("*"):
        if not skipped & set(path.parts):
            assert path.suffix not in (".sqlite", ".sqlite3", ".db", ".rdb"), path
    for proc in Path("/proc").glob("[0-9]*/comm"):
        with contextlib.suppress(OSError):
            assert proc.read_text().strip() not in ("redis-server", "sqlite3", "mongod", "memcached"), proc


def test_if_service_config_unchanged(app_url: str, mail: Any) -> None:
    assert any(table.split(".")[-1] == "ledger_entries" for table in Postgres().tables())
    assert isinstance(S3().keys("originals/"), list)
    assert isinstance(mail.messages(0, 0.1), list)
    assert Api(app_url, "tamsin").get("/api/session").status_code == 200


def test_if_no_literal_credentials() -> None:
    parsed = urllib.parse.urlsplit(os.environ["DATABASE_URL"])
    secrets = [s.encode() for s in (os.environ.get("S3_SECRET_ACCESS_KEY"), os.environ.get("S3_ACCESS_KEY_ID"), parsed.password) if s]
    skipped = {".venv", "node_modules", ".git", "__pycache__"}
    for path in _app_dir().rglob("*"):
        if path.is_file() and not skipped & set(path.parts):
            data = path.read_bytes()
            for secret in secrets:
                assert secret not in data, path
