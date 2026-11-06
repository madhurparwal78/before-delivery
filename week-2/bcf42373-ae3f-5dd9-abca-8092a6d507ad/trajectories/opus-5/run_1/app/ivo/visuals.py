"""Visuals drawn from stored fields. Nothing here is stored or shipped as a file."""

import hashlib

from markupsafe import Markup

GROUND = "#120709"
DEEP_RED = "#C2101A"
DARK_RED = "#7A0B12"
BRIGHT_RED = "#FF2A2A"


def _dial(seed, count):
    """Turn a record's stored fields into a short run of stable numbers."""
    digest = hashlib.blake2b(seed.encode("utf-8"), digest_size=count).digest()
    return [value / 255 for value in digest]


def _token(seed):
    return hashlib.blake2b(seed.encode("utf-8"), digest_size=6).hexdigest()


def stage_grid():
    """Sixteen deep red hairlines: diagonals, rules and a centred square."""
    lines = [
        (0, 0, 100, 100),
        (100, 0, 0, 100),
        (0, 50, 50, 0),
        (50, 100, 100, 50),
        (30, 30, 70, 30),
        (70, 30, 70, 70),
        (70, 70, 30, 70),
        (30, 70, 30, 30),
        (12, 0, 12, 100),
        (36, 0, 36, 100),
        (64, 0, 64, 100),
        (88, 0, 88, 100),
        (0, 12, 100, 12),
        (0, 36, 100, 36),
        (0, 64, 100, 64),
        (0, 88, 100, 88),
    ]
    drawn = "".join(
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" />' for x1, y1, x2, y2 in lines
    )
    return Markup(
        '<svg class="stage-grid" viewBox="0 0 100 100" preserveAspectRatio="none"'
        ' aria-hidden="true" focusable="false">'
        f'<g stroke="{DEEP_RED}" stroke-width="0.12" fill="none">{drawn}</g>'
        "</svg>"
    )


def composition(seed, variant="a", label=None):
    """A generated visual, identical for a record and visibly its own.

    The look comes from the seed alone, so the same record draws the same
    picture; the variant only keeps gradient ids unique on the page.
    """
    dial = _dial(seed, 10)
    token = _token(f"{seed}|{variant}")
    angle = round(dial[0] * 360)
    first = (round(12 + dial[1] * 70), round(12 + dial[2] * 70))
    second = (round(12 + dial[3] * 70), round(12 + dial[4] * 70))
    third = (round(12 + dial[5] * 70), round(12 + dial[6] * 70))
    spread = round(34 + dial[7] * 34)
    bar = round(18 + dial[8] * 46)
    tilt = round(-24 + dial[9] * 48)

    if label is None:
        framing = 'aria-hidden="true" focusable="false"'
        title = ""
    else:
        framing = f'role="img" aria-label="{Markup.escape(label)}" focusable="false"'
        title = f"<title>{Markup.escape(label)}</title>"

    return Markup(
        f'<svg class="composition" viewBox="0 0 100 100"'
        f' preserveAspectRatio="xMidYMid slice" {framing}>{title}'
        "<defs>"
        f'<linearGradient id="g{token}f" gradientTransform="rotate({angle} 0.5 0.5)">'
        f'<stop offset="0" stop-color="{DARK_RED}" stop-opacity="0.95" />'
        f'<stop offset="0.62" stop-color="{GROUND}" stop-opacity="0.98" />'
        f'<stop offset="1" stop-color="{DEEP_RED}" stop-opacity="0.72" />'
        "</linearGradient>"
        f'<radialGradient id="g{token}a" cx="{first[0]}%" cy="{first[1]}%"'
        f' r="{spread}%">'
        f'<stop offset="0" stop-color="{DEEP_RED}" stop-opacity="0.85" />'
        f'<stop offset="1" stop-color="{DEEP_RED}" stop-opacity="0" />'
        "</radialGradient>"
        f'<radialGradient id="g{token}b" cx="{second[0]}%" cy="{second[1]}%"'
        f' r="{spread + 14}%">'
        f'<stop offset="0" stop-color="{BRIGHT_RED}" stop-opacity="0.45" />'
        f'<stop offset="1" stop-color="{BRIGHT_RED}" stop-opacity="0" />'
        "</radialGradient>"
        f'<radialGradient id="g{token}c" cx="{third[0]}%" cy="{third[1]}%" r="46%">'
        f'<stop offset="0" stop-color="{GROUND}" stop-opacity="0.9" />'
        f'<stop offset="1" stop-color="{GROUND}" stop-opacity="0" />'
        "</radialGradient>"
        "</defs>"
        f'<rect width="100" height="100" fill="{GROUND}" />'
        f'<rect width="100" height="100" fill="url(#g{token}f)" />'
        f'<rect width="100" height="100" fill="url(#g{token}a)" />'
        f'<rect width="100" height="100" fill="url(#g{token}b)" />'
        f'<rect width="100" height="100" fill="url(#g{token}c)" />'
        f'<g stroke="{DEEP_RED}" stroke-width="0.18" fill="none" opacity="0.7">'
        f'<line x1="0" y1="{bar}" x2="100" y2="{bar + tilt / 4}" />'
        f'<line x1="{bar}" y1="0" x2="{bar + tilt / 4}" y2="100" />'
        f'<rect x="26" y="26" width="48" height="48"'
        f' transform="rotate({tilt} 50 50)" />'
        "</g>"
        "</svg>"
    )


