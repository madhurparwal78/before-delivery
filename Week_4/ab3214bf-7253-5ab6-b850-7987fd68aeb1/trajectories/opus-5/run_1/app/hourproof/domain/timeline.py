"""A window's hours, the site's local clock, and the grain buckets cut from them."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HOUR = timedelta(hours=1)


def zone_of(time_zone: str) -> ZoneInfo:
    return ZoneInfo(time_zone)


def month_parts(month: str) -> tuple[int, int]:
    return int(month[0:4]), int(month[5:7])


def month_bounds(month: str, time_zone: str) -> tuple[datetime, datetime]:
    """The half-open UTC range of one calendar month in the site's time zone."""
    zone = zone_of(time_zone)
    year, number = month_parts(month)
    start_local = datetime(year, number, 1, tzinfo=zone)
    end_local = datetime(year + (number == 12), (number % 12) + 1, 1, tzinfo=zone)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def hours_between(start_utc: datetime, end_utc: datetime) -> list[datetime]:
    hours = []
    cursor = start_utc
    while cursor < end_utc:
        hours.append(cursor)
        cursor += HOUR
    return hours


def opens_at(end_utc: datetime) -> datetime:
    return end_utc + timedelta(hours=48)


@dataclass(frozen=True)
class LocalHour:
    date: str
    clock: str
    again: bool

    @property
    def label(self) -> str:
        again = " again" if self.again else ""
        return f"{self.date} {self.clock}{again} local"


def local_hour(hour_utc: datetime, time_zone: str) -> LocalHour:
    zone = zone_of(time_zone)
    local = hour_utc.astimezone(zone)
    previous = (hour_utc - HOUR).astimezone(zone)
    again = previous.hour == local.hour and previous.date() == local.date()
    return LocalHour(
        date=local.strftime("%Y-%m-%d"), clock=local.strftime("%H:00"), again=again
    )


def local_date_key(hour_utc: datetime, time_zone: str) -> str:
    return hour_utc.astimezone(zone_of(time_zone)).strftime("%Y-%m-%d")


def local_week_key(hour_utc: datetime, time_zone: str) -> str:
    """The local date of the Monday that starts this hour's local week."""
    local = hour_utc.astimezone(zone_of(time_zone))
    monday = local.date() - timedelta(days=local.weekday())
    return monday.strftime("%Y-%m-%d")


def first_pass_hour(date: str, clock: str, time_zone: str) -> datetime:
    """The UTC instant of a local date and clock hour, taking a repeat's first pass."""
    zone = zone_of(time_zone)
    year, month, day = (int(part) for part in date.split("-"))
    naive = datetime(year, month, day, int(clock[0:2]), tzinfo=zone)
    folded = naive.replace(fold=0)
    return folded.astimezone(timezone.utc)


def shift_local_days(hour_utc: datetime, time_zone: str, days: int) -> datetime:
    """The same local clock hour on a local date some days away, first pass."""
    local = local_hour(hour_utc, time_zone)
    year, month, day = (int(part) for part in local.date.split("-"))
    shifted = datetime(year, month, day) + timedelta(days=days)
    return first_pass_hour(shifted.strftime("%Y-%m-%d"), local.clock, time_zone)
