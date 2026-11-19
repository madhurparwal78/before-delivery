"""Time helpers: window hours, bucket keys, local labelling.

All hours are UTC instants of the form YYYY-MM-DDTHH:00:00Z, keyed in UTC.
Local labelling uses the site's time zone from zoneinfo.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HOUR_FORMAT = "%Y-%m-%dT%H:00:00Z"
INSTANT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def format_hour(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(HOUR_FORMAT)


def format_instant(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(INSTANT_FORMAT)


def parse_hour(text: str) -> datetime | None:
    if not isinstance(text, str) or len(text) != len("2026-10-12T07:00:00Z"):
        return None
    try:
        dt = datetime.strptime(text, HOUR_FORMAT)
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc)


def parse_instant(text: str) -> datetime | None:
    if not isinstance(text, str):
        return None
    try:
        dt = datetime.strptime(text, INSTANT_FORMAT)
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc)


def add_hours(dt: datetime, n: int) -> datetime:
    return dt + timedelta(hours=n)


def local_label(hour_utc: datetime, tz: ZoneInfo, *, repeated: bool = False) -> str:
    """<local date> <local hour> local, e.g. 2026-10-12 09:00 local."""
    local = hour_utc.astimezone(tz)
    stamp = local.strftime("%Y-%m-%d %H:00")
    if repeated:
        hour_str = local.strftime("%H:00")
        stamp = local.strftime("%Y-%m-%d") + " " + hour_str + " again"
    return stamp + " local"


def local_date(hour_utc: datetime, tz: ZoneInfo) -> str:
    return hour_utc.astimezone(tz).strftime("%Y-%m-%d")


def week_key(hour_utc: datetime, tz: ZoneInfo) -> str:
    """Monday-midnight week key: the local date of the week's Monday."""
    local = hour_utc.astimezone(tz)
    offset = (local.weekday()) % 7  # Monday=0 -> 0
    monday = local - timedelta(days=local.weekday())
    return monday.strftime("%Y-%m-%d")


def month_key(hour_utc: datetime) -> str:
    """The UTC month of an hour instant."""
    return hour_utc.strftime("%Y-%m")


def tz_info(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def month_hours_utc(month: str, tz: ZoneInfo) -> list[datetime]:
    """The window's UTC hours: one calendar month in the site's time zone."""
    year, mon = month.split("-")
    start_local = datetime(int(year), int(mon), 1, 0, 0, tzinfo=tz)
    if mon == "12":
        next_year, next_mon = int(year) + 1, 1
    else:
        next_year, next_mon = int(year), int(mon) + 1
    end_local = datetime(next_year, next_mon, 1, 0, 0, tzinfo=tz)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    hours: list[datetime] = []
    cur = start_utc
    # round to the whole hour boundary at or before start
    cur = cur.replace(minute=0, second=0, microsecond=0)
    if cur < start_utc:
        cur += timedelta(hours=1)
    while cur < end_utc:
        hours.append(cur)
        cur += timedelta(hours=1)
    return hours


def days_in_month(month: str) -> int:
    year, mon = int(month.split("-")[0]), int(month.split("-")[1])
    if mon == 12:
        next_year, next_mon = year + 1, 1
    else:
        next_year, next_mon = year, int(mon) + 1
    return (datetime(next_year, next_mon, 1) - datetime(year, mon, 1)).days


def is_repeated_hour(hour_utc: datetime, tz: ZoneInfo) -> bool:
    """True when this UTC hour is the second pass of a repeated local clock hour."""
    before = hour_utc - timedelta(hours=1)
    local_now = hour_utc.astimezone(tz)
    local_before = before.astimezone(tz)
    return local_now.strftime("%m-%d %H") == local_before.strftime("%m-%d %H")


def first_pass_hour(hour_utc: datetime, tz: ZoneInfo) -> datetime | None:
    """The UTC hour of the first pass of this hour's local clock hour, when repeated."""
    if not is_repeated_hour(hour_utc, tz):
        return None
    before = hour_utc - timedelta(hours=1)
    return before
