"""Exact conversion of meter readings into integer watt-hours."""

from __future__ import annotations

MULTIPLIER = {"kWh": 3, "MWh": 6}
READINGS_PER_HOUR = {60: 1, 30: 2, 15: 4}


class NotWholeWattHour(Exception):
    """A reading that is not a whole watt-hour after conversion."""


def to_watt_hours(value: str, unit: str) -> int:
    """A decimal string in a published unit as exact watt-hours."""
    if unit not in MULTIPLIER:
        raise NotWholeWattHour(unit)
    text = value.strip()
    negative = text.startswith("-")
    if negative or text.startswith("+"):
        text = text[1:]
    whole, _, fraction = text.partition(".")
    if not whole.isdigit() or (fraction and not fraction.isdigit()):
        raise NotWholeWattHour(value)
    digits = int(whole + fraction) if fraction else int(whole)
    scale = 10 ** len(fraction)
    scaled = digits * 10 ** MULTIPLIER[unit]
    if scaled % scale:
        raise NotWholeWattHour(value)
    watt_hours = scaled // scale
    return -watt_hours if negative else watt_hours
