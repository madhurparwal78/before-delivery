"""Time formats: ISO 8601 UTC for the API, and the calendar stamp."""

from __future__ import annotations

from datetime import datetime, timezone


def _utc(moment: datetime) -> datetime:
    return moment.astimezone(timezone.utc).replace(microsecond=0)


def as_iso(moment: datetime | None) -> str | None:
    """An ISO 8601 UTC string with seconds and a Z suffix."""
    if moment is None:
        return None
    return _utc(moment).strftime("%Y-%m-%dT%H:%M:%SZ")


def as_calendar_stamp(moment: datetime) -> str:
    return _utc(moment).strftime("%Y%m%dT%H%M%SZ")
