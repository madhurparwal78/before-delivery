"""Generated artwork: original gradient-and-shape SVGs for community art, avatars and game covers.

Every image is deterministic for its key, so the address can be cached for a long time. Names come
from the database (initials) with a safe fallback when the key is unknown.
"""

from __future__ import annotations

import hashlib
from xml.sax.saxutils import escape

from flask import Flask, Request, Response, request

from . import db, trending_data

KINDS = {"icon": (128, 128), "splash": (640, 360), "banner": (1280, 400), "avatar": (128, 128), "cover": (480, 270)}
_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"


def community_art(slug: str) -> dict[str, str]:
    return {kind: f"/static/art/{kind}/{slug}.svg" for kind in ("icon", "splash", "banner")}


def _initials(name: str) -> str:
    words = [w for w in name.split() if w[:1].isalnum()]
    letters = "".join(w[0] for w in words[:2]).upper()
    return letters or "?"


def _lookup_name(kind: str, key: str) -> str:
    if "\x00" in key:
        return ""
    if kind == "avatar":
        known = key.isascii() and key.isdigit() and len(key) <= 9
        row = db.one_row("SELECT display_name FROM members WHERE id = %s", (int(key),)) if known else None
        return row["display_name"] if row else ""
    if kind == "cover":
        game = trending_data.GAMES.get(key)
        return game["name"] if game else ""
    row = db.one_row("SELECT name FROM communities WHERE slug = %s", (key,))
    return row["name"] if row else ""


def _palette(key: str) -> tuple[int, int, int, list[int]]:
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    hue = digest[0] * 360 // 256
    return hue, (hue + 40 + digest[1] % 60) % 360, digest[2] % 3, list(digest[3:])


def render(kind: str, key: str, name: str) -> str:
    width, height = KINDS[kind]
    hue_a, hue_b, layout, noise = _palette(f"{kind}:{key}" if kind in ("avatar", "cover") else key)
    ground = f"hsl({hue_a} 62% 34%)"
    glow = f"hsl({hue_b} 70% 52%)"
    shapes = []
    for i in range(4):
        cx = noise[i * 3] * width // 255
        cy = noise[i * 3 + 1] * height // 255
        radius = (noise[i * 3 + 2] % 60 + 30) * min(width, height) // 100
        opacity = 0.16 + (i % 3) * 0.07
        shapes.append(f'<circle cx="{cx}" cy="{cy}" r="{radius}" fill="hsl({(hue_b + i * 30) % 360} 80% 70%)" '
                      f'fill-opacity="{opacity:.2f}"/>')
    if layout == 1:
        shapes.append(f'<path d="M0 {height * 0.8:.0f} Q {width * 0.3:.0f} {height * 0.55:.0f} {width * 0.6:.0f} '
                      f'{height * 0.8:.0f} T {width} {height * 0.7:.0f} V {height} H0 Z" fill="#000" fill-opacity="0.22"/>')
    elif layout == 2:
        shapes.append(f'<path d="M{width * 0.55:.0f} 0 L {width} 0 L {width} {height} L {width * 0.3:.0f} {height} Z" '
                      f'fill="#fff" fill-opacity="0.08"/>')
    else:
        shapes.append(f'<rect x="{width * 0.08:.0f}" y="{height * 0.12:.0f}" width="{width * 0.84:.0f}" '
                      f'height="{height * 0.76:.0f}" rx="{min(width, height) * 0.12:.0f}" fill="none" stroke="#fff" '
                      f'stroke-opacity="0.18" stroke-width="{max(2, min(width, height) // 40)}"/>')
    label = ""
    if kind in ("icon", "avatar"):
        label = (f'<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="{_FONT}" font-weight="800" '
                 f'font-size="{height * 0.4:.0f}" fill="#fff">{escape(_initials(name))}</text>')
    elif kind == "cover":
        label = (f'<text x="24" y="{height - 28}" font-family="{_FONT}" font-weight="900" font-size="30" fill="#fff" '
                 f'fill-opacity="0.92">{escape(name.upper())}</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
            f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{ground}"/>'
            f'<stop offset="1" stop-color="{glow}"/></linearGradient></defs>'
            f'<rect width="{width}" height="{height}" fill="url(#g)"/>{"".join(shapes)}{label}</svg>')


def _serve(kind: str, key: str, req: Request) -> Response:
    body = render(kind, key, _lookup_name(kind, key))
    etag = '"' + hashlib.sha256(body.encode("utf-8")).hexdigest()[:32] + '"'
    headers = {"ETag": etag, "Cache-Control": "public, max-age=86400"}
    if req.headers.get("If-None-Match") == etag:
        return Response(status=304, headers=headers)
    return Response(body, mimetype="image/svg+xml", headers=headers)


def register(app: Flask) -> None:
    for kind in KINDS:
        def view(key: str, kind: str = kind) -> Response:
            return _serve(kind, key, request)

        app.add_url_rule(f"/static/art/{kind}/<key>.svg", f"art_{kind}", view)
