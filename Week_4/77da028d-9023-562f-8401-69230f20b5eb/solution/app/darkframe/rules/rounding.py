"""Every rounding the brief names, decided once."""
import math
from decimal import ROUND_HALF_UP, Decimal

SHARE_GRID_DEGREES = Decimal("0.5")


def round_tenth(value: float) -> float:
    """0.1 degree, half away from zero."""
    return math.copysign(math.floor(abs(value) * 10 + 0.5) / 10, value) if value else 0.0


def round_hundredth(value: float) -> float:
    return math.copysign(math.floor(abs(value) * 100 + 0.5) / 100, value) if value else 0.0


def share_grid(degrees: float) -> float:
    """Nearest multiple of 0.5 degrees, halves away from zero; negative zero becomes 0.0."""
    steps = (Decimal(repr(degrees)) / SHARE_GRID_DEGREES).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    return float(steps * SHARE_GRID_DEGREES) + 0.0


def share_grid_text(degrees: float) -> str:
    return f"{share_grid(degrees):.1f}"
