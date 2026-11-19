"""Residual emissions on unmatched hours, in whole grams."""

from __future__ import annotations

from datetime import datetime

from .numbers import round_half_up

FACTOR_SCALE = 10000
WATT_HOURS_PER_KWH = 1000


def factor_e4(decimal_text: str) -> int:
    """A grams-per-kWh decimal string of up to four places as a scaled integer."""
    whole, _, fraction = decimal_text.strip().partition(".")
    fraction = (fraction + "0000")[:4]
    return int(whole) * FACTOR_SCALE + int(fraction)


def grams(unmatched: dict[datetime, int], factors: dict[datetime, int]) -> int | None:
    """None while any unmatched hour has no stored factor."""
    total = 0
    for hour_utc, unmatched_wh in unmatched.items():
        if unmatched_wh <= 0:
            continue
        scaled = factors.get(hour_utc)
        if scaled is None:
            return None
        total += round_half_up(
            unmatched_wh * scaled, FACTOR_SCALE * WATT_HOURS_PER_KWH
        )
    return total
