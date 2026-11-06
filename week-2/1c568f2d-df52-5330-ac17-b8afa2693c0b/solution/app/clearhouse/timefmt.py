"""UTC time helpers shared by the API and the pages."""

from datetime import UTC, date, datetime


def now() -> datetime:
    return datetime.now(UTC)


def today() -> date:
    return now().date()


def iso(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")


def relative(moment: datetime) -> str:
    seconds = int((now() - moment).total_seconds())
    if seconds < 45:
        return "just now"
    for size, unit in ((86400 * 365, "year"), (86400 * 30, "month"), (86400, "day"), (3600, "hour"), (60, "minute")):
        if seconds >= size:
            count = seconds // size
            return f"{count} {unit}{'' if count == 1 else 's'} ago"
    return "just now"


def quarter_of(day: date) -> str:
    return f"{day.year}-Q{(day.month - 1) // 3 + 1}"


def quarter_bounds(quarter: str) -> tuple[datetime, datetime]:
    year, number = int(quarter[:4]), int(quarter[-1])
    start = datetime(year, (number - 1) * 3 + 1, 1, tzinfo=UTC)
    end = datetime(year + 1, 1, 1, tzinfo=UTC) if number == 4 else datetime(year, number * 3 + 1, 1, tzinfo=UTC)
    return start, end
