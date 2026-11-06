"""The home's day, its attendance day view, its floors and its leave policy."""

from __future__ import annotations

from datetime import timedelta

from flask import Blueprint, request

from .. import projections
from ..db import Unique, execute, rows
from ..domain import audit
from ..domain.attendance import is_missed_clock_out
from ..domain.floors import load_floors, shortfall
from ..domain.roster import load_on_duty
from ..errors import ApiError
from ..projections import ATTENDANCE_SELECT
from ..responses import api_response
from ..timeutil import SHIFTS, now_utc, parse_date, shift_window, today_london
from .common import endpoint, home_units, new_id, read_body, require_roles, resolve_home

blueprint = Blueprint("homes", __name__)

MISSED_LIST_DAYS = 7
MIN_STAFF_MAX = 30
NOTICE_MULTIPLIER_MAX = 6


@blueprint.get("/api/homes/<home_id>/today")
@endpoint()
def read_today(conn, person, home_id):
    home = resolve_home(conn, person, home_id)
    require_roles(person, "unit_manager", "hr_admin")
    today = today_london()
    now = now_utc()
    units = home_units(conn, home["id"])
    unit_ids = [unit["id"] for unit in units]
    on_duty = load_on_duty(conn, unit_ids, today, today)
    floors = load_floors(conn, unit_ids)

    unit_payloads = []
    totals = {"on_duty": 0, "seniors_on_duty": 0, "below_floor": 0}
    for unit in units:
        shifts = []
        for shift in SHIFTS:
            staff, seniors = on_duty.counts(unit["id"], today, shift)
            floor = floors.in_force(unit["id"], shift, today)
            staff_short = shortfall(floor["min_staff"], staff)
            senior_short = shortfall(floor["min_seniors"], seniors)
            shifts.append(
                {
                    "shift": shift,
                    "on_duty": staff,
                    "seniors_on_duty": seniors,
                    "floor": {
                        "min_staff": floor["min_staff"],
                        "min_seniors": floor["min_seniors"],
                    },
                    "shortfall": staff_short,
                    "senior_shortfall": senior_short,
                }
            )
            totals["on_duty"] += staff
            totals["seniors_on_duty"] += seniors
            totals["below_floor"] += bool(staff_short or senior_short)
        unit_payloads.append({"unit_id": unit["id"], "name": unit["name"], "shifts": shifts})

    late = rows(
        conn,
        f"""{ATTENDANCE_SELECT} WHERE a.home_id = %s AND a.late AND NOT a.late_acknowledged
            ORDER BY a.clock_in_at""",
        (home["id"],),
    )
    without_clock_out = rows(
        conn,
        f"""{ATTENDANCE_SELECT} WHERE a.home_id = %s AND a.clock_out_at IS NULL
              AND a.shift_date BETWEEN %s AND %s
            ORDER BY a.shift_date, a.shift""",
        (home["id"], today - timedelta(days=MISSED_LIST_DAYS - 1), today),
    )
    missed = sorted(
        (record for record in without_clock_out if is_missed_clock_out(record, now)),
        key=lambda record: shift_window(record["shift_date"], record["shift"])[0],
    )
    return api_response(
        {
            "date": today.isoformat(),
            "units": unit_payloads,
            "totals": totals,
            "late_clock_ins": [projections.attendance(record, now) for record in late],
            "missed_clock_outs": [projections.attendance(record, now) for record in missed],
        }
    )


@blueprint.get("/api/homes/<home_id>/attendance")
@endpoint()
def read_home_attendance(conn, person, home_id):
    home = resolve_home(conn, person, home_id)
    require_roles(person, "unit_manager", "hr_admin")
    now = now_utc()
    day = parse_date(request.args.get("date")) or today_london()
    records = rows(
        conn,
        f"""{ATTENDANCE_SELECT} WHERE a.home_id = %s AND a.shift_date = %s
            ORDER BY a.shift, p.display_name""",
        (home["id"], day),
    )
    return api_response({"items": [projections.attendance(record, now) for record in records]})


@blueprint.get("/api/homes/<home_id>/floors")
@endpoint()
def read_floors(conn, person, home_id):
    home = resolve_home(conn, person, home_id)
    require_roles(person, "unit_manager", "hr_admin")
    versions = rows(
        conn,
        """SELECT id, unit_id, shift, min_staff, min_seniors, effective_from, created_by,
                  created_at
           FROM floor_versions WHERE home_id = %s
           ORDER BY unit_id, shift, effective_from DESC""",
        (home["id"],),
    )
    return api_response({"versions": [projections.floor_version(record) for record in versions]})


