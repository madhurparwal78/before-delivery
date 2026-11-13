"""An athlete's calendar: months, weeks and years are taken in their time zone, instants stay in UTC."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def local_midnight(day: date, zone: ZoneInfo) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=zone).astimezone(timezone.utc)


def month_window(zone_name: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(zone_name)
    today = utc_now().astimezone(zone).date()
    first = today.replace(day=1)
    following = (first + timedelta(days=32)).replace(day=1)
    return local_midnight(first, zone), local_midnight(following, zone)


def year_window(zone_name: str, year: int) -> tuple[datetime, datetime]:
    zone = ZoneInfo(zone_name)
    return local_midnight(date(year, 1, 1), zone), local_midnight(date(year + 1, 1, 1), zone)


def current_year(zone_name: str) -> int:
    return utc_now().astimezone(ZoneInfo(zone_name)).year


def week_starts(zone_name: str, weeks: int) -> list[date]:
    """The Mondays of the last `weeks` weeks in the zone, oldest first, the last being the current week."""
    today = utc_now().astimezone(ZoneInfo(zone_name)).date()
    monday = today - timedelta(days=today.weekday())
    return [monday - timedelta(days=7 * k) for k in range(weeks - 1, -1, -1)]
