#!/usr/bin/env python3
"""Crafted scans refused within 5 seconds, while health stays under 1 second."""
import hashlib
import io
import struct
import sys
import time
import zlib

import numpy as np
from PIL import Image

sys.path.insert(0, "/app")
from test_api import call, check, FAILURES  # noqa: E402


def chunk(t, d):
    return (struct.pack(">I", len(d)) + t + d
            + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF))


def png_header_only(width, height, depth=8, colour=0, interlace=0):
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, depth, colour,
                                        0, 0, interlace))
            + chunk(b"IDAT", zlib.compress(b"\x00" * (height * (1 + width * colour_channels(colour) * depth // 8))))
            + chunk(b"IEND", b""))


def colour_channels(colour):
    return {0: 1, 2: 3, 4: 2, 6: 4, 3: 1}.get(colour, 1)


def upload(roll_id, blob, name):
    sha = hashlib.sha256(blob).hexdigest()
    return call("POST", f"/api/rolls/{roll_id}/scans?dpi=1200&first_edge=1&filename={name}",
                raw=blob, headers={"X-Scan-Size": str(len(blob)), "X-Scan-SHA256": sha})


def main():
    status, _ = call("POST", "/api/auth/signin",
                     {"email": "ines@edgeprint.test", "password": "safelight-ines-42"})
    check("signin", status == 200)
    status, roll = call("POST", "/api/rolls", {
        "name": "Crafted run", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal"})
    check("create roll", status == 201)

    cases = []

    # A palette PNG.
    pal = Image.fromarray(np.zeros((64, 64), dtype=np.uint8), mode="L").convert("P")
    buf = io.BytesIO(); pal.save(buf, format="PNG")
    cases.append(("palette PNG", buf.getvalue(),
                  "Use 8- or 16-bit greyscale or RGB."))

    # A multi-page TIFF.
    im1 = Image.fromarray(np.zeros((64, 64), dtype=np.uint8), mode="L")
    im2 = Image.fromarray(np.full((64, 64), 9, dtype=np.uint8), mode="L")
    buf = io.BytesIO()
    im1.save(buf, format="TIFF", save_all=True, append_images=[im2])
    cases.append(("multi-page TIFF", buf.getvalue(),
                  "TIFF scans must hold one striped image, uncompressed or LZW- or Deflate-compressed."))

    # A tiled TIFF.
    cases.append(("tiled TIFF", make_tiled_tiff(),
                  "TIFF scans must hold one striped image, uncompressed or LZW- or Deflate-compressed."))

    # A PNG declaring huge dimensions.
    cases.append(("oversize PNG", png_header_only(30000, 100),
                  "Scans are limited to 20,000 × 4,000 pixels and 40,000,000 pixels in total."))

    # A PNG whose IDAT inflates far past its header's implied byte count.
    cases.append(("inflating IDAT", make_inflating_png(),
                  "This file could not be read as an image."))

    # A TIFF whose strip offsets point past the end of the file.
    cases.append(("bad strip offsets", make_bad_offsets_tiff(),
                  "This file could not be read as an image."))

    # A PNG with a broken chunk CRC.
    good = png_header_only(100, 64)
    broken = bytearray(good)
    broken[-5] ^= 0xFF
    cases.append(("bad CRC", bytes(broken),
                  "This file could not be read as an image."))

    # Not an image at all.
    cases.append(("unknown format", b"GIF89a" + b"\x00" * 200, None))

    for name, blob, message in cases:
        started = time.time()
        status, body = upload(roll["id"], blob, name.replace(" ", "-") + ".png")
        elapsed = time.time() - started
        refused = status in (413, 415, 422)
        ok_message = message is None or (refused and body.get("fields", {}).get("file") == message)
        check(f"{name} refused in {elapsed:.2f}s",
              refused and ok_message and elapsed < 5.0,
              f"status={status} body={str(body)[:160]}")

    # Health stayed under a second.
    started = time.time()
    status, _ = call("GET", "/api/health")
    elapsed = time.time() - started
    check("health under 1s", status == 200 and elapsed < 1.0, f"{elapsed:.2f}s")

    # Nothing was written for the refused uploads.
    status, body = call("GET", f"/api/rolls/{roll['id']}/scans")
    check("nothing stored", len(body.get("scans", [])) == 0, str(body)[:200])

    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    return 1 if FAILURES else 0


def make_tiled_tiff():
    width = height = 64
    pixels = np.zeros((height, width), dtype=np.uint8).tobytes()
    ifd = [(256, 4, 1, width), (257, 4, 1, height), (258, 3, 1, 8),
           (259, 3, 1, 1), (262, 3, 1, 1), (277, 3, 1, 1),
           (322, 3, 1, 64), (323, 3, 1, 64), (324, 4, 1, 0), (325, 4, 1, len(pixels))]
    ifd.sort(key=lambda t: t[0])
    body = b"".join(struct.pack("<HHI", t, ft, 1) + struct.pack("<H", v) + b"\x00\x00"
                    for t, ft, _, v in ifd) + struct.pack("<I", 0)
    head = bytearray(b"II*\x00" + struct.pack("<I", 8)
                     + struct.pack("<H", len(ifd)) + body)
    for i, (t, ft, _, v) in enumerate(ifd):
        if t == 324:
            struct.pack_into("<I", head, 8 + 2 + 12 * i + 8, len(head))
    return bytes(head) + pixels


def make_inflating_png():
    # 64x64 image whose IDAT holds a huge inflated stream.
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00" + b"\x11" * 200000, 9))
            + chunk(b"IEND", b""))


def make_bad_offsets_tiff():
    width = height = 64
    pixels = np.zeros((height, width), dtype=np.uint8).tobytes()
    ifd = [(256, 3, 1, width), (257, 3, 1, height), (258, 3, 1, 8),
           (259, 3, 1, 1), (262, 3, 1, 1), (277, 3, 1, 1), (278, 3, 1, height),
           (279, 4, 1, len(pixels)), (273, 4, 1, 0)]
    ifd.sort(key=lambda t: t[0])
    body = b"".join(struct.pack("<HHI", t, ft, 1) + struct.pack("<H", v) + b"\x00\x00"
                    for t, ft, _, v in ifd) + struct.pack("<I", 0)
    head = bytearray(b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", len(ifd)) + body)
    for i, (t, ft, _, v) in enumerate(ifd):
        if t == 273:
            struct.pack_into("<I", head, 8 + 2 + 12 * i + 8, 999999999)
    return bytes(head) + pixels


if __name__ == "__main__":
    sys.exit(main())
