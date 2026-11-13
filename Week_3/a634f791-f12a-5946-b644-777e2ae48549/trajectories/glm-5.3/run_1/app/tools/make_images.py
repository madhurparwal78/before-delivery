"""Generate every image the app serves, as original geometric artwork.

Uses only the Python standard library: a minimal PNG writer and simple
procedural drawing, so every shipped image is original work with no
third-party rights. Run: python tools/make_images.py
"""

from __future__ import annotations

import hashlib
import os
import struct
import zlib

WIDTH = 1200
HEIGHT = 800
PORTRAIT_SIZE = 600


def write_png(path: str, width: int, height: int, pixels: list) -> None:
    """A minimal PNG writer: 8-bit RGB, no interlace."""
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for rgb in row:
            raw.extend(rgb)
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    payload = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
               + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
               + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(payload)


def canvas(width: int, height: int, colour):
    return [[colour for _ in range(width)] for _ in range(height)]


def blend(base, top, alpha):
    return tuple(round(b * (1 - alpha) + t * alpha) for b, t in zip(base, top))


def draw_rect(pixels, x, y, w, h, colour, alpha=1.0):
    height, width = len(pixels), len(pixels[0])
    for yy in range(max(0, y), min(height, y + h)):
        for xx in range(max(0, x), min(width, x + w)):
            pixels[yy][xx] = blend(pixels[yy][xx], colour, alpha)


def draw_circle(pixels, cx, cy, r, colour, alpha=1.0):
    height, width = len(pixels), len(pixels[0])
    for yy in range(max(0, cy - r), min(height, cy + r)):
        for xx in range(max(0, cx - r), min(width, cx + r)):
            dx, dy = xx - cx, yy - cy
            if dx * dx + dy * dy <= r * r:
                pixels[yy][xx] = blend(pixels[yy][xx], colour, alpha)


def draw_line(pixels, x0, y0, x1, y1, thickness, colour, alpha=1.0):
    steps = max(abs(x1 - x0), abs(y1 - y0)) * 2 + 1
    for i in range(steps):
        t = i / (steps - 1)
        x = round(x0 + (x1 - x0) * t)
        y = round(y0 + (y1 - y0) * t)
        draw_rect(pixels, x - thickness // 2, y - thickness // 2,
                  thickness, thickness, colour, alpha)


def rng(seed: str):
    """A deterministic hash-based generator, so images are reproducible."""
    state = int.from_bytes(hashlib.sha256(seed.encode()).digest()[:8], "big")
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) / (2 ** 31)


# ---------------------------------------------------------------- palettes

PAPER = (247, 242, 233)
INK = (38, 34, 30)
GREY = (98, 92, 86)
LIME = (204, 224, 163)
TEAL = (64, 124, 124)
BRICK = (166, 82, 68)


def home_texture(path: str) -> None:
    """A decorative paper texture: quiet concentric arcs and hairlines."""
    pixels = canvas(WIDTH, HEIGHT, PAPER)
    draw = rng("home-texture")
    for i in range(60):
        r = 120 + i * 20
        alpha = 0.04 + next(draw) * 0.05
        colour = GREY if i % 3 else INK
        for yy in range(HEIGHT):
            dx = 140
            dy = yy - HEIGHT // 2
            d = (dx * dx + dy * dy) ** 0.5
            if abs(d - r) < 1.2:
                for xx in range(0, WIDTH, 2):
                    pixels[yy][xx] = blend(pixels[yy][xx], colour, alpha)
    write_png(path, WIDTH, HEIGHT, pixels)


