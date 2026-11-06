"""Studio time: Stockholm conversion, studio hours, closure days, quarter hours and the call window."""
import calendar
import datetime as dt
import re
from zoneinfo import ZoneInfo

STOCKHOLM = ZoneInfo("Europe/Stockholm")
UTC = dt.timezone.utc
CALL_LENGTH = dt.timedelta(minutes=45)
CALL_WINDOW = dt.timedelta(days=90)
OPENS = dt.timedelta(hours=9)
CLOSES = dt.timedelta(hours=17)

_CALL_AT = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|z|[+-]\d{2}:\d{2})?")


def easter_sunday(year: int) -> dt.date:
    """Western (Gregorian) Easter Sunday."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    weekday_shift = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * weekday_shift) // 451
    month, day = divmod(h + weekday_shift - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


def is_closure_day(day: dt.date) -> bool:
    easter = easter_sunday(day.year)
    fixed = {(1, 1), (1, 6), (5, 1), (6, 6), (12, 24), (12, 25), (12, 26), (12, 31)}
    movable = {easter - dt.timedelta(days=2), easter + dt.timedelta(days=1), easter + dt.timedelta(days=39)}
    midsummer_eve = day.month == 6 and 19 <= day.day <= 25 and day.weekday() == calendar.FRIDAY
    return (day.month, day.day) in fixed or day in movable or midsummer_eve


def is_studio_day(day: dt.date) -> bool:
    return day.weekday() < 5 and not is_closure_day(day)


def stockholm_date(moment: dt.datetime) -> dt.date:
    return moment.astimezone(STOCKHOLM).date()


def at_stockholm(day: dt.date, hour: int, minute: int = 0) -> dt.datetime:
    """The UTC instant of a Stockholm wall-clock time on `day`, under that date's daylight-saving rule."""
    return dt.datetime(day.year, day.month, day.day, hour, minute, tzinfo=STOCKHOLM).astimezone(UTC)


def parse_call_at(value: object) -> dt.datetime | None:
    """A `call_at` string as a UTC instant: with Z or an offset it is that instant, without one it is read as
    Stockholm wall-clock time. None when it is not a readable string."""
    if type(value) is not str:
        return None
    match = _CALL_AT.fullmatch(value)
    if not match:
        return None
    year, month, day, hour, minute = (int(part) for part in match.group(1, 2, 3, 4, 5))
    second = int(match.group(6) or 0)
    micro = int((match.group(7) or ".0")[1:].ljust(6, "0")[:6])
    zone = match.group(8)
    if zone is None:
        tz: dt.tzinfo = STOCKHOLM
    elif zone in ("Z", "z"):
        tz = UTC
    else:
        sign = 1 if zone[0] == "+" else -1
        tz = dt.timezone(sign * dt.timedelta(hours=int(zone[1:3]), minutes=int(zone[4:6])))
    try:
        return dt.datetime(year, month, day, hour, minute, second, micro, tzinfo=tz).astimezone(UTC)
    except (ValueError, OverflowError):
        return None


def call_time_problem(value: object, now: dt.datetime) -> str | None:
    """The first failing `call_at` check, in the Messages table order, or None when the time is bookable."""
    start = parse_call_at(value)
    if start is None or start <= now:
        return "future"
    if start > now + CALL_WINDOW:
        return "too_far"
    local = start.astimezone(STOCKHOLM)
    since_midnight = dt.timedelta(hours=local.hour, minutes=local.minute, seconds=local.second,
                                  microseconds=local.microsecond)
    if local.weekday() >= 5 or since_midnight < OPENS or since_midnight + CALL_LENGTH > CLOSES:
        return "hours"
    if is_closure_day(local.date()):
        return "closed"
    if local.minute % 15 or local.second or local.microsecond:
        return "quarter"
    return None


def call_label(moment: dt.datetime) -> str:
    """`<weekday> <day> <month>, <HH:mm>` in Stockholm time, e.g. `Thursday 5 November, 14:00`."""
    local = moment.astimezone(STOCKHOLM)
    return f"{calendar.day_name[local.weekday()]} {local.day} {calendar.month_name[local.month]}, {local:%H:%M}"


def stamp_label(moment: dt.datetime) -> str:
    """A history or note time in Stockholm, e.g. `5 Nov 2026, 14:02`."""
    local = moment.astimezone(STOCKHOLM)
    return f"{local.day} {calendar.month_abbr[local.month]} {local.year}, {local:%H:%M}"


def date_label(moment: dt.datetime) -> str:
    local = moment.astimezone(STOCKHOLM)
    return f"{local.day} {calendar.month_name[local.month]} {local.year}"


def zulu(moment: dt.datetime | None, seconds_only: bool = False) -> str | None:
    """ISO 8601 UTC ending in Z; `call_at` is written to the second."""
    if moment is None:
        return None
    utc = moment.astimezone(UTC)
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ") if seconds_only else utc.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
