"""The timesheet CSV: its columns, its order and its formula neutralising."""

from __future__ import annotations

import csv
import io
from datetime import datetime

from ..timeutil import SHIFT_LABELS, SHIFTS, iso_instant, shift_window
from .attendance import is_missed_clock_out, worked_hours

HEADER = (
    "home",
    "unit",
    "staff_number",
    "display_name",
    "role",
    "shift_date",
    "shift",
    "rostered_start",
    "rostered_end",
    "clock_in",
    "clock_out",
    "worked_hours",
    "late",
    "correction_note",
)
FORMULA_STARTS = ("=", "+", "-", "@")


def neutralise(cell: str) -> str:
    """A cell that would read as a formula is written as text."""
    return f"'{cell}" if cell[:1] in FORMULA_STARTS else cell


def _row(record: dict, now: datetime) -> list[str]:
    rostered_start, rostered_end = shift_window(record["shift_date"], record["shift"])
    hours = worked_hours(record, now)
    open_or_missed = record["clock_out_at"] is None or is_missed_clock_out(record, now)
    return [
        neutralise(record["home_name"]),
        neutralise(record["unit_name"]),
        neutralise(record["person_id"]),
        neutralise(record["person_name"]),
        record["role"],
        record["shift_date"].isoformat(),
        SHIFT_LABELS[record["shift"]],
        iso_instant(rostered_start),
        iso_instant(rostered_end),
        iso_instant(record["clock_in_at"]),
        "" if open_or_missed else iso_instant(record["clock_out_at"]),
        "" if hours is None else f"{hours:.2f}",
        "yes" if record["late"] else "no",
        neutralise(record["correction_note"] or ""),
    ]


def build_csv(records: list[dict], now: datetime) -> tuple[bytes, int]:
    ordered = sorted(
        records,
        key=lambda record: (
            record["home_name"],
            record["unit_name"],
            record["shift_date"],
            SHIFTS.index(record["shift"]),
            record["person_id"],
        ),
    )
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow(HEADER)
    for record in ordered:
        writer.writerow(_row(record, now))
    return buffer.getvalue().encode("utf-8"), len(ordered)
