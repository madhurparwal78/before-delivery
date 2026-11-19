"""Limits, due instants, the governing limit, the two rails, labels and counts.

Every time and limit rule in the brief is decided here and nowhere else.
"""

from .. import clock

DEFERRAL_DAYS = 7
DEFERRAL_HOURS = 25.0
DUE_SOON_DAYS = 30
DUE_SOON_HOURS = 50.0

OPEN_WORK_STAGES = ("open", "claimed", "inspected", "superseded_retargeted", "reopened")
STUB_STAGES = ("not_applicable", "withdrawn")

LABELS = {
    "withdrawn": "Withdrawn",
    "not_applicable": "Not applicable",
    "certified": "Complied",
    "overdue": "Overdue",
    "superseded_retargeted": "Superseded",
    "deferred": "Deferred",
    "due_soon": "Due soon",
    "open": "Open",
}


def deadline_date(effective_date, calendar_days, deferred):
    return clock.add_days(effective_date, calendar_days + (DEFERRAL_DAYS if deferred else 0))


def fh_threshold(baseline, fh_interval, deferred):
    return round(baseline + fh_interval + (DEFERRAL_HOURS if deferred else 0.0), 1)


def _crossing_instant(logs, level, fallback):
    """When the tail's running total first went strictly above `level`."""
    for logged_at, running_total in logs:
        if running_total > level:
            return logged_at
    return fallback


def _reaching_instant(logs, level, current_hours, fallback):
    """When the tail's running total first reached `level`."""
    for logged_at, running_total in logs:
        if running_total >= level:
            return logged_at
    return fallback if current_hours >= level else None


def evaluate(thread, revision, tail, logs, at):
    """All time-dependent facts of one thread, judged by the server clock.

    `thread` carries fh_baseline, deferred, stage, certified_at and certified_hours.
    `logs` is the tail's ordered (instant, running total) history.
    A certified thread freezes its rails, governing limit and limits at its countersignature.
    """
    frozen = thread["stage"] == "certified" and thread.get("certified_at") is not None
    moment = thread["certified_at"] if frozen else at
    hours = float(thread["certified_hours"]) if frozen else float(tail["total_hours"])

    baseline = float(thread["fh_baseline"])
    deferred = bool(thread["deferred"])
    effective_date = revision["effective_date"]
    due_date = deadline_date(effective_date, revision["calendar_days"], deferred)
    calendar_due_at = clock.day_end(due_date)
    threshold = fh_threshold(baseline, float(revision["fh_interval"]), deferred)

    hours_passed = hours > threshold
    hours_due_at = (
        _crossing_instant(logs, threshold, thread["entered_at"]) if hours_passed else None
    )
    due_at = calendar_due_at
    if hours_due_at is not None:
        due_at = min(calendar_due_at, hours_due_at)

    due_soon_from = clock.day_start(clock.add_days(due_date, -DUE_SOON_DAYS))
    hours_due_soon_at = _reaching_instant(
        logs, threshold - DUE_SOON_HOURS, hours, thread["entered_at"]
    )
    if hours_due_soon_at is not None:
        due_soon_from = min(due_soon_from, hours_due_soon_at)

    span = (calendar_due_at - clock.day_start(effective_date)).total_seconds()
    calendar_used = (moment - clock.day_start(effective_date)).total_seconds() / span
    hours_span = threshold - baseline
    hours_used = (hours - baseline) / hours_span if hours_span > 0 else 1.0

    governing = _governing(
        due_date, calendar_due_at, hours_due_at, threshold, hours, tail, moment
    )
    overdue = thread["stage"] in OPEN_WORK_STAGES + ("deferred",) and (
        moment > due_at or hours_passed
    )

    return {
        "limits": {
            "effective_date": effective_date.isoformat(),
            "calendar_days": revision["calendar_days"],
            "deadline_date": due_date.isoformat(),
            "calendar_due_at": clock.iso(calendar_due_at),
            "fh_interval": float(revision["fh_interval"]),
            "fh_baseline": baseline,
            "fh_threshold": threshold,
            "deferred": deferred,
            "due_at": clock.iso(due_at),
            "due_soon_from": clock.iso(due_soon_from),
        },
        "due_at": due_at,
        "due_soon_from": due_soon_from,
        "calendar_due_at": calendar_due_at,
        "fh_threshold": threshold,
        "governing": governing,
        "calendar_used": _fraction(calendar_used),
        "hours_used": _fraction(hours_used),
        "overdue": overdue,
        "due_soon": thread["stage"] in OPEN_WORK_STAGES and moment >= due_soon_from,
    }


def _governing(due_date, calendar_due_at, hours_due_at, threshold, hours, tail, moment):
    calendar_passed = moment > calendar_due_at
    if hours_due_at is not None and calendar_passed:
        return "CAL" if calendar_due_at <= hours_due_at else "FH"
    remaining = threshold - hours
    utilisation = float(tail["daily_utilisation"])
    projected = clock.add_days(
        moment.astimezone(clock.BASE_TZ).date(), clock.days_ceil(remaining, utilisation)
    )
    return "CAL" if due_date <= projected else "FH"


def _fraction(value):
    return round(max(0.0, min(1.0, value)), 2)


def label_for(stage, overdue, due_soon):
    """The one label precedence: Withdrawn, Not applicable, Complied, Overdue,
    Superseded, Deferred, Due soon, Open."""
    if stage in ("withdrawn", "not_applicable", "certified"):
        return LABELS[stage]
    if overdue:
        return LABELS["overdue"]
    if stage == "superseded_retargeted":
        return LABELS["superseded_retargeted"]
    if stage == "deferred":
        return LABELS["deferred"]
    if due_soon:
        return LABELS["due_soon"]
    return LABELS["open"]


def state_for(stage, overdue):
    return "overdue" if overdue else stage


def timeliness_for(evaluation, hours, at):
    """An inspection is on time at or before the calendar due instant with hours
    at or below the threshold."""
    on_time = at <= evaluation["calendar_due_at"] and hours <= evaluation["fh_threshold"]
    return "on_time" if on_time else "overdue"


def empty_counts():
    return {"open": 0, "due_soon": 0, "overdue": 0, "deferred": 0, "complied": 0}


def count_cell(counts, cell):
    """Each thread counts at most once; stubs are not counted at all."""
    stage, state = cell["stage"], cell["state"]
    if stage in STUB_STAGES:
        return
    if stage == "certified":
        counts["complied"] += 1
    elif state == "overdue":
        counts["overdue"] += 1
    elif stage == "deferred":
        counts["deferred"] += 1
    elif cell["label"] == LABELS["due_soon"]:
        counts["due_soon"] += 1
    else:
        counts["open"] += 1


def add_counts(total, counts):
    for key in total:
        total[key] += counts[key]
    return total
