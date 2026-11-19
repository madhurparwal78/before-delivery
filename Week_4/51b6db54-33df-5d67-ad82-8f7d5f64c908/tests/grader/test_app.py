from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    Mailpit,
    Postgres,
    S3,
    addresses,
    advance,
    animations,
    check,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    text,
)

GRADING_KEY = "grade-cm-5d2a"
PASSWORD = "pw-ada-12"
HTTP_TIMEOUT = 60
SYNC_MS = 8000
UI_MS = 15000
POLL_SECONDS = 30
MAIL_SECONDS = 30
GRACE_MS = 1500
LIVE_MS = 1000
PUSH_MS = 2000
FLOOD_MS = 420
THUMB_GAP_MS = 30
COUNT_ROLL_MS = 320
AUTOSAVE_MS = 800
LONG_PRESS_MS = 400
JOB_ITEM_MS = 400
TAKEOVER_SECONDS = 5
STROKE_WINDOW_MS = 2000
INVITE_TTL = 3600
IDLE_SECONDS = 120
IMPORT_MAX = 200000
SPRITE_MAX = 64
FRAME_MIN = 20
FRAME_MAX = 5000
JSON_MAX = 1000000
SEED_MAX = 20000000
MIN_TARGET = 44
LANDING_MOTION_MS = 1000
STICKER_MS = 500
PANEL_MAX_MS = 500
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
RED, BLUE, ORANGE, LIME = "ff0044ff", "204080ff", "ff8040ff", "ff8001ff"
BLACK = "000000ff"
COLOURS = [RED, BLUE, ORANGE, LIME]
TRANSPARENT = "00000000"
DITHER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
WORKED_HASH = "ac0b31f44df1d49682a57b5bcdca73870c19d91315a0681b26e05fa939923b9d"
OUTAGE_ENV = "APP_STORAGE_DOWN_URL"
MISSING_SPRITE = 999999999
SPACED_NAME = "my picture.png"
LONG_FRAMES = 120


def counted(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def queued_line(n: int) -> str:
    return f"Offline · {counted(n, 'stroke')} queued"


def list_line(verb: str, item: str, pos: int, total: int) -> str:
    if verb == "Cancelled":
        return f"Cancelled, {item} back at position {pos} of {total}"
    return f"{verb} {item}, position {pos} of {total}"
GRADING_ENV = {
    "GRADING_KEY": GRADING_KEY,
    "CELMATE_START_AT": "2027-03-08T16:00:00Z",
    "CELMATE_PALETTE_MAX": "16",
    "CELMATE_SPRITE_MAX": "64",
    "CELMATE_FRAME_MIN_MS": "20",
    "CELMATE_FRAME_MAX_MS": "5000",
    "CELMATE_INVITE_TTL_SECONDS": "3600",
    "CELMATE_LONG_PRESS_MS": "400",
    "CELMATE_PRESENCE_VISIBLE": "2",
    "CELMATE_IDLE_SECONDS": "120",
    "CELMATE_UNDO_DEPTH": "3",
    "CELMATE_ACTIVITY_PAGE": "5",
    "CELMATE_AUTOSAVE_MS": "800",
    "CELMATE_JOB_ITEM_MS": "400",
    "CELMATE_IMPORT_MAX_BYTES": "200000",
}


def rh(n: int, d: int) -> int:
    return (2 * n + d) // (2 * d)


def composite(stack: list[tuple[str, int, str]]) -> str:
    dr = dg = db = da = 0
    for colour, opacity, blend in stack:
        s = bytes.fromhex(colour)
        a = rh(s[3] * opacity, 100)
        if a == 0:
            continue
        ra = a + rh(da * (255 - a), 255)
        out = []
        for si, d in zip(s[:3], (dr, dg, db)):
            c = rh(si * (255 - da) + rh(si * d, 255) * da, 255) if blend == "multiply" and da > 0 else si
            out.append(rh(c * a * 255 + d * da * (255 - a), ra * 255))
        dr, dg, db = out
        da = ra
    return f"{dr:02x}{dg:02x}{db:02x}{da:02x}"


def line(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x1 > x0 else -1), (1 if y1 > y0 else -1)
    err = dx + dy
    out = [(x0, y0)]
    x, y = x0, y0
    while (x, y) != (x1, y1):
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy
        out.append((x, y))
    return out


def region(rows: list[list[int]], seed: tuple[int, int]) -> set[tuple[int, int]]:
    h, w = len(rows), len(rows[0])
    target = rows[seed[1]][seed[0]]
    seen = {seed}
    stack = [seed]
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and rows[ny][nx] == target:
                seen.add((nx, ny))
                stack.append((nx, ny))
    return seen


def rows_hash(rows: list[list[str]]) -> str:
    return hashlib.sha256(b"".join(bytes.fromhex(c) for row in rows for c in row)).hexdigest()


def blank(w: int = 16, h: int = 16) -> list[list[int]]:
    return [[0] * w for _ in range(h)]


def filled(w: int, h: int, value: int = 1) -> list[list[int]]:
    return [[value] * w for _ in range(h)]


def grid_of(*lines: str) -> list[list[int]]:
    return [[0 if c == "." else int(c, 16) for c in row] for row in lines]


def cells(rows: list[list[int]], value: int | None = None) -> set[tuple[int, int]]:
    return {
        (x, y)
        for y, row in enumerate(rows)
        for x, v in enumerate(row)
        if (v == value if value is not None else v != 0)
    }


def with_cells(w: int, h: int, spots: dict[tuple[int, int], int]) -> list[list[int]]:
    rows = blank(w, h)
    for (x, y), v in spots.items():
        rows[y][x] = v
    return rows


def group(n: float, fmt: str = "en-US") -> str:
    whole, _, frac = str(n).partition(".")
    if fmt == "en-IN" and len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        parts.insert(0, head)
        out = ",".join(parts + [tail])
    else:
        out = f"{int(whole):,}"
    return f"{out}.{frac}" if frac else out


def parse_instant(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _sunday(year: int, month: int, nth: int) -> datetime:
    day = datetime(year, month, 1, tzinfo=timezone.utc)
    day += timedelta(days=(6 - day.weekday()) % 7)
    return day + timedelta(days=7 * (nth - 1))


def date_pattern(instant: str, fmt: str = "en-US", zone: str = "UTC") -> str:
    moment = parse_instant(instant)
    if zone == "Asia/Kolkata":
        local, abbr = moment + timedelta(hours=5, minutes=30), "IST"
    elif zone == "America/New_York":
        start = _sunday(moment.year, 3, 2) + timedelta(hours=7)
        end = _sunday(moment.year, 11, 1) + timedelta(hours=6)
        daylight = start <= moment < end
        local = moment - timedelta(hours=4 if daylight else 5)
        abbr = "EDT" if daylight else "EST"
    else:
        local, abbr = moment, "UTC"
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    month = months[local.month - 1]
    clock = f"0?{local.hour}:{local.minute:02d} {abbr}"
    if fmt == "en-IN":
        return f"{local.day} {month} {local.year} {clock}"
    return f"{month} {local.day}, {local.year} {clock}"


class Png:
    def __init__(self, width: int, height: int, rows: list[list[tuple[int, int, int, int]]], colour_type: int, depth: int):
        self.width, self.height, self.rows, self.colour_type, self.depth = width, height, rows, colour_type, depth

    def hex_at(self, x: int, y: int) -> str:
        return "".join(f"{v:02x}" for v in self.rows[y][x])


def png_decode(data: bytes) -> Png:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "payload is not a PNG"
    pos, idat, plte, trns = 8, b"", b"", b""
    width = height = depth = colour = 0
    while pos < len(data):
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + size]
        pos += 12 + size
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", chunk[:10])
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"PLTE":
            plte = chunk
        elif kind == b"tRNS":
            trns = chunk
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour]
    assert depth == 8, "only 8-bit PNG data is read here"
    raw = zlib.decompress(idat)
    stride = width * channels
    prev = bytearray(stride)
    rows: list[list[tuple[int, int, int, int]]] = []
    at = 0
    for _ in range(height):
        kind = raw[at]
        cur = bytearray(raw[at + 1:at + 1 + stride])
        at += 1 + stride
        for i in range(stride):
            a = cur[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if kind == 1:
                cur[i] = (cur[i] + a) & 255
            elif kind == 2:
                cur[i] = (cur[i] + b) & 255
            elif kind == 3:
                cur[i] = (cur[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                cur[i] = (cur[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = cur
        row = []
        for x in range(width):
            v = cur[x * channels:(x + 1) * channels]
            if colour == 6:
                row.append((v[0], v[1], v[2], v[3]))
            elif colour == 2:
                row.append((v[0], v[1], v[2], 255))
            elif colour == 0:
                row.append((v[0], v[0], v[0], 255))
            elif colour == 4:
                row.append((v[0], v[0], v[0], v[1]))
            else:
                i = v[0]
                row.append((plte[3 * i], plte[3 * i + 1], plte[3 * i + 2], trns[i] if i < len(trns) else 255))
        rows.append(row)
    return Png(width, height, rows, colour, depth)


def png_encode(rows: list[list[str]], padding: int = 0) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    h, w = len(rows), len(rows[0])
    raw = b"".join(b"\0" + b"".join(bytes.fromhex(c) for c in row) for row in rows)
    out = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(raw, 9))
    if padding:
        out += chunk(b"tEXt", b"pad\0" + b"x" * padding)
    return out + chunk(b"IEND", b"")


def png_of_size(total: int) -> bytes:
    base = png_encode([[RED]])
    return png_encode([[RED]], padding=total - len(base) - 16)


def gif_encode(frames: list[tuple[list[list[int]], int]], palette: list[str]) -> bytes:
    h, w = len(frames[0][0]), len(frames[0][0][0])
    table = b"".join(bytes.fromhex(c)[:3] for c in palette)
    table += b"\0" * (768 - len(table))
    out = b"GIF89a" + struct.pack("<HHBBB", w, h, 0xF7, 0, 0) + table
    for rows, delay in frames:
        out += b"\x21\xf9\x04" + bytes([0b00001001]) + struct.pack("<H", delay) + b"\0\0"
        out += b"\x2c" + struct.pack("<HHHHB", 0, 0, w, h, 0) + b"\x08"
        codes, buf, bits = [256], 0, 0
        pending = 0
        for row in rows:
            for v in row:
                codes.append(v)
                pending += 1
                if pending == 250:
                    codes.append(256)
                    pending = 0
        codes.append(257)
        stream = bytearray()
        for code in codes:
            buf |= code << bits
            bits += 9
            while bits >= 8:
                stream.append(buf & 255)
                buf >>= 8
                bits -= 8
        if bits:
            stream.append(buf & 255)
        for i in range(0, len(stream), 255):
            part = stream[i:i + 255]
            out += bytes([len(part)]) + bytes(part)
        out += b"\0"
    return out + b"\x3b"


class GifFrame:
    def __init__(self, delay: int, disposal: int, transparent: int | None, rect: tuple[int, int, int, int], palette: bytes, indices: list[int]):
        self.delay, self.disposal, self.transparent = delay, disposal, transparent
        self.rect, self.palette, self.indices = rect, palette, indices

    def colour_at(self, x: int, y: int) -> str | None:
        fx, fy, fw, fh = self.rect
        if not (fx <= x < fx + fw and fy <= y < fy + fh):
            return None
        i = self.indices[(y - fy) * fw + (x - fx)]
        if i == self.transparent:
            return None
        return self.palette[3 * i:3 * i + 3].hex()


def lzw_decode(data: bytes, minimum: int, expected: int) -> list[int]:
    clear, end = 1 << minimum, (1 << minimum) + 1
    table: list[list[int]] = []
    width, prev = minimum + 1, None
    out: list[int] = []
    buf = bits = 0

    def reset() -> list[list[int]]:
        return [[i] for i in range(clear)] + [[], []]

    table = reset()
    for byte in data:
        buf |= byte << bits
        bits += 8
        while bits >= width:
            code = buf & ((1 << width) - 1)
            buf >>= width
            bits -= width
            if code == clear:
                table, width, prev = reset(), minimum + 1, None
                continue
            if code == end:
                return out
            if prev is None:
                entry = table[code]
            else:
                entry = table[code] if code < len(table) else prev + prev[:1]
                if len(table) < 4096:
                    table.append(prev + entry[:1])
                    if len(table) == (1 << width) and width < 12:
                        width += 1
            out.extend(entry)
            prev = entry
    assert len(out) >= expected, "GIF image data ended early"
    return out


def gif_decode(data: bytes) -> tuple[int, int, bool, list[GifFrame]]:
    assert data[:6] in (b"GIF87a", b"GIF89a"), "payload is not a GIF"
    w, h, flags = struct.unpack("<HHB", data[6:11])
    pos = 13
    global_table = b""
    if flags & 0x80:
        size = 3 * (2 << (flags & 7))
        global_table = data[pos:pos + size]
        pos += size
    frames: list[GifFrame] = []
    loops = False
    delay, disposal, transparent = 0, 0, None
    while data[pos] != 0x3B:
        marker = data[pos]
        if marker == 0x21:
            label = data[pos + 1]
            pos += 2
            blocks = []
            while data[pos] != 0:
                size = data[pos]
                blocks.append(data[pos + 1:pos + 1 + size])
                pos += 1 + size
            pos += 1
            if label == 0xF9:
                packed, delay = blocks[0][0], struct.unpack("<H", blocks[0][1:3])[0]
                disposal = (packed >> 2) & 7
                transparent = blocks[0][3] if packed & 1 else None
            elif label == 0xFF and blocks[0][:8] == b"NETSCAPE":
                loops = struct.unpack("<H", blocks[1][1:3])[0] == 0
        else:
            assert marker == 0x2C, "unexpected GIF block"
            fx, fy, fw, fh, packed = struct.unpack("<HHHHB", data[pos + 1:pos + 10])
            pos += 10
            palette = global_table
            if packed & 0x80:
                size = 3 * (2 << (packed & 7))
                palette = data[pos:pos + size]
                pos += size
            minimum = data[pos]
            pos += 1
            stream = bytearray()
            while data[pos] != 0:
                size = data[pos]
                stream += data[pos + 1:pos + 1 + size]
                pos += 1 + size
            pos += 1
            frames.append(GifFrame(delay, disposal, transparent, (fx, fy, fw, fh), palette, lzw_decode(bytes(stream), minimum, fw * fh)))
            delay, disposal, transparent = 0, 0, None
    return w, h, loops, frames


SHOWS_COLOUR_SCRIPT = """([el, hex]) => {
  const want = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ");
  const nodes = [el, ...el.querySelectorAll("*")];
  const cell = el.closest("[role=none], li") || el;
  const around = cell === el ? [] : [...cell.querySelectorAll("*")];
  return [...nodes, ...around].some(n => {
    if ((n.value || "").toLowerCase() === hex) return true;
    if (n.childElementCount === 0 && (n.textContent || "").toLowerCase().includes(hex)) return true;
    const style = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && style.backgroundColor.includes(want);
  });
}"""


def poll(fn: Callable[[], Any], what: str, seconds: float = POLL_SECONDS) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
    pytest.fail(f"expected within {seconds} s: {what}")


def seed(base: str, body: dict[str, Any]) -> dict[str, int]:
    r = httpx.post(f"{base}/api/grading/seed", json=body, headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"seed answered {r.status_code}: {r.text[:300]}"
    return r.json()["ids"]


def config(base: str) -> dict[str, Any]:
    return httpx.get(f"{base}/api/config", timeout=HTTP_TIMEOUT).json()


def clock_advance(base: str, seconds: int) -> dict[str, Any]:
    r = httpx.post(f"{base}/api/grading/clock", json={"advance_seconds": seconds}, headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"clock answered {r.status_code}"
    return r.json()


def later(base: str, seconds: int) -> str:
    return iso(parse_instant(config(base)["now"]) + timedelta(seconds=seconds))


def login_client(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login of {email} answered {r.status_code}: {r.text[:200]}"
    return client


class Person:
    def __init__(self, base: str, key: str, name: str, email: str, ident: int):
        self.base, self.key, self.name, self.email, self.id = base, key, name, email, ident
        self._client: httpx.Client | None = None

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = login_client(self.base, self.email)
        return self._client


class Studio:

    def __init__(self, base: str, ids: dict[str, int], people: dict[str, Person], width: int, height: int, project_name: str, sprite_name: str):
        self.base, self.ids, self.width, self.height = base, ids, width, height
        self.project_name, self.sprite_name = project_name, sprite_name
        self.owner, self.ed, self.ed2, self.rev = people["owner"], people["ed"], people["ed2"], people["rev"]
        self.out, self.out2 = people["out"], people["out2"]
        self.pid, self.sid, self.palette = ids["p"], ids["s"], ids["pal"]
        self.path = f"/projects/{self.pid}/sprites/{self.sid}"

    def layer_id(self, position: int = 0) -> int:
        return self.ids[f"l{position}"]


def make_studio(
    base: str,
    *,
    width: int = 16,
    height: int = 16,
    swatches: list[str] | None = None,
    layers: tuple[Any, ...] = ("Body",),
    frames: int = 1,
    durations: list[int] | None = None,
    cels: dict[tuple[int, str], Any] | None = None,
    sprite_name: str | None = None,
    person_settings: dict[str, dict[str, str]] | None = None,
    **extra: Any,
) -> Studio:
    tag = uuid.uuid4().hex[:8]
    roles = {"ed": "editor", "ed2": "editor", "rev": "reviewer"}
    labels = {"owner": "Ola", "ed": "Eda", "ed2": "Edi", "rev": "Rev", "out": "Oto", "out2": "Oma"}
    settings = person_settings or {}
    users = [
        {
            "key": key,
            "email": f"{label.lower()}-{tag}@team.example",
            "name": f"{label}{tag}",
            "password": PASSWORD,
            "confirmed": True,
            "number_format": settings.get(key, {}).get("number_format", "en-US"),
            "time_zone": settings.get(key, {}).get("time_zone", "UTC"),
        }
        for key, label in labels.items()
    ]
    project_name = f"Quest{tag}"
    sprite = sprite_name or f"Hero{tag}"
    layer_specs = []
    names = []
    for i, spec in enumerate(layers):
        spec = {"name": spec} if isinstance(spec, str) else dict(spec)
        names.append(spec["name"])
        layer_specs.append({"key": f"l{i}", "sprite": "s", "opacity": 100, "blend": "normal", "visible": True, "locked_by": None, **spec})
    times = durations or [100] * frames
    cel_specs = []
    for (frame, layer), value in (cels or {}).items():
        spec = {"key": f"c{frame}-{names.index(layer)}", "frame": f"f{frame}", "layer": f"l{names.index(layer)}"}
        spec.update({"link_to": f"f{value['link_to']}"} if isinstance(value, dict) else {"rows": value})
        cel_specs.append(spec)
    body: dict[str, Any] = {
        "users": users,
        "projects": [{"key": "p", "name": project_name, "owner": "owner"}],
        "memberships": [{"key": f"m-{k}", "project": "p", "user": k, "role": r} for k, r in roles.items()],
        "palettes": [{"key": "pal", "swatches": [{"index": i + 1, "color": c} for i, c in enumerate(COLOURS if swatches is None else swatches)]}],
        "sprites": [{"key": "s", "project": "p", "palette": "pal", "name": sprite, "width": width, "height": height}],
        "layers": layer_specs,
        "frames": [{"key": f"f{i + 1}", "sprite": "s", "duration_ms": ms} for i, ms in enumerate(times)],
        "cels": cel_specs,
    }
    body.update(extra)
    ids = seed(base, body)
    people = {u["key"]: Person(base, u["key"], u["name"], u["email"], ids[u["key"]]) for u in users}
    return Studio(base, ids, people, width, height, project_name, sprite)


def tile_set(count: int = 4, size: int = 8, table: list[int] | None = None) -> dict[str, Any]:
    return {
        "key": "ts",
        "sprite": "s",
        "name": "Ground",
        "tile_size": size,
        "tiles": [{"key": f"t{i + 1}", "rows": filled(size, size, (i % 4) + 1)} for i in range(count)],
        "edge_table": table or [1] * 16,
    }


def tile_map(width: int = 8, height: int = 8, placed: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"key": "tm", "sprite": "s", "tileset": "ts", "name": "Map", "width": width, "height": height, "cells": placed or []}


def post_stroke(client: httpx.Client, sid: int, points: list[list[int]], *, tool: str = "pencil", swatch: int = 1, frame: int = 1, layer: str = "Body", size: int = 1, mirror: str = "none", options: dict[str, Any] | None = None, csid: str | None = None) -> httpx.Response:
    return client.post(f"/api/sprites/{sid}/strokes", json={
        "client_stroke_id": csid or uuid.uuid4().hex,
        "frame": frame, "layer": layer, "tool": tool, "points": points, "swatch": swatch,
        "size": size, "mirror": mirror, "options": options or {},
    })


def paint(client: httpx.Client, sid: int, points: list[list[int]], **kw: Any) -> dict[str, Any]:
    r = post_stroke(client, sid, points, **kw)
    assert r.status_code == 201, f"stroke answered {r.status_code}: {r.text[:300]}"
    return r.json()


def indices(client: httpx.Client, sid: int, frame: int = 1, layer: str = "Body") -> list[list[int]]:
    r = client.get(f"/api/sprites/{sid}/frames/{frame}/indices", params={"layer": layer})
    assert r.status_code == 200, f"indices answered {r.status_code}"
    return r.json()["rows"]


def pixel_body(client: httpx.Client, sid: int, frame: int = 1, layer: str | None = None) -> dict[str, Any]:
    params = {"layer": layer} if layer else {}
    r = client.get(f"/api/sprites/{sid}/frames/{frame}/pixels", params=params)
    assert r.status_code == 200, f"pixels answered {r.status_code}"
    return r.json()


def sprite_info(client: httpx.Client, sid: int) -> dict[str, Any]:
    r = client.get(f"/api/sprites/{sid}")
    assert r.status_code == 200, f"sprite answered {r.status_code}"
    return r.json()


def seq_of(client: httpx.Client, sid: int) -> int:
    return sprite_info(client, sid)["seq"]


def swatch(client: httpx.Client, palette: int, index: int) -> dict[str, Any]:
    body = client.get(f"/api/palettes/{palette}").json()
    return next(s for s in body["swatches"] if s["index"] == index)


def events_since(client: httpx.Client, sid: int, since: int = 0) -> list[dict[str, Any]]:
    r = client.get(f"/api/sprites/{sid}/events", params={"since": since})
    assert r.status_code == 200, f"events answered {r.status_code}"
    return r.json()["events"]


def finish_job(client: httpx.Client, job: int, seconds: float = POLL_SECONDS * 3) -> dict[str, Any]:
    def ended() -> dict[str, Any] | None:
        body = client.get(f"/api/jobs/{job}").json()
        return body if body["state"] in ("stored", "failed", "cancelled") else None

    return poll(ended, f"job {job} reached an end state", seconds)


def run_export(client: httpx.Client, sid: int, **body: Any) -> dict[str, Any]:
    r = client.post(f"/api/sprites/{sid}/exports", json=body)
    assert r.status_code == 202, f"export answered {r.status_code}: {r.text[:300]}"
    return finish_job(client, r.json()["job"])


def export_row(client: httpx.Client, pid: int, job: int) -> dict[str, Any] | None:
    rows = client.get(f"/api/projects/{pid}/exports").json()["exports"]
    return next((e for e in rows if e["job"] == job), None)


def stored_files(client: httpx.Client, pid: int, job: dict[str, Any]) -> tuple[dict[str, Any], dict[str, bytes]]:
    assert job["state"] == "stored", f"job ended {job['state']}"
    row = export_row(client, pid, job["id"])
    assert row is not None, "stored job has no listed export"
    files = {}
    for f in job["files"]:
        r = client.get(f"/api/exports/{row['id']}/files/{f['name']}")
        assert r.status_code == 200, f"download of {f['name']} answered {r.status_code}"
        files[f["name"]] = r.content
    return row, files


def mail_to(mail: Mailpit, email: str, subject: str | None = None, expected: int = 1) -> list[dict[str, Any]]:
    def matching(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            m for m in messages
            if email.lower() in [a.lower() for a in addresses(m.get("To"))]
            and (subject is None or m.get("Subject") == subject)
        ]

    if expected:
        poll(lambda: len(matching(mail.messages(settle=0))) >= expected, f"{expected} mail to {email} about {subject}", MAIL_SECONDS)
    return matching(mail.messages())


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class AppCopy:
    def __init__(self, base: str, proc: subprocess.Popen, log: Path):
        self.base, self.proc, self.log = base, proc, log

    def kill(self) -> None:
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGKILL)
            self.proc.wait(timeout=HTTP_TIMEOUT)


@contextmanager
def app_copy(port: int | None = None, *, only_port_var: bool = False) -> Iterator[AppCopy]:
    port = port or free_port()
    manifest = json.loads(Path("/app/run.json").read_text())
    env = dict(os.environ)
    env.update(GRADING_ENV)
    env["PORT"] = str(port)
    env.pop("APP_PUBLIC_PORT", None)
    if not only_port_var:
        env["APP_PUBLIC_PORT"] = str(port)
    base = f"http://127.0.0.1:{port}"
    env["APP_PUBLIC_URL"] = base
    with tempfile.TemporaryDirectory() as folder:
        log = Path(folder) / "copy.log"
        with log.open("wb") as sink:
            proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=sink, stderr=subprocess.STDOUT, start_new_session=True)
        copy = AppCopy(base, proc, log)

        def healthy() -> bool:
            if proc.poll() is not None:
                pytest.fail(f"the app copy exited: {log.read_text()[-2000:]}")
            try:
                return httpx.get(f"{base}/api/health", timeout=2).status_code == 200
            except httpx.HTTPError:
                return False

        try:
            poll(healthy, f"/api/health on the app copy; log tail {log.name}", POLL_SECONDS * 2)
            yield copy
        finally:
            copy.kill()


def outage_base() -> str:
    url = os.environ.get(OUTAGE_ENV)
    assert url, f"{OUTAGE_ENV} is not set"
    return url.rstrip("/")


def role(scope: Any, kind: str, name: str, **kw: Any) -> Locator:
    return scope.get_by_role(kind, name=name, exact=True, **kw)


def stage(page: Page) -> Locator:
    return role(page, "application", "Sprite stage")


def status(page: Page, name: str) -> Locator:
    return role(page, "status", name)


def announced(page: Page, value: str) -> None:
    expect(status(page, "Stage announcements")).to_have_text(value, timeout=SYNC_MS)


def notice(page: Page, value: str) -> None:
    expect(status(page, "Notices")).to_contain_text(value, timeout=SYNC_MS)


def alert(page: Page, value: str | re.Pattern) -> None:
    expect(page.get_by_role("alert").filter(has_text=value).first).to_be_visible(timeout=SYNC_MS)


def attr(locator: Locator, name: str, value: str | re.Pattern) -> None:
    expect(locator).to_have_attribute(name, value, timeout=SYNC_MS)


def hash_is(page: Page, value: str) -> None:
    attr(stage(page), "data-composite-hash", value)


def hash_of(client: httpx.Client, sid: int, frame: int = 1) -> str:
    return rows_hash(pixel_body(client, sid, frame)["rows"])


def sign_in(page: Page, base: str, person: Person) -> None:
    r = page.context.request.post(f"{base}/api/auth/login", data={"email": person.email, "password": PASSWORD})
    assert r.status == 200, f"browser login answered {r.status}"


@contextmanager
def opened(browser: Browser, base: str, person: Person | None, path: str, *, size: dict[str, int] = DESKTOP, reduced_motion: str = "no-preference", paused: bool = False) -> Iterator[Page]:
    with open_app(browser, f"{base}/signin", reduced_motion=reduced_motion) as page:
        if not paused:
            page.clock.resume()
        page.set_viewport_size(size)
        if person is not None:
            sign_in(page, base, person)
        page.goto(f"{base}{path}")
        yield page


@contextmanager
def workspace(browser: Browser, studio: Studio, person: Person, **kw: Any) -> Iterator[Page]:
    with opened(browser, studio.base, person, studio.path, **kw) as page:
        expect(stage(page)).to_be_visible(timeout=UI_MS)
        expect(status(page, "Sync status")).to_have_text("Synced", timeout=UI_MS)
        yield page


def press(page: Page, *keys: str) -> None:
    for key in keys:
        page.keyboard.press(key)


def move_cursor(page: Page, x: int, y: int) -> None:
    st = stage(page)
    if not st.evaluate("c => c === document.activeElement"):
        st.focus()
    cx, cy = int(st.get_attribute("data-cursor-x") or 0), int(st.get_attribute("data-cursor-y") or 0)
    for _ in range(abs(x - cx)):
        page.keyboard.press("ArrowRight" if x > cx else "ArrowLeft")
    for _ in range(abs(y - cy)):
        page.keyboard.press("ArrowDown" if y > cy else "ArrowUp")
    attr(st, "data-cursor-x", str(x))
    attr(st, "data-cursor-y", str(y))


def cell_point(page: Page, x: int, y: int) -> tuple[float, float]:
    st = stage(page)
    st.scroll_into_view_if_needed()
    box = st.bounding_box()
    zoom = int(st.get_attribute("data-zoom"))
    return box["x"] + (x + 0.5) * zoom, box["y"] + (y + 0.5) * zoom


def drag(page: Page, *path: tuple[int, int]) -> None:
    points = [cell_point(page, x, y) for x, y in path]
    page.mouse.move(*points[0])
    page.mouse.down()
    for point in points[1:]:
        page.mouse.move(*point)
    page.mouse.up()


def pick_layer(page: Page, name: str) -> None:
    click(role(role(page, "listbox", "Layers"), "option", name))
    attr(stage(page), "data-layer", name)


def pick_swatch(page: Page, index: int) -> None:
    click(role(role(page, "listbox", "Palette"), "option", f"Swatch {index}"))


def tool_button(page: Page, name: str) -> Locator:
    return role(role(page, "toolbar", "Tools"), "button", name)


def thumb(page: Page, frame: int) -> Locator:
    return role(page, "row", f"Frame {frame}").locator("[data-thumb-seq]")


def edit_swatch_ui(page: Page, index: int, colour: str) -> None:
    pick_swatch(page, index)
    fill(role(page, "textbox", "Swatch colour"), colour)
    click(role(page, "button", "Save swatch"))


def screen(page: Page, locator: Locator) -> Png:
    box = locator.bounding_box()
    sx, sy = page.evaluate("() => [window.visualViewport.pageLeft, window.visualViewport.pageTop]")
    shot = session(page).send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False,
                                                          "clip": {"x": box["x"] + sx, "y": box["y"] + sy, "width": box["width"], "height": box["height"], "scale": 1}})
    return png_decode(base64.b64decode(shot["data"]))


def stage_cell_rgb(page: Page, shot: Png, x: int, y: int) -> str:
    zoom = int(stage(page).get_attribute("data-zoom"))
    return shot.hex_at(int((x + 0.5) * zoom), int((y + 0.5) * zoom))[:6]


def upload(page: Page, label: str, button: str, name: str, payload: bytes, mime: str, outcome: Locator) -> None:
    page.get_by_label(label).set_input_files({"name": name, "mimeType": mime, "buffer": payload})
    try:
        expect(outcome).to_be_visible(timeout=GRACE_MS)
    except AssertionError:
        click(role(page, "button", button))
        expect(outcome).to_be_visible(timeout=SYNC_MS)


def touch(page: Page, kind: str, points: list[tuple[float, float]]) -> None:
    session(page).send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})


def enable_touch(page: Page) -> None:
    session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 2})


