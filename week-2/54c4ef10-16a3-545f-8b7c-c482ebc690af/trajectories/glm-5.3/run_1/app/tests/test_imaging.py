#!/usr/bin/env python3
"""Smoke tests for the imaging decoders; development only, not shipped."""
import io
import struct
import sys
import zlib

import numpy as np
from PIL import Image

sys.path.insert(0, "/app")
from edgeprint.imaging import ScanRefused, decode_scan  # noqa: E402
from edgeprint.imaging.base import (MSG_DIMENSIONS, MSG_PIXEL_FORMAT,  # noqa: E402
                                    MSG_TIFF_LAYOUT, MSG_UNREADABLE)


def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)


ADAM7 = ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
         (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2))


def make_png(width, height, arr, depth=8, interlace=0, colour=0, extra=()):
    raw = io.BytesIO()
    be = ">u2" if depth == 16 else "u1"
    if interlace == 0:
        for y in range(height):
            raw.write(b"\x00" + arr[y].astype(be).tobytes())
    else:
        for xs, ys, xd, yd in ADAM7:
            pw = 0 if width <= xs else (width - xs + xd - 1) // xd
            ph = 0 if height <= ys else (height - ys + yd - 1) // yd
            if pw == 0 or ph == 0:
                continue
            for py in range(ph):
                raw.write(b"\x00" + arr[ys + py * yd, xs:xs + pw * xd:xd].astype(be).tobytes())
    out = b"\x89PNG\r\n\x1a\n" + chunk(
        b"IHDR", struct.pack(">IIBBBBB", width, height, depth, colour, 0, 0, interlace))
    for t, d in extra:
        out += chunk(t, d)
    return out + chunk(b"IDAT", zlib.compress(raw.getvalue(), 9)) + chunk(b"IEND", b"")


def make_tiff(arr, photometric=1, extra=()):
    h, w = arr.shape
    pixels = arr.tobytes()
    ifd = [(256, 3, 1, w), (257, 3, 1, h), (258, 3, 1, 8), (259, 3, 1, 1),
           (262, 3, 1, photometric), (277, 3, 1, 1), (278, 3, 1, h),
           (279, 4, 1, len(pixels)), (273, 4, 1, 0)]
    ifd += list(extra)
    ifd.sort(key=lambda t: t[0])
    n = len(ifd)
    body = b"".join(struct.pack("<HHI", t, ft, 1) + struct.pack("<H", v) + b"\x00\x00"
                    for t, ft, _, v in ifd) + struct.pack("<I", 0)
    head = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", n) + body
    pixels_offset = len(head)
    fixed = bytearray(head)
    for i, (t, ft, _, v) in enumerate(ifd):
        if t == 273:
            at = 8 + 2 + 12 * i + 8
            struct.pack_into("<I", fixed, at, pixels_offset)
    return bytes(fixed) + pixels


w, h = 100, 80
rng = np.random.default_rng(3)
arr16 = rng.integers(0, 65536, (h, w)).astype(np.uint16)
arr8 = rng.integers(0, 256, (h, w)).astype(np.uint8)
results = []


def check(name, ok):
    results.append((name, bool(ok)))


def refuse(name, blob, message):
    try:
        decode_scan(blob)
        check(name, False)
    except ScanRefused as e:
        check(name, e.message == message)


base16 = make_png(w, h, arr16, depth=16)
d = decode_scan(base16)
check("png16", d.codes.dtype == np.uint16 and np.array_equal(d.codes[:, :, 0], arr16))
check("png16-linear", d.transfer == "linear")
check("png8", np.array_equal(decode_scan(make_png(w, h, arr8)).codes[:, :, 0], arr8))
check("png-srgb", decode_scan(make_png(w, h, arr16, depth=16, extra=[(b"sRGB", b"\x00")])).transfer == "srgb")
g = decode_scan(make_png(w, h, arr16, depth=16, extra=[(b"gAMA", struct.pack(">I", 45455))]))
check("png-gamma", g.transfer == "gamma" and round(g.gamma, 5) == 0.45455)
check("png-srgb-wins", decode_scan(make_png(w, h, arr16, depth=16, extra=[
    (b"gAMA", struct.pack(">I", 45455)), (b"sRGB", b"\x00")])).transfer == "srgb")
