"""My shifts, clocking in and out, and the caller's own attendance."""

from __future__ import annotations

from datetime import timedelta

from flask import Blueprint

from .. import projections
from ..db import execute, row, rows
from ..domain.attendance import is_missed_clock_out, is_open, late_flag
from ..domain.leave import holiday
from ..domain.roster import load_absences, person_assignments
from ..errors import ApiError
from ..projections import ATTENDANCE_SELECT
from ..records import load_attendance, open_attendance_of
from ..responses import api_response
from ..timeutil import CLOCK_IN_OPENS, iso_instant, now_utc, shift_window, today_london
from .common import begin_keyed, endpoint, finish_keyed, new_id, read_body, require_roles

blueprint = Blueprint("shifts", __name__)

UPCOMING_DAYS = 14


def _lock_person(conn, person_id: str) -> None:
    """Serialise one person's punches, so they keep at most one open attendance."""
    row(conn, "SELECT id FROM people WHERE id = %s FOR UPDATE", (person_id,))


def _open_attendance(conn, person_id: str, now) -> dict | None:
    for record in open_attendance_of(conn, person_id):
        if is_open(record, now):
            return record
    return None


@blueprint.get("/api/me/shifts")
@endpoint()
def my_shifts(conn, person):
    require_roles(person, "care_worker", "bank_carer", "unit_manager")
    now = now_utc()
    today = today_london()
    assignments = [
        assignment
        for assignment in person_assignments(
            conn, person["id"], today - timedelta(days=1), today + timedelta(days=UPCOMING_DAYS)
        )
        if shift_window(assignment["shift_date"], assignment["shift"])[1] > now
    ]
    absences = load_absences(
        conn, [person["id"]], today - timedelta(days=1), today + timedelta(days=UPCOMING_DAYS)
    )
    open_record = _open_attendance(conn, person["id"], now)
    return api_response(
        {
            "assignments": [
                projections.rota_entry(assignment, absences, person["id"], person["role"])
                for assignment in assignments
            ],
            "open_attendance": (projections.attendance(open_record, now) if open_record else None),
            "holiday": holiday(conn, person, today),
        }
    )


@blueprint.get("/api/me/attendance")
@endpoint()
def my_attendance(conn, person):
    require_roles(person, "care_worker", "bank_carer")
    now = now_utc()
    records = rows(
        conn,
        f"{ATTENDANCE_SELECT} WHERE a.person_id = %s ORDER BY a.clock_in_at DESC",
        (person["id"],),
    )
    return api_response({"items": [projections.attendance(record, now) for record in records]})


def _matching_assignment(conn, person_id: str, now):
    """The assignment whose clock-in window holds now and that has no attendance yet."""
    today = today_london()
    candidates = []
    for assignment in person_assignments(
        conn, person_id, today - timedelta(days=1), today + timedelta(days=1)
    ):
        starts_at, ends_at = shift_window(assignment["shift_date"], assignment["shift"])
        if not starts_at - CLOCK_IN_OPENS <= now <= ends_at:
            continue
        taken = row(
            conn,
            "SELECT id FROM attendance WHERE assignment_id = %s",
            (assignment["assignment_id"],),
        )
        if taken:
            continue
        candidates.append((starts_at, assignment))
    if not candidates:
        return None
    return min(candidates, key=lambda pair: pair[0])[1]


def _resolve_clock_in(conn, person, now) -> dict:
    if _open_attendance(conn, person["id"], now):
        raise ApiError("already_clocked_in")
    assignment = _matching_assignment(conn, person["id"], now)
    if assignment is None:
        raise ApiError("no_rostered_shift")
    return assignment


def _create_attendance(conn, person, assignment, now) -> str:
    unit = row(conn, "SELECT id, home_id FROM units WHERE id = %s", (assignment["unit_id"],))
    rostered_start, _ = shift_window(assignment["shift_date"], assignment["shift"])
    attendance_id = new_id("att")
    execute(
        conn,
        """INSERT INTO attendance (id, person_id, home_id, unit_id, assignment_id, shift_date,
                                   shift, clock_in_at, late)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            attendance_id,
            person["id"],
            unit["home_id"],
            unit["id"],
            assignment["assignment_id"],
            assignment["shift_date"],
            assignment["shift"],
            now,
            late_flag(now, rostered_start),
        ),
    )
    return attendance_id


def _resolve_clock_out(conn, person, now) -> dict:
    without_clock_out = open_attendance_of(conn, person["id"])
    if not without_clock_out:
        raise ApiError("no_open_clock_in")
    open_record = next(
        (record for record in without_clock_out if not is_missed_clock_out(record, now)), None
    )
    if open_record is None:
        raise ApiError("clock_out_window_closed")
    return open_record


def _close_attendance(conn, open_record, now) -> str:
    execute(
        conn,
        "UPDATE attendance SET clock_out_at = %s, version = version + 1 WHERE id = %s",
        (now, open_record["id"]),
    )
    return open_record["id"]


@blueprint.post("/api/punches")
@endpoint(write=True)
def punch(conn, person):
    body = read_body("kind")
    key, replay = begin_keyed(conn, person, body)
    if replay is not None:
        return replay
    require_roles(person, "care_worker", "bank_carer")
    kind = body.get("kind")
    if kind not in ("in", "out"):
        body.fail_with("kind", "Choose in or out.")
        body.check()
    now = now_utc()
    _lock_person(conn, person["id"])
    if kind == "in":
        assignment = _resolve_clock_in(conn, person, now)
        body.check()
        attendance_id = _create_attendance(conn, person, assignment, now)
    else:
        open_record = _resolve_clock_out(conn, person, now)
        body.check()
        attendance_id = _close_attendance(conn, open_record, now)
    punch_id = new_id("pch")
    execute(
        conn,
        """INSERT INTO punches (id, person_id, attendance_id, kind, punched_at)
           VALUES (%s, %s, %s, %s, %s)""",
        (punch_id, person["id"], attendance_id, kind, now),
    )
    record = load_attendance(conn, attendance_id)
    payload = {
        "punch": {"id": punch_id, "kind": kind, "at": iso_instant(now)},
        "attendance": projections.attendance(record, now),
    }
    return finish_keyed(conn, person, key, 201, payload)
