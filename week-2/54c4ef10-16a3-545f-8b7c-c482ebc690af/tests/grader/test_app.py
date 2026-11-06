from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import re
import socket
import statistics
import struct
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Page, Route, expect

from conftest import (
    S3,
    Postgres,
    capture,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    tab_order,
)

HTTP_TIMEOUT = 120
UI_TIMEOUT_MS = 15_000
expect.set_options(timeout=UI_TIMEOUT_MS)

UPLOAD_LIMIT = 60_000_000
JSON_LIMIT = 65_536
UPLOAD_AT_LIMIT_S = 30
REFUSAL_S = 5
HEALTH_S = 1
CUTOFF_RELEASE_S = 2
CUTOFF_SLACK_S = 1
CUTOFF_ROUNDS = 10
SHORT_TTL_S = 3
TTL_DEADLINE_S = 30
NOTE_LIMIT = 500
TITLE_LIMIT = 80
NAME_LIMIT = 80
STOCK_LIMIT = 60
DPI = 300
PITCH_35_MM = 38
IMAGE_35_MM = 36
PITCH_66_MM = 62
IMAGE_66_MM = 56
MM_PER_INCH = 25.4
WIDTH_TOLERANCE = 0.06
PREVIEW_SLICE_W = 2048
MAX_W = 20_000
MAX_H = 4_000
MAX_PIXELS = 40_000_000
MIN_SIDE = 64
TEXT_INFLATE_LIMIT = 1_000_000
LOG_H_PER_STOP = 0.30103
SPEED_NET = 0.10
CI_SPAN = 1.30
WEDGE_STEPS = 21
CODE_8 = 255
CODE_16 = 65535
GROUND = (19, 54, 33)
GOLD = (244, 217, 108)
LOUPE_SIDE_PX = 120
LOUPE_OPEN_MIN_MS = 150
LOUPE_OPEN_MAX_MS = 200
LOUPE_CLOSE_MAX_MS = 150
TOUCH_TARGET_PX = 44
DESKTOP_H = 800
VIEWPORT_SIZES = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
VIEWPORTS = ["phone", "tablet", "desktop"]

MINUS = "\u2212"
ELLIPSIS = "\u2026"
ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
APERTURES = ["1", "1.1", "1.2", "1.4", "1.6", "1.8", "2", "2.2", "2.5", "2.8", "3.2", "3.5", "4", "4.5", "5",
             "5.6", "6.3", "7.1", "8", "9", "10", "11", "13", "14", "16", "18", "20", "22", "25", "29", "32",
             "36", "40", "45", "51", "57", "64"]
BRACKET_SHUTTERS = ["1/1000", "1/500", "1/250", "1/125", "1/60", "1/30", "1/15", "1/8", "1/4"]

UNREADABLE = "This file could not be read as an image."
DIMENSIONS = "Scans are limited to 20,000 × 4,000 pixels and 40,000,000 pixels in total."
PIXEL_FORMAT = "Use 8- or 16-bit greyscale or RGB."
TIFF_LAYOUT = "TIFF scans must hold one striped image, uncompressed or LZW- or Deflate-compressed."
EDGE_COPY = "Frame edges must stay inside the scan, at least 8 pixels apart, without overlapping a neighbour."
OUTAGE_OTHER = "Storage is unreachable, so new readings are paused."
OUTAGE_UPLOAD = "Storage is unreachable. Nothing was stored; try again when it is back."
BANNER = ("Negative storage is unreachable. Uploads and new readings are paused; your notes, alignments "
          "and pinned readings are still here.")
NOT_FOUND = {"error": "not_found"}
OUTLINE_PX = 2
FONT_NAME = "Host Grotesk"


def edge_name(n: int, side: str) -> str:
    return f"Frame {n} {side} edge"


def accept_name(n: int) -> str:
    return f"Accept frame {n} width"


def readings_name(n: int) -> str:
    return f"Readings for frame {n}"


def note_frame_name(counter: int) -> str:
    return f"Frame for note {counter}"


def open_frame_name(n: int) -> str:
    return f"Open frame {n}"


def strip_name(position: int) -> str:
    return f"Strip {position}"


def stored_copy(filename: str) -> str:
    return f"Stored {filename}: size and checksum confirmed."


def edit_note_name(counter: int) -> str:
    return f"Edit note {counter}"


def save_note_name(counter: int) -> str:
    return f"Save note {counter}"


def note_preview_name(counter: int) -> str:
    return f"Exposure preview for note {counter}"

GAP_CODE = 210
SLIVER_CODE = 100
FRAME_W = 425
GAP_W = 24
SLIVER_W = 150
STRIP_H = 64
SLIP_NOTE = uuid.uuid4().hex[:8]
CHECKER = -1
BRIGHT_AT = 10
CLEAR_AREA = {"x": 8, "y": 0, "w": 32, "h": 8}
SLIP_CODES = [110, 50, 25, 150, 30, 80]
SLIP_SHUTTERS = ["1/60", "1/15", "1/250", "1/8", "1/30"]
BRACKET_NETS = [0.06, 0.08, 0.13, 0.25, 0.42, 0.60, 0.78, 0.95, 1.12]
PNG_SIG = b"\x89PNG\r\n\x1a\n"
ADAM7 = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]


def minio_down_url() -> str:
    return os.environ["APP_MINIO_DOWN_URL"].rstrip("/")


def short_session_url() -> str:
    return os.environ["APP_SHORT_SESSION_URL"].rstrip("/")


