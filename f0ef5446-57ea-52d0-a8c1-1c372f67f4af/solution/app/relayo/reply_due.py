"""Reply due: 16 Europe/Berlin business hours after submission, derived on every read."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
OPENING = time(9)
CLOSING = time(17)
BUSINESS_HOURS = timedelta(hours=16)
HOLIDAYS = frozenset(date.fromisoformat(day) for day in (
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-10-03",
    "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31", "2027-01-01", "2027-03-26", "2027-03-29",
    "2027-05-01", "2027-05-06", "2027-05-17", "2027-10-03", "2027-12-24", "2027-12-25", "2027-12-26",
    "2027-12-31",
))


def reply_due_at(created_at: datetime) -> datetime:
    remaining = BUSINESS_HOURS
    day = created_at.astimezone(BERLIN).date()
    while True:
        if day.weekday() < 5 and day not in HOLIDAYS:
            opens = datetime.combine(day, OPENING, BERLIN).astimezone(timezone.utc)
            closes = datetime.combine(day, CLOSING, BERLIN).astimezone(timezone.utc)
            start = max(created_at, opens)
            if start < closes:
                if start + remaining <= closes:
                    return (start + remaining).replace(microsecond=0)
                remaining -= closes - start
        day += timedelta(days=1)
