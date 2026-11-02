"""Media files: an original vector icon per integration and cover per article, drawn from the row."""

from __future__ import annotations

import hashlib
from html import escape

ICON_GLYPHS = {
    "Collaboration": '<circle cx="38" cy="44" r="14"/><circle cx="58" cy="44" r="14"/><path d="M26 70h44"/>',
    "CRM": '<path d="M28 68V50M42 68V38M56 68V44M70 68V30"/>',
    "Calendar": '<rect x="26" y="30" width="44" height="40" rx="6"/><path d="M26 42h44M38 24v12M58 24v12"/>',
    "Desktop App": '<rect x="24" y="28" width="48" height="32" rx="4"/><path d="M40 70h16M48 60v10"/>',
    "Mobile": '<rect x="36" y="24" width="24" height="48" rx="6"/><path d="M45 64h6"/>',
    "Browser Extensions": '<rect x="24" y="28" width="48" height="40" rx="6"/><path d="M24 40h48M32 34h2M38 34h2"/>',
    "Storage": '<ellipse cx="48" cy="34" rx="20" ry="7"/><path d="M28 34v28c0 4 9 7 20 7s20-3 20-7V34M28 48c0 4 9 7 20 7s20-3 20-7"/>',
    "Analytics": '<path d="M26 66l14-16 10 8 20-24"/><path d="M60 34h10v10"/>',
    "Dialers": '<path d="M34 28l8 10-5 6c3 6 7 10 13 13l6-5 10 8-4 8c-16 0-32-16-32-32z"/>',
    "Video Conferencing": '<rect x="24" y="34" width="34" height="28" rx="5"/><path d="M58 44l14-8v24l-14-8"/>',
}
ARTICLE_HUES = {"Product Updates": 224, "Sales": 206, "Education": 192, "Media": 248, "Hiring": 178, "Company": 236}


def _seed(slug: str) -> bytes:
    return hashlib.sha256(slug.encode("utf-8")).digest()


def integration_icon(slug: str, name: str, category: str) -> str:
    seed = _seed(slug)
    hue = 200 + seed[0] % 52
    tilt = seed[1] % 40 - 20
    glyph = ICON_GLYPHS[category]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" '
        f'aria-label="{escape(name)}">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate({tilt} .5 .5)">'
        f'<stop offset="0" stop-color="hsl({hue},82%,62%)"/><stop offset="1" stop-color="hsl({hue + 14},78%,40%)"/>'
        '</linearGradient></defs>'
        '<rect width="96" height="96" rx="24" fill="url(#g)"/>'
        f'<circle cx="{70 + seed[2] % 14}" cy="{18 + seed[3] % 14}" r="{18 + seed[4] % 10}" fill="#fff" opacity=".14"/>'
        f'<g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">{glyph}</g>'
        '</svg>'
    )


def article_cover(slug: str, title: str, category: str) -> str:
    seed = _seed(slug)
    hue = ARTICLE_HUES[category] + seed[0] % 12 - 6
    shapes = []
    for index in range(4):
        x, y = 200 + seed[1 + index] * 3, 80 + seed[5 + index] * 2
        radius = 120 + seed[9 + index] % 180
        light = 52 + index * 9
        shapes.append(f'<circle cx="{x}" cy="{y}" r="{radius}" fill="hsl({hue + index * 6},80%,{light}%)" '
                      f'opacity="{0.22 + index * 0.1:.2f}"/>')
    lines = "".join(f'<path d="M0 {420 + i * 36} C 300 {380 + i * 30 - seed[13 + i] % 60}, 800 {470 + i * 26}, 1200 '
                    f'{400 + i * 34}" stroke="hsl({hue},70%,45%)" stroke-opacity=".18" stroke-width="2" fill="none"/>'
                    for i in range(6))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" role="img" '
        f'aria-label="{escape(title)}">'
        f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/>'
        f'<stop offset="1" stop-color="hsl({hue},80%,92%)"/></linearGradient>'
        '<filter id="soft"><feGaussianBlur stdDeviation="28"/></filter></defs>'
        '<rect width="1200" height="675" fill="url(#bg)"/>'
        f'<g filter="url(#soft)">{"".join(shapes)}</g>{lines}'
        f'<rect x="72" y="72" width="{220 + seed[20] % 120}" height="14" rx="7" fill="hsl({hue},70%,40%)" opacity=".5"/>'
        f'<rect x="72" y="100" width="{140 + seed[21] % 100}" height="14" rx="7" fill="hsl({hue},70%,40%)" opacity=".3"/>'
        '</svg>'
    )
