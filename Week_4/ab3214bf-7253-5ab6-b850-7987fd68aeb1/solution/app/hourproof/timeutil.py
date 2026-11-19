"""Window hours and site-local time. Hours are UTC instants; local time is derived per site zone."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
HOUR = timedelta(hours=1)


def month_bounds(zone: str, month: str) -> tuple[datetime, datetime]:
    """The half-open UTC range of one calendar month in the site's time zone."""
    year, number = (int(part) for part in month.split("-"))
    tz = ZoneInfo(zone)
    following = (year + number // 12, number % 12 + 1)
    start = datetime(year, number, 1, tzinfo=tz).astimezone(UTC)
    end = datetime(following[0], following[1], 1, tzinfo=tz).astimezone(UTC)
    return start, end


def window_hours(zone: str, month: str) -> list[datetime]:
    start, end = month_bounds(zone, month)
    return [start + HOUR * step for step in range(int((end - start) / HOUR))]


def months_touched(hours: list[datetime]) -> list[str]:
    """Every UTC month the hours touch, ascending."""
    return sorted({f"{hour.year:04d}-{hour.month:02d}" for hour in hours})


def local_of(hour: datetime, zone: str) -> datetime:
    return hour.astimezone(ZoneInfo(zone))


def local_label(hour: datetime, zone: str) -> str:
    local = local_of(hour, zone)
    again = " again" if local.fold else ""
    return f"{local:%Y-%m-%d} {local:%H}:00{again}"


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def same_hour_week_earlier(hour: datetime, zone: str) -> datetime | None:
    """The same local clock hour seven local days earlier, taking the first pass of a repeated hour."""
    tz = ZoneInfo(zone)
    wall = local_of(hour, zone).replace(tzinfo=None) - timedelta(days=7)
    earlier = wall.replace(tzinfo=tz, fold=0).astimezone(UTC)
    exists = earlier.astimezone(tz).replace(tzinfo=None) == wall
    return earlier if exists else None


def cancel_by(production_month: str) -> datetime:
    """The first UTC instant of the fourth calendar month after the production month."""
    year, number = (int(part) for part in production_month.split("-"))
    index = year * 12 + number - 1 + 4
    return datetime(index // 12, index % 12 + 1, 1, tzinfo=UTC)


def utc_month(hour: datetime) -> str:
    return f"{hour.year:04d}-{hour.month:02d}"
