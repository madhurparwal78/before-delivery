"""Exposure maths: apertures, shutter speeds and relative exposure.

The single source of the aperture table, the shutter rule, the reciprocity
correction and the rounding rule. The browser reads the same table through
/api/config/apertures and computes identical figures.
"""
from __future__ import annotations

import math
from fractions import Fraction

# The 37 marked third-stop aperture values, in order.
APERTURES: tuple[str, ...] = (
    "1", "1.1", "1.2", "1.4", "1.6", "1.8", "2", "2.2", "2.5", "2.8",
    "3.2", "3.5", "4", "4.5", "5", "5.6", "6.3", "7.1", "8", "9", "10",
    "11", "13", "14", "16", "18", "20", "22", "25", "29", "32", "36",
    "40", "45", "51", "57", "64",
)

# Position i is taken as exactly 2^(i/6), so N^2 = 2^(i/3).
_APERTURE_LOG2_NSQ: tuple[float, ...] = tuple(i / 3.0 for i in range(len(APERTURES)))
_APERTURE_INDEX: dict[str, int] = {a: i for i, a in enumerate(APERTURES)}

LOG_H_PER_STOP = 0.30103

METERED_EV_MIN = -6.0
METERED_EV_MAX = 21.0


def parse_aperture(text: str) -> str | None:
    """Return the normalised aperture string or None when unmarked."""
    if not isinstance(text, str):
        return None
    value = text.strip().lower()
    if value.startswith("f/"):
        value = value[2:]
    return value if value in _APERTURE_INDEX else None


def aperture_log2_nsq(aperture: str) -> float:
    """log2 of the exact N^2 for a marked aperture."""
    return _APERTURE_LOG2_NSQ[_APERTURE_INDEX[aperture]]


def parse_shutter(text: str) -> Fraction | None:
    """Parse 1/<n> (2..8000) or <n>" (1..3600 seconds) at face value."""
    if not isinstance(text, str):
        return None
    value = text.strip()
    if value.startswith("/"):
        return None
    if value.endswith('"'):
        seconds = _whole(value[:-1])
        if seconds is None or not 1 <= seconds <= 3600:
            return None
        return Fraction(seconds)
    try:
        if "/" in value:
            head, _, tail = value.partition("/")
            if _whole(head) is None or _whole(tail) is None:
                return None
            if int(head) != 1 or not 2 <= int(tail) <= 8000:
                return None
            return Fraction(1, int(tail))
        seconds = _whole(value)
        if seconds is None or not 1 <= seconds <= 3600:
            return None
        return Fraction(seconds)
    except (ValueError, ZeroDivisionError):
        return None


def _whole(text: str) -> int | None:
    if not text.isdigit() or not text.isascii():
        return None
    value = int(text)
    if text != str(value):
        return None
    return value


def effective_seconds(t: Fraction, reciprocity_p: float) -> float:
    """t^p beyond one second, t otherwise; exactly one second unchanged."""
    if t <= 1:
        return float(t)
    return float(t) ** reciprocity_p


def relative_stops(
    *, metered_ev: float, ei: int, aperture: str, t_seconds: Fraction,
    reciprocity_p: float,
) -> float:
    """Relative exposure in stops; positive means more light than metered."""
    t_eff = effective_seconds(t_seconds, reciprocity_p)
    return (float(metered_ev) + math.log2(ei / 100.0)) - aperture_log2_nsq(aperture) + math.log2(t_eff)


def relative_log_h(stops: float) -> float:
    return stops * LOG_H_PER_STOP


def round_half_away(value: float, places: int) -> float:
    """Round half away from zero, for the browser and the server alike."""
    scale = 10 ** places
    scaled = value * scale
    floor = math.floor(scaled)
    frac = scaled - floor
    if frac > 0.5:
        rounded = floor + 1
    elif frac < 0.5:
        rounded = floor
    else:
        rounded = floor if value < 0 else floor + 1
    return rounded / scale


def fmt_signed(value: float, places: int) -> str:
    """Two-decimal figure with a sign: + or the minus sign, never for zero."""
    rounded = round_half_away(value, places)
    if rounded == 0:
        return f"{0.0:.{places}f}"
    return ("+" if rounded > 0 else "−") + f"{abs(rounded):.{places}f}"


def fmt_plain(value: float, places: int) -> str:
    return f"{round_half_away(value, places):.{places}f}"


def fmt_span(value: float) -> str:
    return f"{round_half_away(value, 1):.1f}"


def fmt_bias(value: float) -> str:
    rounded = round_half_away(value, 1)
    if rounded == 0:
        return "0.0"
    return ("+" if rounded > 0 else "−") + f"{abs(rounded):.1f}"


def fmt_signed_offset(value: int) -> str:
    if value == 0:
        return "0"
    return ("+" if value > 0 else "−") + str(abs(value))


ROMAN = ("0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X")


def fmt_zone(zone: int | None) -> str:
    return "—" if zone is None else ROMAN[zone]
