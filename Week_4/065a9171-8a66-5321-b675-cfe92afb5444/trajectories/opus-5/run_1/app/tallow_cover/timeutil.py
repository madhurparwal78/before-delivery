"""Europe/London business time, shift windows and the brief's display formats."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")

SHIFTS = ("early", "late", "night")
SHIFT_LABELS = {"early": "Early", "late": "Late", "night": "Night"}
SHIFT_WINDOWS = {
    "early": (time(7, 0), time(15, 0), 0),
    "late": (time(15, 0), time(22, 0), 0),
    "night": (time(22, 0), time(8, 0), 1),
}
MISSED_CLOCK_OUT_AFTER = timedelta(hours=4)
LATE_AFTER = timedelta(minutes=10)
CLOCK_IN_OPENS = timedelta(minutes=30)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_london() -> date:
    return now_utc().astimezone(LONDON).date()


def london(moment: datetime) -> datetime:
    return moment.astimezone(LONDON)


def london_wall_clock(day: date, moment: time) -> datetime:
    """A Europe/London wall-clock time as an instant in UTC.

    Instants are kept in UTC because subtracting two datetimes that share a
    Europe/London tzinfo gives the wall-clock difference, not real elapsed time.
    """
    return datetime.combine(day, moment, tzinfo=LONDON).astimezone(timezone.utc)


def shift_window(shift_date: date, shift: str) -> tuple[datetime, datetime]:
    """The shift's start and end as instants, from Europe/London wall-clock times."""
    start_time, end_time, day_offset = SHIFT_WINDOWS[shift]
    return (
        london_wall_clock(shift_date, start_time),
        london_wall_clock(shift_date + timedelta(days=day_offset), end_time),
    )


def shift_hours(shift_date: date, shift: str) -> Decimal:
    """Real elapsed hours of the shift, so clock changes shorten or lengthen it."""
    start, end = shift_window(shift_date, shift)
    return elapsed_hours(start, end)


def elapsed_hours(start: datetime, end: datetime) -> Decimal:
    return (elapsed_seconds(start, end) / Decimal(3600)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def elapsed_seconds(start: datetime, end: datetime) -> Decimal:
    span = end.astimezone(timezone.utc) - start.astimezone(timezone.utc)
    return Decimal(str(span.total_seconds()))


def iso_instant(moment: datetime | None) -> str | None:
    """ISO 8601 at the Europe/London offset in force."""
    if moment is None:
        return None
    return london(moment).isoformat(timespec="seconds")


def parse_instant(raw: object) -> datetime | None:
    """Parse an ISO 8601 instant that carries a UTC offset."""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if text.endswith(("z", "Z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def parse_date(raw: object) -> date | None:
    if not isinstance(raw, str):
        return None
    try:
        return date.fromisoformat(raw.strip())
    except ValueError:
        return None


def parse_period(raw: object) -> str | None:
    """A pay period written like 2026-09."""
    if not isinstance(raw, str) or len(raw.strip()) != 7:
        return None
    text = raw.strip()
    try:
        year, month = text.split("-")
        if len(year) != 4 or len(month) != 2 or not 1 <= int(month) <= 12:
            return None
        int(year)
    except ValueError:
        return None
    return text


def period_of(shift_date: date) -> str:
    return f"{shift_date:%Y-%m}"


def period_bounds(period: str) -> tuple[date, date]:
    year, month = (int(part) for part in period.split("-"))
    first = date(year, month, 1)
    last = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return first, last


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_bounds(iso: str) -> tuple[date, date] | None:
    try:
        year_text, week_text = iso.split("-W")
        monday = date.fromisocalendar(int(year_text), int(week_text), 1)
    except ValueError:
        return None
    return monday, monday + timedelta(days=6)


def leave_year_start(day: date) -> date:
    return date(day.year if day.month >= 4 else day.year - 1, 4, 1)


def leave_year_end(day: date) -> date:
    return date(leave_year_start(day).year + 1, 3, 31)


def format_date(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b} {day:%Y}"


def format_shift_label(shift_date: date, shift: str) -> str:
    return f"{shift_date:%a} {shift_date.day} {shift_date:%b} {SHIFT_LABELS[shift]}"


def format_short_label(shift_date: date, shift: str) -> str:
    return f"{shift_date:%a} {SHIFT_LABELS[shift]}"


def format_clock(moment: datetime) -> str:
    return f"{london(moment):%H:%M}"


def days_inclusive(start: date, end: date) -> int:
    return (end - start).days + 1


def date_range(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)
