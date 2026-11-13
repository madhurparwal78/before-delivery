from __future__ import annotations

import calendar
import hashlib
import io
import json
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
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from PIL import Image
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    center,
    check,
    click,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    pdf_pages,
    pdf_text,
    post_json,
    same_origin,
    select,
    shipped_packages,
    seek_rects,
    state_styles,
    tap,
)


APP_DIR = Path("/app")
HTTP_TIMEOUT = 120
EVENTUAL_S = 20
SLACK_S = 15
MAIN_INDEX = os.environ.get("MEILISEARCH_INDEX", "references")

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
PHONE_FIELD_FRACTION = 0.52
TABLET_FIELD_FRACTION = 0.40
DESKTOP_TILE_PX = 450
LAYOUT_TOL = 0.06
MIN_TARGET_PX = 44

JSON_LIMIT = 65_536
MULTIPART_LIMIT = 16_000_000
PHOTO_LIMIT = 15_000_000
PIXEL_LIMIT = 40_000_000
SIDE_LIMIT = 12_000
PIXEL_ANSWER_S = 2
HEALTH_ANSWER_S = 1
BOOT_S = 10
TITLE_MAX = 80
MAKER_MAX = 80
MATERIALS_MAX = 8
MATERIAL_MAX = 40
FINISH_MAX = 80
SOURCE_URL_MAX = 500
SOURCE_NOTE_MAX = 120
NOTES_MAX = 2000
REEL_NAME_MAX = 60
REEL_MAX = 60

SHEET_START_S = 5
SHEET_READY_S = 30
CATCH_UP_S = 30
STATUS_CHECK_S = 5
BANNER_S = 10
PURGE_SWEEP_S = 5
DEFAULT_RETENTION_S = 2_592_000

SWAP_MS = 360
SWAP_HALF_MS = 180
SEARCH_SETTLE_MS = 600
REFETCH_MS = 60_000
WHEEL_PX = 20
WHEEL_STEPS = 800

PT_PER_MM = 72 / 25.4
A4_MM = (210, 297)
LETTER_IN = (8.5, 11)
PT_TOL = 2

DST_YEAR = 2027
PNG_SIG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
JPEG_SIG = bytes([0xFF, 0xD8, 0xFF])

DEMO_STOPS = [
    ("Desk radio", "Braunfeld", 1971, (2360, 1520, 980)),
    ("Pocket calculator", "Orrin Electronics", 1977, (1360, 780, 95)),
    ("Enamel kettle", "Halvorsen Emalje", 1964, (2100, 1900, 1600)),
]
P3_MATRIX = [
    [1.2249401, -0.2249404, 0],
    [-0.0420569, 1.0420571, 0],
    [-0.0196376, -0.0786361, 1.0982735],
]
COLOUR_FAMILIES = ["Black", "White", "Grey", "Silver", "Beige", "Brown", "Red", "Orange", "Yellow",
                   "Green", "Blue", "Purple", "Pink"]
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}

OUTER = (30, 30, 30)
CENTRE = (200, 120, 40)
CORNER = (40, 90, 210)
RED = (220, 40, 40)
GREEN = (40, 200, 60)
BLUE = (40, 60, 220)
YELLOW = (230, 220, 40)
STORED_W, STORED_H = 640, 320
AREA_W = 8000
BOMB_SIDE = 7000

PHOTO_COPY = "Add a JPEG or PNG photograph."
PHOTO_BYTES_COPY = "Use a photograph of 15,000,000 bytes or less."
PHOTO_PIXELS_COPY = "Use a photograph of 40 megapixels or less."
CHECK_FIELDS = "Check the highlighted fields."


def mm_text(tenths: int) -> str:
    return f"{Decimal(tenths) / 10:.1f}"


