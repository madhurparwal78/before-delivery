"""Business time: Europe/London dates, the three shifts as real elapsed time, and the brief's display formats."""

from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
SHIFTS = ("early", "late", "night")
SHIFT_NAMES = {"early": "Early", "late": "Late", "night": "Night"}
_WALL = {"early": (time(7), 0, time(15)), "late": (time(15), 0, time(22)), "night": (time(22), 1, time(8))}


def window(day: date, shift: str) -> tuple[datetime, datetime]:
    """Start and end in UTC; wall-clock times keep their place and the duration follows the clock change."""
    starts, next_day, ends = _WALL[shift]
    start = datetime.combine(day, starts, LONDON).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=next_day), ends, LONDON).astimezone(UTC)
    return start, end


def now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def today() -> date:
    return now().astimezone(LONDON).date()


def london_midnight(day: date) -> datetime:
    return datetime.combine(day, time(0), LONDON).astimezone(UTC)


def monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def leave_year_start(day: date) -> date:
    return date(day.year if day.month >= 4 else day.year - 1, 4, 1)


def instant(value: datetime | None) -> str | None:
    return value.astimezone(LONDON).isoformat(timespec="seconds") if value else None


def hm(value: datetime) -> str:
    return value.astimezone(LONDON).strftime("%H:%M")


def two_places(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), ROUND_HALF_UP))


def hours(seconds: int) -> str:
    return two_places(Decimal(seconds) / 3600)


def fmt_date(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b} {day.year}"


def shift_label(day: date, shift: str) -> str:
    return f"{day:%a} {day.day} {day:%b} {SHIFT_NAMES[shift]}"


def short_label(day: date, shift: str) -> str:
    return f"{day:%a} {SHIFT_NAMES[shift]}"


def parse_date(value) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value) if len(value) == 10 else None
    except ValueError:
        return None


def parse_instant(value) -> datetime | None:
    """An ISO 8601 date and time with a UTC offset, to whole seconds; None when the offset is missing."""
    if not isinstance(value, str) or "T" not in value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.astimezone(UTC).replace(microsecond=0) if parsed.tzinfo else None
