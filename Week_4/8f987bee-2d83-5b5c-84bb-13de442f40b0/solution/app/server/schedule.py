"""Schedules: their accepted forms, the plan's minimum interval, and `next_run_at`."""

from datetime import datetime, timedelta
from functools import cache
from typing import Any, Literal
from zoneinfo import ZoneInfo, available_timezones

from . import cron
from .db import utcnow
from .inputs import Body

PLAN_MINUTES = {"starter": 60, "team": 15, "scale": 5, "private": 5}
INTERVAL_MAX = 1440


class ScheduleIn(Body):
    type: Literal["manual", "interval", "cron"]
    interval_minutes: int | None = None
    cron_expression: str | None = None
    time_zone: str | None = None


@cache
def zone_names() -> frozenset[str]:
    return frozenset(available_timezones() | {"UTC"})


def normalize(schedule: ScheduleIn) -> tuple[dict[str, Any], dict[str, str]]:
    """The stored and echoed form of a schedule, or the field errors that refuse it."""
    if schedule.type == "manual":
        return {"type": "manual"}, {}
    if schedule.type == "interval":
        minutes = schedule.interval_minutes
        if minutes is None or not 1 <= minutes <= INTERVAL_MAX:
            return {}, {"schedule.interval_minutes": "Enter a whole number of minutes from 1 to 1440."}
        return {"type": "interval", "interval_minutes": minutes}, {}
    errors: dict[str, str] = {}
    expression = schedule.cron_expression
    try:
        spec = cron.parse(expression or "")
        if cron.next_after(spec, ZoneInfo("UTC"), utcnow()) is None:
            raise ValueError("never matches")
    except ValueError:
        errors["schedule.cron_expression"] = "Enter a five-field cron expression that runs at least once."
    zone = schedule.time_zone if schedule.time_zone is not None else "UTC"
    if zone not in zone_names():
        errors["schedule.time_zone"] = "Choose a time zone from the list."
    if errors:
        return {}, errors
    return {"type": "cron", "cron_expression": expression, "time_zone": zone}, {}


def exceeds_plan(schedule: dict[str, Any], plan: str) -> bool:
    minimum = PLAN_MINUTES[plan]
    if schedule["type"] == "interval":
        return schedule["interval_minutes"] < minimum
    if schedule["type"] == "cron":
        return cron.smallest_gap(cron.parse(schedule["cron_expression"])) < minimum
    return False


def next_run_at(schedule: dict[str, Any], status: str, created_at: datetime,
                last_started_at: datetime | None) -> datetime | None:
    if schedule["type"] == "manual" or status != "active":
        return None
    anchor = max(created_at, last_started_at) if last_started_at else created_at
    if schedule["type"] == "interval":
        return anchor + timedelta(minutes=schedule["interval_minutes"])
    return cron.next_after(cron.parse(schedule["cron_expression"]), ZoneInfo(schedule["time_zone"]), anchor)