def personal_mark():
    """An original symmetric winged glyph, drawn as line art."""
    return Markup(
        '<svg class="mark-glyph" viewBox="0 0 48 24" aria-hidden="true"'
        ' focusable="false">'
        '<g fill="none" stroke="currentColor" stroke-width="1.4"'
        ' stroke-linecap="round">'
        '<path d="M24 4 L24 20" />'
        '<path d="M24 7 L10 3 L3 12 L17 13 Z" />'
        '<path d="M24 7 L38 3 L45 12 L31 13 Z" />'
        '<path d="M19 17 L24 21 L29 17" />'
        "</g></svg>"
    )


def close_cross():
    return Markup(
        '<svg class="icon-cross" viewBox="0 0 16 16" aria-hidden="true"'
        ' focusable="false">'
        '<g stroke="currentColor" stroke-width="1.3" stroke-linecap="round">'
        '<line x1="3" y1="3" x2="13" y2="13" />'
        '<line x1="13" y1="3" x2="3" y2="13" />'
        "</g></svg>"
    )


def plus_marker():
    return Markup(
        '<svg class="icon-plus" viewBox="0 0 16 16" aria-hidden="true"'
        ' focusable="false">'
        f'<g stroke="{DEEP_RED}" stroke-width="1.2" stroke-linecap="round">'
        '<line x1="8" y1="2" x2="8" y2="14" />'
        '<line x1="2" y1="8" x2="14" y2="8" />'
        "</g></svg>"
    )


def process_ring(number):
    return Markup(
        '<svg class="icon-ring" viewBox="0 0 48 48" aria-hidden="true"'
        ' focusable="false">'
        f'<circle cx="24" cy="24" r="22" fill="none" stroke="{DEEP_RED}"'
        ' stroke-width="0.9" stroke-dasharray="6 4" />'
        "</svg>"
        f'<span class="process-number">{Markup.escape(number)}</span>'
    )


def equaliser():
    bars = "".join(
        f'<rect class="equaliser-bar equaliser-bar-{index}" x="{index * 5}"'
        f' y="4" width="3" height="12" rx="1" />'
        for index in range(1, 4)
    )
    return Markup(
        '<svg class="equaliser" viewBox="0 0 20 20" aria-hidden="true"'
        f' focusable="false"><g fill="{BRIGHT_RED}">{bars}</g></svg>'
    )


def awards_floor():
    return Markup(
        '<svg class="awards-floor" viewBox="0 0 120 30" preserveAspectRatio="none"'
        ' aria-hidden="true" focusable="false">'
        f'<polygon points="0,30 20,0 40,30" fill="{DARK_RED}" opacity="0.8" />'
        f'<polygon points="20,30 40,0 60,30" fill="{GROUND}" />'
        f'<polygon points="40,30 60,0 80,30" fill="{DEEP_RED}" opacity="0.7" />'
        f'<polygon points="60,30 80,0 100,30" fill="{GROUND}" />'
        f'<polygon points="80,30 100,0 120,30" fill="{DARK_RED}" opacity="0.8" />'
        "</svg>"
    )
