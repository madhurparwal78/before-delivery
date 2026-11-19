"""Generate original media assets (WebM hero, audio tracks, SVG art) at build time."""
from __future__ import annotations

import math
import os
import struct
import wave

STATIC = "/app/hub/static/gen"


def hex_to_rgb(value: str) -> tuple:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


INDIGO = hex_to_rgb("#6366F1")
INK = hex_to_rgb("#101014")
PALE = hex_to_rgb("#F6F6F4")


def write_svg(path: str, body: str, w: int = 640, h: int = 360) -> None:
    with open(path, "w") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">')
        fh.write(f'<rect width="{w}" height="{h}" fill="#15151b"/>')
        fh.write(body)
        fh.write("</svg>")


def community_icon(slug: str, seed: int) -> str:
    r = INDIGO[0]
    body = "".join(
        f'<circle cx="{(seed * 37 + i * 91) % 560 + 40}" cy="{(seed * 53 + i * 61) % 280 + 40}" '
        f'r="{20 + (seed * i * 7) % 50}" fill="hsl({(seed * 47 + i * 33) % 360}, 62%, 62%)" opacity="0.85"/>'
        for i in range(9)
    )
    return f'<circle cx="320" cy="180" r="150" fill="#101014"/>{body}'


def banner_art(slug: str, seed: int) -> str:
    return "".join(
        f'<rect x="{i * 64}" y="0" width="64" height="360" fill="hsl({(seed * 13 + i * 21) % 360}, 45%, {18 + (i * 5) % 22}%)" opacity="0.9"/>'
        for i in range(10)
    )


def main() -> None:
    os.makedirs(STATIC, exist_ok=True)
    slugs = [
        "aurora-collective", "ronin-guild", "starlight-studio", "pixel-parlor", "draft-hall",
        "gale-runners", "harbor-crew", "quiet-desk", "maple-math", "signal-drift",
        "velvet-lounge", "comet-lab", "tidal-institute", "lumen-workshop", "prism-theatre",
        "lantern-film",
    ]
    for idx, slug in enumerate(slugs):
        seed = idx + 3
        write_svg(f"{STATIC}/icon-{slug}.svg", community_icon(slug, seed), 320, 320)
        write_svg(f"{STATIC}/splash-{slug}.svg", banner_art(slug, seed))
        write_svg(f"{STATIC}/banner-{slug}.svg", banner_art(slug, seed), 1280, 400)
    games = ["nova-drift", "ronin-tactics", "echo-gardens", "tidal-rally", "lumen-siege"]
    for idx, slug in enumerate(games):
        write_svg(f"{STATIC}/cover-{slug}.svg", community_icon(slug, idx + 11), 480, 270)
    for idx in range(1, 5):
        write_svg(f"{STATIC}/avatar-{idx}.svg",
                  f'<circle cx="256" cy="256" r="180" fill="hsl({(idx * 67) % 360}, 55%, 55%)"/>'
                  f'<circle cx="200" cy="200" r="24" fill="#101014"/><circle cx="312" cy="200" r="24" fill="#101014"/>'
                  f'<path d="M170 320 Q256 400 342 320" stroke="#101014" stroke-width="18" fill="none"/>',
                  512, 512)
    # hero poster
    write_svg(f"{STATIC}/hero-poster.svg",
              '<rect width="640" height="360" fill="#101014"/>'
              '<text x="40" y="200" fill="#F6F6F4" font-size="64" font-family="sans-serif">Community Hub</text>',
              640, 360)
    print("svg assets written")


if __name__ == "__main__":
    main()
