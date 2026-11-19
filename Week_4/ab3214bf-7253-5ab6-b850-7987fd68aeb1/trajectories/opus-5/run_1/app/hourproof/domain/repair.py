"""Automatic gap repair: straight lines for short gaps, last week for longer ones."""

from __future__ import annotations

from datetime import datetime, timedelta

from . import timeline
from .model import ACTUAL, ESTIMATED, MISSING, SUBSTITUTED, Hour
from .numbers import round_half_up

STRAIGHT_LINE_LIMIT = 2
SOURCE_QUALITIES = (ACTUAL, SUBSTITUTED)


def may_substitute(quality: str) -> bool:
    return quality in (MISSING, ESTIMATED)


def may_spread(quality: str) -> bool:
    return quality in (MISSING, ESTIMATED)


def week_earlier_source(
    hours: dict[datetime, Hour], hour_utc: datetime, time_zone: str
) -> int | None:
    """The same local clock hour one local week earlier, if it may be a source."""
    wanted = timeline.local_hour(hour_utc, time_zone)
    source_utc = timeline.shift_local_days(hour_utc, time_zone, -7)
    source = hours.get(source_utc)
    if source is None or source.quality not in SOURCE_QUALITIES:
        return None
    if timeline.local_hour(source_utc, time_zone).clock != wanted.clock:
        return None
    return source.consumed_wh


def repair_gaps(
    hours: list[Hour], time_zone: str
) -> tuple[list[tuple[datetime, int]], list[datetime]]:
    """Each repaired hour with its estimate, and the hours that stay Missing."""
    by_hour = {hour.hour_utc: hour for hour in hours}
    ordered = sorted(by_hour)
    filled: list[tuple[datetime, int]] = []
    unfilled: list[datetime] = []
    for gap in _gaps(ordered, by_hour):
        if len(gap) <= STRAIGHT_LINE_LIMIT:
            estimates = _straight_line(by_hour, gap)
        else:
            estimates = [week_earlier_source(by_hour, hour, time_zone) for hour in gap]
        for hour_utc, estimate in zip(gap, estimates):
            if estimate is None:
                unfilled.append(hour_utc)
                continue
            filled.append((hour_utc, estimate))
            by_hour[hour_utc] = Hour(
                hour_utc=hour_utc,
                consumed_wh=estimate,
                quality=ESTIMATED,
                substitution_reason=None,
                correction_version=by_hour[hour_utc].correction_version,
            )
    return filled, unfilled


def _gaps(ordered: list[datetime], by_hour: dict[datetime, Hour]) -> list[list[datetime]]:
    gaps: list[list[datetime]] = []
    run: list[datetime] = []
    for hour_utc in ordered:
        if by_hour[hour_utc].quality == MISSING:
            run.append(hour_utc)
        elif run:
            gaps.append(run)
            run = []
    if run:
        gaps.append(run)
    return gaps


def _straight_line(
    by_hour: dict[datetime, Hour], gap: list[datetime]
) -> list[int | None]:
    before = by_hour.get(gap[0] - timedelta(hours=1))
    after = by_hour.get(gap[-1] + timedelta(hours=1))
    if (
        before is None
        or after is None
        or before.quality not in SOURCE_QUALITIES
        or after.quality not in SOURCE_QUALITIES
        or before.consumed_wh is None
        or after.consumed_wh is None
    ):
        return [None] * len(gap)
    steps = len(gap) + 1
    span = after.consumed_wh - before.consumed_wh
    estimates: list[int | None] = []
    for position in range(1, steps):
        if span >= 0:
            estimates.append(before.consumed_wh + round_half_up(span * position, steps))
        else:
            estimates.append(before.consumed_wh - round_half_up(-span * position, steps))
    return estimates
