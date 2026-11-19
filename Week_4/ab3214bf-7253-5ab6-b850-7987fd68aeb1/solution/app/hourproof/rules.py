"""Pure business rules: gap repair, spreads, unit conversion, the allocation digest and the review sample."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation

from .allocation import Line
from .scoring import round_half_up
from .timeutil import HOUR, same_hour_week_earlier

LINEAR_GAP_LIMIT = 2
SAMPLE_SIZE = 25
UNIT_FACTORS = {"kWh": 3, "MWh": 6}
SOURCE_QUALITIES = ("Actual", "Substituted")


@dataclass(frozen=True, slots=True)
class HourRow:
    hour: datetime
    consumed: int | None
    quality: str
    version: int
    reason: str | None


class UnreadableReading(Exception):
    """A provider value that is not a decimal number or names an unknown unit."""


def watt_hours(unit: object, value: object) -> int | None:
    """Exact integer watt-hours of a decimal reading, or None when it is not a whole watt-hour."""
    if unit not in UNIT_FACTORS or not isinstance(value, str):
        raise UnreadableReading
    try:
        scaled = Decimal(value).scaleb(UNIT_FACTORS[str(unit)])
    except InvalidOperation as error:
        raise UnreadableReading from error
    if not scaled.is_finite() or scaled < 0:
        raise UnreadableReading
    return int(scaled) if scaled == scaled.to_integral_value() else None


def repair_gaps(rows: list[HourRow], zone: str) -> dict[datetime, int]:
    """Estimates for every Missing hour a permitted source can fill, by ascending gap."""
    by_hour = {row.hour: row for row in rows}
    filled: dict[datetime, int] = {}
    index = 0
    while index < len(rows):
        if rows[index].quality != "Missing":
            index += 1
            continue
        end = index
        while end + 1 < len(rows) and rows[end + 1].quality == "Missing":
            end += 1
        gap = rows[index : end + 1]
        before = rows[index - 1] if index > 0 else None
        after = rows[end + 1] if end + 1 < len(rows) else None
        if len(gap) <= LINEAR_GAP_LIMIT:
            if before and after and before.quality in SOURCE_QUALITIES and after.quality in SOURCE_QUALITIES:
                assert before.consumed is not None and after.consumed is not None
                span = len(gap) + 1
                for step, row in enumerate(gap, start=1):
                    filled[row.hour] = round_half_up(before.consumed * (span - step) + after.consumed * step, span)
        else:
            for row in gap:
                source = same_hour_week_earlier(row.hour, zone)
                earlier = by_hour.get(source) if source else None
                if earlier and earlier.quality in SOURCE_QUALITIES:
                    assert earlier.consumed is not None
                    filled[row.hour] = earlier.consumed
        index = end + 1
    return filled


def spread_shares(hours: list[datetime], total: int, rows: dict[datetime, HourRow], zone: str) -> list[int]:
    """Split a total over consecutive hours by last week's same local hour, remainder to the largest fractions."""
    weights: list[int] = []
    for hour in hours:
        source = same_hour_week_earlier(hour, zone)
        earlier = rows.get(source) if source else None
        if earlier is None or earlier.quality not in SOURCE_QUALITIES or earlier.consumed is None:
            weights = []
            break
        weights.append(earlier.consumed)
    if not weights or sum(weights) == 0:
        weights = [1] * len(hours)
    weight_sum = sum(weights)
    shares = [total * weight // weight_sum for weight in weights]
    leftover = total - sum(shares)
    order = sorted(range(len(hours)), key=lambda i: (-(total * weights[i] % weight_sum), hours[i]))
    for i in order[:leftover]:
        shares[i] += 1
    return shares


def consecutive(hours: list[datetime]) -> bool:
    return all(later - earlier == HOUR for earlier, later in zip(hours, hours[1:], strict=False))


def allocation_digest(lines: list[Line]) -> str:
    rows = sorted(
        (line.hour.strftime("%Y-%m-%dT%H:00:00Z"), line.bundle_id, str(line.start), str(line.end))
        for line in lines
        if line.status != "Rejected"
    )
    return hashlib.sha256("\n".join("|".join(row) for row in rows).encode()).hexdigest()


def draw_sample(window_id: str, digest: str, hours_with_consumption: list[datetime]) -> list[datetime]:
    """25 hours drawn by the published hash from the hours with consumption, ascending."""
    ordered = sorted(hours_with_consumption)
    wanted = min(SAMPLE_SIZE, len(ordered))
    drawn: list[datetime] = []
    index = 0
    while len(drawn) < wanted:
        seed = hashlib.sha256(f"{window_id}|{digest}|{index}".encode()).hexdigest()
        pick = ordered[int(seed[:16], 16) % len(ordered)]
        if pick not in drawn:
            drawn.append(pick)
        index += 1
    return drawn


def megawatt_hours(wh: int) -> str:
    """Watt-hours as MWh with exactly six decimals, built from integer digits."""
    return f"{wh // 1_000_000}.{wh % 1_000_000:06d}"
