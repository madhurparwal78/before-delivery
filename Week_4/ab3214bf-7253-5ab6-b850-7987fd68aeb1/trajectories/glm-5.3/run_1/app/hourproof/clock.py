"""The settlement clock: starts at SETTLEMENT_CLOCK_START and advances in real time."""
import time
from datetime import datetime, timedelta, timezone

from . import config


class SettlementClock:
    def __init__(self) -> None:
        self._start_wall = time.monotonic()
        self._start_at = config.CLOCK_START

    def now(self) -> datetime:
        return self._start_at + timedelta(seconds=time.monotonic() - self._start_wall)

    def reset(self) -> None:
        self._start_wall = time.monotonic()


CLOCK = SettlementClock()


def now() -> datetime:
    return CLOCK.now()


def utc_now_real() -> datetime:
    return datetime.now(timezone.utc)
