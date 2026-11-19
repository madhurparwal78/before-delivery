"""Time-zone helpers built on pytz: the noon rule, local wall-clock instants."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import pytz
from pytz.exceptions import AmbiguousTimeError, NonExistentTimeError

UTC = timezone.utc


def get_zone(name: str):
    return pytz.timezone(name)


def zone_offset(name: str, at_utc: datetime) -> timedelta:
    """The site zone's UTC offset at the given instant."""
    return at_utc.astimezone(get_zone(name)).utcoffset()


def to_site_local(at_utc: datetime, zone_name: str) -> datetime:
    return at_utc.astimezone(get_zone(zone_name))


def format_local_hm(at_utc: datetime, zone_name: str) -> str:
    loc = to_site_local(at_utc, zone_name)
    return loc.strftime("%H:%M")


def format_local_offset(at_utc: datetime, zone_name: str) -> str:
    loc = to_site_local(at_utc, zone_name)
    off = loc.utcoffset() or timedelta(0)
    total = int(off.total_seconds() // 60)
    sign = "-" if total < 0 else "+"
    total = abs(int(total))
    return f"{sign}{total // 60:02d}:{total % 60:02d}"


def format_iso_local(at_utc: datetime, zone_name: str) -> str:
    loc = to_site_local(at_utc, zone_name)
    off = loc.utcoffset() or timedelta(0)
    total = int(off.total_seconds() // 60)
    sign = "-" if total < 0 else "+"
    total = abs(int(total))
    return loc.strftime("%Y-%m-%dT%H:%M:%S") + f"{sign}{total // 60:02d}:{total % 60:02d}"


def parse_date(value: str) -> Optional[datetime]:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def observing_date_utc(at_utc: datetime, zone_name: str) -> datetime:
    """The observing date of an instant under the noon rule (DP-25)."""
    local = to_site_local(at_utc, zone_name)
    if local.hour >= 12:
        return datetime(local.year, local.month, local.day)
    prev = local.date() - timedelta(days=1)
    return datetime(prev.year, prev.month, prev.day)


def localize_wall_time(zone_name: str, date_value, hh: int, mm: int) -> datetime:
    """A zone-aware instant for a wall-clock time, following the DP-53 clock-change rules."""
    zone = get_zone(zone_name)
    naive = datetime(date_value.year, date_value.month, date_value.day, hh, mm)
    try:
        return zone.localize(naive, is_dst=None)  # type: ignore[attr-defined]
    except AmbiguousTimeError:
        first = zone.localize(naive, is_dst=True)  # type: ignore[attr-defined]
        return first
    except NonExistentTimeError:
        gap = find_gap_length(zone, naive)
        return zone.normalize(naive + gap)


def find_gap_length(zone, naive: datetime) -> timedelta:
    """The length of a spring-forward gap containing naive."""
    before = zone.localize(naive.replace(hour=0, minute=0), is_dst=None)  # type: ignore[attr-defined]
    after = zone.normalize(before + timedelta(hours=14))
    delta = after - (before + timedelta(hours=14))
    return -delta if delta < timedelta(0) else delta


def date_of(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def long_date(d: datetime) -> str:
    """Weekday, day without leading zero, month name and year."""
    day = str(d.day)
    month = d.strftime("%B")
    return f"{d.strftime('%A')} {day} {month} {d.year}"
