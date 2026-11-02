"""The reply-due rule: 16 Europe/Berlin business hours after submission."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
BUSINESS_START = time(9, 0)
BUSINESS_END = time(17, 0)
BUSINESS_HOURS = 16

HOLIDAYS = frozenset(
    date.fromisoformat(day)
    for day in (
        "2026-01-01",
        "2026-04-03",
        "2026-04-06",
        "2026-05-01",
        "2026-05-14",
        "2026-05-25",
        "2026-10-03",
        "2026-12-24",
        "2026-12-25",
        "2026-12-26",
        "2026-12-31",
        "2027-01-01",
        "2027-03-26",
        "2027-03-29",
        "2027-05-01",
        "2027-05-06",
        "2027-05-17",
        "2027-10-03",
        "2027-12-24",
        "2027-12-25",
        "2027-12-26",
        "2027-12-31",
    )
)


def is_business_day(day: date) -> bool:
    return day.weekday() < 5 and day not in HOLIDAYS


def reply_due_at(created_at: datetime) -> datetime:
    """The earliest moment by which 16 business hours have passed since submission."""
    local = created_at.astimezone(BERLIN).replace(microsecond=0)
    position = local.replace(tzinfo=None)
    remaining = timedelta(hours=BUSINESS_HOURS)

    while True:
        day = position.date()
        if not is_business_day(day):
            position = datetime.combine(day + timedelta(days=1), BUSINESS_START)
            continue
        opening = datetime.combine(day, BUSINESS_START)
        closing = datetime.combine(day, BUSINESS_END)
        if position < opening:
            position = opening
        elif position >= closing:
            position = datetime.combine(day + timedelta(days=1), BUSINESS_START)
            continue
        available = closing - position
        if remaining <= available:
            due = position + remaining
            return due.replace(tzinfo=BERLIN).astimezone(timezone.utc)
        remaining -= available
        position = datetime.combine(day + timedelta(days=1), BUSINESS_START)
