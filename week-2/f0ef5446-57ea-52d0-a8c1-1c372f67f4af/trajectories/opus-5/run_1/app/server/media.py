"""Original vector media, drawn from each row's own slug."""

from __future__ import annotations

import hashlib

ACCENT = "#1b4dff"
INK = "#0d1326"
PALE = "#eef2ff"


def _seed_values(slug: str, count: int) -> list[int]:
    digest = hashlib.sha256(slug.encode("utf-8")).digest()
    return [digest[index] for index in range(count)]


def _hue(value: int) -> int:
    return 198 + value % 60


def integration_icon(slug: str, name: str) -> bytes:
    """A 64 by 64 mark whose shapes and tone come from the integration's slug."""
    a, b, c, d, e = _seed_values(slug, 5)
    hue = _hue(a)
    tone = f"hsl({hue} 90% {38 + b % 14}%)"
    soft = f"hsl({hue} 92% {88 + c % 6}%)"
    radius = 12 + d % 8
    shapes = [
        f'<rect x="4" y="4" width="56" height="56" rx="{radius}" fill="{soft}"/>',
        f'<circle cx="{20 + a % 10}" cy="{20 + b % 10}" r="{7 + c % 5}" fill="{tone}"/>',
    ]
    variant = e % 4
    if variant == 0:
        shapes.append(
            f'<rect x="16" y="36" width="32" height="6" rx="3" fill="{tone}" opacity="0.75"/>'
            f'<rect x="16" y="46" width="20" height="6" rx="3" fill="{tone}" opacity="0.45"/>'
        )
    elif variant == 1:
        shapes.append(
            f'<path d="M14 50 L26 34 L38 44 L52 22" fill="none" stroke="{tone}"'
            ' stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    elif variant == 2:
        shapes.append(
            f'<rect x="14" y="38" width="8" height="14" rx="4" fill="{tone}"/>'
            f'<rect x="28" y="30" width="8" height="22" rx="4" fill="{tone}" opacity="0.7"/>'
            f'<rect x="42" y="22" width="8" height="30" rx="4" fill="{tone}" opacity="0.45"/>'
        )
    else:
        shapes.append(
            f'<path d="M16 44 q16 -22 32 0" fill="none" stroke="{tone}" stroke-width="5"'
            ' stroke-linecap="round"/>'
            f'<circle cx="32" cy="48" r="5" fill="{tone}"/>'
        )
    body = "".join(shapes)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"'
        ' role="img">'
        f"<title>{_escape(name)}</title>{body}</svg>"
    ).encode("utf-8")


def article_cover(slug: str, title: str) -> bytes:
    """A 1200 by 630 cover built from bands, an orb and the article's own slug."""
    a, b, c, d = _seed_values(slug, 4)
    hue = _hue(a)
    deep = f"hsl({hue} 88% {34 + b % 10}%)"
    mid = f"hsl({hue} 90% {62 + c % 8}%)"
    pale = f"hsl({hue} 95% {93 + d % 4}%)"
    offset = 120 + a % 240
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200"'
        ' height="630" role="img">'
        f"<title>{_escape(title)}</title>"
        "<defs>"
        f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="{pale}"/><stop offset="100%" stop-color="#ffffff"/>'
        "</linearGradient>"
        f'<radialGradient id="o" cx="50%" cy="50%" r="50%">'
        f'<stop offset="0%" stop-color="{deep}" stop-opacity="0.85"/>'
        f'<stop offset="100%" stop-color="{mid}" stop-opacity="0.08"/>'
        "</radialGradient>"
        "</defs>"
        '<rect width="1200" height="630" fill="url(#g)"/>'
        f'<circle cx="{700 + a % 200}" cy="{200 + b % 160}" r="{180 + c % 90}" fill="url(#o)"/>'
        f'<rect x="0" y="{offset}" width="1200" height="14" fill="{mid}" opacity="0.35"/>'
        f'<rect x="80" y="{offset + 70}" width="{320 + b % 200}" height="18" rx="9"'
        f' fill="{deep}" opacity="0.8"/>'
        f'<rect x="80" y="{offset + 110}" width="{200 + c % 160}" height="18" rx="9"'
        f' fill="{deep}" opacity="0.45"/>'
        f'<path d="M0 630 Q300 {520 - a % 80} 600 600 T1200 {560 - c % 60} L1200 630 Z"'
        f' fill="{mid}" opacity="0.3"/>'
        "</svg>"
    ).encode("utf-8")


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