@blueprint.post("/api/homes/<home_id>/floors")
@endpoint(write=True)
def add_floor_version(conn, person, home_id):
    body = read_body("unit_id", "shift", "min_staff", "min_seniors", "effective_from")
    home = resolve_home(conn, person, home_id)
    require_roles(person, "hr_admin")
    today = today_london()
    unit_ids = [unit["id"] for unit in home_units(conn, home["id"])]
    unit_id = body.get("unit_id")
    if unit_id not in unit_ids:
        raise ApiError("not_found")
    shift = body.get("shift")
    effective_from = parse_date(body.get("effective_from"))
    if shift in SHIFTS and effective_from is not None:
        clash = rows(
            conn,
            """SELECT id FROM floor_versions
               WHERE unit_id = %s AND shift = %s AND effective_from = %s""",
            (unit_id, shift, effective_from),
        )
        if clash:
            raise ApiError("version_exists")
    if shift not in SHIFTS:
        body.fail_with("shift", "Choose early, late or night.")
    min_staff = body.get("min_staff")
    if (
        not isinstance(min_staff, int)
        or isinstance(min_staff, bool)
        or not 0 <= min_staff <= MIN_STAFF_MAX
    ):
        body.fail("min_staff", "min_staff")
        min_staff = None
    min_seniors = body.get("min_seniors")
    if (
        not isinstance(min_seniors, int)
        or isinstance(min_seniors, bool)
        or min_seniors < 0
        or (min_staff is not None and min_seniors > min_staff)
    ):
        body.fail("min_seniors", "min_seniors")
    if effective_from is None or effective_from <= today:
        body.fail("effective_from", "effective_from")
    body.check()
    version_id = new_id("flr")
    try:
        execute(
            conn,
            """INSERT INTO floor_versions (id, home_id, unit_id, shift, min_staff,
                                           min_seniors, effective_from, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                version_id,
                home["id"],
                unit_id,
                shift,
                min_staff,
                min_seniors,
                effective_from,
                person["id"],
            ),
        )
    except Unique as error:
        raise ApiError("version_exists") from error
    payload = projections.floor_version(
        {
            "id": version_id,
            "unit_id": unit_id,
            "shift": shift,
            "min_staff": min_staff,
            "min_seniors": min_seniors,
            "effective_from": effective_from,
            "created_by": person["id"],
            "created_at": now_utc(),
        }
    )
    audit.write_entry(
        conn,
        actor=person,
        action="floor_version_added",
        home_id=home["id"],
        target_type="floor_version",
        target_id=version_id,
        before=None,
        after=payload,
        reason=None,
    )
    return api_response(payload, 201)


@blueprint.get("/api/homes/<home_id>/leave-policy")
@endpoint()
def read_policy(conn, person, home_id):
    home = resolve_home(conn, person, home_id)
    require_roles(person, "unit_manager", "hr_admin")
    versions = rows(
        conn,
        """SELECT id, notice_multiplier, effective_from, created_by, created_at
           FROM policy_versions WHERE home_id = %s ORDER BY effective_from DESC""",
        (home["id"],),
    )
    return api_response({"versions": [projections.policy_version(record) for record in versions]})


@blueprint.post("/api/homes/<home_id>/leave-policy")
@endpoint(write=True)
def add_policy_version(conn, person, home_id):
    body = read_body("notice_multiplier", "effective_from")
    home = resolve_home(conn, person, home_id)
    require_roles(person, "hr_admin")
    effective_from = parse_date(body.get("effective_from"))
    if effective_from is not None and rows(
        conn,
        "SELECT id FROM policy_versions WHERE home_id = %s AND effective_from = %s",
        (home["id"], effective_from),
    ):
        raise ApiError("version_exists")
    multiplier = body.get("notice_multiplier")
    if (
        not isinstance(multiplier, int)
        or isinstance(multiplier, bool)
        or not 0 <= multiplier <= NOTICE_MULTIPLIER_MAX
    ):
        body.fail("notice_multiplier", "notice_multiplier")
    if effective_from is None or effective_from <= today_london():
        body.fail("effective_from", "effective_from")
    body.check()
    version_id = new_id("pol")
    try:
        execute(
            conn,
            """INSERT INTO policy_versions (id, home_id, notice_multiplier, effective_from,
                                            created_by)
               VALUES (%s, %s, %s, %s, %s)""",
            (version_id, home["id"], multiplier, effective_from, person["id"]),
        )
    except Unique as error:
        raise ApiError("version_exists") from error
    payload = projections.policy_version(
        {
            "id": version_id,
            "notice_multiplier": multiplier,
            "effective_from": effective_from,
            "created_by": person["id"],
            "created_at": now_utc(),
        }
    )
    audit.write_entry(
        conn,
        actor=person,
        action="policy_version_added",
        home_id=home["id"],
        target_type="policy_version",
        target_id=version_id,
        before=None,
        after=payload,
        reason=None,
    )
    return api_response(payload, 201)
