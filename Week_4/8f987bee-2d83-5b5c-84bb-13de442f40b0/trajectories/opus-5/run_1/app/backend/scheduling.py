"""`next_run_at`: the one place the manual, interval and cron rules are applied."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from .cron import next_cron_run, parse_cron


def compute_next_run(
    status: str, schedule: dict[str, Any], created_at: datetime, last_started_at: datetime | None
) -> datetime | None:
    if status != "active" or schedule["type"] == "manual":
        return None
    anchor = max(created_at, last_started_at) if last_started_at is not None else created_at
    if schedule["type"] == "interval":
        return anchor + timedelta(minutes=schedule["interval_minutes"])
    return next_cron_run(parse_cron(schedule["cron_expression"]), anchor, schedule["time_zone"])
