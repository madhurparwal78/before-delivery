"""Business rules with one decision place each: due instant, governing limit, counts, stages."""
import math
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .domain import OPEN_WORK_STAGES

BASE_TZ = ZoneInfo("Europe/London")
CALENDAR_GRACE_DAYS = 7
HOURS_GRACE = 25.0
DUE_SOON_DAYS = 30
DUE_SOON_HOURS = 50.0


def base_midnight(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=BASE_TZ)


def end_of_day(day: date) -> datetime:
    """The calendar due instant is 23:59:59.000 base time on the deadline date."""
    return datetime(day.year, day.month, day.day, 23, 59, 59, tzinfo=BASE_TZ)


def deadline_of(effective_date: date, calendar_days: int) -> date:
    return effective_date + timedelta(days=calendar_days)


def hours_due_instant(threshold: float, total_hours: float, log_instant: datetime | None) -> datetime | None:
    """The moment the log entry that first took the total above the threshold was recorded."""
    if total_hours <= threshold:
        return None
    return log_instant


def thread_limits(*, effective_date: date, calendar_days: int, baseline: float,
                  threshold: float, deadline_date: date, deferred: bool,
                  last_log_at: datetime | None, total_hours: float,
                  hours_due_at: datetime | None = None) -> dict:
    """Limits in force. due_at is never null; it is the earlier known due instant."""
    calendar_due_at = end_of_day(deadline_date)
    due_at = hours_due_at if hours_due_at is not None and hours_due_at < calendar_due_at else calendar_due_at
    due_soon_from = due_soon_instants(
        deadline_date=deadline_date,
        crossing_log=due_soon_hours_crossing(threshold, total_hours, last_log_at),
    )
    return {
        "effective_date": effective_date.isoformat(),
        "calendar_days": calendar_days,
        "deadline_date": deadline_date.isoformat(),
        "calendar_due_at": calendar_due_at.isoformat(),
        "fh_interval": round(threshold - baseline, 1),
        "fh_baseline": round(baseline, 1),
        "fh_threshold": round(threshold, 1),
        "deferred": deferred,
        "due_at": due_at.isoformat(),
        "due_soon_from": due_soon_from.isoformat(),
    }


def due_soon_hours_crossing(threshold: float, total_hours: float,
                            last_log_at: datetime | None) -> datetime | None:
    """Once logged hours reach the due-soon mark the window is open from that log instant."""
    mark = threshold - DUE_SOON_HOURS
    if total_hours < mark or last_log_at is None:
        return None
    return last_log_at


def due_soon_instants(*, deadline_date: date, crossing_log: datetime | None) -> datetime:
    """Due soon from 00:00 base time 30 days before the deadline, or from the moment logged
    hours reach 50.0 below the threshold, whichever comes first."""
    cal_from = base_midnight(deadline_date - timedelta(days=DUE_SOON_DAYS))
    if crossing_log is None:
        return cal_from
    return min(cal_from, crossing_log)


def hours_above_threshold(total_hours: float, threshold: float) -> bool:
    """Hours exactly at the threshold are still within it."""
    return total_hours > threshold


def is_overdue(stage: str, now: datetime, due_at: datetime, total_hours: float, threshold: float) -> bool:
    """A thread is overdue while its stage is open-work or deferred and the clock is past its
    due instant or its hours are above its threshold."""
    if stage not in OPEN_WORK_STAGES and stage != "deferred":
        return False
    if hours_above_threshold(total_hours, threshold):
        return True
    return now > due_at


def is_due_soon(stage: str, now: datetime, due_soon_from: datetime, overdue: bool) -> bool:
    if overdue or stage not in OPEN_WORK_STAGES:
        return False
    return now >= due_soon_from


def governing(deadline_date: date, total_hours: float, threshold: float,
              daily_utilisation: float, now: datetime,
              cal_passed: bool, hours_passed: bool) -> str | None:
    """CAL governs when the deadline date is on or before the projected hours date."""
    if cal_passed and hours_passed:
        return "CAL"
    remaining = threshold - total_hours
    if remaining <= 0:
        return "FH"
    projected = now.astimezone(BASE_TZ).date() + timedelta(days=math.ceil(remaining / daily_utilisation))
    return "CAL" if deadline_date <= projected else "FH"


def rail_fractions(*, effective_date: date, calendar_due_at: datetime, now: datetime,
                   baseline: float, threshold: float, total_hours: float) -> tuple[float, float]:
    calendar_span = (calendar_due_at - base_midnight(effective_date)).total_seconds()
    if calendar_span <= 0:
        calendar_used = 1.0
    else:
        calendar_used = (now - base_midnight(effective_date)).total_seconds() / calendar_span
    hours_span = threshold - baseline
    hours_used = (total_hours - baseline) / hours_span if hours_span > 0 else 1.0
    return clamp01(calendar_used), clamp01(hours_used)


def clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return round(value, 2)


def stage_label(stage: str, state: str) -> str:
    """The label precedence: Withdrawn, Not applicable, Complied, Overdue, Superseded,
    Deferred, Due soon, Open."""
    if stage == "withdrawn":
        return "Withdrawn"
    if stage == "not_applicable":
        return "Not applicable"
    if stage == "certified":
        return "Complied"
    if state == "overdue":
        return "Overdue"
    if stage == "superseded_retargeted":
        return "Superseded"
    if stage == "deferred":
        return "Deferred"
    if state == "due_soon":
        return "Due soon"
    return "Open"


def counts_from_states(states) -> dict:
    """Board counts from thread states, never stored as running totals."""
    buckets = {"open": 0, "due_soon": 0, "overdue": 0, "deferred": 0, "complied": 0}
    for stage, state in states:
        if stage in ("not_applicable", "withdrawn"):
            continue
        if state == "overdue":
            buckets["overdue"] += 1
        elif stage == "certified":
            buckets["complied"] += 1
        elif stage == "deferred":
            buckets["deferred"] += 1
        elif state == "due_soon":
            buckets["due_soon"] += 1
        else:
            buckets["open"] += 1
    return buckets


def empty_counts() -> dict:
    return {"open": 0, "due_soon": 0, "overdue": 0, "deferred": 0, "complied": 0}


def sign_timeliness(committed_at: datetime, calendar_due_at: datetime,
                    total_hours: float, threshold: float) -> str:
    """On time at or before the calendar due instant while hours are at or below the threshold."""
    if committed_at <= calendar_due_at and not hours_above_threshold(total_hours, threshold):
        return "on_time"
    return "overdue"


def allowed_transitions() -> dict:
    """The single stage transition table."""
    return {
        "claim": {"open", "deferred", "reopened"},
        "release": {"claimed", "reopened"},
        "inspect": {"claimed", "reopened"},
        "countersign": {"inspected"},
        "defer": {"open"},
        "confirm_effectivity": {"superseded_retargeted"},
        "reopen": {"certified"},
    }