def half_away(value: float, places: int) -> float:
    return float(Decimal(repr(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def signed(value: float, places: int = 2) -> str:
    rounded = half_away(value, places)
    if rounded == 0:
        return f"{0:.{places}f}"
    return ("+" if rounded > 0 else MINUS) + f"{abs(rounded):.{places}f}"


def fixed(value: float, places: int = 2) -> str:
    return f"{half_away(value, places):.{places}f}"


def shutter_seconds(text: str) -> float:
    return 1 / int(text[2:]) if text.startswith("1/") else float(int(text.rstrip('"')))


def exposure_stops(ev: float, ei: int, aperture: str, shutter: str, p: float) -> float:
    t = shutter_seconds(shutter)
    t_eff = t ** p if t > 1 else t
    return ev + math.log2(ei / 100) - APERTURES.index(aperture) / 3 + math.log2(t_eff)


def gross_of(linear: float, ref: float = 1.0) -> float:
    if linear <= 0:
        return 3.0
    return min(3.0, max(0.0, math.log10(ref / linear)))


def srgb_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3 or len(set(xs)) < 2 or len(set(ys)) < 2:
        return None
    rx, ry = ranks(xs), ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    var = sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)
    return cov / math.sqrt(var)


def expected_proposal(entries: list[dict], frames: dict[int, tuple[float, bool]]) -> dict:
    counters = sorted(e["counter"] for e in entries)

    def score(o: int, s: int | None) -> float | None:
        xs, ys = [], []
        for e in entries:
            c = e["counter"]
            n = c + o if s is None or c <= s else c + o + 1
            if n not in frames or e["misfire"] or frames[n][1]:
                continue
            xs.append(e["stops"])
            ys.append(frames[n][0])
        return spearman(xs, ys)

    plain = {o: score(o, None) for o in range(-2, 3)}
    slips = {(o, s): score(o, s) for o in range(-2, 3) for s in counters[:-1]}
    best_plain = min(((o, round(v, 6)) for o, v in plain.items() if v is not None),
                     key=lambda kv: (-kv[1], abs(kv[0]), kv[0]), default=None)
    best_slip = min(((k, round(v, 6)) for k, v in slips.items() if v is not None),
                    key=lambda kv: (-kv[1], abs(kv[0][0]), kv[0][0], kv[0][1]), default=None)
    if best_slip and (best_plain is None or round(best_slip[1] - best_plain[1], 6) >= 0.10):
        offset, slip, rho = best_slip[0][0], best_slip[0][1], best_slip[1]
    else:
        offset = best_plain[0] if best_plain else None
        slip, rho = None, (best_plain[1] if best_plain else None)
    return {"offset": offset, "slip": slip, "rho": rho, "plain": plain, "slips": slips}


def curve_points(pairs: list[tuple[float, float]]) -> list[tuple[float, float]]:
    grouped: dict[float, list[float]] = {}
    for stops, net in pairs:
        grouped.setdefault(stops * LOG_H_PER_STOP, []).append(net)
    points, top = [], -math.inf
    for log_h in sorted(grouped):
        top = max(top, statistics.fmean(grouped[log_h]))
        points.append((log_h, top))
    return points


def curve_density_at(points: list[tuple[float, float]], log_h: float) -> float:
    for (h0, d0), (h1, d1) in zip(points, points[1:]):
        if h0 <= log_h <= h1:
            return d0 if h1 == h0 else d0 + (d1 - d0) * (log_h - h0) / (h1 - h0)
    raise AssertionError("log H outside the curve")


def speed_point(points: list[tuple[float, float]]) -> float | None:
    if not points or points[0][1] >= SPEED_NET:
        return None
    for (h0, d0), (h1, d1) in zip(points, points[1:]):
        if d0 < SPEED_NET <= d1:
            return h0 + (SPEED_NET - d0) * (h1 - h0) / (d1 - d0)
    return None


def contrast_index(points: list[tuple[float, float]]) -> float | None:
    sp = speed_point(points)
    if sp is None or sp + CI_SPAN > points[-1][0]:
        return None
    return (curve_density_at(points, sp + CI_SPAN) - SPEED_NET) / CI_SPAN


def invert(points: list[tuple[float, float]], net: float) -> float | None:
    if net < points[0][1] or net > points[-1][1]:
        return None
    if net == points[0][1]:
        return points[0][0]
    for (h0, d0), (h1, d1) in zip(points, points[1:]):
        if d1 >= net:
            return h0 if d1 == d0 else h0 + (net - d0) * (h1 - h0) / (d1 - d0)
    return None


def zone_of(points: list[tuple[float, float]], net: float) -> str | None:
    sp = speed_point(points)
    if sp is None:
        return None
    if net < points[0][1]:
        return "0"
    if net > points[-1][1]:
        return "X"
    z = 1 + half_away((invert(points, net) - sp) / LOG_H_PER_STOP, 0)
    return ROMAN[int(min(10, max(0, z)))]


def recount(sheet: dict) -> dict:
    frames, entries = sheet["frames"], sheet["entries"]
    return {
        "detected": len(frames),
        "aligned": sum(1 for e in entries if e["frame_id"]),
        "unexposed": sum(1 for f in frames if f["net_density"] is not None and f["net_density"] <= 0.05),
        "unmatched_notes": sum(1 for e in entries if not e["frame_id"]),
    }


def tint(code: int) -> tuple[int, int, int]:
    return tuple(round(g + (i - g) * code / CODE_8) for g, i in zip(GROUND, GOLD))


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _row(y: int, xs: range, sample: Callable, depth: int) -> bytes:
    out = bytearray(b"\0")
    for x in xs:
        v = sample(x, y)
        vals = v if isinstance(v, tuple) else (v,)
        out += struct.pack(f">{len(vals)}H", *vals) if depth == 16 else bytes(vals)
    return bytes(out)


def raw_rows(width: int, height: int, sample: Callable, depth: int, interlace: bool) -> bytes:
    if not interlace:
        return b"".join(_row(y, range(width), sample, depth) for y in range(height))
    parts = []
    for x0, y0, dx, dy in ADAM7:
        if x0 >= width or y0 >= height:
            continue
        for y in range(y0, height, dy):
            parts.append(_row(y, range(x0, width, dx), sample, depth))
    return b"".join(parts)


def png_bytes(width: int, height: int, sample: Callable | None = None, *, depth: int = 8, colour: int = 0,
              interlace: bool = False, pre: tuple = (), raw: bytes | None = None, idat: bytes | None = None,
              ihdr: bytes | None = None, post: tuple = ()) -> bytes:
    if idat is None:
        idat = zlib.compress(raw if raw is not None else raw_rows(width, height, sample, depth, interlace))
    header = ihdr if ihdr is not None else chunk(
        b"IHDR", struct.pack(">IIBBBBB", width, height, depth, colour, 0, 0, 1 if interlace else 0))
    return PNG_SIG + header + b"".join(pre) + chunk(b"IDAT", idat) + b"".join(post) + chunk(b"IEND", b"")


def png_pixels(data: bytes) -> tuple[int, int, int, list[bytes]]:
    assert data[:8] == PNG_SIG, "expected a PNG"
    pos, idat = 8, b""
    width = height = depth = colour = interlace = 0
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b"IHDR":
            width, height, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    assert depth == 8 and interlace == 0, f"reader handles 8-bit non-interlaced PNG, got {depth}/{interlace}"
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[colour]
    raw, stride = zlib.decompress(idat), width * ch
    rows, prev, p = [], bytearray(stride), 0
    for _ in range(height):
        f, line = raw[p], bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        for i in range(stride):
            a = line[i - ch] if i >= ch else 0
            b = prev[i]
            c = prev[i - ch] if i >= ch else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return width, height, ch, rows


def rgb_at(img: tuple[int, int, int, list[bytes]], x: int, y: int) -> tuple[int, int, int]:
    _, _, ch, rows = img
    px = rows[y][x * ch:x * ch + ch]
    return (px[0], px[0], px[0]) if ch < 3 else (px[0], px[1], px[2])


def _ifd(endian: str, offset: int, entries: list, next_offset: int) -> bytes:
    entries = sorted(entries)
    body, extra = b"", b""
    extra_start = offset + 2 + 12 * len(entries) + 4
    for tag, typ, vals in entries:
        fmt = {3: "H", 4: "I"}[typ]
        packed = b"".join(struct.pack(endian + fmt, v) for v in vals)
        if len(packed) <= 4:
            field = packed.ljust(4, b"\0")
        else:
            field = struct.pack(endian + "I", extra_start + len(extra))
            extra += packed + (b"\0" if len(packed) % 2 else b"")
        body += struct.pack(endian + "HHI", tag, typ, len(vals)) + field
    return struct.pack(endian + "H", len(entries)) + body + struct.pack(endian + "I", next_offset) + extra


def tiff_bytes(width: int, height: int, sample: Callable, *, bits: int = 8, spp: int = 1, photometric: int = 1,
               endian: str = "<", compression: int = 1, predictor: int | None = None,
               sample_format: int | None = None, pages: int = 1, tiled: bool = False, loop: bool = False,
               strip_offset_shift: int = 0, byte_count_cut: int = 0, ifd_outside: bool = False) -> bytes:
    rows = []
    for y in range(height):
        vals: list[int] = []
        for x in range(width):
            v = sample(x, y)
            vals.extend(v if isinstance(v, tuple) else (v,))
        if predictor == 2:
            mod = 1 << bits
            vals = vals[:spp] + [(vals[i] - vals[i - spp]) % mod for i in range(spp, len(vals))]
        rows.append(b"".join(struct.pack(endian + ("H" if bits == 16 else "B"), v) for v in vals))
    data = b"".join(rows)
    if compression == 8:
        data = zlib.compress(data)
    data += b"\0" if len(data) % 2 else b""
    ifd_off = 8 + len(data)
    entries = [(256, 4, [width]), (257, 4, [height]), (258, 3, [bits] * spp), (259, 3, [compression]),
               (262, 3, [photometric]), (277, 3, [spp]), (284, 3, [1])]
    if tiled:
        entries += [(322, 3, [64]), (323, 3, [64]), (324, 4, [8]), (325, 4, [len(data)])]
    else:
        entries += [(273, 4, [8 + strip_offset_shift]), (278, 4, [height]), (279, 4, [len(data) - byte_count_cut])]
    if predictor:
        entries.append((317, 3, [predictor]))
    if sample_format:
        entries.append((339, 3, [sample_format] * spp))
    first_len = len(_ifd(endian, ifd_off, entries, 0))
    second_off = ifd_off + first_len
    blob = _ifd(endian, ifd_off, entries, second_off if pages > 1 else 0)
    if pages > 1:
        blob += _ifd(endian, second_off, entries, ifd_off if loop else 0)
    header_off = ifd_off + len(blob) + 4096 if ifd_outside else ifd_off
    order = b"II" if endian == "<" else b"MM"
    return order + struct.pack(endian + "H", 42) + struct.pack(endian + "I", header_off) + data + blob


def private_padding(total: int, image: bytes) -> bytes:
    body = total - len(image) - 12
    pad = chunk(b"prVt", b"\0" * body)
    return image[:-12] + pad + image[-12:]


@dataclass
class Frame:
    code: int | None = None
    width: int = FRAME_W
    right: int | None = None
    gradient: bool = False


@dataclass
class Plan:
    data: bytes
    width: int
    height: int
    maxv: int
    sample: Callable[[int, int], int]
    band: list[float]
    frames: list[tuple[int, int, bool]]

    def cell_gross(self, x: int, y: int, ref: float = 1.0, transfer: Callable[[float], float] = lambda c: c) -> float:
        cx, cy = 8 * (x // 8), 8 * (y // 8)
        vals = [transfer(self.sample(i, j) / self.maxv)
                for i in range(cx, min(cx + 8, self.width)) for j in range(cy, min(cy + 8, self.height))]
        return gross_of(statistics.fmean(vals), ref)

    def frame_gross(self, x0: int, x1: int, ref: float = 1.0) -> float:
        w = x1 - x0
        cols = [self.band[x] for x in range(x0, x1) if x0 + 0.2 * w <= x < x1 - 0.2 * w]
        return gross_of(statistics.fmean(cols), ref)

    def base_fog(self, edges: list[tuple[int, int]], ref: float = 1.0) -> float:
        edges = sorted(edges)
        top = max(self.band)
        gaps = [x for x in range(self.width) if self.band[x] >= 0.8 * top]
        inner = [x for x in gaps if edges[0][1] <= x < edges[-1][0] and not any(a <= x < b for a, b in edges)]
        return statistics.median(gross_of(self.band[x], ref) for x in (inner or gaps))


def wedge_code(step: int) -> int:
    return round(250 * 10 ** (-0.08 * step))


def build_strip(frames: list[Frame], *, gap_codes: list | None = None, right_run: tuple[int, int] | None = None,
                depth: int = 8, frame_gap: int = GAP_W, wedge: bool = False, height: int = STRIP_H) -> Plan:
    k = 257 if depth == 16 else 1
    cols: list[int] = [CHECKER] * SLIVER_W
    first_gap = [GAP_CODE * k] * frame_gap
    for i in range(BRIGHT_AT, BRIGHT_AT + 3):
        first_gap[i] = CODE_8 * k
    cols += first_gap
    bounds = []
    for i, f in enumerate(frames):
        x0 = len(cols)
        for j in range(f.width):
            if f.code is None:
                cols.append(GAP_CODE * k)
            elif f.gradient:
                cols.append(f.code + (j // 8) * 2 * k)
            elif f.right is not None and j >= f.width // 2:
                cols.append(f.right)
            else:
                cols.append(f.code)
        bounds.append((x0, x0 + f.width, f.code is None))
        if i < len(frames) - 1:
            g = gap_codes[i] if gap_codes else GAP_CODE
            if isinstance(g, tuple):
                cols += [g[0] * k] * (frame_gap // 2) + [g[1] * k] * (frame_gap - frame_gap // 2)
            else:
                cols += [g * k] * frame_gap
    cols += [GAP_CODE * k] * frame_gap
    cols += [right_run[1] * k] * right_run[0] if right_run else [SLIVER_CODE * k] * SLIVER_W
    width, maxv = len(cols), CODE_8 * k

    def sample(x: int, y: int) -> int:
        c = cols[x]
        if y < 8 and 8 <= x < 40:
            return maxv
        if wedge and y >= height - 8:
            if x < 210:
                return wedge_code(x // 10) * k
            if 220 <= x < 430:
                return wedge_code(20 - (x - 220) // 10) * k
        if c == CHECKER:
            return SLIVER_CODE * k if y < 8 else (maxv if (x + y) % 2 else 0)
        return c

    band_rows = [y for y in range(height) if 0.2 * height <= y < 0.8 * height]
    band = [statistics.fmean(sample(x, y) for y in band_rows) / maxv for x in range(width)]
    return Plan(png_bytes(width, height, sample, depth=depth), width, height, maxv, sample, band, bounds)


def net_code(net: float) -> int:
    return round(GAP_CODE / 10 ** net)


class Account:
    def __init__(self, base: str, tag: str = "developer") -> None:
        self.base = base.rstrip("/")
        self.email = f"{tag}-{uuid.uuid4().hex[:12]}@edgeprint.test"
        self.password = f"darkroom-{uuid.uuid4().hex[:12]}"
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        r = self.http.post("/api/auth/signup", json={"email": self.email, "password": self.password})
        assert r.status_code == 201, r.text
        self.id = r.json()["id"]

    def on(self, base: str) -> httpx.Client:
        client = httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_TIMEOUT)
        r = client.post("/api/auth/signin", json={"email": self.email, "password": self.password})
        assert r.status_code == 200, r.text
        return client

    def cookie(self) -> str:
        return self.http.cookies.get("edgeprint_session")


def make_roll(acct: Account, **over: Any) -> dict:
    body = {"name": f"Roll {uuid.uuid4().hex[:8]}", "stock": "Kestrel 400", "format": "35mm", "ei": 400,
            "push_pull": 0, "reciprocity_p": 1.0, "development_note": "", "kind": "normal", "curve_roll_id": None}
    body.update(over)
    r = acct.http.post("/api/rolls", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def add_entry(acct: Account, roll_id: str, counter: int, shutter: str, *, aperture: str = "8", ev: float = 10,
              note: str = "", misfire: bool = False) -> dict:
    r = acct.http.post(f"/api/rolls/{roll_id}/entries", json={
        "counter": counter, "aperture": aperture, "shutter": shutter, "metered_ev": ev, "note": note,
        "misfire": misfire})
    assert r.status_code == 201, r.text
    return r.json()


def upload(client: httpx.Client, roll_id: str, data: bytes, *, dpi: Any = DPI, first_edge: Any = 1,
           filename: str = "strip.png", size: Any = None, sha: str | None = None,
           content_type: str = "application/octet-stream") -> httpx.Response:
    return client.post(
        f"/api/rolls/{roll_id}/scans", params={"dpi": dpi, "first_edge": first_edge, "filename": filename},
        content=data, headers={"X-Scan-Size": str(len(data) if size is None else size),
                               "X-Scan-SHA256": sha or hashlib.sha256(data).hexdigest(),
                               "Content-Type": content_type})


def ready_scan(acct: Account, roll_id: str, plan: Plan, *, first_edge: int = 1, calibrate: bool = True,
               detect: bool = True, filename: str = "strip.png") -> dict:
    r = upload(acct.http, roll_id, plan.data, first_edge=first_edge, filename=filename)
    assert r.status_code == 201, r.text
    scan_id = r.json()["id"]
    if calibrate:
        r = acct.http.post(f"/api/scans/{scan_id}/calibration", json={"method": "clear_light", "area": CLEAR_AREA})
        assert r.status_code == 201, r.text
    if detect:
        r = acct.http.post(f"/api/scans/{scan_id}/frames/detect", json={})
        assert r.status_code == 201, r.text
    return scan_detail(acct.http, scan_id)


def scan_detail(client: httpx.Client, scan_id: str) -> dict:
    r = client.get(f"/api/scans/{scan_id}")
    assert r.status_code == 200, r.text
    scan = r.json()
    scan["frames"] = sorted(scan["frames"], key=lambda f: f["number"])
    return scan


def entries_of(client: httpx.Client, roll_id: str) -> list[dict]:
    r = client.get(f"/api/rolls/{roll_id}/entries")
    assert r.status_code == 200, r.text
    return r.json()["entries"]


def put_alignment(client: httpx.Client, roll_id: str, offset: int, slip: int | None = None,
                  overrides: list | None = None, version: int | None = None) -> httpx.Response:
    if version is None:
        version = client.get(f"/api/rolls/{roll_id}/alignment").json()["version"]
    return client.put(f"/api/rolls/{roll_id}/alignment", json={
        "version": version, "offset": offset, "slip_after": slip, "overrides": overrides or []})


def slip_roll(acct: Account, *, name: str | None = None, align: bool = False) -> tuple[dict, list, Plan, dict]:
    roll = make_roll(acct, name=name or f"Harbour {uuid.uuid4().hex[:6]}", ei=100)
    entries = [add_entry(acct, roll["id"], i + 1, s, note=f"{SLIP_NOTE}-{i + 1}") for i, s in enumerate(SLIP_SHUTTERS)]
    plan = build_strip([Frame(c) for c in SLIP_CODES])
    scan = ready_scan(acct, roll["id"], plan)
    if align:
        assert put_alignment(acct.http, roll["id"], 0, 2).status_code == 200
    return roll, entries, plan, scan


def bracket_roll(acct: Account, name: str, *, align: bool = True) -> tuple[dict, list, list[Plan], list[dict]]:
    roll = make_roll(acct, name=name, kind="test", ei=400)
    entries = [add_entry(acct, roll["id"], c, s, note=f"Grey card, bracket {c}")
               for c, s in enumerate(BRACKET_SHUTTERS, start=1)]
    plans = [build_strip([Frame(net_code(n)) for n in BRACKET_NETS[:6]]),
             build_strip([Frame(net_code(n)) for n in BRACKET_NETS[6:]])]
    scans = [ready_scan(acct, roll["id"], plans[0], first_edge=1),
             ready_scan(acct, roll["id"], plans[1], first_edge=7, filename="strip2.png")]
    if align:
        assert put_alignment(acct.http, roll["id"], 0).status_code == 200
    return roll, entries, plans, scans


def bracket_points(roll: dict, entries: list[dict], misfires: set[int] = frozenset()) -> list[tuple[float, float]]:
    pairs = []
    for e, net in zip(sorted(entries, key=lambda e: e["counter"]), BRACKET_NETS):
        if e["counter"] in misfires:
            continue
        stops = exposure_stops(10, roll["ei"], "8", e["shutter"], roll["reciprocity_p"])
        pairs.append((stops, math.log10(GAP_CODE / net_code(net))))
    return curve_points(pairs)


def poll(check: Callable[[], bool], seconds: float, contract: str) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
    pytest.fail(contract)


class HealthWatch:

    def __init__(self, base: str) -> None:
        self.client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        self.slowest, self.failures, self._stop = 0.0, [], threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            started = time.monotonic()
            r = self.client.get("/api/health")
            self.slowest = max(self.slowest, time.monotonic() - started)
            if r.status_code != 200:
                self.failures.append(r.status_code)
            self._stop.wait(0.05)

    def __enter__(self) -> "HealthWatch":
        self.thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        self.thread.join()


def objects_for(account_id: str, bucket: S3 | None = None) -> list[str]:
    store = bucket or S3()
    return store.keys(f"originals/{account_id}/") + store.keys(f"previews/{account_id}/")


def raw_request(base: str, head_lines: list[str], body: bytes = b"", *, read: bool = True,
                cut_after: int | None = None) -> tuple[int, bytes] | None:
    u = urlparse(base)
    sock = socket.create_connection((u.hostname, u.port or 80), timeout=REFUSAL_S + 5)
    sock.sendall(("\r\n".join(head_lines) + "\r\n\r\n").encode())
    if cut_after is not None:
        sock.sendall(body[:cut_after])
        sock.shutdown(socket.SHUT_RDWR)
        sock.close()
        return None
    if body:
        sock.sendall(body)
    if not read:
        sock.close()
        return None
    buf = b""
    while b"\r\n\r\n" not in buf:
        part = sock.recv(65536)
        if not part:
            break
        buf += part
    head, _, rest = buf.partition(b"\r\n\r\n")
    status = int(head.split(b" ")[1])
    length = re.search(rb"(?i)content-length:\s*(\d+)", head)
    want = int(length.group(1)) if length else len(rest)
    while len(rest) < want:
        part = sock.recv(65536)
        if not part:
            break
        rest += part
    sock.close()
    return status, rest


@contextlib.contextmanager
def app_page(browser: Browser, url: str, *, live: bool = True, **options: Any) -> Iterator[Page]:
    opened = open_app(browser, url, **options)
    if hasattr(opened, "__enter__"):
        with opened as page:
            if live:
                page.clock.resume()
            yield page
    else:
        page = next(opened)
        if live:
            page.clock.resume()
        try:
            yield page
        finally:
            for _ in opened:
                pass


def ui_signin(page: Page, base: str, email: str, password: str, next_path: str | None = None) -> None:
    page.goto(base + "/signin" + (f"?next={quote(next_path, safe='')}" if next_path else ""))
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign in", exact=True).click()
    expect(page).not_to_have_url(re.compile(r"/signin"))


def activity(page: Page):
    return page.get_by_role("status", name="Activity", exact=True)


def watch_activity(page: Page) -> None:
    activity(page).evaluate("""el => {
        window.__activity = [];
        const push = () => { const t = el.textContent.trim(); const a = window.__activity;
                             if (t && a[a.length - 1] !== t) a.push(t); };
        new MutationObserver(push).observe(el, {subtree: true, childList: true, characterData: true});
    }""")


def activity_log(page: Page) -> list[str]:
    return page.evaluate("window.__activity")


def pump(page: Page, check: Callable[[], bool], contract: str, seconds: float = 15) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        page.evaluate("0")
    pytest.fail(contract)


def hold(page: Page, match: Callable[[Any], bool]) -> list[Route]:
    held: list[Route] = []

    def handler(route: Route) -> None:
        if match(route.request):
            held.append(route)
        else:
            route.fallback()

    page.route("**/api/**", handler)
    return held


def is_upload(request: Any) -> bool:
    return request.method == "POST" and re.search(r"/api/rolls/[^/]+/scans\?", request.url) is not None


def is_reading(request: Any) -> bool:
    return request.method == "GET" and "/reading?" in request.url


def workspace(base: str, roll_id: str, scan_id: str) -> str:
    return f"{base}/rolls/{roll_id}/scans/{scan_id}"


SLIDER_JS = """el => ({now: Number(el.getAttribute('aria-valuenow') ?? el.value),
    min: Number(el.getAttribute('aria-valuemin') ?? el.min), max: Number(el.getAttribute('aria-valuemax') ?? el.max)})"""


def expect_now(loc: Any, want: int) -> None:
    deadline = time.monotonic() + UI_TIMEOUT_MS / 1000
    while time.monotonic() < deadline:
        if loc.evaluate(SLIDER_JS)["now"] == want:
            return
    pytest.fail(f"slider value stayed {loc.evaluate(SLIDER_JS)['now']}; expected {want}")


def strip_app(page: Page):
    return page.get_by_role("application", name="Densitometer strip", exact=True)


HIT_AREA_JS = """(el, reach) => {
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const mine = h => !!h && (h === el || el.contains(h) || (h !== document.body && h.contains(el) &&
    h.querySelectorAll('[role="slider"], input[type="range"]').length === 1));
  return [[-reach, 0], [reach, 0], [0, -reach], [0, reach]].every(([dx, dy]) =>
    mine(document.elementFromPoint(cx + dx, cy + dy)));
}"""


def settled_pixels(loc: Any, seconds: float = 5) -> tuple[int, int, int, list[bytes]]:
    seen: list[tuple[int, int, int, list[bytes]]] = []

    def steady() -> bool:
        seen.append(png_pixels(capture(loc)))
        return len(seen) >= 2 and seen[-1] == seen[-2]

    poll(steady, seconds, "the capture never settled after its motion ended")
    return seen[-1]


def frame_center(scan: dict, number: int) -> tuple[int, int]:
    f = next(f for f in scan["frames"] if f["number"] == number)
    return (f["x0"] + f["x1"]) // 2, scan["height"] // 2


def point_on_strip(page: Page, scan: dict, x: int, y: int) -> tuple[float, float]:
    box = strip_app(page).bounding_box()
    return box["x"] + box["width"] * (x + 0.5) / scan["width"], box["y"] + box["height"] * (y + 0.5) / scan["height"]


def reading(client: httpx.Client, scan_id: str, x: int, y: int) -> dict:
    r = client.get(f"/api/scans/{scan_id}/reading", params={"x": x, "y": y})
    assert r.status_code == 200, r.text
    return r.json()


def test_api_accounts_and_sessions(app_url: str) -> None:
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    assert anon.get("/api/health").json() == {"status": "ok"}
    assert anon.get("/api/storage").json()["storage"] in ("ok", "unavailable")
    for path in ("/api/me", "/api/rolls"):
        r = anon.get(path)
        assert (r.status_code, r.json()) == (401, {"error": "unauthenticated"}), path
    stem = uuid.uuid4().hex[:10]
    mixed = f"Mixed-{stem}@Edgeprint.test"
    r = anon.post("/api/auth/signup", json={"email": "not-an-address", "password": "p" * 9})
    assert r.status_code == 422
    assert r.json()["fields"] == {"email": "Enter a valid email address.", "password": "Use 10 to 128 characters."}
    r = anon.post("/api/auth/signup", json={"email": mixed, "password": "p" * 129})
    assert r.status_code == 422 and r.json()["fields"]["password"] == "Use 10 to 128 characters."
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    r = client.post("/api/auth/signup", json={"email": mixed, "password": "p" * 10})
    assert r.status_code == 201 and r.json()["email"] == mixed.lower()
    cookie = r.headers.get("set-cookie", "")
    assert cookie.startswith("edgeprint_session")
    assert "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    me = client.get("/api/me")
    assert me.status_code == 200 and me.json()["email"] == mixed.lower() and me.json()["latest_aligned_frame"] is None
    r = anon.post("/api/auth/signup", json={"email": mixed.lower(), "password": "q" * 12})
    assert (r.status_code, r.json()) == (409, {"error": "email_taken"})
    r = anon.post("/api/auth/signup", json={"email": f"long-{stem}@edgeprint.test", "password": "w" * 128})
    assert r.status_code == 201
    other = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    r = other.post("/api/auth/signin", json={"email": mixed.lower(), "password": "p" * 11})
    assert (r.status_code, r.json()) == (401, {"error": "invalid_credentials"})
    r = other.post("/api/auth/signin", json={"email": mixed.lower(), "password": "p" * 10})
    assert r.status_code == 200 and r.json()["email"] == mixed.lower()
    assert other.post("/api/auth/signout").status_code == 204
    assert other.get("/api/me").status_code == 401
    assert client.get("/api/me").status_code == 200, "signing out one session must not end another"
    short = Account(short_session_url(), "ttl")
    assert short.http.get("/api/me").status_code == 200
    poll(lambda: short.http.get("/api/me").status_code == 401, TTL_DEADLINE_S,
         "GET /api/me kept answering 200 after SESSION_TTL_SECONDS elapsed; expected 401 unauthenticated")
    assert short.http.get("/api/rolls").json() == {"error": "unauthenticated"}


def test_api_foreign_ids_not_found(app_url: str) -> None:
    owner, intruder = Account(app_url, "owner"), Account(app_url, "intruder")
    roll, entries, plan, scan = slip_roll(owner, align=True)
    test_roll = make_roll(owner, kind="test")
    frame = scan["frames"][0]
    cx, cy = frame_center(scan, 1)
    assert owner.http.post(f"/api/scans/{scan['id']}/readings", json={"x": cx, "y": cy}).status_code == 201
    own_roll = make_roll(intruder)
    rid, eid, sid, fid = roll["id"], entries[0]["id"], scan["id"], frame["id"]
    entry_body = {"counter": 50, "aperture": "8", "shutter": "1/125", "metered_ev": 10}
    put_body = {"version": 1, "offset": 0, "slip_after": None, "overrides": []}
    calls = [
        ("GET", "/api/rolls/{id}", rid, None), ("PATCH", "/api/rolls/{id}", rid, {"name": "Taken"}),
        ("GET", "/api/rolls/{id}/entries", rid, None), ("POST", "/api/rolls/{id}/entries", rid, entry_body),
        ("PATCH", "/api/entries/{id}", eid, {"note": "Taken"}), ("DELETE", "/api/entries/{id}", eid, None),
        ("GET", "/api/rolls/{id}/scans", rid, None), ("GET", "/api/scans/{id}", sid, None),
        ("GET", "/api/scans/{id}/original", sid, None), ("GET", "/api/scans/{id}/preview/0", sid, None),
        ("POST", "/api/scans/{id}/calibration", sid, {"method": "clear_light", "area": CLEAR_AREA}),
        ("POST", "/api/scans/{id}/frames/detect", sid, {}),
        ("GET", "/api/scans/{id}/reading?x=%d&y=%d" % (cx, cy), sid, None),
        ("POST", "/api/scans/{id}/readings", sid, {"x": cx, "y": cy}),
        ("GET", "/api/frames/{id}", fid, None), ("PATCH", "/api/frames/{id}", fid, {"title": "Taken"}),
        ("POST", "/api/frames/{id}/accept-width", fid, {}),
        ("GET", "/api/rolls/{id}/contact-sheet", rid, None),
        ("POST", "/api/rolls/{id}/alignment/proposal", rid, {}), ("GET", "/api/rolls/{id}/alignment", rid, None),
        ("PUT", "/api/rolls/{id}/alignment", rid, put_body), ("GET", "/api/rolls/{id}/curve", rid, None),
    ]
    for method, template, target, body in calls:
        foreign = intruder.http.request(method, template.replace("{id}", target), json=body)
        unknown = intruder.http.request(method, template.replace("{id}", str(uuid.uuid4())), json=body)
        assert foreign.status_code == 404 and foreign.json() == NOT_FOUND, (method, template, foreign.text)
        assert (unknown.status_code, unknown.json()) == (404, foreign.json()), (method, template)
    r = upload(intruder.http, rid, build_strip([Frame(60)]).data)
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    r = intruder.http.post("/api/rolls", json={"name": "Linked", "stock": "Kestrel 400", "format": "35mm",
                                               "ei": 400, "push_pull": 0, "curve_roll_id": test_roll["id"]})
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    r = intruder.http.patch(f"/api/rolls/{own_roll['id']}", json={"curve_roll_id": test_roll["id"]})
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    for override in ({"entry_id": eid, "frame_id": None}, {"entry_id": str(uuid.uuid4()), "frame_id": fid}):
        r = intruder.http.put(f"/api/rolls/{own_roll['id']}/alignment",
                              json={"version": 0, "offset": 0, "slip_after": None, "overrides": [override]})
        assert (r.status_code, r.json()) == (404, NOT_FOUND), "ids inside the body must answer not-found first"
    assert owner.http.get(f"/api/rolls/{rid}").json()["name"] == roll["name"]
    kept = {e["id"]: e for e in entries_of(owner.http, rid)}
    assert eid in kept and kept[eid]["note"] == entries[0]["note"]
    assert owner.http.get(f"/api/frames/{fid}").json()["frame"]["title"] in ("", None)
    assert owner.http.get(f"/api/scans/{sid}/original").content == plan.data


def test_wf_access_isolation_foreign_record(browser: Browser, app_url: str) -> None:
    owner, intruder = Account(app_url, "owner"), Account(app_url, "intruder")
    roll, _, _, scan = slip_roll(owner)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, intruder.email, intruder.password)
        for url in (f"{app_url}/rolls/{roll['id']}", workspace(app_url, roll["id"], scan["id"]),
                    f"{app_url}/rolls/{uuid.uuid4()}"):
            page.goto(url)
            expect(page.get_by_text("Not in your archive.", exact=True)).to_be_visible()
            expect(page.get_by_role("link", name="Archive", exact=True).first).to_be_visible()
            expect(page.get_by_text(roll["name"])).to_have_count(0)
            expect(page.get_by_text(f"{SLIP_NOTE}-{1}")).to_have_count(0)


def test_api_concurrent_accounts(app_url: str) -> None:
    accounts = [Account(app_url, "left"), Account(app_url, "right")]
    rolls = []
    for i, acct in enumerate(accounts):
        roll = make_roll(acct, name=f"Isolated {i} {uuid.uuid4().hex[:6]}")
        add_entry(acct, roll["id"], 1, "1/125", note=f"note of {acct.email}")
        rolls.append(roll)

    def call(i: int) -> tuple[int, str, httpx.Response]:
        who = i % 2
        path = ["/api/me", "/api/rolls", f"/api/rolls/{rolls[who]['id']}/entries"][(i // 2) % 3]
        return who, path, accounts[who].http.get(path)

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(call, range(90)))
    for who, path, r in results:
        assert r.status_code == 200, (path, r.text)
        body = r.json()
        if path == "/api/me":
            assert body["email"] == accounts[who].email
        elif path == "/api/rolls":
            assert [x["id"] for x in body["rolls"]] == [rolls[who]["id"]]
        else:
            assert [e["note"] for e in body["entries"]] == [f"note of {accounts[who].email}"]


def test_wf_access_isolation_switch_account(browser: Browser, app_url: str) -> None:
    first, second = Account(app_url, "first"), Account(app_url, "second")
    roll_a = make_roll(first, name=f"First roll {uuid.uuid4().hex[:6]}")
    note_a, note_b = uuid.uuid4().hex, uuid.uuid4().hex
    add_entry(first, roll_a["id"], 1, "1/125", note=note_a)
    roll_b = make_roll(second, name=f"Second roll {uuid.uuid4().hex[:6]}")
    add_entry(second, roll_b["id"], 1, "1/60", note=note_b)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, first.email, first.password)
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Log", exact=True).click()
        expect(page.get_by_role("list", name="Recent exposures")).to_contain_text(note_a)
        page.get_by_role("button", name="Sign out", exact=True).click()
        expect(page).to_have_url(re.compile(r"/$"))
        page.get_by_role("link", name="Open archive", exact=True).click()
        expect(page).to_have_url(re.compile(r"/signin"))
        page.get_by_label("Email", exact=True).fill(second.email)
        page.get_by_label("Password", exact=True).fill(second.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page).not_to_have_url(re.compile(r"/signin"))
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Log", exact=True).click()
        picker = page.get_by_role("combobox", name="Roll", exact=True)
        expect(picker).to_contain_text(roll_b["name"])
        expect(picker).not_to_contain_text(roll_a["name"])
        recent = page.get_by_role("list", name="Recent exposures")
        expect(recent).to_contain_text(note_b)
        expect(recent).not_to_contain_text(note_a)
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Archive", exact=True).click()
        rolls = page.get_by_role("list", name="Rolls")
        expect(rolls.get_by_role("link", name=roll_b["name"], exact=True)).to_be_visible()
        expect(rolls.get_by_role("link", name=roll_a["name"], exact=True)).to_have_count(0)
    assert second.http.get("/api/me").json()["email"] == second.email


def test_api_rolls(app_url: str) -> None:
    acct = Account(app_url)
    r = acct.http.post("/api/rolls", json={"name": "Defaults", "stock": "Marram 100", "format": "120-6x6",
                                           "ei": 100, "push_pull": 0})
    assert r.status_code == 201, r.text
    roll = r.json()
    assert (float(roll["reciprocity_p"]), roll["development_note"], roll["kind"], roll["curve_roll_id"]) == \
        (1.0, "", "normal", None)
    assert roll["state"] == "logging" and roll["strongest_frame_id"] is None
    assert roll["counters"] == {"detected": 0, "aligned": 0, "unexposed": 0, "unmatched_notes": 0}
    r = acct.http.post("/api/rolls", json={"name": "", "stock": "s" * (STOCK_LIMIT + 1), "format": "70mm",
                                           "ei": 5, "push_pull": 4, "reciprocity_p": 0.855, "kind": "slide",
                                           "development_note": "d" * 501})
    assert r.status_code == 422 and r.json()["error"] == "validation_failed"
    assert r.json()["fields"] == {
        "name": "Give the roll a name of up to 80 characters.", "stock": "Name the stock in up to 60 characters.",
        "format": "Choose 35mm, 120 6×6 or 120 6×7.", "ei": "EI is a whole number from 6 to 12800.",
        "push_pull": "Push or pull is a whole number of stops from −3 to +3.",
        "reciprocity_p": "Reciprocity exponent is a number from 0.50 to 1.00 with up to two decimals.",
        "kind": "Choose normal roll or test roll.",
        "development_note": "Development notes are limited to 500 characters."}
    for field, bad in (("ei", 12801), ("push_pull", -4), ("reciprocity_p", 0.49), ("reciprocity_p", 1.01),
                       ("name", "n" * (NAME_LIMIT + 1))):
        r = acct.http.post("/api/rolls", json={"name": "B", "stock": "S", "format": "35mm", "ei": 400,
                                               "push_pull": 0, field: bad})
        assert r.status_code == 422 and field in r.json()["fields"], (field, bad)
    edge = make_roll(acct, name="n" * NAME_LIMIT, stock="s" * STOCK_LIMIT, ei=6, push_pull=-3,
                     reciprocity_p=0.5, development_note="📷" + "d" * 499)
    assert edge["ei"] == 6 and edge["name"] == "n" * NAME_LIMIT
    assert make_roll(acct, ei=12800, push_pull=3)["push_pull"] == 3
    test_roll = make_roll(acct, kind="test", format="120-6x7")
    assert test_roll["kind"] == "test" and test_roll["format"] == "120-6x7"
    r = acct.http.post("/api/rolls", json={"name": "T", "stock": "S", "format": "35mm", "ei": 400, "push_pull": 0,
                                           "kind": "test", "curve_roll_id": test_roll["id"]})
    assert r.status_code == 422 and r.json()["fields"]["curve_roll_id"] == "Choose one of your test rolls."
    r = acct.http.patch(f"/api/rolls/{roll['id']}", json={"curve_roll_id": edge["id"]})
    assert r.status_code == 422 and r.json()["fields"]["curve_roll_id"] == "Choose one of your test rolls."
    r = acct.http.patch(f"/api/rolls/{roll['id']}", json={"curve_roll_id": test_roll["id"], "ei": 800,
                                                          "format": "120-6x6"})
    assert r.status_code == 200 and r.json()["curve_roll_id"] == test_roll["id"] and r.json()["ei"] == 800
    change = "Format and kind cannot change after the roll is created."
    r = acct.http.patch(f"/api/rolls/{roll['id']}", json={"format": "35mm"})
    assert r.status_code == 422 and r.json()["fields"]["format"] == change
    r = acct.http.patch(f"/api/rolls/{roll['id']}", json={"kind": "test"})
    assert r.status_code == 422 and r.json()["fields"]["kind"] == change
    assert acct.http.get(f"/api/rolls/{roll['id']}").json()["format"] == "120-6x6"
    ids = [x["id"] for x in acct.http.get("/api/rolls").json()["rolls"]]
    assert ids == [test_roll["id"], ids[1], edge["id"], roll["id"]] and len(ids) == 4, "newest first"


def test_api_entries(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    rid = roll["id"]
    r = acct.http.post(f"/api/rolls/{rid}/entries", json={"counter": 5, "aperture": "f/5.6", "shutter": "1/125",
                                                          "metered_ev": 12})
    assert r.status_code == 201 and r.json()["aperture"] == "5.6"
    assert (r.json()["note"], r.json()["misfire"], r.json()["match"], r.json()["frame_id"]) == ("", False, "none", None)
    r = acct.http.post(f"/api/rolls/{rid}/entries", json={"counter": 5, "aperture": "8", "shutter": "1/60",
                                                          "metered_ev": 10})
    assert (r.status_code, r.json()) == (409, {"error": "counter_taken"})
    bad = acct.http.post(f"/api/rolls/{rid}/entries", json={"counter": 100, "aperture": "5.7", "shutter": "1/1",
                                                            "metered_ev": 21.5})
    assert bad.status_code == 422 and bad.json()["fields"] == {
        "counter": "Counter is a whole number from 0 to 99.", "aperture": "Use a marked aperture such as 5.6 or 11.",
        "shutter": "Use a shutter speed such as 1/125, 1/2 or 2\".",
        "metered_ev": "Metered EV is a number from −6 to 21."}
    for shutter in ("1/8001", '3601"', '0"', "abc", "1/2.5", "2s"):
        r = acct.http.post(f"/api/rolls/{rid}/entries", json={"counter": 7, "aperture": "8", "shutter": shutter,
                                                              "metered_ev": 10})
        assert r.status_code == 422 and "shutter" in r.json()["fields"], shutter
    for aperture in ("f/5.7", "60", "f8.0"):
        r = acct.http.post(f"/api/rolls/{rid}/entries", json={"counter": 7, "aperture": aperture,
                                                              "shutter": "1/125", "metered_ev": 10})
        assert r.status_code == 422 and "aperture" in r.json()["fields"], aperture
    r = acct.http.post(f"/api/rolls/{rid}/entries", json={"counter": -1, "aperture": "8", "shutter": "1/125",
                                                          "metered_ev": -6.5})
    assert set(r.json()["fields"]) == {"counter", "metered_ev"}
    made = [add_entry(acct, rid, 99, "1/8000", aperture="64", ev=21),
            add_entry(acct, rid, 0, '3600"', aperture="1", ev=-6),
            add_entry(acct, rid, 2, "1/2", aperture="f/11", ev=7.3, misfire=True),
            add_entry(acct, rid, 9, '1"', ev=3)]
    assert made[2]["misfire"] is True and made[2]["aperture"] == "11" and float(made[2]["metered_ev"]) == 7.3
    assert [e["counter"] for e in entries_of(acct.http, rid)] == [0, 2, 5, 9, 99]
    r = acct.http.patch(f"/api/entries/{made[3]['id']}", json={"counter": 5})
    assert (r.status_code, r.json()) == (409, {"error": "counter_taken"})
    r = acct.http.patch(f"/api/entries/{made[3]['id']}", json={"counter": 10, "note": "Moved"})
    assert r.status_code == 200 and (r.json()["counter"], r.json()["note"]) == (10, "Moved")
    assert acct.http.delete(f"/api/entries/{made[1]['id']}").status_code == 204
    assert [e["counter"] for e in entries_of(acct.http, rid)] == [2, 5, 10, 99]
    assert acct.http.patch(f"/api/entries/{made[1]['id']}", json={"note": "x"}).status_code == 404


def test_api_exposure_maths(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct, ei=400, reciprocity_p=0.85)
    cases = [("8", '4"', 3), ("8", '1"', 5), ("5.6", "1/60", 10.5), ("1.1", '2"', -6), ("64", "1/8000", 21),
             ("2.2", '30"', 0.25), ("16", "1/250", 14)]
    for counter, (aperture, shutter, ev) in enumerate(cases, start=1):
        add_entry(acct, roll["id"], counter, shutter, aperture=aperture, ev=ev)
    first = entries_of(acct.http, roll["id"])[0]
    assert (first["relative_stops"], first["relative_log_h"]) == (0.70, 0.21), "brief example: f/8, 4\", EV 3"

    def verify(ei: int, p: float) -> None:
        for e in entries_of(acct.http, roll["id"]):
            stops = exposure_stops(float(e["metered_ev"]), ei, e["aperture"], e["shutter"], p)
            assert e["relative_stops"] == half_away(stops, 2), (e, ei, p)
            assert e["relative_log_h"] == half_away(stops * LOG_H_PER_STOP, 2), e

    verify(400, 0.85)
    assert acct.http.patch(f"/api/rolls/{roll['id']}", json={"ei": 1600}).status_code == 200
    verify(1600, 0.85)
    assert acct.http.patch(f"/api/rolls/{roll['id']}", json={"reciprocity_p": 0.62}).status_code == 200
    verify(1600, 0.62)
    one_second = entries_of(acct.http, roll["id"])[1]
    assert one_second["relative_stops"] == half_away(exposure_stops(5, 1600, "8", '1"', 1.0), 2)
    seed = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    assert seed.post("/api/auth/signin", json={"email": "ines@edgeprint.test",
                                               "password": "safelight-ines-42"}).status_code == 200
    seeded = {r["name"]: r for r in seed.get("/api/rolls").json()["rolls"]}
    harbour = {e["counter"]: e for e in entries_of(seed, seeded["Harbour walk"]["id"])}
    bracket = {e["counter"]: e for e in entries_of(seed, seeded["Kestrel bracket"]["id"])}
    assert (harbour[8]["relative_stops"], harbour[8]["relative_log_h"]) == (0.70, 0.21)
    assert bracket[4]["relative_stops"] == -0.97


def test_wf_shooting_log_note_limit(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct, name=f"Limits {uuid.uuid4().hex[:6]}")
    ok_note, long_note = "📷" + "n" * (NOTE_LIMIT - 1), "📷" + "n" * NOTE_LIMIT
    r = acct.http.post(f"/api/rolls/{roll['id']}/entries", json={"counter": 1, "aperture": "8", "shutter": "1/125",
                                                                 "metered_ev": 10, "note": long_note})
    assert r.status_code == 422 and r.json()["fields"] == {"note": "Notes are limited to 500 characters."}
    trimmed = add_entry(acct, roll["id"], 1, "1/125", note="  " + ok_note + "\n ")
    assert len(trimmed["note"]) <= NOTE_LIMIT
    lines = add_entry(acct, roll["id"], 2, "1/125", note="a\n" * 250)
    assert lines["counter"] == 2
    r = acct.http.patch(f"/api/rolls/{roll['id']}", json={"development_note": "📷" + "d" * NOTE_LIMIT})
    assert r.status_code == 422
    assert r.json()["fields"] == {"development_note": "Development notes are limited to 500 characters."}
    _, _, _, scan = slip_roll(acct)
    fid = scan["frames"][0]["id"]
    r = acct.http.patch(f"/api/frames/{fid}", json={"title": "📷" + "t" * TITLE_LIMIT})
    assert r.status_code == 422 and r.json()["fields"] == {"title": "Titles are limited to 80 characters."}
    assert acct.http.patch(f"/api/frames/{fid}", json={"title": "📷" + "t" * (TITLE_LIMIT - 1)}).status_code == 200
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path="/log")
        select(page.get_by_role("combobox", name="Roll", exact=True), roll["name"])
        page.get_by_role("spinbutton", name="Counter", exact=True).fill("3")
        page.get_by_role("textbox", name="Shutter", exact=True).fill("1/125")
        page.get_by_role("spinbutton", name="Metered EV", exact=True).fill("10")
        note = page.get_by_role("textbox", name="Note", exact=True)
        note.fill(long_note)
        expect(page.get_by_text(f"{len(long_note)} / {NOTE_LIMIT}", exact=True)).to_be_visible()
        posts: list[str] = []
        page.on("request", lambda req: posts.append(req.url) if req.method == "POST" and "/entries" in req.url else None)
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(page.get_by_text("Notes are limited to 500 characters.", exact=True).first).to_be_visible()
        expect(note).to_have_attribute("aria-invalid", "true")
        expect(note).to_be_focused()
        expect(activity(page)).to_have_text("Notes are limited to 500 characters.")
        assert posts == [], "the form must refuse a 501-character note without sending it"
        note.fill(ok_note)
        expect(page.get_by_text(f"{len(ok_note)} / {NOTE_LIMIT}", exact=True)).to_be_visible()
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(activity(page)).to_have_text("Note 3 logged.")
    saved = {e["counter"]: e for e in entries_of(acct.http, roll["id"])}
    assert saved[3]["note"] == ok_note


def test_exposure_preview_live(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    plain = make_roll(acct, name=f"Plain {uuid.uuid4().hex[:6]}", ei=100, reciprocity_p=1.0)
    night = make_roll(acct, name=f"Night {uuid.uuid4().hex[:6]}", ei=400, reciprocity_p=0.85)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path="/log")
        preview = page.get_by_role("status", name="Exposure preview", exact=True)
        api_calls: list[str] = []
        page.on("request", lambda req: api_calls.append(req.url) if "/api/" in req.url and req.method != "GET" else None)
        select(page.get_by_role("combobox", name="Aperture", exact=True), "f/8")
        shutter = page.get_by_role("textbox", name="Shutter", exact=True)
        ev = page.get_by_role("spinbutton", name="Metered EV", exact=True)
        shutter.fill('4"')
        ev.fill("3")
        expect(preview).to_have_text("+0.70 stops · log H +0.21")
        shutter.fill("4s")
        expect(preview).to_have_text("—")
        shutter.fill('4"')
        expect(preview).to_have_text("+0.70 stops · log H +0.21")
        select(page.get_by_role("combobox", name="Roll", exact=True), plain["name"])
        stops = exposure_stops(3, 100, "8", '4"', 1.0)
        expect(preview).to_have_text(f"{signed(stops)} stops · log H {signed(stops * LOG_H_PER_STOP)}")
        select(page.get_by_role("combobox", name="Aperture", exact=True), "f/5.6")
        stops = exposure_stops(3, 100, "5.6", '4"', 1.0)
        expect(preview).to_have_text(f"{signed(stops)} stops · log H {signed(stops * LOG_H_PER_STOP)}")
        ev.fill("")
        expect(preview).to_have_text("—")
        ev.fill("22")
        expect(preview).to_have_text("—")
        select(page.get_by_role("combobox", name="Roll", exact=True), night["name"])
        ev.fill("2.5")
        stops = exposure_stops(2.5, 400, "5.6", '4"', 0.85)
        expected = f"{signed(stops)} stops · log H {signed(stops * LOG_H_PER_STOP)}"
        expect(preview).to_have_text(expected)
        assert api_calls == [], f"the preview must not send any write request, saw {api_calls}"
        page.get_by_role("spinbutton", name="Counter", exact=True).fill("4")
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(activity(page)).to_have_text("Note 4 logged.")
        saved = {e["counter"]: e for e in entries_of(acct.http, night["id"])}[4]
        assert expected == f"{signed(saved['relative_stops'])} stops · log H {signed(saved['relative_log_h'])}"
        item = page.get_by_role("list", name="Recent exposures").get_by_role("listitem").filter(has_text="Note 4")
        item.get_by_role("button", name=f"Edit note {4}", exact=True).click()
        inline = page.get_by_role("status", name=f"Exposure preview for note {4}", exact=True)
        expect(inline).to_have_text(expected)
        item.get_by_label("Shutter", exact=True).fill("1/125")
        stops = exposure_stops(2.5, 400, "5.6", "1/125", 0.85)
        expect(inline).to_have_text(f"{signed(stops)} stops · log H {signed(stops * LOG_H_PER_STOP)}")
        page.get_by_role("button", name="Cancel edit", exact=True).click()
    assert {e["counter"]: e for e in entries_of(acct.http, night["id"])}[4]["shutter"] == '4"'


def test_wf_shooting_log_happy(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    name = f"Night quay {uuid.uuid4().hex[:6]}"
    with app_page(browser, app_url + "/") as page:
        page.get_by_role("link", name="Open archive", exact=True).click()
        expect(page).to_have_url(re.compile(r"/signin"))
        page.get_by_label("Email", exact=True).fill(acct.email)
        page.get_by_label("Password", exact=True).fill(acct.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page).to_have_url(re.compile(r"/archive$"))
        nav = page.get_by_role("navigation", name="Main")
        nav.get_by_role("link", name="Log", exact=True).click()
        page.get_by_role("link", name="New roll", exact=True).click()
        expect(page).to_have_url(re.compile(r"/rolls/new$"))
        page.get_by_role("textbox", name="Roll name", exact=True).fill(name)
        page.get_by_role("textbox", name="Stock", exact=True).fill("Kestrel 400")
        select(page.get_by_role("combobox", name="Format", exact=True), "35mm")
        page.get_by_role("spinbutton", name="EI", exact=True).fill("400")
        page.get_by_role("spinbutton", name="Push or pull", exact=True).fill("0")
        page.get_by_role("spinbutton", name="Reciprocity exponent", exact=True).fill("0.85")
        page.get_by_role("radio", name="Normal roll", exact=True).check()
        page.get_by_role("button", name="Create roll", exact=True).click()
        expect(page).to_have_url(re.compile(r"/rolls/[0-9a-f-]{36}$"))
        roll_id = page.url.rstrip("/").split("/")[-1]
        nav.get_by_role("link", name="Log", exact=True).click()
        expect(page.get_by_role("combobox", name="Roll", exact=True)).to_contain_text(name)
        counter = page.get_by_role("spinbutton", name="Counter", exact=True)
        shutter = page.get_by_role("textbox", name="Shutter", exact=True)
        note = page.get_by_role("textbox", name="Note", exact=True)
        expect(counter).to_have_value("1")
        shutter.fill("1/125")
        page.get_by_role("spinbutton", name="Metered EV", exact=True).fill("10")
        note.fill("Breakwater")
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(activity(page)).to_have_text("Note 1 logged.")
        expect(counter).to_have_value("2")
        expect(note).to_have_value("")
        expect(shutter).to_have_value("1/125")
        expect(shutter).to_be_focused()
        note.fill("Lens cap left on")
        page.get_by_role("checkbox", name="Misfire", exact=True).check()
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(activity(page)).to_have_text("Note 2 logged.")
        expect(page.get_by_role("checkbox", name="Misfire", exact=True)).not_to_be_checked()
        shutter.fill('4"')
        page.get_by_role("spinbutton", name="Metered EV", exact=True).fill("3")
        expect(page.get_by_role("status", name="Exposure preview", exact=True)).to_have_text(
            "+0.70 stops · log H +0.21")
        note.fill("Night quay")
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(activity(page)).to_have_text("Note 3 logged.")
        page.goto(f"{app_url}/rolls/{roll_id}")
        page.get_by_role("link", name="Edit roll", exact=True).click()
        expect(page).to_have_url(re.compile(rf"/rolls/{roll_id}/edit$"))
        page.get_by_role("spinbutton", name="EI", exact=True).fill("800")
        page.get_by_role("button", name="Save roll", exact=True).click()
        expect(page).to_have_url(re.compile(rf"/rolls/{roll_id}$"))
        log_items = page.get_by_role("list", name="Shooting log").get_by_role("listitem")
        expect(log_items).to_have_count(3)
        expected = {1: ("1/125", 10), 2: ("1/125", 10), 3: ('4"', 3)}
        for c, (sh, e) in expected.items():
            item = log_items.nth(c - 1)
            expect(item).to_contain_text(f"Note {c}")
            expect(item).to_contain_text(f"{signed(exposure_stops(e, 800, '8', sh, 0.85))} stops")
        expect(log_items.nth(1)).to_contain_text("Misfire")
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Archive", exact=True).click()
        card = page.get_by_role("list", name="Rolls").get_by_role("listitem").filter(
            has=page.get_by_role("link", name=name, exact=True))
        expect(card).to_contain_text("Logging")
        expect(card).to_contain_text("Unmatched notes 3")
    roll = acct.http.get(f"/api/rolls/{roll_id}").json()
    assert (roll["ei"], float(roll["reciprocity_p"]), roll["state"]) == (800, 0.85, "logging")
    saved = entries_of(acct.http, roll_id)
    assert [e["counter"] for e in saved] == [1, 2, 3] and saved[1]["misfire"] is True
    assert saved[2]["relative_stops"] == half_away(exposure_stops(3, 800, "8", '4"', 0.85), 2)


def test_wf_shooting_log_expired_session(browser: Browser) -> None:
    base = short_session_url()
    owner, stranger = Account(base, "owner"), Account(base, "stranger")
    roll = make_roll(owner, name=f"Field {uuid.uuid4().hex[:6]}")
    draft_note = "📷" + "n" * (NOTE_LIMIT - 1)
    kept_note, other_note = uuid.uuid4().hex, uuid.uuid4().hex

    def wait_expired(page: Page) -> None:
        poll(lambda: page.request.get(base + "/api/me").status == 401, TTL_DEADLINE_S,
             "the browser session never expired after SESSION_TTL_SECONDS")

    with app_page(browser, base + "/signin") as page:
        ui_signin(page, base, owner.email, owner.password, next_path="/log")
        page.get_by_role("spinbutton", name="Counter", exact=True).fill("7")
        select(page.get_by_role("combobox", name="Aperture", exact=True), "f/5.6")
        page.get_by_role("textbox", name="Shutter", exact=True).fill("1/30")
        page.get_by_role("spinbutton", name="Metered EV", exact=True).fill("10.5")
        page.get_by_role("textbox", name="Note", exact=True).fill(draft_note)
        page.get_by_role("checkbox", name="Misfire", exact=True).check()
        wait_expired(page)
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(page).to_have_url(re.compile(r"/signin\?next=%2Flog$"))
        page.get_by_label("Email", exact=True).fill(owner.email)
        page.get_by_label("Password", exact=True).fill(owner.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page).to_have_url(re.compile(r"/log$"))
        expect(activity(page)).to_have_text("Your unsent exposure is back. Press Log exposure to send it.")
        expect(page.get_by_role("button", name="Log exposure", exact=True)).to_be_focused()
        expect(page.get_by_role("textbox", name="Note", exact=True)).to_have_value(draft_note)
        expect(page.get_by_role("spinbutton", name="Counter", exact=True)).to_have_value("7")
        expect(page.get_by_role("textbox", name="Shutter", exact=True)).to_have_value("1/30")
        expect(page.get_by_role("spinbutton", name="Metered EV", exact=True)).to_have_value("10.5")
        expect(page.get_by_role("checkbox", name="Misfire", exact=True)).to_be_checked()
        assert entries_of(owner.on(base), roll["id"]) == [], "nothing may be sent before Log exposure is pressed"
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(activity(page)).to_have_text("Note 7 logged.")
        saved = entries_of(owner.on(base), roll["id"])
        assert len(saved) == 1
        assert (saved[0]["counter"], saved[0]["aperture"], saved[0]["shutter"], float(saved[0]["metered_ev"]),
                saved[0]["note"], saved[0]["misfire"]) == (7, "5.6", "1/30", 10.5, draft_note, True)
        item = page.get_by_role("list", name="Recent exposures").get_by_role("listitem").filter(has_text="Note 7")
        item.get_by_role("button", name=edit_note_name(7), exact=True).click()
        item.get_by_label("Note", exact=True).fill(kept_note)
        wait_expired(page)
        page.get_by_role("button", name=save_note_name(7), exact=True).click()
        expect(page).to_have_url(re.compile(r"/signin\?next=%2Flog$"))
        page.get_by_label("Email", exact=True).fill(owner.email)
        page.get_by_label("Password", exact=True).fill(owner.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(activity(page)).to_have_text("Your unsent note is back. Press Save note 7 to send it.")
        expect(page.get_by_role("button", name=save_note_name(7), exact=True)).to_be_focused()
        assert entries_of(owner.on(base), roll["id"])[0]["note"] == draft_note
        page.get_by_role("button", name=save_note_name(7), exact=True).click()
        expect(activity(page)).to_have_text("Note 7 saved.")
        assert entries_of(owner.on(base), roll["id"])[0]["note"] == kept_note
        page.get_by_role("textbox", name="Note", exact=True).fill(other_note)
        wait_expired(page)
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(page).to_have_url(re.compile(r"/signin\?next=%2Flog$"))
        page.get_by_label("Email", exact=True).fill(stranger.email)
        page.get_by_label("Password", exact=True).fill(stranger.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page).to_have_url(re.compile(r"/log$"))
        expect(page.get_by_role("textbox", name="Note", exact=True)).to_have_value("")
        expect(activity(page)).not_to_have_text("Your unsent exposure is back. Press Log exposure to send it.")
    assert len(entries_of(owner.on(base), roll["id"])) == 1


def test_api_upload_confirmed_in_storage(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    plan = build_strip([Frame(60), Frame(90)])
    bad = upload(acct.http, roll["id"], plan.data, size=len(plan.data) + 1, sha="0" * 64)
    assert bad.status_code == 422 and bad.json()["fields"] == {
        "size": "Declared size does not match the received file.",
        "sha256": "Checksum does not match the received file."}
    r = upload(acct.http, roll["id"], plan.data, dpi=299, first_edge=100)
    assert r.json()["fields"] == {"dpi": "DPI is a whole number from 300 to 10000.",
                                  "first_edge": "Edge number is a whole number from 0 to 99."}
    assert objects_for(acct.id) == [] and acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"] == []
    digest = hashlib.sha256(plan.data).hexdigest()
    r = upload(acct.http, roll["id"], plan.data, dpi=10000, first_edge=0, filename="harbour.png")
    assert r.status_code == 201, r.text
    scan = r.json()
    assert (scan["state"], scan["size"], scan["sha256"], scan["format"], scan["position"]) == \
        ("stored", len(plan.data), digest, "png", 1)
    assert (scan["width"], scan["height"], scan["dpi"], scan["first_edge"], scan["filename"]) == \
        (plan.width, plan.height, 10000, 0, "harbour.png")
    stored = S3().get(f"originals/{acct.id}/{scan['id']}")
    assert len(stored) == len(plan.data) and hashlib.sha256(stored).hexdigest() == digest
    assert [s["id"] for s in acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"]] == [scan["id"]]
    assert acct.http.get(f"/api/rolls/{roll['id']}").json()["state"] == "developed"


def test_api_original_bytes_and_previews(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    width = PREVIEW_SLICE_W + 52

    def sample(x: int, y: int) -> int:
        return (x * 31 + y * 977) % CODE_16

    data = png_bytes(width, STRIP_H, sample, depth=16)
    clean = "strip"
    r = upload(acct.http, roll["id"], data, filename="../../etc/" + clean + "\x01")
    assert r.status_code == 201, r.text
    scan = r.json()
    assert scan["filename"] == clean and scan["preview_slices"] == 2
    original = acct.http.get(f"/api/scans/{scan['id']}/original")
    assert original.status_code == 200 and original.content == data
    assert original.headers["content-type"].startswith("image/png")
    assert original.headers["content-disposition"] == f'attachment; filename="{clean}"'
    assert original.headers["x-scan-sha256"] == hashlib.sha256(data).hexdigest()
    assert original.headers["x-content-type-options"] == "nosniff"
    keys = S3().keys(f"previews/{acct.id}/{scan['id']}/")
    assert sorted(keys) == [f"previews/{acct.id}/{scan['id']}/0.png", f"previews/{acct.id}/{scan['id']}/1.png"]
    assert S3().keys(f"originals/{acct.id}/") == [f"originals/{acct.id}/{scan['id']}"]
    for n, slice_width in ((0, PREVIEW_SLICE_W), (1, width - PREVIEW_SLICE_W)):
        served = acct.http.get(f"/api/scans/{scan['id']}/preview/{n}")
        assert served.status_code == 200 and served.headers["content-type"].startswith("image/png")
        stored = S3().get(f"previews/{acct.id}/{scan['id']}/{n}.png")
        assert served.content == stored
        assert stored[24:26] == bytes([8, 0]), "previews are 8-bit greyscale PNGs"
        img = png_pixels(stored)
        assert (img[0], img[1]) == (slice_width, STRIP_H)
        for x, y in ((0, 0), (17, 40), (slice_width - 1, STRIP_H - 1)):
            assert rgb_at(img, x, y)[0] == round(sample(x + n * PREVIEW_SLICE_W, y) * CODE_8 / CODE_16)
    assert acct.http.get(f"/api/scans/{scan['id']}/preview/2").status_code == 404
    tiff = tiff_bytes(MIN_SIDE, MIN_SIDE, lambda x, y: x * 4)
    r = upload(acct.http, roll["id"], tiff, filename="neg.tif")
    assert r.status_code == 201 and r.json()["format"] == "tiff"
    got = acct.http.get(f"/api/scans/{r.json()['id']}/original")
    assert got.content == tiff and got.headers["content-type"].startswith("image/tiff")


def test_api_duplicate_scans(app_url: str) -> None:
    acct = Account(app_url)
    first, second, third = make_roll(acct), make_roll(acct), make_roll(acct)
    data = build_strip([Frame(60)]).data
    original = upload(acct.http, first["id"], data)
    assert original.status_code == 201
    again = upload(acct.http, first["id"], data, filename="renamed.tif", content_type="image/tiff")
    assert (again.status_code, again.json()) == (409, {"error": "duplicate_scan", "scan_id": original.json()["id"]})
    assert len(acct.http.get(f"/api/rolls/{first['id']}/scans").json()["scans"]) == 1
    assert upload(acct.http, second["id"], data).status_code == 201, "duplicates are judged per roll"
    racing = build_strip([Frame(70), Frame(90)]).data
    gate = threading.Barrier(8)

    def race(_: int) -> httpx.Response:
        client = acct.on(app_url)
        gate.wait()
        return upload(client, third["id"], racing)

    with ThreadPoolExecutor(max_workers=8) as pool:
        answers = list(pool.map(race, range(8)))
    winners = [r for r in answers if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in answers]
    for r in answers:
        if r is not winners[0]:
            assert (r.status_code, r.json()) == (409, {"error": "duplicate_scan", "scan_id": winners[0].json()["id"]})
    assert len(acct.http.get(f"/api/rolls/{third['id']}/scans").json()["scans"]) == 1
    assert len(S3().keys(f"originals/{acct.id}/")) == 3


def test_api_refused_uploads_leave_nothing(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    data = build_strip([Frame(60)]).data
    assert upload(acct.http, roll["id"], data, dpi=12).status_code == 422
    assert upload(acct.http, roll["id"], b"plain text, not a scan" * 10).status_code == 415
    assert upload(acct.http, roll["id"], png_bytes(MIN_SIDE, MIN_SIDE, idat=b"broken")).status_code == 422
    down = acct.on(minio_down_url())
    r = upload(down, roll["id"], data)
    assert (r.status_code, r.json()) == (503, {"error": "storage_unavailable"})
    assert acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"] == []
    assert acct.http.get(f"/api/rolls/{roll['id']}").json()["state"] == "logging"
    assert objects_for(acct.id) == []
    assert upload(acct.http, roll["id"], data).status_code == 201, "a refused attempt must not block the real upload"


def test_api_cut_off_upload_released(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    u = urlparse(app_url)
    observer = Postgres()
    bodies = [private_padding(1_000_000 + i, build_strip([Frame(60 + i)]).data) for i in range(CUTOFF_ROUNDS)]
    busy = ("SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() "
            "AND usename <> current_user AND state IN ('active', 'idle in transaction', "
            "'idle in transaction (aborted)')")
    with HealthWatch(app_url) as health:
        for data in bodies:
            raw_request(app_url, [
                f"POST /api/rolls/{roll['id']}/scans?dpi=300&first_edge=1&filename=cut.png HTTP/1.1",
                f"Host: {u.netloc}", f"Cookie: edgeprint_session={acct.cookie()}",
                "Content-Type: application/octet-stream", f"Content-Length: {len(data)}",
                f"X-Scan-Size: {len(data)}", f"X-Scan-SHA256: {hashlib.sha256(data).hexdigest()}"],
                data, cut_after=len(data) // 2)
            poll(lambda: objects_for(acct.id) == [] and int(observer.rows(busy)[0]["n"]) == 0,
                 CUTOFF_RELEASE_S + CUTOFF_SLACK_S,
                 "after a cut-off upload an object or an active/idle-in-transaction app session remained")
        r = upload(acct.http, roll["id"], bodies[0])
        assert r.status_code == 201, f"re-upload after cut-off must be stored, got {r.status_code} {r.text}"
    assert health.failures == [] and health.slowest <= HEALTH_S, health.slowest
    assert S3().keys(f"originals/{acct.id}/") == [f"originals/{acct.id}/{r.json()['id']}"]
    assert acct.http.get("/api/health").json() == {"status": "ok"}


def test_upload_progress_and_announcements(browser: Browser, app_url: str, tmp_path: Path) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    plan = build_strip([Frame(60), Frame(90), Frame(120)])
    huge = tmp_path / "huge.png"
    with huge.open("wb") as fh:
        fh.write(PNG_SIG)
        fh.truncate(UPLOAD_LIMIT + 1)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        field = page.get_by_label("Strip scan", exact=True)
        button = page.get_by_role("button", name="Upload strip", exact=True)
        page.get_by_role("spinbutton", name="Scan DPI", exact=True).fill("300")
        page.get_by_role("spinbutton", name="First edge number", exact=True).fill("1")
        watch_activity(page)
        posts: list[str] = []
        page.on("request", lambda req: posts.append(req.url) if is_upload(req) else None)
        held = hold(page, is_upload)
        field.set_input_files({"name": "harbour.png", "mimeType": "image/png", "buffer": plan.data})
        button.click()
        pump(page, lambda: len(held) == 1, "Upload strip sent no upload request")
        bar = page.get_by_role("progressbar", name="Upload progress", exact=True)
        expect(bar).to_be_visible()
        expect(button).to_be_disabled()
        expect(activity(page)).to_have_text(f"Uploading harbour.png{ELLIPSIS}")
        start = bar.evaluate("el => String(el.getAttribute('aria-valuenow') ?? el.value)")
        assert start.isdigit() and 0 <= int(start) <= 100
        bar.evaluate("""el => { const v = () => Number(el.getAttribute('aria-valuenow') ?? el.value);
            window.__progress = [v()];
            new MutationObserver(() => window.__progress.push(v()))
              .observe(el, {attributes: true}); }""")
        held.pop().continue_()
        expect(activity(page)).to_have_text(stored_copy("harbour.png"))
        expect(page.get_by_role("link", name=strip_name(1), exact=True)).to_be_focused()
        expect(bar).to_have_count(0)
        expect(button).to_be_enabled()
        values = page.evaluate("window.__progress")
        assert all(0 <= v <= 100 and v == int(v) for v in values) and values == sorted(values), values
        assert activity_log(page) == [f"Uploading harbour.png{ELLIPSIS}",
                                      stored_copy("harbour.png")]
        strip = page.get_by_role("list", name="Strips").get_by_role("listitem")
        expect(strip).to_have_count(1)
        expect(strip.first).to_contain_text("Stored")
        expect(strip.first).to_contain_text(f"{len(plan.data)} bytes")
        expect(strip.first).to_contain_text(hashlib.sha256(plan.data).hexdigest()[:12])
        page.unroute("**/api/**")
        page.evaluate("window.__activity = []")
        field.set_input_files({"name": "again.png", "mimeType": "image/png", "buffer": plan.data})
        button.click()
        expect(activity(page)).to_have_text("This strip is already on this roll.")
        expect(page.get_by_role("link", name=strip_name(1), exact=True)).to_be_focused()
        expect(strip).to_have_count(1)
        assert activity_log(page) == [f"Uploading again.png{ELLIPSIS}", "This strip is already on this roll."]
        page.evaluate("window.__activity = []")
        field.set_input_files({"name": "notes.png", "mimeType": "image/png", "buffer": b"not an image at all" * 8})
        button.click()
        expect(activity(page)).to_have_text("Only PNG or TIFF scans can be stored.")
        expect(page.get_by_text("Only PNG or TIFF scans can be stored.", exact=True).first).to_be_visible()
        expect(field).to_have_attribute("aria-invalid", "true")
        expect(field).to_be_focused()
        assert activity_log(page) == [f"Uploading notes.png{ELLIPSIS}", "Only PNG or TIFF scans can be stored."]
        sent_before = len(posts)
        page.evaluate("window.__activity = []")
        field.set_input_files(str(huge))
        button.click()
        expect(activity(page)).to_have_text("This scan is larger than 60,000,000 bytes.")
        expect(field).to_have_attribute("aria-invalid", "true")
        expect(field).to_be_focused()
        assert activity_log(page) == ["This scan is larger than 60,000,000 bytes."]
        assert len(posts) == sent_before, "an oversize file must be refused before any request"
    assert len(acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"]) == 1


def test_wf_scan_upload_happy(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct, name=f"Developed {uuid.uuid4().hex[:6]}")
    add_entry(acct, roll["id"], 1, "1/125")
    plan = build_strip([Frame(60), Frame(90)])
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        expect(page.get_by_text("No strips yet.", exact=True).first).to_be_visible()
        page.get_by_label("Strip scan", exact=True).set_input_files(
            {"name": "roll-strip.png", "mimeType": "image/png", "buffer": plan.data})
        page.get_by_role("spinbutton", name="Scan DPI", exact=True).fill("300")
        page.get_by_role("spinbutton", name="First edge number", exact=True).fill("4")
        page.get_by_role("button", name="Upload strip", exact=True).click()
        expect(activity(page)).to_have_text(stored_copy("roll-strip.png"))
        link = page.get_by_role("link", name=strip_name(1), exact=True)
        expect(link).to_be_focused()
        item = page.get_by_role("list", name="Strips").get_by_role("listitem").first
        expect(item).to_contain_text("Stored")
        expect(item).to_contain_text(f"{len(plan.data)} bytes")
        expect(item).to_contain_text(hashlib.sha256(plan.data).hexdigest()[:12])
        expect(page.get_by_text("Developed", exact=True).first).to_be_visible()
        with page.expect_download() as download:
            item.get_by_role("link", name="Download original", exact=True).click()
        assert Path(download.value.path()).read_bytes() == plan.data
        link.click()
        expect(page).to_have_url(re.compile(rf"/rolls/{roll['id']}/scans/[0-9a-f-]{{36}}$"))
        expect(page.get_by_role("region", name="Strip", exact=True)).to_be_visible()
    scans = acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"]
    assert len(scans) == 1 and (scans[0]["dpi"], scans[0]["first_edge"], scans[0]["state"]) == (300, 4, "stored")
    assert S3().get(f"originals/{acct.id}/{scans[0]['id']}") == plan.data
    assert acct.http.get(f"/api/rolls/{roll['id']}").json()["state"] == "developed"


def test_wf_scan_upload_dropped_connection(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    plan = build_strip([Frame(70)])
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        page.route("**/api/**", lambda route: route.abort() if is_upload(route.request) else route.fallback())
        page.get_by_label("Strip scan", exact=True).set_input_files(
            {"name": "drop.png", "mimeType": "image/png", "buffer": plan.data})
        page.get_by_role("spinbutton", name="Scan DPI", exact=True).fill("300")
        page.get_by_role("spinbutton", name="First edge number", exact=True).fill("1")
        watch_activity(page)
        button = page.get_by_role("button", name="Upload strip", exact=True)
        button.click()
        copy = "Upload failed: the connection was lost. Nothing was stored; try again."
        expect(activity(page)).to_have_text(copy)
        expect(button).to_be_focused()
        expect(button).to_be_enabled()
        expect(page.get_by_role("progressbar", name="Upload progress")).to_have_count(0)
        expect(page.get_by_role("list", name="Strips").get_by_role("listitem")).to_have_count(0)
        assert activity_log(page) == [f"Uploading drop.png{ELLIPSIS}", copy]
        page.unroute("**/api/**")
        button.click()
        expect(activity(page)).to_have_text(stored_copy("drop.png"))
        expect(page.get_by_role("list", name="Strips").get_by_role("listitem")).to_have_count(1)
    assert len(S3().keys(f"originals/{acct.id}/")) == 1


def grey64(**kw: Any) -> bytes:
    return png_bytes(MIN_SIDE, MIN_SIDE, lambda x, y: (x * 4) % 256, **kw)


def test_api_upload_content_judged(app_url: str) -> None:
    acct = Account(app_url)
    grey = lambda x, y: (x * 4) % 256
    palette = png_bytes(MIN_SIDE, MIN_SIDE, grey, colour=3,
                        pre=(chunk(b"PLTE", b"".join(bytes([v, v, v]) for v in range(256))),))
    four_bit = png_bytes(MIN_SIDE, MIN_SIDE, depth=4, raw=b"".join(b"\0" + bytes(32) for _ in range(MIN_SIDE)))
    accepted = [
        ("png named tif", grey64(), "scan.tif", "image/tiff", "png"),
        ("tiff named png", tiff_bytes(MIN_SIDE, MIN_SIDE, grey), "scan.png", "image/png", "tiff"),
        ("tiff big-endian 16-bit rgb", tiff_bytes(MIN_SIDE, MIN_SIDE, lambda x, y: (x * 900, y * 900, 7), bits=16,
                                                  spp=3, photometric=2, endian=">"), "a.tif", "text/plain", "tiff"),
        ("tiff deflate predictor 2", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, compression=8, predictor=2),
         "b.tif", "image/tiff", "tiff"),
        ("png rgba 16", png_bytes(MIN_SIDE, MIN_SIDE, lambda x, y: (x, y, 9, CODE_16), depth=16, colour=6),
         "c.png", "image/png", "png"),
        ("png grey alpha", png_bytes(MIN_SIDE, MIN_SIDE, lambda x, y: (x, 255), colour=4), "d", "", "png"),
    ]
    for label, data, filename, ctype, fmt in accepted:
        roll = make_roll(acct)
        r = upload(acct.http, roll["id"], data, filename=filename, content_type=ctype)
        assert r.status_code == 201 and r.json()["format"] == fmt, (label, r.text)
        assert S3().get(f"originals/{acct.id}/{r.json()['id']}") == data
    refused = [
        ("text named png", b"hello, this is a text file" * 4, 415, None),
        ("jpeg bytes", b"\xff\xd8\xff\xe0" + b"\0" * 200, 415, None),
        ("palette", palette, 422, PIXEL_FORMAT),
        ("4-bit grey", four_bit, 422, PIXEL_FORMAT),
        ("cmyk", tiff_bytes(MIN_SIDE, MIN_SIDE, lambda x, y: (x, y, 0, 0), spp=4, photometric=5), 422, PIXEL_FORMAT),
        ("white is zero", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, photometric=0), 422, PIXEL_FORMAT),
        ("predictor 3", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, compression=8, predictor=3), 422, PIXEL_FORMAT),
        ("signed samples", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, sample_format=2), 422, PIXEL_FORMAT),
        ("two pages", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, pages=2), 422, TIFF_LAYOUT),
        ("tiled", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, tiled=True), 422, TIFF_LAYOUT),
        ("jpeg compressed", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, compression=7), 422, TIFF_LAYOUT),
        ("packbits", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, compression=32773), 422, TIFF_LAYOUT),
        ("predictor 2 uncompressed", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, predictor=2), 422, TIFF_LAYOUT),
    ]
    for label, data, status, copy in refused:
        clean = Account(app_url, "refused")
        roll = make_roll(clean)
        r = upload(clean.http, roll["id"], data, filename="scan.png", content_type="image/png")
        assert r.status_code == status, (label, r.status_code, r.text)
        if status == 415:
            assert r.json() == {"error": "unsupported_format"}, label
        else:
            assert r.json()["fields"] == {"file": copy}, label
        assert clean.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"] == [], label
        assert objects_for(clean.id) == [], label


def test_api_size_and_dimension_limits(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    u = urlparse(app_url)
    started = time.monotonic()
    status, body = raw_request(app_url, [
        f"POST /api/rolls/{roll['id']}/scans?dpi=300&first_edge=1&filename=big.png HTTP/1.1", f"Host: {u.netloc}",
        f"Cookie: edgeprint_session={acct.cookie()}", "Content-Type: application/octet-stream",
        f"Content-Length: {UPLOAD_LIMIT + 1}", f"X-Scan-Size: {UPLOAD_LIMIT + 1}", f"X-Scan-SHA256: {'0' * 64}"])
    assert status == 413 and json.loads(body) == {"error": "too_large"}
    assert time.monotonic() - started <= REFUSAL_S, "413 must be answered before the body arrives"
    bomb = zlib.compress(b"\0" * 10_000_000)
    for width, height in ((MAX_W + 1, MIN_SIDE), (MIN_SIDE, MAX_H + 1), (MIN_SIDE - 1, MIN_SIDE),
                          (MIN_SIDE, MIN_SIDE - 1), (MAX_W, MAX_PIXELS // MAX_W + 1)):
        started = time.monotonic()
        r = upload(acct.http, roll["id"], png_bytes(width, height, idat=bomb))
        assert r.status_code == 422 and r.json()["fields"] == {"file": DIMENSIONS}, (width, height, r.text)
        assert time.monotonic() - started <= REFUSAL_S
    wide = tiff_bytes(MIN_SIDE, MIN_SIDE, lambda x, y: x)
    wide = wide.replace(struct.pack("<HHII", 256, 4, 1, MIN_SIDE), struct.pack("<HHII", 256, 4, 1, MAX_W + 9), 1)
    r = upload(acct.http, roll["id"], wide)
    assert r.status_code == 422 and r.json()["fields"] == {"file": DIMENSIONS}
    for width, height in ((MAX_W, MIN_SIDE), (MIN_SIDE, MAX_H)):
        r = upload(acct.http, roll["id"], png_bytes(width, height, lambda x, y: (x + y) % 256))
        assert r.status_code == 201, (width, height, r.text)
    at_limit = private_padding(UPLOAD_LIMIT, grey64())
    assert len(at_limit) == UPLOAD_LIMIT
    started = time.monotonic()
    r = upload(acct.http, roll["id"], at_limit)
    assert r.status_code == 201 and r.json()["size"] == UPLOAD_LIMIT, r.text
    assert time.monotonic() - started <= UPLOAD_AT_LIMIT_S
    assert len(acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"]) == 3


CRAFTED_IDS = ["png-bad-ihdr-crc", "png-ihdr-length", "png-bad-idat-crc", "png-idat-split", "png-ztxt-bomb",
               "png-ztxt-at-limit", "png-itxt-bomb", "png-iccp-bomb", "png-idat-overlong", "png-idat-short",
               "png-adam7-overlong", "png-adam7-exact", "png-inflate-bomb", "tiff-ifd-loop", "tiff-strip-past-end",
               "tiff-short-strips", "tiff-ifd-outside"]


def crafted(case: str) -> tuple[bytes, str | None]:
    grey = lambda x, y: (x * 4) % 256
    raw = raw_rows(MIN_SIDE, MIN_SIDE, grey, 8, False)
    if case == "png-bad-ihdr-crc":
        data = bytearray(grey64())
        data[29] ^= 0xFF
        return bytes(data), UNREADABLE
    if case == "png-ihdr-length":
        return grey64(ihdr=chunk(b"IHDR", struct.pack(">IIBBBB", MIN_SIDE, MIN_SIDE, 8, 0, 0, 0))), UNREADABLE
    if case == "png-bad-idat-crc":
        data = bytearray(grey64())
        data[-13] ^= 0xFF
        return bytes(data), UNREADABLE
    if case == "png-idat-split":
        stream = zlib.compress(raw)
        half = len(stream) // 2
        head = chunk(b"IHDR", struct.pack(">IIBBBBB", MIN_SIDE, MIN_SIDE, 8, 0, 0, 0, 0))
        return (PNG_SIG + head + chunk(b"IDAT", stream[:half]) + chunk(b"tEXt", b"Note\0split")
                + chunk(b"IDAT", stream[half:]) + chunk(b"IEND", b"")), UNREADABLE
    if case in ("png-ztxt-bomb", "png-ztxt-at-limit"):
        size = TEXT_INFLATE_LIMIT + (1 if case == "png-ztxt-bomb" else 0)
        text = chunk(b"zTXt", b"Comment\0\0" + zlib.compress(b"a" * size))
        return grey64(pre=(text,)), UNREADABLE if case == "png-ztxt-bomb" else None
    if case == "png-itxt-bomb":
        body = b"Comment\0\x01\x00en\0\0" + zlib.compress(b"a" * (TEXT_INFLATE_LIMIT + 1))
        return grey64(pre=(chunk(b"iTXt", body),)), UNREADABLE
    if case == "png-iccp-bomb":
        return grey64(pre=(chunk(b"iCCP", b"profile\0\0" + zlib.compress(b"\0" * (TEXT_INFLATE_LIMIT + 1))),)), UNREADABLE
    if case == "png-idat-overlong":
        return grey64(raw=raw + b"\0" * (MIN_SIDE + 1)), UNREADABLE
    if case == "png-idat-short":
        return grey64(raw=raw[:-10]), UNREADABLE
    if case in ("png-adam7-overlong", "png-adam7-exact"):
        w, h = MIN_SIDE + 3, MIN_SIDE + 1
        laced = raw_rows(w, h, grey, 8, True)
        extra = b"\0" * 7 if case == "png-adam7-overlong" else b""
        return png_bytes(w, h, interlace=True, raw=laced + extra), UNREADABLE if extra else None
    if case == "png-inflate-bomb":
        packer, parts = zlib.compressobj(9), []
        block = b"\0" * 1_000_000
        for _ in range(200):
            parts.append(packer.compress(block))
        parts.append(packer.flush())
        return png_bytes(MAX_W, MAX_PIXELS // MAX_W, idat=b"".join(parts)), UNREADABLE
    if case == "tiff-ifd-loop":
        return tiff_bytes(MIN_SIDE, MIN_SIDE, grey, pages=2, loop=True), UNREADABLE
    if case == "tiff-strip-past-end":
        return tiff_bytes(MIN_SIDE, MIN_SIDE, grey, strip_offset_shift=100_000), UNREADABLE
    if case == "tiff-short-strips":
        return tiff_bytes(MIN_SIDE, MIN_SIDE, grey, byte_count_cut=MIN_SIDE * 2), UNREADABLE
    if case == "tiff-ifd-outside":
        return tiff_bytes(MIN_SIDE, MIN_SIDE, grey, ifd_outside=True), UNREADABLE
    raise AssertionError(case)


@pytest.mark.parametrize("case", CRAFTED_IDS, ids=CRAFTED_IDS)
def test_api_crafted_scans_bounded(app_url: str, case: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    data, copy = crafted(case)
    with HealthWatch(app_url) as health:
        started = time.monotonic()
        r = upload(acct.http, roll["id"], data)
        elapsed = time.monotonic() - started
    assert elapsed <= REFUSAL_S, f"{case} took {elapsed:.1f}s"
    assert health.failures == [] and health.slowest <= HEALTH_S, health.slowest
    if copy is None:
        assert r.status_code == 201, r.text
        return
    assert r.status_code == 422 and r.json() == {"error": "validation_failed", "fields": {"file": copy}}, r.text
    assert acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"] == []
    assert objects_for(acct.id) == []


def ui_upload(page: Page, name: str, data: bytes) -> None:
    page.get_by_label("Strip scan", exact=True).set_input_files(
        {"name": name, "mimeType": "image/png", "buffer": data})
    page.get_by_role("spinbutton", name="Scan DPI", exact=True).fill("300")
    page.get_by_role("spinbutton", name="First edge number", exact=True).fill("1")
    page.get_by_role("button", name="Upload strip", exact=True).click()


def test_wf_upload_safety_damaged_files(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    grey = lambda x, y: (x * 4) % 256
    palette = png_bytes(MIN_SIDE, MIN_SIDE, grey, colour=3,
                        pre=(chunk(b"PLTE", b"".join(bytes([v, v, v]) for v in range(256))),))
    files = [("palette.png", palette, PIXEL_FORMAT),
             ("pages.tif", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, pages=2), TIFF_LAYOUT),
             ("tiles.tif", tiff_bytes(MIN_SIDE, MIN_SIDE, grey, tiled=True), TIFF_LAYOUT)]
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        field = page.get_by_label("Strip scan", exact=True)
        for name, data, copy in files:
            ui_upload(page, name, data)
            expect(activity(page)).to_have_text(copy, timeout=REFUSAL_S * 1000)
            expect(page.get_by_text(copy, exact=True).first).to_be_visible()
            expect(field).to_have_attribute("aria-invalid", "true")
            expect(field).to_be_focused()
            expect(page.get_by_role("list", name="Strips").get_by_role("listitem")).to_have_count(0)
    assert acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"] == []
    assert objects_for(acct.id) == []


def test_wf_upload_safety_bomb_then_valid(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    bomb, _ = crafted("png-ztxt-bomb")
    plan = build_strip([Frame(60)])
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        ui_upload(page, "bomb.png", bomb)
        expect(activity(page)).to_have_text(UNREADABLE, timeout=REFUSAL_S * 1000)
        expect(page.get_by_label("Strip scan", exact=True)).to_have_attribute("aria-invalid", "true")
        ui_upload(page, "good.png", plan.data)
        expect(activity(page)).to_have_text(stored_copy("good.png"))
        expect(page.get_by_role("list", name="Strips").get_by_role("listitem")).to_have_count(1)
    scans = acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"]
    assert [s["sha256"] for s in scans] == [hashlib.sha256(plan.data).hexdigest()]
    assert S3().keys(f"originals/{acct.id}/") == [f"originals/{acct.id}/{scans[0]['id']}"]


def outage_setup(app_url: str) -> dict:
    acct = Account(app_url, "outage")
    roll, entries, plan, scan = slip_roll(acct, align=True)
    cx, cy = frame_center(scan, 1)
    pin = acct.http.post(f"/api/scans/{scan['id']}/readings", json={"x": cx, "y": cy})
    assert pin.status_code == 201
    other = make_roll(acct)
    stored = upload(acct.http, other["id"], build_strip([Frame(70)]).data).json()
    calibrated = ready_scan(acct, other["id"], build_strip([Frame(80), Frame(95)]), detect=False)
    return {"acct": acct, "roll": roll, "entries": entries, "scan": scan, "pin": pin.json(), "other": other,
            "stored": stored, "calibrated": calibrated, "plan": plan}


def test_api_storage_outage(app_url: str) -> None:
    s = outage_setup(app_url)
    acct, scan, roll = s["acct"], s["scan"], s["roll"]
    before = sorted(objects_for(acct.id))
    down = acct.on(minio_down_url())
    unavailable = {"error": "storage_unavailable"}
    assert down.get("/api/health").json() == {"status": "ok"}
    assert down.get("/api/storage").json() == {"storage": "unavailable"}
    assert app_url and httpx.get(app_url + "/api/storage").json() == {"storage": "ok"}
    cx, cy = frame_center(scan, 2)
    refused = [
        upload(down, s["other"]["id"], build_strip([Frame(40)]).data),
        down.post(f"/api/scans/{s['stored']['id']}/calibration", json={"method": "clear_light", "area": CLEAR_AREA}),
        down.post(f"/api/scans/{s['calibrated']['id']}/frames/detect", json={}),
        down.get(f"/api/scans/{scan['id']}/reading", params={"x": cx, "y": cy}),
        down.post(f"/api/scans/{scan['id']}/readings", json={"x": cx, "y": cy}),
        down.get(f"/api/scans/{scan['id']}/original"),
        down.get(f"/api/scans/{scan['id']}/preview/0"),
    ]
    for r in refused:
        assert (r.status_code, r.json()) == (503, unavailable), r.request.url
    assert scan_detail(acct.http, s["stored"]["id"])["state"] == "stored"
    assert scan_detail(acct.http, s["calibrated"]["id"])["frames"] == []
    assert len(acct.http.get(f"/api/frames/{scan['frames'][1]['id']}").json()["readings"]) == 0
    offline_text = uuid.uuid4().hex[:10]
    r = down.patch(f"/api/frames/{scan['frames'][1]['id']}", json={"title": offline_text})
    assert r.status_code == 200 and r.json()["title"] == offline_text
    assert down.post(f"/api/rolls/{roll['id']}/entries", json={"counter": 9, "aperture": "8", "shutter": "1/125",
                                                               "metered_ev": 10}).status_code == 201
    assert down.patch(f"/api/entries/{s['entries'][4]['id']}", json={"note": offline_text}).status_code == 200
    assert down.post(f"/api/rolls/{roll['id']}/alignment/proposal", json={}).status_code == 200
    r = put_alignment(down, roll["id"], 0, 2)
    assert r.status_code == 200 and r.json()["version"] == 2
    sheet = down.get(f"/api/rolls/{roll['id']}/contact-sheet").json()
    assert sheet["counters"] == recount(sheet) and len(sheet["frames"]) == 6
    assert down.get(f"/api/rolls/{roll['id']}/curve").status_code == 200
    frame = down.get(f"/api/frames/{scan['frames'][0]['id']}").json()
    assert [x["id"] for x in frame["readings"]] == [s["pin"]["id"]] and frame["entry"]["note"] == f"{SLIP_NOTE}-{1}"
    assert down.get(f"/api/rolls/{roll['id']}").json()["counters"] == sheet["counters"]
    assert sorted(objects_for(acct.id)) == before


def test_outage_refusals_spring_back(browser: Browser, app_url: str) -> None:
    s = outage_setup(app_url)
    acct, scan, roll = s["acct"], s["scan"], s["roll"]
    base = minio_down_url()
    frame = scan["frames"][0]
    r = acct.on(base).patch(f"/api/frames/{frame['id']}", json={"x1": frame["x1"] - 2, "title": "Should not save"})
    assert (r.status_code, r.json()) == (503, {"error": "storage_unavailable"})
    kept = acct.http.get(f"/api/frames/{frame['id']}").json()["frame"]
    assert (kept["x1"], kept["title"] or "") == (frame["x1"], "")
    with app_page(browser, base + "/signin") as page:
        ui_signin(page, base, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        expect(page.get_by_role("alert")).to_contain_text(BANNER)
        handle = page.get_by_role("slider", name=edge_name(1, "right"), exact=True)
        expect_now(handle, frame["x1"])
        handle.focus()
        page.keyboard.press("ArrowLeft")
        expect_now(handle, frame["x1"] - 1)
        page.keyboard.press("Enter")
        expect(activity(page)).to_have_text(OUTAGE_OTHER)
        expect_now(handle, frame["x1"])
        readings = page.get_by_role("list", name=readings_name(1), exact=True).get_by_role("listitem")
        expect(readings).to_have_count(1)
        strip_app(page).focus()
        region = page.get_by_role("region", name="Strip", exact=True)
        before = settled_pixels(region)
        page.keyboard.press("Enter")
        expect(activity(page)).to_have_text(OUTAGE_OTHER)
        expect(readings).to_have_count(1)
        poll(lambda: png_pixels(capture(region))[3] == before[3], 5, "a refused pin must not draw a marker")
    assert acct.http.get(f"/api/frames/{frame['id']}").json()["frame"]["x1"] == frame["x1"]
    assert len(acct.http.get(f"/api/frames/{frame['id']}").json()["readings"]) == 1


def test_wf_storage_outage_read_archive(browser: Browser, app_url: str) -> None:
    s = outage_setup(app_url)
    acct, roll = s["acct"], s["roll"]
    base = minio_down_url()
    with app_page(browser, base + "/signin") as page:
        ui_signin(page, base, acct.email, acct.password)
        alert = page.get_by_role("alert")
        expect(alert).to_contain_text(BANNER)
        alert.get_by_role("button", name="Check again", exact=True).click()
        expect(page.get_by_role("alert")).to_contain_text(BANNER)
        page.get_by_role("list", name="Rolls").get_by_role("link", name=roll["name"], exact=True).click()
        expect(page.get_by_role("alert")).to_be_visible()
        counters = page.get_by_role("region", name="Roll counters", exact=True)
        for text in ("Detected 6", "Aligned 5", "Unexposed 0", "Unmatched notes 0"):
            expect(counters).to_contain_text(text)
        sheet = page.get_by_role("list", name="Contact sheet").get_by_role("listitem")
        expect(sheet).to_have_count(6)
        expect(sheet.first).to_contain_text("Note 1")
        expect(page.get_by_role("list", name="Shooting log")).to_contain_text(f"{SLIP_NOTE}-{3}")
        sheet.first.get_by_role("link", name=open_frame_name(1), exact=True).click()
        expect(page.get_by_role("list", name=readings_name(1), exact=True)).to_contain_text(
            f"Net {fixed(s['pin']['net'])}")
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Log", exact=True).click()
        expect(page.get_by_role("alert")).to_be_visible()
        select(page.get_by_role("combobox", name="Roll", exact=True), roll["name"])
        page.get_by_role("spinbutton", name="Counter", exact=True).fill("8")
        page.get_by_role("textbox", name="Shutter", exact=True).fill("1/125")
        page.get_by_role("spinbutton", name="Metered EV", exact=True).fill("10")
        page.get_by_role("button", name="Log exposure", exact=True).click()
        expect(activity(page)).to_have_text("Note 8 logged.")
    assert 8 in [e["counter"] for e in entries_of(acct.http, roll["id"])]


def test_wf_storage_outage_upload_refused(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    base = minio_down_url()
    with app_page(browser, base + "/signin") as page:
        ui_signin(page, base, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        watch_activity(page)
        ui_upload(page, "offline.png", build_strip([Frame(60)]).data)
        expect(activity(page)).to_have_text(OUTAGE_UPLOAD)
        expect(page.get_by_role("button", name="Upload strip", exact=True)).to_be_focused()
        expect(page.get_by_role("alert")).to_contain_text(BANNER)
        expect(page.get_by_role("list", name="Strips").get_by_role("listitem")).to_have_count(0)
        assert activity_log(page) == [f"Uploading offline.png{ELLIPSIS}", OUTAGE_UPLOAD]
    assert acct.http.get(f"/api/rolls/{roll['id']}/scans").json()["scans"] == []
    assert objects_for(acct.id) == []


def test_api_clear_light_calibration(app_url: str) -> None:
    acct = Account(app_url)
    patch = {"x": 0, "y": 0, "w": 32, "h": 64}
    gamma = 0.45455
    srgb, gama = chunk(b"sRGB", b"\0"), chunk(b"gAMA", struct.pack(">I", 45455))
    ignored = (chunk(b"iCCP", b"fake\0\0" + zlib.compress(b"x" * 200)),
               chunk(b"cHRM", struct.pack(">8I", 31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000)),
               chunk(b"sBIT", b"\x10"))

    def two(a: Any, b: Any, **kw: Any) -> bytes:
        return png_bytes(128, 64, lambda x, y: a if x < 32 else b, **kw)

    def two_tiff(a: int, b: int, endian: str) -> bytes:
        return tiff_bytes(128, 64, lambda x, y: a if x < 32 else b, bits=16, endian=endian)

    lin = lambda c: c
    cases = [
        ("8-bit linear", two(240, 12), "linear", None, lin, (240,), (12,), CODE_8),
        ("16-bit linear", two(60000, 300, depth=16), "linear", None, lin, (60000,), (300,), CODE_16),
        ("16-bit Adam7", two(60000, 300, depth=16, interlace=True), "linear", None, lin, (60000,), (300,), CODE_16),
        ("16-bit sRGB", two(60000, 3000, depth=16, pre=(srgb,)), "srgb", None, srgb_linear, (60000,), (3000,),
         CODE_16),
        ("8-bit gAMA", two(240, 40, pre=(gama,)), "gamma", gamma, lambda c: c ** (1 / gamma), (240,), (40,), CODE_8),
        ("RGBA sRGB wins over gAMA", two((250, 200, 150, 255), (40, 20, 10, 128), colour=6, pre=(srgb, gama)),
         "srgb", None, srgb_linear, (250, 200, 150), (40, 20, 10), CODE_8),
        ("16-bit iCCP cHRM sBIT ignored", two(60000, 300, depth=16, pre=ignored), "linear", None, lin, (60000,),
         (300,), CODE_16),
        ("TIFF little-endian", two_tiff(60000, 300, "<"), "linear", None, lin, (60000,), (300,), CODE_16),
        ("TIFF big-endian", two_tiff(60000, 300, ">"), "linear", None, lin, (60000,), (300,), CODE_16),
        ("zero clamps to 3", two(240, 0), "linear", None, lin, (240,), (0,), CODE_8),
    ]
    for label, data, transfer, g, fn, a, b, maxv in cases:
        roll = make_roll(acct)
        r = upload(acct.http, roll["id"], data)
        assert r.status_code == 201, (label, r.text)
        sid = r.json()["id"]
        assert r.json()["transfer"] == transfer, label
        assert (r.json()["gamma"] is None) if g is None else abs(r.json()["gamma"] - g) < 1e-5, label
        assert acct.http.get(f"/api/scans/{sid}/reading", params={"x": 40, "y": 16}).json() == \
            {"error": "not_calibrated"}
        cal = acct.http.post(f"/api/scans/{sid}/calibration", json={"method": "clear_light", "area": patch})
        assert cal.status_code == 201, (label, cal.text)
        ref = statistics.fmean(fn(v / maxv) for v in a)
        point = statistics.fmean(fn(v / maxv) for v in b)
        assert cal.json()["method"] == "clear_light" and abs(cal.json()["reference"] - ref) < 1e-3, label
        assert scan_detail(acct.http, sid)["state"] == "calibrated"
        got = reading(acct.http, sid, 45, 20)
        assert (got["x"], got["y"], got["net"]) == (40, 16, None), label
        assert got["calibration_id"] == cal.json()["id"]
        assert abs(got["gross"] - gross_of(point, ref)) <= 0.006, (label, got["gross"], gross_of(point, ref))
    area_copy = "Mark an area inside the scan, at least 8 × 8 pixels."
    for area in ({"x": 0, "y": 0, "w": 7, "h": 8}, {"x": 120, "y": 0, "w": 16, "h": 16},
                 {"x": 0, "y": 60, "w": 8, "h": 8}):
        r = acct.http.post(f"/api/scans/{sid}/calibration", json={"method": "clear_light", "area": area})
        assert r.status_code == 422 and r.json()["fields"] == {"area": area_copy}, area
    for x, y in ((128, 0), (0, 64), (-1, 0)):
        r = acct.http.get(f"/api/scans/{sid}/reading", params={"x": x, "y": y})
        assert r.status_code == 422 and set(r.json()["fields"].values()) == {"Point is outside the scan."}


def wedge_density(linear: float, means: list[float]) -> float:
    xs = [math.log10(m) for m in means]
    t = math.log10(linear) if linear > 0 else -99.0
    nominal = [0.05 + 0.15 * k for k in range(WEDGE_STEPS)]
    k = 0 if t >= xs[0] else WEDGE_STEPS - 2 if t <= xs[-1] else next(
        i for i in range(WEDGE_STEPS - 1) if xs[i] >= t >= xs[i + 1])
    d = nominal[k] + (nominal[k + 1] - nominal[k]) * (t - xs[k]) / (xs[k + 1] - xs[k])
    return min(3.0, max(0.0, d))


def test_api_step_wedge_calibration(app_url: str) -> None:
    acct = Account(app_url)
    steps = [round(60000 * 10 ** (-0.15 * k)) for k in range(WEDGE_STEPS)]

    def wedge(codes: list[int]) -> bytes:
        def sample(x: int, y: int) -> int:
            if 20 <= x < 230:
                return codes[(x - 20) // 10]
            return 5000 if x >= 250 else CODE_16
        return png_bytes(300, 64, sample, depth=16)

    area = {"x": 20, "y": 8, "w": 210, "h": 48}
    roll = make_roll(acct)
    swapped = list(steps)
    swapped[5], swapped[6] = swapped[6], swapped[5]
    bad = upload(acct.http, roll["id"], wedge(swapped)).json()["id"]
    r = acct.http.post(f"/api/scans/{bad}/calibration", json={"method": "step_wedge", "area": area})
    assert r.status_code == 422 and r.json()["fields"] == {"wedge": "The wedge steps must darken from left to right."}
    size = "Mark the whole wedge, at least 42 pixels wide and 8 tall."
    for small in ({"x": 20, "y": 8, "w": 41, "h": 48}, {"x": 20, "y": 8, "w": 210, "h": 7}):
        r = acct.http.post(f"/api/scans/{bad}/calibration", json={"method": "step_wedge", "area": small})
        assert r.status_code == 422 and r.json()["fields"] == {"wedge": size}, small
    assert scan_detail(acct.http, bad)["calibration"] is None and scan_detail(acct.http, bad)["state"] == "stored"
    good = upload(acct.http, roll["id"], wedge(steps)).json()["id"]
    r = acct.http.post(f"/api/scans/{good}/calibration", json={"method": "step_wedge", "area": area})
    assert r.status_code == 201, r.text
    cal = r.json()
    assert cal["method"] == "step_wedge" and len(cal["steps"]) == WEDGE_STEPS
    means = [c / CODE_16 for c in steps]
    for step, mean in zip(sorted(cal["steps"], key=lambda s: s["k"]), means):
        assert abs(step["nominal"] - (0.05 + 0.15 * step["k"])) < 1e-6 and abs(step["value"] - mean) < 1e-4
    for x, code in ((80, steps[6]), (256, 5000), (5, CODE_16), (200, steps[18])):
        expected = wedge_density(code / CODE_16, means)
        assert abs(reading(acct.http, good, x, 24)["gross"] - expected) <= 0.006, (x, expected)


def test_wf_calibration_clear_light(browser: Browser, app_url: str) -> None:
    acct, intruder = Account(app_url), Account(app_url, "intruder")
    roll = make_roll(acct)
    plan = build_strip([Frame(60), Frame(90)])
    scan = ready_scan(acct, roll["id"], plan, calibrate=False, detect=False)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        page.get_by_role("radio", name="Clear light", exact=True).check()
        fields = {"Area x": "8", "Area y": "0", "Area width": "4", "Area height": "8"}
        for name, value in fields.items():
            page.get_by_role("spinbutton", name=name, exact=True).fill(value)
        page.get_by_role("button", name="Calibrate", exact=True).click()
        expect(activity(page)).to_have_text("Mark an area inside the scan, at least 8 × 8 pixels.")
        page.get_by_role("spinbutton", name="Area width", exact=True).fill("32")
        held = hold(page, lambda req: req.method == "POST" and req.url.endswith("/calibration"))
        page.get_by_role("button", name="Calibrate", exact=True).click()
        pump(page, lambda: len(held) == 1, "Calibrate sent no request")
        expect(activity(page)).to_have_text(f"Calibrating{ELLIPSIS}")
        held.pop().continue_()
        expect(activity(page)).to_have_text("Calibrated from clear light.")
        page.goto(f"{app_url}/rolls/{roll['id']}")
        expect(page.get_by_role("list", name="Strips").get_by_role("listitem").first).to_contain_text("Calibrated")
    detail = scan_detail(acct.http, scan["id"])
    assert detail["calibration"]["area"] == CLEAR_AREA and abs(detail["calibration"]["reference"] - 1.0) < 1e-6
    x0 = plan.frames[0][0] + 100
    assert abs(reading(acct.http, scan["id"], x0, 30)["gross"] - plan.cell_gross(x0, 30)) <= 0.006
    r = intruder.http.post(f"/api/scans/{scan['id']}/calibration", json={"method": "clear_light", "area": CLEAR_AREA})
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    assert scan_detail(acct.http, scan["id"])["calibration"]["id"] == detail["calibration"]["id"]


def test_wf_calibration_step_wedge(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    plan = build_strip([Frame(c) for c in SLIP_CODES[:3]], wedge=True)
    scan = ready_scan(acct, roll["id"], plan)
    cx, cy = frame_center(scan, 2)
    pin = acct.http.post(f"/api/scans/{scan['id']}/readings", json={"x": cx, "y": cy}).json()
    old_fog = scan["base_fog"]
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        page.get_by_role("radio", name="Step wedge", exact=True).check()
        for x in ("220", "0"):
            for name, value in {"Area x": x, "Area y": str(STRIP_H - 8), "Area width": "210",
                                "Area height": "8"}.items():
                page.get_by_role("spinbutton", name=name, exact=True).fill(value)
            page.get_by_role("button", name="Calibrate", exact=True).click()
            expect(activity(page)).to_have_text("The wedge steps must darken from left to right." if x == "220"
                                                else "Calibrated from the step wedge.")
    detail = scan_detail(acct.http, scan["id"])
    assert detail["calibration"]["method"] == "step_wedge" and detail["state"] == "framed"
    means = [wedge_code(k) / CODE_8 for k in range(WEDGE_STEPS)]
    now = reading(acct.http, scan["id"], cx, cy)
    assert abs(now["gross"] - wedge_density(SLIP_CODES[1] / CODE_8, means)) <= 0.006
    assert abs(detail["base_fog"] - wedge_density(GAP_CODE / CODE_8, means)) <= 0.006 and detail["base_fog"] != old_fog
    kept = acct.http.get(f"/api/frames/{scan['frames'][1]['id']}").json()["readings"][0]
    assert (kept["gross"], kept["net"], kept["calibration_id"]) == (pin["gross"], pin["net"], pin["calibration_id"])
    assert kept["calibration_id"] != detail["calibration"]["id"]


def test_api_frame_detection(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    one = build_strip([Frame(40), Frame(60), Frame(None), Frame(80), Frame(100, width=470), Frame(120)])
    two = build_strip([Frame(50), Frame(70)], right_run=(300, 90))
    s1 = ready_scan(acct, roll["id"], one, first_edge=1)
    s2 = ready_scan(acct, roll["id"], two, first_edge=20, filename="two.png")
    expected_px = IMAGE_35_MM * DPI / MM_PER_INCH
    for scan, plan, numbers, edges, flags in (
            (s1, one, [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], ["ok", "ok", "ok", "ok", "flagged", "ok"]),
            (s2, two, [7, 8, 9], [20, 21, 22], ["ok", "ok", "flagged"])):
        frames = scan["frames"]
        assert scan["state"] == "framed"
        assert [f["number"] for f in frames] == numbers and [f["edge_number"] for f in frames] == edges
        assert [f["flag"] for f in frames] == flags
        bounds = plan.frames if plan is one else plan.frames + [(plan.width - 300, plan.width, False)]
        bf = plan.base_fog([(a, b) for a, b, _ in bounds])
        assert abs(scan["base_fog"] - bf) <= 0.006
        for f, (x0, x1, blank) in zip(frames, bounds):
            assert (f["x0"], f["x1"], f["blank_slot"]) == (x0, x1, blank), f
            assert abs(f["width_mm"] - (x1 - x0) * MM_PER_INCH / DPI) <= 0.051
            gross = plan.frame_gross(x0, x1)
            assert abs(f["mean_density"] - gross) <= 0.011 and abs(f["net_density"] - (gross - bf)) <= 0.011
            assert f["unexposed"] is (gross - bf <= 0.05)
            assert (f["flag"] == "flagged") is (abs((x1 - x0) - expected_px) > WIDTH_TOLERANCE * expected_px)
    blank = s1["frames"][2]
    assert blank["x0"] == round(s1["frames"][1]["x0"] + PITCH_35_MM * DPI / MM_PER_INCH)
    assert blank["unexposed"] is True
    r = acct.http.post(f"/api/frames/{s1['frames'][4]['id']}/accept-width", json={})
    assert r.status_code == 200 and r.json()["flag"] == "accepted"
    r = acct.http.post(f"/api/frames/{s1['frames'][0]['id']}/accept-width", json={})
    assert (r.status_code, r.json()) == (409, {"error": "not_flagged"})
    medium = make_roll(acct, format="120-6x6")
    width66 = round(IMAGE_66_MM * DPI / MM_PER_INCH)
    gap66 = round(PITCH_66_MM * DPI / MM_PER_INCH) - width66
    s3 = ready_scan(acct, medium["id"], build_strip([Frame(60, width=width66), Frame(90, width=width66)],
                                                    frame_gap=gap66))
    assert [f["flag"] for f in s3["frames"]] == ["ok", "ok"], "pitch and width follow the roll's format"
    flat = upload(acct.http, roll["id"], png_bytes(800, STRIP_H, lambda x, y: GAP_CODE)).json()["id"]
    acct.http.post(f"/api/scans/{flat}/calibration", json={"method": "clear_light", "area": CLEAR_AREA})
    r = acct.http.post(f"/api/scans/{flat}/frames/detect", json={})
    assert r.status_code == 422 and r.json()["fields"] == {"scan": "No frames found for this format and DPI."}
    assert scan_detail(acct.http, flat)["state"] == "calibrated"


def test_api_boundary_nudges(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    plan = build_strip([Frame(60, right=120), Frame(80)], gap_codes=[(220, 210)])
    scan = ready_scan(acct, roll["id"], plan)
    f1, f2 = scan["frames"]
    assert abs(scan["base_fog"] - plan.base_fog([(f1["x0"], f1["x1"]), (f2["x0"], f2["x1"])])) <= 0.006
    r = acct.http.patch(f"/api/frames/{f1['id']}", json={"x1": f1["x1"] + 6})
    assert r.status_code == 200 and (r.json()["x0"], r.json()["x1"]) == (f1["x0"], f1["x1"] + 6)
    fog = scan_detail(acct.http, scan["id"])["base_fog"]
    expected = plan.base_fog([(f1["x0"], f1["x1"] + 6), (f2["x0"], f2["x1"])])
    assert abs(fog - expected) <= 0.006 and abs(fog - scan["base_fog"]) > 0.004
    r = acct.http.patch(f"/api/frames/{f1['id']}", json={"x1": f1["x0"] + 150})
    assert r.status_code == 200 and r.json()["flag"] == "flagged"
    assert abs(r.json()["mean_density"] - plan.frame_gross(f1["x0"], f1["x0"] + 150)) <= 0.011
    assert r.json()["mean_density"] > f1["mean_density"]
    assert acct.http.post(f"/api/frames/{f1['id']}/accept-width", json={}).json()["flag"] == "accepted"
    r = acct.http.patch(f"/api/frames/{f1['id']}", json={"x1": f1["x1"]})
    assert r.json()["flag"] == "ok", "a nudge re-judges an accepted width"
    width = scan["width"]
    for body in ({"x1": f2["x0"] + 1}, {"x0": -1}, {"x0": f2["x0"], "x1": width + 1},
                 {"x0": f1["x1"] - 7}, {"x0": f2["x0"] - 30}):
        target = f1 if "x1" in body and body.get("x1") == f2["x0"] + 1 or body.get("x0") in (-1, f1["x1"] - 7) else f2
        r = acct.http.patch(f"/api/frames/{target['id']}", json=body)
        assert r.status_code == 422 and EDGE_COPY in r.json()["fields"].values(), (body, r.text)
    final = scan_detail(acct.http, scan["id"])["frames"]
    assert [(f["x0"], f["x1"]) for f in final] == [(f1["x0"], f1["x1"]), (f2["x0"], f2["x1"])]


def test_frame_handles_keyboard(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    scan = ready_scan(acct, roll["id"], build_strip([Frame(40), Frame(60, width=470), Frame(80)]))
    f1, f2 = scan["frames"][0], scan["frames"][1]
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        left = page.get_by_role("slider", name=edge_name(1, "left"), exact=True)
        bounds = left.evaluate(SLIDER_JS)
        assert (bounds["min"], bounds["max"]) == (0, scan["width"])
        expect_now(left, f1["x0"])
        left.scroll_into_view_if_needed()
        assert left.evaluate(HIT_AREA_JS, TOUCH_TARGET_PX / 2 - 0.5), "the handle's hit area is under 44 px"
        _, focused = state_styles(left, "outline-width", "outline-style", state="focus")
        assert focused["outline-width"] == f"{OUTLINE_PX}px" and focused["outline-style"] != "none", focused
        left.focus()
        assert tab_order(page, 5) == [edge_name(1, "right"), edge_name(2, "left"), edge_name(2, "right"),
                                      accept_name(2), edge_name(3, "left")]
        left.focus()
        bodies: list[dict] = []
        page.on("request", lambda req: bodies.append(req.post_data_json) if req.method == "PATCH" else None)
        page.keyboard.press("ArrowRight")
        expect_now(left, f1["x0"] + 1)
        page.keyboard.press("Shift+ArrowRight")
        expect_now(left, f1["x0"] + 9)
        page.keyboard.press("Enter")
        expect(activity(page)).to_have_text("Frame 1 saved.")
        assert bodies and set(bodies[-1]) == {"x0"} and bodies[-1]["x0"] == f1["x0"] + 9
        page.get_by_role("slider", name=edge_name(2, "right"), exact=True).focus()
        page.keyboard.press("Tab")
        accept = page.get_by_role("button", name=accept_name(2), exact=True)
        expect(accept).to_be_focused()
        page.keyboard.press("Enter")
        expect(activity(page)).to_have_text("Frame 2 width accepted.")
        expect(accept).to_have_count(0)
    frames = scan_detail(acct.http, scan["id"])["frames"]
    assert (frames[0]["x0"], frames[0]["x1"]) == (f1["x0"] + 9, f1["x1"]) and frames[1]["flag"] == "accepted"
    assert (frames[1]["x0"], frames[1]["x1"]) == (f2["x0"], f2["x1"])


def test_wf_frame_detection_find_and_nudge(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    scan = ready_scan(acct, roll["id"], build_strip([Frame(40), Frame(60, width=470), Frame(80)]), detect=False)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        page.get_by_role("button", name="Find frames", exact=True).click()
        expect(activity(page)).to_have_text("Found 3 frames, 1 flagged.")
        frames = scan_detail(acct.http, scan["id"])["frames"]
        right = page.get_by_role("slider", name=edge_name(2, "right"), exact=True)
        right.focus()
        for _ in range(5):
            page.keyboard.press("Shift+ArrowLeft")
        page.keyboard.press("Enter")
        expect(activity(page)).to_have_text("Frame 2 saved.")
        expect(page.get_by_role("button", name=accept_name(2), exact=True)).to_have_count(0)
        saved = frames[1]["x1"] - 40
        right.focus()
        for _ in range(10):
            page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Enter")
        expect(activity(page)).to_have_text(EDGE_COPY)
        expect_now(right, saved)
    after = scan_detail(acct.http, scan["id"])["frames"][1]
    assert (after["x1"], after["flag"]) == (saved, "ok")


def test_wf_frame_detection_counters_follow_edits(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, entries, plan, scan = slip_roll(acct)
    rid = roll["id"]

    def check(expected: dict) -> None:
        sheet = acct.http.get(f"/api/rolls/{rid}/contact-sheet").json()
        assert sheet["counters"] == recount(sheet) == expected, (sheet["counters"], expected)
        assert acct.http.get(f"/api/rolls/{rid}").json()["counters"] == expected

    check({"detected": 6, "aligned": 0, "unexposed": 0, "unmatched_notes": 5})
    assert put_alignment(acct.http, rid, 0, 2).status_code == 200
    check({"detected": 6, "aligned": 5, "unexposed": 0, "unmatched_notes": 0})
    extra = add_entry(acct, rid, 6, "1/125")
    check({"detected": 6, "aligned": 5, "unexposed": 0, "unmatched_notes": 1})
    assert acct.http.delete(f"/api/entries/{extra['id']}").status_code == 204
    f = scan["frames"][5]
    assert acct.http.patch(f"/api/frames/{f['id']}", json={"x0": f["x0"] - 4}).status_code == 200
    check({"detected": 6, "aligned": 5, "unexposed": 0, "unmatched_notes": 0})
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{rid}")
        counters = page.get_by_role("region", name="Roll counters", exact=True)
        for text in ("Detected 6", "Aligned 5", "Unexposed 0", "Unmatched notes 0"):
            expect(counters).to_contain_text(text)
        expect(page.get_by_role("list", name="Contact sheet").get_by_role("listitem")).to_have_count(6)
        expect(page.get_by_role("list", name="Shooting log").get_by_role("listitem")).to_have_count(5)
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Archive", exact=True).click()
        card = page.get_by_role("list", name="Rolls").get_by_role("listitem").filter(
            has=page.get_by_role("link", name=roll["name"], exact=True))
        for text in ("Detected 6", "Aligned 5", "Unexposed 0", "Unmatched notes 0"):
            expect(card).to_contain_text(text)


def test_api_concurrent_nudges(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    plan = build_strip([Frame(60), Frame(90), Frame(120)], gap_codes=[(220, 210), (230, 210)])
    scan = ready_scan(acct, roll["id"], plan)
    f1, f2, f3 = scan["frames"]

    def together(calls: list[tuple[str, dict]]) -> list[httpx.Response]:
        gate = threading.Barrier(len(calls))
        clients = [acct.on(app_url) for _ in calls]

        def go(i: int) -> httpx.Response:
            gate.wait()
            return clients[i].patch(f"/api/frames/{calls[i][0]}", json=calls[i][1])

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(go, range(len(calls))))

    answers = together([(f1["id"], {"x1": f1["x1"] + 14}), (f2["id"], {"x0": f2["x0"] - 14})])
    assert sorted(r.status_code for r in answers) == [200, 422], [r.text for r in answers]
    loser = next(r for r in answers if r.status_code == 422)
    assert EDGE_COPY in loser.json()["fields"].values()
    answers = together([(f3["id"], {"x0": f3["x0"] - 5}), (f3["id"], {"x1": f3["x1"] + 5})])
    assert [r.status_code for r in answers] == [200, 200]
    detail = scan_detail(acct.http, scan["id"])
    final = [(f["x0"], f["x1"]) for f in detail["frames"]]
    assert final[2] == (f3["x0"] - 5, f3["x1"] + 5)
    assert final[0][1] + 0 <= final[1][0], "neighbouring frames must not overlap"
    bf = plan.base_fog(final)
    assert abs(detail["base_fog"] - bf) <= 0.006
    for f, (x0, x1) in zip(detail["frames"], final):
        assert abs(f["net_density"] - (plan.frame_gross(x0, x1) - bf)) <= 0.011
    sheet = acct.http.get(f"/api/rolls/{roll['id']}/contact-sheet").json()
    assert sheet["counters"] == recount(sheet)


def slip_expectation(entries: list[dict], scan: dict, ei: int = 100) -> dict:
    frames = {f["number"]: (math.log10(GAP_CODE / code), False) for f, code in zip(scan["frames"], SLIP_CODES)}
    rows = [{"counter": e["counter"], "misfire": e["misfire"],
             "stops": exposure_stops(10, ei, "8", e["shutter"], 1.0)} for e in entries]
    return expected_proposal(rows, frames)


def test_api_alignment_proposal(app_url: str) -> None:
    acct = Account(app_url)
    roll, entries, _, scan = slip_roll(acct)
    exp = slip_expectation(entries, scan)
    assert (exp["offset"], exp["slip"]) == (0, 2)
    r = acct.http.post(f"/api/rolls/{roll['id']}/alignment/proposal", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["proposed_offset"], body["proposed_slip_after"]) == (0, 2)
    assert [c["offset"] for c in body["candidates"]] == [-2, -1, 0, 1, 2]
    for c in body["candidates"]:
        want = exp["plain"][c["offset"]]
        assert (c["rho"] is None) if want is None else abs(c["rho"] - round(want, 4)) <= 1e-4, c
    assert [(c["offset"], c["slip_after"]) for c in body["slip_candidates"]] == sorted(exp["slips"])
    for c in body["slip_candidates"]:
        want = exp["slips"][(c["offset"], c["slip_after"])]
        assert (c["rho"] is None) if want is None else abs(c["rho"] - round(want, 4)) <= 1e-4, c
    stored = acct.http.get(f"/api/rolls/{roll['id']}/alignment").json()
    assert stored["version"] == 0 and stored["proposal"]["proposed_slip_after"] == 2
    straight = make_roll(acct, ei=100)
    shutters = ["1/60", "1/15", "1/250", "1/8", "1/30", "1/500"]
    made = [add_entry(acct, straight["id"], c, s) for c, s in zip(range(2, 8), shutters)]
    made.append(add_entry(acct, straight["id"], 8, "1/4", misfire=True))
    sc = ready_scan(acct, straight["id"], build_strip([Frame(c) for c in [110, 50, 160, 30, 80, 140, 20]]))
    frames = {f["number"]: (f["net_density"], f["unexposed"]) for f in sc["frames"]}
    rows = [{"counter": e["counter"], "misfire": e["misfire"],
             "stops": exposure_stops(10, 100, "8", e["shutter"], 1.0)} for e in made]
    want = expected_proposal(rows, frames)
    body = acct.http.post(f"/api/rolls/{straight['id']}/alignment/proposal", json={}).json()
    assert (body["proposed_offset"], body["proposed_slip_after"]) == (want["offset"], want["slip"])
    got = {c["offset"]: c["rho"] for c in body["candidates"]}
    assert got[want["offset"]] is not None and abs(got[want["offset"]] - round(want["rho"], 4)) <= 1e-3
    tiny = make_roll(acct)
    add_entry(acct, tiny["id"], 1, "1/60")
    add_entry(acct, tiny["id"], 2, "1/30")
    ready_scan(acct, tiny["id"], build_strip([Frame(60), Frame(90)]))
    body = acct.http.post(f"/api/rolls/{tiny['id']}/alignment/proposal", json={}).json()
    assert body["proposed_offset"] is None and all(c["rho"] is None for c in body["candidates"])


def test_api_alignment_save_overrides(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, entries, _, scan = slip_roll(acct)
    rid = roll["id"]
    fr = {f["number"]: f["id"] for f in scan["frames"]}
    en = {e["counter"]: e["id"] for e in entries}
    acct.http.post(f"/api/rolls/{rid}/alignment/proposal", json={})
    r = put_alignment(acct.http, rid, 0, 2, version=0)
    assert r.status_code == 200 and (r.json()["version"], r.json()["source"]) == (1, "proposed")
    got = {e["counter"]: e for e in entries_of(acct.http, rid)}
    assert [got[c]["frame_id"] for c in range(1, 6)] == [fr[1], fr[2], fr[4], fr[5], fr[6]]
    assert {got[c]["match"] for c in got} == {"offset"}
    overrides = [{"entry_id": en[1], "frame_id": fr[3]}, {"entry_id": en[2], "frame_id": fr[4]},
                 {"entry_id": en[5], "frame_id": None}]
    r = put_alignment(acct.http, rid, 0, 2, overrides, version=1)
    assert r.status_code == 200 and r.json()["source"] == "proposed" and r.json()["version"] == 2
    got = {e["counter"]: e for e in entries_of(acct.http, rid)}
    assert (got[1]["frame_id"], got[1]["match"]) == (fr[3], "override")
    assert (got[2]["frame_id"], got[2]["match"]) == (fr[4], "override")
    assert got[3]["frame_id"] is None and got[3]["match"] == "none", "an override claims the frame first"
    assert (got[5]["frame_id"], got[5]["match"]) == (None, "unmatched")
    sheet = acct.http.get(f"/api/rolls/{rid}/contact-sheet").json()
    assert sheet["counters"] == recount(sheet) == {"detected": 6, "aligned": 3, "unexposed": 0, "unmatched_notes": 2}
    for body, field, copy in (
            ({"offset": 3}, "offset", "Offset is a whole number from −2 to +2."),
            ({"slip_after": 99}, "slip_after", "Choose a note on this roll, or no slip."),
            ({"overrides": [{"entry_id": en[1], "frame_id": fr[1]}, {"entry_id": en[1], "frame_id": fr[2]}]},
             "overrides", "Each note and frame can appear once and must belong to this roll.")):
        payload = {"version": 2, "offset": 0, "slip_after": None, "overrides": []} | body
        r = acct.http.put(f"/api/rolls/{rid}/alignment", json=payload)
        assert r.status_code == 422 and r.json()["fields"] == {field: copy}, r.text
    for payload in ({"offset": 0, "overrides": []}, {"version": "2", "offset": 0, "overrides": []}):
        r = acct.http.put(f"/api/rolls/{rid}/alignment", json=payload)
        assert r.status_code == 422 and r.json()["fields"] == {"version": "Reload the alignment before saving."}
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{rid}")
        sheet_items = page.get_by_role("list", name="Contact sheet").get_by_role("listitem")
        third = sheet_items.filter(has=page.get_by_role("link", name=f"Open frame {3}", exact=True))
        expect(third).to_contain_text("Note 1")
        expect(third).to_contain_text("Manual")
        log = page.get_by_role("list", name="Shooting log").get_by_role("listitem")
        expect(log.nth(0)).to_contain_text("Frame 3")
        expect(log.nth(0)).to_contain_text("Manual")
        expect(log.nth(4)).to_contain_text("Marked unmatched")
        expect(log.nth(3)).not_to_contain_text("Manual")
    r = put_alignment(acct.http, rid, 1, None, version=2)
    assert r.status_code == 200 and r.json()["source"] == "manual"
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{rid}")
        log = page.get_by_role("list", name="Shooting log").get_by_role("listitem")
        for i in range(5):
            expect(log.nth(i)).to_contain_text("Manual")


def test_api_states_and_conflicts(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    rid = roll["id"]
    add_entry(acct, rid, 1, "1/60")
    add_entry(acct, rid, 2, "1/30")
    assert acct.http.get(f"/api/rolls/{rid}").json()["state"] == "logging"
    for path in (f"/api/rolls/{rid}/alignment/proposal",):
        assert acct.http.post(path, json={}).json() == {"error": "no_frames"}
    assert put_alignment(acct.http, rid, 0).json() == {"error": "no_frames"}
    sid = upload(acct.http, rid, build_strip([Frame(60), Frame(90)]).data).json()["id"]
    assert acct.http.get(f"/api/rolls/{rid}").json()["state"] == "developed"
    assert acct.http.post(f"/api/scans/{sid}/frames/detect", json={}).json() == {"error": "not_calibrated"}
    assert acct.http.get(f"/api/scans/{sid}/reading", params={"x": 9, "y": 9}).json() == {"error": "not_calibrated"}
    assert acct.http.post(f"/api/scans/{sid}/readings", json={"x": 9, "y": 9}).json() == {"error": "not_calibrated"}
    acct.http.post(f"/api/scans/{sid}/calibration", json={"method": "clear_light", "area": CLEAR_AREA})
    assert scan_detail(acct.http, sid)["state"] == "calibrated"
    r = acct.http.post(f"/api/scans/{sid}/readings", json={"x": 300, "y": 30})
    assert (r.status_code, r.json()) == (409, {"error": "no_frames"})
    assert acct.http.post(f"/api/scans/{sid}/frames/detect", json={}).status_code == 201
    assert scan_detail(acct.http, sid)["state"] == "framed"
    assert acct.http.post(f"/api/scans/{sid}/frames/detect", json={}).json() == {"error": "frames_exist"}
    second = upload(acct.http, rid, build_strip([Frame(70, width=470)]).data, filename="b.png").json()["id"]
    r = put_alignment(acct.http, rid, 0)
    assert (r.status_code, r.json()) == (409, {"error": "unframed_scans"})
    acct.http.post(f"/api/scans/{second}/calibration", json={"method": "clear_light", "area": CLEAR_AREA})
    acct.http.post(f"/api/scans/{second}/frames/detect", json={})
    r = put_alignment(acct.http, rid, 0)
    assert (r.status_code, r.json()) == (409, {"error": "flagged_frames"})
    flagged = scan_detail(acct.http, second)["frames"][0]["id"]
    acct.http.post(f"/api/frames/{flagged}/accept-width", json={})
    assert put_alignment(acct.http, rid, 0).status_code == 200
    assert {scan_detail(acct.http, s)["state"] for s in (sid, second)} == {"aligned"}
    assert acct.http.get(f"/api/rolls/{rid}").json()["state"] == "aligned"
    acct.http.post(f"/api/scans/{sid}/calibration", json={"method": "clear_light", "area": CLEAR_AREA})
    assert scan_detail(acct.http, sid)["state"] == "aligned", "recalibration never moves a scan backwards"
    late = add_entry(acct, rid, 9, "1/125")
    assert acct.http.get(f"/api/rolls/{rid}").json()["state"] == "developed"
    assert put_alignment(acct.http, rid, 0, None, [{"entry_id": late["id"], "frame_id": None}]).status_code == 200
    assert acct.http.get(f"/api/rolls/{rid}").json()["state"] == "aligned"
    test_roll, _, _, _ = bracket_roll(acct, f"States {uuid.uuid4().hex[:6]}", align=False)
    assert acct.http.get(f"/api/rolls/{test_roll['id']}").json()["state"] == "logging"
    assert put_alignment(acct.http, test_roll["id"], 0).status_code == 200
    assert acct.http.get(f"/api/rolls/{test_roll['id']}").json()["state"] == "curve-ready"


def test_alignment_dialog_keyboard(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, _, _, _ = slip_roll(acct)
    acct.http.post(f"/api/rolls/{roll['id']}/alignment/proposal", json={})
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        opener = page.get_by_role("button", name="Override alignment", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Override alignment")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("combobox", name="Offset", exact=True)).to_be_focused()
        assert tab_order(page, 9) == ["Slip after note"] + [f"Frame for note {c}" for c in range(1, 6)] + \
            ["Save alignment", "Cancel", "Offset"]
        page.keyboard.press("Shift+Tab")
        expect(dialog.get_by_role("button", name="Cancel", exact=True)).to_be_focused()
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
    assert acct.http.get(f"/api/rolls/{roll['id']}/alignment").json()["version"] == 0


def test_wf_alignment_propose_override(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, entries, _, scan = slip_roll(acct)
    sentence = "Proposed offset 0, slip after note 2 (ρ 1.00)."
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        page.get_by_role("button", name="Propose alignment", exact=True).click()
        expect(activity(page)).to_have_text(sentence)
        expect(page.get_by_text(sentence, exact=True).first).to_be_visible()
        page.get_by_role("button", name="Override alignment", exact=True).click()
        dialog = page.get_by_role("dialog", name="Override alignment")
        select(dialog.get_by_role("combobox", name=note_frame_name(1), exact=True), "Frame 3")
        dialog.get_by_role("button", name="Save alignment", exact=True).click()
        expect(activity(page)).to_have_text("Alignment saved: 5 notes matched, 0 unmatched.")
        expect(dialog).to_have_count(0)
        expect(page.get_by_role("button", name="Override alignment", exact=True)).to_be_focused()
        third = page.get_by_role("list", name="Contact sheet").get_by_role("listitem").filter(
            has=page.get_by_role("link", name=f"Open frame {3}", exact=True))
        expect(third).to_contain_text("Note 1")
        expect(third).to_contain_text("Manual")
        expect(page.get_by_role("region", name="Roll counters", exact=True)).to_contain_text("Aligned 5")
        expect(page.get_by_text("Aligned", exact=True).first).to_be_visible()
    saved = acct.http.get(f"/api/rolls/{roll['id']}/alignment").json()
    fr = {f["number"]: f["id"] for f in scan["frames"]}
    assert (saved["version"], saved["offset"], saved["slip_after"], saved["source"]) == (1, 0, 2, "proposed")
    assert saved["overrides"] == [{"entry_id": entries[0]["id"], "frame_id": fr[3]}]
    assert acct.http.get(f"/api/rolls/{roll['id']}").json()["state"] == "aligned"


def test_api_alignment_versions(app_url: str) -> None:
    acct = Account(app_url)
    roll, _, _, _ = slip_roll(acct)
    rid = roll["id"]
    gate = threading.Barrier(8)

    def save(i: int) -> httpx.Response:
        client = acct.on(app_url)
        gate.wait()
        return put_alignment(client, rid, i % 3 - 1, None, version=0)

    with ThreadPoolExecutor(max_workers=8) as pool:
        answers = list(pool.map(save, range(8)))
    assert sorted(r.status_code for r in answers) == [200] + [412] * 7
    for r in answers:
        if r.status_code == 412:
            assert r.json() == {"error": "stale_alignment", "version": 1}
    winner = next(r for r in answers if r.status_code == 200).json()
    r = put_alignment(acct.http, rid, 2, None, version=0)
    assert (r.status_code, r.json()) == (412, {"error": "stale_alignment", "version": 1})
    assert acct.http.get(f"/api/rolls/{rid}/alignment").json()["offset"] == winner["offset"]
    acct.http.post(f"/api/rolls/{rid}/alignment/proposal", json={})
    assert acct.http.get(f"/api/rolls/{rid}/alignment").json()["version"] == 1


def test_wf_alignment_stale_tab(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, _, _, _ = slip_roll(acct)
    acct.http.post(f"/api/rolls/{roll['id']}/alignment/proposal", json={})
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}")
        page.get_by_role("button", name="Override alignment", exact=True).click()
        dialog = page.get_by_role("dialog", name="Override alignment")
        expect(dialog).to_be_visible()
        other = page.context.new_page()
        other.goto(f"{app_url}/rolls/{roll['id']}")
        other.get_by_role("button", name="Accept proposed offset", exact=True).click()
        expect(activity(other)).to_have_text("Alignment saved: 5 notes matched, 0 unmatched.")
        select(dialog.get_by_role("combobox", name=note_frame_name(2), exact=True), "Unmatched")
        dialog.get_by_role("button", name="Save alignment", exact=True).click()
        expect(activity(page)).to_have_text("This alignment changed in another tab. Reload it before saving.")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button", name="Save alignment", exact=True)).to_be_focused()
    saved = acct.http.get(f"/api/rolls/{roll['id']}/alignment").json()
    assert saved["version"] == 1 and saved["overrides"] == [] and saved["slip_after"] == 2


def test_api_loupe_reading(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    plan = build_strip([Frame(c) for c in SLIP_CODES[:3]])
    scan = ready_scan(acct, roll["id"], plan, detect=False)
    got = reading(acct.http, scan["id"], 503, 30)
    assert (got["x"], got["y"], got["net"], got["log_h"], got["zone"], got["frame_id"]) == \
        (496, 24, None, None, None, None)
    assert abs(got["gross"] - plan.cell_gross(503, 30)) <= 0.006
    acct.http.post(f"/api/scans/{scan['id']}/frames/detect", json={})
    detail = scan_detail(acct.http, scan["id"])
    got = reading(acct.http, scan["id"], 503, 30)
    owner = next(f for f in detail["frames"] if f["x0"] <= 496 < f["x1"])
    assert got["frame_id"] == owner["id"] and got["calibration_id"] == detail["calibration"]["id"]
    assert abs(got["net"] - (plan.cell_gross(503, 30) - detail["base_fog"])) <= 0.011
    edge = reading(acct.http, scan["id"], plan.width - 1, plan.height - 1)
    assert (edge["x"], edge["y"]) == (8 * ((plan.width - 1) // 8), 8 * ((plan.height - 1) // 8))
    assert abs(edge["gross"] - plan.cell_gross(plan.width - 1, plan.height - 1)) <= 0.006
    for x, y in ((plan.width, 0), (0, plan.height), (0, -1)):
        r = acct.http.get(f"/api/scans/{scan['id']}/reading", params={"x": x, "y": y})
        assert r.status_code == 422 and set(r.json()["fields"].values()) == {"Point is outside the scan."}
    test_roll, entries, plans, scans = bracket_roll(acct, f"Loupe curve {uuid.uuid4().hex[:6]}")
    points = bracket_points(test_roll, entries)
    for number in (2, 5):
        cx, cy = frame_center(scans[0], number)
        got = reading(acct.http, scans[0]["id"], cx, cy)
        net = plans[0].cell_gross(cx, cy) - scans[0]["base_fog"]
        assert abs(got["log_h"] - invert(points, net)) <= 0.011 and got["zone"] == zone_of(points, net), got


def test_wf_loupe_keyboard_sweep(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, _, plan, scan = slip_roll(acct)
    cx, cy = frame_center(scan, 1)
    cell_x, cell_y = 8 * (cx // 8), 8 * (cy // 8)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        readout = page.get_by_role("status", name="Loupe reading", exact=True)
        strip_app(page).focus()
        loupe = page.get_by_role("img", name="Loupe", exact=True)
        expect(loupe).to_be_visible()
        expected = reading(acct.http, scan["id"], cell_x, cell_y)
        expect(readout).to_contain_text(f"x {cell_x} · y {cell_y}")
        expect(readout).to_contain_text(f"Net {fixed(expected['net'])}")
        text = readout.inner_text()
        order = [text.index(f"Net {fixed(expected['net'])}"), text.index(f"Gross {fixed(expected['gross'])}"),
                 text.index("log H —"), text.index(f"x {cell_x} · y {cell_y}")]
        assert order == sorted(order), text
        expect(page.get_by_role("status", name="Curve zone", exact=True)).to_have_text("Zone —")
        page.keyboard.press("ArrowRight")
        expect(readout).to_contain_text(f"x {cell_x + 8} · y {cell_y}")
        page.keyboard.press("Shift+ArrowRight")
        expect(readout).to_contain_text(f"x {cell_x + 72} · y {cell_y}")
        page.keyboard.press("ArrowDown")
        expect(readout).to_contain_text(f"x {cell_x + 72} · y {cell_y + 8}")
        for _ in range(10):
            page.keyboard.press("ArrowUp")
        expect(readout).to_contain_text(f"x {cell_x + 72} · y 0")
        box = loupe.bounding_box()
        assert abs(box["width"] - LOUPE_SIDE_PX) <= 2 and abs(box["height"] - LOUPE_SIDE_PX) <= 2, box
        page.keyboard.press("Escape")
        expect(loupe).to_have_count(0)
        expect(strip_app(page)).to_be_focused()
        tx = plan.frames[3][0] + 200
        page.mouse.move(*point_on_strip(page, scan, tx, 20))
        expect(page.get_by_role("img", name="Loupe", exact=True)).to_be_visible()
        shown = re.search(r"x (\d+) · y (\d+)", readout.inner_text())
        assert shown and abs(int(shown.group(1)) - 8 * (tx // 8)) <= 8, readout.inner_text()


def test_api_pinned_readings(app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct, ei=100)
    entries = [add_entry(acct, roll["id"], c, s, note=f"Pinned {c}") for c, s in ((1, "1/60"), (2, "1/30"), (3, "1/8"))]
    plan = build_strip([Frame(300), Frame(1500), Frame(9000)], depth=16)
    scan = ready_scan(acct, roll["id"], plan)
    assert put_alignment(acct.http, roll["id"], 0).status_code == 200
    cx, cy = frame_center(scan, 1)
    loupe = reading(acct.http, scan["id"], cx, cy)
    assert abs(loupe["gross"] - plan.cell_gross(cx, cy)) <= 0.006, "16-bit samples are read at full depth"
    r = acct.http.post(f"/api/scans/{scan['id']}/readings", json={"x": cx, "y": cy})
    assert r.status_code == 201, r.text
    pin = r.json()
    assert (pin["x"], pin["y"]) == (8 * (cx // 8), 8 * (cy // 8))
    assert (pin["gross"], pin["net"]) == (half_away(loupe["gross"], 2), half_away(loupe["net"], 2))
    assert pin["calibration_id"] == scan["calibration"]["id"] and pin["entry_id"] == entries[0]["id"]
    assert pin["frame_id"] == scan["frames"][0]["id"]
    listed = acct.http.get(f"/api/frames/{scan['frames'][0]['id']}").json()["readings"]
    assert [x["id"] for x in listed] == [pin["id"]]
    gap_x = scan["frames"][0]["x1"] + 4
    r = acct.http.post(f"/api/scans/{scan['id']}/readings", json={"x": gap_x, "y": cy})
    assert r.status_code == 422 and r.json()["fields"] == {"x": "Pin inside a frame."}
    r = acct.http.post(f"/api/scans/{scan['id']}/readings", json={"x": scan["width"], "y": cy})
    assert r.status_code == 422
    other_area = {"x": scan["frames"][0]["x1"] + 4, "y": 16, "w": 16, "h": 16}
    assert acct.http.post(f"/api/scans/{scan['id']}/calibration",
                          json={"method": "clear_light", "area": other_area}).status_code == 201
    assert reading(acct.http, scan["id"], cx, cy)["gross"] != loupe["gross"]
    kept = acct.http.get(f"/api/frames/{scan['frames'][0]['id']}").json()["readings"][0]
    assert {k: kept[k] for k in ("x", "y", "gross", "net", "calibration_id", "entry_id")} == \
        {k: pin[k] for k in ("x", "y", "gross", "net", "calibration_id", "entry_id")}
    assert acct.http.delete(f"/api/entries/{entries[0]['id']}").status_code == 204
    assert acct.http.get(f"/api/frames/{scan['frames'][0]['id']}").json()["readings"][0]["entry_id"] is None


def test_wf_loupe_pin_reading(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, _, _, scan = slip_roll(acct, align=True)
    cx, cy = frame_center(scan, 1)
    expected = reading(acct.http, scan["id"], cx, cy)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        region = page.get_by_role("region", name="Strip", exact=True)
        before = png_pixels(capture(region))
        for x in range(scan["frames"][0]["x0"] + 20, cx, 60):
            page.mouse.move(*point_on_strip(page, scan, x, cy))
        page.mouse.move(*point_on_strip(page, scan, cx, cy))
        expect(page.get_by_role("img", name="Loupe", exact=True)).to_be_visible()
        expect(page.get_by_role("status", name="Loupe reading", exact=True)).to_contain_text(
            f"Net {fixed(expected['net'])}")
        page.mouse.click(*point_on_strip(page, scan, cx, cy))
        expect(activity(page)).to_have_text(f"Pinned net {fixed(expected['net'])} on frame 1.")
        item = page.get_by_role("list", name=readings_name(1), exact=True).get_by_role("listitem")
        expect(item).to_have_count(1, timeout=2000)
        expect(item).to_have_text(f"Net {fixed(expected['net'])} · Gross {fixed(expected['gross'])} · log H — · Zone —")
        expect(page.get_by_role("region", name="Frame 1", exact=True)).to_contain_text(f"{SLIP_NOTE}-{1}")
        page.mouse.move(0, 0)
        expect(page.get_by_role("img", name="Loupe", exact=True)).to_have_count(0)
        after = png_pixels(capture(region))
        changed_rows = sum(1 for a, b in zip(before[3], after[3]) if a != b)
        assert changed_rows > 0, "a pinned reading must draw a marker on the strip"
    stored = acct.http.get(f"/api/frames/{scan['frames'][0]['id']}").json()["readings"]
    assert len(stored) == 1 and stored[0]["net"] == half_away(expected["net"], 2)


def test_negative_tint(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, _, plan, scan = slip_roll(acct)
    with app_page(browser, app_url + "/signin") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        img = png_pixels(capture(strip_app(page)))
        w, h = img[0], img[1]
        for number, code in ((2, SLIP_CODES[1]), (4, SLIP_CODES[3])):
            x0, x1, _ = plan.frames[number - 1]
            sx = int(w * ((x0 + x1) / 2) / plan.width)
            want, wrong = tint(code), tint(CODE_8 - code)
            column = [rgb_at(img, sx, y) for y in range(h)]
            hits = sum(1 for px in column if all(abs(a - b) <= 3 for a, b in zip(px, want)))
            assert hits >= 3, f"frame {number} not drawn as tint({code})={want}; column {column[:: max(1, h // 8)]}"
            assert hits > sum(1 for px in column if all(abs(a - b) <= 3 for a, b in zip(px, wrong)))
        page.mouse.move(*point_on_strip(page, scan, 75, 30))
        loupe = page.get_by_role("img", name="Loupe", exact=True)
        expect(loupe).to_be_visible()
        poll(lambda: abs((loupe.bounding_box() or {"width": 0})["width"] - LOUPE_SIDE_PX) <= 2, 5,
             "loupe never reached 120 px")
        zoom = settled_pixels(loupe)
        dark, light = tint(0), tint(CODE_8)
        pixels = [rgb_at(zoom, x, y) for y in range(zoom[1]) for x in range(zoom[0])]
        near = lambda px, ref: all(abs(a - b) <= 2 for a, b in zip(px, ref))
        two_tone = sum(1 for px in pixels if near(px, dark) or near(px, light))
        assert two_tone >= 0.9 * len(pixels), "loupe pixels must be hard-edged blocks, never blended"
        assert sum(1 for px in pixels if near(px, dark)) >= 0.2 * len(pixels)


def test_loupe_latest_cell_wins(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct)
    plan = build_strip([Frame(40, gradient=True), Frame(60, gradient=True)])
    scan = ready_scan(acct, roll["id"], plan)
    cx, cy = frame_center(scan, 1)
    a = (8 * (cx // 8), 8 * (cy // 8))
    b = (a[0] + 8, a[1])
    c = (a[0] + 16, a[1])
    gross_b = reading(acct.http, scan["id"], *b)["gross"]
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        readout = page.get_by_role("status", name="Loupe reading", exact=True)
        held = hold(page, is_reading)

        def cell_of(route: Route) -> tuple[int, int]:
            q = parse_qs(urlparse(route.request.url).query)
            return 8 * (int(q["x"][0]) // 8), 8 * (int(q["y"][0]) // 8)

        strip_app(page).focus()
        pump(page, lambda: any(cell_of(r) == a for r in held), "focusing the strip requested no reading")
        page.keyboard.press("ArrowRight")
        expect(readout).to_contain_text(f"x {b[0]} · y {b[1]}")
        pump(page, lambda: any(cell_of(r) == b for r in held), "moving the loupe requested no reading")
        expect(readout).to_have_attribute("aria-busy", "true")
        late = [r for r in held if cell_of(r) != b]
        current = next(r for r in held if cell_of(r) == b)
        held.clear()
        current.continue_()
        expect(readout).to_contain_text(f"Gross {fixed(gross_b)}")
        for route in late:
            with page.expect_response(lambda resp: resp.request == route.request):
                route.continue_()
        expect(readout).to_contain_text(f"Gross {fixed(gross_b)}")
        expect(readout).to_contain_text(f"x {b[0]} · y {b[1]}")
        page.keyboard.press("ArrowRight")
        pump(page, lambda: any(cell_of(r) == c for r in held), "no reading requested for the third cell")
        with page.expect_request(lambda req: req.method == "POST" and "/readings" in req.url) as pin_request:
            page.keyboard.press("Enter")
        body = pin_request.value.post_data_json
        assert (8 * (body["x"] // 8), 8 * (body["y"] // 8)) == c, body
        for route in list(held):
            held.remove(route)
            route.fulfill(status=503, json={"error": "storage_unavailable"})
        expect(readout).to_contain_text("Net —")
        expect(readout).to_contain_text("Gross —")
        expect(readout).to_contain_text("log H —")
        expect(page.get_by_role("status", name="Curve zone", exact=True)).to_have_text("Zone —")
        expect(page.get_by_role("list", name=readings_name(1), exact=True).get_by_role("listitem")).to_have_count(1)
    pins = acct.http.get(f"/api/frames/{scan['frames'][0]['id']}").json()["readings"]
    assert [(p["x"], p["y"]) for p in pins] == [c]


def test_loupe_by_touch(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, _, _, scan = slip_roll(acct)
    context = browser.new_context(viewport={"width": 375, "height": 812}, has_touch=True, is_mobile=True)
    page = context.new_page()
    try:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        pins: list[str] = []
        page.on("request", lambda req: pins.append(req.url) if req.method == "POST" and "/readings" in req.url else None)
        target = strip_app(page)
        box = target.bounding_box()

        def at(x: int) -> dict:
            return {"x": box["width"] * (x + 0.5) / scan["width"], "y": box["height"] / 2}

        x1, _ = frame_center(scan, 1)
        x2, _ = frame_center(scan, 2)
        readout = page.get_by_role("status", name="Loupe reading", exact=True)
        target.tap(position=at(x1))
        expect(readout).to_contain_text(f"x {8 * (x1 // 8)} ·")
        target.tap(position=at(x2))
        expect(readout).to_contain_text(f"x {8 * (x2 // 8)} ·")
        assert pins == [], "moving the loupe by tap must not pin"
        target.tap(position=at(x2))
        expect(page.get_by_role("list", name=readings_name(2), exact=True).get_by_role("listitem")).to_have_count(1)
        shown = readout.inner_text()
        before = page.evaluate("window.scrollY")
        cdp = session(page)
        cdp.send("Input.synthesizeScrollGesture", {"x": box["x"] + at(x1)["x"], "y": box["y"] + box["height"] / 2,
                                                   "yDistance": -300, "gestureSourceType": "touch"})
        poll(lambda: page.evaluate("window.scrollY") > before, 5, "a vertical swipe from the strip did not scroll")
        assert readout.inner_text() == shown and len(pins) == 1
    finally:
        context.close()


def test_api_characteristic_curve(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    name = f"Bracket {uuid.uuid4().hex[:6]}"
    roll, entries, _, scans = bracket_roll(acct, name, align=False)
    curve = acct.http.get(f"/api/rolls/{roll['id']}/curve").json()
    assert (curve["ready"], curve["points"], curve["frames_used"], curve["stops_span"]) == (False, [], 0, 0)
    assert curve["speed_point_log_h"] is None and curve["contrast_index"] is None and curve["base_fog"] is None
    pending = make_roll(acct, kind="test", name=f"Waiting {uuid.uuid4().hex[:6]}")
    assert put_alignment(acct.http, roll["id"], 0).status_code == 200
    points = bracket_points(roll, entries)
    curve = acct.http.get(f"/api/rolls/{roll['id']}/curve").json()
    assert curve["ready"] is True and curve["curve_roll_id"] == roll["id"] and curve["meter_bias_stops"] is None
    assert curve["frames_used"] == 9 and curve["stops_span"] == 8.0
    assert len(curve["points"]) == len(points)
    for got, (h, d) in zip(curve["points"], points):
        assert abs(got["log_h"] - h) <= 0.006 and abs(got["net"] - d) <= 0.011
    bf = statistics.median(s["base_fog"] for s in scans)
    assert abs(curve["base_fog"] - bf) <= 0.006
    assert abs(curve["speed_point_log_h"] - speed_point(points)) <= 0.006
    ci = contrast_index(points)
    assert abs(curve["contrast_index"] - ci) <= 0.011
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path="/curves")
        region = page.get_by_role("region", name=f"Curve for {name}", exact=True)
        for text in (f"Base + fog {fixed(bf)}", f"Speed point log H {signed(speed_point(points))}",
                     f"Contrast index {fixed(ci)}", "Frames used 9", "Span 8.0 stops"):
            expect(region).to_contain_text(text)
        expect(page.get_by_role("region", name=f"Curve for {pending['name']}", exact=True)).to_contain_text(
            "Needs at least 7 aligned bracket frames spanning 6 stops (now 0 frames, 0.0 stops).")


def meter_bias_roll(acct: Account, curve_roll_id: str | None) -> tuple[dict, list[dict], dict]:
    roll = make_roll(acct, ei=400, curve_roll_id=curve_roll_id)
    spec = [("1/125", False, 0.30), ("1/60", False, 0.50), ("1/30", False, 0.70), ("1/250", False, 0.20),
            ("1/15", True, 0.90), ("1/500", False, 0.03), ("1/8", False, 1.48)]
    entries = [add_entry(acct, roll["id"], c, s, misfire=m) for c, (s, m, _) in enumerate(spec, start=1)]
    scan = ready_scan(acct, roll["id"], build_strip([Frame(net_code(n)) for _, _, n in spec]))
    assert put_alignment(acct.http, roll["id"], 0).status_code == 200
    return roll, entries, scan


def expected_bias(points: list, roll: dict, entries: list[dict], scan: dict) -> float | None:
    diffs = []
    for e, f in zip(sorted(entries, key=lambda e: e["counter"]), scan["frames"]):
        if e["misfire"] or f["unexposed"]:
            continue
        log_h = invert(points, f["net_density"])
        if log_h is None:
            continue
        diffs.append(log_h / LOG_H_PER_STOP - exposure_stops(10, roll["ei"], "8", e["shutter"], 1.0))
    return half_away(statistics.median(diffs), 1) if diffs else None


def test_api_meter_bias(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    test_roll, t_entries, _, _ = bracket_roll(acct, f"Bias curve {uuid.uuid4().hex[:6]}")
    roll, entries, scan = meter_bias_roll(acct, test_roll["id"])
    points = bracket_points(test_roll, t_entries)
    bias = expected_bias(points, roll, entries, scan)
    curve = acct.http.get(f"/api/rolls/{roll['id']}/curve").json()
    assert curve["curve_roll_id"] == test_roll["id"] and curve["ready"] is True
    assert curve["meter_bias_stops"] == bias, (curve["meter_bias_stops"], bias)
    lone, _, lone_scan = meter_bias_roll(acct, None)
    blank = acct.http.get(f"/api/rolls/{lone['id']}/curve").json()
    assert blank == blank | {"curve_roll_id": None, "ready": False, "points": [], "frames_used": 0,
                             "stops_span": 0, "meter_bias_stops": None}
    waiting = make_roll(acct, kind="test")
    acct.http.patch(f"/api/rolls/{lone['id']}", json={"curve_roll_id": waiting["id"]})
    assert acct.http.get(f"/api/rolls/{lone['id']}/curve").json()["meter_bias_stops"] is None
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        expect(page.get_by_role("region", name="Characteristic curve", exact=True)).to_contain_text(
            f"Meter bias {signed(bias, 1)} stops")
        page.goto(workspace(app_url, lone["id"], lone_scan["id"]))
        expect(page.get_by_role("region", name="Characteristic curve", exact=True)).to_contain_text(
            "No curve yet. Link a curve-ready test roll.")


def test_api_curves_follow_edits(app_url: str) -> None:
    acct = Account(app_url)
    test_roll, t_entries, plans, scans = bracket_roll(acct, f"Edits {uuid.uuid4().hex[:6]}")
    roll, entries, scan = meter_bias_roll(acct, test_roll["id"])
    cx, cy = frame_center(scan, 2)
    pin = acct.http.post(f"/api/scans/{scan['id']}/readings", json={"x": cx, "y": cy}).json()
    tid = test_roll["id"]
    by_counter = {e["counter"]: e for e in t_entries}

    def verify(misfires: set[int], ei: int) -> None:
        current = acct.http.get(f"/api/rolls/{tid}").json()
        assert current["ei"] == ei
        points = bracket_points(current, t_entries, misfires)
        curve = acct.http.get(f"/api/rolls/{tid}/curve").json()
        assert curve["frames_used"] == 9 - len(misfires)
        assert abs(curve["contrast_index"] - contrast_index(points)) <= 0.011
        assert abs(curve["speed_point_log_h"] - speed_point(points)) <= 0.006
        linked = acct.http.get(f"/api/rolls/{roll['id']}/curve").json()
        assert linked["meter_bias_stops"] == expected_bias(points, roll, entries, scan)
        kept = acct.http.get(f"/api/frames/{scan['frames'][1]['id']}").json()["readings"][0]
        assert {k: kept[k] for k in ("x", "y", "gross", "net", "calibration_id", "entry_id")} == \
            {k: pin[k] for k in ("x", "y", "gross", "net", "calibration_id", "entry_id")}
        assert kept["zone"] == zone_of(points, pin["net"])
        assert abs(kept["log_h"] - invert(points, pin["net"])) <= 0.011

    verify(set(), 400)
    acct.http.patch(f"/api/entries/{by_counter[9]['id']}", json={"misfire": True})
    verify({9}, 400)
    assert acct.http.get(f"/api/rolls/{tid}/curve").json()["stops_span"] == 7.0
    acct.http.patch(f"/api/rolls/{tid}", json={"ei": 800})
    verify({9}, 800)
    for c in (1, 2, 3):
        acct.http.patch(f"/api/entries/{by_counter[c]['id']}", json={"misfire": True})
    assert acct.http.get(f"/api/rolls/{tid}").json()["state"] == "logging"
    off = acct.http.get(f"/api/rolls/{roll['id']}/curve").json()
    assert off["ready"] is False and off["meter_bias_stops"] is None and off["curve_roll_id"] == tid
    assert acct.http.get(f"/api/frames/{scan['frames'][1]['id']}").json()["readings"][0]["log_h"] is None
    for c in (1, 2, 3):
        acct.http.patch(f"/api/entries/{by_counter[c]['id']}", json={"misfire": False})
    assert acct.http.get(f"/api/rolls/{tid}").json()["state"] == "curve-ready"
    verify({9}, 800)


def test_wf_test_roll_curve_read(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    name = "Kestrel bracket"
    test_roll, t_entries, _, _ = bracket_roll(acct, name, align=False)
    normal = make_roll(acct, name=f"Harbour {uuid.uuid4().hex[:6]}")
    roll, entries, scan = meter_bias_roll(acct, None)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{test_roll['id']}")
        page.get_by_role("button", name="Propose alignment", exact=True).click()
        expect(activity(page)).to_have_text("Proposed offset 0 (ρ 1.00).")
        page.get_by_role("button", name="Accept proposed offset", exact=True).click()
        expect(activity(page)).to_have_text("Alignment saved: 9 notes matched, 0 unmatched.")
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Curves", exact=True).click()
        points = bracket_points(test_roll, t_entries)
        region = page.get_by_role("region", name=f"Curve for {name}", exact=True)
        expect(region).to_contain_text(f"Contrast index {fixed(contrast_index(points))}")
        expect(region).to_contain_text("Frames used 9")
        page.goto(f"{app_url}/rolls/{roll['id']}/edit")
        select(page.get_by_role("combobox", name="Curve from test roll", exact=True), name)
        page.get_by_role("button", name="Save roll", exact=True).click()
        expect(page).to_have_url(re.compile(rf"/rolls/{roll['id']}$"))
        page.goto(workspace(app_url, roll["id"], scan["id"]))
        bias = expected_bias(points, roll, entries, scan)
        expect(page.get_by_role("region", name="Characteristic curve", exact=True)).to_contain_text(
            f"Meter bias {signed(bias, 1)} stops")
    assert acct.http.get(f"/api/rolls/{roll['id']}").json()["curve_roll_id"] == test_roll["id"]
    assert acct.http.get(f"/api/rolls/{test_roll['id']}").json()["state"] == "curve-ready"
    assert normal["id"]


def test_wf_test_roll_curve_correct(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    name = f"Correct {uuid.uuid4().hex[:6]}"
    test_roll, t_entries, _, _ = bracket_roll(acct, name)
    roll, entries, scan = meter_bias_roll(acct, test_roll["id"])
    cx, cy = frame_center(scan, 1)
    pin = acct.http.post(f"/api/scans/{scan['id']}/readings", json={"x": cx, "y": cy}).json()
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{test_roll['id']}")
        item = page.get_by_role("list", name="Shooting log").get_by_role("listitem").nth(8)
        item.get_by_role("button", name=edit_note_name(9), exact=True).click()
        preview = page.get_by_role("status", name=note_preview_name(9), exact=True)
        item.get_by_label("Shutter", exact=True).fill("1/2")
        stops = exposure_stops(10, 400, "8", "1/2", 1.0)
        expect(preview).to_have_text(f"{signed(stops)} stops · log H {signed(stops * LOG_H_PER_STOP)}")
        item.get_by_label("Shutter", exact=True).fill("1/4")
        item.get_by_label("Misfire", exact=True).check()
        page.get_by_role("button", name=save_note_name(9), exact=True).click()
        expect(activity(page)).to_have_text("Note 9 saved.")
        page.get_by_role("link", name="Edit roll", exact=True).click()
        page.get_by_role("spinbutton", name="EI", exact=True).fill("800")
        page.get_by_role("button", name="Save roll", exact=True).click()
        expect(page).to_have_url(re.compile(rf"/rolls/{test_roll['id']}$"))
        updated = acct.http.get(f"/api/rolls/{test_roll['id']}").json()
        points = bracket_points(updated, t_entries, {9})
        page.goto(f"{app_url}/curves")
        region = page.get_by_role("region", name=f"Curve for {name}", exact=True)
        expect(region).to_contain_text("Frames used 8")
        expect(region).to_contain_text(f"Contrast index {fixed(contrast_index(points))}")
        page.goto(workspace(app_url, roll["id"], scan["id"]))
        expect(page.get_by_role("region", name="Characteristic curve", exact=True)).to_contain_text(
            f"Meter bias {signed(expected_bias(points, roll, entries, scan), 1)} stops")
        expect(page.get_by_role("list", name=readings_name(1), exact=True)).to_contain_text(
            f"Net {fixed(pin['net'])} · Gross {fixed(pin['gross'])}")
    kept = acct.http.get(f"/api/frames/{scan['frames'][0]['id']}").json()["readings"][0]
    assert (kept["gross"], kept["net"], kept["calibration_id"]) == (pin["gross"], pin["net"], pin["calibration_id"])


def test_api_owner_only_derived_surfaces(browser: Browser, app_url: str) -> None:
    mine, theirs = Account(app_url, "mine"), Account(app_url, "theirs")
    mine_note, their_note = uuid.uuid4().hex, uuid.uuid4().hex
    shared = f"Shared bracket {uuid.uuid4().hex[:6]}"
    my_roll, _, _, my_scans = bracket_roll(mine, shared)
    add_entry(mine, make_roll(mine)["id"], 1, "1/125", note=mine_note)
    their_roll, _, _, their_scans = bracket_roll(theirs, shared)
    add_entry(theirs, make_roll(theirs)["id"], 1, "1/125", note=their_note)
    latest = mine.http.get("/api/me").json()["latest_aligned_frame"]
    assert latest["frame_id"] == my_scans[0]["frames"][0]["id"] and latest["scan_id"] == my_scans[0]["id"]
    strongest = max((f for s in my_scans for f in s["frames"]), key=lambda f: f["net_density"])
    assert mine.http.get(f"/api/rolls/{my_roll['id']}").json()["strongest_frame_id"] == strongest["id"]
    assert all(r["id"] != their_roll["id"] for r in mine.http.get("/api/rolls").json()["rolls"])
    r = mine.http.post("/api/rolls", json={"name": "Link", "stock": "Kestrel 400", "format": "35mm", "ei": 400,
                                           "push_pull": 0, "curve_roll_id": their_roll["id"]})
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    normal = make_roll(mine)
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, mine.email, mine.password, next_path=f"/rolls/{normal['id']}/edit")
        options = page.get_by_role("combobox", name="Curve from test roll", exact=True).get_by_role("option")
        expect(options.filter(has_text=shared)).to_have_count(1)
        select(page.get_by_role("combobox", name="Curve from test roll", exact=True), shared)
        page.get_by_role("button", name="Save roll", exact=True).click()
        expect(page).to_have_url(re.compile(rf"/rolls/{normal['id']}$"))
        page.goto(f"{app_url}/curves")
        expect(page.get_by_role("region", name=f"Curve for {shared}", exact=True)).to_have_count(1)
        page.goto(f"{app_url}/log")
        recent = page.get_by_role("list", name="Recent exposures")
        expect(recent).to_contain_text(mine_note)
        expect(recent).not_to_contain_text(their_note)
    assert mine.http.get(f"/api/rolls/{normal['id']}").json()["curve_roll_id"] == my_roll["id"]
    assert their_scans


def test_archive_index(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    empty = Account(app_url, "empty")
    oldest, _, _, scan = slip_roll(acct, name=f"Oldest {uuid.uuid4().hex[:6]}")
    middle = make_roll(acct, name=f"Middle {uuid.uuid4().hex[:6]}", ei=800)
    upload(acct.http, middle["id"], build_strip([Frame(60)]).data)
    newest = make_roll(acct, name=f"Newest {uuid.uuid4().hex[:6]}", stock="Marram 100", ei=100)
    strongest = max(scan["frames"], key=lambda f: f["net_density"])
    assert acct.http.get(f"/api/rolls/{oldest['id']}").json()["strongest_frame_id"] == strongest["id"]
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, empty.email, empty.password)
        expect(page.get_by_text("Your archive is empty. Start a roll before you shoot.", exact=True)).to_be_visible()
        page.get_by_role("button", name="Sign out", exact=True).click()
        ui_signin(page, app_url, acct.email, acct.password)
        items = page.get_by_role("list", name="Rolls").get_by_role("listitem")
        expect(items).to_have_count(3)
        for i, (roll, stock_ei, state) in enumerate(((newest, "Marram 100 · EI 100", "Logging"),
                                                     (middle, "Kestrel 400 · EI 800", "Developed"),
                                                     (oldest, "Kestrel 400 · EI 100", "Developed"))):
            item = items.nth(i)
            expect(item.get_by_role("link", name=roll["name"], exact=True)).to_be_visible()
            expect(item).to_contain_text(stock_ei)
            expect(item).to_contain_text(state)
            counters = acct.http.get(f"/api/rolls/{roll['id']}").json()["counters"]
            sheet = acct.http.get(f"/api/rolls/{roll['id']}/contact-sheet").json()
            assert counters == recount(sheet)
            for label, key in (("Detected", "detected"), ("Aligned", "aligned"), ("Unexposed", "unexposed"),
                               ("Unmatched notes", "unmatched_notes")):
                expect(item).to_contain_text(f"{label} {counters[key]}")
        expect(items.nth(0)).to_contain_text("No strips yet.")
        expect(items.nth(1)).not_to_contain_text("No strips yet.")


@pytest.mark.parametrize("viewport", VIEWPORTS, ids=VIEWPORTS)
def test_strip_workspace_layout(browser: Browser, app_url: str, viewport: str) -> None:
    acct = Account(app_url)
    roll, _, _, scan = slip_roll(acct)
    width, height = VIEWPORT_SIZES[viewport]
    with app_page(browser, app_url + "/signin") as page:
        page.set_viewport_size({"width": width, "height": height})
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{roll['id']}/scans/{scan['id']}")
        strip = page.get_by_role("region", name="Strip", exact=True).bounding_box()
        curve = page.get_by_role("region", name="Characteristic curve", exact=True).bounding_box()
        notes = page.get_by_role("region", name="Shooting notes", exact=True).bounding_box()
        layout(page)
        assert page.evaluate("document.documentElement.scrollWidth") <= width
        assert strip["x"] >= 0 and strip["x"] + strip["width"] <= width
        if viewport == "desktop":
            assert abs(curve["y"] - notes["y"]) <= 2 and curve["y"] < DESKTOP_H and notes["y"] < DESKTOP_H
            assert curve["x"] + curve["width"] <= notes["x"] + 1 and curve["y"] >= strip["y"] + strip["height"] - 1
            assert abs(strip["x"] - curve["x"]) <= 2
            assert abs(strip["x"] + strip["width"] - notes["x"] - notes["width"]) <= 2
            assert curve["width"] > notes["width"]
        else:
            for box in (curve, notes):
                assert abs(box["width"] - strip["width"]) <= 2 and abs(box["x"] - strip["x"]) <= 2
            assert curve["y"] >= strip["y"] + strip["height"] - 1 and notes["y"] >= curve["y"] + curve["height"] - 1
        if viewport == "phone":
            strip_app(page).focus()
            panel = page.get_by_role("status", name="Loupe reading", exact=True)
            expect(panel).to_contain_text("x ")
            box = panel.bounding_box()
            curve = page.get_by_role("region", name="Characteristic curve", exact=True).bounding_box()
            assert strip["y"] + strip["height"] - 1 <= box["y"] and box["y"] + box["height"] <= curve["y"] + 1
            layout(page)


def test_wf_archive_browse_find_frame(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, entries, _, scan = slip_roll(acct, align=True)
    cx, cy = frame_center(scan, 2)
    pin = acct.http.post(f"/api/scans/{scan['id']}/readings", json={"x": cx, "y": cy}).json()
    with app_page(browser, app_url + "/signin") as page:
        ui_signin(page, app_url, acct.email, acct.password)
        page.get_by_role("list", name="Rolls").get_by_role("link", name=roll["name"], exact=True).click()
        page.get_by_role("link", name=open_frame_name(2), exact=True).click()
        expect(page).to_have_url(re.compile(rf"/rolls/{roll['id']}/scans/{scan['id']}\?frame=2$"))
        region = page.get_by_role("region", name="Frame 2", exact=True)
        expect(region).to_be_in_viewport()
        frame_title = uuid.uuid4().hex
        region.get_by_role("textbox", name="Frame title", exact=True).fill(frame_title)
        region.get_by_role("button", name="Save title", exact=True).click()
        expect(activity(page)).to_have_text("Title saved.")
        stops = entries[1]["relative_stops"]
        for text in ("Note 2", "f/8", "1/15", "EV 10", f"{signed(stops)} stops", f"{SLIP_NOTE}-{2}"):
            expect(region).to_contain_text(text)
        expect(region.get_by_role("list", name=readings_name(2), exact=True)).to_contain_text(
            f"Net {fixed(pin['net'])}")
    assert acct.http.get(f"/api/frames/{scan['frames'][1]['id']}").json()["frame"]["title"] == frame_title


def test_wf_archive_browse_saved_link(browser: Browser, app_url: str) -> None:
    acct, other = Account(app_url), Account(app_url, "other")
    roll, _, _, scan = slip_roll(acct)
    foreign = make_roll(other)
    deep = f"/rolls/{roll['id']}/scans/{scan['id']}?frame=3"
    with app_page(browser, app_url + deep) as page:
        expect(page).to_have_url(f"{app_url}/signin?next={quote(deep, safe='')}")
        def signup_links() -> list[str]:
            hrefs = page.get_by_role("link").evaluate_all("els => els.map(e => e.href || '')")
            return [h for h in hrefs if urlparse(h).path.startswith("/signup")]

        poll(lambda: bool(signup_links()), 10, "sign-in page has no link to the sign-up form")
        signup_hrefs = signup_links()
        assert any(parse_qs(urlparse(h).query).get("next") == [deep] for h in signup_hrefs), signup_hrefs
        page.get_by_label("Email", exact=True).fill(acct.email)
        page.get_by_label("Password", exact=True).fill(acct.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page).to_have_url(app_url + deep)
        expect(page.get_by_role("region", name="Frame 3", exact=True)).to_be_in_viewport()
        page.reload()
        expect(page.get_by_role("region", name="Frame 3", exact=True)).to_be_visible()
        page.get_by_role("button", name="Sign out", exact=True).click()
        expect(page).to_have_url(app_url + "/")
        for hostile in ("/" + "/evil.example/x", "/\\evil.example", "https://evil.example/", "/%2F%2Fevil.example",
                        "/archive%01x"):
            ui_signin(page, app_url, acct.email, acct.password, next_path=hostile)
            expect(page).to_have_url(app_url + "/archive")
            page.get_by_role("button", name="Sign out", exact=True).click()
        ui_signin(page, app_url, acct.email, acct.password, next_path=f"/rolls/{foreign['id']}")
        expect(page).to_have_url(f"{app_url}/rolls/{foreign['id']}")
        expect(page.get_by_text("Not in your archive.", exact=True)).to_be_visible()
        page.goto(f"{app_url}/rolls/new")
        page.get_by_role("textbox", name="Roll name", exact=True).fill("Route check")
        page.get_by_role("textbox", name="Stock", exact=True).fill("Kestrel 400")
        select(page.get_by_role("combobox", name="Format", exact=True), "35mm")
        page.get_by_role("spinbutton", name="EI", exact=True).fill("400")
        page.get_by_role("spinbutton", name="Push or pull", exact=True).fill("0")
        page.get_by_role("radio", name="Normal roll", exact=True).check()
        page.get_by_role("button", name="Create roll", exact=True).click()
        expect(page).to_have_url(re.compile(rf"{re.escape(app_url)}/rolls/[0-9a-f-]{{36}}$"))
        created = page.url
        page.reload()
        expect(page.get_by_role("region", name="Roll counters", exact=True)).to_be_visible()
        page.get_by_role("link", name="Edit roll", exact=True).click()
        page.get_by_role("button", name="Save roll", exact=True).click()
        expect(page).to_have_url(created)
        page.get_by_role("button", name="Sign out", exact=True).click()
        page.goto(f"{app_url}/signup?next={quote('/log', safe='')}")
        page.get_by_label("Email", exact=True).fill(f"fresh-{uuid.uuid4().hex[:10]}@edgeprint.test")
        page.get_by_label("Password", exact=True).fill("darkroom-fresh-42")
        page.get_by_role("button", name="Create account", exact=True).click()
        expect(page).to_have_url(app_url + "/log")


def test_health_and_storage_status(app_url: str) -> None:
    started = time.monotonic()
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert (r.status_code, r.json()) == (200, {"status": "ok"}) and time.monotonic() - started <= HEALTH_S
    assert httpx.get(app_url + "/api/storage").json() == {"storage": "ok"}
    down = minio_down_url()
    assert httpx.get(down + "/api/health").json() == {"status": "ok"}
    assert httpx.get(down + "/api/storage").json() == {"storage": "unavailable"}
    assert httpx.get(short_session_url() + "/api/health").json() == {"status": "ok"}


def test_server_boundary(app_url: str) -> None:
    acct = Account(app_url)
    evil = "http://evil.example"
    body = {"name": "Cross", "stock": "Kestrel 400", "format": "35mm", "ei": 400, "push_pull": 0}
    r = acct.http.post("/api/rolls", json=body, headers={"Origin": evil})
    assert (r.status_code, r.json()) == (403, {"error": "cross_origin"})
    r = httpx.post(app_url + "/api/rolls", json=body, headers={"Origin": evil})
    assert (r.status_code, r.json()) == (403, {"error": "cross_origin"})
    assert acct.http.get("/api/rolls").json()["rolls"] == []
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    assert acct.http.post("/api/rolls", json=body, headers={"Origin": origin}).status_code == 201
    assert httpx.get(app_url + "/api/health", headers={"Origin": evil}).status_code == 200
    shell = len(json.dumps(body | {"name": ""}).encode())
    exact = json.dumps(body | {"name": "x" * (JSON_LIMIT - shell)}).encode()
    assert len(exact) == JSON_LIMIT
    r = acct.http.post("/api/rolls", content=exact, headers={"Content-Type": "application/json"})
    assert r.status_code == 422, "a body of exactly the limit is read and validated"
    r = acct.http.post("/api/rolls", content=exact + b" ", headers={"Content-Type": "application/json"})
    assert (r.status_code, r.json()) == (413, {"error": "too_large"})
    r = acct.http.post("/api/rolls", content=json.dumps(body).encode(), headers={"Content-Type": "text/plain"})
    assert (r.status_code, r.json()) == (415, {"error": "unsupported_media_type"})
    for path in ("/run.json", "/.env", "/.venv/pyvenv.cfg", "/static/../run.json",
                 "/requirements.txt"):
        assert httpx.get(app_url + path).status_code == 404, path
    pages = [httpx.get(app_url + p).text for p in ("/", "/signin")] + [acct.http.get("/archive").text]
    assets = {a for text in pages for a in re.findall(r'(?:src|href)="(/[^"#?]+)', text)}
    bodies = pages + [httpx.get(app_url + a).text for a in sorted(assets)]
    for name in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "S3_ENDPOINT"):
        secret = os.environ.get(name)
        if secret:
            assert all(secret not in text for text in bodies), f"{name} leaked to the browser"


ANIMATION_RECORDER = """
(() => {
  window.__motion = [];
  const record = (animation, target) => {
    const timing = animation.effect ? animation.effect.getComputedTiming() : {endTime: 0, iterations: 1};
    window.__motion.push({target, end: timing.endTime, iterations: timing.iterations});
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); record(a, this); return a; };
  const sweep = () => { for (const a of document.getAnimations()) {
    if (!a.__seen) { a.__seen = true; record(a, a.effect && a.effect.target); } } };
  for (const kind of ['animationstart', 'transitionrun', 'transitionstart']) document.addEventListener(kind, sweep, true);
})();
"""
DURATIONS = """el => window.__motion.filter(m => m.target && m.target !== document.body &&
    m.target !== document.documentElement && (m.target === el || el.contains(m.target) || m.target.contains(el)))
    .map(m => m.end)"""
LOOPING = "() => document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"
FRAME_SLACK_MS = 50
SETTLE_MS = 500
SHUTTER_SAMPLER = """
(() => {
  const tracked = new Set();
  const skip = n => !n || n.nodeType !== 1 || n === document.body || n === document.documentElement;
  const track = (n, deep) => { if (skip(n)) return; tracked.add(n);
    if (deep) for (const c of n.querySelectorAll('*')) tracked.add(c); };
  window.__shutter = {on: false, t0: 0, rows: []};
  new MutationObserver(list => { if (!window.__shutter.on) return;
    for (const m of list) { if (m.type === 'attributes') track(m.target, false);
      m.addedNodes.forEach(n => track(n, true)); m.removedNodes.forEach(n => track(n, true)); } })
    .observe(document, {subtree: true, childList: true, attributes: true});
  const sig = n => { const r = n.getBoundingClientRect(), s = getComputedStyle(n);
    return [n.isConnected, Math.round(r.width), Math.round(r.height), s.transform, s.clipPath, s.opacity,
            s.visibility, s.display].join('|'); };
  const tick = () => { const st = window.__shutter;
    if (st.on) { const t = performance.now() - st.t0;
      for (const n of tracked) { const r = n.getBoundingClientRect(); st.rows.push({n, t, s: sig(n), w: r.width}); } }
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__shutterStart = el => { tracked.clear(); window.__shutter = {on: true, t0: performance.now(), rows: []};
    for (let n = el, i = 0; n && i < 3; n = n.parentElement, i++) track(n, i === 0); };
})();
"""
SHUTTER_SPAN = """(el, side) => {
  const mine = r => r.n === el || el.contains(r.n) || (r.n.contains(el) && r.w <= 2 * side);
  const last = new Map(); let span = 0;
  for (const r of window.__shutter.rows.filter(mine)) {
    if (last.get(r.n) !== r.s) { span = Math.max(span, r.t); last.set(r.n, r.s); } }
  return span;
}"""
SHUTTER_ELAPSED = "() => performance.now() - window.__shutter.t0"


def test_wf_cross_cutting_loupe_motion(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll, _, _, scan = slip_roll(acct)
    target = f"/rolls/{roll['id']}/scans/{scan['id']}"
    with app_page(browser, app_url + "/") as page:
        assert page.evaluate(LOOPING) == 0
        ui_signin(page, app_url, acct.email, acct.password)
        page.add_init_script(ANIMATION_RECORDER)
        page.add_init_script(SHUTTER_SAMPLER)
        page.goto(app_url + target)
        expect(strip_app(page)).to_be_visible()
        page.evaluate("window.__motion = []")
        strip_app(page).element_handle().evaluate("el => window.__shutterStart(el)")
        strip_app(page).focus()
        loupe = page.get_by_role("img", name="Loupe", exact=True)
        expect(loupe).to_be_visible()
        handle = loupe.element_handle()
        poll(lambda: abs(loupe.bounding_box()["width"] - LOUPE_SIDE_PX) <= 2, 5, "loupe never reached 120 px")
        poll(lambda: page.evaluate(SHUTTER_ELAPSED) >= SETTLE_MS, 5, "the motion sampler stopped")
        recorded = handle.evaluate(DURATIONS)
        opened = max(recorded) if recorded else handle.evaluate(SHUTTER_SPAN, LOUPE_SIDE_PX)
        slack = 0 if recorded else FRAME_SLACK_MS
        assert LOUPE_OPEN_MIN_MS - slack <= opened <= LOUPE_OPEN_MAX_MS + slack, \
            f"the loupe must open with a shutter of 0.15 to 0.2 s: {recorded or opened}"
        page.evaluate("window.__motion = []")
        handle.evaluate("el => window.__shutterStart(el)")
        page.keyboard.press("Escape")
        expect(loupe).to_have_count(0)
        poll(lambda: page.evaluate(SHUTTER_ELAPSED) >= SETTLE_MS, 5, "the motion sampler stopped")
        recorded = handle.evaluate(DURATIONS)
        closed = max(recorded) if recorded else handle.evaluate(SHUTTER_SPAN, LOUPE_SIDE_PX)
        slack = 0 if recorded else FRAME_SLACK_MS
        assert slack < closed <= LOUPE_CLOSE_MAX_MS + slack and closed < opened, (closed, opened)
        assert page.evaluate(LOOPING) == 0
    with app_page(browser, app_url + "/signin", reduced_motion="reduce") as page:
        ui_signin(page, app_url, acct.email, acct.password)
        page.add_init_script(ANIMATION_RECORDER)
        page.goto(app_url + target)
        page.evaluate("window.__motion = []")
        strip_app(page).focus()
        loupe = page.get_by_role("img", name="Loupe", exact=True)
        expect(loupe).to_be_visible()
        assert abs(loupe.bounding_box()["width"] - LOUPE_SIDE_PX) <= 2, "reduced motion shows the loupe at once"
        assert all(d <= 0 for d in loupe.element_handle().evaluate(DURATIONS))
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("status", name="Loupe reading", exact=True)).to_contain_text("x ")
        page.keyboard.press("Escape")
        expect(loupe).to_have_count(0)
        assert page.evaluate(LOOPING) == 0


def test_wf_cross_cutting_announced_feedback(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    roll = make_roll(acct, name=f"Feedback {uuid.uuid4().hex[:6]}")
    add_entry(acct, roll["id"], 1, "1/125")
    with app_page(browser, app_url + "/signin") as page:
        page.get_by_label("Email", exact=True).fill(acct.email)
        page.get_by_label("Password", exact=True).fill("wrong-password-1")
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(activity(page)).to_have_text("Email or password is wrong.")
        held = hold(page, lambda req: req.method == "POST" and req.url.endswith("/api/auth/signin"))
        page.get_by_label("Password", exact=True).fill(acct.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        pump(page, lambda: len(held) == 1, "Sign in sent no request")
        expect(activity(page)).to_have_text(f"Signing in{ELLIPSIS}")
        held.pop().continue_()
        expect(page).to_have_url(re.compile(r"/archive$"))
        page.unroute("**/api/**")
        page.goto(f"{app_url}/rolls/new")
        page.get_by_role("textbox", name="Roll name", exact=True).fill("Feedback roll")
        page.get_by_role("textbox", name="Stock", exact=True).fill("Kestrel 400")
        select(page.get_by_role("combobox", name="Format", exact=True), "35mm")
        page.get_by_role("spinbutton", name="Push or pull", exact=True).fill("0")
        page.get_by_role("radio", name="Normal roll", exact=True).check()
        ei = page.get_by_role("spinbutton", name="EI", exact=True)
        ei.fill("5")
        page.get_by_role("button", name="Create roll", exact=True).click()
        expect(page.get_by_text("EI is a whole number from 6 to 12800.", exact=True).first).to_be_visible()
        expect(ei).to_have_attribute("aria-invalid", "true")
        expect(ei).to_be_focused()
        expect(activity(page)).to_have_text("EI is a whole number from 6 to 12800.")
        ei.fill("400")
        held = hold(page, lambda req: req.method == "POST" and req.url.endswith("/api/rolls"))
        page.get_by_role("button", name="Create roll", exact=True).click()
        pump(page, lambda: len(held) == 1, "Create roll sent no request")
        expect(activity(page)).to_have_text(f"Saving roll{ELLIPSIS}")
        held.pop().continue_()
        expect(page).to_have_url(re.compile(r"/rolls/[0-9a-f-]{36}$"))
        expect(activity(page)).to_have_text("Roll saved.")
        page.unroute("**/api/**")
        page.goto(f"{app_url}/log")
        select(page.get_by_role("combobox", name="Roll", exact=True), roll["name"])
        page.get_by_role("spinbutton", name="Counter", exact=True).fill("1")
        page.get_by_role("textbox", name="Shutter", exact=True).fill("1/60")
        page.get_by_role("spinbutton", name="Metered EV", exact=True).fill("9")
        held = hold(page, lambda req: req.method == "POST" and "/entries" in req.url)
        page.get_by_role("button", name="Log exposure", exact=True).click()
        pump(page, lambda: len(held) == 1, "Log exposure sent no request")
        expect(activity(page)).to_have_text(f"Logging{ELLIPSIS}")
        held.pop().continue_()
        expect(activity(page)).to_have_text("Counter 1 is already logged on this roll.")
    base = minio_down_url()
    with app_page(browser, base + "/signin") as page:
        ui_signin(page, base, acct.email, acct.password)
        alert = page.get_by_role("alert")
        expect(alert).to_have_text(re.compile(re.escape(BANNER)))
        expect(alert.get_by_role("button", name="Check again", exact=True)).to_be_visible()
    assert len(entries_of(acct.http, roll["id"])) == 1


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip(), key
    assert ".venv" in manifest["install"]
    for key in ("build", "serve"):
        assert ".venv/bin/" in manifest[key], f"{key} must call a tool inside /app/.venv"


def test_if_notices_name_shipped_packages() -> None:
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text().lower()
    norm = re.sub(r"[-_.]+", "-", text)
    assert FONT_NAME.lower() in text
    missing = [p.name for p in shipped_packages() if re.sub(r"[-_.]+", "-", p.name.lower()) not in norm]
    assert missing == [], f"packages missing from notices: {missing}"


def test_if_licences_allowed() -> None:
    allowed = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "PSF-2.0", "HPND", "MIT-CMU",
               "LGPL-3.0-or-later", "OFL-1.1"}
    aliases = {"LGPL with exceptions": "LGPL-3.0-or-later"}
    bad = [(p.name, p.licence) for p in shipped_packages()
           if not licence_allowed(aliases.get(p.licence, p.licence), allowed)]
    assert bad == [], bad
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    font_line = next(line for line in text.splitlines() if FONT_NAME.lower() in line.lower() or "OFL" in line)
    assert "OFL" in text and font_line


def test_if_only_provided_datastores(app_url: str) -> None:
    found = [str(p) for pattern in ("*.sqlite", "*.sqlite3", "*.db", "*.db-journal")
             for p in Path("/app").rglob(pattern) if ".venv" not in p.parts]
    assert found == [], found
    acct = Account(app_url)
    make_roll(acct)
    assert Postgres().tables(), "the app keeps its records in the provided PostgreSQL"
    roll = acct.http.get("/api/rolls").json()["rolls"][0]
    assert S3().keys(f"originals/{acct.id}/") == [] and roll["id"]


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    acct = Account(app_url)
    with app_page(browser, app_url + "/") as page:
        seen: list[str] = []
        page.on("request", lambda req: seen.append(req.url))
        page.reload()
        ui_signin(page, app_url, acct.email, acct.password)
        page.goto(app_url + "/archive")
        poll(lambda: page.evaluate("document.fonts.ready.then(() => document.fonts.check('16px \"Host Grotesk\"'))"),
             10, "Host Grotesk never loaded on the archive")
        assert "Host Grotesk" in style(page)
        foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert foreign == [], foreign


def style(page: Page) -> str:
    return page.evaluate("getComputedStyle(document.body).fontFamily")


def test_if_services_unchanged(app_url: str) -> None:
    assert Postgres().rows("SELECT 1 AS one") == [{"one": 1}]
    assert isinstance(S3().keys("originals/"), list)
    assert httpx.get(minio_down_url() + "/api/storage").json() == {"storage": "unavailable"}
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    assert client.post("/api/auth/signin", json={"email": "teo@edgeprint.test",
                                                 "password": "safelight-teo-42"}).status_code == 200
    assert "Allotment" in [r["name"] for r in client.get("/api/rolls").json()["rolls"]]