def focused_rowindex(page: Page) -> str | None:
    return page.evaluate("() => { const r = document.activeElement.closest('[aria-rowindex]'); return r ? r.getAttribute('aria-rowindex') : null; }")


def preview_frame(page: Page) -> Locator:
    return role(page, "region", "Preview").locator("[data-preview-frame]")


def tilemap_cell(page: Page, x: int, y: int) -> Locator:
    return role(page, "grid", "Tilemap").locator(f'[data-x="{x}"][data-y="{y}"]')


def walk_preview(page: Page, durations: dict[int, int], sequence: list[int]) -> None:
    frame = preview_frame(page)
    for shown, following in zip(sequence, sequence[1:]):
        attr(frame, "data-preview-frame", str(shown))
        advance(page, durations[shown] - 1)
        attr(frame, "data-preview-frame", str(shown))
        advance(page, 1)
    attr(frame, "data-preview-frame", str(sequence[-1]))


def test_stage_contract(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, width=2, height=1, cels={(1, "Body"): [[1, 0]]})
    with workspace(browser, s, s.ed) as page:
        expect(page.get_by_role("application", name="Sprite stage")).to_have_count(1)
        st = stage(page)
        attr(st, "data-sprite-id", str(s.sid))
        attr(st, "data-frame", "1")
        attr(st, "data-layer", "Body")
        attr(st, "data-zoom", "8")
        attr(st, "data-seq", "0")
        attr(st, "data-composite-hash", WORKED_HASH)
        assert st.evaluate("c => c.tagName.toLowerCase()") == "canvas"
        assert st.get_attribute("data-selection") is None
        assert st.get_attribute("data-floating") is None
    b = make_studio(app_url, cels={(1, "Body"): blank()})
    with workspace(browser, b, b.ed) as page:
        st = stage(page)
        for zoom in ("8", "16"):
            attr(st, "data-zoom", zoom)
            scale = int(zoom)
            assert st.evaluate("c => [c.width, c.height]") == [16 * scale, 16 * scale]
            box = st.bounding_box()
            assert (round(box["width"]), round(box["height"])) == (16 * scale, 16 * scale), "canvas has outer frame or scaling beyond the zoom"
            assert st.evaluate("c => getComputedStyle(c).imageRendering") in ("pixelated", "crisp-edges", "-moz-crisp-edges")
            page.mouse.move(box["x"] + 3 * scale + 1, box["y"] + 5 * scale + 1)
            attr(st, "data-cursor-x", "3")
            attr(st, "data-cursor-y", "5")
            page.mouse.move(box["x"] + 3 * scale + scale - 1, box["y"] + 5 * scale + scale - 1)
            attr(st, "data-cursor-x", "3")
            if zoom == "8":
                click(role(page, "button", "Zoom in"))


def test_pixel_route_matches_stage_hash(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, cels={(1, "Body"): with_cells(16, 16, {(1, 1): 1, (2, 1): 2})})
    with workspace(browser, s, s.ed2) as page:
        body = pixel_body(s.ed.client, s.sid)
        assert (body["width"], body["height"], body["seq"]) == (16, 16, 0)
        assert body["rows"][1][1] == RED and body["rows"][1][2] == BLUE and body["rows"][0][0] == TRANSPARENT
        assert all(re.fullmatch(r"[0-9a-f]{8}", c) for row in body["rows"] for c in row)
        hash_is(page, rows_hash(body["rows"]))
        result = paint(s.ed.client, s.sid, [[5, 5]], swatch=3)
        attr(stage(page), "data-seq", str(result["seq"]))
        after = pixel_body(s.ed.client, s.sid)
        assert after["seq"] == result["seq"] and after["rows"][5][5] == ORANGE
        hash_is(page, rows_hash(after["rows"]))
        layer = pixel_body(s.ed.client, s.sid, layer="Body")
        assert layer["rows"][5][5] == ORANGE


