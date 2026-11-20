"""The team rota, rota edits and the people picker."""

from __future__ import annotations

from datetime import timedelta

from flask import Blueprint, request

from .. import projections
from ..db import execute, row, rows
from ..domain.roster import load_absences, load_roster, overlaps_existing_assignment
from ..errors import ApiError
from ..responses import api_response
from ..timeutil import SHIFTS, monday_of, parse_date, today_london
from .common import endpoint, new_id, read_body, require_roles, resolve_home, resolve_unit

blueprint = Blueprint("rota", __name__)

ROTA_DAYS = 7
PICKER_LIMIT = 20
ROSTERABLE_ROLES = ("care_worker", "bank_carer")


#: Who a home may roster: its own care workers and the bank carers credentialed there.
HOME_STAFF_SCOPE = """
    (p.role = 'care_worker' AND p.home_id = %s)
    OR (p.role = 'bank_carer' AND EXISTS (
          SELECT 1 FROM bank_credentials c WHERE c.person_id = p.id AND c.home_id = %s))
"""


def _home_people(conn, home_id: str, query: str) -> list[dict]:
    pattern = f"%{query.lower()}%"
    return rows(
        conn,
        f"""SELECT p.id, p.display_name, p.role, p.skill FROM people p
            WHERE ({HOME_STAFF_SCOPE})
              AND (lower(p.display_name) LIKE %s OR lower(p.id) LIKE %s)
            ORDER BY p.display_name, p.id
            LIMIT %s""",
        (home_id, home_id, pattern, pattern, PICKER_LIMIT),
    )


def _is_home_staff(conn, home_id: str, person_id: str) -> bool:
    return (
        row(
            conn,
            f"SELECT 1 AS found FROM people p WHERE p.id = %s AND ({HOME_STAFF_SCOPE})",
            (person_id, home_id, home_id),
        )
        is not None
    )


@blueprint.get("/api/units/<unit_id>/rota")
@endpoint()
def read_rota(conn, person, unit_id):
    unit = resolve_unit(conn, person, unit_id)
    require_roles(person, "care_worker", "unit_manager", "hr_admin")
    raw_from = request.args.get("from")
    start = parse_date(raw_from) if raw_from else monday_of(today_london())
    if start is None:
        start = monday_of(today_london())
    end = start + timedelta(days=ROTA_DAYS - 1)
    assignments = load_roster(conn, [unit["id"]], start, end)
    absences = load_absences(
        conn, sorted({entry["person_id"] for entry in assignments}), start, end
    )
    return api_response(
        {
            "unit_id": unit["id"],
            "from": start.isoformat(),
            "to": end.isoformat(),
            "entries": [
                projections.rota_entry(assignment, absences, person["id"], person["role"])
                for assignment in assignments
            ],
        }
    )


@blueprint.get("/api/homes/<home_id>/people")
@endpoint()
def read_people(conn, person, home_id):
    home = resolve_home(conn, person, home_id)
    require_roles(person, "unit_manager", "hr_admin")
    return api_response({"items": _home_people(conn, home["id"], request.args.get("q") or "")})


@blueprint.post("/api/rota/assignments")
@endpoint(write=True)
def add_assignment(conn, person):
    body = read_body("person_id", "unit_id", "date", "shift")
    unit = resolve_unit(conn, person, body.get("unit_id") or "")
    require_roles(person, "unit_manager", "hr_admin")
    person_id = body.get("person_id")
    target = row(
        conn,
        "SELECT id, display_name, skill, role FROM people WHERE id = %s",
        (person_id if isinstance(person_id, str) else "",),
    )
    if target is None:
        raise ApiError("not_found")
    if target["role"] in ROSTERABLE_ROLES and not _is_home_staff(
        conn, unit["home_id"], target["id"]
    ):
        raise ApiError("not_found")
    if target["role"] not in ROSTERABLE_ROLES:
        body.fail("person_id", "person_id")
    shift_date = parse_date(body.get("date"))
    shift = body.get("shift")
    if shift_date is None:
        body.fail_with("date", "Use a date like 2026-09-01.")
    if shift not in SHIFTS:
        body.fail_with("shift", "Choose early, late or night.")
    body.check()
    if overlaps_existing_assignment(conn, target["id"], shift_date, shift):
        raise ApiError("overlapping_shift")
    assignment_id = new_id("asg")
    execute(
        conn,
        """INSERT INTO rota_assignments (id, person_id, unit_id, shift_date, shift)
           VALUES (%s, %s, %s, %s, %s)""",
        (assignment_id, target["id"], unit["id"], shift_date, shift),
    )
    assignment = {
        "assignment_id": assignment_id,
        "person_id": target["id"],
        "unit_id": unit["id"],
        "shift_date": shift_date,
        "shift": shift,
        "display_name": target["display_name"],
        "skill": target["skill"],
    }
    absences = load_absences(conn, [target["id"]], shift_date, shift_date)
    return api_response(
        projections.rota_entry(assignment, absences, person["id"], person["role"]), 201
    )


@blueprint.delete("/api/rota/assignments/<assignment_id>")
@endpoint(write=True)
def remove_assignment(conn, person, assignment_id):
    assignment = row(
        conn,
        """SELECT a.id, a.person_id, u.home_id FROM rota_assignments a
           JOIN units u ON u.id = a.unit_id WHERE a.id = %s FOR UPDATE OF a""",
        (assignment_id,),
    )
    if assignment is None:
        raise ApiError("not_found")
    resolve_home(conn, person, assignment["home_id"])
    require_roles(person, "unit_manager", "hr_admin")
    if row(conn, "SELECT id FROM attendance WHERE assignment_id = %s", (assignment_id,)):
        raise ApiError("has_attendance")
    execute(
        conn,
        """UPDATE cover_shifts SET status = 'cancelled'
           WHERE assignment_id = %s AND status = 'claimed'""",
        (assignment_id,),
    )
    execute(conn, "DELETE FROM rota_assignments WHERE id = %s", (assignment_id,))
    return api_response(None, 204)
