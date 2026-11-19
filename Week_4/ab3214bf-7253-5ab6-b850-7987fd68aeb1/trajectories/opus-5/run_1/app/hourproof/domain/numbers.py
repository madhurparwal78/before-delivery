"""Integer arithmetic for watt-hours, grams and basis points."""

from __future__ import annotations


def round_half_up(numerator: int, denominator: int) -> int:
    """Round a non-negative rational half up, in integers only."""
    return (2 * numerator + denominator) // (2 * denominator)


def basis_points(matched_wh: int, consumed_wh: int) -> int:
    if consumed_wh == 0:
        return 0
    return round_half_up(matched_wh * 10000, consumed_wh)


def commas(value: int) -> str:
    return f"{value:,}"


def percent_text(bp: int) -> str:
    """Basis points as a percentage with exactly two decimals."""
    sign = "-" if bp < 0 else ""
    bp = abs(bp)
    return f"{sign}{bp // 100}.{bp % 100:02d}"


def mwh_text(wh: int) -> str:
    """Watt-hours in MWh with exactly six decimals, built from integer digits."""
    sign = "-" if wh < 0 else ""
    wh = abs(wh)
    return f"{sign}{wh // 1000000}.{wh % 1000000:06d}"
