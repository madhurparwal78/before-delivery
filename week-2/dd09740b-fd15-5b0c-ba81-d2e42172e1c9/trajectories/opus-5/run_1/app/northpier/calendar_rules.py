"""The one studio calendar: Stockholm time, studio hours, closure days, quarter hours."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

STOCKHOLM = ZoneInfo("Europe/Stockholm")
UTC = timezone.utc

CALL_DURATION = timedelta(minutes=45)
HOURS_OPEN_HOUR = 9
HOURS_CLOSE_HOUR = 17
BOOKING_HORIZON = timedelta(days=90)
QUARTER_MINUTES = (0, 15, 30, 45)

_WEEKDAYS = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)
_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def now_utc() -> datetime:
    return datetime.now(UTC)


def to_stockholm(instant: datetime) -> datetime:
    return instant.astimezone(STOCKHOLM)


def stockholm_date_today(instant: datetime | None = None) -> date:
    return to_stockholm(instant or now_utc()).date()


def stockholm_wall_clock_to_utc(naive: datetime) -> datetime:
    """Read a naive datetime as Stockholm wall-clock time and return the UTC instant."""
    return naive.replace(tzinfo=STOCKHOLM).astimezone(UTC)


def parse_call_at(raw: str) -> datetime | None:
    """ISO 8601 with an offset is that instant; without one it is Stockholm wall clock."""
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return stockholm_wall_clock_to_utc(parsed)
    return parsed.astimezone(UTC)


def easter_sunday(year: int) -> date:
    """Western (Gregorian) Easter Sunday."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    lam = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * lam) // 451
    month = (h + lam - 7 * m + 114) // 31
    day = ((h + lam - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def midsummer_eve(year: int) -> date:
    """The Friday falling between 19 and 25 June."""
    for day in range(19, 26):
        candidate = date(year, 6, day)
        if candidate.weekday() == 4:
            return candidate
    raise AssertionError("June always holds a Friday between the 19th and the 25th")


def closure_days(year: int) -> frozenset[date]:
    """The Stockholm dates on which the studio is closed (Business rules 9)."""
    easter = easter_sunday(year)
    return frozenset(
        {
            date(year, 1, 1),
            date(year, 1, 6),
            easter - timedelta(days=2),
            easter + timedelta(days=1),
            date(year, 5, 1),
            easter + timedelta(days=39),
            date(year, 6, 6),
            midsummer_eve(year),
            date(year, 12, 24),
            date(year, 12, 25),
            date(year, 12, 26),
            date(year, 12, 31),
        }
    )


def is_closure_day(day: date) -> bool:
    return day in closure_days(day.year)


def is_studio_day(day: date) -> bool:
    """Monday to Friday and not a closure day."""
    return day.weekday() < 5 and not is_closure_day(day)


def within_studio_hours(instant: datetime) -> bool:
    """Judged in Stockholm time: weekday, starting at or after 09:00, ending by 17:00."""
    local = to_stockholm(instant)
    if local.weekday() >= 5:
        return False
    if local.hour < HOURS_OPEN_HOUR:
        return False
    local_end = to_stockholm(instant + CALL_DURATION)
    close = local.replace(hour=HOURS_CLOSE_HOUR, minute=0, second=0, microsecond=0)
    return local_end <= close


def on_quarter_hour(instant: datetime) -> bool:
    local = to_stockholm(instant)
    return local.minute in QUARTER_MINUTES and local.second == 0 and local.microsecond == 0


def format_call_time(instant: datetime) -> str:
    """`Thursday 5 November, 14:00` in Stockholm wall-clock time."""
    local = to_stockholm(instant)
    return (
        f"{_WEEKDAYS[local.weekday()]} {local.day} {_MONTHS[local.month - 1]}, "
        f"{local.hour:02d}:{local.minute:02d}"
    )


def format_date(instant: datetime) -> str:
    """`5 November 2026` in Stockholm time."""
    local = to_stockholm(instant)
    return f"{local.day} {_MONTHS[local.month - 1]} {local.year}"


def format_date_time(instant: datetime) -> str:
    """`5 November 2026, 14:00` in Stockholm time."""
    local = to_stockholm(instant)
    return f"{format_date(instant)}, {local.hour:02d}:{local.minute:02d}"


def format_ics_stamp(instant: datetime) -> str:
    return instant.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def iso_utc(instant: datetime | None) -> str | None:
    if instant is None:
        return None
    return instant.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def studio_day_after(start: date, count: int) -> date:
    """The `count`-th studio day strictly after `start`."""
    day = start
    found = 0
    while found < count:
        day += timedelta(days=1)
        if is_studio_day(day):
            found += 1
    return day


def studio_day_on_or_before(start: date) -> date:
    """The latest studio day at or before `start`."""
    day = start
    while not is_studio_day(day):
        day -= timedelta(days=1)
    return day


def time_since(instant: datetime, now: datetime | None = None) -> str:
    """A compact arrival age, for example `6d`, `4h` or `just now`."""
    delta = (now or now_utc()) - instant
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return "just now"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    if seconds < 86400:
        return f"{seconds // 3600}h ago"
    return f"{seconds // 86400}d ago"
