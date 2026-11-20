"""Role projections: each role receives exactly the published fields and no others."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from .domain.attendance import is_missed_clock_out, worked_hours
from .domain.leave import sick_covered_hours
from .domain.sickness import span_days
from .timeutil import days_inclusive, iso_instant, shift_hours, shift_window

MANAGER_ROLES = ("unit_manager", "hr_admin")

LEAVE_SELECT = """
    SELECT r.id, r.requester_id, r.home_id, r.unit_id, r.leave_type, r.start_date,
           r.end_date, r.note, r.status, r.hours, r.short_notice, r.submitted_at,
           r.decided_at, r.decided_by, r.decision_reason,
           rp.display_name AS requester_name, rp.skill AS requester_skill,
           rp.email AS requester_email, dp.display_name AS decided_by_name
    FROM leave_requests r
    JOIN people rp ON rp.id = r.requester_id
    LEFT JOIN people dp ON dp.id = r.decided_by
"""

ATTENDANCE_SELECT = """
    SELECT a.id, a.person_id, a.home_id, a.unit_id, a.assignment_id, a.shift_date, a.shift,
           a.clock_in_at, a.clock_out_at, a.late, a.late_acknowledged, a.correction_note,
           a.version, p.display_name AS person_name
    FROM attendance a JOIN people p ON p.id = a.person_id
