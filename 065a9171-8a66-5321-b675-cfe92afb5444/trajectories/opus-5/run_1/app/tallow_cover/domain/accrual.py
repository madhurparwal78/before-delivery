"""Holiday accrual: the one formula, pending hours and the pay-period ledger."""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

ACCRUAL_RATE = Decimal("0.1207")
FOUR_PLACES = Decimal("0.0001")


def accrued_hours(worked_seconds: Decimal) -> Decimal:
    """12.07% of real worked time in hours, rounded up at the fourth decimal place."""
    hours = worked_seconds * ACCRUAL_RATE / Decimal(3600)
    return hours.quantize(FOUR_PLACES, rounding=ROUND_CEILING)


def ledger_worked_hours(worked_seconds: Decimal) -> Decimal:
    """Worked seconds in hours, rounded half up at the fourth place."""
    return (worked_seconds / Decimal(3600)).quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)
