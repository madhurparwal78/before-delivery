"""Covers: a procedural field drawn from a case's theme colour and cover seed."""

from __future__ import annotations

from markupsafe import Markup, escape

THEME_GROUNDS: dict[str, str] = {
    "orange": "#f26c1e",
    "violet": "#7a6cf0",
    "lemon": "#e3f03a",
    "clay": "#e0b79a",
    "sand": "#e4d3b8",
    "ink": "#111214",
    "mist": "#dfe3e6",
}

THEME_INKS: dict[str, str] = {theme: "#121315" for theme in THEME_GROUNDS}
THEME_INKS["ink"] = "#f6f7f8"

THEME_EYEBROWS: dict[str, str] = {
    "orange": "#4a2408",
    "violet": "#211a52",
    "lemon": "#4b5209",
    "clay": "#4d3520",
    "sand": "#4e4021",
    "ink": "#9aa1a9",
    "mist": "#4b5157",
}


def initials(client: str) -> str:
    parts = [word for word in client.split() if word]
    return "".join(word[0].upper() for word in parts[:2]) or client[:2].upper()


class _Seeded:
    """A tiny deterministic generator, so one seed always draws one cover."""

    def __init__(self, seed: int) -> None:
        self._state = (seed * 2654435761 + 1013904223) % 2147483647 or 1

    def next(self, low: float, high: float) -> float:
        self._state = (self._state * 1103515245 + 12345) % 2147483647
        return low + (self._state / 2147483647) * (high - low)

    def pick(self, low: int, high: int) -> int:
        return int(self.next(low, high + 1 - 1e-9))


def cover_svg(theme: str, cover_seed: int, client: str) -> Markup:
    """A field of theme colour, one large soft white glow and faint dark bands."""
    ground = THEME_GROUNDS.get(theme, THEME_GROUNDS["mist"])
    ink = THEME_INKS.get(theme, "#121315")
    rng = _Seeded(cover_seed)
    uid = f"c{cover_seed}"
    glow_x = rng.next(18, 78)
    glow_y = rng.next(14, 62)
    glow_r = rng.next(40, 68)
    band_count = rng.pick(2, 4)

    bands: list[str] = []
    for index in range(band_count):
        top = rng.next(6, 86)
        height = rng.next(1.4, 6.0)
        left = rng.next(-12, 36)
        width = rng.next(58, 124)
        tilt = rng.next(-9, 9)
        bands.append(
            f'<rect x="{left:.2f}" y="{top:.2f}" width="{width:.2f}" '
            f'height="{height:.2f}" fill="#000" opacity="{0.05 + index * 0.025:.3f}" '
            f'transform="rotate({tilt:.2f} 50 {top:.2f})" />'
        )

    return Markup(
        f'<svg class="cover-art" viewBox="0 0 100 100" preserveAspectRatio="none" '
        f'role="presentation" aria-hidden="true" focusable="false">'
        f"<defs><radialGradient id=\"{uid}\" cx=\"{glow_x:.2f}%\" cy=\"{glow_y:.2f}%\" "
        f'r="{glow_r:.2f}%">'
        f'<stop offset="0%" stop-color="#ffffff" stop-opacity="0.72" />'
        f'<stop offset="55%" stop-color="#ffffff" stop-opacity="0.20" />'
        f'<stop offset="100%" stop-color="#ffffff" stop-opacity="0" />'
        f"</radialGradient></defs>"
        f'<rect width="100" height="100" fill="{ground}" />'
        f'<rect width="100" height="100" fill="url(#{uid})" />'
        f"{''.join(bands)}"
        f'<text x="5" y="94" font-size="9" fill="{ink}" opacity="0.78" '
        f'font-family="Inter, system-ui, sans-serif">{escape(initials(client))}</text>'
        f"</svg>"
    )


def glow_reel_svg() -> Markup:
    """The landing media frame: a slow drifting white glow on near-black."""
    return Markup(
        '<svg class="reel-art" viewBox="0 0 100 40" preserveAspectRatio="none" '
        'role="presentation" aria-hidden="true" focusable="false">'
        '<defs><radialGradient id="reelglow" cx="50%" cy="50%" r="50%">'
        '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.58" />'
        '<stop offset="45%" stop-color="#cdd6ff" stop-opacity="0.18" />'
        '<stop offset="100%" stop-color="#ffffff" stop-opacity="0" />'
        "</radialGradient></defs>"
        '<rect width="100" height="40" fill="#0b0c0e" />'
        '<ellipse class="reel-glow" cx="30" cy="20" rx="34" ry="26" fill="url(#reelglow)" />'
        "</svg>"
    )
