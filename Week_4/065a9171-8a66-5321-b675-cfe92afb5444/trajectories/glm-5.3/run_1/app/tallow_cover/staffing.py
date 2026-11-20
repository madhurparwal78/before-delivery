"""The staffing preview and the approval floor check: one on-duty rule for Today,
the preview and approval, and the one breach-label rule."""
import datetime as dt

from . import decode as dc
from . import domain, repo
from .domain import SHIFTS
from .errors import floor_breach


def requester_away_dates(conn, requester_id, date_from, date_to):
    """Dates in the window on which the requester is already away."""
    rows = conn.execute(
        f"""
        select a.date from assignments a
        where a.person_id = $1 and a.date between $2 and $3 and not ({repo.AWAY_SQL})
        """, [requester_id, date_from.isoformat(), date_to.isoformat()])
    return {dc.d(r[0]) for r in rows}


def affected_shifts(conn, request):
    """{(date, shift): True} where the requester is rostered and not already away."""
    away = requester_away_dates(conn, request["requester_id"],
                                request["start_date"], request["end_date"])
    rows = conn.execute(
        "select date, shift from assignments where person_id = $1 and date between $2 and $3",
        [request["requester_id"], request["start_date"].isoformat(),
         request["end_date"].isoformat()])
    return {(dc.d(r[0]), dc.s(r[1])) for r in rows if dc.d(r[0]) not in away}


def preview_body(conn, request, from_date, requester=None):
    """The preview for the 7 days starting at from_date, plus whole-request breaches."""
    requester = requester or repo.get_person(conn, request["requester_id"])
    counts = repo.on_duty_counts(conn, request["unit_id"],
                                 request["start_date"], request["end_date"])
    to_date = from_date + dt.timedelta(days=6)
    window_counts = repo.on_duty_counts(conn, request["unit_id"],
                                        min(from_date, request["start_date"]),
                                        max(to_date, request["end_date"]))
    affected = affected_shifts(conn, request)
    is_senior = requester["skill"] == "senior"

    breaches = []
    breach_labels = []
    for date in daterange(request["start_date"], request["end_date"]):
        for shift in SHIFTS:
            key = (date, shift)
            if key not in affected:
                continue
            floor = repo.effective_floor(conn, request["unit_id"], shift, date)
            if floor is None:
                continue
            on_duty, seniors = counts.get(key, (0, 0))
            if_approved = on_duty - 1
            seniors_approved = seniors - (1 if is_senior else 0)
            shortfall = max(0, floor["min_staff"] - if_approved)
            senior_shortfall = max(0, floor["min_seniors"] - seniors_approved)
            if shortfall > 0 or senior_shortfall > 0:
                breaches.append({"date": date, "shift": shift,
                                 "label": domain.short_label(date, shift),
                                 "on_duty": on_duty, "on_duty_if_approved": if_approved,
                                 "min_staff": floor["min_staff"],
                                 "seniors_on_duty": seniors,
                                 "seniors_if_approved": seniors_approved,
                                 "min_seniors": floor["min_seniors"]})
                breach_labels.append(domain.short_label(date, shift))

    waits_decision = request["status"] in ("submitted", "escalated", "cover_pending")
    approvable = waits_decision and not breaches

    if request["unit_id"] is None:
        return {"request_id": request["id"], "unit_id": None,
                "from": from_date.isoformat(),
                "to": (from_date + dt.timedelta(days=6)).isoformat(),
                "scale_max": 0, "uncovered_breaches": 0, "breach_labels": [],
                "approvable": approvable, "shifts": []}

    week = [from_date + dt.timedelta(days=i) for i in range(7)]
    shifts = []
    scale_max = 0
    for date in week:
        for shift in SHIFTS:
            key = (date, shift)
            floor = repo.effective_floor(conn, request["unit_id"], shift, date)
            on_duty, seniors = window_counts.get(key, (0, 0))
            is_affected = key in affected
            if_approved = on_duty - 1 if is_affected else on_duty
            seniors_approved = seniors - 1 if (is_affected and is_senior) else seniors
            shortfall = max(0, (floor["min_staff"] if floor else 0) - if_approved)
            senior_shortfall = max(0, (floor["min_seniors"] if floor else 0) - seniors_approved)
            scale_max = max(scale_max, on_duty, (floor["min_staff"] if floor else 0) + 2)
            shifts.append({
                "date": date.isoformat(), "shift": shift,
                "label": domain.shift_label(date, shift),
                "floor": floor or {"min_staff": 0, "min_seniors": 0,
                                   "effective_from": None},
                "on_duty": on_duty, "seniors_on_duty": seniors,
                "affected": is_affected,
                "on_duty_if_approved": if_approved,
                "seniors_if_approved": seniors_approved,
                "shortfall": shortfall, "senior_shortfall": senior_shortfall,
                "gaps": gap_list(conn, request, date, shift, senior_shortfall, shortfall),
            })
    return {"request_id": request["id"], "unit_id": request["unit_id"],
            "from": from_date.isoformat(), "to": week[-1].isoformat(),
            "scale_max": scale_max, "uncovered_breaches": len(breaches),
            "breach_labels": breach_labels, "approvable": approvable,
            "shifts": shifts}


def gap_list(conn, request, date, shift, senior_shortfall, shortfall):
    """Gap slots for one shift: seniors first, then carers, each with its open cover."""
    count = max(shortfall, senior_shortfall)
    if count == 0:
        return []
    skills = ["senior"] * senior_shortfall + ["carer"] * (count - senior_shortfall)
    open_covers = {dc.s(r[0]): dc.s(r[1]) for r in conn.execute(
        "select skill, id from covers where leave_request_id = $1 and date = $2"
        " and shift = $3 and status = 'open'",
        [request["id"], date.isoformat(), shift])}
    return [{"skill": skill, "cover": open_covers.get(skill)} for skill in skills]


def daterange(start, end):
    day = start
    while day <= end:
        yield day
        day += dt.timedelta(days=1)


def check_approval_floor(conn, request, requester):
    """Recompute every affected shift from current counts inside the transaction.

    Returns the breach list; empty when approving keeps every shift at floor.
    """
    if request["unit_id"] is None:
        return []
    conn.execute("select id from units where id = $1 for update",
                 [request["unit_id"]])
    counts = repo.on_duty_counts(conn, request["unit_id"],
                                request["start_date"], request["end_date"])
    affected = affected_shifts(conn, request)
    is_senior = requester["skill"] == "senior"
    breaches = []
    for date in daterange(request["start_date"], request["end_date"]):
        for shift in SHIFTS:
            key = (date, shift)
            if key not in affected:
                continue
            floor = repo.effective_floor(conn, request["unit_id"], shift, date)
            if floor is None:
                continue
            on_duty, seniors = counts.get(key, (0, 0))
            if_approved = on_duty - 1
            seniors_approved = seniors - (1 if is_senior else 0)
            shortfall = max(0, floor["min_staff"] - if_approved)
            senior_shortfall = max(0, floor["min_seniors"] - seniors_approved)
            if shortfall > 0 or senior_shortfall > 0:
                breaches.append({
                    "date": date.isoformat(), "shift": shift,
                    "label": domain.short_label(date, shift),
                    "on_duty": on_duty, "on_duty_if_approved": if_approved,
                    "min_staff": floor["min_staff"],
                    "seniors_on_duty": seniors,
                    "seniors_if_approved": seniors_approved,
                    "min_seniors": floor["min_seniors"]})
    return breaches


def raise_floor_breach(breaches):
    raise floor_breach(breaches)