def portrait(path: str, seed: str, accent) -> None:
    """A reference manager's portrait: an abstract figure on paper."""
    size = PORTRAIT_SIZE
    pixels = canvas(size, size, PAPER)
    draw = rng(seed)
    draw_rect(pixels, 0, 0, size, size, (240, 235, 226), 1.0)
    draw_circle(pixels, size // 2, size // 3, int(size * 0.18), INK, 0.85)
    draw_circle(pixels, size // 2, size // 3, int(size * 0.15), GREY, 0.35)
    for i in range(int(size * 0.60), size):
        t = (i - size * 0.60) / (size * 0.40)
        half = int(size * (0.16 + 0.30 * min(t, 1.0)))
        draw_rect(pixels, size // 2 - half, i, half * 2, 1, INK, 0.75)
    for band in range(3):
        y = int(size * (0.72 + band * 0.06))
        draw_rect(pixels, 0, y, size, 6, accent, 0.5)
    for dot in range(24):
        x = int(next(draw) * size)
        y = int(next(draw) * size)
        draw_circle(pixels, x, y, 2 + int(next(draw) * 3), accent, 0.35)
    write_png(path, size, size, pixels)


def story_image(path: str, seed: str, accent) -> None:
    """An installation photograph: an industrial scene in flat geometry."""
    pixels = canvas(WIDTH, HEIGHT, PAPER)
    draw = rng(seed)
    horizon = int(HEIGHT * 0.62)
    draw_rect(pixels, 0, 0, WIDTH, horizon, (238, 233, 224), 1.0)
    x = 0
    while x < WIDTH:
        w = 60 + int(next(draw) * 140)
        h = 60 + int(next(draw) * 220)
        draw_rect(pixels, x, horizon - h, w, h, INK, 0.8)
        x += w + int(next(draw) * 40)
    for i in range(3):
        x0 = int(next(draw) * WIDTH)
        draw_line(pixels, x0, horizon - 200, x0 + 200, horizon - 200, 6, INK, 0.7)
        draw_line(pixels, x0, horizon - 200, x0, horizon, 6, INK, 0.7)
    draw_rect(pixels, 0, horizon, WIDTH, HEIGHT - horizon, (232, 226, 216), 1.0)
    for line in range(10):
        y = int(HEIGHT * (0.62 + 0.38 * line / 10))
        draw_rect(pixels, 0, y, WIDTH, 2, GREY, 0.25)
    for dot in range(16):
        x = int(next(draw) * WIDTH)
        y = int(horizon - next(draw) * 260)
        draw_circle(pixels, x, y, 4 + int(next(draw) * 4), accent, 0.8)
    write_png(path, WIDTH, HEIGHT, pixels)


def social_card(path: str) -> None:
    """The social preview image carried in a reference page's head."""
    pixels = canvas(1200, 630, PAPER)
    draw_rect(pixels, 0, 0, 1200, 90, INK, 1.0)
    draw_rect(pixels, 0, 90, 1200, 6, LIME, 1.0)
    for i in range(7):
        draw_rect(pixels, 80 + i * 160, 200, 90, 220, INK, 0.12)
    draw_rect(pixels, 80, 470, 520, 12, INK, 0.7)
    draw_rect(pixels, 80, 500, 420, 12, INK, 0.4)
    draw_rect(pixels, 80, 530, 340, 12, INK, 0.2)
    write_png(path, 1200, 630, pixels)


def main() -> None:
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "static", "img")
    os.makedirs(out, exist_ok=True)
    home_texture(os.path.join(out, "home-texture.png"))
    managers = [
        ("portrait-aino-rask.png", "aino-rask", TEAL),
        ("portrait-mikael-soderholm.png", "mikael-soderholm", BRICK),
        ("portrait-leena-varjo.png", "leena-varjo", TEAL),
        ("portrait-tomas-brandt.png", "tomas-brandt", BRICK),
        ("portrait-iiris-kallio.png", "iiris-kallio", TEAL),
        ("portrait-joonas-hirvi.png", "joonas-hirvi", BRICK),
    ]
    for filename, seed, accent in managers:
        portrait(os.path.join(out, filename), seed, accent)
    stories = [
        ("story-2014-2016.png", "story-2014", TEAL),
        ("story-2017-2019.png", "story-2017", BRICK),
        ("story-2020-2022.png", "story-2020", TEAL),
        ("story-2023-2026.png", "story-2023", BRICK),
    ]
    for filename, seed, accent in stories:
        story_image(os.path.join(out, filename), seed, accent)
    social_card(os.path.join(out, "social-card.png"))
    print("images written to", os.path.abspath(out))


if __name__ == "__main__":
    main()
