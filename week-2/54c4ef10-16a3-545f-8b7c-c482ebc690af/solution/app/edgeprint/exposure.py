"""Relative exposure: the aperture table, the shutter grammar, the stops formula and the rounding rule.

The browser's Exposure preview takes the table and constants from the script generated out of this
module (`web_domain.py`), so there is exactly one declaration of each.
"""

import math
import re
from decimal import ROUND_HALF_UP, Decimal

LOG_H_PER_STOP = 0.30103
APERTURES: tuple[str, ...] = (
    "1", "1.1", "1.2", "1.4", "1.6", "1.8", "2", "2.2", "2.5", "2.8", "3.2", "3.5", "4", "4.5", "5",
    "5.6", "6.3", "7.1", "8", "9", "10", "11", "13", "14", "16", "18", "20", "22", "25", "29", "32",
    "36", "40", "45", "51", "57", "64",
)
DEFAULT_APERTURE = "8"
EV_MIN, EV_MAX = -6.0, 21.0
SHUTTER_DENOMINATORS = (2, 8000)
SHUTTER_WHOLE_SECONDS = (1, 3600)

_FRACTION_SHUTTER = re.compile(r"1/([0-9]+)")
_SECONDS_SHUTTER = re.compile(r'([0-9]+)"')


def half_away(value: float, places: int) -> float:
    """Round half away from zero at `places` decimals, judged on the shortest decimal form of `value`."""
    return float(Decimal(repr(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def aperture_index(text: str) -> int | None:
    """Position in the marked table of `text`, with or without the `f/` prefix."""
    bare = text.removeprefix("f/")
    return APERTURES.index(bare) if bare in APERTURES else None


def parse_shutter(text: str) -> float | None:
    """Seconds for `1/<n>` (n 2 to 8000) or `<n>"` (n 1 to 3600), None when it does not parse."""
    fraction = _FRACTION_SHUTTER.fullmatch(text)
    if fraction and SHUTTER_DENOMINATORS[0] <= int(fraction.group(1)) <= SHUTTER_DENOMINATORS[1]:
        return 1 / int(fraction.group(1))
    seconds = _SECONDS_SHUTTER.fullmatch(text)
    if seconds and SHUTTER_WHOLE_SECONDS[0] <= int(seconds.group(1)) <= SHUTTER_WHOLE_SECONDS[1]:
        return float(int(seconds.group(1)))
    return None


def relative_stops(metered_ev: float, ei: int, aperture: str, shutter_seconds: float, reciprocity_p: float) -> float:
    """Stops of exposure relative to what the meter asked for, with reciprocity applied past one second."""
    effective = shutter_seconds**reciprocity_p if shutter_seconds > 1 else shutter_seconds
    return metered_ev + math.log2(ei / 100) - APERTURES.index(aperture) / 3 + math.log2(effective)


def relative_log_h(stops: float) -> float:
    return stops * LOG_H_PER_STOP