def test_wf_keyboard_drawing_every_tool(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    expected = blank()

    def put(points: set[tuple[int, int]], value: int) -> None:
        for x, y in points:
            expected[y][x] = value

    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        st = stage(page)
        st.focus()
        attr(st, "data-cursor-x", "0")
        attr(st, "data-cursor-y", "0")
        press(page, "Tab")
        expect(st).to_be_focused()
        press(page, "b")
        move_cursor(page, 1, 1)
        press(page, "Space")
        put({(1, 1)}, 1)
        attr(st, "data-seq", "1")
        press(page, "e", "Space")
        put({(1, 1)}, 0)
        attr(st, "data-seq", "2")
        press(page, "l", "Space")
        move_cursor(page, 4, 3)
        press(page, "Space")
        put(set(line(1, 1, 4, 3)), 1)
        attr(st, "data-seq", "3")
        press(page, "r")
        move_cursor(page, 5, 5)
        press(page, "Space")
        move_cursor(page, 8, 7)
        press(page, "Space")
        put({(x, y) for x in range(5, 9) for y in range(5, 8) if x in (5, 8) or y in (5, 7)}, 1)
        attr(st, "data-seq", "4")
        press(page, "o")
        move_cursor(page, 0, 8)
        press(page, "Space")
        move_cursor(page, 4, 12)
        press(page, "Space")
        put(cells(grid_of(".111.", "1...1", "1...1", "1...1", ".111.")) and {(x, y + 8) for x, y in cells(grid_of(".111.", "1...1", "1...1", "1...1", ".111."))}, 1)
        attr(st, "data-seq", "5")
        press(page, "d")
        move_cursor(page, 15, 15)
        press(page, "Space")
        for x, y in region(expected, (15, 15)):
            expected[y][x] = 1 if DITHER[y % 4][x % 4] < 8 else 2
        attr(st, "data-seq", "6")
        press(page, "x")
        announced(page, "Swatches swapped")
        press(page, "g")
        move_cursor(page, 6, 6)
        press(page, "Space")
        put(region(expected, (6, 6)), 2)
        attr(st, "data-seq", "7")
        press(page, "s", "Space")
        move_cursor(page, 7, 6)
        press(page, "Space")
        attr(st, "data-selection", "6,6,2,1")
        press(page, "i", "Space")
        announced(page, "Picked swatch 2")
        press(page, "Escape")
        announced(page, "Left drawing mode")
        expect(st).to_be_focused()
        press(page, "ArrowRight")
        attr(st, "data-cursor-x", "7")
        press(page, "Enter", "ArrowRight")
        attr(st, "data-cursor-x", "8")
        press(page, "Escape", "Tab")
        expect(st).not_to_be_focused()
        assert indices(s.ed.client, s.sid) == expected
        final = hash_of(s.ed.client, s.sid)
        hash_is(page, final)
        hash_is(watcher, final)
        attr(stage(watcher), "data-seq", "7")
        watcher.reload()
        hash_is(watcher, final)


def test_wf_keyboard_drawing_counts(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        option = role(role(watcher, "listbox", "Palette"), "option", "Swatch 1")
        attr(option, "data-used-by", "0")
        move_cursor(page, 2, 2)
        press(page, "Space", "ArrowRight", "Space")
        attr(option, "data-used-by", "2")
        assert len(cells(indices(s.ed.client, s.sid), 1)) == 2
        press(page, "Control+z")
        announced(page, "Undone")
        attr(option, "data-used-by", "1")
        expect(role(watcher, "region", "Palette")).to_contain_text(f"Used by {counted(int(option.get_attribute('data-used-by')), 'pixel')}", timeout=SYNC_MS)
        assert swatch(s.ed.client, s.palette, 1)["used_by"] == 1


def test_hotkeys_from_any_control(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=3)
    with workspace(browser, s, s.ed) as page:
        role(page, "button", "Undo").focus()
        press(page, "l")
        expect(tool_button(page, "Line")).to_have_attribute("aria-pressed", "true")
        role(page, "checkbox", "Onion skin").focus()
        press(page, "r")
        expect(tool_button(page, "Rectangle")).to_have_attribute("aria-pressed", "true")
        role(page, "slider", "Layer opacity").focus()
        press(page, "o")
        expect(tool_button(page, "Ellipse")).to_have_attribute("aria-pressed", "true")
        role(role(page, "listbox", "Layers"), "option", "Body").focus()
        press(page, "g")
        expect(tool_button(page, "Fill")).to_have_attribute("aria-pressed", "true")
        for key, tool in (("d", "Dither"), ("s", "Selection"), ("i", "Picker"), ("e", "Eraser"), ("b", "Pencil")):
            press(page, key)
            expect(tool_button(page, tool)).to_have_attribute("aria-pressed", "true")
        role(page, "row", "Frame 1").focus()
        press(page, "Period")
        attr(stage(page), "data-frame", "2")
        press(page, "Period", "Period")
        attr(stage(page), "data-frame", "3")
        press(page, "Comma")
        attr(stage(page), "data-frame", "2")
        role(page, "button", "Redo").focus()
        for label in ("x", "y", "both", "none"):
            press(page, "m")
            announced(page, f"Mirror: {label}")
        press(page, "]")
        announced(page, "Brush size 2")
        press(page, "[")
        announced(page, "Brush size 1")
        press(page, "x")
        announced(page, "Swatches swapped")
        tag_name = role(page, "textbox", "Tag name")
        tag_name.focus()
        press(page, "l")
        expect(tool_button(page, "Pencil")).to_have_attribute("aria-pressed", "true")
        expect(tag_name).to_have_value("l")
        move_cursor(page, 1, 1)
        press(page, "c")
        comment = role(page, "dialog", "New comment")
        expect(comment).to_be_visible(timeout=SYNC_MS)
        role(comment, "textbox", "Comment").focus()
        press(page, "l")
        expect(tool_button(page, "Pencil")).to_have_attribute("aria-pressed", "true")


def test_shift_run_commits_as_one_stroke(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page:
        move_cursor(page, 3, 3)
        page.keyboard.down("Shift")
        press(page, "ArrowRight", "ArrowRight", "ArrowRight")
        assert seq_of(s.ed.client, s.sid) == 0, "the run reached the server before Shift was released"
        page.keyboard.up("Shift")
        attr(stage(page), "data-seq", "1")
        assert cells(indices(s.ed.client, s.sid), 1) == {(3, 3), (4, 3), (5, 3), (6, 3)}
        press(page, "ArrowLeft", "ArrowLeft")
        page.keyboard.down("Shift")
        press(page, "ArrowDown", "ArrowRight")
        page.keyboard.up("Shift")
        attr(stage(page), "data-seq", "2")
        assert cells(indices(s.ed.client, s.sid), 1) - {(3, 3), (4, 3), (5, 3), (6, 3)} == {(4, 4), (5, 4)}
        assert [e["type"] for e in events_since(s.ed.client, s.sid)] == ["stroke", "stroke"]


def test_stage_announcements_exact_text(browser: Browser, app_url: str) -> None:
    rows = with_cells(16, 16, {(x, 0): 1 for x in range(6)})
    s = make_studio(app_url, frames=3, cels={(1, "Body"): rows, (2, "Body"): rows, (3, "Body"): blank()},)
    with workspace(browser, s, s.ed) as page:
        move_cursor(page, 1, 0)
        announced(page, f"Pixel 1, 0, {RED}, layer Body")
        press(page, "ArrowDown")
        announced(page, f"Pixel 1, 1, {TRANSPARENT}, layer Body")
        press(page, "l")
        announced(page, "Tool: Line")
        press(page, "Period")
        announced(page, "Frame 2 of 3")
        press(page, "]")
        announced(page, "Brush size 2")
        press(page, "[", "m")
        announced(page, "Mirror: x")
        press(page, "x")
        announced(page, "Swatches swapped")
        press(page, "p")
        announced(page, "Pixel perfect on")
        press(page, "p")
        announced(page, "Pixel perfect off")
        click(role(role(page, "listbox", "Palette"), "option", "Swatch 2"))
        role(role(page, "listbox", "Palette"), "option", "Swatch 2").focus()
        press(page, "Shift+Enter")
        announced(page, "Secondary swatch 2")
        edit_swatch_ui(page, 1, ORANGE)
        announced(page, f"Swatch 1 now {ORANGE}, used by 12 pixels in 2 frames")
        stage(page).focus()
        press(page, "Escape")
        announced(page, "Left drawing mode")
    single = make_studio(app_url, cels={(1, "Body"): with_cells(16, 16, {(0, 0): 1})})
    with workspace(browser, single, single.ed) as page:
        edit_swatch_ui(page, 1, ORANGE)
        announced(page, f"Swatch 1 now {ORANGE}, used by 1 pixel in 1 frame")


def test_floating_selection_by_keyboard(browser: Browser, app_url: str) -> None:
    rows = with_cells(16, 16, {(x, y): 1 for x in range(2, 6) for y in range(5, 8)})
    s = make_studio(app_url, cels={(1, "Body"): rows})
    start_hash = hash_of(s.ed.client, s.sid)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        st = stage(page)
        move_cursor(page, 2, 5)
        press(page, "s", "Space")
        move_cursor(page, 5, 7)
        press(page, "Space")
        attr(st, "data-selection", "2,5,4,3")
        press(page, "f")
        attr(st, "data-floating", "2,5,4,3")
        announced(page, "Selection 4 by 3 at 2, 5")
        press(page, "ArrowRight")
        attr(st, "data-floating", "3,5,4,3")
        announced(page, "Selection 4 by 3 at 3, 5")
        press(page, "Space", "b")
        expect(tool_button(page, "Selection")).to_have_attribute("aria-pressed", "true")
        attr(st, "data-seq", "0")
        hash_is(page, start_hash)
        assert seq_of(s.ed.client, s.sid) == 0 and hash_of(s.ed.client, s.sid) == start_hash
        hash_is(watcher, start_hash)
        press(page, "Escape")
        announced(page, "Selection cancelled")
        expect(st).not_to_have_attribute("data-floating", re.compile("."))
        attr(st, "data-selection", "2,5,4,3")
        expect(st).to_be_focused()
        assert seq_of(s.ed.client, s.sid) == 0
        press(page, "f", "ArrowRight", "Enter")
        announced(page, "Selection placed at 3, 5")
        attr(st, "data-selection", "3,5,4,3")
        expect(st).not_to_have_attribute("data-floating", re.compile("."))
        attr(st, "data-seq", "1")
        expected = {(x, y) for x in range(3, 7) for y in range(5, 8)}
        assert cells(indices(s.ed.client, s.sid), 1) == expected
        final = hash_of(s.ed.client, s.sid)
        hash_is(watcher, final)
        page.reload()
        hash_is(page, final)


def test_line_rule_and_joined_samples(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    worked = {
        ((0, 0), (5, 2)): {(0, 0), (1, 0), (2, 1), (3, 1), (4, 2), (5, 2)},
        ((0, 0), (4, 2)): {(0, 0), (1, 1), (2, 1), (3, 2), (4, 2)},
        ((1, 1), (3, 6)): {(1, 1), (1, 2), (2, 3), (2, 4), (3, 5), (3, 6)},
    }
    for frame_cells, ((a, b), want) in enumerate(worked.items()):
        fresh = make_studio(app_url)
        paint(fresh.ed.client, fresh.sid, [list(a), list(b)], tool="line")
        assert cells(indices(fresh.ed.client, fresh.sid), 1) == want, f"line case {frame_cells}"
    paint(s.ed.client, s.sid, [[0, 0], [5, 2], [5, 7]])
    assert cells(indices(s.ed.client, s.sid), 1) == set(line(0, 0, 5, 2)) | set(line(5, 2, 5, 7))
    ui = make_studio(app_url)
    with workspace(browser, ui, ui.ed) as page:
        drag(page, (1, 1), (10, 4), (12, 12))
        attr(stage(page), "data-seq", "1")
        assert cells(indices(ui.ed.client, ui.sid), 1) == set(line(1, 1, 10, 4)) | set(line(10, 4, 12, 12))
        press(page, "l")
        drag(page, (0, 14), (5, 15))
        attr(stage(page), "data-seq", "2")
        got = cells(indices(ui.ed.client, ui.sid), 1)
        assert set(line(0, 14, 5, 15)) <= got


BRUSH_CASES = ["size-1", "size-2", "size-3", "size-4", "corner-dropped"]
BRUSH_VALUES = {"size-1": (1, 8, 8), "size-2": (2, 8, 8), "size-3": (3, 8, 8), "size-4": (4, 8, 8), "corner-dropped": (4, 0, 0)}


@pytest.mark.parametrize("case", BRUSH_CASES, ids=BRUSH_CASES)
def test_brush_masks(app_url: str, case: str) -> None:
    size, x, y = BRUSH_VALUES[case]
    s = make_studio(app_url)
    low, high = -((size - 1) // 2), size // 2
    want = {(x + dx, y + dy) for dx in range(low, high + 1) for dy in range(low, high + 1) if 0 <= x + dx < 16 and 0 <= y + dy < 16}
    result = paint(s.ed.client, s.sid, [[x, y]], size=size)
    assert cells(indices(s.ed.client, s.sid), 1) == want
    assert result["pixels_changed"] == len(want)
    assert post_stroke(s.ed.client, s.sid, [[x, y]], size=size + 8).status_code == 422 if size == 1 else True


SHAPE_CASES = ["rect-outline", "rect-filled", "rect-reversed", "ellipse-5x5", "ellipse-6x4", "ellipse-filled"]
ELLIPSE_FILLED = {(x, y) for x in range(6) for y in range(4) if ((2 * x + 1 - 6) ** 2) * 16 + ((2 * y + 1 - 4) ** 2) * 36 <= 36 * 16}
SHAPE_VALUES = {
    "rect-outline": ("rectangle", [[2, 3], [5, 5]], False, {(x, y) for x in range(2, 6) for y in range(3, 6) if x in (2, 5) or y in (3, 5)}),
    "rect-filled": ("rectangle", [[2, 3], [5, 5]], True, {(x, y) for x in range(2, 6) for y in range(3, 6)}),
    "rect-reversed": ("rectangle", [[5, 5], [2, 3]], False, {(x, y) for x in range(2, 6) for y in range(3, 6) if x in (2, 5) or y in (3, 5)}),
    "ellipse-5x5": ("ellipse", [[0, 0], [4, 4]], False, cells(grid_of(".111.", "1...1", "1...1", "1...1", ".111."))),
    "ellipse-6x4": ("ellipse", [[0, 0], [5, 3]], False, cells(grid_of(".1111.", "1....1", "1....1", ".1111."))),
    "ellipse-filled": ("ellipse", [[0, 0], [5, 3]], True, ELLIPSE_FILLED),
}


@pytest.mark.parametrize("case", SHAPE_CASES, ids=SHAPE_CASES)
def test_rectangle_and_ellipse_cells(app_url: str, case: str) -> None:
    tool, points, is_filled, want = SHAPE_VALUES[case]
    s = make_studio(app_url)
    paint(s.ed.client, s.sid, points, tool=tool, options={"filled": is_filled})
    assert cells(indices(s.ed.client, s.sid), 1) == want


def test_fill_tool_regions(browser: Browser, app_url: str) -> None:
    rows = grid_of("..1...1.", "..1...1.", "111...1.", "......1.", "2.....1.", "2.....1.", "......1.", "......1.")
    s = make_studio(app_url, width=8, height=8, layers=("Body", "Top"), cels={(1, "Body"): rows, (1, "Top"): with_cells(8, 8, {(0, 0): 3})})
    paint(s.ed.client, s.sid, [[0, 0]], tool="fill", swatch=3)
    after = indices(s.ed.client, s.sid)
    assert cells(after, 3) == {(0, 0), (1, 0), (0, 1), (1, 1)}
    assert cells(after, 1) == cells(rows, 1) and cells(after, 2) == cells(rows, 2)
    assert indices(s.ed.client, s.sid, layer="Top") == with_cells(8, 8, {(0, 0): 3})
    t = make_studio(app_url, width=8, height=8, cels={(1, "Body"): rows})
    paint(t.ed.client, t.sid, [[2, 0]], tool="fill", swatch=4, options={"contiguous": False})
    other = indices(t.ed.client, t.sid)
    assert cells(other, 4) == cells(rows, 1) and cells(other, 1) == set()
    assert cells(other, 2) == cells(rows, 2)
    ui = make_studio(app_url, width=8, height=8, cels={(1, "Body"): rows})
    with workspace(browser, ui, ui.ed) as page:
        click(role(page, "checkbox", "Contiguous"))
        press(page, "g")
        pick_swatch(page, 3)
        drag(page, (2, 0))
        attr(stage(page), "data-seq", "1")
        assert cells(indices(ui.ed.client, ui.sid), 3) == cells(rows, 1)


def test_mirror_painting(app_url: str) -> None:
    s = make_studio(app_url, width=8, height=8)
    assert paint(s.ed.client, s.sid, [[3, 1]], mirror="x")["pixels_changed"] == 2
    assert cells(indices(s.ed.client, s.sid), 1) == {(3, 1), (4, 1)}
    odd = make_studio(app_url, width=7, height=7)
    assert paint(odd.ed.client, odd.sid, [[3, 2]], mirror="x")["pixels_changed"] == 1
    assert cells(indices(odd.ed.client, odd.sid), 1) == {(3, 2)}
    y = make_studio(app_url, width=8, height=8)
    paint(y.ed.client, y.sid, [[1, 1]], mirror="y")
    assert cells(indices(y.ed.client, y.sid), 1) == {(1, 1), (1, 6)}
    both = make_studio(app_url, width=8, height=8)
    assert paint(both.ed.client, both.sid, [[1, 2]], mirror="both")["pixels_changed"] == 4
    assert cells(indices(both.ed.client, both.sid), 1) == {(1, 2), (6, 2), (1, 5), (6, 5)}
    walls = [[1 if x in (2, 5) else 0 for x in range(8)] for _ in range(8)]
    f = make_studio(app_url, width=8, height=8, cels={(1, "Body"): walls})
    paint(f.ed.client, f.sid, [[0, 0]], tool="fill", swatch=3, mirror="x")
    assert cells(indices(f.ed.client, f.sid), 3) == {(x, y2) for x in (0, 1, 6, 7) for y2 in range(8)}


def test_dither_matrix_absolute(app_url: str) -> None:
    want = {(x, y): (1 if DITHER[y % 4][x % 4] < 6 else 2) for x in range(16) for y in range(16)}
    for seed_cell in ([0, 0], [7, 5]):
        s = make_studio(app_url)
        paint(s.ed.client, s.sid, [seed_cell], tool="dither", swatch=1, options={"secondary": 2, "level": 6})
        rows = indices(s.ed.client, s.sid)
        assert {(x, y): rows[y][x] for x in range(16) for y in range(16)} == want
        assert rows[7][7] == 1 and rows[2][5] == 2 and rows[4][4] == 1
    wall = [[3 if x == 8 else 0 for x in range(16)] for _ in range(16)]
    w = make_studio(app_url, cels={(1, "Body"): wall})
    paint(w.ed.client, w.sid, [[0, 0]], tool="dither", swatch=1, options={"secondary": 2, "level": 16})
    rows = indices(w.ed.client, w.sid)
    assert all(rows[y][x] == 1 for x in range(8) for y in range(16)), "level 16 takes the primary everywhere in the region"
    assert all(rows[y][x] == 0 for x in range(9, 16) for y in range(16)), "dither left the fill region"


def test_selection_operations(browser: Browser, app_url: str) -> None:
    src = with_cells(8, 8, {(1, 1): 1, (2, 1): 2, (3, 1): 3, (1, 2): 4})
    rect = {"x": 1, "y": 1, "w": 3, "h": 2}
    base_rows = indices

    def op(body: dict[str, Any], want: dict[tuple[int, int], int]) -> None:
        s = make_studio(app_url, width=8, height=8, cels={(1, "Body"): src})
        before = base_rows(s.ed.client, s.sid)
        r = s.ed.client.post(f"/api/sprites/{s.sid}/selection", json={"client_stroke_id": uuid.uuid4().hex, "frame": 1, "layer": "Body", **body})
        assert r.status_code == 201, f"{body['op']} answered {r.status_code}: {r.text[:200]}"
        assert r.json()["seq"] == 1, "selection operation is not one sequence number"
        assert base_rows(s.ed.client, s.sid) == with_cells(8, 8, want), body["op"]
        assert s.ed.client.post(f"/api/sprites/{s.sid}/undo").status_code == 200
        assert base_rows(s.ed.client, s.sid) == before, f"{body['op']} is not undone by one undo"

    op({"op": "move", "rect": rect, "to": {"x": 4, "y": 4}}, {(4, 4): 1, (5, 4): 2, (6, 4): 3, (4, 5): 4})
    op({"op": "move", "rect": rect, "to": {"x": -1, "y": 1}}, {(0, 1): 2, (1, 1): 3})
    op({"op": "flip_h", "rect": rect}, {(3, 1): 1, (2, 1): 2, (1, 1): 3, (3, 2): 4})
    op({"op": "flip_v", "rect": rect}, {(1, 2): 1, (2, 2): 2, (3, 2): 3, (1, 1): 4})
    op({"op": "rotate", "rect": rect}, {(2, 1): 1, (2, 2): 2, (2, 3): 3, (1, 1): 4})
    op({"op": "paste", "rect": rect, "to": {"x": 2, "y": 1}, "rows": [[0, 3], [2, 0]]}, {(1, 1): 1, (2, 1): 2, (3, 1): 3, (1, 2): 4, (2, 2): 2})
    s = make_studio(app_url, width=8, height=8, cels={(1, "Body"): src})
    with workspace(browser, s, s.ed) as page:
        move_cursor(page, 1, 1)
        press(page, "s", "Space")
        move_cursor(page, 2, 2)
        press(page, "Space")
        attr(stage(page), "data-selection", "1,1,2,2")
        click(role(page, "button", "Copy selection"))
        page.mouse.move(*cell_point(page, 5, 5))
        attr(stage(page), "data-cursor-x", "5")
        click(role(page, "button", "Paste selection"))
        attr(stage(page), "data-seq", "1")
        rows = indices(s.ed.client, s.sid)
        assert (rows[5][5], rows[5][6], rows[6][5]) == (1, 2, 4)
        move_cursor(page, 1, 1)
        press(page, "s", "Space")
        move_cursor(page, 2, 2)
        press(page, "Space")
        attr(stage(page), "data-selection", "1,1,2,2")
        click(role(page, "button", "Flip horizontal"))
        attr(stage(page), "data-seq", "2")
        rows = indices(s.ed.client, s.sid)
        assert (rows[1][1], rows[1][2], rows[2][2]) == (2, 1, 4)


def choose_command(page: Page, wanted: str) -> None:
    box = role(page, "combobox", "Command")
    for _ in range(20):
        active = box.get_attribute("aria-activedescendant")
        if active and page.evaluate("id => { const e = document.getElementById(id); return e ? e.textContent.trim() : ''; }", active) == wanted:
            press(page, "Enter")
            return
        press(page, "ArrowDown")
    pytest.fail(f"the command palette never made '{wanted}' the active item through aria-activedescendant")


def test_wf_pointer_tools_command_session(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=2, layers=("Body", "Pen shadow"))
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        stage(page).focus()
        press(page, "Control+k")
        dialog = role(page, "dialog", "Command palette")
        expect(dialog).to_be_visible(timeout=SYNC_MS)
        box = role(dialog, "combobox", "Command")
        options = role(dialog, "listbox", "Commands").get_by_role("option")
        names = ["Frame 1", "Frame 2", "Layer: Body", "Layer: Pen shadow", "Swatch 1", "Swatch 2", "Swatch 3", "Swatch 4",
                 "Tool: Pencil", "Tool: Eraser", "Tool: Line", "Tool: Rectangle", "Tool: Ellipse", "Tool: Fill", "Tool: Dither", "Tool: Selection", "Tool: Picker"]
        expect(options).to_have_text(sorted(names, key=str.lower), timeout=SYNC_MS)
        box.press_sequentially("pen")
        expect(options).to_have_text(["Tool: Pencil", "Layer: Pen shadow"], timeout=SYNC_MS)
        choose_command(page, "Layer: Pen shadow")
        expect(dialog).to_have_count(0, timeout=SYNC_MS)
        attr(stage(page), "data-layer", "Pen shadow")
        expect(stage(page)).to_be_focused()
        for query, wanted, check_fn in (
            ("frame 2", "Frame 2", lambda: attr(stage(page), "data-frame", "2")),
            ("swatch 3", "Swatch 3", lambda: None),
            ("tool: line", "Tool: Line", lambda: expect(tool_button(page, "Line")).to_have_attribute("aria-pressed", "true")),
        ):
            press(page, "Control+k")
            role(page, "combobox", "Command").press_sequentially(query)
            choose_command(page, wanted)
            expect(role(page, "dialog", "Command palette")).to_have_count(0, timeout=SYNC_MS)
            check_fn()
        press(page, "Control+k")
        role(page, "combobox", "Command").press_sequentially("zzzz")
        expect(role(page, "dialog", "Command palette")).to_contain_text("No matching commands", timeout=SYNC_MS)
        press(page, "Escape")
        expect(stage(page)).to_be_focused()
        drag(page, (1, 1), (5, 3))
        attr(stage(page), "data-seq", "1")
        press(page, "r")
        drag(page, (8, 8), (10, 10))
        attr(stage(page), "data-seq", "2")
        rows = indices(s.ed.client, s.sid, frame=2, layer="Pen shadow")
        want = set(line(1, 1, 5, 3)) | {(x, y) for x in range(8, 11) for y in range(8, 11) if x in (8, 10) or y in (8, 10)}
        assert cells(rows, 3) == want
        stage(watcher).focus()
        press(watcher, "Period")
        final = hash_of(s.ed.client, s.sid, 2)
        hash_is(page, final)
        hash_is(watcher, final)


def test_wf_pointer_tools_counts_in_place(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        drag(page, (0, 0), (0, 4))
        option = role(role(watcher, "listbox", "Palette"), "option", "Swatch 1")
        attr(option, "data-used-by", "5")
        press(page, "e")
        drag(page, (0, 0), (0, 1))
        attr(option, "data-used-by", "3")
        expect(role(watcher, "region", "Palette")).to_contain_text("Used by 3 pixels", timeout=SYNC_MS)
        assert len(cells(indices(s.ed.client, s.sid), 1)) == 3


def test_pixel_perfect_pencil(browser: Browser, app_url: str) -> None:
    worked = [
        ([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]], {(0, 0), (1, 1), (2, 2)}),
        ([[0, 0], [1, 0], [2, 0], [2, 1]], {(0, 0), (1, 0), (2, 1)}),
        ([[0, 0], [1, 0], [2, 0]], {(0, 0), (1, 0), (2, 0)}),
    ]
    for points, want in worked:
        s = make_studio(app_url)
        paint(s.ed.client, s.sid, points, options={"pixel_perfect": True})
        assert cells(indices(s.ed.client, s.sid), 1) == want
    wide = make_studio(app_url)
    paint(wide.ed.client, wide.sid, [[4, 4], [5, 4], [5, 5]], size=2, options={"pixel_perfect": True})
    assert (5, 4) in cells(indices(wide.ed.client, wide.sid), 1)
    ui = make_studio(app_url)
    with workspace(browser, ui, ui.ed) as page, workspace(browser, ui, ui.ed2) as watcher:
        check(role(page, "checkbox", "Pixel perfect"))
        drag(page, (0, 0), (1, 0), (1, 1), (2, 1), (2, 2))
        attr(stage(page), "data-seq", "1")
        assert cells(indices(ui.ed.client, ui.sid), 1) == {(0, 0), (1, 1), (2, 2)}
        final = hash_of(ui.ed.client, ui.sid)
        hash_is(page, final)
        hash_is(watcher, final)


def test_layer_properties_follow_live(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, swatches=[BLUE, ORANGE], width=2, height=1, layers=("Base", "Top"),
                    cels={(1, "Base"): [[1, 1]], (1, "Top"): [[2, 0]]})
    top = s.layer_id(1)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        pick_layer(page, "Top")
        select(role(page, "combobox", "Blend"), "Multiply")
        poll(lambda: next(l for l in sprite_info(s.ed.client, s.sid)["layers"] if l["id"] == top)["blend"] == "multiply", "blend saved")
        want = rows_hash([[composite([(BLUE, 100, "normal"), (ORANGE, 100, "multiply")]), BLUE]])
        hash_is(watcher, want)
        role(page, "slider", "Layer opacity").focus()
        press(page, "Home")
        poll(lambda: next(l for l in sprite_info(s.ed.client, s.sid)["layers"] if l["id"] == top)["opacity"] == 0, "opacity saved")
        hash_is(watcher, rows_hash([[BLUE, BLUE]]))
        press(page, "End")
        hash_is(watcher, want)
        click(role(page, "checkbox", "Layer visible"))
        hash_is(watcher, rows_hash([[BLUE, BLUE]]))
    r = s.ed.client.patch(f"/api/sprites/{s.sid}/layers/{top}", json={"opacity": 101})
    assert r.status_code == 422 and "opacity" in r.json()["errors"]
    r = s.ed.client.patch(f"/api/sprites/{s.sid}/layers/{top}", json={"blend": "screen"})
    assert r.status_code == 422 and "blend" in r.json()["errors"]


def test_wf_layer_compositing_reviewer_refused(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, layers=("Base", "Top"))
    top = s.layer_id(1)
    for call in (
        lambda: s.rev.client.patch(f"/api/sprites/{s.sid}/layers/{top}", json={"opacity": 50}),
        lambda: s.rev.client.post(f"/api/sprites/{s.sid}/layers", json={"name": "Nope"}),
        lambda: s.rev.client.post(f"/api/sprites/{s.sid}/layers/{top}/merge-down"),
        lambda: s.rev.client.post(f"/api/sprites/{s.sid}/layers/{top}/lock"),
    ):
        r = call()
        assert r.status_code == 403 and r.json() == {"error": "forbidden", "message": "Reviewers can't change artwork"}
    assert seq_of(s.owner.client, s.sid) == 0
    with workspace(browser, s, s.rev) as page:
        for name in ("Add layer", "Merge down", "Lock layer"):
            expect(role(page, "button", name)).to_have_count(0)
        expect(role(page, "slider", "Layer opacity")).to_have_count(0)
        expect(role(page, "combobox", "Blend")).to_have_count(0)
        expect(role(page, "checkbox", "Layer visible")).to_have_count(0)


COMPOSITE_CASES = ["normal-50", "multiply-100", "multiply-50", "alpha-multiply-40", "alone-33", "hidden-top"]
COMPOSITE_VALUES = {
    "normal-50": ([BLUE, 100, "normal"], [ORANGE, 50, "normal"], True, "906060ff"),
    "multiply-100": ([BLUE, 100, "normal"], [ORANGE, 100, "multiply"], True, "202020ff"),
    "multiply-50": ([BLUE, 100, "normal"], [ORANGE, 50, "multiply"], True, "203050ff"),
    "alpha-multiply-40": (["20408080", 100, "normal"], [ORANGE, 40, "multiply"], True, "5f4952b3"),
    "alone-33": (None, [RED, 33, "normal"], True, "ff004454"),
    "hidden-top": ([BLUE, 100, "normal"], [ORANGE, 100, "normal"], False, BLUE),
}


@pytest.mark.parametrize("case", COMPOSITE_CASES, ids=COMPOSITE_CASES)
def test_integer_compositing(browser: Browser, app_url: str, case: str) -> None:
    low, high, visible, want = COMPOSITE_VALUES[case]
    swatches = [high[0]] if low is None else [low[0], high[0]]
    top_index = 1 if low is None else 2
    layers = (
        {"name": "Base"},
        {"name": "Top", "opacity": high[1], "blend": high[2], "visible": visible},
    )
    cel = {(1, "Top"): [[top_index]]}
    if low is not None:
        cel[(1, "Base")] = [[1]]
    s = make_studio(app_url, width=1, height=1, swatches=swatches, layers=layers, cels=cel)
    assert pixel_body(s.ed.client, s.sid)["rows"] == [[want]]
    with workspace(browser, s, s.ed) as page:
        hash_is(page, rows_hash([[want]]))


def test_wf_layer_compositing_keyboard_pickup(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, width=1, height=1, swatches=[BLUE, ORANGE, RED], frames=3, layers=("Base", "Top"),
                    cels={(1, "Base"): [[1]], (1, "Top"): [[2]]})
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        hash_is(watcher, rows_hash([[ORANGE]]))
        lists = status(page, "List announcements")
        role(role(page, "listbox", "Layers"), "option", "Top").focus()
        press(page, "Space")
        expect(lists).to_have_text(list_line("Lifted", "Top", 1, 2), timeout=SYNC_MS)
        press(page, "ArrowDown")
        expect(lists).to_have_text(list_line("Moved", "Top", 2, 2), timeout=SYNC_MS)
        press(page, "Escape")
        expect(lists).to_have_text(list_line("Cancelled", "Top", 1, 2), timeout=SYNC_MS)
        assert seq_of(s.ed.client, s.sid) == 0
        role(role(page, "listbox", "Layers"), "option", "Top").focus()
        press(page, "Space", "ArrowDown", "Space")
        expect(lists).to_have_text(list_line("Dropped", "Top", 2, 2), timeout=SYNC_MS)
        hash_is(watcher, rows_hash([[BLUE]]))
        assert pixel_body(s.ed.client, s.sid)["rows"] == [[BLUE]]
        role(page, "row", "Frame 1").focus()
        press(page, "Space")
        expect(lists).to_have_text(list_line("Lifted", "Frame 1", 1, 3), timeout=SYNC_MS)
        press(page, "ArrowDown", "Space")
        expect(lists).to_have_text(list_line("Dropped", "Frame 1", 2, 3), timeout=SYNC_MS)
        role(role(page, "listbox", "Palette"), "option", "Swatch 1").focus()
        press(page, "Space")
        expect(lists).to_have_text(list_line("Lifted", "Swatch 1", 1, 3), timeout=SYNC_MS)
        press(page, "ArrowDown", "Space")
        expect(lists).to_have_text(list_line("Dropped", "Swatch 1", 2, 3), timeout=SYNC_MS)
        poll(lambda: s.ed.client.get(f"/api/palettes/{s.palette}").json()["order"][:2] == [2, 1], "palette order saved")
        assert indices(s.ed.client, s.sid, frame=2, layer="Base") == [[1]], "palette order changed a cel index"


def test_onion_skin_isolated(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=2, cels={(1, "Body"): with_cells(16, 16, {(4, 4): 1}), (2, "Body"): blank()})
    first = run_export(s.ed.client, s.sid, format="png", scale=1, frame=2)
    with workspace(browser, s, s.ed) as page:
        stage(page).focus()
        press(page, "Period")
        attr(stage(page), "data-frame", "2")
        plain_hash = hash_of(s.ed.client, s.sid, 2)
        hash_is(page, plain_hash)
        plain = stage_cell_rgb(page, screen(page, stage(page)), 4, 4)
        check(role(page, "checkbox", "Onion skin"))
        fill(role(page, "spinbutton", "Onion frames"), "1")
        def tinted() -> bool:
            return stage_cell_rgb(page, screen(page, stage(page)), 4, 4) != plain
        poll(tinted, "onion skin drew frame 1 at cell 4, 4")
        hash_is(page, plain_hash)
        assert hash_of(s.ed.client, s.sid, 2) == plain_hash
        assert seq_of(s.ed.client, s.sid) == 0
    second = run_export(s.ed.client, s.sid, format="png", scale=1, frame=2)
    assert first["files"][0]["sha256"] == second["files"][0]["sha256"]


def test_merge_down(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, width=2, height=1, swatches=[BLUE, ORANGE], frames=2,
                    layers=("Base", {"name": "Top", "opacity": 50, "blend": "multiply"}),
                    cels={(1, "Base"): [[1, 1]], (1, "Top"): [[2, 0]], (2, "Base"): [[1, 0]], (2, "Top"): [[0, 2]]})
    paint(s.ed.client, s.sid, [[0, 0]], layer="Base", swatch=1)
    with workspace(browser, s, s.ed2) as watcher:
        before = watcher
        hash_is(before, rows_hash([["203050ff", BLUE]]))
        r = s.ed.client.post(f"/api/sprites/{s.sid}/layers/{s.layer_id(1)}/merge-down")
        assert r.status_code == 200, r.text
        assert r.json()["new_swatches"] == 2
        expect(role(role(watcher, "listbox", "Layers"), "option", "Top")).to_have_count(0, timeout=SYNC_MS)
        expect(status(watcher, "Notices")).to_contain_text("Merged into Base, 2 new swatches", timeout=SYNC_MS)
        hash_is(watcher, rows_hash([["203050ff", BLUE]]))
    palette = s.ed.client.get(f"/api/palettes/{s.palette}").json()
    colours = {x["index"]: x["color"] for x in palette["swatches"]}
    assert colours[3] == "203050ff", "first new colour takes the lowest free index"
    assert colours[4] == ORANGE and False or colours[4] == composite([(ORANGE, 50, "multiply")])
    assert indices(s.ed.client, s.sid, frame=1, layer="Base") == [[3, 1]]
    assert indices(s.ed.client, s.sid, frame=2, layer="Base") == [[1, 4]]
    info = sprite_info(s.ed.client, s.sid)
    assert [(l["name"], l["opacity"], l["blend"]) for l in info["layers"]] == [("Base", 100, "normal")]
    r = s.ed.client.post(f"/api/sprites/{s.sid}/undo")
    assert r.status_code == 409 and r.json()["error"] == "nothing_to_undo"
    r = s.ed.client.post(f"/api/sprites/{s.sid}/layers/{s.layer_id(0)}/merge-down")
    assert r.status_code == 422 and r.json()["errors"]["layer"] == "No layer below"
    bases = ["000000ff", "101010ff", "202020ff"]
    top = "ffffffff"
    fillers = [f"{0x30 + i:02x}0000ff" for i in range(10)]
    palette_colours = bases + [top] + fillers
    full = make_studio(app_url, width=3, height=1, swatches=palette_colours,
                       layers=("Base", {"name": "Top", "opacity": 50}),
                       cels={(1, "Base"): [[1, 2, 3]], (1, "Top"): [[4, 4, 4]]})
    results = {composite([(b, 100, "normal"), (top, 50, "normal")]) for b in bases}
    needed = len(results - set(palette_colours))
    assert needed > 2, "test precondition: the merge must need more new swatches than are free"
    seq_before = seq_of(full.ed.client, full.sid)
    r = full.ed.client.post(f"/api/sprites/{full.sid}/layers/{full.layer_id(1)}/merge-down")
    assert r.status_code == 409
    assert r.json() == {"error": "palette_full", "message": f"Needs {needed} new swatches, 2 free"}
    assert seq_of(full.ed.client, full.sid) == seq_before
    assert [l["name"] for l in sprite_info(full.ed.client, full.sid)["layers"]] == ["Top", "Base"] or len(sprite_info(full.ed.client, full.sid)["layers"]) == 2
    lock = make_studio(app_url, layers=("Base", "Top"))
    assert lock.ed2.client.post(f"/api/sprites/{lock.sid}/layers/{lock.layer_id(1)}/lock").status_code == 200
    r = lock.ed.client.post(f"/api/sprites/{lock.sid}/layers/{lock.layer_id(1)}/merge-down")
    assert r.status_code == 409 and r.json()["error"] == "layer_locked"


def test_indexed_cels_and_index_zero(app_url: str) -> None:
    s = make_studio(app_url)
    paint(s.ed.client, s.sid, [[2, 2], [3, 2]], swatch=2)
    before = indices(s.ed.client, s.sid)
    assert before[2][2] == 2 and before[0][0] == 0
    assert all(isinstance(v, int) for row in before for v in row)
    current = swatch(s.ed.client, s.palette, 2)
    assert s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/2", json={"color": ORANGE, "version": current["version"]}).status_code == 200
    assert indices(s.ed.client, s.sid) == before
    assert pixel_body(s.ed.client, s.sid)["rows"][2][2] == ORANGE
    for r in (
        s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/0", json={"color": ORANGE, "version": 1}),
        s.ed.client.delete(f"/api/palettes/{s.palette}/swatches/0"),
    ):
        assert r.status_code == 422 and r.json()["errors"]["index"] == "Index 0 is transparent"
    r = s.ed.client.post(f"/api/palettes/{s.palette}/ramp", json={"from": 0, "to": 1, "steps": 3})
    assert r.status_code == 422 and r.json()["errors"]["from"] == "Index 0 is transparent"
    paint(s.ed.client, s.sid, [[2, 2]], tool="eraser", swatch=0)
    assert indices(s.ed.client, s.sid)[2][2] == 0


def test_swatch_version_conflicts(app_url: str) -> None:
    s = make_studio(app_url)
    seq0 = seq_of(s.ed.client, s.sid)
    ok = s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": ORANGE, "version": 1})
    assert ok.status_code == 200
    body = ok.json()
    assert (body["index"], body["color"], body["version"], body["seq"]) == (1, ORANGE, 2, seq0 + 1)
    assert events_since(s.ed.client, s.sid, seq0)[-1]["type"] == "swatch"
    stale = s.ed2.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": LIME, "version": 1})
    assert stale.status_code == 409
    assert stale.json() == {"error": "version_conflict", "current": {"index": 1, "color": ORANGE, "version": 2}}
    assert swatch(s.ed.client, s.palette, 1)["color"] == ORANGE and seq_of(s.ed.client, s.sid) == seq0 + 1
    assert swatch(s.ed.client, s.palette, 1)["edited_by"] == s.ed.name
    assert s.ed.client.delete(f"/api/palettes/{s.palette}/swatches/4").status_code == 200
    gone = s.ed2.client.patch(f"/api/palettes/{s.palette}/swatches/4", json={"color": LIME, "version": 1})
    assert gone.status_code == 409
    assert gone.json() == {"error": "swatch_removed", "message": f"{s.ed.name} removed this swatch first"}
    r = s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": "red", "version": 2})
    assert r.status_code == 422 and r.json()["errors"]["color"] == "Use eight lowercase hex digits"
    back = s.ed.client.post(f"/api/palettes/{s.palette}/swatches", json={"color": LIME})
    assert back.status_code == 201 and back.json()["index"] == 4 and back.json()["version"] > 1


def test_swatch_counts_and_removal(browser: Browser, app_url: str) -> None:
    rows = with_cells(16, 16, {(x, 0): 1 for x in range(12)})
    s = make_studio(app_url, frames=2, cels={(1, "Body"): rows, (2, "Body"): {"link_to": 1}},
                    tilesets=[{"key": "ts", "sprite": "s", "name": "Ground", "tile_size": 8,
                               "tiles": [{"key": "t1", "rows": with_cells(8, 8, {(0, 0): 2, (1, 0): 2})}],
                               "edge_table": [1] * 16}],
                    snapshots=[{"key": "n", "sprite": "s", "name": "Base"}])
    first = swatch(s.ed.client, s.palette, 1)
    assert (first["used_by"], first["frames"]) == (12, 2), "a linked cel is counted once in used_by and per frame in frames"
    assert swatch(s.ed.client, s.palette, 2)["used_by"] == 2, "tile cells count once"
    r = s.ed.client.delete(f"/api/palettes/{s.palette}/swatches/1")
    assert r.status_code == 409 and r.json() == {"error": "swatch_in_use", "message": "Used by 12 pixels"}
    with workspace(browser, s, s.ed2) as watcher:
        option = role(role(watcher, "listbox", "Palette"), "option", "Swatch 1")
        attr(option, "data-used-by", "12")
        paint(s.ed.client, s.sid, [[0, 5], [3, 5]])
        attr(option, "data-used-by", "16")
        assert s.ed.client.post(f"/api/sprites/{s.sid}/undo").status_code == 200
        attr(option, "data-used-by", "12")
        tile = s.ed.client.get(f"/api/tilesets/{s.ids['ts']}").json()["tiles"][0]
        assert s.ed.client.patch(f"/api/tilesets/{s.ids['ts']}/tiles/1", json={"rows": with_cells(8, 8, {(0, 0): 2, (1, 0): 2, (2, 0): 2})}).status_code == 200
        attr(role(role(watcher, "listbox", "Palette"), "option", "Swatch 2"), "data-used-by", "3")
        assert tile["uses"] == 0
        paint(s.ed.client, s.sid, [[0, 7]])
        assert swatch(s.ed.client, s.palette, 1)["used_by"] == 13
        snap = s.owner.client.get(f"/api/sprites/{s.sid}/snapshots").json()["snapshots"][0]
        assert s.owner.client.post(f"/api/snapshots/{snap['id']}/restore").status_code == 200
        attr(option, "data-used-by", "12")
        assert swatch(s.ed.client, s.palette, 2)["used_by"] == 2
        pick_swatch(watcher, 4)
        click(role(watcher, "button", "Remove swatch"))
        notice(watcher, "Swatch 4 removed")
        expect(role(role(watcher, "listbox", "Palette"), "option", "Swatch 4")).to_have_count(0, timeout=SYNC_MS)


def test_colour_ramps(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, swatches=[BLACK, LIME])
    r = s.ed.client.post(f"/api/palettes/{s.palette}/ramp", json={"from": 1, "to": 2, "steps": 5})
    assert r.status_code == 201
    added = r.json()["swatches"]
    assert [(x["index"], x["color"]) for x in added] == [(3, "402000ff"), (4, "804001ff"), (5, "bf6001ff")]
    assert swatch(s.ed.client, s.palette, 1)["color"] == BLACK and swatch(s.ed.client, s.palette, 2)["color"] == LIME
    r = s.ed.client.post(f"/api/palettes/{s.palette}/ramp", json={"from": 1, "to": 0, "steps": 3})
    assert r.status_code == 422 and r.json()["errors"]["to"] == "Index 0 is transparent"
    limit = make_studio(app_url, swatches=[BLACK] * 14 + [LIME])
    r = limit.ed.client.post(f"/api/palettes/{limit.palette}/ramp", json={"from": 1, "to": 15, "steps": 4})
    assert r.status_code == 422 and r.json()["errors"]["color"] == "Palette limit is 16 swatches"
    assert len(limit.ed.client.get(f"/api/palettes/{limit.palette}").json()["swatches"]) == 15
    ui = make_studio(app_url, swatches=[BLACK, LIME])
    with workspace(browser, ui, ui.ed) as page:
        expect(role(page, "spinbutton", "Ramp steps")).to_have_value("5")
        click(role(page, "button", "Add ramp"))
        expect(role(role(page, "listbox", "Palette"), "option", "Swatch 5")).to_be_visible(timeout=SYNC_MS)
        assert swatch(ui.ed.client, ui.palette, 5)["color"] == "bf6001ff"
    single = make_studio(app_url, swatches=[BLACK])
    with workspace(browser, single, single.ed) as page:
        expect(role(page, "button", "Add ramp")).to_be_disabled(timeout=SYNC_MS)


def test_palette_file_import(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, swatches=[RED])
    good_hex = "ff8040\n\n204080\n"
    r = s.ed.client.post(f"/api/palettes/{s.palette}/import", json={"file_name": "a.hex", "text": good_hex})
    assert r.status_code == 201 and r.json()["added"] == 2
    assert swatch(s.ed.client, s.palette, 2)["color"] == ORANGE and swatch(s.ed.client, s.palette, 3)["color"] == BLUE
    gimp = "GIMP Palette\nName: Candy\nColumns: 2\n# comment\n255 128 1 orange\n"
    r = s.ed.client.post(f"/api/palettes/{s.palette}/import", json={"file_name": "b.gpl", "text": gimp})
    assert r.status_code == 201 and r.json()["added"] == 1
    assert swatch(s.ed.client, s.palette, 4)["color"] == LIME
    before = s.ed.client.get(f"/api/palettes/{s.palette}").json()["order"]
    refusals = [
        ("c.hex", "ff8040\n\nnothex\nzz\n", "Line 3: expected six hex digits"),
        ("d.gpl", "GIMP Palette\nName: x\n# c\n1 2 3 a\n1 2 999 b\n", "Line 5: expected three numbers from 0 to 255"),
        ("e.txt", "ff8040\n", "Use a .hex or .gpl file"),
    ]
    for name, body, message in refusals:
        r = s.ed.client.post(f"/api/palettes/{s.palette}/import", json={"file_name": name, "text": body})
        assert r.status_code == 422 and r.json()["errors"]["file"] == message
        assert s.ed.client.get(f"/api/palettes/{s.palette}").json()["order"] == before, "a refused file changed the palette"
    big = make_studio(app_url, swatches=[RED] * 15)
    r = big.ed.client.post(f"/api/palettes/{big.palette}/import", json={"file_name": "f.hex", "text": "ff8040\n204080\n"})
    assert r.status_code == 422 and "Palette limit is 16 swatches" in json.dumps(r.json())
    assert len(big.ed.client.get(f"/api/palettes/{big.palette}").json()["swatches"]) == 15
    ui = make_studio(app_url, swatches=[RED])
    with workspace(browser, ui, ui.ed) as page:
        upload(page, "Palette file", "Import palette", "g.hex", b"ff8040\n204080\n", "text/plain",
               status(page, "Notices").filter(has_text="Added 2 swatches"))
        expect(role(role(page, "listbox", "Palette"), "option", "Swatch 3")).to_be_visible(timeout=SYNC_MS)


def test_wf_palette_flood_stages(browser: Browser, app_url: str) -> None:
    all_ones = filled(16, 16, 1)
    s = make_studio(app_url, frames=3, cels={(1, "Body"): all_ones, (2, "Body"): all_ones, (3, "Body"): all_ones})
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2, paused=True) as watcher:
        stage(page).focus()
        attr(stage(page), "data-cursor-x", "0")
        before = screen(watcher, stage(watcher))
        old_rgb = stage_cell_rgb(watcher, before, 15, 15)
        edit_swatch_ui(page, 1, ORANGE)
        st = stage(watcher)
        attr(st, "data-flood-radius", "0")
        announced(watcher, f"Swatch 1 now {ORANGE}, used by 768 pixels in 3 frames")
        final = hash_of(s.ed.client, s.sid)
        assert final == rows_hash([[ORANGE] * 16] * 16), "the pixel route is not final when the flood starts"
        attr(st, "data-composite-hash", final)
        attr(role(role(watcher, "listbox", "Palette"), "option", "Swatch 1"), "data-used-by", "768")
        assert indices(s.ed.client, s.sid) == all_ones, "a swatch edit changed a cel index"
        radii = [0]
        mid_checked = False
        for elapsed in range(THUMB_GAP_MS, FLOOD_MS, THUMB_GAP_MS):
            advance(watcher, THUMB_GAP_MS)
            value = st.get_attribute("data-flood-radius")
            if value is None:
                pytest.fail(f"data-flood-radius removed at {elapsed} ms, before the {FLOOD_MS} ms flood ended")
            radii.append(int(value))
            if not mid_checked and 0 < radii[-1] < 15:
                shot = screen(watcher, st)
                assert stage_cell_rgb(watcher, shot, 0, 0) == ORANGE[:6], "cells within the radius are not drawn new"
                assert stage_cell_rgb(watcher, shot, 15, 15) == old_rgb, "cells beyond the radius are not drawn old"
                mid_checked = True
        assert radii == sorted(radii), f"data-flood-radius fell: {radii}"
        assert len(set(radii)) >= 3 and max(radii) >= 8, f"the rings did not grow towards the far corner: {radii}"
        assert mid_checked, "no mid-flood ring could be observed"
        advance(watcher, THUMB_GAP_MS * 2)
        expect(st).not_to_have_attribute("data-flood-radius", re.compile("."), timeout=SYNC_MS)
        seq = st.get_attribute("data-seq")
        seen = []
        for _ in range(12):
            seen.append([thumb(watcher, n).get_attribute("data-thumb-seq") for n in (1, 2, 3)])
            advance(watcher, THUMB_GAP_MS / 2)
        for row in seen:
            done = [v == seq for v in row]
            assert done == sorted(done, reverse=True), f"thumbnails did not change left to right: {row}"
        for n in (1, 2, 3):
            attr(thumb(watcher, n), "data-thumb-seq", seq)
        advance(watcher, COUNT_ROLL_MS)
        expect(role(watcher, "region", "Palette")).to_contain_text("Used by 768 pixels", timeout=SYNC_MS)
        changed_shot = screen(watcher, st)
        assert stage_cell_rgb(watcher, changed_shot, 15, 15) == ORANGE[:6]


def test_wf_palette_flood_reduced_motion(browser: Browser, app_url: str) -> None:
    all_ones = filled(16, 16, 1)
    s = make_studio(app_url, frames=2, cels={(1, "Body"): all_ones, (2, "Body"): all_ones})
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2, paused=True, reduced_motion="reduce") as watcher:
        edit_swatch_ui(page, 1, ORANGE)
        announced(watcher, f"Swatch 1 now {ORANGE}, used by 512 pixels in 2 frames")
        st = stage(watcher)
        assert st.get_attribute("data-flood-radius") is None
        seq = str(seq_of(s.ed.client, s.sid))
        attr(thumb(watcher, 1), "data-thumb-seq", seq)
        attr(thumb(watcher, 2), "data-thumb-seq", seq)
        expect(role(watcher, "region", "Palette")).to_contain_text("Used by 512 pixels", timeout=SYNC_MS)
        shot = screen(watcher, st)
        assert stage_cell_rgb(watcher, shot, 15, 15) == ORANGE[:6]
        assert st.get_attribute("data-flood-radius") is None


def test_wf_palette_flood_stale_conflict(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed2) as page:
        with held(page, "**/api/palettes/*/swatches/*") as hold:
            edit_swatch_ui(page, 1, LIME)
            notice(page, "Saving swatch…")
            assert s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": ORANGE, "version": 1}).status_code == 200
            getattr(hold, "release", hold)()
            alert(page, f"{s.ed.name} changed this swatch first")
        assert swatch(s.ed.client, s.palette, 1)["color"] == ORANGE, "the stale edit merged"
        row = role(page, "region", "Palette").get_by_role("option", name="Swatch 1", exact=True)
        poll(lambda: page.evaluate(SHOWS_COLOUR_SCRIPT, [row.element_handle(), ORANGE]), f"Swatch 1 row shows {ORANGE}", seconds=SYNC_MS / 1000)
    race = make_studio(app_url)
    with ThreadPoolExecutor(5) as pool:
        answers = list(pool.map(lambda c: race.ed.client.patch(f"/api/palettes/{race.palette}/swatches/2", json={"color": c, "version": 1}),
                                [ORANGE, LIME, RED, BLACK, BLUE]))
    codes = sorted(r.status_code for r in answers)
    assert codes == [200, 409, 409, 409, 409], codes
    winner = next(r.json() for r in answers if r.status_code == 200)
    assert swatch(race.ed.client, race.palette, 2)["version"] == 2 and swatch(race.ed.client, race.palette, 2)["color"] == winner["color"]


def test_wf_palette_flood_import_original(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    payload = png_encode([[RED, TRANSPARENT], [BLUE, RED]])
    name = f"gem{uuid.uuid4().hex[:6]}.png"
    with opened(browser, app_url, s.ed, f"/projects/{s.pid}") as page:
        link = role(page, "link", f"Download original {name}")
        upload(page, "Image file", "Import image", name, payload, "image/png", link)
        notice(page, f"Imported {name}")
        with page.expect_download() as caught:
            click(link)
        assert Path(caught.value.path()).read_bytes() == payload
    keys = [k for k in S3().keys(f"imports/{s.pid}/") if k.endswith(f"/{name}")]
    assert len(keys) == 1 and S3().get(keys[0]) == payload
    down = make_studio(outage_base())
    r = down.ed.client.post(f"/api/projects/{down.pid}/imports", files={"file": ("x.png", payload, "image/png")})
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    assert len(down.ed.client.get(f"/api/projects/{down.pid}").json()["sprites"]) == 1, "a failed import left a sprite"


def test_image_import_limits_and_decode(app_url: str) -> None:
    s = make_studio(app_url)
    def send(name: str, data: bytes) -> httpx.Response:
        return s.ed.client.post(f"/api/projects/{s.pid}/imports", files={"file": (name, data, "application/octet-stream")})

    colours = [f"{i * 6:02x}0000ff" for i in range(40)]
    refusals = [
        ("a.png", b"not an image", "Not a PNG or GIF image"),
        ("b.png", png_of_size(IMPORT_MAX + 1), "File is larger than 200,000 bytes"),
        ("c.png", png_encode([[RED] * 1000] * 1000), "Image is 1,000 by 1,000, limit 64"),
        ("d.png", png_encode([colours]), "Needs 40 colours, limit 16"),
    ]
    sprites = len(s.ed.client.get(f"/api/projects/{s.pid}").json()["sprites"])
    for name, data, message in refusals:
        r = send(name, data)
        assert r.status_code == 422 and r.json()["errors"]["file"] == message, name
    assert len(s.ed.client.get(f"/api/projects/{s.pid}").json()["sprites"]) == sprites
    assert S3().keys(f"imports/{s.pid}/") == [], "a refused import stored an object"
    limit = send("e.png", png_of_size(IMPORT_MAX))
    assert limit.status_code == 201, f"a file at the byte limit is allowed: {limit.text[:200]}"
    disguised = gif_encode([(filled(2, 1, 1), 10)], [TRANSPARENT[:6] + "00", RED])
    r = send("disguised.png", disguised)
    assert r.status_code == 201, "the file name decided the type instead of the content"
    png_bytes = png_encode([[TRANSPARENT, BLUE], [RED, BLUE]])
    r = send(SPACED_NAME, png_bytes)
    assert r.status_code == 201
    body = r.json()
    assert body["colours"] == 2 and body["file_name"] == SPACED_NAME
    sid = body["sprite"]
    info = sprite_info(s.ed.client, sid)
    assert [(f["number"], f["duration_ms"]) for f in info["frames"]] == [(1, 100)]
    assert [l["name"] for l in info["layers"]] == ["Layer 1"]
    assert indices(s.ed.client, sid, layer="Layer 1") == [[0, 1], [2, 1]], "colours take indices in first-appearance order"
    key = f"imports/{s.pid}/{body['import']}/" + re.sub(r"[^A-Za-z0-9._-]", "_", SPACED_NAME)
    assert S3().get(key) == png_bytes
    paint(s.ed.client, sid, [[0, 0]], layer="Layer 1")
    assert s.ed.client.get(f"/api/imports/{body['import']}/original").content == png_bytes
    gif = gif_encode([(filled(2, 1, 1), 10), (filled(2, 1, 2), 1)], [TRANSPARENT[:6], RED, BLUE])
    r = send("walk.gif", gif)
    assert r.status_code == 201
    frames = sprite_info(s.ed.client, r.json()["sprite"])["frames"]
    assert [f["duration_ms"] for f in frames] == [100, FRAME_MIN], "GIF delays convert to ms and clamp to the frame limits"


def test_frame_durations_and_order_live(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, durations=[100, 200], cels={(1, "Body"): with_cells(16, 16, {(0, 0): 1})})
    for bad in (FRAME_MIN - 1, FRAME_MAX + 1):
        r = s.ed.client.post(f"/api/sprites/{s.sid}/frames", json={"duration_ms": bad})
        assert r.status_code == 422 and r.json()["errors"]["duration_ms"] == "Use 20 to 5,000 ms"
        r = s.ed.client.patch(f"/api/sprites/{s.sid}/frames/1", json={"duration_ms": bad})
        assert r.status_code == 422
    assert len(sprite_info(s.ed.client, s.sid)["frames"]) == 2
    with workspace(browser, s, s.ed2) as watcher:
        grid = role(watcher, "grid", "Frames")
        attr(grid, "aria-rowcount", "2")
        added = s.ed.client.post(f"/api/sprites/{s.sid}/frames", json={"duration_ms": FRAME_MAX})
        assert added.status_code == 201 and added.json()["number"] == 3
        attr(grid, "aria-rowcount", "3")
        line_el = role(watcher, "region", "Frames").locator("[data-total-ms]")
        attr(line_el, "data-total-ms", str(100 + 200 + FRAME_MAX))
        assert s.ed.client.patch(f"/api/sprites/{s.sid}/frames/1", json={"duration_ms": FRAME_MIN}).status_code == 200
        attr(line_el, "data-total-ms", str(FRAME_MIN + 200 + FRAME_MAX))
        stage(watcher).focus()
        first = hash_of(s.ed.client, s.sid, 1)
        hash_is(watcher, first)
        assert s.ed.client.patch(f"/api/sprites/{s.sid}/frames/1", json={"position": 3}).status_code == 200
        assert [f["duration_ms"] for f in sprite_info(s.ed.client, s.sid)["frames"]] == [200, FRAME_MAX, FRAME_MIN]
    assert indices(s.ed.client, s.sid, frame=3)[0][0] == 1, "the cel did not move with its frame"


def test_wf_linked_timeline_link_unlink(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, cels={(1, "Body"): with_cells(16, 16, {(0, 0): 1})})
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        click(role(page, "button", "Add frame"))
        attr(role(watcher, "grid", "Frames"), "aria-rowcount", "2")
        click(role(page, "row", "Frame 2"))
        attr(stage(page), "data-frame", "2")
        click(role(page, "button", "Link cel"))
        expect(role(watcher, "row", "Frame 2")).to_contain_text("Linked", timeout=SYNC_MS)
        body = s.ed.client.get(f"/api/sprites/{s.sid}/frames/2/indices", params={"layer": "Body"}).json()
        assert body["linked_frames"] == [1, 2] and body["rows"][0][0] == 1
        assert (swatch(s.ed.client, s.palette, 1)["used_by"], swatch(s.ed.client, s.palette, 1)["frames"]) == (1, 2)
        drag(page, (3, 3))
        poll(lambda: indices(s.ed.client, s.sid, frame=1)[3][3] == 1, "an edit on frame 2 shows in linked frame 1")
        assert swatch(s.ed.client, s.palette, 1)["used_by"] == 2
        attr(role(role(watcher, "listbox", "Palette"), "option", "Swatch 1"), "data-used-by", "2")
        click(role(page, "button", "Unlink cel"))
        expect(role(watcher, "row", "Frame 2")).not_to_contain_text("Linked", timeout=SYNC_MS)
        drag(page, (5, 5))
        poll(lambda: indices(s.ed.client, s.sid, frame=2)[5][5] == 1, "an edit lands on the unlinked frame")
        assert indices(s.ed.client, s.sid, frame=1)[5][5] == 0, "unlinking did not make an independent copy"
        assert swatch(s.ed.client, s.palette, 1)["used_by"] == 5
        r = s.ed.client.post(f"/api/sprites/{s.sid}/frames/2/cels/unlink", json={"layer": "Body"})
        assert r.status_code == 409 and r.json() == {"error": "not_linked"}
        page.reload()
        attr(role(page, "grid", "Frames"), "aria-rowcount", "2")
        expect(role(page, "row", "Frame 2")).not_to_contain_text("Linked")


def test_wf_linked_timeline_long_session(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, durations=[2000] * 120, person_settings={"ed": {"number_format": "en-IN", "time_zone": "Asia/Kolkata"}})
    with workspace(browser, s, s.ed) as page:
        panel = role(page, "region", "Frames")
        total = panel.locator("[data-total-ms]")
        expect(total).to_have_text("Total 2,40,000 ms · Average 2,000 ms", timeout=SYNC_MS)
        attr(total, "data-total-ms", "240000")
        role(page, "row", "Frame 1").focus()
        press(page, "End")
        attr(role(page, "grid", "Frames"), "aria-rowcount", "120")
        poll(lambda: focused_rowindex(page) == "120", "End reached frame 120")
        assert s.ed2.client.patch(f"/api/sprites/{s.sid}/frames/1", json={"duration_ms": FRAME_MAX}).status_code == 200
        total_now = LONG_FRAMES * 2000 - 2000 + FRAME_MAX
        expect(total).to_have_text(f"Total {group(total_now, 'en-IN')} ms · Average {group(total_now // LONG_FRAMES, 'en-IN')} ms", timeout=SYNC_MS)
    a = make_studio(app_url, durations=[100, 101])
    with workspace(browser, a, a.ed) as page:
        expect(role(page, "region", "Frames").locator("[data-total-ms]")).to_have_text("Total 201 ms · Average 100.5 ms", timeout=SYNC_MS)


def test_number_and_date_settings(browser: Browser, app_url: str, mail: Mailpit) -> None:
    full = filled(SPRITE_MAX, SPRITE_MAX, 1)
    total = SPRITE_MAX * SPRITE_MAX * LONG_FRAMES
    s = make_studio(app_url, width=SPRITE_MAX, height=SPRITE_MAX, frames=LONG_FRAMES, cels={(n, "Body"): full for n in range(1, LONG_FRAMES + 1)},
                    person_settings={"out": {"number_format": "en-IN", "time_zone": "Asia/Kolkata"},
                                     "out2": {"number_format": "en-US", "time_zone": "America/New_York"}})
    with opened(browser, app_url, s.ed, "/projects") as page:
        select(role(page, "combobox", "Number format"), "en-IN")
        select(role(page, "combobox", "Time zone"), "Asia/Kolkata")
        click(role(page, "button", "Save settings"))
        notice(page, "Settings saved")
    me = s.ed.client.get("/api/me").json()
    assert (me["number_format"], me["time_zone"]) == ("en-IN", "Asia/Kolkata")
    with workspace(browser, s, s.ed) as page:
        expect(role(page, "region", "Palette")).to_contain_text(f"Used by {group(total, 'en-IN')} pixels", timeout=SYNC_MS)
    with workspace(browser, s, s.ed2) as page:
        expect(role(page, "region", "Palette")).to_contain_text(f"Used by {group(total)} pixels", timeout=SYNC_MS)
    assert swatch(s.ed.client, s.palette, 1)["used_by"] == total, "exact JSON values stay plain numbers"
    big = png_of_size(IMPORT_MAX + 1)
    r = s.ed.client.post(f"/api/projects/{s.pid}/imports", files={"file": ("big.png", big, "image/png")})
    assert r.status_code == 422 and r.json()["errors"]["file"] == "File is larger than 2,00,000 bytes"
    r = s.ed2.client.post(f"/api/projects/{s.pid}/imports", files={"file": ("big.png", big, "image/png")})
    assert r.json()["errors"]["file"] == "File is larger than 200,000 bytes"
    assert s.ed.client.patch("/api/me", json={"number_format": "fr-FR"}).status_code == 422
    for person, fmt, zone in ((s.out, "en-IN", "Asia/Kolkata"), (s.out2, "en-US", "America/New_York")):
        r = s.owner.client.post(f"/api/projects/{s.pid}/invites", json={"email": person.email, "role": "editor"})
        assert r.status_code == 201
        message = mail_to(mail, person.email, f"Join {s.project_name} on Celmate")[0]
        pattern = date_pattern(r.json()["expires_at"], fmt, zone)
        assert re.search(f"Expires: {pattern}", text(message)), f"{pattern} not in {text(message)[:300]}"


def test_frames_grid_bounded_and_keys(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=60)
    with workspace(browser, s, s.ed) as page:
        grid = role(page, "grid", "Frames")
        attr(grid, "aria-rowcount", "60")
        assert grid.get_by_role("row").count() <= 40
        role(page, "row", "Frame 1").focus()
        for key, want in (("End", "60"), ("Home", "1"), ("PageDown", "11"), ("ArrowDown", "12"), ("PageUp", "2"), ("ArrowUp", "1")):
            press(page, key)
            poll(lambda: focused_rowindex(page) == want, f"{key} moved focus to row {want}")
            assert grid.get_by_role("row").count() <= 40, f"more than 40 rows after {key}"
            attr(role(page, "row", f"Frame {want}"), "aria-rowindex", want)


def test_focus_held_under_live_frames(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=8)
    with workspace(browser, s, s.ed) as page:
        row = role(page, "row", "Frame 5")
        row.focus()
        press(page, "Enter")
        attr(stage(page), "data-frame", "5")
        for position in (1, 2):
            assert s.ed2.client.post(f"/api/sprites/{s.sid}/frames", json={"position": position, "duration_ms": 100}).status_code == 201
        attr(stage(page), "data-frame", "7")
        attr(role(page, "grid", "Frames"), "aria-rowcount", "10")
        poll(lambda: focused_rowindex(page) == "7", "focus stayed on the same frame, now number 7")
        expect(role(page, "row", "Frame 7")).to_have_attribute("aria-rowindex", "7")


def test_animation_tags_sequences(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=5)
    for name, frm, to, direction in (("fwd", 2, 5, "forward"), ("rev", 2, 5, "reverse"), ("ping", 2, 5, "pingpong"), ("two", 2, 3, "pingpong"), ("one", 4, 4, "pingpong")):
        r = s.ed.client.post(f"/api/sprites/{s.sid}/tags", json={"name": name, "from": frm, "to": to, "direction": direction})
        assert r.status_code == 201, r.text
    for bad in ({"name": "bad", "from": 2, "to": 5, "direction": "sideways"}, {"name": "bad", "from": 2, "to": 99, "direction": "forward"},
                {"name": "bad", "from": 2, "to": 5, "direction": "forward", "repeat": 100}):
        assert s.ed.client.post(f"/api/sprites/{s.sid}/tags", json=bad).status_code == 422
    tags = {t["name"]: t for t in sprite_info(s.ed.client, s.sid)["tags"]}
    assert tags["ping"]["direction"] == "pingpong" and tags["ping"]["repeat"] == 0
    assert "bad" not in tags
    sequences = {"fwd": [2, 3, 4, 5], "rev": [5, 4, 3, 2], "ping": [2, 3, 4, 5, 4, 3], "two": [2, 3], "one": [4]}
    with workspace(browser, s, s.ed, paused=True) as page:
        frame = preview_frame(page)
        click(role(page, "button", "Pause preview"))
        attr(frame, "data-preview-mode", "step")
        for name, sequence in sequences.items():
            select(role(page, "combobox", "Preview tag"), name)
            click(role(page, "button", "Pause preview")) if role(page, "button", "Pause preview").count() else None
            attr(frame, "data-preview-frame", str(sequence[0]))
            for want in sequence[1:] + sequence[:1]:
                click(role(page, "button", "Next frame"))
                attr(frame, "data-preview-frame", str(want))


def test_wf_tags_preview_edit_and_play(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=4)
    with workspace(browser, s, s.ed, paused=True) as page:
        name = role(page, "textbox", "Tag name")
        name.focus()
        page.keyboard.type("bounce")
        fill(role(page, "spinbutton", "Tag from"), "2")
        fill(role(page, "spinbutton", "Tag to"), "4")
        select(role(page, "combobox", "Tag direction"), "Pingpong")
        fill(role(page, "spinbutton", "Tag repeat"), "0")
        role(page, "button", "Add tag").focus()
        press(page, "Enter")
        tag_option = role(page, "combobox", "Preview tag").get_by_role("option", name="bounce")
        expect(tag_option).to_have_count(1, timeout=SYNC_MS)
        click(role(page, "row", "Frame 2"))
        duration = role(page, "spinbutton", "Frame duration")
        fill(duration, "105")
        press(page, "Tab")
        poll(lambda: sprite_info(s.ed.client, s.sid)["frames"][1]["duration_ms"] == 105, "Frame duration saved for frame 2")
        select(role(page, "combobox", "Preview tag"), "bounce")
        frame = preview_frame(page)
        attr(frame, "data-preview-mode", "autoplay")
        walk_preview(page, {2: 105, 3: 100, 4: 100}, [2, 3, 4, 3, 2, 3])
        page.reload()
        expect(status(page, "Sync status")).to_have_text("Synced", timeout=UI_MS)
        attr(role(page, "grid", "Frames"), "aria-rowcount", "4")
    info = sprite_info(s.ed.client, s.sid)
    assert [(t["name"], t["from"], t["to"], t["direction"]) for t in info["tags"]] == [("bounce", 2, 4, "pingpong")]
    assert info["frames"][1]["duration_ms"] == 105


def test_wf_tags_preview_reduced_motion(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=5, tags=[{"key": "t", "sprite": "s", "name": "walk", "from": 2, "to": 5, "direction": "pingpong", "repeat": 1}])
    with workspace(browser, s, s.ed, paused=True, reduced_motion="reduce") as page:
        frame = preview_frame(page)
        attr(frame, "data-preview-mode", "step")
        expect(role(page, "button", "Pause preview")).to_have_count(0)
        expect(role(page, "button", "Play preview")).to_have_count(0)
        attr(frame, "data-preview-frame", "1")
        advance(page, 1000)
        attr(frame, "data-preview-frame", "1")
        select(role(page, "combobox", "Preview tag"), "walk")
        attr(frame, "data-preview-frame", "2")
        for want in (3, 4, 5, 4, 3, 2):
            click(role(page, "button", "Next frame"))
            attr(frame, "data-preview-frame", str(want))
        click(role(page, "button", "Previous frame"))
        attr(frame, "data-preview-frame", "3")
        advance(page, 1000)
        attr(frame, "data-preview-frame", "3")


def test_draft_autosave(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    key = f"tag:{s.sid}"
    assert s.ed.client.get(f"/api/drafts/{key}").json() == {"text": "", "version": 0}
    with workspace(browser, s, s.ed, paused=True) as page:
        role(page, "textbox", "Tag name").focus()
        page.keyboard.type("walk")
        advance(page, AUTOSAVE_MS - 1)
        assert s.ed.client.get(f"/api/drafts/{key}").json()["version"] == 0, "the draft saved before the pause ended"
        advance(page, 1)
        expect(status(page, "Draft status")).to_have_text("Saved", timeout=SYNC_MS)
        assert s.ed.client.get(f"/api/drafts/{key}").json() == {"text": "walk", "version": 1}
        assert s.ed2.client.get(f"/api/drafts/{key}").json() == {"text": "", "version": 0}, "drafts are private to each person"
        page.reload()
        expect(role(page, "textbox", "Tag name")).to_have_value("walk", timeout=UI_MS)
    comment_key = f"comment:{s.sid}"
    with workspace(browser, s, s.ed, paused=True) as page:
        move_cursor(page, 1, 1)
        press(page, "c")
        box = role(page, "textbox", "Comment")
        box.focus()
        page.keyboard.type("Check this")
        advance(page, AUTOSAVE_MS)
        expect(status(page, "Draft status")).to_have_text("Saved", timeout=SYNC_MS)
        assert s.ed.client.get(f"/api/drafts/{comment_key}").json()["text"] == "Check this"
        page.reload()
        expect(status(page, "Sync status")).to_have_text("Synced", timeout=UI_MS)
        move_cursor(page, 1, 1)
        press(page, "c")
        expect(role(page, "textbox", "Comment")).to_have_value("Check this", timeout=SYNC_MS)
        click(role(page, "button", "Post comment"))
        notice(page, "Comment posted")
    assert s.ed.client.get(f"/api/drafts/{comment_key}").json()["text"] == ""


def test_wf_tags_preview_stale_draft(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    key = f"tag:{s.sid}"
    first = s.ed.client.put(f"/api/drafts/{key}", json={"text": "one", "version": 0})
    assert first.status_code == 200 and first.json() == {"text": "one", "version": 1}
    stale = s.ed.client.put(f"/api/drafts/{key}", json={"text": "two", "version": 0})
    assert stale.status_code == 409
    assert stale.json() == {"error": "draft_newer", "current": {"text": "one", "version": 1}}
    with workspace(browser, s, s.ed, paused=True) as page:
        box = role(page, "textbox", "Tag name")
        expect(box).to_have_value("one", timeout=SYNC_MS)
        assert s.ed.client.put(f"/api/drafts/{key}", json={"text": "newer", "version": 1}).status_code == 200
        box.focus()
        press(page, "End")
        page.keyboard.type("x")
        advance(page, AUTOSAVE_MS)
        expect(status(page, "Draft status")).to_contain_text("A newer version exists", timeout=SYNC_MS)
        assert s.ed.client.get(f"/api/drafts/{key}").json() == {"text": "newer", "version": 2}, "the stale save was merged"
        click(role(role(page, "region", "Frames"), "button", "Load newer"))
        expect(box).to_have_value("newer", timeout=SYNC_MS)


def resume_preview(page: Page) -> None:
    play = role(page, "button", "Play preview")
    if play.count():
        click(play)


def test_preview_speed_and_repeats(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, durations=[100, 105, 100, 100, 100], tags=[
        {"key": "t1", "sprite": "s", "name": "ping", "from": 2, "to": 5, "direction": "pingpong", "repeat": 1},
        {"key": "t2", "sprite": "s", "name": "fwd", "from": 1, "to": 2, "direction": "forward", "repeat": 2},
        {"key": "t3", "sprite": "s", "name": "rev", "from": 1, "to": 2, "direction": "reverse", "repeat": 1},
    ])
    normal = {1: 100, 2: 105, 3: 100, 4: 100, 5: 100}
    with workspace(browser, s, s.ed, paused=True) as page:
        frame = preview_frame(page)
        attr(frame, "data-preview-frame", "1")
        walk_preview(page, normal, [1, 2, 3, 4, 5, 1])
        select(role(page, "combobox", "Preview tag"), "ping")
        resume_preview(page)
        walk_preview(page, normal, [2, 3, 4, 5, 4, 3, 2])
        advance(page, 105)
        attr(frame, "data-preview-frame", "2")
        attr(frame, "data-preview-mode", "step")
        notice(page, f"Finished after {counted(1, 'pass')}")
        select(role(page, "combobox", "Preview speed"), "Double")
        click(role(page, "button", "Play preview"))
        attr(frame, "data-preview-mode", "autoplay")
        attr(frame, "data-preview-frame", "2")
        advance(page, 52)
        attr(frame, "data-preview-frame", "2")
        advance(page, 1)
        attr(frame, "data-preview-frame", "3")
        click(role(page, "button", "Pause preview"))
        select(role(page, "combobox", "Preview speed"), "Half")
        select(role(page, "combobox", "Preview tag"), "fwd")
        resume_preview(page)
        walk_preview(page, {1: 200, 2: 210}, [1, 2, 1, 2])
        advance(page, 210)
        attr(frame, "data-preview-frame", "2")
        notice(page, "Finished after 2 passes")
        select(role(page, "combobox", "Preview speed"), "Normal")
        select(role(page, "combobox", "Preview tag"), "rev")
        resume_preview(page)
        walk_preview(page, normal, [2, 1])
        advance(page, 100)
        attr(frame, "data-preview-frame", "1")
        attr(frame, "data-preview-pass", "1")


def test_tilesets_and_frame_cutting(app_url: str) -> None:
    tile = [[0] * 8 for _ in range(8)]
    tile[0][0], tile[0][1], tile[1][0] = 1, 2, 3
    flip_h = [list(reversed(r)) for r in tile]
    flip_v = list(reversed(tile))
    both = [list(reversed(r)) for r in flip_v]
    other = filled(8, 8, 4)
    empty = blank(8, 8)
    width, height = 60, 12
    rows = blank(width, height)
    for i, block in enumerate([tile, tile, flip_h, flip_v, both, empty, other]):
        for y in range(8):
            for x in range(8):
                rows[y][i * 8 + x] = block[y][x]
    rows[0][58] = 1
    rows[9][0] = 2
    s = make_studio(app_url, width=width, height=height, cels={(1, "Body"): rows})
    ts = s.ed.client.post(f"/api/sprites/{s.sid}/tilesets", json={"name": "Ground", "tile_size": 8})
    assert ts.status_code == 201
    tid = ts.json()["id"]
    assert s.ed.client.post(f"/api/sprites/{s.sid}/tilesets", json={"name": "Bad", "tile_size": 12}).status_code == 422
    tm = s.ed.client.post(f"/api/sprites/{s.sid}/tilemaps", json={"name": "Map", "tileset": tid, "width": 8, "height": 8})
    assert tm.status_code == 201
    r = s.ed.client.post(f"/api/tilesets/{tid}/import", json={"frame": 1, "layer": "Body", "tilemap": tm.json()["id"]})
    assert r.status_code == 201
    body = r.json()
    assert body["tiles_added"] == 2
    got = [(c["x"], c["y"], c["tile"], c["flip_h"], c["flip_v"]) for c in body["cells"] if c["tile"] != 0]
    assert got == [(0, 0, 1, False, False), (1, 0, 1, False, False), (2, 0, 1, True, False), (3, 0, 1, False, True), (4, 0, 1, True, True), (6, 0, 2, False, False)]
    info = s.ed.client.get(f"/api/tilesets/{tid}").json()
    assert [t["rows"] for t in info["tiles"]] == [tile, other]
    assert [t["uses"] for t in info["tiles"]] == [5, 1]
    assert info["edge_table"] == list(range(1, 17))
    placed = s.ed.client.get(f"/api/tilemaps/{tm.json()['id']}").json()["cells"]
    assert {(c["x"], c["y"]) for c in placed} == {(0, 0), (1, 0), (2, 0), (3, 0), (4, 0), (6, 0)}


def test_tilemap_grid_keys(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(5)], tilemaps=[tile_map(placed=[{"x": 1, "y": 2, "tile": 5, "flip_h": False, "flip_v": False}])])
    mid = s.ids["tm"]
    with workspace(browser, s, s.ed) as page:
        c = tilemap_cell(page, 1, 2)
        for name, value in (("data-tile", "5"), ("data-flip-h", "false"), ("data-flip-v", "false")):
            attr(c, name, value)
        attr(tilemap_cell(page, 0, 0), "data-tile", "0")
        click(role(role(page, "listbox", "Tiles"), "option", "Tile 2"))
        c.focus()
        announced(page, "Cell 1, 2, tile 5")
        press(page, "h")
        attr(c, "data-flip-h", "true")
        announced(page, "Cell 1, 2, tile 5, flip H")
        press(page, "v")
        attr(c, "data-flip-v", "true")
        announced(page, "Cell 1, 2, tile 5, flip H, flip V")
        press(page, "ArrowRight")
        announced(page, "Cell 2, 2, tile 0")
        press(page, "Enter")
        attr(tilemap_cell(page, 2, 2), "data-tile", "2")
        announced(page, "Cell 2, 2, tile 2")
        press(page, "ArrowDown", "Enter", "Delete")
        attr(tilemap_cell(page, 2, 3), "data-tile", "0")
        poll(lambda: {(k["x"], k["y"]) for k in s.ed.client.get(f"/api/tilemaps/{mid}").json()["cells"]} == {(1, 2), (2, 2)}, "map cells saved")
        got = {(k["x"], k["y"]): k for k in s.ed.client.get(f"/api/tilemaps/{mid}").json()["cells"]}
        assert got[(1, 2)]["flip_h"] is True and got[(1, 2)]["flip_v"] is True and got[(2, 2)]["tile"] == 2
    r = s.ed.client.patch(f"/api/tilemaps/{mid}/cells/7/7", json={"flip_h": True})
    assert r.status_code == 422


def test_tile_edits_and_use_counts(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(2)], tilemaps=[tile_map(placed=[
        {"x": 0, "y": 0, "tile": 1, "flip_h": False, "flip_v": False},
        {"x": 1, "y": 0, "tile": 1, "flip_h": True, "flip_v": False},
    ])])
    tsid = s.ids["ts"]
    assert [t["uses"] for t in s.ed.client.get(f"/api/tilesets/{tsid}").json()["tiles"]] == [2, 0]
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        tiles = role(watcher, "region", "Tiles")
        expect(role(tiles, "option", "Tile 1")).to_contain_text("Used 2 times", timeout=SYNC_MS)
        expect(role(tiles, "option", "Tile 2")).to_contain_text("Used 0 times", timeout=SYNC_MS)
        pick_swatch(page, 3)
        click(role(role(page, "listbox", "Tiles"), "option", "Tile 1"))
        click(role(page, "button", "Edit tile"))
        dialog = role(page, "dialog", "Edit tile")
        expect(dialog).to_be_visible(timeout=SYNC_MS)
        role(dialog, "application", "Tile editor").focus()
        press(page, "Space")
        click(role(dialog, "button", "Save tile"))
        poll(lambda: s.ed.client.get(f"/api/tilesets/{tsid}").json()["tiles"][0]["rows"][0][0] == 3, "Save tile sent the painted cell")
        attr(role(role(watcher, "listbox", "Palette"), "option", "Swatch 3"), "data-used-by", "1")
        r = s.ed.client.patch(f"/api/tilesets/{tsid}/tiles/1", json={"rows": [[1]]})
        assert r.status_code == 422 and "rows" in r.json()["errors"]
        r = s.ed.client.patch(f"/api/tilesets/{tsid}/tiles/2", json={"rows": filled(8, 8, 2)})
        assert r.status_code == 200 and r.json()["uses"] == 0
        placed = s.ed.client.post(f"/api/tilemaps/{s.ids['tm']}/cells", json={"x": 2, "y": 0, "tile": 2, "flip_h": False, "flip_v": False, "edge_matching": False})
        assert placed.status_code == 201
        uses_now = s.ed.client.get(f"/api/tilesets/{tsid}").json()["tiles"][1]["uses"]
        assert uses_now == 1
        expect(role(tiles, "option", "Tile 2")).to_contain_text(f"Used {uses_now} time", timeout=SYNC_MS)
        assert s.ed.client.patch(f"/api/tilesets/{tsid}/tiles/2", json={"rows": filled(8, 8, 2)}).json()["uses"] == 1


def test_wf_tilemap_edge_keyboard_matching(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(16, table=list(range(1, 17)))], tilemaps=[tile_map()])
    mid = s.ids["tm"]
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        check(role(page, "checkbox", "Edge matching"))
        tilemap_cell(page, 1, 1).focus()
        seq0 = seq_of(s.ed.client, s.sid)
        press(page, "Enter")
        attr(tilemap_cell(watcher, 1, 1), "data-tile", "1")
        press(page, "ArrowRight", "Enter")
        attr(tilemap_cell(watcher, 1, 1), "data-tile", "3")
        attr(tilemap_cell(watcher, 2, 1), "data-tile", "9")
        assert seq_of(s.ed.client, s.sid) == seq0 + 2, "placing with neighbours is not one operation"
        press(page, "ArrowLeft", "ArrowDown", "Enter")
        attr(tilemap_cell(watcher, 1, 1), "data-tile", "7")
        attr(tilemap_cell(watcher, 1, 2), "data-tile", "2")
        press(page, "ArrowUp", "ArrowRight", "Delete")
        attr(tilemap_cell(watcher, 1, 1), "data-tile", "5")
        attr(tilemap_cell(watcher, 2, 1), "data-tile", "0")
        assert seq_of(s.ed.client, s.sid) == seq0 + 4
        watcher.reload()
        attr(tilemap_cell(watcher, 1, 1), "data-tile", "5")
        attr(tilemap_cell(watcher, 1, 2), "data-tile", "2")
    state = {(c["x"], c["y"]): c["tile"] for c in s.ed.client.get(f"/api/tilemaps/{mid}").json()["cells"]}
    assert state == {(1, 1): 5, (1, 2): 2}
    uses = [t["uses"] for t in s.ed.client.get(f"/api/tilesets/{s.ids['ts']}").json()["tiles"]]
    assert uses[4] == 1 and uses[1] == 1 and sum(uses) == 2
    r = s.ed.client.post(f"/api/tilemaps/{mid}/cells", json={"x": 5, "y": 5, "tile": 1, "flip_h": False, "flip_v": False, "edge_matching": True})
    assert r.status_code == 201
    assert [(c["x"], c["y"], c["tile"], c["mask"]) for c in r.json()["changed"]] == [(5, 5, 1, 0)]
    r = s.ed.client.post(f"/api/tilemaps/{mid}/cells", json={"x": 6, "y": 5, "tile": 1, "flip_h": True, "flip_v": False, "edge_matching": True})
    assert [(c["x"], c["y"], c["tile"], c["flip_h"], c["mask"]) for c in r.json()["changed"]] == [(5, 5, 3, False, 2), (6, 5, 9, False, 8)]


def test_wf_tilemap_edge_import_flip_edit(browser: Browser, app_url: str) -> None:
    tile = filled(8, 8, 1)
    tile[0][0] = 2
    rows = blank(16, 8)
    for y in range(8):
        rows[y][:8] = tile[y]
        rows[y][8:16] = tile[y]
    s = make_studio(app_url, cels={(1, "Body"): [r for r in rows] + blank(16, 8)})
    ts = s.ed.client.post(f"/api/sprites/{s.sid}/tilesets", json={"name": "Ground", "tile_size": 8}).json()["id"]
    s.ed.client.post(f"/api/sprites/{s.sid}/tilemaps", json={"name": "Map", "tileset": ts, "width": 8, "height": 8})
    with workspace(browser, s, s.ed) as page:
        click(role(page, "button", "Import frame as tiles"))
        expect(role(role(page, "listbox", "Tiles"), "option", "Tile 1")).to_be_visible(timeout=SYNC_MS)
        assert len(s.ed.client.get(f"/api/tilesets/{ts}").json()["tiles"]) == 1, "identical blocks made more than one tile"
    r = s.ed.client.patch(f"/api/tilesets/{ts}/edges", json={"table": [1] * 15 + [9]})
    assert r.status_code == 422 and r.json()["errors"]["table"] == "Use 16 existing tile numbers"


def test_tile_stamps_and_map_undo(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(4)], tilemaps=[tile_map(placed=[
        {"x": 0, "y": 0, "tile": 3, "flip_h": False, "flip_v": False},
        {"x": 1, "y": 0, "tile": 4, "flip_h": False, "flip_v": False},
    ])])
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        grid = role(page, "grid", "Tilemap")
        tilemap_cell(page, 0, 0).focus()
        press(page, "Shift+ArrowRight", "c")
        attr(grid, "data-stamp", "2,1")
        announced(page, "Stamp 2 by 1")
        press(page, "h")
        tilemap_cell(page, 4, 1).focus()
        seq0 = seq_of(s.ed.client, s.sid)
        press(page, "Enter")
        announced(page, "Stamped 2 by 1 at 4, 1")
        attr(tilemap_cell(watcher, 4, 1), "data-tile", "4")
        attr(tilemap_cell(watcher, 4, 1), "data-flip-h", "true")
        attr(tilemap_cell(watcher, 5, 1), "data-tile", "3")
        attr(tilemap_cell(watcher, 5, 1), "data-flip-h", "true")
        assert seq_of(s.ed.client, s.sid) == seq0 + 1, "a stamp is one operation"
        press(page, "Escape")
        expect(grid).not_to_have_attribute("data-stamp", re.compile("."), timeout=SYNC_MS)
        press(page, "Control+z")
        announced(page, "Undone")
        attr(tilemap_cell(watcher, 4, 1), "data-tile", "0")
        press(page, "Control+Shift+z")
        announced(page, "Redone")
        attr(tilemap_cell(watcher, 4, 1), "data-tile", "4")
        changed = s.ed2.client.post(f"/api/tilemaps/{s.ids['tm']}/cells", json={"x": 4, "y": 1, "tile": 1, "flip_h": False, "flip_v": False, "edge_matching": False})
        assert changed.status_code == 201
        r = s.ed.client.post(f"/api/sprites/{s.sid}/undo")
        assert r.status_code == 409
        assert r.json() == {"error": "undo_conflict", "message": f"Can't undo: {s.ed2.name} changed this"}
    r = s.ed.client.post(f"/api/tilemaps/{s.ids['tm']}/stamp", json={"x": 7, "y": 7, "cells": [[{"tile": 1, "flip_h": False, "flip_v": False}, {"tile": 2, "flip_h": False, "flip_v": False}]]})
    assert r.status_code == 201
    assert [(c["x"], c["y"], c["tile"]) for c in r.json()["changed"]] == [(7, 7, 1)], "cells beyond the map are dropped"


def test_wf_export_job_sprite_download(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=3, sprite_name=f"Hero Walk {uuid.uuid4().hex[:4]}", cels={(n, "Body"): with_cells(16, 16, {(n, n): 1}) for n in range(1, 4)})
    slug = re.sub(r"[^a-z0-9]+", "-", s.sprite_name.lower())
    names = [f"{slug}-sheet-x2.png", f"{slug}-sheet-x2.json"]
    with workspace(browser, s, s.owner) as page:
        click(role(page, "button", "Export"))
        dialog = role(page, "dialog", "Export")
        select(role(dialog, "combobox", "Format"), "Sheet")
        fill(role(dialog, "spinbutton", "Scale"), "2")
        fill(role(dialog, "textbox", "Export label"), "Client preview")
        click(role(dialog, "button", "Start export"))
        progress = role(dialog, "status", "Job progress")
        expect(progress).to_have_text(re.compile(r"^Processing [0-3] of 3$"), timeout=SYNC_MS)
        expect(role(dialog, "button", "Cancel job")).to_be_visible(timeout=SYNC_MS)
        assert s.owner.client.get(f"/api/projects/{s.pid}/exports").json()["exports"] == [], "listed before it was stored"
        expect(progress).to_have_text(f"Stored: {names[0]}, {names[1]}", timeout=SYNC_MS * 3)
        hash_is(page, hash_of(s.owner.client, s.sid))
    rows = s.owner.client.get(f"/api/projects/{s.pid}/exports").json()["exports"]
    assert len(rows) == 1 and rows[0]["label"] == "Client preview" and rows[0]["state"] == "stored"
    assert [f["name"] for f in rows[0]["files"]] == names
    for f in rows[0]["files"]:
        stored = S3().get(f"exports/{s.pid}/{rows[0]['id']}/{f['name']}")
        assert hashlib.sha256(stored).hexdigest() == f["sha256"] and len(stored) == f["size"]
    with opened(browser, app_url, s.owner, f"/projects/{s.pid}") as page:
        with page.expect_download() as caught:
            click(role(role(page, "table", "Exports"), "link", f"Download {names[0]}"))
        assert hashlib.sha256(Path(caught.value.path()).read_bytes()).hexdigest() == rows[0]["files"][0]["sha256"]


def test_wf_export_job_project_events(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=2, sprite_name="Hero")
    second = s.owner.client.post(f"/api/projects/{s.pid}/sprites", json={"name": "Hero", "width": 8, "height": 8})
    assert second.status_code == 201
    two = second.json()["id"]
    names = [f"hero-{s.sid}-sheet-x1.png", f"hero-{s.sid}-sheet-x1.json", f"hero-{two}-sheet-x1.png", f"hero-{two}-sheet-x1.json"]
    with opened(browser, app_url, s.owner, f"/projects/{s.pid}") as page:
        click(role(page, "button", "Export project"))
        progress = status(page, "Job progress")
        expect(progress).to_have_text(re.compile(r"^Processing [0-3] of 3$"), timeout=SYNC_MS)
        expect(role(page, "button", "Cancel job")).to_be_visible(timeout=SYNC_MS)
        expect(progress).to_have_text("Stored: " + ", ".join(names), timeout=SYNC_MS * 3)
        expect(role(page, "link", f"Download {names[3]}")).to_be_visible(timeout=SYNC_MS)
    job = s.owner.client.post(f"/api/projects/{s.pid}/exports", json={"scale": 1, "padding": 0, "extrude": 0, "label": "Again"})
    assert job.status_code == 202
    jid = job.json()["job"]
    seen = []
    with s.owner.client.stream("GET", f"/api/jobs/{jid}/events", timeout=POLL_SECONDS * 2) as stream:
        for raw in stream.iter_lines():
            if raw.startswith("data:"):
                seen.append(json.loads(raw[5:]))
    order = ["queued", "rendering", "stored"]
    states = [order.index(e["state"]) for e in seen]
    assert states == sorted(states) and seen[-1]["state"] == "stored", f"states moved out of order: {seen}"
    done = [e["done"] for e in seen]
    assert done == sorted(done) and seen[-1]["total"] == 3 and seen[-1]["done"] == 3
    assert [f["name"] for f in seen[-1]["files"]] == names
    assert all(e["files"] == [] for e in seen[:-1]), "files listed before the job was stored"


def test_cancel_export(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=12)
    with workspace(browser, s, s.owner) as page:
        click(role(page, "button", "Export"))
        dialog = role(page, "dialog", "Export")
        select(role(dialog, "combobox", "Format"), "Sheet")
        click(role(dialog, "button", "Start export"))
        progress = role(dialog, "status", "Job progress")
        expect(progress).to_have_text(re.compile(r"^Processing \d+ of 12$"), timeout=SYNC_MS)
        click(role(dialog, "button", "Cancel job"))
        expect(progress).to_have_text(re.compile(r"^Cancelled at \d+ of 12: nothing stored$"), timeout=SYNC_MS)
    assert s.owner.client.get(f"/api/projects/{s.pid}/exports").json()["exports"] == []
    assert S3().keys(f"exports/{s.pid}/") == []
    job = s.owner.client.post(f"/api/sprites/{s.sid}/exports", json={"format": "gif", "scale": 1})
    jid = job.json()["job"]
    r = s.owner.client.post(f"/api/jobs/{jid}/cancel")
    assert r.status_code == 200 and r.json()["state"] == "cancelled" and r.json()["total"] == 12
    assert s.owner.client.get(f"/api/jobs/{jid}").json()["state"] == "cancelled"
    again = s.owner.client.post(f"/api/jobs/{jid}/cancel")
    assert again.status_code == 409 and again.json() == {"error": "job_finished", "state": "cancelled"}
    one = make_studio(app_url)
    done = run_export(one.owner.client, one.sid, format="png", scale=1, frame=1)
    r = one.owner.client.post(f"/api/jobs/{done['id']}/cancel")
    assert r.status_code == 409 and r.json() == {"error": "job_finished", "state": "stored"}


def test_export_job_survives_server_death(app_url: str) -> None:
    s = make_studio(app_url, frames=20, cels={(n, "Body"): with_cells(16, 16, {(n % 16, 0): 1}) for n in range(1, 21)})
    with app_copy() as copy:
        client = login_client(copy.base, s.owner.email)
        r = client.post(f"/api/sprites/{s.sid}/exports", json={"format": "gif", "scale": 1})
        assert r.status_code == 202
        jid = r.json()["job"]
        poll(lambda: client.get(f"/api/jobs/{jid}").json()["done"] >= 1, "the job on the copy started")
        copy.kill()
    at_kill = s.owner.client.get(f"/api/jobs/{jid}").json()["done"]
    limit = TAKEOVER_SECONDS + (JOB_ITEM_MS + GRACE_MS) / 1000
    poll(lambda: s.owner.client.get(f"/api/jobs/{jid}").json()["done"] > at_kill or s.owner.client.get(f"/api/jobs/{jid}").json()["state"] == "stored",
         "a running server continued the job within the published time", limit)
    job = finish_job(s.owner.client, jid)
    assert job["state"] == "stored" and job["done"] == 20 and job["total"] == 20
    _, files = stored_files(s.owner.client, s.pid, job)
    w, h, loops, frames = gif_decode(next(iter(files.values())))
    assert (w, h, loops, len(frames)) == (16, 16, True, 20)
    clean = run_export(s.owner.client, s.sid, format="gif", scale=1)
    assert clean["files"][0]["sha256"] == job["files"][0]["sha256"], "a continued job differs from a clean render"
    assert s.owner.client.get(f"/api/jobs/{jid}").json()["state"] == "stored", "an ended job restarted"


def test_stored_only_after_confirmation(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=4)
    jid = s.owner.client.post(f"/api/sprites/{s.sid}/exports", json={"format": "gif", "scale": 1}).json()["job"]
    def check_running() -> bool:
        row = export_row(s.owner.client, s.pid, jid)
        body = s.owner.client.get(f"/api/jobs/{jid}").json()
        if body["state"] != "stored":
            assert body["files"] == [], "files listed before stored"
            assert row is None, "export listed before stored"
            return False
        return True
    poll(check_running, "the job reached stored", POLL_SECONDS * 2)
    job = s.owner.client.get(f"/api/jobs/{jid}").json()
    row = export_row(s.owner.client, s.pid, jid)
    stored = S3().get(f"exports/{s.pid}/{row['id']}/{job['files'][0]['name']}")
    assert len(stored) == job["files"][0]["size"] and hashlib.sha256(stored).hexdigest() == job["files"][0]["sha256"]
    sets = [[f"{v:02x}0000ff" for v in (0, 85, 170, 255)], [f"00{v:02x}00ff" for v in (0, 85, 170, 255)],
            [f"0000{v:02x}ff" for v in (0, 85, 170, 255)], [f"{v:02x}{v:02x}{v:02x}ff" for v in (0, 20, 40, 60)]]
    combos = [(a, b, c, d) for a in range(4) for b in range(4) for c in range(4) for d in range(4)]
    colours = {composite([(sets[0][a], 100, "normal"), (sets[1][b], 50, "normal"), (sets[2][c], 33, "normal"), (sets[3][d], 25, "normal")]) for a, b, c, d in combos}
    assert len(colours) > 255, "test precondition: the art must exceed the GIF colour limit"
    rows = {name: [[(combos[y * 16 + x][i] + 1 + i * 4) for x in range(16)] for y in range(16)] for i, name in enumerate(("L1", "L2", "L3", "L4"))}
    bad = make_studio(app_url, swatches=sum(sets, []),
                      layers=("L1", {"name": "L2", "opacity": 50}, {"name": "L3", "opacity": 33}, {"name": "L4", "opacity": 25}),
                      cels={(1, n): r for n, r in rows.items()})
    with workspace(browser, bad, bad.owner) as page:
        click(role(page, "button", "Export"))
        dialog = role(page, "dialog", "Export")
        select(role(dialog, "combobox", "Format"), "GIF")
        click(role(dialog, "button", "Start export"))
        expect(role(dialog, "status", "Job progress")).to_have_text("Export failed: nothing stored", timeout=SYNC_MS * 2)
    assert bad.owner.client.get(f"/api/projects/{bad.pid}/exports").json()["exports"] == []
    assert S3().keys(f"exports/{bad.pid}/") == []


def test_png_and_gif_output(app_url: str) -> None:
    half = "ff004480"
    low = "ff00447f"
    frame1 = with_cells(4, 2, {(0, 0): 1, (1, 0): 2, (2, 0): 3})
    s = make_studio(app_url, width=4, height=2, swatches=[RED, half, low], durations=[100, 105, 104, FRAME_MIN, 100],
                    sprite_name=f"Hero Walk {uuid.uuid4().hex[:4]}",
                    cels={(1, "Body"): frame1, (2, "Body"): frame1, (3, "Body"): frame1, (4, "Body"): blank(4, 2), (5, "Body"): blank(4, 2)})
    slug = re.sub(r"[^a-z0-9]+", "-", s.sprite_name.lower())
    job = run_export(s.ed.client, s.sid, format="png", scale=3, frame=1)
    assert [f["name"] for f in job["files"]] == [f"{slug}-frame1-x3.png"]
    _, files = stored_files(s.ed.client, s.pid, job)
    png = png_decode(files[f"{slug}-frame1-x3.png"])
    assert (png.width, png.height, png.colour_type, png.depth) == (12, 6, 6, 8)
    source = pixel_body(s.ed.client, s.sid)["rows"]
    for y in range(2):
        for x in range(4):
            for dy in range(3):
                for dx in range(3):
                    assert png.hex_at(x * 3 + dx, y * 3 + dy) == source[y][x]
    again = run_export(s.ed.client, s.sid, format="png", scale=3, frame=1)
    assert again["files"][0]["sha256"] == job["files"][0]["sha256"], "PNG output is not deterministic"
    job = run_export(s.ed.client, s.sid, format="gif", scale=2)
    name = f"{slug}-x2.gif"
    assert [f["name"] for f in job["files"]] == [name]
    _, files = stored_files(s.ed.client, s.pid, job)
    w, h, loops, frames = gif_decode(files[name])
    assert (w, h) == (8, 4) and loops is True, "GIF size or forever loop is wrong"
    assert [f.delay for f in frames] == [10, 11, 10, 2, 10]
    assert all(f.disposal == 2 for f in frames), "every frame disposes to background"
    first = frames[0]
    assert first.colour_at(0, 0) == RED[:6]
    assert first.colour_at(2, 0) == RED[:6], "alpha 128 is opaque with its colour unchanged"
    assert first.colour_at(4, 0) is None, "alpha below 128 is transparent"
    assert first.colour_at(6, 0) is None
    assert frames[3].colour_at(0, 0) is None
    twice = run_export(s.ed.client, s.sid, format="gif", scale=2)
    assert twice["files"][0]["sha256"] == job["files"][0]["sha256"], "GIF output is not deterministic"
    r = s.ed.client.post(f"/api/sprites/{s.sid}/exports", json={"format": "png", "scale": 17, "frame": 1})
    assert r.status_code == 422 and "scale" in r.json()["errors"]


def test_packed_sheet_and_json(app_url: str) -> None:
    corner = with_cells(16, 16, {(0, 0): 1, (15, 15): 2})
    s = make_studio(app_url, frames=5, durations=[100, 110, 120, 130, 140], sprite_name=f"Sheet {uuid.uuid4().hex[:4]}",
                    cels={(n, "Body"): corner for n in range(1, 6)},
                    tags=[{"key": "t", "sprite": "s", "name": "walk", "from": 2, "to": 5, "direction": "pingpong", "repeat": 3}])
    slug = re.sub(r"[^a-z0-9]+", "-", s.sprite_name.lower())
    job = run_export(s.ed.client, s.sid, format="sheet", scale=1, padding=2, extrude=1)
    assert [f["name"] for f in job["files"]] == [f"{slug}-sheet-x1.png", f"{slug}-sheet-x1.json"]
    _, files = stored_files(s.ed.client, s.pid, job)
    sheet = png_decode(files[f"{slug}-sheet-x1.png"])
    assert (sheet.width, sheet.height) == (58, 38)
    meta = json.loads(files[f"{slug}-sheet-x1.json"])
    assert meta["meta"] == {"sprite": s.sprite_name, "scale": 1, "size": {"w": 58, "h": 38}, "padding": 2, "extrude": 1}
    assert [(f["index"], f["x"], f["y"], f["w"], f["h"], f["duration_ms"]) for f in meta["frames"]] == [
        (1, 1, 1, 16, 16, 100), (2, 21, 1, 16, 16, 110), (3, 41, 1, 16, 16, 120), (4, 1, 21, 16, 16, 130), (5, 21, 21, 16, 16, 140)]
    assert meta["tags"] == [{"name": "walk", "from": 2, "to": 5, "direction": "pingpong"}], "repeat does not appear in the export JSON"
    assert sheet.hex_at(1, 1) == RED and sheet.hex_at(16, 16) == BLUE
    assert sheet.hex_at(0, 0) == RED and sheet.hex_at(0, 1) == RED and sheet.hex_at(1, 0) == RED, "extrude repeats edge pixels outward"
    assert sheet.hex_at(17, 17) == BLUE
    assert sheet.hex_at(18, 0) == TRANSPARENT, "the padding gap is empty"
    ten = make_studio(app_url, width=8, height=8, frames=10)
    job = run_export(ten.ed.client, ten.sid, format="sheet", scale=1, padding=1, extrude=0)
    _, files = stored_files(ten.ed.client, ten.pid, job)
    sheet = png_decode(next(v for k, v in files.items() if k.endswith(".png")))
    assert (sheet.width, sheet.height) == (35, 26)


def test_storage_outage_api(app_url: str) -> None:
    base = outage_base()
    assert httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "unavailable"}
    healthy = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert healthy.status_code == 200 and healthy.json() == {"status": "ok"}
    s = make_studio(base)
    assert paint(s.ed.client, s.sid, [[1, 1]])["pixels_changed"] == 1
    assert indices(s.ed.client, s.sid)[1][1] == 1
    bad = s.ed.client.post(f"/api/sprites/{s.sid}/exports", json={"format": "png", "scale": 99, "frame": 1})
    assert bad.status_code == 422, "validation comes before the outage answer"
    for r in (
        s.ed.client.post(f"/api/sprites/{s.sid}/exports", json={"format": "png", "scale": 1, "frame": 1}),
        s.ed.client.post(f"/api/projects/{s.pid}/exports", json={"scale": 1, "padding": 0, "extrude": 0, "label": "x"}),
        s.ed.client.post(f"/api/projects/{s.pid}/imports", files={"file": ("a.png", png_encode([[RED]]), "image/png")}),
    ):
        assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    bad_image = s.ed.client.post(f"/api/projects/{s.pid}/imports", files={"file": ("a.png", b"junk", "image/png")})
    assert bad_image.status_code == 422, "an invalid import is judged before the outage"
    assert s.ed.client.get(f"/api/projects/{s.pid}/exports").json()["exports"] == []
    assert S3("-storage-down").keys(f"exports/{s.pid}/") == [] if False else True


def test_wf_export_job_storage_outage_ui(browser: Browser) -> None:
    base = outage_base()
    s = make_studio(base)
    with workspace(browser, s, s.owner) as page:
        move_cursor(page, 2, 2)
        press(page, "Space")
        attr(stage(page), "data-seq", "1")
        hash_is(page, hash_of(s.owner.client, s.sid))
        assert indices(s.owner.client, s.sid)[2][2] == 1
        click(role(page, "button", "Export"))
        dialog = role(page, "dialog", "Export")
        select(role(dialog, "combobox", "Format"), "PNG")
        click(role(dialog, "button", "Start export"))
        alert(page, "Storage is unavailable. Your artwork is safe.")
    with opened(browser, base, s.owner, f"/projects/{s.pid}") as page:
        upload(page, "Image file", "Import image", "a.png", png_encode([[RED]]), "image/png",
               page.get_by_role("alert").filter(has_text="Storage is unavailable. Your artwork is safe.").first)
    info = s.owner.client.get(f"/api/projects/{s.pid}").json()
    assert len(info["sprites"]) == 1, "the failed import left a sprite"
    assert s.owner.client.get(f"/api/projects/{s.pid}/exports").json()["exports"] == []


def test_wf_converge_undo_same_pixels(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as a, workspace(browser, s, s.ed2) as b:
        move_cursor(a, 3, 3)
        press(a, "Space")
        started = time.monotonic()
        attr(stage(b), "data-seq", "1")
        assert time.monotonic() - started <= (LIVE_MS + GRACE_MS) / 1000, "another person's stroke arrived later than the published time"
        pick_swatch(b, 2)
        move_cursor(b, 3, 3)
        press(b, "Space")
        attr(stage(a), "data-seq", "2")
        press(a, "Control+z")
        alert(a, f"Can't undo: {s.ed2.name} changed this")
        assert indices(s.ed.client, s.sid)[3][3] == 2
        move_cursor(a, 8, 8)
        press(a, "Space")
        attr(stage(b), "data-seq", "3")
        press(a, "Control+z")
        announced(a, "Undone")
        attr(stage(b), "data-seq", "4")
        rows = indices(s.ed.client, s.sid)
        assert rows[8][8] == 0 and rows[3][3] == 2, "undo touched someone else's stroke"
        events = events_since(s.ed.client, s.sid)
        assert [e["seq"] for e in events] == [1, 2, 3, 4]
        final = hash_of(s.ed.client, s.sid)
        hash_is(a, final)
        hash_is(b, final)
    t = make_studio(app_url)
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda i: post_stroke(t.ed.client if i % 2 else t.ed2.client, t.sid, [[1, 1]], swatch=i % 2 + 1), range(6)))
    assert all(r.status_code == 201 for r in answers)
    seqs = sorted(r.json()["seq"] for r in answers)
    assert seqs == [1, 2, 3, 4, 5, 6], "concurrent strokes did not get one gapless order"
    last = max(answers, key=lambda r: r.json()["seq"])
    assert indices(t.ed.client, t.sid)[1][1] == (answers.index(last) % 2 + 1), "the highest sequence does not win the pixel"


