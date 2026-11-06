"""The one rounding rule: half away from zero, at the stated precision."""

from __future__ import annotations

import math


def round_half_away(value: float, digits: int) -> float:
    factor = 10**digits
    scaled = value * factor
    rounded = math.floor(abs(scaled) + 0.5) * (1 if scaled >= 0 else -1)
    return rounded / factor