"""


def _decimal(value) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


def person(identifier: str, display_name: str) -> dict:
    return {"id": identifier, "display_name": display_name}


def me(record: dict, holiday: dict | None, credentialed_home_ids: list[str]) -> dict:
    return {
        "id": record["id"],
        "email": record["email"],
        "display_name": record["display_name"],
        "role": record["role"],
        "home_id": record["home_id"],
        "unit_id": record["unit_id"],
        "skill": record["skill"],
        "credentialed_home_ids": credentialed_home_ids,
        "holiday": holiday,
    }


def rota_entry(assignment: dict, absences, viewer_id: str, viewer_role: str) -> dict:
    day = assignment["shift_date"]
    shift = assignment["shift"]
    starts_at, ends_at = shift_window(day, shift)
    away = absences.is_away(assignment["person_id"], day)
    entry = {
        "assignment_id": assignment["assignment_id"],
        "person": person(assignment["person_id"], assignment["display_name"]),
        "date": day.isoformat(),
        "shift": shift,
        "starts_at": iso_instant(starts_at),
        "ends_at": iso_instant(ends_at),
        "hours": f"{shift_hours(day, shift):.2f}",
        "status": "away" if away else "on",
        "is_you": assignment["person_id"] == viewer_id,
    }
    if viewer_role in MANAGER_ROLES:
        entry["absence_kind"] = absences.absence_kind(assignment["person_id"], day)
    return entry


def leave_request(conn, record: dict) -> dict:
    hours = _decimal(record["hours"])
    sickness_hours = sick_covered_hours(
        conn, record["requester_id"], record["start_date"], record["end_date"], hours
    )
    return {
        "id": record["id"],
        "requester": person(record["requester_id"], record["requester_name"]),
        "home_id": record["home_id"],
        "unit_id": record["unit_id"],
        "type": record["leave_type"],
        "start_date": record["start_date"].isoformat(),
        "end_date": record["end_date"].isoformat(),
        "length_days": days_inclusive(record["start_date"], record["end_date"]),
        "hours": f"{hours:.2f}",
        "sickness_hours": f"{sickness_hours:.2f}",
        "note": record["note"],
        "status": record["status"],
        "short_notice": record["short_notice"],
        "submitted_at": iso_instant(record["submitted_at"]),
        "decided_at": iso_instant(record["decided_at"]),
        "decided_by": (
            person(record["decided_by"], record["decided_by_name"])
            if record["decided_by"]
            else None
        ),
        "decision_reason": record["decision_reason"],
    }


def sickness(record: dict, today, viewer_role: str, is_owner: bool, fit_note: dict | None) -> dict:
    payload = {
        "id": record["id"],
        "person": person(record["person_id"], record["person_name"]),
        "start_date": record["start_date"].isoformat(),
        "last_sick_date": (
            record["last_sick_date"].isoformat() if record["last_sick_date"] else None
        ),
        "status": record["status"],
        "days": span_days(record, today),
    }
    if is_owner or viewer_role == "hr_admin":
        payload["reason"] = record["reason"]
        payload["fit_note"] = fit_note
    return payload


def fit_note(upload: dict | None) -> dict | None:
    if upload is None:
        return None
    return {
        "uploaded_at": iso_instant(upload["uploaded_at"]),
        "file_name": upload["file_name"],
        "storage": upload["storage"],
    }


def cover(record: dict, viewer_role: str) -> dict:
    day = record["shift_date"]
    starts_at, ends_at = shift_window(day, record["shift"])
    payload = {
        "id": record["id"],
        "home": {"id": record["home_id"], "name": record["home_name"]},
        "unit": {"id": record["unit_id"], "name": record["unit_name"]},
        "date": day.isoformat(),
        "shift": record["shift"],
        "starts_at": iso_instant(starts_at),
        "ends_at": iso_instant(ends_at),
        "hours": f"{shift_hours(day, record['shift']):.2f}",
        "skill": record["skill"],
        "status": record["status"],
    }
    if viewer_role in MANAGER_ROLES:
        payload["leave_request_id"] = record["leave_request_id"]
        payload["claimed_by"] = (
            person(record["claimed_by"], record["claimed_by_name"])
            if record["claimed_by"]
            else None
        )
    return payload


def attendance(record: dict, now: datetime) -> dict:
    rostered_start, rostered_end = shift_window(record["shift_date"], record["shift"])
    hours = worked_hours(record, now)
    return {
        "id": record["id"],
        "person": person(record["person_id"], record["person_name"]),
        "home_id": record["home_id"],
        "unit_id": record["unit_id"],
        "assignment_id": record["assignment_id"],
        "date": record["shift_date"].isoformat(),
        "shift": record["shift"],
        "rostered_start": iso_instant(rostered_start),
        "rostered_end": iso_instant(rostered_end),
        "clock_in_at": iso_instant(record["clock_in_at"]),
        "clock_out_at": iso_instant(record["clock_out_at"]),
        "worked_hours": None if hours is None else f"{hours:.2f}",
        "missed_clock_out": is_missed_clock_out(record, now),
        "late": record["late"],
        "late_acknowledged": record["late_acknowledged"],
        "correction_note": record["correction_note"],
        "version": record["version"],
    }


def floor_version(record: dict) -> dict:
    return {
        "id": record["id"],
        "unit_id": record["unit_id"],
        "shift": record["shift"],
        "min_staff": record["min_staff"],
        "min_seniors": record["min_seniors"],
        "effective_from": record["effective_from"].isoformat(),
        "created_by": record["created_by"],
        "created_at": iso_instant(record["created_at"]),
    }


def policy_version(record: dict) -> dict:
    return {
        "id": record["id"],
        "notice_multiplier": record["notice_multiplier"],
        "effective_from": record["effective_from"].isoformat(),
        "created_by": record["created_by"],
        "created_at": iso_instant(record["created_at"]),
    }


def export(record: dict) -> dict:
    return {
        "id": record["id"],
        "period": record["period"],
        "home_ids": list(record["home_ids"]),
        "row_count": record["row_count"],
        "storage": record["storage"],
        "created_at": iso_instant(record["created_at"]),
    }


def audit_entry(record: dict) -> dict:
    return {
        "id": record["id"],
        "at": iso_instant(record["entered_at"]),
        "actor": {
            "id": record["actor_id"],
            "display_name": record["actor_display_name"],
            "role": record["actor_role"],
        },
        "action": record["action"],
        "home_id": record["home_id"],
        "target": {"type": record["target_type"], "id": record["target_id"]},
        "before": record["before_state"],
        "after": record["after_state"],
        "reason": record["reason"],
    }


def ledger_entry(record: dict) -> dict:
    return {
        "id": record["id"],
        "period": record["period"],
        "kind": record["kind"],
        "worked_hours": f"{Decimal(record['worked_hours']):.4f}",
        "accrued_hours": f"{Decimal(record['accrued_hours']):.4f}",
        "created_at": iso_instant(record["created_at"]),
    }
