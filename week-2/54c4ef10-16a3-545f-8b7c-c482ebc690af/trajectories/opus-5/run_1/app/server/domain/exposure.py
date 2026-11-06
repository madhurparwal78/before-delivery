"""Apertures, shutter speeds and the exposure maths.

This module is the only place where the marked aperture table, the
reciprocity rule and the rounding rule are decided. The browser's Exposure
preview is handed this same table through the page bootstrap.
"""

from __future__ import annotations

import math
from decimal import Decimal, InvalidOperation

from .rounding import round_half_away

LOG10_2 = 0.30103

__all__ = [
    "LOG10_2",
    "MARKED_APERTURES",
    "aperture_n",
    "entry_figures",
    "parse_aperture",
    "parse_shutter",
    "relative_log_h",
    "relative_stops",
    "round_half_away",
    "shutter_seconds",
]

MARKED_APERTURES: tuple[str, ...] = (
    "1", "1.1", "1.2", "1.4", "1.6", "1.8", "2", "2.2", "2.5", "2.8",
    "3.2", "3.5", "4", "4.5", "5", "5.6", "6.3", "7.1", "8", "9",
    "10", "11", "13", "14", "16", "18", "20", "22", "25", "29",
    "32", "36", "40", "45", "51", "57", "64",
)

MIN_SHUTTER_FRACTION = 2
MAX_SHUTTER_FRACTION = 8000
MIN_SHUTTER_SECONDS = 1
MAX_SHUTTER_SECONDS = 3600


def parse_aperture(raw: object) -> str | None:
    """Return the marked aperture as stored (no `f/` prefix), or None."""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        text = repr(raw)
    elif isinstance(raw, str):
        text = raw.strip()
    else:
        return None
    if text[:2].lower() == "f/":
        text = text[2:].strip()
    try:
        value = Decimal(text)
    except (InvalidOperation, ValueError):
        return None
    for marked in MARKED_APERTURES:
        if Decimal(marked) == value:
            return marked
    return None


def aperture_n(aperture: str) -> float:
    """The exact third-stop value 2**(i/6) of a marked aperture."""
    return 2 ** (MARKED_APERTURES.index(aperture) / 6)


def parse_shutter(raw: object) -> str | None:
    """Return the shutter string as stored, or None when it does not parse."""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if text.startswith("1/"):
        digits = text[2:]
        if digits.isdigit() and not digits.startswith("0"):
            n = int(digits)
            if MIN_SHUTTER_FRACTION <= n <= MAX_SHUTTER_FRACTION:
                return text
        return None
    if text.endswith('"'):
        digits = text[:-1]
        if digits.isdigit() and not digits.startswith("0"):
            n = int(digits)
            if MIN_SHUTTER_SECONDS <= n <= MAX_SHUTTER_SECONDS:
                return text
        return None
    return None


def shutter_seconds(shutter: str) -> float:
    if shutter.startswith("1/"):
        return 1 / int(shutter[2:])
    return float(int(shutter[:-1]))


def effective_time(seconds: float, reciprocity_p: float) -> float:
    """Reciprocity failure corrects only exposures longer than one second."""
    if seconds > 1:
        return seconds**reciprocity_p
    return seconds


def relative_stops(
    *,
    metered_ev: float,
    aperture: str,
    shutter: str,
    ei: int,
    reciprocity_p: float,
) -> float:
    n = aperture_n(aperture)
    t_eff = effective_time(shutter_seconds(shutter), reciprocity_p)
    return (
        metered_ev
        + math.log2(ei / 100)
        - math.log2(n * n)
        + math.log2(t_eff)
    )


def relative_log_h(stops: float) -> float:
    return stops * LOG10_2


def entry_figures(
    *,
    metered_ev: float,
    aperture: str,
    shutter: str,
    ei: int,
    reciprocity_p: float,
) -> tuple[float, float]:
    """The unrounded (stops, log H) pair of one entry."""
    stops = relative_stops(
        metered_ev=metered_ev,
        aperture=aperture,
        shutter=shutter,
        ei=ei,
        reciprocity_p=reciprocity_p,
    )
    return stops, relative_log_h(stops)