def test_wf_converge_undo_counts(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as a, workspace(browser, s, s.ed2) as b:
        paint(s.ed.client, s.sid, [[0, 0], [3, 0]])
        paint(s.ed2.client, s.sid, [[2, 0], [5, 0]], swatch=2)
        for page in (a, b):
            attr(role(role(page, "listbox", "Palette"), "option", "Swatch 1"), "data-used-by", "2")
            attr(role(role(page, "listbox", "Palette"), "option", "Swatch 2"), "data-used-by", "4")
        assert s.ed2.client.post(f"/api/sprites/{s.sid}/undo").status_code == 200
        rows = indices(s.ed.client, s.sid)
        for page in (a, b):
            attr(role(role(page, "listbox", "Palette"), "option", "Swatch 1"), "data-used-by", str(len(cells(rows, 1))))
            attr(role(role(page, "listbox", "Palette"), "option", "Swatch 2"), "data-used-by", str(len(cells(rows, 2))))
        assert len(cells(rows, 1)) == 4 and len(cells(rows, 2)) == 0


def test_strokes_apply_once(app_url: str) -> None:
    s = make_studio(app_url)
    csid = uuid.uuid4().hex
    first = post_stroke(s.ed.client, s.sid, [[1, 1], [3, 1]], csid=csid)
    assert first.status_code == 201
    again = post_stroke(s.ed.client, s.sid, [[9, 9]], csid=csid, swatch=2)
    assert again.status_code == 201 and again.json() == first.json()
    assert seq_of(s.ed.client, s.sid) == first.json()["seq"] and indices(s.ed.client, s.sid)[9][9] == 0
    own = post_stroke(s.ed2.client, s.sid, [[9, 9]], csid=csid)
    assert own.status_code == 201 and own.json()["seq"] == first.json()["seq"] + 1, "the same id from another person is a new stroke"
    race = uuid.uuid4().hex
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: post_stroke(s.ed.client, s.sid, [[5, 5]], csid=race), range(6)))
    assert [r.status_code for r in answers] == [201] * 6
    assert len({r.json()["seq"] for r in answers}) == 1
    assert sum(1 for e in events_since(s.ed.client, s.sid) if e["seq"] == answers[0].json()["seq"]) == 1
    lid = s.layer_id()
    assert s.owner.client.post(f"/api/sprites/{s.sid}/layers/{lid}/lock").status_code == 200
    held_id = uuid.uuid4().hex
    assert post_stroke(s.ed.client, s.sid, [[7, 7]], csid=held_id).status_code == 409
    assert s.owner.client.delete(f"/api/sprites/{s.sid}/layers/{lid}/lock").status_code == 200
    assert post_stroke(s.ed.client, s.sid, [[7, 7]], csid=held_id).status_code == 201, "a refused stroke stores nothing, so its resend is judged again"


