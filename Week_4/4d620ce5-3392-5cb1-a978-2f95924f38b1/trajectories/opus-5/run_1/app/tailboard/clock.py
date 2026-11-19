"""The server clock: the only clock for every rule and every recorded time."""

import datetime
import math
import time
from zoneinfo import ZoneInfo

from .config import BASE_TZ_NAME, config

BASE_TZ = ZoneInfo(BASE_TZ_NAME)
UTC = datetime.timezone.utc

_MONOTONIC_START = time.monotonic()
_WALL_START = None
if config.clock_start:
    _WALL_START = datetime.datetime.fromisoformat(config.clock_start.replace("Z", "+00:00"))
    if _WALL_START.tzinfo is None:
        _WALL_START = _WALL_START.replace(tzinfo=UTC)
    _WALL_START = _WALL_START.astimezone(UTC)


def now():
    """Current server instant, timezone-aware UTC."""
    if _WALL_START is None:
        return datetime.datetime.now(UTC)
    return _WALL_START + datetime.timedelta(seconds=time.monotonic() - _MONOTONIC_START)


def today():
    """Current date in the operator's base time zone."""
    return now().astimezone(BASE_TZ).date()


def iso(instant):
    """ISO 8601 UTC with milliseconds and Z."""
    if instant is None:
        return None
    if isinstance(instant, datetime.datetime):
        if instant.tzinfo is None:
            instant = instant.replace(tzinfo=UTC)
        instant = instant.astimezone(UTC)
        return instant.strftime("%Y-%m-%dT%H:%M:%S.") + f"{instant.microsecond // 1000:03d}Z"
    return str(instant)


def parse_date(text):
    if text is None or isinstance(text, datetime.date):
        return text
    return datetime.date.fromisoformat(str(text))


def day_start(date):
    """00:00:00 base time on a date, as a UTC instant."""
    return datetime.datetime.combine(date, datetime.time(0, 0, 0), BASE_TZ).astimezone(UTC)


def day_end(date):
    """23:59:59.000 base time on a date, as a UTC instant."""
    return datetime.datetime.combine(date, datetime.time(23, 59, 59), BASE_TZ).astimezone(UTC)


def add_days(date, days):
    return date + datetime.timedelta(days=days)


def days_ceil(hours, per_day):
    return int(math.ceil(hours / per_day)) if per_day > 0 else 10**6
