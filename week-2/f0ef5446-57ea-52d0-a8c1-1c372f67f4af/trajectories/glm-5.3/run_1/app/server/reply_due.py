"""The reply-due computation and the partner team's holiday calendar.

`reply_due_at` is derived on every read from `created_at`; it is never stored.
"""
from __future__ import annotations

import datetime as dt

BERLIN = dt.timezone(dt.timedelta(hours=1))
SUMMER = dt.timezone(dt.timedelta(hours=2))

HOLIDAYS = {
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14",
    "2026-05-25", "2026-10-03", "2026-12-24", "2026-12-25", "2026-12-26",
    "2026-12-31", "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-01",
    "2027-05-06", "2027-05-17", "2027-10-03", "2027-12-24", "2027-12-25",
    "2027-12-26", "2027-12-31",
}

OPENING = dt.time(9, 0)
CLOSING = dt.time(17, 0)
BUSINESS_HOURS = 16


def berlin_tz(day: dt.date) -> dt.timezone:
    """Berlin's own summer/winter time, from the last-Sunday rule of March
    and October (a single fixed zone needs no timezone database)."""
    if day.month in (11, 12, 1, 2):
        return BERLIN
    if day.month in (4, 5, 6, 7, 8, 9):
        return SUMMER
    if day.month == 3:
        return SUMMER if day > _last_sunday(day.year, 3) else BERLIN
    return BERLIN if day >= _last_sunday(day.year, 10) else SUMMER


def _last_sunday(year: int, month: int) -> dt.date:
    day = dt.date(year, month, 1) + dt.timedelta(days=30)
    while day.month != month or day.weekday() != 6:
        day -= dt.timedelta(days=1)
    return day


def _is_business_day(day: dt.date) -> bool:
    return day.weekday() < 5 and day.isoformat() not in HOLIDAYS


def _next_opening(day: dt.date) -> dt.datetime:
    while not _is_business_day(day):
        day += dt.timedelta(days=1)
    return dt.datetime.combine(day, OPENING, tzinfo=berlin_tz(day))


def _berlin_local(moment: dt.datetime) -> tuple[dt.datetime, dt.date]:
    day = moment.astimezone(dt.timezone.utc).date()
    return moment.astimezone(berlin_tz(day)), day


def reply_due_at(created_at: dt.datetime) -> dt.datetime:
    """The earliest moment by which 16 Europe/Berlin business hours have
    passed since created_at, weekends and the holidays skipped, as UTC."""
    local, _ = _berlin_local(created_at)
    if not _is_business_day(local.date()) or local.time() >= CLOSING:
        cursor = _next_opening(local.date() + dt.timedelta(days=1))
    elif local.time() < OPENING:
        cursor = local.replace(hour=9, minute=0, second=0, microsecond=0)
    else:
        cursor = local.replace(microsecond=0)
    remaining = BUSINESS_HOURS
    while remaining > 0:
        span = (
            dt.datetime.combine(cursor.date(), CLOSING, tzinfo=cursor.tzinfo)
            - cursor
        ) / dt.timedelta(hours=1)
        take = min(remaining, span)
        cursor += dt.timedelta(hours=take)
        remaining -= take
        if remaining > 0:
            cursor = _next_opening(cursor.date() + dt.timedelta(days=1))
    return cursor.astimezone(dt.timezone.utc).replace(microsecond=0)


def format_berlin(moment: dt.datetime) -> str:
    """`YYYY-MM-DD HH:MM Berlin`, the application's reply_due_at as
    Europe/Berlin wall-clock time."""
    local, _ = _berlin_local(moment)
    return f"{local:%Y-%m-%d %H:%M} Berlin"
