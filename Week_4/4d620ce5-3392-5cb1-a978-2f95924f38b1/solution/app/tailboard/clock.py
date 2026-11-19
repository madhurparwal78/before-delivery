"""The server clock: the only clock for every rule and recorded time (brief: Business rules, Server clock)."""

import time
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from .config import settings

BASE_ZONE = ZoneInfo("Europe/London")

_started_mono = time.monotonic()
_start = (datetime.fromisoformat(settings.clock_start.replace("Z", "+00:00")).astimezone(UTC)
          if settings.clock_start else None)


def now() -> datetime:
    """Current server instant, truncated to milliseconds so stored and reported times agree."""
    if _start is None:
        moment = datetime.now(UTC)
    else:
        moment = _start + timedelta(seconds=time.monotonic() - _started_mono)
    return moment.replace(microsecond=moment.microsecond // 1000 * 1000)


def today() -> date:
    return now().astimezone(BASE_ZONE).date()


def base_instant(day: date, hour: int = 0, minute: int = 0, second: int = 0) -> datetime:
    """A wall-clock time in the base time zone as a UTC instant."""
    return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=BASE_ZONE).astimezone(UTC)


def iso(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    u = moment.astimezone(UTC)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"
