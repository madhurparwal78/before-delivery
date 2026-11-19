"""Exact decimal string arithmetic for meter units and grid factors.

No binary floating point ever touches a watt-hour or a gram.
"""
from decimal import ROUND_HALF_UP, Decimal


def to_wh(value: str, unit: str) -> int | None:
    """Convert one reading value in kWh or MWh to integer watt-hours.

    Returns None when the product is not a whole watt-hour.
    """
    try:
        dec = Decimal(value)
    except Exception:
        return None
    if not dec.is_finite():
        return None
    factor = {"kWh": Decimal(1000), "MWh": Decimal(1000000)}.get(unit)
    if factor is None:
        return None
    wh = dec * factor
    if wh != wh.to_integral_value():
        return None
    return int(wh)


def parse_decimal(text: str) -> Decimal:
    return Decimal(text)


def round_half_up_int(numerator: int, denominator: int) -> int:
    """Round numerator/denominator half up, in integers. denominator > 0."""
    if numerator >= 0:
        return (2 * numerator + denominator) // (2 * denominator)
    raise ValueError("negative numerator unsupported")


def grams_for(unmatched_wh: int, g_per_kwh: str) -> int:
    """round_half_up(unmatched_wh * g_per_kwh / 1000) per hour."""
    grams = parse_decimal(g_per_kwh)
    # work in exact integer thousandths of a gram per Wh to avoid all rounding in Decimal
    scaled = grams.scaleb(4)  # up to four decimal places allowed
    if scaled != scaled.to_integral_value():
        scaled = scaled  # keep as is; Decimal multiplication below is exact anyway
    micro_grams_per_wh = int((grams * Decimal(1000000)).to_integral_value())  # ug per Wh exact when g_per_kwh has <=4 dp
    total_ug = unmatched_wh * micro_grams_per_wh
    # round half up to grams
    return (2 * total_ug + 1000000) // 2000000


def basis_points(matched: int, consumed: int) -> int:
    """round_half_up(matched * 10000 / consumed), 0 when consumed is zero."""
    if consumed == 0:
        return 0
    return round_half_up_int(matched * 10000, consumed)


def to_integral_half_up(dec: Decimal) -> Decimal:
    return dec.quantize(Decimal(1), rounding=ROUND_HALF_UP)
