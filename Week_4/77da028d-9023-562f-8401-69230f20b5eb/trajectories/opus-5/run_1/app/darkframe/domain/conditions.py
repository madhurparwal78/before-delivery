"""Hourly sky conditions: what counts as sky-clear, and when they go stale."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

MAX_CLOUD_PCT = 30
MIN_TRANSPARENCY = 3


@dataclass(frozen=True)
class HourEntry:
    hour_start: datetime
    cloud_pct: int
    transparency: int
    seeing: int

    @property
    def sky_clear(self) -> bool:
        return (
            self.cloud_pct <= MAX_CLOUD_PCT and self.transparency >= MIN_TRANSPARENCY
        )


@dataclass(frozen=True)
class Conditions:
    entered_at: datetime | None
    entries: tuple[HourEntry, ...]

    def is_empty(self) -> bool:
        return not self.entries

    def entry_for(self, instant: datetime) -> HourEntry | None:
        """The entry whose hour start is at or before the instant and within an hour."""
        for entry in self.entries:
            if entry.hour_start <= instant < entry.hour_start + timedelta(hours=1):
                return entry
        return None

    def sky_clear_at(self, instant: datetime) -> bool:
        entry = self.entry_for(instant)
        return entry is not None and entry.sky_clear

    def stale_at(self, now: datetime, stale_seconds: int) -> bool:
        if self.entered_at is None:
            return False
        return (now - self.entered_at).total_seconds() > stale_seconds