check("png-adam7-16", np.array_equal(decode_scan(make_png(w, h, arr16, depth=16, interlace=1)).codes[:, :, 0], arr16))
check("png-adam7-8", np.array_equal(decode_scan(make_png(w, h, arr8, depth=8, interlace=1)).codes[:, :, 0], arr8))
srgb = decode_scan(make_png(w, h, arr16, depth=16, extra=[(b"sRGB", b"\x00")]))
lin = srgb.linear()
c = arr16[0, 0] / 65535
expected = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
check("srgb-linearisation", abs(float(lin[0, 0, 0]) - expected) < 1e-6)
check("png-rgba", decode_scan(make_png(w, h, np.dstack([arr8] * 4), colour=6)).channels == 4)
check("png-ga", decode_scan(make_png(w, h, np.dstack([arr8, np.full_like(arr8, 255)]), colour=4)).channels == 2)
check("png-rgb", np.array_equal(decode_scan(make_png(w, h, np.dstack([arr8] * 3), colour=2)).codes[:, :, :3], np.dstack([arr8] * 3)))

refuse("png-palette", make_png(w, h, arr8, colour=3), MSG_PIXEL_FORMAT)
refuse("png-bad-crc", make_png(w, h, arr8)[:40] + bytes([make_png(w, h, arr8)[40] ^ 1]) + make_png(w, h, arr8)[41:], MSG_UNREADABLE)


def sized_png(width, height):
    body = io.BytesIO()
    for _ in range(height):
        body.write(b"\x00" + b"\x00" * width)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(body.getvalue()))
            + chunk(b"IEND", b""))


refuse("png-oversize", sized_png(20001, 100), MSG_DIMENSIONS)
refuse("png-underwidth", sized_png(63, 100), MSG_DIMENSIONS)
refuse("png-overheight", sized_png(100, 4001), MSG_DIMENSIONS)
check("png-at-limits", decode_scan(sized_png(64, 64)).width == 64)
refuse("png-no-idat", b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IEND", b""), MSG_UNREADABLE)
refuse("png-oversize-text", make_png(w, h, arr8, extra=[(b"zTXt", b"note\x00\x00" + zlib.compress(b"x" * 2_000_000))]), MSG_UNREADABLE)
check("png-text-ok", decode_scan(make_png(w, h, arr8, extra=[(b"zTXt", b"note\x00\x00" + zlib.compress(b"x" * 500))])).width == w)
gap = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(b"\x00" + arr8[0].tobytes()))
       + chunk(b"tEXt", b"a\x00b")
       + chunk(b"IDAT", zlib.compress(b"\x00" + arr8[1].tobytes()))
       + chunk(b"IEND", b""))
refuse("png-idat-gap", gap, MSG_UNREADABLE)
wide = rng.integers(0, 256, (700, 900)).astype(np.uint8)
trunc = make_png(900, 700, wide)
refuse("png-truncated", trunc[:len(trunc) // 2], MSG_UNREADABLE)

check("tiff-grey", np.array_equal(decode_scan(make_tiff(arr8)).codes[:, :, 0], arr8))
refuse("tiff-white-zero", make_tiff(arr8, photometric=0), MSG_PIXEL_FORMAT)
refuse("tiff-float", make_tiff(arr8, extra=[(339, 3, 1, 3)]), MSG_PIXEL_FORMAT)
refuse("tiff-planar", make_tiff(arr8, extra=[(284, 3, 1, 2)]), MSG_TIFF_LAYOUT)
refuse("tiff-predictor", make_tiff(arr8, extra=[(317, 3, 1, 2)]), MSG_TIFF_LAYOUT)
refuse("tiff-jpeg", make_tiff(arr8, extra=[(259, 3, 1, 7)]), MSG_TIFF_LAYOUT)
refuse("tiff-tiled", make_tiff(arr8, extra=[(322, 3, 1, 64)]), MSG_TIFF_LAYOUT)
im1 = Image.fromarray(arr8)
im2 = Image.fromarray(np.full_like(arr8, 9))
buf = io.BytesIO()
im1.save(buf, format="TIFF", save_all=True, append_images=[im2])
refuse("tiff-multipage", buf.getvalue(), MSG_TIFF_LAYOUT)
buf = io.BytesIO()
Image.fromarray(arr8).save(buf, format="TIFF", compression="tiff_lzw")
check("tiff-lzw", np.array_equal(decode_scan(buf.getvalue()).codes[:, :, 0], arr8))
buf = io.BytesIO()
Image.fromarray(arr8).save(buf, format="TIFF", compression="tiff_adobe_deflate")
check("tiff-deflate", np.array_equal(decode_scan(buf.getvalue()).codes[:, :, 0], arr8))

grey = decode_scan(make_png(w, h, arr8)).grey_codes()
check("grey-codes", np.array_equal(grey, arr8))
slices = decode_scan(make_png(w, h, arr8)).preview_slices()
check("preview-slices", len(slices) == 1 and all(s.startswith(b"\x89PNG") for s in slices))
refuse("unknown-format", b"JFIF" + b"\x00" * 200, MSG_UNREADABLE)

failed = [name for name, ok in results if not ok]
for name, ok in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
