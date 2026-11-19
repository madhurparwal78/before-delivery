"""The settlement clock: starts at SETTLEMENT_CLOCK_START when the process starts and runs in real time."""

from __future__ import annotations

import math
import time
from datetime import datetime, timedelta, timezone

HOUR_FORMAT = "%Y-%m-%dT%H:00:00Z"
INSTANT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


class SettlementClock:
    def __init__(self, start: datetime) -> None:
        self._start = start
        self._origin = time.monotonic()

    def now(self) -> datetime:
        return self._start + timedelta(seconds=time.monotonic() - self._origin)


def format_hour(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime(HOUR_FORMAT)


def format_instant(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime(INSTANT_FORMAT)


def parse_hour(text: object) -> datetime | None:
    """An hour instant `YYYY-MM-DDTHH:00:00Z`, or None when the text is anything else."""
    if not isinstance(text, str) or len(text) != 20:
        return None
    try:
        return datetime.strptime(text, HOUR_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def seconds_left(target: datetime, now: datetime) -> int | None:
    """The ceiling of the time remaining, or None once the target has passed."""
    remaining = (target - now).total_seconds()
    return math.ceil(remaining) if remaining > 0 else None
