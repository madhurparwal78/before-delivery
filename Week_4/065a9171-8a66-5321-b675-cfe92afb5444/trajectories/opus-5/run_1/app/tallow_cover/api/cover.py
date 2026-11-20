"""Open cover shifts and claiming one."""

from __future__ import annotations

from flask import Blueprint

from .. import projections
from ..db import execute, rows
from ..domain.roster import load_absences, overlaps_existing_assignment
from ..errors import ApiError
from ..records import COVER_SELECT, load_cover
from ..responses import api_response
from .common import (
    begin_keyed,
    credentialed_home_ids,
    endpoint,
    finish_keyed,
    new_id,
    read_body,
    require_roles,
)

blueprint = Blueprint("cover", __name__)


@blueprint.get("/api/cover-shifts")
@endpoint()
def open_covers(conn, person):
    require_roles(person, "bank_carer")
    homes = credentialed_home_ids(conn, person)
    if not homes:
        return api_response({"items": []})
    marks = ",".join(["%s"] * len(homes))
    skill_clause = "" if person["skill"] == "senior" else " AND c.skill = 'carer'"
    records = rows(
        conn,
        f"""{COVER_SELECT} WHERE c.status = 'open' AND c.home_id IN ({marks}){skill_clause}
            ORDER BY c.shift_date, c.shift, c.id""",
        tuple(homes),
    )
    return api_response(
        {"items": [projections.cover(record, person["role"]) for record in records]}
    )


@blueprint.post("/api/cover-shifts/<cover_id>/claim")
@endpoint(write=True)
def claim_cover(conn, person, cover_id):
    body = read_body()
    key, replay = begin_keyed(conn, person, body)
    if replay is not None:
        return replay
    record = load_cover(conn, cover_id, for_update=True)
    if record is None or record["home_id"] not in credentialed_home_ids(conn, person):
        raise ApiError("not_found")
    require_roles(person, "bank_carer")
    if record["skill"] == "senior" and person["skill"] != "senior":
        raise ApiError("skill_required")
    if record["status"] == "cancelled":
        raise ApiError("cover_closed")
    if record["status"] == "claimed":
        raise ApiError("already_taken")
    if overlaps_existing_assignment(conn, person["id"], record["shift_date"], record["shift"]):
        raise ApiError("overlapping_shift")
    body.check()
    assignment_id = new_id("asg")
    execute(
        conn,
        """INSERT INTO rota_assignments (id, person_id, unit_id, shift_date, shift)
           VALUES (%s, %s, %s, %s, %s)""",
        (assignment_id, person["id"], record["unit_id"], record["shift_date"], record["shift"]),
    )
    execute(
        conn,
        """UPDATE cover_shifts SET status = 'claimed', claimed_by = %s, assignment_id = %s
           WHERE id = %s""",
        (person["id"], assignment_id, cover_id),
    )
    assignment = {
        "assignment_id": assignment_id,
        "person_id": person["id"],
        "unit_id": record["unit_id"],
        "shift_date": record["shift_date"],
        "shift": record["shift"],
        "display_name": person["display_name"],
        "skill": person["skill"],
    }
    absences = load_absences(conn, [person["id"]], record["shift_date"], record["shift_date"])
    payload = {
        "cover": projections.cover(load_cover(conn, cover_id), person["role"]),
        "assignment": projections.rota_entry(assignment, absences, person["id"], person["role"]),
    }
    return finish_keyed(conn, person, key, 200, payload)
