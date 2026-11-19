"""The single server clock (Business rules: server clock)."""
import time
from datetime import datetime, timedelta, timezone

from .config import Config


class Clock:
    """TAILBOARD_CLOCK_START pins the instant the process starts; it then advances in real time."""

    def __init__(self, start_iso: str | None):
        if start_iso:
            start = parse_iso(start_iso)
            self._epoch = start
            self._anchor = time.monotonic()
        else:
            self._epoch = None
            self._anchor = None

    def now(self) -> datetime:
        if self._epoch is None:
            return datetime.now(timezone.utc)
        return self._epoch + timedelta(seconds=time.monotonic() - self._anchor)

    def iso(self) -> str:
        return format_iso(self.now())


def parse_iso(value: str) -> datetime:
    value = value.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_iso(moment: datetime) -> str:
    moment = moment.astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


CLOCK: Clock | None = None


def clock() -> Clock:
    global CLOCK
    if CLOCK is None:
        CLOCK = Clock(None)
    return CLOCK


def init_clock(cfg: Config) -> Clock:
    global CLOCK
    CLOCK = Clock(cfg.clock_start)
    return CLOCK
