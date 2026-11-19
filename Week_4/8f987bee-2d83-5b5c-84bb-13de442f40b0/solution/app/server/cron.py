"""The cron rule: five fields, plain numeric items, wall-clock matching in a time zone across DST."""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

FIELDS = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
_ITEM = re.compile(r"^(\*|\d+|\d+-\d+)(?:/(\d+))?$")
HORIZON_DAYS = 366 * 5 + 2


@dataclass(frozen=True)
class CronSpec:
    minutes: tuple[int, ...]
    hours: tuple[int, ...]
    days: frozenset[int]
    months: frozenset[int]
    weekdays: frozenset[int]
    day_restricted: bool
    weekday_restricted: bool


def _field(text: str, low: int, high: int) -> set[int]:
    values: set[int] = set()
    for item in text.split(","):
        match = _ITEM.match(item)
        if not match:
            raise ValueError("malformed item")
        base, step_text = match.group(1), match.group(2)
        if base == "*":
            start, end = low, high
        elif "-" in base:
            start, end = (int(part) for part in base.split("-"))
            if start > end:
                raise ValueError("reversed range")
        else:
            if step_text is not None:
                raise ValueError("a step needs * or a range")
            start = end = int(base)
        step = int(step_text) if step_text is not None else 1
        if step < 1 or start < low or end > high:
            raise ValueError("out of range")
        values.update(range(start, end + 1, step))
    return values


def parse(expression: str) -> CronSpec:
    parts = expression.split(" ")
    if len(parts) != 5:
        raise ValueError("five fields")
    minute, hour, day, month, weekday = (_field(text, *bounds) for text, bounds in zip(parts, FIELDS))
    return CronSpec(tuple(sorted(minute)), tuple(sorted(hour)), frozenset(day), frozenset(month),
                    frozenset(w % 7 for w in weekday), not parts[2].startswith("*"), not parts[4].startswith("*"))


def _day_matches(spec: CronSpec, day: datetime) -> bool:
    if day.month not in spec.months:
        return False
    by_date = day.day in spec.days if spec.day_restricted else True
    by_weekday = (day.isoweekday() % 7) in spec.weekdays if spec.weekday_restricted else True
    if spec.day_restricted and spec.weekday_restricted:
        return by_date or by_weekday
    return by_date and by_weekday


def next_after(spec: CronSpec, zone: ZoneInfo, anchor: datetime) -> datetime | None:
    """The first existing wall-clock minute in `zone` strictly after `anchor` (UTC); a repeated
    fall-back minute matches only on its first occurrence."""
    day = datetime.combine(anchor.astimezone(zone).date(), datetime.min.time())
    for _ in range(HORIZON_DAYS):
        if _day_matches(spec, day):
            for hour in spec.hours:
                for minute in spec.minutes:
                    local = day.replace(hour=hour, minute=minute)
                    moment = local.replace(tzinfo=zone, fold=0).astimezone(timezone.utc)
                    if moment.astimezone(zone).replace(tzinfo=None) == local and moment > anchor:
                        return moment
        day += timedelta(days=1)
    return None


def smallest_gap(spec: CronSpec) -> int:
    """Minutes between consecutive matched minutes, counted across the hour as well."""
    minutes = spec.minutes
    gaps = [b - a for a, b in zip(minutes, minutes[1:])] + [60 - minutes[-1] + minutes[0]]
    return min(gaps)
