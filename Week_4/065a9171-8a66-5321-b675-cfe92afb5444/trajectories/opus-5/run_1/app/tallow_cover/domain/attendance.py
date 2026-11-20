"""Attendance: open versus missed clock-out, the late flag and the version check."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from ..errors import ApiError
from ..timeutil import (
    LATE_AFTER,
    MISSED_CLOCK_OUT_AFTER,
    elapsed_hours,
    elapsed_seconds,
    shift_window,
)


def rostered_window(record: dict) -> tuple[datetime, datetime]:
    return shift_window(record["shift_date"], record["shift"])


def is_missed_clock_out(record: dict, now: datetime) -> bool:
    """Judged from the clock on every read, so nothing has to run for it to happen."""
    if record["clock_out_at"] is not None:
        return False
    _, rostered_end = rostered_window(record)
    return now >= rostered_end + MISSED_CLOCK_OUT_AFTER


def is_open(record: dict, now: datetime) -> bool:
    return record["clock_out_at"] is None and not is_missed_clock_out(record, now)


def late_flag(clock_in_at: datetime, rostered_start: datetime) -> bool:
    """On time up to and including ten minutes after the rostered start."""
    return clock_in_at > rostered_start + LATE_AFTER


def worked_hours(record: dict, now: datetime) -> Decimal | None:
    if record["clock_out_at"] is None or is_missed_clock_out(record, now):
        return None
    return elapsed_hours(record["clock_in_at"], record["clock_out_at"])


def worked_seconds(record: dict, now: datetime) -> Decimal:
    """Zero for an open attendance or a missed clock-out."""
    if record["clock_out_at"] is None or is_missed_clock_out(record, now):
        return Decimal(0)
    return elapsed_seconds(record["clock_in_at"], record["clock_out_at"])


def parse_if_match(header: str | None) -> int | None:
    if not header:
        return None
    text = header.strip()
    if text.startswith("W/"):
        text = text[2:]
    text = text.strip().strip('"')
    try:
        return int(text)
    except ValueError:
        return None


def ensure_version(header: str | None, record: dict, current: dict) -> None:
    """Corrections send the version they read; a mismatch loses the race."""
    sent = parse_if_match(header)
    if sent is None:
        raise ApiError("version_required")
    if sent != record["version"]:
        raise ApiError("stale_version", current=current)