def in_text(tenths: int) -> str:
    return str((Decimal(tenths) / Decimal(254)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def tenths_from_in(value: str) -> int:
    return int((Decimal(value) * 254).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def tenths_from_mm(value: str) -> int:
    return int(Decimal(value) * 10)


def size_line(sizes: tuple[int, int, int] | list[int], unit: str) -> str:
    fmt = mm_text if unit == "mm" else in_text
    return " × ".join(fmt(t) for t in sizes) + f" {unit}"


def announce(k: int, n: int, title: str, maker: str | None, year: int | None) -> str:
    text = f"Reference {k} of {n}: {title}"
    if maker:
        text += f", {maker}" + (f" {year}" if year else "")
    return text


def written_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {calendar.month_name[d.month]} {d.year}"


def countdown(seconds: int) -> str:
    if seconds >= 86_400:
        return f"{seconds // 86_400}d {seconds % 86_400 // 3_600}h"
    if seconds >= 3_600:
        return f"{seconds // 3_600}h {seconds % 3_600 // 60}m"
    return f"{seconds // 60}m {seconds % 60}s"


def p3_to_srgb(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    lin = []
    for channel in rgb:
        v = channel / 255
        lin.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    out = []
    for row in P3_MATRIX:
        value = max(0.0, min(1.0, sum(a * b for a, b in zip(row, lin))))
        encoded = value * 12.92 if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055
        out.append(round(encoded * 255))
    return out[0], out[1], out[2]


def hex_of(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def rgb_of(swatch: str) -> tuple[int, int, int]:
    assert re.fullmatch(r"#[0-9a-f]{6}", swatch), f"swatch {swatch!r} is not # and six lowercase hex digits"
    return int(swatch[1:3], 16), int(swatch[3:5], 16), int(swatch[5:7], 16)


def near(swatch: str, rgb: tuple[int, int, int], tolerance: int) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(rgb_of(swatch), rgb))


def css_rgb(swatch: str) -> str:
    r, g, b = rgb_of(swatch)
    return f"rgb({r}, {g}, {b})"


def token() -> str:
    return "zq" + "".join(chr(ord("a") + int(c, 16)) for c in uuid.uuid4().hex[:12])


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


@lru_cache(maxsize=8)
def solid_png_stream(width: int, height: int, rgb: tuple[int, int, int] = CENTRE) -> bytes:
    comp = zlib.compressobj(6)
    row = b"\x00" + bytes(rgb) * width
    parts = [comp.compress(row) for _ in range(height)]
    parts.append(comp.flush())
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return PNG_SIG + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", b"".join(parts)) + png_chunk(b"IEND", b"")


def header_only_png(width: int, height: int) -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return PNG_SIG + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(b"\x00" * 64)) + png_chunk(b"IEND", b"")


def png_image(img: Image.Image, icc: bytes | None = None) -> bytes:
    buf = io.BytesIO()
    if icc:
        img.save(buf, "PNG", icc_profile=icc)
    else:
        img.save(buf, "PNG")
    return buf.getvalue()


def jpeg_image(img: Image.Image, exif: bytes | None = None) -> bytes:
    buf = io.BytesIO()
    if exif:
        img.save(buf, "JPEG", quality=100, subsampling=0, exif=exif)
    else:
        img.save(buf, "JPEG", quality=100, subsampling=0)
    return buf.getvalue()


def small_png(rgb: tuple[int, int, int] | None = None, size: tuple[int, int] = (96, 96)) -> bytes:
    colour = rgb or tuple(uuid.uuid4().bytes[:3])
    return png_image(Image.new("RGB", size, colour))


def colour_for(i: int) -> tuple[int, int, int]:
    return (37 * i + 20) % 256, (91 * i + 40) % 256, (53 * i + 80) % 256


def padded_png(total: int, rgb: tuple[int, int, int] = CENTRE) -> bytes:
    base = png_image(Image.new("RGB", (64, 64), rgb))
    pad = total - len(base) - 12
    assert pad >= 0
    return base[:-12] + png_chunk(b"prVt", b"\x00" * pad) + base[-12:]


def framed(icc: bytes | None = None) -> bytes:
    img = Image.new("RGB", (200, 200), OUTER)
    img.paste(CENTRE, (44, 44, 156, 156))
    img.paste(CORNER, (170, 0, 200, 30))
    return png_image(img, icc)


def transparent_centre(all_clear: bool) -> bytes:
    img = Image.new("RGBA", (200, 200), OUTER + (255,))
    px = img.load()
    for x in range(44, 156):
        for y in range(44, 156):
            clear = all_clear or x % 2 == 1
            px[x, y] = (255, 255, 255, 0) if clear else CENTRE + (255,)
    return png_image(img)


def quadrants(width: int, height: int) -> Image.Image:
    img = Image.new("RGB", (width, height), RED)
    img.paste(GREEN, (width // 2, 0, width, height // 2))
    img.paste(BLUE, (0, height // 2, width // 2, height))
    img.paste(YELLOW, (width // 2, height // 2, width, height))
    return img


def sideways_jpeg(secret: str) -> bytes:
    exif = Image.Exif()
    exif[0x0112] = 6
    exif[0x010E] = secret
    try:
        exif[0x8825] = {1: "N", 2: (51.0, 3.0, 0.0), 3: "E", 4: (3.0, 43.0, 0.0)}
        raw = exif.tobytes()
    except (TypeError, ValueError, KeyError):
        del exif[0x8825]
        raw = exif.tobytes()
    data = jpeg_image(quadrants(STORED_W, STORED_H), raw)
    comment = secret.encode()
    at = data.index(b"\xff\xdb")
    return data[:at] + b"\xff\xfe" + struct.pack(">H", len(comment) + 2) + comment + data[at:]


def jpeg_with_header_size(width: int, height: int) -> bytes:
    data = bytearray(jpeg_image(Image.new("RGB", (64, 64), CENTRE)))
    at = data.index(b"\xff\xc0")
    struct.pack_into(">HH", data, at + 5, height, width)
    return bytes(data)


def s15(value: float) -> bytes:
    return struct.pack(">i", round(value * 65536))


@lru_cache(maxsize=1)
def display_p3_icc() -> bytes:
    text = b"Display P3\x00"
    desc = b"desc" + b"\x00" * 4 + struct.pack(">I", len(text)) + text + struct.pack(">II", 0, 0) + struct.pack(">HB", 0, 0) + b"\x00" * 67

    def xyz(x: float, y: float, z: float) -> bytes:
        return b"XYZ " + b"\x00" * 4 + s15(x) + s15(y) + s15(z)

    curve = b"curv" + b"\x00" * 4 + struct.pack(">IH", 1, 563) + b"\x00\x00"
    tags = [
        (b"desc", desc), (b"cprt", b"text" + b"\x00" * 4 + b"CC0\x00"),
        (b"wtpt", xyz(0.9642, 1.0, 0.8249)),
        (b"rXYZ", xyz(0.515102, 0.241196, -0.001053)),
        (b"gXYZ", xyz(0.291965, 0.692236, 0.041884)),
        (b"bXYZ", xyz(0.157153, 0.066561, 0.784073)),
        (b"rTRC", curve), (b"gTRC", curve), (b"bTRC", curve),
    ]
    start = 128 + 4 + 12 * len(tags)
    table, data = b"", b""
    for sig, body in tags:
        while (start + len(data)) % 4:
            data += b"\x00"
        table += sig + struct.pack(">II", start + len(data), len(body))
        data += body
    while len(data) % 4:
        data += b"\x00"
    size = start + len(data)
    header = (struct.pack(">I", size) + b"lcms" + bytes([2, 0x10, 0, 0]) + b"mntr" + b"RGB " + b"XYZ "
              + struct.pack(">6H", 2025, 1, 1, 0, 0, 0) + b"acsp" + b"APPL" + b"\x00" * 4 + b"\x00" * 8
              + b"\x00" * 8 + struct.pack(">I", 0) + s15(0.9642) + s15(1.0) + s15(0.8249) + b"\x00" * 4
              + b"\x00" * 16 + b"\x00" * 28)
    assert len(header) == 128
    return header + struct.pack(">I", len(tags)) + table + data


def jpeg_markers(data: bytes) -> list[int]:
    markers, i = [], 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        markers.append(marker)
        if marker in (0xD9, 0xDA):
            break
        i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    return markers


def pixel(img: Image.Image, x: int, y: int) -> tuple[int, int, int]:
    r, g, b = img.convert("RGB").getpixel((x, y))
    return r, g, b


def close_rgb(a: tuple[int, int, int], b: tuple[int, int, int], tolerance: int) -> bool:
    return all(abs(x - y) <= tolerance for x, y in zip(a, b))


def outage(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        pytest.fail(f"{name} names the instance this case needs; it is not set")
    return value.rstrip("/")


def get(base: str, path: str, **params: Any) -> httpx.Response:
    return httpx.get(base + path, params=params or None, timeout=HTTP_TIMEOUT)


def jget(base: str, path: str, **params: Any) -> Any:
    r = get(base, path, **params)
    assert r.status_code == 200, f"GET {path} answered {r.status_code}: {r.text[:300]}"
    return r.json()


def call(method: str, base: str, path: str, body: Any = None, **headers: str) -> httpx.Response:
    return httpx.request(method, base + path, json=body, headers=headers or None, timeout=HTTP_TIMEOUT)


def code_of(r: httpx.Response) -> str | None:
    try:
        return r.json()["error"]["code"]
    except (ValueError, KeyError, TypeError):
        return None


def fields_of(r: httpx.Response) -> dict[str, str]:
    try:
        return r.json()["error"].get("fields", {})
    except (ValueError, KeyError, TypeError, AttributeError):
        return {}


def capture_fields(title: str, **overrides: str | None) -> dict[str, str]:
    fields: dict[str, str | None] = {
        "title": title, "maker": "Braunfeld", "year": "1971", "unit": "mm",
        "width": "236.0", "height": "152.0", "depth": "98.0",
        "materials": "ABS, aluminium", "finish": "Satin", "colour_family": "Grey",
    }
    fields.update(overrides)
    return {k: v for k, v in fields.items() if v is not None}


def post_capture(base: str, fields: dict[str, str], photo: bytes | None, filename: str = "photo.png",
                 content_type: str = "image/png", key: str | None = None) -> httpx.Response:
    files = {"photo": (filename, photo, content_type)} if photo is not None else {"note": (None, "")}
    return httpx.post(base + "/api/references", data=fields, files=files,
                      headers={"Idempotency-Key": key or idempotency_key()}, timeout=HTTP_TIMEOUT)


def new_reference(base: str, title: str | None = None, photo: bytes | None = None, filename: str = "photo.png",
                  content_type: str = "image/png", **overrides: str | None) -> dict[str, Any]:
    title = title or f"{token()} radio"
    r = post_capture(base, capture_fields(title, **overrides), photo or small_png(), filename, content_type)
    assert r.status_code == 201, f"POST /api/references answered {r.status_code}: {r.text[:400]}"
    return r.json()


def new_reel(base: str, name: str | None = None) -> dict[str, Any]:
    r = post_json(base, "/api/reels", {"name": name or f"{token()} reel"})
    assert r.status_code == 201, f"POST /api/reels answered {r.status_code}: {r.text[:300]}"
    return r.json()


def append(base: str, reel_id: str, reference_id: str) -> httpx.Response:
    return post_json(base, f"/api/reels/{reel_id}/stops", {"reference_id": reference_id})


def reorder(base: str, reel_id: str, version: Any, ids: list[str]) -> httpx.Response:
    return call("PUT", base, f"/api/reels/{reel_id}/stops", {"version": version, "reference_ids": ids})


def reel_of(base: str, reel_id: str) -> dict[str, Any]:
    return jget(base, f"/api/reels/{reel_id}")


def reel_with(base: str, refs: list[dict[str, Any]], name: str | None = None) -> dict[str, Any]:
    reel = new_reel(base, name)
    for ref in refs:
        r = append(base, reel["id"], ref["id"])
        assert r.status_code == 200, f"append answered {r.status_code}: {r.text[:300]}"
    return reel_of(base, reel["id"])


def stop_ids(reel: dict[str, Any]) -> list[str]:
    return [s["reference"]["id"] for s in sorted(reel["stops"], key=lambda s: s["position"])]


def library_titles(base: str) -> list[str]:
    listing = jget(base, "/api/references")
    return [r["title"] for r in listing["saved_today"] + listing["earlier"]]


def poll(fetch: Callable[[], Any], ok: Callable[[Any], bool], seconds: float, contract: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fetch()
        if ok(last):
            return last
    pytest.fail(f"{contract}; last observation: {str(last)[:400]}")


def wait_sheet(base: str, sheet_id: str, want: str = "ready",
               seconds: float = SHEET_START_S + SHEET_READY_S + SLACK_S) -> tuple[dict[str, Any], list[str]]:
    seen: list[str] = []

    def fetch() -> dict[str, Any]:
        sheet = jget(base, f"/api/sheets/{sheet_id}")
        if not seen or seen[-1] != sheet["state"]:
            seen.append(sheet["state"])
        return sheet

    sheet = poll(fetch, lambda s: s["state"] in (want, "failed"), seconds,
                 f"contact sheet {sheet_id} reached {want} within the published delay")
    assert sheet["state"] == want, f"sheet ended {sheet['state']} after states {seen}"
    return sheet, seen


def rows_mentioning(pg: Postgres, text: str) -> int:
    total = 0
    for table in pg.tables():
        ident = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        rows = pg.rows(f"SELECT count(*) AS n FROM {ident} AS t WHERE t::text LIKE '%{text}%'")
        total += int(rows[0]["n"])
    return total


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def page_size_pt(pdf: bytes) -> tuple[float, float]:
    m = re.search(rb"/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]", pdf)
    assert m, "the PDF declares a page MediaBox"
    x0, y0, x1, y1 = (float(v) for v in m.groups())
    return x1 - x0, y1 - y0


def flat(text: str) -> str:
    return " ".join(text.split())


def demo_reel(base: str) -> dict[str, Any]:
    for item in jget(base, "/api/reels")["reels"]:
        if item["demo"]:
            return reel_of(base, item["id"])
    pytest.fail("GET /api/reels lists the seeded Demo reel with demo true")


def named_reel(base: str, name: str) -> dict[str, Any]:
    for item in jget(base, "/api/reels")["reels"]:
        if item["name"] == name:
            return reel_of(base, item["id"])
    pytest.fail(f"GET /api/reels lists the seeded reel {name}")


@contextmanager
def entered(obj: Any) -> Iterator[Any]:
    if hasattr(obj, "__enter__"):
        with obj as value:
            yield value
        return
    value = next(obj)
    try:
        yield value
    finally:
        with suppress(StopIteration):
            next(obj)


@contextmanager
def screen(browser: Browser, url: str, viewport: dict[str, int] = DESKTOP,
           reduced_motion: str = "no-preference") -> Iterator[Page]:
    with entered(open_app(browser, url, reduced_motion=reduced_motion)) as page:
        page.set_viewport_size(viewport)
        yield page


@contextmanager
def skewed_page(browser: Browser, url: str, timezone_id: str, skew: datetime, paused: bool = False,
                viewport: dict[str, int] = DESKTOP) -> Iterator[Page]:
    context = browser.new_context(locale="en-US", timezone_id=timezone_id, viewport=viewport)
    try:
        page = context.new_page()
        page.clock.install(time=skew)
        if paused:
            page.clock.pause_at(skew + timedelta(seconds=1))
        page.goto(url)
        yield page
    finally:
        context.close()


def eventually(page: Page, condition: Callable[[], bool], contract: str, seconds: float = EVENTUAL_S,
               step_ms: float = 100) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if condition():
                return
        except PlaywrightError:
            pass
        advance(page, step_ms)
    pytest.fail(contract)


def text_of(locator: Locator) -> str:
    try:
        return " ".join((locator.text_content(timeout=2000) or "").split())
    except PlaywrightError:
        return ""


def deck_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Deck status")


def notices(page: Page) -> Locator:
    return page.get_by_role("status", name="Service notices")


def announcer(page: Page) -> Locator:
    return page.get_by_role("status", name="Reel announcer")


def slider(page: Page) -> Locator:
    return page.get_by_role("slider", name="Reel position")


DETENT_LABEL_JS = """(e, k) => {
  // the detent numbers may live inside the slider or in a sibling track: take the nearest ancestor holding all of them
  let host = e;
  for (let up = 0; up < 6 && host; up++, host = host.parentElement) {
    const leaves = [...host.querySelectorAll('*')].filter(n => !n.children.length && n.textContent.trim() === String(k)
      && n.getClientRects().length);
    if (leaves.length) { const r = leaves[0].getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; }
  }
  return null;
}"""


def detent_label(fader: Locator, k: int) -> dict[str, float] | None:
    fader.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    return fader.evaluate(DETENT_LABEL_JS, k)


def figure(page: Page) -> Locator:
    return page.get_by_role("figure", name="Current reference")


def textbox(page: Page, name: str) -> Locator:
    return page.get_by_role("textbox", name=name, exact=True)


def button(page: Page, name: str, exact: bool = True) -> Locator:
    return page.get_by_role("button", name=name, exact=exact)


def radio(page: Page, group: str, name: str) -> Locator:
    return page.get_by_role("radiogroup", name=group).get_by_role("radio", name=name, exact=True)


def slider_value(locator: Locator) -> int:
    return int(locator.evaluate("e => { const v = e.getAttribute('aria-valuenow'); return Number(v !== null ? v : e.value); }"))


def slider_text(locator: Locator) -> str:
    return locator.get_attribute("aria-valuetext") or ""


def stop_param(page: Page) -> str | None:
    return parse_qs(urlparse(page.url).query).get("stop", [None])[0]


RECORD_JS = """(el, key) => {
  const log = (window.__stowLog = window.__stowLog || {});
  log[key] = [el.textContent.trim().replace(/\\s+/g, ' ')];
  new MutationObserver(() => {
    const t = el.textContent.trim().replace(/\\s+/g, ' ');
    const l = log[key];
    if (l[l.length - 1] !== t) l.push(t);
  }).observe(el, {subtree: true, childList: true, characterData: true});
}"""


def record(locator: Locator, key: str) -> None:
    locator.evaluate(RECORD_JS, key)


def recorded(page: Page, key: str) -> list[str]:
    return page.evaluate("k => ((window.__stowLog || {})[k] || []).slice(1)", key)


def spoken(page: Page, key: str) -> list[str]:
    return [t for t in recorded(page, key) if t]


def fills(locator: Locator) -> list[str]:
    return locator.evaluate(
        "el => [el, ...el.querySelectorAll('*')].flatMap(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.fill]; })")


def has_fill(locator: Locator, swatch: str) -> bool:
    return css_rgb(swatch) in fills(locator)


def box(locator: Locator) -> dict[str, float]:
    b = locator.bounding_box()
    assert b, "element has a layout box"
    return b


def focused(locator: Locator) -> bool:
    return bool(locator.evaluate("e => e === document.activeElement"))


def inside(container: Locator) -> bool:
    return bool(container.evaluate("d => d.contains(document.activeElement)"))


def follows(first: Locator, second: Locator) -> bool:
    return bool(first.evaluate("(a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)",
                               second.element_handle()))


def described_text(page: Page, control: Locator) -> str:
    ids = control.get_attribute("aria-describedby") or ""
    return " ".join(page.evaluate("ids => ids.split(/\\s+/).map(i => (document.getElementById(i) || {}).textContent || '')",
                                  ids).__iter__()).strip()


def tab_until(page: Page, target: Locator, presses: int = 80) -> None:
    for _ in range(presses):
        if focused(target):
            return
        page.keyboard.press("Tab")
    pytest.fail("Tab reached the control by keyboard alone")


def visible_focus(locator: Locator) -> None:
    _rest, focus = state_styles(locator, "outline-style", "outline-width", state="focus")
    assert focus["outline-style"] != "none", "keyboard focus shows a visible outline"


def fill_capture_form(page: Page, title: str, photo: bytes, name: str = "photo.png", mime: str = "image/png",
                      unit: str = "mm", sizes: tuple[str, str, str] = ("236.0", "152.0", "98.0"),
                      year: str = "1971", where: str | None = None) -> None:
    page.get_by_label("Photograph").set_input_files({"name": name, "mimeType": mime, "buffer": photo})
    if title:
        fill(textbox(page, "Name"), title)
    fill(textbox(page, "Maker"), "Braunfeld")
    fill(textbox(page, "Year"), year)
    check(radio(page, "Size unit", unit))
    fill(textbox(page, "Width"), sizes[0])
    fill(textbox(page, "Height"), sizes[1])
    fill(textbox(page, "Depth"), sizes[2])
    fill(textbox(page, "Materials"), "ABS, aluminium")
    fill(textbox(page, "Finish"), "Satin")
    select(page.get_by_role("combobox", name="Colour family"), "Grey")
    if where:
        fill(textbox(page, "Where you found it"), where)


def playback_reel(base: str) -> dict[str, Any]:
    t = token()
    r1 = new_reference(base, title=f"{t} first", maker="Braunfeld", year="1971", photo=small_png(RED))
    gone = new_reference(base, title=f"{t} gone", photo=small_png(YELLOW))
    r2 = new_reference(base, title=f"{t} second", maker="Sondera", year=None, photo=small_png(GREEN))
    r3 = new_reference(base, title=f"{t} third", maker=None, year=None, photo=small_png(BLUE))
    reel = reel_with(base, [r1, gone, r2, r3])
    assert call("DELETE", base, f"/api/references/{gone['id']}").status_code == 200
    return {"reel": reel, "playable": [r1, r2, r3], "trashed": gone}


def spoken_for(refs: list[dict[str, Any]], k: int) -> str:
    ref = refs[k - 1]
    return announce(k, len(refs), ref["title"], ref.get("maker"), ref.get("year"))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Relay:

    def __init__(self, port: int, target: tuple[str, int]):
        self.port, self.target = port, target
        self.server: socket.socket | None = None
        self.stopped = threading.Event()

    def start(self) -> None:
        srv = socket.socket()
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", self.port))
        srv.listen(64)
        self.server = srv
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.stopped.is_set() and self.server is not None:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=30)
            except OSError:
                client.close()
                continue
            threading.Thread(target=self._pump, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pump, args=(upstream, client), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while chunk := src.recv(65536):
                dst.sendall(chunk)
        except OSError:
            pass
        finally:
            with suppress(OSError):
                dst.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        self.stopped.set()
        if self.server is not None:
            with suppress(OSError):
                self.server.shutdown(socket.SHUT_RDWR)
            self.server.close()
            self.server = None


def required_env(*names: str) -> dict[str, str]:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        pytest.fail(f"starting an extra app copy needs {missing} in the verifier environment")
    return {n: os.environ[n] for n in names}


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[tuple[str, Path, subprocess.Popen]]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = dict(os.environ)
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("wb", delete=False, suffix=".log")
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    try:
        yield f"http://127.0.0.1:{port}", Path(log.name), proc
    finally:
        with suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            with suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
        log.close()


def tail(path: Path) -> str:
    return path.read_bytes()[-4000:].decode(errors="replace")


def left_text(page: Page, text: str) -> Locator | None:
    for candidate in page.get_by_text(text, exact=True).all():
        b = candidate.bounding_box()
        if b and b["x"] < DESKTOP["width"] / 2:
            return candidate
    return None


def test_landing_fader_and_scroll_drive_each_other(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url + "/") as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        assert slider_value(fader) == 0
        page.mouse.move(DESKTOP["width"] * 0.25, DESKTOP["height"] / 2)
        forward: list[int] = []
        for _ in range(WHEEL_STEPS):
            page.mouse.wheel(0, WHEEL_PX)
            advance(page, 100)
            forward.append(slider_value(fader))
            if forward[-1] == len(DEMO_STOPS) - 1:
                break
        assert forward and forward[-1] == len(DEMO_STOPS) - 1, f"scrolling down reached the last demo stop: {forward}"
        assert all(b - a in (0, 1) for a, b in zip([0] + forward, forward)), f"forward only, one detent per row: {forward}"
        back: list[int] = []
        for _ in range(WHEEL_STEPS):
            page.mouse.wheel(0, -WHEEL_PX)
            advance(page, 100)
            back.append(slider_value(fader))
            if back[-1] == 0:
                break
        assert back and back[-1] == 0, f"scrolling up returned to the first stop: {back}"
        assert all(a - b in (0, 1) for a, b in zip([forward[-1]] + back, back)), f"backward only: {back}"
        fader.focus()
        page.keyboard.press("End")
        height = DESKTOP["height"]

        def last_row_mid() -> bool:
            row = left_text(page, DEMO_STOPS[-1][0])
            top = row.bounding_box()["y"] if row else -1
            return slider_value(fader) == 2 and height * 0.25 <= top <= height * 0.75

        eventually(page, last_row_mid, "End scrolled the last demo section to the viewport middle")


def test_wf_landing_demo_swatch_match(browser: Browser, app_url: str) -> None:
    fresh = outage("APP_CLOCK_ROLLOVER_URL")
    swatches = {s["reference"]["title"]: s["reference"]["swatch"] for s in demo_reel(fresh)["stops"]}
    with screen(browser, app_url + "/", reduced_motion="reduce") as page:
        expect(page.get_by_role("heading", level=1, name="Keep the object, not the picture.")).to_be_visible()
        expect(page.get_by_role("link", name="Open your deck")).to_have_attribute("href", re.compile(r"/library$"))
        expect(page.get_by_text("Demo photographs are open-access museum images or drawn stand-ins.")).to_be_visible()
        fader = slider(page)
        expect(fader).to_be_visible()
        assert text_of(announcer(page)) == "", "the announcer is empty when Landing loads"
        assert fader.get_attribute("aria-valuemax") in ("2", None) or slider_value(fader) == 0
        fader.focus()
        for k, (title, maker, year, sizes) in enumerate(DEMO_STOPS, start=1):
            if k > 1:
                page.keyboard.press("]")
            want = announce(k, len(DEMO_STOPS), title, maker, year)

            def shown() -> bool:
                caption = text_of(figure(page))
                return (slider_value(fader) == k - 1 and slider_text(fader) == want
                        and (k == 1 or text_of(announcer(page)) == want)
                        and title in caption and size_line(sizes, "mm") in caption
                        and has_fill(figure(page), swatches[title]))

            eventually(page, shown, f"Landing stop {k} shows {want}, its mm size line and the Demo reel swatch")


def test_wf_landing_independent_of_db(browser: Browser) -> None:
    short = outage("APP_SHORT_TRASH_URL")
    storage_down = outage("APP_STORAGE_DOWN_URL")
    demo = demo_reel(short)
    original = stop_ids(demo)
    assert call("PUT", short, "/api/settings/unit", {"unit": "in"}).status_code == 200
    assert reorder(short, demo["id"], demo["version"], original[1:]).status_code == 200
    try:
        with screen(browser, short + "/", reduced_motion="reduce") as page:
            fader = slider(page)
            expect(fader).to_be_visible()
            title, maker, year, sizes = DEMO_STOPS[0]
            eventually(page, lambda: title in text_of(figure(page)) and size_line(sizes, "mm") in text_of(figure(page)),
                       "Landing's first stop is still Desk radio with its mm line")
            fader.focus()
            page.keyboard.press("End")
            last = DEMO_STOPS[-1]
            eventually(page, lambda: slider_text(fader) == announce(3, 3, last[0], last[1], last[2]),
                       "Landing still counts three stops after the Demo reel lost one")
    finally:
        call("PUT", short, "/api/settings/unit", {"unit": "mm"})
        current = reel_of(short, demo["id"])
        reorder(short, demo["id"], current["version"], original)
    with screen(browser, storage_down + "/", reduced_motion="reduce") as page:
        img = figure(page).get_by_role("img", name=DEMO_STOPS[0][0])
        eventually(page, lambda: bool(img.evaluate("i => i.complete && i.naturalWidth > 0")),
                   "Landing's bundled photo loads while storage is unreachable")


def test_wf_landing_rapid_input_settles(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url + "/") as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        fig = figure(page)
        eventually(page, lambda: DEMO_STOPS[0][0] in text_of(fig), "Landing opens on the first demo stop")
        record(fig, "caption")
        record(announcer(page), "ann")
        fader.focus()
        page.keyboard.press("]")
        advance(page, SWAP_HALF_MS / 2)
        page.keyboard.press("]")
        newest = DEMO_STOPS[2]
        eventually(page, lambda: newest[0] in text_of(fig), "the tile settles on the newest stop")
        advance(page, SWAP_MS * 3)
        caption_log = recorded(page, "caption")
        first_newest = next(i for i, t in enumerate(caption_log) if newest[0] in t)
        assert not any(DEMO_STOPS[1][0] in t for t in caption_log[first_newest:]), \
            f"no older caption is painted after the newest stop: {caption_log}"
        assert slider_value(fader) == 2 and slider_text(fader) == announce(3, 3, *newest[:3])
        assert spoken(page, "ann") == [announce(2, 3, *DEMO_STOPS[1][:3]), announce(3, 3, *newest[:3])]


def test_capture_confirmed_and_failure_leaves_nothing(app_url: str, meilisearch: Any) -> None:
    s3, pg = S3(), Postgres()
    title = f"{token()} kettle"
    photo = small_png(CENTRE)
    r = post_capture(app_url, capture_fields(title), photo)
    assert r.status_code == 201, r.text[:300]
    ref = r.json()
    doc = meilisearch.document(MAIN_INDEX, ref["id"])
    assert doc and doc["title"] == title, "the search document exists the moment the 201 arrives"
    assert s3.get(f"references/{ref['id']}/original.png") == photo
    assert f"references/{ref['id']}/display.jpg" in s3.keys(f"references/{ref['id']}/")
    assert ref["photo"]["sha256"] == sha(photo) and ref["photo"]["bytes"] == len(photo)
    assert ref["state"] == "stored" and ref["version"] == 1
    assert rows_mentioning(pg, title.split()[0]) >= 1
    bad = token()
    before = set(s3.keys("references/"))
    refused = post_capture(app_url, capture_fields(f"{bad} kettle", colour_family="Teal"), small_png())
    assert refused.status_code == 422 and code_of(refused) == "validation"
    assert set(s3.keys("references/")) - before == set(), "a refused capture stores no object"
    assert rows_mentioning(pg, bad) == 0, "a refused capture leaves no row"
    assert not meilisearch.search(MAIN_INDEX, bad)["hits"], "a refused capture leaves no search document"
    assert all(bad not in t for t in library_titles(app_url))


PHOTO_CASES = {
    "png_named_jpg": (lambda: small_png(CENTRE), "photo.jpg", "image/jpeg", 201, "image/png"),
    "jpeg_named_png": (lambda: jpeg_image(Image.new("RGB", (96, 96), CENTRE)), "photo.png", "image/png", 201, "image/jpeg"),
    "svg_with_script": (lambda: b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                        "photo.png", "image/png", 422, PHOTO_COPY),
    "png_signature_undecodable": (lambda: PNG_SIG + b"\x00" * 256, "photo.png", "image/png", 422, PHOTO_COPY),
    "header_over_area": (lambda: header_only_png(AREA_W, PIXEL_LIMIT // AREA_W + 1), "photo.png", "image/png", 422, PHOTO_PIXELS_COPY),
    "header_over_side": (lambda: header_only_png(SIDE_LIMIT + 1, 100), "photo.png", "image/png", 422, PHOTO_PIXELS_COPY),
    "jpeg_header_over_area": (lambda: jpeg_with_header_size(AREA_W, PIXEL_LIMIT // AREA_W + 1), "photo.jpg", "image/jpeg", 422, PHOTO_PIXELS_COPY),
    "decodable_over_area": (lambda: solid_png_stream(BOMB_SIDE, BOMB_SIDE), "photo.png", "image/png", 422, PHOTO_PIXELS_COPY),
    "side_at_limit": (lambda: solid_png_stream(SIDE_LIMIT, 100), "photo.png", "image/png", 201, "image/png"),
    "area_at_limit": (lambda: solid_png_stream(AREA_W, PIXEL_LIMIT // AREA_W), "photo.png", "image/png", 201, "image/png"),
}


PHOTO_CASE_IDS = ["png_named_jpg", "jpeg_named_png", "svg_with_script", "png_signature_undecodable", "header_over_area",
                  "header_over_side", "jpeg_header_over_area", "decodable_over_area", "side_at_limit", "area_at_limit"]


@pytest.mark.parametrize("case", PHOTO_CASE_IDS, ids=PHOTO_CASE_IDS)
def test_capture_photo_type_and_pixel_limit(app_url: str, case: str) -> None:
    build, filename, declared, status, expect_value = PHOTO_CASES[case]
    photo = build()
    s3, pg = S3(), Postgres()
    mark = token()
    before = set(s3.keys("references/"))
    started = time.monotonic()
    r = post_capture(app_url, capture_fields(f"{mark} lamp"), photo, filename, declared)
    elapsed = time.monotonic() - started
    assert r.status_code == status, f"{case}: answered {r.status_code}: {r.text[:300]}"
    if status == 201:
        ref = r.json()
        assert ref["photo"]["content_type"] == expect_value
        suffix = "png" if expect_value == "image/png" else "jpg"
        assert s3.get(f"references/{ref['id']}/original.{suffix}") == photo
        got = get(app_url, f"/api/references/{ref['id']}/original")
        assert got.headers["content-type"].startswith(expect_value) and got.content == photo
        return
    assert code_of(r) == "validation" and fields_of(r).get("photo") == expect_value
    if expect_value == PHOTO_PIXELS_COPY:
        assert elapsed < PIXEL_ANSWER_S, f"pixel-limit refusal took {elapsed:.2f} s"
    assert set(s3.keys("references/")) - before == set(), "a refused photo stores nothing"
    assert rows_mentioning(pg, mark) == 0


def exact_multipart(fields: dict[str, str], total: int) -> tuple[bytes, str]:
    boundary = "stowdeck" + uuid.uuid4().hex
    head = b"".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
                    for k, v in fields.items())
    head += f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
    end = f"\r\n--{boundary}--\r\n".encode()
    body = head + padded_png(total - len(head) - len(end)) + end
    assert len(body) == total
    return body, f"multipart/form-data; boundary={boundary}"


VALIDATION_CASES: dict[str, tuple[dict[str, Any], str | None, str | None, int]] = {
    "title_blank": ({"title": "   "}, "title", "Give the object a name of 1 to 80 characters.", 422),
    "title_too_long": ({"title": "t" * (TITLE_MAX + 1)}, "title", "Give the object a name of 1 to 80 characters.", 422),
    "maker_too_long": ({"maker": "m" * (MAKER_MAX + 1)}, "maker", "Keep the maker to 80 characters or fewer.", 422),
    "year_too_early": ({"year": "1799"}, "year", None, 422),
    "year_not_whole": ({"year": "1971.5"}, "year", None, 422),
    "materials_too_many": ({"materials": ", ".join(f"m{chr(97 + i)}" for i in range(MATERIALS_MAX + 1))}, "materials",
                           "List up to 8 materials of 40 characters or fewer.", 422),
    "material_too_long": ({"materials": "x" * (MATERIAL_MAX + 1)}, "materials", "List up to 8 materials of 40 characters or fewer.", 422),
    "finish_too_long": ({"finish": "f" * (FINISH_MAX + 1)}, "finish", "Keep the finish to 80 characters or fewer.", 422),
    "colour_family_unknown": ({"colour_family": "Teal"}, "colour_family", "Choose a colour family.", 422),
    "source_url_scheme": ({"source_url": "ftp://files.example/x"}, "source_url", "Enter a link that starts with http:// or https://.", 422),
    "source_url_too_long": ({"source_url": "https://" + "a" * SOURCE_URL_MAX}, "source_url", "Enter a link that starts with http:// or https://.", 422),
    "source_note_too_long": ({"source_note": "n" * (SOURCE_NOTE_MAX + 1)}, "source_note", "Keep this to 120 characters or fewer.", 422),
    "notes_too_long": ({"notes": "n" * (NOTES_MAX + 1)}, "notes", "Keep notes to 2000 characters or fewer.", 422),
    "width_zero": ({"width": "0"}, "width", "Enter a size above 0 and up to 5000.0 mm (196.9 in).", 422),
    "width_over_mm": ({"width": "5000.1"}, "width", "Enter a size above 0 and up to 5000.0 mm (196.9 in).", 422),
    "width_two_decimals_mm": ({"width": "12.34"}, "width", "Enter a size above 0 and up to 5000.0 mm (196.9 in).", 422),
    "height_over_in": ({"unit": "in", "width": "9.3", "height": "196.86", "depth": "3.9"}, "height",
                       "Enter a size above 0 and up to 5000.0 mm (196.9 in).", 422),
    "depth_three_decimals_in": ({"unit": "in", "width": "9.3", "height": "6.0", "depth": "1.234"}, "depth",
                                "Enter a size above 0 and up to 5000.0 mm (196.9 in).", 422),
    "depth_missing": ({"depth": None}, "depth", "Enter a size above 0 and up to 5000.0 mm (196.9 in).", 422),
    "unit_unknown": ({"unit": "cm"}, "unit", "Choose millimetres or inches.", 422),
    "swatch_x_only": ({"swatch_x": "0.5"}, "swatch_y", "Pick a point on the photograph.", 422),
    "swatch_out_of_range": ({"swatch_x": "1.5", "swatch_y": "0.5"}, "swatch_x", "Pick a point on the photograph.", 422),
    "photo_missing": ({}, "photo", PHOTO_COPY, 422),
    "photo_over_bytes": ({}, "photo", PHOTO_BYTES_COPY, 422),
    "photo_at_bytes": ({}, None, None, 201),
    "multipart_over_limit": ({}, None, None, 413),
    "multipart_at_limit": ({}, "photo", PHOTO_BYTES_COPY, 422),
    "json_over_limit": ({}, None, None, 413),
    "json_at_limit": ({}, "notes", "Keep notes to 2000 characters or fewer.", 422),
}


VALIDATION_CASE_IDS = [
    "title_blank", "title_too_long", "maker_too_long", "year_too_early", "year_not_whole", "materials_too_many",
    "material_too_long", "finish_too_long", "colour_family_unknown", "source_url_scheme", "source_url_too_long",
    "source_note_too_long", "notes_too_long", "width_zero", "width_over_mm", "width_two_decimals_mm", "height_over_in",
    "depth_three_decimals_in", "depth_missing", "unit_unknown", "swatch_x_only", "swatch_out_of_range", "photo_missing",
    "photo_over_bytes", "photo_at_bytes", "multipart_over_limit", "multipart_at_limit", "json_over_limit", "json_at_limit",
]


@pytest.mark.parametrize("case", VALIDATION_CASE_IDS, ids=VALIDATION_CASE_IDS)
def test_capture_validation_copy(app_url: str, case: str) -> None:
    overrides, field, copy, status = VALIDATION_CASES[case]
    mark = token()
    title = overrides.pop("title", f"{mark} fan") if "title" in overrides else f"{mark} fan"
    if case.startswith("json"):
        ref = new_reference(app_url)
        filler_len = JSON_LIMIT + (1 if case == "json_over_limit" else 0)
        skeleton = json.dumps({"version": ref["version"], "notes": ""}, separators=(",", ":")).encode()
        body = json.dumps({"version": ref["version"], "notes": "n" * (filler_len - len(skeleton))}, separators=(",", ":")).encode()
        assert len(body) == filler_len
        r = httpx.patch(f"{app_url}/api/references/{ref['id']}", content=body,
                        headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    elif case.startswith("multipart"):
        total = MULTIPART_LIMIT + (1 if case == "multipart_over_limit" else 0)
        content, ctype = exact_multipart(capture_fields(title), total)
        r = httpx.post(app_url + "/api/references", content=content,
                       headers={"Content-Type": ctype, "Idempotency-Key": idempotency_key()}, timeout=HTTP_TIMEOUT)
    else:
        photo: bytes | None = small_png()
        if case == "photo_missing":
            photo = None
        elif case == "photo_over_bytes":
            photo = padded_png(PHOTO_LIMIT + 1)
        elif case == "photo_at_bytes":
            photo = padded_png(PHOTO_LIMIT)
        r = post_capture(app_url, capture_fields(title, **overrides), photo)
    assert r.status_code == status, f"{case}: answered {r.status_code}: {r.text[:300]}"
    if status == 413:
        assert code_of(r) == "too_large"
    if status == 422:
        assert code_of(r) == "validation" and r.json()["error"]["message"] == CHECK_FIELDS
        got = fields_of(r)
        assert field in got, f"{case}: fields {got} name {field}"
        if copy is not None:
            assert got[field] == copy
        elif field == "year":
            assert re.fullmatch(r"Enter a year from 1800 to \d{4}\.", got[field])
    if status != 201 and not case.startswith("json"):
        assert all(mark not in t for t in library_titles(app_url)), "a refused capture creates no reference"


def test_idempotency_replay_conflict_and_scope(app_url: str) -> None:
    twin = outage("APP_TWIN_URL")
    title = f"{token()} shaver"
    photo = small_png(GREEN)
    key = idempotency_key()
    first = post_capture(app_url, capture_fields(title), photo, key=key)
    assert first.status_code == 201
    for base in (app_url, twin):
        again = post_capture(base, capture_fields(title), photo, key=key)
        assert again.status_code == 201 and again.json() == first.json()
        assert again.headers.get("Idempotent-Replay") == "true"
    assert library_titles(app_url).count(title) == 1, "a replay creates nothing new"
    other = post_capture(app_url, capture_fields(title + " b"), photo, key=key)
    assert other.status_code == 409 and code_of(other) == "idempotency_conflict"
    missing = httpx.post(app_url + "/api/references", data=capture_fields(title), files={"photo": ("p.png", photo, "image/png")},
                         timeout=HTTP_TIMEOUT)
    assert missing.status_code == 400 and code_of(missing) == "idempotency_key_required"
    fresh_key = idempotency_key()
    later_title = f"{token()} shaver"
    refused = post_capture(app_url, capture_fields(later_title, colour_family="Teal"), photo, key=fresh_key)
    assert refused.status_code == 422
    retried = post_capture(app_url, capture_fields(later_title), photo, key=fresh_key)
    assert retried.status_code == 201 and retried.headers.get("Idempotent-Replay") != "true"
    ref = new_reference(app_url)
    reel_a, reel_b = reel_with(app_url, [ref]), reel_with(app_url, [ref])
    sheet_key = idempotency_key()
    body = {"paper": "a4", "unit": "mm"}
    sheet_a = post_json(app_url, f"/api/reels/{reel_a['id']}/sheets", body, key=sheet_key)
    sheet_b = post_json(app_url, f"/api/reels/{reel_b['id']}/sheets", body, key=sheet_key)
    assert sheet_a.status_code == 202 and sheet_b.status_code == 202
    assert sheet_a.json()["id"] != sheet_b.json()["id"] and sheet_b.json()["reel_id"] == reel_b["id"]
    wait_sheet(app_url, sheet_a.json()["id"])
    replay = post_json(app_url, f"/api/reels/{reel_a['id']}/sheets", body, key=sheet_key)
    assert replay.status_code == 202 and replay.json() == sheet_a.json() and replay.json()["state"] == "queued"
    assert replay.headers.get("Idempotent-Replay") == "true"
    clash = post_json(app_url, f"/api/reels/{reel_a['id']}/sheets", {"paper": "letter", "unit": "mm"}, key=sheet_key)
    assert clash.status_code == 409 and code_of(clash) == "idempotency_conflict"


def test_wf_capture_replay_in_flight_across_copies(browser: Browser, app_url: str) -> None:
    twin = outage("APP_TWIN_URL")
    title = f"{token()} recorder"
    photo = solid_png_stream(AREA_W, PIXEL_LIMIT // AREA_W, CORNER)
    with screen(browser, app_url + "/capture") as page:
        expect(page.get_by_role("heading", name="Capture an object")).to_be_visible()
        fill_capture_form(page, title, photo)
        held_routes: list[Any] = []
        page.route("**/api/references", lambda route: held_routes.append(route))
        click(button(page, "Save to deck"))
        eventually(page, lambda: bool(held_routes), "Save to deck sent POST /api/references")
        request = held_routes[0].request
        key = request.headers.get("idempotency-key")
        assert key, "the capture carries an Idempotency-Key"
        body, ctype = request.post_data_buffer, request.headers["content-type"]
        headers = {"Idempotency-Key": key, "Content-Type": ctype}
        duplicates: list[httpx.Response] = []
        with ThreadPoolExecutor(1) as pool:
            first = pool.submit(httpx.post, twin + "/api/references", content=body, headers=headers, timeout=HTTP_TIMEOUT)
            deadline = time.monotonic() + HTTP_TIMEOUT
            while not first.done() and time.monotonic() < deadline:
                duplicates.append(httpx.post(app_url + "/api/references", content=body, headers=headers, timeout=HTTP_TIMEOUT))
            answers = [first.result()] + duplicates
        fresh = [r for r in answers if r.status_code == 201 and r.headers.get("Idempotent-Replay") != "true"]
        in_flight = [r for r in answers if r.status_code == 409 and code_of(r) == "idempotency_in_flight"]
        assert len(fresh) == 1, f"exactly one request did the capture: {[r.status_code for r in answers]}"
        assert in_flight, "a duplicate arriving while the first ran got 409 idempotency_in_flight"
        for r in answers:
            assert r in in_flight or (r.status_code == 201 and r.json()["id"] == fresh[0].json()["id"])
        held_routes[0].fulfill(status=409, headers={"content-type": "application/json"}, body=in_flight[0].content)
        expect(deck_status(page)).to_have_text("This save is still in progress. Wait for it to finish.")
        expect(textbox(page, "Name")).to_have_value(title)
        expect(button(page, "Save to deck")).to_be_focused()
        page.unroute("**/api/references")
        with page.expect_response(lambda r: r.url.endswith("/api/references") and r.request.method == "POST") as info:
            click(button(page, "Save to deck"))
        assert info.value.request.headers.get("idempotency-key") == key, "the resend reuses the same key"
        assert info.value.status == 201
        expect(deck_status(page)).to_have_text("Saved to your deck.")
    assert library_titles(app_url).count(title) == 1


def test_wf_capture_happy_phone(browser: Browser, app_url: str, meilisearch: Any) -> None:
    title = f"{token()} radio"
    photo = sideways_jpeg(token())
    with screen(browser, app_url + "/capture", viewport=PHONE) as page:
        expect(page.get_by_role("heading", name="Capture an object")).to_be_visible()
        fill_capture_form(page, title, photo, name="IMG_0001.jpg", mime="image/jpeg", unit="in",
                          sizes=("9.3", "6.0", "3.9"), where="Flea market, Ghent")
        click(button(page, "Save to deck"))
        expect(deck_status(page)).to_have_text("Saved to your deck.", timeout=EVENTUAL_S * 1000)
    listing = jget(app_url, "/api/references")
    ref = listing["saved_today"][0]
    assert ref["title"] == title, "the new reference sits at the top of Saved today"
    assert [r["title"] for r in listing["saved_today"]].count(title) == 1
    assert ref["size_tenths_mm"] == {"width": tenths_from_in("9.3"), "height": tenths_from_in("6.0"), "depth": tenths_from_in("3.9")}
    assert ref["photo"]["content_type"] == "image/jpeg"
    assert S3().get(f"references/{ref['id']}/original.jpg") == photo
    assert meilisearch.document(MAIN_INDEX, ref["id"])
    with screen(browser, app_url + "/library", viewport=PHONE) as page:
        saved = page.get_by_role("heading", name="Saved today")
        expect(saved).to_be_visible()
        expect(page.get_by_role("link", name=title)).to_be_visible()
        names = page.get_by_role("link").evaluate_all(
            "(els, h) => els.filter(e => h.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING).map(e => e.textContent)",
            saved.element_handle())
        assert names and title in names[0], f"the first row under Saved today is the new reference: {names[:3]}"


def test_wf_capture_announced_progress(browser: Browser) -> None:
    dst = outage("APP_CLOCK_DST_URL")
    title = f"{token()} lamp"
    with screen(browser, dst + "/capture") as page:
        expect(page.get_by_role("heading", name="Capture an object")).to_be_visible()
        fill_capture_form(page, "", small_png(CORNER), year=str(DST_YEAR + 1))
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/api/references") else None)
        save = button(page, "Save to deck")
        with entered(_held(page)) as gate:
            click(save)
            expect(deck_status(page)).to_have_text("Saving the original to storage.")
            expect(save).to_have_attribute("aria-disabled", "true")
            pending = box(save)
            page.mouse.click(pending["x"] + pending["width"] / 2, pending["y"] + pending["height"] / 2)
            gate.release()
        expect(deck_status(page)).to_have_text(CHECK_FIELDS)
        assert len(posts) == 1, "pressing Save again while pending sends nothing"
        name, year = textbox(page, "Name"), textbox(page, "Year")
        expect(name).to_be_focused()
        expect(name).to_have_attribute("aria-invalid", "true")
        expect(year).to_have_attribute("aria-invalid", "true")
        assert "Give the object a name of 1 to 80 characters." in described_text(page, name)
        assert f"Enter a year from 1800 to {DST_YEAR}." in described_text(page, year)
        fill(name, title)
        click(save)
        expect(year).to_be_focused()
        fill(year, str(DST_YEAR))
        click(save)
        expect(deck_status(page)).to_have_text("Saved to your deck.", timeout=EVENTUAL_S * 1000)
        for _ in range(8):
            advance(page, STATUS_CHECK_S * 1000)
        expect(deck_status(page)).to_have_text("Saved to your deck.")
    saved = [r for r in jget(dst, "/api/references")["saved_today"] if r["title"] == title]
    assert len(saved) == 1 and saved[0]["year"] == DST_YEAR


def _held(page: Page) -> Any:
    from conftest import held
    return held(page, "**/api/references")


def test_wf_capture_type_by_bytes(browser: Browser, app_url: str) -> None:
    title = f"{token()} camera"
    photo = small_png(GREEN)
    with screen(browser, app_url + "/capture") as page:
        fill_capture_form(page, title, photo, name="holiday.jpg", mime="image/jpeg")
        click(button(page, "Save to deck"))
        expect(deck_status(page)).to_have_text("Saved to your deck.", timeout=EVENTUAL_S * 1000)
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        fill_capture_form(page, f"{token()} camera", svg, name="trick.png", mime="image/png")
        click(button(page, "Save to deck"))
        expect(deck_status(page)).to_have_text(CHECK_FIELDS)
        photo_input = page.get_by_label("Photograph")
        expect(photo_input).to_have_attribute("aria-invalid", "true")
        expect(photo_input).to_be_focused()
        assert PHOTO_COPY in described_text(page, photo_input)
    ref = next(r for r in jget(app_url, "/api/references")["saved_today"] if r["title"] == title)
    assert ref["photo"]["content_type"] == "image/png"
    keys = S3().keys(f"references/{ref['id']}/")
    assert f"references/{ref['id']}/original.png" in keys and f"references/{ref['id']}/original.jpg" not in keys


def test_wf_library_saved_today_home_zone(browser: Browser) -> None:
    mid = outage("APP_CLOCK_MIDNIGHT_URL")
    listing = jget(mid, "/api/references")
    today = [r["title"] for r in listing["saved_today"]]
    earlier = [r["title"] for r in listing["earlier"]]
    assert listing["zone"] == "Europe/London"
    assert "Bead-blasted kettle" in today and "Telephone handset" in earlier
    now = datetime.fromisoformat(jget(mid, "/api/status")["server_now"].replace("Z", "+00:00"))
    local = now.astimezone(ZoneInfo("Europe/London"))
    start = datetime(local.year, local.month, local.day, tzinfo=ZoneInfo("Europe/London")).astimezone(timezone.utc)
    assert listing["today_starts_at"] == start.strftime("%Y-%m-%dT%H:%M:%SZ")
    own = new_reference(mid)
    assert own["id"] in [r["id"] for r in jget(mid, "/api/references")["saved_today"]]
    skew = now + timedelta(hours=9)
    with skewed_page(browser, mid + "/library", "Asia/Tokyo", skew) as page:
        saved, older = page.get_by_role("heading", name="Saved today"), page.get_by_role("heading", name="Earlier")
        expect(saved).to_be_visible()
        kettle = page.get_by_role("link", name="Bead-blasted kettle").last
        handset = page.get_by_role("link", name="Telephone handset").last
        expect(kettle).to_be_visible()
        assert follows(saved, kettle) and follows(kettle, older), "Bead-blasted kettle sits in Saved today"
        assert follows(older, handset)


def test_search_confirmed_by_index(app_url: str, meilisearch: Any) -> None:
    t, note_word, material = token(), token(), token()
    ref = new_reference(app_url, title=f"{t} kettle", notes=f"{note_word} parting line", materials=f"Steel, {material}",
                        finish="Gloss enamel", colour_family="Green")
    found = jget(app_url, "/api/search", q=t)
    assert found["source"] == "index" and ref["id"] in [r["id"] for r in found["results"]]
    assert ref["id"] in [r["id"] for r in jget(app_url, "/api/search", q=note_word)["results"]]
    assert ref["id"] in [r["id"] for r in jget(app_url, "/api/search", q=t, colour_family="Green")["results"]]
    assert ref["id"] not in [r["id"] for r in jget(app_url, "/api/search", q=t, colour_family="Grey")["results"]]
    assert ref["id"] in [r["id"] for r in jget(app_url, "/api/search", q=t, material=material)["results"]]
    assert ref["id"] in [r["id"] for r in jget(app_url, "/api/search", q=t, finish="Gloss enamel")["results"]]
    doc = meilisearch.document(MAIN_INDEX, ref["id"])
    for key in ("title", "maker", "year", "materials", "finish", "colour_family", "notes"):
        assert key in doc, f"the search document carries {key}"
    settings = meilisearch.settings(MAIN_INDEX)
    filterable = settings.get("filterableAttributes", [])
    for key in ("colour_family", "materials", "finish", "maker", "year"):
        assert key in filterable or "*" in filterable
    assert ref["id"] in [h["id"] for h in meilisearch.search(MAIN_INDEX, t)["hits"]]
    assert call("DELETE", app_url, f"/api/references/{ref['id']}").status_code == 200
    assert ref["id"] not in [r["id"] for r in jget(app_url, "/api/search", q=t)["results"]]
    assert meilisearch.document(MAIN_INDEX, ref["id"]) is None
    assert call("POST", app_url, f"/api/references/{ref['id']}/restore").status_code == 200
    assert ref["id"] in [r["id"] for r in jget(app_url, "/api/search", q=note_word)["results"]]


def test_wf_library_latest_query_wins(browser: Browser, app_url: str) -> None:
    ta, tb = token(), token()
    new_reference(app_url, title=f"{ta} radio", colour_family="Grey")
    new_reference(app_url, title=f"{tb} radio", colour_family="Grey")
    with screen(browser, app_url + "/library") as page:
        search = page.get_by_role("searchbox", name="Search your deck")
        expect(search).to_be_visible()
        held_routes: list[Any] = []
        settled: list[str] = []
        page.on("requestfinished", lambda r: settled.append(r.url) if ta in r.url else None)
        page.on("requestfailed", lambda r: settled.append(r.url) if ta in r.url else None)

        def route_search(route: Any) -> None:
            if ta in route.request.url and not held_routes:
                held_routes.append(route)
            else:
                route.continue_()

        page.route("**/api/search**", route_search)
        fill(search, ta)
        eventually(page, lambda: bool(held_routes), "typing paused, then GET /api/search left for the first text")
        fill(search, tb)
        advance(page, SEARCH_SETTLE_MS)
        link_a, link_b = page.get_by_role("link", name=ta), page.get_by_role("link", name=tb)
        eventually(page, lambda: link_b.count() > 0, "results for the latest text appear")
        with suppress(PlaywrightError):
            held_routes[0].continue_()
        eventually(page, lambda: bool(settled), "the older search answered or was abandoned")
        advance(page, SEARCH_SETTLE_MS)
        expect(link_a).to_have_count(0)
        expect(link_b.first).to_be_visible()
        expect(deck_status(page)).to_have_text("1 reference matches.")
        page.unroute("**/api/search**")
        family = page.get_by_role("combobox", name="Colour family")
        select(family, "Green")
        eventually(page, lambda: text_of(deck_status(page)) == "No references match that search." and link_b.count() == 0,
                   "the filter change shows the zero-results copy")
        select(family, "Grey")
        eventually(page, lambda: text_of(deck_status(page)) == "1 reference matches." and link_b.count() > 0,
                   "the Grey filter brings the result back")
        fill(search, "")
        search.focus()
        page.keyboard.type(ta)
        advance(page, SEARCH_SETTLE_MS)
        eventually(page, lambda: link_a.count() > 0 and link_b.count() == 0, "the final keystroke is never dropped")
        fill(search, "")
        select(family, "All colours")
        eventually(page, lambda: page.get_by_role("heading", name="Saved today").count() > 0,
                   "clearing returns to the grouped library")


def test_wf_library_browse_layouts(browser: Browser, app_url: str) -> None:
    ref = new_reference(app_url, title=f"{token()} clock")
    for viewport, band in ((PHONE, PHONE_FIELD_FRACTION), (TABLET, TABLET_FIELD_FRACTION), (DESKTOP, None)):
        with screen(browser, app_url + "/library", viewport=viewport) as page:
            heading = page.get_by_role("heading", name="Library", exact=True)
            expect(heading).to_be_visible()
            layout(page)
            tile, head = box(figure(page)), box(heading)
            vw, vh = viewport["width"], viewport["height"]
            if band is not None:
                assert tile["y"] + tile["height"] <= vh * (band + LAYOUT_TOL), f"{vw}: tile inside the top field"
                assert abs(tile["x"] + tile["width"] / 2 - vw / 2) <= vw * LAYOUT_TOL, f"{vw}: tile centred"
                assert head["y"] >= tile["y"] + tile["height"] - 1, f"{vw}: heading below the field"
            else:
                assert tile["x"] >= vw / 2 - 1 and head["x"] + head["width"] <= vw / 2 + vw * LAYOUT_TOL
                assert abs(tile["width"] - DESKTOP_TILE_PX) <= DESKTOP_TILE_PX * 0.25
            if viewport is TABLET:
                earlier = page.get_by_role("heading", name="Earlier")
                xs = {round(b["x"] / 10) for link in page.get_by_role("link").all()
                      if follows(earlier, link) and (b := link.bounding_box())}
                assert len(xs) >= 2, "tablet library rows flow in two columns"
            page.mouse.wheel(0, 400)
            advance(page, 300)
            assert abs(box(figure(page))["y"] - tile["y"]) <= 2, f"{vw}: the field stays pinned"
            if viewport is DESKTOP:
                row = page.get_by_role("link", name=ref["title"]).last
                row.evaluate("e => e.scrollIntoView({block: 'center'})")
                page.mouse.move(*center(row))
                img = figure(page).get_by_role("img", name=ref["title"])
                eventually(page, lambda: img.count() > 0, "hovering the row loads it into the tile")
                click(row)
                expect(page.get_by_role("heading", name=ref["title"])).to_be_visible()


def test_wf_library_in_place_refetch(browser: Browser, app_url: str) -> None:
    r1 = new_reference(app_url, title=f"{token()} lamp")
    with screen(browser, app_url + "/library") as page:
        link1 = page.get_by_role("link", name=r1["title"]).last
        expect(link1).to_be_visible()
        link1.focus()
        img1 = figure(page).get_by_role("img", name=r1["title"])
        eventually(page, lambda: img1.count() > 0, "focusing the row loads it into the tile")
        handle = link1.element_handle()
        status_before = text_of(deck_status(page))
        r2 = new_reference(app_url, title=f"{token()} lamp")
        link2 = page.get_by_role("link", name=r2["title"]).last
        eventually(page, lambda: link2.count() > 0, "a refetch adds the new reference", seconds=40, step_ms=1000)
        assert handle.evaluate("e => e.isConnected") and focused(link1), "the focused row keeps its element and focus"
        assert follows(link2, link1), "the new row sits at its newest-first place"
        assert img1.count() > 0 and text_of(deck_status(page)) == status_before
        assert call("PATCH", app_url, f"/api/references/{r1['id']}", {"version": 1, "maker": "Sondera"}).status_code == 200
        eventually(page, lambda: "Sondera" in text_of(link1),
                   "a changed maker updates in its row", seconds=40, step_ms=1000)
        assert handle.evaluate("e => e.isConnected") and text_of(deck_status(page)) == status_before
        r3 = new_reference(app_url, title=f"{token()} lamp")
        search = page.get_by_role("searchbox", name="Search your deck")
        fill(search, r3["title"].split()[0])
        advance(page, SEARCH_SETTLE_MS)
        link3 = page.get_by_role("link", name=r3["title"])
        eventually(page, lambda: link3.count() > 0, "the search shows its result")
        assert call("DELETE", app_url, f"/api/references/{r3['id']}").status_code == 200
        advance(page, REFETCH_MS)
        advance(page, 500)
        assert link3.count() > 0, "a refetch leaves an active search's results exactly as they were"
        fill(search, "")
        advance(page, SEARCH_SETTLE_MS)
        link1 = page.get_by_role("link", name=r1["title"]).last
        eventually(page, lambda: link1.count() > 0, "the grouped library returns")
        link1.focus()
        assert call("DELETE", app_url, f"/api/references/{r1['id']}").status_code == 200
        eventually(page, lambda: page.get_by_role("link", name=r1["title"]).count() == 0,
                   "a refetch removes the trashed row", seconds=40, step_ms=1000)
        active = page.evaluate("() => [document.activeElement.getAttribute('href') || '', document.activeElement.textContent || '']")
        assert "/references/" in active[0] and r1["title"] not in active[1], "focus moved to a neighbouring row link"


def test_wf_facts_inch_no_drift(browser: Browser) -> None:
    dst = outage("APP_CLOCK_DST_URL")
    ref = new_reference(dst)
    sizes = (2360, 1520, 980)
    assert ref["size_tenths_mm"] == dict(zip(("width", "height", "depth"), sizes))
    assert ref["size_text"] == {"mm": "236.0 × 152.0 × 98.0 mm", "in": "9.3 × 6.0 × 3.9 in"}
    try:
        with screen(browser, f"{dst}/references/{ref['id']}") as page:
            expect(page.get_by_role("heading", name=ref["title"])).to_be_visible()
            check(radio(page, "Size unit", "in"))
            expect(page.get_by_text("9.3 × 6.0 × 3.9 in").first).to_be_visible()
            click(button(page, "Edit facts"))
            click(button(page, "Save facts"))
            expect(deck_status(page)).to_have_text("Facts saved.", timeout=EVENTUAL_S * 1000)
        after = jget(dst, f"/api/references/{ref['id']}")
        assert after["size_tenths_mm"] == ref["size_tenths_mm"] and after["version"] == 2, "saving inches never drifts"

        half = new_reference(dst, unit="in", width="0.75", height="6.0", depth="3.9")
        assert half["size_tenths_mm"]["width"] == tenths_from_in("0.75")
        assert half["size_text"]["in"].startswith(in_text(tenths_from_in("0.75")) + " × ")
    finally:
        call("PUT", dst, "/api/settings/unit", {"unit": "mm"})


def test_wf_facts_exif_upright_pixels(browser: Browser, app_url: str) -> None:
    photo = sideways_jpeg(token())
    ref = new_reference(app_url, photo=photo, filename="IMG_0002.jpg", content_type="image/jpeg")
    assert (ref["photo"]["width"], ref["photo"]["height"]) == (STORED_H, STORED_W), "orientation 6 swaps width and height"
    original = get(app_url, f"/api/references/{ref['id']}/original")
    assert original.status_code == 200 and original.content == photo
    assert S3().get(f"references/{ref['id']}/original.jpg") == photo
    display = Image.open(io.BytesIO(get(app_url, f"/api/references/{ref['id']}/display").content))
    assert display.size == (STORED_H, STORED_H)
    assert close_rgb(pixel(display, 5, 5), BLUE, 12) and close_rgb(pixel(display, STORED_H - 5, STORED_H - 5), GREEN, 12)
    with screen(browser, f"{app_url}/references/{ref['id']}") as page:
        pick = button(page, "Pick swatch")
        click(pick)
        group = page.get_by_role("group", name="Eyedropper")
        expect(group).to_be_visible()
        for _ in range(12):
            page.keyboard.press("Shift+ArrowLeft")
            page.keyboard.press("Shift+ArrowUp")
        page.keyboard.press("Enter")
        expect(deck_status(page)).to_have_text("Swatch set from the photo.", timeout=EVENTUAL_S * 1000)
        expect(pick).to_be_focused()
        click(button(page, "View original"[:13], exact=False))
        dialog = page.get_by_role("dialog", name="Original photograph")
        expect(dialog).to_be_visible()
        shown = box(dialog.get_by_role("img").first)
        assert shown["height"] > shown["width"], "the original is shown upright"
    after = jget(app_url, f"/api/references/{ref['id']}")
    assert after["swatch_source"] == "eyedropper" and near(after["swatch"], BLUE, 3), "top-left of the upright photo"


def test_wf_facts_p3_swatch_conversion(browser: Browser, app_url: str) -> None:
    plain = new_reference(app_url, photo=framed())
    assert plain["swatch"] == hex_of(CENTRE) and plain["swatch_source"] == "computed"
    assert new_reference(app_url, photo=transparent_centre(False))["swatch"] == hex_of(CENTRE)
    assert new_reference(app_url, photo=transparent_centre(True))["swatch"] == hex_of((0, 0, 0))
    wide = new_reference(app_url, photo=framed(display_p3_icc()))
    assert near(wide["swatch"], p3_to_srgb(CENTRE), 1), "a Display P3 mean is converted to screen colour"
    with screen(browser, f"{app_url}/references/{wide['id']}") as page:
        pick = button(page, "Pick swatch")
        click(pick)
        expect(page.get_by_role("group", name="Eyedropper")).to_be_visible()
        page.keyboard.press("Escape")
        expect(pick).to_be_focused()
        assert jget(app_url, f"/api/references/{wide['id']}")["version"] == 1, "cancel changes nothing"
        click(pick)
        for _ in range(12):
            page.keyboard.press("Shift+ArrowRight")
            page.keyboard.press("Shift+ArrowUp")
        page.keyboard.press("Enter")
        expect(deck_status(page)).to_have_text("Swatch set from the photo.", timeout=EVENTUAL_S * 1000)
        picked = jget(app_url, f"/api/references/{wide['id']}")
        assert picked["swatch_source"] == "eyedropper" and near(picked["swatch"], p3_to_srgb(CORNER), 1)
        eventually(page, lambda: has_fill(figure(page), picked["swatch"]), "the tile uses the stored swatch")
        click(button(page, "Reset swatch"))
        expect(deck_status(page)).to_have_text("Swatch reset to the measured colour.", timeout=EVENTUAL_S * 1000)
    reset = jget(app_url, f"/api/references/{wide['id']}")
    assert reset["swatch"] == wide["swatch"] and reset["swatch_source"] == "computed" and reset["version"] == 3
    point = call("POST", app_url, f"/api/references/{plain['id']}/swatch", {"x": 1.5, "y": 0.5})
    assert point.status_code == 422 and fields_of(point).get("x") == "Pick a point on the photograph."


def test_wf_facts_version_cas_across_copies(browser: Browser, app_url: str) -> None:
    twin = outage("APP_TWIN_URL")
    ref = new_reference(app_url)
    missing = call("PATCH", app_url, f"/api/references/{ref['id']}", {"finish": "Matte"})
    assert missing.status_code == 422 and fields_of(missing).get("version") == "Send the reference's current version number."
    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda pair: call("PATCH", pair[0], f"/api/references/{ref['id']}",
                                                  {"version": 1, "finish": pair[1]}),
                                [(app_url, "Matte"), (twin, "Gloss")]))
    codes = sorted(r.status_code for r in answers)
    assert codes == [200, 409], codes
    loser = next(r for r in answers if r.status_code == 409)
    assert code_of(loser) == "reference_version_conflict"
    winner = next(r for r in answers if r.status_code == 200).json()
    assert jget(app_url, f"/api/references/{ref['id']}")["finish"] == winner["finish"]
    with screen(browser, f"{app_url}/references/{ref['id']}") as laptop, screen(browser, f"{twin}/references/{ref['id']}", viewport=PHONE) as phone:
        expect(laptop.get_by_role("heading", name=ref["title"])).to_be_visible()
        expect(phone.get_by_role("heading", name=ref["title"])).to_be_visible()
        click(button(phone, "Edit facts"))
        fill(textbox(phone, "Finish"), "Bead-blasted")
        click(button(phone, "Save facts"))
        expect(deck_status(phone)).to_have_text("Facts saved.", timeout=EVENTUAL_S * 1000)
        click(button(laptop, "Edit facts"))
        fill(textbox(laptop, "Name"), ref["title"] + " renamed")
        click(button(laptop, "Save facts"))
        expect(deck_status(laptop)).to_have_text("This reference changed in another window. Reloaded the latest facts.",
                                                 timeout=EVENTUAL_S * 1000)
        expect(button(laptop, "Edit facts")).to_be_focused()
        expect(laptop.get_by_text("Bead-blasted").first).to_be_visible()
    final = jget(app_url, f"/api/references/{ref['id']}")
    assert final["finish"] == "Bead-blasted" and final["title"] == ref["title"] and final["version"] == 3


def test_facts_journey_original_one_key(browser: Browser) -> None:
    dst = outage("APP_CLOCK_DST_URL")
    ref = new_reference(dst, photo=small_png(CORNER, size=(300, 200)))
    try:
        with screen(browser, dst + "/library") as page:
            click(page.get_by_role("link", name=ref["title"]).last)
            expect(page.get_by_role("heading", name=ref["title"])).to_be_visible()
            check(radio(page, "Size unit", "in"))
            expect(page.get_by_text(ref["size_text"]["in"]).first).to_be_visible()
            edit = button(page, "Edit facts")
            edit.focus()
            page.keyboard.press("o")
            dialog = page.get_by_role("dialog", name="Original photograph")
            expect(dialog).to_be_visible()
            img = dialog.get_by_role("img").first
            eventually(page, lambda: img.evaluate("i => [i.naturalWidth, i.naturalHeight]") == [300, 200],
                       "the dialog shows the whole original")
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            expect(edit).to_be_focused()
        assert jget(dst, "/api/settings")["unit"] == "in", "the facts unit toggle saves the preference"
    finally:
        call("PUT", dst, "/api/settings/unit", {"unit": "mm"})


def open_reel(browser: Browser, base: str, reel_id: str, query: str = "", **kw: Any) -> Any:
    return screen(browser, f"{base}/reels/{reel_id}{query}", **kw)


def test_fader_detents_inputs(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    with open_reel(browser, app_url, data["reel"]["id"], reduced_motion="reduce") as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        assert fader.get_attribute("aria-valuemin") in ("0", None) and fader.get_attribute("aria-valuemax") in ("2", None)
        assert all(detent_label(fader, k) for k in range(1, len(refs) + 1)), "visible detent numbers 1 to N"
        fader.focus()
        page.keyboard.press("ArrowLeft")
        assert slider_value(fader) == 0, "no wrap at the start"
        page.keyboard.press("End")
        page.keyboard.press("ArrowUp")
        assert slider_value(fader) == 2, "no wrap at the end"
        page.keyboard.press("Home")
        assert slider_value(fader) == 0
        button(page, f"Move {refs[1]['title']} up").focus()
        page.keyboard.press("]")
        assert slider_value(fader) == 1, "] works with focus on a stop button"
        page.keyboard.press("[")
        assert slider_value(fader) == 0
        click(button(page, "Print contact sheet"))
        expect(page.get_by_role("dialog", name="Print contact sheet")).to_be_visible()
        page.keyboard.press("]")
        assert slider_value(fader) == 0, "shortcuts do nothing while a dialog is open"
        page.keyboard.press("Escape")
        first, last, knob = detent_label(fader, 1), detent_label(fader, len(refs)), box(fader)
        assert first and last
        y = knob["y"] + knob["height"] / 2
        page.mouse.move(first["x"], y)
        page.mouse.down()
        page.mouse.move(last["x"], y, steps=10)
        page.mouse.up()
        eventually(page, lambda: slider_value(fader) == 2 and slider_text(fader) == spoken_for(refs, 3),
                   "dragging to the end lands on the last detent")


def test_fader_pull_sequence(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    with open_reel(browser, app_url, data["reel"]["id"]) as page:
        fader, fig = slider(page), figure(page)
        eventually(page, lambda: refs[0]["title"] in text_of(fig), "the reel opens on stop 1")
        record(fig, "caption")
        record(announcer(page), "ann")
        fader.focus()
        page.keyboard.press("ArrowRight")
        assert slider_value(fader) == 1 and slider_text(fader) == spoken_for(refs, 2) and stop_param(page) == "2"
        assert refs[0]["title"] in text_of(fig), "the caption changes only once the shutter covers the tile"
        eventually(page, lambda: refs[1]["title"] in text_of(fig) and has_fill(fig, refs[1]["swatch"]),
                   "the swap ends on stop 2's caption and fill")
        page.keyboard.press("ArrowRight")
        advance(page, SWAP_HALF_MS / 2)
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: refs[1]["title"] in text_of(fig) and slider_value(fader) == 1,
                   "the tile settles on the newest stop")
        settled = len(recorded(page, "caption"))
        advance(page, SWAP_MS * 3)
        assert not any(refs[2]["title"] in t for t in recorded(page, "caption")[settled:]), "no stale caption is painted"
        assert has_fill(fig, refs[1]["swatch"]) and stop_param(page) == "2"
        assert spoken(page, "ann") == [spoken_for(refs, 2), spoken_for(refs, 3), spoken_for(refs, 2)]


def test_reel_scroll_binding(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    with open_reel(browser, app_url, data["reel"]["id"]) as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        page.mouse.move(DESKTOP["width"] * 0.25, DESKTOP["height"] / 2)
        seen: list[int] = []
        for direction, goal in ((1, 2), (-1, 0)):
            run: list[int] = []
            for _ in range(WHEEL_STEPS):
                page.mouse.wheel(0, direction * WHEEL_PX)
                advance(page, 100)
                run.append(slider_value(fader))
                if run[-1] == goal:
                    break
            assert run and run[-1] == goal, f"scroll reached stop {goal + 1}: {run}"
            steps = [b - a for a, b in zip([seen[-1] if seen else 0] + run, run)]
            assert all(s * direction in (0, 1) for s in steps), f"one detent per row, one direction: {run}"
            seen += run
        record(announcer(page), "ann")
        fader.focus()
        page.keyboard.press("End")
        row = page.get_by_role("list", name="Stops").get_by_role("listitem").filter(has_text=refs[2]["title"])
        middle = DESKTOP["height"] / 2
        eventually(page, lambda: abs(box(row)["y"] - middle) <= DESKTOP["height"] * 0.1,
                   "the last stop's row top sits at the viewport middle")
        advance(page, SWAP_MS * 2)
        assert spoken(page, "ann") == [spoken_for(refs, 3)], "programmatic scrolling triggers no second stop change"


def test_reel_announcer_wording(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    with open_reel(browser, app_url, data["reel"]["id"], reduced_motion="reduce") as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        assert text_of(announcer(page)) == ""
        fader.focus()
        page.keyboard.press("ArrowRight")
        expect(announcer(page)).to_have_text(f"Reference 2 of 3: {refs[1]['title']}, Sondera")
        page.keyboard.press("ArrowRight")
        expect(announcer(page)).to_have_text(f"Reference 3 of 3: {refs[2]['title']}")
    rollover = outage("APP_CLOCK_ROLLOVER_URL")
    halden = named_reel(rollover, "Halden kickoff")
    with open_reel(browser, rollover, halden["id"], "?stop=3", reduced_motion="reduce") as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        fader.focus()
        page.keyboard.press("]")
        expect(announcer(page)).to_have_text("Reference 4 of 12: Desk radio, Braunfeld 1971")


def test_wf_playback_refetch_keeps_reference(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    r1, r2, r3 = data["playable"]
    gone = data["trashed"]
    reel_id = data["reel"]["id"]
    with open_reel(browser, app_url, reel_id, "?stop=2") as page:
        fader, fig = slider(page), figure(page)
        eventually(page, lambda: r2["title"] in text_of(fig), "the reel opens on stop 2")
        record(announcer(page), "ann")
        current = reel_of(app_url, reel_id)
        assert reorder(app_url, reel_id, current["version"], [r2["id"], r1["id"], gone["id"], r3["id"]]).status_code == 200
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        eventually(page, lambda: slider_value(fader) == 0 and stop_param(page) == "1",
                   "the refetch moves the value and address with the reference", step_ms=1000)
        assert r2["title"] in text_of(fig) and spoken(page, "ann") == [], "no swap and no announcement"
        assert call("DELETE", app_url, f"/api/references/{r2['id']}").status_code == 200
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        want = announce(1, 2, r1["title"], r1["maker"], r1["year"])
        eventually(page, lambda: text_of(announcer(page)) == want and r1["title"] in text_of(fig),
                   "a trashed current stop moves to the next playable stop", step_ms=1000)
        advance(page, SWAP_MS * 2)
        assert spoken(page, "ann") == [want], "exactly one announced swap"


def test_wf_playback_stop_in_url(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    reel_id = data["reel"]["id"]
    with open_reel(browser, app_url, reel_id, "?stop=3") as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        eventually(page, lambda: slider_value(fader) == 2 and refs[2]["title"] in text_of(figure(page)), "stop 3 opens directly")
        assert text_of(announcer(page)) == ""
        depth = page.evaluate("history.length")
        fader.focus()
        page.keyboard.press("Home")
        eventually(page, lambda: stop_param(page) == "1", "the address follows the stop")
        assert page.evaluate("history.length") == depth, "no history entry is added"
    for bad in ("abc", "0", "99"):
        with open_reel(browser, app_url, reel_id, f"?stop={bad}") as page:
            fader = slider(page)
            expect(fader).to_be_visible()
            eventually(page, lambda: slider_value(fader) == 0 and stop_param(page) == "1", f"stop={bad} opens stop 1")


def test_wf_playback_detent_values_and_announcer(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    with open_reel(browser, app_url, data["reel"]["id"], reduced_motion="reduce") as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        tab_until(page, fader)
        visible_focus(fader)
        for k in (2, 3):
            page.keyboard.press("ArrowRight")
            expect(announcer(page)).to_have_text(spoken_for(refs, k))
            assert slider_text(fader) == spoken_for(refs, k)
        for k in (2, 1):
            page.keyboard.press("ArrowLeft")
            expect(announcer(page)).to_have_text(spoken_for(refs, k))
        page.keyboard.press("Tab")
        assert not focused(fader), "Tab moves on from the fader"
        page.keyboard.press("Shift+Tab")
        assert focused(fader), "Shift+Tab comes back: no focus trap"


def test_wf_playback_reduced_motion_instant(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    with open_reel(browser, app_url, data["reel"]["id"], viewport=PHONE, reduced_motion="reduce") as page:
        fader, fig = slider(page), figure(page)
        eventually(page, lambda: refs[0]["title"] in text_of(fig), "the reel opens on stop 1")
        fader.focus()
        page.keyboard.press("]")
        advance(page, 50)
        assert refs[1]["title"] in text_of(fig) and has_fill(fig, refs[1]["swatch"]), "the swap is instant"
        expect(announcer(page)).to_have_text(spoken_for(refs, 2))
        page.keyboard.press("Home")
        advance(page, 50)
        detent = detent_label(fader, 2)
        assert detent, "detent number 2 is visible"
        page.touchscreen.tap(detent["x"], detent["y"])
        eventually(page, lambda: slider_value(fader) == 1, "a tap on detent 2 jumps to it")


def test_touch_targets_reduced_motion(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    with open_reel(browser, app_url, data["reel"]["id"], viewport=PHONE, reduced_motion="reduce") as page:
        fader = slider(page)
        expect(fader).to_be_visible()
        for target in (fader, button(page, f"Move {refs[1]['title']} up"), button(page, f"Remove {refs[1]['title']} from reel")):
            b = box(target)
            assert b["width"] >= MIN_TARGET_PX and b["height"] >= MIN_TARGET_PX
        detent = detent_label(fader, 2)
        assert detent, "detent number 2 is visible"
        page.touchscreen.tap(detent["x"], detent["y"])
        eventually(page, lambda: slider_value(fader) == 1, "a tap on detent 2 jumps to it")
        advance(page, 50)
        assert refs[1]["title"] in text_of(figure(page)), "the swap is instant under reduced motion"
    with screen(browser, app_url + "/capture", viewport=PHONE, reduced_motion="reduce") as page:
        for target in (button(page, "Save to deck"), button(page, "Pick swatch")):
            b = box(target)
            assert b["width"] >= MIN_TARGET_PX and b["height"] >= MIN_TARGET_PX


def test_reel_stops_api(app_url: str) -> None:
    for bad in ("", "n" * (REEL_NAME_MAX + 1)):
        r = post_json(app_url, "/api/reels", {"name": bad})
        assert r.status_code == 422 and fields_of(r).get("name") == "Give the reel a name of 1 to 60 characters."
    reel = new_reel(app_url)
    assert reel["version"] == 1 and reel["stops"] == [] and reel["demo"] is False
    r1, r2, r3, r4 = (new_reference(app_url) for _ in range(4))
    first = append(app_url, reel["id"], r1["id"])
    assert first.status_code == 200 and first.json()["version"] == 2 and stop_ids(first.json()) == [r1["id"]]
    assert append(app_url, reel["id"], r2["id"]).json()["version"] == 3
    dup = append(app_url, reel["id"], r1["id"])
    assert dup.status_code == 409 and code_of(dup) == "already_in_reel"
    unknown = append(app_url, reel["id"], "no-such-reference")
    assert unknown.status_code == 422 and fields_of(unknown).get("reference_id") == "Use a reference that is in your library."
    call("DELETE", app_url, f"/api/references/{r3['id']}")
    trashed = append(app_url, reel["id"], r3["id"])
    assert trashed.status_code == 409 and code_of(trashed) == "reference_trashed"
    assert reel_of(app_url, reel["id"])["version"] == 3, "refused appends change nothing"
    moved = reorder(app_url, reel["id"], 3, [r2["id"], r1["id"]])
    assert moved.status_code == 200 and moved.json()["version"] == 4 and stop_ids(moved.json()) == [r2["id"], r1["id"]]
    for version, ids, field, copy in (
        ("x", [r1["id"]], "version", "Send the reel's current version number."),
        (0, [r1["id"]], "version", "Send the reel's current version number."),
        (4, [r1["id"], r1["id"]], "reference_ids", "Use each reference once, and only references in your library."),
        (4, [f"id{i}" for i in range(REEL_MAX + 1)], "reference_ids", "Use each reference once, and only references in your library."),
    ):
        r = reorder(app_url, reel["id"], version, ids)
        assert r.status_code == 422 and fields_of(r).get(field) == copy
    stale = reorder(app_url, reel["id"], 3, [r1["id"]])
    assert stale.status_code == 409 and code_of(stale) == "reel_version_conflict"
    removed = reorder(app_url, reel["id"], 4, [r1["id"]])
    assert stop_ids(removed.json()) == [r1["id"]]
    append(app_url, reel["id"], r4["id"])
    call("DELETE", app_url, f"/api/references/{r4['id']}")
    after = reel_of(app_url, reel["id"])
    assert stop_ids(after) == [r1["id"], r4["id"]] and after["stops"][1]["reference"]["state"] == "trashed"
    entry = next(x for x in jget(app_url, "/api/reels")["reels"] if x["id"] == reel["id"])
    assert entry["stop_count"] == 2 and entry["playable_count"] == 1


def race(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    gate = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        gate.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


@pytest.mark.timeout(900)
def test_wf_reel_editing_append_cap_across_copies(browser: Browser, app_url: str) -> None:
    twin = outage("APP_TWIN_URL")
    with ThreadPoolExecutor(8) as pool:
        refs = list(pool.map(lambda i: new_reference(app_url, photo=small_png(colour_for(i))), range(REEL_MAX + 3)))
    full = new_reel(app_url)
    for ref in refs[:REEL_MAX - 1]:
        assert append(app_url, full["id"], ref["id"]).status_code == 200
    before = reel_of(app_url, full["id"])["version"]
    racers = refs[REEL_MAX - 1:]
    answers = race([lambda r=r, b=(app_url if i % 2 else twin): append(b, full["id"], r["id"]) for i, r in enumerate(racers)])
    assert sorted(a.status_code for a in answers) == [200, 409, 409, 409]
    assert all(code_of(a) == "reel_full" for a in answers if a.status_code == 409)
    after = reel_of(app_url, full["id"])
    assert len(after["stops"]) == REEL_MAX and after["version"] == before + 1
    small = new_reel(app_url)
    same = race([lambda b=(app_url if i % 2 else twin): append(b, small["id"], refs[0]["id"]) for i in range(4)])
    assert sorted(a.status_code for a in same) == [200, 409, 409, 409]
    assert all(code_of(a) == "already_in_reel" for a in same if a.status_code == 409)
    append(app_url, small["id"], refs[1]["id"])
    v = reel_of(app_url, small["id"])["version"]
    orders = [[refs[1]["id"], refs[0]["id"]], [refs[0]["id"]]]
    cas = race([lambda: reorder(app_url, small["id"], v, orders[0]), lambda: reorder(twin, small["id"], v, orders[1])])
    assert sorted(a.status_code for a in cas) == [200, 409]
    win = orders[[a.status_code for a in cas].index(200)]
    assert code_of(next(a for a in cas if a.status_code == 409)) == "reel_version_conflict"
    assert stop_ids(reel_of(app_url, small["id"])) == win and reel_of(app_url, small["id"])["version"] == v + 1
    loser = next(r for r, a in zip(racers, answers) if a.status_code == 409)
    with screen(browser, f"{app_url}/references/{loser['id']}") as page:
        click(button(page, "Add to reel"))
        dialog = page.get_by_role("dialog", name="Add to reel")
        check(dialog.get_by_role("radiogroup", name="Reel").get_by_role("radio", name=full["name"]))
        click(dialog.get_by_role("button", name="Add", exact=True))
        expect(deck_status(page)).to_have_text("A reel holds at most 60 stops.", timeout=EVENTUAL_S * 1000)
    assert len(reel_of(app_url, full["id"])["stops"]) == REEL_MAX


def stop_titles(page: Page) -> list[str]:
    return [text_of(item) for item in page.get_by_role("list", name="Stops").get_by_role("listitem").all()]


def order_of(page: Page, refs: list[dict[str, Any]]) -> list[int]:
    out = []
    for row in stop_titles(page):
        out += [i for i, r in enumerate(refs) if r["title"] in row]
    return out


def test_wf_reel_editing_chained_quick_moves(browser: Browser, app_url: str) -> None:
    refs = [new_reference(app_url) for _ in range(4)]
    reel = reel_with(app_url, refs)
    v0 = reel["version"]
    with open_reel(browser, app_url, reel["id"], reduced_motion="reduce") as page:
        expect(page.get_by_role("list", name="Stops")).to_be_visible()
        bodies: list[Any] = []
        page.on("request", lambda r: bodies.append(r.post_data_json) if r.method == "PUT" and r.url.endswith("/stops") else None)
        record(deck_status(page), "deck")
        button(page, f"Move {refs[3]['title']} up").focus()
        for _ in range(3):
            page.keyboard.press("Enter")
        assert order_of(page, refs) == [3, 0, 1, 2], "the moved stop shows in its new place at once"
        expect(deck_status(page)).to_have_text(f"Moved {refs[3]['title']} to stop 1.", timeout=EVENTUAL_S * 1000)
        expect(button(page, f"Move {refs[3]['title']} down")).to_be_focused()
        assert [b["version"] for b in bodies] == [v0, v0 + 1, v0 + 2]
        assert not any("changed in another window" in t for t in recorded(page, "deck"))
    after = reel_of(app_url, reel["id"])
    assert stop_ids(after)[0] == refs[3]["id"] and after["version"] == v0 + 3


def test_wf_reel_editing_optimistic_rollback(browser: Browser, app_url: str) -> None:
    refs = [new_reference(app_url) for _ in range(4)]
    reel = reel_with(app_url, refs)
    with open_reel(browser, app_url, reel["id"], reduced_motion="reduce") as page:
        expect(page.get_by_role("list", name="Stops")).to_be_visible()
        server = [refs[1]["id"], refs[0]["id"], refs[2]["id"], refs[3]["id"]]
        assert reorder(app_url, reel["id"], reel["version"], server).status_code == 200
        move = button(page, f"Move {refs[2]['title']} up")
        click(move)
        expect(deck_status(page)).to_have_text("This reel changed in another window. Reloaded the latest order.",
                                               timeout=EVENTUAL_S * 1000)
        eventually(page, lambda: order_of(page, refs) == [1, 0, 2, 3], "the list shows the server's order")
        expect(move).to_be_focused()
        page.route("**/api/reels/*/stops", lambda route: route.abort() if route.request.method == "PUT" else route.continue_())
        click(move)
        expect(deck_status(page)).to_have_text("Something went wrong. Try again.", timeout=EVENTUAL_S * 1000)
        eventually(page, lambda: order_of(page, refs) == [1, 0, 2, 3], "the list returns to the last accepted order")
    assert stop_ids(reel_of(app_url, reel["id"])) == server


def test_wf_reel_editing_keyboard_reorder(browser: Browser, app_url: str) -> None:
    refs = [new_reference(app_url) for _ in range(3)]
    reel = reel_with(app_url, refs)
    with open_reel(browser, app_url, reel["id"], reduced_motion="reduce") as page:
        down = button(page, f"Move {refs[0]['title']} down")
        down.focus()
        page.keyboard.press("Enter")
        expect(deck_status(page)).to_have_text(f"Moved {refs[0]['title']} to stop 2.", timeout=EVENTUAL_S * 1000)
        expect(down).to_be_focused()
        page.keyboard.press("Enter")
        expect(deck_status(page)).to_have_text(f"Moved {refs[0]['title']} to stop 3.", timeout=EVENTUAL_S * 1000)
        expect(button(page, f"Move {refs[0]['title']} up")).to_be_focused()
        page.reload()
        expect(page.get_by_role("list", name="Stops")).to_be_visible()
        assert order_of(page, refs) == [1, 2, 0], "the new order persists after a reload"
        remove = button(page, f"Remove {refs[1]['title']} from reel")
        remove.focus()
        page.keyboard.press("Enter")
        expect(deck_status(page)).to_have_text(f"Removed {refs[1]['title']} from the reel.", timeout=EVENTUAL_S * 1000)
        expect(button(page, f"Remove {refs[2]['title']} from reel")).to_be_focused()
    assert stop_ids(reel_of(app_url, reel["id"])) == [refs[2]["id"], refs[0]["id"]]


SHEET_STOP_KEYS = {"position", "reference_id", "title", "maker", "year", "size_text", "swatch"}


def test_sheet_states_and_snapshot(app_url: str) -> None:
    r1, r2, r3 = (new_reference(app_url, photo=small_png(colour_for(i))) for i in range(3))
    empty = new_reel(app_url)
    nothing = post_json(app_url, f"/api/reels/{empty['id']}/sheets", {"paper": "a4", "unit": "mm"}, key=idempotency_key())
    assert nothing.status_code == 409 and code_of(nothing) == "reel_empty"
    reel = reel_with(app_url, [r1, r2, r3])
    call("DELETE", app_url, f"/api/references/{r2['id']}")
    bad = post_json(app_url, f"/api/reels/{reel['id']}/sheets", {"paper": "a5", "unit": "mm"}, key=idempotency_key())
    assert bad.status_code == 422 and fields_of(bad).get("paper") == "Choose A4 or US Letter."
    made = post_json(app_url, f"/api/reels/{reel['id']}/sheets", {"paper": "a4", "unit": "mm"}, key=idempotency_key())
    assert made.status_code == 202
    sheet = made.json()
    assert sheet["state"] == "queued" and sheet["pdf_url"] is None
    assert [s["reference_id"] for s in sheet["stops"]] == [r1["id"], r3["id"]] and [s["position"] for s in sheet["stops"]] == [1, 2]
    for stop, ref in zip(sheet["stops"], (r1, r3)):
        assert set(stop) == SHEET_STOP_KEYS
        assert stop["size_text"] == ref["size_text"]["mm"] and stop["swatch"] == ref["swatch"]
    early = call("POST", app_url, f"/api/sheets/{sheet['id']}/retry")
    assert early.status_code == 409 and code_of(early) == "sheet_not_failed"
    call("PATCH", app_url, f"/api/references/{r1['id']}", {"version": 1, "title": r1["title"] + " later"})
    reorder(app_url, reel["id"], reel_of(app_url, reel["id"])["version"], [r3["id"], r1["id"]])
    ready, seen = wait_sheet(app_url, sheet["id"])
    order = ["queued", "rendering", "ready"]
    assert [order.index(s) for s in seen] == sorted(order.index(s) for s in seen), f"states move forward: {seen}"
    assert [s["title"] for s in ready["stops"]] == [r1["title"], r3["title"]], "later edits never change the sheet"
    pdf = get(app_url, f"/api/sheets/{sheet['id']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")
    stored = S3().get(f"sheets/{sheet['id']}.pdf")
    assert pdf.content == stored and ready["pdf_bytes"] == len(stored) and ready["pdf_sha256"] == sha(stored)
    late = call("POST", app_url, f"/api/sheets/{sheet['id']}/retry")
    assert late.status_code == 409 and code_of(late) == "sheet_not_failed"
    second = post_json(app_url, f"/api/reels/{reel['id']}/sheets", {"paper": "letter", "unit": "in"}, key=idempotency_key())
    assert jget(app_url, f"/api/reels/{reel['id']}/sheets")["sheets"][0]["id"] == second.json()["id"]


def request_sheet_in_ui(page: Page, paper: str, unit: str) -> None:
    click(button(page, "Print contact sheet"))
    dialog = page.get_by_role("dialog", name="Print contact sheet")
    check(dialog.get_by_role("radiogroup", name="Paper").get_by_role("radio", name=paper, exact=True))
    check(dialog.get_by_role("radiogroup", name="Sheet unit").get_by_role("radio", name=unit, exact=True))
    click(dialog.get_by_role("button", name="Request sheet"))
    expect(deck_status(page)).to_have_text("Contact sheet queued.", timeout=EVENTUAL_S * 1000)


def test_wf_contact_sheets_page_count_and_footer(browser: Browser, app_url: str) -> None:
    t = token()
    refs = [new_reference(app_url, title=f"{t}{chr(97 + i)}", photo=small_png(colour_for(i))) for i in range(7)]
    name = f"{token()} reel"
    reel = reel_with(app_url, refs, name=name)
    with open_reel(browser, app_url, reel["id"]) as page:
        request_sheet_in_ui(page, "A4", "mm")
    sheet_id = jget(app_url, f"/api/reels/{reel['id']}/sheets")["sheets"][0]["id"]
    wait_sheet(app_url, sheet_id)
    pdf = get(app_url, f"/api/sheets/{sheet_id}/pdf").content
    assert pdf_pages(pdf) == 2
    width, height = page_size_pt(pdf)
    assert abs(width - A4_MM[0] * PT_PER_MM) <= PT_TOL and abs(height - A4_MM[1] * PT_PER_MM) <= PT_TOL
    text = flat(pdf_text(pdf))
    assert name in text and "7 references" in text
    for k, ref in enumerate(refs, start=1):
        for line in (f"{k}. {ref['title']}", "Braunfeld, 1971", ref["size_text"]["mm"], f"Swatch {ref['swatch']}"):
            assert line in text, f"the sheet shows {line!r}"
    for p in (1, 2):
        assert f"Stowdeck · {name} · Page {p} of 2" in text
    assert len(re.findall(rb"/Subtype\s*/Image", pdf)) >= len(refs), "each stop's photo is embedded"
    letter = post_json(app_url, f"/api/reels/{reel['id']}/sheets", {"paper": "letter", "unit": "in"}, key=idempotency_key())
    wait_sheet(app_url, letter.json()["id"])
    lpdf = get(app_url, f"/api/sheets/{letter.json()['id']}/pdf").content
    lw, lh = page_size_pt(lpdf)
    assert abs(lw - LETTER_IN[0] * 72) <= PT_TOL and abs(lh - LETTER_IN[1] * 72) <= PT_TOL
    assert refs[0]["size_text"]["in"] in flat(pdf_text(lpdf))


def test_wf_contact_sheets_no_private_fields(browser: Browser, app_url: str) -> None:
    secrets = [token() for _ in range(4)]
    refs = [new_reference(app_url, photo=sideways_jpeg(secrets[3]), filename="IMG.jpg", content_type="image/jpeg",
                          notes=f"{secrets[0]} parting line", source_url=f"https://{secrets[1]}.example/link",
                          source_note=f"{secrets[2]} market") for _ in range(2)]
    reel = reel_with(app_url, refs)
    with open_reel(browser, app_url, reel["id"]) as page:
        request_sheet_in_ui(page, "A4", "mm")
    sheet_id = jget(app_url, f"/api/reels/{reel['id']}/sheets")["sheets"][0]["id"]
    sheet, _ = wait_sheet(app_url, sheet_id)
    snapshot = json.dumps(sheet)
    pdf = get(app_url, f"/api/sheets/{sheet_id}/pdf").content
    text = pdf_text(pdf)
    for secret in secrets:
        assert secret not in snapshot and secret not in text and secret.encode() not in pdf
    for stop in sheet["stops"]:
        assert set(stop) == SHEET_STOP_KEYS
    for ref in refs:
        crop = get(app_url, f"/api/references/{ref['id']}/display").content
        markers = jpeg_markers(crop)
        assert not {0xE1, 0xE2, 0xFE} & set(markers), f"the display crop carries no EXIF, XMP, profile or comment: {markers}"
        assert secrets[3].encode() not in crop


def test_wf_contact_sheets_ready_after_readback(browser: Browser, app_url: str) -> None:
    refs = [new_reference(app_url, photo=small_png(colour_for(i))) for i in range(2)]
    reel = reel_with(app_url, refs)
    with open_reel(browser, app_url, reel["id"]) as page:
        request_sheet_in_ui(page, "US Letter", "in")
        item = page.get_by_role("list", name="Contact sheets").get_by_role("listitem").first
        words: list[str] = []

        def ready() -> bool:
            current = text_of(item)
            for word in ("Queued", "Rendering", "Ready"):
                if word in current and (not words or words[-1] != word):
                    words.append(word)
            return "Ready" in current and item.get_by_role("link", name="Download PDF").count() > 0

        eventually(page, ready, "the sheet row reaches Ready with Download PDF", seconds=SHEET_START_S + SHEET_READY_S + SLACK_S,
                   step_ms=1000)
        assert words[0] in ("Queued", "Rendering"), f"the row showed progress before Ready: {words}"
        expect(deck_status(page)).to_have_text("Contact sheet ready.")
        href = item.get_by_role("link", name="Download PDF").get_attribute("href")
        assert href, "Download PDF has an address"
        downloaded = page.request.get(urljoin(page.url, href)).body()
    sheet = jget(app_url, f"/api/reels/{reel['id']}/sheets")["sheets"][0]
    stored = S3().get(f"sheets/{sheet['id']}.pdf")
    assert sheet["paper"] == "letter" and sheet["unit"] == "in"
    assert downloaded == stored and sheet["pdf_sha256"] == sha(stored) and sheet["pdf_bytes"] == len(stored)
    assert refs[0]["size_text"]["in"] in flat(pdf_text(stored))


def test_trash_restore_transitions(app_url: str) -> None:
    ref = new_reference(app_url)
    trashed = call("DELETE", app_url, f"/api/references/{ref['id']}")
    body = trashed.json()
    assert trashed.status_code == 200 and body["state"] == "trashed" and body["version"] == 2
    assert body["trashed_at"].endswith("Z") and body["purge_at"].endswith("Z")
    again = call("DELETE", app_url, f"/api/references/{ref['id']}")
    assert again.status_code == 409 and code_of(again) == "already_trashed"
    for method, path, payload in (("PATCH", "", {"version": 2, "finish": "Matte"}), ("POST", "/swatch", {"x": 0.5, "y": 0.5}),
                                  ("DELETE", "/swatch", None)):
        r = call(method, app_url, f"/api/references/{ref['id']}{path}", payload)
        assert r.status_code == 409 and code_of(r) == "reference_trashed", f"{method} {path}"
    stale = call("PATCH", app_url, f"/api/references/{ref['id']}", {"version": 1, "finish": "Matte"})
    assert code_of(stale) == "reference_trashed", "reference_trashed comes before the version conflict"
    assert ref["title"] not in library_titles(app_url)
    assert ref["id"] not in [r["id"] for r in jget(app_url, "/api/search", q=ref["title"].split()[0])["results"]]
    item = next(i for i in jget(app_url, "/api/trash")["items"] if i["id"] == ref["id"])
    assert 0 <= item["seconds_left"] <= DEFAULT_RETENTION_S
    back = call("POST", app_url, f"/api/references/{ref['id']}/restore")
    assert back.status_code == 200 and back.json()["state"] == "stored" and back.json()["version"] == 3
    twice = call("POST", app_url, f"/api/references/{ref['id']}/restore")
    assert twice.status_code == 409 and code_of(twice) == "not_trashed"


def test_wf_trash_exact_restore(browser: Browser, app_url: str, meilisearch: Any) -> None:
    note = token()
    ref = new_reference(app_url, photo=framed(), notes=f"{note} texture")
    picked = call("POST", app_url, f"/api/references/{ref['id']}/swatch", {"x": 1, "y": 0}).json()
    other = new_reference(app_url)
    reel_a, reel_b = reel_with(app_url, [other, ref]), reel_with(app_url, [ref])
    doc_before = meilisearch.document(MAIN_INDEX, ref["id"])
    call("DELETE", app_url, f"/api/references/{ref['id']}")
    with screen(browser, app_url + "/trash") as page:
        click(button(page, f"Restore {ref['title']}"))
        expect(deck_status(page)).to_have_text(f"Restored {ref['title']}.", timeout=EVENTUAL_S * 1000)
    after = jget(app_url, f"/api/references/{ref['id']}")
    for key in ("id", "captured_at", "title", "maker", "year", "materials", "finish", "colour_family", "notes",
                "size_tenths_mm", "photo"):
        assert after[key] == picked[key], f"restore keeps {key}"
    assert after["swatch"] == picked["swatch"] and after["swatch_source"] == "eyedropper"
    assert after["state"] == "stored" and after["trashed_at"] is None and after["version"] == picked["version"] + 2
    assert stop_ids(reel_of(app_url, reel_a["id"])) == [other["id"], ref["id"]]
    assert stop_ids(reel_of(app_url, reel_b["id"])) == [ref["id"]]
    assert meilisearch.document(MAIN_INDEX, ref["id"]) == doc_before
    assert ref["id"] in [r["id"] for r in jget(app_url, "/api/search", q=note)["results"]]


@pytest.mark.timeout(300)
def test_wf_trash_inclusive_restore_edge(browser: Browser, meilisearch: Any) -> None:
    short = outage("APP_SHORT_TRASH_URL")
    s3 = S3("-shorttrash")
    keep, lose = new_reference(short), new_reference(short)
    reel = reel_with(short, [keep, lose])
    trashed = call("DELETE", short, f"/api/references/{lose['id']}").json()
    call("DELETE", short, f"/api/references/{keep['id']}")
    retention = (datetime.fromisoformat(trashed["purge_at"].replace("Z", "+00:00"))
                 - datetime.fromisoformat(trashed["trashed_at"].replace("Z", "+00:00"))).total_seconds()
    assert call("POST", short, f"/api/references/{keep['id']}/restore").status_code == 200
    version_before = reel_of(short, reel["id"])["version"]
    with screen(browser, short + "/trash") as page:
        row = page.get_by_role("list", name="Trashed references").get_by_role("listitem").filter(has_text=lose["title"])
        expect(row).to_contain_text(re.compile(r"Restorable for \d+m \d+s"))
        poll(lambda: get(short, f"/api/references/{lose['id']}").status_code, lambda s: s == 404,
             retention + PURGE_SWEEP_S + SLACK_S, "the server purged the reference within 5 s of purge_at")
        click(button(page, f"Restore {lose['title']}"))
        expect(deck_status(page)).to_have_text(
            "The restore window for this reference has closed. It has been purged from your library.", timeout=EVENTUAL_S * 1000)
    late = call("POST", short, f"/api/references/{lose['id']}/restore")
    assert late.status_code == 410 and code_of(late) == "restore_window_closed"
    assert s3.keys(f"references/{lose['id']}/") == []
    assert all(meilisearch.document(uid, lose["id"]) is None for uid in meilisearch.indexes())
    after = reel_of(short, reel["id"])
    assert stop_ids(after) == [keep["id"]] and after["version"] == version_before + 1
    assert lose["title"] not in library_titles(short)


def test_wf_trash_countdown_server_clock(browser: Browser) -> None:
    mid = outage("APP_CLOCK_MIDNIGHT_URL")
    ref = new_reference(mid)
    call("DELETE", mid, f"/api/references/{ref['id']}")
    left = next(i for i in jget(mid, "/api/trash")["items"] if i["id"] == ref["id"])["seconds_left"]
    try:
        skew = datetime(2031, 6, 1, 15, 0, tzinfo=timezone.utc)
        with skewed_page(browser, mid + "/trash", "America/Los_Angeles", skew, paused=True) as page:
            row = page.get_by_role("list", name="Trashed references").get_by_role("listitem").filter(has_text=ref["title"])
            expect(row).to_contain_text(f"Restorable for {countdown(left)}")
            page.clock.run_for(1000)
            expect(row).to_contain_text(f"Restorable for {countdown(left - 1)}")
    finally:
        call("POST", mid, f"/api/references/{ref['id']}/restore")


def test_wf_trash_keyboard_journey(browser: Browser, app_url: str) -> None:
    ref = new_reference(app_url)
    with screen(browser, f"{app_url}/references/{ref['id']}") as page:
        opener = button(page, "Move to trash")
        tab_until(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Move to trash?")
        expect(dialog).to_contain_text(f"{ref['title']} will be purged 30 days after it is trashed unless you restore it.")
        expect(dialog.get_by_role("button", name="Keep it")).to_be_focused()
        for _ in range(4):
            page.keyboard.press("Tab")
            assert inside(dialog), "Tab stays inside the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        confirm = dialog.get_by_role("button", name="Move to trash")
        tab_until(page, confirm, presses=6)
        page.keyboard.press("Enter")
        expect(deck_status(page)).to_have_text(f"Moved {ref['title']} to the trash.", timeout=EVENTUAL_S * 1000)
        trash_link = page.get_by_role("navigation", name="Deck").get_by_role("link", name="Trash")
        tab_until(page, trash_link)
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="Trash")).to_be_visible()
        row = page.get_by_role("list", name="Trashed references").get_by_role("listitem").filter(has_text=ref["title"])
        expect(row).to_contain_text(re.compile(r"Restorable for \d+d \d+h"))
        restore = button(page, f"Restore {ref['title']}")
        tab_until(page, restore)
        page.keyboard.press("Enter")
        expect(deck_status(page)).to_have_text(f"Restored {ref['title']}.", timeout=EVENTUAL_S * 1000)
        name = page.evaluate("() => document.activeElement.textContent || document.activeElement.getAttribute('aria-label') || ''")
        assert name.startswith("Restore") or "Trash" in name, "focus moves to the next Restore button or the Trash heading"
    assert jget(app_url, f"/api/references/{ref['id']}")["state"] == "stored"


def test_wf_daily_pull_single_pick_across_copies(browser: Browser) -> None:
    rollover, twin = outage("APP_CLOCK_ROLLOVER_URL"), outage("APP_CLOCK_ROLLOVER_TWIN_URL")
    answers = race([lambda b=(rollover if i % 2 else twin): get(b, "/api/daily-pull") for i in range(6)])
    bodies = [a.json() for a in answers]
    assert {b["pull_day"] for b in bodies} == {"2026-11-03"} and {b["state"] for b in bodies} == {"picked"}
    assert {b["reference"]["id"] for b in bodies} == {bodies[0]["reference"]["id"]}
    assert bodies[0]["reference"]["title"] == "Table fan"
    with screen(browser, twin + "/library") as page:
        card = page.get_by_role("region", name="Daily Pull")
        expect(card.get_by_role("link", name="Table fan")).to_be_visible()


def test_daily_pull_trashed_pick_stays_removed(browser: Browser) -> None:
    mid = outage("APP_CLOCK_MIDNIGHT_URL")
    pull = jget(mid, "/api/daily-pull")
    assert pull["state"] == "picked"
    pick = pull["reference"]
    call("DELETE", mid, f"/api/references/{pick['id']}")
    try:
        for _ in range(2):
            gone = jget(mid, "/api/daily-pull")
            assert gone["state"] == "removed" and gone["reference"] is None and gone["pull_day"] == pull["pull_day"]
        with screen(browser, mid + "/library") as page:
            expect(page.get_by_role("region", name="Daily Pull")).to_contain_text(
                "Today's pull has left your library. A new one arrives at 06:00.")
    finally:
        call("POST", mid, f"/api/references/{pick['id']}/restore")
    back = jget(mid, "/api/daily-pull")
    assert back["state"] == "picked" and back["reference"]["id"] == pick["id"]


def test_wf_daily_pull_dawn_rollover(browser: Browser) -> None:
    dawn, rollover = outage("APP_CLOCK_DAWN_URL"), outage("APP_CLOCK_ROLLOVER_URL")
    before = jget(dawn, "/api/daily-pull")
    assert before["pull_day"] == "2026-11-02" and before["reference"]["title"] == "Enamel kettle"
    assert before["next_pull_at"] == "2026-11-03T06:00:00Z" and before["zone"] == "Europe/London"
    after = jget(rollover, "/api/daily-pull")
    assert after["pull_day"] == "2026-11-03" and after["reference"]["title"] == "Table fan"
    skew = datetime(2026, 11, 4, 20, 0, tzinfo=timezone.utc)
    with skewed_page(browser, dawn + "/library", "America/Los_Angeles", skew) as page:
        card = page.get_by_role("region", name="Daily Pull")
        expect(card).to_contain_text("Pulled for 2 November 2026")
        expect(card).to_contain_text("Next pull at 06:00, Europe/London")
        expect(card.get_by_role("link", name="Enamel kettle")).to_be_visible()


def test_wf_daily_pull_dst_next_pull(browser: Browser) -> None:
    dst = outage("APP_CLOCK_DST_URL")
    pull = jget(dst, "/api/daily-pull")
    assert pull["pull_day"] == "2027-10-30" and pull["reference"]["title"] == "Table fan"
    assert pull["next_pull_at"] == "2027-10-31T06:00:00Z" and pull["today_starts_at"] == "2027-10-30T23:00:00Z"
    assert jget(dst, "/api/references")["today_starts_at"] == "2027-10-30T23:00:00Z"
    skew = datetime(2027, 11, 2, 3, 0, tzinfo=timezone.utc)
    with skewed_page(browser, dst + "/library", "America/Los_Angeles", skew) as page:
        expect(page.get_by_role("region", name="Daily Pull")).to_contain_text("Pulled for 30 October 2027")


def test_wf_daily_pull_verbatim_date_any_locale(browser: Browser) -> None:
    rollover = outage("APP_CLOCK_ROLLOVER_URL")
    pull = jget(rollover, "/api/daily-pull")
    skew = datetime(2026, 11, 2, 14, 0, tzinfo=timezone.utc)
    with skewed_page(browser, rollover + "/library", "America/Los_Angeles", skew) as page:
        card = page.get_by_role("region", name="Daily Pull")
        expect(card.get_by_role("heading", name="Daily Pull")).to_be_visible()
        expect(card).to_contain_text(f"Pulled for {written_date(pull['pull_day'])}")
        expect(card).to_contain_text("Next pull at 06:00, Europe/London")
        picked = pull["reference"]
        expect(card).to_contain_text(f"{picked['title']}, {picked['maker']} {picked['year']}")
        card.get_by_role("link", name="Table fan").click()
        expect(page.get_by_role("heading", name="Table fan")).to_be_visible()
        expect(page.get_by_text("Vellum Appliance Co.").first).to_be_visible()


def test_wf_home_zone_pending_at_old_midnight(browser: Browser) -> None:
    mid = outage("APP_CLOCK_MIDNIGHT_URL")
    try:
        with screen(browser, mid + "/settings") as page:
            select(page.get_by_role("combobox", name="Home time zone"), "Asia/Tokyo")
            click(button(page, "Save home zone"))
            notice = f"Your home zone changes to Asia/Tokyo at midnight on {written_date('2026-11-04')} in Europe/London."
            expect(page.get_by_text(notice).first).to_be_visible(timeout=EVENTUAL_S * 1000)
        settings = jget(mid, "/api/settings")
        assert settings["home_zone"] == "Europe/London"
        assert settings["pending_zone"]["zone"] == "Asia/Tokyo"
        assert settings["pending_zone"]["effective_from"] == "2026-11-04T00:00:00Z"
        assert settings["pending_zone"]["effective_date"] == "2026-11-04"
        listing = jget(mid, "/api/references")
        assert listing["zone"] == "Europe/London" and "Bead-blasted kettle" in [r["title"] for r in listing["saved_today"]]
        assert jget(mid, "/api/daily-pull")["zone"] == "Europe/London"
    finally:
        call("PUT", mid, "/api/settings/home-zone", {"zone": "Europe/London"})
    assert jget(mid, "/api/settings")["pending_zone"] is None


ACCEPTED_ZONES = ["America/Argentina/Buenos_Aires", "America/Indiana/Indianapolis", "Asia/Kolkata", "Europe/Kyiv"]
REJECTED_ZONES = ["Asia/Calcutta", "Europe/Kiev", "America/Buenos_Aires", "US/Pacific", "UTC", "GMT", "Etc/" + "GMT", "PST",
                  "Mars/Olympus"]


def zone_options(page: Page) -> list[str]:
    combo = page.get_by_role("combobox", name="Home time zone")
    native = combo.evaluate("e => e.tagName === 'SELECT' ? [...e.options].map(o => o.textContent.trim()) : null")
    if native is not None:
        return native
    click(combo)
    return [text_of(o) for o in page.get_by_role("option").all()]


def test_wf_home_zone_zone_tab_list_only(browser: Browser) -> None:
    dst = outage("APP_CLOCK_DST_URL")
    try:
        for zone in ACCEPTED_ZONES:
            r = call("PUT", dst, "/api/settings/home-zone", {"zone": zone})
            assert r.status_code == 200 and r.json()["pending_zone"]["zone"] == zone, zone
            call("PUT", dst, "/api/settings/home-zone", {"zone": "Europe/London"})
        for zone in REJECTED_ZONES:
            r = call("PUT", dst, "/api/settings/home-zone", {"zone": zone})
            assert r.status_code == 422 and fields_of(r).get("zone") == "Choose a time zone from the list.", zone
        assert jget(dst, "/api/settings")["pending_zone"] is None
        with screen(browser, dst + "/settings") as page:
            expect(page.get_by_role("combobox", name="Home time zone")).to_be_visible()
            options = zone_options(page)
            assert all(z in options for z in ACCEPTED_ZONES + ["Europe/London", "Asia/Tokyo"])
            assert not any(z in options for z in REJECTED_ZONES)
            assert options == sorted(options), "zones are listed in code-point order"
    finally:
        call("PUT", dst, "/api/settings/home-zone", {"zone": "Europe/London"})


def test_wf_home_zone_dst_effective_from(browser: Browser) -> None:
    dst = outage("APP_CLOCK_DST_URL")
    try:
        with screen(browser, dst + "/settings") as page:
            zone = page.get_by_role("combobox", name="Home time zone")
            select(zone, "Asia/Tokyo")
            click(button(page, "Save home zone"))
            expect(page.get_by_text("Your home zone changes to Asia/Tokyo at midnight on 1 November 2027 in Europe/London.").first
                   ).to_be_visible(timeout=EVENTUAL_S * 1000)
            pending = jget(dst, "/api/settings")["pending_zone"]
            assert pending["effective_from"] == "2027-11-01T00:00:00Z" and pending["effective_date"] == "2027-11-01"
            select(zone, "America/Los_Angeles")
            click(button(page, "Save home zone"))
            expect(page.get_by_text(
                f"Your home zone changes to America/Los_Angeles at midnight on {written_date('2027-11-01')} in Europe/London.").first
            ).to_be_visible(timeout=EVENTUAL_S * 1000)
            assert jget(dst, "/api/settings")["pending_zone"]["effective_from"] == "2027-11-01T00:00:00Z"
            select(zone, "Europe/London")
            click(button(page, "Save home zone"))
            expect(page.get_by_text("Your home zone is Europe/London.").first).to_be_visible(timeout=EVENTUAL_S * 1000)
            assert jget(dst, "/api/settings")["pending_zone"] is None
            check(radio(page, "Size unit", "in"))
            expect(deck_status(page)).to_have_text("Sizes now show in inches.", timeout=EVENTUAL_S * 1000)
            assert jget(dst, "/api/settings")["unit"] == "in"
            check(radio(page, "Size unit", "mm"))
            expect(deck_status(page)).to_have_text("Sizes now show in millimetres.", timeout=EVENTUAL_S * 1000)
            assert jget(dst, "/api/settings")["unit"] == "mm"
    finally:
        call("PUT", dst, "/api/settings/home-zone", {"zone": "Europe/London"})
        call("PUT", dst, "/api/settings/unit", {"unit": "mm"})


BANNERS = {
    "search": "Search is offline. Showing simple matches from your library until it returns.",
    "storage": "Storage is offline. New captures can't be saved until it returns.",
    "printing": "Printing is offline. Contact sheets wait in the queue until it returns.",
}
SCREENS = [("/", "Keep the object, not the picture."), ("/library", "Library"), ("/capture", "Capture an object"),
           ("/reels", "Reels"), ("/trash", "Trash"), ("/settings", "Settings")]


@pytest.mark.timeout(600)
def test_wf_outages_boot_with_service_down(browser: Browser, app_url: str) -> None:
    own = new_reference(app_url)
    for env, service in (("APP_SEARCH_DOWN_URL", "search"), ("APP_STORAGE_DOWN_URL", "storage"), ("APP_PRINTING_DOWN_URL", "printing")):
        base = outage(env)
        assert get(base, "/api/health").json() == {"status": "ok"}
        poll(lambda: jget(base, "/api/status")["services"][service], lambda s: s == "down", BANNER_S + SLACK_S,
             f"{service}-down copy reports {service} down")
        for path, heading_name in SCREENS:
            with screen(browser, base + path) as page:
                expect(page.get_by_role("heading", name=heading_name).first).to_be_visible()
                eventually(page, lambda: BANNERS[service] in text_of(notices(page)),
                           f"{path} shows the {service} banner", step_ms=1000)
    with screen(browser, f"{outage('APP_STORAGE_DOWN_URL')}/references/{own['id']}") as page:
        eventually(page, lambda: "Photo unavailable while storage is offline." in text_of(figure(page)),
                   "a stored reference's tile shows the photo-unavailable line")


@pytest.mark.timeout(600)
def test_outage_recovery_without_restart(browser: Browser) -> None:
    env = required_env("DATABASE_URL", "S3_BUCKET", "GOTENBERG_URL")
    target = urlparse(env["GOTENBERG_URL"])
    relay = Relay(free_port(), (target.hostname or "127.0.0.1", target.port or 80))
    overrides = {"DATABASE_URL": env["DATABASE_URL"] + "_printdown", "S3_BUCKET": env["S3_BUCKET"] + "-printdown",
                 "MEILISEARCH_INDEX": "references_printdown", "GOTENBERG_URL": f"http://127.0.0.1:{relay.port}"}
    with app_copy(overrides) as (base, log, proc):
        started = time.monotonic()
        deadline = started + BOOT_S
        healthy = False
        while time.monotonic() < deadline and not healthy:
            with suppress(httpx.HTTPError):
                healthy = httpx.get(base + "/api/health", timeout=1).status_code == 200
            assert proc.poll() is None, f"the copy exited: {tail(log)}"
        assert healthy, f"GET /api/health answered within 10 s of serve starting: {tail(log)}"
        poll(lambda: jget(base, "/api/status")["services"]["printing"], lambda s: s == "down", BANNER_S + SLACK_S,
             "status reports printing down")
        reel = reel_with(base, [new_reference(base)])
        sheet = post_json(base, f"/api/reels/{reel['id']}/sheets", {"paper": "a4", "unit": "mm"}, key=idempotency_key())
        assert sheet.status_code == 202
        watch_until = time.monotonic() + SHEET_START_S * 2
        while time.monotonic() < watch_until:
            assert jget(base, f"/api/sheets/{sheet.json()['id']}")["state"] == "queued", "unreachable printing never fails a sheet"
        with screen(browser, f"{base}/reels/{reel['id']}") as page:
            eventually(page, lambda: BANNERS["printing"] in text_of(notices(page)), "the printing banner shows", step_ms=1000)
            relay.start()
            try:
                eventually(page, lambda: BANNERS["printing"] not in text_of(notices(page)),
                           "the banner clears within the published delay", seconds=BANNER_S + SLACK_S, step_ms=1000)
                wait_sheet(base, sheet.json()["id"])
            finally:
                relay.stop()
        assert proc.poll() is None, f"the copy kept running without a restart: {tail(log)}"


def test_wf_outages_storage_503_atomic_key_reusable(browser: Browser, app_url: str, meilisearch: Any) -> None:
    down = outage("APP_STORAGE_DOWN_URL")
    mark = token()
    title = f"{mark} hair dryer"
    sent: list[Any] = []
    with screen(browser, down + "/capture") as page:
        page.on("request", lambda r: sent.append(r) if r.method == "POST" and r.url.endswith("/api/references") else None)
        fill_capture_form(page, title, small_png(RED), unit="in", sizes=("9.3", "6.0", "3.9"))
        click(button(page, "Save to deck"))
        expect(deck_status(page)).to_have_text(
            "The photograph could not be stored, so nothing was saved. Try again when storage returns.", timeout=EVENTUAL_S * 1000)
        expect(textbox(page, "Name")).to_have_value(title)
        expect(textbox(page, "Width")).to_have_value("9.3")
        expect(radio(page, "Size unit", "in")).to_be_checked()
        expect(button(page, "Save to deck")).to_be_focused()
    assert rows_mentioning(Postgres(), mark) == 0 and not meilisearch.search(MAIN_INDEX, mark)["hits"]
    request = sent[0]
    headers = {"Idempotency-Key": request.headers["idempotency-key"], "Content-Type": request.headers["content-type"]}
    retried = httpx.post(app_url + "/api/references", content=request.post_data_buffer, headers=headers, timeout=HTTP_TIMEOUT)
    assert retried.status_code == 201 and retried.json()["title"] == title, "the same key succeeds once storage answers"
    ref = new_reference(app_url)
    for method, body in (("POST", {"x": 0.5, "y": 0.5}), ("DELETE", None)):
        r = call(method, down, f"/api/references/{ref['id']}/swatch", body)
        assert r.status_code == 503 and code_of(r) == "storage_unavailable"
    unchanged = jget(app_url, f"/api/references/{ref['id']}")
    assert unchanged["version"] == 1 and unchanged["swatch_source"] == "computed"


@pytest.mark.timeout(300)
def test_wf_outages_search_catch_up(browser: Browser, app_url: str, meilisearch: Any) -> None:
    down = outage("APP_SEARCH_DOWN_URL")
    poll(lambda: jget(down, "/api/status")["services"]["search"], lambda s: s == "down", BANNER_S + SLACK_S,
         "the search-down copy reports search down")
    note = token()
    b = new_reference(down)
    assert call("DELETE", down, f"/api/references/{b['id']}").status_code == 200
    c = new_reference(down, notes=f"Bead {note} blasted", colour_family="Blue")
    found = jget(down, "/api/search", q=note.upper()[2:9])
    assert found["source"] == "fallback" and c["id"] in [r["id"] for r in found["results"]]
    assert c["id"] not in [r["id"] for r in jget(down, "/api/search", q=note, colour_family="Grey")["results"]]
    with screen(browser, down + "/library") as page:
        eventually(page, lambda: BANNERS["search"] in text_of(notices(page)), "the search banner shows", step_ms=1000)
        fill(page.get_by_role("searchbox", name="Search your deck"), note)
        advance(page, SEARCH_SETTLE_MS)
        eventually(page, lambda: page.get_by_role("link", name=c["title"]).count() > 0, "fallback results show")
        expect(deck_status(page)).to_have_text("1 reference matches.")
    poll(lambda: meilisearch.document(MAIN_INDEX, c["id"]), lambda d: d is not None, CATCH_UP_S + STATUS_CHECK_S + SLACK_S,
         "the capture made during the outage reached the index")
    assert meilisearch.document(MAIN_INDEX, b["id"]) is None, "a capture then trash during the outage leaves no document"
    assert c["id"] in [r["id"] for r in jget(app_url, "/api/search", q=note)["results"]]


def test_printing_down_keeps_queue(browser: Browser) -> None:
    down = outage("APP_PRINTING_DOWN_URL")
    reel = reel_with(down, [new_reference(down)])
    with open_reel(browser, down, reel["id"]) as page:
        eventually(page, lambda: BANNERS["printing"] in text_of(notices(page)), "the printing banner shows", step_ms=1000)
        request_sheet_in_ui(page, "A4", "mm")
        item = page.get_by_role("list", name="Contact sheets").get_by_role("listitem").first
        expect(item).to_contain_text("Queued")
    sheet = jget(down, f"/api/reels/{reel['id']}/sheets")["sheets"][0]
    until = time.monotonic() + SHEET_START_S * 2
    while time.monotonic() < until:
        assert jget(down, f"/api/sheets/{sheet['id']}")["state"] == "queued"
    pdf = get(down, f"/api/sheets/{sheet['id']}/pdf")
    assert pdf.status_code == 409 and code_of(pdf) == "sheet_not_ready"


def test_published_layouts(browser: Browser, app_url: str) -> None:
    ref = new_reference(app_url)
    reel = reel_with(app_url, [ref])
    pages = [("/capture", "Capture an object", True), ("/reels", "Reels", False), (f"/reels/{reel['id']}", reel["name"], True),
             (f"/references/{ref['id']}", ref["title"], True), ("/trash", "Trash", False), ("/settings", "Settings", False)]
    for viewport, band in ((PHONE, PHONE_FIELD_FRACTION), (TABLET, TABLET_FIELD_FRACTION), (DESKTOP, None)):
        for path, heading_name, has_tile in pages:
            with screen(browser, app_url + path, viewport=viewport) as page:
                heading = page.get_by_role("heading", name=heading_name).first
                expect(heading).to_be_visible()
                tile, head = (box(figure(page)), box(heading)) if has_tile else (None, None)
                layout(page)
                expect(page.get_by_role("navigation", name="Deck")).to_be_visible()
                if not has_tile:
                    continue
                vw, vh = viewport["width"], viewport["height"]
                if band is not None:
                    assert tile["y"] + tile["height"] <= vh * (band + LAYOUT_TOL), f"{path} {vw}: tile in the top field"
                    assert head["y"] >= tile["y"] + tile["height"] - 1, f"{path} {vw}: content below the field"
                else:
                    assert tile["x"] >= vw / 2 - 1 and head["x"] < vw / 2, f"{path}: desktop split"
        with screen(browser, app_url + "/reels", viewport=PHONE) as page:
            assert box(page.get_by_role("heading", name="Reels"))["y"] < box(button(page, "New reel"))["y"]


def test_keyboard_dialogs(browser: Browser, app_url: str) -> None:
    ref = new_reference(app_url)
    reel = reel_with(app_url, [ref])
    with screen(browser, f"{app_url}/references/{ref['id']}", reduced_motion="reduce") as page:
        for opener_name, dialog_name in (("View original", "Original photograph"), ("Add to reel", "Add to reel"),
                                         ("Move to trash", "Move to trash?")):
            opener = button(page, opener_name, exact=opener_name != "View original")
            opener.focus()
            visible_focus(opener)
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name=dialog_name)
            expect(dialog).to_be_visible()
            assert inside(dialog), f"{dialog_name} moves focus inside"
            for key in ("Tab", "Shift+Tab"):
                for _ in range(5):
                    page.keyboard.press(key)
                    assert inside(dialog), f"{key} stays inside {dialog_name}"
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            expect(opener).to_be_focused()
    with screen(browser, app_url + "/reels", reduced_motion="reduce") as page:
        opener = button(page, "New reel")
        opener.focus()
        page.keyboard.press("Enter")
        name_box = page.get_by_role("dialog", name="New reel").get_by_role("textbox", name="Reel name")
        expect(name_box).to_be_focused()
        name = f"{token()} reel"
        page.keyboard.type(name)
        create = page.get_by_role("button", name="Create reel")
        tab_until(page, create, presses=6)
        page.keyboard.press("Enter")
        expect(deck_status(page)).to_have_text("Reel created.", timeout=EVENTUAL_S * 1000)
    assert name in [r["name"] for r in jget(app_url, "/api/reels")["reels"]]
    with open_reel(browser, app_url, reel["id"], reduced_motion="reduce") as page:
        opener = button(page, "Print contact sheet")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Print contact sheet")
        expect(dialog).to_be_visible()
        assert inside(dialog)
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()


SOURCE_PROBES = ["/package.json", "/package-lock.json", "/run.json", "/.env", "/tsconfig.json", "/src/server.ts",
                 "/server/index.ts", "/THIRD_PARTY_NOTICES.md", "/node_modules/pg/package.json"]


def test_server_boundary(browser: Browser, app_url: str) -> None:
    foreign = "https://elsewhere.example"
    name = f"{token()} reel"
    r = post_json(app_url, "/api/reels", {"name": name}, Origin=foreign)
    assert r.status_code == 403 and code_of(r) == "cross_origin"
    assert name not in [x["name"] for x in jget(app_url, "/api/reels")["reels"]]
    big = httpx.post(app_url + "/api/reels", content=b'{"name":"' + b"n" * JSON_LIMIT + b'"}',
                     headers={"Content-Type": "application/json", "Origin": foreign}, timeout=HTTP_TIMEOUT)
    assert big.status_code == 403, "cross_origin precedes too_large"
    own_origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    ok = post_json(app_url, "/api/reels", {"name": name}, Origin=own_origin)
    assert ok.status_code == 201
    for path in SOURCE_PROBES:
        assert get(app_url, path).status_code == 404, f"{path} is not served"
    secrets = [v for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "MEILISEARCH_API_KEY", "DATABASE_URL", "S3_ENDPOINT",
                           "MEILISEARCH_URL", "GOTENBERG_URL") if len(v := os.environ.get(k, "")) >= 6]
    bodies = [get(app_url, p).text for p in ("/", "/library", "/api/status", "/api/settings", "/api/reels")]
    for asset in set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css|mjs))"', bodies[0] + bodies[1])):
        bodies.append(get(app_url, asset).text)
    for secret in secrets:
        assert not any(secret in body for body in bodies), "no credential or backing-service URL reaches the browser"
    seen: list[str] = []
    with screen(browser, app_url + "/") as page:
        page.on("request", lambda req: seen.append(req.url))
        for path in ("/library", f"/reels/{ok.json()['id']}", "/capture"):
            page.goto(app_url + path)
            advance(page, 1000)
    assert all(same_origin(u, app_url) for u in seen if u.startswith("http")), "the browser talks only to the app"
    with ThreadPoolExecutor(1) as pool:
        bomb = pool.submit(post_capture, app_url, capture_fields(f"{token()} bomb"), solid_png_stream(BOMB_SIDE, BOMB_SIDE))
        timings = []
        while not bomb.done() or not timings:
            started = time.monotonic()
            assert get(app_url, "/api/health").status_code == 200
            timings.append(time.monotonic() - started)
        assert bomb.result().status_code == 422
    assert max(timings) < HEALTH_ANSWER_S, f"health stayed under a second during a photo check: {max(timings):.2f}"


def test_if_run_manifest(app_url: str) -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest.get(field), str) and manifest[field].strip(), field
    assert get(app_url, "/api/health").json() == {"status": "ok"}


def notices_text() -> str:
    path = APP_DIR / "THIRD_PARTY_NOTICES.md"
    assert path.is_file(), "THIRD_PARTY_NOTICES.md exists at the app root"
    return path.read_text()


def test_if_notices_list_packages_and_assets() -> None:
    text = notices_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    assert "Host Grotesk" in text


def test_if_licences_allowed() -> None:
    bad = [(p.name, getattr(p, "licence", None)) for p in shipped_packages() if not licence_allowed(getattr(p, "licence", "") or "", ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    assert "OFL-1.1" in notices_text()


def test_if_no_extra_datastore() -> None:
    engine = "SQLite".lower()
    assert not [p.name for p in shipped_packages() if engine in p.name.lower()]
    stray = [str(p) for p in Path(DEPLOYED_APP).rglob("*") if "node_modules" not in p.parts
             and p.suffix.lower() in (f".{engine}", f".{engine}3", ".db")]
    assert not stray, f"local database files: {stray[:10]}"


def test_if_service_config_untouched() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    names = ("DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID",
             "S3_SECRET_ACCESS_KEY", "MEILISEARCH_URL", "MEILISEARCH_API_KEY", "GOTENBERG_URL")
    for field in ("install", "build", "serve"):
        for name in names:
            assert f"{name}=" not in manifest[field], f"{field} overrides {name}"


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", ".git", ".next", "coverage", "public", ".cache", "out"}
    ts, js = [], []
    for root, dirs, files in os.walk(APP_DIR):
        dirs[:] = [d for d in dirs if d not in skip]
        for name in files:
            if name.endswith((".ts", ".tsx")):
                ts.append(name)
            elif name.endswith((".js", ".jsx", ".mjs", ".cjs")) and "config" not in name and not name.startswith("."):
                js.append(os.path.join(root, name))
    assert ts and not js, f"JavaScript source files: {js[:10]}"


def test_if_lucide_icons() -> None:
    package = json.loads((APP_DIR / "package.json").read_text())
    deps = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
    if any("lucide" in name for name in deps):
        return
    skip = {"node_modules", "dist", "build", ".git", ".next", "coverage", ".cache", "out"}
    for root, dirs, files in os.walk(APP_DIR):
        dirs[:] = [d for d in dirs if d not in skip]
        for name in files:
            if name.endswith((".ts", ".tsx", ".svg", ".md", ".css")):
                with suppress(OSError, UnicodeDecodeError):
                    if "lucide" in (Path(root) / name).read_text().lower():
                        return
    raise AssertionError("no Lucide package, notice or source reference: icons come from the Lucide set")


TILE_SLIDE_PX = 32
SCREEN_SLIDE_PX = 48
DIALOG_SLIDE_PX = 40
SLIDE_TOL_PX = 10


def slide_path(page: Page, target: Locator | Any, contract: str, seconds: float = 3.0) -> list[dict[str, float]]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        handle = target.element_handle(timeout=1000) if isinstance(target, Locator) else target
        path = seek_rects(handle, 16)
        if path:
            return path
        page.clock.run_for(16)
    raise AssertionError(f"{contract}: no CSS or element.animate() slide on the moving element")


def offset_from_rest(path: list[dict[str, float]], axis: str) -> float:
    rest = path[-1][axis]
    far = max((p[axis] - rest for p in path), key=abs)
    assert all((p[axis] - rest) * far >= -2 for p in path), f"the slide passes its resting place: {path}"
    return far


def test_tile_slide_direction(browser: Browser, app_url: str) -> None:
    data = playback_reel(app_url)
    refs = data["playable"]
    with open_reel(browser, app_url, data["reel"]["id"]) as page:
        fader, fig = slider(page), figure(page)
        eventually(page, lambda: refs[0]["title"] in text_of(fig), "the reel opens on stop 1")
        fader.focus()
        for key, ref, sign in (("ArrowRight", refs[1], 1), ("ArrowLeft", refs[0], -1)):
            page.keyboard.press(key)
            photo = fig.get_by_role("img", name=ref["title"])
            far = offset_from_rest(slide_path(page, photo, f"{key}: the new photo slides"), "x")
            assert abs(far - sign * TILE_SLIDE_PX) <= SLIDE_TOL_PX, f"{key}: the photo starts {far:.1f}px off its rest"
            advance(page, SWAP_MS * 2)
            eventually(page, lambda: ref["title"] in text_of(fig), f"{key}: the swap settles")
    with open_reel(browser, app_url, data["reel"]["id"], reduced_motion="reduce") as page:
        fader, fig = slider(page), figure(page)
        fader.focus()
        page.keyboard.press("ArrowRight")
        photo = fig.get_by_role("img", name=refs[1]["title"])
        expect(photo).to_be_visible()
        assert not seek_rects(photo.element_handle(), 4), "reduced motion: the photo swaps at once"


def test_screen_slide_direction(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url + "/library") as page:
        nav = page.get_by_role("navigation", name="Deck")
        expect(page.get_by_role("main")).to_be_visible()
        assert not seek_rects(page.get_by_role("main").element_handle(), 4), "a screen opened by its address does not slide"
        for link, heading, sign in (("Trash", "Trash", 1), ("Capture", "Capture an object", -1), ("Settings", "Settings", 1)):
            before = box(nav)
            click(nav.get_by_role("link", name=link))
            main = page.get_by_role("main").filter(has=page.get_by_role("heading", name=heading))
            far = offset_from_rest(slide_path(page, main, f"{link}: main slides in"), "x")
            assert abs(far - sign * SCREEN_SLIDE_PX) <= SLIDE_TOL_PX, f"{link}: main starts {far:.1f}px off its rest"
            after = box(nav)
            assert not seek_rects(nav.element_handle(), 4) and abs(after["x"] - before["x"]) <= 1 and abs(after["y"] - before["y"]) <= 1, \
                f"{link}: the navigation stays put"
            expect(page.get_by_role("heading", name=heading)).to_be_visible()
    with screen(browser, app_url + "/library", reduced_motion="reduce") as page:
        click(page.get_by_role("navigation", name="Deck").get_by_role("link", name="Trash"))
        expect(page.get_by_role("heading", name="Trash")).to_be_visible()
        assert not seek_rects(page.get_by_role("main").element_handle(), 4), "reduced motion: screens change at once"


def test_dialog_slide(browser: Browser, app_url: str) -> None:
    ref = new_reference(app_url)
    reel_with(app_url, [new_reference(app_url)])
    with screen(browser, f"{app_url}/references/{ref['id']}") as page:
        opener = button(page, "Add to reel")
        click(opener)
        dialog = page.get_by_role("dialog", name="Add to reel")
        handle = dialog.element_handle(timeout=5000)
        far = offset_from_rest(slide_path(page, handle, "the dialog slides in"), "y")
        assert abs(far - DIALOG_SLIDE_PX) <= SLIDE_TOL_PX, f"the dialog starts {far:.1f}px below its rest"
        assert inside(dialog), "focus is inside while the dialog slides"
        advance(page, 400)
        page.keyboard.press("Escape")
        path = slide_path(page, handle, "the dialog slides out")
        assert abs(path[-1]["y"] - path[0]["y"] - DIALOG_SLIDE_PX) <= SLIDE_TOL_PX, f"the dialog slides 40px down: {path}"
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()


def test_row_slide(browser: Browser, app_url: str) -> None:
    refs = [new_reference(app_url) for _ in range(3)]
    reel = reel_with(app_url, refs)
    with open_reel(browser, app_url, reel["id"]) as page:
        rows = page.get_by_role("list", name="Stops").get_by_role("listitem")
        expect(rows).to_have_count(3)
        first, second = (rows.filter(has_text=refs[i]["title"]) for i in range(2))
        y0 = box(first)["y"] + box(first)["height"] / 2
        y1 = box(second)["y"] + box(second)["height"] / 2
        handles = first.element_handle(), second.element_handle()
        button(page, f"Move {refs[0]['title']} down").focus()
        page.keyboard.press("Enter")
        for handle, start, end, name in ((handles[0], y0, y1, "the moved stop"), (handles[1], y1, y0, "the displaced stop")):
            path = slide_path(page, handle, f"{name} slides")
            assert abs(path[-1]["y"] - end) <= SLIDE_TOL_PX, f"{name} ends in its new place: {path[-1]}"
            assert abs(path[-1]["y"] + offset_from_rest(path, "y") - start) <= SLIDE_TOL_PX, f"{name} starts where it was"
        expect(deck_status(page)).to_have_text(f"Moved {refs[0]['title']} to stop 2.", timeout=EVENTUAL_S * 1000)
        advance(page, 400)
        leaving = rows.filter(has_text=refs[2]["title"])
        width = box(leaving)["width"]
        handle = leaving.element_handle()
        button(page, f"Remove {refs[2]['title']} from reel").focus()
        page.keyboard.press("Enter")
        path = slide_path(page, handle, "the removed stop slides out")
        travel = path[-1]["x"] - path[0]["x"]
        assert abs(travel + width) <= max(SLIDE_TOL_PX, width * 0.1), f"the row slides left by its own width: {travel:.1f}"
        expect(rows).to_have_count(2, timeout=EVENTUAL_S * 1000)
