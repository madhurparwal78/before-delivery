"""The staffing preview: 21 shifts, if-approved counts, shortfalls and gaps."""

from __future__ import annotations

from datetime import date, timedelta

from ..db import rows
from ..projections import cover as cover_projection
from ..timeutil import SHIFTS, date_range, format_shift_label, format_short_label
from .floors import load_floors, shortfall
from .leave import AWAITING_DECISION
from .roster import load_on_duty

PREVIEW_DAYS = 7


def _open_covers(conn, unit_id: str, start: date, end: date) -> list[dict]:
    return rows(
        conn,
        """SELECT c.id, c.leave_request_id, c.home_id, c.unit_id, c.shift_date, c.shift,
                  c.skill, c.status, c.claimed_by, h.name AS home_name, u.name AS unit_name,
                  p.display_name AS claimed_by_name
           FROM cover_shifts c
           JOIN homes h ON h.id = c.home_id
           JOIN units u ON u.id = c.unit_id
           LEFT JOIN people p ON p.id = c.claimed_by
           WHERE c.unit_id = %s AND c.status = 'open' AND c.shift_date BETWEEN %s AND %s
           ORDER BY c.created_at, c.id""",
        (unit_id, start, end),
    )


class Staffing:
    """One loaded view of a unit's staffing, judged for one leave request."""

    def __init__(self, conn, request: dict, start: date, end: date):
        self.request = request
        self.unit_id = request["unit_id"]
        self.on_duty = load_on_duty(conn, [self.unit_id], start, end)
        self.floors = load_floors(conn, [self.unit_id])
        self.covers = _open_covers(conn, self.unit_id, start, end)
        self.requester_is_senior = request["requester_skill"] == "senior"
        self.awaiting = request["status"] in AWAITING_DECISION

    def is_affected(self, day: date, shift: str) -> bool:
        """The requester is rostered on that shift, inside the request, and not away."""
        if not self.awaiting:
            return False
        if not self.request["start_date"] <= day <= self.request["end_date"]:
            return False
        requester = self.request["requester_id"]
        if not self.on_duty.is_rostered(requester, self.unit_id, day, shift):
            return False
        return not self.on_duty.absences.is_away(requester, day)

    def shift_entry(self, day: date, shift: str) -> dict:
        on_duty, seniors = self.on_duty.counts(self.unit_id, day, shift)
        floor = self.floors.in_force(self.unit_id, shift, day)
        affected = self.is_affected(day, shift)
        on_duty_if_approved = on_duty - 1 if affected else on_duty
        seniors_if_approved = seniors - 1 if affected and self.requester_is_senior else seniors
        staff_short = shortfall(floor["min_staff"], on_duty_if_approved)
        senior_short = shortfall(floor["min_seniors"], seniors_if_approved)
        return {
            "date": day.isoformat(),
            "shift": shift,
            "label": format_shift_label(day, shift),
            "floor": {
                "min_staff": floor["min_staff"],
                "min_seniors": floor["min_seniors"],
                "effective_from": (
                    floor["effective_from"].isoformat() if floor["effective_from"] else None
                ),
            },
            "on_duty": on_duty,
            "seniors_on_duty": seniors,
            "affected": affected,
            "on_duty_if_approved": on_duty_if_approved,
            "seniors_if_approved": seniors_if_approved,
            "shortfall": staff_short,
            "senior_shortfall": senior_short,
            "gaps": self._gaps(day, shift, staff_short, senior_short),
        }

    def _gaps(self, day: date, shift: str, staff_short: int, senior_short: int) -> list[dict]:
        skills = ["senior"] * senior_short
        skills += ["carer"] * (max(staff_short, senior_short) - senior_short)
        taken: set[str] = set()
        gaps = []
        for skill in skills:
            match = next(
                (
                    candidate
                    for candidate in self.covers
                    if candidate["shift_date"] == day
                    and candidate["shift"] == shift
                    and candidate["skill"] == skill
                    and candidate["id"] not in taken
                ),
                None,
            )
            if match:
                taken.add(match["id"])
            gaps.append(
                {
                    "skill": skill,
                    "cover": cover_projection(match, "unit_manager") if match else None,
                }
            )
        return gaps

    def breaches(self) -> list[tuple[date, str, dict]]:
        """Every affected shift that would end below floor, in strip order."""
        found = []
        for day in date_range(self.request["start_date"], self.request["end_date"]):
            for shift in SHIFTS:
                if not self.is_affected(day, shift):
                    continue
                entry = self.shift_entry(day, shift)
                if entry["shortfall"] > 0 or entry["senior_shortfall"] > 0:
                    found.append((day, shift, entry))
        return found


def breach_detail(entry: dict) -> dict:
    return {
        "date": entry["date"],
        "shift": entry["shift"],
        "label": entry["label"],
        "on_duty": entry["on_duty"],
        "on_duty_if_approved": entry["on_duty_if_approved"],
        "min_staff": entry["floor"]["min_staff"],
        "seniors_on_duty": entry["seniors_on_duty"],
        "seniors_if_approved": entry["seniors_if_approved"],
        "min_seniors": entry["floor"]["min_seniors"],
    }


def load_staffing(conn, request: dict, page_from: date) -> Staffing:
    page_to = page_from + timedelta(days=PREVIEW_DAYS - 1)
    start = min(page_from, request["start_date"])
    end = max(page_to, request["end_date"])
    return Staffing(conn, request, start, end)


def preview_body(conn, request: dict, page_from: date) -> dict:
    page_to = page_from + timedelta(days=PREVIEW_DAYS - 1)
    if request["unit_id"] is None:
        return {
            "request_id": request["id"],
            "unit_id": None,
            "from": page_from.isoformat(),
            "to": page_to.isoformat(),
            "scale_max": 0,
            "uncovered_breaches": 0,
            "breach_labels": [],
            "approvable": request["status"] in AWAITING_DECISION,
            "shifts": [],
        }
    staffing = load_staffing(conn, request, page_from)
    shifts = [
        staffing.shift_entry(day, shift)
        for day in date_range(page_from, page_to)
        for shift in SHIFTS
    ]
    breaches = staffing.breaches()
    scale_max = max(max(entry["on_duty"], entry["floor"]["min_staff"] + 2) for entry in shifts)
    return {
        "request_id": request["id"],
        "unit_id": staffing.unit_id,
        "from": page_from.isoformat(),
        "to": page_to.isoformat(),
        "scale_max": scale_max,
        "uncovered_breaches": len(breaches),
        "breach_labels": [format_short_label(day, shift) for day, shift, _entry in breaches],
        "approvable": staffing.awaiting and not breaches,
        "shifts": shifts,
    }
