"""Timestamps: ISO 8601 UTC in whole seconds, and plain calendar dates."""

from __future__ import annotations

from datetime import date, datetime, timezone


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def calendar(value: date | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()