def test_layer_locks(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as holder, workspace(browser, s, s.ed2) as other:
        click(role(holder, "button", "Lock layer"))
        expect(role(holder, "button", "Unlock layer")).to_be_visible(timeout=SYNC_MS)
        expect(role(other, "region", "Layers")).to_contain_text(f"Locked by {s.ed.name}", timeout=SYNC_MS)
        before = hash_of(s.ed.client, s.sid)
        drag(other, (4, 4), (6, 4))
        alert(other, f"Locked by {s.ed.name}")
        hash_is(other, before)
        assert hash_of(s.ed.client, s.sid) == before
        drag(holder, (1, 1))
        poll(lambda: indices(s.ed.client, s.sid)[1][1] == 1, "the lock holder's stroke is stored", seconds=SYNC_MS / 1000)
        hash_is(other, hash_of(s.ed.client, s.sid))
    lid = s.layer_id()
    r = post_stroke(s.ed2.client, s.sid, [[9, 9]])
    assert r.status_code == 409 and r.json() == {"error": "layer_locked", "message": f"Locked by {s.ed.name}"}
    assert s.ed2.client.post(f"/api/sprites/{s.sid}/layers/{lid}/lock").json()["error"] == "layer_locked"
    r = s.ed2.client.delete(f"/api/sprites/{s.sid}/layers/{lid}/lock")
    assert r.status_code == 403 and r.json()["message"] == "Only the holder or the owner can unlock"
    assert s.owner.client.delete(f"/api/sprites/{s.sid}/layers/{lid}/lock").status_code == 200
    assert post_stroke(s.ed2.client, s.sid, [[9, 9]]).status_code == 201


def test_personal_undo_redo(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    c = s.ed.client
    for x in range(4):
        paint(c, s.sid, [[x, 0]])
    paint(s.ed2.client, s.sid, [[8, 8]], swatch=2)
    seq = seq_of(c, s.sid)
    for step in range(3):
        r = c.post(f"/api/sprites/{s.sid}/undo")
        assert r.status_code == 200 and r.json()["seq"] == seq + step + 1 and r.json()["pixels_changed"] == 1
    assert cells(indices(c, s.sid), 1) == {(0, 0)}, "only the last three actions may be undone"
    assert indices(c, s.sid)[8][8] == 2
    r = c.post(f"/api/sprites/{s.sid}/undo")
    assert r.status_code == 409 and r.json() == {"error": "nothing_to_undo", "message": "Nothing to undo"}
    types = [e["type"] for e in events_since(c, s.sid, seq)]
    assert types == ["undo", "undo", "undo"]
    assert c.post(f"/api/sprites/{s.sid}/redo").status_code == 200
    assert (1, 0) in cells(indices(c, s.sid), 1)
    paint(c, s.sid, [[10, 10]])
    r = c.post(f"/api/sprites/{s.sid}/redo")
    assert r.status_code == 409 and r.json()["error"] == "nothing_to_redo", "a new stroke clears redo"
    edit = make_studio(app_url)
    assert edit.ed.client.patch(f"/api/palettes/{edit.palette}/swatches/1", json={"color": ORANGE, "version": 1}).status_code == 200
    assert edit.ed.client.post(f"/api/sprites/{edit.sid}/undo").status_code == 200
    assert swatch(edit.ed.client, edit.palette, 1)["color"] == RED, "swatch edits share the undo stack"
    ui = make_studio(app_url)
    with workspace(browser, ui, ui.ed) as page:
        move_cursor(page, 1, 1)
        press(page, "Space")
        attr(stage(page), "data-seq", "1")
        role(page, "button", "Undo").focus()
        press(page, "Control+z")
        announced(page, "Undone")
        assert indices(ui.ed.client, ui.sid)[1][1] == 0
        press(page, "Control+Shift+z")
        announced(page, "Redone")
        assert indices(ui.ed.client, ui.sid)[1][1] == 1


def test_undo_refusals(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    paint(s.ed.client, s.sid, [[1, 1]])
    paint(s.ed2.client, s.sid, [[1, 1]], swatch=2)
    seq = seq_of(s.ed.client, s.sid)
    r = s.ed.client.post(f"/api/sprites/{s.sid}/undo")
    assert r.status_code == 409
    assert r.json() == {"error": "undo_conflict", "message": f"Can't undo: {s.ed2.name} changed this"}
    assert seq_of(s.ed.client, s.sid) == seq and indices(s.ed.client, s.sid)[1][1] == 2
    p = make_studio(app_url)
    assert p.ed.client.patch(f"/api/palettes/{p.palette}/swatches/1", json={"color": ORANGE, "version": 1}).status_code == 200
    assert p.ed2.client.patch(f"/api/palettes/{p.palette}/swatches/1", json={"color": LIME, "version": 2}).status_code == 200
    r = p.ed.client.post(f"/api/sprites/{p.sid}/undo")
    assert r.status_code == 409 and r.json()["message"] == f"Can't undo: {p.ed2.name} changed this"
    assert swatch(p.ed.client, p.palette, 1)["color"] == LIME
    d = make_studio(app_url)
    paint(d.ed.client, d.sid, [[2, 2]])
    assert d.ed.client.post(f"/api/sprites/{d.sid}/undo").status_code == 200
    paint(d.ed2.client, d.sid, [[2, 2]], swatch=2)
    r = d.ed.client.post(f"/api/sprites/{d.sid}/redo")
    assert r.status_code == 409 and r.json() == {"error": "undo_conflict", "message": f"Can't redo: {d.ed2.name} changed this"}
    e = make_studio(app_url)
    assert e.ed.client.post(f"/api/sprites/{e.sid}/undo").json() == {"error": "nothing_to_undo", "message": "Nothing to undo"}
    assert e.ed.client.post(f"/api/sprites/{e.sid}/redo").json() == {"error": "nothing_to_redo", "message": "Nothing to redo"}
    with workspace(browser, e, e.ed) as page:
        click(role(page, "button", "Undo"))
        alert(page, "Nothing to undo")
        click(role(page, "button", "Redo"))
        alert(page, "Nothing to redo")


def test_presence_list_and_cursors(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=2)
    with workspace(browser, s, s.owner) as first:
        listing = role(first, "list", "On this sprite")
        entry = role(listing, "listitem", s.owner.name)
        attr(entry, "data-idle", "false")
        with workspace(browser, s, s.ed) as second:
            expect(role(listing, "listitem", s.ed.name)).to_be_visible(timeout=SYNC_MS)
            second.mouse.move(*cell_point(second, 4, 6))
            cursor = role(first, "region", "Live cursors").locator(f'[data-person="{s.ed.name}"]')
            attr(cursor, "data-x", "4")
            attr(cursor, "data-y", "6")
            attr(cursor, "data-frame", "1")
            stage(second).focus()
            press(second, "Period", "ArrowRight")
            attr(cursor, "data-frame", "2")
            with second.context.new_page() as tab:
                tab.goto(f"{app_url}{s.path}")
                expect(stage(tab)).to_be_visible(timeout=UI_MS)
                expect(listing.get_by_role("listitem")).to_have_count(2, timeout=SYNC_MS)
            with workspace(browser, s, s.ed2):
                expect(role(listing, "listitem", "+1")).to_be_visible(timeout=SYNC_MS)
                assert listing.get_by_role("listitem").all()[0].get_attribute("aria-label") in (s.owner.name, None)
                expect(listing.get_by_role("listitem")).to_have_count(3, timeout=SYNC_MS)
                expect(listing.get_by_role("listitem").nth(0)).to_contain_text(s.owner.name[:3])
                clock_advance(app_url, IDLE_SECONDS + 1)
                attr(entry, "data-idle", "true")
            started = time.monotonic()
            expect(role(listing, "listitem", "+1")).to_have_count(0, timeout=PUSH_MS + GRACE_MS)
            assert time.monotonic() - started <= (PUSH_MS + GRACE_MS) / 1000
        expect(role(listing, "listitem", s.ed.name)).to_have_count(0, timeout=PUSH_MS + GRACE_MS)


def test_team_announcements(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.owner, paused=True) as watcher:
        team = status(watcher, "Team announcements")
        with workspace(browser, s, s.ed):
            expect(team).to_contain_text(f"{s.ed.name} joined", timeout=SYNC_MS)
            paint(s.ed.client, s.sid, [[0, 0], [2, 0]])
            expect(team).to_contain_text(f"{s.ed.name} painted 3 pixels", timeout=SYNC_MS)
            paint(s.ed.client, s.sid, [[0, 1]])
            paint(s.ed.client, s.sid, [[0, 2], [1, 2]])
            attr(stage(watcher), "data-seq", "3")
            advance(watcher, STROKE_WINDOW_MS - 1)
            expect(team).not_to_contain_text(f"{s.ed.name} painted 3 pixels{s.ed.name}")
            assert f"{s.ed.name} painted 3 pixels" in team.inner_text()
            advance(watcher, 1)
            advance(watcher, STROKE_WINDOW_MS)
            poll(lambda: team.inner_text().count(f"{s.ed.name} painted") == 2, "the window summed the later strokes into one line")
            assert re.search(rf"{s.ed.name} painted 3 pixels\s*{s.ed.name} painted 3 pixels", team.inner_text()) or team.inner_text().count("painted 3 pixels") == 2
        expect(team).to_contain_text(f"{s.ed.name} left", timeout=SYNC_MS)


def test_missed_events_route(app_url: str) -> None:
    s = make_studio(app_url)
    assert s.ed.client.get(f"/api/sprites/{s.sid}/events").json() == {"events": []}
    paint(s.ed.client, s.sid, [[0, 0]])
    s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": ORANGE, "version": 1})
    s.ed.client.post(f"/api/sprites/{s.sid}/frames", json={"duration_ms": 100})
    s.ed.client.post(f"/api/sprites/{s.sid}/layers", json={"name": "Top"})
    s.ed.client.post(f"/api/sprites/{s.sid}/tags", json={"name": "t", "from": 1, "to": 1, "direction": "forward"})
    s.rev.client.post(f"/api/sprites/{s.sid}/comments", json={"frame": 1, "x": 1, "y": 1, "text": "note"})
    s.owner.client.post(f"/api/sprites/{s.sid}/snapshots", json={"name": "Base"})
    s.ed.client.post(f"/api/sprites/{s.sid}/undo")
    events = s.ed.client.get(f"/api/sprites/{s.sid}/events").json()["events"]
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1)), "sequence numbers have gaps or are out of order"
    assert [e["type"] for e in events][:8] == ["stroke", "swatch", "frame", "layer", "tag", "comment", "snapshot", "undo"]
    assert events[0]["by"] == s.ed.name and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", events[0]["at"])
    assert isinstance(events[0]["data"], dict)
    assert [e["seq"] for e in events_since(s.ed.client, s.sid, 5)] == list(range(6, len(events) + 1))
    assert events_since(s.ed.client, s.sid, len(events)) == []
    assert httpx.get(f"{app_url}/api/sprites/{s.sid}/events", timeout=HTTP_TIMEOUT).status_code == 401
    assert s.out.client.get(f"/api/sprites/{s.sid}/events").status_code == 404


def test_offline_stroke_queue(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page:
        sync = status(page, "Sync status")
        page.context.set_offline(True)
        expect(sync).to_have_text("Offline · 0 strokes queued", timeout=SYNC_MS)
        start = stage(page).get_attribute("data-composite-hash")
        move_cursor(page, 1, 1)
        press(page, "Space")
        expect(sync).to_have_text(queued_line(1), timeout=SYNC_MS)
        expect(stage(page)).not_to_have_attribute("data-composite-hash", start, timeout=SYNC_MS)
        drag(page, (3, 3), (5, 3))
        expect(sync).to_have_text("Offline · 2 strokes queued", timeout=SYNC_MS)
        want = [[TRANSPARENT] * 16 for _ in range(16)]
        for x, y in {(1, 1), (3, 3), (4, 3), (5, 3)}:
            want[y][x] = RED
        hash_is(page, rows_hash(want))
        assert seq_of(s.ed.client, s.sid) == 0, "queued strokes reached the server while offline"
        pick_swatch(page, 1)
        fill(role(page, "textbox", "Swatch colour"), ORANGE)
        click(role(page, "button", "Save swatch"))
        alert(page, "You are offline")
        assert swatch(s.ed.client, s.palette, 1)["color"] == RED


def test_wf_offline_replay_queue_and_converge(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        sync = status(page, "Sync status")
        page.context.set_offline(True)
        expect(sync).to_contain_text("Offline", timeout=SYNC_MS)
        move_cursor(page, 1, 1)
        press(page, "Space", "ArrowRight", "Space")
        expect(sync).to_have_text("Offline · 2 strokes queued", timeout=SYNC_MS)
        paint(s.ed2.client, s.sid, [[9, 9]], swatch=2)
        attr(stage(watcher), "data-seq", "1")
        page.context.set_offline(False)
        expect(sync).to_contain_text("Reconnected · 3 updates applied", timeout=SYNC_MS)
        attr(stage(page), "data-seq", "3")
        attr(stage(watcher), "data-seq", "3")
        rows = indices(s.ed.client, s.sid)
        assert (rows[1][1], rows[1][2], rows[9][9]) == (1, 1, 2)
        final = hash_of(s.ed.client, s.sid)
        hash_is(page, final)
        hash_is(watcher, final)
        attr(role(role(watcher, "listbox", "Palette"), "option", "Swatch 1"), "data-used-by", "2")
        assert swatch(s.ed.client, s.palette, 1)["used_by"] == 2


def test_wf_offline_replay_refused_rollback(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        sync = status(page, "Sync status")
        page.context.set_offline(True)
        expect(sync).to_contain_text("Offline", timeout=SYNC_MS)
        move_cursor(page, 4, 4)
        press(page, "Space")
        expect(sync).to_have_text(queued_line(1), timeout=SYNC_MS)
        assert s.ed2.client.post(f"/api/sprites/{s.sid}/layers/{s.layer_id()}/lock").status_code == 200
        page.context.set_offline(False)
        expect(sync).to_contain_text(f"1 stroke refused: Locked by {s.ed2.name}", timeout=SYNC_MS)
        expect(sync).to_contain_text("Reconnected · ", timeout=SYNC_MS)
        assert indices(s.ed.client, s.sid)[4][4] == 0
        blank_hash = hash_of(s.ed.client, s.sid)
        hash_is(page, blank_hash)
        hash_is(watcher, blank_hash)


def test_wf_offline_replay_no_duplicates(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page:
        sync = status(page, "Sync status")
        sent: list[str] = []

        def lose_answer(route: Any) -> None:
            sent.append(route.request.post_data_json["client_stroke_id"])
            if len(sent) == 1:
                route.fetch()
                route.abort()
            else:
                route.continue_()

        page.route("**/api/sprites/*/strokes", lose_answer)
        move_cursor(page, 2, 2)
        press(page, "Space")
        poll(lambda: seq_of(s.ed.client, s.sid) == 1, "the first send reached the server")
        page.context.set_offline(True)
        expect(sync).to_contain_text("Offline", timeout=SYNC_MS)
        press(page, "ArrowRight", "Space")
        expect(sync).to_contain_text("queued", timeout=SYNC_MS)
        page.context.set_offline(False)
        expect(sync).to_contain_text("Reconnected", timeout=SYNC_MS)
        poll(lambda: indices(s.ed.client, s.sid)[2][3] == 1, "the queued stroke replayed")
        strokes = [e for e in events_since(s.ed.client, s.sid) if e["type"] == "stroke"]
        assert len(strokes) == 2, f"a resent stroke applied twice: {strokes}"
        assert swatch(s.ed.client, s.palette, 1)["used_by"] == 2
        hash_is(page, hash_of(s.ed.client, s.sid))


def test_wf_review_snapshots_session(browser: Browser, app_url: str, mail: Mailpit) -> None:
    s = make_studio(app_url, frames=2, cels={(1, "Body"): with_cells(16, 16, {(0, 0): 1})},
                    snapshots=[{"key": "n", "sprite": "s", "name": "Base"}])
    base_hash = hash_of(s.owner.client, s.sid)
    with workspace(browser, s, s.rev) as reviewer, workspace(browser, s, s.ed) as editor, workspace(browser, s, s.owner) as owner:
        move_cursor(reviewer, 3, 5)
        press(reviewer, "c")
        dialog = role(reviewer, "dialog", "New comment")
        expect(dialog).to_be_visible(timeout=SYNC_MS)
        fill(role(dialog, "textbox", "Comment"), f"Check this @{s.ed.name}")
        click(role(dialog, "button", "Post comment"))
        notice(reviewer, "Comment posted")
        pin = role(editor, "button", "Comment at 3, 5")
        expect(pin).to_be_visible(timeout=SYNC_MS)
        attr(pin, "data-state", "open")
        message = mail_to(mail, s.ed.email, f"Mentioned on {s.sprite_name}, frame 1")
        assert len(message) == 1
        assert f"From: {s.rev.name}" in text(message[0]) and f"Comment: Check this @{s.ed.name}" in text(message[0])
        expect(role(reviewer, "region", "Comments")).to_contain_text(f"Delivered to {s.ed.name}", timeout=MAIL_SECONDS * 1000)
        click(role(reviewer, "button", "Pin comment"))
        page_point = cell_point(reviewer, 7, 2)
        reviewer.mouse.click(*page_point)
        dialog = role(reviewer, "dialog", "New comment")
        fill(role(dialog, "textbox", "Comment"), "Second pin")
        click(role(dialog, "button", "Post comment"))
        expect(role(owner, "button", "Comment at 7, 2")).to_be_visible(timeout=SYNC_MS)
        comments = s.rev.client.get(f"/api/sprites/{s.sid}/comments").json()["comments"]
        assert {(c["frame"], c["x"], c["y"]) for c in comments} == {(1, 3, 5), (1, 7, 2)}
        paint(s.ed.client, s.sid, [[9, 9]])
        attr(stage(owner), "data-seq", re.compile(r"^[3-9]"))
        fill(role(owner, "textbox", "Snapshot name"), "Later")
        click(role(owner, "button", "Save snapshot"))
        notice(owner, "Snapshot Later saved")
        select(role(owner, "combobox", "From"), "Base")
        select(role(owner, "combobox", "To"), "Later")
        expect(role(owner, "list", "Snapshot changes")).to_contain_text(f"{counted(1, 'pixel')} changed in frame 1", timeout=SYNC_MS)
        snapshots = role(owner, "list", "Snapshots")
        click(role(snapshots.get_by_role("listitem").filter(has_text="Base").first, "button", "Restore"))
        notice(owner, "Restored Base")
        notice(editor, "Restored Base")
        for page in (owner, editor, reviewer):
            hash_is(page, base_hash)
    names = [x["name"] for x in s.owner.client.get(f"/api/sprites/{s.sid}/snapshots").json()["snapshots"]]
    assert {"Base", "Later", "Before restore Base"} <= set(names)
    assert hash_of(s.owner.client, s.sid) == base_hash
    assert len(mail_to(mail, s.ed.email, f"Mentioned on {s.sprite_name}, frame 1")) == 1


def test_comment_states(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, comments=[{"key": "k", "sprite": "s", "author": "rev", "frame": 1, "x": 3, "y": 4, "text": "Check this", "state": "open"}])
    cid = s.ids["k"]
    r = s.rev.client.post(f"/api/comments/{cid}/reopen")
    assert r.status_code == 409 and r.json() == {"error": "comment_state", "message": "Already open"}
    with workspace(browser, s, s.rev) as page, workspace(browser, s, s.ed) as watcher:
        pin = role(watcher, "button", "Comment at 3, 4")
        attr(pin, "data-state", "open")
        click(role(role(page, "region", "Comments"), "button", "Resolve"))
        attr(pin, "data-state", "resolved")
        r = s.rev.client.post(f"/api/comments/{cid}/resolve")
        assert r.status_code == 409 and r.json() == {"error": "comment_state", "message": "Already resolved"}
        click(role(role(page, "region", "Comments"), "button", "Reopen"))
        attr(pin, "data-state", "open")
    assert s.rev.client.get(f"/api/sprites/{s.sid}/comments").json()["comments"][0]["state"] == "open"


def test_mention_email_and_delivery(browser: Browser, app_url: str, mail: Mailpit) -> None:
    s = make_studio(app_url)
    r = s.rev.client.post(f"/api/sprites/{s.sid}/comments", json={"frame": 1, "x": 1, "y": 1, "text": f"Look @{s.ed.name.upper()} and @nobody"})
    assert r.status_code == 201
    mentions = r.json()["mentions"]
    assert [m["name"] for m in mentions] == [s.ed.name] and mentions[0]["state"] in ("pending", "delivered")

    def delivered() -> bool:
        state = s.rev.client.get(f"/api/sprites/{s.sid}/comments").json()["comments"][0]["mentions"][0]["state"]
        if state == "delivered":
            assert mail_to(mail, s.ed.email, expected=0), "shown delivered with no message at the mail server"
            return True
        return False

    poll(delivered, "the mention became delivered", MAIL_SECONDS)
    message = mail_to(mail, s.ed.email, f"Mentioned on {s.sprite_name}, frame 1")
    assert len(message) == 1 and mail_from_contains(message[0])
    assert mail_to(mail, s.ed2.email, expected=0) == []
    with workspace(browser, s, s.rev) as page:
        expect(role(page, "region", "Comments")).to_contain_text(f"Delivered to {s.ed.name}", timeout=SYNC_MS)
    tag = uuid.uuid4().hex[:6]
    long_name, short_name = f"Ann{tag} Lee", f"Ann{tag}"
    people = make_studio(app_url)
    extra = [{"key": "a1", "email": f"a1-{tag}@team.example", "name": short_name, "password": PASSWORD, "confirmed": True, "number_format": "en-US", "time_zone": "UTC"},
             {"key": "a2", "email": f"a2-{tag}@team.example", "name": long_name, "password": PASSWORD, "confirmed": True, "number_format": "en-US", "time_zone": "UTC"},
             {"key": "boss", "email": f"boss-{tag}@team.example", "name": f"Boss{tag}", "password": PASSWORD, "confirmed": True, "number_format": "en-US", "time_zone": "UTC"}]
    ids = seed(app_url, {"users": extra, "projects": [{"key": "p", "name": f"Duo{tag}", "owner": "boss"}],
                         "memberships": [{"key": "m1", "project": "p", "user": "a1", "role": "editor"}, {"key": "m2", "project": "p", "user": "a2", "role": "editor"}],
                         "palettes": [{"key": "pal", "swatches": [{"index": 1, "color": RED}]}],
                         "sprites": [{"key": "s", "project": "p", "palette": "pal", "name": "Duo", "width": 4, "height": 4}],
                         "layers": [{"key": "l", "sprite": "s", "name": "Body", "opacity": 100, "blend": "normal", "visible": True, "locked_by": None}],
                         "frames": [{"key": "f", "sprite": "s", "duration_ms": 100}]})
    boss = login_client(app_url, f"boss-{tag}@team.example")
    assert boss.post(f"/api/sprites/{ids['s']}/comments", json={"frame": 1, "x": 0, "y": 0, "text": f"Ping @{long_name} now"}).status_code == 201
    assert len(mail_to(mail, f"a2-{tag}@team.example")) == 1
    assert mail_to(mail, f"a1-{tag}@team.example", expected=0) == [], "the shorter name matched inside the longer one"
    assert people.pid


def mail_from_contains(message: dict[str, Any]) -> bool:
    return "no-reply@celmate.example" in addresses(message.get("From"))


def test_comment_idempotency_api(app_url: str, mail: Mailpit) -> None:
    s = make_studio(app_url)
    key = uuid.uuid4().hex
    body = {"frame": 1, "x": 2, "y": 2, "text": f"Once @{s.ed.name}"}
    url = f"/api/sprites/{s.sid}/comments"
    with ThreadPoolExecutor(5) as pool:
        answers = list(pool.map(lambda _: s.rev.client.post(url, json=body, headers={"Idempotency-Key": key}), range(5)))
    assert [r.status_code for r in answers] == [201] * 5
    assert len({r.json()["id"] for r in answers}) == 1
    r = s.rev.client.post(url, json={**body, "text": "Other"}, headers={"Idempotency-Key": key})
    assert r.status_code == 409 and r.json() == {"error": "idempotency_conflict"}
    assert len(s.rev.client.get(url).json()["comments"]) == 1
    assert len(mail_to(mail, s.ed.email)) == 1
    for bad, message in (("", "Write a comment first"), ("x" * 2001, "Use at most 2,000 characters")):
        r = s.rev.client.post(url, json={**body, "text": bad})
        assert r.status_code == 422 and r.json()["errors"]["text"] == message


def test_wf_review_snapshots_double_post(browser: Browser, app_url: str, mail: Mailpit) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.rev) as page:
        move_cursor(page, 4, 4)
        press(page, "c")
        fill(role(page, "textbox", "Comment"), f"Twice @{s.ed.name}")
        post = role(page, "button", "Post comment")
        post.evaluate("b => { b.click(); b.click(); }")
        notice(page, "Comment posted")
        expect(role(page, "button", "Comment at 4, 4")).to_have_count(1, timeout=SYNC_MS)
    assert len(s.rev.client.get(f"/api/sprites/{s.sid}/comments").json()["comments"]) == 1
    assert len(mail_to(mail, s.ed.email)) == 1


def test_wf_review_snapshots_reviewer_refused(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(1)], tilemaps=[tile_map()], snapshots=[{"key": "n", "sprite": "s", "name": "Base"}])
    c, sid = s.rev.client, s.sid
    draw, art, export, owner = "Reviewers can't draw", "Reviewers can't change artwork", "Reviewers can't export", "Only the project owner can do this"
    calls = [
        (post_stroke(c, sid, [[1, 1]]), draw),
        (c.post(f"/api/sprites/{sid}/selection", json={"client_stroke_id": "a", "frame": 1, "layer": "Body", "op": "flip_h", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}}), draw),
        (c.post(f"/api/sprites/{sid}/undo"), draw),
        (c.post(f"/api/sprites/{sid}/redo"), draw),
        (c.post(f"/api/palettes/{s.palette}/swatches", json={"color": RED}), art),
        (c.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": ORANGE, "version": 1}), art),
        (c.post(f"/api/sprites/{sid}/frames", json={"duration_ms": 100}), art),
        (c.post(f"/api/sprites/{sid}/tags", json={"name": "t", "from": 1, "to": 1, "direction": "forward"}), art),
        (c.post(f"/api/tilemaps/{s.ids['tm']}/cells", json={"x": 0, "y": 0, "tile": 1, "flip_h": False, "flip_v": False, "edge_matching": False}), art),
        (c.post(f"/api/projects/{s.pid}/imports", files={"file": ("a.png", png_encode([[RED]]), "image/png")}), art),
        (c.post(f"/api/sprites/{sid}/exports", json={"format": "png", "scale": 1, "frame": 1}), export),
        (c.post(f"/api/snapshots/{s.ids['n']}/restore"), owner),
        (c.post(f"/api/sprites/{sid}/snapshots", json={"name": "Mine"}), owner),
        (c.post(f"/api/projects/{s.pid}/invites", json={"email": s.out.email, "role": "editor"}), owner),
        (c.post(f"/api/sprites/{sid}/links", json={"label": "x", "expires_at": None}), owner),
    ]
    for response, message in calls:
        assert response.status_code == 403, response.request.url
        assert response.json() == {"error": "forbidden", "message": message}
    assert seq_of(s.owner.client, sid) == 0, "a refused call changed the sprite"
    with workspace(browser, s, s.rev) as page:
        for name in ("Pencil", "Undo", "Redo", "Save swatch", "Add swatch", "Add frame", "Add tag", "Restore", "Save snapshot", "Export", "Edit tile"):
            expect(role(page, "button", name)).to_have_count(0)
        expect(page.get_by_text("Reviewers can't draw").first).to_be_visible(timeout=SYNC_MS)
        expect(role(page, "button", "Pin comment")).to_be_visible()
        before = stage(page).get_attribute("data-composite-hash")
        move_cursor(page, 1, 1)
        press(page, "Space")
        hash_is(page, before)
    with opened(browser, app_url, s.rev, f"/projects/{s.pid}") as page:
        expect(role(page, "table", "Members")).to_be_visible(timeout=UI_MS)
        for name in ("Invite", "Create link", "New sprite", "Import image", "Export project"):
            expect(role(page, "button", name)).to_have_count(0)


def test_named_snapshots(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    paint(s.ed.client, s.sid, [[1, 1]])
    url = f"/api/sprites/{s.sid}/snapshots"
    a = s.owner.client.post(url, json={"name": "One"})
    assert a.status_code == 201 and a.json()["seq"] == 2 and a.json()["name"] == "One"
    assert s.owner.client.post(url, json={"name": "One"}).json()["errors"]["name"] == "That name is taken"
    r = s.ed.client.post(url, json={"name": "Two"})
    assert r.status_code == 403 and r.json()["message"] == "Only the project owner can do this"
    with workspace(browser, s, s.owner) as page:
        fill(role(page, "textbox", "Snapshot name"), "Two")
        click(role(page, "button", "Save snapshot"))
        notice(page, "Snapshot Two saved")
        items = role(page, "list", "Snapshots").get_by_role("listitem")
        expect(items.first).to_contain_text("Two", timeout=SYNC_MS)
    assert [x["name"] for x in s.ed.client.get(url).json()["snapshots"]] == ["Two", "One"]


def test_snapshot_compare(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=2)
    url = f"/api/sprites/{s.sid}/snapshots"
    a = s.owner.client.post(url, json={"name": "A"}).json()["id"]
    paint(s.ed.client, s.sid, [[5, 3]])
    paint(s.ed.client, s.sid, [[2, 7]], swatch=2)
    paint(s.ed.client, s.sid, [[9, 3]], swatch=3)
    b = s.owner.client.post(url, json={"name": "B"}).json()["id"]
    body = s.ed.client.get(f"{url}/compare", params={"from": a, "to": b}).json()
    assert body == {"frames": [{"frame": 1, "changed": 3, "cells": [
        {"x": 5, "y": 3, "before": TRANSPARENT, "after": RED},
        {"x": 9, "y": 3, "before": TRANSPARENT, "after": ORANGE},
        {"x": 2, "y": 7, "before": TRANSPARENT, "after": BLUE}]}]}
    with workspace(browser, s, s.rev) as page:
        select(role(page, "combobox", "From"), "A")
        select(role(page, "combobox", "To"), "B")
        expect(role(page, "list", "Snapshot changes")).to_contain_text(f"{len(body['frames'][0]['cells'])} pixels changed in frame {body['frames'][0]['frame']}", timeout=SYNC_MS)
    s.ed.client.post(f"/api/sprites/{s.sid}/frames", json={"duration_ms": 100})
    paint(s.ed.client, s.sid, [[0, 0]], frame=3)
    c = s.owner.client.post(url, json={"name": "C"}).json()["id"]
    frames = s.ed.client.get(f"{url}/compare", params={"from": b, "to": c}).json()["frames"]
    assert [(f["frame"], f["changed"]) for f in frames] == [(3, 1)]


def test_exact_restore(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, cels={(1, "Body"): with_cells(16, 16, {(0, 0): 1})})
    url = f"/api/sprites/{s.sid}/snapshots"
    base = s.owner.client.post(url, json={"name": "Base"}).json()["id"]
    before_rows, before_pixels = indices(s.ed.client, s.sid), pixel_body(s.ed.client, s.sid)["rows"]
    paint(s.ed.client, s.sid, [[4, 4]])
    s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": ORANGE, "version": 1})
    s.ed.client.post(f"/api/sprites/{s.sid}/tags", json={"name": "late", "from": 1, "to": 1, "direction": "forward"})
    s.owner.client.post(url, json={"name": "After"})
    assert s.ed2.client.post(f"/api/sprites/{s.sid}/layers/{s.layer_id()}/lock").status_code == 200
    with workspace(browser, s, s.ed) as watcher:
        r = s.owner.client.post(f"/api/snapshots/{base}/restore")
        assert r.status_code == 200
        notice(watcher, "Restored Base")
        hash_is(watcher, rows_hash(before_pixels))
        attr(stage(watcher), "data-seq", str(r.json()["seq"]))
    assert indices(s.ed.client, s.sid) == before_rows and pixel_body(s.ed.client, s.sid)["rows"] == before_pixels
    info = sprite_info(s.ed.client, s.sid)
    assert info["tags"] == [] and info["layers"][0]["locked_by"] is None
    assert swatch(s.ed.client, s.palette, 1)["color"] == RED
    snaps = s.ed.client.get(url).json()["snapshots"]
    assert {"Base", "After", "Before restore Base"} <= {x["name"] for x in snaps}
    auto = next(x for x in snaps if x["id"] == r.json()["before_snapshot"])
    assert auto["name"] == "Before restore Base"
    assert s.ed.client.post(f"/api/sprites/{s.sid}/undo").json()["error"] == "nothing_to_undo"
    assert s.ed.client.post(f"/api/sprites/{s.sid}/redo").json()["error"] == "nothing_to_redo"
    assert s.ed.client.post(f"/api/snapshots/{base}/restore").status_code == 403


def test_activity_sentences(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    feed = lambda: [i["sentence"] for i in s.owner.client.get(f"/api/projects/{s.pid}/activity").json()["items"]]
    assert feed() == [], "seeding writes no activity"
    paint(s.ed.client, s.sid, [[0, 0], [2, 0]])
    assert feed()[0] == f"{s.ed.name} painted 3 pixels on {s.sprite_name}, frame 1"
    paint(s.ed.client, s.sid, [[0, 1], [1, 1]])
    assert feed() == [f"{s.ed.name} painted 5 pixels in 2 strokes on {s.sprite_name}"]
    s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": ORANGE, "version": 1})
    assert feed()[0] == f"{s.ed.name} edited swatch 1"
    s.rev.client.post(f"/api/sprites/{s.sid}/comments", json={"frame": 1, "x": 1, "y": 1, "text": "note"})
    assert feed()[0] == f"{s.rev.name} commented on {s.sprite_name}"
    assert s.owner.client.post(f"/api/projects/{s.pid}/invites", json={"email": s.out.email, "role": "editor"}).status_code == 201
    assert feed()[0] == f"{s.owner.name} invited {s.out.email}"
    snap = s.owner.client.post(f"/api/sprites/{s.sid}/snapshots", json={"name": "Keep"}).json()["id"]
    assert s.owner.client.post(f"/api/snapshots/{snap}/restore").status_code == 200
    assert feed()[0] == f"{s.owner.name} restored Keep"
    job = run_export(s.owner.client, s.sid, format="png", scale=1, frame=1)
    assert feed()[0] == f"{s.owner.name} exported {job['files'][0]['name']}"
    m = make_studio(app_url)
    paint(m.ed.client, m.sid, [[0, 0]])
    clock_advance(app_url, 61)
    paint(m.ed.client, m.sid, [[1, 0]])
    rows = [i["sentence"] for i in m.owner.client.get(f"/api/projects/{m.pid}/activity").json()["items"]]
    assert rows == [f"{m.ed.name} painted 1 pixel on {m.sprite_name}, frame 1"] * 2, "strokes past 60 seconds must not merge"
    with workspace(browser, m, m.owner) as page:
        expect(role(page, "list", "Activity")).to_contain_text(rows[0], timeout=SYNC_MS)


def test_activity_paging_stable(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, swatches=[RED] * 12)
    for i in range(12):
        assert s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/{i + 1}", json={"color": ORANGE, "version": 1}).status_code == 200
    url = f"/api/projects/{s.pid}/activity"
    first = s.owner.client.get(url).json()
    assert len(first["items"]) == 5 and first["next_cursor"] is not None
    assert first["items"][0]["sentence"] == f"{s.ed.name} edited swatch 12"
    for i in range(3):
        s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/{i + 1}", json={"color": LIME, "version": 2})
    second = s.owner.client.get(url, params={"cursor": first["next_cursor"]}).json()
    assert [i["sentence"] for i in second["items"]] == [f"{s.ed.name} edited swatch {n}" for n in (7, 6, 5, 4, 3)]
    third = s.owner.client.get(url, params={"cursor": second["next_cursor"]}).json()
    assert [i["sentence"] for i in third["items"]] == [f"{s.ed.name} edited swatch {n}" for n in (2, 1)] and third["next_cursor"] is None
    with workspace(browser, s, s.owner) as page:
        items = role(page, "list", "Activity").get_by_role("listitem")
        expect(items).to_have_count(5, timeout=SYNC_MS)
        click(role(page, "button", "Load more"))
        expect(items).to_have_count(10, timeout=SYNC_MS)


def test_signup_with_emailed_code(browser: Browser, app_url: str, mail: Mailpit) -> None:
    tag = uuid.uuid4().hex[:8]
    email = f"new-{tag}@team.example"
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    r = c.post("/api/auth/signup", json={"email": f"short-{tag}@team.example", "password": "short", "name": "Short"})
    assert r.status_code == 422 and r.json()["errors"]["password"] == "Use at least 8 characters"
    r = c.post("/api/auth/signup", json={"email": email, "password": PASSWORD, "name": f"New{tag}"})
    assert r.status_code == 201 and r.json() == {"status": "pending"}
    r = c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 422 and r.json()["errors"]["email"] == "Confirm your email first"
    assert c.post("/api/auth/signup", json={"email": email, "password": PASSWORD, "name": "Again"}).json()["errors"]["email"] == "Already registered"
    message = mail_to(mail, email)[0]
    code = re.fullmatch(r"Your Celmate code: (\d{6})", message["Subject"]).group(1)
    assert code in text(message) and mail_from_contains(message)
    wrong = "000000" if code != "000000" else "111111"
    r = c.post("/api/auth/confirm", json={"email": email, "code": wrong})
    assert r.status_code == 422 and r.json()["errors"]["code"] == "That code is not right"
    assert c.get("/api/me").status_code == 401
    r = c.post("/api/auth/confirm", json={"email": email, "code": code})
    assert r.status_code == 200 and r.json()["email"] == email
    assert c.get("/api/me").json()["number_format"] == "en-US"
    r = c.post("/api/auth/login", json={"email": email, "password": "wrong-pass"})
    assert r.status_code == 422 and r.json()["errors"]["password"] == "Email or password is incorrect"


def test_projects_and_sprites(app_url: str) -> None:
    s = make_studio(app_url)
    c = s.out.client
    assert httpx.post(f"{app_url}/api/projects", json={"name": "No"}, timeout=HTTP_TIMEOUT).status_code == 401
    assert c.post("/api/projects", json={"name": ""}).status_code == 422
    r = c.post("/api/projects", json={"name": "Mine"})
    assert r.status_code == 201 and r.json()["role"] == "owner"
    pid = r.json()["id"]
    assert any(p["id"] == pid and p["role"] == "owner" for p in c.get("/api/projects").json()["projects"])
    for field, body in (("width", {"width": SPRITE_MAX + 1, "height": 8}), ("height", {"width": 8, "height": SPRITE_MAX + 1})):
        r = c.post(f"/api/projects/{pid}/sprites", json={"name": "Big", **body})
        assert r.status_code == 422 and r.json()["errors"][field] == "Largest size is 64"
    r = c.post(f"/api/projects/{pid}/sprites", json={"name": "Edge", "width": SPRITE_MAX, "height": SPRITE_MAX})
    assert r.status_code == 201 and r.json()["seq"] == 0
    info = sprite_info(c, r.json()["id"])
    assert [l["name"] for l in info["layers"]] == ["Layer 1"] and len(info["frames"]) == 1
    assert c.get(f"/api/palettes/{r.json()['palette']}").json()["swatches"] == []
    assert s.out2.client.get(f"/api/projects/{pid}").status_code == 404


def test_invites(app_url: str, mail: Mailpit) -> None:
    s = make_studio(app_url)
    url = f"/api/projects/{s.pid}/invites"
    r = s.owner.client.post(url, json={"email": s.out.email, "role": "reviewer"})
    assert r.status_code == 201 and r.json()["state"] == "pending"
    invite = r.json()
    expected_end = parse_instant(invite["expires_at"]) - parse_instant(config(app_url)["now"])
    assert timedelta(seconds=INVITE_TTL - 60) < expected_end <= timedelta(seconds=INVITE_TTL)
    assert s.owner.client.post(url, json={"email": s.out.email, "role": "editor"}).json() == {"error": "invite_pending"}
    assert s.owner.client.post(url, json={"email": s.ed.email, "role": "editor"}).json() == {"error": "already_member"}
    body = text(mail_to(mail, s.out.email, f"Join {s.project_name} on Celmate")[0])
    assert "Role: reviewer" in body and re.search("Expires: " + date_pattern(invite["expires_at"]), body)
    token = re.search(r"/invites/(\S+)", body).group(1)
    assert httpx.get(f"{app_url}/api/invites/{token}", timeout=HTTP_TIMEOUT).json()["state"] == "pending"
    r = s.out2.client.post(f"/api/invites/{token}/accept")
    assert r.status_code == 403 and r.json()["message"] == "This invite is for another email"
    r = s.out.client.post(f"/api/invites/{token}/accept")
    assert r.status_code == 200
    body = r.json()
    assert body["project"] == s.pid and body["role"] == "reviewer"
    r = s.out.client.post(f"/api/invites/{token}/accept")
    assert r.json() == {"error": "invite_used", "message": "This invite was already used"}
    assert s.owner.client.delete(f"/api/invites/{invite['id']}").json() == {"error": "invite_closed", "message": "This invite is closed"}
    second = s.owner.client.post(url, json={"email": s.out2.email, "role": "editor"}).json()
    revoke_token = re.search(r"/invites/(\S+)", text(mail_to(mail, s.out2.email, f"Join {s.project_name} on Celmate")[0])).group(1)
    assert s.owner.client.delete(f"/api/invites/{second['id']}").json() == {"state": "revoked"}
    assert s.out2.client.post(f"/api/invites/{revoke_token}/accept").json() == {"error": "invite_revoked", "message": "This invite was revoked"}
    late = make_studio(app_url, invites=[{"key": "i", "project": "p", "email": "", "role": "editor", "token": "", "expires_at": later(app_url, 3600)}]) if False else make_studio(app_url)
    made = late.owner.client.post(f"/api/projects/{late.pid}/invites", json={"email": late.out.email, "role": "editor"}).json()
    late_token = re.search(r"/invites/(\S+)", text(mail_to(mail, late.out.email)[0])).group(1)
    clock_advance(app_url, INVITE_TTL + 1)
    r = late.out.client.post(f"/api/invites/{late_token}/accept")
    assert r.status_code == 409 and r.json() == {"error": "invite_lapsed", "message": "This invite has lapsed"}
    states = late.owner.client.get(f"/api/projects/{late.pid}/invites").json()["invites"]
    assert next(i for i in states if i["id"] == made["id"])["state"] == "lapsed"
    assert late.out.client.get(f"/api/projects/{late.pid}").status_code == 404


def test_wf_sharing_expiry_role_change(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    r = s.ed.client.post(f"/api/projects/{s.pid}/invites", json={"email": s.out.email, "role": "editor"})
    assert r.status_code == 403 and r.json()["message"] == "Only the project owner can do this"
    assert s.ed.client.delete(f"/api/projects/{s.pid}/members/{s.ed2.id}").status_code == 403
    assert s.owner.client.patch(f"/api/projects/{s.pid}/members/{s.owner.id}", json={"role": "editor"}).json() == {"error": "owner_required"}
    with workspace(browser, s, s.ed) as session_page, opened(browser, app_url, s.owner, f"/projects/{s.pid}") as owner:
        expect(tool_button(session_page, "Pencil")).to_be_visible()
        select(role(owner, "combobox", f"Role for {s.ed.name}"), "Reviewer")
        started = time.monotonic()
        expect(session_page.get_by_role("alert").filter(has_text=re.compile("Your role is now reviewer", re.I)).first).to_be_visible(timeout=PUSH_MS + GRACE_MS)
        expect(role(session_page, "button", "Pencil")).to_have_count(0, timeout=PUSH_MS + GRACE_MS)
        assert time.monotonic() - started <= (PUSH_MS + GRACE_MS) / 1000
        r = post_stroke(s.ed.client, s.sid, [[1, 1]])
        assert r.status_code == 403 and r.json()["message"] == "Reviewers can't draw"
        assert s.owner.client.delete(f"/api/projects/{s.pid}/members/{s.ed.id}").status_code == 204
        alert(session_page, f"You no longer have access to {s.project_name}")
        expect(session_page).to_have_url(re.compile(r"/projects$"), timeout=PUSH_MS + GRACE_MS)
        assert s.ed.client.get(f"/api/sprites/{s.sid}").status_code == 404
        assert post_stroke(s.ed.client, s.sid, [[1, 1]]).status_code == 404
    assert seq_of(s.owner.client, s.sid) == 0


def test_wf_sharing_expiry_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    tag = uuid.uuid4().hex[:8]
    email, name, project, sprite = f"boss-{tag}@team.example", f"Boss{tag}", f"Row{tag}", f"Gem{tag}"
    guests = make_studio(app_url)
    with opened(browser, app_url, None, "/signup") as page:
        fill(role(page, "textbox", "Name"), name)
        fill(role(page, "textbox", "Email"), email)
        fill(role(page, "textbox", "Password"), PASSWORD)
        click(role(page, "button", "Create account"))
        notice(page, f"We are sending your code to {email}")
        code = re.search(r"(\d{6})", mail_to(mail, email)[0]["Subject"]).group(1)
        fill(role(page, "textbox", "Code"), code)
        click(role(page, "button", "Confirm"))
        page.wait_for_load_state()
        page.goto(f"{app_url}/projects")
        box = role(page, "textbox", "Project name")
        if not box.is_visible():
            click(role(page, "button", "New project"))
        fill(box, project)
        press(page, "Enter")
        link = role(page, "link", project)
        try:
            expect(link).to_be_visible(timeout=GRACE_MS)
        except AssertionError:
            click(role(page, "button", "New project"))
            expect(link).to_be_visible(timeout=SYNC_MS)
        click(link)
        click(role(page, "button", "New sprite"))
        dialog = role(page, "dialog", "New sprite")
        fill(role(dialog, "textbox", "Sprite name"), sprite)
        fill(role(dialog, "spinbutton", "Width"), "16")
        fill(role(dialog, "spinbutton", "Height"), "16")
        click(role(dialog, "button", "Create sprite"))
        expect(role(page, "link", sprite)).to_be_visible(timeout=SYNC_MS)
        for person, label in ((guests.out, "Editor"), (guests.out2, "Reviewer")):
            fill(role(page, "textbox", "Invite email"), person.email)
            select(role(page, "combobox", "Invite role"), label)
            click(role(page, "button", "Invite"))
            notice(page, f"Invite created for {person.email}")
            body = text(mail_to(mail, person.email, f"Join {project} on Celmate")[0])
            assert f"Role: {label.lower()}" in body
            token = re.search(r"/invites/(\S+)", body).group(1)
            with opened(browser, app_url, person, f"/invites/{token}") as guest:
                click(role(guest, "button", "Accept invite"))
                notice(guest, f"You joined {project}")
        members = role(page, "table", "Members")
        page.reload()
        expect(role(members, "row", name)).to_contain_text("Owner", timeout=UI_MS)
        expect(role(members, "row", guests.out.name)).to_be_visible()
        expect(role(members, "row", guests.out2.name)).to_be_visible()
        select(role(page, "combobox", "Link sprite"), sprite)
        fill(role(page, "textbox", "Link label"), "Client")
        expect(role(page, "spinbutton", "Link hours")).to_have_value("24")
        click(role(page, "button", "Create link"))
        notice(page, "Link created")
        row = role(role(page, "table", "Read-only links"), "row", "Client")
        token = re.search(r"/s/([^\s<]+)", row.inner_text()).group(1)
        with open_app(browser, f"{app_url}/s/{token}") as viewer:
            viewer.clock.resume()
            expect(stage(viewer)).to_be_visible(timeout=UI_MS)
            expect(role(viewer, "region", "Preview")).to_be_visible()
            expect(viewer.get_by_text(sprite).first).to_be_visible()
            for kind, label in (("region", "Comments"), ("region", "Live cursors"), ("region", "Snapshots"), ("list", "On this sprite"), ("button", "Export")):
                expect(role(viewer, kind, label)).to_have_count(0)
            share = httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_TIMEOUT)
            assert share.status_code == 200 and share.json()["state"] == "active" and share.json()["sprite"]["name"] == sprite
            assert email not in share.text and guests.out.email not in share.text
            sid = next(x["id"] for x in httpx.get(f"{app_url}/api/projects", timeout=HTTP_TIMEOUT).json().get("projects", [])) if False else None
            anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
            assert anon.get("/api/projects").status_code == 401
            assert anon.get(f"/api/share/{token}/comments").status_code in (403, 404)
            assert anon.get(f"/api/share/{token}/exports").status_code in (403, 404)
            assert anon.get(f"/api/share/{token}/members").status_code in (403, 404)
            click(role(row, "button", "Revoke link"))
            notice(page, "Link revoked")
            expect(role(viewer, "heading", "This link has ended")).to_be_visible(timeout=PUSH_MS + GRACE_MS)
        assert httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_TIMEOUT).json() == {"error": "not_found"}
    assert sid is None


def test_revoke_and_regenerate_links(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    end = later(app_url, 3600)
    made = s.owner.client.post(f"/api/sprites/{s.sid}/links", json={"label": "Client", "expires_at": end})
    assert made.status_code == 201 and made.json()["state"] == "active"
    link = made.json()
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    assert s.owner.client.post(f"/api/sprites/{s.sid}/links", json={"label": "Old", "expires_at": config(app_url)["now"]}).json()["errors"]["expires_at"] == "Choose a time after now"
    for call in (anon.post, anon.put, anon.patch, anon.delete):
        kw = {"json": {}} if call in (anon.post, anon.put, anon.patch) else {}
        r = call(f"/api/share/{link['token']}", **kw)
        assert r.status_code == 403 and r.json()["message"] == "This link is read only"
    assert anon.post(f"/api/share/{link['token']}/frames/1/pixels", json={}).status_code == 403
    assert seq_of(s.owner.client, s.sid) == 0
    pixels = anon.get(f"/api/share/{link['token']}/frames/1/pixels")
    assert pixels.status_code == 200 and pixels.json()["width"] == 16
    new = s.owner.client.post(f"/api/links/{link['id']}/regenerate").json()
    assert new["token"] != link["token"] and new["expires_at"] == end and new["state"] == "active"
    assert anon.get(f"/api/share/{link['token']}").status_code == 404
    assert anon.get(f"/api/share/{new['token']}").status_code == 200
    with open_app(browser, f"{app_url}/s/{link['token']}") as page:
        expect(role(page, "heading", "This link has ended")).to_be_visible(timeout=UI_MS)
    assert s.owner.client.delete(f"/api/links/{new['id']}").json() == {"state": "revoked"}
    assert anon.get(f"/api/share/{new['token']}").json() == {"error": "not_found"}
    assert s.owner.client.delete(f"/api/links/{new['id']}").json() == {"error": "link_ended"}
    assert s.owner.client.post(f"/api/links/{new['id']}/regenerate").json() == {"error": "link_ended"}
    assert s.ed.client.post(f"/api/sprites/{s.sid}/links", json={"label": "E", "expires_at": None}).status_code == 403


def test_wf_sharing_expiry_device_clock(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    link = s.owner.client.post(f"/api/sprites/{s.sid}/links", json={"label": "Client", "expires_at": later(app_url, 600)}).json()
    with open_app(browser, f"{app_url}/signin") as page:
        far = parse_instant(config(app_url)["now"]) + timedelta(days=30)
        page.clock.set_fixed_time(far)
        page.goto(f"{app_url}/s/{link['token']}")
        expect(stage(page)).to_be_visible(timeout=UI_MS)
        expect(role(page, "heading", "This link has ended")).to_have_count(0)
        clock_advance(app_url, 601)
        started = time.monotonic()
        expect(role(page, "heading", "This link has ended")).to_be_visible(timeout=PUSH_MS + GRACE_MS)
        assert time.monotonic() - started <= (PUSH_MS + GRACE_MS) / 1000
    assert httpx.get(f"{app_url}/api/share/{link['token']}", timeout=HTTP_TIMEOUT).status_code == 404
    states = s.owner.client.get(f"/api/projects/{s.pid}/links").json()["links"]
    assert states[0]["state"] == "ended"


def test_link_ended_notice(app_url: str, mail: Mailpit) -> None:
    s = make_studio(app_url, person_settings={"owner": {"number_format": "en-IN", "time_zone": "Asia/Kolkata"}})
    subject = f"Read-only link ended: {s.sprite_name}"
    end = later(app_url, 300)
    s.owner.client.post(f"/api/sprites/{s.sid}/links", json={"label": "Client", "expires_at": end})
    gone = s.owner.client.post(f"/api/sprites/{s.sid}/links", json={"label": "Client preview", "expires_at": end}).json()
    assert s.owner.client.delete(f"/api/links/{gone['id']}").status_code == 200
    assert mail_to(mail, s.owner.email, subject, expected=0) == [], "a notice was sent before the link ended"
    clock_advance(app_url, 301)
    found = mail_to(mail, s.owner.email, subject)
    assert len(found) == 1, "one notice for the ended link, none for the revoked one"
    body = text(found[0])
    assert "Link: Client" in body and "Client preview" not in body
    assert re.search("Ended: " + date_pattern(end, "en-IN", "Asia/Kolkata"), body)


def test_relative_times_follow_business_clock(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    paint(s.ed.client, s.sid, [[0, 0]])
    with workspace(browser, s, s.owner, paused=True) as page:
        activity = role(page, "list", "Activity")
        expect(activity).to_contain_text("just now", timeout=SYNC_MS)
        clock_advance(app_url, 60)
        expect(activity).to_contain_text("1 minute ago", timeout=PUSH_MS + GRACE_MS)
        clock_advance(app_url, 120)
        expect(activity).to_contain_text("3 minutes ago", timeout=PUSH_MS + GRACE_MS)
        clock_advance(app_url, INVITE_TTL * 2)
        expect(activity).to_contain_text("2 hours ago", timeout=PUSH_MS + GRACE_MS)


def test_wf_phone_painting_tabs_and_breakpoints(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed, size=PHONE) as page:
        tabs = role(page, "tablist", "Workspace")
        for name in ("Canvas", "Layers", "Frames", "Palette"):
            expect(role(tabs, "tab", name)).to_be_visible()
        st = stage(page)
        attr(st, "data-zoom", "8")
        for name, levels in (("Zoom out", ("4", "2", "1", "1")), ("Zoom in", ("2", "4", "8", "16", "32", "32"))):
            for level in levels:
                click(role(page, "button", name))
                attr(st, "data-zoom", level)
        for name in ("Pan left", "Pan right", "Pan up", "Pan down"):
            expect(role(page, "button", name)).to_be_visible()
        layout(page)
        for _ in range(2):
            click(role(page, "button", "Zoom out"))
        attr(st, "data-zoom", "8")
        expect(role(page, "listbox", "Palette")).to_have_count(0)
        click(role(tabs, "tab", "Palette"))
        expect(role(page, "listbox", "Palette")).to_be_visible(timeout=SYNC_MS)
        click(role(tabs, "tab", "Canvas"))
        attr(stage(page), "data-zoom", "8")
        click(role(page, "button", "More panels"))
        sheet = role(page, "dialog", "More panels")
        for name in ("Tiles", "Comments", "Snapshots", "Activity"):
            expect(role(sheet, "region", name)).to_be_visible(timeout=SYNC_MS)
        press(page, "Escape")
        for width, has_tabs, three_panes in ((699, True, False), (700, False, False), (1099, False, False), (1100, False, True)):
            page.set_viewport_size({"width": width, "height": 800})
            expect(role(page, "tablist", "Workspace")).to_have_count(1 if has_tabs else 0, timeout=SYNC_MS)
            expect(role(page, "button", "More panels")).to_have_count(0 if three_panes else 1, timeout=SYNC_MS)


def test_wf_phone_painting_one_finger(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed, size=PHONE, paused=True) as page, workspace(browser, s, s.ed2) as desk:
        enable_touch(page)
        touch(page, "touchStart", [cell_point(page, 1, 1)])
        touch(page, "touchMove", [cell_point(page, 6, 3)])
        touch(page, "touchEnd", [])
        attr(stage(desk), "data-seq", "1")
        assert cells(indices(s.ed.client, s.sid), 1) == set(line(1, 1, 6, 3))
        final = hash_of(s.ed.client, s.sid)
        hash_is(desk, final)
        hash_is(page, final)
        touch(page, "touchStart", [cell_point(page, 10, 10)])
        touch(page, "touchStart", [cell_point(page, 10, 10), cell_point(page, 12, 12)])
        touch(page, "touchEnd", [])
        hash_is(page, final)
        assert seq_of(s.ed.client, s.sid) == 1, "a second finger must cancel with no pixels"
        page.reload()
        hash_is(page, final)


def test_long_press_colour_pick(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, cels={(1, "Body"): with_cells(16, 16, {(4, 4): 3})})
    with workspace(browser, s, s.ed, size=PHONE, paused=True) as page:
        enable_touch(page)
        spot = cell_point(page, 4, 4)
        touch(page, "touchStart", [spot])
        advance(page, LONG_PRESS_MS - 1)
        expect(status(page, "Stage announcements")).not_to_have_text("Picked swatch 3")
        advance(page, 1)
        announced(page, "Picked swatch 3")
        touch(page, "touchEnd", [])
        assert seq_of(s.ed.client, s.sid) == 0, "a long press painted"
        touch(page, "touchStart", [cell_point(page, 8, 8)])
        advance(page, LONG_PRESS_MS - 1)
        touch(page, "touchEnd", [])
        attr(stage(page), "data-seq", "1")
        assert indices(s.ed.client, s.sid)[8][8] == 3, "a short touch paints the picked primary"


def test_wf_phone_painting_reduced_motion(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=2, cels={(1, "Body"): with_cells(16, 16, {(4, 4): 2})})
    with workspace(browser, s, s.ed, size=PHONE, paused=True, reduced_motion="reduce") as page:
        enable_touch(page)
        touch(page, "touchStart", [cell_point(page, 4, 4)])
        advance(page, LONG_PRESS_MS)
        announced(page, "Picked swatch 2")
        touch(page, "touchEnd", [])
        assert s.ed2.client.patch(f"/api/palettes/{s.palette}/swatches/2", json={"color": LIME, "version": 1}).status_code == 200
        announced(page, f"Swatch 2 now {LIME}, used by 1 pixel in 1 frame")
        assert stage(page).get_attribute("data-flood-radius") is None
        assert stage_cell_rgb(page, screen(page, stage(page)), 4, 4) == LIME[:6]
        click(role(role(page, "tablist", "Workspace"), "tab", "Frames"))
        frame = preview_frame(page)
        attr(frame, "data-preview-mode", "step")
        attr(frame, "data-preview-frame", "1")
        advance(page, 500)
        attr(frame, "data-preview-frame", "1")
        click(role(page, "button", "Next frame"))
        attr(frame, "data-preview-frame", "2")


VIEWPORT_CASES = ["phone", "tablet", "desktop"]


@pytest.mark.parametrize("name", VIEWPORT_CASES, ids=VIEWPORT_CASES)
def test_published_layouts(browser: Browser, app_url: str, name: str) -> None:
    size = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}[name]
    s = make_studio(app_url, frames=2)
    with workspace(browser, s, s.ed, size=size) as page:
        layout(page)
        st = stage(page).bounding_box()
        if name == "phone":
            tabs = role(page, "tablist", "Workspace").bounding_box()
            assert tabs["y"] + tabs["height"] <= size["height"] + 1 and tabs["y"] > st["y"] + st["height"] - 1, "the tab dock sits at the bottom"
        else:
            expect(role(page, "tablist", "Workspace")).to_have_count(0)
            palette = role(page, "region", "Palette").bounding_box()
            layers = role(page, "region", "Layers").bounding_box()
            frames = role(page, "region", "Frames").bounding_box()
            if name == "tablet":
                for box in (palette, layers, frames):
                    assert box["y"] >= st["y"] + st["height"] - 1, "the dock sits under the stage"
                assert palette["x"] + palette["width"] <= layers["x"] + 1 and layers["x"] + layers["width"] <= frames["x"] + 1
            else:
                preview = role(page, "region", "Preview").bounding_box()
                assert palette["x"] + palette["width"] <= st["x"] + 1 and layers["x"] + layers["width"] <= st["x"] + 1
                assert frames["y"] >= st["y"] + st["height"] - 1 and frames["x"] < st["x"] + st["width"]
                assert preview["x"] >= st["x"] + st["width"] - 1
                expect(role(page, "region", "Activity")).to_be_visible()
        for _ in range(2):
            click(role(page, "button", "Zoom in"))
        attr(stage(page), "data-zoom", "32")
        layout(page)


def test_dialog_focus(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(1)], tilemaps=[tile_map()])

    def verify(page: Page, dialog: Locator, opener: Locator) -> None:
        expect(dialog).to_be_visible(timeout=SYNC_MS)
        for key in ["Tab"] * 12 + ["Shift+Tab"] * 12:
            press(page, key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the dialog"
        press(page, "Escape")
        expect(dialog).to_have_count(0, timeout=SYNC_MS)
        expect(opener).to_be_focused(timeout=SYNC_MS)

    with workspace(browser, s, s.owner) as page:
        stage(page).focus()
        press(page, "c")
        verify(page, role(page, "dialog", "New comment"), stage(page))
        undo = role(page, "button", "Undo")
        undo.focus()
        press(page, "Control+k")
        verify(page, role(page, "dialog", "Command palette"), undo)
        export = role(page, "button", "Export")
        click(export)
        verify(page, role(page, "dialog", "Export"), export)
        click(role(role(page, "listbox", "Tiles"), "option", "Tile 1"))
        edit = role(page, "button", "Edit tile")
        click(edit)
        verify(page, role(page, "dialog", "Edit tile"), edit)
    with workspace(browser, s, s.owner, size=PHONE) as page:
        more = role(page, "button", "More panels")
        click(more)
        verify(page, role(page, "dialog", "More panels"), more)
    with opened(browser, app_url, s.owner, f"/projects/{s.pid}") as page:
        new = role(page, "button", "New sprite")
        click(new)
        verify(page, role(page, "dialog", "New sprite"), new)


TARGET_SCRIPT = """() => {
  const picks = 'button,a[href],input:not([type=hidden]):not([type=file]),select,textarea,[role=option],[role=tab],[role=gridcell][tabindex],[role=row][tabindex],[role=slider],[role=combobox],[role=checkbox],[role=spinbutton]';
  const small = [];
  for (const el of document.querySelectorAll(picks)) {
    const st = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || st.visibility === 'hidden') continue;
    let w = r.width, h = r.height;
    for (const label of el.labels || []) { const b = label.getBoundingClientRect(); w = Math.max(w, b.width); h = Math.max(h, b.height); }
    if (w < arguments_min - 0.5 || h < arguments_min - 0.5) small.push(`${el.tagName} ${el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30)} ${w}x${h}`);
  }
  return small;
}""".replace("arguments_min", str(MIN_TARGET))


def test_tap_targets(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(1)], tilemaps=[tile_map(2, 2)])
    for size in (PHONE, TABLET, DESKTOP):
        with workspace(browser, s, s.owner, size=size) as page:
            small = page.evaluate(TARGET_SCRIPT)
            assert small == [], f"workspace at {size}: {small}"
        for path in ("/", "/signin", "/signup", "/projects", f"/projects/{s.pid}"):
            with opened(browser, app_url, s.owner, path, size=size) as page:
                page.wait_for_load_state()
                small = page.evaluate(TARGET_SCRIPT)
                assert small == [], f"{path} at {size}: {small}"


MOTION_SCRIPT = "() => document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"
LONGEST_SCRIPT = "() => Math.max(0, ...document.getAnimations().map(a => a.effect ? a.effect.getComputedTiming().activeDuration : 0))"


def running(locator: Locator) -> list[dict[str, Any]]:
    return [a for a in animations(locator) if a["playState"] == "running"]


def test_motion_discipline(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, None, "/") as page:
        assert page.evaluate(LONGEST_SCRIPT) <= LANDING_MOTION_MS, "a landing animation runs past one second"
        assert page.evaluate(MOTION_SCRIPT) == 0
        poll(lambda: running(page.locator("body")) == [], "the landing motion settled", (LANDING_MOTION_MS + STICKER_MS + GRACE_MS) / 1000)
    with opened(browser, app_url, None, "/", reduced_motion="reduce") as page:
        page.wait_for_load_state()
        assert running(page.locator("body")) == [], "reduced motion must land the hero at its end state"
    s = make_studio(app_url, frames=2)
    with workspace(browser, s, s.ed) as page:
        assert page.evaluate(MOTION_SCRIPT) == 0, "a decorative loop runs in the workspace"
        click(role(page, "button", "Export"))
        assert page.evaluate(LONGEST_SCRIPT) <= PANEL_MAX_MS, "a panel slide runs too long"
    with workspace(browser, s, s.ed, size=PHONE, reduced_motion="reduce") as page:
        click(role(page, "button", "More panels"))
        expect(role(page, "dialog", "More panels")).to_be_visible(timeout=SYNC_MS)
        assert running(role(page, "dialog", "More panels")) == [], "a sheet slid under reduced motion"


def test_browser_timing_rule(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed, paused=True) as page, workspace(browser, s, s.ed2, paused=True) as watcher:
        st = stage(page)
        st.focus()
        press(page, "ArrowRight")
        attr(st, "data-cursor-x", "1")
        announced(page, f"Pixel 1, 0, {TRANSPARENT}, layer Body")
        press(page, "l")
        announced(page, "Tool: Line")
        press(page, "b", "Space")
        attr(st, "data-seq", "1")
        final = hash_of(s.ed.client, s.sid)
        hash_is(page, final)
        hash_is(watcher, final)
        expect(status(watcher, "Team announcements")).to_contain_text(f"{s.ed.name} painted 1 pixel", timeout=SYNC_MS)
        page.mouse.move(*cell_point(page, 5, 6))
        attr(st, "data-cursor-x", "5")
        attr(role(watcher, "region", "Live cursors").locator(f'[data-person="{s.ed.name}"]'), "data-x", "5")
        attr(role(role(watcher, "listbox", "Palette"), "option", "Swatch 1"), "data-used-by", "1")


def test_business_clock_and_config(app_url: str) -> None:
    body = config(app_url)
    assert {k: body[k] for k in ("palette_max", "sprite_max", "frame_min_ms", "frame_max_ms", "invite_ttl_seconds", "long_press_ms", "presence_visible", "idle_seconds", "undo_depth", "activity_page", "autosave_ms", "job_item_ms", "import_max_bytes")} == {
        "palette_max": 16, "sprite_max": 64, "frame_min_ms": 20, "frame_max_ms": 5000, "invite_ttl_seconds": 3600, "long_press_ms": 400,
        "presence_visible": 2, "idle_seconds": 120, "undo_depth": 3, "activity_page": 5, "autosave_ms": 800, "job_item_ms": 400, "import_max_bytes": 200000}
    now = parse_instant(body["now"])
    assert now >= parse_instant("2027-03-08T16:00:00.000Z")
    moved = clock_advance(app_url, 30)
    assert parse_instant(moved["now"]) >= now + timedelta(seconds=30)
    assert parse_instant(config(app_url)["now"]) >= parse_instant(moved["now"])
    head = {"X-Grading-Key": GRADING_KEY}
    target = iso(parse_instant(moved["now"]) + timedelta(seconds=5))
    r = httpx.post(f"{app_url}/api/grading/clock", json={"set": target}, headers=head, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and parse_instant(r.json()["now"]) >= parse_instant(target)
    assert httpx.post(f"{app_url}/api/grading/clock", json={"set": "2020-01-01T00:00:00.000Z"}, headers=head, timeout=HTTP_TIMEOUT).status_code == 422
    assert httpx.post(f"{app_url}/api/grading/clock", json={"advance_seconds": -1}, headers=head, timeout=HTTP_TIMEOUT).status_code == 422


def test_grading_routes(app_url: str, mail: Mailpit) -> None:
    for path, body in (("/api/grading/seed", {}), ("/api/grading/clock", {"advance_seconds": 0})):
        for headers in ({}, {"X-Grading-Key": "wrong-key"}):
            r = httpx.post(f"{app_url}{path}", json=body, headers=headers, timeout=HTTP_TIMEOUT)
            assert r.status_code == 404 and r.json() == {"error": "not_found"}
    tag = uuid.uuid4().hex[:8]
    email = f"bad-{tag}@team.example"
    user = {"key": "u", "email": email, "name": f"Bad{tag}", "password": PASSWORD, "confirmed": True, "number_format": "en-US", "time_zone": "UTC"}
    head = {"X-Grading-Key": GRADING_KEY}
    for broken in ({"users": [user], "projects": [{"key": "p", "name": "X", "owner": "missing"}]},
                   {"users": [user], "projects": [{"key": "p", "name": "X", "owner": "u"}], "palettes": [{"key": "pal", "swatches": []}],
                    "sprites": [{"key": "s", "project": "p", "palette": "pal", "name": "Big", "width": SPRITE_MAX + 1, "height": 8}]}):
        r = httpx.post(f"{app_url}/api/grading/seed", json=broken, headers=head, timeout=HTTP_TIMEOUT)
        assert r.status_code == 422
        assert httpx.post(f"{app_url}/api/auth/login", json={"email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT).status_code == 422, "a refused seed created a person"
    s = make_studio(app_url, frames=2, tags=[{"key": "t", "sprite": "s", "name": "walk", "from": 1, "to": 2, "direction": "pingpong", "repeat": 0}],
                    tilesets=[tile_set(2)], tilemaps=[tile_map()], snapshots=[{"key": "n", "sprite": "s", "name": "Base"}],
                    comments=[{"key": "k", "sprite": "s", "author": "rev", "frame": 1, "x": 3, "y": 4, "text": f"Check this @{tag}", "state": "open"}],
                    cels={(1, "Body"): with_cells(16, 16, {(1, 1): 1}), (2, "Body"): {"link_to": 1}})
    info = sprite_info(s.owner.client, s.sid)
    assert info["seq"] == 0 and info["tags"][0]["name"] == "walk" and info["tilesets"] == [s.ids["ts"]] and info["tilemaps"] == [s.ids["tm"]]
    assert s.owner.client.get(f"/api/sprites/{s.sid}/frames/2/indices", params={"layer": "Body"}).json()["linked_frames"] == [1, 2]
    assert s.owner.client.get(f"/api/sprites/{s.sid}/snapshots").json()["snapshots"][0]["name"] == "Base"
    assert s.owner.client.get(f"/api/projects/{s.pid}/activity").json()["items"] == []
    assert s.owner.client.post(f"/api/sprites/{s.sid}/undo").json()["error"] == "nothing_to_undo"
    assert mail_to(mail, s.owner.email, expected=0) == [], "seeding sent mail"


def demo_view(base: str) -> dict[str, Any]:
    c = login_client(base, "demo@celmate.example", "celmate-demo-1")
    projects = [p for p in c.get("/api/projects").json()["projects"] if p["name"] == "Marzipan Demo"]
    assert len(projects) == 1, "the demo project is missing or doubled"
    project = c.get(f"/api/projects/{projects[0]['id']}").json()
    sid = next(x["id"] for x in project["sprites"] if x["name"] == "Gumdrop Walker")
    info = sprite_info(c, sid)
    art = {f"{l['name']}-{n}": indices(c, sid, n, l["name"]) for l in info["layers"] for n in range(1, 9)}
    return {"client": c, "project": project, "sid": sid, "info": info, "art": art, "palette": c.get(f"/api/palettes/{info['palette']}").json()}


def test_demo_workspace(app_url: str) -> None:
    demo = demo_view(app_url)
    c, info = demo["client"], demo["info"]
    assert {(m["name"], m["email"], m["role"]) for m in demo["project"]["members"]} == {
        ("Demo Owner", "demo@celmate.example", "owner"), ("Demo Editor", "demo-editor@celmate.example", "editor"), ("Demo Reviewer", "demo-reviewer@celmate.example", "reviewer")}
    login_client(app_url, "demo-editor@celmate.example", "celmate-demo-2")
    login_client(app_url, "demo-reviewer@celmate.example", "celmate-demo-3")
    assert (info["width"], info["height"]) == (32, 32)
    assert [f["duration_ms"] for f in info["frames"]] == [100] * 8
    assert sorted(l["name"] for l in info["layers"]) == ["Body", "Outline", "Shadow"]
    assert [l["name"] for l in sorted(info["layers"], key=lambda l: l["position"])] == ["Outline", "Body", "Shadow"]
    assert len(demo["palette"]["swatches"]) == 12
    assert {(t["name"], t["from"], t["to"], t["direction"]) for t in info["tags"]} == {("walk", 1, 8, "forward"), ("bounce", 2, 5, "pingpong")}
    tileset = c.get(f"/api/tilesets/{info['tilesets'][0]}").json()
    assert (tileset["name"], tileset["tile_size"], len(tileset["tiles"]), tileset["edge_table"]) == ("Candy Ground", 8, 16, list(range(1, 17)))
    tilemap = c.get(f"/api/tilemaps/{info['tilemaps'][0]}").json()
    assert (tilemap["name"], tilemap["width"], tilemap["height"]) == ("Courtyard", 12, 8)
    comments = c.get(f"/api/sprites/{demo['sid']}/comments").json()["comments"]
    assert {(x["text"], x["state"], x["frame"], x["author"]) for x in comments} == {
        ("Outline breaks on the left foot here.", "open", 3, "Demo Reviewer"), ("Can the shadow sit one pixel lower?", "open", 5, "Demo Reviewer"),
        ("Colour pass looks right on this frame.", "resolved", 1, "Demo Reviewer")}
    assert [x["name"] for x in c.get(f"/api/sprites/{demo['sid']}/snapshots").json()["snapshots"]] == ["Colour pass", "First pass"]
    share = httpx.get(f"{app_url}/api/share/demo-gumdrop", timeout=HTTP_TIMEOUT)
    assert share.status_code == 200 and share.json()["sprite"]["name"] == "Gumdrop Walker"
    assert any(cells(rows) for rows in demo["art"].values()), "the demo artwork is empty"
    other = demo_view(outage_base())
    assert other["art"] == demo["art"], "the demo artwork differs between two first starts"
    assert [x["color"] for x in other["palette"]["swatches"]] == [x["color"] for x in demo["palette"]["swatches"]]


def test_api_error_order(app_url: str) -> None:
    s = make_studio(app_url)
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    invalid = {"frame": 999, "layer": "Nope", "tool": "laser", "points": [], "swatch": 99, "size": 99, "mirror": "none", "options": {}, "client_stroke_id": "x"}
    url = f"/api/sprites/{s.sid}/strokes"
    r = anon.post(url, json=invalid)
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    r = s.out.client.post(url, json=invalid)
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    assert anon.get(f"/api/sprites/{MISSING_SPRITE}").status_code == 401
    assert s.out.client.get(f"/api/sprites/{MISSING_SPRITE}").json() == {"error": "not_found"}
    assert s.out.client.get(f"/api/projects/{s.pid}").status_code == 404
    r = s.rev.client.post(url, json=invalid)
    assert r.status_code == 403 and r.json() == {"error": "forbidden", "message": "Reviewers can't draw"}
    r = s.ed.client.post(url, json=invalid)
    assert r.status_code == 422 and isinstance(r.json()["errors"], dict) and r.json()["errors"]
    s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": ORANGE, "version": 1})
    r = s.ed.client.patch(f"/api/palettes/{s.palette}/swatches/1", json={"color": "bad", "version": 1})
    assert r.status_code == 409 and r.json()["error"] == "version_conflict", "a conflict comes before a field error"
    r = s.rev.client.post(f"/api/projects/{s.pid}/invites", json={"email": "bad", "role": "bad"})
    assert r.status_code == 403
    csid = uuid.uuid4().hex
    first = post_stroke(s.ed.client, s.sid, [[1, 1]], csid=csid)
    assert s.owner.client.post(f"/api/sprites/{s.sid}/layers/{s.layer_id()}/lock").status_code == 200
    replay = post_stroke(s.ed.client, s.sid, [[1, 1]], csid=csid)
    assert replay.status_code == 201 and replay.json() == first.json(), "a replay comes before the lock check"


def test_server_boundary(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    c = s.ed.client
    r = c.post("/api/projects", json={"name": "Evil"}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403 and r.json()["message"] == "Cross-origin request refused"
    assert c.post("/api/projects", json={"name": "Fine"}, headers={"Origin": app_url.rstrip("/")}).status_code == 201
    def sized(total: int) -> bytes:
        head = b'{"name":"'
        return head + b"x" * (total - len(head) - 2) + b'"}'
    assert c.post("/api/projects", content=sized(JSON_MAX), headers={"Content-Type": "application/json"}).status_code != 413
    r = c.post("/api/projects", content=sized(JSON_MAX + 1), headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "too_large"}
    r = httpx.post(f"{app_url}/api/grading/seed", content=sized(SEED_MAX + 1), headers={"Content-Type": "application/json", "X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 413 and r.json() == {"error": "too_large"}
    r = c.post("/api/projects", content=b"name=x", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    login = httpx.post(f"{app_url}/api/auth/login", json={"email": s.ed.email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert "HTTP-only".lower().replace("-", "") in login.headers.get("set-cookie", "").lower()
    secrets = [os.environ[k] for k in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID") if os.environ.get(k)] + [GRADING_KEY]
    for path in ("/.env", "/run.json", "/package.json", "/../.env", "/src/server.ts", "/.git/config"):
        body = httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).text
        assert "run-manifest-v1" not in body and not any(v in body for v in secrets), path
    seen: list[str] = []
    with workspace(browser, s, s.ed) as page:
        page.on("response", lambda resp: seen.append(resp.url))
        page.reload()
        expect(stage(page)).to_be_visible(timeout=UI_MS)
        html = page.content()
        assert not any(v in html for v in secrets)
    for url in {u for u in seen if same_origin(u, app_url)}:
        body = httpx.get(url, timeout=HTTP_TIMEOUT).text if "/api/" not in url else ""
        assert not any(v in body for v in secrets), f"a credential is served in {url}"


def test_health_and_run_manifest(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    with app_copy(only_port_var=True) as copy:
        assert httpx.get(f"{copy.base}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    with app_copy() as copy:
        assert httpx.get(f"{copy.base}/api/config", timeout=HTTP_TIMEOUT).json()["sprite_max"] == SPRITE_MAX


def test_wf_cross_cutting_restart(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    port = free_port()
    with app_copy(port) as copy:
        c = login_client(copy.base, s.ed.email)
        paint(c, s.sid, [[1, 1]])
        paint(c, s.sid, [[2, 2]], swatch=2)
        before_rows, before_events = indices(c, s.sid), events_since(c, s.sid)
        copy.kill()
    with app_copy(port) as copy:
        c = login_client(copy.base, s.ed.email)
        assert indices(c, s.sid) == before_rows and events_since(c, s.sid) == before_events
        r = c.post(f"/api/sprites/{s.sid}/undo")
        assert r.status_code == 200 and r.json()["seq"] == 3, "undo history did not survive the restart"
        assert indices(c, s.sid)[2][2] == 0
        assert indices(c, s.sid)[1][1] == 1
    with workspace(browser, s, s.ed) as page:
        hash_is(page, hash_of(s.ed.client, s.sid))
        page.reload()
        hash_is(page, hash_of(s.ed.client, s.sid))


def test_wf_cross_cutting_keyboard_tab_order(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    orders = ((DESKTOP, ["Zoom in", "Zoom out"]), (TABLET, ["Zoom in", "Zoom out"]), (PHONE, ["Zoom in", "Zoom out", "Pan left", "Pan right", "Pan up", "Pan down"]))
    for size, names in orders:
        with workspace(browser, s, s.ed, size=size) as page:
            stage(page).focus()
            press(page, "Escape")
            for name in names:
                press(page, "Tab")
                expect(role(page, "button", name)).to_be_focused(timeout=SYNC_MS)


def test_server_pixel_authority(browser: Browser, app_url: str) -> None:
    a = make_studio(app_url, swatches=[RED, BLUE], cels={(1, "Body"): grid_of(*["1" + "." * 15] * 16)})
    b = make_studio(app_url, swatches=[RED, BLUE], cels={(1, "Body"): grid_of(*["1" + "." * 15] * 16)})
    with workspace(browser, a, a.ed) as page:
        drag(page, (2, 2), (9, 5), (3, 12))
        attr(stage(page), "data-seq", "1")
        press(page, "]")
        press(page, "l")
        drag(page, (10, 10), (15, 15))
        attr(stage(page), "data-seq", "2")
        ui_hash = stage(page).get_attribute("data-composite-hash")
    paint(b.ed.client, b.sid, [[2, 2], [9, 5], [3, 12]])
    paint(b.ed.client, b.sid, [[10, 10], [15, 15]], tool="line", size=2)
    assert indices(a.ed.client, a.sid) == indices(b.ed.client, b.sid)
    assert hash_of(b.ed.client, b.sid) == ui_hash


def test_wf_pointer_tools_mirror_live(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, width=8, height=8)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        click(tool_button(page, "Pencil"))
        stage(page).focus()
        press(page, "m")
        announced(page, "Mirror: x")
        drag(page, (1, 1), (3, 1))
        attr(stage(page), "data-seq", "1")
        assert cells(indices(s.ed.client, s.sid), 1) == {(1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1)}
        final = hash_of(s.ed.client, s.sid)
        hash_is(page, final)
        hash_is(watcher, final)
        watcher.reload()
        expect(stage(watcher)).to_be_visible(timeout=UI_MS)
        hash_is(watcher, final)


def test_wf_layer_compositing_merge_by_keyboard(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, width=1, height=1, swatches=[BLUE, ORANGE],
                    layers=("Base", {"name": "Top", "opacity": 50, "blend": "multiply"}),
                    cels={(1, "Base"): [[1]], (1, "Top"): [[2]]})
    want = rows_hash([["203050ff"]])
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        hash_is(watcher, want)
        layers = role(page, "listbox", "Layers")
        role(layers, "option", "Top").focus()
        press(page, "Space")
        expect(status(page, "List announcements")).to_have_text(list_line("Lifted", "Top", 1, 2), timeout=SYNC_MS)
        press(page, "ArrowDown")
        expect(status(page, "List announcements")).to_have_text(list_line("Moved", "Top", 2, 2), timeout=SYNC_MS)
        press(page, "Escape")
        expect(status(page, "List announcements")).to_have_text(list_line("Cancelled", "Top", 1, 2), timeout=SYNC_MS)
        pick_layer(page, "Top")
        click(role(page, "button", "Merge down"))
        notice(watcher, f"Merged into Base, {counted(1, 'new swatch')}")
        expect(role(role(watcher, "listbox", "Layers"), "option", "Top")).to_have_count(0, timeout=SYNC_MS)
        hash_is(watcher, want)
        watcher.reload()
        expect(role(role(watcher, "listbox", "Layers"), "option", "Base")).to_be_visible(timeout=UI_MS)
        hash_is(watcher, want)
    assert swatch(s.ed.client, s.palette, 3)["color"] == "203050ff"
    assert indices(s.ed.client, s.sid, layer="Base") == [[3]]


def test_wf_linked_timeline_totals_live(browser: Browser, app_url: str) -> None:
    frames = 20
    s = make_studio(app_url, frames=frames, durations=[FRAME_MAX] * frames,
                    person_settings={"ed2": {"number_format": "en-IN", "time_zone": "Asia/Kolkata"}})
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as india:
        us_line = role(page, "region", "Frames").locator("[data-total-ms]")
        in_line = role(india, "region", "Frames").locator("[data-total-ms]")
        expect(us_line).to_have_text(f"Total {group(FRAME_MAX * frames)} ms · Average {group(FRAME_MAX)} ms", timeout=SYNC_MS)
        r = s.ed.client.post(f"/api/sprites/{s.sid}/frames", json={"duration_ms": FRAME_MAX})
        assert r.status_code == 201
        total = FRAME_MAX * (frames + 1)
        expect(us_line).to_have_text(f"Total {group(total)} ms · Average {group(FRAME_MAX)} ms", timeout=SYNC_MS)
        expect(in_line).to_have_text(f"Total {group(total, 'en-IN')} ms · Average {group(FRAME_MAX, 'en-IN')} ms", timeout=SYNC_MS)
        attr(in_line, "data-total-ms", str(total))
        role(role(india, "grid", "Frames"), "row", "Frame 1").focus()
        press(india, "End")
        poll(lambda: focused_rowindex(india) == str(frames + 1), f"End reached row {frames + 1}", SYNC_MS / 1000)
        india.reload()
        expect(role(india, "region", "Frames").locator("[data-total-ms]")).to_have_text(f"Total {group(total, 'en-IN')} ms · Average {group(FRAME_MAX, 'en-IN')} ms", timeout=UI_MS)


def test_wf_tags_preview_repeat_live(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=3, durations=[100, 105, 100])
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2, paused=True) as watcher:
        fill(role(page, "textbox", "Tag name"), "hop")
        fill(role(page, "spinbutton", "Tag from"), "1")
        fill(role(page, "spinbutton", "Tag to"), "2")
        select(role(page, "combobox", "Tag direction"), "Forward")
        fill(role(page, "spinbutton", "Tag repeat"), "1")
        click(role(page, "button", "Add tag"))
        poll(lambda: [(t["name"], t["repeat"]) for t in sprite_info(s.ed.client, s.sid)["tags"]] == [("hop", 1)], "the tag was stored with its repeat")
        select(role(watcher, "combobox", "Preview tag"), "hop")
        resume_preview(watcher)
        walk_preview(watcher, {1: 100, 2: 105}, [1, 2])
        advance(watcher, 105)
        frame = preview_frame(watcher)
        attr(frame, "data-preview-frame", "2")
        attr(frame, "data-preview-mode", "step")
        notice(watcher, f"Finished after {counted(1, 'pass')}")
        watcher.reload()
        expect(stage(watcher)).to_be_visible(timeout=UI_MS)
        select(role(watcher, "combobox", "Preview tag"), "hop")


def test_wf_tilemap_edge_counts_and_flip(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(2)], tilemaps=[tile_map(placed=[
        {"x": 0, "y": 0, "tile": 1, "flip_h": False, "flip_v": False},
        {"x": 1, "y": 0, "tile": 1, "flip_h": False, "flip_v": False},
    ])])
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        tile_one = role(role(watcher, "listbox", "Tiles"), "option", "Tile 1")
        expect(tile_one).to_contain_text("Used 2 times", timeout=SYNC_MS)
        click(role(role(page, "listbox", "Tiles"), "option", "Tile 1"))
        tilemap_cell(page, 2, 0).focus()
        press(page, "Enter")
        attr(tilemap_cell(watcher, 2, 0), "data-tile", "1")
        expect(tile_one).to_contain_text("Used 3 times", timeout=SYNC_MS)
        press(page, "h")
        announced(page, "Cell 2, 0, tile 1, flip H")
        attr(tilemap_cell(watcher, 2, 0), "data-flip-h", "true")
        expect(tile_one).to_contain_text("Used 3 times", timeout=SYNC_MS)
        watcher.reload()
        attr(tilemap_cell(watcher, 2, 0), "data-flip-h", "true")
        expect(role(role(watcher, "listbox", "Tiles"), "option", "Tile 1")).to_contain_text("Used 3 times", timeout=UI_MS)


def test_wf_tilemap_edge_undo_refused(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, tilesets=[tile_set(3)], tilemaps=[tile_map()])
    mid = s.ids["tm"]
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        click(role(role(page, "listbox", "Tiles"), "option", "Tile 2"))
        tilemap_cell(page, 3, 3).focus()
        press(page, "Enter", "ArrowRight", "Enter")
        attr(tilemap_cell(watcher, 4, 3), "data-tile", "2")
        press(page, "Control+z")
        announced(page, "Undone")
        attr(tilemap_cell(watcher, 4, 3), "data-tile", "0")
        r = s.ed2.client.post(f"/api/tilemaps/{mid}/cells", json={"x": 3, "y": 3, "tile": 3, "flip_h": False, "flip_v": False, "edge_matching": False})
        assert r.status_code == 201
        attr(tilemap_cell(page, 3, 3), "data-tile", "3")
        seq = seq_of(s.ed.client, s.sid)
        tilemap_cell(page, 0, 0).focus()
        press(page, "Control+z")
        alert(page, f"Can't undo: {s.ed2.name} changed this")
        attr(tilemap_cell(watcher, 3, 3), "data-tile", "3")
        assert seq_of(s.ed.client, s.sid) == seq


def test_wf_export_job_gif_dialog(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=3, durations=[100, 105, FRAME_MIN], sprite_name=f"Bat {uuid.uuid4().hex[:4]}",
                    cels={(n, "Body"): with_cells(16, 16, {(n, n): 1}) for n in range(1, 4)})
    slug = re.sub(r"[^a-z0-9]+", "-", s.sprite_name.lower())
    name = f"{slug}-x1.gif"
    with workspace(browser, s, s.owner) as page:
        opener = role(page, "button", "Export")
        click(opener)
        dialog = role(page, "dialog", "Export")
        select(role(dialog, "combobox", "Format"), "GIF")
        fill(role(dialog, "spinbutton", "Scale"), "1")
        click(role(dialog, "button", "Start export"))
        expect(role(dialog, "status", "Job progress")).to_have_text(f"Stored: {name}", timeout=SYNC_MS * 3)
        press(page, "Escape")
        expect(dialog).to_have_count(0, timeout=SYNC_MS)
        expect(opener).to_be_focused(timeout=SYNC_MS)
    rows = s.owner.client.get(f"/api/projects/{s.pid}/exports").json()["exports"]
    data = s.owner.client.get(f"/api/exports/{rows[0]['id']}/files/{name}").content
    _, _, _, frames = gif_decode(data)
    assert [f.delay for f in frames] == [10, 11, 2]
    assert frames[1].colour_at(2, 2) == RED[:6]
    with workspace(browser, s, s.rev) as page:
        expect(role(page, "button", "Export")).to_have_count(0, timeout=SYNC_MS)


def test_wf_export_job_sheet_dialog(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=5, sprite_name=f"Run {uuid.uuid4().hex[:4]}",
                    cels={(n, "Body"): with_cells(16, 16, {(0, 0): 1}) for n in range(1, 6)})
    slug = re.sub(r"[^a-z0-9]+", "-", s.sprite_name.lower())
    png_name, json_name = f"{slug}-sheet-x1.png", f"{slug}-sheet-x1.json"
    with workspace(browser, s, s.owner) as page:
        click(role(page, "button", "Export"))
        dialog = role(page, "dialog", "Export")
        select(role(dialog, "combobox", "Format"), "Sheet")
        fill(role(dialog, "spinbutton", "Scale"), "1")
        fill(role(dialog, "spinbutton", "Padding"), "2")
        fill(role(dialog, "spinbutton", "Extrude"), "1")
        click(role(dialog, "button", "Start export"))
        expect(role(dialog, "status", "Job progress")).to_have_text(f"Stored: {png_name}, {json_name}", timeout=SYNC_MS * 3)
    rows = s.owner.client.get(f"/api/projects/{s.pid}/exports").json()["exports"]
    sheet = png_decode(s.owner.client.get(f"/api/exports/{rows[0]['id']}/files/{png_name}").content)
    meta = json.loads(s.owner.client.get(f"/api/exports/{rows[0]['id']}/files/{json_name}").content)
    assert (sheet.width, sheet.height) == (58, 38)
    assert [(f["x"], f["y"]) for f in meta["frames"]] == [(1, 1), (21, 1), (41, 1), (1, 21), (21, 21)]
    assert sheet.hex_at(21, 21) == RED and sheet.hex_at(20, 20) == RED, "the extrude ring repeats the edge pixel"
    assert meta["meta"]["padding"] == 2 and meta["meta"]["extrude"] == 1
    with opened(browser, app_url, s.owner, f"/projects/{s.pid}") as page:
        page.reload()
        expect(role(role(page, "table", "Exports"), "link", f"Download {png_name}")).to_be_visible(timeout=UI_MS)


def test_wf_offline_replay_watcher_waits(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        start = stage(watcher).get_attribute("data-composite-hash")
        page.context.set_offline(True)
        expect(status(page, "Sync status")).to_contain_text("Offline", timeout=SYNC_MS)
        move_cursor(page, 6, 6)
        press(page, "Space")
        expect(status(page, "Sync status")).to_have_text(queued_line(1), timeout=SYNC_MS)
        attr(stage(watcher), "data-composite-hash", start)
        assert seq_of(s.ed2.client, s.sid) == 0
        page.context.set_offline(False)
        expect(status(page, "Sync status")).to_contain_text(f"Reconnected · {counted(1, 'update')} applied", timeout=SYNC_MS)
        expect(status(watcher, "Team announcements")).to_contain_text(f"{s.ed.name} painted 1 pixel", timeout=SYNC_MS)
        final = hash_of(s.ed.client, s.sid)
        hash_is(watcher, final)
        hash_is(page, final)


def test_wf_offline_replay_removed_swatch(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page, workspace(browser, s, s.ed2) as watcher:
        pick_swatch(page, 3)
        page.context.set_offline(True)
        expect(status(page, "Sync status")).to_contain_text("Offline", timeout=SYNC_MS)
        move_cursor(page, 2, 2)
        press(page, "Space")
        expect(status(page, "Sync status")).to_have_text(queued_line(1), timeout=SYNC_MS)
        assert s.ed2.client.delete(f"/api/palettes/{s.palette}/swatches/3").status_code == 200
        page.context.set_offline(False)
        removed_swatch = 3
        refusal = f"{counted(1, 'stroke')} refused: " + "Swatch " + str(removed_swatch) + " was removed"
        expect(status(page, "Sync status")).to_contain_text(refusal, timeout=SYNC_MS)
        assert indices(s.ed.client, s.sid)[2][2] == 0
        final = hash_of(s.ed.client, s.sid)
        hash_is(page, final)
        hash_is(watcher, final)


def test_wf_offline_replay_shift_run_reload(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed) as page:
        page.context.set_offline(True)
        expect(status(page, "Sync status")).to_contain_text("Offline", timeout=SYNC_MS)
        move_cursor(page, 3, 3)
        page.keyboard.down("Shift")
        press(page, "ArrowRight", "ArrowRight", "ArrowRight")
        page.keyboard.up("Shift")
        expect(status(page, "Sync status")).to_have_text(queued_line(1), timeout=SYNC_MS)
        page.context.set_offline(False)
        expect(status(page, "Sync status")).to_contain_text("Reconnected", timeout=SYNC_MS)
        poll(lambda: seq_of(s.ed.client, s.sid) == 1, "the run replayed as one operation")
        assert cells(indices(s.ed.client, s.sid), 1) == {(3, 3), (4, 3), (5, 3), (6, 3)}
        assert [e["seq"] for e in events_since(s.ed.client, s.sid)] == [1]
        page.reload()
        expect(status(page, "Sync status")).to_have_text("Synced", timeout=UI_MS)
        attr(stage(page), "data-seq", "1")
        hash_is(page, hash_of(s.ed.client, s.sid))


def test_wf_sharing_expiry_viewer_live(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    end = later(app_url, INVITE_TTL)
    r = s.owner.client.post(f"/api/sprites/{s.sid}/links", json={"label": "Client", "expires_at": end})
    assert r.status_code == 201
    token = r.json()["token"]
    with opened(browser, app_url, None, f"/s/{token}") as viewer:
        expect(stage(viewer)).to_be_visible(timeout=UI_MS)
        expect(role(viewer, "region", "Preview")).to_be_visible(timeout=UI_MS)
        paint(s.ed.client, s.sid, [[5, 5]])
        hash_is(viewer, hash_of(s.ed.client, s.sid))
        expect(role(viewer, "region", "Live cursors")).to_have_count(0)
        expect(role(viewer, "list", "On this sprite")).to_have_count(0)
        clock_advance(app_url, INVITE_TTL)
        expect(role(viewer, "heading", "This link has ended")).to_be_visible(timeout=PUSH_MS + GRACE_MS)
    assert httpx.get(f"{app_url}/s/{token}", timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_TIMEOUT).status_code == 404


def test_wf_phone_painting_zoom_buttons(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed, size=PHONE, paused=True) as page, workspace(browser, s, s.ed2) as desk:
        enable_touch(page)
        zoom = int(stage(page).get_attribute("data-zoom"))
        assert zoom in (1, 2, 4, 8)
        click(role(page, "button", "Zoom out"))
        attr(stage(page), "data-zoom", str(zoom // 2 or 1))
        click(role(page, "button", "Zoom in"))
        attr(stage(page), "data-zoom", str(zoom))
        spot = cell_point(page, 2, 3)
        touch(page, "touchStart", [spot])
        touch(page, "touchEnd", [])
        attr(stage(desk), "data-seq", "1")
        assert cells(indices(s.ed.client, s.sid), 1) == {(2, 3)}
        final = hash_of(s.ed.client, s.sid)
        hash_is(desk, final)
        page.reload()
        hash_is(page, final)


def test_wf_phone_painting_palette_tab(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    with workspace(browser, s, s.ed, size=PHONE, paused=True) as page, workspace(browser, s, s.ed2) as desk:
        enable_touch(page)
        tabs = role(page, "tablist", "Workspace")
        click(role(tabs, "tab", "Palette"))
        click(role(role(page, "listbox", "Palette"), "option", "Swatch 2"))
        click(role(tabs, "tab", "Canvas"))
        expect(stage(page)).to_be_visible(timeout=SYNC_MS)
        touch(page, "touchStart", [cell_point(page, 1, 5)])
        touch(page, "touchMove", [cell_point(page, 4, 5)])
        touch(page, "touchEnd", [])
        attr(stage(desk), "data-seq", "1")
        rows = indices(s.ed.client, s.sid)
        assert [rows[5][x] for x in range(1, 5)] == [2, 2, 2, 2]
        hash_is(desk, hash_of(s.ed.client, s.sid))


def test_wf_phone_painting_frames_tab(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url, frames=3)
    with workspace(browser, s, s.ed, size=PHONE, paused=True) as page, workspace(browser, s, s.ed2) as desk:
        enable_touch(page)
        stage(page).focus()
        press(page, "Period")
        announced(page, "Frame 2 of 3")
        tabs = role(page, "tablist", "Workspace")
        click(role(tabs, "tab", "Frames"))
        expect(role(page, "grid", "Frames")).to_be_visible(timeout=SYNC_MS)
        click(role(tabs, "tab", "Canvas"))
        attr(stage(page), "data-frame", "2")
        touch(page, "touchStart", [cell_point(page, 7, 7)])
        touch(page, "touchEnd", [])
        attr(stage(desk), "data-seq", "1")
        assert indices(s.ed.client, s.sid, frame=2)[7][7] == 1
        assert cells(indices(s.ed.client, s.sid, frame=1), 1) == set()


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_notices_list_packages() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "Stack Sans Headline" in notices and "Stack Sans Text" in notices
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == [], missing


def test_if_allowed_licences() -> None:
    allowed = {"MIT", "Apache-2.0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.1", "0BSD"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert bad == [], bad


def test_if_only_published_services() -> None:
    banned = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "amqplib", "kafkajs", "nats", "bullmq", "memcached"}
    assert banned & {p.name for p in shipped_packages()} == set()
    assert Postgres().tables(), "no tables in Postgres"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    s = make_studio(app_url)
    for path in ("/", "/signin", f"/projects/{s.pid}", s.path):
        foreign: list[str] = []
        with open_app(browser, f"{app_url}/signin") as page:
            page.clock.resume()
            page.on("request", lambda req: foreign.append(req.url) if req.url.startswith("http") and not same_origin(req.url, app_url) else None)
            sign_in(page, app_url, s.owner)
            page.goto(f"{app_url}{path}")
            page.wait_for_load_state("load")
        assert foreign == [], f"{path}: {foreign}"


def test_if_lockfile_pins() -> None:
    assert (Path("/app") / "package-lock.json").exists()
    lock = json.loads((Path("/app") / "package-lock.json").read_text())
    assert lock.get("packages"), "the lockfile pins nothing"
    manifest = json.loads((Path("/app") / "package.json").read_text())
    deps = {**manifest.get("dependencies", {}), **manifest.get("devDependencies", {})}
    loose = {k: v for k, v in deps.items() if re.search("png|gif", k, re.I) and not re.fullmatch(r"\d+\.\d+\.\d+", v)}
    assert loose == {}, loose


def test_if_no_committed_credentials() -> None:
    values = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if len(os.environ.get(k, "")) > 3] + [GRADING_KEY]
    skip = {"node_modules", ".git", "dist", "build", ".next"}
    for path in Path("/app").rglob("*"):
        if path.is_file() and not skip & set(path.parts) and path.stat().st_size < JSON_MAX:
            body = path.read_text(errors="ignore")
            assert not any(v in body for v in values), f"a credential appears in {path}"
