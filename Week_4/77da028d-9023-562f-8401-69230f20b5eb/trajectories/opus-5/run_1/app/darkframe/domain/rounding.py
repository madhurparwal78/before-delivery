"""Every rounding rule Darkframe publishes, decided here only."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal


def half_away_from_zero(value: float, places: int) -> float:
    quantum = Decimal(1).scaleb(-places)
    return float(Decimal(repr(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def degrees(value: float) -> float:
    """Altitudes, azimuths, separations and sidereal time: 0.1 degree."""
    return half_away_from_zero(value, 1)


def illumination(value: float) -> float:
    return half_away_from_zero(value, 2)


def share_grid(value: float) -> float:
    """Shared coordinates: the nearest half degree, halves away from zero."""
    rounded = half_away_from_zero(value * 2.0, 0) / 2.0
    return 0.0 if rounded == 0 else rounded


def share_grid_text(value: float) -> str:
    return f"{share_grid(value):.1f}"
