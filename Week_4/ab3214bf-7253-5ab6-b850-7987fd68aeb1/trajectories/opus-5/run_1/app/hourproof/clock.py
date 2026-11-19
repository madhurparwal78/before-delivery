"""The settlement clock: starts at SETTLEMENT_CLOCK_START and advances in real time."""

from __future__ import annotations

import math
import time
from datetime import datetime, timedelta, timezone

from .config import CONFIG

_PROCESS_START = time.monotonic()


def now() -> datetime:
    elapsed = time.monotonic() - _PROCESS_START
    return CONFIG.settlement_clock_start + timedelta(seconds=elapsed)


def instant(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def hour(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")


def parse_instant(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def parse_hour(text: str) -> datetime:
    parsed = datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    if parsed.minute or parsed.second:
        raise ValueError("not an hour instant")
    return parsed


def seconds_left(deadline: datetime | None) -> int | None:
    """Ceiling of the seconds remaining, or None once the instant has passed."""
    if deadline is None:
        return None
    remaining = (deadline - now()).total_seconds()
    if remaining <= 0:
        return None
    return max(1, math.ceil(remaining))
