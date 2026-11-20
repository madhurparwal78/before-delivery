"""Leave requests: the transition table, hours, sick-covered hours and the balance."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from ..db import row, rows
from ..errors import invalid_transition
from ..timeutil import leave_year_end, leave_year_start, shift_hours
from .roster import load_absences, person_assignments

LEAVE_TYPES = ("annual", "unpaid", "compassionate")
TYPE_LABELS = {
    "annual": "Annual leave",
    "unpaid": "Unpaid leave",
    "compassionate": "Compassionate leave",
}
ENTITLEMENT_HOURS = Decimal("168.00")
MAX_LENGTH_DAYS = 28

AWAITING_DECISION = ("submitted", "escalated", "cover_pending")
BOOKED_STATUSES = ("submitted", "escalated", "cover_pending", "approved")

#: The only legal transitions. Every other attempt is refused.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    "edited": ("draft",),
    "submitted": ("draft",),
    "withdrawn": ("draft", "submitted", "escalated", "cover_pending", "approved"),
    "approved": AWAITING_DECISION,
    "declined": AWAITING_DECISION,
    "cancelled": ("approved",),
    "given cover": AWAITING_DECISION,
}


def ensure_transition(status: str, action: str) -> None:
    if status not in TRANSITIONS[action]:
        raise invalid_transition(status, action)


def rostered_hours_in(conn, person_id: str, start: date, end: date) -> Decimal:
    """The sum of the person's rostered shift hours whose dates fall inside the range."""
    total = Decimal("0.00")
    for assignment in person_assignments(conn, person_id, start, end):
        total += shift_hours(assignment["shift_date"], assignment["shift"])
    return total.quantize(Decimal("0.01"))


def sick_covered_hours(conn, person_id: str, start: date, end: date, cap: Decimal) -> Decimal:
    """Rostered hours inside the range on days a sickness record covers, capped at cost."""
    assignments = person_assignments(conn, person_id, start, end)
    if not assignments:
        return Decimal("0.00")
    absences = load_absences(conn, [person_id], start, end)
    total = Decimal("0.00")
    for assignment in assignments:
        if absences.sick_on(person_id, assignment["shift_date"]):
            total += shift_hours(assignment["shift_date"], assignment["shift"])
    return min(total, cap).quantize(Decimal("0.01"))


def request_cost(conn, request: dict) -> Decimal:
    hours = Decimal(request["hours"]).quantize(Decimal("0.01"))
    return hours - sick_covered_hours(
        conn, request["requester_id"], request["start_date"], request["end_date"], hours
    )


def holiday(conn, person: dict, today: date) -> dict | None:
    """The one balance /api/me, My shifts, the Holiday line and the submit check use."""
    if person["entitlement_hours"] is None:
        return None
    year_start = leave_year_start(today)
    year_end = leave_year_end(today)
    marks = ",".join(["%s"] * len(BOOKED_STATUSES))
    booked = Decimal("0.00")
    for request in rows(
        conn,
        f"""SELECT id, requester_id, hours, start_date, end_date
            FROM leave_requests
            WHERE requester_id = %s AND leave_type = 'annual'
              AND status IN ({marks}) AND start_date >= %s AND start_date <= %s""",
        (person["id"], *BOOKED_STATUSES, year_start, year_end),
    ):
        booked += request_cost(conn, request)
    entitlement = Decimal(person["entitlement_hours"]).quantize(Decimal("0.01"))
    return {
        "leave_year_start": year_start.isoformat(),
        "entitlement_hours": f"{entitlement:.2f}",
        "booked_hours": f"{booked:.2f}",
        "remaining_hours": f"{entitlement - booked:.2f}",
    }


def overlapping_request(
    conn, person_id: str, start: date, end: date, exclude_id: str
) -> dict | None:
    marks = ",".join(["%s"] * len(BOOKED_STATUSES))
    return row(
        conn,
        f"""SELECT id FROM leave_requests
            WHERE requester_id = %s AND id <> %s AND status IN ({marks})
              AND start_date <= %s AND end_date >= %s
            LIMIT 1""",
        (person_id, exclude_id, *BOOKED_STATUSES, end, start),
    )


def notice_multiplier(conn, home_id: str, on: date) -> int:
    """The leave policy version in force on the day the request is submitted."""
    found = row(
        conn,
        """SELECT notice_multiplier FROM policy_versions
           WHERE home_id = %s AND effective_from <= %s
           ORDER BY effective_from DESC LIMIT 1""",
        (home_id, on),
    )
    return int(found["notice_multiplier"]) if found else 0


def is_short_notice(start: date, length_days: int, today: date, multiplier: int) -> bool:
    lead_days = (start - today).days
    return lead_days < multiplier * length_days


def within_one_leave_year(start: date, end: date) -> bool:
    return leave_year_start(start) == leave_year_start(end)
