"""Attendance rules: open or missed clock-out, the late flag, the clock-in window, version and correction checks."""

from datetime import datetime, timedelta

import asyncpg

from . import shifts
from .errors import REASON_MSG, ApiError, Fields, reason

LATE_AFTER = timedelta(minutes=10)
CLOCK_IN_LEAD = timedelta(minutes=30)
CORRECTION_WINDOW = timedelta(hours=4)

# An attendance without a clock-out is a missed clock-out from 4 hours after its rostered end, judged
# from the server clock on every read and write; before that it is open. Nothing stored changes.
MISSED = "(t.clock_out_at IS NULL AND now() >= a.ends_at + interval '4 hours')"
OPEN = "(t.clock_out_at IS NULL AND now() < a.ends_at + interval '4 hours')"

ATTENDANCE_SQL = f"""
SELECT t.*, {MISSED} AS missed_clock_out, a.person_id, a.home_id, a.unit_id, a.date, a.shift, a.starts_at,
       a.ends_at, p.display_name
FROM attendance t JOIN assignments a ON a.id = t.assignment_id JOIN people p ON p.id = a.person_id
"""


def is_late(clock_in: datetime, rostered_start: datetime) -> bool:
    """On time up to and including ten minutes after the rostered start; later is late."""
    return clock_in - rostered_start > LATE_AFTER


async def clockable_assignment(conn: asyncpg.Connection, person_id: str, at: datetime) -> asyncpg.Record | None:
    """The caller's earliest assignment whose window, 30 minutes before its start up to its end, contains `at`
    and that has no attendance yet."""
    return await conn.fetchrow(
        "SELECT a.* FROM assignments a WHERE a.person_id = $1 AND a.starts_at - $3::interval <= $2 AND $2 <= a.ends_at"
        " AND NOT EXISTS (SELECT 1 FROM attendance t WHERE t.assignment_id = a.id) ORDER BY a.starts_at LIMIT 1",
        person_id, at, CLOCK_IN_LEAD)


async def fetch(conn: asyncpg.Connection, attendance_id: str, *, lock: bool = False) -> asyncpg.Record | None:
    return await conn.fetchrow(ATTENDANCE_SQL + " WHERE t.id = $1" + (" FOR UPDATE OF t" if lock else ""),
                               attendance_id)


async def open_attendance(conn: asyncpg.Connection, person_id: str, *, lock: bool = False) -> asyncpg.Record | None:
    return await conn.fetchrow(ATTENDANCE_SQL + f" WHERE a.person_id = $1 AND {OPEN}"
                               + (" FOR UPDATE OF t" if lock else ""), person_id)


async def has_missed(conn: asyncpg.Connection, person_id: str) -> bool:
    return await conn.fetchval("SELECT EXISTS (SELECT 1 FROM attendance t JOIN assignments a ON a.id = t.assignment_id"
                               f" WHERE a.person_id = $1 AND {MISSED})", person_id)


def check_version(if_match: str | None, record: asyncpg.Record, current: dict) -> None:
    """A correction names the version it read; any other version is refused with the record as it stands."""
    if if_match is None:
        raise ApiError("version_required")
    if if_match.strip().removeprefix("W/").strip('"') != str(record["version"]):
        raise ApiError("stale_version", current=current)


def read_correction(fields: Fields, rostered_start: datetime) -> tuple[datetime | None, datetime | None, str | None]:
    """Clock times with a UTC offset, clock-in within 4 hours of the rostered start, clock-out after clock-in."""
    body = fields.body
    offset_msg = "Use a full date and time with a UTC offset."
    clock_in = shifts.parse_instant(body.get("clock_in_at"))
    if clock_in is None:
        fields.fail("clock_in_at", offset_msg)
    elif abs(clock_in - rostered_start) > CORRECTION_WINDOW:
        fields.fail("clock_in_at", "Clock in must be within 4 hours of the rostered start.")
    clock_out = None
    if body.get("clock_out_at") is not None:
        clock_out = shifts.parse_instant(body["clock_out_at"])
        if clock_out is None:
            fields.fail("clock_out_at", offset_msg)
        elif clock_in is not None and clock_out <= clock_in:
            fields.fail("clock_out_at", "Clock out must be after clock in.")
    why = reason(body.get("reason"))
    if why is None:
        fields.fail("reason", REASON_MSG)
    fields.check()
    return clock_in, clock_out, why
