"""Attendance corrections, additions and late acknowledgements."""

from __future__ import annotations

from flask import Blueprint, request

from .. import projections
from ..db import Unique, execute, row
from ..domain import audit
from ..domain.attendance import ensure_version, late_flag
from ..errors import ApiError
from ..records import load_attendance
from ..responses import api_response
from ..timeutil import (
    MISSED_CLOCK_OUT_AFTER,
    now_utc,
    parse_instant,
    shift_window,
)
from .common import endpoint, new_id, read_body, require_roles, resolve_home

blueprint = Blueprint("attendance", __name__)

REASON_MAX = 500


def _validate_reason(body) -> str | None:
    reason = body.get("reason")
    if not isinstance(reason, str) or not 1 <= len(reason) <= REASON_MAX:
        body.fail("reason", "reason")
        return None
    return reason


def _validate_times(body, shift_date, shift):
    rostered_start, _ = shift_window(shift_date, shift)
    clock_in = parse_instant(body.get("clock_in_at"))
    if clock_in is None:
        body.fail("clock_in_at", "instant")
    elif abs(clock_in - rostered_start) > MISSED_CLOCK_OUT_AFTER:
        body.fail("clock_in_at", "clock_in_window")
    raw_out = body.get("clock_out_at")
    clock_out = None
    if raw_out is not None:
        clock_out = parse_instant(raw_out)
        if clock_out is None:
            body.fail("clock_out_at", "instant")
        elif clock_in is not None and clock_out <= clock_in:
            body.fail("clock_out_at", "clock_out_order")
    return clock_in, clock_out


@blueprint.post("/api/attendance")
@endpoint(write=True)
def add_attendance(conn, person):
    body = read_body("assignment_id", "clock_in_at", "clock_out_at", "reason")
    raw_assignment = body.get("assignment_id")
    assignment = row(
        conn,
        """SELECT a.id, a.person_id, a.unit_id, a.shift_date, a.shift, u.home_id
           FROM rota_assignments a JOIN units u ON u.id = a.unit_id
           WHERE a.id = %s FOR UPDATE OF a""",
        (raw_assignment if isinstance(raw_assignment, str) else "",),
    )
    if assignment is None:
        raise ApiError("not_found")
    resolve_home(conn, person, assignment["home_id"])
    require_roles(person, "unit_manager", "hr_admin")
    if row(conn, "SELECT id FROM attendance WHERE assignment_id = %s", (assignment["id"],)):
        raise ApiError("attendance_exists")
    reason = _validate_reason(body)
    clock_in, clock_out = _validate_times(body, assignment["shift_date"], assignment["shift"])
    body.check()
    rostered_start, _ = shift_window(assignment["shift_date"], assignment["shift"])
    attendance_id = new_id("att")
    try:
        execute(
            conn,
            """INSERT INTO attendance (id, person_id, home_id, unit_id, assignment_id,
                                       shift_date, shift, clock_in_at, clock_out_at, late,
                                       correction_note)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                attendance_id,
                assignment["person_id"],
                assignment["home_id"],
                assignment["unit_id"],
                assignment["id"],
                assignment["shift_date"],
                assignment["shift"],
                clock_in,
                clock_out,
                late_flag(clock_in, rostered_start),
                reason,
            ),
        )
    except Unique as error:
        raise ApiError("attendance_exists") from error
    record = load_attendance(conn, attendance_id)
    payload = projections.attendance(record, now_utc())
    audit.write_entry(
        conn,
        actor=person,
        action="attendance_added",
        home_id=assignment["home_id"],
        target_type="attendance",
        target_id=attendance_id,
        before=None,
        after=payload,
        reason=reason,
    )
    return api_response(payload, 201)


@blueprint.patch("/api/attendance/<attendance_id>")
@endpoint(write=True)
def correct_attendance(conn, person, attendance_id):
    body = read_body("clock_in_at", "clock_out_at", "reason")
    record = load_attendance(conn, attendance_id, for_update=True)
    if record is None:
        raise ApiError("not_found")
    resolve_home(conn, person, record["home_id"])
    require_roles(person, "unit_manager", "hr_admin")
    now = now_utc()
    before = projections.attendance(record, now)
    ensure_version(request.headers.get("If-Match"), record, before)
    reason = _validate_reason(body)
    clock_in, clock_out = _validate_times(body, record["shift_date"], record["shift"])
    body.check()
    rostered_start, _ = shift_window(record["shift_date"], record["shift"])
    execute(
        conn,
        """UPDATE attendance SET clock_in_at = %s, clock_out_at = %s, late = %s,
                                 correction_note = %s, version = version + 1
           WHERE id = %s""",
        (clock_in, clock_out, late_flag(clock_in, rostered_start), reason, attendance_id),
    )
    payload = projections.attendance(load_attendance(conn, attendance_id), now)
    audit.write_entry(
        conn,
        actor=person,
        action="attendance_corrected",
        home_id=record["home_id"],
        target_type="attendance",
        target_id=attendance_id,
        before=before,
        after=payload,
        reason=reason,
    )
    return api_response(payload)


@blueprint.post("/api/attendance/<attendance_id>/acknowledge")
@endpoint(write=True)
def acknowledge_late(conn, person, attendance_id):
    body = read_body()
    record = load_attendance(conn, attendance_id, for_update=True)
    if record is None:
        raise ApiError("not_found")
    resolve_home(conn, person, record["home_id"])
    require_roles(person, "unit_manager", "hr_admin")
    if not record["late"]:
        raise ApiError("not_late")
    body.check()
    execute(
        conn,
        """UPDATE attendance SET late_acknowledged = true, version = version + 1
           WHERE id = %s""",
        (attendance_id,),
    )
    return api_response(projections.attendance(load_attendance(conn, attendance_id), now_utc()))
