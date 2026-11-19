"""Cron expressions: the one place they are parsed, matched and advanced."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

_ITEM = re.compile(r"^(?:\*|(\d{1,2})(?:-(\d{1,2}))?)(?:/(\d{1,2}))?$")
_SEARCH_DAYS = 1830


class CronError(ValueError):
    """A malformed cron expression."""


@dataclass(frozen=True)
class Cron:
    minutes: frozenset[int]
    hours: frozenset[int]
    days_of_month: frozenset[int]
    months: frozenset[int]
    days_of_week: frozenset[int]
    day_of_month_restricted: bool
    day_of_week_restricted: bool

    def matches_day(self, moment: datetime) -> bool:
        if moment.month not in self.months:
            return False
        dom = moment.day in self.days_of_month
        dow = (moment.isoweekday() % 7) in self.days_of_week
        if self.day_of_month_restricted and self.day_of_week_restricted:
            return dom or dow
        return dom and dow


def _parse_field(field: str, low: int, high: int) -> frozenset[int]:
    values: set[int] = set()
    for item in field.split(","):
        match = _ITEM.match(item)
        if match is None:
            raise CronError(field)
        start_raw, end_raw, step_raw = match.groups()
        step = int(step_raw) if step_raw is not None else 1
        if step < 1:
            raise CronError(field)
        if start_raw is None:
            start, end = low, high
        else:
            start = int(start_raw)
            end = int(end_raw) if end_raw is not None else start
            if end_raw is not None and start > end:
                raise CronError(field)
            if step_raw is not None and end_raw is None:
                raise CronError(field)
        if not (low <= start <= high and low <= end <= high):
            raise CronError(field)
        values.update(range(start, end + 1, step))
    if not values:
        raise CronError(field)
    return frozenset(values)


def parse_cron(expression: str) -> Cron:
    fields = expression.split(" ")
    if len(fields) != 5 or any(field == "" for field in fields):
        raise CronError(expression)
    minutes = _parse_field(fields[0], 0, 59)
    hours = _parse_field(fields[1], 0, 23)
    days_of_month = _parse_field(fields[2], 1, 31)
    months = _parse_field(fields[3], 1, 12)
    days_of_week_raw = _parse_field(fields[4], 0, 7)
    days_of_week = frozenset(0 if value == 7 else value for value in days_of_week_raw)
    cron = Cron(
        minutes=minutes,
        hours=hours,
        days_of_month=days_of_month,
        months=months,
        days_of_week=days_of_week,
        day_of_month_restricted=not fields[2].startswith("*"),
        day_of_week_restricted=not fields[4].startswith("*"),
    )
    if not _has_matching_day(cron):
        raise CronError(expression)
    return cron


def _has_matching_day(cron: Cron) -> bool:
    day = datetime(2026, 1, 1)
    for offset in range(_SEARCH_DAYS):
        if cron.matches_day(day + timedelta(days=offset)):
            return True
    return False


def known_time_zone(name: str) -> bool:
    if name == "UTC":
        return True
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return name in available_timezones()


def next_cron_run(cron: Cron, anchor: datetime, time_zone: str) -> datetime | None:
    """The first wall-clock minute in `time_zone` strictly after `anchor` that matches."""
    zone = ZoneInfo(time_zone)
    local = anchor.astimezone(zone)
    start = local.replace(second=0, microsecond=0)
    minute_of_day = start.hour * 60 + start.minute
    for offset in range(_SEARCH_DAYS):
        day = (start + timedelta(days=offset)).date()
        probe = datetime(day.year, day.month, day.day)
        if not cron.matches_day(probe):
            continue
        for hour in sorted(cron.hours):
            for minute in sorted(cron.minutes):
                if offset == 0 and hour * 60 + minute <= minute_of_day:
                    continue
                candidate = datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone)
                if not _wall_clock_exists(candidate, zone):
                    continue
                instant = candidate.astimezone(ZoneInfo("UTC"))
                if instant <= anchor:
                    continue
                return instant
    return None


def _wall_clock_exists(candidate: datetime, zone: ZoneInfo) -> bool:
    """A local minute skipped by a daylight-saving jump does not exist, so it never matches."""
    roundtrip = candidate.astimezone(ZoneInfo("UTC")).astimezone(zone)
    return (roundtrip.year, roundtrip.month, roundtrip.day, roundtrip.hour, roundtrip.minute) == (
        candidate.year,
        candidate.month,
        candidate.day,
        candidate.hour,
        candidate.minute,
    )


def smallest_minute_gap(cron: Cron) -> int:
    """The closest two matched minutes come together, counted across the hour."""
    minutes = sorted(cron.minutes)
    if len(minutes) == 1:
        return 60
    gaps = [later - earlier for earlier, later in zip(minutes, minutes[1:])]
    gaps.append(60 - minutes[-1] + minutes[0])
    return min(gaps)
