"""Timesheet exports and their signed downloads."""

from __future__ import annotations

from flask import Blueprint

from .. import projections, storage
from ..db import execute, row, rows
from ..domain.timesheet import build_csv
from ..errors import ApiError
from ..responses import api_response
from ..timeutil import now_utc, parse_period, period_bounds
from .common import endpoint, new_id, read_body, require_roles, visible_home_ids

blueprint = Blueprint("exports", __name__)


def _timesheet_rows(conn, period: str, home_ids: list[str]):
    first, last = period_bounds(period)
    marks = ",".join(["%s"] * len(home_ids))
    return rows(
        conn,
        f"""SELECT a.id, a.person_id, a.shift_date, a.shift, a.clock_in_at, a.clock_out_at,
                   a.late, a.correction_note, p.display_name AS person_name, p.role,
                   h.name AS home_name, u.name AS unit_name
            FROM attendance a
            JOIN people p ON p.id = a.person_id
            JOIN homes h ON h.id = a.home_id
            JOIN units u ON u.id = a.unit_id
            WHERE a.shift_date BETWEEN %s AND %s AND a.home_id IN ({marks})""",
        (first, last, *home_ids),
    )


@blueprint.post("/api/exports/timesheets")
@endpoint(write=True)
def create_export(conn, person):
    body = read_body("period", "home_ids")
    require_roles(person, "hr_admin")
    period = parse_period(body.get("period"))
    if period is None:
        body.fail("period", "period")
    raw_homes = body.get("home_ids")
    home_ids: list[str] = []
    if not isinstance(raw_homes, list) or not raw_homes:
        body.fail("home_ids", "home_ids_empty")
    else:
        known = visible_home_ids(conn, person)
        if any(home_id not in known for home_id in raw_homes):
            body.fail("home_ids", "home_ids_unknown")
        else:
            home_ids = list(dict.fromkeys(raw_homes))
    body.check()
    now = now_utc()
    content, row_count = build_csv(_timesheet_rows(conn, period, home_ids), now)
    export_id = new_id("exp")
    key = f"exports/timesheets/{period}/{export_id}.csv"
    stored = "stored"
    try:
        storage.put_object(key, content, "text/csv")
    except OSError:
        stored = "pending"
    execute(
        conn,
        """INSERT INTO timesheet_exports (id, period, home_ids, row_count, storage,
                                          storage_key, content, created_by, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (export_id, period, home_ids, row_count, stored, key, content, person["id"], now),
    )
    return api_response(
        projections.export(
            {
                "id": export_id,
                "period": period,
                "home_ids": home_ids,
                "row_count": row_count,
                "storage": stored,
                "created_at": now,
            }
        ),
        201,
    )


@blueprint.get("/api/exports")
@endpoint()
def list_exports(conn, person):
    require_roles(person, "hr_admin")
    records = rows(
        conn,
        """SELECT id, period, home_ids, row_count, storage, created_at
           FROM timesheet_exports ORDER BY created_at DESC, id DESC""",
    )
    return api_response({"items": [projections.export(record) for record in records]})


@blueprint.get("/api/exports/<export_id>/download")
@endpoint()
def download_export(conn, person, export_id):
    require_roles(person, "hr_admin")
    record = row(
        conn,
        "SELECT id, period, storage, storage_key FROM timesheet_exports WHERE id = %s",
        (export_id,),
    )
    if record is None:
        raise ApiError("not_found")
    if record["storage"] != "stored":
        raise ApiError("storage_pending")
    return api_response(
        {
            "url": storage.presign_get(
                record["storage_key"], "text/csv", f"timesheets-{record['period']}.csv"
            ),
            "expires_in_seconds": storage.SIGNED_DOWNLOAD_SECONDS,
        }
    )
