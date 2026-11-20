"""Rota assignments, absence and the one on-duty count.

Today, the staffing preview, the approval floor check and the floor-breach
details all count on duty through this module.
"""

from __future__ import annotations

from datetime import date, timedelta

from ..db import rows
from ..timeutil import shift_window


def _marks(values) -> str:
    return ",".join(["%s"] * len(values))


class AbsenceBook:
    """Who is away on which day, and why, for a set of people and dates."""

    def __init__(self, leaves: list[dict], sicknesses: list[dict]):
        self._leaves = leaves
        self._sicknesses = sicknesses

    def sick_on(self, person_id: str, day: date) -> bool:
        for record in self._sicknesses:
            if record["person_id"] != person_id or record["start_date"] > day:
                continue
            last = record["last_sick_date"]
            if last is None or last >= day:
                return True
        return False

    def leave_type_on(self, person_id: str, day: date) -> str | None:
        for request in self._leaves:
            if (
                request["requester_id"] == person_id
                and request["start_date"] <= day <= request["end_date"]
            ):
                return request["leave_type"]
        return None

    def is_away(self, person_id: str, day: date) -> bool:
        return self.sick_on(person_id, day) or self.leave_type_on(person_id, day) is not None

    def absence_kind(self, person_id: str, day: date) -> str | None:
        """Sickness wins over leave, because sickness is the reason they are off."""
        if self.sick_on(person_id, day):
            return "sickness"
        return self.leave_type_on(person_id, day)


def load_absences(conn, person_ids: list[str], start: date, end: date) -> AbsenceBook:
    if not person_ids:
        return AbsenceBook([], [])
    marks = _marks(person_ids)
    leaves = rows(
        conn,
        f"""SELECT requester_id, leave_type, start_date, end_date
            FROM leave_requests
            WHERE status = 'approved' AND requester_id IN ({marks})
              AND start_date <= %s AND end_date >= %s""",
        (*person_ids, end, start),
    )
    sicknesses = rows(
        conn,
        f"""SELECT person_id, start_date, last_sick_date
            FROM sickness_records
            WHERE person_id IN ({marks}) AND start_date <= %s
              AND (last_sick_date IS NULL OR last_sick_date >= %s)""",
        (*person_ids, end, start),
    )
    return AbsenceBook(leaves, sicknesses)


def load_roster(conn, unit_ids: list[str], start: date, end: date) -> list[dict]:
    if not unit_ids:
        return []
    marks = _marks(unit_ids)
    return rows(
        conn,
        f"""SELECT a.id AS assignment_id, a.person_id, a.unit_id, a.shift_date, a.shift,
                   p.display_name, p.skill, p.role
            FROM rota_assignments a JOIN people p ON p.id = a.person_id
            WHERE a.unit_id IN ({marks}) AND a.shift_date BETWEEN %s AND %s
            ORDER BY p.display_name, a.id""",
        (*unit_ids, start, end),
    )


def person_assignments(conn, person_id: str, start: date, end: date) -> list[dict]:
    return rows(
        conn,
        """SELECT a.id AS assignment_id, a.person_id, a.unit_id, a.shift_date, a.shift,
                  p.display_name, p.skill
           FROM rota_assignments a JOIN people p ON p.id = a.person_id
           WHERE a.person_id = %s AND a.shift_date BETWEEN %s AND %s
           ORDER BY a.shift_date, a.shift""",
        (person_id, start, end),
    )


class OnDuty:
    """On-duty and senior counts per unit, date and shift."""

    def __init__(self, roster: list[dict], absences: AbsenceBook):
        self.roster = roster
        self.absences = absences
        self._counts: dict[tuple[str, date, str], tuple[int, int]] = {}
        for entry in roster:
            if absences.is_away(entry["person_id"], entry["shift_date"]):
                continue
            key = (entry["unit_id"], entry["shift_date"], entry["shift"])
            on_duty, seniors = self._counts.get(key, (0, 0))
            self._counts[key] = (on_duty + 1, seniors + (entry["skill"] == "senior"))

    def counts(self, unit_id: str, day: date, shift: str) -> tuple[int, int]:
        return self._counts.get((unit_id, day, shift), (0, 0))

    def is_rostered(self, person_id: str, unit_id: str, day: date, shift: str) -> bool:
        return any(
            entry["person_id"] == person_id
            and entry["unit_id"] == unit_id
            and entry["shift_date"] == day
            and entry["shift"] == shift
            for entry in self.roster
        )


def load_on_duty(conn, unit_ids: list[str], start: date, end: date) -> OnDuty:
    roster = load_roster(conn, unit_ids, start, end)
    people = sorted({entry["person_id"] for entry in roster})
    return OnDuty(roster, load_absences(conn, people, start, end))


def overlaps_existing_assignment(conn, person_id: str, day: date, shift: str) -> bool:
    """A person cannot hold two assignments whose shift windows overlap."""
    start, end = shift_window(day, shift)
    neighbours = person_assignments(
        conn, person_id, day - timedelta(days=1), day + timedelta(days=1)
    )
    for other in neighbours:
        other_start, other_end = shift_window(other["shift_date"], other["shift"])
        if start < other_end and other_start < end:
            return True
    return False
