"""What each role receives (brief: Projections). Nothing else leaves the server."""

from datetime import datetime

import asyncpg

from . import shifts
from .access import MANAGERS

LEAVE_SQL = """
SELECT lr.*, rq.display_name AS requester_name, dc.display_name AS decided_by_name,
       lr.hours_seconds - cost_seconds(lr.requester_id, lr.start_date, lr.end_date, lr.hours_seconds)
           AS sickness_seconds
FROM leave_requests lr JOIN people rq ON rq.id = lr.requester_id LEFT JOIN people dc ON dc.id = lr.decided_by
"""


def person(person_id: str | None, display_name: str | None) -> dict | None:
    return {"id": person_id, "display_name": display_name} if person_id else None


def worked_seconds(clock_in: datetime, clock_out: datetime | None) -> int | None:
    return int((clock_out - clock_in).total_seconds()) if clock_out else None


def leave_request(r: asyncpg.Record) -> dict:
    return {
        "id": r["id"], "requester": person(r["requester_id"], r["requester_name"]), "home_id": r["home_id"],
        "unit_id": r["unit_id"], "type": r["type"], "start_date": r["start_date"].isoformat(),
        "end_date": r["end_date"].isoformat(), "length_days": (r["end_date"] - r["start_date"]).days + 1,
        "hours": shifts.hours(r["hours_seconds"]), "sickness_hours": shifts.hours(r["sickness_seconds"]), "note": r["note"], "status": r["status"],
        "short_notice": r["short_notice"], "submitted_at": shifts.instant(r["submitted_at"]),
        "decided_at": shifts.instant(r["decided_at"]), "decided_by": person(r["decided_by"], r["decided_by_name"]),
        "decision_reason": r["decision_reason"],
    }


def rota_entry(r: asyncpg.Record, me: asyncpg.Record) -> dict:
    entry = {
        "assignment_id": r["id"], "person": person(r["person_id"], r["display_name"]), "date": r["date"].isoformat(),
        "shift": r["shift"], "starts_at": shifts.instant(r["starts_at"]), "ends_at": shifts.instant(r["ends_at"]),
        "hours": shifts.hours(int((r["ends_at"] - r["starts_at"]).total_seconds())),
        "status": "on" if r["absence_kind"] is None else "away", "is_you": r["person_id"] == me["id"],
    }
    if me["role"] in MANAGERS:
        entry["absence_kind"] = r["absence_kind"]
    return entry


def attendance(r: asyncpg.Record) -> dict:
    seconds = worked_seconds(r["clock_in_at"], r["clock_out_at"])
    return {
        "id": r["id"], "person": person(r["person_id"], r["display_name"]), "home_id": r["home_id"],
        "unit_id": r["unit_id"], "assignment_id": r["assignment_id"], "date": r["date"].isoformat(),
        "shift": r["shift"], "rostered_start": shifts.instant(r["starts_at"]),
        "rostered_end": shifts.instant(r["ends_at"]), "clock_in_at": shifts.instant(r["clock_in_at"]),
        "clock_out_at": shifts.instant(r["clock_out_at"]),
        "worked_hours": None if seconds is None else shifts.hours(seconds), "missed_clock_out": r["missed_clock_out"],
        "late": r["late"],
        "late_acknowledged": r["late_acknowledged"], "correction_note": r["correction_note"],
        "version": r["version"],
    }


def sickness(r: asyncpg.Record, me: asyncpg.Record, fit_note: asyncpg.Record | None) -> dict:
    last = r["last_sick_date"]
    body = {
        "id": r["id"], "person": person(r["person_id"], r["display_name"]), "start_date": r["start_date"].isoformat(),
        "last_sick_date": last.isoformat() if last else None, "status": r["status"],
        "days": ((last or shifts.today()) - r["start_date"]).days + 1,
    }
    if me["role"] != "unit_manager":
        body["reason"] = r["reason"]
        body["fit_note"] = None if fit_note is None else {
            "uploaded_at": shifts.instant(fit_note["uploaded_at"]), "file_name": fit_note["file_name"],
            "storage": "pending" if fit_note["pending"] else "stored"}
    return body


def cover(r: asyncpg.Record, me: asyncpg.Record) -> dict:
    starts, ends = shifts.window(r["date"], r["shift"])
    body = {
        "id": r["id"], "home": {"id": r["home_id"], "name": r["home_name"]},
        "unit": {"id": r["unit_id"], "name": r["unit_name"]}, "date": r["date"].isoformat(), "shift": r["shift"],
        "starts_at": shifts.instant(starts), "ends_at": shifts.instant(ends),
        "hours": shifts.hours(int((ends - starts).total_seconds())), "skill": r["skill"], "status": r["status"],
    }
    if me["role"] in MANAGERS:
        body["leave_request_id"] = r["leave_request_id"]
        body["claimed_by"] = person(r["claimed_by"], r["claimed_by_name"])
    return body


COVER_SQL = """
SELECT c.*, h.name AS home_name, u.name AS unit_name, cb.display_name AS claimed_by_name
FROM covers c JOIN homes h ON h.id = c.home_id JOIN units u ON u.id = c.unit_id
LEFT JOIN people cb ON cb.id = c.claimed_by
"""

