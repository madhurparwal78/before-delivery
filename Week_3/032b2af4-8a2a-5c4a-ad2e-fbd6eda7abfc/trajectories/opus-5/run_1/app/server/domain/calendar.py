"""Calendar windows taken in the athlete's time zone and written in UTC."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def zone(time_zone: str) -> ZoneInfo:
    return ZoneInfo(time_zone)


def is_known_zone(time_zone: str) -> bool:
    try:
        ZoneInfo(time_zone)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return False
    return True


def now_in(time_zone: str) -> datetime:
    return datetime.now(timezone.utc).astimezone(zone(time_zone))


def _as_utc(local: datetime) -> datetime:
    return local.astimezone(timezone.utc)


def month_window(time_zone: str) -> tuple[datetime, datetime]:
    here = now_in(time_zone)
    start = here.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_month = (start + timedelta(days=32)).replace(day=1)
    return _as_utc(start), _as_utc(next_month)


def year_window(time_zone: str, year: int) -> tuple[datetime, datetime]:
    tz = zone(time_zone)
    start = datetime(year, 1, 1, tzinfo=tz)
    end = datetime(year + 1, 1, 1, tzinfo=tz)
    return _as_utc(start), _as_utc(end)


def current_year(time_zone: str) -> int:
    return now_in(time_zone).year


def week_starts(time_zone: str, weeks: int) -> list[date]:
    here = now_in(time_zone)
    this_monday = here.date() - timedelta(days=here.weekday())
    return [this_monday - timedelta(days=7 * offset) for offset in range(weeks - 1, -1, -1)]


def day_start_utc(time_zone: str, day: date) -> datetime:
    return _as_utc(datetime(day.year, day.month, day.day, tzinfo=zone(time_zone)))
